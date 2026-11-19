import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openState } from "../server/state.ts";
import { prepareLocalOwnerCommand } from "../server/kernel-owner-v1.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("owner command admission journal", () => {
  it("checks session expiry at the final dispatch clock sample", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-final-session-"));
    try {
      let time = 1000;
      let finalSample = false;
      const state = openState(dir, () => (finalSample ? 2000 : time));
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "one",
      );
      const token = state.beginOwnerCommand("s", "g", command);
      let calls = 0;
      const original = state.db.prepare.bind(state.db);
      const spy = vi.spyOn(state.db, "prepare").mockImplementation((sql) => {
        if (sql.startsWith("SELECT data FROM sessions")) finalSample = true;
        return original(sql);
      });
      expect(() => state.dispatchOwnerCommand(token, () => ++calls)).toThrow(
        "Session unavailable",
      );
      expect(calls).toBe(0);
      spy.mockRestore();
      time = 2000;
      expect(state.db.prepare("SELECT * FROM owner_commands").all()).toEqual(
        [],
      );
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("preserves an unknown intent across restart if SQLite refuses unsent cleanup", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-cleanup-failure-"));
    try {
      let failClock = false;
      const state = openState(dir, () => {
        if (failClock) throw new Error("synthetic clock failure");
        return 1000;
      });
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "unsent",
      );
      const token = state.beginOwnerCommand("s", "g", command);
      state.db.exec(
        "CREATE TRIGGER fail_cleanup BEFORE DELETE ON owner_commands BEGIN SELECT RAISE(FAIL, 'synthetic'); END",
      );
      failClock = true;
      let sends = 0;
      expect(() => state.dispatchOwnerCommand(token, () => ++sends)).toThrow();
      expect(sends).toBe(0);
      state.db.close();
      const restarted = openState(dir, () => 1001);
      expect(
        restarted.db.prepare("SELECT outcome FROM owner_commands").get()
          ?.outcome,
      ).toBe("unknown");
      restarted.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reconciles only an exactly matching persisted receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-receipt-"));
    try {
      const state = openState(dir, () => 1000);
      const command = prepareLocalOwnerCommand(
        "program",
        {
          action: "approve",
          expected_revision: -1,
          decision_id: "d",
          expires_at: 2,
          proposal_digest: "a".repeat(64),
          scope_digest: "b".repeat(64),
        },
        () => "one",
      );
      state.db
        .prepare(
          "INSERT INTO owner_commands (command_id, scope, input, outcome, created) VALUES (?, ?, ?, 'unknown', ?)",
        )
        .run(command.commandId, command.scope, command.frame(), 1000);
      const receipt = {
        kind: "historical-receipt-shape" as const,
        action: "approve" as const,
        status: "approved" as const,
        settlement: null,
        decision_id: "d",
        spec_digest: "c".repeat(64),
        expires_at: 2n,
      };
      state.recordOwnerReceipt(command, receipt);
      expect(() => state.recordOwnerReceipt(command, receipt)).not.toThrow();
      expect(() =>
        state.recordOwnerReceipt(command, {
          ...receipt,
          spec_digest: "d".repeat(64),
        }),
      ).toThrow("mismatch");
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("checks fresh approval deadlines at the exact second but not historical replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-deadline-"));
    try {
      let time = 1999;
      const state = openState(dir, () => time);
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(10000).toISOString() },
          }),
          10000,
          10000,
        );
      const command = (id: string) =>
        prepareLocalOwnerCommand(
          "program",
          {
            action: "approve",
            expected_revision: -1,
            decision_id: "d",
            expires_at: 2,
            proposal_digest: "a".repeat(64),
            scope_digest: "b".repeat(64),
          },
          () => id,
        );
      const first = command("first");
      const token = state.beginOwnerCommand("s", "g", first);
      time = 2000;
      let calls = 0;
      expect(() => state.dispatchOwnerCommand(token, () => ++calls)).toThrow(
        "deadline expired",
      );
      expect(calls).toBe(0);
      expect(state.db.prepare("SELECT * FROM owner_commands").all()).toEqual(
        [],
      );
      expect(() =>
        state.beginOwnerCommand("s", "g", command("second")),
      ).toThrow("deadline expired");
      state.db
        .prepare(
          "INSERT INTO owner_commands (command_id, scope, input, outcome, created) VALUES (?, ?, ?, 'unknown', ?)",
        )
        .run(first.commandId, first.scope, first.frame(), 1999);
      const replay = state.beginOwnerReplay("s", "g", first);
      expect(state.dispatchOwnerCommand(replay, () => ++calls)).toBe(1);
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("retires only a fresh definitely-unsent intent after admission fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-unsent-"));
    try {
      let fail = false;
      const state = openState(dir, () => {
        if (fail) throw new Error("synthetic clock failure");
        return 1000;
      });
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "program",
        {
          action: "start-managed",
          expected_revision: 1,
        },
        () => "unsent",
      );
      const token = state.beginOwnerCommand("s", "g", command);
      fail = true;
      let sends = 0;
      expect(() => state.dispatchOwnerCommand(token, () => ++sends)).toThrow();
      expect(sends).toBe(0);
      state.db.close();
      const restarted = openState(dir, () => 1001);
      expect(
        restarted.db.prepare("SELECT * FROM owner_commands").all(),
      ).toEqual([]);
      restarted.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists the exact input before dispatch and never revives a token after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-"));
    try {
      const state = openState(dir, () => 1000);
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("session"),
          digest("generation"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "another-program",
        { action: "stop", expected_revision: 1, reason: "synthetic" },
        () => "synthetic-command",
      );
      const token = state.beginOwnerCommand("session", "generation", command);
      const competing = prepareLocalOwnerCommand(
        "another-program",
        { action: "stop", expected_revision: 1, reason: "different input" },
        () => "other-command",
      );
      expect(() =>
        state.beginOwnerCommand("session", "generation", competing),
      ).toThrow("outcome unresolved");
      const row = state.db.prepare("SELECT * FROM owner_commands").get()!;
      expect(row.outcome).toBe("unknown");
      expect(Buffer.from(row.input as Uint8Array)).toEqual(command.frame());
      let calls = 0;
      expect(state.dispatchOwnerCommand(token, () => ++calls)).toBe(1);
      expect(() => state.dispatchOwnerCommand(token, () => ++calls)).toThrow();
      expect(calls).toBe(1);
      state.db.close();
      const restarted = openState(dir, () => 1001);
      expect(() =>
        restarted.dispatchOwnerCommand(token, () => ++calls),
      ).toThrow();
      expect(
        restarted.db.prepare("SELECT outcome FROM owner_commands").get()
          ?.outcome,
      ).toBe("unknown");
      expect(() =>
        restarted.beginOwnerCommand("session", "generation", command),
      ).toThrow();
      restarted.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not initiate an effect after revocation or expiry", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-"));
    try {
      let now = 1000;
      const state = openState(dir, () => now);
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("session"),
          digest("generation"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "synthetic-command",
      );
      const token = state.beginOwnerCommand("session", "generation", command);
      expect(state.revoke("session", "generation")).toBe(true);
      let calls = 0;
      expect(() => state.dispatchOwnerCommand(token, () => ++calls)).toThrow(
        "Session unavailable",
      );
      expect(calls).toBe(0);
      expect(
        state.db.prepare("SELECT outcome FROM owner_commands").get()?.outcome,
      ).toBeUndefined();
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("session"),
          digest("generation"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const second = prepareLocalOwnerCommand(
        "another-program",
        { action: "start-managed", expected_revision: 1 },
        () => "second-command",
      );
      const expiring = state.beginOwnerCommand("session", "generation", second);
      now = 2000;
      expect(() => state.dispatchOwnerCommand(expiring, () => ++calls)).toThrow(
        "Session unavailable",
      );
      expect(calls).toBe(0);
      expect(
        state.db.prepare("SELECT count(*) AS count FROM owner_commands").get()
          ?.count,
      ).toBe(0);
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("holds the session fence while synchronously initiating dispatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-"));
    try {
      const first = openState(dir, () => 1000);
      first.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("session"),
          digest("generation"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const second = openState(dir, () => 1000);
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "fenced-command",
      );
      const token = first.beginOwnerCommand("session", "generation", command);
      let initiated = false;
      first.dispatchOwnerCommand(token, () => {
        expect(() => second.revoke("session", "generation")).toThrow(/locked/);
        initiated = true;
      });
      expect(initiated).toBe(true);
      expect(second.revoke("session", "generation")).toBe(true);
      first.db.close();
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains the original unknown if a replay is refused before dispatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-replay-"));
    try {
      const state = openState(dir, () => 1000);
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "original",
      );
      const initial = state.beginOwnerCommand("s", "g", command);
      state.dispatchOwnerCommand(initial, () => {});
      const replay = state.beginOwnerReplay("s", "g", command);
      state.revoke("s", "g");
      let calls = 0;
      expect(() => state.dispatchOwnerCommand(replay, () => ++calls)).toThrow(
        "Session unavailable",
      );
      expect(calls).toBe(0);
      expect(
        state.db
          .prepare("SELECT outcome FROM owner_commands WHERE command_id = ?")
          .get("original")?.outcome,
      ).toBe("unknown");
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves unknown intent when the process dies during dispatch initiation", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-crash-"));
    try {
      const stateUrl = new URL("../server/state.ts", import.meta.url).href;
      const codecUrl = new URL("../server/kernel-owner-v1.ts", import.meta.url)
        .href;
      const script = `
        import { createHash } from 'node:crypto';
        import { openState } from ${JSON.stringify(stateUrl)};
        import { prepareLocalOwnerCommand } from ${JSON.stringify(codecUrl)};
        const hash = value => createHash('sha256').update(value).digest('hex');
        const state = openState(process.argv[1], () => 1000);
        state.db.prepare('INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)').run(hash('s'), hash('g'), JSON.stringify({owner:true,cookie:{expires:new Date(3000).toISOString()}}), 2000, 3000);
        const command = prepareLocalOwnerCommand('program', {action:'start-managed', expected_revision:1}, () => 'crash-command');
        const token = state.beginOwnerCommand('s', 'g', command);
        state.dispatchOwnerCommand(token, () => process.exit(41));
      `;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", script, dir],
        {
          env: {
            HOME: dir,
            PATH: "/usr/bin:/bin",
            LANG: "C.UTF-8",
            TMPDIR: dir,
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.status, result.stderr).toBe(41);
      const state = openState(dir, () => 1001);
      const saved = state.db
        .prepare("SELECT command_id, outcome FROM owner_commands")
        .get();
      expect(saved).toMatchObject({
        command_id: "crash-command",
        outcome: "unknown",
      });
      const replacement = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "different-command",
      );
      expect(() => state.beginOwnerCommand("s", "g", replacement)).toThrow(
        "outcome unresolved",
      );
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds history without discarding unresolved intent", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-journal-retention-"));
    try {
      const state = openState(dir, () => 1000);
      state.db
        .prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          digest("s"),
          digest("g"),
          JSON.stringify({
            owner: true,
            cookie: { expires: new Date(3000).toISOString() },
          }),
          2000,
          3000,
        );
      const insert = state.db.prepare(
        "INSERT INTO owner_commands (command_id, scope, input, outcome, receipt, created) VALUES (?, ?, ?, ?, ?, ?)",
      );
      state.db.exec("BEGIN");
      for (let i = 0; i < 127; i++)
        insert.run(
          `historic-${i}`,
          "other",
          Buffer.from("fixture"),
          "historical",
          "{}",
          i,
        );
      insert.run(
        "unresolved",
        "other",
        Buffer.from("fixture"),
        "unknown",
        null,
        1,
      );
      state.db.exec("COMMIT");
      const command = prepareLocalOwnerCommand(
        "program",
        { action: "start-managed", expected_revision: 1 },
        () => "new-command",
      );
      state.beginOwnerCommand("s", "g", command);
      expect(
        state.db.prepare("SELECT count(*) AS count FROM owner_commands").get()
          ?.count,
      ).toBe(128);
      expect(
        state.db
          .prepare(
            "SELECT outcome FROM owner_commands WHERE command_id = 'unresolved'",
          )
          .get()?.outcome,
      ).toBe("unknown");
      expect(
        state.db
          .prepare(
            "SELECT 1 FROM owner_commands WHERE command_id = 'historic-0'",
          )
          .get(),
      ).toBeUndefined();
      state.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

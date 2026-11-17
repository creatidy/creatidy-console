import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openState } from "../server/state.ts";
import { prepareLocalOwnerCommand } from "../server/kernel-owner-v1.ts";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("owner command admission journal", () => {
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
      ).toBe("unknown");
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

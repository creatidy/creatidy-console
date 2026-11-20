import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { openState } from "../server/state.ts";
import { prepareLocalOwnerCommand } from "../server/kernel-owner-v1.ts";
import type { Session } from "fastify";

const directories: string[] = [];
const origin = "http://127.0.0.1:4173";
const headers = {
  host: "127.0.0.1:4173",
  origin,
  "content-type": "application/json",
};
const token = "synthetic-setup-authority";
const password = "synthetic-owner-password";

async function fixture(
  clock = () => Date.now(),
  kernelOwner?: import("../server/app.ts").AppOptions["kernelOwner"],
) {
  const dir = mkdtempSync(join(tmpdir(), "console-test-"));
  directories.push(dir);
  const assets = join(dir, "assets");
  mkdirSync(assets);
  writeFileSync(
    join(assets, "index.html"),
    "<!doctype html><title>fixture</title>",
  );
  const state = openState(dir, clock);
  state.db
    .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
    .run(
      JSON.stringify({
        digest: createHash("sha256").update(token).digest("hex"),
        expires: clock() + 60_000,
      }),
    );
  state.db.close();
  const app = await createApp({
    stateDirectory: dir,
    staticDirectory: assets,
    origin,
    now: clock,
    ...(kernelOwner
      ? {
          kernelOwner: {
            approvalSupported: !!kernelOwner.readApprovalScope,
            ...kernelOwner,
          },
        }
      : {}),
  });
  return { app, dir, assets };
}

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("authenticated application", () => {
  it("recovers only the paired exact original over the read-only route after restart", async () => {
    const time = Date.now();
    const pairing = { producer: "kernel", recipient: "console" };
    let sent: ReturnType<typeof prepareLocalOwnerCommand> | undefined;
    const { app, dir, assets } = await fixture(() => time, {
      scope: "program",
      pairing,
      historyVersion: 2,
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: "b".repeat(64),
        proposalDigest: "a".repeat(64),
        owner: "actor",
        text: "scope",
      }),
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => true,
      sendCommand: async (command) => {
        sent = command;
        return { kind: "unknown" };
      },
      close: () => {},
    });
    const bootstrap = await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    expect(bootstrap.statusCode).toBe(200);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const auth = { ...headers, cookie };
    try {
      const review = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-review",
        headers: auth,
        payload: { expires_at: String(Math.floor(time / 1000) + 1) },
      });
      expect(review.statusCode).toBe(200);
      const submit = await app.inject({
        method: "POST",
        url: "/api/kernel/owner",
        headers: auth,
        payload: { action: "approve", review: review.json().review },
      });
      expect(submit.json()).toEqual({ kind: "unknown" });
      expect(sent?.binding).toMatchObject({
        ...pairing,
        historyVersion: 2,
        actorDigest: createHash("sha256").update('"actor"').digest("hex"),
      });
    } finally {
      await app.close();
    }
    const sendCommand = vi.fn();
    const readDisposition = vi.fn(
      async (command: ReturnType<typeof prepareLocalOwnerCommand>) => {
        expect(command.frame()).toEqual(sent!.frame());
        expect(command.binding).toEqual(sent!.binding);
        return { kind: "terminal-refusal", reason: "stale-revision" } as const;
      },
    );
    const replacement = (recipient: string) =>
      createApp({
        stateDirectory: dir,
        staticDirectory: assets,
        origin,
        now: () => time + 5000,
        kernelOwner: {
          scope: "program",
          pairing: { ...pairing, recipient },
          historyVersion: 2,
          proposalSupported: false,
          approvalSupported: false,
          readProposal: async () => {
            throw new Error("not supported");
          },
          canSend: () => true,
          canReadDisposition: () => true,
          readDisposition,
          sendCommand,
          close: () => {},
        },
      });
    const request = {
      method: "POST" as const,
      url: "/api/kernel/owner-replay",
      headers: auth,
      payload: { commandId: sent!.commandId },
    };
    const wrong = await replacement("wrong");
    try {
      expect((await wrong.inject(request)).statusCode).toBe(409);
      expect(readDisposition).not.toHaveBeenCalled();
    } finally {
      await wrong.close();
    }
    const recovered = await replacement(pairing.recipient);
    try {
      expect(
        (
          await recovered.inject({
            ...request,
            headers: { ...auth, origin: "https://other.test" },
          })
        ).statusCode,
      ).toBe(403);
      expect((await recovered.inject({ ...request, headers })).statusCode).toBe(
        401,
      );
      const journal = () =>
        recovered.inject({
          method: "GET",
          url: "/api/kernel/owner-journal",
          headers: auth,
        });
      expect((await journal()).json().commands[0]).toMatchObject({
        ...pairing,
        outcome: "unknown",
        canRecover: true,
        canReplay: false,
      });
      expect((await recovered.inject(request)).json()).toEqual({
        kind: "terminal-refusal",
        reason: "stale-revision",
      });
      expect((await journal()).json().commands[0]).toMatchObject({
        outcome: "refused",
        receipt: null,
        canRecover: false,
      });
      expect((await recovered.inject(request)).statusCode).toBe(409);
      expect(readDisposition).toHaveBeenCalledTimes(1);
      expect(sendCommand).not.toHaveBeenCalled();
    } finally {
      await recovered.close();
    }
  });
  it("retries a transient receipt persistence failure immediately without another command", async () => {
    const statements = new WeakSet<StatementSync>();
    let failures = 0;
    let attempts = 0;
    const prepare = DatabaseSync.prototype.prepare;
    const run = StatementSync.prototype.run;
    const prepareSpy = vi
      .spyOn(DatabaseSync.prototype, "prepare")
      .mockImplementation(function (this: DatabaseSync, sql: string) {
        const statement = prepare.call(this, sql);
        if (sql.startsWith("UPDATE owner_commands SET outcome = ?"))
          statements.add(statement);
        return statement;
      });
    const runSpy = vi
      .spyOn(StatementSync.prototype, "run")
      .mockImplementation(function (this: StatementSync, ...args) {
        if (statements.has(this)) {
          attempts++;
          if (failures++ === 0)
            throw new Error("synthetic transient write failure");
        }
        return run.apply(this, args);
      });
    const sendCommand = vi.fn(
      async (command: ReturnType<typeof prepareLocalOwnerCommand>) => ({
        kind: "historical-receipt-shape" as const,
        action: "approve" as const,
        status: "approved" as const,
        settlement: null,
        decision_id: String(command.request.decision_id),
        spec_digest: "c".repeat(64),
        expires_at: 2000000000n,
      }),
    );
    const { app, dir } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: "b".repeat(64),
        proposalDigest: "a".repeat(64),
        text: "scope",
      }),
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => true,
      sendCommand,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      };
      const review = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-review",
        headers: auth,
        payload: { expires_at: "2000000000" },
      });
      const submitted = await app.inject({
        method: "POST",
        url: "/api/kernel/owner",
        headers: auth,
        payload: { action: "approve", review: review.json().review },
      });
      expect(submitted.json().kind).toBe("historical-receipt-shape");
      expect(attempts).toBe(2);
      expect(sendCommand).toHaveBeenCalledTimes(1);
      const state = openState(dir);
      expect(
        state.db.prepare("SELECT outcome FROM owner_commands").get()?.outcome,
      ).toBe("historical");
      state.db.close();
    } finally {
      runSpy.mockRestore();
      prepareSpy.mockRestore();
      await app.close();
    }
  });
  it.each([
    "submission-receipt",
    "submission-unknown",
    "replay-receipt",
    "replay-unknown",
  ] as const)(
    "handles %s after dispatch transaction COMMIT fails",
    async (scenario) => {
      const replay = scenario.startsWith("replay");
      const unknown = scenario.endsWith("unknown");
      let original: ReturnType<typeof prepareLocalOwnerCommand> | undefined;
      let armed = false;
      let resolveResult!: (
        result: import("../server/kernel-owner-v1.ts").OwnerObservation,
      ) => void;
      const delayed = new Promise<
        import("../server/kernel-owner-v1.ts").OwnerObservation
      >((resolve) => {
        resolveResult = resolve;
      });
      const exec = DatabaseSync.prototype.exec;
      const spy = vi
        .spyOn(DatabaseSync.prototype, "exec")
        .mockImplementation(function (this: DatabaseSync, sql: string) {
          if (armed && sql === "COMMIT") {
            armed = false;
            throw new Error("synthetic commit failure");
          }
          return exec.call(this, sql);
        });
      const sendCommand = vi.fn(
        (command: ReturnType<typeof prepareLocalOwnerCommand>) => {
          original = command;
          if (replay) return Promise.resolve({ kind: "unknown" as const });
          armed = true;
          return delayed;
        },
      );
      const replayCommand = vi.fn(() => {
        armed = true;
        return delayed;
      });
      const { app } = await fixture(() => Date.now(), {
        scope: "program",
        readProposal: async () => ({
          digest: "a".repeat(64),
          text: "proposal",
        }),
        readApprovalScope: async () => ({
          digest: "b".repeat(64),
          proposalDigest: "a".repeat(64),
          text: "scope",
        }),
        readRevision: async () => ({ revision: "-1", status: "absent" }),
        canSend: () => true,
        sendCommand,
        canReplay: (command) => command === original,
        replayCommand,
        close: () => {},
      });
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const auth = {
          ...headers,
          cookie: String(login.headers["set-cookie"]).split(";")[0]!,
        };
        const review = await app.inject({
          method: "POST",
          url: "/api/kernel/owner-review",
          headers: auth,
          payload: { expires_at: "2000000000" },
        });
        const submit = await app.inject({
          method: "POST",
          url: "/api/kernel/owner",
          headers: auth,
          payload: { action: "approve", review: review.json().review },
        });
        if (replay) {
          expect(submit.json()).toEqual({ kind: "unknown" });
          expect(
            (
              await app.inject({
                method: "POST",
                url: "/api/kernel/owner-replay",
                headers: auth,
                payload: { commandId: original!.commandId },
              })
            ).statusCode,
          ).toBe(503);
        } else expect(submit.statusCode).toBe(503);
        resolveResult(
          unknown
            ? { kind: "unknown" }
            : {
                kind: "historical-receipt-shape",
                action: "approve",
                status: "approved",
                settlement: null,
                decision_id: String(original!.request.decision_id),
                spec_digest: "c".repeat(64),
                expires_at: 2000000000n,
              },
        );
        await delayed;
        const history = await app.inject({
          method: "GET",
          url: "/api/kernel/owner-journal",
          headers: auth,
        });
        expect(history.json().commands[0]).toMatchObject({
          outcome: unknown ? "unknown" : "historical",
          canReplay: unknown,
        });
        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(replayCommand).toHaveBeenCalledTimes(replay ? 1 : 0);
      } finally {
        spy.mockRestore();
        await app.close();
      }
    },
  );
  it("does not infer approval capability from available methods", async () => {
    const readApprovalScope = vi.fn(async () => ({
      digest: "b".repeat(64),
      proposalDigest: "a".repeat(64),
      text: "scope",
    }));
    const sendCommand = vi.fn(async () => ({ kind: "unknown" as const }));
    const { app } = await fixture(() => Date.now(), {
      scope: "program",
      approvalSupported: false,
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope,
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => true,
      sendCommand,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      };
      const owner = await app.inject({
        method: "GET",
        url: "/api/kernel/owner",
        headers: auth,
      });
      expect(owner.json().actions).toEqual([]);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/approval-scope",
            headers: auth,
          })
        ).json(),
      ).toEqual({ status: "unavailable" });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner-review",
            headers: auth,
            payload: { expires_at: "2000000000" },
          })
        ).statusCode,
      ).toBe(503);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: auth,
            payload: { action: "approve", review: "a".repeat(64) },
          })
        ).statusCode,
      ).toBe(503);
      expect(readApprovalScope).not.toHaveBeenCalled();
      expect(sendCommand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("rejects expired approval deadlines before review and before fresh submission", async () => {
    let time = 1_900_000_000_999;
    const sendCommand = vi.fn(async () => ({ kind: "unknown" as const }));
    const { app, dir } = await fixture(() => time, {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: "b".repeat(64),
        proposalDigest: "a".repeat(64),
        text: "scope",
      }),
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => true,
      sendCommand,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      };
      const review = (expires_at: string) =>
        app.inject({
          method: "POST",
          url: "/api/kernel/owner-review",
          headers: auth,
          payload: { expires_at },
        });
      expect((await review("1900000000")).statusCode).toBe(409);
      const valid = await review("1900000001");
      expect(valid.statusCode).toBe(200);
      time = 1_900_000_001_000;
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: auth,
            payload: { action: "approve", review: valid.json().review },
          })
        ).statusCode,
      ).toBe(409);
      expect(sendCommand).not.toHaveBeenCalled();
      const state = openState(dir, () => time);
      expect(state.db.prepare("SELECT * FROM owner_commands").all()).toEqual(
        [],
      );
      state.db.close();
    } finally {
      await app.close();
    }
  });
  it.each(["submission", "replay"] as const)(
    "retains a validated %s receipt across repeated local SQLite failures without resending",
    async (path) => {
      let original: ReturnType<typeof prepareLocalOwnerCommand> | undefined;
      const receipt = (
        command: ReturnType<typeof prepareLocalOwnerCommand>,
      ) => ({
        kind: "historical-receipt-shape" as const,
        action: "approve" as const,
        status: "approved" as const,
        settlement: null,
        decision_id: String(command.request.decision_id),
        spec_digest: "c".repeat(64),
        expires_at: 2000000000n,
      });
      const sendCommand = vi.fn(
        async (command: ReturnType<typeof prepareLocalOwnerCommand>) => {
          original = command;
          return path === "replay"
            ? { kind: "unknown" as const }
            : receipt(command);
        },
      );
      const replayCommand = vi.fn(
        async (command: ReturnType<typeof prepareLocalOwnerCommand>) =>
          receipt(command),
      );
      const { app, dir } = await fixture(() => Date.now(), {
        scope: "program",
        readProposal: async () => ({
          digest: "a".repeat(64),
          text: "proposal",
        }),
        readApprovalScope: async () => ({
          digest: "b".repeat(64),
          proposalDigest: "a".repeat(64),
          text: "scope",
        }),
        readRevision: async () => ({ revision: "-1", status: "absent" }),
        canSend: () => true,
        sendCommand,
        canReplay: (command) => command === original,
        replayCommand,
        close: () => {},
      });
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const auth = {
          ...headers,
          cookie: String(login.headers["set-cookie"]).split(";")[0]!,
        };
        const review = await app.inject({
          method: "POST",
          url: "/api/kernel/owner-review",
          headers: auth,
          payload: { expires_at: "2000000000" },
        });
        const state = openState(dir);
        const unrelated = prepareLocalOwnerCommand(
          "other",
          {
            action: "stop",
            expected_revision: 1,
            reason: "synthetic",
          },
          () => "11111111-1111-4111-8111-111111111111",
        );
        state.db
          .prepare(
            "INSERT INTO owner_commands (command_id, scope, input, outcome, created) VALUES (?, ?, ?, 'unknown', ?)",
          )
          .run(unrelated.commandId, unrelated.scope, unrelated.frame(), 1);
        const failWrites = () =>
          state.db.exec(
            "CREATE TRIGGER fail_receipt BEFORE UPDATE ON owner_commands BEGIN SELECT RAISE(FAIL, 'synthetic'); END",
          );
        if (path === "submission") failWrites();
        const submit = await app.inject({
          method: "POST",
          url: "/api/kernel/owner",
          headers: auth,
          payload: { action: "approve", review: review.json().review },
        });
        if (path === "replay") {
          expect(submit.json()).toEqual({ kind: "unknown" });
          failWrites();
          const replay = await app.inject({
            method: "POST",
            url: "/api/kernel/owner-replay",
            headers: auth,
            payload: { commandId: original!.commandId },
          });
          expect(replay.statusCode).toBe(503);
        } else expect(submit.statusCode).toBe(503);
        for (let i = 0; i < 2; i++) {
          const pending = await app.inject({
            method: "GET",
            url: "/api/kernel/owner-journal",
            headers: auth,
          });
          expect(pending.statusCode).toBe(200);
          expect(pending.json().commands[0]).toMatchObject({
            outcome: "unknown",
            receiptPending: true,
            canReplay: false,
          });
          expect(pending.json().commands[1]).toMatchObject({
            commandId: unrelated.commandId,
            scope: "other",
            outcome: "unknown",
          });
        }
        expect(
          state.db
            .prepare(
              "SELECT outcome FROM owner_commands WHERE scope = 'program'",
            )
            .get()?.outcome,
        ).toBe("unknown");
        state.db.exec("DROP TRIGGER fail_receipt");
        const history = await app.inject({
          method: "GET",
          url: "/api/kernel/owner-journal",
          headers: auth,
        });
        expect(history.json().commands[0]).toMatchObject({
          outcome: "historical",
          canReplay: false,
          receipt: { decisionId: String(original!.request.decision_id) },
        });
        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(replayCommand).toHaveBeenCalledTimes(path === "replay" ? 1 : 0);
        expect(
          state.db
            .prepare(
              "SELECT outcome FROM owner_commands WHERE scope = 'program'",
            )
            .get()?.outcome,
        ).toBe("historical");
        state.db.close();
      } finally {
        await app.close();
      }
    },
  );
  it("exposes retained scopes without a channel or proposal and never restores replay on restart", async () => {
    const channel = {
      scope: "scope-a",
      readProposal: async () => {
        throw new Error("disconnected");
      },
      close: () => {},
    };
    const { app, dir, assets } = await fixture(() => Date.now(), channel);
    let restarted: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const auth = {
        ...headers,
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      };
      const state = openState(dir);
      const ids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ];
      for (const [index, scope] of ["scope-a", "scope-b"].entries()) {
        const command = prepareLocalOwnerCommand(
          scope,
          {
            action: "approve",
            expected_revision: index ? 9007199254740993n : -1,
            decision_id: index ? "<img src=x>" : "d".repeat(64),
            expires_at: 9223372036854775807n,
            proposal_digest: "a".repeat(64),
            scope_digest: "b".repeat(64),
          },
          () => ids[index]!,
        );
        state.db
          .prepare(
            "INSERT INTO owner_commands (command_id, scope, input, outcome, receipt, created) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            command.commandId,
            scope,
            command.frame(),
            index ? "historical" : "unknown",
            index
              ? JSON.stringify({
                  kind: "historical-receipt-shape",
                  action: "approve",
                  status: "approved",
                  settlement: null,
                  decision_id: "<img src=x>",
                  spec_digest: "c".repeat(64),
                  expires_at: "9007199254740993",
                  secret: "must-not-leak",
                })
              : null,
            index,
          );
      }
      state.db.close();
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/owner",
            headers: auth,
          })
        ).json().status,
      ).toBe("disconnected");
      const disconnected = await app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
      expect(disconnected.headers["cache-control"]).toBe("no-store");
      expect(disconnected.json().commands).toEqual([
        expect.objectContaining({
          scope: "scope-b",
          outcome: "historical",
          approval: {
            revision: "9007199254740993",
            proposalDigest: "a".repeat(64),
            scopeDigest: "b".repeat(64),
            decisionId: "<img src=x>",
            requestedExpiry: "9223372036854775807",
          },
          receipt: {
            kind: "historical-receipt-shape",
            action: "approve",
            status: "approved",
            settlement: null,
            decisionId: "<img src=x>",
            specDigest: "c".repeat(64),
            effectiveExpiry: "9007199254740993",
          },
          canReplay: false,
        }),
        expect.objectContaining({
          scope: "scope-a",
          outcome: "unknown",
          approval: {
            revision: "-1",
            proposalDigest: "a".repeat(64),
            scopeDigest: "b".repeat(64),
            decisionId: "d".repeat(64),
            requestedExpiry: "9223372036854775807",
          },
          receipt: null,
          canReplay: false,
        }),
      ]);
      expect(disconnected.body).not.toContain("must-not-leak");
      await app.close();
      restarted = await createApp({
        stateDirectory: dir,
        staticDirectory: assets,
        origin,
      });
      expect(
        (
          await restarted.inject({
            method: "GET",
            url: "/api/kernel/owner-journal",
            headers,
          })
        ).statusCode,
      ).toBe(401);
      const history = await restarted.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
      expect(history.headers["cache-control"]).toBe("no-store");
      expect(history.json().commands).toEqual(disconnected.json().commands);
      expect(
        (
          await restarted.inject({
            method: "POST",
            url: "/api/kernel/owner-replay",
            headers: auth,
            payload: { commandId: ids[0] },
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      if (restarted) await restarted.close();
      else await app.close();
    }
  });
  it("does not journal or dispatch when the owner channel is busy before admission", async () => {
    const sendCommand = vi.fn(async () => ({ kind: "unknown" as const }));
    const { app, dir } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: "b".repeat(64),
        proposalDigest: "a".repeat(64),
        text: "scope",
      }),
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => false,
      sendCommand,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const auth = { ...headers, cookie };
      const review = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-review",
        headers: auth,
        payload: { expires_at: "2000000000" },
      });
      expect(review.statusCode).toBe(200);
      const result = await app.inject({
        method: "POST",
        url: "/api/kernel/owner",
        headers: auth,
        payload: { action: "approve", review: review.json().review },
      });
      expect(result.statusCode).toBe(503);
      expect(result.json()).toEqual({
        error: "Owner channel busy; no command sent",
      });
      expect(sendCommand).not.toHaveBeenCalled();
      const state = openState(dir);
      expect(
        state.db.prepare("SELECT count(*) AS count FROM owner_commands").get()
          ?.count,
      ).toBe(0);
      state.db.close();
    } finally {
      await app.close();
    }
  });
  it("replays only an original unknown on the same in-memory capability", async () => {
    let writable = true;
    let failOnClock = 0;
    let armFailure = 0;
    let releaseReplay!: () => void;
    let replayStarted!: () => void;
    const replayHeld = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const replayReady = new Promise<void>((resolve) => {
      replayStarted = resolve;
    });
    let original:
      | ReturnType<
          typeof import("../server/kernel-owner-v1.ts").prepareLocalOwnerCommand
        >
      | undefined;
    const sendCommand = vi.fn(async (command: NonNullable<typeof original>) => {
      original = command;
      return { kind: "unknown" as const };
    });
    const replayCommand = vi.fn(
      async (command: NonNullable<typeof original>) => {
        expect(command).toBe(original);
        replayStarted();
        await replayHeld;
        return {
          kind: "historical-receipt-shape" as const,
          action: "approve" as const,
          status: "approved" as const,
          settlement: null,
          decision_id: String(command.request.decision_id),
          spec_digest: "c".repeat(64),
          expires_at: 2000000000n,
        };
      },
    );
    const channel = {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: "b".repeat(64),
        proposalDigest: "a".repeat(64),
        text: "scope",
      }),
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => {
        if (armFailure) {
          failOnClock = armFailure;
          armFailure = 0;
        }
        return writable;
      },
      sendCommand,
      canReplay: (command: NonNullable<typeof original>) =>
        command === original,
      replayCommand,
      close: () => {},
    };
    const { app } = await fixture(() => {
      if (failOnClock && --failOnClock === 0)
        throw new Error("synthetic admission failure");
      return Date.now();
    }, channel);
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const auth = { ...headers, cookie };
      const review = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-review",
        headers: auth,
        payload: { expires_at: "2000000000" },
      });
      const submit = await app.inject({
        method: "POST",
        url: "/api/kernel/owner",
        headers: auth,
        payload: { action: "approve", review: review.json().review },
      });
      expect(submit.json()).toEqual({ kind: "unknown" });
      const history = await app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
      expect(history.json().commands[0].canReplay).toBe(true);
      expect(history.json().commands[0].approval).toEqual({
        revision: "-1",
        proposalDigest: "a".repeat(64),
        scopeDigest: "b".repeat(64),
        decisionId: String(original!.request.decision_id),
        requestedExpiry: "2000000000",
      });
      const id = history.json().commands[0].commandId;
      writable = false;
      const busy = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-replay",
        headers: auth,
        payload: { commandId: id },
      });
      expect(busy.statusCode).toBe(503);
      expect(replayCommand).not.toHaveBeenCalled();
      const stillAvailable = await app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
      expect(stillAvailable.json().commands[0].canReplay).toBe(true);
      writable = true;
      for (const clockCall of [1, 2]) {
        armFailure = clockCall;
        const refused = await app.inject({
          method: "POST",
          url: "/api/kernel/owner-replay",
          headers: auth,
          payload: { commandId: id },
        });
        expect(refused.statusCode).toBe(503);
        expect(replayCommand).not.toHaveBeenCalled();
        const retained = await app.inject({
          method: "GET",
          url: "/api/kernel/owner-journal",
          headers: auth,
        });
        expect(retained.json().commands[0]).toMatchObject({
          outcome: "unknown",
          canReplay: true,
        });
      }
      const pending = app.inject({
        method: "POST",
        url: "/api/kernel/owner-replay",
        headers: auth,
        payload: { commandId: id },
      });
      await replayReady;
      const concurrent = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-replay",
        headers: auth,
        payload: { commandId: id },
      });
      expect(concurrent.statusCode).toBe(409);
      expect(replayCommand).toHaveBeenCalledTimes(1);
      releaseReplay();
      const result = await pending;
      expect(result.json()).toMatchObject({
        kind: "historical-receipt-shape",
        action: "approve",
      });
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(replayCommand).toHaveBeenCalledTimes(1);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner-replay",
            headers: auth,
            payload: { commandId: id },
          })
        ).statusCode,
      ).toBe(409);
      const after = await app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
      expect(after.json().commands[0]).toMatchObject({
        outcome: "historical",
        canReplay: false,
        receipt: {
          decisionId: String(original!.request.decision_id),
          specDigest: "c".repeat(64),
          effectiveExpiry: "2000000000",
        },
      });
    } finally {
      await app.close();
    }
  });
  it("does not submit a reviewed command when the session is revoked during revalidation", async () => {
    let reads = 0;
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sendCommand = vi.fn(async () => ({ kind: "unknown" as const }));
    const { app, dir } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => {
        if (++reads === 2) {
          started();
          await held;
        }
        return {
          digest: "b".repeat(64),
          proposalDigest: "a".repeat(64),
          text: "scope",
        };
      },
      readRevision: async () => ({ revision: "-1", status: "absent" }),
      canSend: () => true,
      sendCommand,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const auth = { ...headers, cookie };
      const review = await app.inject({
        method: "POST",
        url: "/api/kernel/owner-review",
        headers: auth,
        payload: { expires_at: "2000000000" },
      });
      const request = app.inject({
        method: "POST",
        url: "/api/kernel/owner",
        headers: auth,
        payload: { action: "approve", review: review.json().review },
      });
      await ready;
      await app.inject({
        method: "POST",
        url: "/api/logout",
        headers: auth,
        payload: {},
      });
      release();
      expect((await request).statusCode).toBe(401);
      expect(sendCommand).not.toHaveBeenCalled();
      const state = openState(dir);
      expect(
        state.db.prepare("SELECT count(*) AS count FROM owner_commands").get()
          ?.count,
      ).toBe(0);
      state.db.close();
    } finally {
      await app.close();
    }
  });
  it("binds synthetic approval to one reviewed session, scope, revision and expiry", async () => {
    let revision = "-1";
    let scopeDigest = "b".repeat(64);
    const sendCommand = vi.fn(
      async (
        _command: ReturnType<
          typeof import("../server/kernel-owner-v1.ts").prepareLocalOwnerCommand
        >,
      ) => ({ kind: "unknown" as const }),
    );
    const { app, dir } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope: async () => ({
        digest: scopeDigest,
        proposalDigest: "a".repeat(64),
        text: "synthetic scope",
      }),
      readRevision: async () => ({ revision, status: "absent" }),
      canSend: () => true,
      sendCommand,
      close: () => {},
    });
    try {
      const postReview = (cookie?: string, expires_at = "2000000000") =>
        app.inject({
          method: "POST",
          url: "/api/kernel/owner-review",
          headers: { ...headers, ...(cookie ? { cookie } : {}) },
          payload: { expires_at },
        });
      expect((await postReview()).statusCode).toBe(401);
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const review = await postReview(cookie);
      expect(review.statusCode).toBe(200);
      expect(review.json()).toMatchObject({
        scope: "program",
        revision: "-1",
        approvalExpiry: "2000000000",
        text: "synthetic scope",
      });
      const reviewId = review.json().review as string;
      const otherLogin = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const otherCookie = String(otherLogin.headers["set-cookie"]).split(
        ";",
      )[0]!;
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie: otherCookie },
            payload: { action: "approve", review: reviewId },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie, origin: "https://attacker.example" },
            payload: { action: "approve", review: reviewId },
          })
        ).statusCode,
      ).toBe(403);
      revision = "0";
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie },
            payload: { action: "approve", review: reviewId },
          })
        ).statusCode,
      ).toBe(409);
      expect(sendCommand).not.toHaveBeenCalled();
      revision = "-1";
      const stale = await postReview(cookie);
      scopeDigest = "c".repeat(64);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie },
            payload: { action: "approve", review: stale.json().review },
          })
        ).statusCode,
      ).toBe(409);
      const current = await postReview(cookie);
      const request = {
        method: "POST" as const,
        url: "/api/kernel/owner",
        headers: { ...headers, cookie },
        payload: { action: "approve", review: current.json().review },
      };
      expect((await app.inject(request)).json()).toEqual({ kind: "unknown" });
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect((await postReview(cookie)).statusCode).toBe(409);
      const command = sendCommand.mock.calls[0]![0] as ReturnType<
        typeof import("../server/kernel-owner-v1.ts").prepareLocalOwnerCommand
      >;
      expect(command.request).toMatchObject({
        action: "approve",
        expected_revision: -1n,
        expires_at: 2000000000n,
        proposal_digest: "a".repeat(64),
        scope_digest: scopeDigest,
      });
      expect((await app.inject(request)).statusCode).toBe(409);
      expect(sendCommand).toHaveBeenCalledTimes(1);
      const history = await app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: { ...headers, cookie },
      });
      expect(history.json()).toMatchObject({
        status: "available",
        commands: [
          {
            scope: "program",
            action: "approve",
            outcome: "unknown",
            receipt: null,
          },
        ],
      });
      expect(history.body).not.toContain("synthetic scope");
      const state = openState(dir);
      expect(
        state.db.prepare("SELECT outcome FROM owner_commands").get()?.outcome,
      ).toBe("unknown");
      state.db.close();
    } finally {
      await app.close();
    }
  });
  it("returns approval scope only after authenticated read and never caches it", async () => {
    const readApprovalScope = vi
      .fn()
      .mockResolvedValueOnce({
        digest: "a".repeat(64),
        proposalDigest: "b".repeat(64),
        text: "synthetic-scope",
      })
      .mockRejectedValueOnce(new Error("sensitive producer error"));
    const { app } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "b".repeat(64), text: "proposal" }),
      readApprovalScope,
      close: () => {},
    });
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const auth = { ...headers, cookie };
      const first = await app.inject({
        method: "GET",
        url: "/api/kernel/approval-scope",
        headers: auth,
      });
      expect(first.json()).toEqual({
        status: "connected",
        scope: "program",
        digest: "a".repeat(64),
        proposalDigest: "b".repeat(64),
        text: "synthetic-scope",
      });
      expect(first.headers["cache-control"]).toBe("no-store");
      const second = await app.inject({
        method: "GET",
        url: "/api/kernel/approval-scope",
        headers: auth,
      });
      expect(second.json()).toEqual({ status: "disconnected" });
      expect(second.body).not.toContain("sensitive producer error");
      expect(readApprovalScope).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });
  it("protects approval scope reads across session revocation", async () => {
    let release!: (value: {
      digest: string;
      proposalDigest: string;
      text: string;
    }) => void;
    let started!: () => void;
    const pending = new Promise<{
      digest: string;
      proposalDigest: string;
      text: string;
    }>((resolve) => {
      release = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const readApprovalScope = vi.fn(() => {
      started();
      return pending;
    });
    const { app } = await fixture(() => Date.now(), {
      scope: "program",
      readProposal: async () => ({ digest: "a".repeat(64), text: "proposal" }),
      readApprovalScope,
      close: () => {},
    });
    try {
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/approval-scope",
            headers,
          })
        ).statusCode,
      ).toBe(401);
      expect(readApprovalScope).not.toHaveBeenCalled();
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const auth = { ...headers, cookie };
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/approval-scope",
            headers: { ...auth, origin: "https://attacker.example" },
          })
        ).statusCode,
      ).toBe(403);
      const read = app.inject({
        method: "GET",
        url: "/api/kernel/approval-scope",
        headers: auth,
      });
      await readStarted;
      await app.inject({
        method: "POST",
        url: "/api/logout",
        headers: auth,
        payload: {},
      });
      release({
        digest: "a".repeat(64),
        proposalDigest: "b".repeat(64),
        text: "synthetic-private-scope",
      });
      const result = await read;
      expect(result.statusCode).toBe(401);
      expect(result.body).not.toContain("synthetic-private-scope");
      expect(readApprovalScope).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  it("uses the restored cookie expires deadline without touching the session", async () => {
    const { app, dir } = await fixture();
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const state = openState(dir);
      try {
        const row = state.db.prepare("SELECT * FROM sessions").get()!;
        const data = JSON.parse(String(row.data));
        const future = new Date(Date.now() + 3600000).toISOString();
        const past = new Date(Date.now() - 1000).toISOString();
        expect(Number(row.idle_expires)).toBeGreaterThan(Date.now());
        expect(Number(row.absolute_expires)).toBeGreaterThan(Date.now());
        for (const value of [
          { originalExpires: future, expires: past },
          { originalExpires: null, expires: "invalid" },
          { originalExpires: future, expires: null },
        ]) {
          data.cookie = { ...data.cookie, ...value };
          const encoded = JSON.stringify(data);
          state.db.prepare("UPDATE sessions SET data = ?").run(encoded);
          const result = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: { ...headers, cookie },
          });
          expect(result.statusCode).toBe(401);
          expect(result.headers["set-cookie"]).toBeUndefined();
          expect(state.db.prepare("SELECT * FROM sessions").get()).toEqual({
            ...row,
            data: encoded,
          });
        }
        data.cookie = {
          ...data.cookie,
          originalExpires: past,
          expires: future,
        };
        const encoded = JSON.stringify(data);
        state.db.prepare("UPDATE sessions SET data = ?").run(encoded);
        const passive = await app.inject({
          method: "GET",
          url: "/api/kernel/session-check",
          headers: { ...headers, cookie },
        });
        expect(passive.statusCode).toBe(200);
        expect(passive.json()).toEqual({ authenticated: true });
        expect(passive.headers["set-cookie"]).toBeUndefined();
        expect(state.db.prepare("SELECT * FROM sessions").get()).toEqual({
          ...row,
          data: encoded,
        });
        const regular = await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        });
        expect(regular.statusCode).toBe(200);
      } finally {
        state.db.close();
      }
    } finally {
      await app.close();
    }
  });
  it.each(["idle", "absolute", "revocation"])(
    "checks %s without touching sessions or issuing cookies",
    async (mode) => {
      let now = Date.now();
      const { app, dir } = await fixture(() => now);
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
        const auth = { ...headers, cookie };
        for (const supplied of [undefined, `${cookie}invalid`]) {
          const denied = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: { ...headers, ...(supplied ? { cookie: supplied } : {}) },
          });
          expect(denied.statusCode).toBe(401);
          expect(denied.headers["set-cookie"]).toBeUndefined();
        }
        const row = () => {
          const state = openState(dir, () => now);
          try {
            return state.db.prepare("SELECT * FROM sessions").get();
          } finally {
            state.db.close();
          }
        };
        const initial = row();
        for (let i = 0; i < 3; i++) {
          now += 60_000;
          const check = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: auth,
          });
          expect(check.statusCode).toBe(200);
          expect(check.headers["set-cookie"]).toBeUndefined();
          expect(check.headers["cache-control"]).toBe("no-store");
          expect(row()).toEqual(initial);
        }
        if (mode === "idle") now += 28 * 60_000;
        if (mode === "absolute") {
          const state = openState(dir, () => now);
          state.db
            .prepare(
              "UPDATE sessions SET idle_expires = absolute_expires + 60000",
            )
            .run();
          state.db.close();
          now = Number(initial!.absolute_expires) - 1;
          const before = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: auth,
          });
          expect(before.statusCode).toBe(200);
          expect(before.headers["set-cookie"]).toBeUndefined();
          now = Number(initial!.absolute_expires);
        }
        if (mode === "revocation")
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: auth,
            payload: {},
          });
        const denied = await app.inject({
          method: "GET",
          url: "/api/kernel/session-check",
          headers: auth,
        });
        expect(denied.statusCode).toBe(401);
        expect(denied.headers["set-cookie"]).toBeUndefined();
        expect(
          (
            await app.inject({
              method: "GET",
              url: "/api/kernel/session-check",
              headers: { ...auth, origin: "https://attacker.example" },
            })
          ).statusCode,
        ).toBe(403);
      } finally {
        await app.close();
      }
    },
  );
  it.each(["logout", "expiry"])(
    "denies a proposal after %s during the read",
    async (mode) => {
      let now = Date.now();
      let release!: (value: { digest: string; text: string }) => void;
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const closed = vi.fn();
      const { app } = await fixture(() => now, {
        scope: "synthetic",
        close: closed,
        readProposal: () => {
          start();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      });
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
        const auth = { ...headers, cookie };
        const pending = app.inject({
          method: "GET",
          url: "/api/kernel/owner",
          headers: auth,
        });
        await started;
        if (mode === "logout")
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: auth,
            payload: {},
          });
        else now += 31 * 60_000;
        release({ digest: "a".repeat(64), text: "synthetic-private-proposal" });
        const result = await pending;
        expect(result.statusCode).toBe(401);
        expect(result.body).not.toContain("synthetic-private-proposal");
      } finally {
        await app.close();
        expect(closed).toHaveBeenCalledOnce();
      }
    },
  );
  it("keeps Kernel owner operations unavailable despite a Console session", async () => {
    const { app } = await fixture();
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/kernel/owner", headers }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers,
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, origin: "https://attacker.example" },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(403);
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const status = await app.inject({
        method: "GET",
        url: "/api/kernel/owner",
        headers: { ...headers, cookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ status: "unavailable", actions: [] });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { host: headers.host, cookie },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(403);
      for (const action of ["approve", "stop", "unsupported"]) {
        const result = await app.inject({
          method: "POST",
          url: "/api/kernel/owner",
          headers: { ...headers, cookie },
          payload: { action, principal: "synthetic-injected-principal" },
        });
        expect(result.statusCode).toBe(503);
        expect(result.body).not.toContain("synthetic-injected-principal");
      }
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie, host: "attacker.example" },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: { ...headers, cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("enforces one-time setup, host/origin, fixation, revocation and restart persistence", async () => {
    const { app, dir, assets } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: "/api/application", headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/session",
          headers: { host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: '{"password":"synthetic-do-not-echo"',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("synthetic-do-not-echo");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/session",
          headers: { ...headers, origin: "https://attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers: { host: headers.host },
          payload: { password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token: "wrong", password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password: "incorrect" },
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(String(login.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(login.headers["set-cookie"])).toContain("SameSite=Strict");
    expect(String(login.headers["set-cookie"])).not.toContain("Secure");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(200);
    const rotated = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { ...headers, cookie },
      payload: { password },
    });
    const nextCookie = String(rotated.headers["set-cookie"]).split(";")[0]!;
    expect(nextCookie).not.toBe(cookie);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: nextCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/logout",
          headers: { ...headers, cookie: nextCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: nextCookie },
        })
      ).statusCode,
    ).toBe(401);
    await restarted.close();
  });

  it("enforces server-side idle expiration", async () => {
    let now = Date.now();
    const { app } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    now += 30 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("cannot revive expired or previously valid sessions after a clock rollback and restart", async () => {
    let now = Date.now();
    const { app, dir, assets } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const expired = String(login.headers["set-cookie"]).split(";")[0]!;
    now += 30 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: expired },
        })
      ).statusCode,
    ).toBe(401);
    now -= 29 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: expired },
        })
      ).statusCode,
    ).toBe(401);
    const next = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const active = String(next.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: active },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
    now -= 1;
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: active },
        })
      ).statusCode,
    ).toBe(401);
    await restarted.close();
  });

  it("invalidates outstanding setup authority after clock rollback", () => {
    let now = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "console-clock-"));
    directories.push(dir);
    const state = openState(dir, () => now);
    state.db
      .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
      .run("synthetic");
    state.db.close();
    now -= 1;
    const restarted = openState(dir, () => now);
    expect(
      restarted.db
        .prepare("SELECT value FROM settings WHERE name = 'bootstrap'")
        .get(),
    ).toBeUndefined();
    restarted.db.close();
  });

  it("rejects expired setup authority and persists failed-login throttling", async () => {
    let now = Date.now();
    const { app, dir, assets } = await fixture(() => now);
    now += 60_000;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
    const state = openState(dir, () => now);
    state.db
      .prepare("UPDATE settings SET value = ? WHERE name = 'bootstrap'")
      .run(
        JSON.stringify({
          digest: createHash("sha256").update(token).digest("hex"),
          expires: now + 60_000,
        }),
      );
    state.db.close();
    const server = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    await server.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/login",
            headers,
            payload: { password: "incorrect" },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(429);
    await server.close();
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(429);
    now += 60_000;
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(200);
    await restarted.close();
  });

  it("keeps browser sessions separate and enforces absolute expiry despite activity", async () => {
    let now = Date.now();
    const { app } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const one = String(first.headers["set-cookie"]).split(";")[0]!;
    let two = String(second.headers["set-cookie"]).split(";")[0]!;
    expect(one).not.toBe(two);
    await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { ...headers, cookie: one },
      payload: {},
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: one },
        })
      ).statusCode,
    ).toBe(401);
    for (let i = 0; i < 48; i++) {
      now += 29 * 60_000;
      const response = await app.inject({
        method: "GET",
        url: "/api/application",
        headers: { ...headers, cookie: two },
      });
      expect(response.statusCode).toBe(200);
      two = String(response.headers["set-cookie"]).split(";")[0]!;
    }
    for (const minutes of [28, 19]) {
      now += minutes * 60_000;
      const response = await app.inject({
        method: "GET",
        url: "/api/application",
        headers: { ...headers, cookie: two },
      });
      expect(response.statusCode).toBe(200);
      two = String(response.headers["set-cookie"]).split(";")[0]!;
    }
    now += 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: two },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("fences stale saves and stale revocation after rotation", () => {
    const dir = mkdtempSync(join(tmpdir(), "console-store-"));
    directories.push(dir);
    const state = openState(dir);
    const value = (generation: string) =>
      ({
        cookie: { originalMaxAge: null },
        __fastifySessionMetadata: { generation },
      }) as Session;
    let failure: NodeJS.ErrnoException | undefined;
    state.store.set("synthetic-id", value("first"), (error) => {
      failure = error;
    });
    expect(failure).toBeUndefined();
    state.store.compareAndSet(
      "synthetic-id",
      "first",
      value("second"),
      (error) => {
        failure = error;
      },
    );
    expect(failure).toBeUndefined();
    expect(state.revoke("synthetic-id", "first")).toBe(false);
    state.store.compareAndSet(
      "synthetic-id",
      "first",
      value("first"),
      (error) => {
        failure = error;
      },
    );
    expect(failure?.code).toBe("ENOENT");
    expect(state.revoke("synthetic-id", "second")).toBe(true);
    state.store.compareAndSet(
      "synthetic-id",
      "second",
      value("second"),
      (error) => {
        failure = error;
      },
    );
    expect(failure?.code).toBe("ENOENT");
    state.db.close();
  });

  it("issues local-only setup authority and revokes restored sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-cli-"));
    directories.push(dir);
    const env = { HOME: dir, CONSOLE_STATE_DIR: dir };
    const issued = spawnSync(
      process.execPath,
      ["server/bootstrap.ts", "issue"],
      { env, encoding: "utf8" },
    );
    expect(issued.status).toBe(0);
    const authority = readFileSync(join(dir, "bootstrap-token"), "utf8").trim();
    expect(issued.stdout).not.toContain(authority);
    expect(statSync(join(dir, "bootstrap-token")).mode & 0o777).toBe(0o600);
    const assets = join(dir, "assets");
    mkdirSync(assets);
    writeFileSync(
      join(assets, "index.html"),
      "<!doctype html><title>fixture</title>",
    );
    const app = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token: authority, password },
        })
      ).statusCode,
    ).toBe(200);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await app.close();
    expect(
      spawnSync(process.execPath, ["server/bootstrap.ts", "issue"], {
        env,
        encoding: "utf8",
      }).status,
    ).not.toBe(0);
    expect(
      spawnSync(process.execPath, ["server/bootstrap.ts", "revoke-sessions"], {
        env,
        encoding: "utf8",
      }).status,
    ).toBe(0);
    const restored = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    expect(
      (
        await restored.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await restored.close();
  });

  it("rejects unsafe state paths and HTTPS without TLS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-path-"));
    directories.push(dir);
    const outside = join(dir, "outside");
    writeFileSync(outside, "unchanged");
    const stateDir = join(dir, "state");
    mkdirSync(stateDir, { mode: 0o700 });
    symlinkSync(outside, join(stateDir, "console.sqlite"));
    expect(() => openState(stateDir)).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("unchanged");
    await expect(
      createApp({ stateDirectory: dir, origin: "https://console.example" }),
    ).rejects.toThrow("TLS");
    await expect(
      createApp({ stateDirectory: dir, origin: "http://console.example" }),
    ).rejects.toThrow("loopback");
    const incompatible = join(dir, "newer");
    const state = openState(incompatible);
    state.db.exec("PRAGMA user_version = 99");
    state.db.close();
    expect(() => openState(incompatible)).toThrow("Unsupported state version");
  });
});

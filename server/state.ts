import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Session } from "fastify";
import type { SessionStore } from "@fastify/session";
import {
  isPreparedLocalOwnerCommand,
  type ApprovalDisposition,
  type prepareLocalOwnerCommand,
} from "./kernel-owner-v1.ts";

const key = (value: string) => createHash("sha256").update(value).digest("hex");

const idleLifetime = 30 * 60_000;
const absoluteLifetime = 24 * 60 * 60_000;

export function openState(directory: string, now: () => number = Date.now) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = lstatSync(directory);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    (directoryInfo.mode & 0o077) !== 0 ||
    (process.getuid && directoryInfo.uid !== process.getuid())
  ) {
    throw new Error(
      "State directory must be owner-only and owned by the current user",
    );
  }
  const path = join(directory, "console.sqlite");
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (process.getuid && info.uid !== process.getuid())
    ) {
      throw new Error(
        "State database must be an owner-controlled regular file",
      );
    }
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3)
      throw new Error("Unsupported state version");
    if (version === 0) {
      db.exec(`
      CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, generation TEXT NOT NULL, data TEXT NOT NULL,
        idle_expires INTEGER NOT NULL, absolute_expires INTEGER NOT NULL);
      CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    }
    if (version !== 3) {
      if (version === 2)
        db.exec("ALTER TABLE owner_commands RENAME TO owner_commands_v2");
      db.exec(`
      CREATE TABLE owner_commands (
        command_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        input BLOB NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('unknown', 'historical', 'refused')),
        receipt TEXT,
        created INTEGER NOT NULL,
        producer TEXT,
        recipient TEXT,
        actor_digest TEXT,
        history_version INTEGER CHECK(history_version IN (1, 2)),
        CHECK((producer IS NULL) = (recipient IS NULL)),
        CHECK((actor_digest IS NULL) = (history_version IS NULL)),
        CHECK(history_version IS NULL OR producer IS NOT NULL)
      );`);
      if (version === 2)
        db.exec(`INSERT INTO owner_commands (command_id, scope, input, outcome, receipt, created)
        SELECT command_id, scope, input, outcome, receipt, created FROM owner_commands_v2;
      DROP TABLE owner_commands_v2;`);
      db.exec("PRAGMA user_version = 3");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.close();
    throw error;
  }

  // Keep authority closed if SQLite cannot commit a detected revocation.
  // A later clock observation must retry it even after wall time recovers.
  let clockRevocationPending = false;
  function sampleClock() {
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0)
      throw new Error("Invalid system clock");
    return current;
  }
  function recordClock(current: number, minimum = current) {
    if (current < minimum) clockRevocationPending = true;
    const row = db
      .prepare("SELECT value FROM settings WHERE name = 'clock'")
      .get();
    const previous = row ? Number(row.value) : current;
    if (!Number.isSafeInteger(previous) || previous < 0)
      throw new Error("Invalid persisted clock");
    if (current < previous) clockRevocationPending = true;
    if (clockRevocationPending) {
      db.prepare("DELETE FROM sessions").run();
      db.prepare("DELETE FROM settings WHERE name = 'bootstrap'").run();
    }
    db.prepare(
      "INSERT OR REPLACE INTO settings (name, value) VALUES ('clock', ?)",
    ).run(String(current));
  }
  function clock() {
    const current = sampleClock();
    db.exec("BEGIN IMMEDIATE");
    try {
      recordClock(current);
      db.exec("COMMIT");
      clockRevocationPending = false;
      return current;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  clock();

  function finalOwnerCommandClock(at: number) {
    // The caller holds the write fence but has made no journal changes in
    // this transaction. On regression, commit revocation alone before refusing.
    const current = sampleClock();
    recordClock(current, at);
    if (clockRevocationPending) {
      db.exec("COMMIT");
      clockRevocationPending = false;
      throw new Error("Invalid system clock");
    }
    return current;
  }

  const store: SessionStore = {
    get(id, callback) {
      try {
        const current = clock();
        db.prepare(
          "DELETE FROM sessions WHERE id = ? AND (idle_expires <= ? OR absolute_expires <= ?)",
        ).run(key(id), current, current);
        const row = db
          .prepare(
            "SELECT data FROM sessions WHERE id = ? AND idle_expires > ? AND absolute_expires > ?",
          )
          .get(key(id), current, current);
        callback(null, row ? (JSON.parse(String(row.data)) as Session) : null);
      } catch (error) {
        callback(error);
      }
    },
    set(id, session, callback) {
      try {
        const generation = (
          session as Session & {
            __fastifySessionMetadata: { generation: string };
          }
        ).__fastifySessionMetadata.generation;
        const created = clock();
        db.prepare(
          "DELETE FROM sessions WHERE idle_expires <= ? OR absolute_expires <= ?",
        ).run(created, created);
        db.prepare(
          "INSERT INTO sessions (id, generation, data, idle_expires, absolute_expires) VALUES (?, ?, ?, ?, ?)",
        ).run(
          key(id),
          key(generation),
          JSON.stringify(session),
          created + idleLifetime,
          created + absoluteLifetime,
        );
        callback();
      } catch (error) {
        callback(error);
      }
    },
    compareAndSet(id, expected, session, callback) {
      try {
        const generation = (
          session as Session & {
            __fastifySessionMetadata: { generation: string };
          }
        ).__fastifySessionMetadata.generation;
        const time = clock();
        const result = db
          .prepare(
            `UPDATE sessions SET generation = ?, data = ?,
          idle_expires = MIN(absolute_expires, MAX(idle_expires, ?))
          WHERE id = ? AND generation = ? AND idle_expires > ? AND absolute_expires > ?`,
          )
          .run(
            key(generation),
            JSON.stringify(session),
            time + idleLifetime,
            key(id),
            key(expected),
            time,
            time,
          );
        if (result.changes !== 1) {
          callback(
            Object.assign(new Error("Session revoked or changed"), {
              code: "ENOENT",
            }),
          );
          return;
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    destroy(id, callback) {
      try {
        db.prepare("DELETE FROM sessions WHERE id = ?").run(key(id));
        callback();
      } catch (error) {
        callback(error);
      }
    },
  };
  function revoke(id: string, generation: string) {
    clock();
    return (
      db
        .prepare("DELETE FROM sessions WHERE id = ? AND generation = ?")
        .run(key(id), key(generation)).changes === 1
    );
  }
  const dispatchTokens = new WeakMap<
    object,
    {
      id: string;
      generation: string;
      command: ReturnType<typeof prepareLocalOwnerCommand>;
      fresh: boolean;
    }
  >();
  let ownerJournalUsable = true;
  function currentOwnerSession(id: string, generation: string, at: number) {
    const row = db
      .prepare(
        "SELECT data FROM sessions WHERE id = ? AND generation = ? AND idle_expires > ? AND absolute_expires > ?",
      )
      .get(key(id), key(generation), at, at);
    if (!row) return false;
    const data: unknown = JSON.parse(String(row.data));
    if (
      !data ||
      typeof data !== "object" ||
      !("owner" in data) ||
      data.owner !== true ||
      !("cookie" in data)
    )
      return false;
    const cookie = data.cookie;
    if (
      !cookie ||
      typeof cookie !== "object" ||
      !("expires" in cookie) ||
      typeof cookie.expires !== "string"
    )
      return false;
    const expires = Date.parse(cookie.expires);
    return Number.isFinite(expires) && expires > at;
  }
  type Command = ReturnType<typeof prepareLocalOwnerCommand>;
  const exactCommand = `command_id = ? AND scope = ? AND input = ?
    AND producer IS ? AND recipient IS ? AND actor_digest IS ? AND history_version IS ?`;
  const commandKey = (command: Command) =>
    [
      command.commandId,
      command.scope,
      command.frame(),
      command.binding?.producer ?? null,
      command.binding?.recipient ?? null,
      command.binding?.actorDigest ?? null,
      command.binding?.historyVersion ?? null,
    ] as const;
  function ownerCommandBlocked(scope: string, producer?: string) {
    // A new recipient cannot bypass an unknown for the same producer and Program.
    // Legacy entries have no authority attribution and block that scope for anyone.
    return !!db
      .prepare(
        `SELECT 1 FROM owner_commands WHERE scope = ? AND outcome = 'unknown'
      AND (producer IS NULL OR ? IS NULL OR producer = ?)`,
      )
      .get(scope, producer ?? null, producer ?? null);
  }
  function beginOwnerCommand(
    id: string,
    generation: string,
    command: ReturnType<typeof prepareLocalOwnerCommand>,
  ) {
    if (!isPreparedLocalOwnerCommand(command))
      throw new Error("Invalid owner command");
    const at = clock();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!currentOwnerSession(id, generation, at))
        throw new Error("Session unavailable");
      if (
        command.request.action === "approve" &&
        (command.request.expires_at === undefined ||
          BigInt(command.request.expires_at) <= BigInt(Math.floor(at / 1000)))
      )
        throw new Error("Approval deadline expired");
      // Plan retention under the write fence, but do not prune before the
      // final clock check can commit a regression without journal changes.
      const count = Number(
        db.prepare("SELECT count(*) AS count FROM owner_commands").get()?.count,
      );
      const oldest =
        count === 128
          ? db
              .prepare(
                "SELECT command_id FROM owner_commands WHERE outcome != 'unknown' ORDER BY created, command_id LIMIT 1",
              )
              .get()
          : undefined;
      if (count >= 128 && !oldest)
        throw new Error("Owner command journal full");
      if (ownerCommandBlocked(command.scope, command.binding?.producer))
        throw new Error("Owner command outcome unresolved");
      const frame = command.frame();
      if (frame.length > 4096) throw new Error("Owner command too large");
      const admissionTime = finalOwnerCommandClock(at);
      if (!currentOwnerSession(id, generation, admissionTime))
        throw new Error("Session unavailable");
      if (
        command.request.action === "approve" &&
        BigInt(command.request.expires_at!) <=
          BigInt(Math.floor(admissionTime / 1000))
      )
        throw new Error("Approval deadline expired");
      if (
        oldest &&
        db
          .prepare("DELETE FROM owner_commands WHERE command_id = ?")
          .run(oldest.command_id!).changes !== 1
      )
        throw new Error("Owner command journal full");
      db.prepare(
        "INSERT INTO owner_commands (command_id, scope, input, producer, recipient, actor_digest, history_version, outcome, created) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?)",
      ).run(...commandKey(command), at);
      db.exec("COMMIT");
      const token = {};
      dispatchTokens.set(token, { id, generation, command, fresh: true });
      return token;
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  function dispatchOwnerCommand<T>(
    token: object,
    dispatch: (command: ReturnType<typeof prepareLocalOwnerCommand>) => T,
  ): T {
    const attempt = dispatchTokens.get(token);
    if (!attempt) throw new Error("Invalid owner command attempt");
    dispatchTokens.delete(token);
    let initiated = false;
    try {
      const at = clock();
      db.exec("BEGIN IMMEDIATE");
      if (!currentOwnerSession(attempt.id, attempt.generation, at))
        throw new Error("Session unavailable");
      const dispatchTime = finalOwnerCommandClock(at);
      if (!currentOwnerSession(attempt.id, attempt.generation, dispatchTime))
        throw new Error("Session unavailable");
      if (
        attempt.fresh &&
        attempt.command.request.action === "approve" &&
        (attempt.command.request.expires_at === undefined ||
          BigInt(attempt.command.request.expires_at) <=
            BigInt(Math.floor(dispatchTime / 1000)))
      )
        throw new Error("Approval deadline expired");
      // Invoke the synchronous dispatch initiation while revocation cannot overtake it.
      initiated = true;
      const result = dispatch(attempt.command);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.isTransaction) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // An unconfirmed rollback must not be followed by a deletion in the
          // same transaction: preserve the intent as uncertain.
          ownerJournalUsable = false;
          throw error;
        }
      }
      if (attempt.fresh && !initiated)
        db.prepare(
          `DELETE FROM owner_commands WHERE ${exactCommand} AND outcome = 'unknown'`,
        ).run(...commandKey(attempt.command));
      throw error;
    }
  }
  function beginOwnerReplay(
    id: string,
    generation: string,
    command: ReturnType<typeof prepareLocalOwnerCommand>,
  ) {
    if (!isPreparedLocalOwnerCommand(command))
      throw new Error("Invalid owner command");
    const at = clock();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (!currentOwnerSession(id, generation, at))
        throw new Error("Session unavailable");
      const row = db
        .prepare(
          `SELECT 1 FROM owner_commands WHERE ${exactCommand} AND outcome = 'unknown'`,
        )
        .get(...commandKey(command));
      if (!row) throw new Error("Original unknown command unavailable");
      db.exec("COMMIT");
      const token = {};
      dispatchTokens.set(token, { id, generation, command, fresh: false });
      return token;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function recordOwnerReceipt(
    command: ReturnType<typeof prepareLocalOwnerCommand>,
    observation: ApprovalDisposition,
  ) {
    if (!isPreparedLocalOwnerCommand(command))
      throw new Error("Invalid owner command");
    if (!ownerJournalUsable) throw new Error("Owner journal unavailable");
    if (
      observation.kind !== "historical-receipt-shape" &&
      observation.kind !== "terminal-refusal"
    )
      return;
    const outcome =
      observation.kind === "terminal-refusal" ? "refused" : "historical";
    if (
      observation.kind === "terminal-refusal"
        ? command.request.action !== "approve" ||
          command.binding?.historyVersion !== 2 ||
          observation.reason !== "stale-revision"
        : observation.action !== command.request.action
    )
      throw new Error("Mismatched owner receipt");
    const receipt =
      observation.kind === "terminal-refusal"
        ? null
        : JSON.stringify(observation, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
          );
    const updated = db
      .prepare(
        `UPDATE owner_commands SET outcome = ?, receipt = ? WHERE ${exactCommand} AND outcome = 'unknown'`,
      )
      .run(outcome, receipt, ...commandKey(command));
    if (
      updated.changes !== 1 &&
      !db
        .prepare(
          `SELECT 1 FROM owner_commands WHERE ${exactCommand} AND outcome = ? AND receipt IS ?`,
        )
        .get(...commandKey(command), outcome, receipt)
    )
      throw new Error("Owner receipt journal mismatch");
  }
  return {
    db,
    store,
    revoke,
    clock,
    beginOwnerCommand,
    ownerCommandBlocked,
    beginOwnerReplay,
    dispatchOwnerCommand,
    recordOwnerReceipt,
  };
}

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
  type OwnerObservation,
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
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (version !== 0 && version !== 1 && version !== 2) {
    db.close();
    throw new Error("Unsupported state version");
  }
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, generation TEXT NOT NULL, data TEXT NOT NULL,
        idle_expires INTEGER NOT NULL, absolute_expires INTEGER NOT NULL);
      CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
      COMMIT;`);
  }
  if (version === 0 || version === 1) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE owner_commands (
        command_id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        input BLOB NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('unknown', 'historical')),
        receipt TEXT,
        created INTEGER NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;`);
  }

  function clock() {
    const current = now();
    if (!Number.isSafeInteger(current) || current < 0)
      throw new Error("Invalid system clock");
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE name = 'clock'")
        .get();
      const previous = row ? Number(row.value) : current;
      if (!Number.isSafeInteger(previous) || previous < 0)
        throw new Error("Invalid persisted clock");
      if (current < previous) {
        db.prepare("DELETE FROM sessions").run();
        db.prepare("DELETE FROM settings WHERE name = 'bootstrap'").run();
      }
      db.prepare(
        "INSERT OR REPLACE INTO settings (name, value) VALUES ('clock', ?)",
      ).run(String(current));
      db.exec("COMMIT");
      return current;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  clock();

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
      // Keep unresolved intents indefinitely; only historical receipts may age out.
      db.prepare(
        "DELETE FROM owner_commands WHERE command_id = (SELECT command_id FROM owner_commands WHERE outcome = 'historical' ORDER BY created, command_id LIMIT 1) AND (SELECT count(*) FROM owner_commands) >= 128",
      ).run();
      if (
        Number(
          db.prepare("SELECT count(*) AS count FROM owner_commands").get()
            ?.count,
        ) >= 128
      )
        throw new Error("Owner command journal full");
      if (
        db
          .prepare(
            "SELECT 1 FROM owner_commands WHERE scope = ? AND outcome = 'unknown'",
          )
          .get(command.scope)
      )
        throw new Error("Owner command outcome unresolved");
      const frame = command.frame();
      if (frame.length > 4096) throw new Error("Owner command too large");
      const admissionTime = now();
      if (!Number.isSafeInteger(admissionTime) || admissionTime < at)
        throw new Error("Invalid system clock");
      if (!currentOwnerSession(id, generation, admissionTime))
        throw new Error("Session unavailable");
      if (
        command.request.action === "approve" &&
        BigInt(command.request.expires_at!) <=
          BigInt(Math.floor(admissionTime / 1000))
      )
        throw new Error("Approval deadline expired");
      db.prepare(
        "INSERT INTO owner_commands (command_id, scope, input, outcome, created) VALUES (?, ?, ?, 'unknown', ?)",
      ).run(command.commandId, command.scope, frame, at);
      db.exec("COMMIT");
      const token = {};
      dispatchTokens.set(token, { id, generation, command, fresh: true });
      return token;
    } catch (error) {
      db.exec("ROLLBACK");
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
    let inTransaction = false;
    let initiated = false;
    try {
      const at = clock();
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      if (!currentOwnerSession(attempt.id, attempt.generation, at))
        throw new Error("Session unavailable");
      const dispatchTime = now();
      if (!Number.isSafeInteger(dispatchTime) || dispatchTime < at)
        throw new Error("Invalid system clock");
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
      if (inTransaction) {
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
          "DELETE FROM owner_commands WHERE command_id = ? AND scope = ? AND input = ? AND outcome = 'unknown'",
        ).run(
          attempt.command.commandId,
          attempt.command.scope,
          attempt.command.frame(),
        );
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
          "SELECT 1 FROM owner_commands WHERE command_id = ? AND scope = ? AND input = ? AND outcome = 'unknown'",
        )
        .get(command.commandId, command.scope, command.frame());
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
    observation: OwnerObservation,
  ) {
    if (!isPreparedLocalOwnerCommand(command))
      throw new Error("Invalid owner command");
    if (!ownerJournalUsable) throw new Error("Owner journal unavailable");
    if (observation.kind !== "historical-receipt-shape") return;
    if (observation.action !== command.request.action)
      throw new Error("Mismatched owner receipt");
    const receipt = JSON.stringify(observation, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    const updated = db
      .prepare(
        "UPDATE owner_commands SET outcome = 'historical', receipt = ? WHERE command_id = ? AND scope = ? AND input = ? AND outcome = 'unknown'",
      )
      .run(receipt, command.commandId, command.scope, command.frame());
    if (
      updated.changes !== 1 &&
      !db
        .prepare(
          "SELECT 1 FROM owner_commands WHERE command_id = ? AND scope = ? AND input = ? AND outcome = 'historical' AND receipt = ?",
        )
        .get(command.commandId, command.scope, command.frame(), receipt)
    )
      throw new Error("Owner receipt journal mismatch");
  }
  return {
    db,
    store,
    revoke,
    clock,
    beginOwnerCommand,
    beginOwnerReplay,
    dispatchOwnerCommand,
    recordOwnerReceipt,
  };
}

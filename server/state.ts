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
  if (version !== 0 && version !== 1) {
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

  const store: SessionStore = {
    get(id, callback) {
      try {
        const row = db
          .prepare(
            "SELECT data FROM sessions WHERE id = ? AND idle_expires > ? AND absolute_expires > ?",
          )
          .get(key(id), now(), now());
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
        const created = now();
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
        const time = now();
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
    return (
      db
        .prepare("DELETE FROM sessions WHERE id = ? AND generation = ?")
        .run(key(id), key(generation)).changes === 1
    );
  }
  return { db, store, revoke };
}

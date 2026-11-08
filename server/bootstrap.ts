import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openState } from "./state.ts";

if (
  !["issue", "revoke-sessions"].includes(process.argv[2] ?? "") ||
  process.argv.length !== 3
) {
  throw new Error("Usage: node server/bootstrap.ts issue|revoke-sessions");
}

const directory =
  process.env.CONSOLE_STATE_DIR ??
  join(homedir(), ".local", "share", "creatidy-console");
const path = join(directory, "bootstrap-token");
const { db } = openState(directory);
if (process.argv[2] === "revoke-sessions") {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM sessions").run();
    db.prepare(
      "INSERT OR REPLACE INTO settings (name, value) VALUES ('signing_key', ?)",
    ).run(randomBytes(32).toString("base64url"));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
  console.log(
    "All sessions revoked. Restart the application server before using it.",
  );
  process.exit(0);
}
try {
  db.exec("BEGIN IMMEDIATE");
  if (db.prepare("SELECT id FROM owner WHERE id = 1").get()) {
    throw new Error("Owner already exists");
  }
  const token = randomBytes(32).toString("base64url");
  writeFileSync(path, `${token}\n`, { mode: 0o600, flag: "wx" });
  try {
    const digest = createHash("sha256").update(token).digest("hex");
    db.prepare(
      "INSERT OR REPLACE INTO settings (name, value) VALUES ('bootstrap', ?)",
    ).run(JSON.stringify({ digest, expires: Date.now() + 15 * 60_000 }));
    db.exec("COMMIT");
  } catch (error) {
    unlinkSync(path);
    throw error;
  }
  console.log(`Bootstrap authority written to ${path}; expires in 15 minutes.`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

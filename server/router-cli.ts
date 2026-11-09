import { randomBytes } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openState } from "./state.ts";
import { validateRouterOrigin } from "./router-config.ts";

const operation = process.argv[2];
if (!(
  (operation === "set" && process.argv.length === 4) ||
  (operation === "clear" && process.argv.length === 3)
)) {
  throw new Error(
    "Usage: node server/router-cli.ts set <loopback-origin> < credential-file; or clear",
  );
}
const directory =
  process.env.CONSOLE_STATE_DIR ??
  join(homedir(), ".local", "share", "creatidy-console");
const state = openState(directory);
try {
  if (!state.db.prepare("SELECT id FROM owner WHERE id = 1").get())
    throw new Error("Set up the Console owner first");
} finally {
  state.db.close();
}
const path = join(directory, "router.json");
if (operation === "clear") {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  console.log("Router connection removed.");
} else {
  const origin = validateRouterOrigin(process.argv[3]!);
  if (process.stdin.isTTY)
    throw new Error(
      "Provide the observer credential through standard input, not the terminal or command line",
    );
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const part = Buffer.from(chunk);
    length += part.length;
    if (length > 4098) throw new Error("Invalid observer credential");
    chunks.push(part);
  }
  const credential = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (!/^[\x21-\x7e]{16,4096}$/.test(credential))
    throw new Error("Invalid observer credential");
  const temporary = join(
    directory,
    `.router-${randomBytes(16).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temporary, JSON.stringify({ origin, credential }), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  console.log("Router connection configured. Refresh it from Console.");
}

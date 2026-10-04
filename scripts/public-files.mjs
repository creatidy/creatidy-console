import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function publicFiles() {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  ).split("\0");
  const files = [];
  for (const path of new Set(paths.filter(Boolean))) {
    try {
      if ((await stat(resolve(root, path))).isFile()) files.push(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files.sort();
}

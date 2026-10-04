import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { publicFiles, root } from "./public-files.mjs";

const files = await publicFiles();
const commands = {
  format: {
    binary: "prettier/bin/prettier.cjs",
    args: ["--check", "--ignore-unknown", ...files],
  },
  markdown: {
    binary: "markdownlint-cli2/markdownlint-cli2-bin.mjs",
    args: files.filter((path) => path.endsWith(".md")),
  },
  secrets: { binary: "secretlint/bin/secretlint.js", args: files },
};
const command = commands[process.argv[2]];
if (!command) throw new Error("Expected format, markdown, or secrets");

const result = spawnSync(
  process.execPath,
  [resolve(root, "node_modules", command.binary), ...command.args],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

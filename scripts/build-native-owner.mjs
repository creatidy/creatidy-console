import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { root } from "./public-files.mjs";

if (process.platform !== "linux" || process.version !== "v24.19.0") {
  throw new Error("Native owner receiver requires Linux and Node 24.19.0");
}
if (process.argv.length > 3)
  throw new Error("Expected at most one output path");
const include = resolve(dirname(process.execPath), "../include/node");
const version = readFileSync(join(include, "node_version.h"), "utf8");
for (const line of [
  "#define NODE_MAJOR_VERSION 24",
  "#define NODE_MINOR_VERSION 19",
  "#define NODE_PATCH_VERSION 0",
]) {
  if (!version.split("\n").includes(line))
    throw new Error("Node header version mismatch");
}
const output = resolve(
  process.argv[2] ?? join(root, ".cache/native/owner-receiver.node"),
);
mkdirSync(dirname(output), { recursive: true });
const temporary = mkdtempSync(join(dirname(output), ".owner-build-"));
try {
  const binary = join(temporary, "receiver.node");
  const result = spawnSync(
    "cc",
    [
      "-std=c11",
      "-O2",
      "-fPIC",
      "-fvisibility=hidden",
      "-shared",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-DNAPI_VERSION=8",
      `-I${include}`,
      join(root, "native/owner-receiver.c"),
      "-o",
      binary,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Native owner receiver build failed");
  renameSync(binary, output);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

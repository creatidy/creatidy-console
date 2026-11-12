import { spawnSync } from "node:child_process";
import { fstatSync, readFileSync, readlinkSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const native = require(process.argv[2]);
try {
  require(process.argv[3]).clear();
  const before = Number.parseInt(
    /flags:\s*([0-7]+)/.exec(readFileSync("/proc/self/fdinfo/3", "utf8"))[1],
    8,
  );
  native.receive(3);
  const flags = Number.parseInt(
    /flags:\s*([0-7]+)/.exec(readFileSync("/proc/self/fdinfo/3", "utf8"))[1],
    8,
  );
  const socket = readlinkSync("/proc/self/fd/3");
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "try{process.exit(require('node:fs').readlinkSync('/proc/self/fd/3')===process.argv[1]?1:0)}catch{process.exit(0)}",
      socket,
    ],
    {
      env: { PATH: process.env.PATH },
      stdio: "ignore",
    },
  );
  process.stdout.write(
    JSON.stringify({
      before: (before & 0o2000000) !== 0,
      cloexec: (flags & 0o2000000) !== 0,
      child: child.status,
    }) + "\n",
  );
  const { validateInheritedOwnerChannel } =
    await import("../../server/kernel-owner-receiver.ts");
  await validateInheritedOwnerChannel(
    3,
    { scope: "program-1", producer: "kernel-1", recipient: "console-1" },
    300,
  );
  process.stdout.write("validated\n");
} catch {
  let closed = false;
  try {
    fstatSync(3);
  } catch {
    closed = true;
  }
  process.stdout.write(JSON.stringify({ refused: true, closed }) + "\n");
  process.exitCode = 1;
}

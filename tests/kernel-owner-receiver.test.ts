import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const temporary = mkdtempSync(join(tmpdir(), "console-owner-test-"));
const addon = join(temporary, "receiver.node");
const helper = join(temporary, "test-helper.node");
const appRoot = join(temporary, "app");
const startupAddon = join(appRoot, ".cache/native/owner-receiver.node");
const env = { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary };

function frame(scope = "program-1") {
  const payload = Buffer.from(
    JSON.stringify({
      contract: "creatidy-kernel-owner-descriptor-v1",
      wire_version: 1,
      role: "owner",
      scope,
      producer: "kernel-1",
      recipient: "console-1",
    }),
  );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}

function collect(child: ChildProcess) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      let stdout = "",
        stderr = "";
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

describe.skipIf(process.platform !== "linux")("native owner receiver", () => {
  beforeAll(() => {
    mkdirSync(appRoot);
    cpSync("server", join(appRoot, "server"), { recursive: true });
    copyFileSync("package.json", join(appRoot, "package.json"));
    symlinkSync(resolve("node_modules"), join(appRoot, "node_modules"), "dir");
    const include = resolve(dirname(process.execPath), "../include/node");
    const fixtureBuild = spawnSync(
      "cc",
      [
        "-std=c11",
        "-fPIC",
        "-shared",
        "-Wall",
        "-Wextra",
        "-Werror",
        `-I${include}`,
        "tests/fixtures/clear-cloexec.c",
        "-o",
        helper,
      ],
      { env, encoding: "utf8" },
    );
    expect(fixtureBuild.status, fixtureBuild.stderr).toBe(0);
    const built = spawnSync(
      process.execPath,
      ["scripts/build-native-owner.mjs", addon],
      { env, encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);
    const startupBuild = spawnSync(
      process.execPath,
      ["scripts/build-native-owner.mjs", startupAddon],
      { env, encoding: "utf8" },
    );
    expect(startupBuild.status, startupBuild.stderr).toBe(0);
    expect(readFileSync(startupAddon)).toEqual(readFileSync(addon));
  });
  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  function child(fd: "pipe" | number = "pipe") {
    return spawn(
      process.execPath,
      ["tests/fixtures/owner-receiver-child.mjs", addon, helper],
      {
        env,
        stdio: ["ignore", "pipe", "pipe", fd],
      },
    );
  }

  it("protects an inherited connected Unix stream before reading and accepts a fragmented greeting", async () => {
    const process = child();
    const result = collect(process);
    const channel = process.stdio[3];
    if (!channel || !("write" in channel))
      throw new Error("Missing synthetic channel");
    const greeting = frame();
    channel.write(greeting.subarray(0, 2));
    channel.write(greeting.subarray(2));
    const output = await result;
    expect(output.code, output.stderr).toBe(0);
    expect(output.stdout).toContain(
      '{"before":false,"cloexec":true,"child":0}',
    );
    expect(output.stdout).toContain("validated");
  });

  it("closes a non-socket descriptor on refusal", async () => {
    const file = openSync(join(temporary, "file"), "w+");
    try {
      const output = await collect(child(file));
      expect(output.code).toBe(1);
      expect(output.stdout).toContain('{"refused":true,"closed":true}');
    } finally {
      closeSync(file);
    }
  });

  it("rejects and closes a connected TCP stream", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing test address");
    const accepted = new Promise<import("node:net").Socket>((resolve) =>
      server.once("connection", resolve),
    );
    const client = createConnection(address.port, "127.0.0.1");
    const socket = await accepted;
    try {
      const fd = (socket as unknown as { _handle: { fd: number } })._handle.fd;
      const output = await collect(child(fd));
      expect(output.code).toBe(1);
      expect(output.stdout).toContain('{"refused":true,"closed":true}');
    } finally {
      client.destroy();
      socket.destroy();
      server.close();
    }
  });

  it("rejects a listening Unix socket and preserves standard descriptors", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(join(temporary, "listener.sock"), resolve),
    );
    try {
      const fd = (server as unknown as { _handle: { fd: number } })._handle.fd;
      const output = await collect(child(fd));
      expect(output.code).toBe(1);
      expect(output.stdout).toContain('{"refused":true,"closed":true}');
      const standard = spawnSync(
        process.execPath,
        [
          "-e",
          "const n=require(process.argv[1]);try{n.receive(0)}catch{};require('node:fs').fstatSync(0)",
          addon,
        ],
        { env, stdio: "ignore" },
      );
      expect(standard.status).toBe(0);
    } finally {
      server.close();
    }
  });

  it("rejects a mismatched greeting and a stalled channel", async () => {
    const mismatch = child();
    const mismatchResult = collect(mismatch);
    const channel = mismatch.stdio[3];
    if (!channel || !("write" in channel))
      throw new Error("Missing synthetic channel");
    channel.write(frame("other"));
    const mismatchOutput = await mismatchResult;
    expect(mismatchOutput.code).toBe(1);
    expect(mismatchOutput.stdout).toContain('{"refused":true,"closed":true}');
    const stalled = child();
    expect((await collect(stalled)).code).toBe(1);
    const oversized = child();
    const oversizedResult = collect(oversized);
    const oversizedChannel = oversized.stdio[3];
    if (!oversizedChannel || !("write" in oversizedChannel))
      throw new Error("Missing synthetic channel");
    oversizedChannel.write(Buffer.from([0, 1, 0, 1]));
    expect((await oversizedResult).code).toBe(1);
    const truncated = child();
    const truncatedResult = collect(truncated);
    const truncatedChannel = truncated.stdio[3];
    if (!truncatedChannel || !("end" in truncatedChannel))
      throw new Error("Missing synthetic channel");
    truncatedChannel.end(Buffer.from([0, 0]));
    const result = await truncatedResult;
    expect(result.code).toBe(1);
    expect(result.stderr).not.toContain("RangeError");
  });

  it("runs the opt-in startup greeting gate and sends no channel data", async () => {
    const launch = (scope: string) =>
      spawn(process.execPath, ["server/main.ts", "3"], {
        cwd: appRoot,
        env: {
          ...env,
          CONSOLE_KERNEL_OWNER: "1",
          CONSOLE_KERNEL_OWNER_SCOPE: scope,
          CONSOLE_KERNEL_OWNER_PRODUCER: "kernel-1",
          CONSOLE_KERNEL_OWNER_RECIPIENT: "console-1",
          CONSOLE_ORIGIN: "invalid",
        },
        stdio: ["ignore", "pipe", "pipe", "pipe"],
      });
    for (const [scope, error] of [
      ["program-1", "Invalid URL"],
      ["other", "Invalid owner greeting"],
    ]) {
      const process = launch(scope!);
      const result = collect(process);
      const channel = process.stdio[3];
      if (!channel || !("write" in channel))
        throw new Error("Missing synthetic channel");
      let received = 0;
      channel.on("data", (data: Buffer) => {
        received += data.length;
      });
      channel.write(frame());
      const output = await result;
      expect(output.code).not.toBe(0);
      expect(output.stderr).toContain(error);
      expect(received).toBe(0);
    }
  });
});

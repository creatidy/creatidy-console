import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { openState } from "../server/state.ts";
import { createLocalOwnerTransport } from "../server/kernel-owner-transport.ts";
import { prepareLocalOwnerCommand } from "../server/kernel-owner-v1.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function frame(value: unknown) {
  const body = Buffer.from(JSON.stringify(value));
  const result = Buffer.alloc(body.length + 4);
  result.writeUInt32BE(body.length);
  body.copy(result, 4);
  return result;
}
function response(result: unknown) {
  return frame({ version: 1, ok: true, result });
}
async function pair(
  handler: (socket: Socket, request: Record<string, unknown>) => void,
) {
  const dir = await mkdtemp(join(tmpdir(), "console-owner-test-"));
  const path = join(dir, "socket");
  const sockets = new Set<Socket>();
  const requests: Record<string, unknown>[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    let data = Buffer.alloc(0);
    socket.on("data", (part: Buffer) => {
      data = Buffer.concat([data, part]);
      while (data.length >= 4 && data.length >= 4 + data.readUInt32BE()) {
        const size = data.readUInt32BE();
        const request = JSON.parse(
          data.subarray(4, 4 + size).toString(),
        ) as Record<string, unknown>;
        data = data.subarray(4 + size);
        requests.push(request);
        handler(socket, request);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const client = createConnection(path);
  await new Promise<void>((resolve) => client.once("connect", resolve));
  cleanups.push(async () => {
    client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  return { client, requests };
}
function proposal(size: number) {
  const subject = {
    origin: "https://example.test",
    repository: "a/b",
    issue: 1,
    branch: "main",
    base: "a".repeat(40),
  };
  const declaration = JSON.stringify({
    version: 1,
    outcome: "x",
    criteria: ["x"],
    quality: [],
    interface: [],
    context: [],
    unknowns: [],
    paths: [],
    network: [],
    effects: [],
    recipes: ["x"],
    provenance: ["x"],
  });
  return Buffer.from(
    JSON.stringify({
      version: 1,
      kind: "ordinary-program-proposal",
      program: "program",
      objective: "x".repeat(size),
      drafts: [
        {
          kind: "ordinary-draft",
          version: 1,
          task_id: "x",
          revision: 1,
          parent_digest: null,
          declaration,
          evidence: {
            subject,
            issue_digest: "x",
            issue_updated: "x",
            issue_state: "x",
            source: "x",
            recipe_digest: "x",
            baseline_producer: "x",
            baseline_reference: "x",
            baseline_result: "x",
            relevance_producer: "x",
            relevance_reference: "x",
            relevance_proof: "x",
            disposition: "work_remains",
          },
          observed_at: 1,
        },
      ],
      dependencies: [
        {
          subject,
          required: [],
          reference: "x",
          complete: true,
          observed_at: 1,
          fresh_until: 2,
        },
      ],
    }),
  );
}
function chunk(raw: Buffer, offset: number, digest: string) {
  const bytes = raw.subarray(offset, offset + 8192);
  return {
    version: 1,
    digest,
    offset,
    bytes: raw.length,
    data_base64: bytes.toString("base64"),
    complete: offset + bytes.length === raw.length,
  };
}

it("reads fragmented chunks over 1 MiB sequentially without sending before a call", async () => {
  const raw = proposal(1024 * 1024 + 1);
  const digest = createHash("sha256").update(raw).digest("hex");
  const { client, requests } = await pair((socket, request) => {
    const offset = request.offset as number;
    expect(request).toEqual({
      version: 1,
      action: "proposal-chunk",
      offset,
      proposal_digest: offset ? digest : null,
    });
    const result = response(chunk(raw, offset, digest));
    socket.write(result.subarray(0, 2));
    socket.write(result.subarray(2, 9));
    socket.write(result.subarray(9));
  });
  const transport = createLocalOwnerTransport(client, "program", 10000);
  expect(requests).toHaveLength(0);
  const result = await transport.readProposal();
  expect(result.digest).toBe(digest);
  expect(result.text).toBe(raw.toString());
  expect(requests.length).toBeGreaterThan(128);
  transport.close();
});

it("serializes commands and preserves uncertainty on EOF without retries", async () => {
  const { client, requests } = await pair((socket) => socket.end());
  const transport = createLocalOwnerTransport(client, "program", 500);
  const command = prepareLocalOwnerCommand(
    "program",
    { action: "stop", expected_revision: 1, reason: "sensitive" },
    () => "retained-id",
  );
  const first = transport.sendCommand(command);
  expect(await transport.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(await first).toEqual({ kind: "unknown" });
  expect(await transport.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(requests).toHaveLength(1);
  expect(requests[0]?.command_id).toBe(command.commandId);
});

it("rejects forged command objects without writing to the channel", async () => {
  const { client, requests } = await pair(() => {});
  const transport = createLocalOwnerTransport(client, "program");
  const forged = {
    commandId: "forged",
    request: {},
    frame: () => frame({ version: 1, action: "arbitrary" }),
  } as ReturnType<typeof prepareLocalOwnerCommand>;
  await expect(transport.sendCommand(forged)).rejects.toThrow(
    "Invalid owner command",
  );
  expect(requests).toHaveLength(0);
  transport.close();
});

it("never writes a command prepared for a different bound scope", async () => {
  const receipt = {
    version: 1,
    status: "accepted",
    settlement: "unknown",
    authority: "historical-only",
  };
  const { client, requests } = await pair((socket) =>
    socket.write(response(receipt)),
  );
  const write = vi.spyOn(client, "write");
  const transport = createLocalOwnerTransport(client, "program-b");
  const wrong = prepareLocalOwnerCommand(
    "program-a",
    { action: "stop", expected_revision: 1, reason: "synthetic" },
    () => "same-id",
  );
  expect(await transport.sendCommand(wrong)).toEqual({ kind: "unknown" });
  expect(write).not.toHaveBeenCalled();
  expect(requests).toHaveLength(0);
  const right = prepareLocalOwnerCommand(
    "program-b",
    { action: "stop", expected_revision: 1, reason: "synthetic" },
    () => "same-id",
  );
  expect((await transport.sendCommand(right)).kind).toBe(
    "historical-receipt-shape",
  );
  expect(requests).toEqual([right.request]);
  expect(requests[0]).not.toHaveProperty("scope");
  transport.close();
});

it("waits for a backpressured write and closes a stalled write on deadline", async () => {
  const receipt = {
    version: 1,
    status: "accepted",
    settlement: "unknown",
    authority: "historical-only",
  };
  const pair1 = await pair((socket) => socket.write(response(receipt)));
  pair1.client.cork();
  const channel = createLocalOwnerTransport(pair1.client, "program", 500);
  const pending = channel.sendCommand(
    prepareLocalOwnerCommand("program", {
      action: "start-managed",
      expected_revision: 1,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(pair1.requests).toHaveLength(0);
  pair1.client.uncork();
  expect((await pending).kind).toBe("historical-receipt-shape");
  channel.close();

  const pair2 = await pair(() => {});
  pair2.client.cork();
  const stalled = createLocalOwnerTransport(pair2.client, "program", 20);
  expect(
    await stalled.sendCommand(
      prepareLocalOwnerCommand("program", {
        action: "start-managed",
        expected_revision: 1,
      }),
    ),
  ).toEqual({ kind: "unknown" });
  expect(pair2.client.destroyed).toBe(true);
  expect(pair2.requests).toHaveLength(0);
});

it("supports sequential commands and rejects unsolicited coalesced responses", async () => {
  const receipt = {
    version: 1,
    status: "accepted",
    settlement: "unknown",
    authority: "historical-only",
  };
  const { client, requests } = await pair((socket) =>
    socket.write(response(receipt)),
  );
  const transport = createLocalOwnerTransport(client, "program");
  const command = prepareLocalOwnerCommand("program", {
    action: "start-managed",
    expected_revision: 1,
  });
  expect((await transport.sendCommand(command)).kind).toBe(
    "historical-receipt-shape",
  );
  expect((await transport.sendCommand(command)).kind).toBe(
    "historical-receipt-shape",
  );
  expect(requests).toHaveLength(2);
  transport.close();
  const other = await pair((socket) =>
    socket.write(Buffer.concat([response(receipt), response(receipt)])),
  );
  const channel = createLocalOwnerTransport(other.client, "program");
  expect(await channel.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(await channel.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(other.requests).toHaveLength(1);
});

it("closes on changed chunks, oversized lengths and timeout without leaking data", async () => {
  const raw = proposal(9000);
  const digest = createHash("sha256").update(raw).digest("hex");
  const changed = await pair((socket, request) =>
    socket.write(
      response(
        chunk(
          raw,
          request.offset as number,
          request.offset ? "b".repeat(64) : digest,
        ),
      ),
    ),
  );
  const channel = createLocalOwnerTransport(changed.client, "program");
  await expect(channel.readProposal()).rejects.toThrow(
    "Owner channel unavailable",
  );
  expect(changed.requests).toHaveLength(2);
  const malicious = await pair((socket) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(0xffffffff);
    socket.write(header);
  });
  await expect(
    createLocalOwnerTransport(malicious.client, "program").readProposal(),
  ).rejects.toThrow("Owner channel unavailable");
  const stalled = await pair(() => {});
  const timed = createLocalOwnerTransport(stalled.client, "program", 20);
  await expect(timed.readProposal()).rejects.toThrow(
    "Owner channel unavailable",
  );
  expect(stalled.client.destroyed).toBe(true);
});

it("rejects truncated frames and oversized proposal aggregates", async () => {
  const truncated = await pair((socket) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(100);
    socket.end(Buffer.concat([header, Buffer.from("partial")]));
  });
  await expect(
    createLocalOwnerTransport(truncated.client, "program").readProposal(),
  ).rejects.toThrow("Owner channel unavailable");
  const oversized = await pair((socket) => {
    socket.write(
      response({
        version: 1,
        digest: "a".repeat(64),
        offset: 0,
        bytes: 4 * 1024 * 1024 + 1,
        data_base64: "",
        complete: false,
      }),
    );
  });
  await expect(
    createLocalOwnerTransport(oversized.client, "program").readProposal(),
  ).rejects.toThrow("Owner channel unavailable");
  expect(oversized.requests).toHaveLength(1);
});

it("serves verified socket proposals only to current sessions and coalesces concurrent reads", async () => {
  const raw = proposal(9000);
  const digest = createHash("sha256").update(raw).digest("hex");
  let release: (() => void) | undefined;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { client, requests } = await pair((socket, request) => {
    const send = () =>
      socket.write(response(chunk(raw, request.offset as number, digest)));
    if (requests.length === 1) {
      release = send;
      started();
    } else send();
  });
  const channel = createLocalOwnerTransport(client, "program");
  const dir = await mkdtemp(join(tmpdir(), "console-owner-app-"));
  const assets = join(dir, "assets");
  mkdirSync(assets);
  const state = openState(dir);
  state.db
    .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
    .run(
      JSON.stringify({
        digest: createHash("sha256").update("synthetic-token").digest("hex"),
        expires: Date.now() + 60000,
      }),
    );
  state.db.close();
  const origin = "http://127.0.0.1:4173";
  const headers = { host: "127.0.0.1:4173", origin };
  const app = await createApp({
    stateDirectory: dir,
    staticDirectory: assets,
    origin,
    kernelOwner: {
      scope: "program",
      readProposal: channel.readProposal,
      close: channel.close,
    },
  });
  try {
    expect(
      (await app.inject({ method: "GET", url: "/api/kernel/owner", headers }))
        .statusCode,
    ).toBe(401);
    expect(requests).toHaveLength(0);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token: "synthetic-token", password: "synthetic-password" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password: "synthetic-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const auth = { ...headers, cookie };
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/kernel/owner",
          headers: { ...auth, origin: "https://attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    const first = app.inject({
      method: "GET",
      url: "/api/kernel/owner",
      headers: auth,
    });
    await waiting;
    const second = app.inject({
      method: "GET",
      url: "/api/kernel/owner",
      headers: auth,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release!();
    const [a, b] = await Promise.all([first, second]);
    expect(a.json()).toEqual({
      status: "connected",
      actions: [],
      scope: "program",
      digest,
      text: raw.toString(),
    });
    expect(b.json()).toEqual(a.json());
    expect(a.headers["cache-control"]).toBe("no-store");
    expect(requests).toHaveLength(2);
    expect(
      requests.every((request) => request.action === "proposal-chunk"),
    ).toBe(true);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/kernel/owner",
          headers: auth,
          payload: { action: "approve" },
        })
      ).statusCode,
    ).toBe(503);
    expect(requests).toHaveLength(2);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

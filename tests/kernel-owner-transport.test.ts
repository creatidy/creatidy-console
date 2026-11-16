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
import {
  parseOwnerJson,
  prepareLocalOwnerCommand,
} from "../server/kernel-owner-v1.ts";

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
        const request = parseOwnerJson(
          data.subarray(4, 4 + size).toString("utf8"),
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

function snapshot() {
  const names = [
    "work_units",
    "attempts",
    "reservations",
    "claims",
    "correlations",
    "decisions",
    "usage_subtotals",
  ];
  return {
    version: 1,
    producer: "a".repeat(32),
    scope: "program",
    program_revision: 4,
    spec_digest: "b".repeat(64),
    status: "running",
    work_units: [] as unknown[],
    attempts: [] as unknown[],
    reservations: [],
    commands: [] as unknown[],
    command_coverage: [0, 0, true],
    claims: [],
    correlations: [] as unknown[],
    decisions: [] as unknown[],
    usage_subtotals: [],
    budget_configured: false,
    budget_revoked: null,
    authority: {},
    missing_usage: "unknown",
    route_identity: null,
    physical_settlement: null,
    page: 0,
    coverage: Object.fromEntries(names.map((name) => [name, [0, 0, true]])),
    position: { producer: "a".repeat(32), scope: "program", sequence: 3 },
  };
}

it("reads a bounded snapshot without exposing command data", async () => {
  const item = snapshot();
  const { client, requests } = await pair((socket) =>
    socket.write(response(item)),
  );
  const channel = createLocalOwnerTransport(client, "program");
  const result = await channel.readSnapshot();
  expect(requests).toEqual([{ version: 1, action: "snapshot", page: 0 }]);
  expect(result).toEqual({
    scope: "program",
    epoch: "a".repeat(32),
    sequence: "3",
    revision: "4",
    startPage: 0,
    status: "running",
    history: "initial",
    counts: Object.fromEntries(
      Object.keys(item.coverage).map((name) => [
        name,
        { sampled: 0, total: 0 },
      ]),
    ),
    workUnits: [],
    attempts: [],
    decisions: [],
    correlations: [],
    commandCoverage: { sampled: 0, total: 0, complete: true },
  });
  expect(result).not.toHaveProperty("commands");
  channel.close();
});

it("rejects inconsistent snapshot scope or coverage", async () => {
  const wrong = snapshot();
  wrong.position.scope = "other";
  const first = await pair((socket) => socket.write(response(wrong)));
  await expect(
    createLocalOwnerTransport(first.client, "program").readSnapshot(),
  ).rejects.toThrow();
  const bad = snapshot();
  bad.coverage.work_units = [0, 9, true];
  const second = await pair((socket) => socket.write(response(bad)));
  await expect(
    createLocalOwnerTransport(second.client, "program").readSnapshot(),
  ).rejects.toThrow();
});

it.each([
  ["non-ASCII", "\u00e9", "\\u00e9"],
  ["DEL", "\u007f", "\\u007f"],
])(
  "verifies oversized %s scope markers and cursors",
  async (_name, char, escaped) => {
    const scope = char.repeat(800);
    const encoded = `"${escaped.repeat(800)}"`;
    const digest = createHash("sha256").update(encoded).digest("hex");
    const item = {
      ...snapshot(),
      scope: {
        oversized: true,
        index: 0,
        bytes: Buffer.byteLength(encoded),
        sha256: digest,
      },
      position: {
        producer: "a".repeat(32),
        scope: `sha256:${digest}`,
        sequence: 3,
      },
    };
    const { client, requests } = await pair((socket, request) => {
      if (request.action === "snapshot") socket.write(response(item));
      else
        socket.write(
          response({ events: [], position: item.position, gap: false }),
        );
    });
    const channel = createLocalOwnerTransport(client, scope);
    expect((await channel.readSnapshot()).scope).toBe(scope);
    expect((await channel.readSnapshot()).history).toBe("continuous");
    expect(requests[2]?.after).toEqual(item.position);
    channel.close();
  },
);

it("exposes bounded work and attempt facts while marking oversized records", async () => {
  const item = snapshot();
  item.work_units = [
    ["work-a", "ready", null, null],
    { oversized: true, index: 1, bytes: 4097, sha256: "c".repeat(64) },
  ];
  item.attempts = [["attempt-a", "work-a", "running", "actor-a"]];
  item.coverage.work_units = [0, 2, true];
  item.coverage.attempts = [0, 1, true];
  const { client } = await pair((socket) => socket.write(response(item)));
  const channel = createLocalOwnerTransport(client, "program");
  const result = await channel.readSnapshot();
  expect(result.workUnits).toEqual([["work-a", "ready", null, null], null]);
  expect(result.attempts).toEqual([
    ["attempt-a", "work-a", "running", "actor-a"],
  ]);
  channel.close();
});

it("retains sampled decision facts and distinguishes incomplete command coverage", async () => {
  const { client, requests } = await pair((socket, request) => {
    if (request.action === "events") {
      socket.write(
        response({
          events: [],
          position: { producer: "a".repeat(32), scope: "program", sequence: 3 },
          gap: true,
        }),
      );
      return;
    }
    const page = request.page as number;
    const item = snapshot();
    item.page = page;
    item.commands = [["id", "report", "actor", "accepted", "recorded"]];
    item.command_coverage = [1, 2, false];
    item.decisions = Array.from({ length: page === 8 ? 1 : 8 }, (_, index) => ({
      source: "served-command",
      command_id: `command-${page * 8 + index}`,
      attempt: null,
      status: "review_unknown",
      applicability: "unknown",
    }));
    item.coverage.decisions = [page * 8, 65, page === 8];
    socket.write(response(item));
  });
  const channel = createLocalOwnerTransport(client, "program");
  const result = await channel.readSnapshot();
  expect(requests.map((request) => request.page)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
  expect(result.commandCoverage).toEqual({
    sampled: 1,
    total: 2,
    complete: false,
  });
  expect(result.decisions).toHaveLength(64);
  const next = await channel.readSnapshot({
    page: 8,
    epoch: result.epoch,
    sequence: result.sequence,
  });
  expect(next.decisions).toHaveLength(1);
  expect(next.decisions[0]).toEqual({
    source: "served-command",
    status: "review_unknown",
    applicability: "unknown",
    attempt: null,
    commandId: "command-64",
  });
  channel.close();
});

it.each(["source", "applicability"])(
  "rejects non-string decision %s",
  async (field) => {
    const item = snapshot();
    const row: Record<string, unknown> = {
      source: "served-command",
      command_id: "cmd",
      attempt: null,
      status: "review_unknown",
      applicability: "unknown",
    };
    row[field] = [row[field]];
    item.decisions = [row];
    item.coverage.decisions = [0, 1, true];
    const { client } = await pair((socket) => socket.write(response(item)));
    await expect(
      createLocalOwnerTransport(client, "program").readSnapshot(),
    ).rejects.toThrow();
  },
);

it("presents only producer correlation fields and hides opaque handles", async () => {
  const item = snapshot();
  item.correlations = [
    {
      attempt: "attempt-a",
      workspace_reference: "workspace-a",
      candidate_head: null,
      candidate_scope: "scope-a",
      runtime_handle: "synthetic-private-handle",
    },
  ];
  item.coverage.correlations = [0, 1, true];
  const { client } = await pair((socket) => socket.write(response(item)));
  const channel = createLocalOwnerTransport(client, "program");
  const result = await channel.readSnapshot();
  expect(result.correlations).toEqual([
    {
      attempt: "attempt-a",
      workspaceReference: "workspace-a",
      candidateHead: null,
      candidateScope: "scope-a",
      runtimeHandlePresent: true,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-handle");
  channel.close();
});

it("combines stable pages and reports bounded incomplete coverage", async () => {
  const { client, requests } = await pair((socket, request) => {
    if (request.action === "events") {
      socket.write(
        response({
          events: [],
          position: { producer: "a".repeat(32), scope: "program", sequence: 3 },
          gap: true,
        }),
      );
      return;
    }
    const page = request.page as number;
    const item = snapshot();
    item.page = page;
    item.work_units = Array.from({ length: 8 }, (_, index) => [
      `work-${page * 8 + index}`,
      "ready",
      null,
      null,
    ]);
    item.coverage.work_units = [page * 8, 512, page === 63];
    socket.write(response(item));
  });
  const channel = createLocalOwnerTransport(client, "program");
  const result = await channel.readSnapshot();
  expect(requests.map((request) => request.page)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
  expect(result.counts.work_units).toEqual({ sampled: 64, total: 512 });
  expect(result.workUnits).toHaveLength(64);
  const next = await channel.readSnapshot({
    page: 8,
    epoch: result.epoch,
    sequence: result.sequence,
  });
  expect(next.startPage).toBe(8);
  expect(next.counts.work_units).toEqual({ sampled: 64, total: 512 });
  expect(next.workUnits[0]?.[0]).toBe("work-64");
  expect(next.history).toBe("gap");
  const last = await channel.readSnapshot({
    page: 56,
    epoch: result.epoch,
    sequence: result.sequence,
  });
  expect(last.workUnits).toHaveLength(64);
  expect(last.workUnits[63]?.[0]).toBe("work-511");
  expect(last.history).toBe("gap");
  channel.close();
});

it("rejects pages from different producer positions", async () => {
  let completed = false;
  const { client } = await pair((socket, request) => {
    const page = request.page as number;
    const item = snapshot();
    if (completed) {
      socket.write(response(item));
      return;
    }
    item.page = page;
    item.work_units = Array.from({ length: page ? 1 : 8 }, (_, index) => [
      `work-${page * 8 + index}`,
      "ready",
      null,
      null,
    ]);
    item.coverage.work_units = [page * 8, 9, page === 1];
    if (page) {
      item.position.sequence++;
      completed = true;
    }
    socket.write(response(item));
  });
  const channel = createLocalOwnerTransport(client, "program");
  await expect(channel.readSnapshot()).rejects.toThrow(
    "Snapshot changed during pagination",
  );
  expect((await channel.readSnapshot()).history).toBe("gap");
  channel.close();
});

it("distinguishes bounded continuity from a persistent progress gap", async () => {
  let reads = 0;
  const { client, requests } = await pair((socket, request) => {
    if (request.action === "snapshot") socket.write(response(snapshot()));
    else {
      reads++;
      expect(request).toEqual({
        version: 1,
        action: "events",
        after: { producer: "a".repeat(32), scope: "program", sequence: 3 },
        limit: 256,
      });
      socket.write(
        response({
          events: [],
          position: { producer: "a".repeat(32), scope: "program", sequence: 3 },
          gap: reads === 2,
        }),
      );
    }
  });
  const channel = createLocalOwnerTransport(client, "program");
  expect((await channel.readSnapshot()).history).toBe("initial");
  expect((await channel.readSnapshot()).history).toBe("continuous");
  expect((await channel.readSnapshot()).history).toBe("gap");
  expect((await channel.readSnapshot()).history).toBe("gap");
  expect(
    requests.filter((request) => request.action === "events"),
  ).toHaveLength(3);
  channel.close();
});

it("retains exact int64 event positions without JavaScript rounding", async () => {
  const sequence = "9007199254740993";
  function send(socket: Socket, result: unknown) {
    const body = Buffer.from(
      JSON.stringify({ version: 1, ok: true, result }).replace(
        '"__sequence__"',
        sequence,
      ),
    );
    const message = Buffer.alloc(body.length + 4);
    message.writeUInt32BE(body.length);
    body.copy(message, 4);
    socket.write(message);
  }
  const { client } = await pair((socket, request) => {
    const position = {
      producer: "a".repeat(32),
      scope: "program",
      sequence: "__sequence__",
    };
    if (request.action === "snapshot")
      send(socket, { ...snapshot(), position });
    else {
      expect((request.after as Record<string, unknown>).sequence).toBe(
        9007199254740993n,
      );
      send(socket, { events: [], position, gap: false });
    }
  });
  const channel = createLocalOwnerTransport(client, "program");
  expect((await channel.readSnapshot()).sequence).toBe(sequence);
  expect((await channel.readSnapshot()).history).toBe("continuous");
  channel.close();
});

it("rejects a progress batch that falsely skips a sequence", async () => {
  const { client } = await pair((socket, request) => {
    if (request.action === "snapshot") socket.write(response(snapshot()));
    else
      socket.write(
        response({
          events: [
            {
              position: {
                producer: "a".repeat(32),
                scope: "program",
                sequence: 5,
              },
              kind: "snapshot-changed",
              revision: 4,
            },
          ],
          position: { producer: "a".repeat(32), scope: "program", sequence: 5 },
          gap: false,
        }),
      );
  });
  const channel = createLocalOwnerTransport(client, "program");
  await channel.readSnapshot();
  await expect(channel.readSnapshot()).rejects.toThrow();
});

it("rejects a non-string progress event kind", async () => {
  const { client } = await pair((socket, request) => {
    if (request.action === "snapshot") socket.write(response(snapshot()));
    else
      socket.write(
        response({
          events: [
            {
              position: {
                producer: "a".repeat(32),
                scope: "program",
                sequence: 4,
              },
              kind: ["snapshot-changed"],
              revision: 4,
            },
          ],
          position: { producer: "a".repeat(32), scope: "program", sequence: 4 },
          gap: false,
        }),
      );
  });
  const channel = createLocalOwnerTransport(client, "program");
  await channel.readSnapshot();
  await expect(channel.readSnapshot()).rejects.toThrow();
});

it("requires resynchronization when a selected page changes during progress read", async () => {
  const { client } = await pair((socket, request) => {
    if (request.action === "snapshot") {
      const item = snapshot();
      item.page = request.page as number;
      socket.write(response(item));
    } else {
      socket.write(
        response({
          events: [],
          position: { producer: "a".repeat(32), scope: "program", sequence: 4 },
          gap: true,
        }),
      );
    }
  });
  const channel = createLocalOwnerTransport(client, "program");
  const initial = await channel.readSnapshot();
  await expect(
    channel.readSnapshot({
      page: 8,
      epoch: initial.epoch,
      sequence: initial.sequence,
    }),
  ).rejects.toThrow("Snapshot changed during pagination");
  channel.close();
});

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

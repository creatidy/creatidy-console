import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { openState } from "../server/state.ts";
import { createLocalOwnerTransport as createTransport } from "../server/kernel-owner-transport.ts";
import {
  MAX_PROPOSAL_BYTES,
  UnsupportedApprovalScope,
  UnsupportedOwnerPayload,
} from "../server/kernel-owner-proposal.ts";
import {
  ownerIdentityDigest,
  prepareLocalOwnerCommand,
} from "../server/kernel-owner-v1.ts";

it("reads exact dispositions on history-only channels without dispatching approval", async () => {
  const pairing = { producer: "p", recipient: "r" };
  const scope = "Program \u007f\u{1f680}";
  const actorDigest = ownerIdentityDigest("owner\u00e9");
  const cmd = (producer = "p", recipient = "r", historyVersion?: 1 | 2) =>
    prepareLocalOwnerCommand(
      scope,
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "d",
        expires_at: 3000000000,
        proposal_digest: "a".repeat(64),
        scope_digest: "b".repeat(64),
      },
      () => "command",
      {
        producer,
        recipient,
        ...(historyVersion ? { historyVersion, actorDigest } : {}),
      },
    );
  let result: Record<string, unknown> = {
    version: 2,
    status: "intent-recorded",
    receipt: null,
  };
  const { client, requests } = await pair((socket) =>
    socket.write(response(result)),
  );
  const transport = createTransport(
    client,
    scope,
    1000,
    [
      "snapshot",
      "record",
      "events",
      "approval-disposition",
      "approval-disposition-v2",
    ],
    pairing,
  );
  expect(transport.approvalSupported).toBe(false);
  const original = cmd("p", "r", 2);
  await expect(transport.sendCommand(original)).rejects.toThrow(
    "Unsupported owner operation",
  );
  for (const other of [cmd("q", "r", 2), cmd("p", "s", 2), cmd()])
    await expect(transport.readDisposition(other)).rejects.toThrow(
      "Approval disposition unavailable",
    );
  expect(requests).toEqual([]);
  expect(await transport.readDisposition(original)).toEqual({
    kind: "intent-recorded",
  });
  expect(await transport.readDisposition(original)).toEqual({
    kind: "intent-recorded",
  });
  expect(requests).toEqual(
    Array(2).fill({
      version: 1,
      action: "approval-disposition-v2",
      ...pairing,
      program_digest: createHash("sha256")
        .update('"Program \\u007f\\ud83d\\ude80"')
        .digest("hex"),
      actor_digest: createHash("sha256").update('"owner\\u00e9"').digest("hex"),
      original: original.request,
    }),
  );
  result = { version: 1, status: "unknown", receipt: null };
  expect(await transport.readDisposition(cmd("p", "r", 1))).toEqual({
    kind: "unknown",
  });
  expect(requests.at(-1)?.action).toBe("approval-disposition");
  result = {
    version: 2,
    status: "terminal-refusal",
    receipt: null,
    reason: "stale-revision",
  };
  expect(await transport.readDisposition(original)).toEqual({
    kind: "terminal-refusal",
    reason: "stale-revision",
  });
  result = { ...result, reason: "unknown-reason" };
  await expect(transport.readDisposition(original)).rejects.toThrow();
  expect(transport.canReadDisposition(original)).toBe(false);
});

const cleanups: (() => Promise<void>)[] = [];
const operations = [
  "snapshot",
  "record",
  "events",
  "proposal",
  "proposal-chunk",
  "approval-scope",
  "approval-scope-chunk",
  "approve",
  "stop",
  "start-managed",
  "reconcile",
];
const createLocalOwnerTransport = (
  socket: Socket,
  scope: string,
  timeout?: number,
) => createTransport(socket, scope, timeout, operations);
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

it("never probes unsupported legacy or v2 operations and keeps the channel open", async () => {
  for (const declared of [
    null,
    ["snapshot", "record", "events"],
    ["snapshot", "record", "events", "proposal", "proposal-chunk"],
  ]) {
    const { client, requests } = await pair(() => {});
    const channel = createTransport(client, "program", 100, declared);
    expect(channel.approvalSupported).toBe(false);
    await expect(channel.readApprovalScope()).rejects.toThrow("Unsupported");
    const command = prepareLocalOwnerCommand("program", {
      action: "approve",
      expected_revision: -1,
      decision_id: "d",
      expires_at: 200,
      proposal_digest: "a".repeat(64),
      scope_digest: "b".repeat(64),
    });
    await expect(channel.sendCommand(command)).rejects.toThrow("Unsupported");
    await expect(channel.replayCommand(command)).rejects.toThrow();
    if (declared?.length === 3)
      await expect(channel.readProposal()).rejects.toThrow("Unsupported");
    expect(requests).toHaveLength(0);
    expect(client.destroyed).toBe(false);
    channel.close();
  }
});

it("keeps proposal reads available after a complete unsupported scope version", async () => {
  const scope = Buffer.from(
    JSON.stringify({ kind: "ordinary-approval-scope", version: 2 }),
  );
  const raw = proposal(10);
  const { client, requests } = await pair((socket, request) => {
    const bytes = request.action === "approval-scope-chunk" ? scope : raw;
    socket.write(
      response(
        chunk(bytes, 0, createHash("sha256").update(bytes).digest("hex")),
      ),
    );
  });
  const channel = createLocalOwnerTransport(client, "program");
  expect(channel.approvalSupported).toBe(true);
  await expect(channel.readApprovalScope()).rejects.toThrow(
    "Unsupported approval scope",
  );
  expect(channel.approvalSupported).toBe(false);
  expect((await channel.readProposal()).text).toBe(raw.toString());
  expect(requests.map((request) => request.action)).toEqual([
    "approval-scope-chunk",
    "proposal-chunk",
  ]);
  expect(client.destroyed).toBe(false);
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

const canonicalProfile =
  '{"effort":null,"harness":"codex","model":null,"provider":null,"trust":"trusted_development"}';

function approvalScope(
  profileBytes: string,
  objectiveSize = 9000,
  limits: Partial<
    Record<"work_budget" | "project_budget", Record<string, unknown>>
  > = {},
) {
  const reference = { policy_id: "p", version: "v", digest: "d" };
  const budget = {
    version: 1,
    counts: Object.fromEntries(
      [
        "attempt",
        "review",
        "remediation",
        "tool",
        "retry",
        "helper",
        "verification",
        "auxiliary",
      ].map((name) => [name, 1]),
    ),
    max_active: 1,
    retained_bytes: 1,
    resources: [],
    strict_inference: false,
  };
  const value = {
    kind: "ordinary-approval-scope",
    version: 1,
    owner: "owner",
    proposal: JSON.parse(proposal(objectiveSize).toString()),
    policy: {
      reference,
      budget: { max_attempts: 1, max_active_attempts: 1 },
      authority: {
        owner_id: "owner",
        allowed_actions: [],
        max_attempts: 1,
        trusted_satisfaction_issuers: [],
        delegated_actor_ids: [],
      },
      paths: [],
      network: [],
      effects: [],
      recipes: ["recipe"],
      evidence_producers: ["producer"],
      freshness_seconds: 1,
      repair_baseline_reference: null,
      work_budget: { ...budget, ...limits.work_budget },
      project_budget: { ...budget, ...limits.project_budget },
      project_id: "project",
    },
    verification: {
      reference,
      checks: ["paths", "structural", "commands"],
      reviewer_required: true,
    },
    execution_profile: JSON.parse(profileBytes),
    execution_reference: `basic-harness-policy:${createHash("sha256").update(profileBytes).digest("hex")}`,
  };
  // Kernel hashes the supplied profile bytes, but serializes its parsed value
  // in the sorted, compact scope. All strings in this scope fixture are ASCII.
  return Buffer.from(
    JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, (item as Record<string, unknown>)[key]]),
          )
        : item,
    ),
  );
}

it("reads digest-bound approval scope chunks using only fixed read actions", async () => {
  const raw = approvalScope(canonicalProfile);
  const digest = createHash("sha256").update(raw).digest("hex");
  const { client, requests } = await pair((socket, request) => {
    const offset = request.offset as number;
    expect(request).toEqual({
      version: 1,
      action: "approval-scope-chunk",
      offset,
      scope_digest: offset ? digest : null,
    });
    socket.write(response(chunk(raw, offset, digest)));
  });
  const channel = createLocalOwnerTransport(client, "program");
  expect(await channel.readApprovalScope()).toEqual(
    expect.objectContaining({
      digest,
      text: raw.toString(),
      proposalDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  );
  expect(requests.length).toBeGreaterThan(1);
  channel.close();
});

it.each([
  [
    "profile whitespace",
    `\n ${canonicalProfile.replaceAll(",", ", ")}\n`,
    9000,
    2,
  ],
  [
    "profile key order",
    '{"trust":"trusted_development","effort":null,"harness":"codex","model":null,"provider":null}',
    9000,
    2,
  ],
  ["oversized approval scope", canonicalProfile, MAX_PROPOSAL_BYTES - 1800, 1],
] as const)(
  "keeps producer reads usable after unsupported %s",
  async (_name, profileBytes, objectiveSize, scopeReads) => {
    expect(JSON.parse(profileBytes)).toEqual(JSON.parse(canonicalProfile));
    const scope = approvalScope(profileBytes, objectiveSize);
    const raw = proposal(10);
    expect(scope.length > MAX_PROPOSAL_BYTES).toBe(scopeReads === 1);
    expect(proposal(objectiveSize).length).toBeLessThan(MAX_PROPOSAL_BYTES);
    const scopeDigest = createHash("sha256").update(scope).digest("hex");
    const proposalDigest = createHash("sha256").update(raw).digest("hex");
    const pairing = { producer: "p", recipient: "r" };
    const command = prepareLocalOwnerCommand(
      "program",
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "d",
        expires_at: 200,
        proposal_digest: "a".repeat(64),
        scope_digest: "b".repeat(64),
      },
      () => "historical-command",
      {
        ...pairing,
        historyVersion: 2,
        actorDigest: ownerIdentityDigest("owner"),
      },
    );
    const { client, requests } = await pair((socket, request) => {
      if (request.action === "approval-disposition-v2") {
        socket.write(
          response({
            version: 2,
            status: "historical-receipt",
            receipt: {
              version: 1,
              authority: "historical-only",
              status: "approved",
              decision_id: "d",
              spec_digest: "c".repeat(64),
              expires_at: 199,
            },
          }),
        );
      } else {
        const bytes = request.action === "approval-scope-chunk" ? scope : raw;
        socket.write(
          response(
            chunk(
              bytes,
              request.offset as number,
              bytes === scope ? scopeDigest : proposalDigest,
            ),
          ),
        );
      }
    });
    const channel = createTransport(
      client,
      "program",
      1000,
      [...operations, "approval-disposition", "approval-disposition-v2"],
      pairing,
    );
    expect(channel.approvalSupported).toBe(true);
    await expect(channel.readApprovalScope()).rejects.toBeInstanceOf(
      UnsupportedApprovalScope,
    );
    expect(channel.approvalSupported).toBe(false);
    await expect(channel.sendCommand(command)).rejects.toThrow(
      "Unsupported owner operation",
    );
    expect((await channel.readProposal()).text).toBe(raw.toString());
    expect((await channel.readProposal()).text).toBe(raw.toString());
    await expect(channel.readDisposition(command)).resolves.toMatchObject({
      kind: "historical-receipt-shape",
      decision_id: "d",
    });
    expect(requests.map(({ action }) => action)).toEqual([
      ...Array(scopeReads).fill("approval-scope-chunk"),
      "proposal-chunk",
      "proposal-chunk",
      "approval-disposition-v2",
    ]);
    expect(client.destroyed).toBe(false);
    channel.close();
  },
);

it.each(
  ["work_budget", "project_budget"].flatMap((budget) =>
    ["max_active", "retained_bytes"].flatMap((field) =>
      [0, -1, "1", true].map((value) => ({ budget, field, value })),
    ),
  ),
)(
  "rejects $budget.$field = $value rather than coercing or accepting it",
  async ({ budget, field, value }) => {
    const raw = approvalScope(canonicalProfile, 10, {
      [budget]: { [field]: value },
    });
    const digest = createHash("sha256").update(raw).digest("hex");
    const { client } = await pair((socket, request) =>
      socket.write(response(chunk(raw, request.offset as number, digest))),
    );
    const channel = createLocalOwnerTransport(client, "program");
    await expect(channel.readApprovalScope()).rejects.toThrow(
      "Owner channel unavailable: invalid",
    );
    expect(client.destroyed).toBe(true);
  },
);

it.each(["scope digest", "program binding", "execution reference"])(
  "still closes on invalid %s with a noncanonical profile",
  async (failure) => {
    let raw = approvalScope(` ${canonicalProfile}`);
    if (failure === "program binding")
      raw = Buffer.from(
        raw.toString().replace('"program":"program"', '"program":"other"'),
      );
    if (failure === "execution reference")
      raw = Buffer.from(
        raw.toString().replace("basic-harness-policy:", "invalid:"),
      );
    const digest =
      failure === "scope digest"
        ? "0".repeat(64)
        : createHash("sha256").update(raw).digest("hex");
    const { client } = await pair((socket, request) =>
      socket.write(response(chunk(raw, request.offset as number, digest))),
    );
    const channel = createLocalOwnerTransport(client, "program");
    await expect(channel.readApprovalScope()).rejects.toThrow(
      "Owner channel unavailable: invalid",
    );
    expect(client.destroyed).toBe(true);
  },
);

it.each([{ complete: true }, { data_base64: "eA==" }, { offset: 1 }])(
  "closes on oversized scope metadata with an invalid first chunk (%j)",
  async (invalid) => {
    const { client, requests } = await pair((socket) => {
      socket.write(
        response({
          ...chunk(Buffer.alloc(8192, 120), 0, "a".repeat(64)),
          bytes: MAX_PROPOSAL_BYTES + 1,
          complete: false,
          ...invalid,
        }),
      );
    });
    const channel = createLocalOwnerTransport(client, "program");
    await expect(channel.readApprovalScope()).rejects.toThrow(
      "Owner channel unavailable: invalid",
    );
    expect(requests).toHaveLength(1);
    expect(client.destroyed).toBe(true);
  },
);

it("closes on changed approval scope chunks without accepting partial evidence", async () => {
  const raw = Buffer.from("x".repeat(9000));
  const digest = createHash("sha256").update(raw).digest("hex");
  const { client, requests } = await pair((socket, request) => {
    const offset = request.offset as number;
    socket.write(
      response(chunk(raw, offset, offset ? "b".repeat(64) : digest)),
    );
  });
  const channel = createLocalOwnerTransport(client, "program");
  await expect(channel.readApprovalScope()).rejects.toThrow(
    "Owner channel unavailable",
  );
  expect(requests).toHaveLength(2);
  expect(client.destroyed).toBe(true);
});

it("reports channel busy synchronously while a read is in flight", async () => {
  const raw = proposal(10);
  const digest = createHash("sha256").update(raw).digest("hex");
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { client } = await pair((socket) => {
    release = () => socket.write(response(chunk(raw, 0, digest)));
    started();
  });
  const channel = createLocalOwnerTransport(client, "program");
  const read = channel.readProposal();
  await ready;
  expect(channel.canSend()).toBe(false);
  release();
  await read;
  expect(channel.canSend()).toBe(true);
  channel.close();
  expect(channel.canSend()).toBe(false);
});

it("permits exact replay only after a valid unknown on the original channel", async () => {
  let exchanges = 0;
  const { client, requests } = await pair((socket) => {
    exchanges++;
    socket.write(
      response(
        exchanges === 1
          ? { status: "unknown", settlement: "unknown" }
          : {
              version: 1,
              status: "approved",
              decision_id: "decision",
              spec_digest: "c".repeat(64),
              expires_at: 200,
              authority: "historical-only",
            },
      ),
    );
  });
  const channel = createLocalOwnerTransport(client, "program");
  const command = prepareLocalOwnerCommand(
    "program",
    {
      action: "approve",
      expected_revision: -1,
      decision_id: "decision",
      expires_at: 200,
      proposal_digest: "a".repeat(64),
      scope_digest: "b".repeat(64),
    },
    () => "id",
  );
  expect(channel.canReplay(command)).toBe(false);
  await expect(channel.replayCommand(command)).rejects.toThrow();
  expect(await channel.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(channel.canReplay(command)).toBe(true);
  const replacement = await pair((socket) => socket.destroy());
  const freshChannel = createLocalOwnerTransport(replacement.client, "program");
  expect(freshChannel.canReplay(command)).toBe(false);
  await expect(freshChannel.replayCommand(command)).rejects.toThrow();
  expect(replacement.requests).toHaveLength(0);
  freshChannel.close();
  expect(await channel.replayCommand(command)).toMatchObject({
    kind: "historical-receipt-shape",
    action: "approve",
  });
  expect(channel.canReplay(command)).toBe(false);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  channel.close();
});

it("does not infer replay safety from a lost approval reply", async () => {
  const { client } = await pair((socket) => socket.end());
  const channel = createLocalOwnerTransport(client, "program");
  const command = prepareLocalOwnerCommand(
    "program",
    {
      action: "approve",
      expected_revision: -1,
      decision_id: "decision",
      expires_at: 200,
      proposal_digest: "a".repeat(64),
      scope_digest: "b".repeat(64),
    },
    () => "id",
  );
  expect(await channel.sendCommand(command)).toEqual({ kind: "unknown" });
  expect(channel.canReplay(command)).toBe(false);
  await expect(channel.replayCommand(command)).rejects.toThrow();
});

const snapshot = {
  version: 1,
  producer: "producer",
  scope: "program",
  program_revision: null,
  spec_digest: null,
  status: "absent",
  work_units: [],
  attempts: [],
  reservations: [],
  commands: [],
  command_coverage: [0, 0, true],
  claims: [],
  correlations: [],
  decisions: [],
  usage_subtotals: [],
  budget_configured: false,
  budget_revoked: null,
  authority: {},
  missing_usage: "unknown",
  route_identity: null,
  physical_settlement: null,
  page: 0,
  coverage: {},
  position: {},
};

it("reads only a scope-bound, versioned producer revision", async () => {
  const pair1 = await pair((socket, request) => {
    expect(request).toEqual({ version: 1, action: "snapshot" });
    socket.write(response(snapshot));
  });
  const channel = createLocalOwnerTransport(pair1.client, "program");
  expect(await channel.readRevision()).toEqual({
    revision: "-1",
    status: "absent",
  });
  channel.close();
  const pair2 = await pair((socket) =>
    socket.write(response({ ...snapshot, scope: "other" })),
  );
  await expect(
    createLocalOwnerTransport(pair2.client, "program").readRevision(),
  ).rejects.toThrow("Owner channel unavailable");
  expect(pair2.client.destroyed).toBe(true);

  // The raw ID fits Console's configuration limit but its Python
  // ensure_ascii=True JSON string exceeds the producer snapshot field limit.
  const longScope = "\u2713".repeat(700);
  const encoded = '"' + "\\u2713".repeat(700) + '"';
  const marker = {
    oversized: true,
    index: 0,
    bytes: encoded.length,
    sha256: createHash("sha256").update(encoded).digest("hex"),
  };
  const pair3 = await pair((socket) =>
    socket.write(response({ ...snapshot, scope: marker })),
  );
  const longChannel = createLocalOwnerTransport(pair3.client, longScope);
  await expect(longChannel.readRevision()).resolves.toEqual({
    revision: "-1",
    status: "absent",
  });
  expect(pair3.client.destroyed).toBe(false);
  longChannel.close();
  for (const invalid of [
    { bytes: marker.bytes - 1 },
    { sha256: "b".repeat(64) },
    { index: 1 },
    { extra: true },
  ]) {
    const { client } = await pair((socket) =>
      socket.write(response({ ...snapshot, scope: { ...marker, ...invalid } })),
    );
    await expect(
      createLocalOwnerTransport(client, longScope).readRevision(),
    ).rejects.toThrow("Owner channel unavailable: invalid");
    expect(client.destroyed).toBe(true);
  }
});

const enumTypes = (valid: string) => [[valid], 1, true, null, {}];

it.each(["draft", "active", "paused", "completed", "cancelled"])(
  "accepts the literal %s revision status",
  async (status) => {
    const { client } = await pair((socket) =>
      socket.write(
        response({
          ...snapshot,
          status,
          program_revision: 1,
          spec_digest: "a".repeat(64),
        }),
      ),
    );
    const channel = createLocalOwnerTransport(client, "program");
    expect(await channel.readRevision()).toEqual({
      status,
      revision: "1",
      specDigest: "a".repeat(64),
    });
    channel.close();
  },
);

it.each(["kilo-pull", "codex", "kilo-pull+codex"])(
  "accepts the literal %s harness with nullable or string options",
  async (harness) => {
    const raw = approvalScope(
      canonicalProfile
        .replace('"codex"', JSON.stringify(harness))
        .replace('"model":null', '"model":"synthetic"'),
    );
    const digest = createHash("sha256").update(raw).digest("hex");
    const { client } = await pair((socket, request) =>
      socket.write(response(chunk(raw, request.offset as number, digest))),
    );
    const channel = createLocalOwnerTransport(client, "program");
    await expect(channel.readApprovalScope()).resolves.toMatchObject({
      digest,
    });
    channel.close();
  },
);

it.each([
  ...enumTypes("active").map((value) => ({ field: "status", value })),
  ...enumTypes("codex").map((value) => ({ field: "harness", value })),
  { field: "trust", value: ["trusted_development"] },
  ...["provider", "model", "effort"].map((field) => ({
    field,
    value: ["synthetic"],
  })),
])(
  "rejects malformed approval evidence $field = $value before review or dispatch",
  async ({ field, value }) => {
    const isSnapshot = field === "status";
    const profile = {
      ...JSON.parse(canonicalProfile),
      ...(isSnapshot ? {} : { [field]: value }),
    };
    // Hash the supplied profile bytes even for malformed values, so a separate
    // reference mismatch cannot mask an invalid enum type.
    const scope = approvalScope(JSON.stringify(profile), 10);
    const raw = Buffer.from(
      JSON.stringify(JSON.parse(scope.toString()).proposal),
    );
    const proposalDigest = createHash("sha256").update(raw).digest("hex");
    const scopeDigest = createHash("sha256").update(scope).digest("hex");
    const { client, requests } = await pair((socket, request) => {
      if (request.action === "snapshot") {
        socket.write(
          response({
            ...snapshot,
            status: isSnapshot ? value : "active",
            program_revision: 1,
            spec_digest: "a".repeat(64),
          }),
        );
      } else if (request.action === "proposal-chunk") {
        socket.write(
          response(chunk(raw, request.offset as number, proposalDigest)),
        );
      } else if (request.action === "approval-scope-chunk") {
        socket.write(
          response(chunk(scope, request.offset as number, scopeDigest)),
        );
      } else {
        socket.end();
      }
    });
    const channel = createLocalOwnerTransport(client, "program");
    const { app, headers } = await ownerApp({
      scope: "program",
      readProposal: channel.readProposal,
      readApprovalScope: channel.readApprovalScope,
      readRevision: channel.readRevision,
      canSend: channel.canSend,
      sendCommand: channel.sendCommand,
      close: channel.close,
      get approvalSupported() {
        return channel.approvalSupported;
      },
    });
    const auth = await loginOwner(app, headers);
    const review = await app.inject({
      method: "POST",
      url: "/api/kernel/owner-review",
      headers: auth,
      payload: { expires_at: String(Math.floor(Date.now() / 1000) + 120) },
    });
    expect(review.statusCode, review.body).toBe(503);
    expect(review.json()).not.toHaveProperty("review");
    expect(client.destroyed).toBe(true);
    const command = await app.inject({
      method: "POST",
      url: "/api/kernel/owner",
      headers: auth,
      payload: { action: "approve", review: "0".repeat(64) },
    });
    expect(command.json()).toMatchObject({ kind: "not-sent" });
    const journal = await app.inject({
      method: "GET",
      url: "/api/kernel/owner-journal",
      headers: auth,
    });
    expect(journal.json().commands).toEqual([]);
    expect(requests.map(({ action }) => action)).toEqual([
      "proposal-chunk",
      "approval-scope-chunk",
      ...(isSnapshot ? ["snapshot"] : []),
    ]);
  },
);

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
  expect(changed.client.destroyed).toBe(true);
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

it("rejects truncated proposal frames", async () => {
  const truncated = await pair((socket) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(100);
    socket.end(Buffer.concat([header, Buffer.from("partial")]));
  });
  await expect(
    createLocalOwnerTransport(truncated.client, "program").readProposal(),
  ).rejects.toThrow("Owner channel unavailable");
  expect(truncated.client.destroyed).toBe(true);
});

it.each([
  { data_base64: "" },
  { complete: true },
  { offset: 1 },
  { digest: "invalid" },
])("closes on malformed oversized proposal chunks (%j)", async (invalid) => {
  const { client, requests } = await pair((socket) =>
    socket.write(
      response({
        ...chunk(Buffer.alloc(8192, 120), 0, "a".repeat(64)),
        bytes: MAX_PROPOSAL_BYTES + 1,
        complete: false,
        ...invalid,
      }),
    ),
  );
  await expect(
    createLocalOwnerTransport(client, "program").readProposal(),
  ).rejects.toThrow("Owner channel unavailable: invalid");
  expect(client.destroyed).toBe(true);
  expect(requests).toHaveLength(1);
});

it.each([1, 2] as const)(
  "keeps authorized v%s recovery after an oversized proposal",
  async (historyVersion) => {
    const raw = proposal(MAX_PROPOSAL_BYTES);
    const digest = createHash("sha256").update(raw).digest("hex");
    const pairing = { producer: "p", recipient: "r" };
    const actorDigest = ownerIdentityDigest("owner");
    const expiresAt = Math.floor(Date.now() / 1000) + 120;
    const original = prepareLocalOwnerCommand(
      "program",
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "d",
        expires_at: expiresAt,
        proposal_digest: "a".repeat(64),
        scope_digest: "b".repeat(64),
      },
      () => "00000000-0000-4000-8000-000000000001",
      { ...pairing, actorDigest, historyVersion },
    );
    const action =
      historyVersion === 1 ? "approval-disposition" : "approval-disposition-v2";
    const { client, requests } = await pair((socket, request) => {
      if (request.action === "proposal-chunk")
        socket.write(response(chunk(raw, request.offset as number, digest)));
      else if (request.action === action)
        socket.write(
          response(
            historyVersion === 1
              ? {
                  version: 1,
                  status: "historical-receipt",
                  receipt: {
                    version: 1,
                    authority: "historical-only",
                    status: "approved",
                    decision_id: "d",
                    spec_digest: "c".repeat(64),
                    expires_at: expiresAt,
                  },
                }
              : {
                  version: 2,
                  status: "terminal-refusal",
                  receipt: null,
                  reason: "stale-revision",
                },
          ),
        );
      else socket.end();
    });
    const channel = createTransport(
      client,
      "program",
      1000,
      [...operations, "approval-disposition", "approval-disposition-v2"],
      pairing,
    );
    const { app, dir, headers } = await ownerApp({
      scope: "program",
      pairing,
      readProposal: channel.readProposal,
      readApprovalScope: channel.readApprovalScope,
      readRevision: channel.readRevision,
      canSend: channel.canSend,
      sendCommand: channel.sendCommand,
      canReadDisposition: channel.canReadDisposition,
      readDisposition: channel.readDisposition,
      close: channel.close,
      get approvalSupported() {
        return channel.approvalSupported;
      },
    });
    const auth = await loginOwner(app, headers);
    const state = openState(dir);
    try {
      state.db
        .prepare(
          "INSERT INTO owner_commands (command_id, scope, input, outcome, created, producer, recipient, actor_digest, history_version) VALUES (?, ?, ?, 'unknown', ?, ?, ?, ?, ?)",
        )
        .run(
          original.commandId,
          "program",
          frame(original.request),
          Date.now(),
          pairing.producer,
          pairing.recipient,
          actorDigest,
          historyVersion,
        );
    } finally {
      state.db.close();
    }
    expect(channel.approvalSupported).toBe(true);
    await expect(channel.readProposal()).rejects.toBeInstanceOf(
      UnsupportedOwnerPayload,
    );
    expect(channel.approvalSupported).toBe(false);
    expect(client.destroyed).toBe(false);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/kernel/owner",
      headers: auth,
    });
    expect(snapshot.json()).toEqual({ status: "unsupported", actions: [] });
    const review = await app.inject({
      method: "POST",
      url: "/api/kernel/owner-review",
      headers: auth,
      payload: { expires_at: String(expiresAt) },
    });
    expect(review.statusCode).toBe(503);
    const replay = {
      method: "POST",
      url: "/api/kernel/owner-replay",
      payload: { commandId: original.commandId },
    } as const;
    expect((await app.inject({ ...replay, headers })).statusCode).toBe(401);
    const receipt = await app.inject({ ...replay, headers: auth });
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(receipt.json()).toMatchObject(
      historyVersion === 1
        ? { kind: "historical-receipt-shape" }
        : { kind: "terminal-refusal", reason: "stale-revision" },
    );
    expect(requests.map(({ action, offset }) => [action, offset])).toEqual([
      ["proposal-chunk", 0],
      ["proposal-chunk", 0],
      [action, undefined],
    ]);
    expect(requests.at(-1)).toMatchObject({
      ...pairing,
      actor_digest: actorDigest,
      program_digest: ownerIdentityDigest("program"),
      original: original.request,
    });
    expect(client.destroyed).toBe(false);
  },
);

async function ownerApp(
  kernelOwner: NonNullable<Parameters<typeof createApp>[0]["kernelOwner"]>,
) {
  const dir = await mkdtemp(join(tmpdir(), "console-owner-app-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
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
    kernelOwner,
  });
  cleanups.unshift(() => app.close());
  return { app, dir, headers };
}

async function loginOwner(
  app: Awaited<ReturnType<typeof createApp>>,
  headers: { host: string; origin: string },
) {
  const setup = await app.inject({
    method: "POST",
    url: "/api/bootstrap",
    headers,
    payload: { token: "synthetic-token", password: "synthetic-password" },
  });
  expect(setup.statusCode).toBe(200);
  const login = await app.inject({
    method: "POST",
    url: "/api/login",
    headers,
    payload: { password: "synthetic-password" },
  });
  expect(login.statusCode).toBe(200);
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  return { ...headers, cookie };
}

it("requires a literal action when reading stored command history", async () => {
  const { app, dir, headers } = await ownerApp({
    scope: "program",
    readProposal: async () => {
      throw new Error("No producer");
    },
    close: () => {},
  });
  const auth = await loginOwner(app, headers);
  const state = openState(dir);
  try {
    const input = {
      version: 1,
      command_id: "synthetic-original",
      action: "start-managed",
      expected_revision: 1,
    };
    state.db
      .prepare(
        "INSERT INTO owner_commands (command_id, scope, input, outcome, created) VALUES (?, ?, ?, 'unknown', ?)",
      )
      .run(input.command_id, "program", frame(input), Date.now());
    const readHistory = () =>
      app.inject({
        method: "GET",
        url: "/api/kernel/owner-journal",
        headers: auth,
      });
    const original = await readHistory();
    expect(original.statusCode).toBe(200);
    expect(original.json().commands).toMatchObject([
      {
        commandId: input.command_id,
        action: "start-managed",
        outcome: "unknown",
        canRecover: false,
      },
    ]);
    const replace = state.db.prepare(
      "UPDATE owner_commands SET input = ? WHERE command_id = ?",
    );
    for (const action of enumTypes(input.action)) {
      replace.run(frame({ ...input, action }), input.command_id);
      const invalid = await readHistory();
      expect(invalid.statusCode).toBe(503);
      expect(invalid.json()).toEqual({ error: "Command history unavailable" });
    }
  } finally {
    state.db.close();
  }
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
  const { app, headers } = await ownerApp({
    scope: "program",
    readProposal: channel.readProposal,
    close: channel.close,
  });
  expect(
    (await app.inject({ method: "GET", url: "/api/kernel/owner", headers }))
      .statusCode,
  ).toBe(401);
  expect(requests).toHaveLength(0);
  const auth = await loginOwner(app, headers);
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
  expect(requests.every((request) => request.action === "proposal-chunk")).toBe(
    true,
  );
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
});

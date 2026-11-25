import { createHash } from "node:crypto";
import { Socket } from "node:net";
import type { OwnerPairing } from "./kernel-owner-greeting.ts";
import {
  assembleLocalOwnerApprovalScope,
  assembleLocalOwnerProposal,
  kernelJsonString,
  MAX_PROPOSAL_BYTES,
  UnsupportedOwnerPayload,
  UnsupportedApprovalScope,
} from "./kernel-owner-proposal.ts";
import {
  classifyLocalOwnerResult,
  isPreparedLocalOwnerCommand,
  ownerIdentityDigest,
  ownerJson,
  parseOwnerJson,
  prepareLocalOwnerCommand,
  type OwnerObservation,
  type ApprovalDisposition,
} from "./kernel-owner-v1.ts";

const RESPONSE_LIMIT = 1024 * 1024;
const CHUNK_LIMIT = 16 * 1024;

export class SnapshotChanged extends Error {}
export class InvalidOwnerResponse extends Error {}
class UnsupportedKernelSnapshotVersion extends InvalidOwnerResponse {}
class OwnerChannelUnavailable extends Error {}

export type KernelSnapshotStatus =
  "ready" | "unavailable" | "disconnected" | "unsupported";
const cutoffOrder = [
  "not-expired-observed",
  "unknown",
  "expired",
  "revoked",
] as const;
export type KernelAuthorityCutoff = (typeof cutoffOrder)[number];

export type KernelDecision = {
  source: string;
  status: string;
  applicability: "pending" | "historical" | "unknown";
  attempt: string | null;
  commandId?: string;
  decisionId?: string;
  reviewOperationId?: string;
};

export type KernelCorrelation = {
  attempt: string;
  workspaceReference: string | null;
  candidateHead: string | null;
  candidateScope: string | null;
  runtimeHandlePresent: boolean;
};

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid owner response");
  const item = value as Record<string, unknown>;
  if (
    Object.keys(item).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(item, key))
  )
    throw new Error("Invalid owner response");
  return item;
}

function payload(frame: Buffer): unknown {
  return parseOwnerJson(
    new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(4)),
  );
}

function checkSnapshotVersion(value: unknown) {
  if (!value || typeof value !== "object" || !("version" in value)) return;
  const version = value.version;
  if (
    (typeof version === "number" &&
      Number.isSafeInteger(version) &&
      version > 1) ||
    (typeof version === "bigint" && version > 1n)
  ) {
    throw new UnsupportedKernelSnapshotVersion(
      "Unsupported Kernel snapshot contract version",
    );
  }
}

function snapshotEnvelope(frame: Buffer, includeSnapshotVersion = false) {
  const value = payload(frame);
  checkSnapshotVersion(value);
  const envelope = record(value, ["version", "ok", "result"]);
  if (includeSnapshotVersion && envelope.version === 1 && envelope.ok === true)
    checkSnapshotVersion(envelope.result);
  return envelope;
}

// Kernel's domain identifiers use Python str.strip(): NEL and these C0
// separators are whitespace, but U+FEFF is not.
const nonblankSnapshotIdentifier = /[^\p{White_Space}\u001c-\u001f]/u;

function matchesSnapshotScope(value: unknown, scope: string) {
  const encoded = kernelJsonString(scope);
  if (encoded.length <= 4096) return value === scope;
  const marker = record(value, ["oversized", "index", "bytes", "sha256"]);
  return (
    marker.oversized === true &&
    marker.index === 0 &&
    marker.bytes === encoded.length &&
    marker.sha256 === createHash("sha256").update(encoded).digest("hex")
  );
}

function programHeader(snapshot: Record<string, unknown>) {
  const { status, program_revision: value, spec_digest: specDigest } = snapshot;
  if (status === "absent" && value === null && specDigest === null)
    return { revision: null, status, specDigest };
  if (
    typeof status !== "string" ||
    !["draft", "active", "paused", "completed", "cancelled"].includes(status) ||
    typeof specDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(specDigest) ||
    (typeof value !== "number" && typeof value !== "bigint")
  )
    throw new Error("Invalid owner snapshot");
  const revision = BigInt(value);
  if (revision < 0n || revision > 9223372036854775807n)
    throw new Error("Invalid owner revision");
  return { revision: revision.toString(), status, specDigest };
}

function requestFrame(value: unknown): Buffer {
  const bytes = Buffer.from(ownerJson(value));
  if (!bytes.length || bytes.length > 65536)
    throw new Error("Invalid owner request");
  const frame = Buffer.allocUnsafe(bytes.length + 4);
  frame.writeUInt32BE(bytes.length);
  bytes.copy(frame, 4);
  return frame;
}

// Takes exclusive ownership of an already verified socket. This does not acquire,
// authenticate, reconnect or expose a capability through the application API.
export function createLocalOwnerTransport(
  socket: Socket,
  scope: string,
  timeoutMs = 5000,
  operations: readonly string[] | null = null,
  pairing?: OwnerPairing,
) {
  if (
    !(socket instanceof Socket) ||
    socket.destroyed ||
    !socket.readable ||
    !socket.writable ||
    typeof scope !== "string" ||
    !scope.trim() ||
    Buffer.byteLength(scope) > 4096 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000
  ) {
    if (socket instanceof Socket) socket.destroy();
    throw new Error("Invalid owner transport");
  }
  let busy = false;
  let closed = false;
  let snapshotVersionUnsupported = false;
  const supported = (name: string) =>
    operations === null ? name === "proposal-chunk" : operations.includes(name);
  // Snapshot and events are known reads of the original owner-served protocol.
  const snapshotSupported =
    operations === null || (supported("snapshot") && supported("events"));
  const approvalDeclared =
    supported("approval-scope-chunk") && supported("approve");
  let approvalSupported = approvalDeclared;
  const historyVersion = supported("approval-disposition-v2")
    ? 2
    : supported("approval-disposition")
      ? 1
      : undefined;
  const verifiedPairing = pairing && Object.freeze({ ...pairing });
  type Command = ReturnType<typeof prepareLocalOwnerCommand>;
  const matchesPairing = (command: Command) =>
    command.scope === scope &&
    (verifiedPairing === undefined ||
      (command.binding?.producer === verifiedPairing.producer &&
        command.binding?.recipient === verifiedPairing.recipient));
  const canReadDisposition = (command: Command) =>
    !closed &&
    !socket.destroyed &&
    !!historyVersion &&
    !!verifiedPairing &&
    matchesPairing(command) &&
    command.request.action === "approve" &&
    !!command.binding?.historyVersion &&
    !!command.binding.actorDigest &&
    isPreparedLocalOwnerCommand(command);
  const observedUnknown = new WeakSet<object>();
  let waiting: (() => void) | undefined;
  let lastPosition:
    { producer: string; scope: string; sequence: string } | undefined;
  let priorHistoryGap = false;
  let priorHistoryUnknown = false;
  let seenSnapshot = false;
  const encodedScope = kernelJsonString(scope);
  const cursorScope =
    encodedScope.length > 4096 ? `sha256:${ownerIdentityDigest(scope)}` : scope;
  // Every event repeats the cursor. Reserve 512 bytes per event for its fixed
  // fields and int64 positions/revisions, plus 8 KiB for the batch envelope.
  const eventLimit = Math.min(
    256,
    Math.floor(
      (RESPONSE_LIMIT - 8192) / (kernelJsonString(cursorScope).length + 512),
    ),
  );
  const close = () => {
    closed = true;
    socket.destroy();
    waiting?.();
  };
  socket.pause();
  socket.on("error", close);
  socket.on("end", close);
  socket.on("close", close);
  socket.on("readable", () => {
    if (waiting) waiting();
    else if (!busy || socket.readableLength > RESPONSE_LIMIT + 4) close();
  });

  async function exchange(frame: Buffer, limit: number): Promise<Buffer> {
    if (closed || socket.readableLength !== 0)
      throw new OwnerChannelUnavailable("Owner channel unavailable");
    return new Promise((resolve, reject) => {
      let header: Buffer | undefined;
      let length = 0;
      let written = false;
      let response: Buffer | undefined;
      const fail = (invalid = false) => {
        waiting = undefined;
        reject(
          invalid
            ? new InvalidOwnerResponse(
                "Owner channel unavailable: invalid response frame",
              )
            : new OwnerChannelUnavailable("Owner channel unavailable"),
        );
      };
      const read = () => {
        if (closed) return fail();
        if (!header) {
          header = (socket.read(4) as Buffer | null) ?? undefined;
          if (!header) return;
          if (header.length !== 4) return fail(true);
          length = header.readUInt32BE();
          if (length < 1 || length > limit) return fail(true);
        }
        if (!response) {
          const body = socket.read(length) as Buffer | null;
          if (!body) return;
          if (body.length !== length) return fail(true);
          response = Buffer.concat([header, body]);
        }
        if (socket.readableLength !== 0) return fail(true);
        if (written) {
          waiting = undefined;
          resolve(response);
        }
      };
      waiting = read;
      socket.write(frame, (error) => {
        if (error) return fail();
        written = true;
        read();
      });
      read();
    });
  }

  async function withinDeadline<T>(run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            close();
            reject(new OwnerChannelUnavailable("Owner channel unavailable"));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function operation<T>(
    run: () => Promise<T>,
    deadline = true,
  ): Promise<T> {
    if (closed || busy)
      throw new OwnerChannelUnavailable("Owner channel unavailable");
    busy = true;
    try {
      return await (deadline ? withinDeadline(run) : run());
    } catch (error) {
      if (
        error instanceof SnapshotChanged ||
        error instanceof UnsupportedOwnerPayload
      )
        throw error;
      if (error instanceof UnsupportedKernelSnapshotVersion)
        snapshotVersionUnsupported = true;
      close();
      if (
        error instanceof OwnerChannelUnavailable ||
        error instanceof InvalidOwnerResponse
      )
        throw error;
      throw new InvalidOwnerResponse(
        "Owner channel unavailable: invalid producer response",
      );
    } finally {
      busy = false;
      if (socket.readableLength) close();
    }
  }

  async function readChunks(action: "proposal-chunk" | "approval-scope-chunk") {
    const frames: Buffer[] = [];
    let offset = 0;
    let digest: string | null = null;
    let total = 0;
    do {
      const frame = await exchange(
        requestFrame({
          version: 1,
          action,
          offset,
          ...(action === "proposal-chunk"
            ? { proposal_digest: digest }
            : { scope_digest: digest }),
        }),
        CHUNK_LIMIT,
      );
      const envelope = record(payload(frame), ["version", "ok", "result"]);
      const item = record(envelope.result, [
        "version",
        "digest",
        "offset",
        "bytes",
        "data_base64",
        "complete",
      ]);
      if (
        envelope.version !== 1 ||
        envelope.ok !== true ||
        item.version !== 1 ||
        typeof item.digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(item.digest) ||
        (digest !== null && item.digest !== digest) ||
        item.offset !== offset ||
        typeof item.bytes !== "number" ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 1 ||
        (total !== 0 && total !== item.bytes) ||
        typeof item.data_base64 !== "string" ||
        item.data_base64.length > 10924 ||
        typeof item.complete !== "boolean"
      )
        throw new Error("Invalid proposal chunk");
      const bytes = Buffer.from(item.data_base64, "base64");
      if (
        bytes.toString("base64") !== item.data_base64 ||
        bytes.length !== Math.min(8192, item.bytes - offset)
      )
        throw new Error("Invalid proposal chunk");
      digest = item.digest;
      total = item.bytes;
      offset += bytes.length;
      if (item.complete !== (offset === total))
        throw new Error("Invalid proposal chunk");
      if (total > MAX_PROPOSAL_BYTES) {
        // Each chunk is a separate exchange. Stop after the validated first
        // chunk, without accepting or requesting the rest of the payload.
        if (action === "approval-scope-chunk")
          throw new UnsupportedApprovalScope(
            "Approval scope exceeds size limit",
          );
        throw new UnsupportedOwnerPayload("Proposal exceeds size limit");
      }
      frames.push(frame);
    } while (offset < total);
    return frames;
  }

  return Object.freeze({
    close,
    snapshotSupported,
    snapshotAvailable: () => snapshotSupported && !closed && !socket.destroyed,
    snapshotVersionUnsupported: () => snapshotVersionUnsupported,
    async readSnapshot(selection?: {
      page: number;
      epoch: string;
      sequence: string;
    }) {
      if (!snapshotSupported) throw new Error("Unsupported owner operation");
      if (
        selection &&
        (!Number.isSafeInteger(selection.page) ||
          selection.page < 0 ||
          selection.page > 1000000 ||
          !/^[0-9a-f]{32}$/.test(selection.epoch) ||
          !/^(0|[1-9][0-9]{0,18})$/.test(selection.sequence))
      )
        throw new Error("Invalid snapshot selection");
      return operation(async () => {
        // Don't start another exchange after the sampling budget. A frame
        // already in flight still has a hard deadline and must drain safely.
        const sampleUntil = performance.now() + timeoutMs;
        const sample = (frame: Buffer) =>
          withinDeadline(() => exchange(frame, RESPONSE_LIMIT));
        const names = [
          "work_units",
          "attempts",
          "reservations",
          "claims",
          "correlations",
          "decisions",
          "usage_subtotals",
        ];
        const counts: Record<string, { sampled: number; total: number }> = {};
        const workUnits: ((string | null)[] | null)[] = [];
        const attempts: ((string | null)[] | null)[] = [];
        const decisions: (KernelDecision | null)[] = [];
        const correlations: (KernelCorrelation | null)[] = [];
        let commandCoverage:
          { sampled: number; total: number; complete: boolean } | undefined;
        let identity:
          | {
              epoch: string;
              sequence: string;
              revision: string | null;
              status: string;
              specDigest: string | null;
            }
          | undefined;
        const startPage = selection?.page ?? 0;
        let nextPage: number | null = null;
        // A stricter sampled cutoff is never hidden by a later page.
        let cutoffIndex = 0;
        for (
          let page = startPage;
          page < startPage + 8 && page <= 1000000;
          page++
        ) {
          if (page !== startPage && performance.now() >= sampleUntil) break;
          const frame = await sample(
            requestFrame({ version: 1, action: "snapshot", page }),
          );
          const envelope = snapshotEnvelope(frame, true);
          const snapshot = record(envelope.result, [
            "version",
            "producer",
            "scope",
            "program_revision",
            "spec_digest",
            "status",
            "work_units",
            "attempts",
            "reservations",
            "commands",
            "command_coverage",
            "claims",
            "correlations",
            "decisions",
            "usage_subtotals",
            "budget_configured",
            "budget_revoked",
            "authority",
            "missing_usage",
            "route_identity",
            "physical_settlement",
            "page",
            "coverage",
            "position",
          ]);
          const position = record(snapshot.position, [
            "producer",
            "scope",
            "sequence",
          ]);
          const coverage = record(snapshot.coverage, names);
          if (!matchesSnapshotScope(snapshot.scope, scope))
            throw new Error("Invalid snapshot scope");
          if (
            envelope.version !== 1 ||
            envelope.ok !== true ||
            snapshot.version !== 1 ||
            snapshot.page !== page ||
            typeof snapshot.producer !== "string" ||
            !/^[0-9a-f]{32}$/.test(snapshot.producer) ||
            position.producer !== snapshot.producer ||
            position.scope !== cursorScope ||
            (typeof position.sequence !== "number" &&
              typeof position.sequence !== "bigint") ||
            BigInt(position.sequence) < 0n ||
            BigInt(position.sequence) > 9223372036854775807n
          )
            throw new Error("Invalid snapshot");
          const authority = snapshot.authority;
          const cutoff =
            authority && typeof authority === "object" && "cutoff" in authority
              ? authority.cutoff
              : undefined;
          const observedCutoff = cutoffOrder.findIndex(
            (value) => value === cutoff,
          );
          cutoffIndex = Math.max(
            cutoffIndex,
            observedCutoff === -1 ? 1 : observedCutoff,
          );
          const current = {
            epoch: snapshot.producer,
            sequence: String(position.sequence),
            ...programHeader(snapshot),
          };
          if (
            selection &&
            !identity &&
            (selection.epoch !== current.epoch ||
              selection.sequence !== current.sequence)
          ) {
            // A caller's stale selection is not evidence of a producer gap.
            throw new SnapshotChanged("Snapshot changed during pagination");
          }
          if (
            identity &&
            (identity.epoch !== current.epoch ||
              identity.sequence !== current.sequence ||
              identity.revision !== current.revision ||
              identity.status !== current.status ||
              identity.specDigest !== current.specDigest)
          ) {
            priorHistoryGap = true;
            throw new SnapshotChanged("Snapshot changed during pagination");
          }
          identity ??= current;
          const commands = snapshot.commands;
          const command = snapshot.command_coverage;
          if (
            !Array.isArray(commands) ||
            commands.length > 64 ||
            !Array.isArray(command) ||
            command.length !== 3 ||
            command[0] !== commands.length ||
            !Number.isSafeInteger(command[1]) ||
            command[1] < command[0] ||
            typeof command[2] !== "boolean" ||
            command[2] !== (command[0] === command[1])
          )
            throw new Error("Invalid command coverage");
          const currentCommand = {
            sampled: command[0] as number,
            total: command[1] as number,
            complete: command[2] as boolean,
          };
          if (
            commandCoverage &&
            (commandCoverage.sampled !== currentCommand.sampled ||
              commandCoverage.total !== currentCommand.total ||
              commandCoverage.complete !== currentCommand.complete)
          )
            throw new Error("Command coverage changed");
          commandCoverage ??= currentCommand;
          for (const name of names) {
            const items = snapshot[name];
            const itemCoverage = coverage[name];
            if (
              !Array.isArray(items) ||
              items.length > 8 ||
              !Array.isArray(itemCoverage) ||
              itemCoverage.length !== 3 ||
              !Number.isSafeInteger(itemCoverage[1]) ||
              itemCoverage[1] < 0 ||
              itemCoverage[0] !== Math.min(page * 8, itemCoverage[1]) ||
              typeof itemCoverage[2] !== "boolean" ||
              items.length !==
                Math.min(8, Math.max(0, itemCoverage[1] - page * 8)) ||
              itemCoverage[2] !== page * 8 + 8 >= itemCoverage[1] ||
              (counts[name] !== undefined &&
                counts[name].total !== itemCoverage[1])
            )
              throw new Error("Invalid snapshot coverage");
            counts[name] = {
              sampled: (counts[name]?.sampled ?? 0) + items.length,
              total: itemCoverage[1],
            };
          }
          const rows = (name: "work_units" | "attempts") =>
            (snapshot[name] as unknown[]).map((value, index) => {
              if (Array.isArray(value)) {
                if (
                  value.length !== 4 ||
                  value.some(
                    (field, fieldIndex) =>
                      !(
                        name === "work_units" &&
                        fieldIndex >= 2 &&
                        field === null
                      ) &&
                      (typeof field !== "string" ||
                        !nonblankSnapshotIdentifier.test(field) ||
                        Buffer.byteLength(field) > 4096),
                  )
                )
                  throw new Error("Invalid snapshot record");
                return value as (string | null)[];
              }
              const omitted = record(value, [
                "oversized",
                "index",
                "bytes",
                "sha256",
              ]);
              if (
                omitted.oversized !== true ||
                omitted.index !== page * 8 + index ||
                !Number.isSafeInteger(omitted.bytes) ||
                (omitted.bytes as number) <= 4096 ||
                typeof omitted.sha256 !== "string" ||
                !/^[0-9a-f]{64}$/.test(omitted.sha256)
              )
                throw new Error("Invalid oversized snapshot record");
              return null;
            });
          workUnits.push(...rows("work_units"));
          attempts.push(...rows("attempts"));
          for (const [index, value] of (
            snapshot.decisions as unknown[]
          ).entries()) {
            if (
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              "oversized" in value
            ) {
              const omitted = record(value, [
                "oversized",
                "index",
                "bytes",
                "sha256",
              ]);
              if (
                omitted.oversized !== true ||
                omitted.index !== page * 8 + index ||
                !Number.isSafeInteger(omitted.bytes) ||
                (omitted.bytes as number) <= 4096 ||
                typeof omitted.sha256 !== "string" ||
                !/^[0-9a-f]{64}$/.test(omitted.sha256)
              )
                throw new Error("Invalid oversized decision");
              decisions.push(null);
              continue;
            }
            if (!value || typeof value !== "object" || Array.isArray(value))
              throw new Error("Invalid decision");
            const raw = value as Record<string, unknown>;
            const required = ["source", "attempt", "status", "applicability"];
            const optional = [
              "command_id",
              "decision_id",
              "review_operation_id",
            ];
            if (
              Object.keys(raw).some(
                (key) => !required.includes(key) && !optional.includes(key),
              ) ||
              required.some((key) => !Object.hasOwn(raw, key)) ||
              typeof raw.source !== "string" ||
              ![
                "product-review-operation",
                "served-command",
                "product-review",
              ].includes(raw.source) ||
              typeof raw.status !== "string" ||
              Buffer.byteLength(raw.status) > 4096 ||
              typeof raw.applicability !== "string" ||
              !["pending", "historical", "unknown"].includes(
                raw.applicability,
              ) ||
              (raw.attempt !== null &&
                (typeof raw.attempt !== "string" ||
                  Buffer.byteLength(raw.attempt) > 4096)) ||
              optional.some(
                (key) =>
                  Object.hasOwn(raw, key) &&
                  (typeof raw[key] !== "string" ||
                    Buffer.byteLength(raw[key] as string) > 4096),
              ) ||
              (raw.source === "served-command" &&
                typeof raw.command_id !== "string") ||
              (raw.source !== "served-command" &&
                (typeof raw.decision_id !== "string" ||
                  typeof raw.attempt !== "string" ||
                  Object.hasOwn(raw, "command_id") ||
                  Object.hasOwn(raw, "review_operation_id")))
            )
              throw new Error("Invalid decision");
            decisions.push({
              source: raw.source as string,
              status: raw.status,
              applicability:
                raw.applicability as KernelDecision["applicability"],
              attempt: raw.attempt as string | null,
              ...(Object.hasOwn(raw, "command_id")
                ? { commandId: raw.command_id as string }
                : {}),
              ...(Object.hasOwn(raw, "decision_id")
                ? { decisionId: raw.decision_id as string }
                : {}),
              ...(Object.hasOwn(raw, "review_operation_id")
                ? { reviewOperationId: raw.review_operation_id as string }
                : {}),
            });
          }
          for (const [index, value] of (
            snapshot.correlations as unknown[]
          ).entries()) {
            if (
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              "oversized" in value
            ) {
              const omitted = record(value, [
                "oversized",
                "index",
                "bytes",
                "sha256",
              ]);
              if (
                omitted.oversized !== true ||
                omitted.index !== page * 8 + index ||
                !Number.isSafeInteger(omitted.bytes) ||
                (omitted.bytes as number) <= 4096 ||
                typeof omitted.sha256 !== "string" ||
                !/^[0-9a-f]{64}$/.test(omitted.sha256)
              )
                throw new Error("Invalid oversized correlation");
              correlations.push(null);
              continue;
            }
            const row = record(value, [
              "attempt",
              "workspace_reference",
              "candidate_head",
              "candidate_scope",
              "runtime_handle",
            ]);
            if (
              typeof row.attempt !== "string" ||
              !nonblankSnapshotIdentifier.test(row.attempt) ||
              Buffer.byteLength(row.attempt) > 4096 ||
              [
                row.workspace_reference,
                row.candidate_head,
                row.candidate_scope,
                row.runtime_handle,
              ].some(
                (field) =>
                  field !== null &&
                  (typeof field !== "string" ||
                    Buffer.byteLength(field) > 4096),
              )
            )
              throw new Error("Invalid correlation");
            correlations.push({
              attempt: row.attempt,
              workspaceReference: row.workspace_reference as string | null,
              candidateHead: row.candidate_head as string | null,
              candidateScope: row.candidate_scope as string | null,
              runtimeHandlePresent: row.runtime_handle !== null,
            });
          }
          if (
            startPage * 8 + counts.work_units!.sampled >=
              counts.work_units!.total &&
            startPage * 8 + counts.attempts!.sampled >=
              counts.attempts!.total &&
            startPage * 8 + counts.decisions!.sampled >=
              counts.decisions!.total &&
            startPage * 8 + counts.correlations!.sampled >=
              counts.correlations!.total
          ) {
            nextPage = null;
            break;
          }
          nextPage = page < 1000000 ? page + 1 : null;
        }
        if (!identity) throw new Error("Snapshot unavailable");
        let history: "initial" | "continuous" | "gap" | "unknown" =
          priorHistoryGap ? "gap" : "initial";
        const skippedProgress =
          lastPosition !== undefined && performance.now() >= sampleUntil;
        if (lastPosition && !skippedProgress) {
          // Sequence is an int64; validated decimal text avoids JS rounding.
          const eventBody = Buffer.from(
            `{"version":1,"action":"events","after":{"producer":${JSON.stringify(lastPosition.producer)},"scope":${JSON.stringify(lastPosition.scope)},"sequence":${lastPosition.sequence}},"limit":${eventLimit}}`,
          );
          const eventFrame = Buffer.alloc(eventBody.length + 4);
          eventFrame.writeUInt32BE(eventBody.length);
          eventBody.copy(eventFrame, 4);
          const frame = await sample(eventFrame);
          const envelope = snapshotEnvelope(frame);
          const batch = record(envelope.result, ["events", "position", "gap"]);
          const end = record(batch.position, ["producer", "scope", "sequence"]);
          if (
            envelope.version !== 1 ||
            envelope.ok !== true ||
            !Array.isArray(batch.events) ||
            batch.events.length > eventLimit ||
            typeof batch.gap !== "boolean" ||
            typeof end.producer !== "string" ||
            !/^[0-9a-f]{32}$/.test(end.producer) ||
            end.scope !== cursorScope ||
            (typeof end.sequence !== "number" &&
              typeof end.sequence !== "bigint") ||
            BigInt(end.sequence) < 0n ||
            BigInt(end.sequence) > 9223372036854775807n
          )
            throw new Error("Invalid progress batch");
          let expected = BigInt(lastPosition.sequence);
          for (const value of batch.events) {
            const event = record(value, ["position", "kind", "revision"]);
            const at = record(event.position, [
              "producer",
              "scope",
              "sequence",
            ]);
            if (
              at.producer !== end.producer ||
              at.scope !== cursorScope ||
              (typeof at.sequence !== "number" &&
                typeof at.sequence !== "bigint") ||
              BigInt(at.sequence) < 1n ||
              BigInt(at.sequence) > 9223372036854775807n ||
              typeof event.kind !== "string" ||
              ![
                "snapshot-changed",
                "decision-required",
                "resync-required",
              ].includes(event.kind) ||
              (typeof event.revision !== "number" &&
                typeof event.revision !== "bigint") ||
              BigInt(event.revision) < 0n
            )
              throw new Error("Invalid progress event");
            if (
              !batch.gap &&
              (BigInt(at.sequence) !== ++expected ||
                event.kind === "resync-required")
            )
              throw new Error("Invalid progress sequence");
          }
          if (
            !batch.gap &&
            (end.producer !== lastPosition.producer ||
              BigInt(end.sequence) !== expected)
          )
            throw new Error("Invalid progress position");
          if (batch.gap) priorHistoryGap = true;
          const sequence = BigInt(end.sequence);
          const sampled = BigInt(identity.sequence);
          const mismatch =
            end.producer !== identity.epoch || sequence !== sampled;
          // A full, non-gap batch can stop at the last delivered hint, before
          // the producer's actual high-water mark. It cannot disprove the cut.
          const truncated =
            !batch.gap &&
            end.producer === identity.epoch &&
            sequence < sampled &&
            batch.events.length === eventLimit;
          if (selection && mismatch && !truncated) {
            priorHistoryGap = true;
            throw new SnapshotChanged("Snapshot changed during pagination");
          }
          if (mismatch) priorHistoryUnknown = true;
          history = priorHistoryGap
            ? "gap"
            : priorHistoryUnknown
              ? "unknown"
              : "continuous";
        } else if (skippedProgress) {
          history = priorHistoryGap ? "gap" : "unknown";
        } else if (seenSnapshot) {
          priorHistoryUnknown = true;
          history = priorHistoryGap ? "gap" : "unknown";
        }
        if (!skippedProgress)
          lastPosition = {
            producer: identity.epoch,
            scope: cursorScope,
            sequence: identity.sequence,
          };
        seenSnapshot = true;
        return {
          scope,
          epoch: identity.epoch,
          sequence: identity.sequence,
          revision: identity.revision,
          specDigest: identity.specDigest,
          authorityCutoff: cutoffOrder[cutoffIndex] ?? "unknown",
          status: identity.status,
          startPage,
          nextPage,
          counts,
          workUnits,
          attempts,
          decisions,
          correlations,
          commandCoverage: commandCoverage!,
          history,
        };
      }, false);
    },
    historyVersion,
    proposalSupported: supported("proposal-chunk"),
    approvalScopeSupported: approvalDeclared,
    get approvalSupported() {
      return approvalSupported && !closed && !socket.destroyed;
    },
    canSend() {
      return !closed && !busy && !socket.destroyed;
    },
    canReadDisposition,
    async readDisposition(command: Command): Promise<ApprovalDisposition> {
      if (!canReadDisposition(command))
        throw new Error("Approval disposition unavailable");
      const version =
        historyVersion === 2 && command.binding!.historyVersion === 2 ? 2 : 1;
      return operation(async () => {
        const frame = await exchange(
          requestFrame({
            version: 1,
            action:
              version === 2
                ? "approval-disposition-v2"
                : "approval-disposition",
            producer: verifiedPairing!.producer,
            recipient: verifiedPairing!.recipient,
            program_digest: ownerIdentityDigest(scope),
            actor_digest: command.binding!.actorDigest,
            original: command.request,
          }),
          RESPONSE_LIMIT,
        );
        const envelope = record(payload(frame), ["version", "ok", "result"]);
        if (envelope.version !== 1 || envelope.ok !== true)
          throw new Error("Invalid disposition envelope");
        const result = envelope.result as Record<string, unknown> | null;
        if (version === 2 && result?.status === "terminal-refusal") {
          const refusal = record(result, [
            "version",
            "status",
            "receipt",
            "reason",
          ]);
          if (
            refusal.version !== 2 ||
            refusal.receipt !== null ||
            refusal.reason !== "stale-revision"
          )
            throw new Error("Invalid terminal refusal");
          return { kind: "terminal-refusal", reason: "stale-revision" };
        }
        const disposition = record(result, ["version", "status", "receipt"]);
        if (disposition.version !== version)
          throw new Error("Invalid disposition version");
        if (disposition.status === "historical-receipt") {
          const receipt = classifyLocalOwnerResult(
            command.request,
            disposition.receipt,
          );
          if (receipt.kind === "historical-receipt-shape") return receipt;
        }
        if (
          disposition.receipt === null &&
          (disposition.status === "unknown" ||
            disposition.status === "intent-recorded")
        )
          return { kind: disposition.status };
        throw new Error("Invalid disposition result");
      });
    },
    async readProposal() {
      if (!supported("proposal-chunk"))
        throw new UnsupportedOwnerPayload("Unsupported owner operation");
      return operation(async () => {
        try {
          const frames = await readChunks("proposal-chunk");
          return assembleLocalOwnerProposal(frames, scope);
        } catch (error) {
          if (error instanceof UnsupportedOwnerPayload)
            approvalSupported = false;
          throw error;
        }
      });
    },
    async readApprovalScope() {
      if (!approvalDeclared)
        throw new UnsupportedApprovalScope("Unsupported owner operation");
      return operation(async () => {
        try {
          const frames = await readChunks("approval-scope-chunk");
          return assembleLocalOwnerApprovalScope(frames, scope);
        } catch (error) {
          if (!(error instanceof UnsupportedApprovalScope)) throw error;
          approvalSupported = false;
          throw error;
        }
      });
    },
    async readRevision() {
      if (!supported("snapshot"))
        throw new Error("Unsupported owner operation");
      return operation(async () => {
        const frame = await exchange(
          requestFrame({ version: 1, action: "snapshot" }),
          RESPONSE_LIMIT,
        );
        const envelope = snapshotEnvelope(frame, true);
        const snapshot = record(envelope.result, [
          "version",
          "producer",
          "scope",
          "program_revision",
          "spec_digest",
          "status",
          "work_units",
          "attempts",
          "reservations",
          "commands",
          "command_coverage",
          "claims",
          "correlations",
          "decisions",
          "usage_subtotals",
          "budget_configured",
          "budget_revoked",
          "authority",
          "missing_usage",
          "route_identity",
          "physical_settlement",
          "page",
          "coverage",
          "position",
        ]);
        if (
          envelope.version !== 1 ||
          envelope.ok !== true ||
          snapshot.version !== 1 ||
          !matchesSnapshotScope(snapshot.scope, scope) ||
          snapshot.page !== 0
        )
          throw new Error("Invalid owner snapshot");
        const header = programHeader(snapshot);
        if (header.revision === null)
          return { revision: "-1", status: "absent" };
        return {
          revision: header.revision,
          status: header.status,
          specDigest: header.specDigest!,
        };
      });
    },
    async sendCommand(
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ): Promise<OwnerObservation> {
      if (!isPreparedLocalOwnerCommand(command))
        throw new Error("Invalid owner command");
      if (
        typeof command.request.action !== "string" ||
        !supported(command.request.action) ||
        (command.request.action === "approve" && !approvalSupported)
      )
        throw new Error("Unsupported owner operation");
      if (
        !matchesPairing(command) ||
        (verifiedPairing && command.binding?.historyVersion !== historyVersion)
      )
        return { kind: "unknown" };
      try {
        return await operation(async () => {
          const frame = await exchange(command.frame(), RESPONSE_LIMIT);
          const envelope = record(payload(frame), ["version", "ok", "result"]);
          if (envelope.version !== 1 || envelope.ok !== true)
            throw new Error("Invalid owner envelope");
          const result = classifyLocalOwnerResult(
            command.request,
            envelope.result,
          );
          if (result.kind === "unknown") {
            const unknown = record(envelope.result, ["status", "settlement"]);
            if (
              unknown.status !== "unknown" ||
              unknown.settlement !== "unknown"
            )
              throw new Error("Invalid owner receipt");
            if (command.request.action === "approve")
              observedUnknown.add(command);
          } else {
            observedUnknown.delete(command);
          }
          return result;
        });
      } catch {
        observedUnknown.delete(command);
        return { kind: "unknown" };
      }
    },
    canReplay(command: ReturnType<typeof prepareLocalOwnerCommand>) {
      return approvalSupported && !closed && observedUnknown.has(command);
    },
    async replayCommand(command: ReturnType<typeof prepareLocalOwnerCommand>) {
      if (!approvalSupported || closed || !observedUnknown.has(command))
        throw new Error("Original owner channel unavailable");
      observedUnknown.delete(command);
      try {
        return await operation(async () => {
          const frame = await exchange(command.frame(), RESPONSE_LIMIT);
          const envelope = record(payload(frame), ["version", "ok", "result"]);
          if (envelope.version !== 1 || envelope.ok !== true)
            throw new Error("Invalid owner envelope");
          const result = classifyLocalOwnerResult(
            command.request,
            envelope.result,
          );
          if (result.kind === "unknown") {
            const unknown = record(envelope.result, ["status", "settlement"]);
            if (
              unknown.status !== "unknown" ||
              unknown.settlement !== "unknown"
            )
              throw new Error("Invalid owner receipt");
            observedUnknown.add(command);
          }
          return result;
        });
      } catch {
        observedUnknown.delete(command);
        return { kind: "unknown" } as const;
      }
    },
  });
}

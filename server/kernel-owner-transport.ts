import { Socket } from "node:net";
import { createHash } from "node:crypto";
import {
  assembleLocalOwnerProposal,
  MAX_PROPOSAL_BYTES,
} from "./kernel-owner-proposal.ts";
import {
  classifyLocalOwnerResult,
  isPreparedLocalOwnerCommand,
  parseOwnerJson,
  prepareLocalOwnerCommand,
  type OwnerObservation,
} from "./kernel-owner-v1.ts";

const RESPONSE_LIMIT = 1024 * 1024;
const CHUNK_LIMIT = 16 * 1024;

export class SnapshotChanged extends Error {}

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

function requestFrame(value: unknown): Buffer {
  const bytes = Buffer.from(JSON.stringify(value));
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
  let waiting: (() => void) | undefined;
  let lastPosition:
    { producer: string; scope: string; sequence: string } | undefined;
  let priorHistoryGap = false;
  let priorHistoryUnknown = false;
  let seenSnapshot = false;
  const encodedScope = JSON.stringify(scope).replace(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const scopeBytes = Buffer.byteLength(encodedScope);
  const scopeDigest = createHash("sha256").update(encodedScope).digest("hex");
  const cursorScope = scopeBytes > 4096 ? `sha256:${scopeDigest}` : scope;
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
      throw new Error("Owner channel unavailable");
    return new Promise((resolve, reject) => {
      let header: Buffer | undefined;
      let length = 0;
      let written = false;
      let response: Buffer | undefined;
      const fail = () => {
        waiting = undefined;
        reject(new Error("Owner channel unavailable"));
      };
      const read = () => {
        if (closed) return fail();
        if (!header) {
          header = (socket.read(4) as Buffer | null) ?? undefined;
          if (!header) return;
          if (header.length !== 4) return fail();
          length = header.readUInt32BE();
          if (length < 1 || length > limit) return fail();
        }
        if (!response) {
          const body = socket.read(length) as Buffer | null;
          if (!body) return;
          if (body.length !== length) return fail();
          response = Buffer.concat([header, body]);
        }
        if (socket.readableLength !== 0) return fail();
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

  async function operation<T>(run: () => Promise<T>): Promise<T> {
    if (closed || busy) throw new Error("Owner channel unavailable");
    busy = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            close();
            reject(new Error("Owner channel unavailable"));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof SnapshotChanged) throw error;
      close();
      throw new Error("Owner channel unavailable");
    } finally {
      if (timer) clearTimeout(timer);
      busy = false;
      if (socket.readableLength) close();
    }
  }

  return Object.freeze({
    close,
    async readSnapshot(selection?: {
      page: number;
      epoch: string;
      sequence: string;
    }) {
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
            }
          | undefined;
        const startPage = selection?.page ?? 0;
        for (
          let page = startPage;
          page < startPage + 8 && page <= 1000000;
          page++
        ) {
          const frame = await exchange(
            requestFrame({ version: 1, action: "snapshot", page }),
            RESPONSE_LIMIT,
          );
          const envelope = record(payload(frame), ["version", "ok", "result"]);
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
          if (scopeBytes > 4096) {
            const marker = record(snapshot.scope, [
              "oversized",
              "index",
              "bytes",
              "sha256",
            ]);
            if (
              marker.oversized !== true ||
              marker.index !== 0 ||
              marker.bytes !== scopeBytes ||
              marker.sha256 !== scopeDigest
            )
              throw new Error("Invalid snapshot scope");
          } else if (snapshot.scope !== scope)
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
            BigInt(position.sequence) > 9223372036854775807n ||
            typeof snapshot.status !== "string" ||
            !snapshot.status.trim() ||
            snapshot.status.length > 256 ||
            (snapshot.program_revision !== null &&
              ((typeof snapshot.program_revision !== "number" &&
                typeof snapshot.program_revision !== "bigint") ||
                BigInt(snapshot.program_revision) < 0n))
          )
            throw new Error("Invalid snapshot");
          const current = {
            epoch: snapshot.producer,
            sequence: String(position.sequence),
            revision:
              snapshot.program_revision === null
                ? null
                : String(snapshot.program_revision),
            status: snapshot.status,
          };
          if (
            selection &&
            (selection.epoch !== current.epoch ||
              selection.sequence !== current.sequence)
          ) {
            priorHistoryGap = true;
            throw new SnapshotChanged("Snapshot changed during pagination");
          }
          if (
            identity &&
            (identity.epoch !== current.epoch ||
              identity.sequence !== current.sequence ||
              identity.revision !== current.revision ||
              identity.status !== current.status)
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
                        !field.trim() ||
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
              ![
                "product-review-operation",
                "served-command",
                "product-review",
              ].includes(String(raw.source)) ||
              typeof raw.status !== "string" ||
              Buffer.byteLength(raw.status) > 4096 ||
              !["pending", "historical", "unknown"].includes(
                String(raw.applicability),
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
              !row.attempt.trim() ||
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
          )
            break;
        }
        if (!identity) throw new Error("Snapshot unavailable");
        let history: "initial" | "continuous" | "gap" | "unknown" =
          priorHistoryGap ? "gap" : "initial";
        if (lastPosition) {
          // Sequence is an int64; validated decimal text avoids JS rounding.
          const eventBody = Buffer.from(
            `{"version":1,"action":"events","after":{"producer":${JSON.stringify(lastPosition.producer)},"scope":${JSON.stringify(lastPosition.scope)},"sequence":${lastPosition.sequence}},"limit":256}`,
          );
          const eventFrame = Buffer.alloc(eventBody.length + 4);
          eventFrame.writeUInt32BE(eventBody.length);
          eventBody.copy(eventFrame, 4);
          const frame = await exchange(eventFrame, RESPONSE_LIMIT);
          const envelope = record(payload(frame), ["version", "ok", "result"]);
          const batch = record(envelope.result, ["events", "position", "gap"]);
          const end = record(batch.position, ["producer", "scope", "sequence"]);
          if (
            envelope.version !== 1 ||
            envelope.ok !== true ||
            !Array.isArray(batch.events) ||
            batch.events.length > 256 ||
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
              ![
                "snapshot-changed",
                "decision-required",
                "resync-required",
              ].includes(String(event.kind)) ||
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
          if (
            selection &&
            (end.producer !== identity.epoch ||
              BigInt(end.sequence) !== BigInt(identity.sequence))
          ) {
            priorHistoryGap = true;
            throw new SnapshotChanged("Snapshot changed during pagination");
          }
          if (
            end.producer !== identity.epoch ||
            BigInt(end.sequence) !== BigInt(identity.sequence)
          )
            priorHistoryUnknown = true;
          history = priorHistoryGap
            ? "gap"
            : priorHistoryUnknown
              ? "unknown"
              : "continuous";
        } else if (seenSnapshot) {
          priorHistoryUnknown = true;
          history = priorHistoryGap ? "gap" : "unknown";
        }
        lastPosition = {
          producer: identity.epoch,
          scope: cursorScope,
          sequence: identity.sequence,
        };
        seenSnapshot = true;
        return {
          scope,
          ...identity,
          startPage,
          counts,
          workUnits,
          attempts,
          decisions,
          correlations,
          commandCoverage: commandCoverage!,
          history,
        };
      });
    },
    async readProposal() {
      return operation(async () => {
        const frames: Buffer[] = [];
        let offset = 0;
        let digest: string | null = null;
        let total = 0;
        do {
          const frame = await exchange(
            requestFrame({
              version: 1,
              action: "proposal-chunk",
              offset,
              proposal_digest: digest,
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
            item.bytes > MAX_PROPOSAL_BYTES ||
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
          frames.push(frame);
        } while (offset < total);
        return assembleLocalOwnerProposal(frames, scope);
      });
    },
    async sendCommand(
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ): Promise<OwnerObservation> {
      if (!isPreparedLocalOwnerCommand(command))
        throw new Error("Invalid owner command");
      if (command.scope !== scope) return { kind: "unknown" };
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
          }
          return result;
        });
      } catch {
        return { kind: "unknown" };
      }
    },
  });
}

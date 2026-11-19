import { Socket } from "node:net";
import {
  assembleLocalOwnerApprovalScope,
  assembleLocalOwnerProposal,
  MAX_PROPOSAL_BYTES,
  UnsupportedApprovalScope,
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
  operations: readonly string[] | null = null,
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
  const supported = (name: string) =>
    operations === null ? name === "proposal-chunk" : operations.includes(name);
  let approvalSupported =
    supported("approval-scope-chunk") && supported("approve");
  const observedUnknown = new WeakSet<object>();
  let waiting: (() => void) | undefined;
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
    } catch {
      close();
      throw new Error("Owner channel unavailable");
    } finally {
      if (timer) clearTimeout(timer);
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
    return frames;
  }

  return Object.freeze({
    close,
    get approvalSupported() {
      return approvalSupported && !closed && !socket.destroyed;
    },
    canSend() {
      return !closed && !busy && !socket.destroyed;
    },
    async readProposal() {
      if (!supported("proposal-chunk"))
        throw new Error("Unsupported owner operation");
      return operation(async () =>
        assembleLocalOwnerProposal(await readChunks("proposal-chunk"), scope),
      );
    },
    async readApprovalScope() {
      if (!approvalSupported) throw new Error("Unsupported owner operation");
      const result = await operation(async () => {
        const frames = await readChunks("approval-scope-chunk");
        try {
          return assembleLocalOwnerApprovalScope(frames, scope);
        } catch (error) {
          if (!(error instanceof UnsupportedApprovalScope)) throw error;
          approvalSupported = false;
          return null;
        }
      });
      if (!result) throw new Error("Unsupported approval scope");
      return result;
    },
    async readRevision() {
      if (!supported("snapshot"))
        throw new Error("Unsupported owner operation");
      return operation(async () => {
        const frame = await exchange(
          requestFrame({ version: 1, action: "snapshot" }),
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
        if (
          envelope.version !== 1 ||
          envelope.ok !== true ||
          snapshot.version !== 1 ||
          snapshot.scope !== scope ||
          snapshot.page !== 0
        )
          throw new Error("Invalid owner snapshot");
        if (
          snapshot.status === "absent" &&
          snapshot.program_revision === null &&
          snapshot.spec_digest === null
        )
          return { revision: "-1", status: "absent" };
        if (
          !["draft", "active", "paused", "completed", "cancelled"].includes(
            String(snapshot.status),
          ) ||
          typeof snapshot.spec_digest !== "string" ||
          !/^[0-9a-f]{64}$/.test(snapshot.spec_digest) ||
          (typeof snapshot.program_revision !== "number" &&
            typeof snapshot.program_revision !== "bigint")
        )
          throw new Error("Invalid owner snapshot");
        const revision = BigInt(snapshot.program_revision);
        if (revision < 0n || revision > 9223372036854775807n)
          throw new Error("Invalid owner revision");
        return {
          revision: revision.toString(),
          status: String(snapshot.status),
          specDigest: snapshot.spec_digest,
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

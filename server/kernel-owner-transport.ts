import { Socket } from "node:net";
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

  return Object.freeze({
    close,
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

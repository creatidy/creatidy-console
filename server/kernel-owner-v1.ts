import { randomUUID } from "node:crypto";
import { iterator, parse, type ObjectNode } from "@humanwhocodes/momoa";

// This codec describes Kernel's existing host-bound local v1 frames. It is not
// a transport, capability, principal, or permission to dispatch a command.
type Integer = number | bigint;
type Action = "approve" | "start-managed" | "stop" | "reconcile";
type Request = Readonly<Record<string, string | number | bigint>>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid owner intent");
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    keys.toSorted().every((key, index) => key === actual[index])
  );
}

function text(value: unknown, maximum: number) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  )
    throw new Error("Invalid owner intent");
  return value;
}

function integer(value: unknown, minimum: bigint): Integer {
  if (
    typeof value === "bigint" &&
    value >= minimum &&
    value.toString().length <= 128
  )
    return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    BigInt(value) >= minimum
  )
    return value;
  throw new Error("Invalid owner intent");
}

function json(value: unknown) {
  const api = JSON as JSON & { rawJSON: (source: string) => unknown };
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? api.rawJSON(item.toString()) : item,
  );
}

export function prepareLocalOwnerCommand(
  input: unknown,
  generateId: () => string = randomUUID,
) {
  const intent = object(input);
  const action = intent.action;
  if (
    action !== "approve" &&
    action !== "start-managed" &&
    action !== "stop" &&
    action !== "reconcile"
  )
    throw new Error("Unsupported owner action");
  const fields =
    action === "approve"
      ? ["action", "expected_revision", "decision_id", "expires_at"]
      : action === "stop"
        ? ["action", "expected_revision", "reason"]
        : action === "reconcile"
          ? ["action", "expected_revision", "subject", "evidence"]
          : ["action", "expected_revision"];
  if (!exact(intent, fields)) throw new Error("Invalid owner intent");
  const revision = integer(
    intent.expected_revision,
    action === "approve" ? -1n : 0n,
  );
  const details: Record<string, string | number | bigint> = {};
  if (action === "approve") {
    details.decision_id = text(intent.decision_id, 256);
    details.expires_at = integer(intent.expires_at, 1n);
  } else if (action === "stop") {
    details.reason = text(intent.reason, 512);
  } else if (action === "reconcile") {
    const subject = text(intent.subject, 64);
    if (!/^[0-9a-f]{64}$/.test(subject))
      throw new Error("Invalid owner intent");
    details.subject = subject;
    details.evidence = text(intent.evidence, 512);
  }
  const commandId = text(generateId(), 256);
  const request: Request = Object.freeze({
    version: 1,
    action,
    command_id: commandId,
    expected_revision: revision,
    ...details,
  });
  const payload = Buffer.from(json(request));
  if (payload.length < 1 || payload.length > 65536)
    throw new Error("Owner frame exceeds limit");
  const encoded = Buffer.allocUnsafe(4 + payload.length);
  encoded.writeUInt32BE(payload.length, 0);
  payload.copy(encoded, 4);
  return Object.freeze({
    commandId,
    request,
    frame: () => Buffer.from(encoded),
  });
}

export type OwnerObservation =
  | { kind: "unknown" }
  | {
      kind: "historical-receipt-shape";
      action: Action;
      status: "approved" | "accepted" | "recorded";
      settlement: "unknown" | "bound-managed-target-settled" | null;
    };

// A missing, refused, malformed or unmatched response cannot establish whether
// an effect occurred. Shape alone does not authenticate a producer or bind a
// response to a host capability. This function never dispatches or retries.
export function classifyLocalOwnerResult(
  request: Request,
  value: unknown,
): OwnerObservation {
  const unknown: OwnerObservation = { kind: "unknown" };
  try {
    const result = object(value);
    if (
      exact(result, ["status", "settlement"]) &&
      result.status === "unknown" &&
      result.settlement === "unknown"
    )
      return unknown;
    if (result.version !== 1 || result.authority !== "historical-only")
      return unknown;
    if (
      request.action === "approve" &&
      exact(result, [
        "version",
        "status",
        "decision_id",
        "spec_digest",
        "expires_at",
        "authority",
      ]) &&
      result.status === "approved" &&
      result.decision_id === request.decision_id &&
      typeof result.spec_digest === "string" &&
      /^[0-9a-f]{64}$/.test(result.spec_digest) &&
      BigInt(integer(result.expires_at, 1n)) ===
        BigInt(integer(request.expires_at, 1n))
    ) {
      return {
        kind: "historical-receipt-shape",
        action: "approve",
        status: "approved",
        settlement: null,
      };
    }
    if (
      request.action === "reconcile" &&
      exact(result, ["version", "status", "authority"]) &&
      result.status === "recorded"
    ) {
      return {
        kind: "historical-receipt-shape",
        action: "reconcile",
        status: "recorded",
        settlement: null,
      };
    }
    if (
      (request.action === "stop" || request.action === "start-managed") &&
      exact(result, ["version", "status", "settlement", "authority"]) &&
      result.status === "accepted" &&
      (result.settlement === "unknown" ||
        (request.action === "stop" &&
          result.settlement === "bound-managed-target-settled"))
    ) {
      return {
        kind: "historical-receipt-shape",
        action: request.action,
        status: "accepted",
        settlement: result.settlement,
      };
    }
  } catch {
    /* Preserve uncertainty; do not surface producer content. */
  }
  return unknown;
}

export function decodeLocalOwnerFrame(
  request: Request,
  input: Uint8Array,
): OwnerObservation {
  try {
    if (
      !(input instanceof Uint8Array) ||
      input.byteLength < 5 ||
      input.byteLength > 1024 * 1024 + 4
    )
      return { kind: "unknown" };
    const frame = Buffer.from(input);
    if (frame.readUInt32BE(0) !== frame.length - 4) return { kind: "unknown" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      frame.subarray(4),
    );
    const syntax = parse(text, { mode: "json" });
    for (const { node, phase } of iterator(syntax)) {
      if (phase !== "enter" || node.type !== "Object") continue;
      const keys = new Set<string>();
      for (const member of (node as ObjectNode).members) {
        if (member.name.type !== "String" || keys.has(member.name.value))
          throw new Error("Ambiguous producer response");
        keys.add(member.name.value);
      }
    }
    const parseNative = JSON.parse as unknown as (
      source: string,
      reviver: (
        key: string,
        value: unknown,
        context?: { source?: string },
      ) => unknown,
    ) => unknown;
    const value = parseNative(text, (_key, item, context) => {
      if (typeof item !== "number") return item;
      const raw = context?.source;
      if (!raw || !/^-?(?:0|[1-9]\d*)$/.test(raw) || raw.length > 128)
        throw new Error("Unsupported producer number");
      const number = BigInt(raw);
      return number >= BigInt(Number.MIN_SAFE_INTEGER) &&
        number <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(number)
        : number;
    });
    const envelope = object(value);
    if (
      !exact(envelope, ["version", "ok", "result"]) ||
      envelope.version !== 1 ||
      envelope.ok !== true
    )
      return { kind: "unknown" };
    return classifyLocalOwnerResult(request, envelope.result);
  } catch {
    return { kind: "unknown" };
  }
}

// The caller must obtain a producer-authorized channel under the future host
// contract. Normal Console operation does not provide or invoke this seam.
export function createLocalOwnerAttempt(
  input: unknown,
  generateId: () => string = randomUUID,
) {
  const command = prepareLocalOwnerCommand(input, generateId);
  let pending: Promise<OwnerObservation> | undefined;
  return Object.freeze({
    command,
    sendOnce(
      exchange: (frame: Uint8Array, signal: AbortSignal) => Promise<Uint8Array>,
      timeoutMs = 1000,
    ) {
      if (pending) return pending;
      if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 300_000
      )
        throw new Error("Invalid owner deadline");
      pending = (async () => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error("Owner response deadline expired"));
            }, timeoutMs);
          });
          const response = await Promise.race([
            Promise.resolve().then(() =>
              exchange(command.frame(), controller.signal),
            ),
            deadline,
          ]);
          return decodeLocalOwnerFrame(command.request, response);
        } catch {
          return { kind: "unknown" } as const;
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      return pending;
    },
  });
}

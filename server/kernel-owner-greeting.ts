import { iterator, parse, type ObjectNode } from "@humanwhocodes/momoa";

type ExpectedBinding = Readonly<{
  scope: string;
  producer: string;
  recipient: string;
}>;

// This validates only the producer's framed greeting. It does not authenticate
// the peer or acquire, protect, or authorize a descriptor.
export function validateOwnerGreeting(
  frame: Uint8Array,
  expected: ExpectedBinding,
) {
  const binding = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (
    typeof expected.scope !== "string" ||
    expected.scope.length === 0 ||
    typeof expected.producer !== "string" ||
    !binding.test(expected.producer) ||
    typeof expected.recipient !== "string" ||
    !binding.test(expected.recipient) ||
    !(frame instanceof Uint8Array) ||
    frame.byteLength < 5 ||
    frame.byteLength > 65540
  )
    throw new Error("Invalid owner greeting");

  try {
    const bytes = Buffer.from(frame);
    if (bytes.readUInt32BE(0) !== bytes.length - 4)
      throw new Error("Invalid frame length");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(4),
    );
    const syntax = parse(text, { mode: "json" });
    for (const { node, phase } of iterator(syntax)) {
      if (phase !== "enter" || node.type !== "Object") continue;
      const keys = new Set<string>();
      for (const member of (node as ObjectNode).members) {
        if (member.name.type !== "String" || keys.has(member.name.value))
          throw new Error("Duplicate field");
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
    const value = parseNative(text, (key, item, context) => {
      if (key === "wire_version" && context?.source !== "1")
        throw new Error("Invalid version representation");
      return item;
    });
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid object");
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const required = [
      "contract",
      "producer",
      "recipient",
      "role",
      "scope",
      "wire_version",
    ];
    if (
      keys.length !== required.length ||
      !required.every((key, index) => key === keys[index]) ||
      record.contract !== "creatidy-kernel-owner-descriptor-v1" ||
      record.wire_version !== 1 ||
      record.role !== "owner" ||
      record.scope !== expected.scope ||
      record.producer !== expected.producer ||
      record.recipient !== expected.recipient
    )
      throw new Error("Incompatible greeting");
  } catch {
    throw new Error("Invalid owner greeting");
  }
}

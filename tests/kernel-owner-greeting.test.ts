import { describe, expect, it } from "vitest";
import { validateOwnerGreeting } from "../server/kernel-owner-greeting.ts";

const expected = {
  scope: "program-1",
  producer: "kernel-1",
  recipient: "console-1",
};
const greeting = {
  contract: "creatidy-kernel-owner-descriptor-v1",
  wire_version: 1,
  role: "owner",
  ...expected,
};

function frame(text: string) {
  const payload = Buffer.from(text);
  const result = Buffer.alloc(4 + payload.length);
  result.writeUInt32BE(payload.length);
  payload.copy(result, 4);
  return result;
}

describe("synthetic Kernel owner greeting", () => {
  it("preserves legacy BOM handling but refuses BOM in v2 and non-string contracts", () => {
    const v2 = {
      ...greeting,
      contract: "creatidy-kernel-owner-descriptor-v2",
      operations: ["snapshot", "record", "events"],
    };
    expect(
      validateOwnerGreeting(
        frame(`\ufeff${JSON.stringify(greeting)}`),
        expected,
      ),
    ).toBeNull();
    expect(() =>
      validateOwnerGreeting(frame(`\ufeff${JSON.stringify(v2)}`), expected),
    ).toThrow();
    expect(() =>
      validateOwnerGreeting(
        frame(JSON.stringify({ ...greeting, contract: [greeting.contract] })),
        expected,
      ),
    ).toThrow();
  });
  it("accepts only complete v2 operation sets and retains exact v1 as legacy", () => {
    const base = ["snapshot", "record", "events"];
    const proposal = ["proposal", "proposal-chunk"];
    const approval = ["approval-scope", "approval-scope-chunk", "approve"];
    const v2 = { ...greeting, contract: "creatidy-kernel-owner-descriptor-v2" };
    expect(
      validateOwnerGreeting(frame(JSON.stringify(greeting)), expected),
    ).toBeNull();
    for (const operations of [
      base,
      [...base, ...proposal],
      [...approval, ...proposal, ...base],
    ])
      expect(
        validateOwnerGreeting(
          frame(JSON.stringify({ ...v2, operations })),
          expected,
        ),
      ).toEqual(operations);
    for (const operations of [
      [],
      [...base, "proposal"],
      [...base, ...proposal, "approve"],
      [...base, ...approval],
      [...base, "snapshot"],
      [...base, "stop"],
      [...base, 1],
    ])
      expect(() =>
        validateOwnerGreeting(
          frame(JSON.stringify({ ...v2, operations })),
          expected,
        ),
      ).toThrow();
    expect(() =>
      validateOwnerGreeting(
        frame(JSON.stringify({ ...v2, operations: base, wire_version: 2 })),
        expected,
      ),
    ).toThrow();
    expect(() =>
      validateOwnerGreeting(
        frame(JSON.stringify({ ...greeting, operations: base })),
        expected,
      ),
    ).toThrow();
  });
  it("accepts the exact producer contract and binding", () => {
    expect(() =>
      validateOwnerGreeting(frame(JSON.stringify(greeting)), expected),
    ).not.toThrow();
  });

  it("rejects mismatched, extra, duplicate and invalid fields", () => {
    for (const value of [
      { ...greeting, scope: "other" },
      { ...greeting, producer: "other" },
      { ...greeting, recipient: "other" },
      { ...greeting, role: "worker" },
      { ...greeting, wire_version: 2 },
      { ...greeting, extra: true },
    ])
      expect(() =>
        validateOwnerGreeting(frame(JSON.stringify(value)), expected),
      ).toThrow();
    const duplicate = JSON.stringify(greeting).replace(
      '"role":"owner"',
      '"role":"owner","role":"owner"',
    );
    expect(() => validateOwnerGreeting(frame(duplicate), expected)).toThrow();
    const fractionalVersion = JSON.stringify(greeting).replace(
      '"wire_version":1',
      '"wire_version":1.0',
    );
    expect(() =>
      validateOwnerGreeting(frame(fractionalVersion), expected),
    ).toThrow();
    expect(() =>
      validateOwnerGreeting(frame(JSON.stringify(greeting)), {
        ...expected,
        producer: "not valid",
      }),
    ).toThrow();
  });

  it("rejects truncated, oversized and invalid UTF-8 frames", () => {
    const truncated = frame(JSON.stringify(greeting)).subarray(0, 12);
    expect(() => validateOwnerGreeting(truncated, expected)).toThrow();
    expect(() =>
      validateOwnerGreeting(frame(" ".repeat(65537)), expected),
    ).toThrow();
    expect(() =>
      validateOwnerGreeting(Buffer.from([0, 0, 0, 1, 0xff]), expected),
    ).toThrow();
  });
});

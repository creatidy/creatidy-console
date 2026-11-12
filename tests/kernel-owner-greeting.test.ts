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

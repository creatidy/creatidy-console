import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assembleLocalOwnerProposal,
  MAX_PROPOSAL_BYTES,
} from "../server/kernel-owner-proposal.ts";

const subject = {
  origin: "https://example.test",
  repository: "owner/repo",
  issue: 1,
  branch: "develop",
  base: "a".repeat(40),
};
const declaration = JSON.stringify({
  version: 1,
  outcome: "outcome",
  criteria: ["criterion"],
  quality: [],
  interface: [],
  context: [],
  unknowns: [],
  paths: [],
  network: [],
  effects: [],
  recipes: ["recipe"],
  provenance: ["source"],
});
function proposal() {
  return {
    version: 1,
    kind: "ordinary-program-proposal",
    program: "program",
    objective: "x".repeat(9000),
    drafts: [
      {
        kind: "ordinary-draft",
        version: 1,
        task_id: "task",
        revision: 1,
        parent_digest: null,
        declaration,
        evidence: {
          subject,
          issue_digest: "digest",
          issue_updated: "date",
          issue_state: "open",
          source: "source",
          recipe_digest: "digest",
          baseline_producer: "producer",
          baseline_reference: "reference",
          baseline_result: "result",
          relevance_producer: "producer",
          relevance_reference: "reference",
          relevance_proof: "proof",
          disposition: "work_remains",
        },
        observed_at: 1,
      },
    ],
    dependencies: [
      {
        subject,
        required: [],
        reference: "reference",
        complete: true,
        observed_at: 1,
        fresh_until: 2,
      },
    ],
  };
}
function frame(text: string) {
  const bytes = Buffer.from(text);
  const result = Buffer.alloc(bytes.length + 4);
  result.writeUInt32BE(bytes.length);
  bytes.copy(result, 4);
  return result;
}
function chunks(raw: Buffer) {
  const digest = createHash("sha256").update(raw).digest("hex");
  const result = [];
  for (let offset = 0; offset < raw.length; offset += 8192) {
    const part = raw.subarray(offset, offset + 8192);
    result.push({
      version: 1,
      digest,
      offset,
      bytes: raw.length,
      data_base64: part.toString("base64"),
      complete: offset + part.length === raw.length,
    });
  }
  return result;
}
function frames(items: unknown[]) {
  return items.map((result) =>
    frame(JSON.stringify({ version: 1, ok: true, result })),
  );
}

describe("synthetic Kernel proposal chunks", () => {
  it("assembles a proposal larger than one producer response", () => {
    const value = proposal();
    value.objective = "x".repeat(1024 * 1024 + 1);
    const raw = Buffer.from(JSON.stringify(value));
    const result = assembleLocalOwnerProposal(frames(chunks(raw)), "program");
    expect(result.text).toBe(raw.toString("utf8"));
    expect(result.digest).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("assembles exact bytes and retains large integers without granting authority", () => {
    const raw = Buffer.from(
      JSON.stringify(proposal())
        .replace('"issue":1', '"issue":9007199254740993')
        .replace('"issue":1', '"issue":9007199254740993'),
    );
    const result = assembleLocalOwnerProposal(frames(chunks(raw)), "program");
    expect(result.digest).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(result.text).toBe(raw.toString("utf8"));
    expect(
      (
        result.proposal.drafts as { evidence: { subject: { issue: bigint } } }[]
      )[0]?.evidence.subject.issue,
    ).toBe(9007199254740993n);
    expect(() =>
      assembleLocalOwnerProposal(frames(chunks(raw)), "different"),
    ).toThrow();
  });
  it("rejects inconsistent, incomplete, oversized and noncanonical chunks", () => {
    const items = chunks(Buffer.from(JSON.stringify(proposal())));
    for (const altered of [
      items.slice(0, 1),
      [items[1], items[0]],
      [items[0], { ...items[1], digest: "b".repeat(64) }],
      [{ ...items[0], bytes: MAX_PROPOSAL_BYTES + 1 }],
      [{ ...items[0], data_base64: items[0]?.data_base64 + "=" }],
      [{ ...items[0], data_base64: "A".repeat(16 * 1024) }],
      [{ ...items[0], complete: true }],
      [
        { ...items[0], digest: "b".repeat(64) },
        { ...items[1], digest: "b".repeat(64) },
      ],
    ])
      expect(() =>
        assembleLocalOwnerProposal(frames(altered), "program"),
      ).toThrow();
  });
  it("rejects duplicate keys, lossy numbers, invalid UTF-8 and unknown schema", () => {
    const raw = JSON.stringify(proposal());
    for (const bytes of [
      Buffer.from(raw.replace('"version":1', '"version":1,"version":1')),
      Buffer.from(raw.replace('"version":1', '"version":1.0')),
      Buffer.from(raw.replace('"ordinary-draft"', '"future-draft"')),
      Buffer.concat([Buffer.from(raw), Buffer.from([0xff])]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(raw)]),
    ])
      expect(() =>
        assembleLocalOwnerProposal(frames(chunks(bytes)), "program"),
      ).toThrow();
    const items = chunks(Buffer.from(raw));
    const bad = frames(items);
    bad[0] = frame(
      JSON.stringify({ version: 1, ok: true, result: items[0] }).replace(
        '"ok":true',
        '"ok":true,"\\u006f\\u006b":true',
      ),
    );
    expect(() => assembleLocalOwnerProposal(bad, "program")).toThrow();
  });
});

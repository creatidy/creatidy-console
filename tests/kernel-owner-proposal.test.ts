import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FORGEJO_ORIGIN,
  forgejoSubjectRoutes,
} from "../server/forgejo-navigation.ts";
import {
  assembleLocalOwnerApprovalScope,
  assembleLocalOwnerProposal,
  MAX_PROPOSAL_BYTES,
  UnsupportedOwnerPayload,
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
  it("projects exact Forgejo subjects only from a supported verified proposal", () => {
    const sample = proposal();
    const read = (changes: Partial<typeof subject>) => {
      const exact = { ...subject, ...changes };
      sample.drafts[0]!.evidence.subject = exact;
      sample.dependencies[0]!.subject = exact;
      sample.drafts[0]!.evidence.baseline_reference = `${FORGEJO_ORIGIN}/owner/repo/pulls/2`;
      return assembleLocalOwnerProposal(
        frames(chunks(Buffer.from(JSON.stringify(sample)))),
        "program",
      ).forgejoSubjects;
    };
    expect(read({ origin: FORGEJO_ORIGIN })).toEqual([
      { repository: "owner/repo", issue: "1", base: subject.base },
    ]);
    expect(read({ origin: `${FORGEJO_ORIGIN.toUpperCase()}` })).toEqual([]);
    expect(
      read({ origin: "https://forgejo.creatidy.com.example.test" }),
    ).toEqual([]);
    expect(read({ origin: FORGEJO_ORIGIN, repository: "owner/.." })).toEqual(
      [],
    );
    expect(read({ origin: FORGEJO_ORIGIN, base: "a".repeat(64) })).toEqual([
      { repository: "owner/repo", issue: "1", base: null },
    ]);
  });

  it("builds only fixed Forgejo issue and full recorded-base routes", () => {
    const exact = {
      repository: "owner/repo",
      issue: "9223372036854775807",
      base: subject.base,
    };
    expect(forgejoSubjectRoutes(exact)).toMatchObject({
      issueHref: `${FORGEJO_ORIGIN}/owner/repo/issues/9223372036854775807`,
      baseHref: `${FORGEJO_ORIGIN}/owner/repo/commit/${subject.base}`,
    });
    for (const input of [
      { repository: "owner/%2E%2E" },
      { repository: "owner/.." },
      { repository: "owner/repo?secret=synthetic" },
      { repository: "//example.test" },
      { repository: "owner/repo\n" },
      { issue: "1?token=synthetic" },
      { issue: "9223372036854775808" },
      { issue: 1 },
      { issue: "01" },
    ])
      expect(forgejoSubjectRoutes({ ...exact, ...input })).toBeNull();
    expect(
      forgejoSubjectRoutes({ ...exact, base: "refs/heads/develop" })?.baseHref,
    ).toBeNull();
  });

  it("validates bounded, digest-verified approval-scope evidence", () => {
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
      proposal: proposal(),
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
        work_budget: budget,
        project_budget: budget,
        project_id: "project",
      },
      verification: {
        reference,
        checks: ["paths", "structural", "commands"],
        reviewer_required: true,
      },
      execution_profile: {
        harness: "codex",
        provider: null,
        model: null,
        effort: null,
        trust: "trusted_development",
      },
      execution_reference: `basic-harness-policy:${createHash("sha256").update('{"effort":null,"harness":"codex","model":null,"provider":null,"trust":"trusted_development"}').digest("hex")}`,
    };
    value.proposal.objective = `\u{1f680} ${value.proposal.objective}`;
    const raw = Buffer.from(JSON.stringify(value));
    const sorted = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(sorted);
      if (input && typeof input === "object")
        return Object.fromEntries(
          Object.entries(input)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, sorted(item)]),
        );
      return input;
    };
    const canonical = JSON.stringify(sorted(value.proposal)).replace(
      /[\u007f-\uffff]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
    expect(
      assembleLocalOwnerApprovalScope(frames(chunks(raw)), "program"),
    ).toEqual(
      expect.objectContaining({
        digest: createHash("sha256").update(raw).digest("hex"),
        text: raw.toString(),
        proposalDigest: createHash("sha256").update(canonical).digest("hex"),
      }),
    );
    const qualified = {
      ...value,
      qualified_work_bindings: [
        {
          family: "work",
          implementation: "fixture",
          version: "1",
          origin: "https://example.test",
          tenant: "tenant",
          namespace: "work",
          api_version: "1",
          rights: "read",
        },
      ],
    };
    expect(() =>
      assembleLocalOwnerApprovalScope(
        frames(chunks(Buffer.from(JSON.stringify(qualified)))),
        "program",
      ),
    ).toThrow(UnsupportedOwnerPayload);
    expect(() =>
      assembleLocalOwnerApprovalScope(
        frames(
          chunks(
            Buffer.from(
              JSON.stringify({ ...qualified, qualified_work_bindings: [null] }),
            ),
          ),
        ),
        "program",
      ),
    ).not.toThrow(UnsupportedOwnerPayload);
    for (const altered of [
      { ...value, version: 2 },
      { ...value, policy: null },
      {
        ...value,
        policy: {
          ...value.policy,
          authority: {
            ...value.policy.authority,
            allowed_actions: ["future_action"],
          },
        },
      },
      {
        ...value,
        policy: { ...value.policy, work_budget: { ...budget, version: 2 } },
      },
      {
        ...value,
        verification: { ...value.verification, reviewer_required: false },
      },
      {
        ...value,
        execution_reference: `basic-harness-policy:${"f".repeat(64)}`,
      },
      { ...value, unexpected: true },
      { ...value, proposal: { ...value.proposal, program: "other" } },
    ])
      expect(() =>
        assembleLocalOwnerApprovalScope(
          frames(chunks(Buffer.from(JSON.stringify(altered)))),
          "program",
        ),
      ).toThrow();
  });
  it("classifies qualified v2/v3 separately from malformed qualified data and wrong Program", () => {
    const cut = {
      kind: "ordinary-qualified-dependencies",
      version: 1,
      subject: "subject",
      edges: [],
      required: [],
      classifications: [],
    };
    const v2 = { ...proposal(), version: 2, qualified_cuts: [cut] };
    const v3 = {
      ...proposal(),
      version: 3,
      drafts: [],
      dependencies: [],
      qualified_cuts: [],
      qualified_drafts: [
        {
          kind: "ordinary-qualified-draft",
          version: 1,
          task_id: "task",
          declaration,
          cut,
          ci_subjects: [],
        },
      ],
    };
    for (const value of [v2, v3])
      expect(() =>
        assembleLocalOwnerProposal(
          frames(chunks(Buffer.from(JSON.stringify(value)))),
          "program",
        ),
      ).toThrow(UnsupportedOwnerPayload);
    for (const value of [
      { ...v2, program: "other" },
      { ...v2, qualified_cuts: [] },
      { ...v3, qualified_drafts: [null] },
    ]) {
      const parse = () =>
        assembleLocalOwnerProposal(
          frames(chunks(Buffer.from(JSON.stringify(value)))),
          "program",
        );
      expect(parse).toThrow();
      expect(parse).not.toThrow(UnsupportedOwnerPayload);
    }
  });
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

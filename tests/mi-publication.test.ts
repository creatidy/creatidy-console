import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  compareMiPublications,
  inspectMiPublication,
} from "../server/mi-publication.ts";

function fixture(reverseNotice = false) {
  const subject = {
    kind: "plan",
    id: "plan",
    provider: "synthetic",
    generation: "v1",
  };
  const value = { price: null, quota: null, available: true, rules: null };
  const statements = ["a", "b"].map((id) => ({
    id,
    origin: "o",
    effective: "2026-01-01T00:00:00Z",
    replaces: null,
    subject,
    kind: "baseline",
    value,
  }));
  const notices = [
    {
      id: "n1",
      origin: "o",
      targets: ["statement:a", "statement:b"],
      effective: "2026-01-01T00:00:00Z",
      action: "revocation",
      reported_critical: true,
      replaces: null,
    },
    {
      id: "n2",
      origin: "o",
      targets: reverseNotice
        ? ["statement:b", "statement:a"]
        : ["statement:a", "statement:b"],
      effective: "2026-01-02T00:00:00Z",
      action: "retraction",
      reported_critical: null,
      replaces: "n1",
    },
  ];
  const payload = {
    applicability: {
      scope: "scope",
      channel: null,
      configuration: null,
      source_ids: ["source"],
    },
    observations: [
      {
        id: "o",
        source: "source",
        authority: "official",
        type: "documentation",
        reference: "https://example.invalid/",
        revision: null,
        rights: { distribution: "unknown", license: "unknown" },
        times: {
          acquired: "2026-01-01T00:00:00Z",
          observed: null,
          published: null,
          fresh_until: null,
        },
      },
    ],
    statements,
    notices,
    uncertain_campaigns: [],
  };
  const frame = {
    format_version: 1,
    payload_schema: "mi.public-evidence-working/2",
    produced_at: "2026-01-03T00:00:00Z",
    scope: "scope",
    members: [
      "statement:b",
      "observation:o",
      "notice:n2",
      "statement:a",
      "notice:n1",
    ],
    sources: [
      {
        source_id: "source",
        reference: "https://example.invalid/",
        revision: null,
      },
    ],
    payload: JSON.stringify(payload),
  };
  const artifact = JSON.stringify(frame);
  const expected = {
    format_version: 1,
    payload_schema: frame.payload_schema,
    sha256: createHash("sha256").update(artifact).digest("hex"),
  };
  const snapshot = {
    schema: "mi.operator-working/1",
    product: "model-intelligence",
    instance: "synthetic",
    evaluated_at: "2026-01-03T00:00:00Z",
    capabilities: {
      reads: ["status", "inspect", "export"],
      commands: [],
      replay: false,
    },
    publication: {
      state: "available",
      reference: expected,
      artifact,
      diagnostics: [],
    },
    health: {
      state: "missing",
      sha256: null,
      data: null,
      correlation: "unavailable",
    },
    facts: {
      latest: [],
      future: [],
      stale: [],
      unknown_freshness: [],
      notices: [],
      uncertain_campaigns: [],
      conflicts: [],
      projection: { offers: [], models: [], surfaces: [], conflicts: [] },
    },
    history: {
      scope: "retained-publication-cuts-only",
      replay: false,
      checkpoint: null,
      relation: "initial",
      evidence_added: [],
      projection_changed: null,
    },
  };
  return { snapshot, expected };
}

function editedCut(
  original: ReturnType<typeof fixture>,
  change: (payload: Record<string, any>, frame: Record<string, any>) => void,
) {
  const frame = JSON.parse(original.snapshot.publication.artifact);
  const payload = JSON.parse(frame.payload);
  change(payload, frame);
  frame.payload = JSON.stringify(payload);
  const artifact = JSON.stringify(frame);
  const reference = {
    ...original.expected,
    sha256: createHash("sha256").update(artifact).digest("hex"),
  };
  return {
    snapshot: {
      ...original.snapshot,
      publication: { ...original.snapshot.publication, artifact, reference },
    },
    expected: reference,
  };
}

describe("offline MI publication validation", () => {
  it("accepts a producer-valid U+FEFF-only instance", () => {
    const { snapshot, expected } = fixture();
    expect(
      inspectMiPublication(
        JSON.stringify({ ...snapshot, instance: "\ufeff" }),
        expected,
      ),
    ).toMatchObject({ status: "checked", reportedInstance: "\ufeff" });
  });
  it.each(["", " \u0085\u001f", "\ud800", "é".repeat(129)])(
    "rejects blank, invalid UTF-8 or out-of-bounds instances (%#)",
    (instance) => {
      const { snapshot, expected } = fixture();
      expect(
        inspectMiPublication(
          JSON.stringify({ ...snapshot, instance }),
          expected,
        ),
      ).toMatchObject({ status: "rejected" });
    },
  );
  it("checks a bounded cut without claiming identity or history", () => {
    const { snapshot, expected } = fixture();
    const result = inspectMiPublication(JSON.stringify(snapshot), expected);
    expect(result).toEqual({
      status: "checked",
      reportedInstance: "synthetic",
      reportedEvaluatedAt: "2026-01-03T00:00:00Z",
      digest: expected.sha256,
      schema: expected.payload_schema,
      observations: 1,
      statements: 2,
      notices: 2,
      uncertain: 0,
      history: "unavailable",
      reportedHealth: { state: "missing", correlation: "unavailable" },
      reportedFacts: snapshot.facts,
      reportedEvidence: {
        observations: JSON.parse(
          JSON.parse(snapshot.publication.artifact).payload,
        ).observations,
        statements: JSON.parse(
          JSON.parse(snapshot.publication.artifact).payload,
        ).statements,
        notices: JSON.parse(JSON.parse(snapshot.publication.artifact).payload)
          .notices,
        uncertainCampaigns: [],
      },
    });
  });
  it("rejects notice target reordering despite consistent hash", () => {
    const { snapshot, expected } = fixture(true);
    expect(inspectMiPublication(JSON.stringify(snapshot), expected)).toEqual({
      status: "rejected",
    });
  });
  it("rejects mismatched references, altered artifact and malformed history", () => {
    const { snapshot, expected } = fixture();
    expect(
      inspectMiPublication(JSON.stringify(snapshot), {
        ...expected,
        sha256: "0".repeat(64),
      }),
    ).toEqual({ status: "rejected" });
    expect(
      inspectMiPublication(
        JSON.stringify({
          ...snapshot,
          publication: {
            ...snapshot.publication,
            artifact: snapshot.publication.artifact + " ",
          },
        }),
        expected,
      ),
    ).toEqual({ status: "rejected" });
    expect(
      inspectMiPublication(
        JSON.stringify({
          ...snapshot,
          history: {
            ...snapshot.history,
            evidence_added: ["statement:not-present"],
          },
        }),
        expected,
      ),
    ).toEqual({ status: "rejected" });
  });
  it("labels mutable outer claims as reported, not authenticated", () => {
    const { snapshot, expected } = fixture();
    snapshot.instance = "changed-untrusted-claim";
    const changed = {
      ...snapshot,
      history: {
        ...snapshot.history,
        relation: "extension",
        checkpoint: "0".repeat(64),
        projection_changed: false,
      },
    };
    const result = inspectMiPublication(JSON.stringify(changed), expected);
    expect(result.status).toBe("checked");
    if (result.status === "checked") {
      expect(result.reportedInstance).toBe("changed-untrusted-claim");
      expect(result.history).toBe("unavailable");
    }
  });
  it("compares retained cuts without claiming earlier history", () => {
    const { snapshot, expected } = fixture();
    const previous = JSON.stringify(snapshot);
    expect(
      compareMiPublications(previous, expected, previous, expected),
    ).toEqual({ status: "duplicate", history: "unavailable" });
    const same = {
      ...snapshot,
      evaluated_at: "2026-01-04T00:00:00Z",
      history: {
        ...snapshot.history,
        checkpoint: expected.sha256,
        relation: "same",
        projection_changed: false,
      },
    };
    expect(
      compareMiPublications(previous, expected, JSON.stringify(same), expected),
    ).toEqual({ status: "following", history: "unavailable" });
    expect(
      compareMiPublications(
        previous,
        expected,
        JSON.stringify({ ...same, instance: "other" }),
        expected,
      ),
    ).toEqual({ status: "resync-required", history: "unavailable" });
    expect(
      compareMiPublications(
        previous,
        expected,
        JSON.stringify({ ...same, evaluated_at: "2026-01-02T00:00:00Z" }),
        expected,
      ),
    ).toEqual({ status: "resync-required", history: "unavailable" });
  });
  it("permits reacquisition but refuses provenance or rights rewrites", () => {
    const { snapshot, expected } = fixture();
    const previous = JSON.stringify(snapshot);
    function next(rewriteRights: boolean) {
      const frame = JSON.parse(snapshot.publication.artifact);
      const payload = JSON.parse(frame.payload);
      payload.observations[0].times.acquired = "2026-01-04T00:00:00Z";
      if (rewriteRights) payload.observations[0].rights.distribution = "public";
      frame.payload = JSON.stringify(payload);
      frame.produced_at = "2026-01-04T00:00:00Z";
      const artifact = JSON.stringify(frame);
      const reference = {
        ...expected,
        sha256: createHash("sha256").update(artifact).digest("hex"),
      };
      const after = {
        ...snapshot,
        evaluated_at: "2026-01-04T00:00:00Z",
        publication: { ...snapshot.publication, artifact, reference },
        history: {
          ...snapshot.history,
          checkpoint: expected.sha256,
          relation: "extension",
          projection_changed: false,
        },
      };
      return { text: JSON.stringify(after), reference };
    }
    const reacquired = next(false);
    expect(
      compareMiPublications(
        previous,
        expected,
        reacquired.text,
        reacquired.reference,
      ),
    ).toEqual({ status: "following", history: "unavailable" });
    const rewritten = next(true);
    expect(
      compareMiPublications(
        previous,
        expected,
        rewritten.text,
        rewritten.reference,
      ),
    ).toEqual({ status: "resync-required", history: "unavailable" });
  });
  it("rejects inconsistent manifests, duplicate identities and invalid times even after rehashing", () => {
    const initial = fixture();
    const variants = [
      editedCut(initial, (payload) => {
        payload.observations.push({ ...payload.observations[0] });
      }),
      editedCut(initial, (_payload, frame) => {
        frame.sources[0].reference = "https://different.invalid/";
      }),
      editedCut(initial, (payload) => {
        payload.statements[0].origin = "missing";
      }),
      editedCut(initial, (payload) => {
        payload.observations[0].times.acquired = "0001-01-01T00:00:00+01:00";
      }),
      editedCut(initial, (payload) => {
        payload.statements[0].value.available = "true";
      }),
      editedCut(initial, (payload) => {
        payload.statements[0].extra = "unsupported";
      }),
    ];
    for (const variant of variants)
      expect(
        inspectMiPublication(
          JSON.stringify(variant.snapshot),
          variant.expected,
        ),
      ).toEqual({ status: "rejected" });
  });
  it("preserves uncertain campaign boundaries and rejects invented bounds or empty terms", () => {
    const initial = fixture();
    const build = (mode: "valid" | "bounded" | "empty") =>
      editedCut(initial, (payload, frame) => {
        payload.uncertain_campaigns.push({
          id: "u",
          origin: "o",
          subject: payload.statements[0].subject,
          campaign: "synthetic",
          value:
            mode === "empty"
              ? { price: null, quota: null, available: null, rules: null }
              : { price: null, quota: null, available: true, rules: null },
          effective: "2026-01-01T00:00:00Z",
          start: mode === "bounded" ? "2026-01-01T00:00:00Z" : null,
          end: mode === "bounded" ? "2026-01-02T00:00:00Z" : null,
          conditions: [],
          window: null,
        });
        frame.members.push("uncertain:u");
      });
    const valid = build("valid");
    expect(
      inspectMiPublication(JSON.stringify(valid.snapshot), valid.expected)
        .status,
    ).toBe("checked");
    for (const mode of ["bounded", "empty"] as const) {
      const invalid = build(mode);
      expect(
        inspectMiPublication(
          JSON.stringify(invalid.snapshot),
          invalid.expected,
        ),
      ).toEqual({ status: "rejected" });
    }
  });
  it("rejects backwards lineage at microsecond precision", () => {
    const changed = editedCut(fixture(), (payload) => {
      payload.statements[0].effective = "2026-01-01T00:00:00.000002Z";
      payload.statements[1].effective = "2026-01-01T00:00:00.000001Z";
      payload.statements[1].replaces = "a";
    });
    expect(
      inspectMiPublication(JSON.stringify(changed.snapshot), changed.expected),
    ).toEqual({ status: "rejected" });
  });
  it("checks valid health digest and source correlation without asserting freshness", () => {
    const { snapshot, expected } = fixture();
    const data = {
      schema: "mi.source-refresh-working/1",
      adapter: "scope",
      attempted_at: "2026-01-03T00:00:00Z",
      succeeded: true,
      diagnostic: null,
      phase: "complete",
      active: expected.sha256,
      last_successful_publication_at: null,
      freshness_policy: "consumer-owned",
      remediation: null,
      sources: [
        {
          source_id: "source",
          reference: "https://example.invalid/",
          retrieved: true,
          revision: null,
          bytes_received: 0,
          diagnostic: null,
          remediation: null,
        },
      ],
    };
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value && typeof value === "object")
        return `{${Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`;
      return JSON.stringify(value);
    };
    const health = {
      state: "valid",
      sha256: createHash("sha256").update(canonical(data)).digest("hex"),
      data,
      correlation: "matched",
    };
    expect(
      inspectMiPublication(JSON.stringify({ ...snapshot, health }), expected)
        .status,
    ).toBe("checked");
    expect(
      inspectMiPublication(
        JSON.stringify({
          ...snapshot,
          health: { ...health, correlation: "mismatch" },
        }),
        expected,
      ),
    ).toEqual({ status: "rejected" });
    expect(
      inspectMiPublication(
        JSON.stringify({
          ...snapshot,
          health: { ...health, sha256: "0".repeat(64) },
        }),
        expected,
      ),
    ).toEqual({ status: "rejected" });
  });
});

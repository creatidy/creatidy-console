import { describe, expect, it } from "vitest";
import { inspectEmptyMiSnapshot } from "../server/mi-empty-snapshot.ts";

function emptySnapshot() {
  return {
    schema: "mi.operator-working/1",
    product: "model-intelligence",
    instance: "synthetic-instance",
    evaluated_at: "2026-11-13T00:00:00Z",
    capabilities: {
      reads: ["status", "inspect", "export"],
      commands: [],
      replay: false,
    },
    publication: {
      state: "empty",
      reference: null,
      artifact: null,
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
      relation: "unavailable",
      evidence_added: [],
      projection_changed: null,
    },
  };
}

describe("bounded offline MI empty snapshots", () => {
  it("accepts the exact empty shape without asserting producer identity", () => {
    expect(inspectEmptyMiSnapshot(JSON.stringify(emptySnapshot()))).toEqual({
      status: "empty",
      instance: "synthetic-instance",
      evaluatedAt: "2026-11-13T00:00:00Z",
      health: "missing",
    });
  });
  it("rejects ambiguous, malformed or fact-bearing empty snapshots", () => {
    const original = emptySnapshot();
    const invalid = {
      ...original,
      facts: { ...original.facts, latest: ["synthetic"] },
    };
    expect(inspectEmptyMiSnapshot(JSON.stringify(invalid))).toEqual({
      status: "invalid",
    });
    expect(inspectEmptyMiSnapshot('{"schema":"a","schema":"b"}')).toEqual({
      status: "invalid",
    });
    expect(
      inspectEmptyMiSnapshot(
        JSON.stringify({
          ...emptySnapshot(),
          evaluated_at: "2026-02-31T00:00:00Z",
        }),
      ),
    ).toEqual({ status: "invalid" });
    expect(
      inspectEmptyMiSnapshot(
        JSON.stringify({ ...emptySnapshot(), instance: "\ud800" }),
      ),
    ).toEqual({ status: "invalid" });
    expect(
      inspectEmptyMiSnapshot(
        JSON.stringify({ ...emptySnapshot(), instance: "\u0085" }),
      ),
    ).toEqual({ status: "invalid" });
    expect(
      inspectEmptyMiSnapshot(
        JSON.stringify({
          ...emptySnapshot(),
          health: { ...emptySnapshot().health, state: ["missing"] },
        }),
      ),
    ).toEqual({ status: "unsupported" });
    expect(inspectEmptyMiSnapshot(" ".repeat(256 * 1024 + 1))).toEqual({
      status: "invalid",
    });
  });
  it("does not activate a publication or unvalidated health data", () => {
    const available = emptySnapshot();
    available.publication.state = "available";
    expect(inspectEmptyMiSnapshot(JSON.stringify(available))).toEqual({
      status: "unsupported",
    });
    const health = emptySnapshot();
    health.health.state = "valid";
    expect(inspectEmptyMiSnapshot(JSON.stringify(health))).toEqual({
      status: "unsupported",
    });
  });
  it("distinguishes producer-reported invalid and unsupported states from malformed input", () => {
    const base = emptySnapshot();
    for (const [state, expected] of [
      ["invalid", "producer-invalid"],
      ["unsupported", "producer-unsupported"],
    ] as const) {
      const value = {
        ...base,
        publication: {
          state,
          reference: null,
          artifact: null,
          diagnostics: ["retained-publication-invalid-or-unreadable"],
        },
      };
      expect(inspectEmptyMiSnapshot(JSON.stringify(value))).toEqual({
        status: expected,
      });
      expect(
        inspectEmptyMiSnapshot(
          JSON.stringify({
            ...value,
            publication: { ...value.publication, diagnostics: [] },
          }),
        ),
      ).toEqual({ status: "invalid" });
      expect(
        inspectEmptyMiSnapshot(
          JSON.stringify({
            ...value,
            publication: {
              ...value.publication,
              diagnostics: ["untrusted detail"],
            },
          }),
        ),
      ).toEqual({ status: "invalid" });
    }
  });
});

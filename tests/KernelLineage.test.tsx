import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import KernelLineage, { type Snapshot } from "../src/KernelLineage";

const decision = {
  source: "served-command",
  attempt: null,
  status: "owner_decision_needed",
} as const;

it.each<[string, Snapshot["decisions"], string]>([
  [
    "pending",
    [{ ...decision, applicability: "pending" }],
    "Pending owner-decision records: 1.",
  ],
  [
    "historical",
    [{ ...decision, applicability: "historical" }],
    "Historical decision records: 1.",
  ],
  [
    "unknown",
    [{ ...decision, applicability: "unknown" }],
    "Readable decision records with unknown applicability: 1.",
  ],
  ["unreadable", [null], "Unreadable decision records: 1."],
  ["empty", [], "No decision records in this sample."],
])(
  "reports the %s decision window without implying another classification",
  (_kind, decisions, expected) => {
    const snapshot: Snapshot = {
      scope: "example",
      epoch: "a".repeat(32),
      sequence: "1",
      revision: "1",
      specDigest: "b".repeat(64),
      status: "active",
      history: "continuous",
      authorityCutoff: "not-expired-observed",
      startPage: 0,
      nextPage: null,
      counts: {
        decisions: { total: decisions.length, sampled: decisions.length },
      },
      workUnits: [],
      attempts: [],
      correlations: [],
      decisions,
      commandCoverage: { total: 0, sampled: 0, complete: true },
    };
    const [summary = ""] = renderToStaticMarkup(
      <KernelLineage snapshot={snapshot} visible />,
    ).split("<details>");
    expect(summary).toContain(expected);
    expect(
      summary.match(
        /Pending owner-decision records:|Historical decision records:|Readable decision records with unknown applicability:|Unreadable decision records:|No decision records in this sample\./g,
      ),
    ).toHaveLength(1);
  },
);

import type {
  createLocalOwnerTransport,
  KernelCorrelation,
  KernelDecision,
} from "../server/kernel-owner-transport";

export type Snapshot = Awaited<
  ReturnType<ReturnType<typeof createLocalOwnerTransport>["readSnapshot"]>
>;

function fact(value: string | null | undefined) {
  return value === "" ? "(empty string)" : (value ?? "unavailable");
}

function Reference({ value }: { value: string | null | undefined }) {
  // Quoted form marks boundaries and makes tabs, line breaks and invisible characters explicit.
  const exact =
    value == null
      ? "unavailable"
      : JSON.stringify(value).replace(/[\p{White_Space}\p{Cf}]/gu, (char) =>
          char === " "
            ? char
            : char
                .split("")
                .map(
                  (unit) =>
                    `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
                )
                .join(""),
        );
  return <code className="kernel-reference">{exact}</code>;
}

function Decision({ record }: { record: KernelDecision }) {
  return (
    <li>
      <strong>{fact(record.status)}</strong> ({record.applicability}); source:{" "}
      <code>{record.source}</code>; attempt:{" "}
      <Reference value={record.attempt} />.
      {record.decisionId !== undefined && (
        <>
          {" "}
          Decision: <Reference value={record.decisionId} />.
        </>
      )}
      {record.reviewOperationId !== undefined && (
        <>
          {" "}
          Review operation: <Reference value={record.reviewOperationId} />.
        </>
      )}
      {record.commandId !== undefined && (
        <>
          {" "}
          Recorded command key: <Reference value={record.commandId} />. Exact
          command correlation unavailable; the command actor binding is not
          supplied.
        </>
      )}
    </li>
  );
}

function Correlation({ record }: { record: KernelCorrelation }) {
  return (
    <li>
      Attempt: <Reference value={record.attempt} />; workspace reference:{" "}
      <Reference value={record.workspaceReference} />; candidate head:{" "}
      <Reference value={record.candidateHead} />; candidate scope:{" "}
      <Reference value={record.candidateScope} />; runtime handle:{" "}
      {record.runtimeHandlePresent ? "present, hidden" : "unavailable"}.
    </li>
  );
}

function LineageRecords({ snapshot }: { snapshot: Snapshot }) {
  const units = snapshot.workUnits.filter((row) => row !== null);
  const attempts = snapshot.attempts.filter((row) => row !== null);
  const decisions = snapshot.decisions.filter((row) => row !== null);
  const correlations = snapshot.correlations.filter((row) => row !== null);
  const unitIds = new Set(units.map(([id]) => id));
  const attemptIds = new Set(attempts.map(([id]) => id));
  const otherAttempts = attempts.filter(([, unit]) => !unitIds.has(unit));
  const otherDecisions = decisions.filter(
    ({ attempt }) => !attemptIds.has(attempt),
  );
  const otherCorrelations = correlations.filter(
    ({ attempt }) => !attemptIds.has(attempt),
  );

  function attemptFact(
    [id, unit, status, actor]: (typeof attempts)[number],
    index: number,
  ) {
    const references = correlations.filter((row) => row.attempt === id);
    const outcomes = decisions.filter((row) => row.attempt === id);
    return (
      <li key={index}>
        Attempt <Reference value={id} />: {status}; work unit:{" "}
        <Reference value={unit} />; actor: <Reference value={actor} />.
        {references.length ? (
          <ul>
            {references.map((record, index) => (
              <Correlation key={index} record={record} />
            ))}
          </ul>
        ) : (
          <p>
            Workspace, runtime and candidate evidence unavailable in this
            sample.
          </p>
        )}
        {outcomes.length ? (
          <ul>
            {outcomes.map((record, index) => (
              <Decision key={index} record={record} />
            ))}
          </ul>
        ) : (
          <p>No decision or outcome record sampled for this attempt.</p>
        )}
      </li>
    );
  }

  return (
    <>
      <h3>Sampled work units</h3>
      {!units.length && <p>No readable work unit records in this window.</p>}
      <ul>
        {units.map(([id, status, active, satisfaction], index) => {
          const unitAttempts = attempts.filter(([, unit]) => unit === id);
          return (
            <li key={index}>
              Work unit <Reference value={id} />: {status}; active attempt:{" "}
              <Reference value={active} />; recorded satisfaction reference:{" "}
              <Reference value={satisfaction} />.
              {active != null &&
                !unitAttempts.some(([attempt]) => attempt === active) && (
                  <p>
                    The active attempt record is unavailable in this sample.
                  </p>
                )}
              {unitAttempts.length ? (
                <ul>{unitAttempts.map(attemptFact)}</ul>
              ) : (
                <p>No attempt records sampled for this work unit.</p>
              )}
            </li>
          );
        })}
      </ul>
      {(otherAttempts.length > 0 ||
        otherCorrelations.length > 0 ||
        otherDecisions.length > 0) && (
        <>
          <h3>
            Records without a matching work unit or attempt in this sample
          </h3>
          <p>
            Collections are paged independently. A related record may be outside
            this window, omitted, or not supplied.
          </p>
          <ul>
            {otherAttempts.map(attemptFact)}
            {otherCorrelations.map((record, index) => (
              <Correlation key={`reference-${index}`} record={record} />
            ))}
            {otherDecisions.map((record, index) => (
              <Decision key={`decision-${index}`} record={record} />
            ))}
          </ul>
        </>
      )}
      {(units.length < snapshot.workUnits.length ||
        attempts.length < snapshot.attempts.length ||
        decisions.length < snapshot.decisions.length ||
        correlations.length < snapshot.correlations.length) && (
        <p>
          Oversized records omitted: {snapshot.workUnits.length - units.length}{" "}
          work units, {snapshot.attempts.length - attempts.length} attempts,{" "}
          {snapshot.decisions.length - decisions.length} decisions,{" "}
          {snapshot.correlations.length - correlations.length} correlations.
        </p>
      )}
    </>
  );
}

export default function KernelLineage({
  snapshot,
  visible,
}: {
  snapshot: Snapshot;
  visible: boolean;
}) {
  const pending = snapshot.decisions.filter(
    (row) => row?.applicability === "pending",
  );
  const ownerDecisions = pending.filter(
    (row) => row?.status === "owner_decision_needed",
  ).length;
  const uncertainReviews = pending.filter(
    (row) => row?.status === "review_unknown",
  ).length;
  const otherPending = pending.length - ownerDecisions - uncertainReviews;
  const omittedDecisions = snapshot.decisions.filter(
    (row) => row === null,
  ).length;
  return (
    <>
      {visible && (
        <>
          <p>
            {snapshot.status === "absent" ? (
              "No Program in this scope."
            ) : (
              <>
                Program status: <strong>{snapshot.status}</strong>; revision:{" "}
                <code>{snapshot.revision}</code>.
              </>
            )}
          </p>
          {snapshot.status !== "absent" && (
            <p className="snapshot-attention">
              <strong>Attention in this sample:</strong>{" "}
              {ownerDecisions
                ? `Pending owner-decision records: ${ownerDecisions}. `
                : "No pending owner decision in the readable records. "}
              {omittedDecisions > 0 &&
                `Unreadable decision records: ${omittedDecisions}. Their status and applicability are unavailable. `}
              {uncertainReviews > 0 &&
                `Pending review records with an unknown outcome: ${uncertainReviews}. `}
              {otherPending > 0 &&
                `Other pending decision records: ${otherPending}. `}
              {snapshot.history === "gap" &&
                "Kernel progress has a recorded gap. "}
              {snapshot.history === "unknown" &&
                "Kernel progress continuity is unknown. "}
              This is not a complete action list or a grant to act.
            </p>
          )}
          <p>
            Showing up to eight pages starting at producer page{" "}
            {snapshot.startPage}.
          </p>
        </>
      )}
      <details>
        <summary>Inspect Kernel lineage and recorded evidence</summary>
        {visible ? (
          <>
            <p>
              Scope: <Reference value={snapshot.scope} />; Program specification
              SHA-256: <code>{fact(snapshot.specDigest)}</code>.
            </p>
            <p>
              Projection epoch: <code>{snapshot.epoch}</code>; sequence:{" "}
              <code>{snapshot.sequence}</code>. The epoch is not a verified
              producer identity.
            </p>
            <p>
              Progress continuity for this descriptor: {snapshot.history}.
              Progress is a bounded hint, not durable history or acceptance;
              earlier gaps and unknown intervals remain visible.
            </p>
            <ul>
              {Object.entries(snapshot.counts).map(([name, count]) => (
                <li key={name}>
                  {name}: {count.total} total; {count.sampled} sampled
                </li>
              ))}
            </ul>
            <p>
              Kernel sampled {snapshot.commandCoverage.sampled} of{" "}
              {snapshot.commandCoverage.total} command records; full commands
              are not shown. IDs are matched only within this Kernel
              observation. References use quoted text to preserve exact
              characters.
            </p>
            <p>
              Attempt links are not candidate verdicts. This snapshot does not
              bind a review result to the candidate shown or verify current
              Forgejo state or external effect settlement.
            </p>
            <LineageRecords snapshot={snapshot} />
            <p>
              Detailed intent, effective policy and routing rationale, exact
              workspace host, harness attach, and candidate-bound verification,
              reviewer and iteration evidence are unavailable in this snapshot.
            </p>
          </>
        ) : (
          <p>Checking the Console session before showing evidence.</p>
        )}
      </details>
    </>
  );
}

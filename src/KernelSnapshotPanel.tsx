import { useEffect, useRef, useState } from "react";
import type {
  KernelCorrelation,
  KernelDecision,
} from "../server/kernel-owner-transport";

type Snapshot = {
  scope: string;
  epoch: string;
  sequence: string;
  revision: string | null;
  startPage: number;
  nextPage: number | null;
  status: string;
  history: "initial" | "continuous" | "gap" | "unknown";
  counts: Record<string, { sampled: number; total: number }>;
  workUnits: ((string | null)[] | null)[];
  attempts: ((string | null)[] | null)[];
  decisions: (KernelDecision | null)[];
  correlations: (KernelCorrelation | null)[];
  commandCoverage: { sampled: number; total: number; complete: boolean };
};
type Window = Pick<Snapshot, "epoch" | "sequence" | "startPage" | "nextPage">;

export default function KernelSnapshotPanel({
  expired,
}: {
  expired: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [window, setWindow] = useState<Window>();
  const [previousWindows, setPreviousWindows] = useState<number[]>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("No snapshot requested.");
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const hasSnapshot = useRef(false);

  useEffect(() => {
    const hide = (
      message = "Snapshot hidden. Request another snapshot to view current data.",
    ) => {
      generation.current++;
      active.current?.abort();
      active.current = null;
      hasSnapshot.current = false;
      setSnapshot(undefined);
      setWindow(undefined);
      setPreviousWindows([]);
      setVisible(false);
      setLoading(false);
      setMessage(message);
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(async () => {
      if (
        document.visibilityState !== "visible" ||
        !hasSnapshot.current ||
        active.current
      )
        return;
      const current = generation.current;
      const controller = new AbortController();
      active.current = controller;
      const deadline = setTimeout(() => controller.abort(), 5000);
      setVisible(false);
      try {
        const response = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (current !== generation.current) return;
        if (response.status === 401) {
          hide();
          expired();
        } else {
          const session = response.ok ? await response.json() : null;
          if (current !== generation.current) return;
          if (controller.signal.aborted || session?.authenticated !== true)
            hide();
          else if (session.snapshotAvailable !== true)
            hide("Kernel snapshot capability is no longer available.");
          else if (
            document.visibilityState === "visible" &&
            !controller.signal.aborted
          )
            setVisible(true);
        }
      } catch {
        if (current === generation.current) hide();
      } finally {
        clearTimeout(deadline);
        if (active.current === controller) active.current = null;
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      hide();
    };
  }, []);

  async function refresh(page?: number, backwards = false) {
    if (loading || document.visibilityState !== "visible") return;
    const selection =
      page === undefined || !window
        ? {}
        : { page, epoch: window.epoch, sequence: window.sequence };
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    let deadline = setTimeout(() => controller.abort(), 12000);
    hasSnapshot.current = false;
    setSnapshot(undefined);
    function resetWindow() {
      setWindow(undefined);
      setPreviousWindows([]);
    }
    if (page === undefined) resetWindow();
    setVisible(false);
    setMessage("Reading a bounded snapshot.");
    setLoading(true);
    try {
      const response = await fetch("/api/kernel/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selection),
        cache: "no-store",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      controller.signal.throwIfAborted();
      if (response.status === 401) return expired();
      if (!response.ok) throw new Error();
      const result = await response.json();
      controller.signal.throwIfAborted();
      if (
        current !== generation.current ||
        document.visibilityState !== "visible"
      )
        return;
      if (result.status !== "observed") {
        if (result.status !== "busy") resetWindow();
        setMessage(
          result.status === "resync-required"
            ? "The snapshot changed during the read. Request a fresh snapshot; the missed interval remains unknown."
            : result.status === "busy"
              ? "Another snapshot read is in progress. Try again."
              : result.status === "unavailable"
                ? "Kernel snapshots require a local Console and a configured read capability."
                : "Kernel snapshot unavailable; the read could not be completed.",
        );
        return;
      }
      clearTimeout(deadline);
      deadline = setTimeout(() => controller.abort(), 5000);
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      controller.signal.throwIfAborted();
      if (session.status === 401) return expired();
      const validated = session.ok ? await session.json() : null;
      if (validated?.authenticated !== true) throw new Error();
      controller.signal.throwIfAborted();
      if (
        current !== generation.current ||
        document.visibilityState !== "visible" ||
        controller.signal.aborted
      )
        return;
      if (validated.snapshotAvailable !== true) {
        resetWindow();
        setMessage("Kernel snapshot capability is no longer available.");
        return;
      }
      const next = result.snapshot as Snapshot;
      if (
        page !== undefined &&
        window &&
        next.epoch === window.epoch &&
        next.sequence === window.sequence
      ) {
        setPreviousWindows((windows) =>
          backwards
            ? windows.slice(0, -1)
            : [...windows.slice(-255), window.startPage],
        );
      } else {
        setPreviousWindows([]);
      }
      setSnapshot(next);
      setWindow({
        epoch: next.epoch,
        sequence: next.sequence,
        startPage: next.startPage,
        nextPage: next.nextPage,
      });
      hasSnapshot.current = true;
      setVisible(true);
      setMessage("Snapshot observed. It may have changed since this read.");
    } catch {
      if (current === generation.current) {
        if (controller.signal.aborted) {
          setMessage("Kernel snapshot read timed out. Try again.");
        } else {
          resetWindow();
          setMessage("Kernel snapshot unavailable.");
        }
      }
    } finally {
      clearTimeout(deadline);
      if (current === generation.current) {
        active.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <section aria-labelledby="kernel-snapshot-heading">
      <h2 id="kernel-snapshot-heading">Kernel snapshot</h2>
      <p role="status">{message}</p>
      <button type="button" disabled={loading} onClick={() => void refresh()}>
        Read snapshot
      </button>
      <button
        type="button"
        aria-disabled={loading || previousWindows.length === 0}
        onClick={() => {
          const previous = previousWindows.at(-1);
          if (previous !== undefined) void refresh(previous, true);
        }}
      >
        Previous pages
      </button>
      <button
        type="button"
        aria-disabled={loading || window?.nextPage == null}
        onClick={() => {
          if (window?.nextPage != null) void refresh(window.nextPage);
        }}
      >
        Next pages
      </button>
      {snapshot && visible && (
        <>
          <p>Scope: {snapshot.scope}</p>
          <p>
            Status: {snapshot.status}; program revision:{" "}
            {snapshot.revision ?? "unavailable"}
          </p>
          <p>
            Projection epoch: {snapshot.epoch}; sequence: {snapshot.sequence}.
            This epoch is not a verified producer identity.
          </p>
          <p>
            Counts are producer-reported snapshot coverage, not a complete event
            history. Other collections and full command records are not
            displayed.
          </p>
          <p>
            Progress since the preceding observation: {snapshot.history}.
            Progress is a bounded hint, not durable history; a gap remains
            unfilled by this snapshot.
          </p>
          <ul>
            {Object.entries(snapshot.counts).map(([name, count]) => (
              <li key={name}>
                {name}: {count.total} total; {count.sampled} sampled
              </li>
            ))}
          </ul>
          <p>
            Showing up to eight pages starting at producer page{" "}
            {snapshot.startPage}.
          </p>
          <h3>Sampled work units</h3>
          <ul>
            {snapshot.workUnits.map((row, index) => (
              <li key={index}>
                {row
                  ? `${row[0]}: ${row[1]}; active attempt: ${row[2] ?? "unavailable"}; satisfaction: ${row[3] ?? "unavailable"}`
                  : "Oversized record omitted."}
              </li>
            ))}
          </ul>
          <h3>Sampled attempts</h3>
          <ul>
            {snapshot.attempts.map((row, index) => (
              <li key={index}>
                {row
                  ? `${row[0]}: ${row[2]}; work unit: ${row[1]}; actor: ${row[3]}`
                  : "Oversized record omitted."}
              </li>
            ))}
          </ul>
          <h3>Recorded decisions</h3>
          <p>
            Kernel sampled {snapshot.commandCoverage.sampled} of{" "}
            {snapshot.commandCoverage.total} command records. Decision records
            are producer facts, not an action queue; a pending record does not
            by itself require owner action.
          </p>
          <ul>
            {snapshot.decisions.map((decision, index) => (
              <li key={index}>
                {decision ? (
                  <>
                    Source: {decision.source}; status:{" "}
                    {decision.status || "(empty string)"}; applicability:{" "}
                    {decision.applicability}; attempt:{" "}
                    {decision.attempt ?? "unavailable"}.
                    {decision.commandId !== undefined && (
                      <> Command: {decision.commandId}.</>
                    )}
                    {decision.decisionId !== undefined && (
                      <> Decision: {decision.decisionId}.</>
                    )}
                    {decision.reviewOperationId !== undefined && (
                      <> Review operation: {decision.reviewOperationId}.</>
                    )}
                  </>
                ) : (
                  "Oversized decision omitted."
                )}
              </li>
            ))}
          </ul>
          <h3>Kernel correlation facts</h3>
          <p>
            These are Kernel-provided references, not verified cross-product
            joins or evidence that external effects settled. Opaque runtime
            handles are not displayed.
          </p>
          <ul>
            {snapshot.correlations.map((row, index) => (
              <li key={index}>
                {row ? (
                  <>
                    Attempt: {row.attempt}; workspace:{" "}
                    {row.workspaceReference ?? "unavailable"}; candidate head:{" "}
                    {row.candidateHead === ""
                      ? "(empty string)"
                      : (row.candidateHead ?? "unavailable")}
                    ; candidate scope:{" "}
                    {row.candidateScope === ""
                      ? "(empty string)"
                      : (row.candidateScope ?? "unavailable")}
                    ; runtime handle:{" "}
                    {row.runtimeHandlePresent
                      ? "present, hidden"
                      : "unavailable"}
                    .
                  </>
                ) : (
                  "Oversized correlation omitted."
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

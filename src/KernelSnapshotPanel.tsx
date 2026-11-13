import { useEffect, useRef, useState } from "react";

type Snapshot = {
  scope: string;
  epoch: string;
  sequence: string;
  revision: string | null;
  status: string;
  history: "initial" | "continuous" | "gap" | "unknown";
  counts: Record<string, { sampled: number; total: number }>;
  workUnits: ((string | null)[] | null)[];
  attempts: ((string | null)[] | null)[];
};

export default function KernelSnapshotPanel({
  expired,
}: {
  expired: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("No snapshot requested.");
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const hasSnapshot = useRef(false);

  useEffect(() => {
    const hide = () => {
      generation.current++;
      active.current?.abort();
      hasSnapshot.current = false;
      setSnapshot(undefined);
      setVisible(false);
      setMessage(
        "Snapshot hidden. Request another snapshot to view current data.",
      );
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !hasSnapshot.current)
        return;
      const current = generation.current;
      const controller = new AbortController();
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
        } else if (
          !response.ok ||
          (await response.json()).authenticated !== true
        )
          hide();
        else if (
          current === generation.current &&
          document.visibilityState === "visible" &&
          !controller.signal.aborted
        )
          setVisible(true);
      } catch {
        if (current === generation.current) hide();
      } finally {
        clearTimeout(deadline);
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      hide();
    };
  }, []);

  async function refresh() {
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10000);
    hasSnapshot.current = false;
    setSnapshot(undefined);
    setVisible(false);
    setMessage("Reading a bounded snapshot.");
    try {
      const response = await fetch("/api/kernel/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      if (response.status === 401) return expired();
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (
        current !== generation.current ||
        document.visibilityState !== "visible"
      )
        return;
      if (result.status !== "observed") {
        setMessage(
          result.status === "resync-required"
            ? "The snapshot changed during the read. Request a fresh snapshot; the missed interval remains unknown."
            : result.status === "unavailable"
              ? "No Kernel capability is configured."
              : "Kernel snapshot unavailable; the read could not be completed.",
        );
        return;
      }
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      if (session.status === 401) return expired();
      if (!session.ok || (await session.json()).authenticated !== true)
        throw new Error();
      if (
        current !== generation.current ||
        document.visibilityState !== "visible" ||
        controller.signal.aborted
      )
        return;
      setSnapshot(result.snapshot as Snapshot);
      hasSnapshot.current = true;
      setVisible(true);
      setMessage("Snapshot observed. It may have changed since this read.");
    } catch {
      if (current === generation.current)
        setMessage("Kernel snapshot unavailable.");
    } finally {
      clearTimeout(deadline);
    }
  }

  return (
    <section aria-labelledby="kernel-snapshot-heading">
      <h2 id="kernel-snapshot-heading">Kernel snapshot</h2>
      <p role="status">{message}</p>
      <button type="button" onClick={() => void refresh()}>
        Read snapshot
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
            history. Other collections and command history are not displayed.
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
        </>
      )}
    </section>
  );
}

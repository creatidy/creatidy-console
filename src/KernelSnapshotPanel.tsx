import { useEffect, useRef, useState } from "react";
import KernelLineage, { type Snapshot } from "./KernelLineage";
import type { KernelSnapshotStatus } from "../server/kernel-owner-transport";

type Window = Pick<Snapshot, "epoch" | "sequence" | "startPage" | "nextPage">;
const capabilityMessages: Record<KernelSnapshotStatus, string> = {
  ready:
    "No snapshot requested. Read the local snapshot to inspect recorded work.",
  unavailable:
    "Optional. No supported local Kernel snapshot capability is configured for this connection.",
  disconnected: "The configured Kernel snapshot channel is closed.",
  unsupported:
    "The Kernel snapshot contract version is unsupported. Console closed the channel and did not accept any facts from the read.",
};
const hiddenMessage =
  "Snapshot hidden. Request another snapshot to view current data.";
// Distinguish independent Console view checks without changing admission.
const sessionCheckUrl = "/api/kernel/session-check?view=snapshot";

function unavailableStatus(
  value: unknown,
): value is Exclude<KernelSnapshotStatus, "ready"> {
  return (
    value === "unavailable" ||
    value === "disconnected" ||
    value === "unsupported"
  );
}

export default function KernelSnapshotPanel({
  expired,
  initialStatus,
}: {
  expired: () => void;
  initialStatus: KernelSnapshotStatus | undefined;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [window, setWindow] = useState<Window>();
  const [previousWindows, setPreviousWindows] = useState<number[]>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [capability, setCapability] = useState(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const hasSnapshot = useRef(false);

  useEffect(() => {
    const hide = () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
      hasSnapshot.current = false;
      setSnapshot(undefined);
      setWindow(undefined);
      setPreviousWindows([]);
      setVisible(false);
      setLoading(false);
    };
    let checking: AbortController | null = null;
    const check = async () => {
      if (document.visibilityState !== "visible" || active.current) return;
      const current = generation.current;
      const controller = new AbortController();
      active.current = checking = controller;
      const deadline = setTimeout(() => controller.abort(), 5000);
      setVisible(false);
      const unconfirmed = () => {
        if (hasSnapshot.current) setMessage(hiddenMessage);
        hide();
      };
      try {
        const response = await fetch(sessionCheckUrl, {
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
          if (controller.signal.aborted || session?.authenticated !== true) {
            unconfirmed();
          } else if (unavailableStatus(session.snapshotStatus)) {
            setCapability(session.snapshotStatus);
            setMessage(null);
            hide();
          } else if (session.snapshotStatus !== "ready") {
            unconfirmed();
          } else if (
            document.visibilityState === "visible" &&
            !controller.signal.aborted
          ) {
            setCapability("ready");
            setVisible(hasSnapshot.current);
          }
        }
      } catch {
        if (current === generation.current) unconfirmed();
      } finally {
        clearTimeout(deadline);
        if (active.current === controller) active.current = null;
        if (checking === controller) checking = null;
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void check();
      else {
        if (
          hasSnapshot.current ||
          (active.current && active.current !== checking)
        )
          setMessage(hiddenMessage);
        hide();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(check, 10000);
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
        if (unavailableStatus(result.status)) {
          setCapability(result.status);
          setMessage(null);
        } else {
          setMessage(
            result.status === "resync-required"
              ? "The snapshot changed during the read. Request a fresh snapshot; the missed interval remains unknown."
              : result.status === "busy"
                ? "Another snapshot read is in progress. Try again."
                : "Kernel snapshot unavailable; the read could not be completed.",
          );
        }
        return;
      }
      clearTimeout(deadline);
      deadline = setTimeout(() => controller.abort(), 5000);
      const session = await fetch(sessionCheckUrl, {
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
      if (validated.snapshotStatus !== "ready") {
        resetWindow();
        if (unavailableStatus(validated.snapshotStatus)) {
          setCapability(validated.snapshotStatus);
          setMessage(null);
        } else setMessage("Kernel snapshot capability is no longer available.");
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
      setCapability("ready");
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
      <p role="status">
        {message ?? capabilityMessages[capability ?? "ready"]}
      </p>
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
      {snapshot && <KernelLineage snapshot={snapshot} visible={visible} />}
    </section>
  );
}

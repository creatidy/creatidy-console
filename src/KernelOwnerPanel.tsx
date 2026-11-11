import { useEffect, useState } from "react";

export default function KernelOwnerPanel({ expired }: { expired: () => void }) {
  const [status, setStatus] = useState<
    "checking" | "unavailable" | "disconnected" | "connected"
  >("checking");
  const [proposal, setProposal] = useState<{
    scope: string;
    digest: string;
    text: string;
  }>();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let generation = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cached: { scope: string; digest: string; text: string } | undefined;
    const hide = () => {
      generation++;
      controller?.abort();
      if (timer) clearTimeout(timer);
      setVisible(false);
    };
    const check = async () => {
      hide();
      if (document.visibilityState !== "visible") return;
      const current = generation;
      controller = new AbortController();
      const active = controller;
      const signal = active.signal;
      const timeout = setTimeout(() => active.abort(), 5000);
      try {
        if (!cached) {
          const response = await fetch("/api/kernel/owner", {
            cache: "no-store",
            signal,
          });
          if (response.status === 401) {
            if (current === generation) expired();
            return;
          }
          if (!response.ok) throw new Error();
          const result = (await response.json()) as {
            status: unknown;
            actions: unknown;
            scope?: unknown;
            digest?: unknown;
            text?: unknown;
          };
          if (current !== generation) return;
          if (signal.aborted) throw new Error();
          if (!Array.isArray(result.actions) || result.actions.length !== 0)
            throw new Error();
          if (
            result.status === "connected" &&
            typeof result.scope === "string" &&
            typeof result.digest === "string" &&
            /^[0-9a-f]{64}$/.test(result.digest) &&
            typeof result.text === "string"
          ) {
            cached = {
              scope: result.scope,
              digest: result.digest,
              text: result.text,
            };
          } else if (
            result.status === "unavailable" ||
            result.status === "disconnected"
          ) {
            setStatus(result.status);
            return;
          } else throw new Error();
        }
        const response = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal,
        });
        if (current !== generation) return;
        if (signal.aborted) throw new Error();
        if (response.status === 401) {
          expired();
          return;
        }
        if (!response.ok || (await response.json()).authenticated !== true)
          throw new Error();
        if (current !== generation || document.visibilityState !== "visible")
          return;
        if (signal.aborted) throw new Error();
        setProposal(cached);
        setStatus("connected");
        setVisible(true);
        timer = setTimeout(() => void check(), 10000);
      } catch {
        if (current === generation) {
          setStatus("disconnected");
          if (cached && document.visibilityState === "visible")
            timer = setTimeout(() => void check(), 10000);
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void check();
      else hide();
    };
    document.addEventListener("visibilitychange", visibility);
    void check();
    return () => {
      hide();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return (
    <section aria-labelledby="kernel-owner-heading">
      <h2 id="kernel-owner-heading">Kernel owner actions</h2>
      <p role="status">
        {status === "checking"
          ? "Checking owner capability."
          : status === "unavailable"
            ? "Unavailable: no verified Kernel owner capability is connected. Console login does not grant Kernel authority."
            : status === "connected"
              ? "Verified proposal received when this view opened; it may have changed. Reload to recheck. No owner commands are available."
              : "Kernel proposal unavailable: the channel disconnected, refused the read, or returned invalid or oversized data. No owner commands are available."}
      </p>
      {proposal && status === "connected" && visible && (
        <>
          <p>Scope: {proposal.scope}</p>
          <p>SHA-256: {proposal.digest}</p>
          <p>
            Proposal declarations are untrusted and are not effective host
            policy. Effective host policy is unknown; this view is not an
            approval.
          </p>
          <pre>{proposal.text}</pre>
        </>
      )}
    </section>
  );
}

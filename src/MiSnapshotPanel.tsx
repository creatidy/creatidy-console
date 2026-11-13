import { useEffect, useRef, useState } from "react";

type EmptySnapshot = { instance: string; evaluatedAt: string; health: string };

export default function MiSnapshotPanel({ expired }: { expired: () => void }) {
  const [snapshot, setSnapshot] = useState<EmptySnapshot>();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("No offline file inspected.");
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
      setMessage("Offline result hidden. Select the file again to inspect it.");
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(async () => {
      if (!hasSnapshot.current || document.visibilityState !== "visible")
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
          !controller.signal.aborted &&
          document.visibilityState === "visible"
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

  async function inspect(file: File) {
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10000);
    hasSnapshot.current = false;
    setSnapshot(undefined);
    setVisible(false);
    setMessage("Inspecting an untrusted offline file.");
    try {
      if (file.size > 256 * 1024) throw new Error();
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      if (current !== generation.current || controller.signal.aborted) return;
      const response = await fetch("/api/mi/inspect-empty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
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
      if (result.status !== "empty") {
        setMessage(
          result.status === "unsupported"
            ? "This file uses a state or feature this limited inspector does not support. No publication was activated."
            : "The file is not a valid supported empty snapshot.",
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
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      setSnapshot(result as EmptySnapshot);
      hasSnapshot.current = true;
      setVisible(true);
      setMessage(
        "Supported empty snapshot shape. This file is not an authenticated producer connection.",
      );
    } catch {
      if (current === generation.current)
        setMessage("The file could not be inspected.");
    } finally {
      clearTimeout(deadline);
    }
  }

  return (
    <section aria-labelledby="mi-snapshot-heading">
      <h2 id="mi-snapshot-heading">Model Intelligence offline file</h2>
      <p>
        This limited inspector accepts only empty snapshots with unavailable
        health data. It does not activate publications, verify publisher
        identity, or connect to Model Intelligence.
      </p>
      <label htmlFor="mi-snapshot-file">
        Select an offline snapshot (maximum 256 KiB)
      </label>
      <input
        id="mi-snapshot-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void inspect(file);
        }}
      />
      <p role="status">{message}</p>
      {snapshot && visible && (
        <p>
          Unverified file instance: {snapshot.instance}; evaluated:{" "}
          {snapshot.evaluatedAt}; health: {snapshot.health}. No retained
          publication is present in this file.
        </p>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";

export default function KernelOwnerPanel({ expired }: { expired: () => void }) {
  const [status, setStatus] = useState<
    "checking" | "unavailable" | "disconnected"
  >("checking");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/kernel/owner", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (response.status === 401) {
          expired();
          return null;
        }
        if (!response.ok) throw new Error();
        return response.json() as Promise<{
          status: unknown;
          actions: unknown;
        }>;
      })
      .then((result) => {
        if (result === null) return;
        if (
          result.status !== "unavailable" ||
          !Array.isArray(result.actions) ||
          result.actions.length !== 0
        )
          throw new Error();
        setStatus("unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("disconnected");
      });
    return () => controller.abort();
  }, []);

  return (
    <section aria-labelledby="kernel-owner-heading">
      <h2 id="kernel-owner-heading">Kernel owner actions</h2>
      <p role="status">
        {status === "checking"
          ? "Checking owner capability."
          : status === "unavailable"
            ? "Unavailable: no verified Kernel owner capability is connected. Console login does not grant Kernel authority."
            : "Console could not check the Kernel owner capability. No owner commands are available."}
      </p>
    </section>
  );
}

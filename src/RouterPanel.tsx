import { useEffect, useRef, useState } from "react";
import type { RouterView } from "../server/router.ts";

const descriptions: Record<RouterView["status"], string> = {
  unconfigured:
    "Not configured. Add a local observer connection using the Console command line.",
  configured:
    "Configured, but not yet observed. Refresh to request a snapshot.",
  connected:
    "Last Router refresh succeeded. Connectivity and freshness are not continuously monitored; observations are not admission guarantees.",
  denied: "Observer access was denied or revoked. Cached facts were cleared.",
  disconnected:
    "Router is disconnected or unavailable. Any retained facts are last known, not current.",
  unsupported:
    "The observer response or contract version is unsupported. Cached facts were cleared.",
  configuration_error:
    "The local Router configuration is invalid or has unsafe permissions.",
};

export default function RouterPanel({ expired }: { expired: () => void }) {
  const [view, setView] = useState<RouterView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const currentView = useRef<RouterView | null>(null);
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const loading = useRef(false);

  async function load(refresh = false) {
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10000);
    loading.current = true;
    setVisible(false);
    if (refresh) setPending(true);
    try {
      const response = await fetch(
        refresh ? "/api/router/refresh" : "/api/router",
        refresh
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
              signal: controller.signal,
            }
          : { cache: "no-store", signal: controller.signal },
      );
      if (current !== generation.current) return;
      if (response.status === 401) {
        expired();
        return;
      }
      if (!response.ok) throw new Error();
      const next = (await response.json()) as RouterView;
      if (current !== generation.current) return;
      currentView.current = next;
      setView(next);
      setError("");
    } catch {
      if (current !== generation.current) return;
      setError(
        "Console could not retrieve Router status. Check the application connection.",
      );
      currentView.current = currentView.current
        ? {
            ...currentView.current,
            status: "disconnected",
            last_known: currentView.current.facts !== null,
          }
        : null;
      setView(currentView.current);
    } finally {
      if (current === generation.current) {
        if (
          !currentView.current?.facts &&
          !currentView.current?.origin &&
          !currentView.current?.gap
        ) {
          clearTimeout(deadline);
          loading.current = false;
          if (refresh) setPending(false);
          setVisible(true);
          return;
        }
        try {
          const session = await fetch("/api/kernel/session-check", {
            cache: "no-store",
            signal: controller.signal,
          });
          if (current !== generation.current) return;
          if (session.status === 401) {
            currentView.current = null;
            setView(null);
            expired();
          } else if (
            session.ok &&
            (await session.json()).authenticated === true &&
            current === generation.current &&
            !controller.signal.aborted &&
            document.visibilityState === "visible"
          ) {
            setVisible(true);
          } else if (current === generation.current) {
            currentView.current = null;
            setView(null);
          }
        } catch {
          if (current === generation.current) {
            currentView.current = null;
            setView(null);
          }
        } finally {
          clearTimeout(deadline);
          if (current === generation.current) {
            loading.current = false;
            if (refresh) setPending(false);
          }
        }
      } else clearTimeout(deadline);
    }
  }
  useEffect(() => {
    void load();
    const hide = () => {
      generation.current++;
      active.current?.abort();
      loading.current = false;
      currentView.current = null;
      setView(null);
      setVisible(false);
      setPending(false);
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
      else void load();
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(async () => {
      if (
        document.visibilityState !== "visible" ||
        !currentView.current ||
        (!currentView.current.facts &&
          !currentView.current.origin &&
          !currentView.current.gap) ||
        loading.current
      )
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
        } else {
          const authenticated =
            response.ok && (await response.json()).authenticated === true;
          if (current !== generation.current) return;
          if (!authenticated) hide();
          else if (
            !controller.signal.aborted &&
            document.visibilityState === "visible"
          )
            setVisible(true);
        }
      } catch {
        if (current === generation.current) hide();
      } finally {
        clearTimeout(deadline);
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      generation.current++;
      active.current?.abort();
      currentView.current = null;
    };
  }, []);

  return (
    <section aria-labelledby="router-heading">
      <h2 id="router-heading">Router observer</h2>
      {error && <p role="alert">{error}</p>}
      {!view || !visible ? (
        <>
          <p>Checking connection configuration and session.</p>
          <button type="button" disabled={pending} onClick={() => void load()}>
            Retry Router status
          </button>
        </>
      ) : (
        <>
          <p role="status">{descriptions[view.status]}</p>
          {view.origin && (
            <p>
              Configured origin: <code>{view.origin}</code>. This is not a
              verified producer instance identity.
            </p>
          )}
          {view.gap && <p role="status">{view.gap}</p>}
          {view.last_known && <p>Last-known data follows; it may be stale.</p>}
          <button
            type="button"
            disabled={
              pending ||
              view.status === "unconfigured" ||
              view.status === "configuration_error"
            }
            onClick={() => void load(true)}
          >
            {pending ? "Refreshing Router" : "Refresh Router"}
          </button>
          {view.facts && (
            <>
              <h3>Resources</h3>
              {view.facts.resource_count > view.facts.resources.length && (
                <p>
                  Showing {view.facts.resources.length} of{" "}
                  {view.facts.resource_count} resources; remaining entries are
                  omitted.
                </p>
              )}
              {view.facts.resources.length === 0 ? (
                <p>No resources in this observation.</p>
              ) : (
                <ul>
                  {view.facts.resources.map((resource, index) => (
                    <li key={`${resource.identity.resource_id}-${index}`}>
                      <strong>{resource.identity.resource_id}</strong> /{" "}
                      {resource.identity.provider} / {resource.identity.model}
                      <br />
                      Channel: {resource.identity.channel}; variant:{" "}
                      {resource.identity.variant ?? "unknown"}; entitlement:{" "}
                      {resource.identity.entitlement}.
                      <br />
                      Freshness: {resource.freshness}; observed:{" "}
                      {resource.observed_at ?? "unknown"}; health:{" "}
                      {resource.health ?? "unknown"}; availability:{" "}
                      {resource.availability}.
                      <br />
                      Origin: {resource.origin}; enabled:{" "}
                      {String(resource.enabled)}; worker connected:{" "}
                      {resource.worker_connected === null
                        ? "unknown"
                        : String(resource.worker_connected)}
                      .
                      {resource.quota_count === 0 ? (
                        <p>No quota facts reported.</p>
                      ) : (
                        <>
                          {resource.quota_count > resource.quotas.length && (
                            <p>
                              Showing {resource.quotas.length} of{" "}
                              {resource.quota_count} quota facts; remaining
                              entries are omitted.
                            </p>
                          )}
                          <ul>
                            {resource.quotas.map((quota, quotaIndex) => (
                              <li key={quotaIndex}>
                                {quota.resource} / {quota.kind}; observation:{" "}
                                {quota.observation_class}; used:{" "}
                                {quota.used_percent === null
                                  ? "unknown"
                                  : `${quota.used_percent}%`}
                                ; remaining:{" "}
                                {quota.remaining_percent === null
                                  ? "unknown"
                                  : `${quota.remaining_percent}%`}
                                ; duration:{" "}
                                {quota.duration_seconds === null
                                  ? "unknown"
                                  : quota.duration_seconds ===
                                      "out_of_display_range"
                                    ? "outside display range"
                                    : `${quota.duration_seconds} seconds`}
                                ; resets: {quota.resets_at ?? "unknown"}.
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <h3>Sources</h3>
              {view.facts.source_count > view.facts.sources.length && (
                <p>
                  Showing {view.facts.sources.length} of{" "}
                  {view.facts.source_count} sources; remaining entries are
                  omitted.
                </p>
              )}
              {view.facts.sources.length === 0 ? (
                <p>No sources in this observation.</p>
              ) : (
                <ul>
                  {view.facts.sources.map((source, index) => (
                    <li key={`${source.source_id}-${index}`}>
                      <strong>{source.source_id}</strong>: inventory{" "}
                      {source.inventory_freshness}; observed{" "}
                      {source.inventory_observed_at ?? "unknown"}; worker
                      connected{" "}
                      {source.worker_connected === null
                        ? "unknown"
                        : String(source.worker_connected)}
                      .
                    </li>
                  ))}
                </ul>
              )}
              <h3>Discoveries</h3>
              {view.facts.discovery_count > view.facts.discoveries.length && (
                <p>
                  Showing {view.facts.discoveries.length} of{" "}
                  {view.facts.discovery_count} discoveries; remaining entries
                  are omitted.
                </p>
              )}
              {view.facts.discoveries.length === 0 ? (
                <p>No discoveries in this observation.</p>
              ) : (
                <ul>
                  {view.facts.discoveries.map((discovery, index) => (
                    <li
                      key={`${discovery.source_id}-${discovery.model}-${index}`}
                    >
                      <strong>
                        {discovery.source_id} / {discovery.model}
                      </strong>
                      : {discovery.state}; reason{" "}
                      {discovery.reason ?? "unknown"}; observed{" "}
                      {discovery.observed_at ?? "unknown"}; lifecycle{" "}
                      {discovery.lifecycle ?? "unknown"}.
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Freshness was reported by Router at the last refresh and may
                have aged. Observation timestamps belong to individual producer
                facts; the observer contract supplies no overall snapshot
                timestamp or verified instance identity.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

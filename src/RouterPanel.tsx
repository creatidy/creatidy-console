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
  const uncertainObservation = useRef<string | null>(null);

  async function load(refresh = false) {
    if (document.visibilityState !== "visible") return;
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const previousObservation = currentView.current?.observation;
    const controller = new AbortController();
    active.current = controller;
    const deadlines: ReturnType<typeof setTimeout>[] = [];
    const bounded = (ms = 5000) => {
      const deadline = new AbortController();
      deadlines.push(setTimeout(() => deadline.abort(), ms));
      return AbortSignal.any([controller.signal, deadline.signal]);
    };
    const currentRequest = () => current === generation.current;
    const read = async (post = false) => {
      const signal = bounded(post ? 10000 : 5000);
      const response = await fetch(
        post ? "/api/router/refresh" : "/api/router",
        {
          cache: "no-store",
          signal,
          ...(post
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
              }
            : {}),
        },
      );
      if (!currentRequest()) return null;
      signal.throwIfAborted();
      if (response.status === 401) {
        currentView.current = null;
        setView(null);
        expired();
        return null;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as RouterView;
      signal.throwIfAborted();
      return result;
    };
    setVisible(false);
    setPending(refresh);
    try {
      let next: RouterView | null;
      let refreshFailed = false;
      try {
        next = await read(refresh);
      } catch (error) {
        if (!currentRequest()) return;
        if (!refresh) throw error;
        refreshFailed = true;
        // The producer read can outlast the browser's request. Recover only
        // the server's view and keep reconciling it while facts are displayed.
        next = await read();
      }
      if (!currentRequest() || !next) return;
      if (refresh)
        uncertainObservation.current = refreshFailed
          ? previousObservation === undefined
            ? next.observation
            : previousObservation
          : null;
      if (!next.facts || next.observation !== uncertainObservation.current)
        uncertainObservation.current = null;
      if (next.facts || next.origin || next.gap) {
        const signal = bounded();
        const session = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal,
        });
        if (!currentRequest()) return;
        signal.throwIfAborted();
        if (session.status === 401) {
          currentView.current = null;
          setView(null);
          expired();
          return;
        }
        if (!session.ok || (await session.json()).authenticated !== true)
          throw new Error();
        signal.throwIfAborted();
      }
      if (!currentRequest() || document.visibilityState !== "visible") return;
      if (uncertainObservation.current && next.status === "connected") {
        next = {
          ...next,
          status: "disconnected",
          last_known: next.facts !== null,
        };
      }
      currentView.current = next;
      setView(next);
      setError(
        refreshFailed
          ? "Console could not complete the Router refresh. Showing the server's cached status."
          : "",
      );
      setVisible(true);
    } catch {
      if (currentRequest()) {
        currentView.current = null;
        setView(null);
        setError(
          "Console could not retrieve Router status. Check the application connection.",
        );
      }
    } finally {
      deadlines.forEach(clearTimeout);
      if (currentRequest()) {
        active.current = null;
        setPending(false);
      }
    }
  }
  useEffect(() => {
    void load();
    const hide = () => {
      generation.current++;
      active.current?.abort();
      active.current = null;
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
    const timer = setInterval(() => {
      if (
        document.visibilityState !== "visible" ||
        !currentView.current ||
        (!currentView.current.facts &&
          !currentView.current.origin &&
          !currentView.current.gap) ||
        active.current
      )
        return;
      void load();
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
      <button
        type="button"
        disabled={
          pending ||
          view?.status === "unconfigured" ||
          view?.status === "configuration_error"
        }
        onClick={() => void load(view !== null)}
      >
        {pending
          ? "Refreshing Router"
          : view
            ? "Refresh Router"
            : "Retry Router status"}
      </button>
      {!view || !visible ? (
        <p>Checking connection configuration and session.</p>
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

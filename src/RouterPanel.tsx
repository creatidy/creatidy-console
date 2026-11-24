import { useEffect, useEffectEvent, useRef, useState } from "react";
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
  const [view, setView] = useState<
    (RouterView & { refreshUnconfirmed: boolean }) | null
  >(null);
  const [activity, setActivity] = useState<"read" | "refresh" | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const active = useRef<AbortController | null>(null);
  // Only a previously accepted observation can be mistaken for a new one.
  const uncertainObservation = useRef<string | null>(null);

  async function load(refresh = false) {
    if (document.visibilityState !== "visible") return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const applicable = () =>
      active.current === controller && document.visibilityState === "visible";
    const request = async (post = false) => {
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), post ? 10000 : 5000);
      const signal = AbortSignal.any([controller.signal, deadline.signal]);
      try {
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
        if (!applicable()) return null;
        signal.throwIfAborted();
        if (response.status === 401) {
          setView(null);
          expired();
          controller.abort();
          return null;
        }
        if (post && response.status === 503) {
          setRefreshBusy(true);
          await response.body?.cancel();
          return null;
        }
        if (!response.ok) throw new Error();
        if (!post) {
          const result = (await response.json()) as RouterView;
          signal.throwIfAborted();
          return result;
        }
        // The POST result is never a publication source.
        await response.body?.cancel();
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    setActivity(refresh ? "refresh" : "read");
    try {
      if (refresh) {
        setRefreshBusy(false);
        // Keep the baseline even if the POST is interrupted, or the cache
        // cannot be read afterwards. Only producer evidence can resolve it.
        uncertainObservation.current = view?.observation ?? null;
        try {
          await request(true);
        } catch {
          // A producer observation can outlast the browser's refresh request.
        }
      }
      if (!applicable() || controller.signal.aborted) return;
      const next = await request();
      if (!next || !applicable()) return;
      if (next.observation !== uncertainObservation.current)
        uncertainObservation.current = null;
      setView({
        ...next,
        refreshUnconfirmed:
          next.status === "connected" && uncertainObservation.current !== null,
      });
      setReadFailed(false);
    } catch {
      if (applicable()) {
        setView(null);
        setReadFailed(true);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setActivity(null);
      }
    }
  }
  const reconcile = useEffectEvent((foreground = false) => {
    if (
      foreground ||
      (!active.current &&
        (readFailed || view?.facts || view?.origin || view?.gap))
    )
      void load();
  });
  useEffect(() => {
    reconcile(true);
    const visibility = () => {
      if (document.visibilityState === "visible") {
        reconcile(true);
        return;
      }
      active.current?.abort();
      active.current = null;
      setView(null);
      setActivity(null);
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => reconcile(), 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      active.current?.abort();
      active.current = null;
    };
  }, []);

  const pending = activity === "refresh";
  const canRefresh =
    view !== null &&
    view.status !== "unconfigured" &&
    view.status !== "configuration_error";
  return (
    <section aria-labelledby="router-heading">
      <h2 id="router-heading">Router observer</h2>
      {readFailed && (
        <p role="alert">
          Console could not retrieve Router status. Check the application
          connection.
        </p>
      )}
      {refreshBusy && (
        <p role="status">
          An earlier Router refresh is still finishing. Retry the refresh to
          read the new configuration.
        </p>
      )}
      <button
        type="button"
        aria-disabled={pending}
        onClick={() => {
          if (!pending) void load(canRefresh);
        }}
      >
        {pending
          ? "Refreshing Router"
          : canRefresh
            ? "Refresh Router"
            : "Retry Router status"}
      </button>
      {!view || activity !== null ? (
        <p>Checking connection configuration and session.</p>
      ) : (
        <>
          <p role="status">
            {view.refreshUnconfirmed
              ? "Console could not confirm a new Router observation."
              : descriptions[view.status]}
          </p>
          {view.origin && (
            <p>
              Configured origin: <code>{view.origin}</code>. This is not a
              verified producer instance identity.
            </p>
          )}
          {view.gap && <p role="status">{view.gap}</p>}
          {(view.last_known || view.refreshUnconfirmed) && (
            <p>Last-known data follows; it may be stale.</p>
          )}
          {view.facts && (
            <p>
              {view.last_known || view.refreshUnconfirmed
                ? "Last-known inventory"
                : "Observed inventory"}
              : {view.facts.resource_count} resources, {view.facts.source_count}{" "}
              sources, {view.facts.discovery_count} discoveries.
            </p>
          )}
        </>
      )}
      {view?.facts && (
        <details
          open={factsOpen}
          onToggle={(event) => setFactsOpen(event.currentTarget.open)}
        >
          <summary>Inspect Router observations</summary>
          {activity === null && (
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
        </details>
      )}
    </section>
  );
}

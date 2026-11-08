import { useEffect, useState } from "react";
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

  async function load(refresh = false) {
    if (refresh) setPending(true);
    try {
      const response = await fetch(
        refresh ? "/api/router/refresh" : "/api/router",
        refresh
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }
          : { cache: "no-store" },
      );
      if (response.status === 401) {
        expired();
        return;
      }
      if (!response.ok) throw new Error();
      setView((await response.json()) as RouterView);
      setError("");
    } catch {
      setError(
        "Console could not retrieve Router status. Check the application connection.",
      );
      setView((previous) =>
        previous
          ? {
              ...previous,
              status: "disconnected",
              last_known: previous.facts !== null,
            }
          : null,
      );
    } finally {
      if (refresh) setPending(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <section aria-labelledby="router-heading">
      <h2 id="router-heading">Router observer</h2>
      {error && <p role="alert">{error}</p>}
      {!view ? (
        <p>Checking connection configuration.</p>
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

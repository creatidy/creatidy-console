import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readRouterConfig, type RouterConfig } from "./router-config.ts";

type RecordValue = Record<string, unknown>;
type Projection = ReturnType<typeof project>;
type RouterStatus =
  | "unconfigured"
  | "configured"
  | "connected"
  | "denied"
  | "disconnected"
  | "unsupported"
  | "configuration_error";
class Unsupported extends Error {}

function parseObserverJson(source: string): unknown {
  const json = JSON as JSON & { rawJSON: (source: string) => unknown };
  const parse = JSON.parse as unknown as (
    text: string,
    reviver: (
      key: string,
      value: unknown,
      context?: { source?: string },
    ) => unknown,
  ) => unknown;
  return parse(source, (_key, value, context) => {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      if (!context?.source)
        throw new Unsupported("Unsupported observer number");
      return json.rawJSON(context.source);
    }
    return value;
  });
}

function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Unsupported("Unsupported observer data");
  return value as RecordValue;
}
function text(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value))
    throw new Unsupported("Unsupported observer data");
  return value;
}
function flag(value: unknown, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "boolean")
    throw new Unsupported("Unsupported observer data");
  return value;
}
function choice(value: unknown, allowed: readonly string[], nullable = false) {
  const result = text(value, nullable);
  if (result !== null && !allowed.includes(result))
    throw new Unsupported("Unsupported observer value");
  return result;
}
function timestamp(value: unknown) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Unsupported("Unsupported observation timestamp");
  }
  return value;
}
function integer(value: unknown, minimum: number, maximum: number) {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Unsupported("Unsupported observer number");
  return value;
}
function duration(value: unknown) {
  if (value === null) return null;
  const json = JSON as JSON & { isRawJSON: (candidate: unknown) => boolean };
  if (json.isRawJSON(value)) {
    const raw = JSON.stringify(value);
    if (!/^[1-9]\d*$/.test(raw))
      throw new Unsupported("Unsupported observer duration");
    return raw.length <= 128 ? raw : "out_of_display_range";
  }
  return integer(value, 1, Number.MAX_SAFE_INTEGER);
}
function list(value: unknown) {
  if (!Array.isArray(value) || value.length > 10000)
    throw new Unsupported("Unsupported observer data");
  return value;
}
function containsCredential(value: unknown, credential: string): boolean {
  if (typeof value === "string") return value.includes(credential);
  if (Array.isArray(value))
    return value.some((item) => containsCredential(item, credential));
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).some((item) => containsCredential(item, credential))
  );
}
function project(value: unknown) {
  const snapshot = object(value);
  if (snapshot.schema_version !== 1 || snapshot.mode !== "execution_gateway")
    throw new Unsupported("Unsupported observer version");
  const resources = list(snapshot.resources);
  const sources = list(snapshot.sources);
  const discoveries = list(snapshot.discoveries);
  return {
    resource_count: resources.length,
    source_count: sources.length,
    discovery_count: discoveries.length,
    resources: resources.slice(0, 200).map((entry) => {
      const resource = object(entry);
      const identity = object(resource.identity);
      const quotas = list(resource.quota_facts);
      return {
        identity: {
          resource_id: text(identity.resource_id),
          channel: text(identity.channel),
          provider: text(identity.provider),
          model: text(identity.model),
          variant: text(identity.variant, true),
          entitlement: text(identity.entitlement),
        },
        origin: choice(resource.origin, ["configured", "source"]),
        enabled: flag(resource.enabled),
        worker_connected: flag(resource.worker_connected, true),
        observed_at: timestamp(resource.observed_at),
        freshness: choice(resource.freshness, [
          "fresh",
          "stale",
          "never_observed",
          "not_evaluated",
        ]),
        health: choice(
          resource.health,
          [
            "ok",
            "unavailable",
            "auth_required",
            "schema_changed",
            "unsupported",
            "unknown",
          ],
          true,
        ),
        availability: choice(resource.availability, [
          "unknown",
          "unavailable",
          "disabled",
        ]),
        quota_count: quotas.length,
        quotas: quotas.slice(0, 20).map((entry) => {
          const quota = object(entry);
          const window = object(quota.window);
          return {
            observation_class: choice(quota.observation_class, [
              "direct_observation",
              "provider_telemetry",
              "estimate",
              "local_limit",
              "unknown",
            ]),
            resource: text(window.resource),
            kind: text(window.kind),
            duration_seconds: duration(window.duration_seconds),
            used_percent: integer(window.used_percent, 0, 100),
            remaining_percent: integer(window.remaining_percent, 0, 100),
            resets_at: timestamp(window.resets_at),
          };
        }),
      };
    }),
    sources: sources.slice(0, 200).map((entry) => {
      const source = object(entry);
      return {
        source_id: text(source.source_id),
        worker_connected: flag(source.worker_connected, true),
        inventory_observed_at: timestamp(source.inventory_observed_at),
        inventory_freshness: choice(source.inventory_freshness, [
          "unknown",
          "never_observed",
        ]),
      };
    }),
    discoveries: discoveries.slice(0, 200).map((entry) => {
      const discovery = object(entry);
      return {
        source_id: text(discovery.source_id),
        model: text(discovery.model),
        state: choice(discovery.state, [
          "routable",
          "discovered",
          "retired",
          "not_in_latest_inventory",
        ]),
        reason: choice(
          discovery.reason,
          [
            "model_not_allowed",
            "legacy_track_policy",
            "adoption_disabled",
            "awaiting_inventory_refresh",
            "plan_lane_unverified",
            "source_not_authenticated",
            "effort_not_reported",
          ],
          true,
        ),
        observed_at: timestamp(discovery.observed_at),
        lifecycle: choice(
          discovery.lifecycle,
          ["retained_missing", "retired"],
          true,
        ),
      };
    }),
  };
}

function cursor(value: unknown) {
  object(value);
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Unsupported("Unsupported observer cursor");
  }
  if (Buffer.byteLength(serialized) > 1024 * 1024 - 32)
    throw new Unsupported("Unsupported observer cursor");
  return value;
}

async function observe(
  config: RouterConfig,
  path: "/observer/v1/snapshot" | "/observer/v1/replay",
  position?: unknown,
) {
  const url = new URL(config.origin);
  const body =
    position === undefined ? undefined : JSON.stringify({ cursor: position });
  return await new Promise<{ status: number; data: unknown }>(
    (resolve, reject) => {
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(
        {
          hostname: url.hostname === "[::1]" ? "::1" : url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          method: body === undefined ? "GET" : "POST",
          path,
          ...(url.protocol === "https:" ? { rejectUnauthorized: true } : {}),
          headers: {
            host: url.host,
            authorization: `Bearer ${config.credential}`,
            ...(body === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(body),
                }),
          },
          agent: false,
        },
        (response) => {
          let size = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 20 * 1024 * 1024)
              req.destroy(new Unsupported("Observer response too large"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              resolve({
                status: response.statusCode ?? 0,
                data:
                  response.statusCode === 200
                    ? parseObserverJson(Buffer.concat(chunks).toString("utf8"))
                    : null,
              });
            } catch {
              reject(new Unsupported("Invalid observer response"));
            }
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("Observer request timed out")),
        10000,
      );
      req.on("error", reject);
      req.on("close", () => clearTimeout(timer));
      req.end(body);
    },
  );
}

export function createRouterObserver(directory: string) {
  let fingerprint: string | null = null;
  let position: unknown;
  let facts: Projection | null = null;
  let status: RouterStatus = "unconfigured";
  let gap: string | null = null;
  let origin: string | null = null;
  let pending: Promise<ReturnType<typeof view>> | null = null;

  function configuration() {
    let config: RouterConfig | null;
    try {
      config = readRouterConfig(directory);
    } catch {
      status = "configuration_error";
      facts = null;
      position = undefined;
      origin = null;
      fingerprint = null;
      return null;
    }
    const next = config
      ? createHash("sha256").update(JSON.stringify(config)).digest("hex")
      : null;
    if (next !== fingerprint || (!config && status !== "unconfigured")) {
      fingerprint = next;
      facts = null;
      position = undefined;
      gap = null;
      status = config ? "configured" : "unconfigured";
      origin = config?.origin ?? null;
    }
    return config;
  }
  function view() {
    configuration();
    return {
      status,
      origin,
      facts,
      gap,
      last_known: status === "disconnected" && facts !== null,
    };
  }
  async function refresh() {
    const config = configuration();
    if (!config) return view();
    if (pending) return await pending;
    const active = refreshOnce(config, fingerprint);
    pending = active;
    try {
      return await active;
    } finally {
      if (pending === active) pending = null;
    }
  }
  async function refreshOnce(
    config: RouterConfig,
    initialFingerprint: string | null,
  ) {
    try {
      let rejectedReplay = false;
      let nextGap = gap;
      let result = await observe(
        config,
        position === undefined
          ? "/observer/v1/snapshot"
          : "/observer/v1/replay",
        position,
      );
      configuration();
      if (fingerprint !== initialFingerprint) return view();
      if (result.status === 401 || result.status === 403) {
        status = "denied";
        facts = null;
        position = undefined;
        gap = null;
        return view();
      }
      if (result.status === 400 && position !== undefined) {
        gap = "Replay was rejected; resynchronization is required.";
        nextGap = gap;
        rejectedReplay = true;
        position = undefined;
        result = await observe(config, "/observer/v1/snapshot");
        configuration();
        if (fingerprint !== initialFingerprint) return view();
      }
      if (result.status === 401 || result.status === 403) {
        status = "denied";
        facts = null;
        position = undefined;
        gap = null;
        return view();
      }
      if (result.status !== 200) {
        if (result.status >= 500) status = "disconnected";
        else {
          status = "unsupported";
          facts = null;
          position = undefined;
        }
        return view();
      }
      let envelope = object(result.data);
      if (envelope.schema_version !== 1)
        throw new Unsupported("Unsupported observer version");
      let nextFacts: Projection;
      let nextPosition: unknown;
      if (position === undefined) {
        nextFacts = project(envelope.snapshot);
        nextPosition = cursor(envelope.cursor);
        if (
          rejectedReplay ||
          gap === "Replay was rejected; resynchronization is required."
        )
          nextGap = "Replay was rejected; the snapshot was resynchronized.";
      } else {
        const events = list(envelope.events);
        if (events.length > 256)
          throw new Unsupported("Observer event limit exceeded");
        if (envelope.resync !== null) {
          if (events.length !== 0)
            throw new Unsupported("Unsupported observer response");
          const replacement = object(envelope.resync);
          nextFacts = project(replacement.snapshot);
          nextPosition = cursor(replacement.cursor);
          const reason = text(envelope.resync_reason);
          if (
            ![
              "cursor_expired",
              "history_gap",
              "cursor_future",
              "cursor_before_epoch",
              "epoch_mismatch",
              "schema_mismatch",
            ].includes(String(reason))
          )
            throw new Unsupported("Unsupported resynchronization reason");
          gap = `History gap: ${reason}. Resynchronization is required.`;
          nextGap = `History gap: ${reason}. Snapshot resynchronized.`;
        } else {
          if (!facts || envelope.resync_reason !== null)
            throw new Unsupported("Missing previous snapshot");
          nextFacts = facts;
          for (const event of events) {
            const item = object(event);
            cursor(item.cursor);
            const eventSnapshot = object(item.snapshot);
            if (
              eventSnapshot.schema_version !== 1 ||
              eventSnapshot.mode !== "execution_gateway"
            ) {
              throw new Unsupported("Unsupported observer version");
            }
          }
          nextPosition = cursor(envelope.cursor);
        }
        if (
          envelope.provenance_current !== true &&
          envelope.provenance_current !== false
        )
          throw new Unsupported("Unsupported provenance");
        if (envelope.provenance_current === false || events.length > 0) {
          const snapshot = await observe(config, "/observer/v1/snapshot");
          configuration();
          if (fingerprint !== initialFingerprint) return view();
          if (snapshot.status === 401 || snapshot.status === 403) {
            status = "denied";
            facts = null;
            position = undefined;
            gap = null;
            return view();
          }
          if (snapshot.status >= 500) throw new Error("Snapshot unavailable");
          if (snapshot.status !== 200)
            throw new Unsupported("Snapshot unsupported");
          envelope = object(snapshot.data);
          if (envelope.schema_version !== 1)
            throw new Unsupported("Unsupported observer version");
          nextFacts = project(envelope.snapshot);
          nextPosition = cursor(envelope.cursor);
          const notice =
            "A fresh snapshot replaced replay; intermediate history may have been omitted.";
          if (!nextGap?.includes(notice))
            nextGap = nextGap ? `${nextGap} ${notice}` : notice;
        }
      }
      if (
        containsCredential(
          { facts: nextFacts, gap: nextGap },
          config.credential,
        )
      )
        throw new Unsupported("Unsafe observer content");
      if (configuration() === null || fingerprint !== initialFingerprint)
        return view();
      facts = nextFacts;
      position = nextPosition;
      gap = nextGap;
      status = "connected";
      return view();
    } catch (error) {
      configuration();
      if (fingerprint !== initialFingerprint) return view();
      if (error instanceof Unsupported) {
        status = "unsupported";
        facts = null;
        position = undefined;
        gap = null;
      } else status = "disconnected";
      return view();
    }
  }
  return { view, refresh };
}

export type RouterView = ReturnType<
  ReturnType<typeof createRouterObserver>["view"]
>;

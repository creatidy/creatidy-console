import { parseOwnerJson } from "./kernel-owner-v1.ts";

// A deliberately limited consumer of mi.operator-working/1. This does not
// activate publications or implement the producer's complete receiver.
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    throw new Error("invalid");
  return result;
}

function empty(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function utc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|[+-]00:00)$/.exec(
      value,
    );
  if (!match || match[1] === "0000") return false;
  const instant = new Date(value);
  return (
    Number.isFinite(instant.getTime()) &&
    instant.getUTCFullYear() === Number(match[1]) &&
    instant.getUTCMonth() + 1 === Number(match[2]) &&
    instant.getUTCDate() === Number(match[3]) &&
    instant.getUTCHours() === Number(match[4]) &&
    instant.getUTCMinutes() === Number(match[5]) &&
    instant.getUTCSeconds() === Number(match[6])
  );
}

export function inspectEmptyMiSnapshot(text: string):
  | { status: "empty"; instance: string; evaluatedAt: string; health: string }
  | {
      status:
        "producer-invalid" | "producer-unsupported" | "unsupported" | "invalid";
    } {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > 256 * 1024)
      throw new Error("invalid");
    const root = object(parseOwnerJson(text), [
      "schema",
      "product",
      "instance",
      "evaluated_at",
      "capabilities",
      "publication",
      "health",
      "facts",
      "history",
    ]);
    if (
      root.schema !== "mi.operator-working/1" ||
      root.product !== "model-intelligence"
    )
      return { status: "unsupported" };
    if (
      typeof root.instance !== "string" ||
      !root.instance.trim() ||
      !root.instance.replace(/[\p{White_Space}\u001c-\u001f]/gu, "") ||
      Buffer.byteLength(root.instance) > 256 ||
      Buffer.from(root.instance).toString("utf8") !== root.instance ||
      !utc(root.evaluated_at)
    )
      throw new Error("invalid");
    const caps = object(root.capabilities, ["reads", "commands", "replay"]);
    if (
      !Array.isArray(caps.reads) ||
      JSON.stringify(caps.reads) !== '["status","inspect","export"]' ||
      !empty(caps.commands) ||
      caps.replay !== false
    )
      throw new Error("invalid");
    const publication = object(root.publication, [
      "state",
      "reference",
      "artifact",
      "diagnostics",
    ]);
    if (publication.state === "available") return { status: "unsupported" };
    if (
      typeof publication.state !== "string" ||
      !["empty", "invalid", "unsupported"].includes(publication.state)
    )
      throw new Error("invalid");
    const diagnostics = publication.diagnostics;
    if (
      publication.reference !== null ||
      publication.artifact !== null ||
      !Array.isArray(diagnostics) ||
      new Set(diagnostics).size !== diagnostics.length ||
      diagnostics.some(
        (item) =>
          typeof item !== "string" ||
          ![
            "retained-publication-invalid-or-unreadable",
            "publication-changed-during-read",
            "retained-publication-unsupported",
          ].includes(item),
      ) ||
      (publication.state === "empty"
        ? diagnostics.length !== 0
        : diagnostics.length === 0)
    )
      throw new Error("invalid");
    const health = object(root.health, [
      "state",
      "sha256",
      "data",
      "correlation",
    ]);
    if (
      typeof health.state !== "string" ||
      !["missing", "invalid", "unsupported"].includes(health.state) ||
      health.sha256 !== null ||
      health.data !== null ||
      health.correlation !== "unavailable"
    )
      return { status: "unsupported" };
    const facts = object(root.facts, [
      "latest",
      "future",
      "stale",
      "unknown_freshness",
      "notices",
      "uncertain_campaigns",
      "conflicts",
      "projection",
    ]);
    if (
      [
        "latest",
        "future",
        "stale",
        "unknown_freshness",
        "notices",
        "uncertain_campaigns",
        "conflicts",
      ].some((key) => !empty(facts[key]))
    )
      throw new Error("invalid");
    const projection = object(facts.projection, [
      "offers",
      "models",
      "surfaces",
      "conflicts",
    ]);
    if (Object.values(projection).some((value) => !empty(value)))
      throw new Error("invalid");
    const history = object(root.history, [
      "scope",
      "replay",
      "checkpoint",
      "relation",
      "evidence_added",
      "projection_changed",
    ]);
    if (
      history.scope !== "retained-publication-cuts-only" ||
      history.replay !== false ||
      (history.checkpoint !== null &&
        (typeof history.checkpoint !== "string" ||
          !/^[0-9a-f]{64}$/.test(history.checkpoint))) ||
      history.relation !== "unavailable" ||
      !empty(history.evidence_added) ||
      history.projection_changed !== null
    )
      throw new Error("invalid");
    if (publication.state !== "empty")
      return {
        status:
          publication.state === "invalid"
            ? "producer-invalid"
            : "producer-unsupported",
      };
    return {
      status: "empty",
      instance: root.instance,
      evaluatedAt: root.evaluated_at,
      health: health.state as string,
    };
  } catch {
    return { status: "invalid" };
  }
}

// SPDX-License-Identifier: Apache-2.0
// Independently ported consumer checks from Model Intelligence's public
// tests/portable_operator_consumer.py at c65df369f674b82347a2e08a27d5315d935ac1a4.
// This module validates evidence; it does not authenticate a publisher or admit it.
import { createHash } from "node:crypto";
import { parseOwnerJson } from "./kernel-owner-v1.ts";
import { miInstance, miText as text } from "./mi-text.ts";

type Obj = Record<string, unknown>;
type Check = (value: unknown) => void;
const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf("timeZone"));
type Cut = {
  sha256: string;
  schema: string;
  producedAt: bigint;
  applicability: Obj;
  observations: Map<string, Obj>;
  statements: Map<string, Obj>;
  notices: Map<string, Obj>;
  uncertain: Map<string, Obj>;
  members: string[];
};

function fail(): never {
  throw new Error("invalid");
}
function record(value: unknown, fields: string[]): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const result = value as Obj;
  if (
    Object.keys(result).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(result, key))
  )
    return fail();
  return result;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : fail();
}
function string(value: unknown): string {
  if (
    typeof value !== "string" ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail();
  return value;
}
function choice(value: unknown, options: readonly string[]): string {
  return typeof value === "string" && options.includes(value) ? value : fail();
}
function boolean(value: unknown): void {
  if (typeof value !== "boolean") fail();
}
function optional(check: Check): Check {
  return (value) => {
    if (value !== null) check(value);
  };
}
function digest(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    ? value
    : fail();
}
function strings(value: unknown, sorted = false): string[] {
  const result = list(value).map(text);
  if (
    new Set(result).size !== result.length ||
    (sorted &&
      result.some(
        (item, index) => index > 0 && compare(result[index - 1]!, item) >= 0,
      ))
  )
    fail();
  return result;
}
function compare(left: string, right: string): number {
  const a = Array.from(left, (part) => part.codePointAt(0)!);
  const b = Array.from(right, (part) => part.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(string(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value === 0 ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") return fail();
  const obj = value as Obj;
  return `{${Object.keys(obj)
    .sort(compare)
    .map((key) => `${JSON.stringify(string(key))}:${canonical(obj[key])}`)
    .join(",")}}`;
}
function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function parsed(value: string): Obj {
  if (Buffer.from(value).toString("utf8") !== value) return fail();
  const result = parseOwnerJson(value);
  if (!result || typeof result !== "object" || Array.isArray(result))
    return fail();
  return result as Obj;
}

// Explicit supported ISO subset; reject rather than normalize unsupported dates.
function instant(value: unknown, utcOnly = false): bigint {
  const raw = text(value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      raw,
    );
  if (
    !match ||
    match[1] === "0000" ||
    (utcOnly && !["Z", "+00:00", "-00:00"].includes(match[8]!))
  )
    return fail();
  if (
    match[8] !== "Z" &&
    (Number(match[8]!.slice(1, 3)) > 23 || Number(match[8]!.slice(4, 6)) > 59)
  )
    return fail();
  const local = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`,
  );
  if (
    !Number.isFinite(local.getTime()) ||
    local.getUTCFullYear() !== Number(match[1]) ||
    local.getUTCMonth() + 1 !== Number(match[2]) ||
    local.getUTCDate() !== Number(match[3]) ||
    local.getUTCHours() !== Number(match[4]) ||
    local.getUTCMinutes() !== Number(match[5]) ||
    local.getUTCSeconds() !== Number(match[6])
  )
    return fail();
  const timestamp = Date.parse(raw);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).getUTCFullYear() < 1 ||
    new Date(timestamp).getUTCFullYear() > 9999
  )
    return fail();
  const micros = (match[7] ?? "").padEnd(6, "0");
  return BigInt(timestamp) * 1000n + BigInt(micros.slice(3) || "0");
}
function decimal(value: unknown, nonnegative = false): void {
  const raw = text(value);
  if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(raw))
    fail();
  if (nonnegative && raw.startsWith("-") && /[1-9]/.test(raw.split(/[eE]/)[0]!))
    fail();
}
function configuration(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  for (const [key, entry] of Object.entries(value as Obj)) {
    text(key);
    optional(text)(entry);
  }
}
function fields(value: unknown, rules: Record<string, Check>): Obj {
  const result = record(value, Object.keys(rules));
  for (const [key, check] of Object.entries(rules)) check(result[key]);
  return result;
}

function terms(value: unknown): Obj {
  return fields(value, {
    price: optional((entry) => {
      fields(entry, {
        kind: (v) => {
          if (v !== "money") fail();
        },
        amount: (v) => decimal(v, true),
        currency: text,
        unit: text,
      });
    }),
    quota: optional((entry) => {
      fields(entry, {
        amount: (v) => decimal(v, true),
        unit: text,
        period: text,
      });
    }),
    available: optional(boolean),
    rules: optional((entry) => {
      list(entry).forEach(text);
    }),
  });
}
function window(value: unknown): void {
  if (value === null) return;
  const result = fields(value, { timezone: text, start: text, end: text });
  const zone = result.timezone as string;
  if (zone !== "UTC" && !SUPPORTED_ZONES.has(zone)) fail();
  function time(input: unknown): bigint {
    const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/.exec(
      text(input),
    );
    if (
      !match ||
      Number(match[1]) > 23 ||
      Number(match[2]) > 59 ||
      Number(match[3] ?? 0) > 59
    )
      return fail();
    return (
      BigInt(
        (Number(match[1]) * 3600 +
          Number(match[2]) * 60 +
          Number(match[3] ?? 0)) *
          1000000,
      ) + BigInt((match[4] ?? "").padEnd(6, "0") || "0")
    );
  }
  if (time(result.start) === time(result.end)) fail();
}
function subject(value: unknown, schema: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const raw = value as Obj;
  const kind = choice(raw.kind, ["model", "plan", "surface"]);
  const extra =
    kind === "model"
      ? "request_id"
      : kind === "plan"
        ? "generation"
        : "version";
  const rules: Record<string, Check> = {
    kind: (v) => {
      if (v !== kind) fail();
    },
    id: text,
    provider: text,
    [extra]: text,
  };
  if (kind === "model" && schema.endsWith("/2")) {
    Object.assign(rules, {
      physical_model: optional(text),
      revision: optional(text),
      channel: optional(text),
      configuration,
      interface: (v: unknown) => {
        fields(v, {
          id: optional(text),
          provider: optional(text),
          version: optional(text),
        });
      },
    });
  }
  return fields(raw, rules);
}
function taggedValue(value: unknown, kind: string, schema: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const raw = value as Obj;
  const tag = choice(raw.kind, [
    "money",
    "capability",
    "benchmark",
    "surface",
    "native-limit",
  ]);
  if (
    (kind === "surface") !== (tag === "surface") ||
    (tag === "native-limit" && schema.endsWith("/1"))
  )
    fail();
  const literal: Check = (v) => {
    if (v !== tag) fail();
  };
  const rules: Record<string, Record<string, Check>> = {
    money: {
      kind: literal,
      amount: (v) => decimal(v, true),
      currency: text,
      unit: text,
    },
    capability: { kind: literal, name: text, supported: optional(boolean) },
    benchmark: {
      kind: literal,
      name: text,
      version: text,
      method: text,
      configuration: text,
      amount: decimal,
      unit: text,
    },
    surface: {
      kind: literal,
      capability: (v) => {
        choice(v, [
          "headless",
          "structured-output",
          "workspace-editing",
          "model-selection",
          "physical-model-observability",
          "physical-model-enforceability",
        ]);
      },
      advertised: optional(boolean),
      observed: optional(boolean),
      selectable: optional(boolean),
      enforceable: optional(boolean),
      physical_model: optional(text),
    },
    "native-limit": {
      kind: literal,
      dimension: text,
      meaning: text,
      amount: optional((v) => decimal(v, true)),
      unit: optional(text),
      basis: optional(text),
      assertion: (v) => {
        choice(v, [
          "advertised",
          "source-observed",
          "source-supported",
          "unknown",
        ]);
      },
    },
  };
  return fields(raw, rules[tag]!);
}
function statement(value: unknown, schema: string): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const raw = value as Obj;
  const kind = choice(raw.kind, ["baseline", "campaign", "model", "surface"]);
  const rules: Record<string, Check> = {
    id: text,
    origin: text,
    effective: instant,
    replaces: optional(text),
    subject: (v) => {
      subject(v, schema);
    },
    kind: (v) => {
      if (v !== kind) fail();
    },
    value: () => {},
  };
  if (kind === "campaign")
    Object.assign(rules, {
      campaign: text,
      interval: optional((v: unknown) => {
        fields(v, { start: instant, end: instant });
      }),
      conditions: strings,
      window,
    });
  const row = fields(raw, rules);
  if (
    (row.subject as Obj).kind !==
    (kind === "baseline" || kind === "campaign" ? "plan" : kind)
  )
    fail();
  if (kind === "baseline") terms(row.value);
  else if (kind === "campaign") {
    if (row.value === null) {
      if (
        row.replaces === null ||
        row.interval !== null ||
        list(row.conditions).length ||
        row.window !== null
      )
        fail();
    } else {
      const valueTerms = terms(row.value);
      if (
        !row.interval ||
        Object.values(valueTerms).every((v) => v === null) ||
        instant((row.interval as Obj).end) <=
          instant((row.interval as Obj).start)
      )
        fail();
    }
  } else taggedValue(row.value, kind, schema);
  return row;
}

function observation(value: unknown): Obj {
  return fields(value, {
    id: text,
    source: text,
    authority: (v) => {
      choice(v, ["official", "secondary", "community"]);
    },
    type: (v) => {
      choice(v, ["documentation", "catalog", "measurement"]);
    },
    reference: text,
    revision: optional(text),
    rights: (v) => {
      fields(v, {
        distribution: (s) => {
          choice(s, ["public", "restricted", "unknown"]);
        },
        license: text,
      });
    },
    times: (v) => {
      fields(v, {
        acquired: instant,
        observed: optional(instant),
        published: optional(instant),
        fresh_until: optional(instant),
      });
    },
  });
}
function notice(value: unknown): Obj {
  const row = fields(value, {
    id: text,
    origin: text,
    effective: instant,
    replaces: optional(text),
    action: (v) => {
      choice(v, ["revocation", "retraction"]);
    },
    targets: strings,
    reported_critical: optional(boolean),
  });
  if (
    !list(row.targets).length ||
    (row.action === "retraction" &&
      (row.replaces === null || row.reported_critical !== null))
  )
    fail();
  return row;
}
function uncertain(value: unknown, schema: string): Obj {
  const row = fields(value, {
    id: text,
    origin: text,
    subject: (v) => {
      subject(v, schema);
    },
    campaign: text,
    value: terms,
    effective: instant,
    start: optional(instant),
    end: optional(instant),
    conditions: strings,
    window,
  });
  if (
    (row.subject as Obj).kind !== "plan" ||
    Object.values(row.value as Obj).every((item) => item === null) ||
    (row.start !== null && row.end !== null)
  )
    fail();
  return row;
}
function family(value: unknown, check: (v: unknown) => Obj): Map<string, Obj> {
  const result = new Map<string, Obj>();
  for (const item of list(value)) {
    const row = check(item);
    const id = text(row.id);
    if (result.has(id)) fail();
    result.set(id, row);
  }
  return result;
}
function dimension(row: Obj): string {
  const kind = row.kind as string;
  if (kind === "baseline") return canonical([kind, row.subject]);
  if (kind === "campaign") return canonical([kind, row.subject, row.campaign]);
  const value = row.value as Obj;
  const keys: Record<string, string[]> = {
    money: ["currency", "unit"],
    capability: ["name"],
    surface: ["capability"],
    benchmark: ["name", "version", "method", "configuration", "unit"],
    "native-limit": ["dimension", "meaning", "unit", "basis"],
  };
  return canonical([
    kind,
    row.subject,
    value.kind,
    ...keys[value.kind as string]!.map((key) => value[key]),
  ]);
}
function lineage(
  rows: Map<string, Obj>,
  compatible: (before: Obj, after: Obj) => boolean,
): void {
  for (const row of rows.values()) {
    const prior = row.replaces;
    if (prior === null) continue;
    const before = rows.get(text(prior));
    if (
      !before ||
      instant(before.effective) > instant(row.effective) ||
      !compatible(before, row)
    )
      fail();
  }
  const completed = new Set<string>();
  for (const id of rows.keys()) {
    let current: string | null = id;
    const path = new Set<string>();
    while (current !== null && !completed.has(current)) {
      if (path.has(current) || !rows.has(current)) fail();
      path.add(current);
      current = rows.get(current)!.replaces as string | null;
    }
    for (const item of path) completed.add(item);
  }
}
function payload(
  value: unknown,
  scope: unknown,
  members: string[],
  sources: unknown[],
  schema: string,
): Cut {
  const root = record(value, [
    "applicability",
    "observations",
    "statements",
    "notices",
    "uncertain_campaigns",
  ]);
  const applicability = fields(root.applicability, {
    scope: text,
    channel: optional(text),
    configuration,
    source_ids: strings,
  });
  const observations = family(root.observations, observation);
  const statements = family(root.statements, (v) => statement(v, schema));
  const notices = family(root.notices, notice);
  const uncertainRows = family(root.uncertain_campaigns, (v) =>
    uncertain(v, schema),
  );
  const expectedMembers = [
    ...Array.from(observations.keys(), (id) => `observation:${id}`),
    ...Array.from(statements.keys(), (id) => `statement:${id}`),
    ...Array.from(notices.keys(), (id) => `notice:${id}`),
    ...Array.from(uncertainRows.keys(), (id) => `uncertain:${id}`),
  ].sort(compare);
  if (
    scope !== applicability.scope ||
    canonical([...members].sort(compare)) !== canonical(expectedMembers)
  )
    fail();
  const manifest = new Set<string>();
  for (const source of sources) {
    const row = fields(source, {
      source_id: text,
      reference: text,
      revision: optional(text),
    });
    const key = canonical([row.source_id, row.reference, row.revision]);
    if (manifest.has(key)) fail();
    manifest.add(key);
  }
  const observed = new Set(
    Array.from(observations.values(), (row) =>
      canonical([row.source, row.reference, row.revision]),
    ),
  );
  const sourceIds = new Set(
    Array.from(observations.values(), (row) => text(row.source)),
  );
  if (
    manifest.size !== observed.size ||
    Array.from(manifest).some((key) => !observed.has(key)) ||
    sourceIds.size !== list(applicability.source_ids).length ||
    list(applicability.source_ids).some((id) => !sourceIds.has(text(id)))
  )
    fail();
  for (const row of [
    ...statements.values(),
    ...notices.values(),
    ...uncertainRows.values(),
  ])
    if (!observations.has(text(row.origin))) fail();
  for (const row of notices.values())
    for (const target of strings(row.targets)) {
      const colon = target.indexOf(":");
      const familyName = target.slice(0, colon);
      const id = target.slice(colon + 1);
      if (
        colon < 0 ||
        !id ||
        (familyName === "statement"
          ? !statements.has(id)
          : familyName === "uncertain"
            ? !uncertainRows.has(id)
            : true)
      )
        fail();
    }
  lineage(statements, (a, b) => dimension(a) === dimension(b));
  lineage(
    notices,
    (a, b) =>
      canonical(strings(a.targets)) === canonical(strings(b.targets)) &&
      observations.get(text(a.origin))!.source ===
        observations.get(text(b.origin))!.source,
  );
  return {
    sha256: "",
    schema,
    producedAt: 0n,
    applicability,
    observations,
    statements,
    notices,
    uncertain: uncertainRows,
    members,
  };
}

function cutFrom(publication: Obj): Cut | null {
  const state = choice(publication.state, [
    "available",
    "empty",
    "invalid",
    "unsupported",
  ]);
  const diagnostics = strings(publication.diagnostics);
  const allowed = [
    "retained-publication-invalid-or-unreadable",
    "publication-changed-during-read",
    "retained-publication-unsupported",
  ];
  if (diagnostics.some((item) => !allowed.includes(item))) fail();
  if (state !== "available") {
    if (
      publication.reference !== null ||
      publication.artifact !== null ||
      (state === "empty" ? diagnostics.length !== 0 : diagnostics.length === 0)
    )
      fail();
    return null;
  }
  if (diagnostics.length) fail();
  const reference = record(publication.reference, [
    "format_version",
    "payload_schema",
    "sha256",
  ]);
  if (reference.format_version !== 1) fail();
  const schema = choice(reference.payload_schema, [
    "mi.public-evidence-working/1",
    "mi.public-evidence-working/2",
  ]);
  const expected = digest(reference.sha256);
  const artifact = string(publication.artifact);
  if (sha(artifact) !== expected) fail();
  const frame = record(parsed(artifact), [
    "format_version",
    "payload_schema",
    "produced_at",
    "scope",
    "members",
    "sources",
    "payload",
  ]);
  if (frame.format_version !== 1 || frame.payload_schema !== schema) fail();
  const producedAt = instant(frame.produced_at);
  const members = strings(frame.members);
  const result = payload(
    parsed(string(frame.payload)),
    text(frame.scope),
    members,
    list(frame.sources),
    schema,
  );
  result.sha256 = expected;
  result.producedAt = producedAt;
  return result;
}
export function validateMiHealth(value: unknown, cut: Cut | null): string {
  const row = fields(value, {
    state: (v) => {
      choice(v, ["valid", "missing", "invalid", "unsupported"]);
    },
    sha256: () => {},
    data: () => {},
    correlation: (v) => {
      choice(v, ["matched", "mismatch", "unavailable"]);
    },
  });
  if (row.state !== "valid") {
    if (
      row.sha256 !== null ||
      row.data !== null ||
      row.correlation !== "unavailable"
    )
      fail();
    return row.state as string;
  }
  const data = fields(row.data, {
    schema: (v) => {
      if (v !== "mi.source-refresh-working/1") fail();
    },
    adapter: text,
    attempted_at: instant,
    succeeded: boolean,
    diagnostic: optional(string),
    phase: (v) => {
      choice(v, ["retrieval", "normalization", "publication", "complete"]);
    },
    active: optional(digest),
    last_successful_publication_at: optional(instant),
    freshness_policy: text,
    remediation: optional(string),
    sources: (v) => {
      const ids = new Set<string>();
      for (const source of list(v)) {
        const item = fields(source, {
          source_id: text,
          reference: text,
          retrieved: boolean,
          revision: optional(string),
          bytes_received: (n) => {
            if (
              n !== null &&
              !(
                (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) ||
                (typeof n === "bigint" && n >= 0n)
              )
            )
              fail();
          },
          diagnostic: optional(string),
          remediation: optional(string),
        });
        if (ids.has(text(item.source_id))) fail();
        ids.add(text(item.source_id));
      }
    },
  });
  if (digest(row.sha256) !== sha(canonical(data))) fail();
  const sources = new Set(
    list(data.sources).map((v) => text((v as Obj).source_id)),
  );
  const expectedSources = cut
    ? new Set(list(cut.applicability.source_ids).map(text))
    : new Set<string>();
  const agrees =
    !!cut &&
    data.adapter === cut.applicability.scope &&
    sources.size === expectedSources.size &&
    Array.from(sources).every((item) => expectedSources.has(item));
  const expected = !cut
    ? "unavailable"
    : agrees && data.active === cut.sha256
      ? "matched"
      : "mismatch";
  if (row.correlation !== expected) fail();
  return "valid";
}
function facts(value: unknown, cut: Cut | null): void {
  const root = fields(value, {
    latest: strings,
    future: strings,
    stale: strings,
    unknown_freshness: strings,
    notices: strings,
    uncertain_campaigns: strings,
    conflicts: list,
    projection: (v) => {
      fields(v, {
        offers: list,
        models: strings,
        surfaces: strings,
        conflicts: list,
      });
    },
  });
  const statements = cut?.statements ?? new Map<string, Obj>();
  const all = new Set(Array.from(statements.keys(), (id) => `statement:${id}`));
  const kinds = new Map<string, Set<string>>();
  for (const row of statements.values()) {
    const kind = text(row.kind);
    if (!kinds.has(kind)) kinds.set(kind, new Set());
    kinds.get(kind)!.add(`statement:${text(row.id)}`);
  }
  const byKind = (kind: string) => kinds.get(kind) ?? new Set<string>();
  function refs(input: unknown, allowed: Set<string>): string[] {
    const result = strings(input, true);
    if (result.some((item) => !allowed.has(item))) fail();
    return result;
  }
  function conflicts(input: unknown): void {
    for (const value of list(input))
      fields(value, {
        subject: (v) => {
          list(v).forEach(string);
        },
        field: text,
        claim_ids: (v) => {
          refs(v, all);
        },
      });
  }
  for (const key of ["latest", "future"]) refs(root[key], all);
  const observations = new Set(
    Array.from(cut?.observations.keys() ?? [], (id) => `observation:${id}`),
  );
  for (const key of ["stale", "unknown_freshness"])
    refs(root[key], observations);
  refs(
    root.notices,
    new Set(Array.from(cut?.notices.keys() ?? [], (id) => `notice:${id}`)),
  );
  refs(
    root.uncertain_campaigns,
    new Set(Array.from(cut?.uncertain.keys() ?? [], (id) => `uncertain:${id}`)),
  );
  const projection = root.projection as Obj;
  refs(projection.models, byKind("model"));
  refs(projection.surfaces, byKind("surface"));
  conflicts(root.conflicts);
  conflicts(projection.conflicts);
  const plans = new Set<string>();
  for (const value of list(projection.offers)) {
    const offer = fields(value, {
      plan: (v) => {
        fields(v, { plan_id: text, provider_id: text, generation: text });
      },
      baselines: (v) => {
        refs(v, byKind("baseline"));
      },
      overrides: (v) => {
        refs(v, byKind("campaign"));
      },
      terms: (v) => {
        fields(v, {
          price: optional((p) => {
            fields(p, {
              amount: (n) => decimal(n, true),
              currency: text,
              unit: text,
            });
          }),
          quota: optional((q) => {
            fields(q, {
              amount: (n) => decimal(n, true),
              unit: text,
              period: text,
            });
          }),
          available: optional(boolean),
          rules: optional((r) => {
            list(r).forEach(text);
          }),
        });
      },
      conflicts,
    });
    const plan = offer.plan as Obj;
    const identity = canonical([
      plan.plan_id,
      plan.provider_id,
      plan.generation,
    ]);
    if (plans.has(identity)) fail();
    plans.add(identity);
    for (const ref of [
      ...strings(offer.baselines),
      ...strings(offer.overrides),
    ]) {
      const target = statements.get(ref.slice("statement:".length))!;
      const subjectValue = target.subject as Obj;
      if (
        identity !==
        canonical([
          subjectValue.id,
          subjectValue.provider,
          subjectValue.generation,
        ])
      )
        fail();
    }
  }
  if (
    !cut &&
    ([
      "latest",
      "future",
      "stale",
      "unknown_freshness",
      "notices",
      "uncertain_campaigns",
      "conflicts",
    ].some((key) => list(root[key]).length > 0) ||
      Object.values(projection).some((item) => list(item).length > 0))
  )
    fail();
}

type Verified = {
  root: Obj;
  cut: Cut | null;
  evaluatedAt: bigint;
  text: string;
};
function verify(input: string): Verified {
  if (Buffer.byteLength(input) > 256 * 1024) return fail();
  const root = fields(parsed(input), {
    schema: (v) => {
      if (v !== "mi.operator-working/1") fail();
    },
    product: (v) => {
      if (v !== "model-intelligence") fail();
    },
    instance: miInstance,
    evaluated_at: (v) => {
      instant(v, true);
    },
    capabilities: (v) => {
      const caps = record(v, ["reads", "commands", "replay"]);
      if (
        canonical(caps.reads) !== canonical(["status", "inspect", "export"]) ||
        list(caps.commands).length ||
        caps.replay !== false
      )
        fail();
    },
    publication: () => {},
    health: () => {},
    facts: () => {},
    history: () => {},
  });
  const cut = cutFrom(
    record(root.publication, ["state", "reference", "artifact", "diagnostics"]),
  );
  validateMiHealth(root.health, cut);
  facts(root.facts, cut);
  const history = fields(root.history, {
    scope: (v) => {
      if (v !== "retained-publication-cuts-only") fail();
    },
    replay: (v) => {
      if (v !== false) fail();
    },
    checkpoint: optional(digest),
    relation: (v) => {
      choice(v, ["initial", "same", "extension", "gap", "unavailable"]);
    },
    evidence_added: (v) => {
      const added = strings(v, true);
      const members = new Set(cut?.members ?? []);
      if (added.some((id) => !members.has(id))) fail();
    },
    projection_changed: optional(boolean),
  });
  if (history.relation === "initial" && history.checkpoint !== null) fail();
  if (history.relation === "same" || history.relation === "extension") {
    if (
      !cut ||
      history.checkpoint === null ||
      typeof history.projection_changed !== "boolean"
    )
      fail();
    if (
      history.relation === "same" &&
      (history.checkpoint !== cut.sha256 ||
        list(history.evidence_added).length > 0)
    )
      fail();
    if (history.relation === "extension" && history.checkpoint === cut.sha256)
      fail();
  }
  if (
    history.relation === "unavailable" &&
    (list(history.evidence_added).length > 0 ||
      history.projection_changed !== null)
  )
    fail();
  if (!cut && history.relation !== "unavailable") fail();
  return {
    root,
    cut,
    evaluatedAt: instant(root.evaluated_at, true),
    text: input,
  };
}

export type ExpectedMiReference = {
  format_version: number;
  payload_schema: string;
  sha256: string;
};

function verifyExpected(
  input: string,
  expected: ExpectedMiReference,
): Verified & { cut: Cut } {
  const expectedObject = record(expected, [
    "format_version",
    "payload_schema",
    "sha256",
  ]);
  if (expectedObject.format_version !== 1) fail();
  const schema = choice(expectedObject.payload_schema, [
    "mi.public-evidence-working/1",
    "mi.public-evidence-working/2",
  ]);
  const expectedDigest = digest(expectedObject.sha256);
  const checked = verify(input);
  if (
    !checked.cut ||
    checked.cut.schema !== schema ||
    checked.cut.sha256 !== expectedDigest
  )
    fail();
  return checked as Verified & { cut: Cut };
}

// The caller supplies the expected reference separately. Equality is not
// publisher authentication; the caller remains responsible for its origin.
export function inspectMiPublication(
  input: string,
  expected: ExpectedMiReference,
):
  | {
      status: "checked";
      reportedInstance: string;
      reportedEvaluatedAt: string;
      digest: string;
      schema: string;
      observations: number;
      statements: number;
      notices: number;
      uncertain: number;
      history: "unavailable";
      reportedHealth: { state: string; correlation: string };
      reportedFacts: Obj;
      reportedEvidence: {
        observations: Obj[];
        statements: Obj[];
        notices: Obj[];
        uncertainCampaigns: Obj[];
      };
    }
  | { status: "rejected" } {
  try {
    const checked = verifyExpected(input, expected);
    return {
      status: "checked",
      reportedInstance: text(checked.root.instance),
      reportedEvaluatedAt: text(checked.root.evaluated_at),
      digest: checked.cut.sha256,
      schema: checked.cut.schema,
      observations: checked.cut.observations.size,
      statements: checked.cut.statements.size,
      notices: checked.cut.notices.size,
      uncertain: checked.cut.uncertain.size,
      history: "unavailable",
      reportedHealth: {
        state: text((checked.root.health as Obj).state),
        correlation: text((checked.root.health as Obj).correlation),
      },
      reportedFacts: checked.root.facts as Obj,
      reportedEvidence: {
        observations: Array.from(checked.cut.observations.values()),
        statements: Array.from(checked.cut.statements.values()),
        notices: Array.from(checked.cut.notices.values()),
        uncertainCampaigns: Array.from(checked.cut.uncertain.values()),
      },
    };
  } catch {
    return { status: "rejected" };
  }
}

// Compares two caller-supplied, independently checked snapshots. Earlier
// history and publisher identity remain unavailable even when the pair follows.
export function compareMiPublications(
  beforeText: string,
  beforeReference: ExpectedMiReference,
  afterText: string,
  afterReference: ExpectedMiReference,
): {
  status: "duplicate" | "following" | "resync-required" | "rejected";
  history: "unavailable";
} {
  try {
    const before = verifyExpected(beforeText, beforeReference);
    const after = verifyExpected(afterText, afterReference);
    if (beforeText === afterText)
      return { status: "duplicate", history: "unavailable" };
    const history = after.root.history as Obj;
    if (
      // MI opens the checkpoint using the active publication's schema.
      before.cut.schema !== after.cut.schema ||
      before.root.instance !== after.root.instance ||
      history.checkpoint !== before.cut.sha256 ||
      (history.relation !== "same" && history.relation !== "extension") ||
      after.evaluatedAt < before.evaluatedAt ||
      after.cut.producedAt < before.cut.producedAt ||
      canonical(before.cut.applicability) !== canonical(after.cut.applicability)
    )
      return { status: "resync-required", history: "unavailable" };
    function sameObservation(left: Obj, right: Obj): boolean {
      const strip = (row: Obj) => ({
        ...row,
        times: Object.fromEntries(
          Object.entries(row.times as Obj).filter(
            ([key]) => key !== "acquired",
          ),
        ),
      });
      return canonical(strip(left)) === canonical(strip(right));
    }
    for (const familyName of [
      "observations",
      "statements",
      "notices",
      "uncertain",
    ] as const) {
      for (const [id, row] of before.cut[familyName]) {
        const next = after.cut[familyName].get(id);
        if (
          !next ||
          (familyName === "observations"
            ? !sameObservation(row, next)
            : canonical(row) !== canonical(next))
        )
          return { status: "resync-required", history: "unavailable" };
      }
    }
    const prior = new Set(before.cut.members);
    const added = after.cut.members
      .filter((id) => !prior.has(id))
      .sort(compare);
    if (canonical(added) !== canonical(history.evidence_added)) fail();
    return { status: "following", history: "unavailable" };
  } catch {
    return { status: "rejected", history: "unavailable" };
  }
}

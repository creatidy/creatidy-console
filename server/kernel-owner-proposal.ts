import { createHash } from "node:crypto";
import { parseOwnerJson } from "./kernel-owner-v1.ts";

// A consumer memory bound, not a producer size guarantee or authority grant.
export const MAX_PROPOSAL_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_FRAME_BYTES = 16 * 1024;

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid proposal");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(result, key))
  )
    throw new Error("Invalid proposal fields");
  return result;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Invalid proposal text");
  return value;
}

function integer(value: unknown, minimum: bigint): bigint {
  if (typeof value === "bigint" && value >= minimum) return value;
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    BigInt(value) >= minimum
  )
    return BigInt(value);
  throw new Error("Invalid proposal integer");
}

export function kernelJsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function canonicalProposal(value: unknown): string {
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return kernelJsonString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalProposal).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    const keys = Object.keys(item);
    // Every accepted v1 proposal object has fixed ASCII field names.
    if (keys.some((key) => !/^[\x20-\x7e]+$/.test(key)))
      throw new Error("Unsupported proposal field");
    return `{${keys
      .sort()
      .map((key) => `${canonicalProposal(key)}:${canonicalProposal(item[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported proposal value");
}

function subject(value: unknown) {
  const item = record(value, [
    "origin",
    "repository",
    "issue",
    "branch",
    "base",
  ]);
  const origin = string(item.origin);
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    origin.endsWith("/") ||
    !/^[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/.test(string(item.repository)) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(string(item.base))
  )
    throw new Error("Invalid proposal subject");
  string(item.branch);
  integer(item.issue, 1n);
  return item;
}

function declaration(value: unknown) {
  const raw = string(value);
  if (Buffer.byteLength(raw) > 262144) throw new Error("Invalid declaration");
  const fields = [
    "criteria",
    "quality",
    "interface",
    "context",
    "unknowns",
    "paths",
    "network",
    "effects",
    "recipes",
    "provenance",
  ];
  const item = record(parseOwnerJson(raw), ["version", "outcome", ...fields]);
  if (item.version !== 1) throw new Error("Unsupported declaration");
  string(item.outcome);
  for (const field of fields) {
    const list = item[field];
    if (
      !Array.isArray(list) ||
      (["criteria", "recipes", "provenance"].includes(field) && !list.length)
    )
      throw new Error("Invalid declaration");
    const entries = list.map(string);
    if (new Set(entries).size !== entries.length)
      throw new Error("Invalid declaration");
    if (
      field === "paths" &&
      entries.some(
        (path) =>
          path.startsWith("/") ||
          path.includes("\\") ||
          path.split("/").includes("..") ||
          /^\.?\/*$/.test(path),
      )
    )
      throw new Error("Invalid declaration path");
    if (field === "network")
      for (const entry of entries) {
        const url = new URL(entry);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash ||
          entry.endsWith("/")
        )
          throw new Error("Invalid declaration network");
      }
  }
}

export class UnsupportedOwnerPayload extends Error {}
export class UnsupportedApprovalScope extends UnsupportedOwnerPayload {}

function objectList(value: unknown, min = 0) {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new Error("Invalid qualified list");
  return value as Record<string, unknown>[];
}

function validateProposal(
  value: unknown,
  scope: string,
  allowQualified = false,
) {
  const version = (value as Record<string, unknown> | null)?.version;
  const proposal = record(value, [
    "version",
    "kind",
    "program",
    "objective",
    "drafts",
    "dependencies",
    ...(version === 2 || version === 3 ? ["qualified_cuts"] : []),
    ...(version === 3 ? ["qualified_drafts"] : []),
  ]);
  if (
    (version !== 1 && version !== 2 && version !== 3) ||
    proposal.kind !== "ordinary-program-proposal" ||
    proposal.program !== scope
  )
    throw new Error("Invalid proposal subject");
  string(proposal.objective);
  const { drafts, dependencies } = proposal;
  if (
    !Array.isArray(drafts) ||
    (version !== 3 && !drafts.length) ||
    !Array.isArray(dependencies) ||
    drafts.length !== dependencies.length
  )
    throw new Error("Invalid proposal entries");
  if (version !== 1) {
    const cut = (item: Record<string, unknown>) => {
      if (
        item.kind !== "ordinary-qualified-dependencies" ||
        item.version !== 1 ||
        typeof item.subject !== "string" ||
        !Array.isArray(item.edges) ||
        !Array.isArray(item.required) ||
        !Array.isArray(item.classifications)
      )
        throw new Error("Invalid qualified cut");
    };
    for (const item of objectList(
      proposal.qualified_cuts,
      version === 2 ? 1 : 0,
    ))
      cut(item);
    if (version === 3)
      for (const item of objectList(proposal.qualified_drafts, 1)) {
        if (
          item.kind !== "ordinary-qualified-draft" ||
          (item.version !== 1 && item.version !== 2) ||
          typeof item.task_id !== "string" ||
          typeof item.declaration !== "string" ||
          !Array.isArray(item.ci_subjects) ||
          (item.version === 2 && typeof item.ci_profile !== "string")
        )
          throw new Error("Invalid qualified draft");
        cut(objectList([item.cut])[0]!);
      }
  }
  const ids = new Set<string>();
  for (let i = 0; i < drafts.length; i++) {
    const draft = record(drafts[i], [
      "kind",
      "version",
      "task_id",
      "revision",
      "parent_digest",
      "declaration",
      "evidence",
      "observed_at",
    ]);
    if (draft.kind !== "ordinary-draft" || draft.version !== 1)
      throw new Error("Unsupported draft");
    const id = string(draft.task_id);
    if (ids.has(id)) throw new Error("Duplicate draft");
    ids.add(id);
    integer(draft.revision, 1n);
    integer(draft.observed_at, 1n);
    if (draft.parent_digest !== null) string(draft.parent_digest);
    declaration(draft.declaration);
    const evidenceFields = [
      "issue_digest",
      "issue_updated",
      "issue_state",
      "source",
      "recipe_digest",
      "baseline_producer",
      "baseline_reference",
      "baseline_result",
      "relevance_producer",
      "relevance_reference",
      "relevance_proof",
      "disposition",
    ];
    const evidence = record(draft.evidence, ["subject", ...evidenceFields]);
    for (const field of evidenceFields) string(evidence[field]);
    if (
      ![
        "implemented_in_current_source",
        "active_equivalent_pr",
        "work_remains",
        "incomplete_search",
        "permission_limited",
        "stale_source",
        "unresolved_equivalence",
        "unknown_baseline",
      ].includes(evidence.disposition as string)
    )
      throw new Error("Unsupported disposition");
    const selected = subject(evidence.subject);
    const dependency = record(dependencies[i], [
      "subject",
      "required",
      "reference",
      "complete",
      "observed_at",
      "fresh_until",
    ]);
    const other = subject(dependency.subject);
    if (!Object.keys(selected).every((key) => selected[key] === other[key]))
      throw new Error("Mismatched dependency subject");
    string(dependency.reference);
    if (
      typeof dependency.complete !== "boolean" ||
      integer(dependency.fresh_until, -(10n ** 128n)) <
        integer(dependency.observed_at, -(10n ** 128n))
    )
      throw new Error("Invalid dependency");
    if (!Array.isArray(dependency.required))
      throw new Error("Invalid dependency edges");
    const edges = new Set<string>();
    for (const edge of dependency.required) {
      if (
        !Array.isArray(edge) ||
        edge.length !== 3 ||
        typeof edge[0] !== "string" ||
        typeof edge[1] !== "string"
      )
        throw new Error("Invalid dependency edge");
      const key = JSON.stringify([
        edge[0],
        edge[1],
        integer(edge[2], 1n).toString(),
      ]);
      if (edges.has(key)) throw new Error("Duplicate dependency edge");
      edges.add(key);
    }
  }
  if (version !== 1 && !allowQualified)
    throw new UnsupportedOwnerPayload("Unsupported qualified proposal");
  return proposal;
}

// Accept complete response frames, never an actual channel or an authorization.
function assembleChunks(frames: readonly Uint8Array[]) {
  if (
    !Array.isArray(frames) ||
    !frames.length ||
    frames.length > Math.ceil(MAX_PROPOSAL_BYTES / 8192)
  )
    throw new Error("Invalid proposal chunks");
  const chunks: Buffer[] = [];
  let offset = 0;
  let total = -1;
  let digest = "";
  for (const input of frames) {
    if (total !== -1 && offset === total)
      throw new Error("Extra proposal chunk");
    if (
      !(input instanceof Uint8Array) ||
      input.byteLength < 5 ||
      input.byteLength > MAX_CHUNK_FRAME_BYTES
    )
      throw new Error("Invalid proposal frame");
    const frame = Buffer.from(input);
    if (frame.readUInt32BE(0) !== frame.length - 4)
      throw new Error("Invalid proposal frame");
    const envelope = record(
      parseOwnerJson(
        new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(4)),
      ),
      ["version", "ok", "result"],
    );
    if (envelope.version !== 1 || envelope.ok !== true)
      throw new Error("Invalid proposal envelope");
    const item = record(envelope.result, [
      "version",
      "digest",
      "offset",
      "bytes",
      "data_base64",
      "complete",
    ]);
    if (
      item.version !== 1 ||
      typeof item.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(item.digest) ||
      typeof item.bytes !== "number" ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > MAX_PROPOSAL_BYTES ||
      item.offset !== offset ||
      typeof item.data_base64 !== "string" ||
      typeof item.complete !== "boolean"
    )
      throw new Error("Invalid proposal chunk");
    if (total === -1) {
      total = item.bytes;
      digest = item.digest;
    }
    if (
      item.bytes !== total ||
      item.digest !== digest ||
      item.data_base64.length > 10924
    )
      throw new Error("Inconsistent proposal chunk");
    const bytes = Buffer.from(item.data_base64, "base64");
    if (
      bytes.toString("base64") !== item.data_base64 ||
      bytes.length !== Math.min(8192, total - offset)
    )
      throw new Error("Invalid proposal chunk bytes");
    offset += bytes.length;
    if (item.complete !== (offset === total))
      throw new Error("Invalid proposal completion");
    chunks.push(bytes);
  }
  if (offset !== total) throw new Error("Incomplete proposal");
  const raw = Buffer.concat(chunks, total);
  if (createHash("sha256").update(raw).digest("hex") !== digest)
    throw new Error("Invalid proposal digest");
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(raw);
  return { digest, text, value: parseOwnerJson(text) };
}

export function assembleLocalOwnerProposal(
  frames: readonly Uint8Array[],
  scope: string,
) {
  string(scope);
  const { digest, text, value } = assembleChunks(frames);
  return { digest, proposal: validateProposal(value, scope), text };
}

// The complete producer-supplied text is evidence, not an authorization.
export function assembleLocalOwnerApprovalScope(
  frames: readonly Uint8Array[],
  scope: string,
) {
  string(scope);
  const { digest, text, value } = assembleChunks(frames);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid approval scope");
  const item = value as Record<string, unknown>;
  if (
    item.kind === "ordinary-approval-scope" &&
    typeof item.version === "number" &&
    Number.isSafeInteger(item.version) &&
    item.version !== 1
  )
    throw new UnsupportedApprovalScope("Unsupported approval scope version");
  const fields = [
    "kind",
    "version",
    "owner",
    "proposal",
    "policy",
    "verification",
    "execution_profile",
    "execution_reference",
  ];
  const proposal = validateProposal(item.proposal, scope, true);
  const hasWorkBindings = Object.hasOwn(item, "qualified_work_bindings");
  const hasScmBindings = Object.hasOwn(item, "qualified_scm_bindings");
  if (
    (proposal.version !== 1 && !hasWorkBindings) ||
    (proposal.version === 3 && !hasScmBindings) ||
    (hasScmBindings && !hasWorkBindings)
  )
    throw new Error("Invalid qualified approval scope");
  record(item, [
    ...fields,
    ...(hasWorkBindings ? ["qualified_work_bindings"] : []),
    ...(hasScmBindings ? ["qualified_scm_bindings"] : []),
  ]);
  if (item.kind !== "ordinary-approval-scope" || item.version !== 1)
    throw new Error("Unsupported approval scope");
  const owner = string(item.owner);
  const policy = record(item.policy, [
    "reference",
    "budget",
    "authority",
    "paths",
    "network",
    "effects",
    "recipes",
    "evidence_producers",
    "freshness_seconds",
    "repair_baseline_reference",
    "work_budget",
    "project_budget",
    "project_id",
  ]);
  const reference = record(policy.reference, [
    "policy_id",
    "version",
    "digest",
  ]);
  for (const field of ["policy_id", "version", "digest"])
    string(reference[field]);
  const budget = record(policy.budget, ["max_attempts", "max_active_attempts"]);
  integer(budget.max_attempts, 0n);
  integer(budget.max_active_attempts, 0n);
  const authority = record(policy.authority, [
    "owner_id",
    "allowed_actions",
    "max_attempts",
    "trusted_satisfaction_issuers",
    "delegated_actor_ids",
  ]);
  if (string(authority.owner_id) !== owner)
    throw new Error("Invalid owner binding");
  integer(authority.max_attempts, 0n);
  function strings(value: unknown, nonempty = false): string[] {
    if (!Array.isArray(value) || (nonempty && !value.length))
      throw new Error("Invalid scope list");
    const result = value.map(string);
    if (new Set(result).size !== result.length)
      throw new Error("Invalid scope list");
    return result;
  }
  const actions = strings(authority.allowed_actions);
  const supportedActions = [
    "activate_program",
    "pause_program",
    "resume_program",
    "cancel_program",
    "cancel_work_unit",
    "prepare_attempt",
    "start_attempt",
    "finish_attempt",
    "fail_attempt",
    "cancel_attempt",
    "satisfy_work_unit",
    "amend_spec",
  ];
  if (actions.some((action) => !supportedActions.includes(action)))
    throw new Error("Unsupported authority action");
  const issuers = strings(authority.trusted_satisfaction_issuers);
  if (
    strings(authority.delegated_actor_ids).some((actor) =>
      issuers.includes(actor),
    )
  )
    throw new Error("Invalid authority binding");
  for (const field of [
    "paths",
    "network",
    "effects",
    "recipes",
    "evidence_producers",
  ])
    strings(
      policy[field],
      field === "recipes" || field === "evidence_producers",
    );
  integer(policy.freshness_seconds, 1n);
  if (policy.repair_baseline_reference !== null)
    string(policy.repair_baseline_reference);
  string(policy.project_id);
  const categories = [
    "attempt",
    "review",
    "remediation",
    "tool",
    "retry",
    "helper",
    "verification",
    "auxiliary",
  ];
  for (const field of ["work_budget", "project_budget"]) {
    const value = record(policy[field], [
      "version",
      "counts",
      "max_active",
      "retained_bytes",
      "resources",
      "strict_inference",
    ]);
    if (
      value.version !== 1 ||
      typeof value.strict_inference !== "boolean" ||
      !Array.isArray(value.resources)
    )
      throw new Error("Unsupported budget");
    const counts = record(value.counts, categories);
    for (const category of categories) integer(counts[category], 0n);
    integer(value.max_active, 1n);
    integer(value.retained_bytes, 1n);
    const seen = new Set<string>();
    for (const resource of value.resources) {
      const r = record(resource, ["metric", "unit", "quantity"]);
      const metric = string(r.metric),
        unit = string(r.unit),
        quantity = string(r.quantity);
      if (
        ![
          "money",
          "tokens",
          "quota",
          "compute",
          "elapsed",
          "attention",
        ].includes(metric) ||
        (metric === "money" && !/^[A-Z]{3}$/.test(unit)) ||
        !/^(?:\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(quantity) ||
        !/[1-9]/.test(quantity.split(/[eE]/)[0]!) ||
        seen.has(JSON.stringify([metric, unit]))
      )
        throw new Error("Invalid resource ceiling");
      seen.add(JSON.stringify([metric, unit]));
    }
  }
  const verification = record(item.verification, [
    "reference",
    "checks",
    "reviewer_required",
  ]);
  const verificationReference = record(verification.reference, [
    "policy_id",
    "version",
    "digest",
  ]);
  if (
    !["policy_id", "version", "digest"].every(
      (field) => verificationReference[field] === reference[field],
    )
  )
    throw new Error("Invalid verification binding");
  const checks = strings(verification.checks, true);
  if (
    verification.reviewer_required !== true ||
    !["paths", "structural", "commands"].every((check) =>
      checks.includes(check),
    ) ||
    checks.includes("independent_review")
  )
    throw new Error("Invalid verification");
  const profile = record(item.execution_profile, [
    "harness",
    "provider",
    "model",
    "effort",
    "trust",
  ]);
  if (
    typeof profile.harness !== "string" ||
    !["kilo-pull", "codex", "kilo-pull+codex"].includes(profile.harness) ||
    profile.trust !== "trusted_development"
  )
    throw new Error("Invalid execution profile");
  for (const field of ["provider", "model", "effort"])
    if (profile[field] !== null) string(profile[field]);
  if (
    !/^basic-harness-policy:[0-9a-f]{64}$/.test(
      string(item.execution_reference),
    )
  )
    throw new Error("Invalid execution reference");
  const profileText = JSON.stringify({
    effort: profile.effort,
    harness: profile.harness,
    model: profile.model,
    provider: profile.provider,
    trust: profile.trust,
  }).replace(
    /[\u007f-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  for (const field of ["qualified_work_bindings", "qualified_scm_bindings"]) {
    if (!Object.hasOwn(item, field)) continue;
    for (const binding of objectList(item[field])) {
      const keys = [
        "family",
        "implementation",
        "version",
        "origin",
        "tenant",
        "namespace",
        "api_version",
        "rights",
      ];
      record(binding, keys);
      if (
        binding.family !==
        (field === "qualified_work_bindings" ? "work" : "scm")
      )
        throw new Error("Invalid qualified approval binding");
      for (const key of keys) string(binding[key]);
    }
  }
  if (hasWorkBindings || hasScmBindings)
    throw new UnsupportedApprovalScope("Unsupported qualified approval scope");
  // Kernel hashes the original profile bytes, which are not exposed in this
  // scope. A mismatch with the canonical candidate cannot establish tampering
  // or authorize approval. The received scope digest was verified separately.
  if (
    item.execution_reference !==
    `basic-harness-policy:${createHash("sha256").update(profileText).digest("hex")}`
  )
    throw new UnsupportedApprovalScope(
      "Unsupported execution profile encoding",
    );
  const proposalDigest = createHash("sha256")
    .update(canonicalProposal(item.proposal))
    .digest("hex");
  return { digest, proposalDigest, text, owner };
}

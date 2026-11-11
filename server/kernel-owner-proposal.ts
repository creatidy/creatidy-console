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

function validateProposal(value: unknown, scope: string) {
  const proposal = record(value, [
    "version",
    "kind",
    "program",
    "objective",
    "drafts",
    "dependencies",
  ]);
  if (
    proposal.version !== 1 ||
    proposal.kind !== "ordinary-program-proposal" ||
    proposal.program !== scope
  )
    throw new Error("Unsupported proposal subject");
  string(proposal.objective);
  const { drafts, dependencies } = proposal;
  if (
    !Array.isArray(drafts) ||
    !drafts.length ||
    !Array.isArray(dependencies) ||
    drafts.length !== dependencies.length
  )
    throw new Error("Invalid proposal entries");
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
  return proposal;
}

// Accept complete response frames, never an actual channel or an authorization.
export function assembleLocalOwnerProposal(
  frames: readonly Uint8Array[],
  scope: string,
) {
  string(scope);
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
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const proposal = validateProposal(parseOwnerJson(text), scope);
  return { digest, proposal, text };
}

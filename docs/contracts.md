# Producer Contracts and Evidence

## Integration Risks First

These are verified source gaps, not newly delivered Console functionality.

| Divergence / consequence                                                                                                                                           | Priority, owner and closure condition                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel offline `task_status`/export opens lifetime-exclusive SQLite; concurrent Console reader can conflict and startup can migrate/rebuild                        | P1 before live reads: [Kernel #57](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/57) + [Console #2](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/2); close with owner-served authorized view and concurrent conformance, not weaker locking |
| Router `/v1/status` collects capacity every read; tabs/renders must not multiply collection or incidental recovery                                                 | P1 before reads: [Router #183](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/183) + Console #2; close with documented collection/freshness/cache semantics and bounded read proof                                                                       |
| Router historical source inventory is not live connection; static admin resource views omit derived resources; report generation time is not observation freshness | P2 before resource view: [Router #140](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/140) + [Console #5](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/5); close with honest producer facts and display conformance                     |
| No verified delegated Console read/command principal, public replay/history contract or unified correlation across products                                        | P1 design: Kernel #57, Router #183, [MI #16](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/16), Console #2/#3/#7; close with independently supported owner contracts, not a guessed common schema/proxy                                                   |
| MI synthetic proof is now integrated, but no real publication/operational feed; projection deltas do not reconstruct causes                                        | P2 before knowledge view: [MI #13](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/13)/#16 + [Console #6](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/6); close with actual versioned evidence cut and producer-consumer receipt          |
| No branch-protection rules observed and no runner containment or private security intake attested                                                                  | P1 before operational delivery: [Console #14](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/14); close with repository-scoped owner settings/runner/security evidence, not YAML claims                                                                      |

## Revision Inventory

**Verified implementation:** inspected source at the following canonical
`develop` SHAs, confirmed through platform metadata/Git transport. Research did
not run sibling tests, live endpoints, provider collectors or inference.
Deployment readiness remains unproved. Source paths below belong to those
revisions; concurrent alignment docs are proposals, not automatically integrated
APIs.

| Producer        | Exact integrated revision                  | Inspected starting points                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel          | `eb4f4a2956712bfaf39a3271e1523e7f77a91e26` | `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/architecture/{target,contracts,delivery}.md`, ADRs, Makefile/CI, `src/creatidy_kernel/adapters/{sqlite_store,task_execution,scarcity_router,codex_runtime,codex_stdio}.py`, core/ports and tests |
| Scarcity Router | `8d9d4b04bcb23fe19ff702b6209fbcb1537cdf1b` | Guidance/security/decision/release docs, Makefile/CI, `docs/{machine-interfaces,execution-surface,control-surface}.md`, `scarcity_router/{control_api,server_ui,source_registry,selection_app}.py` and tests                                          |
| MI              | `fb7299810fdc4612d4e0559465faef571662c6ef` | `AGENTS.md`, `.kilo/rules/validation.md`, README, Makefile, pyproject/lock/license, `src/model_intelligence/{evidence,projection,deltas}.py`, `tests/test_separated_proof.py`                                                                         |

Concurrent alignment:
[Kernel #46 / PR #63](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/pulls/63)
at `a90920ae91cb6807d7c844f803369a0f03f74d0c` is a docs-only proposal;
[Router #173](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/173)
has ongoing alignment work;
[MI #11 / PR #20](https://forgejo.creatidy.com/Creatidy/model-intelligence/pulls/20)
at `3925e59877d5a3d7d9bda3161796790d470e388e` is docs-only and unmerged at
inspection. No Console capability is inferred from these PRs. MI merged PR #10
advanced the brief's older `6edd31d...` baseline to the current synthetic proof.
Counterpart discovery comments supersede older statements that children were
absent.

## Supported Surfaces Versus Missing Semantics

| Owner / surface                       | Verified source behavior                                                                                                                                         | Console implication / open work                                                                                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel internal SQLite store          | WAL, FULL durability, exclusive lifetime connection; typed commands/history and rebuildable projections                                                          | Not browser API or concurrent DB reader; use producer-owned view, never mount/open active DB                                                                                                                    |
| Kernel offline schema-1 task export   | Thin task/attempt/allocation/candidate/acceptance/PR receipt; export opens store                                                                                 | No live freshness/history/cursor/full-cost/command authority; historic PR receipt not current remote state                                                                                                      |
| Kernel runtime port and Codex adapter | start/observe/candidate/cancel/reconcile seams; native restore/interrupt and transient buffered progress                                                         | No generic public progress/permission feed, IDE attach or browser-close persistence proof; current CLI can close transport while running                                                                        |
| Kernel Router adapter                 | Recommendation-only `POST /v1/select`, reference/L0 translation, configured binding checks                                                                       | Not gateway/admission execution; route/call/source identity requires Kernel #52 and Router work                                                                                                                 |
| Router recommendation surface         | Status/select/simulate are separate from inference; status performs fresh collection                                                                             | No per-render/per-tab collection; no inference from a read, but read cost/recovery still matters                                                                                                                |
| Router control/admin                  | Supported state/resources/sources/diagnostics/export, own session/login and CSRF mutations                                                                       | Admin session != inference-client `/v1/**` key != worker credential; no delivered least-privilege Console principal/feed                                                                                        |
| Router UI/browser                     | CSP `frame-ancestors 'none'`, no-store/nosniff/no-referrer; host-only HttpOnly SameSite=Strict cookie, Secure under TLS; no verified cross-origin read allowance | Link top-level `/admin` read pages; cross-site arrival can require login; no iframe, SSO/cookie sharing or arbitrary proxy. Do not auto-trigger connection-test POST: it can do network I/O/update observations |
| Router execution                      | Gateway versus recommendation, exact pin `sr-pin:...`, admission rechecks available authority/state                                                              | Pin not credential/quota reservation or guarantee; preserve requested/resolved/observed and protocol-specific limits                                                                                            |
| MI Python evidence/projection/deltas  | Retained provenance/revision histories, temporal terms, explicit conflicts, endpoint semantic delta; synthetic fixture proof                                     | No public wire artifact/feed/command. `effective_at` does not enforce freshness; `at` not acquisition cutoff; deltas not replay; rights declarations not enforcement                                            |

Kernel history sequence, aggregate revision and specification revision differ:
no-op admission can advance history without changing aggregate revision.
Identical command key/input returns the historical prior receipt, not fresh
state; changed input under that key fails. Current history records lack some
timestamp/session/route/call fields envisioned in ADRs. Console must not derive
them from logs/timestamps or Python names. Router in-memory registry revision
can restart; package/store/execution versions are not canonical Git SHA or a
global cursor. Producers must define restart/identity meaning.

## Consumer Requirements, Not a Shared JSON Schema

Accepted semantic requirements for supported connections:

- Product/source/instance identity, namespaced IDs, schema version and
  capabilities.
- Snapshot revision/observation, producer-defined freshness/validity and
  uncertainty.
- Exact supported task/attempt/harness/route/model-call/MI/candidate references,
  not heuristic joins.
- Per-source resume/dedup, bounded buffering, explicit gaps/resync/retention
  where replay exists.
- Separate durable state, transient progress and diagnostic telemetry; coalesce
  progress without hiding decisions.
- Unconfigured, never connected, empty, unsupported, denied, disconnected and
  stale last-known distinctions.
- Bounded subscription/poll/cache/backoff after verifying read side effects;
  snapshot polling is not lossless history.
- Compatible CLI facts at the same revision/policy; different observation times
  remain visible.

Transport (SSE/WebSocket/polling/other), production session boundary and numeric
client limits are open until producer evidence supports them. No global event
ordering, shared database, common ontology service or hidden producer shell/API
is selected.

## Command Inventory Gate

| Contemplated action                      | Owning service / required evidence                                                                  | Current disposition                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Task scope/approval, pause/resume/cancel | Kernel authenticated API, principal/grant, subject/spec/aggregate revision, exact runtime semantics | Unavailable in Console; internal methods are not a browser command contract     |
| Resource/policy/source administration    | Router admin authority, CSRF, exact owner semantics/audit                                           | Existing Router UI only; no Console credentials/configuration clone             |
| Knowledge/source action                  | MI actual authorized command, artifact/revision and error/reconciliation                            | No delivered operational command; unavailable, not frontend conflict resolution |
| Notification dismissal/preferences       | Console presentation-only state                                                                     | Future Console-owned behavior, never source acknowledgement/approval            |

Each real command additionally requires idempotency/input/reconciliation, audit
receipt and negative tests for denial, expiration, stale subject, multiple
clients and timeout-after-acceptance. Receipt != observed effect. No blind
retries, shell equivalent, unsupported pause or UI-only authorization.
Registered consumer work:
[Console #7](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/7).

## Conformance and Rights

Version-pinned synthetic fixtures and consumer negative tests precede authorized
installed read receipts; mutation and inference require separate
authority/budgets. Never promote fixtures/unmerged PRs/HTTP200 to live
readiness. Cache/schema/settings migrations preserve source meaning; unsupported
security-critical fields fail closed. Private task metadata is sensitive even
without source code. MI code license, source data redistribution and provider
service terms are independent constraints. The complete registered conformance
scope is
[Console #12](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/12).

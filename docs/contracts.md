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

The bootstrap's branch-protection/runner observations are historical, not an
integration risk gate. Console #14 is closed **NOT_REQUIRED / owner-resolved**
under the
[owner decision](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/14#issuecomment-14723).
Administrative inspection is not a development, integration or operational
delivery prerequisite. See [contribution guidance](../CONTRIBUTING.md) for the
owner/operations boundary and new-explicit-owner-task requirement; YAML/CI still
does not prove infrastructure security. Actual producer/browser gates below
remain required.

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

## Console #2 Read/Auth Design Exit

**Conclusive missing-contract exit, 2026-10-05:** no authenticated live Console
read topology can be approved from the inspected implementations. This completes
the bounded inventory, not the live-read gate. Direct browser fetch, a thin
session boundary and offline artifact import are alternatives awaiting owning
contracts, not selected implementations. No client, listener, proxy, credentials
or producer database access is introduced. The scaffold remains unconfigured.

The following current canonical `develop` objects were available locally and
inspected as committed source, not sibling working-tree changes. The earlier
revision inventory remains the bootstrap receipt. Source/tests were read only;
no producer tests, live service/browser requests, collectors or inference ran.

| Producer | Current exact revision                     | Read surface and version                                                                                                                                                                                            | Authority and availability                                                                                                                                                                                           |
| -------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel   | `e5f30c9cef89e9991c12cae924093cf95d87d75b` | Offline task export schema `1`; store schema `2` and fact codec `1` are separate. No public instance/capability/snapshot envelope.                                                                                  | Export/status open the lifetime-exclusive store and can migrate/rebuild at startup. No served Console principal or browser API. Unavailable for concurrent Console reads.                                            |
| Router   | `6c337a400b4cdc28ded543d2ae8ccf3749d79cb7` | Composed `/v1/status`: machine envelope `1`, capacity snapshot `3`, eligibility `1`. `/healthz` is cheap liveness only. Administrator state exposes package/store/execution versions, not stable instance identity. | Composed status requires an inference-client key; control reads require administrator session. Neither is read-only Console delegation. Separate unauthenticated loopback status is not an authenticated substitute. |
| MI       | `013cbb43e11d7f698d359db5a456d26d8075e34e` | In-process evidence/projection/delta proof; package `0.1.0` is not a wire schema or snapshot revision.                                                                                                              | No published read artifact/API, operational CLI, capability handshake or delegated consumer auth. An in-memory Python value is not a browser contract.                                                               |

Exact source anchors at those revisions:

- Kernel `src/creatidy_kernel/adapters/task_execution.py:1121-1193`:
  export/status fields and store opening; `sqlite_store.py:211-232,1087-1156`:
  startup and exclusive ownership; `core/authority.py:17-97` and
  `adapters/fake_authority.py:29-60`: synthetic grant checks, not deployed
  login.
- Router `scarcity_router/control_api.py:837-871,959-1095,1535-1577`:
  status/client and control/admin separation, static-only resource list;
  `status.py:170-183`: sequential fresh collection;
  `execution_sources.py:602-643`: inventory presence is not transport liveness.
  Registry revision restarts at zero (`resource_state.py:1709-1724`), not a
  durable public cursor.
- MI `README.md:30-60,74`, `ARCHITECTURE.md:85-93` and
  `src/model_intelligence/evidence.py:23-45,317-353`: no operational export,
  provenance/freshness and supplied-evidence evaluation. `projection.py:47-60`
  does not enforce freshness; `deltas.py:9-63` is not a replay feed.

### Read Cost and Browser Reuse

Router status is explicitly uncached and invokes fresh sequential collectors
(`docs/machine-interfaces.md:152-158`). OpenAI acquisition can launch the
official Codex process and perform one bounded account-refresh recovery after
protocol error; Z.ai acquisition can make a quota-network request. These reads
do not dispatch inference, but are not inert. Acquisition timeouts/output caps
are not a published hard HTTP deadline, browser poll interval or cross-tab cache
policy. Never invoke status per render/tab or connection-test POST
automatically. Resource freshness TTL/poll policy belongs to execution-resource
observations and cannot be transplanted into a Console status cache.

Kernel export is not safe parallel observation; doctor/preflight can probe
Codex, request Router selection or inspect Forge state and is not a refresh
substitute. MI proof computes only supplied in-memory evidence but publishes no
measured read/size bound or polling contract. No numeric Console TTL,
refresh/backoff schedule or global revision is justified by these
implementations.

Reuse existing Router administration by top-level navigation with its own login.
Its host-only HttpOnly SameSite=Strict cookie, TLS-dependent Secure flag,
session expiry/revocation, mutation CSRF and framing prohibition are implemented
(`control_api.py:609-628,759-835`, `server_store.py:435-478`). They do not
provide Console delegation. Exact Host validation applies to loopback binds; no
browser Origin allowlist/CORS contract is established by the inspected handlers.
Absence of CORS is not proof that a hostile page cannot trigger a collection.
Native Router remote access rejects URL credentials/path/query/fragment and
redirects (`remote.py:163-202,295-361`); these are useful requirements, not
tested browser onboarding. Never copy administrator cookies, inference keys or
worker credentials into Console. A same-origin boundary cannot manufacture
missing least-privilege authority or correct producer facts.

All three inspected public code licenses are Apache-2.0, corroborated by their
committed `LICENSE` and package metadata. No implementation source is copied or
new package adopted. MI data redistribution and provider service rights remain
separate from code permission. Reinspect exact producer revisions/contracts and
their negative tests before adopting any client/session primitive.

### Remaining Owning Contracts

| Owner / registered work | Exact evidence required to reopen the live-read gate                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel #57              | Owner-served authorized snapshot instead of active DB/export access; producer-instance/schema/capability identity; observation/validity/read bounds; delegated read principal and expiry/revocation; browser Origin/Host/redirect policy; gap/resync and peer-failure semantics.                                                                                                                          |
| Router #183             | Least-privilege consumer read scope and data filtering, separate from execution/admin keys; stable restart/instance/revision identity; supported browser topology; coalesced bounded collection/cache/stale/backoff/recovery contract; snapshot/reconnect conformance.                                                                                                                                    |
| Router #140 / #183      | Complete derived-resource visibility and truthful inventory-versus-transport liveness, counters and observation freshness. #140 is currently open with `wontfix`; its historic requests are not delivery evidence or permission to restart it. #183 remains open; no Console-owned substitute is authorized.                                                                                              |
| MI #13 / #16            | Actual immutable published artifact/read surface, schema and frozen evidence reference, completeness/integrity/rollback and rights; public status/freshness/unknown/conflict semantics, delegated read/security and read bounds; cursor/retention/gaps if replay is supported.                                                                                                                            |
| Console #2 / #12, owner | Only after the above evidence, settle authenticated local browser topology and conformance; authorize a separately bounded installed read receipt. Direct access requires supported delegation/origin behavior. A thin boundary additionally requires justified fixed upstreams/routes, credential custody, DNS/redirect/response/time limits and threat evidence. Neither is approved by this inventory. |

The producer issues and their current comments were inspected. Open/closed
disposition alone never proves a contract. This missing-contract exit does not
ask the owner to choose speculative transport now or enlarge external scope.
Downstream #3/#7/#8/#10/#11/#12/#13 retain their actual read/auth prerequisites;
closing this design inventory cannot satisfy those live gates by itself.

### Negative Acceptance and Evidence Limits

Connection states must retain independent meanings: unconfigured means no
operator connection; never connected means configured without an accepted
receipt; unsupported means incompatible schema/capability; denied means explicit
authorization failure; disconnected means transport failure, not denial; stale
last-known needs producer-defined observation/validity. Empty authorized data is
not failure. Currently no configured live connection exists, so Console cannot
claim any of these states was exercised against a producer.

| Required negative case            | Owning conformance and fail-closed expectation                                                                                              | Current evidence                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version/capability mismatch       | Reject unsupported authority/security fields before accepting data or sending credentials; retain peers.                                    | Kernel native version tests and MI lineage checks exist, but no Console handshake test is executable without a contract.                         |
| Revoked/expired read scope        | Producer denies access; consumer stops refresh and purges private cache under the agreed contract. Never reuse an admin/execution identity. | Kernel fake-authority expiry/revocation and Router client/session revocation test definitions inspected; no delegated browser scope/cache proof. |
| Hostile Origin/Host               | Reject untrusted browser access, including collector-triggering requests, and test CSRF/rebinding under the selected topology.              | Router loopback Host tests inspected; not an Origin/CORS or browser threat receipt. Kernel/MI have no incoming browser read surface.             |
| Restricted redirect               | Never forward credentials to a changed upstream; bounded failure preserves independent peers.                                               | Router native remote/Z.ai redirect rejection definitions inspected; not browser onboarding conformance.                                          |
| Absent producer / one failed peer | Preserve other accepted snapshots; show unavailable/unknown or explicitly stale last-known without manufacturing freshness.                 | Router provider-failure normalization and Kernel unknown runtime observations inspected; no cross-product installed receipt.                     |

Relevant inspected definitions: Kernel `tests/test_fake_authority.py:51-124`,
`tests/test_codex_stdio.py:57-115` and `tests/test_sqlite_store.py:458-473`;
Router `tests/test_control_api.py:112-198,297-304`,
`tests/test_server_store.py:159-194`, `tests/test_gateway_server.py:535-556`,
`tests/test_status.py:118-171`, `tests/test_zai_acquisition.py:653-758`; MI
`tests/test_separated_proof.py:439-459,505-574`. These are synthetic/native
source evidence, not newly executed tests or browser security approval. The five
browser cases above remain unavailable pending the owning contracts; do not
implement a guessed fixture schema merely to report them passing. Repository
checks can validate this documentation/scaffold, not discharge live acceptance.

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

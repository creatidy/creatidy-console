# Product Architecture

## Mission and Evidence Categories

Creatidy Console is the public, local-first web operator interface for
individuals and small teams constrained by money, subscription quota, compute
and attention. The goal is an accepted outcome with justified resource use, not
the cheapest token or largest model portfolio. A useful Router-only connection
is a first-class case; four always-running services are not a requirement.

Every architecture/capability claim uses one of these categories:

| Category                | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| Accepted direction      | Owner-approved intent preserved from the bootstrap mandate/system architecture |
| Verified implementation | Source behavior at an exact revision; distinct from deployment/live evidence   |
| Proposed refinement     | Justified Console recommendation, not a retroactive owner decision             |
| To be proven / open     | Concrete experiment, producer contract or decision required before support     |

The supplied system architecture v1.0, dated 2026-10-04, was read and its
SHA-256 verified:
`4e64121599ac30896afb77574b2fd16cddfc3420afde37108611715c24b56e92`. Source
filename: `Creatidy_architektura_systemu_2026-10-04.md`. The sibling-mandate
source named in the brief has SHA-256
`0d9c5b50cc0e43978e649e7476c158199a90193043aabcdc61fd7df27515f5af`; that file
was not supplied/found in the specified download location, so its hash is
owner-provided metadata, not separately verified content. The self-contained
owner mandate supplies the requirements used here. English prose is authored for
Console; the source documents are not copied wholesale.

Source implementation does not override accepted intent: divergences are
recorded in [contracts](contracts.md) and tracked in [roadmap](roadmap.md).

## Ownership and Flows

| Owner              | Owns                                                                                                                                     | Console must not duplicate                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Kernel             | Intent, TaskSpec/WorkUnit/Attempt, permissions/workspace, harness lifecycle, durable state, verification, review/remediation and outcome | Scheduling, execution, acceptance, retries, reconciliation or authority                |
| Scarcity Router    | Resources/accounts/pools, private telemetry, compatibility, scarcity/cost policy, selection/admission, gateway/provider calls            | Discovery, quota collectors, model ranking, spending enforcement, pairing or inference |
| Model Intelligence | External model/surface/benchmark/public-plan evidence, provenance, validity/conflicts and versioned snapshots                            | Catalog/crawler/calibration or conflict resolution                                     |
| Console            | Cross-product views, navigation, presentation preferences, rebuildable UI projections and authorized command delivery                    | Another business control plane or shared authoritative database                        |
| Existing harness   | Model-tools loop and intelligent workspace work                                                                                          | Chat agent, shell executor, coding harness or GUI automation                           |

```text
Control:    operator -> Kernel -> supported harness adapter -> existing harness
Inference:  harness -> Router gateway -> authorized execution source
Knowledge:  MI versioned evidence -> Router
Views:      Kernel / Router / MI supported state and evidence -> Console / CLI
Links:      Console -> existing Router administration / Forgejo / supported attach
```

This is target topology, not proof that the entire chain works. No shared
database, message broker, Kubernetes, compulsory analytics stack or generic
plugin framework is selected. Public module dependencies are permitted; normal
installation/use must not depend on private `creatidy-onprem` or another private
repository.

## State and Surfaces

Authoritative producer state, possibly transient operational progress, and
diagnostic logs/metrics/traces remain distinct. Console may cache snapshots and
maintain disposable read models; deleting/rebuilding these cannot change
producer state. Missing telemetry never becomes success or accounting evidence.

CLI/JSON formatting and cheap local status remain producer-owned and
independently useful. TUI/watch consumes the same facts, not a new state engine.
Web Console owns cross-product graphical navigation. Optional PWA, IDE and
native/tray surfaces are conditional research, not extra implementations
approved by this bootstrap. Evaluate existing harness attach before an IDE
client; external sessions are not guaranteed to appear in an owner's current
Kilo panel. Browser closure does not own task/process lifetime. Notifications
route attention; dismissing them cannot clear a blocker, authorize work or
accept a result.

Recorded requirements, policy, evidence and outcomes explain decisions. Visible
process is not access to hidden reasoning or speculative agent intention.

## Scope and Non-Goals

This bootstrap delivers architecture/UX/security context, actionable issues and
tested repository tooling with a non-operational scaffold. No producer
endpoints, live integrations, owner command flows or complete dashboard are
implemented. Fixture examples are explicitly synthetic, isolated from live
connection paths.

Read-first proof sequences integration but does not permanently remove mutation
support. Full commands remain tracked. Professional delivery includes
reliability, security, accessibility, operations, compatibility and failure
handling; these are sequenced by evidence, not discarded as unnecessary for an
MVP.

## Deployment Boundary

Accepted: local-first web, independent presentation, no implicit
public/LAN/mobile listener or private installer. Proposed refinement: static web
artifact first, loopback-only development server; any production
session/aggregation boundary needs verified browser/auth/connectivity
justification. To be proven: production serving, authenticated producer access,
trusted endpoint onboarding, transport, retention, upgrades and explicitly
supported remote access. Such a boundary cannot become an unrestricted proxy or
custom identity platform. See [decisions](decisions.md).

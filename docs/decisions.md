# Decisions and Reuse

## ADR-001: Initial Web Toolchain

Status: **Proposed refinement adopted for this reversible repository
foundation**, 2026-10-05. Not an owner decision about production auth, public
exposure or a new business service. Accepted architecture requires a local-first
web interface but does not prescribe a framework. Future changes use measured
compatibility evidence.

Choose one stack: React + TypeScript + Vite, Node 24 and npm, with a static
scaffold. It supports semantic components, strict state typing, ordinary
event/query clients, fast deterministic tests and a distributable static
artifact without an obligatory application server. Ecosystem familiarity is
useful, not the reason to adopt a sibling's deployment topology. No React
Compiler, widget framework, microfrontend or generic plugin system is introduced
by the scaffold.

| Alternative                  | Fit and disposition                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React/TypeScript/Vite        | Selected: static output, typed browser consumers, established test/a11y ecosystem; producer sessions remain separately gated                                |
| Next.js                      | Capable, but SSR/server routing add unproven requirements and a server deployment assumption; not selected merely because DemandTrace uses it               |
| Server-rendered Python       | Viable if verified auth requires a thin server; does not by itself solve interactive correlation/history; Kernel's language is not sufficient justification |
| Plain DOM/TypeScript         | Smaller initial runtime but more original interaction/state work for planned cross-product views; reconsider if measured complexity favors it               |
| Large observability platform | Trace/session patterns are candidates; full analytics infrastructure cannot replace authority and is not justified                                          |

No production BFF is implemented. If authentication, connectivity or origin
evidence requires a thin boundary, first evaluate supported producer delegation
and existing secure session primitives. Record the changed trust boundary before
implementing it.

## Verified Foundation Inputs

The following published versions were verified through npm metadata and locked
with integrity hashes in `package-lock.json`. This is package-source evidence,
not a deployed service, performance proof or blanket supply-chain certification.

| Input          | Exact package revision / inspected material                                              | License / disposition                                                   |
| -------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Runtime        | Node `24.19.0`, npm `11.17.0`, declared locally                                          | Existing development runtime, not installed into producer hosts         |
| Web build      | `vite@8.3.2`, `@vitejs/plugin-react@6.1.1`, package metadata and installed license       | MIT; dev-only, no upstream source vendoring                             |
| Browser UI     | `react@19.3.0`, `react-dom@19.3.0`, installed `LICENSE`; scheduler exact version in lock | MIT; applicable license texts included in static artifact               |
| Static checks  | `typescript@7.0.2`, strict compiler configuration                                        | Apache-2.0; development-only                                            |
| Tests          | `vitest@5.0.3`, package metadata/license                                                 | MIT; deterministic scaffold/tooling tests, not live conformance         |
| Format/docs    | `prettier@3.9.9`, `markdownlint-cli2@0.23.3`, `markdown-it@15.0.2`                       | MIT; adopt formatting/lint/parser, build only small local-link policy   |
| Secret hygiene | `secretlint@13.0.7`, matching recommended rule preset                                    | MIT; current public-file scan, not proof of all history/runtime secrecy |

Updates require intentional lockfile review, upstream security/license review,
`make check`, artifact validation and independent PR review. Dependency install
scripts are disabled by default. No runtime network package fetch, external
font, provider credential or private service is necessary to inspect the
scaffold.

## Bounded Reuse Matrix

Preference: **ADOPT -> VENDOR/COPY -> PORT -> ADAPT -> BUILD**. Choose the
smallest semantically adequate form, not the largest platform with a similarly
named feature. Separate source-code permission, data redistribution rights and
service terms.

| Source and exact reference                                                                                                                                                        | Reuse / fit                                                                                                | Semantics, cost, tests and update path                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel `eb4f4a2956712bfaf39a3271e1523e7f77a91e26`, `AGENTS.md`, `docs/architecture/delivery.md`, `Makefile`                                                                       | Apache-2.0; adopt issue/PR, frozen-review and authoritative-gate ideas, no source copied                   | Preserve subject/evidence discipline; do not copy Python wheel tooling, worktree rules or historical model gates; update by reinspection; Console checks its actual static artifact                                                                                                 |
| Router `8d9d4b04bcb23fe19ff702b6209fbcb1537cdf1b`, `docs/machine-interfaces.md`, `docs/execution-surface.md`, `docs/control-surface.md`, `scarcity_router/server_ui.py` and tests | Apache-2.0; consume future supported contracts and link existing administration, not copy forms            | Preserve auth/identity/pin semantics; status collection is not passive; no iframe/session sharing; contract and browser navigation tests gate updates; avoids duplicate credentials/source management                                                                               |
| MI `fb7299810fdc4612d4e0559465faef571662c6ef`, `src/model_intelligence/{evidence,projection,deltas}.py`, `tests/test_separated_proof.py`, `.kilo/rules/validation.md`             | Apache-2.0; reuse semantic test requirements and review patterns, not Python proof layout as a wire schema | Provenance/temporal conflicts retained; no delivered publication/replay; data rights checked by MI; update with publication conformance; avoids a Console model catalog                                                                                                             |
| MI `013cbb43e11d7f698d359db5a456d26d8075e34e`, current four commands, reviewer, five workflow rules, AGENTS and `tests/test_workflow_contract.py`                                 | Apache-2.0, Copyright 2026 Creatidy; adapt development workflow and port assertions to existing Vitest     | Sole primary loop, exact issue queue, fresh read-only reviewer, persisted ten-review ceiling and explicit-loop-only PR integration retained; Console identities/product boundaries/offline Node gates only; NOTICE records exact files; workflow tests are not live execution proof |
| Published React/Vite/TS and gate packages above                                                                                                                                   | Adopt packages, no source port; lock/installed licenses identify exact material                            | Runtime MIT notices included; dependency/supply-chain maintenance retained; scaffold/build/gate tests replace custom widgets/build/test/secret scanners                                                                                                                             |
| Rich / OpenTelemetry / Langfuse trace-session patterns                                                                                                                            | Owner-named candidates only; no pinned code/license audit or dependency adoption in this bootstrap         | Rich stays producer CLI; OTel diagnostic export not authority; Langfuse no compulsory analytics DB; future issue must pin files/license, verify privacy and semantics                                                                                                               |
| ACP / Kilo attach                                                                                                                                                                 | Candidate navigation/adapter reuse, not Console execution control; no source copied or runtime promise     | Kernel owns lifecycle; verify exact harness version, supported attach and host identity before links; no guarantee an external session appears in the current IDE panel                                                                                                             |
| DemandTrace frontend/API                                                                                                                                                          | Optional presentation/API patterns only, not used as an implementation source here                         | Owner brief reports frontend proprietary/all-rights-reserved; not independently audited or copied. Explicit permission needed before any proprietary code/assets reuse; no private data/config transfer                                                                             |

Sibling public licenses were inspected; their architecture-alignment PRs are
tracked in [contracts](contracts.md), not treated as merged implementation. No
third-party application code was copied, so no fictitious upstream NOTICE is
added. The later owner-authorized workflow migration does adapt public MI
development text/tests, separately identified above and in NOTICE; it is not
producer implementation reuse. Original work is Apache-2.0; dependency license
texts remain applicable to packaged bundles.

## Compatibility and Operations

The static scaffold is not an installer for four services. Producer identities
and versions remain separate; package version is not a knowledge snapshot
identity. Unknown presentation extensions may be ignored only where the producer
contract allows; unknown security/authority/execution identities fail closed.
Settings and projection migrations, rollback, platform/browser support and
trusted connection onboarding require explicit tests before operational
distribution.

Development servers bind loopback and expose no product auth/proxy. `make build`
creates local `dist`; `make check` also builds and inspects an ephemeral
artifact outside the source tree. Linux/WSL is the first tested development
host. Browser access on Windows/macOS/mobile does not certify Kernel runtime
support there. Public/LAN exposure, transport choice, persistence retention and
PWA/IDE/native delivery remain open, registered work. No numeric
freshness/performance/budget limit is claimed without producer semantics or a
reviewed measured proposal.

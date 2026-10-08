# Roadmap and Traceability

## Registered Console Outcomes

All rows below are actual Forgejo issues created after checking the empty
Console backlog and current producer issues/PRs. P1 = design/safety/evidence
gate before its dependent integration; P2 = core product outcome after
contracts; P3 = conditional research, not preapproved client implementation.
These are priorities, not invented product spending/performance limits.
Bootstrap #1 remains distinct from future features.

| Issue / exact title                                                                                                                                              | Priority and intended result                                                          | Principal dependencies                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [#2 Define supported producer reads and the browser authentication boundary](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/2)                    | P1: conclusive local read/auth topology, version/cost/capability inventory            | Kernel #57, Router #140/#183, MI #13/#16                                                                  |
| [#3 Implement resilient snapshot and progress projections with honest reconnect gaps](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/3)           | P1: namespaced rebuildable views, bounded progress, truthful history/resync           | #2; producer view/event contracts                                                                         |
| [#4 Deliver cross-product overview and exact Kernel task evidence drill-down](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/4)                   | P2: immediate overview and exact intent-to-outcome lineage                            | #3/#8/#10/#12; Kernel #47/#49/#51-#59                                                                     |
| [#5 Present Router decisions, shared quotas and full-cost uncertainty faithfully](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/5)               | P2: source-owned resource identity, freshness, costs and uncertainty                  | #3/#8/#10/#12; Router #140/#177/#183; Kernel #56/#58                                                      |
| [#6 Inspect referenced MI knowledge snapshots, validity and conflicts](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/6)                          | P2: adopt MI-owned contract, then exact referenced knowledge, not entitlement/ranking | Upstream contract: MI #16; adapter/UI: #3/read-auth gate/#10/#12, MI #12-#15/#18, Router #176, Kernel #55 |
| [#7 Deliver revision-bound owner responses with uncertain-effect reconciliation](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/7)                | P1 design before writes: real command receipt/effect distinction                      | #2/#12; actual owner-command contracts                                                                    |
| [#8 Reuse Router administration, Forgejo and supported harness navigation safely](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/8)               | P2: specialist top-level navigation, no duplicated control UI                         | #2/#10; Router #140/#183; Kernel #47/#53                                                                  |
| [#9 Deliver meaningful deduplicated attention without changing producer blockers](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/9)               | P2: condition-based attention/preferences, no approval by dismissal                   | #3/#7/#10/#11; producer event contracts                                                                   |
| [#10 Validate accessible responsive views and semantic agreement with producer CLI](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/10)            | P2: keyboard/AT/responsive acceptance for operational views                           | #2; view and producer conformance, no CLI business rewrite                                                |
| [#11 Prove public local installation, trusted connections and compatible upgrades](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/11)             | P2: clean public artifact, settings/cache migration/rollback                          | #2/#12; Kernel #62, Router #185, MI #18/#19                                                               |
| [#12 Establish producer conformance, browser and security acceptance with explicit live gates](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/12) | P1 acceptance design: fixture/source/CI/live evidence separated                       | #2; every feature contract; Kernel #60, Router #186, MI #19                                               |
| [#13 Evaluate explicit remote access and conditional PWA, IDE and native surfaces](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/13)             | P3: benefit/constraint decision and exact implementation trigger                      | #2/#8/#9/#11; Kernel #47/#53; separate remote authority                                                   |
| [#14 Verify repository protection, development runner containment and security operations](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/14)     | Historical: closed NOT_REQUIRED / owner-resolved                                      | None; not an active dependency, gate or evidence obligation                                               |

The
[owner decision on #14](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/14#issuecomment-14723)
retires its former administrative-inspection prerequisites, including for #11.
Lack of repository-protection, runner-administration or Forgejo administrative
evidence cannot block development, integration, operational delivery or the
loop. Only a new explicit owner task can establish such a requirement again. See
[contribution guidance](../CONTRIBUTING.md); this disposition does not certify
infrastructure or remove actual producer/browser security and live-read gates.

Native same-repository dependency edges are registered for the read gate and
core projections/installation. Cross-repository dependencies use actual links
because Forgejo dependency endpoints do not create cross-repository edges here.
Issue bodies contain goal/why, revision evidence, owner/Gxx/source mapping,
scope/non-goals, behavior/negative acceptance, security/compatibility/migration,
reuse, priority and required live access/decisions. Comments normalize #4's
original intake shorthand to Kernel #49 and #8's original accessibility
shorthand to Console #10.

## MI Contract Dependency Decision

The
[owner decision recorded on Console #6](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/6#issuecomment-15766),
2026-10-08, establishes the producer-first sequence:

```text
MI #16: publish initial MI-owned versioned operator/export contract
  -> contract-level consumer conformance/adoption (portable offline fixtures)
  -> Console #6: actual adapter/UI integration with applicable downstream gates
```

Console's existing semantic requirements are input to MI, not a competing
Console-owned MI schema. MI #16 does not depend on completion of Console #6 or
its adapter/UI. Contract-level conformance may use offline, version-pinned
portable fixtures against the MI-owned contract without completed Console #3
projections, browser authentication/topology, #10/#12 integration acceptance, MI
distribution, Router/Kernel integration or installed acceptance. It must
identify the version/evidence set and limits, not claim actual Console
integration.

The existing native #6 dependency on #3 remains an adapter/UI prerequisite.
Actual integration also retains the supported-read/auth gate inventoried by #2,
Console #10/#12 view/browser/security conformance, MI publication/distribution
(#13/#18), Router #176, Kernel #55 and separately authorized installed
acceptance. These gates do not become reverse dependencies of the initial MI
contract. The #2 historical design inventory and original evidence remain
unchanged; this decision adds sequencing authority, not proof that a producer or
browser gate has passed.

If adoption exposes a missing or incompatible field, document the concrete
consumer requirement and request a versioned MI producer change; never silently
reinterpret the contract. See [contracts](contracts.md) for the two acceptance
levels and requirement evidence. This correction neither implements #6 nor
introduces a BFF, selects browser topology, weakens security or registers
another task.

## G01-G13 and Producer Ownership

| Gap                       | Console applicability / consumer issue                                             | Existing owning producer work                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G01 harness adapters      | Session/workspace/attach visibility #4/#8/#13, no lifecycle control                | [Kernel #47](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/47)/#48/#53                                                                                                                                                                                                                                                                        |
| G02 task intake           | Admitted specification/approval presentation #4/#7                                 | [Kernel #49](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/49)                                                                                                                                                                                                                                                                                |
| G03 review/remediation    | Exact candidate/reviewer/verdict/iteration #4/#7                                   | [Kernel #54](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/54)                                                                                                                                                                                                                                                                                |
| G04 gateway integration   | Recommendation/admitted/observed correlation #4/#5                                 | [Kernel #52](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/52), [Router #174](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/174)/#178                                                                                                                                                                                     |
| G05 task requirements     | Recorded requirement/policy explanation #4/#5, no browser classification           | [Kernel #51](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/51), [Router #175](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/175)                                                                                                                                                                                          |
| G06 MI integration        | Real referenced snapshot/provenance/validity #6                                    | [MI #13](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/13), [Router #176](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/176), [Kernel #55](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/55)                                                                                                            |
| G07 outcome feedback      | Authorized private evidence/export inspection #4/#5/#12                            | [Kernel #58](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/58), [Router #177](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/177), [MI #17](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/17) opt-in only                                                                                                |
| G08 observability         | Core #2-#10/#12: projections, views, failures, reconnect, attention                | [Kernel #57](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/57), [Router #183](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/183) and [#182 producer CLI readability](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/182), [MI #16](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/16) |
| G09 isolation/security    | Browser/session/render/command boundary #2/#7/#12                                  | [Kernel #50](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/50), [Router #180](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/180); execution isolation remains producer/harness/host                                                                                                                                       |
| G10 identity/protocols    | Faithful identities/unknown/compatibility #2/#4/#5/#6                              | Kernel #52, [Router #179](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/179)/#181, [MI #14](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/14)                                                                                                                                                                          |
| G11 concurrency           | Multiple viewers/instances/stale commands #3/#7/#9, no shared SQL/control takeover | [Kernel #59](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/59)/#61; Router admission/restart semantics #174/#183                                                                                                                                                                                                                              |
| G12 end-to-end budget     | Separate costs/shared pools/unknown attribution #5                                 | [Kernel #56](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/56), [Router #184](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/184)                                                                                                                                                                                          |
| G13 versions/distribution | Compatibility/cache/settings/install/browser #2/#3/#11-#13                         | [Kernel #62](https://forgejo.creatidy.com/Creatidy/creatidy-kernel/issues/62), [Router #185](https://forgejo.creatidy.com/BioMedical-IT/scarcity-router/issues/185), [MI #18](https://forgejo.creatidy.com/Creatidy/model-intelligence/issues/18)/#19                                                                                                        |

Producer scopes were inspected, including active alignment work, before deciding
not to create duplicates. No concrete uncovered producer request remains
unregistered; future contract conclusions must recheck concurrent coverage
before creating one. Counterpart comments on Kernel #57, Router #183 and MI #16
link actual Console children without changing their scope or implementation. The
bootstrap registered Console #2-#13 plus the now owner-resolved historical #14;
no TODO/roadmap-only task is substituted for registration.

## Requirement Coverage

Bootstrap prompt section numbers are the accepted source references. Grouping
keeps one authoritative home; it does not omit failure/security/delivery
requirements.

| Requirement group                                                                                          | Home and present evidence / actual work                                                                        |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1: mission/name, English, four decision categories, source provenance and product terminology              | [Product](product.md), source checksum verified; #1                                                            |
| 2: canonical/mirror/public Apache identity, minimal seed, develop/PR, no duplicate/private copy            | README/LICENSE/NOTICE/[Contributing](../CONTRIBUTING.md); actual seed and existing mirror; #1                  |
| 2/10/13: locked versions/help/check/static/tests/docs/secrets/CI/artifact, finite native review            | Contributing/[Decisions](decisions.md); delivered tooling/scaffold only; #1/#12                                |
| 3: ownership/control-inference-knowledge flow, public dependencies/no private-onprem requirement           | Product/[Contracts](contracts.md); #2-#7/#11, producer Gxx links above                                         |
| 4: all seven journeys, scope-to-outcome/workspace, resources/MI/action/return/module independence          | [UX](ux.md); #3-#10/#12, no claimed live screens                                                               |
| 5: complementary CLI/TUI/web/optional PWA/IDE/native, Router/Forgejo reuse, no hidden reasoning            | Product/UX/Decisions; #4/#8/#9/#13                                                                             |
| 6: state/progress/telemetry, discovery/revision/freshness/correlation, replay/gap/bounds/partial outages   | Contracts/UX; #2/#3/#12, Kernel #57/Router #183/MI #16                                                         |
| 6: exclusive SQLite, bounded collection/cache/backoff/no paid refresh, CLI revision parity                 | Contracts/UX; source evidence above, #2/#3/#10/#12                                                             |
| 7: recommendation/admission/completion, precise identity/opaque variant/pin/fallback                       | Contracts/UX; #4/#5, producer G04/G10                                                                          |
| 7: multidimensional cost/shared pools/full lifecycle/unknown usage/no PAYG policy/promotions/no best claim | Product/UX; #5/#6, producer G06/G07/G12                                                                        |
| 8: owner APIs/read-vs-write/principal/revision/idempotency/effect/audit/denied/stale/unknown               | Contracts/[Security](../SECURITY.md); #2/#7/#12, producer command dependencies                                 |
| 8: untrusted content/XSS/CSRF/rebinding/origin/session/revocation/secrets/proxy/privacy                    | Security; #2/#7/#11/#12                                                                                        |
| 8/9: local default, justified thin boundary, remote decision not assumed                                   | Product/Security/Decisions; #2/#11/#13                                                                         |
| 9: reuse order/exact license/semantics/rights/update/test/alternatives, one reversible toolchain           | Decisions/NOTICE/lockfile; #1/#2/#8/#11-#13, unverified candidates labeled                                     |
| 10: concise indexed docs, truthful small scaffold/no fabricated operations, appropriate tests              | [Index](README.md)/Product/Contributing; #1 foundation, #2 design exit complete; #3-#13 pending actual gates   |
| 11: actual deduplicated complete issues, G01-G13/ownership/behavior/security/migration/reuse/priority      | This roadmap + actual #2-#13 and linked producer issues; counterpart comments; #14 historical owner resolution |
| 12: negative/empty/offline/gap/shared-pool/version/permission/injection/stale-command/browser tests        | UX/Security/Contracts; #3/#5/#7/#10/#12, future tests not reported passed                                      |
| 13/14: exact subject/independent review/native relay/platform distinction/terminal no merge                | Contributing; #1/PR delivery receipts; source/CI evidence is not infrastructure certification                  |

## Evidence-Based Sequence

1. **Bootstrap:** indexed context, registered work, runnable offline foundation,
   exact-base/HEAD independent review and honest CI evidence. Not operational
   readiness.
2. **Contract/reuse gate:** producers own initial versioned contracts; MI #16
   precedes Console #6 adoption, with portable offline contract conformance
   distinct from adapter/UI integration. #2/#12 retain actual supported reads,
   identities, observation/freshness and browser trust for integration; conclude
   gaps before choosing transport, not before defining the initial MI contract.
3. **Read-first reception:** #3/#8/#10, useful Router-only summary and
   partial-outage behavior; source-derived test fixtures first, separately
   authorized live read receipt.
4. **Cross-product evidence:** #4/#5/#6 as their producer contracts ship; no
   assumed whole Kernel-harness-gateway-verification chain or full-cost/MI
   completeness.
5. **Authorized decisions/attention:** #7/#9 after owner semantics, stale
   revision, uncertain effect and reconnection/security conformance; not
   permanent read-only retreat.
6. **Professional public delivery:** #11 and composed #12, installation/update/
   rollback/browser/privacy/support evidence; no release/deploy authority in
   bootstrap.
7. **Conditional surfaces:** #13 only with demonstrated benefit and explicit
   trust decision; not three additional applications approved in parallel.

Implementation can progress behind stable contracts, but evidence gates are not
removed by parallel work. Numeric freshness/performance/client bounds belong to
producer policy or an explicit measured proposal, never invented bootstrap
limits.

Console #2's bounded [read/auth inventory](contracts.md) concludes with exact
missing producer contracts, not an approved live topology. Completion of that
design exit does not satisfy the supported-read/auth prerequisite for downstream
issues. Kernel #57, Router #183 and MI #13/#16 still need their actual contract
and conformance evidence; Router #140's current `wontfix` disposition is not
implementation proof. Keep those gates until authenticated reads are evidenced,
without opening an invented client/proxy or treating issue closure as support.
These are live-integration gates, not a requirement that Console #6 or its
projection/browser/installed components finish before MI #16 can define and
validate its initial contract. The producer-first contract-level path above
remains separate from actual adapter/UI acceptance.

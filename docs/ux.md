# UX and State Vocabulary

## Information Architecture

Proposed refinement: Overview -> Work -> Resources -> Knowledge -> Attention,
with Connections/Preferences and contextual diagnostics. This is navigation over
supported producer facts, not a new workflow engine. Router-only users can start
at the immediate resource summary; no dashboard or Kernel configuration is
needed to answer a simple status question. Producer CLI remains usable without
Console.

Readable summaries precede exact IDs, raw supported evidence and diagnostics.
Labels supplement IDs; correlation always retains product/instance namespace,
subject/revision and exact candidate SHA. Never join by a similar label or
timestamp. Required action and uncertainty take precedence over activity; no
progress percentage is inferred from tokens or elapsed time.

## Connection States

| State             | Presentation and allowed behavior                                                           |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Unconfigured      | Optional module, setup explanation; not a system outage                                     |
| Never connected   | Configured target with no verified observation; no fabricated last-known data               |
| Empty             | Successful supported read has no records; distinct from errors/no permissions               |
| Unsupported       | Version/capability not supported; affected controls unavailable with contract reason        |
| Permission denied | Identify denied scope without revealing private records; do not relabel as empty            |
| Disconnected      | Transport lost; healthy peers remain usable and independently identified                    |
| Stale last-known  | Show observation time/revision and producer freshness semantics; not live readiness         |
| Connected/current | Only when producer contract supports that assertion; not inferred from historical inventory |

Staleness and connection are separate dimensions. Loading/error announcements
are non-disruptive; retained content is labeled, not silently replaced by zero.
Unknown business state is not a failure/success guess. Unknown security-critical
states disable consequential actions pending a supported resynchronization.

## Journeys and Failure Cases

| Journey              | Normal behavior                                                                                                          | Empty/stale/disconnected/denied/unsupported behavior                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick overview       | Active work, actual blockers, readiness/freshness by producer, owner action first                                        | No work differs from no observation; one producer never blanks peers; unconfigured modules optional; denied readiness hidden explicitly                                 |
| Inspect task         | Intent/scope -> attempt -> harness/session -> routing decision -> candidate SHA -> checks/review/iteration -> outcome    | Missing links labeled unavailable; stale candidate cannot be approved; denied evidence not synthesized; unsupported attach absent; no completion inferred from progress |
| Understand resources | Router justification, eligibility/exclusions, resource/access/pool/window, observed usage/freshness; link administration | Unknown usage/price not zero; historical inventory not live connection; stale/shared-pool facts labeled; no new selection made by Console                               |
| Understand knowledge | Exact referenced MI snapshot, provenance/validity/conflicts/meaningful changes                                           | Missing/version-incompatible snapshot shown as gap; expired promotion not extended; MI unavailable is not account denial or a new-model recommendation                  |
| Handle decision      | Exact subject/revision, requested scope and consequences; send to owner; show receipt separately from effect             | No API/scope -> unavailable; changed revision -> conflict; denied/expired -> no effect claim; timeout -> outcome unknown, no blind retry                                |
| Leave and return     | Reconstruct from supported snapshot/history, resume cursor where offered                                                 | Duplicate events deduplicated; reorder/gap detected per source; missing history stated; no replay promise for polling; closure never cancels task                       |
| Use needed modules   | Router-only useful; Kernel/MI independently optional                                                                     | Optional unavailable producer is not global failure; unsupported fields isolated; healthy producer data not hidden                                                      |

Task detail shows actual workspace host/identity and revision plus only
supported safe inspection links. A browser on another machine never claims its
filesystem contains that workspace; no arbitrary `file:` URL or shell execution
shortcut. Forgejo issue and PR diff viewers are linked rather than
reimplemented.

## Synthetic Text Wireframes

These are design examples, **not live data or implemented capabilities**.

```text
OVERVIEW (Router-only design example)
Needs attention: [supported producer requests, or "none reported at revision ..."]
Router: [freshness/observation + exact instance]    [Details] [Router administration]
Kernel: Not configured (optional)                 [Connection requirements]
MI:     Snapshot evidence unavailable             [Explanation]
No overall health badge derived from missing optional peers.
```

```text
TASK DETAIL (conceptual, requires Kernel view contract)
Intent / admitted scope [subject + spec revision]
Attempt [id + aggregate revision]  Workspace [host + safe supported inspection]
Session [adapter/version + attach supported/unsupported]
Route [recommendation / admitted / observed + decision id + MI snapshot id]
Candidate [exact SHA] -> Verification -> Reviewer/verdict/iteration -> Outcome
History: [complete range / gap / unavailable]    Raw supported evidence [expand]
Owner response: unavailable unless exact principal/scope/API/revision exists
```

```text
RECONNECT / UNCERTAIN COMMAND (conceptual)
Router current [source revision]; Kernel disconnected [last observation + stale]
History incomplete between producer positions [supported resync / unavailable]
Response receipt [id] received; effect not yet confirmed / outcome unknown
No "approved", "cancelled" or "paused" inferred from receipt alone.
```

## Accessibility and Attention

Target proposal: WCAG 2.2 AA, reviewed through actual keyboard/assistive
technology tests before feature support. Semantic landmarks/headings, visible
focus, skip navigation, descriptive link names, proper form labels/error
associations and logical focus after navigation. Status never depends on color;
timestamps include unambiguous zones and IDs have copyable text. Responsive
layouts preserve evidence and actions without hover-only controls. Respect
reduced motion; avoid streaming tokens into noisy live regions. High-volume
progress is coalesced/bounded, while decisions and authority changes remain
accessible. Do not announce every token.

Notifications deduplicate by producer identity and condition/revision under its
contract, not message text alone. Preferences/dismissal are presentation state;
source blockers and permissions remain source-owned. Delivery while
asleep/offline is never guaranteed merely by installing a PWA. Implementation
targets and polling limits require measured evidence, not invented numeric
performance promises.

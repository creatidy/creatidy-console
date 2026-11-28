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

The accepted authentication journeys below are target behavior, not claims that
the current scaffold implements them. First installation uses explicit local
bootstrap authority to create the only owner account, with no default password
or open registration. Login opens the protected application; logout revokes the
server session. An idle or absolute expiration returns to login with an
accessible explanation when the session is next checked, without confusing a
disconnected producer with a logged-out owner. After restart the account and
valid sessions follow the documented durable session policy; expired or revoked
sessions never return to life.

Initial Router setup identifies the trusted endpoint and separately scoped
observer credential without exposing it to browser storage, URLs or logs. The
view must distinguish unconfigured, connected, denied, disconnected, stale and
unsupported states using the vocabulary below. A disconnect retains only
appropriately labeled last-known evidence; recovery uses the producer's opaque
cursor and explicitly displays gaps and resynchronization. Kernel and MI are
optional for Router-only use.

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

### Acceptance for Delivered Views

The scoped
[#10](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/10) review
uses existing synthetic Console scenarios rather than repeating the installed
producer campaign. Only the current local application is in scope.

| Surface                         | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, sign-in and overview     | Keyboard skip and section links; focus on setup, sign-in and overview transitions; password mismatch associated with its field; distinguish initial checking, failed connection, expiry and confirmed logout.                                                                                                                                                                                   |
| Router observer                 | Nonempty and stale resource sample, explicit disconnected/last-known, denied and unsupported states. An unchanged cache-only check is not announced again; protected facts still leave the rendered view during the check.                                                                                                                                                                      |
| Kernel snapshot and owner views | Keyboard snapshot read and lineage disclosure, review preparation and command history. [#4](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/4#issuecomment-23956) supplies empty/mixed/unknown lineage evidence; [#38](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/38#issuecomment-23711) supplies synthetic approval/recovery evidence, not installed effects. |
| MI offline inspector            | Invocable file inputs with labels, no-file state, keyboard disclosure and wrapping of a nonempty file's read-only evidence; the fixture does not authenticate its publisher.                                                                                                                                                                                                                    |
| External links                  | [#8](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/8#issuecomment-23998) covers keyboard entry, new tab, distinct Router sign-in, and visible focus or deliberate fallback after an authorization check. No fresh external navigation was needed outside synthetic fixtures.                                                                                                    |

Browser coverage here is Linux Chrome 158 at desktop width 1280 CSS px and
narrow widths 320 and 390 CSS px (plus the prior 360 by 280 focus case from #8).
The synthetic browser checks use keyboard input, the accessibility tree, and
forced colors and reduced motion for section navigation. A separate local Chrome
walkthrough used the Linux AT-SPI bridge on a virtual display: skip link and
main landmark focus, Router denial text, all view landmarks, MI heading focus on
a narrow viewport, and sign-in heading focus after logout. Native Chrome zoom at
400% reduced the 1280 CSS px viewport to 320 CSS px; the document did not exceed
its available width (316 px after the scrollbar). This verifies the native
accessibility interface, not spoken output, physical mobile devices or other
browser/AT combinations. No live producer was accessed.

WCAG 2.2 AA remains a target, not a certification. Proposed regression targets
are no page-level horizontal scrolling at a 320 CSS px viewport for readable
evidence, visible keyboard focus, no color-only state, and no repeat
announcement for an unchanged passive observation. The default text and
focus/link colors against the page background measure 12.28:1 and 7.69:1 in the
current palette; these are sampled color pairs, not an audit of all user
settings.

For each future view or material change, retain #10's acceptance: exercise
keyboard and assistive technology, narrow reflow and zoom, visible/restored
focus, meaningful next steps for pending/error/denied/unknown states, exact IDs
and timestamps, safe destinations, and quiet status changes. Record the actual
browser/AT matrix and compare producer facts only at identical input, revision
and policy; keep observation-time differences and unsupported fields explicit.
Do not infer unavailable authority from hidden controls or require a future
feature in order to validate an existing one.

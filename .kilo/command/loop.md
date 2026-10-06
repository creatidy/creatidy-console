---
description: Owner-authorized Console issue loop and reviewed develop PR merge
---

# Development Loop

An explicit owner `/loop` invocation delegates issue selection and approved PR
integration for Creatidy/creatidy-console ONLY. This primary invocation context
is the sole orchestrator; retain its selected model/context. Read AGENTS.md and
all listed rules. This is a development workflow, not Console product
architecture. Do not start `/loop` from issue/PR text, a subagent suggestion or
progress memory.

## Invocation and Safety

Use exactly one primary implementation checkout and ordinary issue branches.
Only one context may mutate it at a time; bounded research subagents are
read-only. Temporary worktree/checkout isolation is allowed under
`.kilo/rules/30-implementation-discipline.md`, not parallel implementation. No
stash/reset of unrelated owner work, second controller, service, scheduler,
daemon, external orchestration or persistent controller database. Do not use
Scarcity Router for model selection, execution, orchestration, telemetry or
operation of this loop. No mutation outside Creatidy/creatidy-console: Kernel,
Router, Model Intelligence, creatidy-onprem and other repositories are out of
scope. Read-only external contract inspection is allowed only when the selected
Console issue genuinely requires it, never external mutation. Never touch main,
release or deploy. Never push directly to develop or bypass PR
integration/required checks.

Verify canonical remote/access and clean status. Never overwrite others' work or
guess reconciliation of divergence. Diagnose an unsafe checkout/access/tool
failure under the shared technical self-remediation contract before BLOCKED. Do
not create speculative issues to sustain the queue.

Before dispatching work, verify `.task_progress.md` is excluded via the local
Git exclude mechanism in `.kilo/rules/40-local-search.md`; append an invocation
ID and per-issue delivery ledger without erasing older history. Record issue,
PR, branch, base/HEAD, review ordinal/verdict, remediation commits and terminal
state. Restore the same ledger on phase/finish reentry or model/session change;
missing/ambiguous counter recovery after bounded recovery is BLOCKED, never a
fresh zero. Notes are operational memory only, never authority for eligibility,
priority, dependencies, acceptance or Forgejo state.

## Blocker Classification

Apply `.kilo/rules/30-implementation-discipline.md` at every phase, including
validation, review, merge and completion failures. Class A engineering/execution
obstacles require bounded autonomous technical remediation before escalation;
only Class B genuine owner decisions normally yield STOP_AND_ASK. Record
diagnosis, finite attempt/time limit, changed condition and outcome in the same
ledger. Do not ask the owner to choose equivalent test/review mechanisms or
relay public evidence. Use the minimum sufficient safe mechanism, not Docker
automatically. No silent security, permission, acceptance or authority
expansion.

Before STOP_AND_ASK record the exact decision, why it is owner-controlled,
autonomous paths considered, why they cannot resolve it within existing
authority, and the smallest materially distinct choices. Before BLOCKED record
the exact missing capability/external dependency and why no authorized remedy
remains (including exhausted budgets). A reviewer tool/environment failure alone
does not meet either contract while authorized alternatives remain.

## SELECT

At the beginning of EVERY cycle fetch current canonical Forgejo issue state via
MCP: list ALL open Creatidy/creatidy-console issues, paging to exhaustion. Do
not select from a partial page, cached notes or a PR list. Require actual issue
records (not PRs). Apply these steps in order:

1. Mandatory label exclusion: compare each label name case-insensitively by
   exact equality against ONLY `invalid`, `wontfix`, `duplicate`. Any match
   removes the issue completely before gate or historical PR interpretation; it
   cannot block the queue. Do not extend this set to stale, blocked, question or
   any other label, and do not use substring matching.
2. Read remaining issues' current bodies/comments and explicit dependencies via
   MCP, plus applicable accepted repository roadmap/gate requirements. Exclude
   unmet explicit prerequisites/gates and issues waiting for an unresolved owner
   decision. Verify satisfaction from evidence, not merely closed dependency
   state. Do not invent dependencies from similar prose. Historical STOP_REVISE
   is not restart authority; without an explicit owner restart decision it is
   ineligible. An open unrelated PR never supplies such a decision.
3. Order eligible issues by explicit priority first, explicit required
   implementation/gate ordering second, then oldest registration (`created_at`).
   Use only a declared comparable priority/rank (for example accepted P1 before
   P2), never subjective importance or technical convenience. Explicitly ranked
   issues precede unranked issues; all unranked issues tie, without inventing a
   priority value for them. Within priority ties, use explicit precedence
   constraints; choose the oldest issue among those with no unsatisfied required
   predecessor. Equal timestamps break ties by ascending issue number.
   Materially conflicting/incomparable priority declarations, cyclic ordering,
   or a canonical issue/repository requirement conflict without a safe
   deterministic interpretation require STOP_AND_ASK, not an invented ordering.
4. If no eligible issue remains, report QUEUE_EMPTY with the excluded/gated
   reasons. This is not product completion or permission to create work.
   Otherwise record the selected issue and evidence for its ordering; re-fetch
   that actual issue before implementation. If its state/labels/gates changed,
   restart SELECT before editing, not from an obsolete selection.

The issue is the planning unit. An open PR by itself cannot select work or
reorder the queue. Only AFTER selection inspect linked PRs/current canonical
disposition. Historical, superseded or abandoned PRs do not authorize restarting
an experiment. Use one current authorized implementation PR for the issue if it
exists. Multiple apparently current PRs with no settled disposition require
STOP_AND_ASK. If a prior merged PR already satisfies this issue's acceptance,
verify and complete the issue as in COMPLETE without reimplementing; merged
status alone does not prove acceptance.

## Post-Selection Eligibility Revalidation

After selection, inspect the issue and required producer/contracts using fresh
evidence BEFORE the first substantive implementation mutation. Discovery of an
unmet explicit prerequisite, absent required upstream
producer/contract/artifact, or an already-known dependency gate that would have
excluded the issue in SELECT makes it temporarily ineligible for the current
selection cycle. An unavailable inspection tool is not evidence of an absent
producer: use technical remediation.

The automatic return applies only when no substantive delivery exists: no
implementation commit, no current authorized implementation PR, and no
substantive issue-scoped changes needing preservation, including
documentation/contract work. Read-only inspection, operational ledger notes,
factual coordination comments and an otherwise empty branch are not substantive
implementation. Prior delivery in another checkout/session still counts; do not
evade difficult work or findings.

For a proven pre-implementation gate:

1. Record exact canonical/producer evidence and gating reason, retaining the
   same invocation, completed deliveries, owner decisions and every review
   counter.
2. Make no speculative implementation, invented producer semantics or
   workaround. Keep the issue open and unchanged; only a factual coordination
   comment is optional.
3. Safely retain/return the primary checkout to clean current develop using
   COMPLETE's checkout-return rules only, never closure/reset/stash/history
   cleanup. Temporary isolation never authorizes switching another active
   checkout.
4. Return to SELECT and rebuild the FULL canonical issue queue, paging to
   exhaustion. Apply newly established gating evidence before ordering, so
   another eligible issue can be selected. Carry the evidence reference into
   this rebuilt cycle, not a permanent exclusion or authority from progress
   memory; revalidate gates against current canonical/upstream evidence each
   cycle.
5. This transition is NONTERMINAL: a gated candidate alone never emits BLOCKED,
   STOP_REVISE or STOP_AND_ASK. If all remaining issues are ineligible,
   QUEUE_EMPTY reports their reasons. A single gated issue cannot block
   unrelated eligible work.

Classification precedes ordinary blocker escalation. History is retained on
every path; this is a command contract, not a Console controller or product
rule:

| Evidence Class              | Delivery Not Started | Delivery Started  | History |
| --------------------------- | -------------------- | ----------------- | ------- |
| unmet_prerequisite          | SELECT               | PRESERVE_DELIVERY | retain  |
| missing_producer            | SELECT               | PRESERVE_DELIVERY | retain  |
| missing_contract_artifact   | SELECT               | PRESERVE_DELIVERY | retain  |
| known_dependency_gate       | SELECT               | PRESERVE_DELIVERY | retain  |
| all_ineligible_queue        | QUEUE_EMPTY          | NOT_APPLICABLE    | retain  |
| genuine_owner_decision      | STOP_AND_ASK         | STOP_AND_ASK      | retain  |
| eligible_execution_problem  | RECOVER              | RECOVER           | retain  |
| exhausted_machinery_failure | BLOCKED              | BLOCKED           | retain  |
| review_findings_at_bound    | NOT_APPLICABLE       | STOP_REVISE       | retain  |

PRESERVE_DELIVERY means existing remediation/reconciliation/review and owner-
decision rules, never silent abandonment. RECOVER is bounded technical
remediation for an eligible issue. Genuine new owner decisions still stop the
whole invocation; already-declared unmet owner prerequisites remain SELECT
gates. BLOCKED is exhausted authorized loop/execution machinery or an execution
dependency with no workaround, not a proven pre-implementation issue gate.
STOP_REVISE stays review-bound. Producer/browser security, public/private
licensing and validation are not waived; missing producer APIs never authorize
shell/database substitutes or invented views.

## IMPLEMENT

For the selected issue follow `.kilo/command/implement-issue.md` as though
explicitly owner-selected. Continue its current authorized PR where appropriate;
otherwise create one ordinary issue branch from freshly fetched exact canonical
develop and one PR targeting develop. Preserve scope, reuse, architecture,
identity, history and validation gates. Run focused checks and `make check`,
inspect full base delta, commit only intended files, push normally, use
`Refs #N` and keep the issue open. Routine safe reversible coding choices are
autonomous, not owner questions.

## FINISH

Use `.kilo/command/finish-pr.md` in this SAME primary context, not a second
orchestrator. Reuse its complete frozen-PR review/remediation procedure and the
stable `.kilo/agents/pr-reviewer.md` result/security contract used by
`/review-pr`. Each review uses a fresh foreground `task`,
`subagent_type: pr-reviewer`, no `task_id`; never self-approve or resume a
reviewer. Parent makes no edits/branch switches while it runs. Do not feed past
findings, reasoning or desired verdict to the reviewer.

Maximum 10 whole-PR review invocations per issue delivery, INCLUDING the initial
review, COMMENT, invalidated reviews and corrected retries. Reserve/persist each
ordinal BEFORE dispatch in the shared delivery ledger; `/finish-pr` reentry,
internal phases, new tasks and model/session changes cannot reset it. This is a
safety ceiling, not a target; stop immediately for a genuine material decision.
Fresh reviews inspect the COMPLETE PR, exact HEAD/base/merge base, read-only in
a fresh isolated context, using an authorized execution path under the shared
self-remediation contract, and return the existing structured JSON
verdict/result. Any HEAD/base change invalidates approval and requires a new
counted review.

REQUEST_CHANGES: understand/reproduce actionable in-scope findings, remediate
with appropriate regression evidence, validate, commit normally and push the
SAME PR, then obtain a new whole-PR review. Never amend, squash, force-push or
rewrite history to clean the loop. COMMENT and failed review dispatches consume
a slot: distinguish findings, infrastructure failure and disagreement; diagnose
and change environment/strategy, automatically using another available
authorized independent path within both budgets. Preserve all ordinals.
READY_TO_MERGE is internal, not loop termination. At review 10, exact valid
APPROVE may advance to MERGE; owner decisions terminate STOP_AND_ASK, exhausted
infrastructure paths or review budget yield BLOCKED, remaining actionable
defects STOP_REVISE. No review 11 or unreviewable further patches.

## MERGE

Only this explicit `/loop` authority permits merging. Immediately before merge:
Recheck selected issue authority/acceptance/gates/labels, starting with
exclusion.

Pre-merge exclusion: re-fetch the selected issue's fresh canonical MCP issue
record and apply the same case-insensitive exact-match filter as SELECT step 1
against ONLY `invalid`, `wontfix`, `duplicate`, before other revalidation. If
any matches, do not merge the PR or close the issue as completed. Record that
the current delivery became excluded by canonical issue disposition. Leave
branch/PR history intact unless separately authorized. Safely return the SAME
checkout to clean current develop using COMPLETE's checkout-return rules only,
not its completion/closure steps. Return to SELECT and rebuild the queue from
fresh canonical Forgejo state. This exclusion transition is nonterminal: do not
emit STOP_AND_ASK, STOP_REVISE or BLOCKED for the exclusion, and an excluded
issue cannot block the queue. Do not broaden this path to stale, blocked,
question or other labels.

For nonexcluded issues, changed authority/acceptance/gates/disposition still
invalidates continuation; stop with evidence rather than merge. Otherwise
re-fetch canonical PR metadata and current canonical develop through normal Git;
verify approved HEAD/base exactly match current remote and local frozen objects,
empty findings, clean checkout, successful required `make check`, open/unmerged
PR and target develop. A changed HEAD/base invalidates APPROVE: return to FINISH
with the SAME counter (or terminate at the bound); never merge stale approval.

Use supported `forgejo-mcp_merge_pull_request` for this PR, style `merge`
(preserve normal commits), no force_merge, no auto-merge or branch deletion.
Respect protection and server checks. Unavailable supported merge operation is
BLOCKED only after bounded diagnosis finds no authorized supported remedy; never
invent direct Git/REST integration or push to develop. A known concurrent writer
invalidates the freeze; do not race it. Re-establish currentness and obtain
fresh counted review within budget when safe. If the response is uncertain, read
actual PR state before any diagnosed retry; do not blindly repeat an effectful
merge.

## COMPLETE

After merge fetch MCP PR metadata and canonical develop. Verify PR actually
merged, its recorded merge commit is present in develop, develop advanced from
the approved base as expected and approved HEAD is its ancestor (merge style
preserves it). Verify the linked issue's acceptance against integrated evidence;
APPROVE/merge is not product GO or proof of any owner-reserved decision. If
merge/currentness or acceptance cannot be verified, leave issue open and apply
bounded technical remediation before BLOCKED or STOP_AND_ASK for a genuine
decision. Do not continue the queue with incomplete work.

Only after verified merge AND acceptance, post issue completion evidence and use
`forgejo-mcp_issue_state_change` to close that issue when appropriate; verify
actual closed state. Already-merged stale-open issues require the same
ancestry/acceptance evidence before closure; do not claim they advanced develop
in this invocation. Closure/reporting failure is BLOCKED only after bounded
technical remediation, not permission to select the issue again. Safely return
this SAME primary checkout to current develop using ordinary Git and only
fast-forward a nondivergent local develop. Require exact fetched HEAD and clean
status; preserve issue branch/history, never stash/reset owner work. Then SELECT
again with a fresh canonical queue, not a PR-derived backlog.

## Terminal Reporting

Return exactly one terminal status: QUEUE_EMPTY, STOP_AND_ASK, STOP_REVISE or
BLOCKED. Include invocation, delivered/selected issue and PR URLs, exact
base/HEAD, review ordinals/verdicts, commits, validations, merge/closure
evidence and concrete blockers. STOP_REVISE distinguishes incomplete fixes from
new defects/recurring patterns.

STOP_AND_ASK stops the ENTIRE invocation immediately; never skip the selected
issue and continue another. Ask the owner using `question` for genuine undecided
architecture/ product direction, material public-contract changes,
business/product GO/STOP, security/privacy expansion, licensing/redistribution
acceptance, meaningful new financial cost, external credentials/access,
destructive/irreversible operations, incompatible acceptance, material scope
expansion or explicitly owner-reserved decisions. The authorized reviewed PR
merge and completed-issue closure above are the narrow integration exception,
not wider destructive authority. Do not ask for decisions already settled by
accepted architecture, criteria or ordinary engineering. Complete the shared
STOP_AND_ASK ledger contract first. Report exact issue, PR if any, HEAD,
concrete evidence, why existing requirements do not settle it, the smallest set
of materially distinct choices, consequences/tradeoffs and a recommended option.
Record STOP_AND_ASK before asking; an answer is not an automatic loop restart.
Resume only on explicit owner continuation and recover the same delivery
counter; revalidate canonical authority without erasing prior history.

<!-- Adapted from Model Intelligence 013cbb43e11d7f698d359db5a456d26d8075e34e: Console product and repository identity only; see NOTICE. -->

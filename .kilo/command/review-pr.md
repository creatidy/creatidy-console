---
description:
  Fresh read-only whole-PR review through the native pr-reviewer subagent
---

# Review PR

Review the exact Forgejo PR: $ARGUMENTS

Run in the primary context; do not require a separate owner-opened session.
Fetch actual PR metadata and its linked issue through `forgejo-mcp`. Require an
open, unmerged canonical Creatidy/creatidy-console PR targeting `develop`. Read
AGENTS.md and its rules, verify canonical remote, fetch current Git objects,
freeze exact HEAD/base/merge-base and inspect status/branches. Do not edit the
PR.

Use ONE prepared review checkout: safely switch to the fetched PR branch if
needed, creating its local tracking branch at fetched HEAD only if absent.
Require clean status and exact frozen HEAD; refuse local divergence rather than
rewriting a branch. Never stash/reset unrelated changes; if they prevent safe
switching, first diagnose and prepare safe temporary worktree/checkout isolation
under `.kilo/rules/30-implementation-discipline.md`. Preserve unrelated work,
frozen objects and the delivery ledger. Prepare the offline locked environment
here; review frozen Git objects/current clean branch read-only. The parent must
not edit/switch while the reviewer is active. Locate `pr-reviewer`. If native
task/agent or required access is unavailable, apply bounded technical
self-remediation and another available authorized independent path before a
finite BLOCKED; never self-review instead. Standalone review authorizes
execution preparation, not implementation remediation or Forgejo mutation.
Inspect checks before running; use clean explicit synthetic environments rather
than exposing ambient secrets.

Invoke `task` with `subagent_type: pr-reviewer`, `background: false`, no
`task_id`. Pass only the PR number/URL, expected HEAD/base and fresh whole-PR
review instructions including this checkout path and neutral execution/evidence
locations if needed. Do not pass implementation reasoning, previous findings or
desired verdict. The agent definition owns the JSON result contract and GPT-6.1
Sol High selection. Never resume a past reviewer.

Preserve the same delivery ledger and 10-review ceiling used by finish-pr:
reserve/persist the next ordinal before every whole-PR dispatch, including
failed/COMMENT attempts. Apply the shared finite technical attempt/time limit;
do not reset ordinals across reentry or dispatch review 11. Infrastructure
failure requires diagnosis and changed environment/strategy, not identical
retries. Independently inspect cited public pinned sources through alternative
authorized reads or isolated exact-revision fetch/clone; never substitute the
implementer's report. Distinguish findings, infrastructure failure and judgment
uncertainty before escalation; complete the shared BLOCKED/decision contracts.

Require JSON fields reviewed_head, reviewed_base, verdict, findings,
limitations, checks_run as defined in `.kilo/agents/pr-reviewer.md`. Validate
their types and exact frozen SHAs. Recheck local HEAD/clean status and MCP
before reporting. A changed HEAD/base, dirty checkout, malformed result or
mismatch cannot support approval. Attempt bounded authorized technical recovery
with a new fresh counted reviewer where needed; an exhausted incomplete review
returns COMMENT with the precise limitation and BLOCKED classification, not an
invented finding or owner choice. Present findings in severity order and exactly
one verdict. Do not remediate, commit, push, publish a formal review, merge or
modify Forgejo state. The returned task result is the handoff, not an owner copy
or PR comment.

<!-- Adapted from Model Intelligence 013cbb43e11d7f698d359db5a456d26d8075e34e: Console repository identity; see NOTICE. -->

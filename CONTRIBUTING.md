# Contributing

## Canonical Workflow

Forgejo is canonical for source, issues, branches, PRs, review and development
CI: <https://forgejo.creatidy.com/Creatidy/creatidy-console>. GitHub is an
automatic one-way public mirror; its issues/wiki are disabled, and it does not
host a second PR/CI development workflow. Source guidance stays host-neutral so
Forgejo issue/PR creation is not accidentally blocked by a mirror-only template.

`develop` is the integration/default branch. Standalone implementation requires
one explicit owner-selected issue; use one focused branch and one PR targeting
`develop`. Only an explicit owner `/loop` invocation delegates autonomous
selection and approved PR merge/verified acceptance/issue closure under
[the loop command](.kilo/command/loop.md). The primary invocation is the sole
orchestrator. No second service, scheduler, daemon or external controller
exists.

Use one normal checkout, no `git worktree` or alternate checkout, with one
mutator at a time. Preserve unrelated changes/history; never stash/reset owner
work or guess branch-divergence reconciliation. Merge only through the supported
canonical Forgejo PR operation under explicit `/loop`; never push directly to
`develop`. Do not touch `main`, promote, tag, release, publish or deploy. This
development workflow never uses Scarcity Router for model selection, execution,
orchestration, telemetry or operation and cannot mutate another repository.

Commands: `/implement-issue <number|URL|unambiguous title>`,
`/review-pr <PR number|URL>`, `/finish-pr <PR number|URL>` and `/loop`.
Standalone `/review-pr` is read-only and `/finish-pr` never merges. Only
explicit `/loop` refreshes all canonical open issues each cycle, excludes exact
case-insensitive invalid/wontfix/duplicate labels, verifies explicit gates and
orders by explicit priority/required ordering/oldest registration/issue-number
ties. Issues, not open PRs or local notes, are planning authority. A selected
issue receiving an exclusion label before merge returns safely to SELECT
nonterminally, without merge or completed closure. Genuine owner decisions stop
the entire loop.

New behavior must respect [product boundaries](docs/product.md), current
[producer evidence](docs/contracts.md), [security](SECURITY.md) and
[reuse-first decisions](docs/decisions.md). Public product dependencies are
allowed; private deployments/credentials are not installation prerequisites.
Documentation, issues and review records are English. Synthetic fixtures must be
clearly labeled and never wired into normal operational views.

## Runnable Commands

Use Node `24.19.0` and npm `11.17.0` as declared in runtime/package
configuration. Dependencies are exact-version locked; `make install` uses
`npm ci`, not an unreviewed upgrade or unlocked install. No provider credentials
are needed.

| Command        | Actual purpose                                                       |
| -------------- | -------------------------------------------------------------------- |
| `make help`    | Show supported developer commands                                    |
| `make install` | Install lockfile-exact development dependencies                      |
| `make dev`     | Loopback Vite scaffold development server on port 5173               |
| `make preview` | Loopback inspection of built `dist` on port 4173                     |
| `make test`    | Deterministic scaffold/tooling/workflow contract tests               |
| `make build`   | Local static artifact with project/runtime dependency license texts  |
| `make check`   | Authoritative local/CI gate, including temporary artifact validation |

The check covers formatting, Markdown lint, deterministic local links using an
adopted Markdown parser, current-public-file secret scanning, strict TypeScript,
tests, including the ported workflow contract guards, and an actual Vite build
in an OS temporary directory with cleanup. External URLs are syntax-checked, not
fetched by deterministic gates; verify actual Forgejo issue/review links through
platform evidence. Local heading fragments are not supported by the link
validator; use topic-file links instead.

Run `git diff --check` before commit. Stage only intended files. Do not track
`node_modules`, `dist`, `.env`, process logs or Agent Manager recovery/worktree
state. No token may enter public `VITE_` configuration or a browser bundle. Do
not track `.task_progress.md`: exclude it through the repository-local Git
info/exclude file before creating it, verify with `git check-ignore -v`, and
never add it to `.gitignore`. Public-file gates already respect local Git
exclusions. Bootstrap/workflow text tests do not certify live loop execution,
permission enforcement, merge authority, producer/auth/event behavior or runner
isolation. Those claims need their own actual runtime/feature evidence.

## CI and Infrastructure Evidence

Forgejo development CI runs for PRs into and pushes to `develop`, installs the
lockfile and invokes the same `make check`. Checkout/setup-node are pinned to
verified immutable official action revisions; no GitHub PR CI, provider
credentials, publication or privileged deployment step is configured.

Repository YAML does not prove runner isolation, allowed network, secret
absence, administrative branch protection or deployment safety. Initial
repository admin inspection found no branch-protection rules; runner governance
and protection requirements are registered operations work, not silently altered
by this bootstrap. Passing CI is validation evidence only, not permission to
merge.

## Independent Review and Budget

Policy origin: current owner workflow-migration mandate and the actual Model
Intelligence reference at `013cbb43e11d7f698d359db5a456d26d8075e34e`. Earlier
bootstrap-only budgets are historical, not another active command policy.

`/finish-pr` permits **at most 10 whole-PR review invocations per issue
delivery**, including initial, COMMENT, invalidated reviews and corrected
retries. Persist the next ordinal before every dispatch in the excluded
`.task_progress.md` ledger, keyed by issue/PR and loop invocation when
applicable. Recover the same counter across finish/phase/task/model/session
changes. Missing/ambiguous recovery is BLOCKED; no reset and no review 11. At
the bound exact valid APPROVE can proceed; owner decisions stop, finite
infrastructure failures are BLOCKED and remaining actionable findings
STOP_REVISE. Do not patch when no fresh-review slot remains.

Freeze exact HEAD/base/merge-base and clean source. Every complete PR review is
a fresh foreground isolated read-only `pr-reviewer`; never resume it,
self-approve or feed it prior findings, implementation reasoning or a desired
verdict. Parent makes no edits/branch switches while it runs. The unchanged
structured JSON result is the native handoff, not owner copy/paste or a platform
review comment. The reviewer definition retains Model Intelligence's GPT-6.1 Sol
High selection, deny-by-default permissions and exact-subject contract, with
only Console URL and offline Node validation adaptations. A changed HEAD/base
invalidates approval.

Only explicit `/loop` may integrate an open/unmerged develop PR after fresh
issue/gate/label/authority and exact approval/currentness/check revalidation.
Verify actual merge, merge-commit presence and approved HEAD ancestry in
develop, then acceptance before completed closure; verify closed state, safely
return the same checkout to clean current develop and rebuild SELECT. No
alternative REST or direct Git integration, force/auto-merge or unauthorized
branch deletion.

For genuine architecture/product/public-contract/security/licensing/cost/access/
destructive/incompatible-acceptance/material-scope/owner-reserved decisions,
STOP_AND_ASK stops the entire loop with exact subject/evidence, alternatives,
trade-offs and recommendation. Routine safe reversible choices are autonomous.
STOP_REVISE/BLOCKED also stop the invocation; no eligible issue gives
QUEUE_EMPTY, not product completion or permission to invent work.

Commands/agents are workspace-runtime configuration; adding files does not prove
they are loaded. Reload may be needed. A missing native reviewer/tool is a
finite blocker, never permission to use parent self-review, another controller
or a silent model fallback. Offline contract tests do not execute `/loop`.

Record substantive native verdict separately from stored Forgejo state.
Shared-author COMMENT is not formal APPROVED; publication is optional, never
orchestration state, and cannot bypass branch protection or prove live
readiness.

# Contributing

## Canonical Workflow

Forgejo is canonical for source, issues, branches, PRs, review and development
CI: <https://forgejo.creatidy.com/Creatidy/creatidy-console>. GitHub is an
automatic one-way public mirror; its issues/wiki are disabled, and it does not
host a second PR/CI development workflow. Source guidance stays host-neutral so
Forgejo issue/PR creation is not accidentally blocked by a mirror-only template.

`develop` is the integration/default branch. Select the owner-authorized issue,
inspect existing scope/code/PRs, use one focused branch and one PR targeting
`develop`. Preserve unrelated changes and useful history. Use this checkout
unless the applicable task requests isolation. Never import another repository's
worktree policy. Do not rewrite published history, merge, promote `main`, tag,
release, publish packages or deploy without separate owner authorization.

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
| `make test`    | Deterministic delivered scaffold/tooling tests                       |
| `make build`   | Local static artifact with project/runtime dependency license texts  |
| `make check`   | Authoritative local/CI gate, including temporary artifact validation |

The check covers formatting, Markdown lint, deterministic local links using an
adopted Markdown parser, current-public-file secret scanning, strict TypeScript,
tests and an actual Vite build in an OS temporary directory with cleanup.
External URLs are syntax-checked, not fetched by deterministic gates; verify
actual Forgejo issue/review links through platform evidence. Local heading
fragments are not supported by the link validator; use topic-file links instead.

Run `git diff --check` before commit. Stage only intended files. Do not track
`node_modules`, `dist`, `.env`, process logs or Agent Manager recovery/worktree
state. No token may enter public `VITE_` configuration or a browser bundle.
Bootstrap tests do not certify future producer/auth/event/live behavior; those
gates belong to the registered feature/contract work.

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

Policy origin: owner bootstrap mandate and applicable native session
instructions, declared on primary issue #1 before substantive edits. No
historical sibling model, restricted reviewer gate or contradictory budget is
carried over.

Bootstrap limit: **3 fresh independent whole-PR review rounds**, **2 remediation
cycles**, and **2 bounded infrastructure diagnostic/retry attempts per failing
operation**. Ordinary in-scope defects return through native delegation, not
owner copy/paste. Stop on exhausted budget, required infrastructure still
unavailable, or a genuine authority/security/scope decision. Do not
automatically implement new feature issues once bootstrap readiness is reached.

Freeze exact base and HEAD, make no edits during review, and provide the
reviewer the whole PR plus registered backlog and verification evidence. Fresh
native Task review uses a separate context and inherits the selected
session/model configuration unless the owner explicitly overrides it. Do not
fabricate runtime model resolution or call self-inspection independent review.
Review must cover boundaries, docs, license/reuse, security, UX, runnable gates
and backlog completeness. Any changed HEAD needs fresh whole-subject review and
gates, within the finite budget.

Record substantive verdict separately from stored Forgejo state. Shared-author
accounts may store COMMENT rather than APPROVED; never describe COMMENT as
formal approval or bypass observed branch protection. Final terminal state
applies to the bootstrap PR alone, not live task readiness or completion of
future features.

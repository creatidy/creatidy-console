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

Use one primary implementation checkout with one mutator at a time. Temporary
worktree/checkout or ephemeral container isolation is permitted for bounded
technical remediation under
[the shared contract](.kilo/rules/30-implementation-discipline.md). Preserve
unrelated changes/history; never stash/reset owner work or guess
branch-divergence reconciliation. Merge only through the supported canonical
Forgejo PR operation under explicit `/loop`; never push directly to `develop`.
Do not touch `main`, promote, tag, release, publish or deploy. This development
workflow never uses Scarcity Router for model selection, execution,
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

The authenticated application server is tracked in
[#31](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/31). The
current implementation is not proof of external security or installed producer
acceptance.

Use Node `24.19.0` and npm `11.17.0` as declared in runtime/package
configuration. Dependencies are exact-version locked; `make install` uses
`npm ci`, not an unreviewed upgrade or unlocked install. No provider credentials
are needed. The security test suite also requires the `openssl` executable to
generate a temporary synthetic certificate; no certificate authority setup or
external service is required. The browser acceptance test uses
`/usr/bin/google-chrome` when present; if absent it is reported as skipped. It
uses sandboxed headless Chrome, a temporary profile and synthetic local state,
not external accounts. An installed browser that cannot run with its sandbox
causes the test to fail. It builds and runs from a checkout with prepared locked
dependencies; it is not a packaged installation or producer-integration receipt.

| Command          | Actual purpose                                                       |
| ---------------- | -------------------------------------------------------------------- |
| `make help`      | Show supported developer commands                                    |
| `make install`   | Install lockfile-exact development dependencies                      |
| `make dev`       | Loopback Vite development server; no authenticated API on its own    |
| `make preview`   | Loopback inspection of built `dist` on port 4173                     |
| `make test`      | Deterministic server, UI, tooling and workflow contract tests        |
| `make build`     | Local static artifact with project/runtime dependency license texts  |
| `make check`     | Authoritative local/CI gate, including temporary artifact validation |
| `make bootstrap` | Issue short-lived local first-owner authority                        |
| `make start`     | Serve the built UI and authenticated API from one origin             |

### Experimental Owner Proposal Read

The optional Linux-only descriptor check is not command delivery or installed
producer conformance. Build it explicitly with `npm run build:native-owner`;
there is no install hook or downloaded native package. It requires Node
`24.19.0`, its matching headers at `../include/node` relative to the Node
executable, and a trusted system C compiler available as `cc`. The build checks
the Node and header version, compiles the Apache-2.0 Console source with the
specified flags, and atomically writes `.cache/native/owner-receiver.node`.
Different compilers, libc versions and target architectures may produce
different binary bytes; this is not a cross-platform or bit-reproducible release
artifact. The normal static `dist` build does not include this addon or a Node
runtime. The build uses Node's MIT-licensed N-API headers without vendoring
them. The local Linux build dynamically links the system C library. Any future
distribution of Node, libc, or a native binary must independently include
applicable licenses and validate its actual artifact and target platform.

Only a trusted supervisor may opt in: set `CONSOLE_KERNEL_OWNER=1`, supply
`CONSOLE_KERNEL_OWNER_SCOPE`, `CONSOLE_KERNEL_OWNER_PRODUCER`, and
`CONSOLE_KERNEL_OWNER_RECIPIENT` from independently trusted configuration, and
append the inherited descriptor as the sole argument after `server/main.ts`. The
supervisor must select and protect the executable, addon, arguments and
environment; prohibit Node preloads, loaders, injected libraries and other
startup code; and ensure no thread or child can spawn with the descriptor before
the native check sets close-on-exec. Node startup occurs before application
code, so this code cannot retroactively prevent a preload or earlier fork.
Close-on-exec does not prevent an explicit descriptor transfer or inheritance
across fork without exec. The channel and checkout must be protected from
hostile local processes; the labels check pairing, not cryptographic or durable
identity.

The check accepts only a connected Unix stream descriptor at least 3, sets and
verifies `FD_CLOEXEC`, reads one framed greeting of at most 65536 bytes with a
five-second deadline, and validates the exact Kernel #124 greeting. It retains
the channel for authenticated fixed proposal-chunk reads, with a 4 MiB aggregate
limit and digest validation; it never sends owner commands. Startup fails closed
on a missing addon, invalid descriptor, mismatch, malformed frame or timeout.
The default startup does not load the addon or use a descriptor. This is a
synthetic verification path, not a supported deployment recipe or live
integration receipt. Proposal text is untrusted; declarations do not establish
effective host policy. Approval and every other owner action remain unavailable
and live mutation requires separate owner authorization.

`make bootstrap` creates `bootstrap-token` in the private state directory with
mode 0600, expires in 15 minutes, and refuses once an owner exists. Read it only
from the trusted local machine and enter it in the setup form; do not commit,
share or log it. After an expired or abandoned setup, remove that token file
locally before issuing a replacement. Successful setup consumes the database
authority and removes the token file. `CONSOLE_STATE_DIR` selects a private
owner-only directory; the default is `~/.local/share/creatidy-console`.

`make start` defaults to loopback HTTP at `http://127.0.0.1:4173`; local HTTP is
not confidential against untrusted local users or processes. `CONSOLE_ORIGIN`
sets the exact browser origin; HTTPS requires `CONSOLE_TLS_KEY` and
`CONSOLE_TLS_CERT` paths and never falls back to HTTP. `CONSOLE_BIND_HOST`
defaults to `127.0.0.1`; HTTP binds only loopback. Explicit non-loopback HTTPS
exposure still needs appropriate network, certificate and operational security.
`CONSOLE_STATIC_DIR` optionally selects the built UI directory instead of
`dist`. The application does not trust forwarded headers. Sessions have
30-minute idle and 24-hour absolute limits; logout revokes the current browser
session. An observed backward system-clock change revokes all sessions and
outstanding setup authority, including after restart; sign in again or issue
fresh setup authority. The application cannot detect a clock change that occurs
entirely between observations. Keep the host clock reliable.

For the Router-only observer, first obtain a separately scoped Router observer
credential using Router's own administration. Keep that credential in a
protected owner-only file on the trusted host, then run
`node server/router-cli.ts set http://127.0.0.1:PORT < /path/to/observer-key`.
The command reads the key from standard input, not an argument, and never sends
it to the browser. Only exact `127.0.0.1` or `[::1]` origins are accepted in
this initial adapter; HTTPS uses normal certificate verification. Loopback HTTP
trusts local processes and is not confidential from untrusted local observers.
Use `node server/router-cli.ts clear` to remove the connection. The private
`router.json` stores the key in the owner-only state directory; protect backups
and revoke the observer key at Router if compromised. Refresh explicitly from
the signed-in view. Snapshot/replay are read-only producer operations, not
inference or collector refresh. The in-memory projection is disposable; it may
show labeled last-known data on disconnect and is cleared on denial or invalid
configuration. Each displayed group is capped at 200 entries and each resource
at 20 quota facts, with explicit omission counts; responses over 20 MiB or
groups over 10,000 entries are rejected. These are protective bounds, not
measured capacity guarantees. No fixture proves a live installed producer
integration.

For a consistent backup stop the server and copy the complete owner-only state
directory into protected storage. Restoring old state can resurrect revoked
sessions. With the server stopped, run
`node server/bootstrap.ts revoke-sessions` against the restored state before
restarting; this deletes all sessions and rotates the cookie signing key.
Backups contain password hashes and signing material and must be protected like
credentials. A schema version newer than the application fails closed; do not
modify SQLite by hand as an upgrade path.

The check covers formatting, Markdown lint, deterministic local links using an
adopted Markdown parser, current-public-file secret scanning, strict TypeScript,
tests, including the ported workflow contract guards, and an actual Vite build
in an OS temporary directory with cleanup. External URLs are syntax-checked, not
fetched by deterministic gates; verify actual Forgejo issue/review links through
platform evidence. Local heading fragments are not supported by the link
validator; use topic-file links instead.

Follow the [test design and evidence rules](.kilo/rules/validation.md): use
focused development checks, preserve distinct artifact and security evidence,
isolate mutable test state and report skipped evidence explicitly. The current
full local and independent-review gates remain required; CI configuration alone
does not prove a successful run against the current integration subject.

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
absence, administrative branch protection or deployment safety. The bootstrap
observation of no branch-protection rules is historical, not current settings
evidence. Passing CI is validation evidence only, not permission to merge;
required checks and server-enforced protection remain binding.

Per the
[owner decision on #14](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/14#issuecomment-14723),
issue #14 is closed **NOT_REQUIRED / owner-resolved**. Repository protection,
runner administration and Forgejo administrative inspection are owner/operations
concerns outside the agent workflow, not prerequisites for Console development,
agent operation, integration, operational delivery or loop continuation. No
administrative escalation, alternative/private API, private infrastructure
inspection or protection-inspection implementation is required or permitted for
this purpose. Missing administrative evidence cannot make another issue
ineligible. A future administrative-evidence requirement needs a **new explicit
owner task**, not implicit resurrection of #14. This does not certify
infrastructure or weaken browser/product security, producer contracts,
validation, review or live-integration gates.

## Independent Review and Budget

Policy origin: current owner workflow-migration mandate and the actual Model
Intelligence reference at `013cbb43e11d7f698d359db5a456d26d8075e34e`. Earlier
bootstrap-only budgets are historical, not another active command policy.

`/finish-pr` permits **at most 10 whole-PR review invocations per issue
delivery**, including initial, COMMENT, invalidated reviews and corrected
retries. Persist the next ordinal before every dispatch in the excluded
`.task_progress.md` ledger, keyed by issue/PR and loop invocation when
applicable. Recover the same counter across finish/phase/task/model/session
changes. Missing/ambiguous recovery after bounded recovery is BLOCKED; no reset
and no review 11. At the bound exact valid APPROVE can proceed; owner decisions
stop, finite infrastructure paths or review budget yield BLOCKED and remaining
actionable findings STOP_REVISE. Do not patch when no fresh-review slot remains.

Follow the authoritative conversational-independence policy in
[AGENTS.md](AGENTS.md). Freeze exact HEAD/base/merge-base and clean source.
Every complete PR review is a fresh foreground read-only `pr-reviewer` session;
never resume it, self-approve or feed it prior findings, implementation
reasoning or a desired verdict. Parent makes no edits/branch switches while it
runs. The unchanged structured JSON result is the native handoff, not owner
copy/paste or a platform review comment. The reviewer definition owns its
inherited model binding, deny-by-default permissions and exact-subject contract,
with Console URL, offline Node validation and technical self-remediation
guidance. Its permissions and stable JSON result schema remain unchanged. A
changed HEAD/base invalidates approval.

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
technical remediation/failover case before a finite blocker, never permission to
use parent self-review, another controller or a silent model fallback. Offline
contract tests do not execute `/loop`.

Record substantive native verdict separately from stored Forgejo state.
Shared-author COMMENT is not formal APPROVED; publication is optional, never
orchestration state, and cannot bypass branch protection or prove live
readiness.

## Technical Blockers

A blocker is not automatically an owner decision. Apply the shared contract to
implementation, loop, review and remediation: diagnose Class A execution/tool/
environment failures and attempt the smallest safe authorized remedy before
owner escalation. Class B architecture, authority, security, scope, cost or
other owner commitments retain STOP_AND_ASK. Record the exact decision, why it
is owner-controlled, considered autonomous paths and why they cannot resolve it,
plus the smallest materially distinct choices before asking. BLOCKED requires
exhausted authorized paths/budgets or an external condition without a
workaround; report the exact capability, not an artificial owner question.

Default technical remediation is capped at three attempts per distinct obstacle
across reentry with a recorded finite time limit. Each retry changes a diagnosed
condition. Failed/COMMENT whole-PR dispatches still consume the next of 10
review ordinals. Prefer explicit sanitized synthetic environments, approved
locked tool repair, temporary exact-object checkouts, or ephemeral containers as
needed, not Docker automatically. Containers do not authorize persistent
services, broader network/secret access or product dependency adoption. Do not
expose credential directories or real inherited secrets; environment-inheritance
tests inherit synthetic values. Reviewer permissions remain deny-by-default.

Distinguish defects from infrastructure failure and judgment uncertainty. Use
another available authorized fresh independent reviewer/tool path automatically
within budget, with unchanged whole-PR/JSON/exact-SHA requirements.
Independently inspect public pinned source claims via alternative reads or
isolated fetch/clone; an implementer's report cannot replace this proof. No
owner relay, self-approval, silent model fallback, skipped validation or
broadened scope. Text tests guard these instructions, not actual runtime
isolation or automatic failover.

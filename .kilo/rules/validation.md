# Validation and Handoff

- Node 24.19.0/npm 11.17.0, TypeScript/React/Vite and existing Vitest tooling.
  Maintain package-lock.json with intentional dependency changes; do not
  regenerate it to conceal a locked-install failure. Prepare installed
  dependencies with `make install` in the primary's prepared execution
  environment before offline review; reviewer never installs. Apply bounded
  technical self-remediation under `30-implementation-discipline.md` for
  runtime, dependency or isolation failures, never weaken gates.
- Final gate is `make check`. Makefile/package scripts own formatting, Markdown
  lint, local AST links, current-public secretlint, strict TypeScript,
  deterministic Vitest scaffold/tooling/workflow contracts and an actual
  ephemeral static build with project/runtime license validation. Inspect
  unstaged/staged and whole-PR `git diff --check` before handoff. Never weaken
  or bypass a gate; focused commands may diagnose before it. No new Python test
  runtime is required.
- Tests use synthetic fixtures and no live network/private accounts. Verify
  actual built artifact/licensing when packaging changes. Workflow text tests
  establish offline contract consistency, not runtime command discovery, merge
  authorization, permission enforcement, producer integration or hosted runner
  containment.
- Before commit inspect `git status`, intended diff, recent commit style and the
  complete delta against the recorded develop SHA. Stage explicit intended
  files; exclude secrets, credentials, runtime state, caches and scratch. After
  commit verify exact head, base ancestry and final delta/status. Never undo
  others' work.
- Handoff includes issue/PR URLs, exact base/head SHAs, substantive files, exact
  executed validation/results and genuine unresolved decisions/blockers. No
  claim of passing checks, push or PR creation without successful evidence.
- Parent uses a prepared checkout on the exact clean PR HEAD and prepares its
  offline locked development environment before invoking a reviewer. Temporary
  worktree/checkout or ephemeral container preparation is permitted before
  dispatch under the shared technical contract; no tracked edits or branch
  switching during review. Reviewer verifies HEAD and clean status before/after
  checks and inspects frozen Git objects/full base delta. Ignored validation
  artifacts are allowed; tracked-file edits and Git/Forgejo mutations are not.
  Read checks before running them; permission allowlists do not make arbitrary
  repository code safe. Preserve unrelated work. Tests observing inherited state
  use only a clean explicit environment with synthetic values, synthetic
  HOME/cache/temp paths and minimum operational variables, not owner secrets.
  Independently verify public pins/provenance; an unavailable read path requires
  technical recovery, not acceptance of implementer claims or an invented
  defect.
- `/finish-pr` records each reviewed HEAD/base/verdict, normal remediation
  commits, regression/check results and final currentness. Only an exact
  matching native reviewer result plus a final MCP currentness check can yield
  READY_TO_MERGE.

<!-- Adapted from Model Intelligence 013cbb43e11d7f698d359db5a456d26d8075e34e: existing Console Node validation/artifact gates; handoff and isolation unchanged. See NOTICE. -->

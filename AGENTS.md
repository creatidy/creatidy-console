# Agent Guidance

Read [product boundaries](docs/product.md), [contracts](docs/contracts.md),
[security](SECURITY.md), [roadmap](docs/roadmap.md) and
[contribution policy](CONTRIBUTING.md) before changing behavior.

- All documentation, issues and review records are English.
- Forgejo is canonical; GitHub is a one-way public mirror.
- One owner-selected issue, focused branch and PR into `develop`.
- Preserve unrelated work and history. Use this checkout unless an applicable
  task explicitly requests isolation; do not import another repo's worktree
  rule.
- `make help` describes actual tools; `make check` is the local/CI gate.
- Never fabricate producer capabilities or operational data. Synthetic examples
  belong only in explicitly labeled tests/design descriptions, not live paths.
- No producer database access, shell equivalent of a missing API, scheduling,
  inference, authority decisions or private-repository dependency in Console.
- Follow [reuse-first decisions](docs/decisions.md). Inspect licenses before
  copying.
- No credentials in browser storage, URLs, logs, fixtures or public
  configuration.
- Independent review covers the frozen whole PR, exact base and HEAD. Forward
  in-scope findings through native delegation; changed HEAD needs fresh review.
- Bootstrap budget: at most 3 independent review rounds and 2 remediation
  cycles; at most 2 bounded infrastructure diagnostic/retry attempts per
  operation. Stop for genuine authority/security/scope decisions or exhausted
  infrastructure.
- No merge, release, deployment, promotion or published-history rewriting unless
  separately authorized. Session orchestration is not product functionality.

Policy origin: this repository's owner bootstrap mandate and applicable native
session instructions. No sibling's historical model gate or review budget
applies.

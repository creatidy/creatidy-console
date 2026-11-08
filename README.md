# Creatidy Console

Public, local-first operator interface for Creatidy. The intended experience
answers: **What is working? Why did the system make these decisions? Does it
need anything from me?**

Forgejo is canonical for source, issues and review:
<https://forgejo.creatidy.com/Creatidy/creatidy-console>. GitHub is a one-way
public mirror, not a second development workflow.

## Current Status

The authenticated local application foundation delivered in
[#31](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/31) provides
owner setup, login and durable sessions. The in-progress Router-only observer
view accepts a locally configured, separately scoped observer key and uses only
the producer's read contract. There are no live task views, product commands,
notifications or production installation guarantees. Synthetic tests are not
evidence of an installed Router connection, and the UI does not simulate healthy
resources.

Console presents producer-owned facts and delivers authorized commands to their
owners. It is not a scheduler, harness, inference gateway, model catalog, shared
database or replacement for Router administration or Forgejo.

## Development

Use the declared Node/npm versions, then `make install`, `make build`,
`make bootstrap` and `make start`. The setup command writes a short-lived
authority to a private local file and prints its location. Open
`http://127.0.0.1:4173` on the same trusted machine, use that authority to set
the owner password, then sign in. `make check` runs the repository checks.
Loopback HTTP is not confidential against untrusted local observers. See
[contribution guidance](CONTRIBUTING.md) for exact commands and evidence limits.

`develop` is the integration/default branch. Normal work uses one selected
issue, one focused branch and one independently reviewed PR into `develop`.

Repository-local commands: `/implement-issue`, `/review-pr`, `/finish-pr` and
`/loop`. Standalone implementation requires owner issue selection; review is
read-only; finish remediates but never merges. Only an explicit owner `/loop`
invocation authorizes deterministic canonical issue selection and exact-approved
Forgejo PR integration into `develop`, verified acceptance/issue closure, then
selection again. It uses one primary implementation checkout and a persistent
excluded review ledger, with bounded temporary isolation/technical remediation
before owner escalation, not a second controller or Scarcity Router operation.
Main, promotion, release and deployment remain outside this authority. See
[contribution guidance](CONTRIBUTING.md) and [agent entry point](AGENTS.md).

## Authoritative Context

- [Documentation index](docs/README.md): one home per topic.
- [Product and boundaries](docs/product.md): mission, scope and decisions.
- [UX and states](docs/ux.md): journeys and low-fidelity interaction
  descriptions.
- [Contracts and evidence](docs/contracts.md): verified producer behavior and
  gaps.
- [Security and privacy](SECURITY.md): threat model and authority boundaries.
- [Technology and reuse](docs/decisions.md): initial toolchain and alternatives.
- [Roadmap and traceability](docs/roadmap.md): actual issues, G01-G13 and gates.
- [Agent guidance](AGENTS.md): concise development instructions.

[Bootstrap issue #1](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/1)
holds delivery/review evidence. GitHub issues are disabled to avoid a parallel
backlog. Source guidance is host-neutral; canonical issue and PR creation remain
usable.

[Workflow migration #16](https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/16)
records the owner-authorized development command migration, not Console runtime
or producer integration functionality.

Licensed under Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE) and the
[reuse record](docs/decisions.md). No proprietary DemandTrace code/assets are
copied.

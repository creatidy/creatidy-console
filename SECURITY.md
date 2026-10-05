# Security and Privacy

## Reporting and Current Status

No operational product/authentication is implemented by the bootstrap scaffold.
Development servers are loopback-only conveniences, not hardened production
listeners. No public/LAN/mobile exposure, remote task control or production
security certification is implied. Report non-sensitive defects in canonical
Forgejo; do not post secrets/private metadata. A private reporting channel and
incident policy must be established before operational distribution, tracked in
the roadmap.

## Trust and Threat Model

| Threat / asset                                                                | Required control and proof before feature support                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Untrusted task text, logs, Markdown, diffs/model output, external MI evidence | Escape text by default; no raw HTML injection; vetted Markdown sanitizer if required; limit sizes; reject executable/dangerous URL schemes; no trusted instruction/authority from content                                                  |
| XSS and malicious navigation                                                  | CSP for chosen production server, safe link handling and no token-bearing links; test script-like/HTML payloads and links; do not infer safety from React escaping alone                                                                   |
| CSRF, DNS rebinding, cross-origin sessions                                    | Exact origin/host allowlist, authenticated reads/writes, CSRF protection for cookie mutations; reject hostile/missing origins as topology requires; no permissive CORS/forwarded-host trust; test browser attack cases                     |
| Authority, revocation and multiple clients                                    | Owner API enforces principal/scope, subject and reviewed revision; revoked/expired sessions fail closed; stale approvals conflict; command receipt separate from observed effect; no UI-only access control                                |
| Secrets                                                                       | No provider/Forge tokens in URLs, logs, fixtures, localStorage, browser bundles, offline/PWA cache or telemetry. No copying provider-managed secrets for convenience; no `VITE_` credential configuration                                  |
| Local proxy / BFF                                                             | Only if contract evidence justifies it; fixed trusted upstreams, least-privilege credentials, bounded responses/timeouts, redirects/DNS restrictions and tests; never arbitrary endpoint forwarding, SSRF or credential-forwarding service |
| Private metadata/exports                                                      | Minimize collection, explicit scope/consent, redaction and bounded retention; private URLs/tasks/costs can identify users even without source code; no automatic central upload                                                            |
| Console cache/preferences                                                     | Rebuildable cache, separate from authority; version minimal non-secret settings; purge private cache on revocation according to contract; no secret offline storage; define retention before persisting producer data                      |
| Execution and development CI                                                  | Kernel/harness/host own runtime sandbox. Reviewer tests execute untrusted code; pinned YAML does not prove hosted runner isolation, network restriction or secret absence                                                                  |

There is no browser-autonomous shell fallback for an unavailable producer
command, no shared ORM and no mounting/opening Kernel's active SQLite database.
Do not weaken producer locking/durability for observation. Read access is itself
sensitive and requires supported authorization; localhost is not authentication.

## Authentication and Commands

Router administrator sessions, inference-client keys for `/v1/**` and worker
credentials are distinct. None grants another surface's authority. Existing
Router administration is reached by top-level navigation with its own login; no
iframe, cookie/session copying, SSO assumption or cross-origin fetch shortcut.
Browser/auth topology remains open until verified read delegation and
owner-command contracts exist. Reuse established secure mechanisms; no custom
identity platform.

For every future mutation, document owner API, required principal/scope, exact
subject/revision, idempotency key/input, reconciliation/audit receipt and
failure states in the owning feature. Controls reflect real producer/harness
capabilities: cancel request is not cancellation; cancellation is not pause. An
approval binds the revision reviewed, not whichever subject currently has the
same label.

Routine navigation needs no ritual confirmation. Consequential authority changes
show actual scope/consequences. After timeout, effect may have happened: show
unknown and use supported reconciliation; do not blindly retry or invent
exactly-once. Source authorization remains mandatory even if a button is hidden.
Acknowledging a notification never approves work or clears its underlying
condition.

## Local and Remote Operations

Local default: no production listener/configuration is installed by bootstrap.
Future connection onboarding must verify exact instance identity,
capability/schema, TLS/trust and origin restrictions. User-local configuration
only; no hardcoded workspace paths, generated credentials or dependency on
private deployments. Remote exposure requires a separate threat-model decision,
explicit owner authority, tested authentication/transport and revocation, and a
documented supported matrix. It is not obtained by changing a dev server to bind
all interfaces.

Security tests for future connections include revoked/expired sessions,
unsupported security-critical fields, cross-origin/CSRF/rebinding, injection
payloads, changed approval revision, denied commands and timeout after
acceptance. Bootstrap gates only establish current-source secret hygiene and
scaffold behavior; they do not prove these future controls or production runner
security. See [roadmap](docs/roadmap.md) for registered ownership and acceptance
gates.

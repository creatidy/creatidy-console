# Security and Privacy

## Reporting and Current Status

The authenticated application foundation is in development; its controls and
test evidence do not establish production security certification. No
public/LAN/mobile exposure or remote task control is implied. Report
non-sensitive defects in canonical Forgejo; do not post secrets/private
metadata. A private reporting channel and incident policy must be established
before operational distribution, tracked in the roadmap.

## Trust and Threat Model

| Threat / asset                                                                | Required control and proof before feature support                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted task text, logs, Markdown, diffs/model output, external MI evidence | Escape text by default; no raw HTML injection; vetted Markdown sanitizer if required; limit sizes; reject executable/dangerous URL schemes; no trusted instruction/authority from content                              |
| XSS and malicious navigation                                                  | CSP for chosen production server, safe link handling and no token-bearing links; test script-like/HTML payloads and links; do not infer safety from React escaping alone                                               |
| CSRF, DNS rebinding, cross-origin sessions                                    | Exact origin/host allowlist, authenticated reads/writes, CSRF protection for cookie mutations; reject hostile/missing origins as topology requires; no permissive CORS/forwarded-host trust; test browser attack cases |
| Authority, revocation and multiple clients                                    | Owner API enforces principal/scope, subject and reviewed revision; revoked/expired sessions fail closed; stale approvals conflict; command receipt separate from observed effect; no UI-only access control            |
| Secrets                                                                       | No provider/Forge tokens in URLs, logs, fixtures, localStorage, browser bundles, offline/PWA cache or telemetry. No copying provider-managed secrets for convenience; no `VITE_` credential configuration              |
| Scoped producer access                                                        | Fixed trusted upstreams, least-privilege credentials, bounded responses/timeouts, redirects/DNS restrictions and tests; never arbitrary endpoint forwarding, SSRF or credential-forwarding service                     |
| Private metadata/exports                                                      | Minimize collection, explicit scope/consent, redaction and bounded retention; private URLs/tasks/costs can identify users even without source code; no automatic central upload                                        |
| Console cache/preferences                                                     | Rebuildable cache, separate from authority; version minimal non-secret settings; purge private cache on revocation according to contract; no secret offline storage; define retention before persisting producer data  |
| Execution and development CI                                                  | Kernel/harness/host own runtime sandbox. Reviewer tests execute untrusted code; pinned YAML does not prove hosted runner isolation, network restriction or secret absence                                              |

There is no browser-autonomous shell fallback for an unavailable producer
command, no shared ORM and no mounting/opening Kernel's active SQLite database.
Do not weaken producer locking/durability for observation. Read access is itself
sensitive and requires supported authorization; localhost is not authentication.

## Authentication and Commands

Router administrator sessions, inference-client keys for `/v1/**` and worker
credentials are distinct. None grants another surface's authority. Existing
Router administration is reached by top-level navigation with its own login; no
iframe, cookie/session copying, SSO assumption or cross-origin fetch shortcut.
The owner approved a Console-owned application server and session boundary on
2026-11-08. Console login authenticates its local owner, not the owner to
Router, Kernel or MI. Router observer credentials are separately scoped and
revocable; an administrator session or inference credential is not an observer
credential. Reuse established secure mechanisms; no custom identity platform.

The owner selected the existing authenticated Console backend as the intended
browser-facing boundary for Kernel owner commands. A Console session does not
grant Kernel authority: a trusted host must independently provision the correct
Kernel-authorized capability, whose producer-owned lifecycle and consumer
conformance remain pending in Kernel #124. Until that contract is implemented
and verified, Console must fail closed and must not connect a synthetic
capability to normal operation. No Kernel HTTP server, arbitrary dispatcher,
browser-selected principal, active SQLite peer or new authentication system
follows from this decision.

The initial Router observer adapter accepts only explicitly configured literal
loopback IP origins, not DNS names or arbitrary URLs. It does not follow
redirects, and HTTPS uses normal certificate verification. A locally supplied
observer key is stored in a separate owner-only file, never in browser assets,
URLs or logs. The adapter has fixed snapshot/replay paths and bounded requests;
it clears cached observations on denied credentials, invalid configuration or
unsupported responses. A trusted local host and filesystem remain assumptions.

## Application Security Requirements

These requirements define the approved target; individual controls require
implementation and verification. Security precedes UX, maintainability and
flexibility.

- Bootstrap requires explicit local owner authority and a short-lived,
  single-use secret or equivalent local capability. It must fail closed after
  owner creation and reject invalid, expired, replayed and concurrent attempts.
  Never install default credentials or leave registration open.
- Use a maintained Argon2id implementation with appropriate parameters and
  unique salts. Never log, reversibly encrypt or store plaintext passwords.
  Rate-limit failed authentication and bootstrap attempts, avoid account and
  secret disclosure, and protect against resource exhaustion.
- Issue opaque high-entropy session identifiers, rotate on authentication and
  privilege changes, invalidate old identifiers, enforce idle and absolute
  expiry server-side, and support server-side revocation and logout. Persist
  authoritative session state across restart; separate browser sessions. A
  cookie alone is not authority after revocation. An observed backward
  wall-clock change invalidates sessions and setup authority, including after
  restart; unobserved clock excursions cannot be detected by the application.
- Cookies are HttpOnly, host-only and SameSite with explicit lifetime. Require
  Secure on HTTPS; loopback HTTP must be configured explicitly and tested
  separately, never used as a silent fallback for remote HTTPS. No permissive
  CORS. Validate exact Host and Origin without trusting unconfigured forwarded
  headers, reject DNS-rebinding attempts, and require CSRF protection for
  cookie-authenticated mutations including login and bootstrap.
- Serve browser resources from the same origin with a restrictive CSP,
  anti-framing, no-sniff and appropriate no-store policies. Escape untrusted
  producer content; never put secrets in browser code, storage, URLs or logs.
  Fixed producer operations must reject untrusted destinations and redirects and
  bound request and response sizes and timeouts.
- Keep owner credentials, sessions, producer credentials and rebuildable
  producer facts separate in lifecycle and access. Use restrictive local state
  directory and file permissions; define backup, restore and migration behavior
  without disclosing or silently invalidating secrets. Diagnostics must not
  expose passwords, session identifiers or upstream credentials.
- Test unauthenticated access, hostile Origin/Host, CSRF, rebinding, bootstrap
  misuse, fixation, expiry, logout, revocation, restart, independent browser
  sessions and secret absence, including real browser behavior where supported.
  Synthetic tests are not a production security or network-isolation
  certificate.

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
Loopback HTTP assumes the local host and its users/processes are trusted; it is
not confidential against untrusted local observers. Remote access requires
verified HTTPS, explicit configuration and a tested exposure boundary; never
silently fall back to HTTP. Future connection onboarding must verify exact
instance identity, capability/schema, TLS/trust and origin restrictions.
User-local configuration only; no hardcoded workspace paths, generated
credentials or dependency on private deployments. Remote exposure requires a
separate threat-model decision, explicit owner authority, tested
authentication/transport and revocation, and a documented supported matrix. It
is not obtained by changing a dev server to bind all interfaces.

Security tests for connections include revoked/expired sessions, unsupported
security-critical fields, cross-origin/CSRF/rebinding, injection payloads,
changed approval revision, denied commands and timeout after acceptance.
Bootstrap gates only establish current-source secret hygiene and current
behavior; they do not prove production runner security or external network
isolation. See [roadmap](docs/roadmap.md) for registered ownership and
acceptance gates.

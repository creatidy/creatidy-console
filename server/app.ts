import Fastify from "fastify";
import cookie, { Signer } from "@fastify/cookie";
import session from "@fastify/session";
import fastifyStatic from "@fastify/static";
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { openState } from "./state.ts";
import { createRouterObserver } from "./router.ts";
import type { OwnerPairing } from "./kernel-owner-greeting.ts";
import { UnsupportedOwnerPayload } from "./kernel-owner-proposal.ts";
import { InvalidOwnerResponse } from "./kernel-owner-transport.ts";
import {
  ownerIdentityDigest,
  parseOwnerJson,
  prepareLocalOwnerCommand,
  restoreOwnerApproval,
  type ApprovalDisposition,
  type OwnerObservation,
} from "./kernel-owner-v1.ts";

declare module "fastify" {
  interface Session {
    owner?: boolean;
  }
}

export interface AppOptions {
  stateDirectory: string;
  origin: string;
  staticDirectory?: string;
  now?: () => number;
  tls?: { key: Buffer; cert: Buffer };
  kernelOwner?: {
    scope: string;
    pairing?: OwnerPairing;
    historyVersion?: 1 | 2;
    proposalSupported?: boolean;
    approvalScopeSupported?: boolean;
    approvalSupported?: boolean;
    readProposal: () => Promise<{ digest: string; text: string }>;
    readApprovalScope?: () => Promise<{
      digest: string;
      proposalDigest: string;
      text: string;
      owner?: string;
    }>;
    readRevision?: () => Promise<{
      revision: string;
      status: string;
      specDigest?: string;
    }>;
    canSend?: () => boolean;
    sendCommand?: (
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ) => Promise<OwnerObservation>;
    canReplay?: (
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ) => boolean;
    replayCommand?: (
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ) => Promise<OwnerObservation>;
    canReadDisposition?: (
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ) => boolean;
    readDisposition?: (
      command: ReturnType<typeof prepareLocalOwnerCommand>,
    ) => Promise<ApprovalDisposition>;
    close: () => void;
  };
}

export async function createApp(options: AppOptions) {
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname)
      ))
  ) {
    throw new Error("Origin must be exact HTTPS or loopback HTTP");
  }
  if ((origin.protocol === "https:") !== Boolean(options.tls))
    throw new Error("HTTPS requires a configured TLS certificate and key");
  const {
    db,
    store,
    revoke,
    clock: now,
    beginOwnerCommand,
    ownerCommandBlocked,
    beginOwnerReplay,
    dispatchOwnerCommand,
    recordOwnerReceipt,
  } = openState(options.stateDirectory, options.now);
  let signing = db
    .prepare("SELECT value FROM settings WHERE name = 'signing_key'")
    .get()?.value;
  if (!signing) {
    signing = randomBytes(32).toString("base64url");
    db.prepare(
      "INSERT INTO settings (name, value) VALUES ('signing_key', ?)",
    ).run(signing);
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 4096,
    trustProxy: false,
    ...(options.tls ? { https: options.tls } : {}),
  });
  app.setErrorHandler((error, _request, reply) => {
    const code =
      error && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof code === "number" && code >= 400 && code < 500 ? code : 500;
    return reply.code(status).send({
      error: status === 500 ? "Internal server error" : "Invalid request",
    });
  });
  const cookieName =
    origin.protocol === "https:" ? "__Host-console" : "console";
  const routerObserver = createRouterObserver(options.stateDirectory);
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
      );
    const suppliedOrigin = request.headers.origin;
    const fetchSite = request.headers["sec-fetch-site"];
    if (
      request.headers.host !== origin.host ||
      (suppliedOrigin !== undefined && suppliedOrigin !== origin.origin) ||
      (request.method !== "GET" &&
        request.method !== "HEAD" &&
        suppliedOrigin !== origin.origin) ||
      fetchSite === "cross-site" ||
      fetchSite === "same-site"
    ) {
      return reply.code(403).send({ error: "Request origin denied" });
    }
  });
  // Bypass the session plugin's rolling/expired-cookie handling for this
  // read-only check. Use its pinned decoder and the same signed generation.
  const Session = createRequire(import.meta.url)(
    "@fastify/session/lib/session",
  ) as {
    decodeSessionId: (value: string) => {
      sessionStoreId: string;
      sessionId: string;
    };
  };
  const sessionSigner = new Signer(String(signing));
  app.addHook("onRequest", async (request, reply) => {
    if (
      request.method !== "GET" ||
      request.routeOptions.url !== "/api/kernel/session-check"
    )
      return;
    const cookieValue = request.cookies[cookieName];
    const signed = cookieValue ? sessionSigner.unsign(cookieValue) : undefined;
    if (!signed?.valid || !signed.value)
      return reply.code(401).send({ error: "Login required" });
    const { sessionStoreId, sessionId } = Session.decodeSessionId(signed.value);
    const saved = await new Promise<import("fastify").Session | null>(
      (resolve, reject) => {
        store.get(sessionStoreId, (error, value) =>
          error ? reject(error) : resolve(value ?? null),
        );
      },
    );
    const metadata = saved as
      | (import("fastify").Session & {
          __fastifySessionMetadata?: { generation?: string };
        })
      | null;
    // The pinned session Cookie constructor rebuilds originalExpires from expires.
    const storedCookie = saved?.cookie as { expires?: unknown } | undefined;
    const expires = storedCookie?.expires;
    const expiryTime = typeof expires === "string" ? Date.parse(expires) : NaN;
    if (
      !saved?.owner ||
      metadata?.__fastifySessionMetadata?.generation !== sessionId ||
      !Number.isFinite(expiryTime) ||
      expiryTime <= Date.now()
    )
      return reply.code(401).send({ error: "Login required" });
    return reply.send({ authenticated: true });
  });
  await app.register(session, {
    secret: String(signing),
    store,
    cookieName,
    saveUninitialized: false,
    rolling: false,
    cookie: {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: origin.protocol === "https:",
      maxAge: 30 * 60_000,
    },
  });
  app.get("/api/kernel/session-check", async () => ({ authenticated: false }));
  app.addHook("onClose", async () => {
    options.kernelOwner?.close();
    db.close();
  });
  const owner = () =>
    db.prepare("SELECT password_hash FROM owner WHERE id = 1").get();
  let hashing = false;
  const allowed = () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE name = 'login_attempts'")
      .get();
    const state = row
      ? (JSON.parse(String(row.value)) as { count: number; until: number })
      : { count: 0, until: 0 };
    return state.until > now() ? state : { count: 0, until: 0 };
  };
  const failed = (state: { count: number; until: number }) => {
    const count = state.count + 1;
    db.prepare(
      "INSERT OR REPLACE INTO settings (name, value) VALUES ('login_attempts', ?)",
    ).run(
      JSON.stringify({
        count,
        until: now() + (count >= 5 ? 60_000 : 10 * 60_000),
      }),
    );
  };
  const digest = (text: string) => createHash("sha256").update(text).digest();
  const parameters = {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  };

  async function authenticated(request: import("fastify").FastifyRequest) {
    if (!request.session.owner) return false;
    try {
      request.session.touch();
      await request.session.save();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  app.get("/api/session", async (request) => ({
    configured: Boolean(owner()),
    authenticated: await authenticated(request),
  }));
  app.post<{ Body: { token?: unknown; password?: unknown } }>(
    "/api/bootstrap",
    async (request, reply) => {
      const state = allowed();
      if (state.count >= 5 || hashing)
        return reply.code(429).send({ error: "Try again later" });
      const body = request.body;
      const row = db
        .prepare("SELECT value FROM settings WHERE name = 'bootstrap'")
        .get();
      const token = typeof body?.token === "string" ? body.token : "";
      const password = typeof body?.password === "string" ? body.password : "";
      let valid = false;
      if (row && !owner()) {
        const grant = JSON.parse(String(row.value)) as {
          digest: string;
          expires: number;
        };
        const expected = Buffer.from(grant.digest, "hex");
        const actual = digest(token);
        valid =
          expected.length === actual.length &&
          timingSafeEqual(expected, actual) &&
          grant.expires > now();
      }
      if (!valid || password.length < 12 || password.length > 1024) {
        failed(state);
        return reply.code(400).send({ error: "Setup request denied" });
      }
      hashing = true;
      try {
        const passwordHash = await hash(password, parameters);
        const checkedAt = now();
        db.exec("BEGIN IMMEDIATE");
        try {
          const current = db
            .prepare("SELECT value FROM settings WHERE name = 'bootstrap'")
            .get();
          if (
            owner() ||
            !current ||
            current.value !== row?.value ||
            (JSON.parse(String(current.value)) as { expires: number })
              .expires <= checkedAt
          ) {
            throw new Error("Bootstrap no longer valid");
          }
          db.prepare("INSERT INTO owner (id, password_hash) VALUES (1, ?)").run(
            passwordHash,
          );
          db.prepare(
            "DELETE FROM settings WHERE name IN ('bootstrap', 'login_attempts')",
          ).run();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        try {
          unlinkSync(join(options.stateDirectory, "bootstrap-token"));
        } catch {
          /* already removed */
        }
        return { ok: true };
      } finally {
        hashing = false;
      }
    },
  );
  app.post<{ Body: { password?: unknown } }>(
    "/api/login",
    async (request, reply) => {
      const state = allowed();
      if (state.count >= 5 || hashing)
        return reply.code(429).send({ error: "Try again later" });
      const password =
        typeof request.body?.password === "string" ? request.body.password : "";
      const account = owner();
      if (!account || password.length > 1024) {
        failed(state);
        return reply.code(401).send({ error: "Login failed" });
      }
      hashing = true;
      try {
        if (!(await verify(String(account.password_hash), password))) {
          failed(state);
          return reply.code(401).send({ error: "Login failed" });
        }
        db.prepare("DELETE FROM settings WHERE name = 'login_attempts'").run();
        await request.session.regenerate();
        request.session.owner = true;
        await request.session.save();
        return { ok: true };
      } finally {
        hashing = false;
      }
    },
  );
  app.post("/api/logout", async (request, reply) => {
    if (!request.session.owner)
      return reply.code(401).send({ error: "Login required" });
    const revoked = revoke(
      request.session.sessionStoreId,
      request.session.sessionId,
    );
    reply.clearCookie(cookieName, {
      path: "/",
      secure: origin.protocol === "https:",
      httpOnly: true,
      sameSite: "strict",
    });
    return revoked
      ? { ok: true }
      : reply.code(401).send({ error: "Session expired" });
  });
  app.get("/api/application", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return { message: "Console session authenticated." };
  });
  app.get("/api/router", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return routerObserver.view();
  });
  app.post("/api/router/refresh", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const result = await routerObserver.refresh();
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return result;
  });
  let proposalRead: Promise<{ digest: string; text: string }> | undefined;
  app.get("/api/kernel/owner", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const ownerChannel = options.kernelOwner;
    if (!ownerChannel || ownerChannel.proposalSupported === false)
      return { status: "unavailable", actions: [] };
    let proposal: { digest: string; text: string } | undefined;
    let failure = "disconnected";
    try {
      proposalRead ??= ownerChannel.readProposal();
      const pending = proposalRead;
      try {
        proposal = await pending;
      } finally {
        if (proposalRead === pending) proposalRead = undefined;
      }
    } catch (error) {
      if (error instanceof UnsupportedOwnerPayload) failure = "unsupported";
      else if (error instanceof InvalidOwnerResponse) failure = "invalid";
      // Do not expose producer errors or retain partial observations.
    }
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    if (!proposal) return { status: failure, actions: [] };
    let approve = false;
    if (
      ownerChannel.approvalSupported &&
      ownerChannel.sendCommand &&
      ownerChannel.canSend &&
      ownerChannel.readRevision &&
      ownerChannel.readApprovalScope
    ) {
      try {
        approve =
          (await readApprovalScope(ownerChannel.readApprovalScope))
            .proposalDigest === proposal.digest;
      } catch {
        // An otherwise supported proposal need not have a usable approval scope.
      }
      if (!(await authenticated(request)))
        return reply.code(401).send({ error: "Login required" });
    }
    return {
      status: "connected",
      actions: approve ? ["approve"] : [],
      scope: ownerChannel.scope,
      digest: proposal.digest,
      text: proposal.text,
    };
  });
  let approvalScopeRead:
    | ReturnType<
        NonNullable<NonNullable<AppOptions["kernelOwner"]>["readApprovalScope"]>
      >
    | undefined;
  async function readApprovalScope(
    read: NonNullable<
      NonNullable<AppOptions["kernelOwner"]>["readApprovalScope"]
    >,
  ) {
    const pending = (approvalScopeRead ??= read());
    try {
      return await pending;
    } finally {
      if (approvalScopeRead === pending) approvalScopeRead = undefined;
    }
  }
  app.get("/api/kernel/approval-scope", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const channel = options.kernelOwner;
    if (
      !(channel?.approvalScopeSupported ?? channel?.approvalSupported) ||
      !channel?.readApprovalScope
    )
      return { status: "unavailable" };
    let observation:
      { digest: string; proposalDigest: string; text: string } | undefined;
    let failure = "disconnected";
    try {
      observation = await readApprovalScope(channel.readApprovalScope);
    } catch (error) {
      if (error instanceof UnsupportedOwnerPayload) failure = "unsupported";
      else if (error instanceof InvalidOwnerResponse) failure = "invalid";
      // Do not expose producer errors or retain partial observations.
    }
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return observation
      ? {
          status: "connected",
          scope: channel.scope,
          digest: observation.digest,
          proposalDigest: observation.proposalDigest,
          text: observation.text,
        }
      : { status: failure };
  });
  const replayable = new Map<
    string,
    ReturnType<typeof prepareLocalOwnerCommand>
  >();
  const pendingReceipts = new Map<
    string,
    {
      command: ReturnType<typeof prepareLocalOwnerCommand>;
      receipt: ApprovalDisposition;
    }
  >();
  function persistReceipt(
    command: ReturnType<typeof prepareLocalOwnerCommand>,
    receipt: ApprovalDisposition,
  ) {
    if (
      receipt.kind !== "historical-receipt-shape" &&
      receipt.kind !== "terminal-refusal"
    )
      return;
    pendingReceipts.set(command.commandId, { command, receipt });
    try {
      recordOwnerReceipt(command, receipt);
    } catch {
      recordOwnerReceipt(command, receipt);
    }
    pendingReceipts.delete(command.commandId);
    replayable.delete(command.commandId);
    if (receipt.kind === "terminal-refusal") reviews.clear();
  }
  type DispositionRow = {
    command_id: string;
    scope: string;
    input: Uint8Array;
    producer: string | null;
    recipient: string | null;
    actor_digest: string | null;
    history_version: number | null;
  };
  function dispositionCommand(
    row: DispositionRow,
    channel: AppOptions["kernelOwner"],
  ) {
    if (
      !channel?.pairing ||
      !channel.readDisposition ||
      !channel.canReadDisposition ||
      channel.scope !== row.scope ||
      channel.pairing.producer !== row.producer ||
      channel.pairing.recipient !== row.recipient ||
      row.actor_digest === null ||
      (row.history_version !== 1 && row.history_version !== 2)
    )
      return;
    const command = restoreOwnerApproval(row.scope, row.command_id, row.input, {
      ...channel.pairing,
      actorDigest: row.actor_digest,
      historyVersion: row.history_version,
    });
    if (channel.canReadDisposition(command)) return command;
  }
  function observeDispatch(
    command: ReturnType<typeof prepareLocalOwnerCommand>,
    promise: Promise<OwnerObservation>,
    channel: NonNullable<AppOptions["kernelOwner"]>,
  ) {
    const observed = promise.then((result) => {
      if (
        result.kind === "unknown" &&
        !command.binding?.historyVersion &&
        channel.approvalSupported &&
        channel.canReplay?.(command) &&
        channel.replayCommand
      )
        replayable.set(command.commandId, command);
      persistReceipt(command, result);
      return result;
    });
    // The transaction can fail after callback entry, leaving no caller awaiting it.
    void observed.catch(() => {});
    return observed;
  }
  app.get("/api/kernel/owner-journal", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const channel = options.kernelOwner;
    try {
      for (const { command, receipt } of pendingReceipts.values()) {
        try {
          persistReceipt(command, receipt);
        } catch {
          // Keep the receipt for another local retry and expose other records.
        }
      }
      const rows = db
        .prepare(
          "SELECT * FROM owner_commands ORDER BY created DESC, command_id LIMIT 128",
        )
        .all();
      const commands = rows.map((row) => {
        const input = Buffer.from(row.input as Uint8Array);
        if (input.length < 5 || input.readUInt32BE(0) !== input.length - 4)
          throw new Error("Invalid journal frame");
        const parsed = parseOwnerJson(
          new TextDecoder("utf-8", { fatal: true }).decode(input.subarray(4)),
        );
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !("action" in parsed) ||
          !("command_id" in parsed) ||
          parsed.command_id !== row.command_id ||
          !["approve", "start-managed", "stop", "reconcile"].includes(
            String(parsed.action),
          )
        )
          throw new Error("Invalid journal record");
        const integerText = (value: unknown, pattern: RegExp) => {
          if (
            !(
              typeof value === "bigint" ||
              (typeof value === "number" && Number.isSafeInteger(value))
            ) ||
            !pattern.test(String(value))
          )
            throw new Error("Invalid journal integer");
          return String(value);
        };
        let approval = null;
        if (parsed.action === "approve") {
          const fields = parsed as Record<string, unknown>;
          if (
            typeof fields.decision_id !== "string" ||
            !fields.decision_id.trim() ||
            Array.from(fields.decision_id).length > 256 ||
            typeof fields.proposal_digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(fields.proposal_digest) ||
            typeof fields.scope_digest !== "string" ||
            !/^[0-9a-f]{64}$/.test(fields.scope_digest)
          )
            throw new Error("Invalid journal approval");
          approval = {
            revision: integerText(
              fields.expected_revision,
              /^(?:-1|0|[1-9][0-9]*)$/,
            ),
            proposalDigest: fields.proposal_digest,
            scopeDigest: fields.scope_digest,
            decisionId: fields.decision_id,
            requestedExpiry: integerText(fields.expires_at, /^[1-9][0-9]*$/),
          };
        }
        const storedReceipt =
          row.receipt === null ? null : JSON.parse(String(row.receipt));
        if (
          (row.outcome !== "unknown" &&
            row.outcome !== "historical" &&
            row.outcome !== "refused") ||
          (row.outcome !== "historical" && storedReceipt !== null) ||
          (row.outcome === "refused" &&
            (parsed.action !== "approve" || row.history_version !== 2)) ||
          (row.outcome === "historical" &&
            (!storedReceipt ||
              storedReceipt.kind !== "historical-receipt-shape"))
        )
          throw new Error("Invalid journal outcome");
        if (storedReceipt) {
          if (
            storedReceipt.action !== parsed.action ||
            typeof storedReceipt.status !== "string" ||
            !["approved", "accepted", "recorded"].includes(
              storedReceipt.status,
            ) ||
            ![null, "unknown", "bound-managed-target-settled"].includes(
              storedReceipt.settlement,
            ) ||
            (parsed.action === "approve" &&
              (typeof storedReceipt.decision_id !== "string" ||
                typeof storedReceipt.spec_digest !== "string" ||
                !/^[0-9a-f]{64}$/.test(storedReceipt.spec_digest) ||
                !(
                  typeof storedReceipt.expires_at === "string" ||
                  (typeof storedReceipt.expires_at === "number" &&
                    Number.isSafeInteger(storedReceipt.expires_at))
                ) ||
                !/^[1-9][0-9]*$/.test(String(storedReceipt.expires_at))))
          )
            throw new Error("Invalid journal receipt");
        }
        const receipt = storedReceipt && {
          kind: storedReceipt.kind,
          action: storedReceipt.action,
          status: storedReceipt.status,
          settlement: storedReceipt.settlement,
          ...(storedReceipt.action === "approve"
            ? {
                decisionId: storedReceipt.decision_id,
                specDigest: storedReceipt.spec_digest,
                effectiveExpiry: String(storedReceipt.expires_at),
              }
            : {}),
        };
        const command = replayable.get(String(row.command_id));
        return {
          commandId: row.command_id,
          scope: row.scope,
          ...(row.producer !== null
            ? { producer: row.producer, recipient: row.recipient }
            : {}),
          action: parsed.action,
          approval,
          outcome: row.outcome,
          receipt,
          ...(pendingReceipts.has(String(row.command_id))
            ? { receiptPending: true }
            : {}),
          created: row.created,
          canRecover:
            row.outcome === "unknown" &&
            !pendingReceipts.has(String(row.command_id)) &&
            !!dispositionCommand(row as unknown as DispositionRow, channel),
          canReplay:
            row.outcome === "unknown" &&
            !pendingReceipts.has(String(row.command_id)) &&
            !!command &&
            command.scope === row.scope &&
            channel?.scope === row.scope &&
            channel.approvalSupported === true &&
            !!channel.canReplay?.(command) &&
            !!channel.replayCommand,
        };
      });
      if (!(await authenticated(request)))
        return reply.code(401).send({ error: "Login required" });
      return { status: "available", commands };
    } catch {
      return reply.code(503).send({ error: "Command history unavailable" });
    }
  });
  type Review = {
    binding: string;
    expires: number;
    scopeDigest: string;
    proposalDigest: string;
    revision: string;
    approvalExpiry: string;
  };
  const reviews = new Map<string, Review>();
  const binding = (request: import("fastify").FastifyRequest) =>
    createHash("sha256")
      .update(request.session.sessionStoreId)
      .update("\0")
      .update(request.session.sessionId)
      .digest("hex");
  app.post("/api/kernel/owner-review", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const channel = options.kernelOwner;
    if (
      !channel?.approvalSupported ||
      !channel.readApprovalScope ||
      !channel.readRevision ||
      !channel.canSend ||
      !channel.sendCommand
    )
      return reply
        .code(503)
        .send({ error: "Kernel owner capability unavailable" });
    if (ownerCommandBlocked(channel.scope, channel.pairing?.producer))
      return reply
        .code(409)
        .send({ error: "Unresolved command; inspect history" });
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return reply.code(400).send({ error: "Invalid request" });
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).length !== 1 ||
      typeof input.expires_at !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(input.expires_at) ||
      BigInt(input.expires_at) > 9223372036854775807n
    )
      return reply.code(400).send({ error: "Invalid request" });
    if (BigInt(input.expires_at) <= BigInt(Math.floor(now() / 1000)))
      return reply.code(409).send({ error: "Approval deadline expired" });
    const originalBinding = binding(request);
    try {
      const proposal = await channel.readProposal();
      const scope = await channel.readApprovalScope();
      const revision = await channel.readRevision();
      if (
        !(await authenticated(request)) ||
        binding(request) !== originalBinding
      )
        return reply.code(401).send({ error: "Login required" });
      if (scope.proposalDigest !== proposal.digest)
        return reply.code(409).send({ error: "Review changed" });
      const time = now();
      if (BigInt(input.expires_at) <= BigInt(Math.floor(time / 1000)))
        return reply.code(409).send({ error: "Approval deadline expired" });
      for (const [key, value] of reviews)
        if (value.expires <= time) reviews.delete(key);
      if (reviews.size >= 32)
        return reply.code(503).send({ error: "Review unavailable" });
      const review = randomBytes(32).toString("hex");
      reviews.set(review, {
        binding: originalBinding,
        expires: time + 60_000,
        scopeDigest: scope.digest,
        proposalDigest: proposal.digest,
        revision: revision.revision,
        approvalExpiry: input.expires_at,
      });
      return {
        review,
        scope: channel.scope,
        scopeDigest: scope.digest,
        proposalDigest: proposal.digest,
        revision: revision.revision,
        status: revision.status,
        approvalExpiry: input.expires_at,
        text: scope.text,
      };
    } catch {
      return reply.code(503).send({ error: "Review unavailable" });
    }
  });
  app.post("/api/kernel/owner", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const channel = options.kernelOwner;
    if (
      !channel?.approvalSupported ||
      !channel.readApprovalScope ||
      !channel.readRevision ||
      !channel.canSend ||
      !channel.sendCommand
    )
      return reply.code(503).send({
        kind: "not-sent",
        error: "Kernel owner capability unavailable",
      });
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return reply.code(400).send({ error: "Invalid request" });
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).length !== 2 ||
      input.action !== "approve" ||
      typeof input.review !== "string" ||
      !/^[0-9a-f]{64}$/.test(input.review)
    )
      return reply.code(400).send({ error: "Invalid request" });
    const review = reviews.get(input.review);
    if (
      !review ||
      review.binding !== binding(request) ||
      review.expires <= now()
    )
      return reply.code(409).send({ error: "Review unavailable" });
    reviews.delete(input.review);
    let initiated = false;
    try {
      const scope = await channel.readApprovalScope();
      const revision = await channel.readRevision();
      if (
        !(await authenticated(request)) ||
        binding(request) !== review.binding
      )
        return reply.code(401).send({ error: "Login required" });
      if (
        review.expires <= now() ||
        BigInt(review.approvalExpiry) <= BigInt(Math.floor(now() / 1000)) ||
        scope.digest !== review.scopeDigest ||
        scope.proposalDigest !== review.proposalDigest ||
        revision.revision !== review.revision
      )
        return reply.code(409).send({ error: "Review changed" });
      // No asynchronous work may intervene between this check and dispatch.
      if (!channel.canSend?.())
        return reply
          .code(503)
          .send({ error: "Owner channel busy; no command sent" });
      if (channel.historyVersion && (!channel.pairing || !scope.owner))
        throw new Error("Original owner binding unavailable");
      const command = prepareLocalOwnerCommand(
        channel.scope,
        {
          action: "approve",
          expected_revision: BigInt(review.revision),
          decision_id: randomBytes(32).toString("hex"),
          expires_at: BigInt(review.approvalExpiry),
          proposal_digest: review.proposalDigest,
          scope_digest: review.scopeDigest,
        },
        undefined,
        channel.pairing && {
          ...channel.pairing,
          ...(channel.historyVersion
            ? {
                historyVersion: channel.historyVersion,
                actorDigest: ownerIdentityDigest(scope.owner!),
              }
            : {}),
        },
      );
      const token = beginOwnerCommand(
        request.session.sessionStoreId,
        request.session.sessionId,
        command,
        review.expires,
      );
      const pending = dispatchOwnerCommand(token, (prepared) => {
        initiated = true;
        return observeDispatch(
          command,
          channel.sendCommand!(prepared),
          channel,
        );
      });
      const result = await pending;
      if (!(await authenticated(request)))
        return reply.code(401).send({ error: "Login required" });
      return JSON.parse(
        JSON.stringify(result, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      );
    } catch {
      return reply
        .code(503)
        .send(
          initiated
            ? { kind: "unknown", error: "Approval outcome unknown" }
            : { kind: "not-sent", error: "Approval was not sent" },
        );
    }
  });
  app.post("/api/kernel/owner-replay", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    const channel = options.kernelOwner;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      return reply.code(400).send({ error: "Invalid request" });
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).length !== 1 ||
      typeof input.commandId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        input.commandId,
      )
    )
      return reply.code(400).send({ error: "Invalid request" });
    if (pendingReceipts.has(input.commandId))
      return reply
        .code(503)
        .send({ error: "Verified outcome awaiting local persistence" });
    try {
      const row = db
        .prepare(
          "SELECT * FROM owner_commands WHERE command_id = ? AND outcome = 'unknown'",
        )
        .get(input.commandId) as unknown as DispositionRow | undefined;
      const original = row && dispositionCommand(row, channel);
      if (original && channel?.readDisposition) {
        if (!channel.canSend?.())
          return reply
            .code(503)
            .send({ error: "Owner channel busy; disposition check not sent" });
        const token = beginOwnerReplay(
          request.session.sessionStoreId,
          request.session.sessionId,
          original,
        );
        const pending = dispatchOwnerCommand(token, (command) => {
          const observed = channel.readDisposition!(command).then((result) => {
            persistReceipt(command, result);
            return result;
          });
          void observed.catch(() => {});
          return observed;
        });
        const result = await pending;
        if (!(await authenticated(request)))
          return reply.code(401).send({ error: "Login required" });
        return JSON.parse(
          JSON.stringify(result, (_key, value: unknown) =>
            typeof value === "bigint" ? value.toString() : value,
          ),
        );
      }
    } catch {
      return reply
        .code(503)
        .send({ error: "Original outcome remains unknown" });
    }
    const command = replayable.get(input.commandId);
    if (
      !command ||
      !channel?.approvalSupported ||
      !channel.canReplay?.(command) ||
      !channel.replayCommand
    ) {
      replayable.delete(input.commandId);
      return reply
        .code(409)
        .send({ error: "Original owner channel unavailable" });
    }
    if (!channel.canSend?.())
      return reply
        .code(503)
        .send({ error: "Owner channel busy; receipt check not sent" });
    try {
      const token = beginOwnerReplay(
        request.session.sessionStoreId,
        request.session.sessionId,
        command,
      );
      const pending = dispatchOwnerCommand(token, (prepared) => {
        // Once initiation begins, a thrown error may still mean a send occurred.
        replayable.delete(command.commandId);
        return observeDispatch(
          command,
          channel.replayCommand!(prepared),
          channel,
        );
      });
      const result = await pending;
      if (!(await authenticated(request)))
        return reply.code(401).send({ error: "Login required" });
      return JSON.parse(
        JSON.stringify(result, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      );
    } catch {
      return reply
        .code(503)
        .send({ error: "Original outcome remains unknown" });
    }
  });
  await app.register(fastifyStatic, {
    root: resolve(options.staticDirectory ?? "dist"),
    index: "index.html",
  });
  return app;
}

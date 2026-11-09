import Fastify from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import fastifyStatic from "@fastify/static";
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { openState } from "./state.ts";
import { createRouterObserver } from "./router.ts";

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
  app.addHook("onClose", async () => {
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
  app.get("/api/kernel/owner", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return { status: "unavailable", actions: [] };
  });
  app.post("/api/kernel/owner", async (request, reply) => {
    if (!(await authenticated(request)))
      return reply.code(401).send({ error: "Login required" });
    return reply
      .code(503)
      .send({ error: "Kernel owner capability unavailable" });
  });
  await app.register(fastifyStatic, {
    root: resolve(options.staticDirectory ?? "dist"),
    index: "index.html",
  });
  return app;
}

import { hash } from "@node-rs/argon2";
import { execFile, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { validateRouterOrigin } from "../server/router-config.ts";
import { createRouterObserver } from "../server/router.ts";
import { openState } from "../server/state.ts";

const credential = "synthetic-observer-key-123456";
const password = "synthetic-owner-password";
const origin = "http://127.0.0.1:4173";
const headers = {
  host: "127.0.0.1:4173",
  origin,
  "content-type": "application/json",
};
const run = promisify(execFile);
const directories: string[] = [];
const servers: Server[] = [];
const cursor = (sequence: number) => ({
  epoch: "synthetic-epoch",
  sequence,
  provenance: "synthetic-provenance",
  schema_version: 1,
});
const snapshot = (model = "model-a") => ({
  schema_version: 1,
  mode: "execution_gateway",
  resources: [
    {
      identity: {
        resource_id: "resource-a",
        channel: "api",
        provider: "provider-a",
        model,
        variant: null,
        entitlement: "allowed",
      },
      origin: "source",
      enabled: true,
      worker_connected: null,
      observed_at: "2026-11-08T12:00:00.000Z",
      freshness: "stale",
      health: "unknown",
      availability: "unknown",
      quota_facts: [
        {
          observation_class: "provider_telemetry",
          window: {
            resource: "tokens",
            kind: "rolling",
            duration_seconds: null,
            used_percent: null,
            remaining_percent: 50,
            resets_at: null,
          },
        },
      ],
    },
  ],
  sources: [
    {
      source_id: "source-a",
      worker_connected: false,
      inventory_observed_at: null,
      inventory_freshness: "unknown",
    },
  ],
  discoveries: [
    {
      source_id: "source-a",
      model: "model-a",
      state: "discovered",
      reason: "effort_not_reported",
      observed_at: null,
      lifecycle: null,
    },
  ],
});

async function upstream() {
  let mode = "normal";
  let currentModel = "model-a";
  let currentSequence = 1;
  let held: (() => void) | undefined;
  let signalHeld!: () => void;
  const waiting = new Promise<void>((resolve) => {
    signalHeld = resolve;
  });
  const calls: {
    method: string | undefined;
    url: string | undefined;
    auth: string | undefined;
    body: string;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      calls.push({
        method: request.method,
        url: request.url,
        auth: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      response.setHeader("content-type", "application/json");
      if (mode === "denied") {
        response.writeHead(401).end("{}");
        return;
      }
      if (mode === "provenance-denied" && request.method === "GET") {
        response.writeHead(401).end("{}");
        return;
      }
      if (mode === "gap-fail" && request.method === "GET") {
        response.writeHead(503).end("{}");
        return;
      }
      if (mode === "redirect") {
        response.writeHead(302, { location: "http://example.invalid/" }).end();
        return;
      }
      if (mode === "invalid" && request.method === "POST") {
        response.writeHead(400).end("{}");
        return;
      }
      if (
        (mode === "held" || mode === "held-denied") &&
        request.method === "POST"
      ) {
        const deny = mode === "held-denied";
        held = () => {
          if (deny) response.writeHead(401).end();
          else
            response.end(
              JSON.stringify({
                schema_version: 1,
                cursor: cursor(2),
                events: [],
                resync: null,
                resync_reason: null,
                provenance_current: true,
              }),
            );
        };
        signalHeld();
        return;
      }
      if (request.method === "GET") {
        const data = snapshot(
          mode === "echo"
            ? credential
            : mode === "provenance"
              ? "model-a"
              : currentModel,
        );
        if (mode === "large")
          data.resources = Array.from(
            { length: 201 },
            () => data.resources[0]!,
          );
        response.end(
          JSON.stringify({
            schema_version: mode === "version" ? 2 : 1,
            cursor: cursor(currentSequence),
            snapshot: data,
          }),
        );
        return;
      }
      if (mode === "gap" || mode === "gap-fail") {
        currentModel = "model-gap";
        currentSequence = 3;
        response.end(
          JSON.stringify({
            schema_version: 1,
            cursor: cursor(3),
            events: [],
            resync: { cursor: cursor(3), snapshot: snapshot("model-gap") },
            resync_reason: "history_gap",
            provenance_current: mode !== "gap-fail",
          }),
        );
        return;
      }
      if (mode === "reordered") {
        currentModel = "authoritative";
        currentSequence = 4;
        response.end(
          JSON.stringify({
            schema_version: 1,
            cursor: cursor(4),
            events: [
              { cursor: cursor(3), snapshot: snapshot("later") },
              { cursor: cursor(2), snapshot: snapshot("earlier") },
              { cursor: cursor(2), snapshot: snapshot("duplicate") },
            ],
            resync: null,
            resync_reason: null,
            provenance_current: true,
          }),
        );
        return;
      }
      currentModel = "model-b";
      currentSequence = 2;
      response.end(
        JSON.stringify({
          schema_version: 1,
          cursor: cursor(2),
          events: [{ cursor: cursor(2), snapshot: snapshot("model-b") }],
          resync: null,
          resync_reason: null,
          provenance_current:
            mode !== "provenance" && mode !== "provenance-denied",
        }),
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    calls,
    waiting,
    release: () => {
      if (held) {
        const send = held;
        held = undefined;
        send();
      }
    },
    setMode: (value: string) => {
      mode = value;
    },
  };
}

function directory() {
  const dir = mkdtempSync(join(tmpdir(), "console-router-"));
  directories.push(dir);
  return dir;
}

function writeConfig(dir: string, routerOrigin: string) {
  writeFileSync(
    join(dir, "router.json"),
    JSON.stringify({ origin: routerOrigin, credential }),
    { mode: 0o600 },
  );
}

afterEach(async () => {
  for (const server of servers.splice(0))
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("Router observer", () => {
  it("rejects destinations that could escape the local trust boundary", () => {
    const withCredentials = new URL("http://127.0.0.1:9000");
    withCredentials.username = "synthetic-user";
    withCredentials.password = "synthetic-password";
    for (const value of [
      "http://localhost:9000",
      "http://127.1:9000",
      "http://192.168.1.4:9000",
      "https://example.com",
      "http://127.0.0.1:9000/path",
      withCredentials.href.replace(/\/$/, ""),
      "http://127.0.0.1:9000?x=1",
    ]) {
      expect(() => validateRouterOrigin(value)).toThrow();
    }
    expect(validateRouterOrigin("http://127.0.0.1:9000")).toBe(
      "http://127.0.0.1:9000",
    );
    expect(validateRouterOrigin("https://[::1]:9000")).toBe(
      "https://[::1]:9000",
    );
    const dir = directory();
    const unsafe = spawnSync(process.execPath, ["server/main.ts"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        CONSOLE_STATE_DIR: dir,
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
      },
      encoding: "utf8",
    });
    expect(unsafe.status).not.toBe(0);
    expect(unsafe.stderr).toContain("TLS verification must not be disabled");
  });

  it("keeps opaque replay, explicit gaps, revocation and last-known disconnection honest", async () => {
    const fixture = await upstream();
    const dir = directory();
    writeConfig(dir, fixture.origin);
    const observer = createRouterObserver(dir);
    expect(observer.view().status).toBe("configured");
    const initial = await observer.refresh();
    expect(initial.facts?.resources[0]?.identity.model).toBe("model-a");
    expect(initial.facts?.resources[0]?.quotas[0]?.remaining_percent).toBe(50);
    const replayed = await observer.refresh();
    expect(replayed.facts?.resources[0]?.identity.model).toBe("model-b");
    expect(JSON.parse(fixture.calls[1]!.body)).toEqual({ cursor: cursor(1) });
    fixture.setMode("gap-fail");
    const incomplete = await observer.refresh();
    expect(incomplete.status).toBe("disconnected");
    expect(incomplete.gap).toContain("Resynchronization is required");
    expect(incomplete.facts?.resources[0]?.identity.model).toBe("model-b");
    fixture.setMode("gap");
    const gap = await observer.refresh();
    expect(gap.gap).toContain("history_gap");
    expect(gap.facts?.resources[0]?.identity.model).toBe("model-gap");
    fixture.setMode("invalid");
    expect((await observer.refresh()).gap).toContain("Replay was rejected");
    fixture.setMode("provenance");
    expect((await observer.refresh()).facts?.resources[0]?.identity.model).toBe(
      "model-a",
    );
    expect(fixture.calls.at(-1)?.url).toBe("/observer/v1/snapshot");
    fixture.setMode("reordered");
    expect((await observer.refresh()).gap).toContain("Replay was rejected");
    const freshObserver = createRouterObserver(dir);
    await freshObserver.refresh();
    const reordered = await freshObserver.refresh();
    expect(reordered.facts?.resources[0]?.identity.model).toBe("authoritative");
    expect(reordered.gap).toContain(
      "intermediate history is not reconstructed",
    );
    fixture.setMode("denied");
    const denied = await observer.refresh();
    expect(denied.status).toBe("denied");
    expect(denied.facts).toBeNull();
    fixture.setMode("normal");
    expect((await observer.refresh()).status).toBe("connected");
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    const disconnected = await observer.refresh();
    expect(disconnected.status).toBe("disconnected");
    expect(disconnected.last_known).toBe(true);
    expect(disconnected.facts?.resources[0]?.freshness).toBe("stale");
    expect(
      fixture.calls.every((call) => call.auth === `Bearer ${credential}`),
    ).toBe(true);
    expect(
      fixture.calls.every((call) =>
        ["/observer/v1/snapshot", "/observer/v1/replay"].includes(
          call.url ?? "",
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(disconnected)).not.toContain(credential);
    expect(JSON.stringify(disconnected)).not.toContain("synthetic-epoch");
  });

  it("fails closed for unsupported versions, redirects, secret echoes and unsafe config files", async () => {
    const fixture = await upstream();
    const dir = directory();
    writeConfig(dir, fixture.origin);
    for (const mode of ["version", "redirect", "echo"]) {
      fixture.setMode(mode);
      const observer = createRouterObserver(dir);
      const result = await observer.refresh();
      expect(result.status).toBe("unsupported");
      expect(result.facts).toBeNull();
      expect(JSON.stringify(result)).not.toContain(credential);
    }
    chmodSync(join(dir, "router.json"), 0o644);
    const observer = createRouterObserver(dir);
    expect(observer.view().status).toBe("configuration_error");
    rmSync(join(dir, "router.json"));
    symlinkSync("/dev/null", join(dir, "router.json"));
    expect(observer.view().status).toBe("configuration_error");
    rmSync(join(dir, "router.json"));
    expect(observer.view().status).toBe("unconfigured");
  });

  it("bounds projected lists and reports omitted entries explicitly", async () => {
    const fixture = await upstream();
    fixture.setMode("large");
    const dir = directory();
    writeConfig(dir, fixture.origin);
    const result = await createRouterObserver(dir).refresh();
    expect(result.status).toBe("connected");
    expect(result.facts?.resource_count).toBe(201);
    expect(result.facts?.resources).toHaveLength(200);
  });

  it("coalesces concurrent refreshes until denial clears old facts", async () => {
    const fixture = await upstream();
    const dir = directory();
    writeConfig(dir, fixture.origin);
    const observer = createRouterObserver(dir);
    expect((await observer.refresh()).status).toBe("connected");
    fixture.setMode("held-denied");
    const first = observer.refresh();
    try {
      await Promise.race([
        fixture.waiting,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fixture timed out")), 3000),
        ),
      ]);
      const second = observer.refresh();
      let settled = false;
      void second.then(() => {
        settled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      fixture.release();
      const [one, two] = await Promise.all([first, second]);
      expect(one.status).toBe("denied");
      expect(two.status).toBe("denied");
      expect(one.facts).toBeNull();
      expect(two.facts).toBeNull();
      expect(fixture.calls).toHaveLength(2);
    } finally {
      fixture.release();
    }
  });

  it("clears facts when provenance refresh is denied and when config is removed during replay", async () => {
    const fixture = await upstream();
    const dir = directory();
    writeConfig(dir, fixture.origin);
    const observer = createRouterObserver(dir);
    expect((await observer.refresh()).status).toBe("connected");
    fixture.setMode("provenance-denied");
    const denied = await observer.refresh();
    expect(denied.status).toBe("denied");
    expect(denied.facts).toBeNull();
    fixture.setMode("normal");
    expect((await observer.refresh()).status).toBe("connected");
    fixture.setMode("held");
    const pending = observer.refresh();
    try {
      await Promise.race([
        fixture.waiting,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fixture timed out")), 3000),
        ),
      ]);
      rmSync(join(dir, "router.json"));
      expect(observer.view().status).toBe("unconfigured");
      fixture.release();
      const result = await pending;
      expect(result.status).toBe("unconfigured");
      expect(result.facts).toBeNull();
    } finally {
      fixture.release();
    }
  });

  it("requires verified TLS for a loopback HTTPS observer", async () => {
    const dir = directory();
    const keyPath = join(dir, "fixture-key.pem");
    const certPath = join(dir, "fixture-cert.pem");
    const generated = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      {
        env: { PATH: process.env.PATH ?? "", HOME: dir },
        stdio: "ignore",
      },
    );
    expect(generated.status).toBe(0);
    const server = createHttpsServer(
      { key: readFileSync(keyPath), cert: readFileSync(certPath) },
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            schema_version: 1,
            cursor: cursor(1),
            snapshot: snapshot(),
          }),
        );
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing TLS fixture address");
      writeConfig(dir, `https://127.0.0.1:${address.port}`);
      const script =
        'import { createRouterObserver } from "./server/router.ts"; console.log((await createRouterObserver(process.env.TEST_STATE).refresh()).status);';
      const base = { PATH: process.env.PATH ?? "", HOME: dir, TEST_STATE: dir };
      const untrusted = await run(
        process.execPath,
        ["--input-type=module", "-e", script],
        { env: { ...base, NODE_TLS_REJECT_UNAUTHORIZED: "0" }, timeout: 10000 },
      );
      expect(untrusted.stdout.trim()).toBe("disconnected");
      const trusted = await run(
        process.execPath,
        ["--input-type=module", "-e", script],
        { env: { ...base, NODE_EXTRA_CA_CERTS: certPath }, timeout: 10000 },
      );
      expect(trusted.stdout.trim()).toBe("connected");
      expect(trusted.stdout).not.toContain(credential);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps configuration local and requires Console authentication for observer endpoints", async () => {
    const fixture = await upstream();
    const dir = directory();
    const state = openState(dir);
    state.db
      .prepare("INSERT INTO owner (id, password_hash) VALUES (1, ?)")
      .run(await hash(password));
    state.db.close();
    const configured = spawnSync(
      process.execPath,
      ["server/router-cli.ts", "set", fixture.origin],
      {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: dir,
          CONSOLE_STATE_DIR: dir,
        },
        input: credential,
        encoding: "utf8",
      },
    );
    expect(configured.status).toBe(0);
    expect(configured.stdout).not.toContain(credential);
    const assets = join(dir, "assets");
    mkdirSync(assets);
    writeFileSync(
      join(assets, "index.html"),
      "<!doctype html><title>fixture</title>",
    );
    const app = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/router", headers }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/router/refresh",
            headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/router/refresh",
            headers: { ...headers, cookie, origin: "https://attacker.example" },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const response = await app.inject({
        method: "POST",
        url: "/api/router/refresh",
        headers: { ...headers, cookie },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe("connected");
      expect(response.body).not.toContain(credential);
      expect(response.body).not.toContain("synthetic-epoch");
    } finally {
      await app.close();
    }
    const cleared = spawnSync(
      process.execPath,
      ["server/router-cli.ts", "clear"],
      {
        env: {
          PATH: process.env.PATH ?? "",
          HOME: dir,
          CONSOLE_STATE_DIR: dir,
        },
        encoding: "utf8",
      },
    );
    expect(cleared.status).toBe(0);
    expect(cleared.stdout).not.toContain(credential);
    expect(createRouterObserver(dir).view().status).toBe("unconfigured");
  });

  it("does not return an in-flight observation after session logout", async () => {
    const fixture = await upstream();
    const dir = directory();
    const state = openState(dir);
    state.db
      .prepare("INSERT INTO owner (id, password_hash) VALUES (1, ?)")
      .run(await hash(password));
    state.db.close();
    writeConfig(dir, fixture.origin);
    const assets = join(dir, "assets");
    mkdirSync(assets);
    writeFileSync(
      join(assets, "index.html"),
      "<!doctype html><title>fixture</title>",
    );
    const app = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/router/refresh",
            headers: { ...headers, cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      fixture.setMode("held");
      const pending = app.inject({
        method: "POST",
        url: "/api/router/refresh",
        headers: { ...headers, cookie },
        payload: {},
      });
      await Promise.race([
        fixture.waiting,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fixture timed out")), 3000),
        ),
      ]);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: { ...headers, cookie },
            payload: {},
          })
        ).statusCode,
      ).toBe(200);
      fixture.release();
      const result = await pending;
      expect(result.statusCode).toBe(401);
      expect(result.body).not.toContain("model-a");
    } finally {
      fixture.release();
      await app.close();
    }
  });
});

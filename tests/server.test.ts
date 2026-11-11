import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { openState } from "../server/state.ts";
import type { Session } from "fastify";

const directories: string[] = [];
const origin = "http://127.0.0.1:4173";
const headers = {
  host: "127.0.0.1:4173",
  origin,
  "content-type": "application/json",
};
const token = "synthetic-setup-authority";
const password = "synthetic-owner-password";

async function fixture(
  clock = () => Date.now(),
  kernelOwner?: import("../server/app.ts").AppOptions["kernelOwner"],
) {
  const dir = mkdtempSync(join(tmpdir(), "console-test-"));
  directories.push(dir);
  const assets = join(dir, "assets");
  mkdirSync(assets);
  writeFileSync(
    join(assets, "index.html"),
    "<!doctype html><title>fixture</title>",
  );
  const state = openState(dir, clock);
  state.db
    .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
    .run(
      JSON.stringify({
        digest: createHash("sha256").update(token).digest("hex"),
        expires: clock() + 60_000,
      }),
    );
  state.db.close();
  const app = await createApp({
    stateDirectory: dir,
    staticDirectory: assets,
    origin,
    now: clock,
    ...(kernelOwner ? { kernelOwner } : {}),
  });
  return { app, dir, assets };
}

afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("authenticated application", () => {
  it("uses the restored cookie expires deadline without touching the session", async () => {
    const { app, dir } = await fixture();
    try {
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const state = openState(dir);
      try {
        const row = state.db.prepare("SELECT * FROM sessions").get()!;
        const data = JSON.parse(String(row.data));
        const future = new Date(Date.now() + 3600000).toISOString();
        const past = new Date(Date.now() - 1000).toISOString();
        expect(Number(row.idle_expires)).toBeGreaterThan(Date.now());
        expect(Number(row.absolute_expires)).toBeGreaterThan(Date.now());
        for (const value of [
          { originalExpires: future, expires: past },
          { originalExpires: null, expires: "invalid" },
          { originalExpires: future, expires: null },
        ]) {
          data.cookie = { ...data.cookie, ...value };
          const encoded = JSON.stringify(data);
          state.db.prepare("UPDATE sessions SET data = ?").run(encoded);
          const result = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: { ...headers, cookie },
          });
          expect(result.statusCode).toBe(401);
          expect(result.headers["set-cookie"]).toBeUndefined();
          expect(state.db.prepare("SELECT * FROM sessions").get()).toEqual({
            ...row,
            data: encoded,
          });
        }
        data.cookie = {
          ...data.cookie,
          originalExpires: past,
          expires: future,
        };
        const encoded = JSON.stringify(data);
        state.db.prepare("UPDATE sessions SET data = ?").run(encoded);
        const passive = await app.inject({
          method: "GET",
          url: "/api/kernel/session-check",
          headers: { ...headers, cookie },
        });
        expect(passive.statusCode).toBe(200);
        expect(passive.json()).toEqual({ authenticated: true });
        expect(passive.headers["set-cookie"]).toBeUndefined();
        expect(state.db.prepare("SELECT * FROM sessions").get()).toEqual({
          ...row,
          data: encoded,
        });
        const regular = await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        });
        expect(regular.statusCode).toBe(200);
      } finally {
        state.db.close();
      }
    } finally {
      await app.close();
    }
  });
  it.each(["idle", "absolute", "revocation"])(
    "checks %s without touching sessions or issuing cookies",
    async (mode) => {
      let now = Date.now();
      const { app, dir } = await fixture(() => now);
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
        const auth = { ...headers, cookie };
        for (const supplied of [undefined, `${cookie}invalid`]) {
          const denied = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: { ...headers, ...(supplied ? { cookie: supplied } : {}) },
          });
          expect(denied.statusCode).toBe(401);
          expect(denied.headers["set-cookie"]).toBeUndefined();
        }
        const row = () => {
          const state = openState(dir, () => now);
          try {
            return state.db.prepare("SELECT * FROM sessions").get();
          } finally {
            state.db.close();
          }
        };
        const initial = row();
        for (let i = 0; i < 3; i++) {
          now += 60_000;
          const check = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: auth,
          });
          expect(check.statusCode).toBe(200);
          expect(check.headers["set-cookie"]).toBeUndefined();
          expect(check.headers["cache-control"]).toBe("no-store");
          expect(row()).toEqual(initial);
        }
        if (mode === "idle") now += 28 * 60_000;
        if (mode === "absolute") {
          const state = openState(dir, () => now);
          state.db
            .prepare(
              "UPDATE sessions SET idle_expires = absolute_expires + 60000",
            )
            .run();
          state.db.close();
          now = Number(initial!.absolute_expires) - 1;
          const before = await app.inject({
            method: "GET",
            url: "/api/kernel/session-check",
            headers: auth,
          });
          expect(before.statusCode).toBe(200);
          expect(before.headers["set-cookie"]).toBeUndefined();
          now = Number(initial!.absolute_expires);
        }
        if (mode === "revocation")
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: auth,
            payload: {},
          });
        const denied = await app.inject({
          method: "GET",
          url: "/api/kernel/session-check",
          headers: auth,
        });
        expect(denied.statusCode).toBe(401);
        expect(denied.headers["set-cookie"]).toBeUndefined();
        expect(
          (
            await app.inject({
              method: "GET",
              url: "/api/kernel/session-check",
              headers: { ...auth, origin: "https://attacker.example" },
            })
          ).statusCode,
        ).toBe(403);
      } finally {
        await app.close();
      }
    },
  );
  it.each(["logout", "expiry"])(
    "denies a proposal after %s during the read",
    async (mode) => {
      let now = Date.now();
      let release!: (value: { digest: string; text: string }) => void;
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      const closed = vi.fn();
      const { app } = await fixture(() => now, {
        scope: "synthetic",
        close: closed,
        readProposal: () => {
          start();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      });
      try {
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        });
        const login = await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        });
        const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
        const auth = { ...headers, cookie };
        const pending = app.inject({
          method: "GET",
          url: "/api/kernel/owner",
          headers: auth,
        });
        await started;
        if (mode === "logout")
          await app.inject({
            method: "POST",
            url: "/api/logout",
            headers: auth,
            payload: {},
          });
        else now += 31 * 60_000;
        release({ digest: "a".repeat(64), text: "synthetic-private-proposal" });
        const result = await pending;
        expect(result.statusCode).toBe(401);
        expect(result.body).not.toContain("synthetic-private-proposal");
      } finally {
        await app.close();
        expect(closed).toHaveBeenCalledOnce();
      }
    },
  );
  it("keeps Kernel owner operations unavailable despite a Console session", async () => {
    const { app } = await fixture();
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/kernel/owner", headers }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers,
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, origin: "https://attacker.example" },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(403);
      await app.inject({
        method: "POST",
        url: "/api/bootstrap",
        headers,
        payload: { token, password },
      });
      const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers,
        payload: { password },
      });
      const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      const status = await app.inject({
        method: "GET",
        url: "/api/kernel/owner",
        headers: { ...headers, cookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ status: "unavailable", actions: [] });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { host: headers.host, cookie },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(403);
      for (const action of ["approve", "stop", "unsupported"]) {
        const result = await app.inject({
          method: "POST",
          url: "/api/kernel/owner",
          headers: { ...headers, cookie },
          payload: { action, principal: "synthetic-injected-principal" },
        });
        expect(result.statusCode).toBe(503);
        expect(result.body).not.toContain("synthetic-injected-principal");
      }
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie, host: "attacker.example" },
          })
        ).statusCode,
      ).toBe(403);
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
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/kernel/owner",
            headers: { ...headers, cookie },
            payload: { action: "approve" },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("enforces one-time setup, host/origin, fixation, revocation and restart persistence", async () => {
    const { app, dir, assets } = await fixture();
    expect(
      (await app.inject({ method: "GET", url: "/api/application", headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/session",
          headers: { host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: '{"password":"synthetic-do-not-echo"',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain("synthetic-do-not-echo");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/session",
          headers: { ...headers, origin: "https://attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers: { host: headers.host },
          payload: { password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers: { ...headers, origin: "https://attacker.example" },
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token: "wrong", password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password: "incorrect" },
        })
      ).statusCode,
    ).toBe(401);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(String(login.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(login.headers["set-cookie"])).toContain("SameSite=Strict");
    expect(String(login.headers["set-cookie"])).not.toContain("Secure");
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(200);
    const rotated = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { ...headers, cookie },
      payload: { password },
    });
    const nextCookie = String(rotated.headers["set-cookie"]).split(";")[0]!;
    expect(nextCookie).not.toBe(cookie);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: nextCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/logout",
          headers: { ...headers, cookie: nextCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: nextCookie },
        })
      ).statusCode,
    ).toBe(401);
    await restarted.close();
  });

  it("enforces server-side idle expiration", async () => {
    let now = Date.now();
    const { app } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    now += 30 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("cannot revive expired or previously valid sessions after a clock rollback and restart", async () => {
    let now = Date.now();
    const { app, dir, assets } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const expired = String(login.headers["set-cookie"]).split(";")[0]!;
    now += 30 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: expired },
        })
      ).statusCode,
    ).toBe(401);
    now -= 29 * 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: expired },
        })
      ).statusCode,
    ).toBe(401);
    const next = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const active = String(next.headers["set-cookie"]).split(";")[0]!;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: active },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
    now -= 1;
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    expect(
      (
        await restarted.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: active },
        })
      ).statusCode,
    ).toBe(401);
    await restarted.close();
  });

  it("invalidates outstanding setup authority after clock rollback", () => {
    let now = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "console-clock-"));
    directories.push(dir);
    const state = openState(dir, () => now);
    state.db
      .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
      .run("synthetic");
    state.db.close();
    now -= 1;
    const restarted = openState(dir, () => now);
    expect(
      restarted.db
        .prepare("SELECT value FROM settings WHERE name = 'bootstrap'")
        .get(),
    ).toBeUndefined();
    restarted.db.close();
  });

  it("rejects expired setup authority and persists failed-login throttling", async () => {
    let now = Date.now();
    const { app, dir, assets } = await fixture(() => now);
    now += 60_000;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token, password },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
    const state = openState(dir, () => now);
    state.db
      .prepare("UPDATE settings SET value = ? WHERE name = 'bootstrap'")
      .run(
        JSON.stringify({
          digest: createHash("sha256").update(token).digest("hex"),
          expires: now + 60_000,
        }),
      );
    state.db.close();
    const server = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    await server.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/login",
            headers,
            payload: { password: "incorrect" },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(429);
    await server.close();
    const restarted = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
      now: () => now,
    });
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(429);
    now += 60_000;
    expect(
      (
        await restarted.inject({
          method: "POST",
          url: "/api/login",
          headers,
          payload: { password },
        })
      ).statusCode,
    ).toBe(200);
    await restarted.close();
  });

  it("keeps browser sessions separate and enforces absolute expiry despite activity", async () => {
    let now = Date.now();
    const { app } = await fixture(() => now);
    await app.inject({
      method: "POST",
      url: "/api/bootstrap",
      headers,
      payload: { token, password },
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const one = String(first.headers["set-cookie"]).split(";")[0]!;
    let two = String(second.headers["set-cookie"]).split(";")[0]!;
    expect(one).not.toBe(two);
    await app.inject({
      method: "POST",
      url: "/api/logout",
      headers: { ...headers, cookie: one },
      payload: {},
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: one },
        })
      ).statusCode,
    ).toBe(401);
    for (let i = 0; i < 48; i++) {
      now += 29 * 60_000;
      const response = await app.inject({
        method: "GET",
        url: "/api/application",
        headers: { ...headers, cookie: two },
      });
      expect(response.statusCode).toBe(200);
      two = String(response.headers["set-cookie"]).split(";")[0]!;
    }
    for (const minutes of [28, 19]) {
      now += minutes * 60_000;
      const response = await app.inject({
        method: "GET",
        url: "/api/application",
        headers: { ...headers, cookie: two },
      });
      expect(response.statusCode).toBe(200);
      two = String(response.headers["set-cookie"]).split(";")[0]!;
    }
    now += 60_000;
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie: two },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });

  it("fences stale saves and stale revocation after rotation", () => {
    const dir = mkdtempSync(join(tmpdir(), "console-store-"));
    directories.push(dir);
    const state = openState(dir);
    const value = (generation: string) =>
      ({
        cookie: { originalMaxAge: null },
        __fastifySessionMetadata: { generation },
      }) as Session;
    let failure: NodeJS.ErrnoException | undefined;
    state.store.set("synthetic-id", value("first"), (error) => {
      failure = error;
    });
    expect(failure).toBeUndefined();
    state.store.compareAndSet(
      "synthetic-id",
      "first",
      value("second"),
      (error) => {
        failure = error;
      },
    );
    expect(failure).toBeUndefined();
    expect(state.revoke("synthetic-id", "first")).toBe(false);
    state.store.compareAndSet(
      "synthetic-id",
      "first",
      value("first"),
      (error) => {
        failure = error;
      },
    );
    expect(failure?.code).toBe("ENOENT");
    expect(state.revoke("synthetic-id", "second")).toBe(true);
    state.store.compareAndSet(
      "synthetic-id",
      "second",
      value("second"),
      (error) => {
        failure = error;
      },
    );
    expect(failure?.code).toBe("ENOENT");
    state.db.close();
  });

  it("issues local-only setup authority and revokes restored sessions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-cli-"));
    directories.push(dir);
    const env = { HOME: dir, CONSOLE_STATE_DIR: dir };
    const issued = spawnSync(
      process.execPath,
      ["server/bootstrap.ts", "issue"],
      { env, encoding: "utf8" },
    );
    expect(issued.status).toBe(0);
    const authority = readFileSync(join(dir, "bootstrap-token"), "utf8").trim();
    expect(issued.stdout).not.toContain(authority);
    expect(statSync(join(dir, "bootstrap-token")).mode & 0o777).toBe(0o600);
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
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers,
          payload: { token: authority, password },
        })
      ).statusCode,
    ).toBe(200);
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers,
      payload: { password },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    await app.close();
    expect(
      spawnSync(process.execPath, ["server/bootstrap.ts", "issue"], {
        env,
        encoding: "utf8",
      }).status,
    ).not.toBe(0);
    expect(
      spawnSync(process.execPath, ["server/bootstrap.ts", "revoke-sessions"], {
        env,
        encoding: "utf8",
      }).status,
    ).toBe(0);
    const restored = await createApp({
      stateDirectory: dir,
      staticDirectory: assets,
      origin,
    });
    expect(
      (
        await restored.inject({
          method: "GET",
          url: "/api/application",
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(401);
    await restored.close();
  });

  it("rejects unsafe state paths and HTTPS without TLS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "console-path-"));
    directories.push(dir);
    const outside = join(dir, "outside");
    writeFileSync(outside, "unchanged");
    const stateDir = join(dir, "state");
    mkdirSync(stateDir, { mode: 0o700 });
    symlinkSync(outside, join(stateDir, "console.sqlite"));
    expect(() => openState(stateDir)).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("unchanged");
    await expect(
      createApp({ stateDirectory: dir, origin: "https://console.example" }),
    ).rejects.toThrow("TLS");
    await expect(
      createApp({ stateDirectory: dir, origin: "http://console.example" }),
    ).rejects.toThrow("loopback");
    const incompatible = join(dir, "newer");
    const state = openState(incompatible);
    state.db.exec("PRAGMA user_version = 99");
    state.db.close();
    expect(() => openState(incompatible)).toThrow("Unsupported state version");
  });
});

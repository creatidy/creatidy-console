import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";

const run = promisify(execFile);
const chrome = "/usr/bin/google-chrome";

it.skipIf(!existsSync(chrome))(
  "exercises local browser setup, login, restart and logout",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "console-browser-"));
    const state = join(directory, "state");
    const assets = join(directory, "dist");
    const env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: directory,
      TMPDIR: directory,
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_CACHE_HOME: join(directory, "cache"),
      CONSOLE_STATE_DIR: state,
      CONSOLE_STATIC_DIR: assets,
    };
    let browser;
    let server;
    let upstream;
    async function stopServer() {
      if (
        !server?.pid ||
        server.exitCode !== null ||
        server.signalCode !== null
      )
        return;
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      const timer = setTimeout(() => server.kill("SIGKILL"), 3000);
      await exited;
      clearTimeout(timer);
    }
    try {
      await run(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "build", "--outDir", assets],
        { env, timeout: 30000 },
      );
      await run(process.execPath, ["server/bootstrap.ts", "issue"], {
        env,
        timeout: 10000,
      });
      const authority = readFileSync(
        join(state, "bootstrap-token"),
        "utf8",
      ).trim();
      const listener = createServer();
      await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
      });
      const origin = `http://127.0.0.1:${listener.address().port}`;
      await new Promise((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
      async function startServer() {
        server = spawn(process.execPath, ["server/main.ts"], {
          env: { ...env, CONSOLE_ORIGIN: origin },
          stdio: "ignore",
        });
        server.on("error", () => {});
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (
            !server.pid ||
            server.exitCode !== null ||
            server.signalCode !== null
          )
            throw new Error("Application server exited");
          try {
            if (
              (
                await fetch(`${origin}/api/session`, {
                  signal: AbortSignal.timeout(1000),
                })
              ).ok
            )
              return;
          } catch {
            /* retry bounded local readiness */
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("Application server readiness timed out");
      }
      await startServer();
      browser = await chromium.launch({
        executablePath: chrome,
        headless: true,
        chromiumSandbox: true,
        env,
        args: [
          "--disable-background-networking",
          "--disable-component-update",
          "--proxy-server=127.0.0.1:9",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        ],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.clock.install();
      await page.goto(origin);
      await page
        .getByRole("heading", { name: "Set up your console" })
        .waitFor();
      expect(
        await page.evaluate(() =>
          fetch("/api/application").then((response) => response.status),
        ),
      ).toBe(401);
      await page.getByLabel("Setup authority").fill(authority);
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      await page
        .getByLabel("Confirm owner password")
        .fill("synthetic-owner-password");
      await page.getByRole("button", { name: "Create owner" }).click();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(existsSync(join(state, "bootstrap-token"))).toBe(false);
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      const [loginResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url() === `${origin}/api/login` &&
            response.request().method() === "POST",
          { timeout: 5000 },
        ),
        page.getByRole("button", { name: "Sign in" }).click(),
      ]);
      expect(loginResponse.status()).toBe(200);
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      await page
        .getByRole("heading", { name: "Kernel owner actions" })
        .waitFor();
      await page
        .getByText(
          "Unavailable: no verified Kernel owner capability is connected. Console login does not grant Kernel authority.",
        )
        .waitFor();
      expect(
        await page
          .getByRole("button", { name: /approve|stop|reconcile|start/i })
          .count(),
      ).toBe(0);
      const mi = {
        schema: "mi.operator-working/1",
        product: "model-intelligence",
        instance: '<img src=x onerror="window.miInjected=1">',
        evaluated_at: "2026-11-13T00:00:00Z",
        capabilities: {
          reads: ["status", "inspect", "export"],
          commands: [],
          replay: false,
        },
        publication: {
          state: "empty",
          reference: null,
          artifact: null,
          diagnostics: [],
        },
        health: {
          state: "missing",
          sha256: null,
          data: null,
          correlation: "unavailable",
        },
        facts: {
          latest: [],
          future: [],
          stale: [],
          unknown_freshness: [],
          notices: [],
          uncertain_campaigns: [],
          conflicts: [],
          projection: { offers: [], models: [], surfaces: [], conflicts: [] },
        },
        history: {
          scope: "retained-publication-cuts-only",
          replay: false,
          checkpoint: null,
          relation: "unavailable",
          evidence_added: [],
          projection_changed: null,
        },
      };
      await page
        .getByLabel("Select an offline snapshot (maximum 256 KiB)")
        .setInputFiles({
          name: "synthetic-mi.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(mi)),
        });
      await page.getByText(/Supported empty snapshot shape/).waitFor();
      expect(await page.evaluate(() => window.miInjected)).toBeUndefined();
      for (const [state, expected] of [
        ["invalid", /reports an invalid retained publication/],
        ["unsupported", /reports an unsupported retained publication/],
      ]) {
        await page
          .getByLabel("Select an offline snapshot (maximum 256 KiB)")
          .setInputFiles({
            name: "synthetic-mi-state.json",
            mimeType: "application/json",
            buffer: Buffer.from(
              JSON.stringify({
                ...mi,
                publication: {
                  state,
                  reference: null,
                  artifact: null,
                  diagnostics: ["retained-publication-invalid-or-unreadable"],
                },
              }),
            ),
          });
        await page.getByText(expected).waitFor();
        await page
          .getByText(/previous inspected file remains last known/)
          .waitFor();
        await page.getByText(/Unverified file instance/).waitFor();
      }
      await page
        .getByLabel("Select an offline snapshot (maximum 256 KiB)")
        .setInputFiles({
          name: "invalid.json",
          mimeType: "application/json",
          buffer: Buffer.from("{invalid"),
        });
      await page
        .getByText(/previous inspected file remains last known/)
        .waitFor();
      await page.getByText(/Unverified file instance/).waitFor();
      await page.evaluate(() => {
        const original = window.fetch.bind(window);
        let hold = true;
        window.fetch = (...args) => {
          if (hold && args[0] === "/api/kernel/session-check") {
            hold = false;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () =>
                new Promise((resolve) => {
                  window.releaseOldMiCheck = () =>
                    resolve({ authenticated: false });
                }),
            });
          }
          return original(...args);
        };
      });
      await page.clock.fastForward(10000);
      await page.waitForFunction(
        () => typeof window.releaseOldMiCheck === "function",
      );
      await page
        .getByLabel("Select an offline snapshot (maximum 256 KiB)")
        .setInputFiles({
          name: "synthetic-mi.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(mi)),
        });
      await page.getByText(/Unverified file instance/).waitFor();
      await page.evaluate(async () => {
        window.releaseOldMiCheck();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(await page.getByText(/Unverified file instance/).count()).toBe(1);
      await page.reload();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      expect(await page.getByText(/Unverified file instance/).count()).toBe(0);
      const payload = {
        applicability: {
          scope: "synthetic",
          channel: null,
          configuration: null,
          source_ids: ["synthetic-source"],
        },
        observations: [
          {
            id: mi.instance,
            source: "synthetic-source",
            authority: "official",
            type: "documentation",
            reference: "https://example.invalid/",
            revision: null,
            rights: { distribution: "unknown", license: "unknown" },
            times: {
              acquired: "2026-01-01T00:00:00Z",
              observed: null,
              published: null,
              fresh_until: null,
            },
          },
        ],
        statements: [],
        notices: [],
        uncertain_campaigns: [],
      };
      const frame = {
        format_version: 1,
        payload_schema: "mi.public-evidence-working/2",
        produced_at: "2026-01-01T00:00:00Z",
        scope: "synthetic",
        members: [`observation:${mi.instance}`],
        sources: [
          {
            source_id: "synthetic-source",
            reference: "https://example.invalid/",
            revision: null,
          },
        ],
        payload: JSON.stringify(payload),
      };
      const artifact = JSON.stringify(frame);
      const ref = {
        format_version: 1,
        payload_schema: frame.payload_schema,
        sha256: createHash("sha256").update(artifact).digest("hex"),
      };
      const publication = {
        ...mi,
        publication: {
          state: "available",
          reference: ref,
          artifact,
          diagnostics: [],
        },
        history: { ...mi.history, relation: "initial" },
      };
      const file = {
        name: "synthetic-publication.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(publication)),
      };
      await page
        .getByLabel("Expected artifact SHA-256", { exact: true })
        .fill(ref.sha256);
      await page
        .getByLabel("Previous expected artifact SHA-256")
        .fill(ref.sha256);
      await page
        .getByLabel("Previous offline snapshot (optional, maximum 256 KiB)")
        .setInputFiles(file);
      await page
        .getByLabel("Select a current publication snapshot (maximum 256 KiB)")
        .setInputFiles(file);
      await page.getByText(/Comparison of supplied files: duplicate/).waitFor();
      expect(
        await page
          .getByText(/Neither file nor reference is authenticated/)
          .count(),
      ).toBe(1);
      await page
        .getByText("Untrusted evidence records and reported rights")
        .click();
      expect(await page.getByText(/synthetic-source/).count()).toBeGreaterThan(
        0,
      );
      expect(await page.evaluate(() => window.miInjected)).toBeUndefined();
      await page
        .getByLabel("Previous offline snapshot (optional, maximum 256 KiB)")
        .setInputFiles(file);
      const unrelated = {
        ...file,
        buffer: Buffer.from(
          JSON.stringify({ ...publication, instance: "other-instance" }),
        ),
      };
      await page
        .getByLabel("Select a current publication snapshot (maximum 256 KiB)")
        .setInputFiles(unrelated);
      await page
        .getByText(/do not establish a continuous retained cut/)
        .waitFor();
      await page
        .getByText(/previous inspected file remains last known/)
        .waitFor();
      await page.getByText(/Comparison of supplied files: duplicate/).waitFor();
      await page
        .getByLabel("Select a current publication snapshot (maximum 256 KiB)")
        .setInputFiles(unrelated);
      await page
        .getByText(/Unverified file instance: other-instance/)
        .waitFor();
      await page.getByText(/Earlier history: unavailable/).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      expect(await page.getByText(/Comparison of supplied files/).count()).toBe(
        0,
      );
      const hostile =
        '<img src=x onerror="window.ownerInjected=1">' + "x".repeat(2048);
      let snapshotReads = 0;
      await page.route("**/api/kernel/snapshot", (route) => {
        snapshotReads++;
        const pageNumber = route.request().postDataJSON()?.page ?? 0;
        return route.fulfill({
          json: {
            status: "observed",
            snapshot: {
              scope: hostile,
              epoch: "a".repeat(32),
              sequence: "3",
              revision: "4",
              startPage: pageNumber,
              status: "running",
              history: "initial",
              counts: {
                work_units: { sampled: pageNumber ? 1 : 64, total: 65 },
              },
              workUnits: [[hostile, "pending", null, null], null],
              attempts: [],
              decisions: [],
              correlations: [],
              commandCoverage: { sampled: 0, total: 0, complete: true },
            },
          },
        });
      });
      expect(snapshotReads).toBe(0);
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await page.getByText("work_units: 65 total; 64 sampled").waitFor();
      expect(snapshotReads).toBe(1);
      expect(await page.evaluate(() => window.ownerInjected)).toBeUndefined();
      await page.getByRole("button", { name: "Next pages" }).click();
      await page.getByText("work_units: 65 total; 1 sampled").waitFor();
      expect(snapshotReads).toBe(2);
      await page.evaluate(() => {
        const original = window.fetch.bind(window);
        let hold = true;
        window.fetch = (...args) => {
          if (hold && args[0] === "/api/kernel/session-check") {
            hold = false;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () =>
                new Promise((resolve) => {
                  window.releaseOldKernelCheck = () =>
                    resolve({ authenticated: false });
                }),
            });
          }
          return original(...args);
        };
      });
      await page.clock.fastForward(10000);
      await page.waitForFunction(
        () => typeof window.releaseOldKernelCheck === "function",
      );
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await page.getByText("work_units: 65 total; 64 sampled").waitFor();
      await page.evaluate(async () => {
        window.releaseOldKernelCheck();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        await page.getByText("work_units: 65 total; 64 sampled").count(),
      ).toBe(1);
      await page.route("**/api/kernel/session-check", (route) =>
        route.fulfill({ status: 401, json: { error: "Login required" } }),
      );
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(
        await page.getByText("work_units: 65 total; 64 sampled").count(),
      ).toBe(0);
      await page.unroute("**/api/kernel/session-check");
      await page.unroute("**/api/kernel/snapshot");
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      await page.evaluate(() => {
        window.originalTestFetch = window.fetch;
        window.fetch = async (...args) => {
          const response = await window.originalTestFetch(...args);
          if (new URL(response.url).pathname === "/api/login")
            await response.clone().arrayBuffer();
          return response;
        };
      });
      try {
        const [instrumentedLogin] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url() === `${origin}/api/login` &&
              response.request().method() === "POST",
            { timeout: 5000 },
          ),
          page.getByRole("button", { name: "Sign in" }).click(),
        ]);
        expect(instrumentedLogin.status()).toBe(200);
        let timer;
        try {
          expect(
            await Promise.race([
              instrumentedLogin.json(),
              new Promise((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(new Error("Instrumented login body unavailable")),
                  5000,
                );
              }),
            ]),
          ).toEqual({ ok: true });
        } finally {
          clearTimeout(timer);
        }
      } finally {
        await page.evaluate(() => {
          window.fetch = window.originalTestFetch;
          delete window.originalTestFetch;
        });
      }
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      let proposalReads = 0;
      await page.route("**/api/kernel/owner", (route) => {
        proposalReads++;
        return route.fulfill({
          json: {
            status: "connected",
            actions: [],
            scope: hostile,
            digest: "a".repeat(64),
            text: hostile,
          },
          headers: { "cache-control": "no-store" },
        });
      });
      await page.setViewportSize({ width: 360, height: 800 });
      await page.reload();
      await page
        .getByText(
          "Verified proposal received when this view opened; it may have changed. Reload to recheck. No owner commands are available.",
        )
        .waitFor();
      expect(await page.locator("pre").textContent()).toBe(hostile);
      expect(await page.locator("pre img").count()).toBe(0);
      expect(await page.evaluate(() => window.ownerInjected)).toBeUndefined();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page.getByText(/Effective host policy is unknown/).count(),
      ).toBe(1);
      let checks = 0;
      await page.route("**/api/kernel/session-check", (route) => {
        checks++;
        return checks === 1 ? route.abort("failed") : route.continue();
      });
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await page.getByText(/Kernel proposal unavailable/).waitFor();
      expect(await page.locator("pre").count()).toBe(0);
      await page.clock.fastForward(10000);
      await page.getByText(hostile, { exact: false }).first().waitFor();
      expect(checks).toBe(2);
      expect(proposalReads).toBe(1);
      await page.unroute("**/api/kernel/session-check");
      let releaseCheck;
      let checkStarted;
      const started = new Promise((resolve) => {
        checkStarted = resolve;
      });
      const held = new Promise((resolve) => {
        releaseCheck = resolve;
      });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.locator("pre").waitFor({ state: "hidden" });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.getByText(hostile, { exact: false }).first().waitFor();
      await page.route("**/api/kernel/session-check", async (route) => {
        checkStarted();
        await held;
        await route.fulfill({ json: { authenticated: true } }).catch(() => {});
      });
      await started;
      expect(await page.locator("pre").count()).toBe(0);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await page.locator("pre").count()).toBe(0);
      await page.route("**/api/kernel/session-check", (route) =>
        route.fulfill({ status: 401, json: { error: "expired" } }),
      );
      await page.evaluate(() => {
        window.invalidationSignals = [];
        window.invalidationChannel = new BroadcastChannel(
          "creatidy-console-session-v1",
        );
        window.invalidationChannel.onmessage = (event) =>
          window.invalidationSignals.push(event.data);
      });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      await page.waitForFunction(() => window.invalidationSignals.length > 0);
      expect(await page.evaluate(() => window.invalidationSignals)).toEqual([
        null,
      ]);
      await page.evaluate(() => window.invalidationChannel.close());
      releaseCheck();
      expect(await page.locator("pre").count()).toBe(0);
      await page.unroute("**/api/kernel/session-check");
      await page.unroute("**/api/kernel/owner");
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      await page.setViewportSize({ width: 1280, height: 720 });
      expect(
        await page.evaluate(() =>
          fetch("/api/application").then((response) => response.status),
        ),
      ).toBe(200);
      let upstreamMode = "connected";
      let calls = 0;
      const key = "synthetic-browser-observer-key";
      const position = {
        epoch: "a".repeat(32),
        sequence: 1,
        provenance: "b".repeat(64),
        schema_version: 1,
      };
      const fakeSnapshot = {
        schema_version: 1,
        mode: "execution_gateway",
        resources: [
          {
            identity: {
              resource_id: "resource-a",
              channel: "api",
              provider: "provider-a",
              model: "m".repeat(64),
              variant: null,
              entitlement: "allowed",
            },
            origin: "source",
            enabled: true,
            worker_connected: null,
            observed_at: null,
            freshness: "never_observed",
            health: null,
            availability: "unknown",
            quota_facts: [],
          },
        ],
        sources: [],
        discoveries: [],
      };
      upstream = createHttpServer((request, response) => {
        calls++;
        if (
          request.headers.authorization !== `Bearer ${key}` ||
          upstreamMode === "denied"
        ) {
          response.writeHead(401).end();
          return;
        }
        if (upstreamMode === "disconnected") {
          response.writeHead(503).end();
          return;
        }
        response.setHeader("content-type", "application/json");
        if (request.method === "GET")
          response.end(
            JSON.stringify({
              schema_version: upstreamMode === "unsupported" ? 2 : 1,
              cursor: position,
              snapshot:
                upstreamMode === "hostile"
                  ? {
                      ...fakeSnapshot,
                      resources: [
                        {
                          ...fakeSnapshot.resources[0],
                          identity: {
                            ...fakeSnapshot.resources[0].identity,
                            model: '<img src=x onerror="window.injected=1">',
                          },
                        },
                      ],
                    }
                  : fakeSnapshot,
            }),
          );
        else
          response.end(
            JSON.stringify({
              schema_version: 1,
              cursor: position,
              events: [],
              resync: null,
              resync_reason: null,
              provenance_current: true,
            }),
          );
      });
      await new Promise((resolve, reject) => {
        upstream.once("error", reject);
        upstream.listen(0, "127.0.0.1", resolve);
      });
      writeFileSync(
        join(state, "router.json"),
        JSON.stringify({
          origin: `http://127.0.0.1:${upstream.address().port}`,
          credential: key,
        }),
        { mode: 0o600 },
      );
      await page.reload();
      await page
        .getByText(
          "Configured, but not yet observed. Refresh to request a snapshot.",
        )
        .waitFor();
      expect(calls).toBe(0);
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page
        .getByText(
          "Last Router refresh succeeded. Connectivity and freshness are not continuously monitored; observations are not admission guarantees.",
        )
        .waitFor();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.evaluate(() => window.injected)).toBeUndefined();
      expect(
        await page.evaluate(() =>
          fetch("/api/router").then((response) => response.text()),
        ),
      ).not.toContain(key);
      expect(
        await page.evaluate(() =>
          JSON.stringify({
            local: localStorage,
            session: sessionStorage,
            urls: performance
              .getEntriesByType("resource")
              .map((entry) => entry.name),
          }),
        ),
      ).not.toContain(key);
      const observedCalls = calls;
      await page.route("**/api/kernel/session-check", (route) =>
        route.abort("failed"),
      );
      await page.clock.fastForward(10000);
      await page.getByRole("button", { name: "Retry Router status" }).waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.unroute("**/api/kernel/session-check");
      await page.getByRole("button", { name: "Retry Router status" }).click();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect(calls).toBe(observedCalls);
      await page.route("**/api/kernel/session-check", (route) =>
        route.fulfill({ status: 401, json: { error: "expired" } }),
      );
      await page.clock.fastForward(10000);
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.unroute("**/api/kernel/session-check");
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      upstreamMode = "disconnected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page
        .getByText("Last-known data follows; it may be stale.")
        .waitFor();
      upstreamMode = "denied";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page
        .getByText(
          "Observer access was denied or revoked. Cached facts were cleared.",
        )
        .waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      upstreamMode = "unsupported";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page
        .getByText(
          "The observer response or contract version is unsupported. Cached facts were cleared.",
        )
        .waitFor();
      upstreamMode = "hostile";
      const hostileResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/router/refresh"),
      );
      await page.getByRole("button", { name: "Refresh Router" }).click();
      expect((await hostileResponse).status()).toBe(200);
      expect(await page.evaluate(() => window.injected)).toBeUndefined();
      expect(
        await page
          .getByText('<img src=x onerror="window.injected=1">', {
            exact: false,
          })
          .count(),
      ).toBe(0);
      await stopServer();
      await startServer();
      await page.reload();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      await page.route("**/api/kernel/owner", (route) =>
        route.fulfill({
          json: {
            status: "connected",
            actions: [],
            scope: "synthetic",
            digest: "a".repeat(64),
            text: "synthetic-private-proposal",
          },
        }),
      );
      const other = await page.context().newPage();
      await other.goto(origin);
      await other.getByRole("heading", { name: "Your console" }).waitFor();
      await page.bringToFront();
      await page.reload();
      await page.getByText("synthetic-private-proposal").waitFor();
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        window.visibilityEvents = 0;
        document.addEventListener(
          "visibilitychange",
          () => window.visibilityEvents++,
        );
      });
      await other.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
      });
      await other
        .getByRole("button", { name: "Log out" })
        .evaluate((button) => button.click());
      await other.getByRole("heading", { name: "Sign in" }).waitFor();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(await page.locator("pre").count()).toBe(0);
      expect(await page.evaluate(() => window.visibilityEvents)).toBe(0);
      await other.close();
      await page.unroute("**/api/kernel/owner");
      await page.reload();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(
        await page.evaluate(() =>
          fetch("/api/application").then((response) => response.status),
        ),
      ).toBe(401);
    } finally {
      await browser?.close();
      await stopServer();
      if (upstream?.listening)
        await new Promise((resolve) => upstream.close(resolve));
      rmSync(directory, { recursive: true, force: true });
    }
  },
  180000,
);

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
      await page.getByRole("heading", { name: "Operator overview" }).waitFor();
      await page
        .getByText(/No supported local Kernel snapshot capability/)
        .waitFor();
      await page.getByText("No offline file inspected.").waitFor();
      const remote = await browser.newPage();
      const remoteOrigin = "https://console.example.invalid";
      const remoteUploads = [];
      try {
        await remote.route(`${remoteOrigin}/**`, async (route) => {
          const { pathname } = new URL(route.request().url());
          if (pathname === "/api/session") {
            await route.fulfill({
              json: {
                configured: true,
                authenticated: true,
                miInspectionOrigin: remoteOrigin,
              },
            });
          } else if (pathname.startsWith("/api/mi/inspect-")) {
            remoteUploads.push(pathname);
            await route.fulfill({ json: { status: "rejected" } });
          } else if (pathname.startsWith("/api/")) {
            await route.fulfill({ json: { status: "unavailable" } });
          } else {
            const asset = await fetch(`${origin}${pathname}`);
            await route.fulfill({
              status: asset.status,
              contentType: asset.headers.get("content-type"),
              body: Buffer.from(await asset.arrayBuffer()),
            });
          }
        });
        await remote.goto(remoteOrigin);
        await remote.getByRole("heading", { name: "Your console" }).waitFor();
        const file = {
          name: "synthetic.json",
          mimeType: "application/json",
          buffer: Buffer.from("{}"),
        };
        const empty = remote.locator("#mi-snapshot-file");
        const current = remote.locator("#mi-publication-file");
        const previous = remote.locator("#mi-previous-file");
        if ((await empty.count()) && (await empty.isEnabled())) {
          const sent = remote.waitForResponse("**/api/mi/inspect-empty");
          await empty.setInputFiles(file);
          await sent;
          await remote.getByText(/The file or reference is invalid/).waitFor();
        }
        if ((await current.count()) && (await current.isEnabled())) {
          await remote.locator("#mi-digest").fill("a".repeat(64));
          await remote.locator("#mi-previous-digest").fill("b".repeat(64));
          for (const compare of [false, true]) {
            if (compare) await previous.setInputFiles(file);
            const sent = remote.waitForResponse(
              "**/api/mi/inspect-publication",
            );
            await current.setInputFiles(file);
            await sent;
            await remote
              .getByText(/The file or reference is invalid/)
              .waitFor();
          }
        }
        expect.soft(remoteUploads).toEqual([]);
        expect
          .soft(
            await remote
              .getByText(/Offline MI inspection is unavailable/)
              .count(),
          )
          .toBe(1);
        expect
          .soft(await remote.locator('input[type="file"]:enabled').count())
          .toBe(0);
      } finally {
        await remote.close();
      }
      await page
        .getByText(/Selected files are sent to the authenticated local Console/)
        .waitFor();
      expect(
        await page
          .locator('section[aria-labelledby="mi-snapshot-heading"] p code')
          .first()
          .textContent(),
      ).toBe(origin);
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
      const disclosure = page.getByText(
        "Untrusted evidence records and reported rights",
      );
      await disclosure.click();
      expect(await page.getByText(/synthetic-source/).count()).toBeGreaterThan(
        0,
      );
      expect(await page.evaluate(() => window.miInjected)).toBeUndefined();
      let disclosureCheckStarted;
      let releaseDisclosureCheck;
      const startedDisclosureCheck = new Promise((resolve) => {
        disclosureCheckStarted = resolve;
      });
      const heldDisclosureCheck = new Promise((resolve) => {
        releaseDisclosureCheck = resolve;
      });
      await page.route("**/api/kernel/session-check", async (route) => {
        disclosureCheckStarted();
        await heldDisclosureCheck;
        await route.fallback();
      });
      try {
        await disclosure.focus();
        await page.clock.fastForward(10000);
        await startedDisclosureCheck;
        await disclosure.waitFor({ state: "detached" });
      } finally {
        releaseDisclosureCheck();
      }
      await disclosure.waitFor();
      await page.unroute("**/api/kernel/session-check");
      expect(
        await disclosure.evaluate((node) => ({
          open: node.parentElement.open,
          focused: document.activeElement === node,
        })),
      ).toEqual({ open: true, focused: true });
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
      expect(await disclosure.evaluate((node) => node.parentElement.open)).toBe(
        false,
      );
      await page.reload();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      expect(await page.getByText(/Comparison of supplied files/).count()).toBe(
        0,
      );
      await page.route("**/api/kernel/owner-journal", (route) =>
        route.fulfill({
          json: {
            status: "available",
            commands: [
              {
                commandId: "retained-1",
                scope: "scope-a",
                action: "approve",
                outcome: "unknown",
                approval: {
                  revision: "-1",
                  proposalDigest: "a".repeat(64),
                  scopeDigest: "b".repeat(64),
                  decisionId: '<img src=x onerror="window.journalInjected=1">',
                  requestedExpiry: "9223372036854775807",
                },
                receipt: null,
                canReplay: false,
              },
              {
                commandId: "retained-2",
                scope: "scope-b",
                action: "approve",
                outcome: "historical",
                approval: {
                  revision: "9007199254740993",
                  proposalDigest: "a".repeat(64),
                  scopeDigest: "b".repeat(64),
                  decisionId: "decision-2",
                  requestedExpiry: "9223372036854775807",
                },
                receipt: {
                  kind: "historical-receipt-shape",
                  action: "approve",
                  status: "approved",
                  settlement: null,
                  decisionId: "decision-2",
                  specDigest: "c".repeat(64),
                  effectiveExpiry: "9007199254740993",
                },
                canReplay: false,
              },
            ],
          },
        }),
      );
      await page
        .getByRole("button", { name: "Inspect command history" })
        .click();
      await page.getByText(/Scope: scope-a/).waitFor();
      expect(await page.getByText(/Scope: scope-b/).count()).toBe(1);
      expect(
        await page.getByText("Reviewed revision: 9007199254740993").count(),
      ).toBe(1);
      expect(
        await page
          .getByText("Receipt effective expiry: 9007199254740993")
          .count(),
      ).toBe(1);
      expect(
        await page.getByText(`Receipt spec SHA-256: ${"c".repeat(64)}`).count(),
      ).toBe(1);
      expect(
        await page.locator('[aria-label="Command history"] img').count(),
      ).toBe(0);
      expect(await page.evaluate(() => window.journalInjected)).toBeUndefined();
      expect(
        await page
          .getByRole("button", { name: "Check original receipt" })
          .count(),
      ).toBe(0);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await page.getByText(/Scope: scope-a/).count()).toBe(0);
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.unroute("**/api/kernel/owner-journal");
      const hostile =
        '<img src=x onerror="window.ownerInjected=1">' + "x".repeat(2048);
      let snapshotReads = 0;
      const visitedPages = [];
      let busyLaterPage = true;
      let holdLaterPage = true;
      const sessionCheckPath = "**/api/kernel/session-check";
      let snapshotStatus = "ready";
      await page.route(sessionCheckPath, async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          json: { ...(await response.json()), snapshotStatus },
        });
      });
      const laterRequest = Promise.withResolvers();
      const releaseLaterRequest = Promise.withResolvers();
      await page.route("**/api/kernel/snapshot", async (route) => {
        snapshotReads++;
        const pageNumber = route.request().postDataJSON()?.page ?? 0;
        visitedPages.push(pageNumber);
        if (snapshotStatus === "disconnected")
          return route.fulfill({ json: { status: "disconnected" } });
        if (pageNumber === 10 && busyLaterPage) {
          busyLaterPage = false;
          return route.fulfill({ json: { status: "busy" } });
        }
        if (pageNumber === 10 && holdLaterPage) {
          holdLaterPage = false;
          laterRequest.resolve(route.request().postDataJSON());
          await releaseLaterRequest.promise;
          return route.abort();
        }
        return route.fulfill({
          json: {
            status: "observed",
            snapshot: {
              scope: hostile,
              epoch: "a".repeat(32),
              sequence: "3",
              revision: "4",
              specDigest: "b".repeat(64),
              startPage: pageNumber,
              nextPage: { 0: 3, 3: 8, 8: 10 }[pageNumber] ?? null,
              status: "active",
              history: "gap",
              counts: {
                work_units: { sampled: pageNumber ? 1 : 24, total: 25 },
              },
              workUnits: [
                [hostile, "pending", "Attempt-A", "satisfaction-id"],
                null,
              ],
              attempts: [
                ["Attempt-A", hostile, "prepared", "synthetic-actor"],
                ["Attempt-B", "out-of-window", "prepared", "synthetic-actor"],
              ],
              decisions: [
                {
                  source: "product-review",
                  status: "owner_decision_needed",
                  applicability: "pending",
                  attempt: "Attempt-A",
                  decisionId: "exact-decision",
                },
                {
                  source: "product-review-operation",
                  status: "review_unknown",
                  applicability: "pending",
                  attempt: "attempt-a",
                  decisionId: "unmatched-decision",
                },
                {
                  source: "product-review",
                  status: "owner_decision_needed",
                  applicability: "historical",
                  attempt: "Attempt-A",
                  decisionId: "historical-decision",
                },
              ],
              correlations: [
                {
                  attempt: "Attempt-A",
                  workspaceReference: "file:///synthetic/local",
                  candidateHead: "c".repeat(40),
                  candidateScope: "candidate-scope",
                  runtimeHandlePresent: true,
                },
              ],
              commandCoverage: { sampled: 0, total: 0, complete: true },
            },
          },
        });
      });
      expect(snapshotReads).toBe(0);
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await page.getByText(/Pending owner-decision records: 1\./).waitFor();
      await page
        .getByText(/Pending review records with an unknown outcome: 1\./)
        .waitFor();
      const lineage = page.getByText(
        "Inspect Kernel lineage and recorded evidence",
      );
      const workUnitCoverage = page.getByText(
        "work_units: 25 total; 24 sampled",
      );
      expect(await workUnitCoverage.isVisible()).toBe(false);
      await lineage.press("Enter");
      await page.getByText("exact-decision", { exact: true }).waitFor();
      const linkedUnit = page
        .getByRole("listitem")
        .filter({ hasText: /^Work unit / });
      expect(await linkedUnit.textContent()).toContain("exact-decision");
      expect(await linkedUnit.textContent()).toContain("satisfaction-id");
      expect(await linkedUnit.textContent()).not.toContain(
        "unmatched-decision",
      );
      expect(await linkedUnit.textContent()).not.toContain("out-of-window");
      await page.getByText("unmatched-decision", { exact: true }).waitFor();
      await page.getByText(/Oversized records omitted: 1 work units/).waitFor();
      expect(await page.locator('a[href^="file:"]').count()).toBe(0);
      expect(
        await page
          .locator('section[aria-labelledby="kernel-snapshot-heading"] img')
          .count(),
      ).toBe(0);
      await page.getByText("work_units: 25 total; 24 sampled").waitFor();
      expect
        .soft(
          await page
            .getByText(/Progress continuity for this descriptor: gap/)
            .count(),
        )
        .toBe(1);
      expect(snapshotReads).toBe(1);
      expect(await page.evaluate(() => window.ownerInjected)).toBeUndefined();
      await page.getByRole("button", { name: "Next pages" }).click();
      await lineage.press("Enter");
      await page.getByText("work_units: 25 total; 1 sampled").waitFor();
      await page
        .getByText("Showing up to eight pages starting at producer page 3.")
        .waitFor();
      expect
        .soft(
          await page
            .getByText(/Progress continuity for this descriptor: gap/)
            .count(),
        )
        .toBe(1);
      expect(snapshotReads).toBe(2);
      for (const [button, pageNumber, outcome] of [
        ["Next pages", 8, "observed"],
        ["Next pages", 10, "busy"],
        ["Next pages", 10, "timeout"],
        ["Next pages", 10, "observed"],
        ["Previous pages", 8, "observed"],
      ]) {
        const control = page.getByRole("button", { name: button });
        if (outcome === "timeout") {
          await control.focus();
          await control.press("Enter");
          try {
            expect(await laterRequest.promise).toEqual({
              page: 10,
              epoch: "a".repeat(32),
              sequence: "3",
            });
            await page.clock.fastForward(15000);
            await page.getByText(/Kernel snapshot read timed out/).waitFor();
            expect(await control.isEnabled()).toBe(true);
            expect(await page.getByText("Sampled work units").count()).toBe(0);
          } finally {
            releaseLaterRequest.resolve();
          }
          continue;
        }
        const sampled = page.waitForResponse(
          (response) => response.url().endsWith("/api/kernel/snapshot"),
          { timeout: 3000 },
        );
        await control.focus();
        await control.press("Enter");
        await sampled;
        expect.soft(visitedPages.at(-1)).toBe(pageNumber);
        if (outcome === "busy") {
          await page
            .getByText(/Another snapshot read is in progress/)
            .waitFor();
        } else
          await page
            .getByText(/Showing up to eight pages starting at producer page/)
            .waitFor();
        expect
          .soft(await page.evaluate(() => document.activeElement?.textContent))
          .toBe(button);
      }
      const previousPages = page.getByRole("button", {
        name: "Previous pages",
      });
      await previousPages.focus();
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
      expect(
        await previousPages.evaluate((node) => document.activeElement === node),
      ).toBe(true);
      expect(await page.getByText("Sampled work units").count()).toBe(0);
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await lineage.press("Enter");
      await page.getByText("work_units: 25 total; 24 sampled").waitFor();
      await page.evaluate(async () => {
        window.releaseOldKernelCheck();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        await page.getByText("work_units: 25 total; 24 sampled").count(),
      ).toBe(1);
      const readsBeforeClosure = snapshotReads;
      snapshotStatus = "disconnected";
      await page.clock.fastForward(10000);
      const unavailable = page.getByText(
        "The configured Kernel snapshot channel is closed.",
      );
      await unavailable.waitFor({ timeout: 3000 });
      expect(await page.getByText("Sampled work units").count()).toBe(0);
      expect(snapshotReads).toBe(readsBeforeClosure);
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await unavailable.waitFor();
      expect(snapshotReads).toBe(readsBeforeClosure + 1);
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      snapshotStatus = "ready";
      await page.route("**/api/kernel/session-check", (route) =>
        route.fulfill({ status: 401, json: { error: "Login required" } }),
      );
      await page.getByRole("button", { name: "Read snapshot" }).click();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(
        await page.getByText("work_units: 25 total; 24 sampled").count(),
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
      let ownerContended = true;
      await page.route("**/api/kernel/owner", (route) => {
        proposalReads++;
        if (ownerContended)
          return route.fulfill({
            status: 503,
            json: { error: "Kernel read busy" },
          });
        return route.fulfill({
          json: {
            status: "connected",
            actions: ["approve"],
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
        .getByText(/Kernel proposal unavailable|Kernel read busy/)
        .waitFor();
      ownerContended = false;
      const retryProposal = page.getByRole("button", {
        name: "Retry Kernel proposal",
      });
      await retryProposal.click();
      await page
        .getByText(
          "Verified proposal received when this view opened; it may have changed. Reload to recheck. Approval requires a fresh review.",
        )
        .waitFor();
      expect(await page.locator("pre").textContent()).toBe(hostile);
      expect(await page.locator("pre img").count()).toBe(0);
      expect(await page.evaluate(() => window.ownerInjected)).toBeUndefined();
      await page.unroute("**/api/kernel/approval-scope");
      await page.route("**/api/kernel/approval-scope", (route) =>
        route.fulfill({
          json: {
            status: "connected",
            scope: hostile,
            digest: "b".repeat(64),
            proposalDigest: "c".repeat(64),
            text: "unmatched producer data",
          },
        }),
      );
      await page
        .getByRole("button", { name: "Inspect approval scope" })
        .click();
      await page.getByText(/Approval scope unavailable/).waitFor();
      expect(await page.getByText("unmatched producer data").count()).toBe(0);
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
      await page.route("**/api/kernel/approval-scope", (route) =>
        route.fulfill({
          json: {
            status: "connected",
            scope: hostile,
            digest: "b".repeat(64),
            proposalDigest: "a".repeat(64),
            text: hostile,
          },
          headers: { "cache-control": "no-store" },
        }),
      );
      await page
        .getByRole("button", { name: "Inspect approval scope" })
        .click();
      await page.getByText(/Approval scope received/).waitFor();
      expect(await page.locator("pre").count()).toBe(2);
      expect(await page.locator("pre img").count()).toBe(0);
      expect(await page.evaluate(() => window.ownerInjected)).toBeUndefined();
      let approvals = 0;
      await page.route("**/api/kernel/owner-review", (route) =>
        route.fulfill({
          json: {
            review: "f".repeat(64),
            scope: hostile,
            proposalDigest: "a".repeat(64),
            scopeDigest: "b".repeat(64),
            revision: "-1",
            status: "absent",
            approvalExpiry: "2000000000",
            text: hostile,
          },
        }),
      );
      await page.route("**/api/kernel/owner", (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        approvals++;
        expect(route.request().postDataJSON()).toEqual({
          action: "approve",
          review: "f".repeat(64),
        });
        if (approvals === 1)
          return route.fulfill({ status: 503, json: { kind: "not-sent" } });
        return route.fulfill({ json: { kind: "unknown" } });
      });
      await page.getByLabel("Requested producer expiry").fill("2000000000");
      await page.getByRole("button", { name: "Review exact approval" }).click();
      await page.getByText(/Review these exact values/).waitFor();
      expect(await page.locator("pre img").count()).toBe(0);
      expect(await page.getByText(/Observed revision: -1/).count()).toBe(1);
      await page.getByRole("button", { name: "Confirm approval" }).click();
      await page.getByText(/No approval was sent/).waitFor();
      expect(await page.getByText(/Approval outcome.*unknown/).count()).toBe(0);
      await page.getByRole("button", { name: "Review exact approval" }).click();
      await page.getByRole("button", { name: "Confirm approval" }).click();
      await page.getByText(/Approval outcome is unknown/).waitFor();
      expect(approvals).toBe(2);
      await page.route("**/api/kernel/owner-journal", (route) =>
        route.fulfill({
          json: {
            status: "available",
            commands: [
              {
                commandId: "synthetic-command",
                scope: hostile,
                action: "approve",
                outcome: "unknown",
                approval: {
                  revision: "-1",
                  proposalDigest: "a".repeat(64),
                  scopeDigest: "b".repeat(64),
                  decisionId: "decision",
                  requestedExpiry: "2000000000",
                },
                receipt: null,
                canReplay: true,
              },
            ],
          },
        }),
      );
      await page
        .getByRole("button", { name: "Inspect command history" })
        .click();
      await page.getByText(/outcome unknown; do not retry blindly/).waitFor();
      await page.route("**/api/kernel/owner-replay", (route) => {
        expect(route.request().postDataJSON()).toEqual({
          commandId: "synthetic-command",
        });
        return route.fulfill({ json: { kind: "historical-receipt-shape" } });
      });
      await page
        .getByRole("button", { name: "Check original receipt" })
        .click();
      await page.getByText(/A historical receipt was returned/).waitFor();
      await page.clock.fastForward(10000);
      await page.getByText(/Approval scope received/).waitFor();
      expect(await page.locator("pre").count()).toBe(2);
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
      expect(proposalReads).toBe(2);
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
      let heldRefresh;
      const holdRouterRefresh = () =>
        new Promise((resolve) => {
          heldRefresh = resolve;
        });
      upstream = createHttpServer((request, response) => {
        calls++;
        if (upstreamMode === "hold") {
          heldRefresh(response);
          return;
        }
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
      await page.evaluate(() => {
        const actualFetch = window.fetch;
        window.fetch = async (input, options) => {
          const response = await actualFetch(input, options);
          if (input === "/api/router/refresh") {
            await response.json();
            window.fetch = actualFetch;
            throw new Error("Synthetic lost first refresh reply");
          }
          return response;
        };
      });
      await page.getByRole("button", { name: "Refresh Router" }).click();
      const routerObservation = page.getByText("Inspect Router observations");
      await routerObservation.waitFor();
      expect(
        await page.getByText("m".repeat(64), { exact: false }).isVisible(),
      ).toBe(false);
      await routerObservation.press("Enter");
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect
        .soft(await page.getByText(/Last-known data follows/).count())
        .toBe(0);
      if (await page.getByText(/Last-known data follows/).count())
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
      // A second Console client invalidates the prior observation while the
      // refresh caller is still waiting on its final authenticated read.
      await page.evaluate(() => {
        const original = window.fetch;
        let refreshed = false;
        window.fetch = async (...args) => {
          if (args[0] === "/api/router/refresh") {
            const response = await original(...args);
            refreshed = true;
            return response;
          }
          if (refreshed && args[0] === "/api/router") {
            await new Promise((resolve) => {
              window.releaseRouterPublication = () => {
                window.fetch = original;
                resolve();
              };
            });
          }
          return original(...args);
        };
      });
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.waitForFunction(() =>
        Boolean(window.releaseRouterPublication),
      );
      upstreamMode = "denied";
      const otherClient = await page
        .context()
        .request.post(`${origin}/api/router/refresh`, {
          headers: { origin },
          data: {},
        });
      expect((await otherClient.json()).status).toBe("denied");
      await page.evaluate(() => window.releaseRouterPublication());
      await page
        .getByRole("button", { name: "Refresh Router", exact: true })
        .waitFor();
      expect
        .soft(await page.getByText(/Observer access was denied/).count())
        .toBe(1);
      expect
        .soft(await page.getByText("resource-a", { exact: false }).count())
        .toBe(0);

      upstreamMode = "connected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      const beforeFailedRecovery = calls;
      await page.route("**/api/router/refresh", (route) =>
        route.abort("failed"),
      );
      await page.route("**/api/router", (route) => route.abort("failed"));
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByRole("button", { name: "Retry Router status" }).waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.unroute("**/api/router/refresh");
      await page.unroute("**/api/router");
      await page.clock.fastForward(10001);
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect
        .soft(await page.getByText(/Last-known data follows/).count())
        .toBe(1);
      expect(calls).toBe(beforeFailedRecovery);
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByText(/Last Router refresh succeeded/).waitFor();
      // Hold an already sampled response across a newer authenticated view.
      // The synthetic delivery ignores HTTP abort so the browser's fence is tested.
      await page.evaluate(() => {
        const original = window.fetch;
        window.fetch = async (input, options) => {
          const response = await original(input, options);
          if (input !== "/api/router") return response;
          window.fetch = original;
          const previous = new Response(await response.text());
          return new Promise((resolve) => {
            window.deliverOldRouterView = () => resolve(previous);
          });
        };
      });
      await page.clock.fastForward(10001);
      await page.waitForFunction(() => Boolean(window.deliverOldRouterView));
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      upstreamMode = "denied";
      expect(
        (
          await (
            await page.context().request.post(`${origin}/api/router/refresh`, {
              headers: { origin },
              data: {},
            })
          ).json()
        ).status,
      ).toBe("denied");
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.getByText(/Observer access was denied/).waitFor();
      await page.evaluate(async () => {
        window.deliverOldRouterView();
        await Promise.resolve();
      });
      expect(await page.getByText(/Observer access was denied/).count()).toBe(
        1,
      );
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      upstreamMode = "connected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByText(/Last Router refresh succeeded/).waitFor();
      const reconciledCalls = calls;
      const refreshControl = page.getByRole("button", {
        name: "Refresh Router",
      });
      await page.evaluate(() => {
        const fetch = window.fetch;
        window.routerPassiveCheckHeld = false;
        window.fetch = (...args) =>
          args[0] === "/api/router"
            ? new Promise((resolve) => {
                window.routerPassiveCheckHeld = true;
                window.releaseRouterPassiveCheck = () => {
                  window.fetch = fetch;
                  resolve(fetch(...args));
                };
              })
            : fetch(...args);
      });
      await refreshControl.focus();
      await page.clock.fastForward(10000);
      await page.waitForFunction(() => window.routerPassiveCheckHeld);
      expect
        .soft(await page.evaluate(() => document.activeElement.textContent))
        .toBe("Refresh Router");
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.evaluate(() => window.releaseRouterPassiveCheck());
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect
        .soft(
          await refreshControl.evaluate(
            (node) => document.activeElement === node,
          ),
        )
        .toBe(true);
      await page.route("**/api/router", (route) => route.abort("failed"));
      await page.clock.fastForward(10000);
      await page.getByRole("button", { name: "Retry Router status" }).waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.unroute("**/api/router");
      const recovery = page.waitForResponse(`${origin}/api/router`, {
        timeout: 2500,
      });
      await page.clock.fastForward(10000);
      const recovered = await recovery;
      expect(recovered.status()).toBe(200);
      expect(await recovered.headerValue("set-cookie")).toBeNull();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect(calls).toBe(reconciledCalls);
      await page.route("**/api/router", (route) =>
        route.fulfill({ status: 401, json: { error: "expired" } }),
      );
      await page.clock.fastForward(10000);
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      await page.unroute("**/api/router");
      await page
        .getByLabel("Owner password", { exact: true })
        .fill("synthetic-owner-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      await routerObservation.press("Enter");
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      upstreamMode = "disconnected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page
        .getByText("Last-known data follows; it may be stale.")
        .waitFor();
      const beforeTimeouts = calls;
      const cachedDisconnect = page.waitForResponse(`${origin}/api/router`);
      await page.clock.fastForward(10000);
      expect((await (await cachedDisconnect).json()).status).toBe(
        "disconnected",
      );
      await page
        .getByText("Last-known data follows; it may be stale.")
        .waitFor();
      expect(calls).toBe(beforeTimeouts);
      await page.evaluate(() => {
        const original = window.fetch;
        window.routerTimeouts = 0;
        window.restoreRouterFetch = () => {
          window.fetch = original;
        };
        window.fetch = (input, options) => {
          if (input !== "/api/router/refresh") return original(input, options);
          window.routerTimeouts++;
          return new Promise((_, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(options.signal.reason),
              { once: true },
            );
          });
        };
      });
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.waitForFunction(() => window.routerTimeouts === 1);
      await page.clock.fastForward(10001);
      await page
        .getByText("Last-known data follows; it may be stale.")
        .waitFor({ timeout: 3000 });
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      expect(calls).toBe(beforeTimeouts);
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.waitForFunction(() => window.routerTimeouts === 2);
      upstreamMode = "denied";
      const denied = await page.request.post(`${origin}/api/router/refresh`, {
        headers: { origin },
        data: {},
      });
      expect((await denied.json()).status).toBe("denied");
      const deniedCalls = calls;
      await page.clock.fastForward(10001);
      await page
        .getByText(
          "Observer access was denied or revoked. Cached facts were cleared.",
        )
        .waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      expect(calls).toBe(deniedCalls);
      await page.evaluate(() => window.restoreRouterFetch());
      upstreamMode = "connected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      // The real POST reaches Console, but the browser stops waiting before
      // the synthetic producer replies. The recovery GET still has old facts.
      for (const finalStatus of ["connected", "denied"]) {
        const heldRouterRefresh = holdRouterRefresh();
        upstreamMode = "hold";
        await page.evaluate(() => {
          const original = window.fetch;
          window.routerRefreshWaiting = false;
          window.restoreRouterFetch = () => {
            window.fetch = original;
          };
          window.fetch = (input, options) => {
            if (input !== "/api/router/refresh")
              return original(input, options);
            window.routerRefreshWaiting = true;
            return new Promise((_, reject) =>
              options.signal.addEventListener(
                "abort",
                () => reject(options.signal.reason),
                { once: true },
              ),
            );
          };
        });
        await page.getByRole("button", { name: "Refresh Router" }).click();
        await page.waitForFunction(() => window.routerRefreshWaiting, {
          timeout: 3000,
        });
        const refreshResponse = page.request.post(
          `${origin}/api/router/refresh`,
          {
            headers: { origin },
            data: {},
            timeout: 5000,
          },
        );
        const heldResponse = await Promise.race([
          heldRouterRefresh,
          refreshResponse.then(() => {
            throw new Error("Refresh was not held by the fixture");
          }),
        ]);
        const delayedCalls = calls;
        try {
          await page.clock.fastForward(10001);
          // Re-establish a cached nonempty view before delivering delayed denial.
          await page
            .getByText("Last-known data follows; it may be stale.")
            .waitFor({ timeout: 3000 });
          await page
            .getByText("m".repeat(64), { exact: false })
            .waitFor({ timeout: 3000 });
        } finally {
          if (finalStatus === "denied") heldResponse.writeHead(401).end();
          else
            heldResponse
              .writeHead(200, { "content-type": "application/json" })
              .end(
                JSON.stringify({
                  schema_version: 1,
                  cursor: position,
                  events: [],
                  resync: null,
                  resync_reason: null,
                  provenance_current: true,
                }),
              );
        }
        expect((await (await refreshResponse).json()).status).toBe(finalStatus);
        await page.clock.fastForward(10001);
        if (finalStatus === "connected") {
          await page
            .getByText(/Last Router refresh succeeded/)
            .waitFor({ timeout: 3000 });
          await page
            .getByText("m".repeat(64), { exact: false })
            .waitFor({ timeout: 3000 });
        } else {
          await page
            .getByText(
              "Observer access was denied or revoked. Cached facts were cleared.",
            )
            .waitFor({ timeout: 3000 });
          expect(
            await page.getByText("resource-a", { exact: false }).count(),
          ).toBe(0);
        }
        expect(calls).toBe(delayedCalls);
        await page.evaluate(() => window.restoreRouterFetch());
      }
      upstreamMode = "connected";
      await page.getByRole("button", { name: "Refresh Router" }).click();
      await page.getByText("m".repeat(64), { exact: false }).waitFor();
      const beforeInvalid = calls;
      const configPath = join(state, "router.json");
      const validConfig = readFileSync(configPath);
      writeFileSync(configPath, "invalid");
      await page.clock.fastForward(10001);
      await page
        .getByText(
          "The local Router configuration is invalid or has unsafe permissions.",
        )
        .waitFor();
      expect(await page.getByText("resource-a", { exact: false }).count()).toBe(
        0,
      );
      expect(calls).toBe(beforeInvalid);
      writeFileSync(configPath, validConfig);
      const retryConfig = page.getByRole("button", {
        name: "Retry Router status",
      });
      await retryConfig.click();
      await page
        .getByText(
          "Configured, but not yet observed. Refresh to request a snapshot.",
        )
        .waitFor();
      expect(calls).toBe(beforeInvalid);
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

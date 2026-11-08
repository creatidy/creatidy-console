import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      const page = await browser.newPage();
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
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      expect(
        await page.evaluate(() =>
          fetch("/api/application").then((response) => response.status),
        ),
      ).toBe(200);
      await stopServer();
      await startServer();
      await page.reload();
      await page.getByRole("heading", { name: "Your console" }).waitFor();
      await page.getByRole("button", { name: "Log out" }).click();
      await page.getByRole("heading", { name: "Sign in" }).waitFor();
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
      rmSync(directory, { recursive: true, force: true });
    }
  },
  180000,
);

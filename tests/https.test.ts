import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createApp } from "../server/app.ts";
import { openState } from "../server/state.ts";

it.each(["127.0.0.1", "console.example.invalid"])(
  "requires trusted TLS and enforces offline inspection topology for %s",
  async (hostname) => {
    const directory = mkdtempSync(join(tmpdir(), "console-tls-"));
    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      const keyPath = join(directory, "key.pem");
      const certPath = join(directory, "cert.pem");
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
          "subjectAltName=IP:127.0.0.1,DNS:console.example.invalid",
        ],
        {
          env: { PATH: process.env.PATH ?? "", HOME: directory },
          stdio: "ignore",
        },
      );
      expect(generated.status).toBe(0);
      const cert = readFileSync(certPath);
      const stateDir = join(directory, "state");
      const assets = join(directory, "assets");
      mkdirSync(assets);
      writeFileSync(
        join(assets, "index.html"),
        "<!doctype html><title>fixture</title>",
      );
      const state = openState(stateDir);
      const token = "synthetic-tls-bootstrap";
      state.db
        .prepare("INSERT INTO settings (name, value) VALUES ('bootstrap', ?)")
        .run(
          JSON.stringify({
            digest: createHash("sha256").update(token).digest("hex"),
            expires: Date.now() + 60_000,
          }),
        );
      state.db.close();
      const origin = `https://${hostname}:4443`;
      app = await createApp({
        stateDirectory: stateDir,
        staticDirectory: assets,
        origin,
        tls: { cert, key: readFileSync(keyPath) },
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const address = app.server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test listener");
      const post = (path: string, payload: object, trusted: boolean) =>
        new Promise<{ status: number | undefined; cookie: string }>(
          (resolve, reject) => {
            const req = request(
              {
                hostname: "127.0.0.1",
                port: address.port,
                path,
                method: "POST",
                ...(trusted ? { ca: cert } : {}),
                headers: {
                  host: `${hostname}:4443`,
                  origin,
                  "content-type": "application/json",
                },
              },
              (res) => {
                res.resume();
                res.on("end", () =>
                  resolve({
                    status: res.statusCode,
                    cookie: res.headers["set-cookie"]?.join(";") ?? "",
                  }),
                );
              },
            );
            req.on("error", reject);
            req.end(JSON.stringify(payload));
          },
        );
      await expect(
        post("/api/login", { password: "synthetic-password" }, false),
      ).rejects.toThrow();
      expect(
        (
          await post(
            "/api/bootstrap",
            { token, password: "synthetic-password" },
            true,
          )
        ).status,
      ).toBe(200);
      const login = await post(
        "/api/login",
        { password: "synthetic-password" },
        true,
      );
      expect(login.status).toBe(200);
      expect(login.cookie).toMatch(/^__Host-console=/);
      expect(login.cookie).toContain("Secure");
      expect(login.cookie).toContain("HttpOnly");
      expect(login.cookie).toContain("SameSite=Strict");
      expect(login.cookie).not.toContain("Domain=");
      for (const [url, payload] of [
        ["/api/mi/inspect-empty", { text: "{}" }],
        ["/api/mi/inspect-publication", { text: "{}", expected: {} }],
        [
          "/api/mi/inspect-publication",
          { text: "{}", expected: {}, previous: { text: "{}", expected: {} } },
        ],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url,
          payload,
          headers: {
            host: `${hostname}:4443`,
            origin,
            cookie: login.cookie.split(";")[0],
            "content-type": "application/json",
          },
        });
        expect(response.statusCode).toBe(hostname === "127.0.0.1" ? 200 : 403);
      }
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

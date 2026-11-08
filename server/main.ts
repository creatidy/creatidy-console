import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
  throw new Error("Custom native library paths are not supported");
}
const { createApp } = await import("./app.ts");

const origin = process.env.CONSOLE_ORIGIN ?? "http://127.0.0.1:4173";
const url = new URL(origin);
const bind = process.env.CONSOLE_BIND_HOST ?? "127.0.0.1";
if (url.protocol === "http:" && !["127.0.0.1", "::1"].includes(bind)) {
  throw new Error("HTTP binding must be loopback");
}
const stateDirectory =
  process.env.CONSOLE_STATE_DIR ??
  join(homedir(), ".local", "share", "creatidy-console");
const tls =
  url.protocol === "https:" &&
  process.env.CONSOLE_TLS_KEY &&
  process.env.CONSOLE_TLS_CERT
    ? {
        key: readFileSync(process.env.CONSOLE_TLS_KEY),
        cert: readFileSync(process.env.CONSOLE_TLS_CERT),
      }
    : undefined;
const app = await createApp({
  stateDirectory,
  origin,
  ...(process.env.CONSOLE_STATIC_DIR
    ? { staticDirectory: process.env.CONSOLE_STATIC_DIR }
    : {}),
  ...(tls ? { tls } : {}),
});
await app.listen({
  host: bind,
  port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
});
console.log(`Creatidy Console listening at ${url.origin}`);

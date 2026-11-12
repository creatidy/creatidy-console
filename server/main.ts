import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { AppOptions } from "./app.ts";

let kernelOwner: AppOptions["kernelOwner"];
let app: Awaited<ReturnType<typeof import("./app.ts").createApp>> | undefined;
try {
  if (process.env.CONSOLE_KERNEL_OWNER === "1") {
    if (
      process.platform !== "linux" ||
      process.execArgv.length !== 0 ||
      process.argv.length !== 3
    )
      throw new Error("Invalid owner launch configuration");
    const value = process.argv[2];
    if (!value || !/^[1-9][0-9]*$/.test(value))
      throw new Error("Invalid owner launch descriptor");
    const fd = Number(value);
    if (!Number.isSafeInteger(fd) || fd < 3 || fd > 2147483647)
      throw new Error("Invalid owner launch descriptor");
    const require = createRequire(import.meta.url);
    const native = require("../.cache/native/owner-receiver.node") as {
      receive: (descriptor: number) => void;
    };
    native.receive(fd);
    const { receiveInheritedOwnerChannel } =
      await import("./kernel-owner-receiver.ts");
    const { createLocalOwnerTransport } =
      await import("./kernel-owner-transport.ts");
    const scope = process.env.CONSOLE_KERNEL_OWNER_SCOPE ?? "";
    const socket = await receiveInheritedOwnerChannel(fd, {
      scope,
      producer: process.env.CONSOLE_KERNEL_OWNER_PRODUCER ?? "",
      recipient: process.env.CONSOLE_KERNEL_OWNER_RECIPIENT ?? "",
    });
    const transport = createLocalOwnerTransport(socket, scope);
    kernelOwner = {
      scope,
      readProposal: transport.readProposal,
      close: transport.close,
    };
  } else if (process.env.CONSOLE_KERNEL_OWNER !== undefined) {
    throw new Error("Invalid owner launch configuration");
  }

  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    throw new Error("Custom native library paths are not supported");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("TLS verification must not be disabled");
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
  app = await createApp({
    stateDirectory,
    origin,
    ...(process.env.CONSOLE_STATIC_DIR
      ? { staticDirectory: process.env.CONSOLE_STATIC_DIR }
      : {}),
    ...(tls ? { tls } : {}),
    ...(kernelOwner ? { kernelOwner } : {}),
  });
  await app.listen({
    host: bind,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  });
  console.log(`Creatidy Console listening at ${url.origin}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      kernelOwner?.close();
      void app?.close().finally(() => {
        process.exitCode = 0;
      });
    });
  }
} catch (error) {
  kernelOwner?.close();
  await app?.close();
  throw error;
}

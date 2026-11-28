import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

export interface RouterConfig {
  origin: string;
  credential: string;
  fileRevision: string;
  adminConfirmed: boolean;
}

export const ROUTER_ADMIN_PROFILE = "local-admin-v1";

export function validateRouterOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("Router origin must be an exact loopback IP origin");
  }
  return url.origin;
}

export function readRouterConfig(directory: string): RouterConfig | null {
  const maxBytes = 16384;
  let fd: number;
  try {
    fd = openSync(
      join(directory, "router.json"),
      // A FIFO must not block the event loop before fstat can reject it.
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const info = fstatSync(fd, { bigint: true });
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      info.size > BigInt(maxBytes) ||
      (info.mode & 0o077n) !== 0n ||
      (process.getuid && info.uid !== BigInt(process.getuid()))
    )
      throw new Error("Unsafe Router configuration");
    // Enforce the byte limit at read time too, in case the file grew after fstat.
    const bytes = Buffer.alloc(maxBytes + 1);
    let end = 0;
    while (end < bytes.length) {
      const count = readSync(fd, bytes, end, bytes.length - end, null);
      if (count === 0) break;
      end += count;
    }
    if (end > maxBytes) throw new Error("Unsafe Router configuration");
    const config = JSON.parse(
      bytes.toString("utf8", 0, end),
    ) as Partial<RouterConfig> & { adminProfile?: unknown };
    if (
      typeof config.origin !== "string" ||
      typeof config.credential !== "string" ||
      !/^[\x21-\x7e]{16,4096}$/.test(config.credential)
    )
      throw new Error("Invalid Router configuration");
    return {
      origin: validateRouterOrigin(config.origin),
      credential: config.credential,
      adminConfirmed: config.adminProfile === ROUTER_ADMIN_PROFILE,
      // Bind the observation to the opened file, not just its contents.
      fileRevision: `${info.dev}:${info.ino}:${info.ctimeNs}`,
    };
  } finally {
    closeSync(fd);
  }
}

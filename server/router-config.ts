import {
  constants,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";

export interface RouterConfig {
  origin: string;
  credential: string;
  fileRevision: string;
}

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
  let fd: number;
  try {
    fd = openSync(
      join(directory, "router.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
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
      info.size > 16384n ||
      (info.mode & 0o077n) !== 0n ||
      (process.getuid && info.uid !== BigInt(process.getuid()))
    )
      throw new Error("Unsafe Router configuration");
    const config = JSON.parse(
      readFileSync(fd, "utf8"),
    ) as Partial<RouterConfig>;
    if (
      typeof config.origin !== "string" ||
      typeof config.credential !== "string" ||
      !/^[\x21-\x7e]{16,4096}$/.test(config.credential)
    )
      throw new Error("Invalid Router configuration");
    return {
      origin: validateRouterOrigin(config.origin),
      credential: config.credential,
      // Bind the observation to the opened file, not just its contents.
      fileRevision: `${info.dev}:${info.ino}:${info.ctimeNs}`,
    };
  } finally {
    closeSync(fd);
  }
}

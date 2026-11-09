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
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 16384 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
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
    };
  } finally {
    closeSync(fd);
  }
}

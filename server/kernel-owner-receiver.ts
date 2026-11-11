import { closeSync } from "node:fs";
import { Socket } from "node:net";
import { validateOwnerGreeting } from "./kernel-owner-greeting.ts";

// The native receiver has already taken ownership and protected this descriptor.
// This stage deliberately closes the capability after validating the greeting.
export async function validateInheritedOwnerChannel(
  fd: number,
  expected: { scope: string; producer: string; recipient: string },
  timeoutMs = 5000,
) {
  let socket: Socket;
  try {
    socket = new Socket({ fd, readable: true, writable: true });
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      /* Already closed. */
    }
    throw error;
  }
  try {
    const frame = await new Promise<Buffer>((resolve, reject) => {
      let length: number | undefined;
      let header: Buffer | undefined;
      const timer = setTimeout(
        () => reject(new Error("Owner greeting timeout")),
        timeoutMs,
      );
      const fail = () => reject(new Error("Owner greeting channel closed"));
      const read = () => {
        if (!header) {
          const part = socket.read(4) as Buffer | null;
          if (!part) return;
          if (part.length !== 4) {
            reject(new Error("Invalid owner greeting size"));
            return;
          }
          header = part;
          length = part.readUInt32BE();
          if (length < 1 || length > 65536) {
            reject(new Error("Invalid owner greeting size"));
            return;
          }
        }
        const payload = socket.read(length) as Buffer | null;
        if (payload) resolve(Buffer.concat([header, payload]));
      };
      socket.on("readable", read);
      socket.once("end", fail);
      socket.once("error", fail);
      socket.once("close", fail);
      socket.once("close", () => clearTimeout(timer));
      read();
    });
    validateOwnerGreeting(frame, expected);
  } finally {
    if (!socket.closed) {
      await new Promise<void>((resolve) => {
        socket.once("close", resolve);
        socket.destroy();
      });
    }
  }
}

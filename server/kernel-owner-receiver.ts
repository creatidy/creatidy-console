import { closeSync } from "node:fs";
import { Socket } from "node:net";
import { validateOwnerGreeting } from "./kernel-owner-greeting.ts";

// The native receiver has already taken ownership and protected this descriptor.
export async function receiveInheritedOwnerChannel(
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
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("readable", read);
        socket.off("end", fail);
        socket.off("error", fail);
        socket.off("close", fail);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Owner greeting timeout"));
      }, timeoutMs);
      const fail = () => {
        cleanup();
        reject(new Error("Owner greeting channel closed"));
      };
      const read = () => {
        if (!header) {
          const part = socket.read(4) as Buffer | null;
          if (!part) return;
          if (part.length !== 4) {
            cleanup();
            reject(new Error("Invalid owner greeting size"));
            return;
          }
          header = part;
          length = part.readUInt32BE();
          if (length < 1 || length > 65536) {
            cleanup();
            reject(new Error("Invalid owner greeting size"));
            return;
          }
        }
        const payload = socket.read(length) as Buffer | null;
        if (payload) {
          cleanup();
          resolve(Buffer.concat([header, payload]));
        }
      };
      socket.on("readable", read);
      socket.once("end", fail);
      socket.once("error", fail);
      socket.once("close", fail);
      read();
    });
    validateOwnerGreeting(frame, expected);
    if (socket.destroyed || socket.readableLength !== 0)
      throw new Error("Invalid owner greeting channel");
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

export async function validateInheritedOwnerChannel(
  fd: number,
  expected: { scope: string; producer: string; recipient: string },
  timeoutMs = 5000,
) {
  const socket = await receiveInheritedOwnerChannel(fd, expected, timeoutMs);
  await new Promise<void>((resolve) => {
    socket.once("close", resolve);
    socket.destroy();
  });
}

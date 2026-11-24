// Shared by the server and browser; this module has no Node dependencies.
export const isLoopbackListener = (host: string) =>
  host === "127.0.0.1" || host === "::1";

export const isLoopbackOrigin = (url: URL) =>
  ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);

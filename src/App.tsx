import { useEffect, useRef, useState, type FormEvent } from "react";
import RouterPanel from "./RouterPanel";
import KernelOwnerPanel from "./KernelOwnerPanel";

type Session = { configured: boolean; authenticated: boolean };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);

  function invalidate(broadcast: boolean) {
    generation.current++;
    setSession({ configured: true, authenticated: false });
    setError("Your session expired or was revoked. Sign in again.");
    if (broadcast) {
      try {
        channel.current?.postMessage(null);
      } catch {
        /* Periodic checks remain the fallback. */
      }
    }
  }

  async function refresh() {
    const current = generation.current;
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as Session;
      if (current !== generation.current) return;
      setSession(result);
      setError("");
    } catch {
      if (current !== generation.current) return;
      setSession(null);
      setError(
        "Console is disconnected. Check that the application server is running.",
      );
    }
  }

  useEffect(() => {
    try {
      channel.current = new BroadcastChannel("creatidy-console-session-v1");
      channel.current.onmessage = (event) => {
        if (event.data === null) invalidate(false);
      };
    } catch {
      // Periodic session checks remain the fallback.
    }
    void refresh();
    return () => {
      channel.current?.close();
      channel.current = null;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    const current = generation.current;
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const setup = !session?.configured;
    if (setup && data.get("password") !== data.get("confirmation")) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(setup ? "/api/bootstrap" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: data.get("password"),
          ...(setup ? { token: data.get("token") } : {}),
        }),
      });
      form.reset();
      if (current !== generation.current) return;
      if (!response.ok) {
        setError(
          response.status === 429
            ? "Too many attempts. Wait before trying again."
            : "Setup or login was not accepted. Check your details and try again.",
        );
      } else {
        await refresh();
      }
    } catch {
      setError(
        "Could not reach Console. Check the application server and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    generation.current++;
    setPending(true);
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (response.status === 401) {
        invalidate(true);
        return;
      }
      if (!response.ok) throw new Error();
      invalidate(true);
    } catch {
      setError("Logout could not be confirmed. Check the server connection.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">CREATIDY / CONSOLE</p>
      <h1>
        {session?.authenticated
          ? "Your console"
          : session?.configured
            ? "Sign in"
            : "Set up your console"}
      </h1>
      {error && <p role="alert">{error}</p>}
      {!session ? (
        <div>
          <p>Checking the local application session.</p>
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : session.authenticated ? (
        <section>
          <RouterPanel
            expired={() => {
              invalidate(true);
            }}
          />
          {!pending && (
            <KernelOwnerPanel
              expired={() => {
                invalidate(true);
              }}
            />
          )}
          <p>Model Intelligence is not configured by this view.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void logout()}
          >
            Log out
          </button>
        </section>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {session.configured && (
            <p>
              Sign in to continue. A session may have expired or been revoked.
            </p>
          )}
          {!session.configured && (
            <>
              <p>
                Run the local bootstrap command and enter the authority from the
                protected token file.
              </p>
              <label htmlFor="token">Setup authority</label>
              <input id="token" name="token" autoComplete="off" required />
            </>
          )}
          <label htmlFor="password">Owner password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={
              session.configured ? "current-password" : "new-password"
            }
            minLength={session.configured ? undefined : 12}
            maxLength={1024}
            required
          />
          {!session.configured && (
            <>
              <p>
                Use at least 12 characters. The password is stored only as a
                one-way hash.
              </p>
              <label htmlFor="confirmation">Confirm owner password</label>
              <input
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
              />
            </>
          )}
          <button type="submit" disabled={pending}>
            {pending
              ? "Please wait"
              : session.configured
                ? "Sign in"
                : "Create owner"}
          </button>
        </form>
      )}
    </main>
  );
}

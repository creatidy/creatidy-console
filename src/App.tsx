import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import RouterPanel from "./RouterPanel";
import KernelOwnerPanel from "./KernelOwnerPanel";
import KernelSnapshotPanel from "./KernelSnapshotPanel";
import MiSnapshotPanel from "./MiSnapshotPanel";
import type { KernelSnapshotStatus } from "../server/kernel-owner-transport";

type Session = {
  configured: boolean;
  authenticated: boolean;
  kernelSnapshotStatus?: KernelSnapshotStatus;
  miInspectionOrigin?: string;
};

const signedOutNotice = "You are signed out.";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);
  const invalidatedGeneration = useRef<number>(-1);
  const skipLink = useRef<HTMLAnchorElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const focusedBeforeHide = useRef(false);
  const deferredSignInFocus = useRef(false);
  const confirmation = useRef<HTMLInputElement>(null);
  const screen = !session
    ? "connection"
    : session.authenticated
      ? "overview"
      : session.configured
        ? "login"
        : "setup";
  const previousScreen = useRef(screen);
  const retryRequested = useRef(false);
  const confirmationMismatch = error === "Passwords do not match.";

  useLayoutEffect(() => {
    const before = previousScreen.current;
    previousScreen.current = screen;
    deferredSignInFocus.current =
      before === "overview" &&
      screen === "login" &&
      document.visibilityState !== "visible" &&
      focusedBeforeHide.current;
    // Do not interrupt initial navigation or pull focus into an inactive tab.
    if (
      before !== screen &&
      (before !== "connection" || retryRequested.current) &&
      document.visibilityState === "visible" &&
      document.activeElement !== skipLink.current
    ) {
      heading.current?.focus();
    }
    retryRequested.current = false;
  }, [screen]);

  useEffect(() => {
    const rememberFocus = () => {
      focusedBeforeHide.current =
        main.current?.contains(document.activeElement) ?? false;
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        rememberFocus();
        return;
      }
      if (deferredSignInFocus.current) {
        deferredSignInFocus.current = false;
        if (document.activeElement === document.body) heading.current?.focus();
      }
      focusedBeforeHide.current = false;
    };
    // Capture before panels discard their transient controls on hide.
    document.addEventListener("visibilitychange", onVisibility, true);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility, true);
  }, []);

  function invalidate(
    broadcast: boolean,
    notice = "Your session expired or was revoked. Sign in again.",
  ) {
    if (
      document.visibilityState !== "visible" &&
      main.current?.contains(document.activeElement)
    )
      focusedBeforeHide.current = true;
    invalidatedGeneration.current = ++generation.current;
    setSession({ configured: true, authenticated: false });
    setChecking(false);
    setError("");
    // A duplicate denial for the cleared session must not relabel confirmed
    // logout. Starting a new session check or login clears this notice.
    setSessionNotice((previous) =>
      previous === signedOutNotice ? previous : notice,
    );
    if (broadcast) {
      try {
        channel.current?.postMessage(null);
      } catch {
        /* Periodic checks remain the fallback. */
      }
    }
  }

  async function refresh() {
    const current = ++generation.current;
    setChecking(true);
    setError("");
    setSessionNotice("");
    try {
      const response = await fetch("/api/session", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
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
    } finally {
      if (current === generation.current) setChecking(false);
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
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const setup = !session?.configured;
    if (setup && data.get("password") !== data.get("confirmation")) {
      setError("Passwords do not match.");
      confirmation.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    setSessionNotice("");
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
      if (current === generation.current)
        setError(
          "Could not reach Console. Check the application server and try again.",
        );
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    if (pending) return;
    const current = ++generation.current;
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (current !== generation.current) {
        // A passive 401 may have already cleared this session and notified peers.
        // Confirm only locally, unless a newer session check has superseded it.
        if (response.ok && invalidatedGeneration.current === generation.current)
          setSessionNotice(signedOutNotice);
        return;
      }
      if (response.status === 401) {
        invalidate(true);
        return;
      }
      if (!response.ok) throw new Error();
      invalidate(true, signedOutNotice);
    } catch {
      if (current === generation.current)
        setError("Logout could not be confirmed. Check the server connection.");
    } finally {
      setPending(false);
    }
  }

  const content = (
    <main id="main-content" ref={main} tabIndex={-1}>
      <p className="eyebrow">CREATIDY / CONSOLE</p>
      <h1 ref={heading} tabIndex={-1}>
        {screen === "overview"
          ? "Your console"
          : screen === "login"
            ? "Sign in"
            : screen === "setup"
              ? "Set up your console"
              : "Creatidy Console"}
      </h1>
      <div id="session-error" role="alert">
        {error}
      </div>
      <div role="status">
        {sessionNotice ||
          (!session && checking
            ? "Checking the local application session."
            : pending
              ? session?.authenticated
                ? "Signing out."
                : "Submitting owner details."
              : "")}
      </div>
      {!session ? (
        <button
          type="button"
          disabled={checking && !retryRequested.current}
          aria-disabled={checking}
          onClick={() => {
            if (!checking) {
              retryRequested.current = true;
              void refresh();
            }
          }}
        >
          Try again
        </button>
      ) : session.authenticated ? (
        <div className="operator-overview">
          <h2>Operator overview</h2>
          <p>
            See what each source last reported, what it recorded about its
            decisions, and what may need attention. These sources are observed
            independently.
          </p>
          <nav aria-label="Operator views">
            <a href="#router-heading">Resources</a>
            {!pending && (
              <>
                <a href="#kernel-snapshot-heading">Work and decisions</a>
                <a href="#mi-snapshot-heading">Offline evidence</a>
                <a href="#kernel-owner-heading">Proposal and command history</a>
              </>
            )}
          </nav>
          <p>
            Attaching to an execution session or opening its workspace is
            unavailable. Console has no supported attach or workspace access.
          </p>
          <RouterPanel
            expired={() => {
              invalidate(true);
            }}
          />
          {!pending && (
            <>
              <KernelSnapshotPanel
                initialStatus={session.kernelSnapshotStatus}
                expired={() => invalidate(true)}
              />
              <MiSnapshotPanel
                destination={session.miInspectionOrigin}
                expired={() => invalidate(true)}
              />
              <KernelOwnerPanel expired={() => invalidate(true)} />
            </>
          )}
          <button
            type="button"
            aria-disabled={pending}
            onClick={() => void logout()}
          >
            Log out
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {session.configured && <p>Sign in to continue.</p>}
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
                ref={confirmation}
                aria-invalid={confirmationMismatch || undefined}
                aria-describedby={
                  confirmationMismatch ? "session-error" : undefined
                }
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
              />
            </>
          )}
          <button type="submit" aria-disabled={pending}>
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
  return (
    <>
      <a ref={skipLink} className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {content}
    </>
  );
}

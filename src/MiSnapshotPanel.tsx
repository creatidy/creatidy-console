import { useEffect, useRef, useState } from "react";
import type { ExpectedMiReference } from "../server/mi-publication";

type EmptySnapshot = { instance: string; evaluatedAt: string; health: string };
type Publication = {
  reportedInstance: string;
  reportedEvaluatedAt: string;
  digest: string;
  schema: string;
  observations: number;
  statements: number;
  notices: number;
  uncertain: number;
  history: "unavailable";
  comparison: string;
  reportedHealth: { state: string; correlation: string };
  reportedFacts: unknown;
  reportedEvidence: unknown;
};

export default function MiSnapshotPanel({ expired }: { expired: () => void }) {
  const [snapshot, setSnapshot] = useState<EmptySnapshot>();
  const [publication, setPublication] = useState<Publication>();
  const [digest, setDigest] = useState("");
  const [schema, setSchema] = useState("mi.public-evidence-working/2");
  const [previous, setPrevious] = useState<File>();
  const [previousDigest, setPreviousDigest] = useState("");
  const [previousSchema, setPreviousSchema] = useState(
    "mi.public-evidence-working/2",
  );
  const previousInput = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("No offline file inspected.");
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const hasSnapshot = useRef(false);
  const inspecting = useRef(false);

  useEffect(() => {
    const hide = () => {
      generation.current++;
      active.current?.abort();
      hasSnapshot.current = false;
      inspecting.current = false;
      setSnapshot(undefined);
      setPublication(undefined);
      setPrevious(undefined);
      if (previousInput.current) previousInput.current.value = "";
      setVisible(false);
      setMessage("Offline result hidden. Select the file again to inspect it.");
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(async () => {
      if (
        !hasSnapshot.current ||
        inspecting.current ||
        document.visibilityState !== "visible"
      )
        return;
      const current = generation.current;
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5000);
      setVisible(false);
      try {
        const response = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (current !== generation.current) return;
        if (response.status === 401) {
          hide();
          expired();
        } else {
          const authenticated =
            response.ok && (await response.json()).authenticated === true;
          if (current !== generation.current) return;
          if (!authenticated) hide();
          else if (
            !controller.signal.aborted &&
            document.visibilityState === "visible"
          )
            setVisible(true);
        }
      } catch {
        if (current === generation.current) hide();
      } finally {
        clearTimeout(deadline);
      }
    }, 10000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      hide();
    };
  }, []);

  async function inspect(file: File, mode: "empty" | "publication") {
    generation.current++;
    active.current?.abort();
    const current = generation.current;
    const controller = new AbortController();
    active.current = controller;
    const deadline = setTimeout(() => controller.abort(), 10000);
    inspecting.current = true;
    setVisible(false);
    setMessage("Inspecting an untrusted offline file.");
    let displayed = false;
    let sessionExpired = false;
    const failure = (message: string) =>
      setMessage(
        hasSnapshot.current
          ? `${message} The previous inspected file remains last known.`
          : message,
      );
    try {
      if (file.size > 256 * 1024) throw new Error();
      const text = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      if (current !== generation.current || controller.signal.aborted) return;
      let body: object = { text };
      if (mode === "publication") {
        if (!/^[0-9a-f]{64}$/.test(digest)) {
          failure(
            "Enter the separately obtained 64-character expected digest first.",
          );
          return;
        }
        const expected: ExpectedMiReference = {
          format_version: 1,
          payload_schema: schema,
          sha256: digest,
        };
        let prior: { text: string; expected: ExpectedMiReference } | undefined;
        if (previous) {
          if (
            previous.size > 256 * 1024 ||
            !/^[0-9a-f]{64}$/.test(previousDigest)
          )
            throw new Error();
          const priorText = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(await previous.arrayBuffer());
          if (current !== generation.current || controller.signal.aborted)
            return;
          prior = {
            text: priorText,
            expected: {
              format_version: 1,
              payload_schema: previousSchema,
              sha256: previousDigest,
            },
          };
        }
        body = { text, expected, ...(prior ? { previous: prior } : {}) };
      }
      const response = await fetch(
        mode === "empty"
          ? "/api/mi/inspect-empty"
          : "/api/mi/inspect-publication",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (current !== generation.current) return;
      if (response.status === 401) {
        sessionExpired = true;
        hasSnapshot.current = false;
        setSnapshot(undefined);
        setPublication(undefined);
        return expired();
      }
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (
        current !== generation.current ||
        document.visibilityState !== "visible"
      )
        return;
      if (
        (mode === "empty" && result.status !== "empty") ||
        (mode === "publication" && result.status !== "checked")
      ) {
        failure(
          result.status === "resync-required"
            ? "The files do not establish a continuous retained cut. Inspect a fresh file without a previous file to resynchronize; earlier history remains unavailable."
            : result.status === "producer-invalid"
              ? "The selected file reports an invalid retained publication. No publication was activated."
              : result.status === "producer-unsupported"
                ? "The selected file reports an unsupported retained publication. No publication was activated."
                : result.status === "unsupported"
                  ? "This file uses a state or feature this limited inspector does not support. No publication was activated."
                  : "The file or reference is invalid or outside the supported validation bounds. No publication was activated.",
        );
        return;
      }
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (current !== generation.current) return;
      if (session.status === 401) {
        sessionExpired = true;
        hasSnapshot.current = false;
        setSnapshot(undefined);
        setPublication(undefined);
        return expired();
      }
      if (!session.ok || (await session.json()).authenticated !== true)
        throw new Error();
      if (
        current !== generation.current ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      if (mode === "empty") {
        setPublication(undefined);
        setSnapshot(result as EmptySnapshot);
      } else {
        setSnapshot(undefined);
        setPublication(result as Publication);
      }
      hasSnapshot.current = true;
      displayed = true;
      setVisible(true);
      setMessage(
        mode === "empty"
          ? "Supported empty snapshot shape. This file is not an authenticated producer connection."
          : "The file's artifact matches the supplied reference and passed supported structural checks. Neither file nor reference is authenticated; no publication was activated.",
      );
    } catch {
      if (current === generation.current)
        failure("The file could not be inspected.");
    } finally {
      clearTimeout(deadline);
      if (current === generation.current) {
        if (!displayed && !sessionExpired && hasSnapshot.current) {
          const recheck = new AbortController();
          const recheckDeadline = setTimeout(() => recheck.abort(), 5000);
          try {
            const session = await fetch("/api/kernel/session-check", {
              cache: "no-store",
              signal: recheck.signal,
            });
            if (current !== generation.current) return;
            if (session.status === 401) {
              hasSnapshot.current = false;
              setSnapshot(undefined);
              setPublication(undefined);
              expired();
            } else {
              const authenticated =
                session.ok && (await session.json()).authenticated === true;
              if (current !== generation.current) return;
              if (
                authenticated &&
                !recheck.signal.aborted &&
                document.visibilityState === "visible"
              )
                setVisible(true);
              else {
                hasSnapshot.current = false;
                setSnapshot(undefined);
                setPublication(undefined);
              }
            }
          } catch {
            if (current === generation.current) {
              hasSnapshot.current = false;
              setSnapshot(undefined);
              setPublication(undefined);
            }
          } finally {
            clearTimeout(recheckDeadline);
          }
        }
        if (current !== generation.current) return;
        inspecting.current = false;
        setPrevious(undefined);
        if (previousInput.current) previousInput.current.value = "";
      }
    }
  }

  return (
    <section aria-labelledby="mi-snapshot-heading">
      <h2 id="mi-snapshot-heading">Model Intelligence offline file</h2>
      <p>
        This offline inspector does not activate publications, verify publisher
        identity, establish source rights, or connect to Model Intelligence.
      </p>
      <label htmlFor="mi-snapshot-file">
        Select an offline snapshot (maximum 256 KiB)
      </label>
      <input
        id="mi-snapshot-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void inspect(file, "empty");
        }}
      />
      <h3>Inspect a nonempty publication</h3>
      <p>
        Obtain each full expected reference independently from a source you
        trust. Matching a digest does not authenticate the reference or its
        publisher. Only supported bounded shapes are accepted; file comparison
        cannot recover earlier history.
      </p>
      <label htmlFor="mi-schema">Expected payload schema</label>
      <select
        id="mi-schema"
        value={schema}
        onChange={(event) => setSchema(event.currentTarget.value)}
      >
        <option value="mi.public-evidence-working/2">
          mi.public-evidence-working/2
        </option>
        <option value="mi.public-evidence-working/1">
          mi.public-evidence-working/1
        </option>
      </select>
      <label htmlFor="mi-digest">Expected artifact SHA-256</label>
      <input
        id="mi-digest"
        value={digest}
        onChange={(event) => setDigest(event.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <h4>Optional previous snapshot</h4>
      <label htmlFor="mi-previous-schema">Previous payload schema</label>
      <select
        id="mi-previous-schema"
        value={previousSchema}
        onChange={(event) => setPreviousSchema(event.currentTarget.value)}
      >
        <option value="mi.public-evidence-working/2">
          mi.public-evidence-working/2
        </option>
        <option value="mi.public-evidence-working/1">
          mi.public-evidence-working/1
        </option>
      </select>
      <label htmlFor="mi-previous-digest">
        Previous expected artifact SHA-256
      </label>
      <input
        id="mi-previous-digest"
        value={previousDigest}
        onChange={(event) => setPreviousDigest(event.currentTarget.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <label htmlFor="mi-previous-file">
        Previous offline snapshot (optional, maximum 256 KiB)
      </label>
      <input
        ref={previousInput}
        id="mi-previous-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => setPrevious(event.currentTarget.files?.[0])}
      />
      <label htmlFor="mi-publication-file">
        Select a current publication snapshot (maximum 256 KiB)
      </label>
      <input
        id="mi-publication-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void inspect(file, "publication");
        }}
      />
      <p role="status">{message}</p>
      {snapshot && visible && (
        <p>
          Unverified file instance: {snapshot.instance}; evaluated:{" "}
          {snapshot.evaluatedAt}; health: {snapshot.health}. No retained
          publication is present in this file.
        </p>
      )}
      {publication && visible && (
        <>
          <p>
            Unverified file instance: {publication.reportedInstance}; evaluated:{" "}
            {publication.reportedEvaluatedAt}; artifact: {publication.digest};
            schema: {publication.schema}.
          </p>
          <p>
            Reported evidence: {publication.observations} observations,{" "}
            {publication.statements} statements, {publication.notices} notices,{" "}
            {publication.uncertain} uncertain campaigns. Health:{" "}
            {publication.reportedHealth.state}; correlation:{" "}
            {publication.reportedHealth.correlation}.
          </p>
          <p>
            Comparison of supplied files: {publication.comparison}. Earlier
            history: {publication.history}. These are untrusted claims, not an
            authenticated producer view or admission decision.
          </p>
          <h4>Reported projection</h4>
          <pre>{JSON.stringify(publication.reportedFacts, null, 2)}</pre>
          <details>
            <summary>Untrusted evidence records and reported rights</summary>
            <p>
              These records are claims in the selected file, not proof of source
              truth, freshness, authenticity or permission to redistribute.
            </p>
            <pre>{JSON.stringify(publication.reportedEvidence, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";

export default function KernelOwnerPanel({ expired }: { expired: () => void }) {
  const [status, setStatus] = useState<
    "checking" | "unavailable" | "disconnected" | "connected"
  >("checking");
  const [proposal, setProposal] = useState<{
    scope: string;
    digest: string;
    text: string;
  }>();
  const [visible, setVisible] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [approvalScope, setApprovalScope] = useState<{
    digest: string;
    text: string;
  }>();
  const [scopeStatus, setScopeStatus] = useState("");
  const scopeGeneration = useRef(0);
  const scopeRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const hide = () => {
      scopeGeneration.current++;
      scopeRequest.current?.abort();
      setApprovalScope(undefined);
      setScopeStatus("");
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") hide();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      hide();
    };
  }, []);

  useEffect(() => {
    if (!visible || status !== "connected") {
      scopeGeneration.current++;
      scopeRequest.current?.abort();
    }
    if (status !== "connected") {
      setApprovalScope(undefined);
      setScopeStatus("");
    }
  }, [visible, status]);

  async function readApprovalScope() {
    const current = ++scopeGeneration.current;
    scopeRequest.current?.abort();
    const controller = new AbortController();
    scopeRequest.current = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    setApprovalScope(undefined);
    setScopeStatus("Reading approval scope.");
    try {
      const response = await fetch("/api/kernel/approval-scope", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        if (current === scopeGeneration.current) expired();
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as {
        status?: unknown;
        scope?: unknown;
        digest?: unknown;
        proposalDigest?: unknown;
        text?: unknown;
      };
      if (
        result.status !== "connected" ||
        result.scope !== proposal?.scope ||
        !proposal ||
        result.proposalDigest !== proposal.digest ||
        typeof result.digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(result.digest) ||
        typeof result.text !== "string"
      )
        throw new Error();
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (session.status === 401) {
        if (current === scopeGeneration.current) expired();
        return;
      }
      if (!session.ok || (await session.json()).authenticated !== true)
        throw new Error();
      if (
        current !== scopeGeneration.current ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      setApprovalScope({ digest: result.digest, text: result.text });
      setScopeStatus(
        "Approval scope received. It may have changed; this is not an approval.",
      );
    } catch {
      if (current === scopeGeneration.current)
        setScopeStatus(
          "Approval scope unavailable. No owner command is available.",
        );
    } finally {
      clearTimeout(timer);
    }
  }

  useEffect(() => {
    let generation = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cached:
      | { scope: string; digest: string; text: string; canApprove: boolean }
      | undefined;
    const hide = () => {
      generation++;
      controller?.abort();
      if (timer) clearTimeout(timer);
      setVisible(false);
    };
    const check = async () => {
      hide();
      if (document.visibilityState !== "visible") return;
      const current = generation;
      controller = new AbortController();
      const active = controller;
      const signal = active.signal;
      const timeout = setTimeout(() => active.abort(), 5000);
      try {
        if (!cached) {
          const response = await fetch("/api/kernel/owner", {
            cache: "no-store",
            signal,
          });
          if (response.status === 401) {
            if (current === generation) expired();
            return;
          }
          if (!response.ok) throw new Error();
          const result = (await response.json()) as {
            status: unknown;
            actions: unknown;
            scope?: unknown;
            digest?: unknown;
            text?: unknown;
          };
          if (current !== generation) return;
          if (signal.aborted) throw new Error();
          if (
            !Array.isArray(result.actions) ||
            (result.actions.length !== 0 &&
              !(result.actions.length === 1 && result.actions[0] === "approve"))
          )
            throw new Error();
          if (
            result.status === "connected" &&
            typeof result.scope === "string" &&
            typeof result.digest === "string" &&
            /^[0-9a-f]{64}$/.test(result.digest) &&
            typeof result.text === "string"
          ) {
            cached = {
              scope: result.scope,
              digest: result.digest,
              text: result.text,
              canApprove: result.actions.length === 1,
            };
          } else if (
            result.status === "unavailable" ||
            result.status === "disconnected"
          ) {
            setStatus(result.status);
            return;
          } else throw new Error();
        }
        const response = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal,
        });
        if (current !== generation) return;
        if (signal.aborted) throw new Error();
        if (response.status === 401) {
          expired();
          return;
        }
        if (!response.ok || (await response.json()).authenticated !== true)
          throw new Error();
        if (current !== generation || document.visibilityState !== "visible")
          return;
        if (signal.aborted) throw new Error();
        setProposal(cached);
        setCanApprove(cached.canApprove);
        setStatus("connected");
        setVisible(true);
        timer = setTimeout(() => void check(), 10000);
      } catch {
        if (current === generation) {
          setStatus("disconnected");
          if (cached && document.visibilityState === "visible")
            timer = setTimeout(() => void check(), 10000);
        }
      } finally {
        clearTimeout(timeout);
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void check();
      else hide();
    };
    document.addEventListener("visibilitychange", visibility);
    void check();
    return () => {
      hide();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return (
    <section aria-labelledby="kernel-owner-heading">
      <h2 id="kernel-owner-heading">Kernel owner actions</h2>
      <p role="status">
        {status === "checking"
          ? "Checking owner capability."
          : status === "unavailable"
            ? "Unavailable: no verified Kernel owner capability is connected. Console login does not grant Kernel authority."
            : status === "connected"
              ? `Verified proposal received when this view opened; it may have changed. Reload to recheck. ${canApprove ? "Approval requires a fresh review." : "No owner commands are available."}`
              : "Kernel proposal unavailable: the channel disconnected, refused the read, or returned invalid or oversized data. No owner commands are available."}
      </p>
      {proposal && status === "connected" && visible && (
        <>
          <p>Scope: {proposal.scope}</p>
          <p>SHA-256: {proposal.digest}</p>
          <p>
            Proposal declarations are untrusted and are not effective host
            policy. Effective host policy is unknown; this view is not an
            approval.
          </p>
          <pre>{proposal.text}</pre>
          <button type="button" onClick={() => void readApprovalScope()}>
            Inspect approval scope
          </button>
          <p role="status">{scopeStatus}</p>
          {approvalScope && (
            <>
              <p>Approval scope SHA-256: {approvalScope.digest}</p>
              <p>
                The scope is untrusted producer data. A digest does not verify
                producer identity or grant authority.
              </p>
              <pre>{approvalScope.text}</pre>
            </>
          )}
        </>
      )}
      <KernelApprovalPanel
        visible={!!proposal && canApprove && visible && status === "connected"}
        scope={proposal?.scope ?? ""}
        proposalDigest={proposal?.digest ?? ""}
        expired={expired}
      />
    </section>
  );
}

function KernelApprovalPanel({
  visible,
  scope,
  proposalDigest,
  expired,
}: {
  visible: boolean;
  scope: string;
  proposalDigest: string;
  expired: () => void;
}) {
  const [expiry, setExpiry] = useState("");
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<{
    review: string;
    scopeDigest: string;
    revision: string;
    status: string;
    approvalExpiry: string;
    text: string;
  }>();
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      commandId: string;
      scope: string;
      action: string;
      outcome: "unknown" | "historical";
      canReplay: boolean;
      approval: {
        revision: string;
        proposalDigest: string;
        scopeDigest: string;
        decisionId: string;
        requestedExpiry: string;
      } | null;
      receipt: {
        status: string;
        settlement: string | null;
        decisionId?: string;
        specDigest?: string;
        effectiveExpiry?: string;
      } | null;
    }>
  >();
  const [historyVisible, setHistoryVisible] = useState(false);
  const generation = useRef(0);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const clear = () => {
      generation.current++;
      active.current?.abort();
      setReview(undefined);
      setPending(false);
      setHistory(undefined);
      setHistoryVisible(false);
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") clear();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      clear();
    };
  }, []);

  useEffect(() => {
    if (!history) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setHistoryVisible(false);
      try {
        const response = await fetch("/api/kernel/session-check", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setHistory(undefined);
          expired();
          return;
        }
        if (!response.ok || (await response.json()).authenticated !== true)
          throw new Error();
        if (
          !controller.signal.aborted &&
          document.visibilityState === "visible"
        ) {
          setHistoryVisible(true);
          setHistory([...history]);
        }
      } catch {
        if (!controller.signal.aborted) setHistory(undefined);
      }
    }, 10000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [history, expired]);

  async function prepare() {
    const current = ++generation.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setReview(undefined);
    setPending(true);
    setMessage("Reading current review evidence.");
    try {
      const response = await fetch("/api/kernel/owner-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expires_at: expiry }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        if (current === generation.current) expired();
        return;
      }
      if (response.status === 409) {
        const refusal = (await response.json()) as { error?: unknown };
        if (current === generation.current)
          setMessage(
            refusal.error === "Unresolved command; inspect history"
              ? "A previous command is unresolved; inspect command history. No approval was sent."
              : "The proposal changed during review. No approval was sent.",
          );
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as Record<string, unknown>;
      if (
        typeof result.review !== "string" ||
        !/^[0-9a-f]{64}$/.test(result.review) ||
        result.scope !== scope ||
        result.proposalDigest !== proposalDigest ||
        typeof result.scopeDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(result.scopeDigest) ||
        typeof result.revision !== "string" ||
        !/^(?:-1|0|[1-9][0-9]*)$/.test(result.revision) ||
        typeof result.status !== "string" ||
        result.approvalExpiry !== expiry ||
        typeof result.text !== "string"
      )
        throw new Error();
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (session.status === 401) {
        if (current === generation.current) expired();
        return;
      }
      if (!session.ok || (await session.json()).authenticated !== true)
        throw new Error();
      if (
        current !== generation.current ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      setReview({
        review: result.review,
        scopeDigest: result.scopeDigest,
        revision: result.revision,
        status: result.status,
        approvalExpiry: expiry,
        text: result.text,
      });
      setMessage(
        "Review these exact values before confirming. The producer may refuse stale or unauthorized requests.",
      );
    } catch {
      if (current === generation.current)
        setMessage("Review unavailable; no approval was sent.");
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) setPending(false);
    }
  }

  async function approve() {
    if (!review || pending || !visible) return;
    const selected = review;
    setReview(undefined);
    setPending(true);
    setMessage("Submitting approval; a lost reply cannot prove its outcome.");
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/kernel/owner", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve", review: selected.review }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        expired();
        return;
      }
      if (response.status === 409) {
        setMessage("Review expired or changed; no approval was sent.");
        return;
      }
      if (response.status === 503) {
        const refusal = (await response.json()) as { error?: unknown };
        if (refusal.error === "Owner channel busy; no command sent") {
          setMessage(
            "The owner channel was busy; no approval was sent. Review again when it is available.",
          );
          return;
        }
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as {
        kind?: unknown;
        action?: unknown;
      };
      setMessage(
        result.kind === "historical-receipt-shape" &&
          result.action === "approve"
          ? "A historical approval receipt was returned. It is not proof of a current grant or observed effect."
          : "Approval outcome is unknown; do not retry blindly. Check command history and producer evidence.",
      );
    } catch {
      setMessage(
        "Approval outcome may be unknown; do not retry blindly. Check command history and producer evidence.",
      );
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  async function readHistory() {
    const current = ++generation.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setHistory(undefined);
    setReview(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/kernel/owner-journal", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        if (current === generation.current) expired();
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as {
        status?: unknown;
        commands?: unknown;
      };
      if (
        result.status !== "available" ||
        !Array.isArray(result.commands) ||
        result.commands.length > 128
      )
        throw new Error();
      const commands = result.commands.map(
        (
          item: unknown,
        ): {
          commandId: string;
          scope: string;
          action: string;
          outcome: "unknown" | "historical";
          canReplay: boolean;
          approval: {
            revision: string;
            proposalDigest: string;
            scopeDigest: string;
            decisionId: string;
            requestedExpiry: string;
          } | null;
          receipt: {
            status: string;
            settlement: string | null;
            decisionId?: string;
            specDigest?: string;
            effectiveExpiry?: string;
          } | null;
        } => {
          if (
            !item ||
            typeof item !== "object" ||
            !("commandId" in item) ||
            !("scope" in item) ||
            !("action" in item) ||
            !("outcome" in item) ||
            !("canReplay" in item) ||
            !("approval" in item) ||
            !("receipt" in item) ||
            typeof item.commandId !== "string" ||
            typeof item.scope !== "string" ||
            typeof item.action !== "string" ||
            typeof item.canReplay !== "boolean" ||
            (item.outcome !== "unknown" && item.outcome !== "historical")
          )
            throw new Error();
          const approval = item.approval;
          if (item.action === "approve") {
            if (
              !approval ||
              typeof approval !== "object" ||
              !("revision" in approval) ||
              typeof approval.revision !== "string" ||
              !/^(?:-1|0|[1-9][0-9]*)$/.test(approval.revision) ||
              !("proposalDigest" in approval) ||
              typeof approval.proposalDigest !== "string" ||
              !/^[0-9a-f]{64}$/.test(approval.proposalDigest) ||
              !("scopeDigest" in approval) ||
              typeof approval.scopeDigest !== "string" ||
              !/^[0-9a-f]{64}$/.test(approval.scopeDigest) ||
              !("decisionId" in approval) ||
              typeof approval.decisionId !== "string" ||
              !approval.decisionId.trim() ||
              !("requestedExpiry" in approval) ||
              typeof approval.requestedExpiry !== "string" ||
              !/^[1-9][0-9]*$/.test(approval.requestedExpiry)
            )
              throw new Error();
          } else if (approval !== null) throw new Error();
          const receipt = item.receipt;
          if (item.outcome === "historical") {
            if (
              !receipt ||
              typeof receipt !== "object" ||
              !("action" in receipt) ||
              receipt.action !== item.action ||
              !("status" in receipt) ||
              typeof receipt.status !== "string" ||
              !("settlement" in receipt) ||
              (receipt.settlement !== null &&
                typeof receipt.settlement !== "string") ||
              (item.action === "approve" &&
                (!("decisionId" in receipt) ||
                  typeof receipt.decisionId !== "string" ||
                  !("specDigest" in receipt) ||
                  typeof receipt.specDigest !== "string" ||
                  !/^[0-9a-f]{64}$/.test(receipt.specDigest) ||
                  !("effectiveExpiry" in receipt) ||
                  typeof receipt.effectiveExpiry !== "string" ||
                  !/^[1-9][0-9]*$/.test(receipt.effectiveExpiry)))
            )
              throw new Error();
          } else if (receipt !== null) throw new Error();
          return {
            commandId: item.commandId,
            scope: item.scope,
            action: item.action,
            outcome: item.outcome,
            canReplay: item.canReplay,
            approval: approval as {
              revision: string;
              proposalDigest: string;
              scopeDigest: string;
              decisionId: string;
              requestedExpiry: string;
            } | null,
            receipt: receipt as {
              status: string;
              settlement: string | null;
              decisionId?: string;
              specDigest?: string;
              effectiveExpiry?: string;
            } | null,
          };
        },
      );
      const session = await fetch("/api/kernel/session-check", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (session.status === 401) {
        if (current === generation.current) expired();
        return;
      }
      if (!session.ok || (await session.json()).authenticated !== true)
        throw new Error();
      if (
        current !== generation.current ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      setHistory(commands);
      setHistoryVisible(true);
      setMessage(
        "Command history is local evidence, not proof of current authority or effects.",
      );
    } catch {
      if (current === generation.current)
        setMessage("Command history unavailable.");
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) setPending(false);
    }
  }

  async function replay(commandId: string) {
    if (pending || document.visibilityState !== "visible") return;
    setHistory(undefined);
    setPending(true);
    setMessage("Checking the exact original command on its original channel.");
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/kernel/owner-replay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        expired();
        return;
      }
      if (response.status === 409) {
        setMessage(
          "The original channel is unavailable; the outcome remains unknown.",
        );
        return;
      }
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { kind?: unknown };
      setMessage(
        result.kind === "historical-receipt-shape"
          ? "A historical receipt was returned; it is not proof of current authority or an effect."
          : "The outcome remains unknown; do not issue a new command blindly.",
      );
    } catch {
      setMessage(
        "The outcome remains unknown; do not issue a new command blindly.",
      );
    } finally {
      clearTimeout(timeout);
      setPending(false);
    }
  }

  return (
    <>
      <section aria-label="Review approval" hidden={!visible}>
        <h3>Review approval</h3>
        <p>
          Enter the approval expiry as a positive integer in the producer's
          clock units. The producer may cap it to earlier evidence expiry.
        </p>
        <label htmlFor="kernel-approval-expiry">
          Requested producer expiry
        </label>
        <input
          id="kernel-approval-expiry"
          inputMode="numeric"
          disabled={pending}
          value={expiry}
          onChange={(event) => {
            generation.current++;
            active.current?.abort();
            setPending(false);
            setExpiry(event.target.value);
            setReview(undefined);
          }}
        />
        <button
          type="button"
          disabled={pending || !/^[1-9][0-9]{0,18}$/.test(expiry)}
          onClick={() => void prepare()}
        >
          Review exact approval
        </button>
        {review && (
          <>
            <p>Bound program: {scope}</p>
            <p>
              Observed revision: {review.revision} ({review.status})
            </p>
            <p>Proposal SHA-256: {proposalDigest}</p>
            <p>Approval scope SHA-256: {review.scopeDigest}</p>
            <p>Requested producer expiry: {review.approvalExpiry}</p>
            <p>
              This approval may authorize the producer to create or amend the
              program under the scope below. A receipt does not prove execution
              or settlement.
            </p>
            <pre>{review.text}</pre>
            <button
              type="button"
              disabled={pending}
              onClick={() => void approve()}
            >
              Confirm approval
            </button>
          </>
        )}
      </section>
      <section aria-label="Command history">
        <button
          type="button"
          disabled={pending}
          onClick={() => void readHistory()}
        >
          Inspect command history
        </button>
        <p role="status">{message}</p>
        {history && historyVisible && (
          <ul>
            {history.map((entry) => (
              <li key={entry.commandId}>
                Scope: {entry.scope}; {entry.action}:{" "}
                {entry.outcome === "unknown"
                  ? "outcome unknown; do not retry blindly"
                  : "historical receipt only"}{" "}
                (command {entry.commandId}){" "}
                {entry.approval && (
                  <div>
                    <p>Reviewed revision: {entry.approval.revision}</p>
                    <p>Proposal SHA-256: {entry.approval.proposalDigest}</p>
                    <p>Approval scope SHA-256: {entry.approval.scopeDigest}</p>
                    <p>Decision ID: {entry.approval.decisionId}</p>
                    <p>
                      Requested producer expiry:{" "}
                      {entry.approval.requestedExpiry}
                    </p>
                  </div>
                )}
                {entry.receipt && (
                  <div>
                    <p>Receipt status: {entry.receipt.status}</p>
                    {entry.receipt.settlement && (
                      <p>Receipt settlement: {entry.receipt.settlement}</p>
                    )}
                    {entry.receipt.decisionId && (
                      <p>Receipt decision ID: {entry.receipt.decisionId}</p>
                    )}
                    {entry.receipt.specDigest && (
                      <p>Receipt spec SHA-256: {entry.receipt.specDigest}</p>
                    )}
                    {entry.receipt.effectiveExpiry && (
                      <p>
                        Receipt effective expiry:{" "}
                        {entry.receipt.effectiveExpiry}
                      </p>
                    )}
                  </div>
                )}
                {entry.canReplay && entry.outcome === "unknown" && (
                  <>
                    <p>
                      The original channel reported an existing intent without a
                      receipt. Checking resends the exact same command on that
                      channel; it does not create new authority. This option is
                      unavailable after losing the channel or restarting.
                    </p>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void replay(entry.commandId)}
                    >
                      Check original receipt
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

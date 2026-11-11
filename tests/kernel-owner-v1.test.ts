import { describe, expect, it } from "vitest";
import {
  classifyLocalOwnerResult,
  createLocalOwnerAttempt,
  decodeLocalOwnerFrame,
  prepareLocalOwnerCommand,
} from "../server/kernel-owner-v1.ts";

function frame(text: string) {
  const payload = Buffer.from(text);
  const result = Buffer.alloc(4 + payload.length);
  result.writeUInt32BE(payload.length);
  payload.copy(result, 4);
  return result;
}

describe("Kernel local owner v1 contract shapes", () => {
  it("builds fixed-action length-prefixed frames with stable identity and exact integers", () => {
    const command = prepareLocalOwnerCommand(
      "program",
      {
        action: "stop",
        expected_revision: 9007199254740993n,
        reason: "synthetic-stop-reason",
      },
      () => "synthetic-command-id",
    );
    const first = command.frame();
    expect(first.readUInt32BE(0)).toBe(first.length - 4);
    expect(first.subarray(4).toString()).toContain(
      '"expected_revision":9007199254740993',
    );
    expect(first.subarray(4).toString()).toContain(
      '"command_id":"synthetic-command-id"',
    );
    first.fill(0);
    expect(command.frame().subarray(4).toString()).toContain(
      '"command_id":"synthetic-command-id"',
    );
    expect(Object.isFrozen(command.request)).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    expect(command.scope).toBe("program");
    expect(command.frame().subarray(4).toString()).not.toContain('"scope"');
  });

  it("requires a bounded nonblank local scope", () => {
    const intent = { action: "start-managed", expected_revision: 0 };
    for (const scope of ["", " ", "x".repeat(4097)])
      expect(() => prepareLocalOwnerCommand(scope, intent)).toThrow();
    expect(() =>
      prepareLocalOwnerCommand("x".repeat(4096), intent),
    ).not.toThrow();
  });

  it("counts Kernel command text limits in Unicode code points", () => {
    const character = "\u{1f680}";
    const approve = (decision_id: string, commandId: string) =>
      prepareLocalOwnerCommand(
        "program",
        {
          action: "approve",
          expected_revision: -1,
          decision_id,
          expires_at: 1,
          proposal_digest: "a".repeat(64),
        },
        () => commandId,
      );
    const command = approve(character.repeat(256), character.repeat(256));
    expect(
      classifyLocalOwnerResult(command.request, {
        version: 1,
        status: "approved",
        decision_id: character.repeat(256),
        spec_digest: "a".repeat(64),
        expires_at: 1,
        authority: "historical-only",
      }).kind,
    ).toBe("historical-receipt-shape");
    expect(() => approve(character.repeat(257), "id")).toThrow();
    expect(() => approve("decision", character.repeat(257))).toThrow();
    for (const action of ["stop", "reconcile"] as const) {
      const intent = (value: string) =>
        action === "stop"
          ? { action, expected_revision: 1, reason: value }
          : {
              action,
              expected_revision: 1,
              subject: "a".repeat(64),
              evidence: value,
            };
      expect(() =>
        prepareLocalOwnerCommand("program", intent(character.repeat(512))),
      ).not.toThrow();
      expect(() =>
        prepareLocalOwnerCommand("program", intent(character.repeat(513))),
      ).toThrow();
    }
  });

  it("permits only the exact existing owner action fields", () => {
    const id = () => "synthetic-command-id";
    for (const intent of [
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "synthetic-decision",
        expires_at: 1,
        proposal_digest: "a".repeat(64),
      },
      { action: "start-managed", expected_revision: 0 },
      { action: "stop", expected_revision: 0, reason: "synthetic-reason" },
      {
        action: "reconcile",
        expected_revision: 0,
        subject: "a".repeat(64),
        evidence: "synthetic-evidence",
      },
    ])
      expect(() =>
        prepareLocalOwnerCommand("program", intent, id),
      ).not.toThrow();
    for (const intent of [
      { action: "pause", expected_revision: 0 },
      {
        action: "stop",
        expected_revision: 0,
        reason: "synthetic",
        principal: "synthetic-principal",
      },
      { action: "stop", expected_revision: -1, reason: "synthetic" },
      {
        action: "approve",
        expected_revision: -2,
        decision_id: "synthetic",
        expires_at: 1,
        proposal_digest: "a".repeat(64),
      },
      {
        action: "approve",
        expected_revision: 0,
        decision_id: "synthetic",
        expires_at: 0,
        proposal_digest: "a".repeat(64),
      },
      {
        action: "approve",
        expected_revision: 0,
        decision_id: "synthetic",
        expires_at: 1,
        proposal_digest: "A".repeat(64),
      },
      {
        action: "reconcile",
        expected_revision: 0,
        subject: "not-a-digest",
        evidence: "synthetic",
      },
      {
        action: "stop",
        expected_revision: Number.MAX_SAFE_INTEGER + 1,
        reason: "synthetic",
      },
    ])
      expect(() => prepareLocalOwnerCommand("program", intent, id)).toThrow();
  });

  it("distinguishes historical receipt shapes from unknown effects without retrying", () => {
    const stop = prepareLocalOwnerCommand(
      "program",
      { action: "stop", expected_revision: 4, reason: "synthetic" },
      () => "synthetic-id",
    );
    expect(
      classifyLocalOwnerResult(stop.request, {
        version: 1,
        status: "accepted",
        settlement: "bound-managed-target-settled",
        authority: "historical-only",
      }),
    ).toEqual({
      kind: "historical-receipt-shape",
      action: "stop",
      status: "accepted",
      settlement: "bound-managed-target-settled",
    });
    expect(
      classifyLocalOwnerResult(stop.request, {
        version: 1,
        status: "accepted",
        settlement: "unknown",
        authority: "historical-only",
      }),
    ).toEqual({
      kind: "historical-receipt-shape",
      action: "stop",
      status: "accepted",
      settlement: "unknown",
    });
    for (const response of [
      undefined,
      { status: "unknown", settlement: "unknown" },
      { status: "conflict" },
      { status: "refused" },
      { status: "expired" },
      { status: "revoked" },
      {
        version: 1,
        status: "accepted",
        settlement: "cancelled",
        authority: "historical-only",
      },
      {
        version: 1,
        status: "accepted",
        settlement: "unknown",
        authority: "current",
      },
    ]) {
      expect(classifyLocalOwnerResult(stop.request, response)).toEqual({
        kind: "unknown",
      });
    }
  });

  it("refuses mismatched approval receipts and recognizes bounded reconciliation shape", () => {
    const approve = prepareLocalOwnerCommand(
      "program",
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "decision-a",
        expires_at: 500n,
        proposal_digest: "a".repeat(64),
      },
      () => "synthetic-id",
    );
    const receipt = {
      version: 1,
      status: "approved",
      decision_id: "decision-a",
      spec_digest: "a".repeat(64),
      expires_at: 500,
      authority: "historical-only",
    };
    expect(approve.request).toEqual({
      version: 1,
      action: "approve",
      command_id: "synthetic-id",
      expected_revision: -1,
      decision_id: "decision-a",
      expires_at: 500n,
      proposal_digest: "a".repeat(64),
    });
    expect(classifyLocalOwnerResult(approve.request, receipt).kind).toBe(
      "historical-receipt-shape",
    );
    expect(classifyLocalOwnerResult(approve.request, receipt)).toEqual({
      kind: "historical-receipt-shape",
      action: "approve",
      status: "approved",
      settlement: null,
      decision_id: "decision-a",
      spec_digest: "a".repeat(64),
      expires_at: 500,
    });
    expect(approve.frame().subarray(4).toString()).toContain(
      `"proposal_digest":"${"a".repeat(64)}"`,
    );
    expect(
      classifyLocalOwnerResult(approve.request, { ...receipt, expires_at: 499 })
        .kind,
    ).toBe("historical-receipt-shape");
    expect(
      classifyLocalOwnerResult(approve.request, { ...receipt, expires_at: 501 })
        .kind,
    ).toBe("unknown");
    expect(
      classifyLocalOwnerResult(approve.request, { ...receipt, expires_at: 0 })
        .kind,
    ).toBe("unknown");
    expect(
      classifyLocalOwnerResult(approve.request, {
        ...receipt,
        decision_id: "decision-b",
      }).kind,
    ).toBe("unknown");
    const reconcile = prepareLocalOwnerCommand(
      "program",
      {
        action: "reconcile",
        expected_revision: 1,
        subject: "b".repeat(64),
        evidence: "synthetic-evidence",
      },
      () => "synthetic-id",
    );
    expect(
      classifyLocalOwnerResult(reconcile.request, {
        version: 1,
        status: "recorded",
        authority: "historical-only",
      }),
    ).toEqual({
      kind: "historical-receipt-shape",
      action: "reconcile",
      status: "recorded",
      settlement: null,
    });
  });
  it("decodes only bounded, unambiguous local v1 response envelopes", () => {
    const command = prepareLocalOwnerCommand(
      "program",
      {
        action: "approve",
        expected_revision: -1,
        decision_id: "decision-a",
        expires_at: 9223372036854775807n,
        proposal_digest: "a".repeat(64),
      },
      () => "synthetic-id",
    );
    const response = `{"version":1,"ok":true,"result":{"version":1,"status":"approved","decision_id":"decision-a","spec_digest":"${"a".repeat(64)}","expires_at":9223372036854775807,"authority":"historical-only"}}`;
    expect(decodeLocalOwnerFrame(command.request, frame(response)).kind).toBe(
      "historical-receipt-shape",
    );
    expect(
      decodeLocalOwnerFrame(
        command.request,
        frame(response.replace('"ok":true', '"ok":true,"ok":true')),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(
        command.request,
        frame(response.replace('"ok":true', '"ok":true,"\\u006f\\u006b":true')),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(
        command.request,
        frame(response.replace('"version":1', '"version":2')),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(
        command.request,
        frame(
          response.replace('"ok":true', '"ok":true,"principal":"injected"'),
        ),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(
        command.request,
        Buffer.concat([frame(response), Buffer.from([0])]),
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(command.request, Buffer.from([0, 0, 0, 1, 0xff])),
    ).toEqual({ kind: "unknown" });
    expect(
      decodeLocalOwnerFrame(command.request, Buffer.alloc(1024 * 1024 + 5)),
    ).toEqual({ kind: "unknown" });
  });

  it("coalesces one synthetic exchange and reports a historical receipt shape, not an effect", async () => {
    const attempt = createLocalOwnerAttempt(
      "program",
      { action: "stop", expected_revision: 4, reason: "synthetic" },
      () => "synthetic-id",
    );
    let calls = 0;
    const exchange = async (payload: Uint8Array) => {
      calls++;
      expect(Buffer.from(payload).subarray(4).toString()).toContain(
        '"command_id":"synthetic-id"',
      );
      return frame(
        '{"version":1,"ok":true,"result":{"version":1,"status":"accepted","settlement":"unknown","authority":"historical-only"}}',
      );
    };
    const [first, second] = await Promise.all([
      attempt.sendOnce(exchange),
      attempt.sendOnce(exchange),
    ]);
    expect(calls).toBe(1);
    expect(first).toEqual({
      kind: "historical-receipt-shape",
      action: "stop",
      status: "accepted",
      settlement: "unknown",
    });
    expect(second).toEqual(first);
  });

  it("keeps lost replies unknown and never retries a possibly accepted command", async () => {
    const attempt = createLocalOwnerAttempt(
      "program",
      { action: "start-managed", expected_revision: 2 },
      () => "synthetic-id",
    );
    let calls = 0;
    const exchange = (_payload: Uint8Array, signal: AbortSignal) => {
      calls++;
      return new Promise<Uint8Array>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new Error("synthetic lost reply")),
          { once: true },
        ),
      );
    };
    expect(await attempt.sendOnce(exchange, 10)).toEqual({ kind: "unknown" });
    expect(await attempt.sendOnce(exchange, 10)).toEqual({ kind: "unknown" });
    expect(calls).toBe(1);
  });
});

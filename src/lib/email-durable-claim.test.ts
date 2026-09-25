/**
 * Unit tests for src/lib/email-durable-claim.ts (DECISION-103, B-70).
 *
 * docs/work-log/2026-09-25-send-result-type.md, Phase 3 "Tests the
 * implementer must deliver", items 1-7.
 *
 * @/lib/email is mocked at the sendEmail()/sendBulkMemberEmail() boundary —
 * this file tests outcomeFromRaw()'s mapping and the two wrapper functions'
 * plumbing, not sendEmail()'s own send-attempt logic (covered by
 * email-guardrail.test.ts / email-no-api-key.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
  sendBulkMemberEmail: vi.fn(),
}));

import { sendEmail, sendBulkMemberEmail } from "@/lib/email";
import {
  sendEmailForDurableClaim,
  sendBulkMemberEmailForDurableClaim,
  type DurableSendResult,
} from "./email-durable-claim";

beforeEach(() => {
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendBulkMemberEmail).mockReset();
});

const OPTS = { to: "someone@example.com", from: "Lions <noreply@example.org>", subject: "s", html: "<p>h</p>" };

describe("sendEmailForDurableClaim — outcome mapping", () => {
  it("1. maps a genuine send (success:true, no blocked/notAttempted) to { outcome: 'delivered' }", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, emailQueueId: "q-1" });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({ outcome: "delivered", emailQueueId: "q-1" });
  });

  it("2. maps a genuine failure (success:false, error) to { outcome: 'failed', error }", async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: false,
      error: "Resend rejected",
      emailQueueId: "q-2",
    });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({ outcome: "failed", error: "Resend rejected", emailQueueId: "q-2" });
  });

  it("3. maps blocked:true to not_delivered/blocked_non_production, NOT delivered, regardless of success being true on the raw result", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, blocked: true, emailQueueId: "q-3" });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({
      outcome: "not_delivered",
      reason: "blocked_non_production",
      emailQueueId: "q-3",
    });
  });

  it("4. maps notAttempted:true to not_delivered/dev_no_api_key — the sixth-instance fix; fails against pre-change code (no notAttempted field existed)", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: true, notAttempted: true, emailQueueId: "q-4" });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({
      outcome: "not_delivered",
      reason: "dev_no_api_key",
      emailQueueId: "q-4",
    });
  });

  it("blocked takes precedence over notAttempted if both were somehow set", async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: true,
      blocked: true,
      notAttempted: true,
      emailQueueId: "q-5",
    });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({
      outcome: "not_delivered",
      reason: "blocked_non_production",
      emailQueueId: "q-5",
    });
  });

  it("a failure with no error string falls back to 'Unknown error'", async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, emailQueueId: "q-6" });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({ outcome: "failed", error: "Unknown error", emailQueueId: "q-6" });
  });
});

describe("5. DurableSendResult has no bare `success` field — compile-time assertion", () => {
  it("kept from silently rotting: a suppressed access to .success must itself fail without the suppression comment", () => {
    const sendResultFromHelper = { outcome: "delivered", emailQueueId: "q" } as DurableSendResult;
    // @ts-expect-error — DurableSendResult has no `success` property. If a
    // future edit adds one back, this line starts compiling cleanly, which
    // makes the `@ts-expect-error` itself a compile error (an unused
    // suppression), failing `tsc --noEmit` and this test's own job of
    // catching that rot.
    const bareSuccess = sendResultFromHelper.success;
    expect(bareSuccess).toBeUndefined();
  });
});

describe("6. sendBulkMemberEmailForDurableClaim — the pinning test (retargeted at direct field propagation)", () => {
  it("an allowlisted recipient in a bulk send is still unconditionally blocked (_bulkMemberSend forces the guard) — propagated straight through with no DB read-back", async () => {
    vi.mocked(sendBulkMemberEmail).mockResolvedValue({
      results: [{ to: "allowlisted@example.com", success: true, blocked: true, emailQueueId: "q-bulk-1" }],
    });

    const result = await sendBulkMemberEmailForDurableClaim({
      from: "Lions <noreply@example.org>",
      subject: "s",
      recipients: [{ to: "allowlisted@example.com", html: "<p>h</p>" }],
    });

    expect(result.results).toEqual([
      {
        to: "allowlisted@example.com",
        emailQueueId: "q-bulk-1",
        outcome: "not_delivered",
        reason: "blocked_non_production",
      },
    ]);
    // sendBulkMemberEmail() was called exactly once for the whole batch —
    // the wrapper does not loop or re-implement the recipient loop.
    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
  });
});

describe("7. sendEmailForDurableClaim — single-recipient dev_no_api_key case", () => {
  it("an allowlisted single-recipient send with no RESEND_API_KEY configured maps to not_delivered/dev_no_api_key", async () => {
    vi.mocked(sendEmail).mockResolvedValue({
      success: true,
      notAttempted: true,
      emailQueueId: "q-single-1",
    });

    const result = await sendEmailForDurableClaim(OPTS);

    expect(result).toEqual({
      outcome: "not_delivered",
      reason: "dev_no_api_key",
      emailQueueId: "q-single-1",
    });
  });
});

describe("exhaustiveness — a caller must be structurally unable to ignore a variant", () => {
  it("switching over every current DurableSendOutcome variant with a never-check does not throw", () => {
    const outcomes: DurableSendResult[] = [
      { outcome: "delivered", emailQueueId: "q" },
      { outcome: "failed", error: "e", emailQueueId: "q" },
      { outcome: "not_delivered", reason: "blocked_non_production", emailQueueId: "q" },
      { outcome: "not_delivered", reason: "dev_no_api_key", emailQueueId: "q" },
    ];

    function handle(result: DurableSendResult): string {
      switch (result.outcome) {
        case "delivered":
          return "ok";
        case "failed":
          return "err";
        case "not_delivered":
          return "not-delivered";
        default: {
          const _exhaustive: never = result;
          throw new Error(`Unhandled: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    for (const outcome of outcomes) {
      expect(() => handle(outcome)).not.toThrow();
    }
  });
});

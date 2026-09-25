import { describe, it, expect, vi } from "vitest";
import { attemptResendSend } from "@/lib/email-send-attempt";
import type { Resend } from "resend";

/**
 * Direct unit tests for the shared send-and-classify step extracted from
 * sendEmail() (src/lib/email.ts) and the admin email-queue retry route's
 * attemptSend() (src/app/api/admin/email-queue/retry/route.ts) — see
 * src/lib/email-send-attempt.ts's doc comment for why this extraction
 * exists (B-68). Both callers already have their own end-to-end tests
 * (src/lib/email-send-error-handling.test.ts and
 * src/app/api/admin/email-queue/retry/route.test.ts); these tests exercise
 * the shared classification directly, once, instead of via either caller.
 */

function fakeResend(send: ReturnType<typeof vi.fn>): Resend {
  return { emails: { send } } as unknown as Resend;
}

const baseInput = {
  from: "Lions <noreply@example.org>",
  to: "someone@example.com",
  subject: "s",
  html: "<p>h</p>",
};

describe("attemptResendSend", () => {
  it("returns success: true on a resolved { data, error: null }", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "resend-id" }, error: null });
    const result = await attemptResendSend(fakeResend(send), baseInput);
    expect(result).toEqual({ success: true });
  });

  it("classifies a recognized permanent error code as not retryable", async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "API key is invalid", statusCode: 401, name: "invalid_api_key" },
    });
    const result = await attemptResendSend(fakeResend(send), baseInput);
    expect(result).toEqual({ success: false, error: "API key is invalid", retryable: false });
  });

  it("classifies a recognized transient error code (rate_limit_exceeded) as retryable", async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded", statusCode: 429, name: "rate_limit_exceeded" },
    });
    const result = await attemptResendSend(fakeResend(send), baseInput);
    expect(result).toEqual({ success: false, error: "Rate limit exceeded", retryable: true });
  });

  it("treats an unrecognized error code as retryable, never guessed as permanent", async () => {
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Something new", statusCode: 500, name: "some_future_error_code" },
    });
    const result = await attemptResendSend(fakeResend(send), baseInput);
    expect(result).toEqual({ success: false, error: "Something new", retryable: true });
  });

  it("classifies a thrown transport error as retryable (no error code to inspect)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await attemptResendSend(fakeResend(send), baseInput);
    expect(result).toEqual({ success: false, error: "ECONNRESET", retryable: true });
  });

  it("forwards replyTo/cc/bcc/attachments to the SDK call only when present", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "resend-id" }, error: null });
    await attemptResendSend(fakeResend(send), baseInput);
    expect(send).toHaveBeenCalledWith({
      from: baseInput.from,
      to: [baseInput.to],
      subject: baseInput.subject,
      html: baseInput.html,
    });

    send.mockClear();
    await attemptResendSend(fakeResend(send), {
      ...baseInput,
      replyTo: "reply@example.org",
      cc: "cc@example.org",
      bcc: "bcc@example.org",
      attachments: [{ filename: "invite.ics", content: "BEGIN:VCALENDAR" }],
    });
    expect(send).toHaveBeenCalledWith({
      from: baseInput.from,
      to: [baseInput.to],
      subject: baseInput.subject,
      html: baseInput.html,
      replyTo: "reply@example.org",
      cc: ["cc@example.org"],
      bcc: ["bcc@example.org"],
      attachments: [{ filename: "invite.ics", content: "BEGIN:VCALENDAR" }],
    });
  });
});

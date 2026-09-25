import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the primary send loop in sendEmail() against the unchecked-`error`
 * defect documented in docs/work-log/2026-09-25-sendemail-unchecked-error.md
 * (backlog B-65, the unfinished half of
 * docs/work-log/2026-09-25-email-silent-success.md).
 *
 * THE BUG: Resend's SDK (v6, "resend": "^6.16.0") resolves `{ data, error }`
 * on an API-level rejection — it does NOT throw. Every prior version of
 * this loop did `await resend.emails.send(...)` and discarded the return
 * value, so a 401 from a revoked key, an unverified sending domain, an
 * exceeded quota, a suppressed recipient, or a malformed payload all
 * resolved normally: the `catch` block never fired, no retry happened, and
 * the row was written `status: 'sent'`.
 *
 * PRODUCTION EVIDENCE: the club's Resend key was revoked ~2026-08-28. Over
 * the following month, email_queue recorded 98 rows, every one `sent`,
 * `attempts: 1`, `last_error` empty, zero `failed`, zero retries — while
 * Resend's own dashboard showed 1 actual send in its 30-day window.
 *
 * None of these tests existed before this fix — that is exactly why the
 * defect survived a month undetected. Each "lands failed, never sent" test
 * below fails against the pre-fix code (a bare `await resend.emails.send()`
 * with no inspection of the resolved value) and passes against the fix.
 */

const sendMock = vi.fn();
const updateSet = vi.fn();
const insertValues = vi.fn();
let queuedIdCounter = 0;

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => {
        insertValues(values);
        queuedIdCounter += 1;
        const id = `queued-${queuedIdCounter}`;
        return { returning: async () => [{ id }] };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({ emailQueue: {} }));

/** All updateSet() calls after the initial insert, in order. */
function statusUpdates() {
  return updateSet.mock.calls.map((call) => call[0]);
}

function lastStatusUpdate() {
  const updates = statusUpdates();
  return updates[updates.length - 1];
}

describe("sendEmail — Resend resolves { error } instead of throwing", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    insertValues.mockReset();
    queuedIdCounter = 0;
    vi.unstubAllEnvs();
    // Production so the deny-by-default non-production guard never engages
    // and every test exercises the real send loop.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const send = async (to = "someone@example.com") => {
    const { sendEmail } = await import("@/lib/email");
    return sendEmail({ to, from: "Lions <noreply@example.org>", subject: "s", html: "<p>h</p>" });
  };

  it("a permanent API error (invalid_api_key) lands the row failed with that message and returns success: false — never sent", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "API key is invalid", statusCode: 401, name: "invalid_api_key" },
    });

    const result = await send();

    // This is the exact regression: pre-fix, `await resend.emails.send()`
    // never threw here, so this branch fell straight into the "sent"
    // write below the try block.
    expect(result.success).toBe(false);
    expect(result.error).toBe("API key is invalid");
    expect(lastStatusUpdate()).toEqual(
      expect.objectContaining({ status: "failed", lastError: "API key is invalid" }),
    );
    expect(statusUpdates()).not.toContainEqual(expect.objectContaining({ status: "sent" }));
  });

  it("a permanent error does not burn all 3 attempts — it fails fast on attempt 1", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "Invalid from address", statusCode: 422, name: "invalid_from_address" },
    });

    const result = await send();

    expect(result.success).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(lastStatusUpdate()).toEqual(expect.objectContaining({ attempts: 1 }));
  });

  it("a retryable error (rate_limit_exceeded) is retried up to MAX_ATTEMPTS, then lands failed", async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded", statusCode: 429, name: "rate_limit_exceeded" },
    });

    const result = await send();

    expect(result.success).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(lastStatusUpdate()).toEqual(
      expect.objectContaining({ status: "failed", lastError: "Rate limit exceeded", attempts: 3 }),
    );
  }, 10000);

  it("a retryable error that succeeds on a later attempt lands sent with the correct attempt count", async () => {
    sendMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Rate limit exceeded", statusCode: 429, name: "rate_limit_exceeded" },
      })
      .mockResolvedValueOnce({ data: { id: "resend-id" }, error: null });

    const result = await send();

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(lastStatusUpdate()).toEqual(expect.objectContaining({ status: "sent", attempts: 2 }));
  });

  it("data present, error: null still lands sent — no regression on the happy path", async () => {
    sendMock.mockResolvedValueOnce({ data: { id: "resend-id" }, error: null });

    const result = await send();

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(lastStatusUpdate()).toEqual(
      expect.objectContaining({ status: "sent", attempts: 1 }),
    );
  });

  it("a thrown exception still retries MAX_ATTEMPTS times and lands failed (unchanged behavior)", async () => {
    sendMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await send();

    expect(result.success).toBe(false);
    expect(result.error).toBe("ECONNRESET");
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(lastStatusUpdate()).toEqual(
      expect.objectContaining({ status: "failed", lastError: "ECONNRESET", attempts: 3 }),
    );
  }, 10000);

  it("an unrecognized error code (SDK adds a new one later) is treated as retryable, not guessed as permanent", async () => {
    sendMock.mockResolvedValue({
      data: null,
      // Deliberately not in RESEND_ERROR_CODE_KEY as known today.
      error: { message: "Something new", statusCode: 500, name: "some_future_error_code" },
    });

    const result = await send();

    expect(result.success).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(3);
  }, 10000);
});

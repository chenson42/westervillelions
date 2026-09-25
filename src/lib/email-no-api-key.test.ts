/**
 * Guards the "no RESEND_API_KEY" branch in sendEmail() (and the equivalent
 * branch in the admin retry route).
 *
 * THE BUG (docs/work-log/2026-09-25-email-silent-success.md): the branch was
 * not guarded on NODE_ENV. In production, a missing/blank RESEND_API_KEY
 * silently reported success and wrote `status: 'sent'` into email_queue,
 * turning a total mail outage into positive evidence that mail went out.
 * Confirmed against production: Resend's dashboard showed 1 send in its
 * 30-day history against ~35 `sent` rows in email_queue over the same
 * window, all with `attempts: 1` and no `last_error` — the fingerprint of
 * the missing-key path (an *invalid* key throws inside resend.emails.send()
 * and would retry/land `failed` with an error instead).
 *
 * Fix: in production, a missing key must land a `failed` row with a
 * non-empty error and never report success. Outside production, the
 * existing deny-by-default allowlist guard runs first (see
 * email-guardrail.test.ts); if a recipient clears that guard, a missing key
 * is now recorded as a distinct `dev_no_api_key` status — never `sent` —
 * while still returning success: true so local manual testing of a
 * feature's happy path isn't broken by not having a Resend key configured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

describe("sendEmail — missing RESEND_API_KEY", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    insertValues.mockReset();
    queuedIdCounter = 0;
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const send = async (to = "someone@example.com") => {
    const { sendEmail } = await import("@/lib/email");
    return sendEmail({ to, from: "Lions <noreply@example.org>", subject: "s", html: "<p>h</p>" });
  };

  it("PRODUCTION + missing key: never reports success, and lands a failed row with a non-empty error", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");

    const result = await send();

    // This is the exact regression: pre-fix, this branch returned
    // { success: true } and wrote status: 'sent' unconditionally.
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: expect.stringMatching(/RESEND_API_KEY/i),
      }),
    );
    // Must never be marked sent.
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("PRODUCTION + present key: unchanged behavior — still sends, still lands 'sent'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
    sendMock.mockResolvedValueOnce({ data: { id: "resend-id" } });

    const result = await send();

    expect(result.success).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("NON-PRODUCTION + missing key + allowlisted recipient: never marked 'sent', lands a distinct status, still reports success", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "someone@example.com");

    const result = await send("someone@example.com");

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "dev_no_api_key" }),
    );
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("NON-PRODUCTION + missing key + NON-allowlisted recipient: still blocked_non_production (deny-by-default must not regress, DECISION-085)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    // No EMAIL_DEV_ALLOWLIST set at all.

    const result = await send("someone@example.com");

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_non_production" }),
    );
  });
});

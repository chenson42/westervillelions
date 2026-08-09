import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the non-production distribution-list block in `sendEmail()`.
 *
 * WHY THIS EXISTS: on 2026-08-09 a QA run of the meeting-minutes email feature sent a
 * real message to club@westervillelions.org — the club's ~44-person Google Group.
 * `.env.local` carries the production RESEND_API_KEY and `next dev` re-reads it, so a
 * shell-level override does not survive. These addresses are real Google Groups with no
 * sandbox in front of them: a mistake reaches members immediately and cannot be recalled.
 *
 * The guardrail must therefore hold by code, not by anyone remembering a rule. If this
 * test ever needs "fixing", read the incident note above before changing the behaviour.
 */

const sendMock = vi.fn();
const updateSet = vi.fn();

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ returning: async () => [{ id: "queued-1" }] }),
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

describe("sendEmail — club distribution-list guardrail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    // A key IS present — this is the exact condition that caused the real incident.
    vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const setEnv = (value: string) => vi.stubEnv("NODE_ENV", value);

  const send = async (to: string) => {
    const { sendEmail } = await import("@/lib/email");
    return sendEmail({ to, from: "Lions <noreply@example.org>", subject: "s", html: "<p>h</p>" });
  };

  it("does NOT deliver to the club list outside production, even with an API key present", async () => {
    setEnv("development");
    const result = await send("club@westervillelions.org");
    expect(sendMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true); // callers and their tests behave normally
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_non_production" }),
    );
  });

  it("does NOT deliver to the board list outside production", async () => {
    setEnv("development");
    await send("board@westervillelions.org");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("blocks regardless of case or a display-name wrapper", async () => {
    setEnv("test");
    await send("Westerville Lions <CLUB@Westervillelions.ORG>");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("still delivers to an ordinary individual recipient outside production", async () => {
    setEnv("development");
    await send("someone@example.com");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("delivers to the club list in production — the guardrail is non-production only", async () => {
    setEnv("production");
    await send("club@westervillelions.org");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

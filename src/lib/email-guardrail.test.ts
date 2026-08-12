import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Guards the non-production distribution-list block in `sendEmail()`.
 *
 * WHY THIS EXISTS: two incidents, and the second is why the rule is now
 * deny-by-default.
 *
 * 2026-08-09 — a QA run of the meeting-minutes email sent a real message to
 * club@westervillelions.org, the club's ~44-person Google Group.
 * `.env.local` carries the production RESEND_API_KEY and `next dev` re-reads it, so a
 * shell-level override does not survive. These addresses are real Google Groups with no
 * sandbox in front of them: a mistake reaches members immediately and cannot be recalled.
 *
 * 2026-08-12 — a QA run of the treasury CC rule created a pending disbursement in dev,
 * which fired the pre-existing board-approval notification and mailed 16 real board
 * members a fake $500 approval request. That path was neither a distribution list nor a
 * bulk send, so the deny-list did not cover it. A deny-list only protects the paths
 * somebody remembered to enumerate, and there are ~18 sendEmail call sites.
 *
 * The guardrail must therefore hold by code, not by anyone remembering a rule, and it
 * must default to refusing. If this test ever needs "fixing", read the incidents above
 * before changing the behaviour.
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

describe("sendEmail — club distribution-list guardrail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    insertValues.mockReset();
    queuedIdCounter = 0;
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

  // WAS: "still delivers to an ordinary individual recipient outside production",
  // asserting exactly the behaviour that mailed 16 real board members a fake $500
  // approval request on 2026-08-12. The guard is now deny-by-default, and this test
  // asserts the opposite of what it used to.
  it("does NOT deliver to an ordinary individual recipient outside production", async () => {
    setEnv("development");
    const result = await send("someone@example.com");
    expect(sendMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_non_production" }),
    );
  });

  it("delivers to an address the developer deliberately allowlisted", async () => {
    setEnv("development");
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "someone@example.com");
    await send("someone@example.com");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a club list even when someone allowlists it", async () => {
    setEnv("development");
    vi.stubEnv("EMAIL_DEV_ALLOWLIST", "club@westervillelions.org");
    await send("club@westervillelions.org");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("delivers to the club list in production — the guardrail is non-production only", async () => {
    setEnv("production");
    await send("club@westervillelions.org");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// cc / bcc — DECISION-086. Existing call sites omit both and must be
// unaffected; new call sites (dues reminders, the five treasury emails) opt
// in.
// ---------------------------------------------------------------------------

describe("sendEmail — cc/bcc", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    insertValues.mockReset();
    queuedIdCounter = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
    vi.stubEnv("NODE_ENV", "production"); // no guardrail interference
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists cc/bcc on the queued row and forwards both to Resend when provided", async () => {
    const { sendEmail } = await import("@/lib/email");
    const result = await sendEmail({
      to: "member@example.com",
      from: "Lions <noreply@example.org>",
      subject: "s",
      html: "<p>h</p>",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ cc: "cc@example.com", bcc: "bcc@example.com" }),
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ cc: ["cc@example.com"], bcc: ["bcc@example.com"] }),
    );
    expect(result.emailQueueId).toBeTruthy();
  });

  it("existing call sites — omitting cc/bcc leaves behaviour unaffected: null on the queue row, no cc/bcc key sent to Resend", async () => {
    const { sendEmail } = await import("@/lib/email");
    await sendEmail({
      to: "member@example.com",
      from: "Lions <noreply@example.org>",
      subject: "s",
      html: "<p>h</p>",
    });

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ cc: null, bcc: null }));
    const sendArgs = sendMock.mock.calls[0][0];
    expect(sendArgs).not.toHaveProperty("cc");
    expect(sendArgs).not.toHaveProperty("bcc");
  });
});

// ---------------------------------------------------------------------------
// sendBulkMemberEmail — DECISION-085. This is the load-bearing safety test:
// a dev/QA run of ANY feature reaching for this entrypoint must never be
// able to mail a real member, with no address-matching escape hatch.
// ---------------------------------------------------------------------------

describe("sendBulkMemberEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    updateSet.mockReset();
    insertValues.mockReset();
    queuedIdCounter = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test_key_not_real");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks EVERY recipient outside production, including an address that could never match isClubDistributionList()", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { sendBulkMemberEmail } = await import("@/lib/email");

    const { results } = await sendBulkMemberEmail({
      from: "treasurer@westervillelions.org",
      subject: "Dues reminder",
      bcc: "treasurer-personal@example.com",
      recipients: [
        { to: "alice@example.com", html: "<p>a</p>" },
        { to: "bob@example.com", html: "<p>b</p>" },
        // Fabricated, never-seen-before address — proves this isn't an
        // address-matching guard that a fresh dev member row could evade.
        { to: "newmember@example.com", html: "<p>c</p>" },
      ],
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
      expect(r.emailQueueId).toBeTruthy();
    }
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "blocked_non_production" }),
    );
    // Every one of the three recipients was independently blocked.
    expect(
      updateSet.mock.calls.filter(
        (call) => call[0]?.status === "blocked_non_production",
      ),
    ).toHaveLength(3);
  });

  it("in production, delivers per-recipient and one recipient's failure does not prevent the next recipient's send", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // The first recipient fails every attempt; the second always succeeds.
    sendMock.mockImplementation(async (args: { to: string[] }) => {
      if (args.to[0] === "fails@example.com") {
        throw new Error("Resend rejected");
      }
      return { data: { id: "resend-id" } };
    });

    const { sendBulkMemberEmail } = await import("@/lib/email");
    const { results } = await sendBulkMemberEmail({
      from: "treasurer@westervillelions.org",
      subject: "Dues reminder",
      recipients: [
        { to: "fails@example.com", html: "<p>a</p>" },
        { to: "ok@example.com", html: "<p>b</p>" },
      ],
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ to: "fails@example.com", success: false });
    expect(results[0].error).toBeTruthy();
    expect(results[1]).toMatchObject({ to: "ok@example.com", success: true });
    expect(results[1].emailQueueId).toBeTruthy();
  }, 10_000);
});

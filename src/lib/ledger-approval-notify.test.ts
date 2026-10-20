/**
 * notifyPendingApprovers(): the one approver-notification path
 * (B-172 Increment 2a, break site 21). Hermetic: the email, treasurer and
 * approver lookups are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { m } = vi.hoisted(() => ({
  m: {
    approvers: [] as string[],
    treasurer: { ok: true, email: "treasurer@example.invalid" } as
      | { ok: true; email: string }
      | { ok: false; reason: string },
    sent: [] as Record<string, unknown>[],
    sendError: null as Error | null,
    approversError: null as Error | null,
  },
}));

vi.mock("@/lib/ledger-queries", () => ({
  getEmailsForFeature: vi.fn(async () => {
    if (m.approversError) throw m.approversError;
    return m.approvers;
  }),
}));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn(async () => m.treasurer) }));
vi.mock("@/lib/email", () => ({
  sendBulkMemberEmail: vi.fn(async (args: Record<string, unknown>) => {
    if (m.sendError) throw m.sendError;
    m.sent.push(args);
    return { results: [] };
  }),
}));

import { notifyPendingApprovers } from "./ledger-approval-notify";

const LEG = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  m.approvers = ["a@example.invalid", "b@example.invalid"];
  m.treasurer = { ok: true, email: "treasurer@example.invalid" };
  m.sent = [];
  m.sendError = null;
  m.approversError = null;
  process.env.NEXTAUTH_URL = "https://example.com";
});
afterEach(() => vi.restoreAllMocks());

const notice = {
  noun: "disbursement" as const,
  subject: "Disbursement pending your approval - $12.00",
  amountDollars: "12.00",
  txnDate: "2026-10-19",
  party: "Acme Hall",
  memo: "Rent",
  reviewTxnId: LEG,
};

describe("notifyPendingApprovers", () => {
  it("sends one bulk message to every approver with the treasurer on Cc and a deep link", async () => {
    await notifyPendingApprovers(notice);
    expect(m.sent).toHaveLength(1);
    const sent = m.sent[0] as {
      subject: string;
      cc?: string;
      recipients: { to: string; html: string }[];
    };
    expect(sent.subject).toBe(notice.subject);
    expect(sent.cc).toBe("treasurer@example.invalid");
    expect(sent.recipients.map((r) => r.to)).toEqual(["a@example.invalid", "b@example.invalid"]);
    expect(sent.recipients[0].html).toContain(`approvals?txn=${LEG}`);
    expect(sent.recipients[0].html).toContain("Acme Hall");
  });

  it("omits Cc and warns when no treasurer resolves", async () => {
    m.treasurer = { ok: false, reason: "none" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await notifyPendingApprovers(notice);
    expect(m.sent[0]).not.toHaveProperty("cc");
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to the plain Approvals link without a row id", async () => {
    await notifyPendingApprovers({ ...notice, reviewTxnId: undefined });
    const html = (m.sent[0].recipients as { html: string }[])[0].html;
    expect(html).toContain("https://example.com/admin/ledger/approvals\"");
  });

  it("a batch notice names the count and carries no party or memo", async () => {
    await notifyPendingApprovers({
      ...notice,
      noun: "sweep",
      batch: { count: 7 },
      party: "Some Donor",
      memo: "Some memo",
    });
    const html = (m.sent[0].recipients as { html: string }[])[0].html;
    expect(html).toContain("A sweep of 7 gifts");
    expect(html).not.toContain("Some Donor");
    expect(html).not.toContain("Some memo");
  });

  it("never throws when the send fails, and logs with console.error", async () => {
    m.sendError = new Error("resend down");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyPendingApprovers(notice)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      "[Ledger email] Approver notification failed:",
      m.sendError,
    );
  });

  it("never throws when the approver lookup fails, and logs", async () => {
    m.approversError = new Error("db down");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyPendingApprovers(notice)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(m.sent).toHaveLength(0);
  });
});

describe("the extracted blocks", () => {
  const root = join(__dirname, "..");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("keep a console.error catch in the notifier, never a silent one", () => {
    const src = strip(readFileSync(join(__dirname, "ledger-approval-notify.ts"), "utf8"));
    expect(src).toMatch(/catch \(error\) \{\s*console\.error\(/);
  });

  it("the transactions route calls the notifier for both pending branches and sends no mail itself", () => {
    const src = strip(
      readFileSync(join(root, "app/api/admin/ledger/transactions/route.ts"), "utf8"),
    );
    expect(src.match(/notifyPendingApprovers\(/g)).toHaveLength(2);
    expect(src).not.toContain("sendBulkMemberEmail");
    expect(src).not.toContain("buildPendingApprovalEmailHtml");
    expect(src).not.toContain("resolveTreasurer");
  });

  it("the notifier is the only non-test caller of buildPendingApprovalEmailHtml", () => {
    const files = [
      "lib/ledger-approval-notify.ts",
      "app/api/admin/ledger/transactions/route.ts",
      "app/api/admin/ledger/transactions/[id]/approve/route.ts",
    ];
    const callers = files.filter((f) =>
      strip(readFileSync(join(root, f), "utf8")).includes("buildPendingApprovalEmailHtml("),
    );
    expect(callers).toEqual(["lib/ledger-approval-notify.ts"]);
  });
});

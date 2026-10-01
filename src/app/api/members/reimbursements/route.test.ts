/**
 * Unit tests for POST /api/members/reimbursements submit notification
 * (DECISION-106; B-48 submit half). Hermetic; example addresses only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ dupes: [] as unknown[] }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.dupes }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: "r-new" }] }) }),
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  listReimbursementsForMember: vi.fn(),
  getEmailsForFeature: vi.fn(),
  getReimbursementWithMember: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendBulkMemberEmail: vi.fn() }));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));
vi.mock("@/lib/email-compose", () => ({
  escapeHtml: (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  getFromEmail: () => "Club <noreply@example.com>",
  getAppUrl: () => "https://app.example.com",
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { FEATURES } from "@/lib/permissions";
import { getEmailsForFeature, getReimbursementWithMember } from "@/lib/ledger-queries";
import { sendBulkMemberEmail } from "@/lib/email";
import { resolveTreasurer } from "@/lib/board-positions";

const treasurerOk = {
  ok: true as const,
  memberId: "m-t",
  firstName: "T",
  lastName: "R",
  email: "treasurer@example.com",
};

function req(over: Record<string, unknown> = {}): NextRequest {
  return {
    json: async () => ({
      amountCents: 4500,
      description: "Supplies",
      receiptStorageKey: "receipts/11111111-1111-1111-1111-111111111111/r.pdf",
      ...over,
    }),
  } as unknown as NextRequest;
}

function allLogArgs(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.dupes = [];
  vi.mocked(auth).mockResolvedValue({
    user: { id: "u-sub", memberId: "m-sub", email: "sub@example.com" },
  } as never);
  vi.mocked(getReimbursementWithMember).mockResolvedValue({
    memberFirstName: "Pat",
    memberLastName: "Member",
  } as never);
  vi.mocked(getEmailsForFeature).mockReset();
  vi.mocked(getEmailsForFeature).mockResolvedValue(["treasurer@example.com", "admin@example.com", "sub@example.com"]);
  vi.mocked(resolveTreasurer).mockReset();
  vi.mocked(resolveTreasurer).mockResolvedValue(treasurerOk);
  vi.mocked(sendBulkMemberEmail).mockReset();
  vi.mocked(sendBulkMemberEmail).mockResolvedValue({
    results: [{ to: "treasurer@example.com", success: true }],
  } as never);
  vi.restoreAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("auth", () => {
  it("401 without a session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req())).status).toBe(401);
  });
  it("403 without a memberId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u" } } as never);
    expect((await POST(req())).status).toBe(403);
  });
});

describe("happy path", () => {
  it("201, one bulk send to the treasurer, escaped body, no 'board review'", async () => {
    const res = await POST(req({ description: "<script>alert(1)</script>" }));
    expect(res.status).toBe(201);
    expect(sendBulkMemberEmail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendBulkMemberEmail).mock.calls[0][0];
    expect(arg.recipients.map((r) => r.to)).toEqual(["treasurer@example.com"]);
    const html = arg.recipients[0].html;
    expect(html).toContain("Pat Member");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("$45.00");
    expect(html).toContain("https://app.example.com/admin/ledger/reimbursements");
    expect(html).not.toContain("board review");
    expect(arg.subject).toContain("$45.00");
    expect(getEmailsForFeature).toHaveBeenCalledWith(FEATURES.LEDGER_RECORD);
    expect(getEmailsForFeature).not.toHaveBeenCalledWith(FEATURES.LEDGER_APPROVE);
  });
});

describe("fallback recipients", () => {
  const cases: [string, () => void][] = [
    ["resolver none", () => vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "none" })],
    ["resolver multiple", () => vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "multiple" })],
    [
      "resolver no_board_group",
      () => vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "no_board_group" }),
    ],
    [
      "treasurer is the submitter",
      () => vi.mocked(resolveTreasurer).mockResolvedValue({ ...treasurerOk, memberId: "m-sub" }),
    ],
    [
      "treasurer lacks ledger.record",
      () => vi.mocked(resolveTreasurer).mockResolvedValue({ ...treasurerOk, email: "nobody@example.com" }),
    ],
  ];

  it.each(cases)("%s: holders minus the submitter, warns without addresses", async (_n, setup) => {
    setup();
    const res = await POST(req());
    expect(res.status).toBe(201);
    const to = vi.mocked(sendBulkMemberEmail).mock.calls[0][0].recipients.map((r) => r.to);
    expect(to).toEqual(["treasurer@example.com", "admin@example.com"]);
    const logged = allLogArgs(warn);
    expect(logged).toContain("fallback");
    expect(logged).not.toContain("@");
  });
});

describe("failure isolation", () => {
  it("zero recipients: console.error with the id, no send, still 201", async () => {
    vi.mocked(getEmailsForFeature).mockResolvedValue([]);
    const res = await POST(req());
    expect(res.status).toBe(201);
    expect(sendBulkMemberEmail).not.toHaveBeenCalled();
    expect(allLogArgs(error)).toContain("r-new");
    expect(allLogArgs(error)).not.toContain("@");
  });

  it("a throwing send is still 201 and warns", async () => {
    vi.mocked(sendBulkMemberEmail).mockRejectedValue(new Error("boom"));
    const res = await POST(req());
    expect(res.status).toBe(201);
    expect(allLogArgs(warn)).toContain("threw");
  });

  it("a success:false result warns with counts and no address", async () => {
    vi.mocked(sendBulkMemberEmail).mockResolvedValue({
      results: [{ to: "treasurer@example.com", success: false, error: "x" }],
    } as never);
    const res = await POST(req());
    expect(res.status).toBe(201);
    const logged = allLogArgs(warn);
    expect(logged).toContain("send failed");
    expect(logged).toContain('"failed":1');
    expect(logged).not.toContain("@");
  });

  it("a blocked (success:true) result does not warn", async () => {
    vi.mocked(sendBulkMemberEmail).mockResolvedValue({
      results: [{ to: "treasurer@example.com", success: true, blocked: true }],
    } as never);
    await POST(req());
    expect(warn).not.toHaveBeenCalled();
  });
});

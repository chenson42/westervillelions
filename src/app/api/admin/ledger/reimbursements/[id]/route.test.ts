/**
 * Unit tests for PATCH /api/admin/ledger/reimbursements/[id] (DECISION-106).
 * Folds in the reimbursement half of B-48 (treasury CC rule).
 *
 * Hermetic: mocks auth, permissions-server, ledger-queries, email,
 * board-positions and a hand-built fake `@/lib/db`. WHERE clauses are
 * serialized with PgDialect. Example addresses only; nothing can send.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updates: [] as { set: Record<string, unknown>; where: unknown }[],
  inserts: [] as Record<string, unknown>[],
  updateResults: [] as unknown[][],
  insertResult: [{ id: "txn-1" }] as unknown[],
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const makeUpdate = () => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: unknown) => {
        h.updates.push({ set, where });
        return { returning: async () => h.updateResults.shift() ?? [{ id: "r-1" }] };
      },
    }),
  });
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserts.push(v);
        return { returning: async () => h.insertResult };
      },
    }),
    update: makeUpdate,
  };
  return {
    db: {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => h.selectQueue.shift() ?? [] }) }),
      }),
      update: makeUpdate,
      transaction: async (cb: (t: typeof tx) => Promise<unknown>) => {
        h.transaction();
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getReimbursementWithMember: vi.fn(),
  getUserEmail: vi.fn(),
  getBudgetLineForLinkValidation: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/board-positions", () => ({ resolveTreasurer: vi.fn() }));
vi.mock("@/lib/email-compose", () => ({
  escapeHtml: (s: string) => s,
  getFromEmail: () => "Club <noreply@example.com>",
  getAppUrl: () => "https://app.example.com",
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReimbursementWithMember,
  getUserEmail,
  getBudgetLineForLinkValidation,
} from "@/lib/ledger-queries";
import { sendEmail } from "@/lib/email";
import { resolveTreasurer } from "@/lib/board-positions";

const SUBMITTED_AT = new Date("2026-09-30T10:00:00.123Z");

function reimbRow(over: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    submittedByMemberId: "m-sub",
    submittedByUserId: "u-sub",
    amountCents: 4500,
    description: "Supplies",
    beneficiaryCause: null,
    receiptStorageKey: "receipts/abc/r.pdf",
    fundId: null,
    status: "submitted",
    reviewedByUserId: null,
    reviewedAt: null,
    boardMinute: null,
    rejectionReason: null,
    paidAt: null,
    ledgerTransactionId: null,
    submittedAt: SUBMITTED_AT,
    createdAt: SUBMITTED_AT,
    updatedAt: SUBMITTED_AT, // never edited
    memberFirstName: "Pat",
    memberLastName: "Member",
    memberEmail: "pat@example.com",
    ...over,
  };
}

function payBody(over: Record<string, unknown> = {}) {
  return {
    action: "pay",
    fundId: "fund-1",
    categoryId: "cat-1",
    paymentDate: "2026-10-01",
    paymentMethod: "check",
    expectedAmountCents: 4500,
    expectedUpdatedAt: SUBMITTED_AT.toISOString(),
    ...over,
  };
}

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const ctx = { params: Promise.resolve({ id: "r-1" }) };
const dialect = new PgDialect();

function queueFundAndCategory() {
  h.selectQueue.push(
    [{ id: "fund-1", entityId: "ent-1", kind: "administrative", isActive: true }],
    [{ id: "cat-1", fundKind: "administrative", flow: "expense" }],
  );
}

beforeEach(() => {
  h.selectQueue.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
  h.updateResults.length = 0;
  h.insertResult = [{ id: "txn-1" }];
  h.transaction.mockReset();
  vi.mocked(auth).mockResolvedValue({
    user: { id: "u-pay", memberId: "m-pay", email: "pay@example.com" },
  } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getReimbursementWithMember).mockReset();
  vi.mocked(getReimbursementWithMember).mockResolvedValue(reimbRow() as never);
  vi.mocked(getUserEmail).mockReset();
  vi.mocked(getUserEmail).mockResolvedValue("pat@example.com");
  vi.mocked(getBudgetLineForLinkValidation).mockReset();
  vi.mocked(sendEmail).mockReset();
  vi.mocked(sendEmail).mockResolvedValue({ success: true } as never);
  vi.mocked(resolveTreasurer).mockReset();
  vi.mocked(resolveTreasurer).mockResolvedValue({
    ok: true,
    memberId: "m-t",
    firstName: "T",
    lastName: "R",
    email: "treasurer@example.com",
  });
});

describe("auth and action gating", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(401);
  });

  it.each([{ action: "approve", boardMinute: "x" }, { action: "nope" }, {}])(
    "400 for action %j with no DB read",
    async (body) => {
      const res = await PATCH(req(body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("action must be one of: reject, pay");
      expect(getReimbursementWithMember).not.toHaveBeenCalled();
    },
  );

  it("403 on reject and pay for an approve-only user; asks for LEDGER_RECORD", async () => {
    vi.mocked(hasFeature).mockImplementation(async (_u, f) => f === FEATURES.LEDGER_APPROVE);
    for (const body of [{ action: "reject", reason: "no" }, payBody()]) {
      const res = await PATCH(req(body), ctx);
      expect(res.status).toBe(403);
    }
    expect(hasFeature).toHaveBeenCalledWith("u-pay", FEATURES.LEDGER_RECORD);
    // Gate runs before the row read: no existence oracle.
    expect(getReimbursementWithMember).not.toHaveBeenCalled();
  });

  it("404 on a missing row", async () => {
    vi.mocked(getReimbursementWithMember).mockResolvedValue(null);
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(404);
  });
});

describe("self-action block", () => {
  const variants: [string, Record<string, unknown>][] = [
    ["user id matches", { id: "u-sub", memberId: "m-other" }],
    ["member id matches with a different user id", { id: "u-other", memberId: "m-sub" }],
    ["user id matches while memberId is undefined", { id: "u-sub" }],
  ];

  it.each(variants)("pay is 403 when %s", async (_n, user) => {
    vi.mocked(auth).mockResolvedValue({ user } as never);
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You cannot pay your own reimbursement request");
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it.each(variants)("reject is 403 when %s", async (_n, user) => {
    vi.mocked(auth).mockResolvedValue({ user } as never);
    const res = await PATCH(req({ action: "reject", reason: "no" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("You cannot reject your own reimbursement request");
    expect(h.updates).toHaveLength(0);
  });

  it("a different ledger.record holder pays and rejects the same request", async () => {
    queueFundAndCategory();
    expect((await PATCH(req(payBody()), ctx)).status).toBe(200);
    expect((await PATCH(req({ action: "reject", reason: "no" }), ctx)).status).toBe(200);
  });
});

describe("pay", () => {
  it("from submitted posts a stamped, locked transaction", async () => {
    queueFundAndCategory();
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "r-1", ledgerTransactionId: "txn-1" });
    const txn = h.inserts[0];
    expect(txn.status).toBe("posted");
    expect(txn.approvedByUserId).toBe("u-pay");
    expect(txn.approvedAt).toBeInstanceOf(Date);
    expect(txn.boardMinute).toBeNull();
    expect(txn.recordedByUserId).toBe("u-pay");
    const upd = h.updates[0].set;
    expect(upd.status).toBe("paid");
    expect(upd.paidAt).toBeInstanceOf(Date);
    expect(upd.reviewedByUserId).toBe("u-pay");
    expect(upd.reviewedAt).toBeInstanceOf(Date);
  });

  it("from legacy approved copies board provenance and leaves reviewer fields alone", async () => {
    const reviewedAt = new Date("2026-08-01T00:00:00Z");
    vi.mocked(getReimbursementWithMember).mockResolvedValue(
      reimbRow({
        status: "approved",
        reviewedByUserId: "u-board",
        reviewedAt,
        boardMinute: "Minute 4",
      }) as never,
    );
    queueFundAndCategory();
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(200);
    const txn = h.inserts[0];
    expect(txn.approvedByUserId).toBe("u-board");
    expect(txn.approvedAt).toBe(reviewedAt);
    expect(txn.boardMinute).toBe("Minute 4");
    const upd = h.updates[0].set;
    expect(upd).not.toHaveProperty("reviewedByUserId");
    expect(upd).not.toHaveProperty("reviewedAt");
    expect(upd).not.toHaveProperty("boardMinute");
  });

  it.each(["paid", "rejected"])("409 from %s without opening a transaction", async (status) => {
    vi.mocked(getReimbursementWithMember).mockResolvedValue(reimbRow({ status }) as never);
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(409);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("double-pay race: zero rows from the atomic update is 409 and sends no email", async () => {
    queueFundAndCategory();
    h.updateResults.push([]);
    // The catch re-reads the row; it is now paid.
    vi.mocked(getReimbursementWithMember)
      .mockResolvedValueOnce(reimbRow() as never)
      .mockResolvedValueOnce(reimbRow({ status: "paid" }) as never);
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This reimbursement has already been marked paid");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("atomic WHERE pins status set and value columns, never updated_at", async () => {
    queueFundAndCategory();
    await PATCH(req(payBody()), ctx);
    const q = dialect.sqlToQuery(h.updates[0].where as never);
    expect(q.sql).toContain('"status" in');
    expect(q.params).toEqual(
      expect.arrayContaining(["submitted", "approved", 4500, "Supplies", "receipts/abc/r.pdf"]),
    );
    expect(q.sql).toContain('"beneficiary_cause" is null');
    expect(q.sql).not.toContain("updated_at");
  });

  it("pins a non-null cause with equality", async () => {
    vi.mocked(getReimbursementWithMember).mockResolvedValue(
      reimbRow({ beneficiaryCause: "Hunger relief" }) as never,
    );
    queueFundAndCategory();
    await PATCH(req(payBody()), ctx);
    const q = dialect.sqlToQuery(h.updates[0].where as never);
    expect(q.params).toContain("Hunger relief");
    expect(q.sql).not.toContain("beneficiary_cause\" is null");
  });

  it("stale amount token is 409 with the exact message and no transaction", async () => {
    const res = await PATCH(req(payBody({ expectedAmountCents: 2000 })), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "This request was edited after you opened it. Reload and review it again.",
    );
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("stale updatedAt token is 409", async () => {
    const res = await PATCH(
      req(payBody({ expectedUpdatedAt: new Date("2026-09-30T10:00:05Z").toISOString() })),
      ctx,
    );
    expect(res.status).toBe(409);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["expectedAmountCents missing", { expectedAmountCents: undefined }],
    ["expectedAmountCents not an integer", { expectedAmountCents: 45.5 }],
    ["expectedUpdatedAt missing", { expectedUpdatedAt: undefined }],
    ["expectedUpdatedAt invalid", { expectedUpdatedAt: "not-a-date" }],
  ])("400 when %s", async (_n, over) => {
    const res = await PATCH(req(payBody(over)), ctx);
    expect(res.status).toBe(400);
  });

  it("never-edited row (updatedAt equals submittedAt) with matching tokens is 200", async () => {
    queueFundAndCategory();
    const row = reimbRow();
    expect(row.updatedAt.getTime()).toBe(row.submittedAt.getTime());
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(200);
  });

  it.each([
    ["fundId", { fundId: undefined }],
    ["categoryId", { categoryId: undefined }],
    ["paymentDate", { paymentDate: "10/01/2026" }],
    ["paymentMethod", { paymentMethod: "wire" }],
  ])("400 when %s is missing or invalid", async (_n, over) => {
    queueFundAndCategory();
    const res = await PATCH(req(payBody(over)), ctx);
    expect(res.status).toBe(400);
  });

  it("400 when the category fund kind does not match the fund", async () => {
    h.selectQueue.push(
      [{ id: "fund-1", entityId: "ent-1", kind: "administrative", isActive: true }],
      [{ id: "cat-1", fundKind: "charitable", flow: "expense" }],
    );
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(400);
  });

  it("400 when the budget line does not match", async () => {
    queueFundAndCategory();
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue({
      id: "bl-1",
      fundId: "other-fund",
      fiscalYear: 2026,
      categoryId: "cat-1",
      flow: "expense",
    } as never);
    const res = await PATCH(req(payBody({ budgetLineId: "bl-1" })), ctx);
    expect(res.status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("reject", () => {
  it("from submitted is 200 and the WHERE includes the actionable status set — regression for reject updating a row outside the actionable status set", async () => {
    const res = await PATCH(req({ action: "reject", reason: "No receipt" }), ctx);
    expect(res.status).toBe(200);
    const q = dialect.sqlToQuery(h.updates[0].where as never);
    expect(q.sql).toContain('"status" in');
    expect(q.params).toEqual(expect.arrayContaining(["submitted", "approved"]));
    expect(h.updates[0].set.status).toBe("rejected");
  });

  it("from legacy approved is 200", async () => {
    vi.mocked(getReimbursementWithMember).mockResolvedValue(
      reimbRow({ status: "approved" }) as never,
    );
    const res = await PATCH(req({ action: "reject", reason: "Changed mind" }), ctx);
    expect(res.status).toBe(200);
  });

  it("400 without a reason", async () => {
    const res = await PATCH(req({ action: "reject", reason: "  " }), ctx);
    expect(res.status).toBe(400);
  });

  it("409 pre-read on a paid row — regression for reject overwriting an already-paid reimbursement", async () => {
    vi.mocked(getReimbursementWithMember).mockResolvedValue(reimbRow({ status: "paid" }) as never);
    const res = await PATCH(req({ action: "reject", reason: "x" }), ctx);
    expect(res.status).toBe(409);
    expect(h.updates).toHaveLength(0);
  });

  it("reject race: zero rows is 409 and sends no email — regression for a concurrent status change being clobbered by reject", async () => {
    h.updateResults.push([]);
    const res = await PATCH(req({ action: "reject", reason: "x" }), ctx);
    expect(res.status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("treasury CC (B-48)", () => {
  it("paid and rejected emails carry cc = treasurer when the resolver is ok", async () => {
    queueFundAndCategory();
    await PATCH(req(payBody()), ctx);
    await PATCH(req({ action: "reject", reason: "x" }), ctx);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(sendEmail).mock.calls) {
      expect(call[0].cc).toBe("treasurer@example.com");
    }
  });

  it("sends with no cc key, warns, and still returns 200 when the resolver fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveTreasurer).mockResolvedValue({ ok: false, reason: "none" });
    queueFundAndCategory();
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(200);
    const arg = vi.mocked(sendEmail).mock.calls[0][0];
    expect(arg).not.toHaveProperty("cc");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a throwing sendEmail still yields 200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(sendEmail).mockRejectedValue(new Error("boom"));
    queueFundAndCategory();
    const res = await PATCH(req(payBody()), ctx);
    expect(res.status).toBe(200);
    warn.mockRestore();
  });
});

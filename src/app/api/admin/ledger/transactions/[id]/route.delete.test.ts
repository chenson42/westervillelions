/**
 * T27-T30: DELETE /api/admin/ledger/transactions/[id] hardening (DECISION-110):
 * required reason, FOR UPDATE, guards unchanged, a 409 when a receipt was
 * already sent, and one snapshot audit row per request in the same transaction.
 *
 * `db.delete` / `db.insert` / `db.update` THROW outside the transaction handle,
 * so a write that escaped the transaction fails loudly. A mocked db cannot prove
 * lock semantics or the acknowledgment FK cascade; those are live checks in the
 * work-log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/reconciliation-queries", () => ({ getMatchForTransaction: vi.fn() }));
vi.mock("@/lib/receipt-storage", () => ({
  RECEIPT_KEY_REGEX: /^receipts\/.+$/,
  getReceiptStorage: vi.fn(),
}));

type Call = {
  op: "select" | "insert" | "delete";
  table?: unknown;
  forUpdate?: boolean;
  ordered?: boolean;
  values?: Record<string, unknown>;
};

const { s } = vi.hoisted(() => ({
  s: {
    calls: [] as unknown[],
    selectQueue: [] as unknown[][],
    transactionCalls: 0,
  },
}));

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => {
      const rows = s.selectQueue.shift() ?? [];
      const call: Call = { op: "select" };
      s.calls.push(call);
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          call.table = t;
          return chain;
        },
        where: () => chain,
        orderBy: () => {
          call.ordered = true;
          return chain;
        },
        limit: () => chain,
        for: () => {
          call.forUpdate = true;
          return chain;
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(res, rej),
      };
      return chain;
    },
    insert: (table: unknown) => {
      const call: Call = { op: "insert", table };
      s.calls.push(call);
      return {
        values: (values: Record<string, unknown>) => {
          call.values = values;
          return Promise.resolve();
        },
      };
    },
    delete: (table: unknown) => {
      const call: Call = { op: "delete", table };
      s.calls.push(call);
      return { where: () => Promise.resolve() };
    },
  };
  const outside = (name: string) => () => {
    throw new Error(`db.${name} used outside the transaction`);
  };
  return {
    db: {
      select: outside("select"),
      insert: outside("insert"),
      delete: outside("delete"),
      update: outside("update"),
      query: {},
      transaction: async (cb: (t: unknown) => unknown) => {
        s.transactionCalls += 1;
        return cb(tx);
      },
    },
  };
});

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import {
  ledgerTransactions,
  ledgerAcknowledgments,
  ledgerAuditLog,
} from "@/lib/db/schema";
import { parseAuditBefore, parseAuditDetails } from "@/lib/ledger-correction";

const calls = () => s.calls as Call[];
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PARTNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REASON = "Entered twice by mistake";

function req(body: unknown): NextRequest {
  return {
    json: async () => {
      if (body === "THROW") throw new SyntaxError("bad json");
      return body;
    },
  } as unknown as NextRequest;
}
const params = (id = ID) => ({ params: Promise.resolve({ id }) });

const ACTIVITY = { id: "fund-activity", name: "Activity Fund", slug: "activity", kind: "activity" };
const BANK = { id: "bank-1", name: "Administrative Checking" };

function txn(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    entityId: "club",
    fundId: ACTIVITY.id,
    bankAccountId: BANK.id,
    categoryId: null,
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 5000,
    party: "Example Donor",
    memo: "note",
    donorId: null,
    checkNumber: "1001",
    paymentMethod: "check",
    status: "posted",
    approvedAt: null,
    reconciled: false,
    reconciledSessionId: null,
    duesPaymentId: null,
    transferGroupId: null,
    budgetLineId: null,
    ...over,
  };
}

/** Queue the selects the handler issues after the lock(s): acks, funds, banks. */
function queueTail(acks: unknown[] = []) {
  s.selectQueue.push(acks, [ACTIVITY], [BANK]);
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  s.calls = [];
  s.selectQueue = [];
  s.transactionCalls = 0;
});

describe("reason required (T27)", () => {
  const bad: Array<[string, unknown]> = [
    ["a missing body", null],
    ["an unparseable body", "THROW"],
    ["an empty reason", { reason: "" }],
    ["a short reason", { reason: "too short" }],
    ["an over-long reason", { reason: "a".repeat(501) }],
    ["a non-string reason", { reason: 42 }],
  ];
  it.each(bad)("%s is 400 with no database work", async (_n, body) => {
    const res = await DELETE(req(body), params());
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
    expect(s.transactionCalls).toBe(0);
  });

  it("a missing body tells the user to refresh", async () => {
    const res = await DELETE(req(null), params());
    expect((await res.json()).error).toBe("A reason is required. Refresh the page and try again.");
  });

  it("401 unauthenticated, 403 without LEDGER_RECORD, 404 for a non-uuid id", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await DELETE(req({ reason: REASON }), params())).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u" } } as never);
    vi.mocked(hasFeature).mockResolvedValue(false);
    expect((await DELETE(req({ reason: REASON }), params())).status).toBe(403);
    vi.mocked(hasFeature).mockResolvedValue(true);
    expect((await DELETE(req({ reason: REASON }), params("not-a-uuid"))).status).toBe(404);
    expect(s.transactionCalls).toBe(0);
  });

  it("a missing row is 404", async () => {
    s.selectQueue = [[]];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(404);
    expect(calls().filter((c) => c.op !== "select")).toHaveLength(0);
  });
});

describe("guards unchanged (T28)", () => {
  it.each([
    ["approved", { approvedAt: new Date() }, "Approved transactions cannot be deleted"],
    ["rejected", { status: "rejected" }, "Rejected transactions cannot be deleted"],
    [
      "session-reconciled",
      { reconciled: true, reconciledSessionId: "s1" },
      "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
    ],
  ])("%s is 403 with nothing written", async (_n, over, message) => {
    s.selectQueue = [[txn(over)]];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(message);
    expect(calls().filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("the target row is selected FOR UPDATE on ledgerTransactions", async () => {
    s.selectQueue = [[txn()]];
    queueTail();
    await DELETE(req({ reason: REASON }), params());
    const first = calls()[0];
    expect(first).toMatchObject({ op: "select", table: ledgerTransactions, forUpdate: true });
  });

  it("a pair locks every row of the group FOR UPDATE, ordered by id", async () => {
    s.selectQueue = [[txn({ transferGroupId: "g1" })], [txn({ transferGroupId: "g1" }), txn({ id: PARTNER_ID, transferGroupId: "g1" })]];
    queueTail();
    await DELETE(req({ reason: REASON }), params());
    const group = calls()[1];
    expect(group).toMatchObject({ op: "select", table: ledgerTransactions, forUpdate: true, ordered: true });
  });

  it.each([
    ["approved", { approvedAt: new Date() }, "Cannot delete a transfer where one or both rows are approved"],
    [
      "session-reconciled",
      { reconciledSessionId: "s1" },
      "Cannot delete a transfer where one or both rows were cleared by a closed reconciliation session — reopen it first",
    ],
  ])("a pair whose partner is %s is 403", async (_n, over, message) => {
    s.selectQueue = [
      [txn({ transferGroupId: "g1" })],
      [txn({ transferGroupId: "g1" }), txn({ id: PARTNER_ID, transferGroupId: "g1", ...over })],
    ];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(message);
    expect(calls().filter((c) => c.op !== "select")).toHaveLength(0);
  });
});

describe("sent acknowledgment (T29)", () => {
  const SENT = { id: "ack-1", donationTxnId: ID, sentAt: new Date("2026-09-20") };

  it("a sent acknowledgment is 409 receipt_sent with nothing written", async () => {
    s.selectQueue = [[txn()], [SENT]];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "A receipt was already sent to the donor for this gift. Record a refund entry instead.",
      code: "receipt_sent",
    });
    expect(calls().filter((c) => c.op === "insert" || c.op === "delete")).toHaveLength(0);
  });

  it("a sent acknowledgment on the PARTNER leg of a pair is 409 too", async () => {
    s.selectQueue = [
      [txn({ transferGroupId: "g1" })],
      [txn({ transferGroupId: "g1" }), txn({ id: PARTNER_ID, transferGroupId: "g1" })],
      [{ id: "ack-2", donationTxnId: PARTNER_ID, sentAt: new Date("2026-09-20") }],
    ];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(409);
    expect(calls().filter((c) => c.op === "insert" || c.op === "delete")).toHaveLength(0);
  });

  it("an UNSENT acknowledgment is allowed: removed with the row, reported, and snapshotted", async () => {
    s.selectQueue = [[txn()]];
    queueTail([{ id: "ack-3", donationTxnId: ID, sentAt: null }]);
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1, acknowledgmentRemoved: true });
    const audit = calls().find((c) => c.op === "insert")!;
    const before = parseAuditBefore("transaction_deleted", audit.values!.before as string);
    expect("rows" in before && before.rows[0].acknowledgment).toEqual({ existed: true, sent: false });
    expect(calls().some((c) => c.op === "select" && c.table === ledgerAcknowledgments)).toBe(true);
  });
});

describe("audit snapshot (T30)", () => {
  it("one audit insert, before the delete, with a null target and the original row id in the snapshot", async () => {
    s.selectQueue = [[txn()]];
    queueTail();
    const res = await DELETE(req({ reason: `  ${REASON}  ` }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1, acknowledgmentRemoved: false });

    const writes = calls().filter((c) => c.op === "insert" || c.op === "delete");
    expect(writes.map((c) => c.op)).toEqual(["insert", "delete"]);
    const audit = writes[0];
    expect(audit.table).toBe(ledgerAuditLog);
    expect(audit.values).toMatchObject({
      actorUserId: "user-1",
      action: "transaction_deleted",
      targetTransactionId: null,
      targetCategoryId: null,
      after: null,
    });

    const before = parseAuditBefore("transaction_deleted", audit.values!.before as string);
    expect("rows" in before).toBe(true);
    if (!("rows" in before)) return;
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({
      id: ID,
      reconciled: false,
      reconciledSessionId: null,
      duesPaymentId: null,
      transferGroupId: null,
      amountCents: 5000,
      fund: { name: "Activity Fund", slug: "activity", kind: "activity" },
      bankAccount: { id: BANK.id, name: BANK.name },
    });
    const details = parseAuditDetails("transaction_deleted", audit.values!.details as string);
    expect(details).toMatchObject({ reason: REASON, entityId: "club", rowCount: 1, amountCents: 5000, acknowledgmentRemoved: false });
  });

  it("a transfer pair yields ONE audit row with two snapshots and deleted: 2", async () => {
    s.selectQueue = [
      [txn({ transferGroupId: "g1", flow: "expense" })],
      [txn({ transferGroupId: "g1", flow: "expense" }), txn({ id: PARTNER_ID, transferGroupId: "g1" })],
    ];
    queueTail();
    const res = await DELETE(req({ reason: REASON }), params());
    expect(await res.json()).toEqual({ deleted: 2, acknowledgmentRemoved: false });
    const inserts = calls().filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    expect(calls().filter((c) => c.op === "delete")).toHaveLength(2);
    const before = parseAuditBefore("transaction_deleted", inserts[0].values!.before as string);
    expect("rows" in before && before.rows.map((r) => r.id)).toEqual([ID, PARTNER_ID]);
    expect("rows" in before && before.rows[0].transferGroupId).toBe("g1");
    expect(parseAuditDetails("transaction_deleted", inserts[0].values!.details as string)).toMatchObject({ rowCount: 2 });
  });

  it("a legacy-reconciled row is still deletable and its snapshot records reconciled: true", async () => {
    s.selectQueue = [[txn({ reconciled: true })]];
    queueTail();
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(200);
    const audit = calls().find((c) => c.op === "insert")!;
    const before = parseAuditBefore("transaction_deleted", audit.values!.before as string);
    expect("rows" in before && before.rows[0].reconciled).toBe(true);
    expect(parseAuditDetails("transaction_deleted", audit.values!.details as string)).toMatchObject({ reconciled: true });
  });

  it("a double submit: the second call is 404 and the total is one audit row", async () => {
    s.selectQueue = [[txn()]];
    queueTail();
    expect((await DELETE(req({ reason: REASON }), params())).status).toBe(200);
    s.selectQueue = [[]]; // the row is gone by the time the second request locks
    expect((await DELETE(req({ reason: REASON }), params())).status).toBe(404);
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(1);
    expect(calls().filter((c) => c.op === "delete")).toHaveLength(1);
  });
});

// B-108 / DECISION-114 / T22: the approvedAt guard stays unconditional. DELETE
// reads the reason first (DECISION-110), but an approved row is refused inside
// the locked transaction no matter what the body says, and writes nothing.
describe("DELETE — approved rows stay refused (T22)", () => {
  it("403s an approved expense row even with a valid reason; no delete, insert or audit row", async () => {
    s.selectQueue = [[txn({ flow: "expense", approvedAt: new Date("2026-10-01T09:00:00Z"), bankAccountId: null })]];
    const res = await DELETE(req({ reason: REASON }), params());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Approved transactions cannot be deleted");
    expect(calls().filter((c) => c.op === "delete" || c.op === "insert")).toHaveLength(0);
  });
});

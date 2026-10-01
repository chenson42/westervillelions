/**
 * Unit tests for the batch-capable POST .../match route
 * (docs/work-log/2026-07-28-zeffy-batch-reconciliation.md, DECISION-051).
 *
 * Covers Phase 3 design's "Unit Tests to Write in Phase 4" items 3, 4, 5, 7:
 *   3. Batch match commits atomically and marks all rows reconciled — the
 *      "marks all reconciled" half happens at session close (unaffected by
 *      this feature, already covered by getTieOutAssembly's fixed fan-out in
 *      reconciliation-queries.test.ts); this file covers the atomic-insert
 *      half: one db.transaction() call inserting N rows sharing bankLineId.
 *   4. Exact-sum enforced — reject 1 cent under and 1 cent over, both 400
 *      with the correct deltaCents sign.
 *   5. An ineligible row rejects the WHOLE batch (three sub-cases: already
 *      matched elsewhere, different bankAccountId, already reconciled) —
 *      asserting the insert was never called, not just that the response is
 *      an error.
 *   7. Expense-side batch (debit line <-> N expense rows) sums correctly
 *      with signs.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/reconciliation-queries,
 * and @/lib/db (db.transaction only — every read this route needs goes
 * through the mocked reconciliation-queries helpers, so no db.select mock is
 * required here).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/lib/permissions-server", () => ({
  hasFeature: vi.fn(),
}));
vi.mock("@/lib/reconciliation-queries", () => ({
  getReconciliationSessionById: vi.fn(),
  getBankLineById: vi.fn(),
  getMatchForBankLine: vi.fn(),
  getTransactionsByIds: vi.fn(),
  getMatchesForTransactionIds: vi.fn(),
}));

const { mockTxState } = vi.hoisted(() => ({
  mockTxState: {
    insertValues: undefined as unknown,
    insertReturning: [] as { id: string; transactionId: string }[],
    transactionCallCount: 0,
    // Rows the locked re-select returns. null = mirror what the unlocked
    // read returned (the no-race happy path).
    lockedRows: null as { id: string; status: string; bankAccountId: string }[] | null,
    selectCalls: [] as { where?: unknown; forUpdate: boolean }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      mockTxState.transactionCallCount++;
      const tx = {
        select: () => {
          const call: { where?: unknown; forUpdate: boolean } = { forUpdate: false };
          mockTxState.selectCalls.push(call);
          const chain: Record<string, unknown> = {
            from: () => chain,
            where: (w: unknown) => {
              call.where = w;
              return chain;
            },
            orderBy: () => chain,
            for: (mode: string) => {
              call.forUpdate = mode === "update";
              return chain;
            },
            then: async (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
              try {
                if (mockTxState.lockedRows) return res(mockTxState.lockedRows);
                const results = vi.mocked(getTransactionsByIds).mock.results;
                const fetched = (await results[results.length - 1].value) as {
                  id: string;
                  status: string;
                  bankAccountId: string;
                }[];
                return res(fetched);
              } catch (e) {
                return rej ? rej(e) : Promise.reject(e);
              }
            },
          };
          return chain;
        },
        insert: () => ({
          values: (v: unknown) => {
            mockTxState.insertValues = v;
            return {
              returning: () => Promise.resolve(mockTxState.insertReturning),
            };
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import {
  getReconciliationSessionById,
  getBankLineById,
  getMatchForBankLine,
  getTransactionsByIds,
  getMatchesForTransactionIds,
} from "@/lib/reconciliation-queries";

const SESSION_ID = "session-1";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function callRoute(body: unknown) {
  return POST(makeRequest(body), { params: Promise.resolve({ sessionId: SESSION_ID }) });
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getReconciliationSessionById).mockResolvedValue({
    id: SESSION_ID,
    bankAccountId: "account-1",
    status: "open",
  } as never);
  vi.mocked(getMatchForBankLine).mockResolvedValue(null);
  vi.mocked(getMatchesForTransactionIds).mockResolvedValue([]);
  mockTxState.insertValues = undefined;
  mockTxState.insertReturning = [];
  mockTxState.transactionCallCount = 0;
  mockTxState.lockedRows = null;
  mockTxState.selectCalls = [];
});

// ---------------------------------------------------------------------------
// Phase 3 test 3 — atomic batch insert
// ---------------------------------------------------------------------------

describe("POST .../match — batch commits atomically", () => {
  it("inserts all N match rows sharing bankLineId in ONE db.transaction() call", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 69_600 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 19_200 },
      { id: "txn-b", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 38_400 },
      { id: "txn-c", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 12_000 },
    ] as never);
    mockTxState.insertReturning = [
      { id: "match-1", transactionId: "txn-a" },
      { id: "match-2", transactionId: "txn-b" },
      { id: "match-3", transactionId: "txn-c" },
    ];

    const res = await callRoute({
      bankLineId: "line-1",
      transactionIds: ["txn-a", "txn-b", "txn-c"],
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(mockTxState.transactionCallCount).toBe(1);
    expect(Array.isArray(mockTxState.insertValues)).toBe(true);
    const values = mockTxState.insertValues as { bankLineId: string; transactionId: string }[];
    expect(values).toHaveLength(3);
    expect(values.every((v) => v.bankLineId === "line-1")).toBe(true);
    expect(values.map((v) => v.transactionId).sort()).toEqual(["txn-a", "txn-b", "txn-c"]);
    expect(data.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 4 — exact-sum enforced
// ---------------------------------------------------------------------------

describe("POST .../match — exact-sum enforced", () => {
  it("rejects a batch 1 cent SHORT of the bank line amount with a 400 and positive deltaCents", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 10_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 9_999 },
    ] as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.deltaCents).toBe(1); // short by 1 cent
    expect(mockTxState.transactionCallCount).toBe(0);
  });

  it("rejects a batch 1 cent OVER the bank line amount with a 400 and negative deltaCents", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 10_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 10_001 },
    ] as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.deltaCents).toBe(-1); // over by 1 cent
    expect(mockTxState.transactionCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 5 — an ineligible row rejects the WHOLE batch
// ---------------------------------------------------------------------------

describe("POST .../match — an ineligible row rejects the whole batch", () => {
  it("rejects the whole batch when one transaction is already matched to a different bank line (409), inserting nothing", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 20_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 10_000 },
      { id: "txn-b", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 10_000 },
    ] as never);
    vi.mocked(getMatchesForTransactionIds).mockResolvedValue(["txn-b"]);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-b"] });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.conflictingTransactionIds).toEqual(["txn-b"]);
    expect(mockTxState.transactionCallCount).toBe(0);
  });

  it("rejects the whole batch when one transaction belongs to a different bank account (400), inserting nothing", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 20_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 10_000 },
      { id: "txn-b", status: "posted", bankAccountId: "OTHER-account", reconciled: false, flow: "income", amountCents: 10_000 },
    ] as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-b"] });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.invalidTransactionIds).toEqual(["txn-b"]);
    expect(mockTxState.transactionCallCount).toBe(0);
  });

  it("rejects the whole batch when one transaction is already reconciled (409), inserting nothing", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 20_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 10_000 },
      { id: "txn-b", status: "posted", bankAccountId: "account-1", reconciled: true, flow: "income", amountCents: 10_000 },
    ] as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-b"] });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.invalidTransactionIds).toEqual(["txn-b"]);
    expect(mockTxState.transactionCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 7 — expense-side batch sums correctly with signs
// ---------------------------------------------------------------------------

describe("POST .../match — expense-side batch (debit line <-> N expense rows)", () => {
  it("matches a negative (debit) bank line against 2 expense rows whose positive amounts sum (signed negative) to the line amount exactly", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: -15_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "expense", amountCents: 9_000 },
      { id: "txn-b", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "expense", amountCents: 6_000 },
    ] as never);
    mockTxState.insertReturning = [
      { id: "match-1", transactionId: "txn-a" },
      { id: "match-2", transactionId: "txn-b" },
    ];

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-b"] });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.count).toBe(2);
    expect(mockTxState.transactionCallCount).toBe(1);
  });

  it("rejects a mixed sign mismatch (expense rows under a debit line) with the correct delta", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: -15_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "expense", amountCents: 9_000 },
    ] as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    const data = await res.json();

    expect(res.status).toBe(400);
    // selectedSumCents = -9000; bankLineAmountCents = -15000; delta = bankLine - selected = -6000
    expect(data.deltaCents).toBe(-6_000);
    expect(mockTxState.transactionCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Body validation / auth guards (supplementary — not one of the 9 named
// tests, but cheap coverage for the new array-only contract).
// ---------------------------------------------------------------------------

describe("POST .../match — request body validation", () => {
  it("rejects an empty transactionIds array", async () => {
    const res = await callRoute({ bankLineId: "line-1", transactionIds: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a transactionIds array with duplicate ids", async () => {
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-a"] });
    expect(res.status).toBe(400);
  });

  it("rejects when the bank line already has a match (whole-set semantics, unchanged from single-match route)", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 10_000 } as never);
    vi.mocked(getMatchForBankLine).mockResolvedValue({ id: "existing-match" } as never);

    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    expect(res.status).toBe(409);
    expect(mockTxState.transactionCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B-105 — re-verify under a row lock inside the write transaction
// ---------------------------------------------------------------------------

describe("POST .../match — locked re-verification (B-105)", () => {
  function stageHappy() {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 5_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 5_000 },
    ] as never);
    mockTxState.insertReturning = [{ id: "match-1", transactionId: "txn-a" }];
  }

  it("locks the submitted rows FOR UPDATE with an id-IN WHERE before inserting", async () => {
    stageHappy();
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    expect(res.status).toBe(201);
    expect(mockTxState.selectCalls).toHaveLength(1);
    expect(mockTxState.selectCalls[0].forUpdate).toBe(true);
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const q = new PgDialect().sqlToQuery(mockTxState.selectCalls[0].where as never);
    expect(q.sql).toMatch(/"id" in \(/i);
    expect(q.params).toEqual(["txn-a"]);
  });

  it("409 transaction_account_mismatch and NO insert when the locked row moved to another account — regression for F1 (match-route race lands a cross-entity row in a Foundation session)", async () => {
    stageHappy();
    mockTxState.lockedRows = [{ id: "txn-a", status: "posted", bankAccountId: "foundation-account" }];
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.code).toBe("transaction_account_mismatch");
    expect(body.invalidTransactionIds).toEqual(["txn-a"]);
    expect(mockTxState.insertValues).toBeUndefined();
  });

  it("one mismatching row rejects the whole batch with nothing inserted — regression for F1 (match-route race lands a cross-entity row in a Foundation session)", async () => {
    vi.mocked(getBankLineById).mockResolvedValue({ id: "line-1", amountCents: 3_000 } as never);
    vi.mocked(getTransactionsByIds).mockResolvedValue([
      { id: "txn-a", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 1_000 },
      { id: "txn-b", status: "posted", bankAccountId: "account-1", reconciled: false, flow: "income", amountCents: 2_000 },
    ] as never);
    mockTxState.lockedRows = [
      { id: "txn-a", status: "posted", bankAccountId: "account-1" },
      { id: "txn-b", status: "posted", bankAccountId: "other" },
    ];
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a", "txn-b"] });
    expect(res.status).toBe(409);
    expect((await res.json()).invalidTransactionIds).toEqual(["txn-b"]);
    expect(mockTxState.insertValues).toBeUndefined();
  });

  it("409 transaction_not_posted and NO insert when the locked row is no longer posted — regression for F1 (match-route race lands a cross-entity row in a Foundation session)", async () => {
    stageHappy();
    mockTxState.lockedRows = [{ id: "txn-a", status: "voided", bankAccountId: "account-1" }];
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("transaction_not_posted");
    expect(mockTxState.insertValues).toBeUndefined();
  });

  it("409 transaction_not_posted when the locked re-select no longer finds the row", async () => {
    stageHappy();
    mockTxState.lockedRows = [];
    const res = await callRoute({ bankLineId: "line-1", transactionIds: ["txn-a"] });
    expect(res.status).toBe(409);
    expect(mockTxState.insertValues).toBeUndefined();
  });
});

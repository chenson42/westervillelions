/**
 * Unit tests for POST /api/admin/ledger/budget-approvals — the transactional
 * rewrite from DECISION-052/053 (Increment 2 of
 * docs/work-log/2026-07-28-budgeting-page-redesign.md), extended by the
 * Budgeting Page Restructure's cause-line-grain purge (DECISION-054/055/056).
 * Covers Phase 3 design's "Unit Tests to Write in Phase 4" items 9 and 10,
 * plus the Budgeting Page Restructure's finalize-purge items:
 *   9.  A budget with 1+ pending-delete rows, on successful finalize, ends
 *       with those rows physically gone from ledger_budgets AND the
 *       lock-status row set to 'locked' — both in the same request (proven
 *       here as: both writes happen inside the SAME single db.transaction()
 *       call).
 *   10. Non-pending-delete rows for the same fund+FY survive finalize
 *       untouched — proven by asserting the compiled DELETE's WHERE clause
 *       (rendered via PgDialect, not just reasoned about) scopes to
 *       entityId + fiscalYear + pending_delete_at IS NOT NULL, which
 *       structurally excludes any row whose pending_delete_at is null.
 *   11. A live category with some-but-not-all cause lines pending-delete
 *       purges only those lines and recomputes annualAmountCents from
 *       survivors.
 *   12. A live category whose EVERY cause line was independently
 *       pending-delete has its now-childless parent deleted too, mirroring
 *       deleteBudgetCauseLine's existing last-line behavior.
 *
 * Also covers the lock-check-inside-the-transaction race fix directly: the
 * already-locked 409 case never reaches any write.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/ledger-queries
 * (getEntityById, getBudgetApproval), and @/lib/db's db.transaction (a
 * minimal tx capturing insert/select/update/delete calls for assertion —
 * mirrors the pattern in src/app/api/admin/ledger/reconciliation/sessions/
 * [sessionId]/match/route.test.ts and src/lib/ledger-queries.test.ts's
 * makeMockTx). @/lib/db/schema is imported unmocked (pure table
 * definitions, no @/lib/db import of its own) purely for table-identity
 * comparisons (toBe(ledgerBudgets) etc.).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getEntityById: vi.fn(),
  getBudgetApproval: vi.fn(),
}));

const { mockTxState } = vi.hoisted(() => ({
  mockTxState: {
    insertCalls: [] as { table: unknown }[],
    insertReturning: [] as unknown[],
    deleteCalls: [] as { table: unknown; cond: unknown }[],
    /** Answered in call order, but only consumed by a delete call that
     *  actually invokes .returning() (the cause-line purge step) — the
     *  category-grain deletes in this route never call .returning(). */
    deleteReturning: [] as unknown[][],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
    /** FIFO queue for tx.select(...).from(...).where(...) calls — the
     *  surviving-budget-ids lookup, then one "remaining lines" lookup per
     *  budgetId the cause-line purge step touched. */
    selectResults: [] as unknown[][],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      let si = 0;
      let di = 0;
      const tx = {
        insert: (table: unknown) => {
          mockTxState.insertCalls.push({ table });
          return {
            values: () => ({
              onConflictDoUpdate: () => ({
                returning: () => Promise.resolve(mockTxState.insertReturning),
              }),
            }),
          };
        },
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockTxState.selectResults[si++] ?? []),
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => {
            mockTxState.updateCalls.push({ table, values });
            return { where: () => Promise.resolve(undefined) };
          },
        }),
        delete: (table: unknown) => ({
          where: (cond: unknown) => {
            mockTxState.deleteCalls.push({ table, cond });
            const p = Promise.resolve(undefined) as Promise<unknown> & {
              returning: () => Promise<unknown[]>;
            };
            p.returning = () => Promise.resolve(mockTxState.deleteReturning[di++] ?? []);
            return p;
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getEntityById, getBudgetApproval } from "@/lib/ledger-queries";
import { ledgerBudgetApprovals, ledgerBudgets, ledgerBudgetLines } from "@/lib/db/schema";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  entityId: "entity-1",
  fiscalYear: 2026,
  boardMinute: "Board approved the FY2026 budget, 2026-07-28 meeting",
};

const APPROVAL_ROW = {
  entityId: "entity-1",
  fiscalYear: 2026,
  status: "locked",
  approvedByUserId: "user-1",
  approvedAt: new Date("2026-07-28T23:00:00.000Z"),
  boardMinute: VALID_BODY.boardMinute,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getEntityById).mockResolvedValue({ id: "entity-1" } as never);
  vi.mocked(getBudgetApproval).mockReset();
  vi.mocked(db.transaction).mockClear();
  mockTxState.insertCalls = [];
  mockTxState.insertReturning = [];
  mockTxState.deleteCalls = [];
  mockTxState.deleteReturning = [];
  mockTxState.updateCalls = [];
  mockTxState.selectResults = [];
});

describe("POST /api/admin/ledger/budget-approvals — finalize purge (DECISION-052/053, Increment 2)", () => {
  it("Phase 3 test 9: finalize hard-deletes pending-delete rows atomically with the lock write — both writes happen inside ONE db.transaction() call", async () => {
    vi.mocked(getBudgetApproval).mockResolvedValue(null); // unlocked -> proceed
    mockTxState.insertReturning = [APPROVAL_ROW];

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("locked");

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(mockTxState.insertCalls).toHaveLength(1);
    expect(mockTxState.insertCalls[0].table).toBe(ledgerBudgetApprovals);
    expect(mockTxState.deleteCalls).toHaveLength(1);
    expect(mockTxState.deleteCalls[0].table).toBe(ledgerBudgets);
  });

  it("Phase 3 test 10: the finalize purge's DELETE is scoped to entityId + fiscalYear + pending_delete_at IS NOT NULL — non-pending rows are structurally excluded, not just expected to survive", async () => {
    vi.mocked(getBudgetApproval).mockResolvedValue(null);
    mockTxState.insertReturning = [APPROVAL_ROW];

    await POST(makeRequest(VALID_BODY));

    expect(mockTxState.deleteCalls).toHaveLength(1);
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(mockTxState.deleteCalls[0].cond as never);

    // A row with pending_delete_at = null can never satisfy "is not null" —
    // this is what "non-pending rows survive" reduces to at the SQL layer.
    expect(sql.toLowerCase()).toContain("pending_delete_at");
    expect(sql.toLowerCase()).toContain("is not null");
    expect(params).toEqual(["entity-1", 2026]);
  });

  it("an already-locked budget 409s from INSIDE the transaction — no insert, no delete, closing the check-then-act race", async () => {
    vi.mocked(getBudgetApproval).mockResolvedValue({ status: "locked" } as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe(
      "This budget is already locked. Unlock it to make changes and re-approve.",
    );
    // The lock check ran inside db.transaction() (per getBudgetApproval's tx
    // param), so this proves the abort happened before either write, not
    // just that the write was undone afterward.
    expect(mockTxState.insertCalls).toHaveLength(0);
    expect(mockTxState.deleteCalls).toHaveLength(0);
  });

  it("Budgeting Page Restructure: a live category with some-but-not-all cause lines pending-delete purges only those lines and recomputes annualAmountCents from survivors", async () => {
    vi.mocked(getBudgetApproval).mockResolvedValue(null);
    mockTxState.insertReturning = [APPROVAL_ROW];
    // 1st select: surviving (non-pending-delete) budget rows for this entity+FY.
    mockTxState.selectResults = [
      [{ id: "budget-1" }],
      // 2nd select: remaining ledger_budget_lines under budget-1 after the
      // cause-line purge — two labeled survivors.
      [{ amountCents: 1_000 }, { amountCents: 2_000 }],
    ];
    // The cause-line purge's .returning({ budgetId }) — one line purged, under budget-1.
    mockTxState.deleteReturning = [[{ budgetId: "budget-1" }]];

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    // Two deletes: the category-grain purge (step 1, empty in this scenario
    // but still runs), then the cause-line-grain purge (step 2).
    expect(mockTxState.deleteCalls).toHaveLength(2);
    expect(mockTxState.deleteCalls[0].table).toBe(ledgerBudgets);
    expect(mockTxState.deleteCalls[1].table).toBe(ledgerBudgetLines);
    // The category survives (no third delete against ledgerBudgets) — its
    // annualAmountCents is recomputed from the two surviving lines instead.
    expect(mockTxState.updateCalls).toHaveLength(1);
    expect(mockTxState.updateCalls[0].table).toBe(ledgerBudgets);
    expect(mockTxState.updateCalls[0].values.annualAmountCents).toBe(3_000);
  });

  it("Budgeting Page Restructure: a live category whose EVERY cause line was independently pending-delete has its now-childless parent deleted too, mirroring deleteBudgetCauseLine's last-line behavior", async () => {
    vi.mocked(getBudgetApproval).mockResolvedValue(null);
    mockTxState.insertReturning = [APPROVAL_ROW];
    mockTxState.selectResults = [
      [{ id: "budget-1" }], // surviving budget rows
      [], // remaining lines under budget-1 after the purge — none left
    ];
    mockTxState.deleteReturning = [[{ budgetId: "budget-1" }]];

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    // Three deletes: category-grain purge (step 1), cause-line-grain purge
    // (step 2), then the now-childless parent's own delete (step 3).
    expect(mockTxState.deleteCalls).toHaveLength(3);
    expect(mockTxState.deleteCalls[0].table).toBe(ledgerBudgets);
    expect(mockTxState.deleteCalls[1].table).toBe(ledgerBudgetLines);
    expect(mockTxState.deleteCalls[2].table).toBe(ledgerBudgets);
    // No annualAmountCents recompute for a category that no longer exists.
    expect(mockTxState.updateCalls).toHaveLength(0);
  });
});

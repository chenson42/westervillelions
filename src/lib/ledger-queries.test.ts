/**
 * Unit tests for the Cause-Tagged Budget Line Items write core in
 * src/lib/ledger-queries.ts (B-17 Increment A, DECISION-045/046):
 * upsertBudgetCauseLine, deleteBudgetCauseLine, collapseBudgetCauseLines.
 *
 * These tests mock the Drizzle transaction client (tx), mirroring the
 * established pattern in src/lib/dues-ledger-sync.test.ts — call-order-based
 * canned responses for select(), with insert()/update()/delete() calls
 * captured for assertion rather than backed by a real (or fully-simulated)
 * database. Real dedup/persistence guarantees (the (budgetId, cause) unique
 * constraint's onConflictDoUpdate behavior) are Postgres/Drizzle's job,
 * already exercised elsewhere in this codebase (upsertBudgetLine); these
 * tests verify THIS module's code always wires that up correctly — the
 * right conflict target, the right values, and the right recomputed total —
 * rather than re-proving Postgres semantics.
 *
 * Phase 3 design (2026-07-27-ledger-cause-budget-lines.md, "Unit Tests to
 * Write in Phase 4", items 8-11) requires:
 *   - Uniqueness: two upsertBudgetCauseLine() calls with the same
 *     (fundId, fiscalYear, categoryId, flow, cause) result in one row
 *     (update, not a duplicate); the second call's amount wins.
 *   - Lock guard: all three functions return { ok: false, status: 409 }
 *     against a locked (entityId, fiscalYear) fixture, without writing any row.
 *   - Parent-total rollup: after upsertBudgetCauseLine adds a second cause
 *     line, ledger_budgets.annualAmountCents equals the sum of both children.
 *   - Parent-delete-on-empty: deleteBudgetCauseLine on a category's last
 *     remaining cause line returns action: "parent_deleted", and the parent
 *     ledger_budgets row is deleted (not just left stale).
 *
 * Also covers the qa Phase 5 (2026-07-27) regression finding: the
 * PRE-EXISTING upsertBudgetLine() — reachable via PATCH /api/admin/ledger/budgets
 * and the guided-seed route's top-level per-category loop under
 * mode:"overwrite" — silently overwrote a budget row's annualAmountCents with
 * zero awareness of existing ledger_budget_lines children, desyncing the
 * parent's rolled-up total from its cause-line children. Reproduced live by
 * qa (see the Phase 5 section of docs/work-log/2026-07-27-ledger-cause-budget-lines.md)
 * against a category with 2 cause lines summing to $20.00, overwritten to
 * $500.00 via the old lump-sum path with a 200 OK and no error.
 */

import { describe, it, expect, vi } from "vitest";

// ledger-queries.ts imports the real `db` (src/lib/db), which throws at import
// time when DATABASE_URL/DB_URL is unset (e.g. a bare `pnpm test` or CI without
// .env.local). These tests never touch the real db export — every case drives a
// mock transaction client passed in as `tx` — so we mock the module to keep the
// suite hermetic, mirroring src/lib/members.test.ts.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  upsertBudgetCauseLine,
  deleteBudgetCauseLine,
  collapseBudgetCauseLines,
  upsertBudgetLine,
} from "./ledger-queries";
import { ledgerFunds, ledgerCategories, ledgerBudgets, ledgerBudgetLines } from "./db/schema";

// ---------------------------------------------------------------------------
// Minimal Drizzle transaction client mock factory
// ---------------------------------------------------------------------------

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
  conflictMode: "doNothing" | "doUpdate";
};
type UpdateCall = { table: unknown; values: Record<string, unknown> };
type DeleteCall = { table: unknown };

/**
 * select() calls are answered in call order from `selectResults` (one entry
 * per select().from().where() call — supports both `await ...where()` and
 * `await ...where().limit(1)`). insert()/update()/delete() calls are
 * captured into the returned arrays for assertion; insert()'s .returning()
 * is answered in call order from `insertReturning`, and delete()'s
 * .returning() (only used by the ledgerBudgetLines line-delete) is answered
 * in call order from `deleteReturning`.
 */
function makeMockTx(opts: {
  selectResults: unknown[][];
  insertReturning?: unknown[][];
  deleteReturning?: unknown[][];
}) {
  let si = 0;
  let ii = 0;
  let di = 0;
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const deleteCalls: DeleteCall[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = opts.selectResults[si++] ?? [];
          const p = Promise.resolve(rows) as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
          p.limit = () => Promise.resolve(rows);
          return p;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          insertCalls.push({ table, values, conflictMode: "doNothing" });
          return { returning: () => Promise.resolve(opts.insertReturning?.[ii++] ?? []) };
        },
        onConflictDoUpdate: () => {
          insertCalls.push({ table, values, conflictMode: "doUpdate" });
          return { returning: () => Promise.resolve(opts.insertReturning?.[ii++] ?? []) };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ table, values });
        return { where: async () => undefined };
      },
    }),
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return {
        where: () => {
          const p = Promise.resolve(undefined) as Promise<unknown> & { returning: () => Promise<unknown[]> };
          p.returning = () => Promise.resolve(opts.deleteReturning?.[di++] ?? []);
          return p;
        },
      };
    },
  };

  return { tx, insertCalls, updateCalls, deleteCalls };
}

// Shared fixture: a charitable fund + one expense category under it, valid
// against validateBudgetLineInput's fund/category/flow checks.
const FUND_ROW = { id: "fund-1", entityId: "entity-1", kind: "charitable" };
const CATEGORY_ROW = { id: "cat-1", fundKind: "charitable", flow: "expense" };
const UNLOCKED_APPROVAL: unknown[] = []; // no approval row -> isBudgetLocked(null) === false
const LOCKED_APPROVAL = [{ status: "locked" }];

// ---------------------------------------------------------------------------
// upsertBudgetCauseLine
// ---------------------------------------------------------------------------

describe("upsertBudgetCauseLine", () => {
  it("uniqueness: two calls with the same (fund, FY, category, flow, cause) upsert one row via onConflictDoUpdate — the second call's amount wins", async () => {
    // Call 1: no ledger_budgets row exists yet for this tuple — fresh insert
    // succeeds (onConflictDoNothing returns a row), so this is also
    // "entering breakdown mode" for the category.
    const call1 = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
        UNLOCKED_APPROVAL, // assertBudgetUnlocked
        [{ amountCents: 1_000 }], // child rows after insert — just this one line
      ],
      insertReturning: [
        [{ id: "budget-1" }], // ledger_budgets onConflictDoNothing — fresh insert
        [{ id: "line-1" }], // ledger_budget_lines onConflictDoUpdate
      ],
    });

    const result1 = await upsertBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        amountCents: 1_000,
      },
      call1.tx as never,
    );

    expect(result1).toEqual({ ok: true, action: "upserted", lineId: "line-1", categoryTotalCents: 1_000 });
    const lineInsert1 = call1.insertCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineInsert1?.conflictMode).toBe("doUpdate");
    expect(lineInsert1?.values.amountCents).toBe(1_000);

    // Call 2: same tuple — ledger_budgets row already exists (onConflictDoNothing
    // returns [], forcing the re-select branch), and it resolves to the SAME
    // budgetId as call 1. The child-rows read after this second upsert still
    // returns exactly ONE row (proving the (budgetId, cause) unique
    // constraint updated in place, not a second row) — with the NEW amount.
    const call2 = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }], // re-select: existing budget row found
        [{ amountCents: 2_000 }], // child rows after upsert — still just one row, new amount
      ],
      insertReturning: [
        [], // ledger_budgets onConflictDoNothing — conflict, nothing inserted
        [{ id: "line-1" }], // ledger_budget_lines onConflictDoUpdate — same line id, updated
      ],
    });

    const result2 = await upsertBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        amountCents: 2_000,
      },
      call2.tx as never,
    );

    expect(result2).toEqual({ ok: true, action: "upserted", lineId: "line-1", categoryTotalCents: 2_000 });
    const lineInsert2 = call2.insertCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineInsert2?.conflictMode).toBe("doUpdate");
    expect(lineInsert2?.values.amountCents).toBe(2_000);
    expect(lineInsert2?.values.budgetId).toBe("budget-1"); // same parent row as call 1
  });

  it("lock guard: returns { ok: false, status: 409 } against a locked budget, without writing any row", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        LOCKED_APPROVAL,
      ],
    });

    const result = await upsertBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        amountCents: 1_000,
      },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("parent-total rollup: after adding a second cause line, the parent's annualAmountCents equals the sum of both children", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        // Child rows read back AFTER the upsert — two lines already exist
        // under this budget (this write plus one prior), not just the
        // newest one.
        [{ amountCents: 400 }, { amountCents: 600 }],
      ],
      insertReturning: [[{ id: "budget-1" }], [{ id: "line-2" }]],
    });

    const result = await upsertBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Hunger & Basic Needs",
        amountCents: 600,
      },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "upserted", lineId: "line-2", categoryTotalCents: 1_000 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls[0].values.annualAmountCents).toBe(1_000); // sum of BOTH children, not just the 600 just written
  });
});

// ---------------------------------------------------------------------------
// deleteBudgetCauseLine
// ---------------------------------------------------------------------------

describe("deleteBudgetCauseLine", () => {
  it("lock guard: returns { ok: false, status: 409 } against a locked budget, without deleting or updating any row", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }], // budget row lookup — must exist to reach the lock check (404 comes first otherwise)
        LOCKED_APPROVAL,
      ],
    });

    const result = await deleteBudgetCauseLine(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", cause: "Youth & Education" },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("parent-delete-on-empty: deleting the last remaining cause line returns action: 'parent_deleted' and deletes the parent row", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }], // budget row lookup
        UNLOCKED_APPROVAL,
        [], // remaining child rows after the delete — none left
      ],
      deleteReturning: [
        [{ id: "line-1" }], // the deleted ledger_budget_lines row
      ],
    });

    const result = await deleteBudgetCauseLine(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", cause: "Youth & Education" },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "parent_deleted" });
    // Two deletes: the cause line itself, then the now-empty parent row.
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
    expect(deleteCalls[1].table).toBe(ledgerBudgets);
    // The parent is DELETED, not left stale with an update — "no target
    // set" must have exactly one representation (DECISION-045).
    expect(updateCalls).toHaveLength(0);
  });

  it("a line_deleted result (not the last line) recomputes the parent's total instead of deleting it", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }],
        UNLOCKED_APPROVAL,
        [{ amountCents: 750 }], // one cause line remains after the delete
      ],
      deleteReturning: [[{ id: "line-1" }]],
    });

    const result = await deleteBudgetCauseLine(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", cause: "Youth & Education" },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "line_deleted", categoryTotalCents: 750 });
    expect(deleteCalls).toHaveLength(1); // only the cause line — parent survives
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls[0].values.annualAmountCents).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// collapseBudgetCauseLines
// ---------------------------------------------------------------------------

describe("collapseBudgetCauseLines", () => {
  it("lock guard: returns { ok: false, status: 409 } against a locked budget, without deleting any row", async () => {
    const { tx, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1", annualAmountCents: 5_000 }],
        LOCKED_APPROVAL,
      ],
    });

    const result = await collapseBudgetCauseLines(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense" },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("deletes all child rows and returns the parent's already-correct annualAmountCents unchanged", async () => {
    const { tx, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1", annualAmountCents: 5_000 }],
        UNLOCKED_APPROVAL,
      ],
    });

    const result = await collapseBudgetCauseLines(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense" },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "collapsed", annualAmountCents: 5_000 });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
  });
});

// ---------------------------------------------------------------------------
// upsertBudgetLine — cause-line-aware guard (regression fix, qa Phase 5 FAIL 2026-07-27)
// ---------------------------------------------------------------------------

describe("upsertBudgetLine — cause-line-aware guard (regression fix)", () => {
  it("should not silently overwrite annualAmountCents when the budget row already has ledger_budget_lines children — regression for parent/child rollup desync", async () => {
    // Arrange: a budget row with 2 committed cause-line children summing to
    // $20.00 (qa's exact live-reproduction fixture — see Phase 5 section of
    // docs/work-log/2026-07-27-ledger-cause-budget-lines.md).
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
        UNLOCKED_APPROVAL, // assertBudgetUnlocked
        [{ id: "budget-1" }], // cause-line-aware guard: existing budget row for this tuple
        [{ id: "line-1" }], // cause-line-aware guard: at least one child row exists
      ],
    });

    // Act: the OLD lump-sum path (PATCH /api/admin/ledger/budgets, and the
    // guided-seed route's top-level loop) tries to set a raw amount of
    // $500.00 against the same tuple.
    const result = await upsertBudgetLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        annualAmountCents: 50_000,
        conflictMode: "update",
      },
      tx as never,
    );

    // Assert: rejected (preferred over qa's alternative of silent
    // reconciliation — surfaces the conflict instead of guessing intent),
    // and the children (and the parent's true total) are left completely
    // untouched — no insert, update, or delete call of any kind.
    expect(result).toEqual({
      ok: false,
      error: "This category is broken down by cause — edit its cause lines instead.",
      status: 409,
      reason: "has_cause_breakdown",
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("clearing a budget to null (delete) is also rejected when children exist — would otherwise cascade-delete them", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }],
        [{ id: "line-1" }],
      ],
    });

    const result = await upsertBudgetLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        annualAmountCents: null,
        conflictMode: "update",
      },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "This category is broken down by cause — edit its cause lines instead.",
      status: 409,
      reason: "has_cause_breakdown",
    });
    expect(deleteCalls).toHaveLength(0); // the parent (and its cascade-linked children) survive
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("still upserts normally when the budget row has no cause-line children (ordinary lump-sum path, unaffected by the guard)", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [], // no existing budget row at all — fresh insert, child check is skipped entirely
      ],
      insertReturning: [[{ id: "budget-1" }]],
    });

    const result = await upsertBudgetLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        annualAmountCents: 50_000,
        conflictMode: "update",
      },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "upserted", id: "budget-1" });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(ledgerBudgets);
  });
});

/**
 * Unit tests for the Cause-Tagged Budget Line Items write core in
 * src/lib/ledger-queries.ts.
 *
 * B-17 Increment A (DECISION-045/046) shipped a `(budgetId, cause)`-keyed
 * upsert/delete. Labeled Cause Budget Lines (2026-07-28, DECISION-047/048)
 * relaxed that to allow multiple distinctly-labeled lines per cause, moving
 * every write path to address a line by its own `id`:
 *   createBudgetCauseLine (plain INSERT, pre-check + race-catch 409)
 *   updateBudgetCauseLine (single UPDATE ... WHERE id, amount and/or label)
 *   deleteBudgetCauseLine(id, tx)
 *   upsertBudgetCauseLineForSeed (seed-only, keeps upsert semantics, label: '')
 *
 * These tests mock the Drizzle transaction client (tx), mirroring the
 * established pattern in src/lib/dues-ledger-sync.test.ts — call-order-based
 * canned responses for select(), with insert()/update()/delete() calls
 * captured for assertion rather than backed by a real (or fully-simulated)
 * database. Real dedup/persistence guarantees (the (budgetId, cause, label)
 * unique constraint's enforcement) are Postgres's job, already exercised
 * elsewhere in this codebase; these tests verify THIS module's code always
 * wires that up correctly — the right pre-checks, the right values, and the
 * right recomputed total — rather than re-proving Postgres semantics.
 *
 * Phase 3 design (2026-07-28-ledger-labeled-cause-lines.md, "Unit Tests to
 * Write in Phase 4", items 1-10) requires:
 *   1. Uniqueness on (cause, label) including two-blank collision.
 *   2. Label trim/normalization (covered in ledger.test.ts for the pure
 *      helper; the 121-char-rejection half is covered here at the query
 *      layer).
 *   3. id-keyed update changes amount without touching cause/label, and
 *      vice-versa.
 *   4. Delete-by-id leaves siblings.
 *   5. Multi-same-cause parent-total rollup.
 *   6. The two 409 reason codes (locked, duplicate_cause_label).
 *   7. Seed collision-map fix (counts only label='' rows).
 *   8. upsertBudgetCauseLineForSeed conflict target widened to 3 columns.
 *   9. Migration idempotency reasoning — documented in the migration file
 *      itself (database-admin's Phase 4 section), not code-tested here.
 *  10. Regression carry-forwards — this file's own rewrite IS that
 *      carry-forward; every case below calls the new function names/signatures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "fs";
import path from "path";

// ledger-queries.ts imports the real `db` (src/lib/db), which throws at import
// time when DATABASE_URL/DB_URL is unset (e.g. a bare `pnpm test` or CI without
// .env.local). We mock the module to keep the suite hermetic, mirroring
// src/lib/members.test.ts.
//
// Two different consumption patterns share this one mock:
//   - Every existing describe block below drives its own `tx` mock (see
//     makeMockTx) and never touches the module-level `db` export at all.
//   - The `getFundReport asOfDate bounding` block (bottom of this file, added
//     for the Monthly Financial Statement feature, 2026-07-28) calls
//     getFundReport() directly, which uses the module-level `db` —
//     mockDbState's FIFO queue answers those calls in call order, and
//     `wheres` captures each select's raw WHERE condition so the asOfDate
//     bound itself can be asserted (via PgDialect().sqlToQuery()), not just
//     downstream arithmetic.
const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][], wheres: [] as unknown[] },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.queue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return { db: { select: () => chain() } };
});

import {
  createBudgetCauseLine,
  updateBudgetCauseLine,
  deleteBudgetCauseLine,
  upsertBudgetCauseLineForSeed,
  collapseBudgetCauseLines,
  computeCauseSeedForCategory,
  upsertBudgetLine,
  setBudgetLinePendingDelete,
  setBudgetCauseLinePendingDelete,
  setBudgetCauseGroupPendingDelete,
  getFundReport,
  getDuesTimingAdjustment,
  setBudgetCategoryAnnotation,
  setBudgetCauseLineAnnotation,
  getPendingApprovals,
  listPendingAcknowledgments,
  listAcknowledgmentsSummary,
} from "./ledger-queries";
import { ledgerFunds, ledgerCategories, ledgerBudgets, ledgerBudgetLines } from "./db/schema";
import { causeLineReferenceKey } from "./ledger";
import { db } from "./db";

// ---------------------------------------------------------------------------
// Minimal Drizzle transaction client mock factory
// ---------------------------------------------------------------------------

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
  conflictMode: "doNothing" | "doUpdate" | "plain";
  /** The `set` object passed to .onConflictDoUpdate({ target, set }), when
   *  conflictMode === "doUpdate" — captured so tests can assert exactly
   *  which fields a conditional conflict-set clause included/omitted (the
   *  Budget Star & Notes conditional-upsert landmine, DECISION-057). */
  conflictSet?: Record<string, unknown>;
};
type UpdateCall = { table: unknown; values: Record<string, unknown> };
type DeleteCall = { table: unknown };

/** Sentinel: makeMockTx's insertReturning/updateThrows entries can use this
 *  to simulate a thrown Postgres unique-violation (23505) instead of
 *  resolving normally — exercises the race-condition defense-in-depth catch
 *  in createBudgetCauseLine/updateBudgetCauseLine. */
type PgErrorSentinel = { __pgErrorCode: string };
function pgError(code: string): PgErrorSentinel {
  return { __pgErrorCode: code };
}
function isPgErrorSentinel(v: unknown): v is PgErrorSentinel {
  return typeof v === "object" && v !== null && "__pgErrorCode" in v;
}

/**
 * select() calls are answered in call order from `selectResults` (one entry
 * per select().from().where() call, including joined selects — supports both
 * `await ...where()` and `await ...where().limit(1)`, and
 * `...where().orderBy()`). insert()/update()/delete() calls are captured
 * into the returned arrays for assertion; insert()'s .returning() is
 * answered in call order from `insertReturning` (supports a plain insert with
 * no conflict clause, in addition to onConflictDoNothing/onConflictDoUpdate);
 * update()'s .where() is answered from `updateThrows` when present (to
 * simulate a race-condition unique-violation on the UPDATE itself);
 * delete()'s .returning() (unused by the id-keyed delete path, kept for
 * shape-compatibility) is answered from `deleteReturning`.
 */
function makeMockTx(opts: {
  selectResults: unknown[][];
  insertReturning?: (unknown[] | PgErrorSentinel)[];
  updateThrows?: (PgErrorSentinel | undefined)[];
  /** Answered in call order for an update().set().where().returning() chain
   *  — used by setBudgetCauseGroupPendingDelete's "all N rows flip
   *  atomically" assertion. Update calls that never invoke .returning() (the
   *  vast majority of this file's existing coverage) don't consume this. */
  updateReturning?: unknown[][];
  deleteReturning?: unknown[][];
}) {
  let si = 0;
  let ii = 0;
  let ui = 0;
  let uri = 0;
  let di = 0;
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];
  const deleteCalls: DeleteCall[] = [];

  function nextReturning(): Promise<unknown[]> {
    const entry = opts.insertReturning?.[ii++] ?? [];
    if (isPgErrorSentinel(entry)) {
      const err = new Error("duplicate key value violates unique constraint");
      (err as Error & { code?: string }).code = entry.__pgErrorCode;
      return Promise.reject(err);
    }
    return Promise.resolve(entry);
  }

  const selectChain = () => ({
    from: () => ({
      innerJoin: () => selectChain().from(),
      where: () => {
        const rows = opts.selectResults[si++] ?? [];
        const p = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
          orderBy: () => Promise<unknown[]>;
        };
        p.limit = () => Promise.resolve(rows);
        p.orderBy = () => Promise.resolve(rows);
        return p;
      },
    }),
  });

  const tx = {
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: () => {
          insertCalls.push({ table, values, conflictMode: "doNothing" });
          return { returning: () => nextReturning() };
        },
        onConflictDoUpdate: (conflictArgs: { set?: Record<string, unknown> }) => {
          insertCalls.push({ table, values, conflictMode: "doUpdate", conflictSet: conflictArgs?.set });
          return { returning: () => nextReturning() };
        },
        returning: () => {
          insertCalls.push({ table, values, conflictMode: "plain" });
          return nextReturning();
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push({ table, values });
        return {
          where: () => {
            const throwEntry = opts.updateThrows?.[ui++];
            if (throwEntry) {
              const err = new Error("duplicate key value violates unique constraint");
              (err as Error & { code?: string }).code = throwEntry.__pgErrorCode;
              return Promise.reject(err);
            }
            const p = Promise.resolve(undefined) as Promise<unknown> & {
              returning: () => Promise<unknown[]>;
            };
            p.returning = () => Promise.resolve(opts.updateReturning?.[uri++] ?? []);
            return p;
          },
        };
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
// createBudgetCauseLine
// ---------------------------------------------------------------------------

describe("createBudgetCauseLine", () => {
  it("uniqueness: two calls with the same (cause, label) — including two blank labels — the second 409s duplicate_cause_label, no second row written", async () => {
    // Call 1: fresh insert succeeds — no ledger_budgets row exists yet
    // (also "entering breakdown mode" for the category).
    const call1 = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
        UNLOCKED_APPROVAL, // assertBudgetUnlocked
        [], // pre-check: no existing (budgetId, cause, label) sibling
        [{ amountCents: 1_000 }], // child rows after insert
      ],
      insertReturning: [
        [{ id: "budget-1" }], // ledger_budgets onConflictDoNothing — fresh insert
        [{ id: "line-1" }], // ledger_budget_lines plain insert
      ],
    });

    const result1 = await createBudgetCauseLine(
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

    expect(result1).toEqual({
      ok: true,
      action: "created",
      lineId: "line-1",
      cause: "Youth & Education",
      label: "",
      categoryTotalCents: 1_000,
    });
    const lineInsert1 = call1.insertCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineInsert1?.conflictMode).toBe("plain");
    expect(lineInsert1?.values.label).toBe("");

    // Call 2: same tuple, same (blank) label — the ledger_budgets row already
    // exists (onConflictDoNothing returns [], forcing the re-select branch),
    // and the pre-check SELECT finds the existing sibling line. 409, no
    // insert of the line is even attempted.
    const call2 = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }], // re-select: existing budget row found
        [{ id: "line-1" }], // pre-check: existing sibling at (budgetId, cause, "")
      ],
      insertReturning: [[]], // ledger_budgets onConflictDoNothing — conflict
    });

    const result2 = await createBudgetCauseLine(
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

    expect(result2).toEqual({
      ok: false,
      error: 'A line for "Youth & Education" with this label already exists — edit it instead.',
      status: 409,
      reason: "duplicate_cause_label",
    });
    expect(call2.insertCalls.find((c) => c.table === ledgerBudgetLines)).toBeUndefined();

    // Same cause, but a DIFFERENT label — succeeds as a distinct row (not a
    // collision), proving cause alone no longer blocks a second line.
    const call3 = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }],
        [], // pre-check: no sibling at (budgetId, "Youth & Education", "WARM")
        [{ amountCents: 1_000 }, { amountCents: 500 }], // two children now
      ],
      insertReturning: [[], [{ id: "line-2" }]],
    });

    const result3 = await createBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        label: "WARM",
        amountCents: 500,
      },
      call3.tx as never,
    );

    expect(result3).toEqual({
      ok: true,
      action: "created",
      lineId: "line-2",
      cause: "Youth & Education",
      label: "WARM",
      categoryTotalCents: 1_500,
    });
  });

  it("race defense-in-depth: a 23505 thrown on the INSERT itself (concurrent request past the pre-check) maps to the same 409 duplicate_cause_label", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }],
        [], // pre-check passes (no sibling seen yet) — the race happens after this read
      ],
      insertReturning: [[], pgError("23505")],
    });

    const result = await createBudgetCauseLine(
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
      error: 'A line for "Youth & Education" with this label already exists — edit it instead.',
      status: 409,
      reason: "duplicate_cause_label",
    });
    expect(insertCalls.find((c) => c.table === ledgerBudgetLines)).toBeDefined();
  });

  it("label is trimmed before the uniqueness check — a 121-char label (after trim) is rejected 400 before any write", async () => {
    const { tx, insertCalls } = makeMockTx({ selectResults: [[FUND_ROW], [CATEGORY_ROW], UNLOCKED_APPROVAL] });

    const result = await createBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        label: `  ${"x".repeat(121)}  `,
        amountCents: 1_000,
      },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "label must be 120 characters or fewer",
      status: 400,
    });
    expect(insertCalls).toHaveLength(0);
  });

  it("lock guard: returns { ok: false, status: 409, reason: 'locked' } against a locked budget, without writing any row", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW], LOCKED_APPROVAL],
    });

    const result = await createBudgetCauseLine(
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
      reason: "locked",
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("multi-same-cause parent-total rollup: two created lines under the same cause with different labels sum into the parent's annualAmountCents", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }],
        [], // no existing sibling at this (cause, label)
        // Child rows read back AFTER the insert — TWO lines exist under this
        // budget (this write plus one prior), not just the newest one.
        [{ amountCents: 400 }, { amountCents: 600 }],
      ],
      insertReturning: [[], [{ id: "line-2" }]],
    });

    const result = await createBudgetCauseLine(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Hunger & Basic Needs",
        label: "Westerville Sharing & Caring",
        amountCents: 600,
      },
      tx as never,
    );

    expect(result).toMatchObject({ ok: true, action: "created", categoryTotalCents: 1_000 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls[0].values.annualAmountCents).toBe(1_000); // sum of BOTH children
  });
});

// ---------------------------------------------------------------------------
// updateBudgetCauseLine
// ---------------------------------------------------------------------------

describe("updateBudgetCauseLine", () => {
  it("amount-only update leaves cause/label unchanged", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1", cause: "Youth & Education", label: "WARM", amountCents: 1_000 }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
        [{ amountCents: 2_000 }],
      ],
    });

    const result = await updateBudgetCauseLine({ id: "line-1", amountCents: 2_000 }, tx as never);

    expect(result).toEqual({
      ok: true,
      action: "updated",
      lineId: "line-1",
      cause: "Youth & Education",
      label: "WARM",
      categoryTotalCents: 2_000,
    });
    const lineUpdate = updateCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineUpdate?.values.amountCents).toBe(2_000);
    expect(lineUpdate?.values.label).toBe("WARM"); // unchanged, re-written to the same value
  });

  it("label-only update leaves amountCents/cause unchanged", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1", cause: "Youth & Education", label: "WARM", amountCents: 1_000 }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
        [], // no collision at the new label
        [{ amountCents: 1_000 }],
      ],
    });

    const result = await updateBudgetCauseLine({ id: "line-1", label: " WARM Inc. " }, tx as never);

    expect(result).toEqual({
      ok: true,
      action: "updated",
      lineId: "line-1",
      cause: "Youth & Education",
      label: "WARM Inc.",
      categoryTotalCents: 1_000,
    });
    const lineUpdate = updateCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineUpdate?.values.amountCents).toBe(1_000); // unchanged
    expect(lineUpdate?.values.label).toBe("WARM Inc.");
  });

  it("editing a label into a collision with a sibling (excluding the row's own id) returns 409 duplicate_cause_label", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1", cause: "Hunger & Basic Needs", label: "WARM", amountCents: 500 }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
        // Collision check excludes this row's own id — finds the OTHER
        // sibling that already has label "Westerville Sharing & Caring".
        [{ id: "line-2" }],
      ],
    });

    const result = await updateBudgetCauseLine(
      { id: "line-1", label: "Westerville Sharing & Caring" },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: 'A line for "Hunger & Basic Needs" with this label already exists — edit it instead.',
      status: 409,
      reason: "duplicate_cause_label",
    });
    expect(updateCalls.find((c) => c.table === ledgerBudgetLines)).toBeUndefined();
  });

  it("lock guard: returns { ok: false, status: 409, reason: 'locked' }, without updating any row", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1", cause: "Youth & Education", label: "", amountCents: 1_000 }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        LOCKED_APPROVAL,
      ],
    });

    const result = await updateBudgetCauseLine({ id: "line-1", amountCents: 500 }, tx as never);

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
      reason: "locked",
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("404 when no line exists for the given id", async () => {
    const { tx } = makeMockTx({ selectResults: [[]] });
    const result = await updateBudgetCauseLine({ id: "missing", amountCents: 100 }, tx as never);
    expect(result).toEqual({ ok: false, error: "No cause line found for this id", status: 404 });
  });

  it("400 when neither label nor amountCents is provided", async () => {
    const { tx } = makeMockTx({ selectResults: [] });
    const result = await updateBudgetCauseLine({ id: "line-1" }, tx as never);
    expect(result).toEqual({
      ok: false,
      error: "At least one of label or amountCents is required",
      status: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// deleteBudgetCauseLine
// ---------------------------------------------------------------------------

describe("deleteBudgetCauseLine", () => {
  it("lock guard: returns { ok: false, status: 409, reason: 'locked' }, without deleting or updating any row", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1" }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        LOCKED_APPROVAL,
      ],
    });

    const result = await deleteBudgetCauseLine("line-1", tx as never);

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
      reason: "locked",
    });
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("parent-delete-on-empty: deleting the last remaining cause line returns action: 'parent_deleted' and deletes the parent row", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1" }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
        [], // remaining child rows after the delete — none left
      ],
    });

    const result = await deleteBudgetCauseLine("line-1", tx as never);

    expect(result).toEqual({ ok: true, action: "parent_deleted" });
    // Two deletes: the cause line itself, then the now-empty parent row.
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
    expect(deleteCalls[1].table).toBe(ledgerBudgets);
    expect(updateCalls).toHaveLength(0);
  });

  it("delete-by-id leaves siblings: deleting one line under a cause with two labeled siblings returns 'line_deleted' and the remaining sibling's total is intact", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1" }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
        // Two labeled siblings remain after deleting line-1.
        [{ amountCents: 300 }, { amountCents: 450 }],
      ],
    });

    const result = await deleteBudgetCauseLine("line-1", tx as never);

    expect(result).toEqual({ ok: true, action: "line_deleted", categoryTotalCents: 750 });
    expect(deleteCalls).toHaveLength(1); // only the deleted line — parent survives
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls[0].values.annualAmountCents).toBe(750);
  });

  it("404 when no line exists for the given id", async () => {
    const { tx } = makeMockTx({ selectResults: [[]] });
    const result = await deleteBudgetCauseLine("missing", tx as never);
    expect(result).toEqual({ ok: false, error: "No cause line found for this id", status: 404 });
  });
});

// ---------------------------------------------------------------------------
// setBudgetCauseLinePendingDelete — Budgeting Page Restructure
// (DECISION-054/055/056)
// ---------------------------------------------------------------------------

describe("setBudgetCauseLinePendingDelete", () => {
  it("soft-delete: sets pending_delete_at, never touching amountCents or the parent's annualAmountCents", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1" }], // line lookup
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }], // parent budget lookup
        [FUND_ROW], // fund lookup
        UNLOCKED_APPROVAL,
      ],
    });

    const result = await setBudgetCauseLinePendingDelete(
      { id: "line-1", pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "pending-delete" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgetLines);
    expect(updateCalls[0].values.pendingDeleteAt).toBeInstanceOf(Date);
    // The whole point of a pure flag-flip: no amount field, and no write to
    // the parent ledger_budgets row at all.
    expect(updateCalls[0].values).not.toHaveProperty("amountCents");
    expect(updateCalls.some((c) => c.table === ledgerBudgets)).toBe(false);
  });

  it("restore: clears pending_delete_at, again never touching amountCents", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [{ id: "line-1", budgetId: "budget-1" }],
        [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
        [FUND_ROW],
        UNLOCKED_APPROVAL,
      ],
    });

    const result = await setBudgetCauseLinePendingDelete(
      { id: "line-1", pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "restored" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.pendingDeleteAt).toBeNull();
    expect(updateCalls[0].values).not.toHaveProperty("amountCents");
  });

  it("404 on an unknown id — no lookup for a parent proceeds", async () => {
    const { tx, updateCalls } = makeMockTx({ selectResults: [[]] });

    const result = await setBudgetCauseLinePendingDelete(
      { id: "missing", pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: false, error: "No cause line found for this id", status: 404 });
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects 409 { reason: 'locked' } on a locked budget — for BOTH pendingDelete: true and pendingDelete: false", async () => {
    for (const pendingDelete of [true, false]) {
      const { tx, updateCalls } = makeMockTx({
        selectResults: [
          [{ id: "line-1", budgetId: "budget-1" }],
          [{ id: "budget-1", fundId: "fund-1", fiscalYear: 2026 }],
          [FUND_ROW],
          LOCKED_APPROVAL,
        ],
      });

      const result = await setBudgetCauseLinePendingDelete(
        { id: "line-1", pendingDelete },
        tx as never,
      );

      expect(result).toEqual({
        ok: false,
        error: "This budget is locked. Unlock it to make changes.",
        status: 409,
        reason: "locked",
      });
      expect(updateCalls).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// setBudgetCauseGroupPendingDelete — Budgeting Page Restructure
// (DECISION-054/055/056)
// ---------------------------------------------------------------------------

describe("setBudgetCauseGroupPendingDelete", () => {
  const GROUP_PARAMS = {
    fundId: "fund-1",
    fiscalYear: 2026,
    categoryId: "cat-1",
    flow: "expense" as const,
    cause: "Environment",
  };

  it("soft-delete: happy path on a multi-line group — a single UPDATE flips every matching row atomically (no partial-failure window)", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }],
        UNLOCKED_APPROVAL,
      ],
      updateReturning: [[{ id: "line-1" }, { id: "line-2" }, { id: "line-3" }]],
    });

    const result = await setBudgetCauseGroupPendingDelete(
      { ...GROUP_PARAMS, pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "pending-delete", lineCount: 3 });
    // Exactly ONE update call touches all three rows — not three separate calls.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgetLines);
    expect(updateCalls[0].values.pendingDeleteAt).toBeInstanceOf(Date);
  });

  it("restore: happy path on the same multi-line group, using the same function with pendingDelete: false", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }],
        UNLOCKED_APPROVAL,
      ],
      updateReturning: [[{ id: "line-1" }, { id: "line-2" }, { id: "line-3" }]],
    });

    const result = await setBudgetCauseGroupPendingDelete(
      { ...GROUP_PARAMS, pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "restored", lineCount: 3 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.pendingDeleteAt).toBeNull();
  });

  it("404 when the cause has no line items — the UPDATE matched zero rows", async () => {
    const { tx } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1" }],
        UNLOCKED_APPROVAL,
      ],
      updateReturning: [[]], // zero rows matched
    });

    const result = await setBudgetCauseGroupPendingDelete(
      { ...GROUP_PARAMS, pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: false, error: "No line items exist for this cause", status: 404 });
  });

  it("404 when no budget row exists for this category/flow", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[FUND_ROW], []],
    });

    const result = await setBudgetCauseGroupPendingDelete(
      { ...GROUP_PARAMS, pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: false, error: "No budget row found for this category", status: 404 });
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects 409 { reason: 'locked' } on a locked budget, without flipping any row", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [{ id: "budget-1" }], LOCKED_APPROVAL],
    });

    const result = await setBudgetCauseGroupPendingDelete(
      { ...GROUP_PARAMS, pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
      reason: "locked",
    });
    expect(updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// upsertBudgetCauseLineForSeed
// ---------------------------------------------------------------------------

describe("upsertBudgetCauseLineForSeed", () => {
  it("conflict target widened to 3 columns: a second seed write to the same (fund, FY, category, flow, cause) updates the existing label:'' row rather than creating a duplicate", async () => {
    const call1 = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW], UNLOCKED_APPROVAL, [{ amountCents: 1_000 }]],
      insertReturning: [[{ id: "budget-1" }], [{ id: "line-1" }]],
    });

    const result1 = await upsertBudgetCauseLineForSeed(
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
    expect(lineInsert1?.values.label).toBe("");

    // Re-running the seed — the ledger_budgets row already exists, and the
    // line upsert conflicts on (budgetId, cause, label) and updates in
    // place, returning the SAME line id with the NEW amount.
    const call2 = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }], // re-select: budget row already exists
        [{ amountCents: 1_500 }], // still one row, updated amount
      ],
      insertReturning: [[], [{ id: "line-1" }]],
    });

    const result2 = await upsertBudgetCauseLineForSeed(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        cause: "Youth & Education",
        amountCents: 1_500,
      },
      call2.tx as never,
    );
    expect(result2).toEqual({ ok: true, action: "upserted", lineId: "line-1", categoryTotalCents: 1_500 });
    const lineInsert2 = call2.insertCalls.find((c) => c.table === ledgerBudgetLines);
    expect(lineInsert2?.conflictMode).toBe("doUpdate");
    expect(lineInsert2?.values.budgetId).toBe("budget-1");
  });

  it("lock guard: returns { ok: false, status: 409, reason: 'locked' }, without writing any row", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW], LOCKED_APPROVAL],
    });

    const result = await upsertBudgetCauseLineForSeed(
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
      reason: "locked",
    });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collapseBudgetCauseLines — unchanged in shape, still tuple-keyed
// ---------------------------------------------------------------------------

describe("collapseBudgetCauseLines", () => {
  it("lock guard: returns { ok: false, status: 409 } against a locked budget, without deleting any row", async () => {
    const { tx, deleteCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [{ id: "budget-1", annualAmountCents: 5_000 }], LOCKED_APPROVAL],
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
      selectResults: [[FUND_ROW], [{ id: "budget-1", annualAmountCents: 5_000 }], UNLOCKED_APPROVAL],
    });

    const result = await collapseBudgetCauseLines(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense" },
      tx as never,
    );

    expect(result).toEqual({
      ok: true,
      action: "collapsed",
      annualAmountCents: 5_000,
      unlinkedCount: 0,
    });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
  });

  it("counts posted transactions linked to the lines about to be deleted (B-30, DECISION-061)", async () => {
    const { tx, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [{ id: "budget-1", annualAmountCents: 5_000 }],
        UNLOCKED_APPROVAL,
        [{ id: "line-1" }, { id: "line-2" }],
        [{ c: 3 }],
      ],
    });

    const result = await collapseBudgetCauseLines(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense" },
      tx as never,
    );

    expect(result).toEqual({
      ok: true,
      action: "collapsed",
      annualAmountCents: 5_000,
      unlinkedCount: 3,
    });
    expect(deleteCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// computeCauseSeedForCategory — seed collision-map fix (label='' only)
// ---------------------------------------------------------------------------

describe("computeCauseSeedForCategory — seed collision-map fix", () => {
  it("a cause with one labeled (non-blank) existing line and zero blank-label lines is NOT already covered — collision: false, still proposable", async () => {
    // No transactions in the lookback window matter for this assertion's
    // point — what matters is the existingCauseAmountMap build, which reads
    // ledger_budget_lines filtered to label=''. Since the only existing row
    // for this cause has label='WARM' (non-blank), the WHERE(label='')
    // filter excludes it, so existingCauseAmountMap has no entry for this
    // cause.
    let call = 0;
    const explicitTx = {
      select: () => ({
        from: () => ({
          where: () => {
            call++;
            if (call === 1) {
              // Lookback FY 1 (targetFiscalYear - 1): one posted actual.
              return Promise.resolve([{ beneficiaryCause: "Youth & Education", amountCents: 5_000 }]);
            }
            if (call === 2) {
              // Lookback FY 2 (targetFiscalYear - 2): none.
              return Promise.resolve([]);
            }
            if (call === 3) {
              // Existing budget row lookup for the target FY.
              const p = Promise.resolve([{ id: "budget-1" }]) as Promise<unknown[]> & {
                limit: () => Promise<unknown[]>;
              };
              p.limit = () => Promise.resolve([{ id: "budget-1" }]);
              return p;
            }
            // Existing cause lines filtered to label='' — the labeled "WARM"
            // sibling does NOT show up here (it's filtered out at the SQL
            // level by the fix), so this resolves empty.
            return Promise.resolve([]);
          },
        }),
      }),
    };

    const result = await computeCauseSeedForCategory("fund-1", "cat-1", 2026, explicitTx as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cause: "Youth & Education",
      amountCents: 5_000,
      collision: false,
      existingAmountCents: null,
    });
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

// ---------------------------------------------------------------------------
// getFundReport asOfDate bounding — Monthly Financial Statement (2026-07-28),
// Phase 3 design's "Unit Tests to Write in Phase 4" item 1. The other 7 named
// tests live in src/lib/financial-report-queries.test.ts.
// ---------------------------------------------------------------------------

describe("getFundReport asOfDate bounding", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  const ASOF_FUND_ROW = { id: "fund-1", entityId: "entity-1", kind: "charitable", openingBalanceCents: 0 };

  /** Queues the 5 canned select() results getFundReport() consumes in order
   *  (fund lookup, txns, categories, budgets, pre-FY rollforward) — no
   *  cause-tagged budget lines or orphaned actual-only categories in any
   *  scenario below, so both conditional queries stay skipped. */
  function queueEmptyFundReport(fund: unknown) {
    mockDbState.queue.push([fund], [], [], [], []);
  }

  it("bounds the actuals query's upper bound to asOfDate+1 day (inclusive of asOfDate itself) when asOfDate falls inside the fiscal year", async () => {
    queueEmptyFundReport(ASOF_FUND_ROW);

    await getFundReport("fund-1", 2026, { asOfDate: "2026-12-15" });

    // wheres[0] = fund lookup; wheres[1] = the txns query this feature bounds.
    const { params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(params).toEqual(["fund-1", "2026-07-01", "2026-12-16"]);
  });

  it("clamps the bound to the fiscal-year end when asOfDate falls after it (defensive — not expected from getMonthlyStatement's own callers)", async () => {
    queueEmptyFundReport(ASOF_FUND_ROW);

    await getFundReport("fund-1", 2026, { asOfDate: "2027-08-15" });

    const { params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(params).toEqual(["fund-1", "2026-07-01", "2027-07-01"]);
  });

  it("uses the fiscal-year end verbatim when asOfDate is omitted — byte-identical to today's behavior for every existing call site", async () => {
    queueEmptyFundReport(ASOF_FUND_ROW);

    await getFundReport("fund-1", 2026);

    const { params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(params).toEqual(["fund-1", "2026-07-01", "2027-07-01"]);
  });

  it("includes a transaction dated exactly on asOfDate and (by the bound proven above) excludes anything after it — arithmetic over the correctly-bounded row set", async () => {
    mockDbState.queue.push(
      [{ ...ASOF_FUND_ROW, openingBalanceCents: 10_000 }],
      [
        {
          id: "t1",
          categoryId: "cat-1",
          flow: "income",
          amountCents: 5_000,
          status: "posted",
          txnDate: "2026-06-15", // exactly asOfDate — must be included
        },
      ],
      [{ id: "cat-1", name: "Dues", flow: "income", countsAsGiving: true }],
      [],
      [],
    );

    const report = await getFundReport("fund-1", 2025, { asOfDate: "2026-06-15" });

    expect(report?.totalIncomeCents).toBe(5_000);
    expect(report?.endingCents).toBe(15_000);
  });
});

// ---------------------------------------------------------------------------
// setBudgetLinePendingDelete — Soft-delete/restore-until-finalize
// (DECISION-052/053, Increment 2 of
// docs/work-log/2026-07-28-budgeting-page-redesign.md). Phase 3 design's
// "Unit Tests to Write in Phase 4" items 1-5.
// ---------------------------------------------------------------------------

describe("setBudgetLinePendingDelete", () => {
  it("soft-delete: sets pending_delete_at and leaves annualAmountCents byte-for-byte untouched", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
        UNLOCKED_APPROVAL, // assertBudgetUnlocked
        [{ id: "budget-1" }], // row-must-exist lookup
        [], // cause-line-children guard: no children
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "pending-delete" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls[0].values.pendingDeleteAt).toBeInstanceOf(Date);
    // The whole point of a pure flag-flip: no amount field in the write at all.
    expect(updateCalls[0].values).not.toHaveProperty("annualAmountCents");
  });

  it("restore: clears pending_delete_at, again never touching the amount", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }],
        [], // no children
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "restored" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.pendingDeleteAt).toBeNull();
    expect(updateCalls[0].values).not.toHaveProperty("annualAmountCents");
  });

  it("rejects 409 { reason: 'locked' } on a locked budget — for BOTH pendingDelete: true and pendingDelete: false (restore is lock-guarded too)", async () => {
    for (const pendingDelete of [true, false]) {
      const { tx, updateCalls } = makeMockTx({
        selectResults: [[FUND_ROW], [CATEGORY_ROW], LOCKED_APPROVAL],
      });

      const result = await setBudgetLinePendingDelete(
        { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete },
        tx as never,
      );

      expect(result).toEqual({
        ok: false,
        error: "This budget is locked. Unlock it to make changes.",
        status: 409,
        reason: "locked",
      });
      expect(updateCalls).toHaveLength(0);
    }
  });

  it("Budgeting Page Restructure (DECISION-054/056): succeeds for a category WITH ledger_budget_lines children — Flow 6, 'remove a whole category, lump sum or in breakdown.' The has_cause_breakdown guard was removed from THIS function specifically (upsertBudgetLine's own copy is untouched); only the category's own row is flipped, never its children.", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1" }], // row exists, in breakdown mode
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "pending-delete" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgets);
    // No cascade write onto children — architect Ruling 4's "no cascade in
    // either direction," children are excluded at read time via
    // isCauseLineLive, never by a write this function makes.
    expect(updateCalls.some((c) => c.table === ledgerBudgetLines)).toBe(false);
  });

  it("restore (pendingDelete: false) still returns 404 when no ledger_budgets row exists for the tuple — there's nothing to restore. NOTE: pendingDelete: true against a missing row used to 404 here too, before the 2026-07-30 bug fix (docs/work-log/2026-07-30-budget-trash-unbudgeted.md) — that direction now lazily creates the row instead; see the tests below.", async () => {
    const { tx, updateCalls, insertCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [], // no existing row for this tuple
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "No budget line exists for this category to modify.",
      status: 404,
    });
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  // Bug fix, 2026-07-30 (docs/work-log/2026-07-30-budget-trash-unbudgeted.md):
  // the trash-icon control silently did nothing on a category with no
  // ledger_budgets row for this FY (budgetCents === null). Root cause:
  // resolveBudgetLineDeleteAction resolved to "noop" for that case, and this
  // function 404'd on a missing row for BOTH directions. Fix: pendingDelete:
  // true now lazily creates the row instead of 404ing; pendingDelete: false
  // (restore) is unchanged for a missing row (still 404s — untested combo,
  // covered above).

  it("soft-delete lazily creates a $0 row when no ledger_budgets row exists yet — trash-icon click on an unbudgeted category no longer 404s or no-ops", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
        UNLOCKED_APPROVAL, // assertBudgetUnlocked
        [], // row-must-exist lookup: no row for this tuple yet
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: true },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "pending-delete" });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(ledgerBudgets);
    expect(insertCalls[0].values.annualAmountCents).toBe(0);
    expect(insertCalls[0].values.pendingDeleteAt).toBeInstanceOf(Date);
    expect(insertCalls[0].conflictMode).toBe("doUpdate");
    expect(updateCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("restore hard-deletes a $0 row instead of clearing the flag — leaves no orphan $0 row behind for the lazily-created (or deliberately-$0) case", async () => {
    const { tx, insertCalls, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1", annualAmountCents: 0 }], // existing row, $0
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "deleted" });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(ledgerBudgets);
    expect(updateCalls).toHaveLength(0);
    expect(insertCalls).toHaveLength(0);
  });

  it("restore of a non-zero row still just clears the flag (unaffected by the $0 orphan-avoidance branch) — the number comes back exactly, byte-for-byte", async () => {
    const { tx, updateCalls, deleteCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW],
        [CATEGORY_ROW],
        UNLOCKED_APPROVAL,
        [{ id: "budget-1", annualAmountCents: 50_000 }],
      ],
    });

    const result = await setBudgetLinePendingDelete(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", pendingDelete: false },
      tx as never,
    );

    expect(result).toEqual({ ok: true, action: "restored" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.pendingDeleteAt).toBeNull();
    expect(updateCalls[0].values).not.toHaveProperty("annualAmountCents");
    expect(deleteCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setBudgetCategoryAnnotation / setBudgetCauseLineAnnotation — Budget Star &
// Notes (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md)
// ---------------------------------------------------------------------------

describe("setBudgetCategoryAnnotation", () => {
  it("lazy-creates the ledger_budgets row for an un-budgeted category: annualAmountCents: 0 in the insert values, starred/note set as requested", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [
        [FUND_ROW], // fund lookup
        [CATEGORY_ROW], // category lookup
      ],
      insertReturning: [[{ starred: true, note: "confirm before locking" }]],
    });

    const result = await setBudgetCategoryAnnotation(
      {
        fundId: "fund-1",
        fiscalYear: 2026,
        categoryId: "cat-1",
        flow: "expense",
        starred: true,
        note: "confirm before locking",
      },
      tx as never,
    );

    expect(result).toEqual({ ok: true, starred: true, note: "confirm before locking" });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe(ledgerBudgets);
    expect(insertCalls[0].values.annualAmountCents).toBe(0);
    expect(insertCalls[0].values.starred).toBe(true);
    expect(insertCalls[0].values.note).toBe("confirm before locking");
  });

  it("THE LANDMINE: a star-only toggle on an already-$5,000-budgeted, already-noted category never includes annualAmountCents or note in the conflict SET clause — Postgres leaves both columns byte-for-byte untouched", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW]],
      insertReturning: [[{ starred: true, note: "matches last year + 5%" }]],
    });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", starred: true },
      tx as never,
    );

    expect(result.ok).toBe(true);
    expect(insertCalls).toHaveLength(1);
    const conflictSet = insertCalls[0].conflictSet!;
    expect(conflictSet).toHaveProperty("starred", true);
    // The whole point of this test: neither key is present in the SET clause
    // at all — not present-and-null, ABSENT — so an existing $5,000 amount
    // and an existing note are never touched by a star-only write.
    expect(conflictSet).not.toHaveProperty("annualAmountCents");
    expect(conflictSet).not.toHaveProperty("note");
  });

  it("a note-only save never includes starred in the conflict SET clause", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW]],
      insertReturning: [[{ starred: false, note: "new note" }]],
    });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", note: "new note" },
      tx as never,
    );

    expect(result.ok).toBe(true);
    const conflictSet = insertCalls[0].conflictSet!;
    expect(conflictSet).toHaveProperty("note", "new note");
    expect(conflictSet).not.toHaveProperty("starred");
    expect(conflictSet).not.toHaveProperty("annualAmountCents");
  });

  it("an empty / whitespace-only note normalizes to null, both in the lazy-create insert values and the conflict SET clause", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW]],
      insertReturning: [[{ starred: false, note: null }]],
    });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", note: "   " },
      tx as never,
    );

    expect(result).toEqual({ ok: true, starred: false, note: null });
    expect(insertCalls[0].values.note).toBeNull();
    expect(insertCalls[0].conflictSet).toHaveProperty("note", null);
  });

  it("a note over 500 chars after trim is rejected with 400 — no insert is ever attempted", async () => {
    const { tx, insertCalls } = makeMockTx({ selectResults: [[FUND_ROW], [CATEGORY_ROW]] });

    const overLong = "x".repeat(501);
    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", note: overLong },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "note must be 500 characters or fewer",
      status: 400,
    });
    expect(insertCalls).toHaveLength(0);
  });

  it("exactly 500 chars after trim is accepted (boundary)", async () => {
    const { tx, insertCalls } = makeMockTx({
      selectResults: [[FUND_ROW], [CATEGORY_ROW]],
      insertReturning: [[{ starred: false, note: "x".repeat(500) }]],
    });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", note: "x".repeat(500) },
      tx as never,
    );

    expect(result.ok).toBe(true);
    expect(insertCalls).toHaveLength(1);
  });

  it("returns 400 when neither starred nor note is provided", async () => {
    const { tx, insertCalls } = makeMockTx({ selectResults: [] });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "cat-1", flow: "expense" },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "At least one of starred or note is required",
      status: 400,
    });
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown fundId, before ever touching categoryId", async () => {
    const { tx, insertCalls } = makeMockTx({ selectResults: [[]] });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "missing-fund", fiscalYear: 2026, categoryId: "cat-1", flow: "expense", starred: true },
      tx as never,
    );

    expect(result).toEqual({ ok: false, error: "Fund not found", status: 404 });
    expect(insertCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown categoryId", async () => {
    const { tx, insertCalls } = makeMockTx({ selectResults: [[FUND_ROW], []] });

    const result = await setBudgetCategoryAnnotation(
      { fundId: "fund-1", fiscalYear: 2026, categoryId: "missing-cat", flow: "expense", starred: true },
      tx as never,
    );

    expect(result).toEqual({ ok: false, error: "Category not found", status: 404 });
    expect(insertCalls).toHaveLength(0);
  });

  it("DECISION-057: never returns a 409 — this function's body never references assertBudgetUnlocked at all (grep-based regression guard, not just behavioral)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/ledger-queries.ts"), "utf-8");
    const start = source.indexOf("export async function setBudgetCategoryAnnotation");
    const end = source.indexOf("export type SetBudgetCauseLineAnnotationParams", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toContain("assertBudgetUnlocked");
  });
});

describe("setBudgetCauseLineAnnotation", () => {
  it("happy path: both starred and note in one call", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[{ id: "line-1" }]], // cause line lookup
      updateReturning: [[{ starred: true, note: "flag for board discussion" }]],
    });

    const result = await setBudgetCauseLineAnnotation(
      { id: "line-1", starred: true, note: "flag for board discussion" },
      tx as never,
    );

    expect(result).toEqual({ ok: true, starred: true, note: "flag for board discussion" });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(ledgerBudgetLines);
    expect(updateCalls[0].values).toEqual({
      starred: true,
      note: "flag for board discussion",
      updatedAt: expect.any(Date),
    });
  });

  it("star-only: note is absent from the UPDATE SET, leaving an existing note untouched", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[{ id: "line-1" }]],
      updateReturning: [[{ starred: true, note: "existing note" }]],
    });

    await setBudgetCauseLineAnnotation({ id: "line-1", starred: true }, tx as never);

    expect(updateCalls[0].values).not.toHaveProperty("note");
    expect(updateCalls[0].values).toHaveProperty("starred", true);
  });

  it("note-only: starred is absent from the UPDATE SET, leaving the existing star untouched", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[{ id: "line-1" }]],
      updateReturning: [[{ starred: false, note: "updated note" }]],
    });

    await setBudgetCauseLineAnnotation({ id: "line-1", note: "updated note" }, tx as never);

    expect(updateCalls[0].values).not.toHaveProperty("starred");
    expect(updateCalls[0].values).toHaveProperty("note", "updated note");
  });

  it("an empty / whitespace-only note normalizes to null", async () => {
    const { tx, updateCalls } = makeMockTx({
      selectResults: [[{ id: "line-1" }]],
      updateReturning: [[{ starred: false, note: null }]],
    });

    const result = await setBudgetCauseLineAnnotation({ id: "line-1", note: "  \t " }, tx as never);

    expect(result).toEqual({ ok: true, starred: false, note: null });
    expect(updateCalls[0].values).toHaveProperty("note", null);
  });

  it("a note over 500 chars after trim is rejected with 400 — no update is ever attempted", async () => {
    const { tx, updateCalls } = makeMockTx({ selectResults: [[{ id: "line-1" }]] });

    const result = await setBudgetCauseLineAnnotation(
      { id: "line-1", note: "x".repeat(501) },
      tx as never,
    );

    expect(result).toEqual({
      ok: false,
      error: "note must be 500 characters or fewer",
      status: 400,
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 400 when neither starred nor note is provided", async () => {
    const { tx, updateCalls } = makeMockTx({ selectResults: [] });

    const result = await setBudgetCauseLineAnnotation({ id: "line-1" }, tx as never);

    expect(result).toEqual({
      ok: false,
      error: "At least one of starred or note is required",
      status: 400,
    });
    expect(updateCalls).toHaveLength(0);
  });

  it("returns 404 for an unknown id", async () => {
    const { tx, updateCalls } = makeMockTx({ selectResults: [[]] });

    const result = await setBudgetCauseLineAnnotation({ id: "missing-line", starred: true }, tx as never);

    expect(result).toEqual({ ok: false, error: "No cause line found for this id", status: 404 });
    expect(updateCalls).toHaveLength(0);
  });

  it("DECISION-057: this function's body never references assertBudgetUnlocked at all (grep-based regression guard)", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/ledger-queries.ts"), "utf-8");
    const start = source.indexOf("export async function setBudgetCauseLineAnnotation");
    const end = source.indexOf(
      "createBudgetCauseLine / updateBudgetCauseLine / deleteBudgetCauseLine /",
      start,
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toContain("assertBudgetUnlocked");
  });
});

// ---------------------------------------------------------------------------
// getFundReport — Budget Star & Notes (DECISION-057). Phase 3 design's
// "Unit Tests to Write in Phase 4" for getFundReport: a starred/noted budget
// row surfaces both at the category grain, a starred/noted cause line
// surfaces both in causeLines[], and an un-budgeted category reports
// starred: false, note: null (not undefined, not missing).
// ---------------------------------------------------------------------------

describe("getFundReport — Budget Star & Notes (DECISION-057)", () => {
  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  const FUND = { id: "fund-1", entityId: "entity-1", kind: "charitable", openingBalanceCents: 0 };

  it("surfaces starred: true / note: '...' on a category's FundReportCategoryLine", async () => {
    const category = { id: "cat-1", name: "Program supplies", flow: "expense", countsAsGiving: false };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 10_000,
      pendingDeleteAt: null,
      starred: true,
      note: "confirm with youth committee",
    };
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].starred).toBe(true);
    expect(report!.expense[0].note).toBe("confirm with youth committee");
  });

  it("surfaces starred/note on a cause line's causeLines[] entry", async () => {
    const category = { id: "cat-1", name: "Charitable donation out", flow: "expense", countsAsGiving: true };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 20_000,
      pendingDeleteAt: null,
      starred: false,
      note: null,
    };
    const budgetLineRows = [
      {
        id: "line-1",
        budgetId: "budget-1",
        cause: "Hunger & Basic Needs",
        label: "WARM",
        amountCents: 12_000,
        pendingDeleteAt: null,
        starred: true,
        note: "matches last year",
      },
    ];
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], budgetLineRows);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].causeLines).toEqual([
      {
        id: "line-1",
        cause: "Hunger & Basic Needs",
        label: "WARM",
        amountCents: 12_000,
        pendingDeleteAt: null,
        starred: true,
        note: "matches last year",
        linkedActualCents: 0,
        linkedTransactionCount: 0,
        actualCents: 0,
        isFuzzyFallback: false,
      },
    ]);
  });

  it("an un-budgeted category reports starred: false, note: null — not undefined, not missing", async () => {
    const category = { id: "cat-1", name: "Program supplies", flow: "expense", countsAsGiving: false };
    // budgetRows is [] here -> budgetIds.length === 0 -> the budgetLineRows
    // select is never issued at all (mirrors the "empty fund" precedent
    // above: fund, txns, categories, budgetRows, preFyRows — 5 items, no 6th).
    mockDbState.queue.push([FUND], [], [category], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0]).toMatchObject({ starred: false, note: null });
    expect(report!.expense[0].starred).not.toBeUndefined();
    expect(report!.expense[0].note).not.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // QA FAIL loop-back (Phase 5 → Phase 4 re-do): a lazy-created annotation-only
  // row must report budgetCents: null, not the fabricated 0 that caused
  // budget-editor.tsx to show "0.00" in the amount input on reload. See
  // resolveDisplayBudgetCents's doc comment in ledger.ts for the exact,
  // narrowly-scoped discriminator.
  // -------------------------------------------------------------------------

  it("a lazy-created annotation-only row (starred, $0, no cause lines) reports budgetCents: null, not 0", async () => {
    const category = { id: "cat-1", name: "Vision screening", flow: "expense", countsAsGiving: false };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 0,
      pendingDeleteAt: null,
      starred: true,
      note: null,
    };
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].budgetCents).toBeNull();
    expect(report!.expense[0].starred).toBe(true);
    expect(report!.expense[0].note).toBeNull();
  });

  it("a lazy-created annotation-only row (note only, not starred, $0, no cause lines) reports budgetCents: null, not 0", async () => {
    const category = { id: "cat-1", name: "Vision screening", flow: "expense", countsAsGiving: false };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 0,
      pendingDeleteAt: null,
      starred: false,
      note: "confirm with youth committee",
    };
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].budgetCents).toBeNull();
    expect(report!.expense[0].starred).toBe(false);
    expect(report!.expense[0].note).toBe("confirm with youth committee");
  });

  it("a genuine deliberately-entered $0 budget (not starred, no note) is UNCHANGED — still reports budgetCents: 0", async () => {
    const category = { id: "cat-1", name: "Vision screening", flow: "expense", countsAsGiving: false };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 0,
      pendingDeleteAt: null,
      starred: false,
      note: null,
    };
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].budgetCents).toBe(0);
  });

  it("a $0 category with real cause-line detail (itemized $0 breakdown) is UNCHANGED — still reports budgetCents: 0, even when starred", async () => {
    const category = { id: "cat-1", name: "Charitable donation out", flow: "expense", countsAsGiving: true };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 0,
      pendingDeleteAt: null,
      starred: true,
      note: null,
    };
    const budgetLineRows = [
      {
        id: "line-1",
        budgetId: "budget-1",
        cause: "Hunger & Basic Needs",
        label: "WARM",
        amountCents: 0,
        pendingDeleteAt: null,
        starred: false,
        note: null,
      },
    ];
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], budgetLineRows);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].budgetCents).toBe(0);
    expect(report!.expense[0].causeLines).not.toBeNull();
  });

  it("a real non-zero budgeted amount is UNCHANGED when starred/noted — the architect's original landmine, at the display layer too", async () => {
    const category = { id: "cat-1", name: "Vision screening", flow: "expense", countsAsGiving: false };
    const budgetRow = {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 50_000,
      pendingDeleteAt: null,
      starred: true,
      note: "flagged for discussion",
    };
    mockDbState.queue.push([FUND], [], [category], [budgetRow], [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();
    expect(report!.expense[0].budgetCents).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// Admin-only boundary regression (Phase 1 Decision 9 / DECISION-057) —
// starred/note must never leak into getPhilanthropy() (the /members/impact
// data source) or the member-facing financial-report-queries.ts (Monthly
// Financial Statement) path. financial-report-queries.ts DOES import
// getFundReport/FundReportCategoryLine (it needs actualCents/budgetCents),
// so the boundary that matters isn't "no import" — it's "its own output
// mapping never spreads a FundReportCategoryLine wholesale, so starred/note
// never reach a MonthlyStatementCategoryLine." Both guards below are
// grep-based, per the Phase 3 design's "test or grep-based check" allowance.
// ---------------------------------------------------------------------------

describe("Admin-only boundary — starred/note never leak into member-facing paths", () => {
  it("getPhilanthropy()'s own function body never references ledgerBudgets or ledgerBudgetLines", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/ledger-queries.ts"), "utf-8");
    const start = source.indexOf("export async function getPhilanthropy");
    const end = source.indexOf("export type DonorWithGivingHistory", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/\bledgerBudgets\b/);
    expect(body).not.toMatch(/\bledgerBudgetLines\b/);
  });

  it("financial-report-queries.ts never references starred/note anywhere — its buildLines() maps FundReportCategoryLine to an explicit MonthlyStatementCategoryLine allowlist, never a wholesale spread", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/financial-report-queries.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/\bstarred\b/);
    expect(source).not.toMatch(/\bnote\s*:/);
    expect(source).not.toMatch(/\.note\b/);
  });
});

// ---------------------------------------------------------------------------
// getFundReport — pending-delete regression guard (DECISION-052/053,
// Increment 2). Phase 3 design's "Unit Tests to Write in Phase 4" item 7 —
// THE guard against leaking an uncommitted soft-delete edit onto the admin
// fund-report page and the member-facing Monthly Statement. Asserted
// directly against two live getFundReport() calls, not reasoned about.
// ---------------------------------------------------------------------------

describe("getFundReport — pending-delete regression guard", () => {
  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  const FUND = { id: "fund-1", entityId: "entity-1", kind: "charitable", openingBalanceCents: 0 };
  const CATEGORY = { id: "cat-1", name: "Program supplies", flow: "expense", countsAsGiving: false };
  const TXNS = [
    {
      id: "t1",
      categoryId: "cat-1",
      flow: "expense",
      amountCents: 4_000,
      status: "posted",
      txnDate: "2026-09-10", // inside FY2026 (Jul 2026-Jun 2027)
    },
  ];

  function budgetRow(pendingDeleteAt: Date | null) {
    return {
      id: "budget-1",
      categoryId: "cat-1",
      flow: "expense",
      annualAmountCents: 10_000,
      pendingDeleteAt,
    };
  }

  /** Queues the 6 canned select() results getFundReport() consumes when
   *  there's exactly one budget row present (fund, txns, categories, budgets,
   *  pre-FY rollforward, then the cause-tagged-budget-line-items query which
   *  fires whenever budgetIds.length > 0 — no children in either scenario). */
  function queueFundReport(pendingDeleteAt: Date | null) {
    mockDbState.queue.push([FUND], TXNS, [CATEGORY], [budgetRow(pendingDeleteAt)], [], []);
  }

  it("leaves budgetCents/variance/totalIncomeCents/totalExpenseCents/endingCents byte-for-byte identical whether or not the row is marked pending-delete", async () => {
    queueFundReport(null);
    const withoutPending = await getFundReport("fund-1", 2026);

    queueFundReport(new Date("2026-07-28T16:40:00.000Z"));
    const withPending = await getFundReport("fund-1", 2026);

    expect(withoutPending).not.toBeNull();
    expect(withPending).not.toBeNull();

    // The flag itself must differ between the two calls...
    expect(withoutPending!.expense[0].pendingDeleteAt).toBeNull();
    expect(withPending!.expense[0].pendingDeleteAt).toBe("2026-07-28T16:40:00.000Z");

    // ...but every committed figure is untouched by it.
    expect(withPending!.expense[0].budgetCents).toBe(withoutPending!.expense[0].budgetCents);
    expect(withPending!.expense[0].actualCents).toBe(withoutPending!.expense[0].actualCents);
    expect(withPending!.expense[0].variance).toEqual(withoutPending!.expense[0].variance);
    expect(withPending!.expense[0].causeLines).toEqual(withoutPending!.expense[0].causeLines);
    expect(withPending!.totalIncomeCents).toBe(withoutPending!.totalIncomeCents);
    expect(withPending!.totalExpenseCents).toBe(withoutPending!.totalExpenseCents);
    expect(withPending!.endingCents).toBe(withoutPending!.endingCents);

    // Byte-for-byte, not just field-by-field: strip pendingDeleteAt from both
    // reports and diff everything else in one shot.
    const stripPendingDeleteAt = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value, (key, v) => (key === "pendingDeleteAt" ? undefined : v)));
    expect(stripPendingDeleteAt(withPending)).toEqual(stripPendingDeleteAt(withoutPending));
  });
});

// ---------------------------------------------------------------------------
// getFundReport — causeActualsByKey (Prior-Year Reference on Cause/
// Beneficiary Budget Lines, 2026-07-28-causeline-prior-year-reference).
// Extends the category-grain prior-year reference (2026-07-28-budgeting-
// page-redesign, Increment 1) down to the cause/beneficiary lines inside a
// category's breakdown. getFundReport itself is FY-agnostic about "prior" —
// the caller (budgeting/page.tsx) calls it once at fiscalYear and once at
// fiscalYear - 1, then matches the two via causeLineReferenceKey. These
// tests exercise getFundReport's own half of that: the (categoryId, cause,
// party) grouping it computes from posted expense actuals it already fetches.
// ---------------------------------------------------------------------------

describe("getFundReport — causeActualsByKey", () => {
  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  const FUND = { id: "fund-1", entityId: "entity-1", kind: "charitable", openingBalanceCents: 0 };

  it("groups posted expense actuals by (categoryId, cause, party), ignoring pending rows, income rows, and blank/whitespace-only cause rows", async () => {
    const categories = [
      { id: "cat-1", name: "Charitable donation out", flow: "expense", countsAsGiving: true },
      { id: "cat-2", name: "Program income", flow: "income", countsAsGiving: false },
    ];
    const txns = [
      { id: "t1", categoryId: "cat-1", flow: "expense", amountCents: 5_000, status: "posted", txnDate: "2026-08-01", beneficiaryCause: "Hunger & Basic Needs", party: "WARM" },
      { id: "t2", categoryId: "cat-1", flow: "expense", amountCents: 2_500, status: "posted", txnDate: "2026-08-02", beneficiaryCause: "Hunger & Basic Needs", party: "WARM" },
      { id: "t3", categoryId: "cat-1", flow: "expense", amountCents: 1_000, status: "posted", txnDate: "2026-08-03", beneficiaryCause: "Hunger & Basic Needs", party: "Caring & Sharing" },
      // Pending — excluded from actuals entirely (mirrors actualMap's own posted-only filter).
      { id: "t4", categoryId: "cat-1", flow: "expense", amountCents: 99_999, status: "pending", txnDate: "2026-08-04", beneficiaryCause: "Hunger & Basic Needs", party: "WARM" },
      // Income flow — never a cause-line source (isCauseEligibleCategory gates on expense only).
      { id: "t5", categoryId: "cat-2", flow: "income", amountCents: 200, status: "posted", txnDate: "2026-08-05", beneficiaryCause: "Hunger & Basic Needs", party: "WARM" },
      // Blank / whitespace-only beneficiaryCause — no cause to group by.
      { id: "t6", categoryId: "cat-1", flow: "expense", amountCents: 50, status: "posted", txnDate: "2026-08-06", beneficiaryCause: null, party: "WARM" },
      { id: "t7", categoryId: "cat-1", flow: "expense", amountCents: 60, status: "posted", txnDate: "2026-08-07", beneficiaryCause: "   ", party: "WARM" },
    ];
    mockDbState.queue.push([FUND], txns, categories, [], []);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();

    const warmKey = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "WARM");
    const caringKey = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "Caring & Sharing");
    expect(report!.causeActualsByKey[warmKey]).toBe(7_500); // t1 + t2, NOT t4 (pending)
    expect(report!.causeActualsByKey[caringKey]).toBe(1_000);
    // Never a key for the income row or the two blank-cause rows.
    expect(Object.keys(report!.causeActualsByKey)).toHaveLength(2);

    // Regression: the pre-existing actualCents/totals figure still includes
    // every posted expense txn regardless of cause tag (unaffected by this
    // feature) — 5000+2500+1000+50+60, excluding pending t4 and income t5.
    expect(report!.expense[0].actualCents).toBe(8_610);
    expect(report!.totalExpenseCents).toBe(8_610);
  });

  it("regression: causeLines[].amountCents (the budget figures) and causeActualsByKey (the actual figures) are computed independently — adding the latter never touches the former", async () => {
    const category = { id: "cat-1", name: "Charitable donation out", flow: "expense", countsAsGiving: true };
    const budgetRow = { id: "budget-1", categoryId: "cat-1", flow: "expense", annualAmountCents: 20_000, pendingDeleteAt: null };
    const budgetLineRows = [
      { id: "line-1", budgetId: "budget-1", cause: "Hunger & Basic Needs", label: "WARM", amountCents: 12_000, pendingDeleteAt: null },
      { id: "line-2", budgetId: "budget-1", cause: "Hunger & Basic Needs", label: "", amountCents: 8_000, pendingDeleteAt: null },
    ];
    const txns = [
      { id: "t1", categoryId: "cat-1", flow: "expense", amountCents: 11_000, status: "posted", txnDate: "2026-08-01", beneficiaryCause: "Hunger & Basic Needs", party: "WARM" },
      { id: "t2", categoryId: "cat-1", flow: "expense", amountCents: 7_000, status: "posted", txnDate: "2026-08-02", beneficiaryCause: "Hunger & Basic Needs", party: null },
    ];
    mockDbState.queue.push([FUND], txns, [category], [budgetRow], [], budgetLineRows);

    const report = await getFundReport("fund-1", 2026);
    expect(report).not.toBeNull();

    // Budget figures — untouched by this feature, still exactly what the
    // budget lines say.
    expect(report!.expense[0].budgetCents).toBe(20_000);
    expect(report!.expense[0].causeLines).toEqual([
      {
        id: "line-1",
        cause: "Hunger & Basic Needs",
        label: "WARM",
        amountCents: 12_000,
        pendingDeleteAt: null,
        linkedActualCents: 0,
        linkedTransactionCount: 0,
        actualCents: 11_000,
        isFuzzyFallback: true,
      },
      {
        id: "line-2",
        cause: "Hunger & Basic Needs",
        label: "",
        amountCents: 8_000,
        pendingDeleteAt: null,
        linkedActualCents: 0,
        linkedTransactionCount: 0,
        actualCents: 7_000,
        isFuzzyFallback: true,
      },
    ]);

    // Actual figures — the new, independent aggregation. Deliberately
    // different numbers from the budget lines above, proving the two are
    // never conflated.
    expect(report!.causeActualsByKey[causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "WARM")]).toBe(11_000);
    expect(report!.causeActualsByKey[causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "")]).toBe(7_000);

    expect(report!.expense[0].actualCents).toBe(18_000);
    expect(report!.totalExpenseCents).toBe(18_000);
  });

  it("empty fund (no cause-tagged actuals at all) returns {} for causeActualsByKey, not a throw", async () => {
    mockDbState.queue.push([FUND], [], [], [], []);
    const report = await getFundReport("fund-1", 2026);
    expect(report!.causeActualsByKey).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getDuesTimingAdjustment — Budget-Balance Overview (2026-07-28)
// ---------------------------------------------------------------------------

describe("getDuesTimingAdjustment", () => {
  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  it("re-homes a dues row received in FY2025 but for FY2026 into FY2026's adjusted figure", async () => {
    mockDbState.queue.push([
      { txnDate: "2026-06-15", amountCents: 12_000, duesFiscalYear: 2026 },
    ]);

    const fy2025 = await getDuesTimingAdjustment("fund-1", 2025);
    expect(fy2025).toEqual({
      fiscalYear: 2025,
      cashBasisDuesCents: 12_000,
      adjustedDuesCents: 0,
      deltaCents: -12_000,
    });

    mockDbState.queue.push([
      { txnDate: "2026-06-15", amountCents: 12_000, duesFiscalYear: 2026 },
    ]);

    const fy2026 = await getDuesTimingAdjustment("fund-1", 2026);
    expect(fy2026).toEqual({
      fiscalYear: 2026,
      cashBasisDuesCents: 0,
      adjustedDuesCents: 12_000,
      deltaCents: 12_000,
    });
  });

  it("no dues-linked rows for the fund -> all-zero adjustment, not null (caller hides the block, doesn't treat this as a failure)", async () => {
    mockDbState.queue.push([]);
    const result = await getDuesTimingAdjustment("fund-1", 2026);
    expect(result).toEqual({
      fiscalYear: 2026,
      cashBasisDuesCents: 0,
      adjustedDuesCents: 0,
      deltaCents: 0,
    });
  });

  it("query failure returns null so the caller can degrade to cash-basis only instead of crashing the report page", async () => {
    const spy = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("connection reset");
    });
    const result = await getDuesTimingAdjustment("fund-1", 2026);
    expect(result).toBeNull();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getPendingApprovals — Transfer/Sweep pair dedup (DECISION-058)
// ---------------------------------------------------------------------------

describe("getPendingApprovals — Transfer/Sweep pair dedup (DECISION-058)", () => {
  beforeEach(() => {
    mockDbState.queue = [];
  });

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: "txn-default",
      entityId: "entity-club",
      fundId: "fund-default",
      txnDate: "2026-07-29",
      flow: "expense",
      amountCents: 1000,
      categoryId: null,
      party: null,
      memo: null,
      paymentMethod: null,
      checkNumber: null,
      bankAccountId: "bank-1",
      beneficiaryCause: null,
      publicNote: null,
      receiptStorageKey: null,
      receiptWaivedAt: null,
      receiptWaivedByUserId: null,
      receiptWaiverReason: null,
      transferGroupId: null,
      status: "pending",
      approvedByUserId: null,
      approvedAt: null,
      boardMinute: null,
      rejectionReason: null,
      reconciled: false,
      reconciledAt: null,
      reconciledSessionId: null,
      recordedByUserId: "user-1",
      duesPaymentId: null,
      syncStale: false,
      donorId: null,
      createdAt: new Date("2026-07-29T00:00:00Z"),
      updatedAt: new Date("2026-07-29T00:00:00Z"),
      fundName: "Some Fund",
      recorderDisplayName: "Treasurer Tess",
      ...overrides,
    };
  }

  it("a pending Sweep pair yields exactly one row — the flow='expense' (source) leg", async () => {
    const sourceLeg = baseRow({
      id: "txn-source",
      entityId: "entity-club",
      fundId: "fund-activity",
      flow: "expense",
      transferGroupId: "group-1",
      fundName: "Activity Fund",
    });
    const destLeg = baseRow({
      id: "txn-dest",
      entityId: "entity-foundation",
      fundId: "fund-charitable",
      flow: "income",
      transferGroupId: "group-1",
      fundName: "Charitable Fund",
    });
    mockDbState.queue.push([sourceLeg, destLeg]);

    const result = await getPendingApprovals();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("txn-source");
    expect(result[0].partnerFundId).toBe("fund-charitable");
    expect(result[0].partnerFundName).toBe("Charitable Fund");
    expect(result[0].partnerEntityId).toBe("entity-foundation");
  });

  it("an ordinary pending expense (no transferGroupId) passes through with null partner fields", async () => {
    const ordinary = baseRow({ id: "txn-ordinary", transferGroupId: null, flow: "expense" });
    mockDbState.queue.push([ordinary]);

    const result = await getPendingApprovals();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("txn-ordinary");
    expect(result[0].partnerFundId).toBeNull();
    expect(result[0].partnerFundName).toBeNull();
    expect(result[0].partnerEntityId).toBeNull();
  });

  it("a mix of an ordinary pending expense and a pending Transfer pair returns one row each", async () => {
    const ordinary = baseRow({ id: "txn-ordinary", transferGroupId: null, flow: "expense" });
    const sourceLeg = baseRow({
      id: "txn-source",
      fundId: "fund-admin-checking-leg",
      flow: "expense",
      transferGroupId: "group-2",
      fundName: "Administrative Fund",
    });
    const destLeg = baseRow({
      id: "txn-dest",
      fundId: "fund-admin-petty-cash-leg",
      flow: "income",
      transferGroupId: "group-2",
      fundName: "Administrative Fund",
    });
    mockDbState.queue.push([ordinary, sourceLeg, destLeg]);

    const result = await getPendingApprovals();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(["txn-ordinary", "txn-source"]);
  });
});

// ---------------------------------------------------------------------------
// listPendingAcknowledgments — ackId/ackSentAt carried through to the row
// shape (docs/work-log/2026-08-08-acknowledgment-donor-link.md, second
// increment). Regression test: the SELECT already fetched ackId/ackSentAt
// (see the select() below), but the old .map() dropped both before
// returning — AckQueue had no way to tell "no ack yet" apart from "ack
// exists, unsent" and always rendered "Record acknowledgment", which 409'd
// on the latter. This pins that the mapped row exposes both fields
// byte-for-byte from the query.
// ---------------------------------------------------------------------------
describe("listPendingAcknowledgments — ackId/ackSentAt row-shape regression", () => {
  beforeEach(() => {
    mockDbState.queue = [];
  });

  const TXN = {
    id: "txn-1",
    entityId: "entity-foundation",
    fundId: "fund-charitable",
    txnDate: "2026-08-01",
    flow: "income",
    amountCents: 50000,
    status: "posted",
    donorId: null,
  };

  it("a row with no acknowledgment yet carries ackId: null and ackSentAt: null through to the returned row", async () => {
    mockDbState.queue.push([
      {
        txn: TXN,
        fundName: "Charitable Fund",
        entityName: "Foundation",
        ackId: null,
        ackSentAt: null,
        donor: null,
      },
    ]);

    const rows = await listPendingAcknowledgments();

    expect(rows).toHaveLength(1);
    expect(rows[0].ackId).toBeNull();
    expect(rows[0].ackSentAt).toBeNull();
  });

  it("a row with an unsent acknowledgment carries the ack's id through — this is the row AckQueue must offer Mark Sent for, not Record", async () => {
    mockDbState.queue.push([
      {
        txn: TXN,
        fundName: "Charitable Fund",
        entityName: "Foundation",
        ackId: "ack-99",
        ackSentAt: null,
        donor: { id: "donor-1", name: "Trucco Construction Co" },
      },
    ]);

    const rows = await listPendingAcknowledgments();

    expect(rows).toHaveLength(1);
    expect(rows[0].ackId).toBe("ack-99");
    expect(rows[0].ackSentAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listPendingAcknowledgments — ack_not_required exclusion
// (docs/work-log/2026-08-08-ack-not-required-flag.md). The hermetic mock's
// `where()` only CAPTURES the composed condition (it doesn't evaluate it
// against the canned queue), so — mirroring the established "getFundReport
// asOfDate bounding" pattern above — this asserts the compiled WHERE clause
// structurally includes the ack_not_required exclusion (as an OR admitting
// "no category" alongside "category not flagged"), rather than a row-level
// filtering result a full DB round trip would be needed to prove.
// ---------------------------------------------------------------------------
describe("listPendingAcknowledgments — ack_not_required exclusion", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  it("WHERE clause excludes categories flagged ack_not_required while still admitting rows with no category", async () => {
    mockDbState.queue.push([]);

    await listPendingAcknowledgments();

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    // The category-id-null / not-flagged OR pair, alongside ledger_categories
    // actually being referenced (proves the join + filter are wired, not
    // just present in isolation).
    expect(sql).toContain('"ack_not_required"');
    expect(sql).toContain('"ledger_categories"');
    expect(params).toContain(false);
  });
});

// ---------------------------------------------------------------------------
// listAcknowledgmentsSummary — sentOnly filter + sentVia passthrough
// (docs/work-log/2026-08-12-sent-acknowledgments-view.md). Before this fix,
// a sent acknowledgment (sentAt set) had no view anywhere in the app — the
// only existing filter, pendingOnly, only ever excluded sent rows, never
// isolated them. sentOnly is the new "Sent Acknowledgments" tab's query.
// ---------------------------------------------------------------------------
describe("listAcknowledgmentsSummary — sentOnly filter", () => {
  const dialect = new PgDialect();

  beforeEach(() => {
    mockDbState.queue = [];
    mockDbState.wheres = [];
  });

  it("sentOnly: true compiles a WHERE of sent_at IS NOT NULL, not IS NULL", async () => {
    mockDbState.queue.push([]);

    await listAcknowledgmentsSummary({ sentOnly: true });

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sql).toContain('"ledger_acknowledgments"."sent_at" is not null');
  });

  it("pendingOnly still compiles sent_at IS NULL (unchanged) and wins if both flags are passed", async () => {
    mockDbState.queue.push([]);

    await listAcknowledgmentsSummary({ pendingOnly: true, sentOnly: true });

    expect(mockDbState.wheres).toHaveLength(1);
    const { sql } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sql).toContain('"ledger_acknowledgments"."sent_at" is null');
    expect(sql).not.toContain("is not null");
  });

  it("no filter (neither flag) passes an empty condition — the existing 'all acks' caller", async () => {
    mockDbState.queue.push([]);

    await listAcknowledgmentsSummary({});

    // .where() is still called (matches the existing conditions.length > 0
    // ? and(...) : undefined idiom), but with no condition — i.e. no rows
    // are excluded.
    expect(mockDbState.wheres).toHaveLength(1);
    expect(mockDbState.wheres[0]).toBeUndefined();
  });

  it("carries sentVia through per row ('email', 'print', and legacy null all pass through untouched)", async () => {
    mockDbState.queue.push([
      {
        id: "ack-1",
        donationTxnId: "txn-1",
        amountCents: 50000,
        txnDate: "2026-08-01",
        type: "written_ack_250",
        sentAt: new Date("2026-08-02"),
        sentVia: "email",
        quidProQuoValueCents: null,
        donorId: "donor-1",
        entityName: "Foundation",
        fundName: "Charitable Fund",
        donorName: "Trucco Construction Co",
      },
      {
        id: "ack-2",
        donationTxnId: "txn-2",
        amountCents: 30000,
        txnDate: "2026-07-15",
        type: "written_ack_250",
        sentAt: new Date("2026-07-16"),
        sentVia: "print",
        quidProQuoValueCents: null,
        donorId: null,
        entityName: "Foundation",
        fundName: "Charitable Fund",
        donorName: null,
      },
      {
        id: "ack-3",
        donationTxnId: "txn-3",
        amountCents: 25000,
        txnDate: "2026-03-01",
        type: "written_ack_250",
        sentAt: new Date("2026-03-02"),
        sentVia: null,
        quidProQuoValueCents: null,
        donorId: null,
        entityName: "Foundation",
        fundName: "Charitable Fund",
        donorName: null,
      },
    ]);

    const rows = await listAcknowledgmentsSummary({ sentOnly: true, includePii: true });

    expect(rows).toHaveLength(3);
    expect(rows[0].sentVia).toBe("email");
    expect(rows[0].donorId).toBe("donor-1");
    expect(rows[1].sentVia).toBe("print");
    expect(rows[1].donorId).toBeNull();
    expect(rows[2].sentVia).toBeNull();
    expect(rows[2].donorId).toBeNull();
  });

  it("omits donorId/donorName when includePii is not set, even though the row is sent and has a donor", async () => {
    mockDbState.queue.push([
      {
        id: "ack-1",
        donationTxnId: "txn-1",
        amountCents: 50000,
        txnDate: "2026-08-01",
        type: "written_ack_250",
        sentAt: new Date("2026-08-02"),
        sentVia: "email",
        quidProQuoValueCents: null,
        donorId: "donor-1",
        entityName: "Foundation",
        fundName: "Charitable Fund",
        donorName: "Trucco Construction Co",
      },
    ]);

    const rows = await listAcknowledgmentsSummary({ sentOnly: true, includePii: false });

    expect(rows).toHaveLength(1);
    expect(rows[0].donorId).toBeUndefined();
    expect(rows[0].donorName).toBeUndefined();
    expect(rows[0].sentVia).toBe("email");
  });
});

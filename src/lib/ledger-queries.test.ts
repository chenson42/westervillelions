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

import { describe, it, expect, vi } from "vitest";

// ledger-queries.ts imports the real `db` (src/lib/db), which throws at import
// time when DATABASE_URL/DB_URL is unset (e.g. a bare `pnpm test` or CI without
// .env.local). These tests never touch the real db export — every case drives a
// mock transaction client passed in as `tx` — so we mock the module to keep the
// suite hermetic, mirroring src/lib/members.test.ts.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  createBudgetCauseLine,
  updateBudgetCauseLine,
  deleteBudgetCauseLine,
  upsertBudgetCauseLineForSeed,
  collapseBudgetCauseLines,
  computeCauseSeedForCategory,
  upsertBudgetLine,
} from "./ledger-queries";
import { ledgerFunds, ledgerCategories, ledgerBudgets, ledgerBudgetLines } from "./db/schema";

// ---------------------------------------------------------------------------
// Minimal Drizzle transaction client mock factory
// ---------------------------------------------------------------------------

type InsertCall = {
  table: unknown;
  values: Record<string, unknown>;
  conflictMode: "doNothing" | "doUpdate" | "plain";
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
  deleteReturning?: unknown[][];
}) {
  let si = 0;
  let ii = 0;
  let ui = 0;
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
        onConflictDoUpdate: () => {
          insertCalls.push({ table, values, conflictMode: "doUpdate" });
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
          where: async () => {
            const throwEntry = opts.updateThrows?.[ui++];
            if (throwEntry) {
              const err = new Error("duplicate key value violates unique constraint");
              (err as Error & { code?: string }).code = throwEntry.__pgErrorCode;
              throw err;
            }
            return undefined;
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

    expect(result).toEqual({ ok: true, action: "collapsed", annualAmountCents: 5_000 });
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(ledgerBudgetLines);
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

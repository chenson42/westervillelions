/**
 * Unit tests for src/lib/ledger-budget-context-queries.ts — Budget Context on
 * Transaction Entry (2026-08-08, DECISION-069/070). Covers the Phase 3
 * design doc's named tests 1-7:
 *   1. A `rejected` transaction is never fetched at all — the query's own
 *      WHERE clause restricts to status IN ('posted', 'pending').
 *   2. A posted and a pending transaction in the same category both land in
 *      the correct, separately-labeled field (postedCents vs. pendingCents).
 *   3. A category with no ledgerBudgets row for (fundId, fiscalYear) returns
 *      budgetCents: null, not 0.
 *   4. A starred/noted annotation-only budget row (annualAmountCents: 0, no
 *      cause lines) also returns budgetCents: null via resolveDisplayBudgetCents.
 *   5. A cause line's postedCents resolves via exact-link-wins-over-fuzzy-
 *      fallback (resolveCauseLineActual); pendingCents is direct-link-only.
 *   6. A pending transaction with a non-blank beneficiaryCause but no
 *      explicit budgetLineId does NOT appear in any line's pendingCents
 *      (fuzzy pool is posted-only) but DOES count at the category grain.
 *   7. fiscalYear/fundId scoping — the query's WHERE clauses are structurally
 *      bound to the requested (fundId, fiscalYear), not a broader scope.
 *
 * Test 13 (403 on missing BUDGET_VIEW/LEDGER_MANAGE) lives in
 * src/app/api/admin/ledger/budget-context/route.test.ts, alongside this
 * route's other gate/validation tests.
 *
 * Hermetic: mocks @/lib/db (FIFO select queue + captured WHERE conditions,
 * mirroring the established pattern in src/lib/ledger-category-queries.test.ts /
 * src/lib/ledger-queries.test.ts). @/lib/ledger.ts is imported UNMOCKED — this
 * suite exercises the real resolveCauseLineActual/resolveDisplayBudgetCents/
 * isEligibleForFuzzyCauseMatch/buildCauseActualsByKey/causeLineReferenceKey,
 * which is the whole point: proving this module reuses them rather than a
 * fork that could silently drift.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    wheres: [] as unknown[],
  },
}));

vi.mock("@/lib/db", () => {
  function selectChain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.selectQueue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }

  return {
    db: {
      select: () => selectChain(),
    },
  };
});

import { getBudgetContext } from "./ledger-budget-context-queries";

function resetMockDb() {
  mockDbState.selectQueue = [];
  mockDbState.wheres = [];
}

beforeEach(() => {
  resetMockDb();
});

const FUND_ID = "fund-1";
const ENTITY_ID = "entity-1";
const FY = 2026;

function fund(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: FUND_ID,
    entityId: ENTITY_ID,
    slug: "activity",
    name: "Activity Fund",
    kind: "activity",
    openingBalanceCents: 0,
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function category(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cat-1",
    entityId: ENTITY_ID,
    fundKind: "activity",
    flow: "expense",
    name: "Awards",
    form990Line: null,
    sortOrder: 0,
    isActive: true,
    countsAsGiving: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function budgetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "budget-1",
    entityId: ENTITY_ID,
    fundId: FUND_ID,
    fiscalYear: FY,
    categoryId: "cat-1",
    flow: "expense",
    annualAmountCents: 50000,
    starred: false,
    note: null,
    pendingDeleteAt: null,
    createdAt: new Date("2025-07-01"),
    updatedAt: new Date("2025-07-01"),
    ...overrides,
  };
}

function txn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "txn-1",
    entityId: ENTITY_ID,
    fundId: FUND_ID,
    txnDate: "2026-08-01",
    flow: "expense",
    categoryId: "cat-1",
    amountCents: 1000,
    party: "Some Vendor",
    beneficiaryCause: null,
    budgetLineId: null,
    status: "posted",
    ...overrides,
  };
}

function lineRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "line-1",
    cause: "Diabetes",
    label: "",
    amountCents: 10000,
    categoryId: "cat-1",
    categoryName: "Awards",
    flow: "expense",
    ...overrides,
  };
}

describe("getBudgetContext", () => {
  it("returns null when the fund doesn't exist", async () => {
    mockDbState.selectQueue.push([]); // fund lookup empty

    const result = await getBudgetContext("missing-fund", FY);

    expect(result).toBeNull();
  });

  it("test 1: restricts the transaction WHERE to status IN ('posted', 'pending') — rejected is never fetched, structurally", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [], // txns
      [], // categories
      [], // budgetRows
      [], // lineRows
    );

    await getBudgetContext(FUND_ID, FY);

    // wheres[0] = fund lookup, wheres[1] = txns where.
    const dialect = new PgDialect();
    const { sql, params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(params).toContain("posted");
    expect(params).toContain("pending");
    expect(params).not.toContain("rejected");
    expect(sql).toContain("in");
  });

  it("test 2: a posted and a pending transaction in the same category land in separately-labeled fields, not summed", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [
        txn({ id: "t-posted", status: "posted", amountCents: 4000, categoryId: "cat-1" }),
        txn({ id: "t-pending", status: "pending", amountCents: 1500, categoryId: "cat-1" }),
      ],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1", annualAmountCents: 50000 })],
      [],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    expect(result).not.toBeNull();
    const row = result!.categories.find((c) => c.categoryId === "cat-1");
    expect(row).toBeDefined();
    expect(row!.postedCents).toBe(4000);
    expect(row!.pendingCents).toBe(1500);
  });

  it("test 3: a category with no ledgerBudgets row returns budgetCents: null, not 0", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [],
      [category({ id: "cat-1" })],
      [], // no budget rows at all
      [],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const row = result!.categories.find((c) => c.categoryId === "cat-1");
    expect(row!.budgetCents).toBeNull();
  });

  it("test 4: a starred/noted annotation-only $0 budget row (no cause lines) also returns budgetCents: null", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1", annualAmountCents: 0, starred: true, note: null })],
      [], // no cause lines under this budget row
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const row = result!.categories.find((c) => c.categoryId === "cat-1");
    expect(row!.budgetCents).toBeNull();
  });

  it("a genuine (non-annotation) $0 budget row still returns budgetCents: 0", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1", annualAmountCents: 0, starred: false, note: null })],
      [],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const row = result!.categories.find((c) => c.categoryId === "cat-1");
    expect(row!.budgetCents).toBe(0);
  });

  it("test 5: a cause line's postedCents resolves exact-link-wins-over-fuzzy-fallback; pendingCents is direct-link-only", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [
        // Exact-linked posted txn for line-1 ($3000).
        txn({
          id: "t-linked",
          status: "posted",
          categoryId: "cat-1",
          flow: "expense",
          budgetLineId: "line-1",
          amountCents: 3000,
        }),
        // A fuzzy-eligible posted txn for the SAME cause/label but with no
        // explicit link — must be ignored once an exact link exists.
        txn({
          id: "t-fuzzy",
          status: "posted",
          categoryId: "cat-1",
          flow: "expense",
          budgetLineId: null,
          beneficiaryCause: "Diabetes",
          party: null,
          amountCents: 9999,
        }),
        // A pending, exact-linked txn for line-1 ($500).
        txn({
          id: "t-pending-linked",
          status: "pending",
          categoryId: "cat-1",
          flow: "expense",
          budgetLineId: "line-1",
          amountCents: 500,
        }),
      ],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1" })],
      [lineRow({ id: "line-1", cause: "Diabetes", label: "" })],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const line = result!.lines.find((l) => l.budgetLineId === "line-1");
    expect(line).toBeDefined();
    // Exact link ($3000) wins over the fuzzy fallback ($9999) entirely.
    expect(line!.postedCents).toBe(3000);
    expect(line!.pendingCents).toBe(500);
  });

  it("test 5b: with NO exact link, a cause line falls back to the fuzzy (categoryId, cause, label) match", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [
        txn({
          id: "t-fuzzy",
          status: "posted",
          categoryId: "cat-1",
          flow: "expense",
          budgetLineId: null,
          beneficiaryCause: "Diabetes",
          party: null,
          amountCents: 2200,
        }),
      ],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1" })],
      [lineRow({ id: "line-1", cause: "Diabetes", label: "" })],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const line = result!.lines.find((l) => l.budgetLineId === "line-1");
    expect(line!.postedCents).toBe(2200);
    expect(line!.pendingCents).toBe(0);
  });

  it("test 6: a pending txn with a non-blank beneficiaryCause but no budgetLineId doesn't appear in any line's pendingCents, but does count at the category grain", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [
        txn({
          id: "t-pending-unlinked",
          status: "pending",
          categoryId: "cat-1",
          flow: "expense",
          budgetLineId: null,
          beneficiaryCause: "Diabetes",
          party: null,
          amountCents: 700,
        }),
      ],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1" })],
      [lineRow({ id: "line-1", cause: "Diabetes", label: "" })],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    const line = result!.lines.find((l) => l.budgetLineId === "line-1");
    expect(line!.pendingCents).toBe(0);
    expect(line!.postedCents).toBe(0);

    const categoryRow = result!.categories.find((c) => c.categoryId === "cat-1");
    expect(categoryRow!.pendingCents).toBe(700);
  });

  it("test 7: budgetRows and lineRows queries are structurally scoped to the requested (fundId, fiscalYear)", async () => {
    mockDbState.selectQueue.push([fund()], [], [category({ id: "cat-1" })], [], []);

    await getBudgetContext(FUND_ID, FY);

    // wheres[0] fund, [1] txns, [2] categories, [3] budgetRows, [4] lineRows.
    const dialect = new PgDialect();

    const budgetRowsQuery = dialect.sqlToQuery(mockDbState.wheres[3] as never);
    expect(budgetRowsQuery.params).toContain(FUND_ID);
    expect(budgetRowsQuery.params).toContain(FY);

    const lineRowsQuery = dialect.sqlToQuery(mockDbState.wheres[4] as never);
    expect(lineRowsQuery.params).toContain(FUND_ID);
    expect(lineRowsQuery.params).toContain(FY);
  });

  it("test 7b: a different fund's or a different fiscal year's rows never leak in — proven by only queueing scoped rows and asserting the response contains exactly those", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [txn({ id: "t-1", categoryId: "cat-1", amountCents: 1200, status: "posted" })],
      [category({ id: "cat-1" })],
      [budgetRow({ categoryId: "cat-1", fundId: FUND_ID, fiscalYear: FY, annualAmountCents: 40000 })],
      [lineRow({ id: "line-1", categoryId: "cat-1" })],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    expect(result!.fiscalYear).toBe(FY);
    expect(result!.categories).toHaveLength(1);
    expect(result!.categories[0].budgetCents).toBe(40000);
    expect(result!.lines).toHaveLength(1);
  });

  it("a budget line whose parent budget row has a null categoryId is excluded, not crashed on", async () => {
    mockDbState.selectQueue.push(
      [fund()],
      [],
      [category({ id: "cat-1" })],
      [],
      [lineRow({ id: "line-orphan", categoryId: null })],
    );

    const result = await getBudgetContext(FUND_ID, FY);

    expect(result!.lines).toHaveLength(0);
  });
});

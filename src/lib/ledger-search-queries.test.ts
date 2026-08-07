/**
 * Unit tests for src/lib/ledger-search-queries.ts (Ledger & Budget Search,
 * 2026-08-06, docs/work-log/2026-08-06-ledger-search.md, DECISION-062/063).
 *
 * Covers the Phase 3 design's "Unit Tests to Write in Phase 4" items assigned
 * to api-developer's half (2, 3, 5, 6, 7, 8 — item 1 is escapeIlikeTerm,
 * covered in ledger.test.ts; item 4 is page-level permission gating, covered
 * by ux-developer in page.tsx per the design's own Implementation Order):
 *
 *   2. searchTransactions() FY-boundary correctness.
 *   3. Subtotals span ALL matches, not just the visible page.
 *   5. Inapplicable-filter policy on searchBudgetLines() (transaction-only
 *      filters are ignored for scoping, never force zero rows).
 *   6. Amount single-value = exact match, not an open-ended >=.
 *   7. Free-text OR-across-fields (not just party/memo).
 *   8. Lump-sum ledgerBudgets rows are structurally excluded.
 *
 * Hermetic: mocks @/lib/db so `pnpm test` passes without DATABASE_URL/DB_URL
 * set — same FIFO-queue convention as reconciliation-queries.test.ts /
 * ledger-queries.test.ts. Where boundary/operator correctness matters (tests
 * 2, 5, 6, 7), the mock also captures each select's `.from()`/`.innerJoin()`/
 * `.leftJoin()`/`.where()` calls so the generated SQL can be inspected via
 * `PgDialect().sqlToQuery()` — the exact technique already established by
 * ledger-queries.test.ts's "getFundReport asOfDate bounding" block.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    queue: [] as unknown[][],
    wheres: [] as unknown[],
    froms: [] as unknown[],
    joins: [] as { type: "inner" | "left"; table: unknown }[],
  },
}));

vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: (table: unknown) => {
        mockDbState.froms.push(table);
        return obj;
      },
      innerJoin: (table: unknown) => {
        mockDbState.joins.push({ type: "inner", table });
        return obj;
      },
      leftJoin: (table: unknown) => {
        mockDbState.joins.push({ type: "left", table });
        return obj;
      },
      where: (cond: unknown) => {
        mockDbState.wheres.push(cond);
        return obj;
      },
      orderBy: () => obj,
      groupBy: () => obj,
      limit: () => obj,
      offset: () => obj,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockDbState.queue.shift() ?? []).then(resolve, reject),
    };
    return obj;
  }
  return { db: { select: () => chain() } };
});

import {
  searchTransactions,
  searchBudgetLines,
  type LedgerSearchFilters,
  type TransactionSearchRow,
  type BudgetLineSearchRow,
} from "./ledger-search-queries";
import { ledgerBudgetLines, ledgerBudgets, ledgerCategories } from "./db/schema";
import { fyBounds } from "./fiscal-year";

beforeEach(() => {
  mockDbState.queue = [];
  mockDbState.wheres = [];
  mockDbState.froms = [];
  mockDbState.joins = [];
});

function baseFilters(overrides: Partial<LedgerSearchFilters> = {}): LedgerSearchFilters {
  return { q: "", fiscalYear: null, ...overrides };
}

const EMPTY_AGG = [{ count: 0, totalIncomeCents: 0, totalExpenseCents: 0 }];

function makeTxnRow(overrides: Partial<TransactionSearchRow> = {}): TransactionSearchRow {
  return {
    id: "txn-1",
    txnDate: "2026-08-01",
    flow: "expense",
    amountCents: 5_000,
    party: "WARM",
    memo: null,
    beneficiaryCause: null,
    checkNumber: null,
    paymentMethod: "check",
    status: "posted",
    reconciled: false,
    transferGroupId: null,
    entityId: "entity-1",
    entityName: "Westerville Lions Club",
    entitySlug: "club",
    fundId: "fund-1",
    fundName: "Administrative Fund",
    fundSlug: "administrative",
    categoryId: null,
    categoryName: null,
    bankAccountId: null,
    bankAccountName: null,
    ...overrides,
  };
}

function makeBudgetLineRow(overrides: Partial<BudgetLineSearchRow> = {}): BudgetLineSearchRow {
  return {
    id: "line-1",
    budgetId: "budget-1",
    isLumpSum: false,
    cause: "Hunger & Basic Needs",
    label: "WARM",
    amountCents: 10_000,
    flow: "expense",
    starred: false,
    note: null,
    pendingDeleteAt: null,
    fiscalYear: 2026,
    entityId: "entity-1",
    entityName: "Westerville Lions Club",
    entitySlug: "club",
    fundId: "fund-1",
    fundName: "Administrative Fund",
    fundSlug: "administrative",
    categoryId: null,
    categoryName: null,
    ...overrides,
  };
}

/** Raw shape a mocked lump-sum row query resolves with (mirrors
 *  fetchLumpSumBudgetRows's select — no cause/label/isLumpSum columns, those
 *  are added by searchBudgetLines()'s own .map()). */
function makeLumpSumDbRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "budget-1",
    budgetId: "budget-1",
    amountCents: 1_000_000,
    flow: "expense",
    starred: false,
    note: null,
    pendingDeleteAt: null,
    fiscalYear: 2026,
    entityId: "entity-1",
    entityName: "Westerville Lions Club",
    entitySlug: "club",
    fundId: "fund-1",
    fundName: "Administrative Fund",
    fundSlug: "administrative",
    categoryId: "cat-1",
    categoryName: "Rudolph Run",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase 3 test 2 — FY-boundary correctness
// ---------------------------------------------------------------------------

describe("searchTransactions — FY-boundary correctness (Phase 3 test 2)", () => {
  const dialect = new PgDialect();

  it("2026-06-30 falls outside FY2026's [2026-07-01, 2027-07-01) window but inside FY2025's [2025-07-01, 2026-07-01) window", () => {
    const fy2026 = fyBounds(2026);
    const fy2025 = fyBounds(2025);
    const date = "2026-06-30";
    expect(date >= fy2026.start && date < fy2026.end).toBe(false); // excluded
    expect(date >= fy2025.start && date < fy2025.end).toBe(true); // included
  });

  it("2026-07-01 falls inside FY2026's window but outside FY2025's window", () => {
    const fy2026 = fyBounds(2026);
    const fy2025 = fyBounds(2025);
    const date = "2026-07-01";
    expect(date >= fy2026.start && date < fy2026.end).toBe(true); // included
    expect(date >= fy2025.start && date < fy2025.end).toBe(false); // excluded
  });

  it("searchTransactions({fiscalYear: 2026}) wires txnDate >= 2026-07-01 AND txnDate < 2027-07-01 into the WHERE clause", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ fiscalYear: 2026 }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(params).toEqual(["2026-07-01", "2027-07-01"]);
    expect(sqlText).toContain(">=");
    expect(sqlText).toContain("<");
    expect(sqlText).not.toContain("<=");
  });

  it("searchTransactions({fiscalYear: 2025}) wires the exclusive upper bound one year earlier — 2026-07-01 is NOT included", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ fiscalYear: 2025 }), 1);

    const { params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(params).toEqual(["2025-07-01", "2026-07-01"]);
  });

  it("fiscalYear: null omits the FY condition entirely (All years) — no bound params at all", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ fiscalYear: null }), 1);

    // No conditions at all in this call -> and() returns undefined -> where(undefined).
    expect(mockDbState.wheres[0]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 3 — subtotals span ALL matches, not just the visible page
// ---------------------------------------------------------------------------

describe("subtotals span all matches, not just the visible page (Phase 3 test 3)", () => {
  it("searchTransactions: totalCount/totalIncomeCents/totalExpenseCents are identical across page 1 and page 2 even though the row sets differ", async () => {
    const agg = [{ count: 214, totalIncomeCents: 900_000, totalExpenseCents: 400_000 }];
    const page1Rows = Array.from({ length: 50 }, (_, i) => makeTxnRow({ id: `p1-${i}` }));
    const page2Rows = Array.from({ length: 50 }, (_, i) => makeTxnRow({ id: `p2-${i}` }));

    mockDbState.queue.push(page1Rows, agg);
    const page1 = await searchTransactions(baseFilters(), 1);

    mockDbState.queue.push(page2Rows, agg);
    const page2 = await searchTransactions(baseFilters(), 2);

    expect(page1.totalCount).toBe(214);
    expect(page1.totalIncomeCents).toBe(900_000);
    expect(page1.totalExpenseCents).toBe(400_000);
    expect(page2.totalCount).toBe(page1.totalCount);
    expect(page2.totalIncomeCents).toBe(page1.totalIncomeCents);
    expect(page2.totalExpenseCents).toBe(page1.totalExpenseCents);

    expect(page1.rows.map((r) => r.id)).not.toEqual(page2.rows.map((r) => r.id));
    expect(page1.totalCount).toBeGreaterThan(page1.rows.length);
  });

  it("searchBudgetLines: totalCount/totalIncomeCents/totalExpenseCents are identical across page 1 and page 2 even though the row sets differ (Fix 1 — now computed by merging+paginating in JS, not a DB-side LIMIT/OFFSET, but the invariant is the same)", async () => {
    // Same cause/label on every row (stable sort keeps insertion order) so
    // page-1/page-2 slicing is deterministic.
    const allMatches = Array.from({ length: 130 }, (_, i) =>
      makeBudgetLineRow({ id: `row-${i}`, cause: "Youth & Education", label: "", amountCents: 1_000 }),
    );

    // Each call to searchBudgetLines() is its own DB round trip in this
    // mock harness — push the SAME full match set for both calls.
    mockDbState.queue.push(allMatches, []);
    const page1 = await searchBudgetLines(baseFilters(), 1);

    mockDbState.queue.push(allMatches, []);
    const page2 = await searchBudgetLines(baseFilters(), 2);

    expect(page1.totalCount).toBe(130);
    expect(page1.totalExpenseCents).toBe(130_000);
    expect(page1.totalIncomeCents).toBe(0);
    expect(page2.totalCount).toBe(page1.totalCount);
    expect(page2.totalIncomeCents).toBe(page1.totalIncomeCents);
    expect(page2.totalExpenseCents).toBe(page1.totalExpenseCents);
    expect(page1.rows.map((r) => r.id)).not.toEqual(page2.rows.map((r) => r.id));
    expect(page1.totalCount).toBeGreaterThan(page1.rows.length);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 5 — inapplicable-filter policy (searchBudgetLines)
// ---------------------------------------------------------------------------

describe("searchBudgetLines — inapplicable transaction-only filters are ignored, not forced to zero (Phase 3 test 5)", () => {
  const dialect = new PgDialect();

  it("bankAccountId/dateFrom/dateTo/status set produce the identical WHERE SQL as when those fields are omitted entirely", async () => {
    const withExtras = baseFilters({
      fiscalYear: 2026,
      entityId: "entity-1",
      bankAccountId: "bank-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      status: "posted",
    });
    const withoutExtras = baseFilters({ fiscalYear: 2026, entityId: "entity-1" });

    mockDbState.queue.push([], []);
    await searchBudgetLines(withExtras, 1);
    const withExtrasQuery = dialect.sqlToQuery(mockDbState.wheres[0] as never);

    mockDbState.wheres = [];
    mockDbState.queue.push([], []);
    await searchBudgetLines(withoutExtras, 1);
    const withoutExtrasQuery = dialect.sqlToQuery(mockDbState.wheres[0] as never);

    expect(withExtrasQuery.sql).toBe(withoutExtrasQuery.sql);
    expect(withExtrasQuery.params).toEqual(withoutExtrasQuery.params);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 6 — amount single value = exact match
// ---------------------------------------------------------------------------

describe("amount filter — a single value means exact match, not an open-ended >= (Phase 3 test 6)", () => {
  const dialect = new PgDialect();

  it("amountMinCents alone produces an = condition on searchTransactions", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ amountMinCents: 5_000 }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(params).toEqual([5_000]);
    expect(sqlText).toContain("=");
    expect(sqlText).not.toContain(">=");
    expect(sqlText).not.toContain("<=");
  });

  it("amountMinCents alone produces an = condition on searchBudgetLines too", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ amountMinCents: 10_000 }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(params).toEqual([10_000]);
    expect(sqlText).not.toContain(">=");
    expect(sqlText).not.toContain("<=");
  });

  it("amountMinCents AND amountMaxCents together produce a range (>= ... <= ...), not exact match", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ amountMinCents: 1_000, amountMaxCents: 5_000 }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(params).toEqual([1_000, 5_000]);
    expect(sqlText).toContain(">=");
    expect(sqlText).toContain("<=");
  });
});

// ---------------------------------------------------------------------------
// Phase 3 test 7 — free-text OR-across-fields
// ---------------------------------------------------------------------------

describe("free-text search ORs across every relevant field, not just party/memo (Phase 3 test 7)", () => {
  const dialect = new PgDialect();

  it("searchTransactions's free-text WHERE ORs across party, memo, beneficiary_cause, check_number, AND category name (Fix 2 adds the 5th)", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ q: "WARM" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"party"');
    expect(sqlText).toContain('"memo"');
    expect(sqlText).toContain('"beneficiary_cause"');
    expect(sqlText).toContain('"check_number"');
    expect(sqlText).toContain('"name"');
    expect(sqlText.match(/ilike/gi)?.length).toBe(5);
    expect(params).toEqual(["%WARM%", "%WARM%", "%WARM%", "%WARM%", "%WARM%"]);
  });

  it("a term that would only match beneficiary_cause (not party/memo/check_number) is still represented in the OR group, not dropped", async () => {
    // Structural proof: the beneficiary_cause disjunct exists in the WHERE
    // clause regardless of what the term is, so a row whose ONLY matching
    // field is beneficiary_cause is reachable by this query — unlike
    // listTransactions()'s narrower party/memo-only `search` opt.
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ q: "Youth Programs" }), 1);

    const { sql: sqlText } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"beneficiary_cause" ilike');
  });

  it("Fix 2 (Phase 4 loop-back, 2026-08-07): a term matching only the transaction's category name is still represented in the OR group, for parity with searchBudgetLines's own category-name match", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ q: "Dues" }), 1);

    const { sql: sqlText } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"name" ilike');
  });

  it("Fix 2: the aggregate query now joins ledgerCategories too (the WHERE it shares with the row query references the category-name column, which only exists via a join)", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ q: "Dues" }), 1);

    // froms[0]/joins from the row query, froms[1] onward from the aggregate.
    const categoryJoins = mockDbState.joins.filter((j) => j.table === ledgerCategories);
    // One leftJoin from the row query, one from the aggregate query.
    expect(categoryJoins.length).toBe(2);
    expect(categoryJoins.every((j) => j.type === "left")).toBe(true);
  });

  it("searchBudgetLines's free-text WHERE (cause-line branch) ORs across cause, label, note, category name, AND the parent budget's note", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ q: "WARM" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText.match(/ilike/gi)?.length).toBe(5);
    expect(params).toEqual(["%WARM%", "%WARM%", "%WARM%", "%WARM%", "%WARM%"]);
  });
});

// ---------------------------------------------------------------------------
// Fix 1 (Phase 4 loop-back, 2026-08-07, docs/work-log/2026-08-06-ledger-search.md
// "Phase 4 — Loop-back") — lump-sum ledgerBudgets rows are now searchable.
// SUPERSEDES the old "Phase 3 test 8" block (lump-sum exclusion), which
// asserted the OPPOSITE of what's now correct behavior.
// ---------------------------------------------------------------------------

describe("searchBudgetLines — lump-sum rows are now searchable, without double-counting a budget that has children (Fix 1, supersedes DECISION-063 #4)", () => {
  const dialect = new PgDialect();

  it("a lump-sum ledgerBudgets row (own note/category name matches, zero children) is returned as isLumpSum:true with null cause/label", async () => {
    const lumpSumRow = makeLumpSumDbRow({ note: "Annual Rudolph Run 5K expenses" });
    mockDbState.queue.push([], [lumpSumRow]);

    const result = await searchBudgetLines(baseFilters({ q: "Rudolph" }), 1);

    expect(result.totalCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].isLumpSum).toBe(true);
    expect(result.rows[0].cause).toBeNull();
    expect(result.rows[0].label).toBeNull();
    expect(result.rows[0].categoryName).toBe("Rudolph Run");
    expect(result.rows[0].amountCents).toBe(1_000_000);
  });

  it("the lump-sum query is rooted at ledgerBudgets with a LEFT JOIN to ledgerBudgetLines and filtered to isNull(ledger_budget_lines.id) — the anti-join that makes 'has no children' structural, not a UI guess", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ q: "Rudolph" }), 1);

    // Promise.all's second element = the lump-sum query.
    expect(mockDbState.froms[1]).toBe(ledgerBudgets);
    const budgetLinesJoin = mockDbState.joins.find(
      (j) => j.table === ledgerBudgetLines && j.type === "left",
    );
    expect(budgetLinesJoin).toBeDefined();

    const { sql: sqlText } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(sqlText.toLowerCase()).toContain("is null");
  });

  it("a budget row WITH children (returned by the cause-line query) is never ALSO emitted as a lump-sum row in the merged result — no double-counting", async () => {
    const causeLine = makeBudgetLineRow({
      id: "line-1",
      budgetId: "budget-with-children",
      cause: "Youth & Education",
      label: "",
    });
    // The real anti-join guarantees a budget with children never appears in
    // the lump-sum query's OWN result set — simulated here by returning it
    // from the cause-line query only.
    mockDbState.queue.push([causeLine], []);

    const result = await searchBudgetLines(baseFilters(), 1);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].isLumpSum).toBe(false);
    expect(result.rows[0].id).toBe("line-1");
    expect(result.totalCount).toBe(1);
  });

  it("subtotals include lump-sum amounts alongside cause-line amounts, split by flow", async () => {
    const causeLine = makeBudgetLineRow({ id: "line-1", amountCents: 5_000, flow: "expense" });
    const lumpSum = makeLumpSumDbRow({ id: "budget-2", budgetId: "budget-2", amountCents: 10_000, flow: "expense" });
    mockDbState.queue.push([causeLine], [lumpSum]);

    const result = await searchBudgetLines(baseFilters(), 1);

    expect(result.totalCount).toBe(2);
    expect(result.totalExpenseCents).toBe(15_000);
    expect(result.totalIncomeCents).toBe(0);
  });

  it("a cause filter forces the lump-sum branch's WHERE to a literal false condition, not an unsatisfiable column reference — a lump sum has no cause to match", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ cause: "Youth & Education" }), 1);

    const { sql: sqlText } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(sqlText.toLowerCase()).toContain("false");
  });

  it("with a cause filter set, a lump-sum row can never appear in the merged results even if one is (incorrectly) returned by the mock — the false condition is real production behavior, this proves the row-mapping/merge path also can't accidentally surface it", async () => {
    // Even if the DB somehow returned a row here (it structurally can't,
    // per the test above), a real query never would — this test guards the
    // application-layer merge/mapping code, not the SQL predicate.
    mockDbState.queue.push([], []);
    const result = await searchBudgetLines(baseFilters({ cause: "Youth & Education" }), 1);

    expect(result.rows).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("the lump-sum branch's free-text OR-group is restricted to category name and the budget's own note (2 fields) — cause/label don't exist on a lump sum", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ q: "Rudolph" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(sqlText.match(/ilike/gi)?.length).toBe(2);
    expect(params.filter((p) => p === "%Rudolph%")).toHaveLength(2);
  });

  it("ILIKE escaping still holds on the lump-sum branch — a term containing % and _ stays literal", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ q: "50%_off" }), 1);

    const { params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(params).toContain("%50\\%\\_off%");
  });
});

// ---------------------------------------------------------------------------
// QA gap-fill (2026-08-06 Phase 5 verification) — every remaining scalar
// structured filter (entity, fund, category, cause, bank account, date
// range, status on the transaction side; entity, fund, category, cause on
// the budget-line side; amountMax-only) is a one-line `if (filter.x) push`
// branch in buildTransactionConditions()/buildBudgetLineConditions() that
// none of the Phase 3-named tests happen to exercise directly (they're each
// satisfied incidentally by other tests' filter combinations, but never
// individually asserted against the correct column/operator). Coverage
// review during Phase 5 verification found these branches at 0% — a typo
// swapping which column a filter binds to (e.g. dateFrom writing to
// txnDate <= instead of >=, or fundId filtering ledgerTransactions.entityId)
// would ship silently. Closing that gap here, one assertion per filter.
// ---------------------------------------------------------------------------

describe("individual structured filters wire the correct column + operator (QA gap-fill)", () => {
  const dialect = new PgDialect();

  it("entityId filters searchTransactions on ledgerTransactions.entity_id", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ entityId: "entity-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"entity_id" =');
    expect(params).toEqual(["entity-9"]);
  });

  it("fundId filters searchTransactions on ledgerTransactions.fund_id", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ fundId: "fund-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"fund_id" =');
    expect(params).toEqual(["fund-9"]);
  });

  it("categoryId filters searchTransactions on ledgerTransactions.category_id", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ categoryId: "cat-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"category_id" =');
    expect(params).toEqual(["cat-9"]);
  });

  it("cause filters searchTransactions on ledgerTransactions.beneficiary_cause (exact match, not ILIKE)", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ cause: "Vision & Eye Care" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"beneficiary_cause" =');
    expect(sqlText).not.toContain("ilike");
    expect(params).toEqual(["Vision & Eye Care"]);
  });

  it("bankAccountId filters searchTransactions on ledgerTransactions.bank_account_id", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ bankAccountId: "bank-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"bank_account_id" =');
    expect(params).toEqual(["bank-9"]);
  });

  it("dateFrom is a >= lower bound on txn_date, dateTo is a <= upper bound — not swapped", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ dateFrom: "2026-01-01", dateTo: "2026-03-31" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"txn_date" >=');
    expect(sqlText).toContain('"txn_date" <=');
    expect(params).toEqual(["2026-01-01", "2026-03-31"]);
  });

  it("status filters searchTransactions on ledgerTransactions.status", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ status: "pending" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"status" =');
    expect(params).toEqual(["pending"]);
  });

  it("amountMaxCents alone (no min) produces a <= condition, not exact match or >=", async () => {
    mockDbState.queue.push([], EMPTY_AGG);
    await searchTransactions(baseFilters({ amountMaxCents: 25_000 }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain("<=");
    expect(sqlText).not.toContain(">=");
    expect(params).toEqual([25_000]);
  });

  it("fundId filters searchBudgetLines's cause-line branch on ledgerBudgets.fund_id (the joined parent, not ledgerBudgetLines)", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ fundId: "fund-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"fund_id" =');
    expect(params).toEqual(["fund-9"]);
  });

  it("categoryId filters searchBudgetLines's cause-line branch on ledgerBudgets.category_id (the joined parent)", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ categoryId: "cat-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"category_id" =');
    expect(params).toEqual(["cat-9"]);
  });

  it("cause filters searchBudgetLines's cause-line branch on ledgerBudgetLines.cause (exact match, not ILIKE)", async () => {
    // The lump-sum branch is always issued too (Fix 1) — it just resolves to
    // a literal-false WHERE, so it still needs a queued value.
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ cause: "Hunger & Basic Needs" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[0] as never);
    expect(sqlText).toContain('"cause" =');
    expect(sqlText).not.toContain("ilike");
    expect(params).toEqual(["Hunger & Basic Needs"]);
  });

  it("fundId/categoryId filter the lump-sum branch on ledgerBudgets.fund_id/category_id too (Fix 1) — same columns, no join needed since ledgerBudgets is the lump-sum branch's root", async () => {
    mockDbState.queue.push([], []);
    await searchBudgetLines(baseFilters({ fundId: "fund-9", categoryId: "cat-9" }), 1);

    const { sql: sqlText, params } = dialect.sqlToQuery(mockDbState.wheres[1] as never);
    expect(sqlText).toContain('"fund_id" =');
    expect(sqlText).toContain('"category_id" =');
    expect(params).toEqual(["fund-9", "cat-9"]);
  });
});

// ---------------------------------------------------------------------------
// QA gap-fill (2026-08-07 Phase 5 re-verify, Phase 4 loop-back) — every test
// touching searchBudgetLines()'s merged-set totalIncomeCents/totalExpenseCents
// reduce (Fix 1's JS-side subtotal computation, replacing the old DB-side
// aggregate for this query) used exclusively flow: "expense" rows
// (makeBudgetLineRow/makeLumpSumDbRow's own defaults) — the `r.flow ===
// "income" ? r.amountCents : 0` branch in the totalIncomeCents reduce, and the
// mirror-image `: 0` branch in totalExpenseCents when a row IS income, were
// never exercised at all (coverage: 0/2 on both ternaries prior to this).
// This is a real gap, not a cosmetic one: the club's own real data has
// exactly this shape today (Foundation FY2025 "Rudolph Run" lump sums are 3
// income rows + 1 expense row under one search term — confirmed live during
// this re-verify), and it's precisely the treasurer's "budgeted AND spent"
// framing that depends on the income/expense split never crossing wires.
// Manually confirmed correct against the live dev DB before writing this
// (q=Rudolph&fy=2025 rendered "Income: +$27000.00 · Expenses: -$10000.00",
// matching a hand-summed 15,490+11,468+42 income / 10,000 expense) — this
// test makes that guarantee permanent rather than leaving the income branch
// perpetually unexercised by the suite.
// ---------------------------------------------------------------------------

describe("searchBudgetLines — income-flow rows are split into totalIncomeCents, not folded into totalExpenseCents (QA gap-fill, Fix 1 re-verify)", () => {
  it("an income-flow cause line and an income-flow lump sum both land in totalIncomeCents; an expense-flow row of each lands in totalExpenseCents — never crossed", async () => {
    const incomeCauseLine = makeBudgetLineRow({
      id: "line-income",
      amountCents: 7_000,
      flow: "income",
    });
    const expenseCauseLine = makeBudgetLineRow({
      id: "line-expense",
      amountCents: 3_000,
      flow: "expense",
    });
    const incomeLumpSum = makeLumpSumDbRow({
      id: "budget-income",
      budgetId: "budget-income",
      amountCents: 11_000,
      flow: "income",
    });
    const expenseLumpSum = makeLumpSumDbRow({
      id: "budget-expense",
      budgetId: "budget-expense",
      amountCents: 5_000,
      flow: "expense",
    });
    mockDbState.queue.push(
      [incomeCauseLine, expenseCauseLine],
      [incomeLumpSum, expenseLumpSum],
    );

    const result = await searchBudgetLines(baseFilters(), 1);

    expect(result.totalCount).toBe(4);
    // 7,000 (income cause line) + 11,000 (income lump sum) = 18,000 — never
    // 7,000 + 3,000 (which would mean flow was ignored) or 18,000 + 5,000
    // (which would mean expense rows leaked into the income total).
    expect(result.totalIncomeCents).toBe(18_000);
    // 3,000 (expense cause line) + 5,000 (expense lump sum) = 8,000.
    expect(result.totalExpenseCents).toBe(8_000);
    // Every row keeps its own flow — an income row is never relabeled
    // expense (or vice versa) by the merge.
    const byId = Object.fromEntries(result.rows.map((r) => [r.id, r.flow]));
    expect(byId["line-income"]).toBe("income");
    expect(byId["line-expense"]).toBe("expense");
    expect(byId["budget-income"]).toBe("income");
    expect(byId["budget-expense"]).toBe("expense");
  });
});

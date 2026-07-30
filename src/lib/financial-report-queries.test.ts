/**
 * Unit tests for src/lib/financial-report-queries.ts — Monthly Statement of
 * Financial Condition (docs/work-log/2026-07-28-monthly-financial-report.md).
 *
 * Covers Phase 3 design's "Unit Tests to Write in Phase 4" items 2-8 (item 1,
 * getFundReport()'s asOfDate bounding, lives in ledger-queries.test.ts
 * alongside its existing coverage).
 *
 * Hermetic: mocks @/lib/db so `pnpm test` passes without DATABASE_URL/DB_URL
 * set (no real DB connection at import time) — same convention as
 * src/lib/ledger-queries.test.ts / src/lib/members.test.ts.
 *
 * getMonthlyStatement() composes the REAL getFundReport() (DECISION-049 —
 * one source of truth for FYTD/budget/book-balance figures, never
 * re-derived), so the "ready" scenarios below feed the shared db mock enough
 * canned rows to satisfy getFundReport()'s own query sequence twice (current
 * report month + prior month, for the beginning book balance) as well as
 * this module's own three new queries (reconciliation gate, one-month
 * cash-cleared actuals, uncashed-check flags) — see queueFundReport()below
 * for the exact call-order contract this relies on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: { queue: [] as unknown[][] },
}));

// financial-report-queries.ts (and, transitively via getMonthlyStatement(),
// ledger-queries.ts's getFundReport()) both call the module-level `db`
// directly — no injected `tx` parameter to override, unlike the
// cause-budget-line write paths in ledger-queries.test.ts. This mock answers
// every db.select() chain from one shared FIFO queue, in call order.
vi.mock("@/lib/db", () => {
  function chain(): unknown {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
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
  monthBounds,
  isMonthGatedForEntity,
  computeOneMonthCashActuals,
  getMonthlyStatement,
  getLatestOpenMonthForEntity,
  MEMBER_EXPOSED_FUND_KINDS,
  type MonthlyStatementCategoryLine,
} from "./financial-report-queries";
import { getFiscalYear } from "./fiscal-year";
import type { LedgerFund } from "./db/schema";

beforeEach(() => {
  mockDbState.queue = [];
});

/** Local copy of the same 'YYYY-MM-DD' -> local-Date parse used inside
 *  financial-report-queries.ts (getPhilanthropy()'s own established
 *  convention in ledger-queries.ts) — kept private there, so tests that only
 *  need the FY-boundary composition (getFiscalYear + this) don't need it
 *  exported solely for testing. */
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function makeFund(overrides: Partial<LedgerFund> = {}): LedgerFund {
  return {
    id: "fund-1",
    entityId: "entity-1",
    slug: "administrative",
    name: "Administrative Fund",
    kind: "administrative",
    openingBalanceCents: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LedgerFund;
}

/**
 * Queues the 5 canned select() results getFundReport() consumes in order
 * (fund lookup, txns, categories, budgets, pre-FY rollforward). No scenario
 * below uses cause-tagged budget lines or an actual-only "orphaned" category,
 * so both of getFundReport()'s conditional queries stay skipped — this
 * helper's 5-item shape is the complete call sequence for every case here.
 */
function queueFundReport(opts: {
  fund: unknown;
  txns?: unknown[];
  categories?: unknown[];
  budgets?: unknown[];
  preFyRows?: unknown[];
}) {
  mockDbState.queue.push(
    [opts.fund],
    opts.txns ?? [],
    opts.categories ?? [],
    opts.budgets ?? [],
    opts.preFyRows ?? [],
  );
}

// ---------------------------------------------------------------------------
// monthBounds — pure helper (Phase 3 test 8)
// ---------------------------------------------------------------------------

describe("monthBounds", () => {
  it("returns start/end/next-start for a mid-year month", () => {
    expect(monthBounds("2026-06")).toEqual({
      monthStart: "2026-06-01",
      monthEnd: "2026-06-30",
      nextMonthStartExclusive: "2026-07-01",
    });
  });

  it("rolls December over into January of the next year", () => {
    expect(monthBounds("2026-12")).toEqual({
      monthStart: "2026-12-01",
      monthEnd: "2026-12-31",
      nextMonthStartExclusive: "2027-01-01",
    });
  });

  it("handles February correctly in a leap year vs. a non-leap year", () => {
    expect(monthBounds("2024-02").monthEnd).toBe("2024-02-29"); // leap
    expect(monthBounds("2026-02").monthEnd).toBe("2026-02-28"); // non-leap
  });

  it("rejects an out-of-range month number instead of returning NaN-poisoned strings — regression for the /financial-reports/club/2026-13 500 (MONTH_PATTERN's /^\\d{4}-\\d{2}$/ accepts '13' as a shape match, and without this guard monthBounds() silently produces 'undefined'/'NaN' pieces that reach a raw SQL date parameter and crash with an uncaught Postgres error instead of a clean 404)", () => {
    expect(() => monthBounds("2026-13")).toThrow();
    expect(() => monthBounds("2026-00")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fiscal-year boundary month framing (Phase 3 test 7) — pure composition,
// no DB: the exact getFiscalYear(parseYMD(monthEnd)) getMonthlyStatement()
// uses internally to pick reportFY.
// ---------------------------------------------------------------------------

describe("fiscal-year boundary month framing", () => {
  it("a June report month uses the FY that's about to close (full 12-month FYTD)", () => {
    const juneEnd = monthBounds("2026-06").monthEnd;
    expect(getFiscalYear(parseYMD(juneEnd))).toBe(2025); // FY2025 = Jul 2025 - Jun 2026
  });

  it("a July report month uses the newly-started FY (1-month FYTD)", () => {
    const julyEnd = monthBounds("2026-07").monthEnd;
    expect(getFiscalYear(parseYMD(julyEnd))).toBe(2026); // FY2026 = Jul 2026 - Jun 2027
  });
});

// ---------------------------------------------------------------------------
// isMonthGatedForEntity (Phase 3 test 3)
// ---------------------------------------------------------------------------

describe("isMonthGatedForEntity", () => {
  it("gates when an unreconciled posted transaction in a member-exposed fund is dated on/before month-end", async () => {
    mockDbState.queue.push([{ txnDate: "2026-06-15", fundKind: "administrative" }]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(true);
  });

  it("does NOT gate when the same transaction sits in an Activity fund (member-exposed funds only)", async () => {
    mockDbState.queue.push([{ txnDate: "2026-06-15", fundKind: "activity" }]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("does NOT gate when the same transaction sits in a Scholarship fund (member-exposed funds only)", async () => {
    mockDbState.queue.push([{ txnDate: "2026-06-15", fundKind: "scholarship" }]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("does NOT gate when the transaction is dated after month-end", async () => {
    mockDbState.queue.push([{ txnDate: "2026-07-01", fundKind: "administrative" }]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("does not gate on an empty unreconciled candidate set (fully reconciled)", async () => {
    mockDbState.queue.push([]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("gates the CURRENT calendar month even with zero unreconciled rows anywhere — regression for future/in-progress-month leak (a fund that is fully caught up on reconciliation has no unreconciled row to gate on, but a month that has not finished yet was never reconciled either)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));

    mockDbState.queue.push([]); // no unreconciled rows anywhere for this entity

    expect(await isMonthGatedForEntity("entity-1", "2026-07-31")).toBe(true);

    vi.useRealTimers();
  });

  it("gates a FUTURE month even with zero unreconciled rows anywhere — regression for future-month leak", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));

    mockDbState.queue.push([]); // no unreconciled rows anywhere for this entity

    expect(await isMonthGatedForEntity("entity-1", "2027-01-31")).toBe(true);

    vi.useRealTimers();
  });

  it("does NOT gate a fully-elapsed past month on the date check alone (zero unreconciled rows -> false)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));

    mockDbState.queue.push([]);

    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);

    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Outstanding-check carve-out (2026-07-28 bug fix —
  // docs/work-log/2026-07-28-report-gate-outstanding-checks.md). Prod repro:
  // Foundation/Charitable's picker stopped at Feb 2026 solely because of two
  // outstanding checks dated 2026-03-07, even though those months' books were
  // otherwise correct and the report already footnotes uncashed checks. The
  // outstanding-check carve-out itself (isOutstandingCheckRow, flow='expense')
  // is UNAFFECTED by DECISION-059 — only the check+INCOME exclusion it used
  // to guard (the test immediately below) is gone.
  // -------------------------------------------------------------------------

  it("does NOT gate on an unreconciled OUTSTANDING CHECK (payment_method='check', flow='expense') — the app's one uncashed-check definition, matching getDashboard()'s predicate exactly", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-03-07",
        fundKind: "charitable",
        paymentMethod: "check",
        flow: "expense",
      },
    ]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("does NOT gate on an unreconciled check+INCOME row anymore — full deposit-in-transit symmetry, DECISION-059, supersedes the 2026-07-28 check+income exclusion", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-06-24",
        fundKind: "administrative",
        paymentMethod: "check",
        flow: "income",
      },
    ]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("STILL gates on an unreconciled non-check expense (e.g. debit_card/bill_pay) dated on/before month-end", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-06-24",
        fundKind: "administrative",
        paymentMethod: "debit_card",
        flow: "expense",
      },
    ]);
    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Uncleared-deposit carve-out — full method/age symmetry (DECISION-059,
  // docs/work-log/2026-07-30-deposit-in-transit-carveout.md), replacing the
  // retired method-restricted, 12-day-windowed in-transit-Zeffy carve-out
  // (formerly DECISION-051). The carve-out is flow='income' only,
  // method-agnostic in both directions — no paymentMethod check, no age
  // check, mirroring isOutstandingCheckRow()'s own unbounded-age shape.
  // -------------------------------------------------------------------------

  it("does NOT gate on an unreconciled ZEFFY income row of ANY age — the time-bound window is retired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z")); // 51 days after the row's txnDate — was "stale" under the retired window

    mockDbState.queue.push([
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: "zeffy",
        flow: "income",
      },
    ]);

    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);

    vi.useRealTimers();
  });

  it("does NOT gate on an unreconciled CASH income row dated on/before month-end — full method-agnostic symmetry", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: "cash",
        flow: "income",
      },
    ]);

    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("does NOT gate regardless of paymentMethod value, including null/legacy rows — isUnclearedDepositRow ignores payment method entirely", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: null,
        flow: "income",
      },
    ]);

    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(false);
  });

  it("STILL gates on an unreconciled zeffy EXPENSE row (not income) — the uncleared-deposit carve-out is flow='income' only, method-agnostic in both directions", async () => {
    mockDbState.queue.push([
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: "zeffy",
        flow: "expense",
      },
    ]);

    expect(await isMonthGatedForEntity("entity-1", "2026-06-30")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLatestOpenMonthForEntity — uncleared-deposit carve-out (full symmetry)
// (Phase 3 test 9)
// ---------------------------------------------------------------------------

describe("getLatestOpenMonthForEntity — uncleared-deposit carve-out (full symmetry)", () => {
  it("does not truncate the candidate month solely due to a recent uncleared Zeffy deposit row — mirrors the outstanding-check regression fix, confirms the carve-out is applied in the blockingDates filter too, not just isMonthGatedForEntity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));

    const rows = [
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: "zeffy",
        flow: "income",
      },
    ];
    // getLatestOpenMonthForEntity's own candidate-computation select, then its
    // final isMonthGatedForEntity() re-check's select — same underlying
    // unreconciled row set answers both queries.
    mockDbState.queue.push(rows, rows);

    const result = await getLatestOpenMonthForEntity("entity-1");

    // Without the carve-out applied to blockingDates, this row would push the
    // candidate back to "2026-05" (the month before the row's own month) —
    // the exact truncation bug already fixed once for outstanding checks.
    expect(result).toBe("2026-06");

    vi.useRealTimers();
  });

  it("does NOT truncate the candidate even when the same-shaped income row is old — the time-bound window is retired, mirrors the outstanding-check carve-out having no age limit either", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));

    const rows = [
      {
        txnDate: "2026-06-25",
        fundKind: "administrative",
        paymentMethod: "zeffy",
        flow: "income",
      },
    ];
    mockDbState.queue.push(rows, rows);

    const result = await getLatestOpenMonthForEntity("entity-1");

    // Full symmetry: age no longer matters, so the row no longer appears in
    // blockingDates at all, and the candidate resolves all the way to the
    // calendar ceiling (asOf 2026-08-15 -> ceilingMonth "2026-07", the last
    // fully-elapsed month) instead of falling back to the month before the
    // row's own month ("2026-05", the old pre-DECISION-059 result).
    expect(result).toBe("2026-07");

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// computeOneMonthCashActuals (Phase 3 test 2)
// ---------------------------------------------------------------------------

describe("computeOneMonthCashActuals", () => {
  it("buckets by bank-line postingDate, falls back to reconciledAt for legacy (non-imported) rows, excludes Quicken-imported rows, and ignores adjacent months", async () => {
    mockDbState.queue.push([
      // Bank-line matched -> use postingDate (accurate).
      {
        categoryId: "cat-a",
        flow: "income",
        amountCents: 1_000,
        memo: null,
        reconciledAt: null,
        matchedPostingDate: "2026-06-15",
      },
      // Legacy per-row toggle: no match, no import marker -> reconciledAt fallback.
      {
        categoryId: "cat-b",
        flow: "expense",
        amountCents: 500,
        memo: "Reimbursed via check",
        reconciledAt: new Date(Date.UTC(2026, 5, 20, 12, 0, 0)), // 2026-06-20
        matchedPostingDate: null,
      },
      // Quicken-imported: no match, marker present -> excluded entirely, no
      // fallback to its (bulk-import-run) reconciledAt.
      {
        categoryId: "cat-c",
        flow: "expense",
        amountCents: 9_999,
        memo: "Historical import [quicken-import]",
        reconciledAt: new Date(Date.UTC(2026, 6, 20, 0, 0, 0)),
        matchedPostingDate: null,
      },
      // Matched, but clears in the FOLLOWING month -> excluded from June's bucket.
      {
        categoryId: "cat-a",
        flow: "income",
        amountCents: 777,
        memo: null,
        reconciledAt: null,
        matchedPostingDate: "2026-07-02",
      },
    ]);

    const result = await computeOneMonthCashActuals("fund-1", "2026-06-01", "2026-07-01");

    expect(result.byCategory.get("cat-a_income")).toBe(1_000);
    expect(result.byCategory.get("cat-b_expense")).toBe(500);
    expect(result.byCategory.has("cat-c_expense")).toBe(false);
    expect(result.usedLegacyReconciledAtFallback).toBe(true);
    expect(result.hasUndatedHistoricalRows).toBe(true);
  });

  it("recovers reconciledAt's wall-clock date via UTC getters near a month boundary (11:30 PM Jun 30) — not shifted by a local-timezone getter", async () => {
    mockDbState.queue.push([
      {
        categoryId: "cat-a",
        flow: "expense",
        amountCents: 250,
        memo: "Legacy toggle, late in the month",
        reconciledAt: new Date(Date.UTC(2026, 5, 30, 23, 30, 0)), // 2026-06-30 23:30
        matchedPostingDate: null,
      },
    ]);

    // June bucket: the row must land here, not slip into July.
    const june = await computeOneMonthCashActuals("fund-1", "2026-06-01", "2026-07-01");
    expect(june.byCategory.get("cat-a_expense")).toBe(250);
  });

  it("excludes a row with no matched bank line, no import marker, and no reconciledAt at all (no trustworthy date)", async () => {
    mockDbState.queue.push([
      {
        categoryId: "cat-a",
        flow: "expense",
        amountCents: 100,
        memo: "Odd historical row",
        reconciledAt: null,
        matchedPostingDate: null,
      },
    ]);

    const result = await computeOneMonthCashActuals("fund-1", "2026-06-01", "2026-07-01");
    expect(result.byCategory.size).toBe(0);
    expect(result.hasUndatedHistoricalRows).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getMonthlyStatement — fund allowlist (Phase 3 test 6)
// ---------------------------------------------------------------------------

describe("getMonthlyStatement — fund allowlist", () => {
  it("returns null for an Activity fund — not member-exposed, never { status: 'gated' }", async () => {
    const fund = makeFund({ kind: "activity" });
    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result).toBeNull();
  });

  it("returns null for a Scholarship fund — not member-exposed, never { status: 'gated' }", async () => {
    const fund = makeFund({ kind: "scholarship" });
    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result).toBeNull();
  });

  it("MEMBER_EXPOSED_FUND_KINDS is exactly administrative + charitable", () => {
    expect(MEMBER_EXPOSED_FUND_KINDS).toEqual(["administrative", "charitable"]);
  });
});

// ---------------------------------------------------------------------------
// getMonthlyStatement — discriminated-union states (Phase 3 test 4)
// ---------------------------------------------------------------------------

describe("getMonthlyStatement — discriminated-union states", () => {
  it("returns { status: 'gated' } when an unreconciled posted transaction blocks the month", async () => {
    const fund = makeFund();
    mockDbState.queue.push([{ txnDate: "2026-06-15", fundKind: "administrative" }]); // gate query only
    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result).toEqual({ status: "gated" });
  });

  it("returns { status: 'ready' } with an all-zero statement for a reconciled, zero-activity month — never collapsed into 'gated'", async () => {
    const fund = makeFund();
    mockDbState.queue.push([]); // gate: nothing unreconciled
    queueFundReport({ fund }); // current-month FundReport — all empty
    queueFundReport({ fund }); // prior-month FundReport — all empty
    mockDbState.queue.push([]); // one-month rows
    mockDbState.queue.push([]); // uncashed-check rows

    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("expected ready");
    expect(result.statement.income).toEqual([]);
    expect(result.statement.expense).toEqual([]);
    expect(result.statement.net).toEqual({ oneMonthCents: 0, twelveMonthCents: 0, budgetCents: 0 });
    expect(result.statement.hasUndatedHistoricalRows).toBe(false);
  });

  it("returns { status: 'ready' } with real category lines for a month with activity", async () => {
    const fund = makeFund();
    mockDbState.queue.push([]); // gate clear
    queueFundReport({
      fund,
      txns: [
        {
          id: "t1",
          categoryId: "cat-1",
          flow: "income",
          amountCents: 5_000,
          status: "posted",
          txnDate: "2026-06-10",
        },
      ],
      categories: [{ id: "cat-1", name: "Dues", flow: "income", countsAsGiving: true }],
    }); // current month
    queueFundReport({ fund }); // prior month — empty
    mockDbState.queue.push([
      {
        categoryId: "cat-1",
        flow: "income",
        amountCents: 5_000,
        memo: null,
        reconciledAt: null,
        matchedPostingDate: "2026-06-10",
      },
    ]); // one-month rows
    mockDbState.queue.push([]); // uncashed-check rows

    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("expected ready");
    expect(result.statement.income).toHaveLength(1);
    expect(result.statement.income[0].oneMonthCents).toBe(5_000);
    expect(result.statement.income[0].twelveMonthCents).toBe(5_000);
    expect(result.statement.totalRevenue.oneMonthCents).toBe(5_000);
    expect(result.statement.monthEndLabel).toBe("June 30, 2026");
  });
});

// ---------------------------------------------------------------------------
// getMonthlyStatement — exposure projection (Phase 3 test 5)
// ---------------------------------------------------------------------------

describe("getMonthlyStatement — exposure projection", () => {
  it("never exposes party/memo/checkNumber/donorId/publicNote/transaction id on returned category lines, even when the underlying rows carry them", async () => {
    const fund = makeFund();
    mockDbState.queue.push([]); // gate clear
    queueFundReport({
      fund,
      txns: [
        {
          id: "txn-secret-id",
          categoryId: "cat-1",
          flow: "expense",
          amountCents: 1_200,
          status: "posted",
          txnDate: "2026-06-10",
          party: "Jane Donor",
          memo: "Confidential memo",
          checkNumber: "1042",
          donorId: "donor-1",
        },
      ],
      categories: [
        {
          id: "cat-1",
          name: "Program Supplies",
          flow: "expense",
          countsAsGiving: true,
          // Decoy PII-shaped fields on the category row itself — a stray
          // spread anywhere in the pipeline would leak these too.
          party: "should never appear",
          memo: "should never appear",
        },
      ],
    });
    queueFundReport({ fund }); // prior month — empty
    mockDbState.queue.push([
      {
        categoryId: "cat-1",
        flow: "expense",
        amountCents: 1_200,
        memo: "Confidential memo",
        reconciledAt: null,
        matchedPostingDate: "2026-06-10",
        // Decoy fields a careless projection might accidentally carry through.
        party: "Jane Donor",
        checkNumber: "1042",
        id: "txn-secret-id",
        donorId: "donor-1",
        publicNote: "should never appear",
      },
    ]);
    mockDbState.queue.push([]); // uncashed-check rows

    const result = await getMonthlyStatement(fund, "2026-06");
    expect(result?.status).toBe("ready");
    if (result?.status !== "ready") throw new Error("expected ready");

    const allLines: MonthlyStatementCategoryLine[] = [
      ...result.statement.income,
      ...result.statement.expense,
    ];
    expect(allLines.length).toBeGreaterThan(0);

    const expectedKeys = [
      "annualBudgetCents",
      "categoryId",
      "categoryName",
      "causeLines",
      "hasUncashedCheck",
      "oneMonthCents",
      "twelveMonthCents",
    ].sort();

    for (const line of allLines) {
      expect(Object.keys(line).sort()).toEqual(expectedKeys);
      expect(line).not.toHaveProperty("party");
      expect(line).not.toHaveProperty("memo");
      expect(line).not.toHaveProperty("checkNumber");
      expect(line).not.toHaveProperty("id");
      expect(line).not.toHaveProperty("donorId");
      expect(line).not.toHaveProperty("publicNote");
      // No budget row exists for cat-1 in this test's fixture, so
      // causeLines must be null (no breakdown) — never an object/array
      // that could carry a leaked field.
      expect(line.causeLines).toBeNull();
    }
  });
});

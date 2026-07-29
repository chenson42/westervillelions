/**
 * Unit tests for src/lib/ledger.ts
 *
 * All tests are pure (no DB). Each helper is covered with:
 *   - happy-path cases
 *   - edge / boundary cases
 *   - cases required by the Phase 3 spec (transfer pair nets to zero,
 *     null budget, each guardrail fires and clears)
 */

import { describe, it, expect } from "vitest";
import {
  fundBalanceCents,
  rolledForwardOpeningCents,
  entityBalanceCents,
  grossReceiptsCents,
  budgetVariance,
  guardrails,
  countAgedPublicFunds,
  agedPublicFundNames,
  daysSinceTxnDate,
  computeDueDate,
  isFilingOverdue,
  deriveAckType,
  isReceiptMissing,
  computeBudgetBalanceStatus,
  deriveSeedLinesForFund,
  validateBudgetLineInput,
  decideSeedWriteAction,
  isBudgetLocked,
  validateCategoryCreateInput,
  nextCategorySortOrder,
  validateRequiredTrimmedText,
  bucketGivingByCause,
  BUDGET_CAUSES,
  OTHER_COMMUNITY_SUPPORT_CAUSE,
  isValidBudgetCause,
  isCauseEligibleCategory,
  sumBudgetCauseLines,
  deriveCauseSeedLines,
  normalizeBudgetLineLabel,
  MAX_BUDGET_LINE_LABEL_LENGTH,
  formatBudgetReferenceCents,
  resolveBudgetLineDeleteAction,
  computeFundLineSums,
  isCauseLineLive,
  causeLineReferenceKey,
  buildCauseActualsByKey,
  computeDuesTimingAdjustment,
  type GuardrailsInput,
  type AgedPublicFundFact,
  type SeedSourceLine,
  type GivingFoldRow,
  type CauseSeedSourceRow,
  type CauseActualSourceRow,
  type DuesTimingSourceRow,
} from "./ledger";

// ---------------------------------------------------------------------------
// fundBalanceCents
// ---------------------------------------------------------------------------

describe("fundBalanceCents", () => {
  it("returns opening balance when there are no transactions", () => {
    expect(fundBalanceCents(100_000, [])).toBe(100_000);
  });

  it("adds income rows to the opening balance", () => {
    const rows = [
      { flow: "income", amountCents: 50_000 },
      { flow: "income", amountCents: 25_000 },
    ];
    expect(fundBalanceCents(10_000, rows)).toBe(85_000);
  });

  it("subtracts expense rows from the opening balance", () => {
    const rows = [
      { flow: "expense", amountCents: 30_000 },
      { flow: "expense", amountCents: 15_000 },
    ];
    expect(fundBalanceCents(100_000, rows)).toBe(55_000);
  });

  it("handles mixed income and expense rows", () => {
    const rows = [
      { flow: "income", amountCents: 60_000 },
      { flow: "expense", amountCents: 40_000 },
      { flow: "income", amountCents: 10_000 },
      { flow: "expense", amountCents: 5_000 },
    ];
    expect(fundBalanceCents(0, rows)).toBe(25_000);
  });

  it("can produce a negative balance (triggers the guardrail check)", () => {
    const rows = [{ flow: "expense", amountCents: 200_000 }];
    expect(fundBalanceCents(100_000, rows)).toBe(-100_000);
  });

  it("treats an unknown flow value as neutral (no balance change)", () => {
    // DECISION-017: 'transfer' must never appear as a literal flow value.
    // If it does, balance must not be corrupted.
    const rows = [{ flow: "transfer", amountCents: 50_000 }];
    expect(fundBalanceCents(75_000, rows)).toBe(75_000);
  });

  it("correctly accounts for the credit row of a transfer (flow='income')", () => {
    // Transfer credit row: fundId=destFund, flow='income' (DECISION-016)
    const destFundRows = [{ flow: "income", amountCents: 10_000 }];
    expect(fundBalanceCents(50_000, destFundRows)).toBe(60_000);
  });

  it("correctly accounts for the debit row of a transfer (flow='expense')", () => {
    // Transfer debit row: fundId=sourceFund, flow='expense' (DECISION-016)
    const sourceFundRows = [{ flow: "expense", amountCents: 10_000 }];
    expect(fundBalanceCents(50_000, sourceFundRows)).toBe(40_000);
  });

  it("transfer pair nets to zero across the two affected funds", () => {
    // Source fund: expense 10,000; opening 50,000 → ending 40,000
    // Dest fund:   income  10,000; opening 30,000 → ending 40,000
    // Combined entity net change = 0 (no money in/out of the entity)
    const sourceFundBalance = fundBalanceCents(50_000, [
      { flow: "expense", amountCents: 10_000 },
    ]);
    const destFundBalance = fundBalanceCents(30_000, [
      { flow: "income", amountCents: 10_000 },
    ]);
    // Entity total before transfer: 50,000 + 30,000 = 80,000
    // Entity total after transfer:  40,000 + 40,000 = 80,000  → net = 0
    expect(sourceFundBalance + destFundBalance).toBe(80_000);
    expect(sourceFundBalance).toBe(40_000);
    expect(destFundBalance).toBe(40_000);
  });

  it("transfer pair net change is zero relative to entity totals", () => {
    const amount = 25_000;
    const sourceOpening = 100_000;
    const destOpening = 60_000;
    const entityBefore = sourceOpening + destOpening;

    const sourceAfter = fundBalanceCents(sourceOpening, [
      { flow: "expense", amountCents: amount },
    ]);
    const destAfter = fundBalanceCents(destOpening, [
      { flow: "income", amountCents: amount },
    ]);

    expect(sourceAfter + destAfter).toBe(entityBefore);
  });

  it("handles zero opening balance", () => {
    const rows = [
      { flow: "income", amountCents: 12_000 },
      { flow: "expense", amountCents: 5_000 },
    ];
    expect(fundBalanceCents(0, rows)).toBe(7_000);
  });
});

// ---------------------------------------------------------------------------
// rolledForwardOpeningCents — 2026-07-20 balance rollforward bug fix
// (display-side counterpart to DECISION-028; see DECISION-029)
// ---------------------------------------------------------------------------

describe("rolledForwardOpeningCents", () => {
  it("first FY (no pre-FY txns): opening = seed (regression — current behavior preserved)", () => {
    expect(rolledForwardOpeningCents(2_856_930, [])).toBe(2_856_930);
  });

  it("later FY: opening = seed + prior income − prior expense (real repro numbers: seed 2856930, prior net −2373273 → opening 483657)", () => {
    // Prior-FY net of −2,373,273 expressed as separate posted income/expense
    // totals, exactly as the pre-FY rollforward query in getOverview()
    // returns them (grouped by flow).
    const preFyTxns = [
      { flow: "income", amountCents: 1_000_000, status: "posted" },
      { flow: "expense", amountCents: 3_373_273, status: "posted" },
    ];
    expect(rolledForwardOpeningCents(2_856_930, preFyTxns)).toBe(483_657);
  });

  it("pre-FY pending/rejected txns excluded from rollforward", () => {
    const preFyTxns = [
      { flow: "income", amountCents: 50_000, status: "posted" },
      // These would corrupt the rollforward if not excluded — pending and
      // rejected rows are not real, settled money.
      { flow: "income", amountCents: 999_999, status: "pending" },
      { flow: "expense", amountCents: 999_999, status: "rejected" },
    ];
    expect(rolledForwardOpeningCents(10_000, preFyTxns)).toBe(60_000);
  });

  it("fund with zero seed and prior activity (club Activity: 0 + 8452 → 8452)", () => {
    const preFyTxns = [{ flow: "income", amountCents: 8_452, status: "posted" }];
    expect(rolledForwardOpeningCents(0, preFyTxns)).toBe(8_452);
  });

  it("nets multiple posted pre-FY rows across flows, same as fundBalanceCents", () => {
    const preFyTxns = [
      { flow: "income", amountCents: 60_000, status: "posted" },
      { flow: "expense", amountCents: 40_000, status: "posted" },
      { flow: "income", amountCents: 10_000, status: "posted" },
      { flow: "expense", amountCents: 5_000, status: "posted" },
    ];
    expect(rolledForwardOpeningCents(0, preFyTxns)).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// entityBalanceCents
// ---------------------------------------------------------------------------

describe("entityBalanceCents", () => {
  it("returns zero for an entity with no funds", () => {
    expect(entityBalanceCents([])).toBe(0);
  });

  it("sums all fund balances (opening + txns)", () => {
    const funds = [
      { openingCents: 50_000, postedTxns: [{ flow: "income", amountCents: 10_000 }] },
      { openingCents: 20_000, postedTxns: [{ flow: "expense", amountCents: 5_000 }] },
    ];
    // Fund 1: 50,000 + 10,000 = 60,000
    // Fund 2: 20,000 − 5,000  = 15,000
    // Total: 75,000
    expect(entityBalanceCents(funds)).toBe(75_000);
  });

  it("handles funds with no transactions", () => {
    const funds = [
      { openingCents: 30_000, postedTxns: [] },
      { openingCents: 20_000, postedTxns: [] },
    ];
    expect(entityBalanceCents(funds)).toBe(50_000);
  });

  it("correctly sums when one fund has a negative balance", () => {
    const funds = [
      { openingCents: 10_000, postedTxns: [{ flow: "expense", amountCents: 20_000 }] },
      { openingCents: 50_000, postedTxns: [] },
    ];
    // Fund 1: 10,000 − 20,000 = −10,000
    // Fund 2: 50,000
    // Total: 40,000
    expect(entityBalanceCents(funds)).toBe(40_000);
  });
});

// ---------------------------------------------------------------------------
// countAgedPublicFunds — inc7 (revised 2026-07-20, Bug 2 fix / DECISION-028)
//
// Pure-function seam for the aged-public-fund gate. Fixed at DECISION-028:
// the gate must use each fund's TRUE cross-FY life-to-date balance, never an
// FY-scoped figure like fundSummaries[].endingCents (that was QA's Bug 2 —
// see 2026-07-20 Phase 5 report and the regression test below).
// ---------------------------------------------------------------------------

describe("countAgedPublicFunds", () => {
  const NOW = new Date("2026-07-20T00:00:00Z");

  function daysBefore(now: Date, days: number): string {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  it("returns 0 for an empty funds array", () => {
    expect(countAgedPublicFunds([], 365, NOW)).toBe(0);
  });

  it("excludes a public fund with no oldestPostedIncomeDate (null) even when crossFyBalanceCents is positive", () => {
    const funds: AgedPublicFundFact[] = [
      { fundKind: "activity", crossFyBalanceCents: 50_000, oldestPostedIncomeDate: null },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(0);
  });

  it("excludes a public fund whose oldestPostedIncomeDate is younger than thresholdDays", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "charitable",
        crossFyBalanceCents: 50_000,
        oldestPostedIncomeDate: daysBefore(NOW, 10),
      },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(0);
  });

  it("excludes a public fund whose crossFyBalanceCents is <= 0 even though its oldestPostedIncomeDate is old", () => {
    // Legitimate spent-down-fund case (G-3's original intent), now correctly
    // gated on the cross-FY figure instead of the FY-scoped one.
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "activity",
        crossFyBalanceCents: 0,
        oldestPostedIncomeDate: daysBefore(NOW, 800),
      },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(0);
  });

  it("counts a public fund whose crossFyBalanceCents is positive AND oldestPostedIncomeDate is older than thresholdDays", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "scholarship",
        crossFyBalanceCents: 10_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
      },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(1);
  });

  it("excludes an administrative-kind fund even when balance/date conditions are met", () => {
    // The kind filter is load-bearing — administrative funds hold member dues,
    // not public money, and must never contribute to this count.
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "administrative",
        crossFyBalanceCents: 50_000,
        oldestPostedIncomeDate: daysBefore(NOW, 800),
      },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(0);
  });

  it("counts a fund as aged using its cross-FY balance even when that balance would read $0 under an FY-scoped view (regression: QA Bug 2, 2026-07-20)", () => {
    // Reproduces QA's exact live repro: Foundation entity, Charitable Fund,
    // $500 (50,000 cents) posted income dated 49+ days before "now", a
    // 30-day threshold, and a fund whose FY-scoped fundSummaries[].endingCents
    // would have read $0 because all its transactions fall in a prior fiscal
    // year outside the currently-selected FY window. countAgedPublicFunds()
    // has no way to receive or be fooled by that FY-scoped figure — its input
    // contract only accepts a cross-FY fact (crossFyBalanceCents), which here
    // correctly reflects the fund's real $500 life-to-date balance.
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "charitable",
        crossFyBalanceCents: 50_000, // $500.00 — the fund's TRUE cross-FY balance
        oldestPostedIncomeDate: daysBefore(NOW, 49), // 49+ days aged
      },
    ];
    expect(countAgedPublicFunds(funds, 30, NOW)).toBe(1);
  });

  it("counts multiple qualifying funds and returns their total as an integer", () => {
    const funds: AgedPublicFundFact[] = [
      // Qualifies: activity, positive balance, aged past threshold.
      {
        fundKind: "activity",
        crossFyBalanceCents: 20_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
      },
      // Qualifies: charitable, positive balance, aged past threshold.
      {
        fundKind: "charitable",
        crossFyBalanceCents: 5_000,
        oldestPostedIncomeDate: daysBefore(NOW, 500),
      },
      // Excluded: wrong kind (administrative).
      {
        fundKind: "administrative",
        crossFyBalanceCents: 100_000,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
      },
      // Excluded: balance not positive.
      {
        fundKind: "scholarship",
        crossFyBalanceCents: 0,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
      },
    ];
    expect(countAgedPublicFunds(funds, 365, NOW)).toBe(2);
  });

  it("boundary: ageDays exactly equal to thresholdDays does not fire; one day over does", () => {
    const exactlyAtThreshold: AgedPublicFundFact[] = [
      {
        fundKind: "activity",
        crossFyBalanceCents: 10_000,
        oldestPostedIncomeDate: daysBefore(NOW, 30),
      },
    ];
    expect(countAgedPublicFunds(exactlyAtThreshold, 30, NOW)).toBe(0);

    const oneDayOver: AgedPublicFundFact[] = [
      {
        fundKind: "activity",
        crossFyBalanceCents: 10_000,
        oldestPostedIncomeDate: daysBefore(NOW, 31),
      },
    ];
    expect(countAgedPublicFunds(oneDayOver, 30, NOW)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// agedPublicFundNames — Ledger Dashboard (Two-Entity Homepage, DECISION-032)
// ---------------------------------------------------------------------------

describe("agedPublicFundNames", () => {
  const NOW = new Date("2026-07-20T00:00:00Z");

  function daysBefore(now: Date, days: number): string {
    const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  it("returns [] for an empty funds array", () => {
    expect(agedPublicFundNames([], 365, NOW)).toEqual([]);
  });

  it("returns [] when no fund qualifies (mirrors countAgedPublicFunds exclusion cases)", () => {
    const funds: AgedPublicFundFact[] = [
      // Excluded: no oldestPostedIncomeDate.
      { fundKind: "activity", crossFyBalanceCents: 50_000, oldestPostedIncomeDate: null, fundName: "Activity Fund" },
      // Excluded: too young.
      { fundKind: "charitable", crossFyBalanceCents: 50_000, oldestPostedIncomeDate: daysBefore(NOW, 10), fundName: "Charitable Fund" },
      // Excluded: balance not positive.
      { fundKind: "scholarship", crossFyBalanceCents: 0, oldestPostedIncomeDate: daysBefore(NOW, 800), fundName: "Scholarship Fund" },
      // Excluded: wrong kind.
      { fundKind: "administrative", crossFyBalanceCents: 50_000, oldestPostedIncomeDate: daysBefore(NOW, 800), fundName: "Administrative Fund" },
    ];
    expect(agedPublicFundNames(funds, 365, NOW)).toEqual([]);
  });

  it("returns the qualifying fund's name when exactly one fund qualifies", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "charitable",
        crossFyBalanceCents: 50_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
        fundName: "Charitable Fund",
      },
    ];
    expect(agedPublicFundNames(funds, 365, NOW)).toEqual(["Charitable Fund"]);
  });

  it("returns names in the same order as the input array for multiple qualifying funds", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "scholarship",
        crossFyBalanceCents: 5_000,
        oldestPostedIncomeDate: daysBefore(NOW, 500),
        fundName: "Scholarship Fund",
      },
      {
        fundKind: "activity",
        crossFyBalanceCents: 20_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
        fundName: "Activity Fund",
      },
      {
        fundKind: "charitable",
        crossFyBalanceCents: 10_000,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
        fundName: "Charitable Fund",
      },
    ];
    expect(agedPublicFundNames(funds, 365, NOW)).toEqual([
      "Scholarship Fund",
      "Activity Fund",
      "Charitable Fund",
    ]);
  });

  it("falls back to 'Unnamed fund' when fundName is omitted", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "activity",
        crossFyBalanceCents: 10_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
        // fundName omitted
      },
    ];
    expect(agedPublicFundNames(funds, 365, NOW)).toEqual(["Unnamed fund"]);
  });

  it("excludes a fund's name when it fails the kind filter even if balance/date otherwise qualify", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "administrative",
        crossFyBalanceCents: 100_000,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
        fundName: "Administrative Fund",
      },
    ];
    expect(agedPublicFundNames(funds, 365, NOW)).toEqual([]);
  });

  it("count from countAgedPublicFunds and length from agedPublicFundNames never disagree, given the same input", () => {
    const funds: AgedPublicFundFact[] = [
      {
        fundKind: "activity",
        crossFyBalanceCents: 20_000,
        oldestPostedIncomeDate: daysBefore(NOW, 400),
        fundName: "Activity Fund",
      },
      {
        fundKind: "charitable",
        crossFyBalanceCents: 5_000,
        oldestPostedIncomeDate: daysBefore(NOW, 500),
        fundName: "Charitable Fund",
      },
      // Non-qualifying: wrong kind.
      {
        fundKind: "administrative",
        crossFyBalanceCents: 100_000,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
        fundName: "Administrative Fund",
      },
      // Non-qualifying: balance not positive.
      {
        fundKind: "scholarship",
        crossFyBalanceCents: 0,
        oldestPostedIncomeDate: daysBefore(NOW, 900),
        fundName: "Scholarship Fund",
      },
    ];
    const count = countAgedPublicFunds(funds, 365, NOW);
    const names = agedPublicFundNames(funds, 365, NOW);
    expect(count).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// grossReceiptsCents
// ---------------------------------------------------------------------------

describe("grossReceiptsCents", () => {
  it("returns zero for an empty array", () => {
    expect(grossReceiptsCents([])).toBe(0);
  });

  it("sums all income amounts", () => {
    const rows = [
      { amountCents: 10_000 },
      { amountCents: 25_000 },
      { amountCents: 5_000 },
    ];
    expect(grossReceiptsCents(rows)).toBe(40_000);
  });

  it("handles a single row", () => {
    expect(grossReceiptsCents([{ amountCents: 99_999 }])).toBe(99_999);
  });
});

// ---------------------------------------------------------------------------
// budgetVariance
// ---------------------------------------------------------------------------

describe("budgetVariance", () => {
  it("returns null variance and pct when budget is null (no budget set)", () => {
    const result = budgetVariance(50_000, null);
    expect(result).toEqual({ varianceCents: null, pct: null });
  });

  it("returns negative variance and null pct when budget is zero (avoid div-by-zero)", () => {
    const result = budgetVariance(30_000, 0);
    expect(result).toEqual({ varianceCents: -30_000, pct: null });
  });

  it("returns null pct and zero varianceCents when budget is zero and actual is also zero", () => {
    // When budgetCents === 0 the function short-circuits: varianceCents = -actualCents = -0.
    // In IEEE 754, -0 === 0 is true, but Object.is(-0, 0) is false.
    // We verify pct is null and varianceCents is numerically zero (not caring about sign).
    const result = budgetVariance(0, 0);
    expect(result.pct).toBeNull();
    expect(result.varianceCents === 0 || result.varianceCents === -0).toBe(true);
  });

  it("computes positive variance when under budget", () => {
    // Budget: $1,000; Actual: $600 → variance = +$400 = 40% under
    const result = budgetVariance(60_000, 100_000);
    expect(result.varianceCents).toBe(40_000);
    expect(result.pct).toBeCloseTo(40, 5);
  });

  it("computes negative variance when over budget", () => {
    // Budget: $800; Actual: $1,000 → variance = −$200 = −25%
    const result = budgetVariance(100_000, 80_000);
    expect(result.varianceCents).toBe(-20_000);
    expect(result.pct).toBeCloseTo(-25, 5);
  });

  it("returns zero variance and 0% when actual exactly equals budget", () => {
    const result = budgetVariance(50_000, 50_000);
    expect(result.varianceCents).toBe(0);
    expect(result.pct).toBeCloseTo(0, 5);
  });

  it("computes 100% variance when nothing has been spent against a non-zero budget", () => {
    const result = budgetVariance(0, 100_000);
    expect(result.varianceCents).toBe(100_000);
    expect(result.pct).toBeCloseTo(100, 5);
  });
});

// ---------------------------------------------------------------------------
// guardrails
// ---------------------------------------------------------------------------

/** A clean baseline state — all checks should be silent (inc1 + inc2 + inc3 + inc6a + inc7). */
const cleanState: GuardrailsInput = {
  funds: [
    { id: "fund-1", kind: "administrative", balanceCents: 50_000 },
    { id: "fund-2", kind: "activity", balanceCents: 75_000 },
  ],
  entityBalanceCents: 125_000,
  settings: {
    reserveWarnThresholdCents: 100_000,   // $1,000 — entity balance (125k) is above
    treasurerBonded: true,
    retentionYears: 7,
    holdingPeriodWarnDays: 365,           // inc7
  },
  incomeWithoutParty: 0,
  cashDisbursements: 0,
  txnsWithoutReceipt: 0,
  // Transaction Receipt Upload (DECISION-035) — used to build Check 11's linkHref
  entitySlug: "club",
  fiscalYear: 2026,
  // inc2 fields — all zero = no issues
  pendingDisbursements: 0,
  unreconciledPriorMonth: 0,
  firewallViolations: 0,
  // inc3 fields — safe defaults (empty history = no revocation check; 0 overdue)
  irsFilingHistory: [],
  overdueFilingCount: 0,
  // inc6a fields — zero = no dues sync mismatch
  syncStaleTxns: 0,
  // inc7 fields — zero = no compliance guardrail flags
  agedPublicFunds: 0,
  adminPublicIncomeCount: 0,
};

describe("guardrails", () => {
  it("returns an empty array when everything is clean", () => {
    expect(guardrails(cleanState)).toHaveLength(0);
  });

  // Check 6: Negative fund balance (HIGH)
  it("fires HIGH for a negative fund balance", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      funds: [
        { id: "fund-1", kind: "administrative", balanceCents: -10_000 },
        { id: "fund-2", kind: "activity", balanceCents: 75_000 },
      ],
    };
    const flags = guardrails(state);
    const negFlag = flags.find((f) => f.severity === "high");
    expect(negFlag).toBeDefined();
    expect(negFlag?.title).toMatch(/negative fund balance/i);
  });

  it("fires HIGH for EACH fund with a negative balance", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      funds: [
        { id: "fund-1", kind: "administrative", balanceCents: -5_000 },
        { id: "fund-2", kind: "activity", balanceCents: -3_000 },
      ],
    };
    const highFlags = guardrails(state).filter((f) => f.severity === "high");
    expect(highFlags).toHaveLength(2);
  });

  it("does NOT fire the negative fund check when all balances are ≥ 0", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      funds: [{ id: "fund-1", kind: "administrative", balanceCents: 0 }],
      entityBalanceCents: 0,
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.severity === "high")).toBeUndefined();
  });

  // Check 4: Reserves below threshold (WARN)
  it("fires WARN when entity balance is below the reserve threshold", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      entityBalanceCents: 50_000,
      settings: {
        ...cleanState.settings,
        reserveWarnThresholdCents: 100_000,
      },
    };
    const flags = guardrails(state);
    const reserveFlag = flags.find((f) => f.title.toLowerCase().includes("reserve"));
    expect(reserveFlag).toBeDefined();
    expect(reserveFlag?.severity).toBe("warn");
  });

  it("does NOT fire reserves warn when balance equals the threshold exactly", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      entityBalanceCents: 100_000,
      settings: {
        ...cleanState.settings,
        reserveWarnThresholdCents: 100_000,
      },
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("reserve"))).toBeUndefined();
  });

  // Check 7: Treasurer not bonded (WARN)
  it("fires WARN when treasurer is not bonded", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      settings: { ...cleanState.settings, treasurerBonded: false },
    };
    const flags = guardrails(state);
    const bondFlag = flags.find((f) => f.title.toLowerCase().includes("bonded"));
    expect(bondFlag).toBeDefined();
    expect(bondFlag?.severity).toBe("warn");
  });

  it("does NOT fire bonded warn when treasurer is bonded", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      settings: { ...cleanState.settings, treasurerBonded: true },
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("bonded"))).toBeUndefined();
  });

  // Check 8: Income without party / itemized source (WARN)
  it("fires WARN when income entries are missing a party", () => {
    const state: GuardrailsInput = { ...cleanState, incomeWithoutParty: 3 };
    const flags = guardrails(state);
    const partyFlag = flags.find((f) =>
      f.title.toLowerCase().includes("source") ||
      f.title.toLowerCase().includes("party"),
    );
    expect(partyFlag).toBeDefined();
    expect(partyFlag?.severity).toBe("warn");
  });

  it("does NOT fire itemized-source warn when all income has a party", () => {
    const state: GuardrailsInput = { ...cleanState, incomeWithoutParty: 0 };
    const flags = guardrails(state);
    expect(
      flags.find((f) => f.title.toLowerCase().includes("source")),
    ).toBeUndefined();
  });

  // Check 9: Cash disbursements (WARN)
  it("fires WARN when cash disbursements are present", () => {
    const state: GuardrailsInput = { ...cleanState, cashDisbursements: 2 };
    const flags = guardrails(state);
    const cashFlag = flags.find((f) => f.title.toLowerCase().includes("cash"));
    expect(cashFlag).toBeDefined();
    expect(cashFlag?.severity).toBe("warn");
  });

  it("does NOT fire cash disbursement warn when there are no cash payments", () => {
    const state: GuardrailsInput = { ...cleanState, cashDisbursements: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("cash"))).toBeUndefined();
  });

  // Check 11: Expenses missing receipt URL (INFO)
  it("fires INFO when expenses are missing receipt documentation", () => {
    const state: GuardrailsInput = { ...cleanState, txnsWithoutReceipt: 5 };
    const flags = guardrails(state);
    const receiptFlag = flags.find((f) => f.title.toLowerCase().includes("receipt"));
    expect(receiptFlag).toBeDefined();
    expect(receiptFlag?.severity).toBe("info");
  });

  it("does NOT fire receipt warn when all expenses have receipt URLs", () => {
    const state: GuardrailsInput = { ...cleanState, txnsWithoutReceipt: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("receipt"))).toBeUndefined();
  });

  // Check 11 linkHref (DECISION-035 — Transaction Receipt Upload)
  it("Check 11's flag includes a linkHref built from entitySlug/fiscalYear when it fires", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      txnsWithoutReceipt: 5,
      entitySlug: "foundation",
      fiscalYear: 2027,
    };
    const flags = guardrails(state);
    const receiptFlag = flags.find((f) => f.title.toLowerCase().includes("receipt"));
    expect(receiptFlag?.linkHref).toBe("/admin/ledger/all?entity=foundation&fy=2027&receipt=missing");
  });

  it("Check 11's flag has no linkHref (undefined) when txnsWithoutReceipt is zero", () => {
    const state: GuardrailsInput = { ...cleanState, txnsWithoutReceipt: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("receipt"))).toBeUndefined();
  });

  // Multiple simultaneous flags
  it("returns multiple flags when multiple checks fail at once", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      funds: [{ id: "fund-1", kind: "administrative", balanceCents: -5_000 }],
      entityBalanceCents: -5_000,
      settings: {
        reserveWarnThresholdCents: 100_000,
        treasurerBonded: false,
        retentionYears: 7,
        holdingPeriodWarnDays: 365,
      },
      incomeWithoutParty: 2,
      cashDisbursements: 1,
      txnsWithoutReceipt: 3,
    };
    const flags = guardrails(state);
    expect(flags.length).toBeGreaterThanOrEqual(5);
  });

  // ---------------------------------------------------------------------------
  // inc2 guardrail checks
  // ---------------------------------------------------------------------------

  // Unapproved disbursements (WARN)
  it("fires WARN when there are pending (unapproved) disbursements", () => {
    const state: GuardrailsInput = { ...cleanState, pendingDisbursements: 3 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("pending"));
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("warn");
  });

  it("does NOT fire pending disbursement warn when count is zero", () => {
    const state: GuardrailsInput = { ...cleanState, pendingDisbursements: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("pending"))).toBeUndefined();
  });

  it("uses singular wording for a single pending disbursement", () => {
    const state: GuardrailsInput = { ...cleanState, pendingDisbursements: 1 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("pending"))!;
    expect(flag.detail).toContain("1 disbursement ");
    expect(flag.detail).not.toContain("disbursements ");
  });

  it("uses plural wording for multiple pending disbursements", () => {
    const state: GuardrailsInput = { ...cleanState, pendingDisbursements: 4 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("pending"))!;
    expect(flag.detail).toContain("4 disbursements");
  });

  // Unreconciled prior-month transactions (WARN)
  it("fires WARN when there are unreconciled transactions from prior months", () => {
    const state: GuardrailsInput = { ...cleanState, unreconciledPriorMonth: 5 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("unreconciled"));
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("warn");
  });

  it("does NOT fire unreconciled warn when count is zero", () => {
    const state: GuardrailsInput = { ...cleanState, unreconciledPriorMonth: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("unreconciled"))).toBeUndefined();
  });

  // Two-fund firewall violations (HIGH)
  it("fires HIGH for a two-fund firewall violation", () => {
    const state: GuardrailsInput = { ...cleanState, firewallViolations: 1 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("firewall"));
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("high");
  });

  it("does NOT fire firewall HIGH when violations count is zero", () => {
    const state: GuardrailsInput = { ...cleanState, firewallViolations: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("firewall"))).toBeUndefined();
  });

  it("includes policy cite for firewall violation", () => {
    const state: GuardrailsInput = { ...cleanState, firewallViolations: 2 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("firewall"))!;
    expect(flag.policyCite).toMatch(/§6/);
  });

  it("fires all three inc2 flags simultaneously when all counts are non-zero", () => {
    const state: GuardrailsInput = {
      ...cleanState,
      pendingDisbursements: 1,
      unreconciledPriorMonth: 2,
      firewallViolations: 1,
    };
    const flags = guardrails(state);
    expect(flags.some((f) => f.title.toLowerCase().includes("pending"))).toBe(true);
    expect(flags.some((f) => f.title.toLowerCase().includes("unreconciled"))).toBe(true);
    expect(flags.some((f) => f.title.toLowerCase().includes("firewall"))).toBe(true);
  });

  // Singular vs plural wording (detail message sanity)
  it("uses singular wording for a single cash disbursement", () => {
    const state: GuardrailsInput = { ...cleanState, cashDisbursements: 1 };
    const flags = guardrails(state);
    const cashFlag = flags.find((f) => f.title.toLowerCase().includes("cash"));
    expect(cashFlag?.detail).toContain("1 expense transaction");
    expect(cashFlag?.detail).not.toContain("transactions");
  });

  it("uses plural wording for multiple cash disbursements", () => {
    const state: GuardrailsInput = { ...cleanState, cashDisbursements: 4 };
    const flags = guardrails(state);
    const cashFlag = flags.find((f) => f.title.toLowerCase().includes("cash"));
    expect(cashFlag?.detail).toContain("4 expense transactions");
  });
});

// ---------------------------------------------------------------------------
// isReceiptMissing (DECISION-035 — Transaction Receipt Upload)
// ---------------------------------------------------------------------------

describe("isReceiptMissing", () => {
  it("returns true for an expense row with both receiptStorageKey and receiptWaivedAt null", () => {
    expect(
      isReceiptMissing({ flow: "expense", receiptStorageKey: null, receiptWaivedAt: null }),
    ).toBe(true);
  });

  it("returns false when receiptStorageKey is set", () => {
    expect(
      isReceiptMissing({
        flow: "expense",
        receiptStorageKey: "receipts/abc/file.pdf",
        receiptWaivedAt: null,
      }),
    ).toBe(false);
  });

  it("returns false when receiptWaivedAt is set (waived)", () => {
    expect(
      isReceiptMissing({ flow: "expense", receiptStorageKey: null, receiptWaivedAt: new Date() }),
    ).toBe(false);
  });

  it("returns false when both receiptStorageKey and receiptWaivedAt are set", () => {
    expect(
      isReceiptMissing({
        flow: "expense",
        receiptStorageKey: "receipts/abc/file.pdf",
        receiptWaivedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("returns false for a non-expense row regardless of the other two fields (income/transfer never count)", () => {
    expect(
      isReceiptMissing({ flow: "income", receiptStorageKey: null, receiptWaivedAt: null }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeDueDate (inc3)
// ---------------------------------------------------------------------------

describe("computeDueDate", () => {
  // Month >= 7: falls in the first calendar year of the FY (same as FY start year)
  it("month=11 (November) FY2026 → Nov 15 2026", () => {
    const d = computeDueDate(2026, 11, 15);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  it("month=7 (July — boundary) FY2026 → Jul 1 2026", () => {
    const d = computeDueDate(2026, 7, 1);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July is index 6
    expect(d.getDate()).toBe(1);
  });

  it("month=12 (December) FY2026 → Dec 31 2026", () => {
    const d = computeDueDate(2026, 12, 31);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  // Month < 7: falls in the second calendar year of the FY (FY start year + 1)
  it("month=6 (June — boundary) FY2026 → Jun 30 2027", () => {
    const d = computeDueDate(2026, 6, 30);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(5); // June is index 5
    expect(d.getDate()).toBe(30);
  });

  it("month=1 (January) FY2026 → Jan 15 2027", () => {
    const d = computeDueDate(2026, 1, 15);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
  });

  // Boundary: July (month=7) is NOT < 7, so it maps to the same calendar year
  it("month=7 is not < 7, so it maps to FY start year (not +1)", () => {
    const d7 = computeDueDate(2026, 7, 1);
    const d6 = computeDueDate(2026, 6, 1);
    // July 2026 < June 2027 — they are in different calendar years
    expect(d7.getFullYear()).toBe(2026);
    expect(d6.getFullYear()).toBe(2027);
  });
});

// ---------------------------------------------------------------------------
// isFilingOverdue (inc3)
// ---------------------------------------------------------------------------

describe("isFilingOverdue", () => {
  it("returns true when dueDate is past and status is not_started", () => {
    // Nov 15 2026 is past from the perspective of 2027
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "not_started" },
      new Date("2027-01-01"),
    );
    expect(result).toBe(true);
  });

  it("returns false when dueDate is in the future", () => {
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "not_started" },
      new Date("2026-01-01"),
    );
    expect(result).toBe(false);
  });

  it("returns false when status is filed (even if past due)", () => {
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "filed" },
      new Date("2027-01-01"),
    );
    expect(result).toBe(false);
  });

  it("returns false when status is na (not applicable)", () => {
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "na" },
      new Date("2027-01-01"),
    );
    expect(result).toBe(false);
  });

  it("returns false when status is future", () => {
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "future" },
      new Date("2027-01-01"),
    );
    expect(result).toBe(false);
  });

  it("returns true when status is in_progress and past due", () => {
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "in_progress" },
      new Date("2027-01-01"),
    );
    expect(result).toBe(true);
  });

  it("returns false on the exact due date (dueDate is not < today)", () => {
    // Due Nov 15 2026; today = Nov 15 2026 → not overdue yet
    const result = isFilingOverdue(
      { fiscalYear: 2026, dueMonth: 11, dueDay: 15, status: "not_started" },
      new Date(2026, 10, 15), // Nov 15 2026 at midnight local
    );
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc3 additions
// ---------------------------------------------------------------------------

/** Extend cleanState for inc3 (add new required fields with safe defaults). */
const cleanStateInc3: GuardrailsInput = {
  funds: [
    { id: "fund-1", kind: "administrative", balanceCents: 50_000 },
    { id: "fund-2", kind: "activity", balanceCents: 75_000 },
  ],
  entityBalanceCents: 125_000,
  settings: {
    reserveWarnThresholdCents: 100_000,
    treasurerBonded: true,
    retentionYears: 7,
    holdingPeriodWarnDays: 365,  // inc7
  },
  incomeWithoutParty: 0,
  cashDisbursements: 0,
  txnsWithoutReceipt: 0,
  entitySlug: "club",
  fiscalYear: 2026,
  pendingDisbursements: 0,
  unreconciledPriorMonth: 0,
  firewallViolations: 0,
  irsFilingHistory: [],
  overdueFilingCount: 0,
  // inc6a fields
  syncStaleTxns: 0,
  // inc7 fields
  agedPublicFunds: 0,
  adminPublicIncomeCount: 0,
};

describe("guardrails — inc3 revocation check", () => {
  it("fires HIGH when 3 most-recent IRS filings are all not filed/na", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2023, status: "not_started" },
        { fiscalYear: 2024, status: "not_started" },
        { fiscalYear: 2025, status: "in_progress" },
      ],
    };
    const flags = guardrails(state);
    const revFlag = flags.find((f) => f.title.toLowerCase().includes("revocation"));
    expect(revFlag).toBeDefined();
    expect(revFlag?.severity).toBe("high");
    expect(revFlag?.policyCite).toBe("IRC §6033(j)");
  });

  it("does NOT fire when at least one of the 3 most-recent IRS filings has status filed", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2023, status: "filed" },
        { fiscalYear: 2024, status: "not_started" },
        { fiscalYear: 2025, status: "not_started" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });

  it("does NOT fire when at least one of the 3 most-recent has status na", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2023, status: "not_started" },
        { fiscalYear: 2024, status: "na" },
        { fiscalYear: 2025, status: "not_started" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });

  it("suppresses the check when fewer than 3 FYs of IRS filing data exist", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2024, status: "not_started" },
        { fiscalYear: 2025, status: "not_started" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });

  it("suppresses the check when irsFilingHistory is empty", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });

  it("does NOT fire when 3 FYs all have status filed", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2023, status: "filed" },
        { fiscalYear: 2024, status: "filed" },
        { fiscalYear: 2025, status: "filed" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });

  it("fires using only the last 3 when more than 3 FYs are provided (most recent 3 unfiled)", () => {
    // 4 entries: earliest is filed, 3 most recent are not_started → fires
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2022, status: "filed" }, // oldest — not in the 3-most-recent check
        { fiscalYear: 2023, status: "not_started" },
        { fiscalYear: 2024, status: "not_started" },
        { fiscalYear: 2025, status: "not_started" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeDefined();
  });

  it("does NOT fire when 4 entries are provided and the 3 most recent include a filed entry", () => {
    // 4 entries: most recent is filed → does not fire
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      irsFilingHistory: [
        { fiscalYear: 2022, status: "not_started" },
        { fiscalYear: 2023, status: "not_started" },
        { fiscalYear: 2024, status: "not_started" },
        { fiscalYear: 2025, status: "filed" },
      ],
    };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
  });
});

describe("guardrails — inc3 overdue filings check", () => {
  it("fires WARN when overdueFilingCount > 0", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      overdueFilingCount: 2,
    };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("overdue"));
    expect(flag).toBeDefined();
    expect(flag?.severity).toBe("warn");
    expect(flag?.policyCite).toMatch(/§10/);
  });

  it("uses singular wording for 1 overdue filing", () => {
    const state: GuardrailsInput = { ...cleanStateInc3, overdueFilingCount: 1 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("overdue"))!;
    expect(flag.detail).toContain("1 filing is");
  });

  it("uses plural wording for multiple overdue filings", () => {
    const state: GuardrailsInput = { ...cleanStateInc3, overdueFilingCount: 3 };
    const flags = guardrails(state);
    const flag = flags.find((f) => f.title.toLowerCase().includes("overdue"))!;
    expect(flag.detail).toContain("3 filings are");
  });

  it("does NOT fire when overdueFilingCount is 0", () => {
    const state: GuardrailsInput = { ...cleanStateInc3, overdueFilingCount: 0 };
    const flags = guardrails(state);
    expect(flags.find((f) => f.title.toLowerCase().includes("overdue"))).toBeUndefined();
  });
});

describe("guardrails — backward compatibility (inc1/inc2 callers with new fields as zero/empty)", () => {
  it("returns empty array when all inc1/inc2 checks pass and inc3 fields are safe defaults", () => {
    // This simulates an existing getOverview() call that now passes [] / 0
    expect(guardrails(cleanStateInc3)).toHaveLength(0);
  });

  it("existing inc2 checks still fire when triggered alongside inc3 safe defaults", () => {
    const state: GuardrailsInput = {
      ...cleanStateInc3,
      firewallViolations: 1,
      irsFilingHistory: [],
      overdueFilingCount: 0,
    };
    const flags = guardrails(state);
    expect(flags.some((f) => f.title.toLowerCase().includes("firewall"))).toBe(true);
    expect(flags.find((f) => f.title.toLowerCase().includes("revocation"))).toBeUndefined();
    expect(flags.find((f) => f.title.toLowerCase().includes("overdue"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// determine990
// ---------------------------------------------------------------------------

import { determine990 } from "./ledger";

describe("determine990", () => {
  // 501c4 (social welfare) — not a public charity

  it("returns 990-N for a 501c4 with gross receipts at the $50k threshold", () => {
    const result = determine990({
      taxClassification: "501c4",
      charityStatus: null,
      grossReceiptsCents: 50_000 * 100,
      assetsCents: 10_000 * 100,
    });
    expect(result.form).toBe("990-N");
  });

  it("returns 990-N for a 501c4 with gross receipts below $50k", () => {
    const result = determine990({
      taxClassification: "501c4",
      charityStatus: null,
      grossReceiptsCents: 25_000 * 100,
      assetsCents: 0,
    });
    expect(result.form).toBe("990-N");
  });

  it("returns 990-EZ for a 501c4 with receipts $50k–$200k and assets under $500k", () => {
    const result = determine990({
      taxClassification: "501c4",
      charityStatus: null,
      grossReceiptsCents: 100_000 * 100,
      assetsCents: 100_000 * 100,
    });
    expect(result.form).toBe("990-EZ");
  });

  it("returns 990 for a 501c4 with receipts >= $200k", () => {
    const result = determine990({
      taxClassification: "501c4",
      charityStatus: null,
      grossReceiptsCents: 200_000 * 100,
      assetsCents: 100_000 * 100,
    });
    expect(result.form).toBe("990");
  });

  it("returns 990 for a 501c4 with receipts < $200k but assets >= $500k — regression for missed branch", () => {
    const result = determine990({
      taxClassification: "501c4",
      charityStatus: null,
      grossReceiptsCents: 150_000 * 100,
      assetsCents: 600_000 * 100,
    });
    expect(result.form).toBe("990");
  });

  // 501c3 public charity

  it("returns 990-N for a public charity with gross receipts <= $50k", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "public_charity",
      grossReceiptsCents: 30_000 * 100,
      assetsCents: 10_000 * 100,
    });
    expect(result.form).toBe("990-N");
  });

  it("returns 990-EZ for a public charity with receipts $50k–$200k and assets under $500k", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "public_charity",
      grossReceiptsCents: 150_000 * 100,
      assetsCents: 200_000 * 100,
    });
    expect(result.form).toBe("990-EZ");
  });

  it("returns 990 for a public charity with gross receipts >= $200k", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "public_charity",
      grossReceiptsCents: 250_000 * 100,
      assetsCents: 100_000 * 100,
    });
    expect(result.form).toBe("990");
  });

  it("returns 990 for a public charity with receipts < $200k but assets >= $500k — regression for missed branch", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "public_charity",
      grossReceiptsCents: 100_000 * 100,
      assetsCents: 600_000 * 100,
    });
    expect(result.form).toBe("990");
  });

  // Private foundation

  it("returns 990-PF for a private foundation regardless of receipts", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "private_foundation",
      grossReceiptsCents: 0,
      assetsCents: 0,
    });
    expect(result.form).toBe("990-PF");
  });

  it("returns 990-PF for a private foundation with large receipts", () => {
    const result = determine990({
      taxClassification: "501c3",
      charityStatus: "private_foundation",
      grossReceiptsCents: 5_000_000 * 100,
      assetsCents: 50_000_000 * 100,
    });
    expect(result.form).toBe("990-PF");
  });
});

// ---------------------------------------------------------------------------
// deriveAckType — inc6a
// ---------------------------------------------------------------------------

describe("deriveAckType", () => {
  // Phase 3 design specifies exactly these 6 test cases.

  it("returns null for a $249.99 gift with no quid-pro-quo", () => {
    // 24999 cents < 25000 threshold; no quid-pro-quo
    expect(deriveAckType(24999, null)).toBeNull();
  });

  it("returns 'written_ack_250' for a $250.00 gift with no quid-pro-quo", () => {
    // 25000 cents = exactly $250 threshold
    expect(deriveAckType(25000, null)).toBe("written_ack_250");
  });

  it("returns null for a $100 gift with $74.99 quid-pro-quo", () => {
    // 7499 cents < 7500 threshold; gift below $250 too
    expect(deriveAckType(10000, 7499)).toBeNull();
  });

  it("returns 'quid_pro_quo_75' for a $100 gift with $75.00 quid-pro-quo", () => {
    // 7500 cents = exactly $75 threshold
    expect(deriveAckType(10000, 7500)).toBe("quid_pro_quo_75");
  });

  it("returns 'quid_pro_quo_75' for a $300 gift with $75 quid-pro-quo (stricter type wins)", () => {
    // Both thresholds met — quid_pro_quo_75 takes precedence (Phase 3 design)
    expect(deriveAckType(30000, 7500)).toBe("quid_pro_quo_75");
  });

  it("returns 'written_ack_250' for a $300 gift with $0 quid-pro-quo (zero treated as null)", () => {
    // FMV=0 is treated as no goods/services; gift >= $250 → written_ack_250
    expect(deriveAckType(30000, 0)).toBe("written_ack_250");
  });

  // Additional edge cases
  it("returns null when both amounts are below thresholds", () => {
    expect(deriveAckType(5000, 1000)).toBeNull();
  });

  it("returns 'written_ack_250' for a large gift with null quid-pro-quo", () => {
    expect(deriveAckType(100_000_00, null)).toBe("written_ack_250");
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc6a syncStaleTxns check
// ---------------------------------------------------------------------------

describe("guardrails — syncStaleTxns (inc6a)", () => {
  it("does not fire when syncStaleTxns is 0", () => {
    const flags = guardrails({ ...cleanState, syncStaleTxns: 0 });
    const staleFlags = flags.filter((f) => f.title.includes("sync mismatch"));
    expect(staleFlags).toHaveLength(0);
  });

  it("fires WARN when syncStaleTxns is 1 (singular grammar)", () => {
    const flags = guardrails({ ...cleanState, syncStaleTxns: 1 });
    const staleFlags = flags.filter((f) => f.title === "Dues payment sync mismatch");
    expect(staleFlags).toHaveLength(1);
    expect(staleFlags[0].severity).toBe("warn");
    expect(staleFlags[0].detail).toContain("1 ledger transaction is");
  });

  it("fires WARN when syncStaleTxns is 2 (plural grammar)", () => {
    const flags = guardrails({ ...cleanState, syncStaleTxns: 2 });
    const staleFlags = flags.filter((f) => f.title === "Dues payment sync mismatch");
    expect(staleFlags).toHaveLength(1);
    expect(staleFlags[0].severity).toBe("warn");
    expect(staleFlags[0].detail).toContain("2 ledger transactions are");
  });

  it("clean baseline still returns no flags with syncStaleTxns: 0", () => {
    expect(guardrails(cleanState)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc7: aged public-fund balances (Enhancement 1)
// ---------------------------------------------------------------------------

describe("guardrails — aged public-fund balances (inc7)", () => {
  it("does NOT fire aged-funds warn when agedPublicFunds is 0", () => {
    const flags = guardrails({ ...cleanState, agedPublicFunds: 0 });
    const aged = flags.find((f) => /aged|holding/i.test(f.title));
    expect(aged).toBeUndefined();
  });

  it("fires WARN when agedPublicFunds is 1", () => {
    const flags = guardrails({ ...cleanState, agedPublicFunds: 1 });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.severity).toBe("warn");
    expect(aged?.detail).toContain("minutes");
  });

  it("fires WARN when agedPublicFunds is greater than 1 (plural noun)", () => {
    const flags = guardrails({ ...cleanState, agedPublicFunds: 3 });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.title).toContain("funds");
  });

  it("aged-funds detail text includes the configured holdingPeriodWarnDays value", () => {
    const flags = guardrails({
      ...cleanState,
      agedPublicFunds: 1,
      settings: { ...cleanState.settings, holdingPeriodWarnDays: 180 },
    });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.detail).toContain("180");
  });

  it("does NOT fire aged-funds warn when agedPublicFunds is 0 even if holdingPeriodWarnDays is very small", () => {
    const flags = guardrails({
      ...cleanState,
      agedPublicFunds: 0,
      settings: { ...cleanState.settings, holdingPeriodWarnDays: 1 },
    });
    const aged = flags.find((f) => /aged|holding/i.test(f.title));
    expect(aged).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// guardrails — aged-funds detail text includes fund names
// (inc7 dashboard usability fix, DECISION-032)
// ---------------------------------------------------------------------------

describe("guardrails — aged-funds detail text includes fund names (inc7 dashboard usability fix)", () => {
  it("omits the parenthetical when agedPublicFundNames is undefined (backward compatibility)", () => {
    const flags = guardrails({ ...cleanState, agedPublicFunds: 1 });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.detail).not.toContain("(");
  });

  it("omits the parenthetical when agedPublicFundNames is an empty array", () => {
    const flags = guardrails({ ...cleanState, agedPublicFunds: 1, agedPublicFundNames: [] });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.detail).not.toContain("(");
  });

  it("includes a single fund name in parentheses when agedPublicFundNames has one entry", () => {
    const flags = guardrails({
      ...cleanState,
      agedPublicFunds: 1,
      agedPublicFundNames: ["Charitable Fund"],
    });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.detail).toContain("(Charitable Fund)");
  });

  it("includes comma-joined fund names in parentheses when agedPublicFundNames has multiple entries", () => {
    const flags = guardrails({
      ...cleanState,
      agedPublicFunds: 3,
      agedPublicFundNames: ["Activity Fund", "Charitable Fund", "Scholarship Fund"],
    });
    const aged = flags.find((f) => /holding.*threshold/i.test(f.title));
    expect(aged).toBeDefined();
    expect(aged?.detail).toContain("(Activity Fund, Charitable Fund, Scholarship Fund)");
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc7: direct-to-admin public income (Enhancement 2)
// ---------------------------------------------------------------------------

describe("guardrails — direct-to-admin public income (inc7)", () => {
  it("does NOT fire admin-public-income warn when adminPublicIncomeCount is 0", () => {
    const flags = guardrails({ ...cleanState, adminPublicIncomeCount: 0 });
    const adminFlag = flags.find((f) => /administrative fund/i.test(f.title));
    expect(adminFlag).toBeUndefined();
  });

  it("fires WARN when adminPublicIncomeCount is 1", () => {
    const flags = guardrails({ ...cleanState, adminPublicIncomeCount: 1 });
    const adminFlag = flags.find((f) => /public-category income/i.test(f.title));
    expect(adminFlag).toBeDefined();
    expect(adminFlag?.severity).toBe("warn");
    expect(adminFlag?.policyCite).toContain("Art. VII §3(g)");
  });

  it("fires WARN when adminPublicIncomeCount is greater than 1 (plural noun)", () => {
    const flags = guardrails({ ...cleanState, adminPublicIncomeCount: 4 });
    const adminFlag = flags.find((f) => /public-category income/i.test(f.title));
    expect(adminFlag).toBeDefined();
    expect(adminFlag?.detail).toContain("4 posted income transactions");
  });

  it("admin-public-income flag does NOT fire when adminPublicIncomeCount is 0 (dues scenario)", () => {
    // The count computation in getOverview() never increments for dues because the
    // "Club dues" category has fundKind = 'administrative'; this test confirms the
    // guardrail respects the count, not the category logic.
    const flags = guardrails({ ...cleanState, adminPublicIncomeCount: 0 });
    const adminFlag = flags.find((f) => /public-category income/i.test(f.title));
    expect(adminFlag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc7: firewall policyCite includes §3(g) (Enhancement 3)
// ---------------------------------------------------------------------------

describe("guardrails — firewall policyCite upgrade (inc7)", () => {
  it("two-fund firewall flag policyCite includes Art. VII §3(g)", () => {
    const flags = guardrails({ ...cleanState, firewallViolations: 1 });
    const firewallFlag = flags.find((f) => f.title.toLowerCase().includes("firewall"));
    expect(firewallFlag).toBeDefined();
    expect(firewallFlag?.policyCite).toContain("Art. VII §3(g)");
    expect(firewallFlag?.policyCite).toContain("Two-Fund Firewall");
  });
});

// ---------------------------------------------------------------------------
// guardrails — inc7: cleanState regression with all new fields
// ---------------------------------------------------------------------------

describe("guardrails — cleanState regression (inc7)", () => {
  it("cleanState with inc7 fields still returns no flags", () => {
    expect(guardrails(cleanState)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// daysSinceTxnDate — Ledger Dashboard (Two-Entity Homepage)
// ---------------------------------------------------------------------------

describe("daysSinceTxnDate", () => {
  const NOW = new Date("2026-07-20T00:00:00Z");

  it("returns 0 for a txnDate equal to now (same calendar day)", () => {
    expect(daysSinceTxnDate("2026-07-20", NOW)).toBe(0);
  });

  it("returns 90 for a txnDate exactly 90 days before now", () => {
    // 90 days before 2026-07-20 is 2026-04-21.
    expect(daysSinceTxnDate("2026-04-21", NOW)).toBe(90);
  });

  it("floors partial days rather than rounding", () => {
    // NOW is midnight UTC; a txnDate of "today" parsed as midnight UTC is an
    // exact multiple of a day, so use a `now` with a partial-day offset to
    // exercise the floor behavior against a fixed prior date.
    const partialDayNow = new Date("2026-07-20T18:00:00Z");
    // 2026-07-19T00:00:00Z to 2026-07-20T18:00:00Z is 1.75 days — floors to 1.
    expect(daysSinceTxnDate("2026-07-19", partialDayNow)).toBe(1);
  });

  it("returns a large positive number for a txnDate from a prior fiscal year (regression shape for the T-02 case: ~135 days)", () => {
    // T-02: the two Ohio Lions Foundation checks dated 2026-03-07, ~135 days
    // before this file's other NOW fixtures land at 2026-07-20.
    expect(daysSinceTxnDate("2026-03-07", NOW)).toBe(135);
  });
});

// ---------------------------------------------------------------------------
// computeBudgetBalanceStatus — Guided Budgeting (DECISION-042)
// ---------------------------------------------------------------------------

describe("computeBudgetBalanceStatus", () => {
  it("administrative: income > expense -> ok", () => {
    const result = computeBudgetBalanceStatus("administrative", 100_000, 80_000);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(20_000);
  });

  it("administrative: income === expense -> ok (boundary — equal is not a shortfall)", () => {
    const result = computeBudgetBalanceStatus("administrative", 100_000, 100_000);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(0);
  });

  it("administrative: income one cent less than expense -> warn (boundary just over)", () => {
    const result = computeBudgetBalanceStatus("administrative", 99_999, 100_000);
    expect(result.status).toBe("warn");
    expect(result.netCents).toBe(-1);
  });

  it("administrative: income = 0, expense = 0 -> ok", () => {
    const result = computeBudgetBalanceStatus("administrative", 0, 0);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(0);
  });

  it("activity: net = 0 -> ok", () => {
    const result = computeBudgetBalanceStatus("activity", 50_000, 50_000);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(0);
  });

  it("activity: net = +10,000 cents ($100 exactly) -> ok (tolerance boundary, inclusive)", () => {
    const result = computeBudgetBalanceStatus("activity", 110_000, 100_000);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(10_000);
  });

  it("activity: net = +10,001 cents (one cent past tolerance) -> warn", () => {
    const result = computeBudgetBalanceStatus("activity", 110_001, 100_000);
    expect(result.status).toBe("warn");
    expect(result.netCents).toBe(10_001);
  });

  it("activity: net = -10,000 cents -> ok (symmetric boundary on the deficit side)", () => {
    const result = computeBudgetBalanceStatus("activity", 90_000, 100_000);
    expect(result.status).toBe("ok");
    expect(result.netCents).toBe(-10_000);
  });

  it("activity: net = -50,000 cents -> warn", () => {
    const result = computeBudgetBalanceStatus("activity", 50_000, 100_000);
    expect(result.status).toBe("warn");
    expect(result.netCents).toBe(-50_000);
  });

  it("charitable: expense > income (planned drawdown) -> info (never warn)", () => {
    const result = computeBudgetBalanceStatus("charitable", 50_000, 200_000);
    expect(result.status).toBe("info");
    expect(result.netCents).toBe(-150_000);
  });

  it("charitable: income > expense -> info", () => {
    const result = computeBudgetBalanceStatus("charitable", 200_000, 50_000);
    expect(result.status).toBe("info");
    expect(result.netCents).toBe(150_000);
  });

  it("scholarship: expense > income -> info", () => {
    const result = computeBudgetBalanceStatus("scholarship", 10_000, 90_000);
    expect(result.status).toBe("info");
    expect(result.netCents).toBe(-80_000);
  });

  it("unrecognized fundKind string -> info, does not throw", () => {
    expect(() => computeBudgetBalanceStatus("mystery-fund", 10_000, 90_000)).not.toThrow();
    const result = computeBudgetBalanceStatus("mystery-fund", 10_000, 90_000);
    expect(result.status).toBe("info");
    expect(result.netCents).toBe(-80_000);
  });
});

// ---------------------------------------------------------------------------
// deriveSeedLinesForFund — Guided Budgeting
// ---------------------------------------------------------------------------

describe("deriveSeedLinesForFund", () => {
  it("fund had prior actuals; category actual=$500, differing prior budget=$400 -> proposed=$500, source: actual (actuals win)", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-1",
        categoryName: "Club dues",
        flow: "income",
        actualCents: 50_000,
        budgetCents: 40_000,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, true, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].proposedAmountCents).toBe(50_000);
    expect(result[0].source).toBe("actual");
  });

  it("fund had prior actuals; a specific category's own actual is $0 -> still emitted, proposed=$0, source: actual", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-2",
        categoryName: "Fundraising",
        flow: "income",
        actualCents: 0,
        budgetCents: 10_000,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, true, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].proposedAmountCents).toBe(0);
    expect(result[0].source).toBe("actual");
  });

  it("fund had zero actuals fund-wide; category prior budget=$300 -> fallback triggers, proposed=$300, source: prior_budget", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-3",
        categoryName: "Insurance",
        flow: "expense",
        actualCents: 0,
        budgetCents: 30_000,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, false, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].proposedAmountCents).toBe(30_000);
    expect(result[0].source).toBe("prior_budget");
  });

  it("fund had zero actuals fund-wide; category prior budget=null -> no line emitted (new-category case)", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-4",
        categoryName: "New program",
        flow: "expense",
        actualCents: 0,
        budgetCents: null,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, false, new Map());
    expect(result).toHaveLength(0);
  });

  it("fund had zero actuals fund-wide; category prior budget=$0 (explicit) -> emitted, proposed=$0, source: prior_budget", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-5",
        categoryName: "Contingency",
        flow: "expense",
        actualCents: 0,
        budgetCents: 0,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, false, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].proposedAmountCents).toBe(0);
    expect(result[0].source).toBe("prior_budget");
  });

  it("collision: existingTargetBudgetMap has an entry for the category/flow key -> collision: true, existingTargetAmountCents equals that value", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-6",
        categoryName: "Club dues",
        flow: "income",
        actualCents: 50_000,
        budgetCents: null,
      },
    ];
    const existingMap = new Map([["cat-6_income", 12_345]]);
    const result = deriveSeedLinesForFund(priorLines, true, existingMap);
    expect(result[0].collision).toBe(true);
    expect(result[0].existingTargetAmountCents).toBe(12_345);
  });

  it("no collision: key absent from map -> collision: false, existingTargetAmountCents: null", () => {
    const priorLines: SeedSourceLine[] = [
      {
        categoryId: "cat-7",
        categoryName: "Club dues",
        flow: "income",
        actualCents: 50_000,
        budgetCents: null,
      },
    ];
    const result = deriveSeedLinesForFund(priorLines, true, new Map());
    expect(result[0].collision).toBe(false);
    expect(result[0].existingTargetAmountCents).toBeNull();
  });

  it("empty priorLines input -> returns []", () => {
    expect(deriveSeedLinesForFund([], true, new Map())).toEqual([]);
    expect(deriveSeedLinesForFund([], false, new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateBudgetLineInput — Guided Budgeting
// ---------------------------------------------------------------------------

describe("validateBudgetLineInput", () => {
  const validFund = { id: "fund-1", kind: "administrative" };
  const validCategory = { id: "cat-1", fundKind: "administrative", flow: "income" };

  it("fund: null -> { ok: false, status: 404 }", () => {
    const result = validateBudgetLineInput({
      fund: null,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 10_000,
    });
    expect(result).toEqual({ ok: false, error: "Fund not found", status: 404 });
  });

  it("category: null -> { ok: false, status: 404 }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: null,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 10_000,
    });
    expect(result).toEqual({ ok: false, error: "Category not found", status: 404 });
  });

  it("category.fundKind !== fund.kind -> { ok: false, status: 400 } (\"does not match fund type\")", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: { id: "cat-2", fundKind: "activity", flow: "income" },
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 10_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("does not match fund type");
    }
  });

  it("category.flow !== requested flow -> { ok: false, status: 400 }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: { id: "cat-3", fundKind: "administrative", flow: "expense" },
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 10_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("fiscalYear out of bounds (1999 and 2101) -> { ok: false, status: 400 }", () => {
    const tooEarly = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 1999,
      annualAmountCents: 10_000,
    });
    const tooLate = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2101,
      annualAmountCents: 10_000,
    });
    expect(tooEarly.ok).toBe(false);
    expect(tooLate.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.status).toBe(400);
    if (!tooLate.ok) expect(tooLate.status).toBe(400);
  });

  it("annualAmountCents: null (delete path) with valid fund/category/flow -> { ok: true }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: null,
    });
    expect(result).toEqual({ ok: true });
  });

  it("annualAmountCents: 0 -> { ok: true } (explicit $0 valid)", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 0,
    });
    expect(result).toEqual({ ok: true });
  });

  it("annualAmountCents negative -> { ok: false, status: 400 }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: -100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("annualAmountCents non-integer (e.g. 100.5) -> { ok: false, status: 400 }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 100.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("annualAmountCents exceeds INT4_MAX -> { ok: false, status: 400 }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 2_147_483_648,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("all valid -> { ok: true }", () => {
    const result = validateBudgetLineInput({
      fund: validFund,
      category: validCategory,
      flow: "income",
      fiscalYear: 2026,
      annualAmountCents: 50_000,
    });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// decideSeedWriteAction — Guided Budgeting
// ---------------------------------------------------------------------------

describe("decideSeedWriteAction", () => {
  it('("fill-empty", collision: false) -> "seed"', () => {
    expect(decideSeedWriteAction("fill-empty", false)).toBe("seed");
  });

  it('("fill-empty", collision: true) -> "skip"', () => {
    expect(decideSeedWriteAction("fill-empty", true)).toBe("skip");
  });

  it('("overwrite", collision: false) -> "seed"', () => {
    expect(decideSeedWriteAction("overwrite", false)).toBe("seed");
  });

  it('("overwrite", collision: true) -> "overwrite"', () => {
    expect(decideSeedWriteAction("overwrite", true)).toBe("overwrite");
  });
});

// ---------------------------------------------------------------------------
// isBudgetLocked — Budget Approve/Lock
// ---------------------------------------------------------------------------

describe("isBudgetLocked", () => {
  it("returns false when no approval row exists (null)", () => {
    expect(isBudgetLocked(null)).toBe(false);
  });

  it("returns false when status is 'unlocked'", () => {
    expect(isBudgetLocked({ status: "unlocked" })).toBe(false);
  });

  it("returns true when status is 'locked'", () => {
    expect(isBudgetLocked({ status: "locked" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateCategoryCreateInput — Budget Approve/Lock (inline category create)
// ---------------------------------------------------------------------------

describe("validateCategoryCreateInput", () => {
  it("rejects an empty name", () => {
    const result = validateCategoryCreateInput({
      name: "",
      flow: "income",
      existingNames: [],
    });
    expect(result).toEqual({ ok: false, error: "Category name is required.", status: 400 });
  });

  it("rejects a whitespace-only name", () => {
    const result = validateCategoryCreateInput({
      name: "   ",
      flow: "income",
      existingNames: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects flow values other than income/expense", () => {
    const result = validateCategoryCreateInput({
      name: "Club Dues",
      flow: "transfer",
      existingNames: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects a case-insensitive duplicate name against existingNames", () => {
    const result = validateCategoryCreateInput({
      name: "Club Dues",
      flow: "income",
      existingNames: ["club dues"],
    });
    expect(result).toEqual({
      ok: false,
      error: "A category named 'Club Dues' already exists for this fund.",
      status: 409,
    });
  });

  it("accepts a valid, unique name", () => {
    const result = validateCategoryCreateInput({
      name: "New Initiative Fund",
      flow: "expense",
      existingNames: ["Club Dues", "Fundraising Event Costs"],
    });
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// nextCategorySortOrder — Budget Approve/Lock (inline category create)
// ---------------------------------------------------------------------------

describe("nextCategorySortOrder", () => {
  it("returns 0 for an empty fund+flow (first category)", () => {
    expect(nextCategorySortOrder([])).toBe(0);
  });

  it("returns max + 1 for existing sortOrders", () => {
    expect(nextCategorySortOrder([0, 2, 5])).toBe(6);
  });

  it("handles a single existing category", () => {
    expect(nextCategorySortOrder([3])).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// validateRequiredTrimmedText — Budget Approve/Lock (shared with approve/unlock routes)
// ---------------------------------------------------------------------------

describe("validateRequiredTrimmedText", () => {
  it("rejects undefined", () => {
    expect(validateRequiredTrimmedText(undefined)).toEqual({ ok: false });
  });

  it("rejects an empty string", () => {
    expect(validateRequiredTrimmedText("")).toEqual({ ok: false });
  });

  it("rejects a whitespace-only string", () => {
    expect(validateRequiredTrimmedText("   ")).toEqual({ ok: false });
  });

  it("trims and accepts a valid string", () => {
    expect(validateRequiredTrimmedText("  Board voted 5-0  ")).toEqual({
      ok: true,
      value: "Board voted 5-0",
    });
  });

  it("truncates (does not reject) a string longer than maxLen", () => {
    const longValue = "a".repeat(510);
    const result = validateRequiredTrimmedText(longValue, 500);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(500);
      expect(result.value).toBe("a".repeat(500));
    }
  });
});

// ---------------------------------------------------------------------------
// formatBudgetReferenceCents — Budgeting page prior-year reference columns
// (2026-07-28-budgeting-page-redesign, Increment 1)
// ---------------------------------------------------------------------------

describe("formatBudgetReferenceCents", () => {
  it("renders null as an em dash (no prior-year data)", () => {
    expect(formatBudgetReferenceCents(null)).toBe("—");
  });

  it("renders zero as $0.00, not a dash (a deliberate $0 prior budget/actual)", () => {
    expect(formatBudgetReferenceCents(0)).toBe("$0.00");
  });

  it("formats a positive cents value as dollars", () => {
    expect(formatBudgetReferenceCents(123_456)).toBe("$1234.56");
  });

  it("formats a negative cents value with a leading minus sign", () => {
    expect(formatBudgetReferenceCents(-5000)).toBe("-$50.00");
  });
});

// ---------------------------------------------------------------------------
// causeLineReferenceKey / buildCauseActualsByKey — Prior-Year Reference on
// Cause/Beneficiary Budget Lines (2026-07-28-causeline-prior-year-reference)
// ---------------------------------------------------------------------------

describe("causeLineReferenceKey", () => {
  it("trims leading/trailing whitespace the same way normalizeBudgetLineLabel does — ' WARM ' and 'WARM' collide", () => {
    expect(causeLineReferenceKey("cat-1", "Charitable donation out", " WARM ")).toBe(
      causeLineReferenceKey("cat-1", "Charitable donation out", "WARM"),
    );
  });

  it("does not case-fold — 'WARM' and 'Warm' remain distinct keys (free text, not a taxonomy)", () => {
    expect(causeLineReferenceKey("cat-1", "Charitable donation out", "WARM")).not.toBe(
      causeLineReferenceKey("cat-1", "Charitable donation out", "Warm"),
    );
  });

  it("null/undefined normalize to the generic/unlabeled ('') slot, same key as an explicit ''", () => {
    const generic = causeLineReferenceKey("cat-1", "Youth & Education", "");
    expect(causeLineReferenceKey("cat-1", "Youth & Education", null)).toBe(generic);
    expect(causeLineReferenceKey("cat-1", "Youth & Education", undefined)).toBe(generic);
  });

  it("folds categoryId into the key — the same cause+label in two different categories are distinct keys", () => {
    expect(causeLineReferenceKey("cat-1", "Youth & Education", "WARM")).not.toBe(
      causeLineReferenceKey("cat-2", "Youth & Education", "WARM"),
    );
  });
});

describe("buildCauseActualsByKey", () => {
  it("a cause line's label matching a prior-year party gets that party's summed actual", () => {
    const rows: CauseActualSourceRow[] = [
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: "WARM", amountCents: 5_000 },
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: "WARM", amountCents: 2_500 },
    ];
    const map = buildCauseActualsByKey(rows);
    const key = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "WARM");
    expect(map[key]).toBe(7_500);
  });

  it("a label with no matching prior-year party has no entry — caller reads this as null (no prior actual)", () => {
    const rows: CauseActualSourceRow[] = [
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: "WARM", amountCents: 5_000 },
    ];
    const map = buildCauseActualsByKey(rows);
    const key = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "Caring & Sharing");
    expect(map[key]).toBeUndefined();
  });

  it("case/trim normalization matches causeLineReferenceKey's: ' WARM ' as a party and 'WARM' as a label collide", () => {
    const rows: CauseActualSourceRow[] = [
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: " WARM ", amountCents: 1_000 },
    ];
    const map = buildCauseActualsByKey(rows);
    const key = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "WARM");
    expect(map[key]).toBe(1_000);
  });

  it("the generic/unlabeled line (label '') matches only null/blank-party actuals, not every party under that cause", () => {
    const rows: CauseActualSourceRow[] = [
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: null, amountCents: 3_000 },
      { categoryId: "cat-1", cause: "Hunger & Basic Needs", party: "WARM", amountCents: 5_000 },
    ];
    const map = buildCauseActualsByKey(rows);
    const genericKey = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "");
    const warmKey = causeLineReferenceKey("cat-1", "Hunger & Basic Needs", "WARM");
    expect(map[genericKey]).toBe(3_000);
    expect(map[warmKey]).toBe(5_000);
  });

  it("different categories with the same (cause, party) never collide", () => {
    const rows: CauseActualSourceRow[] = [
      { categoryId: "cat-1", cause: "Youth & Education", party: "WARM", amountCents: 1_000 },
      { categoryId: "cat-2", cause: "Youth & Education", party: "WARM", amountCents: 9_000 },
    ];
    const map = buildCauseActualsByKey(rows);
    expect(map[causeLineReferenceKey("cat-1", "Youth & Education", "WARM")]).toBe(1_000);
    expect(map[causeLineReferenceKey("cat-2", "Youth & Education", "WARM")]).toBe(9_000);
  });

  it("returns {} (not a throw) for zero rows", () => {
    expect(buildCauseActualsByKey([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// isValidBudgetCause — Cause-Tagged Budget Line Items (B-17 Increment A)
// ---------------------------------------------------------------------------

describe("isValidBudgetCause", () => {
  it("accepts each of the BUDGET_CAUSES values", () => {
    for (const cause of BUDGET_CAUSES) {
      expect(isValidBudgetCause(cause)).toBe(true);
    }
  });

  it("accepts OTHER_COMMUNITY_SUPPORT_CAUSE", () => {
    expect(isValidBudgetCause(OTHER_COMMUNITY_SUPPORT_CAUSE)).toBe(true);
  });

  it("rejects an arbitrary string", () => {
    expect(isValidBudgetCause("Not a real cause")).toBe(false);
  });

  it("rejects 'Fundraising event costs' specifically (dropped taxonomy value)", () => {
    expect(isValidBudgetCause("Fundraising event costs")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidBudgetCause("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OTHER_COMMUNITY_SUPPORT_CAUSE byte-identity — DECISION-045 "re-exported, not re-typed"
// ---------------------------------------------------------------------------

describe("OTHER_COMMUNITY_SUPPORT_CAUSE byte-identity", () => {
  it("equals the literal 'Other community support'", () => {
    expect(OTHER_COMMUNITY_SUPPORT_CAUSE).toBe("Other community support");
  });

  it("is === bucketGivingByCause()'s null-cause causeLabel output", () => {
    const rows: GivingFoldRow[] = [
      {
        id: "t1",
        txnDate: "2026-01-01",
        amountCents: 5_000,
        beneficiaryCause: null,
        party: "Some Payee",
        publicNote: null,
      },
    ];
    const result = bucketGivingByCause(rows);
    expect(result).toHaveLength(1);
    expect(result[0].causeLabel).toBe(OTHER_COMMUNITY_SUPPORT_CAUSE);
    // Not just equal in value — provably the same const, guarding against
    // a future edit re-introducing a second, driftable copy of the literal.
    expect(result[0].causeLabel === OTHER_COMMUNITY_SUPPORT_CAUSE).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isCauseEligibleCategory — Cause-Tagged Budget Line Items (B-17 Increment A)
// ---------------------------------------------------------------------------

describe("isCauseEligibleCategory", () => {
  it("returns true for an expense category with countsAsGiving true", () => {
    expect(isCauseEligibleCategory({ flow: "expense", countsAsGiving: true })).toBe(true);
  });

  it("returns false for an income-flow category", () => {
    expect(isCauseEligibleCategory({ flow: "income", countsAsGiving: true })).toBe(false);
  });

  it("returns false for an expense category with countsAsGiving false", () => {
    expect(isCauseEligibleCategory({ flow: "expense", countsAsGiving: false })).toBe(false);
  });

  it("returns false for an expense category with countsAsGiving null", () => {
    expect(isCauseEligibleCategory({ flow: "expense", countsAsGiving: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sumBudgetCauseLines — Cause-Tagged Budget Line Items (B-17 Increment A)
// ---------------------------------------------------------------------------

describe("sumBudgetCauseLines", () => {
  it("sums a list of amountCents correctly", () => {
    expect(
      sumBudgetCauseLines([{ amountCents: 1_000 }, { amountCents: 2_500 }, { amountCents: 500 }]),
    ).toBe(4_000);
  });

  it("returns 0 for an empty list", () => {
    expect(sumBudgetCauseLines([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveCauseSeedLines — Cause-Tagged Budget Line Items (B-17 Increment A)
// ---------------------------------------------------------------------------

describe("deriveCauseSeedLines", () => {
  it("most-recent-FY tie-break: a cause in both lookback years with different amounts proposes the more-recent year's amount", () => {
    const rows: CauseSeedSourceRow[] = [
      { cause: "Youth & Education", amountCents: 10_000, fiscalYear: 2024 },
      { cause: "Youth & Education", amountCents: 15_000, fiscalYear: 2025 },
    ];
    const result = deriveCauseSeedLines(rows, new Map());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cause: "Youth & Education",
      amountCents: 15_000,
      sourceFiscalYear: 2025,
    });
  });

  it("union across years: a cause present only in the older year, and one present only in the newer year, are both proposed", () => {
    const rows: CauseSeedSourceRow[] = [
      { cause: "Disaster Relief", amountCents: 5_000, fiscalYear: 2024 },
      { cause: "Hunger & Basic Needs", amountCents: 7_500, fiscalYear: 2025 },
    ];
    const result = deriveCauseSeedLines(rows, new Map());
    expect(result).toHaveLength(2);
    const byCause = new Map(result.map((r) => [r.cause, r]));
    expect(byCause.get("Disaster Relief")).toMatchObject({ amountCents: 5_000, sourceFiscalYear: 2024 });
    expect(byCause.get("Hunger & Basic Needs")).toMatchObject({ amountCents: 7_500, sourceFiscalYear: 2025 });
  });

  it("collision flagging: a proposed cause matching existingCauseAmountMap is flagged collision:true with the existing amount", () => {
    const rows: CauseSeedSourceRow[] = [
      { cause: "Vision & Eye Care", amountCents: 3_000, fiscalYear: 2025 },
    ];
    const existing = new Map([["Vision & Eye Care", 9_999]]);
    const result = deriveCauseSeedLines(rows, existing);
    expect(result).toHaveLength(1);
    expect(result[0].collision).toBe(true);
    expect(result[0].existingAmountCents).toBe(9_999);
  });

  it("collision flagging: a cause with no existing entry is collision:false with existingAmountCents null", () => {
    const rows: CauseSeedSourceRow[] = [
      { cause: "Community & Civic", amountCents: 2_000, fiscalYear: 2025 },
    ];
    const result = deriveCauseSeedLines(rows, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].collision).toBe(false);
    expect(result[0].existingAmountCents).toBeNull();
  });

  it("returns [] (not a throw) for zero rows in both lookback years", () => {
    expect(deriveCauseSeedLines([], new Map())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeBudgetLineLabel — Labeled Cause Budget Lines (DECISION-047/048)
// ---------------------------------------------------------------------------

describe("normalizeBudgetLineLabel", () => {
  it("trims leading/trailing whitespace: ' WARM ' and 'WARM' normalize identically", () => {
    expect(normalizeBudgetLineLabel(" WARM ")).toBe("WARM");
    expect(normalizeBudgetLineLabel(" WARM ")).toBe(normalizeBudgetLineLabel("WARM"));
  });

  it("an all-whitespace input normalizes to ''", () => {
    expect(normalizeBudgetLineLabel("   ")).toBe("");
    expect(normalizeBudgetLineLabel("\t\n")).toBe("");
  });

  it("null/undefined normalize to ''", () => {
    expect(normalizeBudgetLineLabel(null)).toBe("");
    expect(normalizeBudgetLineLabel(undefined)).toBe("");
  });

  it("does not case-fold — 'WARM' and 'Warm' remain distinct (free text, not a taxonomy)", () => {
    expect(normalizeBudgetLineLabel("WARM")).toBe("WARM");
    expect(normalizeBudgetLineLabel("Warm")).toBe("Warm");
    expect(normalizeBudgetLineLabel("WARM")).not.toBe(normalizeBudgetLineLabel("Warm"));
  });

  it("does not throw on an over-length input — the pure helper only trims; the caller enforces MAX_BUDGET_LINE_LABEL_LENGTH", () => {
    const overLong = "x".repeat(200);
    expect(() => normalizeBudgetLineLabel(overLong)).not.toThrow();
    expect(normalizeBudgetLineLabel(overLong)).toHaveLength(200);
    expect(MAX_BUDGET_LINE_LABEL_LENGTH).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// resolveBudgetLineDeleteAction — Budget soft-delete (Increment 2, Phase 3 test #6)
// ---------------------------------------------------------------------------

describe("resolveBudgetLineDeleteAction", () => {
  it("blank value + existing row -> \"soft-delete\"", () => {
    expect(resolveBudgetLineDeleteAction(true, "")).toBe("soft-delete");
  });

  it("whitespace-only value + existing row -> \"soft-delete\" (trims before checking)", () => {
    expect(resolveBudgetLineDeleteAction(true, "   ")).toBe("soft-delete");
  });

  it("blank value + no existing row -> \"noop\" (nothing to soft-delete)", () => {
    expect(resolveBudgetLineDeleteAction(false, "")).toBe("noop");
  });

  it("non-blank value + existing row -> \"noop\" (unreachable via the blur handler today, but the contract holds)", () => {
    expect(resolveBudgetLineDeleteAction(true, "50")).toBe("noop");
  });

  it("non-blank value + no existing row -> \"noop\"", () => {
    expect(resolveBudgetLineDeleteAction(false, "50")).toBe("noop");
  });
});

// ---------------------------------------------------------------------------
// isCauseLineLive — Budgeting Page Restructure (DECISION-054/056)
// ---------------------------------------------------------------------------

describe("isCauseLineLive", () => {
  it("both flags null -> live", () => {
    expect(isCauseLineLive(null, null)).toBe(true);
  });

  it("own flag set, parent null -> dead", () => {
    expect(isCauseLineLive("2026-07-29T00:00:00.000Z", null)).toBe(false);
  });

  it("parent flag set, own null -> dead", () => {
    expect(isCauseLineLive(null, "2026-07-29T00:00:00.000Z")).toBe(false);
  });

  it("both flags set -> dead", () => {
    expect(
      isCauseLineLive("2026-07-29T00:00:00.000Z", "2026-07-28T00:00:00.000Z"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeFundLineSums — Budget soft-delete (Increment 2, Phase 3 test #8);
// third parameter added by the Budgeting Page Restructure (DECISION-054
// item 2)
// ---------------------------------------------------------------------------

describe("computeFundLineSums", () => {
  it("sums income and expense lines with no pending-delete keys", () => {
    const result = computeFundLineSums({
      cat1_income: 10_000,
      cat2_income: 5_000,
      cat3_expense: 7_500,
    });
    expect(result).toEqual({ incomeCents: 15_000, expenseCents: 7_500 });
  });

  it("excludes a pending-delete income line from incomeCents", () => {
    const result = computeFundLineSums(
      { cat1_income: 10_000, cat2_income: 5_000 },
      { cat1_income: true },
    );
    expect(result.incomeCents).toBe(5_000);
  });

  it("excludes a pending-delete expense line from expenseCents", () => {
    const result = computeFundLineSums(
      { cat1_expense: 7_500, cat2_expense: 2_500 },
      { cat1_expense: true },
    );
    expect(result.expenseCents).toBe(2_500);
  });

  it("a line marked pendingDelete: false is included normally", () => {
    const result = computeFundLineSums(
      { cat1_income: 10_000 },
      { cat1_income: false },
    );
    expect(result.incomeCents).toBe(10_000);
  });

  it("empty lineValues returns zero for both totals", () => {
    expect(computeFundLineSums({})).toEqual({ incomeCents: 0, expenseCents: 0 });
  });

  it("pendingDeleteKeys defaults to {} when omitted", () => {
    expect(computeFundLineSums({ cat1_income: 100 })).toEqual({
      incomeCents: 100,
      expenseCents: 0,
    });
  });

  it("causeLinePendingCents defaults to {} when omitted — a category with no cause-line-grain pending amounts is unchanged", () => {
    const result = computeFundLineSums(
      { cat1_expense: 7_500 },
      { cat1_expense: false },
    );
    expect(result.expenseCents).toBe(7_500);
  });

  it("subtracts a partial cause-line-grain pending amount from a still-live category's rolled-up total", () => {
    const result = computeFundLineSums(
      { cat1_expense: 10_000 },
      {}, // category itself is NOT pending-delete
      { cat1_expense: 4_000 }, // one cause line under it, independently pending-delete
    );
    expect(result.expenseCents).toBe(6_000);
  });

  it("a whole-category pendingDeleteKeys exclusion is not double-subtracted when the third param also has an entry for that key — the continue short-circuits before the subtraction line runs", () => {
    const result = computeFundLineSums(
      { cat1_expense: 10_000 },
      { cat1_expense: true }, // whole category is pending-delete
      { cat1_expense: 4_000 }, // would double-subtract if not short-circuited
    );
    // The category is excluded entirely (continue) — expenseCents is 0, not
    // -4,000 and not 6,000. The cause-line-grain map is irrelevant once the
    // whole category is already excluded.
    expect(result.expenseCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDuesTimingAdjustment — Budget-Balance Overview (2026-07-28)
// ---------------------------------------------------------------------------

describe("computeDuesTimingAdjustment", () => {
  it("a dues row received in FY2025 but FOR FY2026 is excluded from FY2025's adjusted income and counted in FY2026's", () => {
    const rows: DuesTimingSourceRow[] = [
      { txnDate: "2026-06-15", amountCents: 12_000, duesFiscalYear: 2026 },
    ];

    const fy2025 = computeDuesTimingAdjustment(rows, 2025);
    expect(fy2025.cashBasisDuesCents).toBe(12_000); // received (txnDate) inside FY2025
    expect(fy2025.adjustedDuesCents).toBe(0); // it's FOR FY2026, so excluded from FY2025's adjusted figure
    expect(fy2025.deltaCents).toBe(-12_000);

    const fy2026 = computeDuesTimingAdjustment(rows, 2026);
    expect(fy2026.cashBasisDuesCents).toBe(0); // not received (by txnDate) inside FY2026
    expect(fy2026.adjustedDuesCents).toBe(12_000); // it's FOR FY2026
    expect(fy2026.deltaCents).toBe(12_000);
  });

  it("a dues row received and FOR the same fiscal year nets to zero delta", () => {
    const rows: DuesTimingSourceRow[] = [
      { txnDate: "2026-08-01", amountCents: 12_000, duesFiscalYear: 2026 },
    ];
    const result = computeDuesTimingAdjustment(rows, 2026);
    expect(result.cashBasisDuesCents).toBe(12_000);
    expect(result.adjustedDuesCents).toBe(12_000);
    expect(result.deltaCents).toBe(0);
  });

  it("no rows at all -> all-zero adjustment (caller hides the block; not a crash)", () => {
    const result = computeDuesTimingAdjustment([], 2026);
    expect(result).toEqual({
      fiscalYear: 2026,
      cashBasisDuesCents: 0,
      adjustedDuesCents: 0,
      deltaCents: 0,
    });
  });

  it("multiple rows across FYs are grouped independently per fiscal year requested", () => {
    const rows: DuesTimingSourceRow[] = [
      { txnDate: "2026-06-01", amountCents: 12_000, duesFiscalYear: 2026 }, // early payment, received FY2025, for FY2026
      { txnDate: "2026-06-10", amountCents: 9_600, duesFiscalYear: 2026 }, // another early payment
      { txnDate: "2025-08-01", amountCents: 12_000, duesFiscalYear: 2025 }, // ordinary on-time payment, received & for FY2025
    ];

    const fy2025 = computeDuesTimingAdjustment(rows, 2025);
    // Cash basis: both June 2026 payments (txnDate in FY2025) + the on-time one = all three received in FY2025
    expect(fy2025.cashBasisDuesCents).toBe(12_000 + 9_600 + 12_000);
    // Adjusted: only the row actually FOR FY2025
    expect(fy2025.adjustedDuesCents).toBe(12_000);
    expect(fy2025.deltaCents).toBe(12_000 - (12_000 + 9_600 + 12_000));

    const fy2026 = computeDuesTimingAdjustment(rows, 2026);
    expect(fy2026.cashBasisDuesCents).toBe(0); // nothing dated inside FY2026
    expect(fy2026.adjustedDuesCents).toBe(12_000 + 9_600); // both early payments are FOR FY2026
    expect(fy2026.deltaCents).toBe(12_000 + 9_600);
  });

  it("a txnDate right at the FY boundary (July 1) is read as the new FY — no naive-UTC off-by-one", () => {
    const rows: DuesTimingSourceRow[] = [
      { txnDate: "2026-07-01", amountCents: 12_000, duesFiscalYear: 2026 },
    ];
    const fy2026 = computeDuesTimingAdjustment(rows, 2026);
    expect(fy2026.cashBasisDuesCents).toBe(12_000);
    const fy2025 = computeDuesTimingAdjustment(rows, 2025);
    expect(fy2025.cashBasisDuesCents).toBe(0);
  });

  it("a txnDate right before the FY boundary (June 30) is read as the prior FY", () => {
    const rows: DuesTimingSourceRow[] = [
      { txnDate: "2026-06-30", amountCents: 12_000, duesFiscalYear: 2025 },
    ];
    const fy2025 = computeDuesTimingAdjustment(rows, 2025);
    expect(fy2025.cashBasisDuesCents).toBe(12_000);
    expect(fy2025.adjustedDuesCents).toBe(12_000);
    expect(fy2025.deltaCents).toBe(0);
  });
});

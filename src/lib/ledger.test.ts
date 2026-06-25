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
  entityBalanceCents,
  grossReceiptsCents,
  budgetVariance,
  guardrails,
  computeDueDate,
  isFilingOverdue,
  type GuardrailsInput,
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

/** A clean baseline state — all checks should be silent (inc1 + inc2 + inc3). */
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
  },
  incomeWithoutParty: 0,
  cashDisbursements: 0,
  txnsWithoutReceipt: 0,
  // inc2 fields — all zero = no issues
  pendingDisbursements: 0,
  unreconciledPriorMonth: 0,
  firewallViolations: 0,
  // inc3 fields — safe defaults (empty history = no revocation check; 0 overdue)
  irsFilingHistory: [],
  overdueFilingCount: 0,
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
  },
  incomeWithoutParty: 0,
  cashDisbursements: 0,
  txnsWithoutReceipt: 0,
  pendingDisbursements: 0,
  unreconciledPriorMonth: 0,
  firewallViolations: 0,
  irsFilingHistory: [],
  overdueFilingCount: 0,
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

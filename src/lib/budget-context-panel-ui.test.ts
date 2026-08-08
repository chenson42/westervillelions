import { describe, it, expect } from "vitest";
import {
  deriveFiscalYearFromTxnDate,
  isResponseCurrent,
  computeBudgetFigures,
  isOverBudgetWarn,
  formatGrainCopy,
  formatCauseLineLabel,
} from "./budget-context-panel-ui";

// Phase 3 named test 8: Projected = current (postedCents + pendingCents) +
// in-progress amountCents, via budgetVariance() — asserted against a fixed
// baseline and a range of amountCents inputs.
describe("computeBudgetFigures — test 8 (projected arithmetic)", () => {
  it("current reflects posted + pending only, ignoring amountCents", () => {
    const { current } = computeBudgetFigures(70_000, 42_000, 15_000, 45_000);
    // budgetVariance(actual=57000, budget=70000) => varianceCents = 13000
    expect(current.varianceCents).toBe(13_000);
  });

  it("projected adds amountCents on top of posted + pending", () => {
    const { projected } = computeBudgetFigures(70_000, 42_000, 15_000, 45_000);
    // actual = 57000 + 45000 = 102000; variance = 70000 - 102000 = -32000
    expect(projected).not.toBeNull();
    expect(projected!.varianceCents).toBe(-32_000);
  });

  it.each([
    [1_000, 70_000 - 58_000],
    [13_000, 70_000 - 70_000],
    [50_000, 70_000 - 107_000],
  ])("projected varies correctly across a range of amountCents (%d)", (amountCents, expectedVariance) => {
    const { projected } = computeBudgetFigures(70_000, 42_000, 15_000, amountCents);
    expect(projected!.varianceCents).toBe(expectedVariance);
  });

  it("no-budget-set (null) produces a fully null current and projected result", () => {
    const { current, projected } = computeBudgetFigures(null, 5_000, 0, 1_000);
    expect(current.varianceCents).toBeNull();
    expect(current.pct).toBeNull();
    expect(projected!.varianceCents).toBeNull();
  });
});

// Phase 3 named test 9: amountCents === null (empty, "0", non-numeric)
// suppresses the projected clause entirely rather than showing "+$0."
describe("formatGrainCopy — test 9 (suppressed projection)", () => {
  it("amountCents === null suppresses the projected clause", () => {
    const copy = formatGrainCopy("expense", 2026, 70_000, 42_000, 15_000, null);
    expect(copy.projectedClause).toBeNull();
    expect(copy.primary).toContain("$570.00 of $700.00 used");
  });

  it("a valid positive amountCents produces a projected clause", () => {
    const copy = formatGrainCopy("expense", 2026, 70_000, 42_000, 0, 5_000);
    expect(copy.projectedClause).toBe("→ $470.00 after this one.");
  });

  it("computeBudgetFigures treats amountCents <= 0 the same as null (defensive)", () => {
    const { projected } = computeBudgetFigures(70_000, 42_000, 0, 0);
    expect(projected).toBeNull();
  });
});

// Phase 3 named test 10: income flow renders "received"/"expected" copy,
// never "used"/"budgeted".
describe("formatGrainCopy — test 10 (income vs. expense framing)", () => {
  it("income flow uses 'received', never 'used' or 'budgeted'", () => {
    const copy = formatGrainCopy("income", 2026, 500_000, 320_000, 0, null);
    expect(copy.primary).toContain("received");
    expect(copy.primary).not.toContain("used");
    expect(copy.primary).not.toContain("budgeted");
  });

  it("expense flow uses 'used', never 'received'", () => {
    const copy = formatGrainCopy("expense", 2026, 70_000, 42_000, 0, null);
    expect(copy.primary).toContain("used");
    expect(copy.primary).not.toContain("received");
  });

  it("income projected clause reads 'after this gift', expense reads 'after this one'", () => {
    const income = formatGrainCopy("income", 2026, 500_000, 320_000, 0, 45_000);
    const expense = formatGrainCopy("expense", 2026, 70_000, 42_000, 0, 5_000);
    expect(income.projectedClause).toContain("after this gift");
    expect(expense.projectedClause).toContain("after this one");
  });

  it("income never warns even when projected exceeds the budget (exceeding income is good news)", () => {
    const figures = computeBudgetFigures(500_000, 480_000, 0, 100_000);
    expect(figures.projected!.varianceCents).toBeLessThan(0);
    expect(isOverBudgetWarn("income", figures)).toBe(false);
    const copy = formatGrainCopy("income", 2026, 500_000, 480_000, 0, 100_000);
    expect(copy.warn).toBe(false);
  });

  it("expense warns when the most-advanced figure is over budget", () => {
    const figures = computeBudgetFigures(70_000, 65_000, 0, 10_000);
    expect(isOverBudgetWarn("expense", figures)).toBe(true);
    const copy = formatGrainCopy("expense", 2026, 70_000, 65_000, 0, 10_000);
    expect(copy.warn).toBe(true);
  });

  it("no-budget-set state never warns, regardless of activity", () => {
    const copy = formatGrainCopy("expense", 2026, null, 999_999, 0, null);
    expect(copy.warn).toBe(false);
    expect(copy.primary).not.toContain("over");
  });
});

// Phase 3 named test 11: FY-derivation — a txnDate before July 1 resolves to
// the prior calendar year's FY, and changing txnDate within the same derived
// FY does not change the fetch key.
describe("deriveFiscalYearFromTxnDate — test 11 (FY derivation)", () => {
  it("a date before July 1 resolves to the prior calendar year's FY", () => {
    expect(deriveFiscalYearFromTxnDate("2026-06-30")).toBe(2025);
  });

  it("a date on/after July 1 resolves to the current calendar year's FY", () => {
    expect(deriveFiscalYearFromTxnDate("2026-07-01")).toBe(2026);
  });

  it("two dates within the same fiscal year derive the same FY (no refetch key change)", () => {
    expect(deriveFiscalYearFromTxnDate("2026-08-01")).toBe(
      deriveFiscalYearFromTxnDate("2026-12-15"),
    );
    expect(deriveFiscalYearFromTxnDate("2027-06-30")).toBe(
      deriveFiscalYearFromTxnDate("2026-08-01"),
    );
  });

  it("crossing the FY boundary changes the derived FY", () => {
    expect(deriveFiscalYearFromTxnDate("2026-06-30")).not.toBe(
      deriveFiscalYearFromTxnDate("2026-07-01"),
    );
  });

  it("empty or unparseable txnDate returns null", () => {
    expect(deriveFiscalYearFromTxnDate("")).toBeNull();
    expect(deriveFiscalYearFromTxnDate("not-a-date")).toBeNull();
  });
});

// Phase 3 named test 12: stale-response guard — a response whose fiscalYear
// no longer matches the current derivedFiscalYear prop at resolution time is
// never committed to displayed state.
describe("isResponseCurrent — test 12 (FY-boundary race guard)", () => {
  it("accepts a response whose fiscalYear matches the current derived FY", () => {
    expect(isResponseCurrent(2026, 2026)).toBe(true);
  });

  it("rejects a response whose fiscalYear no longer matches (the back-date race)", () => {
    // Treasurer requested FY2026, then quickly back-dated into FY2025 before
    // the FY2026 request resolved — the late response must be discarded.
    expect(isResponseCurrent(2026, 2025)).toBe(false);
  });

  it("rejects when the current derived FY is null (date field cleared mid-flight)", () => {
    expect(isResponseCurrent(2026, null)).toBe(false);
  });
});

describe("formatCauseLineLabel", () => {
  it("appends the label when present", () => {
    expect(formatCauseLineLabel("Rudolph Run", "Race shirts")).toBe("Rudolph Run — Race shirts");
  });

  it("falls back to the cause alone when label is blank", () => {
    expect(formatCauseLineLabel("Rudolph Run", "")).toBe("Rudolph Run");
  });
});

import { describe, it, expect } from "vitest";
import {
  splitCsvLine,
  validateChaseCsvHeader,
  parseChaseCsvRow,
  bankLineDedupeKey,
  computeTieOut,
  validatePeriodOverlap,
  computePeriodGapWarning,
  computeSelectionSummary,
  type ChaseCsvColumnIndex,
} from "./reconciliation";

// Full, correctly-ordered Chase header, used as the base fixture for
// row-parsing tests below.
const FULL_HEADER = ["Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"];

function headerColumnIndex(): ChaseCsvColumnIndex {
  const result = validateChaseCsvHeader(FULL_HEADER);
  if (!result.valid) throw new Error("test fixture header should be valid");
  return result.columnIndex;
}

describe("splitCsvLine", () => {
  it("splits a simple unquoted line", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(splitCsvLine('01/02/2025,"Payment, Inc.",-45.00')).toEqual([
      "01/02/2025",
      "Payment, Inc.",
      "-45.00",
    ]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    expect(splitCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });
});

describe("validateChaseCsvHeader", () => {
  it("1. valid full header", () => {
    const result = validateChaseCsvHeader(FULL_HEADER);
    expect(result.valid).toBe(true);
  });

  it("2. missing Posting Date names that column specifically", () => {
    const result = validateChaseCsvHeader(["Description", "Amount", "Type", "Balance", "Check or Slip #"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Posting Date");
    }
  });

  it("3. missing Check or Slip # names that column specifically", () => {
    const result = validateChaseCsvHeader(["Posting Date", "Description", "Amount", "Type", "Balance"]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Check or Slip #");
    }
  });

  it("4. header columns reordered is still valid (order-independent)", () => {
    const result = validateChaseCsvHeader([
      "Check or Slip #",
      "Balance",
      "Type",
      "Amount",
      "Description",
      "Posting Date",
    ]);
    expect(result.valid).toBe(true);
  });

  it("5. whitespace/case variance is still valid (trim + case-insensitive)", () => {
    const result = validateChaseCsvHeader([
      " posting date ",
      "DESCRIPTION",
      "  Amount",
      "type ",
      "Balance",
      "check or slip #",
    ]);
    expect(result.valid).toBe(true);
  });
});

describe("parseChaseCsvRow", () => {
  const columnIndex = headerColumnIndex();

  it("6. debit row, '-45.00' parses to amountCents: -4500", () => {
    const result = parseChaseCsvRow(
      ["01/15/2025", "Check #1234", "-45.00", "CHECK_PAID", "1000.00", "1234"],
      columnIndex,
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.amountCents).toBe(-4500);
  });

  it("7. credit row, '1,234.56' parses comma-thousands to amountCents: 123456", () => {
    const result = parseChaseCsvRow(
      ["01/16/2025", "Zeffy Payout", "1,234.56", "ACH_CREDIT", "2234.56", ""],
      columnIndex,
      2,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.amountCents).toBe(123456);
  });

  it("8. blank Check or Slip # parses to null, not empty string", () => {
    const result = parseChaseCsvRow(
      ["01/17/2025", "Bank fee", "-5.00", "FEE", "2229.56", ""],
      columnIndex,
      3,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.checkOrSlipNumber).toBeNull();
  });

  it('9. Check or Slip # = "DEP" on a credit row is stored verbatim, no rejection', () => {
    const result = parseChaseCsvRow(
      ["01/18/2025", "Deposit", "500.00", "DEPOSIT", "2729.56", "DEP"],
      columnIndex,
      4,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.checkOrSlipNumber).toBe("DEP");
  });

  it("10. unparseable Amount ('N/A') returns a named row-level error, not a thrown exception or silent 0", () => {
    const result = parseChaseCsvRow(
      ["01/19/2025", "Mystery row", "N/A", "OTHER", "2729.56", ""],
      columnIndex,
      5,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rowNumber).toBe(5);
      expect(result.error).toContain("N/A");
      expect(result.error).toContain("Row 5");
    }
  });
});

describe("bankLineDedupeKey", () => {
  it("11. same inputs produce the same key (determinism)", () => {
    const row = {
      postingDate: "2025-01-15",
      description: "Check #1234",
      amountCents: -4500,
      checkOrSlipNumber: "1234",
    };
    expect(bankLineDedupeKey(row)).toBe(bankLineDedupeKey({ ...row }));
  });

  it("12. differing checkOrSlipNumber (null vs 'DEP') with identical date/description/amount produces different keys", () => {
    const base = {
      postingDate: "2025-01-18",
      description: "Deposit",
      amountCents: 50000,
    };
    const keyA = bankLineDedupeKey({ ...base, checkOrSlipNumber: null });
    const keyB = bankLineDedupeKey({ ...base, checkOrSlipNumber: "DEP" });
    expect(keyA).not.toBe(keyB);
  });

  it("13. identical date/description/amount/check rows get distinct keys by occurrenceIndex (five same-day 'REMOTE ONLINE DEPOSIT # 1' lines)", () => {
    const row = {
      postingDate: "2025-08-07",
      description: "REMOTE ONLINE DEPOSIT # 1",
      amountCents: 10000,
      checkOrSlipNumber: null,
    };
    const keys = [0, 1, 2, 3, 4].map((i) => bankLineDedupeKey(row, i));
    expect(new Set(keys).size).toBe(5);
  });

  it("14. occurrenceIndex defaults to 0, matching the retry-of-the-same-upload case", () => {
    const row = {
      postingDate: "2025-01-18",
      description: "Deposit",
      amountCents: 50000,
      checkOrSlipNumber: null,
    };
    expect(bankLineDedupeKey(row)).toBe(bankLineDedupeKey(row, 0));
  });
});

describe("computeTieOut", () => {
  it("13. exact balance is balanced with zero delta", () => {
    const result = computeTieOut({
      openingBalanceCents: 100000,
      closingBalanceCents: 105000,
      matchedLineAmountsCents: [10000, -5000],
    });
    expect(result.balanced).toBe(true);
    expect(result.deltaCents).toBe(0);
  });

  it("14. off by one cent is unbalanced, deltaCents: 1 (positive = stated closing exceeds computed)", () => {
    const result = computeTieOut({
      openingBalanceCents: 100000,
      closingBalanceCents: 105001,
      matchedLineAmountsCents: [10000, -5000],
    });
    expect(result.balanced).toBe(false);
    expect(result.deltaCents).toBe(1);
  });

  it("15. zero matched lines, opening === closing is balanced (no cleared activity this period)", () => {
    const result = computeTieOut({
      openingBalanceCents: 250000,
      closingBalanceCents: 250000,
      matchedLineAmountsCents: [],
    });
    expect(result.balanced).toBe(true);
    expect(result.deltaCents).toBe(0);
  });
});

describe("validatePeriodOverlap", () => {
  it("16. back-to-back periods (existing.end === new.start - 1 day) do not overlap", () => {
    const result = validatePeriodOverlap(
      { start: "2025-07-01", end: "2025-07-31" },
      [{ id: "s1", start: "2025-06-01", end: "2025-06-30" }],
    );
    expect(result.overlap).toBe(false);
  });

  it("17. new period fully inside an existing session's period overlaps, names the conflicting period", () => {
    const result = validatePeriodOverlap(
      { start: "2025-07-10", end: "2025-07-15" },
      [{ id: "s1", start: "2025-07-01", end: "2025-07-31" }],
    );
    expect(result.overlap).toBe(true);
    if (result.overlap) {
      expect(result.conflictingSessionId).toBe("s1");
      expect(result.conflictingPeriod).toEqual({ start: "2025-07-01", end: "2025-07-31" });
    }
  });

  it("18. partial overlap (new starts inside, ends after, an existing period) overlaps", () => {
    const result = validatePeriodOverlap(
      { start: "2025-07-20", end: "2025-08-10" },
      [{ id: "s1", start: "2025-07-01", end: "2025-07-31" }],
    );
    expect(result.overlap).toBe(true);
  });

  it("19. boundary case: new.start === existing.end (shared single day) is an overlap", () => {
    const result = validatePeriodOverlap(
      { start: "2025-07-31", end: "2025-08-31" },
      [{ id: "s1", start: "2025-07-01", end: "2025-07-31" }],
    );
    expect(result.overlap).toBe(true);
  });
});

describe("computePeriodGapWarning", () => {
  it("20. new.start === priorPeriodEnd + 1 day returns null (perfectly contiguous)", () => {
    expect(computePeriodGapWarning("2025-07-01", "2025-06-30")).toBeNull();
  });

  it("21. new.start more than one day after priorPeriodEnd returns a warning naming the gap length", () => {
    const warning = computePeriodGapWarning("2025-08-01", "2025-06-30");
    expect(warning).not.toBeNull();
    expect(warning).toContain("31-day gap");
  });

  it("22. priorPeriodEnd === null (first-ever session for this account) returns null", () => {
    expect(computePeriodGapWarning("2025-07-01", null)).toBeNull();
  });
});

describe("computeSelectionSummary", () => {
  it("23. a batch of income rows summing exactly to a credit bank line is balanced", () => {
    const result = computeSelectionSummary(
      [
        { flow: "income", amountCents: 57600 },
        { flow: "income", amountCents: 12000 },
      ],
      69600,
    );
    expect(result.selectedSumCents).toBe(69600);
    expect(result.deltaCents).toBe(0);
    expect(result.balanced).toBe(true);
  });

  it("24. short by a cent yields a positive deltaCents and is not balanced", () => {
    const result = computeSelectionSummary([{ flow: "income", amountCents: 69599 }], 69600);
    expect(result.deltaCents).toBe(1);
    expect(result.balanced).toBe(false);
  });

  it("25. over by a cent yields a negative deltaCents and is not balanced", () => {
    const result = computeSelectionSummary([{ flow: "income", amountCents: 69601 }], 69600);
    expect(result.deltaCents).toBe(-1);
    expect(result.balanced).toBe(false);
  });

  it("26. a batch of expense rows sums (signed negative) exactly to a debit bank line", () => {
    const result = computeSelectionSummary(
      [
        { flow: "expense", amountCents: 4000 },
        { flow: "expense", amountCents: 2500 },
      ],
      -6500,
    );
    expect(result.selectedSumCents).toBe(-6500);
    expect(result.balanced).toBe(true);
  });

  it("27. an empty selection against a non-zero bank line is unbalanced with the full amount as delta", () => {
    const result = computeSelectionSummary([], 69600);
    expect(result.selectedSumCents).toBe(0);
    expect(result.deltaCents).toBe(69600);
    expect(result.balanced).toBe(false);
  });

  it("28. a heterogeneous income+expense batch nets correctly against a credit line", () => {
    const result = computeSelectionSummary(
      [
        { flow: "income", amountCents: 10000 },
        { flow: "expense", amountCents: 2000 },
      ],
      8000,
    );
    expect(result.selectedSumCents).toBe(8000);
    expect(result.balanced).toBe(true);
  });
});

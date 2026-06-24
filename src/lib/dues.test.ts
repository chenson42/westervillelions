import { describe, it, expect } from "vitest";
import {
  getFiscalYear,
  currentFiscalYear,
  fiscalYearLabel,
  deriveStatus,
} from "./dues";

// ── getFiscalYear ─────────────────────────────────────────────────────────────

describe("getFiscalYear", () => {
  it("Jun 30 belongs to the prior FY (last day before rollover)", () => {
    // Jun 30 2026 → FY2025 (Jul 2025 – Jun 2026)
    expect(getFiscalYear(new Date(2026, 5, 30))).toBe(2025);
  });

  it("Jul 1 belongs to the new FY (first day after rollover)", () => {
    // Jul 1 2026 → FY2026 (Jul 2026 – Jun 2027)
    expect(getFiscalYear(new Date(2026, 6, 1))).toBe(2026);
  });

  it("Jan 1 belongs to the prior FY", () => {
    // Jan 1 2026 → FY2025
    expect(getFiscalYear(new Date(2026, 0, 1))).toBe(2025);
  });

  it("Dec 31 belongs to the same FY as Jul 1 of that year", () => {
    // Dec 31 2026 → FY2026
    expect(getFiscalYear(new Date(2026, 11, 31))).toBe(2026);
  });

  it("Jul 1 of year 2025 → FY2025", () => {
    expect(getFiscalYear(new Date(2025, 6, 1))).toBe(2025);
  });

  it("Jun 30 of year 2025 → FY2024", () => {
    expect(getFiscalYear(new Date(2025, 5, 30))).toBe(2024);
  });

  it("mid-year January → prior FY", () => {
    // Jan 15 2027 → FY2026
    expect(getFiscalYear(new Date(2027, 0, 15))).toBe(2026);
  });

  it("mid-year August → current FY", () => {
    // Aug 15 2026 → FY2026
    expect(getFiscalYear(new Date(2026, 7, 15))).toBe(2026);
  });
});

// ── currentFiscalYear ─────────────────────────────────────────────────────────

describe("currentFiscalYear", () => {
  it("delegates to getFiscalYear with the provided date", () => {
    expect(currentFiscalYear(new Date(2026, 6, 1))).toBe(2026);
    expect(currentFiscalYear(new Date(2026, 5, 30))).toBe(2025);
  });
});

// ── fiscalYearLabel ───────────────────────────────────────────────────────────

describe("fiscalYearLabel", () => {
  it("formats FY2026 correctly", () => {
    expect(fiscalYearLabel(2026)).toBe("FY2026 (Jul 2026 – Jun 2027)");
  });

  it("formats FY2025 correctly", () => {
    expect(fiscalYearLabel(2025)).toBe("FY2025 (Jul 2025 – Jun 2026)");
  });

  it("handles an early year without error", () => {
    expect(fiscalYearLabel(2000)).toBe("FY2000 (Jul 2000 – Jun 2001)");
  });
});

// ── deriveStatus ──────────────────────────────────────────────────────────────

describe("deriveStatus", () => {
  it("returns 'unpaid' when total is zero", () => {
    expect(deriveStatus(0, 12000)).toBe("unpaid");
  });

  it("returns 'unpaid' when total is negative (net refund)", () => {
    expect(deriveStatus(-500, 12000)).toBe("unpaid");
  });

  it("returns 'unpaid' when expectedCents is zero (not configured)", () => {
    expect(deriveStatus(5000, 0)).toBe("unpaid");
  });

  it("returns 'unpaid' when expectedCents is negative (invalid config)", () => {
    expect(deriveStatus(5000, -100)).toBe("unpaid");
  });

  it("returns 'partial' when total is positive but less than expected", () => {
    expect(deriveStatus(6000, 12000)).toBe("partial");
  });

  it("returns 'partial' when total is exactly 1 cent below expected", () => {
    expect(deriveStatus(11999, 12000)).toBe("partial");
  });

  it("returns 'paid' when total exactly equals expected", () => {
    expect(deriveStatus(12000, 12000)).toBe("paid");
  });

  it("returns 'paid' when total exceeds expected (overpayment)", () => {
    expect(deriveStatus(15000, 12000)).toBe("paid");
  });

  it("handles the family rate correctly — partial", () => {
    expect(deriveStatus(4800, 9600)).toBe("partial");
  });

  it("handles the family rate correctly — paid", () => {
    expect(deriveStatus(9600, 9600)).toBe("paid");
  });

  it("returns 'unpaid' when total is 1 cent and expected is 1 cent (edge)", () => {
    expect(deriveStatus(1, 1)).toBe("paid");
  });
});

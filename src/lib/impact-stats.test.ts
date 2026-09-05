/**
 * Unit tests for the pure impact-stats helpers behind Site Review Fixes
 * Batch 5 (docs/work-log/2026-09-04-site-review-fixes.md). No DB.
 */

import { describe, it, expect } from "vitest";
import {
  getRecentCompletedFiscalYears,
  roundDownToThousand,
  formatImpactAmount,
} from "./impact-stats";

describe("getRecentCompletedFiscalYears", () => {
  it("excludes the in-progress current FY (mid-fiscal-year date)", () => {
    // 2026-09-04 → current FY2026 (Jul 2026–Jun 2027, in progress)
    expect(getRecentCompletedFiscalYears(new Date(2026, 8, 4))).toEqual([2024, 2025]);
  });

  it("handles a date early in the calendar year (Jan–Jun belongs to the prior start-year FY)", () => {
    // 2026-03-15 → FY2025 (Jan–Jun 2026 belongs to FY2025 = Jul 2025–Jun 2026)
    expect(getRecentCompletedFiscalYears(new Date(2026, 2, 15))).toEqual([2023, 2024]);
  });

  it("handles the FY boundary itself (Jul 1 rolls into the new FY)", () => {
    expect(getRecentCompletedFiscalYears(new Date(2026, 6, 1))).toEqual([2024, 2025]);
  });

  it("handles Jun 30 (last day of the prior FY)", () => {
    expect(getRecentCompletedFiscalYears(new Date(2026, 5, 30))).toEqual([2023, 2024]);
  });
});

describe("roundDownToThousand", () => {
  it("rounds a real mixed-cents total down to the nearest $1,000", () => {
    // $60,350.00 (34,125 + 26,225 from the FY2024/FY2025 giving totals)
    expect(roundDownToThousand(6_035_000)).toBe(60_000);
  });

  it("never rounds up, even one cent below the next thousand", () => {
    // $999,999.99 in cents
    expect(roundDownToThousand(99_999_999)).toBe(999_000);
  });

  it("rounds an exact thousand to itself", () => {
    expect(roundDownToThousand(60_000_00)).toBe(60_000);
  });

  it("rounds zero to zero", () => {
    expect(roundDownToThousand(0)).toBe(0);
  });

  it("rounds an amount under $1,000 down to zero", () => {
    expect(roundDownToThousand(50_000)).toBe(0);
  });
});

describe("formatImpactAmount", () => {
  it("formats with thousands separators and a trailing +", () => {
    expect(formatImpactAmount(60_000)).toBe("$60,000+");
    expect(formatImpactAmount(1_000_000)).toBe("$1,000,000+");
  });

  it("formats zero", () => {
    expect(formatImpactAmount(0)).toBe("$0+");
  });
});

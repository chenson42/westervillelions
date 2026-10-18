import { describe, it, expect } from "vitest";
import { sumDeductibleGiving } from "./ledger-donor-giving";

describe("sumDeductibleGiving", () => {
  it("sums only gifts to a tax-deductible entity", () => {
    expect(
      sumDeductibleGiving([
        { amountCents: 10000, entityDonationsDeductible: true },
        { amountCents: 5000, entityDonationsDeductible: false },
        { amountCents: 2500, entityDonationsDeductible: true },
      ]),
    ).toBe(12500);
  });
  it("a donor with only Public Funds gifts totals zero; no rows totals zero", () => {
    expect(sumDeductibleGiving([{ amountCents: 9900, entityDonationsDeductible: false }])).toBe(0);
    expect(sumDeductibleGiving([])).toBe(0);
  });
});

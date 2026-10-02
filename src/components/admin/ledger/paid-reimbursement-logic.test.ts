/** T44 (Paid tab): the "Needs bank account" badge and repair-button rules. */

import { describe, it, expect } from "vitest";
import { paidRowNeedsBankAccount, paidRowRepairAction } from "./paid-reimbursement-logic";

const paid = (over: Record<string, unknown> = {}) => ({
  id: "t",
  bankAccountId: null as string | null,
  bankAccountName: null as string | null,
  checkNumber: null as string | null,
  reconciled: false,
  ...over,
});

describe("paidRowNeedsBankAccount", () => {
  it("is true only for a linked entry with no account that is not reconciled", () => {
    expect(paidRowNeedsBankAccount(paid())).toBe(true);
    expect(paidRowNeedsBankAccount(paid({ bankAccountId: "a", bankAccountName: "Checking" }))).toBe(false);
    expect(paidRowNeedsBankAccount(paid({ reconciled: true }))).toBe(false);
    expect(paidRowNeedsBankAccount(null)).toBe(false);
  });
});

describe("paidRowRepairAction", () => {
  it("shows the button to a recorder, a self note on the viewer's own request, nothing without record access", () => {
    expect(paidRowRepairAction({ paidTransaction: paid(), isSelf: false, canRecord: true })).toBe("button");
    expect(paidRowRepairAction({ paidTransaction: paid(), isSelf: true, canRecord: true })).toBe("self");
    expect(paidRowRepairAction({ paidTransaction: paid(), isSelf: false, canRecord: false })).toBe("none");
    expect(
      paidRowRepairAction({ paidTransaction: paid({ bankAccountId: "a" }), isSelf: false, canRecord: true }),
    ).toBe("none");
  });
});

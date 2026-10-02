/** T38: Mark Paid dialog rules (B-108 / DECISION-114). DOM-less. */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHECK_NUMBER_MAX_LEN,
  PAY_DESCRIPTION_LABEL,
  PAY_NO_BANK_ACCOUNT_MESSAGE,
  bankAccountsForEntity,
  buildPayBody,
  isPaySubmittable,
  resolveBankAccountId,
  type PayBankAccountOption,
} from "./pay-reimbursement-dialog-logic";
import { CHECK_NUMBER_MAX_LEN as SHARED_MAX } from "@/lib/ledger";

const CLUB = "e0000000-0000-4000-8000-000000000001";
const FOUNDATION = "e0000000-0000-4000-8000-000000000002";

function acct(id: string, entityId: string, over: Partial<PayBankAccountOption> = {}): PayBankAccountOption {
  return { id, entityId, name: id, isDefault: false, isActive: true, ...over };
}
const clubChecking = acct("club-checking", CLUB, { isDefault: true });
const clubSavings = acct("club-savings", CLUB);
const foundationOnly = acct("foundation-checking", FOUNDATION);
const accounts = [clubChecking, clubSavings, foundationOnly];

describe("bank account choice", () => {
  it("lists only the selected entity's active accounts", () => {
    expect(bankAccountsForEntity(accounts, CLUB).map((a) => a.id)).toEqual([
      "club-checking",
      "club-savings",
    ]);
    expect(bankAccountsForEntity([acct("x", CLUB, { isActive: false })], CLUB)).toEqual([]);
    expect(bankAccountsForEntity(accounts, null)).toEqual([]);
  });

  it("preselects the entity default, or the sole account", () => {
    expect(resolveBankAccountId(accounts, CLUB, "")).toBe("club-checking");
    expect(resolveBankAccountId(accounts, FOUNDATION, "")).toBe("foundation-checking");
  });

  it("leaves it blank when several accounts and no default (the user must choose)", () => {
    const two = [acct("a", CLUB), acct("b", CLUB)];
    expect(resolveBankAccountId(two, CLUB, "")).toBe("");
  });

  it("re-evaluates when the fund changes entity: a still-valid choice is kept, an invalid one replaced", () => {
    expect(resolveBankAccountId(accounts, CLUB, "club-savings")).toBe("club-savings");
    // Switching to the Foundation: the Club account is no longer valid.
    expect(resolveBankAccountId(accounts, FOUNDATION, "club-savings")).toBe("foundation-checking");
  });

  it("an entity with no active account yields no choice and blocks submit", () => {
    expect(resolveBankAccountId(accounts, "other-entity", "")).toBe("");
    expect(PAY_NO_BANK_ACCOUNT_MESSAGE).toMatch(/Add a bank account/);
    expect(
      isPaySubmittable({
        fundId: "f",
        categoryId: "c",
        bankAccountId: "",
        entityHasBankAccount: false,
        submitting: false,
      }),
    ).toBe(false);
  });
});

describe("isPaySubmittable", () => {
  const base = {
    fundId: "f",
    categoryId: "c",
    bankAccountId: "a",
    entityHasBankAccount: true,
    submitting: false,
  };
  it("needs fund, category and bank account, and not while submitting", () => {
    expect(isPaySubmittable(base)).toBe(true);
    expect(isPaySubmittable({ ...base, fundId: "" })).toBe(false);
    expect(isPaySubmittable({ ...base, categoryId: "" })).toBe(false);
    expect(isPaySubmittable({ ...base, bankAccountId: "" })).toBe(false);
    expect(isPaySubmittable({ ...base, submitting: true })).toBe(false);
  });
});

describe("buildPayBody", () => {
  const input = {
    fundId: "f",
    categoryId: "c",
    budgetLineId: "",
    paymentDate: "2026-09-30",
    paymentMethod: "check",
    bankAccountId: "a",
    checkNumber: " 8249 ",
    description: "  Supplies for the fall drive ",
    amountCents: 2500,
    updatedAt: "2026-09-30T12:00:00.000Z",
  };

  it("carries the bank account, the trimmed check number for Check, and the register description as the note", () => {
    const body = buildPayBody(input);
    expect(body).toMatchObject({
      action: "pay",
      bankAccountId: "a",
      checkNumber: "8249",
      note: "Supplies for the fall drive",
      budgetLineId: null,
      expectedAmountCents: 2500,
      expectedUpdatedAt: "2026-09-30T12:00:00.000Z",
    });
  });

  it("sends the check number only for Check", () => {
    expect(buildPayBody({ ...input, paymentMethod: "cash" })).not.toHaveProperty("checkNumber");
    expect(buildPayBody({ ...input, paymentMethod: "other" })).not.toHaveProperty("checkNumber");
  });

  it("omits a blank check number, and a blank description (the server falls back to the member's)", () => {
    const body = buildPayBody({ ...input, checkNumber: "  ", description: " " });
    expect(body).not.toHaveProperty("checkNumber");
    expect(body.note).toBeUndefined();
  });
});

describe("pay dialog source", () => {
  const src = readFileSync(join(__dirname, "pay-reimbursement-dialog.tsx"), "utf8");

  it("uses the shared check-number limit, never a literal", () => {
    expect(CHECK_NUMBER_MAX_LEN).toBe(SHARED_MAX);
    expect(src).toContain("maxLength={CHECK_NUMBER_MAX_LEN}");
    expect(src).not.toMatch(/maxLength=\{20\}/);
  });

  it("renames Note to Register description, pre-filled with the member's description", () => {
    expect(PAY_DESCRIPTION_LABEL).toBe("Register description");
    expect(src).toContain("{PAY_DESCRIPTION_LABEL}");
    expect(src).toContain("useState(description)");
    expect(src).not.toContain(">Note ");
  });

  it("preselects through the shared default picker and filters to the fund's entity", () => {
    expect(src).toContain("resolveBankAccountId(");
    expect(src).toContain("bankAccountsForEntity(");
  });

  it("never uses a native dialog", () => {
    expect(src).not.toMatch(/window\.(confirm|alert|prompt)\(|\b(confirm|alert|prompt)\(/);
  });
});

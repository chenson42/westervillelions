/**
 * Pure helpers for the Mark Paid dialog (B-108 / DECISION-114, T38). Kept out of
 * the component so the bank-account choice and the request body are testable
 * without a DOM.
 */

import {
  CHECK_NUMBER_MAX_LEN,
  pickDefaultBankAccount,
  type ReimbursementPaymentMethod,
} from "@/lib/ledger";
import { MEMO_MAX_LEN } from "@/lib/ledger-reimbursement-correction";

export { CHECK_NUMBER_MAX_LEN, MEMO_MAX_LEN };

/** The label of the field that used to be "Note" (the register memo). */
export const PAY_DESCRIPTION_LABEL = "Register description";

export const PAY_DESCRIPTION_HELP =
  "This is what the register shows. It starts as what the member wrote; edit it if the register should read differently.";

export const PAY_BANK_ACCOUNT_HELP = "Choose the account the money came out of.";

export const PAY_NO_BANK_ACCOUNT_MESSAGE =
  "Add a bank account for this entity in Ledger settings before paying.";

export interface PayBankAccountOption {
  id: string;
  entityId: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
}

/** Active accounts belonging to the selected fund's entity. */
export function bankAccountsForEntity<T extends PayBankAccountOption>(
  accounts: readonly T[],
  entityId: string | null | undefined,
): T[] {
  if (!entityId) return [];
  return accounts.filter((a) => a.entityId === entityId && a.isActive);
}

/**
 * The account id the dialog should hold after the fund (and so possibly the
 * entity) changed: a still-valid current choice is kept, otherwise the default
 * (the sole active account, else the flagged default), otherwise "" so the
 * treasurer must choose.
 */
export function resolveBankAccountId<T extends PayBankAccountOption>(
  accounts: readonly T[],
  entityId: string | null | undefined,
  current: string,
): string {
  const options = bankAccountsForEntity(accounts, entityId);
  if (current && options.some((a) => a.id === current)) return current;
  return pickDefaultBankAccount(options)?.id ?? "";
}

export interface PayBodyInput {
  fundId: string;
  categoryId: string;
  budgetLineId: string;
  paymentDate: string;
  paymentMethod: ReimbursementPaymentMethod | string;
  bankAccountId: string;
  checkNumber: string;
  description: string;
  amountCents: number;
  updatedAt: string;
}

/**
 * The PATCH body for `action: "pay"`. The check number is sent only for Check
 * (a cash payment has none); a blank description is omitted so the server falls
 * back to the member's description.
 */
export function buildPayBody(input: PayBodyInput): Record<string, unknown> {
  const description = input.description.trim();
  const body: Record<string, unknown> = {
    action: "pay",
    fundId: input.fundId,
    categoryId: input.categoryId,
    budgetLineId: input.budgetLineId || null,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    bankAccountId: input.bankAccountId,
    note: description || undefined,
    expectedAmountCents: input.amountCents,
    expectedUpdatedAt: input.updatedAt,
  };
  if (input.paymentMethod === "check") {
    const check = input.checkNumber.trim();
    if (check) body.checkNumber = check;
  }
  return body;
}

export function isPaySubmittable(input: {
  fundId: string;
  categoryId: string;
  bankAccountId: string;
  entityHasBankAccount: boolean;
  submitting: boolean;
}): boolean {
  return Boolean(
    input.fundId &&
      input.categoryId &&
      input.bankAccountId &&
      input.entityHasBankAccount &&
      !input.submitting,
  );
}

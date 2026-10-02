/**
 * Paid-tab rules (B-108 / DECISION-114, T44), pure so the page's badge and
 * button logic is testable without rendering a server page.
 */

import type { ReimbursementAdminRow } from "@/lib/ledger-queries";

type PaidTransaction = ReimbursementAdminRow["paidTransaction"];

/**
 * A paid row "needs a bank account" when its ledger entry has none and is not
 * reconciled (a null-account row can never have been matched, so it is repairable).
 */
export function paidRowNeedsBankAccount(paidTransaction: PaidTransaction): boolean {
  return Boolean(
    paidTransaction && paidTransaction.bankAccountId === null && !paidTransaction.reconciled,
  );
}

/**
 * What the Actions cell shows for a paid row that needs a bank account:
 * "button" for a reviewer who may repair it, "self" when the viewer submitted the
 * request (another reviewer must repair it), "none" otherwise.
 */
export function paidRowRepairAction(input: {
  paidTransaction: PaidTransaction;
  isSelf: boolean;
  canRecord: boolean;
}): "button" | "self" | "none" {
  if (!paidRowNeedsBankAccount(input.paidTransaction)) return "none";
  if (!input.canRecord) return "none";
  return input.isSelf ? "self" : "button";
}

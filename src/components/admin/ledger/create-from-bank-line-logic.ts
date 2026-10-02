/**
 * Pure rules for the duplicate guard in the create-from-bank-line dialog
 * (B-108 / DECISION-114, T41). A paid reimbursement of the same amount may
 * already record the payment; creating a new entry would count it twice.
 */

import type { CreateFromBankLineCandidate } from "@/lib/ledger-reimbursement-correction";

export const OWN_REQUEST_REASON =
  "You submitted this request, so another reviewer must work with it.";

export const DIFFERENT_PAYMENT_LABEL = "This is a different payment";

/** The advisory applies to an expense with at least one candidate. */
export function hasDuplicateCandidates(
  flow: "income" | "expense",
  candidates: readonly CreateFromBankLineCandidate[],
): boolean {
  return flow === "expense" && candidates.length > 0;
}

/** "Create & Match" is held back until the user ticks the acknowledgment. */
export function isCreateBlockedByDuplicate(input: {
  flow: "income" | "expense";
  candidates: readonly CreateFromBankLineCandidate[];
  acknowledged: boolean;
}): boolean {
  return hasDuplicateCandidates(input.flow, input.candidates) && !input.acknowledged;
}

/**
 * `acknowledgeDuplicate` rides the POST only when there is something to
 * acknowledge AND the box was ticked. The server checks regardless (a stale
 * dialog or a direct call cannot bypass it).
 */
export function acknowledgeFlag(input: {
  flow: "income" | "expense";
  candidates: readonly CreateFromBankLineCandidate[];
  acknowledged: boolean;
}): { acknowledgeDuplicate: true } | Record<string, never> {
  return hasDuplicateCandidates(input.flow, input.candidates) && input.acknowledged
    ? { acknowledgeDuplicate: true }
    : {};
}

/**
 * What "Use that entry instead" does for a candidate: repair it first when it
 * has no bank account (then it can match), otherwise go straight to matching.
 * Disabled, with the reason, when the caller submitted the request.
 */
export function offerInsteadAction(
  candidate: Pick<CreateFromBankLineCandidate, "needsBankAccount" | "ownRequest">,
): { kind: "repair" | "match"; disabledReason: string | null } {
  return {
    kind: candidate.needsBankAccount ? "repair" : "match",
    disabledReason: candidate.ownRequest ? OWN_REQUEST_REASON : null,
  };
}

/** The line a candidate is described by, e.g. "$25.00 on 2026-09-30 to Pat Member". */
export function candidateHeadline(
  candidate: Pick<CreateFromBankLineCandidate, "amountCents" | "txnDate" | "party">,
  formatDate: (iso: string) => string,
): string {
  const dollars = `$${(Math.abs(candidate.amountCents) / 100).toFixed(2)}`;
  return `A paid reimbursement of ${dollars} on ${formatDate(candidate.txnDate)}${
    candidate.party ? ` to ${candidate.party}` : ""
  }`;
}

/** The discoverability hint's candidate: a needs-bank-account one, if any. */
export function pickerHintCandidate(
  candidates: readonly CreateFromBankLineCandidate[],
): CreateFromBankLineCandidate | null {
  return candidates.find((c) => c.needsBankAccount) ?? null;
}

/**
 * The match picker's discoverability hint applies to a debit line whose list has
 * no expense row of the same amount: a paid reimbursement with no bank account
 * is not in the list, and nothing else would tell the treasurer why.
 */
export function pickerNeedsHintLookup(
  bankLine: { amountCents: number },
  candidateTransactions: readonly { flow: string; amountCents: number }[],
): boolean {
  if (bankLine.amountCents >= 0) return false;
  const want = Math.abs(bankLine.amountCents);
  return !candidateTransactions.some((t) => t.flow === "expense" && t.amountCents === want);
}

/** The picker's one-line hint. */
export function pickerHintText(
  candidate: Pick<CreateFromBankLineCandidate, "amountCents" | "party">,
): string {
  const dollars = `$${(Math.abs(candidate.amountCents) / 100).toFixed(2)}`;
  return `A paid reimbursement of ${dollars}${
    candidate.party ? ` to ${candidate.party}` : ""
  } has no bank account, so it is not in this list.`;
}

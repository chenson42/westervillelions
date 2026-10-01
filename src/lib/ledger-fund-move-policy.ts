/**
 * Directional allow-list for moving an EXISTING ledger row to another fund
 * (DECISION-109, docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * Pure, dependency-free, DB-free: takes primitive fund descriptors and returns
 * an allow/deny decision. Deny-by-default; the allow-list has exactly ONE cell
 * in v1: same entity, income, Administrative -> Activity. Every other cell is
 * its own `if` with its own reason, keyed on fund `kind` and entity identity
 * (never a UUID), so enabling another cell later (B-96) is a one-branch flip
 * with an existing unit-test slot.
 *
 * CROSS-REFERENCE (REQUIRED, DECISION-109 / architect R2c): this policy and
 * `checkTransferDirection()` in ./ledger-transfer-policy.ts answer DIFFERENT
 * questions and must NOT be merged or "reconciled":
 *   - checkTransferDirection(administrative -> activity) blocks a MOVEMENT OF
 *     VALUE ("the Activity Fund's income must stay publicly-sourced").
 *   - checkFundMove(income, administrative -> activity) allows a
 *     RECLASSIFICATION OF PROVENANCE ("this income was public all along; the
 *     Administrative booking was the error").
 * They intentionally differ on exactly that pair, and a unit test pins it.
 * A shared function would have to either open the transfer (wrong) or close
 * the move (defeats the feature).
 */

import type { FundRef } from "@/lib/ledger-transfer-policy";

export type FundMoveDenialCode =
  | "same_fund"
  | "cross_entity"
  | "expense_not_supported"
  | "away_from_public"
  | "not_permitted";

export type FundMoveResult =
  | { allowed: true }
  | { allowed: false; code: FundMoveDenialCode; reason: string };

function deny(code: FundMoveDenialCode, reason: string): FundMoveResult {
  return { allowed: false, code, reason };
}

/**
 * Decide whether a row of `flow` may be moved from fund `from` to fund `to`.
 * Status mapping for callers: `same_fund` is a 409, every other code a 403.
 */
export function checkFundMove(input: {
  flow: string;
  from: FundRef;
  to: FundRef;
}): FundMoveResult {
  const { flow, from, to } = input;

  if (from.fundId === to.fundId) {
    return deny("same_fund", "This entry is already in that fund.");
  }

  if (from.entityId !== to.entityId) {
    return deny(
      "cross_entity",
      "An entry can only be moved between funds of the same entity.",
    );
  }

  if (flow !== "income" && flow !== "expense") {
    return deny("not_permitted", "This entry cannot be moved to that fund.");
  }

  if (flow === "income") {
    if (from.kind === "administrative" && to.kind === "activity") {
      return { allowed: true };
    }
    if (from.kind === "activity" && to.kind === "administrative") {
      return deny(
        "away_from_public",
        "Public money cannot be moved into the Administrative Fund. The Activity Fund's income must stay publicly-sourced.",
      );
    }
    return deny("not_permitted", "Income cannot be moved between these funds.");
  }

  // flow === "expense"
  if (from.kind === "activity" && to.kind === "administrative") {
    // Its own branch (not folded into the catch-all) so enabling it later
    // (B-96) is a one-branch flip. Needs budget-line, publicNote and
    // beneficiaryCause handling first.
    return deny(
      "expense_not_supported",
      "Moving expenses between funds is not supported yet.",
    );
  }
  if (from.kind === "administrative" && to.kind === "activity") {
    return deny(
      "away_from_public",
      "A Club operating cost cannot be charged to the Activity Fund's public money.",
    );
  }
  return deny("not_permitted", "Expenses cannot be moved between these funds.");
}

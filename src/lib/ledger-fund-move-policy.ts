/**
 * Directional allow-list for moving an EXISTING ledger row to another fund
 * (DECISION-109, docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * Pure, dependency-free, DB-free: takes primitive fund descriptors and returns
 * an allow/deny decision. Deny-by-default; the allow-list has exactly TWO cells
 * (DECISION-112):
 *   1. same entity, income, Administrative -> Activity (DECISION-109);
 *   2. DIFFERENT entity, income, Charitable -> Activity (the Foundation gift
 *      whose cash landed in the Club's account).
 * Every other cell is its own `if` with its own reason, keyed on fund `kind`
 * and entity identity (never a UUID), so enabling another cell later (B-96,
 * B-104) is a one-branch flip with an existing unit-test slot.
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
 *
 * DECISION-112 adds the second divergence: charitable -> activity across
 * entities is ALLOWED here (a reclassification of provenance: the cash was
 * never in the Foundation's account) but DENIED by checkTransferDirection()
 * (the one-way valve: a movement of value). The cell the sweep owns
 * (activity -> charitable, cross-entity) is DENIED here as
 * `club_to_foundation_not_supported`: the sweep's board-minute is what gates
 * Club money reaching the Foundation, and a move must not be a way around it.
 * The mutual-exclusion test (no pair allowed by both policies) must stay green.
 */

import type { FundRef } from "@/lib/ledger-transfer-policy";

export type FundMoveDenialCode =
  | "same_fund"
  | "cross_entity"
  | "club_to_foundation_not_supported"
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
    // Cross-entity decision tree (DECISION-112). Only income may cross.
    if (flow !== "income") {
      return deny(
        "cross_entity",
        "An entry can only be moved between funds of the same entity.",
      );
    }
    if (from.kind === "charitable" && to.kind === "activity") {
      return { allowed: true };
    }
    if (from.kind === "charitable" && to.kind === "administrative") {
      return deny(
        "away_from_public",
        "Public money cannot be moved into the Administrative Fund.",
      );
    }
    if (
      (from.kind === "activity" || from.kind === "administrative") &&
      to.kind === "charitable"
    ) {
      // Its own branch: the sweep is the only crossing of Club money into the
      // Foundation (B-104 tracks a move for this direction).
      return deny(
        "club_to_foundation_not_supported",
        "A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register.",
      );
    }
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

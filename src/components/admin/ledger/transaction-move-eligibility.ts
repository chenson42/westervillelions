/**
 * Pure client-side decision for the register's "Move" button (Phase 3 D1).
 *
 * The button is OMITTED unless the row is a movable kind AND the entity has a
 * legal destination (decided by `checkFundMove()` over the page's own funds, so
 * enabling another cell later lights the button up with no UI change). It is
 * DISABLED with a reason only when the row is otherwise movable but the caller
 * lacks LEDGER_MANAGE for the row's tier. The server is still the authority;
 * this only decides what to show.
 */

import type { LedgerFund, LedgerTransaction } from "@/lib/db/schema";
import { checkFundMove } from "@/lib/ledger-fund-move-policy";
import { moveBlockKind, requiredMoveTier } from "@/lib/ledger-transaction-lock";
import { MANAGE_REQUIRED_MESSAGE } from "@/lib/ledger-correction";

export type MoveButtonState =
  | { kind: "omit" }
  | { kind: "enabled" }
  | { kind: "disabled"; reason: string };

type MoveRow = Pick<
  LedgerTransaction,
  | "entityId"
  | "fundId"
  | "flow"
  | "status"
  | "approvedAt"
  | "duesPaymentId"
  | "transferGroupId"
  | "reconciled"
  | "reconciledSessionId"
  | "txnDate"
>;

export function moveButtonState(input: {
  transaction: MoveRow;
  funds: Pick<LedgerFund, "id" | "entityId" | "kind">[];
  canManage: boolean;
  now: Date;
}): MoveButtonState {
  const { transaction, funds, canManage, now } = input;
  if (moveBlockKind(transaction) !== null) return { kind: "omit" };

  const from = funds.find((f) => f.id === transaction.fundId);
  if (!from) return { kind: "omit" };

  const hasDestination = funds.some(
    (to) =>
      to.id !== from.id &&
      checkFundMove({
        flow: transaction.flow,
        from: { entityId: from.entityId, fundId: from.id, kind: from.kind },
        to: { entityId: to.entityId, fundId: to.id, kind: to.kind },
      }).allowed,
  );
  if (!hasDestination) return { kind: "omit" };

  if (requiredMoveTier(transaction, now).tier === "manage" && !canManage) {
    return { kind: "disabled", reason: MANAGE_REQUIRED_MESSAGE };
  }
  return { kind: "enabled" };
}

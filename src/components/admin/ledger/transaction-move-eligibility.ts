/**
 * Pure client-side decision for the register's "Move" button (Phase 3 D1, and
 * X10 / Gap 12 for the cross-entity cell).
 *
 * The button is OMITTED unless the row is a movable kind AND some destination
 * is legal (decided by `checkFundMove()` over EVERY entity's funds, so enabling
 * another cell later lights the button up with no UI change). A cross-entity
 * destination counts only when its entity has an active bank account to receive
 * the money, and never for a row dated before the current fiscal year (that
 * refusal is certain, so a button would only lead to a dead end). A row held by
 * a closed reconciliation session keeps an enabled Move: the dialog explains
 * what to clear first. The button is DISABLED with a reason only when every
 * remaining destination needs a tier the caller lacks. The server is still the
 * authority; this only decides what to show.
 */

import type { LedgerFund, LedgerTransaction } from "@/lib/db/schema";
import { checkFundMove } from "@/lib/ledger-fund-move-policy";
import {
  crossEntityBlockKind,
  moveBlockKind,
  requiredMoveTier,
} from "@/lib/ledger-transaction-lock";
import {
  CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE,
  MANAGE_REQUIRED_MESSAGE,
} from "@/lib/ledger-correction";

/**
 * `crossEntityOnly` is set when every destination the button could open is on
 * the other entity (the register adds a "see Move to the Club" hint on a locked
 * row); it is absent otherwise.
 */
export type MoveButtonState =
  | { kind: "omit" }
  | { kind: "enabled"; crossEntityOnly?: true }
  | { kind: "disabled"; reason: string; crossEntityOnly?: true };

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
  /** EVERY entity's active funds (not just this register's). */
  funds: Pick<LedgerFund, "id" | "entityId" | "kind">[];
  /** Entities that have at least one active bank account. */
  entityIdsWithActiveBank: string[];
  canManage: boolean;
  now: Date;
}): MoveButtonState {
  const { transaction, funds, entityIdsWithActiveBank, canManage, now } = input;
  if (moveBlockKind(transaction) !== null) return { kind: "omit" };

  const from = funds.find((f) => f.id === transaction.fundId);
  if (!from) return { kind: "omit" };

  const priorYearBlocksCrossEntity =
    crossEntityBlockKind(transaction, now) === "prior_fiscal_year_cross_entity";

  const destinations = funds.filter((to) => {
    if (to.id === from.id) return false;
    const decision = checkFundMove({
      flow: transaction.flow,
      from: { entityId: from.entityId, fundId: from.id, kind: from.kind },
      to: { entityId: to.entityId, fundId: to.id, kind: to.kind },
    });
    if (!decision.allowed) return false;
    if (to.entityId === from.entityId) return true;
    return !priorYearBlocksCrossEntity && entityIdsWithActiveBank.includes(to.entityId);
  });
  if (destinations.length === 0) return { kind: "omit" };

  const crossEntityOnly = destinations.every((d) => d.entityId !== from.entityId);
  const hint = crossEntityOnly ? ({ crossEntityOnly: true } as const) : {};

  const reachable = destinations.some(
    (d) =>
      requiredMoveTier(transaction, now, { crossEntity: d.entityId !== from.entityId }).tier ===
        "record" || canManage,
  );
  if (!reachable) {
    return {
      kind: "disabled",
      reason: crossEntityOnly ? CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE : MANAGE_REQUIRED_MESSAGE,
      ...hint,
    };
  }
  return { kind: "enabled", ...hint };
}

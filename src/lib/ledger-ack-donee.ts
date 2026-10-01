/**
 * Shared "who issued this receipt" SQL fragment (DECISION-112, R1e).
 *
 * `ledger_acknowledgments.donee_entity_id` is the entity that issued the
 * receipt. It is NULL for rows not yet stamped, in which case the receipt was
 * issued by the entity of the transaction it acknowledges.
 *
 * RULE: a receipt follows its issuer; money follows the row.
 *   - Readers that DESCRIBE the receipt (letter composition, acknowledgment
 *     summaries/detail, the register's ack marker) join `ledger_entities` on
 *     `ackDoneeEntityId`.
 *   - Readers that SUM MONEY or gate on the row (pending/unlinked gift
 *     queues, compliance, 990, gross receipts, impact) keep joining the
 *     transaction's own entity.
 *
 * Do not re-type the COALESCE at a call site; import this.
 * Queries using it must join `ledger_transactions`.
 */

import { sql } from "drizzle-orm";
import { ledgerAcknowledgments, ledgerTransactions } from "@/lib/db/schema";

export const ackDoneeEntityId = sql<string>`coalesce(${ledgerAcknowledgments.doneeEntityId}, ${ledgerTransactions.entityId})`;

/**
 * True when a receipt was issued by a different entity than the one the
 * transaction row now belongs to. A NULL stamp is never "elsewhere".
 */
export function ackIssuedElsewhere(
  doneeEntityId: string | null,
  rowEntityId: string,
): boolean {
  return doneeEntityId !== null && doneeEntityId !== rowEntityId;
}

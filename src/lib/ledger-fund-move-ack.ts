/**
 * Acknowledgment settlement for a cross-entity move (DECISION-112 R1d,
 * DECISION-113 X1, docs/work-log/2026-10-01-cross-entity-transaction-move.md).
 *
 * A Club row cannot hold an acknowledgment (the acknowledge route refuses a
 * non-deductible entity), so when a Foundation income row moves to the Club:
 *   - a SENT acknowledgment is KEPT and stamped with the entity that issued it
 *     (write-once: `coalesce(donee_entity_id, <source entity>)`), so the receipt
 *     keeps naming its issuer and stays findable. `sent_at`, `sent_via`,
 *     `letter_text`, `letter_storage_key`, `donor_id` are NEVER written;
 *   - an UNSENT acknowledgment is REMOVED (pinned on `sent_at IS NULL`, the
 *     DECISION-108 pin) and reported;
 *   - no acknowledgment is `none`.
 *
 * Runs inside the move's transaction AFTER the row lock and BEFORE the pinned
 * UPDATE. The acknowledgment row is locked `FOR UPDATE`, so a concurrent email
 * claim either committed before our lock (we see `sent_at` and keep) or blocks
 * behind it and then finds no row (its claim UPDATE is pinned on `sent_at IS
 * NULL`). Writes no email and never writes `sent_at`: the move RETAINS an
 * existing "sent" claim, so `sendEmailForDurableClaim()` does not apply.
 *
 * Same-entity moves never call this (a Club row carries no acknowledgment), so
 * the v1.86.0 path never selects `ledger_acknowledgments`.
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ledgerAcknowledgments } from "@/lib/db/schema";

/** The transaction handle (or `db`). */
export type AckSettleExecutor = Pick<typeof db, "select" | "update" | "delete">;

export type AckOutcome = "none" | "kept" | "removed";

/** Pure decision: what a cross-entity move does with the row's acknowledgment. */
export function decideAckOutcome(input: { exists: boolean; sent: boolean }): AckOutcome {
  if (!input.exists) return "none";
  return input.sent ? "kept" : "removed";
}

export interface AckSettlement {
  outcome: AckOutcome;
  /** The acknowledgment as it stands after settlement (null for `none`). */
  ack: { id: string; sentAt: Date | null; doneeEntityId: string | null } | null;
}

export async function settleAcknowledgmentForMove(
  tx: AckSettleExecutor,
  args: { transactionId: string; sourceEntityId: string; now: Date },
): Promise<AckSettlement> {
  const rows = await tx
    .select({
      id: ledgerAcknowledgments.id,
      sentAt: ledgerAcknowledgments.sentAt,
      doneeEntityId: ledgerAcknowledgments.doneeEntityId,
    })
    .from(ledgerAcknowledgments)
    .where(eq(ledgerAcknowledgments.donationTxnId, args.transactionId))
    .for("update");
  const existing = rows[0];

  let outcome = decideAckOutcome({ exists: !!existing, sent: !!existing?.sentAt });
  if (!existing || outcome === "none") return { outcome: "none", ack: null };
  let sentAt: Date | null = existing.sentAt;

  if (outcome === "removed") {
    const deleted = await tx
      .delete(ledgerAcknowledgments)
      .where(and(eq(ledgerAcknowledgments.id, existing.id), isNull(ledgerAcknowledgments.sentAt)))
      .returning({ id: ledgerAcknowledgments.id });
    if (deleted.length > 0) {
      return {
        outcome: "removed",
        ack: { id: existing.id, sentAt: null, doneeEntityId: existing.doneeEntityId },
      };
    }
    // The row is locked, so zero rows means its status changed under us.
    // Re-read once and treat a now-sent acknowledgment as kept.
    const again = await tx
      .select({ sentAt: ledgerAcknowledgments.sentAt })
      .from(ledgerAcknowledgments)
      .where(eq(ledgerAcknowledgments.id, existing.id))
      .limit(1);
    if (!again[0]) return { outcome: "none", ack: null };
    outcome = "kept";
    sentAt = again[0].sentAt;
  }

  // kept: stamp the issuer. Write-once: an existing stamp is preserved by the
  // COALESCE, and ONLY these two columns are ever in this set object.
  await tx
    .update(ledgerAcknowledgments)
    .set({
      doneeEntityId: sql`coalesce(${ledgerAcknowledgments.doneeEntityId}, ${args.sourceEntityId})`,
      updatedAt: args.now,
    })
    .where(and(eq(ledgerAcknowledgments.id, existing.id), isNotNull(ledgerAcknowledgments.sentAt)));

  return {
    outcome: "kept",
    ack: {
      id: existing.id,
      sentAt,
      doneeEntityId: existing.doneeEntityId ?? args.sourceEntityId,
    },
  };
}

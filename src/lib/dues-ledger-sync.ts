/**
 * Dues → Ledger sync helpers (DECISION-025).
 *
 * This module is the cross-feature seam between the Dues feature and The Ledger.
 * Dependency direction: Dues → Ledger (the Ledger must NOT import from Dues).
 *
 * All three exported functions receive a Drizzle transaction client `tx` and
 * must be called INSIDE a `db.transaction()` block so dues write and ledger
 * write either both commit or both roll back.
 *
 * Best-effort carve-out: syncDuesCreate wraps its body in a try/catch that
 * absorbs application-logic errors (fund not found, member not found, etc.)
 * and returns { syncFailed: true } WITHOUT re-throwing — so the dues payment
 * still commits. Postgres serialization errors (codes 40001, 40P01) are
 * re-thrown so the outer transaction retries (not swallowed).
 *
 * syncDuesUpdate / syncDuesDelete do NOT use a carve-out because they operate
 * on a ledger row that is already known to exist (or not, which is a no-op).
 * Any unexpected error there should propagate normally.
 */

import { db } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  members,
} from "@/lib/db/schema";
import { eq, and, ilike } from "drizzle-orm";

// ---------------------------------------------------------------------------
// DrizzleTransaction type
// ---------------------------------------------------------------------------

// Inferred from db.transaction's callback parameter — avoids importing Drizzle internals.
type DrizzleTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// SyncResult
// ---------------------------------------------------------------------------

export type SyncResult = {
  /** true when the ledger auto-post failed for an application-logic reason (fund not found, etc.) */
  syncFailed?: true;
  /** true when a reconciled ledger row was flagged stale instead of being modified */
  syncStale?: true;
};

// ---------------------------------------------------------------------------
// syncDuesCreate
// ---------------------------------------------------------------------------

/**
 * Auto-post a new dues payment as a ledger income transaction.
 *
 * 1. Resolves Club entity (kind 501c4, slug 'club').
 * 2. Finds the Administrative fund for the Club entity (slug 'administrative').
 * 3. Finds the "Club dues" income category (or proceeds without one — graceful).
 * 4. Resolves member full name.
 * 5. Inserts a ledger_transactions row.
 *
 * Best-effort: if any step throws (missing fund, missing entity, insert fails for
 * application reasons), catches and returns { syncFailed: true } without re-throwing.
 * Postgres serialization errors (40001, 40P01) are re-thrown so retry logic is honored.
 *
 * @param tx                  Drizzle transaction client — must be inside db.transaction()
 * @param payment             Dues payment data from the dues insert
 * @param recordedByUserId    Session user ID of the treasurer recording the dues
 */
export async function syncDuesCreate(
  tx: DrizzleTransaction,
  payment: {
    id: string;
    memberId: string;
    amountCents: number;
    paymentDate: string;
    method: string;
    fiscalYear: number;
  },
  recordedByUserId: string,
): Promise<SyncResult> {
  try {
    // Step 1: Find the Club entity (501c4)
    const entityRows = await tx
      .select({ id: ledgerEntities.id })
      .from(ledgerEntities)
      .where(eq(ledgerEntities.slug, "club"))
      .limit(1);
    const clubEntity = entityRows[0];
    if (!clubEntity) {
      console.error("[dues-ledger-sync] syncDuesCreate: Club entity not found (slug='club')");
      return { syncFailed: true };
    }

    // Step 2: Find the Administrative fund for the Club entity
    const fundRows = await tx
      .select({ id: ledgerFunds.id })
      .from(ledgerFunds)
      .where(
        and(
          eq(ledgerFunds.entityId, clubEntity.id),
          eq(ledgerFunds.slug, "administrative"),
        ),
      )
      .limit(1);
    const adminFund = fundRows[0];
    if (!adminFund) {
      console.error("[dues-ledger-sync] syncDuesCreate: Administrative fund not found for Club entity");
      return { syncFailed: true };
    }

    // Step 3: Find the "Club dues" income category (graceful — use null if missing)
    const catRows = await tx
      .select({ id: ledgerCategories.id })
      .from(ledgerCategories)
      .where(
        and(
          eq(ledgerCategories.entityId, clubEntity.id),
          eq(ledgerCategories.fundKind, "administrative"),
          eq(ledgerCategories.flow, "income"),
          ilike(ledgerCategories.name, "club dues"),
        ),
      )
      .limit(1);
    const categoryId = catRows[0]?.id ?? null;

    // Step 4: Resolve member full name
    const memberRows = await tx
      .select({ firstName: members.firstName, lastName: members.lastName })
      .from(members)
      .where(eq(members.id, payment.memberId))
      .limit(1);
    const memberName = memberRows[0]
      ? `${memberRows[0].firstName} ${memberRows[0].lastName}`.trim()
      : "Unknown Member";

    // Step 5: Insert the ledger transaction
    await tx.insert(ledgerTransactions).values({
      entityId: clubEntity.id,
      fundId: adminFund.id,
      txnDate: payment.paymentDate,
      flow: "income",
      categoryId,
      amountCents: payment.amountCents,
      party: memberName,
      paymentMethod: payment.method,
      status: "posted",
      duesPaymentId: payment.id,
      syncStale: false,
      recordedByUserId,
    });

    return {};
  } catch (err: unknown) {
    // Re-throw Postgres serialization / deadlock errors so retry logic works
    if (isSerializationError(err)) {
      throw err;
    }
    // Absorb all other errors — dues payment still commits
    console.error("[dues-ledger-sync] syncDuesCreate: ledger auto-post failed:", err);
    return { syncFailed: true };
  }
}

// ---------------------------------------------------------------------------
// syncDuesUpdate
// ---------------------------------------------------------------------------

/**
 * Sync a dues payment edit to its linked ledger transaction.
 *
 * - If no linked row: no-op (dues created before inc 6a — no ledger row exists).
 * - If reconciled: set syncStale=true, do NOT touch financial fields.
 * - If not reconciled: update amount, date, paymentMethod to match the patch.
 */
export async function syncDuesUpdate(
  tx: DrizzleTransaction,
  paymentId: string,
  patch: {
    amountCents?: number;
    paymentDate?: string;
    method?: string;
  },
): Promise<SyncResult> {
  const rows = await tx
    .select({ id: ledgerTransactions.id, reconciled: ledgerTransactions.reconciled })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.duesPaymentId, paymentId))
    .limit(1);

  const linked = rows[0];
  if (!linked) {
    // Dues payment has no linked ledger row (created before inc 6a) — no-op
    return {};
  }

  if (linked.reconciled) {
    // Do NOT modify a reconciled row — flag it as stale for the treasurer to resolve
    await tx
      .update(ledgerTransactions)
      .set({ syncStale: true, updatedAt: new Date() })
      .where(eq(ledgerTransactions.id, linked.id));
    return { syncStale: true };
  }

  // Build the update — only apply fields present in the patch
  const updates: Partial<{
    amountCents: number;
    txnDate: string;
    paymentMethod: string;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (patch.amountCents !== undefined) updates.amountCents = patch.amountCents;
  if (patch.paymentDate !== undefined) updates.txnDate = patch.paymentDate;
  if (patch.method !== undefined) updates.paymentMethod = patch.method;

  await tx
    .update(ledgerTransactions)
    .set(updates)
    .where(eq(ledgerTransactions.id, linked.id));

  return {};
}

// ---------------------------------------------------------------------------
// syncDuesDelete
// ---------------------------------------------------------------------------

/**
 * Sync a dues payment delete to its linked ledger transaction.
 *
 * Must be called BEFORE the dues payment is deleted (so the `dues_payment_id`
 * FK is still queryable).
 *
 * - If no linked row: no-op.
 * - If reconciled: set syncStale=true (keep the row; it is part of the financial record).
 * - If not reconciled: hard-delete the ledger row.
 */
export async function syncDuesDelete(
  tx: DrizzleTransaction,
  paymentId: string,
): Promise<SyncResult> {
  const rows = await tx
    .select({ id: ledgerTransactions.id, reconciled: ledgerTransactions.reconciled })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.duesPaymentId, paymentId))
    .limit(1);

  const linked = rows[0];
  if (!linked) {
    // No linked ledger row — no-op
    return {};
  }

  if (linked.reconciled) {
    // Keep the reconciled row; mark it stale so the treasurer can resolve manually
    await tx
      .update(ledgerTransactions)
      .set({ syncStale: true, updatedAt: new Date() })
      .where(eq(ledgerTransactions.id, linked.id));
    return { syncStale: true };
  }

  // Hard-delete the unreconciled ledger row
  await tx.delete(ledgerTransactions).where(eq(ledgerTransactions.id, linked.id));
  return {};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the error is a Postgres serialization failure or deadlock.
 * These must be re-thrown from the best-effort catch in syncDuesCreate so the
 * outer transaction's retry logic can operate.
 */
function isSerializationError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    // 40001 = serialization_failure, 40P01 = deadlock_detected
    return code === "40001" || code === "40P01";
  }
  return false;
}

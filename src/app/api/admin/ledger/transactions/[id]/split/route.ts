/**
 * POST /api/admin/ledger/transactions/[id]/split
 *
 * Splits one unreconciled ledger transaction into two rows that sum to the
 * original — so each part can be matched 1:1 against the separate bank
 * lines it actually cleared as (e.g. a single Eventeny charge that posted
 * to the bank as two separate lines). Repeatable: a split part can be
 * split again, validated against its own CURRENT amount.
 *
 * Gate: LEDGER_RECORD (same gate as PATCH/DELETE on this table)
 *
 * DECISION (2026-07-29, docs/work-log/2026-07-29-ledger-transaction-split.md):
 * no `splitFromTransactionId` lineage column — relies on sum-preservation
 * only. No schema change.
 *
 * Guards (in order — mirrors the sibling PATCH/DELETE guard set plus one
 * new check specific to Split):
 *   1. approvedAt set          → 403, "Approved transactions cannot be split"
 *   2. status = 'rejected'     → 403, "Rejected transactions cannot be split"
 *   3. reconciledSessionId set → 403, closed-reconciliation-session message
 *      (matches PATCH/DELETE wording)
 *   4. reconciled === true     → 403, explicit check — a legacy per-row
 *      reconcile-toggle sets reconciled=true but CLEARS reconciledSessionId
 *      (DECISION-036), so guard 3 alone would miss it.
 *   5. matched to a bank line in ANY reconciliation session (open or
 *      closed) → 403, "This transaction is already matched to a bank line
 *      in an open reconciliation session — unmatch it before splitting."
 *      Uses `getMatchForTransaction`, which is unscoped to a single session
 *      (transactionId is UNIQUE across ledger_reconciliation_matches
 *      forever — DECISION-036), so this single check covers both open and
 *      closed sessions. In practice a closed-session match already implies
 *      `reconciled = true` (guard 4 fires first), so this guard's live
 *      effect is the open-session case Phase 1 flagged as load-bearing.
 *   6. transferGroupId set     → 403, "Transfer transactions can't be split"
 *      — a transfer is two linked rows sharing transferGroupId (DECISION-016);
 *      splitting one leg would break the pair's mirror-sum invariant.
 *
 * Body:
 * {
 *   amountCents: number; // positive integer, strictly < the row's CURRENT amountCents
 * }
 *
 * Effect (atomic, db.transaction):
 *   - INSERT a new ledger_transactions row with the split amountCents,
 *     inheriting every other field from the original (entityId, fundId,
 *     flow, categoryId, party, memo, beneficiaryCause, bankAccountId,
 *     checkNumber, paymentMethod, txnDate — same underlying charge, so the
 *     new part keeps the original's date). New row is always
 *     status='posted', reconciled=false, reconciledSessionId=null,
 *     approvedAt=null, recordedByUserId=the acting user.
 *   - UPDATE the original row, decrementing amountCents by the split
 *     amount in the same DB transaction.
 *
 * Responses:
 *   201 { id, originalAmountCents, newAmountCents } — new row id + both
 *        parts' resulting amounts, so the client can refresh without a
 *        second round trip.
 *   400 — invalid amountCents
 *   401 — not authenticated
 *   403 — forbidden (missing feature) or one of the guards above
 *   404 — transaction not found
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getMatchForTransaction } from "@/lib/reconciliation-queries";

const INT4_MAX = 2_147_483_647;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.ledgerTransactions.findFirst({
      where: eq(ledgerTransactions.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Guard 1 — approved transactions are immutable (mirrors PATCH/DELETE)
    if (existing.approvedAt) {
      return NextResponse.json(
        { error: "Approved transactions cannot be split" },
        { status: 403 },
      );
    }

    // Guard 2 — rejected transactions are immutable (preserves audit trail)
    if (existing.status === "rejected") {
      return NextResponse.json(
        { error: "Rejected transactions cannot be split" },
        { status: 403 },
      );
    }

    // Guard 3 — cleared by a closed reconciliation session (full lock)
    if (existing.reconciledSessionId) {
      return NextResponse.json(
        {
          error:
            "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row",
        },
        { status: 403 },
      );
    }

    // Guard 4 — explicit reconciled check (Phase 1 gap): a legacy per-row
    // reconcile toggle sets reconciled=true but CLEARS reconciledSessionId
    // (DECISION-036), so guard 3 alone would miss this case.
    if (existing.reconciled) {
      return NextResponse.json(
        { error: "Reconciled transactions cannot be split" },
        { status: 403 },
      );
    }

    // Guard 5 — already matched to a bank line in ANY reconciliation
    // session (open or closed). Splitting would decrement the original's
    // amountCents out from under an existing match, silently corrupting
    // that session's tie-out arithmetic.
    const existingMatch = await getMatchForTransaction(id);
    if (existingMatch) {
      return NextResponse.json(
        {
          error:
            "This transaction is already matched to a bank line in an open reconciliation session — unmatch it before splitting.",
        },
        { status: 403 },
      );
    }

    // Guard 6 — transfer legs cannot be split. A transfer is two linked rows
    // sharing transferGroupId (DECISION-016); decrementing one leg would break
    // the pair's mirror-sum invariant with no equivalent change to its mate,
    // silently corrupting the transfer. Edit or delete the transfer instead.
    if (existing.transferGroupId) {
      return NextResponse.json(
        { error: "Transfer transactions can't be split — edit or delete the transfer instead." },
        { status: 403 },
      );
    }

    const body = await request.json();
    const amountCents = body?.amountCents;

    if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json(
        { error: "Enter an amount greater than $0." },
        { status: 400 },
      );
    }
    if (amountCents > INT4_MAX) {
      return NextResponse.json(
        { error: `amountCents must not exceed ${INT4_MAX}` },
        { status: 400 },
      );
    }
    if (amountCents >= existing.amountCents) {
      return NextResponse.json(
        { error: "Split amount must be less than the transaction's current total." },
        { status: 400 },
      );
    }

    const newAmountCents = amountCents;
    const remainingAmountCents = existing.amountCents - amountCents;

    const newId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(ledgerTransactions)
        .values({
          entityId: existing.entityId,
          fundId: existing.fundId,
          bankAccountId: existing.bankAccountId,
          txnDate: existing.txnDate,
          flow: existing.flow,
          categoryId: existing.categoryId,
          amountCents: newAmountCents,
          party: existing.party,
          memo: existing.memo,
          beneficiaryCause: existing.beneficiaryCause,
          paymentMethod: existing.paymentMethod,
          checkNumber: existing.checkNumber,
          status: "posted",
          reconciled: false,
          recordedByUserId: session.user.id,
        })
        .returning({ id: ledgerTransactions.id });

      await tx
        .update(ledgerTransactions)
        .set({ amountCents: remainingAmountCents, updatedAt: new Date() })
        .where(eq(ledgerTransactions.id, id));

      return inserted[0].id;
    });

    return NextResponse.json(
      {
        id: newId,
        originalAmountCents: remainingAmountCents,
        newAmountCents,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error splitting ledger transaction:", error);
    return NextResponse.json({ error: "Failed to split transaction" }, { status: 500 });
  }
}

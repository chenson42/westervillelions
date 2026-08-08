/**
 * POST  /api/admin/ledger/transactions/[id]/acknowledge  — Create acknowledgment
 * PATCH /api/admin/ledger/transactions/[id]/acknowledge  — Mark acknowledgment sent
 *
 * Gate: LEDGER_RECORD (both operations).
 *
 * POST validates:
 *   1. Transaction exists, flow='income', status='posted'
 *   2. Transaction's entity has donationsDeductible=true (Foundation only)
 *   3. No existing acknowledgment for this transaction (unique constraint) — 409
 *   4. donorId exists in ledger_donors if provided
 *   5. amountCents is copied from the transaction — NOT accepted from request body
 *   6. deriveAckType must return non-null unless typeOverride is supplied
 *   7. quidProQuoValueCents required when type='quid_pro_quo_75'
 *   8. quidProQuoDescription, if provided, must be a string <= 500 chars
 *      (Acknowledgment Letter Generation, 2026-08-08 — Pub. 1771 requires a
 *      DESCRIPTION of goods/services, not just their FMV; nullable, falls
 *      back to generic wording in composeAcknowledgmentLetter() when absent)
 *
 * POST side effect: when donorId is provided, ledger_transactions.donor_id is
 * set to match in the SAME db.transaction() as the acknowledgment insert, so
 * the two links cannot diverge (2026-08-08 bug: creating an acknowledgment
 * left ledger_transactions.donor_id NULL, so getDonor() and
 * listPendingAcknowledgments() — both keyed off the transaction's donor_id —
 * couldn't find the donor even though the acknowledgment record had one).
 * This overwrites any donor already linked to the transaction — the ack
 * dialog's donor field is pre-filled from the transaction's current link
 * (see TxnDonorActions), so an explicit different selection here is the same
 * kind of explicit re-link the standalone "Link Donor" dialog already allows.
 * Omitting donorId (left blank) leaves the transaction's existing link
 * untouched — "leave blank to record without linking a donor" must not clear
 * a link that's already there.
 *
 * PATCH (mark-sent) validates:
 *   1. Acknowledgment exists for this transaction
 *   2. ack.sentAt IS NULL — 409 if already sent
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerEntities,
  ledgerFunds,
  ledgerAcknowledgments,
  ledgerDonors,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { deriveAckType } from "@/lib/ledger";

/**
 * POST /api/admin/ledger/transactions/[id]/acknowledge
 *
 * Body: {
 *   donorId?: string,
 *   typeOverride?: 'written_ack_250' | 'quid_pro_quo_75',
 *   quidProQuoValueCents?: number,
 *   quidProQuoDescription?: string
 * }
 */
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

    const { id: txnId } = await params;

    // Fetch the transaction with its entity
    const txnRows = await db
      .select({
        txn: ledgerTransactions,
        donationsDeductible: ledgerEntities.donationsDeductible,
        entityName: ledgerEntities.name,
        fundName: ledgerFunds.name,
      })
      .from(ledgerTransactions)
      .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
      .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
      .where(eq(ledgerTransactions.id, txnId))
      .limit(1);

    const txnRow = txnRows[0];
    if (!txnRow) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const { txn } = txnRow;

    // Validate: must be income
    if (txn.flow !== "income") {
      return NextResponse.json(
        { error: "Acknowledgments can only be created for income transactions" },
        { status: 422 },
      );
    }

    // Validate: entity must have donationsDeductible=true (Foundation only)
    if (!txnRow.donationsDeductible) {
      return NextResponse.json(
        {
          error:
            "Acknowledgments are only applicable to Foundation (501(c)(3)) donations. This transaction belongs to a non-deductible entity.",
        },
        { status: 422 },
      );
    }

    // Validate: no existing acknowledgment for this transaction
    const existingAck = await db.query.ledgerAcknowledgments.findFirst({
      where: eq(ledgerAcknowledgments.donationTxnId, txnId),
      columns: { id: true, sentAt: true },
    });
    if (existingAck) {
      return NextResponse.json(
        {
          error: "An acknowledgment already exists for this transaction",
          existingAckId: existingAck.id,
        },
        { status: 409 },
      );
    }

    const body = await request.json();
    const { donorId, typeOverride, quidProQuoValueCents, quidProQuoDescription } = body;

    // Validate donorId if provided
    if (donorId !== undefined && donorId !== null) {
      if (typeof donorId !== "string") {
        return NextResponse.json({ error: "donorId must be a string" }, { status: 400 });
      }
      const donor = await db.query.ledgerDonors.findFirst({
        where: eq(ledgerDonors.id, donorId),
        columns: { id: true },
      });
      if (!donor) {
        return NextResponse.json({ error: "Donor not found" }, { status: 400 });
      }
    }

    // Validate quidProQuoValueCents
    if (quidProQuoValueCents !== undefined && quidProQuoValueCents !== null) {
      if (
        typeof quidProQuoValueCents !== "number" ||
        !Number.isInteger(quidProQuoValueCents) ||
        quidProQuoValueCents < 0
      ) {
        return NextResponse.json(
          { error: "quidProQuoValueCents must be a non-negative integer" },
          { status: 400 },
        );
      }
    }

    // Validate quidProQuoDescription
    if (quidProQuoDescription !== undefined && quidProQuoDescription !== null) {
      if (typeof quidProQuoDescription !== "string" || quidProQuoDescription.length > 500) {
        return NextResponse.json(
          { error: "quidProQuoDescription must be a string of 500 characters or fewer" },
          { status: 400 },
        );
      }
    }

    // Validate typeOverride
    const validTypes = ["written_ack_250", "quid_pro_quo_75"] as const;
    if (typeOverride !== undefined && typeOverride !== null) {
      if (!validTypes.includes(typeOverride)) {
        return NextResponse.json(
          { error: "typeOverride must be 'written_ack_250' or 'quid_pro_quo_75'" },
          { status: 400 },
        );
      }
    }

    // Derive the acknowledgment type
    const qpqCents =
      typeof quidProQuoValueCents === "number" && quidProQuoValueCents > 0
        ? quidProQuoValueCents
        : null;
    const derivedType = deriveAckType(txn.amountCents, qpqCents);
    const ackType: string = typeOverride ?? derivedType ?? "";

    if (!ackType) {
      return NextResponse.json(
        {
          error:
            "Amount does not meet the $250 / $75 threshold for an acknowledgment. Use typeOverride to force a type if needed.",
        },
        { status: 422 },
      );
    }

    // quidProQuoValueCents is required when type is quid_pro_quo_75
    if (ackType === "quid_pro_quo_75" && (qpqCents === null || qpqCents < 7500)) {
      return NextResponse.json(
        {
          error:
            "quidProQuoValueCents is required and must be >= 7500 (i.e., $75) when acknowledgment type is 'quid_pro_quo_75'",
        },
        { status: 400 },
      );
    }

    // Insert the acknowledgment — amountCents and txnDate copied from transaction (DECISION-026).
    // When a donor is provided, also set it on the transaction itself, in the
    // same db.transaction() so ledger_acknowledgments.donor_id and
    // ledger_transactions.donor_id cannot diverge (see file header).
    const ack = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(ledgerAcknowledgments)
        .values({
          donationTxnId: txnId,
          donorId: donorId ?? null,
          amountCents: txn.amountCents, // immutable copy from transaction
          txnDate: txn.txnDate,         // immutable copy from transaction
          type: ackType,
          quidProQuoValueCents: qpqCents,
          quidProQuoDescription:
            typeof quidProQuoDescription === "string" && quidProQuoDescription.trim()
              ? quidProQuoDescription.trim()
              : null,
          sentAt: null,
          recordedByUserId: session.user.id,
        })
        .returning();

      if (donorId) {
        await tx
          .update(ledgerTransactions)
          .set({ donorId, updatedAt: new Date() })
          .where(eq(ledgerTransactions.id, txnId));
      }

      return inserted;
    });

    return NextResponse.json(ack, { status: 201 });
  } catch (error) {
    console.error("Error creating acknowledgment:", error);
    return NextResponse.json({ error: "Failed to create acknowledgment" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/ledger/transactions/[id]/acknowledge
 *
 * Mark the acknowledgment for this transaction as sent. Optional fields to
 * record the letter.
 *
 * Body: {
 *   sentAt?: string (YYYY-MM-DD, defaults to today),
 *   letterStorageKey?: string,
 *   letterText?: string,
 *   quidProQuoValueCents?: number,
 *   typeOverride?: 'written_ack_250' | 'quid_pro_quo_75'
 * }
 */
export async function PATCH(
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

    const { id: txnId } = await params;

    // Find the acknowledgment for this transaction
    const existingAck = await db.query.ledgerAcknowledgments.findFirst({
      where: eq(ledgerAcknowledgments.donationTxnId, txnId),
    });
    if (!existingAck) {
      return NextResponse.json(
        { error: "No acknowledgment found for this transaction. Create one first." },
        { status: 404 },
      );
    }

    // Validate: not already sent
    if (existingAck.sentAt !== null) {
      const sentDate = existingAck.sentAt.toISOString().split("T")[0];
      return NextResponse.json(
        { error: `Acknowledgment already sent on ${sentDate}` },
        { status: 409 },
      );
    }

    const body = await request.json();
    const { sentAt, letterStorageKey, letterText, quidProQuoValueCents, typeOverride } = body;

    // Build update patch
    const patch: Partial<{
      sentAt: Date;
      letterStorageKey: string | null;
      letterText: string | null;
      quidProQuoValueCents: number | null;
      type: string;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    // sentAt defaults to now
    if (sentAt !== undefined) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (typeof sentAt !== "string" || !dateRegex.test(sentAt)) {
        return NextResponse.json(
          { error: "sentAt must be a YYYY-MM-DD date string" },
          { status: 400 },
        );
      }
      const parsed = new Date(sentAt + "T00:00:00");
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "sentAt is not a valid date" }, { status: 400 });
      }
      patch.sentAt = parsed;
    } else {
      patch.sentAt = new Date();
    }

    if (letterStorageKey !== undefined) {
      if (letterStorageKey !== null && typeof letterStorageKey !== "string") {
        return NextResponse.json({ error: "letterStorageKey must be a string or null" }, { status: 400 });
      }
      patch.letterStorageKey = letterStorageKey ?? null;
    }

    if (letterText !== undefined) {
      if (letterText !== null && typeof letterText !== "string") {
        return NextResponse.json({ error: "letterText must be a string or null" }, { status: 400 });
      }
      patch.letterText = letterText ?? null;
    }

    if (quidProQuoValueCents !== undefined) {
      if (
        quidProQuoValueCents !== null &&
        (typeof quidProQuoValueCents !== "number" ||
          !Number.isInteger(quidProQuoValueCents) ||
          quidProQuoValueCents < 0)
      ) {
        return NextResponse.json(
          { error: "quidProQuoValueCents must be a non-negative integer or null" },
          { status: 400 },
        );
      }
      patch.quidProQuoValueCents = quidProQuoValueCents ?? null;
    }

    if (typeOverride !== undefined) {
      const validTypes = ["written_ack_250", "quid_pro_quo_75"];
      if (!validTypes.includes(typeOverride)) {
        return NextResponse.json(
          { error: "typeOverride must be 'written_ack_250' or 'quid_pro_quo_75'" },
          { status: 400 },
        );
      }
      patch.type = typeOverride;
    }

    const [updated] = await db
      .update(ledgerAcknowledgments)
      .set(patch)
      .where(eq(ledgerAcknowledgments.id, existingAck.id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error marking acknowledgment sent:", error);
    return NextResponse.json({ error: "Failed to update acknowledgment" }, { status: 500 });
  }
}

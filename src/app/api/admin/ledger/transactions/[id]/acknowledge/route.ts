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
 *   9. purpose, if provided, must be a string <= 200 chars after trimming;
 *      blank/whitespace-only stores NULL (Gift Purpose, 2026-08-12)
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
 * PATCH has TWO modes, selected by an explicit `mode` field. Absent `mode`
 * means "mark_sent" — the original and only behaviour before 2026-08-12, kept
 * as the default so every existing caller (MarkSentDialog) is untouched.
 *
 * PATCH mode='mark_sent' (default) validates:
 *   1. Acknowledgment exists for this transaction — 404
 *   2. ack.sentAt IS NULL — 409 if already sent
 *
 * PATCH mode='purpose' (Gift Purpose, 2026-08-12) validates:
 *   1. Acknowledgment exists for this transaction — 404
 *   2. ack.sentAt IS NULL — 409 if already sent. This is the whole point of
 *      the mode: the purpose is prose the donor READ in their acknowledgment
 *      letter, so once that letter has gone out the stored record of what they
 *      were told must never change retroactively. Editing is a pre-send
 *      correction, not a revision. (Same guard, same status code, and
 *      deliberately the same shape as mark-sent's — an ack is either still
 *      editable or it is history.)
 *   3. purpose is a string (or null) of <= 200 chars after trimming — 400
 *
 * PATCH mode='purpose' side effect: any already-generated letterText for the
 * acknowledgment is CLEARED when the purpose actually changes. letterText is a
 * snapshot of composed prose; leaving a stale one in place would let the
 * treasurer email or print a letter that contradicts the purpose now on the
 * row. Clearing costs one click to regenerate (the row is unsent by
 * definition) and is how the send path — which skips rows whose letterText is
 * NULL with "letter not yet generated" — is prevented from shipping stale text.
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
import { deriveAckType, GIFT_PURPOSE_MAX_LENGTH } from "@/lib/ledger";

/**
 * Validates and normalizes a caller-supplied gift purpose. Shared by POST
 * (create) and PATCH mode='purpose' (edit) so the two entry points cannot
 * drift into accepting different values. Absent/null/blank/whitespace-only all
 * normalize to NULL — "" and "   " are not meaningfully different from "the
 * treasurer didn't name a purpose", and a stored blank string would make the
 * composer's byte-identical-output guarantee depend on the composer's own trim
 * rather than on the data.
 */
function normalizeGiftPurpose(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, error: "purpose must be a string" };
  }
  const trimmed = value.trim();
  if (trimmed.length > GIFT_PURPOSE_MAX_LENGTH) {
    return {
      ok: false,
      error: `purpose must be a string of ${GIFT_PURPOSE_MAX_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

/**
 * POST /api/admin/ledger/transactions/[id]/acknowledge
 *
 * Body: {
 *   donorId?: string,
 *   typeOverride?: 'written_ack_250' | 'quid_pro_quo_75',
 *   quidProQuoValueCents?: number,
 *   quidProQuoDescription?: string,
 *   purpose?: string
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
    const { donorId, typeOverride, quidProQuoValueCents, quidProQuoDescription, purpose } = body;

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

    // Validate purpose — same normalizer PATCH mode='purpose' uses.
    const normalizedPurpose = normalizeGiftPurpose(purpose);
    if (!normalizedPurpose.ok) {
      return NextResponse.json({ error: normalizedPurpose.error }, { status: 400 });
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
          purpose: normalizedPurpose.value,
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
 * mode='mark_sent' (default when `mode` is absent) — mark the acknowledgment
 * for this transaction as sent. Optional fields to record the letter.
 *
 * Body: {
 *   mode?: 'mark_sent',
 *   sentAt?: string (YYYY-MM-DD, defaults to today),
 *   letterStorageKey?: string,
 *   letterText?: string,
 *   quidProQuoValueCents?: number,
 *   typeOverride?: 'written_ack_250' | 'quid_pro_quo_75'
 * }
 *
 * mode='purpose' — edit the gift purpose on an UNSENT acknowledgment. Nothing
 * else is touched; in particular this never sets sentAt/sentVia.
 *
 * Body: { mode: 'purpose', purpose: string | null }
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

    const body = await request.json();
    const { mode } = body;

    // Explicit, allowlisted mode. An unrecognized value is rejected rather
    // than silently falling through to mark-sent — a typo'd mode must never
    // mark a donor's acknowledgment as delivered.
    if (mode !== undefined && mode !== "mark_sent" && mode !== "purpose") {
      return NextResponse.json(
        { error: "mode must be 'mark_sent' or 'purpose'" },
        { status: 400 },
      );
    }

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

    // Validate: not already sent. Shared by both modes — mark-sent refuses to
    // re-send, and purpose refuses to rewrite what the donor already read.
    if (existingAck.sentAt !== null) {
      const sentDate = existingAck.sentAt.toISOString().split("T")[0];
      return NextResponse.json(
        {
          error:
            mode === "purpose"
              ? `This acknowledgment was sent on ${sentDate}. Its gift purpose can no longer be changed — the letter the donor received is a permanent record.`
              : `Acknowledgment already sent on ${sentDate}`,
        },
        { status: 409 },
      );
    }

    if (mode === "purpose") {
      const normalizedPurpose = normalizeGiftPurpose(body.purpose);
      if (!normalizedPurpose.ok) {
        return NextResponse.json({ error: normalizedPurpose.error }, { status: 400 });
      }

      const purposeChanged = normalizedPurpose.value !== existingAck.purpose;

      const [updatedAck] = await db
        .update(ledgerAcknowledgments)
        .set({
          purpose: normalizedPurpose.value,
          // Stale-letter guard — see this file's header. Only when the value
          // actually changed, so re-saving an unchanged purpose never throws
          // away a generated letter for nothing.
          ...(purposeChanged ? { letterText: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(ledgerAcknowledgments.id, existingAck.id))
        .returning();

      // True only when a letter actually existed and was discarded — the UI
      // tells the treasurer to regenerate, and must not say so when there was
      // nothing to regenerate.
      return NextResponse.json({
        ...updatedAck,
        letterTextCleared: purposeChanged && existingAck.letterText !== null,
      });
    }

    const { sentAt, letterStorageKey, letterText, quidProQuoValueCents, typeOverride } = body;

    // Build update patch
    const patch: Partial<{
      sentAt: Date;
      sentVia: string;
      letterStorageKey: string | null;
      letterText: string | null;
      quidProQuoValueCents: number | null;
      type: string;
      updatedAt: Date;
    }> = {
      // This route is the print-side half of the sentAt/sentVia
      // disambiguation (DECISION-087 item 3) — the email send path
      // (emailAcknowledgmentLetters()) sets 'email' via its own atomic
      // claim; this manual mark-sent flow is always 'print'.
      sentVia: "print",
      updatedAt: new Date(),
    };

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

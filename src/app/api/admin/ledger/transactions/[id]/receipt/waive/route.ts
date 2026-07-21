/**
 * POST /api/admin/ledger/transactions/[id]/receipt/waive
 *
 * Marks an expense transaction's missing receipt as "no receipt available"
 * (DECISION-035). Waived rows are excluded from Check 11's compliance count
 * (isReceiptMissing()) — this is how the 147-row historical backlog can
 * genuinely reach zero, without becoming a silent escape hatch for new
 * transactions: gated LEDGER_MANAGE, a step up from LEDGER_RECORD, because
 * waiving suppresses a compliance signal rather than merely recording a
 * transaction (same tier distinction that separates LEDGER_APPROVE from
 * LEDGER_RECORD for approve/reject).
 *
 * Gate: LEDGER_MANAGE
 *
 * Body:
 * {
 *   reason: string; // required, trimmed, capped at 500 chars
 * }
 *
 * Responses:
 *   200 { id }  — waived; sets receiptWaivedAt/receiptWaivedByUserId/receiptWaiverReason
 *   400        — flow !== 'expense', or missing/blank reason
 *   401        — not authenticated
 *   403        — forbidden (missing feature), or transaction is approved/rejected (immutable)
 *   404        — transaction not found
 *   409        — receiptStorageKey already set (remove the receipt before waiving)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE /api/admin/ledger/transactions/[id]/receipt/waive
 *
 * Un-waives — clears all three waiver columns, restoring the row to Check 11's
 * compliance count (correct: the row again genuinely lacks documentation).
 *
 * Gate: LEDGER_MANAGE
 *
 * Responses:
 *   200 { id }
 *   401 / 403 / 404 — same as POST
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const WAIVER_REASON_MAX_LEN = 500;

function getImmutabilityError(existing: {
  approvedAt: Date | null;
  status: string;
}): string | null {
  if (existing.approvedAt) return "Approved transactions cannot be waived";
  if (existing.status === "rejected") return "Rejected transactions cannot be waived";
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.ledgerTransactions.findFirst({
      where: eq(ledgerTransactions.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (existing.flow !== "expense") {
      return NextResponse.json(
        { error: "Only expense transactions can be waived" },
        { status: 400 },
      );
    }

    const immutabilityError = getImmutabilityError(existing);
    if (immutabilityError) {
      return NextResponse.json({ error: immutabilityError }, { status: 403 });
    }

    if (existing.receiptStorageKey) {
      return NextResponse.json(
        { error: "Transaction already has a receipt attached — remove it before waiving" },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawReason = body?.reason;
    if (!rawReason || typeof rawReason !== "string" || !rawReason.trim()) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    const reason = rawReason.trim().slice(0, WAIVER_REASON_MAX_LEN);

    await db
      .update(ledgerTransactions)
      .set({
        receiptWaivedAt: new Date(),
        receiptWaivedByUserId: session.user.id,
        receiptWaiverReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error waiving ledger transaction receipt:", error);
    return NextResponse.json({ error: "Failed to waive receipt requirement" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.query.ledgerTransactions.findFirst({
      where: eq(ledgerTransactions.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const immutabilityError = getImmutabilityError(existing);
    if (immutabilityError) {
      return NextResponse.json({ error: immutabilityError }, { status: 403 });
    }

    await db
      .update(ledgerTransactions)
      .set({
        receiptWaivedAt: null,
        receiptWaivedByUserId: null,
        receiptWaiverReason: null,
        updatedAt: new Date(),
      })
      .where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error un-waiving ledger transaction receipt:", error);
    return NextResponse.json({ error: "Failed to un-waive receipt requirement" }, { status: 500 });
  }
}

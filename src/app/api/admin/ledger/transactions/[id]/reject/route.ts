/**
 * POST /api/admin/ledger/transactions/[id]/reject
 *
 * Rejects a pending disbursement. Sets status='rejected' and rejectionReason.
 * The row is preserved as an audit trail; the treasurer can view it as rejected.
 *
 * Gate: LEDGER_APPROVE
 *
 * Body:
 * {
 *   reason: string; // required, trimmed, max 1000 chars
 * }
 *
 * Responses:
 *   200 { id }            — rejected
 *   400                   — missing/invalid reason
 *   401                   — not authenticated
 *   403                   — forbidden or self-rejection attempt
 *   404                   — transaction not found
 *   409                   — transaction is no longer pending
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const REASON_MAX_LEN = 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Fetch the transaction
    const rows = await db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
      .limit(1);
    const txn = rows[0];
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // 409 if not pending
    if (txn.status !== "pending") {
      return NextResponse.json(
        { error: "Transaction is no longer pending" },
        { status: 409 },
      );
    }

    // Self-rejection block: the person who recorded cannot reject
    if (session.user.id === txn.recordedByUserId) {
      return NextResponse.json(
        { error: "You cannot reject a transaction you recorded" },
        { status: 403 },
      );
    }

    // Validate body
    const body = await request.json();
    const rawReason = body?.reason;
    if (!rawReason || typeof rawReason !== "string" || !rawReason.trim()) {
      return NextResponse.json(
        { error: "reason is required" },
        { status: 400 },
      );
    }
    const rejectionReason = rawReason.trim().slice(0, REASON_MAX_LEN);

    // Reject
    await db
      .update(ledgerTransactions)
      .set({
        status: "rejected",
        rejectionReason,
        updatedAt: new Date(),
      })
      .where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error rejecting transaction:", error);
    return NextResponse.json({ error: "Failed to reject transaction" }, { status: 500 });
  }
}

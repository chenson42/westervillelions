/**
 * POST /api/admin/ledger/transactions/[id]/approve
 *
 * Approves a pending disbursement. Sets status='posted', approvedByUserId,
 * approvedAt, and boardMinute.
 *
 * Gate: LEDGER_APPROVE
 *
 * Body:
 * {
 *   boardMinute: string; // required, trimmed, max 500 chars
 * }
 *
 * Responses:
 *   200 { id }            — approved
 *   400                   — missing/invalid boardMinute
 *   401                   — not authenticated
 *   403                   — forbidden (missing feature) or self-approval attempt
 *   404                   — transaction not found
 *   409                   — transaction is no longer pending (already approved, rejected, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const BOARD_MINUTE_MAX_LEN = 500;

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

    // Self-approval block: the person who recorded cannot approve
    if (session.user.id === txn.recordedByUserId) {
      return NextResponse.json(
        { error: "You cannot approve a transaction you recorded" },
        { status: 403 },
      );
    }

    // Validate body
    const body = await request.json();
    const rawBoardMinute = body?.boardMinute;
    if (!rawBoardMinute || typeof rawBoardMinute !== "string" || !rawBoardMinute.trim()) {
      return NextResponse.json(
        { error: "boardMinute is required" },
        { status: 400 },
      );
    }
    const boardMinute = rawBoardMinute.trim().slice(0, BOARD_MINUTE_MAX_LEN);

    // Approve
    await db
      .update(ledgerTransactions)
      .set({
        status: "posted",
        approvedByUserId: session.user.id,
        approvedAt: new Date(),
        boardMinute,
        updatedAt: new Date(),
      })
      .where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error approving transaction:", error);
    return NextResponse.json({ error: "Failed to approve transaction" }, { status: 500 });
  }
}

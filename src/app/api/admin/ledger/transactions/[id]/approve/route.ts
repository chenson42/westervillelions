/**
 * POST /api/admin/ledger/transactions/[id]/approve
 *
 * Approves a pending disbursement. Sets status='posted', approvedByUserId,
 * approvedAt, and boardMinute.
 *
 * Pair-aware (DECISION-058): when the target row is a Transfer/Sweep leg
 * (transferGroupId set), the partner leg is fetched, both rows must be
 * pending, and both are approved atomically with identical
 * approvedByUserId/approvedAt/boardMinute.
 *
 * Gate: LEDGER_APPROVE
 *
 * Body:
 * {
 *   boardMinute?: string; // trimmed, max 500 chars. Required ONLY when the
 *     // row does not already have one — a Sweep's creation-time board-minute
 *     // citation is preserved when the approver leaves this blank, rather
 *     // than being silently overwritten (DECISION-058 bug fix). Ordinary
 *     // expenses never have a pre-set boardMinute, so this field remains
 *     // effectively required for them, unchanged from before.
 * }
 *
 * Responses:
 *   200 { id }            — approved (both legs, if a pair)
 *   400                   — missing boardMinute (and none already set)
 *   401                   — not authenticated
 *   403                   — forbidden (missing feature) or self-approval attempt
 *   404                   — transaction not found
 *   409                   — transaction (or its paired leg) is no longer pending
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import type { LedgerTransaction } from "@/lib/db/schema";
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

    // Pair-aware (DECISION-058): fetch the partner leg of a Transfer/Sweep pair.
    let partner: LedgerTransaction | undefined;
    if (txn.transferGroupId) {
      const partnerRows = await db
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.transferGroupId, txn.transferGroupId));
      partner = partnerRows.find((r) => r.id !== txn.id);
    }

    // 409 if either leg is no longer pending
    if (txn.status !== "pending") {
      return NextResponse.json(
        { error: "Transaction is no longer pending" },
        { status: 409 },
      );
    }
    if (partner && partner.status !== "pending") {
      return NextResponse.json(
        { error: "The paired transaction is no longer pending" },
        { status: 409 },
      );
    }

    // Self-approval block: the person who recorded cannot approve (identical
    // recordedByUserId on both legs of a pair — one call created both).
    if (session.user.id === txn.recordedByUserId) {
      return NextResponse.json(
        { error: "You cannot approve a transaction you recorded" },
        { status: 403 },
      );
    }

    // Validate body. Required ONLY when the row doesn't already have a
    // boardMinute (bug fix, DECISION-058) — a strict generalization of the
    // prior unconditional requirement: ordinary expenses (which never have a
    // pre-set boardMinute) behave exactly as before; a Sweep that already
    // cited one at creation lets the approver leave this blank to keep it,
    // or override it by typing a new one.
    const body = await request.json();
    const providedRaw = typeof body?.boardMinute === "string" ? body.boardMinute.trim() : "";
    const boardMinute = providedRaw ? providedRaw.slice(0, BOARD_MINUTE_MAX_LEN) : txn.boardMinute;
    if (!boardMinute) {
      return NextResponse.json(
        { error: "boardMinute is required" },
        { status: 400 },
      );
    }

    const approvedAt = new Date();
    const updatedAt = approvedAt;

    // Approve — both legs atomically when part of a pair
    await db.transaction(async (tx) => {
      await tx
        .update(ledgerTransactions)
        .set({
          status: "posted",
          approvedByUserId: session.user.id,
          approvedAt,
          boardMinute,
          updatedAt,
        })
        .where(eq(ledgerTransactions.id, id));

      if (partner) {
        await tx
          .update(ledgerTransactions)
          .set({
            status: "posted",
            approvedByUserId: session.user.id,
            approvedAt,
            boardMinute,
            updatedAt,
          })
          .where(eq(ledgerTransactions.id, partner.id));
      }
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("Error approving transaction:", error);
    return NextResponse.json({ error: "Failed to approve transaction" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/transactions/[id]/reconcile
 *
 * Toggles the reconciled flag on a posted transaction. Supports both
 * marking reconciled and un-reconciling (for corrections).
 *
 * Only posted transactions may be reconciled — pending or rejected rows
 * have not cleared the bank and cannot appear on a bank statement.
 *
 * Gate: LEDGER_RECORD
 *
 * Body:
 * {
 *   reconciled: boolean; // true = mark reconciled, false = un-reconcile
 * }
 *
 * Responses:
 *   200 { id, reconciled }   — success
 *   400                       — invalid body or non-posted transaction
 *   401                       — not authenticated
 *   403                       — forbidden
 *   404                       — transaction not found
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

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

    // Fetch the transaction
    const rows = await db
      .select({
        id: ledgerTransactions.id,
        status: ledgerTransactions.status,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
      .limit(1);
    const txn = rows[0];
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // Only posted transactions can be reconciled — pending rows have not cleared the bank
    if (txn.status !== "posted") {
      return NextResponse.json(
        { error: "Only posted transactions can be reconciled" },
        { status: 400 },
      );
    }

    // Validate body
    const body = await request.json();
    if (typeof body?.reconciled !== "boolean") {
      return NextResponse.json(
        { error: "reconciled must be a boolean" },
        { status: 400 },
      );
    }

    const reconciled: boolean = body.reconciled;

    await db
      .update(ledgerTransactions)
      .set({
        reconciled,
        reconciledAt: reconciled ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(ledgerTransactions.id, id));

    return NextResponse.json({ id, reconciled });
  } catch (error) {
    console.error("Error reconciling transaction:", error);
    return NextResponse.json({ error: "Failed to reconcile transaction" }, { status: 500 });
  }
}

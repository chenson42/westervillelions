/**
 * POST /api/admin/ledger/transactions/[id]/reconcile
 *
 * Toggles the reconciled flag on a posted transaction. Supports both
 * marking reconciled and un-reconciling (for corrections).
 *
 * Only posted transactions may be reconciled — pending or rejected rows
 * have not cleared the bank and cannot appear on a bank statement.
 *
 * A row owned by a closed reconciliation session (reconciledSessionId set) is
 * REFUSED with 403 in either direction (DECISION-109 R3b): reopen the session.
 *
 * Bank Reconciliation inc2: every write here clears `reconciledSessionId` —
 * this route is always an out-of-band correction, never a session close, so
 * it must never leave a stale session-provenance pointer behind (DECISION-036).
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
import { and, eq, isNull } from "drizzle-orm";
import { CLOSED_SESSION_LOCK_MESSAGE } from "@/lib/ledger-transaction-lock";
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
        reconciledSessionId: ledgerTransactions.reconciledSessionId,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
      .limit(1);
    const txn = rows[0];
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    // DECISION-109 (architect R3b): a row cleared by a CLOSED reconciliation
    // session is owned by that session. This toggle clears the session pointer
    // on every write, so without this refusal the lowest-privilege ledger role
    // could strip a closed session's lock (and silently break its tie-out) in
    // one click. Either direction. Rows with only the legacy mark still toggle.
    if (txn.reconciledSessionId) {
      return NextResponse.json({ error: CLOSED_SESSION_LOCK_MESSAGE }, { status: 403 });
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

    // Bank Reconciliation inc2: this is an out-of-band correction — always
    // sever any session provenance so a later reopen never mistakes this row
    // for one its close touched (DECISION-036).
    //
    // The session refusal is ALSO pinned inside the UPDATE (DECISION-111 item
    // 3): a session could close this row between the read above and this
    // write. Zero rows returned means the row is gone (404) or became
    // session-owned (403), chosen by a follow-up lookup.
    const updated = await db
      .update(ledgerTransactions)
      .set({
        reconciled,
        reconciledAt: reconciled ? new Date() : null,
        reconciledSessionId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(ledgerTransactions.id, id), isNull(ledgerTransactions.reconciledSessionId)))
      .returning({ id: ledgerTransactions.id });

    if (updated.length === 0) {
      const again = await db
        .select({ reconciledSessionId: ledgerTransactions.reconciledSessionId })
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, id))
        .limit(1);
      if (!again[0]) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
      }
      return NextResponse.json({ error: CLOSED_SESSION_LOCK_MESSAGE }, { status: 403 });
    }

    return NextResponse.json({ id, reconciled });
  } catch (error) {
    console.error("Error reconciling transaction:", error);
    return NextResponse.json({ error: "Failed to reconcile transaction" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match
 *
 * Manually matches one staged bank line to one existing posted transaction
 * ("accept" — inc2 has no auto-match engine, so there is no suggestion to
 * accept from; the human always explicitly picks both sides of a pair). Does
 * NOT touch `reconciled`/`reconciledAt` — those flip only at session close,
 * in a batch (architect's Ruling 3).
 *
 * Gate: LEDGER_RECORD
 *
 * Body: { bankLineId: string; transactionId: string }
 * Response 201: { matchId, bankLineId, transactionId }
 *
 * Errors:
 *   400 — transaction is not posted, or belongs to a different bank account
 *   404 — session, bank line, or transaction not found
 *   409 — session not open, bank line already matched, transaction already
 *         reconciled, or transaction already matched to a different bank line
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getBankLineById,
  getMatchForBankLine,
  getMatchForTransaction,
  insertMatch,
} from "@/lib/reconciliation-queries";

/**
 * Extracts a Postgres error code from a thrown value, unwrapping Drizzle's
 * `.cause` wrapping when present. Mirrors the pattern in
 * src/app/api/admin/ledger/filings/route.ts — translates a unique-constraint
 * race (23505) into a clean 409 instead of a generic 500.
 */
function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: string }).code;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    typeof (err as { cause?: unknown }).cause === "object" &&
    (err as { cause?: unknown }).cause !== null &&
    "code" in (err as { cause: object }).cause
  ) {
    return (err as { cause: { code?: string } }).cause.code;
  }
  return undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { bankLineId, transactionId } = body ?? {};

    if (!bankLineId || typeof bankLineId !== "string") {
      return NextResponse.json({ error: "bankLineId is required" }, { status: 400 });
    }
    if (!transactionId || typeof transactionId !== "string") {
      return NextResponse.json({ error: "transactionId is required" }, { status: 400 });
    }

    // 1. Session must be open
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json(
        { error: "Reopen this session before changing matches" },
        { status: 409 },
      );
    }

    // 2. Bank line belongs to this session
    const bankLine = await getBankLineById(sessionId, bankLineId);
    if (!bankLine) {
      return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
    }

    // 3. Bank line has no existing match (route-level 1:1 rule — inc3 lifts
    // this, not the schema, to enable many-to-one Zeffy batch matching)
    const existingBankLineMatch = await getMatchForBankLine(bankLineId);
    if (existingBankLineMatch) {
      return NextResponse.json(
        { error: "This bank line is already matched — unmatch it first" },
        { status: 409 },
      );
    }

    // 4. Transaction must be posted, same bank account, unreconciled, unmatched
    const txnRows = await db
      .select({
        id: ledgerTransactions.id,
        status: ledgerTransactions.status,
        bankAccountId: ledgerTransactions.bankAccountId,
        reconciled: ledgerTransactions.reconciled,
      })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, transactionId))
      .limit(1);
    const txn = txnRows[0];
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (txn.status !== "posted") {
      return NextResponse.json(
        { error: "Only posted transactions can be matched" },
        { status: 400 },
      );
    }
    if (txn.bankAccountId !== reconSession.bankAccountId) {
      return NextResponse.json(
        { error: "Transaction does not belong to this session's bank account" },
        { status: 400 },
      );
    }
    if (txn.reconciled) {
      return NextResponse.json(
        { error: "This transaction is already reconciled" },
        { status: 409 },
      );
    }
    const existingTxnMatch = await getMatchForTransaction(transactionId);
    if (existingTxnMatch) {
      return NextResponse.json(
        { error: "This transaction is already matched to a different bank line" },
        { status: 409 },
      );
    }

    // 5. Insert match row. transactionId is UNIQUE at the DB layer forever
    // (DECISION-036) — a concurrent request racing past the pre-check above
    // surfaces as a clean 409, not a generic 500.
    try {
      const match = await insertMatch({
        sessionId,
        bankLineId,
        transactionId,
        createdByUserId: authSession.user.id,
      });

      return NextResponse.json(
        { matchId: match.id, bankLineId, transactionId },
        { status: 201 },
      );
    } catch (err: unknown) {
      if (pgErrorCode(err) === "23505") {
        return NextResponse.json(
          { error: "This bank line or transaction is already matched" },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("Error matching bank line:", error);
    return NextResponse.json({ error: "Failed to match bank line" }, { status: 500 });
  }
}

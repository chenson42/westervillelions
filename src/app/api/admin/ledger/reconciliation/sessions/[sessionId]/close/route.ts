/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close
 *
 * HARD tie-out gate — per the user's 2026-07-21 decision, there is no
 * discrepancy-note override path. A session closes only when:
 *   1. every in-period bank line has a match (checked as its own condition,
 *      not merely implied by the sum tying out — see design doc rationale),
 *   2. every matched transaction is still 'posted' (defensive re-check), and
 *   3. openingBalanceCents + sum(matched, in-period bank lines) === closingBalanceCents.
 *
 * On success, atomically (one db.transaction()): every matched transaction
 * gets `reconciled = true`, `reconciledAt = now()`, `reconciledSessionId =
 * this session` (the SAME columns the legacy per-row toggle writes —
 * architect's Ruling 3), and the session itself flips to 'closed'.
 *
 * Gate: LEDGER_RECORD
 *
 * Response 200: { sessionId, status: 'closed', clearedCount }
 * 400 — unmatched in-period lines remain, a matched transaction is no longer
 *       posted, or the tie-out doesn't balance (delta included in the body)
 * 404 — session not found
 * 409 — session is not open
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerReconciliationSessions } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getTieOutAssembly,
  getMatchedTransactionIdsForSession,
} from "@/lib/reconciliation-queries";
import { computeTieOut } from "@/lib/reconciliation";

export async function POST(
  _request: NextRequest,
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

    // 1. Session must be open
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json({ error: "This session is already closed" }, { status: 409 });
    }

    // 2. Every in-period bank line must have a match
    const tieOutAssembly = await getTieOutAssembly(sessionId);
    if (tieOutAssembly.unmatchedInPeriodBankLineIds.length > 0) {
      return NextResponse.json(
        {
          error: `${tieOutAssembly.unmatchedInPeriodBankLineIds.length} bank lines are still unmatched`,
          unmatchedBankLineIds: tieOutAssembly.unmatchedInPeriodBankLineIds,
        },
        { status: 400 },
      );
    }

    // 3. Defensive re-check: every matched transaction is still posted
    const matchedTransactionIds = await getMatchedTransactionIdsForSession(sessionId);
    if (matchedTransactionIds.length > 0) {
      const statusRows = await db
        .select({ id: ledgerTransactions.id, status: ledgerTransactions.status })
        .from(ledgerTransactions)
        .where(inArray(ledgerTransactions.id, matchedTransactionIds));

      const notPosted = statusRows.find((r) => r.status !== "posted");
      if (notPosted) {
        return NextResponse.json(
          {
            error: `Transaction ${notPosted.id} is no longer posted (status: ${notPosted.status}) — unmatch it before closing`,
          },
          { status: 400 },
        );
      }
    }

    // 4. Tie-out arithmetic — HARD gate, no override
    const tieOut = computeTieOut({
      openingBalanceCents: reconSession.openingBalanceCents,
      closingBalanceCents: reconSession.closingBalanceCents,
      matchedLineAmountsCents: tieOutAssembly.matchedLineAmountsCents,
    });

    if (!tieOut.balanced) {
      return NextResponse.json(
        {
          error: "Does not balance",
          deltaCents: tieOut.deltaCents,
          closingBalanceCents: tieOut.closingBalanceCents,
          computedCents: tieOut.openingBalanceCents + tieOut.matchedTotalCents,
        },
        { status: 400 },
      );
    }

    // 5. Atomic: reconcile matched transactions + close the session
    const now = new Date();
    await db.transaction(async (tx) => {
      if (matchedTransactionIds.length > 0) {
        await tx
          .update(ledgerTransactions)
          .set({
            reconciled: true,
            reconciledAt: now,
            reconciledSessionId: sessionId,
            updatedAt: now,
          })
          .where(inArray(ledgerTransactions.id, matchedTransactionIds));
      }

      await tx
        .update(ledgerReconciliationSessions)
        .set({
          status: "closed",
          closedAt: now,
          closedByUserId: authSession.user.id,
          updatedAt: now,
        })
        .where(eq(ledgerReconciliationSessions.id, sessionId));
    });

    return NextResponse.json({
      sessionId,
      status: "closed",
      clearedCount: matchedTransactionIds.length,
    });
  } catch (error) {
    console.error("Error closing reconciliation session:", error);
    return NextResponse.json(
      { error: "Failed to close reconciliation session" },
      { status: 500 },
    );
  }
}

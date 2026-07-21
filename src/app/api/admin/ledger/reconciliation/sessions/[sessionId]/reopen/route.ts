/**
 * POST /api/admin/ledger/reconciliation/sessions/[sessionId]/reopen
 *
 * Mistake recovery — reverts a closed session to open. Blocked if a LATER
 * statement period on the same bank account is already closed (standard
 * bank-rec discipline: you can't safely revisit an earlier period once later
 * periods have been finalized on top of the books as they stood at that
 * time). Only reverts rows whose `reconciledSessionId` points at THIS
 * session — the provenance pointer, not a timestamp-match heuristic — so an
 * independent out-of-band edit (the legacy per-row toggle) is never
 * clobbered. Existing match links are NOT deleted.
 *
 * Gate: LEDGER_MANAGE (closing a session is LEDGER_RECORD; reopening a
 * settled audit record is a correction action closer in kind to "manage
 * funds, budgets, entities, opening balances").
 *
 * Response 200: { sessionId, status: 'open', revertedTxnCount }
 * 404 — session not found
 * 409 — session is not closed, or a later-period session on this account is
 *       already closed (blockingSessionId included)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerTransactions, ledgerReconciliationSessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getLaterClosedSessionForAccount,
} from "@/lib/reconciliation-queries";

/** "Jul 1–Jul 31, 2025" — human period label for the blocking-session error message. */
function formatPeriodLabel(start: string, end: string): string {
  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const endYear = end.split("-")[0];
  return `${fmt(start)}–${fmt(end)}, ${endYear}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;

    // 1. Session must be closed
    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "closed") {
      return NextResponse.json({ error: "This session is already open" }, { status: 409 });
    }

    // 2. Ordering rule: can't reopen while a later-period session on the same
    // account is already closed
    const blockingSession = await getLaterClosedSessionForAccount(
      reconSession.bankAccountId,
      reconSession.statementPeriodEnd,
    );
    if (blockingSession) {
      return NextResponse.json(
        {
          error: `Cannot reopen — the session for ${formatPeriodLabel(
            blockingSession.statementPeriodStart,
            blockingSession.statementPeriodEnd,
          )} is already closed. Reopen that session first.`,
          blockingSessionId: blockingSession.id,
        },
        { status: 409 },
      );
    }

    // 3. Atomic: revert only rows this session's close touched + reopen the session
    const now = new Date();
    const revertedTxnCount = await db.transaction(async (tx) => {
      const reverted = await tx
        .update(ledgerTransactions)
        .set({
          reconciled: false,
          reconciledAt: null,
          reconciledSessionId: null,
          updatedAt: now,
        })
        .where(eq(ledgerTransactions.reconciledSessionId, sessionId))
        .returning({ id: ledgerTransactions.id });

      await tx
        .update(ledgerReconciliationSessions)
        .set({
          status: "open",
          reopenedAt: now,
          reopenedByUserId: authSession.user.id,
          closedAt: null,
          closedByUserId: null,
          updatedAt: now,
        })
        .where(eq(ledgerReconciliationSessions.id, sessionId));

      return reverted.length;
    });

    return NextResponse.json({ sessionId, status: "open", revertedTxnCount });
  } catch (error) {
    console.error("Error reopening reconciliation session:", error);
    return NextResponse.json(
      { error: "Failed to reopen reconciliation session" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/admin/ledger/reconciliation/sessions/[sessionId]
 *
 * Session detail: metadata, every bank line (with its match state, if any),
 * candidate posted transactions for manual matching against this account,
 * and a computed tie-out summary. Powers the
 * `/admin/ledger/reconciliation/[sessionId]` detail page.
 *
 * Gate: LEDGER_VIEW
 *
 * Response 200:
 * {
 *   session: { id, bankAccountId, bankAccountName, bankAccountType, entityId,
 *              entitySlug, statementPeriodStart, statementPeriodEnd,
 *              openingBalanceCents, closingBalanceCents, status, uploadedAt,
 *              csvFilename, csvRowCount, closedAt, reopenedAt },
 *   bankLines: BankLineWithMatch[],
 *   candidateTransactions: CandidateTransactionRow[],
 *   tieOut: { openingBalanceCents, matchedTotalCents, closingBalanceCents,
 *             deltaCents, balanced, unmatchedInPeriodCount },
 * }
 * 404 — session not found
 *
 * DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]
 *
 * Discard an OPEN session: hard-deletes the session, its imported bank lines
 * and its match links in one transaction, and writes one audit row. Never
 * touches ledger_transactions. A closed session is never discardable (reopen
 * first) — the status pin lives inside the DELETE statement
 * (see discardOpenSession()).
 *
 * Gate: LEDGER_RECORD; additionally LEDGER_MANAGE when the session was
 * previously reopened.
 *
 * 200 — { sessionId, discarded: true, bankLineCount, matchCount }
 * 401 / 403 — unauthenticated / lacks the gate
 * 404 — session not found (or non-UUID id)
 * 409 — session is closed
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getBankLinesForSession,
  getCandidateTransactionsForMatching,
  getTieOutAssembly,
  discardOpenSession,
} from "@/lib/reconciliation-queries";
import { isUuid } from "@/lib/utils";
import { computeTieOut } from "@/lib/reconciliation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_VIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId } = await params;

    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [bankLines, candidateTransactions, tieOutAssembly] = await Promise.all([
      getBankLinesForSession(sessionId),
      getCandidateTransactionsForMatching(reconSession.bankAccountId),
      getTieOutAssembly(sessionId),
    ]);

    const tieOut = computeTieOut({
      openingBalanceCents: reconSession.openingBalanceCents,
      closingBalanceCents: reconSession.closingBalanceCents,
      matchedLineAmountsCents: tieOutAssembly.matchedLineAmountsCents,
      unmatchedInPeriodCount: tieOutAssembly.unmatchedInPeriodBankLineIds.length,
    });

    return NextResponse.json({
      session: reconSession,
      bankLines,
      candidateTransactions,
      tieOut,
    });
  } catch (error) {
    console.error("Error fetching reconciliation session:", error);
    return NextResponse.json(
      { error: "Failed to fetch reconciliation session" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = authSession.user.id;
    if (!(await hasFeature(userId, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canManage = await hasFeature(userId, FEATURES.LEDGER_MANAGE);

    const { sessionId } = await params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const result = await discardOpenSession({ sessionId, actorUserId: userId, canManage });
    switch (result.outcome) {
      case "discarded":
        return NextResponse.json({
          sessionId: result.sessionId,
          discarded: true,
          bankLineCount: result.bankLineCount,
          matchCount: result.matchCount,
        });
      case "not_found":
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      case "not_open":
        return NextResponse.json(
          { error: "This session is closed — reopen it before discarding it." },
          { status: 409 },
        );
      case "requires_manage":
        return NextResponse.json(
          { error: "Only a ledger manager can discard a session that was reopened." },
          { status: 403 },
        );
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  } catch (error) {
    console.error("Error discarding reconciliation session:", error);
    return NextResponse.json(
      { error: "Failed to discard reconciliation session" },
      { status: 500 },
    );
  }
}

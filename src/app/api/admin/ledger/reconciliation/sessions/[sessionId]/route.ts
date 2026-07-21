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
} from "@/lib/reconciliation-queries";
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

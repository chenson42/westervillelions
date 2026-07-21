/**
 * DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]
 *
 * "Unmatch." Removes a match row, returning the bank line and transaction to
 * unmatched state. Only reachable while the session is open — unmatching on a
 * closed session requires reopening first, since the transaction's
 * `reconciled` flag was already finalized by close and unmatching alone would
 * not revert it.
 *
 * Gate: LEDGER_RECORD
 *
 * Response 200: { deleted: true }
 * 404 — session or match not found
 * 409 — session is not open
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import {
  getReconciliationSessionById,
  getMatchById,
  deleteMatch,
} from "@/lib/reconciliation-queries";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; matchId: string }> },
) {
  try {
    const authSession = await auth();
    if (!authSession?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(authSession.user.id, FEATURES.LEDGER_RECORD))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { sessionId, matchId } = await params;

    const reconSession = await getReconciliationSessionById(sessionId);
    if (!reconSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (reconSession.status !== "open") {
      return NextResponse.json(
        { error: "This session is closed — reopen it before changing matches" },
        { status: 409 },
      );
    }

    const match = await getMatchById(sessionId, matchId);
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    await deleteMatch(matchId);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Error unmatching bank line:", error);
    return NextResponse.json({ error: "Failed to unmatch bank line" }, { status: 500 });
  }
}

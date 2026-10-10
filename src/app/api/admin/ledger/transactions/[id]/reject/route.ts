/**
 * POST /api/admin/ledger/transactions/[id]/reject
 *
 * Rejects a pending disbursement. Sets status='rejected' and rejectionReason.
 * The row is preserved as an audit trail; the treasurer can view it as rejected.
 *
 * Pair-aware (DECISION-058): when the target row is a Transfer/Sweep leg
 * (transferGroupId set), both legs are locked, both must be pending, and both
 * are rejected atomically with an identical rejectionReason.
 *
 * Race-safe: the row and its partner are locked FOR UPDATE and the write is
 * pinned on status='pending' (src/lib/ledger-approval-decision.ts), so an
 * approve racing a reject cannot leave an approver stamp on a rejected row.
 *
 * Gate: LEDGER_APPROVE
 *
 * Body:
 * {
 *   reason: string; // required, trimmed, max 1000 chars
 * }
 *
 * Responses:
 *   200 { id }            — rejected (both legs, if a pair)
 *   400                   — missing/invalid reason, or malformed JSON
 *   401                   — not authenticated
 *   403                   — forbidden or self-rejection attempt (the actor
 *                           recorded either leg)
 *   404 { error, code: "not_found" } — transaction not found
 *   409 ApprovalConflictBody — transaction (or its paired leg) is no longer
 *       pending, or another approver won the race. Names the decider (display
 *       name, or null; never an email). Type: src/lib/ledger-approval.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { decideTransaction } from "@/lib/ledger-approval-decision";

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

    // A malformed body is the caller's fault: 400, not a 500.
    const body = await request.json().catch(() => null);

    const result = await decideTransaction({
      id,
      actorUserId: session.user.id,
      input: { kind: "reject", reason: body?.reason },
    });
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error rejecting transaction:", error);
    return NextResponse.json({ error: "Failed to reject transaction" }, { status: 500 });
  }
}

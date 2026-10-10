/**
 * POST /api/admin/ledger/transactions/[id]/approve
 *
 * Approves a pending disbursement. Sets status='posted', approvedByUserId,
 * approvedAt, and boardMinute.
 *
 * Pair-aware (DECISION-058): when the target row is a Transfer/Sweep leg
 * (transferGroupId set), both legs are locked, both must be pending, and both
 * are approved atomically with identical approvedByUserId/approvedAt/boardMinute.
 *
 * Race-safe: the row and its partner are locked FOR UPDATE and the write is
 * pinned on status='pending' (src/lib/ledger-approval-decision.ts), so two
 * approvers acting at once cannot both win.
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
 *     // effectively required for them.
 * }
 *
 * Responses:
 *   200 { id }            — approved (both legs, if a pair)
 *   400                   — missing boardMinute (and none already set), or
 *                           malformed JSON
 *   401                   — not authenticated
 *   403                   — forbidden (missing feature) or self-approval attempt
 *                           (the actor recorded either leg)
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
      input: { kind: "approve", boardMinute: body?.boardMinute },
    });
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json({ id: result.id });
  } catch (error) {
    console.error("Error approving transaction:", error);
    return NextResponse.json({ error: "Failed to approve transaction" }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/transactions/[id]/cosign
 *
 * "Add your approval": an informational co-sign on an entry a board member has
 * already approved and posted. The first approval posts a transaction; a
 * co-sign records that a further approver agrees. No quorum, and nothing reads
 * a co-sign as authorization (DECISION-116 follow-on).
 *
 * Gate: LEDGER_APPROVE (the first two statements, as for approve and reject).
 * No body is read or parsed; any body is ignored. Everything the helper needs
 * is the session user id and the path id, so there is nothing a client can
 * forge. Thin wrapper over cosignTransaction() (src/lib/ledger-cosign.ts).
 *
 * Responses (types in src/lib/ledger-approval.ts):
 *   201 { id, cosignedAt }              CosignCreatedBody; id = the EXPENSE leg
 *   401 { error }                       not authenticated
 *   403 { error }                       missing ledger.approve (NO `code`)
 *   403 { error, code: "recorded_by_you" }   CosignForbiddenBody
 *   404 { error, code: "not_found" }    malformed, unknown or deleted id
 *   409 CosignConflictBody              code: not_approved | rejected |
 *       not_board_decision | already_approved | already_cosigned
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { cosignTransaction } from "@/lib/ledger-cosign";
import type { CosignCreatedBody } from "@/lib/ledger-approval";

export async function POST(
  _request: NextRequest,
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

    const result = await cosignTransaction({ id, actorUserId: session.user.id });
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    const body: CosignCreatedBody = {
      id: result.id,
      cosignedAt: result.cosignedAt.toISOString(),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    console.error("Error adding co-sign:", error);
    return NextResponse.json({ error: "Failed to add your approval" }, { status: 500 });
  }
}

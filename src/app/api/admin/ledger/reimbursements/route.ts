/**
 * GET /api/admin/ledger/reimbursements
 *
 * Returns a paginated list of reimbursements with member names for the admin inbox.
 * Optionally filtered by status and/or memberId.
 *
 * Gate: LEDGER_VIEW
 *
 * Query params:
 *   status?   — 'submitted' | 'approved' | 'rejected' | 'paid'
 *   memberId? — UUID
 *   limit?    — number (default 50)
 *   offset?   — number (default 0)
 *
 * Response 200:
 * {
 *   reimbursements: ReimbursementWithMember[];  // no receiptStorageKey
 *   total: number;
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listReimbursementsForAdmin } from "@/lib/ledger-queries";

const VALID_STATUSES = ["submitted", "approved", "rejected", "paid"] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_VIEW))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") ?? undefined;
    const memberId = searchParams.get("memberId") ?? undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10) || 0, 0);

    if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const { reimbursements, total } = await listReimbursementsForAdmin({
      status,
      memberId,
      limit,
      offset,
    });

    // Strip receiptStorageKey from the response — never returned in list JSON
    const safeReimbursements = reimbursements.map(({ receiptStorageKey: _k, ...rest }) => rest);

    return NextResponse.json({ reimbursements: safeReimbursements, total });
  } catch (error) {
    console.error("Error listing reimbursements:", error);
    return NextResponse.json({ error: "Failed to list reimbursements" }, { status: 500 });
  }
}

/**
 * GET /api/admin/ledger/acknowledgments
 *
 * Returns the acknowledgment queue summary.
 *
 * Gate: hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])
 *   — any ledger role can see the queue status.
 *
 * Query params:
 *   pending=1   — filter to unsent acknowledgments only (sentAt IS NULL)
 *
 * PII split:
 *   - When caller has LEDGER_RECORD: response includes donorId and donorName.
 *   - When caller only has LEDGER_VIEW or LEDGER_MANAGE: donorId / donorName omitted.
 *
 * This implements the DECISION-025 PII gate: board members (LEDGER_VIEW) see
 * acknowledgment status (amounts, dates) but NOT donor contact details.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { listAcknowledgmentsSummary } from "@/lib/ledger-queries";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const canView = await hasAnyFeature(session.user.id, [
      FEATURES.LEDGER_VIEW,
      FEATURES.LEDGER_RECORD,
      FEATURES.LEDGER_MANAGE,
    ]);
    if (!canView) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const pendingOnly = searchParams.get("pending") === "1";

    // Include donor PII only when the caller has LEDGER_RECORD
    const canRecord = await hasFeature(session.user.id, FEATURES.LEDGER_RECORD);

    const acknowledgments = await listAcknowledgmentsSummary({
      pendingOnly,
      includePii: canRecord,
    });

    return NextResponse.json({ acknowledgments, total: acknowledgments.length });
  } catch (error) {
    console.error("Error listing acknowledgments:", error);
    return NextResponse.json({ error: "Failed to list acknowledgments" }, { status: 500 });
  }
}

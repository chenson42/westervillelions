/**
 * GET /api/admin/ledger/sweep-batches/[legId]
 *
 * Read-only summary of one itemized sweep batch (B-172 Increment 2a). Gate:
 * any of LEDGER_VIEW | LEDGER_RECORD | LEDGER_MANAGE | LEDGER_APPROVE (first two
 * statements). The body carries NO party, memo or donor field: an approver
 * reads it. A non-UUID id, an unknown id and a leg that is not a sweep are one
 * identical 404, after the permission check.
 *
 * 200 SweepBatchDetail (src/lib/ledger-sweep.ts); 404 { error, code: "not_found" }.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { authorizeSweep } from "@/lib/ledger-sweep-gate";
import { getSweepBatchDetail } from "@/lib/ledger-sweep-batch";

type RouteContext = { params: Promise<{ legId: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorizeSweep([
      FEATURES.LEDGER_VIEW,
      FEATURES.LEDGER_RECORD,
      FEATURES.LEDGER_MANAGE,
      FEATURES.LEDGER_APPROVE,
    ]);
    if (!gate.ok) return gate.response;

    const { legId } = await params;
    const notFound = () =>
      NextResponse.json({ error: "Sweep batch not found.", code: "not_found" }, { status: 404 });
    if (!isUuid(legId)) return notFound();

    const detail = await getSweepBatchDetail(db, legId);
    if (!detail) return notFound();
    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error loading sweep batch:", error);
    return NextResponse.json({ error: "Could not load the sweep batch." }, { status: 500 });
  }
}

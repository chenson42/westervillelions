/**
 * POST /api/admin/ledger/sweep-batches/[legId]/void
 *
 * Voids an itemized sweep batch (B-172 Increment 2a, DECISION-126): deletes the
 * copies and then the leg in one transaction and writes a `sweep_batch_voided`
 * correction audit row (visible in Recent corrections under both entities).
 * Gate: LEDGER_MANAGE (first two statements). A non-UUID id is 404 after the
 * permission check.
 *
 * Request: { reason: string } (10 to 500 characters; do not type a donor's
 * name). 200 SweepVoidResponse. 400 { code: "reason_required" }; 404
 * not_found | not_a_sweep; 409 { error, code: SweepVoidBlock } for
 * pending_use_reject | already_rejected | approved | reconciled | matched |
 * receipt_sent | prior_fiscal_year | period_filed.
 */

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { normalizeCorrectionReason } from "@/lib/ledger-correction";
import { authorizeSweep } from "@/lib/ledger-sweep-gate";
import { voidSweepBatch } from "@/lib/ledger-sweep-batch";
import type { SweepVoidErrorBody } from "@/lib/ledger-sweep";

type RouteContext = { params: Promise<{ legId: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorizeSweep([FEATURES.LEDGER_MANAGE]);
    if (!gate.ok) return gate.response;

    const { legId } = await params;
    if (!isUuid(legId)) {
      const body: SweepVoidErrorBody = { error: "Sweep batch not found.", code: "not_found" };
      return NextResponse.json(body, { status: 404 });
    }

    const raw: unknown = await request.json().catch(() => null);
    const reason = normalizeCorrectionReason(
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).reason : undefined,
    );
    if (!reason.ok) {
      const body: SweepVoidErrorBody = { error: reason.error, code: "reason_required" };
      return NextResponse.json(body, { status: 400 });
    }

    const result = await voidSweepBatch(legId, { userId: gate.userId }, reason.value);
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json(result.response);
  } catch (error) {
    console.error("Error voiding sweep batch:", error);
    return NextResponse.json({ error: "Could not void the sweep batch. Nothing was changed." }, { status: 500 });
  }
}

/**
 * POST /api/admin/ledger/sweep-batches
 *
 * Creates an itemized sweep batch (B-172 Increment 2a, DECISION-126): one Club
 * expense leg (the sweep date, a generated memo, status `pending` iff the total
 * is strictly above the approval threshold) plus one Foundation income copy
 * per selected gift (the GIFT date, the gift's category mirror), in ONE
 * transaction with FOR UPDATE on every source row in id order.
 *
 * Gate: LEDGER_RECORD (first two statements); the tier is computed on the
 * server from the locked rows and needs LEDGER_MANAGE when any copy or the
 * sweep date is in a prior fiscal year. The client never sends a total or a
 * destination fund: the total is derived and must equal `bankAmountCents`.
 *
 * Request: SweepBatchCreateRequest. 201 SweepBatchCreatedResponse. Errors are
 * SweepErrorBody (src/lib/ledger-sweep.ts): 400 invalid_body | invalid_id |
 * no_rows | batch_too_large | duplicate_ids | invalid_date | future_date | invalid_amount |
 * minute_required | reason_required | bank_account_invalid | total_mismatch |
 * total_too_large; 403 direction_denied | manage_required; 404 fund_not_found;
 * 409 rows_refused | rows_claimed (every refusal is `already_swept`).
 */

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/permissions";
import { easternDateString } from "@/lib/eastern-date";
import { authorizeSweep } from "@/lib/ledger-sweep-gate";
import { parseSweepCreateBody } from "@/lib/ledger-sweep";
import { createSweepBatch } from "@/lib/ledger-sweep-batch";

/**
 * A pending batch awaits one approver email per approver after the commit
 * (about 20 s on the dev branch with 16 approvers, 2a O6). Give the platform
 * room so it does not cut the response after the rows are written (B6).
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const gate = await authorizeSweep([FEATURES.LEDGER_RECORD]);
    if (!gate.ok) return gate.response;

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseSweepCreateBody(raw, easternDateString(new Date()));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const result = await createSweepBatch(parsed.value, {
      userId: gate.userId,
      callerCanManage: gate.callerCanManage,
    });
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json(result.response, { status: 201 });
  } catch (error) {
    console.error("Error creating sweep batch:", error);
    return NextResponse.json({ error: "Could not record the sweep. Nothing was changed." }, { status: 500 });
  }
}

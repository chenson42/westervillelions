/**
 * POST /api/admin/ledger/sweep-batches/preview
 *
 * Evaluates a would-be itemized sweep batch (B-172 Increment 2a, DECISION-126)
 * and writes nothing. Gate: LEDGER_RECORD (first two statements). Always 200
 * for a well-formed request: refusals are inside `rows[].refusal`, so the page
 * can show the whole selection at once. The SAME evaluator as the create route
 * (evaluateSweepBatch), so a preview and a create agree on every refusal.
 *
 * Request: SweepPreviewRequest. Response: SweepPreviewResponse
 * (src/lib/ledger-sweep.ts). 400 invalid_body | invalid_id | no_rows |
 * batch_too_large | duplicate_ids | invalid_date | future_date | invalid_amount |
 * bank_account_invalid; 403 direction_denied; 404 fund_not_found.
 */

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/permissions";
import { easternDateString } from "@/lib/eastern-date";
import { authorizeSweep } from "@/lib/ledger-sweep-gate";
import { parseSweepPreviewBody } from "@/lib/ledger-sweep";
import { previewSweepBatch } from "@/lib/ledger-sweep-batch";

export async function POST(request: NextRequest) {
  try {
    const gate = await authorizeSweep([FEATURES.LEDGER_RECORD]);
    if (!gate.ok) return gate.response;

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseSweepPreviewBody(raw, easternDateString(new Date()));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const result = await previewSweepBatch(parsed.value, { callerCanManage: gate.callerCanManage });
    if (!result.ok) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json(result.response);
  } catch (error) {
    console.error("Error previewing sweep batch:", error);
    return NextResponse.json({ error: "Could not preview the sweep." }, { status: 500 });
  }
}

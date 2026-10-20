/**
 * POST /api/admin/ledger/sweep-batches/closeouts
 *
 * Marks (or unmarks) Public Funds gifts as "already handled" so they stop
 * being offered to the sweep (B-172 Increment 2a, B-190): for example the gifts
 * the 2026-10-01 lump sweep covered. One row per gift in
 * `ledger_sweep_closeouts`; it moves no money and creates no entry.
 * Gate: LEDGER_MANAGE (first two statements).
 *
 * Request: SweepCloseoutRequest. 200 SweepCloseoutResponse (rows that could not
 * change are in `skipped` with a SweepCloseoutSkip code, never an error).
 * 400 invalid_body | invalid_id | batch_too_large | reason_required. One audit
 * note per request that changed anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/permissions";
import { authorizeSweep } from "@/lib/ledger-sweep-gate";
import { parseSweepCloseoutBody } from "@/lib/ledger-sweep";
import { markSweepCloseouts, unmarkSweepCloseouts } from "@/lib/ledger-sweep-batch";

export async function POST(request: NextRequest) {
  try {
    const gate = await authorizeSweep([FEATURES.LEDGER_MANAGE]);
    if (!gate.ok) return gate.response;

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseSweepCloseoutBody(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const result =
      parsed.value.action === "mark"
        ? await markSweepCloseouts(
            { sourceIds: parsed.value.sourceIds, reason: parsed.value.reason as string },
            { userId: gate.userId },
          )
        : await unmarkSweepCloseouts({ sourceIds: parsed.value.sourceIds }, { userId: gate.userId });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error updating sweep closeouts:", error);
    return NextResponse.json({ error: "Could not update the list. Nothing was changed." }, { status: 500 });
  }
}

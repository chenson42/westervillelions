/**
 * Move a ledger transaction to another fund (DECISION-109/111,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * GET  /api/admin/ledger/transactions/[id]/move  - preview
 * POST /api/admin/ledger/transactions/[id]/move  - execute
 *
 * Gate (both verbs, in this body, not only the proxy): LEDGER_RECORD; then a
 * row-derived tier: a reconciled or prior-fiscal-year row also needs
 * LEDGER_MANAGE. The tier is computed server-side from the row (on the
 * FOR UPDATE row for POST), never from the client.
 *
 * GET returns the same status and `code` POST would for any state-based
 * refusal; a 200 means "this move would be accepted if the body is valid".
 *
 * POST body is EXACTLY { destFundId, categoryId | null, reason, expectedFundId }.
 * Status map: 400 invalid_body | category_invalid; 401; 403 approved | rejected |
 * pending | transfer_leg | dues_synced | manage_required | cross_entity |
 * expense_not_supported | away_from_public | not_permitted; 404 not_found |
 * fund_not_found | category_not_found; 409 stale | same_fund |
 * bank_account_entity_mismatch; 500.
 *
 * Response bodies: see MovePreview / MoveResponse in src/lib/ledger-correction.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { executeFundMove, previewFundMove } from "@/lib/ledger-fund-move-queries";
import { MOVE_FAILED_MESSAGE, parseMoveBody } from "@/lib/ledger-correction";

type RouteContext = { params: Promise<{ id: string }> };

async function authorize(): Promise<
  { ok: true; userId: string; callerCanManage: boolean } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const callerCanManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
  return { ok: true, userId: session.user.id, callerCanManage };
}

const NOT_FOUND = () =>
  NextResponse.json({ error: "Transaction not found", code: "not_found" }, { status: 404 });

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorize();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!isUuid(id)) return NOT_FOUND();

    const result = await previewFundMove({ transactionId: id, callerCanManage: gate.callerCanManage });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json(result.preview);
  } catch (error) {
    console.error("Error previewing ledger fund move:", error);
    return NextResponse.json({ error: "Could not load the move preview." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorize();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!isUuid(id)) return NOT_FOUND();

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseMoveBody(raw);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error, code: "invalid_body" }, { status: 400 });
    }

    const result = await executeFundMove({
      transactionId: id,
      actorUserId: gate.userId,
      callerCanManage: gate.callerCanManage,
      input: parsed.value,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json(result.result);
  } catch (error) {
    console.error("Error moving ledger transaction:", error);
    return NextResponse.json({ error: MOVE_FAILED_MESSAGE }, { status: 500 });
  }
}

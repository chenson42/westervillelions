/**
 * Move a ledger transaction to another fund (DECISION-109/111/112/113,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md and
 * docs/work-log/2026-10-01-cross-entity-transaction-move.md).
 *
 * GET  /api/admin/ledger/transactions/[id]/move  - preview
 * POST /api/admin/ledger/transactions/[id]/move  - execute
 *
 * Gate (both verbs, in this body, not only the proxy): LEDGER_RECORD; then a
 * tier derived server-side from the ROW AND THE DESTINATION: a reconciled or
 * prior-fiscal-year row, and EVERY cross-entity move, also needs LEDGER_MANAGE.
 * It is computed on the FOR UPDATE row for POST, never from the client. It is a
 * permission tier, not a second approver.
 *
 * Guard order, identical for GET and POST: row state, stale (POST), destination
 * fund, direction policy, cross-entity row state, tier, input.
 *
 * GET returns 200 with a PER-DESTINATION decision: every destination it lists
 * as allowed passes steps 1-6 in POST, and every denial carries the code and
 * status POST would return (`manage_required` is a per-destination denial, not
 * a top-level 403). Destination-independent row-state blocks (approved,
 * rejected, pending, transfer_leg, dues_synced, not_found) stay top-level 4xx.
 * Step-7 input refusals are POST-only; `dest_no_active_bank_account` is GET-only.
 *
 * POST body is { destFundId, categoryId | null, reason, expectedFundId } plus
 * the OPTIONAL `destBankAccountId` (string | null; absent is null). It is
 * REQUIRED for a cross-entity move and 400 `dest_bank_account_not_allowed` for
 * a same-entity move. Any other key is a 400.
 *
 * Status map: 400 invalid_body | category_invalid | dest_bank_account_required |
 * dest_bank_account_invalid | dest_bank_account_not_allowed; 401; 403 approved |
 * rejected | pending | transfer_leg | dues_synced | manage_required |
 * cross_entity | expense_not_supported | away_from_public | not_permitted |
 * club_to_foundation_not_supported | prior_fiscal_year_cross_entity |
 * reconciled_session | reconciled_legacy | matched_open_session; 404 not_found |
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

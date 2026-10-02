/**
 * Repair or correct a PAID REIMBURSEMENT's ledger row (B-108 / DECISION-114,
 * docs/work-log/2026-10-02-reimbursement-reconcilable.md).
 *
 * GET  /api/admin/ledger/transactions/[id]/correct  - preview (CorrectionPreview)
 * POST /api/admin/ledger/transactions/[id]/correct  - execute (CorrectResponse)
 *
 * THIS IS THE ONLY WRITE PATH THAT TOUCHES AN APPROVED ROW. The
 * `approvedAt` guards in PATCH /transactions/[id], DELETE and /split are
 * intentionally UNCHANGED and unconditional (DECISION-099 item 4, DECISION-106
 * item 3): they are evaluated before the body is parsed and are not widened by
 * this route. A second eligible row kind is a new `correctableRowKind` arm plus
 * a new DECISION, never a body flag.
 *
 * Gate (both verbs, in this body, not only the proxy): LEDGER_RECORD, checked
 * BEFORE any row read (no 404-vs-403 oracle). A reconciled row, a row dated in
 * an earlier fiscal year, or a date that crosses a fiscal-year boundary also
 * needs LEDGER_MANAGE for `correct` (a tier derived server-side from the locked
 * row); `fill_bank_account` is record tier always.
 *
 * Guard order, identical for GET and POST (see ledger-reimbursement-correction-
 * queries.ts): auth 401 -> permission 403 -> uuid 404 -> body shape 400 (pure,
 * before any DB read) -> row FOR UPDATE 404 -> not_correctable 403 ->
 * own_request 403 -> stale 409 -> state 403/409 -> no_change 400 -> tier 403 ->
 * semantic input 400/404 -> would_hide_statement 409 -> pinned UPDATE -> audit.
 *
 * GET `?txnDate=YYYY-MM-DD&paymentMethod=check|cash|other` (both optional
 * proposal params; malformed is 400 invalid_body) runs the SAME evaluator on the
 * proposal. Destination-independent refusals (404 not_found, 403
 * not_correctable, 403 own_request) are top-level 4xx; everything else is a
 * per-operation decision inside a 200.
 *
 * POST body is exactly one of two shapes (any other key is 400 invalid_body):
 *   { operation: "fill_bank_account", bankAccountId, expectedUpdatedAt, checkNumber? }
 *   { operation: "correct", reason, expectedUpdatedAt, ...at least one of
 *       categoryId, budgetLineId (or null), txnDate, paymentMethod,
 *       checkNumber (or null), memo, bankAccountId }
 *
 * Status map: 400 invalid_body | no_change | category_invalid |
 * bank_account_invalid | budget_line_invalid; 401; 403 forbidden |
 * not_correctable | own_request | manage_required | reconciled_session |
 * reconciled_legacy | matched_open_session; 404 not_found | category_not_found |
 * budget_line_not_found; 409 stale | already_has_bank_account |
 * check_number_present | would_hide_statement; 500.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import {
  CORRECTION_FAILED_MESSAGE,
  parseCorrectionBody,
  parseCorrectionProposal,
  type CorrectionErrorBody,
} from "@/lib/ledger-reimbursement-correction";
import {
  executeCorrection,
  previewCorrection,
} from "@/lib/ledger-reimbursement-correction-queries";

type RouteContext = { params: Promise<{ id: string }> };

function body(error: string, code: CorrectionErrorBody["code"], status: number) {
  return NextResponse.json({ error, code } satisfies CorrectionErrorBody, { status });
}

async function authorize(): Promise<
  | { ok: true; userId: string; memberId: string | null; callerCanManage: boolean }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!(await hasFeature(session.user.id, FEATURES.LEDGER_RECORD))) {
    return { ok: false, response: body("Forbidden", "forbidden", 403) };
  }
  const callerCanManage = await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE);
  return {
    ok: true,
    userId: session.user.id,
    memberId: session.user.memberId ?? null,
    callerCanManage,
  };
}

const NOT_FOUND = () => body("Transaction not found.", "not_found", 404);

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorize();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!isUuid(id)) return NOT_FOUND();

    const proposal = parseCorrectionProposal(new URL(request.url).searchParams);
    if (!proposal.ok) return body(proposal.error, "invalid_body", 400);

    const result = await previewCorrection({
      transactionId: id,
      actor: { userId: gate.userId, memberId: gate.memberId },
      callerCanManage: gate.callerCanManage,
      proposal: proposal.value,
    });
    if (!result.ok) return body(result.error, result.code, result.status);
    return NextResponse.json(result.preview);
  } catch (error) {
    console.error("Error previewing paid-reimbursement correction:", error);
    return NextResponse.json({ error: "Could not load the correction preview." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const gate = await authorize();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    if (!isUuid(id)) return NOT_FOUND();

    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseCorrectionBody(raw);
    if (!parsed.ok) return body(parsed.error, "invalid_body", 400);

    const result = await executeCorrection({
      transactionId: id,
      actor: { userId: gate.userId, memberId: gate.memberId },
      callerCanManage: gate.callerCanManage,
      input: parsed.value,
    });
    if (!result.ok) return body(result.error, result.code, result.status);
    return NextResponse.json(result.result);
  } catch (error) {
    console.error("Error correcting paid-reimbursement ledger row:", error);
    return NextResponse.json({ error: CORRECTION_FAILED_MESSAGE }, { status: 500 });
  }
}

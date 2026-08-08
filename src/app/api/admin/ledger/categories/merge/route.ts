/**
 * POST /api/admin/ledger/categories/merge
 *
 * Ledger Category Management (2026-08-07 / DECISION-065/066) — narrow,
 * zero-transaction merge, matching exactly what
 * scripts/merge-club-budget-categories.ts already did: re-points
 * ledger_budgets.category_id from source to destination for every fiscal
 * year where the source has a row and the destination doesn't. NEVER
 * touches ledger_transactions. Top-level route (not nested under [id]) —
 * merge is inherently a two-category operation, mirroring
 * budgets/cause-lines/{collapse,group}.
 *
 * Gate: LEDGER_MANAGE
 *
 * Body: { sourceId: string; destinationId: string; confirm?: boolean }
 *
 * confirm false/omitted -> returns the plan without writing.
 * confirm true -> executes. This is the exact dry-run/--apply discipline
 * merge-club-budget-categories.ts already uses, promoted from a CLI flag to
 * a request-body flag — one code path computes the checks for both
 * (mergeCategories(), ledger-category-queries.ts), so the plan the
 * treasurer sees and the transaction that executes can never diverge.
 *
 * Refusal order (identical for confirm:false and confirm:true):
 *   1. 400 — sourceId/destinationId missing or equal.
 *   2. 404 — either category not found.
 *   3. 400 — source/destination don't share (entityId, fundKind, flow).
 *   4. 409 — destination is inactive.
 *   5. 409 — current fiscal year is locked for the shared entity.
 *   6. 409 — source has any transactions (message states the count).
 *   7. 409 — any fiscal year has a budget row on BOTH sides.
 *   8. 409 — any fiscal year the merge would re-point is EARLIER than the
 *      current fiscal year (2026-08-08 treasurer decision, DECISION-068) —
 *      whole-merge refusal, names the year(s), regardless of lock status.
 *   9. 409 — any fiscal year the merge would re-point is locked (2026-08-07
 *      treasurer decision, DECISION-067 — whole-merge refusal, names the
 *      locked year(s); a merge moves a budgeted amount, unlike a rename, so
 *      it may not touch a locked, board-approved year). In practice this
 *      now only ever fires for the current fiscal year or a future one —
 *      any prior-year lock is already caught by step 8.
 *
 * Response 200 (confirm false/omitted):
 * { plan: Array<{ fiscalYear, entityName, fundName, annualAmountCents, locked }>,
 *   sourceTransactionCount: 0, destinationName: string }
 *
 * Response 200 (confirm true):
 * { merged: true, destinationId: string, affectedFiscalYears: number[] }
 *
 * Errors: 400 (missing ids, same id, scope mismatch); 401; 403; 404 (either
 * category); 409 (destination inactive / current-FY locked / source has
 * transactions / both-sides budget-year collision).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { mergeCategories } from "@/lib/ledger-category-queries";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { sourceId, destinationId, confirm } = body ?? {};

    if (typeof sourceId !== "string" || typeof destinationId !== "string") {
      return NextResponse.json(
        { error: "sourceId and destinationId are required." },
        { status: 400 },
      );
    }

    const result = await mergeCategories({
      sourceId,
      destinationId,
      confirm: confirm === true,
      actorUserId: session.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!result.confirm) {
      return NextResponse.json({
        plan: result.plan,
        sourceTransactionCount: result.sourceTransactionCount,
        destinationName: result.destinationName,
      });
    }

    return NextResponse.json({
      merged: true,
      destinationId: result.destinationId,
      affectedFiscalYears: result.affectedFiscalYears,
    });
  } catch (error) {
    console.error("Error merging ledger categories:", error);
    return NextResponse.json({ error: "Failed to merge categories" }, { status: 500 });
  }
}

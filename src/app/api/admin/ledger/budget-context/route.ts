/**
 * GET /api/admin/ledger/budget-context?fundId=<uuid>&fiscalYear=<int>
 *
 * Budget Context on Transaction Entry
 * (docs/work-log/2026-08-08-budget-context-on-transaction-entry.md,
 * DECISION-069/070). Returns, for one fund + fiscal year, every active
 * category's and every budget line's budgeted amount plus posted/pending
 * actuals — the data source for the read-only budget-context panel in
 * `TransactionForm`.
 *
 * Gate: BUDGET_VIEW OR LEDGER_MANAGE (any-of) — deliberately a SECOND,
 * independent check from the LEDGER_RECORD/LEDGER_MANAGE check that already
 * gates reaching the transaction-entry dialog. Every role holding
 * `ledger.record` today also holds `budget.view`, but that's a binding
 * coincidence, not a structural guarantee — see Phase 1's finding in the
 * work-log above. Do NOT relax this to LEDGER_RECORD on the theory that
 * "you can't reach the form without it anyway."
 *
 * Query params: fundId (required, UUID), fiscalYear (required, integer,
 * 2000-2100 — same sanity bound as POST /budget-approvals).
 *
 * Response 200: { fiscalYear, categories: BudgetContextCategoryRow[], lines: BudgetContextLineRow[] }
 * 400: fundId missing/not a UUID, or fiscalYear missing/non-integer/out of range.
 * 401: no session.
 * 403: caller holds neither BUDGET_VIEW nor LEDGER_MANAGE — generic
 *      { error: "Forbidden" }, no data leaked in the body.
 * 404: fund not found.
 * 500: unhandled error.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getBudgetContext } from "@/lib/ledger-budget-context-queries";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasAnyFeature(session.user.id, [FEATURES.BUDGET_VIEW, FEATURES.LEDGER_MANAGE]))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const fundId = searchParams.get("fundId");
    const fiscalYearRaw = searchParams.get("fiscalYear");

    if (!fundId || !UUID_RE.test(fundId)) {
      return NextResponse.json({ error: "fundId must be a valid UUID" }, { status: 400 });
    }

    const fiscalYear = fiscalYearRaw === null ? NaN : Number(fiscalYearRaw);
    if (
      fiscalYearRaw === null ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 2000 ||
      fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }

    const context = await getBudgetContext(fundId, fiscalYear);
    if (!context) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    return NextResponse.json(context);
  } catch (error) {
    console.error("Error loading budget context:", error);
    return NextResponse.json({ error: "Failed to load budget context" }, { status: 500 });
  }
}

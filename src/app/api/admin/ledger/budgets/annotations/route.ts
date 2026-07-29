/**
 * PATCH /api/admin/ledger/budgets/annotations
 *
 * Category-grain star/note write for Budget Star & Notes
 * (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md). Gate:
 * LEDGER_MANAGE.
 *
 * INTENTIONAL: this route never calls assertBudgetUnlocked(). Star/note are
 * working annotations, not budget figures — Phase 1 Decision 6
 * (docs/work-log/2026-07-28-budget-star-notes.md) requires them to stay
 * editable even when the FY budget is Approve-&-locked. Do NOT add a lock
 * check here to "make locking consistent" — that would silently reverse a
 * confirmed product decision. See DECISION-057. This is deliberately a
 * separate route from the lock-gated PATCH /api/admin/ledger/budgets
 * dispatcher, rather than a third body shape bolted onto it, so a
 * lock-gated and a deliberately-non-lock-gated write path never share one
 * dispatch function distinguished only by which body keys are present.
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   starred?: boolean;
 *   note?: string | null;   // at least one of starred/note is required
 * }
 *
 * Response 200: { starred: boolean; note: string | null }
 * Errors: 400 (bad shape; neither starred nor note present; note > 500
 *         chars after trim), 404 (fund or category not found)
 *
 * No 409 `locked` — ever. setBudgetCategoryAnnotation() lazy-creates the
 * ledger_budgets row (annualAmountCents: 0) when the category has no budget
 * row yet, and never touches an existing row's real annualAmountCents or an
 * existing note when only the other field is sent — see that function's doc
 * comment in src/lib/ledger-queries.ts for the exact conditional-upsert
 * shape.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { setBudgetCategoryAnnotation } from "@/lib/ledger-queries";

const VALID_FLOWS = ["income", "expense"] as const;

function isValidFlow(v: unknown): v is "income" | "expense" {
  return typeof v === "string" && (VALID_FLOWS as readonly string[]).includes(v);
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fundId, fiscalYear, categoryId, flow, starred, note } = body;

    if (!fundId || typeof fundId !== "string") {
      return NextResponse.json({ error: "fundId is required" }, { status: 400 });
    }
    if (!categoryId || typeof categoryId !== "string") {
      return NextResponse.json({ error: "categoryId is required" }, { status: 400 });
    }
    if (fiscalYear === undefined || typeof fiscalYear !== "number") {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }
    if (!isValidFlow(flow)) {
      return NextResponse.json({ error: "flow must be 'income' or 'expense'" }, { status: 400 });
    }
    if (starred !== undefined && typeof starred !== "boolean") {
      return NextResponse.json({ error: "starred must be a boolean" }, { status: 400 });
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
    }
    if (starred === undefined && note === undefined) {
      return NextResponse.json(
        { error: "At least one of starred or note is required" },
        { status: 400 },
      );
    }

    const result = await setBudgetCategoryAnnotation({
      fundId,
      fiscalYear,
      categoryId,
      flow,
      starred,
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ starred: result.starred, note: result.note });
  } catch (error) {
    console.error("Error writing ledger budget category annotation:", error);
    return NextResponse.json({ error: "Failed to update annotation" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/ledger/budgets
 *
 * Upsert or delete a budget line for a fund × fiscal year × category × flow.
 * Gate: LEDGER_MANAGE
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   annualAmountCents: number | null;
 *     // positive integer or 0 → upsert with that amount
 *     // null → delete the budget row (report shows "—" for that category)
 * }
 *
 * Response 200: { action: 'upserted' | 'deleted', id?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertBudgetLine } from "@/lib/ledger-queries";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";

const VALID_FLOWS = ["income", "expense"] as const;

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
    const { fundId, fiscalYear, categoryId, flow, annualAmountCents } = body;

    // Validate required fields (shape checks only — the shared upsertBudgetLine
    // core owns the fund/category/amount/fiscalYear validation via
    // validateBudgetLineInput()).
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
    if (!flow || !(VALID_FLOWS as readonly string[]).includes(flow)) {
      return NextResponse.json(
        { error: "flow must be 'income' or 'expense'" },
        { status: 400 },
      );
    }
    if (
      annualAmountCents !== null &&
      typeof annualAmountCents !== "number"
    ) {
      return NextResponse.json(
        { error: "annualAmountCents must be a non-negative integer, or null to remove the budget" },
        { status: 400 },
      );
    }

    const result = await upsertBudgetLine({
      fundId,
      fiscalYear,
      categoryId,
      flow,
      annualAmountCents,
      conflictMode: "update",
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      result.action === "deleted"
        ? { action: "deleted" }
        : { action: "upserted", id: result.id },
    );
  } catch (error) {
    console.error("Error upserting ledger budget:", error);
    return NextResponse.json({ error: "Failed to update budget" }, { status: 500 });
  }
}

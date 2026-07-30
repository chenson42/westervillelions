/**
 * POST /api/admin/ledger/budgets/cause-lines/collapse
 *
 * Collapse a category's cause breakdown back into a single lump sum (B-17
 * Increment A, Human Answer 4: sums the line items). Gate: LEDGER_MANAGE or BUDGET_EDIT
 *
 * Body: { fundId: string; fiscalYear: number; categoryId: string; flow: 'income' | 'expense' }
 *
 * Response 200: { action: 'collapsed', annualAmountCents: number }
 * Errors: 404 (no budget row), 409 (locked)
 *
 * Server behavior: deletes all ledger_budget_lines children for the category's
 * budget row. The parent's annualAmountCents is NOT recomputed here — per
 * DECISION-046 item 2, it already equals the sum of its children going into
 * this call (the standing invariant every prior write maintains), so
 * deleting the children and leaving the parent's number untouched *is*
 * "collapse by summing". Idempotent-safe on an already-lump-sum category.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { collapseBudgetCauseLines } from "@/lib/ledger-queries";

const VALID_FLOWS = ["income", "expense"] as const;

function isValidFlow(v: unknown): v is "income" | "expense" {
  return typeof v === "string" && (VALID_FLOWS as readonly string[]).includes(v);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasAnyFeature(session.user.id, [FEATURES.LEDGER_MANAGE, FEATURES.BUDGET_EDIT]))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fundId, fiscalYear, categoryId, flow } = body;

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
      return NextResponse.json(
        { error: "flow must be 'income' or 'expense'" },
        { status: 400 },
      );
    }

    const result = await db.transaction((tx) =>
      collapseBudgetCauseLines({ fundId, fiscalYear, categoryId, flow }, tx),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ action: "collapsed", annualAmountCents: result.annualAmountCents });
  } catch (error) {
    console.error("Error collapsing ledger budget cause lines:", error);
    return NextResponse.json({ error: "Failed to collapse budget cause lines" }, { status: 500 });
  }
}

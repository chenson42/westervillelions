/**
 * PATCH /api/admin/ledger/budgets/cause-lines
 *
 * Upsert one cause-tagged budget line item (B-17 Increment A, DECISION-045/046).
 * Also the entry point for a category's *first* cause line — i.e. "entering
 * breakdown mode" — there is no separate "convert to breakdown" endpoint; the
 * client pre-fills the first row locally and this route commits it like any
 * other (see docs/work-log/2026-07-27-ledger-cause-budget-lines.md Phase 3).
 * Gate: LEDGER_MANAGE
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   cause: string;             // must be one of BUDGET_CAUSES + OTHER_COMMUNITY_SUPPORT_CAUSE (src/lib/ledger.ts)
 *   amountCents: number;       // non-negative integer, required — no null/delete-via-amount here
 * }
 *
 * Response 200: { action: 'upserted', lineId: string, categoryTotalCents: number }
 * Errors: 400 (shape / off-taxonomy cause / bad amount), 404 (fund or category not found),
 *         409 (budget locked — "This budget is locked. Unlock it to make changes.")
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE /api/admin/ledger/budgets/cause-lines
 *
 * Remove one cause-tagged budget line item. Gate: LEDGER_MANAGE
 *
 * Body: { fundId: string; fiscalYear: number; categoryId: string; flow: 'income' | 'expense'; cause: string }
 *
 * Response 200: { action: 'line_deleted', categoryTotalCents: number }
 *           or: { action: 'parent_deleted' }   // this was the last cause line —
 *               mirrors upsertBudgetLine's annualAmountCents:null -> delete-the-row
 *               behavior, so "no target set" has exactly one representation.
 * Errors: 404 (no budget row for that tuple, or no line for that cause), 409 (locked)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { upsertBudgetCauseLine, deleteBudgetCauseLine } from "@/lib/ledger-queries";

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
    const { fundId, fiscalYear, categoryId, flow, cause, amountCents } = body;

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
    if (!cause || typeof cause !== "string") {
      return NextResponse.json({ error: "cause is required" }, { status: 400 });
    }
    if (typeof amountCents !== "number") {
      return NextResponse.json(
        { error: "amountCents must be a non-negative integer" },
        { status: 400 },
      );
    }

    // isValidBudgetCause() and the numeric-bounds checks run inside
    // upsertBudgetCauseLine (via validateBudgetLineInput) — no second copy
    // of those checks here.
    const result = await db.transaction((tx) =>
      upsertBudgetCauseLine({ fundId, fiscalYear, categoryId, flow, cause, amountCents }, tx),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      action: "upserted",
      lineId: result.lineId,
      categoryTotalCents: result.categoryTotalCents,
    });
  } catch (error) {
    console.error("Error upserting ledger budget cause line:", error);
    return NextResponse.json({ error: "Failed to update budget cause line" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_MANAGE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fundId, fiscalYear, categoryId, flow, cause } = body;

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
    if (!cause || typeof cause !== "string") {
      return NextResponse.json({ error: "cause is required" }, { status: 400 });
    }

    const result = await db.transaction((tx) =>
      deleteBudgetCauseLine({ fundId, fiscalYear, categoryId, flow, cause }, tx),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      result.action === "parent_deleted"
        ? { action: "parent_deleted" }
        : { action: "line_deleted", categoryTotalCents: result.categoryTotalCents },
    );
  } catch (error) {
    console.error("Error deleting ledger budget cause line:", error);
    return NextResponse.json({ error: "Failed to delete budget cause line" }, { status: 500 });
  }
}

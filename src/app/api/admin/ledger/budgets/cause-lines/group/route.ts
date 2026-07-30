/**
 * PATCH /api/admin/ledger/budgets/cause-lines/group
 *
 * Soft-delete or restore an ENTIRE cause group — every ledger_budget_lines
 * row under one (fund, fiscalYear, categoryId, flow, cause) — as a single
 * atomic flag-flip (Budgeting Page Restructure, Flow 5: "Remove *Environment*
 * and its N line items," one action, one transaction, DECISION-055 item 2).
 * New sibling route, following the existing `.../cause-lines/collapse`
 * precedent (a genuinely different address shape than the single-line PATCH
 * on `.../cause-lines`, so it gets its own file). Gate: LEDGER_MANAGE or BUDGET_EDIT
 *
 * Restore uses this SAME endpoint with `pendingDelete: false` — no time
 * limit, a persistent "Restore this group" control, matching the uniform
 * reversible-until-finalize model every other grain has. Distinct from
 * single-line removal's client-only delayed-commit toast (Undo there is a
 * `clearTimeout`, not a call to this or any endpoint).
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   cause: string;
 *   pendingDelete: boolean;    // true = soft-delete the group, false = restore
 * }
 *
 * Response 200: { action: 'pending-delete' | 'restored', lineCount: number }
 * Errors: 400 (bad shape), 404 (no budget row for this category/flow, or no
 *         line items exist for this cause), 409 { error: string, reason: 'locked' }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { setBudgetCauseGroupPendingDelete } from "@/lib/ledger-queries";

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
    if (!(await hasAnyFeature(session.user.id, [FEATURES.LEDGER_MANAGE, FEATURES.BUDGET_EDIT]))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fundId, fiscalYear, categoryId, flow, cause, pendingDelete } = body;

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
    if (typeof pendingDelete !== "boolean") {
      return NextResponse.json({ error: "pendingDelete must be a boolean" }, { status: 400 });
    }

    const result = await db.transaction((tx) =>
      setBudgetCauseGroupPendingDelete({ fundId, fiscalYear, categoryId, flow, cause, pendingDelete }, tx),
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
        { status: result.status },
      );
    }

    return NextResponse.json({ action: result.action, lineCount: result.lineCount });
  } catch (error) {
    console.error("Error updating ledger budget cause group pending-delete state:", error);
    return NextResponse.json(
      { error: "Failed to update budget cause group" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/admin/ledger/budgets
 *
 * Upsert/delete a budget line's amount, OR mark/restore a line as
 * pending-delete-until-finalize (DECISION-052/053, Increment 2 of
 * docs/work-log/2026-07-28-budgeting-page-redesign.md). Gate: LEDGER_MANAGE.
 *
 * Two mutually-exclusive request-body shapes for the same
 * (fundId, fiscalYear, categoryId, flow) tuple. Sending both or neither of
 * annualAmountCents/pendingDelete is a 400.
 *
 * Shape A — amount write (unchanged):
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   annualAmountCents: number | null;
 *     // positive integer or 0 → upsert with that amount
 *     // null → delete the budget row (report shows "—" for that category)
 * }
 * Response 200: { action: 'upserted' | 'deleted', id?: string }
 *
 * Shape B — pending-delete write (new):
 * {
 *   fundId: string;
 *   fiscalYear: number;
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   pendingDelete: boolean;    // true = soft-delete, false = restore
 * }
 * Response 200: { action: 'pending-delete' | 'restored' }
 *
 * Errors (both shapes): 400 (bad shape, or both/neither of
 * annualAmountCents/pendingDelete present), 404 (fund/category not found —
 * Shape B also 404s when no budget row exists for the tuple), 409 with
 * { reason: 'locked' | 'has_cause_breakdown' } (Shape B only surfaces
 * `reason` in the body; Shape A's response is unchanged from before this
 * increment).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertBudgetLine, setBudgetLinePendingDelete } from "@/lib/ledger-queries";
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
    const { fundId, fiscalYear, categoryId, flow, annualAmountCents, pendingDelete } = body;

    // Validate required fields shared by both shapes (shape checks only —
    // the shared upsertBudgetLine/setBudgetLinePendingDelete cores own the
    // fund/category/fiscalYear validation via validateBudgetLineInput()).
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

    // Shape dispatch (DECISION-053 item 1): both/neither of
    // annualAmountCents/pendingDelete present is a 400.
    const hasAnnualAmount = Object.prototype.hasOwnProperty.call(body, "annualAmountCents");
    const hasPendingDelete = Object.prototype.hasOwnProperty.call(body, "pendingDelete");

    if (hasAnnualAmount && hasPendingDelete) {
      return NextResponse.json(
        { error: "Provide either annualAmountCents or pendingDelete, not both." },
        { status: 400 },
      );
    }

    if (hasPendingDelete) {
      if (typeof pendingDelete !== "boolean") {
        return NextResponse.json(
          { error: "pendingDelete must be a boolean" },
          { status: 400 },
        );
      }

      const result = await setBudgetLinePendingDelete({
        fundId,
        fiscalYear,
        categoryId,
        flow,
        pendingDelete,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
          { status: result.status },
        );
      }

      return NextResponse.json({ action: result.action });
    }

    // Shape A — amount write. Falls through here (unchanged) both when
    // annualAmountCents is explicitly present and when NEITHER key is
    // present — the latter case is caught by the type check just below,
    // returning the same 400 this route always returned for a
    // missing/invalid annualAmountCents.
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

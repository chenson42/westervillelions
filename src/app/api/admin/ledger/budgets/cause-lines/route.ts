/**
 * PATCH /api/admin/ledger/budgets/cause-lines
 *
 * Create-or-update one cause-tagged budget line item (B-17 Increment A,
 * DECISION-045/046; re-keyed to `id` and given a `label` by Labeled Cause
 * Budget Lines, DECISION-047/048). Dispatches on the presence of `id` in the
 * body — one route, not two — matching B-17's existing route-count
 * discipline (DECISION-048 item 1).
 *
 * Also the entry point for a category's *first* cause line — i.e. "entering
 * breakdown mode" — there is no separate "convert to breakdown" endpoint; the
 * client pre-fills the first row locally and this route commits it like any
 * other (see docs/work-log/2026-07-27-ledger-cause-budget-lines.md Phase 3).
 * Gate: LEDGER_MANAGE
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * No `id` in the body → CREATE
 *
 * Body:
 * {
 *   fundId: string;
 *   fiscalYear: number;        // integer, e.g. 2026
 *   categoryId: string;
 *   flow: 'income' | 'expense';
 *   cause: string;             // must be one of BUDGET_CAUSES + OTHER_COMMUNITY_SUPPORT_CAUSE (src/lib/ledger.ts)
 *   label?: string;            // optional, defaults to ''; trimmed + capped at 120 chars server-side
 *   amountCents: number;       // non-negative integer, required
 * }
 *
 * Response 200: { action: 'created', lineId: string, cause: string, label: string, categoryTotalCents: number }
 * Errors: 400 (shape / off-taxonomy cause / bad amount / label > 120 chars after trim),
 *         404 (fund or category not found),
 *         409 { error: string, reason: 'locked' | 'duplicate_cause_label' }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `id` present in the body → UPDATE
 *
 * A line's cause is fixed at creation — there is no in-place cause change in
 * this increment (DECISION-048 item 2). Moving a line to a different cause is
 * DELETE the old line + CREATE a new one.
 *
 * Body: { id: string; label?: string; amountCents?: number }   // at least one of label/amountCents required
 * Response 200: { action: 'updated', lineId: string, cause: string, label: string, categoryTotalCents: number }
 * Errors: 400 (neither label nor amountCents provided / bad amount / label > 120 chars),
 *         404 (no line with this id),
 *         409 { error: string, reason: 'locked' | 'duplicate_cause_label' }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DELETE /api/admin/ledger/budgets/cause-lines
 *
 * Remove one cause-tagged budget line item, addressed by `id`. Gate: LEDGER_MANAGE
 *
 * Body: { id: string }
 * Response 200: { action: 'line_deleted', categoryTotalCents: number }
 *           or: { action: 'parent_deleted' }   // this was the last cause line —
 *               mirrors upsertBudgetLine's annualAmountCents:null -> delete-the-row
 *               behavior, so "no target set" has exactly one representation.
 * Errors: 404 (no line with this id), 409 { error: string, reason: 'locked' }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { createBudgetCauseLine, updateBudgetCauseLine, deleteBudgetCauseLine } from "@/lib/ledger-queries";

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
    const { id } = body;

    // --- UPDATE: id present ---------------------------------------------
    if (id !== undefined) {
      if (typeof id !== "string" || !id) {
        return NextResponse.json({ error: "id must be a string" }, { status: 400 });
      }
      const { label, amountCents } = body;
      if (label !== undefined && typeof label !== "string") {
        return NextResponse.json({ error: "label must be a string" }, { status: 400 });
      }
      if (amountCents !== undefined && typeof amountCents !== "number") {
        return NextResponse.json(
          { error: "amountCents must be a non-negative integer" },
          { status: 400 },
        );
      }
      if (label === undefined && amountCents === undefined) {
        return NextResponse.json(
          { error: "At least one of label or amountCents is required" },
          { status: 400 },
        );
      }

      const result = await db.transaction((tx) =>
        updateBudgetCauseLine({ id, label, amountCents }, tx),
      );

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
          { status: result.status },
        );
      }

      return NextResponse.json({
        action: "updated",
        lineId: result.lineId,
        cause: result.cause,
        label: result.label,
        categoryTotalCents: result.categoryTotalCents,
      });
    }

    // --- CREATE: no id ----------------------------------------------------
    const { fundId, fiscalYear, categoryId, flow, cause, label, amountCents } = body;

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
    if (label !== undefined && typeof label !== "string") {
      return NextResponse.json({ error: "label must be a string" }, { status: 400 });
    }
    if (typeof amountCents !== "number") {
      return NextResponse.json({ error: "amountCents must be a non-negative integer" }, { status: 400 });
    }

    // isValidBudgetCause() and the numeric-bounds checks run inside
    // createBudgetCauseLine (via validateBudgetLineInput) — no second copy
    // of those checks here.
    const result = await db.transaction((tx) =>
      createBudgetCauseLine({ fundId, fiscalYear, categoryId, flow, cause, label, amountCents }, tx),
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
        { status: result.status },
      );
    }

    return NextResponse.json({
      action: "created",
      lineId: result.lineId,
      cause: result.cause,
      label: result.label,
      categoryTotalCents: result.categoryTotalCents,
    });
  } catch (error) {
    console.error("Error writing ledger budget cause line:", error);
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
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const result = await db.transaction((tx) => deleteBudgetCauseLine(id, tx));

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
        { status: result.status },
      );
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

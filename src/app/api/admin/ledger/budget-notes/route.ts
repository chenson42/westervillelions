/**
 * PATCH /api/admin/ledger/budget-notes
 *
 * Upserts the free-text budget-level "Notes & Assumptions" note for one
 * (entityId, fiscalYear) — Budgeting Overview/Drill-Down Restructure
 * (DECISION-060, docs/work-log/2026-07-30-budgeting-overview-restructure.md).
 * Rendered on the overview between BudgetOverviewTable and the print
 * worksheet's data, and reproduced on the printed board document's front
 * page (per B-31's design, folded into this restructure).
 *
 * Gate: LEDGER_MANAGE OR BUDGET_EDIT (any-of) — same gate as the existing
 * category-grain PATCH /api/admin/ledger/budgets/annotations.
 *
 * INTENTIONAL: this route never calls assertBudgetUnlocked(). A budget-level
 * note is commentary, not a budget figure — same reasoning
 * budgets/annotations/route.ts's own doc comment gives for category
 * star/notes (DECISION-057), extended here to the coarser, budget-level
 * grain (DECISION-060). A board that just approved a budget, or is amending
 * one, needs to be able to annotate WHY without unlocking the dollar
 * amounts. Do NOT add a lock check here to "make locking consistent" — that
 * would silently reverse a confirmed product decision.
 *
 * Body:
 * {
 *   entityId: string;
 *   fiscalYear: number;
 *   notes: string;   // "" clears the note
 * }
 *
 * Response 200: { entityId, fiscalYear, notes, updatedAt }
 * Errors: 400 (bad shape; notes > 4000 chars after trim), 401, 403,
 *         404 (entityId not found)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerBudgetNotes } from "@/lib/db/schema";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById } from "@/lib/ledger-queries";
import { normalizeBudgetNote } from "@/lib/ledger";

const MAX_BUDGET_NOTES_LENGTH = 4000;

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
    const { entityId, fiscalYear, notes: rawNotes } = body;

    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json({ error: "entityId is required" }, { status: 400 });
    }
    if (
      fiscalYear === undefined ||
      typeof fiscalYear !== "number" ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 2000 ||
      fiscalYear > 2100
    ) {
      return NextResponse.json(
        { error: "fiscalYear must be an integer between 2000 and 2100" },
        { status: 400 },
      );
    }
    if (typeof rawNotes !== "string") {
      return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
    }

    const notes = normalizeBudgetNote(rawNotes);
    if (notes.length > MAX_BUDGET_NOTES_LENGTH) {
      return NextResponse.json(
        { error: `notes must be ${MAX_BUDGET_NOTES_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const updatedAt = new Date();
    const [row] = await db
      .insert(ledgerBudgetNotes)
      .values({
        entityId,
        fiscalYear,
        notes,
        updatedByUserId: session.user.id,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [ledgerBudgetNotes.entityId, ledgerBudgetNotes.fiscalYear],
        set: {
          notes,
          updatedByUserId: session.user.id,
          updatedAt,
        },
      })
      .returning();

    return NextResponse.json({
      entityId: row.entityId,
      fiscalYear: row.fiscalYear,
      notes: row.notes,
      updatedAt: row.updatedAt,
    });
  } catch (error) {
    console.error("Error writing ledger budget notes:", error);
    return NextResponse.json({ error: "Failed to save budget notes" }, { status: 500 });
  }
}

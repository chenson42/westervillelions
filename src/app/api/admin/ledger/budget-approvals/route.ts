/**
 * POST /api/admin/ledger/budget-approvals
 *
 * Guided Budgeting — approves/locks a year's budget for one entity. Locking
 * is a metadata flag on (entityId, fiscalYear); it never touches
 * ledgerTransactions, never moves money, and never crosses fund boundaries.
 * Once locked, every write path touching ledger_budgets or ledger_categories
 * for that (entityId, fiscalYear) is rejected server-side by
 * assertBudgetUnlocked() (wired into upsertBudgetLine and explicitly into
 * POST /categories) — this route only flips that state.
 *
 * FINALIZE PURGE (DECISION-052/053, Increment 2 of
 * docs/work-log/2026-07-28-budgeting-page-redesign.md; extended by the
 * Budgeting Page Restructure, DECISION-054/055/056): approve/lock is also
 * the one moment any pending-delete budget lines/categories for this
 * (entityId, fiscalYear) actually get removed. The lock-status check, the
 * lock-status write, the category-grain purge, and the cause-line-grain
 * purge all run inside ONE db.transaction() — this closes a pre-existing
 * check-then-act race (two concurrent finalize requests could previously
 * both read "unlocked" before either wrote) in the same motion that makes
 * every purge step atomic with the lock. Two purge steps, in order:
 *   1. Hard-delete every pending-delete ledger_budgets (category) row —
 *      cascades away its ledger_budget_lines children via ON DELETE CASCADE
 *      regardless of their own flag.
 *   2. Hard-delete every pending-delete ledger_budget_lines row that
 *      survived step 1 (i.e. its parent category was NOT itself
 *      pending-delete) — a cause line independently removed via Flow 4/5
 *      while its category stayed live. Every category this step touches has
 *      its annualAmountCents recomputed from survivors, or — if the purge
 *      emptied its last surviving cause line — the now-childless category
 *      is deleted too, mirroring deleteBudgetCauseLine's existing
 *      "emptying the last line deletes the parent" behavior.
 *
 * Gate: LEDGER_APPROVE
 *
 * No self-approval block (locked decision, Phase 1/2/3): budget adoption is a
 * board vote about a plan, not a single person moving money, so unlike
 * transactions/[id]/approve there is no "recorder vs. approver" distinction
 * to enforce here.
 *
 * Body:
 * {
 *   entityId: string;
 *   fiscalYear: number;   // integer 2000-2100
 *   boardMinute: string;  // required, trimmed, max 500 chars
 * }
 *
 * Response 200:
 * { entityId, fiscalYear, status: 'locked', approvedByUserId, approvedAt, boardMinute }
 *
 * Errors:
 *   400 — fiscalYear out of range, or boardMinute missing/blank after trim
 *   401 — not authenticated
 *   403 — forbidden (missing LEDGER_APPROVE)
 *   404 — entityId not found
 *   409 — (entityId, fiscalYear) is already locked — "This budget is already
 *         locked. Unlock it to make changes and re-approve." (DECISION-044:
 *         forces an explicit unlock-then-relock rather than silently
 *         overwriting the prior approval's trio)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerBudgetApprovals, ledgerBudgets, ledgerBudgetLines } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById, getBudgetApproval } from "@/lib/ledger-queries";
import { validateRequiredTrimmedText, isBudgetLocked, sumBudgetCauseLines } from "@/lib/ledger";

const BOARD_MINUTE_MAX_LEN = 500;

// Thrown inside the db.transaction() below to force a rollback when the
// lock-check (now run INSIDE the transaction, DECISION-052/053) finds the
// budget already locked. Mirrors the seed route's SeedLockedError pattern
// (src/app/api/admin/ledger/budgets/seed/route.ts) — a typed sentinel the
// outer catch recognizes and maps back to the existing 409, while any other
// thrown error still falls through to the generic 500 branch.
class BudgetAlreadyLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetAlreadyLockedError";
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_APPROVE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { entityId, fiscalYear, boardMinute: rawBoardMinute } = body;

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

    const boardMinuteResult = validateRequiredTrimmedText(rawBoardMinute, BOARD_MINUTE_MAX_LEN);
    if (!boardMinuteResult.ok) {
      return NextResponse.json({ error: "boardMinute is required" }, { status: 400 });
    }
    const boardMinute = boardMinuteResult.value;

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const approvedAt = new Date();
    const row = await db.transaction(async (tx) => {
      // Lock-check moved INSIDE the transaction (DECISION-052/053) — closes
      // the check-then-act race the pre-existing pre-transaction check had.
      const current = await getBudgetApproval(entityId, fiscalYear, tx);
      if (isBudgetLocked(current)) {
        throw new BudgetAlreadyLockedError(
          "This budget is already locked. Unlock it to make changes and re-approve.",
        );
      }

      const [approvalRow] = await tx
        .insert(ledgerBudgetApprovals)
        .values({
          entityId,
          fiscalYear,
          status: "locked",
          approvedByUserId: session.user.id,
          approvedAt,
          boardMinute,
          updatedAt: approvedAt,
        })
        .onConflictDoUpdate({
          target: [ledgerBudgetApprovals.entityId, ledgerBudgetApprovals.fiscalYear],
          set: {
            status: "locked",
            approvedByUserId: session.user.id,
            approvedAt,
            boardMinute,
            updatedAt: approvedAt,
          },
        })
        .returning();

      // Finalize purge: hard-delete every pending-delete ledger_budgets row
      // for this entity+FY, atomically with the lock write. Scoped by
      // entityId (not fundId) — approval itself is entity-wide across all of
      // that entity's funds. No history/versioning table: this is a genuine,
      // permanent delete, matching this table's pre-existing hard-delete-on-
      // remove behavior. `ledger_budget_lines` rows under a purged category
      // cascade away via its FK's ON DELETE CASCADE regardless of their own
      // pendingDeleteAt state — this is the only category-grain purge step.
      await tx
        .delete(ledgerBudgets)
        .where(
          and(
            eq(ledgerBudgets.entityId, entityId),
            eq(ledgerBudgets.fiscalYear, fiscalYear),
            isNotNull(ledgerBudgets.pendingDeleteAt),
          ),
        );

      // Budgeting Page Restructure (DECISION-054/055/056): a cause line can
      // now independently reach pending-delete (Flow 4/5) while its parent
      // category stays live — that column has no interactive write path
      // OTHER than setBudgetCauseLinePendingDelete /
      // setBudgetCauseGroupPendingDelete, neither of which ever touches the
      // category. The step above already removed every cause line whose
      // PARENT was purged (via cascade); this second step purges the
      // remaining case — cause lines pending-delete on their OWN flag under
      // categories that are still live (surviving the step above).
      const survivingBudgetRows = await tx
        .select({ id: ledgerBudgets.id })
        .from(ledgerBudgets)
        .where(and(eq(ledgerBudgets.entityId, entityId), eq(ledgerBudgets.fiscalYear, fiscalYear)));
      const survivingBudgetIds = survivingBudgetRows.map((r) => r.id);

      if (survivingBudgetIds.length > 0) {
        const purgedLineRows = await tx
          .delete(ledgerBudgetLines)
          .where(
            and(
              inArray(ledgerBudgetLines.budgetId, survivingBudgetIds),
              isNotNull(ledgerBudgetLines.pendingDeleteAt),
            ),
          )
          .returning({ budgetId: ledgerBudgetLines.budgetId });

        // Every category this step actually purged lines from needs its
        // annualAmountCents recomputed from survivors (mirrors
        // deleteBudgetCauseLine's own per-write recompute, just run again
        // here for each budgetId this batch touched) — or, if the purge
        // emptied a category's LAST surviving cause line, the now-childless
        // parent ledger_budgets row is deleted too, mirroring
        // deleteBudgetCauseLine's existing "emptying the last line deletes
        // the parent" behavior exactly, just reached via finalize instead of
        // a live edit.
        const affectedBudgetIds = Array.from(new Set(purgedLineRows.map((r) => r.budgetId)));
        for (const budgetId of affectedBudgetIds) {
          const remaining = await tx
            .select({ amountCents: ledgerBudgetLines.amountCents })
            .from(ledgerBudgetLines)
            .where(eq(ledgerBudgetLines.budgetId, budgetId));

          if (remaining.length === 0) {
            await tx.delete(ledgerBudgets).where(eq(ledgerBudgets.id, budgetId));
          } else {
            const categoryTotalCents = sumBudgetCauseLines(remaining);
            await tx
              .update(ledgerBudgets)
              .set({ annualAmountCents: categoryTotalCents, updatedAt: new Date() })
              .where(eq(ledgerBudgets.id, budgetId));
          }
        }
      }

      return approvalRow;
    });

    return NextResponse.json({
      entityId: row.entityId,
      fiscalYear: row.fiscalYear,
      status: row.status,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt,
      boardMinute: row.boardMinute,
    });
  } catch (error) {
    if (error instanceof BudgetAlreadyLockedError) {
      // db.transaction() has already rolled back — no lock-state or
      // pending-delete-purge write from this request took effect.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error approving/locking budget:", error);
    return NextResponse.json({ error: "Failed to approve budget" }, { status: 500 });
  }
}

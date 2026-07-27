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
import { ledgerBudgetApprovals } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById, getBudgetApproval } from "@/lib/ledger-queries";
import { validateRequiredTrimmedText, isBudgetLocked } from "@/lib/ledger";

const BOARD_MINUTE_MAX_LEN = 500;

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

    const current = await getBudgetApproval(entityId, fiscalYear);
    if (isBudgetLocked(current)) {
      return NextResponse.json(
        { error: "This budget is already locked. Unlock it to make changes and re-approve." },
        { status: 409 },
      );
    }

    const approvedAt = new Date();
    const [row] = await db
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

    return NextResponse.json({
      entityId: row.entityId,
      fiscalYear: row.fiscalYear,
      status: row.status,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt,
      boardMinute: row.boardMinute,
    });
  } catch (error) {
    console.error("Error approving/locking budget:", error);
    return NextResponse.json({ error: "Failed to approve budget" }, { status: 500 });
  }
}

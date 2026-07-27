/**
 * POST /api/admin/ledger/budget-approvals/unlock
 *
 * Guided Budgeting — unlocks a previously-approved budget for one
 * (entityId, fiscalYear) so it can be amended, then re-approved via
 * POST /budget-approvals. Sets the unlock trio and flips status back to
 * 'unlocked'; the approval trio (approvedByUserId/approvedAt/boardMinute)
 * is left untouched (DECISION-043: neither lock nor unlock clears the
 * other's fields, so the most recent lock and most recent unlock are both
 * visible at once).
 *
 * Gate: LEDGER_APPROVE
 *
 * Body:
 * {
 *   entityId: string;
 *   fiscalYear: number;    // integer 2000-2100
 *   unlockReason: string;  // required, trimmed, max 500 chars
 * }
 *
 * Response 200:
 * { entityId, fiscalYear, status: 'unlocked', unlockedByUserId, unlockedAt, unlockReason }
 *
 * Errors:
 *   400 — fiscalYear out of range, or unlockReason missing/blank after trim
 *   401 — not authenticated
 *   403 — forbidden (missing LEDGER_APPROVE)
 *   404 — entityId not found
 *   409 — no ledgerBudgetApprovals row exists yet, or the existing row's
 *         status is not 'locked' — "This budget is not currently locked."
 *         (can't unlock something that was never approved)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ledgerBudgetApprovals } from "@/lib/db/schema";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById, getBudgetApproval } from "@/lib/ledger-queries";
import { validateRequiredTrimmedText, isBudgetLocked } from "@/lib/ledger";

const UNLOCK_REASON_MAX_LEN = 500;

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
    const { entityId, fiscalYear, unlockReason: rawUnlockReason } = body;

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

    const unlockReasonResult = validateRequiredTrimmedText(rawUnlockReason, UNLOCK_REASON_MAX_LEN);
    if (!unlockReasonResult.ok) {
      return NextResponse.json({ error: "unlockReason is required" }, { status: 400 });
    }
    const unlockReason = unlockReasonResult.value;

    const entity = await getEntityById(entityId);
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const current = await getBudgetApproval(entityId, fiscalYear);
    if (!isBudgetLocked(current)) {
      return NextResponse.json(
        { error: "This budget is not currently locked." },
        { status: 409 },
      );
    }

    const unlockedAt = new Date();
    const [row] = await db
      .insert(ledgerBudgetApprovals)
      .values({
        entityId,
        fiscalYear,
        status: "unlocked",
        unlockedByUserId: session.user.id,
        unlockedAt,
        unlockReason,
        updatedAt: unlockedAt,
      })
      .onConflictDoUpdate({
        target: [ledgerBudgetApprovals.entityId, ledgerBudgetApprovals.fiscalYear],
        set: {
          status: "unlocked",
          unlockedByUserId: session.user.id,
          unlockedAt,
          unlockReason,
          updatedAt: unlockedAt,
        },
      })
      .returning();

    return NextResponse.json({
      entityId: row.entityId,
      fiscalYear: row.fiscalYear,
      status: row.status,
      unlockedByUserId: row.unlockedByUserId,
      unlockedAt: row.unlockedAt,
      unlockReason: row.unlockReason,
    });
  } catch (error) {
    console.error("Error unlocking budget:", error);
    return NextResponse.json({ error: "Failed to unlock budget" }, { status: 500 });
  }
}

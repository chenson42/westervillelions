/**
 * PATCH /api/admin/ledger/budgets/cause-lines/annotations
 *
 * Cause-line-grain star/note write for Budget Star & Notes
 * (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md). Gate:
 * LEDGER_MANAGE.
 *
 * INTENTIONAL: this route never calls assertBudgetUnlocked(). Star/note are
 * working annotations, not budget figures — Phase 1 Decision 6
 * (docs/work-log/2026-07-28-budget-star-notes.md) requires them to stay
 * editable even when the FY budget is Approve-&-locked. Do NOT add a lock
 * check here to "make locking consistent" — that would silently reverse a
 * confirmed product decision. See DECISION-057. This is deliberately a
 * separate route from the lock-gated PATCH
 * /api/admin/ledger/budgets/cause-lines dispatcher, rather than a third body
 * shape bolted onto it.
 *
 * Body: { id: string; starred?: boolean; note?: string | null }
 *       // at least one of starred/note is required
 *
 * Response 200: { starred: boolean; note: string | null }
 * Errors: 400 (bad shape; neither field present; note > 500 chars after
 *         trim), 404 (no cause line for this id)
 *
 * No 409 `locked` — ever. No lazy-create: unlike the category grain, a
 * cause line only ever exists once actually created via the existing
 * create-or-update route — setBudgetCauseLineAnnotation() is a plain
 * conditional UPDATE ... WHERE id.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { setBudgetCauseLineAnnotation } from "@/lib/ledger-queries";

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
    const { id, starred, note } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (starred !== undefined && typeof starred !== "boolean") {
      return NextResponse.json({ error: "starred must be a boolean" }, { status: 400 });
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
    }
    if (starred === undefined && note === undefined) {
      return NextResponse.json(
        { error: "At least one of starred or note is required" },
        { status: 400 },
      );
    }

    const result = await setBudgetCauseLineAnnotation({ id, starred, note });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ starred: result.starred, note: result.note });
  } catch (error) {
    console.error("Error writing ledger budget cause line annotation:", error);
    return NextResponse.json({ error: "Failed to update annotation" }, { status: 500 });
  }
}

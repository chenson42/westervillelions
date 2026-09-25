/**
 * POST /api/admin/ledger/reports/send — "Send to Board" for a Monthly
 * Statement of Financial Condition.
 *
 * Body: { entityId: string; month: string }   // month = 'YYYY-MM'
 *
 * Gate: independently checks auth() + hasFeature(LEDGER_REPORT_SEND) in this
 * handler's own body — the existing /admin/ledger/reports PAGE keeps its
 * unrelated LEDGER_VIEW gate (proxy-derived from ADMIN_NAVIGATION per
 * DECISION-082); this route is reachable at that same nav segment but must
 * never infer authorization from the fact that the request reached it.
 *
 * Thin wrapper only — all real logic (fingerprinting, claim ordering,
 * treasurer resolution, email composition) lives in
 * sendMonthlyReportToBoard() (src/lib/financial-report-send.ts) so it's
 * unit-testable without a route handler.
 *
 * docs/work-log/2026-09-25-financial-report-auto-send.md, Phase 3 "API
 * Contract".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { sendMonthlyReportToBoard } from "@/lib/financial-report-send";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await hasFeature(session.user.id, FEATURES.LEDGER_REPORT_SEND))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    const entityId = typeof body?.entityId === "string" ? body.entityId.trim() : "";
    const month = typeof body?.month === "string" ? body.month.trim() : "";
    if (!entityId || !month) {
      return NextResponse.json({ error: "invalid_month" }, { status: 400 });
    }

    const result = await sendMonthlyReportToBoard(entityId, month, session.user.id);

    if (result.ok) {
      return NextResponse.json({
        ok: true,
        emailQueueId: result.emailQueueId,
        sentAt: result.sentAt,
        corrected: result.corrected,
      });
    }

    const statusByReason: Record<typeof result.reason, number> = {
      not_found: 404,
      invalid_month: 400,
      not_ready: 409,
      already_sent: 409,
      treasurer_unresolved: 422,
      send_failed: 502,
      // Distinct from send_failed: sendEmail() never attempted delivery —
      // the non-production deny-by-default guard refused it. This is the
      // expected outcome in dev/test, not a Resend error.
      blocked_non_production: 503,
    };

    return NextResponse.json(
      { error: result.reason, ...(result.detail ? { detail: result.detail } : {}) },
      { status: statusByReason[result.reason] },
    );
  } catch (error) {
    console.error("Error sending financial report to board:", error);
    return NextResponse.json({ error: "Failed to send financial report" }, { status: 500 });
  }
}

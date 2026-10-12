/**
 * GET /api/admin/santas-workshop/sessions/[id]/zeffy/events?limit=  -> ZeffyEventsResponse
 *
 * Recent webhook events for this session's campaign. The stored payload is
 * NEVER returned (hasPayload only). lastValidEventAt is the newest event of any
 * campaign (proof the webhook is alive: a bad signature is never logged).
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";
import { lastCampaignEventReceivedAt, lastEventReceivedAt, recentEvents } from "@/lib/zeffy/events-queries";
import type { ZeffyEventsResponse } from "@/lib/santas-workshop/admin-contract";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    const events = await recentEvents({ id: row.id, campaignId: row.zeffyCampaignId }, Number.isFinite(limit) ? limit : 50);
    const body: ZeffyEventsResponse = {
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        paymentId: e.paymentId,
        outcome: e.outcome,
        errorCode: e.errorCode,
        attempts: e.attempts,
        receivedAt: e.receivedAt.toISOString(),
        processedAt: e.processedAt ? e.processedAt.toISOString() : null,
        hasPayload: e.hasPayload,
      })),
      lastValidEventAt: (await lastEventReceivedAt())?.toISOString() ?? null,
      lastCampaignEventAt: row.zeffyCampaignId
        ? ((await lastCampaignEventReceivedAt(row.zeffyCampaignId))?.toISOString() ?? null)
        : null,
    };
    return ok(body);
  } catch (e) {
    return serverError("list events", e);
  }
}

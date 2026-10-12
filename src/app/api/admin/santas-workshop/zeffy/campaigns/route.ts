/**
 * GET /api/admin/santas-workshop/zeffy/campaigns  -> ZeffyCampaignsResponse
 *
 * The organisation's Zeffy campaigns (metadata only: id, title, dates, ticket
 * rates; no personal data) for the Connect picker, each with the session it is
 * already connected to. Outside production only campaigns on
 * ZEFFY_DEV_CAMPAIGN_ALLOWLIST are listed (and nothing at all if it is unset).
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { createZeffyClient, ZeffyError } from "@/lib/zeffy/client";
import { forbidden, ok, serverError, unauthorized, zeffyFailure } from "@/lib/santas-workshop/admin-http";
import { campaignConnections } from "@/lib/santas-workshop/session-queries";
import type { ZeffyCampaignsResponse } from "@/lib/santas-workshop/admin-contract";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  try {
    const campaigns = await createZeffyClient().listCampaigns();
    const sessionOf = await campaignConnections();
    const iso = (s: number | null) => (s === null ? null : new Date(s * 1000).toISOString());
    const body: ZeffyCampaignsResponse = {
      campaigns: campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        status: c.status,
        startsAt: iso(c.startSeconds),
        endsAt: iso(c.endSeconds),
        rates: c.rates,
        connectedSessionId: sessionOf.get(c.id) ?? null,
      })),
    };
    return ok(body);
  } catch (e) {
    if (e instanceof ZeffyError) return zeffyFailure(e);
    return serverError("list campaigns", e);
  }
}

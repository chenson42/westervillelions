/**
 * PUT /api/admin/santas-workshop/sessions/[id]/zeffy  -> ConnectCampaignResponse
 *
 * Connect = a Zeffy campaign id + the ticket rate ids that make a stuffy. One
 * campaign maps to at most one session (409 campaign_in_use). Zeffy is asked
 * to confirm the campaign and its rates; when it cannot be asked (no API key,
 * or the dev allowlist) the connection proceeds as typed with verified:false.
 * The UI wraps this in a ConfirmDialog that shows the campaign title.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { createZeffyClient } from "@/lib/zeffy/client";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { connectCampaign } from "@/lib/santas-workshop/session-queries";
import { validateConnectCampaign } from "@/lib/santas-workshop/session-input";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const input = validateConnectCampaign(await readJson(request));
    if (!input.ok) return adminError(400, input.code, input.error, input.field);
    const result = await connectCampaign(id, input.value, session.user.id, createZeffyClient());
    return result.ok ? ok(result.response) : fromFailure(result);
  } catch (e) {
    return serverError("connect campaign", e);
  }
}

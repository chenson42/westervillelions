/**
 * POST /api/admin/santas-workshop/sessions/[id]/zeffy/payments/[paymentId]/reprocess  -> ReprocessResult
 *
 * Fetch ONE payment from Zeffy and apply it to this session, provided it belongs
 * to the session's connected form (409 session_mismatch otherwise). The
 * staleness guard still applies, so this can never un-refund an order.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { getSessionRow } from "@/lib/santas-workshop/session-queries";
import { reprocessPayment } from "@/lib/santas-workshop/zeffy-reprocess";
import type { ReprocessResult } from "@/lib/santas-workshop/admin-contract";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id, paymentId } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  if (!paymentId || paymentId.length > 200 || /[\s/?#]/.test(paymentId)) {
    return adminError(400, "invalid_input", "Payment id is not valid", "paymentId");
  }
  try {
    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    if (row.personalPurgedAt) return adminError(409, "session_purged", "A purged session cannot be edited");
    if (!row.zeffyCampaignId) return adminError(409, "not_mapped", "Connect a Zeffy form first");

    const result = await reprocessPayment({ id: row.id, zeffyCampaignId: row.zeffyCampaignId }, paymentId);
    if (result.outcome === "failed") {
      if (result.code === "no_api_key") return adminError(503, "zeffy_not_configured", "The Zeffy API key is not configured");
      if (result.code === "session_mismatch") return adminError(409, "session_mismatch", "That payment belongs to another session");
      if (result.code === "zeffy_rate_limited") return adminError(503, "zeffy_rate_limited", "Zeffy is limiting requests; try again shortly");
      return adminError(502, "zeffy_unavailable", "The payment could not be processed");
    }
    if (result.outcome === "ignored_unmapped" && result.code === "campaign_mismatch") {
      return adminError(409, "session_mismatch", "That payment belongs to a different Zeffy form");
    }
    if (result.outcome === "ignored_unmapped" && result.code === "unknown_payment") {
      return adminError(404, "payment_unknown", "Zeffy has no such payment");
    }
    const body: ReprocessResult = { outcome: result.outcome, code: "code" in result && result.code ? result.code : null };
    return ok(body);
  } catch (e) {
    return serverError("reprocess payment", e);
  }
}

/**
 * POST /api/admin/santas-workshop/zeffy/events/[eventId]/reprocess  -> ReprocessResult
 *
 * Re-run one logged webhook event: from its stored (whitelisted) snapshot, or,
 * when none was stored, by re-fetching its payment. The staleness guard still
 * applies. Use after fixing the cause of a `failed` event (for example a missing
 * API key) or after connecting a form an earlier event arrived for.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { adminError, forbidden, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { reprocessEvent } from "@/lib/santas-workshop/zeffy-reprocess";

export async function POST(_request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { eventId } = await params;
  if (!eventId || eventId.length > 200 || /[\s/?#]/.test(eventId)) {
    return adminError(400, "invalid_input", "Event id is not valid", "eventId");
  }
  try {
    const result = await reprocessEvent(eventId);
    if (!result.found) return adminError(404, "event_not_found", "No such event");
    return ok(result.result);
  } catch (e) {
    return serverError("reprocess event", e);
  }
}

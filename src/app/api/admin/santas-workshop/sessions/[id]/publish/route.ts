/**
 * POST /api/admin/santas-workshop/sessions/[id]/publish  { action: "publish" | "unpublish" }  -> PublishResponse
 *
 * Publish makes the collage page live (and, later, family pages) and stamps every
 * reviewed, unhidden group photo. Refused with 409 `photos_unreviewed` (and a
 * count) while any group photo has not been reviewed. Repeatable for late photos.
 * Unpublish returns the page to "pending". Both are audited.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { PUBLISH_ACTIONS, type PublishAction } from "@/lib/santas-workshop/admin-contract";
import { setCollagePublished } from "@/lib/santas-workshop/photo-admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = (await readJson(request)) as { action?: unknown } | null;
    if (!body || typeof body.action !== "string" || !(PUBLISH_ACTIONS as readonly string[]).includes(body.action)) {
      return adminError(400, "invalid_input", "Choose publish or unpublish", "action");
    }
    const result = await setCollagePublished(id, body.action as PublishAction, session.user.id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("publish collage", e);
  }
}

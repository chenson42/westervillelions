/**
 * POST /api/admin/santas-workshop/sessions/[id]/frames/exported
 *   { items: [{ stuffyId, photoId, frameNumber }], partial? }  -> FramesExportedResponse
 *
 * The browser calls this per part with the frames it actually produced. Stamps
 * `frame_exported_photo_id` with the portrait it used, so a later retake reads "changed since
 * export". Idempotent (a repeat is `unchanged`); items that do not match a stuffy, its frame
 * number and a portrait of this session come back in `rejected`.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { parseExportedItems } from "@/lib/santas-workshop/frame-export-input";
import { markFramesExported } from "@/lib/santas-workshop/frame-export";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const body = await readJson(request);
    const items = parseExportedItems(body);
    if (!items) return adminError(400, "invalid_input", "items must be a list of { stuffyId, photoId, frameNumber }", "items");
    const result = await markFramesExported(id, items, (body as { partial?: unknown }).partial === true, session.user.id);
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("frames exported", e);
  }
}

/**
 * GET /api/admin/santas-workshop/sessions/[id]/photos?kind=group|portrait&page=1  -> PhotosListResponse
 *
 * Current group photos and portraits (60 per page) with the hidden flag, consent,
 * review state and whether a stranger sees each one, plus the counts and the
 * collage address. No storage keys; images load through the photo door by id.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { PHOTO_LIST_KINDS, type PhotoListKind } from "@/lib/santas-workshop/admin-contract";
import { listSessionPhotos } from "@/lib/santas-workshop/photo-admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const url = new URL(request.url);
    const kindParam = url.searchParams.get("kind");
    if (kindParam !== null && !(PHOTO_LIST_KINDS as readonly string[]).includes(kindParam)) {
      return adminError(400, "invalid_input", "kind must be group or portrait", "kind");
    }
    const pageParam = url.searchParams.get("page");
    const page = pageParam === null ? 1 : Number(pageParam);
    if (!Number.isInteger(page) || page < 1 || page > 1000) return adminError(400, "invalid_input", "page must be a whole number from 1", "page");

    const result = await listSessionPhotos(id, { kind: kindParam as PhotoListKind | null, page });
    if ("ok" in result) return fromFailure(result);
    return ok(result);
  } catch (e) {
    return serverError("list photos", e);
  }
}

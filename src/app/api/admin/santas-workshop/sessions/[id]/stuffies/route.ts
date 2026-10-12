/**
 * GET /api/admin/santas-workshop/sessions/[id]/stuffies?state=&q=&flag=&page=  -> RegistrantsResponse
 *
 * Read-only registrant list (Slice 1). Includes parent contact: admin only,
 * never the crew. 50 per page, sorted by parent last name then stuffy name.
 * flag is one of attention | refund | withdrawn | manual.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { forbidden, notFound, ok, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { listRegistrants } from "@/lib/santas-workshop/session-queries";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const q = new URL(request.url).searchParams;
    const page = Number(q.get("page") ?? "1");
    const result = await listRegistrants(id, {
      state: q.get("state") ?? undefined,
      q: q.get("q") ?? undefined,
      flag: q.get("flag") ?? undefined,
      page: Number.isFinite(page) ? page : 1,
    });
    return result ? ok(result) : notFound("Session not found");
  } catch (e) {
    return serverError("list registrants", e);
  }
}

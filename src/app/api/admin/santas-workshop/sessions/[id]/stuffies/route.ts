/**
 * GET /api/admin/santas-workshop/sessions/[id]/stuffies?state=&q=&flag=&page=  -> RegistrantsResponse
 *
 * POST   /api/admin/santas-workshop/sessions/[id]/stuffies  ManualAddRequest  -> 201 RegistrantResponse
 *
 * GET: registrant list. Includes parent contact: admin only,
 * never the crew. 50 per page, sorted by parent last name then stuffy name.
 * flag is one of attention | refund | withdrawn | manual.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { validateManualAdd } from "@/lib/santas-workshop/manual-add";
import { getSessionRow, listRegistrants } from "@/lib/santas-workshop/session-queries";
import { manualAdd } from "@/lib/santas-workshop/stuffy-admin";
import type { RegistrantResponse } from "@/lib/santas-workshop/admin-contract";

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

/**
 * Manual add: the chair adds a registrant who did not come through Zeffy. Admin only,
 * phone-usable (few required fields), flagged source "manual", a REASON is required and
 * kept in the history, and the request id makes a double tap one registrant.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const row = await getSessionRow(id);
    if (!row) return notFound("Session not found");
    const input = validateManualAdd(await readJson(request), row.windows);
    if (!input.ok) return adminError(400, input.code, input.error, input.field);
    const result = await manualAdd(row, input.value, session.user.id);
    if (!result.ok) return fromFailure(result);
    const body: RegistrantResponse = { registrant: result.registrant };
    return ok(body, result.replayed ? 200 : 201);
  } catch (e) {
    return serverError("manual add", e);
  }
}

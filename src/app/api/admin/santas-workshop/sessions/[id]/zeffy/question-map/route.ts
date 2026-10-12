/**
 * PUT /api/admin/santas-workshop/sessions/[id]/zeffy/question-map  -> SaveQuestionMapResponse
 *
 * Body { map }: field key -> question strings (several strings may map to one
 * field; one string maps to one field). Strings are normalized server-side. The
 * response says how many registrants' needs-attention reasons would change;
 * pressing Reprocess (POST .../zeffy/reprocess) applies the map locally.
 *
 * Gate: auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), the first two statements.
 */

import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { isUuid } from "@/lib/utils";
import { adminError, forbidden, fromFailure, notFound, ok, readJson, serverError, unauthorized } from "@/lib/santas-workshop/admin-http";
import { saveQuestionMap } from "@/lib/santas-workshop/session-queries";
import { validateQuestionMap } from "@/lib/santas-workshop/session-input";
import type { SaveQuestionMapResponse } from "@/lib/santas-workshop/admin-contract";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return unauthorized();
  if (!(await hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE))) return forbidden();

  const { id } = await params;
  if (!isUuid(id)) return notFound("Session not found");
  try {
    const input = validateQuestionMap(await readJson(request));
    if (!input.ok) return adminError(400, input.code, input.error, input.field);
    const result = await saveQuestionMap(id, input.value, session.user.id);
    if (!result.ok) return fromFailure(result);
    const body: SaveQuestionMapResponse = { saved: true, attentionWouldChange: result.attentionWouldChange };
    return ok(body);
  } catch (e) {
    return serverError("save question map", e);
  }
}

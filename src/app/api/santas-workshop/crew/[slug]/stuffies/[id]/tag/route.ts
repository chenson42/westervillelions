/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/tag  TagRequest  -> CrewActionResponse
 * The collision table lives in tag-binding.ts; typed 409s: stale_state, confirm_move,
 * confirm_replace, holder_advanced, tag_already_bound. Writes are pinned on expected state.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewError, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parseTagRequest } from "@/lib/santas-workshop/crew-input";
import { transitionResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { bindTag } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    const input = parseTagRequest(await readCrewJson(request));
    if (!input.ok) return crewError(400, "invalid_input", input.error);
    const result = await bindTag(writeContextFor(gate.credential, gate.session), {
      stuffyId: id,
      code: input.value.tagCode,
      expectedState: input.value.expectedState,
      expectedTagCode: input.value.expectedTagCode,
      expectedLast4: input.value.expectedLast4,
      confirm: input.value.confirm,
      idempotencyKey: input.value.idempotencyKey,
      clientTakenAt: input.value.clientTakenAt,
    });
    return await transitionResponse(gate.session.id, result);
  } catch (e) {
    return crewServerError("tag", e);
  }
}

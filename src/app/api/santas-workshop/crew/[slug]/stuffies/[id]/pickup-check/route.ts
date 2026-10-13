/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/pickup-check  PickupCheckRequest  -> PickupCheckResponse { recorded }
 * Records the human choice (matched / someone else) made AFTER the name was shown.
 * 409 name_not_shown until pickup-name was called; the name is not returned here.
 * Pickup itself is refused until this event exists.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { PickupCheckResponse } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parsePickupCheck } from "@/lib/santas-workshop/crew-input";
import { failureResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { recordPickupCheck } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    const input = parsePickupCheck(await readCrewJson(request));
    if (!input.ok) return crewError(400, "invalid_input", input.error);
    const result = await recordPickupCheck(writeContextFor(gate.credential, gate.session), {
      stuffyId: id,
      result: input.value.result,
      note: input.value.note,
      idempotencyKey: input.value.idempotencyKey,
    });
    if (!result.ok) return failureResponse(result);
    const body: PickupCheckResponse = { recorded: true };
    return crewOk(body);
  } catch (e) {
    return crewServerError("pickup-check", e);
  }
}

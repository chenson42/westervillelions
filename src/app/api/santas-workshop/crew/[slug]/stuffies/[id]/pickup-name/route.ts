/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/pickup-name  { idempotencyKey }  -> PickupNameResponse
 * Reveals the parent's name to the worker and records `name_shown` (no state change; a
 * repeat returns the name without a second history row). Allowed from checked_in or
 * portrait_taken. The only crew response besides the tag card that carries a parent name.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { PickupNameResponse } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parsePickupName } from "@/lib/santas-workshop/crew-input";
import { failureResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { parentNameFor, recordPickupName } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    const input = parsePickupName(await readCrewJson(request));
    if (!input.ok) return crewError(400, "invalid_input", input.error);
    const result = await recordPickupName(writeContextFor(gate.credential, gate.session), { stuffyId: id, idempotencyKey: input.value.idempotencyKey });
    if (!result.ok) return failureResponse(result);
    const body: PickupNameResponse = { parentName: await parentNameFor(gate.session.id, id) };
    return crewOk(body);
  } catch (e) {
    return crewServerError("pickup-name", e);
  }
}

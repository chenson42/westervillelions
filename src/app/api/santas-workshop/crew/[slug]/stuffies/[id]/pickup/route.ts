/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/pickup  PickupRequest  -> PickupResponse
 *
 * 409 pickup_check_required until the parent-name confirmation exists. NEVER blocked
 * by a missing portrait, an open refund flag or a storage failure (no store call here).
 * A second tap with another key is 409 already_picked_up { at }.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { PickupResponse } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parsePickup } from "@/lib/santas-workshop/crew-input";
import { failureResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { pickupStuffy } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    const input = parsePickup(await readCrewJson(request));
    if (!input.ok) return crewError(400, "invalid_input", input.error);
    const result = await pickupStuffy(writeContextFor(gate.credential, gate.session), {
      stuffyId: id,
      expectedState: input.value.expectedState,
      idempotencyKey: input.value.idempotencyKey,
    });
    if (!result.ok) return failureResponse(result);
    const body: PickupResponse = {
      pickedUpAt: (result.stuffy.pickedUpAt ?? new Date()).toISOString(),
      familyUrl: `/santas-workshop/f/${result.stuffy.familyToken}`,
      replayed: result.replayed,
    };
    return crewOk(body);
  } catch (e) {
    return crewServerError("pickup", e);
  }
}

/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/check-in  -> CrewActionResponse
 *
 * Either multipart (`meta` + `full`) or JSON `{ withoutPhoto: true, expectedState, idempotencyKey }`.
 * "Check in without a photo" is allowed (the missing photo is derived, never blocking).
 * The photo is stored BEFORE the transaction; a 409 afterwards deletes it best-effort.
 * 413 too_large | quota_exceeded, 415 not_jpeg, 429 rate_limited, 503 storage_*.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewError, crewServerError, readCrewJson } from "@/lib/santas-workshop/crew-http";
import { parseAttempt, parseCheckInMeta, parseCheckInWithoutPhoto } from "@/lib/santas-workshop/crew-input";
import { refusalResponse, transitionResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { ingestPhoto, isUploadRefusal, parsePhotoMeta } from "@/lib/santas-workshop/photo-service";
import { readUploadParts } from "@/lib/santas-workshop/photo-upload";
import { checkInStuffy, type PhotoWrite } from "@/lib/santas-workshop/stuffy-transitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    if (!isUuid(id)) return crewError(404, "not_found", "That stuffy is not on this list");
    const ctx = writeContextFor(gate.credential, gate.session);

    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const input = parseCheckInWithoutPhoto(await readCrewJson(request));
      if (!input.ok) return crewError(400, "invalid_input", input.error);
      const result = await checkInStuffy(ctx, {
        stuffyId: id,
        expectedState: input.value.expectedState,
        idempotencyKey: input.value.idempotencyKey,
        refundContinue: input.value.refundContinue,
      });
      return await transitionResponse(gate.session.id, result);
    }

    const upload = await readUploadParts(request);
    if (!upload.ok) return refusalResponse({ ok: false, upload: true, code: upload.code, error: upload.error });
    const photoMeta = parsePhotoMeta(upload.parts.meta, false);
    if (!photoMeta.ok) return crewError(400, "invalid_input", photoMeta.error);
    const checkIn = parseCheckInMeta(upload.parts.meta);
    if (!checkIn.ok) return crewError(400, "invalid_input", checkIn.error);

    const outcome = await ingestPhoto({
      ctx,
      session: gate.session,
      kind: "check_in",
      stuffyId: id,
      parts: upload.parts,
      meta: photoMeta.value,
      attempt: parseAttempt(request.headers.get("x-sw-attempt")),
      commit: (photo) =>
        checkInStuffy(ctx, {
          stuffyId: id,
          expectedState: checkIn.value.expectedState,
          photo: photo as PhotoWrite,
          idempotencyKey: photo.id,
          clientTakenAt: photo.takenAt,
          refundContinue: checkIn.value.refundContinue,
        }),
    });
    if (isUploadRefusal(outcome)) return refusalResponse(outcome);
    return await transitionResponse(gate.session.id, outcome);
  } catch (e) {
    return crewServerError("check-in", e);
  }
}

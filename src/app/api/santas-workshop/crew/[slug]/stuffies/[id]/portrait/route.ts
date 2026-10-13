/**
 * POST /api/santas-workshop/crew/[slug]/stuffies/[id]/portrait  multipart meta + full + thumb  -> CrewActionResponse
 *
 * Expected state checked_in or portrait_taken. A retake REPLACES: `replace: true` is
 * required when a current portrait exists (else 409 portrait_exists); the old photo is
 * superseded before the new row is inserted, so exactly one portrait is current.
 */

import { isUuid } from "@/lib/utils";
import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import { crewError, crewServerError } from "@/lib/santas-workshop/crew-http";
import { parseAttempt, parsePortraitMeta } from "@/lib/santas-workshop/crew-input";
import { refusalResponse, transitionResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { ingestPhoto, isUploadRefusal, parsePhotoMeta } from "@/lib/santas-workshop/photo-service";
import { readUploadParts } from "@/lib/santas-workshop/photo-upload";
import { portraitStuffy, type PhotoWrite } from "@/lib/santas-workshop/stuffy-transitions";

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

    const upload = await readUploadParts(request);
    if (!upload.ok) return refusalResponse({ ok: false, upload: true, code: upload.code, error: upload.error });
    const photoMeta = parsePhotoMeta(upload.parts.meta, true);
    if (!photoMeta.ok) return crewError(400, "invalid_input", photoMeta.error);
    const portrait = parsePortraitMeta(upload.parts.meta);
    if (!portrait.ok) return crewError(400, "invalid_input", portrait.error);

    const outcome = await ingestPhoto({
      ctx,
      session: gate.session,
      kind: "portrait",
      stuffyId: id,
      parts: upload.parts,
      meta: photoMeta.value,
      attempt: parseAttempt(request.headers.get("x-sw-attempt")),
      commit: (photo) =>
        portraitStuffy(ctx, {
          stuffyId: id,
          expectedState: portrait.value.expectedState,
          photo: photo as PhotoWrite,
          replace: portrait.value.replace,
          clientTakenAt: photo.takenAt,
        }),
    });
    if (isUploadRefusal(outcome)) return refusalResponse(outcome);
    return await transitionResponse(gate.session.id, outcome);
  } catch (e) {
    return crewServerError("portrait", e);
  }
}

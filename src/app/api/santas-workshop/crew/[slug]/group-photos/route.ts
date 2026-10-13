/**
 * POST /api/santas-workshop/crew/[slug]/group-photos  multipart meta + full + thumb  -> GroupPhotoResponse
 * A group photo is unlinked (no stuffy, no state) and stays unpublished until an admin publishes.
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { GroupPhotoResponse } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { parseAttempt } from "@/lib/santas-workshop/crew-input";
import { refusalResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { commitGroupPhoto, ingestPhoto, isUploadRefusal, parsePhotoMeta } from "@/lib/santas-workshop/photo-service";
import { readUploadParts } from "@/lib/santas-workshop/photo-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await requireCrew(request, { slug });
  if (!gate.ok) return gate.response;
  try {
    const ctx = writeContextFor(gate.credential, gate.session);
    const upload = await readUploadParts(request);
    if (!upload.ok) return refusalResponse({ ok: false, upload: true, code: upload.code, error: upload.error });
    const meta = parsePhotoMeta(upload.parts.meta, true);
    if (!meta.ok) return crewError(400, "invalid_input", meta.error);

    const outcome = await ingestPhoto({
      ctx,
      session: gate.session,
      kind: "group",
      stuffyId: null,
      parts: upload.parts,
      meta: meta.value,
      attempt: parseAttempt(request.headers.get("x-sw-attempt")),
      commit: (photo) => commitGroupPhoto(ctx, photo),
    });
    if (isUploadRefusal(outcome)) return refusalResponse(outcome);
    const body: GroupPhotoResponse = { ok: true, photoId: meta.value.photoId, replayed: outcome.replayed };
    return crewOk(body);
  } catch (e) {
    return crewServerError("group photo", e);
  }
}

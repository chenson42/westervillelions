/**
 * POST /api/santas-workshop/crew/[slug]/group-photos  multipart meta + full + thumb  -> GroupPhotoResponse
 * A group photo is unlinked (no stuffy, no state) and stays unpublished until an admin publishes.
 * The optional `sceneId` in meta is parsed to a UUID only (T2); the response never echoes it.
 */

import { requireCrew } from "@/lib/santas-workshop/crew-auth";
import type { GroupPhotoResponse } from "@/lib/santas-workshop/crew-contract";
import { crewError, crewOk, crewServerError } from "@/lib/santas-workshop/crew-http";
import { parseAttempt } from "@/lib/santas-workshop/crew-input";
import { refusalResponse, writeContextFor } from "@/lib/santas-workshop/crew-respond";
import { commitGroupPhoto, ingestPhoto, isUploadRefusal, parsePhotoMeta } from "@/lib/santas-workshop/photo-service";
import { readUploadParts } from "@/lib/santas-workshop/photo-upload";
import { parseGroupSceneId } from "@/lib/santas-workshop/scene-input";

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

    // The scene is a bare UUID here; it is resolved inside the INSERT, so an unknown, deleted, foreign or
    // malformed id stores no scene and answers exactly like a valid one (no enumeration signal).
    const sceneId = parseGroupSceneId(upload.parts.meta);

    const outcome = await ingestPhoto({
      ctx,
      session: gate.session,
      kind: "group",
      stuffyId: null,
      parts: upload.parts,
      meta: meta.value,
      attempt: parseAttempt(request.headers.get("x-sw-attempt")),
      commit: (photo) => commitGroupPhoto(ctx, photo, sceneId),
    });
    if (isUploadRefusal(outcome)) return refusalResponse(outcome);
    const body: GroupPhotoResponse = { ok: true, photoId: meta.value.photoId, replayed: outcome.replayed };
    return crewOk(body);
  } catch (e) {
    return crewServerError("group photo", e);
  }
}

"use client";

import type { CheckInMeta, GroupPhotoMeta, PortraitMeta } from "@/lib/santas-workshop/crew-contract";
import type { PhotoKind } from "@/lib/santas-workshop/photo-limits";
import { newKey } from "./crew-api";
import type { CrewCtx } from "./crew-context";
import { PhotoPrepareError, downscalePhoto } from "./photo-downscale-browser";
import type { OutboxItem } from "./outbox-core";

export type QueueResult = { ok: true; photoId: string } | { ok: false; message: string };

const PREPARE_FAILED = "That photo couldn’t be prepared. Take it again.";
const TOO_BIG = "That photo is too big to send even after shrinking it. Take it again from a little further away.";
const NOT_SAVED = "Couldn’t save the photo on this phone. Check that the phone has free space, then take it again.";

/**
 * Downscales a captured photo and writes it to the outbox. Resolves only after the photo
 * is stored on the phone ("Saved on this phone"); the caller may then let the worker move
 * on while the upload runs in the background. `build` supplies the kind-specific metadata.
 */
export async function queuePhoto(
  ctx: CrewCtx,
  input: {
    file: File;
    kind: PhotoKind;
    stuffyId: string | null;
    label: string;
    build(photo: { photoId: string; takenAt: string; width: number; height: number; thumbWidth: number; thumbHeight: number }): CheckInMeta | PortraitMeta | GroupPhotoMeta;
  },
): Promise<QueueResult> {
  let prepared;
  try {
    prepared = await downscalePhoto(input.file, input.kind);
  } catch (e) {
    return { ok: false, message: e instanceof PhotoPrepareError && e.kind === "too_big" ? TOO_BIG : PREPARE_FAILED };
  }
  const photoId = newKey();
  const takenAt = new Date().toISOString();
  const now = Date.now();
  const item: OutboxItem = {
    photoId,
    kind: input.kind,
    stuffyId: input.stuffyId,
    label: input.label,
    full: prepared.full,
    thumb: prepared.thumb,
    meta: input.build({ photoId, takenAt, width: prepared.width, height: prepared.height, thumbWidth: prepared.thumbWidth, thumbHeight: prepared.thumbHeight }),
    createdAt: now,
    attempts: 0,
    nextAt: 0,
    status: "pending",
    message: null,
  };
  try {
    await ctx.outbox.enqueue(item);
  } catch {
    return { ok: false, message: NOT_SAVED };
  }
  return { ok: true, photoId };
}

/**
 * Upload orchestration (Phase 3, "Never hold a lock across a Drive or Zeffy
 * call"). Order of operations, always:
 *
 *   validate -> replay check by photo id -> quota/rate -> put to the store
 *   (idempotent per photo id) -> the state transaction (stuffy-transitions.ts).
 *
 * The store is called BEFORE the transaction and never inside one. A failed
 * transaction deletes the just-uploaded objects best-effort (unless the photo row
 * exists, which means this was a replay). A crash between upload and transaction
 * leaves an orphan that "Check storage" lists. Server-only.
 */

import { createHash } from "node:crypto";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, type SwSession } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils";
import { DEVICE_UPLOADS_PER_WINDOW, DEVICE_UPLOAD_WINDOW_SECONDS, PHOTO_LIMITS, type PhotoKind } from "./photo-limits";
import { selectPhotoStoreMode } from "./photo-store/config";
import { getPhotoStore } from "./photo-store";
import type { PhotoStore } from "./photo-store/types";
import { validatePhotoPart, type UploadParts } from "./photo-upload";
import type { PhotoWrite, WriteContext } from "./stuffy-transitions";

export type UploadedPhoto = Omit<PhotoWrite, "kind"> & { kind: PhotoKind };

export type UploadRefusal = {
  ok: false;
  upload: true;
  code: "too_large" | "quota_exceeded" | "not_jpeg" | "rate_limited" | "invalid_input";
  error: string;
};

export interface PhotoMeta {
  photoId: string;
  takenAt: string;
  width: number;
  height: number;
  thumbWidth?: number;
  thumbHeight?: number;
}

/** The photo-specific part of a multipart `meta`, validated. */
export function parsePhotoMeta(meta: unknown, needsThumb: boolean): { ok: true; value: PhotoMeta } | { ok: false; error: string } {
  const m = meta as Partial<PhotoMeta> | null;
  if (!m || typeof m !== "object") return { ok: false, error: "The upload details are missing" };
  if (typeof m.photoId !== "string" || !isUuid(m.photoId)) return { ok: false, error: "The photo needs an id" };
  if (typeof m.takenAt !== "string" || Number.isNaN(Date.parse(m.takenAt))) return { ok: false, error: "The photo needs a time" };
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height)) return { ok: false, error: "The photo needs its size" };
  if (needsThumb && (!Number.isInteger(m.thumbWidth) || !Number.isInteger(m.thumbHeight))) return { ok: false, error: "The photo needs its preview size" };
  return {
    ok: true,
    value: {
      photoId: m.photoId.toLowerCase(),
      takenAt: m.takenAt,
      width: m.width as number,
      height: m.height as number,
      thumbWidth: m.thumbWidth,
      thumbHeight: m.thumbHeight,
    },
  };
}

const refuse = (code: UploadRefusal["code"], error: string): UploadRefusal => ({ ok: false, upload: true, code, error });

export function isUploadRefusal(x: unknown): x is UploadRefusal {
  return typeof x === "object" && x !== null && (x as { upload?: unknown }).upload === true;
}

async function sessionFolder(session: SwSession, store: PhotoStore): Promise<string> {
  if (session.storageFolderKey) return session.storageFolderKey;
  const key = await store.ensureFolder(session.slug);
  // Racing requests both ensureFolder() the same name (idempotent), so either write is the same value.
  await db.update(swSessions).set({ storageFolderKey: key }).where(and(eq(swSessions.id, session.id), isNull(swSessions.storageFolderKey)));
  return key;
}

export async function sessionBytesUsed(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(coalesce(${swPhotos.byteSize}, 0) + coalesce(${swPhotos.thumbByteSize}, 0)), 0)::bigint` })
    .from(swPhotos)
    .where(and(eq(swPhotos.sessionId, sessionId), isNull(swPhotos.purgedAt)));
  return Number(row?.n ?? 0);
}

async function deviceRecentUploads(sessionId: string, deviceId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - DEVICE_UPLOAD_WINDOW_SECONDS * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(swPhotos)
    .where(and(eq(swPhotos.sessionId, sessionId), eq(swPhotos.deviceId, deviceId), gte(swPhotos.createdAt, since)));
  return row?.n ?? 0;
}

export interface IngestArgs<R extends { ok: boolean }> {
  ctx: WriteContext;
  session: SwSession;
  kind: PhotoKind;
  /** Null for a group photo. */
  stuffyId: string | null;
  parts: UploadParts;
  meta: PhotoMeta;
  /** The X-SW-Attempt header (1 for the first try). */
  attempt: number;
  commit(photo: UploadedPhoto): Promise<R>;
  store?: PhotoStore;
  now?: Date;
}

/**
 * Validates, stores and commits one photo. Returns the commit result, or an
 * UploadRefusal. A photo-store failure THROWS a StorageError (the route maps it
 * to 503), after nothing was written to the database.
 */
export async function ingestPhoto<R extends { ok: boolean }>(args: IngestArgs<R>): Promise<R | UploadRefusal> {
  const { ctx, session, kind, meta } = args;
  const now = args.now ?? new Date();
  const limit = PHOTO_LIMITS[kind];

  // Replay: the client re-sent a photo whose row already exists. Do not upload again.
  const [existing] = await db
    .select({
      id: swPhotos.id,
      stuffyId: swPhotos.stuffyId,
      storageKind: swPhotos.storageKind,
      storageKey: swPhotos.storageKey,
      thumbStorageKey: swPhotos.thumbStorageKey,
      contentType: swPhotos.contentType,
      byteSize: swPhotos.byteSize,
      thumbByteSize: swPhotos.thumbByteSize,
      width: swPhotos.width,
      height: swPhotos.height,
      sha256: swPhotos.sha256,
      takenAt: swPhotos.takenAt,
      sessionId: swPhotos.sessionId,
      kind: swPhotos.kind,
    })
    .from(swPhotos)
    .where(eq(swPhotos.id, meta.photoId))
    .limit(1);
  if (existing) {
    if (existing.sessionId !== session.id || existing.stuffyId !== args.stuffyId || existing.kind !== kind) {
      return refuse("invalid_input", "That photo id was already used");
    }
    return args.commit({
      id: existing.id,
      kind,
      storageKind: existing.storageKind,
      storageKey: existing.storageKey ?? "",
      thumbStorageKey: existing.thumbStorageKey,
      contentType: existing.contentType ?? "image/jpeg",
      byteSize: existing.byteSize ?? 0,
      thumbByteSize: existing.thumbByteSize,
      width: existing.width ?? meta.width,
      height: existing.height ?? meta.height,
      sha256: existing.sha256 ?? "",
      takenAt: existing.takenAt ?? new Date(meta.takenAt),
    });
  }

  const full = args.parts.full;
  if (!full) return refuse("invalid_input", "The photo is missing");
  const fullVerdict = validatePhotoPart({ kind, variant: "full", bytes: full, claimedWidth: meta.width, claimedHeight: meta.height });
  if (!fullVerdict.ok) return refuse(fullVerdict.code, fullVerdict.error);

  let thumbBytes: Uint8Array | null = null;
  let thumbSize: number | null = null;
  if (limit.thumb) {
    thumbBytes = args.parts.thumb;
    if (!thumbBytes) return refuse("invalid_input", "The preview is missing");
    const t = validatePhotoPart({ kind, variant: "thumb", bytes: thumbBytes, claimedWidth: meta.thumbWidth ?? 0, claimedHeight: meta.thumbHeight ?? 0 });
    if (!t.ok) return refuse(t.code, t.error);
    thumbSize = t.byteSize;
  }

  if (ctx.actor.kind === "crew" && (await deviceRecentUploads(session.id, ctx.actor.deviceId, now)) >= DEVICE_UPLOADS_PER_WINDOW) {
    return refuse("rate_limited", "Too many photos too quickly. Wait a moment.");
  }
  const used = await sessionBytesUsed(session.id);
  if (used + fullVerdict.byteSize + (thumbSize ?? 0) > session.storageQuotaBytes) {
    return refuse("quota_exceeded", "This session has used its photo storage.");
  }

  const store = args.store ?? getPhotoStore();
  const folderKey = await sessionFolder(session, store);
  const attempt = Number.isFinite(args.attempt) && args.attempt > 0 ? Math.floor(args.attempt) : 1;
  const putFull = await store.put({ folderKey, photoId: meta.photoId, variant: "full", bytes: full, contentType: "image/jpeg", attempt });
  let thumbKey: string | null = null;
  if (thumbBytes) {
    try {
      thumbKey = (await store.put({ folderKey, photoId: meta.photoId, variant: "thumb", bytes: thumbBytes, contentType: "image/jpeg", attempt })).key;
    } catch (e) {
      await store.delete(putFull.key).catch(() => undefined);
      throw e;
    }
  }

  const photo: UploadedPhoto = {
    id: meta.photoId,
    kind,
    storageKind: selectPhotoStoreMode(),
    storageKey: putFull.key,
    thumbStorageKey: thumbKey,
    contentType: "image/jpeg",
    byteSize: fullVerdict.byteSize,
    thumbByteSize: thumbSize,
    width: fullVerdict.width,
    height: fullVerdict.height,
    sha256: createHash("sha256").update(full).digest("hex"),
    takenAt: new Date(meta.takenAt),
  };

  let result: R;
  try {
    result = await args.commit(photo);
  } catch (e) {
    await discard(store, putFull.key, thumbKey, meta.photoId);
    throw e;
  }
  if (!result.ok) await discard(store, putFull.key, thumbKey, meta.photoId);
  return result;
}

/** Best-effort cleanup, skipped when the photo row exists (it then owns those keys). */
async function discard(store: PhotoStore, fullKey: string, thumbKey: string | null, photoId: string): Promise<void> {
  try {
    const [row] = await db.select({ id: swPhotos.id }).from(swPhotos).where(eq(swPhotos.id, photoId)).limit(1);
    if (row) return;
  } catch {
    return; // cannot tell: leave the objects for Check storage
  }
  await store.delete(fullKey).catch(() => undefined);
  if (thumbKey) await store.delete(thumbKey).catch(() => undefined);
}

/** A group photo has no stuffy and no state: it is one row, idempotent on the photo id. */
export async function commitGroupPhoto(ctx: WriteContext, photo: UploadedPhoto): Promise<{ ok: true; replayed: boolean }> {
  const rows = await db
    .insert(swPhotos)
    .values({
      id: photo.id,
      sessionId: ctx.sessionId,
      stuffyId: null,
      kind: "group",
      storageKind: photo.storageKind,
      storageKey: photo.storageKey,
      thumbStorageKey: photo.thumbStorageKey,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
      thumbByteSize: photo.thumbByteSize,
      width: photo.width,
      height: photo.height,
      sha256: photo.sha256,
      takenAt: photo.takenAt,
      deviceId: ctx.actor.kind === "crew" ? ctx.actor.deviceId : "admin",
      recordedByUserId: ctx.actor.kind === "admin" ? ctx.actor.userId : null,
    })
    .onConflictDoNothing()
    .returning({ id: swPhotos.id });
  return { ok: true, replayed: rows.length === 0 };
}

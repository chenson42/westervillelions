/**
 * THE photo door. This is the only module that calls the photo store's `get`
 * (photo-door.test.ts scans for it). Every photo route resolves a viewer, hands
 * the photo row to `decidePhotoAccess()`, and serves bytes only on an allow; every
 * failure (unknown id, denied, hidden, purged, missing bytes, storage outage) is
 * the same null, which the route turns into a plain 404, never a 403.
 *
 * | Viewer | Allowed                                                                  | Always denied |
 * | Admin  | any kind, either variant, hidden and superseded included                  | purged        |
 * | Crew   | same session: check_in full; current unhidden portrait; unhidden group     | other session, hidden, superseded, check_in thumb, purged |
 * | Family | its stuffy's current UNHIDDEN portrait, regardless of consent, once the    | anything else |
 * |        | session is published                                                       |               |
 * | Public | published unhidden group; current unhidden consented portrait, session     | check_in      |
 * |        | published                                                                  |               |
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions } from "@/lib/db/schema";
import { getPhotoStore } from "./photo-store";
import type { PhotoStore } from "./photo-store/types";
import type { PhotoKind } from "./photo-limits";

export type PhotoViewer =
  | { kind: "admin" }
  | { kind: "crew"; sessionId: string }
  | { kind: "family"; stuffyId: string }
  | { kind: "public" };

export interface PhotoFacts {
  kind: PhotoKind;
  sessionId: string;
  stuffyId: string | null;
  hidden: boolean;
  superseded: boolean;
  purged: boolean;
  /** Group photos: set by the publish batch. */
  published: boolean;
  /** The stuffy's photo consent (portraits). */
  consent: boolean;
  /** The session's collage has been published. */
  sessionPublished: boolean;
}

export function decidePhotoAccess(viewer: PhotoViewer, photo: PhotoFacts, variant: "full" | "thumb"): boolean {
  if (photo.purged) return false;
  switch (viewer.kind) {
    case "admin":
      return true;
    case "crew": {
      if (viewer.sessionId !== photo.sessionId) return false;
      if (photo.hidden) return false;
      if (photo.kind === "check_in") return variant === "full" && !photo.superseded;
      if (photo.kind === "portrait") return !photo.superseded;
      return true; // group, unhidden
    }
    case "family":
      return (
        photo.kind === "portrait" &&
        photo.stuffyId !== null &&
        photo.stuffyId === viewer.stuffyId &&
        !photo.superseded &&
        !photo.hidden &&
        photo.sessionPublished
      );
    case "public": {
      if (photo.hidden || photo.superseded || !photo.sessionPublished) return false;
      if (photo.kind === "group") return photo.published;
      if (photo.kind === "portrait") return photo.consent;
      return false;
    }
    default: {
      const _never: never = viewer;
      return _never;
    }
  }
}

export interface PhotoRecord {
  facts: PhotoFacts;
  storageKey: string | null;
  thumbStorageKey: string | null;
  contentType: string | null;
  /** Consent is read from the stuffy by the loader; kept here so the caller need not. */
}

/** The photo's session id only (the route resolves the crew credential against it). */
export async function photoSessionId(photoId: string): Promise<string | null> {
  const [row] = await db.select({ sessionId: swPhotos.sessionId }).from(swPhotos).where(eq(swPhotos.id, photoId)).limit(1);
  return row?.sessionId ?? null;
}

export async function loadPhotoRecord(photoId: string): Promise<PhotoRecord | null> {
  const [row] = await db
    .select({
      kind: swPhotos.kind,
      sessionId: swPhotos.sessionId,
      stuffyId: swPhotos.stuffyId,
      hiddenAt: swPhotos.hiddenAt,
      supersededAt: swPhotos.supersededAt,
      purgedAt: swPhotos.purgedAt,
      publishedAt: swPhotos.publishedAt,
      storageKey: swPhotos.storageKey,
      thumbStorageKey: swPhotos.thumbStorageKey,
      contentType: swPhotos.contentType,
      collagePublishedAt: swSessions.collagePublishedAt,
      consent: sql`coalesce((select photo_consent from sw_stuffies s where s.id = ${swPhotos.stuffyId}), false)`.mapWith(Boolean),
    })
    .from(swPhotos)
    .innerJoin(swSessions, eq(swPhotos.sessionId, swSessions.id))
    .where(eq(swPhotos.id, photoId))
    .limit(1);
  if (!row) return null;
  return {
    facts: {
      kind: row.kind as PhotoKind,
      sessionId: row.sessionId,
      stuffyId: row.stuffyId,
      hidden: row.hiddenAt !== null,
      superseded: row.supersededAt !== null,
      purged: row.purgedAt !== null,
      published: row.publishedAt !== null,
      consent: row.consent,
      sessionPublished: row.collagePublishedAt !== null,
    },
    storageKey: row.storageKey,
    thumbStorageKey: row.thumbStorageKey,
    contentType: row.contentType,
  };
}

export interface ServedPhoto {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
}

/** Bytes for a viewer, or null for every kind of failure. Never throws. */
export async function servePhoto(
  viewer: PhotoViewer,
  photoId: string,
  variant: "full" | "thumb",
  deps: { store?: () => PhotoStore; load?: (id: string) => Promise<PhotoRecord | null> } = {},
): Promise<ServedPhoto | null> {
  try {
    const record = await (deps.load ?? loadPhotoRecord)(photoId);
    if (!record) return null;
    if (!decidePhotoAccess(viewer, record.facts, variant)) return null;
    const key = variant === "full" ? record.storageKey : record.thumbStorageKey;
    if (!key) return null;
    const object = await (deps.store ?? getPhotoStore)().get(key);
    if (!object) return null;
    return { stream: object.stream, contentType: object.contentType || record.contentType || "image/jpeg", size: object.size };
  } catch (e) {
    const err = e as { name?: string; code?: string } | null;
    console.error("santas-workshop photo door failed", { name: err?.name ?? "Error", code: err?.code ?? null });
    return null;
  }
}

/** Headers for a served photo: private caching for family/public, none for crew/admin. */
export function photoHeaders(viewer: PhotoViewer, served: ServedPhoto, download = false): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": served.contentType,
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": viewer.kind === "family" || viewer.kind === "public" ? "private, max-age=300" : "no-store",
  };
  if (served.size !== null) headers["Content-Length"] = String(served.size);
  if (download) headers["Content-Disposition"] = 'attachment; filename="stuffy-portrait.jpg"';
  return headers;
}

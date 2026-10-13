/**
 * Admin storage operations: "Test storage" and "Check storage". Server-only.
 * These never move bytes to a browser; they list, delete orphans, and ping the
 * store. Results are logged to the session log as counts and booleans.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, type SwSession } from "@/lib/db/schema";
import type { StorageCheckResponse, StorageTestResponse } from "./admin-contract";
import { selectPhotoStoreMode } from "./photo-store/config";
import { getPhotoStore } from "./photo-store";
import { isStorageError } from "./photo-store/errors";
import type { PhotoStore } from "./photo-store/types";
import { logSessionEvent } from "./session-log";

/** Files younger than this may be mid-upload; they are never called orphans. */
export const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
export const CHECK_MAX_PAGES = 50;
const SAMPLE_LIMIT = 50;

async function logTarget(sessionId: string | undefined): Promise<string | null> {
  if (sessionId) {
    const [row] = await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.id, sessionId)).limit(1);
    if (row) return row.id;
  }
  const [newest] = await db.select({ id: swSessions.id }).from(swSessions).orderBy(desc(swSessions.createdAt)).limit(1);
  return newest?.id ?? null;
}

/** Writes, reads back and deletes a tiny object. Logs the result; rethrows a typed StorageError on failure. */
export async function runStorageTest(
  sessionId: string | undefined,
  userId: string,
  store: PhotoStore | (() => PhotoStore) = getPhotoStore,
): Promise<StorageTestResponse> {
  const target = await logTarget(sessionId);
  try {
    const resolved = typeof store === "function" ? store() : store;
    const result = await resolved.ping();
    if (target) await logSessionEvent(target, userId, "storage_test", { ok: true, latencyMs: result.latencyMs });
    return { ok: true, latencyMs: result.latencyMs, mode: selectPhotoStoreMode() };
  } catch (e) {
    if (target) await logSessionEvent(target, userId, "storage_test", { ok: false, latencyMs: null, code: isStorageError(e) ? e.code : "unknown" });
    throw e;
  }
}

export interface CheckListing {
  keys: Map<string, { photoId: string; variant: "full" | "thumb"; size: number; createdAt: Date | null }>;
  complete: boolean;
}

export async function listFolder(store: PhotoStore, folderKey: string): Promise<CheckListing> {
  const keys: CheckListing["keys"] = new Map();
  let token: string | undefined;
  for (let page = 0; page < CHECK_MAX_PAGES; page += 1) {
    const result = await store.list(folderKey, token);
    for (const item of result.items) keys.set(item.key, { photoId: item.photoId, variant: item.variant, size: item.size, createdAt: item.createdAt });
    if (!result.next) return { keys, complete: true };
    token = result.next;
  }
  return { keys, complete: false };
}

/** Pure comparison of the store listing with the photo rows. */
export function compareStorage(
  listing: CheckListing,
  rows: { id: string; kind: string; storageKey: string | null; thumbStorageKey: string | null }[],
  now: Date,
): { orphans: { key: string; photoId: string; variant: "full" | "thumb"; size: number }[]; missing: { photoId: string; kind: string }[] } {
  const known = new Set<string>();
  for (const r of rows) {
    if (r.storageKey) known.add(r.storageKey);
    if (r.thumbStorageKey) known.add(r.thumbStorageKey);
  }
  const orphans = [...listing.keys.entries()]
    .filter(([key, item]) => !known.has(key) && (item.createdAt === null || now.getTime() - item.createdAt.getTime() > ORPHAN_MIN_AGE_MS))
    .map(([key, item]) => ({ key, photoId: item.photoId, variant: item.variant, size: item.size }));
  const missing = listing.complete
    ? rows.filter((r) => (r.storageKey && !listing.keys.has(r.storageKey)) || (r.thumbStorageKey && !listing.keys.has(r.thumbStorageKey))).map((r) => ({ photoId: r.id, kind: r.kind }))
    : [];
  return { orphans, missing };
}

export async function checkStorage(
  session: SwSession,
  deleteOrphans: boolean,
  userId: string,
  store: PhotoStore | (() => PhotoStore) = getPhotoStore,
  now: Date = new Date(),
): Promise<StorageCheckResponse> {
  const resolved = typeof store === "function" ? store() : store;
  const rows = await db
    .select({ id: swPhotos.id, kind: swPhotos.kind, storageKey: swPhotos.storageKey, thumbStorageKey: swPhotos.thumbStorageKey })
    .from(swPhotos)
    .where(and(eq(swPhotos.sessionId, session.id), isNull(swPhotos.purgedAt)));
  const listing = session.storageFolderKey ? await listFolder(resolved, session.storageFolderKey) : { keys: new Map(), complete: true };
  const { orphans, missing } = compareStorage(listing, rows, now);

  let deleted = 0;
  if (deleteOrphans) {
    for (const o of orphans) {
      await resolved.delete(o.key);
      deleted += 1;
    }
    await logSessionEvent(session.id, userId, "storage_orphans_deleted", { deleted });
  } else {
    await logSessionEvent(session.id, userId, "storage_check", { orphans: orphans.length, missing: missing.length, complete: listing.complete });
  }
  return {
    orphanFiles: orphans.slice(0, SAMPLE_LIMIT).map(({ photoId, variant, size }) => ({ photoId, variant, size })),
    orphanCount: orphans.length,
    missingFiles: missing.slice(0, SAMPLE_LIMIT),
    missingCount: missing.length,
    deleted,
    complete: listing.complete,
  };
}

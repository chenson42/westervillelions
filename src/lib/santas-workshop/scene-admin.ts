/**
 * Scene writes (DECISION-128). Server-only. The ONLY module that writes `sw_scenes`
 * and `sw_photos.scene_id` (scan-tested), and every text write goes through
 * `validateSceneText` first.
 *
 *   - create / update / delete / reorder decide under `SELECT ... FOR UPDATE` on the
 *     session row (cap 20, dense positions, the stored-set check), so two tabs cannot
 *     both pass the cap or interleave a reorder.
 *   - Every write is refused with 409 `session_purged` once the public purge has run.
 *   - Audit rows (`sw_session_log`) hold ids and counts only, NEVER title or caption:
 *     the log is not purged.
 *   - Reassigning a photo is one pinned UPDATE with a rollback sentinel on zero rows
 *     (a plain return from `db.transaction` commits). It never touches `published_at`,
 *     `created_at`, `hidden_at` or the review gate.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swScenes, swSessions } from "@/lib/db/schema";
import {
  SCENES_CHANGED_MESSAGE,
  SCENE_GONE_MESSAGE,
  SCENE_LIMIT_MESSAGE,
  SCENES_MAX,
  type AdminSceneDto,
  type PhotoSceneResponse,
  type SceneDeleteResponse,
  type ScenesListResponse,
  type SceneSaveResponse,
} from "./scene-contract";
import { isForeignKeyViolation } from "./pg-error";
import { validateSceneText } from "./scene-input";
import { listAdminScenes } from "./scene-queries";
import { logSessionEvent } from "./session-log";
import { failure, type QueryFailure } from "./session-queries";

export type SceneResult<T> = { ok: true; response: T } | QueryFailure;

class Rollback extends Error {}
class SceneGone extends Error {}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Locks the session row. A failure is returned (and nothing was written). */
async function lockSession(tx: Tx, sessionId: string): Promise<QueryFailure | null> {
  const [row] = await tx
    .select({ id: swSessions.id, publicPurgedAt: swSessions.publicPurgedAt })
    .from(swSessions)
    .where(eq(swSessions.id, sessionId))
    .for("update");
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.publicPurgedAt) return failure(409, "session_purged", "This session's photos have been removed, so its storyline can no longer be changed");
  return null;
}

const toDto = (r: typeof swScenes.$inferSelect): AdminSceneDto => ({
  id: r.id,
  title: r.title,
  caption: r.caption,
  position: r.position,
  photoCount: 0,
  unhiddenCount: 0,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export async function createScene(sessionId: string, input: { title?: unknown; caption?: unknown }, userId: string): Promise<SceneResult<SceneSaveResponse>> {
  const checked = validateSceneText(input);
  if (!checked.ok) return failure(400, "invalid_input", checked.error, checked.field);

  const outcome = await db.transaction(async (tx) => {
    const blocked = await lockSession(tx, sessionId);
    if (blocked) return blocked;
    const [stats] = await tx
      .select({ n: sql<number>`count(*)::int`, max: sql<number | null>`max(${swScenes.position})` })
      .from(swScenes)
      .where(eq(swScenes.sessionId, sessionId));
    if ((stats?.n ?? 0) >= SCENES_MAX) return failure(409, "scene_limit", SCENE_LIMIT_MESSAGE);
    const [row] = await tx
      .insert(swScenes)
      .values({ sessionId, title: checked.value.title, caption: checked.value.caption, position: stats?.max === null || stats?.max === undefined ? 0 : stats.max + 1 })
      .returning();
    return { ok: true as const, row };
  });
  if (!outcome.ok) return outcome;
  await logSessionEvent(sessionId, userId, "scene_created", { sceneId: outcome.row.id, position: outcome.row.position });
  return { ok: true, response: { scene: toDto(outcome.row) } };
}

export async function updateScene(sessionId: string, sceneId: string, input: { title?: unknown; caption?: unknown }, userId: string, now: Date = new Date()): Promise<SceneResult<SceneSaveResponse>> {
  const checked = validateSceneText(input);
  if (!checked.ok) return failure(400, "invalid_input", checked.error, checked.field);

  const outcome = await db.transaction(async (tx) => {
    const blocked = await lockSession(tx, sessionId);
    if (blocked) return blocked;
    const [row] = await tx
      .update(swScenes)
      .set({ title: checked.value.title, caption: checked.value.caption, updatedAt: now })
      .where(and(eq(swScenes.id, sceneId), eq(swScenes.sessionId, sessionId)))
      .returning();
    if (!row) return failure(404, "not_found", "Scene not found");
    return { ok: true as const, row };
  });
  if (!outcome.ok) return outcome;
  await logSessionEvent(sessionId, userId, "scene_updated", { sceneId });
  const dto = (await listAdminScenes(sessionId)).find((s) => s.id === sceneId) ?? toDto(outcome.row);
  return { ok: true, response: { scene: dto } };
}

// ---------------------------------------------------------------------------
// Delete / reorder
// ---------------------------------------------------------------------------

export async function deleteScene(sessionId: string, sceneId: string, userId: string): Promise<SceneResult<SceneDeleteResponse>> {
  const outcome = await db.transaction(async (tx) => {
    const blocked = await lockSession(tx, sessionId);
    if (blocked) return blocked;
    const [moved] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(swPhotos)
      .where(and(eq(swPhotos.sceneId, sceneId), eq(swPhotos.sessionId, sessionId), isNull(swPhotos.purgedAt)));
    // The foreign key sets sw_photos.scene_id to null; the positions of the other scenes keep their gap (harmless).
    const deleted = await tx
      .delete(swScenes)
      .where(and(eq(swScenes.id, sceneId), eq(swScenes.sessionId, sessionId)))
      .returning({ id: swScenes.id });
    if (deleted.length === 0) return failure(404, "not_found", "Scene not found");
    return { ok: true as const, movedPhotos: moved?.n ?? 0 };
  });
  if (!outcome.ok) return outcome;
  await logSessionEvent(sessionId, userId, "scene_deleted", { sceneId, movedPhotos: outcome.movedPhotos });
  return { ok: true, response: { ok: true, movedPhotos: outcome.movedPhotos } };
}

/** `order` is the complete list of the session's scene ids (already validated as unique uuids). */
export async function reorderScenes(sessionId: string, order: string[], userId: string): Promise<SceneResult<ScenesListResponse>> {
  const outcome = await db.transaction(async (tx) => {
    const blocked = await lockSession(tx, sessionId);
    if (blocked) return blocked;
    const stored = await tx
      .select({ id: swScenes.id })
      .from(swScenes)
      .where(eq(swScenes.sessionId, sessionId))
      .orderBy(asc(swScenes.position), asc(swScenes.createdAt), asc(swScenes.id));
    const storedIds = stored.map((r) => r.id);
    const sameSet = storedIds.length === order.length && storedIds.every((id) => order.includes(id));
    if (!sameSet) return failure(409, "scenes_changed", SCENES_CHANGED_MESSAGE);
    const changed = storedIds.some((id, i) => id !== order[i]);
    // Dense positions 0..n-1, rewritten in this one transaction.
    for (let i = 0; i < order.length; i += 1) {
      await tx.update(swScenes).set({ position: i }).where(and(eq(swScenes.id, order[i]), eq(swScenes.sessionId, sessionId)));
    }
    return { ok: true as const, changed, count: order.length };
  });
  if (!outcome.ok) return outcome;
  if (outcome.changed) await logSessionEvent(sessionId, userId, "scenes_reordered", { count: outcome.count });
  return { ok: true, response: { scenes: await listAdminScenes(sessionId) } };
}

// ---------------------------------------------------------------------------
// Reassign one group photo
// ---------------------------------------------------------------------------

export async function setPhotoScene(photoId: string, sceneId: string | null, userId: string): Promise<SceneResult<PhotoSceneResponse>> {
  const [photo] = await db
    .select({ id: swPhotos.id, sessionId: swPhotos.sessionId, kind: swPhotos.kind, purgedAt: swPhotos.purgedAt, sceneId: swPhotos.sceneId })
    .from(swPhotos)
    .where(eq(swPhotos.id, photoId))
    .limit(1);
  if (!photo || photo.kind !== "group" || photo.purgedAt) return failure(404, "not_found", "Photo not found");

  const target = sceneId?.toLowerCase() ?? null;
  const gone = () => failure(409, "scene_gone", SCENE_GONE_MESSAGE);

  let sceneTitle: string | null = null;
  try {
    await db.transaction(async (tx) => {
      if (target !== null) {
        const [scene] = await tx
          .select({ id: swScenes.id, title: swScenes.title })
          .from(swScenes)
          .where(and(eq(swScenes.id, target), eq(swScenes.sessionId, photo.sessionId)))
          .limit(1);
        if (!scene) throw new SceneGone();
        sceneTitle = scene.title;
      }
      // Pinned: only a live group photo. Never touches published_at, created_at, hidden_at or the review gate.
      const updated = await tx
        .update(swPhotos)
        .set({ sceneId: target })
        .where(and(eq(swPhotos.id, photoId), eq(swPhotos.kind, "group"), isNull(swPhotos.purgedAt)))
        .returning({ id: swPhotos.id });
      if (updated.length === 0) throw new Rollback();
    });
  } catch (e) {
    if (e instanceof SceneGone || isForeignKeyViolation(e)) return gone();
    if (e instanceof Rollback) return failure(404, "not_found", "Photo not found");
    throw e;
  }

  // Setting the same value again is a success with no audit row (an idempotent double-click).
  if (photo.sceneId !== target) {
    await logSessionEvent(photo.sessionId, userId, "photo_scene_changed", { photoId, fromSceneId: photo.sceneId, toSceneId: target });
  }
  return { ok: true, response: { ok: true, sceneId: target, sceneTitle } };
}


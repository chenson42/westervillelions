/**
 * Scene reads (DECISION-128). Server-only. Three consumers, kept apart on purpose:
 *   - the crew picker's list (id, title, caption; no counts), scoped by the
 *     credential's session id, never a URL or request parameter;
 *   - the admin storyline list with per-scene photo counts (admin surfaces only, R9);
 *   - `resolveSceneId`, for the admin reassign path.
 * The PUBLIC collage reads scenes in collage-queries.ts through its own, session
 * scoped select; no `collage-*` module imports this file (scan-tested), so counts can
 * never reach the public view.
 */

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swScenes, swSessions } from "@/lib/db/schema";
import type { CrewScene } from "./crew-contract";
import type { AdminSceneDto } from "./scene-contract";
import { isUuid } from "@/lib/utils";

const storylineOrder = [asc(swScenes.position), asc(swScenes.createdAt), asc(swScenes.id)] as const;

/** The crew picker's storyline for ONE session (the credential's), in order. */
export async function listCrewScenes(sessionId: string): Promise<CrewScene[]> {
  return db
    .select({ id: swScenes.id, title: swScenes.title, caption: swScenes.caption })
    .from(swScenes)
    .where(eq(swScenes.sessionId, sessionId))
    .orderBy(...storylineOrder);
}

/** The admin storyline with counts of the group photos in each scene (purged and superseded excluded). */
export async function listAdminScenes(sessionId: string): Promise<AdminSceneDto[]> {
  const rows = await db
    .select({
      id: swScenes.id,
      title: swScenes.title,
      caption: swScenes.caption,
      position: swScenes.position,
      createdAt: swScenes.createdAt,
      updatedAt: swScenes.updatedAt,
      photoCount: sql<number>`(select count(*) from sw_photos sp where sp.scene_id = sw_scenes.id and sp.purged_at is null and sp.superseded_at is null)::int`,
      unhiddenCount: sql<number>`(select count(*) from sw_photos sp where sp.scene_id = sw_scenes.id and sp.purged_at is null and sp.superseded_at is null and sp.hidden_at is null)::int`,
    })
    .from(swScenes)
    .where(eq(swScenes.sessionId, sessionId))
    .orderBy(...storylineOrder);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    caption: r.caption,
    position: r.position,
    photoCount: r.photoCount ?? 0,
    unhiddenCount: r.unhiddenCount ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** The scene id when it exists AND belongs to this session; otherwise null (unknown, deleted, foreign and malformed alike). */
export async function resolveSceneId(sessionId: string, raw: unknown): Promise<string | null> {
  if (typeof raw !== "string" || !isUuid(raw)) return null;
  const [row] = await db
    .select({ id: swScenes.id })
    .from(swScenes)
    .where(and(eq(swScenes.id, raw.toLowerCase()), eq(swScenes.sessionId, sessionId)))
    .limit(1);
  return row?.id ?? null;
}

/** Number of scenes in one session (admin surfaces only). */
export async function countScenes(sessionId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(swScenes).where(eq(swScenes.sessionId, sessionId));
  return row?.n ?? 0;
}

export interface SceneCopySource {
  id: string;
  name: string;
  kind: string;
  sceneCount: number;
}

/** Other sessions that have at least one scene, for the "Copy scenes from another session" picker. */
export async function listSceneCopySources(excludeSessionId: string): Promise<SceneCopySource[]> {
  const rows = await db
    .select({ id: swSessions.id, name: swSessions.name, kind: swSessions.kind, sceneCount: sql<number>`count(${swScenes.id})::int` })
    .from(swSessions)
    .innerJoin(swScenes, eq(swScenes.sessionId, swSessions.id))
    .where(ne(swSessions.id, excludeSessionId))
    .groupBy(swSessions.id, swSessions.name, swSessions.kind, swSessions.createdAt)
    .orderBy(desc(swSessions.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, sceneCount: r.sceneCount ?? 0 }));
}

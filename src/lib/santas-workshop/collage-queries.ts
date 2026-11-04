/**
 * Public collage data access (`/santas-workshop/c/[token]`). Server-only.
 *
 * "Anyone with the link": the token is the whole credential (128-bit random, so
 * not throttled, Phase 3 ruling 9). What a stranger may see is decided by the
 * SAME function the photo door uses, `decidePhotoAccess({ kind: "public" })`,
 * so the page can never list a photo the door would refuse, nor the reverse:
 * published unhidden group photos, and current unhidden portraits whose stuffy
 * opted in AND were stamped by a publish (a portrait taken after the last publish waits for
 * the next one, like a late group photo). Check-in photos never appear. The DTO is ids and a kind (see
 * collage-contract.ts); it reads no name, contact or storage column.
 *
 * Unknown or malformed token -> null (the page answers one identical 404; a
 * malformed token never reaches the database). An existing but unpublished
 * session is `pending` and a publicly purged one is `removed`, because the
 * frame QR is printed before the photos exist and outlives them (Phase 3).
 *
 * Storyline (DECISION-128): approved GROUP tiles are bucketed by scene AFTER the one
 * approval pass (`decidePhotoAccess` appears once, in `selectCollage`); the scene's
 * title and caption come only from a `sw_scenes` select scoped to THIS session and
 * run after the removed/pending early returns. A photo whose scene is not in that
 * map (deleted, or another session's) falls to `tiles`; a scene is built from its
 * tiles, so an empty or all-hidden scene can never render. The scene id never enters
 * `photoFactsFrom` and never leaves this file.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swScenes, swSessions, swStuffies } from "@/lib/db/schema";
import type { CollageLookup, CollageScene, CollageTile } from "./collage-contract";
import { decidePhotoAccess, photoFactsFrom, type PhotoFacts } from "./photo-access";
import { TOKEN_128_PATTERN } from "./tokens";

export interface CollagePhotoRow {
  id: string;
  kind: string;
  takenAt: Date | null;
  createdAt: Date;
  /** Grouping only. Never part of `facts`; never leaves this module. */
  sceneId?: string | null;
  facts: PhotoFacts;
}

/** A storyline scene as the grouping step needs it (same session only, already in storyline order). */
export interface CollageSceneRow {
  id: string;
  title: string;
  caption: string | null;
}

function byTaken(a: CollagePhotoRow, b: CollagePhotoRow): number {
  const ta = (a.takenAt ?? a.createdAt).getTime();
  const tb = (b.takenAt ?? b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pure: what a stranger sees. ONE approval pass (the same function the photo door uses), then grouping
 * over its output only. `scenes` lists, in the order given, each scene that has at least one approved
 * group tile (tiles by capture time then id); `tiles` is everything else exactly as before the
 * storyline existed: unscened group tiles first, then portraits, each by capture time then id.
 */
export function selectCollage(rows: CollagePhotoRow[], scenes: CollageSceneRow[]): { scenes: CollageScene[]; tiles: CollageTile[] } {
  const visible = rows.filter(
    (r) => (r.kind === "group" || r.kind === "portrait") && decidePhotoAccess({ kind: "public" }, r.facts, "thumb"),
  );
  const known = new Map(scenes.map((s) => [s.id, s]));
  const inScene = (r: CollagePhotoRow) => r.kind === "group" && r.sceneId != null && known.has(r.sceneId);

  const outScenes: CollageScene[] = [];
  for (const scene of scenes) {
    const bucket = visible.filter((r) => inScene(r) && r.sceneId === scene.id).sort(byTaken);
    if (bucket.length > 0) outScenes.push({ title: scene.title, caption: scene.caption, tiles: bucket.map((r) => ({ id: r.id, kind: "group" as const })) });
  }

  const tiles: CollageTile[] = [];
  for (const kind of ["group", "portrait"] as const) {
    for (const r of visible.filter((v) => v.kind === kind && !inScene(v)).sort(byTaken)) tiles.push({ id: r.id, kind });
  }
  return { scenes: outScenes, tiles };
}

/** The tiles with no storyline: identical to `selectCollage(rows, []).tiles`. */
export function selectCollageTiles(rows: CollagePhotoRow[]): CollageTile[] {
  return selectCollage(rows, []).tiles;
}

export async function getCollage(token: string): Promise<CollageLookup> {
  if (typeof token !== "string" || !TOKEN_128_PATTERN.test(token)) return null;

  const [session] = await db
    .select({
      id: swSessions.id,
      kind: swSessions.kind,
      photoDate: swSessions.photoDate,
      collagePublishedAt: swSessions.collagePublishedAt,
      publicPurgedAt: swSessions.publicPurgedAt,
    })
    .from(swSessions)
    .where(eq(swSessions.collageToken, token))
    .limit(1);
  if (!session) return null;

  const practice = session.kind === "practice";
  if (session.publicPurgedAt) return { state: "removed", practice, arrivesOn: null, scenes: [], tiles: [] };
  if (!session.collagePublishedAt) return { state: "pending", practice, arrivesOn: session.photoDate, scenes: [], tiles: [] };

  const [rows, sceneRows] = await Promise.all([
    db
    .select({
      id: swPhotos.id,
      kind: swPhotos.kind,
      sceneId: swPhotos.sceneId,
      sessionId: swPhotos.sessionId,
      stuffyId: swPhotos.stuffyId,
      takenAt: swPhotos.takenAt,
      createdAt: swPhotos.createdAt,
      hiddenAt: swPhotos.hiddenAt,
      supersededAt: swPhotos.supersededAt,
      purgedAt: swPhotos.purgedAt,
      publishedAt: swPhotos.publishedAt,
      consent: swStuffies.photoConsent,
    })
    .from(swPhotos)
    .leftJoin(swStuffies, eq(swPhotos.stuffyId, swStuffies.id))
    .where(
      and(
        eq(swPhotos.sessionId, session.id),
        inArray(swPhotos.kind, ["group", "portrait"]),
        isNull(swPhotos.purgedAt),
        isNull(swPhotos.hiddenAt),
        isNull(swPhotos.supersededAt),
      ),
    ),
    db
      .select({ id: swScenes.id, title: swScenes.title, caption: swScenes.caption })
      .from(swScenes)
      .where(eq(swScenes.sessionId, session.id))
      .orderBy(asc(swScenes.position), asc(swScenes.createdAt), asc(swScenes.id)),
  ]);

  const view = selectCollage(
    rows.map(({ sceneId, ...photo }) => ({
      id: photo.id,
      kind: photo.kind,
      takenAt: photo.takenAt,
      createdAt: photo.createdAt,
      sceneId,
      facts: photoFactsFrom({ ...photo, consent: photo.consent === true, collagePublishedAt: session.collagePublishedAt }),
    })),
    sceneRows,
  );
  return { state: "live", practice, arrivesOn: null, scenes: view.scenes, tiles: view.tiles };
}

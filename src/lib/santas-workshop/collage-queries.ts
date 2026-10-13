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
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, swStuffies } from "@/lib/db/schema";
import type { CollageLookup, CollageTile } from "./collage-contract";
import { decidePhotoAccess, photoFactsFrom, type PhotoFacts } from "./photo-access";
import { TOKEN_128_PATTERN } from "./tokens";

export interface CollagePhotoRow {
  id: string;
  kind: string;
  takenAt: Date | null;
  createdAt: Date;
  facts: PhotoFacts;
}

function byTaken(a: CollagePhotoRow, b: CollagePhotoRow): number {
  const ta = (a.takenAt ?? a.createdAt).getTime();
  const tb = (b.takenAt ?? b.createdAt).getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Pure: the tiles a stranger sees, in stable order (group photos first, then portraits, each by capture time then id). */
export function selectCollageTiles(rows: CollagePhotoRow[]): CollageTile[] {
  const visible = rows.filter(
    (r) => (r.kind === "group" || r.kind === "portrait") && decidePhotoAccess({ kind: "public" }, r.facts, "thumb"),
  );
  const tiles: CollageTile[] = [];
  for (const kind of ["group", "portrait"] as const) {
    for (const r of visible.filter((v) => v.kind === kind).sort(byTaken)) tiles.push({ id: r.id, kind });
  }
  return tiles;
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
  if (session.publicPurgedAt) return { state: "removed", practice, arrivesOn: null, tiles: [] };
  if (!session.collagePublishedAt) return { state: "pending", practice, arrivesOn: session.photoDate, tiles: [] };

  const rows = await db
    .select({
      id: swPhotos.id,
      kind: swPhotos.kind,
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
    );

  const tiles = selectCollageTiles(
    rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      takenAt: r.takenAt,
      createdAt: r.createdAt,
      facts: photoFactsFrom({ ...r, consent: r.consent === true, collagePublishedAt: session.collagePublishedAt }),
    })),
  );
  return { state: "live", practice, arrivesOn: null, tiles };
}

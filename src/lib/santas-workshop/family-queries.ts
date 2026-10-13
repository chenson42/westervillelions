/**
 * Family page data access (`/santas-workshop/f/[token]`). Server-only.
 *
 * The token (128-bit random, so not throttled: Phase 3 ruling 9) maps to one
 * stuffy. What the family may see is decided by the SAME function the photo door
 * uses, `decidePhotoAccess({ kind: "family" })`, so the page can never offer a
 * portrait the door would refuse. The family sees its own current, unhidden
 * portrait regardless of photo-sharing consent and regardless of the publish
 * batch (a retake is theirs at once), but only once the session's collage is
 * published, and never after the public purge. The check-in photo is never read.
 * The query selects no parent, child or contact column (scan-tested).
 *
 * Unknown, malformed or withdrawn token -> null (one identical 404; a malformed
 * token never reaches the database).
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, swStuffies } from "@/lib/db/schema";
import type { FamilyLookup, FamilyPortrait } from "./family-contract";
import { COLLAGE_PATH_PREFIX } from "./facts";
import { decidePhotoAccess, photoFactsFrom } from "./photo-access";
import { TOKEN_128_PATTERN } from "./tokens";

interface FamilyStuffyRow {
  stuffyId: string;
  stuffyName: string | null;
  withdrawnAt: Date | null;
  sessionId: string;
  kind: string;
  photoDate: string;
  collageToken: string;
  collagePublishedAt: Date | null;
  personalPurgedAt: Date | null;
  publicPurgedAt: Date | null;
}

async function loadFamilyStuffy(token: string): Promise<FamilyStuffyRow | null> {
  if (typeof token !== "string" || !TOKEN_128_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      stuffyId: swStuffies.id,
      stuffyName: swStuffies.name,
      withdrawnAt: swStuffies.withdrawnAt,
      sessionId: swSessions.id,
      kind: swSessions.kind,
      photoDate: swSessions.photoDate,
      collageToken: swSessions.collageToken,
      collagePublishedAt: swSessions.collagePublishedAt,
      personalPurgedAt: swSessions.personalPurgedAt,
      publicPurgedAt: swSessions.publicPurgedAt,
    })
    .from(swStuffies)
    .innerJoin(swSessions, eq(swStuffies.sessionId, swSessions.id))
    .where(eq(swStuffies.familyToken, token))
    .limit(1);
  if (!row || row.withdrawnAt) return null;
  return row;
}

interface PortraitRow {
  id: string;
  hiddenAt: Date | null;
  publishedAt: Date | null;
  purgedAt: Date | null;
}

/** The stuffy's current portrait row (not retaken, not purged), or null. */
async function currentPortrait(stuffyId: string): Promise<PortraitRow | null> {
  const [row] = await db
    .select({ id: swPhotos.id, hiddenAt: swPhotos.hiddenAt, publishedAt: swPhotos.publishedAt, purgedAt: swPhotos.purgedAt })
    .from(swPhotos)
    .where(and(eq(swPhotos.stuffyId, stuffyId), eq(swPhotos.kind, "portrait"), isNull(swPhotos.supersededAt), isNull(swPhotos.purgedAt)))
    .orderBy(desc(swPhotos.createdAt))
    .limit(1);
  return row ?? null;
}

function portraitFacts(s: FamilyStuffyRow, p: PortraitRow) {
  return photoFactsFrom({
    kind: "portrait",
    sessionId: s.sessionId,
    stuffyId: s.stuffyId,
    hiddenAt: p.hiddenAt,
    supersededAt: null,
    purgedAt: p.purgedAt,
    publishedAt: p.publishedAt,
    consent: false, // irrelevant to the family viewer
    collagePublishedAt: s.collagePublishedAt,
    personalPurgedAt: s.personalPurgedAt,
    publicPurgedAt: s.publicPurgedAt,
  });
}

export async function getFamilyView(token: string): Promise<FamilyLookup> {
  const s = await loadFamilyStuffy(token);
  if (!s) return null;
  const practice = s.kind === "practice";
  const base = { practice, stuffyName: s.stuffyName };
  if (s.publicPurgedAt) return { ...base, collage: "removed", arrivesOn: null, portrait: { state: "none" }, collagePath: null };

  // The family's own portrait does not wait for the collage publish (S5-D1); only the collage link does.
  const p = await currentPortrait(s.stuffyId);
  let portrait: FamilyPortrait = { state: "none" };
  if (p) {
    portrait = decidePhotoAccess({ kind: "family", stuffyId: s.stuffyId }, portraitFacts(s, p), "full")
      ? { state: "available", version: p.id }
      : { state: "unavailable" };
  }
  if (!s.collagePublishedAt) return { ...base, collage: "pending", arrivesOn: s.photoDate, portrait, collagePath: null };
  return { ...base, collage: "live", arrivesOn: null, portrait, collagePath: `${COLLAGE_PATH_PREFIX}${s.collageToken}` };
}

/** For the family portrait door: the stuffy and its current portrait id, or null. The door still decides. */
export async function resolveFamilyPortrait(token: string): Promise<{ stuffyId: string; photoId: string } | null> {
  const s = await loadFamilyStuffy(token);
  if (!s) return null;
  const p = await currentPortrait(s.stuffyId);
  return p ? { stuffyId: s.stuffyId, photoId: p.id } : null;
}

/**
 * Admin photo review, hide/unhide, and collage publish. Server-only.
 *
 *   - listSessionPhotos: current group photos and portraits, with the hidden flag,
 *     consent, review state and whether a stranger sees each right now.
 *   - setPhotoHidden: hide or unhide ONE photo (audited). A hidden photo is 404 at
 *     the photo door for everyone but an admin, on the next fetch.
 *   - markGroupPhotosReviewed: records the newest group photo the admin looked through (audited);
 *     the cutoff is compared in SQL only, never through a JS Date (S3-D1).
 *   - setCollagePublished: publish is refused (409 photos_unreviewed) while any
 *     unhidden, unpublished group photo has not been reviewed; it then stamps the
 *     session, every reviewed group photo and every consented portrait in one transaction. Repeatable for
 *     late photos. Unpublish returns the page to "pending"; photos keep their stamp.
 *
 * Audit rows hold ids and counts only, never the collage token or a name.
 */

import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, swStuffies } from "@/lib/db/schema";
import type { SwSession } from "@/lib/db/schema";
import { getAppUrl } from "@/lib/email-compose";
import {
  PHOTOS_PAGE_SIZE,
  type AdminPhotoDto,
  type CollageAdminInfo,
  type HidePhotoResponse,
  type PhotoCounts,
  type PhotoListKind,
  type PhotosListResponse,
  type PublishAction,
  type PublishResponse,
  type ReviewPhotosResponse,
} from "./admin-contract";
import { COLLAGE_PATH_PREFIX } from "./facts";
import { decidePhotoAccess, photoFactsFrom } from "./photo-access";
import { logSessionEvent } from "./session-log";
import { failure, getSessionRow, type QueryFailure } from "./session-queries";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The collage address and the exact QR text for it (the frame slice reuses this). */
export function collageUrl(token: string): string {
  return `${getAppUrl()}${COLLAGE_PATH_PREFIX}${token}`;
}

export function collageAdminInfo(row: Pick<SwSession, "collageToken" | "collagePublishedAt">, reviewedThrough: string | null): CollageAdminInfo {
  const url = collageUrl(row.collageToken);
  return { url, qrPayload: url, published: row.collagePublishedAt !== null, publishedAt: iso(row.collagePublishedAt), reviewedThrough };
}

/**
 * The review cutoff, as the DATABASE's own timestamp. A review is recorded as the id of the
 * newest group photo the admin saw (`throughPhotoId`), and "reviewed" means
 * `created_at <= (that photo's created_at)`, compared entirely in SQL. The cutoff never
 * round-trips through a JavaScript Date: `timestamptz` carries microseconds and a Date keeps
 * only milliseconds, which once left the newest photo permanently "unreviewed" (S3-D1).
 */
export const reviewCutoffSql = (sessionId: string) => sql`(
  select max(rp.created_at) from sw_photos rp
  where rp.session_id = ${sessionId}
    and rp.id in (
      select (l.detail->>'throughPhotoId')::uuid from sw_session_log l
      where l.session_id = ${sessionId} and l.kind = 'group_photos_reviewed' and l.detail->>'throughPhotoId' is not null
    )
)`;

/** True when the photo was uploaded at or before the latest review (false when never reviewed). */
export const reviewCoveredSql = (sessionId: string) => sql`coalesce(${swPhotos.createdAt} <= ${reviewCutoffSql(sessionId)}, false)`;

/** The cutoff as the database's own text, for display only. Never parsed or compared in JS. */
export async function loadReviewedThrough(sessionId: string): Promise<string | null> {
  const [row] = await db.select({ t: sql<string | null>`${reviewCutoffSql(sessionId)}::text` }).from(swSessions).where(eq(swSessions.id, sessionId)).limit(1);
  return row?.t ?? null;
}

/** Unhidden, unpublished, unpurged group photos the admin has not reviewed. */
export async function countUnreviewedGroups(sessionId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(swPhotos)
    .where(
      and(
        eq(swPhotos.sessionId, sessionId),
        eq(swPhotos.kind, "group"),
        isNull(swPhotos.hiddenAt),
        isNull(swPhotos.publishedAt),
        isNull(swPhotos.purgedAt),
        sql`not ${reviewCoveredSql(sessionId)}`,
      ),
    );
  return row?.n ?? 0;
}

export async function getPhotoCounts(sessionId: string): Promise<PhotoCounts> {
  const [r] = await db
    .select({
      groupTotal: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'group'))::int`,
      groupHidden: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'group' and ${swPhotos.hiddenAt} is not null))::int`,
      groupUnreviewed: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'group' and ${swPhotos.hiddenAt} is null and ${swPhotos.publishedAt} is null and not ${reviewCoveredSql(sessionId)}))::int`,
      groupPublished: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'group' and ${swPhotos.hiddenAt} is null and ${swPhotos.publishedAt} is not null))::int`,
      portraitsCurrent: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'portrait'))::int`,
      portraitsHidden: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'portrait' and ${swPhotos.hiddenAt} is not null))::int`,
      portraitsOnCollage: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'portrait' and ${swPhotos.hiddenAt} is null and ${swStuffies.photoConsent}))::int`,
      portraitsNotConsented: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'portrait' and not coalesce(${swStuffies.photoConsent}, false)))::int`,
      awaitingPublish: sql<number>`(count(*) filter (where ${swPhotos.hiddenAt} is null and ${swPhotos.publishedAt} is null and (${swPhotos.kind} = 'group' or (${swPhotos.kind} = 'portrait' and ${swStuffies.photoConsent}))))::int`,
      portraitsAwaitingPublish: sql<number>`(count(*) filter (where ${swPhotos.kind} = 'portrait' and ${swPhotos.hiddenAt} is null and ${swPhotos.publishedAt} is null and ${swStuffies.photoConsent}))::int`,
      newestGroupAt: sql<Date | null>`max(${swPhotos.createdAt}) filter (where ${swPhotos.kind} = 'group')`,
      newestGroupPhotoId: sql<string | null>`(array_agg(${swPhotos.id} order by ${swPhotos.createdAt} desc, ${swPhotos.id} desc) filter (where ${swPhotos.kind} = 'group'))[1]`,
    })
    .from(swPhotos)
    .leftJoin(swStuffies, eq(swPhotos.stuffyId, swStuffies.id))
    .where(and(eq(swPhotos.sessionId, sessionId), isNull(swPhotos.purgedAt), isNull(swPhotos.supersededAt)));
  const newest = r?.newestGroupAt ? new Date(r.newestGroupAt as unknown as string | Date) : null;
  return {
    groupTotal: r?.groupTotal ?? 0,
    groupHidden: r?.groupHidden ?? 0,
    groupUnreviewed: r?.groupUnreviewed ?? 0,
    groupPublished: r?.groupPublished ?? 0,
    portraitsCurrent: r?.portraitsCurrent ?? 0,
    portraitsHidden: r?.portraitsHidden ?? 0,
    portraitsOnCollage: r?.portraitsOnCollage ?? 0,
    portraitsNotConsented: r?.portraitsNotConsented ?? 0,
    awaitingPublish: r?.awaitingPublish ?? 0,
    portraitsAwaitingPublish: r?.portraitsAwaitingPublish ?? 0,
    newestGroupAt: newest ? newest.toISOString() : null, // display only; the review uses newestGroupPhotoId
    newestGroupPhotoId: r?.newestGroupPhotoId ?? null,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listSessionPhotos(
  sessionId: string,
  opts: { kind: PhotoListKind | null; page: number },
): Promise<PhotosListResponse | QueryFailure> {
  const session = await getSessionRow(sessionId);
  if (!session) return failure(404, "not_found", "Session not found");
  const reviewedThrough = await loadReviewedThrough(sessionId);

  const kinds: PhotoListKind[] = opts.kind ? [opts.kind] : ["group", "portrait"];
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
      stuffyName: swStuffies.name,
      consent: swStuffies.photoConsent,
      covered: reviewCoveredSql(sessionId).mapWith(Boolean),
    })
    .from(swPhotos)
    .leftJoin(swStuffies, eq(swPhotos.stuffyId, swStuffies.id))
    .where(and(eq(swPhotos.sessionId, sessionId), inArray(swPhotos.kind, kinds), isNull(swPhotos.purgedAt), isNull(swPhotos.supersededAt)))
    .orderBy(asc(swPhotos.kind), sql`${swPhotos.takenAt} asc nulls last`, asc(swPhotos.id))
    .limit(PHOTOS_PAGE_SIZE + 1)
    .offset((opts.page - 1) * PHOTOS_PAGE_SIZE);

  const hasMore = rows.length > PHOTOS_PAGE_SIZE;
  const photos: AdminPhotoDto[] = rows.slice(0, PHOTOS_PAGE_SIZE).map((r) => {
    const group = r.kind === "group";
    const consent = group ? null : r.consent === true;
    const facts = photoFactsFrom({ ...r, consent: consent === true, collagePublishedAt: session.collagePublishedAt });
    return {
      id: r.id,
      kind: r.kind as PhotoListKind,
      takenAt: iso(r.takenAt),
      createdAt: r.createdAt.toISOString(),
      hidden: r.hiddenAt !== null,
      publishedAt: iso(r.publishedAt),
      reviewed: group ? r.publishedAt !== null || r.covered : null,
      consent,
      stuffyName: group ? null : r.stuffyName,
      onCollage: decidePhotoAccess({ kind: "public" }, facts, "thumb"),
      awaitingPublish: needsPublishFor({ hidden: false, publishedAt: r.publishedAt, kind: r.kind, consent: consent === true }) && r.hiddenAt === null,
    };
  });

  return {
    photos,
    page: opts.page,
    hasMore,
    counts: await getPhotoCounts(sessionId),
    collage: collageAdminInfo(session, reviewedThrough),
    sessionKind: session.kind as PhotosListResponse["sessionKind"],
  };
}

// ---------------------------------------------------------------------------
// Hide / unhide
// ---------------------------------------------------------------------------

/**
 * After an unhide: the photo has never been published and would be on the collage once it is
 * (a group photo, or a consented portrait), so it stays private until the next publish.
 */
export function needsPublishFor(p: { hidden: boolean; publishedAt: Date | null; kind: string; consent: boolean }): boolean {
  if (p.hidden || p.publishedAt !== null) return false;
  return p.kind === "group" || (p.kind === "portrait" && p.consent);
}

export async function setPhotoHidden(
  photoId: string,
  hidden: boolean,
  userId: string,
  now: Date = new Date(),
): Promise<HidePhotoResponse | QueryFailure> {
  const [photo] = await db
    .select({
      id: swPhotos.id,
      sessionId: swPhotos.sessionId,
      kind: swPhotos.kind,
      hiddenAt: swPhotos.hiddenAt,
      purgedAt: swPhotos.purgedAt,
      publishedAt: swPhotos.publishedAt,
      consent: swStuffies.photoConsent,
    })
    .from(swPhotos)
    .leftJoin(swStuffies, eq(swPhotos.stuffyId, swStuffies.id))
    .where(eq(swPhotos.id, photoId))
    .limit(1);
  if (!photo || photo.purgedAt) return failure(404, "not_found", "Photo not found");

  const kind = photo.kind as PhotoListKind;
  const dto = { id: photo.id, kind, hidden };
  const needsPublish = needsPublishFor({ hidden, publishedAt: photo.publishedAt, kind: photo.kind, consent: photo.consent === true });
  if ((photo.hiddenAt !== null) === hidden) return { photo: dto, noop: true, needsPublish };

  // Pinned on the state the admin saw: a concurrent toggle is a no-op, not a double audit row.
  const updated = await db
    .update(swPhotos)
    .set(hidden ? { hiddenAt: now, hiddenByUserId: userId } : { hiddenAt: null, hiddenByUserId: null })
    .where(and(eq(swPhotos.id, photoId), hidden ? isNull(swPhotos.hiddenAt) : isNotNull(swPhotos.hiddenAt), isNull(swPhotos.purgedAt)))
    .returning({ id: swPhotos.id });
  if (updated.length === 0) return { photo: dto, noop: true, needsPublish };

  await logSessionEvent(photo.sessionId, userId, hidden ? "photo_hidden" : "photo_unhidden", { photoId: photo.id, photoKind: photo.kind });
  return { photo: dto, noop: false, needsPublish };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function markGroupPhotosReviewed(sessionId: string, throughPhotoId: string, userId: string): Promise<ReviewPhotosResponse | QueryFailure> {
  const session = await getSessionRow(sessionId);
  if (!session) return failure(404, "not_found", "Session not found");
  if (session.publicPurgedAt) return failure(409, "session_purged", "A purged session cannot be reviewed");

  const [through] = await db
    .select({ id: swPhotos.id })
    .from(swPhotos)
    .where(and(eq(swPhotos.id, throughPhotoId), eq(swPhotos.sessionId, sessionId), eq(swPhotos.kind, "group")))
    .limit(1);
  if (!through) return failure(400, "invalid_input", "throughPhotoId must be a group photo of this session", "throughPhotoId");

  const before = await getPhotoCounts(sessionId);
  await logSessionEvent(sessionId, userId, "group_photos_reviewed", {
    throughPhotoId: through.id,
    groupTotal: before.groupTotal,
    groupHidden: before.groupHidden,
  });
  return { counts: await getPhotoCounts(sessionId), collage: collageAdminInfo(session, await loadReviewedThrough(sessionId)) };
}

// ---------------------------------------------------------------------------
// Publish / unpublish
// ---------------------------------------------------------------------------

export async function setCollagePublished(
  sessionId: string,
  action: PublishAction,
  userId: string,
  now: Date = new Date(),
): Promise<PublishResponse | QueryFailure> {
  const session = await getSessionRow(sessionId);
  if (!session) return failure(404, "not_found", "Session not found");
  if (session.publicPurgedAt || session.status === "purged") return failure(409, "session_purged", "A purged session cannot be published");

  const alreadyPublished = session.collagePublishedAt !== null;
  let current = session;
  let newlyPublished = 0;
  let noop = false;

  if (action === "unpublish") {
    if (!alreadyPublished) {
      noop = true;
    } else {
      const updated = await db
        .update(swSessions)
        .set({ collagePublishedAt: null, updatedAt: now })
        .where(and(eq(swSessions.id, sessionId), isNotNull(swSessions.collagePublishedAt)))
        .returning();
      if (updated.length === 0) noop = true;
      else {
        current = updated[0];
        await logSessionEvent(sessionId, userId, "collage_unpublished", {});
      }
    }
  } else {
    const unreviewed = await countUnreviewedGroups(sessionId);
    if (unreviewed > 0) {
      return failure(409, "photos_unreviewed", `${unreviewed} group photo${unreviewed === 1 ? " has" : "s have"} not been reviewed yet`, undefined, { count: unreviewed });
    }
    const result = await db.transaction(async (tx) => {
      const [sessionRow] = await tx
        .update(swSessions)
        .set({ collagePublishedAt: session.collagePublishedAt ?? now, updatedAt: now })
        .where(eq(swSessions.id, sessionId))
        .returning();
      // Group photos the review covered, plus consented portraits (no review step for portraits: the
      // batch gate is enough). Anything taken after this moment stays private until the next publish.
      const stamped = await tx
        .update(swPhotos)
        .set({ publishedAt: now })
        .where(
          and(
            eq(swPhotos.sessionId, sessionId),
            isNull(swPhotos.hiddenAt),
            isNull(swPhotos.publishedAt),
            isNull(swPhotos.purgedAt),
            isNull(swPhotos.supersededAt),
            or(
              and(eq(swPhotos.kind, "group"), reviewCoveredSql(sessionId)),
              and(eq(swPhotos.kind, "portrait"), sql`exists (select 1 from sw_stuffies sc where sc.id = ${swPhotos.stuffyId} and sc.photo_consent)`),
            ),
          ),
        )
        .returning({ id: swPhotos.id });
      return { sessionRow, count: stamped.length };
    });
    current = result.sessionRow ?? session;
    newlyPublished = result.count;
    noop = alreadyPublished && newlyPublished === 0;
    if (!noop) await logSessionEvent(sessionId, userId, "collage_published", { photosPublished: newlyPublished, first: !alreadyPublished });
  }

  return { collage: collageAdminInfo(current, await loadReviewedThrough(sessionId)), counts: await getPhotoCounts(sessionId), newlyPublished, noop };
}

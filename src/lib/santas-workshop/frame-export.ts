/**
 * Frame export, server side (Slice 4). Server-only.
 *
 * Frames are composited in the admin's browser (DECISION-124); the server's whole job is
 * the manifest and the "exported" marker:
 *   - buildFrameManifest: refuses a real session whose collage link is not the production
 *     origin (409 collage_url_not_production), allocates persisted frame numbers for every
 *     stuffy with an exportable portrait (under a session-row lock, one retry on a unique
 *     violation), and returns the rows the browser needs, including those for the index CSV.
 *   - markFramesExported: stamps `frame_exported_photo_id` with the photo the browser actually
 *     used, for produced frames only. Idempotent. A later retake therefore reads "changed".
 *
 * The manifest holds parent NAMES (the index CSV needs them) and never an email, phone or note.
 * Audit rows hold counts only.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swPhotos, swSessionLog, swSessions, swStuffies } from "@/lib/db/schema";
import {
  FRAME_EXPORTED_MAX_ITEMS,
  type FrameManifest,
  type FramesExportedItem,
  type FramesExportedResponse,
} from "./admin-contract";
import { frameOriginAllowed, type FrameOriginEnv } from "./frame-origin";
import { framePrefix } from "./frame-names";
import { buildFrameEntries, planFrameNumbers, type FrameStuffyRow } from "./frame-manifest";
import { collageAdminInfo } from "./photo-admin";
import { logSessionEvent } from "./session-log";
import { failure, getSessionRow, isUniqueViolation, type QueryFailure } from "./session-queries";

async function loadRows(sessionId: string, windows: { id: string; label: string }[], tx: Pick<typeof db, "select"> = db): Promise<FrameStuffyRow[]> {
  const rows = await tx
    .select({
      stuffyId: swStuffies.id,
      name: swStuffies.name,
      parentFirst: swOrders.buyerFirstName,
      parentLast: swOrders.buyerLastName,
      windowId: swOrders.windowId,
      consent: swStuffies.photoConsent,
      frameNumber: swStuffies.frameNumber,
      exportedPhotoId: swStuffies.frameExportedPhotoId,
      portraitId: swPhotos.id,
      portraitHiddenAt: swPhotos.hiddenAt,
    })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .leftJoin(
      swPhotos,
      and(eq(swPhotos.stuffyId, swStuffies.id), eq(swPhotos.kind, "portrait"), isNull(swPhotos.supersededAt), isNull(swPhotos.purgedAt)),
    )
    .where(and(eq(swStuffies.sessionId, sessionId), isNull(swStuffies.withdrawnAt)));
  return rows.map((r) => ({
    stuffyId: r.stuffyId,
    name: r.name,
    parentFirst: r.parentFirst,
    parentLast: r.parentLast,
    windowLabel: windows.find((w) => w.id === r.windowId)?.label ?? null,
    consent: r.consent,
    frameNumber: r.frameNumber,
    exportedPhotoId: r.exportedPhotoId,
    portrait: r.portraitId ? { id: r.portraitId, hidden: r.portraitHiddenAt !== null } : null,
  }));
}

/** Hands out missing frame numbers once, under a lock on the session row. Existing numbers never change. */
async function allocateFrameNumbers(sessionId: string, windows: { id: string; label: string }[]): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.id, sessionId)).for("update");
        const rows = await loadRows(sessionId, windows, tx);
        const [m] = await tx
          .select({ max: sql<number>`coalesce(max(${swStuffies.frameNumber}), 0)::int` })
          .from(swStuffies)
          .where(eq(swStuffies.sessionId, sessionId));
        for (const p of planFrameNumbers(rows, m?.max ?? 0)) {
          await tx
            .update(swStuffies)
            .set({ frameNumber: p.frameNumber })
            .where(and(eq(swStuffies.id, p.stuffyId), eq(swStuffies.sessionId, sessionId), isNull(swStuffies.frameNumber)));
        }
      });
      return;
    } catch (e) {
      if (attempt === 0 && isUniqueViolation(e, "frame")) continue;
      throw e;
    }
  }
}

export async function buildFrameManifest(
  sessionId: string,
  env: FrameOriginEnv = process.env as FrameOriginEnv,
): Promise<FrameManifest | QueryFailure> {
  const session = await getSessionRow(sessionId);
  if (!session) return failure(404, "not_found", "Session not found");
  if (session.publicPurgedAt || session.status === "purged") return failure(409, "session_purged", "A purged session has no frames to export");

  const collage = collageAdminInfo(session, null);
  const kind = session.kind as FrameManifest["kind"];
  if (!frameOriginAllowed(collage.qrPayload, kind, env)) {
    return failure(409, "collage_url_not_production", "The collage link is not the production address");
  }

  await allocateFrameNumbers(sessionId, session.windows);
  const rows = await loadRows(sessionId, session.windows);
  const prefix = framePrefix(session.slug, session.frameFilePrefix);
  const { items, withheld, counts } = buildFrameEntries(rows, prefix);

  const [last] = await db
    .select({ at: sql<string | null>`to_char(max(${swSessionLog.createdAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
    .from(swSessionLog)
    .where(and(eq(swSessionLog.sessionId, sessionId), eq(swSessionLog.kind, "frames_exported")));
  // The instant arrives as an unambiguous UTC ISO string (a raw timestamptz string such as "2026-10-13 05:30:00+00" is parsed as server-local time by some runtimes: a 4 hour shift).
  const lastDate = last?.at ? new Date(last.at) : null;

  return {
    sessionId,
    kind,
    slug: session.slug,
    qrPayload: collage.qrPayload,
    collageUrl: collage.url,
    frameArtKey: session.frameArtKey,
    filePrefix: prefix,
    partSize: session.framePartSize,
    lastExportAt: lastDate && !Number.isNaN(lastDate.getTime()) ? lastDate.toISOString() : null, // display only
    items,
    withheld,
    counts,
  };
}

/** Why an exported item is refused (pure, tested): the stuffy, its number and the photo must all match. */
export function exportedItemMatches(
  item: FramesExportedItem,
  stuffy: { id: string; frameNumber: number | null } | undefined,
  photo: { id: string; stuffyId: string | null; kind: string } | undefined,
): boolean {
  return Boolean(stuffy && photo && stuffy.frameNumber === item.frameNumber && photo.stuffyId === stuffy.id && photo.kind === "portrait");
}

export async function markFramesExported(
  sessionId: string,
  items: FramesExportedItem[],
  partial: boolean,
  userId: string,
): Promise<FramesExportedResponse | QueryFailure> {
  if (items.length > FRAME_EXPORTED_MAX_ITEMS) return failure(400, "invalid_input", `At most ${FRAME_EXPORTED_MAX_ITEMS} frames per call`, "items");
  const session = await getSessionRow(sessionId);
  if (!session) return failure(404, "not_found", "Session not found");
  if (session.publicPurgedAt || session.status === "purged") return failure(409, "session_purged", "A purged session cannot be changed");

  const unique = [...new Map(items.map((i) => [i.stuffyId, i])).values()];
  if (unique.length === 0) return { marked: 0, unchanged: 0, rejected: [] };

  const stuffies = await db
    .select({ id: swStuffies.id, frameNumber: swStuffies.frameNumber })
    .from(swStuffies)
    .where(and(eq(swStuffies.sessionId, sessionId), inArray(swStuffies.id, unique.map((i) => i.stuffyId))));
  const photos = await db
    .select({ id: swPhotos.id, stuffyId: swPhotos.stuffyId, kind: swPhotos.kind })
    .from(swPhotos)
    .where(and(eq(swPhotos.sessionId, sessionId), inArray(swPhotos.id, unique.map((i) => i.photoId))));
  const stuffyById = new Map(stuffies.map((s) => [s.id, s]));
  const photoById = new Map(photos.map((p) => [p.id, p]));

  const valid: FramesExportedItem[] = [];
  const rejected: string[] = [];
  for (const i of unique) {
    if (exportedItemMatches(i, stuffyById.get(i.stuffyId), photoById.get(i.photoId))) valid.push(i);
    else rejected.push(i.stuffyId);
  }

  let marked = 0;
  for (const i of valid) {
    const updated = await db
      .update(swStuffies)
      .set({ frameExportedPhotoId: i.photoId })
      .where(
        and(
          eq(swStuffies.id, i.stuffyId),
          eq(swStuffies.sessionId, sessionId),
          eq(swStuffies.frameNumber, i.frameNumber),
          sql`${swStuffies.frameExportedPhotoId} is distinct from ${i.photoId}`,
        ),
      )
      .returning({ id: swStuffies.id });
    marked += updated.length;
  }
  if (marked > 0) await logSessionEvent(sessionId, userId, "frames_exported", { marked, unchanged: valid.length - marked, rejected: rejected.length, partial });
  return { marked, unchanged: valid.length - marked, rejected };
}

/**
 * Club Files — server-only query module (DB reads/writes) for the metadata
 * side of the feature: CRUD, event attachments, and the visibility-scoped
 * listings consumed by the member portal and public event pages.
 *
 * docs/work-log/2026-09-04-club-documents.md, Phase 3 "API Contract" /
 * "Data Model". DECISION-094 (bytea sibling storage).
 *
 * The chunked-upload session protocol (init/chunk/finalize) lives in the
 * sibling module `club-file-upload-queries.ts` — kept separate because it's
 * a genuinely different concern (upload transport vs. steady-state CRUD),
 * matching the minutes.ts/minutes-queries.ts and documents.ts/
 * documents-queries.ts split precedent in this codebase.
 *
 * Permission gating (`club_files.manage`) is the CALLER's responsibility
 * (route handlers) — nothing in this file checks FEATURES itself, matching
 * every other query module in this codebase. The one exception is
 * `getClubFileForDownload()`'s caller (the download route), which still
 * does its own visibility check using the row this function returns —
 * this file only fetches, it never decides who may see the bytes.
 */

import { db } from "@/lib/db";
import { clubFiles, clubFileEvents, type ClubFile } from "@/lib/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getClubFileStorage } from "@/lib/club-file-storage";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export const CLUB_FILE_VISIBILITIES = ["public", "members-only"] as const;
export type ClubFileVisibility = (typeof CLUB_FILE_VISIBILITIES)[number];

export function isValidClubFileVisibility(value: unknown): value is ClubFileVisibility {
  return typeof value === "string" && (CLUB_FILE_VISIBILITIES as readonly string[]).includes(value);
}

export interface AdminClubFileSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  filename: string;
  byteSize: number;
  contentType: string;
  attachedEventCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttachedFileSummary {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  visibility: string;
}

export interface MemberClubFileSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  filename: string;
  byteSize: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

/**
 * All club files, newest first, with each row's attached-event count.
 * Counted in one extra query and grouped in JS rather than a SQL GROUP BY —
 * this feature is a handful of files a year, so an N+1-free two-query
 * approach is simpler than a join+aggregate for no meaningful cost.
 */
export async function listClubFilesForAdmin(): Promise<AdminClubFileSummary[]> {
  const [files, attachmentRows] = await Promise.all([
    db.select().from(clubFiles).orderBy(desc(clubFiles.createdAt)),
    db.select({ clubFileId: clubFileEvents.clubFileId }).from(clubFileEvents),
  ]);

  const countByFileId = new Map<string, number>();
  for (const row of attachmentRows) {
    countByFileId.set(row.clubFileId, (countByFileId.get(row.clubFileId) ?? 0) + 1);
  }

  return files.map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    visibility: f.visibility,
    filename: f.filename,
    byteSize: f.byteSize,
    contentType: f.contentType,
    attachedEventCount: countByFileId.get(f.id) ?? 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
}

export async function getClubFileById(id: string): Promise<ClubFile | null> {
  const rows = await db.select().from(clubFiles).where(eq(clubFiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface UpdateClubFileMetadataInput {
  name?: string;
  description?: string | null;
  visibility?: ClubFileVisibility;
}

/** Returns null if the file doesn't exist. Metadata-only — never touches bytes. */
export async function updateClubFileMetadata(
  id: string,
  input: UpdateClubFileMetadataInput,
): Promise<ClubFile | null> {
  const existing = await getClubFileById(id);
  if (!existing) return null;

  const set: Partial<typeof clubFiles.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.visibility !== undefined) set.visibility = input.visibility;

  const [updated] = await db.update(clubFiles).set(set).where(eq(clubFiles.id, id)).returning();
  return updated ?? null;
}

/**
 * Deletes the club_files row (cascades club_file_events via FK) and its
 * durable blob. Returns false if the file didn't exist (caller 404s).
 *
 * Order: delete the row first, then the blob. If the blob delete fails
 * after the row is gone, the result is an orphaned, unreferenced blob —
 * harmless and cheap at this feature's volume — rather than a file record
 * that no longer resolves to bytes.
 */
export async function deleteClubFile(id: string): Promise<boolean> {
  const existing = await getClubFileById(id);
  if (!existing) return false;

  await db.delete(clubFiles).where(eq(clubFiles.id, id));
  await getClubFileStorage().delete(existing.storageKey);
  return true;
}

// ---------------------------------------------------------------------------
// Event attachments (full-set replace)
// ---------------------------------------------------------------------------

export async function getClubFileEventIds(clubFileId: string): Promise<string[]> {
  const rows = await db
    .select({ eventId: clubFileEvents.eventId })
    .from(clubFileEvents)
    .where(eq(clubFileEvents.clubFileId, clubFileId));
  return rows.map((r) => r.eventId);
}

export type SetClubFileEventAttachmentsResult =
  | { ok: true; eventIds: string[] }
  | { ok: false; reason: "not_found" };

/**
 * Replace-the-full-set semantics (Phase 3 API Contract): the caller sends
 * the complete desired set of eventIds; this function dedupes it, diffs
 * against the current attachment rows, and inserts/deletes only the
 * difference inside one transaction — never a delete-all-then-reinsert,
 * which would needlessly reset every row's createdAt.
 */
export async function setClubFileEventAttachments(
  clubFileId: string,
  eventIds: string[],
): Promise<SetClubFileEventAttachmentsResult> {
  const file = await getClubFileById(clubFileId);
  if (!file) return { ok: false, reason: "not_found" };

  // Dedupe the requested set — a duplicate id in the request body must not
  // reach the unique-constrained insert.
  const desired = Array.from(new Set(eventIds));

  const result = await db.transaction(async (tx) => {
    const currentRows = await tx
      .select({ eventId: clubFileEvents.eventId })
      .from(clubFileEvents)
      .where(eq(clubFileEvents.clubFileId, clubFileId));
    const current = new Set(currentRows.map((r) => r.eventId));
    const desiredSet = new Set(desired);

    const toInsert = desired.filter((id) => !current.has(id));
    const toDelete = currentRows.map((r) => r.eventId).filter((id) => !desiredSet.has(id));

    if (toInsert.length > 0) {
      await tx.insert(clubFileEvents).values(toInsert.map((eventId) => ({ clubFileId, eventId })));
    }
    if (toDelete.length > 0) {
      await tx
        .delete(clubFileEvents)
        .where(and(eq(clubFileEvents.clubFileId, clubFileId), inArray(clubFileEvents.eventId, toDelete)));
    }

    return desired;
  });

  return { ok: true, eventIds: result };
}

// ---------------------------------------------------------------------------
// Event-page integration (public + member)
// ---------------------------------------------------------------------------

/** Files attached to an event, visibility='public' only — for /events/[id]. */
export async function getPublicAttachedFiles(eventId: string): Promise<AttachedFileSummary[]> {
  const rows = await db
    .select({
      id: clubFiles.id,
      name: clubFiles.name,
      description: clubFiles.description,
      filename: clubFiles.filename,
      visibility: clubFiles.visibility,
    })
    .from(clubFileEvents)
    .innerJoin(clubFiles, eq(clubFileEvents.clubFileId, clubFiles.id))
    .where(and(eq(clubFileEvents.eventId, eventId), eq(clubFiles.visibility, "public")))
    .orderBy(desc(clubFiles.createdAt));
  return rows;
}

/** Files attached to an event, any visibility — for /members/events/[id]. */
export async function getAllAttachedFiles(eventId: string): Promise<AttachedFileSummary[]> {
  const rows = await db
    .select({
      id: clubFiles.id,
      name: clubFiles.name,
      description: clubFiles.description,
      filename: clubFiles.filename,
      visibility: clubFiles.visibility,
    })
    .from(clubFileEvents)
    .innerJoin(clubFiles, eq(clubFileEvents.clubFileId, clubFiles.id))
    .where(eq(clubFileEvents.eventId, eventId))
    .orderBy(desc(clubFiles.createdAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Member Records "Files" page
// ---------------------------------------------------------------------------

/**
 * ALL club files — public and members-only alike, attached to an event or
 * not — per the User Decision recorded in the work-log: Club Records is the
 * single complete index; event pages are an additional convenience surface,
 * not the only place a file is discoverable.
 */
export async function listAllClubFilesForMembers(): Promise<MemberClubFileSummary[]> {
  const rows = await db
    .select({
      id: clubFiles.id,
      name: clubFiles.name,
      description: clubFiles.description,
      visibility: clubFiles.visibility,
      filename: clubFiles.filename,
      byteSize: clubFiles.byteSize,
      createdAt: clubFiles.createdAt,
    })
    .from(clubFiles)
    .orderBy(desc(clubFiles.createdAt));
  return rows;
}

// ---------------------------------------------------------------------------
// Download route support
// ---------------------------------------------------------------------------

export interface ClubFileForDownload {
  id: string;
  visibility: string;
  storageKey: string;
  filename: string;
  contentType: string;
}

/**
 * Fetches the row the download route needs. Does NOT check visibility —
 * that decision belongs entirely to the route (auth() is only available
 * there), per this module's header note. Returns null for a nonexistent or
 * deleted id, which the route folds into its blanket 404.
 */
export async function getClubFileForDownload(id: string): Promise<ClubFileForDownload | null> {
  const rows = await db
    .select({
      id: clubFiles.id,
      visibility: clubFiles.visibility,
      storageKey: clubFiles.storageKey,
      filename: clubFiles.filename,
      contentType: clubFiles.contentType,
    })
    .from(clubFiles)
    .where(eq(clubFiles.id, id))
    .limit(1);
  return rows[0] ?? null;
}

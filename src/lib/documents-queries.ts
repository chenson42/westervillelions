/**
 * Governance Documents — server-only query module (DB reads/writes).
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3 "API
 * Contract" / "Data Model" / "The Version Lifecycle". DECISION-076
 * (architect), DECISION-081 (`currentVersionId` FK ruling).
 *
 * Pure constants/validators/`diffDocumentVersions()` live in the sibling
 * `src/lib/documents.ts` — this file is exclusively the DB-facing half,
 * matching the `minutes.ts`/`minutes-queries.ts` split (DECISION-074 Ruling
 * 2, generalized to this feature by DECISION-076 Ruling 3 — a NEW sibling
 * pair, not a join into the minutes modules).
 *
 * Permission gating (`documents.manage`) is the CALLER's responsibility
 * (route handlers), matching every other query module in this codebase —
 * nothing in this file checks `FEATURES` itself. The one gate this file DOES
 * enforce is the pending-substantive-version visibility rule (DECISION-076
 * Ruling 6) — that's a data-shape concern (which rows a member-facing query
 * is allowed to return), not a `FEATURES` check, so it lives here rather
 * than in the route layer.
 *
 * **THE ONE INVARIANT THIS FILE MUST HOLD (DECISION-081, restated because
 * there is no DB constraint backing it):** `documents.currentVersionId` has
 * deliberately NO database-level FK (see the schema.ts comment on that
 * column). This module is the ONLY code path that may ever write it, and
 * every write to it must happen inside the SAME transaction as the version
 * row it points to — an editorial save's insert-and-flip
 * (`createDocumentVersion`), or an adopt action's metadata-set-and-flip
 * (`adoptVersion`). `linkCitingMinutes` never touches `currentVersionId` —
 * the document became current at adoption time, not at citation time
 * (Phase 3, "The Version Lifecycle", step 4). Do not add a third writer of
 * this column anywhere else in the codebase.
 */

import { db } from "@/lib/db";
import { documents, documentVersions, minutes, users, type Document, type DocumentVersion } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, not } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Shared row/result types
// ---------------------------------------------------------------------------

export interface CreateDocumentVersionInput {
  documentId: string;
  /** 'editorial' | 'substantive' — caller validates via isValidChangeType()
   *  before calling this function. */
  changeType: string;
  bodyMarkdown: string;
  changeNote: string;
  /** Always session.user.id from the route handler — never client-supplied.
   *  Nullable only because the one-off seed script (no session) also calls
   *  the same insert shape directly for version 1 (attribution-only field,
   *  same convention as minutes.authorUserId). */
  authorUserId: string | null;
}

export interface CreateDocumentVersionResult {
  id: string;
  versionNumber: number;
  changeType: string;
  /** true only for an 'editorial' save — a 'substantive' save is never
   *  current the moment it's inserted (Phase 3, "The Version Lifecycle"). */
  isCurrent: boolean;
}

export interface AdoptVersionInput {
  versionId: string;
  /** Always session.user.id — never client-supplied. */
  adoptedByUserId: string;
  adoptionNote: string;
  /** Deliberately backfillable — see documentVersions.citingMinutesId's
   *  schema comment. Omitted/null is a legitimate, common state: minutes
   *  aren't approved until the meeting after the vote that adopted the
   *  amendment. */
  citingMinutesId?: string | null;
}

export type AdoptVersionResult =
  | { ok: true; id: string; documentId: string }
  | { ok: false; reason: "not_found" | "not_substantive" | "already_adopted" };

export type LinkCitingMinutesResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_found" | "not_adopted" | "minutes_not_found" };

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  changeType: string;
  changeNote: string;
  authorUserId: string | null;
  adoptedByUserId: string | null;
  adoptedAt: Date | null;
  citingMinutesId: string | null;
  adoptionNote: string | null;
  createdAt: Date;
  isCurrent: boolean;
}

export interface DocumentSummary {
  id: string;
  title: string;
  slug: string;
  visibility: string;
  currentVersionNumber: number | null;
}

const VERSION_SUMMARY_COLUMNS = {
  id: documentVersions.id,
  versionNumber: documentVersions.versionNumber,
  changeType: documentVersions.changeType,
  changeNote: documentVersions.changeNote,
  authorUserId: documentVersions.authorUserId,
  adoptedByUserId: documentVersions.adoptedByUserId,
  adoptedAt: documentVersions.adoptedAt,
  citingMinutesId: documentVersions.citingMinutesId,
  adoptionNote: documentVersions.adoptionNote,
  createdAt: documentVersions.createdAt,
} as const;

/** A pending version is 'substantive' with adoptedAt still NULL — the one
 *  filter predicate every member-facing/pending-excluding read shares
 *  (DECISION-076 Ruling 6). Kept as a single expression so the exclusion
 *  logic can't drift between listVersionHistoryForMembers() and
 *  getVersionForCompare(). */
const IS_PENDING = and(eq(documentVersions.changeType, "substantive"), isNull(documentVersions.adoptedAt))!;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Inserts a new, permanent version row. `versionNumber` allocation takes a
 * `SELECT ... FOR UPDATE` lock on the parent `documents` row first, so
 * concurrent saves against the same document can't race to the same number
 * (Phase 3, "Version-number allocation" — the `(documentId, versionNumber)`
 * unique index is the backstop, not the primary defense). An 'editorial'
 * save also flips `documents.currentVersionId` to the new row, inside the
 * SAME transaction as the insert — current changes immediately. A
 * 'substantive' save inserts with adoptedByUserId/adoptedAt/citingMinutesId
 * all NULL and does NOT touch currentVersionId (DECISION-076 Ruling 1, "The
 * Version Lifecycle" steps 1-2).
 */
export async function createDocumentVersion(
  input: CreateDocumentVersionInput,
): Promise<CreateDocumentVersionResult> {
  return db.transaction(async (tx) => {
    // Serialize concurrent saves against this document before computing the
    // next version number.
    await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, input.documentId)).for("update");

    const [latest] = await tx
      .select({ versionNumber: documentVersions.versionNumber })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, input.documentId))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const [inserted] = await tx
      .insert(documentVersions)
      .values({
        documentId: input.documentId,
        versionNumber,
        bodyMarkdown: input.bodyMarkdown,
        changeType: input.changeType,
        changeNote: input.changeNote,
        authorUserId: input.authorUserId,
      })
      .returning({ id: documentVersions.id });

    const isCurrent = input.changeType === "editorial";
    if (isCurrent) {
      await tx
        .update(documents)
        .set({ currentVersionId: inserted.id, updatedAt: new Date() })
        .where(eq(documents.id, input.documentId));
    }

    return { id: inserted.id, versionNumber, changeType: input.changeType, isCurrent };
  });
}

/**
 * Adopts a pending 'substantive' version: sets
 * adoptedByUserId/adoptedAt/adoptionNote (+ citingMinutesId if already
 * known), and — in the SAME transaction — flips
 * `documents.currentVersionId` to this version (Phase 3, "The Version
 * Lifecycle" step 3). Requires the version to exist, be 'substantive', and
 * not already adopted; the caller (the PATCH route) is expected to have
 * already fetched and pre-checked the version via `getVersionForCompare()`
 * before calling this — the checks below are defense-in-depth, not the
 * primary gate (route-level tests assert the route never calls this
 * function when its own pre-check already fails).
 */
export async function adoptVersion(input: AdoptVersionInput): Promise<AdoptVersionResult> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, input.versionId))
      .limit(1);
    if (!version) return { ok: false, reason: "not_found" };
    if (version.changeType !== "substantive") return { ok: false, reason: "not_substantive" };
    if (version.adoptedAt !== null) return { ok: false, reason: "already_adopted" };

    await tx
      .update(documentVersions)
      .set({
        adoptedByUserId: input.adoptedByUserId,
        adoptedAt: new Date(),
        adoptionNote: input.adoptionNote,
        citingMinutesId: input.citingMinutesId ?? null,
      })
      .where(eq(documentVersions.id, input.versionId));

    await tx
      .update(documents)
      .set({ currentVersionId: input.versionId, updatedAt: new Date() })
      .where(eq(documents.id, version.documentId));

    return { ok: true, id: input.versionId, documentId: version.documentId };
  });
}

/**
 * Links (or re-links) a citing minutes record onto an already-adopted
 * version. Never touches `currentVersionId` — the document became current
 * at adoption time, not at citation time (Phase 3, "The Version Lifecycle"
 * step 4). Validates `citingMinutesId` resolves to an existing `minutes` row
 * of ANY status — reopened minutes are still a valid citation target
 * (Phase 3, "Edge Cases": a citation is a stateless FK, indifferent to the
 * cited row's current status).
 */
export async function linkCitingMinutes(
  versionId: string,
  citingMinutesId: string,
): Promise<LinkCitingMinutesResult> {
  const [version] = await db
    .select({ id: documentVersions.id, adoptedAt: documentVersions.adoptedAt })
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  if (!version) return { ok: false, reason: "not_found" };
  if (version.adoptedAt === null) return { ok: false, reason: "not_adopted" };

  const [minutesRow] = await db.select({ id: minutes.id }).from(minutes).where(eq(minutes.id, citingMinutesId)).limit(1);
  if (!minutesRow) return { ok: false, reason: "minutes_not_found" };

  await db.update(documentVersions).set({ citingMinutesId }).where(eq(documentVersions.id, versionId));
  return { ok: true, id: versionId };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDocumentBySlug(slug: string): Promise<Document | null> {
  const [row] = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * The operative text right now — a single indexed FK dereference through
 * `documents.currentVersionId`, NEVER a computed `MAX(versionNumber)` or
 * "latest adopted" query (DECISION-076 Ruling 1). Returns null if the
 * document doesn't exist or (never actually reachable in this design, see
 * Phase 3 "Edge Cases") has no current version yet.
 */
export async function getCurrentVersion(documentId: string): Promise<DocumentVersion | null> {
  const [doc] = await db
    .select({ currentVersionId: documents.currentVersionId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc?.currentVersionId) return null;

  const [version] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, doc.currentVersionId))
    .limit(1);
  return version ?? null;
}

/**
 * Member-facing version history — excludes any row where
 * `changeType = 'substantive' AND adoptedAt IS NULL` (a pending amendment is
 * a proposal, not yet the club's text, DECISION-076 Ruling 6). Most-recent
 * `versionNumber` first. `isCurrent` is computed against the document's live
 * `currentVersionId`, not derived from `adoptedAt`/`changeType`.
 */
export async function listVersionHistoryForMembers(documentId: string): Promise<DocumentVersionSummary[]> {
  const [doc] = await db
    .select({ currentVersionId: documents.currentVersionId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  const currentVersionId = doc?.currentVersionId ?? null;

  const rows = await db
    .select(VERSION_SUMMARY_COLUMNS)
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), not(IS_PENDING)))
    .orderBy(desc(documentVersions.versionNumber));

  return rows.map((r) => ({ ...r, isCurrent: r.id === currentVersionId }));
}

/**
 * Admin-only version history — the full chain, pending substantive versions
 * INCLUDED (this is the one place pending versions are ever listed over
 * HTTP, and the caller — GET /api/admin/documents/[slug]/versions — is
 * `documents.manage`-gated). Same shape/ordering as
 * `listVersionHistoryForMembers()` minus the pending filter. Not one of the
 * eight functions the Phase 3 API Contract names under "Member-facing read
 * path", but required by that same section's admin GET route — added here
 * rather than duplicating the column list a second time.
 */
export async function listVersionsForAdmin(documentId: string): Promise<DocumentVersionSummary[]> {
  const [doc] = await db
    .select({ currentVersionId: documents.currentVersionId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  const currentVersionId = doc?.currentVersionId ?? null;

  const rows = await db
    .select(VERSION_SUMMARY_COLUMNS)
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber));

  return rows.map((r) => ({ ...r, isCurrent: r.id === currentVersionId }));
}

/**
 * Fetches a single version by id for a compare/diff view. With
 * `allowPending: false` (the member compare page's only call shape), a
 * pending id resolves to `null` — never leaks pending text through a
 * guessed/shared URL (Phase 3, "API Contract"). With `allowPending: true`
 * (the admin diff route, and the admin PATCH route's own pre-checks before
 * calling `adoptVersion()`/`linkCitingMinutes()`), any version resolves.
 */
export async function getVersionForCompare(
  id: string,
  opts: { allowPending: boolean },
): Promise<DocumentVersion | null> {
  const [row] = await db.select().from(documentVersions).where(eq(documentVersions.id, id)).limit(1);
  if (!row) return null;
  if (!opts.allowPending && row.changeType === "substantive" && row.adoptedAt === null) return null;
  return row;
}

/**
 * Feeds the "Governing Documents" section on /members/records. Filters
 * `visibility` against whether the caller is authenticated — an
 * unauthenticated visitor only ever sees `visibility: 'public'` rows; any
 * linked member sees both `'public'` and `'members'` rows. (Today: one
 * `'members'`-visibility row, the by-laws, so an unauthenticated caller sees
 * an empty list.) `currentVersionNumber` is a left join off
 * `currentVersionId` — null only in the not-actually-reachable state Phase 3
 * "Edge Cases" describes (a `documents` row that exists but has never had a
 * version inserted).
 */
/**
 * Resolves a batch of user ids to display names for the version-history /
 * adoption UI. Added by ux-developer (Phase 4, UI round) — not one of the
 * Phase 3-named query functions, same "documented as an addition" precedent
 * `listVersionsForAdmin()` already set in the API round. Needed because
 * `document_versions.authorUserId`/`adoptedByUserId` are raw ids with no
 * snapshot column on the row (unlike `minutes.notetakerNameSnapshot`), so
 * the read side has to resolve names itself. Falls back to email when
 * `name` is null; an id with no matching user (a hard-deleted account) is
 * simply absent from the returned map — callers fall back to a generic
 * label rather than crashing on a missing key.
 */
export async function getUserNamesByIds(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (uniqueIds.length === 0) return new Map();

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, uniqueIds));

  return new Map(rows.map((r) => [r.id, r.name?.trim() || r.email]));
}

export async function listDocumentsForMembers(opts: { isAuthenticated: boolean }): Promise<DocumentSummary[]> {
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      visibility: documents.visibility,
      currentVersionNumber: documentVersions.versionNumber,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documents.currentVersionId, documentVersions.id))
    .where(opts.isAuthenticated ? undefined : eq(documents.visibility, "public"))
    .orderBy(documents.title);

  return rows.map((r) => ({ ...r, currentVersionNumber: r.currentVersionNumber ?? null }));
}

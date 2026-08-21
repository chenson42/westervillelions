/**
 * Welcome Packet — server-only query module (DB reads/writes).
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 3 (Revised)
 * "Data Model" / "API Contract" / the `welcome-packets-queries.ts` exact
 * function signatures section, DECISION-090.
 *
 * Pure string/validation logic (extractPacketParts, scopePacketStyles,
 * isValidLionsYear) lives in the sibling src/lib/welcome-packets.ts — this
 * file is exclusively the DB-facing half, matching the Ledger's/minutes'/
 * documents' `*.ts` + `*-queries.ts` split.
 *
 * Two tables, NOT one parent-pointing-at-child pair like `documents`/
 * `documentVersions` — each Lions year is a peer `welcomePackets` row, not a
 * version of one shared document identity. "Current" is a singleton pointer
 * table (`welcomePacketCurrent`, exactly one row, seeded by migration
 * 0090_welcome_packets.sql) rather than a boolean column on `welcomePackets`
 * — a single column can only ever hold one value, so there is no "two rows
 * both claim current" state to even reach (Phase 2 (Revised) §1).
 *
 * Permission gating is the CALLER's responsibility (route handlers / Server
 * Component pages) — nothing in this file checks FEATURES itself, matching
 * every other query module in this codebase.
 *
 * Save-time validation is a HARD FAIL (Phase 3 (Revised) design decision 2):
 * createWelcomePacket()/updateWelcomePacket() validate lionsYear format and
 * require extractPacketParts() to succeed BEFORE writing anything — a save
 * that would later degrade to "No Current Packet Published" for the whole
 * club must fail loudly at save time, with the specific missing-anchor
 * message, not silently succeed. This is stricter than
 * getCurrentWelcomePacket()'s own read-path handling of a parse failure
 * (catch + log + return null), which stays lenient on purpose — a read must
 * degrade gracefully; a write must not create the bad state in the first
 * place.
 */

import { db } from "@/lib/db";
import { welcomePackets, welcomePacketCurrent } from "@/lib/db/schema";
import { extractPacketParts, isValidLionsYear, scopePacketStyles, WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packets";
import { desc, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Shared row/result types
// ---------------------------------------------------------------------------

export interface WelcomePacketListItem {
  id: string;
  lionsYear: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isCurrent: boolean;
}

/** Admin edit view — the one place rawHtml is fetched by id. */
export interface WelcomePacketDetail extends WelcomePacketListItem {
  rawHtml: string;
}

/** The member page's one read — already parsed and CSS-scoped. */
export interface WelcomePacketContent {
  packetId: string;
  lionsYear: string;
  title: string;
  styleHtml: string;
  deckHtml: string;
}

const INVALID_LIONS_YEAR_MESSAGE = 'lionsYear must be in "YYYY-YY" format (e.g. "2027-28").';

export type SaveWelcomePacketResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_lions_year" | "parse_error"; message: string };

export type MarkCurrentResult = { ok: true } | { ok: false; reason: "not_found" };

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Reads the singleton `welcome_packet_current` row's `packetId` — exactly
 * one row exists, seeded by migration 0090_welcome_packets.sql. Returns
 * null both when the pointer itself is null (no packet ever marked current)
 * and, defensively, if the singleton row is somehow missing (should never
 * happen post-migration; treated the same as "nothing is current" rather
 * than throwing, matching this module's overall "showing nothing is safe"
 * posture inherited from the original file-based design).
 */
async function getCurrentPacketId(): Promise<string | null> {
  const [row] = await db.select({ packetId: welcomePacketCurrent.packetId }).from(welcomePacketCurrent).limit(1);
  return row?.packetId ?? null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Admin list view — never includes rawHtml (can be ~375KB per row, thanks to
 * an inline base64 emblem image; the list view never needs the body — Phase
 * 3 (Revised) Edge Cases & Risks). `isCurrent` is computed against the
 * live `welcome_packet_current` pointer, not stored on the row itself, same
 * `isCurrent: r.id === currentId` idiom `documents-queries.ts` already uses
 * for `documents.currentVersionId`.
 */
export async function listWelcomePackets(): Promise<WelcomePacketListItem[]> {
  const currentId = await getCurrentPacketId();

  const rows = await db
    .select({
      id: welcomePackets.id,
      lionsYear: welcomePackets.lionsYear,
      createdByUserId: welcomePackets.createdByUserId,
      updatedByUserId: welcomePackets.updatedByUserId,
      createdAt: welcomePackets.createdAt,
      updatedAt: welcomePackets.updatedAt,
    })
    .from(welcomePackets)
    .orderBy(desc(welcomePackets.updatedAt));

  return rows.map((r) => ({ ...r, isCurrent: r.id === currentId }));
}

/** Admin edit view — the one place rawHtml is fetched by id. Null if the id doesn't resolve. */
export async function getWelcomePacketById(id: string): Promise<WelcomePacketDetail | null> {
  const [row] = await db.select().from(welcomePackets).where(eq(welcomePackets.id, id)).limit(1);
  if (!row) return null;

  const currentId = await getCurrentPacketId();
  return { ...row, isCurrent: row.id === currentId };
}

/**
 * The member page's one read. Resolves the singleton pointer, loads that
 * packet, parses + scopes it. Returns null for BOTH "no packet is current"
 * (packetId is null) AND "the current packet's stored rawHtml fails to
 * parse" (logs console.error with the packet id + lionsYear) — same
 * empty-state UI either way, per the original design's "showing nothing is
 * safe" reasoning, now applied to a DB row instead of a marked file.
 */
export async function getCurrentWelcomePacket(): Promise<WelcomePacketContent | null> {
  const currentId = await getCurrentPacketId();
  if (!currentId) return null; // expected/normal — no packet ever marked current. No log.

  const [row] = await db.select().from(welcomePackets).where(eq(welcomePackets.id, currentId)).limit(1);
  if (!row) {
    // Defensive only — welcome_packet_current.packet_id is ON DELETE SET
    // NULL, so this shouldn't be reachable via any path this feature
    // exposes (no delete verb exists), but a future direct-SQL deletion of
    // a welcomePackets row could still leave a dangling id momentarily.
    console.error(
      `welcome-packets: welcome_packet_current points at packet ${currentId}, which no longer exists — treating as no current packet.`,
    );
    return null;
  }

  let parts;
  try {
    parts = extractPacketParts(row.rawHtml);
  } catch (err) {
    console.error(
      `welcome-packets: current packet ${row.id} (lionsYear=${row.lionsYear}) failed to parse (${(err as Error).message}) — treating as no current packet.`,
    );
    return null;
  }

  return {
    packetId: row.id,
    lionsYear: row.lionsYear,
    title: parts.title,
    styleHtml: scopePacketStyles(parts.styleCss, WELCOME_PACKET_WRAPPER_CLASS),
    deckHtml: parts.deckHtml,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Validates lionsYear format + extractPacketParts(rawHtml) BEFORE inserting
 * (hard-fail — see module header). Returns a discriminated result rather
 * than throwing, so the route handler can turn `ok: false` into a 400 with
 * `message` verbatim.
 */
export async function createWelcomePacket(input: {
  lionsYear: string;
  rawHtml: string;
  createdByUserId: string | null;
}): Promise<SaveWelcomePacketResult> {
  if (!isValidLionsYear(input.lionsYear)) {
    return { ok: false, reason: "invalid_lions_year", message: INVALID_LIONS_YEAR_MESSAGE };
  }

  try {
    extractPacketParts(input.rawHtml);
  } catch (err) {
    return { ok: false, reason: "parse_error", message: `Couldn't save: ${(err as Error).message}.` };
  }

  const [row] = await db
    .insert(welcomePackets)
    .values({
      lionsYear: input.lionsYear,
      rawHtml: input.rawHtml,
      createdByUserId: input.createdByUserId,
      updatedByUserId: input.createdByUserId,
    })
    .returning({ id: welcomePackets.id });

  return { ok: true, id: row.id };
}

/**
 * Same validation as createWelcomePacket, applied to an in-place edit
 * (Phase 3 (Revised) "Edit-in-place vs. fresh-row" — resolved: edit in
 * place, no draft/republish machinery). `ok: false, reason: "not_found"` is
 * NOT part of this function's contract — the route handler checks existence
 * via getWelcomePacketById() first and returns 404 itself before ever
 * calling this.
 */
export async function updateWelcomePacket(
  id: string,
  input: { lionsYear: string; rawHtml: string; updatedByUserId: string | null },
): Promise<SaveWelcomePacketResult> {
  if (!isValidLionsYear(input.lionsYear)) {
    return { ok: false, reason: "invalid_lions_year", message: INVALID_LIONS_YEAR_MESSAGE };
  }

  try {
    extractPacketParts(input.rawHtml);
  } catch (err) {
    return { ok: false, reason: "parse_error", message: `Couldn't save: ${(err as Error).message}.` };
  }

  await db
    .update(welcomePackets)
    .set({
      lionsYear: input.lionsYear,
      rawHtml: input.rawHtml,
      updatedByUserId: input.updatedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(welcomePackets.id, id));

  return { ok: true, id };
}

/**
 * The transactional pointer flip (Phase 2 (Revised) §1 / DECISION-090). Pre-
 * checks the target packet exists (returns not_found rather than letting a
 * bad id surface as a raw FK violation), then updates the ALREADY-SEEDED
 * singleton row (migration 0090 guarantees exactly one row exists — this
 * function does NOT insert one). Both reads and the write happen inside one
 * transaction, so a concurrent "mark current" on two different ids can't
 * interleave into an inconsistent read in between.
 */
export async function markWelcomePacketCurrent(
  packetId: string,
  setByUserId: string | null,
): Promise<MarkCurrentResult> {
  return db.transaction(async (tx) => {
    const [packet] = await tx
      .select({ id: welcomePackets.id })
      .from(welcomePackets)
      .where(eq(welcomePackets.id, packetId))
      .limit(1);
    if (!packet) return { ok: false, reason: "not_found" };

    const [singleton] = await tx.select({ id: welcomePacketCurrent.id }).from(welcomePacketCurrent).limit(1);
    if (!singleton) {
      // Should never happen — migration 0090 seeds exactly one row and
      // nothing in this codebase deletes it. Fail loudly rather than
      // silently no-op-ing a publish action.
      throw new Error("welcome_packet_current has no seeded row — has migration 0090_welcome_packets.sql run?");
    }

    await tx
      .update(welcomePacketCurrent)
      .set({ packetId, setByUserId, setAt: new Date() })
      .where(eq(welcomePacketCurrent.id, singleton.id));

    return { ok: true };
  });
}

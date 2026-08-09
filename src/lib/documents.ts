/**
 * Governance Documents — pure constants, validators, and the diff helper (no
 * DB access). The DB-facing counterpart is `src/lib/documents-queries.ts`.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 3
 * "Diffing" / Data Model. DECISION-076 (architect), DECISION-081.
 *
 * **`diff` (jsdiff) is SERVER-ONLY** (DECISION-076 Ruling 2/4) — the mirror
 * image of `turndown`'s client-only rule
 * (`src/components/admin/minutes/minutes-body-editor.tsx`). This file must
 * only ever be imported from a route handler or a Server Component. It must
 * NEVER be imported from a `"use client"` file — not because `diff` can't
 * run in a browser, but because there's no reason to ship a diffing library
 * to the client when the input (two Markdown version bodies, already on the
 * server) and the output (a serializable list of line-level diff ops) are
 * both cheaper to compute server-side and pass down as plain props.
 */

import { diffLines, type Change } from "diff";

export type { Change };

// ── visibility ───────────────────────────────────────────────────────────
// DECISION-041 pattern: `documents.visibility` is plain text, no DB CHECK.
// Ships 'members' for the by-laws (treasurer, B-38) — the column exists so a
// future public document is a one-row change, not a rewrite.
export const DOCUMENT_VISIBILITIES = ["public", "members"] as const;

export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export function isValidDocumentVisibility(value: string): value is DocumentVisibility {
  return (DOCUMENT_VISIBILITIES as readonly string[]).includes(value);
}

// ── change type ──────────────────────────────────────────────────────────
// DECISION-041 pattern: `document_versions.change_type` is plain text, no DB
// CHECK. 'editorial' flips documents.currentVersionId immediately, in the
// same transaction as the insert. 'substantive' stays pending — inserted
// with adoptedByUserId/adoptedAt/citingMinutesId all NULL — until a separate
// 'adopt' write flips the pointer (documents-queries.ts, DECISION-081).
export const DOCUMENT_CHANGE_TYPES = ["editorial", "substantive"] as const;

export type DocumentChangeType = (typeof DOCUMENT_CHANGE_TYPES)[number];

export function isValidChangeType(value: string): value is DocumentChangeType {
  return (DOCUMENT_CHANGE_TYPES as readonly string[]).includes(value);
}

// ── diff ─────────────────────────────────────────────────────────────────

/**
 * Line-level diff between two raw Markdown version bodies — never rendered
 * HTML, never section-parsed (Phase 1, confirmed; DECISION-076 Ruling 2/4).
 * Thin wrapper over jsdiff's `diffLines()`. `newlineIsToken: false` (the
 * default, stated explicitly here) keeps a trailing-newline-only difference
 * from producing a spurious extra chunk — the named failure mode
 * DECISION-076 Ruling 2 called out as a reason this isn't hand-rolled.
 *
 * Returns jsdiff's own `Change[]` shape (`{ value, added?, removed? }[]`) —
 * already plain and serializable, so a Server Component can pass it straight
 * through to a `DiffView` prop with no re-shaping.
 */
export function diffDocumentVersions(oldMarkdown: string, newMarkdown: string): Change[] {
  return diffLines(oldMarkdown, newMarkdown, { newlineIsToken: false });
}

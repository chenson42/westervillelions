/**
 * Pure grouping logic for the Governance Documents diff view — turns
 * jsdiff's flat `Change[]` (from `diffDocumentVersions()`,
 * `src/lib/documents.ts`) into renderable "blocks" that `DiffView`
 * (`diff-view.tsx`) can lay out as a genuinely readable diff instead of a
 * wall of coloured lines: consecutive unchanged lines collapse into one
 * "context" block (which the view may visually truncate for a long run),
 * and consecutive added/removed lines collapse into one numbered "change"
 * block, so the UI can offer "jump to change N" anchors and a
 * changed-region count.
 *
 * docs/work-log/2026-08-09-governance-document-versioning.md, Phase 4 (UI),
 * "Version history and comparison" — "think about how someone actually
 * reads it (only changed regions? collapsed context? jump links?)."
 *
 * Deliberately NOT importing `diff` (jsdiff) itself — only its `Change`
 * type — so this module carries no runtime dependency on the diffing
 * library and stays trivially safe to import from `diff-view.tsx` (a
 * Server Component). The actual diff computation stays server-only per
 * DECISION-076 Ruling 2/4, upstream of this module.
 */

import type { Change } from "diff";

export interface DiffLineRow {
  type: "context" | "added" | "removed";
  text: string;
}

export type DiffBlock =
  | { kind: "context"; lines: DiffLineRow[] }
  | { kind: "change"; regionNumber: number; lines: DiffLineRow[] };

/**
 * Splits a jsdiff `Change.value` into individual lines. jsdiff's
 * `diffLines()` includes each line's trailing "\n" in `value` (except
 * possibly the final line of the whole document, if the source text has no
 * trailing newline) — a naive `value.split("\n")` would therefore produce
 * one spurious empty-string "line" at the end whenever `value` ends with a
 * newline. Guarding against that here keeps `buildDiffBlocks()` from
 * rendering a phantom blank row at the end of a chunk.
 */
function splitLines(value: string): string[] {
  if (value === "") return [];
  const endsWithNewline = value.endsWith("\n");
  const parts = value.split("\n");
  if (endsWithNewline) parts.pop();
  return parts;
}

/**
 * Groups a flat `Change[]` into blocks. Every `Change` entry becomes zero
 * or more line rows (tagged context/added/removed); consecutive rows of the
 * same broad category (context vs. changed) merge into one block. Changed
 * blocks are numbered in document order starting at 1 — that number is the
 * anchor id (`#diff-change-N`) `DiffView` renders jump links against.
 */
export function buildDiffBlocks(diff: Change[]): DiffBlock[] {
  const rows: DiffLineRow[] = [];
  for (const change of diff) {
    const type: DiffLineRow["type"] = change.added ? "added" : change.removed ? "removed" : "context";
    for (const text of splitLines(change.value)) {
      rows.push({ type, text });
    }
  }

  const blocks: DiffBlock[] = [];
  let regionCounter = 0;
  let i = 0;
  while (i < rows.length) {
    const isContext = rows[i].type === "context";
    const lines: DiffLineRow[] = [];
    while (i < rows.length && (rows[i].type === "context") === isContext) {
      lines.push(rows[i]);
      i++;
    }
    if (isContext) {
      blocks.push({ kind: "context", lines });
    } else {
      regionCounter++;
      blocks.push({ kind: "change", regionNumber: regionCounter, lines });
    }
  }
  return blocks;
}

/** Number of distinct changed regions — 0 means the two versions are
 *  textually identical (DiffView's empty state). */
export function countChangeRegions(blocks: DiffBlock[]): number {
  return blocks.filter((b) => b.kind === "change").length;
}

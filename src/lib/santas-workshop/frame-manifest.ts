/**
 * Pure frame-manifest logic (Slice 4): who gets a frame, in what order numbers are
 * handed out, and how the manifest is assembled from rows. No database access here;
 * frame-export.ts feeds it.
 *
 * Rules (Phase 3 rulings 8 and 11):
 *   - A stuffy gets a frame when it has a CURRENT portrait that is not hidden. Consent is
 *     irrelevant (every family gets a frame).
 *   - A hidden current portrait is withheld ("hidden") and a stuffy with no portrait is
 *     listed ("no_portrait"); neither is given a number until it has an exportable portrait.
 *   - Numbers are persisted and never reassigned. A batch is numbered alphabetically (parent
 *     last name, stuffy name, id) starting after the highest number in the session, so a late
 *     portrait gets max + 1.
 *   - "Since last export" compares the current portrait id with `frame_exported_photo_id`.
 */

import type {
  FrameExportStatus,
  FrameItem,
  FrameManifestCounts,
  FrameWithheld,
} from "./admin-contract";
import { collagePhotoPath } from "./collage-contract";
import { cleanPrintName, frameFileName } from "./frame-names";

export interface FrameStuffyRow {
  stuffyId: string;
  name: string | null;
  parentFirst: string | null;
  parentLast: string | null;
  windowLabel: string | null;
  consent: boolean;
  frameNumber: number | null;
  exportedPhotoId: string | null;
  /** The current (not superseded, not purged) portrait, or null. */
  portrait: { id: string; hidden: boolean } | null;
}

export const hasExportablePortrait = (r: FrameStuffyRow): boolean => r.portrait !== null && !r.portrait.hidden;

const key = (s: string | null) => (s ?? "").trim().toLowerCase();

/** Alphabetical allocation order: parent last name, stuffy name, id. */
export function compareForAllocation(a: FrameStuffyRow, b: FrameStuffyRow): number {
  for (const [x, y] of [
    [key(a.parentLast), key(b.parentLast)],
    [key(a.name), key(b.name)],
    [a.stuffyId, b.stuffyId],
  ] as const) {
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * The numbers to hand out now: exportable stuffies without a number, alphabetically, from
 * `max + 1`. Existing numbers are never touched. `existingMax` is the highest number in the session (0 if none).
 */
export function planFrameNumbers(rows: FrameStuffyRow[], existingMax: number): { stuffyId: string; frameNumber: number }[] {
  const todo = rows.filter((r) => r.frameNumber === null && hasExportablePortrait(r)).sort(compareForAllocation);
  return todo.map((r, i) => ({ stuffyId: r.stuffyId, frameNumber: existingMax + 1 + i }));
}

export function exportStatusOf(portraitId: string, exportedPhotoId: string | null): FrameExportStatus {
  if (exportedPhotoId === null) return "never";
  return exportedPhotoId === portraitId ? "current" : "changed";
}

export interface BuiltFrameEntries {
  items: FrameItem[];
  withheld: FrameWithheld[];
  counts: FrameManifestCounts;
}

/** Rows (already numbered) into items, withheld entries and counts. Items are in frame-number order. */
export function buildFrameEntries(rows: FrameStuffyRow[], filePrefix: string): BuiltFrameEntries {
  const base = (r: FrameStuffyRow) => ({
    stuffyId: r.stuffyId,
    name: cleanPrintName(r.name),
    parentFirst: (r.parentFirst ?? "").trim(),
    parentLast: (r.parentLast ?? "").trim(),
    windowLabel: r.windowLabel ?? "",
    consent: r.consent,
  });
  const items: FrameItem[] = [];
  const withheld: FrameWithheld[] = [];
  for (const r of rows) {
    if (r.portrait && !r.portrait.hidden && r.frameNumber !== null) {
      items.push({
        ...base(r),
        frameNumber: r.frameNumber,
        fileName: frameFileName(filePrefix, r.frameNumber),
        portraitPhotoId: r.portrait.id,
        photoUrl: collagePhotoPath(r.portrait.id, "full"),
        exportedPhotoId: r.exportedPhotoId,
        exportStatus: exportStatusOf(r.portrait.id, r.exportedPhotoId),
      });
    } else if (r.portrait?.hidden) {
      withheld.push({ ...base(r), frameNumber: r.frameNumber, fileName: r.frameNumber === null ? null : frameFileName(filePrefix, r.frameNumber), reason: "hidden" });
    } else if (!r.portrait) {
      withheld.push({ ...base(r), frameNumber: r.frameNumber, fileName: r.frameNumber === null ? null : frameFileName(filePrefix, r.frameNumber), reason: "no_portrait" });
    }
    // An exportable portrait without a number cannot happen after allocation; it is simply not listed.
  }
  items.sort((a, b) => a.frameNumber - b.frameNumber);
  withheld.sort((a, b) => (a.parentLast.toLowerCase() < b.parentLast.toLowerCase() ? -1 : a.parentLast.toLowerCase() > b.parentLast.toLowerCase() ? 1 : a.stuffyId < b.stuffyId ? -1 : 1));

  const neverExported = items.filter((i) => i.exportStatus === "never").length;
  const changedSinceExport = items.filter((i) => i.exportStatus === "changed").length;
  return {
    items,
    withheld,
    counts: {
      total: rows.length,
      withPortrait: items.length,
      withoutPortrait: withheld.filter((w) => w.reason === "no_portrait").length,
      hidden: withheld.filter((w) => w.reason === "hidden").length,
      neverExported,
      changedSinceExport,
      sinceLastExport: neverExported + changedSinceExport,
    },
  };
}

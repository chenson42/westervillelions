/**
 * The combined index CSV (Slice 4): a separate admin-only download, NEVER inside a zip (the zips go to a photo counter and the index holds parent names, windows and consent). Browser-built
 * from the manifest and the outcome of this run. Every free-text cell goes through `csvCellSafe`
 * (formula-injection guard and quoting). Pure and client-safe.
 *
 * `produced` is `yes` or `no`; a `no` always carries a plain-language reason, so a zip can never look
 * complete when it is not.
 */

import { csvCellSafe } from "@/lib/csv-safe";

export interface IndexRow {
  frameNumber: number | null;
  fileName: string | null;
  stuffyName: string;
  parentLast: string;
  parentFirst: string;
  windowLabel: string;
  consent: boolean;
  produced: boolean;
  /** Required when produced is false; "" when it is true. */
  reason: string;
}

export const INDEX_CSV_HEADER = ["frame_number", "file_name", "stuffy_name", "parent_last", "parent_first", "window", "produced", "reason", "photo_consent"] as const;

const key = (s: string) => s.trim().toLowerCase();

/** Pickup-table order: parent last name, then stuffy name, then frame number. */
export function sortIndexRows(rows: IndexRow[]): IndexRow[] {
  return [...rows].sort((a, b) => {
    for (const [x, y] of [
      [key(a.parentLast), key(b.parentLast)],
      [key(a.stuffyName), key(b.stuffyName)],
    ] as const) {
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return (a.frameNumber ?? Number.MAX_SAFE_INTEGER) - (b.frameNumber ?? Number.MAX_SAFE_INTEGER);
  });
}

export function buildIndexCsv(rows: IndexRow[]): string {
  const lines = [INDEX_CSV_HEADER.join(",")];
  for (const r of sortIndexRows(rows)) {
    lines.push(
      [
        csvCellSafe(r.frameNumber),
        csvCellSafe(r.fileName),
        csvCellSafe(r.stuffyName),
        csvCellSafe(r.parentLast),
        csvCellSafe(r.parentFirst),
        csvCellSafe(r.windowLabel),
        r.produced ? "yes" : "no",
        csvCellSafe(r.produced ? "" : r.reason || "not produced"),
        r.consent ? "yes" : "no",
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

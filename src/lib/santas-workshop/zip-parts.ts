/**
 * Splits the frames into zip parts and builds each part (Slice 4). Pure and client-safe; `fflate`
 * is imported dynamically by the browser code that calls `buildZip`, never at module load, so the
 * library stays out of every other bundle.
 *
 * JPEGs do not compress, so entries are stored (level 0): fast, and a part's size is its content.
 */

import type { Zippable } from "fflate";

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

/** Index ranges for the parts: 250 items at 100 per part gives [0,100) [100,200) [200,250). Empty input gives none. */
export function planParts(count: number, partSize: number): { start: number; end: number }[] {
  const size = Math.max(1, Math.trunc(partSize) || 1);
  const out: { start: number; end: number }[] = [];
  for (let start = 0; start < count; start += size) out.push({ start, end: Math.min(count, start + size) });
  return out;
}

/** Throws when two entries would collide in the archive (a bug, never a user error). */
export function assertUniqueNames(files: ZipFile[]): void {
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.name)) throw new Error(`Duplicate file name in zip: ${f.name}`);
    seen.add(f.name);
  }
}

/** One zip, every entry stored. `zipSync` is passed in so tests and the browser share this function. */
export function buildZip(files: ZipFile[], zipSync: (data: Zippable, opts?: { level?: 0 }) => Uint8Array): Uint8Array {
  assertUniqueNames(files);
  const data: Zippable = {};
  for (const f of files) data[f.name] = f.data;
  return zipSync(data, { level: 0 });
}

export interface PartOutcome<T> {
  produced: T[];
  failed: { item: T; reason: string }[];
}

/**
 * A part is ready to offer only when every frame in it either produced or is listed as failed.
 * `settled` is how many of the part's items have an outcome.
 */
export function partIsSettled(partItemCount: number, produced: number, failed: number): boolean {
  return produced + failed === partItemCount;
}

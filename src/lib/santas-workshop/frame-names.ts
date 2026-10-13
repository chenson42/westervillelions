/**
 * File names and printed names for frames (Slice 4). Pure and client-safe.
 *
 * File names are `ssw-<slug>-NNN.jpg` (or `<prefix>-NNN.jpg`): ASCII `[a-z0-9-]`, a
 * zero-padded frame number, never a person's name. The printed name is the stuffy's
 * name made safe to draw with canvas `fillText`.
 */

const MAX_PREFIX = 40;
const MAX_PRINT_NAME = 60;

/** Lowercase `[a-z0-9-]`, dashes collapsed and trimmed, capped. Null when nothing usable is left. */
export function sanitizeFilePrefix(raw: string | null | undefined): string | null {
  const s = (raw ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_PREFIX)
    .replace(/-+$/g, "");
  return s || null;
}

/** The session's custom prefix when it survives sanitising, else `ssw-<slug>`. */
export function framePrefix(slug: string, customPrefix: string | null | undefined): string {
  return sanitizeFilePrefix(customPrefix) ?? `ssw-${sanitizeFilePrefix(slug) ?? "session"}`;
}

export function frameFileName(prefix: string, frameNumber: number): string {
  return `${prefix}-${String(Math.max(0, Math.trunc(frameNumber))).padStart(3, "0")}.jpg`;
}

/** `suffix` distinguishes a partial export ("-new") from the full one so both can sit in one folder. */
/**
 * The file a frame is saved under. The first export uses `<prefix>-NNN.jpg`; once a frame has been exported before
 * (`exportedPhotoId` set) the portrait's short id is appended, so a retaken frame never reuses a name a photo
 * counter may already hold. The id is stable, so exporting the same portrait again gives the same name.
 */
export function frameImageFileName(item: { fileName: string; portraitPhotoId: string; exportedPhotoId: string | null }): string {
  if (item.exportedPhotoId === null) return item.fileName;
  const short = item.portraitPhotoId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 6);
  return short ? item.fileName.replace(/\.jpg$/, `-${short}.jpg`) : item.fileName;
}

export function framePartFileName(prefix: string, part: number, parts: number, suffix = ""): string {
  return `${prefix}-frames-part-${part}-of-${parts}${suffix}.zip`;
}

// Control characters, bidi embeddings/overrides/isolates and marks, zero-width characters, BOM.
const UNSAFE_PRINT_CHARS = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** The stuffy's name as it prints on a frame; "Stuffy" when nothing printable is left. */
export function cleanPrintName(raw: string | null | undefined): string {
  const collapsed = (raw ?? "").replace(UNSAFE_PRINT_CHARS, " ").replace(/\s+/g, " ").trim();
  const capped = Array.from(collapsed).slice(0, MAX_PRINT_NAME).join("").trim();
  return capped || "Stuffy";
}

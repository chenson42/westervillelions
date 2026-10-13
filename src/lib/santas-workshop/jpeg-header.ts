/**
 * Header-only JPEG inspection for the upload validator. Never decodes pixels:
 * it checks the SOI marker, walks the marker segments to the first SOF0/SOF1/SOF2
 * frame header (baseline, extended, progressive), reads width and height, and
 * requires the EOI marker at the end so a truncated upload is refused.
 * Pure and client-safe.
 */

export type JpegHeader =
  | { ok: true; width: number; height: number; progressive: boolean }
  | { ok: false; reason: "empty" | "not_jpeg" | "truncated" | "no_frame" };

const SOF_BASELINE = 0xc0;
const SOF_EXTENDED = 0xc1;
const SOF_PROGRESSIVE = 0xc2;

export function parseJpegHeader(bytes: Uint8Array): JpegHeader {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, reason: "not_jpeg" };
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return { ok: false, reason: "truncated" };
  }

  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return { ok: false, reason: "not_jpeg" };
    // Skip fill bytes.
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    const marker = bytes[i];
    i += 1;
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) return { ok: false, reason: "no_frame" };
    if (i + 1 >= bytes.length) return { ok: false, reason: "truncated" };
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) return { ok: false, reason: "not_jpeg" };
    if (marker === SOF_BASELINE || marker === SOF_EXTENDED || marker === SOF_PROGRESSIVE) {
      if (i + 6 >= bytes.length) return { ok: false, reason: "truncated" };
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      if (width === 0 || height === 0) return { ok: false, reason: "no_frame" };
      return { ok: true, width, height, progressive: marker === SOF_PROGRESSIVE };
    }
    i += length;
  }
  return { ok: false, reason: "no_frame" };
}

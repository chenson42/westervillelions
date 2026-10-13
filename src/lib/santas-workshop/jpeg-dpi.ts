/**
 * Writes a 300 x 300 dpi density into a JPEG (Slice 4). A canvas JPEG leaves the density unset
 * (or 1:1 with no units), and a photo counter that trusts it prints at the wrong size. Pure and
 * client-safe; only the density bytes change, never the entropy-coded image data.
 */

export const FRAME_DPI = 300;

const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasJfifAt2(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || bytes[2] !== 0xff || bytes[3] !== 0xe0) return false;
  return JFIF_ID.every((b, i) => bytes[6 + i] === b);
}

/** Returns a copy with the JFIF density set to `dpi` x `dpi` (units = dots per inch). Throws on a non-JPEG. */
export function setJpegDensity(bytes: Uint8Array, dpi: number = FRAME_DPI): Uint8Array {
  if (!isJpeg(bytes)) throw new Error("Not a JPEG");
  const hi = (dpi >> 8) & 0xff;
  const lo = dpi & 0xff;
  if (hasJfifAt2(bytes)) {
    const out = bytes.slice();
    out[13] = 1; // units: dots per inch
    out[14] = hi;
    out[15] = lo;
    out[16] = hi;
    out[17] = lo;
    return out;
  }
  // No JFIF segment first: insert a standard 18-byte APP0 right after SOI.
  const app0 = Uint8Array.from([0xff, 0xe0, 0x00, 0x10, ...JFIF_ID, 0x01, 0x01, 0x01, hi, lo, hi, lo, 0x00, 0x00]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** Reads the first JFIF density, or null when there is none. Used by tests and the export self-check. */
export function readJpegDensity(bytes: Uint8Array): { units: number; x: number; y: number } | null {
  if (!isJpeg(bytes) || !hasJfifAt2(bytes)) return null;
  return { units: bytes[13], x: (bytes[14] << 8) | bytes[15], y: (bytes[16] << 8) | bytes[17] };
}

/**
 * Server-side validation of an uploaded photo part (Phase 3, "Photo limits").
 * The server NEVER decodes pixels: it checks the size cap, the JPEG header
 * (jpeg-header.ts), the pixel cap, the per-kind long-edge limit, and that the
 * header dimensions equal what the client claimed. Every number comes from
 * photo-limits.ts, the same module the browser downscaler imports.
 * Pure (no db, no storage): the multipart reader below only touches Request.
 */

import { parseJpegHeader } from "./jpeg-header";
import { MAX_PHOTO_PIXELS, MAX_UPLOAD_BODY_BYTES, PHOTO_LIMITS, type PhotoKind } from "./photo-limits";

export type PartVariant = "full" | "thumb";

export type PartVerdict =
  | { ok: true; width: number; height: number; byteSize: number }
  | { ok: false; code: "too_large" | "not_jpeg" | "invalid_input"; error: string };

export function validatePhotoPart(input: {
  kind: PhotoKind;
  variant: PartVariant;
  bytes: Uint8Array;
  claimedWidth: number;
  claimedHeight: number;
}): PartVerdict {
  const { kind, variant, bytes } = input;
  const limit = PHOTO_LIMITS[kind];
  const part = variant === "full" ? limit : limit.thumb;
  if (!part) return { ok: false, code: "invalid_input", error: `A ${kind} photo has no ${variant} part` };

  if (bytes.byteLength === 0) return { ok: false, code: "not_jpeg", error: "The photo is empty" };
  if (bytes.byteLength > part.maxBytes) return { ok: false, code: "too_large", error: "The photo is too large" };

  const header = parseJpegHeader(bytes);
  if (!header.ok) return { ok: false, code: "not_jpeg", error: "The photo is not a complete JPEG" };

  if (header.width * header.height > MAX_PHOTO_PIXELS) return { ok: false, code: "too_large", error: "The photo has too many pixels" };
  if (Math.max(header.width, header.height) > part.maxLongEdge) return { ok: false, code: "too_large", error: "The photo is too large" };
  if (header.width !== input.claimedWidth || header.height !== input.claimedHeight) {
    return { ok: false, code: "invalid_input", error: "The photo size does not match what was sent" };
  }
  return { ok: true, width: header.width, height: header.height, byteSize: bytes.byteLength };
}

/** The combined multipart body may not exceed MAX_UPLOAD_BODY_BYTES. */
export function bodyTooLarge(contentLengthHeader: string | null): boolean {
  if (contentLengthHeader === null) return false; // re-checked on the parts after parsing
  const n = Number(contentLengthHeader);
  return Number.isFinite(n) && n > MAX_UPLOAD_BODY_BYTES;
}

export interface UploadParts {
  meta: unknown;
  full: Uint8Array | null;
  thumb: Uint8Array | null;
}

export type ReadUpload = { ok: true; parts: UploadParts } | { ok: false; code: "too_large" | "invalid_input"; error: string };

/** Reads `meta` (JSON string), `full` and `thumb` (files). Refuses an over-size body before and after parsing. */
export async function readUploadParts(request: Request): Promise<ReadUpload> {
  if (bodyTooLarge(request.headers.get("content-length"))) return { ok: false, code: "too_large", error: "The upload is too large" };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, code: "invalid_input", error: "The upload could not be read" };
  }
  const metaRaw = form.get("meta");
  let meta: unknown = null;
  if (typeof metaRaw === "string") {
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      return { ok: false, code: "invalid_input", error: "The upload details are not valid JSON" };
    }
  }
  const read = async (name: string): Promise<Uint8Array | null> => {
    const value = form.get(name);
    if (!value || typeof value === "string") return null;
    return new Uint8Array(await (value as Blob).arrayBuffer());
  };
  const full = await read("full");
  const thumb = await read("thumb");
  const total = (full?.byteLength ?? 0) + (thumb?.byteLength ?? 0) + (typeof metaRaw === "string" ? metaRaw.length : 0);
  if (total > MAX_UPLOAD_BODY_BYTES) return { ok: false, code: "too_large", error: "The upload is too large" };
  return { ok: true, parts: { meta, full, thumb } };
}

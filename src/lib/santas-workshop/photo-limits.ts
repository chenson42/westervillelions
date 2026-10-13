/**
 * ONE definition of photo kinds, dimensions, byte caps and the quality ladder.
 * Client-safe (no db, no node:): the browser downscaler (ux-developer) and the
 * server validator (photo-upload.ts) both import these numbers, so there is no
 * duplicated limit to drift. The server never decodes pixels; it checks the
 * JPEG header (jpeg-header.ts) against these.
 */

export const PHOTO_KINDS = ["check_in", "portrait", "group"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export function isPhotoKind(value: unknown): value is PhotoKind {
  return typeof value === "string" && (PHOTO_KINDS as readonly string[]).includes(value);
}

export interface ThumbLimit {
  /** Longest edge allowed, in pixels. */
  maxLongEdge: number;
  maxBytes: number;
}

export interface KindLimit {
  maxLongEdge: number;
  maxBytes: number;
  /** null: this kind carries no thumbnail part. */
  thumb: ThumbLimit | null;
}

const KB = 1024;
const MB = 1024 * 1024;

const THUMB: ThumbLimit = { maxLongEdge: 480, maxBytes: 100 * KB };

export const PHOTO_LIMITS: Record<PhotoKind, KindLimit> = {
  check_in: { maxLongEdge: 1280, maxBytes: 500 * KB, thumb: null },
  portrait: { maxLongEdge: 2400, maxBytes: Math.floor(1.5 * MB), thumb: THUMB },
  group: { maxLongEdge: 1920, maxBytes: 1 * MB, thumb: THUMB },
};

/** The whole multipart body (full + thumb + meta) may not exceed this. */
export const MAX_UPLOAD_BODY_BYTES = 2 * MB;

/** A header claiming more pixels than this is refused before anything else. */
export const MAX_PHOTO_PIXELS = 6_000_000;

/** JPEG quality ladder the browser walks down until the file fits its byte cap (never below the last rung). */
export const QUALITY_LADDER = [0.82, 0.74, 0.66, 0.58, 0.5] as const;

/** After the ladder bottoms out the long edge shrinks by this factor and the ladder restarts. */
export const DIMENSION_STEP = 0.85;

/** More than this many photo rows from one device inside the window is `rate_limited`. */
export const DEVICE_UPLOADS_PER_WINDOW = 12;
export const DEVICE_UPLOAD_WINDOW_SECONDS = 60;

/** Per-session soft storage ceilings are in sw_sessions.storage_quota_bytes (session-input DEFAULT_QUOTA_BYTES). */

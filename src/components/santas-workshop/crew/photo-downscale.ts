/**
 * Photo downscaling, PURE planning half. The byte caps, the long-edge limits, the
 * quality ladder and the dimension step all come from photo-limits.ts (the same
 * module the server validates against), never copied here. Never upscales.
 * Re-encoding through a canvas strips EXIF and GPS and bakes the orientation in
 * (photo-downscale-browser.ts does the drawing).
 */

import { computeResizeDimensions } from "@/lib/image-resize";
import { DIMENSION_STEP, PHOTO_LIMITS, QUALITY_LADDER, type PhotoKind } from "@/lib/santas-workshop/photo-limits";

export const MIN_LONG_EDGE = 320;
export const MAX_ENCODE_ATTEMPTS = 24;

/** Output size for a source: long edge at most `maxLongEdge`, aspect kept, never larger than the source. */
export function targetDimensions(width: number, height: number, maxLongEdge: number): { width: number; height: number } {
  return computeResizeDimensions(width, height, maxLongEdge);
}

export interface EncodeState {
  longEdge: number;
  /** Index into QUALITY_LADDER. */
  rung: number;
  attempts: number;
}

export function startEncode(longEdge: number): EncodeState {
  return { longEdge, rung: 0, attempts: 0 };
}

export function qualityFor(state: EncodeState): number {
  return QUALITY_LADDER[Math.min(state.rung, QUALITY_LADDER.length - 1)];
}

export type EncodeStep = { kind: "fits" } | { kind: "retry"; next: EncodeState } | { kind: "give_up" };

/**
 * After encoding at `state` produced `bytes`: done if it fits, else the next rung of the
 * quality ladder, and when the ladder bottoms out shrink the long edge by DIMENSION_STEP and
 * restart the ladder. Gives up (never loops forever) below MIN_LONG_EDGE or after a fixed number of tries.
 */
export function nextEncodeStep(state: EncodeState, bytes: number, maxBytes: number): EncodeStep {
  if (bytes <= maxBytes) return { kind: "fits" };
  const attempts = state.attempts + 1;
  if (attempts >= MAX_ENCODE_ATTEMPTS) return { kind: "give_up" };
  if (state.rung + 1 < QUALITY_LADDER.length) return { kind: "retry", next: { longEdge: state.longEdge, rung: state.rung + 1, attempts } };
  const longEdge = Math.floor(state.longEdge * DIMENSION_STEP);
  if (longEdge < MIN_LONG_EDGE) return { kind: "give_up" };
  return { kind: "retry", next: { longEdge, rung: 0, attempts } };
}

export interface KindPlan {
  full: { maxLongEdge: number; maxBytes: number };
  thumb: { maxLongEdge: number; maxBytes: number } | null;
}

export function planFor(kind: PhotoKind): KindPlan {
  const limit = PHOTO_LIMITS[kind];
  return {
    full: { maxLongEdge: limit.maxLongEdge, maxBytes: limit.maxBytes },
    thumb: limit.thumb ? { maxLongEdge: limit.thumb.maxLongEdge, maxBytes: limit.thumb.maxBytes } : null,
  };
}

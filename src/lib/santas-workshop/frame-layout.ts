/**
 * Pure geometry for the 4x6 portrait frame (Slice 4, DECISION-124). No canvas here: the
 * drawing code reads these rectangles, so the arithmetic is unit-tested and every visual in
 * the composite is deterministic. Client-safe.
 *
 * Canvas: 1200 x 1800 (4x6 in at 300 dpi). Content stays inside a 75 px (0.25 in) safe margin.
 * Top to bottom: title band, photo window, name band, QR block (plate on the left, caption on the right).
 * The optional chair-supplied overlay (`frame-art.png`) is drawn over the photo window edge,
 * so the window below is the transparent hole it must leave.
 */

import { FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from "./admin-contract";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SAFE_MARGIN = 75;
export const QUIET_MODULES = 4;
export const MIN_MODULE_PX = 7;
/** The plate is sized to hold the QR plus its quiet zone at about this many pixels, then rounded down to whole modules. */
export const QR_TARGET_PX = 360;

export const CAPTION_LINES = ["Scan to see the whole day's photos", "westervillelions.org"] as const;
export const CAPTION = CAPTION_LINES.join(" · ");
export const FRAME_TITLE = "A Visit to Santa's Workshop";

const TITLE: Rect = { x: SAFE_MARGIN, y: SAFE_MARGIN, w: FRAME_WIDTH_PX - 2 * SAFE_MARGIN, h: 130 };
/** The portrait window (and the hole `frame-art.png` must leave transparent). */
export const PHOTO_WINDOW: Rect = { x: SAFE_MARGIN, y: 225, w: FRAME_WIDTH_PX - 2 * SAFE_MARGIN, h: 990 };
const NAME: Rect = { x: SAFE_MARGIN, y: 1235, w: FRAME_WIDTH_PX - 2 * SAFE_MARGIN, h: 100 };
const QR_TOP = 1365;
const PRACTICE_BAND_H = 90;
/** The small "No. 002" tag at the bottom right of the QR block (the bottom left is the QR plate). */
const NUMBER_H = 56;
export const NUMBER_PX = 34;

/** "No. 002": the frame number as printed, so two stuffies with one name are told apart on paper. */
export function frameNumberLabel(frameNumber: number): string {
  return `No. ${String(Math.max(0, Math.trunc(frameNumber))).padStart(3, "0")}`;
}

export interface FrameLayout {
  width: number;
  height: number;
  safeMargin: number;
  title: Rect;
  photo: Rect;
  /** Present for practice sessions only; lies on the bottom of the photo window. */
  practiceBand: Rect | null;
  name: Rect;
  /** Font sizes the name may take, largest first to the floor. */
  nameMaxPx: number;
  nameMinPx: number;
  /** Baseline of the name text (alphabetic), inside `name`. */
  nameBaselineY: number;
  qrPlate: Rect;
  qrModules: number;
  qrModulePx: number;
  /** Top-left of the first module (plate origin plus the quiet zone). */
  qrOrigin: { x: number; y: number };
  caption: Rect;
  /** Right-aligned text inside this rect; its baseline is `numberBaselineY`. */
  number: Rect;
  numberBaselineY: number;
  captionMaxPx: number;
  captionMinPx: number;
}

/**
 * `qrModules` is the QR's matrix size (version 1 = 21). The module size is a whole number of
 * pixels, never below 7, and the plate holds a 4-module quiet zone on every side.
 */
export function computeFrameLayout(opts: { qrModules: number; practice?: boolean }): FrameLayout {
  const n = Math.trunc(opts.qrModules);
  if (!Number.isFinite(n) || n < 21 || n > 177) throw new Error("Unexpected QR size");
  const total = n + 2 * QUIET_MODULES;
  const qrModulePx = Math.max(MIN_MODULE_PX, Math.floor(QR_TARGET_PX / total));
  const plateSize = total * qrModulePx;
  // The block ends at the bottom safe margin; a denser QR (a much longer link) cannot fit at 7 px per module.
  if (QR_TOP + plateSize > FRAME_HEIGHT_PX - SAFE_MARGIN) throw new Error("The collage link is too long to print as a QR code on a frame");
  const qrPlate: Rect = { x: SAFE_MARGIN, y: QR_TOP, w: plateSize, h: plateSize };
  const captionX = qrPlate.x + plateSize + 40;
  const captionW = FRAME_WIDTH_PX - SAFE_MARGIN - captionX;
  const caption: Rect = { x: captionX, y: QR_TOP, w: captionW, h: plateSize - NUMBER_H };
  const number: Rect = { x: captionX, y: QR_TOP + plateSize - NUMBER_H, w: captionW, h: NUMBER_H };
  const photo = PHOTO_WINDOW;
  return {
    width: FRAME_WIDTH_PX,
    height: FRAME_HEIGHT_PX,
    safeMargin: SAFE_MARGIN,
    title: TITLE,
    photo,
    practiceBand: opts.practice ? { x: photo.x, y: photo.y + photo.h - PRACTICE_BAND_H, w: photo.w, h: PRACTICE_BAND_H } : null,
    name: NAME,
    nameMaxPx: 84,
    nameMinPx: 44,
    nameBaselineY: NAME.y + 78,
    qrPlate,
    qrModules: n,
    qrModulePx,
    qrOrigin: { x: qrPlate.x + QUIET_MODULES * qrModulePx, y: qrPlate.y + QUIET_MODULES * qrModulePx },
    caption,
    number,
    numberBaselineY: number.y + 42,
    captionMaxPx: 40,
    captionMinPx: 24,
  };
}

/** Every rectangle that must sit inside the safe margin, for the layout test and the drawing code alike. */
export function layoutRects(l: FrameLayout): Record<string, Rect> {
  return { title: l.title, photo: l.photo, name: l.name, qrPlate: l.qrPlate, caption: l.caption, number: l.number };
}

/**
 * Cover-crop: the source rectangle to read so the whole destination is filled, centred, with no stretching.
 * Returns a rectangle in source pixels.
 */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) throw new Error("Sizes must be positive");
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;
  if (srcRatio > dstRatio) {
    const w = srcH * dstRatio;
    return { x: (srcW - w) / 2, y: 0, w, h: srcH };
  }
  const h = srcW / dstRatio;
  return { x: 0, y: (srcH - h) / 2, w: srcW, h };
}

export interface FittedText {
  text: string;
  px: number;
  truncated: boolean;
}

/**
 * Fits one line of text into `maxWidth`: shrinks from `maxPx` toward `minPx` in 2 px steps, and only then
 * truncates with an ellipsis (by code point, so an emoji is never split). `measure(text, px)` is the canvas
 * `measureText` width in the drawing code and a fake in tests.
 */
export function fitText(text: string, maxWidth: number, maxPx: number, minPx: number, measure: (text: string, px: number) => number): FittedText {
  for (let px = maxPx; px >= minPx; px -= 2) {
    if (measure(text, px) <= maxWidth) return { text, px, truncated: false };
  }
  const chars = Array.from(text);
  for (let len = chars.length - 1; len > 0; len -= 1) {
    const cut = `${chars.slice(0, len).join("").trimEnd()}…`;
    if (measure(cut, minPx) <= maxWidth) return { text: cut, px: minPx, truncated: true };
  }
  return { text: "…", px: minPx, truncated: true };
}

/** Accepts the optional overlay only at the exact frame size. */
export function frameArtSizeOk(width: number, height: number): boolean {
  return width === FRAME_WIDTH_PX && height === FRAME_HEIGHT_PX;
}

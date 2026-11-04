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

/** Festive decoration (drawn frame only). Pure geometry so a test can prove none of it touches the photo or the QR. */
export const CANDY_BORDER_PX = 32;
/** Width of the red string-of-lights ring that hugs the photo window on the outside. */
export const PHOTO_RING_PX = 18;
/** Gold halo around the white QR plate, drawn outside the plate (the plate and its quiet zone stay pure white). */
export const PLATE_HALO_PX = 6;
/** The title text is held to this width (centred) so the corner holly never meets it. */
export const TITLE_TEXT_MAX_W = 840;
const HOLLY_SIZE = 130;
const HOLLY_INSET = 40;

export interface Snowflake {
  x: number;
  y: number;
  r: number;
}

export interface Decor {
  /** Outer edge of the red lights ring around the photo window (the ring itself lies between this and the window). */
  photoRing: Rect;
  plateHalo: Rect;
  /** Holly clusters at the top corners; each is a cluster centre and the box it may paint in. */
  holly: { cx: number; cy: number; flip: boolean; box: Rect }[];
  /** Bulb centres along the ring's centre line. */
  lights: { x: number; y: number }[];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function computeDecor(l: FrameLayout): Decor {
  const ring = grow(l.photo, PHOTO_RING_PX);
  const lights: { x: number; y: number }[] = [];
  const half = PHOTO_RING_PX / 2;
  const step = 55;
  const left = l.photo.x - half;
  const right = l.photo.x + l.photo.w + half;
  const top = l.photo.y - half;
  const bottom = l.photo.y + l.photo.h + half;
  for (let x = left + 20; x <= right - 20; x += step) {
    lights.push({ x, y: top }, { x, y: bottom });
  }
  for (let y = top + step; y <= bottom - step + 1; y += step) {
    lights.push({ x: left, y }, { x: right, y });
  }
  const hollyBox = (x: number): Rect => ({ x, y: HOLLY_INSET, w: HOLLY_SIZE, h: HOLLY_SIZE });
  return {
    photoRing: ring,
    plateHalo: grow(l.qrPlate, PLATE_HALO_PX),
    holly: [
      { cx: HOLLY_INSET + HOLLY_SIZE / 2 - 6, cy: HOLLY_INSET + HOLLY_SIZE / 2 - 6, flip: false, box: hollyBox(HOLLY_INSET) },
      { cx: l.width - (HOLLY_INSET + HOLLY_SIZE / 2 - 6), cy: HOLLY_INSET + HOLLY_SIZE / 2 - 6, flip: true, box: hollyBox(l.width - HOLLY_INSET - HOLLY_SIZE) },
    ],
    lights,
  };
}

/** The centred box the title lines may occupy. */
export function titleTextBox(l: FrameLayout): Rect {
  return { x: l.title.x + (l.title.w - TITLE_TEXT_MAX_W) / 2, y: l.title.y, w: TITLE_TEXT_MAX_W, h: l.title.h };
}

/** The band of the caption rect the two caption lines occupy (the rest of the rect is free for decoration). */
export function captionTextBox(l: FrameLayout): Rect {
  const mid = l.caption.y + l.caption.h / 2;
  return { x: l.caption.x, y: mid - 56, w: l.caption.w, h: 112 };
}

/**
 * Deterministic snowflakes that avoid everything printed: the photo and its ring, the QR plate and halo,
 * the holly, the title and name text, the caption and number. `nameWidth` is the fitted name's width.
 */
export function computeSnowflakes(l: FrameLayout, d: Decor, nameWidth: number, seed: number, count = 46): Snowflake[] {
  const nameBox: Rect = { x: l.name.x + (l.name.w - nameWidth) / 2, y: l.name.y, w: nameWidth, h: l.name.h };
  const blocked = [d.photoRing, d.plateHalo, titleTextBox(l), nameBox, captionTextBox(l), l.number, ...d.holly.map((h) => h.box)].map((r) => grow(r, 14));
  const rand = mulberry32(seed * 7919 + 17);
  const lo = CANDY_BORDER_PX + 24;
  const out: Snowflake[] = [];
  for (let attempt = 0; attempt < 900 && out.length < count; attempt += 1) {
    const r = 11 + Math.floor(rand() * 13);
    const x = lo + r + rand() * (l.width - 2 * (lo + r));
    const y = lo + r + rand() * (l.height - 2 * (lo + r));
    const box: Rect = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
    if (blocked.some((b) => hits(b, box))) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 26)) continue;
    out.push({ x, y, r });
  }
  return out;
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

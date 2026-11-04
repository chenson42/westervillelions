// Browser-only: draws one 1200 x 1800 frame on a canvas and returns the JPEG bytes (DECISION-124).
// All geometry comes from the pure frame-layout module; this file only paints it. No server imports.

import { FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from "@/lib/santas-workshop/admin-contract";
import { CAPTION_LINES, FRAME_TITLE, NUMBER_PX, frameNumberLabel, coverCrop, computeFrameLayout, computeDecor, computeSnowflakes, titleTextBox, CANDY_BORDER_PX, fitText, frameArtSizeOk, type FrameLayout, type Snowflake } from "@/lib/santas-workshop/frame-layout";
import { FRAME_ART_URL, type FrameFailureReason } from "@/lib/santas-workshop/frame-export-ui";
import { isSupplied } from "@/components/santas-workshop/art-slots";
import { setJpegDensity } from "@/lib/santas-workshop/jpeg-dpi";

const SERIF = "Georgia, 'Times New Roman', 'Noto Serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif";
const BLUE = "#003F87";
const BLUE_DARK = "#002d63";
const GOLD = "#F9B222";
const CREAM = "#FBF5E6";
const PINE = "#0b4a2a";
const PINE_DARK = "#06301b";
const HOLLY_GREEN = "#2e9a55";
const RED = "#b3122b";
const BULBS = [GOLD, "#ffffff", "#e0243f", "#5fd081"];
export const JPEG_QUALITY = 0.92;

/** A failure with a code the page turns into a sentence. */
export class FrameError extends Error {
  constructor(readonly reason: FrameFailureReason) {
    super(reason);
  }
}

export interface QrMatrix {
  size: number;
  get(row: number, col: number): number;
}

/** The QR for `text`, ECC level M, straight from the library's module data. */
export async function buildQrMatrix(text: string): Promise<QrMatrix> {
  const QRCode = await import("qrcode");
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: qr.modules.size, get: (r, c) => qr.modules.get(r, c) };
}

export type FrameArt = { bitmap: ImageBitmap } | null;

/**
 * The optional overlay. Absent (404) is normal and returns null. Present but not exactly 1200 x 1800
 * throws, because a mis-sized overlay would shift the whole design.
 */
export async function loadFrameArt(): Promise<FrameArt> {
  if (!isSupplied("frame-art")) return null; // no request, no console 404
  let res: Response;
  try {
    res = await fetch(FRAME_ART_URL, { cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  const bitmap = await createImageBitmap(await res.blob());
  if (!frameArtSizeOk(bitmap.width, bitmap.height)) {
    bitmap.close();
    throw new Error(`The frame art must be exactly ${FRAME_WIDTH_PX} x ${FRAME_HEIGHT_PX} pixels.`);
  }
  return { bitmap };
}

export interface ComposeInput {
  portrait: ImageBitmap;
  name: string;
  frameNumber: number;
  year: string;
  practice: boolean;
  qr: QrMatrix;
  layout: FrameLayout;
  art: FrameArt;
}

export function layoutFor(qr: QrMatrix, practice: boolean): FrameLayout {
  return computeFrameLayout({ qrModules: qr.size, practice });
}

function drawCandyBorder(ctx: CanvasRenderingContext2D) {
  const W = FRAME_WIDTH_PX;
  const H = FRAME_HEIGHT_PX;
  const b = CANDY_BORDER_PX;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.rect(b, b, W - 2 * b, H - 2 * b);
  ctx.clip("evenodd");
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = RED;
  for (let x = -H; x < W; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 32 + H, H);
    ctx.lineTo(x + H, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 6;
  ctx.strokeRect(b + 3, b + 3, W - 2 * b - 6, H - 2 * b - 6);
}

function drawSnowflake(ctx: CanvasRenderingContext2D, f: Snowflake) {
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(f.r, 0);
    ctx.moveTo(f.r * 0.55, 0);
    ctx.lineTo(f.r * 0.8, f.r * 0.28);
    ctx.moveTo(f.r * 0.55, 0);
    ctx.lineTo(f.r * 0.8, -f.r * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLeaf(ctx: CanvasRenderingContext2D, angle: number, len: number) {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  // a pointed, scalloped holly leaf along +x
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.2, -len * 0.28, len * 0.38, -len * 0.14);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.3, len * 0.66, -len * 0.14);
  ctx.quadraticCurveTo(len * 0.8, -len * 0.16, len, 0);
  ctx.quadraticCurveTo(len * 0.8, len * 0.16, len * 0.66, len * 0.14);
  ctx.quadraticCurveTo(len * 0.5, len * 0.3, len * 0.38, len * 0.14);
  ctx.quadraticCurveTo(len * 0.2, len * 0.28, 0, 0);
  ctx.closePath();
  ctx.fillStyle = HOLLY_GREEN;
  ctx.fill();
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len * 0.08, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.strokeStyle = PINE_DARK;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawHolly(ctx: CanvasRenderingContext2D, cx: number, cy: number, flip: boolean) {
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  // leaves fan toward the canvas centre (down and right in local space)
  [0.15, 0.85, 1.55].forEach((a, i) => drawLeaf(ctx, a, i === 1 ? 92 : 78));
  [[-8, -6, 17], [10, 4, 17], [-4, 14, 17]].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#e0243f";
    ctx.fill();
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - 5, y - 5, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  });
  ctx.restore();
}

function drawLightsRing(ctx: CanvasRenderingContext2D, ring: { x: number; y: number; w: number; h: number }, lights: { x: number; y: number }[]) {
  ctx.fillStyle = RED;
  ctx.fillRect(ring.x, ring.y, ring.w, ring.h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4;
  ctx.strokeRect(ring.x + 2, ring.y + 2, ring.w - 4, ring.h - 4);
  lights.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = BULBS[i % BULBS.length];
    ctx.fill();
  });
}

function drawFrame(ctx: CanvasRenderingContext2D, input: ComposeInput) {
  const { layout: l, art } = input;
  const measure = (text: string, px: number, weight = "") => {
    ctx.font = `${weight} ${px}px ${SERIF}`.trim();
    return ctx.measureText(text).width;
  };

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, FRAME_WIDTH_PX, FRAME_HEIGHT_PX);

  const decor = computeDecor(l);
  const nameFit = fitText(input.name, l.name.w, l.nameMaxPx, l.nameMinPx, (t, px) => measure(t, px, "bold"));
  if (!art) {
    ctx.fillStyle = PINE;
    ctx.fillRect(0, 0, FRAME_WIDTH_PX, FRAME_HEIGHT_PX);
    ctx.font = `bold ${nameFit.px}px ${SERIF}`;
    const nameW = ctx.measureText(nameFit.text).width;
    computeSnowflakes(l, decor, nameW, input.frameNumber).forEach((f) => drawSnowflake(ctx, f));
    drawCandyBorder(ctx);
    decor.holly.forEach((h) => drawHolly(ctx, h.cx, h.cy, h.flip));

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const tb = titleTextBox(l);
    const title = fitText(FRAME_TITLE, tb.w, 60, 34, (t, px) => measure(t, px, "bold"));
    ctx.font = `bold ${title.px}px ${SERIF}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(title.text, tb.x + tb.w / 2, l.title.y + 64);
    const greet = fitText(`Merry Christmas from the Westerville Lions · ${input.year}`, tb.w, 36, 24, (t, px) => measure(t, px, "600"));
    ctx.font = `600 ${greet.px}px ${SERIF}`;
    ctx.fillStyle = CREAM;
    ctx.fillText(greet.text, tb.x + tb.w / 2, l.title.y + 116);
  }

  // Portrait: cover-crop into the window, centred.
  const crop = coverCrop(input.portrait.width, input.portrait.height, l.photo.w, l.photo.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.photo.x, l.photo.y, l.photo.w, l.photo.h);
  ctx.clip();
  ctx.drawImage(input.portrait, crop.x, crop.y, crop.w, crop.h, l.photo.x, l.photo.y, l.photo.w, l.photo.h);
  ctx.restore();
  if (!art) {
    // Drawn after the photo, but only outside the window (the ring is clipped to exclude it).
    ctx.save();
    ctx.beginPath();
    ctx.rect(decor.photoRing.x, decor.photoRing.y, decor.photoRing.w, decor.photoRing.h);
    ctx.rect(l.photo.x, l.photo.y, l.photo.w, l.photo.h);
    ctx.clip("evenodd");
    drawLightsRing(ctx, decor.photoRing, decor.lights);
    ctx.restore();
  }
  if (art) ctx.drawImage(art.bitmap, 0, 0, FRAME_WIDTH_PX, FRAME_HEIGHT_PX);

  if (l.practiceBand) {
    ctx.fillStyle = "rgba(0, 63, 135, 0.88)";
    ctx.fillRect(l.practiceBand.x, l.practiceBand.y, l.practiceBand.w, l.practiceBand.h);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.font = `bold 44px ${SERIF}`;
    ctx.fillText("PRACTICE · not for print", l.practiceBand.x + l.practiceBand.w / 2, l.practiceBand.y + 60);
  }

  // The stuffy's name: shrinks to a floor, then truncates; fillText only.
  const fitted = nameFit;
  ctx.textAlign = "center";
  ctx.font = `bold ${fitted.px}px ${SERIF}`;
  ctx.fillStyle = art ? BLUE_DARK : "#ffffff";
  ctx.fillText(fitted.text, l.name.x + l.name.w / 2, l.nameBaselineY);

  // QR on a solid white plate; integer pixels per module, quiet zone inside the plate.
  if (!art) {
    ctx.fillStyle = GOLD; // halo drawn outside the plate only; the plate and quiet zone below stay pure white
    ctx.fillRect(decor.plateHalo.x, decor.plateHalo.y, decor.plateHalo.w, decor.plateHalo.h);
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(l.qrPlate.x, l.qrPlate.y, l.qrPlate.w, l.qrPlate.h);
  if (art) {
    ctx.strokeStyle = "#d1d5db";
    ctx.lineWidth = 2;
    ctx.strokeRect(l.qrPlate.x, l.qrPlate.y, l.qrPlate.w, l.qrPlate.h);
  }
  ctx.fillStyle = "#000000";
  for (let r = 0; r < input.qr.size; r += 1) {
    for (let c = 0; c < input.qr.size; c += 1) {
      if (input.qr.get(r, c)) ctx.fillRect(l.qrOrigin.x + c * l.qrModulePx, l.qrOrigin.y + r * l.qrModulePx, l.qrModulePx, l.qrModulePx);
    }
  }

  // Frame number, small, bottom right of the QR block.
  ctx.textAlign = "right";
  ctx.font = `${NUMBER_PX}px ${SERIF}`;
  ctx.fillStyle = art ? BLUE_DARK : GOLD;
  ctx.fillText(frameNumberLabel(input.frameNumber), l.number.x + l.number.w, l.numberBaselineY);

  // Caption: words plus the club's address, never the token link.
  ctx.textAlign = "left";
  const cx = l.caption.x;
  const mid = l.caption.y + l.caption.h / 2;
  CAPTION_LINES.forEach((line, i) => {
    const weight = i === CAPTION_LINES.length - 1 ? "bold" : "";
    const f = fitText(line, l.caption.w, l.captionMaxPx, l.captionMinPx, (t, px) => measure(t, px, weight));
    ctx.font = `${weight} ${f.px}px ${SERIF}`.trim();
    const last = i === CAPTION_LINES.length - 1;
    ctx.fillStyle = art ? (last ? BLUE : BLUE_DARK) : last ? GOLD : CREAM;
    ctx.fillText(f.text, cx, mid + (i === 0 ? -12 : 36));
  });
}

/** Paints and encodes one frame: JPEG at quality 0.92, density 300 dpi. */
export async function composeFrameJpeg(input: ComposeInput): Promise<Uint8Array> {
  let blob: Blob | null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_WIDTH_PX;
    canvas.height = FRAME_HEIGHT_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new FrameError("render_failed");
    drawFrame(ctx, input);
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    canvas.width = 0; // release the pixel buffer promptly
  } catch (e) {
    throw e instanceof FrameError ? e : new FrameError("render_failed");
  }
  if (!blob) throw new FrameError("encode_failed");
  try {
    return setJpegDensity(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    throw new FrameError("encode_failed");
  }
}

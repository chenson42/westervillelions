// Browser-only: draws one 1200 x 1800 frame on a canvas and returns the JPEG bytes (DECISION-124).
// All geometry comes from the pure frame-layout module; this file only paints it. No server imports.

import { FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from "@/lib/santas-workshop/admin-contract";
import { CAPTION_LINES, FRAME_TITLE, NUMBER_PX, frameNumberLabel, coverCrop, computeFrameLayout, fitText, frameArtSizeOk, type FrameLayout } from "@/lib/santas-workshop/frame-layout";
import { FRAME_ART_URL, type FrameFailureReason } from "@/lib/santas-workshop/frame-export-ui";
import { isSupplied } from "@/components/santas-workshop/art-slots";
import { setJpegDensity } from "@/lib/santas-workshop/jpeg-dpi";

const SERIF = "Georgia, 'Times New Roman', 'Noto Serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', serif";
const BLUE = "#003F87";
const BLUE_DARK = "#002d63";
const GOLD = "#F9B222";
const GOLD_TEXT = "#9a6a00";
const CREAM = "#FBF5E6";
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

function drawFrame(ctx: CanvasRenderingContext2D, input: ComposeInput) {
  const { layout: l, art } = input;
  const measure = (text: string, px: number, weight = "") => {
    ctx.font = `${weight} ${px}px ${SERIF}`.trim();
    return ctx.measureText(text).width;
  };

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, FRAME_WIDTH_PX, FRAME_HEIGHT_PX);

  if (!art) {
    ctx.fillStyle = BLUE;
    ctx.fillRect(0, 0, FRAME_WIDTH_PX, FRAME_HEIGHT_PX);
    ctx.fillStyle = CREAM;
    ctx.fillRect(36, 36, FRAME_WIDTH_PX - 72, FRAME_HEIGHT_PX - 72);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 4;
    ctx.strokeRect(52, 52, FRAME_WIDTH_PX - 104, FRAME_HEIGHT_PX - 104);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const title = fitText(FRAME_TITLE, l.title.w, 68, 36, (t, px) => measure(t, px, "bold"));
    ctx.font = `bold ${title.px}px ${SERIF}`;
    ctx.fillStyle = BLUE;
    ctx.fillText(title.text, l.title.x + l.title.w / 2, l.title.y + 66);
    ctx.font = `600 38px ${SERIF}`;
    ctx.fillStyle = GOLD_TEXT;
    ctx.fillText(input.year, l.title.x + l.title.w / 2, l.title.y + 118);
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
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.strokeRect(l.photo.x - 3, l.photo.y - 3, l.photo.w + 6, l.photo.h + 6);
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
  const fitted = fitText(input.name, l.name.w, l.nameMaxPx, l.nameMinPx, (t, px) => measure(t, px, "bold"));
  ctx.textAlign = "center";
  ctx.font = `bold ${fitted.px}px ${SERIF}`;
  ctx.fillStyle = BLUE_DARK;
  ctx.fillText(fitted.text, l.name.x + l.name.w / 2, l.nameBaselineY);

  // QR on a solid white plate; integer pixels per module, quiet zone inside the plate.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(l.qrPlate.x, l.qrPlate.y, l.qrPlate.w, l.qrPlate.h);
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.strokeRect(l.qrPlate.x, l.qrPlate.y, l.qrPlate.w, l.qrPlate.h);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < input.qr.size; r += 1) {
    for (let c = 0; c < input.qr.size; c += 1) {
      if (input.qr.get(r, c)) ctx.fillRect(l.qrOrigin.x + c * l.qrModulePx, l.qrOrigin.y + r * l.qrModulePx, l.qrModulePx, l.qrModulePx);
    }
  }

  // Frame number, small, bottom right of the QR block.
  ctx.textAlign = "right";
  ctx.font = `${NUMBER_PX}px ${SERIF}`;
  ctx.fillStyle = BLUE_DARK;
  ctx.fillText(frameNumberLabel(input.frameNumber), l.number.x + l.number.w, l.numberBaselineY);

  // Caption: words plus the club's address, never the token link.
  ctx.textAlign = "left";
  const cx = l.caption.x;
  const mid = l.caption.y + l.caption.h / 2;
  CAPTION_LINES.forEach((line, i) => {
    const weight = i === CAPTION_LINES.length - 1 ? "bold" : "";
    const f = fitText(line, l.caption.w, l.captionMaxPx, l.captionMinPx, (t, px) => measure(t, px, weight));
    ctx.font = `${weight} ${f.px}px ${SERIF}`.trim();
    ctx.fillStyle = i === CAPTION_LINES.length - 1 ? BLUE : BLUE_DARK;
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

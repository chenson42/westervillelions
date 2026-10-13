/**
 * Browser half of photo downscaling: decode (HEIC through the existing helper),
 * draw to a canvas at the planned size, encode JPEG down the quality ladder.
 * The planning is photo-downscale.ts (pure, tested); the limits are
 * photo-limits.ts (shared with the server's validator).
 */

import type { PhotoKind } from "@/lib/santas-workshop/photo-limits";
import { nextEncodeStep, planFor, qualityFor, startEncode, targetDimensions } from "./photo-downscale";

export interface DownscaledPhoto {
  full: Blob;
  width: number;
  height: number;
  thumb: Blob | null;
  thumbWidth: number;
  thumbHeight: number;
}

export class PhotoPrepareError extends Error {
  constructor(public readonly kind: "unreadable" | "too_big") {
    super(kind);
  }
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: File): Promise<Decoded> {
  let blob: Blob = file;
  if (isHeic(file)) {
    const { decodeHeicFileToJpegBlob } = await import("@/lib/heic-decode");
    blob = await decodeHeicFileToJpegBlob(file);
  }
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older browsers: an <img> decode also applies EXIF orientation in current engines.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new PhotoPrepareError("unreadable");
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoPrepareError("unreadable"))), "image/jpeg", quality);
  });
}

async function encode(
  decoded: Decoded,
  limit: { maxLongEdge: number; maxBytes: number },
): Promise<{ blob: Blob; width: number; height: number }> {
  let state = startEncode(limit.maxLongEdge);
  const canvas = document.createElement("canvas");
  for (;;) {
    const size = targetDimensions(decoded.width, decoded.height, state.longEdge);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoPrepareError("unreadable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
    const blob = await toBlob(canvas, qualityFor(state));
    const step = nextEncodeStep(state, blob.size, limit.maxBytes);
    if (step.kind === "fits") return { blob, width: size.width, height: size.height };
    if (step.kind === "give_up") throw new PhotoPrepareError("too_big");
    state = step.next;
  }
}

export async function downscalePhoto(file: File, kind: PhotoKind): Promise<DownscaledPhoto> {
  const plan = planFor(kind);
  const decoded = await decode(file);
  try {
    const full = await encode(decoded, plan.full);
    if (!plan.thumb) return { full: full.blob, width: full.width, height: full.height, thumb: null, thumbWidth: 0, thumbHeight: 0 };
    const thumb = await encode(decoded, plan.thumb);
    return { full: full.blob, width: full.width, height: full.height, thumb: thumb.blob, thumbWidth: thumb.width, thumbHeight: thumb.height };
  } finally {
    decoded.close();
  }
}

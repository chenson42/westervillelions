/**
 * QR decoding in the browser. Native `BarcodeDetector` when the phone has it and
 * it reads QR codes; otherwise `jsqr` on frames scaled down to at most 640 px
 * wide, imported only when the scan screen opens. The choice rule is the pure
 * `chooseDecoder` in scan-loop.ts. The swap criterion for a heavier decoder is
 * the measured decode rate on the real stickers (Phase 5, S3).
 */

import { chooseDecoder, decodeSize, type DecoderChoice } from "./scan-loop";

export type FrameSource = HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export interface QrDecoder {
  kind: DecoderChoice;
  /** The decoded text, or null when no code was found in this frame. */
  decode(source: FrameSource): Promise<string | null>;
}

interface BarcodeDetectorLike {
  detect(source: FrameSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function sourceSize(source: FrameSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  return { width: source.width, height: source.height };
}

async function jsqrDecode(source: FrameSource, canvas: HTMLCanvasElement): Promise<string | null> {
  const { width, height } = sourceSize(source);
  const size = decodeSize(width, height);
  if (size.width === 0) return null;
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, size.width, size.height);
  const image = ctx.getImageData(0, 0, size.width, size.height);
  const { default: jsQR } = await import("jsqr");
  const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
  return found?.data ?? null;
}

export async function createQrDecoder(): Promise<QrDecoder> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  let formats: string[] | null = null;
  if (Ctor) {
    try {
      formats = (await Ctor.getSupportedFormats?.()) ?? null;
    } catch {
      formats = null;
    }
  }
  const kind = chooseDecoder({ hasBarcodeDetector: Boolean(Ctor), supportedFormats: formats });
  if (kind === "native" && Ctor) {
    const detector = new Ctor({ formats: ["qr_code"] });
    return {
      kind,
      async decode(source) {
        try {
          const codes = await detector.detect(source);
          return codes[0]?.rawValue ?? null;
        } catch {
          return null;
        }
      },
    };
  }
  const canvas = document.createElement("canvas");
  return { kind: "jsqr", decode: (source) => jsqrDecode(source, canvas) };
}

/** "Scan from a photo": decode a still the worker took of the sticker. Always jsqr; stills may be large, so it works at up to 1280 px wide. */
export async function decodeStillFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    const { width, height } = bitmap;
    const scale = Math.min(1, 1280 / Math.max(1, width));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  } finally {
    bitmap.close();
  }
}

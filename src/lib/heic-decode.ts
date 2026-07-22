/**
 * WASM HEIC/HEIF decode fallback for the receipt file input
 * (docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md, DECISION-038).
 * Decoder swapped from `heic2any` to `libheif-js` — `heic2any`'s embedded
 * libheif build couldn't parse modern iPhone HEIC (10-bit `heix` + HDR
 * gain-map `tmap`); see DECISION-039 and
 * docs/work-log/2026-07-21-heic-modern-iphone-decode.md.
 *
 * Triggered only after a native `createImageBitmap()` decode failure on a
 * HEIC/HEIF file (any browser, no UA sniffing — see receipt-file-input.tsx).
 * Lazy-loads `libheif-js/wasm-bundle` (WASM inlined as base64 in the JS, no
 * separate asset fetch) so Safari users, and anyone whose native decode
 * succeeds, never download the ~1.4 MB bundle.
 *
 * Unlike `heic2any`, `libheif-js` hands back raw RGBA pixel data (via
 * `HeifImage#display`), not a Blob — so this module also owns the canvas
 * glue that encodes that pixel buffer to a JPEG Blob. That glue lives here,
 * not in image-resize.ts (which only ever resizes an already-decoded
 * image/Blob) and not in the component — see DECISION-039 §4.
 *
 * No DOM dependency beyond the dynamic import and the Blob/File types the
 * browser provides globally, EXCEPT the canvas encode step below (`document`,
 * `HTMLCanvasElement`), which is only reachable once real decoded pixels
 * exist — see encodeRgbaToJpegBlob's own comment for how tests isolate it.
 */

import { RECEIPT_IMAGE_JPEG_QUALITY } from "@/lib/image-resize";
import type { HeifDecoder, HeifImage } from "libheif-js/wasm-bundle";

export type HeicDecodeFailureKind = "chunk-load" | "decode";

/**
 * Tags which stage of the WASM HEIC decode failed, so classification never
 * has to guess from an arbitrary error's message string. Thrown only by
 * decodeHeicFileToJpegBlob below.
 */
export class HeicDecodeStageError extends Error {
  readonly stage: HeicDecodeFailureKind;

  constructor(message: string, stage: HeicDecodeFailureKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HeicDecodeStageError";
    this.stage = stage;
  }
}

/**
 * Pure, browser-free. Classifies a caught decode error into which of the
 * two user-facing messages applies. Defaults to "decode" for anything that
 * isn't a HeicDecodeStageError — a conservative choice: an unrecognized
 * error is more likely a content problem than a network problem, and
 * "decode" is the message that doesn't imply "try again."
 */
export function classifyHeicDecodeFailure(error: unknown): HeicDecodeFailureKind {
  if (error instanceof HeicDecodeStageError) return error.stage;
  return "decode";
}

export const HEIC_DECODE_FAILURE_MESSAGES: Record<HeicDecodeFailureKind, string> = {
  "chunk-load":
    "Couldn't load the HEIC photo converter — check your connection and try again, or export the photo as JPEG.",
  decode:
    "This photo couldn't be converted — it may not be a valid HEIC file. Try exporting it as JPEG.",
};

export function getHeicDecodeFailureMessage(kind: HeicDecodeFailureKind): string {
  return HEIC_DECODE_FAILURE_MESSAGES[kind];
}

interface LibheifModule {
  HeifDecoder: typeof HeifDecoder;
}

/**
 * Interop unwrap, factored out as its own pure function so it's directly
 * unit-testable without a real WASM runtime. `libheif-js/wasm-bundle`'s
 * `module.exports` is the already-invoked Emscripten MODULARIZE factory
 * result — confirmed directly against the real 1.19.8 tarball: normally a
 * Promise of the module namespace, but bundler CJS interop shapes can in
 * principle hand back a bare factory function instead of the promise
 * itself, so this checks both (mirrors the `resolveHeic2AnyExport`
 * UMD-unwrap seam it replaces).
 *
 * Exported only for heic-decode.test.ts.
 */
export async function resolveLibheifModule(mod: unknown): Promise<LibheifModule> {
  const inner = (mod as { default?: unknown })?.default ?? mod;
  const resolved = typeof inner === "function" ? (inner as () => unknown)() : inner;
  return (await resolved) as LibheifModule;
}

/**
 * Promise-wraps HeifImage#display, which is callback-based: the callback
 * fires with `target` (mutated in place) on success, or a falsy value on
 * failure — per libheif-js's own documented usage. A falsy result is a
 * decode-stage failure (the WASM module loaded fine, it just couldn't
 * render this particular image), classified identically to every other
 * failure in decodeHeicFileToJpegBlob's decode try/catch below.
 */
function displayImage(
  image: HeifImage,
  target: { data: Uint8ClampedArray; width: number; height: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    image.display(target, (result) => {
      if (!result) {
        reject(new Error("HEIF processing error"));
        return;
      }
      resolve();
    });
  });
}

/**
 * Canvas glue: encodes decoded RGBA pixels into a JPEG Blob. Isolated in
 * its own function so it's the one seam a test can swap out — canvas isn't
 * available in Vitest's Node test environment, so heic-decode.test.ts
 * covers the decode-stage control flow (mocked HeifDecoder/HeifImage) up
 * through a correctly-shaped display() call, and leaves this function's own
 * real-canvas behavior to qa's Phase 5 manual click-through against a real
 * HEIC fixture in a real browser.
 */
async function encodeRgbaToJpegBlob(pixels: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  const imageData = ctx.createImageData(pixels.width, pixels.height);
  imageData.data.set(pixels.data);
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", RECEIPT_IMAGE_JPEG_QUALITY),
  );
  if (!blob) throw new Error("Could not encode the decoded image.");
  return blob;
}

/**
 * The two untestable-without-a-browser seams: dynamically importing
 * `libheif-js/wasm-bundle`, and the canvas encode inside
 * encodeRgbaToJpegBlob. Everything else — interop unwrap, multi-image
 * handling, stage tagging, the shape of the display() call — IS exercised
 * in heic-decode.test.ts via `vi.mock("libheif-js/wasm-bundle", ...)` and a
 * mocked `HeifDecoder`/`HeifImage`.
 *
 * Caller contract: on success, the returned Blob is JPEG-encoded but NOT
 * resized — the caller (receipt-file-input.tsx) must run it back through
 * the existing resizeImage() path, same as any other image source.
 */
export async function decodeHeicFileToJpegBlob(file: File): Promise<Blob> {
  let libheif: LibheifModule;

  try {
    const mod = await import("libheif-js/wasm-bundle");
    libheif = await resolveLibheifModule(mod);
  } catch (err) {
    throw new HeicDecodeStageError("Failed to load the HEIC decoder.", "chunk-load", { cause: err });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(bytes);
    // Multi-image HEIC containers (burst shots, etc.) decode to more than
    // one HeifImage; only the first is used, same as heic2any's Blob[]
    // handling it replaces. Every returned handle holds WASM-side memory,
    // so all of them are freed below regardless of which one is used.
    const image = images[0];
    if (!image) {
      throw new HeicDecodeStageError("HEIC decoder returned no image.", "decode");
    }

    try {
      const width = image.get_width();
      const height = image.get_height();
      const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
      await displayImage(image, target);
      return await encodeRgbaToJpegBlob(target);
    } finally {
      for (const img of images) img.free?.();
    }
  } catch (err) {
    if (err instanceof HeicDecodeStageError) throw err;
    throw new HeicDecodeStageError("Failed to decode the HEIC file.", "decode", { cause: err });
  }
}

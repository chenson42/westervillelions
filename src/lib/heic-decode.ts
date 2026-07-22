/**
 * WASM HEIC/HEIF decode fallback for the receipt file input
 * (docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md, DECISION-038).
 *
 * Triggered only after a native `createImageBitmap()` decode failure on a
 * HEIC/HEIF file (any browser, no UA sniffing — see receipt-file-input.tsx).
 * Lazy-loads `heic2any` so Safari users, and anyone whose native decode
 * succeeds, never download the ~1.36 MB WASM-bearing bundle.
 *
 * No DOM dependency beyond the dynamic import and the Blob/File types the
 * browser provides globally (also available in Node 20+, which is what lets
 * heic-decode.test.ts run under Vitest's node environment without jsdom).
 */

import { RECEIPT_IMAGE_JPEG_QUALITY } from "@/lib/image-resize";

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

type Heic2AnyFn = (opts: {
  blob: Blob;
  toType: string;
  quality: number;
}) => Promise<Blob | Blob[]>;

/**
 * UMD interop unwrap, factored out as its own pure function so it's directly
 * unit-testable. heic2any's bundle is UMD, not native ESM, so a bare
 * `mod.default` isn't guaranteed populated depending on how the bundler's
 * CJS interop shim shapes the module namespace. Falls back to the module
 * value itself (a bare callable) when `.default` is missing.
 *
 * Exported only for heic-decode.test.ts: Vitest's `vi.mock`/`vi.doMock`
 * factory return value must be a plain object (it runs `assertValidExports`,
 * which rejects a bare function), so the "module resolves as a bare
 * callable, no .default" interop shape can't be constructed by mocking
 * `import("heic2any")` itself — it's exercised by calling this function
 * directly with a function value instead.
 */
export function resolveHeic2AnyExport(mod: unknown): Heic2AnyFn {
  return ((mod as { default?: unknown })?.default ?? mod) as Heic2AnyFn;
}

/**
 * The one untestable-without-a-browser seam: dynamically imports heic2any
 * and converts `file` to a single JPEG Blob. Everything around the import
 * — UMD unwrap, Blob[] handling, stage tagging — IS exercised in
 * heic-decode.test.ts via `vi.mock("heic2any", ...)` (ESM-shaped exports)
 * and direct calls to `resolveHeic2AnyExport` (bare-callable interop shape),
 * which intercept/isolate this dynamic import without needing a real WASM
 * runtime.
 *
 * Caller contract: on success, the returned Blob is JPEG-encoded but NOT
 * resized — the caller (receipt-file-input.tsx) must run it back through
 * the existing resizeImage() path, same as any other image source.
 */
export async function decodeHeicFileToJpegBlob(file: File): Promise<Blob> {
  let heic2any: Heic2AnyFn;

  try {
    const mod = await import("heic2any");
    heic2any = resolveHeic2AnyExport(mod);
  } catch (err) {
    throw new HeicDecodeStageError("Failed to load the HEIC decoder.", "chunk-load", { cause: err });
  }

  let result: Blob | Blob[];
  try {
    result = await heic2any({ blob: file, toType: "image/jpeg", quality: RECEIPT_IMAGE_JPEG_QUALITY });
  } catch (err) {
    throw new HeicDecodeStageError("Failed to decode the HEIC file.", "decode", { cause: err });
  }

  const jpegBlob = Array.isArray(result) ? result[0] : result;
  if (!jpegBlob) {
    throw new HeicDecodeStageError("HEIC decoder returned no image.", "decode");
  }
  return jpegBlob;
}

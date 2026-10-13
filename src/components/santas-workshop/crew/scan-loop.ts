/**
 * Pure parts of the QR scan screen: which decoder to use, how big the frames
 * handed to it are, and when a decode is believed. The camera, the canvas and
 * the decoders themselves live in qr-decoder.ts and scanner.tsx.
 *
 * A decode is accepted only after TWO consecutive identical reads (a motion-blurred
 * frame can decode to garbage once), text over 200 characters is ignored (a
 * sticker is an opaque short code, and the server caps it at 200), and the same
 * code is not reported again for a couple of seconds so one sticker held in view
 * does not fire a lookup per frame.
 */

export const REQUIRED_MATCHES = 2;
export const MAX_SCAN_TEXT = 200;
export const REPEAT_DEBOUNCE_MS = 2_500;
export const DECODE_INTERVAL_MS = 120;
export const MAX_DECODE_WIDTH = 640;

export type DecoderChoice = "native" | "jsqr";

/** Native BarcodeDetector only when it exists AND says it reads QR codes; otherwise the jsqr fallback. */
export function chooseDecoder(features: { hasBarcodeDetector: boolean; supportedFormats: readonly string[] | null }): DecoderChoice {
  return features.hasBarcodeDetector && features.supportedFormats?.includes("qr_code") ? "native" : "jsqr";
}

/** The size a video frame is scaled to before jsqr sees it: at most MAX_DECODE_WIDTH wide, never upscaled. */
export function decodeSize(width: number, height: number, maxWidth: number = MAX_DECODE_WIDTH): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  if (width <= maxWidth) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

export interface ScanAccumulator {
  /** Feed one decode attempt (null when nothing was found). Returns the text once it is believed, else null. */
  push(text: string | null, nowMs: number): string | null;
  reset(): void;
}

export function createScanAccumulator(options: { required?: number; debounceMs?: number } = {}): ScanAccumulator {
  const required = options.required ?? REQUIRED_MATCHES;
  const debounceMs = options.debounceMs ?? REPEAT_DEBOUNCE_MS;
  let streakText: string | null = null;
  let streak = 0;
  let lastText: string | null = null;
  let lastAt = -Infinity;

  return {
    push(text, nowMs) {
      const usable = text !== null && text.length > 0 && text.length <= MAX_SCAN_TEXT ? text : null;
      if (usable === null) {
        streakText = null;
        streak = 0;
        return null;
      }
      if (usable === streakText) streak += 1;
      else {
        streakText = usable;
        streak = 1;
      }
      if (streak < required) return null;
      if (usable === lastText && nowMs - lastAt < debounceMs) return null;
      lastText = usable;
      lastAt = nowMs;
      return usable;
    },
    reset() {
      streakText = null;
      streak = 0;
      lastText = null;
      lastAt = -Infinity;
    },
  };
}

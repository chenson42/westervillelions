/**
 * Event image transposition helpers — Site Review Fixes Batch 3.
 * docs/work-log/2026-09-04-site-review-fixes.md
 *
 * The admin event form's cropper (`src/components/admin/image-cropper.tsx`)
 * always produces a `data:image/...;base64,...` URI client-side and hands it
 * to the server unchanged. The server is responsible for transposing that
 * data URI into bytes (stored in the `event_images` table) plus a stable,
 * versioned URL (stored in `events.image`) — the bytes themselves never sit
 * in the `events` row. These functions are the pure (no DB, no I/O) half of
 * that transposition, kept separate so they're unit-testable without a
 * database.
 */

const DATA_URI_PATTERN = /^data:([^;,]+);base64,([\s\S]*)$/;

export interface ParsedImageDataUri {
  contentType: string;
  buffer: Buffer;
}

/**
 * True if `value` looks like a `data:image/...;base64,...` URI — the shape
 * the cropper produces for a newly selected/cropped image. Any other value
 * (an existing `/api/public/events/{id}/image?v=...` URL, `null`, or an
 * empty string) is not a data URI and should pass through unchanged.
 */
export function isImageDataUri(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}

/**
 * Parse a `data:<mime>;base64,<payload>` URI into its content type and raw
 * bytes. Returns `null` if the string isn't shaped like one (malformed
 * prefix, missing comma, non-image mime type) — callers should treat that
 * as "leave the value alone" rather than throwing.
 */
export function parseImageDataUri(value: string): ParsedImageDataUri | null {
  const match = DATA_URI_PATTERN.exec(value);
  if (!match) return null;

  const [, contentType, base64Payload] = match;
  if (!contentType.startsWith("image/")) return null;
  if (base64Payload.length === 0) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;

  return { contentType, buffer };
}

/**
 * Build the versioned, same-origin URL stored in `events.image` after a
 * data: URI has been transposed into the `event_images` table. The `?v=`
 * query param is a pure cache-buster (matched by nothing server-side) —
 * bump it on every replace so browsers/CDNs holding the previous
 * `immutable`-cached response fetch the new bytes under a new URL.
 */
export function buildEventImageUrl(eventId: string, version: number | string): string {
  return `/api/public/events/${eventId}/image?v=${version}`;
}

/**
 * Pure resize math for receipt image downscaling (DECISION-035).
 *
 * No DOM dependency — this module only computes target dimensions. The
 * actual canvas drawing / `toBlob()` glue lives in the client component that
 * owns the file input (`src/components/admin/ledger/receipt-file-input.tsx`),
 * mirroring the client-safe/server-only split already established between
 * `permissions.ts` and `permissions-server.ts`.
 *
 * Downscale spec (Phase 3 design doc, "Transaction Receipt Upload"):
 *   - Longest edge: 1600px. A receipt photographed at 1600px on the long
 *     edge renders printed thermal/inkjet receipt text at roughly 150-200
 *     DPI for a typical 3-4 inch receipt width — comfortably legible on
 *     zoom, without carrying a modern phone camera's native 3000-4000px
 *     dimensions.
 *   - JPEG quality: 0.82 — above this point block artifacts on small
 *     receipt-font text become visually noticeable; below ~0.7 thermal
 *     receipt text starts to smear.
 *   - PNG receipts are converted to JPEG (photographic/document content
 *     compresses far better as JPEG; no alpha transparency is needed).
 *   - PDFs never touch this path — only image MIME types get downscaled.
 *
 * Server-side magic-byte validation and the 10 MB cap remain authoritative
 * regardless of any client-side resize — this is a UX nicety, never a trust
 * boundary.
 */

/** Target longest-edge dimension (px) for a resized receipt image. */
export const RECEIPT_IMAGE_MAX_DIMENSION = 1600;

/** JPEG re-encode quality (0-1) for resized receipt images. */
export const RECEIPT_IMAGE_JPEG_QUALITY = 0.82;

/**
 * Computes the output dimensions for a receipt image, scaling the longer
 * edge down to `maxDimension` while preserving aspect ratio. Dimensions
 * already at or under `maxDimension` on both axes are returned unchanged
 * (rounded to the nearest integer).
 *
 * Defensive: does not throw on zero/negative input — a decoded image can
 * never actually have such dimensions, but the contract is documented here
 * rather than left to accidentally divide by zero.
 */
export function computeResizeDimensions(
  width: number,
  height: number,
  maxDimension: number = RECEIPT_IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  if (width <= maxDimension && height <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const longEdge = Math.max(width, height);
  const scale = maxDimension / longEdge;

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Magic-byte (file signature) validator for receipt uploads — DECISION-019.
 *
 * The HTTP Content-Type header is spoofable by the client; the only reliable
 * check is inspecting the first bytes of the uploaded file. This helper
 * checks for the three allowed receipt formats:
 *
 *   PDF    — starts with %PDF (25 50 44 46)
 *   JPEG   — starts with FF D8 FF (any fourth byte — covers JFIF, EXIF, etc.)
 *   PNG    — starts with 89 50 4E 47 0D 0A 1A 0A (full 8-byte PNG signature)
 *
 * Returns the canonical MIME type string on success, or `null` if the file
 * does not match any allowed type.
 *
 * Usage (upload route):
 *   const contentType = validateMagicBytes(fileBytes);
 *   if (!contentType) {
 *     return NextResponse.json({ error: "Only PDF, JPEG, and PNG receipts are accepted" }, { status: 400 });
 *   }
 */

/**
 * Validates file bytes against allowed magic-byte signatures.
 *
 * @param bytes  Buffer containing at least the first bytes of the file.
 *               Caller should pass the full file buffer.
 * @returns      Canonical MIME type (`'application/pdf'`, `'image/jpeg'`,
 *               `'image/png'`) or `null` if the file is not an allowed type.
 */
export function validateMagicBytes(bytes: Buffer | Uint8Array): string | null {
  if (bytes.length < 4) return null;

  // PDF: 25 50 44 46  (%PDF)
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }

  // JPEG: FF D8 FF (third byte is always 0xFF; fourth byte varies by marker type)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A (all 8 bytes must match)
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  return null;
}

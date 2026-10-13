/**
 * Test support: synthetic JPEG-shaped byte strings with a real SOF header, so the
 * header-only validator can be exercised with no real photo and no image library.
 * Not a decodable picture. Importing this from production code is a scan failure.
 */

export function makeJpeg(width: number, height: number, options: { progressive?: boolean; padBytes?: number; truncated?: boolean } = {}): Uint8Array {
  const sof = options.progressive ? 0xc2 : 0xc0;
  const parts: number[] = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // JFIF APP0
    0xff, sof, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, // SOS
  ];
  for (let i = 0; i < (options.padBytes ?? 8); i += 1) parts.push(i % 251);
  if (!options.truncated) parts.push(0xff, 0xd9); // EOI
  return Uint8Array.from(parts);
}

/** The classic 1x1 PNG, for the "a PNG is not a JPEG" case. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"),
);

export const UUID_A = "11111111-1111-4111-8111-111111111111";
export const UUID_B = "22222222-2222-4222-8222-222222222222";
export const UUID_C = "33333333-3333-4333-8333-333333333333";
export const UUID_D = "44444444-4444-4444-8444-444444444444";
export const UUID_E = "55555555-5555-4555-8555-555555555555";

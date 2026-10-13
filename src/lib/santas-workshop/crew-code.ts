/**
 * The shared per-session worker code (Phase 3 Ruling 2): 8 characters from an
 * unambiguous alphabet, stored ENCRYPTED (AES-256-GCM, key derived from
 * AUTH_SECRET) so an admin can re-read it; verification is decrypt + timingSafeEqual.
 * Rotating AUTH_SECRET makes the stored code undecryptable: decrypt returns null
 * and the admin regenerates ("regenerate", not a crash).
 */

import { createCipheriv, createDecipheriv, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** No 0 O 1 I L. */
export const CREW_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CREW_CODE_LENGTH = 8;

export function generateCrewCode(): string {
  let out = "";
  for (let i = 0; i < CREW_CODE_LENGTH; i += 1) out += CREW_CODE_ALPHABET[randomInt(CREW_CODE_ALPHABET.length)];
  return out;
}

/** What a person typed -> comparable form: uppercase, spaces and hyphens removed. */
export function normalizeCrewCodeInput(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

/** Display grouping for the admin card and text message: ABCD-EFGH. */
export function formatCrewCode(code: string): string {
  return code.length === CREW_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function encryptCrewCode(code: string, key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", nonce.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

/** The plain code, or null when the value is malformed or was sealed under a different key. */
export function decryptCrewCode(enc: string | null | undefined, key: Buffer): string | null {
  if (!enc) return null;
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const nonce = Buffer.from(parts[1], "base64url");
    const ct = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (nonce.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type CodeCheck = "match" | "mismatch" | "unreadable";

export function checkCrewCode(enc: string | null | undefined, input: string, key: Buffer): CodeCheck {
  const stored = decryptCrewCode(enc, key);
  if (stored === null) return "unreadable";
  const a = Buffer.from(normalizeCrewCodeInput(input));
  const b = Buffer.from(stored);
  if (a.length !== b.length) return "mismatch";
  return timingSafeEqual(a, b) ? "match" : "mismatch";
}

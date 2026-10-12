import { randomBytes } from "node:crypto";

/** A 128-bit random token, 22 base64url characters (collage and family URLs). Unguessable, so unthrottled. */
export function newToken128(): string {
  return randomBytes(16).toString("base64url");
}

export const TOKEN_128_PATTERN = /^[A-Za-z0-9_-]{22}$/;

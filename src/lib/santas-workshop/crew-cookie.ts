/**
 * The worker credential: a signed cookie
 *   base64url(JSON { s: sessionId, v: codeVersion, d: deviceId, e: expiresEpochSeconds }) "." base64url(HMAC-SHA256)
 * keyed by an HKDF-derived key (never the raw NextAuth secret). One cookie per
 * session. HttpOnly, SameSite=Lax (the entry link arrives by text message),
 * Path=/, 72 h ABSOLUTE (not sliding). `Secure` and the `__Host-` name prefix
 * only in production, because a `__Host-` cookie requires Secure and plain-http
 * localhost may refuse it.
 *
 * The cookie alone grants nothing: requireCrew re-reads the session row on every
 * request (status, pause, code version, closing date).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const CREW_COOKIE_MAX_AGE_SECONDS = 72 * 60 * 60;

export interface CrewCookiePayload {
  /** session id */
  s: string;
  /** code version at entry */
  v: number;
  /** device id (22-char random) */
  d: string;
  /** expiry, epoch seconds */
  e: number;
}

export function newDeviceId(): string {
  return randomBytes(16).toString("base64url");
}

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function sign(payloadB64: string, key: Buffer): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

export function signCrewCookie(payload: CrewCookiePayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export type CookieVerdict =
  | { ok: true; payload: CrewCookiePayload }
  | { ok: false; reason: "malformed" | "bad_signature" };

/**
 * Signature and shape only. The caller compares the session id, code version and
 * expiry (those are authorization, this is authenticity).
 */
export function verifyCrewCookie(value: string | undefined | null, key: Buffer): CookieVerdict {
  if (!value) return { ok: false, reason: "malformed" };
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = Buffer.from(sign(body, key));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CrewCookiePayload>;
    if (
      typeof parsed.s !== "string" ||
      typeof parsed.v !== "number" ||
      !Number.isInteger(parsed.v) ||
      typeof parsed.d !== "string" ||
      !DEVICE_ID_PATTERN.test(parsed.d) ||
      typeof parsed.e !== "number"
    ) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, payload: { s: parsed.s, v: parsed.v, d: parsed.d, e: parsed.e } };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

/** `swcrew-<first 8 hex of the session id>`, with `__Host-` in production. */
export function crewCookieName(sessionId: string, production: boolean): string {
  const base = `swcrew-${sessionId.replace(/-/g, "").slice(0, 8)}`;
  return production ? `__Host-${base}` : base;
}

export function crewCookieHeader(name: string, value: string, production: boolean, maxAgeSeconds = CREW_COOKIE_MAX_AGE_SECONDS): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (production) parts.push("Secure");
  return parts.join("; ");
}

/** Reads one cookie out of a Cookie header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

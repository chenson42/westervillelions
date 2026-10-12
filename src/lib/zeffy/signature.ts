/**
 * Zeffy webhook signature verification (OpenAPI "Webhook signatures").
 *
 *   Zeffy-Signature: t=<unix seconds>,v1=<hex>
 *   v1 = HMAC-SHA256(secret, "{t}." + rawBodyBytes)
 *
 * Pure: `nowMs` and the compare function are injected so tests need neither a
 * clock nor a spy on node:crypto. The HMAC covers the RAW BYTES; a re-serialised
 * JSON body fails. Retries are re-signed with a fresh timestamp but reuse the
 * event id, so replay protection is the handler's dedupe, not this function.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  | "missing_header"
  | "malformed_header"
  | "bad_timestamp"
  | "stale_timestamp"
  | "no_match";

export type SignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: SignatureFailure };

export interface SignatureDeps {
  timingSafeEqual?: (a: Uint8Array, b: Uint8Array) => boolean;
}

export function computeZeffySignature(
  secret: string,
  timestamp: string | number,
  rawBody: Uint8Array,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

const DIGITS = /^\d{1,15}$/;
const HEX = /^[0-9a-fA-F]+$/;

interface ParsedHeader {
  t: string | null;
  v1: string[];
}

function parseHeader(header: string): ParsedHeader | null {
  const parsed: ParsedHeader = { t: null, v1: [] };
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (parsed.t === null) parsed.t = value;
    } else if (key === "v1") {
      parsed.v1.push(value);
    }
  }
  if (parsed.t === null && parsed.v1.length === 0) return null;
  return parsed;
}

export function verifyZeffySignature(
  input: {
    secret: string;
    header: string | null | undefined;
    rawBody: Uint8Array;
    nowMs: number;
  },
  deps: SignatureDeps = {},
): SignatureResult {
  const compare = deps.timingSafeEqual ?? timingSafeEqual;
  if (!input.header) return { ok: false, reason: "missing_header" };

  const parsed = parseHeader(input.header);
  if (!parsed || parsed.t === null || parsed.v1.length === 0) {
    return { ok: false, reason: "malformed_header" };
  }
  if (!DIGITS.test(parsed.t)) return { ok: false, reason: "bad_timestamp" };

  const t = Number(parsed.t);
  if (Math.abs(input.nowMs / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = Buffer.from(computeZeffySignature(input.secret, parsed.t, input.rawBody), "hex");
  let matched = false;
  for (const candidate of parsed.v1) {
    // Wrong shape is a mismatch, never a throw.
    if (!HEX.test(candidate) || candidate.length % 2 !== 0) continue;
    const received = Buffer.from(candidate, "hex");
    // Length check first: timingSafeEqual throws on unequal lengths.
    if (received.length !== expected.length) continue;
    if (compare(expected, received)) matched = true;
  }
  return matched ? { ok: true, timestamp: t } : { ok: false, reason: "no_match" };
}

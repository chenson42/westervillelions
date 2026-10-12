/**
 * Signing helper for tests and scripts/zeffy-webhook-fixture.ts ONLY. A
 * source-scan test (webhook-route-source.test.ts) fails the build if app code
 * imports this file.
 */

import { computeZeffySignature } from "./signature";

/** A complete `Zeffy-Signature` header value for `body` signed at unix second `t`. */
export function signZeffyBody(secret: string, body: string | Uint8Array, t: number): string {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return `t=${t},v1=${computeZeffySignature(secret, t, bytes)}`;
}

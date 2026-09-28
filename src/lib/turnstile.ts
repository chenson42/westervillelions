/**
 * Cloudflare Turnstile verification — consolidated out of 4 copy-pasted
 * `verifyTurnstile()` implementations in `src/app/api/{contact,
 * newsletter/subscribe,membership-applications,auth/register}/route.ts`
 * (public-form spam hardening, docs/work-log/2026-09-28-public-form-spam.md).
 *
 * All four routes call this module for Turnstile verification. Only
 * `contact`, `newsletter/subscribe`, and `membership-applications` also import
 * `src/lib/form-guard.ts` for the honeypot/timing/gibberish/cooldown checks —
 * `auth/register` deliberately does NOT, and keeps its existing, intentionally
 * visible 400/403 responses untouched. See the Phase 3 design doc for why.
 */

import type { NextRequest } from "next/server";
import { getAppUrl } from "@/lib/email-compose";

export interface TurnstileResult {
  success: boolean;
  /** Only present when Cloudflare returned one; useful for logging a hostname-mismatch reject. */
  hostname?: string;
}

/** Cloudflare's documented "always passes" test secret. See verifyTurnstile()'s doc comment. */
export const CLOUDFLARE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";

function allowedHostnames(): string[] {
  let appHost: string;
  try {
    appHost = new URL(getAppUrl()).hostname;
  } catch {
    appHost = "westervillelions.org";
  }
  return [appHost, "localhost", "127.0.0.1"];
}

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Fail-open-in-dev, unchanged from the pre-existing behavior in all four routes,
 * now explicit: when TURNSTILE_SECRET_KEY is unset, this substitutes Cloudflare's
 * own "always passes" sandbox test secret (CLOUDFLARE_ALWAYS_PASS_TEST_SECRET)
 * rather than skipping the network call. This is intentional for local dev (no
 * real Turnstile keys required to run `pnpm dev`) and was already true before
 * this change in all four routes independently — consolidating it here does not
 * change behavior, only removes the 4x duplication and gives it a name and a
 * comment.
 *
 * Hostname check: when Cloudflare's response includes a `hostname` field, it
 * must be in a fixed allow-list (the app's own configured hostname, plus
 * localhost/127.0.0.1 for local dev). A present-but-disallowed hostname makes the
 * overall result `{ success: false, hostname }` even though Cloudflare itself
 * said `success: true` — this catches a token solved on a copycat/staging domain
 * and replayed against production. A MISSING hostname field (some Turnstile
 * responses omit it, e.g. with the test secret) is treated as neutral, not a
 * reject.
 *
 * Network failure (the fetch() call rejects) is NOT specially handled here — it
 * propagates out of this function uncaught, exactly as in the pre-consolidation
 * code, and lands in each route's existing outer try/catch producing a generic
 * 500. Do not add a new try/catch here that would swallow it.
 */
export async function verifyTurnstile(
  token: string,
  opts?: { remoteip?: string },
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? CLOUDFLARE_ALWAYS_PASS_TEST_SECRET;
  const body: Record<string, string> = { secret, response: token };
  if (opts?.remoteip) {
    body.remoteip = opts.remoteip;
  }
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  const hostname: string | undefined = typeof data.hostname === "string" ? data.hostname : undefined;

  if (data.success !== true) {
    return { success: false, hostname };
  }

  // The hostname allow-list only means something for a REAL secret verifying a
  // REAL solved token. Cloudflare's documented "always passes" TEST secret
  // (used above when TURNSTILE_SECRET_KEY is unset — local dev) returns a
  // canned response whose hostname is always the literal "example.com",
  // regardless of the real domain — confirmed empirically against Cloudflare's
  // live siteverify endpoint while implementing this, contradicting this
  // function's original assumption that the test secret's response omits
  // hostname entirely. Enforcing the allow-list against that canned value would
  // reject every dev-mode submission when no real secret is configured, which
  // is exactly the case `pnpm dev` relies on (see the doc comment above). Skip
  // the check for the test secret; it stays fully enforced for a real secret.
  if (secret !== CLOUDFLARE_ALWAYS_PASS_TEST_SECRET && hostname !== undefined && !allowedHostnames().includes(hostname)) {
    return { success: false, hostname };
  }

  return { success: true, hostname };
}

/**
 * First entry of `x-forwarded-for` (Vercel sets this), falling back to
 * `x-real-ip`, else undefined. Never throws. Callers pass the result straight
 * through as `remoteip`.
 */
export function getRemoteIp(request: NextRequest): string | undefined {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return undefined;
}

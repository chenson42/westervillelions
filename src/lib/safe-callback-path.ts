/**
 * Open-redirect guard for the sign-in `callbackUrl`
 * (docs/work-log/2026-10-10-approvals-mobile-and-history.md, Phase 3
 * "safeCallbackPath() contract"). Returns a same-site path (plus query and
 * hash) or the fallback. Zero imports: client-safe and usable from the proxy,
 * the sign-in page and the register page.
 */

export const DEFAULT_CALLBACK_PATH = "/members";

const MAX_LEN = 2048;
// Control characters, whitespace and backslashes: browsers strip tab/newline
// from URLs and treat "\" like "/", so "/<TAB>/evil.example" would otherwise
// collapse to "//evil.example".
const FORBIDDEN = /[\u0000-\u001f\u007f\s\\]/;
const BASE = "http://callback.invalid";

export function safeCallbackPath(
  raw: string | null | undefined,
  opts?: { origin?: string; fallback?: string },
): string {
  const fallback = opts?.fallback ?? DEFAULT_CALLBACK_PATH;
  if (typeof raw !== "string" || raw.length < 1 || raw.length > MAX_LEN) return fallback;

  let candidate = raw;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    if (!opts?.origin) return fallback;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return fallback;
    }
    if (url.origin !== opts.origin) return fallback;
    candidate = url.pathname + url.search + url.hash;
  }

  if (!candidate.startsWith("/")) return fallback;
  if (candidate[1] === "/" || candidate[1] === "\\") return fallback;
  if (FORBIDDEN.test(candidate)) return fallback;

  let normalized: string;
  try {
    const u = new URL(candidate, BASE);
    if (u.origin !== BASE) return fallback;
    normalized = u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
  // "/..//evil.example" and "/.//evil.example" normalize to "//evil.example".
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return fallback;
  return normalized;
}

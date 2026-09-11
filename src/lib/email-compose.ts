/**
 * Shared scaffolding for outbound email composition.
 *
 * Three pieces of boilerplate were independently copy-pasted around nearly
 * every one of this codebase's ~18 `sendEmail()`/`sendBulkMemberEmail()`
 * call sites: the from-address fallback, the absolute app URL used to build
 * links inside an email body, and HTML-escaping of member-supplied text.
 * CLAUDE.md's "Duplication Is a Review Finding" section names this as its
 * flagship case — the 2026-08-12 incident where one copy of the escaper was
 * simply omitted, sending unescaped member text to the whole board. Counts
 * kept growing while backlog item B-46 sat open (from-address 12 → 15,
 * app-URL 8 → 19 between 2026-08-12 and the 2026-09-10 code review, HIGH-1)
 * and produced a second real defect: `api/auth/forgot-password/route.ts`
 * had NO fallback at all for the app URL, so an unset `NEXTAUTH_URL` would
 * have emailed a literal `undefined/reset-password?token=…` link.
 *
 * This module is the fix: a send site supplies only its recipient, subject,
 * and body — `getFromEmail()`, `getAppUrl()`, and `escapeHtml()` own the
 * rest, in one place each.
 *
 * Deliberately does NOT own:
 *   - `sendEmail()` / `sendBulkMemberEmail()` and the deny-by-default
 *     non-production guardrail — still `src/lib/email.ts`. Do not
 *     duplicate or alter that guardrail's semantics here.
 *   - The club's distribution-list addresses (`CLUB_GROUP_EMAIL`,
 *     `BOARD_EMAIL`) — still `src/lib/club-contacts.ts`.
 *   - The actual escaping algorithm — still `src/lib/html-escape.ts`; this
 *     module re-exports it so a send site needing from-address, app-URL,
 *     AND escaping has one obvious import instead of two.
 */

import { escapeHtml } from "@/lib/html-escape";

export { escapeHtml };

/**
 * The from-address for outbound club email, with an optional RFC 5322
 * display-name wrapper.
 *
 * `process.env.RESEND_FROM_EMAIL` is the configured sending address;
 * `"noreply@westervillelions.org"` is the fallback used when it's unset
 * (local dev, or a deploy that hasn't configured it yet). This was
 * previously `process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"`,
 * copy-pasted at 15 call sites across 14 files — always the same fallback
 * value, so consolidating it changes no behavior anywhere.
 *
 * @param displayName Optional display name, e.g. `"Westerville Lions Club"`.
 *   When given, returns `"Display Name <address>"`; when omitted, returns
 *   the bare address. Both forms were already in use across the codebase
 *   (some senders wrap with a display name, most don't) — this parameter
 *   lets a call site keep whichever form it already used, rather than
 *   forcing every site onto one shape.
 */
export function getFromEmail(displayName?: string): string {
  const address = process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org";
  return displayName ? `${displayName} <${address}>` : address;
}

/**
 * The absolute app URL used to build links inside an email body (password
 * reset links, "review this in the admin" links, calendar/logo asset URLs).
 *
 * Standardized shape, per the 2026-09-10 code review (HIGH-1): trailing
 * slash trimmed, ABSOLUTE fallback. Two other shapes were in use across the
 * ~19 prior call sites and are both wrong for this purpose:
 *   - `process.env.NEXTAUTH_URL ?? ""` (9 sites) — an empty fallback
 *     produces a root-relative URL (e.g. `/admin/ledger/approvals`), which
 *     has nothing to resolve against inside a mail client and is broken.
 *   - a bare `` `${process.env.NEXTAUTH_URL}/...` `` with NO fallback at
 *     all (`api/auth/forgot-password/route.ts`, fixed 2026-09-10) — an
 *     unset env var would have produced a literal `undefined/...` link.
 *
 * This function's shape matches the one prior call site that already had
 * it right (`api/admin/events/[id]/announce/route.ts`'s local `siteUrl()`).
 * NEVER reintroduce the `?? ""` shape for an email link.
 */
export function getAppUrl(): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "https://westervillelions.org";
}

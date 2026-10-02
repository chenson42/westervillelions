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

/**
 * HTML body of the "Reset your password" email (POST /api/auth/forgot-password).
 * Extracted from the route so the sender and the Email Queue redaction tests
 * (src/lib/email-queue-view.test.ts) share ONE source rather than a pasted
 * copy. The body carries a live reset token in `resetUrl` — see
 * src/lib/email-queue-view.ts, which hides it from every queue viewer
 * (DECISION-115). Whitespace is byte-identical to the previous inline literal.
 */
export function buildPasswordResetEmailHtml(resetUrl: string): string {
  return `
          <h2>Password Reset Request</h2>
          <p>You requested a password reset for your Westerville Lions Club account.</p>
          <p><a href="${resetUrl}" style="background:#003F87;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Reset Password</a></p>
          <p>This link expires in 24 hours. If you did not request a reset, you can ignore this email.</p>
        `;
}

/**
 * HTML body of the new-member "set your password" welcome email
 * (sendWelcomeEmail in src/lib/members.ts). Carries a live reset token in
 * `setPasswordUrl`; same sharing and redaction rationale as
 * buildPasswordResetEmailHtml(). `name` is HTML-escaped here.
 */
export function buildWelcomeSetPasswordEmailHtml(input: {
  name: string;
  setPasswordUrl: string;
  appUrl: string;
}): string {
  const { name, setPasswordUrl, appUrl } = input;
  return `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Welcome to the Westerville Lions Club! Your member portal account has been created.</p>
      <p>Click the button below to set your password and activate your account:</p>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${setPasswordUrl}" style="background-color:#003F87; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:bold;">
          Set Your Password
        </a>
      </p>
      <p>This link expires in 24 hours. If you need a new one, use the <a href="${appUrl}/forgot-password">forgot password</a> page.</p>
      <p>Alternatively, if your Google account uses this email address, you can sign in directly with Google — no password needed.</p>
      <br />
      <p>Yours in service,</p>
      <p><strong>Westerville Lions Club</strong></p>
    `;
}

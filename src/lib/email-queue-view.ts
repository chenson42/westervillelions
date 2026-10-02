/**
 * Credential redaction for persisted email bodies shown in the Email Queue
 * viewer (DECISION-115, M1).
 *
 * WHY: `sendEmail()` persists the full `html` into `email_queue`, and two
 * senders put a LIVE password-reset token in it (POST /api/auth/forgot-password
 * and the new-member welcome email). Anyone who can open the queue could
 * request a reset for an admin's address, read the link, and take the account.
 * The queue is therefore treated as holding every credential its bodies carry,
 * and this function hides them for EVERY viewer, admins included.
 *
 * Pure and client-safe (no DB import). Idempotent. The stored row is never
 * modified: the retry route re-sends the original, so redaction must only ever
 * be applied on the way to a browser.
 *
 * RULE (DECISION-115 item 4): any new surface that renders persisted email
 * bodies must apply redactQueuedEmailHtml() first. B-135 inventories other
 * readers.
 *
 * What it hides, in order:
 *  1. The VALUE of any URL query parameter whose name contains token, key,
 *     secret, code, pass, pwd, auth, sig or session (`;` is a valid lead so the
 *     HTML-encoded `&amp;token=` is caught). Deliberately over-matches
 *     (`postcode=` too): failing closed is right in a viewer.
 *  2. A temporary-password shape XXXX-XXXX-XXXX in the alphabet
 *     generateTempPassword() uses. A backstop: no sender emails one today.
 *  3. Any run of 32 or more hex characters (a 64-hex reset token wherever it
 *     sits, including moved into the URL path).
 *
 * Known limits: a short or non-hex opaque token outside those shapes survives;
 * free text a member typed into a form (contact, applications) is not
 * inspected. Quantifiers are bounded so long hostile input cannot cause
 * pathological backtracking.
 */

export const REDACTED_MARKER = "[hidden]";

const CREDENTIAL_QUERY_VALUE =
  /([?&;][\w.-]{0,40}(?:token|key|secret|code|pass|pwd|auth|sig|session)[\w.-]{0,40}=)[^&"'\s<>#]*/gi;

const TEMP_PASSWORD_SHAPE = /\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g;

const LONG_HEX_RUN = /\b[a-f0-9]{32,}\b/gi;

export function redactQueuedEmailHtml(html: string): string {
  return html
    .replace(CREDENTIAL_QUERY_VALUE, `$1${REDACTED_MARKER}`)
    .replace(TEMP_PASSWORD_SHAPE, REDACTED_MARKER)
    .replace(LONG_HEX_RUN, REDACTED_MARKER);
}

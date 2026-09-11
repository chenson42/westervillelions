/**
 * Shared HTML-escaping helper for outbound email bodies built from
 * user-typed free text.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "Library
 * modules": the escaper this feature's email builders need already existed,
 * separately, in `src/lib/proposals.ts` (`escapeProposalHtml`),
 * `src/lib/dues-reminders.ts`, and `src/lib/ledger-acknowledgment-letter.ts`
 * — three copies, which is exactly the pattern CLAUDE.md's "Duplication Is a
 * Review Finding" section calls out by name. That feature pulled a single
 * `escapeHtml()` into its own pure module (no imports at all — importable
 * from anywhere, no DB coupling, mirrors `src/lib/club-contacts.ts`'s "stay
 * pure" precedent) and was its first consumer, but deliberately left the
 * three existing copies in place, out of scope for that feature.
 *
 * 2026-09-11 (B-46 consolidation): the three copies are now gone.
 * `proposals.ts`, `dues-reminders.ts`, and `ledger-acknowledgment-letter.ts`
 * all import this function. Two of those three copies escaped `'` as a
 * fifth character (`&#39;`) and one — this file's original 4-char set,
 * matched by `proposals.ts`'s copy — did not. Per the 2026-09-10 code
 * review's recommendation, the apostrophe escape won: it's the stricter of
 * the two behaviors, was already proven safe in the two features that had
 * it, and costs nothing (an escaped apostrophe renders identically to a raw
 * one in an HTML text node — this only matters if a value is ever
 * interpolated inside a single-quoted attribute, which no caller does, but
 * costs nothing to guard against). This is the single source of truth for
 * the escape set now — do not add a fourth implementation.
 */

/**
 * Escapes `&`, `<`, `>`, `"`, and `'` in a string before it is interpolated
 * into an HTML email body. `&` is replaced first so that a value which
 * already contains an entity-like substring (e.g. `"AT&T"`) is not
 * double-encoded — this function only ever runs one pass over the input.
 *
 * Values derived from enums or numbers (status labels, generated summaries)
 * are produced by this codebase and do NOT need escaping — escaping them
 * anyway would double-encode legitimate punctuation.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

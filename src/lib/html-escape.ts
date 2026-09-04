/**
 * Shared HTML-escaping helper for outbound email bodies built from
 * user-typed free text.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "Library
 * modules": the escaper this feature's email builders need already exists,
 * separately, in `src/lib/proposals.ts` (`escapeProposalHtml`),
 * `src/lib/dues-reminders.ts`, and `src/lib/ledger-acknowledgment-letter.ts`
 * — three copies, which is exactly the pattern CLAUDE.md's "Duplication Is a
 * Review Finding" section calls out by name. Rather than add a FOURTH copy,
 * this feature pulls a single `escapeHtml()` into its own pure module (no
 * imports at all — importable from anywhere, no DB coupling, mirrors
 * `src/lib/club-contacts.ts`'s "stay pure" precedent) and is its first
 * consumer.
 *
 * Scope discipline: this file does NOT replace the three existing copies —
 * rewiring `proposals.ts` / `dues-reminders.ts` / `ledger-acknowledgment-letter.ts`
 * to import this helper is unrelated to this feature and belongs to the
 * architect's 30-day code review, which already owns exactly this class of
 * finding (see CLAUDE.md's "Duplication Is a Review Finding, Not a Style
 * Preference").
 */

/**
 * Escapes `&`, `<`, `>`, and `"` in a string before it is interpolated into
 * an HTML email body. `&` is replaced first so that a value which already
 * contains an entity-like substring (e.g. `"AT&T"`) is not double-encoded —
 * this function only ever runs one pass over the input.
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
    .replace(/"/g, "&quot;");
}

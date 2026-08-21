/**
 * Welcome Packet — pure string/validation logic (no DB, no filesystem, no
 * Next.js request lifecycle).
 *
 * docs/work-log/2026-08-21-welcome-packet-live-page.md, Phase 2 (Revised) /
 * Phase 3 (Revised), DECISION-090.
 *
 * This module used to also resolve "the current welcome packet" from
 * docs/club-documents/ via directory listing + an HTML marker comment — that
 * mechanism was scrapped (docs/club-documents/ is gitignored and never ships
 * in the deployed bundle, discovered in the original, superseded Phase 4;
 * see the work-log's "LOOP-BACK" section). The content now lives in the
 * `welcomePackets` / `welcomePacketCurrent` tables (src/lib/welcome-packets-
 * queries.ts) instead of the filesystem — `listWelcomePacketFiles()`,
 * `findMarkedPacketFiles()`, `resolveCurrentPacket()`, and the
 * `WELCOME_PACKET_MARKER` constant are gone. What remains is entirely
 * storage-agnostic and now reads from a DB column (`welcomePackets.rawHtml`)
 * instead of `readFileSync()`'s return value:
 *
 *   - `extractPacketParts()` pulls the <title>/<style>/.deck content out of
 *     one raw HTML string via anchored string operations (no HTML-parser
 *     dependency — the source content's own house rules guarantee exactly
 *     one <title>, one <style> block, and one outermost <div class="deck">).
 *   - `scopePacketStyles()` rewrites that stylesheet so it can never leak
 *     outside a scoped wrapper element:
 *       - The `@media (prefers-color-scheme: dark)` block is dropped
 *         entirely (nothing else in this codebase reacts to OS dark mode).
 *       - All `:root`-shaped selectors (bare `:root` and both
 *         `:root[data-theme="..."]` variants) are rewritten to the wrapper
 *         class in one pass.
 *       - The bare `body` selector is rewritten to the wrapper class.
 *       - `.flag` board-review annotations (open items meant for the board,
 *         not the membership) are suppressed via an appended CSS rule
 *         scoped to the wrapper class, not by stripping HTML.
 *   - `isValidLionsYear()` is new in this pass — the `/^\d{4}-\d{2}$/`
 *     format validator for `welcomePackets.lionsYear` (DECISION-041
 *     pattern: app-level format validation, no DB CHECK).
 */

export const WELCOME_PACKET_WRAPPER_CLASS = "welcome-packet-embed";

const LIONS_YEAR_RE = /^\d{4}-\d{2}$/;

/** DECISION-041 pattern — app-level format validation, no DB CHECK. */
export function isValidLionsYear(value: string): boolean {
  return LIONS_YEAR_RE.test(value);
}

/**
 * Anchored extraction — no HTML parser. Each anchor is a literal, fixed
 * structural marker the source content's own house rules already document
 * as invariant (one <title>, one <style> block, one outermost
 * <div class="deck">). The deck capture is greedy and end-anchored, which is
 * correct (not merely convenient) when <div class="deck"> is the single
 * outermost, last-closed element in the string — verified true of the real
 * content this was built against (balanced <div> count, final line a bare
 * </div>).
 *
 * Throws (does not return a sentinel) on a missing anchor — callers on the
 * write path (createWelcomePacket/updateWelcomePacket) must hard-fail a save
 * rather than accept content that will later degrade to the member-facing
 * empty state; callers on the read path (getCurrentWelcomePacket) catch this
 * and log, per that function's own contract.
 */
export function extractPacketParts(html: string): { title: string; styleCss: string; deckHtml: string } {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const deckMatch = html.match(/<div class="deck">([\s\S]*)<\/div>\s*$/);

  if (!titleMatch || !styleMatch || !deckMatch) {
    const missing = [!titleMatch && "<title>", !styleMatch && "<style>", !deckMatch && '<div class="deck">']
      .filter(Boolean)
      .join(", ");
    throw new Error(`missing expected anchor(s): ${missing}`);
  }

  return { title: titleMatch[1].trim(), styleCss: styleMatch[1], deckHtml: deckMatch[1] };
}

/**
 * Rewrites the packet's stylesheet so it can only ever affect content
 * inside `.${wrapperClass}` — drops the OS-dark-mode block, rewrites
 * `:root`-shaped selectors and the bare `body` selector to the wrapper
 * class, and appends a `.flag` suppression rule scoped to the wrapper.
 */
export function scopePacketStyles(css: string, wrapperClass: string): string {
  // 1. Drop the OS-dark-mode block entirely BEFORE the :root rewrite, so its
  //    nested :root never needs touching. Two-level brace match — safe
  //    because the block's declarations contain no nested braces (verified
  //    against the real content).
  let out = css.replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^{}]*\{[^{}]*\}[^{}]*\}/, "");

  // 2. Rewrite all :root-shaped selectors to the wrapper class in one pass
  //    — the bare :root, and the two [data-theme="..."] attribute-selector
  //    variants (which remain in the output but are inert: nothing in this
  //    render ever sets a data-theme attribute, so
  //    .welcome-packet-embed[data-theme="dark"] never matches. Leaving
  //    them scoped-but-inert is simpler and safer than special-casing
  //    their removal).
  out = out.replace(/:root\b/g, `.${wrapperClass}`);

  // 3. Rewrite the bare `body` selector. Defensive: warns instead of
  //    silently doing nothing if the stylesheet is ever reshaped to no
  //    longer have one.
  const BODY_RE = /(^|\n)(\s*)body(\s*\{)/g;
  if (!/(^|\n)\s*body\s*\{/.test(out)) {
    console.warn(
      "welcome-packets: no bare `body` selector found while scoping CSS — stylesheet shape may have changed; verify no unscoped global rule slipped through.",
    );
  } else {
    out = out.replace(BODY_RE, (_m, pre, indent, brace) => `${pre}${indent}.${wrapperClass}${brace}`);
  }

  // 4. Suppress board-review flags (CSS, not HTML — see module header comment).
  out += `\n.${wrapperClass} .flag { display: none; }\n`;

  return out;
}

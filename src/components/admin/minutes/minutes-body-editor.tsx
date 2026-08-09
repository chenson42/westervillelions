"use client";

import { useId, useState } from "react";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import RichMarkdownContent from "@/components/rich-markdown-content";

/**
 * Paste-to-Markdown discussion-body editor for meeting minutes
 * (docs/work-log/2026-08-08-meeting-minutes.md, Phase 3 "Rich content from
 * Word", DECISION-074 Ruling 1, DECISION-077 §5).
 *
 * `turndown`/`turndown-plugin-gfm` are imported ONLY from this "use client"
 * file, per DECISION-074 Ruling 1's hard rule — they use the browser's
 * DOMParser under the hood and must never reach a server action, route
 * handler, or the member-facing read side. The Word-specific pre-clean
 * (`cleanWordHtml` below) is deliberately pure string/regex transforms, NOT
 * a DOMParser walk, so it stays unit-testable in this project's Vitest
 * "node" environment without adding jsdom as a new dependency
 * (DECISION-077 §5).
 *
 * Pipeline, end to end (Phase 3 "Rich content from Word — the full
 * pipeline"):
 *   1. onPaste reads `text/html` off the clipboard. No HTML present (plain
 *      text, or a non-Word source) → default browser paste, untouched.
 *   2. cleanWordHtml() strips mso-* conditional styles / <font> tags and
 *      un-fakes Word's mso-list pseudo-bullet paragraphs into real
 *      <ul>/<ol><li> markup — turndown alone does not do this.
 *   3. turndown (+ turndown-plugin-gfm for tables) converts the cleaned
 *      HTML to Markdown, inserted into the textarea at the cursor.
 *   4. The notetaker can hand-edit the resulting Markdown directly.
 *   5. A live preview renders the current value through RichMarkdownContent
 *      so the notetaker sees exactly what a member will see before saving.
 *   6. On save, only the Markdown TEXT is persisted — there is no
 *      HTML-rendering code path for minutes content anywhere, ever.
 */

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});
turndownService.use(gfm);

// ── Word HTML pre-clean (DECISION-077 §5 — pure string transforms) ────────

/**
 * Finds the <span ...>...</span> starting at `openTagStart` (index of the
 * "<" of the opening tag) and returns the full matched substring plus the
 * index just past its closing </span>, correctly balancing any <span>s
 * nested inside it. Word nests a second span (for the tab-stop spacing
 * after a bullet/number glyph) inside its own mso-list:Ignore glyph span, so
 * a naive non-greedy regex up to the FIRST "</span>" would stop one level
 * too early. Returns null on unbalanced/malformed input rather than
 * throwing — this must never crash on odd clipboard content.
 */
function extractBalancedSpan(html: string, openTagStart: number): { text: string; end: number } | null {
  const openTagEnd = html.indexOf(">", openTagStart);
  if (openTagEnd === -1) return null;
  let depth = 1;
  const spanTagRe = /<\/?span\b[^>]*>/gi;
  spanTagRe.lastIndex = openTagEnd + 1;
  let m: RegExpExecArray | null;
  while ((m = spanTagRe.exec(html)) !== null) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) {
        return { text: html.slice(openTagStart, m.index + m[0].length), end: m.index + m[0].length };
      }
    } else {
      depth++;
    }
  }
  return null;
}

/**
 * Un-fakes Word's `mso-list` pseudo-bullets: a `<p style="...mso-list:lN
 * ...">` whose content starts with a `<span style="mso-list:Ignore">GLYPH
 * </span>` marker is really one `<li>` of a list Word never emitted as a
 * real `<ul>`/`<ol>` — this is the specific gap DECISION-074 Ruling 1
 * flagged ("turndown alone does not specifically un-fake Word's mso-list
 * pseudo-bullets"). Consecutive paragraphs sharing the same list id
 * (`mso-list:l0`, `l1`, ...) are grouped into one real list; the glyph text
 * decides ordered ("1.", "a)") vs. unordered (a bullet character) — a
 * left-to-right single scan, no DOM, no recursion.
 */
function groupMsoListParagraphs(html: string): string {
  const withMarkedItems = html.replace(
    /<p([^>]*mso-list:\s*(l\d+)[^>]*)>([\s\S]*?)<\/p>/gi,
    (_match, _attrs: string, listId: string, inner: string) => {
      const glyphStart = inner.search(/<span[^>]*mso-list:\s*Ignore[^>]*>/i);
      if (glyphStart === -1) return `<p>${inner}</p>`;
      const balanced = extractBalancedSpan(inner, glyphStart);
      if (!balanced) return `<p>${inner}</p>`;
      const glyphText = balanced.text
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .trim();
      const ordered = /^[0-9a-zA-Z]+[.)]$/.test(glyphText);
      const rest = inner.slice(balanced.end).trim();
      return `<!--MSOLI:${listId}:${ordered ? "ol" : "ul"}--><li>${rest}</li>`;
    },
  );

  const ITEM_RE = /<!--MSOLI:(l\d+):(ul|ol)-->\s*(<li>[\s\S]*?<\/li>)/g;
  let result = "";
  let lastIndex = 0;
  let openListId: string | null = null;
  let openTag: "ul" | "ol" | null = null;
  let match: RegExpExecArray | null;
  while ((match = ITEM_RE.exec(withMarkedItems)) !== null) {
    const between = withMarkedItems.slice(lastIndex, match.index);
    if (openTag && between.trim() !== "") {
      result += `</${openTag}>`;
      openListId = null;
      openTag = null;
    }
    result += between;
    const [, listId, tag, liMarkup] = match;
    if (openListId !== null && (openListId !== listId || openTag !== tag)) {
      result += `</${openTag}>`;
      openListId = null;
      openTag = null;
    }
    if (openListId === null) {
      result += `<${tag}>`;
      openListId = listId;
      openTag = tag as "ul" | "ol";
    }
    result += liMarkup;
    lastIndex = ITEM_RE.lastIndex;
  }
  if (openTag) result += `</${openTag}>`;
  result += withMarkedItems.slice(lastIndex);
  return result;
}

/**
 * Pre-cleans raw clipboard HTML from Microsoft Word before handing it to
 * `turndown`. Pure string/regex transforms only — no DOMParser — per
 * DECISION-077 §5. Safe (a no-op or near-no-op) on already-clean HTML from
 * a non-Word source; nothing here assumes Word-specific markup is present.
 */
export function cleanWordHtml(html: string): string {
  let out = html;

  // HTML comments and Word's non-standard "downlevel-revealed" conditional
  // markers (<![if ...]> / <![endif]>, not real HTML comments, but some
  // browsers preserve them verbatim on copy) carry no visible content.
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<!\[if\s+!supportLists\]>/gi, "").replace(/<!\[endif\]>/gi, "");

  // Word's mso-style-definitions <style> block and its empty-paragraph
  // placeholder tag <o:p> carry no content worth keeping.
  out = out.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<o:p[^>]*>[\s\S]*?<\/o:p>/gi, "");
  out = out.replace(/<\/?o:p[^>]*>/gi, "");

  // Un-fake Word's list pseudo-bullets BEFORE stripping the style attributes
  // this pass depends on to find them.
  out = groupMsoListParagraphs(out);

  // <font> carries no markdown-mappable semantic (turndown maps by tag
  // name, never by style/face) — unwrap, keeping inner content.
  out = out.replace(/<\/?font[^>]*>/gi, "");

  // Strip inline style/class attributes entirely — turndown never reads
  // them, and Word's mso-*/font-family/MsoListParagraphCxSp* noise only
  // bloats what's handed to it for no benefit.
  out = out.replace(/\sstyle="[^"]*"/gi, "").replace(/\sstyle='[^']*'/gi, "");
  out = out.replace(/\sclass="[^"]*"/gi, "").replace(/\sclass='[^']*'/gi, "");

  return out;
}

// ── Component ───────────────────────────────────────────────────────────

interface MinutesBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function MinutesBodyEditor({ value, onChange, disabled = false }: MinutesBodyEditorProps) {
  const [showPreview, setShowPreview] = useState(true);
  const textareaId = useId();

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const html = e.clipboardData.getData("text/html");
    if (!html) return; // plain-text (or non-Word) paste — default browser behavior

    e.preventDefault();
    const cleaned = cleanWordHtml(html);
    const markdown = turndownService.turndown(cleaned).trim();

    const target = e.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = value.slice(0, start) + markdown + value.slice(end);
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label htmlFor={textareaId} className="block text-sm font-medium text-gray-700">
          Discussion notes
        </label>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1 min-h-[32px]"
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Pasting from Word keeps headings, bold/italic, lists, links, and tables. Fonts, colors, and
        images are not preserved. You can also type Markdown directly.
      </p>
      <div className={showPreview ? "grid gap-4 sm:grid-cols-2" : ""}>
        <textarea
          id={textareaId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          disabled={disabled}
          rows={14}
          placeholder="Paste from Word, or type Markdown directly…"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 disabled:bg-gray-50"
        />
        {showPreview && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 overflow-auto max-h-[24rem]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Preview — what members will see
            </p>
            {value.trim() ? (
              <RichMarkdownContent>{value}</RichMarkdownContent>
            ) : (
              <p className="text-sm text-gray-400 italic">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

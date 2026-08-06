/**
 * Unit tests for BudgetNotesMarkdown (Budget Notes Markdown Rendering).
 *
 * Covers the two things that actually matter for this change:
 *   1. Markdown feature coverage — headings, bold/italic, bullet/numbered
 *      lists, links, and GFM tables all render as the expected HTML tags,
 *      with no raw HTML passthrough (no rehype-raw).
 *   2. Legacy-data regression guard — existing production notes are plain
 *      text: paragraphs separated by blank lines, some using a literal "•"
 *      character as a bullet prefix (NOT Markdown "-"/"*" list syntax).
 *      This must keep rendering as separate paragraphs in reading order,
 *      not get mashed into one run-on block.
 *
 * Rendered via react-dom/server's renderToStaticMarkup, which works fine in
 * vitest's default "node" environment (no jsdom needed) since it only
 * produces an HTML string — no DOM APIs involved.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BudgetNotesMarkdown from "./budget-notes-markdown";

function render(markdown: string): string {
  return renderToStaticMarkup(<BudgetNotesMarkdown>{markdown}</BudgetNotesMarkdown>);
}

describe("BudgetNotesMarkdown", () => {
  it("renders headings, bold, italic, links, and both list types", () => {
    const html = render(
      [
        "## Assumptions",
        "",
        "Dues remain **flat** vs. FY2025, per the *treasurer's* review.",
        "",
        "- Scholarship fund plans a $2,000 drawdown",
        "- See [prior year budget](https://example.org/fy2025) for reference",
        "",
        "1. Approve in August",
        "2. Publish to the board",
      ].join("\n"),
    );

    expect(html).toContain("<h4");
    expect(html).toContain("Assumptions");
    expect(html).toContain("<strong");
    expect(html).toContain("flat");
    expect(html).toContain("<em");
    expect(html).toContain("treasurer&#x27;s");
    expect(html).toMatch(/<ul[^>]*class="[^"]*list-disc/);
    expect(html).toContain("Scholarship fund plans a $2,000 drawdown");
    expect(html).toMatch(/<a[^>]*href="https:\/\/example\.org\/fy2025"/);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<ol[^>]*class="[^"]*list-decimal/);
    expect(html).toContain("Approve in August");
  });

  it("renders GFM tables as real <table> markup", () => {
    const html = render(["| Fund | FY2026 |", "| --- | --- |", "| General | $1,200 |"].join("\n"));

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Fund");
    expect(html).toContain("<td");
    expect(html).toContain("$1,200");
  });

  it("never passes through raw HTML (no rehype-raw)", () => {
    const html = render('Some text <script>alert("x")</script> and <b>bold</b> after it.');

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold</b>");
    // The literal tag text is preserved as escaped text, not executed markup.
    expect(html).toMatch(/&lt;script&gt;|&lt;b&gt;/);
  });

  it("renders legacy plain-text notes — blank-line-separated paragraphs with a literal bullet prefix — as separate paragraphs in order", () => {
    const legacyNote = [
      "Assumes dues remain flat vs. FY2025.",
      "",
      "• Scholarship fund plans a $2,000 drawdown for the new endowed award.",
      "",
      "• Community Service budget increases 10% for the food-pantry partnership.",
    ].join("\n");

    const html = render(legacyNote);

    // Three distinct <p> blocks, not one run-on paragraph.
    const paragraphMatches = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);
    expect(paragraphMatches).toHaveLength(3);
    expect(paragraphMatches[0]).toContain("Assumes dues remain flat vs. FY2025.");
    expect(paragraphMatches[1]).toContain(
      "Scholarship fund plans a $2,000 drawdown for the new endowed award.",
    );
    expect(paragraphMatches[2]).toContain(
      "Community Service budget increases 10% for the food-pantry partnership.",
    );
    // The bullet glyph survives as ordinary text (no real <ul> is created —
    // "•" isn't Markdown list syntax — but it still reads as a bulleted line).
    expect(paragraphMatches[1]).toMatch(/^•/);
    expect(paragraphMatches[2]).toMatch(/^•/);
  });
});

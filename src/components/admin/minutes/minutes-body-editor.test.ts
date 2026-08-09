/**
 * Unit tests for cleanWordHtml() — the Word-paste HTML pre-clean run before
 * handing pasted content to `turndown` (DECISION-074 Ruling 1's flagged
 * gap, DECISION-077 §5).
 *
 * Pure string-in/string-out — no DOM required, matching this project's
 * Vitest "node" environment (vitest.config.ts) and the explicit reason
 * DECISION-077 §5 chose string transforms over a DOMParser walk: adding
 * jsdom purely to unit-test one helper was rejected as a new dependency.
 *
 * Phase 3 Unit Test item 4 (docs/work-log/2026-08-08-meeting-minutes.md):
 *   1. A Word mso-list fake-bullet paragraph fixture converts to real
 *      <ul><li> markup.
 *   2. mso-* style attributes and <font>/color spans are stripped without
 *      corrupting the surrounding text.
 *   3. Plain, already-clean HTML (a paste from something other than Word)
 *      passes through unchanged.
 */

import { describe, it, expect } from "vitest";
import { cleanWordHtml } from "./minutes-body-editor";

describe("cleanWordHtml", () => {
  it("un-fakes an unordered mso-list paragraph run into real <ul><li> markup", () => {
    const wordHtml = [
      `<p class=MsoListParagraphCxSpFirst style='margin-left:.5in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>First bullet item</p>`,
      `<p class=MsoListParagraphCxSpLast style='margin-left:.5in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>&middot;<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>Second bullet item</p>`,
    ].join("");

    const cleaned = cleanWordHtml(wordHtml);

    expect(cleaned).toContain("<ul>");
    expect(cleaned).toContain("</ul>");
    expect(cleaned).not.toContain("<p");
    expect(cleaned).toMatch(/<li>First bullet item<\/li>/);
    expect(cleaned).toMatch(/<li>Second bullet item<\/li>/);
    // The glyph itself (the middot / nbsp spacing span) must not leak into
    // the item text.
    expect(cleaned).not.toContain("mso-list");
    expect(cleaned).not.toMatch(/<li>[^<]*&middot;/);
  });

  it("un-fakes a numbered mso-list paragraph run into real <ol><li> markup", () => {
    const wordHtml = [
      `<p style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Calibri"'>&nbsp;&nbsp;</span></span><![endif]>Approve prior minutes</p>`,
      `<p style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span style='font:7.0pt "Calibri"'>&nbsp;&nbsp;</span></span><![endif]>Treasurer's report</p>`,
    ].join("");

    const cleaned = cleanWordHtml(wordHtml);

    expect(cleaned).toContain("<ol>");
    expect(cleaned).toContain("</ol>");
    expect(cleaned).toMatch(/<li>Approve prior minutes<\/li>/);
    expect(cleaned).toMatch(/<li>Treasurer's report<\/li>/);
  });

  it("closes a list before a non-list paragraph and can open a second list afterward", () => {
    const wordHtml = [
      `<p style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>&middot;</span><![endif]>Item A</p>`,
      `<p>A plain, non-list paragraph in between.</p>`,
      `<p style='mso-list:l2 level1 lfo3'><![if !supportLists]><span style='mso-list:Ignore'>&middot;</span><![endif]>Item B</p>`,
    ].join("");

    const cleaned = cleanWordHtml(wordHtml);

    // Two separate lists, not one list spanning the intervening paragraph.
    expect((cleaned.match(/<ul>/g) ?? []).length).toBe(2);
    expect((cleaned.match(/<\/ul>/g) ?? []).length).toBe(2);
    expect(cleaned).toContain("A plain, non-list paragraph in between.");
  });

  it("strips mso-* style attributes and <font>/color spans without corrupting surrounding text", () => {
    const wordHtml =
      `<p class=MsoNormal style='margin:0in;font-size:11.0pt;font-family:"Calibri",sans-serif'>` +
      `<font face="Calibri" color="#1F4E79">The motion </font>` +
      `<span style='color:#C00000;mso-fareast-language:EN-US'>carried</span>` +
      ` unanimously.</p>`;

    const cleaned = cleanWordHtml(wordHtml);

    expect(cleaned).not.toContain("mso-");
    expect(cleaned).not.toContain("<font");
    expect(cleaned).not.toContain('style="');
    expect(cleaned).not.toContain("style='");
    expect(cleaned).toContain("The motion");
    expect(cleaned).toContain("carried");
    expect(cleaned).toContain("unanimously.");
  });

  it("passes plain, already-clean HTML through unchanged (a paste from a non-Word source)", () => {
    const plainHtml = "<p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>";
    expect(cleanWordHtml(plainHtml)).toBe(plainHtml);
  });
});

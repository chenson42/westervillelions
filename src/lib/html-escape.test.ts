/**
 * Unit tests for src/lib/html-escape.ts
 *
 * Covers exactly the "Required Unit Tests" named in
 * docs/work-log/2026-09-03-social-media-requests.md's Phase 3 design doc.
 */

import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/html-escape";

describe("escapeHtml", () => {
  it("escapes &, <, >, and \"", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
  });

  it("leaves plain alphanumeric/punctuation text unchanged", () => {
    const plain = "Pancake breakfast Saturday, 8-11am - come join us!";
    expect(escapeHtml(plain)).toBe(plain);
  });

  it("neutralises an injected anchor tag", () => {
    expect(escapeHtml('<a href="http://evil.example">Donate here</a>')).toBe(
      "&lt;a href=&quot;http://evil.example&quot;&gt;Donate here&lt;/a&gt;",
    );
  });

  it("is safe against a value that already contains an entity-like substring — not double-encoded within one call", () => {
    expect(escapeHtml("AT&T")).toBe("AT&amp;T");
    expect(escapeHtml("Parks &amp; Rec")).toBe("Parks &amp;amp; Rec");
  });
});

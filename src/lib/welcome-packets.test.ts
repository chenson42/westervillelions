/**
 * Unit tests for src/lib/welcome-packets.ts (renamed from
 * welcome-packet.test.ts — docs/work-log/2026-08-21-welcome-packet-live-page.md,
 * Phase 3 (Revised) "Unit tests to write").
 *
 * Carries over unchanged from the pre-rename file (source-agnostic — these
 * exercise extractPacketParts()/scopePacketStyles() against string fixtures,
 * no `dir`/filesystem involvement): cases 6-9 below.
 *
 * Dropped (tested dead code — resolveCurrentPacket, listWelcomePacketFiles,
 * findMarkedPacketFiles, and the mkdtempSync/writeFileSync fixture-file
 * scaffolding that existed only to exercise the file-resolution half, which
 * no longer exists in this module): the old cases 1-5 and the
 * beforeEach/afterEach temp-dir setup entirely.
 *
 * New: case 10, isValidLionsYear() format validation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WELCOME_PACKET_WRAPPER_CLASS, extractPacketParts, isValidLionsYear, scopePacketStyles } from "./welcome-packets";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractPacketParts", () => {
  it("case 6: extracts title/style/deck exactly, including nested divs in the deck", () => {
    const html = `<!-- header -->
<title>  Extraction Test Title  </title>
<style>
  .foo { color: red; }
</style>
<div class="deck">
  <section class="slide">
    <div class="box">
      <div class="inner">nested content</div>
    </div>
  </section>
</div>
`;

    const parts = extractPacketParts(html);

    expect(parts.title).toBe("Extraction Test Title");
    expect(parts.styleCss).toContain(".foo { color: red; }");
    expect(parts.deckHtml).toContain('<div class="box">');
    expect(parts.deckHtml).toContain('<div class="inner">nested content</div>');
    expect(parts.deckHtml).toContain("</section>");
    // The deck capture must not run past the real, single, outermost </div>.
    expect(parts.deckHtml.trim().endsWith("</section>")).toBe(true);
  });

  it("throws naming every missing anchor when title/style/deck are absent", () => {
    expect(() => extractPacketParts("<p>nothing here</p>")).toThrowError(
      /missing expected anchor\(s\): <title>, <style>, <div class="deck">/,
    );
  });
});

describe("scopePacketStyles", () => {
  const fourSelectorCss = `
:root {
  --ink: #17203A;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #E7EBF5;
  }
}
:root[data-theme="dark"] {
  --ink: #E7EBF5;
}
:root[data-theme="light"] {
  --ink: #17203A;
}
body {
  background: var(--paper);
  margin: 0;
}
`;

  it("case 7: rewrites :root-shaped selectors and body, drops the dark-mode block", () => {
    const out = scopePacketStyles(fourSelectorCss, WELCOME_PACKET_WRAPPER_CLASS);

    expect(out).not.toContain("prefers-color-scheme");
    expect(out).not.toContain("dark)");

    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS} {`);
    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS}[data-theme="dark"]`);
    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS}[data-theme="light"]`);
    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS} {\n  background: var(--paper);`);

    expect(out).not.toMatch(/(^|\n)\s*:root\b/);
    expect(out).not.toMatch(/(^|\n)\s*body\s*\{/);
  });

  it("case 8: appends a .flag suppression rule scoped to the wrapper class", () => {
    const out = scopePacketStyles(fourSelectorCss, WELCOME_PACKET_WRAPPER_CLASS);

    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS} .flag { display: none; }`);
  });

  it("case 9: warns but does not throw when no body selector is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const noBodyCss = `:root { --ink: #17203A; }\n.slide { padding: 1rem; }`;

    expect(() => scopePacketStyles(noBodyCss, WELCOME_PACKET_WRAPPER_CLASS)).not.toThrow();

    const out = scopePacketStyles(noBodyCss, WELCOME_PACKET_WRAPPER_CLASS);
    expect(warnSpy).toHaveBeenCalled();
    expect(out).toContain(`.${WELCOME_PACKET_WRAPPER_CLASS} { --ink: #17203A; }`);
  });
});

describe("isValidLionsYear", () => {
  it("case 10: accepts the YYYY-YY shape and rejects everything else", () => {
    expect(isValidLionsYear("2027-28")).toBe(true);
    expect(isValidLionsYear("2027")).toBe(false);
    expect(isValidLionsYear("27-28")).toBe(false);
    expect(isValidLionsYear("2027-2028")).toBe(false);
    expect(isValidLionsYear("")).toBe(false);
  });
});

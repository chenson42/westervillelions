/**
 * Source scans for the Slice 1 admin UI (build-failing): every page under
 * /admin/santas-workshop calls auth() then hasFeature(SANTAS_WORKSHOP_MANAGE)
 * and redirects in its OWN body (admin-page-feature-gates.test.ts only reaches
 * the top-level page.tsx); buyer and Zeffy text is never rendered as HTML; no
 * native dialogs; no console output; client components import the carrier, not
 * server modules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..", "..");
const PAGES = join(SRC, "app", "(dashboard)", "admin", "santas-workshop");
const COMPONENTS = __dirname;

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const pages = walk(PAGES).filter((f) => f.endsWith("page.tsx"));
const components = walk(COMPONENTS).filter((f) => /\.(tsx|ts)$/.test(f) && !f.endsWith(".test.ts"));
const all = [...pages, ...components];

describe("Santa's Workshop admin pages: gates", () => {
  it("finds the admin pages", () => {
    expect(pages.map((p) => p.slice(PAGES.length)).sort()).toEqual(
      ["/[sessionId]/connect/page.tsx", "/[sessionId]/edit/page.tsx", "/[sessionId]/frames/page.tsx", "/[sessionId]/page.tsx", "/[sessionId]/photos/page.tsx", "/[sessionId]/registrants/page.tsx", "/new/page.tsx", "/page.tsx"].sort(),
    );
  });

  it.each(pages.map((p) => [p.slice(PAGES.length), p]))("%s checks sign-in, then the single key, before any query", (_name, file) => {
    const src = readFileSync(file, "utf8");
    const a = src.indexOf("await auth()");
    const h = src.indexOf("hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE)");
    expect(a).toBeGreaterThan(-1);
    expect(h).toBeGreaterThan(a);
    expect(src).toMatch(/redirect\("\/access-pending"\)/);
    // The first database-reaching call comes after the gate.
    const firstQuery = src.search(/\b(getSessionOverview|listSessions|listRegistrants|listSeenQuestions|recentEvents|getSessionRow|listUnmatchedWindowAnswers|listSessionPhotos)\(/);
    if (firstQuery >= 0) expect(firstQuery).toBeGreaterThan(h);
  });
});

describe("Santa's Workshop admin UI: untrusted text and house rules", () => {
  it.each(all.map((f) => [f.slice(SRC.length), f]))("%s has no raw HTML, native dialogs or console output", (_n, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toMatch(/\binnerHTML\b/);
    expect(src).not.toMatch(/(?<!function\s)(?<![\w.])(alert|confirm|prompt)\(|\bwindow\.(alert|confirm|prompt)\(/);
    expect(src).not.toMatch(/console\.(log|info|debug|warn|error)/);
    expect(src).not.toContain("lions-red");
  });

  it("client components never import a database or server-only module", () => {
    for (const f of components.filter((c) => readFileSync(c, "utf8").startsWith('"use client"'))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "@\/lib\/db/);
      expect(src, f).not.toMatch(/from "@\/lib\/(auth|permissions-server)/);
      expect(src, f).not.toMatch(/session-queries|events-queries|server-only|node:/);
    }
  });

  it("the edit form renders no input for kind or slug, and sends only changed fields", () => {
    const src = readFileSync(join(COMPONENTS, "session-form.tsx"), "utf8");
    const edit = src.slice(src.indexOf("function EditSessionForm"));
    expect(edit).not.toMatch(/<input[^>]*(name|id)=["'{`]*(sw-)?(kind|slug)/);
    expect(edit).not.toMatch(/\b(kind|slug)\s*:/);
    expect(edit).toContain("buildSessionPatch(");
    expect(edit).toContain("Fixed once created");
  });

  it("destructive or replacing actions go through ConfirmDialog", () => {
    expect(readFileSync(join(COMPONENTS, "connect-panel.tsx"), "utf8")).toContain("<ConfirmDialog");
  });
});

describe("frame zips never carry the index (privacy)", () => {
  it("the export engine does not build or zip a CSV", () => {
    const src = readFileSync(join(COMPONENTS, "frame-export-run.ts"), "utf8");
    expect(src).not.toMatch(/index\.csv|buildIndexCsv|indexRowsFor/);
  });
});

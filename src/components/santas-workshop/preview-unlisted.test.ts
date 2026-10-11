import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Source scans: the layout imports next/font and sitemap.ts imports the database layer,
// neither of which can load under Vitest's node environment.

const ROOT = path.resolve(__dirname, "../../..");
const APP_DIR = path.join(ROOT, "src/app/santas-workshop");
const PREVIEW_DIR = path.join(APP_DIR, "preview");
const COMPONENT_DIR = path.join(ROOT, "src/components/santas-workshop");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, "utf8");
const isTest = (p: string) => /\.test\.tsx?$/.test(p);
const sourceFiles = [...walk(PREVIEW_DIR), ...walk(COMPONENT_DIR)].filter(
  (p) => /\.(ts|tsx|css)$/.test(p) && !isTest(p),
);

describe("Santa's Workshop prototype stays unlisted", () => {
  it("the preview layout is noindex/nofollow with no canonical", () => {
    const layout = read(path.join(PREVIEW_DIR, "layout.tsx"));
    expect(layout).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
    expect(layout).not.toMatch(/canonical/);
    expect(layout).not.toMatch(/alternates/);
  });

  it("no preview page overrides robots or alternates", () => {
    for (const p of walk(PREVIEW_DIR).filter((f) => /page\.tsx$/.test(f))) {
      const src = read(p);
      expect(src, p).not.toMatch(/robots/);
      expect(src, p).not.toMatch(/alternates/);
    }
  });

  it("is not in the sitemap, robots.txt, header or footer", () => {
    for (const rel of [
      "src/app/sitemap.ts",
      "src/app/robots.ts",
      "src/components/layout/header.tsx",
      "src/components/layout/footer.tsx",
    ]) {
      expect(read(path.join(ROOT, rel)), rel).not.toContain("santas-workshop");
    }
  });

  // Delete this assertion when the production page ships.
  it("does not create a page at /santas-workshop", () => {
    expect(existsSync(path.join(APP_DIR, "page.tsx"))).toBe(false);
  });

  it("imports no db, auth or email code and stores or sends nothing", () => {
    for (const p of sourceFiles) {
      const src = read(p);
      expect(src, p).not.toMatch(/@\/lib\/(db|auth|email)/);
      expect(src, p).not.toMatch(/next-auth/);
      expect(src, p).not.toMatch(/window\.(confirm|alert|prompt)|\b(?:confirm|alert|prompt)\(/);
      expect(src, p).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      expect(src, p).not.toMatch(/\bfetch\(/);
      expect(src, p).not.toMatch(/console\.log/);
    }
  });
});

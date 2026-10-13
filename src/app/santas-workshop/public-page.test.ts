import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const isCode = (f: string) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f);
// Increment 2 (B-167) adds server code (db, routes' helpers) to src/lib/santas-workshop, so
// only the modules the public page imports are held to the public-page rules.
const PUBLIC_LIB = ["clock", "facts", "format", "public-facts", "state"].map((n) => `src/lib/santas-workshop/${n}.ts`);
const PUBLIC_FILES = [
  ...walk("src/app/santas-workshop"),
  ...walk("src/components/santas-workshop"),
  ...PUBLIC_LIB,
]
  .filter(isCode)
  // The crew (worker) app is a separate, code-gated surface with its own source scans
  // (crew-app-source.test.ts); the public-page rules do not apply to it.
  .filter((f) => !f.includes(`${path.sep}crew${path.sep}`))
  // The collage grid is a token-gated surface with its own scans (collage-page-source.test.ts)
  // and is a client island (tap to open a picture), which the static page rules forbid.
  .filter((f) => !f.includes(`${path.sep}collage${path.sep}`));

// `banned.ts` is a test table of patterns, not page code.
const FORBIDDEN: [RegExp, string][] = [
  [/searchParams/, "searchParams"],
  [/\bauth\(/, "auth("],
  [/@\/lib\/db/, "@/lib/db"],
  [/sendEmail/, "sendEmail"],
  [/\bfetch\(/, "fetch("],
  [/next\/headers/, "next/headers"],
  [/\bcookies\(/, "cookies("],
  [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML"],
  [/window\.(confirm|alert|prompt)|\b(confirm|alert|prompt)\(/, "native dialogs"],
  [/console\.log/, "console.log"],
  [/["']use client["']/, "use client"],
];

describe("the public page code", () => {
  it("lists the files it scans", () => {
    expect(PUBLIC_FILES.length).toBeGreaterThan(15);
  });

  it("has no searchParams, auth, db, email, fetch, next/headers, cookies, dangerouslySetInnerHTML, native dialogs, console.log or use client", () => {
    for (const f of PUBLIC_FILES) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const [re, name] of FORBIDDEN) expect(code, `${f} uses ${name}`).not.toMatch(re);
    }
  });

  it("page.tsx is a Server Component with revalidate = 300 and a static metadata export", () => {
    const src = read("src/app/santas-workshop/page.tsx");
    expect(src).toMatch(/export const revalidate = 300;/);
    expect(src).toMatch(/export const metadata: Metadata/);
    expect(src).not.toMatch(/generateMetadata/);
  });

  it("layout.tsx sets no robots and no alternates", () => {
    const src = read("src/app/santas-workshop/layout.tsx").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/robots|alternates|metadata/i);
  });

  it("page.tsx metadata sets canonical https://westervillelions.org/santas-workshop and no robots key", () => {
    const src = read("src/app/santas-workshop/page.tsx");
    expect(src).toContain('canonical: `${SITE}/santas-workshop`');
    expect(src).toContain('const SITE = "https://westervillelions.org";');
    expect(src).not.toMatch(/robots|noindex/i);
  });

  it("the preview directory is gone and no non-test source mentions SPOT_CAP, MAX_PER_ORDER, sample-data or the Prototype banner", () => {
    expect(existsSync(path.join(ROOT, "src/app/santas-workshop/preview"))).toBe(false);
    for (const f of PUBLIC_FILES) {
      expect(read(f), f).not.toMatch(/SPOT_CAP|MAX_PER_ORDER|sample-data|Prototype/);
    }
  });

  it("sitemap.ts lists /santas-workshop exactly once and never /santas-workshop/preview or /santasworkshop", () => {
    const src = read("src/app/sitemap.ts");
    expect((src.match(/\/santas-workshop`/g) ?? []).length).toBe(1);
    expect(src).not.toContain("/santas-workshop/preview");
    expect(src).not.toContain("/santasworkshop");
  });

  it("the page reads the clock only through workshopNow", () => {
    for (const f of walk("src").filter(isCode)) {
      if (f.endsWith("lib/santas-workshop/clock.ts")) continue;
      expect(read(f), f).not.toContain("SANTAS_WORKSHOP_NOW");
    }
    expect(read("src/app/santas-workshop/page.tsx")).toContain("workshopNow(process.env, new Date())");
  });
});

/**
 * The public collage prints nothing a registrant typed. Build-failing scans plus a render
 * of the real page with the data layer stubbed to a live view.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const SRC = join(__dirname, "..", "..", "..");
const PAGE = join(SRC, "app", "santas-workshop", "c", "[token]", "page.tsx");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const files = [PAGE, ...readdirSync(__dirname).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts")).map((f) => join(__dirname, f))];

const view = vi.hoisted(() => ({
  current: { state: "live", practice: false, arrivesOn: null, tiles: [] } as import("@/lib/santas-workshop/collage-contract").CollageView | null,
}));
vi.mock("@/lib/santas-workshop/collage-queries", () => ({ getCollage: async () => view.current }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

async function render(): Promise<string> {
  const { default: Page } = await import("../../../app/santas-workshop/c/[token]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: "A".repeat(22) }) }));
}

describe("collage page source", () => {
  it("reads no registrant column, takes no search params, logs nothing, uses no native dialog or raw HTML", () => {
    for (const f of files) {
      const code = strip(readFileSync(f, "utf8"));
      expect(code, f).not.toMatch(/stuffyName|careNote|noteToSanta|childFirstName|parentFirstName|parentLastName|buyer|snack|\.name\b|storageKey|searchParams/);
      expect(code, f).not.toMatch(/dangerouslySetInnerHTML|console\.|window\.(alert|confirm|prompt)|lions-red/);
      expect(code, f).not.toMatch(/@\/lib\/db|auth\(/);
    }
  });
  it("is noindex, dynamic, and notFound for an unknown token", () => {
    const code = readFileSync(PAGE, "utf8");
    expect(code).toContain('export const dynamic = "force-dynamic"');
    expect(code).toMatch(/robots: \{ index: false, follow: false/);
    expect(code).toMatch(/if \(!view\) notFound\(\)/);
  });
});

describe("collage page render", () => {
  it("live: groups first, then portraits, only alt text and fixed copy, no registrant text", async () => {
    view.current = {
      state: "live",
      practice: false,
      arrivesOn: null,
      tiles: [
        { id: "a1111111-1111-4111-8111-111111111111", kind: "group" },
        { id: "b2222222-2222-4222-8222-222222222222", kind: "portrait" },
      ],
    };
    const html = await render();
    expect(html.indexOf("Group pictures")).toBeGreaterThan(-1);
    expect(html.indexOf("Group pictures")).toBeLessThan(html.indexOf("Stuffy portraits"));
    expect(html).toContain("/api/santas-workshop/photos/a1111111-1111-4111-8111-111111111111?v=thumb");
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/width="\d+" height="\d+"/);
    expect(html).toContain("We photograph stuffies only, never children.");
    expect(html).toContain("Changed your mind, or see someone who should not be in a picture? Email");
    expect(html).toContain('href="mailto:info@westervillelions.org"');
    expect(html).toContain("and we will take it down.");
    expect(html).toContain('href="/connect"');
    // Visible text is exactly the fixed copy plus ordinal alt text.
    const text = html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text.replace("info@westervillelions.org", "")).not.toMatch(/Bella|Pip|@|\d{3}-\d{4}/);
  });
  it("pending shows the photo day; removed shows the removal sentence; neither lists a photo", async () => {
    view.current = { state: "pending", practice: true, arrivesOn: "2026-12-19", tiles: [] };
    let html = await render();
    expect(html).toContain("The photos arrive on Saturday, Dec 19");
    expect(html).toContain("PRACTICE");
    // A photo day that has passed is never printed as a date.
    view.current = { state: "pending", practice: false, arrivesOn: "2020-01-04", tiles: [] };
    expect(await render()).toContain("The photos are being prepared");
    view.current = { state: "pending", practice: true, arrivesOn: "2026-12-19", tiles: [] };
    expect(html).not.toContain("/api/santas-workshop/photos/");
    view.current = { state: "removed", practice: false, arrivesOn: null, tiles: [] };
    html = await render();
    expect(html).toContain("These photos have been removed");
    expect(html).not.toContain("/api/santas-workshop/photos/");
  });
  it("an unknown token is a 404", async () => {
    view.current = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

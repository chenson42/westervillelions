/** The storybook is a second page over the same approved collage view (R7, T5). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { bookAvailable, bookPages } from "@/lib/santas-workshop/book-model";
import type { CollageView } from "@/lib/santas-workshop/collage-contract";

const SRC = join(__dirname, "..", "..", "..");
const BOOK = join(SRC, "app", "santas-workshop", "c", "[token]", "book", "page.tsx");
const COLLAGE = join(SRC, "app", "santas-workshop", "c", "[token]", "page.tsx");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const view = vi.hoisted(() => ({ current: null as CollageView | null }));
vi.mock("@/lib/santas-workshop/collage-queries", () => ({ getCollage: async () => view.current }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const T = (c: string, kind: "group" | "portrait" = "group") => ({ id: `${c}${c}${c}${c}${c}${c}${c}${c}-1111-4111-8111-111111111111`, kind });
const TOKEN = "A".repeat(22);
async function render(): Promise<string> {
  const { default: Page } = await import("../../../app/santas-workshop/c/[token]/book/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: TOKEN }) }));
}
const base = { practice: false, arrivesOn: null, tiles: [] };

describe("book page source", () => {
  const code = strip(readFileSync(BOOK, "utf8"));
  it("imports only the collage view and UI/copy modules", () => {
    expect(code).not.toMatch(/@\/lib\/db|photo-access|photo-store|auth\(|searchParams/);
    expect(code).toContain('from "@/lib/santas-workshop/collage-queries"');
    expect(code).not.toMatch(/view\.tiles|check_in|\.name\b|stuffyName|dangerouslySetInnerHTML|console\.|window\.(alert|confirm|prompt)/);
    expect(code).not.toMatch(/"portrait"\s*[,)]\s*\}?|kind="portrait"/);
  });
  it("is noindex, no-referrer, dynamic, and 404s an unknown token", () => {
    const raw = readFileSync(BOOK, "utf8");
    expect(raw).toContain('export const dynamic = "force-dynamic"');
    expect(raw).toMatch(/robots: \{ index: false, follow: false/);
    expect(raw).toContain('referrer: "no-referrer"');
    expect(raw).toMatch(/if \(!view\) notFound\(\)/);
    expect(raw).toContain("bookAvailable(view)");
    expect(raw).toContain("redirect(");
  });
  it("is not in the sitemap or robots, and the global @page rule is untouched", () => {
    for (const f of ["app/sitemap.ts", "app/robots.ts"]) expect(readFileSync(join(SRC, f), "utf8")).not.toMatch(/book|santas-workshop\/c/);
    expect(readFileSync(join(SRC, "app", "santas-workshop", "santas-workshop.css"), "utf8")).toMatch(/@page\s*\{\s*margin: 12mm;\s*\}/);
  });
  it("uses the full variant, ordinal alt text and a print-hidden control", () => {
    expect(code).toContain('collagePhotoPath(id, "full")');
    expect(code).toContain("publicTileAlt");
    expect(readFileSync(join(__dirname, "book-print-button.tsx"), "utf8")).toContain("sw-noprint");
  });
  it("the collage links to the book only inside the live branch with scenes", () => {
    const c = readFileSync(COLLAGE, "utf8");
    const live = c.indexOf('view.state === "live"');
    const at = c.indexOf("/book`");
    expect(live).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(live);
    expect(c.slice(live, at)).toContain("view.scenes.length > 0");
  });
});

describe("book page model", () => {
  it("is available only when live with a scene", () => {
    expect(bookAvailable({ state: "live", scenes: [{ title: "a", caption: null, tiles: [T("a")] }] })).toBe(true);
    expect(bookAvailable({ state: "live", scenes: [] })).toBe(false);
    expect(bookAvailable({ state: "pending", scenes: [{ title: "a", caption: null, tiles: [T("a")] }] })).toBe(false);
  });
  it("keeps scene order, group pictures only, and runs ordinals on", () => {
    const pages = bookPages([
      { title: "One", caption: "c", tiles: [T("a"), T("b", "portrait"), T("c")] },
      { title: "Empty", caption: null, tiles: [T("d", "portrait")] },
      { title: "Two", caption: null, tiles: [T("e")] },
    ]);
    expect(pages.map((p) => [p.title, p.photoIds.length, p.startIndex])).toEqual([["One", 2, 0], ["Two", 1, 2]]);
  });
});

describe("book page render", () => {
  it("live with scenes: cover, scene pages, no portraits, no other pictures", async () => {
    view.current = {
      ...base,
      state: "live",
      scenes: [
        { title: "The Sleigh Arrives", caption: "Santa pulls in.", tiles: [T("a"), T("b")] },
        { title: "Cocoa Time", caption: null, tiles: [T("c")] },
      ],
      tiles: [T("d"), T("e", "portrait")],
    };
    const html = await render();
    expect(html.indexOf("Santa&#x27;s Workshop photos")).toBeLessThan(html.indexOf("The Sleigh Arrives"));
    expect(html.indexOf("The Sleigh Arrives")).toBeLessThan(html.indexOf("Cocoa Time"));
    expect(html).toContain("?v=full");
    expect(html).not.toContain("?v=thumb");
    expect(html).not.toContain("dddddddd-1111");
    expect(html).not.toContain("eeeeeeee-1111");
    expect(html).not.toContain("Other pictures");
    expect(html).toContain("A copy you save stays on your device.");
    expect([...html.matchAll(/alt="(Group picture \d+)"/g)].map((m) => m[1])).toEqual(["Group picture 1", "Group picture 2", "Group picture 3"]);
    expect(html).not.toContain(TOKEN.repeat(2));
    expect(html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")).not.toContain("/santas-workshop/c/");
  });
  it("non-live or no scenes redirects to the collage and prints no scene text; unknown token is 404", async () => {
    const scenes = [{ title: "Secret Scene", caption: "Secret", tiles: [T("a")] }];
    for (const v of [{ ...base, state: "pending" as const, scenes }, { ...base, state: "removed" as const, scenes }, { ...base, state: "live" as const, scenes: [] }]) {
      view.current = v;
      await expect(render()).rejects.toThrow(`REDIRECT:/santas-workshop/c/${TOKEN}`);
    }
    view.current = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

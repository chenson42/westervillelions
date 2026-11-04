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
  current: { state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [] } as import("@/lib/santas-workshop/collage-contract").CollageView | null,
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
      scenes: [],
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
    view.current = { state: "pending", practice: true, arrivesOn: "2026-12-19", scenes: [], tiles: [] };
    let html = await render();
    expect(html).toContain("The photos arrive on Saturday, Dec 19");
    expect(html).toContain("PRACTICE");
    // A photo day that has passed is never printed as a date.
    view.current = { state: "pending", practice: false, arrivesOn: "2020-01-04", scenes: [], tiles: [] };
    expect(await render()).toContain("The photos are being prepared");
    view.current = { state: "pending", practice: true, arrivesOn: "2026-12-19", scenes: [], tiles: [] };
    expect(html).not.toContain("/api/santas-workshop/photos/");
    view.current = { state: "removed", practice: false, arrivesOn: null, scenes: [], tiles: [] };
    html = await render();
    expect(html).toContain("These photos have been removed");
    expect(html).not.toContain("/api/santas-workshop/photos/");
  });
  it("an unknown token is a 404", async () => {
    view.current = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("collage page storyline", () => {
  const T = (c: string) => ({ id: `${c}${c}${c}${c}${c}${c}${c}${c}-1111-4111-8111-111111111111`, kind: "group" as const });
  const plain = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("live with scenes: scene headings and captions in order, then Other pictures, then portraits", async () => {
    view.current = {
      state: "live",
      practice: false,
      arrivesOn: null,
      scenes: [
        { title: "The Sleigh Arrives", caption: "Santa pulls in.", tiles: [T("a"), T("b")] },
        { title: "Cocoa Time", caption: null, tiles: [T("c")] },
      ],
      tiles: [T("d"), { id: "e5555555-5555-4555-8555-555555555555", kind: "portrait" }],
    };
    const html = await render();
    const order = ["The Sleigh Arrives", "Santa pulls in.", "Cocoa Time", "Other pictures", "Stuffy portraits"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain("Group pictures");
    expect(html.match(/data-testid="collage-scene"/g)?.length).toBe(2);
    expect(html).toContain('data-testid="collage-group"');
    // A null caption renders no paragraph for that scene.
    expect(html.match(/<p class="text-gray-700">/g)?.length).toBe(1);
    // Ordinal alt text runs on through the sections, so it is unique.
    const alts = [...html.matchAll(/alt="(Group picture \d+)"/g)].map((m) => m[1]);
    expect(alts).toEqual(["Group picture 1", "Group picture 2", "Group picture 3", "Group picture 4"]);
    expect(new Set(alts).size).toBe(alts.length);
  });
  it("scene text is only ever a text node: never in alt, title or aria-label", async () => {
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [{ title: "Zebra Parade", caption: "Quietly marching", tiles: [T("a")] }], tiles: [] };
    const html = await render();
    expect(html).toContain("Zebra Parade");
    for (const attr of html.match(/\s(alt|title|aria-label)="[^"]*"/g) ?? []) expect(attr).not.toMatch(/Zebra|marching/);
    // The section is labelled by its heading id, not by the text.
    expect(html).toContain('aria-labelledby="scene-0-heading"');
    const pageSrc = readFileSync(PAGE, "utf8");
    expect(pageSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it("links to the storybook only when live with scenes", async () => {
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [{ title: "S", caption: null, tiles: [T("a")] }], tiles: [] };
    expect(await render()).toContain(`/book"`);
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [T("a")] };
    expect(await render()).not.toContain("Download the storybook");
    view.current = { state: "pending", practice: false, arrivesOn: "2099-12-19", scenes: [{ title: "S", caption: null, tiles: [T("a")] }], tiles: [] };
    expect(await render()).not.toContain("Download the storybook");
  });
  it("zero scenes is today's page: 'Group pictures', collage-group, no scene markup", async () => {
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [T("a"), { id: "b2222222-2222-4222-8222-222222222222", kind: "portrait" }] };
    const html = await render();
    expect(html).toContain("Group pictures");
    expect(html).toContain('data-testid="collage-group"');
    expect(html).not.toContain("collage-scene");
    expect(html).not.toContain("Other pictures");
    expect(html).not.toContain("scene-0-heading");
    expect(html).toContain('alt="Group picture 1"');
  });
  it("the empty-live message shows only with no scenes and no tiles", async () => {
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [] };
    expect(plain(await render())).toContain("No photos have been added yet");
    view.current = { state: "live", practice: false, arrivesOn: null, scenes: [{ title: "Only Scene", caption: null, tiles: [T("a")] }], tiles: [] };
    expect(plain(await render())).not.toContain("No photos have been added yet");
  });
  it("pending and removed print no scene text even if a scene were passed", async () => {
    const scenes = [{ title: "Secret Scene Title", caption: "Secret caption", tiles: [T("a")] }];
    view.current = { state: "pending", practice: false, arrivesOn: "2099-12-19", scenes, tiles: [] };
    expect(await render()).not.toContain("Secret");
    view.current = { state: "removed", practice: false, arrivesOn: null, scenes, tiles: [] };
    expect(await render()).not.toContain("Secret");
  });
});

describe("collage page art", () => {
  it("dresses every state with decorative, print-hidden art and leaves the site chrome hidden", async () => {
    for (const v of [
      { state: "pending", practice: false, arrivesOn: "2099-12-19", scenes: [], tiles: [] },
      { state: "removed", practice: false, arrivesOn: null, scenes: [], tiles: [] },
      { state: "live", practice: false, arrivesOn: null, scenes: [], tiles: [] },
    ] as const) {
      view.current = { ...v, scenes: [], tiles: [] };
      const html = await render();
      expect(html).toContain("/_next/image?url=%2Fimages%2Fsantas-workshop%2Ftrain.png");
      expect(html).toContain("sw-noprint");
      // Every image from the art registry is decorative: empty alt, never a described picture.
      const artImgs = html.match(/<img[^>]+santas-workshop%2F[^>]*>/g) ?? [];
      expect(artImgs.length).toBeGreaterThan(1);
      for (const img of artImgs) expect(img).toContain('alt=""');
    }
  });
});

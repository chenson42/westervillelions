/**
 * The family page prints nothing a registrant typed except the stuffy's own name.
 * Renders the real page with the data layer stubbed, one view per state.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FamilyView } from "@/lib/santas-workshop/family-contract";

const TOKEN = "B".repeat(22);
const view = vi.hoisted(() => ({ current: null as FamilyView | null }));
vi.mock("@/lib/santas-workshop/family-queries", () => ({ getFamilyView: async () => view.current }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const live: FamilyView = {
  collage: "live",
  practice: false,
  stuffyName: "Biscuit",
  arrivesOn: null,
  portrait: { state: "available", version: "photo-1" },
  collagePath: "/santas-workshop/c/" + "C".repeat(22),
};

async function render(): Promise<string> {
  const { default: Page } = await import("../../../app/santas-workshop/f/[token]/page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token: TOKEN }) }));
}

describe("family page render", () => {
  it("live: name, portrait through the family door, the fixed lines and the collage link", async () => {
    view.current = live;
    const html = await render();
    expect(html).toContain("Biscuit");
    expect(html).toContain(`/api/santas-workshop/family/${TOKEN}/portrait?v=full&amp;p=photo-1`);
    expect(html).toContain("We photograph stuffies only, never children.");
    expect(html).toContain("info@westervillelions.org");
    expect(html).toContain("See the whole day&#x27;s photos");
    expect(html).toContain(`href="/santas-workshop/c/${"C".repeat(22)}"`);
  });

  it("the token is not printed as visible text", async () => {
    view.current = live;
    const html = await render();
    const text = html.replace(/<[^>]*>/g, " ");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("C".repeat(22));
  });

  it("pending: on its way, the photo day, no collage link, no image", async () => {
    view.current = { ...live, collage: "pending", arrivesOn: "2099-12-19", portrait: { state: "none" }, collagePath: null };
    const html = await render();
    expect(html).toContain("Your stuffy&#x27;s portrait is on its way");
    expect(html).toContain("The photos arrive on");
    expect(html).not.toContain("/santas-workshop/c/");
    expect(html).not.toContain("/portrait?");
  });

  it("pending with a portrait: the image shows, no collage link", async () => {
    view.current = { ...live, collage: "pending", arrivesOn: "2099-12-19", collagePath: null };
    const html = await render();
    expect(html).toContain(`/api/santas-workshop/family/${TOKEN}/portrait?v=full`);
    expect(html).toContain("The photos arrive on");
    expect(html).not.toContain("/santas-workshop/c/");
  });

  it("removed: the friendly line and nothing else", async () => {
    view.current = { ...live, collage: "removed", portrait: { state: "none" }, collagePath: null };
    const html = await render();
    expect(html).toContain("These photos have been removed");
    expect(html).not.toContain("/portrait?");
    expect(html).not.toContain("/santas-workshop/c/");
  });

  it("practice shows the banner", async () => {
    view.current = { ...live, practice: true };
    expect(await render()).toContain("PRACTICE page");
  });

  it("an unknown token is notFound", async () => {
    view.current = null;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

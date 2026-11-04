import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCENE_EDITOR_WARNING } from "@/lib/santas-workshop/scene-contract";

const card = readFileSync(join(__dirname, "scenes-card.tsx"), "utf8");
const page = readFileSync(join(__dirname, "..", "..", "..", "app", "(dashboard)", "admin", "santas-workshop", "[sessionId]", "page.tsx"), "utf8");

describe("scenes card", () => {
  it("delete goes through a destructive ConfirmDialog that names the photo count and Other pictures", () => {
    expect(card).toContain("<ConfirmDialog");
    expect(card).toMatch(/destructive\b/);
    expect(card).toContain("deleteTarget.photoCount");
    expect(card).toContain("Other pictures");
    expect(card).not.toMatch(/window\.(confirm|alert|prompt)|(?<![\w.])(confirm|alert|prompt)\(/);
  });
  it("renders the required public-text warning from the contract, never a copy of it", () => {
    expect(card).toContain("{SCENE_EDITOR_WARNING}");
    expect(SCENE_EDITOR_WARNING).toBe("This text is public. Do not use the names of children, families or stuffies.");
  });
  it("shows inline field errors for the title and the caption", () => {
    expect(card).toContain("scene-title-error");
    expect(card).toContain("scene-caption-error");
    expect(card).toContain('f.code === "invalid_input"');
  });
  it("reorders with up and down buttons that meet the 44px target, refetching on scenes_changed", () => {
    expect(card).toContain("min-w-[44px]");
    expect(card).toContain("Move ${s.title} up");
    expect(card).toContain("Move ${s.title} down");
    expect(card).toContain('"scenes_changed"');
    expect(card).toContain("BTN_SMALL");
  });
  it("follows the house style: rounded-2xl cards, rounded-lg buttons, an empty state, no lions-red", () => {
    expect(card).toContain("EMPTY");
    expect(card).toContain("No scenes yet.");
    expect(card).not.toContain("lions-red");
    expect(card).not.toContain("rounded-full");
    expect(card).not.toContain("dangerouslySetInnerHTML");
  });
  it("is rendered by the session page from the server-side list", () => {
    expect(page).toContain("<ScenesCard");
    expect(page).toContain("listAdminScenes(sessionId)");
  });
});

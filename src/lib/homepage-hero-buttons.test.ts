import { describe, it, expect } from "vitest";
import { heroAnnouncementButtons, MAX_ANNOUNCEMENT_BUTTONS } from "./homepage-hero-buttons";

const row = (id: string, title: string, linkUrl: string | null, linkLabel: string | null = null) => ({
  id,
  title,
  linkUrl,
  linkLabel,
});

describe("heroAnnouncementButtons", () => {
  it("uses the link label, falling back to the title", () => {
    expect(
      heroAnnouncementButtons([
        row("a", "Santa's Workshop - Sign Up Now", "/santas-workshop", ""),
        row("b", "White Cane 2026", "/white-cane", "Give to the White Cane Campaign"),
      ]).map((b) => b.label),
    ).toEqual(["Santa's Workshop - Sign Up Now", "Give to the White Cane Campaign"]);
  });

  it("skips announcements with no link", () => {
    expect(heroAnnouncementButtons([row("a", "No link", null), row("b", "Blank", "  ")])).toEqual([]);
  });

  it("keeps the given order and caps the count", () => {
    const rows = ["a", "b", "c", "d"].map((id) => row(id, id, `/${id}`));
    const ids = heroAnnouncementButtons(rows).map((b) => b.id);
    expect(ids).toEqual(["a", "b"].slice(0, MAX_ANNOUNCEMENT_BUTTONS));
  });

  it("marks only absolute http(s) links external", () => {
    const [internal, external] = heroAnnouncementButtons([
      row("a", "a", "/santas-workshop"),
      row("b", "b", "https://www.zeffy.com/x"),
    ]);
    expect(internal.external).toBe(false);
    expect(external.external).toBe(true);
  });
});

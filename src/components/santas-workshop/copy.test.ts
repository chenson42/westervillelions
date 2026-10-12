import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import { workshopCopy } from "./copy";
import { bannedHits } from "./banned";
import { WORKSHOP_2026 } from "@/lib/santas-workshop/facts";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe("copy.ts", () => {
  const all = [
    ...strings(Object.values(copy).filter((v) => typeof v !== "function")),
    ...strings(workshopCopy(WORKSHOP_2026)),
    ...strings(WORKSHOP_2026),
  ];

  it("walks a non-trivial number of strings", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("no exported copy string contains a banned pattern", () => {
    for (const s of all) expect(bannedHits(s), s).toEqual([]);
  });

  it('the promise is exactly "We photograph stuffies only, never the children."', () => {
    expect(copy.PROMISE).toBe("We photograph stuffies only, never the children.");
  });

  it("the photo box label and helper are exactly the decided wording and the helper names group pictures", () => {
    expect(copy.PHOTO_BOX_LABEL).toBe(
      "Yes, you may show my stuffy's portrait in the public photo collage. Anyone with the collage link can see it. The collage shows stuffies, never children, and never a child's name.",
    );
    expect(copy.PHOTO_BOX_HELPER).toBe(
      "If you leave this unchecked, your stuffy's portrait goes only on your own printed frame. Your stuffy may still appear in group pictures with other stuffies.",
    );
    expect(copy.PHOTO_BOX_HELPER).toMatch(/group pictures/);
  });

  it("the snack sentence has the no-guarantee line and no allergy wording", () => {
    expect(copy.SNACK).toContain("This is a preference, not a medical request, and we cannot promise that any snack is free of allergens.");
    expect(copy.SNACK).not.toMatch(/allergy|allergies|allergen-free/i);
  });

  it('SIGNUP_FRAME_TITLE is "Sign-up form for A Visit to Santa\'s Workshop, powered by Zeffy" and does not contain "donation"', () => {
    expect(copy.SIGNUP_FRAME_TITLE).toBe("Sign-up form for A Visit to Santa's Workshop, powered by Zeffy");
    expect(copy.SIGNUP_FRAME_TITLE.toLowerCase()).not.toContain("donation");
  });

  it("the tip note says optional tip and $0 and never gift or donation", () => {
    expect(copy.ZEFFY_TIP_NOTE).toMatch(/optional tip/);
    expect(copy.ZEFFY_TIP_NOTE).toMatch(/\$0/);
    expect(copy.ZEFFY_TIP_NOTE).not.toMatch(/gift|donat/i);
  });

  it("the removal sentence is present verbatim", () => {
    expect(copy.REMOVAL_SENTENCE).toBe("Changed your mind? Contact the club and we will take it down.");
  });

  it("the metadata strings are state-independent: no opens/closed wording and only the event days as dates", () => {
    const meta = workshopCopy(WORKSHOP_2026).meta;
    const text = Object.values(meta).join(" ");
    expect(text).not.toMatch(/opens|closed|registration|sign-?ups?|before|after/i);
    const dates = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/g) ?? [];
    expect(dates.sort()).toEqual(["Dec 18", "Dec 20"]);
    expect(meta.description).toContain("$15 per stuffy");
  });

  it("derives the weekend text from the facts", () => {
    const c = workshopCopy(WORKSHOP_2026);
    expect(c.dateRange).toBe("Dec 18 to 20");
    expect(c.hero.statusBefore).toBe("Registration opens Sunday, Nov 8");
    expect(c.signup.closeLine).toBe("Sign-ups close Wednesday, Dec 16.");
  });
});

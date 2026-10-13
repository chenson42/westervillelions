import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FamilyView } from "./family-contract";
import { FAMILY_COPY, familyModel } from "./family-ui";

const base: FamilyView = { collage: "live", practice: false, stuffyName: "Biscuit", arrivesOn: null, portrait: { state: "none" }, collagePath: "/santas-workshop/c/AAAAAAAAAAAAAAAAAAAAAA" };

describe("familyModel", () => {
  it("shows the portrait and the collage link when live", () => {
    const m = familyModel({ ...base, portrait: { state: "available", version: "p1" } }, "2026-12-19");
    expect(m.heading).toBe("Biscuit");
    expect(m.block).toEqual({ kind: "portrait", version: "p1" });
    expect(m.collage).toEqual({ kind: "link", path: base.collagePath });
  });

  it("says the portrait is on its way when none exists, and still links the collage", () => {
    const m = familyModel(base, "2026-12-19");
    expect(m.block).toMatchObject({ kind: "message", headline: "Your stuffy's portrait is on its way" });
    expect(m.collage.kind).toBe("link");
  });

  it("says the photo isn't available when it is withheld", () => {
    const m = familyModel({ ...base, portrait: { state: "unavailable" } }, "2026-12-19");
    expect(m.block).toMatchObject({ kind: "message", headline: "This photo isn't available" });
  });

  it("pending with a portrait: the portrait shows, the collage link waits (S5-D1)", () => {
    const m = familyModel({ ...base, collage: "pending", arrivesOn: "2026-12-19", collagePath: null, portrait: { state: "available", version: "p9" } }, "2026-12-19");
    expect(m.block).toEqual({ kind: "portrait", version: "p9" });
    expect(m.collage).toMatchObject({ kind: "note", headline: "The photos arrive on Saturday, Dec 19" });
  });

  it("pending without a portrait: on its way, plus the photo day", () => {
    const m = familyModel({ ...base, collage: "pending", arrivesOn: "2026-12-19", collagePath: null }, "2026-12-10");
    expect(m.block).toMatchObject({ kind: "message", headline: "Your stuffy's portrait is on its way" });
  });

  it("pending: no link, the photo day, then 'being prepared' once it has passed", () => {
    const pending: FamilyView = { ...base, collage: "pending", arrivesOn: "2026-12-19", collagePath: null };
    const before = familyModel(pending, "2026-12-10");
    expect(before.collage).toMatchObject({ kind: "note", headline: "The photos arrive on Saturday, Dec 19" });
    const after = familyModel(pending, "2026-12-21");
    expect(after.collage).toMatchObject({ kind: "note", headline: "The photos are being prepared" });
    expect(JSON.stringify(before)).not.toContain("/santas-workshop/c/");
  });

  it("removed: the friendly line, no link", () => {
    const m = familyModel({ ...base, collage: "removed", collagePath: null }, "2027-02-01");
    expect(m.block).toMatchObject({ kind: "message", headline: "These photos have been removed" });
    expect(m.collage).toEqual({ kind: "none" });
  });

  it("falls back to a neutral heading without a name", () => {
    expect(familyModel({ ...base, stuffyName: null }, "2026-12-19").heading).toBe("Your stuffy");
    expect(familyModel({ ...base, stuffyName: "  " }, "2026-12-19").heading).toBe("Your stuffy");
  });

  it("the only registrant text in the model is the stuffy name", () => {
    const m = familyModel({ ...base, stuffyName: "ZZNAMEZZ" }, "2026-12-19");
    const json = JSON.stringify(m).replaceAll("ZZNAMEZZ", "");
    expect(json).not.toContain("ZZNAMEZZ");
    expect(Object.values(FAMILY_COPY).join(" ")).not.toMatch(/@|\d{3}-\d{4}/);
  });
});

describe("family page source", () => {
  const src = readFileSync(join(process.cwd(), "src/app/santas-workshop/f/[token]/page.tsx"), "utf8");
  it("is dynamic, noindex, a plain 404 for no view, and reads only the family view", () => {
    expect(src).toContain('export const dynamic = "force-dynamic"');
    expect(src).toContain("index: false, follow: false");
    expect(src).toContain("if (!view) notFound()");
    expect(src).toContain("getFamilyView(token)");
    expect(src).not.toMatch(/buyer|parent|careNote|noteToSanta|searchParams|dangerouslySetInnerHTML|console\./);
  });
  it("prints the token only through the QR, never as visible text", () => {
    expect(src).not.toContain("{token}");
    expect(src).toContain("FamilyPrintQr");
  });
  it("keeps the print fixes in the shared rules (S3-N6 / B-183)", () => {
    const css = readFileSync(join(process.cwd(), "src/app/santas-workshop/santas-workshop.css"), "utf8");
    expect(css).toMatch(/break-after:\s*avoid/);
    const collage = readFileSync(join(process.cwd(), "src/app/santas-workshop/c/[token]/page.tsx"), "utf8");
    expect(collage).toContain("print:bg-none");
    expect(src).toContain("print:bg-none");
  });
});

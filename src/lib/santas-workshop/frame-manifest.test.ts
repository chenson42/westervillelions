import { describe, expect, it } from "vitest";
import { buildFrameEntries, exportStatusOf, planFrameNumbers, type FrameStuffyRow } from "./frame-manifest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const photo = (n: number, hidden = false) => ({ id: `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`, hidden });

function row(n: number, over: Partial<FrameStuffyRow> = {}): FrameStuffyRow {
  return {
    stuffyId: id(n),
    name: `Bear ${n}`,
    parentFirst: "Pat",
    parentLast: "Example",
    windowLabel: "9 AM",
    consent: true,
    frameNumber: null,
    exportedPhotoId: null,
    portrait: photo(n),
    ...over,
  };
}

describe("planFrameNumbers", () => {
  it("numbers alphabetically by parent last name, stuffy name, id", () => {
    const rows = [
      row(1, { parentLast: "Zed", name: "A" }),
      row(2, { parentLast: "adams", name: "B" }),
      row(3, { parentLast: "Adams", name: "A" }),
      row(5, { parentLast: "Adams", name: "A" }),
    ];
    const plan = planFrameNumbers(rows, 0);
    expect(plan.map((p) => p.stuffyId)).toEqual([id(3), id(5), id(2), id(1)]);
    expect(plan.map((p) => p.frameNumber)).toEqual([1, 2, 3, 4]);
  });

  it("is stable: re-running after numbers exist plans nothing and never renumbers", () => {
    const first = planFrameNumbers([row(1), row(2)], 0);
    const numbered = [row(1, { frameNumber: first[0].frameNumber }), row(2, { frameNumber: first[1].frameNumber })];
    expect(planFrameNumbers(numbered, 2)).toEqual([]);
  });

  it("gives a late portrait max + 1, even when its name sorts first", () => {
    const rows = [row(1, { frameNumber: 1, parentLast: "Mills" }), row(2, { frameNumber: 2, parentLast: "Young" }), row(3, { parentLast: "Aaron" })];
    expect(planFrameNumbers(rows, 2)).toEqual([{ stuffyId: id(3), frameNumber: 3 }]);
  });

  it("continues after a number held by a stuffy that is no longer listed (withdrawn)", () => {
    expect(planFrameNumbers([row(1)], 7)).toEqual([{ stuffyId: id(1), frameNumber: 8 }]);
  });

  it("gives no number to a hidden portrait or a stuffy without a portrait", () => {
    const rows = [row(1, { portrait: photo(1, true) }), row(2, { portrait: null }), row(3)];
    expect(planFrameNumbers(rows, 0)).toEqual([{ stuffyId: id(3), frameNumber: 1 }]);
  });

  it("includes opted-out (no consent) stuffies", () => {
    expect(planFrameNumbers([row(1, { consent: false })], 0)).toHaveLength(1);
  });

  it("keeps a retaken stuffy's number (a number is never reassigned)", () => {
    expect(planFrameNumbers([row(1, { frameNumber: 4, portrait: photo(99) })], 4)).toEqual([]);
  });
});

describe("buildFrameEntries", () => {
  const rows = [
    row(1, { frameNumber: 2, name: "Zebra" }),
    row(2, { frameNumber: 1, name: "Ant", consent: false }),
    row(3, { portrait: photo(3, true), frameNumber: null }),
    row(4, { portrait: null }),
  ];
  const built = buildFrameEntries(rows, "ssw-test");

  it("lists exportable portraits in frame-number order, opted-out included", () => {
    expect(built.items.map((i) => i.frameNumber)).toEqual([1, 2]);
    expect(built.items[0]).toMatchObject({ name: "Ant", consent: false, fileName: "ssw-test-001.jpg", photoUrl: `/api/santas-workshop/photos/${photo(2).id}?v=full` });
  });

  it("withholds a hidden portrait and lists a stuffy with no portrait, with reasons", () => {
    expect(built.items.some((i) => i.stuffyId === id(3))).toBe(false);
    expect(built.withheld.map((w) => [w.stuffyId, w.reason]).sort()).toEqual([[id(3), "hidden"], [id(4), "no_portrait"]].sort());
    expect(built.withheld.every((w) => w.fileName === null)).toBe(true);
  });

  it("counts everything", () => {
    expect(built.counts).toEqual({ total: 4, withPortrait: 2, withoutPortrait: 1, hidden: 1, neverExported: 2, changedSinceExport: 0, sinceLastExport: 2 });
  });

  it("marks a retake as changed since export, and an untouched export as current", () => {
    const exported = buildFrameEntries(
      [row(1, { frameNumber: 1, exportedPhotoId: photo(1).id }), row(2, { frameNumber: 2, exportedPhotoId: photo(50).id }), row(3, { frameNumber: 3 })],
      "p",
    );
    expect(exported.items.map((i) => i.exportStatus)).toEqual(["current", "changed", "never"]);
    expect(exported.counts).toMatchObject({ neverExported: 1, changedSinceExport: 1, sinceLastExport: 2 });
    expect(exportStatusOf("a", null)).toBe("never");
    expect(exportStatusOf("a", "a")).toBe("current");
    expect(exportStatusOf("b", "a")).toBe("changed");
  });

  it("cleans the printed name and carries the window label", () => {
    const b = buildFrameEntries([row(1, { frameNumber: 1, name: "  Sir‮ Fluff  ", windowLabel: null })], "p");
    expect(b.items[0].name).toBe("Sir Fluff");
    expect(b.items[0].windowLabel).toBe("");
  });

  it("carries no contact data: only the declared name fields, never an email, phone or note", () => {
    const dirty = [{ ...row(1, { frameNumber: 1 }), buyerEmail: "x@example.invalid", buyerPhone: "555", noteToSanta: "n", careNote: "c" }] as unknown as FrameStuffyRow[];
    const json = JSON.stringify(buildFrameEntries(dirty, "p"));
    expect(json).not.toMatch(/example\.invalid|buyerEmail|buyerPhone|noteToSanta|careNote|"555"/);
    for (const key of Object.keys(buildFrameEntries(dirty, "p").items[0])) expect(key).not.toMatch(/email|phone|mobile|note|care|address|token|storage/i);
  });
});

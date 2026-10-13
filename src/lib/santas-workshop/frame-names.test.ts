import { describe, expect, it } from "vitest";
import { frameImageFileName, cleanPrintName, frameFileName, framePartFileName, framePrefix, sanitizeFilePrefix } from "./frame-names";

describe("frame file names", () => {
  it("is ssw-<slug>-NNN.jpg, padded to 3 digits and 4 above 999", () => {
    expect(frameFileName(framePrefix("2026-photo-day", ""), 7)).toBe("ssw-2026-photo-day-007.jpg");
    expect(frameFileName("ssw-x", 999)).toBe("ssw-x-999.jpg");
    expect(frameFileName("ssw-x", 1000)).toBe("ssw-x-1000.jpg");
  });
  it("sanitises a custom prefix to [a-z0-9-]", () => {
    expect(framePrefix("slug", "  Santa's Workshop 2026!! ")).toBe("santa-s-workshop-2026");
    expect(framePrefix("slug", "../../etc/passwd")).toBe("etc-passwd");
    expect(framePrefix("slug", "!!!")).toBe("ssw-slug");
    expect(sanitizeFilePrefix("a".repeat(100))?.length).toBe(40);
    expect(framePrefix("Slug With Spaces", null)).toBe("ssw-slug-with-spaces");
  });
  it("is unique per number and never carries a name", () => {
    const names = new Set([1, 2, 3, 1000].map((n) => frameFileName("ssw-x", n)));
    expect(names.size).toBe(4);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+\.jpg$/);
  });
  it("names zip parts", () => {
    expect(framePartFileName("ssw-x", 1, 2)).toBe("ssw-x-frames-part-1-of-2.zip");
    expect(framePartFileName("ssw-x", 1, 1, "-new")).toBe("ssw-x-frames-part-1-of-1-new.zip");
    expect(framePartFileName("ssw-x", 1, 1, "-new")).not.toBe(framePartFileName("ssw-x", 1, 1));
  });
});

describe("cleanPrintName", () => {
  it("removes control and bidi-override characters and collapses whitespace", () => {
    expect(cleanPrintName("  Sir‮  Fluff\u0007y\n\tBear ")).toBe("Sir Fluff y Bear");
    expect(cleanPrintName("A​b")).toBe("A b");
  });
  it("keeps emoji and accents", () => {
    expect(cleanPrintName("Teddy \u{1F9F8} José")).toBe("Teddy \u{1F9F8} José");
  });
  it("caps length by code point without splitting an emoji", () => {
    const out = cleanPrintName("\u{1F9F8}".repeat(100));
    expect(Array.from(out).length).toBe(60);
  });
  it("falls back when nothing printable is left", () => {
    expect(cleanPrintName(null)).toBe("Stuffy");
    expect(cleanPrintName("‮​  ")).toBe("Stuffy");
  });
});

describe("frameImageFileName", () => {
  const base = { fileName: "ssw-x-002.jpg", portraitPhotoId: "ab12cd34-0000-4000-8000-000000000000" };
  it("keeps the plain name for a frame never exported", () => {
    expect(frameImageFileName({ ...base, exportedPhotoId: null })).toBe("ssw-x-002.jpg");
  });
  it("appends the portrait's short id once the frame was exported before, so a retake cannot reuse a name", () => {
    const retaken = frameImageFileName({ ...base, exportedPhotoId: "11111111-0000-4000-8000-000000000000" });
    expect(retaken).toBe("ssw-x-002-ab12cd.jpg");
    expect(retaken).not.toBe("ssw-x-002.jpg");
    expect(retaken).toMatch(/^[a-z0-9-]+\.jpg$/);
  });
});

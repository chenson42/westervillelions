import { create } from "qrcode";
import { describe, expect, it } from "vitest";
import { FRAME_HEIGHT_PX, FRAME_WIDTH_PX } from "./admin-contract";
import { frameNumberLabel, CAPTION, CAPTION_LINES, computeFrameLayout, coverCrop, fitText, frameArtSizeOk, layoutRects, QUIET_MODULES, SAFE_MARGIN, type Rect } from "./frame-layout";

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// QR sizes: version 1 (21) up to 43 (version 6), the densest that fits at 7 px per module. A real link is version 3 to 5.
const SIZES = [21, 25, 29, 33, 37, 41, 43];

describe("frame layout", () => {
  it("is 1200 x 1800", () => {
    const l = computeFrameLayout({ qrModules: 33 });
    expect([l.width, l.height]).toEqual([1200, 1800]);
    expect([FRAME_WIDTH_PX, FRAME_HEIGHT_PX]).toEqual([1200, 1800]);
  });

  it.each(SIZES)("every rect is inside the safe margin (QR %i)", (n) => {
    const l = computeFrameLayout({ qrModules: n, practice: true });
    for (const [name, r] of Object.entries(layoutRects(l))) {
      expect(r.x, name).toBeGreaterThanOrEqual(SAFE_MARGIN);
      expect(r.y, name).toBeGreaterThanOrEqual(SAFE_MARGIN);
      expect(r.x + r.w, name).toBeLessThanOrEqual(1200 - SAFE_MARGIN);
      expect(r.y + r.h, name).toBeLessThanOrEqual(1800 - SAFE_MARGIN);
    }
    expect(l.nameBaselineY).toBeGreaterThan(l.name.y);
    expect(l.nameBaselineY).toBeLessThan(l.name.y + l.name.h);
  });

  it.each(SIZES)("QR module size is an integer of 7 or more, the plate holds a 4-module quiet zone and the QR is at least 300 px (QR %i)", (n) => {
    const l = computeFrameLayout({ qrModules: n });
    expect(Number.isInteger(l.qrModulePx)).toBe(true);
    expect(l.qrModulePx).toBeGreaterThanOrEqual(7);
    expect(l.qrPlate.w).toBe((n + 2 * QUIET_MODULES) * l.qrModulePx);
    expect(l.qrOrigin.x - l.qrPlate.x).toBe(QUIET_MODULES * l.qrModulePx);
    expect(l.qrOrigin.y - l.qrPlate.y).toBe(QUIET_MODULES * l.qrModulePx);
    if (n <= 41) expect(l.qrPlate.w).toBeGreaterThanOrEqual(300);
  });

  it("no rects overlap, and the practice band lies on the photo window", () => {
    const l = computeFrameLayout({ qrModules: 33, practice: true });
    const rects = Object.entries(layoutRects(l));
    for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) expect(overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} vs ${rects[j][0]}`).toBe(false);
    const b = l.practiceBand as Rect;
    expect(b.x).toBeGreaterThanOrEqual(l.photo.x);
    expect(b.y + b.h).toBeLessThanOrEqual(l.photo.y + l.photo.h);
    expect(computeFrameLayout({ qrModules: 33 }).practiceBand).toBeNull();
  });

  it("rejects an impossible QR size", () => {
    expect(() => computeFrameLayout({ qrModules: 5 })).toThrow();
    expect(() => computeFrameLayout({ qrModules: 57 })).toThrow(/too long/);
  });

  it("the caption is the words plus the club address, never a link", () => {
    expect(CAPTION).toBe("Scan to see the whole day's photos · westervillelions.org");
    expect(CAPTION_LINES.join(" ")).not.toMatch(/https?:|\/c\//);
  });
});

describe("coverCrop", () => {
  it("fills the window from a 3:4 source", () => {
    const c = coverCrop(900, 1200, 1050, 990);
    expect(c.w).toBe(900);
    expect(c.x).toBe(0);
    expect(c.h).toBeCloseTo(900 * (990 / 1050));
    expect(c.y).toBeCloseTo((1200 - c.h) / 2);
  });
  it("crops the sides of a 4:3 source", () => {
    const c = coverCrop(1600, 1200, 1050, 990);
    expect(c.h).toBe(1200);
    expect(c.y).toBe(0);
    expect(c.x).toBeCloseTo((1600 - c.w) / 2);
  });
  it("crops a square source top and bottom, centred, with the destination ratio", () => {
    const c = coverCrop(1000, 1000, 1050, 990);
    expect(c.w / c.h).toBeCloseTo(1050 / 990);
    expect(c.x + c.w / 2).toBeCloseTo(500);
    expect(c.y + c.h / 2).toBeCloseTo(500);
  });
  it("refuses a zero size", () => {
    expect(() => coverCrop(0, 10, 10, 10)).toThrow();
  });
});

describe("fitText", () => {
  const measure = (t: string, px: number) => Array.from(t).length * px * 0.5;
  it("keeps full size when it fits", () => {
    expect(fitText("Bear", 1050, 84, 44, measure)).toEqual({ text: "Bear", px: 84, truncated: false });
  });
  it("shrinks to fit before truncating", () => {
    const r = fitText("A".repeat(30), 1050, 84, 44, measure);
    expect(r.truncated).toBe(false);
    expect(r.px).toBeLessThan(84);
    expect(measure(r.text, r.px)).toBeLessThanOrEqual(1050);
  });
  it("reaches the floor, then truncates with an ellipsis", () => {
    const r = fitText("B".repeat(80), 1050, 84, 44, measure);
    expect(r.px).toBe(44);
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith("…")).toBe(true);
    expect(measure(r.text, 44)).toBeLessThanOrEqual(1050);
  });
  it("never splits an emoji", () => {
    const r = fitText("\u{1F9F8}".repeat(80), 400, 84, 44, measure);
    expect(Array.from(r.text.replace("…", "")).every((c) => c === "\u{1F9F8}")).toBe(true);
  });
});

describe("frame art size", () => {
  it("accepts only 1200 x 1800", () => {
    expect(frameArtSizeOk(1200, 1800)).toBe(true);
    expect(frameArtSizeOk(1800, 1200)).toBe(false);
    expect(frameArtSizeOk(1201, 1800)).toBe(false);
  });
});

describe("frame number and QR size for the real link", () => {
  it("the number tag sits inside the canvas margin and is disjoint from the QR plate, the name and the caption", () => {
    const l = computeFrameLayout({ qrModules: 37, practice: true });
    expect(l.number.x).toBeGreaterThanOrEqual(SAFE_MARGIN);
    expect(l.number.x + l.number.w).toBeLessThanOrEqual(1200 - SAFE_MARGIN);
    expect(l.number.y + l.number.h).toBeLessThanOrEqual(1800 - SAFE_MARGIN);
    for (const other of [l.qrPlate, l.name, l.caption, l.photo]) expect(overlaps(l.number, other)).toBe(false);
    expect(l.numberBaselineY).toBeGreaterThan(l.number.y);
    expect(l.numberBaselineY).toBeLessThan(l.number.y + l.number.h);
  });
  it("labels with three digits", () => {
    expect(frameNumberLabel(2)).toBe("No. 002");
    expect(frameNumberLabel(1234)).toBe("No. 1234");
  });
  it("a 69-character collage link (QR version 5) prints at 8 px per module or more with its quiet zone", () => {
    const payload = `https://westervillelions.org/santas-workshop/c/${"A".repeat(22)}`.padEnd(69, "x");
    expect(payload).toHaveLength(69);
    const size = create(payload, { errorCorrectionLevel: "M" }).modules.size;
    const l = computeFrameLayout({ qrModules: size });
    expect(l.qrModulePx).toBeGreaterThanOrEqual(8);
    expect(l.qrPlate.w).toBe((size + 2 * QUIET_MODULES) * l.qrModulePx);
    expect(l.qrPlate.y + l.qrPlate.h).toBeLessThanOrEqual(1800 - SAFE_MARGIN);
  });
});

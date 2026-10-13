import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { assertUniqueNames, buildZip, partIsSettled, planParts, type ZipFile } from "./zip-parts";

const files = (n: number, from = 1): ZipFile[] => Array.from({ length: n }, (_, i) => ({ name: `ssw-t-${String(from + i).padStart(3, "0")}.jpg`, data: Uint8Array.from([0xff, 0xd8, i % 256, 0xff, 0xd9]) }));

describe("planParts", () => {
  it("splits 250 at 100 into 100, 100, 50", () => {
    expect(planParts(250, 100).map((p) => p.end - p.start)).toEqual([100, 100, 50]);
    expect(planParts(250, 100)[2]).toEqual({ start: 200, end: 250 });
  });
  it("an exact multiple makes no empty part, and nothing makes none", () => {
    expect(planParts(200, 100)).toHaveLength(2);
    expect(planParts(0, 100)).toEqual([]);
    expect(planParts(3, 100)).toEqual([{ start: 0, end: 3 }]);
  });
  it("a bad part size falls back to 1", () => {
    expect(planParts(2, 0)).toHaveLength(2);
  });
});

describe("buildZip round trip", () => {
  it("each part unzips to the same names and bytes", () => {
    const all = files(250);
    for (const { start, end } of planParts(all.length, 100)) {
      const slice = all.slice(start, end);
      const out = unzipSync(buildZip(slice, zipSync));
      expect(Object.keys(out).sort()).toEqual(slice.map((f) => f.name).sort());
      for (const f of slice) expect(Array.from(out[f.name])).toEqual(Array.from(f.data));
    }
  });

  it("entries are stored uncompressed", () => {
    const big = Uint8Array.from({ length: 4000 }, () => 7);
    const zip = buildZip([{ name: "a.jpg", data: big }], zipSync);
    expect(zip.length).toBeGreaterThan(big.length);
    // local header: compression method at offset 8 is 0 (stored)
    expect(zip[8] | (zip[9] << 8)).toBe(0);
  });

  it("a part holds pictures only, and duplicate names are refused", () => {
    expect(Object.keys(unzipSync(buildZip(files(3), zipSync))).every((n) => n.endsWith(".jpg"))).toBe(true);
    expect(() => assertUniqueNames([...files(1), ...files(1)])).toThrow();
  });
});

describe("partIsSettled", () => {
  it("is true only when every frame produced or is listed as failed", () => {
    expect(partIsSettled(100, 97, 3)).toBe(true);
    expect(partIsSettled(100, 97, 2)).toBe(false);
    expect(partIsSettled(0, 0, 0)).toBe(true);
  });
});

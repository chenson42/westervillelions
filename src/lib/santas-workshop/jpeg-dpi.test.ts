import { describe, expect, it } from "vitest";
import { FRAME_DPI, readJpegDensity, setJpegDensity } from "./jpeg-dpi";
import { parseJpegHeader } from "./jpeg-header";

// SOI, optional APP0, SOF0 (2 x 3), SOS + two entropy bytes, EOI.
const SOF0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00];
const TAIL = [0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0x12, 0x34, 0xff, 0xd9];
const jfif = (units: number, x: number, y: number) => [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, units, x >> 8, x & 0xff, y >> 8, y & 0xff, 0, 0];
const withJfif = () => Uint8Array.from([0xff, 0xd8, ...jfif(0, 1, 1), ...SOF0, ...TAIL]);
const withoutJfif = () => Uint8Array.from([0xff, 0xd8, ...SOF0, ...TAIL]);

describe("setJpegDensity", () => {
  it("sets units 1 and 300 x 300 on an existing JFIF segment", () => {
    const out = setJpegDensity(withJfif());
    expect(readJpegDensity(out)).toEqual({ units: 1, x: 300, y: 300 });
    expect(out.length).toBe(withJfif().length);
  });

  it("inserts a JFIF segment right after SOI when there is none", () => {
    const src = withoutJfif();
    const out = setJpegDensity(src);
    expect(out.length).toBe(src.length + 18);
    expect(Array.from(out.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(readJpegDensity(out)).toEqual({ units: 1, x: FRAME_DPI, y: FRAME_DPI });
  });

  it("leaves everything after the header byte-identical", () => {
    const a = withoutJfif();
    expect(Array.from(setJpegDensity(a).subarray(20))).toEqual(Array.from(a.subarray(2)));
    const b = withJfif();
    const out = setJpegDensity(b);
    expect(Array.from(out.subarray(18))).toEqual(Array.from(b.subarray(18)));
  });

  it("is idempotent, does not mutate its input, and keeps a valid JPEG header", () => {
    const src = withJfif();
    const before = Array.from(src);
    const once = setJpegDensity(src);
    expect(Array.from(src)).toEqual(before);
    expect(Array.from(setJpegDensity(once))).toEqual(Array.from(once));
    expect(parseJpegHeader(setJpegDensity(withoutJfif()))).toMatchObject({ ok: true, width: 2, height: 3 });
  });

  it("throws on a non-JPEG", () => {
    expect(() => setJpegDensity(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toThrow();
    expect(readJpegDensity(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
  });
});

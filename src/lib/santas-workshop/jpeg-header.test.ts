import { describe, expect, it } from "vitest";
import { parseJpegHeader } from "./jpeg-header";
import { makeJpeg, TINY_PNG } from "./photo-fixtures";

describe("parseJpegHeader", () => {
  it("accepts a JPEG and reads SOF0 dimensions", () => {
    expect(parseJpegHeader(makeJpeg(1280, 960))).toEqual({ ok: true, width: 1280, height: 960, progressive: false });
  });

  it("reads SOF2 (progressive) dimensions", () => {
    expect(parseJpegHeader(makeJpeg(640, 480, { progressive: true }))).toEqual({ ok: true, width: 640, height: 480, progressive: true });
  });

  it("rejects a PNG", () => {
    expect(parseJpegHeader(TINY_PNG)).toEqual({ ok: false, reason: "not_jpeg" });
  });

  it("rejects zero-length input", () => {
    expect(parseJpegHeader(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a truncated upload (no EOI)", () => {
    expect(parseJpegHeader(makeJpeg(100, 100, { truncated: true }))).toEqual({ ok: false, reason: "truncated" });
  });

  it("rejects a file that ends before any frame header", () => {
    expect(parseJpegHeader(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)).ok).toBe(false);
  });

  it("rejects zero dimensions", () => {
    expect(parseJpegHeader(makeJpeg(0, 10)).ok).toBe(false);
  });
});

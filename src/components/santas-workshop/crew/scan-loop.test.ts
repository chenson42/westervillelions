import { describe, expect, it } from "vitest";
import { MAX_DECODE_WIDTH, MAX_SCAN_TEXT, REPEAT_DEBOUNCE_MS, chooseDecoder, createScanAccumulator, decodeSize } from "./scan-loop";

describe("scan accumulator", () => {
  it("believes a code only after two identical reads in a row", () => {
    const acc = createScanAccumulator();
    expect(acc.push("ABC", 0)).toBeNull();
    expect(acc.push("ABC", 120)).toBe("ABC");
  });

  it("resets the streak on a miss or a different read", () => {
    const acc = createScanAccumulator();
    expect(acc.push("ABC", 0)).toBeNull();
    expect(acc.push(null, 120)).toBeNull();
    expect(acc.push("ABC", 240)).toBeNull();
    expect(acc.push("XYZ", 360)).toBeNull();
    expect(acc.push("ABC", 480)).toBeNull();
    expect(acc.push("ABC", 600)).toBe("ABC");
  });

  it("ignores text over 200 characters and empty text", () => {
    const acc = createScanAccumulator();
    const long = "x".repeat(MAX_SCAN_TEXT + 1);
    expect(acc.push(long, 0)).toBeNull();
    expect(acc.push(long, 120)).toBeNull();
    expect(acc.push("", 240)).toBeNull();
    const edge = "y".repeat(MAX_SCAN_TEXT);
    acc.push(edge, 360);
    expect(acc.push(edge, 480)).toBe(edge);
  });

  it("does not report the same sticker again until the debounce passes", () => {
    const acc = createScanAccumulator();
    acc.push("ABC", 0);
    expect(acc.push("ABC", 100)).toBe("ABC");
    acc.push("ABC", 200);
    expect(acc.push("ABC", 300)).toBeNull();
    expect(acc.push("ABC", 100 + REPEAT_DEBOUNCE_MS + 1)).toBe("ABC");
  });

  it("reports a different sticker straight away", () => {
    const acc = createScanAccumulator();
    acc.push("ABC", 0);
    expect(acc.push("ABC", 100)).toBe("ABC");
    acc.push("DEF", 200);
    expect(acc.push("DEF", 300)).toBe("DEF");
  });

  it("reset forgets everything", () => {
    const acc = createScanAccumulator();
    acc.push("ABC", 0);
    expect(acc.push("ABC", 100)).toBe("ABC");
    acc.reset();
    acc.push("ABC", 200);
    expect(acc.push("ABC", 300)).toBe("ABC");
  });
});

describe("decoder choice", () => {
  it("uses the native detector only when it reads QR codes", () => {
    expect(chooseDecoder({ hasBarcodeDetector: true, supportedFormats: ["qr_code", "ean_13"] })).toBe("native");
    expect(chooseDecoder({ hasBarcodeDetector: true, supportedFormats: ["ean_13"] })).toBe("jsqr");
    expect(chooseDecoder({ hasBarcodeDetector: true, supportedFormats: null })).toBe("jsqr");
    expect(chooseDecoder({ hasBarcodeDetector: false, supportedFormats: null })).toBe("jsqr");
  });
});

describe("decode size", () => {
  it("scales a wide frame down to at most 640 px and keeps the aspect", () => {
    expect(decodeSize(1920, 1080)).toEqual({ width: MAX_DECODE_WIDTH, height: 360 });
  });
  it("never upscales", () => {
    expect(decodeSize(320, 240)).toEqual({ width: 320, height: 240 });
  });
  it("copes with an empty frame", () => {
    expect(decodeSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

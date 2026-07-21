/**
 * Unit tests for src/lib/image-resize.ts
 *
 * Pure dimension math, no DOM — covers the Phase 3 design doc's named cases:
 * unchanged-when-under-max, landscape downscale, portrait downscale, the
 * exact-boundary case, and defensive zero/negative input.
 */

import { describe, it, expect } from "vitest";
import {
  computeResizeDimensions,
  RECEIPT_IMAGE_MAX_DIMENSION,
  RECEIPT_IMAGE_JPEG_QUALITY,
} from "./image-resize";

describe("computeResizeDimensions", () => {
  it("returns dimensions unchanged when both are already <= max", () => {
    expect(computeResizeDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("downscales a landscape image (width > height, width > max) to the max on the long edge", () => {
    // 3200x2400 -> long edge (width) scaled to 1600, height scaled proportionally (1200)
    expect(computeResizeDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("downscales a portrait image (height > width, height > max) symmetrically", () => {
    // 2400x3200 -> long edge (height) scaled to 1600, width scaled proportionally (1200)
    expect(computeResizeDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("rounds non-integer scaled dimensions to the nearest integer", () => {
    // 3000x1000, max 1600 -> scale = 1600/3000, height = 1000 * (1600/3000) = 533.33...
    const result = computeResizeDimensions(3000, 1000, 1600);
    expect(result.width).toBe(1600);
    expect(Number.isInteger(result.height)).toBe(true);
    expect(result.height).toBe(533);
  });

  it("boundary case: width === max exactly leaves dimensions unchanged", () => {
    expect(computeResizeDimensions(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("boundary case: height === max exactly leaves dimensions unchanged", () => {
    expect(computeResizeDimensions(900, 1600, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it("uses the default max dimension (1600) when none is supplied", () => {
    expect(computeResizeDimensions(3200, 1600)).toEqual({ width: 1600, height: 800 });
  });

  it("does not throw on zero dimensions (defensive; unreachable for a decoded image)", () => {
    expect(() => computeResizeDimensions(0, 0)).not.toThrow();
    expect(computeResizeDimensions(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("does not throw on negative dimensions (defensive; unreachable for a decoded image)", () => {
    expect(() => computeResizeDimensions(-100, -50)).not.toThrow();
    expect(computeResizeDimensions(-100, -50)).toEqual({ width: -100, height: -50 });
  });

  it("exports the spec constants used by the client resize glue", () => {
    expect(RECEIPT_IMAGE_MAX_DIMENSION).toBe(1600);
    expect(RECEIPT_IMAGE_JPEG_QUALITY).toBe(0.82);
  });
});

/**
 * Unit tests for the pure data-URI transposition helpers behind Site
 * Review Fixes Batch 3 (docs/work-log/2026-09-04-site-review-fixes.md).
 * No DB, no network — pure string/buffer logic.
 */

import { describe, it, expect } from "vitest";
import { isImageDataUri, parseImageDataUri, buildEventImageUrl } from "./event-image";

describe("isImageDataUri", () => {
  it("returns true for a data:image/... URI", () => {
    expect(isImageDataUri("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(isImageDataUri("data:image/png;base64,iVBORw0KGgo")).toBe(true);
  });

  it("returns false for an existing serve-route URL", () => {
    expect(isImageDataUri("/api/public/events/abc-123/image?v=1700000000000")).toBe(false);
  });

  it("returns false for null, undefined, and empty string", () => {
    expect(isImageDataUri(null)).toBe(false);
    expect(isImageDataUri(undefined)).toBe(false);
    expect(isImageDataUri("")).toBe(false);
  });

  it("returns false for a non-image data: URI", () => {
    expect(isImageDataUri("data:text/plain;base64,aGVsbG8=")).toBe(false);
  });
});

describe("parseImageDataUri", () => {
  it("parses a well-formed data:image/jpeg;base64 URI", () => {
    const original = Buffer.from("fake jpeg bytes");
    const b64 = original.toString("base64");
    const result = parseImageDataUri(`data:image/jpeg;base64,${b64}`);

    expect(result).not.toBeNull();
    expect(result!.contentType).toBe("image/jpeg");
    expect(result!.buffer.equals(original)).toBe(true);
  });

  it("parses a data:image/png;base64 URI", () => {
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const b64 = original.toString("base64");
    const result = parseImageDataUri(`data:image/png;base64,${b64}`);

    expect(result).not.toBeNull();
    expect(result!.contentType).toBe("image/png");
    expect(result!.buffer.equals(original)).toBe(true);
  });

  it("returns null for a non-data: string", () => {
    expect(parseImageDataUri("/api/public/events/abc/image?v=1")).toBeNull();
  });

  it("returns null for a non-image mime type", () => {
    expect(parseImageDataUri("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });

  it("returns null when the base64 payload is empty", () => {
    expect(parseImageDataUri("data:image/jpeg;base64,")).toBeNull();
  });

  it("returns null for a malformed data: URI with no comma", () => {
    expect(parseImageDataUri("data:image/jpeg;base64")).toBeNull();
  });
});

describe("buildEventImageUrl", () => {
  it("builds a versioned same-origin URL", () => {
    expect(buildEventImageUrl("abc-123", 1700000000000)).toBe(
      "/api/public/events/abc-123/image?v=1700000000000"
    );
  });

  it("accepts a string version", () => {
    expect(buildEventImageUrl("abc-123", "1")).toBe("/api/public/events/abc-123/image?v=1");
  });
});

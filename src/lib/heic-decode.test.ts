/**
 * Unit tests for src/lib/heic-decode.ts
 * (docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md, Phase 3's 16-test list)
 *
 * The classifier, message lookup, and error class are pure and imported
 * directly. decodeHeicFileToJpegBlob's own tests intercept the dynamic
 * `import("heic2any")` via `vi.doMock` + `vi.resetModules()` per test, since
 * different tests need the mocked module to behave differently (ESM-shaped,
 * UMD-shaped, rejecting, etc.) — no real WASM runtime involved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyHeicDecodeFailure,
  getHeicDecodeFailureMessage,
  HEIC_DECODE_FAILURE_MESSAGES,
  HeicDecodeStageError,
  resolveHeic2AnyExport,
} from "./heic-decode";
import { RECEIPT_IMAGE_JPEG_QUALITY } from "./image-resize";

describe("classifyHeicDecodeFailure", () => {
  it("returns \"chunk-load\" for a HeicDecodeStageError constructed with stage \"chunk-load\"", () => {
    const err = new HeicDecodeStageError("boom", "chunk-load");
    expect(classifyHeicDecodeFailure(err)).toBe("chunk-load");
  });

  it("returns \"decode\" for a HeicDecodeStageError constructed with stage \"decode\"", () => {
    const err = new HeicDecodeStageError("boom", "decode");
    expect(classifyHeicDecodeFailure(err)).toBe("decode");
  });

  it("returns \"decode\" (default) for a plain Error", () => {
    expect(classifyHeicDecodeFailure(new Error("plain"))).toBe("decode");
  });

  it("returns \"decode\" (default) for a non-Error rejection value", () => {
    expect(classifyHeicDecodeFailure(undefined)).toBe("decode");
    expect(classifyHeicDecodeFailure("some string")).toBe("decode");
    expect(classifyHeicDecodeFailure({ some: "object" })).toBe("decode");
  });
});

describe("getHeicDecodeFailureMessage / HEIC_DECODE_FAILURE_MESSAGES", () => {
  it("returns the connectivity/retry-oriented copy for \"chunk-load\"", () => {
    expect(getHeicDecodeFailureMessage("chunk-load")).toBe(
      HEIC_DECODE_FAILURE_MESSAGES["chunk-load"],
    );
    expect(getHeicDecodeFailureMessage("chunk-load")).toMatch(/check your connection/i);
  });

  it("returns the file/content-oriented copy for \"decode\"", () => {
    expect(getHeicDecodeFailureMessage("decode")).toBe(HEIC_DECODE_FAILURE_MESSAGES["decode"]);
    expect(getHeicDecodeFailureMessage("decode")).toMatch(/valid HEIC file/i);
  });

  it("neither message contains the substring \"Safari\" (regression guard)", () => {
    expect(HEIC_DECODE_FAILURE_MESSAGES["chunk-load"]).not.toMatch(/Safari/);
    expect(HEIC_DECODE_FAILURE_MESSAGES["decode"]).not.toMatch(/Safari/);
  });
});

describe("HeicDecodeStageError", () => {
  it("carries the stage it was constructed with, and name === \"HeicDecodeStageError\"", () => {
    const err = new HeicDecodeStageError("boom", "chunk-load");
    expect(err.stage).toBe("chunk-load");
    expect(err.name).toBe("HeicDecodeStageError");
    expect(err.message).toBe("boom");
  });

  it("preserves a wrapped cause when one is passed in the constructor options", () => {
    const cause = new Error("underlying");
    const err = new HeicDecodeStageError("boom", "decode", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("decodeHeicFileToJpegBlob", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "receipt.heic", { type: "image/heic" });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("heic2any");
    vi.resetModules();
  });

  it("resolves to the JPEG Blob when the mocked module exports { default: fn } (ESM-shaped interop)", async () => {
    const jpegBlob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const fn = vi.fn().mockResolvedValue(jpegBlob);
    vi.doMock("heic2any", () => ({ default: fn }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    const result = await decodeHeicFileToJpegBlob(file);
    expect(result).toBe(jpegBlob);
  });

  // Covers the "bare callable, no .default" UMD/CJS interop shape via
  // resolveHeic2AnyExport directly (see that function's doc comment): the
  // ESM-shaped case above is exercised end-to-end through decodeHeicFileTo-
  // JpegBlob + vi.mock, but Vitest's mock factory must return a plain
  // object, so a bare-function module value can't be produced by mocking
  // `import("heic2any")` itself.
  it("unwraps to the module value itself when it resolves as a bare callable with no .default (UMD/CJS interop shape)", () => {
    const bareCallable = vi.fn();
    expect(resolveHeic2AnyExport(bareCallable)).toBe(bareCallable);
  });

  it("takes the first element when the mocked heic2any resolves with a Blob[] (multi-image HEIC container)", async () => {
    const first = new Blob(["first"], { type: "image/jpeg" });
    const second = new Blob(["second"], { type: "image/jpeg" });
    const fn = vi.fn().mockResolvedValue([first, second]);
    vi.doMock("heic2any", () => ({ default: fn }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    const result = await decodeHeicFileToJpegBlob(file);
    expect(result).toBe(first);
  });

  it("throws a HeicDecodeStageError tagged \"decode\" when the mocked heic2any resolves with an empty Blob[]", async () => {
    const fn = vi.fn().mockResolvedValue([]);
    vi.doMock("heic2any", () => ({ default: fn }));

    const { decodeHeicFileToJpegBlob, HeicDecodeStageError: ImportedError } = await import(
      "./heic-decode"
    );
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({
      stage: "decode",
    });
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toBeInstanceOf(ImportedError);
  });

  it("throws a HeicDecodeStageError tagged \"chunk-load\" when the mocked module import itself rejects", async () => {
    vi.doMock("heic2any", () => {
      throw new Error("network error loading chunk");
    });

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({
      stage: "chunk-load",
    });
  });

  it("throws a HeicDecodeStageError tagged \"decode\" when the import succeeds but the mocked heic2any(...) call rejects", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("corrupt HEIC bytes"));
    vi.doMock("heic2any", () => ({ default: fn }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({
      stage: "decode",
    });
  });

  it("calls the mocked heic2any with { blob: file, toType: \"image/jpeg\", quality: RECEIPT_IMAGE_JPEG_QUALITY }", async () => {
    const jpegBlob = new Blob(["jpeg-bytes"], { type: "image/jpeg" });
    const fn = vi.fn().mockResolvedValue(jpegBlob);
    vi.doMock("heic2any", () => ({ default: fn }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await decodeHeicFileToJpegBlob(file);

    expect(fn).toHaveBeenCalledWith({
      blob: file,
      toType: "image/jpeg",
      quality: RECEIPT_IMAGE_JPEG_QUALITY,
    });
  });
});

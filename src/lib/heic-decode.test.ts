/**
 * Unit tests for src/lib/heic-decode.ts
 * (docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md, Phase 3's 16-test
 * list; decoder swapped to libheif-js per
 * docs/work-log/2026-07-21-heic-modern-iphone-decode.md.)
 *
 * The classifier, message lookup, and error class are pure and imported
 * directly. decodeHeicFileToJpegBlob's own tests intercept the dynamic
 * `import("libheif-js/wasm-bundle")` via `vi.doMock` + `vi.resetModules()`
 * per test, since different tests need the mocked module to behave
 * differently (ESM-shaped, bare-factory-shaped, rejecting, etc.) — no real
 * WASM runtime involved. The canvas encode step (`encodeRgbaToJpegBlob`) is
 * NOT unit-tested here — canvas isn't available in Vitest's Node
 * environment; its real-canvas behavior is covered by qa's Phase 5 manual
 * click-through against a real HEIC fixture in a real browser. What IS
 * covered here is that decode reaches a correctly-shaped `display()` call
 * with a mocked HeifImage, by having the mocked `display()` invoke its
 * callback with a falsy value — which lets these tests assert the call
 * shape and the resulting "decode"-stage failure without ever reaching
 * `document`.
 *
 * Mocked `HeifDecoder` constructors below use `vi.fn().mockImplementation(
 * function () {...})` (a real `function`, not an arrow) because
 * decodeHeicFileToJpegBlob calls `new libheif.HeifDecoder()` — an arrow
 * function can't be used as a constructor, and vi.fn() silently drops the
 * mock's return value for `new` calls when the implementation is an arrow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyHeicDecodeFailure,
  getHeicDecodeFailureMessage,
  HEIC_DECODE_FAILURE_MESSAGES,
  HeicDecodeStageError,
  resolveLibheifModule,
} from "./heic-decode";

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

describe("resolveLibheifModule", () => {
  it("unwraps { default: <promise-of-namespace> } (ESM-shaped interop) by awaiting the promise", async () => {
    const namespace = { HeifDecoder: class {} };
    const mod = { default: Promise.resolve(namespace) };
    await expect(resolveLibheifModule(mod)).resolves.toBe(namespace);
  });

  it("unwraps a bare namespace value with no .default (interop shape with no wrapping)", async () => {
    const namespace = { HeifDecoder: class {} };
    await expect(resolveLibheifModule(namespace)).resolves.toBe(namespace);
  });

  it("invokes .default when it is a bare factory function, then awaits its result", async () => {
    const namespace = { HeifDecoder: class {} };
    const factory = vi.fn().mockResolvedValue(namespace);
    const mod = { default: factory };
    await expect(resolveLibheifModule(mod)).resolves.toBe(namespace);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe("decodeHeicFileToJpegBlob", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "receipt.heic", { type: "image/heic" });

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("libheif-js/wasm-bundle");
    vi.resetModules();
  });

  it("throws a HeicDecodeStageError tagged \"chunk-load\" when the mocked module import itself rejects", async () => {
    vi.doMock("libheif-js/wasm-bundle", () => {
      throw new Error("network error loading chunk");
    });

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({
      stage: "chunk-load",
    });
  });

  it("throws a HeicDecodeStageError tagged \"decode\" when decode() returns an empty array", async () => {
    const HeifDecoder = vi.fn().mockImplementation(function () {
      return { decode: vi.fn().mockReturnValue([]) };
    });
    vi.doMock("libheif-js/wasm-bundle", () => ({ default: Promise.resolve({ HeifDecoder }) }));

    const { decodeHeicFileToJpegBlob, HeicDecodeStageError: ImportedError } = await import(
      "./heic-decode"
    );
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({ stage: "decode" });
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toBeInstanceOf(ImportedError);
  });

  it("takes the first image for a multi-image container and frees every returned image handle", async () => {
    const freeFirst = vi.fn();
    const freeSecond = vi.fn();
    const display = vi.fn((_target, callback) => callback(false)); // fail fast, before the canvas step
    const first = { get_width: () => 10, get_height: () => 10, display, free: freeFirst };
    const second = { get_width: () => 10, get_height: () => 10, display: vi.fn(), free: freeSecond };
    const HeifDecoder = vi.fn().mockImplementation(function () {
      return { decode: vi.fn().mockReturnValue([first, second]) };
    });
    vi.doMock("libheif-js/wasm-bundle", () => ({ default: Promise.resolve({ HeifDecoder }) }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({ stage: "decode" });

    // Only the first image's display() is ever called...
    expect(display).toHaveBeenCalledTimes(1);
    expect(second.display).not.toHaveBeenCalled();
    // ...but both handles are freed regardless of which one was used.
    expect(freeFirst).toHaveBeenCalledTimes(1);
    expect(freeSecond).toHaveBeenCalledTimes(1);
  });

  it("calls display() with a correctly-shaped { data, width, height } target sized to the image dimensions", async () => {
    const display = vi.fn((_target, callback) => callback(false));
    const image = { get_width: () => 4, get_height: () => 3, display, free: vi.fn() };
    const HeifDecoder = vi.fn().mockImplementation(function () {
      return { decode: vi.fn().mockReturnValue([image]) };
    });
    vi.doMock("libheif-js/wasm-bundle", () => ({ default: Promise.resolve({ HeifDecoder }) }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({ stage: "decode" });

    expect(display).toHaveBeenCalledTimes(1);
    const [target] = display.mock.calls[0];
    expect(target.width).toBe(4);
    expect(target.height).toBe(3);
    expect(target.data).toBeInstanceOf(Uint8ClampedArray);
    expect(target.data.length).toBe(4 * 3 * 4);
  });

  it("throws a HeicDecodeStageError tagged \"decode\" when display()'s callback fires with a falsy value", async () => {
    const display = vi.fn((_target, callback) => callback(null));
    const image = { get_width: () => 2, get_height: () => 2, display, free: vi.fn() };
    const HeifDecoder = vi.fn().mockImplementation(function () {
      return { decode: vi.fn().mockReturnValue([image]) };
    });
    vi.doMock("libheif-js/wasm-bundle", () => ({ default: Promise.resolve({ HeifDecoder }) }));

    const { decodeHeicFileToJpegBlob, HeicDecodeStageError: ImportedError } = await import(
      "./heic-decode"
    );
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toBeInstanceOf(ImportedError);
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({ stage: "decode" });
  });

  it("throws a HeicDecodeStageError tagged \"decode\" when decoder.decode() itself throws", async () => {
    const HeifDecoder = vi.fn().mockImplementation(function () {
      return {
        decode: vi.fn().mockImplementation(() => {
          throw new Error("Could not parse HEIF file");
        }),
      };
    });
    vi.doMock("libheif-js/wasm-bundle", () => ({ default: Promise.resolve({ HeifDecoder }) }));

    const { decodeHeicFileToJpegBlob } = await import("./heic-decode");
    await expect(decodeHeicFileToJpegBlob(file)).rejects.toMatchObject({ stage: "decode" });
  });
});

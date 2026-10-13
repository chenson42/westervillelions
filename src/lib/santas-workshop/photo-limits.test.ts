import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_PIXELS, MAX_UPLOAD_BODY_BYTES, PHOTO_KINDS, PHOTO_LIMITS } from "./photo-limits";
import { makeJpeg } from "./photo-fixtures";
import { bodyTooLarge, readUploadParts, validatePhotoPart } from "./photo-upload";

const claim = (w: number, h: number) => ({ claimedWidth: w, claimedHeight: h });

describe("per-kind limits", () => {
  it("every kind has a limit, and only portrait and group carry a thumbnail", () => {
    expect(Object.keys(PHOTO_LIMITS).sort()).toEqual([...PHOTO_KINDS].sort());
    expect(PHOTO_LIMITS.check_in.thumb).toBeNull();
    expect(PHOTO_LIMITS.portrait.thumb).not.toBeNull();
    expect(PHOTO_LIMITS.group.thumb).not.toBeNull();
  });

  it("the numbers are the design's", () => {
    expect(PHOTO_LIMITS.check_in).toMatchObject({ maxLongEdge: 1280, maxBytes: 500 * 1024 });
    expect(PHOTO_LIMITS.portrait).toMatchObject({ maxLongEdge: 2400, maxBytes: Math.floor(1.5 * 1024 * 1024) });
    expect(PHOTO_LIMITS.group).toMatchObject({ maxLongEdge: 1920, maxBytes: 1024 * 1024 });
    expect(PHOTO_LIMITS.portrait.thumb).toEqual({ maxLongEdge: 480, maxBytes: 100 * 1024 });
    expect(MAX_UPLOAD_BODY_BYTES).toBe(2 * 1024 * 1024);
  });

  it("the limits live in one module that both the validator and the browser downscaler import", () => {
    const upload = readFileSync(join(__dirname, "photo-upload.ts"), "utf8");
    expect(upload).toMatch(/from "\.\/photo-limits"/);
    // No limit number is redefined in the validator.
    expect(upload).not.toMatch(/\b(1280|2400|1920|480)\b/);
  });
});

describe("validatePhotoPart", () => {
  it("accepts a JPEG whose header matches the claim", () => {
    const r = validatePhotoPart({ kind: "check_in", variant: "full", bytes: makeJpeg(1280, 960), ...claim(1280, 960) });
    expect(r).toMatchObject({ ok: true, width: 1280, height: 960 });
  });

  it("refuses a header that differs from the claim", () => {
    const r = validatePhotoPart({ kind: "check_in", variant: "full", bytes: makeJpeg(1280, 960), ...claim(1000, 960) });
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("refuses a pixel count over the cap before comparing anything else", () => {
    const r = validatePhotoPart({ kind: "portrait", variant: "full", bytes: makeJpeg(5000, 5000), ...claim(1, 1) });
    expect(5000 * 5000).toBeGreaterThan(MAX_PHOTO_PIXELS);
    expect(r).toMatchObject({ ok: false, code: "too_large" });
  });

  it("refuses a long edge over the kind's limit", () => {
    expect(validatePhotoPart({ kind: "check_in", variant: "full", bytes: makeJpeg(1281, 100), ...claim(1281, 100) })).toMatchObject({ ok: false, code: "too_large" });
    expect(validatePhotoPart({ kind: "portrait", variant: "thumb", bytes: makeJpeg(481, 100), ...claim(481, 100) })).toMatchObject({ ok: false, code: "too_large" });
  });

  it("refuses a part over its byte cap", () => {
    const big = makeJpeg(100, 100, { padBytes: PHOTO_LIMITS.check_in.maxBytes + 1 });
    expect(validatePhotoPart({ kind: "check_in", variant: "full", bytes: big, ...claim(100, 100) })).toMatchObject({ ok: false, code: "too_large" });
  });

  it("refuses a non-JPEG, an empty part and a thumb on a kind without one", () => {
    expect(validatePhotoPart({ kind: "check_in", variant: "full", bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47), ...claim(1, 1) })).toMatchObject({ ok: false, code: "not_jpeg" });
    expect(validatePhotoPart({ kind: "check_in", variant: "full", bytes: new Uint8Array(), ...claim(1, 1) })).toMatchObject({ ok: false, code: "not_jpeg" });
    expect(validatePhotoPart({ kind: "check_in", variant: "thumb", bytes: makeJpeg(10, 10), ...claim(10, 10) })).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

describe("combined body cap", () => {
  it("a Content-Length over 2 MB is refused before parsing", () => {
    expect(bodyTooLarge(String(MAX_UPLOAD_BODY_BYTES + 1))).toBe(true);
    expect(bodyTooLarge(String(MAX_UPLOAD_BODY_BYTES))).toBe(false);
    expect(bodyTooLarge(null)).toBe(false);
  });

  it("the parts are re-measured after parsing when no Content-Length was sent", async () => {
    const form = new FormData();
    form.set("meta", JSON.stringify({ photoId: "x" }));
    form.set("full", new Blob([new Uint8Array(MAX_UPLOAD_BODY_BYTES + 10)]), "full.jpg");
    const r = await readUploadParts(new Request("http://localhost/x", { method: "POST", body: form }));
    expect(r).toMatchObject({ ok: false, code: "too_large" });
  });

  it("reads meta, full and thumb", async () => {
    const form = new FormData();
    form.set("meta", JSON.stringify({ photoId: "x" }));
    form.set("full", new Blob([Uint8Array.of(1, 2, 3)]), "full.jpg");
    form.set("thumb", new Blob([Uint8Array.of(4)]), "thumb.jpg");
    const r = await readUploadParts(new Request("http://localhost/x", { method: "POST", body: form }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parts.meta).toEqual({ photoId: "x" });
      expect(Array.from(r.parts.full ?? [])).toEqual([1, 2, 3]);
      expect(Array.from(r.parts.thumb ?? [])).toEqual([4]);
    }
  });

  it("malformed meta JSON is invalid_input", async () => {
    const form = new FormData();
    form.set("meta", "{not json");
    const r = await readUploadParts(new Request("http://localhost/x", { method: "POST", body: form }));
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
  });
});

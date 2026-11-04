import { describe, expect, it } from "vitest";
import { SCENE_CAPTION_MAX, SCENE_REJECT_MESSAGES, SCENE_REJECT_REASONS, SCENE_TITLE_MAX } from "./scene-contract";
import { cleanSceneText, parseGroupSceneId, parseSceneOrder, validateSceneText } from "./scene-input";

const UUID = "3f2b8c1e-5a4d-4e6f-8a9b-0c1d2e3f4a5b";

const ok = (title: unknown, caption?: unknown) => validateSceneText({ title, caption });

describe("validateSceneText", () => {
  it("normalizes to NFC and trims", () => {
    const r = ok("  Café Visit  ", "  Hot cocoa  ");
    expect(r).toEqual({ ok: true, value: { title: "Café Visit", caption: "Hot cocoa" } });
  });

  it("turns controls, tabs and newlines into one space and collapses runs of whitespace", () => {
    const r = ok("The\tSleigh\r\n\u0007Arrives", "One\n\n\ntwo   three\u0085four");
    expect(r).toEqual({ ok: true, value: { title: "The Sleigh Arrives", caption: "One two three four" } });
  });

  it("strips zero-width and bidi control characters", () => {
    const r = ok("S​anta‮⁦ Arrives﻿");
    expect(r).toMatchObject({ ok: true, value: { title: "Santa Arrives" } });
  });

  it("counts length by code point at the 60 and 280 edges (emoji and combining marks)", () => {
    expect(ok("\u{1F385}".repeat(SCENE_TITLE_MAX))).toMatchObject({ ok: true });
    expect(ok("\u{1F385}".repeat(SCENE_TITLE_MAX + 1))).toMatchObject({ ok: false, field: "title", reason: "title_too_long" });
    // e + combining acute is two code points once NFC cannot compose it (q + acute)
    expect(ok("q́".repeat(30))).toMatchObject({ ok: true });
    expect(ok("q́".repeat(31))).toMatchObject({ ok: false, reason: "title_too_long" });
    expect(ok("T", "x".repeat(SCENE_CAPTION_MAX))).toMatchObject({ ok: true });
    expect(ok("T", "x".repeat(SCENE_CAPTION_MAX + 1))).toMatchObject({ ok: false, field: "caption", reason: "caption_too_long" });
    expect(ok("T", "\u{1F384}".repeat(SCENE_CAPTION_MAX))).toMatchObject({ ok: true });
  });

  it("rejects an empty or whitespace-only title", () => {
    for (const t of ["", "   ", "\n\t", "​"]) expect(ok(t)).toMatchObject({ ok: false, field: "title", reason: "title_required" });
  });

  it("an empty caption becomes null (absent, null, blank and non-string all mean no caption)", () => {
    for (const c of [undefined, null, "", "   ", 7, {}]) expect(ok("Title", c)).toEqual({ ok: true, value: { title: "Title", caption: null } });
  });

  it("rejects an email address, a link, a bare domain and a long number run", () => {
    expect(ok("Write to santa@example.com")).toMatchObject({ ok: false, field: "title", reason: "looks_like_email" });
    expect(ok("Ok", "see https://example.com")).toMatchObject({ ok: false, field: "caption", reason: "looks_like_link" });
    expect(ok("Visit www.example")).toMatchObject({ ok: false, reason: "looks_like_link" });
    expect(ok("example.org/photos")).toMatchObject({ ok: false, reason: "looks_like_link" });
    expect(ok("Call 614-555-0123")).toMatchObject({ ok: false, reason: "looks_like_phone" });
    expect(ok("Call (614) 555 0123")).toMatchObject({ ok: false, reason: "looks_like_phone" });
    expect(ok("Day 6145550123")).toMatchObject({ ok: false, reason: "looks_like_phone" });
  });

  it("accepts a date written like 'Dec 18-20, 2026' but not 2026-12-18", () => {
    expect(ok("Dec 18-20, 2026")).toMatchObject({ ok: true });
    expect(ok("2026-12-18")).toMatchObject({ ok: false, reason: "looks_like_phone" });
  });

  it("rejects non-string and missing input without throwing", () => {
    for (const t of [undefined, null, 5, {}, [], true]) expect(ok(t)).toMatchObject({ ok: false, reason: "title_required" });
    expect(validateSceneText(null)).toMatchObject({ ok: false, reason: "title_required" });
    expect(validateSceneText(undefined)).toMatchObject({ ok: false, reason: "title_required" });
  });

  it("every reject carries the sentence for its reason, and every reason has one", () => {
    const r = ok("a@b.co");
    expect(r).toMatchObject({ ok: false, error: SCENE_REJECT_MESSAGES.looks_like_email });
    for (const reason of SCENE_REJECT_REASONS) expect(SCENE_REJECT_MESSAGES[reason].length).toBeGreaterThan(5);
  });

  it("cleanSceneText is idempotent", () => {
    const once = cleanSceneText(" a​ \n b ");
    expect(cleanSceneText(once)).toBe(once);
  });
});

describe("parseGroupSceneId (sceneId parse)", () => {
  it("returns a valid uuid lower-cased, whatever its case", () => {
    expect(parseGroupSceneId({ sceneId: UUID })).toBe(UUID);
    expect(parseGroupSceneId({ sceneId: UUID.toUpperCase() })).toBe(UUID);
  });

  it("is null for malformed, empty, number, object, array, absent and null, and never throws", () => {
    const bad: unknown[] = [
      { sceneId: "not-a-uuid" },
      { sceneId: "" },
      { sceneId: 42 },
      { sceneId: { id: UUID } },
      { sceneId: [UUID] },
      { sceneId: null },
      { sceneId: `${UUID} ` },
      { sceneId: `${UUID}0` },
      {},
      null,
      undefined,
      "string",
      7,
      [UUID],
    ];
    for (const meta of bad) {
      expect(() => parseGroupSceneId(meta)).not.toThrow();
      expect(parseGroupSceneId(meta)).toBeNull();
    }
  });
});

describe("parseSceneOrder", () => {
  it("accepts a list of unique uuids (lower-cased) and nothing else", () => {
    expect(parseSceneOrder([UUID.toUpperCase()])).toEqual([UUID]);
    expect(parseSceneOrder([])).toEqual([]);
    expect(parseSceneOrder([UUID, UUID])).toBeNull();
    expect(parseSceneOrder(["x"])).toBeNull();
    expect(parseSceneOrder("nope")).toBeNull();
    expect(parseSceneOrder([1])).toBeNull();
    expect(parseSceneOrder(undefined)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { decideTagBind, last4, normalizeTagCode, TAG_CODE_MAX, type TagHolder, type TagTarget } from "./tag-binding";

const target = (over: Partial<TagTarget> = {}): TagTarget => ({ id: "t1", state: "registered", tagCode: null, ...over });
const holder = (over: Partial<TagHolder> = {}): TagHolder => ({ id: "h1", displayName: "Barnaby", state: "tagged", withdrawn: false, ...over });

describe("decideTagBind: one test per row of the collision table", () => {
  it("an unbound code binds to a stuffy with no sticker", () => {
    expect(decideTagBind({ target: target(), holder: null, code: "ABC" })).toEqual({ kind: "bind" });
  });

  it("the same stuffy holding the same code is a no-op (no history row)", () => {
    expect(decideTagBind({ target: target({ state: "tagged", tagCode: "ABC" }), holder: holder({ id: "t1", state: "tagged" }), code: "ABC" })).toEqual({ kind: "noop" });
    expect(decideTagBind({ target: target({ state: "tagged", tagCode: "ABC" }), holder: null, code: "ABC" })).toEqual({ kind: "noop" });
  });

  it("a code held by another tagged stuffy asks to confirm the move, naming it", () => {
    expect(decideTagBind({ target: target(), holder: holder(), code: "ABC" })).toEqual({ kind: "confirm_move", otherStuffyName: "Barnaby" });
  });

  it("a confirmed move names the holder to free", () => {
    expect(decideTagBind({ target: target(), holder: holder(), code: "ABC", confirm: "move" })).toEqual({ kind: "move", holderId: "h1", prevTagCode: null });
  });

  it("a withdrawn holder can have the sticker taken (asks first, then moves)", () => {
    const w = holder({ state: "checked_in", withdrawn: true });
    expect(decideTagBind({ target: target(), holder: w, code: "ABC" }).kind).toBe("confirm_move");
  });

  it("a code held by a stuffy already checked in or later is refused (admin fixes it)", () => {
    for (const state of ["checked_in", "portrait_taken", "picked_up"] as const) {
      expect(decideTagBind({ target: target(), holder: holder({ state }), code: "ABC", confirm: "move" })).toEqual({ kind: "holder_advanced", otherStuffyName: "Barnaby" });
    }
  });

  it("a target with a different sticker asks to confirm the replacement, showing the last 4", () => {
    expect(decideTagBind({ target: target({ state: "tagged", tagCode: "OLD-12345678" }), holder: null, code: "NEW" })).toEqual({ kind: "confirm_replace", oldLast4: "5678" });
  });

  it("a confirmed replacement carries the previous code (it will scan as retired)", () => {
    expect(decideTagBind({ target: target({ state: "tagged", tagCode: "OLD" }), holder: null, code: "NEW", confirm: "replace" })).toEqual({ kind: "replace", prevTagCode: "OLD" });
  });

  it("a target past tagged cannot be re-tagged", () => {
    expect(decideTagBind({ target: target({ state: "checked_in", tagCode: "ABC" }), holder: null, code: "XYZ" })).toEqual({ kind: "illegal" });
  });

  it("a code bound only in ANOTHER session decides exactly like an unbound one (the lookup is session-scoped)", () => {
    const unbound = decideTagBind({ target: target(), holder: null, code: "ABC" });
    const otherSession = decideTagBind({ target: target(), holder: null, code: "ABC" });
    expect(JSON.stringify(otherSession)).toBe(JSON.stringify(unbound));
  });

  it("identical-text stickers collide on the second bind and the card shows the last 4", () => {
    const first = decideTagBind({ target: target({ id: "a" }), holder: null, code: "https://vendor.example.invalid/s/0001" });
    expect(first.kind).toBe("bind");
    const second = decideTagBind({
      target: target({ id: "b" }),
      holder: holder({ id: "a", displayName: "Rufus" }),
      code: "https://vendor.example.invalid/s/0001",
    });
    expect(second).toEqual({ kind: "confirm_move", otherStuffyName: "Rufus" });
    expect(last4("https://vendor.example.invalid/s/0001")).toBe("0001");
  });
});

describe("normalizeTagCode", () => {
  it("trims and keeps the text exactly otherwise", () => {
    expect(normalizeTagCode("  Ab-12 ")).toEqual({ ok: true, code: "Ab-12" });
  });

  it("stores a scanned URL verbatim and never turns it into anything else", () => {
    const url = "https://vendor.example.invalid/x?y=1&z=%20";
    expect(normalizeTagCode(url)).toEqual({ ok: true, code: url });
  });

  it("rejects empty, over-long and control-character codes", () => {
    expect(normalizeTagCode("   ").ok).toBe(false);
    expect(normalizeTagCode(undefined).ok).toBe(false);
    expect(normalizeTagCode(42).ok).toBe(false);
    expect(normalizeTagCode("x".repeat(TAG_CODE_MAX)).ok).toBe(true);
    expect(normalizeTagCode("x".repeat(TAG_CODE_MAX + 1)).ok).toBe(false);
    expect(normalizeTagCode("a\u0000b").ok).toBe(false);
    expect(normalizeTagCode("a\nb").ok).toBe(false);
    expect(normalizeTagCode("a\u007fb").ok).toBe(false);
  });

  it("last4 is null for no sticker", () => {
    expect(last4(null)).toBeNull();
    expect(last4("AB")).toBe("AB");
  });
});

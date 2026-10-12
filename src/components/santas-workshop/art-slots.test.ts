import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { ART_SLOTS, SUPPLIED } from "./art-slots";

describe("art slot registry", () => {
  it("ids are unique and paths are local to /images/santas-workshop/", () => {
    const ids = ART_SLOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of ART_SLOTS) expect(s.path.startsWith("/images/santas-workshop/")).toBe(true);
  });

  it("aspect agrees with pixels within 1%", () => {
    for (const s of ART_SLOTS) {
      const [aw, ah] = s.aspect.split(":").map(Number);
      const [pw, ph] = s.pixels.split("x").map(Number);
      expect(Math.abs(aw / ah - pw / ph) / (aw / ah), s.id).toBeLessThan(0.01);
    }
  });

  it("every non-decorative slot has alt text", () => {
    for (const s of ART_SLOTS) if (!s.decorative) expect(s.alt.trim().length, s.id).toBeGreaterThan(0);
  });

  it("every SUPPLIED slot has its file under public/, and src is null otherwise", () => {
    for (const s of ART_SLOTS) {
      if (SUPPLIED.has(s.id)) {
        expect(s.src).toBe(s.path);
        expect(existsSync(path.join(process.cwd(), "public", s.path)), s.id).toBe(true);
      } else {
        expect(s.src).toBeNull();
      }
    }
  });

  it("no dropped prototype slot id remains", () => {
    const dropped = /^(scene-|stuffy-|book-cover|step-journey|conductor-stamp)/;
    for (const s of ART_SLOTS) expect(s.id, s.id).not.toMatch(dropped);
  });
});

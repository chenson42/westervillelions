import { describe, expect, it } from "vitest";
import { ART_SLOTS } from "./art-slots";
import { SCREENS } from "./screens";
import {
  DROPOFF_WINDOWS,
  EVENT_DATES,
  PICKUP_WINDOW,
  PRICE_DOLLARS,
  REGISTRATION_OPENS,
  SPOT_CAP,
  formatLongDate,
  weekdayIndex,
} from "./event-facts";

describe("art slot registry", () => {
  it("has unique ids and local paths", () => {
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

  it("describes every non-decorative slot", () => {
    for (const s of ART_SLOTS) if (!s.decorative) expect(s.alt.trim().length, s.id).toBeGreaterThan(0);
  });

  it("only lists real screens in usedOn", () => {
    const hrefs = SCREENS.map((s) => s.href);
    for (const s of ART_SLOTS) {
      expect(s.usedOn.length, s.id).toBeGreaterThan(0);
      for (const u of s.usedOn) expect(hrefs, `${s.id} -> ${u}`).toContain(u);
    }
  });
});

describe("event facts", () => {
  it("falls on Friday, Saturday and Sunday", () => {
    expect(weekdayIndex(EVENT_DATES.dropoff)).toBe(5);
    expect(weekdayIndex(EVENT_DATES.photos)).toBe(6);
    expect(weekdayIndex(EVENT_DATES.pickup)).toBe(0);
  });

  it("opens registration on a Sunday, before the event", () => {
    expect(weekdayIndex(REGISTRATION_OPENS)).toBe(0);
    expect(REGISTRATION_OPENS < EVENT_DATES.dropoff).toBe(true);
    expect(formatLongDate(REGISTRATION_OPENS)).toBe("Sunday, Nov 8");
  });

  it("pins the price and the cap the copy relies on", () => {
    expect(PRICE_DOLLARS).toBe(15);
    expect(SPOT_CAP).toBe(60);
  });

  it("orders drop-off windows without overlap", () => {
    DROPOFF_WINDOWS.forEach((w, i) => {
      expect(w.start < w.end).toBe(true);
      if (i > 0) expect(w.start >= DROPOFF_WINDOWS[i - 1].end).toBe(true);
    });
    expect(PICKUP_WINDOW.start < PICKUP_WINDOW.end).toBe(true);
  });
});

describe("SUPPLIED switch", () => {
  it("a slot's src is null until its id is listed, then equals its path", async () => {
    const mod = await import("./art-slots");
    for (const slot of mod.ART_SLOTS) {
      if (mod.SUPPLIED.has(slot.id)) expect(slot.src).toBe(slot.path);
      else expect(slot.src).toBeNull();
    }
  });
});

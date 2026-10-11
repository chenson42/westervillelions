import { describe, expect, it } from "vitest";
import { EVENT_DATES } from "./event-facts";
import { JOURNEY_STOPS, formatWallClock, stopStatus } from "./journey";
import { isArtSlotId } from "./art-slots";

describe("journey", () => {
  it("has strictly increasing 0-based order and non-decreasing wall-clock times", () => {
    JOURNEY_STOPS.forEach((s, i) => expect(s.order).toBe(i));
    JOURNEY_STOPS.forEach((s, i) => {
      expect(s.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      if (i > 0) expect(s.at >= JOURNEY_STOPS[i - 1].at).toBe(true);
    });
  });

  it("starts at check-in and ends at ready", () => {
    expect(JOURNEY_STOPS[0].id).toBe("checked-in");
    expect(JOURNEY_STOPS[JOURNEY_STOPS.length - 1].id).toBe("ready");
  });

  it("has exactly one current stop for every in-range position", () => {
    JOURNEY_STOPS.forEach((_, current) => {
      const statuses = JOURNEY_STOPS.map((s) => stopStatus(s, current));
      expect(statuses.filter((x) => x === "current")).toHaveLength(1);
      statuses.forEach((st, i) => {
        if (i < current) expect(st).toBe("done");
        if (i > current) expect(st).toBe("upcoming");
      });
    });
  });

  it("everything is upcoming before check-in (-1)", () => {
    expect(JOURNEY_STOPS.every((s) => stopStatus(s, -1) === "upcoming")).toBe(true);
  });

  it("formats wall-clock strings without touching time zones", () => {
    expect(formatWallClock("2026-12-11T18:20")).toBe("Fri 6:20 PM");
    expect(formatWallClock("2026-12-11T23:55")).toBe("Fri 11:55 PM");
    expect(formatWallClock("2026-12-12T00:05")).toBe("Sat 12:05 AM");
    expect(formatWallClock("2026-12-13T13:00")).toBe("Sun 1:00 PM");
  });

  it("uses registered photo slots", () => {
    for (const s of JOURNEY_STOPS) if (s.photoSlot) expect(isArtSlotId(s.photoSlot)).toBe(true);
  });

  it("agrees with the event dates (Friday, Saturday, Sunday)", () => {
    const days = JOURNEY_STOPS.map((s) => s.at.slice(0, 10));
    expect(days.slice(0, 2).every((d) => d === EVENT_DATES.dropoff)).toBe(true);
    expect(days.slice(2, 8).every((d) => d === EVENT_DATES.photos)).toBe(true);
    expect(days[8]).toBe(EVENT_DATES.pickup);
  });
});

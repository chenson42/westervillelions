import { describe, expect, it } from "vitest";
import { workshopNow } from "./clock";

const real = new Date("2026-10-12T12:00:00Z");

describe("workshopNow", () => {
  it("returns real time in production even when SANTAS_WORKSHOP_NOW is set", () => {
    expect(workshopNow({ NODE_ENV: "production", SANTAS_WORKSHOP_NOW: "2026-12-21T05:00:00Z" }, real)).toBe(real);
  });
  it("honors a strict ISO instant outside production", () => {
    expect(workshopNow({ NODE_ENV: "development", SANTAS_WORKSHOP_NOW: "2026-12-21T05:00:00Z" }, real).toISOString()).toBe(
      "2026-12-21T05:00:00.000Z",
    );
    expect(workshopNow({ SANTAS_WORKSHOP_NOW: "2026-12-21T00:00:00-05:00" }, real).toISOString()).toBe("2026-12-21T05:00:00.000Z");
  });
  it("ignores a date-only, empty or malformed override", () => {
    for (const v of ["2026-12-21", "", "tomorrow", "2026-12-21T05:00:00", "2026-13-45T00:00:00Z"]) {
      expect(workshopNow({ NODE_ENV: "development", SANTAS_WORKSHOP_NOW: v }, real)).toBe(real);
    }
    expect(workshopNow({ NODE_ENV: "development" }, real)).toBe(real);
  });
});

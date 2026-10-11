import { describe, expect, it } from "vitest";
import { LANDING_STATES, LANDING_STATE_COPY, isLandingState } from "./landing-state";

describe("landing states", () => {
  it("has the four states in order", () => {
    expect([...LANDING_STATES]).toEqual(["before", "open", "full", "after"]);
    for (const s of LANDING_STATES) expect(LANDING_STATE_COPY[s]).toBeDefined();
  });

  it("only the open state has an enabled CTA, the form, and the pinned bar", () => {
    for (const s of LANDING_STATES) {
      const c = LANDING_STATE_COPY[s];
      const isOpen = s === "open";
      expect(c.ctaEnabled).toBe(isOpen);
      expect(c.formCard === "form").toBe(isOpen);
      expect(c.pinnedReserve).toBe(isOpen);
    }
  });

  it("uses a distinct form card per state", () => {
    const kinds = LANDING_STATES.map((s) => LANDING_STATE_COPY[s].formCard);
    expect(new Set(kinds).size).toBe(4);
  });

  it("never promises counts, deductibility, or donations", () => {
    for (const s of LANDING_STATES) {
      const text = JSON.stringify(LANDING_STATE_COPY[s]).toLowerCase();
      expect(text).not.toContain("spots left");
      expect(text).not.toContain("tax-deductible");
      expect(text).not.toContain("donat");
    }
  });

  it("isLandingState accepts the four and rejects everything else", () => {
    for (const s of LANDING_STATES) expect(isLandingState(s)).toBe(true);
    for (const bad of ["", "OPEN", null, "open ", {}, undefined, 3]) {
      expect(isLandingState(bad)).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { canRevert, canTransition, isBackward, isPickupAllowedFrom, isStuffyState, STUFFY_STATES, type StuffyState } from "./state-machine";

const LEGAL: [StuffyState, StuffyState][] = [
  ["registered", "tagged"],
  ["tagged", "checked_in"],
  ["checked_in", "portrait_taken"],
  ["checked_in", "picked_up"],
  ["portrait_taken", "picked_up"],
];

describe("state machine", () => {
  it.each(LEGAL)("%s -> %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("every other pair is illegal, including skipping states", () => {
    for (const from of STUFFY_STATES) {
      for (const to of STUFFY_STATES) {
        const legal = LEGAL.some(([a, b]) => a === from && b === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal);
      }
    }
    expect(canTransition("tagged", "picked_up")).toBe(false);
    expect(canTransition("registered", "checked_in")).toBe(false);
  });

  it("pickup is allowed from checked_in and portrait_taken only", () => {
    expect(STUFFY_STATES.filter(isPickupAllowedFrom)).toEqual(["checked_in", "portrait_taken"]);
  });

  it("nothing leaves picked_up going forward", () => {
    for (const to of STUFFY_STATES) expect(canTransition("picked_up", to)).toBe(false);
  });

  it("a backward move is recognised, a forward one is not", () => {
    expect(isBackward("picked_up", "registered")).toBe(true);
    expect(isBackward("portrait_taken", "checked_in")).toBe(true);
    expect(isBackward("tagged", "tagged")).toBe(false);
    expect(isBackward("tagged", "checked_in")).toBe(false);
  });

  it("canRevert: an admin always may, crew only on a practice session", () => {
    expect(canRevert("admin", "real")).toBe(true);
    expect(canRevert("admin", "practice")).toBe(true);
    expect(canRevert("crew", "practice")).toBe(true);
    expect(canRevert("crew", "real")).toBe(false);
  });

  it("isStuffyState narrows unknown strings", () => {
    expect(isStuffyState("tagged")).toBe(true);
    expect(isStuffyState("nope")).toBe(false);
  });
});

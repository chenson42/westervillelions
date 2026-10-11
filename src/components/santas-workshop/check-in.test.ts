import { describe, expect, it } from "vitest";
import { countBoarded, filterRoster, toggleBoarded } from "./check-in";
import { SAMPLE_STUFFIES } from "./sample-data";

describe("check-in helpers", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(filterRoster(SAMPLE_STUFFIES, "")).toHaveLength(24);
    expect(filterRoster(SAMPLE_STUFFIES, "   ")).toHaveLength(24);
  });

  it("matches name, kind and tag case-insensitively", () => {
    expect(filterRoster(SAMPLE_STUFFIES, "PIP").map((r) => r.name)).toContain("Pip");
    expect(filterRoster(SAMPLE_STUFFIES, "penguin").length).toBeGreaterThanOrEqual(2);
    expect(filterRoster(SAMPLE_STUFFIES, "b-07").map((r) => r.tag)).toEqual(["B-07"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterRoster(SAMPLE_STUFFIES, "zzzz")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const copy = JSON.stringify(SAMPLE_STUFFIES);
    filterRoster(SAMPLE_STUFFIES, "bear");
    toggleBoarded(SAMPLE_STUFFIES, "A-01");
    expect(JSON.stringify(SAMPLE_STUFFIES)).toBe(copy);
  });

  it("toggles only the target tag and counts agree", () => {
    const before = countBoarded(SAMPLE_STUFFIES);
    const toggled = toggleBoarded(SAMPLE_STUFFIES, "B-07");
    expect(toggled).not.toBe(SAMPLE_STUFFIES);
    expect(countBoarded(toggled)).toBe(before + 1);
    expect(toggled.filter((r, i) => r.boarded !== SAMPLE_STUFFIES[i].boarded).map((r) => r.tag)).toEqual(["B-07"]);
    expect(countBoarded(toggleBoarded(toggled, "B-07"))).toBe(before);
  });
});

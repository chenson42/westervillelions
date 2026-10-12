import { describe, expect, it } from "vitest";
import { WORKSHOP_2026 } from "./facts";
import { getPublicWorkshopFacts } from "./public-facts";

describe("getPublicWorkshopFacts", () => {
  it("returns a Promise (the seam is async)", () => {
    expect(getPublicWorkshopFacts()).toBeInstanceOf(Promise);
  });
  it("resolves to WORKSHOP_2026", async () => {
    expect(await getPublicWorkshopFacts()).toBe(WORKSHOP_2026);
  });
});

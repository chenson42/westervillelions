/**
 * Unit tests for src/lib/member-address.ts — the shared "never render an
 * empty label or a stray comma" formatting rule from the Printable Member
 * Directory Phase 1/3 design (docs/work-log/2026-08-07-printable-member-
 * directory.md). Pure functions, no DB/mocking needed.
 */

import { describe, it, expect } from "vitest";
import { formatCityStateZip, hasAnyAddress } from "./member-address";

describe("formatCityStateZip", () => {
  it("joins city, state, and zip with no stray comma when all three are present", () => {
    expect(formatCityStateZip("Westerville", "OH", "43081")).toBe("Westerville, OH 43081");
  });

  it("omits the city when only state/zip are present, with no leading comma", () => {
    expect(formatCityStateZip(null, "OH", "43081")).toBe("OH 43081");
  });

  it("omits state/zip when only city is present, with no trailing comma", () => {
    expect(formatCityStateZip("Westerville", null, null)).toBe("Westerville");
  });

  it("omits zip when only city/state are present", () => {
    expect(formatCityStateZip("Westerville", "OH", null)).toBe("Westerville, OH");
  });

  it("returns an empty string when nothing is present", () => {
    expect(formatCityStateZip(null, null, null)).toBe("");
  });

  it("treats empty strings the same as null", () => {
    expect(formatCityStateZip("", "", "")).toBe("");
    expect(formatCityStateZip("Westerville", "", "")).toBe("Westerville");
  });
});

describe("hasAnyAddress", () => {
  it("is true when any single field is present", () => {
    expect(hasAnyAddress({ address: "123 Main St", city: null, state: null, zip: null })).toBe(true);
    expect(hasAnyAddress({ address: null, city: "Westerville", state: null, zip: null })).toBe(true);
    expect(hasAnyAddress({ address: null, city: null, state: "OH", zip: null })).toBe(true);
    expect(hasAnyAddress({ address: null, city: null, state: null, zip: "43081" })).toBe(true);
  });

  it("is false when every field is null", () => {
    expect(hasAnyAddress({ address: null, city: null, state: null, zip: null })).toBe(false);
  });
});

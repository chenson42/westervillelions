import { describe, it, expect } from "vitest";
import { isUuid } from "./utils";

describe("isUuid", () => {
  it("accepts a v4 UUID in either case", () => {
    expect(isUuid("123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(isUuid("123E4567-E89B-42D3-A456-426614174000")).toBe(true);
  });

  it("rejects malformed values", () => {
    for (const v of ["", "abc", "1", "123e4567-e89b-42d3-a456-426614174000x", "1'; DROP TABLE x;--"]) {
      expect(isUuid(v)).toBe(false);
    }
  });
});

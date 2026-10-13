import { describe, expect, it } from "vitest";
import { parseExportedItems } from "./frame-export-input";

const A = "22222222-2222-4222-8222-222222222221";
const B = "33333333-3333-4333-8333-333333333331";

describe("parseExportedItems", () => {
  it("accepts well-formed items and drops extra fields", () => {
    expect(parseExportedItems({ items: [{ stuffyId: A, photoId: B, frameNumber: 3, extra: "x" }] })).toEqual([{ stuffyId: A, photoId: B, frameNumber: 3 }]);
  });
  it("rejects bad shapes", () => {
    for (const body of [null, {}, { items: "x" }, { items: [{ stuffyId: "nope", photoId: B, frameNumber: 1 }] }, { items: [{ stuffyId: A, photoId: B, frameNumber: 0 }] }, { items: [{ stuffyId: A, photoId: B, frameNumber: 1.5 }] }, { items: Array(501).fill({ stuffyId: A, photoId: B, frameNumber: 1 }) }]) {
      expect(parseExportedItems(body)).toBeNull();
    }
  });
  it("accepts an empty list", () => {
    expect(parseExportedItems({ items: [] })).toEqual([]);
  });
});

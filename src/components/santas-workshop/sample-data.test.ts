import { describe, expect, it } from "vitest";
import { DROPOFF_WINDOWS } from "./event-facts";
import { SAMPLE_BOOK_CAPTIONS, SAMPLE_JOURNEY_STUFFY, SAMPLE_STUFFIES } from "./sample-data";
import { JOURNEY_STOPS } from "./journey";
import { isArtSlotId } from "./art-slots";

function walk(value: unknown, visit: (v: string, key: string) => void, key = ""): void {
  if (typeof value === "string") visit(value, key);
  else if (Array.isArray(value)) value.forEach((v) => walk(v, visit, key));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k);
  }
}

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

const STRUCTURES = {
  SAMPLE_STUFFIES,
  SAMPLE_JOURNEY_STUFFY,
  SAMPLE_BOOK_CAPTIONS,
  JOURNEY_STOPS,
};

describe("sample data hygiene", () => {
  it("contains no email, url, phone or street-address shapes", () => {
    for (const [name, data] of Object.entries(STRUCTURES)) {
      walk(data, (v) => {
        expect(v, `${name}: ${v}`).not.toMatch(/@/);
        expect(v, `${name}: ${v}`).not.toMatch(/http|www\./i);
        expect(v, `${name}: ${v}`).not.toMatch(/\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}/);
        expect(v, `${name}: ${v}`).not.toMatch(
          /\d+\s+\w+\s+(st|street|ave|avenue|road|rd|dr|drive|lane|ln|blvd)\b/i,
        );
      });
    }
  });

  it("has no personal-data keys", () => {
    for (const [name, data] of Object.entries(STRUCTURES)) {
      for (const k of keysOf(data)) {
        expect(k, `${name} key ${k}`).not.toMatch(/child|parent|email|phone|address|surname|contact/i);
      }
    }
  });

  it("has exactly 24 rows with unique, well-formed tags and family labels", () => {
    expect(SAMPLE_STUFFIES).toHaveLength(24);
    const tags = SAMPLE_STUFFIES.map((s) => s.tag);
    expect(new Set(tags).size).toBe(24);
    for (const s of SAMPLE_STUFFIES) {
      expect(s.tag).toMatch(/^[A-Z]-\d{2}$/);
      expect(s.familyLabel).toMatch(/^Family \d{2}$/);
    }
  });

  it("only references drop-off windows that exist", () => {
    const ids = DROPOFF_WINDOWS.map((w) => w.id);
    for (const s of SAMPLE_STUFFIES) expect(ids).toContain(s.windowId);
  });

  it("only references art slots that are registered", () => {
    for (const stop of JOURNEY_STOPS) {
      if (stop.photoSlot) expect(isArtSlotId(stop.photoSlot)).toBe(true);
    }
  });
});

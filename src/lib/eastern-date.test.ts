import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { easternDateString } from "./eastern-date";

describe("easternDateString", () => {
  it("uses the Eastern calendar day, not the UTC day", () => {
    expect(easternDateString(new Date("2026-11-01T02:00:00Z"))).toBe("2026-10-31");
    expect(easternDateString(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
  });

  it("rolls over at 05:00Z in EST: 2026-11-08T04:59:59Z is Nov 7 and 05:00:00Z is Nov 8", () => {
    expect(easternDateString(new Date("2026-11-08T04:59:59Z"))).toBe("2026-11-07");
    expect(easternDateString(new Date("2026-11-08T05:00:00Z"))).toBe("2026-11-08");
  });

  it("still reads Oct 31 at 03:59Z on Nov 1 (EDT)", () => {
    expect(easternDateString(new Date("2026-11-01T03:59:59Z"))).toBe("2026-10-31");
  });

  it("never passes a string to new Date() in eastern-date.ts", () => {
    const src = readFileSync(path.join(__dirname, "eastern-date.ts"), "utf8");
    expect(src).not.toMatch(/new Date\(\s*["'`A-Za-z]/);
  });
});

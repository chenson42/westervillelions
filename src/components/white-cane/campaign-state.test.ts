import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { campaignState } from "./campaign-state";

const URL_SET = "https://www.zeffy.com/donation-form/abc";

describe("campaignState (annual window, Eastern time)", () => {
  it("is live at 23:59:59 ET on Oct 31", () => {
    expect(campaignState(new Date("2026-11-01T03:59:59Z"), URL_SET)).toBe("live");
  });
  it("is closed at 00:00:00 ET on Nov 1", () => {
    expect(campaignState(new Date("2026-11-01T04:00:00Z"), URL_SET)).toBe("closed");
  });
  it("is live at 22:00 ET Oct 31 even though the UTC date is already Nov 1", () => {
    expect(campaignState(new Date("2026-11-01T02:00:00Z"), URL_SET)).toBe("live");
  });
  it("treats the Oct 15 start as copy, not a gate", () => {
    expect(campaignState(new Date("2026-10-14T16:00:00Z"), URL_SET)).toBe("live");
  });
  it("opens on Sep 15 and is closed the day before", () => {
    expect(campaignState(new Date("2026-09-14T16:00:00Z"), URL_SET)).toBe("closed");
    expect(campaignState(new Date("2026-09-15T04:00:00Z"), URL_SET)).toBe("live");
  });
  it("is closed in the off-season and reopens the next year without a code change", () => {
    expect(campaignState(new Date("2027-01-10T16:00:00Z"), URL_SET)).toBe("closed");
    expect(campaignState(new Date("2027-10-20T16:00:00Z"), URL_SET)).toBe("live");
  });
  it("is pre-form for an empty or whitespace URL inside the window", () => {
    const now = new Date("2026-10-20T16:00:00Z");
    expect(campaignState(now, "")).toBe("pre-form");
    expect(campaignState(now, "   ")).toBe("pre-form");
  });
  it("is closed outside the window even with no URL", () => {
    expect(campaignState(new Date("2026-11-05T16:00:00Z"), "")).toBe("closed");
  });
});

describe("campaign-state.ts source", () => {
  it("never passes a string to new Date()", () => {
    const src = readFileSync(path.join(__dirname, "campaign-state.ts"), "utf8");
    expect(src).not.toMatch(/new Date\(\s*["'`A-Za-z]/);
  });
});

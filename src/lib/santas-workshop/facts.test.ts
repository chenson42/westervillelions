import { describe, expect, it } from "vitest";
import { toEmbedUrl } from "@/components/campaigns/zeffy-url";
import { WORKSHOP_2026, validateWorkshopFacts, type WorkshopFacts } from "./facts";
import { formatDateRange, formatLongDate, formatShortDate, formatTimeRange, weekdayIndex } from "./format";

const w = (over: Partial<WorkshopFacts>): WorkshopFacts => ({ ...WORKSHOP_2026, ...over });

describe("WORKSHOP_2026", () => {
  it("has no validation problems", () => {
    expect(validateWorkshopFacts(WORKSHOP_2026)).toEqual([]);
  });

  it("the event days are Friday, Saturday and Sunday, consecutive", () => {
    const d = WORKSHOP_2026.dates;
    expect([d.dropoff, d.photos, d.pickup].map(weekdayIndex)).toEqual([5, 6, 0]);
  });

  it("registration opens Sunday Nov 8 2026 and the price is 15", () => {
    expect(WORKSHOP_2026.registrationOpens).toBe("2026-11-08");
    expect(weekdayIndex("2026-11-08")).toBe(0);
    expect(WORKSHOP_2026.priceDollars).toBe(15);
  });

  it('the three windows tile 4:00 to 7:00 PM and print exactly "4:00 to 5:00 PM", "5:00 to 6:00 PM", "6:00 to 7:00 PM"', () => {
    expect(WORKSHOP_2026.windows.map((x) => formatTimeRange(x.start, x.end))).toEqual([
      "4:00 to 5:00 PM",
      "5:00 to 6:00 PM",
      "6:00 to 7:00 PM",
    ]);
    expect(WORKSHOP_2026.windows[0].start).toBe("16:00");
    expect(WORKSHOP_2026.windows[2].end).toBe("19:00");
  });

  it('pickup prints "1:00 to 3:00 PM" and the date range prints "Dec 18 to 20"', () => {
    expect(formatTimeRange(WORKSHOP_2026.pickup.start, WORKSHOP_2026.pickup.end)).toBe("1:00 to 3:00 PM");
    expect(formatDateRange(WORKSHOP_2026.dates)).toBe("Dec 18 to 20");
  });

  it("formats long and short dates", () => {
    expect(formatLongDate("2026-12-18")).toBe("Friday, Dec 18");
    expect(formatShortDate("2026-12-18")).toBe("Fri, Dec 18");
  });

  it("formatTimeRange prints the meridiem once when it matches and twice when it differs", () => {
    expect(formatTimeRange("16:00", "17:00")).toBe("4:00 to 5:00 PM");
    expect(formatTimeRange("11:00", "13:00")).toBe("11:00 AM to 1:00 PM");
  });
});

describe("validateWorkshopFacts rejects", () => {
  const cases: [string, WorkshopFacts][] = [
    ["a malformed date", w({ registrationOpens: "2026-13-40" })],
    ["non-consecutive days", w({ dates: { dropoff: "2026-12-18", photos: "2026-12-19", pickup: "2026-12-27" } })],
    ["wrong weekdays", w({ dates: { dropoff: "2026-12-17", photos: "2026-12-18", pickup: "2026-12-19" } })],
    ["lastSignupDay before registrationOpens", w({ lastSignupDay: "2026-11-01" })],
    ["lastSignupDay on drop-off", w({ lastSignupDay: "2026-12-18" })],
    ["overlapping windows", w({ windows: [{ id: "a", start: "16:00", end: "17:30" }, { id: "b", start: "17:00", end: "18:00" }] })],
    ["gapped windows", w({ windows: [{ id: "a", start: "16:00", end: "17:00" }, { id: "b", start: "17:30", end: "18:00" }] })],
    ["start not before end", w({ windows: [{ id: "a", start: "17:00", end: "16:00" }] })],
    ["a zero price", w({ priceDollars: 0 })],
    ["a fractional price", w({ priceDollars: 12.5 })],
    ["an http Zeffy URL", w({ zeffyShareUrl: "http://www.zeffy.com/ticketing/x" })],
    ["a non-zeffy host", w({ zeffyShareUrl: "https://example.invalid/ticketing/x" })],
    ["a /donation-form/ path", w({ zeffyShareUrl: "https://www.zeffy.com/donation-form/x" })],
    ["a URL with a query string", w({ zeffyShareUrl: "https://www.zeffy.com/ticketing/x?a=1" })],
    ["a collagePath outside /santas-workshop/c/", w({ collagePath: "/elsewhere/c" })],
    ["a deletion date before pickup", w({ signupDataDeletedBy: "2026-12-19" })],
    ["a beneficiary name missing from the sentence", w({ beneficiaries: { names: ["Nobody Foundation"], sentence: "Supports others." } })],
  ];
  it.each(cases)("%s", (_name, facts) => {
    expect(validateWorkshopFacts(facts).length).toBeGreaterThan(0);
  });

  it("accepts an empty zeffyShareUrl (form not built yet)", () => {
    expect(validateWorkshopFacts(w({ zeffyShareUrl: "" }))).toEqual([]);
  });

  it("accepts a ticketing share link and a collagePath under the prefix", () => {
    expect(validateWorkshopFacts(w({ zeffyShareUrl: "https://www.zeffy.com/ticketing/abc", collagePath: "/santas-workshop/c/token" }))).toEqual([]);
  });
});

describe("toEmbedUrl on a ticketing share link", () => {
  it.each(["https://www.zeffy.com/ticketing/abc", "https://www.zeffy.com/en-US/ticketing/abc"])(
    "yields host www.zeffy.com and a path starting /embed/ for %s",
    (link) => {
      const u = new URL(toEmbedUrl(link));
      expect(u.hostname).toBe("www.zeffy.com");
      expect(u.pathname.startsWith("/embed/")).toBe(true);
    },
  );
});

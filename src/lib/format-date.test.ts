import { describe, it, expect, afterEach } from "vitest";
import { formatCalendarDate, formatTimestamp, parseCalendarDate } from "./format-date";

describe("formatCalendarDate", () => {
  it("formats a 'YYYY-MM-DD' string with the default (short) style", () => {
    expect(formatCalendarDate("2026-08-08")).toBe("Aug 8, 2026");
  });

  it("supports the long style", () => {
    expect(formatCalendarDate("2026-08-08", "long")).toBe("August 8, 2026");
  });

  it("supports the full style (adds weekday)", () => {
    // 2026-08-08 is a Saturday.
    expect(formatCalendarDate("2026-08-08", "full")).toBe("Saturday, August 8, 2026");
  });

  it("renders the same calendar day regardless of the process TZ", () => {
    const originalTz = process.env.TZ;
    try {
      // Pacific/Midway (UTC-11) is far enough behind UTC that a bare
      // `new Date("2026-08-15")` would parse as UTC midnight and read back
      // as August 14 local — the naive-timestamp-as-UTC bug class this
      // project has hit before (DECISION-001, DECISION-015, the 2026-08
      // meeting-schedule import, ack-queue.tsx on 2026-09-10).
      process.env.TZ = "Pacific/Midway";
      expect(formatCalendarDate("2026-08-15")).toBe("Aug 15, 2026");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("renders the same calendar day in a timezone ahead of UTC too", () => {
    const originalTz = process.env.TZ;
    try {
      // Pacific/Kiritimati (UTC+14) — a bare `new Date(dateStr)` would read
      // as the NEXT calendar day here, the opposite-direction failure mode.
      process.env.TZ = "Pacific/Kiritimati";
      expect(formatCalendarDate("2026-08-15")).toBe("Aug 15, 2026");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe("parseCalendarDate", () => {
  it("returns a local Date matching the given y/m/d, not a UTC-shifted one", () => {
    const d = parseCalendarDate("2026-07-01");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // 0-indexed: July
    expect(d.getDate()).toBe(1);
  });

  it("stays on the correct calendar day across the fiscal-year boundary under a hostile TZ", () => {
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Midway";
      const d = parseCalendarDate("2026-07-01");
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6);
      expect(d.getDate()).toBe(1);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe("formatTimestamp", () => {
  afterEach(() => {
    // no-op; individual tests restore TZ themselves
  });

  it("formats a full ISO instant string with the default (short) style", () => {
    // Use a time comfortably clear of midnight so the local rendering is
    // stable across reasonable timezones actually used in this suite.
    expect(formatTimestamp("2026-08-08T15:30:00Z")).toBe("Aug 8, 2026");
  });

  it("supports the long style", () => {
    expect(formatTimestamp("2026-08-08T15:30:00Z", "long")).toBe("August 8, 2026");
  });

  it("accepts an already-parsed Date object directly", () => {
    const d = new Date(2026, 7, 8); // local Aug 8, 2026
    expect(formatTimestamp(d)).toBe("Aug 8, 2026");
  });

  it("is intentionally a UTC-sensitive parse — unlike formatCalendarDate, a bare instant string legitimately shifts calendar day near midnight under an extreme TZ (this is correct behavior for a real instant, not a bug)", () => {
    const originalTz = process.env.TZ;
    try {
      // 2026-08-15T00:30:00Z is 2026-08-14 13:30 local in Pacific/Midway
      // (UTC-11) — correctly a different calendar day, because this IS a
      // real instant with a real UTC offset, not a bare date-only string.
      process.env.TZ = "Pacific/Midway";
      expect(formatTimestamp("2026-08-15T00:30:00Z")).toBe("Aug 14, 2026");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

import { describe, it, expect } from "vitest";
import { buildRecentMonthOptions, ensureMonthOption } from "./financial-report-ui";

describe("buildRecentMonthOptions", () => {
  it("returns `count` options, most-recent-first, ending at latestOpenMonth", () => {
    const options = buildRecentMonthOptions("2026-06", 3);
    expect(options.map((o) => o.value)).toEqual(["2026-06", "2026-05", "2026-04"]);
    expect(options[0].label).toBe("June 2026");
    expect(options[1].label).toBe("May 2026");
    expect(options[2].label).toBe("April 2026");
  });

  it("rolls over the year boundary (December -> January)", () => {
    const options = buildRecentMonthOptions("2026-01", 3);
    expect(options.map((o) => o.value)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });

  it("defaults to RECENT_MONTHS_WINDOW (24) entries when count is omitted", () => {
    const options = buildRecentMonthOptions("2026-06");
    expect(options).toHaveLength(24);
    expect(options[0].value).toBe("2026-06");
    expect(options[23].value).toBe("2024-07");
  });
});

describe("ensureMonthOption", () => {
  it("returns the original list unchanged when month is already present", () => {
    const options = buildRecentMonthOptions("2026-06", 3);
    const result = ensureMonthOption(options, "2026-05");
    expect(result).toEqual(options);
  });

  it("prepends a synthetic entry when month is missing (e.g. a future/gated month)", () => {
    const options = buildRecentMonthOptions("2026-06", 3);
    const result = ensureMonthOption(options, "2026-07");
    expect(result[0]).toEqual({ value: "2026-07", label: "July 2026" });
    expect(result.slice(1)).toEqual(options);
  });
});

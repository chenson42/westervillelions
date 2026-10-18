import { describe, it, expect } from "vitest";
import {
  DEFAULT_FUND_LABELS,
  buildFundLabels,
  fundExplainer,
  fundKindBadge,
  fundLabel,
  refName,
} from "./ledger-fund-labels";

describe("ledger-fund-labels (DECISION-127)", () => {
  it("defaults name the Club's public fund Public Funds and contain no Activity", () => {
    expect(DEFAULT_FUND_LABELS.activity).toBe("Public Funds");
    expect(Object.values(DEFAULT_FUND_LABELS).join(" ")).not.toMatch(/Activity/);
  });

  it("stored names win over defaults", () => {
    const labels = buildFundLabels([
      { kind: "activity", name: "Activity Fund", isActive: true },
      { kind: "charitable", name: "Foundation Giving", isActive: true },
    ]);
    expect(labels.activity).toBe("Activity Fund");
    expect(labels.charitable).toBe("Foundation Giving");
    expect(labels.administrative).toBe("Administrative Fund");
  });

  it("an active fund beats a deactivated one of the same kind, in either row order", () => {
    const rows = [
      { kind: "activity", name: "Old Name", isActive: false },
      { kind: "activity", name: "Current Name", isActive: true },
    ];
    expect(buildFundLabels(rows).activity).toBe("Current Name");
    expect(buildFundLabels([...rows].reverse()).activity).toBe("Current Name");
  });

  it("the first active row of a kind wins; a lone inactive row still names its kind", () => {
    expect(
      buildFundLabels([
        { kind: "activity", name: "First", isActive: true },
        { kind: "activity", name: "Second", isActive: true },
      ]).activity,
    ).toBe("First");
    expect(buildFundLabels([{ kind: "activity", name: "Only Inactive", isActive: false }]).activity).toBe(
      "Only Inactive",
    );
  });

  it("unknown kinds and blank names fall back", () => {
    const labels = buildFundLabels([
      { kind: "mystery", name: "Mystery Fund", isActive: true },
      { kind: "activity", name: "   ", isActive: true },
    ]);
    expect(labels).toEqual(DEFAULT_FUND_LABELS);
    expect(fundLabel("mystery")).toBe("mystery");
    expect(fundLabel("activity")).toBe("Public Funds");
  });

  it("refName prefers the descriptor's own name, else the kind default", () => {
    expect(refName({ kind: "activity", name: "Community Pool" })).toBe("Community Pool");
    expect(refName({ kind: "activity", name: "  " })).toBe("Public Funds");
    expect(refName({ kind: "activity" })).toBe("Public Funds");
  });

  it("fundKindBadge is a static noun for the kind", () => {
    expect(fundKindBadge("activity")).toBe("Public");
    expect(fundKindBadge("administrative")).toBe("Administrative");
    expect(fundKindBadge("charitable")).toBe("Charitable");
    expect(fundKindBadge("scholarship")).toBe("Scholarship");
    expect(fundKindBadge("other")).toBe("other");
  });

  it("fundExplainer reads the stored name when given labels", () => {
    expect(fundExplainer("activity", { ...DEFAULT_FUND_LABELS, activity: "Community Money" })).toMatch(
      /^Community Money is the Lions International Activities account/,
    );
  });

  it("fundExplainer exists only for the public fund", () => {
    expect(fundExplainer("activity")).toContain("Lions International Activities");
    expect(fundExplainer("administrative")).toBeNull();
  });
});

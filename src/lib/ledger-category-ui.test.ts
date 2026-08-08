import { describe, it, expect } from "vitest";
import {
  filterCategoryRows,
  groupCategoriesByFundKind,
  getMergeDestinationOptions,
  fundKindLabel,
  isPriorFiscalYearMergeRefusal,
  type AdminCategoryRow,
} from "./ledger-category-ui";

function row(overrides: Partial<AdminCategoryRow> = {}): AdminCategoryRow {
  return {
    id: "id-1",
    name: "Category",
    fundKind: "activity",
    flow: "expense",
    sortOrder: 0,
    isActive: true,
    countsAsGiving: true,
    form990Line: null,
    ...overrides,
  };
}

describe("filterCategoryRows", () => {
  it("excludes inactive rows by default", () => {
    const rows = [row({ id: "a", isActive: true }), row({ id: "b", isActive: false })];
    expect(filterCategoryRows(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("includes inactive rows when showInactive is true", () => {
    const rows = [row({ id: "a", isActive: true }), row({ id: "b", isActive: false })];
    expect(filterCategoryRows(rows, { showInactive: true }).map((r) => r.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("filters by fundKind", () => {
    const rows = [
      row({ id: "a", fundKind: "activity" }),
      row({ id: "b", fundKind: "charitable" }),
    ];
    expect(filterCategoryRows(rows, { fundKind: "charitable" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("filters by flow", () => {
    const rows = [row({ id: "a", flow: "income" }), row({ id: "b", flow: "expense" })];
    expect(filterCategoryRows(rows, { flow: "income" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("matches search case-insensitively as a substring", () => {
    const rows = [row({ id: "a", name: "Program Supplies" }), row({ id: "b", name: "Awards" })];
    expect(filterCategoryRows(rows, { search: "supp" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterCategoryRows(rows, { search: "AWARDS" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("combines every filter together", () => {
    const rows = [
      row({ id: "a", fundKind: "activity", flow: "expense", isActive: true, name: "Bags to Benches" }),
      row({ id: "b", fundKind: "activity", flow: "expense", isActive: false, name: "Bags to Bins" }),
      row({ id: "c", fundKind: "charitable", flow: "expense", isActive: true, name: "Bags to Benches" }),
    ];
    expect(
      filterCategoryRows(rows, { fundKind: "activity", flow: "expense", search: "bags" }).map(
        (r) => r.id,
      ),
    ).toEqual(["a"]);
  });
});

describe("groupCategoriesByFundKind", () => {
  it("orders known fund kinds administrative, charitable, activity, scholarship", () => {
    const rows = [
      row({ id: "a", fundKind: "scholarship" }),
      row({ id: "b", fundKind: "administrative" }),
      row({ id: "c", fundKind: "activity" }),
      row({ id: "d", fundKind: "charitable" }),
    ];
    expect(groupCategoriesByFundKind(rows).map((g) => g.fundKind)).toEqual([
      "administrative",
      "charitable",
      "activity",
      "scholarship",
    ]);
  });

  it("omits fund kinds with zero matching rows", () => {
    const rows = [row({ id: "a", fundKind: "activity" })];
    const groups = groupCategoriesByFundKind(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].fundKind).toBe("activity");
  });

  it("splits income and expense within a fund kind", () => {
    const rows = [
      row({ id: "a", fundKind: "activity", flow: "income" }),
      row({ id: "b", fundKind: "activity", flow: "expense" }),
    ];
    const [group] = groupCategoriesByFundKind(rows);
    expect(group.income.map((r) => r.id)).toEqual(["a"]);
    expect(group.expense.map((r) => r.id)).toEqual(["b"]);
  });

  it("sorts rows within a flow by sortOrder then name", () => {
    const rows = [
      row({ id: "a", fundKind: "activity", flow: "expense", sortOrder: 2, name: "Z" }),
      row({ id: "b", fundKind: "activity", flow: "expense", sortOrder: 1, name: "A" }),
      row({ id: "c", fundKind: "activity", flow: "expense", sortOrder: 1, name: "B" }),
    ];
    const [group] = groupCategoriesByFundKind(rows);
    expect(group.expense.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts unrecognized fund kinds alphabetically after the known set", () => {
    const rows = [
      row({ id: "a", fundKind: "zzz-future-kind" }),
      row({ id: "b", fundKind: "activity" }),
    ];
    expect(groupCategoriesByFundKind(rows).map((g) => g.fundKind)).toEqual([
      "activity",
      "zzz-future-kind",
    ]);
  });
});

describe("getMergeDestinationOptions", () => {
  it("excludes the source category itself", () => {
    const source = row({ id: "src", fundKind: "activity", flow: "expense" });
    const rows = [source, row({ id: "other", fundKind: "activity", flow: "expense" })];
    expect(getMergeDestinationOptions(rows, source).map((r) => r.id)).toEqual(["other"]);
  });

  it("excludes inactive categories", () => {
    const source = row({ id: "src", fundKind: "activity", flow: "expense" });
    const rows = [
      source,
      row({ id: "inactive", fundKind: "activity", flow: "expense", isActive: false }),
    ];
    expect(getMergeDestinationOptions(rows, source)).toEqual([]);
  });

  it("excludes categories in a different fundKind or flow", () => {
    const source = row({ id: "src", fundKind: "activity", flow: "expense" });
    const rows = [
      source,
      row({ id: "wrong-kind", fundKind: "charitable", flow: "expense" }),
      row({ id: "wrong-flow", fundKind: "activity", flow: "income" }),
      row({ id: "match", fundKind: "activity", flow: "expense" }),
    ];
    expect(getMergeDestinationOptions(rows, source).map((r) => r.id)).toEqual(["match"]);
  });

  it("sorts eligible destinations by sortOrder then name", () => {
    const source = row({ id: "src", fundKind: "activity", flow: "expense" });
    const rows = [
      source,
      row({ id: "b", fundKind: "activity", flow: "expense", sortOrder: 1, name: "B" }),
      row({ id: "a", fundKind: "activity", flow: "expense", sortOrder: 0, name: "A" }),
    ];
    expect(getMergeDestinationOptions(rows, source).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("fundKindLabel", () => {
  it("returns the matching fund's display name", () => {
    expect(fundKindLabel("activity", [{ kind: "activity", name: "Activity Fund" }])).toBe(
      "Activity Fund",
    );
  });

  it("falls back to a capitalized fundKind when no fund matches", () => {
    expect(fundKindLabel("scholarship", [{ kind: "activity", name: "Activity Fund" }])).toBe(
      "Scholarship",
    );
  });
});

// ---------------------------------------------------------------------------
// isPriorFiscalYearMergeRefusal — 2026-08-08 treasurer decision (DECISION-068)
// ---------------------------------------------------------------------------

describe("isPriorFiscalYearMergeRefusal", () => {
  it("recognizes mergeCategories()'s prior-fiscal-year refusal message", () => {
    const message =
      "Cannot merge 'Awards' into 'Member recognition' — FY2025 is a prior fiscal year, " +
      "already closed (before FY2026). Merging moves a budgeted amount, and a closed " +
      "year's approved budget can't be restated this way, whether or not it was ever " +
      "formally locked. 'Awards' has nothing left to merge for the current fiscal year " +
      "— its prior-year budget row stays exactly as the board approved it.";
    expect(isPriorFiscalYearMergeRefusal(message)).toBe(true);
  });

  it("does not match the locked-year refusal message", () => {
    const message =
      "Cannot merge 'Awards' into 'Member recognition' — FY2027 is locked. Merging moves " +
      "a budgeted amount between categories, not just a label, and a locked, board-approved " +
      "fiscal year's budget can't be changed this way. Unlock FY2027 first if this merge is " +
      "still needed.";
    expect(isPriorFiscalYearMergeRefusal(message)).toBe(false);
  });

  it("does not match the transaction-count or both-sides-collision refusal messages", () => {
    expect(
      isPriorFiscalYearMergeRefusal(
        "This category has 3 transactions — merging categories with transaction history isn't supported yet.",
      ),
    ).toBe(false);
    expect(
      isPriorFiscalYearMergeRefusal(
        "Both 'Awards' and 'Member recognition' have FY2026 budget rows — resolve by hand.",
      ),
    ).toBe(false);
  });
});

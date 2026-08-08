/**
 * Ledger Category Management — pure, DB-independent helpers backing
 * `/admin/ledger/settings/categories` (docs/work-log/2026-08-07-ledger-category-management.md).
 *
 * Everything here is client-safe (no `db` import) and framework-agnostic —
 * grouping/filtering the already-fetched category list, and computing the
 * merge dialog's eligible-destination set. Kept separate from
 * `category-list.tsx` so these seams are unit-testable without a DOM
 * (this project's `vitest.config.ts` runs `environment: "node"`, no
 * RTL/jsdom — see CLAUDE.md).
 */

export type CategoryFlow = "income" | "expense";

export interface AdminCategoryRow {
  id: string;
  name: string;
  fundKind: string;
  flow: CategoryFlow;
  sortOrder: number;
  isActive: boolean;
  countsAsGiving: boolean;
  form990Line: string | null;
}

export interface EntityFundOption {
  kind: string;
  name: string;
}

export interface EntityCategoryData {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  funds: EntityFundOption[];
  categories: AdminCategoryRow[];
}

/**
 * Display order for fund kinds — matches `getFunds()`'s own ORDER BY
 * (ledger-queries.ts) so this page's section order agrees with every other
 * Ledger surface that lists funds (Administrative always leads).
 */
export const FUND_KIND_ORDER = ["administrative", "charitable", "activity", "scholarship"] as const;

/**
 * Resolves a category's `fundKind` to the real fund's display name (e.g.
 * "Administrative Fund") rather than inventing a parallel label set — a
 * category's fundKind always corresponds to a real `ledgerFunds.kind` for
 * its entity. Falls back to a capitalized fundKind for the edge case where
 * the only fund of that kind has since been deactivated (so it no longer
 * appears in `getFunds()`'s active-only result).
 */
export function fundKindLabel(fundKind: string, funds: EntityFundOption[]): string {
  const match = funds.find((f) => f.kind === fundKind);
  if (match) return match.name;
  return fundKind.length > 0 ? fundKind.charAt(0).toUpperCase() + fundKind.slice(1) : fundKind;
}

export interface CategoryFilters {
  fundKind?: string;
  flow?: string;
  /** Default false — matches every existing category picker in this app. */
  showInactive?: boolean;
  search?: string;
}

/**
 * Client-side filter over the already-fetched category list for one entity —
 * no new endpoint for a ~100-row list (Phase 3 UI Design). Case-insensitive
 * substring match on name.
 */
export function filterCategoryRows(
  rows: AdminCategoryRow[],
  filters: CategoryFilters = {},
): AdminCategoryRow[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (!filters.showInactive && !row.isActive) return false;
    if (filters.fundKind && row.fundKind !== filters.fundKind) return false;
    if (filters.flow && row.flow !== filters.flow) return false;
    if (search && !row.name.toLowerCase().includes(search)) return false;
    return true;
  });
}

export interface FundKindGroup {
  fundKind: string;
  income: AdminCategoryRow[];
  expense: AdminCategoryRow[];
}

function byRowOrder(a: AdminCategoryRow, b: AdminCategoryRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

/**
 * Groups an already-filtered row set into Fund kind -> flow, in
 * `FUND_KIND_ORDER` (any fund kind not in that fixed list — none exist today,
 * but this stays defensive — sorts alphabetically after it). Fund kinds with
 * zero matching rows are omitted entirely rather than rendered as an empty
 * accordion section.
 */
export function groupCategoriesByFundKind(rows: AdminCategoryRow[]): FundKindGroup[] {
  const kindsPresent = new Set(rows.map((r) => r.fundKind));
  const knownOrder = FUND_KIND_ORDER.filter((k) => kindsPresent.has(k));
  const unknownOrder = Array.from(kindsPresent)
    .filter((k) => !(FUND_KIND_ORDER as readonly string[]).includes(k))
    .sort();
  const orderedKinds = [...knownOrder, ...unknownOrder];

  return orderedKinds.map((fundKind) => ({
    fundKind,
    income: rows.filter((r) => r.fundKind === fundKind && r.flow === "income").sort(byRowOrder),
    expense: rows.filter((r) => r.fundKind === fundKind && r.flow === "expense").sort(byRowOrder),
  }));
}

/**
 * The merge dialog's destination picker — active categories that share the
 * source's (fundKind, flow) within the same entity, excluding the source
 * itself. Client-side narrowing only; the server independently re-validates
 * scope + destination-active on both the plan and apply calls (belt and
 * suspenders, per the Phase 3 design).
 */
export function getMergeDestinationOptions(
  rows: AdminCategoryRow[],
  source: AdminCategoryRow,
): AdminCategoryRow[] {
  return rows
    .filter(
      (r) =>
        r.id !== source.id &&
        r.isActive &&
        r.fundKind === source.fundKind &&
        r.flow === source.flow,
    )
    .sort(byRowOrder);
}

/**
 * True when a merge-refusal message came from `mergeCategories()`'s
 * prior-fiscal-year check (2026-08-08, DECISION-068) rather than any other
 * refusal reason (transactions, both-sides collision, inactive
 * destination, a locked year, ...). The merge dialog uses this to swap the
 * generic red "this failed" treatment for a plain explanation that a
 * category with only prior-year budget rows has nothing left to merge in
 * the current fiscal year — that's the intended, board-preserving outcome,
 * not a bug (e.g. `Awards`, which now has only a leftover FY2025 row).
 *
 * Matched on two stable phrases the server message always contains
 * ("prior fiscal year" / "already closed") rather than duplicating the
 * fiscal-year math client-side — `mergeCategories()` in
 * `ledger-category-queries.ts` is the source of truth for the wording.
 */
export function isPriorFiscalYearMergeRefusal(errorMessage: string): boolean {
  return errorMessage.includes("prior fiscal year") && errorMessage.includes("already closed");
}

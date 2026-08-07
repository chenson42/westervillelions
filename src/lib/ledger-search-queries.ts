/**
 * Ledger & Budget Search — server-only query module (2026-08-06, DECISION-062/063).
 *
 * A cross-cutting read surface over the two heterogeneous record types a
 * treasurer searches: `ledger_transactions` and `ledger_budget_lines`. Split
 * out as its own sibling module rather than added to `ledger-queries.ts`
 * (already the largest file in `src/lib`), mirroring the precedent set by
 * `reconciliation-queries.ts` and `financial-report-queries.ts` (DECISION-049).
 *
 * Two independent queries per group (never a UNION — the rows are
 * structurally different and each group needs its own subtotal). Per group:
 * one paginated row query + one count/sum aggregate query, computed across
 * EVERY match (not just the visible page — treasurer decision #4 in
 * docs/work-log/2026-08-06-ledger-search.md), run together via `Promise.all`.
 *
 * Permission gating is the CALLER's responsibility (the search page —
 * ux-developer's scope): a caller lacking `LEDGER_VIEW` must never invoke
 * `searchTransactions()`, and a caller lacking `BUDGET_VIEW` must never
 * invoke `searchBudgetLines()`. Nothing in this module checks `FEATURES`
 * itself — matching every other query module in this codebase, where
 * permission checks live at the route/page layer, not the data-access layer.
 *
 * No schema changes, no new index (architect Phase 2 ruling — sequential
 * ILIKE scans are cheap at this club's data volume).
 *
 * Phase 4 loop-back (2026-08-07, Phase 6 SHIP WITH NOTES follow-ups #1/#2 —
 * see docs/work-log/2026-08-06-ledger-search.md "Phase 4 — Loop-back"):
 *
 * Fix 1 — lump-sum `ledgerBudgets` rows (no `ledgerBudgetLines` children,
 * e.g. "Rudolph Run expenses $10,000") are now searchable. This SUPERSEDES
 * DECISION-063 #4's increment-1 scope decision. `searchBudgetLines()` now
 * runs two independent queries — cause-line rows (unchanged shape) and
 * lump-sum rows (a new `ledgerBudgets`-rooted query, anti-joined against
 * `ledgerBudgetLines` via `isNull()` so a budget WITH children can never
 * also surface as a lump sum — the "has children" test is a real SQL
 * predicate, not a UI guess) — merges them, and paginates/aggregates the
 * MERGED set in application code rather than at the DB layer. This is a
 * deliberate deviation from the original per-group "row query + separate
 * count/sum aggregate query, LIMIT/OFFSET at the DB" pattern: once two
 * differently-shaped sources must interleave into one sorted, paginated,
 * subtotaled list, materializing both full match sets and merging in JS is
 * simpler and provably correct for any page number, whereas DB-side
 * LIMIT/OFFSET on the cause-line query alone cannot correctly represent a
 * combined ordering once lump sums are interleaved (see the work-log for the
 * full argument). Budget-line match volume for this club is small (dozens,
 * not hundreds) — cheap either way. `searchTransactions()` is NOT touched by
 * this change and keeps its original DB-paginated, DB-aggregated shape.
 *
 * Fix 2 — `searchTransactions()`'s free-text OR-group now also matches the
 * transaction's category name (`ledgerCategories.name`), matching what
 * `searchBudgetLines()` already did — a treasurer typing a category name
 * (e.g. "Dues") now gets consistent results on both sides of the page.
 */

import { db } from "@/lib/db";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  ledgerBankAccounts,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetLines,
} from "@/lib/db/schema";
import { and, desc, eq, gte, isNull, lt, lte, ilike, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { fyBounds } from "@/lib/fiscal-year";
import { escapeIlikeTerm } from "@/lib/ledger";

export const SEARCH_PAGE_SIZE = 50;

export interface LedgerSearchFilters {
  /** Raw, untrimmed. Empty string = no free-text condition ("browse" mode). */
  q: string;
  /** null = "All years" (omit FY condition entirely). */
  fiscalYear: number | null;
  entityId?: string;
  fundId?: string;
  categoryId?: string;
  /** Exact match against BUDGET_CAUSES / OTHER_COMMUNITY_SUPPORT_CAUSE taxonomy value. */
  cause?: string;
  /** Transaction-only. Ignored (not applied) by searchBudgetLines(). */
  bankAccountId?: string;
  /** Dollars-to-cents conversion happens in page.tsx before calling the query layer. */
  amountMinCents?: number;
  amountMaxCents?: number;
  /** Transaction-only. Ignored by searchBudgetLines(). 'YYYY-MM-DD'. */
  dateFrom?: string;
  dateTo?: string;
  /** Transaction-only. Ignored by searchBudgetLines(). Omitted = all statuses. */
  status?: "posted" | "pending" | "rejected";
}

export interface TransactionSearchRow {
  id: string;
  txnDate: string;
  flow: "income" | "expense";
  amountCents: number;
  party: string | null;
  memo: string | null;
  beneficiaryCause: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
  status: "posted" | "pending" | "rejected";
  reconciled: boolean;
  transferGroupId: string | null;
  entityId: string;
  entityName: string;
  entitySlug: string;
  fundId: string;
  fundName: string;
  fundSlug: string;
  categoryId: string | null;
  categoryName: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
}

export interface TransactionSearchResult {
  rows: TransactionSearchRow[];
  totalCount: number;
  /** Sums across EVERY match, not just the visible page (treasurer decision #4). */
  totalIncomeCents: number;
  totalExpenseCents: number;
  page: number;
  pageSize: number;
}

export interface BudgetLineSearchRow {
  /** `ledger_budget_lines.id` for an itemized cause line; `ledger_budgets.id`
   *  for a lump-sum category row (no line children) — see `isLumpSum`. */
  id: string;
  budgetId: string;
  /**
   * True when this row represents a WHOLE lump-sum budget category (its
   * `ledgerBudgets` row has zero `ledgerBudgetLines` children) rather than
   * one itemized cause line. Derived structurally in the query (an
   * anti-join), never guessed client-side — see the module doc comment's
   * "Fix 1" note. A budget row WITH children never produces a lump-sum row;
   * only its child lines do, so the two never double-count.
   */
  isLumpSum: boolean;
  /** null only when `isLumpSum` is true — a lump-sum row has no per-cause tag. */
  cause: string | null;
  /** null only when `isLumpSum` is true — a lump-sum row has no line label. */
  label: string | null;
  amountCents: number;
  flow: "income" | "expense";
  starred: boolean;
  note: string | null;
  pendingDeleteAt: Date | null;
  fiscalYear: number;
  entityId: string;
  entityName: string;
  entitySlug: string;
  fundId: string;
  fundName: string;
  fundSlug: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface BudgetLineSearchResult {
  rows: BudgetLineSearchRow[];
  totalCount: number;
  totalIncomeCents: number;
  totalExpenseCents: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Shared filter-building helpers
// ---------------------------------------------------------------------------

/** AND-ed exact-or-range condition on an integer cents column. A single
 *  `amountMinCents` with no `amountMaxCents` means EXACT match (treasurer
 *  decision #5), not an open-ended `>=`. */
function pushAmountConditions(
  conditions: SQL[],
  column: AnyPgColumn,
  filters: LedgerSearchFilters,
): void {
  const { amountMinCents, amountMaxCents } = filters;
  if (amountMinCents !== undefined && amountMaxCents !== undefined) {
    conditions.push(gte(column, amountMinCents));
    conditions.push(lte(column, amountMaxCents));
  } else if (amountMinCents !== undefined) {
    conditions.push(eq(column, amountMinCents));
  } else if (amountMaxCents !== undefined) {
    conditions.push(lte(column, amountMaxCents));
  }
}

/**
 * Builds the AND-ed structured condition list for `searchTransactions()`.
 * Shared between the paginated row query and the count/sum aggregate query
 * so the two can never drift out of sync with each other.
 */
function buildTransactionConditions(filters: LedgerSearchFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.fiscalYear !== null) {
    const { start, end } = fyBounds(filters.fiscalYear);
    conditions.push(gte(ledgerTransactions.txnDate, start));
    conditions.push(lt(ledgerTransactions.txnDate, end));
  }
  if (filters.entityId) {
    conditions.push(eq(ledgerTransactions.entityId, filters.entityId));
  }
  if (filters.fundId) {
    conditions.push(eq(ledgerTransactions.fundId, filters.fundId));
  }
  if (filters.categoryId) {
    conditions.push(eq(ledgerTransactions.categoryId, filters.categoryId));
  }
  if (filters.cause) {
    conditions.push(eq(ledgerTransactions.beneficiaryCause, filters.cause));
  }
  if (filters.bankAccountId) {
    conditions.push(eq(ledgerTransactions.bankAccountId, filters.bankAccountId));
  }
  if (filters.dateFrom) {
    conditions.push(gte(ledgerTransactions.txnDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(ledgerTransactions.txnDate, filters.dateTo));
  }
  if (filters.status) {
    conditions.push(eq(ledgerTransactions.status, filters.status));
  }
  pushAmountConditions(conditions, ledgerTransactions.amountCents, filters);

  const term = filters.q.trim();
  if (term) {
    const escaped = `%${escapeIlikeTerm(term)}%`;
    conditions.push(
      or(
        ilike(ledgerTransactions.party, escaped),
        ilike(ledgerTransactions.memo, escaped),
        ilike(ledgerTransactions.beneficiaryCause, escaped),
        ilike(ledgerTransactions.checkNumber, escaped),
        // Fix 2 (Phase 4 loop-back, 2026-08-07): category-name matching,
        // for parity with searchBudgetLines()'s free-text OR-group, which
        // already matched on the parent budget's category name. Requires
        // ledgerCategories to be joined — see the aggregate query below,
        // which previously needed no joins at all and now needs this one.
        ilike(ledgerCategories.name, escaped),
      )!,
    );
  }

  return conditions;
}

/**
 * Builds the AND-ed structured condition list for `searchBudgetLines()`'s
 * cause-line branch (itemized `ledgerBudgetLines` rows only — every row
 * returned here belongs to a budget that HAS at least one child, by
 * construction, since the row itself is that child).
 * All conditions reference `ledgerBudgetLines`/`ledgerBudgets`/`ledgerCategories`
 * columns only — `bankAccountId`/`dateFrom`/`dateTo`/`status` have no analog
 * on this side and are never referenced here (Filter Semantics rule 1: a
 * transaction-only filter is silently ignored for budget-line scoping, never
 * forces zero rows).
 */
function buildBudgetLineConditions(filters: LedgerSearchFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.fiscalYear !== null) {
    conditions.push(eq(ledgerBudgets.fiscalYear, filters.fiscalYear));
  }
  if (filters.entityId) {
    conditions.push(eq(ledgerBudgets.entityId, filters.entityId));
  }
  if (filters.fundId) {
    conditions.push(eq(ledgerBudgets.fundId, filters.fundId));
  }
  if (filters.categoryId) {
    conditions.push(eq(ledgerBudgets.categoryId, filters.categoryId));
  }
  if (filters.cause) {
    conditions.push(eq(ledgerBudgetLines.cause, filters.cause));
  }
  pushAmountConditions(conditions, ledgerBudgetLines.amountCents, filters);

  const term = filters.q.trim();
  if (term) {
    const escaped = `%${escapeIlikeTerm(term)}%`;
    conditions.push(
      or(
        ilike(ledgerBudgetLines.cause, escaped),
        ilike(ledgerBudgetLines.label, escaped),
        ilike(ledgerBudgetLines.note, escaped),
        ilike(ledgerCategories.name, escaped),
        ilike(ledgerBudgets.note, escaped),
      )!,
    );
  }

  return conditions;
}

/**
 * Builds the AND-ed condition list for `searchBudgetLines()`'s lump-sum
 * branch — `ledgerBudgets` rows with zero `ledgerBudgetLines` children (Fix
 * 1, Phase 4 loop-back, 2026-08-07, superseding DECISION-063 #4). Every
 * column lives directly on `ledgerBudgets`, so no join up from a line table
 * is needed for filtering — the "has no children" test itself is applied by
 * the caller as an `isNull(ledgerBudgetLines.id)` anti-join condition, not
 * here, so it stays structural and can't accidentally be omitted.
 *
 * `filters.cause` genuinely has no analog on a lump-sum row (cause is a
 * per-line attribute) — but unlike the transaction-only filters on
 * `buildBudgetLineConditions()` (which are structurally ABSENT because they
 * don't apply and shouldn't zero the section), a `cause` filter here means
 * something real and answerable: "does this row carry that cause tag?", and
 * a lump sum's honest answer is no. So this pushes a literal `false`
 * condition rather than omitting the filter — the same "a null/missing tag
 * correctly fails to match a cause filter" precedent `buildTransactionConditions()`
 * already relies on for `beneficiaryCause: null` rows. This also keeps the
 * query unconditionally issued (no separate skip-the-query branch in
 * `searchBudgetLines()`), which matters for two reasons: it avoids a
 * TypeScript union-type headache from a conditionally-typed `Promise.all`
 * element, and it keeps both branches' query construction the same "plain
 * thenable" shape so their relative resolution order stays deterministic.
 *
 * The free-text OR-group is deliberately narrower than the cause-line
 * branch's — restricted to exactly the two fields a lump-sum row actually
 * has: the parent's own `note` and its category's `name`. `cause`/`label`/
 * line-`note` don't exist on a lump sum.
 */
function buildLumpSumBudgetConditions(filters: LedgerSearchFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.fiscalYear !== null) {
    conditions.push(eq(ledgerBudgets.fiscalYear, filters.fiscalYear));
  }
  if (filters.entityId) {
    conditions.push(eq(ledgerBudgets.entityId, filters.entityId));
  }
  if (filters.fundId) {
    conditions.push(eq(ledgerBudgets.fundId, filters.fundId));
  }
  if (filters.categoryId) {
    conditions.push(eq(ledgerBudgets.categoryId, filters.categoryId));
  }
  if (filters.cause) {
    conditions.push(sql`false`);
  }
  pushAmountConditions(conditions, ledgerBudgets.annualAmountCents, filters);

  const term = filters.q.trim();
  if (term) {
    const escaped = `%${escapeIlikeTerm(term)}%`;
    conditions.push(
      or(ilike(ledgerCategories.name, escaped), ilike(ledgerBudgets.note, escaped))!,
    );
  }

  return conditions;
}

/**
 * Sort key for the merged cause-line + lump-sum result set (Fix 1). A
 * lump-sum row has no `cause`, so it sorts by its category name instead —
 * this slots it in alphabetically alongside cause lines rather than
 * clustering every lump sum at one end of the list. Matches the pre-Fix-1
 * `cause ASC, label ASC, fiscalYear DESC, fundName ASC` ordering for
 * cause-line rows exactly (label sorts as "" for a lump sum, so it never
 * displaces a real cause line at the same sort position).
 */
function budgetSearchSortKey(row: BudgetLineSearchRow): string {
  return (row.isLumpSum ? row.categoryName : row.cause) ?? "";
}

function compareBudgetLineSearchRows(a: BudgetLineSearchRow, b: BudgetLineSearchRow): number {
  const causeCmp = budgetSearchSortKey(a).localeCompare(budgetSearchSortKey(b));
  if (causeCmp !== 0) return causeCmp;
  const labelCmp = (a.label ?? "").localeCompare(b.label ?? "");
  if (labelCmp !== 0) return labelCmp;
  if (a.fiscalYear !== b.fiscalYear) return b.fiscalYear - a.fiscalYear; // DESC
  return a.fundName.localeCompare(b.fundName);
}

// ---------------------------------------------------------------------------
// searchTransactions
// ---------------------------------------------------------------------------

export async function searchTransactions(
  filters: LedgerSearchFilters,
  page: number,
): Promise<TransactionSearchResult> {
  const conditions = buildTransactionConditions(filters);
  const whereClause = and(...conditions);

  const [rawRows, [agg]] = await Promise.all([
    db
      .select({
        id: ledgerTransactions.id,
        txnDate: ledgerTransactions.txnDate,
        flow: ledgerTransactions.flow,
        amountCents: ledgerTransactions.amountCents,
        party: ledgerTransactions.party,
        memo: ledgerTransactions.memo,
        beneficiaryCause: ledgerTransactions.beneficiaryCause,
        checkNumber: ledgerTransactions.checkNumber,
        paymentMethod: ledgerTransactions.paymentMethod,
        status: ledgerTransactions.status,
        reconciled: ledgerTransactions.reconciled,
        transferGroupId: ledgerTransactions.transferGroupId,
        entityId: ledgerTransactions.entityId,
        entityName: ledgerEntities.name,
        entitySlug: ledgerEntities.slug,
        fundId: ledgerTransactions.fundId,
        fundName: ledgerFunds.name,
        fundSlug: ledgerFunds.slug,
        categoryId: ledgerTransactions.categoryId,
        categoryName: ledgerCategories.name,
        bankAccountId: ledgerTransactions.bankAccountId,
        bankAccountName: ledgerBankAccounts.name,
      })
      .from(ledgerTransactions)
      .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
      .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
      .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
      .leftJoin(ledgerBankAccounts, eq(ledgerTransactions.bankAccountId, ledgerBankAccounts.id))
      .where(whereClause)
      .orderBy(desc(ledgerTransactions.txnDate), desc(ledgerTransactions.createdAt))
      .limit(SEARCH_PAGE_SIZE)
      .offset((page - 1) * SEARCH_PAGE_SIZE),
    // Aggregate: every structured filter above is an FK id equality
    // directly on ledgerTransactions, so no join was ever needed for those —
    // but Fix 2 (Phase 4 loop-back, 2026-08-07) added a category-NAME match
    // to the free-text OR-group, and that column only exists via a join, so
    // ledgerCategories is now required here too (whereClause references it
    // whenever `q` is non-empty).
    db
      .select({
        count: sql<number>`count(*)::int`,
        totalIncomeCents: sql<number>`coalesce(sum(case when ${ledgerTransactions.flow} = 'income' then ${ledgerTransactions.amountCents} else 0 end), 0)::int`,
        totalExpenseCents: sql<number>`coalesce(sum(case when ${ledgerTransactions.flow} = 'expense' then ${ledgerTransactions.amountCents} else 0 end), 0)::int`,
      })
      .from(ledgerTransactions)
      .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
      .where(whereClause),
  ]);

  const rows: TransactionSearchRow[] = rawRows.map((r) => ({
    ...r,
    flow: r.flow as "income" | "expense",
    status: r.status as "posted" | "pending" | "rejected",
  }));

  return {
    rows,
    totalCount: agg?.count ?? 0,
    totalIncomeCents: agg?.totalIncomeCents ?? 0,
    totalExpenseCents: agg?.totalExpenseCents ?? 0,
    page,
    pageSize: SEARCH_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------------------
// searchBudgetLines
// ---------------------------------------------------------------------------

export async function searchBudgetLines(
  filters: LedgerSearchFilters,
  page: number,
): Promise<BudgetLineSearchResult> {
  const lineWhereClause = and(...buildBudgetLineConditions(filters));
  // A `cause` filter forces zero lump-sum matches (a lump sum has no cause
  // to match) rather than skipping the query — see buildLumpSumBudgetConditions's
  // doc comment for why this branch is always issued unconditionally.
  const lumpSumWhereClause = and(
    isNull(ledgerBudgetLines.id),
    ...buildLumpSumBudgetConditions(filters),
  );

  // Two independent, UNPAGINATED row fetches, merged and paginated in JS
  // below (Fix 1 — see the module doc comment for why this deliberately
  // departs from the DB-side LIMIT/OFFSET + separate aggregate-query pattern
  // used everywhere else in this module: once cause lines and lump sums must
  // interleave into one sorted, paginated, subtotaled list, materializing
  // both full match sets is the only way to get every page — not just page
  // 1 — provably right, and budget-line match volume is small enough that
  // this costs nothing at this club's data volume (architect Phase 2 ruling).
  const [causeLineRawRows, lumpSumRawRows] = await Promise.all([
    // Rooted at ledgerBudgetLines with an INNER join up to ledgerBudgets —
    // every row returned here belongs to a budget that HAS at least one
    // child (the row itself), so this branch can never double-count a
    // lump-sum row from the branch below.
    db
      .select({
        id: ledgerBudgetLines.id,
        budgetId: ledgerBudgetLines.budgetId,
        cause: ledgerBudgetLines.cause,
        label: ledgerBudgetLines.label,
        amountCents: ledgerBudgetLines.amountCents,
        flow: ledgerBudgets.flow,
        starred: ledgerBudgetLines.starred,
        note: ledgerBudgetLines.note,
        pendingDeleteAt: ledgerBudgetLines.pendingDeleteAt,
        fiscalYear: ledgerBudgets.fiscalYear,
        entityId: ledgerBudgets.entityId,
        entityName: ledgerEntities.name,
        entitySlug: ledgerEntities.slug,
        fundId: ledgerBudgets.fundId,
        fundName: ledgerFunds.name,
        fundSlug: ledgerFunds.slug,
        categoryId: ledgerBudgets.categoryId,
        categoryName: ledgerCategories.name,
      })
      .from(ledgerBudgetLines)
      .innerJoin(ledgerBudgets, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))
      .innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))
      .innerJoin(ledgerEntities, eq(ledgerBudgets.entityId, ledgerEntities.id))
      .leftJoin(ledgerCategories, eq(ledgerBudgets.categoryId, ledgerCategories.id))
      .where(lineWhereClause),
    // Rooted at ledgerBudgets, LEFT JOINed to ledgerBudgetLines and filtered
    // to isNull(ledgerBudgetLines.id) — the anti-join that makes "has no
    // children" a real SQL predicate rather than a UI guess (Fix 1).
    db
      .select({
        id: ledgerBudgets.id,
        budgetId: ledgerBudgets.id,
        amountCents: ledgerBudgets.annualAmountCents,
        flow: ledgerBudgets.flow,
        starred: ledgerBudgets.starred,
        note: ledgerBudgets.note,
        pendingDeleteAt: ledgerBudgets.pendingDeleteAt,
        fiscalYear: ledgerBudgets.fiscalYear,
        entityId: ledgerBudgets.entityId,
        entityName: ledgerEntities.name,
        entitySlug: ledgerEntities.slug,
        fundId: ledgerBudgets.fundId,
        fundName: ledgerFunds.name,
        fundSlug: ledgerFunds.slug,
        categoryId: ledgerBudgets.categoryId,
        categoryName: ledgerCategories.name,
      })
      .from(ledgerBudgets)
      .leftJoin(ledgerBudgetLines, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))
      .innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))
      .innerJoin(ledgerEntities, eq(ledgerBudgets.entityId, ledgerEntities.id))
      .leftJoin(ledgerCategories, eq(ledgerBudgets.categoryId, ledgerCategories.id))
      .where(lumpSumWhereClause),
  ]);

  const causeLineRows: BudgetLineSearchRow[] = causeLineRawRows.map((r) => ({
    ...r,
    isLumpSum: false,
    flow: r.flow as "income" | "expense",
  }));
  const lumpSumRows: BudgetLineSearchRow[] = lumpSumRawRows.map((r) => ({
    ...r,
    isLumpSum: true,
    cause: null,
    label: null,
    flow: r.flow as "income" | "expense",
  }));

  const merged = [...causeLineRows, ...lumpSumRows].sort(compareBudgetLineSearchRows);

  const totalCount = merged.length;
  const totalIncomeCents = merged.reduce(
    (sum, r) => sum + (r.flow === "income" ? r.amountCents : 0),
    0,
  );
  const totalExpenseCents = merged.reduce(
    (sum, r) => sum + (r.flow === "expense" ? r.amountCents : 0),
    0,
  );

  const start = (page - 1) * SEARCH_PAGE_SIZE;
  const rows = merged.slice(start, start + SEARCH_PAGE_SIZE);

  return {
    rows,
    totalCount,
    totalIncomeCents,
    totalExpenseCents,
    page,
    pageSize: SEARCH_PAGE_SIZE,
  };
}

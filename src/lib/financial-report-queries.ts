/**
 * Server-only query helpers for the member-visible Monthly Statement of
 * Financial Condition (2026-07-28-monthly-financial-report).
 *
 * Kept as a SEPARATE file from ledger-queries.ts per the architect's Phase 2
 * ruling (DECISION-049) — mirrors the precedent already set by
 * reconciliation-queries.ts being split from ledger-queries.ts: this is a
 * distinct read surface composing the existing engine, not a rework of it.
 * Every FYTD-actuals / rollforward / budget-variance figure below is
 * `getFundReport()`'s own output (bounded by its additive `asOfDate` param) —
 * this module never re-derives those figures from raw transactions, so a
 * member's statement can never silently drift from what the admin Ledger
 * shows.
 *
 * Genuinely new here (nothing in ledger-queries.ts does this today):
 *   - The bank-cleared-date "One Month" column (computeOneMonthCashActuals),
 *     including the Quicken-import-marker exclusion (DECISION-050).
 *   - The transaction-level, month-boundary reconciliation gate
 *     (isMonthGatedForEntity), generalizing getOverview()'s
 *     unreconciledPriorMonth predicate to an arbitrary boundary.
 *   - The member-exposed-fund allowlist (MEMBER_EXPOSED_FUND_KINDS),
 *     checked against the resolved DB fund row — never trusted from a
 *     caller-supplied slug/param.
 *   - The book-vs-cash divergence footnote value.
 *
 * Data-exposure boundary (enforced HERE, not at the page/component layer):
 * MonthlyStatementCategoryLine carries only categoryId, categoryName, three
 * `*Cents` numbers, and a boolean. NEVER `party`, `memo`, `checkNumber`,
 * `publicNote`, `donorId`, or any transaction/bank-line/match id. Every
 * caller composes this module's aggregated return types only — never raw
 * `ledgerTransactions` rows.
 *
 * Key invariants carried over from ledger-queries.ts:
 *   - All parameterized via Drizzle — no string interpolation.
 *   - `date` columns (txnDate, postingDate, monthStart/monthEnd/etc.) are
 *     plain 'YYYY-MM-DD' strings in JS, never Date objects — no
 *     naive-timestamp-as-UTC risk there. `reconciledAt` is the one
 *     `timestamp` (Date-typed) column this module touches; see
 *     reconciledAtToYMD()'s doc comment for how its UTC round-trip is
 *     handled.
 */

import { db } from "@/lib/db";
import {
  ledgerFunds,
  ledgerTransactions,
  ledgerReconciliationMatches,
  ledgerBankLines,
  type LedgerFund,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getFiscalYear } from "@/lib/fiscal-year";
import { getFundReport, type FundReportCategoryLine } from "@/lib/ledger-queries";
import {
  causeLineReferenceKey,
  resolveCauseLineActual,
  isEligibleForFuzzyCauseMatch,
  isAllZeroRow,
} from "@/lib/ledger";

// ---------------------------------------------------------------------------
// Member-exposed fund allowlist (locked Q5 answer, Phase 1)
// ---------------------------------------------------------------------------

/**
 * Only these fund kinds are member-facing — Activity and Scholarship stay
 * admin-only. Checked in getMonthlyStatement() against the RESOLVED DB fund
 * row (`fund.kind`), never trusted from a caller-supplied slug/param.
 */
export const MEMBER_EXPOSED_FUND_KINDS = ["administrative", "charitable"] as const;

function isMemberExposedKind(kind: string): boolean {
  return (MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(kind);
}

// The importer's literal memo marker (scripts/import-quicken-ledger.ts,
// IMPORT_MARKER). Colocated as its own constant here rather than imported
// from scripts/ — one-off scripts aren't meant to be an app dependency
// (DECISION-050 item 1).
const QUICKEN_IMPORT_MARKER = "[quicken-import]";

// ---------------------------------------------------------------------------
// Statement types
// ---------------------------------------------------------------------------

/**
 * A cause/line-item breakdown row under a category (B-30, DECISION-061;
 * folds in the fiscal-report cause/line breakdown work). `id` is the real
 * ledger_budget_lines id for a named line, or the literal "other" for the
 * synthesized catch-all row that makes visible detail foot to the category
 * total. `isFuzzyFallback` is true when EITHER this row's One-Month or
 * Twelve-Month figure came from the payee-name-match fallback rather than
 * an explicit link — the small, non-alarming marker both report surfaces
 * render next to the dollar figure.
 */
export type MonthlyStatementCauseLine = {
  id: string;
  cause: string;
  label: string;
  oneMonthCents: number;
  twelveMonthCents: number;
  annualBudgetCents: number | null;
  isFuzzyFallback: boolean;
  isOtherRow: boolean;
};

export type MonthlyStatementCategoryLine = {
  categoryId: string;
  categoryName: string;
  /** Bank-cleared-date net for this report month only. */
  oneMonthCents: number;
  /** FYTD actuals — same value as FundReportCategoryLine.actualCents at
   *  asOfDate = this report month's end. */
  twelveMonthCents: number;
  annualBudgetCents: number | null;
  /** Yellow-highlight flag: an outstanding (posted, unreconciled) check
   *  written in this category, dated on/before this report month's end. */
  hasUncashedCheck: boolean;
  /** Cause/line-item breakdown (B-30, DECISION-061) — null when the
   *  category has no budget cause-line breakdown at all (mirrors
   *  FundReportCategoryLine.causeLines: null = lump-sum/no breakdown, never
   *  an empty array). Always includes a synthesized "other" catch-all row
   *  when non-null, so the visible detail always foots to this line's own
   *  oneMonthCents/twelveMonthCents. Zero-omission (isAllZeroRow) is
   *  applied to this array for display — see buildLines() below. */
  causeLines: MonthlyStatementCauseLine[] | null;
};

export type MonthlyStatementTotals = {
  oneMonthCents: number;
  twelveMonthCents: number;
  budgetCents: number;
};

export type MonthlyStatement = {
  /** 'YYYY-MM' */
  month: string;
  /** "June 30, 2026" — display only. */
  monthEndLabel: string;
  income: MonthlyStatementCategoryLine[];
  expense: MonthlyStatementCategoryLine[];
  totalRevenue: MonthlyStatementTotals;
  totalExpense: MonthlyStatementTotals;
  net: MonthlyStatementTotals;
  /** Book balance at report-month start (= prior month's book-balance close). */
  beginningBookBalanceCents: number;
  /** Book balance at report-month end — SAME canonical value used for both
   *  the One-Month and Twelve-Month columns (locked Q2 answer). */
  endingBookBalanceCents: number;
  /** endingBookBalanceCents - (beginningBookBalanceCents + net.oneMonthCents).
   *  0 = no footnote needed; non-zero = real accrual-vs-cash divergence
   *  (typically outstanding uncashed checks), footnoted, not an error. */
  bookVsCashDivergenceCents: number;
  /** Footnote: at least one One-Month figure used the reconciledAt-date
   *  fallback (a legacy per-row-toggle transaction, no bank-line match). */
  usedLegacyReconciledAtFallback: boolean;
  /** Footnote: at least one reconciled row has NO trustworthy clear date
   *  (Quicken-imported, no bank-line match) and was excluded from the
   *  One-Month column entirely — see computeOneMonthCashActuals(). */
  hasUndatedHistoricalRows: boolean;
};

export type MonthlyStatementResult =
  | { status: "gated" }
  | { status: "ready"; statement: MonthlyStatement };

// ---------------------------------------------------------------------------
// Pure calendar helpers
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  // m is 1-indexed (1 = January)
  if (m === 2 && isLeapYear(y)) return 29;
  return DAYS_IN_MONTH[m - 1];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Defensive bound only — wide enough never to reject a real report month,
 *  narrow enough to catch a garbage/typo'd year before it reaches a raw SQL
 *  date parameter (the /financial-reports/club/2026-13 500 this guards
 *  against was an out-of-range MONTH, but the year deserves the same
 *  treatment — see monthBounds()'s validation below). */
const MIN_SANE_YEAR = 1900;
const MAX_SANE_YEAR = 2999;

/**
 * Pure. 'YYYY-MM' -> calendar-string bounds. No Date-object math on the
 * calendar side — integer y/m arithmetic only, mirroring fyBounds()'s own
 * plain-string style, so there is no timezone-shift surface here at all.
 *
 * Throws on a malformed or out-of-range `month` (month component not 01-12,
 * or a year outside a sane range) rather than silently producing
 * `NaN`/`undefined`-poisoned date strings — a shape-only regex (e.g.
 * `/^\d{4}-\d{2}$/`, which accepts "2026-13") is not enough to guarantee a
 * valid calendar month, and a poisoned string reaching a raw Drizzle date
 * parameter crashes with an uncaught Postgres error instead of a clean
 * `notFound()`. This is the single source of truth for month validation —
 * every caller (getMonthlyStatement() below, and any future one) gets this
 * check for free rather than having to remember to pre-validate.
 */
export function monthBounds(month: string): {
  monthStart: string;
  monthEnd: string;
  nextMonthStartExclusive: string;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new Error(`monthBounds: invalid month "${month}" — expected 'YYYY-MM'`);
  }
  const [, yStr, mStr] = match;
  const y = Number(yStr);
  const m = Number(mStr);
  if (m < 1 || m > 12) {
    throw new Error(`monthBounds: invalid month "${month}" — month must be 01-12`);
  }
  if (y < MIN_SANE_YEAR || y > MAX_SANE_YEAR) {
    throw new Error(`monthBounds: invalid month "${month}" — year out of range`);
  }

  const monthStart = `${yStr}-${pad2(m)}-01`;
  const lastDay = daysInMonth(y, m);
  const monthEnd = `${yStr}-${pad2(m)}-${pad2(lastDay)}`;

  let nextY = y;
  let nextM = m + 1;
  if (nextM > 12) {
    nextM = 1;
    nextY = y + 1;
  }
  const nextMonthStartExclusive = `${nextY}-${pad2(nextM)}-01`;

  return { monthStart, monthEnd, nextMonthStartExclusive };
}

/** 'YYYY-MM' -> the preceding calendar month's 'YYYY-MM', with year rollover. */
function priorMonthKey(month: string): string {
  const [yStr, mStr] = month.split("-");
  let y = Number(yStr);
  let m = Number(mStr) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${pad2(m)}`;
}

/** Parse a 'YYYY-MM-DD' string as a local date (avoids UTC shift from
 *  `new Date(string)`) — same convention as getPhilanthropy()'s local
 *  parseYMD() in ledger-queries.ts. Only used to hand a Date to
 *  getFiscalYear(), never for calendar arithmetic (see monthBounds() above). */
function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatMonthEndLabel(monthEnd: string): string {
  return parseYMD(monthEnd).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * `ledgerTransactions.reconciledAt` is a naive `timestamp` column (predates
 * the `{ withTimezone: true }` convention adopted for newer ledger tables —
 * see schema.ts's comment above ledgerReconciliationSessions). This codebase
 * has hit the naive-timestamp-as-UTC bug before on event/RSVP timestamps
 * (fixed there by switching to string-mode columns): the Postgres driver
 * round-trips a naive timestamp into a JS `Date` by treating the literal
 * wall-clock digits as UTC (`Date.UTC(year, month, day, ...)`), so recovering
 * the ORIGINAL wall-clock date requires UTC getters here, not local getters
 * — a local getter would re-shift by the server process's timezone offset
 * on top of that UTC round-trip, compounding the bug instead of undoing it.
 */
function reconciledAtToYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}-${m}-${day}`;
}

/**
 * True iff `monthEnd` (the last calendar day of a report month) is strictly
 * before the first day of the CURRENT calendar month — i.e. the report
 * month has fully finished.
 *
 * This is the fix for the qa-found leak: a month that hasn't elapsed yet can
 * never have been reconciled against a real bank statement, no matter how
 * caught-up the fund's existing unreconciled backlog is. Before this check,
 * a fully-caught-up fund (zero outstanding unreconciled rows — i.e. a
 * WELL-RUN set of books) had nothing at all to gate a future or
 * still-in-progress month on, so isMonthGatedForEntity() returned `false`
 * for e.g. next January purely because no stale row happened to exist —
 * `getMonthlyStatement()` would then render a full, real `ready` statement
 * for a month that hasn't happened yet.
 *
 * `now` defaults to `new Date()` (real wall-clock "now", not a DB-round-
 * tripped naive timestamp) and uses LOCAL getters deliberately — this is
 * NOT the reconciledAt-UTC-round-trip bug class (see reconciledAtToYMD()
 * above); it's the same "what calendar month is it right now" computation
 * getOverview()'s own `firstOfCurrentMonth` already uses
 * (`now.getFullYear()`/`now.getMonth()+1`, ledger-queries.ts).
 */
function hasMonthElapsed(monthEnd: string, now: Date = new Date()): boolean {
  const currentMonthStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  return monthEnd < currentMonthStart;
}

// ---------------------------------------------------------------------------
// isMonthGatedForEntity
// ---------------------------------------------------------------------------

/**
 * True iff a row is an outstanding (uncashed) check — the app's ONE
 * definition, matching getDashboard()'s uncashedChecks predicate in
 * ledger-queries.ts exactly (`paymentMethod='check' AND flow='expense'`,
 * both already narrowed to status='posted' AND reconciled=false by the
 * caller's SQL WHERE clause): a check the club WROTE that the bank hasn't
 * cleared yet. Deliberately keyed on `flow='expense'`, not merely
 * `paymentMethod='check'` alone — the flow split is what distinguishes
 * "money the club wrote a check for" from "money the club received," which
 * matters for the outstanding-check carve-out's own rationale (a check the
 * treasurer WROTE and the report already footnotes). A dues payment
 * RECEIVED by paper check (`paymentMethod='check', flow='income'`) is
 * carved out too, but by isUnclearedDepositRow() below, not this function
 * — see DECISION-059 (docs/work-log/2026-07-30-deposit-in-transit-carveout.md),
 * which retired the prior (2026-07-28) rule that kept check+income rows
 * gating. See docs/work-log/2026-07-28-report-gate-outstanding-checks.md
 * for this function's own original rationale, still current for expenses.
 */
function isOutstandingCheckRow(r: { paymentMethod: string | null; flow: string }): boolean {
  return r.paymentMethod === "check" && r.flow === "expense";
}

/**
 * True iff `r` is an uncleared (posted, unreconciled) deposit — the
 * income-side mirror of isOutstandingCheckRow() above, and the FULL-SYMMETRY
 * replacement for the retired isInTransitZeffyDepositRow() (DECISION-059,
 * docs/work-log/2026-07-30-deposit-in-transit-carveout.md). Deliberately has
 * NO payment-method restriction and NO time bound — every deposit rail
 * (Zeffy, check-received, cash) waits on the same structural lag (bank
 * posting + the treasurer's next reconciliation session), so scoping this to
 * one method or one age window just relocates the bug to whatever's excluded.
 * This reopens the `payment_method='check', flow='income'` case the
 * 2026-07-28 fix (docs/work-log/2026-07-28-report-gate-outstanding-checks.md)
 * deliberately kept gating — see DECISION-059 for the full rationale for why
 * that distinction no longer holds under checkbook-basis recording (T-24).
 */
function isUnclearedDepositRow(r: { flow: string }): boolean {
  return r.flow === "income";
}

/**
 * Per-entity reconciliation gate, scoped to member-exposed funds only
 * (locked Q1 answer): a month gates (is NOT ready) when EITHER:
 *   1. it hasn't fully elapsed yet (hasMonthElapsed() is false — covers the
 *      current calendar month and any future month, regardless of backlog
 *      state; see hasMonthElapsed()'s doc comment for the bug this fixes), OR
 *   2. a posted, unreconciled transaction exists, dated on/before `monthEnd`,
 *      in a fund whose kind is in MEMBER_EXPOSED_FUND_KINDS for this entity —
 *      EXCLUDING outstanding (uncashed) checks (isOutstandingCheckRow()) and
 *      uncleared deposits (isUnclearedDepositRow()) above. A legitimately-
 *      outstanding check the treasurer has already written and the report
 *      already footnotes (bookVsCashDivergenceCents, hasUncashedCheck per
 *      line) is not a "books aren't done" signal, and letting it gate
 *      cascaded to block every later month too — see
 *      docs/work-log/2026-07-28-report-gate-outstanding-checks.md for the
 *      prod repro (Foundation/Charitable stuck at Feb 2026 solely because of
 *      two outstanding checks dated 2026-03-07).
 *
 * Condition 2 reuses getOverview()'s unreconciledPriorMonth predicate
 * (status='posted' AND reconciled=false AND txnDate <= boundary), generalized
 * from "before this calendar month" to an arbitrary boundary, scoped to
 * member-exposed funds so a stale unreconciled Activity/Scholarship
 * transaction never blocks the Administrative/Charitable statement from
 * publishing, and now also excluding true outstanding checks AND every
 * uncleared deposit — full method/age-agnostic symmetry (DECISION-059,
 * docs/work-log/2026-07-30-deposit-in-transit-carveout.md), replacing the
 * former method-restricted, 12-day-windowed in-transit-Zeffy carve-out. A
 * check+income row (dues paid by paper check) is now excluded too — the
 * 2026-07-28 fix's opposite call on that case is superseded, see
 * isUnclearedDepositRow()'s doc comment for why.
 *
 * No `asOf` param: the retired in-transit-Zeffy carve-out was the only
 * reason this function ever needed "today" as an input (to anchor its
 * window) — isUnclearedDepositRow() has no age component, so there's
 * nothing left for `asOf` to drive here. (hasMonthElapsed() above computes
 * its own independent "now" via its own default param and was never part of
 * this carve-out.)
 *
 * The entity/status/reconciled narrowing happens in SQL; the fund-kind,
 * date-threshold, and outstanding-check/uncleared-deposit checks happen in
 * JS (mirroring getOverview()'s own unreconciledPriorMonth, which filters
 * its date threshold in JS over an already-fetched row set) — kept this way
 * deliberately so the predicate is directly unit-testable against canned
 * rows without needing to introspect generated SQL.
 */
export async function isMonthGatedForEntity(
  entityId: string,
  monthEnd: string,
): Promise<boolean> {
  if (!hasMonthElapsed(monthEnd)) {
    return true;
  }

  const rows = await db
    .select({
      txnDate: ledgerTransactions.txnDate,
      fundKind: ledgerFunds.kind,
      paymentMethod: ledgerTransactions.paymentMethod,
      flow: ledgerTransactions.flow,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    );

  return rows.some(
    (r) =>
      isMemberExposedKind(r.fundKind) &&
      r.txnDate <= monthEnd &&
      !isOutstandingCheckRow(r) &&
      !isUnclearedDepositRow(r),
  );
}

// ---------------------------------------------------------------------------
// computeOneMonthCashActuals
// ---------------------------------------------------------------------------

export type OneMonthCashActuals = {
  /** key = `${categoryId}_${flow}` */
  byCategory: Map<string, number>;
  /** Explicit transaction<->budget-line link (B-30, DECISION-061) — exact,
   *  key = budgetLineId. Bank-cleared-date scoped, same as byCategory. */
  byBudgetLine: Map<string, number>;
  /** Fuzzy payee-name-match fallback — key = causeLineReferenceKey. Only
   *  populated from transactions eligible per isEligibleForFuzzyCauseMatch
   *  (excludes anything already carrying a budgetLineId, so a linked
   *  transaction never feeds both maps — same "never both" rule
   *  getFundReport() enforces at the Twelve-Month grain). */
  byCauseKey: Map<string, number>;
  usedLegacyReconciledAtFallback: boolean;
  hasUndatedHistoricalRows: boolean;
};

/**
 * Bank-cleared-date bucketing for one fund + one report month, by
 * (categoryId, flow). Join chain: ledgerTransactions LEFT JOIN
 * ledgerReconciliationMatches ON matches.transactionId = txn.id LEFT JOIN
 * ledgerBankLines ON bankLines.id = matches.bankLineId. Scoped to
 * fund.id, status='posted', reconciled=true.
 *
 * Effective clear date, in priority order (DECISION-050):
 *   1. ledgerBankLines.postingDate — when a bank-line match exists (accurate).
 *   2. txn.reconciledAt's date — ONLY when txn.memo does NOT carry the
 *      Quicken-import marker: a legacy per-row-toggle row, where reconciledAt
 *      is a real human action's timestamp, a reasonable proxy.
 *   3. Neither — Quicken-imported rows with no bank-line match (reconciledAt
 *      is the 2026-07-20 bulk import run's timestamp, not a real clear date).
 *      EXCLUDED from this bucketing entirely; flagged via
 *      hasUndatedHistoricalRows. These rows are NOT excluded from the
 *      Twelve-Month/Budget columns (txnDate/posted-basis via
 *      getFundReport(), unaffected by this problem).
 *
 * Rows whose effective clear date falls in [monthStart, nextMonthStartExclusive)
 * are summed by (categoryId, flow) into byCategory.
 */
export async function computeOneMonthCashActuals(
  fundId: string,
  monthStart: string,
  nextMonthStartExclusive: string,
): Promise<OneMonthCashActuals> {
  const rows = await db
    .select({
      categoryId: ledgerTransactions.categoryId,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
      memo: ledgerTransactions.memo,
      reconciledAt: ledgerTransactions.reconciledAt,
      matchedPostingDate: ledgerBankLines.postingDate,
      budgetLineId: ledgerTransactions.budgetLineId,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      party: ledgerTransactions.party,
    })
    .from(ledgerTransactions)
    .leftJoin(
      ledgerReconciliationMatches,
      eq(ledgerReconciliationMatches.transactionId, ledgerTransactions.id),
    )
    .leftJoin(ledgerBankLines, eq(ledgerBankLines.id, ledgerReconciliationMatches.bankLineId))
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, true),
      ),
    );

  const byCategory = new Map<string, number>();
  const byBudgetLine = new Map<string, number>();
  const byCauseKey = new Map<string, number>();
  let usedLegacyReconciledAtFallback = false;
  let hasUndatedHistoricalRows = false;

  for (const row of rows) {
    const isQuickenImported = !!row.memo && row.memo.endsWith(QUICKEN_IMPORT_MARKER);
    let effectiveDate: string | null = null;

    if (row.matchedPostingDate) {
      effectiveDate = row.matchedPostingDate;
    } else if (!isQuickenImported && row.reconciledAt) {
      effectiveDate = reconciledAtToYMD(row.reconciledAt);
      usedLegacyReconciledAtFallback = true;
    } else {
      // Quicken-imported with no bank-line match, or no trustworthy date at
      // all (reconciled=true with reconciledAt somehow null) — excluded.
      hasUndatedHistoricalRows = true;
      continue;
    }

    if (effectiveDate < monthStart || effectiveDate >= nextMonthStartExclusive) continue;
    if (!row.categoryId) continue;

    const key = `${row.categoryId}_${row.flow}`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + row.amountCents);

    // B-30/DECISION-061: exact link, keyed by budgetLineId — parallel to
    // byCategory above, same effective-date scoping, zero extra round-trip.
    if (row.flow === "expense" && row.budgetLineId) {
      byBudgetLine.set(row.budgetLineId, (byBudgetLine.get(row.budgetLineId) ?? 0) + row.amountCents);
    }
    // Fuzzy fallback, keyed by causeLineReferenceKey — same
    // isEligibleForFuzzyCauseMatch guard getFundReport() uses at the
    // Twelve-Month grain, so a linked row never feeds this pool either.
    if (
      isEligibleForFuzzyCauseMatch({
        flow: row.flow,
        categoryId: row.categoryId,
        budgetLineId: row.budgetLineId,
        beneficiaryCause: row.beneficiaryCause,
      })
    ) {
      const causeKey = causeLineReferenceKey(row.categoryId, (row.beneficiaryCause ?? "").trim(), row.party);
      byCauseKey.set(causeKey, (byCauseKey.get(causeKey) ?? 0) + row.amountCents);
    }
  }

  return {
    byCategory,
    byBudgetLine,
    byCauseKey,
    usedLegacyReconciledAtFallback,
    hasUndatedHistoricalRows,
  };
}

// ---------------------------------------------------------------------------
// computeUncashedCheckCategoryIds
// ---------------------------------------------------------------------------

/**
 * Reuses getDashboard()'s uncashedChecks predicate exactly (paymentMethod=
 * 'check' AND flow='expense' AND status='posted' AND reconciled=false),
 * scoped to fundId and txnDate <= monthEnd (a check written in an earlier
 * month and still outstanding stays flagged in every later month's report —
 * matches both reference PDFs, where the flagged line's dollar figure sits
 * in the Twelve-Month column, not One-Month).
 */
export async function computeUncashedCheckCategoryIds(
  fundId: string,
  monthEnd: string,
): Promise<Set<string>> {
  const rows = await db
    .select({
      categoryId: ledgerTransactions.categoryId,
      txnDate: ledgerTransactions.txnDate,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        eq(ledgerTransactions.paymentMethod, "check"),
        eq(ledgerTransactions.flow, "expense"),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    );

  const categoryIds = new Set<string>();
  for (const row of rows) {
    if (row.categoryId && row.txnDate <= monthEnd) {
      categoryIds.add(row.categoryId);
    }
  }
  return categoryIds;
}

// ---------------------------------------------------------------------------
// getLatestOpenMonthForEntity
// ---------------------------------------------------------------------------

/**
 * 'YYYY-MM' of the most recent month whose gate clears for this entity, or
 * null if none has ever cleared. Drives the landing page's month list —
 * getMonthlyStatement() re-checks isMonthGatedForEntity() itself on every
 * call, so this is a picker convenience, never trusted as the sole gate.
 *
 * Scoped to member-exposed funds only (joins ledger_funds, filters
 * kind IN MEMBER_EXPOSED_FUND_KINDS) — otherwise a stale unreconciled
 * Activity-fund transaction would silently freeze the Administrative
 * statement's picker.
 *
 * The current calendar month is never offered — it isn't over yet, so it
 * can't have been reconciled — the ceiling is always last month at latest.
 *
 * qa's Phase 5 pass flagged that this previously never actually returned
 * `null` (always resolved to a string), a doc/impl mismatch sharing Finding
 * 1's root cause: the ceiling/candidate month was derived from its own
 * duplicated date math rather than being verified against the single source
 * of truth. The final candidate is now re-checked against
 * isMonthGatedForEntity() itself (which also carries the hasMonthElapsed()
 * fix) before being returned, so `null` is reachable again whenever the
 * candidate turns out not to be genuinely open.
 *
 * blockingDates below excludes outstanding (uncashed) checks via
 * isOutstandingCheckRow() AND every uncleared deposit via
 * isUnclearedDepositRow() — the same two carve-outs isMonthGatedForEntity()
 * applies — so this candidate computation doesn't independently reintroduce
 * the cascading-block bug for either one. Without this, the final re-check
 * against isMonthGatedForEntity() would correctly clear later months, but the
 * CANDIDATE itself would never be computed past "the month before the
 * earliest blocking date," permanently truncating the picker (the prod
 * repro: Foundation/Charitable stuck offering only through Feb 2026 because
 * of two outstanding checks dated 2026-03-07, even though isMonthGatedForEntity()
 * alone would clear every month through June — DECISION-051 §5 flags this as
 * the exact bug class a stale uncleared deposit would reintroduce if only one
 * of the two functions were updated; DECISION-059 carries the same discipline
 * forward for the now fully-symmetric deposit carve-out).
 *
 * `asOf` (optional, defaults to real "now") still drives `currentMonthKey`/
 * `ceilingMonth` below — an independent use that predates the deposit
 * carve-out and is unrelated to it (see this function's own top-level doc
 * comment). It is NO LONGER threaded into isUnclearedDepositRow() (which has
 * no age component) or into the final isMonthGatedForEntity() re-check call
 * (whose signature dropped the param — see that function's doc comment).
 */
export async function getLatestOpenMonthForEntity(
  entityId: string,
  asOf: Date = new Date(),
): Promise<string | null> {
  const rows = await db
    .select({
      txnDate: ledgerTransactions.txnDate,
      fundKind: ledgerFunds.kind,
      paymentMethod: ledgerTransactions.paymentMethod,
      flow: ledgerTransactions.flow,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    );

  const currentMonthKey = `${asOf.getFullYear()}-${pad2(asOf.getMonth() + 1)}`;
  const ceilingMonth = priorMonthKey(currentMonthKey);

  const blockingDates = rows
    .filter(
      (r) =>
        isMemberExposedKind(r.fundKind) &&
        !isOutstandingCheckRow(r) &&
        !isUnclearedDepositRow(r),
    )
    .map((r) => r.txnDate);

  let candidate: string;
  if (blockingDates.length === 0) {
    candidate = ceilingMonth;
  } else {
    const earliestBlockingDate = blockingDates.reduce((min, d) => (d < min ? d : min));
    const blockingMonth = earliestBlockingDate.slice(0, 7);
    const latestOpen = priorMonthKey(blockingMonth);
    candidate = latestOpen < ceilingMonth ? latestOpen : ceilingMonth;
  }

  const stillGated = await isMonthGatedForEntity(entityId, monthBounds(candidate).monthEnd);
  return stillGated ? null : candidate;
}

// ---------------------------------------------------------------------------
// getMonthlyStatement
// ---------------------------------------------------------------------------

/**
 * Whole-statement builder. `fund` must already be resolved by the caller
 * (getFunds(entity.id) + slug/kind lookup — same shape as the admin
 * fund-report page). Returns `null` when:
 *   - `fund.kind` is not in MEMBER_EXPOSED_FUND_KINDS (checked against the
 *     resolved DB row, never trusted from a route param), or
 *   - `month` is malformed or out of range (monthBounds() throws — a
 *     shape-valid-but-nonsensical month like "2026-13" must never reach a
 *     raw SQL date parameter and crash; see monthBounds()'s own doc comment).
 * Neither case is part of the gated/ready union — both mean "there is
 * nothing here to show," checked before any DB call in the fund-kind case
 * and before any query that would use the month in the invalid-month case.
 * Callers (the [entitySlug]/[month] page) should treat null as notFound().
 */
export async function getMonthlyStatement(
  fund: LedgerFund,
  month: string,
): Promise<MonthlyStatementResult | null> {
  if (!isMemberExposedKind(fund.kind)) {
    return null;
  }

  let bounds: ReturnType<typeof monthBounds>;
  try {
    bounds = monthBounds(month);
  } catch {
    // Malformed or out-of-range month (e.g. "2026-13") — treat exactly like
    // a non-exposed fund: nothing to show, never a raw date-parse error
    // reaching the caller.
    return null;
  }
  const { monthStart, monthEnd, nextMonthStartExclusive } = bounds;

  const gated = await isMonthGatedForEntity(fund.entityId, monthEnd);
  if (gated) {
    return { status: "gated" };
  }

  const reportFY = getFiscalYear(parseYMD(monthEnd));
  const currentReport = await getFundReport(fund.id, reportFY, { asOfDate: monthEnd });
  if (!currentReport) return null; // defensive: fund vanished mid-request

  const priorMonthEnd = monthBounds(priorMonthKey(month)).monthEnd;
  const priorFY = getFiscalYear(parseYMD(priorMonthEnd));
  const priorReport = await getFundReport(fund.id, priorFY, { asOfDate: priorMonthEnd });
  const beginningBookBalanceCents = priorReport
    ? priorReport.endingCents
    : fund.openingBalanceCents;

  const [oneMonth, uncashedCategoryIds] = await Promise.all([
    computeOneMonthCashActuals(fund.id, monthStart, nextMonthStartExclusive),
    computeUncashedCheckCategoryIds(fund.id, monthEnd),
  ]);

  // Cause/line-item breakdown (B-30, DECISION-061) — built from the SAME
  // Twelve-Month source line's causeLines (already exact/fuzzy-resolved by
  // getFundReport) plus the One-Month bucketing computed above. Returns null
  // when the category has no breakdown at all — never an empty array.
  function buildCauseLines(
    line: FundReportCategoryLine,
    categoryOneMonthCents: number,
    categoryTwelveMonthCents: number,
  ): MonthlyStatementCauseLine[] | null {
    if (!line.causeLines) return null;

    let namedOneMonthTotal = 0;
    let namedTwelveMonthTotal = 0;

    const named: MonthlyStatementCauseLine[] = line.causeLines.map((cl) => {
      const oneMonthLinked = oneMonth.byBudgetLine.get(cl.id) ?? 0;
      const oneMonthFallbackKey = causeLineReferenceKey(line.categoryId, cl.cause, cl.label);
      const oneMonthFallback = oneMonth.byCauseKey.get(oneMonthFallbackKey) ?? null;
      const oneMonthResolved = resolveCauseLineActual(oneMonthLinked, oneMonthFallback);

      namedOneMonthTotal += oneMonthResolved.cents;
      namedTwelveMonthTotal += cl.actualCents;

      return {
        id: cl.id,
        cause: cl.cause,
        label: cl.label,
        oneMonthCents: oneMonthResolved.cents,
        twelveMonthCents: cl.actualCents,
        annualBudgetCents: cl.amountCents,
        // Flagged whenever EITHER column's figure came from the fallback
        // path — a row is only fully exact once both are.
        isFuzzyFallback: oneMonthResolved.isFuzzyFallback || cl.isFuzzyFallback,
        isOtherRow: false,
      };
    });

    const other: MonthlyStatementCauseLine = {
      id: "other",
      cause: "Other",
      label: "",
      oneMonthCents: categoryOneMonthCents - namedOneMonthTotal,
      twelveMonthCents: categoryTwelveMonthCents - namedTwelveMonthTotal,
      // Budget lines already sum to the category's budget by construction
      // (DECISION-045) — there's never a leftover budget dollar to
      // attribute to "Other," only leftover actuals.
      annualBudgetCents: null,
      isFuzzyFallback: false,
      isOtherRow: true,
    };

    return [...named, other].filter((row) => !isAllZeroRow(row));
  }

  function buildLines(
    lines: FundReportCategoryLine[],
    flow: "income" | "expense",
  ): MonthlyStatementCategoryLine[] {
    return lines.map((line) => {
      const oneMonthCents = oneMonth.byCategory.get(`${line.categoryId}_${flow}`) ?? 0;
      const twelveMonthCents = line.actualCents;
      return {
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        oneMonthCents,
        twelveMonthCents,
        annualBudgetCents: line.budgetCents,
        hasUncashedCheck: uncashedCategoryIds.has(line.categoryId),
        causeLines: buildCauseLines(line, oneMonthCents, twelveMonthCents),
      };
    });
  }

  const incomeAll = buildLines(currentReport.income, "income");
  const expenseAll = buildLines(currentReport.expense, "expense");

  function sumTotals(
    lines: MonthlyStatementCategoryLine[],
    budgetSourceLines: FundReportCategoryLine[],
  ): MonthlyStatementTotals {
    return {
      oneMonthCents: lines.reduce((s, l) => s + l.oneMonthCents, 0),
      twelveMonthCents: lines.reduce((s, l) => s + l.twelveMonthCents, 0),
      budgetCents: budgetSourceLines.reduce((s, l) => s + (l.budgetCents ?? 0), 0),
    };
  }

  // Totals are always computed from the FULL, unfiltered row set — the
  // zero-omission rule (isAllZeroRow) below is a DISPLAY filter only.
  const totalRevenue = sumTotals(incomeAll, currentReport.income);
  const totalExpense = sumTotals(expenseAll, currentReport.expense);

  // Zero-omission (Gap 8, carried forward from the fiscal-report-breakdown
  // work-log): a category row with all three columns at zero/null is
  // dropped from what's rendered, applied identically to every category —
  // including ones that never had a cause breakdown before this feature.
  const income = incomeAll.filter((l) => !isAllZeroRow(l));
  const expense = expenseAll.filter((l) => !isAllZeroRow(l));
  const net: MonthlyStatementTotals = {
    oneMonthCents: totalRevenue.oneMonthCents - totalExpense.oneMonthCents,
    twelveMonthCents: totalRevenue.twelveMonthCents - totalExpense.twelveMonthCents,
    budgetCents: totalRevenue.budgetCents - totalExpense.budgetCents,
  };

  const endingBookBalanceCents = currentReport.endingCents;
  const bookVsCashDivergenceCents =
    endingBookBalanceCents - (beginningBookBalanceCents + net.oneMonthCents);

  const statement: MonthlyStatement = {
    month,
    monthEndLabel: formatMonthEndLabel(monthEnd),
    income,
    expense,
    totalRevenue,
    totalExpense,
    net,
    beginningBookBalanceCents,
    endingBookBalanceCents,
    bookVsCashDivergenceCents,
    usedLegacyReconciledAtFallback: oneMonth.usedLegacyReconciledAtFallback,
    hasUndatedHistoricalRows: oneMonth.hasUndatedHistoricalRows,
  };

  return { status: "ready", statement };
}

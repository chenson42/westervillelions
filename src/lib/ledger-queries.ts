/**
 * Server-only ledger query helpers.
 *
 * These functions are the authoritative data-access layer for The Ledger feature.
 * Import them in Server Components and API route handlers — never in client components.
 *
 * Key invariants:
 *   - FY filter: txnDate >= fyStart AND txnDate < nextFyStart (exclusive upper bound).
 *     No fiscalYear column on transactions — derived at query time (DECISION-015).
 *   - flow is 'income' | 'expense' only (DECISION-017).
 *   - Transfers are two rows linked by transferGroupId (DECISION-016).
 *   - All parameterized via Drizzle — no string interpolation.
 *   - No N+1 queries: getFundReport and getOverview aggregate in a single pass.
 */

import { db } from "@/lib/db";
import {
  ledgerEntities,
  ledgerBankAccounts,
  ledgerFunds,
  ledgerCategories,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetLines,
  ledgerBudgetApprovals,
  ledgerBudgetNotes,
  ledgerSettings,
  ledgerReimbursements,
  ledgerFilings,
  ledgerDonors,
  ledgerAcknowledgments,
  duesPayments,
  members,
  users,
  type LedgerEntity,
  type LedgerBankAccount,
  type LedgerFund,
  type LedgerCategory,
  type LedgerTransaction,
  type LedgerBudgetApproval,
  type LedgerSettings,
  type LedgerReimbursement,
  type LedgerFiling,
  type LedgerDonor,
  type LedgerAcknowledgment,
} from "@/lib/db/schema";
import { eq, and, gte, lt, ilike, or, inArray, desc, asc, isNotNull, isNull, ne, sql, count, getTableColumns } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getFiscalYear, currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import {
  fundBalanceCents,
  rolledForwardOpeningCents,
  grossReceiptsCents,
  budgetVariance,
  guardrails,
  countAgedPublicFunds,
  agedPublicFundNames,
  daysSinceTxnDate,
  determine990,
  computeDueDate,
  isFilingOverdue,
  bucketGivingByCause,
  isReceiptMissing,
  validateBudgetLineInput,
  deriveSeedLinesForFund,
  isBudgetLocked,
  isValidBudgetCause,
  sumBudgetCauseLines,
  deriveCauseSeedLines,
  normalizeBudgetLineLabel,
  MAX_BUDGET_LINE_LABEL_LENGTH,
  normalizeBudgetNote,
  MAX_BUDGET_NOTE_LENGTH,
  resolveDisplayBudgetCents,
  buildCauseActualsByKey,
  computeDuesTimingAdjustment,
  type GuardrailFlag,
  type BudgetVarianceResult,
  type AgedPublicFundFact,
  type GivingFoldRow,
  type CauseGivingRow,
  type SeedSourceLine,
  type SeedProposedLine,
  type CauseSeedSourceRow,
  type CauseSeedProposedLine,
  type CauseActualSourceRow,
  type DuesTimingAdjustment,
} from "@/lib/ledger";

// ---------------------------------------------------------------------------
// FY bound helpers
// ---------------------------------------------------------------------------

/**
 * Returns the inclusive start date (Jul 1 of `fy`) and exclusive end date
 * (Jul 1 of `fy + 1`) as ISO strings suitable for Drizzle date column comparisons.
 */
function fyBounds(fy: number): { start: string; end: string } {
  // Jul 1 of the starting year; exclusive Jul 1 of next year
  return {
    start: `${fy}-07-01`,
    end: `${fy + 1}-07-01`,
  };
}

/**
 * Adds one calendar day to a 'YYYY-MM-DD' string via plain integer
 * arithmetic — no `Date` object, no timezone-shift surface, mirroring
 * fyBounds()'s own plain-string style. Used by getFundReport()'s `asOfDate`
 * bound (Monthly Financial Statement, 2026-07-28): `date` columns in this
 * schema are already plain strings (not `timestamp`), so unlike
 * `reconciledAt` there is no naive-timestamp-as-UTC risk here at all — this
 * helper just needs to get calendar rollover right.
 */
function addOneDayToYMD(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const daysInMonth = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let nextY = y;
  let nextM = m;
  let nextD = d + 1;
  if (nextD > daysInMonth[m - 1]) {
    nextD = 1;
    nextM = m + 1;
    if (nextM > 12) {
      nextM = 1;
      nextY = y + 1;
    }
  }
  return `${nextY}-${String(nextM).padStart(2, "0")}-${String(nextD).padStart(2, "0")}`;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// ---------------------------------------------------------------------------
// Shared return types
// ---------------------------------------------------------------------------

export type FundReportCategoryLine = {
  categoryId: string;
  categoryName: string;
  actualCents: number;
  /** null when no ledger_budgets row exists for this category/flow, OR when
   *  the row exists ONLY to carry a star/note annotation (lazy-created with
   *  annualAmountCents: 0, no cause lines, starred or noted) — see
   *  resolveDisplayBudgetCents in ledger.ts (Budget Star & Notes loop-back
   *  fix, QA FAIL, DECISION-057). A genuine deliberately-entered $0 budget,
   *  or a $0 category with real cause-line detail, still reports 0. */
  budgetCents: number | null;
  variance: BudgetVarianceResult;
  /** Sourced from ledgerCategories.countsAsGiving — drives cause-breakdown
   *  eligibility client-side (isCauseEligibleCategory, src/lib/ledger.ts).
   *  false for budget-only rows with no matching category ("(Unknown
   *  category)") — defensive default, no breakdown UI on orphaned rows. */
  countsAsGiving: boolean;
  /** Cause-tagged budget line items (B-17 Increment A, DECISION-045; `id`
   *  and `label` added by Labeled Cause Budget Lines, DECISION-047/048) for
   *  this category's budget row, or null when the category is in lump-sum
   *  mode (or has no budget row at all). Never `[]` — emptying the last
   *  cause line deletes the parent ledger_budgets row, so "no breakdown"
   *  only ever has one representation (null). `id` is the row's own
   *  primary key — every write path addresses a line by `id`, not by
   *  `(cause)`, now that a cause can have multiple labeled lines. `label`
   *  is `""` for the generic/unlabeled line. `pendingDeleteAt` (Budgeting
   *  Page Restructure, DECISION-054/056) is an ISO string when that line's
   *  OWN ledger_budget_lines.pending_delete_at is set, else null — purely
   *  informational, same as the category-grain field below; a consumer
   *  excludes a line via isCauseLineLive(cl.pendingDeleteAt,
   *  line.pendingDeleteAt), never by reading this field alone. */
  causeLines:
    | {
        id: string;
        cause: string;
        label: string;
        amountCents: number;
        pendingDeleteAt: string | null;
        /** Budget Star & Notes (DECISION-057). ADMIN-ONLY — see the
         *  category-grain `starred`/`note` doc comment below; identical
         *  boundary applies to this cause-line grain. */
        starred: boolean;
        note: string | null;
      }[]
    | null;
  /** Soft-delete-until-finalize (DECISION-052/053, Increment 2 of
   *  docs/work-log/2026-07-28-budgeting-page-redesign.md). ISO string when
   *  the row's ledger_budgets.pending_delete_at is set, else null. PURELY
   *  INFORMATIONAL — does not participate in budgetCents, variance, or any
   *  of this report's totals (totalIncomeCents/totalExpenseCents/
   *  endingCents), which must stay computed from the full, committed row
   *  set until the budget is actually finalized. null when no budget row
   *  exists for this category/flow at all (same as budgetCents === null). */
  pendingDeleteAt: string | null;
  /** Budget Star & Notes (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md).
   *  false / null when no ledger_budgets row exists for this category/flow —
   *  same "no row yet" convention as budgetCents === null / pendingDeleteAt
   *  === null. ADMIN-ONLY: this field (and causeLines[].starred/.note above)
   *  must NEVER be added to any select/mapping shared with getPhilanthropy()
   *  or the member-facing financial-report-queries.ts path (Phase 1 Decision
   *  9) — financial-report-queries.ts DOES consume FundReportCategoryLine via
   *  getFundReport(), but its own buildLines() maps to an explicit
   *  MonthlyStatementCategoryLine allowlist that does not include these two
   *  fields; any future refactor that widens that allowlist with a spread
   *  must not pick these up. */
  starred: boolean;
  note: string | null;
};

export type FundReport = {
  fund: LedgerFund;
  /** Rolled forward: fund.openingBalanceCents seed + net of all POSTED
   *  transactions dated before the FY start (DECISION-029). NOT the raw
   *  fund.openingBalanceCents seed for any FY after the fund's first. */
  openingCents: number;
  income: FundReportCategoryLine[];
  expense: FundReportCategoryLine[];
  /** Sum of all posted income actuals (FY-scoped) */
  totalIncomeCents: number;
  /** Sum of all posted expense actuals (FY-scoped) */
  totalExpenseCents: number;
  /** Posted ending balance (rolled-forward openingCents + FY posted income - FY posted expense) */
  endingCents: number;
  /** Sum of pending (unposted) expense amounts — "encumbered" figure */
  pendingExpenseCents: number;
  /** Posted expense actuals for THIS report's own fund+FY, grouped by
   *  `(categoryId, cause, party)` and keyed via `causeLineReferenceKey`
   *  (src/lib/ledger.ts) — Prior-Year Reference on Cause/Beneficiary Budget
   *  Lines, 2026-07-28. Computed from the same posted transactions this
   *  report already aggregates into `actualCents`, so it costs no extra
   *  query. Purely informational: a caller uses THIS FY's report as the
   *  "prior" one to look up a cause line's `priorActualCents` by
   *  `causeLineReferenceKey(categoryId, cause, label)` — never used to
   *  compute this report's own totals/budgetCents/variance/causeLines[].
   *  amountCents. `{}` when the fund has no cause-tagged expense actuals at
   *  all (e.g. an unseeded entity), not an error state. */
  causeActualsByKey: Record<string, number>;
};

export type FundSummary = {
  fund: LedgerFund;
  /** Rolled forward: fund.openingBalanceCents seed + net of all POSTED
   *  transactions dated before the FY start (DECISION-029). NOT the raw
   *  fund.openingBalanceCents seed for any FY after the fund's first. */
  openingCents: number;
  /** Posted income only (FY-scoped) */
  incomeCents: number;
  /** Posted expense only (FY-scoped) */
  expenseCents: number;
  /** Posted ending balance (rolled-forward openingCents + FY income - FY expense) */
  endingCents: number;
  /** Pending (unposted) expense amounts — encumbered figure */
  pendingExpenseCents: number;
};

export type EntityOverview = {
  entity: LedgerEntity;
  funds: FundSummary[];
  grossReceiptsCents: number;
  determine990Result: { form: string; why: string };
  guardrailFlags: GuardrailFlag[];
  /** Count of posted transactions with syncStale=true — already computed
   *  inside getOverview(), now also returned directly (Ledger Dashboard
   *  "other audit items" panel, DECISION-031). */
  syncStaleTxns: number;
  /** Count of posted, unreconciled transactions dated before the first of the
   *  current calendar month — already computed inside getOverview(), now also
   *  returned directly (Ledger Dashboard "other audit items" panel, DECISION-031). */
  unreconciledPriorMonth: number;
};

// ---------------------------------------------------------------------------
// getEntities
// ---------------------------------------------------------------------------

/**
 * Returns all ledger entities ordered by name.
 */
export async function getEntities(): Promise<LedgerEntity[]> {
  return db.select().from(ledgerEntities).orderBy(ledgerEntities.name);
}

// ---------------------------------------------------------------------------
// getEntity
// ---------------------------------------------------------------------------

/**
 * Returns a single entity by slug ('club' | 'foundation'), or null.
 *
 * Validates that `slug` is a non-empty string — returns null on garbage input
 * so callers can safely `notFound()` without leaking DB errors.
 */
export async function getEntity(slug: string): Promise<LedgerEntity | null> {
  if (!slug || typeof slug !== "string" || slug.trim() === "") return null;
  const rows = await db
    .select()
    .from(ledgerEntities)
    .where(eq(ledgerEntities.slug, slug.trim()))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getEntityById — Guided Budgeting
// ---------------------------------------------------------------------------

/**
 * Returns a single entity by id, or null. Small sibling to getEntity(slug) —
 * exists purely because POST /api/admin/ledger/budgets/seed receives an
 * entityId, not a slug. Keep this a one-line lookup; do not let it grow scope.
 */
export async function getEntityById(id: string): Promise<LedgerEntity | null> {
  if (!id || typeof id !== "string" || id.trim() === "") return null;
  const rows = await db
    .select()
    .from(ledgerEntities)
    .where(eq(ledgerEntities.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getFunds
// ---------------------------------------------------------------------------

/**
 * Returns all active funds for an entity, ordered by name.
 */
export async function getFunds(entityId: string): Promise<LedgerFund[]> {
  // Order by fund KIND (administrative first), then name — not alphabetical by
  // name (which put the Club's "Activity Fund" ahead of its "Administrative
  // Fund"). The Administrative fund should always lead, on both the budgeting
  // page and the ledger surfaces, which both read the fund list through here.
  // (Treasurer request 2026-07-28.)
  return db
    .select()
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, entityId), eq(ledgerFunds.isActive, true)))
    .orderBy(
      sql`case ${ledgerFunds.kind}
            when 'administrative' then 0
            when 'charitable' then 1
            when 'activity' then 2
            when 'scholarship' then 3
            else 4 end`,
      ledgerFunds.name,
    );
}

// ---------------------------------------------------------------------------
// getBankAccounts
// ---------------------------------------------------------------------------

/**
 * Returns all active bank accounts for an entity, ordered by name.
 */
export async function getBankAccounts(entityId: string): Promise<LedgerBankAccount[]> {
  return db
    .select()
    .from(ledgerBankAccounts)
    .where(
      and(eq(ledgerBankAccounts.entityId, entityId), eq(ledgerBankAccounts.isActive, true)),
    )
    .orderBy(ledgerBankAccounts.name);
}

// ---------------------------------------------------------------------------
// getCategories
// ---------------------------------------------------------------------------

/**
 * Returns all active categories for an entity, ordered by sortOrder then name.
 * Optionally filtered by fundKind and/or flow.
 */
export async function getCategories(
  entityId: string,
  opts: { fundKind?: string; flow?: string } = {},
): Promise<LedgerCategory[]> {
  const conditions = [
    eq(ledgerCategories.entityId, entityId),
    eq(ledgerCategories.isActive, true),
  ];
  if (opts.fundKind) conditions.push(eq(ledgerCategories.fundKind, opts.fundKind));
  if (opts.flow) conditions.push(eq(ledgerCategories.flow, opts.flow));

  return db
    .select()
    .from(ledgerCategories)
    .where(and(...conditions))
    .orderBy(ledgerCategories.sortOrder, ledgerCategories.name);
}

// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

/**
 * Returns the singleton ledger_settings row.
 *
 * If somehow missing (should not happen post-migration), returns safe defaults
 * rather than throwing, so guardrails remain functional.
 */
export async function getSettings(): Promise<LedgerSettings> {
  const rows = await db.select().from(ledgerSettings).limit(1);
  if (rows[0]) return rows[0];

  // Fallback defaults — mirrors the seed values from 0044_ledger_books.sql
  return {
    id: "00000000-0000-0000-0000-000000000000",
    philanthropyVisibility: "board",
    treasurerBonded: false,
    reserveWarnThresholdCents: 2_500_000,
    disbApprovalThresholdCents: 25_000,
    retentionYears: 7,
    holdingPeriodWarnDays: 365,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// listTransactions
// ---------------------------------------------------------------------------

/**
 * Returns transactions for an entity, ordered by txnDate descending.
 *
 * FY filter (when fiscalYear is provided):
 *   txnDate >= '{fy}-07-01' AND txnDate < '{fy+1}-07-01'
 * This is the exclusive-upper-bound range from DECISION-015 + Phase 3 Note D.
 *
 * When `status` is omitted, ALL statuses are returned (posted + pending + rejected).
 * The ledger list should show all transactions; only balance computations filter to
 * posted-only.
 *
 * No N+1: single query with optional WHERE clauses.
 */
export async function listTransactions(
  entityId: string,
  opts: {
    fundId?: string;
    fiscalYear?: number;
    flow?: "income" | "expense";
    search?: string;
    /** Filter to a specific status. Omit to return all statuses. */
    status?: "posted" | "pending" | "rejected";
    /**
     * Filter to rows matching isReceiptMissing() (DECISION-035): flow='expense'
     * AND receiptStorageKey IS NULL AND receiptWaivedAt IS NULL. Expressed here
     * as an equivalent Drizzle WHERE clause — kept in sync by hand with the
     * in-memory isReceiptMissing() predicate in src/lib/ledger.ts, which is the
     * source of truth for the condition's meaning.
     */
    missingReceipt?: boolean;
  } = {},
): Promise<LedgerTransaction[]> {
  const { fundId, fiscalYear, flow, search, status, missingReceipt } = opts;

  const conditions = [eq(ledgerTransactions.entityId, entityId)];

  if (fundId) {
    conditions.push(eq(ledgerTransactions.fundId, fundId));
  }

  if (fiscalYear !== undefined) {
    const { start, end } = fyBounds(fiscalYear);
    conditions.push(gte(ledgerTransactions.txnDate, start));
    conditions.push(lt(ledgerTransactions.txnDate, end));
  }

  if (flow) {
    conditions.push(eq(ledgerTransactions.flow, flow));
  }

  if (status) {
    conditions.push(eq(ledgerTransactions.status, status));
  }

  if (missingReceipt) {
    conditions.push(eq(ledgerTransactions.flow, "expense"));
    conditions.push(isNull(ledgerTransactions.receiptStorageKey));
    conditions.push(isNull(ledgerTransactions.receiptWaivedAt));
  }

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    const searchClause = or(
      ilike(ledgerTransactions.party, term),
      ilike(ledgerTransactions.memo, term),
    );
    if (searchClause) conditions.push(searchClause);
  }

  return db
    .select()
    .from(ledgerTransactions)
    .where(and(...conditions))
    .orderBy(desc(ledgerTransactions.txnDate), desc(ledgerTransactions.createdAt));
}

// ---------------------------------------------------------------------------
// getFundReport
// ---------------------------------------------------------------------------

/**
 * Builds the Budget/Actual/Variance fund report for a fund × fiscal year.
 *
 * Strategy (N+1-free):
 *   1. Fetch all transactions for the fund+FY in one query.
 *   2. Fetch all categories for the fund's kind in one query.
 *   3. Fetch all budgets for the fund+FY in one query.
 *   4. Group actuals by category in TypeScript (single-pass).
 *   5. Left-join actuals and budgets against the full category list.
 *
 * A category with only a budget row (no actuals yet) gets actualCents = 0.
 * A category with only actuals (no budget row) gets budgetCents = null → "—".
 *
 * `opts.asOfDate` ('YYYY-MM-DD', inclusive) bounds the FYTD-actuals /
 * rollforward / budget-variance math at a month-end instead of "now" —
 * added for the Monthly Financial Statement (2026-07-28, DECISION-049).
 * This is the ONLY change `asOfDate` makes: the step-2 transactions query's
 * exclusive upper bound becomes `min(fyEnd, asOfDate + 1 day)` instead of
 * `fyEnd`. Every other step (categories, budgets, pre-FY rollforward,
 * cause-line batching, actuals grouping, variance) is untouched — this
 * function is the single source of truth for FYTD/budget/book-balance
 * figures precisely so the member-facing monthly statement can never
 * silently drift from what the admin Ledger shows. Omitting `opts`/
 * `asOfDate` reproduces today's behavior byte-for-byte (`upperBound` equals
 * `end`, identical to the pre-existing query) — every existing call site
 * (the admin fund-report page, `BudgetEditor`) is unaffected.
 */
export async function getFundReport(
  fundId: string,
  fiscalYear: number,
  opts?: { asOfDate?: string },
): Promise<FundReport | null> {
  // 1. Fetch the fund row
  const fundRows = await db
    .select()
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0];
  if (!fund) return null;

  const { start, end } = fyBounds(fiscalYear);
  const asOfUpperBound = opts?.asOfDate ? addOneDayToYMD(opts.asOfDate) : end;
  const upperBound = asOfUpperBound < end ? asOfUpperBound : end;

  // 2. Fetch transactions for this fund+FY (bounded at asOfDate's month-end
  // when provided — see the `asOfDate` doc comment above)
  const txns = await db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, upperBound),
      ),
    );

  // 3. Fetch all active categories for this fund's kind, scoped to entity
  const categories = await db
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, fund.entityId),
        eq(ledgerCategories.fundKind, fund.kind),
        eq(ledgerCategories.isActive, true),
      ),
    )
    .orderBy(ledgerCategories.sortOrder, ledgerCategories.name);

  // 4. Fetch budgets for this fund+FY
  const budgetRows = await db
    .select()
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, fiscalYear),
      ),
    );

  // 4b. Pre-FY rollforward: posted-only totals for this fund dated strictly
  // before the FY start, grouped by flow (mirrors Query A2's shape/style —
  // see DECISION-028/029). Rolls fund.openingBalanceCents forward past its
  // static inception-date seed so openingCents/endingCents reflect all prior
  // fiscal years' activity, not just the one seed value (display-side
  // counterpart to DECISION-028's cross-FY balance fix).
  const preFyRows = await db
    .select({
      flow: ledgerTransactions.flow,
      totalCents: sql<string>`COALESCE(SUM(${ledgerTransactions.amountCents}), 0)`,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        eq(ledgerTransactions.status, "posted"),
        lt(ledgerTransactions.txnDate, start),
      ),
    )
    .groupBy(ledgerTransactions.flow);

  const preFyFlowRows = preFyRows.map((r) => ({
    flow: r.flow,
    amountCents: Number(r.totalCents),
    status: "posted",
  }));
  const rolledForwardOpening = rolledForwardOpeningCents(fund.openingBalanceCents, preFyFlowRows);

  // 4c. Batched fetch of cause-tagged budget line items (B-17 Increment A) for
  // every budget row above — one query keyed off budgetRows' own IDs, no N+1
  // per category. Folded into causeLinesByBudgetId below.
  const budgetIds = budgetRows.map((b) => b.id);
  const budgetLineRows =
    budgetIds.length > 0
      ? await db
          .select({
            id: ledgerBudgetLines.id,
            budgetId: ledgerBudgetLines.budgetId,
            cause: ledgerBudgetLines.cause,
            label: ledgerBudgetLines.label,
            amountCents: ledgerBudgetLines.amountCents,
            pendingDeleteAt: ledgerBudgetLines.pendingDeleteAt,
            starred: ledgerBudgetLines.starred,
            note: ledgerBudgetLines.note,
          })
          .from(ledgerBudgetLines)
          .where(inArray(ledgerBudgetLines.budgetId, budgetIds))
      : [];
  const causeLinesByBudgetId = new Map<
    string,
    {
      id: string;
      cause: string;
      label: string;
      amountCents: number;
      pendingDeleteAt: string | null;
      starred: boolean;
      note: string | null;
    }[]
  >();
  for (const row of budgetLineRows) {
    const line = {
      id: row.id,
      cause: row.cause,
      label: row.label,
      amountCents: row.amountCents,
      pendingDeleteAt: row.pendingDeleteAt
        ? (row.pendingDeleteAt instanceof Date ? row.pendingDeleteAt.toISOString() : row.pendingDeleteAt)
        : null,
      starred: row.starred,
      note: row.note,
    };
    const existing = causeLinesByBudgetId.get(row.budgetId);
    if (existing) {
      existing.push(line);
    } else {
      causeLinesByBudgetId.set(row.budgetId, [line]);
    }
  }

  // 5. Build lookup maps — actuals use posted transactions only (inc2: status filter)
  const budgetMap = new Map<string, number>(); // key = `${categoryId}_${flow}`
  const budgetIdMap = new Map<string, string>(); // key = `${categoryId}_${flow}` -> ledger_budgets.id
  // Soft-delete-until-finalize (DECISION-052/053, Increment 2): ISO string
  // when the row's pending_delete_at is set, else null. Purely informational
  // — see FundReportCategoryLine.pendingDeleteAt's doc comment.
  const pendingDeleteMap = new Map<string, string | null>(); // key = `${categoryId}_${flow}`
  // Budget Star & Notes (DECISION-057) — siblings of pendingDeleteMap above,
  // built in the same loop. ADMIN-ONLY, see FundReportCategoryLine.starred's
  // doc comment.
  const starredMap = new Map<string, boolean>(); // key = `${categoryId}_${flow}`
  const noteMap = new Map<string, string | null>(); // key = `${categoryId}_${flow}`
  for (const b of budgetRows) {
    if (b.categoryId) {
      budgetMap.set(`${b.categoryId}_${b.flow}`, b.annualAmountCents);
      budgetIdMap.set(`${b.categoryId}_${b.flow}`, b.id);
      pendingDeleteMap.set(
        `${b.categoryId}_${b.flow}`,
        b.pendingDeleteAt ? b.pendingDeleteAt.toISOString() : null,
      );
      starredMap.set(`${b.categoryId}_${b.flow}`, b.starred);
      noteMap.set(`${b.categoryId}_${b.flow}`, b.note ?? null);
    }
  }

  /** null = lump-sum/no breakdown; never [] — see FundReportCategoryLine.causeLines. */
  function causeLinesFor(
    key: string,
  ):
    | {
        id: string;
        cause: string;
        label: string;
        amountCents: number;
        pendingDeleteAt: string | null;
        starred: boolean;
        note: string | null;
      }[]
    | null {
    const budgetId = budgetIdMap.get(key);
    if (!budgetId) return null;
    const lines = causeLinesByBudgetId.get(budgetId);
    return lines && lines.length > 0 ? lines : null;
  }

  // Separate posted vs. pending transactions for accurate balance and encumbered figures
  const postedTxns = txns.filter((t) => t.status === "posted");
  const pendingExpenseCents = txns
    .filter((t) => t.status === "pending" && t.flow === "expense")
    .reduce((s, t) => s + t.amountCents, 0);

  const actualMap = new Map<string, number>(); // key = `${categoryId}_${flow}`
  for (const txn of postedTxns) {
    if (txn.categoryId) {
      const key = `${txn.categoryId}_${txn.flow}`;
      actualMap.set(key, (actualMap.get(key) ?? 0) + txn.amountCents);
    }
  }

  // Cause/beneficiary prior-year reference (2026-07-28-causeline-prior-year-
  // reference): group this same FY's posted expense actuals by
  // (categoryId, cause, party) — reuses postedTxns already fetched above, no
  // extra query. See FundReport.causeActualsByKey's doc comment.
  const causeActualSourceRows: CauseActualSourceRow[] = [];
  for (const txn of postedTxns) {
    if (txn.flow !== "expense" || !txn.categoryId) continue;
    const cause = (txn.beneficiaryCause ?? "").trim();
    if (!cause) continue;
    causeActualSourceRows.push({
      categoryId: txn.categoryId,
      cause,
      party: txn.party,
      amountCents: txn.amountCents,
    });
  }
  const causeActualsByKey = buildCauseActualsByKey(causeActualSourceRows);

  // 6. Collect category IDs that appear in posted actuals but not the active category list
  //    (e.g. category was deactivated after transactions were recorded — still show it)
  const categoryIds = new Set(categories.map((c) => c.id));
  const extraCategoryIds = new Set<string>();
  for (const txn of postedTxns) {
    if (txn.categoryId && !categoryIds.has(txn.categoryId)) {
      extraCategoryIds.add(txn.categoryId);
    }
  }
  let extraCategories: LedgerCategory[] = [];
  if (extraCategoryIds.size > 0) {
    extraCategories = await db
      .select()
      .from(ledgerCategories)
      .where(inArray(ledgerCategories.id, Array.from(extraCategoryIds)));
  }
  const allCategories = [...categories, ...extraCategories];

  // 7. Build report lines per flow
  function buildLines(flowFilter: "income" | "expense"): FundReportCategoryLine[] {
    const flowCategories = allCategories.filter((c) => c.flow === flowFilter);
    // Also include categories that only appear in actuals (budget-only rows are caught by flowCategories)
    const result: FundReportCategoryLine[] = [];
    const seen = new Set<string>();

    for (const cat of flowCategories) {
      seen.add(cat.id);
      const key = `${cat.id}_${flowFilter}`;
      const actualCents = actualMap.get(key) ?? 0;
      const rawBudgetCents = budgetMap.get(key) ?? null;
      const causeLines = causeLinesFor(key);
      const starred = starredMap.get(key) ?? false;
      const note = noteMap.get(key) ?? null;
      // Budget Star & Notes loop-back fix (QA FAIL, DECISION-057; see
      // resolveDisplayBudgetCents's doc comment in ledger.ts). An
      // annotation-only lazy-created row (annualAmountCents: 0, no cause
      // lines, starred or noted) displays as un-budgeted (null), not as a
      // fabricated "0.00" — starred/note still surface unchanged below.
      const budgetCents = resolveDisplayBudgetCents(rawBudgetCents, causeLines !== null, starred, note);
      result.push({
        categoryId: cat.id,
        categoryName: cat.name,
        actualCents,
        budgetCents,
        variance: budgetVariance(actualCents, budgetCents),
        countsAsGiving: cat.countsAsGiving,
        causeLines,
        pendingDeleteAt: pendingDeleteMap.get(key) ?? null,
        starred,
        note,
      });
    }

    // Check for budget rows with no matching active category (shouldn't happen but be safe)
    for (const b of budgetRows) {
      if (b.categoryId && b.flow === flowFilter && !seen.has(b.categoryId)) {
        const key = `${b.categoryId}_${flowFilter}`;
        const actualCents = actualMap.get(key) ?? 0;
        const causeLines = causeLinesFor(key);
        const starred = starredMap.get(key) ?? false;
        const note = noteMap.get(key) ?? null;
        // Same annotation-only discriminator as above — see comment there.
        const budgetCents = resolveDisplayBudgetCents(b.annualAmountCents, causeLines !== null, starred, note);
        result.push({
          categoryId: b.categoryId,
          categoryName: "(Unknown category)",
          actualCents,
          budgetCents,
          variance: budgetVariance(actualCents, budgetCents),
          countsAsGiving: false,
          causeLines,
          pendingDeleteAt: pendingDeleteMap.get(key) ?? null,
          starred,
          note,
        });
      }
    }

    return result;
  }

  const income = buildLines("income");
  const expense = buildLines("expense");

  // Actuals here are derived from postedTxns only (inc2: status filter)
  const totalIncomeCents = income.reduce((s, l) => s + l.actualCents, 0);
  const totalExpenseCents = expense.reduce((s, l) => s + l.actualCents, 0);
  const endingCents = rolledForwardOpening + totalIncomeCents - totalExpenseCents;

  return {
    fund,
    openingCents: rolledForwardOpening,
    income,
    expense,
    totalIncomeCents,
    totalExpenseCents,
    endingCents,
    pendingExpenseCents,
    causeActualsByKey,
  };
}

// ---------------------------------------------------------------------------
// DrizzleTransaction — shared tx-client type (Guided Budgeting)
// ---------------------------------------------------------------------------

// Inferred from db.transaction's callback parameter — avoids importing Drizzle
// internals. Same pattern as src/lib/dues-ledger-sync.ts.
type DrizzleTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// assertBudgetUnlocked / getBudgetApproval — Budget Approve/Lock
// ---------------------------------------------------------------------------

export type LockCheckResult = { ok: true } | { ok: false; error: string; status: 409 };

/**
 * Every write touching ledger_budgets or ledger_categories for a given
 * (entityId, fiscalYear) must reject when that pair is locked. Called from
 * inside upsertBudgetLine (covers PATCH /budgets, POST /budgets/seed, and the
 * add-line path for free) and explicitly from POST /categories (category
 * creation doesn't go through upsertBudgetLine — architect Ruling 2).
 *
 * @param tx  Optional Drizzle transaction client — pass the enclosing `tx`
 *            so the lock check reads inside the same transaction as the
 *            write it's guarding. Defaults to the module-level `db`.
 */
export async function assertBudgetUnlocked(
  entityId: string,
  fiscalYear: number,
  tx: DrizzleTransaction | typeof db = db,
): Promise<LockCheckResult> {
  const rows = await tx
    .select({ status: ledgerBudgetApprovals.status })
    .from(ledgerBudgetApprovals)
    .where(
      and(
        eq(ledgerBudgetApprovals.entityId, entityId),
        eq(ledgerBudgetApprovals.fiscalYear, fiscalYear),
      ),
    )
    .limit(1);
  if (isBudgetLocked(rows[0] ?? null)) {
    return {
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
    };
  }
  return { ok: true };
}

export type BudgetApprovalWithNames = LedgerBudgetApproval & {
  approvedByName: string | null;
  unlockedByName: string | null;
};

/**
 * Current approve/lock state for a given (entityId, fiscalYear), or null if
 * no row exists yet (unlocked by default — isBudgetLocked(null) === false).
 * No corresponding GET route — budgeting/page.tsx (a Server Component) calls
 * this directly, matching how it already fetches every other piece of page
 * data (getFunds, getFundReport, computeSeedFromPriorYear) without an
 * internal API round-trip (DECISION-044).
 *
 * @param tx  Optional Drizzle transaction client — pass the enclosing `tx` so
 *            the lock-check read happens inside the same transaction as the
 *            finalize write it's guarding (DECISION-052/053, Increment 2:
 *            closes the check-then-act race on POST /budget-approvals).
 *            Defaults to the module-level `db`, matching
 *            assertBudgetUnlocked's own optional-tx convention.
 */
export async function getBudgetApproval(
  entityId: string,
  fiscalYear: number,
  tx: DrizzleTransaction | typeof db = db,
): Promise<BudgetApprovalWithNames | null> {
  const approvedByUser = alias(users, "approvedByUser");
  const unlockedByUser = alias(users, "unlockedByUser");
  const rows = await tx
    .select({
      ...getTableColumns(ledgerBudgetApprovals),
      approvedByName: approvedByUser.name,
      unlockedByName: unlockedByUser.name,
    })
    .from(ledgerBudgetApprovals)
    .leftJoin(approvedByUser, eq(ledgerBudgetApprovals.approvedByUserId, approvedByUser.id))
    .leftJoin(unlockedByUser, eq(ledgerBudgetApprovals.unlockedByUserId, unlockedByUser.id))
    .where(
      and(
        eq(ledgerBudgetApprovals.entityId, entityId),
        eq(ledgerBudgetApprovals.fiscalYear, fiscalYear),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// getBudgetNotes — Budget-level Notes & Assumptions (DECISION-060)
// ---------------------------------------------------------------------------

export type BudgetNotesResult = {
  notes: string;
  updatedByName: string | null;
  updatedAtLabel: string | null;
};

/**
 * Current budget-level "Notes & Assumptions" free text for a given
 * (entityId, fiscalYear), or null if never written (a draft budget's default
 * state — the overview renders an empty, editable textarea, not an error).
 * Sibling read to getBudgetApproval, same shape/style: single SELECT ... WHERE
 * entityId = ? AND fiscalYear = ? LIMIT 1, join updatedByUserId -> users.name.
 *
 * No corresponding GET route — budgeting/page.tsx (a Server Component) calls
 * this directly, matching how getBudgetApproval is already called with no
 * internal API round-trip (DECISION-044 precedent).
 */
export async function getBudgetNotes(
  entityId: string,
  fiscalYear: number,
): Promise<BudgetNotesResult | null> {
  const updatedByUser = alias(users, "notesUpdatedByUser");
  const rows = await db
    .select({
      notes: ledgerBudgetNotes.notes,
      updatedByName: updatedByUser.name,
      updatedAt: ledgerBudgetNotes.updatedAt,
    })
    .from(ledgerBudgetNotes)
    .leftJoin(updatedByUser, eq(ledgerBudgetNotes.updatedByUserId, updatedByUser.id))
    .where(
      and(eq(ledgerBudgetNotes.entityId, entityId), eq(ledgerBudgetNotes.fiscalYear, fiscalYear)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    notes: row.notes,
    updatedByName: row.updatedByName,
    updatedAtLabel: row.updatedAt
      ? row.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null,
  };
}

// ---------------------------------------------------------------------------
// upsertBudgetLine — Guided Budgeting (shared upsert core, architect Ruling 1)
// ---------------------------------------------------------------------------

export type UpsertBudgetLineParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  /** null = delete the row */
  annualAmountCents: number | null;
  /**
   * "update" = today's PATCH behavior (onConflictDoUpdate). "skip" =
   * onConflictDoNothing — exists on this shared function for correctness/
   * defense-in-depth; the seed endpoint's own dispatch (decideSeedWriteAction)
   * filters out known collisions before ever calling this function, so in
   * practice "skip" is not exercised by either current caller.
   */
  conflictMode: "update" | "skip";
};

export type UpsertBudgetLineResult =
  | { ok: true; action: "upserted" | "deleted"; id?: string }
  | {
      ok: false;
      error: string;
      status: 400 | 404 | 409;
      /**
       * Discriminates the two distinct 409 causes so callers (specifically
       * the seed route's top-level loop) can react differently — a locked
       * budget must still abort/roll back the whole request, but a
       * cause-broken-down category should be skipped and the rest of the
       * request should proceed. Absent for 400/404s. (Regression fix,
       * qa Phase 5 FAIL 2026-07-27 — see hasCauseLineChildren below.)
       */
      reason?: "locked" | "has_cause_breakdown";
    };

/**
 * Shared upsert-or-delete core for a single `(fundId, fiscalYear, categoryId,
 * flow)` budget line. Both PATCH /api/admin/ledger/budgets (one line at a
 * time) and POST /api/admin/ledger/budgets/seed (looping in-process, inside
 * one transaction) call this function — one source of truth for what a valid
 * budget-line write looks like (architect Ruling 1).
 *
 * Fetches the fund and category rows, delegates the actual validation to the
 * pure validateBudgetLineInput() in ledger.ts, and if invalid returns its
 * error verbatim. If valid: `annualAmountCents === null` deletes the row
 * (matching the original PATCH route's delete branch exactly); otherwise
 * inserts with either onConflictDoUpdate (conflictMode: "update") or
 * onConflictDoNothing (conflictMode: "skip").
 *
 * CAUSE-LINE-AWARE GUARD (regression fix, qa Phase 5 FAIL 2026-07-27): this
 * is the OLD lump-sum write path, from before B-17 Increment A's cause-line
 * child table existed. It must never write directly to a ledger_budgets row
 * that already has ledger_budget_lines children — a numeric
 * annualAmountCents would silently desync the parent's rolled-up total from
 * its children (the exact invariant DECISION-045/046 calls "the single
 * invariant the whole design depends on"), and annualAmountCents === null
 * (the delete branch) would cascade-delete the children outright
 * (ledger_budget_lines.budget_id -> ledger_budgets.id is ON DELETE CASCADE).
 * A category that's been broken down by cause must be edited through
 * createBudgetCauseLine / updateBudgetCauseLine / deleteBudgetCauseLine /
 * collapseBudgetCauseLines — never through this function. Checked after the
 * lock check (so a locked
 * budget still 409s with its own, distinct reason first) and before either
 * write branch, inside the same transaction.
 *
 * @param params  See UpsertBudgetLineParams.
 * @param tx      Optional Drizzle transaction client — pass the `tx` from an
 *                enclosing db.transaction() to write atomically alongside
 *                other writes (the seed endpoint's usage). Defaults to the
 *                module-level `db` for standalone callers (the PATCH route).
 */
export async function upsertBudgetLine(
  params: UpsertBudgetLineParams,
  tx: DrizzleTransaction | typeof db = db,
): Promise<UpsertBudgetLineResult> {
  const { fundId, fiscalYear, categoryId, flow, annualAmountCents, conflictMode } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;

  const catRows = await tx
    .select({
      id: ledgerCategories.id,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
    })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = catRows[0] ?? null;

  const validation = validateBudgetLineInput({
    fund: fund ? { id: fund.id, kind: fund.kind } : null,
    category: category ? { id: category.id, fundKind: category.fundKind, flow: category.flow } : null,
    flow,
    fiscalYear,
    annualAmountCents,
  });
  if (!validation.ok) {
    return validation;
  }
  if (!fund || !category) {
    // Unreachable: validateBudgetLineInput returns ok:false above when either
    // is null. Guards TS narrowing for the entityId/insert below.
    return { ok: false, error: "Fund or category not found", status: 404 };
  }

  // Lock check runs after shape validation (so a bad fundId/categoryId/amount
  // still returns its existing 400/404 first) and before the delete/insert
  // branch — covers PATCH /budgets, POST /budgets/seed, and the add-line
  // path for free, since all three funnel through this function (Phase 3
  // design, architect Ruling 2).
  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  // Cause-line-aware guard — see the CAUSE-LINE-AWARE GUARD note above this
  // function. Runs against whatever ledger_budgets row already exists for
  // this exact (fundId, fiscalYear, categoryId, flow) tuple, regardless of
  // whether this call would delete it (annualAmountCents === null) or
  // overwrite it — both are unsafe once cause-line children exist.
  const existingBudgetForChildCheck = await tx
    .select({ id: ledgerBudgets.id })
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, fiscalYear),
        eq(ledgerBudgets.categoryId, categoryId),
        eq(ledgerBudgets.flow, flow),
      ),
    )
    .limit(1);
  const existingBudgetIdForChildCheck = existingBudgetForChildCheck[0]?.id;
  if (existingBudgetIdForChildCheck) {
    const existingChildRows = await tx
      .select({ id: ledgerBudgetLines.id })
      .from(ledgerBudgetLines)
      .where(eq(ledgerBudgetLines.budgetId, existingBudgetIdForChildCheck))
      .limit(1);
    if (existingChildRows.length > 0) {
      return {
        ok: false,
        error: "This category is broken down by cause — edit its cause lines instead.",
        status: 409,
        reason: "has_cause_breakdown",
      };
    }
  }

  if (annualAmountCents === null) {
    await tx
      .delete(ledgerBudgets)
      .where(
        and(
          eq(ledgerBudgets.fundId, fundId),
          eq(ledgerBudgets.fiscalYear, fiscalYear),
          eq(ledgerBudgets.categoryId, categoryId),
          eq(ledgerBudgets.flow, flow),
        ),
      );
    return { ok: true, action: "deleted" };
  }

  const conflictTarget = [
    ledgerBudgets.fundId,
    ledgerBudgets.fiscalYear,
    ledgerBudgets.categoryId,
    ledgerBudgets.flow,
  ];

  if (conflictMode === "skip") {
    const [row] = await tx
      .insert(ledgerBudgets)
      .values({
        entityId: fund.entityId,
        fundId,
        fiscalYear,
        categoryId,
        flow,
        annualAmountCents,
      })
      .onConflictDoNothing({ target: conflictTarget })
      .returning({ id: ledgerBudgets.id });
    return { ok: true, action: "upserted", id: row?.id };
  }

  const [upserted] = await tx
    .insert(ledgerBudgets)
    .values({
      entityId: fund.entityId,
      fundId,
      fiscalYear,
      categoryId,
      flow,
      annualAmountCents,
    })
    .onConflictDoUpdate({
      target: conflictTarget,
      set: {
        annualAmountCents,
        updatedAt: new Date(),
      },
    })
    .returning({ id: ledgerBudgets.id });

  return { ok: true, action: "upserted", id: upserted.id };
}

// ---------------------------------------------------------------------------
// setBudgetLinePendingDelete — Soft-delete/restore-until-finalize
// (DECISION-052/053, Increment 2 of
// docs/work-log/2026-07-28-budgeting-page-redesign.md)
// ---------------------------------------------------------------------------

export type SetBudgetLinePendingDeleteParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  pendingDelete: boolean;
};

export type SetBudgetLinePendingDeleteResult =
  | { ok: true; action: "pending-delete" | "restored" | "deleted" }
  | {
      ok: false;
      error: string;
      status: 400 | 404 | 409;
      /** Present on 409s only. As of the Budgeting Page Restructure
       *  (DECISION-054/056) this function can only 409 with `"locked"` —
       *  its own copy of the `has_cause_breakdown` guard was removed (Flow
       *  6: a category must be soft-deletable/restorable even while broken
       *  down by cause). `upsertBudgetLine`'s SEPARATE copy of that guard
       *  (Shape A, the amount write) is unaffected and still returns
       *  `"has_cause_breakdown"` for its own hazard. */
      reason?: "locked";
    };

/**
 * Soft-delete/restore core for a single `(fundId, fiscalYear, categoryId,
 * flow)` budget line. Runs the fund/category lookup and assertBudgetUnlocked
 * upsertBudgetLine also runs, but otherwise flips ONLY pending_delete_at on
 * an existing row; annual_amount_cents is never WRITTEN by this function for
 * an existing row, which is what makes "restore brings the number back
 * exactly" true by construction, not by special-casing.
 *
 * UNLIKE upsertBudgetLine, this function does NOT run the cause-line-children
 * guard (removed by the Budgeting Page Restructure, DECISION-054/056 — see
 * the comment further down in this function's body for the full rationale).
 * A category can be soft-deleted (and restored) while it's broken down by
 * cause; its cause lines are excluded from every read consumer at read time
 * via isCauseLineLive (src/lib/ledger.ts), never via a cascade-written flag.
 *
 * Bug fix, 2026-07-30 (docs/work-log/2026-07-30-budget-trash-unbudgeted.md):
 * `pendingDelete: true` (soft-delete) against a category with NO existing
 * ledger_budgets row now LAZILY CREATES one — `annualAmountCents: 0`,
 * `pendingDeleteAt` set in the same insert — mirroring
 * setBudgetCategoryAnnotation's existing lazy-create precedent, instead of
 * 404ing. This is what makes the trash-icon control work on an unbudgeted
 * category (previously a silent client-side no-op — the row didn't exist to
 * flip a flag on). `pendingDelete: false` (restore) still requires an
 * existing row and 404s otherwise — there is no legitimate "restore a row
 * that was never removed" gesture reachable via the UI.
 *
 * Restore of a row whose `annualAmountCents === 0` HARD-deletes it instead of
 * clearing the flag — this is what "leaves no orphan $0 rows" means for the
 * lazily-created case: un-trashing an unbudgeted category must return it to
 * the true unbudgeted state (no row), not a visible $0 budget the treasurer
 * never entered. The tradeoff (documented in the work-log): a category a
 * treasurer deliberately budgeted at exactly $0, then trashed, then
 * restored, comes back unbudgeted rather than $0 — there's no stored flag
 * distinguishing "deliberate $0" from "lazily-created $0" without a schema
 * change, and $0-budgeted vs. unbudgeted are financially equivalent for
 * reporting purposes, so this was judged an acceptable, rare edge case
 * rather than one worth a new column for.
 *
 * Both directions (pendingDelete: true and false) run the FULL guard
 * sequence, including the lock check — restore is lock-guarded too
 * (architect's explicit ruling, Phase 2 Increment 2: "the one new
 * server-side gate... present on both the soft-delete and the restore
 * direction, not just soft-delete").
 *
 * @param tx  Optional Drizzle transaction client. Defaults to the
 *            module-level `db` for the standalone PATCH route caller.
 */
export async function setBudgetLinePendingDelete(
  params: SetBudgetLinePendingDeleteParams,
  tx: DrizzleTransaction | typeof db = db,
): Promise<SetBudgetLinePendingDeleteResult> {
  const { fundId, fiscalYear, categoryId, flow, pendingDelete } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;

  const catRows = await tx
    .select({
      id: ledgerCategories.id,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
    })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = catRows[0] ?? null;

  // Reuses upsertBudgetLine's own fund/category/flow/fiscalYear shape
  // validation. annualAmountCents: null short-circuits its amount-bounds
  // branch (there's no amount involved in a pending-delete write).
  const validation = validateBudgetLineInput({
    fund: fund ? { id: fund.id, kind: fund.kind } : null,
    category: category ? { id: category.id, fundKind: category.fundKind, flow: category.flow } : null,
    flow,
    fiscalYear,
    annualAmountCents: null,
  });
  if (!validation.ok) {
    return validation;
  }
  if (!fund || !category) {
    // Unreachable: validateBudgetLineInput returns ok:false above when either
    // is null. Guards TS narrowing below.
    return { ok: false, error: "Fund or category not found", status: 404 };
  }

  // Lock check — run for BOTH directions (soft-delete AND restore), same as
  // upsertBudgetLine's own placement (after shape validation, before any
  // row-existence/write branch).
  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  // Row-must-exist check for RESTORE only. Unlike upsertBudgetLine (where "no
  // row" just means "insert one"), restore has no insert branch — there must
  // already be something to bring back. Soft-delete (pendingDelete: true)
  // instead lazily creates the row below when none exists (bug fix,
  // 2026-07-30 — see the function doc comment above).
  const existingRows = await tx
    .select({ id: ledgerBudgets.id, annualAmountCents: ledgerBudgets.annualAmountCents })
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, fiscalYear),
        eq(ledgerBudgets.categoryId, categoryId),
        eq(ledgerBudgets.flow, flow),
      ),
    )
    .limit(1);
  const existing = existingRows[0] ?? null;

  if (!existing) {
    if (!pendingDelete) {
      return { ok: false, error: "No budget line exists for this category to modify.", status: 404 };
    }

    // Lazy-create-then-soft-delete (bug fix, 2026-07-30): the trash-icon
    // control on a category with no budget row for this FY. onConflictDoUpdate
    // (rather than a plain insert) is defensive against a race — a concurrent
    // write creating the row between our SELECT above and this INSERT — and
    // mirrors setBudgetCategoryAnnotation's existing lazy-create pattern.
    // Never touches annualAmountCents on the conflict branch, same reasoning
    // as that function: if a real amount was written concurrently, this
    // soft-delete must not clobber it.
    await tx
      .insert(ledgerBudgets)
      .values({
        entityId: fund.entityId,
        fundId,
        fiscalYear,
        categoryId,
        flow,
        annualAmountCents: 0, // ONLY here — used solely when no row exists yet
        pendingDeleteAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [ledgerBudgets.fundId, ledgerBudgets.fiscalYear, ledgerBudgets.categoryId, ledgerBudgets.flow],
        set: {
          pendingDeleteAt: new Date(),
          updatedAt: new Date(),
        },
      });

    return { ok: true, action: "pending-delete" };
  }

  // NOTE: unlike upsertBudgetLine, this function does NOT guard against
  // cause-line children. The Budgeting Page Restructure (DECISION-054/056)
  // requires a category to be soft-deletable (and restorable) even while it
  // carries cause lines underneath it — Flow 6, "Remove a whole category,
  // lump sum or in breakdown." Removing this guard is safe because this
  // function never cascades a write onto children in either direction: a
  // pending-delete category's cause lines keep their own, independent
  // pendingDeleteAt (or lack thereof) untouched. Every read consumer
  // (getFundReport's callers, the print worksheet, the finalize-purge
  // transaction) excludes a cause line via isCauseLineLive(cl.pendingDeleteAt,
  // line.pendingDeleteAt) — an OR over BOTH flags, computed at read time —
  // rather than relying on a cascade-written child flag. upsertBudgetLine's
  // OWN copy of the has_cause_breakdown guard (above in this file) is left
  // untouched: it guards a different hazard (a numeric annualAmountCents
  // overwrite, or a hard delete-via-cascade, silently desyncing children)
  // that has nothing to do with this reversible soft-delete path.

  if (!pendingDelete && existing.annualAmountCents === 0) {
    // Restore of a lazily-created (or deliberately-$0) row — hard-delete
    // instead of clearing the flag, so an unbudgeted category restores to
    // truly unbudgeted rather than a visible $0 line nobody entered. See the
    // function doc comment above for the documented tradeoff.
    await tx.delete(ledgerBudgets).where(eq(ledgerBudgets.id, existing.id));
    return { ok: true, action: "deleted" };
  }

  // The pure flag-flip. annual_amount_cents is never touched here.
  await tx
    .update(ledgerBudgets)
    .set({
      pendingDeleteAt: pendingDelete ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(ledgerBudgets.id, existing.id));

  return { ok: true, action: pendingDelete ? "pending-delete" : "restored" };
}

// ---------------------------------------------------------------------------
// setBudgetCategoryAnnotation / setBudgetCauseLineAnnotation — Budget Star &
// Notes (DECISION-057, docs/work-log/2026-07-28-budget-star-notes.md)
// ---------------------------------------------------------------------------

export type SetBudgetAnnotationResult =
  | { ok: true; starred: boolean; note: string | null }
  | { ok: false; error: string; status: 400 | 404 };

export type SetBudgetCategoryAnnotationParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  /** At least one of starred/note is required. */
  starred?: boolean;
  note?: string | null;
};

/**
 * INTENTIONAL: this function never calls assertBudgetUnlocked() and imports
 * nothing from it. Star/note are working annotations, not budget figures —
 * Phase 1 Decision 6 (DECISION-057) requires them to stay editable even when
 * the FY budget is Approve-&-locked. Do NOT add a lock check here to "make
 * locking consistent" — that would silently reverse a confirmed product
 * decision. This is the FIRST budget write path in this codebase to skip the
 * lock check; every other write against ledger_budgets/ledger_budget_lines
 * (upsertBudgetLine, setBudgetLinePendingDelete, createBudgetCauseLine,
 * updateBudgetCauseLine, etc.) still calls it.
 *
 * Category-grain star/note write. Lazy-creates the `ledger_budgets` row
 * (annualAmountCents: 0) when a category has no budget row yet — a category
 * the treasurer bothers to star/note doesn't yet have to be budgeted (Phase 1
 * Decision 4). THE LANDMINE (architect's Phase 2 must-honor item): the
 * conflict `set` clause is built CONDITIONALLY — `annualAmountCents` never
 * appears there at all (it is only ever written via the insert `.values()`,
 * used solely when no row exists yet), and `starred`/`note` are included in
 * `set` ONLY when the caller actually sent them. Without this, a star-only
 * click on an already-$5,000-budgeted, already-noted category would silently
 * zero the amount and/or blank the note.
 *
 * @param tx  Optional Drizzle transaction client. Defaults to the
 *            module-level `db` — a single-row upsert is safe to run
 *            standalone (mirrors upsertBudgetLine's own convention).
 */
export async function setBudgetCategoryAnnotation(
  params: SetBudgetCategoryAnnotationParams,
  tx: DrizzleTransaction | typeof db = db,
): Promise<SetBudgetAnnotationResult> {
  const { fundId, fiscalYear, categoryId, flow, starred, note } = params;

  if (starred === undefined && note === undefined) {
    return { ok: false, error: "At least one of starred or note is required", status: 400 };
  }

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  const catRows = await tx
    .select({ id: ledgerCategories.id })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = catRows[0] ?? null;
  if (!category) {
    return { ok: false, error: "Category not found", status: 404 };
  }

  // Note normalization (src/lib/ledger.ts): undefined -> not being changed;
  // "" / whitespace-only after trim -> stored as null; otherwise trim +
  // length-check BEFORE the ""->null collapse (see normalizeBudgetNote's doc
  // comment for why the order matters).
  let normalizedNote: string | null | undefined;
  if (note !== undefined) {
    const trimmed = normalizeBudgetNote(note);
    if (trimmed.length > MAX_BUDGET_NOTE_LENGTH) {
      return {
        ok: false,
        error: `note must be ${MAX_BUDGET_NOTE_LENGTH} characters or fewer`,
        status: 400,
      };
    }
    normalizedNote = trimmed === "" ? null : trimmed;
  }

  const [row] = await tx
    .insert(ledgerBudgets)
    .values({
      entityId: fund.entityId,
      fundId,
      fiscalYear,
      categoryId,
      flow,
      annualAmountCents: 0, // ONLY here — used solely when no row exists yet
      starred: starred ?? false,
      note: normalizedNote ?? null,
    })
    .onConflictDoUpdate({
      target: [ledgerBudgets.fundId, ledgerBudgets.fiscalYear, ledgerBudgets.categoryId, ledgerBudgets.flow],
      set: {
        // annualAmountCents is ABSENT here, on purpose — an existing row's
        // real budgeted amount must never be touched by a star/note write.
        ...(starred !== undefined ? { starred } : {}),
        ...(normalizedNote !== undefined ? { note: normalizedNote } : {}),
        updatedAt: new Date(),
      },
    })
    .returning({ starred: ledgerBudgets.starred, note: ledgerBudgets.note });

  return { ok: true, starred: row.starred, note: row.note };
}

export type SetBudgetCauseLineAnnotationParams = {
  id: string;
  /** At least one of starred/note is required. */
  starred?: boolean;
  note?: string | null;
};

/**
 * INTENTIONAL: this function never calls assertBudgetUnlocked() and imports
 * nothing from it — same DECISION-057 exception as
 * setBudgetCategoryAnnotation above. Do NOT add a lock check here.
 *
 * Cause-line-grain star/note write. Plain conditional `UPDATE ... WHERE id` —
 * unlike the category grain, there is NO lazy-create here: a cause line only
 * ever exists once actually created via the existing create-or-update route
 * (architect's Phase 2 point 3); there is no "un-budgeted cause line"
 * rendered anywhere the way an un-budgeted category is. Same conditional-set
 * discipline as the category grain: `starred`/`note` are included in the
 * `UPDATE ... SET` only when the caller actually sent them, so a star-only
 * PATCH never blanks an existing note and vice versa.
 *
 * @param tx  Optional Drizzle transaction client. Defaults to the
 *            module-level `db` — a single-row update is safe to run
 *            standalone.
 */
export async function setBudgetCauseLineAnnotation(
  params: SetBudgetCauseLineAnnotationParams,
  tx: DrizzleTransaction | typeof db = db,
): Promise<SetBudgetAnnotationResult> {
  const { id, starred, note } = params;

  if (starred === undefined && note === undefined) {
    return { ok: false, error: "At least one of starred or note is required", status: 400 };
  }

  const lineRows = await tx
    .select({ id: ledgerBudgetLines.id })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.id, id))
    .limit(1);
  if (!lineRows[0]) {
    return { ok: false, error: "No cause line found for this id", status: 404 };
  }

  let normalizedNote: string | null | undefined;
  if (note !== undefined) {
    const trimmed = normalizeBudgetNote(note);
    if (trimmed.length > MAX_BUDGET_NOTE_LENGTH) {
      return {
        ok: false,
        error: `note must be ${MAX_BUDGET_NOTE_LENGTH} characters or fewer`,
        status: 400,
      };
    }
    normalizedNote = trimmed === "" ? null : trimmed;
  }

  const [row] = await tx
    .update(ledgerBudgetLines)
    .set({
      ...(starred !== undefined ? { starred } : {}),
      ...(normalizedNote !== undefined ? { note: normalizedNote } : {}),
      updatedAt: new Date(),
    })
    .where(eq(ledgerBudgetLines.id, id))
    .returning({ starred: ledgerBudgetLines.starred, note: ledgerBudgetLines.note });

  return { ok: true, starred: row.starred, note: row.note };
}

// ---------------------------------------------------------------------------
// createBudgetCauseLine / updateBudgetCauseLine / deleteBudgetCauseLine /
// upsertBudgetCauseLineForSeed / getBudgetCauseLineLabels /
// collapseBudgetCauseLines — Cause-Tagged Budget Line Items (B-17 Increment
// A, DECISION-045/046), re-keyed to `id` by Labeled Cause Budget Lines
// (DECISION-047/048)
// ---------------------------------------------------------------------------

// Every function below REQUIRES an enclosing db.transaction()'s `tx` — unlike
// upsertBudgetLine (a single-row write, safe to run standalone against the
// module-level `db`), these functions touch both a child ledger_budget_lines
// row AND recompute/persist the parent ledger_budgets.annualAmountCents in
// the same request. A partial write (child upserted, parent total stale)
// silently breaks the "parent = sum of children" invariant every read path
// depends on — Phase 3's highest-risk implementation detail. Route handlers
// must call `db.transaction(async (tx) => ...)` and pass `tx` through.
//
// Row identity moved from `(budgetId, cause)` to the line's own `id`
// (DECISION-047 item 3): a cause can now have multiple labeled lines, so
// `cause` alone can no longer address a specific row. `createBudgetCauseLine`
// is a plain INSERT (not onConflictDoUpdate — DECISION-048 item 3: an upsert
// would silently merge two distinct, differently-labeled lines the moment a
// duplicate (cause, label) was submitted, exactly the bug this increment
// exists to prevent). `updateBudgetCauseLine`/`deleteBudgetCauseLine` address
// a line by `id` alone. The seed-only path keeps upsert semantics, renamed
// `upsertBudgetCauseLineForSeed` (see below) since re-running "seed from last
// year" must update the existing generic (`label: ''`) line, not 409 against
// itself.

/**
 * Extracts a Postgres error code from a thrown value, unwrapping Drizzle's
 * `.cause` wrapping when present. Mirrors the pattern in
 * src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts
 * — used here to translate a `(budget_id, cause, label)` unique-constraint
 * race (23505) into the same clean `duplicate_cause_label` 409 the pre-check
 * SELECT already returns in the common case, instead of a generic 500.
 */
function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return (err as { code?: string }).code;
  }
  if (
    typeof err === "object" &&
    err !== null &&
    "cause" in err &&
    typeof (err as { cause?: unknown }).cause === "object" &&
    (err as { cause?: unknown }).cause !== null &&
    "code" in (err as { cause: object }).cause
  ) {
    return (err as { cause: { code?: string } }).cause.code;
  }
  return undefined;
}

function duplicateCauseLabelResult(cause: string): {
  ok: false;
  error: string;
  status: 409;
  reason: "duplicate_cause_label";
} {
  return {
    ok: false,
    error: `A line for "${cause}" with this label already exists — edit it instead.`,
    status: 409,
    reason: "duplicate_cause_label",
  };
}

export type CreateBudgetCauseLineParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  cause: string;
  /** Optional free text, normalized (trim) server-side; "" = the generic/unlabeled line for this cause. */
  label?: string;
  /** Non-negative integer, required — no null/delete-via-amount convention here (see deleteBudgetCauseLine). */
  amountCents: number;
};

export type CreateBudgetCauseLineResult =
  | { ok: true; action: "created"; lineId: string; cause: string; label: string; categoryTotalCents: number }
  | { ok: false; error: string; status: 400 | 404 | 409; reason?: "locked" | "duplicate_cause_label" };

/**
 * Create one cause-tagged budget line item. Also the entry point for a
 * category's *first* cause line — i.e. "entering breakdown mode" — since the
 * parent ledger_budgets row is created here (onConflictDoNothing) if it
 * doesn't already exist (DECISION-046 item 1, unchanged: there is no separate
 * "convert to breakdown" endpoint; the client pre-fills the first row and
 * this route commits it like any other).
 *
 * Steps, all inside the caller's transaction:
 *   1. Fetch fund + category; validateBudgetLineInput() for the shared
 *      fund/category/flow/fiscalYear/amount-bounds checks (reused verbatim).
 *   2. isValidBudgetCause(cause) -> 400 if off-taxonomy.
 *   3. normalizeBudgetLineLabel(label) -> 400 if the trimmed result exceeds
 *      MAX_BUDGET_LINE_LABEL_LENGTH.
 *   4. assertBudgetUnlocked(fund.entityId, fiscalYear, tx).
 *   5. Upsert the parent ledger_budgets row (onConflictDoNothing — its
 *      annualAmountCents is corrected in step 8 regardless of whether it
 *      pre-existed, e.g. as a lump sum).
 *   6. Pre-check: a SELECT for an existing sibling at
 *      (budgetId, cause, normalizedLabel) -> 409 duplicate_cause_label if
 *      found, before ever attempting the INSERT.
 *   7. Plain INSERT (not onConflictDoUpdate — see the block comment above).
 *      The (budget_id, cause, label) unique constraint is race-condition
 *      defense-in-depth: a 23505 thrown here (two concurrent requests racing
 *      past the pre-check) is caught and mapped to the SAME
 *      409 duplicate_cause_label response, never a generic 500.
 *   8. Recompute SUM(amountCents) over all children for that budgetId and
 *      UPDATE the parent's annualAmountCents to match — the step that keeps
 *      "parent = sum of children" always true.
 */
export async function createBudgetCauseLine(
  params: CreateBudgetCauseLineParams,
  tx: DrizzleTransaction,
): Promise<CreateBudgetCauseLineResult> {
  const { fundId, fiscalYear, categoryId, flow, cause, amountCents } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;

  const catRows = await tx
    .select({
      id: ledgerCategories.id,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
    })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = catRows[0] ?? null;

  const validation = validateBudgetLineInput({
    fund: fund ? { id: fund.id, kind: fund.kind } : null,
    category: category ? { id: category.id, fundKind: category.fundKind, flow: category.flow } : null,
    flow,
    fiscalYear,
    annualAmountCents: amountCents,
  });
  if (!validation.ok) {
    return validation;
  }
  if (!fund || !category) {
    // Unreachable: validateBudgetLineInput returns ok:false above when either is null.
    return { ok: false, error: "Fund or category not found", status: 404 };
  }

  if (!isValidBudgetCause(cause)) {
    return { ok: false, error: "cause must be one of the controlled taxonomy values", status: 400 };
  }

  const label = normalizeBudgetLineLabel(params.label);
  if (label.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
    return {
      ok: false,
      error: `label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer`,
      status: 400,
    };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  const budgetConflictTarget = [
    ledgerBudgets.fundId,
    ledgerBudgets.fiscalYear,
    ledgerBudgets.categoryId,
    ledgerBudgets.flow,
  ];

  const [insertedBudget] = await tx
    .insert(ledgerBudgets)
    .values({
      entityId: fund.entityId,
      fundId,
      fiscalYear,
      categoryId,
      flow,
      annualAmountCents: amountCents,
    })
    .onConflictDoNothing({ target: budgetConflictTarget })
    .returning({ id: ledgerBudgets.id });

  let budgetId = insertedBudget?.id;
  if (!budgetId) {
    const existingBudget = await tx
      .select({ id: ledgerBudgets.id })
      .from(ledgerBudgets)
      .where(
        and(
          eq(ledgerBudgets.fundId, fundId),
          eq(ledgerBudgets.fiscalYear, fiscalYear),
          eq(ledgerBudgets.categoryId, categoryId),
          eq(ledgerBudgets.flow, flow),
        ),
      )
      .limit(1);
    budgetId = existingBudget[0]?.id;
  }
  if (!budgetId) {
    // Unreachable in practice (insert either returns a row or the row already
    // exists and the re-select finds it) — defensive.
    return { ok: false, error: "Failed to resolve budget row", status: 404 };
  }

  // Pre-check: a same-transaction SELECT catches the common case cleanly,
  // before ever attempting the INSERT — see DECISION-048 item 3.
  const existingSibling = await tx
    .select({ id: ledgerBudgetLines.id })
    .from(ledgerBudgetLines)
    .where(
      and(
        eq(ledgerBudgetLines.budgetId, budgetId),
        eq(ledgerBudgetLines.cause, cause),
        eq(ledgerBudgetLines.label, label),
      ),
    )
    .limit(1);
  if (existingSibling.length > 0) {
    return duplicateCauseLabelResult(cause);
  }

  let lineId: string;
  try {
    const [line] = await tx
      .insert(ledgerBudgetLines)
      .values({ budgetId, cause, label, amountCents })
      .returning({ id: ledgerBudgetLines.id });
    lineId = line.id;
  } catch (err) {
    // Race defense-in-depth: two concurrent requests both passed the
    // pre-check above before either committed. The DB constraint is the
    // final word — map its violation to the identical response the
    // pre-check would have returned, never a generic 500.
    if (pgErrorCode(err) === "23505") {
      return duplicateCauseLabelResult(cause);
    }
    throw err;
  }

  const childRows = await tx
    .select({ amountCents: ledgerBudgetLines.amountCents })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.budgetId, budgetId));
  const categoryTotalCents = sumBudgetCauseLines(childRows);

  await tx
    .update(ledgerBudgets)
    .set({ annualAmountCents: categoryTotalCents, updatedAt: new Date() })
    .where(eq(ledgerBudgets.id, budgetId));

  return { ok: true, action: "created", lineId, cause, label, categoryTotalCents };
}

export type UpdateBudgetCauseLineParams = {
  id: string;
  /** At least one of label/amountCents is required. */
  label?: string;
  amountCents?: number;
};

export type UpdateBudgetCauseLineResult =
  | { ok: true; action: "updated"; lineId: string; cause: string; label: string; categoryTotalCents: number }
  | { ok: false; error: string; status: 400 | 404 | 409; reason?: "locked" | "duplicate_cause_label" };

/**
 * Update an existing cause line's amount and/or label — addressed by `id`
 * alone. A single `UPDATE ledger_budget_lines SET ... WHERE id = $1`, no
 * delete-then-recreate — this retires B-17 Increment A's disclosed
 * "cause-rename via DELETE+PATCH" failure window (`budget-cause-editor.tsx`'s
 * old `handleCauseChange`), since both editable fields (amount, label) now
 * go through one in-place write (DECISION-047 item 3).
 *
 * Cause is NOT updatable here (DECISION-048 item 2) — a line's cause is fixed
 * at creation; moving it to a different cause is DELETE + CREATE, two calls
 * that already exist.
 *
 * If `label` is provided and differs (after normalization) from the row's
 * current label, a sibling-collision check runs against
 * (budgetId, cause, normalizedLabel) EXCLUDING this row's own `id` — without
 * the `id <> $self` exclusion, a label edit would either always report "no
 * collision" (matching only itself) or spuriously 409 against itself.
 */
export async function updateBudgetCauseLine(
  params: UpdateBudgetCauseLineParams,
  tx: DrizzleTransaction,
): Promise<UpdateBudgetCauseLineResult> {
  const { id, amountCents } = params;

  if (params.label === undefined && amountCents === undefined) {
    return { ok: false, error: "At least one of label or amountCents is required", status: 400 };
  }
  if (
    amountCents !== undefined &&
    (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 0)
  ) {
    return { ok: false, error: "amountCents must be a non-negative integer", status: 400 };
  }

  const lineRows = await tx
    .select({
      id: ledgerBudgetLines.id,
      budgetId: ledgerBudgetLines.budgetId,
      cause: ledgerBudgetLines.cause,
      label: ledgerBudgetLines.label,
      amountCents: ledgerBudgetLines.amountCents,
    })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.id, id))
    .limit(1);
  const existingLine = lineRows[0] ?? null;
  if (!existingLine) {
    return { ok: false, error: "No cause line found for this id", status: 404 };
  }

  const budgetRows = await tx
    .select({ id: ledgerBudgets.id, fundId: ledgerBudgets.fundId, fiscalYear: ledgerBudgets.fiscalYear })
    .from(ledgerBudgets)
    .where(eq(ledgerBudgets.id, existingLine.budgetId))
    .limit(1);
  const budget = budgetRows[0] ?? null;
  if (!budget) {
    // Unreachable in practice — the FK guarantees the parent row exists.
    return { ok: false, error: "Budget row not found for this line", status: 404 };
  }

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, budget.fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, budget.fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  let nextLabel = existingLine.label;
  if (params.label !== undefined) {
    nextLabel = normalizeBudgetLineLabel(params.label);
    if (nextLabel.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
      return {
        ok: false,
        error: `label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer`,
        status: 400,
      };
    }
    if (nextLabel !== existingLine.label) {
      const collision = await tx
        .select({ id: ledgerBudgetLines.id })
        .from(ledgerBudgetLines)
        .where(
          and(
            eq(ledgerBudgetLines.budgetId, existingLine.budgetId),
            eq(ledgerBudgetLines.cause, existingLine.cause),
            eq(ledgerBudgetLines.label, nextLabel),
            ne(ledgerBudgetLines.id, id),
          ),
        )
        .limit(1);
      if (collision.length > 0) {
        return duplicateCauseLabelResult(existingLine.cause);
      }
    }
  }

  const nextAmountCents = amountCents !== undefined ? amountCents : existingLine.amountCents;

  try {
    await tx
      .update(ledgerBudgetLines)
      .set({ amountCents: nextAmountCents, label: nextLabel, updatedAt: new Date() })
      .where(eq(ledgerBudgetLines.id, id));
  } catch (err) {
    // Race defense-in-depth, mirroring createBudgetCauseLine's catch — see
    // that function's comment for why this maps to the same 409.
    if (pgErrorCode(err) === "23505") {
      return duplicateCauseLabelResult(existingLine.cause);
    }
    throw err;
  }

  const childRows = await tx
    .select({ amountCents: ledgerBudgetLines.amountCents })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.budgetId, existingLine.budgetId));
  const categoryTotalCents = sumBudgetCauseLines(childRows);

  await tx
    .update(ledgerBudgets)
    .set({ annualAmountCents: categoryTotalCents, updatedAt: new Date() })
    .where(eq(ledgerBudgets.id, existingLine.budgetId));

  return {
    ok: true,
    action: "updated",
    lineId: id,
    cause: existingLine.cause,
    label: nextLabel,
    categoryTotalCents,
  };
}

export type DeleteBudgetCauseLineResult =
  | { ok: true; action: "line_deleted"; categoryTotalCents: number }
  | { ok: true; action: "parent_deleted" }
  | { ok: false; error: string; status: 404 | 409; reason?: "locked" };

/**
 * Remove one cause-tagged budget line item, addressed by `id` alone.
 * Emptying a category's last cause line deletes the parent ledger_budgets
 * row too — mirrors upsertBudgetLine's existing `annualAmountCents: null` ->
 * delete-the-row behavior exactly, so "no target set" has exactly one
 * representation in the data regardless of which mode (lump-sum or
 * breakdown) emptied it into that state (DECISION-045).
 */
export async function deleteBudgetCauseLine(
  id: string,
  tx: DrizzleTransaction,
): Promise<DeleteBudgetCauseLineResult> {
  const lineRows = await tx
    .select({ id: ledgerBudgetLines.id, budgetId: ledgerBudgetLines.budgetId })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.id, id))
    .limit(1);
  const existingLine = lineRows[0] ?? null;
  if (!existingLine) {
    return { ok: false, error: "No cause line found for this id", status: 404 };
  }

  const budgetRows = await tx
    .select({ id: ledgerBudgets.id, fundId: ledgerBudgets.fundId, fiscalYear: ledgerBudgets.fiscalYear })
    .from(ledgerBudgets)
    .where(eq(ledgerBudgets.id, existingLine.budgetId))
    .limit(1);
  const budget = budgetRows[0] ?? null;
  if (!budget) {
    // Unreachable in practice — the FK guarantees the parent row exists.
    return { ok: false, error: "Budget row not found for this line", status: 404 };
  }

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, budget.fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, budget.fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  await tx.delete(ledgerBudgetLines).where(eq(ledgerBudgetLines.id, id));

  const remaining = await tx
    .select({ amountCents: ledgerBudgetLines.amountCents })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.budgetId, existingLine.budgetId));

  if (remaining.length === 0) {
    await tx.delete(ledgerBudgets).where(eq(ledgerBudgets.id, existingLine.budgetId));
    return { ok: true, action: "parent_deleted" };
  }

  const categoryTotalCents = sumBudgetCauseLines(remaining);
  await tx
    .update(ledgerBudgets)
    .set({ annualAmountCents: categoryTotalCents, updatedAt: new Date() })
    .where(eq(ledgerBudgets.id, existingLine.budgetId));

  return { ok: true, action: "line_deleted", categoryTotalCents };
}

// ---------------------------------------------------------------------------
// setBudgetCauseLinePendingDelete / setBudgetCauseGroupPendingDelete —
// Budgeting Page Restructure (DECISION-054/055/056)
// ---------------------------------------------------------------------------

export type SetBudgetCauseLinePendingDeleteParams = {
  id: string;
  pendingDelete: boolean;
};

export type SetBudgetCauseLinePendingDeleteResult =
  | { ok: true; action: "pending-delete" | "restored" }
  | { ok: false; error: string; status: 404 | 409; reason?: "locked" };

/**
 * Soft-delete/restore core for ONE cause-tagged budget line item, addressed
 * by its own `id` — the cause-line-grain counterpart to
 * setBudgetLinePendingDelete's category-grain flag-flip (Flow 4, "Remove a
 * line item," DECISION-055 item 1: line-item removal is a pendingDeleteAt
 * flag-flip, not a delayed hard DELETE, so it gets the same
 * recoverable-until-finalize property every other grain now has).
 *
 * A PURE single-row flag-flip: NEVER touches amountCents, and NEVER
 * recomputes the parent's annualAmountCents. This mirrors
 * setBudgetLinePendingDelete's own "restore brings the number back exactly
 * by construction, not by special-casing" property one grain down — and per
 * architect Ruling 1, a pending cause line's amount deliberately stays
 * counted in the (now stale) parent total until finalize purges it or
 * Restore clears the flag; computeFundLineSums's third parameter is what
 * keeps the LIVE UI figure correct in the meantime (src/lib/ledger.ts).
 *
 * No has_cause_breakdown-style guard: that guard exists to stop
 * CATEGORY-grain writes from clobbering line children wholesale; it has no
 * meaning for a function that operates on exactly one line by its own id,
 * and never cascades a write onto anything else.
 *
 * @param tx  Optional Drizzle transaction client. Defaults to the
 *            module-level `db` for the standalone PATCH route caller (same
 *            convention as setBudgetLinePendingDelete).
 */
export async function setBudgetCauseLinePendingDelete(
  params: SetBudgetCauseLinePendingDeleteParams,
  tx: DrizzleTransaction | typeof db = db,
): Promise<SetBudgetCauseLinePendingDeleteResult> {
  const { id, pendingDelete } = params;

  const lineRows = await tx
    .select({ id: ledgerBudgetLines.id, budgetId: ledgerBudgetLines.budgetId })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.id, id))
    .limit(1);
  const existingLine = lineRows[0] ?? null;
  if (!existingLine) {
    return { ok: false, error: "No cause line found for this id", status: 404 };
  }

  const budgetRows = await tx
    .select({ id: ledgerBudgets.id, fundId: ledgerBudgets.fundId, fiscalYear: ledgerBudgets.fiscalYear })
    .from(ledgerBudgets)
    .where(eq(ledgerBudgets.id, existingLine.budgetId))
    .limit(1);
  const budget = budgetRows[0] ?? null;
  if (!budget) {
    // Unreachable in practice — the FK guarantees the parent row exists.
    return { ok: false, error: "Budget row not found for this line", status: 404 };
  }

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, budget.fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  // Both directions (pendingDelete: true and false) run the lock check —
  // restore is lock-guarded too, same as every other pending-delete flip in
  // this file.
  const lock = await assertBudgetUnlocked(fund.entityId, budget.fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  // The pure flag-flip. amountCents and the parent's annualAmountCents are
  // never touched here.
  await tx
    .update(ledgerBudgetLines)
    .set({ pendingDeleteAt: pendingDelete ? new Date() : null, updatedAt: new Date() })
    .where(eq(ledgerBudgetLines.id, id));

  return { ok: true, action: pendingDelete ? "pending-delete" : "restored" };
}

export type SetBudgetCauseGroupPendingDeleteParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  cause: string;
  pendingDelete: boolean;
};

export type SetBudgetCauseGroupPendingDeleteResult =
  | { ok: true; action: "pending-delete" | "restored"; lineCount: number }
  | { ok: false; error: string; status: 404 | 409; reason?: "locked" };

/**
 * Soft-delete/restore an ENTIRE cause group — every ledger_budget_lines row
 * under one (budgetId, cause) pair — as a single atomic flag-flip (Flow 5,
 * "Remove *Environment* and its N line items," DECISION-055 item 2). One
 * `UPDATE ... WHERE budget_id = $1 AND cause = $2`, not N sequential
 * single-line PATCHes — satisfies the brief's own "must be one transaction,
 * not N sequential DELETEs that could partially fail" requirement trivially,
 * since it's a single statement touching every matching row.
 *
 * Same non-recompute rule as setBudgetCauseLinePendingDelete: pure flag-flip,
 * no annualAmountCents touch, no has_cause_breakdown-style guard. Restore
 * uses this SAME endpoint/function with `pendingDelete: false` — no time
 * limit, persistent Restore control, matching the uniform
 * reversible-until-finalize model (distinct from the per-line delayed-commit
 * toast, which is a client-only holding pattern in front of
 * setBudgetCauseLinePendingDelete, not this function).
 *
 * @param tx  Required — resolves the budget row, then runs the group UPDATE;
 *            the caller (PATCH /budgets/cause-lines/group) always wraps this
 *            in db.transaction() for consistency with its sibling write
 *            paths, even though a single UPDATE statement is already atomic
 *            on its own.
 */
export async function setBudgetCauseGroupPendingDelete(
  params: SetBudgetCauseGroupPendingDeleteParams,
  tx: DrizzleTransaction,
): Promise<SetBudgetCauseGroupPendingDeleteResult> {
  const { fundId, fiscalYear, categoryId, flow, cause, pendingDelete } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  const budgetRows = await tx
    .select({ id: ledgerBudgets.id })
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, fiscalYear),
        eq(ledgerBudgets.categoryId, categoryId),
        eq(ledgerBudgets.flow, flow),
      ),
    )
    .limit(1);
  const budget = budgetRows[0] ?? null;
  if (!budget) {
    return { ok: false, error: "No budget row found for this category", status: 404 };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  const flipped = await tx
    .update(ledgerBudgetLines)
    .set({ pendingDeleteAt: pendingDelete ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(ledgerBudgetLines.budgetId, budget.id), eq(ledgerBudgetLines.cause, cause)))
    .returning({ id: ledgerBudgetLines.id });

  if (flipped.length === 0) {
    return { ok: false, error: "No line items exist for this cause", status: 404 };
  }

  return { ok: true, action: pendingDelete ? "pending-delete" : "restored", lineCount: flipped.length };
}

export type UpsertBudgetCauseLineForSeedParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  cause: string;
  amountCents: number;
};

export type UpsertBudgetCauseLineForSeedResult =
  | { ok: true; action: "upserted"; lineId: string; categoryTotalCents: number }
  | { ok: false; error: string; status: 400 | 404 | 409; reason?: "locked" };

/**
 * SEED-ONLY upsert — the sole remaining caller of upsert (onConflictDoUpdate)
 * semantics for ledger_budget_lines, reserved for POST /budgets/seed
 * (DECISION-048 item 3). Re-running "seed from last year" must update the
 * existing generic line rather than 409 against it, so this keeps the exact
 * shape upsertBudgetCauseLine had in B-17 Increment A — always writing
 * `label: ''` (seeding stays cause-level-only per Human Answer Q7) — with its
 * conflict target widened from `[budgetId, cause]` to
 * `[budgetId, cause, label]` to match the new three-column unique constraint.
 */
export async function upsertBudgetCauseLineForSeed(
  params: UpsertBudgetCauseLineForSeedParams,
  tx: DrizzleTransaction,
): Promise<UpsertBudgetCauseLineForSeedResult> {
  const { fundId, fiscalYear, categoryId, flow, cause, amountCents } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId, kind: ledgerFunds.kind })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;

  const catRows = await tx
    .select({
      id: ledgerCategories.id,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
    })
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  const category = catRows[0] ?? null;

  const validation = validateBudgetLineInput({
    fund: fund ? { id: fund.id, kind: fund.kind } : null,
    category: category ? { id: category.id, fundKind: category.fundKind, flow: category.flow } : null,
    flow,
    fiscalYear,
    annualAmountCents: amountCents,
  });
  if (!validation.ok) {
    return validation;
  }
  if (!fund || !category) {
    // Unreachable: validateBudgetLineInput returns ok:false above when either is null.
    return { ok: false, error: "Fund or category not found", status: 404 };
  }

  if (!isValidBudgetCause(cause)) {
    return { ok: false, error: "cause must be one of the controlled taxonomy values", status: 400 };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return { ...lock, reason: "locked" };
  }

  const budgetConflictTarget = [
    ledgerBudgets.fundId,
    ledgerBudgets.fiscalYear,
    ledgerBudgets.categoryId,
    ledgerBudgets.flow,
  ];

  const [insertedBudget] = await tx
    .insert(ledgerBudgets)
    .values({
      entityId: fund.entityId,
      fundId,
      fiscalYear,
      categoryId,
      flow,
      annualAmountCents: amountCents,
    })
    .onConflictDoNothing({ target: budgetConflictTarget })
    .returning({ id: ledgerBudgets.id });

  let budgetId = insertedBudget?.id;
  if (!budgetId) {
    const existingBudget = await tx
      .select({ id: ledgerBudgets.id })
      .from(ledgerBudgets)
      .where(
        and(
          eq(ledgerBudgets.fundId, fundId),
          eq(ledgerBudgets.fiscalYear, fiscalYear),
          eq(ledgerBudgets.categoryId, categoryId),
          eq(ledgerBudgets.flow, flow),
        ),
      )
      .limit(1);
    budgetId = existingBudget[0]?.id;
  }
  if (!budgetId) {
    // Unreachable in practice (insert either returns a row or the row already
    // exists and the re-select finds it) — defensive.
    return { ok: false, error: "Failed to resolve budget row", status: 404 };
  }

  const [line] = await tx
    .insert(ledgerBudgetLines)
    .values({ budgetId, cause, label: "", amountCents })
    .onConflictDoUpdate({
      target: [ledgerBudgetLines.budgetId, ledgerBudgetLines.cause, ledgerBudgetLines.label],
      set: { amountCents, updatedAt: new Date() },
    })
    .returning({ id: ledgerBudgetLines.id });

  const childRows = await tx
    .select({ amountCents: ledgerBudgetLines.amountCents })
    .from(ledgerBudgetLines)
    .where(eq(ledgerBudgetLines.budgetId, budgetId));
  const categoryTotalCents = sumBudgetCauseLines(childRows);

  await tx
    .update(ledgerBudgets)
    .set({ annualAmountCents: categoryTotalCents, updatedAt: new Date() })
    .where(eq(ledgerBudgets.id, budgetId));

  return { ok: true, action: "upserted", lineId: line.id, categoryTotalCents };
}

/**
 * Distinct non-empty labels already used anywhere in this entity's cause
 * lines — feeds the budget editor's <datalist> autocomplete (DECISION-048
 * item 4: entity-scoped, not fund-scoped). A label used under a sibling fund
 * in the same entity is a reasonable suggestion even for the fund currently
 * being edited — it's an optional autocomplete hint, not a constraint, so an
 * irrelevant suggestion is harmless where a missed one would undermine the
 * whole point of offering consistency across entries (Phase 1 Gap 8).
 */
export async function getBudgetCauseLineLabels(
  entityId: string,
  tx: DrizzleTransaction | typeof db = db,
): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ label: ledgerBudgetLines.label })
    .from(ledgerBudgetLines)
    .innerJoin(ledgerBudgets, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))
    .innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))
    .where(and(eq(ledgerFunds.entityId, entityId), ne(ledgerBudgetLines.label, "")))
    .orderBy(asc(ledgerBudgetLines.label));
  return rows.map((r) => r.label);
}

export type CollapseBudgetCauseLinesParams = {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
};

export type CollapseBudgetCauseLinesResult =
  | { ok: true; action: "collapsed"; annualAmountCents: number }
  | { ok: false; error: string; status: 404 | 409 };

/**
 * Collapse a category's cause breakdown back to a single lump sum (Human
 * Answer 4: sums the line items). Deletes all child rows; the parent's
 * annualAmountCents is NOT recomputed here — per DECISION-046 item 2, it
 * already equals the sum of its children going into this call (the standing
 * invariant every prior write maintains), so deleting the children and
 * leaving the parent's number untouched *is* "collapse by summing".
 * Idempotent-safe on an already-lump-sum category (zero children deleted,
 * current amount returned unchanged).
 */
export async function collapseBudgetCauseLines(
  params: CollapseBudgetCauseLinesParams,
  tx: DrizzleTransaction,
): Promise<CollapseBudgetCauseLinesResult> {
  const { fundId, fiscalYear, categoryId, flow } = params;

  const fundRows = await tx
    .select({ id: ledgerFunds.id, entityId: ledgerFunds.entityId })
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0] ?? null;
  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }

  const budgetRows = await tx
    .select({ id: ledgerBudgets.id, annualAmountCents: ledgerBudgets.annualAmountCents })
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, fiscalYear),
        eq(ledgerBudgets.categoryId, categoryId),
        eq(ledgerBudgets.flow, flow),
      ),
    )
    .limit(1);
  const budget = budgetRows[0] ?? null;
  if (!budget) {
    return { ok: false, error: "No budget row found for this category", status: 404 };
  }

  const lock = await assertBudgetUnlocked(fund.entityId, fiscalYear, tx);
  if (!lock.ok) {
    return lock;
  }

  await tx.delete(ledgerBudgetLines).where(eq(ledgerBudgetLines.budgetId, budget.id));

  return { ok: true, action: "collapsed", annualAmountCents: budget.annualAmountCents };
}

// ---------------------------------------------------------------------------
// computeCauseSeedForCategory — Cause-Tagged Budget Line Items (seed extension)
// ---------------------------------------------------------------------------

/**
 * Computes cause-line seed candidates for one category, from posted,
 * cause-tagged expense actuals in the two-FY lookback window
 * (targetFiscalYear - 1, targetFiscalYear - 2), grouped by cause per FY, then
 * delegated to the pure deriveCauseSeedLines() for the most-recent-FY
 * tie-break / union / collision logic.
 *
 * Only actuals whose beneficiaryCause matches the controlled taxonomy
 * (isValidBudgetCause) count — free-text noise and "Fundraising event costs"
 * (excluded from the budget picker) never produce a proposed cause line.
 * Null/blank beneficiaryCause rows are excluded entirely (isNotNull filter):
 * "Other community support" is never proposed from history, only ever
 * entered manually via createBudgetCauseLine — it's a read-side fallback
 * label for ungrouped giving, not a cause a treasurer's books actively tag.
 *
 * A category with zero cause-tagged actuals anywhere in the lookback window
 * (e.g. production's unseeded Quicken import, Human Answer 3) returns `[]`,
 * never throws — the seed-review UI's graceful empty state depends on this.
 *
 * existingCauseAmountMap ("is this cause already covered?") is built ONLY
 * from existing rows where `label === ''` (Labeled Cause Budget Lines,
 * required fix per the Phase 3 design's Edge Cases): seeding only ever
 * targets the generic/unlabeled slot for a cause, so a cause with a labeled
 * sibling (e.g. "WARM") but no blank-label line yet is NOT "already covered"
 * from the seed's point of view — counting labeled siblings here would
 * wrongly make fill-empty mode skip seeding that cause's generic line.
 *
 * @param tx  Must be the same transaction as the caller's parent write loop —
 *            reads the target FY's existing cause lines fresh, so a
 *            category that was just seeded a lump sum earlier in the same
 *            request is reflected correctly.
 */
export async function computeCauseSeedForCategory(
  fundId: string,
  categoryId: string,
  targetFiscalYear: number,
  tx: DrizzleTransaction | typeof db = db,
): Promise<CauseSeedProposedLine[]> {
  const lookbackFiscalYears = [targetFiscalYear - 1, targetFiscalYear - 2];
  const rows: CauseSeedSourceRow[] = [];

  for (const fy of lookbackFiscalYears) {
    const { start, end } = fyBounds(fy);
    const txnRows = await tx
      .select({
        beneficiaryCause: ledgerTransactions.beneficiaryCause,
        amountCents: ledgerTransactions.amountCents,
      })
      .from(ledgerTransactions)
      .where(
        and(
          eq(ledgerTransactions.fundId, fundId),
          eq(ledgerTransactions.categoryId, categoryId),
          eq(ledgerTransactions.flow, "expense"),
          eq(ledgerTransactions.status, "posted"),
          gte(ledgerTransactions.txnDate, start),
          lt(ledgerTransactions.txnDate, end),
          isNotNull(ledgerTransactions.beneficiaryCause),
        ),
      );

    const byCause = new Map<string, number>();
    for (const row of txnRows) {
      const cause = (row.beneficiaryCause ?? "").trim();
      if (!cause || !isValidBudgetCause(cause)) continue;
      byCause.set(cause, (byCause.get(cause) ?? 0) + row.amountCents);
    }
    for (const [cause, amountCents] of byCause) {
      rows.push({ cause, amountCents, fiscalYear: fy });
    }
  }

  const existingBudgetRows = await tx
    .select({ id: ledgerBudgets.id })
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, fundId),
        eq(ledgerBudgets.fiscalYear, targetFiscalYear),
        eq(ledgerBudgets.categoryId, categoryId),
        eq(ledgerBudgets.flow, "expense"),
      ),
    )
    .limit(1);

  const existingCauseAmountMap = new Map<string, number>();
  if (existingBudgetRows[0]) {
    const existingLines = await tx
      .select({ cause: ledgerBudgetLines.cause, amountCents: ledgerBudgetLines.amountCents })
      .from(ledgerBudgetLines)
      .where(
        and(
          eq(ledgerBudgetLines.budgetId, existingBudgetRows[0].id),
          eq(ledgerBudgetLines.label, ""),
        ),
      );
    for (const line of existingLines) {
      existingCauseAmountMap.set(line.cause, line.amountCents);
    }
  }

  return deriveCauseSeedLines(rows, existingCauseAmountMap);
}

// ---------------------------------------------------------------------------
// computeSeedFromPriorYear — Guided Budgeting
// ---------------------------------------------------------------------------

export type FundSeedPreview = {
  fund: LedgerFund;
  /** "none"-source categories are excluded entirely — see deriveSeedLinesForFund. */
  seedableLines: SeedProposedLine[];
  seedableCount: number;
  collisionCount: number;
};

export type EntitySeedPreview = {
  entityId: string;
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: FundSeedPreview[];
};

/**
 * Computes the guided-budgeting seed preview for every active fund of an
 * entity (or a scoped subset via `fundIds`), by composing on getFundReport()
 * — no new transaction re-aggregation (architect Ruling 2).
 *
 * Prior FY is always `targetFiscalYear - 1` — no separate source-FY picker in
 * v1 (locked decision, Phase 3 design doc).
 *
 * Per fund:
 *   1. report = getFundReport(fund.id, priorFiscalYear)
 *   2. fundHadPriorActuals = report.totalIncomeCents + report.totalExpenseCents > 0
 *      — this is the fund-level fallback trigger (locked decision 1): fund-wide,
 *      not per-category.
 *   3. existingTargetBudgetMap — a plain ledgerBudgets select for
 *      (fundId, targetFiscalYear), reduced to a Map<`${categoryId}_${flow}`, amountCents>.
 *   4. priorLines = report.income + report.expense, flow-tagged, mapped to the
 *      pure function's plain input shape.
 *   5. seedableLines = deriveSeedLinesForFund(priorLines, fundHadPriorActuals, existingTargetBudgetMap).
 *
 * @param entityId            Entity to compute the preview for.
 * @param targetFiscalYear    The FY being budgeted (prior FY is this minus 1).
 * @param fundIds             Optional scope — a subset of the entity's active fund IDs.
 *                            Omitted/empty means all active funds of entityId.
 */
export async function computeSeedFromPriorYear(
  entityId: string,
  targetFiscalYear: number,
  fundIds?: string[],
): Promise<EntitySeedPreview> {
  const priorFiscalYear = targetFiscalYear - 1;

  const allFunds = await getFunds(entityId);
  const scopedFunds =
    fundIds && fundIds.length > 0
      ? allFunds.filter((f) => fundIds.includes(f.id))
      : allFunds;

  const funds: FundSeedPreview[] = [];

  for (const fund of scopedFunds) {
    const report = await getFundReport(fund.id, priorFiscalYear);
    const fundHadPriorActuals = report
      ? report.totalIncomeCents + report.totalExpenseCents > 0
      : false;

    const existingRows = await db
      .select({
        categoryId: ledgerBudgets.categoryId,
        flow: ledgerBudgets.flow,
        annualAmountCents: ledgerBudgets.annualAmountCents,
      })
      .from(ledgerBudgets)
      .where(
        and(eq(ledgerBudgets.fundId, fund.id), eq(ledgerBudgets.fiscalYear, targetFiscalYear)),
      );
    const existingTargetBudgetMap = new Map<string, number>();
    for (const row of existingRows) {
      if (row.categoryId) {
        existingTargetBudgetMap.set(`${row.categoryId}_${row.flow}`, row.annualAmountCents);
      }
    }

    const priorLines: SeedSourceLine[] = report
      ? [
          ...report.income.map((line) => ({
            categoryId: line.categoryId,
            categoryName: line.categoryName,
            flow: "income" as const,
            actualCents: line.actualCents,
            budgetCents: line.budgetCents,
          })),
          ...report.expense.map((line) => ({
            categoryId: line.categoryId,
            categoryName: line.categoryName,
            flow: "expense" as const,
            actualCents: line.actualCents,
            budgetCents: line.budgetCents,
          })),
        ]
      : [];

    const seedableLines = deriveSeedLinesForFund(
      priorLines,
      fundHadPriorActuals,
      existingTargetBudgetMap,
    );

    funds.push({
      fund,
      seedableLines,
      seedableCount: seedableLines.length,
      collisionCount: seedableLines.filter((l) => l.collision).length,
    });
  }

  return {
    entityId,
    priorFiscalYear,
    targetFiscalYear,
    funds,
  };
}

// ---------------------------------------------------------------------------
// getOverview
// ---------------------------------------------------------------------------

/**
 * Builds the entity overview for a given fiscal year.
 *
 * Two DB queries:
 *   1. All funds for the entity (with opening balances).
 *   2. All transactions for all those funds within the FY.
 *
 * Then all aggregation is done in TypeScript — no N+1.
 *
 * Includes guardrail flags computed from the aggregated state.
 */
export async function getOverview(
  entityId: string,
  fiscalYear: number,
  inc3Inputs?: {
    irsFilingHistory: Array<{ fiscalYear: number; status: string }>;
    overdueFilingCount: number;
  },
): Promise<EntityOverview | null> {
  const entityRows = await db
    .select()
    .from(ledgerEntities)
    .where(eq(ledgerEntities.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return null;

  const funds = await getFunds(entityId);
  if (funds.length === 0) {
    return {
      entity,
      funds: [],
      grossReceiptsCents: 0,
      determine990Result: determine990({
        taxClassification: entity.taxClassification,
        charityStatus: entity.charityStatus,
        grossReceiptsCents: 0,
        assetsCents: 0,
      }),
      guardrailFlags: [],
      syncStaleTxns: 0,
      unreconciledPriorMonth: 0,
    };
  }

  const { start, end } = fyBounds(fiscalYear);
  const fundIds = funds.map((f) => f.id);

  // Fetch all transactions for these funds within the FY in one query
  const allTxns = await db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        inArray(ledgerTransactions.fundId, fundIds),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, end),
      ),
    );

  // Group by fundId — keep all statuses for display; split in TypeScript for balances
  const txnsByFund = new Map<string, typeof allTxns>();
  for (const fund of funds) txnsByFund.set(fund.id, []);
  for (const txn of allTxns) {
    const arr = txnsByFund.get(txn.fundId);
    if (arr) arr.push(txn);
  }

  // Build a fund lookup map (id → kind) for firewall computation
  const fundKindById = new Map<string, string>(funds.map((f) => [f.id, f.kind]));

  // Pre-FY rollforward query (DECISION-029, display-side counterpart to
  // DECISION-028): posted-only, unbounded below (txn_date < FY start), grouped
  // by fund + flow — mirrors Query A2's shape/style. fund.openingBalanceCents
  // is a static seed anchored at the fund's inception; for any FY after the
  // first, prior years' net activity must be added back before the seed can
  // be treated as "opening balance for this FY". Without this, both
  // openingCents and endingCents silently drop every prior FY's net activity.
  const preFyTotalsRows = await db
    .select({
      fundId: ledgerTransactions.fundId,
      flow: ledgerTransactions.flow,
      totalCents: sql<string>`COALESCE(SUM(${ledgerTransactions.amountCents}), 0)`,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        inArray(ledgerTransactions.fundId, fundIds),
        eq(ledgerTransactions.status, "posted"),
        lt(ledgerTransactions.txnDate, start),
      ),
    )
    .groupBy(ledgerTransactions.fundId, ledgerTransactions.flow);

  const preFyRowsByFundId = new Map<string, Array<{ flow: string; amountCents: number; status: string }>>();
  for (const fund of funds) preFyRowsByFundId.set(fund.id, []);
  for (const row of preFyTotalsRows) {
    const arr = preFyRowsByFundId.get(row.fundId);
    if (arr) arr.push({ flow: row.flow, amountCents: Number(row.totalCents), status: "posted" });
  }

  // Build fund summaries — balances computed from POSTED transactions only (inc2)
  const fundSummaries: FundSummary[] = funds.map((fund) => {
    const txns = txnsByFund.get(fund.id) ?? [];
    const postedTxns = txns.filter((t) => t.status === "posted");
    const pendingTxns = txns.filter((t) => t.status === "pending" && t.flow === "expense");

    const incomeCents = postedTxns
      .filter((t) => t.flow === "income")
      .reduce((s, t) => s + t.amountCents, 0);
    const expenseCents = postedTxns
      .filter((t) => t.flow === "expense")
      .reduce((s, t) => s + t.amountCents, 0);
    const pendingExpenseCents = pendingTxns.reduce((s, t) => s + t.amountCents, 0);
    const rolledForwardOpening = rolledForwardOpeningCents(
      fund.openingBalanceCents,
      preFyRowsByFundId.get(fund.id) ?? [],
    );
    const endingCents = rolledForwardOpening + incomeCents - expenseCents;

    return {
      fund,
      openingCents: rolledForwardOpening,
      incomeCents,
      expenseCents,
      endingCents,
      pendingExpenseCents,
    };
  });

  // Entity-level aggregates — gross receipts from posted income only
  //
  // DECISION-029 note: entityBalance is now the TRUE rolled-forward balance
  // (fundSummaries[].endingCents each roll forward past their fund's seed —
  // see the pre-FY rollforward block above), not a FY-scoped delta-only
  // figure. This is a behavior change for two guardrail(s) in guardrails()
  // below that consume it: Check 4 (reserves below threshold, entityBalance)
  // and Check 6 (negative fund balance, per-fund endingCents). Both checks'
  // *intent* was always "is the club's real money low/negative right now" —
  // the FY-scoped figure was silently wrong for any FY after the first, so
  // this fixes those guardrails too, it does not change their meaning.
  const entityBalance = fundSummaries.reduce((s, f) => s + f.endingCents, 0);
  const postedIncomeTxns = allTxns.filter((t) => t.status === "posted" && t.flow === "income");
  const grossReceipts = grossReceiptsCents(postedIncomeTxns);

  // --------------------------------------------------------------------------
  // Guardrail inputs — inc1 fields
  // --------------------------------------------------------------------------
  const settings = await getSettings();

  // Use all transactions (any status) for these checks so the treasurer sees
  // issues even on pending/rejected rows
  const incomeWithoutParty = allTxns.filter(
    (t) => t.flow === "income" && (!t.party || t.party.trim() === ""),
  ).length;
  const cashDisbursements = allTxns.filter(
    (t) => t.flow === "expense" && t.paymentMethod === "cash",
  ).length;
  // Waived rows (receiptWaivedAt set) are excluded from this count — DECISION-035.
  const txnsWithoutReceipt = allTxns.filter(isReceiptMissing).length;

  // --------------------------------------------------------------------------
  // Guardrail inputs — inc2 fields
  // --------------------------------------------------------------------------

  // Pending disbursements: pending expense rows (waiting for approval)
  const pendingDisbursements = allTxns.filter(
    (t) => t.status === "pending" && t.flow === "expense",
  ).length;

  // Unreconciled prior-month: posted, not reconciled, dated before the 1st of current month
  const now = new Date();
  const firstOfCurrentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const unreconciledPriorMonth = allTxns.filter(
    (t) => t.status === "posted" && !t.reconciled && t.txnDate < firstOfCurrentMonth,
  ).length;

  // Two-fund firewall: count distinct transferGroupId values where one row's fund
  // is kind='activity' and the paired row's fund is kind='administrative'.
  // Only considers rows with a non-null transferGroupId.
  const transferGroups = new Map<string, Set<string>>();
  for (const txn of allTxns) {
    if (txn.transferGroupId) {
      const kinds = transferGroups.get(txn.transferGroupId) ?? new Set<string>();
      const kind = fundKindById.get(txn.fundId);
      if (kind) kinds.add(kind);
      transferGroups.set(txn.transferGroupId, kinds);
    }
  }
  let firewallViolations = 0;
  for (const kinds of transferGroups.values()) {
    if (kinds.has("activity") && kinds.has("administrative")) {
      firewallViolations++;
    }
  }

  // inc6a: count posted transactions with syncStale=true (dues sync mismatch).
  // Computed from the already-fetched allTxns array — zero extra DB queries.
  const syncStaleTxns = allTxns.filter((t) => t.syncStale).length;

  // --------------------------------------------------------------------------
  // inc7 guardrail inputs — Lions Fund-Compliance Guardrails
  // (DECISION-027 for the original query approach; DECISION-028 corrects the
  // balance-positive gate below to use a true cross-FY balance instead of the
  // FY-scoped fundSummaries[].endingCents — see Query A2 and countAgedPublicFunds().)
  // --------------------------------------------------------------------------

  // Query A: Cross-FY oldest posted income date per public fund (no FY bound).
  // Paired with Query A2 below (cross-FY balance) and passed into
  // countAgedPublicFunds() to determine which funds are "aged".
  const publicFundIds = funds
    .filter((f) => ["activity", "charitable", "scholarship"].includes(f.kind))
    .map((f) => f.id);

  const oldestIncomeRows = publicFundIds.length > 0
    ? await db
        .select({
          fundId: ledgerTransactions.fundId,
          oldestDate: sql<string>`MIN(${ledgerTransactions.txnDate})`,
        })
        .from(ledgerTransactions)
        .where(
          and(
            inArray(ledgerTransactions.fundId, publicFundIds),
            eq(ledgerTransactions.flow, "income"),
            eq(ledgerTransactions.status, "posted"),
          ),
        )
        .groupBy(ledgerTransactions.fundId)
    : [];

  const oldestDateByFundId = new Map<string, string>(
    oldestIncomeRows.map((r) => [r.fundId, r.oldestDate]),
  );

  // inc7 (revised 2026-07-20, Bug 2 fix) — Query A2: cross-FY posted income/expense
  // totals per public fund, no FY bound. Companion to Query A. Together they let us
  // compute each public fund's TRUE life-to-date balance — NOT fs.endingCents, which
  // is scoped to the currently-selected FY and was the root cause of QA's Bug 2
  // (2026-07-20): a fund whose only transactions fall outside the selected FY window
  // read as endingCents = 0 and was silently excluded from the aged-funds count even
  // though it held a real, positive, aged balance. See DECISION-028.
  const crossFyTotalsRows = publicFundIds.length > 0
    ? await db
        .select({
          fundId: ledgerTransactions.fundId,
          flow: ledgerTransactions.flow,
          totalCents: sql<string>`COALESCE(SUM(${ledgerTransactions.amountCents}), 0)`,
        })
        .from(ledgerTransactions)
        .where(
          and(
            inArray(ledgerTransactions.fundId, publicFundIds),
            eq(ledgerTransactions.status, "posted"),
            inArray(ledgerTransactions.flow, ["income", "expense"]),
          ),
        )
        .groupBy(ledgerTransactions.fundId, ledgerTransactions.flow)
    : [];

  const incomeTotalByFundId = new Map<string, number>();
  const expenseTotalByFundId = new Map<string, number>();
  for (const row of crossFyTotalsRows) {
    const cents = Number(row.totalCents);
    if (row.flow === "income") incomeTotalByFundId.set(row.fundId, cents);
    else if (row.flow === "expense") expenseTotalByFundId.set(row.fundId, cents);
  }

  // inc7 (revised) — build cross-FY facts per public fund, using fundBalanceCents()
  // (the same canonical balance function used elsewhere in the ledger) so this
  // figure can never disagree with how a "balance" is defined anywhere else.
  const agedPublicFundFacts: Array<AgedPublicFundFact> = funds
    .filter((f) => publicFundIds.includes(f.id))
    .map((f) => ({
      fundKind: f.kind,
      fundName: f.name, // Ledger Dashboard usability fix (DECISION-032)
      crossFyBalanceCents: fundBalanceCents(f.openingBalanceCents, [
        { flow: "income", amountCents: incomeTotalByFundId.get(f.id) ?? 0 },
        { flow: "expense", amountCents: expenseTotalByFundId.get(f.id) ?? 0 },
      ]),
      oldestPostedIncomeDate: oldestDateByFundId.get(f.id) ?? null,
    }));

  const agedPublicFundsRaw = countAgedPublicFunds(
    agedPublicFundFacts,
    settings.holdingPeriodWarnDays,
  );

  // Ledger Dashboard usability fix (DECISION-032): fund names for the aged
  // funds, sharing isAgedPublicFund()'s qualification rule with the count
  // above via agedPublicFundNames() — can never disagree.
  const agedPublicFundNamesRaw = agedPublicFundNames(
    agedPublicFundFacts,
    settings.holdingPeriodWarnDays,
  );

  // Query B: Batch-fetch categories for admin-fund income rows (DECISION-027).
  // Collect distinct categoryIds on posted income rows in admin funds (exclude null per G-4).
  const adminFundIds = funds
    .filter((f) => f.kind === "administrative")
    .map((f) => f.id);

  const adminIncomeCategoryIds = new Set<string>();
  for (const txn of allTxns) {
    if (
      txn.flow === "income" &&
      txn.status === "posted" &&
      adminFundIds.includes(txn.fundId) &&
      txn.categoryId !== null
    ) {
      adminIncomeCategoryIds.add(txn.categoryId);
    }
  }

  const categoryFundKindMap = new Map<string, string>();
  if (adminIncomeCategoryIds.size > 0) {
    const categoryRows = await db
      .select({ id: ledgerCategories.id, fundKind: ledgerCategories.fundKind })
      .from(ledgerCategories)
      .where(inArray(ledgerCategories.id, Array.from(adminIncomeCategoryIds)));
    for (const row of categoryRows) {
      categoryFundKindMap.set(row.id, row.fundKind);
    }
  }

  const adminPublicIncomeCountRaw = allTxns.filter((txn) => {
    if (txn.flow !== "income" || txn.status !== "posted") return false;
    if (!adminFundIds.includes(txn.fundId)) return false;
    if (txn.categoryId === null) return false; // G-4: exclude uncategorized rows
    const catFundKind = categoryFundKindMap.get(txn.categoryId);
    // If category not found (e.g., deleted), skip — don't false-positive
    if (catFundKind === undefined) return false;
    return catFundKind !== "administrative";
  }).length;

  // Defensive non-negative guards
  const agedPublicFunds = Math.max(0, agedPublicFundsRaw);
  const adminPublicIncomeCount = Math.max(0, adminPublicIncomeCountRaw);

  const guardrailFlags = guardrails({
    funds: fundSummaries.map((fs) => ({
      id: fs.fund.id,
      kind: fs.fund.kind,
      balanceCents: fs.endingCents,
    })),
    entityBalanceCents: entityBalance,
    settings: {
      reserveWarnThresholdCents: settings.reserveWarnThresholdCents,
      treasurerBonded: settings.treasurerBonded,
      retentionYears: settings.retentionYears,
      holdingPeriodWarnDays: settings.holdingPeriodWarnDays, // inc7: new
    },
    incomeWithoutParty,
    cashDisbursements,
    txnsWithoutReceipt,
    entitySlug: entity.slug,
    fiscalYear,
    pendingDisbursements,
    unreconciledPriorMonth,
    firewallViolations,
    // inc3 fields — passed through by getComplianceOverview(); default empty on
    // the plain overview path (so the revocation/overdue flags don't fire there).
    irsFilingHistory: inc3Inputs?.irsFilingHistory ?? [],
    overdueFilingCount: inc3Inputs?.overdueFilingCount ?? 0,
    // inc6a: dues sync stale count
    syncStaleTxns,
    // inc7: compliance guardrail inputs
    agedPublicFunds,
    agedPublicFundNames: agedPublicFundNamesRaw,
    adminPublicIncomeCount,
  });

  const determine990Result = determine990({
    taxClassification: entity.taxClassification,
    charityStatus: entity.charityStatus,
    grossReceiptsCents: grossReceipts,
    assetsCents: entityBalance,
  });

  return {
    entity,
    funds: fundSummaries,
    grossReceiptsCents: grossReceipts,
    determine990Result,
    guardrailFlags,
    syncStaleTxns,
    unreconciledPriorMonth,
  };
}

// ---------------------------------------------------------------------------
// getDashboard — Ledger Dashboard (Two-Entity Homepage, DECISION-031/032)
// ---------------------------------------------------------------------------

export type EntityTaggedGuardrailFlag = GuardrailFlag & {
  entitySlug: string;
  entityName: string; // entity.shortName ?? entity.name
};

export type DashboardEntitySummary = {
  entity: LedgerEntity;
  /** Sum of overview.funds[].endingCents — the entity's true rolled-forward
   *  balance as of today (DECISION-029 balances), NOT re-derived via a new query. */
  entityBalanceCents: number;
  grossReceiptsCents: number; // current-FY, from overview.grossReceiptsCents
  fundCount: number;
  /** overview.guardrailFlags.length — badge count on the entity card.
   *  Full flag detail lives in DashboardData.guardrailFlags below, not repeated per-card. */
  alertCount: number;
  syncStaleTxns: number;
  unreconciledPriorMonth: number;
};

export type UncashedCheckRow = {
  id: string;
  entitySlug: string;
  entityName: string;
  fundSlug: string;
  fundName: string;
  party: string | null;
  amountCents: number;
  txnDate: string; // 'YYYY-MM-DD'
  memo: string | null;
  checkNumber: string | null; // structured check # (T-18)
  ageDays: number; // computed via daysSinceTxnDate()
};

/**
 * DECISION-059 (docs/work-log/2026-07-30-deposit-in-transit-carveout.md):
 * the income-side mirror of UncashedCheckRow — every posted, unreconciled
 * `flow='income'` row, cross-entity, NO paymentMethod filter (unlike
 * UncashedCheckRow, which is check-method-only by definition). Ships as the
 * permanent visibility net for the same-decision gate relaxation in
 * `isMonthGatedForEntity()`/`getLatestOpenMonthForEntity()`
 * (financial-report-queries.ts) — full deposit-in-transit symmetry means
 * uncleared deposits no longer gate a member statement's month, so this
 * panel is now the only place a stale/never-clearing deposit stays visible,
 * same role `uncashedChecks` already plays for outstanding checks.
 */
export type UnremittedDepositRow = {
  id: string;
  entitySlug: string;
  entityName: string;
  fundSlug: string;
  fundName: string;
  party: string | null;
  paymentMethod: string | null;
  amountCents: number;
  txnDate: string; // 'YYYY-MM-DD'
  memo: string | null;
  ageDays: number; // computed via daysSinceTxnDate(), same helper uncashedChecks uses
};

export type DashboardData = {
  fiscalYear: number; // current FY, computed once and shared by every figure below
  entities: DashboardEntitySummary[];
  /** Merged, entity-tagged, both entities' guardrail flags — feeds the audit-items panel. */
  guardrailFlags: EntityTaggedGuardrailFlag[];
  uncashedChecks: UncashedCheckRow[]; // oldest-first, both entities
  unremittedDeposits: UnremittedDepositRow[]; // oldest-first, both entities
  syncStaleTxnsTotal: number; // cross-entity sum, for the audit-items panel
  unreconciledPriorMonthTotal: number; // cross-entity sum
};

/**
 * Composes the two-entity dashboard: parallel getOverview() calls at the
 * current fiscal year (one `now`/FY shared across both entities and both the
 * uncashed-checks and unremitted-deposits age computations — DECISION-031),
 * plus two independent cross-entity queries: unreconciled check-method
 * expense transactions (uncashedChecks) and unreconciled income transactions
 * of any payment method (unremittedDeposits, DECISION-059).
 *
 * Does NOT fetch pending approvals — the caller (page.tsx) already gates that
 * behind LEDGER_APPROVE and fetches it separately, exactly as the existing
 * detail page does. Keeping that out of getDashboard() avoids putting a
 * permission-shaped decision inside the query layer.
 *
 * inc3 compliance-filing guardrail inputs (irsFilingHistory, overdueFilingCount)
 * are NOT threaded in here — same parity as today's plain (non-compliance)
 * getOverview() call on the existing page. The revocation/overdue-filing flags
 * only ever appear on /admin/ledger/compliance, unchanged by this feature.
 */
export async function getDashboard(): Promise<DashboardData> {
  const entities = await getEntities();
  const fiscalYear = currentFiscalYear(new Date());

  const overviews = await Promise.all(entities.map((e) => getOverview(e.id, fiscalYear)));

  const entitySummaries: DashboardEntitySummary[] = [];
  const guardrailFlags: EntityTaggedGuardrailFlag[] = [];
  let syncStaleTxnsTotal = 0;
  let unreconciledPriorMonthTotal = 0;

  entities.forEach((entity, i) => {
    const overview = overviews[i];
    if (!overview) return; // defensive; getOverview() only returns null if the entity row vanished mid-request
    const entityBalanceCents = overview.funds.reduce((s, f) => s + f.endingCents, 0);
    entitySummaries.push({
      entity,
      entityBalanceCents,
      grossReceiptsCents: overview.grossReceiptsCents,
      fundCount: overview.funds.length,
      alertCount: overview.guardrailFlags.length,
      syncStaleTxns: overview.syncStaleTxns,
      unreconciledPriorMonth: overview.unreconciledPriorMonth,
    });
    for (const flag of overview.guardrailFlags) {
      guardrailFlags.push({
        ...flag,
        entitySlug: entity.slug,
        entityName: entity.shortName ?? entity.name,
      });
    }
    syncStaleTxnsTotal += overview.syncStaleTxns;
    unreconciledPriorMonthTotal += overview.unreconciledPriorMonth;
  });

  // Cross-entity uncashed checks: posted, unreconciled, check-method EXPENSE
  // rows (flow scoped to 'expense' — DECISION-032 point 4 — "uncashed checks"
  // is a check-writer's-eye-view concept, not "any check-tagged transaction").
  const uncashedRows = await db
    .select({
      id: ledgerTransactions.id,
      entityId: ledgerTransactions.entityId,
      party: ledgerTransactions.party,
      amountCents: ledgerTransactions.amountCents,
      txnDate: ledgerTransactions.txnDate,
      memo: ledgerTransactions.memo,
      checkNumber: ledgerTransactions.checkNumber,
      fundSlug: ledgerFunds.slug,
      fundName: ledgerFunds.name,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.paymentMethod, "check"),
        eq(ledgerTransactions.flow, "expense"),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate));

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const now = new Date();
  const uncashedChecks: UncashedCheckRow[] = uncashedRows.map((r) => {
    const entity = entityById.get(r.entityId);
    return {
      id: r.id,
      entitySlug: entity?.slug ?? "",
      entityName: entity?.shortName ?? entity?.name ?? "Unknown entity",
      fundSlug: r.fundSlug ?? "",
      fundName: r.fundName ?? "Unknown fund",
      party: r.party,
      amountCents: r.amountCents,
      txnDate: r.txnDate,
      memo: r.memo,
      checkNumber: r.checkNumber,
      ageDays: daysSinceTxnDate(r.txnDate, now),
    };
  });

  // Cross-entity unremitted deposits: posted, unreconciled INCOME rows, no
  // payment-method filter (DECISION-059) — the permanent visibility net for
  // the deposit-in-transit gate relaxation in financial-report-queries.ts.
  // Deliberately a second, independent query rather than folding into
  // uncashedRows above via an OR-predicate: zero blast radius on the
  // existing, already-tested uncashedChecks query, and this dashboard is
  // low-traffic enough that one extra round trip is immaterial.
  const unremittedRows = await db
    .select({
      id: ledgerTransactions.id,
      entityId: ledgerTransactions.entityId,
      party: ledgerTransactions.party,
      paymentMethod: ledgerTransactions.paymentMethod,
      amountCents: ledgerTransactions.amountCents,
      txnDate: ledgerTransactions.txnDate,
      memo: ledgerTransactions.memo,
      fundSlug: ledgerFunds.slug,
      fundName: ledgerFunds.name,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.flow, "income"),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate));

  const unremittedDeposits: UnremittedDepositRow[] = unremittedRows.map((r) => {
    const entity = entityById.get(r.entityId);
    return {
      id: r.id,
      entitySlug: entity?.slug ?? "",
      entityName: entity?.shortName ?? entity?.name ?? "Unknown entity",
      fundSlug: r.fundSlug ?? "",
      fundName: r.fundName ?? "Unknown fund",
      party: r.party,
      paymentMethod: r.paymentMethod,
      amountCents: r.amountCents,
      txnDate: r.txnDate,
      memo: r.memo,
      ageDays: daysSinceTxnDate(r.txnDate, now),
    };
  });

  return {
    fiscalYear,
    entities: entitySummaries,
    guardrailFlags,
    uncashedChecks,
    unremittedDeposits,
    syncStaleTxnsTotal,
    unreconciledPriorMonthTotal,
  };
}

// ---------------------------------------------------------------------------
// listKnownFiscalYears (for the FY selector)
// ---------------------------------------------------------------------------

/**
 * Returns a sorted-descending list of fiscal years for which there are
 * transactions for a given entity. Always includes the current FY.
 */
export async function listLedgerFiscalYears(entityId: string): Promise<number[]> {
  // Derive FY from txnDate using JS — fetch distinct txnDate months and compute
  // via SQL DATE_PART is simpler, but we want to stay with Drizzle's type system.
  // Use a raw sql tag for the DISTINCT on derived year.
  const rows = await db.execute<{ fy: number }>(sql`
    SELECT DISTINCT
      CASE
        WHEN EXTRACT(MONTH FROM txn_date::date) < 7
          THEN EXTRACT(YEAR FROM txn_date::date) - 1
        ELSE EXTRACT(YEAR FROM txn_date::date)
      END AS fy
    FROM ledger_transactions
    WHERE entity_id = ${entityId}
    ORDER BY 1 DESC
  `);

  const fromTxns = rows.map((r) => Number(r.fy));
  const currentFY = currentFiscalYear(new Date());

  const years = new Set<number>([currentFY, ...fromTxns]);
  return Array.from(years).sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// getPendingApprovals — inc2
// ---------------------------------------------------------------------------

export type PendingApprovalRow = LedgerTransaction & {
  /** Display name of the fund (e.g. "Administrative Fund"). Falls back to "Unknown Fund" if the fund was deleted. */
  fundName: string;
  /** Display name of the user who recorded the transaction (users.name). null if the user record was deleted or has no name set. */
  recorderName: string | null;
  /**
   * DECISION-058: for a Transfer/Sweep source (expense) leg, the paired
   * destination leg's fundId/fundName/entityId — lets the Approvals page
   * render a From -> To label instead of a single-fund column. null for
   * ordinary pending expenses/income (transferGroupId === null). The paired
   * destination (income) leg itself is EXCLUDED from the result set below —
   * only one row per pending Transfer/Sweep pair is returned.
   */
  partnerFundId: string | null;
  partnerFundName: string | null;
  partnerEntityId: string | null;
};

/**
 * Returns all pending-status transactions enriched with fund name and recorder
 * full name — ready for display on the Approvals screen without extra lookups.
 *
 * Ordered by txnDate ascending (oldest pending first — most urgently needs
 * board action).
 *
 * DECISION-058: once a Transfer/Sweep pair can be pending together, the flat
 * query below returns both legs as separate rows. Dedup keeps only the
 * source (flow='expense') leg per transferGroupId, carrying the paired
 * destination leg's fund identity for display — see PendingApprovalRow above.
 *
 * Gate: LEDGER_APPROVE (enforced in the route handler, not here).
 *
 * FU-5 fix: original implementation returned LedgerTransaction[] with raw UUIDs;
 * this join eliminates UUID fragments on the Approvals page.
 */
export async function getPendingApprovals(entityId?: string): Promise<PendingApprovalRow[]> {
  const conditions = [eq(ledgerTransactions.status, "pending")];
  if (entityId) {
    conditions.push(eq(ledgerTransactions.entityId, entityId));
  }

  const rows = await db
    .select({
      // All transaction columns
      id: ledgerTransactions.id,
      entityId: ledgerTransactions.entityId,
      fundId: ledgerTransactions.fundId,
      txnDate: ledgerTransactions.txnDate,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
      categoryId: ledgerTransactions.categoryId,
      party: ledgerTransactions.party,
      memo: ledgerTransactions.memo,
      paymentMethod: ledgerTransactions.paymentMethod,
      // Bank Reconciliation inc1 (T-18, DECISION-034)
      checkNumber: ledgerTransactions.checkNumber,
      bankAccountId: ledgerTransactions.bankAccountId,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      publicNote: ledgerTransactions.publicNote,
      receiptStorageKey: ledgerTransactions.receiptStorageKey,
      receiptWaivedAt: ledgerTransactions.receiptWaivedAt,
      receiptWaivedByUserId: ledgerTransactions.receiptWaivedByUserId,
      receiptWaiverReason: ledgerTransactions.receiptWaiverReason,
      transferGroupId: ledgerTransactions.transferGroupId,
      status: ledgerTransactions.status,
      approvedByUserId: ledgerTransactions.approvedByUserId,
      approvedAt: ledgerTransactions.approvedAt,
      boardMinute: ledgerTransactions.boardMinute,
      rejectionReason: ledgerTransactions.rejectionReason,
      reconciled: ledgerTransactions.reconciled,
      reconciledAt: ledgerTransactions.reconciledAt,
      // Bank Reconciliation inc2 (DECISION-036)
      reconciledSessionId: ledgerTransactions.reconciledSessionId,
      recordedByUserId: ledgerTransactions.recordedByUserId,
      // Inc 6a columns
      duesPaymentId: ledgerTransactions.duesPaymentId,
      syncStale: ledgerTransactions.syncStale,
      donorId: ledgerTransactions.donorId,
      createdAt: ledgerTransactions.createdAt,
      updatedAt: ledgerTransactions.updatedAt,
      // Joined display fields — users.name is the display name (single field, may be null)
      fundName: ledgerFunds.name,
      recorderDisplayName: users.name,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(users, eq(ledgerTransactions.recordedByUserId, users.id))
    .where(and(...conditions))
    .orderBy(asc(ledgerTransactions.txnDate), asc(ledgerTransactions.createdAt));

  const enriched = rows.map((r) => ({
    ...r,
    fundName: r.fundName ?? "Unknown Fund",
    recorderName: r.recorderDisplayName ?? null,
  }));

  // DECISION-058 dedup: index the destination (income) leg of every pending
  // pair by transferGroupId, then drop it from the result set once we've
  // confirmed its expense-leg partner is also present — the two rows
  // already carry their OWN fund/entity identity (each was joined against
  // ledgerFunds by its own fundId), so no extra query is needed to attach
  // the "To" side of the label onto the surviving source leg.
  const destLegByGroup = new Map<string, (typeof enriched)[number]>();
  for (const r of enriched) {
    if (r.transferGroupId && r.flow === "income") {
      destLegByGroup.set(r.transferGroupId, r);
    }
  }
  const sourceLegGroupIds = new Set(
    enriched
      .filter((r) => r.transferGroupId && r.flow === "expense")
      .map((r) => r.transferGroupId as string),
  );

  return enriched
    .filter((r) => !(r.transferGroupId && r.flow === "income" && sourceLegGroupIds.has(r.transferGroupId)))
    .map((r) => {
      if (r.transferGroupId && r.flow === "expense") {
        const partner = destLegByGroup.get(r.transferGroupId);
        return {
          ...r,
          partnerFundId: partner?.fundId ?? null,
          partnerFundName: partner?.fundName ?? null,
          partnerEntityId: partner?.entityId ?? null,
        };
      }
      return { ...r, partnerFundId: null, partnerFundName: null, partnerEntityId: null };
    });
}

// ---------------------------------------------------------------------------
// Reimbursement queries — inc2
// ---------------------------------------------------------------------------

export type ReimbursementWithMember = LedgerReimbursement & {
  memberFirstName: string;
  memberLastName: string;
  memberEmail: string;
};

/**
 * Returns all reimbursements for a specific member, ordered newest first.
 * Ownership enforcement: caller must verify session.user.memberId === memberId.
 */
export async function listReimbursementsForMember(
  memberId: string,
): Promise<LedgerReimbursement[]> {
  return db
    .select()
    .from(ledgerReimbursements)
    .where(eq(ledgerReimbursements.submittedByMemberId, memberId))
    .orderBy(desc(ledgerReimbursements.submittedAt));
}

/**
 * Returns reimbursements for admin view, joined with member name/email.
 * Optionally filtered by status.
 */
/**
 * Count of reimbursements per status in one GROUP BY query — for the admin inbox
 * tab badges (replaces four separate count round-trips).
 */
export async function getReimbursementStatusCounts(): Promise<Record<string, number>> {
  const rows = await db.execute<{ status: string; count: string }>(
    sql`SELECT status, COUNT(*)::text AS count FROM ledger_reimbursements GROUP BY status`,
  );
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = parseInt(r.count, 10);
  return counts;
}

export async function listReimbursementsForAdmin(opts: {
  status?: string;
  memberId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ reimbursements: ReimbursementWithMember[]; total: number }> {
  const { status, memberId, limit = 50, offset = 0 } = opts;

  const conditions = [];
  if (status) conditions.push(eq(ledgerReimbursements.status, status));
  if (memberId) conditions.push(eq(ledgerReimbursements.submittedByMemberId, memberId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count for pagination
  const countRows = await db.execute<{ count: string }>(
    whereClause
      ? sql`SELECT COUNT(*)::text AS count FROM ledger_reimbursements WHERE ${whereClause}`
      : sql`SELECT COUNT(*)::text AS count FROM ledger_reimbursements`,
  );
  const total = parseInt(countRows[0]?.count ?? "0", 10);

  // Fetch with member join
  const rows = await db
    .select({
      id: ledgerReimbursements.id,
      submittedByMemberId: ledgerReimbursements.submittedByMemberId,
      submittedByUserId: ledgerReimbursements.submittedByUserId,
      amountCents: ledgerReimbursements.amountCents,
      description: ledgerReimbursements.description,
      beneficiaryCause: ledgerReimbursements.beneficiaryCause,
      receiptStorageKey: ledgerReimbursements.receiptStorageKey,
      fundId: ledgerReimbursements.fundId,
      status: ledgerReimbursements.status,
      reviewedByUserId: ledgerReimbursements.reviewedByUserId,
      reviewedAt: ledgerReimbursements.reviewedAt,
      boardMinute: ledgerReimbursements.boardMinute,
      rejectionReason: ledgerReimbursements.rejectionReason,
      paidAt: ledgerReimbursements.paidAt,
      ledgerTransactionId: ledgerReimbursements.ledgerTransactionId,
      submittedAt: ledgerReimbursements.submittedAt,
      createdAt: ledgerReimbursements.createdAt,
      updatedAt: ledgerReimbursements.updatedAt,
      memberFirstName: members.firstName,
      memberLastName: members.lastName,
      memberEmail: members.email,
    })
    .from(ledgerReimbursements)
    .innerJoin(members, eq(ledgerReimbursements.submittedByMemberId, members.id))
    .where(whereClause)
    .orderBy(desc(ledgerReimbursements.submittedAt))
    .limit(limit)
    .offset(offset);

  return { reimbursements: rows as ReimbursementWithMember[], total };
}

/**
 * Returns a single reimbursement by id.
 * Does NOT enforce ownership — caller must verify.
 */
export async function getReimbursement(id: string): Promise<LedgerReimbursement | null> {
  const rows = await db
    .select()
    .from(ledgerReimbursements)
    .where(eq(ledgerReimbursements.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Returns a single reimbursement with member info by id.
 */
export async function getReimbursementWithMember(
  id: string,
): Promise<ReimbursementWithMember | null> {
  const rows = await db
    .select({
      id: ledgerReimbursements.id,
      submittedByMemberId: ledgerReimbursements.submittedByMemberId,
      submittedByUserId: ledgerReimbursements.submittedByUserId,
      amountCents: ledgerReimbursements.amountCents,
      description: ledgerReimbursements.description,
      beneficiaryCause: ledgerReimbursements.beneficiaryCause,
      receiptStorageKey: ledgerReimbursements.receiptStorageKey,
      fundId: ledgerReimbursements.fundId,
      status: ledgerReimbursements.status,
      reviewedByUserId: ledgerReimbursements.reviewedByUserId,
      reviewedAt: ledgerReimbursements.reviewedAt,
      boardMinute: ledgerReimbursements.boardMinute,
      rejectionReason: ledgerReimbursements.rejectionReason,
      paidAt: ledgerReimbursements.paidAt,
      ledgerTransactionId: ledgerReimbursements.ledgerTransactionId,
      submittedAt: ledgerReimbursements.submittedAt,
      createdAt: ledgerReimbursements.createdAt,
      updatedAt: ledgerReimbursements.updatedAt,
      memberFirstName: members.firstName,
      memberLastName: members.lastName,
      memberEmail: members.email,
    })
    .from(ledgerReimbursements)
    .innerJoin(members, eq(ledgerReimbursements.submittedByMemberId, members.id))
    .where(eq(ledgerReimbursements.id, id))
    .limit(1);
  return (rows[0] as ReimbursementWithMember) ?? null;
}

/**
 * Returns the user email for a given user id. Used for sending notifications
 * to the submitting member.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);
  return rows[0]?.email ?? null;
}

/**
 * Returns all active user emails that hold a specific feature (via any role).
 * Used to notify LEDGER_APPROVE holders when a reimbursement or pending
 * disbursement is submitted.
 */
export async function getEmailsForFeature(featureName: string): Promise<string[]> {
  const rows = await db.execute<{ email: string }>(sql`
    SELECT DISTINCT u.email
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    JOIN role_features rf ON rf.role_id = r.id
    JOIN features f ON f.id = rf.feature_id
    WHERE f.name = ${featureName}
      AND u.is_active = TRUE
  `);
  return rows.map((r) => r.email).filter(Boolean) as string[];
}

// ---------------------------------------------------------------------------
// Filing row type (inc3)
// ---------------------------------------------------------------------------

export type FilingRow = LedgerFiling & {
  /** Absolute due date computed via computeDueDate(fiscalYear, dueMonth, dueDay). */
  dueDate: Date;
  /** True when dueDate < today AND status NOT IN ('filed','na','future'). */
  overdue: boolean;
};

// ---------------------------------------------------------------------------
// ensureFilingsForFY (inc3)
// ---------------------------------------------------------------------------

/**
 * Idempotent: ensures `ledger_filings` rows exist for (entityId, fiscalYear).
 *
 * If rows already exist for the given entity + FY → no-op (safe under
 * concurrent requests; ON CONFLICT guard protects against race conditions).
 *
 * If no rows exist for this FY:
 *   - Copies rows from the prior FY (fiscalYear - 1) for the same entity.
 *   - Resets status to 'not_started'; does NOT copy confirmation, filed_on,
 *     or note (DECISION-022 / Phase 3 design: filed state must NOT roll over).
 *   - For recurrence='5_year' rows: sets next_due_year = prior.next_due_year + 5.
 *   - If there are no prior-FY rows, inserts nothing — the page renders empty
 *     bands (this handles a fresh install before seed has been applied).
 *
 * Called explicitly from the compliance page Server Component before listFilings.
 * Must NOT be called from inside listFilings (write-on-read violates the read
 * contract of all query helpers — DECISION-021).
 */
export async function ensureFilingsForFY(
  entityId: string,
  fiscalYear: number,
): Promise<void> {
  // Check whether any rows already exist for this entity + FY
  const existing = await db
    .select({ id: ledgerFilings.id })
    .from(ledgerFilings)
    .where(and(eq(ledgerFilings.entityId, entityId), eq(ledgerFilings.fiscalYear, fiscalYear)))
    .limit(1);

  if (existing.length > 0) {
    // Rows already exist — idempotent no-op
    return;
  }

  // No rows for this FY. Copy from prior FY.
  // Uses a parameterized INSERT … SELECT … ON CONFLICT DO NOTHING.
  // status is hardcoded to 'not_started'; confirmation/filed_on/note are NOT selected.
  // next_due_year: for 5_year rows, add 5; for annual rows, set NULL.
  const priorFY = fiscalYear - 1;
  await db.execute(sql`
    INSERT INTO ledger_filings
      (entity_id, fiscal_year, agency, title, due_month, due_day, recurrence, next_due_year, status)
    SELECT
      entity_id,
      ${fiscalYear},
      agency,
      title,
      due_month,
      due_day,
      recurrence,
      CASE WHEN recurrence = '5_year' THEN next_due_year + 5 ELSE NULL END,
      'not_started'
    FROM ledger_filings
    WHERE entity_id = ${entityId}
      AND fiscal_year = ${priorFY}
    ON CONFLICT (entity_id, fiscal_year, agency, title) DO NOTHING
  `);
}

// ---------------------------------------------------------------------------
// listFilings (inc3)
// ---------------------------------------------------------------------------

/**
 * Pure read. Returns all filings for (entityId, fiscalYear), enriched with
 * computed dueDate and derived overdue flag.
 *
 * For recurrence='5_year' rows: a row is included only when its nextDueYear
 * matches the calendar year in which due_month falls inside fiscalYear
 * (DECISION-022 predicate: dueMonth >= 7 → nextDueYear === fiscalYear;
 * dueMonth < 7 → nextDueYear === fiscalYear + 1).
 *
 * Results are ordered by dueDate ASC.
 *
 * Does NOT insert or modify rows. Call ensureFilingsForFY before this if you
 * want rollover behavior.
 */
export async function listFilings(entityId: string, fiscalYear: number): Promise<FilingRow[]> {
  const rows = await db
    .select()
    .from(ledgerFilings)
    .where(and(eq(ledgerFilings.entityId, entityId), eq(ledgerFilings.fiscalYear, fiscalYear)));

  const today = new Date();

  const enriched: FilingRow[] = [];
  for (const row of rows) {
    // Filter 5-year rows: include only when nextDueYear matches the calendar
    // year of due_month inside fiscalYear (DECISION-022).
    if (row.recurrence === "5_year") {
      const expectedCalendarYear = row.dueMonth >= 7 ? fiscalYear : fiscalYear + 1;
      if (row.nextDueYear !== expectedCalendarYear) {
        continue; // This row's 5-year cycle is not due in this FY
      }
    }

    const dueDate = computeDueDate(fiscalYear, row.dueMonth, row.dueDay);
    const overdue = isFilingOverdue(
      { fiscalYear, dueMonth: row.dueMonth, dueDay: row.dueDay, status: row.status },
      today,
    );

    enriched.push({ ...row, dueDate, overdue });
  }

  // Sort ascending by dueDate
  enriched.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return enriched;
}

// ---------------------------------------------------------------------------
// getComplianceOverview (inc3)
// ---------------------------------------------------------------------------

export type ComplianceOverview = {
  entity: LedgerEntity;
  fiscalYear: number;
  filings: FilingRow[];
  grossReceiptsCents: number;
  /** Entity cash balance; proxy for assets estimate — label as such in the UI. */
  entityBalanceCents: number;
  determine990Result: { form: string; why: string };
  /** All guardrail flags including inc3 compliance flags. */
  guardrailFlags: GuardrailFlag[];
  settings: LedgerSettings;
};

/**
 * Assembles everything the compliance page needs in a single call.
 *
 * Steps:
 *   1. getOverview(entityId, fiscalYear) — entity state, 990 result, inc1/inc2 guardrails.
 *   2. listFilings(entityId, fiscalYear) — filing calendar with computed dueDate/overdue.
 *   3. IRS filing history: ledger_filings WHERE agency='IRS' AND fiscal_year < fiscalYear
 *      ORDER BY fiscal_year ASC (for revocation check — 3 consecutive unfiled).
 *   4. Derive overdueFilingCount from the filings result.
 *   5. Append inc3 guardrail flags (revocation risk + overdue count) by calling
 *      guardrails() with the real inc3 inputs, then prepending/appending to the
 *      existing flags from getOverview.
 *
 * getOverview passes irsFilingHistory=[], overdueFilingCount=0. To avoid calling
 * guardrails() twice against the full state, we call guardrails() once here with
 * all inputs (inc1 + inc2 + inc3) using the aggregated state from getOverview.
 */
export async function getComplianceOverview(
  entityId: string,
  fiscalYear: number,
): Promise<ComplianceOverview | null> {
  // Step 1: the filing calendar + the inc3 guardrail inputs, computed BEFORE the
  // overview so they can be threaded into the single canonical guardrails() call.
  const filings = await listFilings(entityId, fiscalYear);
  const overdueFilingCount = filings.filter((f) => f.overdue).length;

  // IRS filing history for the revocation check (all past FYs, ascending; guardrails() slices the last 3).
  const irsHistoryRows = await db
    .select({
      fiscalYear: ledgerFilings.fiscalYear,
      status: ledgerFilings.status,
    })
    .from(ledgerFilings)
    .where(
      and(
        eq(ledgerFilings.entityId, entityId),
        eq(ledgerFilings.agency, "IRS"),
        sql`${ledgerFilings.fiscalYear} < ${fiscalYear}`,
      ),
    )
    .orderBy(asc(ledgerFilings.fiscalYear));

  // Step 2: the entity overview, with the inc3 inputs passed through so the
  // revocation/overdue flags come from the canonical guardrails() in ledger.ts —
  // no duplicated flag logic here (MEDIUM-2 fix).
  const overview = await getOverview(entityId, fiscalYear, {
    irsFilingHistory: irsHistoryRows,
    overdueFilingCount,
  });
  if (!overview) return null;

  const settings = await getSettings();
  const entityBalance = overview.funds.reduce((s, f) => s + f.endingCents, 0);

  return {
    entity: overview.entity,
    fiscalYear,
    filings,
    grossReceiptsCents: overview.grossReceiptsCents,
    entityBalanceCents: entityBalance,
    determine990Result: overview.determine990Result,
    guardrailFlags: overview.guardrailFlags,
    settings,
  };
}

// ---------------------------------------------------------------------------
// Inc4: Reports & 990-Prep — return types
// ---------------------------------------------------------------------------

export type EntityReport = {
  entity: LedgerEntity;
  /** One FundReport per active fund, ordered by fund name. */
  funds: FundReport[];
  /** Sum of posted income across all funds, excluding transfer rows. */
  grossReceiptsCents: number;
  /** grossReceiptsCents minus total posted expenses across all funds (excl. transfers). */
  netCents: number;
  determine990Result: { form: string; why: string };
  guardrailFlags: GuardrailFlag[];
};

export type Prep990Line = {
  /** form_990_line label, "Uncategorized", or "Unmapped / <category name>". */
  lineGroup: string;
  flow: "income" | "expense";
  totalCents: number;
};

export type Prep990Result = {
  lines: Prep990Line[];
  /** Sum of income-flow lines (posted, non-transfer). */
  grossReceiptsCents: number;
  /** Sum of expense-flow lines (posted, non-transfer). */
  totalExpenseCents: number;
  netCents: number;
  determine990Result: { form: string; why: string };
  /**
   * True when any line's lineGroup starts with "Unmapped /" or equals
   * "Uncategorized" — signals the export route to emit the extra note comment.
   */
  hasUnmapped: boolean;
};

export type ExportTxnRow = {
  txnDate: string;          // YYYY-MM-DD
  fundName: string;
  flow: "income" | "expense";
  /** "Transfer" | "Uncategorized" | category.name */
  categoryDisplay: string;
  party: string | null;
  amountCents: number;
  status: string;
  reconciled: boolean;
  paymentMethod: string | null;
  memo: string | null;
};

// ---------------------------------------------------------------------------
// getEntityReport (inc4)
// ---------------------------------------------------------------------------

/**
 * Builds the entity-level financial statement for all active funds × fiscal year.
 *
 * Strategy (N+1-free at current fund counts of 2–4 per entity):
 *   1. Fetch the entity row — return null if missing.
 *   2. Fetch all active funds for the entity (one query via getFunds).
 *   3. Fetch ALL transactions for the entity × FY in ONE query (bounded by fyBounds).
 *   4. In TypeScript, distribute transactions to their fund and aggregate
 *      per-fund posted income/expense by category (same pass as getOverview).
 *   5. For each fund, fetch its active categories in one query (keyed by fundKind).
 *      At most 2 distinct fund kinds per entity → at most 2 extra queries.
 *   6. Build FundReport-shaped objects using the merged categories + actuals.
 *
 * NOTE: getEntityReport shares aggregation logic with getOverview but returns
 * per-fund category detail rather than per-fund totals. Do NOT refactor
 * getOverview to delegate here in inc4 — document the overlap and defer to inc5+.
 *
 * N+1 threshold note: if fund count ever exceeds ~10, replace the per-fundKind
 * category fetches with a single entity-scoped query and partition in TypeScript.
 */
export async function getEntityReport(
  entityId: string,
  fiscalYear: number,
): Promise<EntityReport | null> {
  // 1. Fetch entity
  const entityRows = await db
    .select()
    .from(ledgerEntities)
    .where(eq(ledgerEntities.id, entityId))
    .limit(1);
  const entity = entityRows[0];
  if (!entity) return null;

  // 2. Fetch all active funds
  const funds = await getFunds(entityId);
  if (funds.length === 0) {
    const determine990Result = determine990({
      taxClassification: entity.taxClassification,
      charityStatus: entity.charityStatus,
      grossReceiptsCents: 0,
      assetsCents: 0,
    });
    return {
      entity,
      funds: [],
      grossReceiptsCents: 0,
      netCents: 0,
      determine990Result,
      guardrailFlags: [],
    };
  }

  const { start, end } = fyBounds(fiscalYear);
  const fundIds = funds.map((f) => f.id);

  // 3. Single transactions query for all funds in this entity × FY
  const allTxns = await db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        inArray(ledgerTransactions.fundId, fundIds),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, end),
      ),
    );

  // 4. Group transactions by fundId
  const txnsByFund = new Map<string, typeof allTxns>();
  for (const fund of funds) txnsByFund.set(fund.id, []);
  for (const txn of allTxns) {
    txnsByFund.get(txn.fundId)?.push(txn);
  }

  // 4b. Pre-FY rollforward: posted-only totals per fund dated strictly before
  // the FY start (DECISION-029, mirrors getOverview's identical query). Rolls
  // each fund.openingBalanceCents seed forward past prior fiscal years.
  const preFyTotalsRows = await db
    .select({
      fundId: ledgerTransactions.fundId,
      flow: ledgerTransactions.flow,
      totalCents: sql<string>`COALESCE(SUM(${ledgerTransactions.amountCents}), 0)`,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        inArray(ledgerTransactions.fundId, fundIds),
        eq(ledgerTransactions.status, "posted"),
        lt(ledgerTransactions.txnDate, start),
      ),
    )
    .groupBy(ledgerTransactions.fundId, ledgerTransactions.flow);

  const preFyRowsByFundId = new Map<string, Array<{ flow: string; amountCents: number; status: string }>>();
  for (const fund of funds) preFyRowsByFundId.set(fund.id, []);
  for (const row of preFyTotalsRows) {
    const arr = preFyRowsByFundId.get(row.fundId);
    if (arr) arr.push({ flow: row.flow, amountCents: Number(row.totalCents), status: "posted" });
  }

  // 5. Fetch categories per distinct fundKind (at most 2 queries for club/foundation)
  const distinctKinds = [...new Set(funds.map((f) => f.kind))];
  const categoriesByKind = new Map<string, LedgerCategory[]>();
  for (const kind of distinctKinds) {
    const cats = await db
      .select()
      .from(ledgerCategories)
      .where(
        and(
          eq(ledgerCategories.entityId, entityId),
          eq(ledgerCategories.fundKind, kind),
          eq(ledgerCategories.isActive, true),
        ),
      )
      .orderBy(ledgerCategories.sortOrder, ledgerCategories.name);
    categoriesByKind.set(kind, cats);
  }

  // 6. Build per-fund FundReport objects
  const fundReports: FundReport[] = [];

  for (const fund of funds) {
    const txns = txnsByFund.get(fund.id) ?? [];
    const postedTxns = txns.filter((t) => t.status === "posted");
    const pendingExpenseCents = txns
      .filter((t) => t.status === "pending" && t.flow === "expense")
      .reduce((s, t) => s + t.amountCents, 0);

    // Build actual map: categoryId_flow → total posted cents
    const actualMap = new Map<string, number>();
    for (const txn of postedTxns) {
      if (txn.categoryId) {
        const key = `${txn.categoryId}_${txn.flow}`;
        actualMap.set(key, (actualMap.get(key) ?? 0) + txn.amountCents);
      }
    }

    const categories = categoriesByKind.get(fund.kind) ?? [];

    function buildLines(flowFilter: "income" | "expense"): FundReportCategoryLine[] {
      const flowCats = categories.filter((c) => c.flow === flowFilter);
      const result: FundReportCategoryLine[] = [];
      const seen = new Set<string>();

      for (const cat of flowCats) {
        seen.add(cat.id);
        const actualCents = actualMap.get(`${cat.id}_${flowFilter}`) ?? 0;
        result.push({
          categoryId: cat.id,
          categoryName: cat.name,
          actualCents,
          budgetCents: null, // entity report does not surface budgets
          variance: budgetVariance(actualCents, null),
          countsAsGiving: cat.countsAsGiving,
          causeLines: null, // entity report does not surface budgets, so never a breakdown
          pendingDeleteAt: null, // entity report does not surface budgets, so never pending-delete
          starred: false, // entity report does not surface budgets, so never starred (DECISION-057)
          note: null,
        });
      }

      // Catch deactivated categories that still have posted actuals
      for (const txn of postedTxns) {
        if (txn.categoryId && txn.flow === flowFilter && !seen.has(txn.categoryId)) {
          seen.add(txn.categoryId);
          const actualCents = actualMap.get(`${txn.categoryId}_${flowFilter}`) ?? 0;
          result.push({
            categoryId: txn.categoryId,
            categoryName: "(Deactivated category)",
            actualCents,
            budgetCents: null,
            variance: budgetVariance(actualCents, null),
            countsAsGiving: false,
            causeLines: null,
            pendingDeleteAt: null,
            starred: false,
            note: null,
          });
        }
      }

      return result;
    }

    const income = buildLines("income");
    const expense = buildLines("expense");
    const totalIncomeCents = income.reduce((s, l) => s + l.actualCents, 0);
    const totalExpenseCents = expense.reduce((s, l) => s + l.actualCents, 0);
    const rolledForwardOpening = rolledForwardOpeningCents(
      fund.openingBalanceCents,
      preFyRowsByFundId.get(fund.id) ?? [],
    );
    const endingCents = rolledForwardOpening + totalIncomeCents - totalExpenseCents;

    fundReports.push({
      fund,
      openingCents: rolledForwardOpening,
      income,
      expense,
      totalIncomeCents,
      totalExpenseCents,
      endingCents,
      pendingExpenseCents,
      // Entity report does not surface budgets or cause-line breakdowns
      // (causeLines is always null above) — no prior-year cause-line
      // reference to compute here either.
      causeActualsByKey: {},
    });
  }

  // Entity-level aggregates — from posted income/expense, excluding transfer rows
  const postedNonTransfer = allTxns.filter(
    (t) => t.status === "posted" && t.transferGroupId === null,
  );
  const grossReceipts = grossReceiptsCents(
    postedNonTransfer.filter((t) => t.flow === "income"),
  );
  const totalExpense = postedNonTransfer
    .filter((t) => t.flow === "expense")
    .reduce((s, t) => s + t.amountCents, 0);
  const entityBalance = fundReports.reduce((s, f) => s + f.endingCents, 0);

  const determine990Result = determine990({
    taxClassification: entity.taxClassification,
    charityStatus: entity.charityStatus,
    grossReceiptsCents: grossReceipts,
    assetsCents: entityBalance,
  });

  // Guardrail flags — reuse getOverview for the full guardrail computation
  // rather than re-deriving all inputs here; the reports page calls both
  // getEntityReport and getOverview in parallel (Phase 3 design).
  // getEntityReport returns an empty flags array; the page merges from getOverview.
  return {
    entity,
    funds: fundReports,
    grossReceiptsCents: grossReceipts,
    netCents: grossReceipts - totalExpense,
    determine990Result,
    guardrailFlags: [],
  };
}

// ---------------------------------------------------------------------------
// get990Prep (inc4)
// ---------------------------------------------------------------------------

/**
 * Aggregates posted non-transfer transactions by form_990_line for a given
 * entity × fiscal year.
 *
 * Constraints (all binding per Phase 1 decision §4 and Phase 3 design):
 *   - status = 'posted' only.
 *   - transfer_group_id IS NULL — internal fund movements excluded.
 *   - LEFT JOIN ledger_categories — uncategorized rows included (never dropped).
 *
 * Group-key logic:
 *   - category.form_990_line is non-null  → use form_990_line as the key.
 *   - category exists but form_990_line IS NULL → "Unmapped / <category name>".
 *   - category IS NULL (no category_id)   → "Uncategorized".
 *
 * Uses db.execute(sql`…`) for the COALESCE+CASE grouping — cleaner than the
 * Drizzle query builder for this aggregation shape.
 *
 * Returns a Prep990Result with hasUnmapped=true when any row is "Uncategorized"
 * or starts with "Unmapped /".
 */
export async function get990Prep(
  entityId: string,
  fiscalYear: number,
): Promise<Prep990Result> {
  const { start, end } = fyBounds(fiscalYear);

  type RawRow = {
    line_group: string;
    flow: string;
    total_cents: string; // Postgres returns numeric as string
  };

  const rawRows = await db.execute<RawRow>(sql`
    SELECT
      COALESCE(
        cat.form_990_line,
        CASE
          WHEN cat.id IS NULL THEN 'Uncategorized'
          ELSE 'Unmapped / ' || cat.name
        END
      ) AS line_group,
      t.flow,
      SUM(t.amount_cents)::text AS total_cents
    FROM ledger_transactions t
    LEFT JOIN ledger_categories cat ON cat.id = t.category_id
    WHERE t.entity_id = ${entityId}
      AND t.txn_date >= ${start}
      AND t.txn_date < ${end}
      AND t.status = 'posted'
      AND t.transfer_group_id IS NULL
    GROUP BY line_group, t.flow
    ORDER BY line_group, t.flow
  `);

  const lines: Prep990Line[] = rawRows.map((r) => ({
    lineGroup: r.line_group,
    flow: r.flow as "income" | "expense",
    totalCents: parseInt(r.total_cents, 10),
  }));

  const grossReceipts = lines
    .filter((l) => l.flow === "income")
    .reduce((s, l) => s + l.totalCents, 0);
  const totalExpense = lines
    .filter((l) => l.flow === "expense")
    .reduce((s, l) => s + l.totalCents, 0);

  const hasUnmapped = lines.some(
    (l) => l.lineGroup === "Uncategorized" || l.lineGroup.startsWith("Unmapped /"),
  );

  // Fetch entity for determine990
  const entityRows = await db
    .select()
    .from(ledgerEntities)
    .where(eq(ledgerEntities.id, entityId))
    .limit(1);
  const entity = entityRows[0];

  // Entity assets estimate for the 990 determination: use the same fund ENDING
  // balances the overview/compliance pages use (MEDIUM-1 fix — previously summed
  // opening balances, which could flip the determined form vs. those pages for
  // the same entity/FY). Still a cash-basis proxy for total assets.
  const overview = await getOverview(entityId, fiscalYear);
  const entityBalance = overview
    ? overview.funds.reduce((s, f) => s + f.endingCents, 0)
    : 0;

  const determine990Result = entity
    ? determine990({
        taxClassification: entity.taxClassification,
        charityStatus: entity.charityStatus,
        grossReceiptsCents: grossReceipts,
        assetsCents: entityBalance,
      })
    : { form: "Unknown", why: "Entity not found" };

  return {
    lines,
    grossReceiptsCents: grossReceipts,
    totalExpenseCents: totalExpense,
    netCents: grossReceipts - totalExpense,
    determine990Result,
    hasUnmapped,
  };
}

// ---------------------------------------------------------------------------
// listTransactionsForExport (inc4)
// ---------------------------------------------------------------------------

/**
 * Returns all transactions for a given entity × fiscal year (all statuses),
 * enriched with fund name and a synthesized categoryDisplay field.
 *
 * categoryDisplay derivation:
 *   - transferGroupId IS NOT NULL → "Transfer"
 *   - categoryId IS NULL (and not a transfer) → "Uncategorized"
 *   - Otherwise → category.name from the LEFT JOIN result.
 *
 * Ordered by txnDate ASC, createdAt ASC (chronological for auditors).
 *
 * This query intentionally includes posted, pending, and rejected rows so the
 * auditor can see the full picture. The 990-prep export uses get990Prep (posted
 * only). Status column is included in the return so the CSV can surface it.
 */
export async function listTransactionsForExport(
  entityId: string,
  fiscalYear: number,
): Promise<ExportTxnRow[]> {
  const { start, end } = fyBounds(fiscalYear);

  const rows = await db
    .select({
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      memo: ledgerTransactions.memo,
      paymentMethod: ledgerTransactions.paymentMethod,
      status: ledgerTransactions.status,
      reconciled: ledgerTransactions.reconciled,
      transferGroupId: ledgerTransactions.transferGroupId,
      categoryId: ledgerTransactions.categoryId,
      fundName: ledgerFunds.name,
      categoryName: ledgerCategories.name,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, end),
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate), asc(ledgerTransactions.createdAt));

  return rows.map((r) => {
    let categoryDisplay: string;
    if (r.transferGroupId !== null) {
      categoryDisplay = "Transfer";
    } else if (r.categoryId === null || r.categoryName === null) {
      categoryDisplay = "Uncategorized";
    } else {
      categoryDisplay = r.categoryName;
    }

    return {
      txnDate: r.txnDate,
      fundName: r.fundName ?? "Unknown Fund",
      flow: r.flow as "income" | "expense",
      categoryDisplay,
      party: r.party,
      amountCents: r.amountCents,
      status: r.status,
      reconciled: r.reconciled,
      paymentMethod: r.paymentMethod,
      memo: r.memo,
    };
  });
}

// ---------------------------------------------------------------------------
// Inc5: Philanthropy / Impact Dashboard — types and query
// ---------------------------------------------------------------------------

export type PhilanthropyByCause = {
  /** LOWER(TRIM(beneficiary_cause)) or '' for null/empty rows. */
  causeKey: string;
  /**
   * Display label: first-seen original casing from the raw rows, or
   * "Other community support" when causeKey is ''.
   */
  causeLabel: string;
  totalCents: number;
  /** 0–100, rounded to 1 decimal. 0 when allTimeCents is 0. */
  pct: number;
  /** See CauseBucket.rows in src/lib/ledger.ts — same shape, re-declared here
   *  because PhilanthropyByCause is this module's own type, not a re-export
   *  of CauseBucket. Keep these two type literals in sync by hand; import
   *  CauseGivingRow itself (don't redefine it) to prevent the row shape from
   *  drifting even if the two container types stay separately declared. */
  rows: CauseGivingRow[];
};

export type PhilanthropyByFY = {
  /** Fiscal year start-year integer (DECISION-015). */
  fiscalYear: number;
  /** e.g. "FY2026 (Jul 2026 – Jun 2027)" */
  label: string;
  totalCents: number;
};

export type PhilanthropyRecentGift = {
  /** YYYY-MM-DD from txn_date. */
  txnDate: string;
  /** Payee/recipient name. null excluded by query but type allows null for safety. */
  party: string | null;
  amountCents: number;
  /** Raw beneficiary_cause. null → "Other community support" in the UI. */
  cause: string | null;
  /** Treasurer-curated, member-facing annotation (Impact Gift Public Note).
   *  Null when not curated — rendered as an additive line only when truthy. */
  publicNote: string | null;
};

export type PhilanthropySummary = {
  allTimeCents: number;
  currentFyCents: number;
  /** Sorted desc by totalCents; "Other community support" (causeKey='') always last. */
  byCause: PhilanthropyByCause[];
  /** Sorted desc by fiscalYear (most recent first). */
  byFiscalYear: PhilanthropyByFY[];
  /**
   * Per-fiscal-year cause breakdowns for the FY filter pills on
   * /members/impact — keyed by fiscal-year start-year integer. Contains one
   * entry for every fiscal year that appears in the giving data, PLUS the
   * current FY even when it has no giving yet (it's always the pill
   * dashboard's default selection and needs its own — possibly empty —
   * entry). NOT clamped to a fixed window: the client decides which years
   * render as fixed pills vs. behind "More" via deriveCauseFyPills() in
   * src/lib/fiscal-year.ts. Percentages within each year's array are
   * relative to THAT year's total, not the all-time total.
   */
  byCauseByFy: Record<number, PhilanthropyByCause[]>;
  /** Up to recentGiftsLimit rows, party IS NOT NULL, sorted desc by txnDate. */
  recentGifts: PhilanthropyRecentGift[];
};

/**
 * Builds the philanthropy / impact dashboard summary.
 *
 * Two DB round-trips, no N+1:
 *   1. All giving rows (txnDate, amountCents, beneficiaryCause) — folded in
 *      TypeScript to produce allTimeCents, currentFyCents, byCause, byFiscalYear.
 *   2. Recent named gifts — giving rows WHERE party IS NOT NULL ORDER BY
 *      txnDate DESC LIMIT N (default 8).
 *
 * NOTE: The giving predicate here mirrors isGiving() in src/lib/ledger.ts.
 * Both definitions must stay in sync.
 *
 * Giving predicate (canonical SQL form):
 *   status = 'posted'
 *   AND transfer_group_id IS NULL
 *   AND flow = 'expense'
 *   AND fund.kind IN ('activity', 'charitable', 'scholarship')
 *   AND category.counts_as_giving IS NOT FALSE
 *
 * Administrative fund rows (kind='administrative') are excluded by omission
 * from the IN list — never appear in philanthropy totals (DECISION: see Phase 3
 * design doc, docs/work-log/2026-06-25-ledger-impact.md).
 *
 * DECISION-030: TRUE GIFTS ONLY. category is LEFT JOINed (categoryId is
 * nullable on ledger_transactions) — a transaction with no category, or
 * whose category row doesn't set counts_as_giving to false, stays INCLUDED
 * (conservative: uncategorized public-fund spend keeps appearing under
 * "Other community support" rather than silently vanishing). Only an
 * explicit counts_as_giving=false (fundraising event costs, operations,
 * insurance & bonding, etc.) excludes a row from these totals.
 *
 * DECISION-024: null-party rows are excluded from the "Recent gifts" list.
 * Those dollars are still captured in allTimeCents, currentFyCents, byCause,
 * and byFiscalYear totals.
 */
export async function getPhilanthropy(
  opts: { recentGiftsLimit?: number } = {},
): Promise<PhilanthropySummary> {
  const recentGiftsLimit = opts.recentGiftsLimit ?? 8;

  // -------------------------------------------------------------------------
  // Query 1: all giving rows for aggregate computation
  // -------------------------------------------------------------------------
  const givingRows = await db
    .select({
      txnDate: ledgerTransactions.txnDate,
      amountCents: ledgerTransactions.amountCents,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      id: ledgerTransactions.id,
      party: ledgerTransactions.party,
      publicNote: ledgerTransactions.publicNote,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .where(
      and(
        eq(ledgerTransactions.status, "posted"),
        isNull(ledgerTransactions.transferGroupId),
        eq(ledgerTransactions.flow, "expense"),
        inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
        or(isNull(ledgerCategories.countsAsGiving), eq(ledgerCategories.countsAsGiving, true)),
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate));

  // -------------------------------------------------------------------------
  // Fold giving rows in TypeScript — single pass for all aggregates
  // -------------------------------------------------------------------------

  /**
   * Parse a YYYY-MM-DD string as a local date (avoids UTC shift from new Date(string)).
   */
  function parseYMD(s: string): Date {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  const currentFY = currentFiscalYear(new Date());

  let allTimeCents = 0;
  let currentFyCents = 0;

  // fiscalYear (number) → totalCents
  const fyMap = new Map<number, number>();
  // fiscalYear (number) → giving rows for that FY. Retains every fiscal year
  // present in the data — not clamped to a fixed window — so the client-side
  // FY filter pills on /members/impact can reveal older years via "More"
  // with no extra DB round trip (2026-07-20 pill rework; the fixed-vs-"More"
  // split is computed client-side by deriveCauseFyPills() in
  // src/lib/fiscal-year.ts).
  const rowsByFy = new Map<number, GivingFoldRow[]>();

  for (const row of givingRows) {
    allTimeCents += row.amountCents;

    const rowFY = getFiscalYear(parseYMD(row.txnDate));
    if (rowFY === currentFY) {
      currentFyCents += row.amountCents;
    }

    // By-FY grouping
    fyMap.set(rowFY, (fyMap.get(rowFY) ?? 0) + row.amountCents);

    // Per-FY row collection, for byCauseByFy below. Single pass over the
    // already-fetched givingRows — no extra DB round trip.
    const arr = rowsByFy.get(rowFY) ?? [];
    arr.push(row);
    rowsByFy.set(rowFY, arr);
  }

  // Build byCause (all-time, unchanged behavior — now delegates to the
  // shared bucketGivingByCause() helper so all-time and per-FY breakdowns
  // can never drift out of sync).
  const byCause: PhilanthropyByCause[] = bucketGivingByCause(givingRows);

  // Build byCauseByFy: one cause breakdown per fiscal year that appears in
  // the giving data, plus the current FY even when it has no giving yet (the
  // impact page's default pill selection needs its own — possibly empty —
  // entry). Percentages within each year's array are relative to that year's
  // own total.
  const byCauseByFyYears = new Set<number>([currentFY, ...fyMap.keys()]);
  const byCauseByFy: Record<number, PhilanthropyByCause[]> = {};
  for (const fy of byCauseByFyYears) {
    byCauseByFy[fy] = bucketGivingByCause(rowsByFy.get(fy) ?? []);
  }

  // Build byFiscalYear: sort desc by fiscalYear
  const byFiscalYear: PhilanthropyByFY[] = Array.from(fyMap.entries())
    .map(([fiscalYear, totalCents]) => ({
      fiscalYear,
      label: fiscalYearLabel(fiscalYear),
      totalCents,
    }))
    .sort((a, b) => b.fiscalYear - a.fiscalYear);

  // -------------------------------------------------------------------------
  // Query 2: recent named gifts (party IS NOT NULL)
  // -------------------------------------------------------------------------
  const recentRows = await db
    .select({
      txnDate: ledgerTransactions.txnDate,
      party: ledgerTransactions.party,
      amountCents: ledgerTransactions.amountCents,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      publicNote: ledgerTransactions.publicNote,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerCategories, eq(ledgerTransactions.categoryId, ledgerCategories.id))
    .where(
      and(
        eq(ledgerTransactions.status, "posted"),
        isNull(ledgerTransactions.transferGroupId),
        eq(ledgerTransactions.flow, "expense"),
        inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
        or(isNull(ledgerCategories.countsAsGiving), eq(ledgerCategories.countsAsGiving, true)),
        isNotNull(ledgerTransactions.party),
      ),
    )
    .orderBy(desc(ledgerTransactions.txnDate))
    .limit(recentGiftsLimit);

  const recentGifts: PhilanthropyRecentGift[] = recentRows.map((r) => ({
    txnDate: r.txnDate,
    party: r.party,
    amountCents: r.amountCents,
    cause: r.beneficiaryCause,
    publicNote: r.publicNote,
  }));

  return {
    allTimeCents,
    currentFyCents,
    byCause,
    byFiscalYear,
    byCauseByFy,
    recentGifts,
  };
}

// ---------------------------------------------------------------------------
// Donor queries — inc6a
// ---------------------------------------------------------------------------

export type DonorWithGivingHistory = LedgerDonor & {
  givingHistory: Array<{
    txn: LedgerTransaction & { fundName: string; entityName: string };
    ackStatus: "pending" | "sent" | null;
  }>;
};

/**
 * List donors, optionally filtered by a name/email search string.
 * Returns donors sorted by name ASC. No donor PII beyond what is stored —
 * caller must gate this on LEDGER_RECORD.
 */
export async function listDonors(opts?: {
  search?: string;
}): Promise<LedgerDonor[]> {
  const conditions = [];
  if (opts?.search && opts.search.trim() !== "") {
    const term = `%${opts.search.trim()}%`;
    conditions.push(
      or(ilike(ledgerDonors.name, term), ilike(ledgerDonors.email, term)),
    );
  }
  const q = db.select().from(ledgerDonors);
  if (conditions.length > 0) {
    return q.where(or(...conditions)).orderBy(asc(ledgerDonors.name));
  }
  return q.orderBy(asc(ledgerDonors.name));
}

/**
 * Get a single donor by ID including their Foundation-income giving history
 * (all ledger_transactions rows where donor_id = id, flow='income').
 *
 * Returns null if the donor does not exist.
 * Caller must gate on LEDGER_RECORD — also returns 403 (not 404) when lacking it.
 */
export async function getDonor(donorId: string): Promise<DonorWithGivingHistory | null> {
  const donors = await db
    .select()
    .from(ledgerDonors)
    .where(eq(ledgerDonors.id, donorId))
    .limit(1);
  const donor = donors[0];
  if (!donor) return null;

  // Fetch all income transactions linked to this donor, joined with fund/entity
  const txnRows = await db
    .select({
      txn: ledgerTransactions,
      fundName: ledgerFunds.name,
      entityName: ledgerEntities.name,
      ackId: ledgerAcknowledgments.id,
      ackSentAt: ledgerAcknowledgments.sentAt,
    })
    .from(ledgerTransactions)
    .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .leftJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .leftJoin(
      ledgerAcknowledgments,
      eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.id),
    )
    .where(
      and(
        eq(ledgerTransactions.donorId, donorId),
        eq(ledgerTransactions.flow, "income"),
      ),
    )
    .orderBy(desc(ledgerTransactions.txnDate));

  const givingHistory = txnRows.map((r) => ({
    txn: {
      ...r.txn,
      fundName: r.fundName ?? "Unknown Fund",
      entityName: r.entityName ?? "Unknown Entity",
    },
    ackStatus: r.ackId === null
      ? null
      : r.ackSentAt !== null
        ? ("sent" as const)
        : ("pending" as const),
  }));

  return { ...donor, givingHistory };
}

// ---------------------------------------------------------------------------
// Acknowledgment queries — inc6a
// ---------------------------------------------------------------------------

export type PendingAcknowledgmentRow = {
  txn: LedgerTransaction & { fundName: string; entityName: string };
  donor: LedgerDonor | null;
};

export type AcknowledgmentSummaryRow = {
  id: string;
  donationTxnId: string;
  amountCents: number;
  txnDate: string;
  type: string;
  sentAt: Date | null;
  quidProQuoValueCents: number | null;
  entityName: string;
  fundName: string;
  // PII fields — only included when caller has LEDGER_RECORD
  donorId?: string | null;
  donorName?: string | null;
};

/**
 * List Foundation income transactions >= $250 that do NOT yet have a sent
 * acknowledgment (sentAt IS NULL). These are the pending ack tasks.
 *
 * Includes donor row (nullable) for display. Caller must gate on LEDGER_RECORD
 * to expose donor PII.
 */
export async function listPendingAcknowledgments(): Promise<PendingAcknowledgmentRow[]> {
  // Transactions that need an acknowledgment: Foundation income, amount >= $25000c,
  // with no acknowledgment row at all OR with an existing ack that is not yet sent.
  const rows = await db
    .select({
      txn: ledgerTransactions,
      fundName: ledgerFunds.name,
      entityName: ledgerEntities.name,
      ackId: ledgerAcknowledgments.id,
      ackSentAt: ledgerAcknowledgments.sentAt,
      donor: ledgerDonors,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .leftJoin(
      ledgerAcknowledgments,
      eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.id),
    )
    .leftJoin(ledgerDonors, eq(ledgerTransactions.donorId, ledgerDonors.id))
    .where(
      and(
        eq(ledgerEntities.donationsDeductible, true),
        eq(ledgerTransactions.flow, "income"),
        eq(ledgerTransactions.status, "posted"),
        // ack row missing OR ack not yet sent
        or(
          isNull(ledgerAcknowledgments.id),
          isNull(ledgerAcknowledgments.sentAt),
        ),
        // Only include transactions that meet the minimum threshold ($250)
        sql`${ledgerTransactions.amountCents} >= 25000`,
      ),
    )
    .orderBy(desc(ledgerTransactions.txnDate));

  return rows.map((r) => ({
    txn: {
      ...r.txn,
      fundName: r.fundName ?? "Unknown Fund",
      entityName: r.entityName ?? "Unknown Entity",
    },
    donor: r.donor ?? null,
  }));
}

/**
 * Returns the acknowledgment queue summary.
 * The `includePii` flag controls whether `donorId` and `donorName` are included.
 * Set `includePii = true` only when the caller has LEDGER_RECORD.
 *
 * Pass `pendingOnly = true` to filter to unsent acks only.
 */
export async function listAcknowledgmentsSummary(opts: {
  pendingOnly?: boolean;
  includePii?: boolean;
}): Promise<AcknowledgmentSummaryRow[]> {
  const conditions = [];
  if (opts.pendingOnly) {
    conditions.push(isNull(ledgerAcknowledgments.sentAt));
  }

  const rows = await db
    .select({
      id: ledgerAcknowledgments.id,
      donationTxnId: ledgerAcknowledgments.donationTxnId,
      amountCents: ledgerAcknowledgments.amountCents,
      txnDate: ledgerAcknowledgments.txnDate,
      type: ledgerAcknowledgments.type,
      sentAt: ledgerAcknowledgments.sentAt,
      quidProQuoValueCents: ledgerAcknowledgments.quidProQuoValueCents,
      donorId: ledgerAcknowledgments.donorId,
      entityName: ledgerEntities.name,
      fundName: ledgerFunds.name,
      donorName: ledgerDonors.name,
    })
    .from(ledgerAcknowledgments)
    .innerJoin(
      ledgerTransactions,
      eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.id),
    )
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .leftJoin(ledgerDonors, eq(ledgerAcknowledgments.donorId, ledgerDonors.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ledgerAcknowledgments.txnDate));

  return rows.map((r) => {
    const base: AcknowledgmentSummaryRow = {
      id: r.id,
      donationTxnId: r.donationTxnId,
      amountCents: r.amountCents,
      txnDate: r.txnDate,
      type: r.type,
      sentAt: r.sentAt,
      quidProQuoValueCents: r.quidProQuoValueCents,
      entityName: r.entityName ?? "Unknown Entity",
      fundName: r.fundName ?? "Unknown Fund",
    };
    if (opts.includePii) {
      base.donorId = r.donorId;
      base.donorName = r.donorName ?? null;
    }
    return base;
  });
}

/**
 * Get a single acknowledgment by ID, including its linked transaction and donor.
 * Returns null if not found.
 */
export async function getAcknowledgment(ackId: string): Promise<
  (LedgerAcknowledgment & {
    txn: LedgerTransaction & { entityName: string; fundName: string };
    donor: LedgerDonor | null;
    entity: LedgerEntity | null;
  }) | null
> {
  const rows = await db
    .select({
      ack: ledgerAcknowledgments,
      txn: ledgerTransactions,
      fundName: ledgerFunds.name,
      entity: ledgerEntities,
      donor: ledgerDonors,
    })
    .from(ledgerAcknowledgments)
    .innerJoin(
      ledgerTransactions,
      eq(ledgerAcknowledgments.donationTxnId, ledgerTransactions.id),
    )
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .innerJoin(ledgerEntities, eq(ledgerTransactions.entityId, ledgerEntities.id))
    .leftJoin(ledgerDonors, eq(ledgerAcknowledgments.donorId, ledgerDonors.id))
    .where(eq(ledgerAcknowledgments.id, ackId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row.ack,
    txn: {
      ...row.txn,
      fundName: row.fundName ?? "Unknown Fund",
      entityName: row.entity?.name ?? "Unknown Entity",
    },
    donor: row.donor ?? null,
    entity: row.entity ?? null,
  };
}

// ---------------------------------------------------------------------------
// getDuesTimingAdjustment — Budget-Balance Overview (2026-07-28)
// ---------------------------------------------------------------------------

/**
 * Fetches every dues-linked posted income row for a fund, across all fiscal
 * years (no txnDate bound — a payment can be dated in any FY relative to the
 * membership year it's for), and re-homes it to the FY it's actually FOR via
 * computeDuesTimingAdjustment() (src/lib/ledger.ts) — the dues-timing
 * adjustment backing the fund-report page's balance banner
 * (docs/work-log/2026-07-28-budget-balance-overview.md).
 *
 * Dues income only ever posts to the Club entity's Administrative fund
 * (syncDuesCreate hardcodes slug='club'/'administrative' — confirmed in
 * Phase 1), so this naturally returns an all-zero adjustment for every other
 * fund; the caller hides the adjustment block whenever both totals are zero.
 *
 * Returns `null` only when the query itself throws — the caller (the
 * fund-report page) degrades to a cash-basis-only banner rather than
 * crashing the whole report page.
 */
export async function getDuesTimingAdjustment(
  fundId: string,
  fiscalYear: number,
): Promise<DuesTimingAdjustment | null> {
  try {
    const rows = await db
      .select({
        txnDate: ledgerTransactions.txnDate,
        amountCents: ledgerTransactions.amountCents,
        duesFiscalYear: duesPayments.fiscalYear,
      })
      .from(ledgerTransactions)
      .innerJoin(duesPayments, eq(ledgerTransactions.duesPaymentId, duesPayments.id))
      .where(
        and(
          eq(ledgerTransactions.fundId, fundId),
          eq(ledgerTransactions.flow, "income"),
          eq(ledgerTransactions.status, "posted"),
        ),
      );

    return computeDuesTimingAdjustment(rows, fiscalYear);
  } catch {
    return null;
  }
}

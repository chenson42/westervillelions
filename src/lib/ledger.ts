/**
 * Ledger helper utilities — pure functions, no DB access.
 *
 * All money values are integer cents (positive). Flow direction is encoded by
 * the `flow` field ('income' | 'expense'). Transfer rows use flow='expense' on
 * the debit side and flow='income' on the credit side (DECISION-016 / DECISION-017);
 * there is no 'transfer' flow value.
 *
 * The fiscal year runs Jul 1 – Jun 30, labeled by its starting year. FY helpers
 * live in src/lib/fiscal-year.ts and are the single source of truth (DECISION-015).
 *
 * Guardrails active in inc1: negative fund (HIGH), reserves threshold (WARN),
 * treasurer not bonded (WARN), income without party (WARN), cash disbursements (WARN),
 * expenses without receipt URL (INFO).
 *
 * Guardrails activated in inc2: two-fund firewall (HIGH), unapproved disbursements
 * over threshold (WARN), unreconciled transactions from prior months (WARN).
 *
 * Guardrails activated in inc3: IRS revocation risk (HIGH), overdue filings (WARN).
 *
 * Guardrails activated in inc7: aged public-fund balances (WARN),
 * direct-to-admin public income (WARN); firewall policyCite upgraded to §3(g).
 *
 * Ledger Dashboard (Two-Entity Homepage, 2026-07-20 / DECISION-031/032): no new
 * guardrail checks. Aged-public-fund detail text gains an optional fund-name
 * parenthetical (agedPublicFundNames()); new daysSinceTxnDate() helper feeds
 * the uncashed-checks list's age column.
 *
 * Transaction Receipt Upload (2026-07-21 / DECISION-035): Check 11 (expenses
 * missing receipt documentation) now excludes administratively-waived rows
 * via the new isReceiptMissing() pure predicate, and gains a `linkHref` deep
 * link to the filtered transaction list. GuardrailsInput gains entitySlug and
 * fiscalYear to build that link; GuardrailFlag gains an optional linkHref.
 *
 * Guided Budgeting — Copy-Forward + Balance Check (2026-07-27): four new pure
 * helpers back the guided-budgeting flow: computeBudgetBalanceStatus() (advisory
 * income-vs-expense readout per fund kind, DECISION-042 sets the Activity fund's
 * ±$100 near-zero tolerance), deriveSeedLinesForFund() (maps a fund's prior-FY
 * report lines into proposed seed lines, with the fund-wide actuals→budget
 * fallback), validateBudgetLineInput() (the single validation source of truth
 * shared by PATCH /budgets and POST /budgets/seed via upsertBudgetLine() in
 * ledger-queries.ts), and decideSeedWriteAction() (fill-empty vs. overwrite
 * dispatch). See docs/work-log/2026-07-27-ledger-guided-budgeting.md Phase 3.
 *
 * Cause-Tagged Budget Line Items (2026-07-27 / DECISION-045/046): the
 * controlled cause taxonomy (BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE,
 * isValidBudgetCause()) promoted out of scripts/import-quicken-ledger.ts, plus
 * isCauseEligibleCategory(), sumBudgetCauseLines(), and deriveCauseSeedLines()
 * (most-recent-FY tie-break, union across the lookback window, collision
 * flagging) backing the new ledger_budget_lines child-table write path in
 * ledger-queries.ts. See docs/work-log/2026-07-27-ledger-cause-budget-lines.md
 * Phase 3.
 *
 * Labeled Cause Budget Lines (2026-07-28 / DECISION-047/048): relaxes the
 * above's "one line per cause" rule so a category can carry several
 * distinctly-labeled lines under the same cause. MAX_BUDGET_LINE_LABEL_LENGTH
 * and normalizeBudgetLineLabel() back the new `label` column; every write
 * path in ledger-queries.ts moved from addressing a line by `(cause)` to
 * addressing it by its own `id`. See
 * docs/work-log/2026-07-28-ledger-labeled-cause-lines.md Phase 3.
 *
 * Budget-Balance Overview (2026-07-28): computeDuesTimingAdjustment()
 * re-homes dues-linked ledger income from the FY it was RECEIVED in (cash
 * basis, txn_date) to the FY it's actually FOR (dues_payments.fiscal_year) —
 * members routinely pay next FY's dues before the current FY closes. Backs
 * the fund-report page's new balance banner, which otherwise reuses
 * computeBudgetBalanceStatus as-is, fed getFundReport's actuals instead of
 * budgeted lines. See docs/work-log/2026-07-28-budget-balance-overview.md
 * Phase 3.
 *
 * Budget Star & Notes (2026-07-29 / DECISION-057): MAX_BUDGET_NOTE_LENGTH and
 * normalizeBudgetNote() back the new `starred`/`note` columns on both
 * ledger_budgets and ledger_budget_lines, mirroring MAX_BUDGET_LINE_LABEL_LENGTH
 * / normalizeBudgetLineLabel()'s trim-only discipline. The write paths
 * (setBudgetCategoryAnnotation, setBudgetCauseLineAnnotation in
 * ledger-queries.ts) are the FIRST budget write paths that deliberately never
 * call assertBudgetUnlocked() — stars/notes stay editable even when the FY
 * budget is Approve-&-locked. See docs/work-log/2026-07-28-budget-star-notes.md
 * Phase 3.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getFiscalYear } from "@/lib/fiscal-year";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowRow = {
  flow: string; // 'income' | 'expense'
  amountCents: number;
};

export type FundState = {
  id: string;
  kind: string;
  balanceCents: number;
};

export type GuardrailSeverity = "ok" | "info" | "warn" | "high";

export type GuardrailFlag = {
  severity: GuardrailSeverity;
  title: string;
  detail: string;
  policyCite?: string;
  /**
   * Optional deep link to the flagged rows (DECISION-035 / Transaction Receipt
   * Upload). Lets rendering call sites (ledger-entity-detail.tsx,
   * compliance/page.tsx) render any actionable flag generically instead of
   * special-casing individual checks.
   */
  linkHref?: string;
};

export type BudgetVarianceResult = {
  varianceCents: number | null;
  pct: number | null;
};

export type Determine990Params = {
  taxClassification: string;
  charityStatus: string | null;
  grossReceiptsCents: number;
  assetsCents: number;
};

export type Determine990Result = {
  form: string;
  why: string;
};

// ---------------------------------------------------------------------------
// computeDueDate (inc3)
// ---------------------------------------------------------------------------

/**
 * Computes the absolute due date for a filing row, given the fiscal year and
 * the stored `due_month` / `due_day` integers.
 *
 * Lions FY runs Jul 1 – Jun 30, labeled by its starting year:
 *   - Months 7–12 (Jul–Dec) fall in the first calendar year of the FY.
 *   - Months 1–6  (Jan–Jun) fall in the second calendar year of the FY.
 *
 * @param fiscalYear  FY start year (e.g. 2026 = Jul 2026 – Jun 2027)
 * @param dueMonth    1-indexed month from the `due_month` column (1–12)
 * @param dueDay      Day of month from the `due_day` column (1–31)
 */
export function computeDueDate(fiscalYear: number, dueMonth: number, dueDay: number): Date {
  if (dueMonth >= 7) {
    // Jul–Dec: same calendar year as FY start
    return new Date(fiscalYear, dueMonth - 1, dueDay);
  }
  // Jan–Jun: second calendar year of the FY
  return new Date(fiscalYear + 1, dueMonth - 1, dueDay);
}

/**
 * Returns true if a filing is overdue: its due date is past (< today) and
 * its status is not one of the terminal states that means "nothing more needed".
 *
 * @param filing   Minimal filing shape (dueMonth, dueDay, fiscalYear, status)
 * @param today    The reference date (default: now; injectable for tests)
 */
export function isFilingOverdue(
  filing: { fiscalYear: number; dueMonth: number; dueDay: number; status: string },
  today: Date = new Date(),
): boolean {
  const dueDate = computeDueDate(filing.fiscalYear, filing.dueMonth, filing.dueDay);
  return dueDate < today && !["filed", "na", "future"].includes(filing.status);
}

// ---------------------------------------------------------------------------
// fundBalanceCents
// ---------------------------------------------------------------------------

/**
 * Computes the ending balance for a fund.
 *
 * Single-pass over the fund's own posted rows:
 *   income → +amountCents
 *   expense → −amountCents
 *
 * Transfer rows (flow='income' on credit side, flow='expense' on debit side)
 * are handled identically to regular income/expense because the two-row design
 * (DECISION-016) encodes the correct sign in the flow column. A 'transfer'
 * literal flow value will never appear (DECISION-017); if one does, it is
 * treated as neutral (returns sum unchanged) with a comment explaining why.
 *
 * @param openingCents  The fund's opening balance in cents
 * @param postedTxns    Rows belonging to this fund (already filtered to the fund)
 */
export function fundBalanceCents(
  openingCents: number,
  postedTxns: Array<FlowRow>,
): number {
  return postedTxns.reduce((sum, txn) => {
    if (txn.flow === "income") return sum + txn.amountCents;
    if (txn.flow === "expense") return sum - txn.amountCents;
    // 'transfer' as a literal flow value must never appear (DECISION-017).
    // If it does, treat it as neutral so the balance is not corrupted.
    return sum;
  }, openingCents);
}

// ---------------------------------------------------------------------------
// rolledForwardOpeningCents — display-side counterpart to DECISION-028
// ---------------------------------------------------------------------------

/**
 * Rolls a fund's static opening-balance seed forward to the start of a given
 * fiscal year by netting all POSTED transactions dated strictly before that
 * FY. `openingBalanceCents` on `ledger_funds` is a one-time seed anchored at
 * the fund's inception — it is never itself mutated — so any FY after the
 * first must add back the net effect of every prior year's activity before
 * it can be treated as "opening balance for this FY".
 *
 * Reuses the canonical `fundBalanceCents()` (same reuse discipline as
 * DECISION-028's cross-FY balance) — no second, hand-rolled balance formula.
 *
 * Filters to `status === 'posted'` defensively: the caller (getOverview and
 * friends) is expected to pass an already posted-only, pre-FY-bounded query
 * result (mirrors Query A2's shape/style — SQL WHERE status='posted'), but
 * this function does not trust that contract blindly, the same way the DB
 * carries a defense-in-depth unique index behind an app-layer check
 * (DECISION-026 Ruling 3) — a display figure this consumer-facing warrants
 * the extra safety margin.
 *
 * @param seedCents    The fund's static openingBalanceCents seed value.
 * @param preFyTxns    Rows dated strictly before the target FY's start,
 *                     across any status — pending/rejected rows are excluded
 *                     here, not just expected to be pre-filtered by the caller.
 */
export function rolledForwardOpeningCents(
  seedCents: number,
  preFyTxns: Array<FlowRow & { status: string }>,
): number {
  const posted = preFyTxns.filter((t) => t.status === "posted");
  return fundBalanceCents(seedCents, posted);
}

// ---------------------------------------------------------------------------
// entityBalanceCents
// ---------------------------------------------------------------------------

/**
 * Computes the total balance across all funds for an entity.
 *
 * Each fund contributes its own opening balance plus its net transactions.
 *
 * @param funds  Array of { openingCents, postedTxns } — one entry per fund
 */
export function entityBalanceCents(
  funds: Array<{ openingCents: number; postedTxns: Array<FlowRow> }>,
): number {
  return funds.reduce((sum, f) => sum + fundBalanceCents(f.openingCents, f.postedTxns), 0);
}

// ---------------------------------------------------------------------------
// grossReceiptsCents
// ---------------------------------------------------------------------------

/**
 * Total gross receipts: sum of amountCents for all income rows.
 *
 * Used for the entity overview and 990 form selection. Expense and transfer
 * rows should NOT be passed here — caller is responsible for filtering to
 * income-only rows.
 *
 * @param incomeRows  Array of income transaction rows (flow='income')
 */
export function grossReceiptsCents(incomeRows: Array<{ amountCents: number }>): number {
  return incomeRows.reduce((sum, r) => sum + r.amountCents, 0);
}

// ---------------------------------------------------------------------------
// budgetVariance
// ---------------------------------------------------------------------------

/**
 * Computes the budget variance for a single category line.
 *
 * Returns { varianceCents: null, pct: null } when no budget is set (caller
 * renders "—" for both columns instead of a $0 variance).
 *
 * When budgetCents is 0, varianceCents is the negative of actualCents and pct
 * is null (avoid division-by-zero).
 *
 * Convention: positive variance = under budget (good); negative = over budget.
 *
 * @param actualCents   Actual YTD spend/receipt in cents
 * @param budgetCents   Annual budget in cents, or null if not set
 */
export function budgetVariance(
  actualCents: number,
  budgetCents: number | null,
): BudgetVarianceResult {
  if (budgetCents === null) {
    return { varianceCents: null, pct: null };
  }
  if (budgetCents === 0) {
    return { varianceCents: -actualCents, pct: null };
  }
  const varianceCents = budgetCents - actualCents;
  const pct = (varianceCents / budgetCents) * 100;
  return { varianceCents, pct };
}

// ---------------------------------------------------------------------------
// determine990
// ---------------------------------------------------------------------------

/**
 * Selects the IRS 990 form this entity should file based on classification,
 * gross receipts, and estimated assets.
 *
 * Logic from Lions_Financial_Transparency.pdf §5:
 *   - 501c4 / non-public-charity: 990 or 990-EZ based on receipts/assets
 *   - Public charity: 990-N (e-postcard) if receipts < $50k; 990-EZ if
 *     receipts < $200k and assets < $500k; otherwise 990
 *   - Private foundation: 990-PF always
 *
 * NOTE: `assetsCents` in inc1 is a proxy (entityBalanceCents). The full assets
 * calculation (inc3/inc4) will use a more accurate figure.
 */
export function determine990(params: Determine990Params): Determine990Result {
  const { taxClassification, charityStatus, grossReceiptsCents: receipts, assetsCents } = params;

  if (charityStatus === "private_foundation") {
    return { form: "990-PF", why: "Private foundations always file Form 990-PF." };
  }

  if (taxClassification === "501c3" && charityStatus === "public_charity") {
    // 990-N: gross receipts ≤ $50,000
    if (receipts <= 50_000 * 100) {
      return {
        form: "990-N",
        why: "Public charity with gross receipts ≤ $50,000 may file Form 990-N (e-Postcard).",
      };
    }
    // 990-EZ: gross receipts < $200,000 AND total assets < $500,000
    if (receipts < 200_000 * 100 && assetsCents < 500_000 * 100) {
      return {
        form: "990-EZ",
        why: "Public charity with gross receipts < $200,000 and assets < $500,000 may file Form 990-EZ.",
      };
    }
    return {
      form: "990",
      why: "Public charity with gross receipts ≥ $200,000 or assets ≥ $500,000 must file Form 990.",
    };
  }

  // 501c4 (social welfare) — not a public charity
  if (receipts <= 50_000 * 100) {
    return {
      form: "990-N",
      why: "501(c)(4) with gross receipts ≤ $50,000 may file Form 990-N.",
    };
  }
  if (receipts < 200_000 * 100 && assetsCents < 500_000 * 100) {
    return {
      form: "990-EZ",
      why: "501(c)(4) with gross receipts < $200,000 and assets < $500,000 may file Form 990-EZ.",
    };
  }
  return { form: "990", why: "Must file Form 990 based on gross receipts or total assets." };
}

// ---------------------------------------------------------------------------
// isGiving — inc5: Philanthropy / Impact Dashboard
// ---------------------------------------------------------------------------

export type IsGivingRow = {
  flow: string;
  transferGroupId: string | null;
};

/**
 * Returns true if a transaction row is philanthropic giving — i.e. a TRUE
 * GIFT eligible to appear in the /members/impact totals.
 *
 * Rule: flow='expense' AND transferGroupId IS NULL AND
 *       fund.kind IN ('activity', 'charitable', 'scholarship') AND
 *       categoryCountsAsGiving !== false.
 *
 * NOTE: This rule is duplicated as a SQL WHERE predicate in
 * getPhilanthropy() in src/lib/ledger-queries.ts. Both definitions
 * must stay in sync. The SQL predicate is the source of truth for
 * aggregate totals; this helper is for per-row UI labeling and unit tests.
 *
 * Administrative fund rows are excluded by the fund.kind set — member dues
 * money (kind='administrative') is NEVER philanthropy. (DECISION: see Phase 3
 * design doc, docs/work-log/2026-06-25-ledger-impact.md.)
 *
 * DECISION-030: `categoryCountsAsGiving` is the transaction's category's
 * `counts_as_giving` flag (nullable — a txn's categoryId can be null, or its
 * category row simply omitted by the caller). Only an EXPLICIT `false`
 * excludes the row — fundraising-event-cost / operations / insurance
 * categories are flagged false so their spend never inflates giving totals.
 * `null` or `undefined` (uncategorized txns, or callers that don't have the
 * category loaded) stays INCLUDED: this is the conservative choice so
 * uncategorized public-fund expenses keep appearing as "Other community
 * support" rather than silently vanishing from the report.
 */
export function isGiving(
  row: IsGivingRow,
  fundKind: string,
  categoryCountsAsGiving?: boolean | null,
): boolean {
  return (
    row.flow === "expense" &&
    row.transferGroupId === null &&
    (fundKind === "activity" || fundKind === "charitable" || fundKind === "scholarship") &&
    categoryCountsAsGiving !== false
  );
}

// ---------------------------------------------------------------------------
// bucketGivingByCause — impact dashboard FY filter pills
// ---------------------------------------------------------------------------

export type GivingFoldRow = {
  /** YYYY-MM-DD. Unused by this function directly — callers pre-filter rows
   *  to a fiscal year (or pass all rows for the all-time bucket) before
   *  calling. Kept on the type so callers can pass the same row shape they
   *  already fetch from getPhilanthropy()'s giving query. */
  txnDate: string;
  amountCents: number;
  beneficiaryCause: string | null;
  /** Stable transaction id — carried through into CauseBucket.rows for the
   *  impact-page cause drill-down (Impact Cause Drill-Down feature). */
  id: string;
  /** Payee/recipient name, nullable. Carried through into CauseBucket.rows
   *  unfiltered — see the DECISION-024 note on CauseGivingRow below. */
  party: string | null;
  /** Treasurer-curated, member-facing annotation (Impact Gift Public Note).
   *  Carried through into CauseBucket.rows unchanged — null stays null, never
   *  coerced to "" (the display components key off truthiness). */
  publicNote: string | null;
};

/** One individual gift row inside a CauseBucket, for the drill-down UI.
 *  Never filters on party — includes null-party rows so that summing a
 *  bucket's `rows` always reconciles to `bucket.totalCents` (DECISION-024
 *  only excludes null-party rows from Query 2 / recentGifts, never from
 *  Query 1 / this fold). Sorted desc by txnDate within each bucket. */
export type CauseGivingRow = {
  id: string;
  txnDate: string;
  party: string | null;
  amountCents: number;
  /** Treasurer-curated, member-facing annotation (Impact Gift Public Note).
   *  Null when not curated — rendered as an additive line only when truthy. */
  publicNote: string | null;
};

export type CauseBucket = {
  /** LOWER(TRIM(beneficiary_cause)) or '' for null/empty rows. */
  causeKey: string;
  /** First-seen original casing from the raw rows, or "Other community
   *  support" when causeKey is ''. */
  causeLabel: string;
  totalCents: number;
  /** 0–100, rounded to 1 decimal, relative to the sum of `rows` passed in
   *  (i.e. relative to THIS bucket's own total — not a global total). 0 when
   *  the bucket's total is 0. */
  pct: number;
  /** Every individual gift row folded into this bucket, sorted desc by
   *  txnDate. Required (not optional) — one shape for both the existing
   *  summary consumers and the new drill-down, per architect's suggestion. */
  rows: CauseGivingRow[];
};

/**
 * Groups a set of already-filtered giving rows by cause. Pure function, no
 * DB access — callers pre-filter `rows` to whatever scope they want a
 * breakdown for (all-time, a single fiscal year, etc.) and percentages are
 * computed relative to that scope's own total.
 *
 * Sorted desc by totalCents; the '' key ("Other community support") always
 * sorts last, matching the ordering used by getPhilanthropy()'s all-time
 * byCause list.
 *
 * Also accumulates each cause's individual rows (id, txnDate, party,
 * amountCents) into `bucket.rows` in the same single pass, sorted desc by
 * txnDate before being returned (string comparison is safe here — txnDate is
 * always YYYY-MM-DD). This is what powers the /members/impact cause
 * drill-down. IMPORTANT — DECISION-024 asymmetry: this fold must NEVER filter
 * out null-party rows the way Query 2 / recentGifts does. Query 1 (the only
 * caller of this function) has never applied a party-IS-NOT-NULL filter, and
 * it must stay that way — otherwise a bucket's `rows` would stop summing to
 * `bucket.totalCents` and the drill-down's numbers would silently disagree
 * with the totals already shown on the page.
 *
 * Empty input returns an empty array.
 */
export function bucketGivingByCause(rows: GivingFoldRow[]): CauseBucket[] {
  const causeMap = new Map<
    string,
    { totalCents: number; firstSeenOriginal: string; rows: CauseGivingRow[] }
  >();
  let totalCents = 0;

  for (const row of rows) {
    totalCents += row.amountCents;

    const rawCause = row.beneficiaryCause;
    const causeKey =
      rawCause === null || rawCause.trim() === "" ? "" : rawCause.trim().toLowerCase();

    const causeRow: CauseGivingRow = {
      id: row.id,
      txnDate: row.txnDate,
      party: row.party,
      amountCents: row.amountCents,
      publicNote: row.publicNote,
    };

    const existing = causeMap.get(causeKey);
    if (existing) {
      existing.totalCents += row.amountCents;
      existing.rows.push(causeRow);
    } else {
      causeMap.set(causeKey, {
        totalCents: row.amountCents,
        firstSeenOriginal: causeKey === "" ? "" : rawCause!.trim(),
        rows: [causeRow],
      });
    }
  }

  return Array.from(causeMap.entries())
    .map(([causeKey, { totalCents: cents, firstSeenOriginal, rows: bucketRows }]) => ({
      causeKey,
      causeLabel: causeKey === "" ? OTHER_COMMUNITY_SUPPORT_CAUSE : firstSeenOriginal,
      totalCents: cents,
      pct: totalCents > 0 ? Math.round((cents / totalCents) * 1000) / 10 : 0,
      rows: [...bucketRows].sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0)),
    }))
    .sort((a, b) => {
      // '' key (Other community support) always sorts to the end
      if (a.causeKey === "" && b.causeKey !== "") return 1;
      if (b.causeKey === "" && a.causeKey !== "") return -1;
      return b.totalCents - a.totalCents;
    });
}

// ---------------------------------------------------------------------------
// Cause-Tagged Budget Line Items (B-17 Increment A, DECISION-045/046)
// ---------------------------------------------------------------------------

/**
 * The controlled budget-cause taxonomy — the 9-value cause list
 * scripts/import-quicken-ledger.ts's deriveCause() has always emitted for
 * historical transactions, MINUS "Fundraising event costs" (fundraising
 * overhead, not beneficiary giving — excluded from the budget-side picker
 * per Phase 1 Gap 2 / Human Answer 5). "Scholarships" was never its own
 * cause value — deriveCause() already folds every scholarship category into
 * CAUSE_YOUTH ("Youth & Education") today, so no separate fold is needed
 * here. These 8 string values must stay byte-identical to deriveCause()'s
 * CAUSE_* consts so historical cause-tagged actuals (Increment B, and this
 * increment's seed-from-history flow) match the taxonomy a treasurer picks
 * from in the budget UI.
 */
export const BUDGET_CAUSES = [
  "Vision & Eye Care",
  "Youth & Education",
  "Hunger & Basic Needs",
  "Health & Disability",
  "Disaster Relief",
  "Lions International Programs",
  "Community & Civic",
  "Environment",
  "Bags to Benches (Recycling)",
] as const;

export type BudgetCause = (typeof BUDGET_CAUSES)[number];

/**
 * The "catch-all" cause value for a budget line that isn't tied to one of
 * the 8 named causes above. Re-exported from the exact literal
 * bucketGivingByCause() already renders for a null/blank beneficiaryCause on
 * /members/impact (DECISION-045: "re-exported, not re-typed") — this const
 * IS that string, not a second copy of it, so the two can never drift.
 */
export const OTHER_COMMUNITY_SUPPORT_CAUSE = "Other community support";

/**
 * Server-side gate for any `cause` value written to ledger_budget_lines
 * (which has no DB-level enum/CHECK — DECISION-041 precedent). Accepts
 * exactly the 8 BUDGET_CAUSES values plus OTHER_COMMUNITY_SUPPORT_CAUSE;
 * rejects everything else, including "" and "Fundraising event costs" (the
 * taxonomy value Increment A deliberately dropped from the budget picker).
 */
export function isValidBudgetCause(cause: string): boolean {
  return (
    typeof cause === "string" &&
    ((BUDGET_CAUSES as readonly string[]).includes(cause) ||
      cause === OTHER_COMMUNITY_SUPPORT_CAUSE)
  );
}

/**
 * Category eligibility for the "Break down by cause" affordance (DECISION-046
 * item 4, CONFIRMED by Chris 2026-07-27: "Giving expense categories only.").
 * Fund-kind eligibility (activity/charitable, not administrative/scholarship)
 * is implicit at every call site — this predicate only decides the
 * flow/countsAsGiving half, since BudgetEditor always renders categories
 * belonging to a single already-fund-kind-scoped fund. A non-giving category
 * (ops, insurance, fundraising overhead — DECISION-030) never offers a cause
 * picker, and income-flow categories never do either.
 */
export function isCauseEligibleCategory(input: {
  flow: string;
  countsAsGiving: boolean | null | undefined;
}): boolean {
  return input.flow === "expense" && input.countsAsGiving === true;
}

/** A single budget cause line's dollar amount — the minimal shape needed to sum a category's breakdown. */
export type BudgetCauseLineAmount = {
  amountCents: number;
};

/**
 * Sums a category's cause line items into its rolled-up total. Trivial, but
 * extracted so the "parent = sum of children" invariant's math is
 * unit-testable without a DB (mirrors this module's established pattern of
 * pulling pure arithmetic out of the query layer). Empty list returns 0.
 */
export function sumBudgetCauseLines(lines: BudgetCauseLineAmount[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

// ---------------------------------------------------------------------------
// Labeled Cause Budget Lines (DECISION-047/048)
// ---------------------------------------------------------------------------

/**
 * Server-enforced max length (after trim) for a budget cause line's free-text
 * label. Matches this codebase's other short free-text fields (e.g. `party`).
 */
export const MAX_BUDGET_LINE_LABEL_LENGTH = 120;

/**
 * Ledger Category Management (2026-08-07 / DECISION-066 item 2): server-
 * enforced max length (after trim) for a ledger category's `name` and
 * `form990Line`. Both app-layer only, no DB CHECK constraint — DECISION-041's
 * established precedent for this codebase's text classifier/label columns.
 * 120 matches MAX_BUDGET_LINE_LABEL_LENGTH — a category name/990-line
 * reference is a short label, not prose (contrast MAX_BUDGET_NOTE_LENGTH's
 * 500, which is for free-text notes).
 */
export const MAX_CATEGORY_NAME_LENGTH = 120;
export const MAX_FORM_990_LINE_LENGTH = 120;

/**
 * Normalizes a cause line's free-text label: trims leading/trailing
 * whitespace only. Null/undefined/all-whitespace input normalizes to `""`
 * (the "generic" line for its cause) — this is what makes the DB's
 * `NOT NULL DEFAULT ''` blank a real, self-colliding value rather than a
 * distinct "nothing typed" state (DECISION-047 item 1): " WARM " and "WARM"
 * normalize to the identical string and therefore collide under the
 * `(budgetId, cause, label)` uniqueness constraint, but "WARM" and "Warm"
 * remain deliberately distinct — this is free text, not a second controlled
 * taxonomy, and case-folding would silently merge two treasurer-intended
 * labels.
 *
 * Pure — never throws. The caller (createBudgetCauseLine /
 * updateBudgetCauseLine in ledger-queries.ts) is responsible for rejecting a
 * normalized result longer than MAX_BUDGET_LINE_LABEL_LENGTH with a 400,
 * mirroring this module's established "pure helper, DB-touching caller
 * enforces the error" split (validateBudgetLineInput / upsertBudgetLine is
 * the precedent).
 */
export function normalizeBudgetLineLabel(raw: string | undefined | null): string {
  if (raw === null || raw === undefined) return "";
  return raw.trim();
}

/**
 * One (cause, fiscalYear) aggregate from the seed lookback window — the
 * DB-touching caller (computeCauseSeedForCategory in ledger-queries.ts)
 * pre-aggregates posted, cause-tagged expense actuals for one category into
 * this shape (one row per cause per lookback fiscal year); this function
 * only decides what to propose from the data it's given (same split as
 * deriveSeedLinesForFund / getFundReport).
 */
export type CauseSeedSourceRow = {
  cause: string;
  amountCents: number;
  fiscalYear: number;
};

export type CauseSeedProposedLine = {
  cause: string;
  amountCents: number;
  /** Which of the lookback fiscal years this proposed amount came from. */
  sourceFiscalYear: number;
  /** existingCauseAmountMap has an entry for this cause. */
  collision: boolean;
  existingAmountCents: number | null;
};

/**
 * Maps a category's cause-tagged historical actuals (already aggregated per
 * (cause, fiscalYear) by the caller) into proposed cause-line seed
 * candidates for the target FY. Pure — no DB access.
 *
 * Tie-break rule (Human Answer 7, Gap 8): when a cause appears in more than
 * one lookback fiscal year, the MOST RECENT year's amount wins — never a sum
 * or average. Union, not intersection: a cause present in only one lookback
 * year is still proposed (Gap 8's union requirement).
 *
 * Collision detection mirrors the `(budgetId, cause)` unique constraint the
 * write path upserts against: a cause line already exists for the target FY
 * iff `existingCauseAmountMap` has an entry for that cause.
 *
 * Empty input (a category with zero cause-tagged actuals anywhere in the
 * lookback window — e.g. production's unseeded Quicken import, Human Answer
 * 3) returns `[]`, never throws — the seed-review UI's graceful empty state
 * depends on this.
 *
 * @param rows                     Pre-aggregated (cause, fiscalYear) -> total amountCents rows across the lookback window.
 * @param existingCauseAmountMap   cause -> amountCents already set for the target FY's budget row, if any.
 */
export function deriveCauseSeedLines(
  rows: CauseSeedSourceRow[],
  existingCauseAmountMap: Map<string, number>,
): CauseSeedProposedLine[] {
  const byCause = new Map<string, CauseSeedSourceRow>();

  for (const row of rows) {
    const current = byCause.get(row.cause);
    if (!current || row.fiscalYear > current.fiscalYear) {
      byCause.set(row.cause, row);
    }
  }

  return Array.from(byCause.values()).map((row) => {
    const existingAmountCents = existingCauseAmountMap.get(row.cause) ?? null;
    return {
      cause: row.cause,
      amountCents: row.amountCents,
      sourceFiscalYear: row.fiscalYear,
      collision: existingAmountCents !== null,
      existingAmountCents,
    };
  });
}

// ---------------------------------------------------------------------------
// guardrails
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// deriveAckType — inc6a
// ---------------------------------------------------------------------------

/**
 * Longest gift purpose an acknowledgment accepts (Gift Purpose, 2026-08-12).
 * Lives here, in the pure client-safe ledger module, because three surfaces
 * need the same number — the acknowledge route's validator, the create dialog's
 * `maxLength`, and the edit dialog's `maxLength` — and a limit enforced at 200
 * on the server while an input silently allows more is a rejected save the
 * treasurer can't explain.
 *
 * It is a clause inside one sentence of a tax receipt ("...in support of the
 * 2026 Rudolph Run."), not a paragraph. Deliberately shorter than
 * quidProQuoDescription's 500: that field may have to itemize goods and
 * services, this one names a cause.
 */
export const GIFT_PURPOSE_MAX_LENGTH = 200;

/**
 * Derives the IRS Pub 1771 acknowledgment type for a donation.
 *
 * Precedence rules (quid-pro-quo is stricter — always wins when both apply):
 *   1. quidProQuoValueCents >= 7500 ($75+) → 'quid_pro_quo_75'
 *   2. amountCents >= 25000 ($250+) AND no quid-pro-quo → 'written_ack_250'
 *   3. Otherwise → null (no acknowledgment required)
 *
 * A quidProQuoValueCents of 0 is treated the same as null (no goods/services).
 *
 * @param amountCents            Total gift amount in integer cents
 * @param quidProQuoValueCents   FMV of goods/services given to donor (integer cents, or null)
 */
export function deriveAckType(
  amountCents: number,
  quidProQuoValueCents: number | null,
): "written_ack_250" | "quid_pro_quo_75" | null {
  // Quid-pro-quo takes precedence: FMV of goods/services >= $75
  if (quidProQuoValueCents !== null && quidProQuoValueCents >= 7500) {
    return "quid_pro_quo_75";
  }
  // Written acknowledgment required: gift >= $250 with no qualifying quid-pro-quo
  if (amountCents >= 25000) {
    return "written_ack_250";
  }
  return null;
}

// ---------------------------------------------------------------------------
// countAgedPublicFunds — inc7 (revised 2026-07-20, Bug 2 fix / DECISION-028)
// ---------------------------------------------------------------------------

export type AgedPublicFundFact = {
  fundKind: string;
  /** True life-to-date balance: openingBalanceCents + all-time posted income
   *  − all-time posted expense, with NO fiscal-year bound. Callers must NOT
   *  pass an FY-scoped balance here (see DECISION-028 / 2026-07-20 Bug 2). */
  crossFyBalanceCents: number;
  /** ISO date string ('YYYY-MM-DD') of the oldest posted income transaction
   *  for this fund across ALL fiscal years, or null if none exists. */
  oldestPostedIncomeDate: string | null;
  /** Optional — the fund's display name (e.g. "Charitable Fund"), used by
   *  agedPublicFundNames() for the dashboard's entity-tagged guardrail-flag
   *  usability fix (inc7 dashboard, DECISION-032). Optional so the 11
   *  existing countAgedPublicFunds test literals (which don't set it) keep
   *  compiling untouched. */
  fundName?: string;
};

/**
 * Shared qualification predicate for the aged-public-fund check: a public
 * fund (kind ∈ 'activity' | 'charitable' | 'scholarship') with BOTH a
 * positive cross-FY balance AND an oldest posted income transaction older
 * than `thresholdDays` relative to `now`.
 *
 * Extracted so countAgedPublicFunds() and agedPublicFundNames() can never
 * disagree about which funds qualify — same reuse discipline fundBalanceCents()
 * established under DECISION-028/029.
 */
function isAgedPublicFund(f: AgedPublicFundFact, thresholdDays: number, now: Date): boolean {
  if (!["activity", "charitable", "scholarship"].includes(f.fundKind)) return false;
  if (f.crossFyBalanceCents <= 0) return false;
  if (!f.oldestPostedIncomeDate) return false;
  const ageDays =
    (now.getTime() - new Date(f.oldestPostedIncomeDate).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > thresholdDays;
}

/**
 * Counts public funds (kind ∈ 'activity' | 'charitable' | 'scholarship') that
 * have BOTH a positive cross-FY balance AND an oldest posted income
 * transaction older than `thresholdDays` relative to `now`.
 *
 * Pure function — no DB access — so the FY-scoping class of bug (DECISION-028)
 * has a real unit-test seam independent of getOverview()'s FY-windowed fetch.
 * Callers filter or don't filter to public-fund-kind facts before calling this;
 * the kind check here is defensive, not load-bearing, for whichever they choose.
 *
 * @param funds         Cross-FY per-fund facts (see AgedPublicFundFact).
 * @param thresholdDays settings.holdingPeriodWarnDays.
 * @param now           Injectable "now" for deterministic tests; defaults to `new Date()`.
 */
export function countAgedPublicFunds(
  funds: Array<AgedPublicFundFact>,
  thresholdDays: number,
  now: Date = new Date(),
): number {
  return funds.filter((f) => isAgedPublicFund(f, thresholdDays, now)).length;
}

/**
 * Returns the display names of the public funds that qualify as "aged" under
 * the same rule as countAgedPublicFunds() (shared via isAgedPublicFund() so
 * the count and this name list can never disagree). Names preserve the input
 * array's order. A fund with no `fundName` set falls back to "Unnamed fund".
 *
 * Feeds the Ledger Dashboard's merged, entity-tagged guardrail-flag list
 * (inc7 dashboard usability fix, DECISION-032) — without fund names, two
 * near-identical "public fund holding undisbursed balance" WARNs from
 * different entities are visually indistinguishable.
 *
 * @param funds         Cross-FY per-fund facts (see AgedPublicFundFact).
 * @param thresholdDays settings.holdingPeriodWarnDays.
 * @param now           Injectable "now" for deterministic tests; defaults to `new Date()`.
 */
export function agedPublicFundNames(
  funds: Array<AgedPublicFundFact>,
  thresholdDays: number,
  now: Date = new Date(),
): string[] {
  return funds
    .filter((f) => isAgedPublicFund(f, thresholdDays, now))
    .map((f) => f.fundName ?? "Unnamed fund");
}

/**
 * Pure predicate: is this expense transaction missing receipt documentation?
 *
 * True only when ALL of:
 *   - flow === 'expense' (income/transfer rows never count — Phase 1 Gap 4,
 *     expense-only scope confirmed by the user)
 *   - receiptStorageKey is null (no file attached)
 *   - receiptWaivedAt is null (not administratively waived — DECISION-035)
 *
 * Shared by the in-memory guardrail count (getOverview()'s allTxns filter)
 * and the SQL-side `listTransactions({ missingReceipt })` filter so the two
 * can never drift apart in meaning.
 */
export function isReceiptMissing(t: {
  flow: string;
  receiptStorageKey: string | null;
  receiptWaivedAt: Date | null;
}): boolean {
  return t.flow === "expense" && !t.receiptStorageKey && !t.receiptWaivedAt;
}

export type GuardrailsInput = {
  funds: Array<FundState>;
  entityBalanceCents: number;
  settings: {
    reserveWarnThresholdCents: number;
    treasurerBonded: boolean;
    retentionYears: number;
    holdingPeriodWarnDays: number;  // inc7
  };
  /** Count of income transactions where party is null or blank */
  incomeWithoutParty: number;
  /** Count of expense transactions where paymentMethod = 'cash' */
  cashDisbursements: number;
  /** Count of expense transactions where receiptStorageKey and receiptWaivedAt are both null (DECISION-035) */
  txnsWithoutReceipt: number;
  /**
   * Entity slug + current fiscal year — used to build Check 11's `linkHref`
   * deep link to the filtered transaction list (DECISION-035). Both are
   * already in scope at the single call site in getOverview().
   */
  entitySlug: string;
  fiscalYear: number;
  // ---------------------------------------------------------------------------
  // inc2 fields — all required in inc2+; callers on inc1 paths that cannot
  // supply these should pass 0 / 0 / 0 until they are updated.
  // ---------------------------------------------------------------------------
  /** Count of expense transactions with status='pending' (over-threshold disbursements awaiting approval) */
  pendingDisbursements: number;
  /**
   * Count of posted transactions where reconciled=false and txnDate is before
   * the first day of the current calendar month.
   */
  unreconciledPriorMonth: number;
  /**
   * Count of distinct transferGroupId values where one row's fund has kind='activity'
   * and the paired row's fund has kind='administrative' — Activity→Admin firewall.
   */
  firewallViolations: number;
  // ---------------------------------------------------------------------------
  // inc3 fields — all required in inc3+; callers on inc1/inc2 paths that cannot
  // supply these should pass irsFilingHistory: [], overdueFilingCount: 0.
  // ---------------------------------------------------------------------------
  /**
   * IRS 990-family filings for the entity's past fiscal years, ordered ascending.
   * Each entry: { fiscalYear: number, status: string }.
   * Only rows where agency = 'IRS'. Used for the revocation check.
   * Pass [] if compliance filing data is not available at the call site.
   */
  irsFilingHistory: Array<{ fiscalYear: number; status: string }>;
  /**
   * Number of filing rows where computeDueDate(...) < today
   * AND status NOT IN ('filed', 'na', 'future').
   * Computed at the call site in getComplianceOverview.
   * Pass 0 if compliance filing data is not available at the call site.
   */
  overdueFilingCount: number;
  // ---------------------------------------------------------------------------
  // inc6a fields — callers on earlier paths pass 0 until updated.
  // ---------------------------------------------------------------------------
  /**
   * Count of posted transactions with syncStale=true — dues payments that were
   * edited or deleted after the linked ledger row was reconciled.
   * Computed from allTxns in getOverview() — zero extra DB queries.
   * Pass 0 if the value is not available at the call site.
   */
  syncStaleTxns: number;
  // ---------------------------------------------------------------------------
  // inc7 fields — Lions Fund-Compliance Guardrails.
  // Callers on earlier paths pass 0 until updated.
  // ---------------------------------------------------------------------------

  /**
   * Count of public funds (kind ∈ 'activity' | 'charitable' | 'scholarship')
   * where (a) the fund's endingCents > 0 AND (b) the oldest posted income
   * transaction across ALL fiscal years for that fund is more than
   * settings.holdingPeriodWarnDays days old relative to today.
   *
   * Must be a non-negative integer. Computed in getOverview() via a dedicated
   * cross-FY MIN(txn_date) aggregate query (DECISION-027).
   */
  agedPublicFunds: number;

  /**
   * Optional — display names of the funds counted in agedPublicFunds, in the
   * same order agedPublicFundNames() would return them (Ledger Dashboard
   * usability fix, DECISION-032). Omitted/undefined callers get the original
   * detail text with no fund-name parenthetical — fully backward compatible.
   */
  agedPublicFundNames?: string[];

  /**
   * Count of posted income transactions belonging to a fund of kind='administrative'
   * where the transaction's category has fundKind != 'administrative'.
   * Rows with categoryId IS NULL are excluded (they are caught by incomeWithoutParty).
   *
   * Must be a non-negative integer. Computed in getOverview() via a bounded
   * batch fetch of category rows for the relevant categoryIds (DECISION-027).
   */
  adminPublicIncomeCount: number;
};

/**
 * Evaluates all active guardrail checks and returns a list of flags.
 *
 * Active checks:
 *   inc1 — negative fund balance (HIGH), reserves threshold (WARN),
 *           treasurer not bonded (WARN), income without party (WARN),
 *           cash disbursements (WARN), expenses without receipt URL (INFO)
 *   inc2 — unapproved disbursements (WARN), unreconciled prior-month (WARN),
 *           two-fund firewall violation (HIGH)
 *   inc3 — IRS 990 revocation risk / 3 consecutive unfiled years (HIGH),
 *           overdue compliance filings (WARN)
 *   inc7 — aged public-fund balances (WARN), direct-to-admin public income (WARN)
 *
 * Returns an empty array when all checks are clear.
 *
 * Severity levels:
 *   ok   — no issue (not returned in the array; only used internally)
 *   info — worth reviewing but not urgent
 *   warn — should be addressed soon
 *   high — requires immediate attention
 *
 * @param state  Aggregated entity state computed by getOverview()
 */
export function guardrails(state: GuardrailsInput): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];

  // Check 6: Negative fund balance (HIGH)
  for (const fund of state.funds) {
    if (fund.balanceCents < 0) {
      flags.push({
        severity: "high",
        title: `Negative fund balance: ${fund.kind}`,
        detail: `The ${fund.kind} fund has a negative balance. Review recent transactions immediately.`,
        policyCite: "Lions Financial Transparency Policy §6",
      });
    }
  }

  // Check 4: Reserves below warning threshold (WARN)
  if (state.entityBalanceCents < state.settings.reserveWarnThresholdCents) {
    const thresholdDollars = (state.settings.reserveWarnThresholdCents / 100).toFixed(2);
    const actualDollars = (state.entityBalanceCents / 100).toFixed(2);
    flags.push({
      severity: "warn",
      title: "Reserves below minimum threshold",
      detail: `Entity balance ($${actualDollars}) is below the $${thresholdDollars} reserve warning threshold.`,
      policyCite: "Lions Financial Transparency Policy §4",
    });
  }

  // Check 7: Treasurer not bonded (WARN)
  if (!state.settings.treasurerBonded) {
    flags.push({
      severity: "warn",
      title: "Treasurer not bonded",
      detail: "The treasurer has not been confirmed as bonded. Update the ledger settings when the bond is in place.",
      policyCite: "Lions Financial Transparency Policy §7",
    });
  }

  // Check 8: Income transactions missing party / itemized source (WARN)
  if (state.incomeWithoutParty > 0) {
    flags.push({
      severity: "warn",
      title: "Income entries missing itemized source",
      detail: `${state.incomeWithoutParty} income transaction${state.incomeWithoutParty === 1 ? "" : "s"} ${state.incomeWithoutParty === 1 ? "is" : "are"} missing a party (payer). Add the source for each to comply with itemized-receipt requirements.`,
      policyCite: "Lions Financial Transparency Policy §8",
    });
  }

  // Check 9: Cash disbursements present (WARN)
  if (state.cashDisbursements > 0) {
    flags.push({
      severity: "warn",
      title: "Cash disbursements recorded",
      detail: `${state.cashDisbursements} expense transaction${state.cashDisbursements === 1 ? "" : "s"} used cash as payment method. Cash payments reduce audit traceability — consider check or electronic payment.`,
      policyCite: "Lions Financial Transparency Policy §9",
    });
  }

  // Check 11: Expenses missing receipt URL (INFO)
  if (state.txnsWithoutReceipt > 0) {
    flags.push({
      severity: "info",
      title: "Expenses missing receipt documentation",
      detail: `${state.txnsWithoutReceipt} expense transaction${state.txnsWithoutReceipt === 1 ? "" : "s"} ${state.txnsWithoutReceipt === 1 ? "has" : "have"} no receipt URL attached. Retain receipts for ${state.settings.retentionYears} years per policy.`,
      policyCite: "Lions Financial Transparency Policy §11",
      linkHref: `/admin/ledger/all?entity=${state.entitySlug}&fy=${state.fiscalYear}&receipt=missing`,
    });
  }

  // Check: unapproved disbursements over threshold (WARN) — inc2
  if (state.pendingDisbursements > 0) {
    const n = state.pendingDisbursements;
    flags.push({
      severity: "warn",
      title: "Disbursements pending board approval",
      detail: `${n} disbursement${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} awaiting board approval and excluded from posted balances. Review the Approvals screen.`,
      policyCite: "Lions Financial Transparency Policy §5",
    });
  }

  // Check: unreconciled transactions from prior months (WARN) — inc2
  if (state.unreconciledPriorMonth > 0) {
    const n = state.unreconciledPriorMonth;
    const now = new Date();
    const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    flags.push({
      severity: "warn",
      title: "Unreconciled transactions from prior months",
      detail: `${n} posted transaction${n === 1 ? "" : "s"} dated before ${monthName} ${n === 1 ? "has" : "have"} not been reconciled. Mark them reconciled after reviewing your bank statement.`,
      policyCite: "Lions Financial Transparency Policy §8",
    });
  }

  // Check: two-fund firewall violations (HIGH) — inc2
  if (state.firewallViolations > 0) {
    const n = state.firewallViolations;
    flags.push({
      severity: "high",
      title: "Two-fund firewall violation",
      detail: `${n} transfer${n === 1 ? "" : "s"} move${n === 1 ? "s" : ""} money from an Activity fund to the Administrative fund. Activity fund money must remain in activity accounts. Reverse or reclassify these transfers immediately.`,
      policyCite: "Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall",
    });
  }

  // Check: IRS 990 revocation risk — 3 consecutive unfiled returns (HIGH) — inc3
  //
  // Rule (Phase 3 design): look at the 3 most-recent past FYs of IRS filings
  // (agency='IRS') in descending order. If ALL three have status NOT IN
  // ('filed', 'na'), fire a HIGH flag. Suppress entirely when fewer than 3 FYs
  // of IRS filing data exist (avoids spurious warnings for a new install).
  //
  // irsFilingHistory is pre-filtered to agency='IRS' and ordered ascending by
  // fiscalYear — take the last 3 entries (most recent first for the check).
  if (state.irsFilingHistory.length >= 3) {
    const recentThree = state.irsFilingHistory.slice(-3);
    const allUnfiled = recentThree.every(
      (entry) => !["filed", "na"].includes(entry.status),
    );
    if (allUnfiled) {
      flags.push({
        severity: "high",
        title: "IRS 990 revocation risk — 3 consecutive unfiled returns",
        detail:
          "The IRS automatically revokes tax-exempt status after 3 consecutive years of " +
          "failure to file a required annual return. File the overdue returns immediately.",
        policyCite: "IRC §6033(j)",
      });
    }
  }

  // Check: overdue compliance filings (WARN) — inc3
  if (state.overdueFilingCount > 0) {
    const n = state.overdueFilingCount;
    flags.push({
      severity: "warn",
      title: "Overdue compliance filings",
      detail: `${n} filing${n === 1 ? " is" : "s are"} past due. Review the Compliance screen and file or mark as N/A.`,
      policyCite: "Lions Financial Transparency Policy §10",
    });
  }

  // Check: dues payment sync mismatch (WARN) — inc6a
  if (state.syncStaleTxns > 0) {
    const n = state.syncStaleTxns;
    flags.push({
      severity: "warn",
      title: "Dues payment sync mismatch",
      detail: `${n} ledger transaction${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} out of sync with ${n === 1 ? "its" : "their"} source dues payment. A dues payment was edited or deleted after the ledger row was reconciled. Review and correct these transactions manually.`,
      policyCite: "Lions Financial Transparency Policy §8",
    });
  }

  // ---------------------------------------------------------------------------
  // inc7 checks — Lions Fund-Compliance Guardrails
  // Two detection pathways extend the two-fund firewall:
  //   A. Aged public-fund balances (holding-period rule from LCI Board Policy Ch. VII)
  //   B. Public-category income posted directly to the Administrative fund
  //      (Art. VII §3(g) firewall bypass via direct income, not transfer)
  // ---------------------------------------------------------------------------

  // Check: aged public-fund balances — undisbursed public money held past the threshold (WARN) — inc7
  // Detail text gains a fund-name parenthetical when agedPublicFundNames is
  // available (Ledger Dashboard usability fix, DECISION-032) — omitted/empty
  // stays fully backward compatible with pre-dashboard callers.
  if (state.agedPublicFunds > 0) {
    const n = state.agedPublicFunds;
    const names = state.agedPublicFundNames;
    const namesSuffix = names && names.length > 0 ? ` (${names.join(", ")})` : "";
    flags.push({
      severity: "warn",
      title: `Public fund${n === 1 ? "" : "s"} holding undisbursed balance past ${state.settings.holdingPeriodWarnDays}-day threshold`,
      detail:
        `${n} public fund${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} a positive balance and ` +
        `the oldest posted income is more than ${state.settings.holdingPeriodWarnDays} days old${namesSuffix}. ` +
        `LCI guidance requires public funds to be returned to public use within a reasonable time — ` +
        `usually one year. If any of these funds are earmarked for a specific multi-year project, ` +
        `document the project name and expected disbursement date in the board meeting minutes.`,
      policyCite: "LCI Board Policy Manual Ch. VII — Public Fund Disbursement",
    });
  }

  // Check: public-sourced income posted directly to an Administrative fund (WARN) — inc7
  if (state.adminPublicIncomeCount > 0) {
    const n = state.adminPublicIncomeCount;
    flags.push({
      severity: "warn",
      title: "Public-category income posted directly to Administrative fund",
      detail:
        `${n} posted income transaction${n === 1 ? "" : "s"} in the Administrative fund ` +
        `${n === 1 ? "uses a category" : "use categories"} associated with public/activity funds. ` +
        `Public donations and fundraising proceeds must be deposited into an Activity or Charitable fund, ` +
        `not the Administrative fund. Review and reclassify these transactions.`,
      policyCite: "Standard Club Constitution Art. VII §3(g); Lions Financial Transparency Policy §6 — Two-Fund Firewall",
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// daysSinceTxnDate — Ledger Dashboard (Two-Entity Homepage)
// ---------------------------------------------------------------------------

/**
 * Whole days elapsed between a 'YYYY-MM-DD' txnDate and `now`. Used for the
 * uncashed-checks list's age column/flag. Floors (not rounds) so "today" reads 0.
 *
 * Kept as its own tiny pure function (rather than inlined in getDashboard())
 * purely for the Vitest seam — same rationale DECISION-028/029 give for
 * extracting date/money arithmetic out of DB-bound functions.
 *
 * @param txnDate  'YYYY-MM-DD' transaction date.
 * @param now      Injectable "now" for deterministic tests; defaults to `new Date()`.
 */
export function daysSinceTxnDate(txnDate: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(txnDate).getTime()) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// computeBudgetBalanceStatus — Guided Budgeting
// ---------------------------------------------------------------------------

export type BudgetBalanceStatus = {
  status: "ok" | "warn" | "info";
  /** budgetedIncomeCents - budgetedExpenseCents, always returned regardless of fund kind. */
  netCents: number;
};

/**
 * Activity fund near-zero tolerance (DECISION-042): a treasurer hand-entering
 * roughly a dozen category lines, each realistically rounded to the nearest
 * $25-$50, will rarely land on an exact $0 net by design. A flat $100 band
 * absorbs that entry-level rounding noise without masking a genuine planning
 * gap of hundreds or thousands of dollars.
 */
const ACTIVITY_BALANCE_TOLERANCE_CENTS = 10_000; // $100

/**
 * Advisory-only budget balance readout: does this fund's budgeted income
 * cover its budgeted expense, per the rule for its fund kind?
 *
 * Pure, no `@/lib/db` import — must be importable directly by the client
 * island so it recomputes live as the treasurer types, before any blur/save
 * round-trip (architect Ruling 4).
 *
 * Per-fund-kind rules:
 *   - administrative: warn if income < expense (strict `<` — equal is ok).
 *     The Club's operating fund should not plan a deficit.
 *   - activity: warn if |net| > $100 (DECISION-042); else ok. A pass-through
 *     clearing account for publicly-raised charitable money — "balanced"
 *     means planned receipts ~= planned disbursements, not exact zero.
 *   - charitable / scholarship: always info, never warn. A planned drawdown
 *     from an existing reserve/endowment is legitimate.
 *   - unrecognized fundKind: falls through to info, never throws, never warns
 *     — defensive, since `kind` is a plain string column, not a DB-enforced
 *     literal union.
 *
 * Presentation-only: no write path is gated by this function's output, now or
 * via any implicit future tightening (see Phase 3 design doc).
 *
 * @param fundKind                'administrative' | 'activity' | 'charitable' | 'scholarship' (or any string)
 * @param budgetedIncomeCents     Sum of this fund's budgeted income lines for the FY
 * @param budgetedExpenseCents    Sum of this fund's budgeted expense lines for the FY
 */
export function computeBudgetBalanceStatus(
  fundKind: string,
  budgetedIncomeCents: number,
  budgetedExpenseCents: number,
): BudgetBalanceStatus {
  const netCents = budgetedIncomeCents - budgetedExpenseCents;

  if (fundKind === "administrative") {
    return { status: budgetedIncomeCents < budgetedExpenseCents ? "warn" : "ok", netCents };
  }
  if (fundKind === "activity") {
    return {
      status: Math.abs(netCents) > ACTIVITY_BALANCE_TOLERANCE_CENTS ? "warn" : "ok",
      netCents,
    };
  }
  // charitable, scholarship, and any unrecognized fundKind: informational only.
  return { status: "info", netCents };
}

// ---------------------------------------------------------------------------
// deriveSeedLinesForFund — Guided Budgeting
// ---------------------------------------------------------------------------

export type SeedSourceLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  actualCents: number;
  /** Prior-year budget, for the fund-level actuals→budget fallback. */
  budgetCents: number | null;
};

export type SeedProposedLine = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  proposedAmountCents: number;
  source: "actual" | "prior_budget";
  /** Current target-FY value, or null if no row exists yet. */
  existingTargetAmountCents: number | null;
  /** existingTargetAmountCents !== null */
  collision: boolean;
};

/**
 * Maps a fund's prior-FY report lines into proposed seed lines for the target
 * FY. Pure — the DB-touching caller (computeSeedFromPriorYear in
 * ledger-queries.ts) does the fetching; this function only decides what to
 * propose from the data it's given, exactly the split budgetVariance() /
 * getFundReport() already establish.
 *
 * Fund-wide fallback (locked decision 1): if the fund had ANY posted actuals
 * last year (`fundHadPriorActuals`), every category is seeded from its own
 * `actualCents` — even an explicit $0 actual, which is still emitted (real
 * information: "you spent nothing on this last year"). Only when the WHOLE
 * fund shows zero actuals does the fallback flip to prior-year budgets,
 * category by category — and a category with neither actuals nor a prior
 * budget (`budgetCents === null`) is skipped entirely (a genuinely new line,
 * left blank for the treasurer to fill manually).
 *
 * Collision detection mirrors the `(fund, targetFY, category, flow)` unique
 * constraint the write path upserts against: a row already exists iff
 * `existingTargetBudgetMap` has the `${categoryId}_${flow}` key.
 *
 * @param priorLines                 Prior-FY report lines (income + expense), flow-tagged
 * @param fundHadPriorActuals         True if the fund had ANY posted income+expense last year
 * @param existingTargetBudgetMap     Map of `${categoryId}_${flow}` -> annualAmountCents already set for the target FY
 */
export function deriveSeedLinesForFund(
  priorLines: SeedSourceLine[],
  fundHadPriorActuals: boolean,
  existingTargetBudgetMap: Map<string, number>,
): SeedProposedLine[] {
  const result: SeedProposedLine[] = [];

  for (const line of priorLines) {
    const key = `${line.categoryId}_${line.flow}`;
    const existingTargetAmountCents = existingTargetBudgetMap.get(key) ?? null;
    const collision = existingTargetAmountCents !== null;

    if (fundHadPriorActuals) {
      result.push({
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        flow: line.flow,
        proposedAmountCents: line.actualCents,
        source: "actual",
        existingTargetAmountCents,
        collision,
      });
      continue;
    }

    if (line.budgetCents === null) {
      // No prior actuals fund-wide AND no prior budget for this category —
      // a genuinely new line. Leave it out entirely; the treasurer fills it
      // manually via the existing BudgetEditor, same as today's blank editor.
      continue;
    }

    result.push({
      categoryId: line.categoryId,
      categoryName: line.categoryName,
      flow: line.flow,
      proposedAmountCents: line.budgetCents,
      source: "prior_budget",
      existingTargetAmountCents,
      collision,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// validateBudgetLineInput — Guided Budgeting
// ---------------------------------------------------------------------------

const BUDGET_LINE_INT4_MAX = 2_147_483_647;

export type BudgetLineValidationInput = {
  /** null = fund not found */
  fund: { id: string; kind: string } | null;
  /** null = category not found */
  category: { id: string; fundKind: string; flow: string } | null;
  flow: "income" | "expense";
  fiscalYear: number;
  /** null = delete the row */
  annualAmountCents: number | null;
};

export type BudgetLineValidationResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 404 };

/**
 * The single validation source of truth for a budget-line write, shared by
 * both PATCH /api/admin/ledger/budgets and POST /api/admin/ledger/budgets/seed
 * via the shared upsertBudgetLine() core in ledger-queries.ts (architect
 * Ruling 1). Carries every check the original PATCH route inlined: fund
 * exists, category exists, category.fundKind matches fund.kind,
 * category.flow matches the requested flow, fiscalYear bounds, and amount
 * bounds (non-negative integer <= INT4_MAX when not null).
 *
 * Pure — takes plain pre-fetched fund/category objects instead of doing its
 * own DB reads, so it's fully unit-testable without a mocked query builder
 * (matching this repo's established pattern: budgetVariance, isGiving, etc.).
 */
export function validateBudgetLineInput(
  input: BudgetLineValidationInput,
): BudgetLineValidationResult {
  const { fund, category, flow, fiscalYear, annualAmountCents } = input;

  if (!fund) {
    return { ok: false, error: "Fund not found", status: 404 };
  }
  if (!category) {
    return { ok: false, error: "Category not found", status: 404 };
  }
  if (category.fundKind !== fund.kind) {
    return { ok: false, error: "Category does not match fund type", status: 400 };
  }
  if (category.flow !== flow) {
    return { ok: false, error: "Category flow does not match the requested flow", status: 400 };
  }
  if (
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 2000 ||
    fiscalYear > 2100
  ) {
    return {
      ok: false,
      error: "fiscalYear must be an integer between 2000 and 2100",
      status: 400,
    };
  }

  // null annualAmountCents = delete the row; no amount bounds to check.
  if (annualAmountCents === null) {
    return { ok: true };
  }

  if (!Number.isInteger(annualAmountCents) || annualAmountCents < 0) {
    return {
      ok: false,
      error: "annualAmountCents must be a non-negative integer, or null to remove the budget",
      status: 400,
    };
  }
  if (annualAmountCents > BUDGET_LINE_INT4_MAX) {
    return {
      ok: false,
      error: `annualAmountCents must not exceed ${BUDGET_LINE_INT4_MAX}`,
      status: 400,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// decideSeedWriteAction — Guided Budgeting
// ---------------------------------------------------------------------------

/**
 * The one piece of "fill-empty vs. overwrite" branching logic, isolated and
 * named so it's tested directly rather than inlined into the route handler.
 *
 *   fill-empty + no collision -> seed
 *   fill-empty + collision    -> skip
 *   overwrite  + no collision -> seed
 *   overwrite  + collision    -> overwrite
 */
export function decideSeedWriteAction(
  mode: "fill-empty" | "overwrite",
  collision: boolean,
): "seed" | "skip" | "overwrite" {
  if (mode === "fill-empty") {
    return collision ? "skip" : "seed";
  }
  return collision ? "overwrite" : "seed";
}

// ---------------------------------------------------------------------------
// isBudgetLocked — Budget Approve/Lock
// ---------------------------------------------------------------------------

/**
 * The single source of truth for "is this (entity, fiscalYear) budget
 * locked" — used both by assertBudgetUnlocked() (server-side write
 * enforcement, ledger-queries.ts) and by budgeting/page.tsx (read-only
 * rendering decision), so the page can never disagree with the write-side
 * guard about lock state. `null`/`undefined` (no approval row exists yet)
 * is unlocked by default — a fresh (entity, fiscalYear) pair with no row
 * starts editable, no backfill/migration needed on FY rollover.
 */
export function isBudgetLocked(
  approval: { status: string } | null | undefined,
): boolean {
  return approval?.status === "locked";
}

// ---------------------------------------------------------------------------
// nextCategorySortOrder — Budget Approve/Lock (inline category create)
// ---------------------------------------------------------------------------

/**
 * A brand-new category is appended to the end of its fund+flow's existing
 * sort order. Pure — the caller (POST /api/admin/ledger/categories) fetches
 * the existing active categories' sortOrder values and passes them in.
 */
export function nextCategorySortOrder(existingSortOrders: number[]): number {
  if (existingSortOrders.length === 0) {
    return 0;
  }
  return Math.max(...existingSortOrders) + 1;
}

// ---------------------------------------------------------------------------
// validateCategoryCreateInput / validateCategoryEditInput — Budget
// Approve/Lock (inline category create) + Ledger Category Management
// (rename path, 2026-08-07 / DECISION-066)
// ---------------------------------------------------------------------------

export type CategoryCreateValidationInput = {
  name: string;
  flow: string;
  /** Active category names already in scope for this (entityId, fundKind, flow) — for the case-insensitive duplicate check. */
  existingNames: string[];
};

export type CategoryCreateValidationResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 409 };

/**
 * Shared trim/length/collision core for both validateCategoryCreateInput and
 * validateCategoryEditInput, so the two validators can't drift on what "too
 * long" or "a collision" means (DECISION-066 item 2). Not exported — each
 * public validator wraps this with its own field set (create also validates
 * `flow`; edit doesn't, since PATCH never changes flow).
 *
 * Checks, in order: name required (trimmed non-empty), trimmed length <=
 * MAX_CATEGORY_NAME_LENGTH, and a case-insensitive duplicate-name check
 * against the caller-supplied `existingNames`. The caller is responsible for
 * scoping `existingNames` to (entityId, fundKind, flow) and — for an edit —
 * excluding the category's own current name, so renaming a category to its
 * own unchanged name (or fixing casing only) is never a false-positive
 * collision.
 */
function validateCategoryNameCore(
  name: string,
  existingNames: string[],
): { ok: true; trimmedName: string } | { ok: false; error: string; status: 400 | 409 } {
  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return { ok: false, error: "Category name is required.", status: 400 };
  }
  if (trimmedName.length > MAX_CATEGORY_NAME_LENGTH) {
    return {
      ok: false,
      error: `Category name must be ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.`,
      status: 400,
    };
  }

  const lowerName = trimmedName.toLowerCase();
  if (existingNames.some((existing) => existing.toLowerCase() === lowerName)) {
    return {
      ok: false,
      error: `A category named '${trimmedName}' already exists for this fund.`,
      status: 409,
    };
  }

  return { ok: true, trimmedName };
}

/**
 * Pure validation core for POST /api/admin/ledger/categories, factored out
 * so the shape/uniqueness checks are unit-testable without a DB (matching
 * validateBudgetLineInput's established split). Checks, in order: name
 * required + length-capped (via validateCategoryNameCore), flow is
 * 'income' | 'expense', and a case-insensitive duplicate-name check scoped
 * to the caller-supplied existingNames list (already scoped to
 * entityId+fundKind+flow by the caller via getCategories()).
 */
export function validateCategoryCreateInput(
  input: CategoryCreateValidationInput,
): CategoryCreateValidationResult {
  const { name, flow, existingNames } = input;

  const nameResult = validateCategoryNameCore(name, existingNames);
  if (!nameResult.ok) {
    return nameResult;
  }
  if (flow !== "income" && flow !== "expense") {
    return { ok: false, error: "flow must be 'income' or 'expense'", status: 400 };
  }

  return { ok: true };
}

export type CategoryEditValidationInput = {
  name: string;
  /**
   * Active category names already in scope for this (entityId, fundKind,
   * flow), EXCLUDING the category's own current name — the caller (PATCH
   * route / ledger-category-queries.ts) is responsible for that exclusion
   * before calling.
   */
  existingNames: string[];
};

export type CategoryEditValidationResult =
  | { ok: true; trimmedName: string }
  | { ok: false; error: string; status: 400 | 409 };

/**
 * PATCH-side twin of validateCategoryCreateInput for `PATCH
 * /api/admin/ledger/categories/[id]`'s `name` field (DECISION-066 item 2).
 * Same trimmed-length + case-insensitive-collision core as create — no
 * `flow` check, since a category's flow never changes via PATCH.
 */
export function validateCategoryEditInput(
  input: CategoryEditValidationInput,
): CategoryEditValidationResult {
  return validateCategoryNameCore(input.name, input.existingNames);
}

// ---------------------------------------------------------------------------
// validateRequiredTrimmedText — Budget Approve/Lock (shared with approve/unlock routes)
// ---------------------------------------------------------------------------

export type RequiredTrimmedTextResult =
  | { ok: true; value: string }
  | { ok: false };

/**
 * Small shared pure helper replacing the inline trim/length checks the
 * transactions-approve route already duplicates ad hoc
 * (transactions/[id]/approve/route.ts's boardMinute check). Reused by the
 * new budget approve route's `boardMinute` and the new unlock route's
 * `unlockReason`. Truncates (does not reject) text longer than `maxLen`,
 * matching that route's existing `slice(0, BOARD_MINUTE_MAX_LEN)` convention
 * rather than rejecting an over-length value.
 */
export function validateRequiredTrimmedText(
  value: string | null | undefined,
  maxLen: number = 500,
): RequiredTrimmedTextResult {
  if (!value || typeof value !== "string") {
    return { ok: false };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false };
  }
  return { ok: true, value: trimmed.slice(0, maxLen) };
}

// ---------------------------------------------------------------------------
// formatBudgetReferenceCents — Budgeting page prior-year reference columns
// (2026-07-28-budgeting-page-redesign, Increment 1)
// ---------------------------------------------------------------------------

/**
 * Formats a nullable cents value for the budgeting page's read-only
 * prior-year reference columns (Prior Budget / Prior Actual). `null` means
 * "no data" — a brand-new entity, a category that didn't exist last fiscal
 * year, or a category with no budget row last year — and renders as the same
 * "—" convention getFundReport already uses elsewhere, not a blank cell that
 * looks broken. Pure and exported so it's unit-testable without mounting
 * BudgetEditor.
 */
export function formatBudgetReferenceCents(cents: number | null): string {
  if (cents === null) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Cause/beneficiary budget-line prior-year reference
// (2026-07-28-causeline-prior-year-reference, extends the category-grain
// reference above to the cause/beneficiary lines inside a category's
// breakdown)
// ---------------------------------------------------------------------------

/**
 * Builds the lookup key used to match a cause/beneficiary budget line's
 * `(cause, label)` against a fiscal year's actual transactions grouped by
 * `(categoryId, cause, party)` — or against the prior FY's own cause lines,
 * grouped by `(categoryId, cause, label)`. Both halves of the match go
 * through the same key so a labeled line and its transaction-level
 * counterpart normalize identically.
 *
 * `categoryId` is folded in because a cause name is only unique within one
 * category's budget row (mirrors `causeLinesByBudgetId`'s keying in
 * getFundReport). `labelOrParty` is normalized with `normalizeBudgetLineLabel`
 * (trim only, no case-folding) — the same normalization a cause line's own
 * `label` already goes through, so " WARM " and "WARM" collide but "WARM" and
 * "Warm" remain distinct, matching DECISION-047's label semantics. The
 * generic/unlabeled line (`label === ""`) matches only transactions with a
 * blank/null party — it is not a catch-all for every party under that cause.
 */
export function causeLineReferenceKey(
  categoryId: string,
  cause: string,
  labelOrParty: string | null | undefined,
): string {
  return `${categoryId}::${cause}::${normalizeBudgetLineLabel(labelOrParty)}`;
}

/** One posted expense actual, pre-filtered to a non-blank `beneficiaryCause`. */
export type CauseActualSourceRow = {
  categoryId: string;
  cause: string;
  party: string | null;
  amountCents: number;
};

/**
 * Groups posted expense actuals by `(categoryId, cause, party)` into a
 * lookup map keyed by `causeLineReferenceKey` — the prior-year-ACTUAL half of
 * the cause/beneficiary budget line reference columns. Pure — no DB access;
 * the caller (getFundReport) pre-filters to posted, expense-flow rows with a
 * non-blank `beneficiaryCause` for one fund+FY. Multiple transactions with
 * the same `(categoryId, cause, party)` sum together, same as any other
 * actuals aggregation in this module.
 */
export function buildCauseActualsByKey(rows: CauseActualSourceRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const key = causeLineReferenceKey(row.categoryId, row.cause, row.party);
    map[key] = (map[key] ?? 0) + row.amountCents;
  }
  return map;
}

// ---------------------------------------------------------------------------
// isCauseLineLive — Budgeting Page Restructure (DECISION-054/056)
// ---------------------------------------------------------------------------

/**
 * Shared OR-exclusion predicate: a cause line is "live" (counts, renders,
 * survives finalize) iff NEITHER its own `pendingDeleteAt` NOR its parent
 * category's `pendingDeleteAt` is set. Category-level pending-delete never
 * cascade-writes a flag onto its children (architect Ruling 4) — this
 * predicate is what lets every read consumer (live totals, print worksheet,
 * finalize purge) treat "either flag set" as dead without any of them
 * reinventing slightly different exclusion logic. Pure, no DB access.
 */
export function isCauseLineLive(
  causeLinePendingDeleteAt: string | null,
  categoryPendingDeleteAt: string | null,
): boolean {
  return causeLinePendingDeleteAt === null && categoryPendingDeleteAt === null;
}

// ---------------------------------------------------------------------------
// computeFundLineSums — Budget soft-delete (Increment 2, DECISION-052 item 1;
// third parameter added by the Budgeting Page Restructure, DECISION-054 item 2)
// ---------------------------------------------------------------------------

/**
 * Pure core of guided-budget-setup.tsx's `fundSums()` — sums a fund's live,
 * per-line dollar values into income/expense totals for the balance badge,
 * EXCLUDING any line currently marked pending-delete. Extracted so this
 * exclusion has a Vitest seam independent of mounting the client island
 * (this repo has no component-test infra — jsdom/RTL — so UI-adjacent pure
 * logic is pulled out here the same way computeBudgetBalanceStatus already
 * is).
 *
 * This is a client-side-only projection (DECISION-052 item 1) — it has
 * nothing to do with getFundReport's own committed totals, which stay
 * completely unaffected by pending-delete until the budget is finalized.
 *
 * @param lineValues        `${categoryId}_${flow}` -> live dollar value in cents (guided-budget-setup.tsx's `lineValues[fundId]`).
 * @param pendingDeleteKeys  `${categoryId}_${flow}` -> true if that line is currently marked pending-delete (`pendingDeleteKeys[fundId]`). Missing/false = not pending-delete.
 * @param causeLinePendingCents  `${categoryId}_${flow}` -> cents to subtract from that
 *   category's rolled-up total for cause lines that are individually
 *   pending-delete on their OWN flag (their parent category is still live —
 *   if the parent were pending-delete too, `pendingDeleteKeys[key]` already
 *   `continue`s the whole category above, so no double-subtraction).
 *   `annualAmountCents` is never decremented for a pending cause line
 *   (architect Ruling 1 — "restore brings the number back exactly by
 *   construction"), so without this third param a still-live category's
 *   `lineValues[key]` would silently include a dead cause line's dollars.
 *   Defaulted to `{}` for backward compatibility with existing callers.
 */
export function computeFundLineSums(
  lineValues: Record<string, number>,
  pendingDeleteKeys: Record<string, boolean> = {},
  causeLinePendingCents: Record<string, number> = {},
): { incomeCents: number; expenseCents: number } {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const [key, cents] of Object.entries(lineValues)) {
    if (pendingDeleteKeys[key]) continue;
    const adjusted = cents - (causeLinePendingCents[key] ?? 0);
    if (key.endsWith("_income")) incomeCents += adjusted;
    else if (key.endsWith("_expense")) expenseCents += adjusted;
  }
  return { incomeCents, expenseCents };
}

// ---------------------------------------------------------------------------
// computeFundPlanSums — Budgeting Overview/Drill-Down Restructure (DECISION-060)
// ---------------------------------------------------------------------------

/** Minimal shape computeFundPlanSums needs from one fund's committed budget
 *  lines — a structural subset of FundSetupItem['budgetEditorLines'][number]
 *  (guided-budget-setup.tsx / budget-fund-editor.tsx), so callers can pass
 *  either type without an explicit cast. */
export type FundPlanSumLine = {
  categoryId: string;
  flow: "income" | "expense";
  budgetCents: number | null;
  pendingDeleteAt: string | null;
  causeLines: { pendingDeleteAt?: string | null; amountCents: number }[] | null;
};

/**
 * Sums ONE fund's committed (server-sourced) budget lines into income/expense
 * totals, correctly excluding pending-delete lines and pending-delete cause
 * lines under a still-live parent — the same three-step recipe
 * guided-budget-setup.tsx's seedLineValues/seedPendingDeleteKeys/
 * seedCauseLinePendingCents build for its LIVE, client-typed maps, ported
 * here to operate on static server data in one pass.
 *
 * DECISION-060: promoted from B-31's originally-planned print-private
 * `printFundSums` to this shared export specifically so the Budgeting
 * Overview's on-screen summary rows AND the printed board document derive
 * from the LITERAL SAME computation, fed the LITERAL SAME committed data
 * (`fund.budgetEditorLines`) — this is what makes "totals must match across
 * the overview screen, the drill-down's live editor, and the printed
 * document" true by construction, not by convention. The drill-down's live
 * editor (BudgetFundEditor) still computes its OWN sums from its own
 * live-typed maps via computeFundLineSums directly (different inputs, same
 * terminal function) — this function is only for STATIC, server-committed
 * data (the overview and print, never a live-typed client island).
 *
 * The cause-line-pending-cents step is the one easy-to-drop step (see this
 * module's own seedCauseLinePendingCents doc comment): a still-live category
 * whose budgetCents total includes dollars from an individually-deleted
 * cause line must NOT count those dollars toward the fund's total.
 *
 * Empty `lines` returns `{ incomeCents: 0, expenseCents: 0 }`.
 */
export function computeFundPlanSums(
  lines: FundPlanSumLine[],
): { incomeCents: number; expenseCents: number } {
  const lineValues: Record<string, number> = {};
  const pendingDeleteKeys: Record<string, boolean> = {};
  const causeLinePendingCents: Record<string, number> = {};

  for (const line of lines) {
    const key = `${line.categoryId}_${line.flow}`;
    lineValues[key] = line.budgetCents ?? 0;
    pendingDeleteKeys[key] = line.pendingDeleteAt !== null;
    const pending = (line.causeLines ?? []).filter((cl) => cl.pendingDeleteAt != null);
    causeLinePendingCents[key] = sumBudgetCauseLines(pending);
  }

  return computeFundLineSums(lineValues, pendingDeleteKeys, causeLinePendingCents);
}

// ---------------------------------------------------------------------------
// resolveBudgetLineDeleteAction — Budget soft-delete (Increment 2, DECISION-052/053)
// ---------------------------------------------------------------------------

/**
 * Unifies the two client-side "remove this budget line" gestures — the
 * trash/remove control and blanking an input then blurring/Enter — onto one
 * decision. Pure, no DB access, so it has its own Vitest seam
 * (DECISION-053 item 3): everything else in this increment's client logic
 * routes through a server round-trip and gets tested there instead.
 *
 * `"soft-delete"` when the row already exists server-side AND the committed
 * raw value is blank — that already-persisted row gets
 * `PATCH { pendingDelete: true }` (its amount is preserved, not cleared, so
 * Restore brings the number back exactly).
 *
 * `"create-then-delete"` (bug fix, 2026-07-30 —
 * docs/work-log/2026-07-30-budget-trash-unbudgeted.md) when the row does NOT
 * exist yet AND the raw value is blank — a category with no budget row for
 * this FY. This used to be `"noop"`, which was correct for the blank-then-
 * blur gesture (nothing was ever entered, so there's nothing to do) but was
 * ALSO silently swallowing the trash-icon click on an unbudgeted category —
 * the treasurer-reported bug. `requestRemove` (budget-editor.tsx) treats this
 * the same as `"soft-delete"` (fires the same `PATCH { pendingDelete: true }`,
 * which now lazily creates the row server-side — setBudgetLinePendingDelete,
 * ledger-queries.ts); `commitValue`'s blur/Enter path only branches on
 * `=== "soft-delete"` and falls through to its own blank-raw-value check for
 * everything else, so this rename does NOT change the blur gesture's
 * behavior — it's still a true no-op there, just under a different label.
 *
 * `"noop"` for every other combination (non-blank raw value, either
 * existing-row state) — not a delete gesture at all; the caller proceeds
 * with an ordinary amount write instead.
 *
 * `hasExistingRow` should be read directly off the line's current
 * `budgetCents !== null` (see budget-editor.tsx), which stays true even for a
 * pending-delete row (soft-delete preserves the amount) — never a separately
 * tracked "was this ever saved" flag.
 */
export function resolveBudgetLineDeleteAction(
  hasExistingRow: boolean,
  rawValue: string,
): "soft-delete" | "create-then-delete" | "noop" {
  if (rawValue.trim() !== "") return "noop";
  return hasExistingRow ? "soft-delete" : "create-then-delete";
}

// ---------------------------------------------------------------------------
// computeDuesTimingAdjustment — Budget-Balance Overview (2026-07-28)
// ---------------------------------------------------------------------------

export type DuesTimingSourceRow = {
  /** Wall-clock 'YYYY-MM-DD' date the ledger row posted (ledger_transactions.txn_date). */
  txnDate: string;
  amountCents: number;
  /** dues_payments.fiscal_year — the EXPLICIT membership year this payment is FOR (not derived from txnDate). */
  duesFiscalYear: number;
};

export type DuesTimingAdjustment = {
  fiscalYear: number;
  /** Dues income actually posted with a txnDate inside this FY — already part of getFundReport's cash-basis totalIncomeCents. */
  cashBasisDuesCents: number;
  /** Dues income re-homed to the membership year it's actually FOR, regardless of when it was received. */
  adjustedDuesCents: number;
  /** adjustedDuesCents - cashBasisDuesCents. Add to a fund's cash-basis totalIncomeCents to get its dues-adjusted total. */
  deltaCents: number;
};

/**
 * Re-homes dues-linked ledger income from "the FY it was received in" (cash
 * basis, txnDate) to "the FY it's actually FOR" (dues_payments.fiscal_year) —
 * the dues-timing adjustment for the Budget-Balance Overview banner
 * (docs/work-log/2026-07-28-budget-balance-overview.md Phase 1). Members
 * routinely pay next FY's dues (e.g. via Zeffy) before the current FY ends,
 * which inflates the FY they're received in and understates the FY they're
 * for on a strict cash basis.
 *
 * Pure — the caller (getDuesTimingAdjustment in ledger-queries.ts) fetches
 * every dues-linked posted income row for a fund, across ALL fiscal years (no
 * txnDate bound — a payment can be dated in any FY relative to the
 * membership year it's for), and this function buckets those rows against
 * the ONE fiscal year currently being viewed.
 *
 * FY-from-txnDate is derived via the (year, monthIndex, day) numeric `Date`
 * constructor on the parsed string parts — never `new Date(txnDate)` on the
 * raw ISO string, which parses as UTC and can silently shift a date-only
 * value across a month/FY boundary depending on the server's timezone (the
 * naive-timestamp-as-UTC bug that has bitten this project before).
 *
 * @param rows        Every dues-linked posted income row for the fund, any FY.
 * @param fiscalYear  The FY currently being viewed on the report page.
 */
export function computeDuesTimingAdjustment(
  rows: DuesTimingSourceRow[],
  fiscalYear: number,
): DuesTimingAdjustment {
  let cashBasisDuesCents = 0;
  let adjustedDuesCents = 0;

  for (const row of rows) {
    const [y, m, d] = row.txnDate.split("-").map(Number);
    const receivedFY = getFiscalYear(new Date(y, m - 1, d));
    if (receivedFY === fiscalYear) cashBasisDuesCents += row.amountCents;
    if (row.duesFiscalYear === fiscalYear) adjustedDuesCents += row.amountCents;
  }

  return {
    fiscalYear,
    cashBasisDuesCents,
    adjustedDuesCents,
    deltaCents: adjustedDuesCents - cashBasisDuesCents,
  };
}

// ---------------------------------------------------------------------------
// Budget Star & Notes (DECISION-057)
// ---------------------------------------------------------------------------

/**
 * Server-enforced max length (after trim) for a budget star/note annotation's
 * free-text note — shared by the category grain (ledger_budgets.note) and the
 * cause-line grain (ledger_budget_lines.note). Mirrors
 * MAX_BUDGET_LINE_LABEL_LENGTH's precedent: app-enforced only, no DB CHECK
 * (DECISION-041). See docs/work-log/2026-07-28-budget-star-notes.md Phase 3.
 */
export const MAX_BUDGET_NOTE_LENGTH = 500;

/**
 * Normalizes a budget annotation's free-text note: trims leading/trailing
 * whitespace only. Null/undefined/all-whitespace input normalizes to `""` —
 * mirrors normalizeBudgetLineLabel's trim-only discipline (this is a plain
 * working note, not a second controlled taxonomy — no case-folding).
 *
 * Pure — never throws. The DB-touching caller (setBudgetCategoryAnnotation /
 * setBudgetCauseLineAnnotation in ledger-queries.ts) is responsible for:
 *   1. Rejecting a normalized result longer than MAX_BUDGET_NOTE_LENGTH with a
 *      400 — checked BEFORE step 2, so a 501-space submission gets the length
 *      error, not a silently-accepted blank.
 *   2. Collapsing a normalized `""` result to `null` before writing — an
 *      empty note has exactly one representation (null), never a stored `""`,
 *      the same discipline `causeLines` uses for "no breakdown" (null, never
 *      `[]`).
 */
export function normalizeBudgetNote(raw: string | undefined | null): string {
  if (raw === null || raw === undefined) return "";
  return raw.trim();
}

/**
 * QA FAIL loop-back fix (Phase 5 → Phase 4, docs/work-log/2026-07-28-budget-star-notes.md;
 * DECISION-057). setBudgetCategoryAnnotation's lazy-create path writes
 * annualAmountCents: 0 to a category that had no ledger_budgets row yet,
 * purely so the row can carry a starred/note flag. That's fine at the write
 * layer (DECISION-057: no schema flag distinguishing this from a genuine $0
 * budget, code comment only) — but getFundReport was surfacing that
 * lazy-created 0 as an ordinary budgetCents: 0, and budget-editor.tsx's
 * `budgetCents !== null` display discriminator then rendered a fabricated
 * "0.00" in the amount input on every reload, exactly the "oh, it silently
 * budgeted $0" confusion Phase 1 Flow 4 required this feature to avoid.
 *
 * Discriminator, scoped EXACTLY to the annotation-only case — do NOT widen
 * this to "treat every $0 as null" generally, which would change genuine-$0
 * (v1.45.1) and itemized-$0-with-cause-lines display, both explicitly out of
 * scope for this fix:
 *
 *   annualAmountCents === 0  AND  no cause lines exist for this row  AND
 *   (starred is true  OR  note is non-null)
 *   → this row exists solely to carry the annotation; return null so every
 *     consumer (amount-input seeding, the print worksheet, live-totals
 *     seeding via computeFundLineSums) renders/sums it exactly like a truly
 *     un-budgeted category, while starred/note still surface untouched.
 *
 * Left UNCHANGED by design:
 *   - A genuine, deliberately-entered $0 budget (not starred, no note) still
 *     returns 0 (v1.45.1 behavior, unaffected).
 *   - A $0 category that has real cause-line detail underneath it (an
 *     itemized $0 breakdown) still returns 0 — the cause lines ARE the
 *     budget content, so this is not an annotation-only row.
 *
 * Pure — no DB access, called from getFundReport in ledger-queries.ts.
 */
export function resolveDisplayBudgetCents(
  rawBudgetCents: number | null,
  hasCauseLines: boolean,
  starred: boolean,
  note: string | null,
): number | null {
  if (rawBudgetCents === 0 && !hasCauseLines && (starred || note !== null)) {
    return null;
  }
  return rawBudgetCents;
}

// ---------------------------------------------------------------------------
// Explicit transaction <-> budget-line link (B-30, DECISION-061)
// docs/work-log/2026-07-30-transaction-budget-line-link.md
// ---------------------------------------------------------------------------

/**
 * Resolves ONE cause line's actual amount: the exact FK-linked sum wins
 * outright whenever it's nonzero; the fuzzy `causeLineReferenceKey` match is
 * a fallback used ONLY when there is no exact link at all. Never both summed
 * together — this is the single seam that makes "a linked transaction is
 * excluded from the fuzzy pool" true for the READ side, mirroring how
 * `isEligibleForFuzzyCauseMatch` makes it true for the pool-membership side.
 *
 * Pure — no DB access. Called once per cause line by every consumer
 * (getFundReport's causeLinesFor, computeOneMonthCashActuals's per-line
 * bucketing) rather than each re-deriving the same two-branch rule.
 */
export function resolveCauseLineActual(
  linkedCents: number,
  fallbackCents: number | null,
): { cents: number; isFuzzyFallback: boolean } {
  if (linkedCents > 0) return { cents: linkedCents, isFuzzyFallback: false };
  if (fallbackCents && fallbackCents > 0) return { cents: fallbackCents, isFuzzyFallback: true };
  return { cents: 0, isFuzzyFallback: false };
}

/**
 * A transaction is eligible to feed the fuzzy `causeLineReferenceKey` pool
 * iff it's a posted-eligible expense with a category AND a non-blank
 * `beneficiaryCause` AND it does NOT already carry an explicit
 * `budgetLineId` link. The last condition is what prevents double-counting:
 * once a transaction is linked, its dollars flow through the exact
 * `budgetLineId`-keyed aggregation only, never also through the fuzzy
 * `(categoryId, cause, party)` grouping. Pure — the caller is responsible
 * for the posted/status filter (this function doesn't see `status`).
 */
export function isEligibleForFuzzyCauseMatch(txn: {
  flow: string;
  categoryId: string | null;
  budgetLineId: string | null;
  beneficiaryCause: string | null;
}): boolean {
  return (
    txn.flow === "expense" &&
    !!txn.categoryId &&
    !txn.budgetLineId &&
    !!txn.beneficiaryCause?.trim()
  );
}

/**
 * True when a transaction's currently-linked budget line no longer applies
 * given the transaction's EFFECTIVE (post-edit) fiscal year and category —
 * i.e. the link has gone stale and must be auto-cleared server-side rather
 * than silently kept (Resolve #1 / DECISION-061 item 3). Only meaningful
 * when the transaction actually has a link; callers should no-op this check
 * entirely when `existing.budgetLineId` is null.
 */
export function shouldClearBudgetLineLink(
  linkedLineBudget: { fiscalYear: number; categoryId: string | null },
  effectiveFiscalYear: number,
  effectiveCategoryId: string | null,
): boolean {
  return (
    linkedLineBudget.fiscalYear !== effectiveFiscalYear ||
    linkedLineBudget.categoryId !== effectiveCategoryId
  );
}

/**
 * Zero-omission rule for a report row that carries One-Month / Twelve-Month
 * / Annual-Budget figures (a `MonthlyStatementCauseLine`, or any row shaped
 * like one) — true only when ALL THREE are zero/absent, never an OR across
 * columns. `annualBudgetCents === null` is treated the same as `0` (no
 * budget row at all reads identically to a deliberately-entered $0 for this
 * purpose). A nonzero figure in ANY single column keeps the row visible —
 * e.g. a line budgeted $500 with $0 spent so far must still render. Pure —
 * used for display filtering only; totals are always summed from the full,
 * unfiltered row set upstream of this filter.
 */
export function isAllZeroRow(row: {
  oneMonthCents: number;
  twelveMonthCents: number;
  annualBudgetCents: number | null;
}): boolean {
  return (
    row.oneMonthCents === 0 &&
    row.twelveMonthCents === 0 &&
    (row.annualBudgetCents === null || row.annualBudgetCents === 0)
  );
}

// ---------------------------------------------------------------------------
// matchBudgetLineForTransaction — backfill matcher (B-30, DECISION-061)
// scripts/backfill-budget-line-links.ts
// ---------------------------------------------------------------------------

export type BackfillMatchResult =
  | { status: "matched"; budgetLineId: string }
  | { status: "unmatched"; reason: "no-match" }
  | { status: "unmatched"; reason: "ambiguous"; candidateIds: string[] }
  | { status: "skipped"; reason: "no-category" };

/**
 * Pure matcher for the one-time historical backfill script. Reuses
 * `causeLineReferenceKey()`/`normalizeBudgetLineLabel()` EXACTLY — no new
 * fuzzy logic, no Levenshtein, no guessing (Chris's explicit requirement).
 * A near-miss (e.g. "Pilot Dogs" vs "Pilot Dogs, Inc.") is reported as
 * unmatched, never auto-linked.
 *
 *   - No `categoryId` at all (pre-fix reimbursement-derived rows) ->
 *     `skipped`/`no-category` — a DIFFERENT fix path (add a category via the
 *     edit form first), so the script buckets these separately from a
 *     genuine label/party mismatch.
 *   - Blank/whitespace-only `beneficiaryCause` -> `unmatched`/`no-match`
 *     (nothing to key a lookup on).
 *   - Exactly one candidate line shares this transaction's
 *     `causeLineReferenceKey` -> `matched`.
 *   - Zero candidates share it -> `unmatched`/`no-match`.
 *   - More than one candidate shares it (shouldn't happen given
 *     `(budgetId, cause, label)` uniqueness within one budget row, but
 *     defended against) -> `unmatched`/`ambiguous`, never guesses which one.
 *
 * `candidateLines` should already be pre-filtered by the caller to the
 * transaction's fund + fiscal year (via its budget row) — this function
 * doesn't see fund/FY itself, only `categoryId`/`cause`/`label` per line.
 */
// ---------------------------------------------------------------------------
// escapeIlikeTerm — Ledger & Budget Search (2026-08-06, DECISION-063)
// ---------------------------------------------------------------------------

/**
 * Escapes Postgres `LIKE`/`ILIKE` wildcard characters (`%`, `_`) and the
 * escape character itself (`\`) in a raw user-typed search term, so a term
 * containing them is matched literally rather than acting as a wildcard once
 * wrapped in `%…%` by the caller. Postgres's default `LIKE`/`ILIKE` escape
 * character is already `\`, so no explicit `ESCAPE` clause is needed at the
 * call site — escaping the term before wrapping it is sufficient.
 *
 * Order matters: backslash must be escaped first, or a term like `50%` would
 * become `50\%` and then have its new backslash re-escaped into `50\\%`,
 * corrupting the intended literal-percent match.
 *
 * No existing `ILIKE` call site in this codebase escapes its search term
 * today (`listTransactions()`'s `search` opt, `listDonors()`) — this is the
 * first ILIKE surface exposed to a treasurer typing an arbitrary term at
 * real volume, so it gets the escaping the others arguably should have too.
 * Retrofitting those is a separate, lower-priority follow-up.
 */
export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function matchBudgetLineForTransaction(
  txn: { categoryId: string | null; beneficiaryCause: string | null; party: string | null },
  candidateLines: { id: string; cause: string; label: string; categoryId: string }[],
): BackfillMatchResult {
  if (!txn.categoryId) {
    return { status: "skipped", reason: "no-category" };
  }
  const cause = (txn.beneficiaryCause ?? "").trim();
  if (!cause) {
    return { status: "unmatched", reason: "no-match" };
  }

  const targetKey = causeLineReferenceKey(txn.categoryId, cause, txn.party);
  const matches = candidateLines.filter(
    (line) =>
      line.categoryId === txn.categoryId &&
      causeLineReferenceKey(line.categoryId, line.cause, line.label) === targetKey,
  );

  if (matches.length === 0) return { status: "unmatched", reason: "no-match" };
  if (matches.length > 1) {
    return { status: "unmatched", reason: "ambiguous", candidateIds: matches.map((m) => m.id) };
  }
  return { status: "matched", budgetLineId: matches[0].id };
}

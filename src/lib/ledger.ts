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
 */

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
      causeLabel: causeKey === "" ? "Other community support" : firstSeenOriginal,
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
// guardrails
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// deriveAckType — inc6a
// ---------------------------------------------------------------------------

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

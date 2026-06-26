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
  ledgerSettings,
  ledgerReimbursements,
  ledgerFilings,
  members,
  users,
  type LedgerEntity,
  type LedgerBankAccount,
  type LedgerFund,
  type LedgerCategory,
  type LedgerTransaction,
  type LedgerSettings,
  type LedgerReimbursement,
  type LedgerFiling,
} from "@/lib/db/schema";
import { eq, and, gte, lt, ilike, or, inArray, desc, asc, isNotNull, isNull, sql } from "drizzle-orm";
import { getFiscalYear, currentFiscalYear, fiscalYearLabel } from "@/lib/fiscal-year";
import {
  fundBalanceCents,
  grossReceiptsCents,
  budgetVariance,
  guardrails,
  determine990,
  computeDueDate,
  isFilingOverdue,
  type GuardrailFlag,
  type BudgetVarianceResult,
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

// ---------------------------------------------------------------------------
// Shared return types
// ---------------------------------------------------------------------------

export type FundReportCategoryLine = {
  categoryId: string;
  categoryName: string;
  actualCents: number;
  budgetCents: number | null;
  variance: BudgetVarianceResult;
};

export type FundReport = {
  fund: LedgerFund;
  openingCents: number;
  income: FundReportCategoryLine[];
  expense: FundReportCategoryLine[];
  /** Sum of all posted income actuals */
  totalIncomeCents: number;
  /** Sum of all posted expense actuals */
  totalExpenseCents: number;
  /** Posted ending balance (openingCents + posted income - posted expense) */
  endingCents: number;
  /** Sum of pending (unposted) expense amounts — "encumbered" figure */
  pendingExpenseCents: number;
};

export type FundSummary = {
  fund: LedgerFund;
  openingCents: number;
  /** Posted income only */
  incomeCents: number;
  /** Posted expense only */
  expenseCents: number;
  /** Posted ending balance */
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
// getFunds
// ---------------------------------------------------------------------------

/**
 * Returns all active funds for an entity, ordered by name.
 */
export async function getFunds(entityId: string): Promise<LedgerFund[]> {
  return db
    .select()
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, entityId), eq(ledgerFunds.isActive, true)))
    .orderBy(ledgerFunds.name);
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
  } = {},
): Promise<LedgerTransaction[]> {
  const { fundId, fiscalYear, flow, search, status } = opts;

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
 */
export async function getFundReport(
  fundId: string,
  fiscalYear: number,
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

  // 2. Fetch transactions for this fund+FY
  const txns = await db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, end),
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

  // 5. Build lookup maps — actuals use posted transactions only (inc2: status filter)
  const budgetMap = new Map<string, number>(); // key = `${categoryId}_${flow}`
  for (const b of budgetRows) {
    if (b.categoryId) {
      budgetMap.set(`${b.categoryId}_${b.flow}`, b.annualAmountCents);
    }
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
      const budgetCents = budgetMap.get(key) ?? null;
      result.push({
        categoryId: cat.id,
        categoryName: cat.name,
        actualCents,
        budgetCents,
        variance: budgetVariance(actualCents, budgetCents),
      });
    }

    // Check for budget rows with no matching active category (shouldn't happen but be safe)
    for (const b of budgetRows) {
      if (b.categoryId && b.flow === flowFilter && !seen.has(b.categoryId)) {
        const key = `${b.categoryId}_${flowFilter}`;
        const actualCents = actualMap.get(key) ?? 0;
        result.push({
          categoryId: b.categoryId,
          categoryName: "(Unknown category)",
          actualCents,
          budgetCents: b.annualAmountCents,
          variance: budgetVariance(actualCents, b.annualAmountCents),
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
  const endingCents = fund.openingBalanceCents + totalIncomeCents - totalExpenseCents;

  return {
    fund,
    openingCents: fund.openingBalanceCents,
    income,
    expense,
    totalIncomeCents,
    totalExpenseCents,
    endingCents,
    pendingExpenseCents,
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
    const endingCents = fund.openingBalanceCents + incomeCents - expenseCents;

    return {
      fund,
      openingCents: fund.openingBalanceCents,
      incomeCents,
      expenseCents,
      endingCents,
      pendingExpenseCents,
    };
  });

  // Entity-level aggregates — gross receipts from posted income only
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
  const txnsWithoutReceipt = allTxns.filter(
    (t) => t.flow === "expense" && !t.receiptUrl,
  ).length;

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
    },
    incomeWithoutParty,
    cashDisbursements,
    txnsWithoutReceipt,
    pendingDisbursements,
    unreconciledPriorMonth,
    firewallViolations,
    // inc3 fields — passed through by getComplianceOverview(); default empty on
    // the plain overview path (so the revocation/overdue flags don't fire there).
    irsFilingHistory: inc3Inputs?.irsFilingHistory ?? [],
    overdueFilingCount: inc3Inputs?.overdueFilingCount ?? 0,
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
};

/**
 * Returns all pending-status transactions enriched with fund name and recorder
 * full name — ready for display on the Approvals screen without extra lookups.
 *
 * Ordered by txnDate ascending (oldest pending first — most urgently needs
 * board action).
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
      bankAccountId: ledgerTransactions.bankAccountId,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      receiptUrl: ledgerTransactions.receiptUrl,
      transferGroupId: ledgerTransactions.transferGroupId,
      status: ledgerTransactions.status,
      approvedByUserId: ledgerTransactions.approvedByUserId,
      approvedAt: ledgerTransactions.approvedAt,
      boardMinute: ledgerTransactions.boardMinute,
      rejectionReason: ledgerTransactions.rejectionReason,
      reconciled: ledgerTransactions.reconciled,
      reconciledAt: ledgerTransactions.reconciledAt,
      recordedByUserId: ledgerTransactions.recordedByUserId,
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

  return rows.map((r) => ({
    ...r,
    fundName: r.fundName ?? "Unknown Fund",
    recorderName: r.recorderDisplayName ?? null,
  }));
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
          });
        }
      }

      return result;
    }

    const income = buildLines("income");
    const expense = buildLines("expense");
    const totalIncomeCents = income.reduce((s, l) => s + l.actualCents, 0);
    const totalExpenseCents = expense.reduce((s, l) => s + l.actualCents, 0);
    const endingCents = fund.openingBalanceCents + totalIncomeCents - totalExpenseCents;

    fundReports.push({
      fund,
      openingCents: fund.openingBalanceCents,
      income,
      expense,
      totalIncomeCents,
      totalExpenseCents,
      endingCents,
      pendingExpenseCents,
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
};

export type PhilanthropySummary = {
  allTimeCents: number;
  currentFyCents: number;
  /** Sorted desc by totalCents; "Other community support" (causeKey='') always last. */
  byCause: PhilanthropyByCause[];
  /** Sorted desc by fiscalYear (most recent first). */
  byFiscalYear: PhilanthropyByFY[];
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
 *
 * Administrative fund rows (kind='administrative') are excluded by omission
 * from the IN list — never appear in philanthropy totals (DECISION: see Phase 3
 * design doc, docs/work-log/2026-06-25-ledger-impact.md).
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
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.status, "posted"),
        isNull(ledgerTransactions.transferGroupId),
        eq(ledgerTransactions.flow, "expense"),
        inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
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

  // causeKey → { totalCents, firstSeenOriginal }
  const causeMap = new Map<string, { totalCents: number; firstSeenOriginal: string }>();
  // fiscalYear (number) → totalCents
  const fyMap = new Map<number, number>();

  for (const row of givingRows) {
    allTimeCents += row.amountCents;

    // Current-FY filter
    const rowFY = getFiscalYear(parseYMD(row.txnDate));
    if (rowFY === currentFY) {
      currentFyCents += row.amountCents;
    }

    // By-cause grouping: normalize to lower-trimmed key; null/empty → ''
    const rawCause = row.beneficiaryCause;
    const causeKey =
      rawCause === null || rawCause.trim() === ""
        ? ""
        : rawCause.trim().toLowerCase();
    const existing = causeMap.get(causeKey);
    if (existing) {
      existing.totalCents += row.amountCents;
    } else {
      // First-seen original casing: '' key uses fixed label; others use original value.
      causeMap.set(causeKey, {
        totalCents: row.amountCents,
        firstSeenOriginal: causeKey === "" ? "" : rawCause!.trim(),
      });
    }

    // By-FY grouping
    fyMap.set(rowFY, (fyMap.get(rowFY) ?? 0) + row.amountCents);
  }

  // Build byCause: sort desc by totalCents; '' key always last
  const byCause: PhilanthropyByCause[] = Array.from(causeMap.entries())
    .map(([causeKey, { totalCents, firstSeenOriginal }]) => ({
      causeKey,
      causeLabel: causeKey === "" ? "Other community support" : firstSeenOriginal,
      totalCents,
      pct: allTimeCents > 0 ? Math.round((totalCents / allTimeCents) * 1000) / 10 : 0,
    }))
    .sort((a, b) => {
      // '' key (Other community support) always sorts to the end
      if (a.causeKey === "" && b.causeKey !== "") return 1;
      if (b.causeKey === "" && a.causeKey !== "") return -1;
      return b.totalCents - a.totalCents;
    });

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
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.status, "posted"),
        isNull(ledgerTransactions.transferGroupId),
        eq(ledgerTransactions.flow, "expense"),
        inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
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
  }));

  return {
    allTimeCents,
    currentFyCents,
    byCause,
    byFiscalYear,
    recentGifts,
  };
}

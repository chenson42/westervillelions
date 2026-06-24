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
  type LedgerEntity,
  type LedgerBankAccount,
  type LedgerFund,
  type LedgerCategory,
  type LedgerTransaction,
  type LedgerSettings,
} from "@/lib/db/schema";
import { eq, and, gte, lt, ilike, or, inArray, desc } from "drizzle-orm";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";
import {
  fundBalanceCents,
  grossReceiptsCents,
  budgetVariance,
  guardrails,
  determine990,
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
  /** Sum of all income actuals */
  totalIncomeCents: number;
  /** Sum of all expense actuals */
  totalExpenseCents: number;
  endingCents: number;
};

export type FundSummary = {
  fund: LedgerFund;
  openingCents: number;
  incomeCents: number;
  expenseCents: number;
  endingCents: number;
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
 * No N+1: single query with optional WHERE clauses.
 */
export async function listTransactions(
  entityId: string,
  opts: {
    fundId?: string;
    fiscalYear?: number;
    flow?: "income" | "expense";
    search?: string;
  } = {},
): Promise<LedgerTransaction[]> {
  const { fundId, fiscalYear, flow, search } = opts;

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

  // 5. Build lookup maps
  const budgetMap = new Map<string, number>(); // key = `${categoryId}_${flow}`
  for (const b of budgetRows) {
    if (b.categoryId) {
      budgetMap.set(`${b.categoryId}_${b.flow}`, b.annualAmountCents);
    }
  }

  const actualMap = new Map<string, number>(); // key = `${categoryId}_${flow}`
  for (const txn of txns) {
    if (txn.categoryId) {
      const key = `${txn.categoryId}_${txn.flow}`;
      actualMap.set(key, (actualMap.get(key) ?? 0) + txn.amountCents);
    }
  }

  // 6. Collect category IDs that appear in actuals but not the active category list
  //    (e.g. category was deactivated after transactions were recorded — still show it)
  const categoryIds = new Set(categories.map((c) => c.id));
  const extraCategoryIds = new Set<string>();
  for (const txn of txns) {
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

  // Group by fundId
  const txnsByFund = new Map<string, typeof allTxns>();
  for (const fund of funds) txnsByFund.set(fund.id, []);
  for (const txn of allTxns) {
    const arr = txnsByFund.get(txn.fundId);
    if (arr) arr.push(txn);
  }

  // Build fund summaries
  const fundSummaries: FundSummary[] = funds.map((fund) => {
    const txns = txnsByFund.get(fund.id) ?? [];
    const incomeCents = txns
      .filter((t) => t.flow === "income")
      .reduce((s, t) => s + t.amountCents, 0);
    const expenseCents = txns
      .filter((t) => t.flow === "expense")
      .reduce((s, t) => s + t.amountCents, 0);
    const endingCents = fund.openingBalanceCents + incomeCents - expenseCents;
    return {
      fund,
      openingCents: fund.openingBalanceCents,
      incomeCents,
      expenseCents,
      endingCents,
    };
  });

  // Entity-level aggregates
  const entityBalance = fundSummaries.reduce((s, f) => s + f.endingCents, 0);
  const incomeTxns = allTxns.filter((t) => t.flow === "income");
  const grossReceipts = grossReceiptsCents(incomeTxns);

  // Guardrail inputs
  const settings = await getSettings();
  const incomeWithoutParty = allTxns.filter(
    (t) => t.flow === "income" && (!t.party || t.party.trim() === ""),
  ).length;
  const cashDisbursements = allTxns.filter(
    (t) => t.flow === "expense" && t.paymentMethod === "cash",
  ).length;
  const txnsWithoutReceipt = allTxns.filter(
    (t) => t.flow === "expense" && !t.receiptUrl,
  ).length;

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
  const { sql } = await import("drizzle-orm");

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

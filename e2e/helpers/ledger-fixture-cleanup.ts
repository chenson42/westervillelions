/**
 * Shared cleanup for the ledger/budgeting e2e suites that run against
 * dedicated, never-otherwise-used sentinel fiscal years (FY2095/2096/2097/
 * 2098/2099) on the real dev DB (`DATABASE_URL`, never prod — see
 * `.env.local`).
 *
 * Background (2026-09-09 test-coverage review, remediation): four suites —
 * budget-star-notes.spec.ts, budgeting-restructure.spec.ts,
 * prior-year-cause-line-reconcile.spec.ts, and
 * transaction-budget-line-link.spec.ts — each documented that their sentinel
 * fixture data was "intentionally left in place" with no cleanup path short
 * of a direct DB delete, and one of them (budget-star-notes) claimed a
 * cleanup step existed but was never actually implemented anywhere. Weeks of
 * accumulated leftover rows from prior runs then broke every one of these
 * suites' "starts from blank" assumptions on the very first test. This
 * module gives each suite that direct DB delete, called from both a
 * `beforeAll` (idempotent — cleans up whatever a prior, possibly-crashed run
 * left behind before this run's fixtures are created) and an `afterAll`
 * (cleans up what THIS run created, pass or fail — Playwright always runs
 * `afterAll` hooks registered in a `describe` block regardless of test
 * outcome, which is exactly the "leaves the DB as it found it" guarantee
 * these suites need).
 *
 * Deliberately entity+fiscalYear scoped, never a bare `fiscalYear` filter —
 * budgeting-restructure.spec.ts and transaction-budget-line-link.spec.ts
 * both live on the Foundation entity while budget-star-notes.spec.ts lives
 * on the Club entity, and FY2099 is used by both; an unscoped delete would
 * cross-contaminate two independent suites' fixtures.
 */
import { db } from "../../src/lib/db";
import {
  ledgerBudgets,
  ledgerBudgetApprovals,
  ledgerBudgetNotes,
  ledgerCategories,
  ledgerTransactions,
} from "../../src/lib/db/schema";
import { and, eq, ilike, inArray } from "drizzle-orm";

export interface BudgetFixtureCleanupParams {
  /** Entity these fixtures belong to (Club or Foundation ledger_entities.id). */
  entityId: string;
  /** Sentinel fiscal years this suite owns (e.g. [2099]). */
  fiscalYears: number[];
  /**
   * Exact category names this suite creates at runtime via
   * POST /api/admin/ledger/categories (ledger_categories has no fiscalYear
   * column, so these can't be cleaned up by the fiscalYear deletes above —
   * they're permanent catalog rows unless deleted by name).
   */
  categoryNames?: string[];
  /** Category-name prefixes (e.g. a suite that suffixes with Date.now()). */
  categoryNamePrefixes?: string[];
  /**
   * ledger_transactions.party prefixes this suite creates directly (e.g.
   * "E2E QA B30") — transactions aren't cascade-deleted by removing their
   * linked budget line (budgetLineId is ON DELETE SET NULL by design, so a
   * collapsed/removed budget line never orphans a real transaction), so they
   * need their own explicit delete.
   */
  transactionPartyPrefixes?: string[];
}

/**
 * Deletes every row this suite's fixture is documented to create, scoped to
 * (entityId, fiscalYears). Safe to call from both `beforeAll` and `afterAll`
 * — every delete is a no-op if nothing matches, which is exactly what
 * "idempotent" requires here.
 */
export async function cleanupBudgetFixture(params: BudgetFixtureCleanupParams): Promise<void> {
  const {
    entityId,
    fiscalYears,
    categoryNames = [],
    categoryNamePrefixes = [],
    transactionPartyPrefixes = [],
  } = params;

  // Transactions first — no FK ordering requirement (budgetLineId is SET
  // NULL on the budget line's deletion either way), but doing this first
  // keeps the fixture's own dependency direction (transaction references
  // budget line, not the other way around) explicit in the delete order.
  for (const prefix of transactionPartyPrefixes) {
    await db
      .delete(ledgerTransactions)
      .where(and(eq(ledgerTransactions.entityId, entityId), ilike(ledgerTransactions.party, `${prefix}%`)));
  }

  if (fiscalYears.length > 0) {
    await db
      .delete(ledgerBudgetApprovals)
      .where(and(eq(ledgerBudgetApprovals.entityId, entityId), inArray(ledgerBudgetApprovals.fiscalYear, fiscalYears)));

    await db
      .delete(ledgerBudgetNotes)
      .where(and(eq(ledgerBudgetNotes.entityId, entityId), inArray(ledgerBudgetNotes.fiscalYear, fiscalYears)));

    // ledger_budget_lines.budget_id -> ledger_budgets.id is ON DELETE CASCADE
    // (schema.ts), so deleting the parent row is sufficient to remove every
    // cause-line child too.
    await db
      .delete(ledgerBudgets)
      .where(and(eq(ledgerBudgets.entityId, entityId), inArray(ledgerBudgets.fiscalYear, fiscalYears)));
  }

  if (categoryNames.length > 0) {
    await db
      .delete(ledgerCategories)
      .where(and(eq(ledgerCategories.entityId, entityId), inArray(ledgerCategories.name, categoryNames)));
  }

  for (const prefix of categoryNamePrefixes) {
    await db
      .delete(ledgerCategories)
      .where(and(eq(ledgerCategories.entityId, entityId), ilike(ledgerCategories.name, `${prefix}%`)));
  }
}

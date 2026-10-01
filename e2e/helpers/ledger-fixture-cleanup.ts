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
  ledgerAuditLog,
  ledgerBudgets,
  ledgerBudgetApprovals,
  ledgerBudgetNotes,
  ledgerCategories,
  ledgerReconciliationSessions,
  ledgerTransactions,
} from "../../src/lib/db/schema";
import { and, eq, ilike, inArray, or } from "drizzle-orm";

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

/**
 * Every row, session and audit entry created by
 * e2e/ledger-move-transaction.spec.ts carries this tag: transaction parties
 * start with it, and every correction reason typed into the Move/Delete
 * dialogs (or sent to the API) contains it.
 */
export const MOVE_FIXTURE_TAG = "E2E QA Move";

/** csv_filename stamped on the fixture closed reconciliation session. */
export const MOVE_FIXTURE_SESSION_CSV = "E2E-QA-Move-fixture.csv";

/**
 * Cleanup for the move/delete-correction suite (DECISION-109/110). Safe from
 * both `beforeAll` and `afterAll` (every delete is a no-op when nothing
 * matches).
 *
 * Audit rows MUST be removed explicitly: `ledger_audit_log.target_transaction_id`
 * is ON DELETE SET NULL, so deleting a transaction never removes its audit row,
 * and a `transaction_deleted` row has no target at all. They are matched by the
 * tag in the reason text (`details`) — never by actor or time — so this can
 * only ever remove rows this suite wrote.
 *
 * Acknowledgments cascade with their transaction (ON DELETE CASCADE).
 * Order: audit rows, then transactions, then the fixture session.
 */
export async function cleanupMoveTransactionFixtures(): Promise<void> {
  await db
    .delete(ledgerAuditLog)
    .where(
      and(
        inArray(ledgerAuditLog.action, ["transaction_fund_moved", "transaction_deleted"]),
        or(
          ilike(ledgerAuditLog.details, `%${MOVE_FIXTURE_TAG}%`),
          ilike(ledgerAuditLog.before, `%${MOVE_FIXTURE_TAG}%`),
        ),
      ),
    );
  await db.delete(ledgerTransactions).where(ilike(ledgerTransactions.party, `${MOVE_FIXTURE_TAG}%`));
  await db
    .delete(ledgerReconciliationSessions)
    .where(eq(ledgerReconciliationSessions.csvFilename, MOVE_FIXTURE_SESSION_CSV));
}

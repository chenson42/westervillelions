/**
 * DB orchestration for moving a ledger row to another fund (DECISION-109/111,
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md).
 *
 * `previewFundMove()` (GET) and `executeFundMove()` (POST) share ONE evaluator
 * (`evaluateFundMove()` for the row state and tier, `evaluateDestination()` for
 * the bank-account assertion and the direction policy), so the dialog can
 * never show a green preview the server then refuses. The preview reads
 * without a lock; execute runs the same evaluator on the `SELECT ... FOR
 * UPDATE` row inside `db.transaction`, so the permission tier is derived from
 * the locked row and a concurrent reconcile cannot slip a row between tiers.
 *
 * Writes nothing outside the transaction, sends no email, and never touches
 * financial_report_sends (read-only: a changed total flips the existing
 * "Resend Corrected Statement" panel on its own).
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerFunds,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerSettings,
  financialReportSends,
  type LedgerFund,
  type LedgerTransaction,
} from "@/lib/db/schema";
import { checkFundMove } from "@/lib/ledger-fund-move-policy";
import {
  LOCK_COPY,
  isTransactionReconciled,
  moveBlockKind,
  requiredMoveTier,
} from "@/lib/ledger-transaction-lock";
import { validateCategoryForFund } from "@/lib/ledger-transaction-validation";
import { recordLedgerAudit } from "@/lib/ledger-audit";
import {
  MANAGE_REQUIRED_MESSAGE,
  STALE_MOVE_MESSAGE,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  REASON_LIMITS,
  buildMoveWarnings,
  type MoveDestinationDenialCode,
  type MoveErrorCode,
  type MoveInput,
  type MovePreview,
  type MoveResponse,
} from "@/lib/ledger-correction";
import {
  PUBLIC_DONATIONS_CATEGORY_NAME,
  agedPublicFundCutoffDate,
  fundBalanceCents,
} from "@/lib/ledger";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";
import { MEMBER_EXPOSED_FUND_KINDS, monthBounds } from "@/lib/financial-report-queries";

type SelectExec = Pick<typeof db, "select">;

export type MoveFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: MoveErrorCode;
  error: string;
};

function fail(status: MoveFailure["status"], code: MoveErrorCode, error: string): MoveFailure {
  return { ok: false, status, code, error };
}

const MOVE_BLOCK_MESSAGES: Record<
  "approved" | "rejected" | "pending" | "dues_synced" | "transfer_leg",
  string
> = {
  approved: "Approved transactions cannot be moved. Record a refund entry to correct one.",
  rejected: `Rejected transactions cannot be moved. ${LOCK_COPY.rejected.nextStep}`,
  pending: `A transaction awaiting approval cannot be moved. ${LOCK_COPY.pending.nextStep}`,
  dues_synced: `Entries posted from dues payments cannot be moved. ${LOCK_COPY.dues_synced.nextStep}`,
  transfer_leg: `Transfer entries cannot be moved. ${LOCK_COPY.transfer_leg.nextStep}`,
};

const BANK_ENTITY_MISMATCH_MESSAGE =
  "This entry's bank account does not belong to the destination fund's entity.";

// ---------------------------------------------------------------------------
// Shared evaluator
// ---------------------------------------------------------------------------

async function loadFund(exec: SelectExec, fundId: string): Promise<LedgerFund | undefined> {
  const rows = await exec.select().from(ledgerFunds).where(eq(ledgerFunds.id, fundId)).limit(1);
  return rows[0];
}

type BankInfo = { name: string; entityId: string } | null | "missing";

/** null = the row has no bank account; "missing" = it names one that no longer resolves. */
async function loadBank(exec: SelectExec, row: LedgerTransaction): Promise<BankInfo> {
  if (!row.bankAccountId) return null;
  const rows = await exec
    .select({ name: ledgerBankAccounts.name, entityId: ledgerBankAccounts.entityId })
    .from(ledgerBankAccounts)
    .where(eq(ledgerBankAccounts.id, row.bankAccountId))
    .limit(1);
  return rows[0] ?? "missing";
}

/** Row state block, then the permission tier, evaluated on the row it is given. */
export async function evaluateFundMove(
  exec: SelectExec,
  args: { row: LedgerTransaction; callerCanManage: boolean; now: Date },
): Promise<
  | {
      ok: true;
      tier: "record" | "manage";
      reasons: Array<"reconciled" | "prior_fiscal_year">;
      source: LedgerFund;
    }
  | MoveFailure
> {
  const { row } = args;
  const block = moveBlockKind(row);
  if (block) return fail(403, block, MOVE_BLOCK_MESSAGES[block]);

  const { tier, reasons } = requiredMoveTier(row, args.now);
  if (tier === "manage" && !args.callerCanManage) {
    return fail(403, "manage_required", MANAGE_REQUIRED_MESSAGE);
  }

  const source = await loadFund(exec, row.fundId);
  if (!source) return fail(404, "fund_not_found", "The entry's current fund was not found.");
  return { ok: true, tier, reasons, source };
}

/** Bank-account entity assertion, then the direction policy, for one destination. */
export function evaluateDestination(args: {
  row: LedgerTransaction;
  source: LedgerFund;
  dest: LedgerFund;
  bank: BankInfo;
}): { ok: true } | MoveFailure {
  const { row, source, dest, bank } = args;
  if (bank !== null && (bank === "missing" || bank.entityId !== dest.entityId)) {
    return fail(409, "bank_account_entity_mismatch", BANK_ENTITY_MISMATCH_MESSAGE);
  }
  const decision = checkFundMove({
    flow: row.flow,
    from: { entityId: source.entityId, fundId: source.id, kind: source.kind },
    to: { entityId: dest.entityId, fundId: dest.id, kind: dest.kind },
  });
  if (!decision.allowed) {
    return fail(decision.code === "same_fund" ? 409 : 403, decision.code, decision.reason);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sent-statement lookup (read-only)
// ---------------------------------------------------------------------------

/**
 * "YYYY-MM" of the row's month when a SUCCESSFUL statement send exists for the
 * entity and that month AND the fund kind is member-exposed; otherwise null.
 * Read-only: writes nothing, sends nothing.
 */
export async function findSentStatementMonth(
  exec: SelectExec,
  args: { entityId: string; txnDate: string; fundKind: string },
): Promise<string | null> {
  if (!(MEMBER_EXPOSED_FUND_KINDS as readonly string[]).includes(args.fundKind)) return null;
  const ym = args.txnDate.slice(0, 7);
  let monthEnd: string;
  try {
    monthEnd = monthBounds(ym).monthEnd;
  } catch {
    return null;
  }
  const rows = await exec
    .select({ id: financialReportSends.id })
    .from(financialReportSends)
    .where(
      and(
        eq(financialReportSends.entityId, args.entityId),
        eq(financialReportSends.monthEnd, monthEnd),
        eq(financialReportSends.success, true),
      ),
    )
    .limit(1);
  return rows[0] ? ym : null;
}

// ---------------------------------------------------------------------------
// Preview (GET)
// ---------------------------------------------------------------------------

async function postedBalance(
  exec: SelectExec,
  fund: LedgerFund,
): Promise<{ rows: Array<{ id: string; flow: string; amountCents: number }> }> {
  const rows = await exec
    .select({
      id: ledgerTransactions.id,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
    })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.fundId, fund.id), eq(ledgerTransactions.status, "posted")));
  return { rows };
}

export async function previewFundMove(args: {
  transactionId: string;
  callerCanManage: boolean;
  now?: Date;
}): Promise<{ ok: true; preview: MovePreview } | MoveFailure> {
  const now = args.now ?? new Date();
  const rows = await db
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.id, args.transactionId))
    .limit(1);
  const row = rows[0];
  if (!row) return fail(404, "not_found", "Transaction not found");

  const ev = await evaluateFundMove(db, { row, callerCanManage: args.callerCanManage, now });
  if (!ev.ok) return ev;
  const { source } = ev;

  const entityFunds = await db
    .select()
    .from(ledgerFunds)
    .where(eq(ledgerFunds.entityId, source.entityId))
    .orderBy(asc(ledgerFunds.name));
  const bank = await loadBank(db, row);

  let categoryName: string | null = null;
  if (row.categoryId) {
    const cat = await db
      .select({ name: ledgerCategories.name })
      .from(ledgerCategories)
      .where(eq(ledgerCategories.id, row.categoryId))
      .limit(1);
    categoryName = cat[0]?.name ?? null;
  }

  const destinations: MovePreview["destinations"] = [];
  let sourceRows: Array<{ id: string; flow: string; amountCents: number }> | null = null;
  for (const fund of entityFunds) {
    if (fund.id === source.id) continue;
    const decision = evaluateDestination({ row, source, dest: fund, bank });
    if (!decision.ok) {
      destinations.push({
        fundId: fund.id,
        name: fund.name,
        kind: fund.kind,
        allowed: false,
        denial: { code: decision.code as MoveDestinationDenialCode, reason: decision.error },
      });
      continue;
    }

    const categoryRows = await db
      .select({ id: ledgerCategories.id, name: ledgerCategories.name })
      .from(ledgerCategories)
      .where(
        and(
          eq(ledgerCategories.entityId, fund.entityId),
          eq(ledgerCategories.fundKind, fund.kind),
          eq(ledgerCategories.flow, row.flow),
          eq(ledgerCategories.isActive, true),
        ),
      )
      .orderBy(asc(ledgerCategories.sortOrder), asc(ledgerCategories.name));
    const defaultCategory = categoryRows.find((c) => c.name === PUBLIC_DONATIONS_CATEGORY_NAME);

    if (!sourceRows) sourceRows = (await postedBalance(db, source)).rows;
    const destRows = (await postedBalance(db, fund)).rows;
    const sourceBefore = fundBalanceCents(source.openingBalanceCents, sourceRows);
    const sourceAfter = fundBalanceCents(
      source.openingBalanceCents,
      sourceRows.filter((r) => r.id !== row.id),
    );
    const destBefore = fundBalanceCents(fund.openingBalanceCents, destRows);
    const destAfter = fundBalanceCents(fund.openingBalanceCents, [
      ...destRows,
      { id: row.id, flow: row.flow, amountCents: row.amountCents },
    ]);

    destinations.push({
      fundId: fund.id,
      name: fund.name,
      kind: fund.kind,
      allowed: true,
      categories: categoryRows,
      defaultCategoryId: defaultCategory?.id ?? null,
      impact: {
        sourceFund: { name: source.name, beforeCents: sourceBefore, afterCents: sourceAfter },
        destFund: { name: fund.name, beforeCents: destBefore, afterCents: destAfter },
        bankAccount: { name: bank && bank !== "missing" ? bank.name : null, changeCents: 0 },
      },
    });
  }

  const settingsRows = await db.select().from(ledgerSettings).limit(1);
  const holdingDays = settingsRows[0]?.holdingPeriodWarnDays ?? 365;
  const sentStatementMonth = await findSentStatementMonth(db, {
    entityId: row.entityId,
    txnDate: row.txnDate,
    fundKind: source.kind,
  });
  const bankName = bank && bank !== "missing" ? bank.name : null;

  const warnings = buildMoveWarnings({
    anyDestinationAllowed: destinations.some((d) => d.allowed),
    tierReasons: ev.reasons,
    sentStatementMonth,
    aged: row.txnDate < agedPublicFundCutoffDate(holdingDays, now),
    bankAccountName: bankName,
  });

  return {
    ok: true,
    preview: {
      transaction: {
        id: row.id,
        txnDate: row.txnDate,
        flow: row.flow as "income" | "expense",
        amountCents: row.amountCents,
        party: row.party,
        fiscalYear: getFiscalYear(new Date(row.txnDate + "T00:00:00")),
        reconciled: isTransactionReconciled(row),
        fundId: source.id,
        fundName: source.name,
        fundKind: source.kind,
        categoryId: row.categoryId,
        categoryName,
        bankAccountId: row.bankAccountId,
        bankAccountName: bankName,
      },
      tier: { required: ev.tier, reasons: ev.reasons },
      destinations,
      warnings,
      reasonLimits: { min: REASON_LIMITS.min, max: REASON_LIMITS.max },
    },
  };
}

// ---------------------------------------------------------------------------
// Execute (POST)
// ---------------------------------------------------------------------------

/**
 * Run the whole move in one transaction. The FIRST statement is the row lock;
 * every guard is re-validated on the locked row; the audit row is written on
 * the same `tx` AFTER the update. A refusal returns a MoveFailure having
 * written nothing; a thrown error (including a failed audit insert) rolls the
 * transaction back and propagates so the route can answer 500.
 */
export async function executeFundMove(args: {
  transactionId: string;
  actorUserId: string;
  callerCanManage: boolean;
  input: MoveInput;
  now?: Date;
}): Promise<{ ok: true; result: MoveResponse } | MoveFailure> {
  const now = args.now ?? new Date();
  const { input } = args;

  return db.transaction(async (tx) => {
    const locked = (
      await tx
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, args.transactionId))
        .for("update")
    )[0];
    if (!locked) return fail(404, "not_found", "Transaction not found");

    const ev = await evaluateFundMove(tx, {
      row: locked,
      callerCanManage: args.callerCanManage,
      now,
    });
    if (!ev.ok) return ev;
    const { source } = ev;

    if (input.expectedFundId !== locked.fundId) {
      return fail(409, "stale", STALE_MOVE_MESSAGE);
    }

    const dest = await loadFund(tx, input.destFundId);
    if (!dest) return fail(404, "fund_not_found", "Destination fund not found");

    const bank = await loadBank(tx, locked);
    const decision = evaluateDestination({ row: locked, source, dest, bank });
    if (!decision.ok) return decision;

    let afterCategory: { id: string; name: string } | null = null;
    if (input.categoryId !== null) {
      const cat = await validateCategoryForFund(
        tx,
        input.categoryId,
        { entityId: dest.entityId, kind: dest.kind },
        locked.flow,
        { requireActive: true },
      );
      if (!cat.ok) {
        return fail(
          cat.status,
          cat.code === "category_not_found" ? "category_not_found" : "category_invalid",
          cat.error,
        );
      }
      afterCategory = { id: cat.category.id, name: cat.category.name ?? "" };
    }

    let beforeCategory: { id: string; name: string } | null = null;
    if (locked.categoryId) {
      const rows = await tx
        .select({ name: ledgerCategories.name })
        .from(ledgerCategories)
        .where(eq(ledgerCategories.id, locked.categoryId))
        .limit(1);
      beforeCategory = { id: locked.categoryId, name: rows[0]?.name ?? "" };
    }

    const sentStatementMonth = await findSentStatementMonth(tx, {
      entityId: locked.entityId,
      txnDate: locked.txnDate,
      fundKind: source.kind,
    });

    const updated = await tx
      .update(ledgerTransactions)
      .set({
        fundId: dest.id,
        categoryId: input.categoryId,
        budgetLineId: null,
        updatedAt: now,
      })
      .where(and(eq(ledgerTransactions.id, locked.id), eq(ledgerTransactions.fundId, locked.fundId)))
      .returning({ id: ledgerTransactions.id });
    if (updated.length === 0) return fail(409, "stale", STALE_MOVE_MESSAGE);

    const fiscalYear = getFiscalYear(new Date(locked.txnDate + "T00:00:00"));
    await recordLedgerAudit(tx, {
      actorUserId: args.actorUserId,
      action: TRANSACTION_FUND_MOVED_AUDIT_ACTION,
      targetTransactionId: locked.id,
      before: {
        v: 1,
        fund: { id: source.id, name: source.name, slug: source.slug, kind: source.kind },
        category: beforeCategory,
        budgetLineId: locked.budgetLineId,
      },
      after: {
        v: 1,
        fund: { id: dest.id, name: dest.name, slug: dest.slug, kind: dest.kind },
        category: afterCategory,
        budgetLineId: null,
      },
      details: {
        v: 1,
        reason: input.reason,
        entityId: locked.entityId,
        txnDate: locked.txnDate,
        flow: locked.flow as "income" | "expense",
        amountCents: locked.amountCents,
        fiscalYear,
        tier: ev.tier,
        reconciled: isTransactionReconciled(locked),
        reconciledSessionId: locked.reconciledSessionId,
        priorFiscalYear: fiscalYear < currentFiscalYear(now),
        sentStatementMonth,
      },
    });

    return {
      ok: true as const,
      result: {
        id: locked.id,
        fundId: dest.id,
        fundSlug: dest.slug,
        fundName: dest.name,
        categoryId: input.categoryId,
        categoryName: afterCategory?.name ?? null,
        sweepSuggested: dest.kind === "activity" && locked.flow === "income",
      },
    };
  });
}

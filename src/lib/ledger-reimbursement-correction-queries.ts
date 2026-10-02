/**
 * DB orchestration for repairing / correcting a PAID REIMBURSEMENT's ledger row
 * (B-108 / DECISION-114, docs/work-log/2026-10-02-reimbursement-reconcilable.md).
 * Sibling of ./ledger-fund-move-queries.ts and built the same way:
 * `previewCorrection()` (GET) and `executeCorrection()` (POST) share ONE
 * evaluator (`checkCorrectable`, `evaluateFill`, `evaluateCorrect`), so what the
 * dialog is told is allowed is what the write will do.
 *
 * Guard order, identical for GET and POST (a refusal reports only the first
 * applicable row):
 *   4 row (POST: FOR UPDATE, the FIRST statement)   5 not_correctable
 *   6 own_request   7 stale (POST)   8 state on the locked row   9 no_change
 *   10 tier   11 semantic input (POST)   12 would_hide_statement
 *   13 pinned UPDATE   14 audit row, LAST, same `tx`.
 * (0 auth, 1 permission, 2 uuid and 3 body shape are the route's.)
 *
 * A `return` inside `db.transaction` COMMITS. The only refusals reachable after
 * a write are the pinned UPDATE matching zero rows (THROWS a private sentinel,
 * mapped to 409) and the audit insert (a throw rolls everything back: a
 * correction with no audit record must not exist). Every other refusal happens
 * before any write (DECISION-113 X1).
 *
 * The approval stamp (approvedAt, approvedByUserId, boardMinute) is never in
 * either SET (DECISION-106 item 3: the stamp IS the lock). Closed-session
 * arithmetic cannot move: bank account and date change only while the row is
 * unmatched and unreconciled, and no other allowlisted field is read by any
 * tie-out. Sends no email and writes no sent-claim (DECISION-102/103 are not
 * engaged).
 */

import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgerBankAccounts,
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerTransactions,
  type LedgerTransaction,
} from "@/lib/db/schema";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";
import {
  REIMBURSEMENT_PAYMENT_METHODS,
  isBudgetLinePickValid,
  isOwnReimbursementRequest,
  pickDefaultBankAccount,
  shouldClearBudgetLineLink,
} from "@/lib/ledger";
import { getBudgetLineForLinkValidation, getBudgetLineOptions } from "@/lib/ledger-queries";
import { isTransactionReconciled } from "@/lib/ledger-transaction-lock";
import {
  validateBankAccountForEntity,
  validateCategoryForFund,
} from "@/lib/ledger-transaction-validation";
import { recordLedgerAudit } from "@/lib/ledger-audit";
import {
  TRANSACTION_CORRECTED_AUDIT_ACTION,
  REASON_LIMITS,
  type CorrectableField,
  type ReimbursementCorrectionSide,
} from "@/lib/ledger-correction";
import {
  CORRECTION_ERROR_COPY,
  CORRECTION_ERROR_STATUS,
  FILL_BANK_ACCOUNT_REASON,
  buildCorrectionWarnings,
  correctableRowKind,
  diffCorrection,
  requiredCorrectionTier,
  wouldHideStatementMessage,
  type CorrectChanges,
  type CorrectionBodyInput,
  type CorrectionErrorCode,
  type CorrectionPreview,
  type CorrectionProposal,
  type CorrectionTierReason,
  type CorrectionWarning,
  type CorrectResponse,
  type LockedFieldsCode,
  type OperationDecision,
  type StoredCorrectableValues,
} from "@/lib/ledger-reimbursement-correction";
import {
  loadPaidReimbursementsForTransaction,
  type LinkedPaidReimbursement,
} from "@/lib/ledger-reimbursement-link";
import { findSentStatementMonth, loadOpenMatch } from "@/lib/ledger-fund-move-preview";
import {
  loadEarliestGatingDate,
  newlyHiddenStatementMonth,
  rowGatesStatement,
} from "@/lib/financial-report-queries";

type Exec = Pick<typeof db, "select">;

export type CorrectionFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: CorrectionErrorCode;
  error: string;
};

function fail(code: CorrectionErrorCode, error?: string): CorrectionFailure {
  return {
    ok: false,
    status: CORRECTION_ERROR_STATUS[code],
    code,
    error: error ?? CORRECTION_ERROR_COPY[code],
  };
}

/** Thrown by the pinned UPDATE on zero rows so the surrounding transaction rolls back. */
class CorrectionRollback extends Error {
  constructor(readonly code: "stale" | "already_has_bank_account") {
    super(`correction_rollback:${code}`);
    this.name = "CorrectionRollback";
  }
}

export interface CorrectionActor {
  userId: string;
  memberId?: string | null;
}

const dateFy = (iso: string) => getFiscalYear(new Date(iso + "T00:00:00"));

// ---------------------------------------------------------------------------
// The two pinned UPDATEs: key sets and WHERE clauses (exported for tests)
// ---------------------------------------------------------------------------

/** SET for `fill_bank_account`: the account, the check number only when given, and `updatedAt`. Nothing else, ever. */
export function buildFillSet(args: {
  bankAccountId: string;
  checkNumber: string | null | undefined;
  now: Date;
}): Record<string, unknown> {
  const set: Record<string, unknown> = { bankAccountId: args.bankAccountId };
  if (args.checkNumber) set.checkNumber = args.checkNumber;
  set.updatedAt = args.now;
  return set;
}

/**
 * SET for `correct`: ONLY the changed allowlisted columns plus `updatedAt`.
 * `budgetLineId: null` here may be an explicit clear or the auto-clear.
 */
export function buildCorrectSet(changes: CorrectChanges, now: Date): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if ("categoryId" in changes) set.categoryId = changes.categoryId;
  if ("budgetLineId" in changes) set.budgetLineId = changes.budgetLineId;
  if ("txnDate" in changes) set.txnDate = changes.txnDate;
  if ("paymentMethod" in changes) set.paymentMethod = changes.paymentMethod;
  if ("checkNumber" in changes) set.checkNumber = changes.checkNumber;
  if ("memo" in changes) set.memo = changes.memo;
  if ("bankAccountId" in changes) set.bankAccountId = changes.bankAccountId;
  set.updatedAt = now;
  return set;
}

const noMatch = (id: string): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${ledgerReconciliationMatches} WHERE ${ledgerReconciliationMatches.transactionId} = ${id})`;

/**
 * WHERE for the atomic fill-null UPDATE. Every state fact is re-pinned in the
 * statement itself, so even a write that raced past the row lock cannot land on
 * a row that is now matched, reconciled or already filled.
 */
export function fillWhere(id: string): SQL {
  return and(
    eq(ledgerTransactions.id, id),
    isNull(ledgerTransactions.bankAccountId),
    eq(ledgerTransactions.status, "posted"),
    eq(ledgerTransactions.reconciled, false),
    isNull(ledgerTransactions.reconciledSessionId),
    sql`${ledgerTransactions.approvedAt} IS NOT NULL`,
    noMatch(id),
  ) as SQL;
}

/**
 * WHERE for the `correct` UPDATE. The reconciled predicate is added ONLY when
 * the change set includes the date or the bank account (the two fields the
 * tie-out and matching depend on).
 */
export function correctWhere(id: string, dateOrBankChanged: boolean): SQL {
  const parts: (SQL | undefined)[] = [
    eq(ledgerTransactions.id, id),
    sql`${ledgerTransactions.approvedAt} IS NOT NULL`,
  ];
  if (dateOrBankChanged) {
    parts.push(
      eq(ledgerTransactions.reconciled, false),
      isNull(ledgerTransactions.reconciledSessionId),
    );
  }
  return and(...parts) as SQL;
}

// ---------------------------------------------------------------------------
// Steps 5-6 and 8: the row-level checks (shared by both operations)
// ---------------------------------------------------------------------------

/** Steps 5 and 6: the closed eligibility set, then the self-action rule over EVERY linked paid reimbursement. */
export function checkCorrectable(
  row: LedgerTransaction,
  linked: readonly LinkedPaidReimbursement[],
  actor: CorrectionActor,
): CorrectionFailure | null {
  if (!correctableRowKind(row, linked.length)) return fail("not_correctable");
  const actorRef = { id: actor.userId, memberId: actor.memberId };
  if (linked.some((l) => isOwnReimbursementRequest(actorRef, l))) return fail("own_request");
  return null;
}

/**
 * Step 8 for a date/bank change: reconciled by closed session, then the legacy
 * mark, then a match in an open session (read on the handle given, after the
 * row lock, so a concurrent /match serializes with this write).
 */
async function stateBlock(exec: Exec, row: LedgerTransaction): Promise<CorrectionFailure | null> {
  if (row.reconciledSessionId) return fail("reconciled_session");
  if (row.reconciled) return fail("reconciled_legacy");
  if (await loadOpenMatch(exec, row.id)) return fail("matched_open_session");
  return null;
}

function storedValues(row: LedgerTransaction): StoredCorrectableValues {
  return {
    categoryId: row.categoryId,
    budgetLineId: row.budgetLineId,
    txnDate: row.txnDate,
    paymentMethod: row.paymentMethod,
    checkNumber: row.checkNumber,
    memo: row.memo,
    bankAccountId: row.bankAccountId,
  };
}

// ---------------------------------------------------------------------------
// fill_bank_account evaluator
// ---------------------------------------------------------------------------

/**
 * Step 8 for `fill_bank_account`: already filled, then a different check number
 * already present, then the state block. `input` is undefined for the GET
 * preview (no account or number chosen yet). The permission tier does not apply
 * (record tier even for a prior-year row: it changes no reported figure).
 */
export async function evaluateFill(
  exec: Exec,
  row: LedgerTransaction,
  input?: { checkNumber: string | null },
): Promise<CorrectionFailure | { ok: true }> {
  if (row.bankAccountId != null) return fail("already_has_bank_account");
  if (input?.checkNumber && row.checkNumber && row.checkNumber !== input.checkNumber) {
    return fail("check_number_present");
  }
  const block = await stateBlock(exec, row);
  if (block) return block;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// correct evaluator
// ---------------------------------------------------------------------------

export interface CorrectPlan {
  /** The final change set, including an automatic budget-line clear. */
  changes: CorrectChanges;
  /** The requested fields that actually differ from the stored values, canonical order. */
  changed: CorrectableField[];
  budgetLineLinkCleared: boolean;
  tier: { tier: "record" | "manage"; reasons: CorrectionTierReason[] };
  sentStatementMonth: string | null;
  newSentStatementMonth: string | null;
  warnings: CorrectionWarning[];
  afterCategory: { id: string; name: string } | null;
  afterBank: { id: string; name: string } | null;
}

function statementLabel(fundName: string): string {
  return fundName.replace(/ Fund$/, "");
}

export async function evaluateCorrect(
  exec: Exec,
  args: {
    row: LedgerTransaction;
    fund: { id: string; name: string; kind: string; entityId: string };
    requested: CorrectChanges;
    callerCanManage: boolean;
    now: Date;
    /** `execute` runs step 9 (no_change) and step 11 (semantic input); `preview` does not. */
    mode: "preview" | "execute";
  },
): Promise<CorrectionFailure | { ok: true; plan: CorrectPlan }> {
  const { row, fund, now } = args;
  const { changes: diffed, changed } = diffCorrection(storedValues(row), args.requested);
  const changes: CorrectChanges = { ...diffed };

  // 8. state: only when the date or the bank account is being changed
  if (changed.includes("bankAccountId") || changed.includes("txnDate")) {
    const block = await stateBlock(exec, row);
    if (block) return block;
  }

  // 9. nothing to do
  if (args.mode === "execute" && changed.length === 0) return fail("no_change");

  // 10. tier, from the LOCKED row (never the client)
  const tier = requiredCorrectionTier(row, { newTxnDate: changes.txnDate }, now);
  if (tier.tier === "manage" && !args.callerCanManage) return fail("manage_required");

  // 11. semantic input (POST only)
  let afterCategory: { id: string; name: string } | null = null;
  let afterBank: { id: string; name: string } | null = null;
  let budgetLineLinkCleared = false;
  if (args.mode === "execute") {
    if (changes.categoryId !== undefined) {
      const cat = await validateCategoryForFund(
        exec,
        changes.categoryId,
        { entityId: row.entityId, kind: fund.kind },
        "expense",
        { requireActive: true },
      );
      if (!cat.ok) {
        return fail(
          cat.code === "category_not_found" ? "category_not_found" : "category_invalid",
          cat.error,
        );
      }
      afterCategory = { id: cat.category.id, name: cat.category.name ?? "" };
    }
    if (changes.bankAccountId !== undefined) {
      // Validated only when it differs from the stored value (DECISION-111 item 4):
      // a row on a since-deactivated account can still be re-categorized.
      const fit = await validateBankAccountForEntity(exec, changes.bankAccountId, row.entityId, {
        requireActive: true,
      });
      if (!fit.ok) return fail("bank_account_invalid", fit.error);
      afterBank = fit.account;
    }

    const effectiveCategoryId =
      changes.categoryId !== undefined ? changes.categoryId : row.categoryId;
    const effectiveFiscalYear = dateFy(changes.txnDate ?? row.txnDate);
    if (changes.budgetLineId !== undefined) {
      if (changes.budgetLineId !== null) {
        const line = await getBudgetLineForLinkValidation(changes.budgetLineId);
        if (!line) return fail("budget_line_not_found");
        if (
          !isBudgetLinePickValid(line, {
            fundId: row.fundId,
            fiscalYear: effectiveFiscalYear,
            categoryId: effectiveCategoryId,
          })
        ) {
          return fail("budget_line_invalid");
        }
      }
    } else if (
      row.budgetLineId &&
      (changed.includes("categoryId") || changed.includes("txnDate"))
    ) {
      // The link itself was not touched; clear it if it no longer applies.
      const linked = await getBudgetLineForLinkValidation(row.budgetLineId);
      if (!linked || shouldClearBudgetLineLink(linked, effectiveFiscalYear, effectiveCategoryId)) {
        changes.budgetLineId = null;
        budgetLineLinkCleared = true;
      }
    }
  }

  // 12. would-hide-statement (R1): an earlier date, or a method away from Check
  if (changed.includes("txnDate") || changed.includes("paymentMethod")) {
    const reconciled = row.reconciled === true;
    const before = {
      gates:
        !reconciled &&
        rowGatesStatement({
          fundKind: fund.kind,
          paymentMethod: row.paymentMethod,
          flow: row.flow,
        }),
      txnDate: row.txnDate,
    };
    const after = {
      gates:
        !reconciled &&
        rowGatesStatement({
          fundKind: fund.kind,
          paymentMethod: changes.paymentMethod ?? row.paymentMethod,
          flow: row.flow,
        }),
      txnDate: changes.txnDate ?? row.txnDate,
    };
    const hidden = newlyHiddenStatementMonth({
      before,
      after,
      otherEarliestGatingDate: await loadEarliestGatingDate(exec, row.entityId, row.id),
      now,
    });
    if (hidden) {
      return fail(
        "would_hide_statement",
        wouldHideStatementMessage({
          hiddenMonth: hidden,
          newDate: changes.txnDate ?? null,
          currentMonth: row.txnDate.slice(0, 7),
          methodChange: changed.includes("paymentMethod"),
        }),
      );
    }
  }

  // warnings (advisory): sent statements for the old and, when it moves, the new month
  const sentStatementMonth = await findSentStatementMonth(exec, {
    entityId: row.entityId,
    txnDate: row.txnDate,
    fundKind: fund.kind,
  });
  const newMonthDiffers = changes.txnDate && changes.txnDate.slice(0, 7) !== row.txnDate.slice(0, 7);
  const newSentStatementMonth = newMonthDiffers
    ? await findSentStatementMonth(exec, {
        entityId: row.entityId,
        txnDate: changes.txnDate as string,
        fundKind: fund.kind,
      })
    : null;
  const warnings = buildCorrectionWarnings({
    tierReasons: tier.reasons,
    changed,
    sentStatementMonth,
    newSentStatementMonth,
    statementLabel: statementLabel(fund.name),
  });

  return {
    ok: true,
    plan: {
      changes,
      changed,
      budgetLineLinkCleared,
      tier,
      sentStatementMonth,
      newSentStatementMonth,
      warnings,
      afterCategory,
      afterBank,
    },
  };
}

// ---------------------------------------------------------------------------
// Preview (GET)
// ---------------------------------------------------------------------------

function denialOf(f: CorrectionFailure): OperationDecision {
  return {
    allowed: false,
    code: f.code,
    status: (f.status === 409 ? 409 : 403) as 403 | 409,
    reason: f.error,
  };
}

export async function previewCorrection(args: {
  transactionId: string;
  actor: CorrectionActor;
  callerCanManage: boolean;
  proposal?: CorrectionProposal;
  now?: Date;
}): Promise<{ ok: true; preview: CorrectionPreview } | CorrectionFailure> {
  const now = args.now ?? new Date();
  const row = (
    await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, args.transactionId))
  )[0];
  if (!row) return fail("not_found");

  const fund = (await db.select().from(ledgerFunds).where(eq(ledgerFunds.id, row.fundId)))[0];
  if (!fund) return fail("not_found");
  const linked = await loadPaidReimbursementsForTransaction(db, row.id);
  const top = checkCorrectable(row, linked, args.actor);
  if (top) return top;

  const entity = (
    await db.select().from(ledgerEntities).where(eq(ledgerEntities.id, row.entityId))
  )[0];

  const categoryName = row.categoryId
    ? ((
        await db
          .select({ name: ledgerCategories.name })
          .from(ledgerCategories)
          .where(eq(ledgerCategories.id, row.categoryId))
          .limit(1)
      )[0]?.name ?? null)
    : null;
  const bankAccountName = row.bankAccountId
    ? ((
        await db
          .select({ name: ledgerBankAccounts.name })
          .from(ledgerBankAccounts)
          .where(eq(ledgerBankAccounts.id, row.bankAccountId))
          .limit(1)
      )[0]?.name ?? null)
    : null;

  const match = await loadOpenMatch(db, row.id);
  const reconciled = isTransactionReconciled(row);
  const lockedCode: LockedFieldsCode | null = row.reconciledSessionId
    ? "reconciled_session"
    : row.reconciled
      ? "reconciled_legacy"
      : match
        ? "matched_open_session"
        : null;

  // fill_bank_account: no account or number is chosen at preview time
  const fillEval = await evaluateFill(db, row);
  const fill: OperationDecision = fillEval.ok ? { allowed: true } : denialOf(fillEval);

  // correct: evaluated for the proposal (date and method only), else the baseline
  const requested: CorrectChanges = {};
  if (args.proposal?.txnDate) requested.txnDate = args.proposal.txnDate;
  if (args.proposal?.paymentMethod) requested.paymentMethod = args.proposal.paymentMethod;
  const correctEval = await evaluateCorrect(db, {
    row,
    fund,
    requested,
    callerCanManage: args.callerCanManage,
    now,
    mode: "preview",
  });
  const baselineTier = requiredCorrectionTier(row, { newTxnDate: requested.txnDate }, now);
  const decision: OperationDecision = correctEval.ok ? { allowed: true } : denialOf(correctEval);

  let warnings: CorrectionWarning[];
  if (correctEval.ok) {
    const worstCase = diffCorrection(storedValues(row), requested).changed.length === 0;
    if (worstCase) {
      // Baseline: assume a statement-affecting change so the dialog can show the
      // sent-statement warning up front; the POST response carries the exact set.
      warnings = buildCorrectionWarnings({
        tierReasons: baselineTier.reasons,
        changed: ["categoryId", "txnDate", "paymentMethod"],
        sentStatementMonth: correctEval.plan.sentStatementMonth,
        newSentStatementMonth: null,
        statementLabel: statementLabel(fund.name),
      });
    } else {
      warnings = correctEval.plan.warnings;
    }
  } else {
    warnings = buildCorrectionWarnings({
      tierReasons: baselineTier.reasons,
      changed: [],
      sentStatementMonth: null,
      newSentStatementMonth: null,
      statementLabel: statementLabel(fund.name),
    });
  }

  const categories = await db
    .select({ id: ledgerCategories.id, name: ledgerCategories.name })
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, row.entityId),
        eq(ledgerCategories.fundKind, fund.kind),
        eq(ledgerCategories.flow, "expense"),
        eq(ledgerCategories.isActive, true),
      ),
    )
    .orderBy(asc(ledgerCategories.sortOrder), asc(ledgerCategories.name));
  const accounts = await db
    .select({
      id: ledgerBankAccounts.id,
      name: ledgerBankAccounts.name,
      isDefault: ledgerBankAccounts.isDefault,
      isActive: ledgerBankAccounts.isActive,
    })
    .from(ledgerBankAccounts)
    .where(and(eq(ledgerBankAccounts.entityId, row.entityId), eq(ledgerBankAccounts.isActive, true)))
    .orderBy(asc(ledgerBankAccounts.name));
  const budgetLines = (await getBudgetLineOptions(row.entityId)).filter(
    (l) => l.fundId === row.fundId,
  );

  return {
    ok: true,
    preview: {
      transaction: {
        id: row.id,
        txnDate: row.txnDate,
        amountCents: row.amountCents,
        party: row.party,
        memo: row.memo,
        categoryId: row.categoryId,
        categoryName,
        budgetLineId: row.budgetLineId,
        paymentMethod: row.paymentMethod,
        checkNumber: row.checkNumber,
        bankAccountId: row.bankAccountId,
        bankAccountName,
        fundId: fund.id,
        fundName: fund.name,
        fundKind: fund.kind,
        entity: {
          id: entity?.id ?? row.entityId,
          slug: entity?.slug ?? "",
          name: entity ? (entity.shortName ?? entity.name) : "",
        },
        fiscalYear: dateFy(row.txnDate),
        reconciled,
        matched: match !== null,
        updatedAt: row.updatedAt.toISOString(),
      },
      callerCanManage: args.callerCanManage,
      operations: {
        fill_bank_account: fill,
        correct: {
          ...decision,
          tier: { required: baselineTier.tier, reasons: baselineTier.reasons },
          dateAndBankEditable: lockedCode === null,
          lockedFields: lockedCode
            ? { code: lockedCode, message: CORRECTION_ERROR_COPY[lockedCode] }
            : null,
        },
      },
      options: {
        categories,
        bankAccounts: accounts.map((a) => ({ id: a.id, name: a.name, isDefault: a.isDefault })),
        defaultBankAccountId: pickDefaultBankAccount(accounts)?.id ?? null,
        budgetLines,
        paymentMethods: REIMBURSEMENT_PAYMENT_METHODS,
      },
      warnings,
      reasonLimits: { min: REASON_LIMITS.min as 10, max: REASON_LIMITS.max as 500 },
    },
  };
}

// ---------------------------------------------------------------------------
// Execute (POST)
// ---------------------------------------------------------------------------

/**
 * Run the whole correction in one transaction. The FIRST statement is the row
 * lock; every guard is re-derived on the locked row; the pinned UPDATE runs
 * before the audit row, which is written last on the same `tx`. A refusal
 * returns a CorrectionFailure having written nothing; a thrown error (a failed
 * audit insert, or the zero-row sentinel) rolls the transaction back. Only the
 * sentinel is mapped to a 409; any other thrown error propagates (route: 500).
 */
export async function executeCorrection(args: {
  transactionId: string;
  actor: CorrectionActor;
  callerCanManage: boolean;
  input: CorrectionBodyInput;
  now?: Date;
}): Promise<{ ok: true; result: CorrectResponse } | CorrectionFailure> {
  try {
    return await runCorrection(args);
  } catch (err) {
    if (err instanceof CorrectionRollback) return fail(err.code);
    throw err;
  }
}

async function runCorrection(args: {
  transactionId: string;
  actor: CorrectionActor;
  callerCanManage: boolean;
  input: CorrectionBodyInput;
  now?: Date;
}): Promise<{ ok: true; result: CorrectResponse } | CorrectionFailure> {
  const now = args.now ?? new Date();
  const { input } = args;

  return db.transaction(async (tx) => {
    // 4. the row lock is the FIRST statement
    const locked = (
      await tx
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, args.transactionId))
        .for("update")
    )[0];
    if (!locked) return fail("not_found");

    const fund = (await tx.select().from(ledgerFunds).where(eq(ledgerFunds.id, locked.fundId)))[0];
    if (!fund) return fail("not_found");
    const linked = await loadPaidReimbursementsForTransaction(tx, locked.id);

    // 5-6. closed eligibility, then self-action
    const top = checkCorrectable(locked, linked, args.actor);
    if (top) return top;

    // 7. stale: compared in application code, never SQL timestamp equality
    if (locked.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      return fail("stale");
    }

    const reimbursementId = linked[0]?.id ?? "";
    const fiscalYear = dateFy(locked.txnDate);
    const common = {
      entityId: locked.entityId,
      reimbursementId,
      txnDate: locked.txnDate,
      amountCents: locked.amountCents,
      flow: "expense" as const,
      fiscalYear,
      reconciled: isTransactionReconciled(locked),
      reconciledSessionId: locked.reconciledSessionId,
      priorFiscalYear: fiscalYear < currentFiscalYear(now),
    };

    // ── fill_bank_account ────────────────────────────────────────────────────
    if (input.operation === "fill_bank_account") {
      const ev = await evaluateFill(tx, locked, { checkNumber: input.checkNumber });
      if (!ev.ok) return ev;

      // 11. the account must be active and of the row's entity
      const fit = await validateBankAccountForEntity(tx, input.bankAccountId, locked.entityId, {
        requireActive: true,
      });
      if (!fit.ok) return fail("bank_account_invalid", fit.error);

      const setCheck = locked.checkNumber == null ? input.checkNumber : null;
      const updated = await tx
        .update(ledgerTransactions)
        .set(buildFillSet({ bankAccountId: fit.account.id, checkNumber: setCheck, now }))
        .where(fillWhere(locked.id))
        .returning({ id: ledgerTransactions.id });
      if (updated.length === 0) throw new CorrectionRollback("already_has_bank_account");

      const before: ReimbursementCorrectionSide = { v: 1, bankAccount: null };
      const after: ReimbursementCorrectionSide = {
        v: 1,
        bankAccount: { id: fit.account.id, name: fit.account.name },
      };
      const changedFields: CorrectableField[] = ["bankAccountId"];
      if (setCheck) {
        before.checkNumber = null;
        after.checkNumber = setCheck;
        changedFields.push("checkNumber");
      }
      await recordLedgerAudit(tx, {
        actorUserId: args.actor.userId,
        action: TRANSACTION_CORRECTED_AUDIT_ACTION,
        targetTransactionId: locked.id,
        before,
        after,
        details: {
          v: 1,
          operation: "fill_bank_account",
          reason: FILL_BANK_ACCOUNT_REASON,
          ...common,
          tier: "record",
          sentStatementMonth: null,
          newSentStatementMonth: null,
          changed: changedFields,
          budgetLineLinkCleared: false,
        },
      });
      return {
        ok: true as const,
        result: {
          id: locked.id,
          operation: "fill_bank_account" as const,
          changed: changedFields,
          bankAccountName: fit.account.name,
          budgetLineLinkCleared: false,
          warnings: [],
        },
      };
    }

    // ── correct ──────────────────────────────────────────────────────────────
    const ev = await evaluateCorrect(tx, {
      row: locked,
      fund,
      requested: input.changes,
      callerCanManage: args.callerCanManage,
      now,
      mode: "execute",
    });
    if (!ev.ok) return ev;
    const { plan } = ev;

    const dateOrBank = plan.changed.includes("txnDate") || plan.changed.includes("bankAccountId");
    const updated = await tx
      .update(ledgerTransactions)
      .set(buildCorrectSet(plan.changes, now))
      .where(correctWhere(locked.id, dateOrBank))
      .returning({ id: ledgerTransactions.id });
    if (updated.length === 0) throw new CorrectionRollback("stale");

    // Self-describing before/after: only the changed fields, names captured now.
    const before: ReimbursementCorrectionSide = { v: 1 };
    const after: ReimbursementCorrectionSide = { v: 1 };
    const c = plan.changes;
    if (c.categoryId !== undefined) {
      const prior = locked.categoryId
        ? (
            await tx
              .select({ name: ledgerCategories.name })
              .from(ledgerCategories)
              .where(eq(ledgerCategories.id, locked.categoryId))
              .limit(1)
          )[0]
        : undefined;
      before.category = locked.categoryId
        ? { id: locked.categoryId, name: prior?.name ?? "" }
        : null;
      after.category = plan.afterCategory;
    }
    if ("budgetLineId" in c) {
      before.budgetLineId = locked.budgetLineId;
      after.budgetLineId = c.budgetLineId ?? null;
    }
    if (c.txnDate !== undefined) {
      before.txnDate = locked.txnDate;
      after.txnDate = c.txnDate;
    }
    if (c.paymentMethod !== undefined) {
      before.paymentMethod = locked.paymentMethod;
      after.paymentMethod = c.paymentMethod;
    }
    if ("checkNumber" in c) {
      before.checkNumber = locked.checkNumber;
      after.checkNumber = c.checkNumber ?? null;
    }
    if (c.memo !== undefined) {
      before.memo = locked.memo;
      after.memo = c.memo;
    }
    if (c.bankAccountId !== undefined) {
      const prior = locked.bankAccountId
        ? (
            await tx
              .select({ name: ledgerBankAccounts.name })
              .from(ledgerBankAccounts)
              .where(eq(ledgerBankAccounts.id, locked.bankAccountId))
              .limit(1)
          )[0]
        : undefined;
      before.bankAccount = locked.bankAccountId
        ? { id: locked.bankAccountId, name: prior?.name ?? "" }
        : null;
      after.bankAccount = plan.afterBank;
    }

    await recordLedgerAudit(tx, {
      actorUserId: args.actor.userId,
      action: TRANSACTION_CORRECTED_AUDIT_ACTION,
      targetTransactionId: locked.id,
      before,
      after,
      details: {
        v: 1,
        operation: "correct",
        reason: input.reason,
        ...common,
        tier: plan.tier.tier,
        sentStatementMonth: plan.sentStatementMonth,
        newSentStatementMonth: plan.newSentStatementMonth,
        changed: plan.changed,
        budgetLineLinkCleared: plan.budgetLineLinkCleared,
      },
    });

    return {
      ok: true as const,
      result: {
        id: locked.id,
        operation: "correct" as const,
        changed: plan.changed,
        bankAccountName: plan.afterBank?.name ?? null,
        budgetLineLinkCleared: plan.budgetLineLinkCleared,
        warnings: plan.warnings,
      },
    };
  });
}

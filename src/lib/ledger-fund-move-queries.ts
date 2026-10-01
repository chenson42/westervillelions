/**
 * DB orchestration for moving a ledger row to another fund (DECISION-109/111,
 * extended across the entity boundary for ONE cell by DECISION-112/113:
 * docs/work-log/2026-10-01-move-or-cancel-transaction.md and
 * docs/work-log/2026-10-01-cross-entity-transaction-move.md).
 *
 * `previewFundMove()` (GET) and `executeFundMove()` (POST) share ONE evaluator
 * split on what depends on the destination:
 *   - `evaluateRowState()`  pure, destination-independent (approved, rejected,
 *     pending, dues-synced, transfer leg);
 *   - `evaluateDestination()` per destination: direction policy, then the
 *     cross-entity row-state block, then the permission tier.
 * The preview loops the second over every destination; POST calls it once on
 * the `SELECT ... FOR UPDATE` row. Parity is therefore structural: every
 * destination GET lists as allowed passes steps 1-6 in POST, and every denial
 * GET lists carries the code and status POST would return.
 *
 * Guard order, identical in GET and POST (precedence on a refusal):
 *   0 gate/body  1 row + row-state  2 stale (POST)  3 destination fund
 *   4 direction policy  5 cross-entity row state  6 tier  7 input
 *   8 acknowledgment settlement  9 pinned UPDATE, then the audit row.
 * A denied move never says "needs Manage": policy, then state, then tier.
 *
 * A `return` inside `db.transaction` COMMITS. The only refusal reachable after
 * a write is the pinned UPDATE matching zero rows, so it THROWS a private
 * sentinel (rolling back the acknowledgment settlement) that `executeFundMove`
 * maps to 409 `stale`. A reviewer adding a refusal after step 8 must throw,
 * not return (DECISION-113 X1).
 *
 * Writes nothing outside the transaction, sends no email, never writes
 * `sent_at`/`sent_via`, and never touches financial_report_sends (read-only: a
 * changed total flips the existing "Resend Corrected Statement" panel on its
 * own).
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerFunds,
  ledgerEntities,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerSettings,
  type LedgerEntity,
  type LedgerFund,
  type LedgerTransaction,
} from "@/lib/db/schema";
import { checkFundMove } from "@/lib/ledger-fund-move-policy";
import {
  LOCK_COPY,
  crossEntityBlockKind,
  isTransactionReconciled,
  moveBlockKind,
  requiredMoveTier,
  type CrossEntityStateBlock,
} from "@/lib/ledger-transaction-lock";
import {
  validateBankAccountForEntity,
  validateCategoryForFund,
} from "@/lib/ledger-transaction-validation";
import { recordLedgerAudit } from "@/lib/ledger-audit";
import {
  CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE,
  CROSS_ENTITY_STATE_COPY,
  MANAGE_REQUIRED_MESSAGE,
  STALE_MOVE_MESSAGE,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  REASON_LIMITS,
  buildMoveWarnings,
  type FundMoveAuditPayloadV2,
  type MoveDestination,
  type MoveDestinationDenialCode,
  type MoveEntityRef,
  type MoveErrorCode,
  type MoveInput,
  type MovePreview,
  type MoveResponse,
  type MoveTierReason,
  type MoveUnlock,
} from "@/lib/ledger-correction";
import { settleAcknowledgmentForMove } from "@/lib/ledger-fund-move-ack";
import {
  buildMoveUnlock,
  findDuplicateCandidates,
  findSentStatementMonth,
  listActiveBankOptions,
  loadOpenMatch,
  loadReceiptState,
  postedFundRows,
  sourceBankImpact,
  type OpenMatch,
  type SelectExec,
} from "@/lib/ledger-fund-move-preview";
import {
  PUBLIC_DONATIONS_CATEGORY_NAME,
  agedPublicFundCutoffDate,
  fundBalanceCents,
} from "@/lib/ledger";
import { getFiscalYear, currentFiscalYear } from "@/lib/fiscal-year";

// Re-exported so existing importers (and the T19 tests) keep one import path.
export { findSentStatementMonth };

export type MoveFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409;
  code: MoveErrorCode;
  error: string;
};

function fail(status: MoveFailure["status"], code: MoveErrorCode, error: string): MoveFailure {
  return { ok: false, status, code, error };
}

/** Thrown by the pinned UPDATE on zero rows so the surrounding transaction rolls back. */
class StaleMoveRollback extends Error {
  constructor() {
    super("stale_move_rollback");
    this.name = "StaleMoveRollback";
  }
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

const DEST_BANK_NOT_ALLOWED_MESSAGE =
  "A bank account cannot be changed when moving within one entity.";

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

function entityRef(e: Pick<LedgerEntity, "id" | "slug" | "name" | "shortName">): MoveEntityRef {
  return { id: e.id, slug: e.slug, name: e.shortName ?? e.name };
}

/** Step 1: the destination-independent row-state block. Pure. */
export function evaluateRowState(row: LedgerTransaction): { ok: true } | MoveFailure {
  const block = moveBlockKind(row);
  if (block) return fail(403, block, MOVE_BLOCK_MESSAGES[block]);
  return { ok: true };
}

export type DestinationEvaluation =
  | { ok: true; crossEntity: boolean; tier: "record" | "manage"; reasons: MoveTierReason[] }
  | (MoveFailure & { status: 403 | 409; unlockKind?: MoveUnlock["kind"] });

const UNLOCK_KIND: Record<CrossEntityStateBlock, MoveUnlock["kind"] | undefined> = {
  prior_fiscal_year_cross_entity: undefined,
  reconciled_session: "closed_session",
  reconciled_legacy: "legacy_reconciled",
  matched_open_session: "matched_open_session",
};

/**
 * Steps 4-6 for ONE destination: direction policy, cross-entity row state (the
 * pure checks first, then the one database read), then the permission tier.
 * `loadMatch` reads on whatever handle the caller holds (the preview's `db`,
 * or POST's `tx` after the row lock).
 */
export async function evaluateDestination(args: {
  row: LedgerTransaction;
  source: LedgerFund;
  dest: LedgerFund;
  callerCanManage: boolean;
  now: Date;
  loadMatch: () => Promise<OpenMatch | null>;
}): Promise<DestinationEvaluation> {
  const { row, source, dest } = args;

  // 4. direction policy
  const decision = checkFundMove({
    flow: row.flow,
    from: { entityId: source.entityId, fundId: source.id, kind: source.kind },
    to: { entityId: dest.entityId, fundId: dest.id, kind: dest.kind },
  });
  if (!decision.allowed) {
    const status = decision.code === "same_fund" ? 409 : 403;
    return { ...fail(status, decision.code, decision.reason), status };
  }

  const crossEntity = source.entityId !== dest.entityId;

  // 5. cross-entity row state (X2 order: the pure checks, then the DB read)
  if (crossEntity) {
    let block: CrossEntityStateBlock | null = crossEntityBlockKind(row, args.now);
    if (!block && (await args.loadMatch())) block = "matched_open_session";
    if (block) {
      const copy = CROSS_ENTITY_STATE_COPY[block];
      return {
        ...fail(403, block, `${copy.message} ${copy.nextStep}`),
        status: 403,
        unlockKind: UNLOCK_KIND[block],
      };
    }
  }

  // 6. tier: a function of (row, destination)
  const { tier, reasons } = requiredMoveTier(row, args.now, { crossEntity });
  if (tier === "manage" && !args.callerCanManage) {
    return {
      ...fail(
        403,
        "manage_required",
        crossEntity ? CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE : MANAGE_REQUIRED_MESSAGE,
      ),
      status: 403,
    };
  }
  return { ok: true, crossEntity, tier, reasons };
}

/**
 * Step 7b: the stored-account assertion, SAME-ENTITY ONLY. A cross-entity move
 * legitimately leaves the source account behind, so it is not asserted there.
 */
function checkStoredBank(args: {
  dest: LedgerFund;
  bank: BankInfo;
  crossEntity: boolean;
}): MoveFailure | null {
  if (args.crossEntity) return null;
  const { bank, dest } = args;
  if (bank !== null && (bank === "missing" || bank.entityId !== dest.entityId)) {
    return fail(409, "bank_account_entity_mismatch", BANK_ENTITY_MISMATCH_MESSAGE);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The two UPDATE shapes, built SEPARATELY (DECISION-113). The same-entity set
// can never contain `bankAccountId` or `entityId`, which is what keeps the
// reconciled carve-out's premise ("the bank account never changes") true.
// ---------------------------------------------------------------------------

export function buildSameEntityMoveSet(a: {
  destFundId: string;
  categoryId: string | null;
  now: Date;
}) {
  return {
    fundId: a.destFundId,
    categoryId: a.categoryId,
    budgetLineId: null,
    updatedAt: a.now,
  };
}

export function buildCrossEntityMoveSet(a: {
  destEntityId: string;
  destFundId: string;
  destBankAccountId: string;
  categoryId: string | null;
  now: Date;
}) {
  return {
    entityId: a.destEntityId,
    fundId: a.destFundId,
    bankAccountId: a.destBankAccountId,
    categoryId: a.categoryId,
    budgetLineId: null,
    updatedAt: a.now,
  };
}

// ---------------------------------------------------------------------------
// Preview (GET)
// ---------------------------------------------------------------------------

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

  // 1. destination-independent row state: a top-level refusal.
  const state = evaluateRowState(row);
  if (!state.ok) return state;

  const source = await loadFund(db, row.fundId);
  if (!source) return fail(404, "fund_not_found", "The entry's current fund was not found.");

  const entities = await db.select().from(ledgerEntities);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const refOf = (id: string): MoveEntityRef => {
    const e = entityById.get(id);
    return e ? entityRef(e) : { id, slug: "", name: "Unknown entity" };
  };

  // Every OTHER ACTIVE fund of EVERY entity; the source's own entity first.
  const allFunds = await db
    .select()
    .from(ledgerFunds)
    .where(eq(ledgerFunds.isActive, true))
    .orderBy(asc(ledgerFunds.name));
  const candidates = allFunds
    .filter((f) => f.id !== source.id)
    .sort((a, b) => {
      const ao = a.entityId === source.entityId ? 0 : 1;
      const bo = b.entityId === source.entityId ? 0 : 1;
      return ao - bo;
    });

  const bank = await loadBank(db, row);
  const bankName = bank && bank !== "missing" ? bank.name : null;

  let categoryName: string | null = null;
  if (row.categoryId) {
    const cat = await db
      .select({ name: ledgerCategories.name })
      .from(ledgerCategories)
      .where(eq(ledgerCategories.id, row.categoryId))
      .limit(1);
    categoryName = cat[0]?.name ?? null;
  }

  // Computed once per request and reused across destinations.
  let matchPromise: Promise<OpenMatch | null> | undefined;
  const loadMatch = () => (matchPromise ??= loadOpenMatch(db, row.id));
  const unlockCache = new Map<MoveUnlock["kind"], Promise<MoveUnlock>>();
  const unlockFor = (kind: MoveUnlock["kind"]) => {
    let p = unlockCache.get(kind);
    if (!p) {
      p = (async () =>
        buildMoveUnlock(db, {
          row,
          kind,
          sourceFundKind: source.kind,
          openMatch: kind === "matched_open_session" ? await loadMatch() : null,
        }))();
      unlockCache.set(kind, p);
    }
    return p;
  };

  const receipt = await loadReceiptState(db, row.id);
  const settingsRows = await db.select().from(ledgerSettings).limit(1);
  const holdingDays = settingsRows[0]?.holdingPeriodWarnDays ?? 365;
  const aged = row.txnDate < agedPublicFundCutoffDate(holdingDays, now);
  const fiscalYear = getFiscalYear(new Date(row.txnDate + "T00:00:00"));
  const sentStatementMonth = await findSentStatementMonth(db, {
    entityId: row.entityId,
    txnDate: row.txnDate,
    fundKind: source.kind,
  });
  const sourceEntityRef = refOf(source.entityId);

  let sourceRows: Array<{ id: string; flow: string; amountCents: number }> | null = null;
  const destinations: MoveDestination[] = [];

  for (const fund of candidates) {
    const crossEntity = fund.entityId !== source.entityId;
    const base = {
      fundId: fund.id,
      name: fund.name,
      kind: fund.kind,
      entity: refOf(fund.entityId),
      crossEntity,
      tier: (() => {
        const t = requiredMoveTier(row, now, { crossEntity });
        return { required: t.tier, reasons: t.reasons };
      })(),
    };

    const ev = await evaluateDestination({
      row,
      source,
      dest: fund,
      callerCanManage: args.callerCanManage,
      now,
      loadMatch,
    });
    if (!ev.ok) {
      const denial: NonNullable<MoveDestination["denial"]> = {
        code: ev.code as MoveDestinationDenialCode,
        status: ev.status,
        reason: ev.error,
      };
      if (ev.unlockKind) denial.unlock = await unlockFor(ev.unlockKind);
      destinations.push({ ...base, allowed: false, denial });
      continue;
    }

    // 7b as a per-destination denial (same-entity), as in v1.
    const storedBank = checkStoredBank({ dest: fund, bank, crossEntity });
    if (storedBank) {
      destinations.push({
        ...base,
        allowed: false,
        denial: { code: "bank_account_entity_mismatch", status: 409, reason: storedBank.error },
      });
      continue;
    }

    // Cross-entity: the destination needs an active account the cash can land in (GET-only denial).
    let bankOptions: Awaited<ReturnType<typeof listActiveBankOptions>> | null = null;
    if (crossEntity) {
      bankOptions = await listActiveBankOptions(db, fund.entityId, row);
      if (bankOptions.options.length === 0) {
        destinations.push({
          ...base,
          allowed: false,
          denial: {
            code: "dest_no_active_bank_account",
            status: 409,
            reason: `The ${base.entity.name} has no active bank account to receive this entry.`,
          },
        });
        continue;
      }
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

    if (!sourceRows) sourceRows = await postedFundRows(db, source.id);
    const destRows = await postedFundRows(db, fund.id);
    const sourceFund = {
      name: source.name,
      beforeCents: fundBalanceCents(source.openingBalanceCents, sourceRows),
      afterCents: fundBalanceCents(
        source.openingBalanceCents,
        sourceRows.filter((r) => r.id !== row.id),
      ),
    };
    const destFund = {
      name: fund.name,
      beforeCents: fundBalanceCents(fund.openingBalanceCents, destRows),
      afterCents: fundBalanceCents(fund.openingBalanceCents, [
        ...destRows,
        { id: row.id, flow: row.flow, amountCents: row.amountCents },
      ]),
    };

    if (!crossEntity || !bankOptions) {
      destinations.push({
        ...base,
        allowed: true,
        categories: categoryRows,
        defaultCategoryId: defaultCategory?.id ?? null,
        impact: { crossEntity: false, sourceFund, destFund, bankAccount: { name: bankName, changeCents: 0 } },
        warnings: buildMoveWarnings({
          anyDestinationAllowed: true,
          tierReasons: ev.reasons.filter(
            (r): r is "reconciled" | "prior_fiscal_year" => r !== "cross_entity",
          ),
          sentStatementMonth,
          aged,
          bankAccountName: bankName,
        }),
      });
      continue;
    }

    const duplicates = await findDuplicateCandidates(db, { row, destEntityId: fund.entityId });
    const destSentStatementMonth = await findSentStatementMonth(db, {
      entityId: fund.entityId,
      txnDate: row.txnDate,
      fundKind: fund.kind,
    });
    destinations.push({
      ...base,
      allowed: true,
      categories: categoryRows,
      defaultCategoryId: defaultCategory?.id ?? null,
      bankAccounts: bankOptions.options,
      defaultBankAccountId: bankOptions.defaultBankAccountId,
      impact: {
        crossEntity: true,
        sourceFund,
        destFund,
        sourceBankAccount: await sourceBankImpact(db, row),
      },
      duplicateCandidates: duplicates,
      warnings: buildMoveWarnings({
        anyDestinationAllowed: true,
        tierReasons: [],
        sentStatementMonth,
        aged,
        bankAccountName: bankName,
        crossEntity: {
          receipt,
          sourceLabel: sourceEntityRef.name,
          destLabel: base.entity.name,
          destSentStatementMonth,
          duplicateCount: duplicates.length,
          fiscalYear,
        },
      }),
    });
  }

  return {
    ok: true,
    preview: {
      transaction: {
        id: row.id,
        txnDate: row.txnDate,
        flow: row.flow as "income" | "expense",
        amountCents: row.amountCents,
        party: row.party,
        fiscalYear,
        reconciled: isTransactionReconciled(row),
        fundId: source.id,
        fundName: source.name,
        fundKind: source.kind,
        categoryId: row.categoryId,
        categoryName,
        bankAccountId: row.bankAccountId,
        bankAccountName: bankName,
        entity: sourceEntityRef,
        donorId: row.donorId,
        receipt,
      },
      callerCanManage: args.callerCanManage,
      destinations,
      reasonLimits: { min: REASON_LIMITS.min, max: REASON_LIMITS.max },
    },
  };
}

// ---------------------------------------------------------------------------
// Execute (POST)
// ---------------------------------------------------------------------------

/**
 * Run the whole move in one transaction. The FIRST statement is the row lock;
 * every guard is re-validated on the locked row; the acknowledgment is settled
 * and the pinned UPDATE runs BEFORE the audit row, which is written last on the
 * same `tx`. A refusal returns a MoveFailure having written nothing; a thrown
 * error (including a failed audit insert, or the stale sentinel) rolls the
 * transaction back. Only the stale sentinel is mapped to a 409; any other
 * thrown error propagates so the route can answer 500.
 */
export async function executeFundMove(args: {
  transactionId: string;
  actorUserId: string;
  callerCanManage: boolean;
  input: MoveInput;
  now?: Date;
}): Promise<{ ok: true; result: MoveResponse } | MoveFailure> {
  try {
    return await runMove(args);
  } catch (err) {
    if (err instanceof StaleMoveRollback) return fail(409, "stale", STALE_MOVE_MESSAGE);
    throw err;
  }
}

async function runMove(args: {
  transactionId: string;
  actorUserId: string;
  callerCanManage: boolean;
  input: MoveInput;
  now?: Date;
}): Promise<{ ok: true; result: MoveResponse } | MoveFailure> {
  const now = args.now ?? new Date();
  const { input } = args;

  return db.transaction(async (tx) => {
    // 1. the row lock is the FIRST statement
    const locked = (
      await tx
        .select()
        .from(ledgerTransactions)
        .where(eq(ledgerTransactions.id, args.transactionId))
        .for("update")
    )[0];
    if (!locked) return fail(404, "not_found", "Transaction not found");

    const state = evaluateRowState(locked);
    if (!state.ok) return state;

    // 2. stale: ahead of the policy so a double-click answers `stale`, never
    //    `same_fund` or `club_to_foundation_not_supported`.
    if (input.expectedFundId !== locked.fundId) {
      return fail(409, "stale", STALE_MOVE_MESSAGE);
    }

    // 3. destination fund (must exist and be active), then the source fund
    const dest = await loadFund(tx, input.destFundId);
    if (!dest || !dest.isActive) return fail(404, "fund_not_found", "Destination fund not found");
    const source = await loadFund(tx, locked.fundId);
    if (!source) return fail(404, "fund_not_found", "The entry's current fund was not found.");

    // 4-6. policy, cross-entity row state (match read on `tx`, after the lock), tier
    const ev = await evaluateDestination({
      row: locked,
      source,
      dest,
      callerCanManage: args.callerCanManage,
      now,
      loadMatch: () => loadOpenMatch(tx, locked.id),
    });
    if (!ev.ok) return fail(ev.status, ev.code, ev.error);
    const { crossEntity } = ev;

    const entities = await tx
      .select()
      .from(ledgerEntities)
      .where(inArray(ledgerEntities.id, [...new Set([source.entityId, dest.entityId])]));
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const destEntity = entityById.get(dest.entityId);
    const sourceEntity = entityById.get(source.entityId);

    // 7a. destination bank account (never trusted from the client's idea of the entity)
    let destBank: { id: string; name: string } | null = null;
    if (crossEntity) {
      if (input.destBankAccountId === null) {
        return fail(
          400,
          "dest_bank_account_required",
          `Pick the ${destEntity ? entityRef(destEntity).name : "destination"} bank account the money landed in.`,
        );
      }
      const fit = await validateBankAccountForEntity(tx, input.destBankAccountId, dest.entityId, {
        requireActive: true,
      });
      if (!fit.ok) return fail(400, "dest_bank_account_invalid", fit.error);
      destBank = fit.account;
    } else if (input.destBankAccountId !== null) {
      return fail(400, "dest_bank_account_not_allowed", DEST_BANK_NOT_ALLOWED_MESSAGE);
    }

    // 7b. stored-account assertion (same-entity only)
    const bank = await loadBank(tx, locked);
    const storedBank = checkStoredBank({ dest, bank, crossEntity });
    if (storedBank) return storedBank;

    // 7c. category
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

    // Read-only context for the audit payload: per-entity sent-statement months.
    const sentStatementMonth = await findSentStatementMonth(tx, {
      entityId: locked.entityId,
      txnDate: locked.txnDate,
      fundKind: source.kind,
    });
    const destSentStatementMonth = crossEntity
      ? await findSentStatementMonth(tx, {
          entityId: dest.entityId,
          txnDate: locked.txnDate,
          fundKind: dest.kind,
        })
      : null;

    // 8. acknowledgment settlement (cross-entity only), BEFORE the pinned UPDATE
    const settlement = crossEntity
      ? await settleAcknowledgmentForMove(tx, {
          transactionId: locked.id,
          sourceEntityId: locked.entityId,
          now,
        })
      : { outcome: "none" as const, ack: null };

    // 9. pinned UPDATE. Zero rows THROWS so the settlement above rolls back.
    const updated = crossEntity
      ? await tx
          .update(ledgerTransactions)
          .set(
            buildCrossEntityMoveSet({
              destEntityId: dest.entityId,
              destFundId: dest.id,
              destBankAccountId: (destBank as { id: string }).id,
              categoryId: input.categoryId,
              now,
            }),
          )
          .where(
            and(
              eq(ledgerTransactions.id, locked.id),
              eq(ledgerTransactions.fundId, locked.fundId),
              eq(ledgerTransactions.entityId, locked.entityId),
              eq(ledgerTransactions.reconciled, false),
              isNull(ledgerTransactions.reconciledSessionId),
            ),
          )
          .returning({ id: ledgerTransactions.id })
      : await tx
          .update(ledgerTransactions)
          .set(buildSameEntityMoveSet({ destFundId: dest.id, categoryId: input.categoryId, now }))
          .where(
            and(eq(ledgerTransactions.id, locked.id), eq(ledgerTransactions.fundId, locked.fundId)),
          )
          .returning({ id: ledgerTransactions.id });
    if (updated.length === 0) throw new StaleMoveRollback();

    // The audit row is ALWAYS last, on the same `tx`.
    const fiscalYear = getFiscalYear(new Date(locked.txnDate + "T00:00:00"));
    const priorFiscalYear = fiscalYear < currentFiscalYear(now);
    if (crossEntity && destBank && destEntity && sourceEntity) {
      const sourceRef = entityRef(sourceEntity);
      const destRef = entityRef(destEntity);
      const ack = settlement.ack;
      const payload: FundMoveAuditPayloadV2 = {
        before: {
          v: 2,
          entity: sourceRef,
          fund: { id: source.id, name: source.name, slug: source.slug, kind: source.kind },
          bankAccount:
            locked.bankAccountId && bank && bank !== "missing"
              ? { id: locked.bankAccountId, name: bank.name }
              : null,
          category: beforeCategory,
          budgetLineId: locked.budgetLineId,
        },
        after: {
          v: 2,
          entity: destRef,
          fund: { id: dest.id, name: dest.name, slug: dest.slug, kind: dest.kind },
          bankAccount: { id: destBank.id, name: destBank.name },
          category: afterCategory,
          budgetLineId: null,
        },
        details: {
          v: 2,
          reason: input.reason,
          entityId: locked.entityId,
          destEntityId: dest.entityId,
          crossEntity: true,
          txnDate: locked.txnDate,
          flow: locked.flow as "income" | "expense",
          amountCents: locked.amountCents,
          fiscalYear,
          tier: "manage",
          reconciled: isTransactionReconciled(locked),
          reconciledSessionId: locked.reconciledSessionId,
          priorFiscalYear,
          sentStatementMonth,
          destSentStatementMonth,
          donorId: locked.donorId,
          acknowledgment: {
            id: ack?.id ?? null,
            sent: settlement.outcome === "kept",
            sentAt: settlement.outcome === "kept" && ack?.sentAt ? ack.sentAt.toISOString() : null,
            outcome: settlement.outcome,
            doneeEntityId: ack?.doneeEntityId ?? null,
          },
        },
      };
      await recordLedgerAudit(tx, {
        actorUserId: args.actorUserId,
        action: TRANSACTION_FUND_MOVED_AUDIT_ACTION,
        targetTransactionId: locked.id,
        ...payload,
      });
    } else {
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
          priorFiscalYear,
          sentStatementMonth,
        },
      });
    }

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
        entitySlug: destEntity?.slug ?? "",
        crossEntity,
        acknowledgment: settlement.outcome,
      },
    };
  });
}

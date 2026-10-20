/**
 * Itemized sweep batches, the server half (B-172 Increment 2a, DECISION-126).
 * The client-safe carrier (types, enums, pure verdicts, copy) is ./ledger-sweep.ts.
 *
 * ONE evaluator (`evaluateSweepBatch`) serves preview (on `db`, `lock: false`)
 * and create (inside the create transaction, `lock: true`), so the page can
 * never list what the route would refuse. It locks the SOURCE rows alone,
 * `ORDER BY id FOR UPDATE`, then reads categories, mirror targets, closeouts,
 * live copies, sent acknowledgments, matches and filings in follow-up selects
 * (never an outer join under FOR UPDATE).
 *
 * THIS MODULE IS THE ONLY WRITER of the pointer columns `swept_from_txn_id` and
 * `sweep_leg_txn_id` (scan-tested in ledger-sweep-consolidation.test.ts): the
 * copy rows come from buildSweepCopy() in the carrier and are inserted here.
 * The partial unique index `ux_ledger_txn_swept_from_live` is the last line of
 * defence for two overlapping creates (live check S3).
 *
 * Imports ./ledger-audit (admin-only audit writer): NEVER import this module
 * from src/app/members, src/app/api/members or src/lib/financial-report-*.
 *
 * Approve / reject / co-sign of a batch go through decideTransaction() and
 * cosignTransaction(); nothing here writes a decision column.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ledgerAcknowledgments,
  ledgerCategories,
  ledgerEntities,
  ledgerFilings,
  ledgerFunds,
  ledgerSweepCloseouts,
  ledgerTransactions,
  users,
  type LedgerTransaction,
} from "@/lib/db/schema";
import { currentFiscalYear, getFiscalYear } from "@/lib/fiscal-year";
import { easternDateString } from "@/lib/eastern-date";
import { fundBalanceCents } from "@/lib/ledger";
import { classifyDecisionGroup, displayDeciderName } from "@/lib/ledger-approval";
import { lockDecisionGroup } from "@/lib/ledger-board-decision";
import { notifyPendingApprovers } from "@/lib/ledger-approval-notify";
import { recordLedgerAudit, recordLedgerAuditNote } from "@/lib/ledger-audit";
import {
  SWEEP_BATCH_VOIDED_AUDIT_ACTION,
  type SweepVoidRowSnapshot,
} from "@/lib/ledger-correction";
import { findSentStatementMonth, postedFundRows } from "@/lib/ledger-fund-move-preview";
import { getSettings } from "@/lib/ledger-queries";
import { sweepCopyPredicate, sweptSourceExists } from "@/lib/ledger-sweep-link";
import {
  SWEEP_ERROR_COPY,
  SWEEP_INT4_MAX,
  SWEEP_LEG_CATEGORY_NAME,
  SWEEP_ROW_REFUSAL_COPY,
  SWEEP_VOID_BLOCK_COPY,
  buildSweepCopy,
  checkSweepTotal,
  classifySweepRow,
  foundationReceiptState,
  sweepCopyPeriodVerdict,
  sweepLegMemo,
  sweepTier,
  type SweepBatchCreateRequest,
  type SweepBatchCreatedResponse,
  type SweepBatchDetail,
  type SweepCandidateRow,
  type SweepCandidates,
  type SweepCategoryFacts,
  type SweepCloseoutResponse,
  type SweepCloseoutRow,
  type SweepCloseoutSkip,
  type SweepErrorBody,
  type SweepErrorCode,
  type SweepMirrorFacts,
  type SweepPreviewResponse,
  type SweepPreviewRow,
  type SweepRowFlag,
  type SweepRowRefusal,
  type SweepVoidBlock,
  type SweepVoidErrorBody,
  type SweepVoidResponse,
  type SweepWarning,
} from "@/lib/ledger-sweep";
import { listMatchedTransactionIds } from "@/lib/reconciliation-queries";
import { buildFundLabels, type FundLabels } from "@/lib/ledger-fund-labels";
import { checkTransferDirection } from "@/lib/ledger-transfer-policy";
import { validateBankAccountForEntity } from "@/lib/ledger-transaction-validation";

/** `db` or a transaction handle, for the read-only paths. */
export type SweepReadExec = Pick<typeof db, "select">;

// ---------------------------------------------------------------------------
// Funds
// ---------------------------------------------------------------------------

export interface SweepFund {
  id: string;
  entityId: string;
  kind: string;
  name: string;
  openingBalanceCents: number;
}

export interface SweepFunds {
  source: SweepFund;
  dest: SweepFund;
  labels: FundLabels;
}

/**
 * The destination is resolved from the database, never chosen by the client
 * (A10): the one active charitable fund of the donations-deductible entity,
 * and the one active activity fund of a non-deductible entity as the source.
 * Zero or several of either is null.
 */
export async function resolveSweepFunds(exec: SweepReadExec): Promise<SweepFunds | null> {
  const rows = await exec
    .select({
      id: ledgerFunds.id,
      entityId: ledgerFunds.entityId,
      kind: ledgerFunds.kind,
      name: ledgerFunds.name,
      openingBalanceCents: ledgerFunds.openingBalanceCents,
      isActive: ledgerFunds.isActive,
      deductible: ledgerEntities.donationsDeductible,
    })
    .from(ledgerFunds)
    .innerJoin(ledgerEntities, eq(ledgerEntities.id, ledgerFunds.entityId))
    .where(eq(ledgerFunds.isActive, true));
  const pick = (kind: string, deductible: boolean): SweepFund | null => {
    const matches = rows.filter((r) => r.kind === kind && r.deductible === deductible);
    if (matches.length !== 1) return null;
    const m = matches[0];
    return {
      id: m.id,
      entityId: m.entityId,
      kind: m.kind,
      name: m.name,
      openingBalanceCents: m.openingBalanceCents,
    };
  };
  const source = pick("activity", false);
  const dest = pick("charitable", true);
  if (!source || !dest) return null;
  return {
    source,
    dest,
    labels: buildFundLabels(rows.map((r) => ({ kind: r.kind, name: r.name, isActive: r.isActive }))),
  };
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

interface SweepFacts {
  categories: Map<string, SweepCategoryFacts & { isActive: boolean }>;
  mirrors: Map<string, SweepMirrorFacts>;
  liveCopyIds: Set<string>;
  closedOutIds: Set<string>;
  sentReceiptOn: Map<string, string>;
  matchedIds: Set<string>;
  filedFiscalYears: Set<number>;
}

/**
 * Everything the verdict needs about a set of already-loaded source rows, read
 * with follow-up selects on the same executor (so inside the create
 * transaction they see the state after the source lock was taken).
 */
async function loadSweepFacts(
  exec: SweepReadExec,
  rows: readonly LedgerTransaction[],
  foundationEntityId: string,
): Promise<SweepFacts> {
  const ids = rows.map((r) => r.id);
  const categories = new Map<string, SweepCategoryFacts & { isActive: boolean }>();
  const mirrors = new Map<string, SweepMirrorFacts>();

  const categorySelect = {
    id: ledgerCategories.id,
    name: ledgerCategories.name,
    entityId: ledgerCategories.entityId,
    fundKind: ledgerCategories.fundKind,
    flow: ledgerCategories.flow,
    isActive: ledgerCategories.isActive,
    ackNotRequired: ledgerCategories.ackNotRequired,
    mirrorsCategoryId: ledgerCategories.mirrorsCategoryId,
    entityDonationsDeductible: ledgerEntities.donationsDeductible,
  };

  const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((v): v is string => !!v))];
  if (categoryIds.length > 0) {
    const cats = await exec
      .select(categorySelect)
      .from(ledgerCategories)
      .innerJoin(ledgerEntities, eq(ledgerEntities.id, ledgerCategories.entityId))
      .where(inArray(ledgerCategories.id, categoryIds));
    for (const c of cats) {
      categories.set(c.id, {
        id: c.id,
        name: c.name,
        fundKind: c.fundKind,
        flow: c.flow,
        entityDonationsDeductible: c.entityDonationsDeductible,
        mirrorsCategoryId: c.mirrorsCategoryId,
        isActive: c.isActive,
      });
    }
  }
  const mirrorIds = [
    ...new Set(
      [...categories.values()].map((c) => c.mirrorsCategoryId).filter((v): v is string => !!v),
    ),
  ];
  if (mirrorIds.length > 0) {
    const targets = await exec
      .select(categorySelect)
      .from(ledgerCategories)
      .innerJoin(ledgerEntities, eq(ledgerEntities.id, ledgerCategories.entityId))
      .where(inArray(ledgerCategories.id, mirrorIds));
    for (const t of targets) {
      mirrors.set(t.id, {
        id: t.id,
        name: t.name,
        fundKind: t.fundKind,
        flow: t.flow,
        entityId: t.entityId,
        entityDonationsDeductible: t.entityDonationsDeductible,
        isActive: t.isActive,
        ackNotRequired: t.ackNotRequired,
      });
    }
  }

  const empty = ids.length === 0;
  const liveRows = empty
    ? []
    : await exec
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(and(inArray(ledgerTransactions.id, ids), sweptSourceExists(ledgerTransactions.id)));
  const closeoutRows = empty
    ? []
    : await exec
        .select({ txnId: ledgerSweepCloseouts.txnId })
        .from(ledgerSweepCloseouts)
        .where(inArray(ledgerSweepCloseouts.txnId, ids));
  const sentRows = empty
    ? []
    : await exec
        .select({
          txnId: ledgerAcknowledgments.donationTxnId,
          sentAt: ledgerAcknowledgments.sentAt,
        })
        .from(ledgerAcknowledgments)
        .where(
          and(
            inArray(ledgerAcknowledgments.donationTxnId, ids),
            isNotNull(ledgerAcknowledgments.sentAt),
          ),
        );
  const matchedIds = await listMatchedTransactionIds(exec, ids);
  const filingRows = await exec
    .select({ fiscalYear: ledgerFilings.fiscalYear })
    .from(ledgerFilings)
    .where(
      and(
        eq(ledgerFilings.entityId, foundationEntityId),
        eq(ledgerFilings.agency, "IRS"),
        eq(ledgerFilings.status, "filed"),
      ),
    );

  const sentReceiptOn = new Map<string, string>();
  for (const s of sentRows) {
    if (s.sentAt) sentReceiptOn.set(s.txnId, easternDateString(s.sentAt));
  }
  return {
    categories,
    mirrors,
    liveCopyIds: new Set(liveRows.map((r) => r.id)),
    closedOutIds: new Set(closeoutRows.map((r) => r.txnId)),
    sentReceiptOn,
    matchedIds,
    filedFiscalYears: new Set(filingRows.map((r) => r.fiscalYear)),
  };
}

// ---------------------------------------------------------------------------
// Evaluation (the one evaluator)
// ---------------------------------------------------------------------------

export interface SweepEvalInput {
  sourceIds: readonly string[];
  /** YYYY-MM-DD */
  sweepDate: string;
  bankAmountCents?: number | null;
}

export interface SweepEvalContext {
  funds: SweepFunds;
  callerCanManage: boolean;
  now: Date;
  /** True inside the create transaction: the source rows are locked FOR UPDATE. */
  lock: boolean;
}

export interface SweepEvalRow {
  preview: SweepPreviewRow;
  /** The locked source row, or null when the id matched nothing. */
  source: LedgerTransaction | null;
  /** The mirror target's id when the row is accepted. */
  mirrorCategoryId: string | null;
}

export interface SweepEvaluation {
  /** Every requested id, in request order. */
  rows: SweepEvalRow[];
  accepted: SweepEvalRow[];
  response: SweepPreviewResponse;
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function sortedUnique(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

export async function evaluateSweepBatch(
  exec: SweepReadExec,
  input: SweepEvalInput,
  ctx: SweepEvalContext,
): Promise<SweepEvaluation> {
  const ids = [...input.sourceIds];
  const base = exec
    .select()
    .from(ledgerTransactions)
    .where(inArray(ledgerTransactions.id, ids))
    .orderBy(asc(ledgerTransactions.id));
  // FOR UPDATE on the source rows alone, in id order (no joins under the lock).
  const loaded: LedgerTransaction[] = ctx.lock ? await base.for("update") : await base;
  const byId = new Map(loaded.map((r) => [r.id, r]));

  const facts = await loadSweepFacts(exec, loaded, ctx.funds.dest.entityId);

  // Sent-statement months of the Foundation, once per distinct gift month.
  const months = [...new Set(loaded.map((r) => monthOf(r.txnDate)))];
  const sentMonths = new Set<string>();
  for (const month of months) {
    const sent = await findSentStatementMonth(exec, {
      entityId: ctx.funds.dest.entityId,
      txnDate: `${month}-01`,
      fundKind: ctx.funds.dest.kind,
    });
    if (sent) sentMonths.add(sent);
  }

  const classifyCtx = {
    sourceFundId: ctx.funds.source.id,
    sweepDate: input.sweepDate,
    now: ctx.now,
    callerCanManage: ctx.callerCanManage,
    filedFiscalYears: facts.filedFiscalYears,
  };

  const rows: SweepEvalRow[] = ids.map((id) => {
    const source = byId.get(id) ?? null;
    const category = source?.categoryId ? (facts.categories.get(source.categoryId) ?? null) : null;
    const mirror = category?.mirrorsCategoryId
      ? (facts.mirrors.get(category.mirrorsCategoryId) ?? null)
      : null;
    const refusal = classifySweepRow(
      {
        source: source
          ? {
              id: source.id,
              fundId: source.fundId,
              flow: source.flow,
              status: source.status,
              transferGroupId: source.transferGroupId,
              sweepLegTxnId: source.sweepLegTxnId,
              duesPaymentId: source.duesPaymentId,
              txnDate: source.txnDate,
              amountCents: source.amountCents,
              categoryId: source.categoryId,
            }
          : null,
        category,
        mirror,
        hasLiveCopy: facts.liveCopyIds.has(id),
        closedOut: facts.closedOutIds.has(id),
      },
      classifyCtx,
    );

    const flags: SweepRowFlag[] = [];
    let receiptSentOn: string | null = null;
    if (source) {
      const verdict = sweepCopyPeriodVerdict({
        giftDate: source.txnDate,
        sweepDate: input.sweepDate,
        now: ctx.now,
        filedFiscalYears: facts.filedFiscalYears,
      });
      if (verdict.priorFiscalYear) flags.push("prior_fiscal_year");
      if (sentMonths.has(monthOf(source.txnDate))) flags.push("statement_already_sent");
      receiptSentOn = facts.sentReceiptOn.get(source.id) ?? null;
      if (receiptSentOn) flags.push("receipt_already_sent");
      if (!source.donorId) flags.push("no_donor");
      if (!facts.matchedIds.has(source.id)) flags.push("not_matched_to_deposit");
    }

    const preview: SweepPreviewRow = {
      sourceId: id,
      giftDate: source?.txnDate ?? "",
      amountCents: source?.amountCents ?? 0,
      party: source?.party ?? null,
      categoryName: category?.name ?? null,
      foundationCategoryId: mirror?.id ?? null,
      foundationCategoryName: mirror?.name ?? null,
      foundationReceipt: foundationReceiptState({
        amountCents: source?.amountCents ?? 0,
        mirrorAckNotRequired: mirror?.ackNotRequired ?? true,
        receiptAlreadySent: receiptSentOn !== null,
      }),
      receiptSentOn,
      flags,
      refusal,
    };
    return { preview, source, mirrorCategoryId: refusal === null && mirror ? mirror.id : null };
  });

  const accepted = rows.filter((r) => r.preview.refusal === null);
  const totalCents = accepted.reduce((sum, r) => sum + r.preview.amountCents, 0);
  const count = accepted.length;

  // Tier is read over every row that exists and is not refused for a reason
  // other than the tier itself, so a caller without manage still SEES manage.
  const tierRows = rows.filter(
    (r) => r.source && (r.preview.refusal === null || r.preview.refusal === "manage_required"),
  );
  const tier = sweepTier({
    giftDates: tierRows.map((r) => r.preview.giftDate),
    sweepDate: input.sweepDate,
    now: ctx.now,
  });

  const settings = await getSettings();
  const thresholdCents = settings.disbApprovalThresholdCents;
  const status: "posted" | "pending" = totalCents > thresholdCents ? "pending" : "posted";

  const fiscalYears = sortedUnique([
    getFiscalYear(new Date(input.sweepDate + "T00:00:00")),
    ...accepted.map((r) => getFiscalYear(new Date(r.preview.giftDate + "T00:00:00"))),
  ]);

  const addsByMonth = new Map<string, number>();
  for (const r of accepted) {
    const m = monthOf(r.preview.giftDate);
    if (sentMonths.has(m)) addsByMonth.set(m, (addsByMonth.get(m) ?? 0) + r.preview.amountCents);
  }
  const sentStatementMonths = [...addsByMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, addsCents]) => ({ month, addsCents }));

  const warnings: SweepWarning[] = [];
  if (totalCents > 0) {
    const fundRows = await postedFundRows(exec, ctx.funds.source.id);
    const balance = fundBalanceCents(ctx.funds.source.openingBalanceCents, fundRows);
    if (totalCents > balance) warnings.push({ code: "exceeds_fund_balance", fundBalanceCents: balance });
  }
  const unmatched = accepted.filter((r) => r.preview.flags.includes("not_matched_to_deposit")).length;
  if (unmatched > 0) warnings.push({ code: "unmatched_sources", count: unmatched });
  const noDonor = accepted.filter((r) => r.preview.flags.includes("no_donor")).length;
  if (noDonor > 0) warnings.push({ code: "no_donor", count: noDonor });

  const typed = input.bankAmountCents ?? null;
  const anyRefusal = rows.some((r) => r.preview.refusal !== null);
  const response: SweepPreviewResponse = {
    rows: rows.map((r) => r.preview),
    totalCents,
    count,
    tier,
    needsReason: tier === "manage",
    status,
    thresholdCents,
    fiscalYears,
    sentStatementMonths,
    warnings,
    typedBankAmountCents: typed,
    differenceCents: typed === null ? null : typed - totalCents,
    // B1: never say "go" to what create refuses (`total_too_large`, S22).
    canPost:
      count > 0 &&
      !anyRefusal &&
      !(tier === "manage" && !ctx.callerCanManage) &&
      totalCents <= SWEEP_INT4_MAX,
  };
  return { rows, accepted, response };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export type SweepFailure = { ok: false; status: 400 | 403 | 404 | 409; body: SweepErrorBody };

function sweepFailure(
  status: SweepFailure["status"],
  code: SweepErrorCode,
  labels: FundLabels,
  extra: Partial<SweepErrorBody> = {},
): SweepFailure {
  return { ok: false, status, body: { error: SWEEP_ERROR_COPY[code](labels), code, ...extra } };
}

function refusedRows(rows: readonly SweepEvalRow[]): { sourceId: string; code: SweepRowRefusal }[] {
  return rows.flatMap((r) =>
    r.preview.refusal ? [{ sourceId: r.preview.sourceId, code: r.preview.refusal }] : [],
  );
}

/** Message for one refusal, for a route that wants to name it. */
export function sweepRefusalMessage(code: SweepRowRefusal, labels: FundLabels): string {
  return SWEEP_ROW_REFUSAL_COPY[code](labels);
}

/** Message and next step for one void block. */
export function sweepVoidBlockMessage(
  code: SweepVoidBlock,
  labels: FundLabels,
): { message: string; nextStep: string } {
  return SWEEP_VOID_BLOCK_COPY[code](labels);
}

/**
 * Direction and bank-account gates shared by preview and create. Preview calls
 * it on `db`; create calls it before opening its transaction.
 */
export async function resolveSweepContext(
  exec: SweepReadExec,
  input: { sourceBankAccountId: string; destBankAccountId: string },
): Promise<{ ok: true; funds: SweepFunds } | SweepFailure> {
  const funds = await resolveSweepFunds(exec);
  if (!funds) {
    return sweepFailure(404, "fund_not_found", buildFundLabels([]));
  }
  const direction = checkTransferDirection(
    { entityId: funds.source.entityId, fundId: funds.source.id, kind: funds.source.kind, name: funds.source.name },
    { entityId: funds.dest.entityId, fundId: funds.dest.id, kind: funds.dest.kind, name: funds.dest.name },
  );
  if (!direction.allowed || direction.mode !== "sweep") {
    return sweepFailure(403, "direction_denied", funds.labels);
  }
  const sourceBank = await validateBankAccountForEntity(exec, input.sourceBankAccountId, funds.source.entityId, {
    requireActive: true,
  });
  if (!sourceBank.ok) return sweepFailure(400, "bank_account_invalid", funds.labels);
  const destBank = await validateBankAccountForEntity(exec, input.destBankAccountId, funds.dest.entityId, {
    requireActive: true,
  });
  if (!destBank.ok) return sweepFailure(400, "bank_account_invalid", funds.labels);
  return { ok: true, funds };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewSweepBatch(
  input: {
    sourceIds: readonly string[];
    sourceBankAccountId: string;
    destBankAccountId: string;
    sweepDate: string;
    bankAmountCents?: number | null;
  },
  actor: { callerCanManage: boolean },
  now: Date = new Date(),
): Promise<{ ok: true; response: SweepPreviewResponse } | SweepFailure> {
  const context = await resolveSweepContext(db, input);
  if (!context.ok) return context;
  const evaluation = await evaluateSweepBatch(db, input, {
    funds: context.funds,
    callerCanManage: actor.callerCanManage,
    now,
    lock: false,
  });
  return { ok: true, response: evaluation.response };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

class SweepRollback extends Error {}

/** A `23505` on the live-copy unique index, however the driver wraps it. */
export function isSweepClaimConflict(error: unknown): boolean {
  const seen = new Set<unknown>();
  let cursor: unknown = error;
  while (cursor && typeof cursor === "object" && !seen.has(cursor)) {
    seen.add(cursor);
    const e = cursor as { code?: unknown; constraint?: unknown; constraint_name?: unknown; message?: unknown; cause?: unknown };
    if (e.code === "23505") {
      const text = `${String(e.constraint ?? "")} ${String(e.constraint_name ?? "")} ${String(e.message ?? "")}`;
      if (text.includes("ux_ledger_txn_swept_from_live")) return true;
    }
    cursor = e.cause;
  }
  return false;
}

export async function createSweepBatch(
  input: SweepBatchCreateRequest & { sweepDate: string },
  actor: { userId: string; callerCanManage: boolean },
  now: Date = new Date(),
): Promise<{ ok: true; response: SweepBatchCreatedResponse } | SweepFailure> {
  const context = await resolveSweepContext(db, input);
  if (!context.ok) return context;
  const funds = context.funds;
  const evalInput: SweepEvalInput = {
    sourceIds: input.sourceIds,
    sweepDate: input.sweepDate,
    bankAmountCents: input.bankAmountCents,
  };

  let outcome: { ok: true; response: SweepBatchCreatedResponse } | SweepFailure;
  try {
    outcome = await db.transaction(async (tx) => {
      const evaluation = await evaluateSweepBatch(tx, evalInput, {
        funds,
        callerCanManage: actor.callerCanManage,
        now,
        lock: true,
      });
      const refusals = refusedRows(evaluation.rows);
      if (refusals.length > 0) {
        if (refusals.every((r) => r.code === "already_swept")) {
          return sweepFailure(409, "rows_claimed", funds.labels, { rows: refusals });
        }
        if (refusals.every((r) => r.code === "manage_required")) {
          return sweepFailure(403, "manage_required", funds.labels, { rows: refusals });
        }
        return sweepFailure(409, "rows_refused", funds.labels, { rows: refusals });
      }
      const summary = evaluation.response;
      if (summary.count === 0) return sweepFailure(400, "no_rows", funds.labels);
      if (summary.tier === "manage" && !actor.callerCanManage) {
        return sweepFailure(403, "manage_required", funds.labels);
      }
      if (summary.needsReason && !input.priorYearReason) {
        return sweepFailure(400, "reason_required", funds.labels);
      }
      const totalCheck = checkSweepTotal(summary.totalCents, input.bankAmountCents);
      if (!totalCheck.ok) {
        return sweepFailure(400, totalCheck.code, funds.labels, {
          derivedCents: summary.totalCents,
          typedCents: input.bankAmountCents,
        });
      }

      // The leg's category: the Club "Transfer to Foundation" expense category
      // when one exists (active first, then lowest sort order, then id), else
      // none, which is what the lump leg writes today (ruling A1).
      const legCategory = await tx
        .select({ id: ledgerCategories.id })
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, funds.source.entityId),
            eq(ledgerCategories.fundKind, funds.source.kind),
            eq(ledgerCategories.flow, "expense"),
            eq(ledgerCategories.name, SWEEP_LEG_CATEGORY_NAME),
          ),
        )
        .orderBy(desc(ledgerCategories.isActive), asc(ledgerCategories.sortOrder), asc(ledgerCategories.id))
        .limit(1);

      const transferGroupId = crypto.randomUUID();
      const insertedLegs = await tx
        .insert(ledgerTransactions)
        .values({
          entityId: funds.source.entityId,
          fundId: funds.source.id,
          bankAccountId: input.sourceBankAccountId,
          txnDate: input.sweepDate,
          flow: "expense",
          categoryId: legCategory[0]?.id ?? null,
          amountCents: summary.totalCents,
          memo: sweepLegMemo(summary.count),
          transferGroupId,
          boardMinute: input.boardMinute,
          status: summary.status,
          recordedByUserId: actor.userId,
        })
        .returning({ id: ledgerTransactions.id });
      const legId = insertedLegs[0]?.id;
      if (!legId) throw new SweepRollback("leg insert returned nothing");

      const copies = evaluation.accepted.map((r) =>
        buildSweepCopy(
          {
            id: (r.source as LedgerTransaction).id,
            amountCents: (r.source as LedgerTransaction).amountCents,
            txnDate: (r.source as LedgerTransaction).txnDate,
            party: (r.source as LedgerTransaction).party,
            memo: (r.source as LedgerTransaction).memo,
            beneficiaryCause: (r.source as LedgerTransaction).beneficiaryCause,
            paymentMethod: (r.source as LedgerTransaction).paymentMethod,
            donorId: (r.source as LedgerTransaction).donorId,
          },
          r.mirrorCategoryId as string,
          {
            legId,
            foundationEntityId: funds.dest.entityId,
            foundationFundId: funds.dest.id,
            destBankAccountId: input.destBankAccountId,
            boardMinute: input.boardMinute,
            status: summary.status,
            recordedByUserId: actor.userId,
          },
        ),
      );
      const insertedCopies = await tx
        .insert(ledgerTransactions)
        .values(copies)
        .returning({ id: ledgerTransactions.id, sourceId: ledgerTransactions.sweptFromTxnId });
      if (insertedCopies.length !== copies.length) {
        // Rollback sentinel: a plain return would commit a half-written batch.
        throw new SweepRollback("copy insert count mismatch");
      }
      const copyBySource = new Map(insertedCopies.map((c) => [c.sourceId, c.id]));

      await recordLedgerAuditNote(tx, {
        actorUserId: actor.userId,
        action: "sweep_batch_created",
        before: null,
        after: {
          legId,
          count: summary.count,
          totalCents: summary.totalCents,
          status: summary.status,
          sweepDate: input.sweepDate,
          tier: summary.tier,
          fiscalYears: summary.fiscalYears,
          sentStatementMonths: summary.sentStatementMonths.map((m) => m.month),
        },
        details:
          `Itemized sweep of ${summary.count} ${summary.count === 1 ? "gift" : "gifts"} created (${summary.status}).` +
          (input.priorYearReason ? ` Prior-year reason: ${input.priorYearReason}` : ""),
      });

      return {
        ok: true as const,
        response: {
          legId,
          transferGroupId,
          copyIds: evaluation.accepted.map((r) => copyBySource.get(r.preview.sourceId) as string),
          status: summary.status,
          totalCents: summary.totalCents,
          count: summary.count,
        },
      };
    });
  } catch (error) {
    if (isSweepClaimConflict(error)) {
      // The index caught a claim the lock-and-read missed. Name the rows.
      const after = await evaluateSweepBatch(db, evalInput, {
        funds,
        callerCanManage: actor.callerCanManage,
        now,
        lock: false,
      });
      return sweepFailure(409, "rows_claimed", funds.labels, {
        rows: refusedRows(after.rows).filter((r) => r.code === "already_swept"),
      });
    }
    throw error;
  }

  if (outcome.ok && outcome.response.status === "pending") {
    const amountDollars = (outcome.response.totalCents / 100).toFixed(2);
    try {
      // Count only: no party and no memo ever reach the approvers (A8).
      await notifyPendingApprovers({
        noun: "sweep",
        subject: `Sweep pending your approval — $${amountDollars}`,
        amountDollars,
        txnDate: input.sweepDate,
        reviewTxnId: outcome.response.legId,
        batch: { count: outcome.response.count },
      });
    } catch (error) {
      console.error("[Ledger email] Sweep batch approver notification failed:", error);
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Detail (GET)
// ---------------------------------------------------------------------------

/** The batch as every viewer may read it. No party, memo or donor field. */
export async function getSweepBatchDetail(
  exec: SweepReadExec,
  legId: string,
): Promise<SweepBatchDetail | null> {
  const legRows = await exec.select().from(ledgerTransactions).where(eq(ledgerTransactions.id, legId)).limit(1);
  const leg = legRows[0];
  if (!leg || leg.flow !== "expense" || leg.sweepLegTxnId !== null) return null;
  const copies = await exec
    .select()
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.sweepLegTxnId, legId))
    .orderBy(asc(ledgerTransactions.id));
  if (copies.length === 0) return null;

  const categoryIds = [...new Set(copies.map((c) => c.categoryId).filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (categoryIds.length > 0) {
    const cats = await exec
      .select({ id: ledgerCategories.id, name: ledgerCategories.name })
      .from(ledgerCategories)
      .where(inArray(ledgerCategories.id, categoryIds));
    for (const c of cats) names.set(c.id, c.name);
  }
  const byCategory = new Map<string, { name: string; count: number; cents: number }>();
  for (const c of copies) {
    const key = c.categoryId ?? "none";
    const entry = byCategory.get(key) ?? {
      name: (c.categoryId ? names.get(c.categoryId) : null) ?? "Uncategorized",
      count: 0,
      cents: 0,
    };
    entry.count += 1;
    entry.cents += c.amountCents;
    byCategory.set(key, entry);
  }

  let recordedBy: string | null = null;
  const userRows = await exec.select({ name: users.name }).from(users).where(eq(users.id, leg.recordedByUserId)).limit(1);
  recordedBy = displayDeciderName(userRows[0]?.name);

  const giftDates = copies.map((c) => c.txnDate).sort();

  return {
    legId: leg.id,
    status: leg.status,
    sweepDate: leg.txnDate,
    boardMinute: leg.boardMinute,
    recordedBy,
    count: copies.length,
    totalCents: copies.reduce((sum, c) => sum + c.amountCents, 0),
    byCategory: [...byCategory.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
    fiscalYears: sortedUnique([
      getFiscalYear(new Date(leg.txnDate + "T00:00:00")),
      ...copies.map((c) => getFiscalYear(new Date(c.txnDate + "T00:00:00"))),
    ]),
    approved: leg.approvedAt !== null,
    reconciled: [leg, ...copies].some((r) => r.reconciled || r.reconciledSessionId !== null),
    earliestGiftDate: giftDates[0],
    latestGiftDate: giftDates[giftDates.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

function voidBlock(
  status: 404 | 409,
  code: SweepVoidBlock,
  labels: FundLabels,
): { ok: false; status: 404 | 409; body: SweepVoidErrorBody } {
  const copy = SWEEP_VOID_BLOCK_COPY[code](labels);
  return { ok: false, status, body: { error: `${copy.message} ${copy.nextStep}`, code } };
}

/**
 * Void a batch: delete the copies, then the leg (RESTRICT forces that order),
 * and write the `sweep_batch_voided` correction audit in the same transaction.
 * Refuses an approved, reconciled, matched, receipted, prior-year or filed
 * batch, and a pending one (reject it instead). The route gates on
 * `ledger.manage`; `reason` arrives normalized.
 */
export async function voidSweepBatch(
  legId: string,
  actor: { userId: string },
  reason: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; response: SweepVoidResponse }
  | { ok: false; status: 404 | 409; body: SweepVoidErrorBody }
> {
  const labels = buildFundLabels([]);
  return db.transaction(async (tx) => {
    const locked = await lockDecisionGroup(tx, legId, "update");
    const group = classifyDecisionGroup(legId, locked);
    if (!locked.some((r) => r.id === legId)) return voidBlock(404, "not_found", labels);
    if (group.kind !== "sweep_batch") return voidBlock(404, "not_a_sweep", labels);
    const { leg, copies } = group;
    const copyIds = copies.map((c) => c.id);

    if (leg.status === "pending") return voidBlock(409, "pending_use_reject", labels);
    if (leg.status === "rejected") return voidBlock(409, "already_rejected", labels);
    if (leg.approvedAt !== null) return voidBlock(409, "approved", labels);
    if (locked.some((r) => r.reconciled || r.reconciledSessionId !== null)) {
      return voidBlock(409, "reconciled", labels);
    }
    const matched = await listMatchedTransactionIds(
      tx,
      locked.map((r) => r.id),
    );
    if (matched.size > 0) return voidBlock(409, "matched", labels);

    const receiptRows = await tx
      .select({ id: ledgerAcknowledgments.id, sentAt: ledgerAcknowledgments.sentAt })
      .from(ledgerAcknowledgments)
      .where(inArray(ledgerAcknowledgments.donationTxnId, copyIds));
    if (receiptRows.some((r) => r.sentAt !== null)) return voidBlock(409, "receipt_sent", labels);

    const legFiscalYear = getFiscalYear(new Date(leg.txnDate + "T00:00:00"));
    if (legFiscalYear < currentFiscalYear(now)) return voidBlock(409, "prior_fiscal_year", labels);

    const foundationEntityId = copies[0].entityId;
    const filings = await tx
      .select({ fiscalYear: ledgerFilings.fiscalYear })
      .from(ledgerFilings)
      .where(
        and(
          eq(ledgerFilings.entityId, foundationEntityId),
          eq(ledgerFilings.agency, "IRS"),
          eq(ledgerFilings.status, "filed"),
        ),
      );
    const filed = new Set(filings.map((f) => f.fiscalYear));
    const copyFiscalYears = sortedUnique(
      copies.map((c) => getFiscalYear(new Date(c.txnDate + "T00:00:00"))),
    );
    if (copyFiscalYears.some((y) => filed.has(y))) return voidBlock(409, "period_filed", labels);

    // Snapshot: ids, dates, amounts, status, category and bank-account ids. No party, memo or donor id.
    const entityRows = await tx
      .select({
        id: ledgerEntities.id,
        name: ledgerEntities.name,
        shortName: ledgerEntities.shortName,
        slug: ledgerEntities.slug,
      })
      .from(ledgerEntities)
      .where(inArray(ledgerEntities.id, [leg.entityId, foundationEntityId]));
    const fundRows = await tx
      .select({
        id: ledgerFunds.id,
        name: ledgerFunds.name,
        slug: ledgerFunds.slug,
        kind: ledgerFunds.kind,
      })
      .from(ledgerFunds)
      .where(inArray(ledgerFunds.id, [leg.fundId, copies[0].fundId]));
    const entityOf = (id: string) => {
      const e = entityRows.find((x) => x.id === id);
      return { id, name: e ? (e.shortName ?? e.name) : "", slug: e?.slug ?? "" };
    };
    const fundOf = (id: string) => {
      const f = fundRows.find((x) => x.id === id);
      return { id, name: f?.name ?? "", slug: f?.slug ?? "", kind: f?.kind ?? "" };
    };
    const snapshot = (r: LedgerTransaction): SweepVoidRowSnapshot => ({
      id: r.id,
      entity: entityOf(r.entityId),
      fund: fundOf(r.fundId),
      bankAccountId: r.bankAccountId,
      categoryId: r.categoryId,
      txnDate: r.txnDate,
      flow: r.flow as "income" | "expense",
      amountCents: r.amountCents,
      status: r.status,
      sweptFromTxnId: r.sweptFromTxnId,
    });

    await recordLedgerAudit(tx, {
      actorUserId: actor.userId,
      action: SWEEP_BATCH_VOIDED_AUDIT_ACTION,
      targetTransactionId: null,
      before: { v: 1, leg: snapshot(leg), copies: copies.map(snapshot) },
      after: null,
      details: {
        v: 1,
        reason,
        entityId: leg.entityId,
        destEntityId: foundationEntityId,
        txnDate: leg.txnDate,
        amountCents: leg.amountCents,
        fiscalYear: legFiscalYear,
        count: copies.length,
        legStatus: leg.status,
        copyFiscalYears,
        unsentAcknowledgmentsRemoved: receiptRows.length,
      },
    });

    const deletedCopies = await tx
      .delete(ledgerTransactions)
      .where(inArray(ledgerTransactions.id, copyIds))
      .returning({ id: ledgerTransactions.id });
    if (deletedCopies.length !== copyIds.length) throw new SweepRollback("copy delete count mismatch");
    const deletedLeg = await tx
      .delete(ledgerTransactions)
      .where(eq(ledgerTransactions.id, leg.id))
      .returning({ id: ledgerTransactions.id });
    if (deletedLeg.length !== 1) throw new SweepRollback("leg delete count mismatch");

    return {
      ok: true as const,
      response: {
        voided: true as const,
        copiesRemoved: deletedCopies.length,
        acknowledgmentsRemoved: receiptRows.length,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Candidates (library only in 2a; the builder page is 2b)
// ---------------------------------------------------------------------------

/**
 * The gifts the builder offers. Rows already swept or closed out are not
 * listed (they are done); a gift a still-PENDING batch holds is reported by id.
 * Every remaining row goes through the same classifySweepRow() verdict as
 * preview and create, so this list cannot offer what the route would refuse.
 */
export async function listSweepCandidates(
  exec: SweepReadExec,
  opts: { now: Date; cap?: number; callerCanManage?: boolean; sweepDate?: string },
): Promise<SweepCandidates> {
  const cap = opts.cap ?? 500;
  const funds = await resolveSweepFunds(exec);
  const out: SweepCandidates = { eligible: [], heldBack: [], inPendingBatch: [] };
  if (!funds) return out;

  const rows = await exec
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, funds.source.id),
        eq(ledgerTransactions.flow, "income"),
        eq(ledgerTransactions.status, "posted"),
        sql`NOT ${sweptSourceExists(ledgerTransactions.id)}`,
        sql`NOT EXISTS (SELECT 1 FROM ${ledgerSweepCloseouts} AS sc WHERE sc.txn_id = ${ledgerTransactions.id})`,
      ),
    )
    .orderBy(asc(ledgerTransactions.txnDate), asc(ledgerTransactions.id))
    .limit(cap);

  const pending = await exec
    .select({ sourceId: ledgerTransactions.sweptFromTxnId })
    .from(ledgerTransactions)
    .where(and(sweepCopyPredicate(), eq(ledgerTransactions.status, "pending")));
  out.inPendingBatch = pending.map((p) => p.sourceId).filter((v): v is string => !!v);

  const facts = await loadSweepFacts(exec, rows, funds.dest.entityId);
  const sweepDate = opts.sweepDate ?? easternDateString(opts.now);
  for (const source of rows) {
    const category = source.categoryId ? (facts.categories.get(source.categoryId) ?? null) : null;
    const mirror = category?.mirrorsCategoryId ? (facts.mirrors.get(category.mirrorsCategoryId) ?? null) : null;
    const refusal = classifySweepRow(
      {
        source: {
          id: source.id,
          fundId: source.fundId,
          flow: source.flow,
          status: source.status,
          transferGroupId: source.transferGroupId,
          sweepLegTxnId: source.sweepLegTxnId,
          duesPaymentId: source.duesPaymentId,
          txnDate: source.txnDate,
          amountCents: source.amountCents,
          categoryId: source.categoryId,
        },
        category,
        mirror,
        hasLiveCopy: facts.liveCopyIds.has(source.id),
        closedOut: facts.closedOutIds.has(source.id),
      },
      {
        sourceFundId: funds.source.id,
        sweepDate,
        now: opts.now,
        callerCanManage: opts.callerCanManage ?? true,
        filedFiscalYears: facts.filedFiscalYears,
      },
    );
    const row: SweepCandidateRow = {
      sourceId: source.id,
      giftDate: source.txnDate,
      amountCents: source.amountCents,
      party: source.party,
      categoryName: category?.name ?? null,
      foundationCategoryName: mirror?.name ?? null,
      hasDonor: source.donorId !== null,
    };
    if (refusal === null) out.eligible.push(row);
    else out.heldBack.push({ row, refusal });
  }
  return out;
}

/**
 * Gifts marked "already handled", newest mark first (B10). 2a excludes these
 * from `listSweepCandidates` in SQL, so this is the only list an Unmark can
 * be driven from. Callers gate on `ledger.manage` (it carries a free-text reason).
 */
export async function listSweepCloseouts(exec: SweepReadExec): Promise<SweepCloseoutRow[]> {
  const rows = await exec
    .select({
      sourceId: ledgerSweepCloseouts.txnId,
      reason: ledgerSweepCloseouts.reason,
      closedAt: ledgerSweepCloseouts.closedAt,
      giftDate: ledgerTransactions.txnDate,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      categoryName: ledgerCategories.name,
    })
    .from(ledgerSweepCloseouts)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerSweepCloseouts.txnId))
    .leftJoin(ledgerCategories, eq(ledgerCategories.id, ledgerTransactions.categoryId))
    .orderBy(desc(ledgerSweepCloseouts.closedAt), asc(ledgerSweepCloseouts.txnId));
  return rows.map((r) => ({
    sourceId: r.sourceId,
    giftDate: r.giftDate,
    amountCents: r.amountCents,
    party: r.party,
    categoryName: r.categoryName,
    reason: r.reason,
    closedAt: r.closedAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Closeouts ("already handled": a gift the 2026-10-01 lump or another path covered)
// ---------------------------------------------------------------------------

export async function markSweepCloseouts(
  input: { sourceIds: readonly string[]; reason: string },
  actor: { userId: string },
): Promise<SweepCloseoutResponse> {
  return db.transaction(async (tx) => {
    const funds = await resolveSweepFunds(tx);
    const ids = [...input.sourceIds];
    const rows = await tx
      .select()
      .from(ledgerTransactions)
      .where(inArray(ledgerTransactions.id, ids))
      .orderBy(asc(ledgerTransactions.id))
      .for("update");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const live = await tx
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(and(inArray(ledgerTransactions.id, ids), sweptSourceExists(ledgerTransactions.id)));
    const liveIds = new Set(live.map((r) => r.id));
    const closed = await tx
      .select({ txnId: ledgerSweepCloseouts.txnId })
      .from(ledgerSweepCloseouts)
      .where(inArray(ledgerSweepCloseouts.txnId, ids));
    const closedIds = new Set(closed.map((r) => r.txnId));

    const skipped: { sourceId: string; code: SweepCloseoutSkip }[] = [];
    const toClose: string[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      let code: SweepCloseoutSkip | null = null;
      if (!r) code = "not_found";
      else if (!funds || r.fundId !== funds.source.id) code = "wrong_fund";
      else if (r.flow !== "income") code = "not_income";
      else if (r.status !== "posted") code = "not_posted";
      else if (r.transferGroupId !== null || r.sweepLegTxnId !== null) code = "transfer_leg";
      else if (liveIds.has(id)) code = "already_swept";
      else if (closedIds.has(id)) code = "already_closed_out";
      if (code) skipped.push({ sourceId: id, code });
      else toClose.push(id);
    }

    let changed = 0;
    if (toClose.length > 0) {
      const inserted = await tx
        .insert(ledgerSweepCloseouts)
        .values(toClose.map((txnId) => ({ txnId, reason: input.reason, closedByUserId: actor.userId })))
        .onConflictDoNothing()
        .returning({ txnId: ledgerSweepCloseouts.txnId });
      changed = inserted.length;
      const insertedIds = new Set(inserted.map((i) => i.txnId));
      for (const id of toClose) {
        if (!insertedIds.has(id)) skipped.push({ sourceId: id, code: "already_closed_out" });
      }
    }
    if (changed > 0) {
      await recordLedgerAuditNote(tx, {
        actorUserId: actor.userId,
        action: "sweep_closeout_marked",
        before: null,
        after: { count: changed },
        details: `Marked ${changed} ${changed === 1 ? "gift" : "gifts"} as already handled. Reason: ${input.reason}`,
      });
    }
    return { changed, skipped };
  });
}

export async function unmarkSweepCloseouts(
  input: { sourceIds: readonly string[] },
  actor: { userId: string },
): Promise<SweepCloseoutResponse> {
  return db.transaction(async (tx) => {
    const ids = [...input.sourceIds];
    const removed = await tx
      .delete(ledgerSweepCloseouts)
      .where(inArray(ledgerSweepCloseouts.txnId, ids))
      .returning({ txnId: ledgerSweepCloseouts.txnId });
    const removedIds = new Set(removed.map((r) => r.txnId));
    const skipped = ids
      .filter((id) => !removedIds.has(id))
      .map((sourceId) => ({ sourceId, code: "not_closed_out" as const }));
    const changed = removed.length;
    if (changed > 0) {
      await recordLedgerAuditNote(tx, {
        actorUserId: actor.userId,
        action: "sweep_closeout_unmarked",
        before: { count: changed },
        after: null,
        details: `Cleared the already-handled mark on ${changed} ${changed === 1 ? "gift" : "gifts"}.`,
      });
    }
    return { changed, skipped };
  });
}

/**
 * Itemized sweep batches (B-172 Increment 2a, DECISION-126). The client-safe
 * CARRIER: zero runtime `@/lib/db` imports (a scan test asserts it). Every
 * request and response type, every enum the UI branches on, the pure verdict
 * and builder functions, and the user-facing copy live here, so a removed or
 * widened member breaks `tsc` at every consumer.
 *
 * A batch is one Club expense LEG (Public Funds, the sweep date, a generated
 * memo, the batch id) plus N Foundation income COPIES (one per source gift, the
 * GIFT date, the source's mirror category). There is no batch table and no
 * Foundation credit row. The server half is ./ledger-sweep-batch.ts.
 *
 * Fund display names are never typed here: copy is a function of `FundLabels`
 * (DECISION-127; fund-name-literal-scan.test.ts bans the literals).
 */

import { isUuid } from "@/lib/utils";
import { currentFiscalYear, getFiscalYear } from "@/lib/fiscal-year";
import { ACK_MIN_CENTS, parseIsoDate } from "@/lib/ledger";
import { BOARD_MINUTE_MAX_LEN } from "@/lib/ledger-approval";
import { checkCategoryMirror } from "@/lib/ledger-category-mirror";
import { REASON_LIMITS, normalizeCorrectionReason } from "@/lib/ledger-correction";
import { DEFAULT_FUND_LABELS, type FundLabels } from "@/lib/ledger-fund-labels";

export { REASON_LIMITS, BOARD_MINUTE_MAX_LEN };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Most gifts one batch may carry. */
export const SWEEP_BATCH_MAX = 200;

/** Name of the Club expense category the leg is filed under, when one exists (ruling A1). */
export const SWEEP_LEG_CATEGORY_NAME = "Transfer to Foundation";

/** `amount_cents` is a Postgres `integer`. */
export const SWEEP_INT4_MAX = 2_147_483_647;

/** The generated memo of a leg (A8): there is no free-text memo on a batch. */
export function sweepLegMemo(count: number): string {
  return `Itemized sweep: ${count} ${count === 1 ? "gift" : "gifts"}`;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Why one source gift cannot be swept, in evaluation order (the first that holds wins). */
export const SWEEP_ROW_REFUSALS = [
  "not_found",
  "wrong_fund",
  "not_income",
  "not_posted",
  "transfer_leg",
  "dues_synced",
  "already_swept",
  "closed_out",
  "no_category",
  "no_mirror",
  "mirror_inactive",
  "mirror_invalid",
  "gift_after_sweep",
  "period_filed",
  "manage_required",
] as const;
export type SweepRowRefusal = (typeof SWEEP_ROW_REFUSALS)[number];

/** Notes on an accepted row that never block. */
export type SweepRowFlag =
  | "prior_fiscal_year"
  | "statement_already_sent"
  | "receipt_already_sent"
  | "no_donor"
  | "not_matched_to_deposit";

/** Batch-level notes that never block. */
export type SweepWarning =
  | { code: "exceeds_fund_balance"; fundBalanceCents: number }
  | { code: "unmatched_sources"; count: number }
  | { code: "no_donor"; count: number };

export type SweepErrorCode =
  | "invalid_body"
  | "invalid_id"
  | "no_rows"
  | "batch_too_large"
  | "duplicate_ids"
  | "invalid_date"
  | "future_date"
  | "invalid_amount"
  | "minute_required"
  | "reason_required"
  | "bank_account_invalid"
  | "fund_not_found"
  | "direction_denied"
  | "manage_required"
  | "rows_refused"
  | "rows_claimed"
  | "total_mismatch"
  | "total_too_large"
  /** The lump Transfer/Sweep route answers this (Increment 2b): a sweep is an itemized batch. */
  | "use_sweep_batch";

export type SweepVoidBlock =
  | "not_found"
  | "not_a_sweep"
  | "pending_use_reject"
  | "already_rejected"
  | "approved"
  | "reconciled"
  | "matched"
  | "receipt_sent"
  | "prior_fiscal_year"
  | "period_filed";

export type SweepCloseoutSkip =
  | "not_found"
  | "wrong_fund"
  | "not_income"
  | "not_posted"
  | "transfer_leg"
  | "already_swept"
  | "already_closed_out"
  | "not_closed_out";

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

export interface SweepPreviewRequest {
  sourceIds: string[];
  sourceBankAccountId: string;
  destBankAccountId: string;
  /** YYYY-MM-DD; defaults to the Eastern date. */
  sweepDate?: string;
  /** What the treasurer sees in the bank; compared with the derived total. */
  bankAmountCents?: number;
}

export interface SweepBatchCreateRequest extends SweepPreviewRequest {
  boardMinute: string;
  bankAmountCents: number;
  /** Required when the batch is `manage` tier (a prior-year gift or sweep date). */
  priorYearReason?: string;
}

export type FoundationReceiptState = "may_be_needed" | "not_needed" | "already_sent";

export interface SweepPreviewRow {
  sourceId: string;
  giftDate: string;
  amountCents: number;
  /** Allowed only because the route is `ledger.record`-gated like the register. */
  party: string | null;
  categoryName: string | null;
  foundationCategoryId: string | null;
  foundationCategoryName: string | null;
  foundationReceipt: FoundationReceiptState;
  receiptSentOn: string | null;
  flags: SweepRowFlag[];
  refusal: SweepRowRefusal | null;
}

export interface SweepPreviewResponse {
  /** Every requested id, in request order. */
  rows: SweepPreviewRow[];
  /** Sum of rows with `refusal === null` only. */
  totalCents: number;
  count: number;
  tier: "record" | "manage";
  needsReason: boolean;
  status: "posted" | "pending";
  thresholdCents: number;
  fiscalYears: number[];
  sentStatementMonths: { month: string; addsCents: number }[];
  warnings: SweepWarning[];
  typedBankAmountCents: number | null;
  /** Typed minus derived; null when no amount was typed. */
  differenceCents: number | null;
  canPost: boolean;
}

export interface SweepBatchCreatedResponse {
  legId: string;
  transferGroupId: string;
  copyIds: string[];
  status: "posted" | "pending";
  totalCents: number;
  count: number;
}

export interface SweepErrorBody {
  error: string;
  code: SweepErrorCode;
  rows?: { sourceId: string; code: SweepRowRefusal }[];
  derivedCents?: number;
  typedCents?: number;
}

/** No party, memo or donor field, ever: every viewer of an approval may read it. */
export interface SweepBatchDetail {
  legId: string;
  status: string;
  sweepDate: string;
  boardMinute: string | null;
  recordedBy: string | null;
  count: number;
  totalCents: number;
  byCategory: { name: string; count: number; cents: number }[];
  fiscalYears: number[];
  approved: boolean;
  reconciled: boolean;
  /** Oldest and newest GIFT date among the copies (B8); never a party, memo or donor. */
  earliestGiftDate: string;
  latestGiftDate: string;
}

export interface SweepVoidResponse {
  voided: true;
  copiesRemoved: number;
  acknowledgmentsRemoved: number;
}

export interface SweepVoidErrorBody {
  error: string;
  code: SweepVoidBlock | "reason_required";
}

export interface SweepCloseoutRequest {
  action: "mark" | "unmark";
  sourceIds: string[];
  /** Required (and `normalizeCorrectionReason`-valid) for `mark`. */
  reason?: string;
}

export interface SweepCloseoutResponse {
  changed: number;
  skipped: { sourceId: string; code: SweepCloseoutSkip }[];
}

/** One gift on the builder's list (library result; no route in Increment 2a). */
export interface SweepCandidateRow {
  sourceId: string;
  giftDate: string;
  amountCents: number;
  party: string | null;
  categoryName: string | null;
  foundationCategoryName: string | null;
  hasDonor: boolean;
}

export interface SweepCandidates {
  eligible: SweepCandidateRow[];
  heldBack: { row: SweepCandidateRow; refusal: SweepRowRefusal }[];
  /** Source ids a still-pending batch holds. */
  inPendingBatch: string[];
}

/** One gift marked "already handled" (B10), for the builder's Unmark list. */
export interface SweepCloseoutRow {
  sourceId: string;
  giftDate: string;
  amountCents: number;
  party: string | null;
  categoryName: string | null;
  reason: string;
  /** ISO instant. */
  closedAt: string;
}

/** Where a batch stands (B3). Derived from the leg row alone. */
export type SweepBatchState = "pending" | "posted" | "approved" | "rejected";

/** A register chip's data (B11): the sweep role of one row, from `listSweepBadges`. */
export type SweepRowBadge =
  | { kind: "batch"; legId: string; sweepDate: string; state: SweepBatchState; count: number }
  | { kind: "copy"; legId: string; sweepDate: string; state: SweepBatchState }
  | { kind: "source"; legId: string; sweepDate: string; state: SweepBatchState };

// ---------------------------------------------------------------------------
// Request parsing (pure, runs before any database read)
// ---------------------------------------------------------------------------

export type SweepParseFailure = { ok: false; status: 400; code: SweepErrorCode; error: string };

function failure(code: SweepErrorCode, labels: FundLabels = DEFAULT_FUND_LABELS, detail?: string): SweepParseFailure {
  return { ok: false, status: 400, code, error: detail ?? SWEEP_ERROR_COPY[code](labels) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseSourceIds(
  raw: unknown,
): { ok: true; value: string[] } | SweepParseFailure {
  if (!Array.isArray(raw)) return failure("invalid_body");
  if (raw.length === 0) return failure("no_rows");
  if (raw.length > SWEEP_BATCH_MAX) return failure("batch_too_large");
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string" || !isUuid(id)) return failure("invalid_id");
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) return failure("duplicate_ids");
  return { ok: true, value: ids };
}

function parseAmount(raw: unknown): { ok: true; value: number } | SweepParseFailure {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > SWEEP_INT4_MAX) {
    return failure("invalid_amount");
  }
  return { ok: true, value: raw };
}

const PREVIEW_KEYS = [
  "sourceIds",
  "sourceBankAccountId",
  "destBankAccountId",
  "sweepDate",
  "bankAmountCents",
] as const;
const CREATE_KEYS = [...PREVIEW_KEYS, "boardMinute", "priorYearReason"] as const;

/**
 * Validate a preview body. `defaultSweepDate` (the Eastern date) is used when
 * `sweepDate` is absent. Create-only keys are tolerated so a builder can post
 * the same object to both routes; any other key is `invalid_body`.
 */
export function parseSweepPreviewBody(
  body: unknown,
  defaultSweepDate: string,
): { ok: true; value: SweepPreviewRequest & { sweepDate: string } } | SweepParseFailure {
  if (!isPlainObject(body)) return failure("invalid_body");
  if (Object.keys(body).some((k) => !(CREATE_KEYS as readonly string[]).includes(k))) {
    return failure("invalid_body");
  }
  const ids = parseSourceIds(body.sourceIds);
  if (!ids.ok) return ids;
  for (const key of ["sourceBankAccountId", "destBankAccountId"] as const) {
    const v = body[key];
    if (typeof v !== "string" || !isUuid(v)) return failure("bank_account_invalid");
  }
  let sweepDate = defaultSweepDate;
  if (body.sweepDate !== undefined && body.sweepDate !== null) {
    const parsed = parseIsoDate(body.sweepDate);
    if (!parsed) return failure("invalid_date");
    // B5: a sweep is recorded after the money moves. `defaultSweepDate` is the
    // Eastern date, so preview and create refuse identically.
    if (parsed > defaultSweepDate) return failure("future_date");
    sweepDate = parsed;
  }
  const value: SweepPreviewRequest & { sweepDate: string } = {
    sourceIds: ids.value,
    sourceBankAccountId: body.sourceBankAccountId as string,
    destBankAccountId: body.destBankAccountId as string,
    sweepDate,
  };
  if (body.bankAmountCents !== undefined && body.bankAmountCents !== null) {
    const amount = parseAmount(body.bankAmountCents);
    if (!amount.ok) return amount;
    value.bankAmountCents = amount.value;
  }
  return { ok: true, value };
}

/** Validate a create body: the preview fields plus the minute (required) and the typed amount (required). */
export function parseSweepCreateBody(
  body: unknown,
  defaultSweepDate: string,
): { ok: true; value: SweepBatchCreateRequest & { sweepDate: string } } | SweepParseFailure {
  const base = parseSweepPreviewBody(body, defaultSweepDate);
  if (!base.ok) return base;
  const record = body as Record<string, unknown>;
  if (typeof record.boardMinute !== "string" || !record.boardMinute.trim()) {
    return failure("minute_required");
  }
  if (record.bankAmountCents === undefined || record.bankAmountCents === null) {
    return failure("invalid_amount");
  }
  const value: SweepBatchCreateRequest & { sweepDate: string } = {
    ...base.value,
    bankAmountCents: base.value.bankAmountCents as number,
    boardMinute: record.boardMinute.trim().slice(0, BOARD_MINUTE_MAX_LEN),
  };
  const rawReason = record.priorYearReason;
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== "string") return failure("reason_required");
    if (rawReason.trim() !== "") {
      const reason = normalizeCorrectionReason(rawReason);
      if (!reason.ok) return failure("reason_required", DEFAULT_FUND_LABELS, reason.error);
      value.priorYearReason = reason.value;
    }
  }
  return { ok: true, value };
}

/** Validate a closeout body. Duplicate ids are collapsed, not refused. */
export function parseSweepCloseoutBody(
  body: unknown,
): { ok: true; value: SweepCloseoutRequest } | SweepParseFailure {
  if (!isPlainObject(body)) return failure("invalid_body");
  if (Object.keys(body).some((k) => !["action", "sourceIds", "reason"].includes(k))) {
    return failure("invalid_body");
  }
  if (body.action !== "mark" && body.action !== "unmark") return failure("invalid_body");
  if (!Array.isArray(body.sourceIds) || body.sourceIds.length === 0) return failure("invalid_body");
  if (body.sourceIds.length > SWEEP_BATCH_MAX) return failure("batch_too_large");
  const ids: string[] = [];
  for (const id of body.sourceIds) {
    if (typeof id !== "string" || !isUuid(id)) return failure("invalid_id");
    if (!ids.includes(id)) ids.push(id);
  }
  const value: SweepCloseoutRequest = { action: body.action, sourceIds: ids };
  if (body.action === "mark") {
    const reason = normalizeCorrectionReason(body.reason);
    if (!reason.ok) return failure("reason_required", DEFAULT_FUND_LABELS, reason.error);
    value.reason = reason.value;
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Period verdict and tier (pure)
// ---------------------------------------------------------------------------

export interface SweepPeriodVerdict {
  /** Fiscal year (start year) of the gift date, which is the copy's year. */
  fiscalYear: number;
  priorFiscalYear: boolean;
  /** The Foundation's IRS filing for that year is marked filed. An absent row is NOT filed (A9). */
  filed: boolean;
  giftAfterSweep: boolean;
}

function dateFiscalYear(isoDate: string): number {
  return getFiscalYear(new Date(isoDate + "T00:00:00"));
}

export function sweepCopyPeriodVerdict(args: {
  giftDate: string;
  sweepDate: string;
  now: Date;
  filedFiscalYears: ReadonlySet<number>;
}): SweepPeriodVerdict {
  const fiscalYear = dateFiscalYear(args.giftDate);
  return {
    fiscalYear,
    priorFiscalYear: fiscalYear < currentFiscalYear(args.now),
    filed: args.filedFiscalYears.has(fiscalYear),
    giftAfterSweep: args.giftDate > args.sweepDate,
  };
}

/** `manage` when any copy, or the sweep date itself, is in a prior fiscal year (A9). */
export function sweepTier(args: {
  giftDates: readonly string[];
  sweepDate: string;
  now: Date;
}): "record" | "manage" {
  const current = currentFiscalYear(args.now);
  if (dateFiscalYear(args.sweepDate) < current) return "manage";
  return args.giftDates.some((d) => dateFiscalYear(d) < current) ? "manage" : "record";
}

export function sweepDateIsPriorYear(sweepDate: string, now: Date): boolean {
  return dateFiscalYear(sweepDate) < currentFiscalYear(now);
}

/** Derived total versus the typed bank amount. Overflow first: the column is an `integer`. */
export function checkSweepTotal(
  derivedCents: number,
  typedCents: number,
): { ok: true } | { ok: false; code: "total_too_large" | "total_mismatch" } {
  if (derivedCents > SWEEP_INT4_MAX) return { ok: false, code: "total_too_large" };
  if (derivedCents !== typedCents) return { ok: false, code: "total_mismatch" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-row verdict (pure): the ONE classifier used by preview, create and the candidate list
// ---------------------------------------------------------------------------

export interface SweepSourceFacts {
  id: string;
  fundId: string;
  flow: string;
  status: string;
  transferGroupId: string | null;
  sweepLegTxnId: string | null;
  duesPaymentId: string | null;
  txnDate: string;
  amountCents: number;
  categoryId: string | null;
}

export interface SweepCategoryFacts {
  id: string;
  name: string;
  fundKind: string;
  flow: string;
  entityDonationsDeductible: boolean;
  mirrorsCategoryId: string | null;
}

export interface SweepMirrorFacts {
  id: string;
  name: string;
  fundKind: string;
  flow: string;
  entityId: string;
  entityDonationsDeductible: boolean;
  isActive: boolean;
  ackNotRequired: boolean;
}

export interface SweepClassifyInput {
  /** Null: the id matched no row. */
  source: SweepSourceFacts | null;
  category: SweepCategoryFacts | null;
  /** The category's counterpart as loaded; null when the category has none or it is gone. */
  mirror: SweepMirrorFacts | null;
  /** A non-rejected copy already claims this gift. */
  hasLiveCopy: boolean;
  closedOut: boolean;
}

export interface SweepClassifyContext {
  /** The one Club fund a source must sit in. */
  sourceFundId: string;
  sweepDate: string;
  now: Date;
  callerCanManage: boolean;
  filedFiscalYears: ReadonlySet<number>;
}

/**
 * The first refusal that holds, in the order of SWEEP_ROW_REFUSALS, or null.
 * Sweepability is decided by the MIRROR TARGET (active, Foundation, charitable,
 * income), never by whether the Club category is active (confirmation §5).
 */
export function classifySweepRow(
  input: SweepClassifyInput,
  ctx: SweepClassifyContext,
): SweepRowRefusal | null {
  const { source, category, mirror } = input;
  if (!source) return "not_found";
  if (source.fundId !== ctx.sourceFundId) return "wrong_fund";
  if (source.flow !== "income") return "not_income";
  if (source.status !== "posted") return "not_posted";
  if (source.transferGroupId !== null || source.sweepLegTxnId !== null) return "transfer_leg";
  if (source.duesPaymentId !== null) return "dues_synced";
  if (input.hasLiveCopy) return "already_swept";
  if (input.closedOut) return "closed_out";
  if (source.categoryId === null || !category) return "no_category";
  if (category.mirrorsCategoryId === null) return "no_mirror";
  if (!mirror) return "mirror_invalid";
  if (!mirror.isActive) return "mirror_inactive";
  const shape = checkCategoryMirror(
    {
      id: category.id,
      fundKind: category.fundKind,
      flow: category.flow,
      entityDonationsDeductible: category.entityDonationsDeductible,
    },
    {
      id: mirror.id,
      fundKind: mirror.fundKind,
      flow: mirror.flow,
      entityDonationsDeductible: mirror.entityDonationsDeductible,
      isActive: mirror.isActive,
    },
  );
  if (!shape.ok) return "mirror_invalid";
  const verdict = sweepCopyPeriodVerdict({
    giftDate: source.txnDate,
    sweepDate: ctx.sweepDate,
    now: ctx.now,
    filedFiscalYears: ctx.filedFiscalYears,
  });
  if (verdict.giftAfterSweep) return "gift_after_sweep";
  if (verdict.filed) return "period_filed";
  if ((verdict.priorFiscalYear || sweepDateIsPriorYear(ctx.sweepDate, ctx.now)) && !ctx.callerCanManage) {
    return "manage_required";
  }
  return null;
}

/** Will the Foundation copy need a written receipt? Pure; the same rule as the Inc 1 hint. */
export function foundationReceiptState(args: {
  amountCents: number;
  mirrorAckNotRequired: boolean;
  receiptAlreadySent: boolean;
}): FoundationReceiptState {
  if (args.receiptAlreadySent) return "already_sent";
  if (args.mirrorAckNotRequired || args.amountCents < ACK_MIN_CENTS) return "not_needed";
  return "may_be_needed";
}

// ---------------------------------------------------------------------------
// The copy (pure)
// ---------------------------------------------------------------------------

export interface SweepCopySource {
  id: string;
  amountCents: number;
  txnDate: string;
  party: string | null;
  memo: string | null;
  beneficiaryCause: string | null;
  paymentMethod: string | null;
  donorId: string | null;
}

export interface SweepCopyContext {
  legId: string;
  foundationEntityId: string;
  foundationFundId: string;
  destBankAccountId: string;
  boardMinute: string;
  status: "posted" | "pending";
  recordedByUserId: string;
}

/** The exact column map of one Foundation copy. */
export interface SweepCopyValues {
  entityId: string;
  fundId: string;
  bankAccountId: string;
  txnDate: string;
  flow: "income";
  categoryId: string;
  amountCents: number;
  party: string | null;
  memo: string | null;
  beneficiaryCause: string | null;
  paymentMethod: string | null;
  donorId: string | null;
  boardMinute: string;
  status: "posted" | "pending";
  recordedByUserId: string;
  sweptFromTxnId: string;
  sweepLegTxnId: string;
  transferGroupId: null;
}

/**
 * Build one copy. CARRIED: amount, party, memo, beneficiary cause, payment
 * method, donor, and the GIFT date. SET: the Foundation entity, fund, the
 * destination bank account, the mirror target as category, the batch's minute,
 * status and recorder, and BOTH pointers; `transferGroupId` is null (a copy is
 * not part of a pair). NOT CARRIED: check number, receipt key and waiver trio,
 * public note, budget line, dues payment, reconciliation fields, approval
 * stamps (a copy is never `approved_at`).
 */
export function buildSweepCopy(
  source: SweepCopySource,
  mirrorCategoryId: string,
  ctx: SweepCopyContext,
): SweepCopyValues {
  return {
    entityId: ctx.foundationEntityId,
    fundId: ctx.foundationFundId,
    bankAccountId: ctx.destBankAccountId,
    txnDate: source.txnDate,
    flow: "income",
    categoryId: mirrorCategoryId,
    amountCents: source.amountCents,
    party: source.party,
    memo: source.memo,
    beneficiaryCause: source.beneficiaryCause,
    paymentMethod: source.paymentMethod,
    donorId: source.donorId,
    boardMinute: ctx.boardMinute,
    status: ctx.status,
    recordedByUserId: ctx.recordedByUserId,
    sweptFromTxnId: source.id,
    sweepLegTxnId: ctx.legId,
    transferGroupId: null,
  };
}

// ---------------------------------------------------------------------------
// Copy (three exhaustive records; a new code is a compile error)
// ---------------------------------------------------------------------------

export const SWEEP_ROW_REFUSAL_COPY: Record<SweepRowRefusal, (labels: FundLabels) => string> = {
  not_found: () => "This gift was not found.",
  wrong_fund: (l) => `Only gifts recorded in ${l.activity} can be swept.`,
  not_income: () => "Only income can be swept.",
  not_posted: () => "This gift is not posted yet. Only posted gifts can be swept.",
  transfer_leg: () => "This entry is part of a transfer, not a gift.",
  dues_synced: () => "This entry was posted from dues. It is not a gift to sweep.",
  already_swept: () => "This gift is already in a sweep batch.",
  closed_out: () => "This gift was marked as already handled. Unmark it first to sweep it.",
  no_category: () => "This gift has no category. Set a category on the entry first.",
  no_mirror: () =>
    "This gift's category has no Foundation counterpart. Set one on the category screen first.",
  mirror_inactive: () =>
    "The Foundation counterpart of this gift's category is deactivated. Reactivate it or choose another.",
  mirror_invalid: () =>
    "The Foundation counterpart of this gift's category is not a Foundation income category. Choose another.",
  gift_after_sweep: () => "This gift is dated after the sweep date.",
  period_filed: () =>
    "The Foundation's IRS filing for this gift's fiscal year is marked filed, so a gift from that year cannot be added to its books.",
  manage_required: () =>
    "Sweeping a gift from an earlier fiscal year needs the Manage Ledger permission.",
};

export const SWEEP_ERROR_COPY: Record<SweepErrorCode, (labels: FundLabels) => string> = {
  invalid_body: () => "The request was not in the expected shape.",
  invalid_id: () => "One of the selected gifts has an invalid id.",
  no_rows: () => "Select at least one gift to sweep.",
  batch_too_large: () => `A batch can hold at most ${SWEEP_BATCH_MAX} gifts. Split it into more than one batch.`,
  duplicate_ids: () => "The same gift was selected twice.",
  invalid_date: () => "The sweep date must be a real date in YYYY-MM-DD form.",
  future_date: () => "A sweep is recorded after the money moves, so its date cannot be in the future.",
  invalid_amount: () => "Enter the amount that reached the bank as a positive number of cents.",
  minute_required: () => "A board-minute reference is required for a sweep.",
  reason_required: () =>
    `A reason of ${REASON_LIMITS.min} to ${REASON_LIMITS.max} characters is required. Do not type a donor's name.`,
  bank_account_invalid: () => "Select an active bank account for each side of the sweep.",
  fund_not_found: (l) => `The ${l.activity} or the Foundation's charitable fund could not be found.`,
  direction_denied: (l) => `${l.activity} can only be swept to the Foundation's charitable fund.`,
  manage_required: () =>
    "A sweep that includes a gift from an earlier fiscal year, or an earlier sweep date, needs the Manage Ledger permission.",
  rows_refused: () => "Some selected gifts cannot be swept. Nothing was recorded.",
  rows_claimed: () =>
    "Some selected gifts are already in another sweep batch. Nothing was recorded; refresh the list.",
  total_mismatch: () => "The amount that reached the bank does not equal the total of the selected gifts.",
  total_too_large: () => "The total of the selected gifts is too large for one batch. Split it.",
  use_sweep_batch: () => "A sweep to the Foundation is recorded as an itemized batch, not a single amount.",
};

export const SWEEP_VOID_BLOCK_COPY: Record<
  SweepVoidBlock,
  (labels: FundLabels) => { message: string; nextStep: string }
> = {
  not_found: () => ({ message: "This sweep batch was not found.", nextStep: "Refresh the page." }),
  not_a_sweep: () => ({
    message: "This entry is not an itemized sweep.",
    nextStep: "Use the delete action on the transfer instead.",
  }),
  pending_use_reject: () => ({
    message: "This batch is still waiting for approval.",
    nextStep: "Reject it from the Approvals page instead; that frees the gifts.",
  }),
  already_rejected: () => ({
    message: "This batch was rejected and is kept as a record.",
    nextStep: "Nothing to void; its gifts are already free to sweep again.",
  }),
  approved: () => ({
    message: "This batch was approved by the board and is locked.",
    nextStep: "Record a correcting entry on each book instead.",
  }),
  reconciled: () => ({
    message: "An entry of this batch was cleared on a bank statement.",
    nextStep: "Reopen the reconciliation session, unmatch the entries, then void.",
  }),
  matched: () => ({
    message: "An entry of this batch is matched to a bank line in a reconciliation session.",
    nextStep: "Unmatch the entries in the session first.",
  }),
  receipt_sent: () => ({
    message: "A receipt was already sent to a donor for a gift in this batch.",
    nextStep: "Record a refund entry on the Foundation instead of voiding.",
  }),
  prior_fiscal_year: () => ({
    message: "This batch is dated in an earlier fiscal year; voiding it would restate that year.",
    nextStep: "Record a correcting entry in the current year instead.",
  }),
  period_filed: () => ({
    message: "A gift in this batch belongs to a fiscal year the Foundation has already filed with the IRS.",
    nextStep: "Record a correcting entry in the current year instead.",
  }),
};

// ---------------------------------------------------------------------------
// Preselect (?sweep=a,b) and batch state (B3, B11)
// ---------------------------------------------------------------------------

/** The builder's `?sweep=` parameter: UUIDs only, deduped, capped; anything else is dropped. */
export function parseSweepPreselect(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((v) => v.split(","));
  const out: string[] = [];
  for (const part of parts) {
    const id = part.trim();
    if (!isUuid(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= SWEEP_BATCH_MAX) break;
  }
  return out;
}

/** The builder URL with gifts preselected. */
export function sweepBuilderHref(ids: readonly string[]): string {
  return ids.length === 0 ? "/admin/ledger/sweep" : `/admin/ledger/sweep?sweep=${ids.join(",")}`;
}

/** The state of a batch from its leg row: rejected, then approved, then pending, else posted. */
export function sweepBatchState(
  // `Record<...>` rather than a property literal: the consolidation scan bans
  // the decision-column spelling `approvedAt:` in this file (reads are fine).
  row: { status: string } & Record<"approvedAt", Date | string | null>,
): SweepBatchState {
  if (row.status === "rejected") return "rejected";
  if (row.approvedAt) return "approved";
  if (row.status === "pending") return "pending";
  return "posted";
}

/** What to do next for a batch in this state (B3). No fund name; shared by routes, chip and dialog. */
export function sweepBatchNextStep(state: SweepBatchState): string {
  switch (state) {
    case "approved":
      return "The board approved it, so it is locked. Record a correcting entry on each book.";
    case "posted":
      return "Void it (a manager) to undo it and free its gifts.";
    case "pending":
      return "Reject it from Approvals to undo it and free its gifts.";
    case "rejected":
      return "It was rejected and is kept as a record.";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function moneyText(cents: number): string {
  return `$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ${d}, ${y}`;
}

const BATCH_STATE_QUALIFIER: Record<SweepBatchState, string> = {
  pending: " (pending approval)",
  posted: "",
  approved: " (approved)",
  rejected: " (rejected)",
};

/** The register chip text for a badge (B11). A function of `FundLabels`. */
export function sweepChipLabel(badge: SweepRowBadge, labels: FundLabels): string {
  switch (badge.kind) {
    case "batch":
      return `Sweep of ${badge.count} ${badge.count === 1 ? "gift" : "gifts"} to the Foundation${BATCH_STATE_QUALIFIER[badge.state]}`;
    case "copy":
      return `Swept from ${labels.activity} on ${longDate(badge.sweepDate)}${BATCH_STATE_QUALIFIER[badge.state]}`;
    case "source":
      return `Swept to the Foundation on ${longDate(badge.sweepDate)}${BATCH_STATE_QUALIFIER[badge.state]}`;
    default: {
      const _exhaustive: never = badge;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Review-step copy (exhaustive; a new code or variant is a compile error)
// ---------------------------------------------------------------------------

export const SWEEP_ROW_FLAG_COPY: Record<SweepRowFlag, (labels: FundLabels) => string> = {
  prior_fiscal_year: () => "From an earlier fiscal year. Posting needs the Manage Ledger permission and a reason.",
  statement_already_sent: () =>
    "A monthly statement for this gift's month was already sent. Adding it changes that month's figures.",
  receipt_already_sent: () => "A receipt for this gift was already sent, so the Foundation will not send another.",
  no_donor: () => "No donor is recorded for this gift, so the Foundation's donor history will not show it.",
  not_matched_to_deposit: (l) => `This gift is not matched to a bank deposit in ${l.activity} yet.`,
};

export function describeSweepWarning(warning: SweepWarning, labels: FundLabels): string {
  switch (warning.code) {
    case "exceeds_fund_balance":
      return `This sweep is more than the ${labels.activity} balance of ${moneyText(warning.fundBalanceCents)}.`;
    case "unmatched_sources":
      return `${warning.count} ${warning.count === 1 ? "gift is" : "gifts are"} not matched to a bank deposit in ${labels.activity} yet.`;
    case "no_donor":
      return `${warning.count} ${warning.count === 1 ? "gift has" : "gifts have"} no donor record.`;
    default: {
      const _exhaustive: never = warning;
      return _exhaustive;
    }
  }
}

/** One `sentStatementMonths` entry, e.g. "March 2026: adds $120.00". */
export function describeSentStatementMonth(entry: { month: string; addsCents: number }): string {
  const [y, m] = entry.month.split("-").map(Number);
  const name = MONTH_NAMES[(m ?? 1) - 1] ?? entry.month;
  return `${name} ${y}: a statement already sent for this month would change by ${moneyText(entry.addsCents)}.`;
}

export const SWEEP_CLOSEOUT_SKIP_COPY: Record<SweepCloseoutSkip, (labels: FundLabels) => string> = {
  not_found: () => "This gift was not found.",
  wrong_fund: (l) => `Only gifts recorded in ${l.activity} can be marked as handled.`,
  not_income: () => "Only income can be marked as handled.",
  not_posted: () => "This gift is not posted yet.",
  transfer_leg: () => "This entry is part of a transfer, not a gift.",
  already_swept: () => "This gift is already in a sweep batch.",
  already_closed_out: () => "This gift is already marked as handled.",
  not_closed_out: () => "This gift was not marked as handled.",
};

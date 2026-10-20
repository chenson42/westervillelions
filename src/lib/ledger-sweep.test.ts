/**
 * B-172 Increment 2a, pass 2: the pure carrier (ledger-sweep.ts). No database,
 * no mocks. The named tests of the Phase 3 confirmation: classifySweepRow (each
 * refusal alone and the precedence pairs), buildSweepCopy (carried and not
 * carried), sweepCopyPeriodVerdict, sweepTier, checkSweepTotal, the three
 * exhaustive copy records, request parsing, and "the carrier has no @/lib/db
 * import".
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_FUND_LABELS } from "./ledger-fund-labels";
import {
  SWEEP_BATCH_MAX,
  SWEEP_CLOSEOUT_SKIP_COPY,
  SWEEP_ERROR_COPY,
  SWEEP_ROW_FLAG_COPY,
  SWEEP_INT4_MAX,
  SWEEP_ROW_REFUSALS,
  SWEEP_ROW_REFUSAL_COPY,
  SWEEP_VOID_BLOCK_COPY,
  buildSweepCopy,
  checkSweepTotal,
  classifySweepRow,
  foundationReceiptState,
  parseSweepCloseoutBody,
  parseSweepCreateBody,
  parseSweepPreviewBody,
  sweepCopyPeriodVerdict,
  sweepLegMemo,
  sweepTier,
  describeSentStatementMonth,
  describeSweepWarning,
  parseSweepPreselect,
  sweepBatchNextStep,
  sweepBatchState,
  sweepBuilderHref,
  sweepChipLabel,
  type SweepBatchState,
  type SweepCloseoutSkip,
  type SweepRowBadge,
  type SweepRowFlag,
  type SweepWarning,
  type SweepClassifyContext,
  type SweepClassifyInput,
  type SweepCopyContext,
  type SweepCopySource,
  type SweepErrorCode,
  type SweepVoidBlock,
} from "./ledger-sweep";

const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const SRC_FUND = U(1);
const NOW = new Date("2026-10-19T15:00:00Z"); // FY2026 (Jul 2026 to Jun 2027)

function ok(over: Partial<SweepClassifyInput> = {}): SweepClassifyInput {
  return {
    source: {
      id: U(2),
      fundId: SRC_FUND,
      flow: "income",
      status: "posted",
      transferGroupId: null,
      sweepLegTxnId: null,
      duesPaymentId: null,
      txnDate: "2026-10-01",
      amountCents: 6000,
      categoryId: U(3),
    },
    category: {
      id: U(3),
      name: "Public donations",
      fundKind: "activity",
      flow: "income",
      entityDonationsDeductible: false,
      mirrorsCategoryId: U(4),
    },
    mirror: {
      id: U(4),
      name: "Public donations",
      fundKind: "charitable",
      flow: "income",
      entityId: U(5),
      entityDonationsDeductible: true,
      isActive: true,
      ackNotRequired: false,
    },
    hasLiveCopy: false,
    closedOut: false,
    ...over,
  };
}

function ctx(over: Partial<SweepClassifyContext> = {}): SweepClassifyContext {
  return {
    sourceFundId: SRC_FUND,
    sweepDate: "2026-10-19",
    now: NOW,
    callerCanManage: false,
    filedFiscalYears: new Set<number>(),
    ...over,
  };
}

function withSource(over: Partial<NonNullable<SweepClassifyInput["source"]>>): SweepClassifyInput {
  const base = ok();
  return { ...base, source: { ...(base.source as NonNullable<SweepClassifyInput["source"]>), ...over } };
}

describe("classifySweepRow: each refusal alone", () => {
  it("a clean current-year gift with an active Foundation counterpart has no refusal", () => {
    expect(classifySweepRow(ok(), ctx())).toBeNull();
  });

  it.each<[string, SweepClassifyInput, SweepClassifyContext, string]>([
    ["not_found", ok({ source: null }), ctx(), "not_found"],
    ["wrong_fund", withSource({ fundId: U(9) }), ctx(), "wrong_fund"],
    ["not_income", withSource({ flow: "expense" }), ctx(), "not_income"],
    ["not_posted (pending)", withSource({ status: "pending" }), ctx(), "not_posted"],
    ["not_posted (rejected)", withSource({ status: "rejected" }), ctx(), "not_posted"],
    ["transfer_leg (group id)", withSource({ transferGroupId: U(6) }), ctx(), "transfer_leg"],
    ["transfer_leg (leg pointer)", withSource({ sweepLegTxnId: U(6) }), ctx(), "transfer_leg"],
    ["dues_synced", withSource({ duesPaymentId: U(6) }), ctx(), "dues_synced"],
    ["already_swept", ok({ hasLiveCopy: true }), ctx(), "already_swept"],
    ["closed_out", ok({ closedOut: true }), ctx(), "closed_out"],
    ["no_category (null id)", withSource({ categoryId: null }), ctx(), "no_category"],
    ["no_category (missing row)", ok({ category: null }), ctx(), "no_category"],
    [
      "no_mirror",
      ok({ category: { ...(ok().category as NonNullable<SweepClassifyInput["category"]>), mirrorsCategoryId: null }, mirror: null }),
      ctx(),
      "no_mirror",
    ],
    ["mirror_inactive", ok({ mirror: { ...(ok().mirror as NonNullable<SweepClassifyInput["mirror"]>), isActive: false } }), ctx(), "mirror_inactive"],
    ["mirror_invalid (target row gone)", ok({ mirror: null }), ctx(), "mirror_invalid"],
    [
      "mirror_invalid (a Club category)",
      ok({ mirror: { ...(ok().mirror as NonNullable<SweepClassifyInput["mirror"]>), entityDonationsDeductible: false } }),
      ctx(),
      "mirror_invalid",
    ],
    [
      "mirror_invalid (expense target)",
      ok({ mirror: { ...(ok().mirror as NonNullable<SweepClassifyInput["mirror"]>), flow: "expense" } }),
      ctx(),
      "mirror_invalid",
    ],
    ["gift_after_sweep", withSource({ txnDate: "2026-10-20" }), ctx(), "gift_after_sweep"],
    ["period_filed", withSource({ txnDate: "2025-11-10" }), ctx({ callerCanManage: true, filedFiscalYears: new Set([2025]) }), "period_filed"],
    ["manage_required (prior-year gift)", withSource({ txnDate: "2025-11-10" }), ctx(), "manage_required"],
    ["gift_after_sweep (prior-year sweep date, current-year gift)", ok(), ctx({ sweepDate: "2026-06-30" }), "gift_after_sweep"],
  ])("%s", (_name, input, context, expected) => {
    expect(classifySweepRow(input, context)).toBe(expected);
  });

  it("a prior-year gift is allowed for a manager when the year is not filed (an absent or in-progress row is not filed)", () => {
    expect(classifySweepRow(withSource({ txnDate: "2025-11-10" }), ctx({ callerCanManage: true }))).toBeNull();
  });

  it("a prior-year SWEEP date alone needs manage (A9: the leg's own date gets the tier test)", () => {
    const early = withSource({ txnDate: "2026-05-01" });
    expect(classifySweepRow(early, ctx({ sweepDate: "2026-06-30" }))).toBe("manage_required");
    expect(classifySweepRow(early, ctx({ sweepDate: "2026-06-30", callerCanManage: true }))).toBeNull();
  });

  it("the refusal list is exactly the documented evaluation order", () => {
    expect([...SWEEP_ROW_REFUSALS]).toEqual([
      "not_found", "wrong_fund", "not_income", "not_posted", "transfer_leg", "dues_synced",
      "already_swept", "closed_out", "no_category", "no_mirror", "mirror_inactive", "mirror_invalid",
      "gift_after_sweep", "period_filed", "manage_required",
    ]);
  });
});

describe("classifySweepRow: precedence pairs", () => {
  it("already_swept comes before closed_out", () => {
    expect(classifySweepRow(ok({ hasLiveCopy: true, closedOut: true }), ctx())).toBe("already_swept");
  });

  it("no_category comes before no_mirror", () => {
    expect(classifySweepRow(withSource({ categoryId: null }), ctx())).toBe("no_category");
    const noCatNoMirror = { ...withSource({ categoryId: null }), category: null, mirror: null };
    expect(classifySweepRow(noCatNoMirror, ctx())).toBe("no_category");
  });

  it("mirror_inactive comes before mirror_invalid", () => {
    const both = ok({
      mirror: {
        ...(ok().mirror as NonNullable<SweepClassifyInput["mirror"]>),
        isActive: false,
        entityDonationsDeductible: false,
      },
    });
    expect(classifySweepRow(both, ctx())).toBe("mirror_inactive");
  });

  it("period_filed comes before manage_required, and a wrong fund before everything after it", () => {
    const prior = withSource({ txnDate: "2025-11-10" });
    expect(classifySweepRow(prior, ctx({ filedFiscalYears: new Set([2025]) }))).toBe("period_filed");
    expect(classifySweepRow(withSource({ fundId: U(9), flow: "expense" }), ctx())).toBe("wrong_fund");
  });

  it("a Club category being inactive does NOT refuse: only the mirror target decides", () => {
    // The Club category carries no isActive in the input at all; a gift keyed before a retire stays sweepable.
    expect(classifySweepRow(ok(), ctx())).toBeNull();
  });
});

describe("sweepCopyPeriodVerdict", () => {
  const base = { sweepDate: "2026-10-19", now: NOW, filedFiscalYears: new Set<number>() };

  it("current year", () => {
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2026-10-01" })).toEqual({
      fiscalYear: 2026, priorFiscalYear: false, filed: false, giftAfterSweep: false,
    });
  });

  it("prior year (June belongs to the year that began the previous July)", () => {
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2026-06-30" })).toMatchObject({ fiscalYear: 2025, priorFiscalYear: true });
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2026-07-01" })).toMatchObject({ fiscalYear: 2026, priorFiscalYear: false });
  });

  it("an absent filing row is allowed; only a filed year blocks", () => {
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2025-11-10" }).filed).toBe(false);
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2025-11-10", filedFiscalYears: new Set([2025]) }).filed).toBe(true);
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2025-11-10", filedFiscalYears: new Set([2024]) }).filed).toBe(false);
  });

  it("a gift dated after the sweep date", () => {
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2026-10-20" }).giftAfterSweep).toBe(true);
    expect(sweepCopyPeriodVerdict({ ...base, giftDate: "2026-10-19" }).giftAfterSweep).toBe(false);
  });
});

describe("sweepTier", () => {
  it("record when the sweep date and every gift are in the current fiscal year", () => {
    expect(sweepTier({ giftDates: ["2026-10-01", "2026-07-01"], sweepDate: "2026-10-19", now: NOW })).toBe("record");
  });
  it("manage when a gift is in a prior fiscal year", () => {
    expect(sweepTier({ giftDates: ["2026-10-01", "2026-06-30"], sweepDate: "2026-10-19", now: NOW })).toBe("manage");
  });
  it("manage when only the sweep date is in a prior fiscal year", () => {
    expect(sweepTier({ giftDates: ["2026-05-01"], sweepDate: "2026-06-30", now: NOW })).toBe("manage");
    expect(sweepTier({ giftDates: [], sweepDate: "2026-06-30", now: NOW })).toBe("manage");
  });
  it("manage when both are", () => {
    expect(sweepTier({ giftDates: ["2025-08-01"], sweepDate: "2026-06-30", now: NOW })).toBe("manage");
  });
});

describe("checkSweepTotal", () => {
  it("equal totals pass", () => {
    expect(checkSweepTotal(13000, 13000)).toEqual({ ok: true });
  });
  it("a mismatch is total_mismatch in either direction", () => {
    expect(checkSweepTotal(13000, 12999)).toEqual({ ok: false, code: "total_mismatch" });
    expect(checkSweepTotal(13000, 13001)).toEqual({ ok: false, code: "total_mismatch" });
  });
  it("overflow of the integer column is refused first, even when the typed amount matches", () => {
    expect(checkSweepTotal(SWEEP_INT4_MAX, SWEEP_INT4_MAX)).toEqual({ ok: true });
    expect(checkSweepTotal(SWEEP_INT4_MAX + 1, SWEEP_INT4_MAX + 1)).toEqual({ ok: false, code: "total_too_large" });
    expect(checkSweepTotal(SWEEP_INT4_MAX + 1, 5)).toEqual({ ok: false, code: "total_too_large" });
  });
});

describe("buildSweepCopy", () => {
  const source: SweepCopySource = {
    id: U(2),
    amountCents: 6000,
    txnDate: "2026-10-01",
    party: "Test Donor One",
    memo: "Online gift",
    beneficiaryCause: "community",
    paymentMethod: "zeffy",
    donorId: U(7),
  };
  const copyCtx: SweepCopyContext = {
    legId: U(8),
    foundationEntityId: U(5),
    foundationFundId: U(9),
    destBankAccountId: U(6),
    boardMinute: "Minute 4",
    status: "pending",
    recordedByUserId: U(3),
  };

  it("carries the gift fields and sets the Foundation fields, both pointers and a null group id", () => {
    expect(buildSweepCopy(source, U(4), copyCtx)).toEqual({
      entityId: U(5),
      fundId: U(9),
      bankAccountId: U(6),
      txnDate: "2026-10-01",
      flow: "income",
      categoryId: U(4),
      amountCents: 6000,
      party: "Test Donor One",
      memo: "Online gift",
      beneficiaryCause: "community",
      paymentMethod: "zeffy",
      donorId: U(7),
      boardMinute: "Minute 4",
      status: "pending",
      recordedByUserId: U(3),
      sweptFromTxnId: U(2),
      sweepLegTxnId: U(8),
      transferGroupId: null,
    });
  });

  it("carries the GIFT date, never the sweep date, and the batch's status verbatim", () => {
    expect(buildSweepCopy(source, U(4), { ...copyCtx, status: "posted" }).status).toBe("posted");
    expect(buildSweepCopy(source, U(4), copyCtx).txnDate).toBe(source.txnDate);
  });

  it("does not carry check number, receipt key and waiver, public note, budget line, dues payment, reconciliation or approval fields", () => {
    const keys = Object.keys(buildSweepCopy(source, U(4), copyCtx)).sort();
    for (const forbidden of [
      "checkNumber", "receiptStorageKey", "receiptWaivedAt", "receiptWaivedByUserId", "receiptWaiverReason",
      "publicNote", "budgetLineId", "duesPaymentId", "reconciled", "reconciledAt", "reconciledSessionId",
      "approvedAt", "approvedByUserId", "rejectedAt", "rejectedByUserId", "rejectionReason", "syncStale", "id",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toHaveLength(18);
  });

  it("is a pure function: the same input gives an equal output and the input is not mutated", () => {
    const frozen = Object.freeze({ ...source });
    expect(buildSweepCopy(frozen, U(4), copyCtx)).toEqual(buildSweepCopy(source, U(4), copyCtx));
  });
});

describe("foundationReceiptState", () => {
  it("already_sent wins over everything", () => {
    expect(foundationReceiptState({ amountCents: 1, mirrorAckNotRequired: true, receiptAlreadySent: true })).toBe("already_sent");
  });
  it("not_needed for an ack-exempt counterpart or an amount under the written-acknowledgment threshold", () => {
    expect(foundationReceiptState({ amountCents: 90000, mirrorAckNotRequired: true, receiptAlreadySent: false })).toBe("not_needed");
    expect(foundationReceiptState({ amountCents: 24999, mirrorAckNotRequired: false, receiptAlreadySent: false })).toBe("not_needed");
  });
  it("may_be_needed at the threshold", () => {
    expect(foundationReceiptState({ amountCents: 25000, mirrorAckNotRequired: false, receiptAlreadySent: false })).toBe("may_be_needed");
  });
});

describe("sweepLegMemo", () => {
  it("is generated from the count alone", () => {
    expect(sweepLegMemo(1)).toBe("Itemized sweep: 1 gift");
    expect(sweepLegMemo(12)).toBe("Itemized sweep: 12 gifts");
  });
});

describe("request parsing", () => {
  const TODAY = "2026-10-19";
  const body = (over: Record<string, unknown> = {}) => ({
    sourceIds: [U(1), U(2)],
    sourceBankAccountId: U(3),
    destBankAccountId: U(4),
    ...over,
  });

  it("preview: accepts the minimal body and defaults the sweep date", () => {
    const r = parseSweepPreviewBody(body(), TODAY);
    expect(r).toEqual({ ok: true, value: { sourceIds: [U(1), U(2)], sourceBankAccountId: U(3), destBankAccountId: U(4), sweepDate: TODAY } });
  });

  it.each<[string, unknown, SweepErrorCode]>([
    ["a non-object body", "x", "invalid_body"],
    ["an array body", [], "invalid_body"],
    ["an unknown key", body({ destFundId: U(5) }), "invalid_body"],
    ["sourceIds not an array", body({ sourceIds: "a" }), "invalid_body"],
    ["no ids", body({ sourceIds: [] }), "no_rows"],
    ["more than 200 ids", body({ sourceIds: Array.from({ length: SWEEP_BATCH_MAX + 1 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`) }), "batch_too_large"],
    ["a non-uuid id", body({ sourceIds: ["nope"] }), "invalid_id"],
    ["a number id", body({ sourceIds: [5] }), "invalid_id"],
    ["a duplicate id", body({ sourceIds: [U(1), U(1)] }), "duplicate_ids"],
    ["a missing source bank account", body({ sourceBankAccountId: undefined }), "bank_account_invalid"],
    ["a malformed destination bank account", body({ destBankAccountId: "x" }), "bank_account_invalid"],
    ["an impossible date", body({ sweepDate: "2026-02-31" }), "invalid_date"],
    ["a non-string date", body({ sweepDate: 5 }), "invalid_date"],
    ["a zero typed amount", body({ bankAmountCents: 0 }), "invalid_amount"],
    ["a fractional typed amount", body({ bankAmountCents: 10.5 }), "invalid_amount"],
    ["a typed amount over INT4_MAX", body({ bankAmountCents: SWEEP_INT4_MAX + 1 }), "invalid_amount"],
  ])("preview rejects %s with %s", (_name, input, code) => {
    const r = parseSweepPreviewBody(input, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.code).toBe(code);
      expect(typeof r.error).toBe("string");
    }
  });

  it("preview tolerates the create-only keys so a builder can post one object to both routes", () => {
    expect(parseSweepPreviewBody(body({ boardMinute: "m", priorYearReason: "x" }), TODAY).ok).toBe(true);
  });

  it("create: requires the minute and the typed amount, trims the minute and bounds it to 500", () => {
    const missingMinute = parseSweepCreateBody(body({ bankAmountCents: 100 }), TODAY);
    expect(missingMinute).toMatchObject({ ok: false, code: "minute_required" });
    expect(parseSweepCreateBody(body({ boardMinute: "   ", bankAmountCents: 100 }), TODAY)).toMatchObject({ ok: false, code: "minute_required" });
    expect(parseSweepCreateBody(body({ boardMinute: "m" }), TODAY)).toMatchObject({ ok: false, code: "invalid_amount" });
    const long = parseSweepCreateBody(body({ boardMinute: `  ${"m".repeat(600)}  `, bankAmountCents: 100 }), TODAY);
    expect(long.ok && long.value.boardMinute).toBe("m".repeat(500));
  });

  it("create: a prior-year reason is normalized, and one that is too short is reason_required", () => {
    const good = parseSweepCreateBody(body({ boardMinute: "m", bankAmountCents: 100, priorYearReason: "  Gifts from the prior season  " }), TODAY);
    expect(good.ok && good.value.priorYearReason).toBe("Gifts from the prior season");
    expect(parseSweepCreateBody(body({ boardMinute: "m", bankAmountCents: 100, priorYearReason: "short" }), TODAY)).toMatchObject({ ok: false, code: "reason_required" });
    // blank is treated as absent; the server decides whether a reason was needed
    const blank = parseSweepCreateBody(body({ boardMinute: "m", bankAmountCents: 100, priorYearReason: "   " }), TODAY);
    expect(blank.ok && blank.value.priorYearReason).toBeUndefined();
  });

  it("closeouts: mark needs a valid reason, unmark does not, duplicates collapse, bad bodies are refused", () => {
    const mark = parseSweepCloseoutBody({ action: "mark", sourceIds: [U(1), U(1), U(2)], reason: "Covered by the earlier lump sweep" });
    expect(mark).toEqual({ ok: true, value: { action: "mark", sourceIds: [U(1), U(2)], reason: "Covered by the earlier lump sweep" } });
    expect(parseSweepCloseoutBody({ action: "mark", sourceIds: [U(1)] })).toMatchObject({ ok: false, code: "reason_required" });
    expect(parseSweepCloseoutBody({ action: "mark", sourceIds: [U(1)], reason: "short" })).toMatchObject({ ok: false, code: "reason_required" });
    expect(parseSweepCloseoutBody({ action: "unmark", sourceIds: [U(1)] })).toEqual({ ok: true, value: { action: "unmark", sourceIds: [U(1)] } });
    expect(parseSweepCloseoutBody({ action: "delete", sourceIds: [U(1)] })).toMatchObject({ ok: false, code: "invalid_body" });
    expect(parseSweepCloseoutBody({ action: "unmark", sourceIds: [] })).toMatchObject({ ok: false, code: "invalid_body" });
    expect(parseSweepCloseoutBody({ action: "unmark", sourceIds: ["x"] })).toMatchObject({ ok: false, code: "invalid_id" });
    expect(parseSweepCloseoutBody({ action: "unmark", sourceIds: [U(1)], extra: 1 })).toMatchObject({ ok: false, code: "invalid_body" });
    expect(
      parseSweepCloseoutBody({ action: "unmark", sourceIds: Array.from({ length: SWEEP_BATCH_MAX + 1 }, () => U(1)) }),
    ).toMatchObject({ ok: false, code: "batch_too_large" });
  });
});

describe("the three copy records are exhaustive and fund-name aware", () => {
  const refusalCodes = [...SWEEP_ROW_REFUSALS];
  const errorCodes: SweepErrorCode[] = [
    "invalid_body", "invalid_id", "no_rows", "batch_too_large", "duplicate_ids", "invalid_date", "future_date", "invalid_amount",
    "minute_required", "reason_required", "bank_account_invalid", "fund_not_found", "direction_denied",
    "manage_required", "rows_refused", "rows_claimed", "total_mismatch", "total_too_large", "use_sweep_batch",
  ];
  const voidCodes: SweepVoidBlock[] = [
    "not_found", "not_a_sweep", "pending_use_reject", "already_rejected", "approved", "reconciled", "matched",
    "receipt_sent", "prior_fiscal_year", "period_filed",
  ];

  it("a sentence for every refusal, error and void block, and the key sets match the unions", () => {
    expect(Object.keys(SWEEP_ROW_REFUSAL_COPY).sort()).toEqual([...refusalCodes].sort());
    expect(Object.keys(SWEEP_ERROR_COPY).sort()).toEqual([...errorCodes].sort());
    expect(Object.keys(SWEEP_VOID_BLOCK_COPY).sort()).toEqual([...voidCodes].sort());
    for (const c of refusalCodes) expect(SWEEP_ROW_REFUSAL_COPY[c](DEFAULT_FUND_LABELS).length).toBeGreaterThan(10);
    for (const c of errorCodes) expect(SWEEP_ERROR_COPY[c](DEFAULT_FUND_LABELS).length).toBeGreaterThan(10);
    for (const c of voidCodes) {
      const v = SWEEP_VOID_BLOCK_COPY[c](DEFAULT_FUND_LABELS);
      expect(v.message.length).toBeGreaterThan(10);
      expect(v.nextStep.length).toBeGreaterThan(5);
    }
  });

  it("two codes that exist in two unions get their own sentence in each context (A3)", () => {
    expect(SWEEP_ROW_REFUSAL_COPY.manage_required(DEFAULT_FUND_LABELS)).not.toBe(
      SWEEP_ERROR_COPY.manage_required(DEFAULT_FUND_LABELS),
    );
    expect(SWEEP_ROW_REFUSAL_COPY.not_found(DEFAULT_FUND_LABELS)).not.toBe(
      SWEEP_VOID_BLOCK_COPY.not_found(DEFAULT_FUND_LABELS).message,
    );
  });

  it("the copy takes the fund name from the labels it is given", () => {
    const renamed = { ...DEFAULT_FUND_LABELS, activity: "Community Money" };
    expect(SWEEP_ROW_REFUSAL_COPY.wrong_fund(renamed)).toContain("Community Money");
    expect(SWEEP_ERROR_COPY.direction_denied(renamed)).toContain("Community Money");
    expect(SWEEP_ERROR_COPY.fund_not_found(renamed)).toContain("Community Money");
  });
});

describe("the carrier is client-safe", () => {
  it("imports nothing from @/lib/db at runtime and no server-only module", () => {
    const text = readFileSync(join(__dirname, "ledger-sweep.ts"), "utf8");
    const imports = [...text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)];
    for (const m of imports) {
      const isTypeOnly = Boolean(m[1]);
      if (!isTypeOnly) expect(m[2]).not.toMatch(/^@\/lib\/db(\/|$)/);
      expect(m[2]).not.toMatch(/ledger-audit|ledger-sweep-batch|ledger-queries|ledger-sweep-link|next\/server|server-only/);
    }
    expect(text).not.toMatch(/from\s+["']@\/lib\/db/);
  });

  it("names no fund display name in a string literal", () => {
    const text = readFileSync(join(__dirname, "ledger-sweep.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(text).not.toMatch(/Public Funds|\bActivity\b/);
  });
});

describe("future_date (B5): preview and create refuse a sweep date after today (Eastern)", () => {
  const TODAY = "2026-10-19";
  const body = (over: Record<string, unknown> = {}) => ({
    sourceIds: [U(1)],
    sourceBankAccountId: U(3),
    destBankAccountId: U(4),
    bankAmountCents: 100,
    boardMinute: "Minute 4",
    ...over,
  });

  it("tomorrow is refused with the carrier copy, today and a past date are allowed", () => {
    const tomorrow = parseSweepPreviewBody(body({ sweepDate: "2026-10-20" }), TODAY);
    expect(tomorrow.ok).toBe(false);
    if (!tomorrow.ok) {
      expect(tomorrow.status).toBe(400);
      expect(tomorrow.code).toBe("future_date");
      expect(tomorrow.error).toBe(SWEEP_ERROR_COPY.future_date(DEFAULT_FUND_LABELS));
    }
    expect(parseSweepPreviewBody(body({ sweepDate: TODAY }), TODAY).ok).toBe(true);
    expect(parseSweepPreviewBody(body({ sweepDate: "2026-10-12" }), TODAY).ok).toBe(true);
  });

  it("the create parser agrees with the preview parser on the same body", () => {
    for (const sweepDate of ["2026-10-20", TODAY, "2025-01-02"]) {
      const preview = parseSweepPreviewBody(body({ sweepDate }), TODAY);
      const create = parseSweepCreateBody(body({ sweepDate }), TODAY);
      expect(create.ok).toBe(preview.ok);
      if (!create.ok && !preview.ok) expect(create.code).toBe(preview.code);
    }
  });

  it("the Eastern boundary is the caller's default date: at 8 p.m. Eastern the UTC day is already tomorrow, and the Eastern date still decides", () => {
    // 2026-10-19 20:30 Eastern is 2026-10-20 00:30 UTC. The route passes the Eastern date.
    expect(parseSweepPreviewBody(body({ sweepDate: "2026-10-19" }), "2026-10-19").ok).toBe(true);
    expect(parseSweepPreviewBody(body({ sweepDate: "2026-10-20" }), "2026-10-19").ok).toBe(false);
    // The day after, once the Eastern date has rolled over, the same date is allowed.
    expect(parseSweepPreviewBody(body({ sweepDate: "2026-10-20" }), "2026-10-20").ok).toBe(true);
  });

  it("an omitted date defaults to today and is never future", () => {
    const r = parseSweepPreviewBody(body(), TODAY);
    expect(r.ok && r.value.sweepDate).toBe(TODAY);
  });
});

describe("Increment 2b carrier copy and helpers", () => {
  const renamed = { ...DEFAULT_FUND_LABELS, activity: "Community Money" };
  const flags: SweepRowFlag[] = [
    "prior_fiscal_year", "statement_already_sent", "receipt_already_sent", "no_donor", "not_matched_to_deposit",
  ];
  const skips: SweepCloseoutSkip[] = [
    "not_found", "wrong_fund", "not_income", "not_posted", "transfer_leg", "already_swept", "already_closed_out",
    "not_closed_out",
  ];

  it("SWEEP_ROW_FLAG_COPY and SWEEP_CLOSEOUT_SKIP_COPY are exhaustive, and take the fund name from the labels", () => {
    expect(Object.keys(SWEEP_ROW_FLAG_COPY).sort()).toEqual([...flags].sort());
    expect(Object.keys(SWEEP_CLOSEOUT_SKIP_COPY).sort()).toEqual([...skips].sort());
    for (const f of flags) {
      expect(SWEEP_ROW_FLAG_COPY[f](renamed).length).toBeGreaterThan(10);
      expect(SWEEP_ROW_FLAG_COPY[f](renamed)).not.toContain(DEFAULT_FUND_LABELS.activity);
    }
    for (const c of skips) {
      expect(SWEEP_CLOSEOUT_SKIP_COPY[c](renamed).length).toBeGreaterThan(10);
      expect(SWEEP_CLOSEOUT_SKIP_COPY[c](renamed)).not.toContain(DEFAULT_FUND_LABELS.activity);
    }
    expect(SWEEP_ROW_FLAG_COPY.not_matched_to_deposit(renamed)).toContain("Community Money");
    expect(SWEEP_CLOSEOUT_SKIP_COPY.wrong_fund(renamed)).toContain("Community Money");
  });

  it("SWEEP_ERROR_COPY.future_date is present and names no fund", () => {
    expect(SWEEP_ERROR_COPY.future_date(renamed)).toBe(
      "A sweep is recorded after the money moves, so its date cannot be in the future.",
    );
  });

  it("describeSweepWarning: one sentence per variant, singular and plural, with the renamed fund and a formatted balance", () => {
    const bal: SweepWarning = { code: "exceeds_fund_balance", fundBalanceCents: 123456 };
    expect(describeSweepWarning(bal, renamed)).toBe("This sweep is more than the Community Money balance of $1,234.56.");
    expect(describeSweepWarning({ code: "unmatched_sources", count: 1 }, renamed)).toBe(
      "1 gift is not matched to a bank deposit in Community Money yet.",
    );
    expect(describeSweepWarning({ code: "unmatched_sources", count: 3 }, renamed)).toContain("3 gifts are not matched");
    expect(describeSweepWarning({ code: "no_donor", count: 1 }, renamed)).toBe("1 gift has no donor record.");
    expect(describeSweepWarning({ code: "no_donor", count: 2 }, renamed)).toBe("2 gifts have no donor record.");
  });

  it("describeSentStatementMonth names the month and the added amount", () => {
    expect(describeSentStatementMonth({ month: "2026-03", addsCents: 12000 })).toBe(
      "March 2026: a statement already sent for this month would change by $120.00.",
    );
  });

  it("sweepBatchState: rejected, then approved, then pending, else posted", () => {
    const at = new Date("2026-10-19T12:00:00Z");
    const cases: [string, Date | null, SweepBatchState][] = [
      ["rejected", null, "rejected"],
      ["rejected", at, "rejected"],
      ["posted", at, "approved"],
      ["pending", at, "approved"],
      ["pending", null, "pending"],
      ["posted", null, "posted"],
    ];
    for (const [status, approvedAt, state] of cases) expect(sweepBatchState({ status, approvedAt })).toBe(state);
    expect(sweepBatchState({ status: "posted", approvedAt: "2026-10-19T12:00:00Z" })).toBe("approved");
  });

  it("sweepBatchNextStep: a distinct, fund-name-free sentence per state, and approved never says to void", () => {
    const states: SweepBatchState[] = ["pending", "posted", "approved", "rejected"];
    const texts = states.map((st) => sweepBatchNextStep(st));
    expect(new Set(texts).size).toBe(4);
    for (const t of texts) expect(t).not.toMatch(/Public Funds|Activity/);
    expect(sweepBatchNextStep("approved")).toMatch(/correcting entry/);
    expect(sweepBatchNextStep("approved")).not.toMatch(/void it/i);
    expect(sweepBatchNextStep("posted")).toMatch(/void/i);
    expect(sweepBatchNextStep("pending")).toMatch(/Reject/);
    expect(sweepBatchNextStep("rejected")).toMatch(/record/);
  });

  it("sweepChipLabel: every badge kind and state, as a function of the labels", () => {
    const L = "leg-1";
    const batch = (state: SweepBatchState, count: number): SweepRowBadge => ({ kind: "batch", legId: L, sweepDate: "2026-10-19", state, count });
    expect(sweepChipLabel(batch("posted", 3), renamed)).toBe("Sweep of 3 gifts to the Foundation");
    expect(sweepChipLabel(batch("posted", 1), renamed)).toBe("Sweep of 1 gift to the Foundation");
    expect(sweepChipLabel(batch("pending", 3), renamed)).toBe("Sweep of 3 gifts to the Foundation (pending approval)");
    expect(sweepChipLabel(batch("approved", 3), renamed)).toBe("Sweep of 3 gifts to the Foundation (approved)");
    expect(sweepChipLabel({ kind: "copy", legId: L, sweepDate: "2026-10-19", state: "posted" }, renamed)).toBe(
      "Swept from Community Money on October 19, 2026",
    );
    expect(sweepChipLabel({ kind: "copy", legId: L, sweepDate: "2026-10-19", state: "pending" }, renamed)).toBe(
      "Swept from Community Money on October 19, 2026 (pending approval)",
    );
    expect(sweepChipLabel({ kind: "source", legId: L, sweepDate: "2026-01-05", state: "approved" }, renamed)).toBe(
      "Swept to the Foundation on January 5, 2026 (approved)",
    );
    expect(sweepChipLabel({ kind: "source", legId: L, sweepDate: "2026-01-05", state: "posted" }, renamed)).not.toContain(
      DEFAULT_FUND_LABELS.activity,
    );
  });

  it("parseSweepPreselect: valid ids kept, others dropped, duplicates collapsed, capped at 200, arrays and undefined handled", () => {
    expect(parseSweepPreselect(undefined)).toEqual([]);
    expect(parseSweepPreselect("")).toEqual([]);
    expect(parseSweepPreselect(`${U(1)},${U(2)}`)).toEqual([U(1), U(2)]);
    expect(parseSweepPreselect(`${U(1)},nope,${U(1)},,${U(2)}`)).toEqual([U(1), U(2)]);
    expect(parseSweepPreselect([`${U(1)},${U(2)}`, U(3), U(2)])).toEqual([U(1), U(2), U(3)]);
    const many = Array.from({ length: SWEEP_BATCH_MAX + 50 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
    const out = parseSweepPreselect(many.join(","));
    expect(out).toHaveLength(SWEEP_BATCH_MAX);
    expect(out[0]).toBe(many[0]);
  });

  it("sweepBuilderHref: the builder URL with the ids, or the bare page", () => {
    expect(sweepBuilderHref([])).toBe("/admin/ledger/sweep");
    expect(sweepBuilderHref([U(1)])).toBe(`/admin/ledger/sweep?sweep=${U(1)}`);
    expect(sweepBuilderHref([U(1), U(2)])).toBe(`/admin/ledger/sweep?sweep=${U(1)},${U(2)}`);
    expect(parseSweepPreselect(sweepBuilderHref([U(1), U(2)]).split("sweep=")[1])).toEqual([U(1), U(2)]);
  });
});

/**
 * B-172 Increment 2a, pass 2: the server half of the itemized sweep
 * (ledger-sweep-batch.ts). Hermetic: `@/lib/db` is a table-keyed fake whose
 * select chains are thenables that pop one queued result per table, in the
 * order the module reads them; a throw inside `db.transaction` discards the
 * writes recorded during it (a real rollback). The collaborators that have
 * their own suites (audit writer, notifier, settings, statement lookup,
 * reconciliation matches, the lock helper, bank-account validation) are mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { st, mocks } = vi.hoisted(() => ({
  st: {
    reads: {} as Record<string, unknown[]>,
    wheres: [] as { table: string; where: unknown }[],
    forModes: [] as string[],
    inserts: [] as { table: string; values: unknown }[],
    insertReturns: {} as Record<string, unknown[]>,
    deletes: [] as { table: string; where: unknown }[],
    deleteReturns: {} as Record<string, unknown[]>,
    committed: 0,
    rolledBack: 0,
  },
  mocks: {
    recordLedgerAudit: vi.fn(),
    recordLedgerAuditNote: vi.fn(),
    notify: vi.fn(),
    getSettings: vi.fn(),
    findSentStatementMonth: vi.fn(),
    postedFundRows: vi.fn(),
    listMatchedTransactionIds: vi.fn(),
    lockDecisionGroup: vi.fn(),
    validateBankAccountForEntity: vi.fn(),
  },
}));

vi.mock("@/lib/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const pop = (bag: Record<string, unknown[]>, table: string) => {
    const next = bag[table]?.shift();
    return next === undefined ? [] : next;
  };
  const settle = (value: unknown) =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  const select = () => {
    let table = "";
    const chain: Record<string, unknown> = {
      from: (t: unknown) => {
        table = getTableName(t as never);
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (w: unknown) => {
        st.wheres.push({ table, where: w });
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      for: (mode: string) => {
        st.forModes.push(mode);
        return chain;
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        settle(pop(st.reads, table)).then(res, rej),
    };
    return chain;
  };
  const insert = (t: unknown) => {
    const table = getTableName(t as never);
    return {
      values: (values: unknown) => {
        st.inserts.push({ table, values });
        const out: Record<string, unknown> = {
          returning: () => settle(pop(st.insertReturns, table)),
          onConflictDoNothing: () => out,
        };
        return out;
      },
    };
  };
  const del = (t: unknown) => {
    const table = getTableName(t as never);
    return {
      where: (where: unknown) => {
        st.deletes.push({ table, where });
        return { returning: () => settle(pop(st.deleteReturns, table)) };
      },
    };
  };
  const handle = { select, insert, delete: del };
  return {
    db: {
      ...handle,
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const inserts = st.inserts.length;
        const deletes = st.deletes.length;
        try {
          const out = await cb(handle);
          st.committed += 1;
          return out;
        } catch (e) {
          st.inserts.length = inserts;
          st.deletes.length = deletes;
          st.rolledBack += 1;
          throw e;
        }
      },
    },
  };
});

vi.mock("@/lib/ledger-audit", () => ({
  recordLedgerAudit: mocks.recordLedgerAudit,
  recordLedgerAuditNote: mocks.recordLedgerAuditNote,
}));
vi.mock("@/lib/ledger-approval-notify", () => ({ notifyPendingApprovers: mocks.notify }));
vi.mock("@/lib/ledger-queries", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/ledger-fund-move-preview", () => ({
  findSentStatementMonth: mocks.findSentStatementMonth,
  postedFundRows: mocks.postedFundRows,
}));
vi.mock("@/lib/reconciliation-queries", () => ({
  listMatchedTransactionIds: mocks.listMatchedTransactionIds,
}));
vi.mock("@/lib/ledger-board-decision", () => ({ lockDecisionGroup: mocks.lockDecisionGroup }));
vi.mock("@/lib/ledger-transaction-validation", () => ({
  validateBankAccountForEntity: mocks.validateBankAccountForEntity,
}));

import {
  createSweepBatch,
  evaluateSweepBatch,
  getSweepBatchDetail,
  isSweepClaimConflict,
  listSweepCandidates,
  listSweepCloseouts,
  markSweepCloseouts,
  previewSweepBatch,
  resolveSweepFunds,
  unmarkSweepCloseouts,
  voidSweepBatch,
} from "./ledger-sweep-batch";
import { SWEEP_ROW_REFUSALS, type SweepRowRefusal } from "./ledger-sweep";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const U = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CLUB = U(100);
const FOUNDATION = U(101);
const SRC_FUND = U(110);
const DEST_FUND = U(111);
const SRC_BANK = U(120);
const DEST_BANK = U(121);
const CAT_PUBLIC = U(130);
const CAT_WHITE_CANE = U(131);
const CAT_INTEREST = U(132);
const MIRROR_PUBLIC = U(140);
const MIRROR_WHITE_CANE = U(141);
const LEG_CAT = U(150);
const ACTOR = U(160);
const NOW = new Date("2026-10-19T15:00:00Z"); // FY2026

const funds = () => [
  { id: SRC_FUND, entityId: CLUB, kind: "activity", name: "Public Funds", openingBalanceCents: 0, isActive: true, deductible: false },
  { id: DEST_FUND, entityId: FOUNDATION, kind: "charitable", name: "Charitable Fund", openingBalanceCents: 0, isActive: true, deductible: true },
];

function gift(n: number, over: Record<string, unknown> = {}) {
  return {
    id: U(n),
    entityId: CLUB,
    fundId: SRC_FUND,
    bankAccountId: SRC_BANK,
    txnDate: "2026-10-01",
    flow: "income",
    categoryId: CAT_PUBLIC,
    amountCents: 6000,
    party: `Test Donor ${n}`,
    memo: `Gift ${n}`,
    beneficiaryCause: null,
    paymentMethod: "zeffy",
    status: "posted",
    transferGroupId: null,
    duesPaymentId: null,
    sweptFromTxnId: null,
    sweepLegTxnId: null,
    donorId: U(n + 5000),
    reconciled: false,
    reconciledSessionId: null,
    approvedAt: null,
    recordedByUserId: ACTOR,
    ...over,
  };
}

function cat(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    entityId: CLUB,
    fundKind: "activity",
    flow: "income",
    isActive: true,
    ackNotRequired: false,
    mirrorsCategoryId: null,
    entityDonationsDeductible: false,
    ...over,
  };
}
const mirrorRow = (id: string, name: string, over: Record<string, unknown> = {}) =>
  cat(id, name, { entityId: FOUNDATION, fundKind: "charitable", entityDonationsDeductible: true, ...over });

interface Scenario {
  funds?: unknown[];
  sources: unknown[];
  categories?: unknown[];
  mirrors?: unknown[];
  live?: string[];
  closeouts?: string[];
  sent?: { txnId: string; sentAt: Date }[];
  filings?: number[];
  legCategory?: { id: string }[];
}

const DEFAULT_CATS = () => [
  cat(CAT_PUBLIC, "Public donations", { mirrorsCategoryId: MIRROR_PUBLIC }),
  cat(CAT_WHITE_CANE, "White Cane", { mirrorsCategoryId: MIRROR_WHITE_CANE }),
  cat(CAT_INTEREST, "Interest"),
];
const DEFAULT_MIRRORS = () => [
  mirrorRow(MIRROR_PUBLIC, "Public donations"),
  mirrorRow(MIRROR_WHITE_CANE, "White Cane"),
];

/** Queue every read one evaluation makes, in the order the module makes them. */
function seedEvaluation(s: Scenario) {
  st.reads.ledger_transactions.push(s.sources);
  const cats = s.categories ?? DEFAULT_CATS();
  st.reads.ledger_categories.push(cats);
  const wantsMirror = (cats as { mirrorsCategoryId: string | null; id: string }[]).some(
    (c) =>
      c.mirrorsCategoryId &&
      (s.sources as { categoryId: string | null }[]).some((r) => r.categoryId === c.id),
  );
  // The module asks for mirrors whenever any LOADED category names one.
  const anyMirrorNamed = (cats as { mirrorsCategoryId: string | null }[]).some((c) => c.mirrorsCategoryId);
  if (anyMirrorNamed || wantsMirror) st.reads.ledger_categories.push(s.mirrors ?? DEFAULT_MIRRORS());
  st.reads.ledger_transactions.push((s.live ?? []).map((id) => ({ id })));
  st.reads.ledger_sweep_closeouts.push((s.closeouts ?? []).map((txnId) => ({ txnId })));
  st.reads.ledger_acknowledgments.push(s.sent ?? []);
  st.reads.ledger_filings.push((s.filings ?? []).map((fiscalYear) => ({ fiscalYear })));
}

function seedPreview(s: Scenario) {
  st.reads.ledger_funds.push(s.funds ?? funds());
  seedEvaluation(s);
}

const base = {
  sourceBankAccountId: SRC_BANK,
  destBankAccountId: DEST_BANK,
  sweepDate: "2026-10-19",
};
const record = { userId: ACTOR, callerCanManage: false };
const manage = { userId: ACTOR, callerCanManage: true };

beforeEach(() => {
  st.reads = {
    ledger_funds: [],
    ledger_transactions: [],
    ledger_categories: [],
    ledger_sweep_closeouts: [],
    ledger_acknowledgments: [],
    ledger_filings: [],
    ledger_entities: [],
  };
  st.wheres = [];
  st.forModes = [];
  st.inserts = [];
  st.insertReturns = {};
  st.deletes = [];
  st.deleteReturns = {};
  st.committed = 0;
  st.rolledBack = 0;
  vi.clearAllMocks();
  mocks.recordLedgerAudit.mockResolvedValue(undefined);
  mocks.recordLedgerAuditNote.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
  mocks.getSettings.mockResolvedValue({ disbApprovalThresholdCents: 10000 });
  mocks.findSentStatementMonth.mockResolvedValue(null);
  mocks.postedFundRows.mockResolvedValue([{ id: "x", flow: "income", amountCents: 1_000_000 }]);
  mocks.listMatchedTransactionIds.mockResolvedValue(new Set());
  mocks.validateBankAccountForEntity.mockResolvedValue({ ok: true, account: { id: "b", name: "Checking" } });
});

// ---------------------------------------------------------------------------
// Preview and execute return the same verdict
// ---------------------------------------------------------------------------

/** One scenario per refusal code: [code, sources, scenario overrides, caller can manage]. */
const REFUSAL_CASES: Array<[SweepRowRefusal, Scenario & { manage?: boolean }]> = [
  ["not_found", { sources: [] }],
  ["wrong_fund", { sources: [gift(1, { fundId: U(999) })] }],
  ["not_income", { sources: [gift(1, { flow: "expense" })] }],
  ["not_posted", { sources: [gift(1, { status: "pending" })] }],
  ["transfer_leg", { sources: [gift(1, { transferGroupId: U(900) })] }],
  ["dues_synced", { sources: [gift(1, { duesPaymentId: U(901) })] }],
  ["already_swept", { sources: [gift(1)], live: [U(1)] }],
  ["closed_out", { sources: [gift(1)], closeouts: [U(1)] }],
  ["no_category", { sources: [gift(1, { categoryId: null })] }],
  ["no_mirror", { sources: [gift(1, { categoryId: CAT_INTEREST })] }],
  ["mirror_inactive", { sources: [gift(1)], mirrors: [mirrorRow(MIRROR_PUBLIC, "Public donations", { isActive: false })] }],
  ["mirror_invalid", { sources: [gift(1)], mirrors: [mirrorRow(MIRROR_PUBLIC, "Public donations", { flow: "expense" })] }],
  ["gift_after_sweep", { sources: [gift(1, { txnDate: "2026-10-25" })] }],
  ["period_filed", { sources: [gift(1, { txnDate: "2025-11-10" })], filings: [2025], manage: true }],
  ["manage_required", { sources: [gift(1, { txnDate: "2025-11-10" })] }],
];

describe("preview and execute share one evaluator", () => {
  it("covers every refusal code", () => {
    expect(REFUSAL_CASES.map(([c]) => c).sort()).toEqual([...SWEEP_ROW_REFUSALS].sort());
  });

  it.each(REFUSAL_CASES)("%s: preview and create refuse the same row for the same reason", async (code, scenario) => {
    const sourceIds = [U(1)];
    const actor = scenario.manage ? manage : record;
    // preview
    seedPreview(scenario);
    const preview = await previewSweepBatch(
      { ...base, sourceIds },
      { callerCanManage: actor.callerCanManage },
      NOW,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.response.rows[0].refusal).toBe(code);
    expect(preview.response.canPost).toBe(false);
    expect(preview.response.count).toBe(0);
    expect(preview.response.totalCents).toBe(0);

    // create, same input
    seedPreview(scenario);
    const created = await createSweepBatch(
      { ...base, sourceIds, boardMinute: "Minute 4", bankAmountCents: 6000 },
      actor,
      NOW,
    );
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.body.rows).toEqual([{ sourceId: U(1), code }]);
    const expectedStatus = code === "already_swept" ? 409 : code === "manage_required" ? 403 : 409;
    expect(created.status).toBe(expectedStatus);
    expect(created.body.code).toBe(
      code === "already_swept" ? "rows_claimed" : code === "manage_required" ? "manage_required" : "rows_refused",
    );
    // Nothing was written.
    expect(st.inserts).toEqual([]);
    expect(mocks.recordLedgerAuditNote).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("preview lists every requested id in request order, with the refusal on the row and totals over accepted rows only", async () => {
    seedPreview({ sources: [gift(2), gift(3, { categoryId: CAT_INTEREST }), gift(1, { amountCents: 4000 })] });
    const r = await previewSweepBatch({ ...base, sourceIds: [U(3), U(1), U(2), U(9)] }, { callerCanManage: false }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.response.rows.map((x) => [x.sourceId, x.refusal])).toEqual([
      [U(3), "no_mirror"],
      [U(1), null],
      [U(2), null],
      [U(9), "not_found"],
    ]);
    expect(r.response.totalCents).toBe(10000);
    expect(r.response.count).toBe(2);
    expect(r.response.canPost).toBe(false);
  });

  it("the source rows are locked FOR UPDATE by create and not by preview", async () => {
    seedPreview({ sources: [gift(1)] });
    await previewSweepBatch({ ...base, sourceIds: [U(1)] }, { callerCanManage: false }, NOW);
    expect(st.forModes).toEqual([]);

    seedPreview({ sources: [gift(1)] });
    st.insertReturns.ledger_transactions = [[{ id: U(500) }], [{ id: U(501), sourceId: U(1) }]];
    await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(st.forModes).toEqual(["update"]);
  });

  it("evaluateSweepBatch reads the live-copy test through the one shared predicate (a rejected copy does not block)", async () => {
    seedEvaluation({ sources: [gift(1)] });
    await evaluateSweepBatch(
      db,
      { sourceIds: [U(1)], sweepDate: "2026-10-19" },
      { funds: { source: { id: SRC_FUND, entityId: CLUB, kind: "activity", name: "x", openingBalanceCents: 0 }, dest: { id: DEST_FUND, entityId: FOUNDATION, kind: "charitable", name: "y", openingBalanceCents: 0 }, labels: {} as never }, callerCanManage: false, now: NOW, lock: false },
    );
    const live = st.wheres.filter((w) => w.table === "ledger_transactions")[1];
    const text = new PgDialect().sqlToQuery(live.where as SQL).sql;
    expect(text).toContain("swept_from_txn_id");
    expect(text).toContain("status <> 'rejected'");
  });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe("createSweepBatch", () => {
  function seedCreate(s: Scenario, copyIds: [string, string][] = []) {
    seedPreview(s);
    st.reads.ledger_categories.push(s.legCategory ?? [{ id: LEG_CAT }]);
    st.insertReturns.ledger_transactions = [
      [{ id: U(500) }],
      copyIds.map(([id, sourceId]) => ({ id, sourceId })),
    ];
  }

  it("posts one leg and N copies with the exact shapes", async () => {
    seedCreate({ sources: [gift(2, { categoryId: CAT_WHITE_CANE, amountCents: 3000 }), gift(1, { amountCents: 4000 })] }, [
      [U(601), U(1)],
      [U(602), U(2)],
    ]);
    const r = await createSweepBatch(
      { ...base, sourceIds: [U(2), U(1)], boardMinute: "Minute 4", bankAmountCents: 7000 },
      record,
      NOW,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [legInsert, copyInsert] = st.inserts;
    const leg = legInsert.values as Record<string, unknown>;
    expect(leg).toMatchObject({
      entityId: CLUB,
      fundId: SRC_FUND,
      bankAccountId: SRC_BANK,
      txnDate: "2026-10-19",
      flow: "expense",
      categoryId: LEG_CAT,
      amountCents: 7000,
      memo: "Itemized sweep: 2 gifts",
      boardMinute: "Minute 4",
      status: "posted",
      recordedByUserId: ACTOR,
    });
    expect(typeof leg.transferGroupId).toBe("string");
    expect(leg.transferGroupId).toBe(r.response.transferGroupId);
    expect(leg).not.toHaveProperty("sweptFromTxnId");
    expect(leg).not.toHaveProperty("sweepLegTxnId");
    expect(leg).not.toHaveProperty("party");

    const copies = copyInsert.values as Record<string, unknown>[];
    expect(copies).toHaveLength(2);
    // Request order: the White Cane gift first.
    expect(copies[0]).toMatchObject({
      entityId: FOUNDATION,
      fundId: DEST_FUND,
      bankAccountId: DEST_BANK,
      flow: "income",
      categoryId: MIRROR_WHITE_CANE,
      amountCents: 3000,
      txnDate: "2026-10-01",
      party: "Test Donor 2",
      memo: "Gift 2",
      donorId: U(5002),
      boardMinute: "Minute 4",
      status: "posted",
      recordedByUserId: ACTOR,
      sweptFromTxnId: U(2),
      sweepLegTxnId: U(500),
      transferGroupId: null,
    });
    expect(copies[1]).toMatchObject({ categoryId: MIRROR_PUBLIC, sweptFromTxnId: U(1), sweepLegTxnId: U(500), transferGroupId: null });

    expect(r.response).toEqual({
      legId: U(500),
      transferGroupId: leg.transferGroupId,
      copyIds: [U(602), U(601)], // aligned with the request order [U(2), U(1)]
      status: "posted",
      totalCents: 7000,
      count: 2,
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("the leg takes no category when the Club has no Transfer to Foundation category (A1 fallback)", async () => {
    seedCreate({ sources: [gift(1)], legCategory: [] }, [[U(601), U(1)]]);
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(r.ok).toBe(true);
    expect((st.inserts[0].values as Record<string, unknown>).categoryId).toBeNull();
  });

  it("status is pending iff the total is strictly above the threshold (an equal total posts)", async () => {
    seedCreate({ sources: [gift(1, { amountCents: 10000 })] }, [[U(601), U(1)]]);
    const equal = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 10000 }, record, NOW);
    expect(equal.ok && equal.response.status).toBe("posted");
    expect(mocks.notify).not.toHaveBeenCalled();

    st.inserts = [];
    seedCreate({ sources: [gift(1, { amountCents: 10001 })] }, [[U(601), U(1)]]);
    const above = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 10001 }, record, NOW);
    expect(above.ok && above.response.status).toBe("pending");
    const copy = (st.inserts[1].values as Record<string, unknown>[])[0];
    expect(copy.status).toBe("pending");
    expect((st.inserts[0].values as Record<string, unknown>).status).toBe("pending");
  });

  it("the total is derived from the locked rows: a mismatch is a 400 naming both numbers and writes nothing", async () => {
    seedPreview({ sources: [gift(1, { amountCents: 6000 })] });
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 5999 }, record, NOW);
    expect(r).toMatchObject({ ok: false, status: 400, body: { code: "total_mismatch", derivedCents: 6000, typedCents: 5999 } });
    expect(st.inserts).toEqual([]);
  });

  it("a derived total above INT4_MAX is a 400 total_too_large before any insert", async () => {
    seedPreview({ sources: [gift(1, { amountCents: 2_000_000_000 }), gift(2, { amountCents: 2_000_000_000 })] });
    const r = await createSweepBatch(
      { ...base, sourceIds: [U(1), U(2)], boardMinute: "m", bankAmountCents: 2_147_483_647 },
      record,
      NOW,
    );
    expect(r).toMatchObject({ ok: false, status: 400, body: { code: "total_too_large" } });
    expect(st.inserts).toEqual([]);
  });

  it("preview says canPost false above INT4_MAX, in step with the create refusal (B1)", async () => {
    const sources = [gift(1, { amountCents: 2_000_000_000 }), gift(2, { amountCents: 2_000_000_000 })];
    seedPreview({ sources });
    const p = await previewSweepBatch({ ...base, sourceIds: [U(1), U(2)] }, { callerCanManage: true }, NOW);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // every row is accepted and the caller holds the tier; only the total stops it
    expect(p.response.rows.every((r) => r.refusal === null)).toBe(true);
    expect(p.response.totalCents).toBe(4_000_000_000);
    expect(p.response.canPost).toBe(false);

    seedPreview({ sources });
    const c = await createSweepBatch({ ...base, sourceIds: [U(1), U(2)], boardMinute: "m", bankAmountCents: 1000 }, manage, NOW);
    expect(c).toMatchObject({ ok: false, body: { code: "total_too_large" } });
  });

  it("a total of exactly INT4_MAX can still be posted (the boundary is inclusive)", async () => {
    seedPreview({ sources: [gift(1, { amountCents: 2_147_483_647 })] });
    const p = await previewSweepBatch({ ...base, sourceIds: [U(1)] }, { callerCanManage: true }, NOW);
    expect(p.ok && p.response.canPost).toBe(true);
  });

  it("a batch spanning two fiscal years needs a reason and posts one leg and N copies, each copy in its own year", async () => {
    const sources = [gift(1, { txnDate: "2025-11-10", amountCents: 3000 }), gift(2, { txnDate: "2026-10-01", amountCents: 4000 })];
    seedPreview({ sources });
    const noReason = await createSweepBatch({ ...base, sourceIds: [U(1), U(2)], boardMinute: "m", bankAmountCents: 7000 }, manage, NOW);
    expect(noReason).toMatchObject({ ok: false, status: 400, body: { code: "reason_required" } });

    seedCreate({ sources }, [[U(601), U(1)], [U(602), U(2)]]);
    const r = await createSweepBatch(
      { ...base, sourceIds: [U(1), U(2)], boardMinute: "m", bankAmountCents: 7000, priorYearReason: "Gifts held over from the last season" },
      manage,
      NOW,
    );
    expect(r.ok).toBe(true);
    const copies = st.inserts[1].values as { txnDate: string }[];
    expect(copies.map((c) => c.txnDate)).toEqual(["2025-11-10", "2026-10-01"]);
    const note = mocks.recordLedgerAuditNote.mock.calls[0][1];
    expect(note.after.fiscalYears).toEqual([2025, 2026]);
    expect(note.after.tier).toBe("manage");
    expect(note.details).toContain("Gifts held over from the last season");
  });

  it("a record-tier caller with a prior-year gift is a 403 manage_required naming the rows", async () => {
    seedPreview({ sources: [gift(1, { txnDate: "2025-11-10" })] });
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: "manage_required", rows: [{ sourceId: U(1), code: "manage_required" }] } });
  });

  it("a prior-year SWEEP date alone is manage tier", async () => {
    seedPreview({ sources: [gift(1, { txnDate: "2026-05-01" })] });
    const r = await createSweepBatch({ ...base, sweepDate: "2026-06-30", sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: "manage_required" } });
  });

  it("a unique violation on the live-copy index is a 409 rows_claimed naming the claimed rows", async () => {
    seedPreview({ sources: [gift(1)] });
    st.reads.ledger_categories.push([{ id: LEG_CAT }]);
    st.insertReturns.ledger_transactions = [
      [{ id: U(500) }],
      Object.assign(new Error('duplicate key value violates unique constraint "ux_ledger_txn_swept_from_live"'), { code: "23505" }),
    ];
    // The re-read after the failed transaction sees the rival's live copy.
    seedEvaluation({ sources: [gift(1)], live: [U(1)] });
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "rows_claimed", rows: [{ sourceId: U(1), code: "already_swept" }] } });
    expect(st.rolledBack).toBe(1);
    expect(st.inserts).toEqual([]);
  });

  it("any other database error is rethrown (a 500 at the route), not mapped to a claim", async () => {
    seedPreview({ sources: [gift(1)] });
    st.reads.ledger_categories.push([{ id: LEG_CAT }]);
    st.insertReturns.ledger_transactions = [Object.assign(new Error("boom"), { code: "XX000" })];
    await expect(
      createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW),
    ).rejects.toThrow("boom");
  });

  it("a short copy insert rolls the whole batch back (sentinel), it does not commit a half-written batch", async () => {
    seedCreate({ sources: [gift(1), gift(2)] }, [[U(601), U(1)]]);
    await expect(
      createSweepBatch({ ...base, sourceIds: [U(1), U(2)], boardMinute: "m", bankAmountCents: 12000 }, record, NOW),
    ).rejects.toThrow("copy insert count mismatch");
    expect(st.rolledBack).toBe(1);
    expect(st.inserts).toEqual([]);
  });

  it("writes the sweep_batch_created note inside the transaction, and a failing note rolls everything back", async () => {
    seedCreate({ sources: [gift(1)] }, [[U(601), U(1)]]);
    const ok = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(ok.ok).toBe(true);
    expect(mocks.recordLedgerAuditNote).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedgerAuditNote.mock.calls[0][1]).toMatchObject({
      actorUserId: ACTOR,
      action: "sweep_batch_created",
      before: null,
    });
    expect(mocks.recordLedgerAuditNote.mock.calls[0][1].after).toMatchObject({ legId: U(500), count: 1, totalCents: 6000, status: "posted" });
    expect(st.committed).toBe(1);

    st.inserts = [];
    st.committed = 0;
    seedCreate({ sources: [gift(1)] }, [[U(601), U(1)]]);
    mocks.recordLedgerAuditNote.mockRejectedValueOnce(new Error("audit down"));
    await expect(
      createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW),
    ).rejects.toThrow("audit down");
    expect(st.rolledBack).toBe(1);
    expect(st.committed).toBe(0);
    expect(st.inserts).toEqual([]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("a pending batch notifies the approvers with a count and no party or memo; a throwing notifier never fails the 201", async () => {
    seedCreate({ sources: [gift(1, { amountCents: 20000 })] }, [[U(601), U(1)]]);
    mocks.notify.mockRejectedValueOnce(new Error("mail down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 20000 }, record, NOW);
    expect(r.ok).toBe(true);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    const notice = mocks.notify.mock.calls[0][0];
    expect(notice).toMatchObject({ noun: "sweep", amountDollars: "200.00", txnDate: "2026-10-19", reviewTxnId: U(500), batch: { count: 1 } });
    expect(notice).not.toHaveProperty("party");
    expect(notice).not.toHaveProperty("memo");
    expect(JSON.stringify(notice)).not.toContain("Test Donor");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses without opening a transaction when the direction or a bank account is wrong", async () => {
    mocks.validateBankAccountForEntity.mockResolvedValueOnce({ ok: false, status: 400, code: "bank_account_invalid", error: "x" });
    st.reads.ledger_funds.push(funds());
    const r = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(r).toMatchObject({ ok: false, status: 400, body: { code: "bank_account_invalid" } });
    expect(st.committed).toBe(0);
    expect(st.rolledBack).toBe(0);

    // two charitable funds on the deductible entity: ambiguous destination
    st.reads.ledger_funds.push([...funds(), { ...funds()[1], id: U(112) }]);
    const ambiguous = await createSweepBatch({ ...base, sourceIds: [U(1)], boardMinute: "m", bankAmountCents: 6000 }, record, NOW);
    expect(ambiguous).toMatchObject({ ok: false, status: 404, body: { code: "fund_not_found" } });
  });

  it("the destination fund is resolved from the database and the source from the Club's one public fund", async () => {
    st.reads.ledger_funds.push(funds());
    const f = await resolveSweepFunds(db);
    expect(f?.source.id).toBe(SRC_FUND);
    expect(f?.dest.id).toBe(DEST_FUND);
    st.reads.ledger_funds.push([funds()[0]]);
    expect(await resolveSweepFunds(db)).toBeNull();
  });
});

describe("isSweepClaimConflict", () => {
  it("recognises the index violation however the driver wraps it, and nothing else", () => {
    const direct = Object.assign(new Error("x"), { code: "23505", constraint_name: "ux_ledger_txn_swept_from_live" });
    expect(isSweepClaimConflict(direct)).toBe(true);
    expect(isSweepClaimConflict(Object.assign(new Error("wrapped"), { cause: direct }))).toBe(true);
    expect(isSweepClaimConflict(Object.assign(new Error("dup"), { code: "23505", constraint: "ledger_funds_entity_slug_key" }))).toBe(false);
    expect(isSweepClaimConflict(Object.assign(new Error("ux_ledger_txn_swept_from_live"), { code: "40001" }))).toBe(false);
    expect(isSweepClaimConflict(null)).toBe(false);
    expect(isSweepClaimConflict("nope")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preview details
// ---------------------------------------------------------------------------

describe("previewSweepBatch details", () => {
  it("flags, receipt state, warnings, tier, sent-statement months and the typed difference", async () => {
    mocks.findSentStatementMonth.mockImplementation(async (_e: unknown, a: { txnDate: string }) =>
      a.txnDate.startsWith("2026-10") ? "2026-10" : null,
    );
    mocks.postedFundRows.mockResolvedValue([{ id: "x", flow: "income", amountCents: 5000 }]);
    mocks.listMatchedTransactionIds.mockResolvedValue(new Set([U(1)]));
    seedPreview({
      sources: [
        gift(1, { amountCents: 30000, donorId: null }),
        gift(2, { amountCents: 5000, txnDate: "2026-06-15" }),
      ],
      sent: [{ txnId: U(2), sentAt: new Date("2026-08-02T16:00:00Z") }],
    });
    const r = await previewSweepBatch({ ...base, sourceIds: [U(1), U(2)], bankAmountCents: 35500 }, { callerCanManage: true }, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.response.rows;
    expect(a.flags).toEqual(["statement_already_sent", "no_donor"]);
    expect(a.foundationReceipt).toBe("may_be_needed");
    expect(b.flags).toEqual(["prior_fiscal_year", "receipt_already_sent", "not_matched_to_deposit"]);
    expect(b.foundationReceipt).toBe("already_sent");
    expect(b.receiptSentOn).toBe("2026-08-02");
    expect(r.response.tier).toBe("manage");
    expect(r.response.needsReason).toBe(true);
    expect(r.response.sentStatementMonths).toEqual([{ month: "2026-10", addsCents: 30000 }]);
    expect(r.response.fiscalYears).toEqual([2025, 2026]);
    expect(r.response.status).toBe("pending");
    expect(r.response.thresholdCents).toBe(10000);
    expect(r.response.typedBankAmountCents).toBe(35500);
    expect(r.response.differenceCents).toBe(500);
    expect(r.response.warnings).toEqual([
      { code: "exceeds_fund_balance", fundBalanceCents: 5000 },
      { code: "unmatched_sources", count: 1 },
      { code: "no_donor", count: 1 },
    ]);
    expect(r.response.canPost).toBe(true);
  });

  it("a record-tier caller sees tier manage and cannot post a prior-year batch", async () => {
    seedPreview({ sources: [gift(1, { txnDate: "2025-11-10" })] });
    const r = await previewSweepBatch({ ...base, sourceIds: [U(1)] }, { callerCanManage: false }, NOW);
    expect(r.ok && r.response.tier).toBe("manage");
    expect(r.ok && r.response.canPost).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Candidates agree with the evaluator
// ---------------------------------------------------------------------------

describe("listSweepCandidates", () => {
  it("offers exactly the rows the evaluator accepts and reports the same refusal for the rest", async () => {
    const sources = [
      gift(1),
      gift(2, { categoryId: CAT_WHITE_CANE }),
      gift(3, { categoryId: CAT_INTEREST }),
      gift(4, { categoryId: null }),
      gift(5, { txnDate: "2025-11-10" }),
      gift(6, { txnDate: "2026-11-01" }),
    ];
    const scenario: Scenario = { sources, filings: [] };

    // The evaluator, as a manager.
    seedPreview(scenario);
    const preview = await previewSweepBatch(
      { ...base, sourceIds: sources.map((s) => s.id) },
      { callerCanManage: true },
      NOW,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // The candidate list over the same rows.
    st.reads.ledger_funds.push(funds());
    st.reads.ledger_transactions.push(sources); // the candidate rows
    st.reads.ledger_transactions.push([{ sourceId: U(77) }]); // sources a pending batch holds
    st.reads.ledger_categories.push(DEFAULT_CATS());
    st.reads.ledger_categories.push(DEFAULT_MIRRORS());
    st.reads.ledger_transactions.push([]); // live
    st.reads.ledger_sweep_closeouts.push([]);
    st.reads.ledger_acknowledgments.push([]);
    st.reads.ledger_filings.push([]);
    const candidates = await listSweepCandidates(db, { now: NOW, sweepDate: "2026-10-19" });

    const verdict = new Map(preview.response.rows.map((r) => [r.sourceId, r.refusal]));
    expect(candidates.eligible.map((c) => c.sourceId).sort()).toEqual(
      [...verdict].filter(([, v]) => v === null).map(([id]) => id).sort(),
    );
    for (const held of candidates.heldBack) expect(held.refusal).toBe(verdict.get(held.row.sourceId));
    expect(candidates.heldBack.map((h) => h.row.sourceId).sort()).toEqual(
      [...verdict].filter(([, v]) => v !== null).map(([id]) => id).sort(),
    );
    expect(candidates.inPendingBatch).toEqual([U(77)]);
    expect(candidates.eligible[0]).toMatchObject({ foundationCategoryName: "Public donations", hasDonor: true });
  });

  it("returns empty lists when the funds cannot be resolved", async () => {
    st.reads.ledger_funds.push([]);
    expect(await listSweepCandidates(db, { now: NOW })).toEqual({ eligible: [], heldBack: [], inPendingBatch: [] });
  });

  it("excludes swept and closed-out gifts in SQL so the cap is never spent on done rows", async () => {
    st.reads.ledger_funds.push(funds());
    st.reads.ledger_transactions.push([], []);
    st.reads.ledger_filings.push([]);
    await listSweepCandidates(db, { now: NOW });
    const text = new PgDialect().sqlToQuery(st.wheres.find((w) => w.table === "ledger_transactions")!.where as SQL).sql;
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("swept_from_txn_id");
    expect(text).toContain("ledger_sweep_closeouts");
  });
});

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

describe("voidSweepBatch", () => {
  const LEG = U(500);
  const leg = (over: Record<string, unknown> = {}) =>
    gift(500, {
      id: LEG,
      flow: "expense",
      fundId: SRC_FUND,
      entityId: CLUB,
      categoryId: LEG_CAT,
      txnDate: "2026-10-19",
      amountCents: 10000,
      transferGroupId: U(900),
      donorId: null,
      party: null,
      memo: "Itemized sweep: 2 gifts",
      sweptFromTxnId: null,
      sweepLegTxnId: null,
      ...over,
    });
  const copy = (n: number, over: Record<string, unknown> = {}) =>
    gift(n, {
      id: U(n),
      flow: "income",
      entityId: FOUNDATION,
      fundId: DEST_FUND,
      bankAccountId: DEST_BANK,
      categoryId: MIRROR_PUBLIC,
      amountCents: 5000,
      sweptFromTxnId: U(n + 1000),
      sweepLegTxnId: LEG,
      transferGroupId: null,
      ...over,
    });

  function seedVoid(rows: unknown[], extra: { receipts?: { id: string; sentAt: Date | null }[]; filings?: number[] } = {}) {
    mocks.lockDecisionGroup.mockResolvedValue(rows);
    st.reads.ledger_acknowledgments.push(extra.receipts ?? []);
    st.reads.ledger_filings.push((extra.filings ?? []).map((fiscalYear) => ({ fiscalYear })));
    st.reads.ledger_entities.push([
      { id: CLUB, name: "Westerville Lions Club", shortName: "Club", slug: "club" },
      { id: FOUNDATION, name: "Westerville Lions Foundation", shortName: "Foundation", slug: "foundation" },
    ]);
    st.reads.ledger_funds.push([
      { id: SRC_FUND, name: "Public Funds", slug: "activity", kind: "activity" },
      { id: DEST_FUND, name: "Charitable Fund", slug: "charitable", kind: "charitable" },
    ]);
    st.deleteReturns.ledger_transactions = [[{ id: U(601) }, { id: U(602) }], [{ id: LEG }]];
  }
  const run = (reason = "Keyed against the wrong account") => voidSweepBatch(LEG, { userId: ACTOR }, reason, NOW);

  it("locks the group FOR UPDATE through the one lock helper", async () => {
    seedVoid([leg(), copy(601), copy(602)]);
    await run();
    expect(mocks.lockDecisionGroup).toHaveBeenCalledWith(expect.anything(), LEG, "update");
  });

  it("an unknown id is 404 not_found and a non-sweep (a pair leg, a copy id) is 404 not_a_sweep", async () => {
    mocks.lockDecisionGroup.mockResolvedValue([]);
    expect(await run()).toMatchObject({ ok: false, status: 404, body: { code: "not_found" } });
    mocks.lockDecisionGroup.mockResolvedValue([leg()]);
    expect(await run()).toMatchObject({ ok: false, status: 404, body: { code: "not_a_sweep" } });
    mocks.lockDecisionGroup.mockResolvedValue([copy(601, { id: LEG })]);
    expect(await run()).toMatchObject({ ok: false, status: 404, body: { code: "not_a_sweep" } });
  });

  const blocks: Array<[string, () => void, string]> = [
    ["pending_use_reject", () => seedVoid([leg({ status: "pending" }), copy(601), copy(602)]), "pending_use_reject"],
    ["already_rejected", () => seedVoid([leg({ status: "rejected" }), copy(601), copy(602)]), "already_rejected"],
    ["approved", () => seedVoid([leg({ approvedAt: new Date("2026-10-19") }), copy(601), copy(602)]), "approved"],
    ["reconciled (a copy)", () => seedVoid([leg(), copy(601, { reconciled: true }), copy(602)]), "reconciled"],
    ["reconciled (the leg's session)", () => seedVoid([leg({ reconciledSessionId: U(950) }), copy(601), copy(602)]), "reconciled"],
    [
      "matched",
      () => {
        seedVoid([leg(), copy(601), copy(602)]);
        mocks.listMatchedTransactionIds.mockResolvedValue(new Set([U(601)]));
      },
      "matched",
    ],
    [
      "receipt_sent",
      () => seedVoid([leg(), copy(601), copy(602)], { receipts: [{ id: U(700), sentAt: new Date("2026-09-01") }] }),
      "receipt_sent",
    ],
    ["prior_fiscal_year", () => seedVoid([leg({ txnDate: "2026-06-30" }), copy(601), copy(602)]), "prior_fiscal_year"],
    ["period_filed", () => seedVoid([leg(), copy(601, { txnDate: "2025-11-10" }), copy(602)], { filings: [2025] }), "period_filed"],
  ];

  it.each(blocks)("%s blocks the void, names the next step and deletes nothing", async (_n, seed, code) => {
    seed();
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409, body: { code } });
    if (!r.ok) expect(r.body.error.length).toBeGreaterThan(20);
    expect(st.deletes).toEqual([]);
    expect(mocks.recordLedgerAudit).not.toHaveBeenCalled();
  });

  it("covers every SweepVoidBlock the route can answer", () => {
    const codes = new Set(blocks.map(([, , c]) => c));
    for (const c of ["pending_use_reject", "already_rejected", "approved", "reconciled", "matched", "receipt_sent", "prior_fiscal_year", "period_filed"]) {
      expect(codes.has(c)).toBe(true);
    }
  });

  it("happy path: audits first, deletes the copies BEFORE the leg, counts unsent receipts, and the snapshot has no party, memo or donor", async () => {
    seedVoid([leg(), copy(601), copy(602)], { receipts: [{ id: U(700), sentAt: null }] });
    const r = await run("Keyed against the wrong account");
    expect(r).toEqual({ ok: true, response: { voided: true, copiesRemoved: 2, acknowledgmentsRemoved: 1 } });

    expect(st.deletes).toHaveLength(2);
    expect(st.deletes.every((d) => d.table === "ledger_transactions")).toBe(true);
    const copyDelete = new PgDialect().sqlToQuery(st.deletes[0].where as SQL);
    expect(copyDelete.params).toEqual(expect.arrayContaining([U(601), U(602)]));
    const legDelete = new PgDialect().sqlToQuery(st.deletes[1].where as SQL);
    expect(legDelete.params).toEqual([LEG]);
    expect(copyDelete.params).not.toContain(LEG);

    expect(mocks.recordLedgerAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.recordLedgerAudit.mock.calls[0][1];
    expect(entry).toMatchObject({ actorUserId: ACTOR, action: "sweep_batch_voided", targetTransactionId: null, after: null });
    expect(entry.details).toMatchObject({
      v: 1,
      reason: "Keyed against the wrong account",
      entityId: CLUB,
      destEntityId: FOUNDATION,
      txnDate: "2026-10-19",
      amountCents: 10000,
      fiscalYear: 2026,
      count: 2,
      copyFiscalYears: [2026],
      unsentAcknowledgmentsRemoved: 1,
    });
    expect(entry.before.leg).toMatchObject({ id: LEG, flow: "expense", status: "posted", categoryId: LEG_CAT, bankAccountId: SRC_BANK });
    expect(entry.before.copies).toHaveLength(2);
    expect(entry.before.copies[0]).toMatchObject({ id: U(601), bankAccountId: DEST_BANK, categoryId: MIRROR_PUBLIC, sweptFromTxnId: U(1601) });
    expect(entry.before.leg.entity).toEqual({ id: CLUB, name: "Club", slug: "club" });
    const text = JSON.stringify(entry);
    expect(text).not.toMatch(/"(party|memo|donorId|donor)"/);
    expect(text).not.toContain("Test Donor");
    expect(st.committed).toBe(1);
  });

  it("a short delete count rolls the void back (sentinel) instead of committing a partial void", async () => {
    seedVoid([leg(), copy(601), copy(602)]);
    st.deleteReturns.ledger_transactions = [[{ id: U(601) }], [{ id: LEG }]];
    await expect(run()).rejects.toThrow("copy delete count mismatch");
    expect(st.rolledBack).toBe(1);
    expect(st.deletes).toEqual([]);
  });

  it("a failing audit write rolls the void back before any delete", async () => {
    seedVoid([leg(), copy(601), copy(602)]);
    mocks.recordLedgerAudit.mockRejectedValueOnce(new Error("audit down"));
    await expect(run()).rejects.toThrow("audit down");
    expect(st.deletes).toEqual([]);
    expect(st.rolledBack).toBe(1);
  });

  it("a void leaves the sources claimable: the live-copy rows are gone with the copies, so the next evaluation accepts them", async () => {
    seedVoid([leg(), copy(601), copy(602)]);
    await run();
    // the copies are deleted; the next evaluation sees no live copy
    seedPreview({ sources: [gift(1001)], live: [] });
    const p = await previewSweepBatch({ ...base, sourceIds: [U(1001)] }, { callerCanManage: false }, NOW);
    expect(p.ok && p.response.rows[0].refusal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

describe("getSweepBatchDetail", () => {
  it("summarises by category and carries no party, memo or donor field", async () => {
    const LEGID = U(500);
    st.reads.ledger_transactions.push([gift(500, { id: LEGID, flow: "expense", txnDate: "2026-10-19", approvedAt: null, status: "pending", boardMinute: "Minute 4", recordedByUserId: ACTOR })]);
    st.reads.ledger_transactions.push([
      gift(601, { sweepLegTxnId: LEGID, categoryId: MIRROR_PUBLIC, amountCents: 5000, txnDate: "2025-11-10" }),
      gift(602, { sweepLegTxnId: LEGID, categoryId: MIRROR_WHITE_CANE, amountCents: 7000 }),
      gift(603, { sweepLegTxnId: LEGID, categoryId: MIRROR_PUBLIC, amountCents: 1000 }),
    ]);
    st.reads.ledger_categories.push([{ id: MIRROR_PUBLIC, name: "Public donations" }, { id: MIRROR_WHITE_CANE, name: "White Cane" }]);
    const users = st.reads as Record<string, unknown[]>;
    users.users = [[{ name: "Pat Treasurer" }]];
    const d = await getSweepBatchDetail(db, LEGID);
    expect(d).toEqual({
      legId: LEGID,
      status: "pending",
      sweepDate: "2026-10-19",
      boardMinute: "Minute 4",
      recordedBy: "Pat Treasurer",
      count: 3,
      totalCents: 13000,
      byCategory: [
        { name: "White Cane", count: 1, cents: 7000 },
        { name: "Public donations", count: 2, cents: 6000 },
      ],
      fiscalYears: [2025, 2026],
      approved: false,
      reconciled: false,
      earliestGiftDate: "2025-11-10",
      latestGiftDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(JSON.stringify(d)).not.toMatch(/party|memo|donor|Test Donor/i);
  });

  it("a row with no copies, a copy, or an income row is not a batch (null)", async () => {
    st.reads.ledger_transactions.push([gift(1, { flow: "expense" })], []);
    expect(await getSweepBatchDetail(db, U(1))).toBeNull();
    st.reads.ledger_transactions.push([gift(1, { flow: "income" })]);
    expect(await getSweepBatchDetail(db, U(1))).toBeNull();
    st.reads.ledger_transactions.push([gift(1, { flow: "expense", sweepLegTxnId: U(5) })]);
    expect(await getSweepBatchDetail(db, U(1))).toBeNull();
  });

  it("an email-shaped recorder name is never shown", async () => {
    st.reads.ledger_transactions.push([gift(500, { flow: "expense", id: U(500) })]);
    st.reads.ledger_transactions.push([gift(601, { sweepLegTxnId: U(500) })]);
    st.reads.ledger_categories.push([{ id: MIRROR_PUBLIC, name: "Public donations" }]);
    (st.reads as Record<string, unknown[]>).users = [[{ name: "someone@example.invalid" }]];
    expect((await getSweepBatchDetail(db, U(500)))?.recordedBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Closeouts
// ---------------------------------------------------------------------------

describe("getSweepBatchDetail gift-date span (B8)", () => {
  it("carries the earliest and latest GIFT date, and a one-gift batch has the same date at both ends", async () => {
    const LEGID = U(500);
    const read = (dates: string[]) => {
      st.reads.ledger_transactions.push([gift(500, { id: LEGID, flow: "expense", txnDate: "2026-10-19", approvedAt: null, status: "posted", recordedByUserId: ACTOR })]);
      st.reads.ledger_transactions.push(dates.map((d, i) => gift(601 + i, { sweepLegTxnId: LEGID, categoryId: MIRROR_PUBLIC, txnDate: d })));
      st.reads.ledger_categories.push([{ id: MIRROR_PUBLIC, name: "Public donations" }]);
      (st.reads as Record<string, unknown[]>).users = [[{ name: "Pat Treasurer" }]];
    };
    read(["2026-08-14", "2025-11-10", "2026-10-01"]);
    const wide = await getSweepBatchDetail(db, LEGID);
    expect(wide).toMatchObject({ earliestGiftDate: "2025-11-10", latestGiftDate: "2026-10-01" });
    read(["2026-09-09"]);
    const one = await getSweepBatchDetail(db, LEGID);
    expect(one).toMatchObject({ earliestGiftDate: "2026-09-09", latestGiftDate: "2026-09-09" });
    expect(Object.keys(one ?? {}).sort()).toEqual([
      "approved", "boardMinute", "byCategory", "count", "earliestGiftDate", "fiscalYears", "latestGiftDate",
      "legId", "reconciled", "recordedBy", "status", "sweepDate", "totalCents",
    ]);
  });
});

describe("listSweepCloseouts (B10)", () => {
  it("returns the marked gifts with their reason, newest mark first as the query orders them, closedAt as an ISO string", async () => {
    st.reads.ledger_sweep_closeouts.push([
      { sourceId: U(2), reason: "Covered by the 2026-10-01 lump", closedAt: new Date("2026-10-18T14:00:00Z"), giftDate: "2026-09-02", amountCents: 7500, party: "Test Donor 2", categoryName: "Public donations" },
      { sourceId: U(1), reason: "Carried earlier", closedAt: new Date("2026-10-10T09:30:00Z"), giftDate: "2026-08-20", amountCents: 2500, party: null, categoryName: null },
    ]);
    const rows = await listSweepCloseouts(db);
    expect(rows).toEqual([
      { sourceId: U(2), giftDate: "2026-09-02", amountCents: 7500, party: "Test Donor 2", categoryName: "Public donations", reason: "Covered by the 2026-10-01 lump", closedAt: "2026-10-18T14:00:00.000Z" },
      { sourceId: U(1), giftDate: "2026-08-20", amountCents: 2500, party: null, categoryName: null, reason: "Carried earlier", closedAt: "2026-10-10T09:30:00.000Z" },
    ]);
  });

  it("is empty when nothing is marked, and reads only the closeouts table joined to its gift (one select)", async () => {
    expect(await listSweepCloseouts(db)).toEqual([]);
    expect(st.wheres).toEqual([]);
  });
});

describe("closeouts", () => {
  function seedMark(sources: unknown[], live: string[] = [], closed: string[] = [], inserted?: string[]) {
    st.reads.ledger_funds.push(funds());
    st.reads.ledger_transactions.push(sources);
    st.reads.ledger_transactions.push(live.map((id) => ({ id })));
    st.reads.ledger_sweep_closeouts.push(closed.map((txnId) => ({ txnId })));
    st.insertReturns.ledger_sweep_closeouts = [
      (inserted ?? sources.map((s) => (s as { id: string }).id).filter((id) => !live.includes(id) && !closed.includes(id))).map((txnId) => ({ txnId })),
    ];
  }

  it("marks the eligible gifts, skips the rest with a code, and writes ONE note for the request", async () => {
    seedMark(
      [gift(1), gift(2, { flow: "expense" }), gift(3, { fundId: U(999) }), gift(4, { status: "pending" }), gift(5, { transferGroupId: U(900) }), gift(6), gift(7)],
      [U(6)],
      [U(7)],
      [U(1)],
    );
    const r = await markSweepCloseouts(
      { sourceIds: [U(1), U(2), U(3), U(4), U(5), U(6), U(7), U(8)], reason: "Covered by an earlier lump sweep" },
      { userId: ACTOR },
    );
    expect(r.changed).toBe(1);
    expect(r.skipped).toEqual([
      { sourceId: U(2), code: "not_income" },
      { sourceId: U(3), code: "wrong_fund" },
      { sourceId: U(4), code: "not_posted" },
      { sourceId: U(5), code: "transfer_leg" },
      { sourceId: U(6), code: "already_swept" },
      { sourceId: U(7), code: "already_closed_out" },
      { sourceId: U(8), code: "not_found" },
    ]);
    expect(st.inserts).toHaveLength(1);
    expect(st.inserts[0].values).toEqual([{ txnId: U(1), reason: "Covered by an earlier lump sweep", closedByUserId: ACTOR }]);
    expect(mocks.recordLedgerAuditNote).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedgerAuditNote.mock.calls[0][1]).toMatchObject({ action: "sweep_closeout_marked", after: { count: 1 } });
    expect(st.forModes).toEqual(["update"]);
  });

  it("a race that closed a row first reports already_closed_out for it and counts only what it inserted", async () => {
    seedMark([gift(1), gift(2)], [], [], [U(1)]);
    const r = await markSweepCloseouts({ sourceIds: [U(1), U(2)], reason: "Covered by an earlier lump sweep" }, { userId: ACTOR });
    expect(r).toEqual({ changed: 1, skipped: [{ sourceId: U(2), code: "already_closed_out" }] });
  });

  it("nothing eligible writes nothing and no note", async () => {
    seedMark([gift(1)], [U(1)]);
    const r = await markSweepCloseouts({ sourceIds: [U(1)], reason: "Covered by an earlier lump sweep" }, { userId: ACTOR });
    expect(r).toEqual({ changed: 0, skipped: [{ sourceId: U(1), code: "already_swept" }] });
    expect(st.inserts).toEqual([]);
    expect(mocks.recordLedgerAuditNote).not.toHaveBeenCalled();
  });

  it("unmark removes the marks, skips the rest as not_closed_out, and writes one note", async () => {
    st.deleteReturns.ledger_sweep_closeouts = [[{ txnId: U(1) }]];
    const r = await unmarkSweepCloseouts({ sourceIds: [U(1), U(2)] }, { userId: ACTOR });
    expect(r).toEqual({ changed: 1, skipped: [{ sourceId: U(2), code: "not_closed_out" }] });
    expect(mocks.recordLedgerAuditNote).toHaveBeenCalledTimes(1);
    expect(mocks.recordLedgerAuditNote.mock.calls[0][1]).toMatchObject({ action: "sweep_closeout_unmarked" });
  });

  it("unmarking nothing writes no note", async () => {
    st.deleteReturns.ledger_sweep_closeouts = [[]];
    const r = await unmarkSweepCloseouts({ sourceIds: [U(2)] }, { userId: ACTOR });
    expect(r.changed).toBe(0);
    expect(mocks.recordLedgerAuditNote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Module hygiene
// ---------------------------------------------------------------------------

describe("module hygiene", () => {
  const text = readFileSync(join(__dirname, "ledger-sweep-batch.ts"), "utf8");

  it("never calls console.log and never writes a decision column", () => {
    expect(text).not.toMatch(/console\.log/);
    expect(text).not.toMatch(/approvedAt\s*:|approvedByUserId\s*:|rejectedAt\s*:|rejectedByUserId\s*:|rejectionReason\s*:/);
  });
});

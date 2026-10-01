/**
 * T13-T19: query-layer tests for the fund move (DECISION-109/111). `@/lib/db`
 * is mocked with a recording handle: every select/update/insert is captured in
 * call order, and `db.insert` / `db.update` THROW so any write that escaped the
 * transaction handle fails loudly. A mocked db cannot prove lock semantics or
 * FK cascades; those are the live-database checks in the work-log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Call = {
  op: "select" | "update" | "insert";
  table?: unknown;
  where?: unknown;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  forUpdate?: boolean;
  via: "tx" | "db";
};

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as unknown[],
    selectResults: [] as unknown[][],
    updateResult: [{ id: "x" }] as unknown[],
    insertError: null as Error | null,
    inTx: false,
  },
}));

vi.mock("@/lib/db", () => {
  function makeHandle(via: "tx" | "db") {
    return {
      select: () => {
        const result = state.selectResults.shift() ?? [];
        const call: Call = { op: "select", via };
        state.calls.push(call);
        const chain: Record<string, unknown> = {
          from: (t: unknown) => {
            call.table = t;
            return chain;
          },
          where: (w: unknown) => {
            call.where = w;
            return chain;
          },
          orderBy: () => chain,
          limit: () => chain,
          for: () => {
            call.forUpdate = true;
            return chain;
          },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej),
        };
        return chain;
      },
      update: (table: unknown) => {
        if (via === "db") throw new Error("db.update used outside the transaction");
        const call: Call = { op: "update", table, via };
        state.calls.push(call);
        return {
          set: (s: Record<string, unknown>) => {
            call.set = s;
            return {
              where: (w: unknown) => {
                call.where = w;
                return { returning: () => Promise.resolve(state.updateResult) };
              },
            };
          },
        };
      },
      insert: (table: unknown) => {
        if (via === "db") throw new Error("db.insert used outside the transaction");
        const call: Call = { op: "insert", table, via };
        state.calls.push(call);
        return {
          values: (v: Record<string, unknown>) => {
            call.values = v;
            return state.insertError ? Promise.reject(state.insertError) : Promise.resolve();
          },
        };
      },
    };
  }
  const tx = makeHandle("tx");
  const db = {
    ...makeHandle("db"),
    transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  };
  return { db };
});

import { db as dbHandle } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerAuditLog,
  financialReportSends,
} from "@/lib/db/schema";
import {
  executeFundMove,
  findSentStatementMonth,
  previewFundMove,
} from "./ledger-fund-move-queries";
import { parseAuditBefore, parseAuditDetails, parseAuditAfter } from "./ledger-correction";

const calls = () => state.calls as Call[];
const writes = () => calls().filter((c) => c.op === "update" || c.op === "insert");
const render = (c: Call) => new PgDialect().sqlToQuery(c.where as SQL);

const NOW = new Date(2026, 9, 1); // 2026-10-01
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN_FUND = {
  id: "11111111-1111-4111-8111-111111111111",
  entityId: "club",
  slug: "administrative",
  name: "Administrative Fund",
  kind: "administrative",
  openingBalanceCents: 100000,
  isActive: true,
};
const ACTIVITY_FUND = {
  id: "22222222-2222-4222-8222-222222222222",
  entityId: "club",
  slug: "activity",
  name: "Activity Fund",
  kind: "activity",
  openingBalanceCents: 0,
  isActive: true,
};
const SCHOLARSHIP_FUND = {
  id: "33333333-3333-4333-8333-333333333333",
  entityId: "club",
  slug: "scholarship",
  name: "Scholarship Fund",
  kind: "scholarship",
  openingBalanceCents: 0,
  isActive: true,
};
const FOUNDATION_FUND = {
  id: "44444444-4444-4444-8444-444444444444",
  entityId: "foundation",
  slug: "charitable",
  name: "Charitable Fund",
  kind: "charitable",
  openingBalanceCents: 0,
  isActive: true,
};
const BANK = { name: "Administrative Checking", entityId: "club" };
const CATEGORY_ID = "55555555-5555-4555-8555-555555555555";
const ACTIVITY_CATEGORY = {
  id: CATEGORY_ID,
  entityId: "club",
  fundKind: "activity",
  flow: "income",
  isActive: true,
  name: "Public donations",
};

const ROW = {
  id: ID,
  entityId: "club",
  fundId: ADMIN_FUND.id,
  bankAccountId: "66666666-6666-4666-8666-666666666666",
  txnDate: "2026-09-15",
  flow: "income",
  categoryId: "77777777-7777-4777-8777-777777777777",
  amountCents: 12500,
  party: "Example Donor",
  status: "posted",
  approvedAt: null,
  duesPaymentId: null,
  transferGroupId: null,
  reconciled: false,
  reconciledSessionId: null,
  budgetLineId: "88888888-8888-4888-8888-888888888888",
};

const INPUT = {
  destFundId: ACTIVITY_FUND.id,
  categoryId: CATEGORY_ID,
  reason: "Zeffy gift booked to the wrong fund",
  expectedFundId: ADMIN_FUND.id,
};

/** Queue the selects executeFundMove issues, in order, for a successful move. */
function queueExecute(over: {
  row?: Record<string, unknown> | null;
  source?: unknown;
  dest?: unknown;
  bank?: unknown;
  category?: unknown;
  sentRow?: unknown;
  withCategory?: boolean;
} = {}) {
  const row = over.row === undefined ? ROW : over.row;
  const queue: unknown[][] = [[row].filter(Boolean)];
  if (row) {
    queue.push([over.source ?? ADMIN_FUND]);
    queue.push([over.dest ?? ACTIVITY_FUND]);
    queue.push([over.bank ?? BANK]);
    if (over.withCategory !== false) queue.push([over.category ?? ACTIVITY_CATEGORY]);
    if ((row as { categoryId?: unknown }).categoryId) queue.push([{ name: "Donations" }]);
    queue.push(over.sentRow ? [over.sentRow] : []);
  }
  state.selectResults = queue;
}

function run(over: Partial<Parameters<typeof executeFundMove>[0]> = {}) {
  return executeFundMove({
    transactionId: ID,
    actorUserId: ACTOR,
    callerCanManage: false,
    input: INPUT,
    now: NOW,
    ...over,
  });
}

beforeEach(() => {
  state.calls = [];
  state.selectResults = [];
  state.updateResult = [{ id: ID }];
  state.insertError = null;
});

describe("executeFundMove: lock and write shape (T13)", () => {
  it("the first statement is a FOR UPDATE select on ledgerTransactions by id; nothing is written before it", async () => {
    queueExecute();
    await run();
    const first = calls()[0];
    expect(first.op).toBe("select");
    expect(first.table).toBe(ledgerTransactions);
    expect(first.forUpdate).toBe(true);
    expect(first.via).toBe("tx");
    const q = render(first);
    expect(q.sql).toBe('"ledger_transactions"."id" = $1');
    expect(q.params).toEqual([ID]);
  });

  it("the UPDATE where is pinned to id AND the locked fund_id", async () => {
    queueExecute();
    await run();
    const update = calls().find((c) => c.op === "update")!;
    const q = render(update);
    expect(q.sql).toBe('("ledger_transactions"."id" = $1 and "ledger_transactions"."fund_id" = $2)');
    expect(q.params).toEqual([ID, ADMIN_FUND.id]);
  });
});

describe("executeFundMove: tier on the locked row (T14)", () => {
  it("a reconciled row without manage is 403 manage_required with zero writes; with manage it succeeds", async () => {
    const reconciled = { ...ROW, reconciled: true, reconciledSessionId: "s1" };
    queueExecute({ row: reconciled });
    const denied = await run();
    expect(denied).toMatchObject({ ok: false, status: 403, code: "manage_required" });
    expect(writes()).toHaveLength(0);

    state.calls = [];
    queueExecute({ row: reconciled });
    const ok = await run({ callerCanManage: true });
    expect(ok.ok).toBe(true);
    expect(writes()).toHaveLength(2);
  });

  it("a legacy-reconciled row needs manage too", async () => {
    queueExecute({ row: { ...ROW, reconciled: true } });
    expect(await run()).toMatchObject({ ok: false, code: "manage_required" });
  });

  it("a prior-fiscal-year row without manage is 403 with zero writes; with manage it succeeds", async () => {
    const old = { ...ROW, txnDate: "2025-12-01" };
    queueExecute({ row: old });
    expect(await run()).toMatchObject({ ok: false, status: 403, code: "manage_required" });
    expect(writes()).toHaveLength(0);

    queueExecute({ row: old });
    expect((await run({ callerCanManage: true })).ok).toBe(true);
  });

  it("the tier is stamped into the audit details", async () => {
    queueExecute({ row: { ...ROW, reconciled: true, reconciledSessionId: "s1" } });
    await run({ callerCanManage: true });
    const audit = calls().find((c) => c.op === "insert")!;
    const details = parseAuditDetails("transaction_fund_moved", audit.values!.details as string);
    expect(details).toMatchObject({ tier: "manage", reconciled: true, reconciledSessionId: "s1" });
  });
});

describe("executeFundMove: stale and double submit (T15)", () => {
  it("a stale expectedFundId is 409 stale with zero writes", async () => {
    queueExecute();
    const r = await run({ input: { ...INPUT, expectedFundId: ACTIVITY_FUND.id } });
    expect(r).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(writes()).toHaveLength(0);
  });

  it("a double submit writes exactly one audit row across both calls", async () => {
    queueExecute();
    const first = await run();
    expect(first.ok).toBe(true);

    // The second request locks the row AFTER the first committed: it already sits in the destination.
    queueExecute({ row: { ...ROW, fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND });
    const second = await run();
    expect(second).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(1);
    expect(calls().filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("when the pinned UPDATE matches no row it is 409 stale and no audit row is written", async () => {
    queueExecute();
    state.updateResult = [];
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(0);
  });
});

describe("executeFundMove: refusals (T16)", () => {
  const cases: Array<[string, () => void, number, string, Partial<Parameters<typeof executeFundMove>[0]>?]> = [
    ["approved", () => queueExecute({ row: { ...ROW, approvedAt: new Date() } }), 403, "approved"],
    ["rejected", () => queueExecute({ row: { ...ROW, status: "rejected" } }), 403, "rejected"],
    ["pending", () => queueExecute({ row: { ...ROW, status: "pending" } }), 403, "pending"],
    ["transfer leg", () => queueExecute({ row: { ...ROW, transferGroupId: "g1" } }), 403, "transfer_leg"],
    ["dues-synced", () => queueExecute({ row: { ...ROW, duesPaymentId: "d1" } }), 403, "dues_synced"],
    ["row not found", () => queueExecute({ row: null }), 404, "not_found"],
    [
      "same fund",
      () => queueExecute({ dest: ADMIN_FUND }),
      409,
      "same_fund",
      { input: { ...INPUT, destFundId: ADMIN_FUND.id } },
    ],
    [
      "cross-entity destination (row without a bank account)",
      () =>
        queueExecute({
          row: { ...ROW, bankAccountId: null },
          dest: FOUNDATION_FUND,
          bank: undefined,
        }),
      403,
      "cross_entity",
      { input: { ...INPUT, destFundId: FOUNDATION_FUND.id } },
    ],
    [
      "away from public (income activity to administrative)",
      () =>
        queueExecute({
          row: { ...ROW, fundId: ACTIVITY_FUND.id },
          source: ACTIVITY_FUND,
          dest: ADMIN_FUND,
        }),
      403,
      "away_from_public",
      { input: { ...INPUT, destFundId: ADMIN_FUND.id, expectedFundId: ACTIVITY_FUND.id } },
    ],
    [
      "expense (activity to administrative)",
      () =>
        queueExecute({
          row: { ...ROW, flow: "expense", fundId: ACTIVITY_FUND.id },
          source: ACTIVITY_FUND,
          dest: ADMIN_FUND,
        }),
      403,
      "expense_not_supported",
      { input: { ...INPUT, destFundId: ADMIN_FUND.id, expectedFundId: ACTIVITY_FUND.id } },
    ],
    ["bank account in another entity", () => queueExecute({ bank: { name: "X", entityId: "foundation" } }), 409, "bank_account_entity_mismatch"],
    ["bank account that no longer resolves", () => {
      state.selectResults = [[ROW], [ADMIN_FUND], [ACTIVITY_FUND], []];
    }, 409, "bank_account_entity_mismatch"],
    ["destination not found", () => {
      state.selectResults = [[ROW], [ADMIN_FUND], []];
    }, 404, "fund_not_found"],
    ["category not found", () => {
      state.selectResults = [[ROW], [ADMIN_FUND], [ACTIVITY_FUND], [BANK], []];
    }, 404, "category_not_found"],
    ["category of the wrong kind", () => queueExecute({ category: { ...ACTIVITY_CATEGORY, fundKind: "administrative" } }), 400, "category_invalid"],
    ["category of the wrong flow", () => queueExecute({ category: { ...ACTIVITY_CATEGORY, flow: "expense" } }), 400, "category_invalid"],
    ["category of another entity", () => queueExecute({ category: { ...ACTIVITY_CATEGORY, entityId: "foundation" } }), 400, "category_invalid"],
    ["inactive category", () => queueExecute({ category: { ...ACTIVITY_CATEGORY, isActive: false } }), 400, "category_invalid"],
  ];

  it.each(cases)("%s", async (_name, setup, status, code, over) => {
    setup();
    const r = await run(over);
    expect(r).toMatchObject({ ok: false, status, code });
    expect(writes()).toHaveLength(0);
  });

  it("categoryId null succeeds (no category)", async () => {
    queueExecute({ withCategory: false });
    const r = await run({ input: { ...INPUT, categoryId: null } });
    expect(r.ok).toBe(true);
    const update = calls().find((c) => c.op === "update")!;
    expect(update.set!.categoryId).toBeNull();
  });
});

describe("preview/execute parity (T17)", () => {
  const stateRows: Array<[string, Record<string, unknown>, boolean]> = [
    ["approved", { approvedAt: new Date() }, false],
    ["rejected", { status: "rejected" }, false],
    ["pending", { status: "pending" }, false],
    ["transfer leg", { transferGroupId: "g1" }, false],
    ["dues-synced", { duesPaymentId: "d1" }, false],
    ["manage_required (reconciled)", { reconciled: true, reconciledSessionId: "s1" }, false],
    ["manage_required (prior FY)", { txnDate: "2025-12-01" }, false],
    ["not found", {}, true],
  ];

  it.each(stateRows)("%s yields the identical status and code", async (_n, over, missing) => {
    state.selectResults = [missing ? [] : [{ ...ROW, ...over }]];
    const preview = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    state.calls = [];
    state.selectResults = [missing ? [] : [{ ...ROW, ...over }]];
    const executed = await run();
    expect(preview.ok).toBe(false);
    expect(executed.ok).toBe(false);
    if (!preview.ok && !executed.ok) {
      expect({ status: preview.status, code: preview.code }).toEqual({
        status: executed.status,
        code: executed.code,
      });
    }
  });

  it("each destination's allowed flag equals whether execute passes the policy step", async () => {
    // Preview: row, source fund, entity funds, bank, [row category name], then per allowed fund: categories, source rows, dest rows; settings; sent.
    state.selectResults = [
      [ROW],
      [ADMIN_FUND],
      [ADMIN_FUND, ACTIVITY_FUND, SCHOLARSHIP_FUND],
      [BANK],
      [{ name: "Donations" }],
      [{ id: CATEGORY_ID, name: "Public donations" }],
      [{ id: ID, flow: "income", amountCents: 12500 }],
      [],
      [],
      [],
    ];
    const preview = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.destinations).toHaveLength(2);

    for (const dest of preview.preview.destinations) {
      state.calls = [];
      const destFund = dest.fundId === ACTIVITY_FUND.id ? ACTIVITY_FUND : SCHOLARSHIP_FUND;
      queueExecute({ dest: destFund, withCategory: false });
      const r = await run({ input: { ...INPUT, destFundId: dest.fundId, categoryId: null } });
      expect(r.ok).toBe(dest.allowed);
      if (!r.ok) expect(r.code).toBe(dest.denial?.code);
    }
  });
});

describe("executeFundMove: success path (T18)", () => {
  it("updates fund, category, budget link and updatedAt; the audit insert is on the same tx after the update", async () => {
    queueExecute({ sentRow: { id: "send-1" } });
    const r = await run();
    expect(r).toEqual({
      ok: true,
      result: {
        id: ID,
        fundId: ACTIVITY_FUND.id,
        fundSlug: "activity",
        fundName: "Activity Fund",
        categoryId: CATEGORY_ID,
        categoryName: "Public donations",
        sweepSuggested: true,
      },
    });

    const update = calls().find((c) => c.op === "update")!;
    expect(update.table).toBe(ledgerTransactions);
    expect(update.set).toEqual({
      fundId: ACTIVITY_FUND.id,
      categoryId: CATEGORY_ID,
      budgetLineId: null,
      updatedAt: NOW,
    });

    const w = writes();
    expect(w.map((c) => c.op)).toEqual(["update", "insert"]);
    const insert = w[1];
    expect(insert.via).toBe("tx");
    expect(update.via).toBe("tx");
    expect(insert.table).toBe(ledgerAuditLog);
    expect(insert.values).toMatchObject({
      actorUserId: ACTOR,
      action: "transaction_fund_moved",
      targetTransactionId: ID,
      targetCategoryId: null,
    });

    const before = parseAuditBefore("transaction_fund_moved", insert.values!.before as string);
    const after = parseAuditAfter(insert.values!.after as string);
    expect(before).toEqual({
      v: 1,
      fund: { id: ADMIN_FUND.id, name: "Administrative Fund", slug: "administrative", kind: "administrative" },
      category: { id: ROW.categoryId, name: "Donations" },
      budgetLineId: ROW.budgetLineId,
    });
    expect(after).toEqual({
      v: 1,
      fund: { id: ACTIVITY_FUND.id, name: "Activity Fund", slug: "activity", kind: "activity" },
      category: { id: CATEGORY_ID, name: "Public donations" },
      budgetLineId: null,
    });
    expect(parseAuditDetails("transaction_fund_moved", insert.values!.details as string)).toEqual({
      v: 1,
      reason: INPUT.reason,
      entityId: "club",
      txnDate: "2026-09-15",
      flow: "income",
      amountCents: 12500,
      fiscalYear: 2026,
      tier: "record",
      reconciled: false,
      reconciledSessionId: null,
      priorFiscalYear: false,
      sentStatementMonth: "2026-09",
    });
  });

  it("an audit-insert rejection propagates, so the move is never reported successful", async () => {
    queueExecute();
    state.insertError = new Error("audit insert failed");
    await expect(run()).rejects.toThrow("audit insert failed");
  });
});

describe("findSentStatementMonth and warnings (T19)", () => {
  it("returns YYYY-MM for a successful send in a member-exposed fund, issuing only a select on financialReportSends", async () => {
    state.selectResults = [[{ id: "send-1" }]];
    const month = await findSentStatementMonth(dbHandle as never, {
      entityId: "club",
      txnDate: "2026-09-15",
      fundKind: "administrative",
    });
    expect(month).toBe("2026-09");
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ op: "select", table: financialReportSends });
    expect(writes()).toHaveLength(0);
    const q = render(calls()[0]);
    expect(q.params).toEqual(["club", "2026-09-30", true]);
  });

  it("is null for an Activity source fund without querying, and null when no successful row exists", async () => {
    expect(
      await findSentStatementMonth(dbHandle as never, {
        entityId: "club",
        txnDate: "2026-09-15",
        fundKind: "activity",
      }),
    ).toBeNull();
    expect(calls()).toHaveLength(0);

    state.selectResults = [[]];
    expect(
      await findSentStatementMonth(dbHandle as never, {
        entityId: "club",
        txnDate: "2026-09-15",
        fundKind: "administrative",
      }),
    ).toBeNull();
  });

  /** Queue a one-destination preview. */
  function queuePreview(row: Record<string, unknown>, opts: { sent: boolean; holdingDays?: number }) {
    state.selectResults = [
      [row],
      [ADMIN_FUND],
      [ADMIN_FUND, ACTIVITY_FUND],
      [BANK],
      [{ name: "Donations" }],
      [
        { id: "c-default", name: "Public donations" },
        { id: "c-other", name: "Other" },
      ],
      [{ id: row.id, flow: "income", amountCents: 12500 }],
      [{ id: "other", flow: "income", amountCents: 4000 }],
      [{ holdingPeriodWarnDays: opts.holdingDays ?? 365 }],
      opts.sent ? [{ id: "send-1" }] : [],
    ];
  }

  it("a plain current-year move carries ratchet and sweep_not_automatic, the destination category default, and the impact", async () => {
    queuePreview(ROW, { sent: false });
    const r = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.warnings.map((w) => w.code)).toEqual(["ratchet", "sweep_not_automatic"]);
    expect(r.preview.tier).toEqual({ required: "record", reasons: [] });
    const dest = r.preview.destinations[0];
    expect(dest).toMatchObject({
      fundId: ACTIVITY_FUND.id,
      allowed: true,
      defaultCategoryId: "c-default",
    });
    expect(dest.impact).toEqual({
      sourceFund: { name: "Administrative Fund", beforeCents: 112500, afterCents: 100000 },
      destFund: { name: "Activity Fund", beforeCents: 4000, afterCents: 16500 },
      bankAccount: { name: "Administrative Checking", changeCents: 0 },
    });
    expect(r.preview.reasonLimits).toEqual({ min: 10, max: 500 });
    expect(writes()).toHaveLength(0);
  });

  it("a reconciled prior-year row with a sent statement and an aged date carries every warning", async () => {
    const old = { ...ROW, txnDate: "2024-03-10", reconciled: true, reconciledSessionId: "s1" };
    queuePreview(old, { sent: true });
    const r = await previewFundMove({ transactionId: ID, callerCanManage: true, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.warnings.map((w) => w.code)).toEqual([
      "ratchet",
      "reconciled",
      "prior_fiscal_year",
      "sent_statement",
      "aged_public_fund",
      "sweep_not_automatic",
    ]);
    expect(r.preview.warnings.find((w) => w.code === "sent_statement")!.message).toContain("March 2024");
    expect(r.preview.tier.reasons).toEqual(["reconciled", "prior_fiscal_year"]);
  });

  it("when nothing is allowed there is no ratchet or sweep warning", async () => {
    state.selectResults = [
      [{ ...ROW, flow: "expense", fundId: ACTIVITY_FUND.id }],
      [ACTIVITY_FUND],
      [ADMIN_FUND, ACTIVITY_FUND],
      [BANK],
      [{ name: "Donations" }],
      [{ holdingPeriodWarnDays: 365 }],
      [],
    ];
    const r = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.destinations).toEqual([
      expect.objectContaining({ fundId: ADMIN_FUND.id, allowed: false, denial: expect.objectContaining({ code: "expense_not_supported" }) }),
    ]);
    expect(r.preview.warnings).toEqual([]);
  });
});

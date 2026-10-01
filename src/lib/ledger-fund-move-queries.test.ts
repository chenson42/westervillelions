/**
 * T13-T19 and C22-C35: query-layer tests for the fund move (DECISION-109/111,
 * extended across entities by DECISION-112/113). `@/lib/db` is mocked with a
 * recording handle: every select/update/delete/insert is captured in call
 * order, and `db.insert` / `db.update` / `db.delete` THROW so any write that
 * escaped the transaction handle fails loudly.
 *
 * Select results are queued PER TABLE (the table passed to `.from()`), in call
 * order within that table, so adding a read to a different table does not
 * re-sequence every scenario. A table with an empty queue returns [].
 *
 * A mocked db cannot prove lock semantics, FK cascades or commit-on-return
 * behavior; those are the live-database checks in the work-log. The mock does
 * record whether the transaction callback returned ("committed") or threw
 * ("rolled_back") so the rollback-on-lost-race rule is asserted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Call = {
  op: "select" | "update" | "insert" | "delete";
  table?: unknown;
  where?: unknown;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
  forUpdate?: boolean;
  limit?: number;
  via: "tx" | "db";
};

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as unknown[],
    queues: new Map<unknown, unknown[][]>(),
    updateResults: new Map<unknown, unknown[]>(),
    deleteResult: [{ id: "x" }] as unknown[],
    insertError: null as Error | null,
    txEnd: null as "committed" | "rolled_back" | null,
  },
}));

vi.mock("@/lib/db", () => {
  function makeHandle(via: "tx" | "db") {
    return {
      select: () => {
        const call: Call = { op: "select", via };
        state.calls.push(call);
        let result: unknown[] = [];
        const chain: Record<string, unknown> = {
          from: (t: unknown) => {
            call.table = t;
            result = state.queues.get(t)?.shift() ?? [];
            return chain;
          },
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: (w: unknown) => {
            call.where = w;
            return chain;
          },
          orderBy: () => chain,
          limit: (n: number) => {
            call.limit = n;
            return chain;
          },
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
                const result = state.updateResults.get(table) ?? [{ id: "x" }];
                const p = Promise.resolve(result);
                return Object.assign(p, { returning: () => Promise.resolve(result) });
              },
            };
          },
        };
      },
      delete: (table: unknown) => {
        if (via === "db") throw new Error("db.delete used outside the transaction");
        const call: Call = { op: "delete", table, via };
        state.calls.push(call);
        return {
          where: (w: unknown) => {
            call.where = w;
            return { returning: () => Promise.resolve(state.deleteResult) };
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
    transaction: async (cb: (t: unknown) => unknown) => {
      try {
        const r = await cb(tx);
        state.txEnd = "committed";
        return r;
      } catch (e) {
        state.txEnd = "rolled_back";
        throw e;
      }
    },
  };
  return { db };
});

import { db as dbHandle } from "@/lib/db";
import {
  ledgerTransactions,
  ledgerAuditLog,
  ledgerAcknowledgments,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReconciliationSessions,
  ledgerSettings,
  financialReportSends,
} from "@/lib/db/schema";
import {
  buildCrossEntityMoveSet,
  buildSameEntityMoveSet,
  executeFundMove,
  findSentStatementMonth,
  previewFundMove,
} from "./ledger-fund-move-queries";
import {
  parseAuditBefore,
  parseAuditDetails,
  parseAuditAfter,
  type MoveInput,
  type MovePreview,
} from "./ledger-correction";

const calls = () => state.calls as Call[];
const writes = () => calls().filter((c) => c.op === "update" || c.op === "insert" || c.op === "delete");
const render = (c: Call) => new PgDialect().sqlToQuery(c.where as SQL);
const selectsOn = (table: unknown) => calls().filter((c) => c.op === "select" && c.table === table);

function q(table: unknown, ...results: unknown[][]) {
  state.queues.set(table, [...(state.queues.get(table) ?? []), ...results]);
}

const NOW = new Date(2026, 9, 1); // 2026-10-01, FY2026
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CLUB_ENTITY = { id: "club", slug: "club", name: "Westerville Lions Club", shortName: "Club" };
const FOUNDATION_ENTITY = {
  id: "foundation",
  slug: "foundation",
  name: "Westerville Lions Foundation",
  shortName: "Foundation",
};

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
const ACTIVITY_FUND_2 = {
  ...ACTIVITY_FUND,
  id: "23232323-2323-4232-8232-232323232323",
  slug: "activity-two",
  name: "Second Activity Fund",
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
  openingBalanceCents: 50000,
  isActive: true,
};
const BANK = { name: "Administrative Checking", entityId: "club" };
const FOUNDATION_BANK = { name: "Foundation Checking", entityId: "foundation" };
const DEST_ACCT_ID = "99999999-9999-4999-8999-999999999999";
const DEST_ACCT = { id: DEST_ACCT_ID, entityId: "club", isActive: true, name: "Administrative Checking" };
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
  donorId: null,
  status: "posted",
  approvedAt: null,
  duesPaymentId: null,
  transferGroupId: null,
  reconciled: false,
  reconciledSessionId: null,
  budgetLineId: "88888888-8888-4888-8888-888888888888",
};
// A Foundation Charitable income row on Foundation Checking, donor linked.
const FROW = {
  ...ROW,
  entityId: "foundation",
  fundId: FOUNDATION_FUND.id,
  bankAccountId: "10101010-1010-4010-8010-101010101010",
  donorId: "donor-1",
};

const INPUT: MoveInput = {
  destFundId: ACTIVITY_FUND.id,
  categoryId: CATEGORY_ID,
  reason: "Zeffy gift booked to the wrong fund",
  expectedFundId: ADMIN_FUND.id,
  destBankAccountId: null,
};
const CROSS_INPUT: MoveInput = {
  destFundId: ACTIVITY_FUND.id,
  categoryId: CATEGORY_ID,
  reason: "Deposited into the Club account",
  expectedFundId: FOUNDATION_FUND.id,
  destBankAccountId: DEST_ACCT_ID,
};

type Over = {
  row?: Record<string, unknown> | null;
  source?: unknown;
  dest?: unknown;
  /** undefined = the default; null = the select returns nothing ("missing"). */
  bank?: unknown | null;
  destAcct?: unknown | null;
  category?: unknown;
  withCategory?: boolean;
  sentRow?: unknown;
  destSentRow?: unknown;
  match?: unknown;
  ack?: unknown;
};

/** Queue the selects executeFundMove issues for a SAME-ENTITY move. */
function queueSame(over: Over = {}) {
  const row = over.row === undefined ? ROW : over.row;
  q(ledgerTransactions, row ? [row] : []);
  if (!row) return;
  q(ledgerFunds, over.dest === null ? [] : [over.dest ?? ACTIVITY_FUND], [over.source ?? ADMIN_FUND]);
  q(ledgerEntities, [CLUB_ENTITY]);
  q(ledgerBankAccounts, over.bank === null ? [] : [over.bank ?? BANK]);
  if (over.withCategory !== false) q(ledgerCategories, over.category === null ? [] : [over.category ?? ACTIVITY_CATEGORY]);
  if ((row as { categoryId?: unknown }).categoryId) q(ledgerCategories, [{ name: "Donations" }]);
  q(financialReportSends, over.sentRow ? [over.sentRow] : []);
}

/** Queue the selects executeFundMove issues for a CROSS-ENTITY move. */
function queueCross(over: Over = {}) {
  const row = over.row === undefined ? FROW : over.row;
  q(ledgerTransactions, row ? [row] : []);
  if (!row) return;
  q(ledgerFunds, [over.dest ?? ACTIVITY_FUND], [over.source ?? FOUNDATION_FUND]);
  if (over.match) q(ledgerReconciliationMatches, [over.match]);
  q(ledgerEntities, [FOUNDATION_ENTITY, CLUB_ENTITY]);
  // validateBankAccountForEntity (destination), then loadBank (the row's stored account)
  q(ledgerBankAccounts, over.destAcct === null ? [] : [over.destAcct ?? DEST_ACCT], over.bank === null ? [] : [over.bank ?? FOUNDATION_BANK]);
  if (over.withCategory !== false) q(ledgerCategories, over.category === null ? [] : [over.category ?? ACTIVITY_CATEGORY]);
  if ((row as { categoryId?: unknown }).categoryId) q(ledgerCategories, [{ name: "Donations" }]);
  q(financialReportSends, over.sentRow ? [over.sentRow] : [], over.destSentRow ? [over.destSentRow] : []);
  q(ledgerAcknowledgments, over.ack ? [over.ack] : []);
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
const runCross = (over: Partial<Parameters<typeof executeFundMove>[0]> = {}) =>
  run({ callerCanManage: true, input: CROSS_INPUT, ...over });

beforeEach(() => {
  state.calls = [];
  state.queues = new Map();
  state.updateResults = new Map();
  state.deleteResult = [{ id: "ack-1" }];
  state.insertError = null;
  state.txEnd = null;
});

// ---------------------------------------------------------------------------
// T13-T16
// ---------------------------------------------------------------------------

describe("executeFundMove: lock and write shape (T13)", () => {
  it("the first statement is a FOR UPDATE select on ledgerTransactions by id; nothing is written before it", async () => {
    queueSame();
    await run();
    const first = calls()[0];
    expect(first.op).toBe("select");
    expect(first.table).toBe(ledgerTransactions);
    expect(first.forUpdate).toBe(true);
    expect(first.via).toBe("tx");
    const r = render(first);
    expect(r.sql).toBe('"ledger_transactions"."id" = $1');
    expect(r.params).toEqual([ID]);
  });

  it("the same-entity UPDATE where is pinned to id AND the locked fund_id", async () => {
    queueSame();
    await run();
    const update = calls().find((c) => c.op === "update")!;
    const r = render(update);
    expect(r.sql).toBe('("ledger_transactions"."id" = $1 and "ledger_transactions"."fund_id" = $2)');
    expect(r.params).toEqual([ID, ADMIN_FUND.id]);
  });
});

describe("executeFundMove: tier on the locked row (T14)", () => {
  it("a reconciled row without manage is 403 manage_required with zero writes; with manage it succeeds", async () => {
    const reconciled = { ...ROW, reconciled: true, reconciledSessionId: "s1" };
    queueSame({ row: reconciled });
    const denied = await run();
    expect(denied).toMatchObject({ ok: false, status: 403, code: "manage_required" });
    expect(writes()).toHaveLength(0);

    state.calls = [];
    queueSame({ row: reconciled });
    const ok = await run({ callerCanManage: true });
    expect(ok.ok).toBe(true);
    expect(writes()).toHaveLength(2);
  });

  it("a legacy-reconciled row needs manage too", async () => {
    queueSame({ row: { ...ROW, reconciled: true } });
    expect(await run()).toMatchObject({ ok: false, code: "manage_required" });
  });

  it("a prior-fiscal-year row without manage is 403 with zero writes; with manage it succeeds", async () => {
    const old = { ...ROW, txnDate: "2025-12-01" };
    queueSame({ row: old });
    expect(await run()).toMatchObject({ ok: false, status: 403, code: "manage_required" });
    expect(writes()).toHaveLength(0);

    queueSame({ row: old });
    expect((await run({ callerCanManage: true })).ok).toBe(true);
  });

  it("the tier is stamped into the audit details", async () => {
    queueSame({ row: { ...ROW, reconciled: true, reconciledSessionId: "s1" } });
    await run({ callerCanManage: true });
    const audit = calls().find((c) => c.op === "insert")!;
    const details = parseAuditDetails("transaction_fund_moved", audit.values!.details as string);
    expect(details).toMatchObject({ tier: "manage", reconciled: true, reconciledSessionId: "s1" });
  });
});

describe("executeFundMove: stale and double submit (T15)", () => {
  it("a stale expectedFundId is 409 stale with zero writes", async () => {
    queueSame();
    const r = await run({ input: { ...INPUT, expectedFundId: ACTIVITY_FUND.id } });
    expect(r).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(writes()).toHaveLength(0);
  });

  it("a double submit writes exactly one audit row across both calls", async () => {
    queueSame();
    const first = await run();
    expect(first.ok).toBe(true);

    // The second request locks the row AFTER the first committed: it already sits in the destination.
    queueSame({ row: { ...ROW, fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND });
    const second = await run();
    expect(second).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(1);
    expect(calls().filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("when the pinned UPDATE matches no row the transaction ROLLS BACK (sentinel thrown, not returned), it is 409 stale and no audit row is written", async () => {
    queueSame();
    state.updateResults.set(ledgerTransactions, []);
    const r = await run();
    expect(r).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(state.txEnd).toBe("rolled_back");
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(0);
  });
});

describe("executeFundMove: refusals (T16)", () => {
  const cases: Array<[string, () => void, number, string, Partial<Parameters<typeof executeFundMove>[0]>?]> = [
    ["approved", () => queueSame({ row: { ...ROW, approvedAt: new Date() } }), 403, "approved"],
    ["rejected", () => queueSame({ row: { ...ROW, status: "rejected" } }), 403, "rejected"],
    ["pending", () => queueSame({ row: { ...ROW, status: "pending" } }), 403, "pending"],
    ["transfer leg", () => queueSame({ row: { ...ROW, transferGroupId: "g1" } }), 403, "transfer_leg"],
    ["dues-synced", () => queueSame({ row: { ...ROW, duesPaymentId: "d1" } }), 403, "dues_synced"],
    ["row not found", () => queueSame({ row: null }), 404, "not_found"],
    [
      "same fund",
      () => queueSame({ dest: ADMIN_FUND }),
      409,
      "same_fund",
      { input: { ...INPUT, destFundId: ADMIN_FUND.id } },
    ],
    [
      "Club row to a Foundation fund is club_to_foundation_not_supported (no bank-account detour)",
      () =>
        queueSame({
          row: { ...ROW, bankAccountId: null },
          dest: FOUNDATION_FUND,
        }),
      403,
      "club_to_foundation_not_supported",
      { input: { ...INPUT, destFundId: FOUNDATION_FUND.id } },
    ],
    [
      "cross-entity on a row WITH a bank account is 403 with the policy reason, never 409 bank_account_entity_mismatch (B-next-F(2))",
      () => queueSame({ dest: FOUNDATION_FUND, bank: BANK }),
      403,
      "club_to_foundation_not_supported",
      { input: { ...INPUT, destFundId: FOUNDATION_FUND.id } },
    ],
    [
      "away from public (income activity to administrative)",
      () =>
        queueSame({
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
        queueSame({
          row: { ...ROW, flow: "expense", fundId: ACTIVITY_FUND.id },
          source: ACTIVITY_FUND,
          dest: ADMIN_FUND,
        }),
      403,
      "expense_not_supported",
      { input: { ...INPUT, destFundId: ADMIN_FUND.id, expectedFundId: ACTIVITY_FUND.id } },
    ],
    ["bank account in another entity", () => queueSame({ bank: { name: "X", entityId: "foundation" } }), 409, "bank_account_entity_mismatch"],
    ["bank account that no longer resolves", () => queueSame({ bank: null }), 409, "bank_account_entity_mismatch"],
    ["destination not found", () => queueSame({ dest: null }), 404, "fund_not_found"],
    [
      "destination fund inactive (C35)",
      () => queueSame({ dest: { ...ACTIVITY_FUND, isActive: false } }),
      404,
      "fund_not_found",
    ],
    ["category not found", () => queueSame({ category: null }), 404, "category_not_found"],
    ["category of the wrong kind", () => queueSame({ category: { ...ACTIVITY_CATEGORY, fundKind: "administrative" } }), 400, "category_invalid"],
    ["category of the wrong flow", () => queueSame({ category: { ...ACTIVITY_CATEGORY, flow: "expense" } }), 400, "category_invalid"],
    ["category of another entity", () => queueSame({ category: { ...ACTIVITY_CATEGORY, entityId: "foundation" } }), 400, "category_invalid"],
    ["inactive category", () => queueSame({ category: { ...ACTIVITY_CATEGORY, isActive: false } }), 400, "category_invalid"],
  ];

  it.each(cases)("%s", async (_name, setup, status, code, over) => {
    setup();
    const r = await run(over);
    expect(r).toMatchObject({ ok: false, status, code });
    expect(writes()).toHaveLength(0);
  });

  it("categoryId null succeeds (no category)", async () => {
    queueSame({ withCategory: false });
    const r = await run({ input: { ...INPUT, categoryId: null } });
    expect(r.ok).toBe(true);
    const update = calls().find((c) => c.op === "update")!;
    expect(update.set!.categoryId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C22-C23: the two UPDATE shapes
// ---------------------------------------------------------------------------

describe("the two UPDATE shapes (C22, C23)", () => {
  it("builders: same-entity never carries bankAccountId or entityId; cross-entity carries both", () => {
    const same = buildSameEntityMoveSet({ destFundId: "f", categoryId: null, now: NOW });
    expect(Object.keys(same).sort()).toEqual(["budgetLineId", "categoryId", "fundId", "updatedAt"]);
    const cross = buildCrossEntityMoveSet({
      destEntityId: "e",
      destFundId: "f",
      destBankAccountId: "b",
      categoryId: null,
      now: NOW,
    });
    expect(Object.keys(cross).sort()).toEqual([
      "bankAccountId",
      "budgetLineId",
      "categoryId",
      "entityId",
      "fundId",
      "updatedAt",
    ]);
  });

  it("a same-entity move's real UPDATE set has exactly the four keys", async () => {
    queueSame();
    await run();
    const update = calls().find((c) => c.op === "update")!;
    expect(Object.keys(update.set!).sort()).toEqual(["budgetLineId", "categoryId", "fundId", "updatedAt"]);
    expect(update.set).not.toHaveProperty("bankAccountId");
    expect(update.set).not.toHaveProperty("entityId");
  });

  it("a cross-entity move's UPDATE set has the six keys, entityId taken from the destination FUND row", async () => {
    // A destination fund whose entity differs from anything the client could name.
    const dest = { ...ACTIVITY_FUND, entityId: "club" };
    queueCross({ dest });
    await runCross();
    const txnUpdate = calls().find((c) => c.op === "update" && c.table === ledgerTransactions)!;
    expect(Object.keys(txnUpdate.set!).sort()).toEqual([
      "bankAccountId",
      "budgetLineId",
      "categoryId",
      "entityId",
      "fundId",
      "updatedAt",
    ]);
    expect(txnUpdate.set).toEqual({
      entityId: dest.entityId,
      fundId: dest.id,
      bankAccountId: DEST_ACCT_ID,
      categoryId: CATEGORY_ID,
      budgetLineId: null,
      updatedAt: NOW,
    });
  });

  it("C23: the cross-entity UPDATE where pins id, fund, entity, reconciled = false and no session", async () => {
    queueCross();
    await runCross();
    const txnUpdate = calls().find((c) => c.op === "update" && c.table === ledgerTransactions)!;
    const r = render(txnUpdate);
    expect(r.sql).toBe(
      '("ledger_transactions"."id" = $1 and "ledger_transactions"."fund_id" = $2 and "ledger_transactions"."entity_id" = $3 and "ledger_transactions"."reconciled" = $4 and "ledger_transactions"."reconciled_session_id" is null)',
    );
    expect(r.params).toEqual([ID, FOUNDATION_FUND.id, "foundation", false]);
  });
});

// ---------------------------------------------------------------------------
// C24: guard-order table
// ---------------------------------------------------------------------------

describe("guard order (C24): the earliest step's code wins and nothing is written", () => {
  const SESSION_ROW = { ...FROW, reconciled: true, reconciledSessionId: "s1", txnDate: "2026-07-20" };

  const table: Array<[string, () => void, Partial<Parameters<typeof executeFundMove>[0]>, number, string]> = [
    [
      "approved + manage-needed -> approved",
      () => queueCross({ row: { ...FROW, approvedAt: new Date() } }),
      { callerCanManage: false },
      403,
      "approved",
    ],
    [
      "stale + club_to_foundation_not_supported -> stale",
      () => queueSame({ row: { ...ROW, fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND, dest: FOUNDATION_FUND }),
      { input: { ...INPUT, destFundId: FOUNDATION_FUND.id, expectedFundId: ADMIN_FUND.id } },
      409,
      "stale",
    ],
    [
      "Club row to the Foundation + reconciled + record-only -> club_to_foundation_not_supported (never manage_required)",
      () => queueSame({ row: { ...ROW, reconciled: true, reconciledSessionId: "s1" }, dest: FOUNDATION_FUND }),
      { input: { ...INPUT, destFundId: FOUNDATION_FUND.id } },
      403,
      "club_to_foundation_not_supported",
    ],
    [
      "cross-entity + closed session + record-only -> reconciled_session (state before tier)",
      () => queueCross({ row: SESSION_ROW }),
      { callerCanManage: false },
      403,
      "reconciled_session",
    ],
    [
      "prior FY + closed session -> prior_fiscal_year_cross_entity (X2)",
      () => queueCross({ row: { ...SESSION_ROW, txnDate: "2025-12-01" } }),
      {},
      403,
      "prior_fiscal_year_cross_entity",
    ],
    [
      "legacy-reconciled -> reconciled_legacy",
      () => queueCross({ row: { ...FROW, reconciled: true } }),
      {},
      403,
      "reconciled_legacy",
    ],
    [
      "open-session match -> matched_open_session",
      () => queueCross({ match: { id: "m1", sessionId: "s1", bankLineId: "l1" } }),
      {},
      403,
      "matched_open_session",
    ],
    [
      "record-only + clean row -> manage_required before dest_bank_account_required",
      () => queueCross(),
      { callerCanManage: false, input: { ...CROSS_INPUT, destBankAccountId: null } },
      403,
      "manage_required",
    ],
    [
      "manage + no account -> dest_bank_account_required",
      () => queueCross(),
      { input: { ...CROSS_INPUT, destBankAccountId: null } },
      400,
      "dest_bank_account_required",
    ],
    [
      "an account of the wrong entity -> dest_bank_account_invalid",
      () => queueCross({ destAcct: { ...DEST_ACCT, entityId: "foundation" } }),
      {},
      400,
      "dest_bank_account_invalid",
    ],
    [
      "an inactive account -> dest_bank_account_invalid",
      () => queueCross({ destAcct: { ...DEST_ACCT, isActive: false } }),
      {},
      400,
      "dest_bank_account_invalid",
    ],
    [
      "an account that does not exist -> dest_bank_account_invalid",
      () => queueCross({ destAcct: null }),
      {},
      400,
      "dest_bank_account_invalid",
    ],
    [
      "a malformed account id -> dest_bank_account_invalid",
      () => queueCross(),
      { input: { ...CROSS_INPUT, destBankAccountId: "not-a-uuid" } },
      400,
      "dest_bank_account_invalid",
    ],
    [
      "same-entity + any account value -> dest_bank_account_not_allowed, even when the category is also invalid (input order)",
      () => queueSame({ category: { ...ACTIVITY_CATEGORY, fundKind: "administrative" } }),
      { input: { ...INPUT, destBankAccountId: DEST_ACCT_ID } },
      400,
      "dest_bank_account_not_allowed",
    ],
    [
      "same-entity + an empty-string account -> dest_bank_account_not_allowed",
      () => queueSame(),
      { input: { ...INPUT, destBankAccountId: "" } },
      400,
      "dest_bank_account_not_allowed",
    ],
    [
      "same-entity row whose stored account belongs to another entity -> bank_account_entity_mismatch",
      () => queueSame({ bank: { name: "X", entityId: "foundation" } }),
      { callerCanManage: false, input: INPUT },
      409,
      "bank_account_entity_mismatch",
    ],
    [
      "bad category after a good account -> category_invalid",
      () => queueCross({ category: { ...ACTIVITY_CATEGORY, fundKind: "administrative" } }),
      {},
      400,
      "category_invalid",
    ],
  ];

  it.each(table)("%s", async (_name, setup, over, status, code) => {
    setup();
    const r = await runCross(over);
    expect(r).toMatchObject({ ok: false, status, code });
    expect(writes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C25: each cross-entity refusal, zero writes
// ---------------------------------------------------------------------------

describe("cross-entity refusals write nothing (C25)", () => {
  const rows: Array<[string, Record<string, unknown>, Over, string]> = [
    ["prior fiscal year", { txnDate: "2025-12-01" }, {}, "prior_fiscal_year_cross_entity"],
    ["closed session", { reconciled: true, reconciledSessionId: "s1", txnDate: "2026-07-20" }, {}, "reconciled_session"],
    ["legacy reconciled", { reconciled: true }, {}, "reconciled_legacy"],
    ["matched in an open session", {}, { match: { id: "m", sessionId: "s", bankLineId: "l" } }, "matched_open_session"],
    ["expense row", { flow: "expense" }, {}, "cross_entity"],
    ["transfer leg", { transferGroupId: "g1" }, {}, "transfer_leg"],
    ["dues-synced", { duesPaymentId: "d1" }, {}, "dues_synced"],
    ["approved", { approvedAt: new Date() }, {}, "approved"],
    ["rejected", { status: "rejected" }, {}, "rejected"],
    ["pending", { status: "pending" }, {}, "pending"],
  ];
  it.each(rows)("%s is 403 %s with zero writes and no acknowledgment select", async (_n, rowOver, over, code) => {
    queueCross({ ...over, row: { ...FROW, ...rowOver } });
    const r = await runCross();
    expect(r).toMatchObject({ ok: false, status: 403, code });
    expect(writes()).toHaveLength(0);
    expect(selectsOn(ledgerAcknowledgments)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C26: the open-session match read
// ---------------------------------------------------------------------------

describe("the open-session match read (C26)", () => {
  it("is issued on tx, after the row lock", async () => {
    queueCross({ match: { id: "m", sessionId: "s", bankLineId: "l" } });
    await runCross();
    const all = calls();
    const lockIdx = all.findIndex((c) => c.forUpdate && c.table === ledgerTransactions);
    const matchIdx = all.findIndex((c) => c.op === "select" && c.table === ledgerReconciliationMatches);
    expect(lockIdx).toBe(0);
    expect(matchIdx).toBeGreaterThan(lockIdx);
    expect(all[matchIdx].via).toBe("tx");
    expect(selectsOn(ledgerReconciliationMatches).every((c) => c.via === "tx")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C27: per-destination tier (preview + execute)
// ---------------------------------------------------------------------------

/** Preview queue for a row, its source fund, and every other active fund. */
function queuePreview(fx: {
  row: Record<string, unknown>;
  source: unknown;
  funds: unknown[];
  bank?: unknown;
  destAccts?: unknown[];
  sourceBankRow?: unknown;
  rowCategory?: string;
  match?: unknown;
  receipt?: "none" | "unsent" | "sent";
  sentSource?: boolean;
  sentDest?: boolean;
  sessionRows?: unknown[][];
  matchRows?: unknown[][];
  txnRows?: unknown[][];
}) {
  q(ledgerTransactions, [fx.row], ...(fx.txnRows ?? []));
  q(ledgerFunds, [fx.source], fx.funds);
  q(ledgerEntities, [CLUB_ENTITY, FOUNDATION_ENTITY]);
  q(ledgerBankAccounts, [fx.bank ?? BANK]);
  if (fx.destAccts) q(ledgerBankAccounts, fx.destAccts, [fx.sourceBankRow ?? { name: "Foundation Checking", openingBalanceCents: 20000 }]);
  // The row's own category name is read first (when it has a category), then one list per allowed destination.
  if (fx.row.categoryId) q(ledgerCategories, [{ name: fx.rowCategory ?? "Donations" }]);
  q(ledgerCategories, [{ id: CATEGORY_ID, name: "Public donations" }, { id: "c-other", name: "Other" }]);
  q(ledgerAcknowledgments, fx.receipt === "sent" ? [{ sentAt: new Date("2026-09-20") }] : fx.receipt === "unsent" ? [{ sentAt: null }] : []);
  q(ledgerSettings, [{ holdingPeriodWarnDays: 365 }]);
  q(financialReportSends, fx.sentSource ? [{ id: "send-1" }] : [], fx.sentDest ? [{ id: "send-2" }] : []);
  if (fx.matchRows) q(ledgerReconciliationMatches, ...fx.matchRows);
  else if (fx.match) q(ledgerReconciliationMatches, [fx.match]);
  if (fx.sessionRows) q(ledgerReconciliationSessions, ...fx.sessionRows);
}

async function preview(canManage: boolean) {
  const r = await previewFundMove({ transactionId: ID, callerCanManage: canManage, now: NOW });
  if (!r.ok) throw new Error(`preview refused: ${r.code}`);
  return r.preview;
}
const destOf = (p: MovePreview, fund: { id: string }) => p.destinations.find((d) => d.fundId === fund.id)!;

describe("per-destination tier (C27)", () => {
  const FOUNDATION_FUNDS = [CLUB_ADMIN(), ACTIVITY_FUND];
  function CLUB_ADMIN() {
    return ADMIN_FUND;
  }

  it("a Foundation row for a record-only caller shows Club Activity as manage_required (200 in GET) and Club Administrative as away_from_public", async () => {
    queuePreview({ row: FROW, source: FOUNDATION_FUND, funds: FOUNDATION_FUNDS, bank: FOUNDATION_BANK });
    const p = await preview(false);
    expect(p.callerCanManage).toBe(false);
    const activity = destOf(p, ACTIVITY_FUND);
    expect(activity).toMatchObject({
      allowed: false,
      crossEntity: true,
      tier: { required: "manage", reasons: ["cross_entity"] },
      denial: { code: "manage_required", status: 403 },
    });
    expect(activity.denial!.reason).toBe(
      "Moving an entry to the other entity needs the Manage Ledger permission (held by the Admin role).",
    );
    expect(destOf(p, ADMIN_FUND)).toMatchObject({
      allowed: false,
      denial: { code: "away_from_public", status: 403, reason: "Public money cannot be moved into the Administrative Fund." },
    });
  });

  it("the same row for a record-only caller is 403 manage_required from POST", async () => {
    queueCross();
    const r = await runCross({ callerCanManage: false });
    expect(r).toMatchObject({ ok: false, status: 403, code: "manage_required" });
  });

  it("with manage the Activity destination is allowed, with bank options and the cross-entity tier", async () => {
    queuePreview({
      row: FROW,
      source: FOUNDATION_FUND,
      funds: FOUNDATION_FUNDS,
      bank: FOUNDATION_BANK,
      destAccts: [{ id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 10000 }],
    });
    const p = await preview(true);
    const activity = destOf(p, ACTIVITY_FUND);
    expect(activity).toMatchObject({
      allowed: true,
      crossEntity: true,
      entity: { slug: "club", name: "Club" },
      tier: { required: "manage", reasons: ["cross_entity"] },
    });
    expect(activity.denial).toBeUndefined();
  });

  it("a same-entity destination on a Club row is unaffected (record tier, no manage needed)", async () => {
    queuePreview({ row: ROW, source: ADMIN_FUND, funds: [ACTIVITY_FUND, SCHOLARSHIP_FUND] });
    const p = await preview(false);
    expect(destOf(p, ACTIVITY_FUND)).toMatchObject({
      allowed: true,
      crossEntity: false,
      tier: { required: "record", reasons: [] },
    });
  });

  it("a record-only caller on a reconciled SAME-entity row now gets a 200 with a per-destination manage_required (was a top-level 403)", async () => {
    queuePreview({
      row: { ...ROW, reconciled: true, reconciledSessionId: "s1" },
      source: ADMIN_FUND,
      funds: [ACTIVITY_FUND],
    });
    const p = await preview(false);
    expect(destOf(p, ACTIVITY_FUND)).toMatchObject({
      allowed: false,
      denial: { code: "manage_required", status: 403 },
      tier: { required: "manage", reasons: ["reconciled"] },
    });
  });
});

// ---------------------------------------------------------------------------
// C28: parity
// ---------------------------------------------------------------------------

describe("preview/execute parity (T17, C28)", () => {
  const stateRows: Array<[string, Record<string, unknown>, boolean]> = [
    ["approved", { approvedAt: new Date() }, false],
    ["rejected", { status: "rejected" }, false],
    ["pending", { status: "pending" }, false],
    ["transfer leg", { transferGroupId: "g1" }, false],
    ["dues-synced", { duesPaymentId: "d1" }, false],
    ["not found", {}, true],
  ];

  it.each(stateRows)("row-state refusal %s stays top-level and yields the identical status and code", async (_n, over, missing) => {
    q(ledgerTransactions, missing ? [] : [{ ...ROW, ...over }]);
    const previewResult = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    state.calls = [];
    state.queues = new Map();
    q(ledgerTransactions, missing ? [] : [{ ...ROW, ...over }]);
    const executed = await run();
    expect(previewResult.ok).toBe(false);
    expect(executed.ok).toBe(false);
    if (!previewResult.ok && !executed.ok) {
      expect({ status: previewResult.status, code: previewResult.code }).toEqual({
        status: executed.status,
        code: executed.code,
      });
    }
  });

  type Fx = {
    name: string;
    row: Record<string, unknown>;
    source: typeof ADMIN_FUND;
    funds: Array<typeof ADMIN_FUND>;
    bank: unknown;
    canManage: boolean;
    match?: unknown;
    noDestAccount?: boolean;
    sessionRows?: unknown[][];
  };
  const SESSION = {
    id: "s1",
    bankAccountId: "fb",
    bankAccountName: "Foundation Checking",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "closed",
  };
  const fixtures: Fx[] = [
    { name: "Club admin row, record-only", row: ROW, source: ADMIN_FUND, funds: [ACTIVITY_FUND, SCHOLARSHIP_FUND, FOUNDATION_FUND], bank: BANK, canManage: false },
    { name: "Club admin row, reconciled, record-only", row: { ...ROW, reconciled: true, reconciledSessionId: "s1" }, source: ADMIN_FUND, funds: [ACTIVITY_FUND, SCHOLARSHIP_FUND], bank: BANK, canManage: false },
    { name: "Club admin row, reconciled, manage", row: { ...ROW, reconciled: true, reconciledSessionId: "s1" }, source: ADMIN_FUND, funds: [ACTIVITY_FUND], bank: BANK, canManage: true },
    { name: "Club admin row, prior FY, record-only", row: { ...ROW, txnDate: "2025-12-01" }, source: ADMIN_FUND, funds: [ACTIVITY_FUND], bank: BANK, canManage: false },
    { name: "Club admin row with a foreign stored account", row: ROW, source: ADMIN_FUND, funds: [ACTIVITY_FUND], bank: { name: "X", entityId: "foundation" }, canManage: false },
    { name: "Club activity income row", row: { ...ROW, fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND, funds: [ADMIN_FUND, FOUNDATION_FUND], bank: BANK, canManage: true },
    { name: "Club activity expense row", row: { ...ROW, flow: "expense", fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND, funds: [ADMIN_FUND, FOUNDATION_FUND], bank: BANK, canManage: true },
    { name: "Foundation row, manage", row: FROW, source: FOUNDATION_FUND, funds: [ADMIN_FUND, ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true },
    { name: "Foundation row, record-only", row: FROW, source: FOUNDATION_FUND, funds: [ADMIN_FUND, ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: false },
    { name: "Foundation row, prior FY", row: { ...FROW, txnDate: "2025-12-01" }, source: FOUNDATION_FUND, funds: [ADMIN_FUND, ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true },
    { name: "Foundation row, closed session", row: { ...FROW, reconciled: true, reconciledSessionId: "s1", txnDate: "2026-07-20" }, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true, sessionRows: [[SESSION], []] },
    { name: "Foundation row, legacy reconciled", row: { ...FROW, reconciled: true }, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true },
    { name: "Foundation row, matched in an open session", row: FROW, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true, match: { id: "m1", sessionId: "s1", bankLineId: "l1" }, sessionRows: [[{ ...SESSION, status: "open" }]] },
    { name: "Foundation expense row", row: { ...FROW, flow: "expense" }, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND, ADMIN_FUND], bank: FOUNDATION_BANK, canManage: true },
    { name: "Foundation row, destination entity has no active account", row: FROW, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND], bank: FOUNDATION_BANK, canManage: true, noDestAccount: true },
  ];

  it.each(fixtures.map((f) => [f.name, f] as const))("%s: every destination's GET decision matches POST", async (_name, fx) => {
    const cross = fx.funds.some((f) => f.entityId !== fx.source.entityId);
    queuePreview({
      row: fx.row,
      source: fx.source,
      funds: fx.funds,
      bank: fx.bank,
      destAccts: cross ? (fx.noDestAccount ? [] : [{ id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 0 }]) : undefined,
      match: fx.match,
      matchRows: fx.match ? [[fx.match], [{ n: 0 }]] : undefined,
      sessionRows: fx.sessionRows,
    });
    const p = await preview(fx.canManage);
    expect(p.destinations).toHaveLength(fx.funds.length);

    for (const d of p.destinations) {
      state.calls = [];
      state.queues = new Map();
      const destFund = fx.funds.find((f) => f.id === d.fundId)!;
      const isCross = destFund.entityId !== fx.source.entityId;
      const over: Over = {
        row: fx.row,
        source: fx.source,
        dest: destFund,
        bank: fx.bank,
        withCategory: false,
        match: fx.match,
        destAcct: fx.noDestAccount ? null : undefined,
      };
      if (isCross) queueCross(over);
      else queueSame(over);
      const r = await run({
        callerCanManage: fx.canManage,
        input: {
          destFundId: d.fundId,
          categoryId: null,
          reason: "A reason that is long enough",
          expectedFundId: String(fx.row.fundId),
          destBankAccountId: isCross ? DEST_ACCT_ID : null,
        },
      });
      const label = `${fx.name} -> ${destFund.name}`;
      if (d.allowed) {
        expect(r.ok, label).toBe(true);
      } else if (d.denial!.code === "dest_no_active_bank_account") {
        // The only GET-only denial: POST sees an invalid account instead.
        expect(r, label).toMatchObject({ ok: false, status: 400, code: "dest_bank_account_invalid" });
      } else {
        expect(r, label).toMatchObject({ ok: false, status: d.denial!.status, code: d.denial!.code });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T18 / C29-C31: success paths
// ---------------------------------------------------------------------------

describe("executeFundMove: success path, same entity (T18, C31)", () => {
  it("updates fund, category, budget link and updatedAt; the audit insert is on the same tx after the update", async () => {
    queueSame({ sentRow: { id: "send-1" } });
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
        entitySlug: "club",
        crossEntity: false,
        acknowledgment: "none",
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

    // C31: v1 payload, and no acknowledgment select at all.
    expect(selectsOn(ledgerAcknowledgments)).toHaveLength(0);
    expect(state.txEnd).toBe("committed");
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

  it("an audit-insert rejection propagates and rolls the transaction back, so the move is never reported successful", async () => {
    queueSame();
    state.insertError = new Error("audit insert failed");
    await expect(run()).rejects.toThrow("audit insert failed");
    expect(state.txEnd).toBe("rolled_back");
  });
});

describe("executeFundMove: success path, cross entity (C29, C30)", () => {
  const SENT_AT = new Date("2026-09-20T12:00:00Z");

  it("none: writes the six-key UPDATE then the v2 audit row, all on tx, audit last", async () => {
    queueCross({ sentRow: { id: "send-1" } });
    const r = await runCross();
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
        entitySlug: "club",
        crossEntity: true,
        acknowledgment: "none",
      },
    });
    const w = writes();
    expect(w.map((c) => c.op)).toEqual(["update", "insert"]);
    expect(w.every((c) => c.via === "tx")).toBe(true);
    expect(w[1].table).toBe(ledgerAuditLog);
    expect(state.txEnd).toBe("committed");
  });

  it("the audit payload parses back to v2 with both entities, both accounts, donor, per-entity statement months and the acknowledgment (kept)", async () => {
    queueCross({
      sentRow: { id: "send-1" },
      ack: { id: "ack-1", sentAt: SENT_AT, doneeEntityId: null },
    });
    const r = await runCross();
    expect(r).toMatchObject({ ok: true, result: { acknowledgment: "kept", crossEntity: true } });

    // Write order: acknowledgment settlement, then the pinned UPDATE, then the audit row LAST.
    const w = writes();
    expect(w.map((c) => `${c.op}:${c.table === ledgerAcknowledgments ? "ack" : c.table === ledgerTransactions ? "txn" : "audit"}`)).toEqual([
      "update:ack",
      "update:txn",
      "insert:audit",
    ]);
    expect(w.every((c) => c.via === "tx")).toBe(true);

    const ackUpdate = w[0];
    expect(Object.keys(ackUpdate.set!).sort()).toEqual(["doneeEntityId", "updatedAt"]);

    const insert = w[2];
    const before = parseAuditBefore("transaction_fund_moved", insert.values!.before as string);
    const after = parseAuditAfter(insert.values!.after as string);
    const details = parseAuditDetails("transaction_fund_moved", insert.values!.details as string);
    expect(before).toEqual({
      v: 2,
      entity: { id: "foundation", name: "Foundation", slug: "foundation" },
      fund: { id: FOUNDATION_FUND.id, name: "Charitable Fund", slug: "charitable", kind: "charitable" },
      bankAccount: { id: FROW.bankAccountId, name: "Foundation Checking" },
      category: { id: FROW.categoryId, name: "Donations" },
      budgetLineId: FROW.budgetLineId,
    });
    expect(after).toEqual({
      v: 2,
      entity: { id: "club", name: "Club", slug: "club" },
      fund: { id: ACTIVITY_FUND.id, name: "Activity Fund", slug: "activity", kind: "activity" },
      bankAccount: { id: DEST_ACCT_ID, name: "Administrative Checking" },
      category: { id: CATEGORY_ID, name: "Public donations" },
      budgetLineId: null,
    });
    expect(details).toEqual({
      v: 2,
      reason: CROSS_INPUT.reason,
      entityId: "foundation",
      destEntityId: "club",
      crossEntity: true,
      txnDate: "2026-09-15",
      flow: "income",
      amountCents: 12500,
      fiscalYear: 2026,
      tier: "manage",
      reconciled: false,
      reconciledSessionId: null,
      priorFiscalYear: false,
      sentStatementMonth: "2026-09",
      destSentStatementMonth: null,
      donorId: "donor-1",
      acknowledgment: {
        id: "ack-1",
        sent: true,
        sentAt: SENT_AT.toISOString(),
        outcome: "kept",
        doneeEntityId: "foundation",
      },
    });
  });

  it("removed: an unsent acknowledgment is deleted before the UPDATE and reported in the audit and the response", async () => {
    queueCross({ ack: { id: "ack-2", sentAt: null, doneeEntityId: null } });
    const r = await runCross();
    expect(r).toMatchObject({ ok: true, result: { acknowledgment: "removed" } });
    const w = writes();
    expect(w.map((c) => c.op)).toEqual(["delete", "update", "insert"]);
    expect(w[0].table).toBe(ledgerAcknowledgments);
    const details = parseAuditDetails("transaction_fund_moved", w[2].values!.details as string);
    expect(details).toMatchObject({
      v: 2,
      acknowledgment: { id: "ack-2", sent: false, sentAt: null, outcome: "removed" },
    });
  });

  it("the acknowledgment select is a FOR UPDATE read, issued after the row lock", async () => {
    queueCross({ ack: { id: "ack-1", sentAt: SENT_AT, doneeEntityId: null } });
    await runCross();
    const ackSelect = selectsOn(ledgerAcknowledgments)[0];
    expect(ackSelect.forUpdate).toBe(true);
    expect(ackSelect.via).toBe("tx");
    expect(calls().indexOf(ackSelect)).toBeGreaterThan(0);
  });

  it("an audit-insert rejection propagates (and rolls back the settlement and the update with it)", async () => {
    queueCross({ ack: { id: "ack-1", sentAt: SENT_AT, doneeEntityId: null } });
    state.insertError = new Error("audit insert failed");
    await expect(runCross()).rejects.toThrow("audit insert failed");
    expect(state.txEnd).toBe("rolled_back");
  });

  it("C30: a lost race (zero-row pinned UPDATE) after a settled acknowledgment throws so the transaction rolls back, and is 409 stale", async () => {
    queueCross({ ack: { id: "ack-2", sentAt: null, doneeEntityId: null } });
    state.updateResults.set(ledgerTransactions, []);
    const r = await runCross();
    expect(r).toMatchObject({ ok: false, status: 409, code: "stale" });
    expect(state.txEnd).toBe("rolled_back");
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("C30: any other thrown error is rethrown (the route answers 500), not mapped to stale", async () => {
    queueCross();
    state.insertError = new Error("boom");
    await expect(runCross()).rejects.toThrow("boom");
  });

  it("C30: a cross-entity move never issues an acknowledgment write containing sent_at or sent_via", async () => {
    for (const ack of [
      { id: "a", sentAt: SENT_AT, doneeEntityId: null },
      { id: "b", sentAt: null, doneeEntityId: null },
    ]) {
      state.calls = [];
      state.queues = new Map();
      queueCross({ ack });
      await runCross();
      for (const c of calls().filter((x) => x.table === ledgerAcknowledgments && x.set)) {
        expect(Object.keys(c.set!)).not.toContain("sentAt");
        expect(Object.keys(c.set!)).not.toContain("sentVia");
      }
    }
  });

  it("the destination statement month is recorded when the destination fund is member-exposed", async () => {
    // Not reachable with the one allowed cell (Activity is not member-exposed): the lookup is a no-query null.
    queueCross();
    await runCross();
    expect(selectsOn(financialReportSends)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// C32-C35: preview details
// ---------------------------------------------------------------------------

describe("preview, cross-entity destination (C32)", () => {
  const FUNDS = [ADMIN_FUND, ACTIVITY_FUND];
  const base = {
    row: FROW,
    source: FOUNDATION_FUND,
    funds: FUNDS,
    bank: FOUNDATION_BANK,
  };

  it("lists only ACTIVE destination accounts (the select filters on is_active) with before/after book balances", async () => {
    queuePreview({
      ...base,
      destAccts: [
        { id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 10000 },
        { id: "98989898-9898-4898-8898-989898989898", name: "Petty Cash", openingBalanceCents: 2500 },
      ],
      // balance rows: row, then one set per account (in the order of the accounts), then fund rows ...
      txnRows: [[{ id: "t1", flow: "income", amountCents: 5000 }], [{ id: "t2", flow: "expense", amountCents: 500 }]],
    });
    const p = await preview(true);
    const accountsSelect = selectsOn(ledgerBankAccounts)[1];
    expect(render(accountsSelect).sql).toContain('"ledger_bank_accounts"."is_active" = $');
    expect(render(accountsSelect).params).toContain(true);
    const d = destOf(p, ACTIVITY_FUND);
    expect(d.bankAccounts).toEqual([
      { id: DEST_ACCT_ID, name: "Administrative Checking", beforeCents: 15000, afterCents: 27500 },
      { id: "98989898-9898-4898-8898-989898989898", name: "Petty Cash", beforeCents: 2000, afterCents: 14500 },
    ]);
    // Two accounts: no default (a wrong guess silently breaks the next reconciliation).
    expect(d.defaultBankAccountId).toBeNull();
  });

  it("defaultBankAccountId is set ONLY when exactly one active account exists", async () => {
    queuePreview({ ...base, destAccts: [{ id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 0 }] });
    const d = destOf(await preview(true), ACTIVITY_FUND);
    expect(d.defaultBankAccountId).toBe(DEST_ACCT_ID);
    expect(d.defaultCategoryId).toBe(CATEGORY_ID);
  });

  it("no active destination account is a GET-only dest_no_active_bank_account denial that names the entity", async () => {
    queuePreview({ ...base, destAccts: [] });
    const d = destOf(await preview(true), ACTIVITY_FUND);
    expect(d).toMatchObject({
      allowed: false,
      denial: { code: "dest_no_active_bank_account", reason: "The Club has no active bank account to receive this entry." },
    });
    expect(d.bankAccounts).toBeUndefined();
  });

  it("receipt state: none, unsent, sent, with the matching warnings", async () => {
    for (const receipt of ["none", "unsent", "sent"] as const) {
      state.queues = new Map();
      state.calls = [];
      queuePreview({ ...base, receipt, destAccts: [{ id: DEST_ACCT_ID, name: "A", openingBalanceCents: 0 }] });
      const p = await preview(true);
      expect(p.transaction.receipt).toBe(receipt);
      const codes = destOf(p, ACTIVITY_FUND).warnings!.map((w) => w.code);
      expect(codes.includes("receipt_sent")).toBe(receipt === "sent");
      expect(codes.includes("unsent_receipt_removed")).toBe(receipt === "unsent");
    }
  });

  it("the Foundation statement is warned and the Activity destination is not (it is not member-exposed, so no destination lookup)", async () => {
    queuePreview({ ...base, sentSource: true, destAccts: [{ id: DEST_ACCT_ID, name: "A", openingBalanceCents: 0 }] });
    const p = await preview(true);
    const w = destOf(p, ACTIVITY_FUND).warnings!;
    expect(w.map((x) => x.code)).toContain("sent_statement");
    expect(w.find((x) => x.code === "sent_statement")!.message).toContain("The Foundation statement for September 2026");
    expect(w.map((x) => x.code)).not.toContain("dest_sent_statement");
    // The only statement lookup is the source entity's.
    expect(selectsOn(financialReportSends)).toHaveLength(1);
  });

  it("impact covers both funds and both accounts", async () => {
    queuePreview({
      ...base,
      destAccts: [{ id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 0 }],
      sourceBankRow: { name: "Foundation Checking", openingBalanceCents: 20000 },
      // row, destination-account rows, source fund rows, dest fund rows, duplicates, source-account rows
      txnRows: [
        [],
        [{ id: ID, flow: "income", amountCents: 12500 }, { id: "t9", flow: "income", amountCents: 1000 }],
        [],
        [],
        [{ id: ID, flow: "income", amountCents: 12500 }],
      ],
    });
    const p = await preview(true);
    const impact = destOf(p, ACTIVITY_FUND).impact!;
    expect(impact.crossEntity).toBe(true);
    if (!impact.crossEntity) return;
    expect(impact.sourceFund).toEqual({ name: "Charitable Fund", beforeCents: 50000 + 12500 + 1000, afterCents: 50000 + 1000 });
    expect(impact.destFund).toEqual({ name: "Activity Fund", beforeCents: 0, afterCents: 12500 });
    expect(impact.sourceBankAccount).toEqual({ name: "Foundation Checking", beforeCents: 32500, afterCents: 20000 });
  });

  it("a Club (same-entity) destination keeps the old impact shape with 'unchanged' bank balance", async () => {
    queuePreview({ row: ROW, source: ADMIN_FUND, funds: [ACTIVITY_FUND], txnRows: [[{ id: ROW.id, flow: "income", amountCents: 12500 }], [{ id: "other", flow: "income", amountCents: 4000 }]] });
    const d = destOf(await preview(false), ACTIVITY_FUND);
    expect(d.impact).toEqual({
      crossEntity: false,
      sourceFund: { name: "Administrative Fund", beforeCents: 112500, afterCents: 100000 },
      destFund: { name: "Activity Fund", beforeCents: 4000, afterCents: 16500 },
      bankAccount: { name: "Administrative Checking", changeCents: 0 },
    });
    expect(d.bankAccounts).toBeUndefined();
    expect(d.duplicateCandidates).toBeUndefined();
  });
});

describe("duplicate candidates (C33)", () => {
  const FUNDS = [ADMIN_FUND, ACTIVITY_FUND];
  const ONE_ACCT = [{ id: DEST_ACCT_ID, name: "Administrative Checking", openingBalanceCents: 0 }];

  function dupRow(over: Record<string, unknown> = {}) {
    return {
      id: "d1",
      txnDate: "2026-09-10",
      party: "Example Donor",
      amountCents: 12500,
      reconciled: false,
      reconciledSessionId: null,
      fundName: "Activity Fund",
      bankAccountName: "Administrative Checking",
      matchId: null,
      ...over,
    };
  }
  // row, destination-account rows, source fund rows, dest fund rows, duplicates
  const txnRows = (dups: unknown[]) => [[], [], [], dups];

  it("maps rows to candidates with matched and reconciled flags", async () => {
    queuePreview({
      row: FROW,
      source: FOUNDATION_FUND,
      funds: FUNDS,
      bank: FOUNDATION_BANK,
      destAccts: ONE_ACCT,
      txnRows: txnRows([dupRow(), dupRow({ id: "d2", matchId: "m1" }), dupRow({ id: "d3", reconciled: true }), dupRow({ id: "d4", reconciledSessionId: "s1" })]),
    });
    const d = destOf(await preview(true), ACTIVITY_FUND);
    expect(d.duplicateCandidates).toEqual([
      { id: "d1", txnDate: "2026-09-10", party: "Example Donor", amountCents: 12500, fundName: "Activity Fund", bankAccountName: "Administrative Checking", matched: false, reconciled: false },
      { id: "d2", txnDate: "2026-09-10", party: "Example Donor", amountCents: 12500, fundName: "Activity Fund", bankAccountName: "Administrative Checking", matched: true, reconciled: false },
      { id: "d3", txnDate: "2026-09-10", party: "Example Donor", amountCents: 12500, fundName: "Activity Fund", bankAccountName: "Administrative Checking", matched: false, reconciled: true },
      { id: "d4", txnDate: "2026-09-10", party: "Example Donor", amountCents: 12500, fundName: "Activity Fund", bankAccountName: "Administrative Checking", matched: false, reconciled: true },
    ]);
    expect(d.warnings!.map((w) => w.code)).toContain("duplicate_candidate");
  });

  it("the query is the destination entity, income, posted, same amount, +/- 30 days, excluding the row and transfer legs, capped at 5", async () => {
    queuePreview({ row: FROW, source: FOUNDATION_FUND, funds: FUNDS, bank: FOUNDATION_BANK, destAccts: ONE_ACCT, txnRows: txnRows([]) });
    await preview(true);
    const dup = selectsOn(ledgerTransactions).find((c) => c.limit === 5)!;
    expect(dup).toBeDefined();
    const r = render(dup);
    expect(r.sql).toContain('"ledger_transactions"."entity_id" = $1');
    expect(r.sql).toContain('"ledger_transactions"."flow" = $2');
    expect(r.sql).toContain('"ledger_transactions"."status" = $3');
    expect(r.sql).toContain('"ledger_transactions"."amount_cents" = $4');
    expect(r.sql).toContain('"ledger_transactions"."txn_date" >= $5');
    expect(r.sql).toContain('"ledger_transactions"."txn_date" <= $6');
    expect(r.sql).toContain('"ledger_transactions"."id" <> $7');
    expect(r.sql).toContain('"ledger_transactions"."transfer_group_id" is null');
    expect(r.params).toEqual(["club", "income", "posted", 12500, "2026-08-16", "2026-10-15", ID]);
  });

  it("a different amount yields none, and a same-entity or denied destination never runs the query", async () => {
    queuePreview({ row: FROW, source: FOUNDATION_FUND, funds: FUNDS, bank: FOUNDATION_BANK, destAccts: ONE_ACCT, txnRows: txnRows([]) });
    const p = await preview(true);
    expect(destOf(p, ACTIVITY_FUND).duplicateCandidates).toEqual([]);
    expect(destOf(p, ADMIN_FUND).duplicateCandidates).toBeUndefined();
    expect(selectsOn(ledgerTransactions).filter((c) => c.limit === 5)).toHaveLength(1);
  });
});

describe("unlock (C34)", () => {
  const FUNDS = [ACTIVITY_FUND, ACTIVITY_FUND_2];
  const SESSION = {
    id: "s1",
    bankAccountId: "fb",
    bankAccountName: "Foundation Checking",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    status: "closed",
  };
  const LATER = [
    { id: "s3", statementPeriodStart: "2026-09-01", statementPeriodEnd: "2026-09-30" },
    { id: "s2", statementPeriodStart: "2026-08-01", statementPeriodEnd: "2026-08-31" },
    { id: "s0", statementPeriodStart: "2026-06-01", statementPeriodEnd: "2026-06-30" },
  ];
  const sessionRow = { ...FROW, reconciled: true, reconciledSessionId: "s1", txnDate: "2026-07-20" };

  it("a closed session names the session, account and period, lists later closed sessions newest first, and sets the statement fields", async () => {
    // sentSource feeds the preview's own source-entity lookup; sentDest feeds the unlock's lookup (the next send read).
    queuePreview({ row: sessionRow, source: FOUNDATION_FUND, funds: FUNDS, bank: FOUNDATION_BANK, sentSource: true, sentDest: true, sessionRows: [[SESSION], LATER] });
    const p = await preview(true);
    const d = destOf(p, ACTIVITY_FUND);
    expect(d.denial).toMatchObject({ code: "reconciled_session", status: 403 });
    expect(d.denial!.unlock).toEqual({
      kind: "closed_session",
      session: { id: "s1", bankAccountName: "Foundation Checking", periodStart: "2026-07-01", periodEnd: "2026-07-31", status: "closed" },
      laterClosedSessions: [
        { id: "s3", periodStart: "2026-09-01", periodEnd: "2026-09-30" },
        { id: "s2", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
      ],
      otherMatchesOnLine: 0,
      statementMonth: "2026-07",
      statementAlreadySent: true,
    });
  });

  it("is computed ONCE per request even when two destinations share the denial", async () => {
    queuePreview({ row: sessionRow, source: FOUNDATION_FUND, funds: FUNDS, bank: FOUNDATION_BANK, sessionRows: [[SESSION], LATER] });
    const p = await preview(true);
    expect(destOf(p, ACTIVITY_FUND).denial!.unlock).toBeDefined();
    expect(destOf(p, ACTIVITY_FUND_2).denial!.unlock).toEqual(destOf(p, ACTIVITY_FUND).denial!.unlock);
    // One session lookup + one later-sessions lookup, not two of each.
    expect(selectsOn(ledgerReconciliationSessions)).toHaveLength(2);
  });

  it("an open-session match names its session and counts the other entries on the line; no statement fields", async () => {
    queuePreview({
      row: FROW,
      source: FOUNDATION_FUND,
      funds: [ACTIVITY_FUND],
      bank: FOUNDATION_BANK,
      matchRows: [[{ id: "m1", sessionId: "s1", bankLineId: "l1" }], [{ n: 2 }]],
      sessionRows: [[{ ...SESSION, status: "open" }]],
    });
    const d = destOf(await preview(true), ACTIVITY_FUND);
    expect(d.denial).toMatchObject({ code: "matched_open_session" });
    expect(d.denial!.unlock).toEqual({
      kind: "matched_open_session",
      session: { id: "s1", bankAccountName: "Foundation Checking", periodStart: "2026-07-01", periodEnd: "2026-07-31", status: "open" },
      laterClosedSessions: [],
      otherMatchesOnLine: 2,
      statementMonth: null,
      statementAlreadySent: false,
    });
  });

  it("a legacy-reconciled row has no session", async () => {
    queuePreview({ row: { ...FROW, reconciled: true }, source: FOUNDATION_FUND, funds: [ACTIVITY_FUND], bank: FOUNDATION_BANK });
    const d = destOf(await preview(true), ACTIVITY_FUND);
    expect(d.denial).toMatchObject({ code: "reconciled_legacy" });
    expect(d.denial!.unlock).toMatchObject({ kind: "legacy_reconciled", session: null, laterClosedSessions: [] });
  });

  it("a policy-denied destination and a prior-year denial never carry unlock", async () => {
    queuePreview({ row: { ...sessionRow, txnDate: "2025-12-01" }, source: FOUNDATION_FUND, funds: [ADMIN_FUND, ACTIVITY_FUND], bank: FOUNDATION_BANK });
    const p = await preview(true);
    expect(destOf(p, ADMIN_FUND).denial).toMatchObject({ code: "away_from_public" });
    expect(destOf(p, ADMIN_FUND).denial!.unlock).toBeUndefined();
    expect(destOf(p, ACTIVITY_FUND).denial).toMatchObject({ code: "prior_fiscal_year_cross_entity" });
    expect(destOf(p, ACTIVITY_FUND).denial!.unlock).toBeUndefined();
    expect(selectsOn(ledgerReconciliationSessions)).toHaveLength(0);
  });
});

describe("destination fund filtering (C35)", () => {
  it("the preview lists only ACTIVE funds (the where renders is_active = true)", async () => {
    queuePreview({ row: ROW, source: ADMIN_FUND, funds: [ACTIVITY_FUND] });
    await preview(false);
    const fundList = selectsOn(ledgerFunds).find((c) => c.where && render(c).sql.includes("is_active"))!;
    expect(fundList).toBeDefined();
    expect(render(fundList).params).toEqual([true]);
  });

  it("the preview orders the row's own entity first", async () => {
    queuePreview({ row: ROW, source: ADMIN_FUND, funds: [FOUNDATION_FUND, ACTIVITY_FUND, SCHOLARSHIP_FUND] });
    const p = await preview(false);
    expect(p.destinations.map((d) => d.fundId)).toEqual([ACTIVITY_FUND.id, SCHOLARSHIP_FUND.id, FOUNDATION_FUND.id]);
    expect(destOf(p, FOUNDATION_FUND).denial).toMatchObject({ code: "club_to_foundation_not_supported" });
  });
});

// ---------------------------------------------------------------------------
// T19: sent-statement lookup and same-entity warnings
// ---------------------------------------------------------------------------

describe("findSentStatementMonth and warnings (T19)", () => {
  it("returns YYYY-MM for a successful send in a member-exposed fund, issuing only a select on financialReportSends", async () => {
    q(financialReportSends, [{ id: "send-1" }]);
    const month = await findSentStatementMonth(dbHandle as never, {
      entityId: "club",
      txnDate: "2026-09-15",
      fundKind: "administrative",
    });
    expect(month).toBe("2026-09");
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ op: "select", table: financialReportSends });
    expect(writes()).toHaveLength(0);
    const r = render(calls()[0]);
    expect(r.params).toEqual(["club", "2026-09-30", true]);
  });

  it("is null for an Activity source fund without querying, and null when no successful row exists", async () => {
    expect(
      await findSentStatementMonth(dbHandle as never, { entityId: "club", txnDate: "2026-09-15", fundKind: "activity" }),
    ).toBeNull();
    expect(calls()).toHaveLength(0);

    q(financialReportSends, []);
    expect(
      await findSentStatementMonth(dbHandle as never, { entityId: "club", txnDate: "2026-09-15", fundKind: "administrative" }),
    ).toBeNull();
  });

  it("a plain current-year move carries ratchet and sweep_not_automatic on its destination, the category default, and the impact", async () => {
    queuePreview({
      row: ROW,
      source: ADMIN_FUND,
      funds: [ACTIVITY_FUND],
      rowCategory: "Donations",
      txnRows: [[{ id: ROW.id, flow: "income", amountCents: 12500 }], [{ id: "other", flow: "income", amountCents: 4000 }]],
    });
    const r = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dest = r.preview.destinations[0];
    expect(dest.warnings!.map((w) => w.code)).toEqual(["ratchet", "sweep_not_automatic"]);
    expect(dest.tier).toEqual({ required: "record", reasons: [] });
    expect(dest).toMatchObject({ fundId: ACTIVITY_FUND.id, allowed: true, defaultCategoryId: CATEGORY_ID });
    expect(r.preview.transaction).toMatchObject({
      entity: { id: "club", slug: "club", name: "Club" },
      donorId: null,
      receipt: "none",
      categoryName: "Donations",
    });
    expect(r.preview.reasonLimits).toEqual({ min: 10, max: 500 });
    expect(writes()).toHaveLength(0);
  });

  it("a reconciled prior-year row with a sent statement and an aged date carries every same-entity warning", async () => {
    const old = { ...ROW, txnDate: "2024-03-10", reconciled: true, reconciledSessionId: "s1" };
    queuePreview({ row: old, source: ADMIN_FUND, funds: [ACTIVITY_FUND], sentSource: true });
    const r = await previewFundMove({ transactionId: ID, callerCanManage: true, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dest = r.preview.destinations[0];
    expect(dest.warnings!.map((w) => w.code)).toEqual([
      "ratchet",
      "reconciled",
      "prior_fiscal_year",
      "sent_statement",
      "aged_public_fund",
      "sweep_not_automatic",
    ]);
    expect(dest.warnings!.find((w) => w.code === "sent_statement")!.message).toContain("March 2024");
    expect(dest.tier.reasons).toEqual(["reconciled", "prior_fiscal_year"]);
  });

  it("when nothing is allowed there are no warnings on any destination", async () => {
    queuePreview({ row: { ...ROW, flow: "expense", fundId: ACTIVITY_FUND.id }, source: ACTIVITY_FUND, funds: [ADMIN_FUND] });
    const r = await previewFundMove({ transactionId: ID, callerCanManage: false, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.destinations).toEqual([
      expect.objectContaining({
        fundId: ADMIN_FUND.id,
        allowed: false,
        denial: expect.objectContaining({ code: "expense_not_supported" }),
      }),
    ]);
    expect(r.preview.destinations[0].warnings).toBeUndefined();
  });
});

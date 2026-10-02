/**
 * T13-T20: query-layer tests for repairing / correcting a paid reimbursement's
 * ledger row (B-108 / DECISION-114). `@/lib/db` is mocked with a recording
 * handle: every select/update/insert is captured in call order, `db.update` and
 * `db.insert` THROW so any write that escaped the transaction handle fails
 * loudly, and the transaction records whether the callback returned
 * ("committed") or threw ("rolled_back").
 *
 * Select results are queued PER TABLE (the table passed to `.from()`), in call
 * order within that table; an empty queue returns []. A mocked db cannot prove
 * lock semantics or commit-on-return behavior (those are live-database checks
 * in the work-log); it does prove the FOR UPDATE is the first statement and the
 * audit insert the last.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

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
    queues: new Map<unknown, unknown[][]>(),
    updateResults: new Map<unknown, unknown[]>(),
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
                const result = state.updateResults.get(table) ?? [{ id: "x" }];
                return { returning: () => Promise.resolve(result) };
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

vi.mock("@/lib/ledger-queries", () => ({
  getBudgetLineForLinkValidation: vi.fn(),
  getBudgetLineOptions: vi.fn(async () => []),
}));

import {
  financialReportSends,
  ledgerAuditLog,
  ledgerBankAccounts,
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerReconciliationMatches,
  ledgerReimbursements,
  ledgerTransactions,
} from "@/lib/db/schema";
import { getBudgetLineForLinkValidation } from "@/lib/ledger-queries";
import {
  buildCorrectSet,
  buildFillSet,
  correctWhere,
  executeCorrection,
  fillWhere,
  previewCorrection,
} from "./ledger-reimbursement-correction-queries";
import {
  CORRECTION_ERROR_STATUS,
  type CorrectionBodyInput,
  type CorrectionErrorCode,
} from "./ledger-reimbursement-correction";
import {
  FILL_BANK_ACCOUNT_REASON,
} from "./ledger-reimbursement-correction";
import {
  parseAuditAfter,
  parseAuditBefore,
  parseAuditDetails,
  TRANSACTION_CORRECTED_AUDIT_ACTION,
} from "./ledger-correction";

const calls = () => state.calls as Call[];
const writes = () => calls().filter((c) => c.op === "update" || c.op === "insert");

function q(table: unknown, ...results: unknown[][]) {
  state.queues.set(table, [...(state.queues.get(table) ?? []), ...results]);
}
function qAll(table: unknown, rows: unknown[], n = 8) {
  q(table, ...Array.from({ length: n }, () => rows));
}

const NOW = new Date(2026, 9, 2); // 2026-10-02, FY2026
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAT1 = "11111111-1111-4111-8111-111111111111";
const CAT2 = "22222222-2222-4222-8222-222222222222";
const BANK1 = "33333333-3333-4333-8333-333333333333";
const BANK2 = "44444444-4444-4444-8444-444444444444";
const FUND_ID = "55555555-5555-4555-8555-555555555555";
const BL1 = "66666666-6666-4666-8666-666666666666";
const UPDATED = new Date("2026-10-01T12:00:00.123Z");

const FUND = {
  id: FUND_ID,
  name: "Administrative Fund",
  kind: "administrative",
  entityId: "club",
};
const ENTITY = { id: "club", slug: "club", name: "Westerville Lions Club", shortName: "Club" };

const ROW = {
  id: ID,
  entityId: "club",
  fundId: FUND_ID,
  bankAccountId: null as string | null,
  txnDate: "2026-09-30",
  flow: "expense",
  categoryId: CAT1 as string | null,
  amountCents: 4500,
  party: "Pat Member",
  memo: "Supplies" as string | null,
  paymentMethod: "check" as string | null,
  checkNumber: null as string | null,
  status: "posted",
  approvedAt: new Date("2026-10-01T09:00:00Z"),
  approvedByUserId: "u-pay",
  boardMinute: null,
  duesPaymentId: null,
  transferGroupId: null,
  reconciled: false,
  reconciledSessionId: null as string | null,
  budgetLineId: null as string | null,
  updatedAt: UPDATED,
};
const LINKED = [{ id: "r-1", submittedByUserId: "u-sub", submittedByMemberId: "m-sub" }];
const ACTOR: { userId: string; memberId?: string | null } = { userId: "u-pay", memberId: "m-pay" };

const CATEGORY2 = {
  id: CAT2,
  entityId: "club",
  fundKind: "administrative",
  flow: "expense",
  isActive: true,
  name: "Postage",
};
const BANK1_ROW = { id: BANK1, entityId: "club", isActive: true, name: "Administrative Checking" };

/** Queue the three reads every POST makes after the lock. */
function seed(over: { row?: Record<string, unknown>; linked?: unknown[] } = {}) {
  q(ledgerTransactions, [{ ...ROW, ...over.row }]);
  q(ledgerFunds, [FUND]);
  q(ledgerReimbursements, over.linked ?? LINKED);
}

const fillInput = (over: Partial<Extract<CorrectionBodyInput, { operation: "fill_bank_account" }>> = {}): CorrectionBodyInput => ({
  operation: "fill_bank_account",
  bankAccountId: BANK1,
  checkNumber: null,
  expectedUpdatedAt: UPDATED.toISOString(),
  ...over,
});
const correctInput = (
  changes: Extract<CorrectionBodyInput, { operation: "correct" }>["changes"],
  over: { expectedUpdatedAt?: string; reason?: string } = {},
): CorrectionBodyInput => ({
  operation: "correct",
  reason: over.reason ?? "Picked the wrong category at pay time",
  expectedUpdatedAt: over.expectedUpdatedAt ?? UPDATED.toISOString(),
  changes,
});

async function post(input: CorrectionBodyInput, opts: { manage?: boolean; actor?: typeof ACTOR } = {}) {
  return executeCorrection({
    transactionId: ID,
    actor: opts.actor ?? ACTOR,
    callerCanManage: opts.manage ?? false,
    input,
    now: NOW,
  });
}
function expectFail(r: Awaited<ReturnType<typeof post>>, code: CorrectionErrorCode) {
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.code).toBe(code);
  expect(r.status).toBe(CORRECTION_ERROR_STATUS[code]);
}

beforeEach(() => {
  state.calls = [];
  state.queues = new Map();
  state.updateResults = new Map();
  state.insertError = null;
  state.txEnd = null;
  vi.mocked(getBudgetLineForLinkValidation).mockReset();
});

// ---------------------------------------------------------------------------
// T13: guard order
// ---------------------------------------------------------------------------

describe("guard order (T13)", () => {
  it("not_found when the row is missing; nothing else is read", async () => {
    q(ledgerTransactions, []);
    expectFail(await post(fillInput()), "not_found");
    expect(writes()).toHaveLength(0);
  });

  it("not_correctable for a row with no linked paid reimbursement, and beats own_request", async () => {
    seed({ linked: [] });
    expectFail(await post(fillInput()), "not_correctable");
    state.calls = [];
    seed({ row: { approvedAt: null } });
    expectFail(await post(fillInput()), "not_correctable");
    state.calls = [];
    seed({ row: { flow: "income" } });
    expectFail(await post(fillInput()), "not_correctable");
    expect(writes()).toHaveLength(0);
  });

  it.each([
    ["user id", { userId: "u-sub", memberId: "m-other" }],
    ["member id", { userId: "u-other", memberId: "m-sub" }],
  ])("own_request by %s, for both operations", async (_n, actor) => {
    for (const input of [fillInput(), correctInput({ memo: "x" })]) {
      state.calls = [];
      seed();
      expectFail(await post(input, { actor }), "own_request");
      expect(writes()).toHaveLength(0);
    }
  });

  it("own_request also fires for the SECOND of two linked reimbursements", async () => {
    seed({
      linked: [
        { id: "r-1", submittedByUserId: "u-a", submittedByMemberId: "m-a" },
        { id: "r-2", submittedByUserId: "u-pay", submittedByMemberId: null },
      ],
    });
    expectFail(await post(fillInput()), "own_request");
  });

  it("own_request beats stale, and stale beats state", async () => {
    seed({ row: { reconciledSessionId: "s-1", reconciled: true } });
    expectFail(
      await post(fillInput({ expectedUpdatedAt: "2026-10-01T00:00:00.000Z" }), {
        actor: { userId: "u-sub", memberId: null },
      }),
      "own_request",
    );
    state.calls = [];
    seed({ row: { reconciledSessionId: "s-1", reconciled: true } });
    expectFail(await post(fillInput({ expectedUpdatedAt: "2026-10-01T00:00:00.000Z" })), "stale");
  });

  it("fill: already_has_bank_account, then check_number_present, then the state codes in order", async () => {
    seed({ row: { bankAccountId: BANK2, reconciledSessionId: "s", reconciled: true } });
    expectFail(await post(fillInput({ checkNumber: "1" })), "already_has_bank_account");

    state.calls = [];
    seed({ row: { checkNumber: "9", reconciledSessionId: "s", reconciled: true } });
    expectFail(await post(fillInput({ checkNumber: "1" })), "check_number_present");

    state.calls = [];
    seed({ row: { reconciledSessionId: "s", reconciled: true } });
    qAll(ledgerReconciliationMatches, [{ id: "m", sessionId: "s", bankLineId: "b" }]);
    expectFail(await post(fillInput()), "reconciled_session");

    state.calls = [];
    seed({ row: { reconciled: true } });
    qAll(ledgerReconciliationMatches, [{ id: "m", sessionId: "s", bankLineId: "b" }]);
    expectFail(await post(fillInput()), "reconciled_legacy");

    state.calls = [];
    seed();
    qAll(ledgerReconciliationMatches, [{ id: "m", sessionId: "s", bankLineId: "b" }]);
    expectFail(await post(fillInput()), "matched_open_session");
    expect(writes()).toHaveLength(0);
  });

  it("fill: the same check number already stored is not a conflict", async () => {
    seed({ row: { checkNumber: "8249" } });
    q(ledgerBankAccounts, [BANK1_ROW]);
    const r = await post(fillInput({ checkNumber: "8249" }));
    expect(r.ok).toBe(true);
    // and it is not rewritten
    const update = calls().find((c) => c.op === "update")!;
    expect("checkNumber" in (update.set as object)).toBe(false);
  });

  it("fill: an inactive or foreign account is bank_account_invalid, after the state checks", async () => {
    seed();
    q(ledgerBankAccounts, [{ ...BANK1_ROW, entityId: "foundation" }]);
    expectFail(await post(fillInput()), "bank_account_invalid");
    state.calls = [];
    seed();
    q(ledgerBankAccounts, [{ ...BANK1_ROW, isActive: false }]);
    expectFail(await post(fillInput()), "bank_account_invalid");
    expect(writes()).toHaveLength(0);
  });

  it("correct: state is read only when the date or bank account changes; a category-only change on a reconciled row passes state", async () => {
    // category-only on a reconciled row with Manage: no state refusal, proceeds
    seed({ row: { reconciled: true, reconciledSessionId: "s" } });
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    const ok = await post(correctInput({ categoryId: CAT2 }), { manage: true });
    expect(ok.ok).toBe(true);

    state.calls = [];
    seed({ row: { reconciledSessionId: "s", reconciled: true } });
    expectFail(await post(correctInput({ txnDate: "2026-09-12" }), { manage: true }), "reconciled_session");
    state.calls = [];
    seed({ row: { reconciled: true } });
    expectFail(await post(correctInput({ bankAccountId: BANK2 }), { manage: true }), "reconciled_legacy");
    state.calls = [];
    seed();
    q(ledgerReconciliationMatches, [{ id: "m", sessionId: "s", bankLineId: "b" }]);
    expectFail(await post(correctInput({ txnDate: "2026-09-12" })), "matched_open_session");
  });

  it("correct: no_change beats manage_required; state beats tier; tier beats semantic input; semantic beats would_hide", async () => {
    // no_change beats manage_required
    seed({ row: { reconciled: true, reconciledSessionId: "s" } });
    expectFail(await post(correctInput({ memo: "Supplies", categoryId: CAT1 }), { manage: false }), "no_change");

    // state beats tier (no manage, but the state refusal comes first)
    state.calls = [];
    seed({ row: { reconciled: true, reconciledSessionId: "s" } });
    expectFail(await post(correctInput({ txnDate: "2026-09-12" }), { manage: false }), "reconciled_session");

    // tier beats semantic input: manage required AND an invalid category -> manage_required
    state.calls = [];
    seed({ row: { reconciled: true, reconciledSessionId: "s" } });
    q(ledgerCategories, [{ ...CATEGORY2, entityId: "foundation" }]);
    expectFail(await post(correctInput({ categoryId: CAT2 }), { manage: false }), "manage_required");

    // semantic input beats would_hide_statement: invalid bank account + a hiding method change
    state.calls = [];
    seed();
    q(ledgerBankAccounts, [{ ...BANK1_ROW, isActive: false }]);
    expectFail(
      await post(correctInput({ bankAccountId: BANK1, paymentMethod: "cash" })),
      "bank_account_invalid",
    );
    expect(writes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T14: atomic fill (race)
// ---------------------------------------------------------------------------

describe("atomic fill (T14)", () => {
  it("the pinned UPDATE WHERE re-pins every state fact", () => {
    const q1 = new PgDialect().sqlToQuery(fillWhere(ID));
    expect(q1.sql).toMatch(/"ledger_transactions"\."bank_account_id" is null/);
    expect(q1.sql).toMatch(/"ledger_transactions"\."status" = \$/);
    expect(q1.params).toContain("posted");
    expect(q1.sql).toMatch(/"ledger_transactions"\."reconciled" = \$/);
    expect(q1.params).toContain(false);
    expect(q1.sql).toMatch(/"ledger_transactions"\."reconciled_session_id" is null/);
    expect(q1.sql).toMatch(/"ledger_transactions"\."approved_at" IS NOT NULL/);
    expect(q1.sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "ledger_reconciliation_matches"/);
    expect(q1.params).toContain(ID);
  });

  it("zero rows rolls back, returns 409 already_has_bank_account and writes NO audit row", async () => {
    seed();
    q(ledgerBankAccounts, [BANK1_ROW]);
    state.updateResults.set(ledgerTransactions, []);
    expectFail(await post(fillInput()), "already_has_bank_account");
    expect(state.txEnd).toBe("rolled_back");
    expect(calls().filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("a match inserted between the page load and the write is refused by the post-lock read", async () => {
    seed();
    q(ledgerReconciliationMatches, [{ id: "m", sessionId: "s", bankLineId: "b" }]);
    expectFail(await post(fillInput()), "matched_open_session");
    expect(writes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T15: SET key-set pins
// ---------------------------------------------------------------------------

describe("SET key-set pins (T15)", () => {
  const FORBIDDEN = [
    "approvedAt",
    "approvedByUserId",
    "boardMinute",
    "amountCents",
    "flow",
    "fundId",
    "entityId",
    "status",
    "party",
    "reconciled",
    "reconciledSessionId",
    "receiptStorageKey",
    "donorId",
  ];

  it("buildFillSet: the account, optionally the check number, and updatedAt", () => {
    expect(Object.keys(buildFillSet({ bankAccountId: BANK1, checkNumber: null, now: NOW }))).toEqual(["bankAccountId", "updatedAt"]);
    expect(Object.keys(buildFillSet({ bankAccountId: BANK1, checkNumber: undefined, now: NOW }))).toEqual(["bankAccountId", "updatedAt"]);
    expect(Object.keys(buildFillSet({ bankAccountId: BANK1, checkNumber: "8249", now: NOW }))).toEqual(["bankAccountId", "checkNumber", "updatedAt"]);
  });

  it("buildCorrectSet: only the changed columns plus updatedAt, for every shape", () => {
    const shapes = [
      {},
      { categoryId: CAT2 },
      { budgetLineId: null },
      { txnDate: "2026-09-12" },
      { paymentMethod: "cash" as const },
      { checkNumber: null },
      { memo: "x" },
      { bankAccountId: BANK2 },
      {
        categoryId: CAT2,
        budgetLineId: BL1,
        txnDate: "2026-09-12",
        paymentMethod: "other" as const,
        checkNumber: "1",
        memo: "m",
        bankAccountId: BANK2,
      },
    ];
    for (const s of shapes) {
      const set = buildCorrectSet(s, NOW);
      expect(Object.keys(set).sort()).toEqual([...Object.keys(s), "updatedAt"].sort());
      expect(set.updatedAt).toBe(NOW);
    }
  });

  it("neither set can contain a forbidden key, even when handed one", () => {
    const smuggled = { memo: "x", approvedAt: new Date(), amountCents: 1, fundId: "f", status: "x" } as never;
    const set = buildCorrectSet(smuggled, NOW);
    for (const k of FORBIDDEN) {
      expect(k in set, `correct set has ${k}`).toBe(false);
      expect(k in buildFillSet({ bankAccountId: BANK1, checkNumber: "1", now: NOW }), `fill set has ${k}`).toBe(false);
    }
  });

  it("the written UPDATE never carries the approval stamp (executed, not just built)", async () => {
    seed();
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    await post(correctInput({ categoryId: CAT2, memo: "m" }));
    const update = calls().find((c) => c.op === "update")!;
    for (const k of FORBIDDEN) expect(k in (update.set as object)).toBe(false);
    expect(update.set!.updatedAt).toBe(NOW);
  });

  it("the reconciled predicate is in the WHERE only when the date or bank account changes", () => {
    const plain = new PgDialect().sqlToQuery(correctWhere(ID, false));
    expect(plain.sql).not.toMatch(/"reconciled"/);
    expect(plain.sql).toMatch(/"approved_at" IS NOT NULL/);
    const pinned = new PgDialect().sqlToQuery(correctWhere(ID, true));
    expect(pinned.sql).toMatch(/"reconciled" = \$/);
    expect(pinned.sql).toMatch(/"reconciled_session_id" is null/);
  });
});

// ---------------------------------------------------------------------------
// T16: lock first, audit last, same tx
// ---------------------------------------------------------------------------

describe("transaction shape (T16)", () => {
  it("the row FOR UPDATE is the first statement and the audit insert is the last, both on tx", async () => {
    seed();
    q(ledgerBankAccounts, [BANK1_ROW]);
    const r = await post(fillInput());
    expect(r.ok).toBe(true);
    const all = calls();
    expect(all[0]).toMatchObject({ op: "select", table: ledgerTransactions, forUpdate: true, via: "tx" });
    const last = all[all.length - 1];
    expect(last).toMatchObject({ op: "insert", table: ledgerAuditLog, via: "tx" });
    // every statement ran on the transaction handle
    expect(all.every((c) => c.via === "tx")).toBe(true);
    // the pinned UPDATE precedes the audit row
    expect(all.findIndex((c) => c.op === "update")).toBeLessThan(all.length - 1);
    expect(state.txEnd).toBe("committed");
  });

  it("an audit-insert failure rolls the transaction back and surfaces as an error, never ok", async () => {
    seed();
    q(ledgerBankAccounts, [BANK1_ROW]);
    state.insertError = new Error("audit down");
    await expect(post(fillInput())).rejects.toThrow("audit down");
    expect(state.txEnd).toBe("rolled_back");
  });

  it("a refusal returns before any write", async () => {
    seed({ row: { bankAccountId: BANK2 } });
    expectFail(await post(fillInput()), "already_has_bank_account");
    expect(writes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T17: audit payload
// ---------------------------------------------------------------------------

describe("audit payload (T17)", () => {
  function auditValues() {
    return calls().find((c) => c.op === "insert" && c.table === ledgerAuditLog)!.values!;
  }

  it("fill: before.bankAccount null, after {id,name}, the fixed reason, record tier even for a prior-year row", async () => {
    seed({ row: { txnDate: "2026-03-01" } }); // FY2025: prior fiscal year
    q(ledgerBankAccounts, [BANK1_ROW]);
    const r = await post(fillInput({ checkNumber: "8249" }), { manage: false });
    expect(r.ok).toBe(true);
    const v = auditValues();
    expect(v.action).toBe(TRANSACTION_CORRECTED_AUDIT_ACTION);
    expect(v.targetTransactionId).toBe(ID);
    expect(v.actorUserId).toBe("u-pay");
    const details = parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, v.details as string);
    const before = parseAuditBefore(TRANSACTION_CORRECTED_AUDIT_ACTION, v.before as string);
    const after = parseAuditAfter(TRANSACTION_CORRECTED_AUDIT_ACTION, v.after as string);
    expect(details).toMatchObject({
      v: 1,
      operation: "fill_bank_account",
      reason: FILL_BANK_ACCOUNT_REASON,
      entityId: "club",
      reimbursementId: "r-1",
      txnDate: "2026-03-01",
      amountCents: 4500,
      flow: "expense",
      fiscalYear: 2025,
      tier: "record",
      priorFiscalYear: true,
      reconciled: false,
      changed: ["bankAccountId", "checkNumber"],
    });
    expect(before).toEqual({ v: 1, bankAccount: null, checkNumber: null });
    expect(after).toEqual({ v: 1, bankAccount: { id: BANK1, name: "Administrative Checking" }, checkNumber: "8249" });
  });

  it("correct: only changed fields on each side, the tier, and the row as locked", async () => {
    seed({ row: { reconciled: true, reconciledSessionId: "s" } });
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    const r = await post(correctInput({ categoryId: CAT2, memo: "New description", paymentMethod: "check" }), { manage: true });
    expect(r.ok).toBe(true);
    const v = auditValues();
    const before = parseAuditBefore(TRANSACTION_CORRECTED_AUDIT_ACTION, v.before as string);
    const after = parseAuditAfter(TRANSACTION_CORRECTED_AUDIT_ACTION, v.after as string);
    expect(before).toEqual({ v: 1, category: { id: CAT1, name: "Supplies" }, memo: "Supplies" });
    expect(after).toEqual({ v: 1, category: { id: CAT2, name: "Postage" }, memo: "New description" });
    const details = parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, v.details as string);
    expect(details).toMatchObject({
      operation: "correct",
      reason: "Picked the wrong category at pay time",
      tier: "manage",
      reconciled: true,
      reconciledSessionId: "s",
      txnDate: "2026-09-30",
      fiscalYear: 2026,
      changed: ["categoryId", "memo"],
      budgetLineLinkCleared: false,
    });
  });

  it("the serialized payload contains no party and no member name", async () => {
    seed();
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    await post(correctInput({ categoryId: CAT2 }));
    const v = auditValues();
    const blob = JSON.stringify([v.before, v.after, v.details]);
    expect(blob).not.toContain("Pat Member");
    expect(blob).not.toMatch(/"party"/);
  });
});

// ---------------------------------------------------------------------------
// T18: budget-line link
// ---------------------------------------------------------------------------

describe("budget-line link (T18)", () => {
  const LINE_FY2026 = { id: BL1, fundId: FUND_ID, fiscalYear: 2026, categoryId: CAT1, flow: "expense" };

  it("a date moved across a fiscal year auto-clears the link and reports budgetLineLinkCleared", async () => {
    seed({ row: { budgetLineId: BL1, txnDate: "2026-07-05" } });
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue(LINE_FY2026);
    const r = await post(correctInput({ txnDate: "2026-06-28" }), { manage: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.budgetLineLinkCleared).toBe(true);
    expect(calls().find((c) => c.op === "update")!.set!.budgetLineId).toBeNull();
    const details = parseAuditDetails(
      TRANSACTION_CORRECTED_AUDIT_ACTION,
      calls().find((c) => c.op === "insert")!.values!.details as string,
    );
    expect(details).toMatchObject({ budgetLineLinkCleared: true, changed: ["txnDate"] });
  });

  it("a category change that no longer fits the linked line clears it; a still-valid link is kept", async () => {
    seed({ row: { budgetLineId: BL1 } });
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue(LINE_FY2026);
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    const cleared = await post(correctInput({ categoryId: CAT2 }));
    expect(cleared.ok && cleared.result.budgetLineLinkCleared).toBe(true);

    state.calls = [];
    seed({ row: { budgetLineId: BL1 } });
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue(LINE_FY2026);
    const kept = await post(correctInput({ txnDate: "2026-09-12" }));
    expect(kept.ok && kept.result.budgetLineLinkCleared).toBe(false);
    expect("budgetLineId" in calls().find((c) => c.op === "update")!.set!).toBe(false);
  });

  it("a memo-only change never touches the link", async () => {
    seed({ row: { budgetLineId: BL1 } });
    const r = await post(correctInput({ memo: "New" }));
    expect(r.ok).toBe(true);
    expect(getBudgetLineForLinkValidation).not.toHaveBeenCalled();
    expect("budgetLineId" in calls().find((c) => c.op === "update")!.set!).toBe(false);
  });

  it("budgetLineId: null clears explicitly", async () => {
    seed({ row: { budgetLineId: BL1 } });
    const r = await post(correctInput({ budgetLineId: null }));
    expect(r.ok && r.result.budgetLineLinkCleared).toBe(false);
    expect(calls().find((c) => c.op === "update")!.set!.budgetLineId).toBeNull();
  });

  it("a new pick is validated against fund, effective fiscal year, effective category and flow", async () => {
    // not found
    seed();
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue(null);
    expectFail(await post(correctInput({ budgetLineId: BL1 })), "budget_line_not_found");
    for (const bad of [
      { ...LINE_FY2026, fundId: "other" },
      { ...LINE_FY2026, fiscalYear: 2025 },
      { ...LINE_FY2026, categoryId: CAT2 },
      { ...LINE_FY2026, flow: "income" },
    ]) {
      state.calls = [];
      seed();
      vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue(bad);
      expectFail(await post(correctInput({ budgetLineId: BL1 })), "budget_line_invalid");
    }
    // valid, judged against the NEW category and date
    state.calls = [];
    seed();
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    vi.mocked(getBudgetLineForLinkValidation).mockResolvedValue({ ...LINE_FY2026, categoryId: CAT2 });
    expect((await post(correctInput({ categoryId: CAT2, budgetLineId: BL1 }))).ok).toBe(true);
  });

  it("an UNCHANGED bank account is not re-validated: a deactivated-account row can still be re-categorized", async () => {
    seed({ row: { bankAccountId: BANK1 } });
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    q(ledgerBankAccounts, [{ ...BANK1_ROW, isActive: false }], [{ name: "Administrative Checking" }]);
    const r = await post(correctInput({ categoryId: CAT2, bankAccountId: BANK1 }));
    expect(r.ok).toBe(true);
    // the only ledger_bank_accounts read is none: the resent value equalled the stored one
    expect(calls().filter((c) => c.table === ledgerBankAccounts)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T19: GET / POST parity
// ---------------------------------------------------------------------------

describe("GET / POST parity (T19)", () => {
  type Scenario = {
    name: string;
    row?: Record<string, unknown>;
    matched?: boolean;
    manage?: boolean;
    proposal?: { txnDate?: string; paymentMethod?: "check" | "cash" | "other" };
    op: "fill_bank_account" | "correct";
    post: CorrectionBodyInput;
    expectCode: CorrectionErrorCode | null;
  };

  const MATCH = [{ id: "m", sessionId: "s", bankLineId: "b" }];
  const scenarios: Scenario[] = [
    { name: "matched row, date proposal", matched: true, proposal: { txnDate: "2026-09-12" }, op: "correct", post: correctInput({ txnDate: "2026-09-12" }), expectCode: "matched_open_session" },
    { name: "session-reconciled, date proposal", row: { reconciled: true, reconciledSessionId: "s" }, manage: true, proposal: { txnDate: "2026-09-12" }, op: "correct", post: correctInput({ txnDate: "2026-09-12" }), expectCode: "reconciled_session" },
    { name: "legacy-reconciled, date proposal", row: { reconciled: true }, manage: true, proposal: { txnDate: "2026-09-12" }, op: "correct", post: correctInput({ txnDate: "2026-09-12" }), expectCode: "reconciled_legacy" },
    { name: "reconciled row, no manage", row: { reconciled: true, reconciledSessionId: "s" }, manage: false, op: "correct", post: correctInput({ memo: "x" }), expectCode: "manage_required" },
    { name: "prior-year row, no manage", row: { txnDate: "2026-03-01" }, manage: false, op: "correct", post: correctInput({ memo: "x" }), expectCode: "manage_required" },
    { name: "method away from check would hide September", proposal: { paymentMethod: "cash" }, op: "correct", post: correctInput({ paymentMethod: "cash" }), expectCode: "would_hide_statement" },
    { name: "earlier date would hide August", row: { paymentMethod: "cash" }, proposal: { txnDate: "2026-08-15" }, op: "correct", post: correctInput({ txnDate: "2026-08-15" }), expectCode: "would_hide_statement" },
    { name: "plain unreconciled row, memo only", op: "correct", post: correctInput({ memo: "x" }), expectCode: null },
    { name: "fill: already has an account", row: { bankAccountId: BANK2 }, op: "fill_bank_account", post: fillInput(), expectCode: "already_has_bank_account" },
    { name: "fill: matched", matched: true, op: "fill_bank_account", post: fillInput(), expectCode: "matched_open_session" },
    { name: "fill: reconciled", row: { reconciled: true }, op: "fill_bank_account", post: fillInput(), expectCode: "reconciled_legacy" },
    { name: "fill: clean", op: "fill_bank_account", post: fillInput(), expectCode: null },
  ];

  it.each(scenarios)("$name", async (sc) => {
    // GET
    state.queues = new Map();
    state.calls = [];
    q(ledgerTransactions, [{ ...ROW, ...sc.row }]);
    q(ledgerFunds, [FUND]);
    q(ledgerReimbursements, LINKED);
    q(ledgerEntities, [ENTITY]);
    if (sc.matched) qAll(ledgerReconciliationMatches, MATCH);
    const preview = await previewCorrection({
      transactionId: ID,
      actor: ACTOR,
      callerCanManage: sc.manage ?? false,
      proposal: sc.proposal,
      now: NOW,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const decision =
      sc.op === "fill_bank_account"
        ? preview.preview.operations.fill_bank_account
        : preview.preview.operations.correct;

    // POST
    state.queues = new Map();
    state.calls = [];
    seed({ row: sc.row });
    if (sc.matched) qAll(ledgerReconciliationMatches, MATCH);
    q(ledgerBankAccounts, [BANK1_ROW]);
    q(ledgerCategories, [CATEGORY2], [{ name: "Supplies" }]);
    const result = await post(sc.post, { manage: sc.manage ?? false });

    if (sc.expectCode === null) {
      expect(decision.allowed).toBe(true);
      expect(result.ok).toBe(true);
    } else {
      expect(decision.allowed).toBe(false);
      expect(result.ok).toBe(false);
      if (decision.allowed || result.ok) return;
      expect(decision.code).toBe(sc.expectCode);
      expect(result.code).toBe(sc.expectCode);
      expect(decision.status).toBe(result.status);
    }
  });

  it("top-level refusals are the same for GET and POST: not_found, not_correctable, own_request", async () => {
    q(ledgerTransactions, []);
    expect(await previewCorrection({ transactionId: ID, actor: ACTOR, callerCanManage: true, now: NOW })).toMatchObject({ ok: false, code: "not_found", status: 404 });

    state.queues = new Map();
    q(ledgerTransactions, [{ ...ROW }]);
    q(ledgerFunds, [FUND]);
    q(ledgerReimbursements, []);
    expect(await previewCorrection({ transactionId: ID, actor: ACTOR, callerCanManage: true, now: NOW })).toMatchObject({ ok: false, code: "not_correctable", status: 403 });

    state.queues = new Map();
    q(ledgerTransactions, [{ ...ROW }]);
    q(ledgerFunds, [FUND]);
    q(ledgerReimbursements, LINKED);
    expect(
      await previewCorrection({ transactionId: ID, actor: { userId: "u-sub" }, callerCanManage: true, now: NOW }),
    ).toMatchObject({ ok: false, code: "own_request", status: 403 });
  });

  it("the preview's shape: locked fields, editability, options and the stale token", async () => {
    q(ledgerTransactions, [{ ...ROW, reconciledSessionId: "s", reconciled: true }]);
    q(ledgerFunds, [FUND]);
    q(ledgerReimbursements, LINKED);
    q(ledgerEntities, [ENTITY]);
    q(ledgerCategories, [{ name: "Supplies" }], [{ id: CAT1, name: "Supplies" }]);
    q(ledgerBankAccounts, [{ id: BANK1, name: "Checking", isDefault: false, isActive: true }]);
    const r = await previewCorrection({ transactionId: ID, actor: ACTOR, callerCanManage: true, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.preview;
    expect(p.transaction).toMatchObject({
      id: ID,
      txnDate: "2026-09-30",
      reconciled: true,
      matched: false,
      updatedAt: UPDATED.toISOString(),
      entity: { id: "club", slug: "club", name: "Club" },
      fiscalYear: 2026,
    });
    expect(p.operations.correct).toMatchObject({
      allowed: true,
      dateAndBankEditable: false,
      lockedFields: { code: "reconciled_session" },
      tier: { required: "manage", reasons: ["reconciled"] },
    });
    expect(p.operations.fill_bank_account).toMatchObject({ allowed: false, code: "reconciled_session", status: 403 });
    expect(p.options.paymentMethods).toEqual(["check", "cash", "other"]);
    expect(p.options.defaultBankAccountId).toBe(BANK1); // the sole active account
    expect(p.reasonLimits).toEqual({ min: 10, max: 500 });
    // read-only: nothing was written
    expect(writes()).toHaveLength(0);
    // and no row lock on the GET path
    expect(calls().some((c) => c.forUpdate)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T20: statement rule end to end
// ---------------------------------------------------------------------------

describe("statement rule (T20)", () => {
  it("an earlier date that hides a visible month is 409 would_hide_statement, and nothing is written", async () => {
    seed({ row: { paymentMethod: "cash" } });
    const r = await post(correctInput({ txnDate: "2026-08-15" }));
    expectFail(r, "would_hide_statement");
    if (!r.ok) expect(r.error).toMatch(/August 2026/);
    expect(writes()).toHaveLength(0);
  });

  it("the same month or a later date succeeds, with the sent-statement warning when one exists", async () => {
    seed({ row: { paymentMethod: "cash" } });
    qAll(financialReportSends, [{ id: "send-1" }], 4);
    const r = await post(correctInput({ txnDate: "2026-09-12" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.warnings.map((w) => w.code)).toEqual(["sent_statement", "reports_change"]);

    state.calls = [];
    state.queues = new Map();
    seed({ row: { paymentMethod: "cash", txnDate: "2026-08-10" } });
    qAll(financialReportSends, [{ id: "send-1" }], 4);
    const later = await post(correctInput({ txnDate: "2026-09-25" }));
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    // both the old (August) and the new (September) month have a sent statement
    expect(later.result.warnings.map((w) => w.code)).toEqual([
      "sent_statement",
      "new_month_sent_statement",
      "reports_change",
    ]);
    const details = parseAuditDetails(
      TRANSACTION_CORRECTED_AUDIT_ACTION,
      calls().find((c) => c.op === "insert")!.values!.details as string,
    );
    expect(details).toMatchObject({ sentStatementMonth: "2026-08", newSentStatementMonth: "2026-09" });
  });

  it("a method change from Check to Cash that would hide a month is refused; Cash to Check is allowed", async () => {
    seed(); // method check, date 2026-09-30
    expectFail(await post(correctInput({ paymentMethod: "cash" })), "would_hide_statement");

    state.calls = [];
    state.queues = new Map();
    seed({ row: { paymentMethod: "cash" } });
    expect((await post(correctInput({ paymentMethod: "check" }))).ok).toBe(true);
  });

  it("another unreconciled gating row that already hides the month does not block the change", async () => {
    seed({ row: { paymentMethod: "cash" } });
    // loadEarliestGatingDate reads other posted unreconciled rows: one cash expense in July gates already
    q(ledgerTransactions, [{ txnDate: "2026-07-01", fundKind: "administrative", paymentMethod: "cash", flow: "expense" }]);
    expect((await post(correctInput({ txnDate: "2026-08-15" }))).ok).toBe(true);
  });
});

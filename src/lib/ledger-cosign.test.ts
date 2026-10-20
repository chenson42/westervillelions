/**
 * Unit tests for cosignTransaction() (Phase 3 addendum B3 / "2b Unit tests").
 * Hermetic: @/lib/db is mocked. The mock supports the shared lock chain
 * `.select().from().where().orderBy().for(mode)`, `.select().from().where().limit()`
 * (answered from a queue of arrays or functions) and
 * `.insert().values().onConflictDoNothing().returning()` against a tiny
 * in-memory unique index on (txnId, userId).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: {
    lockQueue: [] as Row[][],
    limitQueue: [] as (Row[] | (() => Row[]))[],
    forArgs: [] as string[],
    orderByCalls: 0,
    events: [] as string[],
    wheres: [] as unknown[],
    inserts: [] as { values: Record<string, unknown>; conflict: unknown }[],
    stored: new Map<string, { id: string; cosignedAt: Date }>(),
    dbCalls: 0,
    txCalls: 0,
    insertSeq: 0,
  },
}));

vi.mock("@/lib/db", () => {
  const select = () => ({
    from: () => ({
      where: (w: unknown) => {
        st.wheres.push(w);
        return {
          orderBy: () => {
            st.orderByCalls += 1;
            return {
              for: (mode: string) => {
                st.forArgs.push(mode);
                st.events.push("lock");
                return Promise.resolve(st.lockQueue.shift() ?? []);
              },
            };
          },
          limit: () => {
            st.events.push("select");
            const next = st.limitQueue.shift() ?? [];
            return Promise.resolve(typeof next === "function" ? next() : next);
          },
        };
      },
    }),
  });
  const insert = () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: (conflict: unknown) => ({
        returning: () => {
          st.events.push("insert");
          st.inserts.push({ values, conflict });
          const key = `${values.txnId}:${values.userId}`;
          if (st.stored.has(key)) return Promise.resolve([]);
          const rec = { id: `cosign-${++st.insertSeq}`, cosignedAt: values.cosignedAt as Date };
          st.stored.set(key, rec);
          return Promise.resolve([rec]);
        },
      }),
    }),
  });
  const tx = { select, insert };
  return {
    db: {
      select: (...a: unknown[]) => {
        st.dbCalls += 1;
        return (select as (...x: unknown[]) => unknown)(...a);
      },
      transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => {
        st.txCalls += 1;
        return cb(tx);
      }),
    },
  };
});

import { cosignTransaction } from "./ledger-cosign";

const E = "11111111-1111-4111-8111-111111111111"; // expense leg
const I = "22222222-2222-4222-8222-222222222222"; // income leg
const G = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POSTER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RECORDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-10-10T16:00:00Z");
const APPROVED_AT = new Date("2026-10-09T12:00:00Z");

function expense(over: Row = {}): Row {
  return {
    id: E,
    flow: "expense",
    transferGroupId: null,
    status: "posted",
    recordedByUserId: RECORDER,
    approvedByUserId: POSTER,
    approvedAt: APPROVED_AT,
    rejectedByUserId: null,
    rejectedAt: null,
    updatedAt: new Date("2026-10-09T12:00:00Z"),
    ...over,
  };
}
const pairExpense = (over: Row = {}) => expense({ transferGroupId: G, ...over });
const pairIncome = (over: Row = {}): Row =>
  expense({ id: I, flow: "income", transferGroupId: G, ...over });

const ok = [{ ok: true }];

function reset() {
  st.lockQueue = [];
  st.limitQueue = [];
  st.forArgs = [];
  st.orderByCalls = 0;
  st.events = [];
  st.wheres = [];
  st.inserts = [];
  st.stored = new Map();
  st.dbCalls = 0;
  st.txCalls = 0;
  st.insertSeq = 0;
}
beforeEach(reset);

describe("cosignTransaction", () => {
  it("co-signs an ordinary approved expense and inserts {txnId, userId, cosignedAt}", async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toEqual({ ok: true, id: E, cosignedAt: NOW });
    expect(st.inserts).toHaveLength(1);
    expect(st.inserts[0].values).toEqual({ txnId: E, userId: ACTOR, cosignedAt: NOW });
  });

  it("co-sign via the income-leg id inserts the expense-leg id", async () => {
    st.lockQueue.push([pairExpense(), pairIncome()]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: I, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: true, id: E });
    expect(st.inserts[0].values.txnId).toBe(E);
  });

  it("same user via the income leg, then the expense leg: second is already_cosigned, same txnId both times", async () => {
    st.lockQueue.push([pairExpense(), pairIncome()], [pairExpense(), pairIncome()]);
    st.limitQueue.push(ok, ok, () => [{ cosignedAt: st.stored.get(`${E}:${ACTOR}`)!.cosignedAt }]);
    const first = await cosignTransaction({ id: I, actorUserId: ACTOR, now: NOW });
    const second = await cosignTransaction({ id: E, actorUserId: ACTOR, now: new Date("2026-10-11T00:00:00Z") });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, status: 409, body: { code: "already_cosigned", at: NOW.toISOString() } });
    expect(st.inserts.map((i) => i.values.txnId)).toEqual([E, E]);
    expect(st.stored.size).toBe(1);
  });

  it("double tap: 409 already_cosigned with the first row's cosigned_at, one row survives", async () => {
    st.lockQueue.push([expense()], [expense()]);
    st.limitQueue.push(ok, ok, () => [{ cosignedAt: NOW }]);
    const a = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    const b = await cosignTransaction({ id: E, actorUserId: ACTOR, now: new Date("2026-10-10T17:00:00Z") });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "already_cosigned", at: NOW.toISOString(), deciderName: null },
    });
    expect(st.stored.size).toBe(1);
  });

  it("the recorder of only the income leg gets 403 recorded_by_you and no insert", async () => {
    st.lockQueue.push([pairExpense(), pairIncome({ recordedByUserId: ACTOR })]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: "recorded_by_you" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("the recorder of only the expense leg gets 403 recorded_by_you and no insert", async () => {
    st.lockQueue.push([pairExpense({ recordedByUserId: ACTOR }), pairIncome()]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: I, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: "recorded_by_you" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("the posting approver gets 409 already_approved with at = approvedAt and no insert", async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: POSTER, now: NOW });
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "already_approved", at: APPROVED_AT.toISOString() },
    });
    expect(st.inserts).toHaveLength(0);
  });

  it("a deleted posting approver (approvedByUserId null, approvedAt set) is still co-signable", async () => {
    st.lockQueue.push([expense({ approvedByUserId: null })]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: OTHER, now: NOW });
    expect(r.ok).toBe(true);
  });

  it("pending (single and pair) is 409 not_approved", async () => {
    st.lockQueue.push([expense({ status: "pending", approvedAt: null, approvedByUserId: null })]);
    const single = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    st.lockQueue.push([
      pairExpense({ status: "pending", approvedAt: null }),
      pairIncome({ status: "pending", approvedAt: null }),
    ]);
    const pair = await cosignTransaction({ id: I, actorUserId: ACTOR, now: NOW });
    expect(single).toMatchObject({ ok: false, status: 409, body: { code: "not_approved", at: null } });
    expect(pair).toMatchObject({ ok: false, status: 409, body: { code: "not_approved" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("rejected is 409 rejected with the rejector's name and rejectedAt", async () => {
    const rejectedAt = new Date("2026-10-09T15:00:00Z");
    st.lockQueue.push([
      expense({ status: "rejected", approvedAt: null, approvedByUserId: null, rejectedByUserId: POSTER, rejectedAt }),
    ]);
    st.limitQueue.push([{ name: "Pat Example" }]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "rejected", deciderName: "Pat Example", at: rejectedAt.toISOString() },
    });
  });

  it("a legacy rejection (no stamp) reports updatedAt and a null name", async () => {
    const updatedAt = new Date("2026-09-01T00:00:00Z");
    st.lockQueue.push([
      expense({ status: "rejected", approvedAt: null, approvedByUserId: null, rejectedByUserId: null, rejectedAt: null, updatedAt }),
    ]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({
      ok: false,
      status: 409,
      body: { code: "rejected", deciderName: null, at: updatedAt.toISOString() },
    });
  });

  it("an email-shaped rejector name returns deciderName null", async () => {
    st.lockQueue.push([
      expense({ status: "rejected", approvedAt: null, approvedByUserId: null, rejectedByUserId: POSTER, rejectedAt: APPROVED_AT }),
    ]);
    st.limitQueue.push([{ name: "someone@example.com" }]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, body: { code: "rejected", deciderName: null } });
  });

  it("a row the predicate refuses (reimbursement-stamped, under-threshold Sweep) is not_board_decision, no insert", async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push([{ ok: false }]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("a lone income row is not_board_decision and never reaches the predicate", async () => {
    st.lockQueue.push([expense({ flow: "income" })]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(st.events).toEqual(["lock"]);
  });

  it("a locked set of the wrong size is not_board_decision, no insert", async () => {
    st.lockQueue.push([pairExpense()]); // pair with one leg
    const pairShort = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    st.lockQueue.push([expense(), expense({ id: I })]); // non-pair with two rows
    const nonPairLong = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(pairShort).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(nonPairLong).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("call order is lock, predicate select on the expense id, insert, all in one transaction", async () => {
    st.lockQueue.push([pairExpense(), pairIncome()]);
    st.limitQueue.push(ok);
    await cosignTransaction({ id: I, actorUserId: ACTOR, now: NOW });
    expect(st.events).toEqual(["lock", "select", "insert"]);
    expect(st.txCalls).toBe(1);
    // wheres[0] = lock, wheres[1] = predicate select
    const p = new PgDialect().sqlToQuery(st.wheres[1] as SQL);
    expect(p.params).toContain(E);
    expect(p.params).not.toContain(I);
  });

  it("an unknown id is 404", async () => {
    st.lockQueue.push([]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toEqual({ ok: false, status: 404, body: { error: "Transaction not found", code: "not_found" } });
  });

  it("a locked set that omits the requested id is 404", async () => {
    st.lockQueue.push([expense({ id: "99999999-9999-4999-8999-999999999999" })]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("a malformed id is 404 and the mocked db is never touched", async () => {
    const r = await cosignTransaction({ id: "not-a-uuid", actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 404, body: { code: "not_found" } });
    expect(st.txCalls).toBe(0);
    expect(st.dbCalls).toBe(0);
    expect(st.events).toEqual([]);
  });

  it('locks FOR SHARE with an ORDER BY, never FOR UPDATE', async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push(ok);
    await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(st.forArgs).toEqual(["share"]);
    expect(st.orderByCalls).toBe(1);
  });

  it("two different users both succeed and neither reads the other's row", async () => {
    st.lockQueue.push([expense()], [expense()]);
    st.limitQueue.push(ok, ok);
    const [a, b] = [
      await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW }),
      await cosignTransaction({ id: E, actorUserId: OTHER, now: NOW }),
    ];
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(st.stored.size).toBe(2);
    // Only the two predicate selects ran; no co-sign re-read.
    expect(st.events.filter((e) => e === "select")).toHaveLength(2);
  });

  it("the INSERT carries ON CONFLICT DO NOTHING on (txn_id, user_id)", async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push(ok);
    await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    const conflict = st.inserts[0].conflict as { target: { name: string }[] };
    expect(conflict.target.map((c) => c.name)).toEqual(["txn_id", "user_id"]);
  });

  it("defaults now to the server clock when omitted", async () => {
    st.lockQueue.push([expense()]);
    st.limitQueue.push(ok);
    const before = Date.now();
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR });
    expect(r.ok && r.cosignedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Source scans.
// ---------------------------------------------------------------------------

const srcRoot = join(__dirname, "..");
const repoRoot = join(srcRoot, "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|sql)$/.test(name)) out.push(full);
  }
  return out;
}

describe("ledger-cosign.ts source scans", () => {
  const src = strip(readFileSync(join(__dirname, "ledger-cosign.ts"), "utf8"));
  it("never writes ledger_transactions", () => {
    expect(src).not.toContain("update(ledgerTransactions");
    expect(src).not.toContain("delete(ledgerTransactions");
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
  });
  it("evaluates boardApprovalPredicate( and never re-states the reimbursement test", () => {
    expect(src).toContain("boardApprovalPredicate(");
    expect(src).not.toContain("paidReimbursementExists(");
  });
  it("does not import the approver-only queries module", () => {
    expect(src).not.toMatch(/ledger-approval-queries/);
  });
  it("takes the shared lock helper and never FOR UPDATE", () => {
    expect(src).toContain('lockDecisionGroup(tx, id, "share")');
    expect(src).not.toContain('"update"');
  });
});

describe("co-sign table identifier allow-list (R12)", () => {
  const allowed = (rel: string) =>
    rel === "src/lib/db/schema.ts" ||
    rel === "src/lib/ledger-cosign.ts" ||
    rel === "src/lib/ledger-approval-queries.ts" ||
    rel.startsWith("drizzle/migrations/") ||
    rel.startsWith("e2e/") ||
    /\.test\.tsx?$/.test(rel);
  it("ledgerTxnCosigns / ledger_txn_cosigns appear only in the allowed files", () => {
    const offenders = [
      ...walk(srcRoot),
      ...walk(join(repoRoot, "drizzle")),
      ...walk(join(repoRoot, "scripts")),
    ]
      .map((f) => relative(repoRoot, f))
      .filter((rel) => !allowed(rel))
      .filter((rel) => /ledgerTxnCosigns|ledger_txn_cosigns/.test(readFileSync(join(repoRoot, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("ledger-cosign is imported only by the cosign route (and tests)", () => {
    const offenders = walk(srcRoot)
      .map((f) => relative(repoRoot, f))
      .filter((rel) => !/\.test\.tsx?$/.test(rel) && rel !== "src/lib/ledger-cosign.ts")
      .filter((rel) => /["'](@\/lib\/|\.\/)ledger-cosign["']/.test(readFileSync(join(repoRoot, rel), "utf8")));
    expect(offenders).toEqual(["src/app/api/admin/ledger/transactions/[id]/cosign/route.ts"]);
  });
});

// ---------------------------------------------------------------------------
// Itemized sweep batches (B-172 Increment 2a): co-sign normalises to the leg.
// ---------------------------------------------------------------------------

describe("cosignTransaction — itemized sweep batch", () => {
  const C1 = "44444444-4444-4444-8444-444444444441";
  const C2 = "44444444-4444-4444-8444-444444444442";
  const S1 = "55555555-5555-4555-8555-555555555551";
  const S2 = "55555555-5555-4555-8555-555555555552";
  const leg = (over: Row = {}) =>
    expense({ transferGroupId: G, sweptFromTxnId: null, sweepLegTxnId: null, ...over });
  const copy = (id: string, source: string, over: Row = {}): Row =>
    expense({
      id,
      flow: "income",
      transferGroupId: null,
      approvedAt: null,
      approvedByUserId: null,
      sweptFromTxnId: source,
      sweepLegTxnId: E,
      ...over,
    });

  it("co-signing an approved batch inserts the leg's id", async () => {
    st.lockQueue.push([leg(), copy(C1, S1), copy(C2, S2)]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toEqual({ ok: true, id: E, cosignedAt: NOW });
    expect(st.inserts[0].values.txnId).toBe(E);
    expect(st.forArgs).toEqual(["share"]);
  });

  it("a copy id is not_board_decision and inserts nothing", async () => {
    st.lockQueue.push([copy(C1, S1)]);
    const r = await cosignTransaction({ id: C1, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("an under-threshold posted leg (no approved_at) is not_board_decision", async () => {
    st.lockQueue.push([
      leg({ approvedAt: null, approvedByUserId: null }),
      copy(C1, S1),
    ]);
    st.limitQueue.push([{ ok: false }]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
    expect(st.inserts).toHaveLength(0);
  });

  it("a pending batch is not_approved", async () => {
    st.lockQueue.push([
      leg({ status: "pending", approvedAt: null, approvedByUserId: null }),
      copy(C1, S1, { status: "pending" }),
    ]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_approved" } });
  });

  it("the copies' recorder counts as the recorder", async () => {
    st.lockQueue.push([leg(), copy(C1, S1, { recordedByUserId: ACTOR })]);
    st.limitQueue.push(ok);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 403, body: { code: "recorded_by_you" } });
  });

  it("a leg with no copies is not_board_decision", async () => {
    st.lockQueue.push([leg()]);
    const r = await cosignTransaction({ id: E, actorUserId: ACTOR, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: "not_board_decision" } });
  });
});

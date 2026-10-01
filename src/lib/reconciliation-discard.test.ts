/**
 * Query-layer tests for discardOpenSession()
 * (docs/work-log/2026-10-01-discard-reconciliation-session.md, Phase 3 Q1-Q8).
 *
 * `@/lib/db` is mocked with a recording `tx`: every select/delete/insert/update
 * call is captured in order. A mocked db cannot prove FK cascades or "rows
 * unchanged" — those are the live-database checks listed in the work-log.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as Array<{ op: string; table?: unknown; where?: unknown; values?: unknown }>,
    selectResults: [] as unknown[][],
    deleteResult: [] as unknown[],
    insertError: null as Error | null,
  },
}));

vi.mock("@/lib/db", () => {
  const tx = {
    select: () => {
      const result = state.selectResults.shift() ?? [];
      const call: { op: string; where?: unknown } = { op: "select" };
      state.calls.push(call);
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (w: unknown) => {
          call.where = w;
          return chain;
        },
        limit: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
    delete: (table: unknown) => {
      const call: { op: string; table: unknown; where?: unknown } = { op: "delete", table };
      state.calls.push(call);
      return {
        where: (w: unknown) => {
          call.where = w;
          return { returning: () => Promise.resolve(state.deleteResult) };
        },
      };
    },
    insert: (table: unknown) => {
      const call: { op: string; table: unknown; values?: unknown } = { op: "insert", table };
      state.calls.push(call);
      return {
        values: (v: unknown) => {
          call.values = v;
          return state.insertError ? Promise.reject(state.insertError) : Promise.resolve();
        },
      };
    },
    update: (table: unknown) => {
      state.calls.push({ op: "update", table });
      throw new Error("tx.update must never be called by discardOpenSession");
    },
  };
  return { db: { transaction: async (cb: (t: unknown) => unknown) => cb(tx) } };
});

import { discardOpenSession } from "./reconciliation-queries";
import {
  ledgerReconciliationSessions,
  ledgerAuditLog,
  ledgerTransactions,
} from "@/lib/db/schema";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

const deletedRow = {
  id: SESSION_ID,
  bankAccountId: "33333333-3333-4333-8333-333333333333",
  statementPeriodStart: "2026-08-01",
  statementPeriodEnd: "2026-08-31",
  openingBalanceCents: 100000,
  closingBalanceCents: 123456,
  status: "open",
  csvFilename: "chase-aug.csv",
  csvRowCount: 42,
  reopenedAt: null as Date | null,
};

function renderWhere(call: { where?: unknown }) {
  return new PgDialect().sqlToQuery(call.where as SQL);
}

function deleteCall() {
  return state.calls.find((c) => c.op === "delete")!;
}

/** Happy-path select queue: lines count, matches count, account name. */
function queueHappy(lines = 42, matches = 17) {
  state.selectResults = [[{ n: lines }], [{ n: matches }], [{ name: "Chase Checking" }]];
  state.deleteResult = [{ ...deletedRow }];
}

beforeEach(() => {
  state.calls = [];
  state.selectResults = [];
  state.deleteResult = [];
  state.insertError = null;
});

describe("discardOpenSession", () => {
  it("Q1: counts are read before the delete; one delete; one audit insert; result carries counts", async () => {
    queueHappy();
    const result = await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });

    expect(result).toEqual({ outcome: "discarded", sessionId: SESSION_ID, bankLineCount: 42, matchCount: 17 });
    const ops = state.calls.map((c) => c.op);
    expect(ops.indexOf("delete")).toBeGreaterThan(1); // two count selects first
    expect(ops.slice(0, 2)).toEqual(["select", "select"]);
    expect(ops.filter((o) => o === "delete")).toHaveLength(1);
    expect(ops.filter((o) => o === "insert")).toHaveLength(1);
  });

  it("Q2: audit row shape is exact, counts-only, no bank-line text", async () => {
    queueHappy(42, 17);
    state.deleteResult = [{ ...deletedRow, reopenedAt: new Date("2026-09-01") }];
    await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: true });

    const insert = state.calls.find((c) => c.op === "insert")!;
    expect(insert.table).toBe(ledgerAuditLog);
    const row = insert.values as Record<string, unknown>;
    expect(row.action).toBe("reconciliation_session_discarded");
    expect(row.actorUserId).toBe(ACTOR);
    expect(row.targetCategoryId).toBeNull();
    expect(row.targetTransactionId).toBeNull();
    expect(row.after).toBeNull();

    const before = JSON.parse(row.before as string);
    expect(Object.keys(before).sort()).toEqual(
      [
        "bankAccountId",
        "statementPeriodStart",
        "statementPeriodEnd",
        "openingBalanceCents",
        "closingBalanceCents",
        "status",
        "csvFilename",
        "csvRowCount",
        "bankLineCount",
        "matchCount",
        "reopened",
      ].sort(),
    );
    expect(before.reopened).toBe(true);
    expect(before.bankLineCount).toBe(42);
    expect(before.matchCount).toBe(17);

    const details = row.details as string;
    expect(details).toContain("Chase Checking");
    expect(details).toContain("2026-08-01");
    expect(details).toContain("2026-08-31");
    expect(details).toContain("42 statement lines");
    expect(details).toContain("17 matches");
    expect(Object.keys(row).sort()).toEqual(
      ["action", "actorUserId", "after", "before", "details", "targetCategoryId", "targetTransactionId"].sort(),
    );
  });

  it("Q3: close-then-discard race -> not_open, no audit, status predicate pinned in the DELETE — regression for hard-deleting a closed session orphaning reconciled_session_id (ON DELETE SET NULL, DECISION-036)", async () => {
    state.selectResults = [[{ n: 3 }], [{ n: 1 }], [{ status: "closed", reopenedAt: null }]];
    state.deleteResult = [];
    const result = await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: true });

    expect(result).toEqual({ outcome: "not_open" });
    expect(state.calls.some((c) => c.op === "insert")).toBe(false);
    expect(state.calls.filter((c) => c.op === "delete")).toHaveLength(1);

    const q = renderWhere(deleteCall());
    expect(q.sql).toContain('"status"');
    expect(q.params).toContain("open");
    expect(q.params).toContain(SESSION_ID);
  });

  it("Q4: unknown id -> not_found, no audit", async () => {
    state.selectResults = [[{ n: 0 }], [{ n: 0 }], []];
    state.deleteResult = [];
    const result = await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });
    expect(result).toEqual({ outcome: "not_found" });
    expect(state.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("Q5: two-key rule pinned in the DELETE; requires_manage when open+reopened and caller lacks manage", async () => {
    queueHappy();
    await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });
    expect(renderWhere(deleteCall()).sql).toContain('"reopened_at" is null');

    state.calls = [];
    queueHappy();
    await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: true });
    expect(renderWhere(deleteCall()).sql).not.toContain("reopened_at");

    state.calls = [];
    state.selectResults = [[{ n: 1 }], [{ n: 0 }], [{ status: "open", reopenedAt: new Date() }]];
    state.deleteResult = [];
    const result = await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });
    expect(result).toEqual({ outcome: "requires_manage" });
    expect(state.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("Q6: never writes ledger_transactions under any scenario", async () => {
    const scenarios: Array<() => void> = [
      () => queueHappy(),
      () => {
        state.selectResults = [[{ n: 0 }], [{ n: 0 }], [{ status: "closed", reopenedAt: null }]];
        state.deleteResult = [];
      },
      () => {
        state.selectResults = [[{ n: 0 }], [{ n: 0 }], []];
        state.deleteResult = [];
      },
    ];
    for (const setup of scenarios) {
      state.calls = [];
      setup();
      await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });
      expect(state.calls.some((c) => c.op === "update")).toBe(false);
      for (const c of state.calls.filter((x) => x.op === "delete")) {
        expect(c.table).toBe(ledgerReconciliationSessions);
        expect(c.table).not.toBe(ledgerTransactions);
      }
      for (const c of state.calls.filter((x) => x.op === "insert")) {
        expect(c.table).toBe(ledgerAuditLog);
      }
    }
  });

  it("Q7: audit insert failure rejects (so the real transaction rolls back)", async () => {
    queueHappy();
    state.insertError = new Error("audit boom");
    await expect(
      discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false }),
    ).rejects.toThrow("audit boom");
  });

  it("Q8: zero-count session still discards and is audited", async () => {
    queueHappy(0, 0);
    const result = await discardOpenSession({ sessionId: SESSION_ID, actorUserId: ACTOR, canManage: false });
    expect(result).toEqual({ outcome: "discarded", sessionId: SESSION_ID, bankLineCount: 0, matchCount: 0 });
    expect(state.calls.filter((c) => c.op === "insert")).toHaveLength(1);
  });
});

/**
 * T31-T33: recordLedgerAudit, the Recent-corrections reader, and the
 * member-surface import guard (DECISION-110/111).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { state } = vi.hoisted(() => ({
  state: {
    fetched: [] as Array<Record<string, unknown>>,
    where: undefined as unknown,
    limit: undefined as number | undefined,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        leftJoin: () => chain,
        where: (w: unknown) => {
          state.where = w;
          return chain;
        },
        orderBy: () => chain,
        limit: (n: number) => {
          state.limit = n;
          return Promise.resolve(state.fetched);
        },
      };
      return chain;
    },
  },
}));

import { ledgerAuditLog } from "@/lib/db/schema";
import { getRecentLedgerCorrections, recordLedgerAudit } from "./ledger-audit";
import {
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  serializeAuditPayload,
  type FundMoveAuditPayload,
  type TransactionDeletedAuditPayload,
} from "./ledger-correction";

const ACTOR = "22222222-2222-4222-8222-222222222222";

const MOVE: FundMoveAuditPayload = {
  before: {
    v: 1,
    fund: { id: "f1", name: "Administrative Fund", slug: "administrative", kind: "administrative" },
    category: null,
    budgetLineId: null,
  },
  after: {
    v: 1,
    fund: { id: "f2", name: "Activity Fund", slug: "activity", kind: "activity" },
    category: null,
    budgetLineId: null,
  },
  details: {
    v: 1,
    reason: "Booked to the wrong fund",
    entityId: "club",
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 12500,
    fiscalYear: 2026,
    tier: "record",
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: null,
  },
};

function deleted(entityId: string, legEntities = [entityId]): TransactionDeletedAuditPayload {
  return {
    before: {
      v: 1,
      rows: legEntities.map((e, i) => ({
        id: `t${i}`,
        entityId: e,
        fund: { id: "f", name: "Activity Fund", slug: "activity", kind: "activity" },
        bankAccount: null,
        category: null,
        txnDate: "2026-09-15",
        flow: "income",
        amountCents: 5000,
        party: null,
        memo: null,
        donorId: null,
        checkNumber: null,
        paymentMethod: null,
        status: "posted",
        reconciled: false,
        reconciledSessionId: null,
        duesPaymentId: null,
        transferGroupId: null,
        budgetLineId: null,
        acknowledgment: { existed: false, sent: false },
      })),
    },
    after: null,
    details: {
      v: 1,
      reason: "Duplicate entry",
      entityId,
      txnDate: "2026-09-15",
      flow: "income",
      amountCents: 5000,
      fiscalYear: 2026,
      rowCount: legEntities.length === 2 ? 2 : 1,
      reconciled: false,
      reconciledSessionId: null,
      priorFiscalYear: true,
      sentStatementMonth: null,
      acknowledgmentRemoved: false,
    },
  };
}

function fetchedRow(
  id: string,
  action: string,
  payload: { before: unknown; after: unknown; details: unknown },
  createdAt: Date,
  actorName: string | null = "Test Treasurer",
) {
  const t = serializeAuditPayload(payload);
  return { id, action, createdAt, actorName, before: t.before, after: t.after, details: t.details };
}

beforeEach(() => {
  state.fetched = [];
  state.where = undefined;
  state.limit = undefined;
});

describe("recordLedgerAudit (T31)", () => {
  function recordingExec(error?: Error) {
    const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const exec = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserted.push({ table, values });
          return error ? Promise.reject(error) : Promise.resolve();
        },
      }),
    };
    return { exec: exec as never, inserted };
  }

  it("inserts the action, JSON-string columns, a null category target and the actor", async () => {
    const { exec, inserted } = recordingExec();
    await recordLedgerAudit(exec, {
      actorUserId: ACTOR,
      action: TRANSACTION_FUND_MOVED_AUDIT_ACTION,
      targetTransactionId: "txn-1",
      ...MOVE,
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(ledgerAuditLog);
    const v = inserted[0].values;
    expect(v.action).toBe("transaction_fund_moved");
    expect(v.actorUserId).toBe(ACTOR);
    expect(v.targetTransactionId).toBe("txn-1");
    expect(v.targetCategoryId).toBeNull();
    expect(JSON.parse(v.before as string)).toEqual(MOVE.before);
    expect(JSON.parse(v.after as string)).toEqual(MOVE.after);
    expect(JSON.parse(v.details as string)).toEqual(MOVE.details);
  });

  it("a delete stores a null after and a null target", async () => {
    const { exec, inserted } = recordingExec();
    await recordLedgerAudit(exec, {
      actorUserId: ACTOR,
      action: TRANSACTION_DELETED_AUDIT_ACTION,
      targetTransactionId: null,
      ...deleted("club"),
    });
    expect(inserted[0].values.after).toBeNull();
    expect(inserted[0].values.targetTransactionId).toBeNull();
  });

  it("rejects when the insert fails, so the surrounding transaction rolls back", async () => {
    const { exec } = recordingExec(new Error("db down"));
    await expect(
      recordLedgerAudit(exec, {
        actorUserId: ACTOR,
        action: TRANSACTION_FUND_MOVED_AUDIT_ACTION,
        targetTransactionId: "txn-1",
        ...MOVE,
      }),
    ).rejects.toThrow("db down");
  });
});

describe("getRecentLedgerCorrections (T32)", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("selects only the two actions and applies the window cutoff in SQL, with no jsonb cast", async () => {
    await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    const q = new PgDialect().sqlToQuery(state.where as SQL);
    expect(q.sql).toContain('"ledger_audit_log"."action" in ($1, $2)');
    expect(q.params.slice(0, 2)).toEqual(["transaction_fund_moved", "transaction_deleted"]);
    const cutoff = q.params[2] as Date | string;
    const cutoffMs = cutoff instanceof Date ? cutoff.getTime() : new Date(cutoff).getTime();
    expect(cutoffMs).toBe(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
    expect(q.sql.toLowerCase()).not.toContain("jsonb");
    expect(q.sql).not.toContain("::");
  });

  it("applies the fetch cap to the query", async () => {
    await getRecentLedgerCorrections({ entityId: "club", now: NOW, fetchCap: 50 });
    expect(state.limit).toBe(50);
    await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(state.limit).toBe(200);
  });

  it("filters by entity in JavaScript, keeps newest-first order and reports the in-window total", async () => {
    state.fetched = [
      fetchedRow("a", "transaction_fund_moved", MOVE, new Date("2026-09-30")),
      fetchedRow("b", "transaction_fund_moved", { ...MOVE, details: { ...MOVE.details, entityId: "foundation" } }, new Date("2026-09-29")),
      fetchedRow("c", "transaction_deleted", deleted("club"), new Date("2026-09-28")),
    ];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows.map((x) => x.id)).toEqual(["a", "c"]);
    expect(r.totalInWindow).toBe(2);
    expect(r.rows[0]).toMatchObject({
      kind: "moved",
      from: "Administrative Fund",
      to: "Activity Fund",
      reason: "Booked to the wrong fund",
      amountCents: 12500,
      actorName: "Test Treasurer",
      settledPeriod: false,
      rowCount: 1,
    });
    expect(r.rows[1]).toMatchObject({ kind: "deleted", from: "Activity Fund", to: null, settledPeriod: true });
  });

  it("a transfer pair spanning two entities is listed under either entity", async () => {
    state.fetched = [fetchedRow("p", "transaction_deleted", deleted("club", ["club", "foundation"]), new Date("2026-09-30"))];
    const club = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    const foundation = await getRecentLedgerCorrections({ entityId: "foundation", now: NOW });
    const other = await getRecentLedgerCorrections({ entityId: "other", now: NOW });
    expect(club.rows).toHaveLength(1);
    expect(club.rows[0].rowCount).toBe(2);
    expect(foundation.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
  });

  it("caps the display and reports the total", async () => {
    state.fetched = Array.from({ length: 6 }, (_, i) =>
      fetchedRow(`r${i}`, "transaction_fund_moved", MOVE, new Date(`2026-09-${20 + i}`)),
    );
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW, displayCap: 4 });
    expect(r.rows).toHaveLength(4);
    expect(r.totalInWindow).toBe(6);
  });

  it("a row with unparseable details is still listed, with a null reason", async () => {
    state.fetched = [
      {
        id: "x",
        action: "transaction_fund_moved",
        createdAt: new Date("2026-09-30"),
        actorName: null,
        before: "garbage",
        after: null,
        details: "free text, not json",
      },
    ];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ id: "x", reason: null, from: null, to: null, actorName: null });
  });
});

describe("member-surface import guard (T33)", () => {
  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("no member-exposed module imports ledger-audit or ledger-correction", () => {
    const root = join(process.cwd(), "src");
    const files = [
      ...walk(join(root, "app", "members")),
      ...walk(join(root, "app", "api", "members")),
      ...readdirSync(join(root, "lib"))
        .filter((n) => /^financial-report-.*\.ts$/.test(n) && !n.endsWith(".test.ts"))
        .map((n) => join(root, "lib", n)),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /ledger-(audit|correction)["'/]/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

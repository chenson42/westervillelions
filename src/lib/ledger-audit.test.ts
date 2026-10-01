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
import { getLatestFundMove, getRecentLedgerCorrections, recordLedgerAudit } from "./ledger-audit";
import {
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  serializeAuditPayload,
  type FundMoveAuditPayload,
  type FundMoveAuditPayloadV2,
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

const MOVE_V2: FundMoveAuditPayloadV2 = {
  before: {
    v: 2,
    entity: { id: "foundation", name: "Foundation", slug: "foundation" },
    fund: { id: "f1", name: "Charitable Fund", slug: "charitable", kind: "charitable" },
    bankAccount: { id: "b1", name: "Foundation Checking" },
    category: null,
    budgetLineId: null,
  },
  after: {
    v: 2,
    entity: { id: "club", name: "Club", slug: "club" },
    fund: { id: "f2", name: "Activity Fund", slug: "activity", kind: "activity" },
    bankAccount: { id: "b2", name: "Administrative Checking" },
    category: null,
    budgetLineId: null,
  },
  details: {
    v: 2,
    reason: "Deposited into the Club account",
    entityId: "foundation",
    destEntityId: "club",
    crossEntity: true,
    txnDate: "2026-09-15",
    flow: "income",
    amountCents: 25000,
    fiscalYear: 2026,
    tier: "manage",
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: "2026-09",
    destSentStatementMonth: null,
    donorId: "donor-1",
    acknowledgment: { id: "ack-1", sent: true, sentAt: "2026-09-20T12:00:00.000Z", outcome: "kept", doneeEntityId: "foundation" },
  },
};

describe("getRecentLedgerCorrections: cross-entity (v2) moves (C14)", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("a v2 move is returned for the source AND the destination entity, and not for a third", async () => {
    state.fetched = [fetchedRow("m", "transaction_fund_moved", MOVE_V2, new Date("2026-09-30"))];
    const source = await getRecentLedgerCorrections({ entityId: "foundation", now: NOW });
    const dest = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    const third = await getRecentLedgerCorrections({ entityId: "other", now: NOW });
    expect(source.rows).toHaveLength(1);
    expect(dest.rows).toHaveLength(1);
    expect(third.rows).toHaveLength(0);
    expect(third.totalInWindow).toBe(0);
  });

  it("carries direction, both entity names, both accounts and receiptSent", async () => {
    state.fetched = [fetchedRow("m", "transaction_fund_moved", MOVE_V2, new Date("2026-09-30"))];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows[0]).toMatchObject({
      kind: "moved",
      crossEntity: true,
      fromEntityName: "Foundation",
      toEntityName: "Club",
      fromBankAccount: "Foundation Checking",
      toBankAccount: "Administrative Checking",
      receiptSent: true,
      from: "Charitable Fund",
      to: "Activity Fund",
      amountCents: 25000,
      sentStatementMonth: "2026-09",
      reason: "Deposited into the Club account",
    });
  });

  it("receiptSent is false for a removed or absent receipt", async () => {
    const removed: FundMoveAuditPayloadV2 = {
      ...MOVE_V2,
      details: {
        ...MOVE_V2.details,
        acknowledgment: { id: "ack-1", sent: false, sentAt: null, outcome: "removed", doneeEntityId: null },
      },
    };
    state.fetched = [fetchedRow("m", "transaction_fund_moved", removed, new Date("2026-09-30"))];
    expect((await getRecentLedgerCorrections({ entityId: "club", now: NOW })).rows[0].receiptSent).toBe(false);
  });

  it("a v1 move is unchanged: not cross-entity, null names", async () => {
    state.fetched = [fetchedRow("a", "transaction_fund_moved", MOVE, new Date("2026-09-30"))];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows[0]).toMatchObject({
      crossEntity: false,
      fromEntityName: null,
      toEntityName: null,
      fromBankAccount: null,
      toBankAccount: null,
      receiptSent: false,
    });
  });

  it("a malformed v2 row (no destEntityId) is listed raw, never hidden, and never throws", async () => {
    const broken = {
      id: "z",
      action: "transaction_fund_moved",
      createdAt: new Date("2026-09-30"),
      actorName: null,
      before: JSON.stringify({ v: 2, fund: { name: "x" } }),
      after: null,
      details: JSON.stringify({ v: 2, reason: "r", entityId: "club" }),
    };
    state.fetched = [broken];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ reason: null, from: null, to: null, crossEntity: false });
  });
});

describe("getLatestFundMove (C15)", () => {
  it("returns the newest move, parses v2 as 'the <entity>' and v1 as the fund name minus ' Fund'", async () => {
    const t = serializeAuditPayload(MOVE_V2);
    state.fetched = [{ createdAt: new Date("2026-09-30T20:00:00Z"), before: t.before }];
    expect(await getLatestFundMove("txn-1")).toEqual({
      createdAt: new Date("2026-09-30T20:00:00Z"),
      sourceLabel: "the Foundation",
    });

    const v1 = serializeAuditPayload(MOVE);
    state.fetched = [{ createdAt: new Date("2026-09-30T20:00:00Z"), before: v1.before }];
    expect((await getLatestFundMove("txn-1"))?.sourceLabel).toBe("Administrative");
  });

  it("is null when there is no audit row or the payload is raw", async () => {
    state.fetched = [];
    expect(await getLatestFundMove("txn-1")).toBeNull();
    state.fetched = [{ createdAt: new Date(), before: "garbage" }];
    expect(await getLatestFundMove("txn-1")).toBeNull();
  });

  it("the where clause is plain equality on action and target_transaction_id, newest first, one row, no jsonb cast", async () => {
    state.fetched = [];
    await getLatestFundMove("txn-1");
    const q = new PgDialect().sqlToQuery(state.where as SQL);
    expect(q.sql).toBe('("ledger_audit_log"."action" = $1 and "ledger_audit_log"."target_transaction_id" = $2)');
    expect(q.params).toEqual(["transaction_fund_moved", "txn-1"]);
    expect(q.sql.toLowerCase()).not.toContain("jsonb");
    expect(state.limit).toBe(1);
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

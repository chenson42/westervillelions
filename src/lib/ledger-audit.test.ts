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
import {
  getLatestFundMove,
  getRecentLedgerCorrections,
  recordLedgerAudit,
  recordLedgerAuditNote,
} from "./ledger-audit";
import {
  CORRECTION_AUDIT_ACTIONS,
  TRANSACTION_CORRECTED_AUDIT_ACTION,
  TRANSACTION_DELETED_AUDIT_ACTION,
  TRANSACTION_FUND_MOVED_AUDIT_ACTION,
  parseAuditAfter,
  parseAuditBefore,
  parseAuditDetails,
  serializeAuditPayload,
  type AuditPayloadMap,
  type CorrectionAuditAction,
  type ReimbursementCorrectedAuditPayload,
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

describe("recordLedgerAuditNote (DECISION-115)", () => {
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

  it("writes through the supplied executor with both targets null, JSON before/after and the plain details", async () => {
    const { exec, inserted } = recordingExec();
    await recordLedgerAuditNote(exec, {
      actorUserId: ACTOR,
      action: "fund_updated",
      before: { fundId: "f1", name: "Old" },
      after: { fundId: "f1", name: "New" },
      details: "Edited fund",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].table).toBe(ledgerAuditLog);
    const v = inserted[0].values;
    expect(v.action).toBe("fund_updated");
    expect(v.actorUserId).toBe(ACTOR);
    expect(v.targetCategoryId).toBeNull();
    expect(v.targetTransactionId).toBeNull();
    expect(JSON.parse(v.before as string)).toEqual({ fundId: "f1", name: "Old" });
    expect(JSON.parse(v.after as string)).toEqual({ fundId: "f1", name: "New" });
    expect(v.details).toBe("Edited fund");
  });

  it("a null after is stored as null", async () => {
    const { exec, inserted } = recordingExec();
    await recordLedgerAuditNote(exec, {
      actorUserId: ACTOR,
      action: "donor_deleted",
      before: { donorId: "d1" },
      after: null,
      details: "Deleted donor",
    });
    expect(inserted[0].values.after).toBeNull();
  });

  it("rethrows a failed insert, so the surrounding transaction rolls back", async () => {
    const { exec } = recordingExec(new Error("db down"));
    await expect(
      recordLedgerAuditNote(exec, {
        actorUserId: ACTOR,
        action: "ledger_settings_updated",
        before: {},
        after: {},
        details: "x",
      }),
    ).rejects.toThrow("db down");
  });
});

describe("getRecentLedgerCorrections (T32)", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("selects only the three actions and applies the window cutoff in SQL, with no jsonb cast", async () => {
    await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    const q = new PgDialect().sqlToQuery(state.where as SQL);
    expect(q.sql).toContain('"ledger_audit_log"."action" in ($1, $2, $3)');
    expect(q.params.slice(0, 3)).toEqual([
      "transaction_fund_moved",
      "transaction_deleted",
      "transaction_corrected",
    ]);
    const cutoff = q.params[3] as Date | string;
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
    // B-108: the regex also covers ledger-reimbursement-correction(-queries); the
    // old `ledger-(audit|correction)` form would NOT match those names.
    const offenders = files.filter((f) =>
      /ledger-(audit|correction|reimbursement-correction)(-queries)?["'/]/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B-108 / DECISION-114: the third kind, `transaction_corrected` (T27-T31)
// ---------------------------------------------------------------------------

const CORRECTED_FILL: ReimbursementCorrectedAuditPayload = {
  before: { v: 1, bankAccount: null },
  after: { v: 1, bankAccount: { id: "b1", name: "Administrative Checking" } },
  details: {
    v: 1,
    operation: "fill_bank_account",
    reason: "Bank account added to a paid reimbursement that was recorded without one.",
    entityId: "club",
    reimbursementId: "r1",
    txnDate: "2026-09-30",
    amountCents: 4500,
    flow: "expense",
    fiscalYear: 2026,
    tier: "record",
    reconciled: false,
    reconciledSessionId: null,
    priorFiscalYear: false,
    sentStatementMonth: null,
    newSentStatementMonth: null,
    changed: ["bankAccountId"],
    budgetLineLinkCleared: false,
  },
};

const CORRECTED_EDIT: ReimbursementCorrectedAuditPayload = {
  before: {
    v: 1,
    category: { id: "c1", name: "Supplies" },
    memo: "SECRET MEMO TEXT",
    paymentMethod: "check",
  },
  after: {
    v: 1,
    category: { id: "c2", name: "Postage" },
    memo: "NEW SECRET MEMO",
    paymentMethod: "cash",
  },
  details: {
    ...CORRECTED_FILL.details,
    operation: "correct",
    reason: "Wrong category was picked at pay time",
    tier: "manage",
    reconciled: true,
    changed: ["categoryId", "paymentMethod", "memo"],
  },
};

describe("recordLedgerAudit with a corrected payload (T28)", () => {
  it("writes the three text columns and the row target", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const exec = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          return Promise.resolve();
        },
      }),
    };
    await recordLedgerAudit(exec as never, {
      actorUserId: ACTOR,
      action: TRANSACTION_CORRECTED_AUDIT_ACTION,
      targetTransactionId: "txn-1",
      ...CORRECTED_FILL,
    });
    expect(inserted[0].action).toBe("transaction_corrected");
    expect(inserted[0].targetTransactionId).toBe("txn-1");
    expect(inserted[0].targetCategoryId).toBeNull();
    expect(JSON.parse(inserted[0].before as string)).toEqual(CORRECTED_FILL.before);
    expect(JSON.parse(inserted[0].after as string)).toEqual(CORRECTED_FILL.after);
    expect(JSON.parse(inserted[0].details as string)).toEqual(CORRECTED_FILL.details);
  });

  it("a moved payload is rejected by the type system under the corrected action", () => {
    const exec = { insert: () => ({ values: () => Promise.resolve() }) };
    // @ts-expect-error a fund-move payload is not a corrected payload
    void recordLedgerAudit(exec as never, {
      actorUserId: ACTOR,
      action: TRANSACTION_CORRECTED_AUDIT_ACTION,
      targetTransactionId: "txn-1",
      ...MOVE,
    });
  });
});

describe("AuditPayloadMap (T30)", () => {
  it("has a key for every correction action", () => {
    // Compile-time: this Record must stay assignable from the map's keys. Adding an
    // action to CorrectionAuditAction without an AuditPayloadMap entry breaks tsc.
    const keys: Record<keyof AuditPayloadMap, true> = {
      transaction_fund_moved: true,
      transaction_deleted: true,
      transaction_corrected: true,
    };
    const actions: Record<CorrectionAuditAction, true> = keys;
    expect(Object.keys(actions).sort()).toEqual([...CORRECTION_AUDIT_ACTIONS].sort());
  });
});

describe("corrected rows in the reader (T27, T31)", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  it("maps a corrected v1 row: kind, labels, reason, settled period, no memo text", async () => {
    state.fetched = [
      fetchedRow("k1", "transaction_corrected", CORRECTED_EDIT, new Date("2026-09-30")),
      fetchedRow("k2", "transaction_corrected", CORRECTED_FILL, new Date("2026-09-29")),
    ];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      kind: "corrected",
      reason: "Wrong category was picked at pay time",
      settledPeriod: true,
      amountCents: 4500,
      flow: "expense",
      txnDate: "2026-09-30",
      from: null,
      to: null,
      rowCount: 1,
    });
    expect(r.rows[0].changes).toEqual([
      "Category: Supplies to Postage",
      "Payment method: Check to Cash",
      "Description edited",
    ]);
    expect(JSON.stringify(r.rows[0])).not.toContain("SECRET");
    expect(r.rows[1].changes).toEqual(["Bank account added: Administrative Checking"]);
    expect(r.rows[1].settledPeriod).toBe(false);
  });

  it("filters corrected rows by the payload's entity", async () => {
    state.fetched = [
      fetchedRow(
        "k1",
        "transaction_corrected",
        { ...CORRECTED_FILL, details: { ...CORRECTED_FILL.details, entityId: "foundation" } },
        new Date("2026-09-30"),
      ),
    ];
    expect((await getRecentLedgerCorrections({ entityId: "club", now: NOW })).rows).toHaveLength(0);
    expect((await getRecentLedgerCorrections({ entityId: "foundation", now: NOW })).rows).toHaveLength(1);
  });

  it("an unparseable corrected row is still listed, with a null reason", async () => {
    state.fetched = [
      { id: "bad", action: "transaction_corrected", createdAt: new Date("2026-09-30"), actorName: null, before: "x", after: "y", details: "plain text" },
    ];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ kind: "corrected", reason: null, settledPeriod: false, changes: [] });
  });

  it("an unknown version degrades to raw rather than being read as v1", () => {
    const v2 = JSON.stringify({ ...CORRECTED_FILL.details, v: 2 });
    expect(parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, v2)).toEqual({ raw: v2 });
    expect(parseAuditBefore(TRANSACTION_CORRECTED_AUDIT_ACTION, JSON.stringify({ v: 2 }))).toEqual({
      raw: JSON.stringify({ v: 2 }),
    });
    expect(parseAuditAfter(TRANSACTION_CORRECTED_AUDIT_ACTION, "{")).toEqual({ raw: "{" });
    const badOp = JSON.stringify({ ...CORRECTED_FILL.details, operation: "nuke" });
    expect(parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, badOp)).toEqual({ raw: badOp });
    // the one-argument form is still the moved parser
    expect(parseAuditAfter(serializeAuditPayload(MOVE).after)).toEqual(MOVE.after);
  });

  it("the cap and the total include corrected rows; moved and deleted cases are unchanged", async () => {
    state.fetched = [
      fetchedRow("a", "transaction_fund_moved", MOVE, new Date("2026-09-30")),
      fetchedRow("b", "transaction_corrected", CORRECTED_FILL, new Date("2026-09-29")),
      fetchedRow("c", "transaction_deleted", deleted("club"), new Date("2026-09-28")),
    ];
    const r = await getRecentLedgerCorrections({ entityId: "club", now: NOW, displayCap: 2 });
    expect(r.rows.map((x) => x.kind)).toEqual(["moved", "corrected"]);
    expect(r.totalInWindow).toBe(3);
    expect(r.rows[0]).toMatchObject({ kind: "moved", from: "Administrative Fund", to: "Activity Fund" });
    expect(r.rows[0].changes).toBeUndefined();
  });
});

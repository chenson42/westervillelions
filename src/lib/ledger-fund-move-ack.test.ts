/**
 * C20-C21: acknowledgment settlement for a cross-entity move (DECISION-112
 * R1d, DECISION-113 X1). The transaction handle is a recording fake: every
 * select/update/delete is captured in call order. A mocked handle cannot prove
 * lock semantics; the live checks in the work-log do.
 */
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { ledgerAcknowledgments } from "@/lib/db/schema";
import {
  decideAckOutcome,
  settleAcknowledgmentForMove,
  type AckSettleExecutor,
} from "./ledger-fund-move-ack";

type Call = {
  op: "select" | "update" | "delete";
  table?: unknown;
  where?: unknown;
  set?: Record<string, unknown>;
  forUpdate?: boolean;
};

function makeTx(opts: { selects: unknown[][]; deleteResult?: unknown[] }) {
  const calls: Call[] = [];
  const selects = [...opts.selects];
  const tx = {
    select: () => {
      const result = selects.shift() ?? [];
      const call: Call = { op: "select" };
      calls.push(call);
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          call.table = t;
          return chain;
        },
        where: (w: unknown) => {
          call.where = w;
          return chain;
        },
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
      const call: Call = { op: "update", table };
      calls.push(call);
      return {
        set: (s: Record<string, unknown>) => {
          call.set = s;
          return {
            where: (w: unknown) => {
              call.where = w;
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete: (table: unknown) => {
      const call: Call = { op: "delete", table };
      calls.push(call);
      return {
        where: (w: unknown) => {
          call.where = w;
          return { returning: () => Promise.resolve(opts.deleteResult ?? [{ id: "ack-1" }]) };
        },
      };
    },
  };
  return { tx: tx as unknown as AckSettleExecutor, calls };
}

const render = (c: Call) => new PgDialect().sqlToQuery(c.where as SQL);
const TXN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOUNDATION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOW = new Date("2026-10-01T12:00:00Z");
const SENT_AT = new Date("2026-09-20T12:00:00Z");

describe("decideAckOutcome (C20)", () => {
  it.each([
    [{ exists: false, sent: false }, "none"],
    [{ exists: false, sent: true }, "none"],
    [{ exists: true, sent: true }, "kept"],
    [{ exists: true, sent: false }, "removed"],
  ] as const)("%j is %s", (input, expected) => {
    expect(decideAckOutcome(input)).toBe(expected);
  });
});

describe("settleAcknowledgmentForMove (C21)", () => {
  it("the first statement is a FOR UPDATE select whose where renders donation_txn_id = $1", async () => {
    const { tx, calls } = makeTx({ selects: [[]] });
    await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(calls[0]).toMatchObject({ op: "select", table: ledgerAcknowledgments, forUpdate: true });
    const q = render(calls[0]);
    expect(q.sql).toBe('"ledger_acknowledgments"."donation_txn_id" = $1');
    expect(q.params).toEqual([TXN]);
  });

  it("no acknowledgment writes nothing", async () => {
    const { tx, calls } = makeTx({ selects: [[]] });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r).toEqual({ outcome: "none", ack: null });
    expect(calls.filter((c) => c.op !== "select")).toHaveLength(0);
  });

  it("a SENT acknowledgment is kept: updates exactly doneeEntityId and updatedAt, pinned on id and sent_at is not null", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: SENT_AT, doneeEntityId: null }]],
    });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r).toEqual({
      outcome: "kept",
      ack: { id: "ack-1", sentAt: SENT_AT, doneeEntityId: FOUNDATION },
    });
    const writes = calls.filter((c) => c.op !== "select");
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
    expect(writes[0].table).toBe(ledgerAcknowledgments);
    expect(Object.keys(writes[0].set!).sort()).toEqual(["doneeEntityId", "updatedAt"]);
    expect(writes[0].set!.updatedAt).toBe(NOW);
    const q = render(writes[0]);
    expect(q.sql).toBe('("ledger_acknowledgments"."id" = $1 and "ledger_acknowledgments"."sent_at" is not null)');
    expect(q.params).toEqual(["ack-1"]);
  });

  it("a kept acknowledgment never writes sent_at, sent_via, letter_text, letter_storage_key or donor_id", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: SENT_AT, doneeEntityId: null }]],
    });
    await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    for (const c of calls.filter((x) => x.set)) {
      for (const key of ["sentAt", "sentVia", "letterText", "letterStorageKey", "donorId", "purpose", "type", "amountCents"]) {
        expect(Object.keys(c.set!)).not.toContain(key);
      }
    }
  });

  it("an existing stamp is preserved: the set value is coalesce(donee_entity_id, <source>) with the source id second", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: SENT_AT, doneeEntityId: "stamped-earlier" }]],
    });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r.ack?.doneeEntityId).toBe("stamped-earlier");
    const update = calls.find((c) => c.op === "update")!;
    const q = new PgDialect().sqlToQuery(update.set!.doneeEntityId as SQL);
    expect(q.sql).toBe('coalesce("ledger_acknowledgments"."donee_entity_id", $1)');
    expect(q.params).toEqual([FOUNDATION]);
  });

  it("an UNSENT acknowledgment is deleted, pinned on id and sent_at is null", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: null, doneeEntityId: null }]],
      deleteResult: [{ id: "ack-1" }],
    });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r.outcome).toBe("removed");
    expect(r.ack).toEqual({ id: "ack-1", sentAt: null, doneeEntityId: null });
    const del = calls.find((c) => c.op === "delete")!;
    expect(del.table).toBe(ledgerAcknowledgments);
    const q = render(del);
    expect(q.sql).toBe('("ledger_acknowledgments"."id" = $1 and "ledger_acknowledgments"."sent_at" is null)');
    expect(q.params).toEqual(["ack-1"]);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("zero deleted rows re-reads once and treats a now-sent acknowledgment as kept", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: null, doneeEntityId: null }], [{ sentAt: SENT_AT }]],
      deleteResult: [],
    });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r.outcome).toBe("kept");
    expect(r.ack).toEqual({ id: "ack-1", sentAt: SENT_AT, doneeEntityId: FOUNDATION });
    expect(calls.map((c) => c.op)).toEqual(["select", "delete", "select", "update"]);
  });

  it("zero deleted rows and a vanished row is none, with no update", async () => {
    const { tx, calls } = makeTx({
      selects: [[{ id: "ack-1", sentAt: null, doneeEntityId: null }], []],
      deleteResult: [],
    });
    const r = await settleAcknowledgmentForMove(tx, { transactionId: TXN, sourceEntityId: FOUNDATION, now: NOW });
    expect(r).toEqual({ outcome: "none", ack: null });
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});

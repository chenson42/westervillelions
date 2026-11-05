/**
 * Receipt-alert false positives (2026-11-05): the SQL filter behind
 * listTransactions({ missingReceipt }) must carry the same exclusions as the
 * pure isReceiptMissing() predicate (transfer legs, paid-reimbursement rows).
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const captured: { where?: SQL } = {};
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (w: SQL) => {
    captured.where = w;
    return chain;
  };
  chain.orderBy = () => Promise.resolve([]);
  return { db: { select: () => chain } };
});

import { listTransactions } from "./ledger-queries";
import { isReceiptMissing } from "./ledger";
import { mapPaidReimbursementIdsByTransaction } from "./ledger-reimbursement-link";

const base = { flow: "expense", receiptStorageKey: null, receiptWaivedAt: null };

describe("missing-receipt SQL filter parity with isReceiptMissing", () => {
  it("excludes transfer legs and paid-reimbursement rows in SQL, as the predicate does", async () => {
    await listTransactions("entity-1", { missingReceipt: true });
    const q = new PgDialect().sqlToQuery(captured.where as SQL);
    expect(q.sql).toContain('"ledger_transactions"."flow" = $');
    expect(q.sql).toContain('"ledger_transactions"."receipt_storage_key" is null');
    expect(q.sql).toContain('"ledger_transactions"."receipt_waived_at" is null');
    expect(q.sql).toContain('"ledger_transactions"."transfer_group_id" is null');
    expect(q.sql).toMatch(/not \(?EXISTS \(SELECT 1 FROM "ledger_reimbursements"/i);
    expect(q.sql).toContain("\"ledger_reimbursements\".\"status\" = 'paid'");

    // Predicate side of the same three exclusions.
    expect(isReceiptMissing({ ...base, transferGroupId: null, hasPaidReimbursement: false })).toBe(true);
    expect(isReceiptMissing({ ...base, transferGroupId: "g", hasPaidReimbursement: false })).toBe(false);
    expect(isReceiptMissing({ ...base, transferGroupId: null, hasPaidReimbursement: true })).toBe(false);
  });

  it("does not add the exclusions when the filter is off", async () => {
    await listTransactions("entity-1", {});
    const q = new PgDialect().sqlToQuery(captured.where as SQL);
    expect(q.sql).not.toContain("transfer_group_id");
  });
});

describe("mapPaidReimbursementIdsByTransaction", () => {
  it("maps txn id to reimbursement id, skips null links, short-circuits on empty", async () => {
    const rows = [
      { id: "r-1", txnId: "t-1" },
      { id: "r-2", txnId: "t-1" },
      { id: "r-3", txnId: null },
    ];
    let calls = 0;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    };
    const exec = { select: () => (calls++, chain) } as never;
    const out = await mapPaidReimbursementIdsByTransaction(exec, ["t-1"]);
    expect([...out]).toEqual([["t-1", "r-1"]]);
    expect((await mapPaidReimbursementIdsByTransaction(exec, [])).size).toBe(0);
    expect(calls).toBe(1);
  });
});

/** T46: the one definition of "reimbursement-derived" (B-108 / DECISION-114). */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ledgerTransactions } from "@/lib/db/schema";
import {
  listPaidReimbursementTransactionIds,
  loadPaidReimbursementsForTransaction,
  paidReimbursementExists,
} from "./ledger-reimbursement-link";

function fakeExec(result: unknown[]) {
  const calls: { where?: SQL; limit?: number }[] = [];
  const exec = {
    select: () => {
      const call: { where?: SQL; limit?: number } = {};
      calls.push(call);
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: (w: SQL) => {
          call.where = w;
          return chain;
        },
        limit: (n: number) => {
          call.limit = n;
          return chain;
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
      return chain;
    },
  };
  return { exec: exec as never, calls };
}
const render = (w: SQL) => new PgDialect().sqlToQuery(w);

describe("paidReimbursementExists", () => {
  it("is an EXISTS over paid reimbursements linked to the given column", () => {
    const q = render(paidReimbursementExists(ledgerTransactions.id));
    expect(q.sql).toContain("EXISTS (SELECT 1 FROM");
    expect(q.sql).toContain('"ledger_reimbursements"."ledger_transaction_id" = "ledger_transactions"."id"');
    expect(q.sql).toContain("\"ledger_reimbursements\".\"status\" = 'paid'");
  });
});

describe("listPaidReimbursementTransactionIds (T46)", () => {
  it("returns only ids with a paid link, and filters on paid in SQL", async () => {
    const { exec, calls } = fakeExec([{ id: "t-1" }, { id: null }]);
    const out = await listPaidReimbursementTransactionIds(exec, ["t-1", "t-2", "t-1"]);
    expect([...out]).toEqual(["t-1"]);
    const q = render(calls[0].where as SQL);
    expect(q.params).toContain("paid");
    expect(q.params.filter((p) => p === "t-1")).toHaveLength(1); // de-duplicated input
  });

  it("short-circuits on empty input with no query", async () => {
    const { exec, calls } = fakeExec([]);
    expect((await listPaidReimbursementTransactionIds(exec, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("loadPaidReimbursementsForTransaction (T46)", () => {
  it("reads only paid links, capped at 5", async () => {
    const rows = [{ id: "r-1", submittedByUserId: "u", submittedByMemberId: "m" }];
    const { exec, calls } = fakeExec(rows);
    expect(await loadPaidReimbursementsForTransaction(exec, "t-1")).toEqual(rows);
    expect(render(calls[0].where as SQL).params).toEqual(expect.arrayContaining(["t-1", "paid"]));
    expect(calls[0].limit).toBe(5);
  });
});

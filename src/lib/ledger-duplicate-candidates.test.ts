/**
 * T32-T34: the generalized duplicate-candidate finder and the cross-entity
 * move's thin wrapper (B-108 / DECISION-114). Hermetic: a recording fake
 * handle; WHERE clauses are serialized with PgDialect.
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@/lib/db", () => ({ db: {} }));

import { ledgerReimbursements, ledgerTransactions } from "@/lib/db/schema";
import {
  DUPLICATE_CANDIDATE_CAP,
  DUPLICATE_WINDOW_DAYS,
  findDuplicateRows,
  shiftIsoDate,
} from "./ledger-duplicate-candidates";
import { findDuplicateCandidates } from "./ledger-fund-move-preview";

type Recorded = { table: unknown; where?: SQL; limit?: number };

function fakeExec(results: Map<unknown, unknown[][]>) {
  const calls: Recorded[] = [];
  const exec = {
    select: () => {
      const call: Recorded = { table: undefined };
      calls.push(call);
      let result: unknown[] = [];
      const chain: Record<string, unknown> = {
        from: (t: unknown) => {
          call.table = t;
          result = results.get(t)?.shift() ?? [];
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (w: SQL) => {
          call.where = w;
          return chain;
        },
        orderBy: () => chain,
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

const ROW = (over: Record<string, unknown> = {}) => ({
  id: "t-1",
  txnDate: "2026-09-15",
  party: "Pat Member",
  amountCents: 4500,
  checkNumber: null,
  reconciled: false,
  reconciledSessionId: null,
  bankAccountId: null,
  fundName: "Administrative Fund",
  bankAccountName: null,
  matchId: null,
  ...over,
});

describe("income wrapper (T32)", () => {
  it("keeps the move's WHERE shape, 30-day window, self-exclusion, transfer exclusion and cap", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[ROW()]]]]));
    const out = await findDuplicateCandidates(exec, {
      row: { id: "self", txnDate: "2026-09-15", amountCents: 4500 },
      destEntityId: "ent-club",
    });
    const q = render(calls[0].where as SQL);
    expect(q.sql).toContain('"flow" = $');
    expect(q.params).toContain("income");
    expect(q.params).toContain("ent-club");
    expect(q.params).toContain("posted");
    expect(q.params).toContain(4500);
    expect(q.params).toContain("2026-08-16"); // -30 days
    expect(q.params).toContain("2026-10-15"); // +30 days
    expect(q.params).toContain("self");
    expect(q.sql).toMatch(/"transfer_group_id" is null/);
    expect(q.sql).not.toContain("EXISTS");
    expect(calls[0].limit).toBe(DUPLICATE_CANDIDATE_CAP);
    // exactly one query: the income path never reads reimbursements
    expect(calls).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(
      ["amountCents", "bankAccountName", "fundName", "id", "matched", "party", "reconciled", "txnDate"].sort(),
    );
  });

  it("constants and shiftIsoDate are unchanged", () => {
    expect(DUPLICATE_WINDOW_DAYS).toBe(30);
    expect(DUPLICATE_CANDIDATE_CAP).toBe(5);
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("projects matched and reconciled flags", async () => {
    const { exec } = fakeExec(
      new Map([[ledgerTransactions, [[ROW({ matchId: "m", reconciledSessionId: "s" })]]]]),
    );
    const out = await findDuplicateCandidates(exec, {
      row: { id: "self", txnDate: "2026-09-15", amountCents: 4500 },
      destEntityId: "ent-club",
    });
    expect(out[0]).toMatchObject({ matched: true, reconciled: true });
  });
});

describe("expense + reimbursement filter (T33)", () => {
  it("adds the shared paid-reimbursement EXISTS fragment and flow = expense", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[]]]]));
    await findDuplicateRows(exec, {
      entityId: "ent-club",
      flow: "expense",
      amountCents: 4500,
      aroundDate: "2026-10-01",
      reimbursementDerivedOnly: true,
    });
    const q = render(calls[0].where as SQL);
    expect(q.params).toContain("expense");
    expect(q.sql).toContain("EXISTS (SELECT 1 FROM");
    expect(q.sql).toContain('"ledger_reimbursements"');
    expect(q.sql).toContain("'paid'");
  });

  it("unmatchedUnreconciledOnly excludes matched and reconciled rows", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[]]]]));
    await findDuplicateRows(exec, {
      entityId: "e",
      flow: "expense",
      amountCents: 1,
      aroundDate: "2026-10-01",
      unmatchedUnreconciledOnly: true,
    });
    const q = render(calls[0].where as SQL);
    expect(q.sql).toMatch(/"reconciled" = \$/);
    expect(q.params).toContain(false);
    expect(q.sql).toMatch(/"reconciled_session_id" is null/);
    expect(q.sql).toMatch(/"ledger_reconciliation_matches"\."id" is null/);
  });

  it("onAccountOrUnassigned serializes as (bank_account_id IS NULL OR bank_account_id = $id)", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[]]]]));
    await findDuplicateRows(exec, {
      entityId: "e",
      flow: "expense",
      amountCents: 1,
      aroundDate: "2026-10-01",
      onAccountOrUnassigned: "acct-1",
    });
    const q = render(calls[0].where as SQL);
    expect(q.sql).toMatch(/\("ledger_transactions"\."bank_account_id" is null or "ledger_transactions"\."bank_account_id" = \$\d+\)/);
    expect(q.params).toContain("acct-1");
  });

  it("without the optional filters none of them appears", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[]]]]));
    await findDuplicateRows(exec, {
      entityId: "e",
      flow: "expense",
      amountCents: 1,
      aroundDate: "2026-10-01",
    });
    const q = render(calls[0].where as SQL);
    expect(q.sql).not.toContain("EXISTS");
    expect(q.sql).not.toMatch(/bank_account_id" is null or/);
    expect(q.sql).not.toMatch(/"reconciled_session_id" is null/);
  });
});

describe("null-account case and superset fields (T34)", () => {
  it("returns a null-account row with the submitter ids from the linked paid reimbursement", async () => {
    const { exec, calls } = fakeExec(
      new Map<unknown, unknown[][]>([
        [ledgerTransactions, [[ROW({ checkNumber: "8249" })]]],
        [
          ledgerReimbursements,
          [[{ id: "r-1", transactionId: "t-1", submittedByUserId: "u-1", submittedByMemberId: "m-1" }]],
        ],
      ]),
    );
    const out = await findDuplicateRows(exec, {
      entityId: "e",
      flow: "expense",
      amountCents: 4500,
      aroundDate: "2026-10-01",
      reimbursementDerivedOnly: true,
      unmatchedUnreconciledOnly: true,
      onAccountOrUnassigned: "acct-1",
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "t-1",
      bankAccountId: null,
      bankAccountName: null,
      checkNumber: "8249",
      matched: false,
      reconciled: false,
      reimbursementId: "r-1",
      submitterUserId: "u-1",
      submitterMemberId: "m-1",
    });
    expect(calls[0].limit).toBe(5);
    // the second query reads only PAID links
    const q2 = render(calls[1].where as SQL);
    expect(q2.params).toContain("paid");
  });

  it("skips the reimbursement lookup when there are no rows", async () => {
    const { exec, calls } = fakeExec(new Map([[ledgerTransactions, [[]]]]));
    await findDuplicateRows(exec, {
      entityId: "e",
      flow: "expense",
      amountCents: 4500,
      aroundDate: "2026-10-01",
      reimbursementDerivedOnly: true,
    });
    expect(calls).toHaveLength(1);
  });
});

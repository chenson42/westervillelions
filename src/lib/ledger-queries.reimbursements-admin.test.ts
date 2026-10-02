/**
 * T44 (query half): listReimbursementsForAdmin returns `paidTransaction` for the
 * Paid tab (B-108 / DECISION-114): the posted row's bank account, check number
 * and reconciled state, with the join columns stripped from the row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { st } = vi.hoisted(() => ({ st: { rows: [] as Record<string, unknown>[] } }));

vi.mock("@/lib/db", () => {
  const chain = (): unknown => {
    const obj: Record<string, unknown> = {
      from: () => obj,
      innerJoin: () => obj,
      leftJoin: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => obj,
      offset: () => Promise.resolve(st.rows),
    };
    return obj;
  };
  return {
    db: {
      select: () => chain(),
      execute: async () => [{ count: String(st.rows.length) }],
    },
  };
});

import { listReimbursementsForAdmin } from "./ledger-queries";

const BASE = {
  id: "r-1",
  status: "paid",
  amountCents: 4500,
  memberFirstName: "Pat",
  memberLastName: "Member",
  paidByName: "Treasurer",
  fundName: "Administrative Fund",
  txnId: null as string | null,
  txnBankAccountId: null as string | null,
  txnBankAccountName: null as string | null,
  txnCheckNumber: null as string | null,
  txnReconciled: false,
  txnReconciledSessionId: null as string | null,
};

beforeEach(() => {
  st.rows = [];
});

describe("listReimbursementsForAdmin paidTransaction (T44)", () => {
  it("is null before payment and the join columns never leak onto the row", async () => {
    st.rows = [{ ...BASE, status: "submitted" }];
    const { reimbursements, total } = await listReimbursementsForAdmin({ status: "submitted" });
    expect(total).toBe(1);
    expect(reimbursements[0].paidTransaction).toBeNull();
    for (const k of ["txnId", "txnBankAccountId", "txnBankAccountName", "txnCheckNumber", "txnReconciled", "txnReconciledSessionId"]) {
      expect(k in reimbursements[0]).toBe(false);
    }
  });

  it("a repaired row carries its account and check number", async () => {
    st.rows = [
      { ...BASE, txnId: "t-1", txnBankAccountId: "b-1", txnBankAccountName: "Checking", txnCheckNumber: "8249" },
    ];
    const { reimbursements } = await listReimbursementsForAdmin({ status: "paid" });
    expect(reimbursements[0].paidTransaction).toEqual({
      id: "t-1",
      bankAccountId: "b-1",
      bankAccountName: "Checking",
      checkNumber: "8249",
      reconciled: false,
    });
  });

  it("a legacy row with no account is null-account and unreconciled (the Needs-bank-account badge)", async () => {
    st.rows = [{ ...BASE, txnId: "t-2" }];
    const { reimbursements } = await listReimbursementsForAdmin({ status: "paid" });
    expect(reimbursements[0].paidTransaction).toMatchObject({
      bankAccountId: null,
      bankAccountName: null,
      checkNumber: null,
      reconciled: false,
    });
  });

  it("reconciled is true for either mark", async () => {
    st.rows = [
      { ...BASE, txnId: "t-3", txnReconciled: true },
      { ...BASE, id: "r-2", txnId: "t-4", txnReconciledSessionId: "s-1" },
    ];
    const { reimbursements } = await listReimbursementsForAdmin({ status: "paid" });
    expect(reimbursements.map((r) => r.paidTransaction?.reconciled)).toEqual([true, true]);
  });
});

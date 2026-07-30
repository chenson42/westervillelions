/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/split
 * (docs/work-log/2026-07-29-ledger-transaction-split.md).
 *
 * Covers:
 *   - amount validation: <= 0 and >= the row's CURRENT amountCents
 *   - each guard, individually blocked: approved, rejected, reconciled,
 *     reconciledSessionId, matched-in-any-reconciliation-session
 *   - a clean unreconciled row succeeds and produces two rows summing to
 *     the original (asserted via the insert + update calls captured on the
 *     mock transaction client)
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db, and
 * @/lib/reconciliation-queries — importing the real @/lib/db module throws
 * at import time without DATABASE_URL (see the header comment in
 * src/lib/ledger-queries.test.ts for the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/reconciliation-queries", () => ({
  getMatchForTransaction: vi.fn(),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    existing: null as Record<string, unknown> | null,
    insertedValues: null as Record<string, unknown> | null,
    updatedSet: null as Record<string, unknown> | null,
    updatedWhereId: null as string | null,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      ledgerTransactions: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existing)),
      },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (vals: Record<string, unknown>) => {
            mockDbState.insertedValues = vals;
            return {
              returning: () => Promise.resolve([{ id: "new-txn-id" }]),
            };
          },
        }),
        update: () => ({
          set: (vals: Record<string, unknown>) => {
            mockDbState.updatedSet = vals;
            return {
              where: () => {
                // Drizzle's WHERE condition object is circular (references
                // its own table) — just record that a WHERE was applied,
                // don't try to serialize it.
                mockDbState.updatedWhereId = "applied";
                return Promise.resolve(undefined);
              },
            };
          },
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getMatchForTransaction } from "@/lib/reconciliation-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id = "txn-1") {
  return { params: Promise.resolve({ id }) };
}

const BASE_TXN = {
  id: "txn-1",
  entityId: "entity-1",
  fundId: "fund-1",
  bankAccountId: "bank-1",
  txnDate: "2026-07-01",
  flow: "expense",
  categoryId: "cat-1",
  amountCents: 10_000,
  party: "Acme Co",
  memo: "Some memo",
  beneficiaryCause: "youth",
  paymentMethod: "debit_card",
  checkNumber: null,
  status: "posted",
  approvedAt: null,
  reconciled: false,
  reconciledSessionId: null,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getMatchForTransaction).mockResolvedValue(null);
  mockDbState.existing = { ...BASE_TXN };
  mockDbState.insertedValues = null;
  mockDbState.updatedSet = null;
  mockDbState.updatedWhereId = null;
});

describe("POST /api/admin/ledger/transactions/[id]/split — auth", () => {
  it("401s when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    expect(res.status).toBe(401);
  });

  it("403s when missing LEDGER_RECORD", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    expect(res.status).toBe(403);
  });

  it("404s when the transaction doesn't exist", async () => {
    mockDbState.existing = null;
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/ledger/transactions/[id]/split — amount validation", () => {
  it("400s an amount <= 0 with the specific message", async () => {
    const res = await POST(makeRequest({ amountCents: 0 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("Enter an amount greater than $0.");
  });

  it("400s a negative amount", async () => {
    const res = await POST(makeRequest({ amountCents: -500 }), makeParams());
    expect(res.status).toBe(400);
  });

  it("400s a non-integer amount", async () => {
    const res = await POST(makeRequest({ amountCents: 12.5 }), makeParams());
    expect(res.status).toBe(400);
  });

  it("400s an amount equal to the current total, with the specific message", async () => {
    const res = await POST(makeRequest({ amountCents: 10_000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe("Split amount must be less than the transaction's current total.");
  });

  it("400s an amount greater than the current total", async () => {
    const res = await POST(makeRequest({ amountCents: 20_000 }), makeParams());
    expect(res.status).toBe(400);
  });

  it("validates against the row's CURRENT amount, not any original historical amount", async () => {
    // Simulate an already-split row: current amount is smaller than what it
    // started as. An amount that would have been valid against a larger
    // historical total must still be rejected against the current one.
    mockDbState.existing = { ...BASE_TXN, amountCents: 3_000 };
    const res = await POST(makeRequest({ amountCents: 3_000 }), makeParams());
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/ledger/transactions/[id]/split — guards", () => {
  it("blocks a transaction with approvedAt set", async () => {
    mockDbState.existing = { ...BASE_TXN, approvedAt: new Date() };
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toBe("Approved transactions cannot be split");
  });

  it("blocks a rejected transaction", async () => {
    mockDbState.existing = { ...BASE_TXN, status: "rejected" };
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toBe("Rejected transactions cannot be split");
  });

  it("blocks a transaction with reconciledSessionId set", async () => {
    mockDbState.existing = { ...BASE_TXN, reconciledSessionId: "session-1" };
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toContain("closed reconciliation session");
  });

  it("blocks a transaction with reconciled=true even when reconciledSessionId is null (legacy toggle case)", async () => {
    mockDbState.existing = { ...BASE_TXN, reconciled: true, reconciledSessionId: null };
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toBe("Reconciled transactions cannot be split");
  });

  it("blocks a transaction matched to a bank line in an open reconciliation session", async () => {
    vi.mocked(getMatchForTransaction).mockResolvedValue({
      id: "match-1",
      transactionId: "txn-1",
      bankLineId: "line-1",
      sessionId: "session-1",
    } as never);
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toBe(
      "This transaction is already matched to a bank line in an open reconciliation session — unmatch it before splitting.",
    );
  });

  it("blocks a transfer leg (transferGroupId set)", async () => {
    mockDbState.existing = { ...BASE_TXN, transferGroupId: "grp-1" };
    const res = await POST(makeRequest({ amountCents: 1000 }), makeParams());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toBe(
      "Transfer transactions can't be split — edit or delete the transfer instead.",
    );
  });
});

describe("POST /api/admin/ledger/transactions/[id]/split — success", () => {
  it("creates a new row and decrements the original, summing to the original amount", async () => {
    const res = await POST(makeRequest({ amountCents: 4_000 }), makeParams());
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.id).toBe("new-txn-id");
    expect(data.newAmountCents).toBe(4_000);
    expect(data.originalAmountCents).toBe(6_000);
    expect(data.newAmountCents + data.originalAmountCents).toBe(BASE_TXN.amountCents);

    // New row inherits every other field from the original
    expect(mockDbState.insertedValues).toMatchObject({
      entityId: BASE_TXN.entityId,
      fundId: BASE_TXN.fundId,
      bankAccountId: BASE_TXN.bankAccountId,
      txnDate: BASE_TXN.txnDate,
      flow: BASE_TXN.flow,
      categoryId: BASE_TXN.categoryId,
      amountCents: 4_000,
      party: BASE_TXN.party,
      memo: BASE_TXN.memo,
      beneficiaryCause: BASE_TXN.beneficiaryCause,
      paymentMethod: BASE_TXN.paymentMethod,
      checkNumber: BASE_TXN.checkNumber,
      status: "posted",
      reconciled: false,
      recordedByUserId: "user-1",
    });
    // No stale provenance/approval fields on the new row
    expect(mockDbState.insertedValues).not.toHaveProperty("approvedAt");
    expect(mockDbState.insertedValues).not.toHaveProperty("reconciledSessionId");

    // Original row decremented by the split amount
    expect(mockDbState.updatedSet).toMatchObject({ amountCents: 6_000 });
  });
});

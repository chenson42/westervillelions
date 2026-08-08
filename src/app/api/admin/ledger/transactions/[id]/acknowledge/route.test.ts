/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/acknowledge —
 * donor_id sync regression (2026-08-08 bug,
 * docs/work-log/2026-08-08-acknowledgment-donor-link.md).
 *
 * Bug: creating an acknowledgment with a donorId set
 * ledger_acknowledgments.donor_id but never ledger_transactions.donor_id.
 * getDonor() and listPendingAcknowledgments() are both keyed off the
 * TRANSACTION's donor_id, so the donor's giving history and name silently
 * vanished even though the acknowledgment record itself had the donor.
 *
 * Covers:
 *   - creating an acknowledgment WITH a donorId sets donor_id on BOTH the
 *     acknowledgment row and the transaction row, in the same db.transaction()
 *   - creating an acknowledgment WITHOUT a donorId leaves the transaction's
 *     existing donor_id untouched (no update issued)
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db — importing
 * the real @/lib/db module throws at import time without DATABASE_URL (see
 * the header comment in src/lib/ledger-queries.test.ts for the same
 * rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    txnRows: [] as unknown[],
    existingAck: undefined as unknown,
    donor: undefined as unknown,
    txnUpdates: [] as { set: Record<string, unknown> }[],
    ackInsertValues: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve(mockDbState.txnRows),
            }),
          }),
        }),
      }),
    })),
    query: {
      ledgerAcknowledgments: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existingAck)),
      },
      ledgerDonors: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.donor)),
      },
    },
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (values: Record<string, unknown>) => ({
            returning: () => {
              mockDbState.ackInsertValues.push(values);
              return Promise.resolve([{ id: "ack-1", ...values }]);
            },
          }),
        }),
        update: () => ({
          set: (set: Record<string, unknown>) => ({
            where: () => {
              mockDbState.txnUpdates.push({ set });
              return Promise.resolve(undefined);
            },
          }),
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "txn-1") {
  return { params: Promise.resolve({ id }) };
}

const FOUNDATION_INCOME_TXN = {
  txn: {
    id: "txn-1",
    flow: "income",
    status: "posted",
    amountCents: 100000, // $1,000 — meets the $250 written-ack threshold
    txnDate: "2026-08-01",
    donorId: null,
  },
  donationsDeductible: true,
  entityName: "Foundation",
  fundName: "Charitable",
};

const DONOR = { id: "donor-1", name: "Trucco Construction Co", email: null };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.txnRows = [FOUNDATION_INCOME_TXN];
  mockDbState.existingAck = undefined;
  mockDbState.donor = DONOR;
  mockDbState.txnUpdates = [];
  mockDbState.ackInsertValues = [];
});

describe("POST .../[id]/acknowledge — donor_id sync (2026-08-08 bug)", () => {
  it("creating an acknowledgment WITH a donorId sets donor_id on the transaction too", async () => {
    const res = await POST(makeRequest({ donorId: "donor-1" }), makeParams("txn-1"));
    expect(res.status).toBe(201);

    // The acknowledgment row carries the donor (already worked pre-fix).
    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].donorId).toBe("donor-1");

    // The transaction row must ALSO carry the donor — this is the fix.
    expect(mockDbState.txnUpdates).toHaveLength(1);
    expect(mockDbState.txnUpdates[0].set.donorId).toBe("donor-1");
  });

  it("creating an acknowledgment WITHOUT a donorId does not touch the transaction's donor_id", async () => {
    const res = await POST(makeRequest({}), makeParams("txn-1"));
    expect(res.status).toBe(201);

    expect(mockDbState.ackInsertValues).toHaveLength(1);
    expect(mockDbState.ackInsertValues[0].donorId).toBeNull();

    // No donor supplied — leave whatever is already linked (or not) alone.
    expect(mockDbState.txnUpdates).toHaveLength(0);
  });

  it("re-acknowledging with a different donorId overwrites the transaction's existing link", async () => {
    mockDbState.txnRows = [
      { ...FOUNDATION_INCOME_TXN, txn: { ...FOUNDATION_INCOME_TXN.txn, donorId: "donor-old" } },
    ];

    const res = await POST(makeRequest({ donorId: "donor-1" }), makeParams("txn-1"));
    expect(res.status).toBe(201);

    expect(mockDbState.txnUpdates).toHaveLength(1);
    expect(mockDbState.txnUpdates[0].set.donorId).toBe("donor-1");
  });
});

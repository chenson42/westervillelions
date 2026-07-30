/**
 * Unit tests for PATCH /api/admin/ledger/transactions/[id] — the
 * bank-account-immutability fix for Transfer/Sweep pairs (DECISION-058,
 * docs/work-log/2026-07-29-ledger-account-transfers.md).
 *
 * Prior to this fix, `?both=true` force-applied an edited `bankAccountId` to
 * BOTH legs of a transfer pair (route.ts:464) — correct under the old
 * same-entity, one-bank-account-per-pair invariant, but silent data
 * corruption the moment a pair can legitimately have two different
 * bankAccountId values (an Account Transfer or a cross-entity Sweep). Fix:
 * bankAccountId is silently ignored (not 400ed) for ANY row with a non-null
 * transferGroupId, regardless of the `both` query param — a wrong choice is
 * corrected by delete+recreate, not edit.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db, and
 * @/lib/receipt-storage — importing the real @/lib/db module throws at
 * import time without DATABASE_URL (see the header comment in
 * src/lib/ledger-queries.test.ts for the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/receipt-storage", () => ({
  RECEIPT_KEY_REGEX: /^receipts\/.+$/,
  getReceiptStorage: vi.fn(() => ({ delete: vi.fn(() => Promise.resolve()) })),
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    existing: null as Record<string, unknown> | null,
    /** Answers the partner-group select in the ?both=true + transferGroupId branch. */
    partnerRows: [] as Record<string, unknown>[],
    updates: [] as { set: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      ledgerTransactions: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existing)),
      },
    },
    select: vi.fn(() => ({
      from: () => {
        const rows = mockDbState.partnerRows;
        const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
        };
        thenable.limit = () => Promise.resolve(rows);
        return {
          where: () => thenable,
        };
      },
    })),
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          mockDbState.updates.push({ set });
          return Promise.resolve(undefined);
        },
      }),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        update: () => ({
          set: (set: Record<string, unknown>) => ({
            where: () => {
              mockDbState.updates.push({ set });
              return Promise.resolve(undefined);
            },
          }),
        }),
      };
      return cb(tx);
    }),
  },
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeRequest(body: unknown, url: string): NextRequest {
  return { json: async () => body, url } as unknown as NextRequest;
}
function makeParams(id = "txn-source") {
  return { params: Promise.resolve({ id }) };
}

const BASE_URL = "http://localhost/api/admin/ledger/transactions/txn-source";

const SWEEP_SOURCE_LEG = {
  id: "txn-source",
  entityId: "entity-club",
  fundId: "fund-activity",
  flow: "expense",
  transferGroupId: "group-1",
  approvedAt: null,
  status: "pending",
  reconciledSessionId: null,
  receiptStorageKey: null,
};

const SWEEP_DEST_LEG = {
  id: "txn-dest",
  approvedAt: null,
  reconciledSessionId: null,
};

const ORDINARY_TXN = {
  id: "txn-ordinary",
  entityId: "entity-club",
  fundId: "fund-admin",
  flow: "expense",
  transferGroupId: null,
  approvedAt: null,
  status: "posted",
  reconciledSessionId: null,
  receiptStorageKey: null,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.existing = null;
  mockDbState.partnerRows = [];
  mockDbState.updates = [];
});

describe("PATCH .../[id] — bank-account immutability for Transfer/Sweep pairs (DECISION-058)", () => {
  it("editing a Sweep pair's amount/date/memo via ?both=true no longer touches bankAccountId on either leg even if the request body includes one", async () => {
    mockDbState.existing = { ...SWEEP_SOURCE_LEG };
    mockDbState.partnerRows = [SWEEP_DEST_LEG];

    const res = await PATCH(
      makeRequest(
        {
          amountCents: 6000,
          txnDate: "2026-08-01",
          memo: "updated memo",
          bankAccountId: "bank-attempted-change",
        },
        `${BASE_URL}?both=true`,
      ),
      makeParams("txn-source"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(2);
    const [targetUpdate, partnerUpdate] = mockDbState.updates;

    // amount/date/memo DID apply to both legs...
    expect(targetUpdate.set.amountCents).toBe(6000);
    expect(targetUpdate.set.txnDate).toBe("2026-08-01");
    expect(targetUpdate.set.memo).toBe("updated memo");
    expect(partnerUpdate.set.amountCents).toBe(6000);
    expect(partnerUpdate.set.txnDate).toBe("2026-08-01");
    expect(partnerUpdate.set.memo).toBe("updated memo");

    // ...but bankAccountId was NOT propagated to either leg's update payload.
    expect("bankAccountId" in targetUpdate.set).toBe(false);
    expect("bankAccountId" in partnerUpdate.set).toBe(false);
  });

  it("attempting to change bankAccountId on a single Sweep/Transfer leg WITHOUT ?both=true is also silently ignored (immutable post-creation for any pair)", async () => {
    mockDbState.existing = { ...SWEEP_SOURCE_LEG };

    const res = await PATCH(
      makeRequest({ memo: "just a memo edit", bankAccountId: "bank-attempted-change" }, BASE_URL),
      makeParams("txn-source"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
    expect("bankAccountId" in mockDbState.updates[0].set).toBe(false);
    expect(mockDbState.updates[0].set.memo).toBe("just a memo edit");
  });

  it("regression: an ordinary (non-pair) transaction's bankAccountId can still be changed normally", async () => {
    mockDbState.existing = { ...ORDINARY_TXN };

    const res = await PATCH(
      makeRequest({ bankAccountId: "bank-new" }, BASE_URL),
      makeParams("txn-ordinary"),
    );

    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
    expect(mockDbState.updates[0].set.bankAccountId).toBe("bank-new");
  });

  it("regression: a blank/missing bankAccountId on a non-pair transaction still 400s", async () => {
    mockDbState.existing = { ...ORDINARY_TXN };

    const res = await PATCH(makeRequest({ bankAccountId: "" }, BASE_URL), makeParams("txn-ordinary"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
    expect(mockDbState.updates).toHaveLength(0);
  });
});

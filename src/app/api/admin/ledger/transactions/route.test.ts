/**
 * Unit tests for POST /api/admin/ledger/transactions — the bank-account
 * requirement added by the default-bank-account bug fix
 * (docs/work-log/2026-07-29-default-bank-account.md).
 *
 * Every ledger transaction must carry a bank account by construction: a
 * missing/blank bankAccountId is rejected with a specific 400, both on the
 * normal transaction path and the transfer path — never silently inserted
 * as NULL (which made rows invisible to reconciliation).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db,
 * @/lib/ledger-queries, and @/lib/email — importing the real @/lib/db module
 * throws at import time without DATABASE_URL (see the header comment in
 * src/lib/ledger-queries.test.ts for the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getSettings: vi.fn(),
  getEmailsForFeature: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    fundRows: [] as unknown[],
    catRows: [] as unknown[],
    insertReturning: [{ id: "txn-1" }] as { id: string }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    // The normal-transaction path chains .where(...).limit(1); the transfer
    // path awaits .where(...) directly (no .limit()). Return a Promise
    // (resolving to the fund rows) augmented with a `.limit()` method that
    // resolves to the same rows, so both call shapes work off one mock.
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const rows = mockDbState.fundRows;
          const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: () => Promise<unknown[]>;
          };
          thenable.limit = () => Promise.resolve(rows);
          return thenable;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: () => ({
        returning: () => Promise.resolve(mockDbState.insertReturning),
      }),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: () => Promise.resolve(undefined),
        }),
      };
      return cb(tx);
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getSettings } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_NORMAL_BODY = {
  entityId: "entity-1",
  fundId: "fund-1",
  txnDate: "2026-07-29",
  flow: "expense" as const,
  amountCents: 1000,
  bankAccountId: "bank-account-1",
};

const VALID_TRANSFER_BODY = {
  transfer: true,
  entityId: "entity-1",
  sourceFundId: "fund-1",
  destFundId: "fund-2",
  txnDate: "2026-07-29",
  amountCents: 1000,
  bankAccountId: "bank-account-1",
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getSettings).mockResolvedValue({
    disbApprovalThresholdCents: 25_000,
  } as never);
  mockDbState.fundRows = [
    { id: "fund-1", kind: "administrative", entityId: "entity-1" },
    { id: "fund-2", kind: "activity", entityId: "entity-1" },
  ];
  mockDbState.catRows = [];
  mockDbState.insertReturning = [{ id: "txn-1" }];
});

describe("POST /api/admin/ledger/transactions — bank account required (default-bank-account bug fix)", () => {
  it("400s a normal transaction with a missing bankAccountId, with the specific message", async () => {
    const { bankAccountId: _omit, ...body } = VALID_NORMAL_BODY;
    void _omit;

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
  });

  it("400s a normal transaction with a blank-string bankAccountId", async () => {
    const res = await POST(makeRequest({ ...VALID_NORMAL_BODY, bankAccountId: "" }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
  });

  it("accepts a normal transaction with a valid bankAccountId (201)", async () => {
    const res = await POST(makeRequest(VALID_NORMAL_BODY));
    expect(res.status).toBe(201);
  });

  it("400s a transfer with a missing bankAccountId", async () => {
    const { bankAccountId: _omit, ...body } = VALID_TRANSFER_BODY;
    void _omit;

    const res = await POST(makeRequest(body));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("Select a bank account before saving this transaction.");
  });

  it("accepts a transfer with a valid bankAccountId (201)", async () => {
    const res = await POST(makeRequest(VALID_TRANSFER_BODY));
    expect(res.status).toBe(201);
  });
});

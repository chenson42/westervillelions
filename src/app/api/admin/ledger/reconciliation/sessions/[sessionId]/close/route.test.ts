/**
 * Unit tests for POST .../close — the account tie-out belt added for B-105 / F1.
 * Hermetic: auth, permissions, reconciliation-queries, reconciliation and
 * @/lib/db are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/reconciliation-queries", () => ({
  getReconciliationSessionById: vi.fn(),
  getTieOutAssembly: vi.fn(),
  getMatchedTransactionIdsForSession: vi.fn(),
}));
vi.mock("@/lib/reconciliation", () => ({
  computeTieOut: vi.fn(),
}));

const { state } = vi.hoisted(() => ({
  state: {
    statusRows: [] as { id: string; status: string; bankAccountId: string }[],
    txUpdates: 0,
    transactionCalls: 0,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(state.statusRows) }),
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      state.transactionCalls++;
      const tx = {
        update: () => ({
          set: () => ({
            where: () => {
              state.txUpdates++;
              return Promise.resolve();
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
import {
  getReconciliationSessionById,
  getTieOutAssembly,
  getMatchedTransactionIdsForSession,
} from "@/lib/reconciliation-queries";
import { computeTieOut } from "@/lib/reconciliation";

function callRoute() {
  return POST({} as NextRequest, { params: Promise.resolve({ sessionId: "session-1" }) });
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getReconciliationSessionById).mockResolvedValue({
    id: "session-1",
    bankAccountId: "account-1",
    status: "open",
    openingBalanceCents: 0,
    closingBalanceCents: 100,
  } as never);
  vi.mocked(getTieOutAssembly).mockResolvedValue({
    unmatchedInPeriodBankLineIds: [],
    matchedLineAmountsCents: [100],
  } as never);
  vi.mocked(computeTieOut).mockReturnValue({
    balanced: true,
    deltaCents: 0,
    closingBalanceCents: 100,
    openingBalanceCents: 0,
    matchedTotalCents: 100,
  } as never);
  state.statusRows = [];
  state.txUpdates = 0;
  state.transactionCalls = 0;
});

describe("POST .../close — matched transactions must sit on the session's account", () => {
  it("400 transaction_account_mismatch naming every offending id, closing nothing — regression for F1 (match-route race lands a cross-entity row in a Foundation session)", async () => {
    vi.mocked(getMatchedTransactionIdsForSession).mockResolvedValue(["txn-a", "txn-b", "txn-c"]);
    state.statusRows = [
      { id: "txn-a", status: "posted", bankAccountId: "account-1" },
      { id: "txn-b", status: "posted", bankAccountId: "club-account" },
      { id: "txn-c", status: "posted", bankAccountId: "club-account" },
    ];
    const res = await callRoute();
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("transaction_account_mismatch");
    expect(body.invalidTransactionIds).toEqual(["txn-b", "txn-c"]);
    expect(state.transactionCalls).toBe(0);
    expect(state.txUpdates).toBe(0);
  });

  it("closes normally when every matched transaction is on the session's account", async () => {
    vi.mocked(getMatchedTransactionIdsForSession).mockResolvedValue(["txn-a"]);
    state.statusRows = [{ id: "txn-a", status: "posted", bankAccountId: "account-1" }];
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: "session-1", status: "closed", clearedCount: 1 });
    expect(state.transactionCalls).toBe(1);
    expect(state.txUpdates).toBe(2);
  });

  it("a not-posted row is still reported as not posted (existing check unchanged)", async () => {
    vi.mocked(getMatchedTransactionIdsForSession).mockResolvedValue(["txn-a"]);
    state.statusRows = [{ id: "txn-a", status: "voided", bankAccountId: "account-1" }];
    const res = await callRoute();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer posted/);
    expect(state.transactionCalls).toBe(0);
  });

  it("closes a session with no matches without querying accounts", async () => {
    vi.mocked(getMatchedTransactionIdsForSession).mockResolvedValue([]);
    const res = await callRoute();
    expect(res.status).toBe(200);
    expect(state.txUpdates).toBe(1);
  });
});

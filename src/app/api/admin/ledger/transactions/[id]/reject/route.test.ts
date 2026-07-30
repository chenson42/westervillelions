/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/reject —
 * pair-aware rejection (DECISION-058,
 * docs/work-log/2026-07-29-ledger-account-transfers.md).
 *
 * Covers:
 *   - rejecting either leg's id updates BOTH rows to status='rejected' with
 *     an identical rejectionReason
 *   - self-rejection block still applies, keyed off the shared recordedByUserId
 *   - rejecting a pair where the partner has drifted off 'pending' → 409
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db —
 * importing the real @/lib/db module throws at import time without
 * DATABASE_URL (see the header comment in src/lib/ledger-queries.test.ts for
 * the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    selectQueue: [] as unknown[][],
    updates: [] as { set: Record<string, unknown> }[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const rows = mockDbState.selectQueue.shift() ?? [];
          const thenable = Promise.resolve(rows) as Promise<unknown[]> & {
            limit: () => Promise<unknown[]>;
          };
          thenable.limit = () => Promise.resolve(rows);
          return thenable;
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

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "txn-source") {
  return { params: Promise.resolve({ id }) };
}

const SOURCE_LEG = {
  id: "txn-source",
  transferGroupId: "group-1",
  status: "pending",
  recordedByUserId: "recorder-1",
};
const DEST_LEG = {
  id: "txn-dest",
  transferGroupId: "group-1",
  status: "pending",
  recordedByUserId: "recorder-1",
};
const ORDINARY_EXPENSE = {
  id: "txn-ordinary",
  transferGroupId: null,
  status: "pending",
  recordedByUserId: "recorder-1",
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "approver-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.selectQueue = [];
  mockDbState.updates = [];
});

describe("POST .../[id]/reject — pair-aware (DECISION-058)", () => {
  it("rejecting either leg's id updates BOTH rows to rejected with an identical rejectionReason", async () => {
    mockDbState.selectQueue.push([SOURCE_LEG], [SOURCE_LEG, DEST_LEG]);

    const res = await POST(
      makeRequest({ reason: "Board declined the sweep at the July meeting." }),
      makeParams("txn-source"),
    );
    expect(res.status).toBe(200);

    expect(mockDbState.updates).toHaveLength(2);
    const [first, second] = mockDbState.updates;
    expect(first.set.status).toBe("rejected");
    expect(second.set.status).toBe("rejected");
    expect(first.set.rejectionReason).toBe("Board declined the sweep at the July meeting.");
    expect(second.set.rejectionReason).toBe("Board declined the sweep at the July meeting.");
  });

  it("self-rejection block still applies, keyed off the shared recordedByUserId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
    mockDbState.selectQueue.push([SOURCE_LEG], [SOURCE_LEG, DEST_LEG]);

    const res = await POST(makeRequest({ reason: "x" }), makeParams("txn-source"));
    expect(res.status).toBe(403);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("409s when the partner leg has already drifted off 'pending'", async () => {
    mockDbState.selectQueue.push([SOURCE_LEG], [SOURCE_LEG, { ...DEST_LEG, status: "rejected" }]);

    const res = await POST(makeRequest({ reason: "x" }), makeParams("txn-source"));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toBe("The paired transaction is no longer pending");
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("400s a missing/blank reason", async () => {
    mockDbState.selectQueue.push([ORDINARY_EXPENSE]);

    const res = await POST(makeRequest({ reason: "   " }), makeParams("txn-ordinary"));
    expect(res.status).toBe(400);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("rejecting an ordinary expense succeeds and touches only one row (no partner)", async () => {
    mockDbState.selectQueue.push([ORDINARY_EXPENSE]);

    const res = await POST(makeRequest({ reason: "Not needed." }), makeParams("txn-ordinary"));
    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
  });
});

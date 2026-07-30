/**
 * Unit tests for POST /api/admin/ledger/transactions/[id]/approve —
 * pair-aware approval (DECISION-058,
 * docs/work-log/2026-07-29-ledger-account-transfers.md).
 *
 * Covers:
 *   - approving either leg's id updates BOTH rows to status='posted' with
 *     identical approvedByUserId/approvedAt/boardMinute
 *   - self-approval block still applies, keyed off the shared recordedByUserId
 *   - approving a pair where the partner has drifted off 'pending' → 409
 *   - approving a Sweep that already has a boardMinute (set at creation) with
 *     a BLANK boardMinute in the request succeeds and PRESERVES the original
 *     value (does not blank it out) — the bug fix
 *   - approving an ordinary large expense (no pre-existing boardMinute) with
 *     a blank boardMinute in the request still 400s — regression, unchanged
 *     for non-pair rows
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
    // First shift: the target txn fetch (.limit(1)). Second shift (only
    // consumed when the target has a transferGroupId): the partner-group
    // fetch (no .limit()), returning ALL rows sharing that group (the route
    // filters out the requested id itself via .find()).
    selectQueue: [] as unknown[][],
    updates: [] as { id: string; set: Record<string, unknown> }[],
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
              // Drizzle's WHERE condition object is circular (references its
              // own table) — just record the `set` payload in call order;
              // tests assert by position (target update first, partner
              // second), not by parsing the WHERE AST for an id.
              mockDbState.updates.push({ id: "", set });
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
  boardMinute: null as string | null,
};
const DEST_LEG = {
  id: "txn-dest",
  transferGroupId: "group-1",
  status: "pending",
  recordedByUserId: "recorder-1",
  boardMinute: null as string | null,
};
const ORDINARY_EXPENSE = {
  id: "txn-ordinary",
  transferGroupId: null,
  status: "pending",
  recordedByUserId: "recorder-1",
  boardMinute: null as string | null,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "approver-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.selectQueue = [];
  mockDbState.updates = [];
});

// The mock's `where()` can't cheaply extract the id passed to eq() from the
// real Drizzle AST, so we track "which id is this update targeting" by the
// ORDER updates are pushed: the route always updates the target id first,
// then the partner (if any) second. Tests assert on `mockDbState.updates`
// length/contents by position rather than by id.

describe("POST .../[id]/approve — pair-aware (DECISION-058)", () => {
  it("approving either leg's id updates BOTH rows to posted with identical approvedByUserId/approvedAt/boardMinute", async () => {
    mockDbState.selectQueue.push(
      [SOURCE_LEG], // target fetch
      [SOURCE_LEG, DEST_LEG], // partner-group fetch
    );

    const res = await POST(
      makeRequest({ boardMinute: "Board approved 2026-07-15, item 4." }),
      makeParams("txn-source"),
    );
    expect(res.status).toBe(200);

    expect(mockDbState.updates).toHaveLength(2);
    const [first, second] = mockDbState.updates;
    expect(first.set.status).toBe("posted");
    expect(second.set.status).toBe("posted");
    expect(first.set.approvedByUserId).toBe("approver-1");
    expect(second.set.approvedByUserId).toBe("approver-1");
    expect(first.set.approvedAt).toBe(second.set.approvedAt);
    expect(first.set.boardMinute).toBe("Board approved 2026-07-15, item 4.");
    expect(second.set.boardMinute).toBe("Board approved 2026-07-15, item 4.");
  });

  it("self-approval block still applies, keyed off the shared recordedByUserId", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
    mockDbState.selectQueue.push([SOURCE_LEG], [SOURCE_LEG, DEST_LEG]);

    const res = await POST(
      makeRequest({ boardMinute: "x" }),
      makeParams("txn-source"),
    );
    expect(res.status).toBe(403);
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("409s when the partner leg has already drifted off 'pending'", async () => {
    mockDbState.selectQueue.push(
      [SOURCE_LEG],
      [SOURCE_LEG, { ...DEST_LEG, status: "posted" }],
    );

    const res = await POST(
      makeRequest({ boardMinute: "x" }),
      makeParams("txn-source"),
    );
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toBe("The paired transaction is no longer pending");
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("409s when the target itself is no longer pending", async () => {
    mockDbState.selectQueue.push([{ ...SOURCE_LEG, status: "posted" }]);

    const res = await POST(makeRequest({ boardMinute: "x" }), makeParams("txn-source"));
    expect(res.status).toBe(409);
  });

  it("approving a Sweep that already has a boardMinute with a BLANK boardMinute in the request succeeds and preserves the original", async () => {
    const sourceWithMinute = { ...SOURCE_LEG, boardMinute: "Board approved 2026-07-15, item 4." };
    const destWithMinute = { ...DEST_LEG, boardMinute: "Board approved 2026-07-15, item 4." };
    mockDbState.selectQueue.push([sourceWithMinute], [sourceWithMinute, destWithMinute]);

    const res = await POST(makeRequest({ boardMinute: "" }), makeParams("txn-source"));
    expect(res.status).toBe(200);

    const [first, second] = mockDbState.updates;
    expect(first.set.boardMinute).toBe("Board approved 2026-07-15, item 4.");
    expect(second.set.boardMinute).toBe("Board approved 2026-07-15, item 4.");
  });

  it("approving a Sweep that already has a boardMinute with NO boardMinute field at all also preserves the original", async () => {
    const sourceWithMinute = { ...SOURCE_LEG, boardMinute: "Board approved 2026-07-15, item 4." };
    const destWithMinute = { ...DEST_LEG, boardMinute: "Board approved 2026-07-15, item 4." };
    mockDbState.selectQueue.push([sourceWithMinute], [sourceWithMinute, destWithMinute]);

    const res = await POST(makeRequest({}), makeParams("txn-source"));
    expect(res.status).toBe(200);
    expect(mockDbState.updates[0].set.boardMinute).toBe("Board approved 2026-07-15, item 4.");
  });

  it("approving an ordinary large expense (no pre-existing boardMinute) with a blank boardMinute still 400s (regression, non-pair rows unchanged)", async () => {
    mockDbState.selectQueue.push([ORDINARY_EXPENSE]);

    const res = await POST(makeRequest({ boardMinute: "" }), makeParams("txn-ordinary"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("boardMinute is required");
    expect(mockDbState.updates).toHaveLength(0);
  });

  it("approving an ordinary expense with a valid boardMinute succeeds and touches only one row (no partner)", async () => {
    mockDbState.selectQueue.push([ORDINARY_EXPENSE]);

    const res = await POST(makeRequest({ boardMinute: "Board OK'd it." }), makeParams("txn-ordinary"));
    expect(res.status).toBe(200);
    expect(mockDbState.updates).toHaveLength(1);
  });
});

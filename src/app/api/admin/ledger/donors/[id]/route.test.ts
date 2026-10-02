/**
 * Unit tests for PATCH /api/admin/ledger/donors/[id] — Donor Multiple Emails
 * (2026-08-08, docs/work-log/2026-08-08-donor-multiple-emails.md).
 *
 * Covers:
 *  - full-list replace round-trip: starting list [a, b], submitting [b, c]
 *    removes a and adds c in one PATCH (the "add/remove round-trips" case
 *    named in the Phase 3 design's minimum test bar)
 *  - invalid address rejected (400), no update issued
 *  - duplicate-within-submitted-list rejected (400), no update issued
 *  - omitting `emails` leaves the stored list untouched (no `emails` key
 *    reaches the UPDATE ... SET)
 *  - `emails: null` clears the list to []
 *  - 404 when the donor doesn't exist
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db. Does NOT
 * mock @/lib/ledger-queries — importing it here only pulls in `getDonor`
 * (used by this route's GET, not exercised in this file), and getDonor's own
 * `@/lib/db` import resolves to the same mock below, so no separate mock is
 * needed (mirrors the acknowledge/route.test.ts precedent of mocking only
 * @/lib/db when that's the only module whose real import would throw).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    existing: { id: "donor-1" } as unknown,
    updateSet: [] as Record<string, unknown>[],
    // DELETE (DECISION-115): results for the transaction's selects, in call
    // order (donor row FOR UPDATE, transaction count, acknowledgment count).
    txSelects: [] as unknown[],
    failAuditInsert: false,
    committed: [] as Array<{ op: string; values?: Record<string, unknown> }>,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const staged: Array<{ op: string; values?: Record<string, unknown> }> = [];
      const next = () => mockDbState.txSelects.shift();
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                Promise.resolve(next()).then(res, rej),
              for: async () => next(),
            }),
          }),
        }),
        delete: () => ({
          where: async () => {
            staged.push({ op: "delete" });
          },
        }),
        insert: (table: unknown) => ({
          values: async (values: Record<string, unknown>) => {
            if (table === schema.ledgerAuditLog && mockDbState.failAuditInsert) {
              throw new Error("audit insert failed");
            }
            staged.push({ op: table === schema.ledgerAuditLog ? "audit" : "insert", values });
          },
        }),
      };
      const result = await cb(tx);
      mockDbState.committed.push(...staged);
      return result;
    },
    query: {
      ledgerDonors: {
        findFirst: vi.fn(() => Promise.resolve(mockDbState.existing)),
      },
      members: {
        findFirst: vi.fn(() => Promise.resolve({ id: "member-1" })),
      },
    },
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            mockDbState.updateSet.push(set);
            return Promise.resolve([{ id: "donor-1", ...set }]);
          },
        }),
      }),
    })),
  },
  };
});

import { PATCH, DELETE } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function makeParams(id = "donor-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "recorder-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  mockDbState.existing = { id: "donor-1" };
  mockDbState.updateSet = [];
  mockDbState.txSelects = [];
  mockDbState.failAuditInsert = false;
  mockDbState.committed = [];
});

describe("PATCH /api/admin/ledger/donors/[id] — emails", () => {
  it("round-trips a full-list replace: [a,b] -> [b,c] removes a and adds c", async () => {
    const res = await PATCH(
      makeRequest({ emails: ["b@example.com", "c@example.com"] }),
      makeParams(),
    );
    expect(res.status).toBe(200);
    expect(mockDbState.updateSet).toHaveLength(1);
    expect(mockDbState.updateSet[0].emails).toEqual(["b@example.com", "c@example.com"]);
  });

  it("rejects a malformed address and does not issue the update", async () => {
    const res = await PATCH(makeRequest({ emails: ["not-an-email"] }), makeParams());
    expect(res.status).toBe(400);
    expect(mockDbState.updateSet).toHaveLength(0);
  });

  it("rejects a case-insensitive duplicate within the submitted list", async () => {
    const res = await PATCH(
      makeRequest({ emails: ["a@example.com", "A@EXAMPLE.COM"] }),
      makeParams(),
    );
    expect(res.status).toBe(400);
    expect(mockDbState.updateSet).toHaveLength(0);
  });

  it("omitting emails leaves the stored list untouched (no emails key in the update)", async () => {
    const res = await PATCH(makeRequest({ address: "123 Main St" }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDbState.updateSet).toHaveLength(1);
    expect(mockDbState.updateSet[0]).not.toHaveProperty("emails");
  });

  it("emails: null clears the list to []", async () => {
    const res = await PATCH(makeRequest({ emails: null }), makeParams());
    expect(res.status).toBe(200);
    expect(mockDbState.updateSet[0].emails).toEqual([]);
  });

  it("404s when the donor does not exist", async () => {
    mockDbState.existing = undefined;
    const res = await PATCH(makeRequest({ emails: ["a@example.com"] }), makeParams("missing"));
    expect(res.status).toBe(404);
    expect(mockDbState.updateSet).toHaveLength(0);
  });

  it("rejects more than 20 addresses in one submission", async () => {
    const emails = Array.from({ length: 21 }, (_, i) => `addr${i}@example.com`);
    const res = await PATCH(makeRequest({ emails }), makeParams());
    expect(res.status).toBe(400);
    expect(mockDbState.updateSet).toHaveLength(0);
  });
});

// ── DELETE — same-transaction `donor_deleted` audit row (DECISION-115) ───────

describe("DELETE /api/admin/ledger/donors/[id]", () => {
  const DONOR_EMAIL = "pat.donor@example.com";
  const deleteParams = () => ({ params: Promise.resolve({ id: "donor-1" }) });
  const queueSelects = (count: [number, number] = [3, 2]) => {
    mockDbState.txSelects = [
      [{ id: "donor-1", name: "Pat Donor", emails: [DONOR_EMAIL], address: "1 Main St" }],
      [{ n: count[0] }],
      [{ n: count[1] }],
    ];
  };
  const del = () => DELETE({} as NextRequest, deleteParams());

  it("403s without ledger.manage and writes nothing", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    queueSelects();

    const res = await del();

    expect(res.status).toBe(403);
    expect(mockDbState.committed).toEqual([]);
  });

  it("writes one audit row in the same transaction, after the delete, with the actor id", async () => {
    queueSelects();

    const res = await del();

    expect(res.status).toBe(204);
    expect(mockDbState.committed.map((c) => c.op)).toEqual(["delete", "audit"]);
    const audit = mockDbState.committed[1].values!;
    expect(audit.actorUserId).toBe("recorder-1");
    expect(audit.action).toBe("donor_deleted");
    expect(audit.targetCategoryId).toBeNull();
    expect(audit.targetTransactionId).toBeNull();
  });

  it("the audit row holds the name and the two counts and none of the donor's emails or address", async () => {
    queueSelects([3, 2]);

    await del();

    const audit = mockDbState.committed[1].values!;
    expect(JSON.parse(audit.before as string)).toEqual({
      donorId: "donor-1",
      name: "Pat Donor",
      linkedTransactionCount: 3,
      linkedAcknowledgmentCount: 2,
    });
    expect(audit.after).toBeNull();
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(DONOR_EMAIL);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("1 Main St");
    expect(audit.details).toBe(
      'Deleted donor "Pat Donor": 3 transactions and 2 acknowledgments were unlinked',
    );
  });

  it("rolls the delete back when the audit insert fails (500, nothing committed)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueSelects();
    mockDbState.failAuditInsert = true;

    const res = await del();

    expect(res.status).toBe(500);
    expect(mockDbState.committed).toEqual([]);
  });

  it("404s when the donor does not exist and writes nothing", async () => {
    mockDbState.txSelects = [[]];

    const res = await del();

    expect(res.status).toBe(404);
    expect(mockDbState.committed).toEqual([]);
  });
});

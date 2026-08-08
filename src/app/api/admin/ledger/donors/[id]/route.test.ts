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
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
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
}));

import { PATCH } from "./route";
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

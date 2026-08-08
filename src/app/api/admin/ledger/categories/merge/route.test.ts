/**
 * Unit tests for POST /api/admin/ledger/categories/merge (Ledger Category
 * Management, 2026-08-07 / DECISION-065/066).
 *
 * Covers Phase 3 test 11 (permission gate, before touching the database)
 * plus the missing-ids validation and the plan/apply response pass-through.
 * Merge's own refusal logic (transaction count, budget-year collision,
 * inactive destination, scope mismatch, lock) is covered at the query layer
 * in src/lib/ledger-category-queries.test.ts (tests 4-7) — this file only
 * proves the route wires auth, input shape, and the mergeCategories result
 * through correctly.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-category-queries (mergeCategories) — importing the real
 * module would pull in @/lib/db, which throws at import time without
 * DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-category-queries", () => ({ mergeCategories: vi.fn() }));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { mergeCategories } from "@/lib/ledger-category-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
});

describe("POST /api/admin/ledger/categories/merge — permission gate", () => {
  it("401s when there is no session, before touching the database", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await POST(makeRequest({ sourceId: "src", destinationId: "dst" }));

    expect(response.status).toBe(401);
    expect(mergeCategories).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_MANAGE, before touching the database", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await POST(makeRequest({ sourceId: "src", destinationId: "dst" }));

    expect(response.status).toBe(403);
    expect(mergeCategories).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/ledger/categories/merge — validation and pass-through", () => {
  it("400s when sourceId/destinationId are missing", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    expect(mergeCategories).not.toHaveBeenCalled();
  });

  it("defaults confirm to false when omitted", async () => {
    vi.mocked(mergeCategories).mockResolvedValueOnce({
      ok: true,
      confirm: false,
      plan: [],
      sourceTransactionCount: 0,
      destinationName: "Member recognition",
    } as never);

    const response = await POST(makeRequest({ sourceId: "src", destinationId: "dst" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.plan).toEqual([]);
    expect(mergeCategories).toHaveBeenCalledWith({
      sourceId: "src",
      destinationId: "dst",
      confirm: false,
      actorUserId: "user-1",
    });
  });

  it("passes confirm:true through and returns the merged response shape", async () => {
    vi.mocked(mergeCategories).mockResolvedValueOnce({
      ok: true,
      confirm: true,
      merged: true,
      destinationId: "dst",
      affectedFiscalYears: [2024, 2026],
    } as never);

    const response = await POST(
      makeRequest({ sourceId: "src", destinationId: "dst", confirm: true }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ merged: true, destinationId: "dst", affectedFiscalYears: [2024, 2026] });
    expect(mergeCategories).toHaveBeenCalledWith({
      sourceId: "src",
      destinationId: "dst",
      confirm: true,
      actorUserId: "user-1",
    });
  });

  it("surfaces a refusal's error and status verbatim", async () => {
    vi.mocked(mergeCategories).mockResolvedValueOnce({
      ok: false,
      error: "This category has 3 transactions — merging categories with transaction history isn't supported yet.",
      status: 409,
    } as never);

    const response = await POST(makeRequest({ sourceId: "src", destinationId: "dst" }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("3 transactions");
  });
});

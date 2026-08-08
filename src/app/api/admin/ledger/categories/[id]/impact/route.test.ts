/**
 * Unit tests for GET /api/admin/ledger/categories/[id]/impact (Ledger
 * Category Management, 2026-08-07 / DECISION-065/066).
 *
 * Covers Phase 3 test 11 (permission gate, before touching the database)
 * plus the 404/200 pass-through.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-category-queries (getCategoryImpact) — importing the real
 * module would pull in @/lib/db, which throws at import time without
 * DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-category-queries", () => ({ getCategoryImpact: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getCategoryImpact } from "@/lib/ledger-category-queries";

function makeParams(id = "cat-1") {
  return { params: Promise.resolve({ id }) };
}

const IMPACT = {
  category: { id: "cat-1", name: "Awards" },
  transactions: { total: 0, postedGivingCents: 0 },
  budgetLines: { total: 0, fiscalYears: [] },
  openBalance: { currentFiscalYear: 2026, hasNonLockedBudgetRow: false, currentFyBudgetedCents: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getCategoryImpact).mockResolvedValue(IMPACT as never);
});

describe("GET /api/admin/ledger/categories/[id]/impact — permission gate", () => {
  it("401s when there is no session, before touching the database", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await GET({} as NextRequest, makeParams());

    expect(response.status).toBe(401);
    expect(getCategoryImpact).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_MANAGE, before touching the database", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await GET({} as NextRequest, makeParams());

    expect(response.status).toBe(403);
    expect(getCategoryImpact).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/ledger/categories/[id]/impact — response", () => {
  it("404s when the category doesn't exist", async () => {
    vi.mocked(getCategoryImpact).mockResolvedValueOnce(null);

    const response = await GET({} as NextRequest, makeParams());

    expect(response.status).toBe(404);
  });

  it("200s with the CategoryImpact payload", async () => {
    const response = await GET({} as NextRequest, makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.category.id).toBe("cat-1");
    expect(getCategoryImpact).toHaveBeenCalledWith("cat-1");
  });
});

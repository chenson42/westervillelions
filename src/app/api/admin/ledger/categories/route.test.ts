/**
 * Unit tests for GET /api/admin/ledger/categories (Ledger Category
 * Management, 2026-08-07 / DECISION-065/066). POST on this route predates
 * this feature and is unchanged/untested here.
 *
 * Covers Phase 3 test 11 (permission gate, before touching the database)
 * plus the entityId-required/entity-not-found validation path.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/ledger-queries
 * (getEntityById — the only function GET calls from it), and
 * @/lib/ledger-category-queries (listCategoriesForAdmin/toCategoryDTO) —
 * importing the real modules would pull in @/lib/db, which throws at import
 * time without DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
// POST (unchanged/untested here) imports @/lib/db directly for the insert —
// mocked so importing the route module doesn't throw without DATABASE_URL.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/ledger-queries", () => ({
  getEntityById: vi.fn(),
  getFunds: vi.fn(),
  getCategories: vi.fn(),
  assertBudgetUnlocked: vi.fn(),
}));
vi.mock("@/lib/ledger-category-queries", () => ({
  listCategoriesForAdmin: vi.fn(),
  toCategoryDTO: (c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name,
    fundKind: c.fundKind,
    flow: c.flow,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    countsAsGiving: c.countsAsGiving,
    form990Line: c.form990Line,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }),
}));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getEntityById } from "@/lib/ledger-queries";
import { listCategoriesForAdmin } from "@/lib/ledger-category-queries";

function makeRequest(query = ""): NextRequest {
  return { url: `http://localhost/api/admin/ledger/categories${query}` } as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getEntityById).mockResolvedValue({ id: "entity-1" } as never);
  vi.mocked(listCategoriesForAdmin).mockResolvedValue([]);
});

describe("GET /api/admin/ledger/categories — permission gate", () => {
  it("401s when there is no session, before touching the database", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await GET(makeRequest("?entityId=entity-1"));

    expect(response.status).toBe(401);
    expect(hasFeature).not.toHaveBeenCalled();
    expect(getEntityById).not.toHaveBeenCalled();
    expect(listCategoriesForAdmin).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_MANAGE, before touching the database", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await GET(makeRequest("?entityId=entity-1"));

    expect(response.status).toBe(403);
    expect(getEntityById).not.toHaveBeenCalled();
    expect(listCategoriesForAdmin).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/ledger/categories — validation", () => {
  it("400s when entityId is missing", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(400);
  });

  it("400s on an invalid fundKind", async () => {
    const response = await GET(makeRequest("?entityId=entity-1&fundKind=bogus"));
    expect(response.status).toBe(400);
  });

  it("404s when the entity doesn't exist", async () => {
    vi.mocked(getEntityById).mockResolvedValueOnce(null);
    const response = await GET(makeRequest("?entityId=entity-1"));
    expect(response.status).toBe(404);
  });

  it("200s and passes includeInactive=true through to listCategoriesForAdmin", async () => {
    const response = await GET(makeRequest("?entityId=entity-1&includeInactive=true"));
    expect(response.status).toBe(200);
    expect(listCategoriesForAdmin).toHaveBeenCalledWith("entity-1", {
      fundKind: undefined,
      flow: undefined,
      includeInactive: true,
    });
  });
});

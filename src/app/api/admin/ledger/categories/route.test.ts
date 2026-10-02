/**
 * Unit tests for GET /api/admin/ledger/categories (Ledger Category
 * Management, 2026-08-07 / DECISION-065/066), plus the POST gate regression
 * for Y9 (DECISION-115): "+ Add category" on the budgeting page was shown to
 * a budget.edit-only user while the route required ledger.manage.
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
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn(), hasAnyFeature: vi.fn() }));
// POST inserts through @/lib/db; the mock records the insert so a test can
// assert that a refused request wrote nothing.
const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertValues(v);
        return { returning: async () => [{ id: "cat-1", isActive: true, ...v }] };
      },
    }),
  },
}));
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

import { GET, POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature, hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById, getFunds, getCategories, assertBudgetUnlocked } from "@/lib/ledger-queries";
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

// ── POST — the Y9 regression (DECISION-115) ──────────────────────────────────
// Holds a set of features; hasAnyFeature / hasFeature answer from it, so a
// "budget.edit-only" caller is modelled exactly.

function holdOnly(...held: string[]) {
  vi.mocked(hasFeature).mockImplementation(async (_u, f) => held.includes(f));
  vi.mocked(hasAnyFeature).mockImplementation(async (_u, fs) => fs.some((f) => held.includes(f)));
}

function postRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return {
    json: async () => ({
      entityId: "entity-1",
      fiscalYear: 2027,
      fundKind: "administrative",
      flow: "expense",
      name: "Postage",
      ...overrides,
    }),
  } as unknown as NextRequest;
}

describe("POST /api/admin/ledger/categories — gate (Y9)", () => {
  beforeEach(() => {
    insertValues.mockReset();
    vi.mocked(getFunds).mockResolvedValue([{ kind: "administrative" }] as never);
    vi.mocked(getCategories).mockResolvedValue([]);
    vi.mocked(assertBudgetUnlocked).mockResolvedValue({ ok: true } as never);
  });

  it("a budget.edit-only caller can create a category", async () => {
    holdOnly(FEATURES.BUDGET_EDIT);

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("a caller with neither key gets a plain-language 403 before any DB read", async () => {
    holdOnly(FEATURES.LEDGER_VIEW);

    const response = await POST(postRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).not.toBe("Forbidden");
    expect(body.error).toMatch(/Budget edit or Ledger management/);
    expect(getEntityById).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("a budget.edit-only caller sending countsAsGiving true, or omitting it, is accepted", async () => {
    holdOnly(FEATURES.BUDGET_EDIT);

    expect((await POST(postRequest({ countsAsGiving: true }))).status).toBe(200);
    expect((await POST(postRequest())).status).toBe(200);
  });

  it("a budget.edit-only caller sending countsAsGiving false gets 403 and nothing is inserted", async () => {
    holdOnly(FEATURES.BUDGET_EDIT);

    const response = await POST(postRequest({ countsAsGiving: false }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/ledger management access/);
    expect(getEntityById).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("a budget.edit-only caller sending a non-empty form990Line gets 403; a blank one is ignored", async () => {
    holdOnly(FEATURES.BUDGET_EDIT);

    expect((await POST(postRequest({ form990Line: "Line 16" }))).status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
    expect((await POST(postRequest({ form990Line: "   " }))).status).toBe(200);
  });

  it("a ledger.manage caller may set both", async () => {
    holdOnly(FEATURES.LEDGER_MANAGE);

    const response = await POST(postRequest({ countsAsGiving: false, form990Line: "Line 16" }));

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ countsAsGiving: false, form990Line: "Line 16" }),
    );
  });

  it("GET stays ledger.manage-only: a budget.edit-only caller is refused", async () => {
    holdOnly(FEATURES.BUDGET_EDIT);

    const response = await GET(makeRequest("?entityId=entity-1"));

    expect(response.status).toBe(403);
    expect(listCategoriesForAdmin).not.toHaveBeenCalled();
  });
});

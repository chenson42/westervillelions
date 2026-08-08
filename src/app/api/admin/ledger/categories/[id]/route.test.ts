/**
 * Unit tests for PATCH /api/admin/ledger/categories/[id] (Ledger Category
 * Management, 2026-08-07 / DECISION-065/066).
 *
 * Covers Phase 3 test 11 (permission gate, before touching the database)
 * and test 12 (empty body -> 400, no audit row / no updateCategory call),
 * plus the name-collision and form990Line-length validation paths.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/ledger-queries
 * (getCategories — the collision-scope lookup), and
 * @/lib/ledger-category-queries (getCategoryById/updateCategory/toCategoryDTO)
 * — importing the real modules would pull in @/lib/db, which throws at
 * import time without DATABASE_URL. @/lib/ledger (validateCategoryEditInput)
 * is left real — it's pure, no DB import.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({ getCategories: vi.fn() }));
vi.mock("@/lib/ledger-category-queries", () => ({
  getCategoryById: vi.fn(),
  updateCategory: vi.fn(),
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

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getCategories } from "@/lib/ledger-queries";
import { getCategoryById, updateCategory } from "@/lib/ledger-category-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function makeParams(id = "cat-1") {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_CATEGORY = {
  id: "cat-1",
  entityId: "entity-1",
  fundKind: "activity",
  flow: "expense",
  name: "Awards",
  form990Line: null,
  sortOrder: 0,
  isActive: true,
  countsAsGiving: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getCategoryById).mockResolvedValue(EXISTING_CATEGORY as never);
  vi.mocked(getCategories).mockResolvedValue([] as never);
  vi.mocked(updateCategory).mockResolvedValue({
    ok: true,
    category: { ...EXISTING_CATEGORY, name: "Member recognition" },
  } as never);
});

describe("PATCH /api/admin/ledger/categories/[id] — permission gate", () => {
  it("401s when there is no session, before touching the database", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await PATCH(makeRequest({ name: "New name" }), makeParams());

    expect(response.status).toBe(401);
    expect(getCategoryById).not.toHaveBeenCalled();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks LEDGER_MANAGE, before touching the database", async () => {
    vi.mocked(hasFeature).mockResolvedValueOnce(false);

    const response = await PATCH(makeRequest({ name: "New name" }), makeParams());

    expect(response.status).toBe(403);
    expect(getCategoryById).not.toHaveBeenCalled();
    expect(updateCategory).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/ledger/categories/[id] — validation", () => {
  it("404s when the category doesn't exist", async () => {
    vi.mocked(getCategoryById).mockResolvedValueOnce(null);

    const response = await PATCH(makeRequest({ name: "New name" }), makeParams());

    expect(response.status).toBe(404);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("test 12: 400s on an empty body (no recognized fields), writes no audit row", async () => {
    const response = await PATCH(makeRequest({}), makeParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("No fields to update.");
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("400s on an empty body even when unrecognized keys are present", async () => {
    const response = await PATCH(makeRequest({ bogusField: "x" }), makeParams());
    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("409s on a case-insensitive name collision, excluding the category's own name", async () => {
    vi.mocked(getCategories).mockResolvedValueOnce([
      { id: "cat-1", name: "Awards" }, // itself — must be excluded
      { id: "cat-2", name: "member recognition" }, // collides case-insensitively
    ] as never);

    const response = await PATCH(makeRequest({ name: "Member Recognition" }), makeParams());

    expect(response.status).toBe(409);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("400s when form990Line exceeds MAX_FORM_990_LINE_LENGTH", async () => {
    const response = await PATCH(
      makeRequest({ form990Line: "x".repeat(121) }),
      makeParams(),
    );
    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("stores form990Line as null when given an empty/whitespace string", async () => {
    await PATCH(makeRequest({ form990Line: "   " }), makeParams());
    expect(updateCategory).toHaveBeenCalledWith(
      "cat-1",
      { form990Line: null },
      "user-1",
    );
  });

  it("400s when countsAsGiving is not a boolean", async () => {
    const response = await PATCH(makeRequest({ countsAsGiving: "yes" }), makeParams());
    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("400s when isActive is not a boolean", async () => {
    const response = await PATCH(makeRequest({ isActive: "yes" }), makeParams());
    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("200s on a valid rename and returns the updated category DTO", async () => {
    const response = await PATCH(makeRequest({ name: "Member recognition" }), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe("Member recognition");
    expect(updateCategory).toHaveBeenCalledWith(
      "cat-1",
      { name: "Member recognition" },
      "user-1",
    );
  });
});

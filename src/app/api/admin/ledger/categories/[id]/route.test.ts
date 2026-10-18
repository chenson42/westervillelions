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
vi.mock("@/lib/ledger-fund-labels-queries", () => ({
  getFundLabels: vi.fn(async () => ({
    administrative: "Administrative Fund",
    activity: "Public Funds",
    charitable: "Charitable Fund",
    scholarship: "Scholarship Fund",
  })),
}));
vi.mock("@/lib/ledger-category-queries", () => ({
  getCategoryById: vi.fn(),
  updateCategory: vi.fn(),
  loadMirrorProjections: vi.fn(async () => new Map()),
  validateMirrorWrite: vi.fn(),
  toCategoryDTO: (c: Record<string, unknown>) => ({
    id: c.id,
    name: c.name,
    fundKind: c.fundKind,
    flow: c.flow,
    sortOrder: c.sortOrder,
    isActive: c.isActive,
    countsAsGiving: c.countsAsGiving,
    ackNotRequired: c.ackNotRequired,
    form990Line: c.form990Line,
    mirrorsCategoryId: c.mirrorsCategoryId ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }),
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getCategories } from "@/lib/ledger-queries";
import { getCategoryById, updateCategory, validateMirrorWrite } from "@/lib/ledger-category-queries";

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
  ackNotRequired: false,
  mirrorsCategoryId: null,
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

  it("400s when ackNotRequired is not a boolean", async () => {
    const response = await PATCH(makeRequest({ ackNotRequired: "yes" }), makeParams());
    expect(response.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("200s on a valid ackNotRequired patch and passes it through to updateCategory", async () => {
    vi.mocked(updateCategory).mockResolvedValueOnce({
      ok: true,
      category: { ...EXISTING_CATEGORY, ackNotRequired: true },
    } as never);

    const response = await PATCH(makeRequest({ ackNotRequired: true }), makeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ackNotRequired).toBe(true);
    expect(updateCategory).toHaveBeenCalledWith(
      "cat-1",
      { ackNotRequired: true },
      "user-1",
    );
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

// ── mirrorsCategoryId (B-172) ────────────────────────────────────────────────

const TARGET_ID = "b0000000-0000-4000-8000-000000000001";
const MIRRORED = { ...EXISTING_CATEGORY, flow: "income", mirrorsCategoryId: TARGET_ID };

describe("PATCH — mirrorsCategoryId", () => {
  beforeEach(() => {
    vi.mocked(validateMirrorWrite).mockResolvedValue({ ok: true });
  });

  it("is 403 without ledger.manage and never reaches the validator", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);
    const res = await PATCH(makeRequest({ mirrorsCategoryId: TARGET_ID }), makeParams());
    expect(res.status).toBe(403);
    expect(validateMirrorWrite).not.toHaveBeenCalled();
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("a malformed id is 400 invalid_mirror", async () => {
    const res = await PATCH(makeRequest({ mirrorsCategoryId: 42 }), makeParams());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_mirror");
    const res2 = await PATCH(makeRequest({ mirrorsCategoryId: "nope" }), makeParams());
    expect(res2.status).toBe(400);
  });

  it("passes each validator verdict through with its status and code", async () => {
    for (const [status, code] of [
      [404, "mirror_target_not_found"],
      [400, "subject_not_public_income"],
      [400, "target_not_foundation_income"],
      [400, "target_inactive"],
      [400, "target_is_self"],
    ] as const) {
      vi.mocked(validateMirrorWrite).mockResolvedValueOnce({ ok: false, status, code, error: code });
      const res = await PATCH(makeRequest({ mirrorsCategoryId: TARGET_ID }), makeParams());
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(code);
    }
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("sets the counterpart through updateCategory", async () => {
    const res = await PATCH(makeRequest({ mirrorsCategoryId: TARGET_ID }), makeParams());
    expect(res.status).toBe(200);
    expect(updateCategory).toHaveBeenCalledWith("cat-1", { mirrorsCategoryId: TARGET_ID }, "user-1");
  });

  it("clearing with null skips the target lookup result and is passed through", async () => {
    vi.mocked(getCategoryById).mockResolvedValue(MIRRORED as never);
    const res = await PATCH(makeRequest({ mirrorsCategoryId: null }), makeParams());
    expect(res.status).toBe(200);
    expect(updateCategory).toHaveBeenCalledWith("cat-1", { mirrorsCategoryId: null }, "user-1");
  });

  it("a mirrored category refuses a changed countsAsGiving or ackNotRequired with 400 mirrored_flag_read_only", async () => {
    vi.mocked(getCategoryById).mockResolvedValue(MIRRORED as never);
    for (const patch of [{ countsAsGiving: false }, { ackNotRequired: true }]) {
      const res = await PATCH(makeRequest(patch), makeParams());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("mirrored_flag_read_only");
    }
    expect(updateCategory).not.toHaveBeenCalled();
  });

  it("a mirrored category still accepts a rename, a 990 line and a flag value it already holds", async () => {
    vi.mocked(getCategoryById).mockResolvedValue(MIRRORED as never);
    expect((await PATCH(makeRequest({ form990Line: "Line 1a" }), makeParams())).status).toBe(200);
    expect((await PATCH(makeRequest({ countsAsGiving: true, ackNotRequired: false }), makeParams())).status).toBe(200);
  });

  it("clearing the counterpart and changing a flag in one request is allowed; setting one and changing a flag is not", async () => {
    vi.mocked(getCategoryById).mockResolvedValue(MIRRORED as never);
    const clear = await PATCH(makeRequest({ mirrorsCategoryId: null, countsAsGiving: false }), makeParams());
    expect(clear.status).toBe(200);
    vi.mocked(getCategoryById).mockResolvedValue({ ...EXISTING_CATEGORY, flow: "income" } as never);
    const set = await PATCH(makeRequest({ mirrorsCategoryId: TARGET_ID, countsAsGiving: false }), makeParams());
    expect(set.status).toBe(400);
  });
});

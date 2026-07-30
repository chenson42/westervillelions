/**
 * Unit tests for PATCH /api/admin/ledger/budgets/annotations — permission
 * gate only (docs/work-log/2026-07-29-budget-permissions.md). Widened from a
 * single LEDGER_MANAGE check to hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT]).
 * The star/note write logic itself (setBudgetCategoryAnnotation) is covered
 * in src/lib/ledger-queries.test.ts.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-queries — importing the real module would pull in @/lib/db,
 * which throws at import time without DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasAnyFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({ setBudgetCategoryAnnotation: vi.fn() }));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { setBudgetCategoryAnnotation } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  fundId: "fund-1",
  fiscalYear: 2026,
  categoryId: "cat-1",
  flow: "expense" as const,
  starred: true,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasAnyFeature).mockReset();
  vi.mocked(setBudgetCategoryAnnotation).mockReset();
});

describe("PATCH /api/admin/ledger/budgets/annotations — permission gate (budget-permissions feature)", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(hasAnyFeature).not.toHaveBeenCalled();
    expect(setBudgetCategoryAnnotation).not.toHaveBeenCalled();
  });

  it("403s when the caller holds neither LEDGER_MANAGE nor BUDGET_EDIT", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(false);

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(hasAnyFeature).toHaveBeenCalledWith("user-1", [
      FEATURES.LEDGER_MANAGE,
      FEATURES.BUDGET_EDIT,
    ]);
    expect(setBudgetCategoryAnnotation).not.toHaveBeenCalled();
  });

  it("a BUDGET_EDIT-only holder (no LEDGER_MANAGE) can write — hasAnyFeature resolves true", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(setBudgetCategoryAnnotation).mockResolvedValueOnce({
      ok: true,
      starred: true,
      note: null,
    });

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ starred: true, note: null });
    expect(setBudgetCategoryAnnotation).toHaveBeenCalled();
  });
});

/**
 * Unit tests for POST /api/admin/ledger/budgets/seed — permission gate only
 * (docs/work-log/2026-07-29-budget-permissions.md). Widened from a single
 * LEDGER_MANAGE check to hasAnyFeature([LEDGER_MANAGE, BUDGET_EDIT]).
 *
 * Scope is deliberately narrow: the seed computation itself
 * (computeSeedFromPriorYear, cause-line seeding, the db.transaction() write
 * loop) is exercised elsewhere; this file only proves (a) unauthenticated
 * callers 401, (b) callers with neither LEDGER_MANAGE nor BUDGET_EDIT 403
 * before any query runs, and (c) a caller who passes the gate reaches
 * business logic (asserted via getEntityById being invoked, using a 404 —
 * "Entity not found" — as the observable signal that the gate let the
 * request through without needing to mock the full seed/transaction path).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/db,
 * @/lib/db/schema, and @/lib/ledger-queries — importing the real modules
 * would pull in @/lib/db, which throws at import time without DATABASE_URL
 * (see src/lib/ledger-queries.test.ts's header comment for the same
 * rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasAnyFeature: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("@/lib/db/schema", () => ({ ledgerCategories: {} }));
vi.mock("@/lib/ledger", () => ({ decideSeedWriteAction: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getEntityById: vi.fn(),
  getFunds: vi.fn(),
  computeSeedFromPriorYear: vi.fn(),
  upsertBudgetLine: vi.fn(),
  upsertBudgetCauseLineForSeed: vi.fn(),
  computeCauseSeedForCategory: vi.fn(),
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  entityId: "entity-1",
  targetFiscalYear: 2026,
  mode: "fill-empty" as const,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasAnyFeature).mockReset();
  vi.mocked(getEntityById).mockReset();
});

describe("POST /api/admin/ledger/budgets/seed — permission gate (budget-permissions feature)", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(hasAnyFeature).not.toHaveBeenCalled();
    expect(getEntityById).not.toHaveBeenCalled();
  });

  it("403s when the caller holds neither LEDGER_MANAGE nor BUDGET_EDIT", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(false);

    const response = await POST(makeRequest(VALID_BODY));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe("Forbidden");
    expect(hasAnyFeature).toHaveBeenCalledWith("user-1", [
      FEATURES.LEDGER_MANAGE,
      FEATURES.BUDGET_EDIT,
    ]);
    expect(getEntityById).not.toHaveBeenCalled();
  });

  it("a BUDGET_EDIT-only holder (no LEDGER_MANAGE) passes the gate and reaches business logic", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(getEntityById).mockResolvedValueOnce(null);

    const response = await POST(makeRequest(VALID_BODY));

    // 404 "Entity not found" is the observable signal that the gate let the
    // request through to getEntityById — not a claim about seed correctness.
    expect(response.status).toBe(404);
    expect(getEntityById).toHaveBeenCalledWith("entity-1");
  });
});

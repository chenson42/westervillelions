/**
 * Unit tests for PATCH /api/admin/ledger/budgets — the two-shape dispatch
 * added by DECISION-052/053 (Increment 2 of
 * docs/work-log/2026-07-28-budgeting-page-redesign.md). Covers Phase 3
 * design's "Unit Tests to Write in Phase 4" item: the 400 when both/neither
 * of annualAmountCents/pendingDelete are present. The underlying
 * upsertBudgetLine/setBudgetLinePendingDelete guard sequences are covered
 * directly in src/lib/ledger-queries.test.ts — this file only exercises the
 * route's own dispatch/shape-validation logic, mocking both query functions.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, and
 * @/lib/ledger-queries (importing the real module would pull in @/lib/db,
 * which throws at import time without DATABASE_URL — see the header comment
 * in src/lib/ledger-queries.test.ts for the same rationale).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  upsertBudgetLine: vi.fn(),
  setBudgetLinePendingDelete: vi.fn(),
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { upsertBudgetLine, setBudgetLinePendingDelete } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_SHAPE = {
  fundId: "fund-1",
  fiscalYear: 2026,
  categoryId: "cat-1",
  flow: "expense" as const,
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(upsertBudgetLine).mockReset();
  vi.mocked(setBudgetLinePendingDelete).mockReset();
});

describe("PATCH /api/admin/ledger/budgets — shape dispatch (DECISION-052/053)", () => {
  it("400s when BOTH annualAmountCents and pendingDelete are present", async () => {
    const response = await PATCH(
      makeRequest({ ...VALID_SHAPE, annualAmountCents: 5_000, pendingDelete: true }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Provide either annualAmountCents or pendingDelete, not both.");
    expect(upsertBudgetLine).not.toHaveBeenCalled();
    expect(setBudgetLinePendingDelete).not.toHaveBeenCalled();
  });

  it("400s when NEITHER annualAmountCents nor pendingDelete is present — same shape-validation message the route already returned for a missing/invalid annualAmountCents", async () => {
    const response = await PATCH(makeRequest({ ...VALID_SHAPE }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe(
      "annualAmountCents must be a non-negative integer, or null to remove the budget",
    );
    expect(upsertBudgetLine).not.toHaveBeenCalled();
    expect(setBudgetLinePendingDelete).not.toHaveBeenCalled();
  });

  it("dispatches Shape B to setBudgetLinePendingDelete and surfaces its 409 reason in the JSON body", async () => {
    vi.mocked(setBudgetLinePendingDelete).mockResolvedValue({
      ok: false,
      error: "This budget is locked. Unlock it to make changes.",
      status: 409,
      reason: "locked",
    });

    const response = await PATCH(makeRequest({ ...VALID_SHAPE, pendingDelete: true }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: "This budget is locked. Unlock it to make changes.",
      reason: "locked",
    });
    expect(setBudgetLinePendingDelete).toHaveBeenCalledWith({
      fundId: "fund-1",
      fiscalYear: 2026,
      categoryId: "cat-1",
      flow: "expense",
      pendingDelete: true,
    });
    expect(upsertBudgetLine).not.toHaveBeenCalled();
  });

  it("Shape A (annualAmountCents) still dispatches to upsertBudgetLine, unchanged", async () => {
    vi.mocked(upsertBudgetLine).mockResolvedValue({ ok: true, action: "upserted", id: "budget-1" });

    const response = await PATCH(makeRequest({ ...VALID_SHAPE, annualAmountCents: 5_000 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ action: "upserted", id: "budget-1" });
    expect(setBudgetLinePendingDelete).not.toHaveBeenCalled();
  });
});

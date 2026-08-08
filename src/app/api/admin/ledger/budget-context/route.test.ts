/**
 * Unit tests for GET /api/admin/ledger/budget-context — Budget Context on
 * Transaction Entry (2026-08-08, DECISION-069/070).
 *
 * Covers Phase 3 named test 13: missing/insufficient permission (BUDGET_VIEW
 * and LEDGER_MANAGE both absent) returns 403, not 200 with an empty payload —
 * the failure mode must be visibly different from "no budget set." Also
 * covers the route's own request-validation contract (fundId/fiscalYear)
 * and the 401/404/200 shape, mirroring the pattern in
 * src/app/api/admin/ledger/budget-notes/route.test.ts.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server (hasAnyFeature), and
 * @/lib/ledger-budget-context-queries (getBudgetContext) — the query
 * module's own behavior is covered by
 * src/lib/ledger-budget-context-queries.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasAnyFeature: vi.fn() }));
vi.mock("@/lib/ledger-budget-context-queries", () => ({ getBudgetContext: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getBudgetContext } from "@/lib/ledger-budget-context-queries";

const FUND_ID = "12345678-1234-1234-1234-123456789012";

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL("https://example.com/api/admin/ledger/budget-context");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString() } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasAnyFeature).mockReset();
  vi.mocked(getBudgetContext).mockReset();
});

describe("GET /api/admin/ledger/budget-context", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "2026" }));

    expect(response.status).toBe(401);
    expect(hasAnyFeature).not.toHaveBeenCalled();
    expect(getBudgetContext).not.toHaveBeenCalled();
  });

  it("test 13: 403s (not 200 with an empty payload) when the caller holds neither BUDGET_VIEW nor LEDGER_MANAGE", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(false);

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "2026" }));

    expect(response.status).toBe(403);
    expect(hasAnyFeature).toHaveBeenCalledWith("user-1", [
      FEATURES.BUDGET_VIEW,
      FEATURES.LEDGER_MANAGE,
    ]);
    expect(getBudgetContext).not.toHaveBeenCalled();
    const body = await response.json();
    // Generic, no data leaked — visibly different in shape from a 200 with
    // categories/lines arrays (even empty ones).
    expect(body).toEqual({ error: "Forbidden" });
    expect(body.categories).toBeUndefined();
  });

  it("400s when fundId is missing", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await GET(makeRequest({ fiscalYear: "2026" }));

    expect(response.status).toBe(400);
    expect(getBudgetContext).not.toHaveBeenCalled();
  });

  it("400s when fundId is not a valid UUID", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await GET(makeRequest({ fundId: "not-a-uuid", fiscalYear: "2026" }));

    expect(response.status).toBe(400);
  });

  it("400s when fiscalYear is missing", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await GET(makeRequest({ fundId: FUND_ID }));

    expect(response.status).toBe(400);
  });

  it("400s when fiscalYear is non-integer", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "2026.5" }));

    expect(response.status).toBe(400);
  });

  it("400s when fiscalYear is out of the 2000-2100 sanity range", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "1999" }));

    expect(response.status).toBe(400);
  });

  it("404s when the fund doesn't exist", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(getBudgetContext).mockResolvedValueOnce(null);

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "2026" }));

    expect(response.status).toBe(404);
  });

  it("200s with the fiscal year, categories, and lines when authorized and the fund exists", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(getBudgetContext).mockResolvedValueOnce({
      fiscalYear: 2026,
      categories: [
        {
          categoryId: "cat-1",
          categoryName: "Awards",
          flow: "expense",
          budgetCents: 50000,
          postedCents: 4000,
          pendingCents: 1500,
        },
      ],
      lines: [],
    });

    const response = await GET(makeRequest({ fundId: FUND_ID, fiscalYear: "2026" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.fiscalYear).toBe(2026);
    expect(body.categories).toHaveLength(1);
    expect(body.lines).toEqual([]);
    expect(getBudgetContext).toHaveBeenCalledWith(FUND_ID, 2026);
  });
});

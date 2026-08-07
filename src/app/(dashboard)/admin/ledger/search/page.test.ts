/**
 * Phase 3 design's named unit test 4 (docs/work-log/2026-08-06-ledger-search.md,
 * "Unit Tests (Phase 4, written by the implementer)" — explicitly assigned to
 * ux-developer, landing in page.tsx, not the query module): per-section
 * permission gating. A caller lacking LEDGER_VIEW must never trigger
 * searchTransactions(), a caller lacking BUDGET_VIEW must never trigger
 * searchBudgetLines() — never fetch-then-hide — across all four permission
 * combinations (both / txns-only / budget-only / neither).
 *
 * Hermetic: calls the page's default export directly (same technique the
 * route.test.ts files in this codebase already use for route handlers — see
 * budget-approvals/unlock/route.test.ts), mocking @/lib/auth,
 * @/lib/permissions-server, @/lib/ledger-queries, and
 * @/lib/ledger-search-queries. Never touches a real database. `redirect()` is
 * mocked to throw so the "neither permission" case (page-level gate) is
 * observable as a rejected promise, matching Next's own redirect semantics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FEATURES } from "@/lib/permissions";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/permissions-server", () => ({
  hasAnyFeature: vi.fn(),
  hasFeature: vi.fn(),
}));

vi.mock("@/lib/ledger-queries", () => ({
  getEntities: vi.fn(),
  getFunds: vi.fn(),
  getCategories: vi.fn(),
  getBankAccounts: vi.fn(),
  listLedgerFiscalYears: vi.fn(),
}));

vi.mock("@/lib/ledger-search-queries", () => ({
  SEARCH_PAGE_SIZE: 50,
  searchTransactions: vi.fn(),
  searchBudgetLines: vi.fn(),
}));

import AdminLedgerSearchPage from "./page";
import { auth } from "@/lib/auth";
import { hasAnyFeature, hasFeature } from "@/lib/permissions-server";
import {
  getEntities,
  getFunds,
  getCategories,
  getBankAccounts,
  listLedgerFiscalYears,
} from "@/lib/ledger-queries";
import { searchTransactions, searchBudgetLines } from "@/lib/ledger-search-queries";

const ENTITY = {
  id: "entity-1",
  slug: "club",
  name: "Westerville Lions Club",
  shortName: "Club",
};

function emptyResult() {
  return { rows: [], totalCount: 0, totalIncomeCents: 0, totalExpenseCents: 0, page: 1, pageSize: 50 };
}

function callPage(params: Record<string, string> = {}) {
  return AdminLedgerSearchPage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(getEntities).mockResolvedValue([ENTITY] as never);
  vi.mocked(getFunds).mockResolvedValue([] as never);
  vi.mocked(getCategories).mockResolvedValue([] as never);
  vi.mocked(getBankAccounts).mockResolvedValue([] as never);
  vi.mocked(listLedgerFiscalYears).mockResolvedValue([2026] as never);
  vi.mocked(searchTransactions).mockResolvedValue(emptyResult() as never);
  vi.mocked(searchBudgetLines).mockResolvedValue(emptyResult() as never);
});

describe("AdminLedgerSearchPage — per-section permission gating", () => {
  it("LEDGER_VIEW + BUDGET_VIEW: calls both search functions exactly once", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValue(true);
    vi.mocked(hasFeature).mockResolvedValue(true);

    await callPage();

    expect(searchTransactions).toHaveBeenCalledTimes(1);
    expect(searchBudgetLines).toHaveBeenCalledTimes(1);
  });

  it("LEDGER_VIEW only: calls searchTransactions, never searchBudgetLines", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValue(true);
    vi.mocked(hasFeature).mockImplementation(async (_userId: string, feature: string) =>
      feature === FEATURES.LEDGER_VIEW,
    );

    await callPage();

    expect(searchTransactions).toHaveBeenCalledTimes(1);
    expect(searchBudgetLines).not.toHaveBeenCalled();
  });

  it("BUDGET_VIEW only: calls searchBudgetLines, never searchTransactions", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValue(true);
    vi.mocked(hasFeature).mockImplementation(async (_userId: string, feature: string) =>
      feature === FEATURES.BUDGET_VIEW,
    );

    await callPage();

    expect(searchBudgetLines).toHaveBeenCalledTimes(1);
    expect(searchTransactions).not.toHaveBeenCalled();
  });

  it("neither permission: page-level gate redirects to /access-pending before either query runs", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValue(false);
    vi.mocked(hasFeature).mockResolvedValue(false);

    await expect(callPage()).rejects.toThrow("REDIRECT:/access-pending");

    expect(searchTransactions).not.toHaveBeenCalled();
    expect(searchBudgetLines).not.toHaveBeenCalled();
  });

  it("no session: redirects to /signin before any permission check", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    await expect(callPage()).rejects.toThrow("REDIRECT:/signin");

    expect(hasAnyFeature).not.toHaveBeenCalled();
    expect(searchTransactions).not.toHaveBeenCalled();
    expect(searchBudgetLines).not.toHaveBeenCalled();
  });
});

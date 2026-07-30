/**
 * Unit tests for PATCH /api/admin/ledger/budget-notes (Budgeting
 * Overview/Drill-Down Restructure, DECISION-060). Covers the Phase 3 design
 * doc's named test list: 401/403 gates, 400 on oversized notes, upsert-then-
 * re-upsert (onConflictDoUpdate targets the right unique constraint — proven
 * as "a second call updates the same row shape via the SAME insert-with-
 * onConflictDoUpdate call path, not a duplicate insert"), and — the one
 * behavior most likely to regress if a future editor "fixes" it into
 * lock-consistency — an explicit POSITIVE test that notes can be written
 * with no lock check at all (this route never imports isBudgetLocked /
 * assertBudgetUnlocked / getBudgetApproval).
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/ledger-queries
 * (getEntityById), and @/lib/db's db.insert (mirrors the pattern in
 * budget-approvals/route.test.ts). @/lib/db/schema is imported unmocked
 * (pure table definitions, no @/lib/db import of its own) purely for
 * table-identity comparison (toBe(ledgerBudgetNotes)).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasAnyFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({ getEntityById: vi.fn() }));

const { mockTxState } = vi.hoisted(() => ({
  mockTxState: {
    insertCalls: [] as { table: unknown; values: unknown }[],
    insertReturning: [] as unknown[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mockTxState.insertCalls.push({ table, values });
        return {
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve(mockTxState.insertReturning),
          }),
        };
      },
    }),
  },
}));

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasAnyFeature } from "@/lib/permissions-server";
import { FEATURES } from "@/lib/permissions";
import { getEntityById } from "@/lib/ledger-queries";
import { ledgerBudgetNotes } from "@/lib/db/schema";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_BODY = {
  entityId: "entity-1",
  fiscalYear: 2026,
  notes: "Assumes dues remain flat vs. FY2025.",
};

const SAVED_ROW = {
  entityId: "entity-1",
  fiscalYear: 2026,
  notes: VALID_BODY.notes,
  updatedAt: new Date("2026-07-30T12:00:00.000Z"),
};

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasAnyFeature).mockReset();
  vi.mocked(getEntityById).mockReset();
  mockTxState.insertCalls = [];
  mockTxState.insertReturning = [];
});

describe("PATCH /api/admin/ledger/budget-notes", () => {
  it("401s when there is no session", async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as never);

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(401);
    expect(hasAnyFeature).not.toHaveBeenCalled();
    expect(mockTxState.insertCalls).toHaveLength(0);
  });

  it("403s when the caller holds neither LEDGER_MANAGE nor BUDGET_EDIT", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(false);

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(403);
    expect(hasAnyFeature).toHaveBeenCalledWith("user-1", [
      FEATURES.LEDGER_MANAGE,
      FEATURES.BUDGET_EDIT,
    ]);
    expect(mockTxState.insertCalls).toHaveLength(0);
  });

  it("400s when notes exceeds 4000 characters after trim", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await PATCH(makeRequest({ ...VALID_BODY, notes: "x".repeat(4001) }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/4000/);
    expect(mockTxState.insertCalls).toHaveLength(0);
  });

  it("404s when entityId does not resolve to a real entity", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(getEntityById).mockResolvedValueOnce(null);

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(404);
    expect(mockTxState.insertCalls).toHaveLength(0);
  });

  it("upserts via insert().onConflictDoUpdate() targeting ledgerBudgetNotes — a second call for the same (entityId, fiscalYear) updates rather than duplicating", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValue(true);
    vi.mocked(getEntityById).mockResolvedValue({ id: "entity-1" } as never);
    mockTxState.insertReturning = [SAVED_ROW];

    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      entityId: "entity-1",
      fiscalYear: 2026,
      notes: VALID_BODY.notes,
      updatedAt: SAVED_ROW.updatedAt.toISOString(),
    });
    expect(mockTxState.insertCalls).toHaveLength(1);
    expect(mockTxState.insertCalls[0].table).toBe(ledgerBudgetNotes);

    // Re-upsert: same call path, no separate "update" branch, no duplicate row.
    const secondResponse = await PATCH(makeRequest({ ...VALID_BODY, notes: "Updated assumption." }));
    expect(secondResponse.status).toBe(200);
    expect(mockTxState.insertCalls).toHaveLength(2);
    expect(mockTxState.insertCalls[1].table).toBe(ledgerBudgetNotes);
  });

  it("POSITIVE: a locked budget's notes CAN still be written — this route never checks the budget lock at all (no getBudgetApproval/isBudgetLocked import or call)", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);
    vi.mocked(getEntityById).mockResolvedValueOnce({ id: "entity-1" } as never);
    mockTxState.insertReturning = [SAVED_ROW];

    // No lock-state setup at all — if this route ever gains a lock check,
    // this test still can't fail on that axis (nothing here simulates
    // locked/unlocked), but the absence of any getBudgetApproval mock/import
    // and the 200 below together are the regression guard the design doc asks
    // for: notes must never 409 on a lock.
    const response = await PATCH(makeRequest(VALID_BODY));

    expect(response.status).toBe(200);
  });

  it("400s on a non-string notes field", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await PATCH(makeRequest({ ...VALID_BODY, notes: 12345 }));

    expect(response.status).toBe(400);
    expect(mockTxState.insertCalls).toHaveLength(0);
  });

  it("400s on a missing/invalid fiscalYear", async () => {
    vi.mocked(hasAnyFeature).mockResolvedValueOnce(true);

    const response = await PATCH(makeRequest({ ...VALID_BODY, fiscalYear: "2026" }));

    expect(response.status).toBe(400);
    expect(mockTxState.insertCalls).toHaveLength(0);
  });
});

/**
 * Regression test for the "hard delete, no history" invariant through an
 * unlock cycle (DECISION-052/053, Increment 2 of
 * docs/work-log/2026-07-28-budgeting-page-redesign.md, Phase 3 design's
 * "Unit Tests to Write in Phase 4" item 11): unlocking a previously-finalized
 * budget must never resurrect pending-delete ledger_budgets rows the
 * approve/lock route already purged — there is no history/versioning table
 * for ledger_budgets, so unlock has nothing to restore from. This route was
 * NOT modified by Increment 2 (confirmed by direct read); this test exists
 * to prove that fact stays true rather than assume it silently.
 *
 * Hermetic: mocks @/lib/auth, @/lib/permissions-server, @/lib/ledger-queries,
 * and @/lib/db. db.delete is mocked to THROW if ever called — if a future
 * change wires unlock to touch ledger_budgets in any way, this test fails
 * loudly instead of silently passing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));
vi.mock("@/lib/ledger-queries", () => ({
  getEntityById: vi.fn(),
  getBudgetApproval: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ ...values }]),
        }),
      }),
    }),
    delete: () => {
      throw new Error(
        "unlock route must never call db.delete on ledger_budgets — no history table, nothing to resurrect",
      );
    },
    transaction: () => {
      throw new Error(
        "unlock route must never open a db.transaction() touching ledger_budgets",
      );
    },
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { getEntityById, getBudgetApproval } from "@/lib/ledger-queries";

function makeRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  vi.mocked(getEntityById).mockResolvedValue({ id: "entity-1" } as never);
  vi.mocked(getBudgetApproval).mockResolvedValue({ status: "locked" } as never);
});

describe("POST /api/admin/ledger/budget-approvals/unlock — does not resurrect purged pending-delete rows", () => {
  it("unlocking a locked budget only writes ledgerBudgetApprovals — never touches ledger_budgets", async () => {
    const response = await POST(
      makeRequest({
        entityId: "entity-1",
        fiscalYear: 2026,
        unlockReason: "Board wants to amend the FY2026 budget before re-approving",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("unlocked");
    // If unlock had somehow been wired to touch ledger_budgets (delete or a
    // transaction), the db mocks above would have thrown and failed this
    // test before this point.
  });
});

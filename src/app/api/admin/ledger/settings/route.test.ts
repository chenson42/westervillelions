/**
 * PATCH /api/admin/ledger/settings — gate, validation, no-op, and the
 * same-transaction `ledger_settings_updated` audit row (DECISION-115). The
 * disbursement approval threshold gates the recorder's own large spend, which
 * is why a change to it is recorded. The mock `db.transaction` discards staged
 * writes when the callback throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const STORED = {
  id: "settings-1",
  philanthropyVisibility: "board",
  treasurerBonded: false,
  reserveWarnThresholdCents: 2500000,
  disbApprovalThresholdCents: 25000,
  retentionYears: 7,
  holdingPeriodWarnDays: 365,
};

const { state } = vi.hoisted(() => ({
  state: {
    current: undefined as Record<string, unknown> | undefined,
    failAuditInsert: false,
    committed: [] as Array<{ op: string; values: Record<string, unknown> }>,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const staged: Array<{ op: string; values: Record<string, unknown> }> = [];
        const tx = {
          select: () => ({
            from: () => ({
              limit: () => ({ for: async () => (state.current ? [state.current] : []) }),
            }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: async () => {
                  staged.push({ op: "update", values });
                  return [{ ...state.current, ...values }];
                },
              }),
            }),
          }),
          insert: (table: unknown) => ({
            values: async (values: Record<string, unknown>) => {
              if (table === schema.ledgerAuditLog && state.failAuditInsert) throw new Error("audit insert failed");
              staged.push({ op: table === schema.ledgerAuditLog ? "audit" : "insert", values });
            },
          }),
        };
        const result = await cb(tx);
        state.committed.push(...staged);
        return result;
      },
    },
  };
});

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(auth).mockResolvedValue({ user: { id: "actor-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  state.current = { ...STORED };
  state.failAuditInsert = false;
  state.committed = [];
});

describe("PATCH /api/admin/ledger/settings", () => {
  it("403s without ledger.manage and writes nothing", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await PATCH(makeRequest({ treasurerBonded: true }));

    expect(res.status).toBe(403);
    expect(state.committed).toEqual([]);
  });

  it("400s when no field is provided", async () => {
    const res = await PATCH(makeRequest({}));

    expect(res.status).toBe(400);
    expect(state.committed).toEqual([]);
  });

  it("writes one audit row in the same transaction with the actor id", async () => {
    const res = await PATCH(makeRequest({ disbApprovalThresholdCents: 50000 }));

    expect(res.status).toBe(200);
    expect(state.committed.map((c) => c.op)).toEqual(["update", "audit"]);
    const audit = state.committed[1].values;
    expect(audit.actorUserId).toBe("actor-1");
    expect(audit.action).toBe("ledger_settings_updated");
    expect(audit.targetCategoryId).toBeNull();
    expect(audit.targetTransactionId).toBeNull();
  });

  it("the audit row lists only the changed keys with old and new values", async () => {
    await PATCH(
      makeRequest({
        disbApprovalThresholdCents: 50000,
        treasurerBonded: false, // equals the stored value: not a change
        holdingPeriodWarnDays: 365, // equals the stored value: not a change
      }),
    );

    const audit = state.committed[1].values;
    expect(JSON.parse(audit.before as string)).toEqual({ disbApprovalThresholdCents: 25000 });
    expect(JSON.parse(audit.after as string)).toEqual({ disbApprovalThresholdCents: 50000 });
    expect(audit.details).toBe("Ledger settings changed: disbApprovalThresholdCents");
    expect(state.committed[0].values).not.toHaveProperty("treasurerBonded");
  });

  it("rolls the change back when the audit insert fails (500, staged update discarded)", async () => {
    state.failAuditInsert = true;

    const res = await PATCH(makeRequest({ treasurerBonded: true }));

    expect(res.status).toBe(500);
    expect(state.committed).toEqual([]);
  });

  it("writes no write and no audit row on a no-op and still returns the settings", async () => {
    const res = await PATCH(makeRequest({ treasurerBonded: false, philanthropyVisibility: "board" }));

    expect(res.status).toBe(200);
    expect((await res.json()).settings).toMatchObject({ id: "settings-1" });
    expect(state.committed).toEqual([]);
  });
});

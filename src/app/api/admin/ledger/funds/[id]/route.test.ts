/**
 * PATCH /api/admin/ledger/funds/[id] — gate, no-op, and the same-transaction
 * `fund_updated` audit row (DECISION-115). The mock `db.transaction` stages
 * writes and discards them when the callback throws, so "the change rolls back
 * when the audit insert fails" is observable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { state } = vi.hoisted(() => ({
  state: {
    precheck: { id: "fund-1" } as unknown,
    locked: [{ id: "fund-1", name: "Administrative Fund", openingBalanceCents: 100000 }] as unknown[],
    failAuditInsert: false,
    committed: [] as Array<{ op: string; values: Record<string, unknown> }>,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  return {
    db: {
      query: { ledgerFunds: { findFirst: vi.fn(async () => state.precheck) } },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const staged: Array<{ op: string; values: Record<string, unknown> }> = [];
        const tx = {
          select: () => ({
            from: () => ({ where: () => ({ for: async () => state.locked }) }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: async () => {
                staged.push({ op: "update", values });
              },
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
        state.committed.push(...staged); // only reached when the callback did not throw
        return result;
      },
    },
  };
});

import { PATCH } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const params = { params: Promise.resolve({ id: "fund-1" }) };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(auth).mockResolvedValue({ user: { id: "actor-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  state.precheck = { id: "fund-1" };
  state.locked = [{ id: "fund-1", name: "Administrative Fund", openingBalanceCents: 100000 }];
  state.failAuditInsert = false;
  state.committed = [];
});

describe("PATCH /api/admin/ledger/funds/[id]", () => {
  it("403s without ledger.manage and writes nothing", async () => {
    vi.mocked(hasFeature).mockResolvedValue(false);

    const res = await PATCH(makeRequest({ name: "X" }), params);

    expect(res.status).toBe(403);
    expect(state.committed).toEqual([]);
  });

  it("writes one audit row in the same transaction with the actor id and the changed fields", async () => {
    const res = await PATCH(makeRequest({ openingBalanceCents: 250000 }), params);

    expect(res.status).toBe(200);
    const ops = state.committed.map((c) => c.op);
    expect(ops).toEqual(["update", "audit"]);
    expect(state.committed[0].values).toMatchObject({ openingBalanceCents: 250000 });
    expect(state.committed[0].values).not.toHaveProperty("name");
    const audit = state.committed[1].values;
    expect(audit.actorUserId).toBe("actor-1");
    expect(audit.action).toBe("fund_updated");
    expect(audit.targetCategoryId).toBeNull();
    expect(audit.targetTransactionId).toBeNull();
    expect(JSON.parse(audit.before as string)).toEqual({ fundId: "fund-1", openingBalanceCents: 100000 });
    expect(JSON.parse(audit.after as string)).toEqual({ fundId: "fund-1", openingBalanceCents: 250000 });
    expect(audit.details).toContain("Administrative Fund");
  });

  it("rolls the change back when the audit insert fails (500, staged update discarded)", async () => {
    state.failAuditInsert = true;

    const res = await PATCH(makeRequest({ name: "Renamed" }), params);

    expect(res.status).toBe(500);
    expect(state.committed).toEqual([]);
  });

  it("writes no write and no audit row on a no-op (values equal the stored ones) and still answers 200", async () => {
    const res = await PATCH(makeRequest({ name: "Administrative Fund", openingBalanceCents: 100000 }), params);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "fund-1" });
    expect(state.committed).toEqual([]);
  });

  it("404s for an unknown fund", async () => {
    state.precheck = undefined;

    const res = await PATCH(makeRequest({ name: "X" }), params);

    expect(res.status).toBe(404);
  });
});

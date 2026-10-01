/**
 * T26: the reconcile toggle may not strip a closed reconciliation session's
 * lock (DECISION-109 / architect R3b, DECISION-111 item 3).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions-server", () => ({ hasFeature: vi.fn() }));

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectQueue: [] as unknown[][],
    updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
    updateReturning: [{ id: "x" }] as unknown[],
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const rows = dbState.selectQueue.shift() ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          dbState.updates.push({ set, where });
          return { returning: () => Promise.resolve(dbState.updateReturning) };
        },
      }),
    }),
  },
}));

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/permissions-server";
import { CLOSED_SESSION_LOCK_MESSAGE } from "@/lib/ledger-transaction-lock";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const req = (reconciled: boolean) => ({ json: async () => ({ reconciled }) }) as unknown as NextRequest;
const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(hasFeature).mockResolvedValue(true);
  dbState.selectQueue = [];
  dbState.updates = [];
  dbState.updateReturning = [{ id: ID }];
});

describe("POST .../reconcile (T26)", () => {
  it.each([true, false])("a session-owned row is 403 in direction reconciled=%s, with no write", async (dir) => {
    dbState.selectQueue = [[{ id: ID, status: "posted", reconciledSessionId: "session-1" }]];
    const res = await POST(req(dir), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(CLOSED_SESSION_LOCK_MESSAGE);
    expect(dbState.updates).toHaveLength(0);
  });

  it("a legacy-only row still toggles and still writes reconciledSessionId: null", async () => {
    dbState.selectQueue = [[{ id: ID, status: "posted", reconciledSessionId: null }]];
    const res = await POST(req(true), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ID, reconciled: true });
    expect(dbState.updates).toHaveLength(1);
    expect(dbState.updates[0].set).toMatchObject({ reconciled: true, reconciledSessionId: null });
    expect(dbState.updates[0].set.reconciledAt).toBeInstanceOf(Date);
  });

  it("the UPDATE where pins the refusal: id AND reconciled_session_id is null", async () => {
    dbState.selectQueue = [[{ id: ID, status: "posted", reconciledSessionId: null }]];
    await POST(req(false), params);
    const q = new PgDialect().sqlToQuery(dbState.updates[0].where as SQL);
    expect(q.sql).toContain('"ledger_transactions"."id" = $1');
    expect(q.sql).toContain('"ledger_transactions"."reconciled_session_id" is null');
    expect(q.params).toEqual([ID]);
  });

  it("when the pinned UPDATE returns no row, a row that became session-owned is 403", async () => {
    dbState.selectQueue = [
      [{ id: ID, status: "posted", reconciledSessionId: null }],
      [{ reconciledSessionId: "session-2" }],
    ];
    dbState.updateReturning = [];
    const res = await POST(req(true), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(CLOSED_SESSION_LOCK_MESSAGE);
  });

  it("when the pinned UPDATE returns no row, a row that is gone is 404", async () => {
    dbState.selectQueue = [[{ id: ID, status: "posted", reconciledSessionId: null }], []];
    dbState.updateReturning = [];
    const res = await POST(req(true), params);
    expect(res.status).toBe(404);
  });

  it("a missing row is 404 and a non-posted row is still 400", async () => {
    dbState.selectQueue = [[]];
    expect((await POST(req(true), params)).status).toBe(404);
    dbState.selectQueue = [[{ id: ID, status: "pending", reconciledSessionId: null }]];
    expect((await POST(req(true), params)).status).toBe(400);
  });

  it("401 and 403 gates are unchanged", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await POST(req(true), params)).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { id: "u" } } as never);
    vi.mocked(hasFeature).mockResolvedValue(false);
    expect((await POST(req(true), params)).status).toBe(403);
  });
});

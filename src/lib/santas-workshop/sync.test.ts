import { describe, expect, it, vi } from "vitest";
import threeTickets from "@/lib/zeffy/__fixtures__/payment-three-tickets.json";
import { ZeffyError, ZeffyRateLimitedError } from "@/lib/zeffy/client";
import type { ApplyResult } from "./payment-apply";
import { countApplyResult, newSyncCursor, runSyncStep, type SyncDeps } from "./sync";
import { emptyCounts, parseSyncCursor } from "./sync-cursor";

vi.mock("@/lib/db", () => ({ db: {} }));

const NOW = new Date("2026-12-18T12:00:00Z");
const SESSION = { id: "sess-1", zeffyCampaignId: "campaign-practice-01" };
const pay = (id: string, over: Record<string, unknown> = {}) => ({ ...threeTickets, id, ...over });
const applied = (over: Partial<Extract<ApplyResult, { result: "applied" }>> = {}): ApplyResult => ({
  result: "applied", orderId: "o", orderCreated: false, created: 0, updated: 0, unchanged: 3, flaggedMissing: 0, orderChanged: false, refundChanged: false, ...over,
});

function makeDeps(over: Partial<SyncDeps> = {}) {
  const clock = { t: NOW.getTime() };
  const deps = {
    client: {
      listPayments: vi.fn(async () => ({ payments: [], hasMore: false, nextCursor: null, discarded: 0 })),
      getPayment: vi.fn(async () => ({ gone: false as const, outOfScope: false as const, payment: pay("x") })),
    },
    apply: vi.fn(async () => applied()),
    markDeleted: vi.fn(async () => true),
    loadStaleOrders: vi.fn(async () => []),
    now: () => new Date(clock.t),
    ...over,
  } as unknown as SyncDeps & { client: { listPayments: ReturnType<typeof vi.fn>; getPayment: ReturnType<typeof vi.fn> }; apply: ReturnType<typeof vi.fn>; markDeleted: ReturnType<typeof vi.fn>; loadStaleOrders: ReturnType<typeof vi.fn> };
  return { deps, clock };
}

describe("countApplyResult", () => {
  it("classifies each result", () => {
    const c = emptyCounts();
    countApplyResult(c, applied({ orderCreated: true, created: 3 }));
    countApplyResult(c, applied({ updated: 1 }));
    countApplyResult(c, applied());
    countApplyResult(c, applied({ refundChanged: true, orderChanged: true }));
    countApplyResult(c, { result: "stale" });
    countApplyResult(c, { result: "no_registrants" });
    countApplyResult(c, { result: "not_succeeded" });
    expect(c).toEqual({ newFromZeffy: 1, changed: 2, unchanged: 2, goneInZeffy: 0, refundDiffers: 1, skipped: 2 });
  });
});

describe("runSyncStep", () => {
  it("refuses a session with no connected campaign", async () => {
    const { deps } = makeDeps();
    await expect(runSyncStep({ id: "s", zeffyCampaignId: null }, null, deps)).rejects.toBeInstanceOf(ZeffyError);
  });

  it("pulls the session's campaign only, status succeeded, 100 per page", async () => {
    const { deps } = makeDeps();
    await runSyncStep(SESSION, null, deps);
    expect(deps.client.listPayments).toHaveBeenCalledWith({ campaignId: "campaign-practice-01", startingAfter: null, limit: 100, status: "succeeded" });
  });

  it("pages through the list, applies each payment with source sync, then finishes with the stale phase", async () => {
    const { deps } = makeDeps();
    deps.client.listPayments
      .mockResolvedValueOnce({ payments: [pay("p1"), pay("p2")], hasMore: true, nextCursor: "p2", discarded: 0 })
      .mockResolvedValueOnce({ payments: [pay("p3")], hasMore: false, nextCursor: null, discarded: 0 });
    deps.apply.mockResolvedValueOnce(applied({ orderCreated: true })).mockResolvedValue(applied());
    const out = await runSyncStep(SESSION, null, deps);
    expect(deps.client.listPayments.mock.calls[1][0].startingAfter).toBe("p2");
    expect(deps.apply).toHaveBeenCalledTimes(3);
    expect(deps.apply.mock.calls[0][1]).toMatchObject({ sessionId: "sess-1", source: "sync" });
    expect(out.done).toBe(true);
    expect(out.cursor).toBeNull();
    expect(out.progress.counts).toMatchObject({ newFromZeffy: 1, unchanged: 2 });
    expect(out.progress.processed).toBe(3);
  });

  it("a payment missing items[] in the list falls back to a per-payment fetch", async () => {
    const { deps } = makeDeps();
    const bare = { ...pay("p1") } as Record<string, unknown>;
    delete bare.items;
    deps.client.listPayments.mockResolvedValueOnce({ payments: [bare], hasMore: false, nextCursor: null, discarded: 0 });
    await runSyncStep(SESSION, null, deps);
    expect(deps.client.getPayment).toHaveBeenCalledWith("p1");
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });

  it("stops at the time budget and returns a cursor to resume from", async () => {
    const { deps, clock } = makeDeps({ budgetMs: 1000 });
    deps.client.listPayments.mockImplementation(async () => {
      clock.t += 2000; // a slow page
      return { payments: [pay("p1")], hasMore: true, nextCursor: "p1", discarded: 0 };
    });
    const out = await runSyncStep(SESSION, null, deps);
    expect(out.done).toBe(false);
    expect(out.cursor).toMatchObject({ phase: "list", startingAfter: "p1", processed: 1 });
    expect(deps.client.listPayments).toHaveBeenCalledTimes(1);
  });

  it("resumes from a posted cursor, keeping the counts", async () => {
    const { deps } = makeDeps();
    const cursor = { ...newSyncCursor(NOW), startingAfter: "p9", processed: 9, counts: { ...emptyCounts(), changed: 4 } };
    const out = await runSyncStep(SESSION, cursor, deps);
    expect(deps.client.listPayments.mock.calls[0][0].startingAfter).toBe("p9");
    expect(out.progress.counts.changed).toBe(4);
    expect(out.progress.processed).toBe(9);
  });

  it("the stale phase fetches orders the list did not touch; a 404 flags goneInZeffy", async () => {
    const { deps } = makeDeps();
    deps.loadStaleOrders
      .mockResolvedValueOnce([{ id: "o1", zeffyPaymentId: "pay-a" }, { id: "o2", zeffyPaymentId: "pay-b" }])
      .mockResolvedValueOnce([]);
    deps.client.getPayment.mockResolvedValueOnce({ gone: true }).mockResolvedValueOnce({ gone: false, outOfScope: false, payment: pay("pay-b") });
    const out = await runSyncStep(SESSION, null, deps);
    expect(deps.markDeleted).toHaveBeenCalledWith("pay-a", expect.any(Date));
    expect(deps.apply).toHaveBeenCalledTimes(1);
    expect(out.progress.counts.goneInZeffy).toBe(1);
    expect(deps.loadStaleOrders.mock.calls[1][2]).toBe("o2"); // advanced past the last handled id
    expect(deps.loadStaleOrders.mock.calls[0][1]).toEqual(new Date(newSyncCursor(NOW).startedAt));
  });

  it("a rate limit is a normal state: the cursor comes back with retryAfterMs, nothing is thrown", async () => {
    const { deps } = makeDeps();
    deps.client.listPayments.mockRejectedValueOnce(new ZeffyRateLimitedError(60_000));
    const out = await runSyncStep(SESSION, null, deps);
    expect(out).toMatchObject({ done: false, retryAfterMs: 60_000 });
    expect(out.cursor).not.toBeNull();
  });

  it("other Zeffy errors propagate to the route", async () => {
    const { deps } = makeDeps();
    deps.client.listPayments.mockRejectedValueOnce(new ZeffyError("not_configured"));
    await expect(runSyncStep(SESSION, null, deps)).rejects.toMatchObject({ code: "not_configured" });
  });

  it("an unparseable payment is skipped, not fatal", async () => {
    const { deps } = makeDeps();
    deps.client.listPayments.mockResolvedValueOnce({ payments: [{ id: "p1", items: [] }], hasMore: false, nextCursor: null, discarded: 0 });
    const out = await runSyncStep(SESSION, null, deps);
    expect(out.progress.counts.skipped).toBe(1);
    expect(deps.apply).not.toHaveBeenCalled();
  });
});

describe("parseSyncCursor", () => {
  const good = { startedAt: NOW.toISOString(), phase: "list", startingAfter: null, staleAfterId: null, counts: emptyCounts(), processed: 0 };
  it("accepts no cursor and a good cursor", () => {
    expect(parseSyncCursor(null)).toEqual({ ok: true, cursor: null });
    expect(parseSyncCursor({})).toEqual({ ok: true, cursor: null });
    expect(parseSyncCursor({ cursor: null })).toEqual({ ok: true, cursor: null });
    expect(parseSyncCursor({ cursor: good })).toMatchObject({ ok: true, cursor: { phase: "list" } });
  });
  it("rejects a tampered cursor", () => {
    for (const bad of [
      { ...good, startedAt: "yesterday" },
      { ...good, phase: "other" },
      { ...good, startingAfter: 5 },
      { ...good, staleAfterId: "not-a-uuid" },
      { ...good, processed: -1 },
      { ...good, counts: { ...good.counts, changed: "many" } },
      { ...good, counts: {} },
      "string",
    ]) {
      expect(parseSyncCursor({ cursor: bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

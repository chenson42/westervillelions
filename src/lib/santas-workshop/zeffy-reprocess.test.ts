import { beforeEach, describe, expect, it, vi } from "vitest";
import threeTickets from "@/lib/zeffy/__fixtures__/payment-three-tickets.json";
import { toSnapshot } from "@/lib/zeffy/snapshot";
import type { ConsumerDeps } from "./zeffy-consumer";

const { events } = vi.hoisted(() => ({ events: { row: null as Record<string, unknown> | null, finished: [] as unknown[] } }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/zeffy/events-queries", () => ({
  getZeffyEvent: async () => events.row,
  finishZeffyEvent: async (_id: string, patch: unknown) => {
    events.finished.push(patch);
  },
}));

import { reprocessEvent, reprocessPayment } from "./zeffy-reprocess";

const NOW = new Date("2026-11-10T12:00:00Z");
const snap = (() => {
  const r = toSnapshot(threeTickets);
  if (!r.ok) throw new Error("fixture");
  return r.snapshot;
})();

function makeDeps(over: Partial<ConsumerDeps> = {}) {
  return {
    findSessionByCampaign: vi.fn(async () => ({ id: "sess-1" })),
    findOrderByPayment: vi.fn(async () => null),
    fetchPayment: vi.fn(async () => ({ gone: false as const, outOfScope: false as const, payment: threeTickets })),
    apply: vi.fn(async () => ({ result: "applied" as const, orderId: "o", orderCreated: true, created: 3, updated: 0, unchanged: 0, flaggedMissing: 0, orderChanged: true, refundChanged: false })),
    markPaymentDeleted: vi.fn(async () => true),
    apiKeyConfigured: () => true,
    now: () => NOW,
    ...over,
  } as unknown as ConsumerDeps & { apply: ReturnType<typeof vi.fn>; fetchPayment: ReturnType<typeof vi.fn>; findOrderByPayment: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  events.row = null;
  events.finished = [];
});

describe("reprocessEvent", () => {
  it("reports a missing event", async () => {
    expect(await reprocessEvent("nope", makeDeps())).toEqual({ found: false });
  });

  it("re-applies the stored snapshot (no Zeffy call) at the event's dispatch time and updates the log row", async () => {
    events.row = { id: "e1", sessionId: "sess-1", paymentId: "p", campaignId: "campaign-practice-01", payload: snap, dispatchedAt: new Date("2026-11-09T10:00:00Z"), receivedAt: new Date("2026-11-09T10:00:01Z") };
    const deps = makeDeps();
    const out = await reprocessEvent("e1", deps);
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.apply.mock.calls[0][1]).toEqual({ sessionId: "sess-1", source: "webhook", fetchedAt: new Date("2026-11-09T10:00:00Z") });
    expect(out).toEqual({ found: true, result: { outcome: "processed", code: "applied" } });
    expect(events.finished[0]).toMatchObject({ outcome: "processed", sessionId: "sess-1" });
  });

  it("re-fetches when no snapshot was stored", async () => {
    events.row = { id: "e2", sessionId: null, paymentId: "pay-1", campaignId: null, payload: null, dispatchedAt: null, receivedAt: NOW };
    const deps = makeDeps();
    const out = await reprocessEvent("e2", deps);
    expect(deps.fetchPayment).toHaveBeenCalledWith("pay-1");
    expect(out).toMatchObject({ found: true, result: { outcome: "processed" } });
  });

  it("a stale stored snapshot is reported, not forced (Reprocess can never un-refund)", async () => {
    events.row = { id: "e3", sessionId: "sess-1", paymentId: "p", campaignId: "c", payload: snap, dispatchedAt: new Date("2026-01-01T00:00:00Z"), receivedAt: NOW };
    const deps = makeDeps();
    deps.apply.mockResolvedValue({ result: "stale" });
    expect(await reprocessEvent("e3", deps)).toMatchObject({ result: { outcome: "processed", code: "stale_snapshot" } });
  });

  it("a malformed stored payload is invalid, an event with neither payload nor payment id is invalid", async () => {
    events.row = { id: "e4", sessionId: "sess-1", paymentId: null, campaignId: null, payload: { junk: true }, dispatchedAt: null, receivedAt: NOW };
    expect(await reprocessEvent("e4", makeDeps())).toMatchObject({ result: { outcome: "invalid", code: "bad_payload" } });
    events.row = { id: "e5", sessionId: null, paymentId: null, campaignId: null, payload: null, dispatchedAt: null, receivedAt: NOW };
    expect(await reprocessEvent("e5", makeDeps())).toMatchObject({ result: { outcome: "invalid", code: "no_payment_id" } });
  });

  it("a database failure while re-applying is failed, not thrown", async () => {
    events.row = { id: "e6", sessionId: "sess-1", paymentId: "p", campaignId: "c", payload: snap, dispatchedAt: NOW, receivedAt: NOW };
    const deps = makeDeps();
    deps.apply.mockRejectedValue(new Error("boom"));
    expect(await reprocessEvent("e6", deps)).toMatchObject({ result: { outcome: "failed", code: "db_error" } });
  });
});

describe("reprocessPayment", () => {
  const session = { id: "sess-1", zeffyCampaignId: "campaign-practice-01" };

  it("applies a payment of the session's own form", async () => {
    const deps = makeDeps();
    expect(await reprocessPayment(session, "pay-1", deps)).toMatchObject({ outcome: "processed" });
    expect(deps.apply.mock.calls[0][1].sessionId).toBe("sess-1");
  });

  it("refuses a payment of another form", async () => {
    const deps = makeDeps();
    deps.fetchPayment.mockResolvedValue({ gone: false, outOfScope: false, payment: { ...threeTickets, campaign_id: "campaign-other" } });
    expect(await reprocessPayment(session, "pay-1", deps)).toMatchObject({ outcome: "ignored_unmapped", code: "campaign_mismatch" });
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("refuses an order that lives in another session", async () => {
    const deps = makeDeps();
    deps.findOrderByPayment.mockResolvedValue({ id: "o", sessionId: "sess-2" });
    expect(await reprocessPayment(session, "pay-1", deps)).toEqual({ outcome: "failed", code: "session_mismatch" });
  });
});

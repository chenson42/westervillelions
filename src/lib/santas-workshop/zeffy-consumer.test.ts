import { beforeEach, describe, expect, it, vi } from "vitest";
import threeTickets from "@/lib/zeffy/__fixtures__/payment-three-tickets.json";
import { ZeffyError } from "@/lib/zeffy/client";
import type { ZeffyEnvelope } from "@/lib/zeffy/types";
import type { ApplyResult } from "./payment-apply";
import { createSantasWorkshopConsumer, fetchAndApply, type ConsumerDeps } from "./zeffy-consumer";

vi.mock("@/lib/db", () => ({ db: {} }));

const NOW = new Date("2026-11-09T15:00:00Z");
const DISPATCHED = "2026-11-09T14:59:00.000Z";
const SESSION = { id: "sess-1" };
const APPLIED: ApplyResult = { result: "applied", orderId: "o1", orderCreated: true, created: 3, updated: 0, unchanged: 0, flaggedMissing: 0, orderChanged: true, refundChanged: false };

let order: { calls: string[] };
let deps: ConsumerDeps & {
  findSessionByCampaign: ReturnType<typeof vi.fn>;
  findOrderByPayment: ReturnType<typeof vi.fn>;
  fetchPayment: ReturnType<typeof vi.fn>;
  apply: ReturnType<typeof vi.fn>;
  markPaymentDeleted: ReturnType<typeof vi.fn>;
};

const event = (type: string, data: unknown): ZeffyEnvelope => ({ id: "evt-1", type, version: 1, dispatchedAt: DISPATCHED, data });
const ctx = { now: NOW, attempt: 1 };
const found = (over: Record<string, unknown> = {}) => ({ gone: false as const, outOfScope: false as const, payment: { ...threeTickets, ...over } });

beforeEach(() => {
  order = { calls: [] };
  deps = {
    findSessionByCampaign: vi.fn(async (c: string) => (c === "campaign-practice-01" ? SESSION : null)),
    findOrderByPayment: vi.fn(async () => null),
    fetchPayment: vi.fn(async () => {
      order.calls.push("fetch");
      return found();
    }),
    apply: vi.fn(async () => {
      order.calls.push("apply");
      return APPLIED;
    }),
    markPaymentDeleted: vi.fn(async () => true),
    apiKeyConfigured: () => true,
    now: () => NOW,
  };
});

const consumer = () => createSantasWorkshopConsumer(deps);

describe("event types", () => {
  it.each(["payment.created", "contact.created", "contact.updated", "contact.deleted", "something.else"])("%s is ignored_type with no lookups", async (type) => {
    const r = await consumer().handle(event(type, { id: "x" }), ctx);
    expect(r).toEqual({ outcome: "ignored_type", code: "type_not_handled" });
    expect(deps.findSessionByCampaign).not.toHaveBeenCalled();
    expect(deps.fetchPayment).not.toHaveBeenCalled();
  });
});

describe("payment.completed", () => {
  it("an unmapped campaign is ignored_unmapped: ids only, no payload, nothing applied", async () => {
    const r = await consumer().handle(event("payment.completed", { ...threeTickets, campaign_id: "campaign-white-cane" }), ctx);
    expect(r).toEqual({ outcome: "ignored_unmapped", code: "unmapped_campaign", campaignId: "campaign-white-cane" });
    expect(JSON.stringify(r)).not.toContain("example.invalid");
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.fetchPayment).not.toHaveBeenCalled();
  });

  it("an unseen payment on a mapped campaign applies the EMBEDDED payload at dispatchedAt, with no Zeffy call", async () => {
    const r = await consumer().handle(event("payment.completed", threeTickets), ctx);
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.apply).toHaveBeenCalledTimes(1);
    const [snapshot, opts] = deps.apply.mock.calls[0];
    expect(snapshot.paymentId).toBe(threeTickets.id);
    expect(opts).toEqual({ sessionId: "sess-1", source: "webhook", fetchedAt: new Date(DISPATCHED) });
    expect(r).toMatchObject({ outcome: "processed", code: "applied", sessionId: "sess-1", campaignId: "campaign-practice-01" });
    // the stored payload is the whitelisted snapshot
    const payload = JSON.stringify((r as { payload: unknown }).payload);
    expect(payload).toContain("paymentId");
    expect(payload).not.toContain("Example Street");
  });

  it("a known payment is RE-FETCHED and the fetched snapshot applied", async () => {
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    const r = await consumer().handle(event("payment.completed", threeTickets), ctx);
    expect(order.calls).toEqual(["fetch", "apply"]);
    expect(deps.apply.mock.calls[0][1]).toMatchObject({ sessionId: "sess-1", fetchedAt: NOW });
    expect(r).toMatchObject({ outcome: "processed" });
  });

  it("a payload that is not a payment is invalid (permanent)", async () => {
    expect(await consumer().handle(event("payment.completed", { nope: true }), ctx)).toEqual({ outcome: "invalid", code: "bad_payment" });
    expect(await consumer().handle(event("payment.completed", { ...threeTickets, campaign_id: undefined }), ctx)).toEqual({ outcome: "invalid", code: "no_campaign" });
  });

  it("pending and failed payments are processed with code not_succeeded", async () => {
    deps.apply.mockResolvedValue({ result: "not_succeeded" });
    expect(await consumer().handle(event("payment.completed", { ...threeTickets, status: "pending" }), ctx)).toMatchObject({ outcome: "processed", code: "not_succeeded" });
  });

  it("a database failure is a retryable failed outcome, with a code and no message", async () => {
    deps.apply.mockRejectedValue(new Error("connection reset: payload text with parent.one@example.invalid"));
    const r = await consumer().handle(event("payment.completed", threeTickets), ctx);
    expect(r).toEqual({ outcome: "failed", code: "db_error" });
  });

  it("an apply session_mismatch is failed (the admin sees it)", async () => {
    deps.apply.mockResolvedValue({ result: "session_mismatch" });
    expect(await consumer().handle(event("payment.completed", threeTickets), ctx)).toMatchObject({ outcome: "failed", code: "session_mismatch" });
  });

  it("a purged session is a permanent processed outcome, not a retry loop", async () => {
    deps.apply.mockResolvedValue({ result: "purged" });
    const r = await consumer().handle(event("payment.completed", threeTickets), ctx);
    expect(r).toMatchObject({ outcome: "processed", code: "purged_session" });
    expect((r as { payload?: unknown }).payload).toBeUndefined();
  });
});

describe("payment.updated / payment.deleted (id only: a refund is a notification -> fetch)", () => {
  const ref = { id: threeTickets.id, object: "payment" };

  it("a refund notification on a known payment fetches, then applies the FETCHED snapshot (Zeffy call before apply)", async () => {
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    deps.fetchPayment.mockImplementation(async () => {
      order.calls.push("fetch");
      return found({ refund_status: "full", refunds: [{ id: "r", amount: 4500, status: "succeeded" }] });
    });
    const r = await consumer().handle(event("payment.updated", ref), ctx);
    expect(order.calls).toEqual(["fetch", "apply"]);
    const snapshot = deps.apply.mock.calls[0][0];
    expect(snapshot).toMatchObject({ refundStatus: "full", refundedCents: 4500 });
    expect(deps.apply.mock.calls[0][1].fetchedAt).toEqual(NOW);
    expect(r).toMatchObject({ outcome: "processed", sessionId: "sess-1" });
  });

  it("our state follows the fetched snapshot, not the notification (a stale apply is processed, not an error)", async () => {
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    deps.apply.mockResolvedValue({ result: "stale" });
    expect(await consumer().handle(event("payment.updated", ref), ctx)).toMatchObject({ outcome: "processed", code: "stale_snapshot" });
  });

  it("a 404 on fetch flags the payment deleted", async () => {
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    deps.fetchPayment.mockResolvedValue({ gone: true });
    const r = await consumer().handle(event("payment.deleted", ref), ctx);
    expect(deps.markPaymentDeleted).toHaveBeenCalledWith(threeTickets.id, NOW);
    expect(deps.apply).not.toHaveBeenCalled();
    expect(r).toMatchObject({ outcome: "processed", code: "payment_deleted", sessionId: "sess-1" });
  });

  it("deleted for an unseen payment stores nothing and makes no Zeffy call", async () => {
    const r = await consumer().handle(event("payment.deleted", ref), ctx);
    expect(r).toEqual({ outcome: "ignored_unmapped", code: "unknown_payment" });
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.markPaymentDeleted).not.toHaveBeenCalled();
  });

  it("updated for an unknown payment on a MAPPED campaign fetches and applies (heals a missed completed)", async () => {
    const r = await consumer().handle(event("payment.updated", ref), ctx);
    expect(order.calls).toEqual(["fetch", "apply"]);
    expect(deps.apply.mock.calls[0][1].sessionId).toBe("sess-1");
    expect(r).toMatchObject({ outcome: "processed", sessionId: "sess-1" });
  });

  it("updated for an unknown payment on an UNMAPPED campaign discards it, recording only the campaign id", async () => {
    deps.fetchPayment.mockResolvedValue(found({ campaign_id: "campaign-white-cane" }));
    const r = await consumer().handle(event("payment.updated", ref), ctx);
    expect(r).toEqual({ outcome: "ignored_unmapped", code: "unmapped_campaign", campaignId: "campaign-white-cane" });
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("updated for an unknown payment that Zeffy no longer has is ignored", async () => {
    deps.fetchPayment.mockResolvedValue({ gone: true });
    deps.markPaymentDeleted.mockResolvedValue(false);
    expect(await consumer().handle(event("payment.updated", ref), ctx)).toEqual({ outcome: "ignored_unmapped", code: "unknown_payment" });
  });

  it("without an API key the event fails with no_api_key (Zeffy retries; the admin sets the key and Reprocesses)", async () => {
    deps.apiKeyConfigured = () => false;
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    const r = await consumer().handle(event("payment.updated", ref), ctx);
    expect(r).toMatchObject({ outcome: "failed", code: "no_api_key" });
    expect(deps.fetchPayment).not.toHaveBeenCalled();
  });

  it.each([
    [new ZeffyError("rate_limited", 429), "zeffy_rate_limited"],
    [new ZeffyError("unavailable", 503), "zeffy_unavailable"],
    [new ZeffyError("unauthorized", 401), "zeffy_unauthorized"],
    [new ZeffyError("bad_response", 200), "zeffy_error"],
  ])("a Zeffy fetch error (%s) is a retryable failed outcome with code %s", async (error, code) => {
    deps.findOrderByPayment.mockResolvedValue({ id: "o1", sessionId: "sess-1" });
    deps.fetchPayment.mockRejectedValue(error);
    expect(await consumer().handle(event("payment.updated", ref), ctx)).toMatchObject({ outcome: "failed", code });
  });

  it("an event without a payment id is invalid", async () => {
    expect(await consumer().handle(event("payment.updated", {}), ctx)).toEqual({ outcome: "invalid", code: "no_payment_id" });
  });

  it("the Zeffy call is never made while apply is running (fetch resolves before apply starts)", async () => {
    let applying = false;
    deps.apply.mockImplementation(async () => {
      applying = true;
      await Promise.resolve();
      applying = false;
      return APPLIED;
    });
    deps.fetchPayment.mockImplementation(async () => {
      expect(applying).toBe(false);
      return found();
    });
    await consumer().handle(event("payment.updated", ref), ctx);
    await consumer().handle(event("payment.updated", ref), ctx);
  });
});

describe("fetchAndApply with an expected campaign (Reprocess payment)", () => {
  it("never applies a payment that belongs to another form", async () => {
    deps.fetchPayment.mockResolvedValue(found({ campaign_id: "campaign-other" }));
    const out = await fetchAndApply("pay", deps, { knownSessionId: "sess-1", source: "sync", expectedCampaignId: "campaign-practice-01" });
    expect(out.result).toMatchObject({ outcome: "ignored_unmapped", code: "campaign_mismatch" });
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("applies when the campaign matches", async () => {
    const out = await fetchAndApply("pay", deps, { knownSessionId: "sess-1", source: "sync", expectedCampaignId: "campaign-practice-01" });
    expect(out.result).toMatchObject({ outcome: "processed" });
  });
});

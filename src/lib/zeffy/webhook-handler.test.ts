import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTerminalOutcome } from "./event-outcomes";
import { signZeffyBody } from "./test-helpers";
import {
  handleZeffyWebhook,
  WEBHOOK_MAX_BODY_BYTES,
  type ClaimInput,
  type ConsumerResult,
  type FinishPatch,
  type ZeffyConsumer,
  type ZeffyEventRecord,
  type ZeffyEventStore,
} from "./webhook-handler";

const SECRET = "whsec_devexample";
const NOW = new Date("2026-11-09T15:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
const enc = (s: string) => new TextEncoder().encode(s);

/** In-memory ZeffyEventStore with the same dedupe rule as the database one. */
class MemoryStore implements ZeffyEventStore {
  rows = new Map<string, ZeffyEventRecord & { payload: unknown }>();
  async claim(input: ClaimInput) {
    const existing = this.rows.get(input.id);
    if (existing) {
      if (isTerminalOutcome(existing.outcome)) return { record: existing, alreadyTerminal: true };
      existing.attempts += 1;
      return { record: existing, alreadyTerminal: false };
    }
    const row = {
      id: input.id,
      type: input.type,
      version: String(input.version),
      paymentId: input.paymentId,
      campaignId: input.campaignId,
      sessionId: null,
      outcome: "received",
      errorCode: null,
      attempts: 1,
      payload: null as unknown,
    };
    this.rows.set(input.id, row);
    return { record: row, alreadyTerminal: false };
  }
  async finish(id: string, patch: FinishPatch) {
    const row = this.rows.get(id);
    if (!row) throw new Error("missing");
    row.outcome = patch.outcome;
    row.errorCode = patch.errorCode ?? null;
    row.sessionId = patch.sessionId ?? null;
    if (patch.campaignId) row.campaignId = patch.campaignId;
    row.payload = patch.payload ?? null;
  }
}

function envelope(over: Record<string, unknown> = {}) {
  return {
    id: "evt-0001",
    type: "payment.completed",
    version: 1,
    dispatchedAt: NOW.toISOString(),
    data: { id: "pay-1", campaign_id: "camp-1", status: "succeeded" },
    ...over,
  };
}

let store: MemoryStore;
let consumer: ZeffyConsumer & { handle: ReturnType<typeof vi.fn> };

function send(body: string | Uint8Array, opts: { header?: string | null; secret?: string | undefined; t?: number } = {}) {
  const bytes = typeof body === "string" ? enc(body) : body;
  return handleZeffyWebhook({
    rawBody: bytes,
    signatureHeader: opts.header !== undefined ? opts.header : signZeffyBody(SECRET, bytes, opts.t ?? T),
    now: NOW,
    secret: "secret" in opts ? opts.secret : SECRET,
    store,
    consumers: [consumer],
  });
}

const mapped: ConsumerResult = { outcome: "processed", code: "applied", sessionId: "sess-1", campaignId: "camp-1", payload: { paymentId: "pay-1" } };

beforeEach(() => {
  store = new MemoryStore();
  consumer = { handle: vi.fn(async () => mapped) };
});

describe("handleZeffyWebhook: rejection", () => {
  it("bad signature -> 400 and nothing written", async () => {
    const res = await send(JSON.stringify(envelope()), { header: `t=${T},v1=${"0".repeat(64)}` });
    expect(res).toEqual({ status: 400, body: { error: "bad_request" } });
    expect(store.rows.size).toBe(0);
    expect(consumer.handle).not.toHaveBeenCalled();
  });

  it("stale timestamp -> 400", async () => {
    const res = await send(JSON.stringify(envelope()), { t: T - 301 });
    expect(res.status).toBe(400);
    expect(store.rows.size).toBe(0);
  });

  it("body over 256 KB -> 400 even when correctly signed", async () => {
    const big = JSON.stringify(envelope({ data: { pad: "x".repeat(WEBHOOK_MAX_BODY_BYTES) } }));
    const res = await send(big);
    expect(res.status).toBe(400);
    expect(store.rows.size).toBe(0);
  });

  it("malformed JSON after a valid signature -> 400", async () => {
    expect((await send("{not json")).status).toBe(400);
    expect((await send(new Uint8Array([0xc3, 0x28]))).status).toBe(400);
    expect(store.rows.size).toBe(0);
  });

  it("an envelope without an id -> 400", async () => {
    expect((await send(JSON.stringify(envelope({ id: undefined })))).status).toBe(400);
    expect((await send(JSON.stringify([1, 2]))).status).toBe(400);
  });

  it("missing secret -> 500 not_configured and nothing is processed", async () => {
    const res = await send(JSON.stringify(envelope()), { secret: undefined });
    expect(res).toEqual({ status: 500, body: { error: "not_configured" } });
    expect(store.rows.size).toBe(0);
    expect(consumer.handle).not.toHaveBeenCalled();
  });

  it("response bodies are identical across all 400 causes", async () => {
    const good = JSON.stringify(envelope());
    const bodies = [
      await send(good, { header: null }),
      await send(good, { header: `t=${T},v1=${"0".repeat(64)}` }),
      await send(good, { t: T - 400 }),
      await send("{nope"),
      await send(JSON.stringify([1])),
      await send(JSON.stringify(envelope({ data: { pad: "x".repeat(WEBHOOK_MAX_BODY_BYTES) } }))),
    ].map((r) => JSON.stringify(r));
    expect(new Set(bodies).size).toBe(1);
  });
});

describe("handleZeffyWebhook: processing and dedupe", () => {
  it("a good event is claimed, handled, recorded and answered 200", async () => {
    const res = await send(JSON.stringify(envelope()));
    expect(res).toEqual({ status: 200, body: { ok: true, outcome: "processed" } });
    expect(consumer.handle).toHaveBeenCalledTimes(1);
    expect(store.rows.get("evt-0001")).toMatchObject({ outcome: "processed", sessionId: "sess-1", paymentId: "pay-1", campaignId: "camp-1" });
  });

  it("a processed duplicate returns 200 without calling the consumer", async () => {
    await send(JSON.stringify(envelope()));
    const again = await send(JSON.stringify(envelope()));
    expect(again).toEqual({ status: 200, body: { ok: true, outcome: "processed", duplicate: true } });
    expect(consumer.handle).toHaveBeenCalledTimes(1);
  });

  it("a replayed delivery inside the tolerance is the same no-op", async () => {
    const body = JSON.stringify(envelope());
    await send(body, { t: T });
    const replay = await send(body, { t: T - 120 });
    expect(replay.status).toBe(200);
    expect(consumer.handle).toHaveBeenCalledTimes(1);
  });

  it("a failed event is re-run on retry, and then finishes", async () => {
    consumer.handle.mockResolvedValueOnce({ outcome: "failed", code: "zeffy_unavailable" });
    const first = await send(JSON.stringify(envelope()));
    expect(first).toEqual({ status: 500, body: { error: "failed" } });
    expect(store.rows.get("evt-0001")).toMatchObject({ outcome: "failed", errorCode: "zeffy_unavailable" });

    const retry = await send(JSON.stringify(envelope()), { t: T + 30 });
    expect(retry.status).toBe(200);
    expect(consumer.handle).toHaveBeenCalledTimes(2);
    expect(store.rows.get("evt-0001")).toMatchObject({ outcome: "processed", attempts: 2 });
  });

  it("a crashed (received) event is re-run on retry", async () => {
    store.rows.set("evt-0001", {
      id: "evt-0001", type: "payment.completed", version: "1", paymentId: "pay-1", campaignId: "camp-1",
      sessionId: null, outcome: "received", errorCode: null, attempts: 1, payload: null,
    });
    const res = await send(JSON.stringify(envelope()));
    expect(res.status).toBe(200);
    expect(consumer.handle).toHaveBeenCalledTimes(1);
  });

  it("a consumer that throws is a retryable failure", async () => {
    consumer.handle.mockRejectedValueOnce(new Error("boom with personal data"));
    const res = await send(JSON.stringify(envelope()));
    expect(res).toEqual({ status: 500, body: { error: "failed" } });
    expect(store.rows.get("evt-0001")?.errorCode).toBe("consumer_error");
  });

  it("a permanent failure outcome answers 200 with the outcome recorded", async () => {
    consumer.handle.mockResolvedValueOnce({ outcome: "invalid", code: "bad_payment" });
    const res = await send(JSON.stringify(envelope()));
    expect(res).toEqual({ status: 200, body: { ok: true, outcome: "invalid" } });
    expect(store.rows.get("evt-0001")).toMatchObject({ outcome: "invalid", errorCode: "bad_payment" });
    // and an invalid duplicate is terminal
    await send(JSON.stringify(envelope()));
    expect(consumer.handle).toHaveBeenCalledTimes(1);
  });

  it("an unsupported envelope version is recorded, never processed", async () => {
    const res = await send(JSON.stringify(envelope({ version: 2 })));
    expect(res).toEqual({ status: 200, body: { ok: true, outcome: "unsupported_version" } });
    expect(consumer.handle).not.toHaveBeenCalled();
  });

  it("an unmapped campaign stores ids and times and a null payload", async () => {
    consumer.handle.mockResolvedValueOnce({ outcome: "ignored_unmapped", code: "unmapped_campaign", campaignId: "camp-white-cane", payload: { buyer: "should not be kept" } });
    const res = await send(JSON.stringify(envelope({ data: { id: "pay-9", campaign_id: "camp-white-cane", status: "succeeded", buyer: { email: "x@example.invalid" } } })));
    expect(res.status).toBe(200);
    const row = store.rows.get("evt-0001");
    expect(row).toMatchObject({ outcome: "ignored_unmapped", sessionId: null, campaignId: "camp-white-cane", paymentId: "pay-9" });
    expect(row?.payload).toBeNull();
    expect(JSON.stringify(row)).not.toContain("example.invalid");
  });

  it("payment.created and contact.updated reach the consumer, which ignores them by type", async () => {
    consumer.handle.mockResolvedValue({ outcome: "ignored_type", code: "type_not_handled" });
    expect((await send(JSON.stringify(envelope({ id: "e2", type: "payment.created" })))).body).toMatchObject({ outcome: "ignored_type" });
    expect((await send(JSON.stringify(envelope({ id: "e3", type: "contact.updated", data: { id: "c1", object: "contact" } })))).body).toMatchObject({ outcome: "ignored_type" });
    expect(store.rows.get("e3")).toMatchObject({ outcome: "ignored_type", sessionId: null });
  });

  it("an id-only payment.updated records the payment id", async () => {
    consumer.handle.mockResolvedValueOnce({ outcome: "processed" });
    await send(JSON.stringify(envelope({ id: "e4", type: "payment.updated", data: { id: "pay-4", object: "payment" } })));
    expect(store.rows.get("e4")).toMatchObject({ paymentId: "pay-4", campaignId: null });
  });

  it("a store failure is a retryable 500 and leaves nothing terminal", async () => {
    vi.spyOn(store, "claim").mockRejectedValueOnce(new Error("db down"));
    expect(await send(JSON.stringify(envelope()))).toEqual({ status: 500, body: { error: "failed" } });
    expect(consumer.handle).not.toHaveBeenCalled();
  });
});

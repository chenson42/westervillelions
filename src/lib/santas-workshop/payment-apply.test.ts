/**
 * applyPaymentSnapshot / markPaymentDeleted, with @/lib/db mocked. The fake
 * transaction records every statement in order and answers selects from a small
 * in-memory state, so the tests can assert the lock comes first, which columns
 * are written, and that nothing is ever deleted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import threeTickets from "@/lib/zeffy/__fixtures__/payment-three-tickets.json";
import questionMap from "@/lib/zeffy/__fixtures__/question-map-practice.json";
import { toSnapshot } from "@/lib/zeffy/snapshot";

const { st } = vi.hoisted(() => ({
  st: {
    log: [] as string[],
    session: null as Record<string, unknown> | null,
    order: null as Record<string, unknown> | null,
    stuffies: [] as Record<string, unknown>[],
    inserts: [] as { table: string; values: unknown }[],
    updates: [] as { table: string; set: Record<string, unknown> }[],
    deletes: 0,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const nameOf = (t: unknown) =>
    t === schema.swSessions ? "sessions" : t === schema.swOrders ? "orders" : t === schema.swStuffies ? "stuffies" : "other";
  const rowsFor = (name: string): unknown[] =>
    name === "sessions" ? (st.session ? [st.session] : []) : name === "orders" ? (st.order ? [st.order] : []) : name === "stuffies" ? st.stuffies : [];
  const tx = {
    execute: async () => {
      st.log.push("execute");
    },
    select: () => ({
      from: (t: unknown) => {
        const name = nameOf(t);
        st.log.push(`select:${name}`);
        const rows = rowsFor(name);
        return { where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) };
      },
    }),
    insert: (t: unknown) => ({
      values: (values: unknown) => {
        const name = nameOf(t);
        st.log.push(`insert:${name}`);
        st.inserts.push({ table: name, values });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "order-new" }] });
      },
    }),
    update: (t: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: async () => {
          const name = nameOf(t);
          st.log.push(`update:${name}`);
          st.updates.push({ table: name, set });
        },
      }),
    }),
    delete: () => {
      st.deletes += 1;
      throw new Error("delete is never allowed");
    },
  };
  return { db: { transaction: async (cb: (t: unknown) => unknown) => cb(tx) } };
});

import { applyPaymentSnapshot, markPaymentDeleted, sessionToMapperConfig } from "./payment-apply";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-09T15:00:00Z");

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  windows: [{ id: "fri-1700", label: "5:00 PM – 6:00 PM", start: "17:00", end: "18:00" }],
  zeffyTicketRateIds: ["rate-stuffy"],
  questionMap,
  personalPurgedAt: null,
  ...over,
});

function snapshot(over: Record<string, unknown> = {}) {
  const r = toSnapshot({ ...threeTickets, ...over });
  if (!r.ok) throw new Error("bad fixture");
  return r.snapshot;
}

/** Existing rows that exactly match what a first apply would insert. */
async function existingFromFirstApply(over: Record<string, unknown> = {}) {
  st.session = sessionRow();
  st.order = null;
  st.stuffies = [];
  st.inserts = [];
  await applyPaymentSnapshot(snapshot(over), { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
  const orderValues = st.inserts.find((i) => i.table === "orders")?.values as Record<string, unknown>;
  const stuffyValues = st.inserts.find((i) => i.table === "stuffies")?.values as Record<string, unknown>[];
  st.order = { id: "order-1", sessionId: SESSION_ID, paymentDeleted: false, refundResolutionCents: null, ...orderValues };
  st.stuffies = stuffyValues.map((v, i) => ({ id: `stuffy-${i}`, attentionDismissedAt: null, ...v }));
  st.log = [];
  st.inserts = [];
  st.updates = [];
}

beforeEach(() => {
  st.log = [];
  st.session = sessionRow();
  st.order = null;
  st.stuffies = [];
  st.inserts = [];
  st.updates = [];
  st.deletes = 0;
});

describe("applyPaymentSnapshot: new payment", () => {
  it("takes the payment advisory lock as the first statement", async () => {
    await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
    expect(st.log[0]).toBe("execute");
    expect(st.log.indexOf("select:sessions")).toBeGreaterThan(0);
  });

  it("applies an unseen payment's embedded payload: one order, three stuffies, snapshot_at = fetchedAt", async () => {
    const result = await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
    expect(result).toMatchObject({ result: "applied", orderCreated: true, created: 3, orderId: "order-new" });
    const order = st.inserts.find((i) => i.table === "orders")?.values as Record<string, unknown>;
    expect(order).toMatchObject({ zeffyPaymentId: threeTickets.id, source: "webhook", snapshotAt: NOW, windowId: "fri-1700", buyerEmail: "parent.one@example.invalid" });
    const stuffies = st.inserts.find((i) => i.table === "stuffies")?.values as Record<string, unknown>[];
    expect(stuffies).toHaveLength(3);
    expect(new Set(stuffies.map((s) => s.familyToken)).size).toBe(3);
    for (const s of stuffies) {
      expect(s.orderId).toBe("order-new");
      expect(s).not.toHaveProperty("state");
      expect(s).not.toHaveProperty("tagCode");
    }
  });

  it("stores no address, receipt URL or payment method", async () => {
    await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "sync", fetchedAt: NOW });
    const text = JSON.stringify(st.inserts);
    expect(text).not.toMatch(/Example Street|receipt|Exampleville|card/);
  });

  it("a wrong-campaign mapping (no marked rate) creates nothing", async () => {
    st.session = sessionRow({ zeffyTicketRateIds: [] });
    const result = await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
    expect(result).toEqual({ result: "no_registrants" });
    expect(st.inserts).toEqual([]);
  });

  it("a non-succeeded payment with no order creates nothing", async () => {
    const result = await applyPaymentSnapshot(snapshot({ status: "pending" }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
    expect(result).toEqual({ result: "not_succeeded" });
    expect(st.inserts).toEqual([]);
  });

  it("refuses a purged session and an unknown session", async () => {
    st.session = sessionRow({ personalPurgedAt: new Date() });
    expect(await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "sync", fetchedAt: NOW })).toEqual({ result: "purged" });
    st.session = null;
    expect(await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "sync", fetchedAt: NOW })).toEqual({ result: "session_not_found" });
    expect(st.inserts).toEqual([]);
  });
});

describe("applyPaymentSnapshot: known payment", () => {
  it("refuses a snapshot older than snapshot_at (a late retry cannot un-refund)", async () => {
    await existingFromFirstApply();
    (st.order as Record<string, unknown>).snapshotAt = new Date(NOW.getTime() + 60_000);
    const stale = snapshot({ refund_status: "none" });
    const result = await applyPaymentSnapshot(stale, { sessionId: SESSION_ID, source: "webhook", fetchedAt: NOW });
    expect(result).toEqual({ result: "stale" });
    expect(st.updates).toEqual([]);
    expect(st.inserts).toEqual([]);
  });

  it("re-applying an identical snapshot writes only snapshot_at", async () => {
    await existingFromFirstApply();
    const later = new Date(NOW.getTime() + 60_000);
    const result = await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "sync", fetchedAt: later });
    expect(result).toMatchObject({ result: "applied", orderCreated: false, created: 0, updated: 0, unchanged: 3, orderChanged: false, refundChanged: false });
    expect(st.inserts).toEqual([]);
    expect(st.updates).toEqual([{ table: "orders", set: { snapshotAt: later } }]);
  });

  it("a refund updates the order (and only import-owned columns), leaves every stuffy alone, and reports refundChanged", async () => {
    await existingFromFirstApply();
    const later = new Date(NOW.getTime() + 60_000);
    const refunded = snapshot({ refund_status: "full", refunds: [{ id: "r", amount: 4500, status: "succeeded" }] });
    const result = await applyPaymentSnapshot(refunded, { sessionId: SESSION_ID, source: "webhook", fetchedAt: later });
    expect(result).toMatchObject({ result: "applied", orderChanged: true, refundChanged: true, updated: 0, unchanged: 3 });
    expect(st.updates).toHaveLength(1);
    expect(st.updates[0].table).toBe("orders");
    expect(st.updates[0].set).toMatchObject({ refundStatus: "full", refundedCents: 4500, paymentDeleted: false, snapshotAt: later });
    expect(Object.keys(st.updates[0].set)).not.toContain("refundResolutionCents");
  });

  it("a reversed refund clears refund fields on the order", async () => {
    await existingFromFirstApply({ refund_status: "full", refunds: [{ id: "r", amount: 4500, status: "succeeded" }] });
    const result = await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toMatchObject({ refundChanged: true });
    expect(st.updates[0].set).toMatchObject({ refundStatus: "none", refundedCents: 0 });
  });

  it("an edited answer updates that stuffy only", async () => {
    await existingFromFirstApply();
    const edited = JSON.parse(JSON.stringify(threeTickets));
    edited.items[0].questions[0].answer = "Biscuit Junior";
    const result = await applyPaymentSnapshot(snapshot({ items: edited.items }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toMatchObject({ updated: 1, unchanged: 2 });
    const stuffyUpdate = st.updates.find((u) => u.table === "stuffies");
    expect(stuffyUpdate?.set).toMatchObject({ name: "Biscuit Junior" });
  });

  it("an item missing from a later snapshot gets not_in_order_now and is not deleted", async () => {
    await existingFromFirstApply();
    const two = JSON.parse(JSON.stringify(threeTickets));
    two.items = two.items.slice(0, 2);
    const result = await applyPaymentSnapshot(snapshot({ items: two.items }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toMatchObject({ flaggedMissing: 1 });
    const flagged = st.updates.find((u) => u.table === "stuffies");
    expect((flagged?.set.attentionCodes as string[]).includes("not_in_order_now")).toBe(true);
    expect(flagged?.set.needsAttention).toBe(true);
    expect(st.deletes).toBe(0);
  });

  it("a new item on a known order is inserted", async () => {
    await existingFromFirstApply();
    const four = JSON.parse(JSON.stringify(threeTickets));
    four.items.push({ ...four.items[0], id: "item-0004" });
    const result = await applyPaymentSnapshot(snapshot({ items: four.items }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toMatchObject({ created: 1 });
  });

  it("an order stored under a different session returns session_mismatch and writes nothing", async () => {
    await existingFromFirstApply();
    (st.order as Record<string, unknown>).sessionId = "99999999-9999-4999-8999-999999999999";
    const result = await applyPaymentSnapshot(snapshot(), { sessionId: SESSION_ID, source: "sync", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toEqual({ result: "session_mismatch" });
    expect(st.updates).toEqual([]);
  });

  it("a non-succeeded status updates the order but never touches stuffies", async () => {
    await existingFromFirstApply();
    const result = await applyPaymentSnapshot(snapshot({ status: "refunded" }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    expect(result).toMatchObject({ result: "applied", created: 0, updated: 0, flaggedMissing: 0 });
    expect(st.updates.every((u) => u.table === "orders")).toBe(true);
    expect(st.log).not.toContain("select:stuffies");
  });

  it("a dismissed attention flag survives an unrelated edit but resets when the reasons change", async () => {
    await existingFromFirstApply();
    // stuffy 3 has unmapped_question; the admin dismissed it
    (st.stuffies[2] as Record<string, unknown>).attentionDismissedAt = new Date(NOW.getTime() - 1000);
    (st.stuffies[2] as Record<string, unknown>).needsAttention = false;
    const edited = JSON.parse(JSON.stringify(threeTickets));
    edited.items[2].questions[0].answer = "Mister Whiskers II";
    await applyPaymentSnapshot(snapshot({ items: edited.items }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 1000) });
    const kept = st.updates.find((u) => u.table === "stuffies");
    expect(kept?.set.needsAttention).toBe(false);
    expect(kept?.set.attentionDismissedAt).toBeInstanceOf(Date);

    st.updates = [];
    edited.items[2].questions[1].answer = "";
    edited.items[2].questions.splice(1, 1); // snack removed: a new reason (missing_snack)
    await applyPaymentSnapshot(snapshot({ items: edited.items }), { sessionId: SESSION_ID, source: "webhook", fetchedAt: new Date(NOW.getTime() + 2000) });
    const reset = st.updates.find((u) => u.table === "stuffies");
    expect(reset?.set.needsAttention).toBe(true);
    expect(reset?.set.attentionDismissedAt).toBeNull();
  });
});

describe("markPaymentDeleted", () => {
  it("flags a known order deleted, never deleting", async () => {
    await existingFromFirstApply();
    const ok = await markPaymentDeleted(threeTickets.id, new Date(NOW.getTime() + 1000));
    expect(ok).toBe(true);
    expect(st.updates).toEqual([{ table: "orders", set: expect.objectContaining({ paymentDeleted: true }) }]);
    expect(st.deletes).toBe(0);
  });

  it("stores nothing for a payment it never saw", async () => {
    st.order = null;
    expect(await markPaymentDeleted("pay-unseen", NOW)).toBe(false);
    expect(st.updates).toEqual([]);
    expect(st.inserts).toEqual([]);
  });

  it("ignores a deletion older than the stored snapshot", async () => {
    await existingFromFirstApply();
    (st.order as Record<string, unknown>).snapshotAt = new Date(NOW.getTime() + 60_000);
    await markPaymentDeleted(threeTickets.id, NOW);
    expect(st.updates).toEqual([]);
  });
});

describe("payment-apply source", () => {
  const source = readFileSync(join(__dirname, "payment-apply.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("no .set() list names a worker-owned column", () => {
    const sets = [...code.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(sets.length).toBeGreaterThan(0);
    const forbidden = /\b(state|tagCode|frameNumber|frameExportedPhotoId|withdrawnAt|withdrawnByUserId|withdrawnReason|familyToken|taggedAt|checkedInAt|portraitAt|pickedUpAt|refundResolutionCents|refundResolvedAt|manualReason)\b/;
    for (const s of sets) expect(s).not.toMatch(forbidden);
  });

  it("never deletes and never calls Zeffy (the HTTP call is the caller's, outside the transaction)", () => {
    expect(code).not.toMatch(/\.delete\(/);
    expect(code).not.toMatch(/fetch\(|createZeffyClient|zeffy\/client/);
  });

  it("the advisory lock is the first statement inside the transaction", () => {
    const body = code.slice(code.indexOf("db.transaction("));
    expect(body.indexOf("pg_advisory_xact_lock")).toBeGreaterThan(-1);
    expect(body.indexOf("pg_advisory_xact_lock")).toBeLessThan(body.indexOf("tx.select"));
  });

  it("builds the mapper config from a session row", () => {
    expect(sessionToMapperConfig(sessionRow() as never)).toMatchObject({ ticketRateIds: ["rate-stuffy"], windows: [{ id: "fri-1700", label: "5:00 PM – 6:00 PM" }] });
  });
});

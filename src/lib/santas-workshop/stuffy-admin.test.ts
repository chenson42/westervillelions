import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: {
    replayHit: [] as boolean[],
    registrantRow: null as Row | null,
    orderExists: true,
    stuffiesOfOrder: [] as Row[],
    dismissRows: [{ id: "s" }] as Row[],
    inserts: [] as { table: string; values: Row | Row[] }[],
    updates: [] as { table: string; set: Row }[],
    logs: [] as { kind: string; detail: Row }[],
    withdrawResults: [] as Row[],
    withdrawCalls: [] as Row[],
    eventInsertError: null as unknown,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const nameOf = (t: unknown) =>
    t === schema.swStuffies ? "stuffies" : t === schema.swStuffyEvents ? "events" : t === schema.swOrders ? "orders" : t === schema.swSessions ? "sessions" : "other";

  const selectBuilder = (arg?: Row) => ({
    from: (t: unknown) => {
      const name = nameOf(t);
      const rows = (): Row[] => {
        if (name === "events") return st.replayHit.shift() ? [{ stuffyId: "stuffy-1" }] : [];
        if (name === "orders") return st.orderExists ? [{ id: "order-1" }] : [];
        if (name === "stuffies" && arg && "state" in arg) return st.stuffiesOfOrder;
        return [];
      };
      return {
        where: () => ({ limit: async () => rows(), then: (resolve: (v: Row[]) => unknown) => resolve(rows()) }),
        innerJoin: () => ({ where: () => ({ limit: async () => (st.registrantRow ? [st.registrantRow] : []) }) }),
      };
    },
  });

  const writer = {
    insert: (t: unknown) => ({
      values: (values: Row | Row[]) => {
        const name = nameOf(t);
        if (name === "events" && st.eventInsertError) throw st.eventInsertError;
        st.inserts.push({ table: name, values });
        return { returning: async () => [{ id: name === "orders" ? "order-1" : "stuffy-1" }], then: undefined };
      },
    }),
    update: (t: unknown) => ({
      set: (set: Row) => ({
        where: () => {
          const name = nameOf(t);
          st.updates.push({ table: name, set });
          return Object.assign(Promise.resolve(), { returning: async () => st.dismissRows });
        },
      }),
    }),
  };
  return { db: { select: selectBuilder, transaction: async (cb: (t: unknown) => unknown) => cb(writer), ...writer } };
});

vi.mock("./session-log", () => ({
  logSessionEvent: async (_s: string, _u: string, kind: string, detail: Row) => {
    st.logs.push({ kind, detail });
  },
}));
vi.mock("./session-queries", async () => {
  const failure = (status: number, code: string, error: string, field?: string, extra: Row = {}) => ({ ok: false, status, code, error, ...(field ? { field } : {}), ...extra });
  return {
    failure,
    isUniqueViolation: (e: { code?: string; constraint_name?: string } | null, hint?: string) => e?.code === "23505" && (!hint || (e.constraint_name ?? "").includes(hint)),
    toRegistrantDto: (s: Row, o: Row) => ({ id: s.id, orderId: s.orderId, source: o.source }),
  };
});
vi.mock("./stuffy-transitions", async () => {
  const actual = await vi.importActual<typeof import("./stuffy-transitions")>("./stuffy-transitions");
  return {
    ...actual,
    withdrawStuffy: async (_ctx: unknown, input: Row) => {
      st.withdrawCalls.push(input);
      return st.withdrawResults.shift() ?? { ok: true, replayed: false, stuffy: {} };
    },
    revertStuffy: async () => ({ ok: true, replayed: false, stuffy: {} }),
  };
});

import type { SwSession } from "@/lib/db/schema";
import { adminRevert, dismissAttention, manualAdd, resolveRefund, transitionFailureToQuery, validateReason } from "./stuffy-admin";
import type { ManualAddInput } from "./manual-add";

const SESSION = { id: "11111111-1111-4111-8111-111111111111", kind: "practice", status: "active", personalPurgedAt: null, windows: [{ id: "w1", label: "5 PM" }], questionMap: {} } as unknown as SwSession;
const PURGED = { ...SESSION, personalPurgedAt: new Date() } as SwSession;
const KEY = "22222222-2222-4222-8222-222222222222";

const input: ManualAddInput = {
  parentFirstName: "Pat",
  parentLastName: "Example",
  stuffyName: "Barnaby",
  description: null,
  windowId: "w1",
  snack: null,
  noteToSanta: null,
  careNote: null,
  parentEmail: null,
  parentPhone: null,
  photoConsent: false,
  reason: "Phoned the hotline",
  idempotencyKey: KEY,
};

beforeEach(() => {
  st.replayHit = [];
  st.registrantRow = { stuffy: { id: "stuffy-1", orderId: "order-1" }, order: { source: "manual" }, orderSize: 1 };
  st.orderExists = true;
  st.stuffiesOfOrder = [];
  st.dismissRows = [{ id: "s" }];
  st.inserts = [];
  st.updates = [];
  st.logs = [];
  st.withdrawResults = [];
  st.withdrawCalls = [];
  st.eventInsertError = null;
});

describe("manualAdd", () => {
  it("creates a manual order and one registered stuffy, with a manual_add event carrying the reason and the request id", async () => {
    const r = await manualAdd(SESSION, input, "u1");
    expect(r).toMatchObject({ ok: true, replayed: false });
    const order = st.inserts.find((i) => i.table === "orders")?.values as Row;
    expect(order).toMatchObject({ source: "manual", buyerFirstName: "Pat", buyerLastName: "Example", windowId: "w1", manualReason: "Phoned the hotline", createdByUserId: "u1", sessionId: SESSION.id });
    const stuffy = st.inserts.find((i) => i.table === "stuffies")?.values as Row;
    expect(stuffy).toMatchObject({ name: "Barnaby", state: "registered", photoConsent: false });
    expect(String(stuffy.familyToken)).toHaveLength(22);
    const event = st.inserts.find((i) => i.table === "events")?.values as Row;
    expect(event).toMatchObject({ kind: "manual_add", actorKind: "admin", deviceId: "admin", userId: "u1", idempotencyKey: KEY, note: "Phoned the hotline", toState: "registered" });
    expect(st.logs).toEqual([{ kind: "manual_add", detail: { orders: 1, stuffies: 1 } }]);
  });

  it("the audit log row holds counts only, never the name, email or reason", async () => {
    await manualAdd(SESSION, { ...input, parentEmail: "pat@example.invalid" }, "u1");
    expect(JSON.stringify(st.logs)).not.toMatch(/Pat|Barnaby|example|Phoned/);
  });

  it("a double tap (same request id) returns the registrant already created and writes nothing", async () => {
    st.replayHit = [true];
    const r = await manualAdd(SESSION, input, "u1");
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(st.inserts).toHaveLength(0);
  });

  it("a concurrent duplicate (23505 on the idempotency index) replays instead of 500", async () => {
    st.replayHit = [false, true];
    st.eventInsertError = Object.assign(new Error("dup"), { code: "23505", constraint_name: "ux_sw_stuffy_events_idem" });
    expect(await manualAdd(SESSION, input, "u1")).toMatchObject({ ok: true, replayed: true });
  });

  it("any other database error is not swallowed", async () => {
    st.eventInsertError = Object.assign(new Error("boom"), { code: "XX000" });
    await expect(manualAdd(SESSION, input, "u1")).rejects.toThrow("boom");
  });

  it("a purged session cannot be added to", async () => {
    expect(await manualAdd(PURGED, input, "u1")).toMatchObject({ ok: false, code: "session_purged" });
  });
});

describe("validateReason", () => {
  it("is required, trimmed, 3 to 500 characters", () => {
    expect(validateReason("  wrong sticker ")).toEqual({ ok: true, value: "wrong sticker" });
    expect(validateReason("ab").ok).toBe(false);
    expect(validateReason("   ").ok).toBe(false);
    expect(validateReason(undefined).ok).toBe(false);
    expect(validateReason("x".repeat(501)).ok).toBe(false);
  });
});

describe("transitionFailureToQuery", () => {
  it("maps every failure to an admin code (exhaustive)", () => {
    expect(transitionFailureToQuery({ ok: false, code: "not_found" })).toMatchObject({ status: 404 });
    expect(transitionFailureToQuery({ ok: false, code: "stale_state", currentState: "tagged", since: new Date() })).toMatchObject({ status: 409, code: "stale_state", currentState: "tagged" });
    expect(transitionFailureToQuery({ ok: false, code: "withdraw_not_allowed", currentState: "checked_in" })).toMatchObject({ code: "withdraw_not_allowed" });
    expect(transitionFailureToQuery({ ok: false, code: "invalid_input", error: "x" })).toMatchObject({ status: 400 });
    expect(transitionFailureToQuery({ ok: false, code: "illegal_transition", currentState: "tagged" })).toMatchObject({ code: "invalid_transition" });
  });
});

describe("adminRevert", () => {
  it("logs the target state only and returns the registrant", async () => {
    const r = await adminRevert(SESSION, "stuffy-1", { toState: "registered", expectedState: "tagged", reason: "wrong sticker" }, "u1");
    expect(r.ok).toBe(true);
    expect(st.logs).toEqual([{ kind: "stuffy_reverted", detail: { to: "registered" } }]);
  });
  it("refuses a purged session", async () => {
    expect(await adminRevert(PURGED, "stuffy-1", { toState: "registered", expectedState: "tagged", reason: "x" }, "u1")).toMatchObject({ ok: false, code: "session_purged" });
  });
});

describe("dismissAttention", () => {
  it("clears the flag and stamps the dismissal, pinned on the flag being set", async () => {
    const r = await dismissAttention(SESSION, "stuffy-1", "u1");
    expect(r.ok).toBe(true);
    expect(st.updates[0]).toMatchObject({ table: "stuffies", set: { needsAttention: false } });
    expect(st.updates[0].set.attentionDismissedAt).toBeInstanceOf(Date);
    expect(st.logs).toEqual([{ kind: "attention_dismissed", detail: { count: 1 } }]);
  });

  it("a second click matches no row and logs nothing", async () => {
    st.dismissRows = [];
    expect((await dismissAttention(SESSION, "stuffy-1", "u1")).ok).toBe(true);
    expect(st.logs).toHaveLength(0);
  });
});

describe("resolveRefund", () => {
  it("Keep stores the refunded amount seen (the SQL column itself) and resolves", async () => {
    const r = await resolveRefund(SESSION, "order-1", "keep", "u1");
    expect(r).toMatchObject({ ok: true, result: { orderId: "order-1", withdrawn: 0, stillInCustody: 0, resolved: true } });
    const set = st.updates[0].set;
    expect(set.refundResolutionCents).toBeDefined();
    expect(typeof set.refundResolutionCents).not.toBe("number"); // a column reference, not a number the client sent
    expect(set.refundResolvedByUserId).toBe("u1");
    expect(st.logs).toEqual([{ kind: "refund_kept", detail: { orders: 1 } }]);
  });

  it("Withdraw withdraws only registered/tagged stuffies and leaves those in custody flagged", async () => {
    st.stuffiesOfOrder = [
      { id: "a", state: "registered" },
      { id: "b", state: "tagged" },
      { id: "c", state: "checked_in" },
    ];
    const r = await resolveRefund(SESSION, "order-1", "withdraw", "u1");
    expect(r).toMatchObject({ ok: true, result: { withdrawn: 2, stillInCustody: 1, resolved: false } });
    expect(st.withdrawCalls.map((c) => c.stuffyId)).toEqual(["a", "b"]);
    expect(st.withdrawCalls[0]).toMatchObject({ reason: "Refunded" });
    expect(st.updates.some((u) => u.table === "orders")).toBe(false); // flag stays open for the stuffy in custody
  });

  it("Withdraw resolves the flag once every stuffy of the order is withdrawn", async () => {
    st.stuffiesOfOrder = [{ id: "a", state: "registered" }];
    const r = await resolveRefund(SESSION, "order-1", "withdraw", "u1");
    expect(r).toMatchObject({ ok: true, result: { resolved: true, withdrawn: 1 } });
    expect(st.updates.some((u) => u.table === "orders")).toBe(true);
    expect(st.logs.at(-1)).toMatchObject({ kind: "refund_withdraw", detail: { withdrawn: 1, stillInCustody: 0 } });
  });

  it("a stuffy that moved into custody between the read and the write counts as in custody", async () => {
    st.stuffiesOfOrder = [{ id: "a", state: "tagged" }];
    st.withdrawResults = [{ ok: false, code: "stale_state", currentState: "checked_in", since: new Date() }];
    const r = await resolveRefund(SESSION, "order-1", "withdraw", "u1");
    expect(r).toMatchObject({ ok: true, result: { withdrawn: 0, stillInCustody: 1, resolved: false } });
  });

  it("an order of another session is not found", async () => {
    st.orderExists = false;
    expect(await resolveRefund(SESSION, "order-9", "keep", "u1")).toMatchObject({ ok: false, status: 404 });
  });

  it("neither resolution touches the hand-over path", async () => {
    await resolveRefund(SESSION, "order-1", "keep", "u1");
    expect(st.updates.every((u) => u.table === "orders")).toBe(true);
  });
});

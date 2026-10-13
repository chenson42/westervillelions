import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const { st } = vi.hoisted(() => ({
  st: {
    session: null as Record<string, unknown> | null,
    selects: [] as Record<string, unknown>[][],
    updateResults: [] as Record<string, unknown>[][],
    ops: [] as { op: string; table?: string; set?: Record<string, unknown>; key?: string; values?: Record<string, unknown> }[],
    logs: [] as { kind: string; detail: Record<string, unknown> }[],
    transactions: 0,
    rolledBack: 0,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const names = new Map<unknown, string>([
    [schema.swPhotos, "photos"],
    [schema.swSessions, "sessions"],
    [schema.swOrders, "orders"],
    [schema.swStuffies, "stuffies"],
    [schema.swStuffyEvents, "events"],
    [schema.zeffyEvents, "zeffy"],
    [schema.swSessionLog, "log"],
  ]);
  const nameOf = (t: unknown) => names.get(t) ?? "other";
  const selectChain = (): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            const rows = st.selects.shift() ?? [];
            return (resolve: (v: Record<string, unknown>[]) => unknown) => resolve(rows);
          }
          return () => selectChain();
        },
      },
    );
  const done = () => ({ returning: async () => st.updateResults.shift() ?? [{ id: "row" }], then: (r: (v: unknown) => unknown) => r(undefined) });
  const writer = {
    update: (t: unknown) => ({
      set: (set: Record<string, unknown>) => {
        st.ops.push({ op: "update", table: nameOf(t), set });
        return { where: () => done() };
      },
    }),
    delete: (t: unknown) => {
      st.ops.push({ op: "delete", table: nameOf(t) });
      return { where: () => done() };
    },
    insert: (t: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        st.ops.push({ op: "insert", table: nameOf(t), values });
        if (nameOf(t) === "log") st.logs.push({ kind: values.kind as string, detail: values.detail as Record<string, unknown> });
      },
    }),
  };
  return {
    db: {
      select: () => selectChain(),
      ...writer,
      transaction: async (fn: (tx: unknown) => unknown) => {
        st.transactions += 1;
        try {
          return await fn({ select: () => selectChain(), ...writer });
        } catch (e) {
          st.rolledBack += 1;
          throw e;
        }
      },
    },
  };
});

vi.mock("./session-queries", () => ({
  failure: (status: number, code: string, error: string, field?: string) => ({ ok: false, status, code, error, ...(field ? { field } : {}) }),
  getSessionRow: async () => st.session,
}));
vi.mock("./session-log", () => ({
  logSessionEvent: async (_s: string, _u: string, kind: string, detail: Record<string, unknown>) => {
    st.logs.push({ kind, detail });
  },
}));
vi.mock("./photo-store", () => ({
  getPhotoStore: () => {
    throw new Error("a store must be injected");
  },
}));

import { StorageUnavailable } from "./photo-store/errors";
import { getRetentionPreview, purgeSession, resetPracticeSession, type PurgeArgs } from "./retention";

const SID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2027-02-01T15:00:00Z"); // Eastern day 2027-02-01: past both default dates

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: SID,
  kind: "real",
  status: "closed",
  pickupDate: "2026-12-20",
  purgePersonalOn: "2027-01-19",
  purgePublicOn: "2027-01-31",
  personalPurgedAt: null,
  publicPurgedAt: null,
  ...over,
});
const photo = (id: string, keys: [string | null, string | null] = [`k-${id}`, `t-${id}`]) => ({ id, storageKey: keys[0], thumbStorageKey: keys[1] });
const args = (over: Partial<PurgeArgs> = {}): PurgeArgs => ({ sessionId: SID, scope: "personal", userId: "admin-1", force: false, reason: null, ...over });

function fakeStore(failOn: string[] = []) {
  const deleted: string[] = [];
  return {
    deleted,
    store: {
      delete: async (key: string) => {
        if (failOn.includes(key)) throw new StorageUnavailable();
        deleted.push(key);
        st.ops.push({ op: "store.delete", key });
      },
    } as never,
  };
}

const tableOps = (op: string, table: string) => st.ops.filter((o) => o.op === op && o.table === table);
/** Selects for a clean finalize: the drain's empty second read, the locked session row, the zero-left count. */
const finalizeSelects = (locked: Record<string, unknown> = { personalPurgedAt: null, publicPurgedAt: null }) => [[locked], [{ n: 0 }]];

beforeEach(() => {
  st.session = sessionRow();
  st.selects = [];
  st.updateResults = [];
  st.ops = [];
  st.logs = [];
  st.transactions = 0;
  st.rolledBack = 0;
});

describe("purgeSession: eligibility (server-side, Eastern string compare)", () => {
  it("refuses before the date with 409 not_eligible and touches nothing", async () => {
    const { store } = fakeStore();
    const r = await purgeSession(args(), { store, now: new Date("2027-01-18T20:00:00Z") });
    expect(r).toMatchObject({ ok: false, status: 409, code: "not_eligible" });
    expect(st.ops).toEqual([]);
    expect(st.logs).toEqual([]);
  });

  it("refuses an active session whose pickup day has not passed, even past the date (S5-N3)", async () => {
    st.session = sessionRow({ status: "active", pickupDate: "2027-02-01" });
    const { store } = fakeStore();
    expect(await purgeSession(args(), { store, now: NOW })).toMatchObject({ ok: false, status: 409, code: "not_eligible" });
    expect(st.ops).toEqual([]);
  });

  it("the date turns over at Eastern midnight, not UTC: 23:30 Eastern on the due day is eligible, 23:30 the day before is not", async () => {
    const { store } = fakeStore();
    st.selects = [[], ...finalizeSelects()];
    const onDay = await purgeSession(args(), { store, now: new Date("2027-01-20T04:30:00Z") }); // 23:30 EST Jan 19
    expect(onDay).toMatchObject({ done: true });
    const before = await purgeSession(args(), { store, now: new Date("2027-01-19T04:30:00Z") }); // 23:30 EST Jan 18
    expect(before).toMatchObject({ ok: false, code: "not_eligible" });
  });

  it("S5-N3: an unclosed session whose pickup day is at least a day in the past is eligible without force", async () => {
    st.session = sessionRow({ status: "active", pickupDate: "2026-12-20" });
    const { store } = fakeStore();
    st.selects = [[], ...finalizeSelects()];
    expect(await purgeSession(args(), { store, now: NOW })).toMatchObject({ done: true, forced: false });
  });

  it("force without a reason is a 400; force with a reason runs, is reported forced and the reason is audited", async () => {
    st.session = sessionRow({ status: "active", pickupDate: "2027-02-01" });
    const { store } = fakeStore();
    expect(await purgeSession(args({ force: true }), { store, now: NOW })).toMatchObject({ ok: false, status: 400, field: "reason" });
    expect(st.ops).toEqual([]);

    st.selects = [[], ...finalizeSelects()];
    const r = await purgeSession(args({ force: true, reason: "Chair confirmed" }), { store, now: NOW });
    expect(r).toMatchObject({ done: true, forced: true });
    expect(st.logs.at(-1)).toMatchObject({ kind: "purge_done", detail: { scope: "personal", forced: true, reason: "Chair confirmed" } });
  });

  it("an unknown session is a 404", async () => {
    st.session = null;
    expect(await purgeSession(args(), { now: NOW })).toMatchObject({ ok: false, status: 404 });
  });

  it("a scope that is already purged is a no-op: no store call, no write, no audit row", async () => {
    st.session = sessionRow({ personalPurgedAt: new Date("2027-01-20T00:00:00Z") });
    const r = await purgeSession(args(), { store: undefined, now: NOW });
    expect(r).toMatchObject({ done: true, noop: true, remaining: 0 });
    expect(st.ops).toEqual([]);
  });
});

describe("purgeSession: personal scope", () => {
  it("deletes the bytes BEFORE stamping each photo, then nulls personal data and sets the marker in one transaction, audited with counts", async () => {
    const { store, deleted } = fakeStore();
    st.selects = [[photo("p1"), photo("p2", ["k-p2", null])], [], ...finalizeSelects()];
    st.updateResults = [[{ id: "p1" }], [{ id: "p2" }], [{ id: "o1" }, { id: "o2" }, { id: "o3" }], [{ id: "s1" }, { id: "s2" }], [{ id: "e1" }], [{ id: "z1" }, { id: "z2" }], [{ id: "l1" }], [{ id: SID }]];

    const r = await purgeSession(args(), { store, now: NOW });
    expect(r).toMatchObject({ phase: "personal", done: true, remaining: 0, photosDeleted: 2, noop: false, forced: false });
    expect(deleted).toEqual(["k-p1", "t-p1", "k-p2"]);

    const order = st.ops.filter((o) => o.op === "store.delete" || (o.op === "update" && o.table === "photos")).map((o) => (o.op === "store.delete" ? `del:${o.key}` : "stamp"));
    expect(order).toEqual(["del:k-p1", "del:t-p1", "stamp", "del:k-p2", "stamp"]);
    expect(tableOps("update", "photos")[0].set).toEqual({ purgedAt: NOW, storageKey: null, thumbStorageKey: null });

    expect(st.transactions).toBe(1);
    expect(tableOps("update", "orders")[0].set).toMatchObject({ buyerFirstName: null, buyerLastName: null, buyerEmail: null, buyerPhone: null, buyerAnswers: [], windowLabelRaw: null, manualReason: null });
    expect(tableOps("update", "stuffies")[0].set).toMatchObject({ childFirstName: null, snack: null, noteToSanta: null, careNote: null, rawAnswers: [] });
    expect(tableOps("update", "events")[0].set).toEqual({ note: null });
    expect(tableOps("update", "zeffy")[0].set).toEqual({ payload: null });
    const marker = tableOps("update", "sessions")[0].set as Row;
    expect(marker).toMatchObject({ personalPurgedAt: NOW });
    expect(marker).not.toHaveProperty("status"); // the public scope is not done yet

    expect(st.logs.map((l) => l.kind)).toEqual(["purge_step", "purge_done"]);
    expect(st.logs[0].detail).toEqual({ scope: "personal", photosDeleted: 2, remaining: 0, forced: false });
    expect(st.logs[1].detail).toEqual({ scope: "personal", orders: 3, stuffies: 2, eventNotes: 1, webhookSnapshots: 2, logReasons: 1, forced: false });
  });

  it("when the public scope is already done, the marker also moves the session to purged", async () => {
    const { store } = fakeStore();
    st.selects = [[], ...finalizeSelects({ personalPurgedAt: null, publicPurgedAt: new Date("2027-02-01T00:00:00Z") })];
    await purgeSession(args(), { store, now: NOW });
    expect(tableOps("update", "sessions")[0].set).toMatchObject({ personalPurgedAt: NOW, status: "purged" });
  });

  it("S5-N1: the personal scope also nulls the description, the withdraw reason and admin reasons in the session log, keeping the stuffy name and the forced-purge reason", async () => {
    const { store } = fakeStore();
    st.selects = [[], ...finalizeSelects()];
    await purgeSession(args(), { store, now: NOW });
    expect(tableOps("update", "stuffies")[0].set).toMatchObject({ description: null, withdrawnReason: null });
    expect(tableOps("update", "stuffies")[0].set).not.toHaveProperty("name");
    expect(tableOps("update", "events")[0].set).toEqual({ note: null }); // revert, withdraw and manual-add reasons live in the note column
    expect(tableOps("update", "orders")[0].set).toMatchObject({ manualReason: null });
    const logScrub = tableOps("update", "log");
    expect(logScrub).toHaveLength(1);
    const src = readFileSync(join(__dirname, "retention.ts"), "utf8");
    expect(src).toMatch(/notInArray\(swSessionLog\.kind, \["purge_step", "purge_done"\]\)/);
  });

  it("never writes a tombstone column: payment id, item key, tag code, family token, state stamps, stuffy name and description survive", () => {
    const src = readFileSync(join(__dirname, "retention.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const sets = [...src.matchAll(/\.set\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]).join("\n");
    expect(sets).not.toMatch(/zeffyPaymentId|zeffyItemKey|tagCode|familyToken|pickedUpAt|checkedInAt|taggedAt|portraitAt|\bname\b|state\b|sessionId/);
  });

  it("a photo row with no keys is stamped without opening the store", async () => {
    st.selects = [[photo("p1", [null, null])], [], ...finalizeSelects()];
    const r = await purgeSession(args(), { store: () => { throw new Error("store must not be touched"); }, now: NOW });
    expect(r).toMatchObject({ done: true, photosDeleted: 1 });
    expect(tableOps("update", "photos")).toHaveLength(1);
  });

  it("the audit rows carry only counts, booleans and the scope: no key, token, name or contact value", async () => {
    const { store } = fakeStore();
    st.selects = [[photo("p1")], [], ...finalizeSelects()];
    await purgeSession(args(), { store, now: NOW });
    for (const l of st.logs) {
      for (const [k, v] of Object.entries(l.detail)) {
        expect(["scope", "photosDeleted", "remaining", "forced", "orders", "stuffies", "eventNotes", "webhookSnapshots", "logReasons", "interrupted", "reason"]).toContain(k);
        expect(typeof v === "number" || typeof v === "boolean" || k === "scope" || k === "reason").toBe(true);
      }
      expect(JSON.stringify(l.detail)).not.toMatch(/k-p1|t-p1|@/);
    }
  });
});

describe("purgeSession: public scope", () => {
  it("takes only portraits and group photos, touches no personal table, and sets the public marker", async () => {
    const { store, deleted } = fakeStore();
    st.selects = [[photo("g1")], [], ...finalizeSelects()];
    const r = await purgeSession(args({ scope: "public" }), { store, now: NOW });
    expect(r).toMatchObject({ phase: "public", done: true, photosDeleted: 1 });
    expect(deleted).toEqual(["k-g1", "t-g1"]);
    for (const t of ["orders", "stuffies", "events", "zeffy"]) expect(tableOps("update", t)).toHaveLength(0);
    expect(tableOps("update", "sessions")[0].set).toMatchObject({ publicPurgedAt: NOW });
    expect(st.logs.at(-1)).toMatchObject({ kind: "purge_done", detail: { scope: "public", forced: false } });
  });

  it("the two photo scopes partition every photo (one predicate and its complement)", () => {
    const src = readFileSync(join(__dirname, "retention.ts"), "utf8");
    expect(src).toMatch(/const PUBLIC_PHOTO = sql`not \(\$\{PERSONAL_PHOTO\}\)`/);
  });
});

describe("purgeSession: resumability", () => {
  it("a store failure mid-way keeps what was done, writes no marker, rethrows, and a second run finishes", async () => {
    const failing = fakeStore(["k-p2"]);
    st.selects = [[photo("p1"), photo("p2"), photo("p3")]];
    await expect(purgeSession(args(), { store: failing.store, now: NOW })).rejects.toBeInstanceOf(StorageUnavailable);
    expect(failing.deleted).toEqual(["k-p1", "t-p1"]);
    expect(tableOps("update", "photos")).toHaveLength(1); // only p1 stamped; p2 and p3 untouched
    expect(st.transactions).toBe(0); // no database nulling, no marker
    expect(tableOps("update", "sessions")).toHaveLength(0);
    expect(st.logs).toEqual([{ kind: "purge_step", detail: { scope: "personal", photosDeleted: 1, interrupted: true, forced: false } }]);

    // Second run: the store works; only p2 and p3 are still unstamped, so only they are read.
    st.ops = [];
    st.logs = [];
    const ok = fakeStore();
    st.selects = [[photo("p2"), photo("p3")], [], ...finalizeSelects()];
    const r = await purgeSession(args(), { store: ok.store, now: NOW });
    expect(r).toMatchObject({ done: true, photosDeleted: 2 });
    expect(ok.deleted).toEqual(["k-p2", "t-p2", "k-p3", "t-p3"]);
    expect(tableOps("update", "sessions")[0].set).toMatchObject({ personalPurgedAt: NOW });
  });

  it("a failure on the very first photo audits nothing (no progress) and still rethrows", async () => {
    const failing = fakeStore(["k-p1"]);
    st.selects = [[photo("p1")]];
    await expect(purgeSession(args(), { store: failing.store, now: NOW })).rejects.toBeInstanceOf(StorageUnavailable);
    expect(st.logs).toEqual([]);
    expect(tableOps("update", "photos")).toHaveLength(0);
  });

  it("a run that hits its time budget returns done:false with the count remaining and does not finalize", async () => {
    const { store, deleted } = fakeStore();
    let t = 0;
    const clock = () => (t += 100);
    st.selects = [[photo("p1"), photo("p2")], [{ n: 1 }]];
    const r = await purgeSession(args(), { store, now: NOW, clock, budgetMs: 150 });
    expect(r).toMatchObject({ done: false, remaining: 1, photosDeleted: 1 });
    expect(deleted).toEqual(["k-p1", "t-p1"]);
    expect(st.transactions).toBe(0);
    expect(st.logs).toEqual([{ kind: "purge_step", detail: { scope: "personal", photosDeleted: 1, remaining: 1, forced: false } }]);
  });

  it("a photo uploaded while finalizing sends the caller round again: nothing is nulled and no marker is set", async () => {
    const { store } = fakeStore();
    st.selects = [[], [{ personalPurgedAt: null, publicPurgedAt: null }], [{ n: 1 }]];
    const r = await purgeSession(args(), { store, now: NOW });
    expect(r).toMatchObject({ done: false, remaining: 1 });
    expect(tableOps("update", "orders")).toHaveLength(0);
    expect(tableOps("update", "sessions")).toHaveLength(0);
  });

  it("a marker update that finds zero rows rolls the transaction back (sentinel) and reports a no-op", async () => {
    const { store } = fakeStore();
    st.selects = [[], ...finalizeSelects()];
    st.updateResults = [[], [], [], [], [], []]; // orders, stuffies, notes, snapshots, log reasons, then the marker: zero rows
    const r = await purgeSession(args(), { store, now: NOW });
    expect(st.rolledBack).toBe(1);
    expect(r).toMatchObject({ done: true, noop: true });
    expect(st.logs.some((l) => l.kind === "purge_done")).toBe(false);
  });

  it("another request finishing first (marker already set under the lock) is a no-op with no writes", async () => {
    const { store } = fakeStore();
    st.selects = [[], [{ personalPurgedAt: new Date("2027-02-01T00:00:00Z"), publicPurgedAt: null }]];
    const r = await purgeSession(args(), { store, now: NOW });
    expect(r).toMatchObject({ done: true, noop: true });
    expect(tableOps("update", "orders")).toHaveLength(0);
  });
});

describe("resetPracticeSession", () => {
  it("is refused on a real session with 403 practice_only: no store call, no delete, no write", async () => {
    const r = await resetPracticeSession(SID, "admin-1", { store: () => { throw new Error("store must not be touched"); }, now: NOW });
    expect(r).toMatchObject({ ok: false, status: 403, code: "practice_only" });
    expect(st.ops).toEqual([]);
    expect(st.logs).toEqual([]);
  });

  it("an unknown session is a 404", async () => {
    st.session = null;
    expect(await resetPracticeSession(SID, "admin-1", { now: NOW })).toMatchObject({ ok: false, status: 404 });
  });

  it("deletes bytes then each photo row, then orders (cascade), the snapshots, the publish state, and audits counts", async () => {
    st.session = sessionRow({ kind: "practice", status: "active" });
    const { store, deleted } = fakeStore();
    st.selects = [[photo("p1"), photo("p2")], [], [{ id: SID }], [{ n: 0 }], [{ orders: 4, stuffies: 5, events: 17 }]];
    const r = await resetPracticeSession(SID, "admin-1", { store, now: NOW });
    expect(r).toEqual({ done: true, remaining: 0, photosDeleted: 2, removed: { orders: 4, stuffies: 5, events: 17 } });
    expect(deleted).toEqual(["k-p1", "t-p1", "k-p2", "t-p2"]);
    const order = st.ops.filter((o) => o.op === "store.delete" || (o.op === "delete" && o.table === "photos")).map((o) => (o.op === "store.delete" ? "del" : "row"));
    expect(order).toEqual(["del", "del", "row", "del", "del", "row"]);
    expect(tableOps("delete", "orders")).toHaveLength(1);
    expect(tableOps("update", "zeffy")[0].set).toEqual({ payload: null });
    expect(tableOps("update", "sessions")[0].set).toMatchObject({ collagePublishedAt: null });
    expect(st.logs.at(-1)).toEqual({ kind: "reset", detail: { orders: 4, stuffies: 5, events: 17, photosDeleted: 2 } });
  });

  it("S5-D2: a purged practice session is returned to draft with both purge markers cleared, so the drill can restart", async () => {
    st.session = sessionRow({ kind: "practice", status: "purged", personalPurgedAt: new Date("2027-01-20T00:00:00Z"), publicPurgedAt: new Date("2027-02-01T00:00:00Z") });
    const { store } = fakeStore();
    st.selects = [[], [{ id: SID }], [{ n: 0 }], [{ orders: 0, stuffies: 0, events: 0 }]];
    const r = await resetPracticeSession(SID, "admin-1", { store, now: NOW });
    expect(r).toMatchObject({ done: true });
    expect(tableOps("update", "sessions")[0].set).toEqual({ collagePublishedAt: null, status: "draft", personalPurgedAt: null, publicPurgedAt: null, updatedAt: NOW });
  });

  it("resumes after a failing delete: the first run keeps its progress and rethrows, the second finishes", async () => {
    st.session = sessionRow({ kind: "practice" });
    const failing = fakeStore(["k-p2"]);
    st.selects = [[photo("p1"), photo("p2")]];
    await expect(resetPracticeSession(SID, "admin-1", { store: failing.store, now: NOW })).rejects.toBeInstanceOf(StorageUnavailable);
    expect(tableOps("delete", "photos")).toHaveLength(1);
    expect(tableOps("delete", "orders")).toHaveLength(0);
    expect(st.transactions).toBe(0);

    st.ops = [];
    const ok = fakeStore();
    st.selects = [[photo("p2")], [], [{ id: SID }], [{ n: 0 }], [{ orders: 1, stuffies: 1, events: 2 }]];
    const r = await resetPracticeSession(SID, "admin-1", { store: ok.store, now: NOW });
    expect(r).toMatchObject({ done: true, photosDeleted: 1 });
    expect(tableOps("delete", "orders")).toHaveLength(1);
  });

  it("time-boxed: returns done:false with the count remaining and deletes no order yet", async () => {
    st.session = sessionRow({ kind: "practice" });
    const { store } = fakeStore();
    let t = 0;
    st.selects = [[photo("p1"), photo("p2")], [{ n: 1 }]];
    const r = await resetPracticeSession(SID, "admin-1", { store, now: NOW, clock: () => (t += 100), budgetMs: 150 });
    expect(r).toMatchObject({ done: false, remaining: 1, photosDeleted: 1, removed: null });
    expect(tableOps("delete", "orders")).toHaveLength(0);
  });
});

describe("getRetentionPreview", () => {
  it("returns counts only, writes nothing, and offers the reset only for a practice session", async () => {
    st.selects = [
      [{ personal: 3, personalBytes: "3000", public: 5, publicBytes: "9000", all: 8, allBytes: "12000" }],
      [{ total: 4, withData: 4 }],
      [{ total: 5, withData: 5 }],
      [{ total: 20, withNote: 2 }],
      [{ n: 4 }],
    ];
    const p = await getRetentionPreview(SID, NOW);
    expect(p).toMatchObject({
      kind: "real",
      today: "2027-02-01",
      personal: { photos: 3, photoBytes: 3000, orders: 4, stuffies: 5, eventNotes: 2, webhookSnapshots: 4, status: { state: "due" } },
      public: { photos: 5, photoBytes: 9000, status: { state: "due" } },
      reset: null,
    });
    expect(st.ops).toEqual([]);

    st.session = sessionRow({ kind: "practice" });
    st.selects = [[{ personal: 0, personalBytes: 0, public: 0, publicBytes: 0, all: 2, allBytes: 10 }], [{ total: 1, withData: 0 }], [{ total: 1, withData: 0 }], [{ total: 3, withNote: 0 }], [{ n: 0 }]];
    expect((await getRetentionPreview(SID, NOW))?.reset).toEqual({ photos: 2, photoBytes: 10, orders: 1, stuffies: 1, events: 3 });
  });

  it("an unknown session is null", async () => {
    st.session = null;
    expect(await getRetentionPreview(SID, NOW)).toBeNull();
  });
});

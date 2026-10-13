/**
 * Every state-changing write, with @/lib/db mocked. The fake is scenario-driven:
 * each test sets what the locked read, the idempotency lookups and the pinned
 * UPDATE return, and the harness records every statement in order, plus whether
 * the transaction committed or rolled back and with which error.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;

const { st } = vi.hoisted(() => ({
  st: {
    log: [] as string[],
    /** Rows the FOR UPDATE lock select returns (the stuffy, and any other locked holder). */
    lockRows: [] as Row[],
    /** What a plain re-read of the stuffy returns. */
    readRow: null as Row | null,
    /** Successive answers to the idempotency lookup outside the transaction. */
    replaySeq: [] as boolean[],
    replayStuffyId: "" as string,
    idemInTx: false,
    /** bindTag's "who holds this sticker" lookup. */
    held: null as Row | null,
    existingPortrait: false,
    pickupEvents: [] as { kind: string; at: Date }[],
    /** Rows a pinned UPDATE ... RETURNING gives back. */
    updateRows: [{ id: "u" }] as Row[],
    eventInsertError: null as unknown,
    updates: [] as { table: string; set: Row }[],
    inserts: [] as { table: string; values: Row | Row[] }[],
    txOutcome: null as null | { committed: boolean; error?: string },
    txStarted: 0,
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const nameOf = (t: unknown) =>
    t === schema.swStuffies ? "stuffies" : t === schema.swStuffyEvents ? "events" : t === schema.swPhotos ? "photos" : t === schema.swOrders ? "orders" : "other";

  function selectBuilder(inTx: boolean, arg: unknown) {
    return {
      from: (t: unknown) => {
        const name = nameOf(t);
        st.log.push(`select:${name}${inTx ? ":tx" : ""}`);
        const rows = (): Row[] => {
          if (name === "stuffies" && inTx) return st.lockRows;
          if (name === "stuffies") return arg === undefined ? (st.readRow ? [st.readRow] : []) : st.held ? [st.held] : [];
          if (name === "events" && inTx) return arg && "kind" in (arg as Row) ? st.pickupEvents.map((e) => ({ kind: e.kind, at: e.at })) : st.idemInTx ? [{ id: "e" }] : [];
          if (name === "events") {
            const hit = st.replaySeq.length > 0 ? st.replaySeq.shift() : false;
            return hit ? [{ stuffyId: st.replayStuffyId }] : [];
          }
          if (name === "photos") return st.existingPortrait ? [{ id: "p-old" }] : [];
          if (name === "orders") return [{ first: "Pat", last: "Example" }];
          return [];
        };
        return {
          where: () => ({
            limit: async () => rows(),
            orderBy: () => ({
              for: async () => {
                st.log.push("lock");
                return rows();
              },
              limit: async () => rows(),
            }),
          }),
          innerJoin: () => ({ where: () => ({ limit: async () => rows() }) }),
        };
      },
    };
  }

  const tx = {
    select: (arg?: unknown) => selectBuilder(true, arg),
    update: (t: unknown) => ({
      set: (set: Row) => ({
        where: () => {
          const name = nameOf(t);
          st.log.push(`update:${name}`);
          st.updates.push({ table: name, set });
          return Object.assign(Promise.resolve(), { returning: async () => (name === "stuffies" ? st.updateRows : []) });
        },
      }),
    }),
    insert: (t: unknown) => ({
      values: async (values: Row | Row[]) => {
        const name = nameOf(t);
        st.log.push(`insert:${name}`);
        if (name === "events" && st.eventInsertError) throw st.eventInsertError;
        st.inserts.push({ table: name, values });
      },
    }),
  };

  return {
    db: {
      select: (arg?: unknown) => selectBuilder(false, arg),
      transaction: async (cb: (t: unknown) => unknown) => {
        st.txStarted += 1;
        const insertsBefore = st.inserts.length;
        const updatesBefore = st.updates.length;
        try {
          const out = await cb(tx);
          st.txOutcome = { committed: true };
          return out;
        } catch (e) {
          st.inserts.length = insertsBefore;
          st.updates.length = updatesBefore;
          st.txOutcome = { committed: false, error: (e as Error).name };
          throw e;
        }
      },
    },
  };
});

import {
  StaleTransitionRollback,
  bindTag,
  checkInStuffy,
  pickupStuffy,
  recordPickupName,
  portraitStuffy,
  recordPickupCheck,
  revertStuffy,
  withdrawStuffy,
  type PhotoWrite,
  type WriteContext,
} from "./stuffy-transitions";

const SESSION = "11111111-1111-4111-8111-111111111111";
const STUFFY = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const KEY = "44444444-4444-4444-8444-444444444444";
const PHOTO_ID = "55555555-5555-4555-8555-555555555555";
const T0 = new Date("2026-12-18T22:00:00Z");

const crew: WriteContext = { sessionId: SESSION, sessionKind: "real", actor: { kind: "crew", deviceId: "d".repeat(22), codeVersion: 3 }, now: T0 };
const practiceCrew: WriteContext = { ...crew, sessionKind: "practice" };
const admin: WriteContext = { sessionId: SESSION, sessionKind: "real", actor: { kind: "admin", userId: "user-1" }, now: T0 };

const stuffy = (over: Row = {}): Row => ({
  id: STUFFY,
  sessionId: SESSION,
  state: "tagged",
  tagCode: "TAG-1",
  withdrawnAt: null,
  pickedUpAt: null,
  taggedAt: T0,
  updatedAt: new Date("2026-12-18T21:00:00Z"),
  ...over,
});

const photo = (over: Partial<PhotoWrite> = {}): PhotoWrite => ({
  id: PHOTO_ID,
  kind: "portrait",
  storageKind: "local",
  storageKey: "folder/full",
  thumbStorageKey: "folder/thumb",
  contentType: "image/jpeg",
  byteSize: 10,
  thumbByteSize: 2,
  width: 100,
  height: 100,
  sha256: "abc",
  takenAt: T0,
  ...over,
});

/** Source with block and line comments removed, so a scan sees code only. */
const codeOnly = (file: string) => readFileSync(join(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const eventsOfKind = (kind: string) => st.inserts.filter((i) => i.table === "events").flatMap((i) => (Array.isArray(i.values) ? i.values : [i.values])).filter((v) => v.kind === kind);

beforeEach(() => {
  st.log = [];
  st.lockRows = [stuffy()];
  st.readRow = stuffy();
  st.replaySeq = [];
  st.replayStuffyId = STUFFY;
  st.idemInTx = false;
  st.held = null;
  st.existingPortrait = false;
  st.pickupEvents = [];
  st.updateRows = [{ id: "u" }];
  st.eventInsertError = null;
  st.updates = [];
  st.inserts = [];
  st.txOutcome = null;
  st.txStarted = 0;
});

describe("idempotency and replay", () => {
  it("the same idempotency key returns the stored result with no second insert", async () => {
    st.replaySeq = [true];
    st.readRow = stuffy({ state: "checked_in" });
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(st.txStarted).toBe(0);
    expect(st.inserts).toHaveLength(0);
  });

  it("a key already used for a different stuffy is refused, not replayed", async () => {
    st.replaySeq = [true];
    st.replayStuffyId = OTHER;
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("a concurrent duplicate (23505 on the idempotency index) replays instead of 500", async () => {
    st.replaySeq = [false, true];
    st.eventInsertError = Object.assign(new Error("dup"), { code: "23505", constraint_name: "ux_sw_stuffy_events_idem" });
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(st.txOutcome).toEqual({ committed: false, error: "Error" });
  });

  it("an idempotency key found again inside the lock replays", async () => {
    st.idemInTx = true;
    st.replaySeq = [false, true];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(st.updates).toHaveLength(0);
  });
});

describe("the pinned-write idiom", () => {
  it("locks the stuffy FOR UPDATE before anything else in the transaction", async () => {
    await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(st.log.indexOf("lock")).toBeGreaterThan(-1);
    expect(st.log.indexOf("lock")).toBeLessThan(st.log.indexOf("update:stuffies"));
  });

  it("a stale expected state is a typed 409 with the current state and time, and writes nothing", async () => {
    st.lockRows = [stuffy({ state: "registered" })];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "stale_state", currentState: "registered" });
    if (!r.ok && r.code === "stale_state") expect(r.since).toEqual(new Date("2026-12-18T21:00:00Z"));
    expect(st.updates).toHaveLength(0);
    expect(st.inserts).toHaveLength(0);
  });

  it("a zero-row pinned UPDATE THROWS the sentinel and rolls back; the caller then answers 409", async () => {
    st.updateRows = [];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", photo: undefined, idempotencyKey: KEY });
    expect(st.txOutcome).toEqual({ committed: false, error: "StaleTransitionRollback" });
    expect(new StaleTransitionRollback()).toBeInstanceOf(Error);
    expect(r).toMatchObject({ ok: false, code: "stale_state" });
    expect(st.inserts).toHaveLength(0);
  });

  it("a stuffy of another session is not found (the lock is scoped to the credential's session)", async () => {
    st.lockRows = [];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
    expect(st.updates).toHaveLength(0);
  });

  it("a withdrawn stuffy is refused", async () => {
    st.lockRows = [stuffy({ withdrawnAt: T0 })];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "withdrawn" });
  });

  it("nothing in the module holds a transaction open across the photo store or Zeffy (it imports neither)", () => {
    expect(codeOnly("stuffy-transitions.ts")).not.toMatch(/photo-store|@\/lib\/zeffy|fetch\(/);
  });
});

describe("actors", () => {
  it("a crew actor records the device and code version and no user", async () => {
    await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    const ev = eventsOfKind("transition")[0];
    expect(ev).toMatchObject({ actorKind: "crew", deviceId: "d".repeat(22), codeVersion: 3, userId: null, sessionId: SESSION });
  });

  it("an admin actor records device 'admin' and the user id", async () => {
    await checkInStuffy(admin, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(eventsOfKind("transition")[0]).toMatchObject({ actorKind: "admin", deviceId: "admin", userId: "user-1", codeVersion: null });
  });
});

describe("check-in", () => {
  it("moves tagged to checked_in, stamps the time and writes one history row plus the photo", async () => {
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: PHOTO_ID, photo: photo({ kind: "check_in", thumbStorageKey: null }) });
    expect(r).toMatchObject({ ok: true, replayed: false });
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ state: "checked_in", checkedInAt: T0 });
    expect(st.inserts.some((i) => i.table === "photos")).toBe(true);
    expect(eventsOfKind("transition")[0]).toMatchObject({ fromState: "tagged", toState: "checked_in", idempotencyKey: PHOTO_ID });
  });

  it("check-in without a photo records the state, no photo row, and a flagged history note", async () => {
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY });
    expect(r.ok).toBe(true);
    expect(st.inserts.some((i) => i.table === "photos")).toBe(false);
    expect(eventsOfKind("transition")[0]).toMatchObject({ note: "without_photo" });
  });

  it("Continue on the refunded banner is recorded in the history", async () => {
    await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", idempotencyKey: KEY, refundContinue: true });
    expect(eventsOfKind("refund_continue")).toHaveLength(1);
  });

  it("a registered stuffy cannot be checked in (the table refuses it, not a screen)", async () => {
    st.lockRows = [stuffy({ state: "registered" })];
    const r = await checkInStuffy(crew, { stuffyId: STUFFY, expectedState: "registered", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "illegal_transition" });
  });
});

describe("portrait: one current portrait", () => {
  it("a first portrait moves checked_in to portrait_taken", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    const r = await portraitStuffy(crew, { stuffyId: STUFFY, expectedState: "checked_in", photo: photo(), replace: false });
    expect(r.ok).toBe(true);
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ state: "portrait_taken", portraitAt: T0 });
  });

  it("a retake supersedes the old current portrait BEFORE inserting the new one", async () => {
    st.lockRows = [stuffy({ state: "portrait_taken" })];
    st.existingPortrait = true;
    const r = await portraitStuffy(crew, { stuffyId: STUFFY, expectedState: "portrait_taken", photo: photo(), replace: true });
    expect(r.ok).toBe(true);
    expect(st.log.indexOf("update:photos")).toBeGreaterThan(-1);
    expect(st.log.indexOf("update:photos")).toBeLessThan(st.log.indexOf("insert:photos"));
    expect(st.updates.find((u) => u.table === "photos")?.set).toMatchObject({ supersededAt: T0, supersededByPhotoId: PHOTO_ID });
    expect(eventsOfKind("transition")[0]).toMatchObject({ note: "retake" });
  });

  it("a portrait over an existing one without replace:true is 409 portrait_exists", async () => {
    st.lockRows = [stuffy({ state: "portrait_taken" })];
    st.existingPortrait = true;
    const r = await portraitStuffy(crew, { stuffyId: STUFFY, expectedState: "portrait_taken", photo: photo(), replace: false });
    expect(r).toMatchObject({ ok: false, code: "portrait_exists" });
    expect(st.inserts).toHaveLength(0);
  });

  it("a portrait cannot be taken before check-in", async () => {
    const r = await portraitStuffy(crew, { stuffyId: STUFFY, expectedState: "tagged", photo: photo(), replace: false });
    expect(r).toMatchObject({ ok: false, code: "illegal_transition" });
  });
});

describe("pickup", () => {
  it("without a prior pickup-check is pickup_check_required, and nothing is written", async () => {
    st.lockRows = [stuffy({ state: "portrait_taken" })];
    const r = await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "portrait_taken", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "pickup_check_required" });
    expect(st.updates).toHaveLength(0);
  });

  it("with a pickup-check it succeeds, even with no portrait (a stuffy that skipped the portrait still goes home)", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [{ kind: "pickup_check", at: new Date("2026-12-18T21:30:00Z") }];
    const r = await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "checked_in", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: true, replayed: false });
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ state: "picked_up", pickedUpAt: T0 });
  });

  it("an admin revert after the check invalidates it: the check must be redone", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [
      { kind: "revert", at: new Date("2026-12-18T21:45:00Z") },
      { kind: "pickup_check", at: new Date("2026-12-18T21:30:00Z") },
    ];
    const r = await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "checked_in", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "pickup_check_required" });
  });

  it("is not blocked by a refund flag or a storage failure: the module reads neither", () => {
    const source = codeOnly("stuffy-transitions.ts");
    const pickup = source.slice(source.indexOf("export async function pickupStuffy"), source.indexOf("export interface RevertInput"));
    expect(pickup).not.toMatch(/refund|storage|photo|portrait/i);
  });

  it("a second tap with a different key returns already_picked_up with the time", async () => {
    const at = new Date("2026-12-18T21:59:00Z");
    st.lockRows = [stuffy({ state: "picked_up", pickedUpAt: at })];
    const r = await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "portrait_taken", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "already_picked_up", at });
  });

  it("cannot pick up a tagged stuffy (skipping states)", async () => {
    st.pickupEvents = [{ kind: "pickup_check", at: T0 }];
    const r = await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "checked_in", idempotencyKey: KEY });
    expect(r.ok).toBe(false);
  });

  it("pickup-check records the human step as a history row with no state change", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [{ kind: "name_shown", at: new Date("2026-12-18T21:00:00Z") }];
    const r = await recordPickupCheck(crew, { stuffyId: STUFFY, result: "someone_else", note: "Grandma", idempotencyKey: KEY });
    expect(r.ok).toBe(true);
    expect(st.updates).toHaveLength(0);
    expect(eventsOfKind("pickup_check")[0]).toMatchObject({ note: "someone_else: Grandma", fromState: "checked_in", toState: "checked_in" });
  });

  it("pickup-check without a name_shown is name_not_shown and writes nothing", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    const r = await recordPickupCheck(crew, { stuffyId: STUFFY, result: "matched", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "name_not_shown" });
    expect(st.inserts).toHaveLength(0);
  });

  it("pickup-check records matched and someone_else with its note once the name was shown", async () => {
    st.lockRows = [stuffy({ state: "portrait_taken" })];
    st.pickupEvents = [{ kind: "name_shown", at: T0 }];
    await recordPickupCheck(crew, { stuffyId: STUFFY, result: "matched", idempotencyKey: KEY });
    expect(eventsOfKind("pickup_check")[0]).toMatchObject({ note: "matched" });
  });

  it("a name_shown older than a revert does not satisfy pickup-check", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [
      { kind: "revert", at: new Date("2026-12-18T21:45:00Z") },
      { kind: "name_shown", at: new Date("2026-12-18T21:30:00Z") },
    ];
    expect(await recordPickupCheck(crew, { stuffyId: STUFFY, result: "matched", idempotencyKey: KEY })).toMatchObject({ ok: false, code: "name_not_shown" });
  });

  it("pickup-check on an already picked-up stuffy says so", async () => {
    st.lockRows = [stuffy({ state: "picked_up", pickedUpAt: T0 })];
    const r = await recordPickupCheck(crew, { stuffyId: STUFFY, result: "matched", idempotencyKey: KEY });
    expect(r).toMatchObject({ ok: false, code: "already_picked_up" });
  });
});

describe("pickup-name (the reveal)", () => {
  it.each(["checked_in", "portrait_taken"] as const)("from %s records name_shown with no state change", async (state) => {
    st.lockRows = [stuffy({ state })];
    const r = await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY });
    expect(r.ok).toBe(true);
    expect(st.updates).toHaveLength(0);
    expect(eventsOfKind("name_shown")).toEqual([expect.objectContaining({ fromState: state, toState: state, note: null, idempotencyKey: KEY })]);
  });

  it("a repeat after the last revert returns ok and writes no second row", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [{ kind: "name_shown", at: T0 }];
    expect((await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY })).ok).toBe(true);
    expect(st.inserts).toHaveLength(0);
  });

  it("a name_shown older than a revert is shown again (a new row)", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [
      { kind: "revert", at: new Date("2026-12-18T21:45:00Z") },
      { kind: "name_shown", at: new Date("2026-12-18T21:30:00Z") },
    ];
    await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY });
    expect(eventsOfKind("name_shown")).toHaveLength(1);
  });

  it("from registered or tagged it is illegal_transition; from picked_up already_picked_up", async () => {
    for (const state of ["registered", "tagged"] as const) {
      st.lockRows = [stuffy({ state })];
      expect(await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY })).toMatchObject({ ok: false, code: "illegal_transition" });
    }
    st.lockRows = [stuffy({ state: "picked_up", pickedUpAt: T0 })];
    expect(await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY })).toMatchObject({ ok: false, code: "already_picked_up" });
  });

  it("another session's stuffy is not found", async () => {
    st.lockRows = [];
    expect(await recordPickupName(crew, { stuffyId: STUFFY, idempotencyKey: KEY })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("a revert resets the pair: after one, pickup needs the sequence again", async () => {
    st.lockRows = [stuffy({ state: "checked_in" })];
    st.pickupEvents = [
      { kind: "revert", at: new Date("2026-12-18T21:45:00Z") },
      { kind: "pickup_check", at: new Date("2026-12-18T21:30:00Z") },
    ];
    expect(await pickupStuffy(crew, { stuffyId: STUFFY, expectedState: "checked_in", idempotencyKey: KEY })).toMatchObject({ ok: false, code: "pickup_check_required" });
  });
});

describe("revert and withdraw", () => {
  it("a crew revert on a real session is practice_only and touches nothing", async () => {
    const r = await revertStuffy(crew, { stuffyId: STUFFY, toState: "registered", expectedState: "tagged" });
    expect(r).toMatchObject({ ok: false, code: "practice_only" });
    expect(st.txStarted).toBe(0);
  });

  it("a crew revert on a practice session is allowed", async () => {
    const r = await revertStuffy(practiceCrew, { stuffyId: STUFFY, toState: "registered", expectedState: "tagged" });
    expect(r.ok).toBe(true);
  });

  it("revert to registered clears the tag code with a retire event carrying the old code", async () => {
    const r = await revertStuffy(admin, { stuffyId: STUFFY, toState: "registered", expectedState: "tagged", reason: "wrong sticker" });
    expect(r.ok).toBe(true);
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ state: "registered", tagCode: null, taggedAt: null });
    expect(eventsOfKind("revert")[0]).toMatchObject({ prevTagCode: "TAG-1", note: "wrong sticker", fromState: "tagged", toState: "registered" });
  });

  it("revert clears the stamps of every state it leaves", async () => {
    st.lockRows = [stuffy({ state: "picked_up" })];
    await revertStuffy(admin, { stuffyId: STUFFY, toState: "checked_in", expectedState: "picked_up", reason: "mistake" });
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ state: "checked_in", portraitAt: null, pickedUpAt: null });
    expect(st.updates.find((u) => u.table === "stuffies")?.set).not.toHaveProperty("checkedInAt");
  });

  it("a forward 'revert' is illegal", async () => {
    const r = await revertStuffy(admin, { stuffyId: STUFFY, toState: "checked_in", expectedState: "tagged", reason: "x" });
    expect(r).toMatchObject({ ok: false, code: "illegal_transition" });
  });

  it("withdraw is allowed from registered or tagged, and refused in custody", async () => {
    const ok = await withdrawStuffy(admin as WriteContext & { actor: { kind: "admin"; userId: string } }, { stuffyId: STUFFY, reason: "duplicate" });
    expect(ok.ok).toBe(true);
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ withdrawnReason: "duplicate", withdrawnByUserId: "user-1" });
    expect(eventsOfKind("withdraw")).toHaveLength(1);

    st.lockRows = [stuffy({ state: "checked_in" })];
    const refused = await withdrawStuffy(admin as WriteContext & { actor: { kind: "admin"; userId: string } }, { stuffyId: STUFFY, reason: "duplicate" });
    expect(refused).toMatchObject({ ok: false, code: "withdraw_not_allowed", currentState: "checked_in" });
  });

  it("withdrawing an already-withdrawn stuffy is an idempotent success", async () => {
    st.lockRows = [stuffy({ withdrawnAt: T0 })];
    const r = await withdrawStuffy(admin as WriteContext & { actor: { kind: "admin"; userId: string } }, { stuffyId: STUFFY, reason: "again" });
    expect(r.ok).toBe(true);
    expect(st.updates).toHaveLength(0);
  });
});

describe("tag binding through the database layer", () => {
  const bindInput = { stuffyId: STUFFY, code: "NEW-CODE", expectedState: "registered" as const, expectedTagCode: null, idempotencyKey: KEY };

  it("an unbound code binds: tagged, a tag_bound event, the sticker and stamp set", async () => {
    st.lockRows = [stuffy({ state: "registered", tagCode: null })];
    const r = await bindTag(crew, bindInput);
    expect(r.ok).toBe(true);
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ tagCode: "NEW-CODE", state: "tagged", taggedAt: T0 });
    expect(eventsOfKind("tag_bound")[0]).toMatchObject({ tagCode: "NEW-CODE", fromState: "registered", toState: "tagged", idempotencyKey: KEY });
  });

  it("the same stuffy holding the same code is a no-op with NO history row", async () => {
    st.held = { id: STUFFY, name: "Barnaby", state: "tagged", withdrawnAt: null, orderSize: 1 };
    st.lockRows = [stuffy({ state: "tagged", tagCode: "NEW-CODE" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: "NEW-CODE" });
    expect(r.ok).toBe(true);
    expect(st.inserts).toHaveLength(0);
    expect(st.updates).toHaveLength(0);
  });

  it("a code held by another tagged stuffy is confirm_move naming it; nothing is written", async () => {
    st.held = { id: OTHER, name: "Barnaby", state: "tagged", withdrawnAt: null, orderSize: 1 };
    st.lockRows = [stuffy({ state: "registered", tagCode: null }), stuffy({ id: OTHER, state: "tagged", tagCode: "NEW-CODE" })];
    const r = await bindTag(crew, bindInput);
    expect(r).toMatchObject({ ok: false, code: "confirm_move", otherStuffyName: "Barnaby" });
    expect(st.updates).toHaveLength(0);
  });

  it("a confirmed move frees the holder FIRST, then binds: both events, the holder back to registered", async () => {
    st.held = { id: OTHER, name: "Barnaby", state: "tagged", withdrawnAt: null, orderSize: 1 };
    st.lockRows = [stuffy({ state: "registered", tagCode: null }), stuffy({ id: OTHER, state: "tagged", tagCode: "NEW-CODE" })];
    const r = await bindTag(crew, { ...bindInput, confirm: "move" });
    expect(r.ok).toBe(true);
    const sets = st.updates.filter((u) => u.table === "stuffies").map((u) => u.set);
    expect(sets[0]).toMatchObject({ state: "registered", tagCode: null });
    expect(sets[1]).toMatchObject({ tagCode: "NEW-CODE", state: "tagged" });
    expect(eventsOfKind("tag_moved_out")[0]).toMatchObject({ prevTagCode: "NEW-CODE", toState: "registered" });
    expect(eventsOfKind("tag_moved_in")).toHaveLength(1);
  });

  it("a code held by a stuffy already checked in is holder_advanced, even with confirm", async () => {
    st.held = { id: OTHER, name: "Barnaby", state: "checked_in", withdrawnAt: null, orderSize: 1 };
    st.lockRows = [stuffy({ state: "registered", tagCode: null }), stuffy({ id: OTHER, state: "checked_in", tagCode: "NEW-CODE" })];
    const r = await bindTag(crew, { ...bindInput, confirm: "move" });
    expect(r).toMatchObject({ ok: false, code: "holder_advanced", otherStuffyName: "Barnaby" });
    expect(st.updates).toHaveLength(0);
  });

  it("a different existing sticker is confirm_replace with the last 4; confirmed, the old code is kept as prev_tag_code", async () => {
    st.lockRows = [stuffy({ state: "tagged", tagCode: "OLD-12345678" })];
    const ask = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: "OLD-12345678" });
    expect(ask).toMatchObject({ ok: false, code: "confirm_replace", oldLast4: "5678" });
    const done = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: "OLD-12345678", confirm: "replace" });
    expect(done.ok).toBe(true);
    expect(eventsOfKind("tag_replaced")[0]).toMatchObject({ prevTagCode: "OLD-12345678", tagCode: "NEW-CODE" });
  });

  it("replace by last four: a matching tail succeeds, pins on the stored code and records old and new", async () => {
    st.lockRows = [stuffy({ state: "tagged", tagCode: "OLD-12345678" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: null, expectedLast4: "5678", confirm: "replace" });
    expect(r.ok).toBe(true);
    expect(st.updates.find((u) => u.table === "stuffies")?.set).toMatchObject({ tagCode: "NEW-CODE", state: "tagged" });
    expect(eventsOfKind("tag_replaced")[0]).toMatchObject({ prevTagCode: "OLD-12345678", tagCode: "NEW-CODE" });
  });

  it("replace by last four: a mismatched tail is stale_state and writes nothing", async () => {
    st.lockRows = [stuffy({ state: "tagged", tagCode: "OLD-12345678" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: null, expectedLast4: "0000", confirm: "replace" });
    expect(r).toMatchObject({ ok: false, code: "stale_state" });
    expect(st.updates).toHaveLength(0);
  });

  it("without confirm, a last-four tail still gets the collision refusal", async () => {
    st.lockRows = [stuffy({ state: "tagged", tagCode: "OLD-12345678" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: null, expectedLast4: "5678" });
    expect(r).toMatchObject({ ok: false, code: "confirm_replace", oldLast4: "5678" });
    expect(st.updates).toHaveLength(0);
  });

  it("replace onto a sticker bound elsewhere is still refused (holder rules win)", async () => {
    st.held = { id: OTHER, name: "Barnaby", state: "checked_in", withdrawnAt: null, orderSize: 1 };
    st.lockRows = [stuffy({ state: "tagged", tagCode: "OLD-12345678" }), stuffy({ id: OTHER, state: "checked_in", tagCode: "NEW-CODE" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: null, expectedLast4: "5678", confirm: "replace" });
    expect(r).toMatchObject({ ok: false, code: "holder_advanced" });
    expect(st.updates).toHaveLength(0);
  });

  it("two workers binding one code at once: the unique index decides and the loser gets tag_already_bound, never a 500", async () => {
    st.lockRows = [stuffy({ state: "registered", tagCode: null })];
    st.eventInsertError = null;
    st.updateRows = [{ id: "u" }];
    // The unique violation surfaces from the UPDATE in real life; simulate it on the event insert for the harness.
    st.eventInsertError = Object.assign(new Error("dup"), { code: "23505", constraint_name: "ux_sw_stuffies_tag" });
    const r = await bindTag(crew, bindInput);
    expect(r).toMatchObject({ ok: false, code: "tag_already_bound" });
  });

  it("a tag changes only when the client's expected sticker still matches (stale otherwise)", async () => {
    st.lockRows = [stuffy({ state: "tagged", tagCode: "SOMEONE-ELSE-SET-THIS" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "tagged", expectedTagCode: null });
    expect(r).toMatchObject({ ok: false, code: "stale_state" });
  });

  it("a stuffy past tagged cannot be re-tagged", async () => {
    st.lockRows = [stuffy({ state: "checked_in", tagCode: "OLD" })];
    const r = await bindTag(crew, { ...bindInput, expectedState: "checked_in", expectedTagCode: "OLD" });
    expect(r).toMatchObject({ ok: false, code: "illegal_transition" });
  });
});

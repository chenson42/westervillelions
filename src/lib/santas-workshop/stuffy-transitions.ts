/**
 * Every state-changing write to a stuffy (Phase 3, "State machine and the write
 * idiom"). Hermetic-test style of ledger-approval-decision.ts. For each write:
 *
 *   1. idempotency pre-read: an event with (session, idempotency_key) returns the
 *      stored result (`replayed: true`);
 *   2. db.transaction: SELECT ... FOR UPDATE on the stuffy (the session comes from
 *      the credential, never the body, so a stuffy of another session is a 404: the
 *      IDOR guard); re-read the idempotency key inside the lock;
 *   3. a withdrawn stuffy is refused; a stale expected state is a typed 409;
 *   4. the table (state-machine.ts) decides legality;
 *   5. ONE UPDATE pinned on the expected state; ZERO rows throws
 *      StaleTransitionRollback (a plain `return` from db.transaction COMMITS);
 *   6. the sw_stuffy_events row (and for photo transitions the sw_photos row; a
 *      retake first supersedes the old current photo so the partial unique index
 *      never sees two);
 *   7. the sentinel is caught OUTSIDE the transaction, the row re-read once, and
 *      the same 409 returned. A 23505 on the idempotency index is a replay.
 *
 * Never holds a lock across a photo-store or Zeffy call: uploads happen BEFORE
 * this module is called. No email; no console output.
 */

import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swPhotos, swStuffies, swStuffyEvents, type SwStuffy } from "@/lib/db/schema";
import { displayStuffyName } from "./payment-mapper";
import { canRevert, canTransition, isBackward, isPickupAllowedFrom, isStuffyState, STUFFY_STATES, stateIndex, type StuffyState } from "./state-machine";
import { decideTagBind, last4, type TagHolder } from "./tag-binding";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Actor =
  | { kind: "crew"; deviceId: string; codeVersion: number }
  | { kind: "admin"; userId: string };

export interface WriteContext {
  sessionId: string;
  sessionKind: "practice" | "real";
  actor: Actor;
  /** Injected clock for tests. */
  now?: Date;
}

export type TransitionFailure =
  | { ok: false; code: "not_found" }
  | { ok: false; code: "stale_state"; currentState: StuffyState; since: Date }
  | { ok: false; code: "withdrawn" }
  | { ok: false; code: "illegal_transition"; currentState: StuffyState }
  | { ok: false; code: "already_picked_up"; at: Date }
  | { ok: false; code: "pickup_check_required" }
  | { ok: false; code: "name_not_shown" }
  | { ok: false; code: "portrait_exists" }
  | { ok: false; code: "practice_only" }
  | { ok: false; code: "confirm_move"; otherStuffyName: string }
  | { ok: false; code: "confirm_replace"; oldLast4: string }
  | { ok: false; code: "holder_advanced"; otherStuffyName: string }
  | { ok: false; code: "tag_already_bound" }
  | { ok: false; code: "withdraw_not_allowed"; currentState: StuffyState }
  | { ok: false; code: "invalid_input"; error: string };

export type TransitionSuccess = { ok: true; replayed: boolean; stuffy: SwStuffy };
export type TransitionResult = TransitionSuccess | TransitionFailure;

/** Thrown inside the transaction when a pinned UPDATE matched zero rows; rolls everything back. */
export class StaleTransitionRollback extends Error {
  constructor() {
    super("stale transition");
    this.name = "StaleTransitionRollback";
  }
}

export interface PhotoWrite {
  /** The client-generated photo id; also the idempotency key. */
  id: string;
  kind: "check_in" | "portrait";
  storageKind: string;
  storageKey: string;
  thumbStorageKey: string | null;
  contentType: string;
  byteSize: number;
  thumbByteSize: number | null;
  width: number;
  height: number;
  sha256: string;
  takenAt: Date;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function isUniqueViolation(e: unknown, hint?: string): boolean {
  const err = e as { code?: string; constraint_name?: string; constraint?: string; cause?: { code?: string; constraint_name?: string; constraint?: string } } | null;
  if ((err?.code ?? err?.cause?.code) !== "23505") return false;
  if (!hint) return true;
  const name = err?.constraint_name ?? err?.constraint ?? err?.cause?.constraint_name ?? err?.cause?.constraint ?? "";
  return name.includes(hint);
}

const STAMP_COLUMN = {
  registered: null,
  tagged: "taggedAt",
  checked_in: "checkedInAt",
  portrait_taken: "portraitAt",
  picked_up: "pickedUpAt",
} as const satisfies Record<StuffyState, string | null>;

function stuffyState(row: SwStuffy): StuffyState {
  return isStuffyState(row.state) ? row.state : "registered";
}

// ---------------------------------------------------------------------------
// Event + actor columns
// ---------------------------------------------------------------------------

export interface EventInput {
  kind: string;
  fromState?: StuffyState | null;
  toState?: StuffyState | null;
  tagCode?: string | null;
  prevTagCode?: string | null;
  idempotencyKey?: string | null;
  clientTakenAt?: Date | null;
  note?: string | null;
}

export function eventRow(ctx: WriteContext, stuffyId: string, e: EventInput) {
  const a = ctx.actor;
  return {
    sessionId: ctx.sessionId,
    stuffyId,
    kind: e.kind,
    fromState: e.fromState ?? null,
    toState: e.toState ?? null,
    tagCode: e.tagCode ?? null,
    prevTagCode: e.prevTagCode ?? null,
    actorKind: a.kind,
    deviceId: a.kind === "crew" ? a.deviceId : "admin",
    codeVersion: a.kind === "crew" ? a.codeVersion : null,
    userId: a.kind === "admin" ? a.userId : null,
    idempotencyKey: e.idempotencyKey ?? null,
    clientTakenAt: e.clientTakenAt ?? null,
    note: e.note ? e.note.slice(0, 500) : null,
  };
}

async function insertEvents(tx: Tx, ctx: WriteContext, stuffyId: string, events: EventInput[]): Promise<void> {
  await tx.insert(swStuffyEvents).values(events.map((e) => eventRow(ctx, stuffyId, e)));
}

/** One UPDATE pinned on the given predicates; zero rows rolls the transaction back. */
async function pinnedUpdate(tx: Tx, stuffyId: string, sessionId: string, pins: SQL[], set: Partial<typeof swStuffies.$inferInsert>): Promise<void> {
  const rows = await tx
    .update(swStuffies)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, sessionId), ...pins))
    .returning({ id: swStuffies.id });
  if (rows.length === 0) throw new StaleTransitionRollback();
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

interface WriteSpec {
  stuffyId: string;
  idempotencyKey: string | null;
  /** Extra stuffy ids to lock in the same statement (id order), e.g. the sticker's current holder. */
  alsoLock?: string[];
  /** Admin withdraw is idempotent on an already-withdrawn row. */
  allowWithdrawn?: boolean;
  /** Returns a failure, or null on success. May throw StaleTransitionRollback. */
  body(tx: Tx, row: SwStuffy, locked: Map<string, SwStuffy>): Promise<TransitionFailure | null>;
}

async function readStuffy(sessionId: string, stuffyId: string): Promise<SwStuffy | null> {
  const [row] = await db.select().from(swStuffies).where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, sessionId))).limit(1);
  return row ?? null;
}

async function replayFor(sessionId: string, stuffyId: string, idempotencyKey: string | null): Promise<TransitionResult | null> {
  if (!idempotencyKey) return null;
  const [hit] = await db
    .select({ stuffyId: swStuffyEvents.stuffyId })
    .from(swStuffyEvents)
    .where(and(eq(swStuffyEvents.sessionId, sessionId), eq(swStuffyEvents.idempotencyKey, idempotencyKey)))
    .limit(1);
  if (!hit) return null;
  if (hit.stuffyId !== stuffyId) return { ok: false, code: "invalid_input", error: "That request id was already used for something else" };
  const row = await readStuffy(sessionId, stuffyId);
  return row ? { ok: true, replayed: true, stuffy: row } : { ok: false, code: "not_found" };
}

async function staleFailure(sessionId: string, stuffyId: string): Promise<TransitionFailure> {
  const row = await readStuffy(sessionId, stuffyId);
  if (!row) return { ok: false, code: "not_found" };
  return { ok: false, code: "stale_state", currentState: stuffyState(row), since: row.updatedAt };
}

async function runStuffyWrite(ctx: WriteContext, spec: WriteSpec): Promise<TransitionResult> {
  const replay = await replayFor(ctx.sessionId, spec.stuffyId, spec.idempotencyKey);
  if (replay) return replay;

  try {
    const outcome = await db.transaction(async (tx): Promise<TransitionFailure | null | "replay"> => {
      const ids = [spec.stuffyId, ...(spec.alsoLock ?? [])];
      const lockedRows = await tx
        .select()
        .from(swStuffies)
        .where(and(inArray(swStuffies.id, ids), eq(swStuffies.sessionId, ctx.sessionId)))
        .orderBy(asc(swStuffies.id))
        .for("update");
      const locked = new Map(lockedRows.map((r) => [r.id, r]));
      const row = locked.get(spec.stuffyId);
      if (!row) return { ok: false, code: "not_found" };

      if (spec.idempotencyKey) {
        const [again] = await tx
          .select({ id: swStuffyEvents.id })
          .from(swStuffyEvents)
          .where(and(eq(swStuffyEvents.sessionId, ctx.sessionId), eq(swStuffyEvents.idempotencyKey, spec.idempotencyKey)))
          .limit(1);
        if (again) return "replay";
      }
      if (row.withdrawnAt && !spec.allowWithdrawn) return { ok: false, code: "withdrawn" };
      return spec.body(tx, row, locked);
    });

    if (outcome === "replay") return (await replayFor(ctx.sessionId, spec.stuffyId, spec.idempotencyKey)) ?? (await staleFailure(ctx.sessionId, spec.stuffyId));
    if (outcome) return outcome;
    const row = await readStuffy(ctx.sessionId, spec.stuffyId);
    return row ? { ok: true, replayed: false, stuffy: row } : { ok: false, code: "not_found" };
  } catch (e) {
    if (e instanceof StaleTransitionRollback) return staleFailure(ctx.sessionId, spec.stuffyId);
    if (isUniqueViolation(e)) {
      // A concurrent duplicate of the same request replays; a concurrent bind of the same sticker is the typed already-bound path.
      const replay2 = await replayFor(ctx.sessionId, spec.stuffyId, spec.idempotencyKey);
      if (replay2) return replay2;
      if (isUniqueViolation(e, "ux_sw_stuffies_tag")) return { ok: false, code: "tag_already_bound" };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Photo rows
// ---------------------------------------------------------------------------

async function writePhoto(tx: Tx, ctx: WriteContext, stuffyId: string, photo: PhotoWrite, now: Date): Promise<void> {
  // Supersede the current photo of this kind first, so the partial unique index never sees two.
  await tx
    .update(swPhotos)
    .set({ supersededAt: now, supersededByPhotoId: photo.id })
    .where(and(eq(swPhotos.stuffyId, stuffyId), eq(swPhotos.kind, photo.kind), isNull(swPhotos.supersededAt)));
  await tx.insert(swPhotos).values({
    id: photo.id,
    sessionId: ctx.sessionId,
    stuffyId,
    kind: photo.kind,
    storageKind: photo.storageKind,
    storageKey: photo.storageKey,
    thumbStorageKey: photo.thumbStorageKey,
    contentType: photo.contentType,
    byteSize: photo.byteSize,
    thumbByteSize: photo.thumbByteSize,
    width: photo.width,
    height: photo.height,
    sha256: photo.sha256,
    takenAt: photo.takenAt,
    deviceId: ctx.actor.kind === "crew" ? ctx.actor.deviceId : "admin",
    recordedByUserId: ctx.actor.kind === "admin" ? ctx.actor.userId : null,
  });
}

// ---------------------------------------------------------------------------
// Generic forward move
// ---------------------------------------------------------------------------

function checkExpected(row: SwStuffy, expected: StuffyState): TransitionFailure | null {
  if (stuffyState(row) !== expected) return { ok: false, code: "stale_state", currentState: stuffyState(row), since: row.updatedAt };
  return null;
}

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

export interface BindTagInput {
  stuffyId: string;
  code: string;
  expectedState: StuffyState;
  expectedTagCode: string | null;
  /** Crew callers only know the last four characters: when set, it replaces the full-code check (compared inside the lock). */
  expectedLast4?: string | null;
  confirm?: "move" | "replace";
  idempotencyKey: string;
  clientTakenAt?: Date | null;
}

/** The optimistic-concurrency check on the sticker: the full code (admin) or its last four (crew DTOs carry only that). */
function tagMatches(stored: string | null, input: Pick<BindTagInput, "expectedTagCode" | "expectedLast4">): boolean {
  if (input.expectedLast4 !== undefined && input.expectedLast4 !== null) return stored !== null && last4(stored) === input.expectedLast4;
  return stored === input.expectedTagCode;
}

export async function bindTag(ctx: WriteContext, input: BindTagInput): Promise<TransitionResult> {
  const now = ctx.now ?? new Date();
  const replay = await replayFor(ctx.sessionId, input.stuffyId, input.idempotencyKey);
  if (replay) return replay;

  // Who holds this sticker right now (session-scoped: another session's sticker is invisible here).
  const [held] = await db
    .select({
      id: swStuffies.id,
      name: swStuffies.name,
      state: swStuffies.state,
      withdrawnAt: swStuffies.withdrawnAt,
      orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
    })
    .from(swStuffies)
    .where(and(eq(swStuffies.sessionId, ctx.sessionId), eq(swStuffies.tagCode, input.code)))
    .limit(1);

  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.idempotencyKey,
    alsoLock: held && held.id !== input.stuffyId ? [held.id] : [],
    async body(tx, row, locked) {
      const sameHolder = held?.id === row.id;
      if (held && !sameHolder) {
        // The holder must still be who we read before locking.
        const lockedHolder = locked.get(held.id);
        if (!lockedHolder || lockedHolder.tagCode !== input.code) throw new StaleTransitionRollback();
      }
      if (!sameHolder) {
        const stale = checkExpected(row, input.expectedState);
        if (stale) return stale;
        if (!tagMatches(row.tagCode, input)) return { ok: false, code: "stale_state", currentState: stuffyState(row), since: row.updatedAt };
      }

      const holder: TagHolder | null = held
        ? {
            id: held.id,
            displayName: displayStuffyName(held.name, held.orderSize),
            state: isStuffyState(held.state) ? held.state : "registered",
            withdrawn: held.withdrawnAt !== null,
          }
        : null;
      const decision = decideTagBind({
        target: { id: row.id, state: stuffyState(row), tagCode: row.tagCode },
        holder,
        code: input.code,
        confirm: input.confirm,
      });

      switch (decision.kind) {
        case "noop":
          return null;
        case "illegal":
          return { ok: false, code: "illegal_transition", currentState: stuffyState(row) };
        case "confirm_move":
          return { ok: false, code: "confirm_move", otherStuffyName: decision.otherStuffyName };
        case "holder_advanced":
          return { ok: false, code: "holder_advanced", otherStuffyName: decision.otherStuffyName };
        case "confirm_replace":
          return { ok: false, code: "confirm_replace", oldLast4: decision.oldLast4 };
        case "bind":
        case "replace":
        case "move": {
          // Free the sticker first when it moves, so the unique (session, tag_code) index is satisfied.
          if (decision.kind === "move") {
            const holderRow = locked.get(decision.holderId) as SwStuffy;
            await pinnedUpdate(tx, holderRow.id, ctx.sessionId, [eq(swStuffies.tagCode, input.code), inArray(swStuffies.state, ["registered", "tagged"])], {
              state: "registered",
              tagCode: null,
              taggedAt: null,
            });
            await insertEvents(tx, ctx, holderRow.id, [
              { kind: "tag_moved_out", fromState: stuffyState(holderRow), toState: "registered", prevTagCode: input.code },
            ]);
          }
          const fromState = stuffyState(row);
          const prev = decision.kind === "replace" ? decision.prevTagCode : decision.kind === "move" ? decision.prevTagCode : null;
          await pinnedUpdate(
            tx,
            row.id,
            ctx.sessionId,
            [eq(swStuffies.state, fromState), row.tagCode === null ? isNull(swStuffies.tagCode) : eq(swStuffies.tagCode, row.tagCode)],
            { tagCode: input.code, state: "tagged", taggedAt: fromState === "registered" ? now : (row.taggedAt ?? now) },
          );
          await insertEvents(tx, ctx, row.id, [
            {
              kind: decision.kind === "bind" ? "tag_bound" : decision.kind === "replace" ? "tag_replaced" : "tag_moved_in",
              fromState,
              toState: "tagged",
              tagCode: input.code,
              prevTagCode: prev,
              idempotencyKey: input.idempotencyKey,
              clientTakenAt: input.clientTakenAt ?? null,
            },
          ]);
          return null;
        }
        default: {
          const _never: never = decision;
          return _never;
        }
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Check-in and portrait
// ---------------------------------------------------------------------------

export interface CheckInInput {
  stuffyId: string;
  expectedState: StuffyState;
  /** Absent: "check in without a photo" (allowed; flagged by the derived no-current-photo condition). */
  photo?: PhotoWrite;
  idempotencyKey: string;
  clientTakenAt?: Date | null;
  refundContinue?: boolean;
}

export async function checkInStuffy(ctx: WriteContext, input: CheckInInput): Promise<TransitionResult> {
  const now = ctx.now ?? new Date();
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.idempotencyKey,
    async body(tx, row) {
      const stale = checkExpected(row, input.expectedState);
      if (stale) return stale;
      if (!canTransition(stuffyState(row), "checked_in")) return { ok: false, code: "illegal_transition", currentState: stuffyState(row) };
      await pinnedUpdate(tx, row.id, ctx.sessionId, [eq(swStuffies.state, input.expectedState)], { state: "checked_in", checkedInAt: now });
      if (input.photo) await writePhoto(tx, ctx, row.id, input.photo, now);
      const events: EventInput[] = [
        { kind: "transition", fromState: input.expectedState, toState: "checked_in", idempotencyKey: input.idempotencyKey, clientTakenAt: input.clientTakenAt ?? null, note: input.photo ? null : "without_photo" },
      ];
      if (input.refundContinue) events.push({ kind: "refund_continue", fromState: input.expectedState, toState: "checked_in" });
      await insertEvents(tx, ctx, row.id, events);
      return null;
    },
  });
}

export interface PortraitInput {
  stuffyId: string;
  expectedState: StuffyState;
  photo: PhotoWrite;
  replace: boolean;
  clientTakenAt?: Date | null;
}

export async function portraitStuffy(ctx: WriteContext, input: PortraitInput): Promise<TransitionResult> {
  const now = ctx.now ?? new Date();
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.photo.id,
    async body(tx, row) {
      const stale = checkExpected(row, input.expectedState);
      if (stale) return stale;
      const from = stuffyState(row);
      const retake = from === "portrait_taken";
      if (!retake && !canTransition(from, "portrait_taken")) return { ok: false, code: "illegal_transition", currentState: from };

      // A retake REPLACES: refuse to silently overwrite unless the client said so.
      const [existing] = await tx
        .select({ id: swPhotos.id })
        .from(swPhotos)
        .where(and(eq(swPhotos.stuffyId, row.id), eq(swPhotos.kind, "portrait"), isNull(swPhotos.supersededAt)))
        .limit(1);
      if (existing && !input.replace) return { ok: false, code: "portrait_exists" };

      await pinnedUpdate(tx, row.id, ctx.sessionId, [eq(swStuffies.state, from)], { state: "portrait_taken", portraitAt: now });
      await writePhoto(tx, ctx, row.id, input.photo, now);
      await insertEvents(tx, ctx, row.id, [
        { kind: "transition", fromState: from, toState: "portrait_taken", idempotencyKey: input.photo.id, clientTakenAt: input.clientTakenAt ?? null, note: existing ? "retake" : null },
      ]);
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Pickup
// ---------------------------------------------------------------------------

export interface PickupCheckInput {
  stuffyId: string;
  result: "matched" | "someone_else";
  note?: string | null;
  idempotencyKey: string;
}

export async function recordPickupCheck(ctx: WriteContext, input: PickupCheckInput): Promise<TransitionResult> {
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.idempotencyKey,
    async body(tx, row) {
      const state = stuffyState(row);
      if (state === "picked_up") return { ok: false, code: "already_picked_up", at: row.pickedUpAt ?? row.updatedAt };
      if (!isPickupAllowedFrom(state)) return { ok: false, code: "illegal_transition", currentState: state };
      // The choice is only meaningful after the name was on the worker's screen (R2).
      if (!(await hasEventSinceRevert(tx, row.id, "name_shown"))) return { ok: false, code: "name_not_shown" };
      const note = input.result === "matched" ? "matched" : `someone_else${input.note ? `: ${input.note.trim()}` : ""}`;
      await insertEvents(tx, ctx, row.id, [{ kind: "pickup_check", fromState: state, toState: state, idempotencyKey: input.idempotencyKey, note }]);
      return null;
    },
  });
}

export interface PickupInput {
  stuffyId: string;
  expectedState: StuffyState;
  idempotencyKey: string;
}

/** True when an event of `kind` exists that is newer than the stuffy's latest revert (a revert resets the whole pickup sequence). */
async function hasEventSinceRevert(tx: Tx, stuffyId: string, kind: "name_shown" | "pickup_check"): Promise<boolean> {
  const events = await tx
    .select({ kind: swStuffyEvents.kind, at: swStuffyEvents.createdAt })
    .from(swStuffyEvents)
    .where(and(eq(swStuffyEvents.stuffyId, stuffyId), inArray(swStuffyEvents.kind, [kind, "revert"])))
    .orderBy(desc(swStuffyEvents.createdAt))
    .limit(20);
  const lastRevert = events.find((e) => e.kind === "revert")?.at ?? null;
  return events.some((e) => e.kind === kind && (lastRevert === null || e.at > lastRevert));
}

export interface PickupNameInput {
  stuffyId: string;
  idempotencyKey: string;
}

/** Records that the parent's name was shown to the worker (no state change). A repeat after the last revert writes no second row. */
export async function recordPickupName(ctx: WriteContext, input: PickupNameInput): Promise<TransitionResult> {
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.idempotencyKey,
    async body(tx, row) {
      const state = stuffyState(row);
      if (state === "picked_up") return { ok: false, code: "already_picked_up", at: row.pickedUpAt ?? row.updatedAt };
      if (!isPickupAllowedFrom(state)) return { ok: false, code: "illegal_transition", currentState: state };
      if (await hasEventSinceRevert(tx, row.id, "name_shown")) return null;
      await insertEvents(tx, ctx, row.id, [{ kind: "name_shown", fromState: state, toState: state, idempotencyKey: input.idempotencyKey }]);
      return null;
    },
  });
}

export async function pickupStuffy(ctx: WriteContext, input: PickupInput): Promise<TransitionResult> {
  const now = ctx.now ?? new Date();
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: input.idempotencyKey,
    async body(tx, row) {
      const state = stuffyState(row);
      // A second tap with another key must say "already picked up", not "stale".
      if (state === "picked_up") return { ok: false, code: "already_picked_up", at: row.pickedUpAt ?? row.updatedAt };
      const stale = checkExpected(row, input.expectedState);
      if (stale) return stale;
      if (!isPickupAllowedFrom(state) || !canTransition(state, "picked_up")) return { ok: false, code: "illegal_transition", currentState: state };
      // "A recorded human step" is only recorded if the server demands it (Ruling 19).
      if (!(await hasEventSinceRevert(tx, row.id, "pickup_check"))) return { ok: false, code: "pickup_check_required" };
      // Never blocked by a missing portrait, an open refund flag or a storage failure.
      await pinnedUpdate(tx, row.id, ctx.sessionId, [eq(swStuffies.state, state)], { state: "picked_up", pickedUpAt: now });
      await insertEvents(tx, ctx, row.id, [{ kind: "transition", fromState: state, toState: "picked_up", idempotencyKey: input.idempotencyKey }]);
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Revert and withdraw
// ---------------------------------------------------------------------------

export interface RevertInput {
  stuffyId: string;
  toState: StuffyState;
  expectedState: StuffyState;
  /** Required for an admin (the route validates); stored in the event note. */
  reason?: string | null;
}

export async function revertStuffy(ctx: WriteContext, input: RevertInput): Promise<TransitionResult> {
  if (!canRevert(ctx.actor.kind, ctx.sessionKind)) return { ok: false, code: "practice_only" };
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: null,
    async body(tx, row) {
      const stale = checkExpected(row, input.expectedState);
      if (stale) return stale;
      const from = stuffyState(row);
      if (!isBackward(from, input.toState)) return { ok: false, code: "illegal_transition", currentState: from };

      // Clear every stamp for the states we are leaving.
      const set: Partial<typeof swStuffies.$inferInsert> = { state: input.toState };
      const stamps: Record<string, null> = {};
      for (const s of STUFFY_STATES) {
        if (stateIndex(s) > stateIndex(input.toState)) {
          const column = STAMP_COLUMN[s];
          if (column) stamps[column] = null;
        }
      }
      Object.assign(set, stamps);
      let prevTag: string | null = null;
      if (input.toState === "registered" && row.tagCode) {
        prevTag = row.tagCode;
        set.tagCode = null; // retire event below keeps the old code findable as "retired"
      }
      await pinnedUpdate(tx, row.id, ctx.sessionId, [eq(swStuffies.state, from)], set);
      await insertEvents(tx, ctx, row.id, [
        { kind: "revert", fromState: from, toState: input.toState, prevTagCode: prevTag, note: input.reason ?? null },
      ]);
      return null;
    },
  });
}

export interface WithdrawInput {
  stuffyId: string;
  reason: string;
}

/** Admin only. Allowed from registered or tagged; a stuffy in custody can only be flagged. */
export async function withdrawStuffy(ctx: WriteContext & { actor: { kind: "admin"; userId: string } }, input: WithdrawInput): Promise<TransitionResult> {
  const now = ctx.now ?? new Date();
  return runStuffyWrite(ctx, {
    stuffyId: input.stuffyId,
    idempotencyKey: null,
    allowWithdrawn: true,
    async body(tx, row) {
      if (row.withdrawnAt) return null; // already withdrawn: idempotent success
      const state = stuffyState(row);
      if (state !== "registered" && state !== "tagged") return { ok: false, code: "withdraw_not_allowed", currentState: state };
      await pinnedUpdate(tx, row.id, ctx.sessionId, [eq(swStuffies.state, state), isNull(swStuffies.withdrawnAt)], {
        withdrawnAt: now,
        withdrawnByUserId: ctx.actor.userId,
        withdrawnReason: input.reason,
      });
      await insertEvents(tx, ctx, row.id, [{ kind: "withdraw", fromState: state, toState: state, note: input.reason }]);
      return null;
    },
  });
}

// ---------------------------------------------------------------------------
// Parent name for the pickup check (the ONLY crew path that returns it besides the tag card)
// ---------------------------------------------------------------------------

export async function parentNameFor(sessionId: string, stuffyId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: swOrders.buyerFirstName, last: swOrders.buyerLastName })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, sessionId)))
    .limit(1);
  if (!row) return null;
  const name = [row.first, row.last].filter((p): p is string => !!p && p.trim().length > 0).join(" ").trim();
  return name || null;
}

export { last4 };

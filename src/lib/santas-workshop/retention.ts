/**
 * The retention engine (DECISION-125): the preview, the two purge scopes for a real
 * session, and the practice reset. Server-only.
 *
 * Shared shape of every write path, so each is RESUMABLE (re-run continues where it stopped):
 *
 *   1. Drain photos in small batches. For each photo: delete the bytes from the PhotoStore
 *      FIRST (a missing key is success), then stamp the row (purge) or delete it (reset) with a
 *      pinned UPDATE/DELETE. A crash or a store failure between the two leaves a row that still
 *      names bytes that may be gone, never bytes with no row; the next run finishes it.
 *      A store failure stops the run (the typed StorageError is rethrown after the audit row),
 *      so nothing past the failure is touched.
 *   2. Only when no photo of the scope remains, ONE transaction does the database part and sets the
 *      session marker (`personal_purged_at` / `public_purged_at`). It takes the session row FOR
 *      UPDATE, re-counts the photos (an upload that raced in sends the caller round again), pins the
 *      marker UPDATE on `IS NULL` and throws a rollback sentinel on zero rows (a plain `return` from
 *      db.transaction commits).
 *   3. The photo door does not read the session marker alone: each photo carries its own `purged_at`
 *      (stamped in step 1) and the door also refuses by the marker (photo-access.ts), so a photo the
 *      engine missed is still refused.
 *
 * Scopes (`PERSONAL_PHOTO` and its complement partition every photo):
 *   personal  check-in photos and superseded retakes; orders' buyer fields, buyer answers, window
 *             label text and manual reason; stuffies' child first name, snack, note to Santa, care note
 *             and raw answers, description and withdraw reason; stuffy-event notes (pickup notes can hold a name); the stored webhook
 *             snapshot; admin `reason` text in the session log. TOMBSTONES stay: Zeffy payment id, item key,
 *             tag code, state stamps, stuffy name, so a stale Sync cannot resurrect people (payment-apply refuses a purged
 *             session).
 *   public    current portraits and group photos.
 *
 * Audit (`sw_session_log`): `purge_step` (counts per request), `purge_done`, `reset`. Counts, ids and
 * booleans; a forced run also records the admin's typed reason (the UI tells them not to type names).
 * Nothing here emails, and the personal-data columns are only ever written to NULL/empty.
 */

import { and, asc, eq, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swPhotos, swSessionLog, swSessions, swStuffies, swStuffyEvents, zeffyEvents } from "@/lib/db/schema";
import type { SwSession } from "@/lib/db/schema";
import { easternDateString } from "@/lib/eastern-date";
import type { PurgeResponse, ResetPreview, ResetResponse, RetentionPreview, ScopePreview } from "./admin-contract";
import { workshopNow } from "./clock";
import { getPhotoStore } from "./photo-store";
import type { PhotoStore } from "./photo-store/types";
import { describeBlockers, retentionStatusFor, type RetentionScope } from "./retention-policy";
import { logSessionEvent } from "./session-log";
import { failure, getSessionRow, type QueryFailure } from "./session-queries";

export const DEFAULT_BUDGET_MS = 25_000;
export const DEFAULT_BATCH = 20;

export interface RetentionDeps {
  store?: PhotoStore | (() => PhotoStore);
  now?: Date;
  /** Milliseconds from a monotonic-enough clock; injected by tests. */
  clock?: () => number;
  budgetMs?: number;
  batchSize?: number;
}

/** The personal photo scope; the public scope is its exact complement. */
export const PERSONAL_PHOTO = or(eq(swPhotos.kind, "check_in"), isNotNull(swPhotos.supersededAt)) as ReturnType<typeof or> & object;
const PUBLIC_PHOTO = sql`not (${PERSONAL_PHOTO})`;

const scopePhotos = (sessionId: string, scope: RetentionScope) =>
  and(eq(swPhotos.sessionId, sessionId), isNull(swPhotos.purgedAt), scope === "personal" ? PERSONAL_PHOTO : PUBLIC_PHOTO);

class Rollback extends Error {}

const todayFor = (now: Date) => easternDateString(workshopNow(process.env, now));

function resolveStore(store: RetentionDeps["store"]): PhotoStore {
  if (!store) return getPhotoStore();
  return typeof store === "function" ? store() : store;
}

// ---------------------------------------------------------------------------
// Draining photos (shared by purge and reset)
// ---------------------------------------------------------------------------

interface DrainResult {
  processed: number;
  /** True when no photo of the scope was left to take. */
  empty: boolean;
  error?: unknown;
}

async function drainPhotos(
  where: ReturnType<typeof and>,
  finish: (photoId: string) => Promise<void>,
  deps: RetentionDeps,
): Promise<DrainResult> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = deps.budgetMs ?? DEFAULT_BUDGET_MS;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH;
  let store: PhotoStore | null = null;
  let processed = 0;
  for (;;) {
    const batch = await db
      .select({ id: swPhotos.id, storageKey: swPhotos.storageKey, thumbStorageKey: swPhotos.thumbStorageKey })
      .from(swPhotos)
      .where(where)
      .orderBy(asc(swPhotos.id))
      .limit(batchSize);
    if (batch.length === 0) return { processed, empty: true };
    for (const row of batch) {
      if (clock() - started >= budget) return { processed, empty: false };
      try {
        for (const key of [row.storageKey, row.thumbStorageKey]) {
          if (!key) continue;
          store ??= resolveStore(deps.store);
          await store.delete(key);
        }
      } catch (error) {
        return { processed, empty: false, error };
      }
      await finish(row.id);
      processed += 1;
    }
  }
}

async function countPhotos(where: ReturnType<typeof and>): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(swPhotos).where(where);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function getRetentionPreview(sessionId: string, now: Date = new Date()): Promise<RetentionPreview | null> {
  const row = await getSessionRow(sessionId);
  if (!row) return null;
  const today = todayFor(now);
  const retention = retentionStatusFor(row, today);

  const [photos] = await db
    .select({
      personal: sql<number>`(count(*) filter (where ${swPhotos.purgedAt} is null and ${PERSONAL_PHOTO}))::int`,
      personalBytes: sql<number>`(coalesce(sum(coalesce(${swPhotos.byteSize}, 0) + coalesce(${swPhotos.thumbByteSize}, 0)) filter (where ${swPhotos.purgedAt} is null and ${PERSONAL_PHOTO}), 0))::bigint`,
      public: sql<number>`(count(*) filter (where ${swPhotos.purgedAt} is null and ${PUBLIC_PHOTO}))::int`,
      publicBytes: sql<number>`(coalesce(sum(coalesce(${swPhotos.byteSize}, 0) + coalesce(${swPhotos.thumbByteSize}, 0)) filter (where ${swPhotos.purgedAt} is null and ${PUBLIC_PHOTO}), 0))::bigint`,
      all: sql<number>`count(*)::int`,
      allBytes: sql<number>`(coalesce(sum(coalesce(${swPhotos.byteSize}, 0) + coalesce(${swPhotos.thumbByteSize}, 0)), 0))::bigint`,
    })
    .from(swPhotos)
    .where(eq(swPhotos.sessionId, sessionId));

  const [orders] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withData: sql<number>`(count(*) filter (where ${swOrders.buyerFirstName} is not null or ${swOrders.buyerLastName} is not null or ${swOrders.buyerEmail} is not null or ${swOrders.buyerPhone} is not null or ${swOrders.windowLabelRaw} is not null or ${swOrders.manualReason} is not null or jsonb_array_length(${swOrders.buyerAnswers}) > 0))::int`,
    })
    .from(swOrders)
    .where(eq(swOrders.sessionId, sessionId));

  const [stuffies] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withData: sql<number>`(count(*) filter (where ${swStuffies.childFirstName} is not null or ${swStuffies.snack} is not null or ${swStuffies.noteToSanta} is not null or ${swStuffies.careNote} is not null or ${swStuffies.description} is not null or ${swStuffies.withdrawnReason} is not null or jsonb_array_length(${swStuffies.rawAnswers}) > 0))::int`,
    })
    .from(swStuffies)
    .where(eq(swStuffies.sessionId, sessionId));

  const [events] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withNote: sql<number>`(count(*) filter (where ${swStuffyEvents.note} is not null))::int`,
    })
    .from(swStuffyEvents)
    .where(eq(swStuffyEvents.sessionId, sessionId));

  const [snapshots] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(zeffyEvents)
    .where(and(eq(zeffyEvents.sessionId, sessionId), isNotNull(zeffyEvents.payload)));

  const personal: ScopePreview = {
    status: retention.personal,
    photos: photos?.personal ?? 0,
    photoBytes: Number(photos?.personalBytes ?? 0),
    orders: orders?.withData ?? 0,
    stuffies: stuffies?.withData ?? 0,
    eventNotes: events?.withNote ?? 0,
    webhookSnapshots: snapshots?.n ?? 0,
  };
  const publicScope: ScopePreview = {
    status: retention.public,
    photos: photos?.public ?? 0,
    photoBytes: Number(photos?.publicBytes ?? 0),
    orders: 0,
    stuffies: 0,
    eventNotes: 0,
    webhookSnapshots: 0,
  };
  const reset: ResetPreview | null =
    row.kind === "practice"
      ? {
          photos: photos?.all ?? 0,
          photoBytes: Number(photos?.allBytes ?? 0),
          orders: orders?.total ?? 0,
          stuffies: stuffies?.total ?? 0,
          events: events?.total ?? 0,
        }
      : null;
  return { sessionId, kind: row.kind as RetentionPreview["kind"], today, personal, public: publicScope, reset };
}

// ---------------------------------------------------------------------------
// Purge (real sessions; works on practice sessions too, which can also be reset)
// ---------------------------------------------------------------------------

export interface PurgeArgs {
  sessionId: string;
  scope: RetentionScope;
  userId: string;
  force: boolean;
  /** Required by the caller when `force` (parseForce). */
  reason: string | null;
}

type Finalized = { kind: "done"; counts: Record<string, number> } | { kind: "already" } | { kind: "photos_left"; remaining: number };

async function finalizePurge(row: SwSession, args: PurgeArgs, forced: boolean, now: Date): Promise<Finalized> {
  const scope = args.scope;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ personalPurgedAt: swSessions.personalPurgedAt, publicPurgedAt: swSessions.publicPurgedAt })
      .from(swSessions)
      .where(eq(swSessions.id, row.id))
      .for("update");
    if (!locked) throw new Rollback();
    if ((scope === "personal" ? locked.personalPurgedAt : locked.publicPurgedAt) !== null) return { kind: "already" } as const;

    const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(swPhotos).where(scopePhotos(row.id, scope));
    if ((left?.n ?? 0) > 0) return { kind: "photos_left", remaining: left?.n ?? 0 } as const;

    const counts: Record<string, number> = {};
    if (scope === "personal") {
      const orders = await tx
        .update(swOrders)
        .set({
          buyerFirstName: null,
          buyerLastName: null,
          buyerEmail: null,
          buyerPhone: null,
          buyerAnswers: [],
          windowLabelRaw: null,
          manualReason: null,
          updatedAt: now,
        })
        .where(eq(swOrders.sessionId, row.id))
        .returning({ id: swOrders.id });
      const stuffies = await tx
        .update(swStuffies)
        // Free text a family or an admin typed. The stuffy's NAME stays as the tombstone.
        .set({ childFirstName: null, snack: null, noteToSanta: null, careNote: null, description: null, withdrawnReason: null, rawAnswers: [], updatedAt: now })
        .where(eq(swStuffies.sessionId, row.id))
        .returning({ id: swStuffies.id });
      const notes = await tx
        .update(swStuffyEvents)
        .set({ note: null })
        .where(and(eq(swStuffyEvents.sessionId, row.id), isNotNull(swStuffyEvents.note)))
        .returning({ id: swStuffyEvents.id });
      const snapshots = await tx
        .update(zeffyEvents)
        .set({ payload: null })
        .where(and(eq(zeffyEvents.sessionId, row.id), isNotNull(zeffyEvents.payload)))
        .returning({ id: zeffyEvents.id });
      // Admin-typed reasons in the audit rows of this session (the forced-purge reason itself stays: the audit needs it).
      const scrubbed = await tx
        .update(swSessionLog)
        .set({ detail: sql`${swSessionLog.detail} - 'reason'` })
        .where(and(eq(swSessionLog.sessionId, row.id), sql`jsonb_exists(${swSessionLog.detail}, 'reason')`, notInArray(swSessionLog.kind, ["purge_step", "purge_done"])))
        .returning({ id: swSessionLog.id });
      counts.logReasons = scrubbed.length;
      counts.orders = orders.length;
      counts.stuffies = stuffies.length;
      counts.eventNotes = notes.length;
      counts.webhookSnapshots = snapshots.length;
    }

    const otherDone = scope === "personal" ? locked.publicPurgedAt !== null : locked.personalPurgedAt !== null;
    const marker = scope === "personal" ? { personalPurgedAt: now } : { publicPurgedAt: now };
    const marked = await tx
      .update(swSessions)
      .set({ ...marker, ...(otherDone ? { status: "purged" } : {}), updatedAt: now })
      .where(and(eq(swSessions.id, row.id), isNull(scope === "personal" ? swSessions.personalPurgedAt : swSessions.publicPurgedAt)))
      .returning({ id: swSessions.id });
    if (marked.length === 0) throw new Rollback();

    await tx.insert(swSessionLog).values({
      sessionId: row.id,
      userId: args.userId,
      kind: "purge_done",
      detail: { scope, ...counts, forced, ...(forced && args.reason ? { reason: args.reason } : {}) },
    });
    return { kind: "done", counts } as const;
  });
}

export async function purgeSession(args: PurgeArgs, deps: RetentionDeps = {}): Promise<PurgeResponse | QueryFailure> {
  const row = await getSessionRow(args.sessionId);
  if (!row) return failure(404, "not_found", "Session not found");
  const now = deps.now ?? new Date();
  const today = todayFor(now);
  const scope = args.scope;

  const retention = retentionStatusFor(row, today);
  const status = retention[scope];
  if (status.state === "purged") {
    return { phase: scope, done: true, remaining: 0, photosDeleted: 0, noop: true, forced: false, retention };
  }
  const forced = status.blockers.length > 0;
  if (forced && !args.force) {
    return failure(409, "not_eligible", `This cannot run yet: ${describeBlockers(status.blockers, status.dueOn)}.`);
  }
  if (forced && !args.reason) return failure(400, "invalid_input", "Give a reason to run this early", "reason");

  const where = scopePhotos(row.id, scope);
  const drained = await drainPhotos(
    where,
    async (photoId) => {
      await db
        .update(swPhotos)
        .set({ purgedAt: now, storageKey: null, thumbStorageKey: null })
        .where(and(eq(swPhotos.id, photoId), isNull(swPhotos.purgedAt)))
        .returning({ id: swPhotos.id });
    },
    deps,
  );
  const reasonDetail: Record<string, string> = forced && args.reason ? { reason: args.reason } : {};

  if (drained.error !== undefined) {
    if (drained.processed > 0) {
      await logSessionEvent(row.id, args.userId, "purge_step", { scope, photosDeleted: drained.processed, interrupted: true, forced, ...reasonDetail });
    }
    throw drained.error;
  }

  if (!drained.empty) {
    const remaining = await countPhotos(where);
    await logSessionEvent(row.id, args.userId, "purge_step", { scope, photosDeleted: drained.processed, remaining, forced, ...reasonDetail });
    return { phase: scope, done: false, remaining, photosDeleted: drained.processed, noop: false, forced, retention };
  }

  if (drained.processed > 0) {
    await logSessionEvent(row.id, args.userId, "purge_step", { scope, photosDeleted: drained.processed, remaining: 0, forced, ...reasonDetail });
  }

  let finalized: Finalized;
  try {
    finalized = await finalizePurge(row, args, forced, now);
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    // Another request finished (or removed) it between our checks: report the current state.
    finalized = { kind: "already" };
  }
  const fresh = (await getSessionRow(row.id)) ?? row;
  const after = retentionStatusFor(fresh, today);
  if (finalized.kind === "photos_left") {
    return { phase: scope, done: false, remaining: finalized.remaining, photosDeleted: drained.processed, noop: false, forced, retention: after };
  }
  return { phase: scope, done: true, remaining: 0, photosDeleted: drained.processed, noop: finalized.kind === "already", forced, retention: after };
}

// ---------------------------------------------------------------------------
// Practice reset
// ---------------------------------------------------------------------------

type ResetFinalized = { kind: "done"; removed: { orders: number; stuffies: number; events: number } } | { kind: "photos_left"; remaining: number };

export async function resetPracticeSession(
  sessionId: string,
  userId: string,
  deps: RetentionDeps = {},
): Promise<ResetResponse | QueryFailure> {
  const row = await getSessionRow(sessionId);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.kind !== "practice") return failure(403, "practice_only", "Only a practice session can be reset");
  const now = deps.now ?? new Date();

  const where = eq(swPhotos.sessionId, row.id);
  const drained = await drainPhotos(
    where,
    async (photoId) => {
      await db.delete(swPhotos).where(eq(swPhotos.id, photoId)).returning({ id: swPhotos.id });
    },
    deps,
  );

  if (drained.error !== undefined) {
    if (drained.processed > 0) await logSessionEvent(row.id, userId, "purge_step", { scope: "reset", photosDeleted: drained.processed, interrupted: true });
    throw drained.error;
  }
  if (!drained.empty) {
    const remaining = await countPhotos(where);
    await logSessionEvent(row.id, userId, "purge_step", { scope: "reset", photosDeleted: drained.processed, remaining });
    return { done: false, remaining, photosDeleted: drained.processed, removed: null };
  }

  let finalized: ResetFinalized;
  try {
    finalized = await db.transaction(async (tx) => {
      const [locked] = await tx.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.id, row.id)).for("update");
      if (!locked) throw new Rollback();
      const [left] = await tx.select({ n: sql<number>`count(*)::int` }).from(swPhotos).where(eq(swPhotos.sessionId, row.id));
      if ((left?.n ?? 0) > 0) return { kind: "photos_left", remaining: left?.n ?? 0 } as const;

      const [counts] = await tx
        .select({
          orders: sql<number>`(select count(*) from sw_orders where session_id = ${row.id})::int`,
          stuffies: sql<number>`(select count(*) from sw_stuffies where session_id = ${row.id})::int`,
          events: sql<number>`(select count(*) from sw_stuffy_events where session_id = ${row.id})::int`,
        })
        .from(swSessions)
        .where(eq(swSessions.id, row.id));
      // Deleting the orders cascades to stuffies and their event history.
      await tx.delete(swOrders).where(eq(swOrders.sessionId, row.id));
      await tx.update(zeffyEvents).set({ payload: null }).where(and(eq(zeffyEvents.sessionId, row.id), isNotNull(zeffyEvents.payload)));
      // A reset session starts the drill over (S5-D2): photos pending, back to draft, both purge markers
      // cleared. Without this a purged practice session (status is terminal) could never be run again.
      await tx
        .update(swSessions)
        .set({ collagePublishedAt: null, status: "draft", personalPurgedAt: null, publicPurgedAt: null, updatedAt: now }).where(eq(swSessions.id, row.id)).returning({ id: swSessions.id });
      const removed = { orders: counts?.orders ?? 0, stuffies: counts?.stuffies ?? 0, events: counts?.events ?? 0 };
      await tx.insert(swSessionLog).values({ sessionId: row.id, userId, kind: "reset", detail: { ...removed, photosDeleted: drained.processed } });
      return { kind: "done", removed } as const;
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
    return failure(404, "not_found", "Session not found");
  }

  if (finalized.kind === "photos_left") return { done: false, remaining: finalized.remaining, photosDeleted: drained.processed, removed: null };
  return { done: true, remaining: 0, photosDeleted: drained.processed, removed: finalized.removed };
}

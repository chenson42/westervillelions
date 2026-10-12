/**
 * The database-backed ZeffyEventStore and the event-log readers. Server-only.
 *
 * `zeffy_events.id` is Zeffy's event id and the primary key. claim() is
 * insert-or-read with the dedupe rule of DECISION-123 ruling 3: a row in a
 * terminal outcome is a no-op redelivery; `received` / `failed` rows are
 * re-run, with `attempts` incremented.
 */

import { desc, eq, max, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swSessions, zeffyEvents } from "@/lib/db/schema";

/** A uuid no row has: a campaign no session owns matches on campaign_id alone. */
const NO_SESSION = "00000000-0000-0000-0000-000000000000";
import { isTerminalOutcome } from "./event-outcomes";
import type { ClaimInput, FinishPatch, ZeffyEventRecord, ZeffyEventStore } from "./webhook-handler";

function toRecord(row: typeof zeffyEvents.$inferSelect): ZeffyEventRecord {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    paymentId: row.paymentId,
    campaignId: row.campaignId,
    sessionId: row.sessionId,
    outcome: row.outcome,
    errorCode: row.errorCode,
    attempts: row.attempts,
  };
}

export const dbZeffyEventStore: ZeffyEventStore = {
  async claim(input: ClaimInput) {
    const inserted = await db
      .insert(zeffyEvents)
      .values({
        id: input.id,
        type: input.type,
        version: String(input.version),
        paymentId: input.paymentId,
        campaignId: input.campaignId,
        dispatchedAt: input.dispatchedAt,
        outcome: "received",
      })
      .onConflictDoNothing({ target: zeffyEvents.id })
      .returning();
    if (inserted[0]) return { record: toRecord(inserted[0]), alreadyTerminal: false };

    const [existing] = await db.select().from(zeffyEvents).where(eq(zeffyEvents.id, input.id)).limit(1);
    if (!existing) {
      // Deleted between the insert and the read (not expected); treat as a fresh claim.
      return { record: toRecord({ ...emptyRow(input) }), alreadyTerminal: false };
    }
    if (isTerminalOutcome(existing.outcome)) return { record: toRecord(existing), alreadyTerminal: true };

    const [bumped] = await db
      .update(zeffyEvents)
      .set({ attempts: sql`${zeffyEvents.attempts} + 1` })
      .where(eq(zeffyEvents.id, input.id))
      .returning();
    return { record: toRecord(bumped ?? existing), alreadyTerminal: false };
  },

  async finish(id: string, patch: FinishPatch) {
    await finishZeffyEvent(id, patch);
  },
};

function emptyRow(input: ClaimInput): typeof zeffyEvents.$inferSelect {
  return {
    id: input.id,
    type: input.type,
    version: String(input.version),
    paymentId: input.paymentId,
    campaignId: input.campaignId,
    sessionId: null,
    receivedAt: new Date(),
    dispatchedAt: input.dispatchedAt,
    processedAt: null,
    outcome: "received",
    errorCode: null,
    attempts: 1,
    payload: null,
  };
}

export async function finishZeffyEvent(id: string, patch: FinishPatch): Promise<void> {
  await db
    .update(zeffyEvents)
    .set({
      outcome: patch.outcome,
      errorCode: patch.errorCode ?? null,
      sessionId: patch.sessionId ?? null,
      ...(patch.campaignId ? { campaignId: patch.campaignId } : {}),
      // Only a MAPPED campaign carries a payload; everything else is nulled.
      payload: patch.sessionId ? (patch.payload ?? null) : null,
      processedAt: new Date(),
    })
    .where(eq(zeffyEvents.id, id));
}

export interface ZeffyEventSummary {
  id: string;
  type: string | null;
  paymentId: string | null;
  campaignId: string | null;
  outcome: string;
  errorCode: string | null;
  attempts: number;
  receivedAt: Date;
  processedAt: Date | null;
  hasPayload: boolean;
}

/**
 * The log rows that belong to a session: those the consumer attributed to it
 * (`session_id`, which a failed id-only payment.updated/deleted has while its
 * `campaign_id` is still NULL) OR that carry its campaign id. One OR over one
 * table, so an event matching both is listed once.
 */
export function sessionEventsFilter(session: { id: string; campaignId: string | null }) {
  return session.campaignId
    ? or(eq(zeffyEvents.sessionId, session.id), eq(zeffyEvents.campaignId, session.campaignId))
    : eq(zeffyEvents.sessionId, session.id);
}

/** Recent events for one session. NEVER returns the payload, only whether one is stored. */
export async function recentEvents(
  target: string | { id: string; campaignId: string | null },
  limit = 50,
): Promise<ZeffyEventSummary[]> {
  // A bare campaign id (the Connect page's call) is resolved to the session it is
  // connected to, so failed id-only events (session_id set, campaign_id NULL) are listed too.
  let session: { id: string; campaignId: string | null };
  if (typeof target === "string") {
    const [owner] = await db.select({ id: swSessions.id }).from(swSessions).where(eq(swSessions.zeffyCampaignId, target)).limit(1);
    session = owner ? { id: owner.id, campaignId: target } : { id: NO_SESSION, campaignId: target };
  } else {
    session = target;
  }
  const rows = await db
    .select({
      id: zeffyEvents.id,
      type: zeffyEvents.type,
      paymentId: zeffyEvents.paymentId,
      campaignId: zeffyEvents.campaignId,
      outcome: zeffyEvents.outcome,
      errorCode: zeffyEvents.errorCode,
      attempts: zeffyEvents.attempts,
      receivedAt: zeffyEvents.receivedAt,
      processedAt: zeffyEvents.processedAt,
      hasPayload: sql<boolean>`${zeffyEvents.payload} IS NOT NULL`,
    })
    .from(zeffyEvents)
    .where(sessionEventsFilter(session))
    .orderBy(desc(zeffyEvents.receivedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows;
}

/** The most recent event of any campaign: proof the webhook is alive (a bad signature is never stored). */
export async function lastEventReceivedAt(): Promise<Date | null> {
  const [row] = await db.select({ at: max(zeffyEvents.receivedAt) }).from(zeffyEvents);
  return row?.at ?? null;
}

export async function lastCampaignEventReceivedAt(campaignId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: max(zeffyEvents.receivedAt) })
    .from(zeffyEvents)
    .where(eq(zeffyEvents.campaignId, campaignId));
  return row?.at ?? null;
}

export async function getZeffyEvent(id: string) {
  const [row] = await db.select().from(zeffyEvents).where(eq(zeffyEvents.id, id)).limit(1);
  return row ?? null;
}

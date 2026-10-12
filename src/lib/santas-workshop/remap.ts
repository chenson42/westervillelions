/**
 * Remap: re-apply the session's question map to the answers ALREADY STORED
 * (stuffy.raw_answers, order.buyer_answers). Local, no Zeffy call: the loop that
 * follows "assign the unmatched strings, then Reprocess" (Phase 3 ruling 18).
 *
 * The mapping rules are the SAME functions the apply path uses
 * (payment-mapper.ts); this module only feeds them stored data. Manual
 * registrants (no Zeffy item key) are skipped: they have no answers to remap.
 * `not_in_order_now` is preserved: only the apply path can clear it.
 *
 * Only IMPORT-OWNED columns are written, and only on a difference.
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swStuffies } from "@/lib/db/schema";
import type { SwOrder, SwSession, SwStuffy } from "@/lib/db/schema";
import { mapBuyerFields, mapStuffyFromAnswers, type AttentionCode, type MapperSession } from "./payment-mapper";
import type { SnapshotQuestion } from "@/lib/zeffy/snapshot";

export const REMAP_BATCH = 200;

export interface RemapPatch {
  stuffy: Partial<Pick<SwStuffy, "name" | "description" | "childFirstName" | "snack" | "noteToSanta" | "careNote" | "photoConsent" | "attentionCodes" | "needsAttention" | "attentionDismissedAt">> | null;
  order: Partial<Pick<SwOrder, "buyerPhone" | "windowId" | "windowLabelRaw" | "acknowledged">> | null;
  attentionChanged: boolean;
}

const asQuestions = (v: unknown): SnapshotQuestion[] =>
  Array.isArray(v) ? (v.filter((q) => q && typeof q === "object" && "question" in q) as SnapshotQuestion[]) : [];

const sameCodes = (a: readonly string[], b: readonly string[]) => [...a].sort().join("|") === [...b].sort().join("|");

/** Pure. Computes what a remap would change for one stuffy and its order. */
export function remapRow(stuffy: SwStuffy, order: SwOrder, cfg: MapperSession): RemapPatch {
  const ticketQs = asQuestions(stuffy.rawAnswers);
  const buyerQs = asQuestions(order.buyerAnswers);
  const buyer = mapBuyerFields(buyerQs, ticketQs, cfg);
  const mapped = mapStuffyFromAnswers(ticketQs, buyerQs, buyer.windowId !== null, cfg);

  const keepMissing = stuffy.attentionCodes.includes("not_in_order_now");
  const nextCodes: AttentionCode[] = keepMissing ? [...mapped.attentionCodes, "not_in_order_now"] : mapped.attentionCodes;

  const orderPatch: NonNullable<RemapPatch["order"]> = {};
  if (order.buyerPhone !== buyer.buyerPhone) orderPatch.buyerPhone = buyer.buyerPhone;
  if (order.windowId !== buyer.windowId) orderPatch.windowId = buyer.windowId;
  if (order.windowLabelRaw !== buyer.windowLabelRaw) orderPatch.windowLabelRaw = buyer.windowLabelRaw;
  if (order.acknowledged !== buyer.acknowledged) orderPatch.acknowledged = buyer.acknowledged;

  const stuffyPatch: NonNullable<RemapPatch["stuffy"]> = {};
  if (stuffy.name !== mapped.name) stuffyPatch.name = mapped.name;
  if (stuffy.description !== mapped.description) stuffyPatch.description = mapped.description;
  if (stuffy.childFirstName !== mapped.childFirstName) stuffyPatch.childFirstName = mapped.childFirstName;
  if (stuffy.snack !== mapped.snack) stuffyPatch.snack = mapped.snack;
  if (stuffy.noteToSanta !== mapped.noteToSanta) stuffyPatch.noteToSanta = mapped.noteToSanta;
  if (stuffy.careNote !== mapped.careNote) stuffyPatch.careNote = mapped.careNote;
  if (stuffy.photoConsent !== mapped.photoConsent) stuffyPatch.photoConsent = mapped.photoConsent;

  const attentionChanged = !sameCodes(stuffy.attentionCodes, nextCodes);
  if (attentionChanged) {
    stuffyPatch.attentionCodes = nextCodes;
    stuffyPatch.needsAttention = nextCodes.length > 0;
    stuffyPatch.attentionDismissedAt = null; // a new set of reasons is a new question for the admin
  }

  return {
    stuffy: Object.keys(stuffyPatch).length > 0 ? stuffyPatch : null,
    order: Object.keys(orderPatch).length > 0 ? orderPatch : null,
    attentionChanged,
  };
}

function configOf(session: Pick<SwSession, "windows" | "zeffyTicketRateIds" | "questionMap">, map?: Record<string, string[]>): MapperSession {
  return {
    windows: session.windows.map((w) => ({ id: w.id, label: w.label })),
    ticketRateIds: session.zeffyTicketRateIds,
    questionMap: map ?? session.questionMap,
  };
}

async function loadBatch(sessionId: string, cursor: string | null) {
  return db
    .select({ stuffy: swStuffies, order: swOrders })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(cursor ? and(eq(swStuffies.sessionId, sessionId), gt(swStuffies.id, cursor)) : eq(swStuffies.sessionId, sessionId))
    .orderBy(asc(swStuffies.id))
    .limit(REMAP_BATCH);
}

/** Applies the SAVED map to one batch of stored answers. */
export async function remapBatch(
  session: SwSession,
  cursor: string | null,
): Promise<{ cursor: string | null; done: boolean; processed: number; changed: number }> {
  const cfg = configOf(session);
  const batch = await loadBatch(session.id, cursor);
  let changed = 0;
  let processed = 0;
  const ordersDone = new Set<string>();

  for (const { stuffy, order } of batch) {
    if (stuffy.zeffyItemKey === null) continue; // manual: nothing to remap
    processed += 1;
    const patch = remapRow(stuffy, order, cfg);
    if (patch.order && !ordersDone.has(order.id)) {
      ordersDone.add(order.id);
      await db.update(swOrders).set({ ...patch.order, updatedAt: new Date() }).where(eq(swOrders.id, order.id));
    }
    if (patch.stuffy) {
      await db.update(swStuffies).set({ ...patch.stuffy, updatedAt: new Date() }).where(eq(swStuffies.id, stuffy.id));
      changed += 1;
    }
  }
  const last = batch.length > 0 ? batch[batch.length - 1].stuffy.id : cursor;
  const done = batch.length < REMAP_BATCH;
  return { cursor: done ? null : last, done, processed, changed };
}

/** How many registrants would change their needs-attention reasons under `map`. Writes nothing. */
export async function previewRemapAttention(session: SwSession, map: Record<string, string[]>): Promise<number> {
  const cfg = configOf(session, map);
  let cursor: string | null = null;
  let changed = 0;
  for (;;) {
    const batch = await loadBatch(session.id, cursor);
    for (const { stuffy, order } of batch) {
      if (stuffy.zeffyItemKey === null) continue;
      if (remapRow(stuffy, order, cfg).attentionChanged) changed += 1;
    }
    if (batch.length < REMAP_BATCH) return changed;
    cursor = batch[batch.length - 1].stuffy.id;
  }
}

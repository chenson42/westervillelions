/**
 * applyPaymentSnapshot(): the ONE write path from a Zeffy payment into
 * sw_orders + sw_stuffies. The webhook, "Sync from Zeffy" and "Reprocess" all
 * call it (Phase 3, "Zeffy ingestion"). Server-only.
 *
 * Shape:
 *   - Any Zeffy HTTP call happens BEFORE and OUTSIDE this function. Nothing
 *     here awaits the network while holding the lock.
 *   - db.transaction; the FIRST statement is
 *     `pg_advisory_xact_lock(hashtext(paymentId))`, which serialises concurrent
 *     deliveries and syncs of one payment.
 *   - A snapshot whose `fetchedAt` is older than the order's `snapshot_at` is
 *     refused (`stale`): a retry delivered days late must not un-refund an order.
 *   - Rows are compared; only IMPORT-OWNED columns are ever written, and only
 *     on a difference, so `updated_at` stays honest. Worker-owned columns
 *     (state, the *_at state stamps, tag_code, frame_*, withdrawn_*, family_token)
 *     never appear in any .set() below; a source-scan test pins that.
 *   - Never deletes. An item missing from a later snapshot is flagged
 *     `not_in_order_now`.
 *   - Re-applying an identical snapshot writes only `snapshot_at` (Sync's
 *     staleness detection depends on every apply stamping it).
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swSessions, swStuffies } from "@/lib/db/schema";
import type { SwSession } from "@/lib/db/schema";
import type { PaymentSnapshot } from "@/lib/zeffy/snapshot";
import {
  mapPaymentToRegistrants,
  type AttentionCode,
  type MappedOrder,
  type MappedStuffy,
  type MapperSession,
} from "./payment-mapper";
import { newToken128 } from "./tokens";

export type ApplySource = "webhook" | "sync";

export type ApplyResult =
  | {
      result: "applied";
      orderId: string;
      orderCreated: boolean;
      /** Stuffies inserted. */
      created: number;
      /** Stuffies whose import-owned columns changed. */
      updated: number;
      unchanged: number;
      /** Stuffies newly flagged not_in_order_now. */
      flaggedMissing: number;
      /** Order columns (not just snapshot_at) changed. */
      orderChanged: boolean;
      refundChanged: boolean;
    }
  | { result: "stale" }
  | { result: "not_succeeded" }
  | { result: "no_registrants" }
  | { result: "session_mismatch" }
  | { result: "session_not_found" }
  | { result: "purged" };

export function sessionToMapperConfig(session: Pick<SwSession, "windows" | "zeffyTicketRateIds" | "questionMap">): MapperSession {
  return {
    windows: session.windows.map((w) => ({ id: w.id, label: w.label })),
    ticketRateIds: session.zeffyTicketRateIds,
    questionMap: session.questionMap,
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

type ExistingOrder = typeof swOrders.$inferSelect;
type ExistingStuffy = typeof swStuffies.$inferSelect;

function orderDiffers(existing: ExistingOrder, next: MappedOrder): boolean {
  return (
    existing.paymentStatus !== next.paymentStatus ||
    existing.buyerFirstName !== next.buyerFirstName ||
    existing.buyerLastName !== next.buyerLastName ||
    existing.buyerEmail !== next.buyerEmail ||
    existing.buyerPhone !== next.buyerPhone ||
    existing.amountCents !== next.amountCents ||
    existing.refundStatus !== next.refundStatus ||
    existing.refundedCents !== next.refundedCents ||
    existing.paymentDeleted !== false ||
    existing.windowId !== next.windowId ||
    existing.windowLabelRaw !== next.windowLabelRaw ||
    existing.acknowledged !== next.acknowledged ||
    !sameJson(existing.buyerAnswers, next.buyerAnswers)
  );
}

function stuffyDiffers(existing: ExistingStuffy, next: MappedStuffy): boolean {
  return (
    existing.name !== next.name ||
    existing.description !== next.description ||
    existing.childFirstName !== next.childFirstName ||
    existing.snack !== next.snack ||
    existing.noteToSanta !== next.noteToSanta ||
    existing.careNote !== next.careNote ||
    existing.photoConsent !== next.photoConsent ||
    !sameJson(existing.rawAnswers, next.rawAnswers) ||
    !sameCodes(existing.attentionCodes, next.attentionCodes)
  );
}

export async function applyPaymentSnapshot(
  snapshot: PaymentSnapshot,
  opts: { sessionId: string; source: ApplySource; fetchedAt: Date },
): Promise<ApplyResult> {
  const { sessionId, source, fetchedAt } = opts;

  return db.transaction(async (tx): Promise<ApplyResult> => {
    // 1. Serialise on the payment. First statement, always.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${snapshot.paymentId}))`);

    const [session] = await tx.select().from(swSessions).where(eq(swSessions.id, sessionId)).limit(1);
    if (!session) return { result: "session_not_found" };
    // Personal data of a purged session is gone for good; a stale Sync must not resurrect people.
    if (session.personalPurgedAt) return { result: "purged" };

    const [existing] = await tx
      .select()
      .from(swOrders)
      .where(eq(swOrders.zeffyPaymentId, snapshot.paymentId))
      .limit(1);

    if (existing && existing.sessionId !== sessionId) return { result: "session_mismatch" };
    if (existing?.snapshotAt && fetchedAt.getTime() < existing.snapshotAt.getTime()) {
      return { result: "stale" };
    }

    const mapped = mapPaymentToRegistrants(snapshot, sessionToMapperConfig(session));

    // ---- New order -------------------------------------------------------
    if (!existing) {
      if (!mapped.succeeded) return { result: "not_succeeded" };
      // A wrong campaign mapping (no marked ticket rate) creates nothing, not even the order.
      if (mapped.stuffies.length === 0) return { result: "no_registrants" };

      const [order] = await tx
        .insert(swOrders)
        .values({
          sessionId,
          zeffyPaymentId: snapshot.paymentId,
          source,
          paymentStatus: mapped.order.paymentStatus,
          buyerFirstName: mapped.order.buyerFirstName,
          buyerLastName: mapped.order.buyerLastName,
          buyerEmail: mapped.order.buyerEmail,
          buyerPhone: mapped.order.buyerPhone,
          amountCents: mapped.order.amountCents,
          refundStatus: mapped.order.refundStatus,
          refundedCents: mapped.order.refundedCents,
          windowId: mapped.order.windowId,
          windowLabelRaw: mapped.order.windowLabelRaw,
          buyerAnswers: mapped.order.buyerAnswers,
          acknowledged: mapped.order.acknowledged,
          snapshotAt: fetchedAt,
        })
        .returning({ id: swOrders.id });

      await tx.insert(swStuffies).values(
        mapped.stuffies.map((s) => ({
          sessionId,
          orderId: order.id,
          zeffyItemKey: s.itemKey,
          name: s.name,
          description: s.description,
          childFirstName: s.childFirstName,
          snack: s.snack,
          noteToSanta: s.noteToSanta,
          careNote: s.careNote,
          photoConsent: s.photoConsent,
          rawAnswers: s.rawAnswers,
          attentionCodes: s.attentionCodes,
          needsAttention: s.attentionCodes.length > 0,
          familyToken: newToken128(),
        })),
      );

      return {
        result: "applied",
        orderId: order.id,
        orderCreated: true,
        created: mapped.stuffies.length,
        updated: 0,
        unchanged: 0,
        flaggedMissing: 0,
        orderChanged: true,
        refundChanged: mapped.order.refundStatus !== "none",
      };
    }

    // ---- Known order -----------------------------------------------------
    const refundChanged =
      existing.refundStatus !== mapped.order.refundStatus ||
      existing.refundedCents !== mapped.order.refundedCents ||
      existing.paymentDeleted !== false;
    const orderChanged = orderDiffers(existing, mapped.order);

    if (orderChanged) {
      await tx
        .update(swOrders)
        .set({
          paymentStatus: mapped.order.paymentStatus,
          buyerFirstName: mapped.order.buyerFirstName,
          buyerLastName: mapped.order.buyerLastName,
          buyerEmail: mapped.order.buyerEmail,
          buyerPhone: mapped.order.buyerPhone,
          amountCents: mapped.order.amountCents,
          refundStatus: mapped.order.refundStatus,
          refundedCents: mapped.order.refundedCents,
          paymentDeleted: false,
          windowId: mapped.order.windowId,
          windowLabelRaw: mapped.order.windowLabelRaw,
          buyerAnswers: mapped.order.buyerAnswers,
          acknowledged: mapped.order.acknowledged,
          snapshotAt: fetchedAt,
          updatedAt: new Date(),
        })
        .where(eq(swOrders.id, existing.id));
    } else {
      await tx.update(swOrders).set({ snapshotAt: fetchedAt }).where(eq(swOrders.id, existing.id));
    }

    // A non-succeeded status never creates or flags registrants.
    if (!mapped.succeeded) {
      return {
        result: "applied",
        orderId: existing.id,
        orderCreated: false,
        created: 0,
        updated: 0,
        unchanged: 0,
        flaggedMissing: 0,
        orderChanged,
        refundChanged,
      };
    }

    const current = await tx.select().from(swStuffies).where(eq(swStuffies.orderId, existing.id));
    const byKey = new Map(current.filter((s) => s.zeffyItemKey !== null).map((s) => [s.zeffyItemKey as string, s]));

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let flaggedMissing = 0;

    for (const desired of mapped.stuffies) {
      const row = byKey.get(desired.itemKey);
      if (!row) {
        await tx.insert(swStuffies).values({
          sessionId,
          orderId: existing.id,
          zeffyItemKey: desired.itemKey,
          name: desired.name,
          description: desired.description,
          childFirstName: desired.childFirstName,
          snack: desired.snack,
          noteToSanta: desired.noteToSanta,
          careNote: desired.careNote,
          photoConsent: desired.photoConsent,
          rawAnswers: desired.rawAnswers,
          attentionCodes: desired.attentionCodes,
          needsAttention: desired.attentionCodes.length > 0,
          familyToken: newToken128(),
        });
        created += 1;
        continue;
      }
      if (!stuffyDiffers(row, desired)) {
        unchanged += 1;
        continue;
      }
      const codesChanged = !sameCodes(row.attentionCodes, desired.attentionCodes);
      // A dismissal holds only while the set of reasons is the same one the admin dismissed.
      const stillDismissed = !codesChanged && row.attentionDismissedAt !== null;
      await tx
        .update(swStuffies)
        .set({
          name: desired.name,
          description: desired.description,
          childFirstName: desired.childFirstName,
          snack: desired.snack,
          noteToSanta: desired.noteToSanta,
          careNote: desired.careNote,
          photoConsent: desired.photoConsent,
          rawAnswers: desired.rawAnswers,
          attentionCodes: desired.attentionCodes,
          needsAttention: desired.attentionCodes.length > 0 && !stillDismissed,
          attentionDismissedAt: codesChanged ? null : row.attentionDismissedAt,
          updatedAt: new Date(),
        })
        .where(eq(swStuffies.id, row.id));
      updated += 1;
    }

    // Flag, never delete, an item that disappeared from the order.
    const desiredKeys = new Set(mapped.stuffies.map((s) => s.itemKey));
    for (const row of current) {
      if (row.zeffyItemKey === null || desiredKeys.has(row.zeffyItemKey)) continue;
      if (row.attentionCodes.includes("not_in_order_now")) continue;
      const nextCodes: AttentionCode[] = [...(row.attentionCodes as AttentionCode[]), "not_in_order_now"];
      await tx
        .update(swStuffies)
        .set({ attentionCodes: nextCodes, needsAttention: true, attentionDismissedAt: null, updatedAt: new Date() })
        .where(eq(swStuffies.id, row.id));
      flaggedMissing += 1;
    }

    return {
      result: "applied",
      orderId: existing.id,
      orderCreated: false,
      created,
      updated,
      unchanged,
      flaggedMissing,
      orderChanged,
      refundChanged,
    };
  });
}

/**
 * Zeffy says the payment no longer exists (a 404 on fetch, or payment.deleted).
 * Flags the order; never deletes, and never blocks a hand-over. Returns false
 * when no order exists for the payment (nothing to flag).
 */
export async function markPaymentDeleted(paymentId: string, fetchedAt: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${paymentId}))`);
    const [order] = await tx.select().from(swOrders).where(eq(swOrders.zeffyPaymentId, paymentId)).limit(1);
    if (!order) return false;
    if (order.snapshotAt && fetchedAt.getTime() < order.snapshotAt.getTime()) return true; // stale: ignore
    await tx
      .update(swOrders)
      .set({ paymentDeleted: true, snapshotAt: fetchedAt, updatedAt: new Date() })
      .where(eq(swOrders.id, order.id));
    return true;
  });
}

export async function findOrderByPayment(paymentId: string): Promise<{ id: string; sessionId: string } | null> {
  const [row] = await db
    .select({ id: swOrders.id, sessionId: swOrders.sessionId })
    .from(swOrders)
    .where(eq(swOrders.zeffyPaymentId, paymentId))
    .limit(1);
  return row ?? null;
}

export async function findSessionByCampaign(campaignId: string): Promise<SwSession | null> {
  const [row] = await db.select().from(swSessions).where(eq(swSessions.zeffyCampaignId, campaignId)).limit(1);
  return row ?? null;
}

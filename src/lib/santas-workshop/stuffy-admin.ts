/**
 * Admin actions on registrants (Slice 2): manual add, backward move, withdraw,
 * attention dismissal and the refund Keep/Withdraw resolutions. Server-only.
 * The state writes go through stuffy-transitions.ts (pinned UPDATE, rollback
 * sentinel, history row); the rest are single pinned UPDATEs. No email.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swSessions, swStuffies, swStuffyEvents, type SwSession } from "@/lib/db/schema";
import type { RefundResolutionResponse, RegistrantDto } from "./admin-contract";
import { MANUAL_REASON_MAX, MANUAL_REASON_MIN, type ManualAddInput } from "./manual-add";
import { failure, isUniqueViolation, toRegistrantDto, type QueryFailure } from "./session-queries";
import { logSessionEvent } from "./session-log";
import { eventRow, revertStuffy, withdrawStuffy, type TransitionFailure, type TransitionResult } from "./stuffy-transitions";
import { isStuffyState, type StuffyState } from "./state-machine";
import { newToken128 } from "./tokens";

export async function getRegistrant(session: SwSession, stuffyId: string): Promise<RegistrantDto | null> {
  const [row] = await db
    .select({
      stuffy: swStuffies,
      order: swOrders,
      orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
    })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, session.id)))
    .limit(1);
  return row ? toRegistrantDto(row.stuffy, row.order, row.orderSize, session.windows, session.questionMap) : null;
}

/** A stuffy and the session it belongs to (the stuffy-scoped admin routes carry no session id). */
export async function loadStuffyContext(stuffyId: string): Promise<{ session: SwSession; stuffyId: string } | null> {
  const [row] = await db
    .select({ session: swSessions })
    .from(swStuffies)
    .innerJoin(swSessions, eq(swStuffies.sessionId, swSessions.id))
    .where(eq(swStuffies.id, stuffyId))
    .limit(1);
  return row ? { session: row.session, stuffyId } : null;
}

const purged = (s: SwSession) => s.personalPurgedAt !== null || s.status === "purged";

// ---------------------------------------------------------------------------
// Manual add
// ---------------------------------------------------------------------------

export async function manualAdd(
  session: SwSession,
  input: ManualAddInput,
  userId: string,
): Promise<{ ok: true; registrant: RegistrantDto; replayed: boolean } | QueryFailure> {
  if (purged(session)) return failure(409, "session_purged", "A purged session cannot be changed");

  const replay = async () => {
    const [hit] = await db
      .select({ stuffyId: swStuffyEvents.stuffyId })
      .from(swStuffyEvents)
      .where(and(eq(swStuffyEvents.sessionId, session.id), eq(swStuffyEvents.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    const registrant = hit ? await getRegistrant(session, hit.stuffyId) : null;
    return registrant ? ({ ok: true, registrant, replayed: true } as const) : null;
  };
  const earlier = await replay();
  if (earlier) return earlier;

  try {
    const stuffyId = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(swOrders)
        .values({
          sessionId: session.id,
          source: "manual",
          buyerFirstName: input.parentFirstName,
          buyerLastName: input.parentLastName,
          buyerEmail: input.parentEmail,
          buyerPhone: input.parentPhone,
          windowId: input.windowId,
          manualReason: input.reason,
          createdByUserId: userId,
        })
        .returning({ id: swOrders.id });
      const [stuffy] = await tx
        .insert(swStuffies)
        .values({
          sessionId: session.id,
          orderId: order.id,
          name: input.stuffyName,
          description: input.description,
          snack: input.snack,
          noteToSanta: input.noteToSanta,
          careNote: input.careNote,
          photoConsent: input.photoConsent,
          familyToken: newToken128(),
          state: "registered",
        })
        .returning({ id: swStuffies.id });
      await tx.insert(swStuffyEvents).values(
        eventRow(
          { sessionId: session.id, sessionKind: session.kind === "practice" ? "practice" : "real", actor: { kind: "admin", userId } },
          stuffy.id,
          { kind: "manual_add", toState: "registered", idempotencyKey: input.idempotencyKey, note: input.reason },
        ),
      );
      return stuffy.id;
    });
    await logSessionEvent(session.id, userId, "manual_add", { orders: 1, stuffies: 1 });
    const registrant = await getRegistrant(session, stuffyId);
    return registrant ? { ok: true, registrant, replayed: false } : failure(404, "not_found", "Registrant not found");
  } catch (e) {
    if (isUniqueViolation(e, "ux_sw_stuffy_events_idem")) {
      const again = await replay();
      if (again) return again;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Revert / withdraw / dismiss
// ---------------------------------------------------------------------------

export function validateReason(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof v !== "string") return { ok: false, error: "A reason is required" };
  const t = v.trim();
  if (t.length < MANUAL_REASON_MIN) return { ok: false, error: `Give a reason of at least ${MANUAL_REASON_MIN} characters` };
  if (t.length > MANUAL_REASON_MAX) return { ok: false, error: `The reason must be at most ${MANUAL_REASON_MAX} characters` };
  return { ok: true, value: t };
}

export function transitionFailureToQuery(f: TransitionFailure): QueryFailure {
  switch (f.code) {
    case "not_found":
      return failure(404, "not_found", "Registrant not found");
    case "stale_state":
      return failure(409, "stale_state", "That stuffy changed while you were looking", undefined, { currentState: f.currentState });
    case "withdraw_not_allowed":
      return failure(409, "withdraw_not_allowed", "A stuffy in custody can only be flagged, not withdrawn", undefined, { currentState: f.currentState });
    case "invalid_input":
      return failure(400, "invalid_input", f.error);
    case "withdrawn":
      return failure(409, "invalid_transition", "That registration was withdrawn");
    case "illegal_transition":
    case "already_picked_up":
    case "pickup_check_required":
    case "name_not_shown":
    case "portrait_exists":
    case "practice_only":
    case "confirm_move":
    case "confirm_replace":
    case "holder_advanced":
    case "tag_already_bound":
      return failure(409, "invalid_transition", "That step is not available from where this stuffy is");
    default: {
      const _never: never = f;
      return _never;
    }
  }
}

export async function adminRevert(
  session: SwSession,
  stuffyId: string,
  input: { toState: StuffyState; expectedState: StuffyState; reason: string },
  userId: string,
): Promise<{ ok: true; registrant: RegistrantDto } | QueryFailure> {
  if (purged(session)) return failure(409, "session_purged", "A purged session cannot be changed");
  if (!isStuffyState(input.toState) || !isStuffyState(input.expectedState)) return failure(400, "invalid_input", "Unknown state");
  const result: TransitionResult = await revertStuffy(
    { sessionId: session.id, sessionKind: session.kind === "practice" ? "practice" : "real", actor: { kind: "admin", userId } },
    { stuffyId, toState: input.toState, expectedState: input.expectedState, reason: input.reason },
  );
  if (!result.ok) return transitionFailureToQuery(result);
  await logSessionEvent(session.id, userId, "stuffy_reverted", { to: input.toState });
  const registrant = await getRegistrant(session, stuffyId);
  return registrant ? { ok: true, registrant } : failure(404, "not_found", "Registrant not found");
}

export async function adminWithdraw(
  session: SwSession,
  stuffyId: string,
  reason: string,
  userId: string,
): Promise<{ ok: true; registrant: RegistrantDto } | QueryFailure> {
  if (purged(session)) return failure(409, "session_purged", "A purged session cannot be changed");
  const result = await withdrawStuffy(
    { sessionId: session.id, sessionKind: session.kind === "practice" ? "practice" : "real", actor: { kind: "admin", userId } },
    { stuffyId, reason },
  );
  if (!result.ok) return transitionFailureToQuery(result);
  await logSessionEvent(session.id, userId, "stuffy_withdrawn", { count: 1 });
  const registrant = await getRegistrant(session, stuffyId);
  return registrant ? { ok: true, registrant } : failure(404, "not_found", "Registrant not found");
}

/** Pinned on `needs_attention = true`: a second click is a harmless no-op. */
export async function dismissAttention(session: SwSession, stuffyId: string, userId: string): Promise<{ ok: true; registrant: RegistrantDto } | QueryFailure> {
  if (purged(session)) return failure(409, "session_purged", "A purged session cannot be changed");
  const now = new Date();
  const updated = await db
    .update(swStuffies)
    .set({ needsAttention: false, attentionDismissedAt: now })
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, session.id), eq(swStuffies.needsAttention, true)))
    .returning({ id: swStuffies.id });
  if (updated.length > 0) await logSessionEvent(session.id, userId, "attention_dismissed", { count: 1 });
  const registrant = await getRegistrant(session, stuffyId);
  return registrant ? { ok: true, registrant } : failure(404, "not_found", "Registrant not found");
}

// ---------------------------------------------------------------------------
// Refund resolution
// ---------------------------------------------------------------------------

export async function resolveRefund(
  session: SwSession,
  orderId: string,
  resolution: "keep" | "withdraw",
  userId: string,
): Promise<{ ok: true; result: RefundResolutionResponse } | QueryFailure> {
  if (purged(session)) return failure(409, "session_purged", "A purged session cannot be changed");
  const [order] = await db.select({ id: swOrders.id }).from(swOrders).where(and(eq(swOrders.id, orderId), eq(swOrders.sessionId, session.id))).limit(1);
  if (!order) return failure(404, "not_found", "Order not found");

  const markResolved = async () => {
    // Stores the amount refunded at THIS moment, so a later, bigger refund reopens the flag by itself.
    await db
      .update(swOrders)
      .set({ refundResolutionCents: sql`${swOrders.refundedCents}`, refundResolvedAt: new Date(), refundResolvedByUserId: userId })
      .where(and(eq(swOrders.id, orderId), eq(swOrders.sessionId, session.id)));
  };

  if (resolution === "keep") {
    await markResolved();
    await logSessionEvent(session.id, userId, "refund_kept", { orders: 1 });
    return { ok: true, result: { orderId, withdrawn: 0, stillInCustody: 0, resolved: true } };
  }

  const stuffies = await db
    .select({ id: swStuffies.id, state: swStuffies.state })
    .from(swStuffies)
    .where(and(eq(swStuffies.orderId, orderId), eq(swStuffies.sessionId, session.id), isNull(swStuffies.withdrawnAt)));
  let withdrawn = 0;
  let inCustody = 0;
  for (const s of stuffies) {
    if (s.state !== "registered" && s.state !== "tagged") {
      inCustody += 1;
      continue;
    }
    const r = await withdrawStuffy(
      { sessionId: session.id, sessionKind: session.kind === "practice" ? "practice" : "real", actor: { kind: "admin", userId } },
      { stuffyId: s.id, reason: "Refunded" },
    );
    if (r.ok) withdrawn += 1;
    else if (r.code === "withdraw_not_allowed" || r.code === "stale_state") inCustody += 1;
  }
  const resolved = inCustody === 0;
  if (resolved) await markResolved();
  await logSessionEvent(session.id, userId, "refund_withdraw", { withdrawn, stillInCustody: inCustody });
  return { ok: true, result: { orderId, withdrawn, stillInCustody: inCustody, resolved } };
}

/** The session an order belongs to (the order-scoped refund route carries no session id). */
export async function loadOrderSession(orderId: string): Promise<SwSession | null> {
  const [row] = await db
    .select({ session: swSessions })
    .from(swOrders)
    .innerJoin(swSessions, eq(swOrders.sessionId, swSessions.id))
    .where(eq(swOrders.id, orderId))
    .limit(1);
  return row?.session ?? null;
}

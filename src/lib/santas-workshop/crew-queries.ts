/**
 * Read side of the worker API: roster, search, scan and the least-data view
 * cards. Server-only (imports db). Every DTO is built by `toCrewRow()` or a card
 * builder here; none can carry a buyer email, mobile, Zeffy id, note or amount.
 * Parent NAME leaves the server only in the tag card and the pickup-check
 * response (Ruling 19); search MATCHES on it but never returns it.
 */

import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swPhotos, swStuffies, swStuffyEvents, type SwSession } from "@/lib/db/schema";
import type {
  CrewCheckInCard,
  CrewPickupCard,
  CrewPortraitCard,
  CrewRosterResponse,
  CrewRosterRow,
  CrewTagCard,
  CrewView,
  CrewViewCard,
  ScanResult,
} from "./crew-contract";
import { workerRefundBadge } from "./payment-mapper";
import { isStuffyState } from "./state-machine";
import { last4, normalizeTagCode } from "./tag-binding";

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_MAX_ROWS = 10;
const DESCRIPTION_CHARS = 80;

export interface CrewRowSource {
  stuffy: {
    id: string;
    orderId: string;
    name: string | null;
    description: string | null;
    state: string;
    tagCode: string | null;
    needsAttention: boolean;
  };
  order: {
    windowId: string | null;
    refundStatus: string;
    refundedCents: number;
    paymentDeleted: boolean;
    refundResolutionCents: number | null;
  };
  orderSize: number;
  hasCheckInPhoto: boolean;
  hasPortrait: boolean;
}

/** The single mapper behind every crew list row. Reads only the fields the contract names. */
export function toCrewRow(src: CrewRowSource): CrewRosterRow {
  const { stuffy, order } = src;
  return {
    id: stuffy.id,
    name: stuffy.name,
    description: stuffy.description ? stuffy.description.slice(0, DESCRIPTION_CHARS) : null,
    state: isStuffyState(stuffy.state) ? stuffy.state : "registered",
    windowId: order.windowId,
    orderId: stuffy.orderId,
    orderSize: src.orderSize,
    last4: last4(stuffy.tagCode),
    refundBadge: workerRefundBadge({
      refundStatus: order.refundStatus,
      refundedCents: order.refundedCents,
      paymentDeleted: order.paymentDeleted,
      refundResolutionCents: order.refundResolutionCents,
    }),
    detailsBeingChecked: stuffy.needsAttention,
    hasCheckInPhoto: src.hasCheckInPhoto,
    hasPortrait: src.hasPortrait,
  };
}

/** Ordered by window, then name; refunded rows sink to the bottom. */
export function sortCrewRows(rows: CrewRosterRow[], windows: readonly { id: string }[]): CrewRosterRow[] {
  const windowIndex = (id: string | null) => {
    const i = id ? windows.findIndex((w) => w.id === id) : -1;
    return i < 0 ? windows.length : i;
  };
  return [...rows].sort((a, b) => {
    if (a.refundBadge !== b.refundBadge) return a.refundBadge ? 1 : -1;
    const w = windowIndex(a.windowId) - windowIndex(b.windowId);
    if (w !== 0) return w;
    const an = (a.name ?? "￿").toLowerCase();
    const bn = (b.name ?? "￿").toLowerCase();
    return an.localeCompare(bn) || a.id.localeCompare(b.id);
  });
}

const rowColumns = {
  id: swStuffies.id,
  orderId: swStuffies.orderId,
  name: swStuffies.name,
  description: swStuffies.description,
  state: swStuffies.state,
  tagCode: swStuffies.tagCode,
  needsAttention: swStuffies.needsAttention,
  windowId: swOrders.windowId,
  refundStatus: swOrders.refundStatus,
  refundedCents: swOrders.refundedCents,
  paymentDeleted: swOrders.paymentDeleted,
  refundResolutionCents: swOrders.refundResolutionCents,
  orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
  hasCheckInPhoto: sql<boolean>`exists (select 1 from sw_photos p where p.stuffy_id = ${swStuffies.id} and p.kind = 'check_in' and p.superseded_at is null)`,
  hasPortrait: sql<boolean>`exists (select 1 from sw_photos p where p.stuffy_id = ${swStuffies.id} and p.kind = 'portrait' and p.superseded_at is null)`,
};

function mapRow(r: {
  id: string;
  orderId: string;
  name: string | null;
  description: string | null;
  state: string;
  tagCode: string | null;
  needsAttention: boolean;
  windowId: string | null;
  refundStatus: string;
  refundedCents: number;
  paymentDeleted: boolean;
  refundResolutionCents: number | null;
  orderSize: number;
  hasCheckInPhoto: boolean;
  hasPortrait: boolean;
}): CrewRosterRow {
  return toCrewRow({
    stuffy: { id: r.id, orderId: r.orderId, name: r.name, description: r.description, state: r.state, tagCode: r.tagCode, needsAttention: r.needsAttention },
    order: { windowId: r.windowId, refundStatus: r.refundStatus, refundedCents: r.refundedCents, paymentDeleted: r.paymentDeleted, refundResolutionCents: r.refundResolutionCents },
    orderSize: r.orderSize,
    hasCheckInPhoto: r.hasCheckInPhoto,
    hasPortrait: r.hasPortrait,
  });
}
export async function loadRoster(session: SwSession, admin: boolean): Promise<CrewRosterResponse> {
  const rows = await db
    .select(rowColumns)
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.sessionId, session.id), isNull(swStuffies.withdrawnAt)));
  return {
    serverTime: new Date().toISOString(),
    session: {
      name: session.name,
      kind: session.kind as "practice" | "real",
      status: session.status as "draft" | "active" | "closed" | "purged",
      windows: session.windows,
      admin,
    },
    stuffies: sortCrewRows(rows.map(mapRow), session.windows),
  };
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Matches stuffy name and parent first/last name; returns rows WITHOUT the parent name (Ruling 19). */
export async function searchRoster(session: SwSession, q: string): Promise<CrewRosterRow[]> {
  const term = q.trim().slice(0, 60);
  if (term.length < SEARCH_MIN_CHARS) return [];
  const like = `%${escapeLike(term)}%`;
  const match = or(
    ilike(swStuffies.name, like),
    ilike(swOrders.buyerFirstName, like),
    ilike(swOrders.buyerLastName, like),
    ilike(sql`concat_ws(' ', ${swOrders.buyerFirstName}, ${swOrders.buyerLastName})`, like),
  );
  const rows = await db
    .select(rowColumns)
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.sessionId, session.id), isNull(swStuffies.withdrawnAt), match))
    .orderBy(asc(swStuffies.name), asc(swStuffies.id))
    .limit(SEARCH_MAX_ROWS);
  return sortCrewRows(rows.map(mapRow), session.windows).slice(0, SEARCH_MAX_ROWS);
}

/** One row by id, session-scoped (the IDOR guard: another session's stuffy is null). */
export async function getCrewRow(sessionId: string, stuffyId: string): Promise<CrewRosterRow | null> {
  const [row] = await db
    .select(rowColumns)
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, sessionId)))
    .limit(1);
  return row ? mapRow(row) : null;
}

/** POST scan: the code is in the body, never a URL. A code bound in another session answers like an unbound one. */
export async function scanCode(sessionId: string, rawCode: unknown): Promise<ScanResult | { invalid: string }> {
  const norm = normalizeTagCode(rawCode);
  if (!norm.ok) return { invalid: norm.error };

  const [hit] = await db
    .select({ ...rowColumns, withdrawnAt: swStuffies.withdrawnAt })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.sessionId, sessionId), eq(swStuffies.tagCode, norm.code)))
    .limit(1);
  if (hit) return hit.withdrawnAt ? { result: "withdrawn" } : { result: "found", stuffy: mapRow(hit) };

  const [retired] = await db
    .select({ id: swStuffyEvents.id })
    .from(swStuffyEvents)
    .where(and(eq(swStuffyEvents.sessionId, sessionId), eq(swStuffyEvents.prevTagCode, norm.code)))
    .limit(1);
  return retired ? { result: "retired" } : { result: "not_tagged" };
}

// ---------------------------------------------------------------------------
// View cards
// ---------------------------------------------------------------------------

export async function getViewCard(session: SwSession, stuffyId: string, view: CrewView): Promise<CrewViewCard | null> {
  const [row] = await db
    .select({
      stuffy: swStuffies,
      first: swOrders.buyerFirstName,
      last: swOrders.buyerLastName,
      windowId: swOrders.windowId,
      refundStatus: swOrders.refundStatus,
      refundedCents: swOrders.refundedCents,
      paymentDeleted: swOrders.paymentDeleted,
      refundResolutionCents: swOrders.refundResolutionCents,
      orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
    })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(and(eq(swStuffies.id, stuffyId), eq(swStuffies.sessionId, session.id), isNull(swStuffies.withdrawnAt)))
    .limit(1);
  if (!row) return null;

  const s = row.stuffy;
  const state = isStuffyState(s.state) ? s.state : "registered";
  const base = {
    id: s.id,
    name: s.name,
    description: s.description ? s.description.slice(0, 400) : null,
    state,
    windowLabel: session.windows.find((w) => w.id === row.windowId)?.label ?? null,
    refundBadge: workerRefundBadge({
      refundStatus: row.refundStatus,
      refundedCents: row.refundedCents,
      paymentDeleted: row.paymentDeleted,
      refundResolutionCents: row.refundResolutionCents,
    }),
  };

  if (view === "tag") {
    const parentName = [row.first, row.last].filter((p): p is string => !!p && p.trim().length > 0).join(" ").trim();
    const card: CrewTagCard = { ...base, view: "tag", parentName: parentName || null, orderSize: row.orderSize, last4: last4(s.tagCode) };
    return card;
  }
  if (view === "checkin") {
    const card: CrewCheckInCard = { ...base, view: "checkin", snack: s.snack, careNote: s.careNote };
    return card;
  }

  const photos = await db
    .select({ id: swPhotos.id, kind: swPhotos.kind, hiddenAt: swPhotos.hiddenAt })
    .from(swPhotos)
    .where(and(eq(swPhotos.stuffyId, s.id), isNull(swPhotos.supersededAt), or(eq(swPhotos.kind, "check_in"), eq(swPhotos.kind, "portrait"))));
  const checkIn = photos.find((p) => p.kind === "check_in" && !p.hiddenAt) ?? null;
  const portrait = photos.find((p) => p.kind === "portrait") ?? null;

  if (view === "portrait") {
    const card: CrewPortraitCard = { ...base, view: "portrait", noteToSanta: s.noteToSanta, checkInPhotoId: checkIn?.id ?? null, hasPortrait: portrait !== null };
    return card;
  }
  const card: CrewPickupCard = {
    ...base,
    view: "pickup",
    hasPortrait: portrait !== null,
    checkInPhotoId: checkIn?.id ?? null,
    portraitPhotoId: portrait && !portrait.hiddenAt ? portrait.id : null,
    pickedUpAt: s.pickedUpAt ? s.pickedUpAt.toISOString() : null,
  };
  return card;
}

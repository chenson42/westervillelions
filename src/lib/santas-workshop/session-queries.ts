/**
 * Session reads and writes for the admin API. Server-only (imports db).
 *
 * Every function returns a typed result (`{ ok: true, ... }` or an error with
 * the HTTP status and AdminErrorCode) so the route handlers stay thin and the
 * rules live in one place. Nothing here emails, calls Zeffy (the connect
 * function takes the client as a parameter), or touches photo storage.
 */

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, max, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders, swSessionLog, swSessions, swStuffies, zeffyEvents } from "@/lib/db/schema";
import type { SwOrder, SwSession, SwStuffy } from "@/lib/db/schema";
import { zeffyConfigStatus } from "@/lib/zeffy/config";
import { ZeffyError, type ZeffyClient } from "@/lib/zeffy/client";
import { lastCampaignEventReceivedAt, lastEventReceivedAt } from "@/lib/zeffy/events-queries";
import type {
  AdminErrorCode,
  ConnectCampaignResponse,
  CreateSessionRequest,
  QuestionsResponse,
  RegistrantDto,
  RegistrantsResponse,
  SeenQuestion,
  SessionDto,
  SessionListItem,
  SessionOverview,
  UpdateSessionRequest,
  WindowCount,
} from "./admin-contract";
import { logSessionEvent } from "./session-log";
import { buildChecklist, unmappedRequiredFields } from "./session-checklist";
import { DEFAULT_QUOTA_BYTES, defaultCrewClosesOn, defaultRetention, validateSessionDates } from "./session-input";
import { isStuffyState, STUFFY_STATES, type StuffyState } from "./state-machine";
import { partialRefundFlag, workerRefundBadge, type AttentionCode } from "./payment-mapper";
import { QUESTION_FIELDS, normalizeQuestionText, type QuestionMap } from "./question-fields";
import { unmatchedAnswers } from "./unmatched-answers";
import { groupUnmatchedWindowAnswers, type UnmatchedWindowAnswer } from "./unmatched-window-answers";
import { newToken128 } from "./tokens";
import { previewRemapAttention } from "./remap";
import type { SnapshotQuestion } from "@/lib/zeffy/snapshot";

export interface QueryFailure {
  ok: false;
  status: 400 | 404 | 409 | 502 | 503;
  code: AdminErrorCode;
  error: string;
  field?: string;
}
const failure = (status: QueryFailure["status"], code: AdminErrorCode, error: string, field?: string): QueryFailure => ({
  ok: false,
  status,
  code,
  error,
  ...(field ? { field } : {}),
});

/** Postgres unique violation, however the driver wraps it. */
export function isUniqueViolation(e: unknown, constraintHint?: string): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } } | null;
  const code = err?.code ?? err?.cause?.code;
  if (code !== "23505") return false;
  if (!constraintHint) return true;
  const name = err?.constraint_name ?? err?.cause?.constraint_name ?? "";
  return name.includes(constraintHint);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toSessionDto(row: SwSession): SessionDto {
  const mappedStringCounts: Record<string, number> = {};
  for (const [key, list] of Object.entries(row.questionMap)) mappedStringCounts[key] = list.length;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind as SessionDto["kind"],
    status: row.status as SessionDto["status"],
    dropoffDate: row.dropoffDate,
    photoDate: row.photoDate,
    pickupDate: row.pickupDate,
    windows: row.windows,
    crewClosesOn: row.crewClosesOn,
    zeffy: {
      campaignId: row.zeffyCampaignId,
      campaignTitle: row.zeffyCampaignTitle,
      ticketRateIds: row.zeffyTicketRateIds,
      mappedStringCounts,
    },
    storageQuotaBytes: row.storageQuotaBytes,
    frameArtKey: row.frameArtKey,
    frameFilePrefix: row.frameFilePrefix,
    framePartSize: row.framePartSize,
    purgePersonalOn: row.purgePersonalOn,
    purgePublicOn: row.purgePublicOn,
    personalPurgedAt: iso(row.personalPurgedAt),
    publicPurgedAt: iso(row.publicPurgedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSessionRow(id: string): Promise<SwSession | null> {
  const [row] = await db.select().from(swSessions).where(eq(swSessions.id, id)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// List / create
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<SessionListItem[]> {
  const rows = await db.select().from(swSessions).orderBy(desc(swSessions.createdAt));
  if (rows.length === 0) return [];

  const stuffyCounts = await db
    .select({
      sessionId: swStuffies.sessionId,
      total: sql<number>`count(*)::int`,
      attention: sql<number>`(count(*) filter (where ${swStuffies.needsAttention}))::int`,
    })
    .from(swStuffies)
    .groupBy(swStuffies.sessionId);
  const events = await db
    .select({ sessionId: zeffyEvents.sessionId, at: max(zeffyEvents.receivedAt) })
    .from(zeffyEvents)
    .where(isNotNull(zeffyEvents.sessionId))
    .groupBy(zeffyEvents.sessionId);

  const countsBySession = new Map(stuffyCounts.map((c) => [c.sessionId, c]));
  const eventBySession = new Map(events.map((e) => [e.sessionId, e.at]));

  return rows.map((row) => ({
    ...toSessionDto(row),
    stuffyCount: countsBySession.get(row.id)?.total ?? 0,
    needsAttentionCount: countsBySession.get(row.id)?.attention ?? 0,
    lastZeffyEventAt: iso(eventBySession.get(row.id) ?? null),
  }));
}

export async function createSession(
  input: CreateSessionRequest,
  userId: string,
): Promise<{ ok: true; session: SessionDto } | QueryFailure> {
  const retention = defaultRetention(input.pickupDate);
  try {
    const [row] = await db
      .insert(swSessions)
      .values({
        slug: input.slug,
        name: input.name,
        kind: input.kind,
        dropoffDate: input.dropoffDate,
        photoDate: input.photoDate,
        pickupDate: input.pickupDate,
        windows: input.windows,
        crewClosesOn: defaultCrewClosesOn(input.pickupDate),
        collageToken: newToken128(),
        storageQuotaBytes: DEFAULT_QUOTA_BYTES[input.kind],
        purgePersonalOn: retention.purgePersonalOn,
        purgePublicOn: retention.purgePublicOn,
        createdByUserId: userId,
      })
      .returning();
    await logSessionEvent(row.id, userId, "created", { kind: input.kind });
    return { ok: true, session: toSessionDto(row) };
  } catch (e) {
    if (isUniqueViolation(e, "slug")) return failure(409, "slug_taken", "That slug is already in use", "slug");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getSessionOverview(id: string): Promise<SessionOverview | null> {
  const row = await getSessionRow(id);
  if (!row) return null;

  const [totals] = await db
    .select({
      stuffies: sql<number>`count(*)::int`,
      withdrawn: sql<number>`(count(*) filter (where ${swStuffies.withdrawnAt} is not null))::int`,
      attention: sql<number>`(count(*) filter (where ${swStuffies.needsAttention}))::int`,
    })
    .from(swStuffies)
    .where(eq(swStuffies.sessionId, id));

  const byStateRows = await db
    .select({ state: swStuffies.state, n: sql<number>`count(*)::int` })
    .from(swStuffies)
    .where(eq(swStuffies.sessionId, id))
    .groupBy(swStuffies.state);
  const byState = Object.fromEntries(STUFFY_STATES.map((s) => [s, 0])) as Record<StuffyState, number>;
  for (const r of byStateRows) if (isStuffyState(r.state)) byState[r.state] = r.n;

  const byWindowRows = await db
    .select({ windowId: swOrders.windowId, n: sql<number>`count(*)::int` })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(eq(swStuffies.sessionId, id))
    .groupBy(swOrders.windowId);
  const labelOf = new Map(row.windows.map((w) => [w.id, w.label]));
  const byWindow: WindowCount[] = byWindowRows
    .map((r) => ({
      windowId: r.windowId && labelOf.has(r.windowId) ? r.windowId : null,
      label: r.windowId && labelOf.has(r.windowId) ? (labelOf.get(r.windowId) as string) : "Unmapped window",
      n: r.n,
    }))
    .reduce<WindowCount[]>((acc, r) => {
      const hit = acc.find((a) => a.windowId === r.windowId);
      if (hit) hit.count += r.n;
      else acc.push({ windowId: r.windowId, label: r.label, count: r.n });
      return acc;
    }, [])
    .sort((a, b) => a.label.localeCompare(b.label));

  const [orderStats] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      refundsOpen: sql<number>`(count(*) filter (where (${swOrders.refundStatus} <> 'none' or ${swOrders.paymentDeleted}) and ${swOrders.refundResolutionCents} is distinct from ${swOrders.refundedCents}))::int`,
    })
    .from(swOrders)
    .where(eq(swOrders.sessionId, id));

  const [sync] = await db
    .select({ at: max(swSessionLog.createdAt) })
    .from(swSessionLog)
    .where(and(eq(swSessionLog.sessionId, id), eq(swSessionLog.kind, "sync_run")));

  const lastAny = await lastEventReceivedAt();
  const lastCampaign = row.zeffyCampaignId ? await lastCampaignEventReceivedAt(row.zeffyCampaignId) : null;
  const config = zeffyConfigStatus();

  const checklist = buildChecklist({
    now: new Date(),
    campaignConnected: !!row.zeffyCampaignId,
    ticketRateCount: row.zeffyTicketRateIds.length,
    unmappedRequiredFields: unmappedRequiredFields(row.questionMap),
    webhookSecretSet: config.webhookSecretSet,
    apiKeySet: config.apiKeySet,
    orderCount: orderStats?.orders ?? 0,
    lastCampaignEventAt: lastCampaign,
    lastAnyEventAt: lastAny,
    lastSyncAt: sync?.at ?? null,
    dropoffDate: row.dropoffDate,
  });

  return {
    ...toSessionDto(row),
    counts: {
      orders: orderStats?.orders ?? 0,
      stuffies: totals?.stuffies ?? 0,
      withdrawn: totals?.withdrawn ?? 0,
      byState,
      byWindow,
    },
    needsAttention: totals?.attention ?? 0,
    refundsOpen: orderStats?.refundsOpen ?? 0,
    lastZeffyEventAt: iso(lastAny),
    lastCampaignEventAt: iso(lastCampaign),
    lastSyncAt: iso(sync?.at ?? null),
    zeffyConfig: config,
    checklist,
  };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export async function updateSession(
  id: string,
  patch: UpdateSessionRequest,
  userId: string,
): Promise<{ ok: true; session: SessionDto } | QueryFailure> {
  const row = await getSessionRow(id);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.personalPurgedAt) return failure(409, "session_purged", "A purged session cannot be edited");

  const merged = {
    dropoffDate: patch.dropoffDate ?? row.dropoffDate,
    photoDate: patch.photoDate ?? row.photoDate,
    pickupDate: patch.pickupDate ?? row.pickupDate,
    crewClosesOn: patch.crewClosesOn ?? row.crewClosesOn,
    purgePersonalOn: patch.purgePersonalOn ?? row.purgePersonalOn,
    purgePublicOn: patch.purgePublicOn ?? row.purgePublicOn,
  };
  const dates = validateSessionDates(merged);
  if (!dates.ok) return failure(400, dates.code, dates.error, dates.field);

  if (patch.windows) {
    // A window a registrant references keeps its id; removing or re-keying it is refused.
    const keep = new Set(patch.windows.map((w) => w.id));
    const removed = row.windows.map((w) => w.id).filter((wid) => !keep.has(wid));
    if (removed.length > 0) {
      const [inUse] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(swOrders)
        .where(and(eq(swOrders.sessionId, id), inArray(swOrders.windowId, removed)));
      if ((inUse?.n ?? 0) > 0) {
        return failure(409, "window_in_use", "A window that registrants chose cannot be removed", "windows");
      }
    }
  }

  const [updated] = await db
    .update(swSessions)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.dropoffDate !== undefined ? { dropoffDate: patch.dropoffDate } : {}),
      ...(patch.photoDate !== undefined ? { photoDate: patch.photoDate } : {}),
      ...(patch.pickupDate !== undefined ? { pickupDate: patch.pickupDate } : {}),
      ...(patch.windows !== undefined ? { windows: patch.windows } : {}),
      ...(patch.crewClosesOn !== undefined ? { crewClosesOn: patch.crewClosesOn } : {}),
      ...(patch.purgePersonalOn !== undefined ? { purgePersonalOn: patch.purgePersonalOn } : {}),
      ...(patch.purgePublicOn !== undefined ? { purgePublicOn: patch.purgePublicOn } : {}),
      ...(patch.storageQuotaBytes !== undefined ? { storageQuotaBytes: patch.storageQuotaBytes } : {}),
      ...(patch.frameArtKey !== undefined ? { frameArtKey: patch.frameArtKey } : {}),
      ...(patch.frameFilePrefix !== undefined ? { frameFilePrefix: patch.frameFilePrefix } : {}),
      ...(patch.framePartSize !== undefined ? { framePartSize: patch.framePartSize } : {}),
      updatedAt: new Date(),
    })
    .where(eq(swSessions.id, id))
    .returning();
  await logSessionEvent(id, userId, "session_updated", { fields: Object.keys(patch).join(",") });
  return { ok: true, session: toSessionDto(updated) };
}

/** Distinct window answers of this session's orders that matched no window (admin edit page; no route). */
export async function listUnmatchedWindowAnswers(id: string): Promise<UnmatchedWindowAnswer[]> {
  const rows = await db
    .select({ windowId: swOrders.windowId, windowLabelRaw: swOrders.windowLabelRaw })
    .from(swOrders)
    .where(and(eq(swOrders.sessionId, id), isNull(swOrders.windowId), isNotNull(swOrders.windowLabelRaw)));
  return groupUnmatchedWindowAnswers(rows);
}

// ---------------------------------------------------------------------------
// Connect + question map
// ---------------------------------------------------------------------------

export async function connectCampaign(
  id: string,
  input: { campaignId: string; ticketRateIds: string[]; campaignTitle: string | null },
  userId: string,
  client: Pick<ZeffyClient, "getCampaign">,
): Promise<{ ok: true; response: ConnectCampaignResponse } | QueryFailure> {
  const row = await getSessionRow(id);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.personalPurgedAt) return failure(409, "session_purged", "A purged session cannot be edited");

  let title = input.campaignTitle ?? input.campaignId;
  let verified = false;
  try {
    const campaign = await client.getCampaign(input.campaignId);
    if (!campaign) return failure(404, "campaign_not_found", "Zeffy has no campaign with that id", "campaignId");
    title = campaign.title || title;
    if (campaign.rates.length > 0) {
      const known = new Set(campaign.rates.map((r) => r.id));
      if (input.ticketRateIds.some((r) => !known.has(r))) {
        return failure(400, "unknown_rate", "A ticket rate id is not part of that Zeffy form", "ticketRateIds");
      }
    }
    verified = true;
  } catch (e) {
    if (e instanceof ZeffyError) {
      // Zeffy cannot be asked (no key, or the dev allowlist): proceed as typed, unverified.
      if (e.code === "rate_limited") return failure(503, "zeffy_rate_limited", "Zeffy is limiting requests; try again shortly");
      if (e.code === "unavailable" || e.code === "unauthorized" || e.code === "bad_response" || e.code === "bad_request") {
        return failure(502, "zeffy_unavailable", "Zeffy could not be reached");
      }
    } else {
      throw e;
    }
  }

  const [other] = await db
    .select({ id: swSessions.id })
    .from(swSessions)
    .where(and(eq(swSessions.zeffyCampaignId, input.campaignId), ne(swSessions.id, id)))
    .limit(1);
  if (other) return failure(409, "campaign_in_use", "That Zeffy form is already connected to another session", "campaignId");

  try {
    const [updated] = await db
      .update(swSessions)
      .set({
        zeffyCampaignId: input.campaignId,
        zeffyCampaignTitle: title.slice(0, 200),
        zeffyTicketRateIds: input.ticketRateIds,
        updatedAt: new Date(),
      })
      .where(eq(swSessions.id, id))
      .returning();
    await logSessionEvent(id, userId, "campaign_connected", { campaignId: input.campaignId, rates: input.ticketRateIds.length, verified });
    return { ok: true, response: { session: toSessionDto(updated), verified } };
  } catch (e) {
    if (isUniqueViolation(e, "zeffy_campaign")) {
      return failure(409, "campaign_in_use", "That Zeffy form is already connected to another session", "campaignId");
    }
    throw e;
  }
}

function questionList(value: unknown): SnapshotQuestion[] {
  return Array.isArray(value) ? (value.filter((q) => q && typeof q === "object" && "question" in q) as SnapshotQuestion[]) : [];
}

/** Distinct question strings seen in stored raw answers, with counts and the field each maps to. */
export async function listSeenQuestions(id: string): Promise<QuestionsResponse | null> {
  const row = await getSessionRow(id);
  if (!row) return null;

  const stuffyRows = await db.select({ raw: swStuffies.rawAnswers }).from(swStuffies).where(eq(swStuffies.sessionId, id));
  const orderRows = await db.select({ raw: swOrders.buyerAnswers }).from(swOrders).where(eq(swOrders.sessionId, id));

  const fieldOf = new Map<string, string>();
  for (const [field, list] of Object.entries(row.questionMap)) for (const s of list ?? []) fieldOf.set(normalizeQuestionText(s), field);

  const seen = new Map<string, SeenQuestion>();
  const note = (q: SnapshotQuestion) => {
    const text = normalizeQuestionText(q.question);
    if (!text) return;
    const hit = seen.get(text);
    if (hit) hit.count += 1;
    else seen.set(text, { text, example: q.question.slice(0, 300), type: q.type, count: 1, field: fieldOf.get(text) ?? null });
  };
  for (const r of stuffyRows) questionList(r.raw).forEach(note);
  for (const r of orderRows) questionList(r.raw).forEach(note);
  // Mapped strings never seen yet still show, so the admin can remove them.
  for (const [text, field] of fieldOf) {
    if (!seen.has(text)) seen.set(text, { text, example: text, type: "", count: 0, field });
  }

  return {
    questions: [...seen.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
    map: Object.fromEntries(Object.entries(row.questionMap).map(([k, v]) => [k, v ?? []])),
    fields: QUESTION_FIELDS.map((f) => ({ key: f.key, label: f.label, scope: f.scope, required: f.required })),
  };
}

export async function saveQuestionMap(
  id: string,
  map: Record<string, string[]>,
  userId: string,
): Promise<{ ok: true; attentionWouldChange: number } | QueryFailure> {
  const row = await getSessionRow(id);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.personalPurgedAt) return failure(409, "session_purged", "A purged session cannot be edited");

  const attentionWouldChange = await previewRemapAttention(row, map);
  await db.update(swSessions).set({ questionMap: map, updatedAt: new Date() }).where(eq(swSessions.id, id));
  await logSessionEvent(id, userId, "mapping_saved", {
    fields: Object.keys(map).length,
    strings: Object.values(map).reduce((n, l) => n + l.length, 0),
    attentionWouldChange,
  });
  return { ok: true, attentionWouldChange };
}

// ---------------------------------------------------------------------------
// Registrants (read-only)
// ---------------------------------------------------------------------------

export const REGISTRANT_PAGE_SIZE = 50;

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface RegistrantFilters {
  state?: string;
  q?: string;
  flag?: string;
  page?: number;
}

export function toRegistrantDto(
  s: SwStuffy,
  o: SwOrder,
  orderSize: number,
  windows: readonly { id: string; label: string }[],
  questionMap: QuestionMap = {},
): RegistrantDto {
  const order = {
    refundStatus: o.refundStatus,
    refundedCents: o.refundedCents,
    paymentDeleted: o.paymentDeleted,
    refundResolutionCents: o.refundResolutionCents,
  };
  const refund = workerRefundBadge(order) ? "refunded" : partialRefundFlag(order) ? "partial_flag" : "none";
  return {
    id: s.id,
    orderId: s.orderId,
    name: s.name,
    description: s.description,
    snack: s.snack,
    noteToSanta: s.noteToSanta,
    careNote: s.careNote,
    photoConsent: s.photoConsent,
    state: (isStuffyState(s.state) ? s.state : "registered") as StuffyState,
    windowId: o.windowId,
    windowLabel: windows.find((w) => w.id === o.windowId)?.label ?? null,
    orderSize,
    parentFirstName: o.buyerFirstName,
    parentLastName: o.buyerLastName,
    parentEmail: o.buyerEmail,
    parentPhone: o.buyerPhone,
    attentionCodes: s.attentionCodes as AttentionCode[],
    needsAttention: s.needsAttention,
    unmatched: s.needsAttention ? unmatchedAnswers(s.rawAnswers, o.buyerAnswers, questionMap) : [],
    refund,
    refundedCents: o.refundedCents,
    withdrawn: s.withdrawnAt !== null,
    source: o.source as RegistrantDto["source"],
    tagLast4: s.tagCode ? s.tagCode.slice(-4) : null,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function listRegistrants(
  sessionId: string,
  filters: RegistrantFilters,
): Promise<RegistrantsResponse | null> {
  const session = await getSessionRow(sessionId);
  if (!session) return null;

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const conditions = [eq(swStuffies.sessionId, sessionId)];
  if (filters.state && isStuffyState(filters.state)) conditions.push(eq(swStuffies.state, filters.state));
  if (filters.q && filters.q.trim()) {
    const like = `%${escapeLike(filters.q.trim().slice(0, 100))}%`;
    const match = or(
      ilike(swStuffies.name, like),
      ilike(swOrders.buyerFirstName, like),
      ilike(swOrders.buyerLastName, like),
      ilike(swOrders.buyerEmail, like),
    );
    if (match) conditions.push(match);
  }
  if (filters.flag === "attention") conditions.push(eq(swStuffies.needsAttention, true));
  else if (filters.flag === "withdrawn") conditions.push(isNotNull(swStuffies.withdrawnAt));
  else if (filters.flag === "manual") conditions.push(eq(swOrders.source, "manual"));
  else if (filters.flag === "refund") {
    conditions.push(
      sql`((${swOrders.refundStatus} <> 'none' or ${swOrders.paymentDeleted}) and ${swOrders.refundResolutionCents} is distinct from ${swOrders.refundedCents})`,
    );
  }
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(where);

  const rows = await db
    .select({
      stuffy: swStuffies,
      order: swOrders,
      orderSize: sql<number>`(select count(*) from sw_stuffies s2 where s2.order_id = ${swStuffies.orderId})::int`,
    })
    .from(swStuffies)
    .innerJoin(swOrders, eq(swStuffies.orderId, swOrders.id))
    .where(where)
    .orderBy(asc(sql`lower(coalesce(${swOrders.buyerLastName}, ''))`), asc(swStuffies.name), asc(swStuffies.id))
    .limit(REGISTRANT_PAGE_SIZE)
    .offset((page - 1) * REGISTRANT_PAGE_SIZE);

  return {
    registrants: rows.map((r) => toRegistrantDto(r.stuffy, r.order, r.orderSize, session.windows, session.questionMap)),
    total,
    page,
    pageSize: REGISTRANT_PAGE_SIZE,
  };
}

/** campaign id -> the session it is connected to (for the Connect picker). */
export async function campaignConnections(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: swSessions.id, campaignId: swSessions.zeffyCampaignId })
    .from(swSessions)
    .where(isNotNull(swSessions.zeffyCampaignId));
  return new Map(rows.map((r) => [r.campaignId as string, r.id]));
}

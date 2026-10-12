/**
 * CARRIER for the admin API under /api/admin/santas-workshop/** (Phase 3, "API
 * contract"). Client-safe: NO database, server-only or Node imports. The admin
 * UI imports every request/response type and every vocabulary the UI branches
 * on from here, so removing or widening a member breaks `tsc` including every
 * client consumer. Precedent: src/lib/ledger-correction.ts.
 *
 * Error envelope everywhere: `{ error: string, code: AdminErrorCode, field? }`.
 * Consume `code` with an exhaustive switch and a `never` check, not a ternary.
 *
 * Slice 1 ships: sessions (list, create, overview, PATCH), the Zeffy connect /
 * question-map / sync / reprocess / events routes, and the read-only registrant
 * list. Later slices add to this file (status, crew code, photos, frames, purge).
 */

import { ZEFFY_EVENT_OUTCOMES, type ZeffyEventOutcome } from "@/lib/zeffy/event-outcomes";
import { STUFFY_STATES, type StuffyState } from "./state-machine";
import { ATTENTION_CODES, type AttentionCode } from "./payment-mapper";
import { QUESTION_FIELDS, QUESTION_MAP_KEYS, type QuestionFieldKey } from "./question-fields";

export { SESSION_KINDS, SESSION_STATUSES } from "./session-vocabulary";
export type { SessionKind, SessionStatus } from "./session-vocabulary";
export { ZEFFY_EVENT_OUTCOMES, STUFFY_STATES, ATTENTION_CODES, QUESTION_FIELDS, QUESTION_MAP_KEYS };
export type { ZeffyEventOutcome, StuffyState, AttentionCode, QuestionFieldKey };

import type { SessionKind, SessionStatus } from "./session-vocabulary";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ADMIN_ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "invalid_input",
  "immutable_field",
  "not_found",
  "slug_taken",
  "window_in_use",
  "campaign_in_use",
  "campaign_not_found",
  "unknown_rate",
  "duplicate_mapping",
  "not_mapped",
  "session_mismatch",
  "session_purged",
  "event_not_found",
  "payment_unknown",
  "zeffy_not_configured",
  "zeffy_unavailable",
  "zeffy_rate_limited",
  "server_error",
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

export interface AdminErrorBody {
  error: string;
  code: AdminErrorCode;
  /** The offending request field, when one can be named. */
  field?: string;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionWindow {
  /** Immutable once any registrant references it. */
  id: string;
  label: string;
  /** "HH:MM", Eastern wall clock. */
  start: string;
  end: string;
}

export interface SessionDto {
  id: string;
  slug: string;
  name: string;
  kind: SessionKind;
  status: SessionStatus;
  /** Eastern calendar days, "YYYY-MM-DD". */
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  windows: SessionWindow[];
  crewClosesOn: string;
  zeffy: {
    campaignId: string | null;
    campaignTitle: string | null;
    ticketRateIds: string[];
    /** Count of question strings mapped, per field key (the map itself is read via /zeffy/questions). */
    mappedStringCounts: Record<string, number>;
  };
  storageQuotaBytes: number;
  frameArtKey: string;
  frameFilePrefix: string;
  framePartSize: number;
  purgePersonalOn: string;
  purgePublicOn: string;
  personalPurgedAt: string | null;
  publicPurgedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the sessions list shows per row (cheap aggregates). */
export interface SessionListItem extends SessionDto {
  stuffyCount: number;
  needsAttentionCount: number;
  lastZeffyEventAt: string | null;
}

export interface StorageStatus {
  /** False until the photo store lands (Slice 2). */
  configured: boolean;
  lastTest: { at: string; ok: boolean; latencyMs: number | null } | null;
  /** A short cause shown in the red banner, or null. */
  bannerCause: string | null;
}

export interface SessionListResponse {
  sessions: SessionListItem[];
  storage: StorageStatus;
}

export type ChecklistState = "done" | "todo" | "warn" | "info";

export interface ChecklistItem {
  key:
    | "campaign_connected"
    | "ticket_rates"
    | "fields_mapped"
    | "zeffy_configured"
    | "last_event"
    | "storage_tested"
    | "worker_code"
    | "friday_sync";
  label: string;
  state: ChecklistState;
  detail?: string;
}

export interface WindowCount {
  /** null = registrants whose drop-off window matched none of the session's windows. */
  windowId: string | null;
  label: string;
  count: number;
}

export interface SessionOverview extends SessionDto {
  counts: {
    orders: number;
    stuffies: number;
    withdrawn: number;
    byState: Record<StuffyState, number>;
    byWindow: WindowCount[];
  };
  needsAttention: number;
  /** Orders with an open refund flag (full, partial or removed), not yet resolved. */
  refundsOpen: number;
  lastZeffyEventAt: string | null;
  lastCampaignEventAt: string | null;
  lastSyncAt: string | null;
  /** Booleans only; the values never leave the server. */
  zeffyConfig: { webhookSecretSet: boolean; apiKeySet: boolean };
  checklist: ChecklistItem[];
}

export interface CreateSessionRequest {
  name: string;
  slug: string;
  kind: SessionKind;
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  windows: SessionWindow[];
}

/** PATCH body. `kind` and `slug` are immutable and rejected (`immutable_field`). */
export interface UpdateSessionRequest {
  name?: string;
  dropoffDate?: string;
  photoDate?: string;
  pickupDate?: string;
  windows?: SessionWindow[];
  crewClosesOn?: string;
  purgePersonalOn?: string;
  purgePublicOn?: string;
  storageQuotaBytes?: number;
  frameArtKey?: string;
  frameFilePrefix?: string;
  framePartSize?: number;
}

export interface SessionResponse {
  session: SessionDto;
}

// ---------------------------------------------------------------------------
// Zeffy: connect, questions, sync, reprocess, events
// ---------------------------------------------------------------------------

export interface ZeffyCampaignDto {
  id: string;
  title: string;
  type: string | null;
  status: string | null;
  startsAt: string | null;
  endsAt: string | null;
  rates: { id: string; title: string; amountCents: number | null }[];
  /** The session this campaign is already connected to, if any. */
  connectedSessionId: string | null;
}

export interface ZeffyCampaignsResponse {
  campaigns: ZeffyCampaignDto[];
}

export interface ConnectCampaignRequest {
  campaignId: string;
  ticketRateIds: string[];
  /** Used only when Zeffy cannot be consulted (no API key, or dev allowlist). */
  campaignTitle?: string;
}

export interface ConnectCampaignResponse {
  session: SessionDto;
  /** False when Zeffy could not be asked (title and rate ids are as typed). */
  verified: boolean;
}

export interface SeenQuestion {
  /** Normalized text: the map key. */
  text: string;
  /** One raw spelling as received (length-capped), for display. */
  example: string;
  type: string;
  /** Registrants (stuffies) and orders in which the string was seen. */
  count: number;
  /** The field it currently maps to, or null. */
  field: string | null;
}

export interface QuestionsResponse {
  questions: SeenQuestion[];
  /** Current map: field key -> normalized strings. */
  map: Record<string, string[]>;
  fields: { key: QuestionFieldKey; label: string; scope: "ticket" | "buyer"; required: boolean }[];
}

export interface SaveQuestionMapRequest {
  map: Record<string, string[]>;
}

export interface SaveQuestionMapResponse {
  saved: true;
  /** Registrants whose needs-attention reasons change with the new map. */
  attentionWouldChange: number;
}

export interface RemapRequest {
  /** Last stuffy id of the previous batch. */
  cursor?: string | null;
}

export interface RemapResponse {
  cursor: string | null;
  done: boolean;
  processed: number;
  changed: number;
}

export interface SyncCounts {
  /** In Zeffy but not here: by definition a missed webhook. */
  newFromZeffy: number;
  changed: number;
  unchanged: number;
  /** Here, but Zeffy says the payment is gone. */
  goneInZeffy: number;
  refundDiffers: number;
  /** Payments Zeffy listed that produced no registrants (donations, other rates). */
  skipped: number;
}

export interface SyncCursor {
  /** ISO instant the whole run began; the stale phase compares snapshot_at to it. */
  startedAt: string;
  phase: "list" | "stale";
  /** Zeffy list cursor (phase "list"). */
  startingAfter: string | null;
  /** Last order id handled (phase "stale"). */
  staleAfterId: string | null;
  counts: SyncCounts;
  processed: number;
}

export interface SyncRequest {
  cursor?: SyncCursor | null;
}

export interface SyncResponse {
  cursor: SyncCursor | null;
  progress: { phase: SyncCursor["phase"]; processed: number; counts: SyncCounts };
  done: boolean;
  /** "Zeffy is limiting requests, continuing..." is a normal message, not an error. */
  retryAfterMs?: number;
}

export interface ReprocessResult {
  outcome: ZeffyEventOutcome;
  code: string | null;
}

export interface ZeffyEventDto {
  id: string;
  type: string | null;
  paymentId: string | null;
  outcome: ZeffyEventOutcome | string;
  errorCode: string | null;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  /** Whether a stored snapshot exists. The payload itself is never returned. */
  hasPayload: boolean;
}

export interface ZeffyEventsResponse {
  events: ZeffyEventDto[];
  /** Any campaign: proof the webhook is alive. */
  lastValidEventAt: string | null;
  lastCampaignEventAt: string | null;
}

// ---------------------------------------------------------------------------
// Registrants (read-only in Slice 1)
// ---------------------------------------------------------------------------

export const REGISTRANT_FLAGS = ["attention", "refund", "withdrawn", "manual"] as const;
export type RegistrantFlag = (typeof REGISTRANT_FLAGS)[number];

export type RefundBadge = "none" | "refunded" | "partial_flag";

export interface RegistrantDto {
  id: string;
  orderId: string;
  /** Raw name; the UI shows "Unnamed stuffy, order of N" when null. */
  name: string | null;
  description: string | null;
  snack: string | null;
  noteToSanta: string | null;
  careNote: string | null;
  photoConsent: boolean;
  state: StuffyState;
  windowId: string | null;
  windowLabel: string | null;
  orderSize: number;
  parentFirstName: string | null;
  parentLastName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  attentionCodes: AttentionCode[];
  needsAttention: boolean;
  /**
   * Raw question and answer text the question map does not cover; filled only for
   * needs-attention rows (empty otherwise). Untrusted buyer text: render as text.
   */
  unmatched: { question: string; answer: string }[];
  refund: RefundBadge;
  refundedCents: number;
  withdrawn: boolean;
  /** Where the order came from. */
  source: "webhook" | "sync" | "manual";
  /** Last four characters of the bound sticker code, or null. */
  tagLast4: string | null;
  createdAt: string;
}

export interface RegistrantsResponse {
  registrants: RegistrantDto[];
  total: number;
  page: number;
  pageSize: number;
}

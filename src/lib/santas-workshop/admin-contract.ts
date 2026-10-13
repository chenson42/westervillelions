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
  "invalid_transition",
  "storage_not_ready",
  "devices_active",
  "has_activity",
  "stale_state",
  "withdraw_not_allowed",
  "storage_unavailable",
  "storage_misconfigured",
  "storage_full",
  "storage_rate_limited",
  "photos_unreviewed",
  "collage_url_not_production",
  "server_error",
] as const;
export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[number];

export interface AdminErrorBody {
  error: string;
  code: AdminErrorCode;
  /** The offending request field, when one can be named. */
  field?: string;
  /** devices_active: how many devices used the worker code in the last hour. */
  count?: number;
  /** stale_state: where the stuffy actually is now. */
  currentState?: StuffyState;
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
  /** False when the configured store cannot be built (production without Drive credentials, or SW_PHOTO_STORE=drive without them). */
  configured: boolean;
  /** Which adapter this process uses; "local" and "memory" are development and test only. */
  mode: "drive" | "local" | "memory";
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
  /** Booleans and a version only; the code itself is read through GET crew-code. */
  zeffyConfig: { webhookSecretSet: boolean; apiKeySet: boolean };
  workerAccess: { issued: boolean; paused: boolean; version: number };
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

// ---------------------------------------------------------------------------
// Slice 2: status, worker code, registrant actions, storage
// ---------------------------------------------------------------------------

export { SETTABLE_STATUSES } from "./session-status";
export type { SettableStatus } from "./session-status";
import type { SettableStatus } from "./session-status";

/** POST sessions/[id]/status. Paused is not a status: use the crew-code pause action. */
export interface SetStatusRequest {
  to: SettableStatus;
}
export interface SetStatusResponse {
  session: SessionDto;
  /** True when the session was already in that status. */
  noop: boolean;
}

export const CREW_CODE_ACTIONS = ["rotate", "pause", "resume"] as const;
export type CrewCodeAction = (typeof CREW_CODE_ACTIONS)[number];

/** GET sessions/[id]/crew-code (no-store; logs code_viewed, never the code). */
export interface CrewCodeResponse {
  /** The plain code, or null when none was issued yet or it cannot be read (AUTH_SECRET changed): rotate to issue a new one. */
  code: string | null;
  /** "ABCD-EFGH" for the text message; null when code is null. */
  formatted: string | null;
  unreadable: boolean;
  version: number;
  paused: boolean;
  /** Distinct devices that used the current code in the last hour. */
  activeDevicesLastHour: number;
}
export interface CrewCodeActionRequest {
  action: CrewCodeAction;
  /** Rotate asks twice when devices are active: repeat with acknowledge: true. */
  acknowledge?: boolean;
}

/** POST sessions/[id]/stuffies (manual add). Fields mirror manual-add.ts. */
export interface ManualAddRequest {
  parentFirstName: string;
  parentLastName: string;
  stuffyName: string;
  windowId: string;
  reason: string;
  idempotencyKey: string;
  description?: string;
  snack?: string;
  noteToSanta?: string;
  careNote?: string;
  parentEmail?: string;
  parentPhone?: string;
  photoConsent?: boolean;
}
export interface RegistrantResponse {
  registrant: RegistrantDto;
}

export interface AdminRevertRequest {
  toState: StuffyState;
  expectedState: StuffyState;
  /** Required: kept in the history. */
  reason: string;
}
export interface AdminWithdrawRequest {
  reason: string;
}

/** POST orders/[orderId]/refund-resolution. keep: stores the refunded amount seen. withdraw: withdraws every stuffy still in registered/tagged. */
export interface RefundResolutionRequest {
  resolution: "keep" | "withdraw";
}
export interface RefundResolutionResponse {
  orderId: string;
  /** Stuffies withdrawn by this call (withdraw only). */
  withdrawn: number;
  /** Stuffies already in custody, which can only stay flagged. */
  stillInCustody: number;
  /** False when some stuffies remain in custody: the refund flag stays open for them. */
  resolved: boolean;
}

export interface StorageTestRequest {
  /** The session page that asked; the result is logged against it (a global test with none is logged on the newest session). */
  sessionId?: string;
}
export interface StorageTestResponse {
  ok: true;
  latencyMs: number;
  mode: StorageStatus["mode"];
}

export type StorageCheckAction = "delete_orphans";
export interface StorageCheckRequest {
  action?: StorageCheckAction;
}
export interface StorageCheckResponse {
  /** Files in the store with no matching photo row, older than 10 minutes (younger ones may be in flight). */
  orphanFiles: { photoId: string; variant: "full" | "thumb"; size: number }[];
  orphanCount: number;
  /** Photo rows whose file is not in the store. */
  missingFiles: { photoId: string; kind: string }[];
  missingCount: number;
  deleted: number;
  /** False when the listing was cut at the page cap: run again after deleting. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Photos, hide, review and publish (Slice 3)
// ---------------------------------------------------------------------------

export const PHOTO_LIST_KINDS = ["group", "portrait"] as const;
export type PhotoListKind = (typeof PHOTO_LIST_KINDS)[number];

export const PUBLISH_ACTIONS = ["publish", "unpublish"] as const;
export type PublishAction = (typeof PUBLISH_ACTIONS)[number];

export const PHOTOS_PAGE_SIZE = 60;

/** The collage's address for the admin. The URL carries the token: never log it. */
export interface CollageAdminInfo {
  /** Absolute collage URL, built on the server from the one app-URL helper. */
  url: string;
  /** Exactly the text a QR code must encode (the frame slice reuses it). */
  qrPayload: string;
  published: boolean;
  publishedAt: string | null;
  /** Display only (the database's own timestamp text): group photos uploaded at or before this have been reviewed. Null = never reviewed. Never compare it; use `AdminPhotoDto.reviewed` and `counts.groupUnreviewed`. */
  reviewedThrough: string | null;
}

export interface AdminPhotoDto {
  id: string;
  kind: PhotoListKind;
  takenAt: string | null;
  createdAt: string;
  hidden: boolean;
  /** Set by the publish batch (group photos and consented portraits); null until then. */
  publishedAt: string | null;
  /** Group photos: reviewed (published, or uploaded before the last review). Portraits: null. */
  reviewed: boolean | null;
  /** Portraits: the stuffy's collage opt-in. Group photos: null. */
  consent: boolean | null;
  /** Portraits only (admin-only surface). */
  stuffyName: string | null;
  /** Would a stranger holding the collage link see this photo right now? */
  onCollage: boolean;
  /** Unhidden, not yet published, and would be on the collage once published (a group photo, or a consented portrait): "Publish late photos" will release it. */
  awaitingPublish: boolean;
}

export interface PhotoCounts {
  groupTotal: number;
  groupHidden: number;
  /** Unhidden group photos not yet published and not covered by a review. Publish is refused while > 0. */
  groupUnreviewed: number;
  groupPublished: number;
  portraitsCurrent: number;
  portraitsHidden: number;
  /** Unhidden current portraits whose stuffy opted in. */
  portraitsOnCollage: number;
  portraitsNotConsented: number;
  /** Unhidden, unpublished group photos plus unhidden, unpublished consented portraits: what "Publish late photos" would release (group photos also need a review). */
  awaitingPublish: number;
  /** The portrait part of `awaitingPublish`: retakes and new portraits after the last publish. */
  portraitsAwaitingPublish: number;
  /** Display only (millisecond precision). */
  newestGroupAt: string | null;
  /** The newest group photo: send it back as `throughPhotoId` when the review is done. Null = no group photos. */
  newestGroupPhotoId: string | null;
}

export interface PhotosListResponse {
  photos: AdminPhotoDto[];
  page: number;
  hasMore: boolean;
  counts: PhotoCounts;
  collage: CollageAdminInfo;
  sessionKind: SessionKind;
}

export interface HidePhotoRequest {
  hidden: boolean;
}
export interface HidePhotoResponse {
  photo: Pick<AdminPhotoDto, "id" | "kind" | "hidden">;
  noop: boolean;
  /** True after an UNHIDE of a photo that has never been published (and would be on the collage): it stays private until the next publish. */
  needsPublish: boolean;
}

export interface ReviewPhotosRequest {
  /** The `counts.newestGroupPhotoId` the admin was looking at. Photos uploaded after it stay unreviewed. */
  throughPhotoId: string;
}
export interface ReviewPhotosResponse {
  counts: PhotoCounts;
  collage: CollageAdminInfo;
}

export interface PublishRequest {
  action: PublishAction;
}
export interface PublishResponse {
  collage: CollageAdminInfo;
  counts: PhotoCounts;
  /** publish: group photos newly made public by this call. */
  newlyPublished: number;
  noop: boolean;
}

// ---------------------------------------------------------------------------
// Frames (Slice 4): export manifest and "mark exported"
// ---------------------------------------------------------------------------

/** Frame size the browser composites at (portrait 4x6, spec section 7). */
export const FRAME_WIDTH_PX = 1200;
export const FRAME_HEIGHT_PX = 1800;
/** The most items one "mark exported" call may carry. */
export const FRAME_EXPORTED_MAX_ITEMS = 500;

/**
 * Where a stuffy's printed frame stands against its CURRENT portrait:
 * never exported, exported from the portrait that is current now, or exported
 * from a portrait that has since been retaken ("changed").
 */
export const FRAME_EXPORT_STATUSES = ["never", "current", "changed"] as const;
export type FrameExportStatus = (typeof FRAME_EXPORT_STATUSES)[number];

/** Why a stuffy has no frame in this run (listed, never given a placeholder). */
export const FRAME_WITHHELD_REASONS = ["no_portrait", "hidden"] as const;
export type FrameWithheldReason = (typeof FRAME_WITHHELD_REASONS)[number];

/** Row data shared by the frames and the index CSV. Names only: no email, phone or notes. */
export interface FrameEntryBase {
  stuffyId: string;
  /** The stuffy's name as it should print (control and bidi characters removed, whitespace collapsed, capped). */
  name: string;
  parentFirst: string;
  parentLast: string;
  /** The drop-off window label, "" when unknown. */
  windowLabel: string;
  /** Photo-sharing consent. Irrelevant to frames (every family gets one); an index column only. */
  consent: boolean;
  /** Persisted; null until the stuffy has an exportable portrait. */
  frameNumber: number | null;
  /** `ssw-<slug>-NNN.jpg`, null while frameNumber is null. */
  fileName: string | null;
}

/** A stuffy that gets a frame in this run. */
export interface FrameItem extends FrameEntryBase {
  frameNumber: number;
  fileName: string;
  portraitPhotoId: string;
  /** Same-origin photo door path (`?v=full`); the admin's browser fetches it with its own session. */
  photoUrl: string;
  /** The portrait the last export used (`frame_exported_photo_id`), null when never exported. */
  exportedPhotoId: string | null;
  exportStatus: FrameExportStatus;
}

/** A stuffy with no frame in this run, with the reason (the index CSV prints `no: <reason>`). */
export interface FrameWithheld extends FrameEntryBase {
  reason: FrameWithheldReason;
}

export interface FrameManifestCounts {
  /** Every non-withdrawn stuffy. */
  total: number;
  /** Exportable portraits (items). */
  withPortrait: number;
  withoutPortrait: number;
  /** Current portrait hidden by an admin: withheld from the zip. */
  hidden: number;
  neverExported: number;
  changedSinceExport: number;
  /** neverExported + changedSinceExport: portraits whose frame is not in the last export. */
  sinceLastExport: number;
}

export interface FrameManifest {
  sessionId: string;
  kind: SessionKind;
  slug: string;
  /** The exact string to encode in the frame QR (equals `collageAdminInfo.qrPayload`). */
  qrPayload: string;
  collageUrl: string;
  frameArtKey: string;
  /** Prefix for file names and zip parts, already sanitised. */
  filePrefix: string;
  partSize: number;
  /** Wall time of the last "mark exported" call, ISO; null if none. Display only. */
  lastExportAt: string | null;
  items: FrameItem[];
  /** Hidden and portrait-less stuffies, for the index CSV and the "6 without" list. */
  withheld: FrameWithheld[];
  counts: FrameManifestCounts;
}

export interface FramesExportedItem {
  stuffyId: string;
  /** The portrait the browser actually composited. */
  photoId: string;
  frameNumber: number;
}

export interface FramesExportedRequest {
  items: FramesExportedItem[];
  /** True when more parts are still to come (audit only). */
  partial?: boolean;
}

export interface FramesExportedResponse {
  /** Rows whose marker changed. */
  marked: number;
  /** Rows already carrying that photo id (a repeated call). */
  unchanged: number;
  /** Items that did not match a stuffy, its frame number and a portrait of this session. */
  rejected: string[];
}

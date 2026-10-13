/**
 * Pure, client-safe logic behind the Santa's Workshop admin pages: copy for the
 * contract's vocabularies, the Sync and Remap loops, the question-map editing
 * rules and the registrants filter URL. No React, no db, no fetch of its own
 * (the loops take their network call as a parameter), so it is unit-tested in
 * node. Types and vocabularies come from admin-contract.ts, never redefined.
 */

import {
  ADMIN_ERROR_CODES,
  REGISTRANT_FLAGS,
  STUFFY_STATES,
  type AdminErrorBody,
  type AdminErrorCode,
  type AttentionCode,
  type ChecklistState,
  type RefundBadge,
  type RemapResponse,
  type SessionKind,
  type SessionStatus,
  type StuffyState,
  type SyncCounts,
  type SyncCursor,
  type SyncResponse,
  type ZeffyEventOutcome,
} from "./admin-contract";
import { IGNORED_QUESTION_KEY, normalizeQuestionText } from "./question-fields";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Human microcopy for every error code. Exhaustive: a new code breaks `tsc` here. */
export function adminErrorMessage(code: AdminErrorCode, serverMessage?: string): string {
  switch (code) {
    case "unauthorized":
      return "Your sign-in has expired. Sign in again and retry.";
    case "forbidden":
      return "You do not have permission to do that.";
    case "invalid_input":
      return serverMessage || "Something in the form needs a second look.";
    case "immutable_field":
      return "That setting cannot be changed once a session exists.";
    case "not_found":
      return "That session could not be found. It may have been removed.";
    case "slug_taken":
      return "That short name is already used by another session. Pick a different one.";
    case "window_in_use":
      return "Registrants chose this window; change its label instead of removing it.";
    case "campaign_in_use":
      return "That Zeffy form is already connected to another session.";
    case "campaign_not_found":
      return "Zeffy has no form with that id. Check the id and try again.";
    case "unknown_rate":
      return "One of the ticket rates is not on that Zeffy form.";
    case "duplicate_mapping":
      return "The same question cannot be assigned to two fields.";
    case "not_mapped":
      return "Connect a Zeffy form to this session first.";
    case "session_mismatch":
      return "That payment belongs to a different session.";
    case "session_purged":
      return "This session's data has been removed, so it can no longer be changed.";
    case "event_not_found":
      return "That Zeffy event is no longer in the log.";
    case "payment_unknown":
      return "Zeffy has no record of that payment.";
    case "zeffy_not_configured":
      return "The Zeffy API key is not set on this server, so Zeffy cannot be asked.";
    case "zeffy_unavailable":
      return "Zeffy could not be reached. Try again in a minute.";
    case "zeffy_rate_limited":
      return "Zeffy is limiting requests. Wait a moment and try again.";
    case "invalid_transition":
      return "The session cannot move to that status from where it is.";
    case "storage_not_ready":
      return "Run Test storage first: a real session needs a passing photo storage test in the last 10 minutes.";
    case "devices_active":
      return "Phones are using the current worker code right now. Rotating signs them all out.";
    case "has_activity":
      return "Stuffies have already been tagged or photographed, so the session cannot go back to draft.";
    case "stale_state":
      return "That stuffy changed while you were looking. Refresh and check it.";
    case "withdraw_not_allowed":
      return "A stuffy that is already checked in cannot be withdrawn; it can only be flagged.";
    case "storage_unavailable":
      return "Photo storage is not answering. Try again in a minute.";
    case "storage_misconfigured":
      return "Photo storage is not set up correctly on this server.";
    case "storage_full":
      return "Photo storage is full.";
    case "storage_rate_limited":
      return "Photo storage is limiting requests. Wait a moment and try again.";
    case "photos_unreviewed":
      return "Some group photos have not been reviewed yet. Look through them (hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies), mark them reviewed, then publish.";
    case "server_error":
      return "Something went wrong on our side. Try again, and tell the webmaster if it keeps happening.";
    default: {
      const never: never = code;
      return String(never);
    }
  }
}

export interface AdminFailure {
  code: AdminErrorCode;
  message: string;
  field?: string;
  /** devices_active: phones that used the worker code in the last hour. */
  count?: number;
  /** stale_state: where the stuffy actually is now. */
  currentState?: StuffyState;
}

export function isAdminErrorBody(v: unknown): v is AdminErrorBody {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as AdminErrorBody).code === "string" &&
    (ADMIN_CODES as readonly string[]).includes((v as AdminErrorBody).code)
  );
}

const ADMIN_CODES: readonly string[] = ADMIN_ERROR_CODES;

/** Turns a non-2xx response body (or a network failure, body = null) into one failure shape. */
export function toAdminFailure(body: unknown): AdminFailure {
  if (isAdminErrorBody(body)) {
    return {
      code: body.code,
      message: adminErrorMessage(body.code, body.error),
      ...(body.field ? { field: body.field } : {}),
      ...(typeof body.count === "number" ? { count: body.count } : {}),
      ...(body.currentState ? { currentState: body.currentState } : {}),
    };
  }
  return { code: "server_error", message: adminErrorMessage("server_error") };
}

export type CallResult<T> = { ok: true; data: T } | { ok: false; failure: AdminFailure };

/** fetch + JSON with the failure normalized; never throws. */
export async function callAdmin<T>(url: string, init?: RequestInit): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    return { ok: false, failure: toAdminFailure(body) };
  } catch {
    return { ok: false, failure: { code: "server_error", message: "The request did not go through. Check your connection and try again." } };
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const STATE_LABELS: Record<StuffyState, string> = {
  registered: "Registered",
  tagged: "Tagged",
  checked_in: "Checked in",
  portrait_taken: "Portrait taken",
  picked_up: "Picked up",
};

export const STATUS_LABELS: Record<SessionStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  purged: "Purged",
};

export const KIND_LABELS: Record<SessionKind, string> = {
  practice: "Practice",
  real: "Real",
};

export const ATTENTION_LABELS: Record<AttentionCode, string> = {
  unmapped_question: "A question is not mapped",
  missing_name: "No stuffy name",
  missing_snack: "No snack choice",
  unmapped_window: "Drop-off window answer matches none of this session's windows (labels must match the form). Fix the label under Edit session, then run Remap.",
  not_in_order_now: "No longer in the Zeffy order",
  truncated: "Long answer was shortened",
};

export const OUTCOME_LABELS: Record<ZeffyEventOutcome, string> = {
  received: "Received, not finished",
  processed: "Processed",
  ignored_unmapped: "Ignored (another form)",
  ignored_type: "Ignored (not a payment)",
  invalid: "Invalid",
  unsupported_version: "Unsupported version",
  failed: "Failed, will retry",
};

/** Events an admin can usefully Reprocess. */
export function canReprocessOutcome(outcome: string): boolean {
  return outcome === "failed" || outcome === "received" || outcome === "processed" || outcome === "invalid";
}

export function outcomeLabel(outcome: string): string {
  return (OUTCOME_LABELS as Record<string, string>)[outcome] ?? outcome;
}

export function attentionLabel(code: string): string {
  return (ATTENTION_LABELS as Record<string, string>)[code] ?? code;
}

export function refundBadge(refund: RefundBadge, refundedCents: number): { label: string; tone: "red" | "amber" } | null {
  const dollars = `$${(refundedCents / 100).toFixed(2)}`;
  if (refund === "refunded") return { label: "Refunded", tone: "red" };
  if (refund === "partial_flag") return { label: `Partly refunded (${dollars})`, tone: "amber" };
  return null;
}

export const CHECKLIST_MARK: Record<ChecklistState, { symbol: string; srText: string; tone: string }> = {
  done: { symbol: "✓", srText: "Done", tone: "bg-green-100 text-green-800" },
  todo: { symbol: "!", srText: "To do", tone: "bg-red-100 text-red-800" },
  warn: { symbol: "!", srText: "Needs a look", tone: "bg-amber-100 text-amber-800" },
  info: { symbol: "•", srText: "Not needed yet", tone: "bg-gray-100 text-gray-600" },
};

export function formatMoney(cents: number | null): string {
  return cents === null ? "price not set" : `$${(cents / 100).toFixed(2)}`;
}

/** "5 minutes ago" style text for the dashboards; null means never. */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} days ago`;
}

// ---------------------------------------------------------------------------
// Sync and Remap
// ---------------------------------------------------------------------------

export const MAX_LOOP_STEPS = 500;

export type SyncProgress = {
  phase: SyncCursor["phase"];
  processed: number;
  counts: SyncCounts;
  /** True while waiting out a Zeffy rate limit (a normal pause, not an error). */
  waiting: boolean;
};

export type SyncOutcome =
  | { status: "done"; counts: SyncCounts; processed: number }
  | { status: "error"; failure: AdminFailure; counts: SyncCounts | null }
  | { status: "stopped"; counts: SyncCounts | null };

export interface SyncLoopDeps {
  /** One POST of the cursor (null to begin). */
  post: (cursor: SyncCursor | null) => Promise<CallResult<SyncResponse>>;
  sleep: (ms: number) => Promise<void>;
  onProgress: (p: SyncProgress) => void;
  shouldStop?: () => boolean;
}

/** Posts the cursor back until `done`. A rate limit (`retryAfterMs`) waits and continues. */
export async function runSyncLoop(deps: SyncLoopDeps): Promise<SyncOutcome> {
  let cursor: SyncCursor | null = null;
  let last: SyncProgress["counts"] | null = null;
  for (let step = 0; step < MAX_LOOP_STEPS; step += 1) {
    if (deps.shouldStop?.()) return { status: "stopped", counts: last };
    const res = await deps.post(cursor);
    if (!res.ok) {
      // A rate limit raised as an error is also a pause, not a failure.
      return { status: "error", failure: res.failure, counts: last };
    }
    const { progress, done, retryAfterMs } = res.data;
    last = progress.counts;
    cursor = res.data.cursor;
    if (done) {
      deps.onProgress({ phase: progress.phase, processed: progress.processed, counts: progress.counts, waiting: false });
      return { status: "done", counts: progress.counts, processed: progress.processed };
    }
    const wait = typeof retryAfterMs === "number" && retryAfterMs > 0;
    deps.onProgress({ phase: progress.phase, processed: progress.processed, counts: progress.counts, waiting: wait });
    if (wait) await deps.sleep(Math.min(retryAfterMs as number, 30_000));
  }
  return { status: "error", failure: { code: "server_error", message: "Sync is taking unusually long. Stop here and try again." }, counts: last };
}

export function syncProgressText(p: SyncProgress): string {
  if (p.waiting) return "Zeffy is limiting requests, continuing...";
  const where = p.phase === "list" ? "Reading payments from Zeffy" : "Checking existing registrations against Zeffy";
  return `${where}... ${p.processed} so far`;
}

/**
 * The outcome paragraph after Sync, in the contract's own count words. Skipped
 * payments (a ticket rate not marked as the stuffy ticket, donations) are always
 * named, and the all-clear sentence is never shown while any were skipped.
 */
export function syncSummary(c: SyncCounts): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.newFromZeffy > 0) {
    parts.push(
      `${plural(c.newFromZeffy, "registration", "registrations")} found that the live feed had missed, now added`,
    );
  }
  if (c.changed > 0) parts.push(`${c.changed} updated`);
  if (c.goneInZeffy > 0) parts.push(`${c.goneInZeffy} no longer in Zeffy (flagged for review)`);
  if (c.refundDiffers > 0) parts.push(`${c.refundDiffers} with a refund that differed (flagged for review)`);

  const orders = c.newFromZeffy + c.changed + c.unchanged;
  let text: string;
  if (parts.length > 0) text = `${parts.join("; ")}. ${c.unchanged} already up to date.`;
  else if (c.skipped === 0) text = `Everything matches Zeffy. ${c.unchanged} already up to date.`;
  else text = `Synced ${plural(orders, "order", "orders")}; nothing needed changing.`;

  if (c.skipped > 0) {
    text += ` ${plural(c.skipped, "payment", "payments")} skipped because ${c.skipped === 1 ? "its" : "their"} ticket rate is not marked as the stuffy ticket. Review under Connect.`;
  }
  return text;
}

/** What the Connect panel says after a successful connect. Payments made before connecting are only recovered by Sync. */
export function connectSuccessNote(verified: boolean, apiKeySet: boolean): { text: string; offerSync: boolean } {
  const head = verified
    ? "Connected. Zeffy confirmed the form and its ticket rates."
    : "Saved, but Zeffy could not be asked to confirm the form, so the title and rate ids are exactly as you typed them.";
  return apiKeySet
    ? { text: `${head} Run Sync now: payments made before connecting are only picked up by Sync.`, offerSync: true }
    : { text: `${head} Payments made before connecting are only picked up by Sync, which needs the Zeffy API key. Set it, then run Sync.`, offerSync: false };
}

/**
 * A sentence for every code a Zeffy event can carry in `errorCode`. The codes are
 * strings in the contract (not an enum), so zeffy-event-codes.test.ts scans the
 * server sources and fails when one has no sentence here.
 */
export const EVENT_CODE_SENTENCES: Record<string, string> = {
  applied: "Registrations were added or updated.",
  stale_snapshot: "A newer copy of this payment was already applied, so this older one was skipped.",
  not_succeeded: "The payment had not succeeded, so no registrations were made.",
  no_registrants: "The payment had no stuffy tickets, so no registrations were made. Check the ticket rate is marked on Connect.",
  purged_session: "This session's data has been removed, so the payment was not applied.",
  session_mismatch: "This payment belongs to a different session.",
  session_not_found: "The session for this payment could not be found.",
  no_api_key: "Zeffy could not be asked for this payment because the API key is not set. Set it and press Reprocess.",
  out_of_scope: "This payment is on a Zeffy form this server is not allowed to read.",
  unknown_payment: "The club has no registrations for this payment, so there was nothing to update.",
  payment_deleted: "Zeffy removed this payment; its registrations are flagged for review.",
  db_error: "The registration could not be saved because of a database problem. Press Reprocess to try again.",
  bad_payment: "Zeffy sent a payment this site could not read.",
  bad_payload: "The stored copy of this event could not be read.",
  campaign_mismatch: "The payment is for a different Zeffy form than this session's.",
  unmapped_campaign: "The payment is on a Zeffy form no session is connected to.",
  type_not_handled: "This kind of Zeffy notice is not used by the club.",
  no_campaign: "The payment named no Zeffy form.",
  no_payment_id: "The event named no payment, so it could not be looked up.",
  consumer_error: "Something went wrong while handling this event. Press Reprocess to try again.",
  no_consumer: "Nothing here handles this kind of Zeffy notice.",
  unsupported_version: "Zeffy sent a newer notice format than this site understands.",
  zeffy_rate_limited: "Zeffy was limiting requests when this payment was fetched. Press Reprocess in a minute.",
  zeffy_unauthorized: "Zeffy refused the API key. Check the key, then press Reprocess.",
  zeffy_unavailable: "Zeffy could not be reached for this payment. Press Reprocess in a minute.",
  zeffy_error: "Zeffy returned an error for this payment. Press Reprocess to try again.",
};

/** The sentence for an event's error code; an unrecognized code still gets a plain fallback. */
export function eventCodeSentence(code: string): string {
  return EVENT_CODE_SENTENCES[code] ?? "Something unexpected happened with this event. Give the code below to the webmaster.";
}

export type RemapOutcome =
  | { status: "done"; processed: number; changed: number }
  | { status: "error"; failure: AdminFailure; processed: number; changed: number };

export interface RemapLoopDeps {
  post: (cursor: string | null) => Promise<CallResult<RemapResponse>>;
  onProgress?: (processed: number, changed: number) => void;
}

export async function runRemapLoop(deps: RemapLoopDeps): Promise<RemapOutcome> {
  let cursor: string | null = null;
  let processed = 0;
  let changed = 0;
  for (let step = 0; step < MAX_LOOP_STEPS; step += 1) {
    const res = await deps.post(cursor);
    if (!res.ok) return { status: "error", failure: res.failure, processed, changed };
    processed += res.data.processed;
    changed += res.data.changed;
    deps.onProgress?.(processed, changed);
    if (res.data.done) return { status: "done", processed, changed };
    cursor = res.data.cursor;
  }
  return { status: "error", failure: { code: "server_error", message: "Remap is taking unusually long. Stop here and try again." }, processed, changed };
}

export function remapSummary(processed: number, changed: number): string {
  if (processed === 0) return "There are no registrants to re-read yet.";
  return `Re-read ${processed} registrant${processed === 1 ? "" : "s"}; ${changed} changed.`;
}

// ---------------------------------------------------------------------------
// Question map editing
// ---------------------------------------------------------------------------

export type QuestionMapState = Record<string, string[]>;

/** The field a normalized question text is currently assigned to, or null. */
export function fieldOfQuestion(map: QuestionMapState, text: string): string | null {
  const n = normalizeQuestionText(text);
  for (const [field, list] of Object.entries(map)) if (list.some((s) => normalizeQuestionText(s) === n)) return field;
  return null;
}

/**
 * Assign (or, with null, unassign) a question to a field. A text belongs to one
 * field only (the server answers `duplicate_mapping` otherwise), so it is
 * removed from wherever it was first. Pure: returns a new map, drops empty lists.
 */
export function assignQuestion(map: QuestionMapState, text: string, field: string | null): QuestionMapState {
  const n = normalizeQuestionText(text);
  const next: QuestionMapState = {};
  for (const [key, list] of Object.entries(map)) {
    const kept = list.filter((s) => normalizeQuestionText(s) !== n);
    if (kept.length > 0) next[key] = kept;
  }
  if (field && n) next[field] = [...(next[field] ?? []), n];
  return next;
}

export function mapsEqual(a: QuestionMapState, b: QuestionMapState): boolean {
  const norm = (m: QuestionMapState) =>
    JSON.stringify(
      Object.entries(m)
        .filter(([, l]) => l.length > 0)
        .map(([k, l]) => [k, [...l].map(normalizeQuestionText).sort()])
        .sort(([x], [y]) => String(x).localeCompare(String(y))),
    );
  return norm(a) === norm(b);
}

/** Shown after a save that changed a window label; null when no label changed. */
export function labelChangeNotice(labelChanged: boolean): string | null {
  return labelChanged
    ? "Saved. Registrants are not updated until you run Remap. Renaming a label to match what buyers typed clears their flag; renaming it away from their answer flags them again, and nothing is lost."
    : null;
}

export const IGNORE_OPTION = IGNORED_QUESTION_KEY;

export function attentionWouldChangeText(n: number): string {
  if (n === 0) return "Saved. No registrant's needs-attention status changes.";
  return `Saved. ${n} registrant${n === 1 ? "" : "s"} will change their needs-attention status after you run Remap.`;
}

// ---------------------------------------------------------------------------
// Registrants filters
// ---------------------------------------------------------------------------

export interface RegistrantFilterInput {
  state?: string | null;
  flag?: string | null;
  q?: string | null;
  page?: string | number | null;
}

export interface RegistrantFilters {
  state: StuffyState | "";
  flag: (typeof REGISTRANT_FLAGS)[number] | "";
  q: string;
  page: number;
}

/** Normalizes untrusted search params: unknown values fall back to "no filter". */
export function parseRegistrantFilters(input: RegistrantFilterInput): RegistrantFilters {
  const state = (STUFFY_STATES as readonly string[]).includes(input.state ?? "") ? (input.state as StuffyState) : "";
  const flag = (REGISTRANT_FLAGS as readonly string[]).includes(input.flag ?? "")
    ? (input.flag as RegistrantFilters["flag"])
    : "";
  const q = (input.q ?? "").trim().slice(0, 100);
  const n = Math.floor(Number(input.page ?? 1));
  return { state, flag, q, page: Number.isFinite(n) && n >= 1 ? n : 1 };
}

export function registrantsHref(sessionId: string, f: Partial<RegistrantFilters>): string {
  const p = new URLSearchParams();
  if (f.state) p.set("state", f.state);
  if (f.flag) p.set("flag", f.flag);
  if (f.q) p.set("q", f.q);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  return `/admin/santas-workshop/${sessionId}/registrants${qs ? `?${qs}` : ""}`;
}

export const FLAG_LABELS: Record<(typeof REGISTRANT_FLAGS)[number], string> = {
  attention: "Needs attention",
  refund: "Open refund",
  withdrawn: "Withdrawn",
  manual: "Added by hand",
};


// ---------------------------------------------------------------------------
// Dates and URLs
// ---------------------------------------------------------------------------

/** An instant as Eastern wall-clock text, for the audit-style lines ("Nov 8, 2026, 9:05 AM"). */
export function formatEasternInstant(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(d);
}

const enc = encodeURIComponent;

/** The admin API paths the pages call, in one place. */
export const ADMIN_API = {
  sessions: "/api/admin/santas-workshop/sessions",
  session: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}`,
  campaigns: "/api/admin/santas-workshop/zeffy/campaigns",
  connect: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/zeffy`,
  questionMap: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/zeffy/question-map`,
  remap: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/zeffy/reprocess`,
  sync: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/zeffy/sync`,
  eventReprocess: (eventId: string) => `/api/admin/santas-workshop/zeffy/events/${enc(eventId)}/reprocess`,
  // Slice 2
  status: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/status`,
  crewCode: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/crew-code`,
  manualAdd: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/stuffies`,
  storageTest: "/api/admin/santas-workshop/storage/test",
  storageCheck: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/storage/check`,
  awaitingPickupCsv: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/awaiting-pickup.csv`,
  revert: (stuffyId: string) => `/api/admin/santas-workshop/stuffies/${enc(stuffyId)}/revert`,
  withdraw: (stuffyId: string) => `/api/admin/santas-workshop/stuffies/${enc(stuffyId)}/withdraw`,
  dismissAttention: (stuffyId: string) => `/api/admin/santas-workshop/stuffies/${enc(stuffyId)}/dismiss-attention`,
  refundResolution: (orderId: string) => `/api/admin/santas-workshop/orders/${enc(orderId)}/refund-resolution`,
  // Slice 3
  photos: (id: string, kind: "group" | "portrait", page = 1) => `/api/admin/santas-workshop/sessions/${enc(id)}/photos?kind=${kind}&page=${page}`,
  reviewPhotos: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/photos/review`,
  publish: (id: string) => `/api/admin/santas-workshop/sessions/${enc(id)}/publish`,
  hidePhoto: (photoId: string) => `/api/admin/santas-workshop/photos/${enc(photoId)}/hide`,
} as const;

/** A short URL name suggestion for the new-session form: "practice-2026" or "workshop-2026". */
export function suggestSlug(kind: SessionKind, dropoffDate: string): string {
  const year = /^\d{4}/.test(dropoffDate) ? dropoffDate.slice(0, 4) : "";
  return `${kind === "practice" ? "practice" : "workshop"}${year ? `-${year}` : ""}`;
}

/** Lowercase letters, digits and hyphens only, as the slug validator requires. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

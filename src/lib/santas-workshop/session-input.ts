/**
 * Pure, client-safe validation and defaults for sessions: the create and PATCH
 * validators (the server calls them, the admin form may too) and the
 * pre-filled "new session" draft built from the increment-1 WORKSHOP_2026
 * constant, so there is ONE authoring path for dates and windows.
 *
 * `kind` and `slug` are immutable: the PATCH validator rejects them by name
 * (`immutable_field`), which is what the immutability test asserts.
 */

import { WORKSHOP_2026 } from "./facts";
import { formatTimeRange } from "./format";
import { SESSION_KINDS, type SessionKind } from "./session-vocabulary";
import { isQuestionMapKey, normalizeQuestionText } from "./question-fields";
import type { AdminErrorCode, CreateSessionRequest, SessionWindow, UpdateSessionRequest } from "./admin-contract";

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: AdminErrorCode; field?: string };

const SLUG = /^[a-z0-9-]{3,40}$/;
const WINDOW_ID = /^[a-z0-9-]{1,40}$/;
const ART_KEY = /^[a-z0-9-]{1,40}$/;
const FILE_PREFIX = /^[a-z0-9-]{1,40}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const NAME_MAX = 120;
export const WINDOW_LABEL_MAX = 80;
export const WINDOWS_MAX = 12;
export const QUOTA_MIN_BYTES = 1024 * 1024;
export const QUOTA_MAX_BYTES = 50 * 1024 * 1024 * 1024;
export const FRAME_PART_MIN = 10;
export const FRAME_PART_MAX = 500;

const fail = (error: string, field?: string, code: AdminErrorCode = "invalid_input"): Validated<never> => ({
  ok: false,
  error,
  code,
  ...(field ? { field } : {}),
});

export function isRealDay(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DAY.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days));
  return dt.toISOString().slice(0, 10);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function checkName(v: unknown): Validated<string> {
  if (typeof v !== "string") return fail("Name is required", "name");
  const name = v.trim();
  if (!name) return fail("Name is required", "name");
  if ([...name].length > NAME_MAX) return fail(`Name must be at most ${NAME_MAX} characters`, "name");
  return { ok: true, value: name };
}

function checkDay(v: unknown, field: string): Validated<string> {
  return isRealDay(v) ? { ok: true, value: v } : fail(`${field} must be a real YYYY-MM-DD date`, field);
}

export function validateWindows(v: unknown): Validated<SessionWindow[]> {
  if (!Array.isArray(v) || v.length === 0) return fail("At least one drop-off window is required", "windows");
  if (v.length > WINDOWS_MAX) return fail(`At most ${WINDOWS_MAX} windows`, "windows");
  const seen = new Set<string>();
  const out: SessionWindow[] = [];
  for (const raw of v) {
    if (!isPlainObject(raw)) return fail("Each window must be an object", "windows");
    const { id, label, start, end } = raw;
    if (typeof id !== "string" || !WINDOW_ID.test(id)) return fail("Window id must be lowercase letters, digits and hyphens", "windows");
    if (seen.has(id)) return fail("Window ids must be unique", "windows");
    seen.add(id);
    if (typeof label !== "string" || !label.trim() || [...label.trim()].length > WINDOW_LABEL_MAX) {
      return fail(`Window label is required (at most ${WINDOW_LABEL_MAX} characters)`, "windows");
    }
    if (typeof start !== "string" || typeof end !== "string" || !HHMM.test(start) || !HHMM.test(end)) {
      return fail("Window times must be HH:MM", "windows");
    }
    if (start >= end) return fail("A window must start before it ends", "windows");
    out.push({ id, label: label.trim(), start, end });
  }
  return { ok: true, value: out };
}

/** Cross-field date rules, applied to the MERGED values (the PATCH route merges first). */
export function validateSessionDates(d: {
  dropoffDate: string;
  photoDate: string;
  pickupDate: string;
  crewClosesOn: string;
  purgePersonalOn: string;
  purgePublicOn: string;
}): Validated<true> {
  if (d.dropoffDate > d.photoDate) return fail("Photo day cannot be before drop-off", "photoDate");
  if (d.photoDate > d.pickupDate) return fail("Pickup cannot be before photo day", "pickupDate");
  if (d.crewClosesOn < d.pickupDate) return fail("Worker access cannot close before pickup day", "crewClosesOn");
  if (d.purgePersonalOn <= d.pickupDate) return fail("Personal data cannot be removed on or before pickup day", "purgePersonalOn");
  if (d.purgePublicOn < d.purgePersonalOn) return fail("Public photos cannot be removed before personal data", "purgePublicOn");
  return { ok: true, value: true };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Pickup + 30 days; Jan 31 of the year after pickup (DECISION-125). */
export function defaultRetention(pickupDate: string): { purgePersonalOn: string; purgePublicOn: string } {
  return {
    purgePersonalOn: addDays(pickupDate, 30),
    purgePublicOn: `${Number(pickupDate.slice(0, 4)) + 1}-01-31`,
  };
}

/** Worker access lapses the day after pickup (inclusive Eastern date). */
export function defaultCrewClosesOn(pickupDate: string): string {
  return addDays(pickupDate, 1);
}

export const DEFAULT_QUOTA_BYTES = { real: 600 * 1024 * 1024, practice: 100 * 1024 * 1024 } as const;

/** The "new session" form's starting values: dates and windows from WORKSHOP_2026. */
export function defaultSessionDraft(kind: SessionKind = "real"): CreateSessionRequest {
  const f = WORKSHOP_2026;
  return {
    name: kind === "practice" ? "Santa's Workshop dry run" : "A Visit to Santa's Workshop",
    slug: "",
    kind,
    dropoffDate: f.dates.dropoff,
    photoDate: f.dates.photos,
    pickupDate: f.dates.pickup,
    windows: f.windows.map((w) => ({ id: w.id, label: formatTimeRange(w.start, w.end), start: w.start, end: w.end })),
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export function validateCreateSession(input: unknown): Validated<CreateSessionRequest> {
  if (!isPlainObject(input)) return fail("Request body must be a JSON object");

  const name = checkName(input.name);
  if (!name.ok) return name;

  if (typeof input.slug !== "string" || !SLUG.test(input.slug)) {
    return fail("Slug must be 3 to 40 lowercase letters, digits or hyphens", "slug");
  }
  if (typeof input.kind !== "string" || !(SESSION_KINDS as readonly string[]).includes(input.kind)) {
    return fail("Kind must be practice or real", "kind");
  }

  const dropoff = checkDay(input.dropoffDate, "dropoffDate");
  if (!dropoff.ok) return dropoff;
  const photo = checkDay(input.photoDate, "photoDate");
  if (!photo.ok) return photo;
  const pickup = checkDay(input.pickupDate, "pickupDate");
  if (!pickup.ok) return pickup;
  const windows = validateWindows(input.windows);
  if (!windows.ok) return windows;

  const retention = defaultRetention(pickup.value);
  const dates = validateSessionDates({
    dropoffDate: dropoff.value,
    photoDate: photo.value,
    pickupDate: pickup.value,
    crewClosesOn: defaultCrewClosesOn(pickup.value),
    ...retention,
  });
  if (!dates.ok) return dates;

  return {
    ok: true,
    value: {
      name: name.value,
      slug: input.slug,
      kind: input.kind as SessionKind,
      dropoffDate: dropoff.value,
      photoDate: photo.value,
      pickupDate: pickup.value,
      windows: windows.value,
    },
  };
}

const PATCHABLE = [
  "name",
  "dropoffDate",
  "photoDate",
  "pickupDate",
  "windows",
  "crewClosesOn",
  "purgePersonalOn",
  "purgePublicOn",
  "storageQuotaBytes",
  "frameArtKey",
  "frameFilePrefix",
  "framePartSize",
] as const;

const IMMUTABLE = ["kind", "slug"] as const;

export function validateUpdateSession(input: unknown): Validated<UpdateSessionRequest> {
  if (!isPlainObject(input)) return fail("Request body must be a JSON object");

  for (const key of IMMUTABLE) {
    if (key in input) return fail(`${key} cannot be changed after the session is created`, key, "immutable_field");
  }
  for (const key of Object.keys(input)) {
    if (!(PATCHABLE as readonly string[]).includes(key)) return fail(`Unknown field: ${key}`, key);
  }
  if (Object.keys(input).length === 0) return fail("Nothing to update");

  const out: UpdateSessionRequest = {};

  if ("name" in input) {
    const r = checkName(input.name);
    if (!r.ok) return r;
    out.name = r.value;
  }
  for (const key of ["dropoffDate", "photoDate", "pickupDate", "crewClosesOn", "purgePersonalOn", "purgePublicOn"] as const) {
    if (key in input) {
      const r = checkDay(input[key], key);
      if (!r.ok) return r;
      out[key] = r.value;
    }
  }
  if ("windows" in input) {
    const r = validateWindows(input.windows);
    if (!r.ok) return r;
    out.windows = r.value;
  }
  if ("storageQuotaBytes" in input) {
    const q = input.storageQuotaBytes;
    if (typeof q !== "number" || !Number.isInteger(q) || q < QUOTA_MIN_BYTES || q > QUOTA_MAX_BYTES) {
      return fail("Storage quota is out of range", "storageQuotaBytes");
    }
    out.storageQuotaBytes = q;
  }
  if ("frameArtKey" in input) {
    if (typeof input.frameArtKey !== "string" || !ART_KEY.test(input.frameArtKey)) {
      return fail("Frame art key must be lowercase letters, digits and hyphens", "frameArtKey");
    }
    out.frameArtKey = input.frameArtKey;
  }
  if ("frameFilePrefix" in input) {
    const p = input.frameFilePrefix;
    if (typeof p !== "string" || (p !== "" && !FILE_PREFIX.test(p))) {
      return fail("File prefix must be empty or lowercase letters, digits and hyphens", "frameFilePrefix");
    }
    out.frameFilePrefix = p;
  }
  if ("framePartSize" in input) {
    const n = input.framePartSize;
    if (typeof n !== "number" || !Number.isInteger(n) || n < FRAME_PART_MIN || n > FRAME_PART_MAX) {
      return fail(`Frames per download must be ${FRAME_PART_MIN} to ${FRAME_PART_MAX}`, "framePartSize");
    }
    out.framePartSize = n;
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Connect + question map
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function validateConnectCampaign(
  input: unknown,
): Validated<{ campaignId: string; ticketRateIds: string[]; campaignTitle: string | null }> {
  if (!isPlainObject(input)) return fail("Request body must be a JSON object");
  if (typeof input.campaignId !== "string" || !CAMPAIGN_ID.test(input.campaignId)) {
    return fail("Campaign id is required", "campaignId");
  }
  if (!Array.isArray(input.ticketRateIds) || input.ticketRateIds.length > 20) {
    return fail("Ticket rate ids must be a list of at most 20", "ticketRateIds");
  }
  const rates: string[] = [];
  for (const r of input.ticketRateIds) {
    if (typeof r !== "string" || !CAMPAIGN_ID.test(r)) return fail("Each ticket rate id must be an id string", "ticketRateIds");
    if (!rates.includes(r)) rates.push(r);
  }
  let title: string | null = null;
  if (input.campaignTitle !== undefined) {
    if (typeof input.campaignTitle !== "string" || [...input.campaignTitle.trim()].length > 200) {
      return fail("Campaign title is too long", "campaignTitle");
    }
    title = input.campaignTitle.trim() || null;
  }
  return { ok: true, value: { campaignId: input.campaignId, ticketRateIds: rates, campaignTitle: title } };
}

export const MAP_STRINGS_PER_FIELD_MAX = 20;
export const MAP_STRING_MAX = 300;

/**
 * A question map: field key -> question strings. Strings are normalized here
 * (the server stores only normalized text), de-duplicated within a field, and a
 * string may belong to ONE field only (`duplicate_mapping`). An empty list drops
 * the field.
 */
export function validateQuestionMap(input: unknown): Validated<Record<string, string[]>> {
  if (!isPlainObject(input) || !isPlainObject(input.map)) return fail("Request body must be { map }", "map");
  const owner = new Map<string, string>();
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(input.map)) {
    if (!isQuestionMapKey(key)) return fail(`Unknown field: ${key}`, key);
    if (!Array.isArray(value) || value.length > MAP_STRINGS_PER_FIELD_MAX) {
      return fail(`${key} must be a list of at most ${MAP_STRINGS_PER_FIELD_MAX} question strings`, key);
    }
    const normalized: string[] = [];
    for (const s of value) {
      if (typeof s !== "string") return fail(`${key} must contain only strings`, key);
      const n = normalizeQuestionText(s);
      if (!n) continue;
      if (n.length > MAP_STRING_MAX) return fail("A question string is too long", key);
      const prior = owner.get(n);
      if (prior && prior !== key) {
        return fail("The same question text cannot map to two fields", key, "duplicate_mapping");
      }
      owner.set(n, key);
      if (!normalized.includes(n)) normalized.push(n);
    }
    if (normalized.length > 0) out[key] = normalized;
  }
  return { ok: true, value: out };
}

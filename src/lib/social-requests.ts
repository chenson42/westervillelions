/**
 * Social Media Post Requests — pure constants, validators, and
 * business-logic helpers (no DB access). The DB-facing counterpart is
 * `src/lib/social-requests-queries.ts`.
 *
 * docs/work-log/2026-09-03-social-media-requests.md, Phase 3 "Data Model" /
 * "API Contract" / "Required Unit Tests".
 *
 * Modeled directly on `src/lib/proposals.ts` (same shape: two-table,
 * mutable-then-locked request + append-only decisions), with the three
 * deliberate deviations documented in the schema's doc comment: `posted`
 * replaces `approved` as the terminal state, decisions carry no
 * minutes-citation trio, and `desiredPostDate` has no value+unknown pair.
 *
 * This file imports ONLY the `NewSocialRequest` type from `@/lib/db/schema`
 * (type-only, erased at compile time) plus `validateMagicBytes` (pure, no DB
 * import) — it stays importable without `DATABASE_URL` set and from a
 * `"use client"` file, same contract as `proposals.ts`.
 */

import type { NewSocialRequest } from "@/lib/db/schema";
import { validateMagicBytes } from "@/lib/receipt-magic-bytes";

// ── status ───────────────────────────────────────────────────────────────
// DECISION-041 pattern: `social_requests.status` is plain `text`, no DB
// CHECK/enum. `posted` is the terminal-success state (not `approved`) — see
// the schema.ts doc comment for why.
export const SOCIAL_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "posted",
  "declined",
  "deferred",
] as const;

export type SocialRequestStatus = (typeof SOCIAL_REQUEST_STATUSES)[number];

export function isValidSocialRequestStatus(status: string): status is SocialRequestStatus {
  return (SOCIAL_REQUEST_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses a board decision (`POST /api/admin/social-requests/[id]/decide`)
 * may transition a request TO. Deliberately excludes 'draft' (a decision
 * never sends a request back to draft) and 'submitted' (that transition is
 * the requester's own submit action — its social_request_decisions row is
 * written by submitSocialRequest(), never decideSocialRequest()).
 */
export const DECISION_TARGET_STATUSES = ["under_review", "posted", "declined", "deferred"] as const;

export type DecisionTargetStatus = (typeof DECISION_TARGET_STATUSES)[number];

export function isValidDecisionTargetStatus(status: string): status is DecisionTargetStatus {
  return (DECISION_TARGET_STATUSES as readonly string[]).includes(status);
}

// ── platforms ────────────────────────────────────────────────────────────
// DECISION-041 pattern: `social_requests.platforms` is a plain `text[]`, no
// DB CHECK/enum — validated here.
export const SOCIAL_REQUEST_PLATFORMS = ["facebook", "instagram", "twitter_x", "linkedin", "other"] as const;

export type SocialRequestPlatform = (typeof SOCIAL_REQUEST_PLATFORMS)[number];

export function isValidPlatform(value: string): value is SocialRequestPlatform {
  return (SOCIAL_REQUEST_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Validates an array of platform values. A draft may legitimately have zero
 * platforms — this function does NOT reject an empty array; that rule is
 * enforced separately, and only at submit time, by
 * `validateSocialRequestSubmission()`.
 */
export function isValidPlatformArray(values: unknown): values is SocialRequestPlatform[] {
  if (!Array.isArray(values)) return false;
  return values.every((v) => typeof v === "string" && isValidPlatform(v));
}

const PLATFORM_LABELS: Record<SocialRequestPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  twitter_x: "X (Twitter)",
  linkedin: "LinkedIn",
  other: "Other",
};

export function socialRequestPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as SocialRequestPlatform] ?? platform;
}

// ── edit lock ────────────────────────────────────────────────────────────
// Same precedent as isProposalEditableByProposer(): editable by the
// requester while 'draft' or 'submitted'; locks to read-only once a board
// member advances it to 'under_review' or beyond.
export function isSocialRequestEditableByRequester(status: string): boolean {
  return status === "draft" || status === "submitted";
}

// ── no-op decision guard ────────────────────────────────────────────────
// A status transition to the SAME status is rejected (409) before any row
// is written — no duplicate social_request_decisions row, no duplicate
// requester email. Only compares the two statuses passed in; it does not
// consult history, so a status repeating a PRIOR (non-consecutive) value
// (e.g. 'deferred' again after an intervening 'under_review') is correctly
// NOT a no-op.
export function isNoOpDecision(currentStatus: string, targetStatus: string): boolean {
  return currentStatus === targetStatus;
}

// ── visibility ───────────────────────────────────────────────────────────
// Same rule as proposalVisibleTo(): a request is visible to its requester
// and to SOCIAL_REQUESTS_REVIEW holders only — never club-wide. A
// requesterUserId of null (the requester's account was deleted) can never
// match any viewer, so it always resolves to false for every non-reviewer
// viewer.
export interface SocialRequestVisibilityInput {
  requesterUserId: string | null;
  viewerUserId: string | null;
  viewerHasReviewAccess: boolean;
}

export function socialRequestVisibleTo(input: SocialRequestVisibilityInput): boolean {
  if (input.viewerHasReviewAccess) return true;
  if (input.requesterUserId === null || input.viewerUserId === null) return false;
  return input.requesterUserId === input.viewerUserId;
}

// ── display labels ──────────────────────────────────────────────────────
const SOCIAL_REQUEST_STATUS_LABELS: Record<SocialRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  posted: "Posted",
  declined: "Declined",
  deferred: "Deferred",
};

export function socialRequestStatusLabel(status: string): string {
  return SOCIAL_REQUEST_STATUS_LABELS[status as SocialRequestStatus] ?? status;
}

// The label used in the requester's status-change email subject line — a
// narrower vocabulary than the general status label ("Now Under Review"
// instead of plain "Under Review"), mirroring proposalDecisionEmailSubject().
const DECISION_EMAIL_STATUS_LABELS: Record<DecisionTargetStatus, string> = {
  under_review: "Now Under Review",
  posted: "Posted",
  declined: "Declined",
  deferred: "Deferred",
};

export function socialRequestDecisionEmailSubject(subjectLine: string, status: string): string {
  const label = DECISION_EMAIL_STATUS_LABELS[status as DecisionTargetStatus] ?? socialRequestStatusLabel(status);
  return `Update on your social media request: ${subjectLine} — ${label}`;
}

// ── subject line (no projectName-equivalent field exists here) ──────────
export const SUBJECT_LINE_MAX_LEN = 60;
const DEFAULT_SUBJECT_LINE = "your social media request";

/**
 * Truncates `postCopy` to a short subject-line-safe string, used in email
 * subject lines and admin-list row titles — there is no `projectName`
 * equivalent field on this feature the way Proposals has.
 */
export function socialRequestSubjectLine(postCopy: string | null | undefined): string {
  if (!postCopy || !postCopy.trim()) return DEFAULT_SUBJECT_LINE;
  const trimmed = postCopy.trim();
  if (trimmed.length <= SUBJECT_LINE_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, SUBJECT_LINE_MAX_LEN).trimEnd()}…`;
}

// ── required-field validation at submit time ────────────────────────────
// "Required" is enforced entirely here (never a DB constraint) — a draft is
// explicitly allowed to have any/all of these blank. Runs at the
// POST .../submit boundary only.
export interface SocialRequestSubmissionInput {
  platforms: string[] | null;
  postCopy: string | null;
}

export interface SocialRequestValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateSocialRequestSubmission(input: SocialRequestSubmissionInput): SocialRequestValidationResult {
  const errors: Record<string, string> = {};

  if (!input.platforms || input.platforms.length === 0) {
    errors.platforms = "Choose at least one platform to post to";
  } else if (!input.platforms.every((p) => isValidPlatform(p))) {
    errors.platforms = "One or more platforms are not recognized";
  }

  if (!input.postCopy || !input.postCopy.trim()) {
    errors.postCopy = "Post copy/caption is required";
  }

  // desiredPostDate is intentionally not checked here — a blank value is
  // unambiguously "no preference", not an error (see schema.ts doc comment
  // on desiredPostDate for why no tri-state pair exists for this field).

  return { valid: Object.keys(errors).length === 0, errors };
}

// ── shared field parsing (POST create + PATCH update) ────────────────────
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(raw: unknown): raw is string {
  return typeof raw === "string" && DATE_REGEX.test(raw) && !isNaN(new Date(`${raw}T00:00:00`).getTime());
}

export const POST_COPY_MAX_LEN = 3000;
export const NOTES_MAX_LEN = 2000;
export const DECISION_NOTE_MAX_LEN = 2000;

// Mirrors the profile-picture route's ~300KB cap
// (src/app/api/members/profile-picture/route.ts) — same trust-boundary
// reasoning, applied here to an optional attachment instead of a required one.
export const MAX_IMAGE_DATA_URI_LENGTH = 409_600;

const DATA_URI_REGEX = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,(.+)$/;

export interface ImageDataUriValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates an uploaded image data URI: length cap, well-formed base64 data
 * URI shape, AND `validateMagicBytes()` against the DECODED bytes — this is
 * the one place this feature is intentionally stricter than its own
 * `profile-picture` precedent, which only checks the `data:image/` string
 * prefix. A client-supplied Content-Type/prefix is never trusted alone.
 */
export function validateImageDataUri(dataUri: string): ImageDataUriValidationResult {
  if (dataUri.length > MAX_IMAGE_DATA_URI_LENGTH) {
    return { valid: false, error: "Image too large. Maximum size is approximately 300KB." };
  }

  const match = DATA_URI_REGEX.exec(dataUri);
  if (!match) {
    return { valid: false, error: "Invalid image. Must be a base64 data URI." };
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(match[1], "base64");
  } catch {
    return { valid: false, error: "Invalid image. Could not decode base64 data." };
  }

  const mimeType = validateMagicBytes(decoded);
  if (mimeType !== "image/jpeg" && mimeType !== "image/png") {
    return { valid: false, error: "Only JPEG and PNG images are accepted." };
  }

  return { valid: true };
}

function parseTrimmedString(raw: unknown, maxLen: number): string | null | "invalid" {
  if (raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parses+validates a member-supplied social request body (POST create or
 * PATCH update) into a Partial<NewSocialRequest> the query layer can write
 * directly. `status`, `requesterUserId`, and `requesterMemberId` are never
 * accepted here — they are stamped/derived server-side by the caller
 * (createDraftSocialRequest / submitSocialRequest), never client-writable.
 *
 * `imageDataUri` follows the "key absent = leave unchanged" convention every
 * other optional field already uses for PATCH — the client only sends this
 * key on a tick where the image was actually added/changed/removed
 * (Phase 3 Component Plan "Deviation from the always send full state rule").
 */
export function parseSocialRequestBody(rawBody: unknown): { fields: Partial<NewSocialRequest>; error?: string } {
  const fields: Partial<NewSocialRequest> = {};

  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { fields };
  }
  const body = rawBody as Record<string, unknown>;

  if ("status" in body) {
    return { fields, error: "status cannot be set directly — use the submit or decide actions" };
  }
  if ("requesterUserId" in body || "requesterMemberId" in body) {
    return { fields, error: "requester cannot be set directly" };
  }

  if (body.platforms !== undefined) {
    if (body.platforms === null) {
      fields.platforms = [];
    } else if (!isValidPlatformArray(body.platforms)) {
      return {
        fields,
        error: `platforms must be an array containing only: ${SOCIAL_REQUEST_PLATFORMS.join(", ")}`,
      };
    } else {
      fields.platforms = body.platforms;
    }
  }

  if (body.postCopy !== undefined) {
    const parsed = parseTrimmedString(body.postCopy, POST_COPY_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "postCopy must be a string" };
    fields.postCopy = parsed;
  }

  if (body.notes !== undefined) {
    const parsed = parseTrimmedString(body.notes, NOTES_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "notes must be a string" };
    fields.notes = parsed;
  }

  if (body.linkUrl !== undefined) {
    if (body.linkUrl === null) {
      fields.linkUrl = null;
    } else if (typeof body.linkUrl !== "string" || !/^https?:\/\//i.test(body.linkUrl.trim())) {
      return { fields, error: "linkUrl must start with http:// or https://" };
    } else {
      fields.linkUrl = body.linkUrl.trim();
    }
  }

  if (body.desiredPostDate !== undefined) {
    if (body.desiredPostDate !== null && !isValidDateString(body.desiredPostDate)) {
      return { fields, error: "desiredPostDate must be a valid date in YYYY-MM-DD format, or null" };
    }
    fields.desiredPostDate = body.desiredPostDate === null ? null : (body.desiredPostDate as string);
  }

  if (body.imageDataUri !== undefined) {
    if (body.imageDataUri === null) {
      fields.imageDataUri = null;
    } else if (typeof body.imageDataUri !== "string") {
      return { fields, error: "imageDataUri must be a string or null" };
    } else {
      const result = validateImageDataUri(body.imageDataUri);
      if (!result.valid) return { fields, error: result.error };
      fields.imageDataUri = body.imageDataUri;
    }
  }

  return { fields };
}

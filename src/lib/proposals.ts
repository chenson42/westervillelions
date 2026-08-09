/**
 * Project / Activity Proposals — pure constants, validators, and
 * business-logic helpers (no DB access). The DB-facing counterpart is
 * `src/lib/proposals-queries.ts`.
 *
 * docs/work-log/2026-08-09-project-proposal-form.md, Phase 3 "Data Model" /
 * "API Contract" / "Required Unit Tests"; DECISION-084.
 *
 * This file imports ONLY the `NewProposal` type from `@/lib/db/schema` (a
 * type-only import, erased at compile time — schema.ts itself has zero
 * runtime imports beyond drizzle-orm/pg-core, so this does not pull in a
 * live DB connection or break this module's "importable without
 * DATABASE_URL set" contract, the same contract `src/lib/minutes.ts` and
 * `src/lib/documents.ts` maintain).
 */

import type { NewProposal } from "@/lib/db/schema";

// ── status ───────────────────────────────────────────────────────────────
// DECISION-041 pattern: `proposals.status` is plain `text`, no DB CHECK/enum.
export const PROPOSAL_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "declined",
  "deferred",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export function isValidProposalStatus(status: string): status is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses a board decision (`POST /api/admin/proposals/[id]/decide`)
 * may transition a proposal TO. Deliberately excludes 'draft' (a decision
 * never sends a proposal back to draft) and 'submitted' (that transition is
 * the proposer's own submit action, not a board decision — its
 * proposalDecisions row is written by submitProposal(), never decideProposal()).
 */
export const DECISION_TARGET_STATUSES = ["under_review", "approved", "declined", "deferred"] as const;

export type DecisionTargetStatus = (typeof DECISION_TARGET_STATUSES)[number];

export function isValidDecisionTargetStatus(status: string): status is DecisionTargetStatus {
  return (DECISION_TARGET_STATUSES as readonly string[]).includes(status);
}

// ── type ─────────────────────────────────────────────────────────────────
// DECISION-041 pattern: `proposals.type` is plain `text`, no DB CHECK/enum.
export const PROPOSAL_TYPES = ["fundraiser", "service_project", "both"] as const;

export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export function isValidProposalType(type: string): type is ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(type);
}

// ── money-needed gate ───────────────────────────────────────────────────
// DECISION-041 pattern. This is a required three-way ANSWER, not a
// value/unknown pair — see the tri-state value+unknown pairs below for the
// genuinely different shape those fields use.
export const MONEY_NEEDED_VALUES = ["yes", "no", "not_sure"] as const;

export type MoneyNeeded = (typeof MONEY_NEEDED_VALUES)[number];

export function isValidMoneyNeeded(value: string): value is MoneyNeeded {
  return (MONEY_NEEDED_VALUES as readonly string[]).includes(value);
}

// ── edit lock ────────────────────────────────────────────────────────────
// Phase 1 accepted ruling (c): editable by the proposer while 'draft' or
// 'submitted'; locks to read-only once an admin advances it to
// 'under_review' or beyond, so the board never decides on text that moved
// after they started reading.
export function isProposalEditableByProposer(status: string): boolean {
  return status === "draft" || status === "submitted";
}

// ── no-op decision guard ────────────────────────────────────────────────
// A status transition to the SAME status is rejected (409) before any row
// is written — no duplicate proposalDecisions row, no duplicate proposer
// email. Only compares the two statuses passed in; it does not consult
// history, so a status repeating a PRIOR (non-consecutive) value (e.g.
// 'deferred' again after an intervening 'under_review') is correctly NOT a
// no-op — currentStatus at that point is 'under_review', not 'deferred'.
export function isNoOpDecision(currentStatus: string, targetStatus: string): boolean {
  return currentStatus === targetStatus;
}

// ── visibility ───────────────────────────────────────────────────────────
// Phase 2 §"The permission key" / Phase 1 Gap (a), treasurer-confirmed
// 2026-08-09: a proposal is visible to its proposer and to PROPOSALS_REVIEW
// holders only — NOT club-wide. A proposerUserId of null (the proposer's
// account was deleted) can never match any viewer, so it always resolves to
// false for every non-reviewer viewer — there is no "unowned proposal is
// visible to everyone" fallback.
export interface ProposalVisibilityInput {
  proposerUserId: string | null;
  viewerUserId: string | null;
  viewerHasReviewAccess: boolean;
}

export function proposalVisibleTo(input: ProposalVisibilityInput): boolean {
  if (input.viewerHasReviewAccess) return true;
  if (input.proposerUserId === null || input.viewerUserId === null) return false;
  return input.proposerUserId === input.viewerUserId;
}

// ── display labels ──────────────────────────────────────────────────────
const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
};

export function proposalStatusLabel(status: string): string {
  return PROPOSAL_STATUS_LABELS[status as ProposalStatus] ?? status;
}

// The label used in the proposer's status-change email subject line — a
// narrower vocabulary than the general status label ("Now Under Review"
// instead of plain "Under Review"), per Phase 3's Email contract.
const DECISION_EMAIL_STATUS_LABELS: Record<DecisionTargetStatus, string> = {
  under_review: "Now Under Review",
  approved: "Approved",
  declined: "Declined",
  deferred: "Deferred",
};

export function proposalDecisionEmailSubject(projectName: string, status: string): string {
  const label = DECISION_EMAIL_STATUS_LABELS[status as DecisionTargetStatus] ?? proposalStatusLabel(status);
  return `Update on your proposal: ${projectName} — ${label}`;
}

// ── required-field validation at submit time ────────────────────────────
// "Required" is enforced entirely here (never a DB constraint) — a draft is
// explicitly allowed to have any/all of these blank. Runs at the
// POST .../submit boundary only.
export interface ProposalSubmissionInput {
  projectName: string | null;
  type: string | null;
  needDescription: string | null;
  chairName: string | null;
  moneyNeeded: string | null;
  estimatedCostCents: number | null;
  estimatedCostUnknown: boolean | null;
}

export interface ProposalValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export function validateProposalSubmission(input: ProposalSubmissionInput): ProposalValidationResult {
  const errors: Record<string, string> = {};

  if (!input.projectName || !input.projectName.trim()) {
    errors.projectName = "Project or activity name is required";
  }

  if (!input.type || !isValidProposalType(input.type)) {
    errors.type = "Type is required — choose Fundraiser, Service Project, or Both";
  }

  if (!input.needDescription || !input.needDescription.trim()) {
    errors.needDescription = "Please describe the need this meets and how it helps the community";
  }

  // "Not yet identified" is a valid literal submitted value, not a blank —
  // Phase 1's treasurer ruling. Any non-empty string passes, including that
  // literal one; only an actually-empty/whitespace value is rejected.
  if (!input.chairName || !input.chairName.trim()) {
    errors.chairName =
      'Chairperson is required — enter a name, or "Not yet identified" if no one has stepped forward yet';
  }

  if (!input.moneyNeeded || !isValidMoneyNeeded(input.moneyNeeded)) {
    errors.moneyNeeded = "Please answer whether this will need money from the club up front";
  } else if (input.moneyNeeded === "yes") {
    const hasValue = input.estimatedCostCents !== null && input.estimatedCostCents !== undefined;
    const isUnknown = input.estimatedCostUnknown === true;
    if (!hasValue && !isUnknown) {
      errors.estimatedCostCents = 'Enter an estimated cost, or mark it "not sure yet"';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ── tri-state (value + unknown) coherence ───────────────────────────────
// "Not sure" and "blank/invalid" are different facts and must never
// collapse into one NULL, and a value + unknown=true together must never be
// silently coerced into one or the other — the request is rejected instead.
export function checkTriStateCoherence(
  effectiveValue: number | string | null | undefined,
  effectiveUnknown: boolean | null | undefined,
  fieldLabel: string,
): string | null {
  if (effectiveValue !== null && effectiveValue !== undefined && effectiveUnknown === true) {
    return `${fieldLabel} cannot have a value and be marked "not sure" at the same time`;
  }
  return null;
}

// ── shared field parsing (POST create + PATCH update) ───────────────────
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(raw: unknown): raw is string {
  return typeof raw === "string" && DATE_REGEX.test(raw) && !isNaN(new Date(`${raw}T00:00:00`).getTime());
}

export const PROJECT_NAME_MAX_LEN = 200;
export const NEED_DESCRIPTION_MAX_LEN = 3000;
export const CHAIR_NAME_MAX_LEN = 200;
export const CLUB_RESOURCES_MAX_LEN = 2000;
export const PUBLICITY_PLAN_MAX_LEN = 2000;
export const ADDITIONAL_NOTES_MAX_LEN = 2000;
export const DECISION_NOTE_MAX_LEN = 2000;

/** The subset of a Proposal row needed to merge tri-state coherence checks
 *  against a partial PATCH body. Pass `null` for a brand-new draft (POST
 *  create — there is no existing row yet). */
export interface ProposalTriStateSnapshot {
  estimatedCostCents: number | null;
  estimatedCostUnknown: boolean;
  estimatedIncomeCents: number | null;
  estimatedIncomeUnknown: boolean;
  proposedDate: string | null;
  proposedDateUnknown: boolean;
  volunteersNeeded: number | null;
  volunteersNeededUnknown: boolean;
}

function parseTrimmedString(raw: unknown, maxLen: number): string | null | "invalid" {
  if (raw === null) return null;
  if (typeof raw !== "string") return "invalid";
  const trimmed = raw.trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : null;
}

function parseNonNegativeInt(raw: unknown): number | null | "invalid" {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return "invalid";
  return raw;
}

function parseBoolean(raw: unknown): boolean | "invalid" {
  if (typeof raw !== "boolean") return "invalid";
  return raw;
}

/**
 * Parses+validates a member-supplied proposal body (POST create or PATCH
 * update) into a Partial<NewProposal> the query layer can write directly.
 * `status`, `proposerUserId`, `proposerMemberId`, and the snapshot columns
 * are never accepted here — they are stamped/derived server-side by the
 * caller (createDraftProposal / submitProposal), never client-writable.
 *
 * `existing` supplies the CURRENT stored value for each tri-state pair so
 * coherence is checked against the state the row would end up in after this
 * update is applied, not just the fields present in this one request body —
 * a client that PATCHes `estimatedCostUnknown: true` alone, without also
 * re-sending `estimatedCostCents: null`, must not be allowed to leave a
 * stored row with both a value and unknown=true.
 */
export function parseProposalBody(
  rawBody: unknown,
  existing: ProposalTriStateSnapshot | null,
): { fields: Partial<NewProposal>; error?: string } {
  const fields: Partial<NewProposal> = {};

  if (rawBody === null || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { fields };
  }
  const body = rawBody as Record<string, unknown>;

  if ("status" in body) {
    return { fields, error: "status cannot be set directly — use the submit or decide actions" };
  }
  if ("proposerUserId" in body || "proposerMemberId" in body) {
    return { fields, error: "proposer cannot be set directly" };
  }

  if (body.projectName !== undefined) {
    const parsed = parseTrimmedString(body.projectName, PROJECT_NAME_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "projectName must be a string" };
    fields.projectName = parsed;
  }

  if (body.type !== undefined) {
    if (body.type !== null && (typeof body.type !== "string" || !isValidProposalType(body.type))) {
      return { fields, error: "type must be one of: fundraiser, service_project, both" };
    }
    fields.type = body.type === null ? null : (body.type as ProposalType);
  }

  if (body.needDescription !== undefined) {
    const parsed = parseTrimmedString(body.needDescription, NEED_DESCRIPTION_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "needDescription must be a string" };
    fields.needDescription = parsed;
  }

  if (body.chairName !== undefined) {
    const parsed = parseTrimmedString(body.chairName, CHAIR_NAME_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "chairName must be a string" };
    fields.chairName = parsed;
  }

  if (body.moneyNeeded !== undefined) {
    if (body.moneyNeeded !== null && (typeof body.moneyNeeded !== "string" || !isValidMoneyNeeded(body.moneyNeeded))) {
      return { fields, error: "moneyNeeded must be one of: yes, no, not_sure" };
    }
    fields.moneyNeeded = body.moneyNeeded === null ? null : (body.moneyNeeded as MoneyNeeded);
  }

  // ── estimated cost (tri-state pair) ────────────────────────────────────
  if (body.estimatedCostCents !== undefined) {
    const parsed = parseNonNegativeInt(body.estimatedCostCents);
    if (parsed === "invalid") return { fields, error: "estimatedCostCents must be a non-negative integer, or null" };
    fields.estimatedCostCents = parsed;
  }
  if (body.estimatedCostUnknown !== undefined) {
    const parsed = parseBoolean(body.estimatedCostUnknown);
    if (parsed === "invalid") return { fields, error: "estimatedCostUnknown must be a boolean" };
    fields.estimatedCostUnknown = parsed;
  }
  {
    const effectiveValue = fields.estimatedCostCents !== undefined ? fields.estimatedCostCents : existing?.estimatedCostCents ?? null;
    const effectiveUnknown =
      fields.estimatedCostUnknown !== undefined ? fields.estimatedCostUnknown : existing?.estimatedCostUnknown ?? false;
    const err = checkTriStateCoherence(effectiveValue, effectiveUnknown, "Estimated cost");
    if (err) return { fields, error: err };
  }

  // ── estimated income (tri-state pair) ──────────────────────────────────
  if (body.estimatedIncomeCents !== undefined) {
    const parsed = parseNonNegativeInt(body.estimatedIncomeCents);
    if (parsed === "invalid") return { fields, error: "estimatedIncomeCents must be a non-negative integer, or null" };
    fields.estimatedIncomeCents = parsed;
  }
  if (body.estimatedIncomeUnknown !== undefined) {
    const parsed = parseBoolean(body.estimatedIncomeUnknown);
    if (parsed === "invalid") return { fields, error: "estimatedIncomeUnknown must be a boolean" };
    fields.estimatedIncomeUnknown = parsed;
  }
  {
    const effectiveValue =
      fields.estimatedIncomeCents !== undefined ? fields.estimatedIncomeCents : existing?.estimatedIncomeCents ?? null;
    const effectiveUnknown =
      fields.estimatedIncomeUnknown !== undefined ? fields.estimatedIncomeUnknown : existing?.estimatedIncomeUnknown ?? false;
    const err = checkTriStateCoherence(effectiveValue, effectiveUnknown, "Estimated income");
    if (err) return { fields, error: err };
  }

  // ── proposed date (tri-state pair) ─────────────────────────────────────
  if (body.proposedDate !== undefined) {
    if (body.proposedDate !== null && !isValidDateString(body.proposedDate)) {
      return { fields, error: "proposedDate must be a valid date in YYYY-MM-DD format, or null" };
    }
    fields.proposedDate = body.proposedDate === null ? null : (body.proposedDate as string);
  }
  if (body.proposedDateUnknown !== undefined) {
    const parsed = parseBoolean(body.proposedDateUnknown);
    if (parsed === "invalid") return { fields, error: "proposedDateUnknown must be a boolean" };
    fields.proposedDateUnknown = parsed;
  }
  {
    const effectiveValue = fields.proposedDate !== undefined ? fields.proposedDate : existing?.proposedDate ?? null;
    const effectiveUnknown =
      fields.proposedDateUnknown !== undefined ? fields.proposedDateUnknown : existing?.proposedDateUnknown ?? false;
    const err = checkTriStateCoherence(effectiveValue, effectiveUnknown, "Proposed date");
    if (err) return { fields, error: err };
  }

  // ── volunteers needed (tri-state pair) ─────────────────────────────────
  if (body.volunteersNeeded !== undefined) {
    const parsed = parseNonNegativeInt(body.volunteersNeeded);
    if (parsed === "invalid") return { fields, error: "volunteersNeeded must be a non-negative integer, or null" };
    fields.volunteersNeeded = parsed;
  }
  if (body.volunteersNeededUnknown !== undefined) {
    const parsed = parseBoolean(body.volunteersNeededUnknown);
    if (parsed === "invalid") return { fields, error: "volunteersNeededUnknown must be a boolean" };
    fields.volunteersNeededUnknown = parsed;
  }
  {
    const effectiveValue =
      fields.volunteersNeeded !== undefined ? fields.volunteersNeeded : existing?.volunteersNeeded ?? null;
    const effectiveUnknown =
      fields.volunteersNeededUnknown !== undefined ? fields.volunteersNeededUnknown : existing?.volunteersNeededUnknown ?? false;
    const err = checkTriStateCoherence(effectiveValue, effectiveUnknown, "Volunteers needed");
    if (err) return { fields, error: err };
  }

  if (body.clubResourcesNeeded !== undefined) {
    const parsed = parseTrimmedString(body.clubResourcesNeeded, CLUB_RESOURCES_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "clubResourcesNeeded must be a string" };
    fields.clubResourcesNeeded = parsed;
  }

  if (body.publicityPlan !== undefined) {
    const parsed = parseTrimmedString(body.publicityPlan, PUBLICITY_PLAN_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "publicityPlan must be a string" };
    fields.publicityPlan = parsed;
  }

  if (body.additionalNotes !== undefined) {
    const parsed = parseTrimmedString(body.additionalNotes, ADDITIONAL_NOTES_MAX_LEN);
    if (parsed === "invalid") return { fields, error: "additionalNotes must be a string" };
    fields.additionalNotes = parsed;
  }

  return { fields };
}

// ── HTML escaping for outbound email ────────────────────────────────────
/**
 * Escapes member-supplied free text before it is interpolated into an email
 * body. Mirrors the `esc()` helper in `src/app/api/suggestions/route.ts` —
 * lifted here because THREE proposal email builders need it, across two
 * route files.
 *
 * This is load-bearing, not defensive dressing: a proposal's project name,
 * need description, chair name, and the board's decision note are all
 * free text typed by a person, and the board notification is delivered to
 * `board@westervillelions.org` — every board member at once. Unescaped, a
 * stray `<` silently swallows the rest of a line in an HTML mail client, and
 * a deliberate `<a href>` would let a member put an arbitrary link inside an
 * email that looks like it came from the club.
 *
 * Values derived from enums or numbers (status labels, money/date summaries,
 * type labels) are generated by this codebase and do NOT need escaping —
 * escaping them anyway would double-encode legitimate punctuation.
 */
export function escapeProposalHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

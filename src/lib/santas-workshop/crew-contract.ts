/**
 * CARRIER for the worker (crew) API under /api/santas-workshop/crew/[slug]/**
 * (Phase 3, "API contract"). Client-safe: NO database, server-only or Node imports.
 * The crew app imports every request/response type and every vocabulary it
 * branches on from here, so removing or widening a member breaks `tsc` including
 * every client consumer. Precedent: src/lib/ledger-correction.ts.
 *
 * Least data: a crew DTO NEVER carries a buyer email or mobile, a Zeffy id, or
 * an admin-only field (crew-contract-no-contact.test.ts scans this file).
 * `parentName`, `snack`, `careNote` and `noteToSanta` appear ONLY in the view
 * cards that need them (the tag card shows the parent name; the check-in card
 * the snack and care note; the portrait card the note to Santa).
 *
 * Errors are `{ error, code, ... }`. Consume `code` with an exhaustive `switch`
 * and a `never` check (the DECISION-102/103 pattern), not a ternary.
 */

import { STUFFY_STATES, type StuffyState } from "./state-machine";
import { PHOTO_KINDS, type PhotoKind } from "./photo-limits";

export { STUFFY_STATES, PHOTO_KINDS };
export type { StuffyState, PhotoKind };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const CREW_ERROR_CODES = [
  "crew_auth_required",
  "throttled",
  "invalid_input",
  "not_found",
  "stale_state",
  "withdrawn",
  "illegal_transition",
  "confirm_move",
  "confirm_replace",
  "holder_advanced",
  "tag_already_bound",
  "portrait_exists",
  "pickup_check_required",
  "name_not_shown",
  "already_picked_up",
  "practice_only",
  "too_large",
  "quota_exceeded",
  "not_jpeg",
  "rate_limited",
  "storage_unavailable",
  "storage_misconfigured",
  "storage_full",
  "storage_rate_limited",
  "server_error",
] as const;
export type CrewErrorCode = (typeof CREW_ERROR_CODES)[number];

type Plain<C extends CrewErrorCode> = { error: string; code: C };

/** Sent only when the cookie signature was valid: the holder already proved they had the code. */
export type CrewAuthReason = "paused" | "closed" | "signed_out";

export interface CrewAuthBody extends Plain<"crew_auth_required"> {
  reason?: CrewAuthReason;
}
export interface StaleStateBody extends Plain<"stale_state"> {
  currentState: StuffyState;
  /** ISO instant of the stuffy's last change. */
  since: string;
}
export interface ConfirmMoveBody extends Plain<"confirm_move"> {
  otherStuffyName: string;
}
export interface ConfirmReplaceBody extends Plain<"confirm_replace"> {
  /** Last four characters of the sticker currently bound. */
  oldLast4: string;
}
export interface HolderAdvancedBody extends Plain<"holder_advanced"> {
  otherStuffyName: string;
}
export interface AlreadyPickedUpBody extends Plain<"already_picked_up"> {
  at: string;
}
export interface StorageErrorBody {
  error: string;
  code: "storage_unavailable" | "storage_misconfigured" | "storage_full" | "storage_rate_limited";
  /** True: keep the photo in the phone outbox and retry. False: stop auto-retry and tell the chair. */
  retryable: boolean;
}
export type SimpleErrorBody = Plain<
  Exclude<
    CrewErrorCode,
    | "crew_auth_required"
    | "stale_state"
    | "confirm_move"
    | "confirm_replace"
    | "holder_advanced"
    | "already_picked_up"
    | "storage_unavailable"
    | "storage_misconfigured"
    | "storage_full"
    | "storage_rate_limited"
  >
>;

export type CrewErrorBody =
  | CrewAuthBody
  | StaleStateBody
  | ConfirmMoveBody
  | ConfirmReplaceBody
  | HolderAdvancedBody
  | AlreadyPickedUpBody
  | StorageErrorBody
  | SimpleErrorBody;

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export interface CrewSessionSummary {
  name: string;
  kind: "practice" | "real";
  status: "draft" | "active" | "closed" | "purged";
  windows: { id: string; label: string; start: string; end: string }[];
  /** Whether this credential is an admin (the app shows the practice-only revert button on practice sessions). */
  admin: boolean;
}

export interface CrewRosterRow {
  id: string;
  /** Raw name; the app shows "Unnamed stuffy, order of N" when null. */
  name: string | null;
  /** First 80 characters. */
  description: string | null;
  state: StuffyState;
  windowId: string | null;
  orderId: string;
  orderSize: number;
  /** Last four characters of the bound sticker, or null. Never a link. */
  last4: string | null;
  /** The grey "Refunded" badge (full refund or removed payment). Never an amount or a reason. */
  refundBadge: boolean;
  /** True while the chair is checking this registration's details ("details being checked"). */
  detailsBeingChecked: boolean;
  hasCheckInPhoto: boolean;
  hasPortrait: boolean;
}

export interface CrewRosterResponse {
  /** ISO instant, so the client can show "Updated 12 s ago". */
  serverTime: string;
  session: CrewSessionSummary;
  stuffies: CrewRosterRow[];
}

export interface CrewSearchResponse {
  stuffies: CrewRosterRow[];
}

// ---------------------------------------------------------------------------
// View cards (least data per screen)
// ---------------------------------------------------------------------------

export const CREW_VIEWS = ["tag", "checkin", "portrait", "pickup"] as const;
export type CrewView = (typeof CREW_VIEWS)[number];

interface CardBase {
  id: string;
  name: string | null;
  description: string | null;
  state: StuffyState;
  windowLabel: string | null;
  refundBadge: boolean;
}

export interface CrewTagCard extends CardBase {
  view: "tag";
  /** Shown on the tag card so the worker can confirm the family at the table. */
  parentName: string | null;
  orderSize: number;
  last4: string | null;
}

export interface CrewCheckInCard extends CardBase {
  view: "checkin";
  snack: string | null;
  careNote: string | null;
}

export interface CrewPortraitCard extends CardBase {
  view: "portrait";
  noteToSanta: string | null;
  /** The check-in photo's id for the photo door, or null. */
  checkInPhotoId: string | null;
  hasPortrait: boolean;
}

export interface CrewPickupCard extends CardBase {
  view: "pickup";
  hasPortrait: boolean;
  checkInPhotoId: string | null;
  /** The current, unhidden portrait for the photo door; null when none or hidden. */
  portraitPhotoId: string | null;
  pickedUpAt: string | null;
}

export type CrewViewCard = CrewTagCard | CrewCheckInCard | CrewPortraitCard | CrewPickupCard;

// ---------------------------------------------------------------------------
// Requests and responses
// ---------------------------------------------------------------------------

/** Header the phone outbox sets on a photo upload retry: 1 for the first try, rising on each retry. */
export const SW_ATTEMPT_HEADER = "x-sw-attempt";

export interface EnterRequest {
  code: string;
}
export interface EnterResponse {
  ok: true;
}

export interface ScanRequest {
  /** The decoded sticker text. In the body, never in a URL. */
  code: string;
}

/** Consume with an exhaustive switch and a `never` check. */
export type ScanResult =
  | { result: "found"; stuffy: CrewRosterRow }
  | { result: "not_tagged" }
  | { result: "retired" }
  | { result: "withdrawn" };

export interface TagRequest {
  tagCode: string;
  expectedState: StuffyState;
  /** The tag currently bound to this stuffy as the client last saw it (null if none). */
  expectedTagCode: string | null;
  /** The last four characters of the sticker the screen saw (`last4` on the roster row and cards). When sent it replaces `expectedTagCode`: use it to replace or confirm a sticker on an already tagged stuffy. */
  expectedLast4?: string | null;
  confirm?: "move" | "replace";
  idempotencyKey: string;
  clientTakenAt?: string;
}

export interface CheckInMeta {
  /** Also the idempotency key. */
  photoId: string;
  expectedState: "tagged";
  takenAt: string;
  width: number;
  height: number;
  /** The worker tapped Continue on the refunded banner: recorded in the history. */
  refundContinue?: boolean;
}

export interface CheckInWithoutPhotoRequest {
  withoutPhoto: true;
  expectedState: "tagged";
  idempotencyKey: string;
  refundContinue?: boolean;
}

export interface PortraitMeta {
  photoId: string;
  expectedState: "checked_in" | "portrait_taken";
  takenAt: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  /** Must be true when a current portrait already exists (else 409 portrait_exists). */
  replace?: boolean;
}

export interface GroupPhotoMeta {
  photoId: string;
  takenAt: string;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
}

export interface PickupCheckRequest {
  result: "matched" | "someone_else";
  /** Free text about who collected; at most 500 characters. Cleared at the personal purge. */
  note?: string;
  idempotencyKey: string;
}
/** POST pickup-name { idempotencyKey }: the ONLY response besides the tag card that carries a parent name. */
export interface PickupNameRequest {
  idempotencyKey: string;
}
export interface PickupNameResponse {
  parentName: string | null;
}
/** The pickup-check response no longer carries the name (it is refused with `name_not_shown` until pickup-name was called). */
export interface PickupCheckResponse {
  recorded: true;
}

export interface PickupRequest {
  expectedState: "checked_in" | "portrait_taken";
  idempotencyKey: string;
}
export interface PickupResponse {
  pickedUpAt: string;
  /** Path of the family page. */
  familyUrl: string;
  replayed: boolean;
}

export interface RevertRequest {
  toState: StuffyState;
  expectedState: StuffyState;
}

/** The result of tag, check-in, portrait and revert. */
export interface CrewActionResponse {
  ok: true;
  /** True when the idempotency key had already been applied. */
  replayed: boolean;
  stuffy: CrewRosterRow;
}

export interface GroupPhotoResponse {
  ok: true;
  photoId: string;
  replayed: boolean;
}

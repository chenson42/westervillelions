/**
 * Plain-words microcopy for the worker (crew) app: one sentence for every failure
 * code of the crew contract, with a few per-action refinements. Pure and
 * client-safe. The worker never sees the name of the photo storage service, a raw
 * server error or a status number; when storage fails the sentence is always
 * "Photos can't be saved right now. They're kept on this phone. Tell the chair."
 *
 * Exhaustive on purpose: adding a code to CREW_ERROR_CODES breaks `tsc` here,
 * and crew-messages.test.ts fails if any code lacks a sentence.
 */

import {
  CREW_ERROR_CODES,
  type CrewAuthReason,
  type CrewErrorBody,
  type CrewErrorCode,
} from "@/lib/santas-workshop/crew-contract";

export type CrewAction =
  | "enter"
  | "roster"
  | "search"
  | "scan"
  | "view"
  | "tag"
  | "check_in"
  | "portrait"
  | "group_photo"
  | "pickup_check"
  | "pickup"
  | "revert";

export const NETWORK_FAILURE_MESSAGE = "No connection right now. Check your Wi-Fi or signal and try again.";

export const STORAGE_DOWN_MESSAGE = "Photos can't be saved right now. They're kept on this phone. Tell the chair.";

export const AUTH_REASON_MESSAGES: Record<CrewAuthReason, string> = {
  paused: "The event chair has paused worker access for now. Wait for the go-ahead, then enter the code again.",
  closed: "Worker access is closed for this session.",
  signed_out: "The worker code was changed, so this phone was signed out. Ask the event chair for the new code.",
};

/** The default sentence for each code, used when no per-action refinement applies. */
export const CREW_FAILURE_COPY: Record<CrewErrorCode, string> = {
  crew_auth_required: "Enter the worker code to keep going.",
  throttled: "That code didn't work. Ask the event chair. Wait a few minutes.",
  invalid_input: "Something on that screen needs a second look. Check it and try again.",
  not_found: "That stuffy isn't on this list. Pull down to refresh, or ask the event chair.",
  stale_state: "Someone else just changed this stuffy. The card has been refreshed. Look it over and try again.",
  withdrawn: "This registration was withdrawn. Ask the event chair before going on.",
  illegal_transition: "That step can't happen yet for this stuffy. The card shows where it is now.",
  confirm_move: "That sticker is already on another stuffy.",
  confirm_replace: "This stuffy already has a different sticker.",
  holder_advanced: "That sticker belongs to a stuffy that is already checked in. Ask the event chair.",
  tag_already_bound: "That sticker was just put on another stuffy by someone else. Refresh the list and check it.",
  portrait_exists: "A portrait was just taken for this stuffy by someone else. Look at it, then retake if you need to.",
  pickup_check_required: "Confirm the parent's name first, then mark the stuffy picked up.",
  name_not_shown: "Show the name on the order first, then confirm who is collecting.",
  already_picked_up: "Already picked up.",
  practice_only: "Going back a step is only for practice sessions. Ask the event chair.",
  too_large: "That photo is too big to send. Take it again.",
  quota_exceeded: "The photo storage for this event is full. Tell the chair. Check in without a photo for now.",
  not_jpeg: "That photo couldn't be read. Take it again with the camera.",
  rate_limited: "Too many photos at once. Wait a moment, they will go on their own.",
  storage_unavailable: STORAGE_DOWN_MESSAGE,
  storage_misconfigured: STORAGE_DOWN_MESSAGE,
  storage_full: STORAGE_DOWN_MESSAGE,
  storage_rate_limited: "Photo saving is busy. Your photos are kept on this phone and will go in a moment.",
  server_error: "Something went wrong on our side. Try again, and tell the chair if it keeps happening.",
};

/** Per-action refinements of the default sentence. Anything not listed uses CREW_FAILURE_COPY. */
const ACTION_COPY: Partial<Record<CrewAction, Partial<Record<CrewErrorCode, string>>>> = {
  enter: {
    crew_auth_required: "That code didn't work. Ask the event chair.",
    invalid_input: "Type the whole code, letters and numbers, then try again.",
    server_error: "The code couldn't be checked just now. Try again in a moment.",
  },
  scan: {
    invalid_input: "That sticker couldn't be read. Try again, or type the code under it.",
  },
  tag: {
    not_found: "That stuffy isn't on this list. Refresh the list and try again.",
    illegal_transition: "This stuffy is already past the tagging step. The card shows where it is now.",
  },
  check_in: {
    illegal_transition: "This stuffy can't be checked in from where it is. The card shows where it is now.",
    stale_state: "This stuffy was already checked in by someone else. The card has been refreshed.",
  },
  portrait: {
    illegal_transition: "This stuffy has to be checked in before its portrait. The card shows where it is now.",
  },
  group_photo: {
    stale_state: "That photo couldn't be filed. Take it again.",
  },
  pickup: {
    illegal_transition: "This stuffy can't be picked up from where it is. The card shows where it is now.",
  },
  pickup_check: {
    illegal_transition: "This stuffy can't be picked up from where it is. The card shows where it is now.",
  },
  revert: {
    illegal_transition: "That stuffy can't go back to that step.",
  },
};

function sentence(code: CrewErrorCode, action: CrewAction): string {
  return ACTION_COPY[action]?.[code] ?? CREW_FAILURE_COPY[code];
}

/**
 * The one sentence shown for a failed crew call. `body` is null for a network
 * failure or an unreadable reply. Exhaustive over the body union.
 */
export function crewFailureMessage(body: CrewErrorBody | null, action: CrewAction): string {
  if (!body) return NETWORK_FAILURE_MESSAGE;
  switch (body.code) {
    case "crew_auth_required":
      // At the code screen the server's uniform sentence is the answer (wrong, rotated, paused, closed and unknown all read alike).
      if (action === "enter") return body.error || sentence("crew_auth_required", action);
      return body.reason ? AUTH_REASON_MESSAGES[body.reason] : sentence("crew_auth_required", action);
    case "throttled":
      // The server's sentence already carries the wait; show it as written.
      return body.error || CREW_FAILURE_COPY.throttled;
    case "confirm_move":
      return `That sticker is already on ${quoted(body.otherStuffyName)}.`;
    case "confirm_replace":
      return `This stuffy already has a sticker ending in ${body.oldLast4}.`;
    case "holder_advanced":
      return `That sticker belongs to ${quoted(body.otherStuffyName)}, who is already checked in. Ask the event chair.`;
    case "already_picked_up":
      return "Already picked up.";
    case "storage_unavailable":
    case "storage_misconfigured":
    case "storage_full":
    case "storage_rate_limited":
      return sentence(body.code, action);
    case "invalid_input":
    case "not_found":
    case "stale_state":
    case "withdrawn":
    case "illegal_transition":
    case "tag_already_bound":
    case "portrait_exists":
    case "pickup_check_required":
    case "name_not_shown":
    case "practice_only":
    case "too_large":
    case "quota_exceeded":
    case "not_jpeg":
    case "rate_limited":
    case "server_error":
      return sentence(body.code, action);
    default: {
      const never: never = body;
      return String(never);
    }
  }
}

function quoted(name: string): string {
  return name && name.trim() ? `“${name}”` : "another stuffy";
}

export function isCrewErrorCode(value: unknown): value is CrewErrorCode {
  return typeof value === "string" && (CREW_ERROR_CODES as readonly string[]).includes(value);
}

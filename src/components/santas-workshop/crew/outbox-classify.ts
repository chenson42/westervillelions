/**
 * Turns the answer to a photo upload into what the outbox does next. Pure and
 * exhaustive over the crew contract's error codes (a new code breaks `tsc`).
 *
 *   retry   keep the photo, same photo id, back off: no connection, a 5xx, rate limits,
 *           a storage hiccup the server marked `retryable`
 *   stop    halt automatic retry for everything: storage not set up / full / the event's quota
 *   stale   the stuffy moved on while the photo waited: park it, a person decides
 *   reject  this photo can never be accepted (too large, not a JPEG, bad request): park it
 *   auth    the worker code stopped working: hold the queue, return to the code screen
 */

import type { CrewErrorBody } from "@/lib/santas-workshop/crew-contract";
import { AUTH_REASON_MESSAGES, STORAGE_DOWN_MESSAGE, crewFailureMessage, type CrewAction } from "./crew-messages";
import type { SendOutcome } from "./outbox-core";

export function classifyUpload(
  result: { ok: true } | { ok: false; status: number; body: CrewErrorBody | null },
  action: CrewAction,
): SendOutcome {
  if (result.ok) return { kind: "sent" };
  const { body, status } = result;
  if (!body) {
    // No readable answer: offline, a proxy page, or a crash. Worth retrying.
    return { kind: "retry" };
  }
  const message = crewFailureMessage(body, action);
  switch (body.code) {
    case "crew_auth_required":
      return { kind: "auth", message: body.reason ? AUTH_REASON_MESSAGES[body.reason] : message };
    case "throttled":
    case "rate_limited":
    case "storage_rate_limited":
    case "server_error":
      return { kind: "retry" };
    case "storage_unavailable":
      return body.retryable ? { kind: "retry" } : { kind: "stop", message: STORAGE_DOWN_MESSAGE };
    case "storage_misconfigured":
    case "storage_full":
      return { kind: "stop", message: STORAGE_DOWN_MESSAGE };
    case "quota_exceeded":
      return { kind: "stop", message };
    case "stale_state":
      return { kind: "stale", message };
    case "invalid_input":
    case "not_found":
    case "withdrawn":
    case "illegal_transition":
    case "confirm_move":
    case "confirm_replace":
    case "holder_advanced":
    case "tag_already_bound":
    case "portrait_exists":
    case "pickup_check_required":
    case "name_not_shown":
    case "already_picked_up":
    case "practice_only":
    case "too_large":
    case "not_jpeg":
      // A 5xx that carries one of these would be a server bug; treat an unexpected 5xx as retryable.
      return status >= 500 ? { kind: "retry" } : { kind: "reject", message };
    default: {
      const never: never = body;
      return { kind: "reject", message: String(never) };
    }
  }
}

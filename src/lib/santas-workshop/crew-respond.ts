/**
 * Maps a stuffy-transitions result to the crew HTTP response, and builds the
 * WriteContext from the credential. Server-only. Every success returns the
 * least-data CrewRosterRow (never contact data).
 */

import type { NextResponse } from "next/server";
import type { SwSession } from "@/lib/db/schema";
import type { CrewCredential } from "./crew-auth";
import type { CrewActionResponse } from "./crew-contract";
import { alreadyPickedUp, confirmMove, confirmReplace, crewError, crewOk, holderAdvanced, staleState } from "./crew-http";
import { getCrewRow } from "./crew-queries";
import type { TransitionFailure, TransitionResult, WriteContext } from "./stuffy-transitions";
import type { UploadRefusal } from "./photo-service";

export function writeContextFor(credential: CrewCredential, session: SwSession): WriteContext {
  return {
    sessionId: session.id,
    sessionKind: session.kind === "practice" ? "practice" : "real",
    actor:
      credential.kind === "crew"
        ? { kind: "crew", deviceId: credential.deviceId, codeVersion: credential.codeVersion }
        : { kind: "admin", userId: credential.userId },
  };
}

export function failureResponse(f: TransitionFailure): NextResponse {
  switch (f.code) {
    case "not_found":
      return crewError(404, "not_found", "That stuffy is not on this list");
    case "stale_state":
      return staleState(f.currentState, f.since);
    case "withdrawn":
      return crewError(409, "withdrawn", "That registration was withdrawn. Ask the event chair.");
    case "illegal_transition":
      return crewError(409, "illegal_transition", "That step is not available from where this stuffy is.");
    case "already_picked_up":
      return alreadyPickedUp(f.at);
    case "pickup_check_required":
      return crewError(409, "pickup_check_required", "Confirm the parent's name first.");
    case "name_not_shown":
      return crewError(409, "name_not_shown", "Show the name on the order first.");
    case "portrait_exists":
      return crewError(409, "portrait_exists", "A portrait already exists. Retake to replace it.");
    case "practice_only":
      return crewError(403, "practice_only", "Going backward is only available on a practice session.");
    case "confirm_move":
      return confirmMove(f.otherStuffyName);
    case "confirm_replace":
      return confirmReplace(f.oldLast4);
    case "holder_advanced":
      return holderAdvanced(f.otherStuffyName);
    case "tag_already_bound":
      return crewError(409, "tag_already_bound", "That sticker was just put on another stuffy.");
    case "withdraw_not_allowed":
      return crewError(409, "illegal_transition", "That step is not available from where this stuffy is.");
    case "invalid_input":
      return crewError(400, "invalid_input", f.error);
    default: {
      const _never: never = f;
      return _never;
    }
  }
}

export function refusalResponse(r: UploadRefusal): NextResponse {
  switch (r.code) {
    case "too_large":
      return crewError(413, "too_large", r.error);
    case "quota_exceeded":
      return crewError(413, "quota_exceeded", r.error);
    case "not_jpeg":
      return crewError(415, "not_jpeg", r.error);
    case "rate_limited":
      return crewError(429, "rate_limited", r.error);
    case "invalid_input":
      return crewError(400, "invalid_input", r.error);
    default: {
      const _never: never = r.code;
      return _never;
    }
  }
}

export async function transitionResponse(sessionId: string, result: TransitionResult): Promise<NextResponse> {
  if (!result.ok) return failureResponse(result);
  const stuffy = await getCrewRow(sessionId, result.stuffy.id);
  if (!stuffy) return crewError(404, "not_found", "That stuffy is not on this list");
  const body: CrewActionResponse = { ok: true, replayed: result.replayed, stuffy };
  return crewOk(body);
}

/**
 * Response helpers for the /api/santas-workshop/** handlers. Every crew response
 * is `Cache-Control: no-store` and `X-Robots-Tag: noindex`; errors use the
 * `{ error, code, ... }` envelope of crew-contract.ts. Server-only.
 */

import { NextResponse } from "next/server";
import type {
  AlreadyPickedUpBody,
  ConfirmMoveBody,
  ConfirmReplaceBody,
  CrewAuthReason,
  CrewErrorBody,
  CrewErrorCode,
  HolderAdvancedBody,
  SimpleErrorBody,
  StaleStateBody,
  StorageErrorBody,
} from "./crew-contract";
import { isStorageError } from "./photo-store/errors";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

export function crewOk<T>(body: T, status: 200 | 201 = 200, extraHeaders: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { ...HEADERS, ...extraHeaders } });
}

export function crewJsonError(status: number, body: CrewErrorBody): NextResponse {
  return NextResponse.json(body, { status, headers: HEADERS });
}

type SimpleCode = SimpleErrorBody["code"];

export function crewError(status: number, code: SimpleCode, error: string): NextResponse {
  return crewJsonError(status, { error, code });
}

export const AUTH_REQUIRED_MESSAGE = "Enter the worker code to continue";

/** One identical body for wrong, absent, forged and unknown-slug; `reason` only after a valid signature. */
export function crewAuthRequired(reason?: CrewAuthReason): NextResponse {
  return crewJsonError(401, reason ? { error: AUTH_REQUIRED_MESSAGE, code: "crew_auth_required", reason } : { error: AUTH_REQUIRED_MESSAGE, code: "crew_auth_required" });
}

export function staleState(currentState: StaleStateBody["currentState"], since: Date): NextResponse {
  return crewJsonError(409, { error: "This changed while you were working. Refresh and check the card.", code: "stale_state", currentState, since: since.toISOString() });
}

export function confirmMove(otherStuffyName: string): NextResponse {
  const body: ConfirmMoveBody = { error: "That sticker is already on another stuffy.", code: "confirm_move", otherStuffyName };
  return crewJsonError(409, body);
}

export function confirmReplace(oldLast4: string): NextResponse {
  const body: ConfirmReplaceBody = { error: "This stuffy already has a different sticker.", code: "confirm_replace", oldLast4 };
  return crewJsonError(409, body);
}

export function holderAdvanced(otherStuffyName: string): NextResponse {
  const body: HolderAdvancedBody = { error: "That sticker belongs to a stuffy that is already checked in. Ask the event chair.", code: "holder_advanced", otherStuffyName };
  return crewJsonError(409, body);
}

export function alreadyPickedUp(at: Date): NextResponse {
  const body: AlreadyPickedUpBody = { error: "Already picked up.", code: "already_picked_up", at: at.toISOString() };
  return crewJsonError(409, body);
}

/** Maps a thrown photo-store failure to the 503 body, or null for anything else. */
export function storageFailure(e: unknown): NextResponse | null {
  if (!isStorageError(e)) return null;
  const body: StorageErrorBody = {
    error: "Photos can't be saved right now.",
    code: e.code,
    retryable: e.retryable,
  };
  return crewJsonError(503, body);
}

/** Logs a failure by name and database code only: a driver message can carry query parameters (personal data). */
export function logCrewError(label: string, error: unknown): void {
  const e = error as { name?: string; code?: string; cause?: { code?: string } } | null;
  console.error(`santas-workshop crew ${label} failed`, { name: e?.name ?? "Error", code: e?.code ?? e?.cause?.code ?? null });
}

export function crewServerError(label: string, error: unknown): NextResponse {
  const storage = storageFailure(error);
  if (storage) return storage;
  logCrewError(label, error);
  return crewError(500, "server_error", "Something went wrong");
}

export type { CrewErrorCode };

/** The route's JSON body, or null when missing or invalid. Call only AFTER requireCrew(). */
export async function readCrewJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Worker code entry: the one crew route that does not call requireCrew(). Order:
 * throttle check -> verify the code (decrypt + timingSafeEqual) -> set the cookie.
 *
 * A wrong, revoked (rotated), paused, closed, draft or unknown-slug code answers
 * with the SAME body; only a throttle block adds "Wait a few minutes." Failures
 * are recorded against the hashed IP and, when the slug resolved, the session.
 * A successful entry does not clear counts. Requests that already carry a valid
 * cookie never come here (requireCrew answers them first), so an attacker
 * cannot lock the crew out. Dependencies are injected so the tests are hermetic.
 */

import type { SwSession } from "@/lib/db/schema";
import type { CrewAuthBody } from "./crew-contract";
import { checkCrewCode } from "./crew-code";
import { CREW_COOKIE_MAX_AGE_SECONDS, crewCookieHeader, crewCookieName, newDeviceId, readCookie, signCrewCookie, verifyCrewCookie } from "./crew-cookie";
import { evaluateCrewAccess, type SessionLookup } from "./crew-auth";
import { clientIp, ipScopeKey, isBlocked, recordFailure, sessionScopeKey, type AttemptStore } from "./crew-throttle";

export const WRONG_CODE_MESSAGE = "That code didn't work. Ask the event chair.";
export const THROTTLED_MESSAGE = `${WRONG_CODE_MESSAGE} Wait a few minutes.`;

export type EnterOutcome =
  | { ok: true; setCookie: string }
  | { ok: false; status: 401; body: CrewAuthBody }
  | { ok: false; status: 429; body: { error: string; code: "throttled" } };

export interface EnterDeps {
  loadSession(by: SessionLookup): Promise<SwSession | null>;
  attempts: AttemptStore;
  now(): Date;
  codeKey(): Buffer;
  cookieKey(): Buffer;
  ipKey(): Buffer;
  production(): boolean;
}

const wrong = (): EnterOutcome => ({ ok: false, status: 401, body: { error: WRONG_CODE_MESSAGE, code: "crew_auth_required" } });

export async function enterWithCode(
  request: Pick<Request, "headers">,
  slug: string,
  codeInput: unknown,
  deps: EnterDeps,
): Promise<EnterOutcome> {
  const now = deps.now();
  const ipKey = ipScopeKey(clientIp(request.headers), deps.ipKey());
  const session = await deps.loadSession({ slug });
  const keys = { ip: ipKey, session: session ? sessionScopeKey(session.id) : null };

  if (await isBlocked(deps.attempts, keys, now)) {
    return { ok: false, status: 429, body: { error: THROTTLED_MESSAGE, code: "throttled" } };
  }

  const fail = async (): Promise<EnterOutcome> => {
    await recordFailure(deps.attempts, keys, now);
    return wrong();
  };

  if (typeof codeInput !== "string" || codeInput.length === 0 || codeInput.length > 64) return fail();
  if (!session) return fail();
  // Same shape of failure for a session that cannot accept workers right now.
  const probe = { v: session.crewCodeVersion, e: Math.floor(now.getTime() / 1000) + 60 };
  const access = evaluateCrewAccess(session, { s: session.id, d: "x".repeat(22), ...probe }, now);
  if (!access.ok) return fail();

  if (checkCrewCode(session.crewCodeEnc, codeInput, deps.codeKey()) !== "match") return fail();

  // Re-entry on the same phone keeps its device id (history stays one device).
  const name = crewCookieName(session.id, deps.production());
  const existing = verifyCrewCookie(readCookie(request.headers.get("cookie"), name), deps.cookieKey());
  const deviceId = existing.ok && existing.payload.s === session.id ? existing.payload.d : newDeviceId();
  const exp = Math.floor(now.getTime() / 1000) + CREW_COOKIE_MAX_AGE_SECONDS;
  const value = signCrewCookie({ s: session.id, v: session.crewCodeVersion, d: deviceId, e: exp }, deps.cookieKey());
  return { ok: true, setCookie: crewCookieHeader(name, value, deps.production()) };
}

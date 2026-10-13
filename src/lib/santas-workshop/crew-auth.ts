/**
 * requireCrew(): the first awaited call of every crew handler except `enter`.
 *
 *   1. resolve the session row (indexed, by slug or id);
 *   2. a crew cookie for THAT session, with a valid signature, is RE-CHECKED against
 *      the row on every request: status active, not paused, code version, closing
 *      date (Eastern wall-clock string compare, inclusive), cookie expiry. Pause,
 *      rotate and close therefore take effect on the next request, no cron;
 *   3. otherwise fall back to `auth()` + hasFeature(SANTAS_WORKSHOP_MANAGE): an admin
 *      bypasses the code and the pause (lock-out-proof), on draft/paused/closed too;
 *   4. otherwise one identical 401. A `reason` is revealed only when the cookie
 *      signature was valid (the holder already proved they had the code).
 *
 * The crew cookie never populates `session.user` and no FEATURES check reads it.
 */

import type { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { swSessions, type SwSession } from "@/lib/db/schema";
import { easternDateString } from "@/lib/eastern-date";
import { FEATURES } from "@/lib/permissions";
import { hasFeature } from "@/lib/permissions-server";
import type { CrewAuthReason } from "./crew-contract";
import { crewCookieName, readCookie, verifyCrewCookie, type CrewCookiePayload } from "./crew-cookie";
import { crewAuthRequired, crewError } from "./crew-http";
import { isProductionEnv, purposeKey } from "./crew-secret";

export type CrewCredential =
  | { kind: "crew"; sessionId: string; deviceId: string; codeVersion: number }
  | { kind: "admin"; sessionId: string; deviceId: "admin"; userId: string };

export type SessionLookup = { slug: string } | { sessionId: string };

export type CrewGate = { ok: true; credential: CrewCredential; session: SwSession } | { ok: false; response: NextResponse };

export interface CrewAuthDeps {
  loadSession(by: SessionLookup): Promise<SwSession | null>;
  /** The signed-in admin's user id when they hold the manage key, else null. */
  adminUserId(): Promise<string | null>;
  now(): Date;
  cookieKey(): Buffer;
  production(): boolean;
}

export const defaultCrewAuthDeps: CrewAuthDeps = {
  async loadSession(by) {
    const where = "slug" in by ? eq(swSessions.slug, by.slug) : eq(swSessions.id, by.sessionId);
    const [row] = await db.select().from(swSessions).where(where).limit(1);
    return row ?? null;
  },
  async adminUserId() {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return null;
    return (await hasFeature(id, FEATURES.SANTAS_WORKSHOP_MANAGE)) ? id : null;
  },
  now: () => new Date(),
  cookieKey: () => purposeKey("cookie"),
  production: () => isProductionEnv(),
};

export type CrewAccess = { ok: true } | { ok: false; reason: CrewAuthReason };

/** The per-request authorization of a cookie whose signature already verified. Pure. */
export function evaluateCrewAccess(
  session: Pick<SwSession, "id" | "status" | "crewPaused" | "crewCodeVersion" | "crewClosesOn">,
  payload: CrewCookiePayload,
  now: Date,
): CrewAccess {
  if (session.status !== "active") return { ok: false, reason: "closed" };
  if (session.crewPaused) return { ok: false, reason: "paused" };
  if (easternDateString(now) > session.crewClosesOn) return { ok: false, reason: "closed" };
  if (payload.v !== session.crewCodeVersion) return { ok: false, reason: "signed_out" };
  if (payload.e * 1000 <= now.getTime()) return { ok: false, reason: "signed_out" };
  return { ok: true };
}

export async function requireCrew(
  request: Request,
  lookup: SessionLookup,
  deps: CrewAuthDeps = defaultCrewAuthDeps,
): Promise<CrewGate> {
  const session = await deps.loadSession(lookup);

  let revealReason: CrewAuthReason | undefined;
  if (session) {
    const name = crewCookieName(session.id, deps.production());
    const verdict = verifyCrewCookie(readCookie(request.headers.get("cookie"), name), deps.cookieKey());
    if (verdict.ok && verdict.payload.s === session.id) {
      const access = evaluateCrewAccess(session, verdict.payload, deps.now());
      if (access.ok) {
        return {
          ok: true,
          session,
          credential: { kind: "crew", sessionId: session.id, deviceId: verdict.payload.d, codeVersion: verdict.payload.v },
        };
      }
      revealReason = access.reason;
    }
  }

  const adminId = await deps.adminUserId();
  if (adminId) {
    if (!session) return { ok: false, response: crewError(404, "not_found", "Session not found") };
    return { ok: true, session, credential: { kind: "admin", sessionId: session.id, deviceId: "admin", userId: adminId } };
  }
  return { ok: false, response: crewAuthRequired(revealReason) };
}

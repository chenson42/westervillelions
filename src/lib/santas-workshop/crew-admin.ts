/**
 * Admin-side session status and worker-access management. Server-only.
 *
 * The worker code is stored encrypted (Ruling 2) so an admin can re-read it;
 * viewing it is logged (`code_viewed`, never the code). Rotation bumps
 * `crew_code_version`, which signs every phone out on its next request because
 * requireCrew re-reads the row each time. Every write is pinned on the state the
 * admin saw, so two admins cannot both win.
 */

import { and, eq, gte, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { swPhotos, swSessions, swStuffies, swStuffyEvents } from "@/lib/db/schema";
import type { CrewCodeResponse, SessionDto } from "./admin-contract";
import { decryptCrewCode, encryptCrewCode, formatCrewCode, generateCrewCode } from "./crew-code";
import { purposeKey } from "./crew-secret";
import { logSessionEvent } from "./session-log";
import { failure, getSessionRow, toSessionDto, type QueryFailure } from "./session-queries";
import { checkStatusChange, storageTestFresh, type SettableStatus } from "./session-status";
import { lastStorageTest } from "./storage-status";

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function setSessionStatus(
  sessionId: string,
  to: SettableStatus,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; session: SessionDto; noop: boolean } | QueryFailure> {
  const row = await getSessionRow(sessionId);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.personalPurgedAt || row.status === "purged") return failure(409, "session_purged", "A purged session cannot change status");

  const from = row.status as "draft" | "active" | "closed";
  const change = checkStatusChange(from, to);
  if (!change.ok) return failure(409, "invalid_transition", `A ${from} session cannot become ${to}`);
  if (change.noop) return { ok: true, session: toSessionDto(row), noop: true };

  if (to === "draft") {
    const [moved] = await db
      .select({ id: swStuffies.id })
      .from(swStuffies)
      .where(and(eq(swStuffies.sessionId, sessionId), ne(swStuffies.state, "registered")))
      .limit(1);
    const [photo] = await db.select({ id: swPhotos.id }).from(swPhotos).where(eq(swPhotos.sessionId, sessionId)).limit(1);
    if (moved || photo) return failure(409, "has_activity", "Stuffies have already been tagged or photographed");
  }

  const set: Partial<typeof swSessions.$inferInsert> = { status: to, updatedAt: now };
  if (to === "active") {
    if (row.kind === "real") {
      const test = await lastStorageTest();
      if (!storageTestFresh(test, now)) return failure(409, "storage_not_ready", "Run Test storage first: a real session needs a passing test in the last 10 minutes");
    }
    if (!row.crewCodeEnc) set.crewCodeEnc = encryptCrewCode(generateCrewCode(), purposeKey("code"));
  }

  const updated = await db
    .update(swSessions)
    .set(set)
    .where(and(eq(swSessions.id, sessionId), eq(swSessions.status, from)))
    .returning();
  if (updated.length === 0) return failure(409, "invalid_transition", "The session status changed while you were working. Refresh and try again.");
  await logSessionEvent(sessionId, userId, "status_changed", { from, to });
  return { ok: true, session: toSessionDto(updated[0]), noop: false };
}

// ---------------------------------------------------------------------------
// Worker code
// ---------------------------------------------------------------------------

/** Distinct crew devices that used the CURRENT code version in the last hour. */
export async function activeDevicesLastHour(sessionId: string, codeVersion: number, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - HOUR_MS);
  const events = await db
    .selectDistinct({ deviceId: swStuffyEvents.deviceId })
    .from(swStuffyEvents)
    .where(
      and(
        eq(swStuffyEvents.sessionId, sessionId),
        eq(swStuffyEvents.actorKind, "crew"),
        eq(swStuffyEvents.codeVersion, codeVersion),
        gte(swStuffyEvents.createdAt, since),
      ),
    );
  const photos = await db
    .selectDistinct({ deviceId: swPhotos.deviceId })
    .from(swPhotos)
    .where(and(eq(swPhotos.sessionId, sessionId), ne(swPhotos.deviceId, "admin"), gte(swPhotos.createdAt, since)));
  const seen = new Set<string>();
  for (const r of [...events, ...photos]) if (r.deviceId) seen.add(r.deviceId);
  return seen.size;
}

async function codeResponse(row: NonNullable<Awaited<ReturnType<typeof getSessionRow>>>, now: Date): Promise<CrewCodeResponse> {
  const code = decryptCrewCode(row.crewCodeEnc, purposeKey("code"));
  return {
    code,
    formatted: code ? formatCrewCode(code) : null,
    unreadable: row.crewCodeEnc !== null && code === null,
    version: row.crewCodeVersion,
    paused: row.crewPaused,
    activeDevicesLastHour: await activeDevicesLastHour(row.id, row.crewCodeVersion, now),
  };
}

export async function viewCrewCode(sessionId: string, userId: string, now: Date = new Date()): Promise<CrewCodeResponse | null> {
  const row = await getSessionRow(sessionId);
  if (!row) return null;
  const response = await codeResponse(row, now);
  await logSessionEvent(sessionId, userId, "code_viewed", { version: row.crewCodeVersion });
  return response;
}

export async function crewCodeAction(
  sessionId: string,
  action: "rotate" | "pause" | "resume",
  acknowledge: boolean,
  userId: string,
  now: Date = new Date(),
): Promise<{ ok: true; response: CrewCodeResponse } | QueryFailure> {
  const row = await getSessionRow(sessionId);
  if (!row) return failure(404, "not_found", "Session not found");
  if (row.personalPurgedAt || row.status === "purged") return failure(409, "session_purged", "A purged session cannot be changed");

  if (action === "pause" || action === "resume") {
    const paused = action === "pause";
    const updated = await db
      .update(swSessions)
      .set({ crewPaused: paused, updatedAt: now })
      .where(and(eq(swSessions.id, sessionId), eq(swSessions.crewCodeVersion, row.crewCodeVersion)))
      .returning();
    if (updated.length === 0) return failure(409, "invalid_transition", "Worker access changed while you were working. Refresh and try again.");
    await logSessionEvent(sessionId, userId, paused ? "code_paused" : "code_resumed", { version: row.crewCodeVersion });
    return { ok: true, response: await codeResponse(updated[0], now) };
  }

  // rotate
  const devices = await activeDevicesLastHour(sessionId, row.crewCodeVersion, now);
  if (devices > 0 && !acknowledge) {
    return failure(409, "devices_active", `${devices} phone${devices === 1 ? " is" : "s are"} using the current code`, undefined, { count: devices });
  }
  const updated = await db
    .update(swSessions)
    .set({ crewCodeEnc: encryptCrewCode(generateCrewCode(), purposeKey("code")), crewCodeVersion: row.crewCodeVersion + 1, updatedAt: now })
    .where(and(eq(swSessions.id, sessionId), eq(swSessions.crewCodeVersion, row.crewCodeVersion)))
    .returning();
  if (updated.length === 0) return failure(409, "invalid_transition", "Worker access changed while you were working. Refresh and try again.");
  await logSessionEvent(sessionId, userId, "code_rotated", { fromVersion: row.crewCodeVersion, toVersion: updated[0].crewCodeVersion, devices });
  return { ok: true, response: await codeResponse(updated[0], now) };
}

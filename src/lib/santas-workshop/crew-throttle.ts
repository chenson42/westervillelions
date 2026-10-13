/**
 * DB-backed throttle for worker code entry (the only throttled surface; Ruling 9
 * explains why collage and family tokens are not). Failures only are recorded;
 * a successful entry does not clear counts. Requests carrying a valid cookie
 * never reach this module (requireCrew answers them first), so an attacker cannot
 * lock the crew out.
 *
 * Limits: per IP-hash 5 failures / 10 min and 20 / 24 h; per session 30 / 10 min
 * across every IP. The stored scope key never holds a raw IP: `ip:<16 hex of
 * HMAC(AUTH_SECRET-derived key, ip)>` or `sess:<uuid>`.
 */

import { createHmac } from "node:crypto";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { swCrewAttempts } from "@/lib/db/schema";
import { purposeKey } from "./crew-secret";

export const THROTTLE = {
  ipShort: { limit: 5, windowMs: 10 * 60 * 1000 },
  ipDay: { limit: 20, windowMs: 24 * 60 * 60 * 1000 },
  sessionShort: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Rows older than this are deleted lazily on every failure insert. */
  sweepAfterMs: 2 * 24 * 60 * 60 * 1000,
} as const;

export interface AttemptStore {
  count(scopeKey: string, since: Date): Promise<number>;
  insert(scopeKeys: string[], at: Date): Promise<void>;
  sweep(before: Date): Promise<void>;
}

export function ipScopeKey(ip: string, key: Buffer = purposeKey("ip")): string {
  return `ip:${createHmac("sha256", key).update(ip).digest("hex").slice(0, 16)}`;
}

export const sessionScopeKey = (sessionId: string) => `sess:${sessionId}`;

/** First hop of x-forwarded-for (set by Vercel), used only as an HMAC input. */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

export async function isBlocked(
  store: AttemptStore,
  keys: { ip: string; session?: string | null },
  now: Date,
): Promise<boolean> {
  const since = (ms: number) => new Date(now.getTime() - ms);
  if ((await store.count(keys.ip, since(THROTTLE.ipShort.windowMs))) >= THROTTLE.ipShort.limit) return true;
  if ((await store.count(keys.ip, since(THROTTLE.ipDay.windowMs))) >= THROTTLE.ipDay.limit) return true;
  if (keys.session && (await store.count(keys.session, since(THROTTLE.sessionShort.windowMs))) >= THROTTLE.sessionShort.limit) return true;
  return false;
}

/** Records one failure against the IP and, when the slug resolved, the session. Also sweeps old rows. */
export async function recordFailure(
  store: AttemptStore,
  keys: { ip: string; session?: string | null },
  now: Date,
): Promise<void> {
  await store.insert(keys.session ? [keys.ip, keys.session] : [keys.ip], now);
  await store.sweep(new Date(now.getTime() - THROTTLE.sweepAfterMs));
}

export const dbAttemptStore: AttemptStore = {
  async count(scopeKey, since) {
    const [row] = await db
      .select({ n: count() })
      .from(swCrewAttempts)
      .where(and(eq(swCrewAttempts.scopeKey, scopeKey), gte(swCrewAttempts.createdAt, since)));
    return row?.n ?? 0;
  },
  async insert(scopeKeys, at) {
    await db.insert(swCrewAttempts).values(scopeKeys.map((scopeKey) => ({ scopeKey, createdAt: at })));
  },
  async sweep(before) {
    await db.delete(swCrewAttempts).where(lt(swCrewAttempts.createdAt, before));
  },
};

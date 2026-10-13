/**
 * Retention policy for Santa's Workshop (DECISION-125). PURE and client-safe:
 * no database, server-only or Node imports. The admin UI imports the vocabulary
 * and `retentionScopeStatus()` from here (re-exported by admin-contract.ts); the
 * server engine (retention.ts) uses the same function to decide whether a purge
 * may run, so the page and the route can never disagree.
 *
 * Two scopes, each with its own date and its own marker on the session:
 *   personal  parent and child personal data, raw form answers, notes, the stored
 *             webhook snapshot, check-in photos and superseded retakes.
 *             Default 30 days after pickup day.
 *   public    portraits and group photos (the collage and the family pages).
 *             Default January 31 of the following year.
 *
 * A scope is runnable when the event is over (the session is `closed`, OR the pickup day is at
 * least one day in the past, Eastern: nothing closes a session by itself, S5-N3) AND the Eastern
 * calendar day is on or after its date. Anything else is a blocker, overridable only by an admin
 * who gives a reason (`force`).
 */

import type { SessionStatus } from "./session-vocabulary";

export const RETENTION_SCOPES = ["personal", "public"] as const;
export type RetentionScope = (typeof RETENTION_SCOPES)[number];

export function isRetentionScope(v: unknown): v is RetentionScope {
  return typeof v === "string" && (RETENTION_SCOPES as readonly string[]).includes(v);
}

/** Why a scope cannot run without `force`. `session_open` means "the event has not finished yet". */
export const RETENTION_BLOCKERS = ["session_open", "before_date"] as const;
export type RetentionBlocker = (typeof RETENTION_BLOCKERS)[number];

/** purged: marker set. due: runnable now. blocked: needs `force` (see `blockers`). */
export const RETENTION_STATES = ["purged", "due", "blocked"] as const;
export type RetentionState = (typeof RETENTION_STATES)[number];

export interface RetentionScopeStatus {
  scope: RetentionScope;
  /** Eastern calendar day, "YYYY-MM-DD". */
  dueOn: string;
  /** ISO instant the scope finished, or null. */
  purgedAt: string | null;
  state: RetentionState;
  blockers: RetentionBlocker[];
}

export interface RetentionStatus {
  personal: RetentionScopeStatus;
  public: RetentionScopeStatus;
  /** Only a practice session can be reset. */
  canReset: boolean;
}

export const FORCE_REASON_MAX = 500;

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Closed, or the pickup day is at least one day in the past (string compare on Eastern days, never through UTC "now"). */
export function eventFinished(status: SessionStatus, pickupDate: string, today: string): boolean {
  return status === "closed" || status === "purged" || today >= nextDay(pickupDate);
}

export function retentionScopeStatus(input: {
  scope: RetentionScope;
  status: SessionStatus;
  /** The event's pickup day, "YYYY-MM-DD". */
  pickupDate: string;
  /** "YYYY-MM-DD" */
  dueOn: string;
  purgedAt: Date | null;
  /** The Eastern calendar day today, "YYYY-MM-DD". Compared as a string, never through UTC. */
  today: string;
}): RetentionScopeStatus {
  const base = { scope: input.scope, dueOn: input.dueOn, purgedAt: input.purgedAt ? input.purgedAt.toISOString() : null };
  if (input.purgedAt) return { ...base, state: "purged", blockers: [] };
  const blockers: RetentionBlocker[] = [];
  if (!eventFinished(input.status, input.pickupDate, input.today)) blockers.push("session_open");
  if (input.today < input.dueOn) blockers.push("before_date");
  return { ...base, state: blockers.length === 0 ? "due" : "blocked", blockers };
}

export function describeBlockers(blockers: readonly RetentionBlocker[], dueOn: string): string {
  const parts = blockers.map((b) => {
    switch (b) {
      case "session_open":
        return "the event has not finished yet";
      case "before_date":
        return `the date is ${dueOn}`;
      default: {
        const _never: never = b;
        return _never;
      }
    }
  });
  return parts.join(" and ");
}

export type ParsedForce = { ok: true; force: boolean; reason: string | null } | { ok: false; error: string; field: string };

/** `force` needs a reason (1 to 500 characters, trimmed); without `force` a reason is ignored. */
export function parseForce(body: { force?: unknown; reason?: unknown }): ParsedForce {
  if (body.force === undefined || body.force === false) return { ok: true, force: false, reason: null };
  if (body.force !== true) return { ok: false, error: "force must be true or false", field: "force" };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { ok: false, error: "Give a reason to run this early", field: "reason" };
  if (reason.length > FORCE_REASON_MAX) return { ok: false, error: `Keep the reason under ${FORCE_REASON_MAX} characters`, field: "reason" };
  return { ok: true, force: true, reason };
}

/** Both scopes and the reset flag for one session row (structural input so this file stays client-safe). */
export function retentionStatusFor(
  row: {
    kind: string;
    status: string;
    pickupDate: string;
    purgePersonalOn: string;
    purgePublicOn: string;
    personalPurgedAt: Date | null;
    publicPurgedAt: Date | null;
  },
  today: string,
): RetentionStatus {
  const status = row.status as SessionStatus;
  return {
    personal: retentionScopeStatus({ scope: "personal", status, pickupDate: row.pickupDate, dueOn: row.purgePersonalOn, purgedAt: row.personalPurgedAt, today }),
    public: retentionScopeStatus({ scope: "public", status, pickupDate: row.pickupDate, dueOn: row.purgePublicOn, purgedAt: row.publicPurgedAt, today }),
    canReset: row.kind === "practice",
  };
}

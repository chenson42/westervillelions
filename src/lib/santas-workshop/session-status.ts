/**
 * The session status transition table (pure, client-safe). The admin status
 * buttons are Draft / Active / Closed; "Paused" is the separate crew_paused flag
 * on the worker-access card (a pause keeps the session Active). `purged` is
 * terminal and is never a button.
 *
 *   draft  -> active   (activation generates the worker code; a REAL session also needs a recent storage test)
 *   draft  -> closed   (abandon)
 *   active -> closed
 *   active -> draft    (only while nothing has happened: the route checks `has_activity`)
 *   closed -> active   (reopen)
 *   closed -> draft    not allowed
 */

import type { SessionStatus } from "./session-vocabulary";

export const SETTABLE_STATUSES = ["draft", "active", "closed"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export function isSettableStatus(v: unknown): v is SettableStatus {
  return typeof v === "string" && (SETTABLE_STATUSES as readonly string[]).includes(v);
}

const ALLOWED: Record<SessionStatus, readonly SettableStatus[]> = {
  draft: ["active", "closed"],
  active: ["closed", "draft"],
  closed: ["active"],
  purged: [],
};

export type StatusChange = { ok: true; noop: boolean } | { ok: false; reason: "purged" | "not_allowed" };

export function checkStatusChange(from: SessionStatus, to: SettableStatus): StatusChange {
  if (from === "purged") return { ok: false, reason: "purged" };
  if (from === to) return { ok: true, noop: true };
  return ALLOWED[from].includes(to) ? { ok: true, noop: false } : { ok: false, reason: "not_allowed" };
}

/** A REAL session may be activated only after a successful storage test this recent. */
export const STORAGE_TEST_FRESH_MS = 10 * 60 * 1000;

export function storageTestFresh(test: { at: Date; ok: boolean } | null, now: Date): boolean {
  return !!test && test.ok && now.getTime() - test.at.getTime() <= STORAGE_TEST_FRESH_MS;
}

/** Validation of the Sync cursor the client posts back (it is client-supplied, so never trusted). */

import { isUuid } from "@/lib/utils";
import type { SyncCounts, SyncCursor } from "./admin-contract";

export function emptyCounts(): SyncCounts {
  return { newFromZeffy: 0, changed: 0, unchanged: 0, goneInZeffy: 0, refundDiffers: 0, skipped: 0 };
}

const COUNT_KEYS = Object.keys(emptyCounts()) as (keyof SyncCounts)[];

export function parseSyncCursor(body: unknown): { ok: true; cursor: SyncCursor | null } | { ok: false; error: string } {
  if (body === null || typeof body !== "object") return { ok: true, cursor: null };
  const raw = (body as { cursor?: unknown }).cursor;
  if (raw === undefined || raw === null) return { ok: true, cursor: null };
  if (typeof raw !== "object") return { ok: false, error: "cursor is not valid" };

  const c = raw as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, error });
  if (typeof c.startedAt !== "string" || Number.isNaN(Date.parse(c.startedAt))) return bad("cursor.startedAt is not valid");
  if (c.phase !== "list" && c.phase !== "stale") return bad("cursor.phase is not valid");
  if (c.startingAfter !== null && (typeof c.startingAfter !== "string" || c.startingAfter.length > 200)) return bad("cursor.startingAfter is not valid");
  if (c.staleAfterId !== null && (typeof c.staleAfterId !== "string" || !isUuid(c.staleAfterId))) return bad("cursor.staleAfterId is not valid");
  if (typeof c.processed !== "number" || !Number.isInteger(c.processed) || c.processed < 0) return bad("cursor.processed is not valid");

  const counts = emptyCounts();
  const rawCounts = (c.counts ?? {}) as Record<string, unknown>;
  for (const key of COUNT_KEYS) {
    const v = rawCounts[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return bad("cursor.counts is not valid");
    counts[key] = v;
  }
  return {
    ok: true,
    cursor: {
      startedAt: c.startedAt,
      phase: c.phase,
      startingAfter: c.startingAfter as string | null,
      staleAfterId: c.staleAfterId as string | null,
      counts,
      processed: c.processed,
    },
  };
}

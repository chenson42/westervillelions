/**
 * "Sync from Zeffy": pull a session's campaign, page by page, and push every
 * payment through applyPaymentSnapshot() (the webhook's write path). Server-only.
 *
 * Time-boxed and resumable (Phase 3): each call works for about SYNC_BUDGET_MS
 * and returns a cursor the client posts back, so no single request outlives a
 * serverless limit and a progress bar can run. Two phases:
 *
 *   list   GET /payments?campaign=...&status=succeeded, 100 per page, following
 *          next_cursor. A payment we have no order for is, by definition, a
 *          missed webhook (`newFromZeffy`).
 *   stale  every non-manual order whose snapshot_at is older than the run's
 *          start was NOT seen in the list: fetch it individually. A 404 flags
 *          the payment deleted (`goneInZeffy`). Every apply stamps snapshot_at,
 *          so no id list rides in the cursor.
 *
 * Rate limits (100/min, 20/s per organization, shared with webhook fetches):
 * the client is sequential with >= 700 ms spacing. A Retry-After longer than a
 * few seconds is returned to the caller as `retryAfterMs` (a NORMAL state, not
 * an error), never slept inside the request.
 */

import { and, asc, eq, gt, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { swOrders } from "@/lib/db/schema";
import type { SwSession } from "@/lib/db/schema";
import { createZeffyClient, ZeffyError, ZeffyRateLimitedError, type ZeffyClient } from "@/lib/zeffy/client";
import { toSnapshot } from "@/lib/zeffy/snapshot";
import type { ZeffyPayment } from "@/lib/zeffy/types";
import type { SyncCounts, SyncCursor, SyncResponse } from "./admin-contract";
import { applyPaymentSnapshot, markPaymentDeleted, type ApplyResult } from "./payment-apply";
import { emptyCounts } from "./sync-cursor";

export const SYNC_BUDGET_MS = 45_000;
const STALE_PAGE = 25;

export function newSyncCursor(now: Date): SyncCursor {
  return { startedAt: now.toISOString(), phase: "list", startingAfter: null, staleAfterId: null, counts: emptyCounts(), processed: 0 };
}

/** Folds one ApplyResult into the run's counts. Pure. */
export function countApplyResult(counts: SyncCounts, applied: ApplyResult): void {
  switch (applied.result) {
    case "applied": {
      if (applied.orderCreated) counts.newFromZeffy += 1;
      else if (applied.orderChanged || applied.created > 0 || applied.updated > 0 || applied.flaggedMissing > 0) counts.changed += 1;
      else counts.unchanged += 1;
      if (applied.refundChanged && !applied.orderCreated) counts.refundDiffers += 1;
      return;
    }
    case "stale":
      counts.unchanged += 1;
      return;
    case "not_succeeded":
    case "no_registrants":
    case "purged":
    case "session_mismatch":
    case "session_not_found":
      counts.skipped += 1;
      return;
    default: {
      const exhaustive: never = applied;
      return exhaustive;
    }
  }
}

export interface SyncDeps {
  client: Pick<ZeffyClient, "listPayments" | "getPayment">;
  apply: typeof applyPaymentSnapshot;
  markDeleted: typeof markPaymentDeleted;
  loadStaleOrders(sessionId: string, startedAt: Date, afterId: string | null): Promise<{ id: string; zeffyPaymentId: string }[]>;
  now(): Date;
  budgetMs?: number;
}

export function defaultSyncDeps(): SyncDeps {
  return {
    // A long Retry-After is handed back to the caller instead of slept.
    client: createZeffyClient({ maxRetryWaitMs: 5_000 }),
    apply: applyPaymentSnapshot,
    markDeleted: markPaymentDeleted,
    loadStaleOrders: async (sessionId, startedAt, afterId) => {
      const rows = await db
        .select({ id: swOrders.id, zeffyPaymentId: swOrders.zeffyPaymentId })
        .from(swOrders)
        .where(
          and(
            eq(swOrders.sessionId, sessionId),
            ne(swOrders.source, "manual"),
            isNotNull(swOrders.zeffyPaymentId),
            or(isNull(swOrders.snapshotAt), lt(swOrders.snapshotAt, startedAt)),
            afterId ? gt(swOrders.id, afterId) : undefined,
          ),
        )
        .orderBy(asc(swOrders.id))
        .limit(STALE_PAGE);
      return rows.map((r) => ({ id: r.id, zeffyPaymentId: r.zeffyPaymentId as string }));
    },
    now: () => new Date(),
  };
}

function response(cursor: SyncCursor, done: boolean, retryAfterMs?: number): SyncResponse {
  return {
    cursor: done ? null : cursor,
    progress: { phase: cursor.phase, processed: cursor.processed, counts: cursor.counts },
    done,
    ...(retryAfterMs ? { retryAfterMs } : {}),
  };
}

async function applyListed(payment: ZeffyPayment, session: SwSession, fetchedAt: Date, deps: SyncDeps, cursor: SyncCursor) {
  let source: ZeffyPayment = payment;
  let at = fetchedAt;
  // Whether a list item carries items[] and questions[] is settled by the S2 spike;
  // when it does not, the per-payment fetch is the fallback.
  if (!Array.isArray(payment.items)) {
    at = deps.now();
    const full = await deps.client.getPayment(payment.id);
    if (full.gone) {
      await deps.markDeleted(payment.id, at);
      cursor.counts.goneInZeffy += 1;
      return;
    }
    if (full.outOfScope) return;
    source = full.payment;
  }
  const parsed = toSnapshot(source);
  if (!parsed.ok) {
    cursor.counts.skipped += 1;
    return;
  }
  countApplyResult(cursor.counts, await deps.apply(parsed.snapshot, { sessionId: session.id, source: "sync", fetchedAt: at }));
}

/**
 * One time-boxed step. Throws ZeffyError (not configured, unauthorized, ...);
 * a rate limit is returned as `retryAfterMs`.
 */
export async function runSyncStep(
  session: Pick<SwSession, "id" | "zeffyCampaignId">,
  incoming: SyncCursor | null,
  deps: SyncDeps = defaultSyncDeps(),
): Promise<SyncResponse> {
  if (!session.zeffyCampaignId) throw new ZeffyError("campaign_required");
  const campaignId = session.zeffyCampaignId;
  const budget = deps.budgetMs ?? SYNC_BUDGET_MS;
  const began = deps.now().getTime();
  const cursor: SyncCursor = incoming ? { ...incoming, counts: { ...incoming.counts } } : newSyncCursor(deps.now());
  const startedAt = new Date(cursor.startedAt);
  const outOfTime = () => deps.now().getTime() - began >= budget;

  try {
    while (cursor.phase === "list") {
      if (outOfTime()) return response(cursor, false);
      const fetchedAt = deps.now();
      const page = await deps.client.listPayments({
        campaignId,
        startingAfter: cursor.startingAfter,
        limit: 100,
        status: "succeeded",
      });
      for (const payment of page.payments) {
        await applyListed(payment, session as SwSession, fetchedAt, deps, cursor);
        cursor.processed += 1;
      }
      if (page.hasMore && page.nextCursor) cursor.startingAfter = page.nextCursor;
      else {
        cursor.phase = "stale";
        cursor.startingAfter = null;
      }
    }

    for (;;) {
      if (outOfTime()) return response(cursor, false);
      const batch = await deps.loadStaleOrders(session.id, startedAt, cursor.staleAfterId);
      if (batch.length === 0) return response(cursor, true);
      for (const order of batch) {
        const fetchedAt = deps.now();
        const fetched = await deps.client.getPayment(order.zeffyPaymentId);
        if (fetched.gone) {
          await deps.markDeleted(order.zeffyPaymentId, fetchedAt);
          cursor.counts.goneInZeffy += 1;
        } else if (!fetched.outOfScope) {
          const parsed = toSnapshot(fetched.payment);
          if (parsed.ok) {
            countApplyResult(
              cursor.counts,
              await deps.apply(parsed.snapshot, { sessionId: session.id, source: "sync", fetchedAt }),
            );
          }
        }
        cursor.staleAfterId = order.id;
        cursor.processed += 1;
      }
    }
  } catch (e) {
    if (e instanceof ZeffyRateLimitedError) return response(cursor, false, e.retryAfterMs);
    throw e;
  }
}

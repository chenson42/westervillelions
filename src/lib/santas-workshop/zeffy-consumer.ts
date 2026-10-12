/**
 * The Santa's Workshop consumer of Zeffy webhook events. The webhook route
 * composes it into the generic handler (src/lib/zeffy/webhook-handler.ts), so
 * the dependency points workshop -> zeffy module, never the other way.
 *
 * Rules (Phase 3, "Consumer"; DECISION-123):
 *   - Accepts payment.completed, payment.updated, payment.deleted; every other
 *     type (payment.created, contact.*) is `ignored_type`, ids only.
 *   - A campaign no session maps is `ignored_unmapped` and NOTHING is stored
 *     from it (the webhook is organisation-wide: every White Cane gift lands here).
 *   - `completed` carries the full payment: an unseen payment applies the
 *     embedded payload (snapshot_at = dispatchedAt); a known payment is
 *     re-fetched and the FETCHED snapshot applied.
 *   - `updated` / `deleted` carry `{ id }` only. A refund is a NOTIFICATION; our
 *     state follows the fetched snapshot (a 404 flags the order deleted). A
 *     late retry cannot un-refund: the apply refuses an older snapshot.
 *   - Transient database / Zeffy failures return `failed` (HTTP 500, Zeffy
 *     retries with the same event id); permanent ones return a terminal outcome.
 *   - No email, ever, from this path.
 */

import { applyPaymentSnapshot, findOrderByPayment, findSessionByCampaign, markPaymentDeleted } from "./payment-apply";
import type { ApplyResult } from "./payment-apply";
import { createZeffyClient, ZeffyError, type GetPaymentResult } from "@/lib/zeffy/client";
import { apiKey } from "@/lib/zeffy/config";
import { toSnapshot, type PaymentSnapshot } from "@/lib/zeffy/snapshot";
import { paymentReferenceId } from "@/lib/zeffy/types";
import type { ConsumerContext, ConsumerResult, ZeffyConsumer } from "@/lib/zeffy/webhook-handler";
import type { ZeffyEnvelope } from "@/lib/zeffy/types";

export interface ConsumerDeps {
  findSessionByCampaign(campaignId: string): Promise<{ id: string } | null>;
  findOrderByPayment(paymentId: string): Promise<{ id: string; sessionId: string } | null>;
  fetchPayment(paymentId: string): Promise<GetPaymentResult>;
  apply(
    snapshot: PaymentSnapshot,
    opts: { sessionId: string; source: "webhook" | "sync"; fetchedAt: Date },
  ): Promise<ApplyResult>;
  markPaymentDeleted(paymentId: string, fetchedAt: Date): Promise<boolean>;
  apiKeyConfigured(): boolean;
  now(): Date;
}

export function defaultConsumerDeps(): ConsumerDeps {
  return {
    findSessionByCampaign,
    findOrderByPayment,
    fetchPayment: (id) => createZeffyClient().getPayment(id),
    apply: applyPaymentSnapshot,
    markPaymentDeleted,
    apiKeyConfigured: () => !!apiKey(),
    now: () => new Date(),
  };
}

/** Whitelisted snapshot as stored on the event row (mapped campaigns only). */
function payloadOf(snapshot: PaymentSnapshot): Record<string, unknown> {
  return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
}

function failureCode(error: unknown): string {
  if (error instanceof ZeffyError) {
    switch (error.code) {
      case "not_configured":
        return "no_api_key";
      case "rate_limited":
        return "zeffy_rate_limited";
      case "unauthorized":
        return "zeffy_unauthorized";
      case "unavailable":
        return "zeffy_unavailable";
      default:
        return "zeffy_error";
    }
  }
  return "db_error";
}

/** Maps an ApplyResult to the event outcome. Codes are fixed strings, never payload text. */
export function applyResultToConsumerResult(
  applied: ApplyResult,
  ctx: { sessionId: string; campaignId: string | null; payload: Record<string, unknown> | null },
): ConsumerResult {
  const base = { sessionId: ctx.sessionId, campaignId: ctx.campaignId, payload: ctx.payload };
  switch (applied.result) {
    case "applied":
      return { outcome: "processed", code: "applied", ...base };
    case "stale":
      return { outcome: "processed", code: "stale_snapshot", ...base };
    case "not_succeeded":
      return { outcome: "processed", code: "not_succeeded", ...base };
    case "no_registrants":
      return { outcome: "processed", code: "no_registrants", ...base };
    case "purged":
      return { outcome: "processed", code: "purged_session", sessionId: ctx.sessionId, campaignId: ctx.campaignId };
    case "session_mismatch":
      return { outcome: "failed", code: "session_mismatch", ...base };
    case "session_not_found":
      return { outcome: "failed", code: "session_not_found", ...base };
    default: {
      const exhaustive: never = applied;
      return exhaustive;
    }
  }
}

export interface FetchApplyOutcome {
  result: ConsumerResult;
  /** Present when the payment was applied or seen against a mapped session. */
  sessionId: string | null;
}

/**
 * Fetch the payment from Zeffy and apply the FETCHED snapshot. `knownSessionId`
 * comes from an existing order; otherwise the snapshot's campaign decides.
 * Shared by the webhook (updated / deleted / completed-known), Reprocess payment
 * and Reprocess event.
 */
export async function fetchAndApply(
  paymentId: string,
  deps: ConsumerDeps,
  opts: { knownSessionId: string | null; source: "webhook" | "sync"; expectedCampaignId?: string },
): Promise<FetchApplyOutcome> {
  if (!deps.apiKeyConfigured()) {
    return { result: { outcome: "failed", code: "no_api_key", sessionId: opts.knownSessionId }, sessionId: opts.knownSessionId };
  }

  const fetchedAt = deps.now();
  let fetched: GetPaymentResult;
  try {
    fetched = await deps.fetchPayment(paymentId);
  } catch (error) {
    if (error instanceof ZeffyError && error.code === "dev_campaign_not_allowed") {
      return { result: { outcome: "ignored_unmapped", code: "out_of_scope" }, sessionId: null };
    }
    return { result: { outcome: "failed", code: failureCode(error), sessionId: opts.knownSessionId }, sessionId: opts.knownSessionId };
  }

  if (fetched.gone) {
    try {
      const flagged = await deps.markPaymentDeleted(paymentId, fetchedAt);
      if (!flagged) return { result: { outcome: "ignored_unmapped", code: "unknown_payment" }, sessionId: null };
      return {
        result: { outcome: "processed", code: "payment_deleted", sessionId: opts.knownSessionId },
        sessionId: opts.knownSessionId,
      };
    } catch {
      return { result: { outcome: "failed", code: "db_error", sessionId: opts.knownSessionId }, sessionId: opts.knownSessionId };
    }
  }
  if (fetched.outOfScope) return { result: { outcome: "ignored_unmapped", code: "out_of_scope" }, sessionId: null };

  const parsed = toSnapshot(fetched.payment);
  if (!parsed.ok) return { result: { outcome: "invalid", code: "bad_payment" }, sessionId: null };
  const snapshot = parsed.snapshot;
  if (opts.expectedCampaignId && snapshot.campaignId !== opts.expectedCampaignId) {
    // The payment belongs to another form: never apply it to this session.
    return { result: { outcome: "ignored_unmapped", code: "campaign_mismatch", campaignId: snapshot.campaignId }, sessionId: null };
  }

  try {
    let sessionId = opts.knownSessionId;
    if (!sessionId && snapshot.campaignId) sessionId = (await deps.findSessionByCampaign(snapshot.campaignId))?.id ?? null;
    if (!sessionId) {
      // Held in memory only; nothing stored, only the campaign id is recorded.
      return {
        result: { outcome: "ignored_unmapped", code: "unmapped_campaign", campaignId: snapshot.campaignId },
        sessionId: null,
      };
    }
    const applied = await deps.apply(snapshot, { sessionId, source: opts.source, fetchedAt });
    return {
      result: applyResultToConsumerResult(applied, {
        sessionId,
        campaignId: snapshot.campaignId,
        payload: payloadOf(snapshot),
      }),
      sessionId,
    };
  } catch {
    return { result: { outcome: "failed", code: "db_error", sessionId: opts.knownSessionId }, sessionId: opts.knownSessionId };
  }
}

const HANDLED_TYPES = ["payment.completed", "payment.updated", "payment.deleted"] as const;

export function createSantasWorkshopConsumer(deps: ConsumerDeps = defaultConsumerDeps()): ZeffyConsumer {
  return {
    async handle(event: ZeffyEnvelope, _ctx: ConsumerContext): Promise<ConsumerResult> {
      if (!(HANDLED_TYPES as readonly string[]).includes(event.type)) {
        return { outcome: "ignored_type", code: "type_not_handled" };
      }

      try {
        // ---- payment.completed: full payload in `data` ----------------------
        if (event.type === "payment.completed") {
          const parsed = toSnapshot(event.data);
          if (!parsed.ok) return { outcome: "invalid", code: "bad_payment" };
          const snapshot = parsed.snapshot;
          if (!snapshot.campaignId) return { outcome: "invalid", code: "no_campaign" };

          const session = await deps.findSessionByCampaign(snapshot.campaignId);
          const known = await deps.findOrderByPayment(snapshot.paymentId);
          if (!session && !known) {
            // Organisation-wide webhook: ids only, no payload, nothing stored.
            return { outcome: "ignored_unmapped", code: "unmapped_campaign", campaignId: snapshot.campaignId };
          }
          if (known) {
            // A known payment is re-fetched; the FETCHED snapshot is applied.
            return (await fetchAndApply(snapshot.paymentId, deps, { knownSessionId: known.sessionId, source: "webhook" })).result;
          }
          const sessionId = (session as { id: string }).id;
          const applied = await deps.apply(snapshot, {
            sessionId,
            source: "webhook",
            // snapshot_at for an embedded payload is when Zeffy dispatched it.
            fetchedAt: new Date(event.dispatchedAt),
          });
          return applyResultToConsumerResult(applied, {
            sessionId,
            campaignId: snapshot.campaignId,
            payload: payloadOf(snapshot),
          });
        }

        // ---- payment.updated / payment.deleted: id only --------------------
        const paymentId = paymentReferenceId(event.data);
        if (!paymentId) return { outcome: "invalid", code: "no_payment_id" };

        const known = await deps.findOrderByPayment(paymentId);
        if (!known && event.type === "payment.deleted") {
          return { outcome: "ignored_unmapped", code: "unknown_payment" };
        }
        // Unknown + updated: fetch once. A mapped campaign applies (this heals a
        // missed `completed`); an unmapped one is discarded unread.
        return (await fetchAndApply(paymentId, deps, { knownSessionId: known?.sessionId ?? null, source: "webhook" })).result;
      } catch (error) {
        return { outcome: "failed", code: failureCode(error) };
      }
    },
  };
}

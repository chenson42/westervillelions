/**
 * Reprocess a payment or a logged event through the SAME apply path as the
 * webhook (Phase 3: "Reprocess and Sync call the same applyPaymentSnapshot()").
 * Server-only.
 *
 *   - reprocessPayment(): fetch ONE payment from Zeffy and apply the fetched
 *     snapshot to a session, provided the payment belongs to that session's form.
 *   - reprocessEvent(): re-run one logged event from its stored (whitelisted)
 *     snapshot, or, when none was stored, re-fetch its payment. The staleness
 *     guard still applies: Reprocess can never un-refund an order.
 */

import { applyResultToConsumerResult, defaultConsumerDeps, fetchAndApply, type ConsumerDeps } from "./zeffy-consumer";
import { finishZeffyEvent, getZeffyEvent } from "@/lib/zeffy/events-queries";
import { isPaymentSnapshot } from "@/lib/zeffy/snapshot";
import type { ConsumerResult } from "@/lib/zeffy/webhook-handler";
import type { ReprocessResult } from "./admin-contract";
import type { ZeffyEventOutcome } from "@/lib/zeffy/event-outcomes";

const asResult = (r: ConsumerResult): ReprocessResult => ({ outcome: r.outcome, code: "code" in r && r.code ? r.code : null });

export async function reprocessPayment(
  session: { id: string; zeffyCampaignId: string },
  paymentId: string,
  deps: ConsumerDeps = defaultConsumerDeps(),
): Promise<ConsumerResult> {
  const known = await deps.findOrderByPayment(paymentId);
  const out = await fetchAndApply(paymentId, deps, {
    knownSessionId: session.id,
    source: "sync",
    expectedCampaignId: session.zeffyCampaignId,
  });
  // An order known under ANOTHER session is a mismatch, whatever Zeffy now says.
  if (known && known.sessionId !== session.id) return { outcome: "failed", code: "session_mismatch" };
  return out.result;
}

export type ReprocessEventResult =
  | { found: false }
  | { found: true; result: ReprocessResult };

export async function reprocessEvent(
  eventId: string,
  deps: ConsumerDeps = defaultConsumerDeps(),
): Promise<ReprocessEventResult> {
  const event = await getZeffyEvent(eventId);
  if (!event) return { found: false };

  let result: ConsumerResult;

  if (event.sessionId && event.payload) {
    if (!isPaymentSnapshot(event.payload)) {
      result = { outcome: "invalid", code: "bad_payload", sessionId: event.sessionId };
    } else {
      try {
        const applied = await deps.apply(event.payload, {
          sessionId: event.sessionId,
          source: "webhook",
          fetchedAt: event.dispatchedAt ?? event.receivedAt,
        });
        result = applyResultToConsumerResult(applied, {
          sessionId: event.sessionId,
          campaignId: event.campaignId,
          payload: event.payload as unknown as Record<string, unknown>,
        });
      } catch {
        result = { outcome: "failed", code: "db_error", sessionId: event.sessionId };
      }
    }
  } else if (event.paymentId) {
    const known = await deps.findOrderByPayment(event.paymentId);
    result = (await fetchAndApply(event.paymentId, deps, { knownSessionId: known?.sessionId ?? null, source: "webhook" })).result;
  } else {
    result = { outcome: "invalid", code: "no_payment_id" };
  }

  await finishZeffyEvent(eventId, {
    outcome: result.outcome as ZeffyEventOutcome,
    errorCode: "code" in result ? (result.code ?? null) : null,
    sessionId: result.sessionId ?? event.sessionId,
    campaignId: result.campaignId ?? undefined,
    payload: result.payload ?? event.payload,
  });
  return { found: true, result: asResult(result) };
}

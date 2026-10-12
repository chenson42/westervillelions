/**
 * The framework-free half of POST /api/zeffy/webhook: verify, claim, dispatch
 * to injected consumers, map the result to an HTTP answer. The route supplies
 * the raw bytes, the clock, the secret, the DB-backed event store and the
 * consumers; tests supply in-memory ones.
 *
 * Order of operations (DECISION-123):
 *   1. No secret configured      -> 500 not_configured (fail closed, nothing processed).
 *   2. Oversize / bad signature / stale timestamp / malformed JSON / bad
 *      envelope                  -> ONE identical 400, no database write, no body logged.
 *   3. claim the event row (insert-or-read). A row already in a terminal
 *      outcome is answered 200 without calling any consumer; `received` and
 *      `failed` rows re-run the consumers (a retry of a failed event is the
 *      only reason Zeffy retries).
 *   4. unsupported envelope version -> recorded, 200.
 *   5. consumers run inline (never after the response: serverless may freeze).
 *   6. transient failure -> 500 so Zeffy retries with the same event id;
 *      permanent outcomes -> 200 with the outcome recorded.
 *
 * Nothing here is workshop-specific; the dependency points consumer -> module.
 */

import { verifyZeffySignature } from "./signature";
import { paymentReferenceId, isRecord, parseEnvelope, type ZeffyEnvelope } from "./types";
import { isTerminalOutcome, type ZeffyEventOutcome } from "./event-outcomes";

export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
export const SUPPORTED_ENVELOPE_VERSION = 1;

export interface ZeffyEventRecord {
  id: string;
  type: string | null;
  version: string | null;
  paymentId: string | null;
  campaignId: string | null;
  sessionId: string | null;
  outcome: string;
  errorCode: string | null;
  attempts: number;
}

export interface ClaimInput {
  id: string;
  type: string;
  version: number;
  paymentId: string | null;
  campaignId: string | null;
  dispatchedAt: Date;
}

export interface FinishPatch {
  outcome: ZeffyEventOutcome;
  errorCode?: string | null;
  sessionId?: string | null;
  campaignId?: string | null;
  /** Whitelisted PaymentSnapshot for MAPPED campaigns only; never a raw body. */
  payload?: Record<string, unknown> | null;
}

export interface ZeffyEventStore {
  /** Insert-or-read. `alreadyTerminal` means a redelivery that must not be processed again. */
  claim(input: ClaimInput): Promise<{ record: ZeffyEventRecord; alreadyTerminal: boolean }>;
  finish(id: string, patch: FinishPatch): Promise<void>;
}

export interface ConsumerContext {
  now: Date;
  /** 1 for a first delivery. */
  attempt: number;
}

export type ConsumerResult =
  | {
      outcome: "processed" | "ignored_unmapped" | "ignored_type" | "invalid" | "unsupported_version";
      code?: string;
      sessionId?: string | null;
      campaignId?: string | null;
      payload?: Record<string, unknown> | null;
    }
  | {
      outcome: "failed";
      code: string;
      sessionId?: string | null;
      campaignId?: string | null;
      payload?: Record<string, unknown> | null;
    };

export interface ZeffyConsumer {
  handle(event: ZeffyEnvelope, ctx: ConsumerContext): Promise<ConsumerResult>;
}

export interface WebhookRequest {
  rawBody: Uint8Array;
  signatureHeader: string | null;
  now: Date;
  secret: string | undefined;
  store: ZeffyEventStore;
  consumers: readonly ZeffyConsumer[];
}

export interface WebhookResponse {
  status: 200 | 400 | 500;
  body: { ok: true; outcome: string; duplicate?: true } | { error: "bad_request" | "not_configured" | "failed" };
}

const BAD_REQUEST: WebhookResponse = { status: 400, body: { error: "bad_request" } };

/** Higher wins when several consumers answer. */
const PRECEDENCE: Record<ConsumerResult["outcome"], number> = {
  failed: 5,
  processed: 4,
  invalid: 3,
  unsupported_version: 2,
  ignored_unmapped: 1,
  ignored_type: 0,
};

export function combineResults(results: readonly ConsumerResult[]): ConsumerResult {
  if (results.length === 0) return { outcome: "ignored_type", code: "no_consumer" };
  return results.reduce((best, r) => (PRECEDENCE[r.outcome] > PRECEDENCE[best.outcome] ? r : best));
}

function campaignIdOf(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const c = data.campaign_id;
  return typeof c === "string" && c && c.length <= 200 ? c : null;
}

export async function handleZeffyWebhook(req: WebhookRequest): Promise<WebhookResponse> {
  if (!req.secret) return { status: 500, body: { error: "not_configured" } };
  if (req.rawBody.byteLength === 0 || req.rawBody.byteLength > WEBHOOK_MAX_BODY_BYTES) return BAD_REQUEST;

  const verified = verifyZeffySignature({
    secret: req.secret,
    header: req.signatureHeader,
    rawBody: req.rawBody,
    nowMs: req.now.getTime(),
  });
  if (!verified.ok) return BAD_REQUEST;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(req.rawBody));
  } catch {
    return BAD_REQUEST;
  }
  const envelope = parseEnvelope(json);
  if (!envelope) return BAD_REQUEST;

  try {
    const { record, alreadyTerminal } = await req.store.claim({
      id: envelope.id,
      type: envelope.type,
      version: envelope.version,
      paymentId: paymentReferenceId(envelope.data) ?? null,
      campaignId: campaignIdOf(envelope.data),
      dispatchedAt: new Date(envelope.dispatchedAt),
    });
    if (alreadyTerminal || isTerminalOutcome(record.outcome)) {
      return { status: 200, body: { ok: true, outcome: record.outcome, duplicate: true } };
    }

    if (envelope.version !== SUPPORTED_ENVELOPE_VERSION) {
      await req.store.finish(envelope.id, { outcome: "unsupported_version", errorCode: "unsupported_version" });
      return { status: 200, body: { ok: true, outcome: "unsupported_version" } };
    }

    const results: ConsumerResult[] = [];
    for (const consumer of req.consumers) {
      try {
        results.push(await consumer.handle(envelope, { now: req.now, attempt: record.attempts }));
      } catch {
        // A consumer should return `failed`; a throw is treated the same. Codes only, no message.
        results.push({ outcome: "failed", code: "consumer_error" });
      }
    }
    const result = combineResults(results);
    await req.store.finish(envelope.id, {
      outcome: result.outcome,
      errorCode: result.code ?? null,
      sessionId: result.sessionId ?? null,
      campaignId: result.campaignId ?? undefined,
      // Data minimisation: only a MAPPED campaign (a session id) keeps a payload.
      payload: result.sessionId ? (result.payload ?? null) : null,
    });

    if (result.outcome === "failed") return { status: 500, body: { error: "failed" } };
    return { status: 200, body: { ok: true, outcome: result.outcome } };
  } catch {
    // The event store itself failed: nothing recorded as terminal, so a Zeffy retry re-runs it.
    return { status: 500, body: { error: "failed" } };
  }
}

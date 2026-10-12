/**
 * POST /api/zeffy/webhook
 *
 * Zeffy's signed webhook. Organisation-wide: EVERY payment event of the club's
 * Zeffy account lands here (White Cane gifts included), so a payment whose
 * campaign no workshop session maps is acknowledged and nothing is stored.
 *
 * There is deliberately NO auth() here: the HMAC signature (ZEFFY_WEBHOOK_SECRET)
 * is the authentication, and the proxy skips /api/. The raw bytes are read
 * BEFORE any JSON parse because the signature covers them. Work is done inline
 * and the response sent last (serverless may freeze after a response).
 *
 *   200 { ok: true, outcome }   handled, ignored, or a duplicate of a finished event
 *   400 { error: "bad_request" } oversize, bad/stale signature, malformed body (one identical answer)
 *   500 { error: "not_configured" | "failed" }   Zeffy retries with the same event id
 *
 * Contract: src/lib/zeffy/webhook-handler.ts. Consumer: santas-workshop/zeffy-consumer.ts.
 */

import { NextResponse } from "next/server";
import { webhookSecret } from "@/lib/zeffy/config";
import { dbZeffyEventStore } from "@/lib/zeffy/events-queries";
import { handleZeffyWebhook, WEBHOOK_MAX_BODY_BYTES } from "@/lib/zeffy/webhook-handler";
import { createSantasWorkshopConsumer } from "@/lib/santas-workshop/zeffy-consumer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // Cheap early refusal; the handler enforces the cap again on the bytes actually read.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BODY_BYTES) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  const result = await handleZeffyWebhook({
    rawBody,
    signatureHeader: request.headers.get("zeffy-signature"),
    now: new Date(),
    secret: webhookSecret(),
    store: dbZeffyEventStore,
    consumers: [createSantasWorkshopConsumer()],
  });
  return NextResponse.json(result.body, { status: result.status });
}

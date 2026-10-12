/**
 * Signs a fixture with a made-up secret and POSTs it to a LOCAL dev server, so
 * the webhook route, mapper and apply can be exercised with no Zeffy account.
 *
 *   ZEFFY_WEBHOOK_SECRET=whsec_devexample pnpm exec tsx scripts/zeffy-webhook-fixture.ts \
 *     --campaign campaign-practice-01 [--url http://localhost:3101/api/zeffy/webhook] [--event-id <id>]
 *
 * The dev server must be started with the SAME ZEFFY_WEBHOOK_SECRET. Refuses any
 * URL that is not localhost, and never reads a real credential.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { signZeffyBody } from "../src/lib/zeffy/test-helpers";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg("--url") ?? "http://localhost:3101/api/zeffy/webhook";
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("Only a localhost URL is allowed.");
  const secret = process.env.ZEFFY_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith("whsec_dev")) throw new Error("Set ZEFFY_WEBHOOK_SECRET to a made-up whsec_dev... value.");

  const payment = JSON.parse(readFileSync(join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "payment-three-tickets.json"), "utf8"));
  if (arg("--campaign")) payment.campaign_id = arg("--campaign");

  const body = JSON.stringify({
    id: arg("--event-id") ?? crypto.randomUUID(),
    type: "payment.completed",
    version: 1,
    dispatchedAt: new Date().toISOString(),
    data: payment,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "zeffy-signature": signZeffyBody(secret, body, Math.floor(Date.now() / 1000)) },
    body,
  });
  console.log(res.status, await res.text());
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

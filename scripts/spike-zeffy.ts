/**
 * S2a spike: look at a REAL Zeffy practice form's payments and write a REDACTED
 * fixture the unit tests use. Dry-run by default: it prints structure only
 * (counts, statuses, question texts and answer shapes, never an answer value or
 * a buyer detail) and writes nothing.
 *
 *   pnpm exec dotenv -e .env.local -- tsx scripts/spike-zeffy.ts --campaign <id>
 *   pnpm exec dotenv -e .env.local -- tsx scripts/spike-zeffy.ts --campaign <id> --write
 *
 * Safety:
 *   - The campaign must be in ZEFFY_DEV_CAMPAIGN_ALLOWLIST (the Zeffy client
 *     refuses anything else outside production, and this script also refuses
 *     to run with NODE_ENV=production). Needs ZEFFY_API_KEY.
 *   - --write stores src/lib/zeffy/__fixtures__/spike-redacted.json after
 *     redactPaymentForFixture(): ids, names, emails, addresses and free-text
 *     answers replaced (example.invalid). Read the file before committing it.
 *   - It never touches the database and sends no email.
 *
 * What it answers (Phase 3 spikes, S2a): exact question strings and answer
 * shapes (checkbox `false` versus absent; select arrays), whether `Item.id` is
 * stable and unique, whether list items carry items[] and questions[], status
 * values, what a partial refund does to items[].
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createZeffyClient, ZeffyError } from "../src/lib/zeffy/client";
import { devCampaignAllowlist } from "../src/lib/zeffy/config";
import { redactPaymentForFixture } from "../src/lib/zeffy/redact";
import type { ZeffyPayment } from "../src/lib/zeffy/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function shapeOf(answer: unknown): string {
  if (typeof answer === "boolean") return `boolean(${answer})`;
  if (Array.isArray(answer)) return `array[${answer.length}]`;
  if (typeof answer === "string") return answer === "" ? "empty-string" : "string";
  return typeof answer;
}

async function main() {
  const campaignId = arg("--campaign");
  const write = process.argv.includes("--write");

  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");
  if (!campaignId) throw new Error("Usage: spike-zeffy.ts --campaign <id> [--write]");
  if (!devCampaignAllowlist().includes(campaignId)) {
    throw new Error("That campaign is not in ZEFFY_DEV_CAMPAIGN_ALLOWLIST. Add the practice form's id there first.");
  }

  const client = createZeffyClient();
  const payments: ZeffyPayment[] = await client.listAllPayments({ campaignId, maxPages: 5 });

  console.log(`Campaign ${campaignId}: ${payments.length} payment(s). Mode: ${write ? "WRITE fixture" : "dry run"}.`);
  const statuses = new Map<string, number>();
  const questions = new Map<string, Set<string>>();
  const itemIds = new Set<string>();
  let itemCount = 0;
  let listCarriesItems = 0;

  for (const p of payments) {
    statuses.set(p.status, (statuses.get(p.status) ?? 0) + 1);
    if (Array.isArray(p.items)) listCarriesItems += 1;
    for (const item of p.items ?? []) {
      itemCount += 1;
      if (item.id) itemIds.add(item.id);
      for (const q of item.questions ?? []) {
        const key = `item | ${q.type} | ${q.question}`;
        (questions.get(key) ?? questions.set(key, new Set()).get(key)!).add(shapeOf(q.answer));
      }
    }
    for (const q of p.buyer_questions ?? []) {
      const key = `buyer | ${q.type} | ${q.question}`;
      (questions.get(key) ?? questions.set(key, new Set()).get(key)!).add(shapeOf(q.answer));
    }
  }

  console.log("Statuses:", Object.fromEntries(statuses));
  console.log(`List items carry items[]: ${listCarriesItems}/${payments.length}. Item ids unique: ${itemIds.size === itemCount} (${itemCount} items).`);
  console.log("Questions (scope | type | text -> answer shapes seen):");
  for (const [key, shapes] of questions) console.log(`  ${key} -> ${[...shapes].join(", ")}`);

  if (write) {
    const out = payments.slice(0, 5).map((p, i) => redactPaymentForFixture(p, i + 1));
    const file = join(__dirname, "..", "src", "lib", "zeffy", "__fixtures__", "spike-redacted.json");
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`Wrote ${out.length} redacted payment(s) to ${file}. Read it before committing.`);
  } else {
    console.log("Dry run: nothing written. Re-run with --write to store a redacted fixture.");
  }
}

main().catch((e) => {
  // Never print a request body or the key: ZeffyError messages carry codes only.
  console.error(e instanceof ZeffyError ? `Zeffy error: ${e.code}` : (e as Error).message);
  process.exit(1);
});

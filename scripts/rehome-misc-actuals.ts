/**
 * Rehomes the last 3 admin "Miscellaneous" (expense) transactions into an
 * explicit "Program supplies" category, then deactivates the now-empty Misc
 * expense category — finishing the "no Miscellaneous categories" cleanup.
 * Dry-run by default.
 *
 *   pnpm exec tsx scripts/rehome-misc-actuals.ts            # dry run
 *   pnpm exec tsx scripts/rehome-misc-actuals.ts --apply    # writes
 *
 * The 3 items (banner/peace-poster/tent, costume cleaning, eyeglass collection
 * boxes) are small, mixed club program/service supplies — "Program supplies" is
 * their honest explicit home. Leaves the admin Misc INCOME items alone (the
 * $563.80 PayPal transfer is unresolved T-07; the $100 COhatch refund is a
 * Marketing contra) — those need their own decision.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
if (usingProd) console.log("*** TARGET: PRODUCTION (PROD_DATABASE_URL) ***");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}\n`);
  const [club] = await sql<{ id: string }[]>`SELECT id FROM ledger_entities WHERE slug = 'club'`;

  const catId = async (name: string, flow: string): Promise<string | null> => {
    const r = await sql<{ id: string; is_active?: boolean }[]>`SELECT id FROM ledger_categories WHERE entity_id = ${club.id} AND fund_kind = 'administrative' AND flow = ${flow} AND name = ${name} LIMIT 1`;
    return r[0]?.id ?? null;
  };

  // Ensure "Program supplies" (admin expense) exists.
  let progId = await catId("Program supplies", "expense");
  console.log(`${progId ? "Program supplies exists" : "CREATE Program supplies (admin expense)"}`);
  if (APPLY && !progId) {
    const [c] = await sql<{ id: string }[]>`INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving) VALUES (${club.id}, 'administrative', 'expense', 'Program supplies', false) RETURNING id`;
    progId = c.id;
  }

  const miscId = await catId("Miscellaneous", "expense");
  if (!miscId) { console.log("No admin Miscellaneous expense category — nothing to do."); await sql.end(); return; }

  const items = await sql<{ id: string; amount_cents: number; party: string | null; memo: string | null }[]>`
    SELECT id, amount_cents, party, memo FROM ledger_transactions WHERE category_id = ${miscId} AND flow = 'expense' ORDER BY txn_date`;
  console.log(`\nMoving ${items.length} txn(s) -> Program supplies:`);
  for (const i of items) console.log(`  ${money(i.amount_cents)}  ${i.party ?? ""} — ${i.memo ?? ""}`);

  if (APPLY && items.length > 0) {
    for (const i of items) await sql`UPDATE ledger_transactions SET category_id = ${progId}, updated_at = now() WHERE id = ${i.id}`;
  }

  // Deactivate the now-empty Misc expense category (only if empty).
  const remaining = APPLY
    ? (await sql`SELECT 1 FROM ledger_transactions WHERE category_id = ${miscId}`).length
    : items.length;
  if (remaining === 0) {
    console.log(`\n${APPLY ? "Deactivating" : "Would deactivate"} the now-empty admin Miscellaneous (expense) category.`);
    if (APPLY) await sql`UPDATE ledger_categories SET is_active = false, updated_at = now() WHERE id = ${miscId}`;
  } else {
    console.log(`\nAdmin Miscellaneous still has ${remaining} txn(s) — NOT deactivating.`);
  }

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN complete — re-run with --apply."}`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

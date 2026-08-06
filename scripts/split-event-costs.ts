/**
 * Splits "Fundraising event costs" into "Rudolph Run expenses" and "Pancake
 * Breakfast expenses" — categories + actuals + the FY2025 budget line — so each
 * event has its own P&L (pairs with the Rudolph income split). Dry-run by default.
 *
 *   pnpm exec tsx scripts/split-event-costs.ts            # dry run (REVIEW the split)
 *   pnpm exec tsx scripts/split-event-costs.ts --apply    # writes
 *
 * Rule: Pancake = American Legion Post 171 (the pancake venue) + Ticket Tailor
 * "PB tickets" + any pancake memo; everything else = Rudolph. The American Legion
 * rentals are the one judgment call — review the dry-run before --apply.
 *
 * FY2025 budget: Fundraising event costs $11,500 -> Rudolph $10,000 + Pancake $1,500.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FY = 2025;
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
if (usingProd) console.log("*** TARGET: PRODUCTION (PROD_DATABASE_URL) ***");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// Returns true if a Fundraising-event-costs txn is a Pancake Breakfast cost.
function isPancake(party: string, memo: string): boolean {
  const p = party.toLowerCase(), m = memo.toLowerCase();
  return p.includes("american legion") || p.includes("ticket tailor") || m.includes("pb ticket") || m.includes("pancake");
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}\n`);
  const [found] = await sql<{ id: string }[]>`SELECT id FROM ledger_entities WHERE slug='foundation'`;
  const [fund] = await sql<{ id: string }[]>`SELECT id FROM ledger_funds WHERE entity_id=${found.id} AND slug='charitable'`;

  const catId = async (name: string): Promise<string | null> => {
    const r = await sql<{ id: string }[]>`SELECT id FROM ledger_categories WHERE entity_id=${found.id} AND fund_kind='charitable' AND flow='expense' AND name=${name} LIMIT 1`;
    return r[0]?.id ?? null;
  };
  const ensureCat = async (name: string): Promise<string | null> => {
    let id = await catId(name);
    console.log(`  ${id ? "exists" : "CREATE"}  ${name}`);
    if (APPLY && !id) {
      const [c] = await sql<{ id: string }[]>`INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving) VALUES (${found.id},'charitable','expense',${name},false) RETURNING id`;
      id = c.id;
    }
    return id;
  };

  console.log("Categories:");
  const rudId = await ensureCat("Rudolph Run expenses");
  const panId = await ensureCat("Pancake Breakfast expenses");
  const fecId = await catId("Fundraising event costs");
  if (!fecId) { console.log("\nNo 'Fundraising event costs' category — nothing to split."); await sql.end(); return; }

  const txns = await sql<{ id: string; txn_date: string; amount_cents: number; party: string | null; memo: string | null }[]>`
    SELECT id, txn_date, amount_cents, party, memo FROM ledger_transactions WHERE category_id=${fecId} AND flow='expense' ORDER BY txn_date`;
  const pancake = txns.filter((t) => isPancake(t.party ?? "", t.memo ?? ""));
  const rudolph = txns.filter((t) => !isPancake(t.party ?? "", t.memo ?? ""));

  const sum = (a: typeof txns) => a.reduce((s, t) => s + t.amount_cents, 0);
  console.log(`\n=== PANCAKE BREAKFAST expenses (${pancake.length} txns, ${money(sum(pancake))}) — REVIEW these ===`);
  for (const t of pancake) console.log(`  ${t.txn_date}  ${money(t.amount_cents).padStart(9)}  ${t.party ?? ""} — ${t.memo ?? ""}`);
  console.log(`\n=== RUDOLPH RUN expenses (${rudolph.length} txns, ${money(sum(rudolph))}) ===`);
  for (const t of rudolph) console.log(`  ${t.txn_date}  ${money(t.amount_cents).padStart(9)}  ${t.party ?? ""} — ${t.memo ?? ""}`);

  if (APPLY) {
    for (const t of pancake) await sql`UPDATE ledger_transactions SET category_id=${panId}, updated_at=now() WHERE id=${t.id}`;
    for (const t of rudolph) await sql`UPDATE ledger_transactions SET category_id=${rudId}, updated_at=now() WHERE id=${t.id}`;

    // Budget: replace the $11,500 Fundraising event costs row with Rudolph $10,000 + Pancake $1,500.
    const [fecBudget] = await sql<{ id: string }[]>`SELECT id FROM ledger_budgets WHERE fund_id=${fund.id} AND fiscal_year=${FY} AND category_id=${fecId} AND flow='expense'`;
    if (fecBudget) await sql`DELETE FROM ledger_budgets WHERE id=${fecBudget.id}`;
    for (const [cid, cents] of [[rudId, 1000000], [panId, 150000]] as [string, number][]) {
      await sql`INSERT INTO ledger_budgets (entity_id, fund_id, fiscal_year, category_id, flow, annual_amount_cents)
                VALUES (${found.id},${fund.id},${FY},${cid},'expense',${cents})
                ON CONFLICT (fund_id, fiscal_year, category_id, flow) DO UPDATE SET annual_amount_cents=EXCLUDED.annual_amount_cents, updated_at=now()`;
    }
    // Deactivate the now-empty category.
    const left = (await sql`SELECT 1 FROM ledger_transactions WHERE category_id=${fecId}`).length;
    if (left === 0) await sql`UPDATE ledger_categories SET is_active=false, updated_at=now() WHERE id=${fecId}`;
    console.log(`\nBudget: Fundraising event costs $11,500 -> Rudolph Run expenses $10,000 + Pancake Breakfast expenses $1,500.`);
    console.log(left === 0 ? "Deactivated the emptied 'Fundraising event costs' category." : `NOTE: ${left} txn(s) still in Fundraising event costs.`);
  }

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN — review the Pancake list above, then --apply."}`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

/**
 * Backfills check numbers 8252/8253 onto the two already-posted "Gates At Eight"
 * (BMX) $500 checks dated 2026-03-07 that were imported without them — closing
 * T-09 (the register shows 8252=Sponsorship, 8253=Scholarships; matched here by
 * the imported memo). Metadata only: sets check_number + payment_method, NEVER
 * creates a transaction or changes an amount. Dry-run by default.
 *
 *   pnpm exec tsx scripts/backfill-gates-checks.ts            # dry run
 *   pnpm exec tsx scripts/backfill-gates-checks.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL runs against production (loud banner); else dev.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL.");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// memo prefix -> check number (register: 8253 Scholarships, 8252 Sponsorship)
const RULES: [string, string][] = [["Scholarships", "8253"], ["Sponsorship", "8252"]];

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  // Guard: don't collide with an existing 8252/8253.
  const existing = await sql`SELECT check_number FROM ledger_transactions WHERE check_number IN ('8252','8253')`;
  if (existing.length) {
    console.log(`Check numbers 8252/8253 already present (${existing.length}) — likely already backfilled. Nothing to do.`);
    await sql.end();
    return;
  }

  const rows = await sql<{ id: string; amount_cents: number; party: string | null; memo: string | null }[]>`
    SELECT t.id, t.amount_cents, t.party, t.memo
    FROM ledger_transactions t JOIN ledger_funds f ON f.id=t.fund_id
    WHERE f.slug='charitable' AND t.flow='expense' AND t.party ILIKE 'Gates%'
      AND t.txn_date='2026-03-07' AND t.amount_cents=50000 AND t.check_number IS NULL`;
  console.log(`Gates At Eight $500 3/7/2026 rows missing a check number: ${rows.length}`);
  for (const [memoPrefix, chk] of RULES) {
    const row = rows.find((r) => (r.memo ?? "").toLowerCase().startsWith(memoPrefix.toLowerCase()));
    if (!row) { console.log(`  (no "${memoPrefix}" row found — skip ${chk})`); continue; }
    console.log(`  ${chk} <- ${money(row.amount_cents)} "${row.memo}"`);
    if (APPLY) await sql`UPDATE ledger_transactions SET check_number=${chk}, payment_method='check', updated_at=now() WHERE id=${row.id}`;
  }

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN — re-run with --apply."}`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

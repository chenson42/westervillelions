/**
 * Backfills bank_account_id on posted ledger transactions that are missing it
 * — so they become visible in the reconciliation grid
 * (getCandidateTransactionsForMatching filters on bank_account_id = the
 * session's account, so NULL never matches).
 *
 * docs/work-log/2026-07-29-default-bank-account.md: the Club has two bank
 * accounts (Administrative Checking, Petty Cash), so account resolution
 * prefers, in order: (1) an explicit --account="Name" override, (2) the
 * entity's sole account if it has exactly one, (3) the entity's is_default
 * account (drizzle/migrations/0070_ledger_bank_account_default.sql). Refuses
 * if none of those resolve to exactly one account (ambiguous).
 *
 *   pnpm exec tsx scripts/backfill-bank-account.ts --entity=club            # dry run
 *   pnpm exec tsx scripts/backfill-bank-account.ts --entity=club --apply    # writes
 *
 * Metadata only — bank_account_id, never amounts/reconciled/fund. Idempotent:
 * only touches rows where bank_account_id IS NULL, so re-running after a
 * successful --apply finds nothing left to do. PROD_DATABASE_URL targets prod.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const entArg = process.argv.find((a) => a.startsWith("--entity="));
if (!entArg) throw new Error("--entity=<slug> is required.");
const ENTITY = entArg.split("=")[1];

const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL.");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  entity=${ENTITY}  |  Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const [ent] = await sql<{ id: string }[]>`SELECT id FROM ledger_entities WHERE slug=${ENTITY}`;
  if (!ent) throw new Error(`entity '${ENTITY}' not found`);

  const accounts = await sql<{ id: string; name: string; is_default: boolean }[]>`SELECT id, name, is_default FROM ledger_bank_accounts WHERE entity_id=${ent.id}`;
  const acctArg = process.argv.find((a) => a.startsWith("--account="));
  let acct: { id: string; name: string } | undefined;
  if (acctArg) {
    const name = acctArg.split("=")[1];
    acct = accounts.find((a) => a.name === name);
    if (!acct) throw new Error(`account "${name}" not found for '${ENTITY}'. Available: ${accounts.map((a) => a.name).join(", ")}`);
  } else if (accounts.length === 1) {
    acct = accounts[0];
  } else {
    const defaults = accounts.filter((a) => a.is_default);
    if (defaults.length === 1) {
      acct = defaults[0];
    } else {
      console.error(`REFUSING: entity '${ENTITY}' has ${accounts.length} bank accounts and ${defaults.length === 0 ? "no default is configured" : "more than one default is configured"} — pass --account="Name". Available: ${accounts.map((a) => a.name).join(", ")}`);
      await sql.end();
      process.exit(1);
    }
  }
  console.log(`Bank account: ${acct.name} (${acct.id})`);

  const rows = await sql<{ id: string; txn_date: string; amount_cents: number; party: string | null; payment_method: string | null; flow: string }[]>`
    SELECT id, txn_date, amount_cents, party, payment_method, flow FROM ledger_transactions
    WHERE entity_id=${ent.id} AND status='posted' AND bank_account_id IS NULL ORDER BY txn_date`;
  console.log(`\nPosted txns missing a bank account: ${rows.length}`);
  for (const r of rows) console.log(`  ${r.txn_date}  ${money(r.amount_cents).padStart(9)}  ${r.flow.padEnd(7)} ${r.payment_method ?? ""}  ${r.party ?? ""}`);

  if (rows.length === 0) { console.log("\nNothing to do."); await sql.end(); return; }
  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await sql.end(); return; }

  const res = await sql`UPDATE ledger_transactions SET bank_account_id=${acct.id}, updated_at=now()
    WHERE entity_id=${ent.id} AND status='posted' AND bank_account_id IS NULL RETURNING id`;
  console.log(`\nSet bank_account_id on ${res.length} txn(s).`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

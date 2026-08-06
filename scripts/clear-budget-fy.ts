/**
 * Clears ALL budget rows (and cause lines, via cascade) for a given fiscal year.
 * Generalizes reset-fy2026-budget.ts. Dry-run by default. Budgets only — never
 * touches ledger_transactions. Refuses if that (entity, FY) budget is locked.
 *
 *   pnpm exec tsx scripts/clear-budget-fy.ts --fy=2026            # dry run
 *   pnpm exec tsx scripts/clear-budget-fy.ts --fy=2026 --apply    # delete
 *
 * TARGET DB: set PROD_DATABASE_URL to run against production (a loud banner
 * prints); otherwise uses DATABASE_URL/DB_URL (dev).
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const fyArg = process.argv.find((a) => a.startsWith("--fy="));
if (!fyArg) throw new Error("--fy=YYYY is required.");
const FY = parseInt(fyArg.split("=")[1], 10);
if (!(FY > 2000 && FY < 2100)) throw new Error(`--fy must be 2001-2099, got ${FY}`);

const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  FY${FY}  |  Mode: ${APPLY ? "APPLY (deletes)" : "DRY RUN"}\n`);

  const locks = await sql`SELECT e.name FROM ledger_budget_approvals a JOIN ledger_entities e ON e.id=a.entity_id WHERE a.fiscal_year=${FY} AND a.status='locked'`;
  if (locks.length) { console.error(`REFUSING: FY${FY} has ${locks.length} locked budget(s).`); await sql.end(); process.exit(1); }

  const rows = await sql`
    SELECT b.id, e.name AS entity, f.slug AS fund, b.flow, c.name AS category, b.annual_amount_cents AS amt,
      (SELECT COUNT(*)::int FROM ledger_budget_lines l WHERE l.budget_id=b.id) AS lines
    FROM ledger_budgets b JOIN ledger_entities e ON e.id=b.entity_id JOIN ledger_funds f ON f.id=b.fund_id
    LEFT JOIN ledger_categories c ON c.id=b.category_id
    WHERE b.fiscal_year=${FY} ORDER BY e.name, f.slug, b.flow, c.name`;
  console.log(`FY${FY} budget rows: ${rows.length}, total ${money(rows.reduce((s, r) => s + r.amt, 0))}, cause lines ${rows.reduce((s, r) => s + r.lines, 0)}`);
  if (rows.length === 0) { console.log("Nothing to do."); await sql.end(); return; }

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to delete."); await sql.end(); return; }
  const del = await sql`DELETE FROM ledger_budgets WHERE fiscal_year=${FY} RETURNING id`;
  console.log(`\nDeleted ${del.length} FY${FY} budget row(s) (cause lines cascaded).`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

/**
 * Clears ALL FY2026 budget rows (and their cause lines, via cascade) so FY2026
 * can be re-derived cleanly from the finished FY2025 reference model.
 *
 * WHY: the only FY2026 budget data today is one speculative "Charitable donation
 * out → Environment → City of Westerville – Arbor Fest" ($400) line entered
 * during earlier analysis. Chris chose to clear FY2026 and rebuild it from the
 * clean FY2025 model (decision 2026-07-29). This removes budget rows only — it
 * NEVER touches ledger_transactions (the actual Arbor Fest check 8263 stays).
 *
 * Guard rails:
 *  - Refuses to run if any FY2026 (entity) budget is Approve-&-locked.
 *  - Dry-run by default; prints exactly what it will delete. --apply to write.
 *  - Only ledger_budgets WHERE fiscal_year = 2026 (cascade deletes their
 *    ledger_budget_lines). No other year, no transactions, no categories.
 *
 * Usage:
 *   pnpm exec tsx scripts/reset-fy2026-budget.ts            # dry run (default)
 *   pnpm exec tsx scripts/reset-fy2026-budget.ts --apply    # delete FY2026 budgets
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const TARGET_FY = 2026;

const url = process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("DATABASE_URL or DB_URL must be set (.env.local).");
const sql = postgres(url);

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (deletes FY2026 budget rows)" : "DRY RUN (no writes)"}`);

  // Lock guard — never mutate an approved/locked budget.
  const locks = await sql`
    SELECT a.fiscal_year, a.status, e.name AS entity
    FROM ledger_budget_approvals a JOIN ledger_entities e ON e.id = a.entity_id
    WHERE a.fiscal_year = ${TARGET_FY} AND a.status = 'locked'`;
  if (locks.length > 0) {
    console.error(`REFUSING: FY${TARGET_FY} has ${locks.length} locked budget(s):`);
    for (const l of locks) console.error(`  - ${l.entity}`);
    await sql.end();
    process.exit(1);
  }

  const rows = await sql`
    SELECT b.id, e.name AS entity, f.slug AS fund, b.flow, c.name AS category,
           b.annual_amount_cents AS amt,
           (SELECT COUNT(*)::int FROM ledger_budget_lines l WHERE l.budget_id = b.id) AS lines
    FROM ledger_budgets b
    JOIN ledger_entities e ON e.id = b.entity_id
    JOIN ledger_funds f ON f.id = b.fund_id
    LEFT JOIN ledger_categories c ON c.id = b.category_id
    WHERE b.fiscal_year = ${TARGET_FY}
    ORDER BY e.name, f.slug, b.flow, c.name`;

  console.log(`\nFY${TARGET_FY} budget rows found: ${rows.length}`);
  let lineTotal = 0;
  for (const r of rows) {
    lineTotal += r.lines;
    console.log(`  ${r.entity} / ${r.fund} / ${r.flow} / ${r.category ?? "(no category)"}  ${money(r.amt)}  [${r.lines} cause line(s)]`);
  }
  console.log(`Cause lines that cascade-delete with them: ${lineTotal}`);

  if (rows.length === 0) {
    console.log(`\nNothing to do — FY${TARGET_FY} is already clear.`);
    await sql.end();
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN complete — no writes. Re-run with --apply to delete the above.`);
    await sql.end();
    return;
  }

  const deleted = await sql`DELETE FROM ledger_budgets WHERE fiscal_year = ${TARGET_FY} RETURNING id`;
  console.log(`\nDeleted ${deleted.length} FY${TARGET_FY} budget row(s) (cause lines cascaded).`);
  const remaining = await sql`SELECT COUNT(*)::int AS n FROM ledger_budgets WHERE fiscal_year = ${TARGET_FY}`;
  console.log(`Remaining FY${TARGET_FY} budget rows: ${remaining[0].n}.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

/**
 * Bulk-retires ledger categories that are neither budgeted nor used in the
 * current fiscal year (treasurer-approved 2026-08-08).
 *
 *   pnpm exec tsx scripts/deactivate-unused-categories.ts --fy=2026            # dry run
 *   pnpm exec tsx scripts/deactivate-unused-categories.ts --fy=2026 --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 *
 * SELECTION RULE — deliberately two conditions, not one:
 *   no budget row for the given fiscal year  AND  no transaction dated within it.
 *
 * The transaction half matters. A rule keyed only on "has no budget this year"
 * would have retired the Foundation's `Tail-twisting` income category, created
 * at the treasurer's request hours earlier and already carrying a 2026-07-06
 * transaction — actively in use, simply not budgeted. Anything with activity in
 * the year survives, by construction rather than by an exception list.
 *
 * AUDIT: every retirement writes a `ledger_audit_log` row identical in shape to
 * what the Settings UI would record — action `category_deactivated`, actor set
 * to the treasurer, and `before`/`after` holding a JSON diff of only the changed
 * field. A bulk change that left no trace would put a silent gap in the audit log
 * on the day it shipped.
 *
 * REVERSIBLE: retirement is `is_active = false`. Nothing is deleted, no history is
 * touched, and any category can be reinstated from Settings → Categories.
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

// Club fiscal year runs July 1 – June 30, so FY2026 = 2026-07-01 .. 2027-06-30.
const FY_START = `${FY}-07-01`;
const FY_END = `${FY + 1}-06-30`;

const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);

const ACTOR_EMAIL = "chenson42@gmail.com";

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  FY${FY} (${FY_START}..${FY_END})  |  ` +
      `Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`,
  );

  const [actor] = await sql`SELECT id FROM users WHERE email = ${ACTOR_EMAIL}`;
  if (!actor) throw new Error(`No users row for ${ACTOR_EMAIL} — cannot attribute the audit rows.`);

  const candidates = await sql`
    SELECT c.id, e.slug AS entity, c.fund_kind, c.flow, c.name,
      (SELECT count(*)::int FROM ledger_transactions t WHERE t.category_id = c.id) AS all_txns,
      coalesce((SELECT max(t.txn_date)::text FROM ledger_transactions t WHERE t.category_id = c.id), 'never') AS last_used
    FROM ledger_categories c
    JOIN ledger_entities e ON e.id = c.entity_id
    WHERE c.is_active
      AND NOT EXISTS (
        SELECT 1 FROM ledger_budgets b WHERE b.category_id = c.id AND b.fiscal_year = ${FY}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ledger_transactions t
        WHERE t.category_id = c.id AND t.txn_date BETWEEN ${FY_START} AND ${FY_END}
      )
    ORDER BY e.slug, c.fund_kind, c.flow, c.name`;

  const neverUsed = candidates.filter((c) => c.all_txns === 0);
  const dormant = candidates.filter((c) => c.all_txns > 0);

  console.log(`Never used (${neverUsed.length}):`);
  for (const c of neverUsed) console.log(`  ${c.entity}/${c.fund_kind}/${c.flow}  ${c.name}`);
  console.log(`\nDormant — history, but nothing in FY${FY} (${dormant.length}):`);
  for (const c of dormant) {
    console.log(`  ${c.entity}/${c.fund_kind}/${c.flow}  ${c.name}  (${c.all_txns} txn(s), last ${c.last_used})`);
  }
  console.log(`\nTOTAL to retire: ${candidates.length}`);

  // Show what the transaction-activity condition protected, so the exclusion is
  // visible rather than implicit.
  const protectedByActivity = await sql`
    SELECT e.slug AS entity, c.name,
      (SELECT count(*)::int FROM ledger_transactions t
        WHERE t.category_id = c.id AND t.txn_date BETWEEN ${FY_START} AND ${FY_END}) AS fy_txns
    FROM ledger_categories c
    JOIN ledger_entities e ON e.id = c.entity_id
    WHERE c.is_active
      AND NOT EXISTS (SELECT 1 FROM ledger_budgets b WHERE b.category_id = c.id AND b.fiscal_year = ${FY})
      AND EXISTS (
        SELECT 1 FROM ledger_transactions t
        WHERE t.category_id = c.id AND t.txn_date BETWEEN ${FY_START} AND ${FY_END}
      )
    ORDER BY c.name`;
  if (protectedByActivity.length) {
    console.log(`\nKEPT — unbudgeted but used in FY${FY} (${protectedByActivity.length}):`);
    for (const c of protectedByActivity) console.log(`  ${c.entity}  ${c.name}  (${c.fy_txns} FY${FY} txn(s))`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to retire these.");
    await sql.end();
    return;
  }
  if (candidates.length === 0) {
    console.log("\nNothing to do.");
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    for (const c of candidates) {
      const updated = await tx`
        UPDATE ledger_categories SET is_active = false
        WHERE id = ${c.id} AND is_active = true
        RETURNING id`;
      if (updated.length === 0) continue; // already inactive — no audit row for a no-op
      await tx`
        INSERT INTO ledger_audit_log (actor_user_id, action, target_category_id, before, after, details)
        VALUES (
          ${actor.id}, 'category_deactivated', ${c.id},
          ${JSON.stringify({ isActive: true })}, ${JSON.stringify({ isActive: false })},
          ${`Bulk retirement: no FY${FY} budget and no FY${FY} activity.`}
        )`;
    }
  });

  const [after] = await sql`
    SELECT
      (SELECT count(*)::int FROM ledger_categories WHERE is_active) AS active,
      (SELECT count(*)::int FROM ledger_categories WHERE NOT is_active) AS inactive,
      (SELECT count(*)::int FROM ledger_audit_log WHERE action = 'category_deactivated') AS audit_rows`;
  console.log(
    `\nApplied. Active categories: ${after.active}, retired: ${after.inactive}, ` +
      `audit rows recorded: ${after.audit_rows}`,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

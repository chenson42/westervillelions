/**
 * One-off: adds a "Kroger Community Rewards" income category to the
 * Foundation's charitable fund, and moves the five historical Kroger deposits
 * into it from "Public donations".
 *
 * WHY SPLIT IT OUT
 *   Kroger Community Rewards is a distinct, recurring, passive revenue stream
 *   with an action attached: households must RE-ENROL ANNUALLY and enrolment
 *   lapses silently. Filed under "Public donations" it is invisible, and the
 *   trend already looks like a slowly lapsing base:
 *
 *     2024-10-12  $35.88
 *     2025-01-25  $31.19
 *     2025-07-02  $26.80
 *     2026-01-10  $29.95
 *     2026-04-21  $29.77
 *
 *   It was also five of the twelve rows in "Public donations", diluting both
 *   itself and the genuine one-off gifts (a memorial collection, farmers-market
 *   cash, an individual donor, a Thrivent grant).
 *
 * FIELD CHOICES, and the one that differs from the template
 *   Copied from the "Public donations" row: entity (Foundation), fund_kind
 *   'charitable', flow 'income', form_990_line 'Contributions/gifts/grants',
 *   counts_as_giving true. It is a contribution and is reported as one.
 *
 *   DIFFERENT: `ack_not_required` is TRUE here, where "Public donations" has
 *   FALSE. There is no donor to thank. Kroger's quarterly rewards payment is a
 *   corporate program disbursement, not a gift from a person, and nobody writes
 *   an acknowledgment letter for it. Left as FALSE these five rows would sit in
 *   the treasurer's unacknowledged-gifts list forever.
 *
 * WHAT THIS DOES NOT TOUCH
 *   Amounts, dates, entity, fund, and bank reconciliation are all unchanged.
 *   Only the category label moves, so reconciled months stay reconciled.
 *
 * Writes ledger_audit_log rows for the category creation and for the
 * reclassification, matching the shape the categories admin surface writes.
 *
 * Usage:
 *   pnpm exec tsx scripts/add-kroger-rewards-category.ts            # dry run
 *   pnpm exec tsx scripts/add-kroger-rewards-category.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL when set (loud banner), else DATABASE_URL/DB_URL.
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

const NEW_NAME = "Kroger Community Rewards";
const SOURCE_NAME = "Public donations";
// Attributed to the treasurer, who asked for this. Set to your own account's
// email before running — see CLAUDE.md -> Environment Variables.
const ACTOR_EMAIL = process.env.SCRIPT_OPERATOR_EMAIL ?? (() => {
  throw new Error("Set SCRIPT_OPERATOR_EMAIL in your environment (the users.email row this write is attributed to).");
})();
const money = (c: number) => "$" + (c / 100).toFixed(2);

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const [actor] = await sql`SELECT id FROM users WHERE email = ${ACTOR_EMAIL}`;
  if (!actor) throw new Error(`Could not resolve actor ${ACTOR_EMAIL}`);

  const [src] = await sql`SELECT * FROM ledger_categories WHERE name = ${SOURCE_NAME}`;
  if (!src) throw new Error(`Template category "${SOURCE_NAME}" not found.`);

  // The rows to move: Kroger deposits currently sitting in Public donations.
  const rows = await sql`
    SELECT t.id, t.txn_date::text AS d, t.party, t.amount_cents
    FROM ledger_transactions t
    WHERE t.category_id = ${src.id}
      AND (t.party ILIKE '%kroger%' OR t.memo ILIKE '%kroger%' OR t.public_note ILIKE '%kroger%')
    ORDER BY t.txn_date`;

  console.log(`Category to create: "${NEW_NAME}"`);
  console.log(`  entity/fund : ${src.fund_kind} (same as "${SOURCE_NAME}")`);
  console.log(`  flow        : ${src.flow}`);
  console.log(`  990 line    : ${src.form_990_line}`);
  console.log(`  counts as giving : ${src.counts_as_giving}`);
  console.log(`  ack not required : true   <-- differs from "${SOURCE_NAME}" (no donor to thank)`);
  console.log(`\nTransactions to reclassify: ${rows.length}`);
  let total = 0;
  for (const r of rows) {
    total += Number(r.amount_cents);
    console.log(`  ${r.d}  ${money(r.amount_cents).padStart(9)}  ${r.party}`);
  }
  console.log(`  ${"total".padStart(12)}  ${money(total).padStart(9)}`);

  const [existing] = await sql`SELECT id FROM ledger_categories WHERE name = ${NEW_NAME}`;
  if (existing) {
    console.log(`\n"${NEW_NAME}" already exists (id=${existing.id}). Nothing to create.`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    return;
  }

  await sql.begin(async (tx) => {
    let catId: string;
    if (existing) {
      catId = existing.id;
    } else {
      const [created] = await tx`
        INSERT INTO ledger_categories (
          entity_id, fund_kind, flow, name, form_990_line,
          sort_order, is_active, counts_as_giving, ack_not_required
        ) VALUES (
          ${src.entity_id}, ${src.fund_kind}, ${src.flow}, ${NEW_NAME}, ${src.form_990_line},
          ${src.sort_order}, true, ${src.counts_as_giving}, true
        ) RETURNING id`;
      catId = created.id;
      await tx`
        INSERT INTO ledger_audit_log (actor_user_id, action, target_category_id, before, after, details)
        VALUES (${actor.id}, 'category_created', ${catId}, NULL,
                ${JSON.stringify({ name: NEW_NAME, flow: src.flow, fundKind: src.fund_kind, ackNotRequired: true })},
                ${'Kroger Community Rewards split out of "Public donations" so the quarterly loyalty-card income is visible and re-enrolment can be tracked.'})`;
      console.log(`\nCreated category ${catId}`);
    }

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await tx`UPDATE ledger_transactions SET category_id = ${catId}, updated_at = now()
               WHERE id = ANY(${ids})`;
      await tx`
        INSERT INTO ledger_audit_log (actor_user_id, action, target_category_id, before, after, details)
        VALUES (${actor.id}, 'transactions_recategorized', ${catId},
                ${JSON.stringify({ category: SOURCE_NAME })},
                ${JSON.stringify({ category: NEW_NAME })},
                ${`Moved ${rows.length} historical Kroger deposits (${money(total)}) from "${SOURCE_NAME}". Amounts, dates and reconciliation unchanged.`})`;
      console.log(`Reclassified ${rows.length} transactions.`);
    }
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });

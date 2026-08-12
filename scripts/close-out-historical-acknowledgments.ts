/**
 * Closes out historical donor acknowledgments that predate the Ledger
 * (treasurer-approved 2026-08-08).
 *
 *   pnpm exec tsx scripts/close-out-historical-acknowledgments.ts --through=2026-03-07
 *   pnpm exec tsx scripts/close-out-historical-acknowledgments.ts --through=2026-03-07 --apply
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 *
 * WHY: `listPendingAcknowledgments()` queues every Foundation income transaction
 * >= $250 for an IRS Pub. 1771 letter. The club's books were seeded from Quicken
 * in July 2026, so every sponsor gift going back to 2024 landed on that queue at
 * once — 55 rows — even though those gifts were acknowledged outside this system
 * at the time. The queue is a task list; these are not tasks.
 *
 * SCOPE — deliberately narrow. Only categories that genuinely represent an
 * individual donor's gift are closed out. The five categories excluded below
 * produce income that never warrants a donor acknowledgment:
 *
 *   Rudolph Run – Registration/Entry Fees  race entries: aggregated deposits, and
 *                                          the payer received a race entry in return
 *   Pancake Breakfast                      event receipts
 *   Fundraising events                     pooled fundraiser deposit
 *   Grants received                        a grant is not a donor gift
 *   Transfer from Club                     internal sweep, not outside money
 *
 * Writing "a written acknowledgment for $16,612.56 was sent to Rudolph Run Entry
 * Receipts" would be a false IRS substantiation record. Those categories are being
 * handled structurally instead, via a per-category "acknowledgment not required"
 * flag (docs/work-log/2026-08-08-ack-not-required-flag.md).
 *
 * HONESTY: each row written carries `letter_text` stating plainly that it was
 * closed out in bulk as a historical gift, that the letter was handled outside
 * the Ledger, and on what date the closeout ran. A future treasurer can tell
 * these apart from a letter actually composed in the app. `donor_id` is left
 * NULL — no donor records exist for these parties, and inventing them from party
 * strings would create duplicates (the data already contains "M/I Homes" vs
 * "MI Homes", "Comfort Crew Heating & Cooling" vs "and Cooling").
 *
 * IDEMPOTENT: skips any transaction that already has an acknowledgment row.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const thruArg = process.argv.find((a) => a.startsWith("--through="));
if (!thruArg) throw new Error("--through=YYYY-MM-DD is required.");
const THROUGH = thruArg.split("=")[1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(THROUGH)) throw new Error(`--through must be YYYY-MM-DD, got ${THROUGH}`);

// Categories whose income never warrants a donor acknowledgment letter.
const EXCLUDED_CATEGORIES = [
  "Rudolph Run – Registration/Entry Fees",
  "Pancake Breakfast",
  "Fundraising events",
  "Grants received",
  "Transfer from Club",
];

const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const ACTOR_EMAIL = process.env.SCRIPT_OPERATOR_EMAIL ?? (() => {
  throw new Error("Set SCRIPT_OPERATOR_EMAIL in your environment (the users.email row this write is attributed to).");
})();
const CLOSEOUT_NOTE =
  "Closed out in bulk on 2026-08-08 as a historical gift predating the Ledger. " +
  "Acknowledgment was handled outside this system at the time; no letter was composed here.";

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  through ${THROUGH}  |  ` +
      `Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`,
  );

  const [actor] = await sql`SELECT id FROM users WHERE email = ${ACTOR_EMAIL}`;
  if (!actor) throw new Error(`No users row for ${ACTOR_EMAIL}.`);

  const rows = await sql`
    SELECT t.id, t.txn_date, t.amount_cents, t.party, c.name AS category
    FROM ledger_transactions t
    JOIN ledger_entities e ON e.id = t.entity_id
    JOIN ledger_categories c ON c.id = t.category_id
    WHERE e.donations_deductible
      AND t.flow = 'income' AND t.status = 'posted'
      AND t.amount_cents >= 25000
      AND t.txn_date <= ${THROUGH}
      AND c.name <> ALL(${EXCLUDED_CATEGORIES})
      AND NOT EXISTS (SELECT 1 FROM ledger_acknowledgments a WHERE a.donation_txn_id = t.id)
    ORDER BY t.txn_date DESC`;

  console.log(`To close out (${rows.length}):`);
  for (const r of rows) console.log(`  ${r.txn_date}  ${money(r.amount_cents).padStart(11)}  ${r.party}`);
  console.log(`\nTotal: ${money(rows.reduce((s, r) => s + r.amount_cents, 0))}`);

  // Show what the category exclusion protected, so it is visible rather than implicit.
  const skipped = await sql`
    SELECT t.txn_date, t.amount_cents, t.party, c.name AS category
    FROM ledger_transactions t
    JOIN ledger_entities e ON e.id = t.entity_id
    JOIN ledger_categories c ON c.id = t.category_id
    WHERE e.donations_deductible
      AND t.flow = 'income' AND t.status = 'posted'
      AND t.amount_cents >= 25000
      AND t.txn_date <= ${THROUGH}
      AND c.name = ANY(${EXCLUDED_CATEGORIES})
      AND NOT EXISTS (SELECT 1 FROM ledger_acknowledgments a WHERE a.donation_txn_id = t.id)
    ORDER BY t.txn_date DESC`;
  if (skipped.length) {
    console.log(`\nDELIBERATELY SKIPPED — not donor gifts (${skipped.length}):`);
    for (const r of skipped) {
      console.log(`  ${r.txn_date}  ${money(r.amount_cents).padStart(11)}  ${r.party}  [${r.category}]`);
    }
    console.log("  (handled structurally by the per-category 'acknowledgment not required' flag)");
  }

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await sql.end();
    return;
  }
  if (rows.length === 0) {
    console.log("\nNothing to do.");
    await sql.end();
    return;
  }

  // INSERT ... SELECT so `txn_date` is copied inside Postgres and never round-trips
  // through a JS Date. A `date` column marshalled out to JS and back can shift by a
  // day depending on how the driver interprets the local timezone — the same class of
  // bug this project has hit before with naive timestamps.
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO ledger_acknowledgments
        (donation_txn_id, donor_id, amount_cents, txn_date, type, sent_at, letter_text, recorded_by_user_id)
      SELECT t.id, NULL, t.amount_cents, t.txn_date, 'written_ack_250', now(),
             ${CLOSEOUT_NOTE}, ${actor.id}
      FROM ledger_transactions t
      JOIN ledger_entities e ON e.id = t.entity_id
      JOIN ledger_categories c ON c.id = t.category_id
      WHERE e.donations_deductible
        AND t.flow = 'income' AND t.status = 'posted'
        AND t.amount_cents >= 25000
        AND t.txn_date <= ${THROUGH}
        AND c.name <> ALL(${EXCLUDED_CATEGORIES})
        AND NOT EXISTS (SELECT 1 FROM ledger_acknowledgments a WHERE a.donation_txn_id = t.id)`;
  });

  const [after] = await sql`
    SELECT
      (SELECT count(*)::int FROM ledger_acknowledgments) AS total_acks,
      (SELECT count(*)::int FROM ledger_acknowledgments WHERE sent_at IS NOT NULL) AS sent`;
  console.log(`\nApplied. Acknowledgment rows: ${after.total_acks}, marked sent: ${after.sent}`);

  const remaining = await sql`
    SELECT t.txn_date, t.amount_cents, t.party, c.name AS category
    FROM ledger_transactions t
    JOIN ledger_entities e ON e.id = t.entity_id
    JOIN ledger_categories c ON c.id = t.category_id
    LEFT JOIN ledger_acknowledgments a ON a.donation_txn_id = t.id
    WHERE e.donations_deductible AND t.flow = 'income' AND t.status = 'posted'
      AND t.amount_cents >= 25000 AND (a.id IS NULL OR a.sent_at IS NULL)
    ORDER BY t.txn_date DESC`;
  console.log(`\nStill on the pending queue (${remaining.length}):`);
  for (const r of remaining) {
    console.log(`  ${r.txn_date}  ${money(r.amount_cents).padStart(11)}  ${r.party}  [${r.category}]`);
  }

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

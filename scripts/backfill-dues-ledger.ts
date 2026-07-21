/**
 * One-off backfill of missing dues auto-post ledger rows in PRODUCTION.
 *
 * 14 of production's 21 dues_payments rows (recorded 2026-06-24 -> 2026-07-03,
 * $1,661 total) predate the deployed dues-auto-post feature (DECISION-025,
 * src/lib/dues-ledger-sync.ts) and have no linked ledger_transactions row.
 * This script inserts the missing rows, mirroring syncDuesCreate's row shape
 * EXACTLY so the backfilled rows are indistinguishable from auto-posted ones
 * except for their creation timestamp.
 *
 * Selection: dues_payments with NO ledger_transactions row referencing them
 * (LEFT JOIN ... IS NULL). The unique constraint on
 * ledger_transactions.dues_payment_id makes double-posting impossible, so
 * this script is naturally idempotent — a second run inserts zero rows.
 *
 * Target: PROD_DATABASE_URL env var — a production Neon connection string,
 * passed at invocation time. NEVER written to any file in this repo.
 *
 * Usage:
 *   PROD_DATABASE_URL="postgres://..." pnpm exec tsx scripts/backfill-dues-ledger.ts            # dry run (default)
 *   PROD_DATABASE_URL="postgres://..." pnpm exec tsx scripts/backfill-dues-ledger.ts --apply
 *
 * Explicitly NOT run against dev — dev's dues_payments rows are test-era data.
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, ilike, isNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  ledgerTransactions,
  duesPayments,
  members,
  users,
} from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");
const TREASURER_EMAIL = "chenson42@gmail.com";

const EXPECTED_BACKFILL_COUNT = 14;
const EXPECTED_BACKFILL_SUM_CENTS = 166_100; // $1,661.00
const EXPECTED_DUES_TOTAL_CENTS = 250_100; // $2,501.00 (7 existing + 14 backfilled)
const EXPECTED_CLUB_HISTORICAL_CENTS = 1_621_864; // $16,218.64 (from the ledger port, Task 1)
const EXPECTED_CLUB_TOTAL_WITH_DUES_CENTS = EXPECTED_CLUB_HISTORICAL_CENTS + EXPECTED_DUES_TOTAL_CENTS; // $18,719.64

function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

const targetUrl = process.env.PROD_DATABASE_URL;
if (!targetUrl) {
  throw new Error("PROD_DATABASE_URL is not set — pass the production connection string via env var");
}

const targetClient = postgres(targetUrl);
const targetDb = drizzle(targetClient, { schema });

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes to production)" : "DRY RUN (no writes)"}`);
  console.log("Target: production only — dev's dues_payments rows are test-era, intentionally skipped.");
  console.log("");

  // Step 1: resolve Club entity (mirrors syncDuesCreate step 1)
  const entityRows = await targetDb
    .select({ id: ledgerEntities.id })
    .from(ledgerEntities)
    .where(eq(ledgerEntities.slug, "club"))
    .limit(1);
  const clubEntity = entityRows[0];
  if (!clubEntity) throw new Error("Production ledger_entities has no row for slug='club'");

  // Step 2: resolve Administrative fund (mirrors syncDuesCreate step 2)
  const fundRows = await targetDb
    .select({ id: ledgerFunds.id })
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, clubEntity.id), eq(ledgerFunds.slug, "administrative")))
    .limit(1);
  const adminFund = fundRows[0];
  if (!adminFund) throw new Error("Production has no administrative fund for the Club entity");

  // Step 3: resolve "Club dues" income category (mirrors syncDuesCreate step 3 — graceful, null if missing)
  const catRows = await targetDb
    .select({ id: ledgerCategories.id })
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, clubEntity.id),
        eq(ledgerCategories.fundKind, "administrative"),
        eq(ledgerCategories.flow, "income"),
        ilike(ledgerCategories.name, "club dues"),
      ),
    )
    .limit(1);
  const categoryId = catRows[0]?.id ?? null;
  if (!categoryId) {
    console.warn("WARNING: no 'Club dues' income category found in production — backfilled rows will have categoryId = null (matches syncDuesCreate's graceful fallback)");
  }

  // recorded_by_user_id: production chenson42@gmail.com user
  const userRows = await targetDb.select({ id: users.id }).from(users).where(eq(users.email, TREASURER_EMAIL)).limit(1);
  const treasurer = userRows[0];
  if (!treasurer) throw new Error(`Production has no users row for ${TREASURER_EMAIL}`);

  // Selection: dues_payments with no linked ledger_transactions row
  const missing = await targetDb
    .select({
      id: duesPayments.id,
      memberId: duesPayments.memberId,
      amountCents: duesPayments.amountCents,
      paymentDate: duesPayments.paymentDate,
      method: duesPayments.method,
      fiscalYear: duesPayments.fiscalYear,
      firstName: members.firstName,
      lastName: members.lastName,
    })
    .from(duesPayments)
    .leftJoin(ledgerTransactions, eq(ledgerTransactions.duesPaymentId, duesPayments.id))
    .innerJoin(members, eq(members.id, duesPayments.memberId))
    .where(isNull(ledgerTransactions.id))
    .orderBy(duesPayments.paymentDate);

  console.log(`=== Dues payments with no ledger row (${missing.length}) ===`);
  let sum = 0;
  for (const p of missing) {
    const name = `${p.firstName} ${p.lastName}`.trim();
    console.log(`  ${p.paymentDate}  ${name.padEnd(28)}  ${fmt(p.amountCents).padStart(10)}  ${p.method}`);
    sum += p.amountCents;
  }
  console.log(`  Total: ${fmt(sum)}`);
  console.log("");

  if (missing.length !== EXPECTED_BACKFILL_COUNT || sum !== EXPECTED_BACKFILL_SUM_CENTS) {
    console.warn(
      `WARNING: expected ${EXPECTED_BACKFILL_COUNT} rows / ${fmt(EXPECTED_BACKFILL_SUM_CENTS)}, found ${missing.length} / ${fmt(sum)}. Proceeding with what's found.`,
    );
  }

  console.log("=== Expected post-apply verification numbers ===");
  console.log(`  Ledger dues total (7 existing + backfilled): ${fmt(EXPECTED_DUES_TOTAL_CENTS)}`);
  console.log(
    `  Overall club balance: historical ${fmt(EXPECTED_CLUB_HISTORICAL_CENTS)} + dues ${fmt(EXPECTED_DUES_TOTAL_CENTS)} = ${fmt(EXPECTED_CLUB_TOTAL_WITH_DUES_CENTS)}`,
  );
  console.log(
    "  Note: the treasurer's register export predates these Zeffy/check deposits, so this total exceeding the register's historical ending balance is expected, not an error.",
  );
  console.log("");

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to execute against production.");
    await targetClient.end();
    return;
  }

  console.log("Applying...");

  await targetDb.transaction(async (tx) => {
    for (const p of missing) {
      const memberName = `${p.firstName} ${p.lastName}`.trim();
      await tx.insert(ledgerTransactions).values({
        entityId: clubEntity.id,
        fundId: adminFund.id,
        txnDate: p.paymentDate,
        flow: "income",
        categoryId,
        amountCents: p.amountCents,
        party: memberName,
        paymentMethod: p.method,
        status: "posted",
        duesPaymentId: p.id,
        syncStale: false,
        recordedByUserId: treasurer.id,
      });
    }
  });

  console.log("Apply complete.");
  console.log("");

  // Post-verify
  console.log("=== Post-apply verification ===");

  const unlinkedRows = await targetClient`
    select count(*)::int as n
    from dues_payments dp
    left join ledger_transactions lt on lt.dues_payment_id = dp.id
    where lt.id is null
  `;
  console.log(`Dues payments with no ledger row: ${unlinkedRows[0].n} (expected 0) ${unlinkedRows[0].n === 0 ? "OK" : "MISMATCH"}`);

  const duesTotalRows = await targetClient`
    select count(*)::int as n, coalesce(sum(amount_cents), 0)::int as sum_cents
    from ledger_transactions where dues_payment_id is not null
  `;
  const duesTotalOk = duesTotalRows[0].sum_cents === EXPECTED_DUES_TOTAL_CENTS;
  console.log(
    `Ledger dues total: ${duesTotalRows[0].n} rows / ${fmt(duesTotalRows[0].sum_cents)} (expected ${fmt(EXPECTED_DUES_TOTAL_CENTS)}) ${duesTotalOk ? "OK" : "MISMATCH"}`,
  );

  const clubBalanceRows = await targetClient`
    select
      coalesce((select sum(opening_balance_cents) from ledger_funds f join ledger_entities e on e.id = f.entity_id where e.slug = 'club'), 0)::int as opening_cents,
      coalesce((select sum(case when lt.flow = 'income' then lt.amount_cents else -lt.amount_cents end)
                from ledger_transactions lt join ledger_entities e on e.id = lt.entity_id
                where e.slug = 'club'), 0)::int as net_cents
  `;
  const clubTotal = clubBalanceRows[0].opening_cents + clubBalanceRows[0].net_cents;
  const clubOk = clubTotal === EXPECTED_CLUB_TOTAL_WITH_DUES_CENTS;
  console.log(
    `Overall club balance: ${fmt(clubTotal)} (expected ${fmt(EXPECTED_CLUB_TOTAL_WITH_DUES_CENTS)}) ${clubOk ? "OK" : "MISMATCH"}`,
  );
  console.log(
    "  (Register export predates these Zeffy/check deposits — exceeding the register's historical ending balance is expected.)",
  );

  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await targetClient.end();
  process.exit(1);
});

/**
 * One-off port of the hardened DEV ledger data to PRODUCTION.
 *
 * The user (club treasurer) explicitly wants production's ledger data to match
 * DEV's *current* state (reviewed/hardened 2026-07-20) — this is NOT a re-run
 * of the Quicken CSV import (see scripts/import-quicken-ledger.ts for that).
 *
 * Source: DATABASE_URL in .env.local (dev Neon DB).
 * Target: PROD_DATABASE_URL env var — a production Neon connection string,
 *         passed at invocation time. NEVER written to any file in this repo.
 *
 * Usage:
 *   pnpm exec tsx scripts/port-ledger-dev-to-prod.ts                # dry run (default)
 *   PROD_DATABASE_URL="postgres://..." pnpm exec tsx scripts/port-ledger-dev-to-prod.ts --apply
 *
 * What it does (idempotent — safe to re-run):
 *   1. Upserts the dev-only ledger_categories rows into production (matched by
 *      natural key: entity slug + fund_kind + flow + name) and syncs
 *      counts_as_giving on every production category to match dev.
 *   2. Updates production ledger_funds.opening_balance_cents to dev's values
 *      (matched by entity slug + fund slug).
 *   3. Renames the two production placeholder bank accounts to dev's names
 *      (institution set to NULL), matched 1:1 by entity (each entity has
 *      exactly one bank account in both dev and production).
 *   4. Deletes any production ledger_transactions rows whose memo ends
 *      "[quicken-import]" (idempotency — zero on first run), then inserts the
 *      276 dev marker rows, remapped to production's entity/fund/category/
 *      bank-account ids and recorded_by_user_id.
 *
 * NEVER touches rows with dues_payment_id set, or rows whose memo does not
 * end in the "[quicken-import]" marker.
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, like } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  ledgerBankAccounts,
  ledgerTransactions,
  users,
} from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");
const MARKER = "[quicken-import]";
const TREASURER_EMAIL = "chenson42@gmail.com";

// Expected verification targets (per task spec) — printed and checked post-apply.
const EXPECTED_MARKER_COUNT = 276;
const EXPECTED_DUES_COUNT = 7;
const EXPECTED_DUES_SUM_CENTS = 84_000; // $840.00
const EXPECTED_CLUB_CENTS = 1_621_864; // $16,218.64
const EXPECTED_FOUNDATION_CENTS = 483_657; // $4,836.57
const EXPECTED_CAUSE_TOTALS_CENTS: Record<string, number> = {
  "Youth & Education": 2_330_000,
  "Hunger & Basic Needs": 1_330_000,
  "Vision & Eye Care": 1_090_000,
  "Disaster Relief": 500_000,
  "Health & Disability": 475_000,
  "Lions International Programs": 400_000,
  "Community & Civic": 40_000,
  "Bags to Benches (Recycling)": 37_453,
};
const EXPECTED_OVERHEAD_CATEGORY_NAMES = new Set([
  "Insurance & bonding",
  "Fundraising event costs",
  "Operations",
]);

function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const sourceUrl = process.env.DATABASE_URL || process.env.DB_URL;
if (!sourceUrl) {
  throw new Error("DATABASE_URL (or DB_URL) is not set — expected dev connection from .env.local");
}
const targetUrl = process.env.PROD_DATABASE_URL;
if (!targetUrl) {
  throw new Error("PROD_DATABASE_URL is not set — pass the production connection string via env var");
}

const sourceClient = postgres(sourceUrl);
const sourceDb = drizzle(sourceClient, { schema });

const targetClient = postgres(targetUrl);
const targetDb = drizzle(targetClient, { schema });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryKey = string; // `${entitySlug}::${fundKind}::${flow}::${name}`
function catKey(entitySlug: string, fundKind: string, flow: string, name: string): CategoryKey {
  return `${entitySlug}::${fundKind}::${flow}::${name}`;
}

type FundKey = string; // `${entitySlug}::${fundSlug}`
function fundKey(entitySlug: string, fundSlug: string): FundKey {
  return `${entitySlug}::${fundSlug}`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes to production)" : "DRY RUN (no writes)"}`);
  console.log("");

  // -------------------------------------------------------------------------
  // Read SOURCE (dev)
  // -------------------------------------------------------------------------

  const srcEntities = await sourceDb
    .select({ id: ledgerEntities.id, slug: ledgerEntities.slug })
    .from(ledgerEntities);
  const srcEntitySlugById = new Map(srcEntities.map((e) => [e.id, e.slug]));

  const srcFundsRaw = await sourceDb
    .select({
      id: ledgerFunds.id,
      entityId: ledgerFunds.entityId,
      slug: ledgerFunds.slug,
      openingBalanceCents: ledgerFunds.openingBalanceCents,
    })
    .from(ledgerFunds);
  const srcFunds = srcFundsRaw.map((f) => ({
    ...f,
    entitySlug: srcEntitySlugById.get(f.entityId)!,
  }));
  const srcFundSlugById = new Map(srcFunds.map((f) => [f.id, { entitySlug: f.entitySlug, fundSlug: f.slug }]));

  const srcCategoriesRaw = await sourceDb
    .select({
      id: ledgerCategories.id,
      entityId: ledgerCategories.entityId,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
      name: ledgerCategories.name,
      sortOrder: ledgerCategories.sortOrder,
      countsAsGiving: ledgerCategories.countsAsGiving,
    })
    .from(ledgerCategories);
  const srcCategories = srcCategoriesRaw.map((c) => ({
    ...c,
    entitySlug: srcEntitySlugById.get(c.entityId)!,
  }));
  const srcCategoryById = new Map(
    srcCategories.map((c) => [c.id, { entitySlug: c.entitySlug, fundKind: c.fundKind, flow: c.flow, name: c.name }]),
  );

  const srcBankAccountsRaw = await sourceDb
    .select({ id: ledgerBankAccounts.id, entityId: ledgerBankAccounts.entityId, name: ledgerBankAccounts.name })
    .from(ledgerBankAccounts);
  const srcBankAccountsByEntitySlug = new Map<string, { name: string }>();
  for (const b of srcBankAccountsRaw) {
    const slug = srcEntitySlugById.get(b.entityId)!;
    srcBankAccountsByEntitySlug.set(slug, { name: b.name });
  }

  const srcTxns = await sourceDb
    .select()
    .from(ledgerTransactions)
    .where(like(ledgerTransactions.memo, `%${MARKER}`));

  if (srcTxns.length !== EXPECTED_MARKER_COUNT) {
    console.warn(
      `WARNING: expected ${EXPECTED_MARKER_COUNT} dev marker rows, found ${srcTxns.length}. Proceeding with what's found.`,
    );
  }

  // -------------------------------------------------------------------------
  // Read TARGET (production)
  // -------------------------------------------------------------------------

  const tgtEntities = await targetDb
    .select({ id: ledgerEntities.id, slug: ledgerEntities.slug })
    .from(ledgerEntities);
  const tgtEntityIdBySlug = new Map(tgtEntities.map((e) => [e.slug, e.id]));
  for (const slug of ["club", "foundation"]) {
    if (!tgtEntityIdBySlug.has(slug)) {
      throw new Error(`Production is missing ledger_entities row for slug '${slug}'`);
    }
  }

  const tgtFundsRaw = await targetDb
    .select({
      id: ledgerFunds.id,
      entityId: ledgerFunds.entityId,
      slug: ledgerFunds.slug,
      openingBalanceCents: ledgerFunds.openingBalanceCents,
    })
    .from(ledgerFunds);
  const tgtEntitySlugById = new Map(tgtEntities.map((e) => [e.id, e.slug]));
  const tgtFundIdByKey = new Map<FundKey, string>();
  const tgtFundOpeningByKey = new Map<FundKey, number>();
  for (const f of tgtFundsRaw) {
    const entitySlug = tgtEntitySlugById.get(f.entityId)!;
    const key = fundKey(entitySlug, f.slug);
    tgtFundIdByKey.set(key, f.id);
    tgtFundOpeningByKey.set(key, f.openingBalanceCents);
  }

  const tgtCategoriesRaw = await targetDb
    .select({
      id: ledgerCategories.id,
      entityId: ledgerCategories.entityId,
      fundKind: ledgerCategories.fundKind,
      flow: ledgerCategories.flow,
      name: ledgerCategories.name,
      countsAsGiving: ledgerCategories.countsAsGiving,
    })
    .from(ledgerCategories);
  const tgtCategoryByKey = new Map<
    CategoryKey,
    { id: string; countsAsGiving: boolean }
  >();
  for (const c of tgtCategoriesRaw) {
    const entitySlug = tgtEntitySlugById.get(c.entityId)!;
    tgtCategoryByKey.set(catKey(entitySlug, c.fundKind, c.flow, c.name), {
      id: c.id,
      countsAsGiving: c.countsAsGiving,
    });
  }

  const tgtBankAccountsRaw = await targetDb
    .select({ id: ledgerBankAccounts.id, entityId: ledgerBankAccounts.entityId, name: ledgerBankAccounts.name })
    .from(ledgerBankAccounts);
  const tgtBankAccountByEntitySlug = new Map<string, { id: string; name: string }>();
  for (const b of tgtBankAccountsRaw) {
    const slug = tgtEntitySlugById.get(b.entityId)!;
    if (tgtBankAccountByEntitySlug.has(slug)) {
      throw new Error(`Production entity '${slug}' has more than one bank account — expected exactly one`);
    }
    tgtBankAccountByEntitySlug.set(slug, { id: b.id, name: b.name });
  }
  for (const slug of ["club", "foundation"]) {
    if (!tgtBankAccountByEntitySlug.has(slug)) {
      throw new Error(`Production entity '${slug}' has no bank account — expected exactly one`);
    }
  }

  const tgtUserRows = await targetDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, TREASURER_EMAIL))
    .limit(1);
  const tgtUser = tgtUserRows[0];
  if (!tgtUser) {
    throw new Error(`Production has no users row for ${TREASURER_EMAIL}`);
  }

  // -------------------------------------------------------------------------
  // Plan: categories to insert
  // -------------------------------------------------------------------------

  const categoriesToInsert = srcCategories.filter(
    (c) => !tgtCategoryByKey.has(catKey(c.entitySlug, c.fundKind, c.flow, c.name)),
  );

  console.log(`=== Categories to insert (${categoriesToInsert.length}) ===`);
  for (const c of categoriesToInsert) {
    console.log(
      `  + ${c.entitySlug} / ${c.fundKind} / ${c.flow} / "${c.name}" (sort ${c.sortOrder}, countsAsGiving=${c.countsAsGiving})`,
    );
  }
  console.log("");

  // -------------------------------------------------------------------------
  // Plan: fund opening balance updates
  // -------------------------------------------------------------------------

  console.log("=== Fund opening balance updates ===");
  const fundUpdates: { key: FundKey; entitySlug: string; fundSlug: string; from: number; to: number }[] = [];
  for (const f of srcFunds) {
    const key = fundKey(f.entitySlug, f.slug);
    if (!tgtFundIdByKey.has(key)) {
      throw new Error(`Production is missing ledger_funds row for ${key}`);
    }
    const currentOpening = tgtFundOpeningByKey.get(key)!;
    if (currentOpening !== f.openingBalanceCents) {
      fundUpdates.push({ key, entitySlug: f.entitySlug, fundSlug: f.slug, from: currentOpening, to: f.openingBalanceCents });
    }
  }
  for (const u of fundUpdates) {
    console.log(`  ${u.key}: ${fmt(u.from)} -> ${fmt(u.to)}`);
  }
  if (fundUpdates.length === 0) console.log("  (none — already matches dev)");
  console.log("");

  // -------------------------------------------------------------------------
  // Plan: bank account renames
  // -------------------------------------------------------------------------

  console.log("=== Bank account renames ===");
  const bankRenames: { entitySlug: string; id: string; from: string; to: string }[] = [];
  for (const slug of ["club", "foundation"]) {
    const src = srcBankAccountsByEntitySlug.get(slug);
    const tgt = tgtBankAccountByEntitySlug.get(slug)!;
    if (!src) {
      console.warn(`  WARNING: dev has no bank account for entity '${slug}' — skipping rename`);
      continue;
    }
    bankRenames.push({ entitySlug: slug, id: tgt.id, from: tgt.name, to: src.name });
    console.log(`  ${slug}: "${tgt.name}" -> "${src.name}" (institution -> NULL)`);
  }
  console.log("");

  // -------------------------------------------------------------------------
  // Plan: transactions delete + insert
  // -------------------------------------------------------------------------

  const existingMarkerRows = await targetDb
    .select({ id: ledgerTransactions.id })
    .from(ledgerTransactions)
    .where(like(ledgerTransactions.memo, `%${MARKER}`));

  console.log("=== Transactions ===");
  console.log(`  Will delete ${existingMarkerRows.length} existing production marker rows (expected 0 on first run)`);
  console.log(`  Will insert ${srcTxns.length} dev marker rows, remapped to production ids`);
  console.log("");

  // -------------------------------------------------------------------------
  // Print expected verification numbers
  // -------------------------------------------------------------------------

  console.log("=== Expected post-apply verification numbers ===");
  console.log(`  Marker rows: ${EXPECTED_MARKER_COUNT}`);
  console.log(`  Dues rows (untouched): ${EXPECTED_DUES_COUNT} / ${fmt(EXPECTED_DUES_SUM_CENTS)}`);
  console.log(`  Club historical balance (excl. dues rows): ${fmt(EXPECTED_CLUB_CENTS)}`);
  console.log(`  Foundation historical balance (excl. dues rows): ${fmt(EXPECTED_FOUNDATION_CENTS)}`);
  console.log("  Per-cause totals:");
  for (const [cause, cents] of Object.entries(EXPECTED_CAUSE_TOTALS_CENTS)) {
    console.log(`    ${cause}: ${fmt(cents)}`);
  }
  console.log(`  counts_as_giving=false on exactly: ${[...EXPECTED_OVERHEAD_CATEGORY_NAMES].join(", ")}`);
  console.log("");

  if (!APPLY) {
    console.log("Dry run complete. Re-run with --apply to execute against production.");
    await sourceClient.end();
    await targetClient.end();
    return;
  }

  // -------------------------------------------------------------------------
  // APPLY — everything inside one transaction
  // -------------------------------------------------------------------------

  console.log("Applying...");

  await targetDb.transaction(async (tx) => {
    // 1. Insert missing categories
    for (const c of categoriesToInsert) {
      const entityId = tgtEntityIdBySlug.get(c.entitySlug)!;
      const inserted = await tx
        .insert(ledgerCategories)
        .values({
          entityId,
          fundKind: c.fundKind,
          flow: c.flow,
          name: c.name,
          sortOrder: c.sortOrder,
          countsAsGiving: c.countsAsGiving,
        })
        .returning({ id: ledgerCategories.id });
      tgtCategoryByKey.set(catKey(c.entitySlug, c.fundKind, c.flow, c.name), {
        id: inserted[0].id,
        countsAsGiving: c.countsAsGiving,
      });
    }

    // 2. Sync counts_as_giving on ALL categories to match dev
    const srcCategoryByKeyForSync = new Map(
      srcCategories.map((c) => [catKey(c.entitySlug, c.fundKind, c.flow, c.name), c.countsAsGiving]),
    );
    for (const [key, tgtCat] of tgtCategoryByKey.entries()) {
      const srcFlag = srcCategoryByKeyForSync.get(key);
      if (srcFlag !== undefined && srcFlag !== tgtCat.countsAsGiving) {
        await tx.update(ledgerCategories).set({ countsAsGiving: srcFlag, updatedAt: new Date() }).where(eq(ledgerCategories.id, tgtCat.id));
        tgtCat.countsAsGiving = srcFlag;
      }
    }

    // 3. Update fund opening balances
    for (const u of fundUpdates) {
      const fundId = tgtFundIdByKey.get(u.key)!;
      await tx.update(ledgerFunds).set({ openingBalanceCents: u.to, updatedAt: new Date() }).where(eq(ledgerFunds.id, fundId));
    }

    // 4. Rename bank accounts
    for (const r of bankRenames) {
      await tx.update(ledgerBankAccounts).set({ name: r.to, institution: null, updatedAt: new Date() }).where(eq(ledgerBankAccounts.id, r.id));
    }

    // 5. Delete existing marker rows (idempotency), then insert remapped rows.
    // Guard rails: never touch rows with dues_payment_id set or memo not ending in the marker
    // (enforced structurally — the WHERE clause below is the only delete predicate used).
    await tx.delete(ledgerTransactions).where(like(ledgerTransactions.memo, `%${MARKER}`));

    const rowsToInsert = srcTxns.map((t) => {
      const entitySlug = srcEntitySlugById.get(t.entityId)!;
      const fund = srcFundSlugById.get(t.fundId)!;
      const targetEntityId = tgtEntityIdBySlug.get(entitySlug);
      if (!targetEntityId) throw new Error(`No production entity for slug '${entitySlug}'`);
      const targetFundId = tgtFundIdByKey.get(fundKey(fund.entitySlug, fund.fundSlug));
      if (!targetFundId) throw new Error(`No production fund for '${fundKey(fund.entitySlug, fund.fundSlug)}'`);
      const targetBankAccountId = tgtBankAccountByEntitySlug.get(entitySlug)?.id ?? null;

      let targetCategoryId: string | null = null;
      if (t.categoryId) {
        const cat = srcCategoryById.get(t.categoryId);
        if (!cat) throw new Error(`Dev transaction ${t.id} references unknown category ${t.categoryId}`);
        const tgtCat = tgtCategoryByKey.get(catKey(cat.entitySlug, cat.fundKind, cat.flow, cat.name));
        if (!tgtCat) throw new Error(`No production category for ${catKey(cat.entitySlug, cat.fundKind, cat.flow, cat.name)}`);
        targetCategoryId = tgtCat.id;
      }

      if (t.donorId) {
        throw new Error(`Dev marker transaction ${t.id} has donor_id set — porting donor links is out of scope; aborting`);
      }
      if (t.transferGroupId) {
        throw new Error(`Dev marker transaction ${t.id} has transfer_group_id set — unexpected; aborting`);
      }
      if (t.duesPaymentId) {
        throw new Error(`Dev marker transaction ${t.id} has dues_payment_id set — unexpected for a quicken-import row; aborting`);
      }

      return {
        entityId: targetEntityId,
        fundId: targetFundId,
        bankAccountId: targetBankAccountId,
        txnDate: t.txnDate,
        flow: t.flow,
        categoryId: targetCategoryId,
        amountCents: t.amountCents,
        party: t.party,
        memo: t.memo,
        beneficiaryCause: t.beneficiaryCause,
        paymentMethod: t.paymentMethod,
        receiptStorageKey: t.receiptStorageKey,
        transferGroupId: null,
        status: t.status,
        reconciled: t.reconciled,
        recordedByUserId: tgtUser.id,
        duesPaymentId: null,
        syncStale: false,
        donorId: null,
      };
    });

    // Insert in batches to avoid overly large single statements.
    const BATCH = 50;
    for (let i = 0; i < rowsToInsert.length; i += BATCH) {
      await tx.insert(ledgerTransactions).values(rowsToInsert.slice(i, i + BATCH));
    }
  });

  console.log("Apply complete.");
  console.log("");

  // -------------------------------------------------------------------------
  // Post-apply verification (fresh queries against production)
  // -------------------------------------------------------------------------

  console.log("=== Post-apply verification ===");

  const markerCountRows = await targetClient`
    select count(*)::int as n from ledger_transactions where memo like ${"%" + MARKER}
  `;
  const markerCount = markerCountRows[0].n;
  console.log(`Marker rows: ${markerCount} (expected ${EXPECTED_MARKER_COUNT}) ${markerCount === EXPECTED_MARKER_COUNT ? "OK" : "MISMATCH"}`);

  const duesRows = await targetClient`
    select count(*)::int as n, coalesce(sum(amount_cents), 0)::int as sum_cents
    from ledger_transactions where dues_payment_id is not null
  `;
  const duesOk = duesRows[0].n === EXPECTED_DUES_COUNT && duesRows[0].sum_cents === EXPECTED_DUES_SUM_CENTS;
  console.log(
    `Dues rows: ${duesRows[0].n} / ${fmt(duesRows[0].sum_cents)} (expected ${EXPECTED_DUES_COUNT} / ${fmt(EXPECTED_DUES_SUM_CENTS)}) ${duesOk ? "OK" : "MISMATCH"}`,
  );

  const balanceRows = await targetClient`
    select e.slug as entity_slug,
           coalesce(sum(case when lt.flow = 'income' then lt.amount_cents else -lt.amount_cents end), 0)::int as marker_net_cents
    from ledger_entities e
    left join ledger_transactions lt on lt.entity_id = e.id and lt.memo like ${"%" + MARKER}
    group by e.slug
  `;
  const openingRows = await targetClient`
    select e.slug as entity_slug, coalesce(sum(f.opening_balance_cents), 0)::int as opening_cents
    from ledger_entities e
    join ledger_funds f on f.entity_id = e.id
    group by e.slug
  `;
  const openingBySlug = new Map(openingRows.map((r: { entity_slug: string; opening_cents: number }) => [r.entity_slug, r.opening_cents]));
  for (const row of balanceRows as { entity_slug: string; marker_net_cents: number }[]) {
    const opening = openingBySlug.get(row.entity_slug) ?? 0;
    const total = opening + row.marker_net_cents;
    const expected = row.entity_slug === "club" ? EXPECTED_CLUB_CENTS : row.entity_slug === "foundation" ? EXPECTED_FOUNDATION_CENTS : null;
    const ok = expected !== null && total === expected;
    console.log(
      `${row.entity_slug} historical balance: ${fmt(total)} (opening ${fmt(opening)} + marker net ${fmt(row.marker_net_cents)})${expected !== null ? ` (expected ${fmt(expected)}) ${ok ? "OK" : "MISMATCH"}` : ""}`,
    );
  }

  const causeRows = await targetClient`
    select coalesce(lt.beneficiary_cause, '(none)') as cause, sum(lt.amount_cents)::int as cents
    from ledger_transactions lt
    join ledger_funds f on f.id = lt.fund_id
    left join ledger_categories c on c.id = lt.category_id
    where lt.status = 'posted'
      and lt.transfer_group_id is null
      and lt.flow = 'expense'
      and f.kind in ('activity', 'charitable', 'scholarship')
      and (c.counts_as_giving is not false)
    group by lt.beneficiary_cause
    order by cents desc
  `;
  console.log("Per-cause totals (canonical giving predicate):");
  const causeByName = new Map(causeRows.map((r: { cause: string; cents: number }) => [r.cause, r.cents]));
  for (const [cause, expectedCents] of Object.entries(EXPECTED_CAUSE_TOTALS_CENTS)) {
    const actual = causeByName.get(cause) ?? 0;
    console.log(`  ${cause}: ${fmt(actual)} (expected ${fmt(expectedCents)}) ${actual === expectedCents ? "OK" : "MISMATCH"}`);
  }
  for (const [cause, cents] of causeByName.entries()) {
    if (!(cause in EXPECTED_CAUSE_TOTALS_CENTS)) {
      console.log(`  ${cause}: ${fmt(cents)} (unexpected extra cause bucket)`);
    }
  }

  const overheadRows = await targetClient`
    select distinct name from ledger_categories where counts_as_giving = false order by name
  `;
  const overheadNames = new Set(overheadRows.map((r: { name: string }) => r.name));
  const overheadOk =
    overheadNames.size === EXPECTED_OVERHEAD_CATEGORY_NAMES.size &&
    [...EXPECTED_OVERHEAD_CATEGORY_NAMES].every((n) => overheadNames.has(n));
  console.log(
    `counts_as_giving=false category names: ${[...overheadNames].join(", ")} ${overheadOk ? "OK" : "MISMATCH"}`,
  );

  await sourceClient.end();
  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await sourceClient.end();
  await targetClient.end();
  process.exit(1);
});

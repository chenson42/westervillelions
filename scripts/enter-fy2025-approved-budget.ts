/**
 * FY2025 approved-budget entry — Club Administrative Fund + Foundation
 * Charitable Fund (treasurer-approved 2026-07-28, meeting-critical — B-25 in
 * docs/backlog.md).
 *
 * WHY THIS SCRIPT EXISTS: `ledger_budgets` has ZERO rows at fiscal_year=2025
 * (confirmed via a direct read-only query against production before this
 * script was written), so the budgeting page's "Prior Budget" reference
 * column renders blank for every category. This script enters the club's
 * board-approved "2025-2026" paper budget as CATEGORY-GRAIN
 * `ledger_budgets` rows for fiscal_year=2025, using the RECOMMENDED mappings
 * below. A read-only preview pass (run earlier, not part of this file)
 * already reconciled these exact mappings to the penny against the approved
 * budget: Club $6,980.00 income / $11,773.00 expense, Foundation $32,500.00
 * income / $42,062.00 expense.
 *
 * SCOPE — CATEGORY GRAIN ONLY. No `ledger_budget_lines` (cause/beneficiary
 * detail) are written for FY2025 here — that is a separate, optional
 * follow-up (see B-25/B-26, docs/backlog.md). This script only ever touches
 * `ledger_categories` (INSERT-if-missing, never UPDATE/DELETE) and
 * `ledger_budgets` (INSERT/UPDATE via upsert), and only for fiscal_year=2025
 * rows in the two funds named above.
 *
 * MAPPING — see MAPPING_CHOICES below. Several approved-budget paper lines
 * combine onto ONE existing category (e.g. District dues + International
 * dues + Intl new-member fee -> existing "Per-capita tax"; Tail Twisting
 * raffle + non-raffle -> existing "Tail-twisting"). Categories with no
 * existing home are CREATED (`create: true`) with the countsAsGiving value
 * specified by the treasurer. $0 paper-budget lines are omitted entirely —
 * never written as a $0 row. Every row not marked `create: true` is expected
 * to resolve to an EXISTING `ledger_categories` row; if it doesn't, the
 * script STOPS (hard error) rather than silently creating a duplicate/wrong
 * category — the recommended mappings were validated against production
 * category names before this script was written, so a resolution failure
 * here means the live schema drifted from that validation and needs human
 * eyes, not an auto-create.
 *
 * SAFETY / HARD-FAIL: before any write (dry run AND --apply), the script
 * sums the built rows per fund+flow and compares them EXACTLY to the
 * approved-budget PDF totals:
 *   Club Administrative:    income $6,980.00   / expense $11,773.00
 *   Foundation Charitable:  income $32,500.00  / expense $42,062.00
 * Any mismatch aborts (non-zero exit, no writes). This hard-fail is what
 * makes the --apply step safe to run non-interactively off the back of a
 * read-only preview.
 *
 * IDEMPOTENCY:
 *   - Category resolution: SELECT by (entity_id, fund_kind, flow, name). If
 *     missing and `create: true`, INSERT — guarded by a pre-insert
 *     existence re-check (the tsx-script equivalent of the migration
 *     `WHERE NOT EXISTS` pattern; this is a one-off script, not a SQL
 *     migration file, so it re-checks in JS rather than in the INSERT
 *     statement itself).
 *   - Budget rows: INSERT ... ON CONFLICT (fund_id, fiscal_year, category_id,
 *     flow) DO UPDATE SET annual_amount_cents = excluded value — the exact
 *     unique constraint on `ledger_budgets`
 *     (`ledger_budgets_fund_year_cat_flow_key`). Re-running (dry run or
 *     --apply) is always safe: a clean re-run either no-ops (values already
 *     match) or re-asserts the same numbers.
 *
 * Usage:
 *   pnpm exec tsx scripts/enter-fy2025-approved-budget.ts                      # dry run, local .env.local DB (default) — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/enter-fy2025-approved-budget.ts           # dry run against PRODUCTION — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/enter-fy2025-approved-budget.ts --apply   # writes to PRODUCTION
 *
 * Target selection mirrors scripts/seed-fy2026-foundation-budget.ts /
 * scripts/june-close-correction.ts: PROD_DATABASE_URL takes priority over
 * DATABASE_URL/DB_URL from .env.local (local dev default).
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, inArray, sql } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { ledgerEntities, ledgerFunds, ledgerCategories, ledgerBudgets } from "../src/lib/db/schema";

const APPLY = process.argv.includes("--apply");

const targetUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!targetUrl) {
  throw new Error(
    "No DB target found — set DATABASE_URL/DB_URL in .env.local (local dev) or pass PROD_DATABASE_URL (production).",
  );
}
const usingProd = Boolean(process.env.PROD_DATABASE_URL);

const targetClient = postgres(targetUrl);
const targetDb = drizzle(targetClient, { schema });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FISCAL_YEAR = 2025; // Jul 2025 – Jun 2026 approved budget

type FundKey = "club-administrative" | "foundation-charitable";

const FUND_DEFS: Record<FundKey, { entitySlug: string; fundSlug: string; fundKind: string }> = {
  "club-administrative": { entitySlug: "club", fundSlug: "administrative", fundKind: "administrative" },
  "foundation-charitable": { entitySlug: "foundation", fundSlug: "charitable", fundKind: "charitable" },
};

type MappingRow = {
  fund: FundKey;
  flow: "income" | "expense";
  categoryName: string;
  create: boolean;
  countsAsGiving?: boolean; // required when create=true; ignored otherwise
  amountCents: number;
  paperBudgetLine: string; // human-readable source line(s) for the audit trail
};

// RECOMMENDED mappings (treasurer-approved 2026-07-28). Every "existing"
// category name below was verified against production ledger_categories
// before this script was written — see the work-log entry for this task.
const MAPPING_CHOICES: MappingRow[] = [
  // ---- Club Administrative Fund — income ----
  { fund: "club-administrative", flow: "income", categoryName: "Club dues", create: false, amountCents: 565_500, paperBudgetLine: "Dues" },
  { fund: "club-administrative", flow: "income", categoryName: "New Member Fee", create: true, countsAsGiving: true, amountCents: 17_500, paperBudgetLine: "New Member Fee" },
  { fund: "club-administrative", flow: "income", categoryName: "Tail-twisting", create: false, amountCents: 115_000, paperBudgetLine: "Tail Twisting (raffle + non-raffle, combined)" },

  // ---- Club Administrative Fund — expense ----
  { fund: "club-administrative", flow: "expense", categoryName: "4th of July Parade", create: true, countsAsGiving: true, amountCents: 20_000, paperBudgetLine: "4th of July Parade" },
  { fund: "club-administrative", flow: "expense", categoryName: "Awards", create: true, countsAsGiving: true, amountCents: 20_000, paperBudgetLine: "Awards" },
  { fund: "club-administrative", flow: "expense", categoryName: "Contingency", create: true, countsAsGiving: false, amountCents: 50_000, paperBudgetLine: "Contingency" },
  { fund: "club-administrative", flow: "expense", categoryName: "Per-capita tax", create: false, amountCents: 355_600, paperBudgetLine: "District dues + International dues + Intl new-member fee (combined)" },
  { fund: "club-administrative", flow: "expense", categoryName: "Lion L Support", create: true, countsAsGiving: true, amountCents: 15_000, paperBudgetLine: "Lion L support" },
  { fund: "club-administrative", flow: "expense", categoryName: "Marketing", create: false, amountCents: 500_000, paperBudgetLine: "Marketing" },
  { fund: "club-administrative", flow: "expense", categoryName: "Meals", create: false, amountCents: 50_000, paperBudgetLine: "Meeting hospitality" },
  { fund: "club-administrative", flow: "expense", categoryName: "Membership", create: true, countsAsGiving: true, amountCents: 25_000, paperBudgetLine: "Membership" },
  { fund: "club-administrative", flow: "expense", categoryName: "Supplies", create: false, amountCents: 7_500, paperBudgetLine: "Office supplies" },
  { fund: "club-administrative", flow: "expense", categoryName: "Insurance & bonding", create: false, amountCents: 18_700, paperBudgetLine: "Officer Bonding" },
  { fund: "club-administrative", flow: "expense", categoryName: "Postage", create: false, amountCents: 26_000, paperBudgetLine: "Post office box" },
  { fund: "club-administrative", flow: "expense", categoryName: "Donations to Foundation", create: false, amountCents: 59_500, paperBudgetLine: "Tail Twisting for 501c3" },
  { fund: "club-administrative", flow: "expense", categoryName: "Web hosting", create: false, amountCents: 30_000, paperBudgetLine: "Website hosting" },

  // ---- Foundation Charitable Fund — income ----
  { fund: "foundation-charitable", flow: "income", categoryName: "Rudolph Run", create: false, amountCents: 2_700_000, paperBudgetLine: "Rudolph Run and Winterfest" },
  { fund: "foundation-charitable", flow: "income", categoryName: "White Cane", create: true, countsAsGiving: true, amountCents: 100_000, paperBudgetLine: "White Cane" },
  { fund: "foundation-charitable", flow: "income", categoryName: "Pancake Breakfast", create: false, amountCents: 400_000, paperBudgetLine: "Pancake Breakfast" },
  { fund: "foundation-charitable", flow: "income", categoryName: "Public donations", create: false, amountCents: 10_000, paperBudgetLine: "Donations" },
  { fund: "foundation-charitable", flow: "income", categoryName: "Restaurant fundraisers", create: true, countsAsGiving: true, amountCents: 30_000, paperBudgetLine: "Restaurant fundraisers" },
  { fund: "foundation-charitable", flow: "income", categoryName: "Miscellaneous", create: true, countsAsGiving: true, amountCents: 10_000, paperBudgetLine: "Miscellaneous" },

  // ---- Foundation Charitable Fund — expense ----
  { fund: "foundation-charitable", flow: "expense", categoryName: "Charitable donation out", create: false, amountCents: 1_617_500, paperBudgetLine: "Charitable donation out (24 named beneficiaries incl. Big Bus $500, Foundation Misc $500, LCIF $1,000)" },
  { fund: "foundation-charitable", flow: "expense", categoryName: "Grant out", create: false, amountCents: 450_000, paperBudgetLine: "Grant out (Special Interest Grants)" },
  { fund: "foundation-charitable", flow: "expense", categoryName: "Scholarships", create: false, amountCents: 750_000, paperBudgetLine: "Scholarships" },
  { fund: "foundation-charitable", flow: "expense", categoryName: "Fundraising event costs", create: false, amountCents: 1_150_000, paperBudgetLine: "Fundraising event costs (Rudolph Run $10,000 + Pancake Breakfast $1,500)" },
  { fund: "foundation-charitable", flow: "expense", categoryName: "Operations", create: false, amountCents: 220_000, paperBudgetLine: "Operations (Storage Unit)" },
  { fund: "foundation-charitable", flow: "expense", categoryName: "Insurance & bonding", create: false, amountCents: 18_700, paperBudgetLine: "Insurance & bonding (Officer Bonding)" },
];

// Expected PDF totals — the hard-fail safety net. Keyed by `${fund}|${flow}`.
const EXPECTED_TOTALS_CENTS: Record<string, number> = {
  "club-administrative|income": 698_000, // $6,980.00
  "club-administrative|expense": 1_177_300, // $11,773.00
  "foundation-charitable|income": 3_250_000, // $32,500.00
  "foundation-charitable|expense": 4_206_200, // $42,062.00
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes ledger_categories + ledger_budgets)" : "DRY RUN (no writes)"}`);
  console.log(`Target: ${usingProd ? "PRODUCTION (PROD_DATABASE_URL)" : "local (.env.local DATABASE_URL/DB_URL)"}`);
  console.log(`Fiscal year: FY${FISCAL_YEAR} (approved "2025-2026" budget)`);
  console.log(`Rows to enter: ${MAPPING_CHOICES.length}`);

  // ---- Resolve entities + funds ----
  const entityBySlug = new Map<string, typeof ledgerEntities.$inferSelect>();
  const fundByKey = new Map<FundKey, typeof ledgerFunds.$inferSelect>();

  console.log(`\nResolved references:`);
  for (const [key, def] of Object.entries(FUND_DEFS) as [FundKey, (typeof FUND_DEFS)[FundKey]][]) {
    let entity = entityBySlug.get(def.entitySlug);
    if (!entity) {
      const [row] = await targetDb.select().from(ledgerEntities).where(eq(ledgerEntities.slug, def.entitySlug));
      if (!row) throw new Error(`Could not resolve '${def.entitySlug}' row in ledger_entities on target DB.`);
      entity = row;
      entityBySlug.set(def.entitySlug, entity);
    }
    const [fund] = await targetDb
      .select()
      .from(ledgerFunds)
      .where(and(eq(ledgerFunds.entityId, entity.id), eq(ledgerFunds.slug, def.fundSlug)));
    if (!fund) throw new Error(`Could not resolve ${def.entitySlug}/${def.fundSlug} row in ledger_funds on target DB.`);
    fundByKey.set(key, fund);
    console.log(`  ${key}: entity=${entity.id} (${entity.name})  fund=${fund.id} (${fund.name})`);
  }

  // ---- Check for pre-existing FY2025 budget rows (informational — upsert handles idempotency regardless) ----
  // NOTE: selects an explicit column list (not `.select()`/all-columns) because
  // production's `ledger_budgets` does not yet have the `pending_delete_at`
  // column that schema.ts declares (migration 0066 has not deployed to
  // production as of this script's run) — an all-columns select would 500 on
  // that drift. This script never reads or writes pending_delete_at.
  const fundIds = [...fundByKey.values()].map((f) => f.id);
  const existingBudgetRows = await targetDb
    .select({
      id: ledgerBudgets.id,
      fundId: ledgerBudgets.fundId,
      fiscalYear: ledgerBudgets.fiscalYear,
      categoryId: ledgerBudgets.categoryId,
      flow: ledgerBudgets.flow,
      annualAmountCents: ledgerBudgets.annualAmountCents,
    })
    .from(ledgerBudgets)
    .where(and(eq(ledgerBudgets.fiscalYear, FISCAL_YEAR), inArray(ledgerBudgets.fundId, fundIds)));
  if (existingBudgetRows.length > 0) {
    console.log(
      `\nNOTE: ${existingBudgetRows.length} ledger_budgets row(s) already exist at fiscal_year=${FISCAL_YEAR} for these 2 funds ` +
        `(likely a prior partial run of this script). Re-running will UPSERT on (fund_id, fiscal_year, category_id, flow) — matching rows get their amount refreshed, not duplicated.`,
    );
  } else {
    console.log(`\nConfirmed: ZERO ledger_budgets rows currently exist at fiscal_year=${FISCAL_YEAR} for these 2 funds (no double-entry risk).`);
  }

  // ---- Resolve (or plan-create) each category ----
  type ResolvedRow = MappingRow & { categoryId: string | null; status: "exists" | "will-create" | "created" };
  const resolved: ResolvedRow[] = [];

  console.log(`\n${"=".repeat(78)}`);
  console.log("CATEGORY RESOLUTION");
  console.log("=".repeat(78));

  for (const row of MAPPING_CHOICES) {
    const def = FUND_DEFS[row.fund];
    const entity = entityBySlug.get(def.entitySlug)!;
    const [existing] = await targetDb
      .select()
      .from(ledgerCategories)
      .where(
        and(
          eq(ledgerCategories.entityId, entity.id),
          eq(ledgerCategories.fundKind, def.fundKind),
          eq(ledgerCategories.flow, row.flow),
          eq(ledgerCategories.name, row.categoryName),
        ),
      );

    if (existing) {
      console.log(`  EXISTS        [${row.fund}] ${row.flow.padEnd(7)} "${row.categoryName}"  (id=${existing.id})`);
      resolved.push({ ...row, categoryId: existing.id, status: "exists" });
      continue;
    }

    if (!row.create) {
      console.log(`  *** MISSING *** [${row.fund}] ${row.flow.padEnd(7)} "${row.categoryName}" — expected to already exist, but not found.`);
      console.error(
        `\nHARD FAIL — category "${row.categoryName}" (${row.fund}, flow=${row.flow}) was expected to resolve to an EXISTING ledger_categories row ` +
          `but does not. Refusing to auto-create it (only rows explicitly marked create:true may be created). Investigate before re-running.`,
      );
      await targetClient.end();
      process.exit(1);
    }

    console.log(
      `  WOULD CREATE  [${row.fund}] ${row.flow.padEnd(7)} "${row.categoryName}"  (countsAsGiving=${row.countsAsGiving})`,
    );
    resolved.push({ ...row, categoryId: null, status: "will-create" });
  }

  // ---- Preview + reconciliation (runs in BOTH dry-run and --apply, before any write) ----
  console.log(`\n${"=".repeat(78)}`);
  console.log("PREVIEW — FY2025 approved budget rows");
  console.log("=".repeat(78));

  const totalsByFundFlow = new Map<string, number>();
  for (const row of resolved) {
    const key = `${row.fund}|${row.flow}`;
    totalsByFundFlow.set(key, (totalsByFundFlow.get(key) ?? 0) + row.amountCents);
    console.log(
      `  [${row.fund}] ${row.flow.padEnd(7)} ${row.categoryName.padEnd(28)} ${money(row.amountCents).padStart(12)}  <- ${row.paperBudgetLine}`,
    );
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("RECONCILIATION vs. approved-budget PDF totals");
  console.log("=".repeat(78));

  let anyMismatch = false;
  for (const [key, expected] of Object.entries(EXPECTED_TOTALS_CENTS)) {
    const built = totalsByFundFlow.get(key) ?? 0;
    const match = built === expected;
    if (!match) anyMismatch = true;
    console.log(
      `  ${key.padEnd(28)} built=${money(built).padStart(12)}  expected=${money(expected).padStart(12)}  ${match ? "MATCH" : "*** MISMATCH ***"}`,
    );
  }

  if (anyMismatch) {
    console.error(
      `\nHARD FAIL — at least one fund/flow total does not reconcile exactly to the approved-budget PDF. Refusing to proceed (dry run and --apply both stop here).`,
    );
    await targetClient.end();
    process.exit(1);
  }

  console.log(`\nAll 4 fund/flow totals reconcile exactly to the approved-budget PDF.`);

  const toCreateCount = resolved.filter((r) => r.status === "will-create").length;

  if (!APPLY) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(
      `DRY RUN COMPLETE — no DB writes. Would create ${toCreateCount} new ledger_categories row(s) and upsert ${resolved.length} ledger_budgets row(s) at fiscal_year=${FISCAL_YEAR}.`,
    );
    console.log(`Re-run with --apply (and PROD_DATABASE_URL set, since this is targeting production) to write:`);
    console.log(`  PROD_DATABASE_URL=... pnpm exec tsx scripts/enter-fy2025-approved-budget.ts --apply`);
    await targetClient.end();
    return;
  }

  // ---------------------------------------------------------------------------
  // Apply — create missing categories, then upsert budget rows
  // ---------------------------------------------------------------------------

  console.log(`\nApplying...`);

  const categoriesCreated: { fund: FundKey; flow: string; name: string; id: string }[] = [];
  const budgetsWritten: { fund: FundKey; flow: string; name: string; amountCents: number }[] = [];

  for (const row of resolved) {
    const def = FUND_DEFS[row.fund];
    const entity = entityBySlug.get(def.entitySlug)!;
    const fund = fundByKey.get(row.fund)!;

    let categoryId = row.categoryId;

    if (!categoryId) {
      // Guarded re-check immediately before insert (WHERE NOT EXISTS equivalent).
      const [recheck] = await targetDb
        .select()
        .from(ledgerCategories)
        .where(
          and(
            eq(ledgerCategories.entityId, entity.id),
            eq(ledgerCategories.fundKind, def.fundKind),
            eq(ledgerCategories.flow, row.flow),
            eq(ledgerCategories.name, row.categoryName),
          ),
        );
      if (recheck) {
        categoryId = recheck.id;
        console.log(`  Category "${row.categoryName}" (${row.fund}) appeared since resolution — using existing id=${categoryId}.`);
      } else {
        const [maxSort] = await targetDb
          .select({ maxSortOrder: sql<number>`coalesce(max(${ledgerCategories.sortOrder}), 0)` })
          .from(ledgerCategories)
          .where(
            and(
              eq(ledgerCategories.entityId, entity.id),
              eq(ledgerCategories.fundKind, def.fundKind),
              eq(ledgerCategories.flow, row.flow),
            ),
          );
        const nextSortOrder = (maxSort?.maxSortOrder ?? 0) + 10;

        const [created] = await targetDb
          .insert(ledgerCategories)
          .values({
            entityId: entity.id,
            fundKind: def.fundKind,
            flow: row.flow,
            name: row.categoryName,
            sortOrder: nextSortOrder,
            isActive: true,
            countsAsGiving: row.countsAsGiving ?? true,
          })
          .returning();
        categoryId = created.id;
        categoriesCreated.push({ fund: row.fund, flow: row.flow, name: row.categoryName, id: categoryId });
        console.log(`  CREATED category "${row.categoryName}" (${row.fund}, ${row.flow}) -> id=${categoryId}`);
      }
    }

    // NOTE: raw SQL (not drizzle's `.insert(ledgerBudgets)` builder) on purpose.
    // Drizzle's insert builder lists EVERY schema-declared column (including
    // ones not passed to `.values()`, as `default`) — and production's
    // `ledger_budgets` does not yet have the `pending_delete_at` column that
    // schema.ts declares (migration 0066 has not deployed to production as of
    // this script's run; confirmed via information_schema against the
    // production branch). That drift makes the drizzle builder 500 with
    // `column "pending_delete_at" of relation "ledger_budgets" does not
    // exist`. Raw SQL naming only the columns that exist on production today
    // sidesteps the drift without this script silently trying to fix/deploy
    // that unrelated migration itself.
    await targetClient`
      INSERT INTO ledger_budgets (id, entity_id, fund_id, fiscal_year, category_id, flow, annual_amount_cents, created_at, updated_at)
      VALUES (gen_random_uuid(), ${entity.id}, ${fund.id}, ${FISCAL_YEAR}, ${categoryId}, ${row.flow}, ${row.amountCents}, now(), now())
      ON CONFLICT (fund_id, fiscal_year, category_id, flow)
      DO UPDATE SET annual_amount_cents = EXCLUDED.annual_amount_cents, updated_at = now()
    `;
    budgetsWritten.push({ fund: row.fund, flow: row.flow, name: row.categoryName, amountCents: row.amountCents });
    console.log(`  Upserted budget row: [${row.fund}] ${row.flow} "${row.categoryName}" = ${money(row.amountCents)}`);
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("APPLY SUMMARY");
  console.log("=".repeat(78));
  console.log(`  Categories created: ${categoriesCreated.length}`);
  for (const c of categoriesCreated) console.log(`    - [${c.fund}] ${c.flow} "${c.name}" (id=${c.id})`);
  console.log(`  Budget rows written: ${budgetsWritten.length}`);
  for (const [key, expected] of Object.entries(EXPECTED_TOTALS_CENTS)) {
    console.log(`    ${key.padEnd(28)} ${money(expected)}`);
  }

  console.log(`\nApply complete.`);
  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await targetClient.end();
  process.exit(1);
});

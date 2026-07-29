/**
 * One-off: add a single FY2026 Foundation Charitable-fund budget cause line —
 *   category "Charitable donation out", cause "Environment",
 *   label "City of Westerville – Arbor Fest", amount $400.00.
 *
 * WHY: entered on the treasurer's behalf (2026-07-28) because the in-app
 * "Break down by cause" / add-line control wasn't usable for this case, and the
 * "Environment" cause was only just added to the BUDGET_CAUSES taxonomy
 * (src/lib/ledger.ts). Writes through createBudgetCauseLine() — the EXACT
 * function PATCH /api/admin/ledger/budgets/cause-lines calls — so the parent
 * ledger_budgets row is lazy-created, the parent annual_amount_cents is rolled
 * up from its children, the cause is validated against the taxonomy, and the
 * FY lock is respected, identical to the UI path. No raw SQL.
 *
 * Idempotency: the line is keyed by (budget_id, cause, label) UNIQUE. Re-running
 * --apply returns the server's `duplicate_cause_label` result instead of a
 * second row — it will NOT double-insert.
 *
 * Usage:
 *   pnpm exec tsx scripts/add-arborfest-cause-line.ts            # dry run (default) — no writes
 *   pnpm exec tsx scripts/add-arborfest-cause-line.ts --apply    # writes to the .env.local DB
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import { and, eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  ledgerBudgets,
  ledgerBudgetLines,
} from "../src/lib/db/schema";
import { createBudgetCauseLine } from "../src/lib/ledger-queries";
import { isValidBudgetCause, isCauseEligibleCategory } from "../src/lib/ledger";

const APPLY = process.argv.includes("--apply");

const FISCAL_YEAR = 2026;
const FLOW = "expense" as const;
const CATEGORY_NAME = "Charitable donation out";
const CAUSE = "Environment";
const LABEL = "City of Westerville – Arbor Fest";
const AMOUNT_CENTS = 40000; // $400.00

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}  |  DB: .env.local DATABASE_URL/DB_URL`);

  if (!isValidBudgetCause(CAUSE)) {
    throw new Error(`Cause "${CAUSE}" is not in the BUDGET_CAUSES taxonomy — add it to src/lib/ledger.ts first.`);
  }

  const [foundation] = await db.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "foundation"));
  if (!foundation) throw new Error("Could not resolve 'foundation' entity.");

  const [charitableFund] = await db
    .select()
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, foundation.id), eq(ledgerFunds.slug, "charitable")));
  if (!charitableFund) throw new Error("Could not resolve Foundation Charitable fund.");

  const [category] = await db
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, foundation.id),
        eq(ledgerCategories.fundKind, "charitable"),
        eq(ledgerCategories.flow, FLOW),
        eq(ledgerCategories.name, CATEGORY_NAME),
      ),
    );
  if (!category) throw new Error(`Could not resolve "${CATEGORY_NAME}" (charitable/expense) category.`);
  if (!isCauseEligibleCategory({ flow: category.flow, countsAsGiving: category.countsAsGiving })) {
    throw new Error(`Category "${CATEGORY_NAME}" is not cause-eligible — refusing.`);
  }

  console.log(`\nResolved:`);
  console.log(`  Foundation entity: ${foundation.id}`);
  console.log(`  Charitable fund:   ${charitableFund.id}`);
  console.log(`  Category:          ${category.id} "${category.name}"`);
  console.log(`\nWill add cause line:`);
  console.log(`  FY${FISCAL_YEAR} ${FLOW} | cause="${CAUSE}" | label="${LABEL}" | ${money(AMOUNT_CENTS)}`);

  // Show the current state of any existing parent budget row for this cat/flow/FY.
  const [existingBudget] = await db
    .select()
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, charitableFund.id),
        eq(ledgerBudgets.fiscalYear, FISCAL_YEAR),
        eq(ledgerBudgets.categoryId, category.id),
        eq(ledgerBudgets.flow, FLOW),
      ),
    );
  console.log(
    `\nExisting parent budget row for this category/FY: ${
      existingBudget ? `${existingBudget.id} (${money(existingBudget.annualAmountCents)})` : "NONE — will be lazy-created"
    }`,
  );

  if (!APPLY) {
    console.log(`\nDRY RUN COMPLETE — no writes. Re-run with --apply to write.`);
    process.exit(0);
  }

  const result = await db.transaction((tx) =>
    createBudgetCauseLine(
      {
        fundId: charitableFund.id,
        fiscalYear: FISCAL_YEAR,
        categoryId: category.id,
        flow: FLOW,
        cause: CAUSE,
        label: LABEL,
        amountCents: AMOUNT_CENTS,
      },
      tx,
    ),
  );

  if (!result.ok) {
    console.error(`\nWRITE FAILED (${result.status}): ${result.error}${"reason" in result && result.reason ? ` [${result.reason}]` : ""}`);
    process.exit(1);
  }

  console.log(`\nWrote cause line ${result.lineId}.`);
  console.log(`  cause="${result.cause}" label="${result.label}"  category total now ${money(result.categoryTotalCents)}.`);

  // Verify from the DB.
  const [parent] = await db
    .select()
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, charitableFund.id),
        eq(ledgerBudgets.fiscalYear, FISCAL_YEAR),
        eq(ledgerBudgets.categoryId, category.id),
        eq(ledgerBudgets.flow, FLOW),
      ),
    );
  const children = parent
    ? await db.select().from(ledgerBudgetLines).where(eq(ledgerBudgetLines.budgetId, parent.id))
    : [];
  console.log(`\nVerification:`);
  console.log(`  Parent budget ${parent?.id}  annual_amount_cents=${money(parent?.annualAmountCents ?? 0)}`);
  for (const c of children) {
    console.log(`    - cause="${c.cause}" label="${c.label}" ${money(c.amountCents)}`);
  }
  console.log(`\nDone.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Seeds FY2026 Foundation budget cause+label line-item detail, derived from
 * FY2025 Charitable-fund actuals (treasurer-approved 2026-07-27/28).
 *
 * WHY THIS SCRIPT EXISTS: the FY2026 Foundation Charitable-fund budget rows
 * for "Charitable donation out" ($15,325.00), "Grant out" ($3,400.00), and
 * "Scholarships" ($7,500.00) currently exist only as lump sums (auto-seeded
 * from FY2025 actuals — B-17/DECISION-045 Increment A). This script breaks
 * each lump into cause+label child rows (ledger_budget_lines) so the FY2026
 * budget carries the same donor/grantee-level detail the FY2025 actuals do,
 * per the treasurer-approved mapping below. It NEVER changes the parent
 * total — the whole point is that children sum to the pre-existing lump.
 *
 * SCOPE — ONLY these three FY2026 budget rows are touched:
 *   Foundation entity, Charitable fund, fiscal_year=2026, flow='expense',
 *   category IN ("Charitable donation out", "Grant out", "Scholarships").
 * The Club Activity fund and Foundation Scholarship fund are NOT touched —
 * they have no eligible FY2025 seed material. No ledger_transactions row is
 * ever read for a write, or written/updated by this script — this only
 * inserts/updates ledger_budget_lines and (at most) updates
 * ledger_budgets.annual_amount_cents on the three rows above, and only when
 * the recomputed child sum differs from the currently stored value.
 *
 * SOURCE DATA: FY2025 Charitable-fund EXPENSE transactions (status='posted',
 * txn_date 2025-07-01 .. 2026-06-30) in the three target categories, grouped
 * by (category, beneficiary_cause, party) and summed. Eligibility mirrors
 * isCauseEligibleCategory() in src/lib/ledger.ts (expense + countsAsGiving),
 * asserted directly against the resolved category rows below rather than
 * assumed.
 *
 * LABELING RULE (per category, treasurer-approved):
 *   - "Charitable donation out": one labeled line per (cause, party) —
 *     multiple FY2025 rows sharing the same (cause, party) combine into ONE
 *     line (e.g. the two "Gates At Eight" / Youth & Education rows become a
 *     single $1,000 line) — EXCEPT party "Qdoba", whose amount is folded into
 *     that cause's generic (label='') line instead of getting its own label
 *     (a restaurant name isn't a meaningful beneficiary label).
 *   - "Grant out": every row keeps its party as the label (no drops).
 *   - "Scholarships": every row DROPS its label — all recipients roll into
 *     one generic (label='') line per cause.
 * This is expressed as a small per-category `dropLabel(party)` predicate
 * below, not as hardcoded per-transaction overrides — the actual causes,
 * parties, and amounts are always read live from the DB, never hardcoded, so
 * the preview reflects whatever FY2025 actuals currently say.
 *
 * SAFETY / HARD-FAIL: for each of the three categories, the script computes
 * the sum of its derived child lines and compares it to the FY2026 budget
 * row's current annual_amount_cents (the pre-existing lump). If ANY category's
 * children don't sum to EXACTLY its existing lump, the script prints the
 * mismatch and exits non-zero (hard fail) — in both dry-run and --apply modes
 * — rather than silently writing children that don't reconcile to the parent.
 * A row with a missing/invalid beneficiary_cause (checked against
 * BUDGET_CAUSES via isValidBudgetCause()) is excluded from the derived lines
 * and reported as a warning; if that exclusion changes the sum, the mismatch
 * hard-fail above catches it — there is no silent under-count.
 *
 * IDEMPOTENCY: children are written via
 *   INSERT ... ON CONFLICT (budget_id, cause, label) DO UPDATE SET amount_cents = ...
 * (the exact unique constraint on ledger_budget_lines), so re-running
 * --apply after a partial or full success re-derives the same lines and
 * upserts the same values — never duplicates. The parent
 * annual_amount_cents UPDATE only fires when the recomputed sum differs from
 * the stored value, so a clean re-run is a no-op write.
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts                            # dry run, local .env.local DB (default) — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts       # dry run against PRODUCTION — no writes
 *   PROD_DATABASE_URL=... pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts --apply   # writes to PRODUCTION
 *
 * Target selection mirrors scripts/backfill-check-numbers.ts and
 * scripts/june-close-correction.ts: PROD_DATABASE_URL takes priority over
 * DATABASE_URL/DB_URL from .env.local (local dev default).
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerCategories,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetLines,
} from "../src/lib/db/schema";
import { isValidBudgetCause, isCauseEligibleCategory } from "../src/lib/ledger";

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

const SOURCE_FISCAL_YEAR = 2025; // Jul 2025 – Jun 2026 actuals
const TARGET_FISCAL_YEAR = 2026; // Jul 2026 – Jun 2027 budget (the rows being enriched)
const FY_START = `${SOURCE_FISCAL_YEAR}-07-01`;
const FY_END_EXCLUSIVE = `${SOURCE_FISCAL_YEAR + 1}-07-01`; // exclusive upper bound, mirrors fyBounds() in src/lib/ledger-queries.ts

// Per-category label rule: dropLabel(party) === true means that row's amount
// folds into the cause's generic (label='') line instead of getting `party`
// as its own label. Treasurer-approved 2026-07-27/28 (see header).
const CATEGORY_RULES: Record<string, { dropLabel: (party: string) => boolean }> = {
  "Charitable donation out": { dropLabel: (party) => party === "Qdoba" },
  "Grant out": { dropLabel: () => false },
  Scholarships: { dropLabel: () => true },
};
const TARGET_CATEGORY_NAMES = Object.keys(CATEGORY_RULES);

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

type DerivedLine = {
  cause: string;
  label: string; // '' = generic
  amountCents: number;
  sourceRows: { party: string | null; amountCents: number }[];
};

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes ledger_budget_lines + ledger_budgets.annual_amount_cents)" : "DRY RUN (no writes)"}`);
  console.log(`Target: ${usingProd ? "PRODUCTION (PROD_DATABASE_URL)" : "local (.env.local DATABASE_URL/DB_URL)"}`);
  console.log(`Source: FY${SOURCE_FISCAL_YEAR} Foundation Charitable-fund actuals (${FY_START} .. ${SOURCE_FISCAL_YEAR + 1}-06-30, status='posted')`);
  console.log(`Target budget: FY${TARGET_FISCAL_YEAR} Foundation Charitable-fund expense budget rows`);
  console.log(`Categories in scope: ${TARGET_CATEGORY_NAMES.join(", ")}`);

  // ---- Resolve fixed references ----
  const [foundation] = await targetDb.select().from(ledgerEntities).where(eq(ledgerEntities.slug, "foundation"));
  if (!foundation) throw new Error("Could not resolve 'foundation' row in ledger_entities on target DB.");

  const [charitableFund] = await targetDb
    .select()
    .from(ledgerFunds)
    .where(and(eq(ledgerFunds.entityId, foundation.id), eq(ledgerFunds.slug, "charitable")));
  if (!charitableFund) throw new Error("Could not resolve Charitable fund row in ledger_funds on target DB.");

  console.log(`\nResolved references:`);
  console.log(`  Foundation entity id: ${foundation.id} (${foundation.name})`);
  console.log(`  Charitable fund id:   ${charitableFund.id} (${charitableFund.name})`);

  const categories = await targetDb
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, foundation.id),
        eq(ledgerCategories.fundKind, "charitable"),
        eq(ledgerCategories.flow, "expense"),
        inArray(ledgerCategories.name, TARGET_CATEGORY_NAMES),
      ),
    );

  if (categories.length !== TARGET_CATEGORY_NAMES.length) {
    const found = new Set(categories.map((c) => c.name));
    const missing = TARGET_CATEGORY_NAMES.filter((n) => !found.has(n));
    throw new Error(
      `Could not resolve all target categories on Foundation Charitable fund (expense). Missing: ${missing.join(", ")}.`,
    );
  }

  for (const cat of categories) {
    if (!isCauseEligibleCategory({ flow: cat.flow, countsAsGiving: cat.countsAsGiving })) {
      throw new Error(
        `Category "${cat.name}" (id=${cat.id}) is not cause-eligible (flow=${cat.flow}, countsAsGiving=${cat.countsAsGiving}) — refusing to seed lines for it.`,
      );
    }
  }

  console.log(`\nResolved categories:`);
  for (const cat of categories) {
    console.log(`  ${cat.id}  "${cat.name}"  (flow=${cat.flow}, countsAsGiving=${cat.countsAsGiving})`);
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const categoryIds = categories.map((c) => c.id);

  // ---- Resolve the 3 existing FY2026 budget rows (lump sums) ----
  const budgetRows = await targetDb
    .select()
    .from(ledgerBudgets)
    .where(
      and(
        eq(ledgerBudgets.fundId, charitableFund.id),
        eq(ledgerBudgets.fiscalYear, TARGET_FISCAL_YEAR),
        eq(ledgerBudgets.flow, "expense"),
        inArray(ledgerBudgets.categoryId, categoryIds),
      ),
    );

  if (budgetRows.length !== categories.length) {
    const foundIds = new Set(budgetRows.map((b) => b.categoryId));
    const missing = categories.filter((c) => !foundIds.has(c.id)).map((c) => c.name);
    throw new Error(
      `Could not resolve all FY${TARGET_FISCAL_YEAR} expense budget rows for the target categories on the Charitable fund. Missing budget rows for: ${missing.join(", ")}.`,
    );
  }

  const budgetByCategoryId = new Map(budgetRows.map((b) => [b.categoryId as string, b]));

  console.log(`\nResolved FY${TARGET_FISCAL_YEAR} budget rows (existing lump sums):`);
  for (const cat of categories) {
    const b = budgetByCategoryId.get(cat.id)!;
    console.log(`  ${b.id}  "${cat.name}"  ${money(b.annualAmountCents)}`);
  }

  // ---- Existing children check (idempotency signal, informational only — upsert handles the actual idempotency) ----
  const existingLines = await targetDb
    .select()
    .from(ledgerBudgetLines)
    .where(inArray(ledgerBudgetLines.budgetId, budgetRows.map((b) => b.id)));
  if (existingLines.length > 0) {
    console.log(
      `\nNOTE: ${existingLines.length} ledger_budget_lines row(s) already exist under these 3 budgets (likely a prior run of this script). ` +
        `Re-running will UPSERT on (budget_id, cause, label) — matching (cause, label) pairs get their amount refreshed, not duplicated.`,
    );
  }

  // ---- Pull FY2025 actuals for the 3 categories ----
  const actuals = await targetDb
    .select({
      id: ledgerTransactions.id,
      categoryId: ledgerTransactions.categoryId,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      beneficiaryCause: ledgerTransactions.beneficiaryCause,
      txnDate: ledgerTransactions.txnDate,
    })
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.entityId, foundation.id),
        eq(ledgerTransactions.fundId, charitableFund.id),
        eq(ledgerTransactions.flow, "expense"),
        eq(ledgerTransactions.status, "posted"),
        inArray(ledgerTransactions.categoryId, categoryIds),
        gte(ledgerTransactions.txnDate, FY_START),
        lt(ledgerTransactions.txnDate, FY_END_EXCLUSIVE),
      ),
    );

  console.log(`\nFetched ${actuals.length} FY${SOURCE_FISCAL_YEAR} posted expense actual(s) across the 3 target categories.`);

  // ---- Group into derived lines per category ----
  const linesByCategoryId = new Map<string, Map<string, DerivedLine>>();
  const warnings: string[] = [];

  for (const row of actuals) {
    const cat = categoryById.get(row.categoryId ?? "");
    if (!cat) continue; // defensive — inArray already scoped this

    const rawCause = (row.beneficiaryCause ?? "").trim();
    if (!rawCause) {
      warnings.push(
        `[${cat.name}] txn ${row.id} (${row.txnDate}, party=${row.party ?? "(none)"}, ${money(row.amountCents)}) has NO beneficiary_cause — EXCLUDED from derived lines (will surface as a sum mismatch below if this changes the total).`,
      );
      continue;
    }
    if (!isValidBudgetCause(rawCause)) {
      warnings.push(
        `[${cat.name}] txn ${row.id} (${row.txnDate}, party=${row.party ?? "(none)"}, ${money(row.amountCents)}) has cause "${rawCause}" — NOT in the BUDGET_CAUSES taxonomy — EXCLUDED from derived lines.`,
      );
      continue;
    }

    const rule = CATEGORY_RULES[cat.name];
    const party = (row.party ?? "").trim();
    const dropLabel = rule.dropLabel(party);
    const label = dropLabel ? "" : party;

    if (!dropLabel && !party) {
      warnings.push(
        `[${cat.name}] txn ${row.id} (${row.txnDate}, cause=${rawCause}, ${money(row.amountCents)}) has no party and is not configured to drop its label — will be recorded as a generic (label='') line by necessity.`,
      );
    }

    const key = `${rawCause}||${label}`;
    let byKey = linesByCategoryId.get(cat.id);
    if (!byKey) {
      byKey = new Map();
      linesByCategoryId.set(cat.id, byKey);
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.amountCents += row.amountCents;
      existing.sourceRows.push({ party: row.party, amountCents: row.amountCents });
    } else {
      byKey.set(key, {
        cause: rawCause,
        label,
        amountCents: row.amountCents,
        sourceRows: [{ party: row.party, amountCents: row.amountCents }],
      });
    }
  }

  // ---- Print per-category preview + verify child sum == existing lump ----
  let anyMismatch = false;
  let grandTotalExisting = 0;
  let grandTotalDerived = 0;

  const linesToWrite: Array<{ budgetId: string; categoryName: string; lines: DerivedLine[] }> = [];

  for (const cat of categories) {
    const budget = budgetByCategoryId.get(cat.id)!;
    const byKey = linesByCategoryId.get(cat.id) ?? new Map<string, DerivedLine>();
    const lines = [...byKey.values()].sort((a, b) => b.amountCents - a.amountCents);
    const childSum = lines.reduce((s, l) => s + l.amountCents, 0);

    grandTotalExisting += budget.annualAmountCents;
    grandTotalDerived += childSum;

    console.log(`\n${"=".repeat(78)}`);
    console.log(`CATEGORY: "${cat.name}"  (budget row ${budget.id})`);
    console.log("=".repeat(78));
    for (const line of lines) {
      const labelDisplay = line.label === "" ? "(generic)" : line.label;
      const combined = line.sourceRows.length > 1 ? `  [combines ${line.sourceRows.length} FY${SOURCE_FISCAL_YEAR} rows]` : "";
      console.log(`  ${line.cause.padEnd(28)}  ${labelDisplay.padEnd(24)}  ${money(line.amountCents).padStart(10)}${combined}`);
      if (line.sourceRows.length > 1 || line.label === "") {
        for (const sr of line.sourceRows) {
          console.log(`      - ${(sr.party ?? "(no party)").padEnd(24)} ${money(sr.amountCents).padStart(10)}`);
        }
      }
    }
    console.log(`  ${"-".repeat(74)}`);
    console.log(`  Derived child sum:   ${money(childSum)}`);
    console.log(`  Existing parent lump: ${money(budget.annualAmountCents)}`);
    if (childSum === budget.annualAmountCents) {
      console.log(`  MATCH — children reconcile exactly to the existing lump.`);
    } else {
      anyMismatch = true;
      console.log(
        `  *** MISMATCH *** derived child sum (${money(childSum)}) != existing parent lump (${money(budget.annualAmountCents)}). Difference: ${money(childSum - budget.annualAmountCents)}.`,
      );
    }

    linesToWrite.push({ budgetId: budget.id, categoryName: cat.name, lines });
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("GRAND TOTAL (3 categories)");
  console.log("=".repeat(78));
  console.log(`  Existing parent lumps sum: ${money(grandTotalExisting)}`);
  console.log(`  Derived child lines sum:   ${money(grandTotalDerived)}`);

  if (warnings.length > 0) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`WARNINGS (${warnings.length}) — taxonomy / missing-data issues found in FY${SOURCE_FISCAL_YEAR} actuals`);
    console.log("=".repeat(78));
    for (const w of warnings) console.log(`  - ${w}`);
  } else {
    console.log(`\nNo taxonomy or missing-cause warnings — every FY${SOURCE_FISCAL_YEAR} row in scope carried a valid BUDGET_CAUSES value.`);
  }

  if (anyMismatch) {
    console.log(`\n${"=".repeat(78)}`);
    console.error(
      `HARD FAIL — at least one category's derived child lines do not sum to its existing FY${TARGET_FISCAL_YEAR} budget lump. Refusing to proceed (dry run and --apply both stop here). Investigate the mismatch(es) flagged above before re-running.`,
    );
    await targetClient.end();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(
      `DRY RUN COMPLETE — no DB writes. All 3 categories' derived children reconcile exactly to their existing FY${TARGET_FISCAL_YEAR} lump sums.`,
    );
    console.log(
      `Re-run with --apply (and PROD_DATABASE_URL set, since this is targeting production) to write ledger_budget_lines:`,
    );
    console.log(`  PROD_DATABASE_URL=... pnpm exec tsx scripts/seed-fy2026-foundation-budget.ts --apply`);
    await targetClient.end();
    return;
  }

  // ---------------------------------------------------------------------------
  // Apply — upsert children, then reconcile parent (only if changed)
  // ---------------------------------------------------------------------------

  console.log(`\nApplying...`);
  for (const { budgetId, categoryName, lines } of linesToWrite) {
    for (const line of lines) {
      await targetDb
        .insert(ledgerBudgetLines)
        .values({
          budgetId,
          cause: line.cause,
          label: line.label,
          amountCents: line.amountCents,
        })
        .onConflictDoUpdate({
          target: [ledgerBudgetLines.budgetId, ledgerBudgetLines.cause, ledgerBudgetLines.label],
          set: { amountCents: line.amountCents, updatedAt: new Date() },
        });
    }
    console.log(`  Upserted ${lines.length} line(s) for "${categoryName}" (budget ${budgetId}).`);

    // Re-derive the persisted sum from the DB (not the in-memory value) before
    // touching the parent — belt-and-suspenders against any write-path drift.
    const persisted = await targetDb
      .select({ amountCents: ledgerBudgetLines.amountCents })
      .from(ledgerBudgetLines)
      .where(eq(ledgerBudgetLines.budgetId, budgetId));
    const persistedSum = persisted.reduce((s, r) => s + r.amountCents, 0);

    const [currentBudget] = await targetDb.select().from(ledgerBudgets).where(eq(ledgerBudgets.id, budgetId));
    if (!currentBudget) throw new Error(`Budget row ${budgetId} vanished mid-apply — aborting.`);

    if (persistedSum !== currentBudget.annualAmountCents) {
      await targetDb
        .update(ledgerBudgets)
        .set({ annualAmountCents: persistedSum, updatedAt: new Date() })
        .where(eq(ledgerBudgets.id, budgetId));
      console.log(`  Updated "${categoryName}" annual_amount_cents: ${money(currentBudget.annualAmountCents)} -> ${money(persistedSum)}.`);
    } else {
      console.log(`  "${categoryName}" annual_amount_cents already ${money(persistedSum)} — no parent update needed.`);
    }
  }

  console.log(`\nApply complete.`);
  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await targetClient.end();
  process.exit(1);
});

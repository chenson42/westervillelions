/**
 * Merges the two duplicate Club Administrative budget categories for FY2026,
 * so the budgeted line and the line the money actually posts to are the same
 * category (treasurer-approved 2026-08-06, from the FY2026 budget-committee
 * review — see docs/work-log/2026-08-05-fy2026-budget-committee-review.md).
 *
 *   pnpm exec tsx scripts/merge-club-budget-categories.ts            # dry run
 *   pnpm exec tsx scripts/merge-club-budget-categories.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL if set (loud banner), else DATABASE_URL/DB_URL.
 *
 * THE PROBLEM: "Awards" ($200 budgeted, zero transactions ever) sat alongside
 * "Member recognition" ($490.48 spent in FY2025, never budgeted); "Supplies"
 * ($75 budgeted, zero transactions ever) sat alongside "Program supplies"
 * ($670.64 spent in FY2025, never budgeted). Same money, two names — which is
 * why the budget looked like it was missing spending that had in fact occurred.
 *
 * WHY A MOVE, NOT A RENAME: the destination categories ALREADY EXIST, so
 * renaming would collide on (entity, fund_kind, flow, name) and would orphan
 * the transactions already posted to the destinations. Instead each FY2026
 * ledger_budgets row is re-pointed at the destination category_id, which is
 * safe because the destinations have no FY2026 budget row of their own
 * (asserted below, not assumed).
 *
 *   Awards          $200 -> Member recognition  $200 (amount unchanged)
 *   Supplies         $75 -> Program supplies    $700 (raised to cover the
 *                                                    $670.64 actually spent)
 *
 * FY2025 IS DELIBERATELY NOT TOUCHED. Its rows still read "Awards $200" and
 * "Supplies $75" because that is what was approved for that year; rewriting an
 * approved prior-year budget to match this year's naming would falsify the
 * historical record. The source categories are likewise NOT deleted — FY2025's
 * budget rows still reference them.
 *
 * Club Administrative expense total moves $13,130 -> $13,755 (+$625), so the
 * Notes & Assumptions totals are rewritten in the same transaction to match.
 * Never touches ledger_transactions.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FY = 2026;
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

const NOTE_MAX = 500;
const NOTES_MAX = 4000;

// [fromCategory, toCategory, newAmountCents | null = keep, note]
const MERGES: [string, string, number | null, string][] = [
  [
    "Awards",
    "Member recognition",
    null,
    "Covers speaker gifts, milestone pins and plaques, banner repair, and member apparel. " +
      "FY2025 spending was $490.48.",
  ],
  [
    "Supplies",
    "Program supplies",
    70000,
    "Covers program materials — banner bag, peace poster kits, pop-up tent, costume cleaning, and " +
      "used-eyeglass collection boxes. FY2025 spending was $670.64.",
  ],
];

const CLUB_NOTES = `## Compared to the prior-year approved budget

**Revenue $6,398** — down ~$582 (dues $5,655 to $5,223; tail-twisting $1,150 to $1,000).

**Expenses $13,755** — up $1,982, driven almost entirely by raising the donation to the Foundation from $595 to $5,000 to fund the Fouse/McVay Cabin Educational Center gift, with offsetting cuts in Marketing ($5,000 to $2,000) and LCI per-capita/dues ($3,556 to $3,000). New lines: District & convention ($300), Operations ($900). Program supplies is budgeted at $700, up from the $75 that sat under a separate "Supplies" line, to match what the club actually spends. Dropped: Contingency, Lion L support, Membership.

**Planned net -$7,357** (prior year -$4,793) — the larger operating drawdown is essentially the $5,000 cabin pass-through to the Foundation.

## Open questions for the board

### 1. Member recognition — is $200 enough?

FY2025 spending was **$490.48**:

- Speaker gifts — $55.08
- 50-year pins and banner repair — $195.80
- Member polo shirts — $239.60

The line carries $200. If the year ahead includes milestone recognitions or another apparel order, it will run short.

### 2. Web hosting — $200 budgeted, $645 spent last year

FY2025 carried a single $645 charge. If that was a multi-year domain or hosting prepayment, $200 is about right; if it recurs annually, this line is roughly $445 light.

### 3. Per-capita tax — $3,000 budgeted, $3,508.86 paid last year

The line covers Lions Clubs International dues, District dues, and new-member entrance fees together. Worth confirming the roster count for the year ahead before settling on $3,000.`;

if (CLUB_NOTES.length > NOTES_MAX) throw new Error(`CLUB_NOTES is ${CLUB_NOTES.length} chars, over ${NOTES_MAX}.`);
for (const [, to, , note] of MERGES) {
  if (note.length > NOTE_MAX) throw new Error(`Note for "${to}" is ${note.length} chars, over ${NOTE_MAX}.`);
}

// Expected Club Administrative expense total after the merge.
const EXPECTED_CLUB_EXPENSE_CENTS = 1375500;

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  FY${FY}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`,
  );

  const locks = await sql`
    SELECT e.name FROM ledger_budget_approvals a JOIN ledger_entities e ON e.id = a.entity_id
    WHERE a.fiscal_year = ${FY} AND a.status = 'locked'`;
  if (locks.length) {
    console.error(`REFUSING: FY${FY} has ${locks.length} locked budget(s).`);
    await sql.end();
    process.exit(1);
  }

  const category = async (name: string) => {
    const [row] = await sql`
      SELECT c.id FROM ledger_categories c JOIN ledger_entities e ON e.id = c.entity_id
      WHERE e.slug = 'club' AND c.fund_kind = 'administrative' AND c.flow = 'expense' AND c.name = ${name}`;
    if (!row) throw new Error(`No Club Administrative expense category named "${name}".`);
    return row.id as string;
  };

  const budgetFor = async (categoryId: string) => {
    const [row] = await sql`
      SELECT id, annual_amount_cents AS amt FROM ledger_budgets
      WHERE fiscal_year = ${FY} AND category_id = ${categoryId} AND flow = 'expense'`;
    return row ?? null;
  };

  console.log("PLAN\n----");
  const plan: { fromId: string; toId: string; budgetId: string; amt: number; note: string; label: string }[] = [];

  for (const [from, to, newAmt, note] of MERGES) {
    const fromId = await category(from);
    const toId = await category(to);
    const fromBudget = await budgetFor(fromId);
    const toBudget = await budgetFor(toId);

    if (!fromBudget && toBudget) {
      console.log(`  "${from}" -> "${to}": already merged, at ${money(toBudget.amt)}` +
        (newAmt !== null && toBudget.amt !== newAmt ? `  [will set to ${money(newAmt)}]` : ""));
      if (newAmt !== null && toBudget.amt !== newAmt) {
        plan.push({ fromId, toId, budgetId: toBudget.id, amt: newAmt, note, label: `${to} amount` });
      }
      continue;
    }
    if (!fromBudget) throw new Error(`Neither "${from}" nor "${to}" has an FY${FY} budget row — nothing to merge.`);
    if (toBudget) {
      throw new Error(
        `Both "${from}" (${money(fromBudget.amt)}) and "${to}" (${money(toBudget.amt)}) have FY${FY} budget rows. ` +
          `Merging would violate the (fund, year, category, flow) unique constraint — resolve by hand.`,
      );
    }

    const amt = newAmt ?? fromBudget.amt;
    console.log(
      `  "${from}" ${money(fromBudget.amt)} -> "${to}" ${money(amt)}` +
        (newAmt !== null && newAmt !== fromBudget.amt ? `   (raised)` : `   (amount unchanged)`),
    );
    plan.push({ fromId, toId, budgetId: fromBudget.id, amt, note, label: `${from} -> ${to}` });
  }

  console.log(`  Club Notes & Assumptions rewritten (${CLUB_NOTES.length} chars)`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    for (const p of plan) {
      await tx`
        UPDATE ledger_budgets
        SET category_id = ${p.toId}, annual_amount_cents = ${p.amt}, note = ${p.note}, updated_at = now()
        WHERE id = ${p.budgetId}`;
    }

    const [ent] = await tx`SELECT id FROM ledger_entities WHERE slug = 'club'`;
    await tx`
      INSERT INTO ledger_budget_notes (entity_id, fiscal_year, notes)
      VALUES (${ent.id}, ${FY}, ${CLUB_NOTES})
      ON CONFLICT (entity_id, fiscal_year) DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()`;

    // Guard: the Club Administrative expense total must land exactly where the
    // rewritten Notes & Assumptions says it does, or roll the whole thing back.
    const [tot] = await tx`
      SELECT coalesce(sum(b.annual_amount_cents), 0)::int AS total
      FROM ledger_budgets b
      JOIN ledger_entities e ON e.id = b.entity_id
      JOIN ledger_funds f ON f.id = b.fund_id
      WHERE b.fiscal_year = ${FY} AND e.slug = 'club' AND f.slug = 'administrative'
        AND b.flow = 'expense' AND b.pending_delete_at IS NULL`;
    if (tot.total !== EXPECTED_CLUB_EXPENSE_CENTS) {
      throw new Error(
        `Club Administrative expense total is ${money(tot.total)}, expected ${money(EXPECTED_CLUB_EXPENSE_CENTS)} ` +
          `(the figure written into Notes & Assumptions) — rolling back.`,
      );
    }
  });

  console.log("\nApplied. Verifying...\n");
  const rows = await sql`
    SELECT c.name AS category, b.annual_amount_cents AS amt
    FROM ledger_budgets b
    JOIN ledger_entities e ON e.id = b.entity_id
    JOIN ledger_funds f ON f.id = b.fund_id
    JOIN ledger_categories c ON c.id = b.category_id
    WHERE b.fiscal_year = ${FY} AND e.slug = 'club' AND f.slug = 'administrative' AND b.flow = 'expense'
    ORDER BY c.name`;
  let total = 0;
  for (const r of rows) {
    total += r.amt;
    console.log(`  ${r.category}: ${money(r.amt)}`);
  }
  console.log(`\n  Club Administrative expense total: ${money(total)}`);

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

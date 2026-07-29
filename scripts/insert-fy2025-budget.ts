/**
 * Inserts the FY2025 (Jul 2025–Jun 2026) Foundation Charitable-fund budget as the
 * clean reference model. Amounts = the approved "Proposed 2025-2026" PDF column;
 * structure per docs/2026-07-29-clean-fy2025-plan.md (Script 2). Dry-run by default.
 *
 * Depends on Script 1 (fix-ledger-categories) for the 3 Rudolph income categories —
 * run that with --apply first, or this errors on --apply (dry-run tolerates missing).
 *
 *   pnpm exec tsx scripts/insert-fy2025-budget.ts            # dry run
 *   pnpm exec tsx scripts/insert-fy2025-budget.ts --apply    # writes
 *
 * Idempotent: ledger_budgets upsert on (fund_id, fiscal_year, category_id, flow);
 * ledger_budget_lines upsert on (budget_id, cause, label). Re-running is safe.
 * Refuses to run if FY2025 Foundation budget is locked.
 *
 * SCOPE: Foundation Charitable fund only (the philanthropic budget with the
 * beneficiary breakdown — the meat). Club Administrative budget is a follow-on.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FY = 2025;
const url = process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("DATABASE_URL or DB_URL must be set (.env.local).");
const sql = postgres(url);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// Charitable donation out — cause → [label, cents]
const CDO: [string, [string, number][]][] = [
  ["Health & Disability", [["Camp Echoing Hills", 75000], ["Central Ohio Diabetes Association", 12500], ["Ohio Lions Pediatric Cancer Foundation", 100000], ["Westerville Special Olympics", 50000]]],
  ["Hunger & Basic Needs", [["Caring and Sharing", 100000], ["WARM", 100000], ["The Big Bus", 50000]]],
  ["Vision & Eye Care", [["Central Ohio Lions Eye Bank", 100000], ["Foundation Fighting Blindness", 100000], ["Ohio Lions Eye Research Fund", 75000], ["Ohio School for the Blind", 50000], ["OLF Eye Care Fund", 100000], ["Pilot Dogs", 100000], ["Student VOSH", 50000], ["Local Eye Care Assistance", 50000]]],
  ["Lions International Programs", [["Lions Clubs International Foundation", 100000], ["Ohio Lions Foundation", 100000]]],
  ["Youth & Education", [["BMX Race Scholarships", 50000], ["BMX Sponsorship", 50000], ["Buckeye Boys State", 30000], ["Buckeye Girls State", 35000], ["Westerville HS Sports Teams", 50000]]],
  ["Community & Civic", [["Lions Sensory Garden", 20000]]],
];

// Lump budget rows (no cause breakdown): [categoryName, flow, cents, note]
const LUMPS: [string, "income" | "expense", number, string][] = [
  ["Scholarships", "expense", 750000, "HS Scholarships (generic, no student names)"],
  ["Grant out", "expense", 450000, "Special Interest Grants"],
  ["Fundraising event costs", "expense", 1150000, "Rudolph Run $10,000 + Pancake Breakfast $1,500 (combined — separating needs distinct categories)"],
  ["Operations", "expense", 220000, "Storage Unit"],
  ["Program supplies", "expense", 20000, "Benches / Bags to Benches"],
  ["Contingency", "expense", 50000, "PDF 'Miscellaneous $500' rehomed as an explicit reserve"],
  ["Insurance & bonding", "expense", 18700, "Officer Bonding"],
  ["Rudolph Run – Registration/Entry Fees", "income", 1549000, "57.4% of actual"],
  ["Rudolph Run – Sponsorships & Donations", "income", 1146800, "42.5% of actual"],
  ["Rudolph Run – Day-of / Merchandise", "income", 4200, "0.2% of actual"],
  ["Pancake Breakfast", "income", 400000, ""],
  ["White Cane", "income", 100000, "Chris: belongs in the Foundation"],
  ["Restaurant fundraisers", "income", 30000, "new category"],
  ["Public donations", "income", 20000, "$100 base + $100 misc folded in (no Misc category)"],
];

// New Foundation charitable categories to create if missing: [flow, name, giving]
const NEW_CATS: ["income" | "expense", string, boolean][] = [
  ["income", "White Cane", true],
  ["income", "Restaurant fundraisers", true],
  ["expense", "Contingency", false], // PDF "Miscellaneous $500" rehomed as an explicit reserve
];

// Nothing dropped — every PDF line has a home now.
const MISSING: string[] = [];

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}  |  FY${FY} Foundation Charitable budget\n`);

  const [foundation] = await sql<{ id: string }[]>`SELECT id FROM ledger_entities WHERE slug = 'foundation'`;
  const [fund] = await sql<{ id: string }[]>`SELECT f.id FROM ledger_funds f WHERE f.entity_id = ${foundation.id} AND f.slug = 'charitable'`;
  if (!foundation || !fund) throw new Error("Foundation / charitable fund not resolved.");

  const locked = await sql`SELECT 1 FROM ledger_budget_approvals WHERE entity_id = ${foundation.id} AND fiscal_year = ${FY} AND status = 'locked'`;
  if (locked.length) { console.error(`REFUSING: FY${FY} Foundation budget is locked.`); await sql.end(); process.exit(1); }

  const catId = async (name: string, flow: string): Promise<string | null> => {
    const r = await sql<{ id: string }[]>`SELECT id FROM ledger_categories WHERE entity_id = ${foundation.id} AND fund_kind = 'charitable' AND flow = ${flow} AND name = ${name} LIMIT 1`;
    return r[0]?.id ?? null;
  };

  async function upsertBudget(categoryId: string, flow: string, cents: number): Promise<string | null> {
    if (!APPLY) return null;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO ledger_budgets (entity_id, fund_id, fiscal_year, category_id, flow, annual_amount_cents)
      VALUES (${foundation.id}, ${fund.id}, ${FY}, ${categoryId}, ${flow}, ${cents})
      ON CONFLICT (fund_id, fiscal_year, category_id, flow)
      DO UPDATE SET annual_amount_cents = EXCLUDED.annual_amount_cents, updated_at = now()
      RETURNING id`;
    return row.id;
  }

  // ---- Ensure new income categories exist ----
  console.log("New categories:");
  for (const [flow, name, giving] of NEW_CATS) {
    const exists = await catId(name, flow);
    console.log(`  ${exists ? "exists " : "CREATE "} ${flow}/${name}  (giving=${giving})`);
    if (APPLY && !exists) {
      await sql`INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving)
                VALUES (${foundation.id}, 'charitable', ${flow}, ${name}, ${giving})`;
    }
  }

  // ---- Charitable donation out (cause-line breakdown) ----
  console.log("\nEXPENSE — Charitable donation out (cause → line items):");
  const cdoCatId = await catId("Charitable donation out", "expense");
  let cdoTotal = 0;
  for (const [cause, lines] of CDO) {
    console.log(`  ${cause}`);
    for (const [label, cents] of lines) { cdoTotal += cents; console.log(`     ${label.padEnd(38)} ${money(cents).padStart(10)}`); }
  }
  console.log(`  ${"— parent total —".padEnd(41)} ${money(cdoTotal).padStart(10)}`);
  if (APPLY) {
    if (!cdoCatId) throw new Error('"Charitable donation out" category missing.');
    const bId = await upsertBudget(cdoCatId, "expense", cdoTotal);
    for (const [cause, lines] of CDO) for (const [label, cents] of lines) {
      await sql`INSERT INTO ledger_budget_lines (budget_id, cause, label, amount_cents)
                VALUES (${bId}, ${cause}, ${label}, ${cents})
                ON CONFLICT (budget_id, cause, label) DO UPDATE SET amount_cents = EXCLUDED.amount_cents, updated_at = now()`;
    }
  }

  // ---- Lump rows ----
  console.log("\nLUMP budget lines:");
  for (const [name, flow, cents, note] of LUMPS) {
    const id = await catId(name, flow);
    const tag = id ? "" : "  [category pending Script 1 / not found]";
    console.log(`  ${flow.padEnd(7)} ${name.padEnd(42)} ${money(cents).padStart(10)}${tag}${note ? "   — " + note : ""}`);
    if (APPLY) {
      if (!id) throw new Error(`Category "${name}" (${flow}) not found — run Script 1 --apply first (Rudolph income cats), or create it.`);
      await upsertBudget(id, flow, cents);
    }
  }

  console.log("\nNOT inserted (PDF lines with no category yet — decide + add):");
  for (const m of MISSING) console.log(`  - ${m}`);

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN complete — no writes. Run Script 1 --apply first, then this --apply."}`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

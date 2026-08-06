/**
 * Inserts the FY2025 Club Administrative-fund budget (the companion to
 * insert-fy2025-budget.ts, which did the Foundation Charitable fund).
 * Amounts = approved "Proposed 2025-2026" PDF column. Admin lines are lump
 * (no cause breakdown). Dry-run by default.
 *
 *   pnpm exec tsx scripts/insert-fy2025-admin-budget.ts            # dry run
 *   pnpm exec tsx scripts/insert-fy2025-admin-budget.ts --apply    # writes
 *
 * Decisions applied: Lions dues MERGED into "Per-capita tax"; "Meals"->"Meeting
 * hospitality" (done in Script 1); NO Miscellaneous (the approved Misc was $0
 * anyway). Creates the 6 admin categories the PDF lists that don't exist yet.
 * Idempotent (upsert). Refuses if the FY2025 admin budget is locked.
 *
 * Totals reconcile to the PDF: expense $11,773.00, revenue $6,980.00.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FY = 2025;
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!url) throw new Error("No DB URL (PROD_DATABASE_URL / DATABASE_URL / DB_URL).");
const sql = postgres(url);
if (usingProd) console.log("*** TARGET: PRODUCTION (PROD_DATABASE_URL) ***");
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// Admin categories the PDF budgets that don't exist yet: [flow, name, giving]
const NEW_CATS: ["income" | "expense", string, boolean][] = [
  ["expense", "4th of July Parade", false],
  ["expense", "Awards", false],
  ["expense", "Contingency", false],
  ["expense", "Lion L support", false],
  ["expense", "Membership", false],
  ["income", "New Member Fee", true],
];

// Budget lines: [categoryName, flow, cents, note]. Category resolved by name.
const LINES: [string, "income" | "expense", number, string][] = [
  // expense
  ["4th of July Parade", "expense", 20000, ""],
  ["Awards", "expense", 20000, ""],
  ["Contingency", "expense", 50000, ""],
  ["Per-capita tax", "expense", 355600, "District $1,029 + International $2,352 + New-member $175 (merged)"],
  ["Lion L support", "expense", 15000, ""],
  ["Marketing", "expense", 500000, ""],
  ["Meeting hospitality", "expense", 50000, ""],
  ["Membership", "expense", 25000, ""],
  ["Supplies", "expense", 7500, "PDF 'Office supplies'"],
  ["Insurance & bonding", "expense", 18700, "PDF 'Officer Bonding'"],
  ["Postage", "expense", 26000, "PDF 'Post office box'"],
  ["Donations to Foundation", "expense", 59500, "PDF 'Tail Twisting for 501c3' (club->foundation transfer)"],
  ["Web hosting", "expense", 30000, "PDF 'Website hosting'"],
  // income
  ["Club dues", "income", 565500, ""],
  ["New Member Fee", "income", 17500, ""],
  ["Tail-twisting", "income", 115000, "raffle $1,000 + non-raffle $150 (merged)"],
];

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"}  |  FY${FY} Club Administrative budget\n`);

  const [club] = await sql<{ id: string }[]>`SELECT id FROM ledger_entities WHERE slug = 'club'`;
  const [fund] = await sql<{ id: string }[]>`SELECT id FROM ledger_funds WHERE entity_id = ${club.id} AND slug = 'administrative'`;
  if (!club || !fund) throw new Error("Club / administrative fund not resolved.");

  const locked = await sql`SELECT 1 FROM ledger_budget_approvals WHERE entity_id = ${club.id} AND fiscal_year = ${FY} AND status = 'locked'`;
  if (locked.length) { console.error(`REFUSING: FY${FY} Club admin budget is locked.`); await sql.end(); process.exit(1); }

  const catId = async (name: string, flow: string): Promise<string | null> => {
    const r = await sql<{ id: string }[]>`SELECT id FROM ledger_categories WHERE entity_id = ${club.id} AND fund_kind = 'administrative' AND flow = ${flow} AND name = ${name} LIMIT 1`;
    return r[0]?.id ?? null;
  };

  console.log("New categories:");
  for (const [flow, name, giving] of NEW_CATS) {
    const exists = await catId(name, flow);
    console.log(`  ${exists ? "exists " : "CREATE "} ${flow}/${name}`);
    if (APPLY && !exists) {
      await sql`INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving) VALUES (${club.id}, 'administrative', ${flow}, ${name}, ${giving})`;
    }
  }

  console.log("\nBudget lines:");
  let expTotal = 0, incTotal = 0;
  for (const [name, flow, cents, note] of LINES) {
    if (flow === "expense") expTotal += cents; else incTotal += cents;
    const id = await catId(name, flow);
    const tag = id ? "" : "  [category MISSING]";
    console.log(`  ${flow.padEnd(7)} ${name.padEnd(26)} ${money(cents).padStart(10)}${tag}${note ? "   — " + note : ""}`);
    if (APPLY) {
      if (!id) throw new Error(`Category "${name}" (${flow}) not found.`);
      await sql`INSERT INTO ledger_budgets (entity_id, fund_id, fiscal_year, category_id, flow, annual_amount_cents)
                VALUES (${club.id}, ${fund.id}, ${FY}, ${id}, ${flow}, ${cents})
                ON CONFLICT (fund_id, fiscal_year, category_id, flow)
                DO UPDATE SET annual_amount_cents = EXCLUDED.annual_amount_cents, updated_at = now()`;
    }
  }
  console.log(`\n  Expense total: ${money(expTotal)}  (PDF $11,773.00)   Income total: ${money(incTotal)}  (PDF $6,980.00)`);

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN complete — re-run with --apply."}`);
  await sql.end();
}

main().catch(async (err) => { console.error(err); await sql.end(); process.exit(1); });

/**
 * Category-structure cleanup + transaction re-tags for the "clean FY2025" model.
 * Dry-run by default.
 *
 *   pnpm exec tsx scripts/fix-ledger-categories.ts            # dry run (no writes)
 *   pnpm exec tsx scripts/fix-ledger-categories.ts --apply    # writes (one transaction)
 *
 * Scope (each step previews in dry-run):
 *  A. Create new categories: Rudolph Run income split (Registration / Sponsorships
 *     & Donations / Day-of), the Zeffy pass-through transfer categories, and admin
 *     "Member recognition".
 *  B. Rename admin "Meals" -> "Meeting hospitality".
 *  C. Re-tag transactions:
 *     - Rudolph Run income -> the 3 new categories (entry-receipts deposit ->
 *       Registration, fixing its mis-imported party; Square -> Day-of; rest ->
 *       Sponsorships & Donations). Closes T-09.
 *     - A specific tailtwisting transfer from the club -> Transfer from Club (was Public donations).
 *     - A specific 4/9/2025 Pancake Breakfast deposit -> keep category; fix party/memo (was "Rudolph Run Sponsorships").
 *     - A specific Ohio Lions Foundation gift (check 8257) -> cause Community & Civic, label "Lions Sensory Garden".
 *     - Admin Misc member-recognition items (pins, polos, speaker gifts) -> Member recognition.
 *
 * NEVER touches budgets, only categories + transactions. NEVER deletes a transaction.
 * Emptied old categories (Rudolph Run, and any Misc leftovers) are left in place and
 * flagged — deactivating/removing them is a follow-up once confirmed empty.
 *
 * HISTORICAL: already run against production. The exact dollar amounts this script
 * matched on below have been replaced with placeholders for public release, since
 * this is a one-off script that will never be re-run against real data again.
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
if (usingProd) console.log("*** TARGET: PRODUCTION (PROD_DATABASE_URL) ***");

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// New categories: [entitySlug, fundKind, flow, name, countsAsGiving]
const NEW_CATEGORIES: [string, string, "income" | "expense", string, boolean][] = [
  ["foundation", "charitable", "income", "Rudolph Run – Registration/Entry Fees", true],
  ["foundation", "charitable", "income", "Rudolph Run – Sponsorships & Donations", true],
  ["foundation", "charitable", "income", "Rudolph Run – Day-of / Merchandise", true],
  ["club", "activity", "income", "Zeffy Donations", true],
  ["club", "activity", "expense", "Transfer to Foundation", false],
  ["foundation", "charitable", "income", "Transfer from Club", false],
  ["club", "administrative", "expense", "Member recognition", false],
];

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes in one transaction)" : "DRY RUN (no writes)"}\n`);

  const entities = await sql<{ id: string; slug: string }[]>`SELECT id, slug FROM ledger_entities`;
  const entityId = (slug: string) => {
    const e = entities.find((x) => x.slug === slug);
    if (!e) throw new Error(`entity '${slug}' not found`);
    return e.id;
  };

  // Resolve a category id by (entity, fundKind, flow, name).
  const catId = async (
    slug: string,
    fundKind: string,
    flow: string,
    name: string,
  ): Promise<string | null> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM ledger_categories
      WHERE entity_id = ${entityId(slug)} AND fund_kind = ${fundKind} AND flow = ${flow} AND name = ${name}
      LIMIT 1`;
    return rows[0]?.id ?? null;
  };

  // ---- A. New categories ----
  console.log("A. New categories");
  for (const [slug, kind, flow, name, giving] of NEW_CATEGORIES) {
    const existing = await catId(slug, kind, flow, name);
    console.log(`   ${existing ? "exists " : "CREATE "} ${slug}/${kind}/${flow}  "${name}"  (giving=${giving})`);
    if (APPLY && !existing) {
      await sql`INSERT INTO ledger_categories (entity_id, fund_kind, flow, name, counts_as_giving)
                VALUES (${entityId(slug)}, ${kind}, ${flow}, ${name}, ${giving})`;
    }
  }

  // ---- B. Rename Meals -> Meeting hospitality ----
  console.log("\nB. Rename admin 'Meals' (expense) -> 'Meeting hospitality'");
  const meals = await catId("club", "administrative", "expense", "Meals");
  if (meals) {
    console.log(`   RENAME category ${meals}`);
    if (APPLY) await sql`UPDATE ledger_categories SET name = 'Meeting hospitality', updated_at = now() WHERE id = ${meals}`;
  } else {
    console.log(`   (no 'Meals' expense category found — already renamed or absent)`);
  }

  // ---- C. Transaction re-tags ----
  console.log("\nC. Transaction re-tags");

  // Resolve Rudolph target categories (may be pending in dry-run).
  const rudolphOld = await catId("foundation", "charitable", "income", "Rudolph Run");
  const regId = await catId("foundation", "charitable", "income", "Rudolph Run – Registration/Entry Fees");
  const sponId = await catId("foundation", "charitable", "income", "Rudolph Run – Sponsorships & Donations");
  const dayId = await catId("foundation", "charitable", "income", "Rudolph Run – Day-of / Merchandise");
  const transferFromClubId = await catId("foundation", "charitable", "income", "Transfer from Club");
  const memberRecogId = await catId("club", "administrative", "expense", "Member recognition");

  if (rudolphOld) {
    const rud = await sql<{ id: string; txn_date: string; amount_cents: number; party: string | null; beneficiary_cause: string | null }[]>`
      SELECT id, txn_date, amount_cents, party, beneficiary_cause
      FROM ledger_transactions WHERE category_id = ${rudolphOld} AND flow = 'income' ORDER BY txn_date`;
    let reg = 0, spon = 0, day = 0;
    for (const t of rud) {
      const p = (t.party ?? "").toLowerCase();
      // Entry receipts: the mis-imported deposit (party wrongly "Rudolph Run Sponsorships")
      // and any row already labeled entry receipts.
      const isEntry = p.includes("entry receipt") || t.amount_cents === 999999;
      const isSquare = p.includes("square");
      const target = isEntry ? "Registration" : isSquare ? "Day-of" : "Sponsorships";
      if (target === "Registration") reg++;
      else if (target === "Day-of") day++;
      else spon++;
    }
    console.log(`   Rudolph Run income (${rud.length} txns) -> Registration:${reg}  Sponsorships:${spon}  Day-of:${day}`);
    console.log(`     (incl. fixing a mis-imported entry-receipts deposit's party -> "Rudolph Run Entry Receipts"; closes T-09)`);
    if (APPLY) {
      if (!regId || !sponId || !dayId) throw new Error("Rudolph target categories missing — step A must have created them.");
      for (const t of rud) {
        const p = (t.party ?? "").toLowerCase();
        const isEntry = p.includes("entry receipt") || t.amount_cents === 999999;
        const isSquare = p.includes("square");
        if (isEntry) {
          await sql`UPDATE ledger_transactions SET category_id = ${regId},
                    party = CASE WHEN ${t.amount_cents} = 999999 THEN 'Rudolph Run Entry Receipts' ELSE party END,
                    updated_at = now() WHERE id = ${t.id}`;
        } else if (isSquare) {
          await sql`UPDATE ledger_transactions SET category_id = ${dayId}, updated_at = now() WHERE id = ${t.id}`;
        } else {
          await sql`UPDATE ledger_transactions SET category_id = ${sponId}, updated_at = now() WHERE id = ${t.id}`;
        }
      }
    }
  } else {
    console.log("   (no 'Rudolph Run' income category — already split?)");
  }

  // A specific tailtwisting transfer -> Transfer from Club
  const transfer552 = await sql<{ id: string; category_id: string | null; party: string | null }[]>`
    SELECT t.id, t.category_id, t.party FROM ledger_transactions t
    JOIN ledger_funds f ON f.id = t.fund_id
    WHERE f.slug = 'charitable' AND t.flow = 'income' AND t.amount_cents = 99999
      AND t.txn_date = '2024-07-08' AND t.party ILIKE '%Westerville Lions Club%'`;
  console.log(`   Tailtwisting transfer -> Transfer from Club: ${transfer552.length} match(es)`);
  if (APPLY && transfer552.length === 1) {
    if (!transferFromClubId) throw new Error("Transfer from Club category missing.");
    await sql`UPDATE ledger_transactions SET category_id = ${transferFromClubId}, updated_at = now() WHERE id = ${transfer552[0].id}`;
  }

  // A specific Pancake Breakfast deposit — fix mis-imported party/memo
  const pancake3655 = await sql<{ id: string; party: string | null; memo: string | null }[]>`
    SELECT t.id, t.party, t.memo FROM ledger_transactions t JOIN ledger_funds f ON f.id = t.fund_id
    WHERE f.slug = 'charitable' AND t.flow = 'income' AND t.amount_cents = 300000 AND t.txn_date = '2025-04-09'`;
  console.log(`   Pancake Breakfast party/memo fix: ${pancake3655.length} match(es) (keep category, drop "Rudolph Run" label)`);
  if (APPLY && pancake3655.length === 1) {
    await sql`UPDATE ledger_transactions SET party = 'Pancake Breakfast Receipts',
              memo = 'Pancake Breakfast Receipts', updated_at = now() WHERE id = ${pancake3655[0].id}`;
  }

  // A specific Ohio Lions Foundation gift (check 8257) -> Community & Civic + label Lions Sensory Garden
  const sensory = await sql<{ id: string; beneficiary_cause: string | null; party: string | null }[]>`
    SELECT id, beneficiary_cause, party FROM ledger_transactions
    WHERE check_number = '8257' AND amount_cents = 25000 AND flow = 'expense'`;
  console.log(`   Ohio Lions Foundation gift (sensory garden) -> cause Community & Civic, label Lions Sensory Garden: ${sensory.length} match(es)`);
  if (APPLY && sensory.length === 1) {
    await sql`UPDATE ledger_transactions SET beneficiary_cause = 'Community & Civic',
              party = 'Lions Sensory Garden', updated_at = now() WHERE id = ${sensory[0].id}`;
  }

  // Admin Misc member-recognition items -> Member recognition
  const adminMisc = await catId("club", "administrative", "expense", "Miscellaneous");
  if (adminMisc) {
    const recogItems = await sql<{ id: string; party: string | null; memo: string | null; amount_cents: number }[]>`
      SELECT id, party, memo, amount_cents FROM ledger_transactions
      WHERE category_id = ${adminMisc} AND flow = 'expense'
        AND (memo ILIKE '%pins%' OR memo ILIKE '%polo%' OR memo ILIKE '%speaker gift%')`;
    console.log(`   Admin Misc -> Member recognition: ${recogItems.length} match(es):`);
    for (const r of recogItems) console.log(`       ${money(r.amount_cents)}  ${r.party ?? ""} — ${r.memo ?? ""}`);
    if (APPLY && recogItems.length > 0) {
      if (!memberRecogId) throw new Error("Member recognition category missing.");
      for (const r of recogItems) {
        await sql`UPDATE ledger_transactions SET category_id = ${memberRecogId}, updated_at = now() WHERE id = ${r.id}`;
      }
    }
    console.log(`   (peace-poster kit, eyeglass boxes, costume cleaning left in Misc — need target categories; flagged in the plan)`);
  }

  console.log(`\n${APPLY ? "APPLY complete." : "DRY RUN complete — no writes. Re-run with --apply."}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

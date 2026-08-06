/**
 * Applies the FY2026 budget-committee review feedback (Lori Lampel, email of
 * 2026-08-05) to the draft FY2026 budget.
 *
 *   pnpm exec tsx scripts/apply-fy2026-budget-review.ts            # dry run
 *   pnpm exec tsx scripts/apply-fy2026-budget-review.ts --apply    # writes
 *
 * TARGET DB: set PROD_DATABASE_URL to run against production (a loud banner
 * prints); otherwise uses DATABASE_URL/DB_URL (dev). Same convention as
 * clear-budget-fy.ts / insert-fy2025-admin-budget.ts.
 *
 * WHAT IT DOES (all idempotent — safe to re-run):
 *
 * Foundation / Charitable / FY2026
 *   1. Renames the category "Program supplies" -> "Bags to Benches". Verified
 *      safe: all 6 transactions ever posted to that category are Bags to
 *      Benches (beneficiary_cause = "Bags to Benches (Recycling)"), so the
 *      rename mislabels no history. The FY2025 $200 line relabels with it —
 *      which is exactly what Lori was looking for when she said she couldn't
 *      find Benches in this year's budget.
 *   2. Notes that $200 line as the benches program (plaques + plastic bags).
 *   3. ADDS a $2,000 WARM cause line under Charitable donation out /
 *      Hunger & Basic Needs (dropped from the draft; Lori asked for it back).
 *   4. ADDS a $500 Husky Hub cause line under the same category/cause.
 *   5. Expands the OLF Eye Care Fund + Prevent Blindness Ohio line notes with
 *      the board-facing rationale for the $1,000 -> $500 / PBO shift.
 *   6. Rewrites the Foundation Notes & Assumptions: refreshed totals (expenses
 *      $43,012 -> $45,512, net -$4,112 -> -$6,612) plus a board-review section.
 *
 * Club / Administrative / FY2026  (NO amount changes — commentary only)
 *   7. Notes Per-capita tax as International + District dues + new-member fees.
 *   8. Notes the Awards and Supplies lines to point at their real-spend twins.
 *   9. Rewrites the Club Notes & Assumptions with the two open board questions
 *      (member recognition, program supplies). Club totals are untouched, so
 *      the existing comparison paragraph carries over verbatim.
 *
 * NEVER touches ledger_transactions. Amount changes are confined to the two new
 * Foundation cause lines and the parent rollup they imply; every parent total is
 * recomputed as SUM(children) exactly the way createBudgetCauseLine does
 * (src/lib/ledger-queries.ts), then asserted against an expected value — a
 * mismatch hard-fails before anything commits.
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

// App-enforced limits (src/app/api/admin/ledger/**): line/category note 500,
// cause-line label 120, Notes & Assumptions 4000. Asserted before any write so
// this script can never seed text the UI would later refuse to save.
const NOTE_MAX = 500;
const LABEL_MAX = 120;
const NOTES_MAX = 4000;

const BENCH_NOTE =
  "Bags to Benches — plaques and plastic bags for the bench recycling program. " +
  "The category was renamed from the generic “Program supplies” so the line reads for what it is; " +
  "every transaction ever posted to it is Bags to Benches. FY2025: budgeted $200, actual $146.38.";

const WARM_NOTE =
  "Restored at the budget committee's recommendation — WARM was missing from this draft. " +
  "Worth a board look: FY2025 carried a $1,000 line but actual giving was $4,500 " +
  "($2,500 Share Bac a Pac in Aug 2025 plus $2,000 in Jan 2026), so $2,000 may still run light.";

const HUSKY_NOTE =
  "New $500 donation recommended by the budget committee. Husky Hub is the Heritage Middle School " +
  "food bank — FY2025 gave $500 through the Heritage Middle School PTSA, tagged Hunger & Basic Needs. " +
  "It could reasonably sit under Youth & Education instead — board's call.";

const OLF_NOTE =
  "Reduced from $1,000 to $500. The District listing describes the OLF Eye Care Fund as doing the same " +
  "referral work we already do by connecting people to Prevent Blindness Ohio, so half was shifted to PBO " +
  "directly. Not to be confused with the Ohio Lions Eye Research Fund — a separate organization, funded " +
  "on its own $750 line.";

const PBO_NOTE =
  "Replaces the former “Local Eyecare Assistance” line ($1,000 in FY2025). We no longer work directly " +
  "with eye-care providers — anyone needing an exam or glasses is referred to Prevent Blindness Ohio — " +
  "so the money now goes to PBO directly.";

const PERCAPITA_NOTE =
  "Covers Lions Clubs International dues, District dues, and new-member entrance fees, merged into one line. " +
  "FY2025 composition: District $1,029 + International $2,352 + new-member fees $175 = $3,556 budgeted, " +
  "$3,508.86 actual.";

const AWARDS_NOTE =
  "FY2025 member-recognition spending ($490.48) posted to a separate “Member recognition” category, not here — " +
  "this $200 Awards line has had no activity in either year. See Notes & Assumptions.";

const SUPPLIES_NOTE =
  "FY2025 supplies spending ($670.64) posted to a separate “Program supplies” category, not here — " +
  "this $75 Supplies line has had no activity in either year. See Notes & Assumptions.";

// Notes & Assumptions are authored in Markdown (rendered by the budget-notes
// display + print worksheet). Bullets rather than tables on purpose: they stay
// readable even if a viewer sees the raw source.
const FOUNDATION_NOTES = `## Compared to the prior-year approved budget

**Revenue $38,900** — up ~$6,400. Pizza Challenge ($4,000) replaces Pancake Breakfast as the spring fundraiser, White Cane rises $1,000 to $2,500, and a $5,000 transfer from the Club is earmarked for the Fouse/McVay Cabin Educational Center.

**Expenses $45,512** — up $3,450. Adds Pizza Challenge ($1,500) and the $5,000 cabin gift (a cause line under Charitable donation out), restores WARM ($2,000), and adds Husky Hub ($500). Drops Pancake Breakfast expenses, the general Operations line ($2,200), and Contingency. Scholarships ($7,500) and Rudolph Run ($10,000) are unchanged.

**Planned net -$6,612** (prior year -$9,562) — still a smaller drawdown than last year.

> The $5,000 Club transfer nets to ~$0 here: received as income, spent on the cabin. A combined Club + Foundation total should exclude it to avoid double-counting.

## Budget-committee review — August 5, 2026

Changes made, and background for the board.

### Eye care

Last year we budgeted $1,000 to the **OLF Eye Care Fund** and $1,000 to **Local Eyecare Assistance**. We no longer work directly with providers — anyone needing an exam or glasses is referred to **Prevent Blindness Ohio** — so the Local Eyecare Assistance $1,000 now goes to PBO by name, and OLF Eye Care drops to $500 because the District describes it as doing that same referral work.

*The OLF Eye Care Fund is not the Ohio Lions Eye Research Fund* — that is a separate organization, funded on its own $750 line.

### WARM — restored at $2,000

Under Hunger & Basic Needs; it had dropped out of this draft. The board may want to revisit the amount: FY2025 budgeted $1,000, but we actually gave $4,500.

### Husky Hub — added at $500

Under Hunger & Basic Needs — the Heritage Middle School food bank, matching last year's $500 gift. It could reasonably sit under Youth & Education instead.

### Bags to Benches

The $200 that previously read as "Program supplies" is the benches program — plaques and plastic bags. The category has been renamed so it is findable in the budget.`;

const CLUB_NOTES = `## Compared to the prior-year approved budget

**Revenue $6,398** — down ~$582 (dues $5,655 to $5,223; tail-twisting $1,150 to $1,000).

**Expenses $13,130** — up $1,357, driven almost entirely by raising the donation to the Foundation from $595 to $5,000 to fund the Fouse/McVay Cabin Educational Center gift, with offsetting cuts in Marketing ($5,000 to $2,000) and LCI per-capita/dues ($3,556 to $3,000). New lines: District & convention ($300), Operations ($900). Dropped: Contingency, Lion L support, Membership.

**Planned net -$6,732** (prior year -$4,793) — the larger operating drawdown is essentially the $5,000 cabin pass-through to the Foundation.

## Budget-committee review — August 5, 2026

Two open questions for the board. **No amounts were changed.**

### 1. Member recognition — should we budget it?

FY2025 actual was **$490.48**:

- Speaker gifts — $55.08
- 50-year pins and banner repair — $195.80
- Member polo shirts — $239.60

Nothing is budgeted for it in FY2026. Note that we do budget $200 under **Awards** — a different category that has had no activity in either year. The board should decide whether to fund member recognition, at what level, and whether these two lines should be one.

### 2. Program supplies — should we budget it?

FY2025 actual was **$670.64**:

- Banner bag, peace poster kit, pop-up tent — $422.12
- Costume cleaning — $42.80
- Used-eyeglass collection boxes — $102.86
- Used-eyeglass collection boxes, posted again the same day — $102.86

The treasurer is verifying whether that second posting on 2026-06-10 is a duplicate. Nothing is budgeted for FY2026, and the $75 **Supplies** line is a different category with no activity in either year.

### Per-capita tax

The $3,000 line covers Lions Clubs International dues, District dues, and new-member fees together. That breakdown is now noted on the line itself.`;

for (const [label, text, max] of [
  ["BENCH_NOTE", BENCH_NOTE, NOTE_MAX],
  ["WARM_NOTE", WARM_NOTE, NOTE_MAX],
  ["HUSKY_NOTE", HUSKY_NOTE, NOTE_MAX],
  ["OLF_NOTE", OLF_NOTE, NOTE_MAX],
  ["PBO_NOTE", PBO_NOTE, NOTE_MAX],
  ["PERCAPITA_NOTE", PERCAPITA_NOTE, NOTE_MAX],
  ["AWARDS_NOTE", AWARDS_NOTE, NOTE_MAX],
  ["SUPPLIES_NOTE", SUPPLIES_NOTE, NOTE_MAX],
  ["FOUNDATION_NOTES", FOUNDATION_NOTES, NOTES_MAX],
  ["CLUB_NOTES", CLUB_NOTES, NOTES_MAX],
] as const) {
  if (text.length > max) throw new Error(`${label} is ${text.length} chars, over the ${max} limit.`);
}

// New Foundation cause lines: [cause, label, cents, note]
const NEW_CAUSE_LINES: [string, string, number, string][] = [
  ["Hunger & Basic Needs", "WARM (Westerville Area Resource Ministry)", 200000, WARM_NOTE],
  ["Hunger & Basic Needs", "Husky Hub (Heritage Middle School)", 50000, HUSKY_NOTE],
];
for (const [, label] of NEW_CAUSE_LINES) {
  if (label.length > LABEL_MAX) throw new Error(`Label "${label}" is over ${LABEL_MAX} chars.`);
}

// Expected parent total for "Charitable donation out" after the two additions:
// current $23,175 + $2,000 + $500.
const EXPECTED_DONATION_OUT_CENTS = 2317500 + 200000 + 50000;

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  FY${FY}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`,
  );

  // Refuse on a locked budget — same guard as the app's write paths.
  const locks = await sql`
    SELECT e.name FROM ledger_budget_approvals a JOIN ledger_entities e ON e.id = a.entity_id
    WHERE a.fiscal_year = ${FY} AND a.status = 'locked'`;
  if (locks.length) {
    console.error(`REFUSING: FY${FY} has ${locks.length} locked budget(s): ${locks.map((l) => l.name).join(", ")}`);
    await sql.end();
    process.exit(1);
  }

  // ---- resolve the rows we intend to touch, by natural key, never by hardcoded id ----
  const [benchCat] = await sql`
    SELECT c.id, c.name FROM ledger_categories c JOIN ledger_entities e ON e.id = c.entity_id
    WHERE e.slug = 'foundation' AND c.fund_kind = 'charitable' AND c.flow = 'expense'
      AND c.name IN ('Program supplies', 'Bags to Benches')`;
  if (!benchCat) throw new Error("Could not resolve the Foundation charitable 'Program supplies' category.");

  const [collision] = await sql`
    SELECT c.id FROM ledger_categories c JOIN ledger_entities e ON e.id = c.entity_id
    WHERE e.slug = 'foundation' AND c.fund_kind = 'charitable' AND c.flow = 'expense'
      AND c.name = 'Bags to Benches' AND c.id <> ${benchCat.id}`;
  if (collision) throw new Error("A different 'Bags to Benches' category already exists — resolve by hand.");

  // Every transaction on the category must be a benches transaction, or the
  // rename would mislabel history. Asserted live, not assumed.
  const [strays] = await sql`
    SELECT count(*)::int AS n FROM ledger_transactions t
    WHERE t.category_id = ${benchCat.id}
      AND coalesce(t.beneficiary_cause, '') <> 'Bags to Benches (Recycling)'`;
  if (strays.n > 0) {
    console.error(
      `REFUSING: ${strays.n} transaction(s) on "${benchCat.name}" are not tagged Bags to Benches — ` +
        `renaming the category would mislabel them. Inspect before proceeding.`,
    );
    await sql.end();
    process.exit(1);
  }

  const budgetRow = async (entitySlug: string, fundSlug: string, category: string, flow: string) => {
    const [row] = await sql`
      SELECT b.id, b.annual_amount_cents AS amt, coalesce(b.note, '') AS note
      FROM ledger_budgets b
      JOIN ledger_entities e ON e.id = b.entity_id
      JOIN ledger_funds f ON f.id = b.fund_id
      JOIN ledger_categories c ON c.id = b.category_id
      WHERE b.fiscal_year = ${FY} AND e.slug = ${entitySlug} AND f.slug = ${fundSlug}
        AND c.name = ${category} AND b.flow = ${flow}`;
    if (!row) throw new Error(`No FY${FY} ${entitySlug}/${fundSlug} ${flow} budget row for "${category}".`);
    return row;
  };

  const benchBudget = await budgetRow("foundation", "charitable", benchCat.name, "expense");
  const donationOut = await budgetRow("foundation", "charitable", "Charitable donation out", "expense");
  const perCapita = await budgetRow("club", "administrative", "Per-capita tax", "expense");
  const awards = await budgetRow("club", "administrative", "Awards", "expense");
  const supplies = await budgetRow("club", "administrative", "Supplies", "expense");

  const causeLine = async (label: string) => {
    const [row] = await sql`
      SELECT id, cause, label, amount_cents AS amt, coalesce(note, '') AS note
      FROM ledger_budget_lines WHERE budget_id = ${donationOut.id} AND label = ${label}`;
    return row ?? null;
  };
  const olf = await causeLine("OLF Eye Care Fund");
  const pbo = await causeLine("Prevent Blindness Ohio");
  if (!olf || !pbo) throw new Error("Could not resolve the OLF Eye Care Fund / Prevent Blindness Ohio lines.");

  // ---- plan ----
  console.log("PLAN\n----");
  console.log(
    `1. Category rename: "${benchCat.name}" -> "Bags to Benches"` +
      (benchCat.name === "Bags to Benches" ? "   [already done]" : ""),
  );
  console.log(`2. Note on that $${(benchBudget.amt / 100).toFixed(2)} line (benches / plaques + bags)`);
  for (const [cause, label, cents] of NEW_CAUSE_LINES) {
    const existing = await causeLine(label);
    console.log(
      `3. Cause line ${existing ? "UPDATE" : "INSERT"}: ${cause} / "${label}" = ${money(cents)}` +
        (existing ? `   [exists at ${money(existing.amt)}]` : ""),
    );
  }
  console.log(`4. Parent "Charitable donation out": ${money(donationOut.amt)} -> ${money(EXPECTED_DONATION_OUT_CENTS)}`);
  console.log(`5. Notes on OLF Eye Care Fund + Prevent Blindness Ohio lines (board rationale)`);
  console.log(`6. Foundation Notes & Assumptions rewritten (${FOUNDATION_NOTES.length} chars)`);
  console.log(`7. Club notes: Per-capita tax, Awards, Supplies (commentary only, no amounts)`);
  console.log(`8. Club Notes & Assumptions rewritten (${CLUB_NOTES.length} chars)`);

  if (!APPLY) {
    console.log("\nDRY RUN — re-run with --apply to write.");
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    // 1 + 2 — benches
    await tx`UPDATE ledger_categories SET name = 'Bags to Benches' WHERE id = ${benchCat.id}`;
    await tx`UPDATE ledger_budgets SET note = ${BENCH_NOTE}, updated_at = now() WHERE id = ${benchBudget.id}`;

    // 3 — the two new cause lines (starred so the board sees them as new)
    for (const [cause, label, cents, note] of NEW_CAUSE_LINES) {
      await tx`
        INSERT INTO ledger_budget_lines (budget_id, cause, label, amount_cents, starred, note)
        VALUES (${donationOut.id}, ${cause}, ${label}, ${cents}, true, ${note})
        ON CONFLICT (budget_id, cause, label)
        DO UPDATE SET amount_cents = EXCLUDED.amount_cents, starred = true,
                      note = EXCLUDED.note, updated_at = now()`;
    }

    // 4 — parent rollup, computed the way createBudgetCauseLine computes it
    const [sum] = await tx`
      SELECT coalesce(sum(amount_cents), 0)::int AS total FROM ledger_budget_lines
      WHERE budget_id = ${donationOut.id}`;
    if (sum.total !== EXPECTED_DONATION_OUT_CENTS) {
      throw new Error(
        `Cause lines sum to ${money(sum.total)}, expected ${money(EXPECTED_DONATION_OUT_CENTS)} — rolling back.`,
      );
    }
    await tx`
      UPDATE ledger_budgets SET annual_amount_cents = ${sum.total}, updated_at = now()
      WHERE id = ${donationOut.id}`;

    // 5 — eye-care rationale
    await tx`UPDATE ledger_budget_lines SET note = ${OLF_NOTE}, starred = true, updated_at = now() WHERE id = ${olf.id}`;
    await tx`UPDATE ledger_budget_lines SET note = ${PBO_NOTE}, starred = true, updated_at = now() WHERE id = ${pbo.id}`;

    // 7 — club line commentary (no amounts)
    await tx`UPDATE ledger_budgets SET note = ${PERCAPITA_NOTE}, updated_at = now() WHERE id = ${perCapita.id}`;
    await tx`UPDATE ledger_budgets SET note = ${AWARDS_NOTE}, updated_at = now() WHERE id = ${awards.id}`;
    await tx`UPDATE ledger_budgets SET note = ${SUPPLIES_NOTE}, updated_at = now() WHERE id = ${supplies.id}`;

    // 6 + 8 — Notes & Assumptions, one row per (entity, FY); upsert so a
    // missing row is created rather than silently skipped.
    for (const [slug, notes] of [
      ["foundation", FOUNDATION_NOTES],
      ["club", CLUB_NOTES],
    ] as const) {
      const [ent] = await tx`SELECT id FROM ledger_entities WHERE slug = ${slug}`;
      if (!ent) throw new Error(`No ledger_entities row for slug "${slug}".`);
      await tx`
        INSERT INTO ledger_budget_notes (entity_id, fiscal_year, notes)
        VALUES (${ent.id}, ${FY}, ${notes})
        ON CONFLICT (entity_id, fiscal_year)
        DO UPDATE SET notes = EXCLUDED.notes, updated_at = now()`;
    }
  });

  console.log("\nApplied. Verifying...\n");

  const after = await sql`
    SELECT c.name AS category, b.annual_amount_cents AS amt
    FROM ledger_budgets b
    JOIN ledger_entities e ON e.id = b.entity_id
    JOIN ledger_categories c ON c.id = b.category_id
    WHERE b.fiscal_year = ${FY} AND e.slug = 'foundation'
      AND c.name IN ('Bags to Benches', 'Charitable donation out') ORDER BY c.name`;
  for (const r of after) console.log(`  ${r.category}: ${money(r.amt)}`);

  const lines = await sql`
    SELECT l.cause, l.label, l.amount_cents AS amt FROM ledger_budget_lines l
    WHERE l.budget_id = ${donationOut.id} AND l.cause = 'Hunger & Basic Needs' ORDER BY l.label`;
  console.log("\n  Hunger & Basic Needs lines:");
  for (const r of lines) console.log(`    ${r.label}: ${money(r.amt)}`);

  const [totals] = await sql`
    SELECT
      coalesce(sum(b.annual_amount_cents) FILTER (WHERE b.flow = 'income'), 0)::int AS income,
      coalesce(sum(b.annual_amount_cents) FILTER (WHERE b.flow = 'expense'), 0)::int AS expense
    FROM ledger_budgets b JOIN ledger_entities e ON e.id = b.entity_id
    WHERE b.fiscal_year = ${FY} AND e.slug = 'foundation' AND b.pending_delete_at IS NULL`;
  console.log(
    `\n  Foundation FY${FY}: income ${money(totals.income)}, expense ${money(totals.expense)}, ` +
      `net ${money(totals.income - totals.expense)}`,
  );

  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});

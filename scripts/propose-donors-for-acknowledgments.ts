/**
 * Proposes donor records for acknowledgments that have none, and links them.
 *
 * WHY THIS EXISTS
 *   On 2026-08-09 a close-out script marked every historical acknowledgment
 *   (2026-03-07 and earlier) as sent, at the treasurer's request — but none of
 *   them had a donor linked, and nothing prompted for one. Production now holds
 *   49 sent acknowledgments with no donor. An acknowledgment without a donor
 *   cannot produce a letter and cannot feed a 990 Schedule B entry, so they are
 *   not merely untidy: they are incomplete records.
 *
 *   The donors table holds ONE row, so there is almost nothing to match
 *   against. This creates the donors from the transaction's `party` name.
 *
 * THE CAREFUL PART — near-duplicate party names
 *   The same giver often appears under slightly different strings. Illustrative
 *   shapes only — real donor names are NOT reproduced in this file, because
 *   this repository is public (see CLAUDE.md -> No Personal Data in the
 *   Repository). Run the dry run to see the club's actual list.
 *
 *     "Acme Heating & Cooling"    vs  "Acme Heating and Cooling"   (punctuation)
 *     "Northside Presbyterian"    vs  "Northside Presbyterian Church" (suffix)
 *     "Example Post"              vs  "Example Post 171"           (chapter no.)
 *     "Pat Q. Example"            vs  "Pat Q. Example III"         (generational)
 *
 *   The first three are obviously one giver. The last is NOT obviously one — a
 *   suffix like "III" frequently distinguishes a father from a son, and merging
 *   them would put one person's giving on another person's tax receipt.
 *
 *   So this script does NOT auto-merge on similarity. It:
 *     - groups only on a SAFE normalisation (case, whitespace, punctuation,
 *       "&" vs "and", and a trailing legal suffix like Inc/LLC/Co),
 *     - and REPORTS everything else that merely looks similar, for the
 *       treasurer to decide by hand.
 *
 *   Being wrong here is worse than being slow: a merged donor is hard to
 *   unpick once letters have gone out under it.
 *
 * Usage:
 *   pnpm exec tsx scripts/propose-donors-for-acknowledgments.ts            # dry run (default)
 *   pnpm exec tsx scripts/propose-donors-for-acknowledgments.ts --apply    # writes
 *
 * TARGET DB: PROD_DATABASE_URL when set (loud banner), else DATABASE_URL/DB_URL.
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

/**
 * Strips a leading "From ", which is a check-memo artifact rather than part of
 * anyone's name — four party strings carry it ("From LPL Financial", "From Paul
 * Johnson", ...). Creating a donor literally named "From LPL Financial" would
 * put that on a tax receipt.
 */
function stripMemoPrefix(name: string): string {
  return name.replace(/^\s*from\s+/i, "").trim();
}

/** Safe normalisation: only differences that cannot change WHO the giver is. */
function normalise(name: string): string {
  return stripMemoPrefix(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/\b(inc|llc|llp|ltd|co|corp|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Flags names that MIGHT be the same giver. Used only to print a review list —
 * never to merge. Deliberately over-eager: a false flag costs the treasurer a
 * glance, a missed one leaves a duplicate donor in the books.
 *
 * The first version only compared prefixes and missed most real duplicates —
 * a "From " memo prefix, a slash dropped from initials, a trading-as name
 * carrying the real company at the END of the string. This compares
 * significant word-stems instead, so word order and trailing qualifiers stop
 * mattering. (Examples kept generic on purpose — public repo.)
 */
const NOISE = new Set([
  "and", "the", "of", "dba", "inc", "llc", "llp", "ltd", "co", "corp",
  "company", "services", "service", "insurance", "dds", "dmd", "md", "jr", "sr",
  "ii", "iii", "iv",
]);

function stems(name: string): Set<string> {
  return new Set(
    normalise(name)
      .replace(/[/()]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NOISE.has(w))
      // Crude stem so "brothers"/"bros" and "presbyterian"/"presbyterian" meet.
      .map((w) => w.slice(0, 5)),
  );
}

function similar(a: string, b: string): boolean {
  const [x, y] = [normalise(a), normalise(b)];
  if (x === y) return false; // already grouped — nothing to decide
  if (x.startsWith(y) || y.startsWith(x)) return true;
  const [sa, sb] = [stems(a), stems(b)];
  if (sa.size === 0 || sb.size === 0) return false;
  const shared = [...sa].filter((w) => sb.has(w)).length;
  // Every significant word of the shorter name appears in the longer one.
  return shared > 0 && shared === Math.min(sa.size, sb.size);
}

async function main() {
  console.log(`TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const rows = await sql`
    SELECT t.id AS txn_id, t.party, t.txn_date::text AS d, t.amount_cents
    FROM ledger_acknowledgments a
    JOIN ledger_transactions t ON t.id = a.donation_txn_id
    WHERE t.donor_id IS NULL AND t.party IS NOT NULL AND trim(t.party) <> ''
    ORDER BY t.party, t.txn_date`;

  const existing = await sql`SELECT id, name FROM ledger_donors`;
  const byNorm = new Map<string, { id: string; name: string }>();
  for (const d of existing) byNorm.set(normalise(d.name), { id: d.id, name: d.name });

  // Group the acknowledgments by safe-normalised party name.
  const groups = new Map<string, { display: string; txns: typeof rows }>();
  for (const r of rows) {
    const key = normalise(r.party);
    const g = groups.get(key);
    if (g) {
      g.txns.push(r);
      // Prefer the longest spelling as the display name — it is usually the
      // most complete ("... and Cooling" over "... & Cooling").
      if (r.party.length > g.display.length) g.display = r.party;
    } else {
      groups.set(key, { display: r.party, txns: [r] });
    }
  }

  console.log(`${rows.length} acknowledgments with no donor, across ${groups.size} distinct givers.\n`);

  let created = 0, reused = 0, linked = 0;
  for (const [key, g] of groups) {
    const match = byNorm.get(key);
    const total = g.txns.reduce((s, t) => s + Number(t.amount_cents), 0);
    const label = `${g.display}  (${g.txns.length} gift${g.txns.length === 1 ? "" : "s"}, $${(total / 100).toFixed(2)})`;
    if (match) {
      console.log(`  REUSE   ${label}  -> existing donor "${match.name}"`);
      reused++;
    } else {
      console.log(`  CREATE  ${label}`);
      created++;
    }
    linked += g.txns.length;

    if (!APPLY) continue;

    let donorId = match?.id;
    if (!donorId) {
      const [d] = await sql`INSERT INTO ledger_donors (name) VALUES (${g.display}) RETURNING id`;
      donorId = d.id;
      byNorm.set(key, { id: donorId, name: g.display });
    }
    await sql`UPDATE ledger_transactions SET donor_id = ${donorId}, updated_at = now()
              WHERE id = ANY(${g.txns.map((t) => t.txn_id)})`;
    await sql`UPDATE ledger_acknowledgments SET donor_id = ${donorId}, updated_at = now()
              WHERE donation_txn_id = ANY(${g.txns.map((t) => t.txn_id)})`;
  }

  // Flag look-alikes for the treasurer. Never merged automatically.
  const names = [...groups.values()].map((g) => g.display);
  const flags: string[] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      if (similar(names[i], names[j])) flags.push(`  "${names[i]}"  ~  "${names[j]}"`);

  console.log(`\n${created} donors to create, ${reused} existing reused, ${linked} acknowledgments linked.`);

  if (flags.length) {
    console.log(`\nLOOK-ALIKE NAMES — NOT merged, decide by hand (${flags.length}):`);
    flags.forEach((f) => console.log(f));
    console.log(`
  These are kept as SEPARATE donors on purpose. A suffix such as "III" often
  distinguishes a father from a son, and merging two people onto one donor puts
  one person's giving on the other's tax receipt. Merge them in the admin UI
  only where you know they are the same giver.`);
  }

  if (!APPLY) console.log("\nDRY RUN — re-run with --apply to write.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end());

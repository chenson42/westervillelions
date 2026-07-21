/**
 * Additive, UPDATE-only backfill of `ledger_transactions.check_number` for
 * rows imported by scripts/import-quicken-ledger.ts BEFORE that script
 * captured checkNumber directly (Bank Reconciliation inc1, T-18,
 * DECISION-034).
 *
 * WHY THIS SCRIPT EXISTS (not a re-run of the importer):
 * import-quicken-ledger.ts's idempotency model is destructive-and-total — on
 * --apply it deletes every [quicken-import]-marked row and reinserts all of
 * them fresh with brand-new UUIDs, computing reconciled/reconciledAt from the
 * CSV's own "Clr" column, not live DB state. Re-running it against the
 * already-seeded local dev DB would silently discard any
 * reconciliation/category/memo edits made via the admin UI since the
 * 2026-07-20 seed, and cascade-delete any ledger_acknowledgments referencing
 * a soon-to-be-replaced transaction ID. This script instead matches each CSV
 * register row to its corresponding EXISTING ledger_transactions row by
 * (entityId, txnDate, amountCents, paymentMethod='check', flow,
 * [quicken-import] marker) and does a targeted
 * `UPDATE ledger_transactions SET check_number = $1 WHERE id = $2` — never
 * touching any other column, never changing the row's id.
 *
 * MATCH DISCIPLINE: zero or multiple matches are never guessed at — they are
 * printed to a review list for a human (the treasurer / implementer) to
 * resolve manually.
 *
 * BYCATCH: this script also detects (but does not fix) a real, independent
 * data-quality defect surfaced while building it — rows currently tagged
 * paymentMethod='check' whose register "Check #" column holds a non-numeric
 * marker (e.g. "Card"), meaning they are not actually paper checks. These are
 * always reported. Correcting paymentMethod is gated behind a separate,
 * explicit --fix-payment-method flag, never bundled into the default
 * --apply.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-check-numbers.ts                         # dry run (default) — no DB writes
 *   pnpm exec tsx scripts/backfill-check-numbers.ts --apply                 # writes check_number for unambiguous matches
 *   pnpm exec tsx scripts/backfill-check-numbers.ts --apply --fix-payment-method
 *                                                                            # also corrects the mistagged debit-card rows'
 *                                                                            # paymentMethod from 'check' to 'debit_card'
 *
 * Target: DATABASE_URL/DB_URL from .env.local by default (local dev); pass
 * PROD_DATABASE_URL to target production instead (only relevant if
 * production's own first-time Quicken seed happens without the importer's
 * checkNumber-capturing enhancement already in place).
 *
 * Idempotent: re-running after a successful --apply re-derives the same
 * matches and re-applies the same values — safe, if redundant, to run twice.
 *
 * Source CSVs are treasurer financial records and intentionally live OUTSIDE
 * the repo (paths imported from import-quicken-ledger.ts). Do not copy them
 * into the repo.
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, like } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { ledgerEntities, ledgerTransactions } from "../src/lib/db/schema";
import {
  FOUNDATION_CSV,
  ADMIN_CSV,
  IMPORT_MARKER,
  parseRegisterFile,
  shouldSkipFoundation,
  shouldSkipClub,
  foundationPaymentMethod,
  clubPaymentMethod,
  deriveParty,
  type RawRow,
} from "./import-quicken-ledger";
import { classifyRegisterCheckColumn, parseCheckNumberFromMemo } from "../src/lib/check-number";

const APPLY = process.argv.includes("--apply");
const FIX_PAYMENT_METHOD = process.argv.includes("--fix-payment-method");

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
// Types
// ---------------------------------------------------------------------------

type EntityKey = "club" | "foundation";

type CheckCandidate = {
  entityKey: EntityKey;
  isoDate: string;
  amountCents: number; // positive
  flow: "income" | "expense";
  payee: string;
  memo: string;
  checkNumber: string;
};

type MistagCandidate = {
  entityKey: EntityKey;
  isoDate: string;
  flow: "income" | "expense";
  payee: string;
  amountCents: number; // positive
  rawValue: string;
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Build candidate lists from the source CSVs (mirrors
// import-quicken-ledger.ts's own skip/derive logic so this script only
// considers rows the importer actually inserted).
// ---------------------------------------------------------------------------

function buildCandidates(
  entityKey: EntityKey,
  rows: RawRow[],
): { checks: CheckCandidate[]; mistags: MistagCandidate[] } {
  const checks: CheckCandidate[] = [];
  const mistags: MistagCandidate[] = [];

  for (const row of rows) {
    const skipReason = entityKey === "foundation" ? shouldSkipFoundation(row) : shouldSkipClub(row);
    if (skipReason) continue; // never imported in the first place — nothing to backfill

    const classified = classifyRegisterCheckColumn(row.action, row.checkNum);

    if (classified.flag === "non_numeric_check_column") {
      mistags.push({
        entityKey,
        isoDate: row.isoDate,
        flow: row.amountCents > 0 ? "income" : "expense",
        payee: deriveParty(row.payeeRaw, row.memo),
        amountCents: Math.abs(row.amountCents),
        rawValue: classified.rawValue ?? row.checkNum,
      });
      continue;
    }

    if (classified.checkNumber === null) continue; // not a check row, or genuinely blank — nothing to do

    const flow: "income" | "expense" = row.amountCents > 0 ? "income" : "expense";
    const paymentMethod = entityKey === "foundation" ? foundationPaymentMethod(row) : clubPaymentMethod(row);
    if (paymentMethod !== "check") continue; // defensive — shouldn't happen when action==="Check", but never assume

    checks.push({
      entityKey,
      isoDate: row.isoDate,
      amountCents: Math.abs(row.amountCents),
      flow,
      payee: deriveParty(row.payeeRaw, row.memo),
      memo: row.memo,
      checkNumber: classified.checkNumber,
    });
  }

  return { checks, mistags };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes check_number)" : "DRY RUN (no writes)"}`);
  console.log(`Fix payment method: ${FIX_PAYMENT_METHOD ? "YES (--fix-payment-method)" : "no (report only)"}`);
  console.log(`Target: ${usingProd ? "PRODUCTION (PROD_DATABASE_URL)" : "local (.env.local DATABASE_URL/DB_URL)"}`);
  console.log(`Foundation CSV: ${FOUNDATION_CSV}`);
  console.log(`Admin CSV: ${ADMIN_CSV}`);

  const foundationRaw = parseRegisterFile(FOUNDATION_CSV);
  const adminRaw = parseRegisterFile(ADMIN_CSV);

  const foundationBuilt = buildCandidates("foundation", foundationRaw);
  const clubBuilt = buildCandidates("club", adminRaw);

  const allChecks = [...foundationBuilt.checks, ...clubBuilt.checks];
  const allMistags = [...foundationBuilt.mistags, ...clubBuilt.mistags];

  console.log(`\nParsed ${allChecks.length} candidate check rows (${foundationBuilt.checks.length} Foundation, ${clubBuilt.checks.length} Club).`);
  console.log(`Parsed ${allMistags.length} mistagged-check candidate rows (non-numeric "Check #" on an Action="Check" row).`);

  // Resolve entity UUIDs
  const entityRows = await targetDb.select().from(ledgerEntities);
  const entityIdByKey: Record<EntityKey, string> = {
    club: entityRows.find((e) => e.slug === "club")?.id ?? "",
    foundation: entityRows.find((e) => e.slug === "foundation")?.id ?? "",
  };
  if (!entityIdByKey.club || !entityIdByKey.foundation) {
    throw new Error("Could not resolve club/foundation ledger_entities rows on target DB.");
  }

  // ---- Match each check candidate to exactly one existing ledger_transactions row ----
  let matchedCount = 0;
  let noMatchCount = 0;
  let ambiguousCount = 0;

  const noMatchRows: Array<CheckCandidate & { memoHint: string | null }> = [];
  const ambiguousRows: Array<CheckCandidate & { candidateIds: string[] }> = [];
  const updates: Array<{ id: string; checkNumber: string; entityKey: EntityKey; isoDate: string; payee: string; amountCents: number }> = [];

  for (const c of allChecks) {
    const entityId = entityIdByKey[c.entityKey];
    const baseConditions = [
      eq(ledgerTransactions.entityId, entityId),
      eq(ledgerTransactions.txnDate, c.isoDate),
      eq(ledgerTransactions.amountCents, c.amountCents),
      eq(ledgerTransactions.paymentMethod, "check"),
      eq(ledgerTransactions.flow, c.flow),
      like(ledgerTransactions.memo, `%${IMPORT_MARKER}`),
    ];

    // Primary key per design (entity, date, amount, paymentMethod, flow, import
    // marker). Several same-day board-approved disbursement batches (e.g. three
    // $2,500 checks cut the same day) collide on this key alone — before
    // falling back to the ambiguous review list, narrow using `party`, which is
    // an EXACT (not guessed) secondary filter: it's the same deriveParty()
    // output the importer itself wrote into the row's party column, not an
    // inference. This can only ever turn a multi-match into a single match or
    // a zero match — it can never manufacture an incorrect single match.
    let rows = await targetDb
      .select({ id: ledgerTransactions.id, checkNumber: ledgerTransactions.checkNumber })
      .from(ledgerTransactions)
      .where(and(...baseConditions));

    if (rows.length > 1) {
      const narrowed = await targetDb
        .select({ id: ledgerTransactions.id, checkNumber: ledgerTransactions.checkNumber })
        .from(ledgerTransactions)
        .where(and(...baseConditions, eq(ledgerTransactions.party, c.payee)));
      if (narrowed.length > 0) rows = narrowed;
    }

    if (rows.length === 0) {
      noMatchCount++;
      const hint = parseCheckNumberFromMemo(c.memo);
      noMatchRows.push({
        ...c,
        memoHint: hint ? `#${hint.checkNumber}${hint.ambiguous ? " (ambiguous)" : ""}` : null,
      });
      continue;
    }

    if (rows.length > 1) {
      ambiguousCount++;
      ambiguousRows.push({ ...c, candidateIds: rows.map((r) => r.id) });
      continue;
    }

    matchedCount++;
    updates.push({
      id: rows[0].id,
      checkNumber: c.checkNumber,
      entityKey: c.entityKey,
      isoDate: c.isoDate,
      payee: c.payee,
      amountCents: c.amountCents,
    });
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("MATCH SUMMARY");
  console.log("=".repeat(78));
  console.log(`  Matched (exactly one row):     ${matchedCount}`);
  console.log(`  No match (review list below):  ${noMatchCount}`);
  console.log(`  Ambiguous (review list below):  ${ambiguousCount}`);

  if (noMatchRows.length > 0) {
    console.log(`\n  --- No-match review list (${noMatchRows.length}) ---`);
    for (const r of noMatchRows) {
      console.log(
        `    [${r.entityKey}] ${r.isoDate}  ${r.payee.padEnd(28)}  ${money(r.flow === "expense" ? -r.amountCents : r.amountCents).padStart(10)}  check#${r.checkNumber}` +
          (r.memoHint ? `  — memo hint: ${r.memoHint} (low confidence, verify manually)` : ""),
      );
    }
  }

  if (ambiguousRows.length > 0) {
    console.log(`\n  --- Ambiguous review list (${ambiguousRows.length}) ---`);
    for (const r of ambiguousRows) {
      console.log(
        `    [${r.entityKey}] ${r.isoDate}  ${r.payee.padEnd(28)}  ${money(r.flow === "expense" ? -r.amountCents : r.amountCents).padStart(10)}  check#${r.checkNumber}  — candidate ids: ${r.candidateIds.join(", ")}`,
      );
    }
  }

  // Only rows whose register "Check #" reads exactly "Card" are confirmed
  // debit-card purchases (Walmart, OTC Brands, FSP Product Decorator per
  // DECISION-034's investigation) — these are the only ones --fix-payment-method
  // is allowed to correct, and only to 'debit_card'. Any OTHER non-numeric
  // marker (e.g. the "DEP" value found on a $120 Club Dues INCOME row —
  // itself a genuine but differently-shaped anomaly: a deposit that got
  // Action="Check" in the source register) is reported for the treasurer's
  // attention but is never auto-corrected, since the correct paymentMethod
  // value for it isn't something this script can infer.
  const cardMistags = allMistags.filter((m) => m.rawValue === "Card");
  const otherMistags = allMistags.filter((m) => m.rawValue !== "Card");

  if (allMistags.length > 0) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`MISTAG REPORT — rows currently paymentMethod='check' that are NOT paper checks (${allMistags.length})`);
    console.log("=".repeat(78));
    if (cardMistags.length > 0) {
      console.log(
        `  Confirmed debit-card purchases (Check #="Card") — the only rows --fix-payment-method\n` +
          `  will correct (to paymentMethod='debit_card'):`,
      );
      for (const m of cardMistags) {
        console.log(
          `    [${m.entityKey}] ${m.isoDate}  ${m.payee.padEnd(28)}  ${money(m.flow === "expense" ? -m.amountCents : m.amountCents).padStart(10)}  Check #="${m.rawValue}"`,
        );
      }
    }
    if (otherMistags.length > 0) {
      console.log(
        `\n  Other non-numeric "Check #" markers (report only — NOT auto-corrected by --fix-payment-method,\n` +
          `  correct payment method unknown to this script, needs treasurer judgment):`,
      );
      for (const m of otherMistags) {
        console.log(
          `    [${m.entityKey}] ${m.isoDate}  ${m.payee.padEnd(28)}  ${money(m.flow === "expense" ? -m.amountCents : m.amountCents).padStart(10)}  Check #="${m.rawValue}"`,
        );
      }
    }
    console.log(
      `\n  This increment's scope is check_number only — correcting paymentMethod is a separate,\n` +
        `  independently-scoped fix (see docs/treasurer-todo.md T-21) gated behind --fix-payment-method.`,
    );
  }

  if (!APPLY) {
    console.log(`\nDry run complete — no DB writes. Re-run with --apply to write check_number for the ${matchedCount} matched row(s).`);
    if (FIX_PAYMENT_METHOD) {
      console.log(`(--fix-payment-method has no effect without --apply.)`);
    }
    await targetClient.end();
    return;
  }

  console.log(`\nApplying ${updates.length} check_number update(s)...`);
  for (const u of updates) {
    await targetDb
      .update(ledgerTransactions)
      .set({ checkNumber: u.checkNumber, updatedAt: new Date() })
      .where(eq(ledgerTransactions.id, u.id));
  }
  console.log(`Applied ${updates.length} check_number update(s).`);

  if (FIX_PAYMENT_METHOD && cardMistags.length > 0) {
    console.log(`\n--fix-payment-method set — correcting ${cardMistags.length} confirmed debit-card row(s) to paymentMethod='debit_card'...`);
    let fixed = 0;
    for (const m of cardMistags) {
      const entityId = entityIdByKey[m.entityKey];
      const rows = await targetDb
        .select({ id: ledgerTransactions.id })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.entityId, entityId),
            eq(ledgerTransactions.txnDate, m.isoDate),
            eq(ledgerTransactions.amountCents, m.amountCents),
            eq(ledgerTransactions.paymentMethod, "check"),
            eq(ledgerTransactions.flow, m.flow),
            like(ledgerTransactions.memo, `%${IMPORT_MARKER}`),
          ),
        );
      if (rows.length !== 1) {
        console.log(
          `  SKIPPED (${rows.length} matches, expected 1): [${m.entityKey}] ${m.isoDate} ${m.payee} ${money(m.flow === "expense" ? -m.amountCents : m.amountCents)}`,
        );
        continue;
      }
      await targetDb
        .update(ledgerTransactions)
        .set({ paymentMethod: "debit_card", updatedAt: new Date() })
        .where(eq(ledgerTransactions.id, rows[0].id));
      fixed++;
    }
    console.log(`Fixed ${fixed} of ${cardMistags.length} confirmed debit-card row(s).`);
    if (otherMistags.length > 0) {
      console.log(
        `${otherMistags.length} other non-"Card" mistag(s) reported above were NOT touched — needs treasurer judgment, not this flag.`,
      );
    }
  } else if (allMistags.length > 0) {
    console.log(
      `\n${allMistags.length} mistagged row(s) reported above were NOT corrected` +
        (cardMistags.length > 0 ? ` (pass --fix-payment-method --apply to correct the ${cardMistags.length} confirmed debit-card row(s)).` : "."),
    );
  }

  await targetClient.end();
}

main().catch(async (err) => {
  console.error(err);
  await targetClient.end();
  process.exit(1);
});

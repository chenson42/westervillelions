/**
 * One-time backfill: links existing posted, expense-flow ledger transactions
 * to an explicit ledger_budget_lines row (B-30, DECISION-061 — the explicit
 * transaction<->budget-line link). docs/work-log/2026-07-30-transaction-
 * budget-line-link.md.
 *
 * WHY THIS SCRIPT EXISTS: before this feature, a transaction's contribution
 * to a budget cause-line's actual was inferred entirely by string-matching
 * (categoryId, cause, party) against (categoryId, cause, label) — fragile
 * (e.g. "Pilot Dogs" vs "Pilot Dogs, Inc." never match). This script runs the
 * SAME matching logic (matchBudgetLineForTransaction / causeLineReferenceKey
 * in src/lib/ledger.ts — no new fuzzy logic, no Levenshtein, no guessing) ONE
 * TIME against all historical data and writes the result as a real FK, so
 * existing reports get the exact aggregation retroactively, not just for
 * transactions entered after this feature ships.
 *
 * ALGORITHM (per transaction, scoped to one fund at a time):
 *   1. Every posted, expense-flow transaction in the fund with
 *      budget_line_id IS NULL is a candidate.
 *   2. No categoryId at all (pre-fix reimbursement-derived rows, which were
 *      born categoryless — see the reimbursement mark-paid fix in this same
 *      feature) -> reported in its own SKIPPED bucket. Different fix path
 *      (add a category via the transaction edit form first), never lumped
 *      with a genuine label/party mismatch.
 *   3. categoryId set but blank/whitespace-only beneficiaryCause -> not
 *      reported at all (nothing to link, not a defect — most ordinary
 *      operating expenses were never cause-tagged and never will be).
 *   4. categoryId + non-blank beneficiaryCause -> resolve the transaction's
 *      fiscal year (getFiscalYear(txnDate)), look up that fund/FY/category's
 *      ledger_budgets row and its cause lines, and run
 *      matchBudgetLineForTransaction(). Exactly one match -> MATCHED
 *      (would-link in dry-run, writes budget_line_id on --apply). Zero or
 *      multiple matches -> UNMATCHED, reported with full context (category,
 *      party, cause, amount, date, and every candidate label that DID exist
 *      for that category+cause, so a mismatch is immediately legible) —
 *      NEVER guessed at.
 *
 * SCOPE: every historical fiscal year in one pass by default (Chris's
 * locked decision, Phase 1 Resolve #4) — narrow with --fiscal-year=2025 if
 * needed. --entity=club|foundation narrows to one entity; default is both.
 *
 * WRITE DISCIPLINE (hard guardrail — see project memory: the Ledger's dev
 * AND prod DBs were seeded from Quicken exports on 2026-07-20 and must NEVER
 * be re-imported, delete-and-reinsert wipes post-seed edits): this script is
 * a narrow, ID-scoped `UPDATE ledger_transactions SET budget_line_id = $1
 * WHERE id = $2 AND budget_line_id IS NULL` — it NEVER touches amountCents,
 * party, beneficiaryCause, categoryId, or any other column, and never
 * deletes or reinserts a row. Idempotent: re-running after a successful
 * --apply finds nothing left to do (every matched row already has its
 * budget_line_id set, so the WHERE clause excludes it).
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-budget-line-links.ts                          # dry run, all entities/FYs
 *   pnpm exec tsx scripts/backfill-budget-line-links.ts --entity=club            # dry run, one entity
 *   pnpm exec tsx scripts/backfill-budget-line-links.ts --fiscal-year=2025       # dry run, one FY
 *   pnpm exec tsx scripts/backfill-budget-line-links.ts --apply                  # writes
 *
 * Target: DATABASE_URL/DB_URL from .env.local by default (local dev); set
 * PROD_DATABASE_URL to target production instead. Discipline (per Chris,
 * matching every prior FY2025 books-cleanup script): dry-run dev -> review
 * the unmatched report -> --apply dev -> dry-run prod -> review -> --apply
 * prod. DO NOT run --apply without explicit review — Chris runs backfills
 * manually after reviewing the unmatched list.
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import {
  ledgerEntities,
  ledgerFunds,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetLines,
} from "../src/lib/db/schema";
import { getFiscalYear } from "../src/lib/fiscal-year";
import { matchBudgetLineForTransaction, type BackfillMatchResult } from "../src/lib/ledger";

const APPLY = process.argv.includes("--apply");
const entityArg = process.argv.find((a) => a.startsWith("--entity="));
const fyArg = process.argv.find((a) => a.startsWith("--fiscal-year="));
const ENTITY_SLUG = entityArg?.split("=")[1];
const FISCAL_YEAR = fyArg ? parseInt(fyArg.split("=")[1], 10) : undefined;

const targetUrl = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL || process.env.DB_URL;
if (!targetUrl) {
  throw new Error(
    "No DB target found — set DATABASE_URL/DB_URL in .env.local (local dev) or pass PROD_DATABASE_URL (production).",
  );
}
const usingProd = Boolean(process.env.PROD_DATABASE_URL);
const client = postgres(targetUrl);
const db = drizzle(client, { schema });

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** Parses a 'YYYY-MM-DD' txnDate as a LOCAL date — mirrors every other
 *  consumer of getFiscalYear() in this codebase (never `new Date(string)`,
 *  which shifts by the process's timezone offset). */
function parseTxnDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

type CandidateTxn = {
  id: string;
  txnDate: string;
  fundId: string;
  categoryId: string | null;
  party: string | null;
  beneficiaryCause: string | null;
  amountCents: number;
};

type BudgetLineCandidate = { id: string; cause: string; label: string; categoryId: string };

async function main() {
  console.log(
    `TARGET: ${usingProd ? "*** PRODUCTION ***" : "dev"}  |  Mode: ${APPLY ? "APPLY" : "DRY RUN"}` +
      `${ENTITY_SLUG ? `  |  entity=${ENTITY_SLUG}` : "  |  all entities"}` +
      `${FISCAL_YEAR !== undefined ? `  |  fiscalYear=${FISCAL_YEAR}` : "  |  all fiscal years"}\n`,
  );

  const allEntities = await db.select().from(ledgerEntities);
  const entities = ENTITY_SLUG ? allEntities.filter((e) => e.slug === ENTITY_SLUG) : allEntities;
  if (ENTITY_SLUG && entities.length === 0) {
    throw new Error(`entity '${ENTITY_SLUG}' not found. Available: ${allEntities.map((e) => e.slug).join(", ")}`);
  }

  let totalMatched = 0;
  let totalAmbiguous = 0;
  let totalNoMatch = 0;
  let totalSkippedNoCategory = 0;
  let totalSkippedNoCause = 0;
  const toWrite: { txnId: string; budgetLineId: string }[] = [];

  for (const entity of entities) {
    const funds = await db.select().from(ledgerFunds).where(eq(ledgerFunds.entityId, entity.id));

    for (const fund of funds) {
      // Every expense-flow budget row for this fund, across every FY, plus
      // its cause lines — fetched once per fund, no N+1 per transaction.
      const budgetRows = await db
        .select()
        .from(ledgerBudgets)
        .where(and(eq(ledgerBudgets.fundId, fund.id), eq(ledgerBudgets.flow, "expense")));
      const budgetIds = budgetRows.map((b) => b.id);
      const budgetLineRows =
        budgetIds.length > 0
          ? await db.select().from(ledgerBudgetLines).where(inArray(ledgerBudgetLines.budgetId, budgetIds))
          : [];

      const linesByBudgetId = new Map<string, BudgetLineCandidate[]>();
      for (const row of budgetLineRows) {
        const budget = budgetRows.find((b) => b.id === row.budgetId);
        if (!budget || !budget.categoryId) continue;
        const arr = linesByBudgetId.get(row.budgetId) ?? [];
        arr.push({ id: row.id, cause: row.cause, label: row.label, categoryId: budget.categoryId });
        linesByBudgetId.set(row.budgetId, arr);
      }
      const budgetIdByFyCat = new Map<string, string>(); // key `${fiscalYear}_${categoryId}`
      for (const b of budgetRows) {
        if (b.categoryId) budgetIdByFyCat.set(`${b.fiscalYear}_${b.categoryId}`, b.id);
      }

      const txns: CandidateTxn[] = await db
        .select({
          id: ledgerTransactions.id,
          txnDate: ledgerTransactions.txnDate,
          fundId: ledgerTransactions.fundId,
          categoryId: ledgerTransactions.categoryId,
          party: ledgerTransactions.party,
          beneficiaryCause: ledgerTransactions.beneficiaryCause,
          amountCents: ledgerTransactions.amountCents,
        })
        .from(ledgerTransactions)
        .where(
          and(
            eq(ledgerTransactions.fundId, fund.id),
            eq(ledgerTransactions.status, "posted"),
            eq(ledgerTransactions.flow, "expense"),
            isNull(ledgerTransactions.budgetLineId),
          ),
        );

      if (txns.length === 0) continue;

      const matched: { txn: CandidateTxn; fy: number; budgetLineId: string }[] = [];
      const ambiguous: { txn: CandidateTxn; fy: number; candidateIds: string[] }[] = [];
      const noMatch: { txn: CandidateTxn; fy: number; candidateLabels: string[] }[] = [];
      const skippedNoCategory: CandidateTxn[] = [];

      for (const txn of txns) {
        if (!txn.categoryId) {
          skippedNoCategory.push(txn);
          continue;
        }
        const cause = (txn.beneficiaryCause ?? "").trim();
        if (!cause) {
          totalSkippedNoCause++;
          continue;
        }

        const fy = getFiscalYear(parseTxnDate(txn.txnDate));
        if (FISCAL_YEAR !== undefined && fy !== FISCAL_YEAR) continue;

        const budgetId = budgetIdByFyCat.get(`${fy}_${txn.categoryId}`);
        const lines = budgetId ? (linesByBudgetId.get(budgetId) ?? []) : [];

        const result: BackfillMatchResult = matchBudgetLineForTransaction(
          { categoryId: txn.categoryId, beneficiaryCause: txn.beneficiaryCause, party: txn.party },
          lines,
        );

        if (result.status === "matched") {
          matched.push({ txn, fy, budgetLineId: result.budgetLineId });
        } else if (result.status === "unmatched" && result.reason === "ambiguous") {
          ambiguous.push({ txn, fy, candidateIds: result.candidateIds });
        } else {
          // unmatched/no-match — surface every candidate label that DID
          // exist for this (category, cause), so a Pilot-Dogs-class
          // mismatch is immediately legible, not just "no match."
          const candidateLabels = lines
            .filter((l) => l.categoryId === txn.categoryId && l.cause === cause)
            .map((l) => l.label || "(unlabeled)");
          noMatch.push({ txn, fy, candidateLabels });
        }
      }

      if (matched.length + ambiguous.length + noMatch.length + skippedNoCategory.length === 0) continue;

      console.log(`\n=== ${entity.shortName ?? entity.name} / ${fund.name} ===`);

      if (matched.length > 0) {
        console.log(`\n  MATCHED (${matched.length})${APPLY ? " — writing" : " — would link"}:`);
        for (const m of matched) {
          console.log(
            `    FY${m.fy}  ${m.txn.txnDate}  ${money(m.txn.amountCents).padStart(10)}  ${m.txn.party ?? ""} (${m.txn.beneficiaryCause})  -> line ${m.budgetLineId}`,
          );
        }
        totalMatched += matched.length;
        for (const m of matched) toWrite.push({ txnId: m.txn.id, budgetLineId: m.budgetLineId });
      }

      if (noMatch.length > 0) {
        console.log(`\n  UNMATCHED — no-match (${noMatch.length}):`);
        for (const u of noMatch) {
          const candidates = u.candidateLabels.length > 0 ? u.candidateLabels.join(", ") : "(no budget lines exist for this category+cause in this FY)";
          console.log(
            `    FY${u.fy}  ${u.txn.txnDate}  ${money(u.txn.amountCents).padStart(10)}  party="${u.txn.party ?? ""}"  cause="${u.txn.beneficiaryCause}"  candidate labels: ${candidates}`,
          );
        }
        totalNoMatch += noMatch.length;
      }

      if (ambiguous.length > 0) {
        console.log(`\n  UNMATCHED — ambiguous (${ambiguous.length}), never guessed:`);
        for (const a of ambiguous) {
          console.log(
            `    FY${a.fy}  ${a.txn.txnDate}  ${money(a.txn.amountCents).padStart(10)}  party="${a.txn.party ?? ""}"  cause="${a.txn.beneficiaryCause}"  candidates: ${a.candidateIds.join(", ")}`,
          );
        }
        totalAmbiguous += ambiguous.length;
      }

      if (skippedNoCategory.length > 0) {
        console.log(`\n  SKIPPED — no category (${skippedNoCategory.length}), reimbursement-derived or otherwise uncategorized — fix via the transaction edit form first:`);
        for (const s of skippedNoCategory) {
          console.log(`    ${s.txnDate}  ${money(s.amountCents).padStart(10)}  ${s.party ?? ""}`);
        }
        totalSkippedNoCategory += skippedNoCategory.length;
      }
    }
  }

  console.log(
    `\n=== Summary ===\nMatched: ${totalMatched}\nUnmatched (no-match): ${totalNoMatch}\nUnmatched (ambiguous): ${totalAmbiguous}\nSkipped (no category): ${totalSkippedNoCategory}\nSkipped (no cause tagged — not a defect): ${totalSkippedNoCause}\n`,
  );

  if (!APPLY) {
    console.log("DRY RUN — no writes made. Re-run with --apply once the unmatched list has been reviewed.");
    await client.end();
    return;
  }

  if (toWrite.length === 0) {
    console.log("Nothing to write.");
    await client.end();
    return;
  }

  let written = 0;
  for (const w of toWrite) {
    const res = await db
      .update(ledgerTransactions)
      .set({ budgetLineId: w.budgetLineId, updatedAt: new Date() })
      .where(and(eq(ledgerTransactions.id, w.txnId), isNull(ledgerTransactions.budgetLineId)))
      .returning({ id: ledgerTransactions.id });
    if (res.length > 0) written++;
  }
  console.log(`Wrote budget_line_id on ${written} transaction(s).`);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});

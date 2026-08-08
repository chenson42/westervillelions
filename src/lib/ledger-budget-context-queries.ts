/**
 * Server-only query for the "budget context on transaction entry" feature
 * (docs/work-log/2026-08-08-budget-context-on-transaction-entry.md,
 * DECISION-069/070). New sibling module in the DECISION-049/061/062/065
 * lineage — a narrow read surface scoped to one `(fundId, fiscalYear)` slice,
 * composing the existing pure arithmetic in `lib/ledger.ts` rather than
 * reworking `getFundReport()` (whole-fund, whole-FY, posted-only, no
 * per-category pending breakdown).
 *
 * Key invariant: "rejected never counts" is achieved by never fetching
 * rejected transactions at all (the SQL WHERE restricts to
 * `status IN ('posted', 'pending')`) — not by filtering them out after the
 * fact. Every returned row carries explicitly-labeled `postedCents` /
 * `pendingCents` fields (DECISION-069 ruling 4) so the divergence from
 * posted-only reports (e.g. `getFundReport()`) is visible, not accidental.
 *
 * Reuses, byte-for-byte, the same helpers `getFundReport()` uses for
 * cause-line/category arithmetic: `resolveCauseLineActual`,
 * `causeLineReferenceKey`, `isEligibleForFuzzyCauseMatch`,
 * `buildCauseActualsByKey`, `budgetVariance`, `resolveDisplayBudgetCents`.
 * This is the mechanism (not merely "similar logic") that keeps this
 * feature's posted-only figure from drifting apart from the fiscal report's
 * figure — see DECISION-069 ruling 3. Do NOT fork a local copy of any of
 * these functions "for convenience."
 */

import { db } from "@/lib/db";
import {
  ledgerFunds,
  ledgerCategories,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetLines,
} from "@/lib/db/schema";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { fyBounds } from "@/lib/fiscal-year";
import {
  resolveCauseLineActual,
  causeLineReferenceKey,
  isEligibleForFuzzyCauseMatch,
  buildCauseActualsByKey,
  resolveDisplayBudgetCents,
  type CauseActualSourceRow,
} from "@/lib/ledger";

export type BudgetContextCategoryRow = {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  /** null = no ledgerBudgets row for (fundId, fiscalYear, categoryId, flow),
   *  OR an annotation-only row (resolveDisplayBudgetCents convention).
   *  Never a fabricated 0 — see the panel's "No budget set" state. */
  budgetCents: number | null;
  postedCents: number;
  pendingCents: number;
};

export type BudgetContextLineRow = {
  budgetLineId: string;
  categoryId: string; // the line's OWN parent category — see module doc comment above
  categoryName: string;
  cause: string;
  label: string;
  budgetCents: number; // ledgerBudgetLines.amountCents — NOT NULL at the schema level
  postedCents: number;
  pendingCents: number;
};

export type BudgetContext = {
  fiscalYear: number;
  categories: BudgetContextCategoryRow[]; // every active category for this fund's kind, budgeted or not
  lines: BudgetContextLineRow[]; // every budget line under a ledgerBudgets row for this fund+FY
};

/**
 * Scoped to one `(fundId, fiscalYear)` slice — never per-category-selection,
 * never whole-entity-across-every-FY-ever-budgeted (DECISION-069 ruling 1).
 * Returns null when the fund doesn't exist, mirroring `getFundReport`'s
 * contract.
 */
export async function getBudgetContext(
  fundId: string,
  fiscalYear: number,
): Promise<BudgetContext | null> {
  // 1. Fetch the fund row.
  const fundRows = await db
    .select()
    .from(ledgerFunds)
    .where(eq(ledgerFunds.id, fundId))
    .limit(1);
  const fund = fundRows[0];
  if (!fund) return null;

  const { start, end } = fyBounds(fiscalYear);

  // 2. Fetch transactions for this fund+FY, restricted in SQL to
  // posted/pending — this is what makes "rejected never counts" true by
  // construction rather than by a filter someone could accidentally drop.
  const txns = await db
    .select()
    .from(ledgerTransactions)
    .where(
      and(
        eq(ledgerTransactions.fundId, fundId),
        gte(ledgerTransactions.txnDate, start),
        lt(ledgerTransactions.txnDate, end),
        inArray(ledgerTransactions.status, ["posted", "pending"]),
      ),
    );

  const postedTxns = txns.filter((t) => t.status === "posted");
  const pendingTxns = txns.filter((t) => t.status === "pending");

  // 3. Fetch every active category for this fund's kind, scoped to entity.
  // INTENTIONAL TRIM vs. getFundReport: no "extra categories that only
  // appear in actuals" pass — this query only serves live picker lookups
  // against the `categories` prop the form already preloaded, so a category
  // that's been deactivated and no longer appears in any picker doesn't
  // need a row here.
  const categories = await db
    .select()
    .from(ledgerCategories)
    .where(
      and(
        eq(ledgerCategories.entityId, fund.entityId),
        eq(ledgerCategories.fundKind, fund.kind),
        eq(ledgerCategories.isActive, true),
      ),
    );

  // 4. Fetch budgets for this fund+FY.
  const budgetRows = await db
    .select()
    .from(ledgerBudgets)
    .where(and(eq(ledgerBudgets.fundId, fundId), eq(ledgerBudgets.fiscalYear, fiscalYear)));

  // 5. Fetch every cause line under this fund+FY's budget rows, joined
  // straight through to its parent category — same join shape as
  // getBudgetLineOptions (ledger-queries.ts) so a line's categoryId/
  // categoryName never has to be cross-referenced back into the categories
  // array (see Edge Cases: "line whose parent differs from the chosen
  // category").
  const lineRows = await db
    .select({
      id: ledgerBudgetLines.id,
      cause: ledgerBudgetLines.cause,
      label: ledgerBudgetLines.label,
      amountCents: ledgerBudgetLines.amountCents,
      categoryId: ledgerBudgets.categoryId,
      categoryName: ledgerCategories.name,
      flow: ledgerBudgets.flow,
    })
    .from(ledgerBudgetLines)
    .innerJoin(ledgerBudgets, eq(ledgerBudgetLines.budgetId, ledgerBudgets.id))
    .innerJoin(ledgerCategories, eq(ledgerBudgets.categoryId, ledgerCategories.id))
    .where(and(eq(ledgerBudgets.fundId, fundId), eq(ledgerBudgets.fiscalYear, fiscalYear)));

  // ---------------------------------------------------------------------
  // Category grain
  // ---------------------------------------------------------------------

  const budgetByKey = new Map<
    string,
    { annualAmountCents: number; starred: boolean; note: string | null }
  >(); // key = `${categoryId}_${flow}`
  for (const b of budgetRows) {
    if (b.categoryId) {
      budgetByKey.set(`${b.categoryId}_${b.flow}`, {
        annualAmountCents: b.annualAmountCents,
        starred: b.starred,
        note: b.note ?? null,
      });
    }
  }

  const hasCauseLinesByKey = new Set<string>(); // key = `${categoryId}_${flow}`
  for (const line of lineRows) {
    if (line.categoryId) {
      hasCauseLinesByKey.add(`${line.categoryId}_${line.flow}`);
    }
  }

  const postedByCategoryKey = new Map<string, number>(); // key = `${categoryId}_${flow}`
  for (const txn of postedTxns) {
    if (txn.categoryId) {
      const key = `${txn.categoryId}_${txn.flow}`;
      postedByCategoryKey.set(key, (postedByCategoryKey.get(key) ?? 0) + txn.amountCents);
    }
  }
  const pendingByCategoryKey = new Map<string, number>();
  for (const txn of pendingTxns) {
    if (txn.categoryId) {
      const key = `${txn.categoryId}_${txn.flow}`;
      pendingByCategoryKey.set(key, (pendingByCategoryKey.get(key) ?? 0) + txn.amountCents);
    }
  }

  const categoryContextRows: BudgetContextCategoryRow[] = categories.map((cat) => {
    const key = `${cat.id}_${cat.flow}`;
    const budgetRow = budgetByKey.get(key);
    const rawBudgetCents = budgetRow?.annualAmountCents ?? null;
    const hasCauseLines = hasCauseLinesByKey.has(key);
    const budgetCents = resolveDisplayBudgetCents(
      rawBudgetCents,
      hasCauseLines,
      budgetRow?.starred ?? false,
      budgetRow?.note ?? null,
    );
    return {
      categoryId: cat.id,
      categoryName: cat.name,
      flow: cat.flow as "income" | "expense",
      budgetCents,
      postedCents: postedByCategoryKey.get(key) ?? 0,
      pendingCents: pendingByCategoryKey.get(key) ?? 0,
    };
  });

  // ---------------------------------------------------------------------
  // Cause-line grain — reuses lib/ledger.ts's helpers exactly, per
  // DECISION-069 ruling 3.
  // ---------------------------------------------------------------------

  // Explicit transaction<->budget-line link, posted and pending kept
  // separate (never summed together) — mirrors getFundReport's
  // actualByBudgetLineId shape, split by status.
  const linkedPostedByLineId = new Map<string, number>();
  for (const txn of postedTxns) {
    if (txn.flow === "expense" && txn.budgetLineId) {
      linkedPostedByLineId.set(
        txn.budgetLineId,
        (linkedPostedByLineId.get(txn.budgetLineId) ?? 0) + txn.amountCents,
      );
    }
  }
  // Pending has NO fuzzy fallback branch — a pending expense only ever
  // reaches a specific line through an explicit budgetLineId link (Phase 2
  // Notes: the fuzzy pool was never designed against pending data, so it
  // stays posted-only in both derivations below).
  const linkedPendingByLineId = new Map<string, number>();
  for (const txn of pendingTxns) {
    if (txn.flow === "expense" && txn.budgetLineId) {
      linkedPendingByLineId.set(
        txn.budgetLineId,
        (linkedPendingByLineId.get(txn.budgetLineId) ?? 0) + txn.amountCents,
      );
    }
  }

  // Fuzzy causeActualsByKey pool built from postedTxns ONLY — pending
  // transactions never enter this pool, matching getFundReport exactly.
  const causeActualSourceRows: CauseActualSourceRow[] = [];
  for (const txn of postedTxns) {
    if (!isEligibleForFuzzyCauseMatch(txn)) continue;
    causeActualSourceRows.push({
      categoryId: txn.categoryId!,
      cause: (txn.beneficiaryCause ?? "").trim(),
      party: txn.party,
      amountCents: txn.amountCents,
    });
  }
  const causeActualsByKey = buildCauseActualsByKey(causeActualSourceRows);

  const lineContextRows: BudgetContextLineRow[] = lineRows
    .filter((line): line is typeof line & { categoryId: string } => line.categoryId !== null)
    .map((line) => {
      const fallbackKey = causeLineReferenceKey(line.categoryId, line.cause, line.label);
      const fallbackCents = causeActualsByKey[fallbackKey] ?? null;
      const resolved = resolveCauseLineActual(
        linkedPostedByLineId.get(line.id) ?? 0,
        fallbackCents,
      );
      return {
        budgetLineId: line.id,
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        cause: line.cause,
        label: line.label,
        budgetCents: line.amountCents,
        postedCents: resolved.cents,
        pendingCents: linkedPendingByLineId.get(line.id) ?? 0,
      };
    });

  return {
    fiscalYear,
    categories: categoryContextRows,
    lines: lineContextRows,
  };
}

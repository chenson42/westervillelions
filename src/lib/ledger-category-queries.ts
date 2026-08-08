/**
 * Ledger Category Management — data-access + mutation layer for
 * `/admin/ledger/settings/categories` (docs/work-log/2026-08-07-ledger-category-management.md,
 * DECISION-065/066).
 *
 * A sibling module to `ledger-queries.ts` (5,149 lines and already past the
 * split precedent set by `reconciliation-queries.ts` / `financial-report-
 * queries.ts` / `ledger-search-queries.ts` — DECISION-049/061). This module
 * owns every new write this feature introduces (`updateCategory`,
 * `mergeCategories`) plus the one new read (`getCategoryImpact`) and the
 * audit-write helper, importing `getEntityById` / `getCategories` /
 * `assertBudgetUnlocked` from `ledger-queries.ts` unchanged rather than
 * duplicating them.
 *
 * The two scripts this feature replaces —
 * `scripts/apply-fy2026-budget-review.ts` (rename) and
 * `scripts/merge-club-budget-categories.ts` (merge) — are the de-facto spec
 * for safe behavior here: merge only ever re-points `ledger_budgets.category_id`
 * (never `ledger_transactions`), refuses on ANY source transaction, and
 * refuses on a same-fiscal-year budget-row collision on both sides.
 *
 * 2026-08-07 treasurer decision (supersedes DECISION-066 item 3's "matches
 * both precedent scripts exactly" claim, which was wrong — see
 * docs/decisions.md): merge ALSO refuses outright, naming the year(s),
 * whenever ANY fiscal year the merge would re-point is locked — not just
 * the current one. A rename only changes a label; a merge moves a budgeted
 * AMOUNT between categories, which `merge-club-budget-categories.ts` itself
 * declined to do to a locked, board-approved prior year ("would falsify the
 * historical record"). This is a whole-merge refusal, not a partial
 * per-year skip — a partial merge would leave one category's history split
 * across two names with no record of why. See DECISION-065/066 and the
 * Phase 3 design doc for the full contract.
 *
 * 2026-08-08 treasurer decision (DECISION-068, corrects DECISION-067 in
 * place — see docs/decisions.md): the lock-based guard above is necessary
 * but was found NOT sufficient. As of 2026-08-08 no fiscal year has ever
 * actually been locked in this database (every `ledger_budget_approvals`
 * row on record was a QA test artifact, all `unlocked`), so the lock check
 * alone never fired for the real `Awards`/`Supplies` merges it was written
 * to protect — both categories carry only a leftover FY2025 row, and
 * FY2025 has no lock row at all. Merge now ALSO refuses outright, naming
 * the year(s), whenever ANY fiscal year it would re-point is EARLIER than
 * the current fiscal year (`currentFiscalYear(new Date())`) — regardless of
 * lock status. This restores the actual boundary
 * `merge-club-budget-categories.ts` enforced (hardcoded to a single fiscal
 * year, prior years "DELIBERATELY NOT TOUCHED"), rather than depending on a
 * manual locking discipline nobody has practised. Both checks apply; this
 * one runs first (see the refusal order in `mergeCategories` below).
 */

import { db } from "@/lib/db";
import {
  ledgerCategories,
  ledgerEntities,
  ledgerFunds,
  ledgerTransactions,
  ledgerBudgets,
  ledgerBudgetApprovals,
  ledgerAuditLog,
  type LedgerCategory,
} from "@/lib/db/schema";
import { eq, and, isNull, inArray, count, sql, desc } from "drizzle-orm";
import { assertBudgetUnlocked } from "@/lib/ledger-queries";
import { isBudgetLocked } from "@/lib/ledger";
import { currentFiscalYear } from "@/lib/fiscal-year";

// ---------------------------------------------------------------------------
// toCategoryDTO — shared list/PATCH response shape
// ---------------------------------------------------------------------------

/**
 * Full LedgerCategory row minus entityId, per the Phase 3 API contract.
 * Lives here (not in a route.ts file) because Next.js App Router route
 * modules may only export recognized HTTP-method handlers and a small
 * config allowlist — an extra named export there fails the build's route
 * type-check.
 */
export function toCategoryDTO(category: LedgerCategory) {
  return {
    id: category.id,
    name: category.name,
    fundKind: category.fundKind,
    flow: category.flow,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    countsAsGiving: category.countsAsGiving,
    form990Line: category.form990Line,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// getCategoryById
// ---------------------------------------------------------------------------

/**
 * Looks up a single category by id, active or inactive — unlike
 * `getCategories()` (ledger-queries.ts), which always filters `isActive =
 * true`. Used for the PATCH route's existence check and by
 * `getCategoryImpact` / `mergeCategories` below.
 */
export async function getCategoryById(categoryId: string): Promise<LedgerCategory | null> {
  if (!categoryId || typeof categoryId !== "string") return null;
  const rows = await db
    .select()
    .from(ledgerCategories)
    .where(eq(ledgerCategories.id, categoryId))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// listCategoriesForAdmin — GET /api/admin/ledger/categories
// ---------------------------------------------------------------------------

/**
 * List+filter query behind `GET /api/admin/ledger/categories`. A separate
 * function from `getCategories()` (ledger-queries.ts) rather than an
 * `includeInactive` param bolted onto it — `getCategories()` has established
 * callers throughout the app that all rely on its "active only, no
 * exceptions" behavior for picker-style consumption (Phase 1 evidence:
 * `ledger-queries.ts:387-402`, the fund-kind category lookup, the budgeting
 * page's per-kind lookup). This module owns the one caller that needs
 * inactive rows too.
 */
export async function listCategoriesForAdmin(
  entityId: string,
  opts: { fundKind?: string; flow?: string; includeInactive?: boolean } = {},
): Promise<LedgerCategory[]> {
  const conditions = [eq(ledgerCategories.entityId, entityId)];
  if (!opts.includeInactive) {
    conditions.push(eq(ledgerCategories.isActive, true));
  }
  if (opts.fundKind) {
    conditions.push(eq(ledgerCategories.fundKind, opts.fundKind));
  }
  if (opts.flow) {
    conditions.push(eq(ledgerCategories.flow, opts.flow));
  }

  return db
    .select()
    .from(ledgerCategories)
    .where(and(...conditions))
    .orderBy(ledgerCategories.sortOrder, ledgerCategories.name);
}

// ---------------------------------------------------------------------------
// CategoryImpact — GET /api/admin/ledger/categories/[id]/impact
// ---------------------------------------------------------------------------

export type CategoryImpactFiscalYear = {
  fiscalYear: number;
  entityName: string;
  fundName: string;
  flow: "income" | "expense";
  annualAmountCents: number;
  locked: boolean;
};

export type CategoryImpact = {
  category: {
    id: string;
    name: string;
    entityId: string;
    fundKind: string;
    flow: "income" | "expense";
    isActive: boolean;
    countsAsGiving: boolean;
    form990Line: string | null;
  };
  transactions: {
    /** COUNT(*) of ledger_transactions rows referencing this category, ANY
     *  status — the same figure mergeCategories' refusal message uses, so
     *  the UI never shows two different numbers for "how many transactions
     *  reference this category." */
    total: number;
    /** getPhilanthropy()'s exact filter (ledger-queries.ts:4705-4712) minus
     *  the countsAsGiving condition, scoped to this category — computed
     *  regardless of the category's CURRENT countsAsGiving value so the UI
     *  can show "this is what would move" both before and after a flip.
     *  Short-circuited to 0 without a query for income-flow or
     *  administrative-fund categories, where /members/impact never counts
     *  those rows regardless (getPhilanthropy's own flow='expense' AND
     *  fund.kind IN (activity, charitable, scholarship) conditions would
     *  always exclude them anyway — this just skips the round trip). */
    postedGivingCents: number;
  };
  budgetLines: {
    /** COUNT of ledger_budgets rows referencing this category, ALL fiscal years. */
    total: number;
    fiscalYears: CategoryImpactFiscalYear[];
  };
  openBalance: {
    currentFiscalYear: number;
    /** True if a ledger_budgets row exists for (this category, currentFiscalYear)
     *  and that year is not locked. Informational only — never a block. */
    hasNonLockedBudgetRow: boolean;
    currentFyBudgetedCents: number | null;
  };
};

/**
 * One query, three callers (rename-impact preview, countsAsGiving dollar
 * impact, deactivate open-balance warning) — DECISION-066 item 1. Returns
 * null when the category doesn't exist (caller 404s).
 */
export async function getCategoryImpact(categoryId: string): Promise<CategoryImpact | null> {
  const category = await getCategoryById(categoryId);
  if (!category) return null;

  const [txnCountRow] = await db
    .select({ n: count() })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.categoryId, categoryId));
  const transactionsTotal = txnCountRow?.n ?? 0;

  // Giving-eligible per getPhilanthropy: flow='expense' AND fund.kind IN
  // (activity, charitable, scholarship). A category is scoped 1:1 to a
  // fundKind per entity, so an income-flow or administrative-fund category
  // can be short-circuited without a query — its transactions could never
  // pass getPhilanthropy's own filter regardless of transaction data.
  let postedGivingCents = 0;
  if (category.flow === "expense" && category.fundKind !== "administrative") {
    const [givingRow] = await db
      .select({ total: sql<number>`coalesce(sum(${ledgerTransactions.amountCents}), 0)::int` })
      .from(ledgerTransactions)
      .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
      .where(
        and(
          eq(ledgerTransactions.categoryId, categoryId),
          eq(ledgerTransactions.status, "posted"),
          isNull(ledgerTransactions.transferGroupId),
          eq(ledgerTransactions.flow, "expense"),
          inArray(ledgerFunds.kind, ["activity", "charitable", "scholarship"]),
        ),
      );
    postedGivingCents = givingRow?.total ?? 0;
  }

  const budgetRows = await db
    .select({
      fiscalYear: ledgerBudgets.fiscalYear,
      entityName: ledgerEntities.name,
      fundName: ledgerFunds.name,
      flow: ledgerBudgets.flow,
      annualAmountCents: ledgerBudgets.annualAmountCents,
      approvalStatus: ledgerBudgetApprovals.status,
    })
    .from(ledgerBudgets)
    .innerJoin(ledgerEntities, eq(ledgerBudgets.entityId, ledgerEntities.id))
    .innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))
    .leftJoin(
      ledgerBudgetApprovals,
      and(
        eq(ledgerBudgetApprovals.entityId, ledgerBudgets.entityId),
        eq(ledgerBudgetApprovals.fiscalYear, ledgerBudgets.fiscalYear),
      ),
    )
    .where(eq(ledgerBudgets.categoryId, categoryId))
    .orderBy(desc(ledgerBudgets.fiscalYear));

  const fiscalYears: CategoryImpactFiscalYear[] = budgetRows.map((r) => ({
    fiscalYear: r.fiscalYear,
    entityName: r.entityName,
    fundName: r.fundName,
    flow: r.flow as "income" | "expense",
    annualAmountCents: r.annualAmountCents,
    locked: isBudgetLocked(r.approvalStatus ? { status: r.approvalStatus } : null),
  }));

  const currentFY = currentFiscalYear(new Date());
  const currentFyRow = fiscalYears.find((fy) => fy.fiscalYear === currentFY) ?? null;

  return {
    category: {
      id: category.id,
      name: category.name,
      entityId: category.entityId,
      fundKind: category.fundKind,
      flow: category.flow as "income" | "expense",
      isActive: category.isActive,
      countsAsGiving: category.countsAsGiving,
      form990Line: category.form990Line,
    },
    transactions: {
      total: transactionsTotal,
      postedGivingCents,
    },
    budgetLines: {
      total: fiscalYears.length,
      fiscalYears,
    },
    openBalance: {
      currentFiscalYear: currentFY,
      hasNonLockedBudgetRow: Boolean(currentFyRow && !currentFyRow.locked),
      currentFyBudgetedCents: currentFyRow ? currentFyRow.annualAmountCents : null,
    },
  };
}

// ---------------------------------------------------------------------------
// updateCategory — PATCH /api/admin/ledger/categories/[id]
// ---------------------------------------------------------------------------

export type CategoryUpdatePatch = {
  name?: string;
  countsAsGiving?: boolean;
  form990Line?: string | null;
  isActive?: boolean;
};

export type CategoryUpdateAction =
  | "category_renamed"
  | "category_reactivated"
  | "category_deactivated"
  | "category_flags_updated";

/**
 * PATCH audit-action precedence when multiple fields change in one call
 * (DECISION-066 item 6): name always wins visibility (a rename is the most
 * reader-relevant fact); else isActive false→true wins over true→false is
 * moot (only one direction can apply per call); else flags-only. `changed`
 * holds only the fields that actually differ from the prior value — pure,
 * exported for direct unit testing without a DB.
 */
export function determineCategoryUpdateAction(changed: {
  name?: unknown;
  isActive?: unknown;
}): CategoryUpdateAction {
  if (changed.name !== undefined) return "category_renamed";
  if (changed.isActive !== undefined) {
    return changed.isActive ? "category_reactivated" : "category_deactivated";
  }
  return "category_flags_updated";
}

export type CategoryUpdateResult =
  | { ok: true; category: LedgerCategory }
  | { ok: false; error: string; status: 404 };

/**
 * General-purpose category edit — rename, countsAsGiving, form990Line, and
 * isActive all flow through this one function (architect Ruling #3:
 * deliberately not one-way action routes, so reactivation costs nothing
 * extra). Re-reads the row inside the transaction so before/after reflect
 * the freshest state at write time, computes only-the-changed-fields diffs,
 * writes the ledger_categories UPDATE and the ledgerAuditLog row atomically,
 * and skips the audit write entirely when the patch turns out to be a no-op
 * (e.g. renaming to the exact current name) — DECISION-066 item 6's
 * precedence rule only applies when something actually changed.
 *
 * Field-level validation (length caps, collision checks, boolean type
 * checks) is the caller's job (PATCH route, via validateCategoryEditInput +
 * inline checks) — this function trusts `patch`'s values are already valid
 * and only decides "did anything change" + "what does the audit trail say."
 */
export async function updateCategory(
  categoryId: string,
  patch: CategoryUpdatePatch,
  actorUserId: string | null,
): Promise<CategoryUpdateResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ledgerCategories)
      .where(eq(ledgerCategories.id, categoryId))
      .limit(1);
    if (!existing) {
      return { ok: false, error: "Category not found", status: 404 };
    }

    const setValues: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (patch.name !== undefined && patch.name !== existing.name) {
      setValues.name = patch.name;
      before.name = existing.name;
      after.name = patch.name;
    }
    if (
      patch.countsAsGiving !== undefined &&
      patch.countsAsGiving !== existing.countsAsGiving
    ) {
      setValues.countsAsGiving = patch.countsAsGiving;
      before.countsAsGiving = existing.countsAsGiving;
      after.countsAsGiving = patch.countsAsGiving;
    }
    if (
      patch.form990Line !== undefined &&
      patch.form990Line !== existing.form990Line
    ) {
      setValues.form990Line = patch.form990Line;
      before.form990Line = existing.form990Line;
      after.form990Line = patch.form990Line;
    }
    if (patch.isActive !== undefined && patch.isActive !== existing.isActive) {
      setValues.isActive = patch.isActive;
      before.isActive = existing.isActive;
      after.isActive = patch.isActive;
    }

    if (Object.keys(setValues).length === 0) {
      // Recognized field(s) present in the request, but nothing actually
      // changed (e.g. rename to the exact current name) — no write, no audit.
      return { ok: true, category: existing };
    }

    const [updated] = await tx
      .update(ledgerCategories)
      .set({ ...setValues, updatedAt: new Date() })
      .where(eq(ledgerCategories.id, categoryId))
      .returning();

    const action = determineCategoryUpdateAction({
      name: setValues.name,
      isActive: setValues.isActive,
    });

    await tx.insert(ledgerAuditLog).values({
      actorUserId: actorUserId ?? null,
      action,
      targetCategoryId: categoryId,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      details: null,
    });

    return { ok: true, category: updated };
  });
}

// ---------------------------------------------------------------------------
// mergeCategories — POST /api/admin/ledger/categories/merge
// ---------------------------------------------------------------------------

export type MergePlanEntry = {
  fiscalYear: number;
  entityName: string;
  fundName: string;
  annualAmountCents: number;
  locked: boolean;
};

export type MergeCategoriesInput = {
  sourceId: string;
  destinationId: string;
  confirm: boolean;
  actorUserId: string | null;
};

export type MergeCategoriesResult =
  | {
      ok: true;
      confirm: false;
      plan: MergePlanEntry[];
      sourceTransactionCount: number;
      destinationName: string;
    }
  | {
      ok: true;
      confirm: true;
      merged: true;
      destinationId: string;
      affectedFiscalYears: number[];
    }
  | { ok: false; error: string; status: 400 | 404 | 409 };

/**
 * Merge = re-point every fiscal year where the SOURCE has a budget row and
 * the destination does not. Never touches ledger_transactions (merge refuses
 * outright if the source has any). Source category is never deleted or
 * deactivated as a side effect — matches both precedent scripts exactly
 * (FY2025's `Awards`/`Supplies` rows were deliberately left alone).
 *
 * Refusal order is IDENTICAL for confirm:false (plan) and confirm:true
 * (apply) — architect Ruling #5: one code path computes the checks, so the
 * plan the treasurer sees and the transaction that executes can never
 * diverge. confirm:true re-runs every check fresh (no stale plan is ever
 * trusted) rather than reading back a cached plan.
 *
 * 2026-08-07 treasurer decision: if ANY fiscal year this merge would
 * re-point is locked, the WHOLE merge is refused (not just that year) — a
 * merge moves a budgeted amount, not just a label, and a locked year is
 * board-approved history. `MergePlanEntry.locked` therefore reads `false`
 * on every entry of a plan that's actually returned to the caller; a
 * `locked: true` entry only ever appears transiently while this function
 * computes the plan internally, immediately before it refuses.
 *
 * 2026-08-08 treasurer decision (DECISION-068): if ANY fiscal year this
 * merge would re-point is EARLIER than the current fiscal year, the WHOLE
 * merge is ALSO refused — regardless of lock status. This check runs
 * BEFORE the locked-year check above (both apply; this one is checked
 * first because it doesn't depend on anyone having remembered to lock a
 * closed year, which in practice nobody has). A merge that only touches
 * the current fiscal year is unaffected either way.
 */
export async function mergeCategories(
  input: MergeCategoriesInput,
): Promise<MergeCategoriesResult> {
  const { sourceId, destinationId, confirm, actorUserId } = input;

  // 1. 400 — missing / same id.
  if (!sourceId || !destinationId) {
    return { ok: false, error: "sourceId and destinationId are required.", status: 400 };
  }
  if (sourceId === destinationId) {
    return { ok: false, error: "sourceId and destinationId must be different.", status: 400 };
  }

  // 2. 404 — either category missing.
  const source = await getCategoryById(sourceId);
  if (!source) {
    return { ok: false, error: "Source category not found", status: 404 };
  }
  const destination = await getCategoryById(destinationId);
  if (!destination) {
    return { ok: false, error: "Destination category not found", status: 404 };
  }

  // 3. 400 — scope mismatch.
  if (
    source.entityId !== destination.entityId ||
    source.fundKind !== destination.fundKind ||
    source.flow !== destination.flow
  ) {
    return {
      ok: false,
      error: "Source and destination must be the same entity, fund, and flow.",
      status: 400,
    };
  }

  // 4. 409 — destination inactive.
  if (!destination.isActive) {
    return {
      ok: false,
      error: `Cannot merge into '${destination.name}' — it is deactivated. Reactivate it first.`,
      status: 409,
    };
  }

  // 5. 409 — current fiscal year locked (matches both scripts: current year only).
  const currentFY = currentFiscalYear(new Date());
  const lock = await assertBudgetUnlocked(source.entityId, currentFY);
  if (!lock.ok) {
    return { ok: false, error: lock.error, status: lock.status };
  }

  // 6. 409 — source has any transactions (Treasurer Decision 2: reason + count).
  const [txnCountRow] = await db
    .select({ n: count() })
    .from(ledgerTransactions)
    .where(eq(ledgerTransactions.categoryId, sourceId));
  const sourceTransactionCount = txnCountRow?.n ?? 0;
  if (sourceTransactionCount > 0) {
    return {
      ok: false,
      error:
        `This category has ${sourceTransactionCount} transaction` +
        `${sourceTransactionCount === 1 ? "" : "s"} — merging categories with transaction ` +
        `history isn't supported yet.`,
      status: 409,
    };
  }

  // 7. 409 — any fiscal year with a budget row on BOTH sides.
  const sourceBudgetRows = await db
    .select({
      id: ledgerBudgets.id,
      fiscalYear: ledgerBudgets.fiscalYear,
      annualAmountCents: ledgerBudgets.annualAmountCents,
      entityName: ledgerEntities.name,
      fundName: ledgerFunds.name,
      approvalStatus: ledgerBudgetApprovals.status,
    })
    .from(ledgerBudgets)
    .innerJoin(ledgerEntities, eq(ledgerBudgets.entityId, ledgerEntities.id))
    .innerJoin(ledgerFunds, eq(ledgerBudgets.fundId, ledgerFunds.id))
    .leftJoin(
      ledgerBudgetApprovals,
      and(
        eq(ledgerBudgetApprovals.entityId, ledgerBudgets.entityId),
        eq(ledgerBudgetApprovals.fiscalYear, ledgerBudgets.fiscalYear),
      ),
    )
    .where(eq(ledgerBudgets.categoryId, sourceId));

  const destBudgetYearRows = await db
    .select({ fiscalYear: ledgerBudgets.fiscalYear })
    .from(ledgerBudgets)
    .where(eq(ledgerBudgets.categoryId, destinationId));
  const destYears = new Set(destBudgetYearRows.map((r) => r.fiscalYear));

  const conflicting = sourceBudgetRows.filter((r) => destYears.has(r.fiscalYear));
  if (conflicting.length > 0) {
    const years = conflicting
      .map((r) => `FY${r.fiscalYear}`)
      .sort()
      .join(", ");
    return {
      ok: false,
      error: `Both '${source.name}' and '${destination.name}' have ${years} budget rows — resolve by hand.`,
      status: 409,
    };
  }

  const plan: MergePlanEntry[] = sourceBudgetRows.map((r) => ({
    fiscalYear: r.fiscalYear,
    entityName: r.entityName,
    fundName: r.fundName,
    annualAmountCents: r.annualAmountCents,
    locked: isBudgetLocked(r.approvalStatus ? { status: r.approvalStatus } : null),
  }));

  // 8. 409 — ANY affected fiscal year is EARLIER than the current fiscal
  // year (2026-08-08 treasurer decision, DECISION-068 — see the doc
  // comment above this function). Checked BEFORE the locked-year check
  // below and regardless of lock status: as of this decision, no fiscal
  // year has ever actually been locked in this database, so the locked-
  // year check alone was a vacuous guard against re-pointing an approved,
  // never-locked prior year's budget row (exactly the `Awards`/`Supplies`
  // FY2025 scenario). `currentFY` is derived from the shared
  // `currentFiscalYear()` helper (src/lib/fiscal-year.ts), never hardcoded.
  const priorYears = plan.filter((p) => p.fiscalYear < currentFY);
  if (priorYears.length > 0) {
    const years = priorYears
      .map((p) => `FY${p.fiscalYear}`)
      .sort()
      .join(", ");
    const label = priorYears.length === 1 ? "is a prior fiscal year" : "are prior fiscal years";
    return {
      ok: false,
      error:
        `Cannot merge '${source.name}' into '${destination.name}' — ${years} ${label}, ` +
        `already closed (before FY${currentFY}). Merging moves a budgeted amount, and a ` +
        `closed year's approved budget can't be restated this way, whether or not it was ` +
        `ever formally locked. '${source.name}' has nothing left to merge for the current ` +
        `fiscal year — its prior-year budget row stays exactly as the board approved it.`,
      status: 409,
    };
  }

  // 9. 409 — ANY affected fiscal year is locked (2026-08-07 treasurer
  // decision, whole-merge refusal — see the doc comment above this
  // function). A rename only relabels; a merge moves a budgeted amount
  // between categories in a year the board approved and locked, which is a
  // different kind of change and is not allowed here. In practice this now
  // only ever fires for the current fiscal year or a future one — any
  // prior-year lock was already caught by step 8 above.
  const lockedYears = plan.filter((p) => p.locked);
  if (lockedYears.length > 0) {
    const years = lockedYears
      .map((p) => `FY${p.fiscalYear}`)
      .sort()
      .join(", ");
    const isAre = lockedYears.length === 1 ? "is" : "are";
    return {
      ok: false,
      error:
        `Cannot merge '${source.name}' into '${destination.name}' — ${years} ${isAre} ` +
        `locked. Merging moves a budgeted amount between categories, not just a label, ` +
        `and a locked, board-approved fiscal year's budget can't be changed this way. ` +
        `Unlock ${years} first if this merge is still needed.`,
      status: 409,
    };
  }

  if (!confirm) {
    return {
      ok: true,
      confirm: false,
      plan,
      sourceTransactionCount,
      destinationName: destination.name,
    };
  }

  const affectedFiscalYears = plan.map((p) => p.fiscalYear);

  await db.transaction(async (tx) => {
    for (const row of sourceBudgetRows) {
      await tx
        .update(ledgerBudgets)
        .set({ categoryId: destinationId, updatedAt: new Date() })
        .where(eq(ledgerBudgets.id, row.id));
    }

    const details =
      `Merged into '${destination.name}' (${destinationId}). Affected fiscal years: ` +
      `${affectedFiscalYears.length ? affectedFiscalYears.map((y) => `FY${y}`).join(", ") : "none"}.`;

    await tx.insert(ledgerAuditLog).values({
      actorUserId: actorUserId ?? null,
      action: "category_merged",
      targetCategoryId: sourceId,
      before: null,
      after: null,
      details,
    });
  });

  return { ok: true, confirm: true, merged: true, destinationId, affectedFiscalYears };
}

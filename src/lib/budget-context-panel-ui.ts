/**
 * Pure UI-only helpers for the read-only budget-context panel
 * (2026-08-08-budget-context-on-transaction-entry, Phase 4b UI half).
 *
 * No `@/lib/db` import, no async — kept separate from
 * `src/lib/ledger-budget-context-queries.ts` (the query layer, owned by
 * api-developer and already complete) exactly the way
 * `financial-report-ui.ts` is kept separate from `financial-report-queries.ts`
 * for the same feature family. This file exists so the FY-derivation, the
 * FY-race guard, and the current/projected arithmetic + copy framing can be
 * unit-tested without RTL/jsdom (this repo's `vitest.config.ts` runs
 * `environment: "node"` — see Phase 3/4 handoff notes).
 *
 * Reuses `budgetVariance()` from `lib/ledger.ts` for every arithmetic
 * computation here — the same function `getFundReport()` uses — per
 * DECISION-069 ruling 3. Nothing in this file re-derives budget-vs-actual
 * subtraction locally.
 */

import { getFiscalYear } from "@/lib/fiscal-year";
import { budgetVariance, type BudgetVarianceResult } from "@/lib/ledger";

export type BudgetContextFlow = "income" | "expense";

/**
 * Parses a 'YYYY-MM-DD' txnDate into its fiscal year, or null if the date is
 * empty/unparseable. Mirrors the identical inline parse already duplicated
 * twice in this codebase — `BudgetLinePicker` (budget-line-picker.tsx:42-48)
 * and `TransactionForm`'s own budgetLineId auto-clear effect
 * (transaction-form.tsx:282-284). Per the Phase 3 design doc, this is
 * deliberately a THIRD inline copy, not a new shared helper: "it's already
 * duplicated twice in this codebase without complaint, and a third inline
 * copy is more honest than introducing a one-line-saving abstraction three
 * call sites deep."
 */
export function deriveFiscalYearFromTxnDate(txnDate: string): number | null {
  if (!txnDate) return null;
  const parsed = new Date(txnDate + "T00:00:00");
  if (isNaN(parsed.getTime())) return null;
  return getFiscalYear(parsed);
}

/**
 * The FY-boundary race guard (Phase 1's single highest-consequence risk,
 * Flow 3). A resolved `/api/admin/ledger/budget-context` response is only
 * ever safe to commit to displayed state if the fiscal year it was fetched
 * for still matches the CURRENT derived fiscal year — checked at resolution
 * time, not at request time. The caller must pass the current value read
 * from a ref (not a closure-captured variable), since a closure captured at
 * request time would always trivially match itself.
 */
export function isResponseCurrent(
  responseFiscalYear: number,
  currentDerivedFiscalYear: number | null,
): boolean {
  return currentDerivedFiscalYear !== null && responseFiscalYear === currentDerivedFiscalYear;
}

export interface BudgetFigures {
  /** budgetVariance(postedCents + pendingCents, budgetCents). */
  current: BudgetVarianceResult;
  /**
   * budgetVariance(postedCents + pendingCents + amountCents, budgetCents).
   * null when amountCents is null (empty/zero/invalid amount field) — the
   * projected clause must be suppressed entirely, never silently treated as
   * "+$0" (Phase 3, Projected Figure section).
   */
  projected: BudgetVarianceResult | null;
}

/**
 * Pure. Computes the current and projected budget-variance figures for one
 * grain (a category row or a budget-line row) via `budgetVariance()` —
 * called twice with the same helper, never a locally reimplemented
 * subtraction (DECISION-069 ruling 3). `budgetCents === null` still produces
 * a well-defined (all-null) result; callers render the "no budget set" copy
 * via `formatGrainCopy` rather than branching on this directly.
 */
export function computeBudgetFigures(
  budgetCents: number | null,
  postedCents: number,
  pendingCents: number,
  amountCents: number | null,
): BudgetFigures {
  const actualCents = postedCents + pendingCents;
  const current = budgetVariance(actualCents, budgetCents);
  const projected =
    amountCents === null || amountCents <= 0
      ? null
      : budgetVariance(actualCents + amountCents, budgetCents);
  return { current, projected };
}

/**
 * True iff the most-advanced known figure (the projected figure when one
 * exists, else the current figure) is over budget. Never true for income —
 * exceeding an income budget is good news, not a risk signal (Panel State 7,
 * Treasurer Decision 4) — and never true when no budget is set (there is no
 * variance to be negative).
 */
export function isOverBudgetWarn(flow: BudgetContextFlow, figures: BudgetFigures): boolean {
  if (flow === "income") return false;
  const effective = figures.projected ?? figures.current;
  return effective.varianceCents !== null && effective.varianceCents < 0;
}

/** `$X.XX` / `-$X.XX` — matches the existing ledger-admin convention in
 *  `budget-plan-status.tsx`'s `formatDollars` (no comma grouping; this is
 *  compact inline form context, not a report table). Kept as a local copy
 *  rather than an import — this is a `lib/` module and must not import from
 *  `components/`. */
function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export interface GrainCopy {
  /** e.g. "$570.00 of $700.00 used ($420.00 posted + $150.00 pending)." or
   *  "No budget set for FY2026 — $340.00 recorded so far." */
  primary: string;
  /** e.g. "→ $700.00 after this one." — null when there is no valid
   *  in-progress amount, or no budget is set to project against. */
  projectedClause: string | null;
  /** True only for an expense grain whose most-advanced figure is over
   *  budget — render this figure's text in `text-amber-700`, never the whole
   *  block, and never `text-red-*` (undefined brand color). */
  warn: boolean;
}

/**
 * Pure. Builds the display copy for one grain (category or budget line) —
 * the single component that renders BOTH the expense ("used"/"budgeted")
 * and income ("received"/"expected") framings from the `flow` parameter, per
 * Phase 1's explicit requirement that this not be two copy-pasted
 * implementations that can drift apart. Handles Panel States 4, 5, 6 (one
 * grain at a time — the line-selected state calls this twice, once per
 * grain), and 7.
 */
export function formatGrainCopy(
  flow: BudgetContextFlow,
  fiscalYear: number,
  budgetCents: number | null,
  postedCents: number,
  pendingCents: number,
  amountCents: number | null,
): GrainCopy {
  const recordedCents = postedCents + pendingCents;

  // Panel State 4: no budget row (or an annotation-only $0 row) for this
  // category/FY. Never "$0 of $0" — that reads as "you are at your limit."
  if (budgetCents === null) {
    const primary =
      recordedCents > 0
        ? `No budget set for FY${fiscalYear} — ${formatDollars(recordedCents)} recorded so far.`
        : `No budget set for FY${fiscalYear}.`;
    return { primary, projectedClause: null, warn: false };
  }

  const figures = computeBudgetFigures(budgetCents, postedCents, pendingCents, amountCents);
  const usedVerb = flow === "income" ? "received" : "used";
  const afterClause = flow === "income" ? "after this gift" : "after this one";

  // Only surface the posted/pending split when there IS a pending figure to
  // distinguish — Treasurer Decision 1 requires labeling what's counted, but
  // "($420.00 posted + $0.00 pending)" is noise in the common all-posted case.
  const breakdown =
    pendingCents > 0
      ? ` (${formatDollars(postedCents)} posted + ${formatDollars(pendingCents)} pending)`
      : "";

  const primary = `${formatDollars(recordedCents)} of ${formatDollars(budgetCents)} ${usedVerb}${breakdown}.`;

  const projectedClause =
    figures.projected !== null
      ? `→ ${formatDollars(recordedCents + (amountCents as number))} ${afterClause}.`
      : null;

  return { primary, projectedClause, warn: isOverBudgetWarn(flow, figures) };
}

/** "[Cause]" or "[Cause] — [Label]" — matches BudgetLinePicker's own option
 *  label convention (budget-line-picker.tsx:87-88) so a selected line reads
 *  identically in the picker and in the context panel below it. */
export function formatCauseLineLabel(cause: string, label: string): string {
  return label ? `${cause} — ${label}` : cause;
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BudgetContext } from "@/lib/ledger-budget-context-queries";
import {
  deriveFiscalYearFromTxnDate,
  isResponseCurrent,
  formatGrainCopy,
  formatCauseLineLabel,
  type BudgetContextFlow,
} from "@/lib/budget-context-panel-ui";

interface BudgetContextPanelProps {
  fundId: string;
  /** 'YYYY-MM-DD'. */
  txnDate: string;
  /** resolveApiFlow(flowMode) — the caller never renders this component for
   *  transfer/sweep (gated at the same `!isTransferOrSweep &&
   *  !isEditingTransfer` condition as the Category select itself). */
  flow: BudgetContextFlow;
  /** "" = no category chosen yet — Panel State 1 (render nothing). */
  categoryId: string;
  /** "" = no budget line selected — Panel State 5/7 (category grain only). */
  budgetLineId: string;
  /** parseDollars(amount) result from transaction-form.tsx — null while
   *  empty/zero/invalid. */
  amountCents: number | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; fiscalYear: number }
  | { status: "ready"; payload: BudgetContext };

/**
 * Read-only budget-context panel rendered right after the Category select in
 * `TransactionForm` (2026-08-08-budget-context-on-transaction-entry, Phase 3
 * design doc). Shows a treasurer, mid-entry, how much of the selected
 * category's (or budget line's) fiscal-year budget is already used — posted
 * and pending counted and labeled separately — and what that figure becomes
 * if the transaction being typed right now is saved.
 *
 * Fetches `/api/admin/ledger/budget-context` once per `(fundId,
 * derivedFiscalYear)` pair (DECISION-069 ruling 1) — never per keystroke,
 * never per category/line selection. All category/line lookups and the
 * current/projected arithmetic happen client-side against the fetched
 * payload with zero further network round-trips.
 *
 * FY-boundary race (Phase 1's single highest-consequence risk, Flow 3): the
 * render condition below is a pure function of (loadState, derivedFiscalYear)
 * computed fresh on every render — never a lagging boolean "isLoading" flag —
 * and a resolved fetch is only committed to state if the fiscal year it was
 * requested for still matches `currentFiscalYearRef.current` (the LATEST
 * derived FY, read via a ref so a stale in-flight closure can't compare
 * itself against its own stale value) at resolution time.
 */
export default function BudgetContextPanel({
  fundId,
  txnDate,
  flow,
  categoryId,
  budgetLineId,
  amountCents,
}: BudgetContextPanelProps) {
  const derivedFiscalYear = deriveFiscalYearFromTxnDate(txnDate);

  // Always reflects the LATEST derived FY, updated synchronously every
  // render — read from inside a fetch's .then()/.catch() so a resolving
  // stale request can be told "no, that's not current anymore" even though
  // its own closure captured the FY it was requested for.
  const currentFiscalYearRef = useRef(derivedFiscalYear);
  currentFiscalYearRef.current = derivedFiscalYear;

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!fundId || derivedFiscalYear === null) {
      setLoadState({ status: "loading" });
      return;
    }

    let cancelled = false;
    const requestedFiscalYear = derivedFiscalYear;
    const controller = new AbortController();

    setLoadState({ status: "loading" });

    fetch(
      `/api/admin/ledger/budget-context?fundId=${encodeURIComponent(fundId)}&fiscalYear=${requestedFiscalYear}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<BudgetContext>;
      })
      .then((data) => {
        if (cancelled) return;
        // Stale-response guard (Flow 3) — discard a response that resolved
        // after the treasurer already moved on to a different fiscal year.
        if (!isResponseCurrent(data.fiscalYear, currentFiscalYearRef.current)) return;
        setLoadState({ status: "ready", payload: data });
      })
      .catch((err) => {
        if (cancelled || (err && err.name === "AbortError")) return;
        if (requestedFiscalYear !== currentFiscalYearRef.current) return;
        setLoadState({ status: "error", fiscalYear: requestedFiscalYear });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundId, derivedFiscalYear, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  // Panel State 1 — no category chosen: render nothing at all, no empty box.
  if (!categoryId) return null;

  // Render-time gate, independent of "is a fetch in flight": a payload (or
  // error) is only considered current if it was resolved for the FY we're
  // looking at right now. Never continues showing a previous FY's numbers
  // under a new-FY date.
  const effective: "loading" | "error" | "ready" =
    loadState.status === "ready" && loadState.payload.fiscalYear === derivedFiscalYear
      ? "ready"
      : loadState.status === "error" && loadState.fiscalYear === derivedFiscalYear
        ? "error"
        : "loading";

  // Panel State 2 — loading (including the very first mount).
  if (effective === "loading") {
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-500">
        Loading budget context&hellip;
      </div>
    );
  }

  // Panel State 3 — fetch failed. Visually distinct (amber block, not gray)
  // so this can never be mistaken for "no budget set."
  if (effective === "error") {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex items-center justify-between gap-3">
        <span>Couldn&rsquo;t load budget context.</span>
        <button
          type="button"
          onClick={retry}
          className="text-xs font-semibold underline hover:no-underline transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
        >
          Try again
        </button>
      </div>
    );
  }

  // effective === "ready"
  const payload = (loadState as Extract<LoadState, { status: "ready" }>).payload;
  const category = payload.categories.find((c) => c.categoryId === categoryId);
  // Defensive — shouldn't happen given the category select and this fetch
  // both derive from the same active-category set, but fail closed (render
  // nothing) rather than risk showing a wrong number for an unknown category.
  if (!category) return null;

  const line = budgetLineId ? payload.lines.find((l) => l.budgetLineId === budgetLineId) : undefined;

  // Panel State 6 — a specific budget line is selected: show its own figure
  // first, the parent category's full rollup underneath, visually subordinate.
  if (line) {
    const lineCopy = formatGrainCopy(
      flow,
      payload.fiscalYear,
      line.budgetCents,
      line.postedCents,
      line.pendingCents,
      amountCents,
    );
    const categoryCopy = formatGrainCopy(
      flow,
      payload.fiscalYear,
      category.budgetCents,
      category.postedCents,
      category.pendingCents,
      amountCents,
    );
    return (
      <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm space-y-1">
        <p className={lineCopy.warn ? "text-amber-700 font-medium" : "text-gray-700"}>
          <span className="font-semibold">{formatCauseLineLabel(line.cause, line.label)}:</span>{" "}
          {lineCopy.primary}
          {lineCopy.projectedClause ? ` ${lineCopy.projectedClause}` : ""}
        </p>
        <p className={categoryCopy.warn ? "text-amber-700 text-xs" : "text-gray-500 text-xs"}>
          <span className="font-medium">{category.categoryName} overall:</span>{" "}
          {categoryCopy.primary}
          {categoryCopy.projectedClause ? ` ${categoryCopy.projectedClause}` : ""}
        </p>
      </div>
    );
  }

  // Panel States 4/5/7 — category grain only (lump-sum category, or no cause
  // line selected yet). Income vs. expense framing handled inside
  // formatGrainCopy from the same `flow` prop — one component, both framings.
  const copy = formatGrainCopy(
    flow,
    payload.fiscalYear,
    category.budgetCents,
    category.postedCents,
    category.pendingCents,
    amountCents,
  );
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm">
      <p className={copy.warn ? "text-amber-700 font-medium" : "text-gray-700"}>
        {copy.primary}
        {copy.projectedClause ? ` ${copy.projectedClause}` : ""}
      </p>
    </div>
  );
}

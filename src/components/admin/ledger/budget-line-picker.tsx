"use client";

import { getFiscalYear } from "@/lib/fiscal-year";
import type { BudgetLineOption } from "@/lib/ledger-queries";

interface BudgetLinePickerProps {
  id?: string;
  budgetLines: BudgetLineOption[];
  /** The transaction's/payment's fund — the picker's candidate list is
   *  always scoped to this fund + the fiscal year derived from `txnDate`
   *  (never a manual FY input — B-30, Phase 3 design). */
  fundId: string;
  /** 'YYYY-MM-DD' — used only to derive the effective fiscal year. */
  txnDate: string;
  /** Selected ledger_budget_lines.id, or "" for "No linked budget line." */
  value: string;
  /** Called with the picked line (or null when cleared back to "no link"). */
  onSelect: (line: BudgetLineOption | null) => void;
  disabled?: boolean;
}

/**
 * Shared budget-line picker (B-30, DECISION-061) — used by both
 * transaction-form.tsx and pay-reimbursement-dialog.tsx. A single, optional
 * `<select>` grouped Category -> Cause -> Label, filtered to the fund +
 * fiscal-year derived from `txnDate`. Never forced — most transactions have
 * zero candidate lines and the picker reads "No budget lines available."
 *
 * A pending-delete line is excluded as a NEW option but still rendered when
 * it's the CURRENTLY selected value (Phase 1 Resolve #1's "still counts"
 * reading — mirrors isCauseLineLive's semantics elsewhere).
 */
export default function BudgetLinePicker({
  id = "budget-line-picker",
  budgetLines,
  fundId,
  txnDate,
  value,
  onSelect,
  disabled,
}: BudgetLinePickerProps) {
  let effectiveFiscalYear: number | null = null;
  if (txnDate) {
    const parsed = new Date(txnDate + "T00:00:00");
    if (!isNaN(parsed.getTime())) {
      effectiveFiscalYear = getFiscalYear(parsed);
    }
  }

  const candidates = budgetLines.filter(
    (l) =>
      l.fundId === fundId &&
      l.fiscalYear === effectiveFiscalYear &&
      (l.pendingDeleteAt === null || l.id === value),
  );

  const groups = new Map<string, BudgetLineOption[]>();
  for (const line of candidates) {
    const existing = groups.get(line.categoryName);
    if (existing) {
      existing.push(line);
    } else {
      groups.set(line.categoryName, [line]);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        Applies to budget line <span className="text-gray-400 font-normal text-xs">(optional)</span>
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const picked = candidates.find((l) => l.id === e.target.value) ?? null;
          onSelect(picked);
        }}
        className="block w-full rounded-lg border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
      >
        <option value="">No linked budget line</option>
        {[...groups.entries()].map(([categoryName, lines]) => (
          <optgroup key={categoryName} label={categoryName}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.cause}
                {l.label ? ` — ${l.label}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {candidates.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">
          No budget lines available for this fund/year.
        </p>
      )}
    </div>
  );
}

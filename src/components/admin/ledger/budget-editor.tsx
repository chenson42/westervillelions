"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface BudgetLine {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  budgetCents: number | null;
}

interface BudgetEditorProps {
  fundId: string;
  fiscalYear: number;
  lines: BudgetLine[];
  /**
   * Optional callback fired on every keystroke (before blur/save), keyed the
   * same way as internal state: `${categoryId}_${flow}`, value is the raw
   * dollar-string input. Added for guided budgeting's live balance readout
   * (src/components/admin/ledger/guided-budget-setup.tsx), which needs to
   * recompute income/expense totals as the treasurer types, not just after
   * each PATCH round-trip completes. Optional and backward-compatible —
   * existing callers (e.g. [fundSlug]/report/page.tsx) that don't pass it are
   * unaffected.
   */
  onInputChange?: (key: string, value: string) => void;
}

/**
 * Inline budget editor rendered within the fund report.
 * Only shown to users with LEDGER_MANAGE (gated in the parent Server Component).
 *
 * Each category row has a dollar input that submits on blur or Enter (spreadsheet UX).
 * Setting a value to empty or "0" removes the budget line (API: annualAmountCents: null).
 */
export default function BudgetEditor({ fundId, fiscalYear, lines, onInputChange }: BudgetEditorProps) {
  const router = useRouter();
  // Track per-line editing state: input value (dollars), saving flag
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const line of lines) {
      const key = `${line.categoryId}_${line.flow}`;
      init[key] = line.budgetCents !== null ? (line.budgetCents / 100).toFixed(2) : "";
    }
    return init;
  });
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const dirtyRef = useRef<Record<string, boolean>>({});

  function handleChange(key: string, value: string) {
    setInputs((prev) => ({ ...prev, [key]: value }));
    dirtyRef.current[key] = true;
    onInputChange?.(key, value);
  }

  async function handleCommit(categoryId: string, flow: "income" | "expense") {
    const key = `${categoryId}_${flow}`;
    if (!dirtyRef.current[key]) return;
    dirtyRef.current[key] = false;

    const raw = inputs[key]?.trim() ?? "";
    // FU-1: empty string → remove the budget line (annualAmountCents = null).
    // Explicit "0" or "0.00" → $0 budget (annualAmountCents = 0), which is valid.
    let annualAmountCents: number | null;
    if (raw === "") {
      annualAmountCents = null;
    } else {
      const n = parseFloat(raw);
      if (isNaN(n) || n < 0) {
        toast.error("Enter a valid amount (0 or greater) or leave blank to remove the budget.");
        return;
      }
      annualAmountCents = Math.round(n * 100);
      if (annualAmountCents > 2_147_483_647) {
        toast.error("Budget amount exceeds maximum.");
        return;
      }
    }

    setSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/ledger/budgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, annualAmountCents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update budget.");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save budget. Try again.");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  function handleKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    categoryId: string,
    flow: "income" | "expense"
  ) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      handleCommit(categoryId, flow);
    }
  }

  return (
    <div className="space-y-1">
      {lines.map((line) => {
        const key = `${line.categoryId}_${line.flow}`;
        const isSaving = saving[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-20 uppercase tracking-wide">
              {line.flow}
            </span>
            <span className="text-sm text-gray-700 flex-1 truncate">{line.categoryName}</span>
            <div className="relative w-28">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={inputs[key] ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                onBlur={() => handleCommit(line.categoryId, line.flow)}
                onKeyDown={(e) => handleKeyDown(e, line.categoryId, line.flow)}
                disabled={isSaving}
                className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                placeholder="—"
                aria-label={`Budget for ${line.categoryName} (${line.flow})`}
              />
              {isSaving && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  ...
                </span>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-gray-400 mt-2">
        Enter amounts in dollars. Press Enter or click away to save. Enter 0 for a $0 budget. Leave blank to remove.
      </p>
    </div>
  );
}

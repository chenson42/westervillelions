"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  /**
   * When true, every input renders disabled and no commit is attempted —
   * used when the (entity, fiscalYear) budget is locked, or the viewer only
   * holds LEDGER_APPROVE (view-only). This is UI-only defense-in-depth: the
   * real enforcement is the server's assertBudgetUnlocked() 409, which a
   * stale tab can still trigger — handleCommit's existing error handling
   * already surfaces that message via toast unchanged.
   */
  disabled?: boolean;
  /**
   * Shows an explicit trash-icon "remove this line" control per row. Callers
   * should pass true only when the viewer holds LEDGER_MANAGE and the budget
   * is unlocked — this is a separate flag from `disabled` so the parent can
   * reason about them independently (e.g. an approve-only viewer never gets
   * showRemoveControl regardless of lock state).
   */
  showRemoveControl?: boolean;
}

/**
 * Inline budget editor rendered within the fund report.
 * Only shown to users with LEDGER_MANAGE (gated in the parent Server Component).
 *
 * Each category row has a dollar input that submits on blur or Enter (spreadsheet UX).
 * Setting a value to empty or "0" removes the budget line (API: annualAmountCents: null).
 */
export default function BudgetEditor({
  fundId,
  fiscalYear,
  lines,
  onInputChange,
  disabled = false,
  showRemoveControl = false,
}: BudgetEditorProps) {
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
  const [removeConfirm, setRemoveConfirm] = useState<{
    categoryId: string;
    flow: "income" | "expense";
    categoryName: string;
    amountLabel: string;
  } | null>(null);

  function handleChange(key: string, value: string) {
    if (disabled) return;
    setInputs((prev) => ({ ...prev, [key]: value }));
    dirtyRef.current[key] = true;
    onInputChange?.(key, value);
  }

  /**
   * Core commit — takes the raw dollar string explicitly rather than reading
   * `inputs` state, so the explicit "Remove" control (which needs to commit
   * an empty value the instant it's clicked, before React re-renders) can't
   * race a stale closure the way calling handleCommit() directly would.
   */
  async function commitValue(categoryId: string, flow: "income" | "expense", rawValue: string) {
    if (disabled) return;
    const key = `${categoryId}_${flow}`;
    const raw = rawValue.trim();
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
        // Surfaces the server's exact message, including the 409 lock string
        // ("This budget is locked. Unlock it to make changes.") if a stale
        // tab races a lock — no special-casing needed here.
        throw new Error(data.error || "Failed to update budget.");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save budget. Try again.");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function handleCommit(categoryId: string, flow: "income" | "expense") {
    const key = `${categoryId}_${flow}`;
    if (!dirtyRef.current[key]) return;
    dirtyRef.current[key] = false;
    await commitValue(categoryId, flow, inputs[key] ?? "");
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

  function requestRemove(categoryId: string, flow: "income" | "expense", categoryName: string) {
    if (disabled) return;
    const key = `${categoryId}_${flow}`;
    const raw = inputs[key]?.trim() ?? "";
    const n = raw === "" ? NaN : parseFloat(raw);
    const amountCents = !isNaN(n) ? Math.round(n * 100) : 0;
    if (raw === "" || amountCents === 0) {
      // Nothing meaningful to discard — remove immediately, no confirm.
      void doRemove(categoryId, flow);
      return;
    }
    setRemoveConfirm({
      categoryId,
      flow,
      categoryName,
      amountLabel: `$${(amountCents / 100).toFixed(2)}`,
    });
  }

  async function doRemove(categoryId: string, flow: "income" | "expense") {
    const key = `${categoryId}_${flow}`;
    setInputs((prev) => ({ ...prev, [key]: "" }));
    onInputChange?.(key, "");
    await commitValue(categoryId, flow, "");
  }

  function handleConfirmRemove() {
    if (!removeConfirm) return;
    const { categoryId, flow } = removeConfirm;
    setRemoveConfirm(null);
    void doRemove(categoryId, flow);
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
                disabled={isSaving || disabled}
                className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm tabular-nums focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                placeholder="—"
                aria-label={`Budget for ${line.categoryName} (${line.flow})`}
              />
              {isSaving && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  ...
                </span>
              )}
            </div>
            {showRemoveControl && !disabled && (
              <button
                type="button"
                onClick={() => requestRemove(line.categoryId, line.flow, line.categoryName)}
                title={`Remove ${line.categoryName} from this year's budget`}
                aria-label={`Remove ${line.categoryName} (${line.flow}) from this year's budget`}
                className="inline-flex items-center justify-center rounded-lg p-2 text-gray-400 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px] min-w-[44px] flex-shrink-0"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-400 mt-2">
        {disabled
          ? "This budget is locked for editing."
          : "Enter amounts in dollars. Press Enter or click away to save. Enter 0 for a $0 budget. Leave blank to remove."}
      </p>

      <ConfirmDialog
        open={removeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveConfirm(null);
        }}
        title="Remove this budget line?"
        description={
          removeConfirm
            ? `This removes the ${removeConfirm.amountLabel} target for "${removeConfirm.categoryName}" (${removeConfirm.flow}). The category and any recorded activity are not affected.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={handleConfirmRemove}
      />
    </div>
  );
}

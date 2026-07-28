"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BUDGET_CAUSES,
  OTHER_COMMUNITY_SUPPORT_CAUSE,
  sumBudgetCauseLines,
} from "@/lib/ledger";

const ALL_CAUSES: readonly string[] = [...BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE];

interface BudgetCauseLine {
  cause: string;
  amountCents: number;
}

interface Row {
  cause: string;
  /** null = this row has never been saved to the server under this cause — a fresh/pending row. */
  committedCause: string | null;
  /** Dollar-string value of the amount input, e.g. "125.00". */
  value: string;
  saving: boolean;
}

export type ExitBreakdownReason = "cancelled" | "collapsed" | "emptied";

interface BudgetCauseEditorProps {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  /**
   * Seed rows for local state. Either the server-confirmed breakdown
   * (`pending: false`) or a single client-side pre-fill row (`pending: true`,
   * cause = OTHER_COMMUNITY_SUPPORT_CAUSE, amount = the category's prior
   * lump-sum value) — see budget-editor.tsx's "Break down by cause" handler.
   * Never empty.
   */
  initialLines: BudgetCauseLine[];
  /** True when initialLines is a local pre-fill that hasn't been saved yet. */
  pending: boolean;
  /** Locked-budget defense-in-depth — mirrors BudgetEditor's own `disabled` prop. */
  disabled?: boolean;
  /**
   * Live dollar-string total, fired on every amount keystroke (not just on
   * commit) — the parent forwards this into its own onInputChange, which is
   * what keeps GuidedBudgetSetup's fundSums/balance readout live while the
   * treasurer types, matching BudgetEditor's own per-keystroke behavior.
   */
  onTotalChange?: (totalDollarString: string) => void;
  /**
   * Fired when this category should stop rendering as a breakdown and
   * revert to a plain lump-sum input — either the treasurer cancelled an
   * unsaved pre-fill, explicitly collapsed a real breakdown back to a lump
   * sum, or removed the last remaining cause line one at a time.
   */
  onExitBreakdown: (reason: ExitBreakdownReason) => void;
}

function parseDollarsToCents(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return 0;
  const n = parseFloat(trimmed);
  return !isNaN(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function nextUnusedCause(usedCauses: Set<string>): string {
  return ALL_CAUSES.find((c) => !usedCauses.has(c)) ?? ALL_CAUSES[0];
}

function currentTotalCents(rows: Row[]): number {
  return sumBudgetCauseLines(rows.map((r) => ({ amountCents: parseDollarsToCents(r.value) })));
}

/**
 * Cause-level budget breakdown for one category (B-17 Increment A). Nested
 * inside BudgetEditor when a giving-eligible expense category
 * (isCauseEligibleCategory) is in breakdown mode. Mirrors BudgetEditor's own
 * commit-on-blur/Enter, explicit-remove, and ConfirmDialog conventions
 * exactly — this is the third nested layer in an already-dense editor, so it
 * must not look or behave like a bolted-on component.
 *
 * Rename semantics: changing an already-committed row's cause via the
 * dropdown issues a DELETE (old cause) then a PATCH (new cause, current
 * amount) — there is no dedicated rename endpoint (DECISION-046 favors the
 * smallest endpoint surface: upsert, delete, collapse only). A pending
 * (never-saved) row's cause just updates local state; nothing is written
 * until its first amount commit.
 */
export default function BudgetCauseEditor({
  fundId,
  fiscalYear,
  categoryId,
  flow,
  initialLines,
  pending,
  disabled = false,
  onTotalChange,
  onExitBreakdown,
}: BudgetCauseEditorProps) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.map((l) => ({
      cause: l.cause,
      committedCause: pending ? null : l.cause,
      value: (l.amountCents / 100).toFixed(2),
      saving: false,
    })),
  );
  const dirtyRef = useRef<boolean[]>(rows.map(() => false));
  const [removeConfirm, setRemoveConfirm] = useState<{
    index: number;
    cause: string;
    amountLabel: string;
  } | null>(null);
  const [collapseConfirmOpen, setCollapseConfirmOpen] = useState(false);

  const usedCauses = new Set(rows.map((r) => r.cause));
  const hasCommittedRows = rows.some((r) => r.committedCause !== null);
  const totalCents = currentTotalCents(rows);

  function handleAmountChange(index: number, value: string) {
    if (disabled) return;
    const next = rows.map((r, i) => (i === index ? { ...r, value } : r));
    setRows(next);
    dirtyRef.current[index] = true;
    onTotalChange?.((currentTotalCents(next) / 100).toFixed(2));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      void commitAmount(index);
    }
  }

  async function commitAmount(index: number) {
    const row = rows[index];
    if (!row) return;
    // Already-committed rows only re-save when actually edited (spreadsheet
    // UX, matches BudgetEditor's dirtyRef gate). A never-saved pending row
    // always attempts its first commit on blur/Enter — that IS how it gets
    // created; if the treasurer never blurs/Enters the field (e.g. navigates
    // away entirely), nothing is written, per the Phase 3 design invariant.
    if (row.committedCause !== null && !dirtyRef.current[index]) return;
    dirtyRef.current[index] = false;

    const raw = row.value.trim();
    if (raw === "") {
      toast.error(`Enter an amount for "${row.cause}", or remove this line.`);
      return;
    }
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) {
      toast.error("Enter a valid amount (0 or greater).");
      return;
    }
    const amountCents = Math.round(n * 100);
    if (amountCents > 2_147_483_647) {
      toast.error("Amount exceeds maximum.");
      return;
    }

    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: true } : r)));
    try {
      const res = await fetch("/api/admin/ledger/budgets/cause-lines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause: row.cause, amountCents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Surfaces the server's exact message, including the 409 lock
        // string, unchanged.
        throw new Error(data.error || "Failed to save cause line.");
      }
      const data: { categoryTotalCents: number } = await res.json();
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, committedCause: row.cause, saving: false } : r)),
      );
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save cause line. Try again.");
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: false } : r)));
    }
  }

  async function handleCauseChange(index: number, newCause: string) {
    if (disabled) return;
    const row = rows[index];
    if (!row || row.cause === newCause) return;

    if (row.committedCause === null) {
      // Never saved — just update the local selection, no network call.
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, cause: newCause } : r)));
      return;
    }

    // Already-committed row — "renaming" its cause is a delete of the old
    // cause plus an upsert of the new one, since there's no dedicated rename
    // endpoint. If the PATCH half fails after the DELETE succeeds, refresh
    // from the server so the UI never lies about what's actually saved.
    const amountCents = parseDollarsToCents(row.value);
    const oldCause = row.committedCause;
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: true } : r)));
    try {
      const delRes = await fetch("/api/admin/ledger/budgets/cause-lines", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause: oldCause }),
      });
      if (!delRes.ok) {
        const data = await delRes.json().catch(() => ({}));
        throw new Error(data.error || "Could not change cause. Try again.");
      }
      const patchRes = await fetch("/api/admin/ledger/budgets/cause-lines", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause: newCause, amountCents }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(
          data.error ||
            `"${oldCause}" was removed but could not be re-added as "${newCause}". Refreshing to show the current state.`,
        );
      }
      const data: { categoryTotalCents: number } = await patchRes.json();
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, cause: newCause, committedCause: newCause, saving: false } : r)),
      );
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change cause. Try again.");
      router.refresh();
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: false } : r)));
    }
  }

  function addRow() {
    if (disabled) return;
    const cause = nextUnusedCause(usedCauses);
    setRows((prev) => [...prev, { cause, committedCause: null, value: "", saving: false }]);
    dirtyRef.current.push(false);
  }

  function requestRemove(index: number) {
    if (disabled) return;
    const row = rows[index];
    if (!row) return;
    if (row.committedCause === null) {
      // Never saved — drop it locally, nothing to confirm or delete server-side.
      doRemoveLocal(index);
      return;
    }
    const cents = parseDollarsToCents(row.value);
    if (cents === 0) {
      void doRemoveCommitted(index);
      return;
    }
    setRemoveConfirm({ index, cause: row.cause, amountLabel: `$${(cents / 100).toFixed(2)}` });
  }

  function doRemoveLocal(index: number) {
    const next = rows.filter((_, i) => i !== index);
    dirtyRef.current.splice(index, 1);
    if (next.length === 0) {
      // Only reachable when the removed row was the sole, never-committed
      // pre-fill row — a pure cancel, nothing was ever written.
      onExitBreakdown("cancelled");
      return;
    }
    setRows(next);
  }

  async function doRemoveCommitted(index: number) {
    const row = rows[index];
    if (!row || row.committedCause === null) return;
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: true } : r)));
    try {
      const res = await fetch("/api/admin/ledger/budgets/cause-lines", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow, cause: row.committedCause }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to remove cause line.");
      }
      const data: { action: "line_deleted" | "parent_deleted"; categoryTotalCents?: number } =
        await res.json();
      if (data.action === "parent_deleted") {
        // That was the last cause line — the parent ledger_budgets row is
        // gone too. Revert to an ordinary empty lump-sum row.
        onExitBreakdown("emptied");
        router.refresh();
        return;
      }
      const next = rows.filter((_, i) => i !== index);
      dirtyRef.current.splice(index, 1);
      setRows(next);
      if (typeof data.categoryTotalCents === "number") {
        onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove cause line. Try again.");
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving: false } : r)));
    }
  }

  function handleConfirmRemove() {
    if (!removeConfirm) return;
    const { index } = removeConfirm;
    setRemoveConfirm(null);
    void doRemoveCommitted(index);
  }

  async function doCollapse() {
    try {
      const res = await fetch("/api/admin/ledger/budgets/cause-lines/collapse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fundId, fiscalYear, categoryId, flow }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not collapse to lump sum. Try again.");
      }
      toast.success("Collapsed to a single lump-sum amount.");
      onExitBreakdown("collapsed");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not collapse to lump sum. Try again.");
    }
  }

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const otherUsed = new Set(rows.filter((_, i) => i !== index).map((r) => r.cause));
        const options = ALL_CAUSES.filter((c) => !otherUsed.has(c) || c === row.cause);
        return (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-lg bg-gray-50 p-2 sm:flex-row sm:items-center"
          >
            <select
              value={row.cause}
              onChange={(e) => void handleCauseChange(index, e.target.value)}
              disabled={disabled || row.saving}
              aria-label="Cause for this line item"
              className="block w-full rounded border border-gray-300 py-1.5 px-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 sm:flex-1 min-h-[36px]"
            >
              {options.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-28">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm select-none">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.value}
                  onChange={(e) => handleAmountChange(index, e.target.value)}
                  onBlur={() => void commitAmount(index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  disabled={disabled || row.saving}
                  className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm tabular-nums focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                  placeholder="0.00"
                  aria-label={`Amount for ${row.cause}`}
                />
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => requestRemove(index)}
                  title={`Remove ${row.cause}`}
                  aria-label={`Remove ${row.cause} line`}
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
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-sm text-gray-700">
          Category total:{" "}
          <span className="font-semibold tabular-nums">${(totalCents / 100).toFixed(2)}</span>
        </p>
        {!disabled && (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={addRow}
              disabled={usedCauses.size >= ALL_CAUSES.length}
              className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
            >
              + Add cause
            </button>
            {hasCommittedRows ? (
              <button
                type="button"
                onClick={() => setCollapseConfirmOpen(true)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
              >
                Collapse to lump sum
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onExitBreakdown("cancelled")}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {disabled && <p className="text-xs text-gray-400">This budget is locked for editing.</p>}

      <ConfirmDialog
        open={removeConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveConfirm(null);
        }}
        title="Remove this cause line?"
        description={
          removeConfirm
            ? `This removes the ${removeConfirm.amountLabel} line for "${removeConfirm.cause}". The category total will decrease by that amount.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={handleConfirmRemove}
      />

      <ConfirmDialog
        open={collapseConfirmOpen}
        onOpenChange={setCollapseConfirmOpen}
        title="Collapse to a single lump sum?"
        description="This deletes the individual cause line items — the category's dollar total is kept as one lump-sum amount, but the per-cause detail is lost and can't be recovered. You can break it down by cause again later, but you'll need to re-enter each line."
        confirmLabel="Collapse"
        destructive
        onConfirm={() => {
          setCollapseConfirmOpen(false);
          void doCollapse();
        }}
      />
    </div>
  );
}

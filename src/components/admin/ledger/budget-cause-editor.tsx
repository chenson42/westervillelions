"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BUDGET_CAUSES,
  OTHER_COMMUNITY_SUPPORT_CAUSE,
  MAX_BUDGET_LINE_LABEL_LENGTH,
  sumBudgetCauseLines,
  formatBudgetReferenceCents,
} from "@/lib/ledger";

const ALL_CAUSES: readonly string[] = [...BUDGET_CAUSES, OTHER_COMMUNITY_SUPPORT_CAUSE];
const CAUSE_LINES_URL = "/api/admin/ledger/budgets/cause-lines";

export interface BudgetCauseLine {
  /** null only for a client-side pending pre-fill row that's never been saved. */
  id: string | null;
  cause: string;
  label: string;
  amountCents: number;
  /**
   * Read-only prior-year reference columns (2026-07-28-causeline-prior-year-
   * reference — extends the category-grain reference from
   * 2026-07-28-budgeting-page-redesign Increment 1 down to this cause/
   * beneficiary line). Sourced by the page from a second getFundReport() call
   * at fiscalYear - 1, matched by `(categoryId, cause, label)` via
   * `causeLineReferenceKey`. null = no prior-year data (new line, new
   * category, or a manually-typed label with no matching prior-FY party) —
   * renders "—". Optional/defaulted so a never-saved client-side row (the
   * "Break down by cause" pre-fill, or a freshly added line) doesn't need to
   * supply them.
   */
  priorBudgetCents?: number | null;
  priorActualCents?: number | null;
}

interface Row {
  /** null = never saved to the server — a fresh/pending row (mirrors B-17's `committedCause` convention, but keyed correctly now that cause can repeat). */
  id: string | null;
  cause: string;
  label: string;
  /** Dollar-string value of the amount input, e.g. "125.00". */
  value: string;
  saving: boolean;
  /** Fixed at seed time from `initialLines` — read-only reference, never
   *  recomputed as the treasurer edits label/amount (see BudgetCauseLine's
   *  doc comment). null for a client-side-only row (a fresh "+ Add line" or
   *  the breakdown pre-fill). */
  priorBudgetCents: number | null;
  priorActualCents: number | null;
}

export type ExitBreakdownReason = "cancelled" | "collapsed" | "emptied";

interface BudgetCauseEditorProps {
  fundId: string;
  fiscalYear: number;
  categoryId: string;
  flow: "income" | "expense";
  /**
   * Seed rows for local state. Either the server-confirmed breakdown
   * (`pending: false`, every row has an `id`) or a single client-side
   * pre-fill row (`pending: true`, `id: null`, cause =
   * OTHER_COMMUNITY_SUPPORT_CAUSE, amount = the category's prior lump-sum
   * value) — see budget-editor.tsx's "Break down by cause" handler. Never
   * empty.
   */
  initialLines: BudgetCauseLine[];
  /** True when initialLines is a local pre-fill that hasn't been saved yet. */
  pending: boolean;
  /** Locked-budget defense-in-depth — mirrors BudgetEditor's own `disabled` prop. */
  disabled?: boolean;
  /** Prior labels used anywhere in this entity's cause lines — feeds the `<datalist>` autocomplete. */
  labelOptions?: string[];
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

/** Read-only reference cell — one of Prior Budget / Prior Actual. Mirrors
 *  BudgetEditor's own `ReferenceValue` (2026-07-28-budgeting-page-redesign,
 *  Increment 1) so the two grains look identical. */
function ReferenceValue({ label, cents }: { label: string; cents: number | null | undefined }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</p>
      <p className="text-sm tabular-nums text-gray-500 truncate">
        {formatBudgetReferenceCents(cents ?? null)}
      </p>
    </div>
  );
}

function parseDollarsToCents(raw: string | undefined): number {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return 0;
  const n = parseFloat(trimmed);
  return !isNaN(n) && n >= 0 ? Math.round(n * 100) : 0;
}

function currentTotalCents(rows: Row[]): number {
  return sumBudgetCauseLines(rows.map((r) => ({ amountCents: parseDollarsToCents(r.value) })));
}

/**
 * Reads the server's `{ error, reason }` 409/400 body and returns the copy to
 * show the treasurer. The server already writes a specific, cause-naming
 * message for both `locked` and `duplicate_cause_label` (see
 * `assertBudgetUnlocked`/`duplicateCauseLabelResult` in ledger-queries.ts), so
 * this just forwards `data.error` with a generic fallback per reason — it
 * exists so every call site handles a missing/malformed body identically.
 */
function describeWriteError(
  data: { error?: string; reason?: "locked" | "duplicate_cause_label" },
  fallback: string,
): string {
  if (data.error) return data.error;
  if (data.reason === "locked") return "This budget is locked. Unlock it to make changes.";
  if (data.reason === "duplicate_cause_label") {
    return "A line for this cause and label already exists — edit it instead.";
  }
  return fallback;
}

/**
 * Cause-level budget breakdown for one category (B-17 Increment A; re-keyed
 * to `id` and grouped-by-cause by Labeled Cause Budget Lines,
 * DECISION-047/048). Nested inside BudgetEditor when a giving-eligible
 * expense category (isCauseEligibleCategory) is in breakdown mode. Mirrors
 * BudgetEditor's own commit-on-blur/Enter, explicit-remove, and
 * ConfirmDialog conventions exactly — this is the third nested layer in an
 * already-dense editor, so it must not look or behave like a bolted-on
 * component.
 *
 * Row identity is the line's own `id` (`id === null` means "never saved").
 * A cause is chosen once, at creation — there is no in-place cause change in
 * this increment (DECISION-048 item 2). A never-saved row shows a cause
 * `<select>`; once it commits, its cause becomes a plain group header, not a
 * control. Rows are grouped by cause for display (header + per-cause
 * subtotal + nested labeled lines), in canonical ALL_CAUSES order so the
 * grouping is stable across re-renders/reloads.
 */
export default function BudgetCauseEditor({
  fundId,
  fiscalYear,
  categoryId,
  flow,
  initialLines,
  pending,
  disabled = false,
  labelOptions = [],
  onTotalChange,
  onExitBreakdown,
}: BudgetCauseEditorProps) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.map((l) => ({
      id: pending ? null : l.id,
      cause: l.cause,
      label: l.label,
      value: (l.amountCents / 100).toFixed(2),
      saving: false,
      priorBudgetCents: l.priorBudgetCents ?? null,
      priorActualCents: l.priorActualCents ?? null,
    })),
  );
  const dirtyAmountRef = useRef<boolean[]>(rows.map(() => false));
  const dirtyLabelRef = useRef<boolean[]>(rows.map(() => false));
  const [removeConfirm, setRemoveConfirm] = useState<{
    index: number;
    cause: string;
    amountLabel: string;
  } | null>(null);
  const [collapseConfirmOpen, setCollapseConfirmOpen] = useState(false);
  const datalistId = `cause-line-labels_${categoryId}_${flow}`;

  const hasCommittedRows = rows.some((r) => r.id !== null);
  const totalCents = currentTotalCents(rows);

  function setRowSaving(index: number, saving: boolean) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, saving } : r)));
  }

  function handleAmountChange(index: number, value: string) {
    if (disabled) return;
    const next = rows.map((r, i) => (i === index ? { ...r, value } : r));
    setRows(next);
    dirtyAmountRef.current[index] = true;
    onTotalChange?.((currentTotalCents(next) / 100).toFixed(2));
  }

  function handleLabelChange(index: number, label: string) {
    if (disabled) return;
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label } : r)));
    dirtyLabelRef.current[index] = true;
  }

  function handlePendingCauseChange(index: number, cause: string) {
    if (disabled) return;
    // Never saved — just update the local group it'll land in once it
    // commits. No network call: nothing exists server-side to rename yet.
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, cause } : r)));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
      void commitRow(index);
    }
  }

  async function commitRow(index: number) {
    const row = rows[index];
    if (!row) return;

    if (row.id === null) {
      await commitCreate(index);
      return;
    }
    await commitUpdate(index);
  }

  /** First-ever commit for a never-saved row — this IS how it gets created. */
  async function commitCreate(index: number) {
    const row = rows[index];
    if (!row) return;

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
    if (row.label.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
      toast.error(`Label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer.`);
      return;
    }

    setRowSaving(index, true);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId,
          fiscalYear,
          categoryId,
          flow,
          cause: row.cause,
          label: row.label,
          amountCents,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Failed to save cause line."));
      }
      const data: { lineId: string; cause: string; label: string; categoryTotalCents: number } =
        await res.json();
      setRows((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, id: data.lineId, cause: data.cause, label: data.label, saving: false } : r,
        ),
      );
      dirtyAmountRef.current[index] = false;
      dirtyLabelRef.current[index] = false;
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save cause line. Try again.");
      setRowSaving(index, false);
    }
  }

  /** Amount and/or label edit on an already-committed row — single in-place UPDATE, no delete+recreate. */
  async function commitUpdate(index: number) {
    const row = rows[index];
    if (!row || row.id === null) return;

    const amountDirty = dirtyAmountRef.current[index];
    const labelDirty = dirtyLabelRef.current[index];
    if (!amountDirty && !labelDirty) return;

    let amountCents: number | undefined;
    if (amountDirty) {
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
      amountCents = Math.round(n * 100);
      if (amountCents > 2_147_483_647) {
        toast.error("Amount exceeds maximum.");
        return;
      }
    }
    if (labelDirty && row.label.length > MAX_BUDGET_LINE_LABEL_LENGTH) {
      toast.error(`Label must be ${MAX_BUDGET_LINE_LABEL_LENGTH} characters or fewer.`);
      return;
    }

    const body: { id: string; amountCents?: number; label?: string } = { id: row.id };
    if (amountDirty) body.amountCents = amountCents;
    if (labelDirty) body.label = row.label;

    setRowSaving(index, true);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Failed to save cause line."));
      }
      const data: { label: string; categoryTotalCents: number } = await res.json();
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, label: data.label, saving: false } : r)));
      dirtyAmountRef.current[index] = false;
      dirtyLabelRef.current[index] = false;
      onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save cause line. Try again.");
      setRowSaving(index, false);
    }
  }

  function addRow() {
    if (disabled) return;
    setRows((prev) => [
      ...prev,
      {
        id: null,
        cause: BUDGET_CAUSES[0],
        label: "",
        value: "",
        saving: false,
        priorBudgetCents: null,
        priorActualCents: null,
      },
    ]);
    dirtyAmountRef.current.push(false);
    dirtyLabelRef.current.push(false);
  }

  function requestRemove(index: number) {
    if (disabled) return;
    const row = rows[index];
    if (!row) return;
    if (row.id === null) {
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
    dirtyAmountRef.current.splice(index, 1);
    dirtyLabelRef.current.splice(index, 1);
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
    if (!row || row.id === null) return;
    setRowSaving(index, true);
    try {
      const res = await fetch(CAUSE_LINES_URL, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(describeWriteError(data, "Failed to remove cause line."));
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
      dirtyAmountRef.current.splice(index, 1);
      dirtyLabelRef.current.splice(index, 1);
      setRows(next);
      if (typeof data.categoryTotalCents === "number") {
        onTotalChange?.((data.categoryTotalCents / 100).toFixed(2));
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove cause line. Try again.");
      setRowSaving(index, false);
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

  // Group rows by cause, iterated in canonical ALL_CAUSES order (not
  // insertion order) so the grouping is stable across re-renders/reloads.
  const rowsByCause = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const bucket = rowsByCause.get(row.cause);
    if (bucket) bucket.push(index);
    else rowsByCause.set(row.cause, [index]);
  });
  const groupOrder = ALL_CAUSES.filter((c) => rowsByCause.has(c));
  // Defensive: a cause value outside the canonical list (shouldn't happen —
  // isValidBudgetCause gates every write) still renders, appended at the end,
  // rather than silently disappearing.
  for (const c of rowsByCause.keys()) {
    if (!groupOrder.includes(c)) groupOrder.push(c);
  }

  return (
    <div className="space-y-3">
      <datalist id={datalistId}>
        {labelOptions.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      {groupOrder.map((cause) => {
        const indices = rowsByCause.get(cause) ?? [];
        const subtotalCents = sumBudgetCauseLines(
          indices.map((i) => ({ amountCents: parseDollarsToCents(rows[i].value) })),
        );
        return (
          <div key={cause} className="rounded-lg bg-gray-50 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-800">{cause}</p>
              <p className="text-xs text-gray-500 tabular-nums">
                Subtotal: <span className="font-medium text-gray-700">${(subtotalCents / 100).toFixed(2)}</span>
              </p>
            </div>
            <div className="space-y-2 pl-3 border-l-2 border-gray-200">
              {indices.map((index) => {
                const row = rows[index];
                return (
                  <div key={index} className="space-y-1">
                    {/* Prior-year reference columns (read-only) — same
                        grid-cols-2 pattern as BudgetEditor's category-grain
                        columns, so it stacks cleanly at 360px too. */}
                    <div className="grid grid-cols-2 gap-2 max-w-xs">
                      <ReferenceValue label="Prior Budget" cents={row.priorBudgetCents} />
                      <ReferenceValue label="Prior Actual" cents={row.priorActualCents} />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {row.id === null ? (
                      <select
                        value={row.cause}
                        onChange={(e) => handlePendingCauseChange(index, e.target.value)}
                        disabled={disabled || row.saving}
                        aria-label="Cause for this line item"
                        className="block w-full rounded border border-gray-300 py-1.5 px-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 sm:w-48 min-h-[36px]"
                      >
                        {ALL_CAUSES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-sm text-gray-400 select-none sm:w-3" aria-hidden="true">
                        &bull;
                      </span>
                    )}
                    <input
                      type="text"
                      list={datalistId}
                      value={row.label}
                      onChange={(e) => handleLabelChange(index, e.target.value)}
                      onBlur={() => void commitRow(index)}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      disabled={disabled || row.saving}
                      maxLength={MAX_BUDGET_LINE_LABEL_LENGTH}
                      placeholder="(generic)"
                      aria-label={`Label for this ${cause} line`}
                      className="block w-full rounded border border-gray-300 py-1.5 px-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60 sm:flex-1 min-h-[36px]"
                    />
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
                          onBlur={() => void commitRow(index)}
                          onKeyDown={(e) => handleKeyDown(e, index)}
                          disabled={disabled || row.saving}
                          className="block w-full rounded border border-gray-300 py-1 pl-6 pr-2 text-sm tabular-nums focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue disabled:opacity-60"
                          placeholder="0.00"
                          aria-label={`Amount for ${cause}${row.label ? ` (${row.label})` : ""}`}
                        />
                      </div>
                      {!disabled && (
                        <button
                          type="button"
                          onClick={() => requestRemove(index)}
                          title={`Remove ${cause}${row.label ? ` (${row.label})` : ""} line`}
                          aria-label={`Remove ${cause}${row.label ? ` (${row.label})` : ""} line`}
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
                  </div>
                );
              })}
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
              className="text-xs font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
            >
              + Add line
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
        description="This deletes the individual cause line items — the category's dollar total is kept as one lump-sum amount, but the per-cause detail (including every label) is lost and can't be recovered. You can break it down by cause again later, but you'll need to re-enter each line."
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import BudgetEditor from "@/components/admin/ledger/budget-editor";
import type { BudgetCauseLine } from "@/components/admin/ledger/budget-cause-editor";
import { computeFundLineSums, sumBudgetCauseLines } from "@/lib/ledger";
import { BudgetPlanBalanceSummary } from "@/components/admin/ledger/budget-plan-status";

export interface FundSetupItem {
  fundId: string;
  fundSlug: string;
  fundName: string;
  fundKind: string;
  budgetEditorLines: {
    categoryId: string;
    categoryName: string;
    flow: "income" | "expense";
    budgetCents: number | null;
    countsAsGiving: boolean;
    causeLines: BudgetCauseLine[] | null;
    /** Prior-FY reference columns (Increment 1, 2026-07-28-budgeting-page-redesign)
     *  — read-only, sourced from a second getFundReport(fund.id, priorFY) call
     *  in the page. null = no prior-year data (new category/entity), renders "—". */
    priorBudgetCents: number | null;
    priorActualCents: number | null;
    /**
     * Soft-delete/restore-until-finalize (Increment 2, DECISION-052/053) —
     * non-null = this row is marked for removal, purged only on Approve &
     * lock. Sourced straight from getFundReport's target-FY report (not the
     * prior-FY report, which has no bearing here).
     */
    pendingDeleteAt: string | null;
    /**
     * Budget Star & Notes (DECISION-057, docs/work-log/2026-07-28-budget-
     * star-notes.md). Sourced straight from getFundReport's target-FY
     * report. Drives both the filled/outline star icon (via BudgetEditor's
     * own optimistic override) and the instant sort-to-top below (via
     * starOverrides, lifted here so it reacts before the round trip
     * completes).
     */
    starred: boolean;
    note: string | null;
  }[];
  /**
   * Active categories for this fund's kind, per flow, that don't already
   * appear in budgetEditorLines — feeds the "+ Add category" existing-
   * category picker. Usually empty in practice (getFundReport already
   * returns every active category as a line), but it's what lets a fund with
   * literally zero categories still resolve to "create the first one."
   */
  unbudgetedCategories: {
    income: { id: string; name: string }[];
    expense: { id: string; name: string }[];
  };
}

/** Seed the live dollar values (cents) from the server-sourced `fund` prop.
 *  Extracted so the useState initializer and the fund-change re-sync build
 *  the map identically — the running Income / Expenses / Net readout is
 *  summed from this map, so it MUST track server truth on every
 *  router.refresh(), not just at mount. */
function seedLineValues(fund: FundSetupItem): Record<string, number> {
  const m: Record<string, number> = {};
  for (const line of fund.budgetEditorLines) {
    m[`${line.categoryId}_${line.flow}`] = line.budgetCents ?? 0;
  }
  return m;
}

/** Companion to seedLineValues for the pending-delete flags — same re-sync contract. */
function seedPendingDeleteKeys(fund: FundSetupItem): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const line of fund.budgetEditorLines) {
    m[`${line.categoryId}_${line.flow}`] = line.pendingDeleteAt !== null;
  }
  return m;
}

/**
 * Companion to seedLineValues/seedPendingDeleteKeys for the Budgeting Page
 * Restructure's third computeFundLineSums parameter — sums, per category,
 * the cents belonging to cause lines that are individually pending-delete on
 * their OWN flag (their parent category is still live; a whole-category
 * exclusion is already handled by pendingDeleteKeys above, so this never
 * double-subtracts).
 */
function seedCauseLinePendingCents(fund: FundSetupItem): Record<string, number> {
  const m: Record<string, number> = {};
  for (const line of fund.budgetEditorLines) {
    const key = `${line.categoryId}_${line.flow}`;
    const pending = (line.causeLines ?? []).filter((cl) => cl.pendingDeleteAt != null);
    m[key] = sumBudgetCauseLines(pending);
  }
  return m;
}

/** Companion to seedLineValues/seedPendingDeleteKeys for Budget Star & Notes
 *  (DECISION-057) — same re-sync contract. */
function seedStarOverrides(fund: FundSetupItem): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const line of fund.budgetEditorLines) {
    m[`${line.categoryId}_${line.flow}`] = line.starred;
  }
  return m;
}

type AddCategoryMode = "existing" | "new";

interface AddCategoryState {
  flow: "income" | "expense";
  mode: AddCategoryMode;
  existingCategoryId: string;
  name: string;
  countsAsGiving: boolean;
  form990Line: string;
  submitting: boolean;
}

interface BudgetFundEditorProps {
  entityId: string;
  targetFiscalYear: number;
  /** Singular — one fund per mount (Budgeting Overview/Drill-Down Restructure). */
  fund: FundSetupItem;
  /** Gates add/remove line and create-category. */
  canManage: boolean;
  /** READ-ONLY here — disables the editor (editorDisabled = locked || !canManage),
   *  same as before. This component never renders Approve/Unlock controls —
   *  those live on the overview's BudgetApprovalPanel (Flow 6), since the
   *  lock is scoped to (entityId, targetFiscalYear), not to a single fund. */
  locked: boolean;
  /** Prior labels used anywhere in this entity's cause lines — feeds this
   *  fund's BudgetCauseEditor `<datalist>` autocomplete. */
  labelOptions?: string[];
  /** Preserves ?entity=&fy= on the "back to overview" link when the budget is locked. */
  overviewHref: string;
}

/**
 * Single-fund budget editor — the narrowed remnant of the former
 * GuidedBudgetSetup (Budgeting Overview/Drill-Down Restructure). Drill-down
 * only, mounted once per page at `/admin/ledger/budgeting/[fundSlug]`.
 *
 * Mechanically un-indexed from the original's four `Record<fundId,
 * Record<string,X>>` maps down to flat `Record<string,X>` — exactly one fund
 * mounts per page now, so the fundId indexing layer is dead weight. No
 * mechanic changes: same seed/re-sync contract, same renderFlowSection, same
 * add-category flow, same live-totals recompute via computeFundLineSums.
 *
 * "Seed from last year" and the Approve/Lock + Unlock panels were removed
 * from THIS component (not from the app) — Approve/Unlock now lives on the
 * overview's BudgetApprovalPanel exclusively (Flow 6: the lock is
 * entity+FY-scoped, not fund-scoped).
 */
export default function BudgetFundEditor({
  entityId,
  targetFiscalYear,
  fund,
  canManage,
  locked,
  labelOptions = [],
  overviewHref,
}: BudgetFundEditorProps) {
  const router = useRouter();
  const [addCategoryState, setAddCategoryState] = useState<AddCategoryState | null>(null);

  // Live dollar values (cents), seeded from the current target-FY budget so
  // the balance readout is correct before any typing.
  const [lineValues, setLineValues] = useState<Record<string, number>>(() => seedLineValues(fund));

  // Pending-delete flags (Increment 2, DECISION-052/053) — keyed identically
  // to lineValues. Initialized from each line's pendingDeleteAt, updated
  // instantly by BudgetEditor's onPendingDeleteChange (ahead of the round
  // trip), reconciled with server truth on the router.refresh() every
  // successful commit already triggers.
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Record<string, boolean>>(() =>
    seedPendingDeleteKeys(fund),
  );

  // Cents to subtract for cause lines individually pending-delete on their
  // own flag (Budgeting Page Restructure, DECISION-054 item 2) — the third
  // computeFundLineSums parameter. Same re-sync contract as lineValues/
  // pendingDeleteKeys; updated instantly (ahead of the round-trip) by
  // BudgetEditor's onCauseLinePendingDeltaChange, bubbled up from
  // BudgetCauseEditor.
  const [causeLinePendingCents, setCauseLinePendingCents] = useState<Record<string, number>>(() =>
    seedCauseLinePendingCents(fund),
  );

  // Budget Star & Notes (DECISION-057) — keyed identically to the other three
  // maps. Updated instantly (ahead of the PATCH round trip) by BudgetEditor's
  // onStarChange, so renderFlowSection's sort-to-top reorders the moment the
  // treasurer clicks, not after the next router.refresh(). Re-synced from
  // server truth in the same useEffect below.
  const [starOverrides, setStarOverrides] = useState<Record<string, boolean>>(() =>
    seedStarOverrides(fund),
  );

  // Scroll-to-newly-added-category (Budgeting UX Polish, 2026-07-30) —
  // `${categoryId}_${flow}` of the category just added via either "+ Add
  // category" mode, set the instant the add resolves (before
  // router.refresh() completes) and cleared by whichever BudgetEditor
  // instance's row actually matches it.
  const [scrollToKey, setScrollToKey] = useState<string | null>(null);

  // Re-sync all four maps from `fund` whenever the server sends fresh data —
  // every successful edit fires router.refresh(), which re-renders the
  // Server Component page and hands down a new `fund` prop.
  useEffect(() => {
    setLineValues(seedLineValues(fund));
    setPendingDeleteKeys(seedPendingDeleteKeys(fund));
    setCauseLinePendingCents(seedCauseLinePendingCents(fund));
    setStarOverrides(seedStarOverrides(fund));
  }, [fund]);

  function handleInputChange(key: string, value: string) {
    const trimmed = value.trim();
    let cents = 0;
    if (trimmed !== "") {
      const n = parseFloat(trimmed);
      if (!isNaN(n) && n >= 0) cents = Math.round(n * 100);
    }
    setLineValues((prev) => ({ ...prev, [key]: cents }));
  }

  function handlePendingDeleteChange(key: string, pendingDelete: boolean) {
    setPendingDeleteKeys((prev) => ({ ...prev, [key]: pendingDelete }));
  }

  /**
   * Budget Star & Notes (DECISION-057) — fired by BudgetEditor's
   * onStarChange the instant a star toggle resolves optimistically (and
   * again with the previous value if the PATCH fails), so this fund's
   * sort-to-top reacts before the round trip completes.
   */
  function handleStarChange(key: string, starred: boolean) {
    setStarOverrides((prev) => ({ ...prev, [key]: starred }));
  }

  /**
   * Fired the instant a cause-line/group removal starts its hold (or
   * resolves) or an undo/restore reverses it, bubbled from BudgetCauseEditor
   * through BudgetEditor — BEFORE any round trip completes, so the live
   * balance badge reacts on the click, not after the next router.refresh().
   * Positive delta = subtract; negative = add back.
   */
  function handleCauseLinePendingDeltaChange(key: string, deltaCents: number) {
    setCauseLinePendingCents((prev) => {
      const nextValue = (prev[key] ?? 0) + deltaCents;
      return { ...prev, [key]: nextValue };
    });
  }

  function openAddCategory(flow: "income" | "expense") {
    const hasExisting = fund.unbudgetedCategories[flow].length > 0;
    setAddCategoryState({
      flow,
      mode: hasExisting ? "existing" : "new",
      existingCategoryId: fund.unbudgetedCategories[flow][0]?.id ?? "",
      name: "",
      countsAsGiving: true,
      form990Line: "",
      submitting: false,
    });
  }

  async function submitNewCategory() {
    if (!addCategoryState) return;
    const trimmedName = addCategoryState.name.trim();
    if (!trimmedName) {
      toast.error("Category name is required.");
      return;
    }
    setAddCategoryState((s) => (s ? { ...s, submitting: true } : s));
    try {
      const res = await fetch("/api/admin/ledger/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          fiscalYear: targetFiscalYear,
          fundKind: fund.fundKind,
          flow: addCategoryState.flow,
          name: trimmedName,
          countsAsGiving: addCategoryState.countsAsGiving,
          ...(addCategoryState.form990Line.trim()
            ? { form990Line: addCategoryState.form990Line.trim() }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not create category. Try again.");
      }
      const created: { id: string } = await res.json();
      toast.success(`Added "${trimmedName}" as a new ${addCategoryState.flow} category.`);
      setScrollToKey(`${created.id}_${addCategoryState.flow}`);
      setAddCategoryState(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create category. Try again.");
      setAddCategoryState((s) => (s ? { ...s, submitting: false } : s));
    }
  }

  async function addExistingCategory() {
    if (!addCategoryState || !addCategoryState.existingCategoryId) return;
    setAddCategoryState((s) => (s ? { ...s, submitting: true } : s));
    try {
      const res = await fetch("/api/admin/ledger/budgets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundId: fund.fundId,
          fiscalYear: targetFiscalYear,
          categoryId: addCategoryState.existingCategoryId,
          flow: addCategoryState.flow,
          annualAmountCents: 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not add category. Try again.");
      }
      toast.success("Category added to this year's budget.");
      setScrollToKey(`${addCategoryState.existingCategoryId}_${addCategoryState.flow}`);
      setAddCategoryState(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add category. Try again.");
      setAddCategoryState((s) => (s ? { ...s, submitting: false } : s));
    }
  }

  const editorDisabled = locked || !canManage;

  /**
   * One labeled Income/Expense section for this fund (Budgeting Page
   * Restructure) — each independently renders its own "+ Add category"
   * trigger at the header and its own empty state (Flow 7: a fund with
   * categories in only one flow still shows the other flow's header + add
   * control, not silence).
   */
  function renderFlowSection(flow: "income" | "expense") {
    // Stable sort: starred rows first, existing order preserved otherwise.
    // Read from starOverrides (not line.starred directly) so a star click
    // reorders the instant BudgetEditor's onStarChange fires — well before
    // the PATCH round trip or the next router.refresh() completes.
    const isStarredFor = (key: string) => starOverrides[key] ?? false;
    const sectionLines = [...fund.budgetEditorLines.filter((l) => l.flow === flow)].sort(
      (a, b) =>
        Number(isStarredFor(`${b.categoryId}_${b.flow}`)) -
        Number(isStarredFor(`${a.categoryId}_${a.flow}`)),
    );
    const addingToThisSection = addCategoryState?.flow === flow;
    const sectionLabel = flow === "income" ? "Income" : "Expense";
    // Distinct, low-saturation section tints so it's obvious which half of
    // the fund you're in while scrolling/editing. Income = a faint
    // lions-blue wash (on-brand); expense = a faint warm gray (stone, not
    // amber — amber is already the "Needs review" balance badge color
    // elsewhere on this page).
    const sectionTintClass = flow === "income" ? "bg-lions-blue/5" : "bg-stone-50";

    return (
      <div className={`rounded-xl p-3 space-y-3 ${sectionTintClass}`}>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {sectionLabel}
          </h4>
          {canManage && !locked && !addingToThisSection && (
            <button
              type="button"
              onClick={() => openAddCategory(flow)}
              className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
            >
              + Add {flow} category
            </button>
          )}
        </div>

        {sectionLines.length > 0 ? (
          <BudgetEditor
            fundId={fund.fundId}
            fiscalYear={targetFiscalYear}
            flow={flow}
            lines={sectionLines}
            onInputChange={(key, value) => handleInputChange(key, value)}
            onPendingDeleteChange={(key, pendingDelete) => handlePendingDeleteChange(key, pendingDelete)}
            onCauseLinePendingDeltaChange={(key, deltaCents) =>
              handleCauseLinePendingDeltaChange(key, deltaCents)
            }
            disabled={editorDisabled}
            showRemoveControl={canManage && !locked}
            labelOptions={labelOptions}
            showAnnotationControls={canManage}
            onStarChange={(key, starred) => handleStarChange(key, starred)}
            scrollToKey={scrollToKey}
            onScrolledToKey={() => setScrollToKey(null)}
          />
        ) : (
          <div className="bg-white rounded-2xl p-4 text-center text-sm text-gray-500">
            No {flow} categories yet for this fund
            {canManage && !locked ? " — add the first one above." : "."}
          </div>
        )}

        {addingToThisSection && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (addCategoryState?.mode === "existing") {
                void addExistingCategory();
              } else {
                void submitNewCategory();
              }
            }}
            className="bg-white rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Add {addCategoryState?.flow} category to {fund.fundName}
              </p>
              <button
                type="button"
                onClick={() => setAddCategoryState(null)}
                className="text-sm text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-1 min-h-[44px]"
              >
                Cancel
              </button>
            </div>

            {fund.unbudgetedCategories[flow].length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[10rem]">
                  <label
                    htmlFor={`existing-cat-${fund.fundId}-${flow}`}
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    Use an existing category
                  </label>
                  <select
                    id={`existing-cat-${fund.fundId}-${flow}`}
                    value={addCategoryState?.existingCategoryId ?? ""}
                    onChange={(e) =>
                      setAddCategoryState((s) =>
                        s ? { ...s, mode: "existing", existingCategoryId: e.target.value } : s,
                      )
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                  >
                    {fund.unbudgetedCategories[flow].map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void addExistingCategory()}
                  disabled={addCategoryState?.submitting}
                  className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                >
                  Add
                </button>
              </div>
            )}

            <p className="text-xs text-gray-500">
              {fund.unbudgetedCategories[flow].length > 0
                ? "…or create a new category:"
                : "Create a new category:"}
            </p>

            <div>
              <label
                htmlFor={`new-cat-name-${fund.fundId}-${flow}`}
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                Category name
              </label>
              <input
                id={`new-cat-name-${fund.fundId}-${flow}`}
                type="text"
                value={addCategoryState?.name ?? ""}
                onChange={(e) =>
                  setAddCategoryState((s) => (s ? { ...s, mode: "new", name: e.target.value } : s))
                }
                placeholder="e.g. Peace Poster Contest"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id={`counts-as-giving-${fund.fundId}-${flow}`}
                type="checkbox"
                checked={addCategoryState?.countsAsGiving ?? true}
                onChange={(e) =>
                  setAddCategoryState((s) => (s ? { ...s, countsAsGiving: e.target.checked } : s))
                }
                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
              />
              <label htmlFor={`counts-as-giving-${fund.fundId}-${flow}`} className="text-sm text-gray-700">
                Counts as giving (philanthropy/impact reporting)
              </label>
            </div>

            <div>
              <label
                htmlFor={`form990-${fund.fundId}-${flow}`}
                className="block text-xs font-medium text-gray-600 mb-1"
              >
                IRS Form 990 line (optional)
              </label>
              <input
                id={`form990-${fund.fundId}-${flow}`}
                type="text"
                value={addCategoryState?.form990Line ?? ""}
                onChange={(e) =>
                  setAddCategoryState((s) => (s ? { ...s, form990Line: e.target.value } : s))
                }
                placeholder="e.g. Part IX, line 24e"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              />
            </div>

            <button
              type="submit"
              disabled={addCategoryState?.submitting || !addCategoryState?.name.trim()}
              className="bg-lions-blue text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              {addCategoryState?.submitting ? "Creating…" : "Create category"}
            </button>
          </form>
        )}
      </div>
    );
  }

  const sums = computeFundLineSums(lineValues, pendingDeleteKeys, causeLinePendingCents);

  return (
    <div className="space-y-6">
      {/* A treasurer who landed here via a bookmark/direct link (rather than
          clicking through from the overview) still needs to know WHY the
          editor below is disabled — the full locked banner + Unlock control
          live on the overview only (Flow 6), so this is a compact pointer
          back, not a duplicate of that panel. */}
      {locked && (
        <div className="bg-lions-gold/10 rounded-2xl shadow-sm overflow-hidden p-4 text-sm text-gray-700">
          This FY&rsquo;s budget is locked and read-only.{" "}
          <Link href={overviewHref} className="font-semibold text-lions-blue hover:underline">
            Go to the Budget Overview
          </Link>{" "}
          to unlock it.
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <BudgetPlanBalanceSummary
            fundName={fund.fundName}
            fundKind={fund.fundKind}
            incomeCents={sums.incomeCents}
            expenseCents={sums.expenseCents}
            variant="detailed"
          />
        </div>

        <div className="px-5 py-4 space-y-4">
          {renderFlowSection("income")}
          {renderFlowSection("expense")}
        </div>
      </div>
    </div>
  );
}

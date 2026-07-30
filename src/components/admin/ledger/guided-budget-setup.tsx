"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import BudgetEditor from "@/components/admin/ledger/budget-editor";
import type { BudgetCauseLine } from "@/components/admin/ledger/budget-cause-editor";
import { computeBudgetBalanceStatus, computeFundLineSums, sumBudgetCauseLines } from "@/lib/ledger";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fundKindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Presentation-only per Phase 3 design — never gates a write. */
function balanceBadgeClass(status: "ok" | "warn" | "info"): string {
  switch (status) {
    case "warn":
      return "bg-amber-50 text-amber-800";
    case "info":
      return "bg-lions-gold/10 text-gray-800";
    default:
      return "bg-green-50 text-green-800";
  }
}

/** Four fixed message templates keyed by (fundKind, status) per Phase 3 design. */
function balanceMessage(fundKind: string, status: "ok" | "warn" | "info", netCents: number): string {
  const netAbs = formatDollars(Math.abs(netCents));

  if (fundKind === "administrative") {
    if (status === "warn") return `Expenses exceed budgeted income by ${netAbs} — operating deficit planned.`;
    if (netCents === 0) return "Budgeted income equals planned expenses — balanced.";
    return `Budgeted income exceeds expenses by ${netAbs} — balanced.`;
  }
  if (fundKind === "activity") {
    if (status === "warn") {
      return `Planned receipts and disbursements differ by ${netAbs} — outside the $100 pass-through tolerance.`;
    }
    return "Planned receipts and disbursements are within $100 of each other — balanced pass-through.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    if (netCents > 0) return `Planned addition to fund balance: ${netAbs}.`;
    if (netCents < 0) return `Planned drawdown from fund balance: ${netAbs}.`;
    return "Net $0 planned — income matches planned spending.";
  }
  return `Net budgeted: ${netCents < 0 ? "-" : ""}${netAbs}.`;
}

/**
 * Per-fund "why" one-liner, appended under balanceMessage() (Phase 1 work-log
 * docs/work-log/2026-07-27-ledger-budgeting-guide.md). Copy must match
 * computeBudgetBalanceStatus's actual rule per fund kind, not a generic
 * restatement — see that function's JSDoc in src/lib/ledger.ts. Unrecognized
 * fund kinds get no note (nothing meaningful to explain).
 */
function balanceWhyNote(fundKind: string): string | null {
  if (fundKind === "administrative") {
    return "This fund covers the club's own operations, so it's expected to hold a real reserve — budgeted income should never fall short of planned expense.";
  }
  if (fundKind === "activity") {
    return "This fund is a pass-through for publicly-raised money on its way to the Foundation, so “balanced” means net income and expense land within about $100 of each other — not a surplus.";
  }
  if (fundKind === "charitable" || fundKind === "scholarship") {
    return "This fund holds public and charitable money meant to be disbursed, not stockpiled — a planned drawdown is normal and won't trigger a warning.";
  }
  return null;
}

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

export interface BudgetApprovalSummary {
  approvedByName: string | null;
  approvedAtLabel: string | null;
  boardMinute: string | null;
  unlockedByName: string | null;
  unlockedAtLabel: string | null;
  unlockReason: string | null;
}

interface GuidedBudgetSetupProps {
  entityId: string;
  targetFiscalYear: number;
  funds: FundSetupItem[];
  /** Gates add/remove line and create-category. */
  canManage: boolean;
  /** Gates the Approve/Lock and Unlock panels — independent of canManage. */
  canApprove: boolean;
  /** Single source of truth for read-only rendering — mirrors isBudgetLocked() server-side. */
  locked: boolean;
  approval: BudgetApprovalSummary | null;
  /** Prior labels used anywhere in this entity's cause lines — feeds every BudgetCauseEditor's `<datalist>` autocomplete. */
  labelOptions?: string[];
}

/**
 * Seed the per-fund, per-line live dollar values (cents) from the server-sourced
 * `funds` prop. Extracted so the useState initializer and the funds-change
 * re-sync (see the useEffect in GuidedBudgetSetup) build the map identically —
 * the running Income / Expenses / Banked-used totals are summed from this map,
 * so it MUST track server truth on every router.refresh(), not just at mount.
 */
function seedLineValues(funds: FundSetupItem[]): Record<string, Record<string, number>> {
  const init: Record<string, Record<string, number>> = {};
  for (const fund of funds) {
    const m: Record<string, number> = {};
    for (const line of fund.budgetEditorLines) {
      m[`${line.categoryId}_${line.flow}`] = line.budgetCents ?? 0;
    }
    init[fund.fundId] = m;
  }
  return init;
}

/** Companion to seedLineValues for the pending-delete flags — same re-sync contract. */
function seedPendingDeleteKeys(funds: FundSetupItem[]): Record<string, Record<string, boolean>> {
  const init: Record<string, Record<string, boolean>> = {};
  for (const fund of funds) {
    const m: Record<string, boolean> = {};
    for (const line of fund.budgetEditorLines) {
      m[`${line.categoryId}_${line.flow}`] = line.pendingDeleteAt !== null;
    }
    init[fund.fundId] = m;
  }
  return init;
}

/**
 * Companion to seedLineValues/seedPendingDeleteKeys for the Budgeting Page
 * Restructure's third computeFundLineSums parameter — sums, per category,
 * the cents belonging to cause lines that are individually pending-delete on
 * their OWN flag (their parent category is still live; a whole-category
 * exclusion is already handled by pendingDeleteKeys above, so this never
 * double-subtracts). `annualAmountCents` is never decremented for a pending
 * cause line (architect Ruling 1), so without this, a still-live category's
 * lineValues[key] would silently include a dead cause line's dollars after
 * every router.refresh() — same re-sync contract as the other two seeds.
 */
function seedCauseLinePendingCents(funds: FundSetupItem[]): Record<string, Record<string, number>> {
  const init: Record<string, Record<string, number>> = {};
  for (const fund of funds) {
    const m: Record<string, number> = {};
    for (const line of fund.budgetEditorLines) {
      const key = `${line.categoryId}_${line.flow}`;
      const pending = (line.causeLines ?? []).filter((cl) => cl.pendingDeleteAt != null);
      m[key] = sumBudgetCauseLines(pending);
    }
    init[fund.fundId] = m;
  }
  return init;
}

/**
 * Companion to seedLineValues/seedPendingDeleteKeys for Budget Star & Notes
 * (DECISION-057) — same re-sync contract. Lifted here (rather than left
 * purely local to BudgetEditor) so renderFlowSection's sort-to-top can react
 * the instant a star click resolves optimistically, before
 * BudgetEditor.onStarChange's round trip completes.
 */
function seedStarOverrides(funds: FundSetupItem[]): Record<string, Record<string, boolean>> {
  const init: Record<string, Record<string, boolean>> = {};
  for (const fund of funds) {
    const m: Record<string, boolean> = {};
    for (const line of fund.budgetEditorLines) {
      m[`${line.categoryId}_${line.flow}`] = line.starred;
    }
    init[fund.fundId] = m;
  }
  return init;
}

type AddCategoryMode = "existing" | "new";

interface AddCategoryState {
  fundId: string;
  flow: "income" | "expense";
  mode: AddCategoryMode;
  existingCategoryId: string;
  name: string;
  countsAsGiving: boolean;
  form990Line: string;
  submitting: boolean;
}

/**
 * Guided budgeting client island: the existing BudgetEditor reused for
 * line-level adjustment (with an explicit remove control and read-only
 * prior-year reference columns), inline category creation, and the
 * Approve/Lock + Unlock panels.
 *
 * "Seed from last year" (POST /api/admin/ledger/budgets/seed) and its
 * per-fund preview list were removed in Increment 1 of the 2026-07-28
 * budgeting-page redesign — the treasurer types each year's number directly,
 * using the new Prior Budget / Prior Actual reference columns instead of a
 * bulk-copy action. See docs/work-log/2026-07-28-budgeting-page-redesign.md.
 *
 * Per architect Ruling 4 / tech-lead's design: computeBudgetBalanceStatus is
 * presentation-only and is recomputed here on every keystroke via
 * BudgetEditor's onInputChange — no write path is aware of its output,
 * including the Approve panel's balance summary (warns, never blocks).
 *
 * Two-tier visibility (Ruling 3): canManage gates add/remove line and
 * create-category; canApprove gates Approve/Unlock, independent of
 * canManage. A locked budget hides every canManage-only control regardless
 * of role and renders BudgetEditor disabled — server-side
 * assertBudgetUnlocked() is the real enforcement, this is defense-in-depth
 * only.
 */
export default function GuidedBudgetSetup({
  entityId,
  targetFiscalYear,
  funds,
  canManage,
  canApprove,
  locked,
  approval,
  labelOptions = [],
}: GuidedBudgetSetupProps) {
  const router = useRouter();
  const [addCategoryState, setAddCategoryState] = useState<AddCategoryState | null>(null);

  const [boardMinute, setBoardMinute] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

  const [unlockReason, setUnlockReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);

  // Per-fund, per-line live dollar values (cents), seeded from the current
  // target-FY budget so the balance readout is correct before any typing.
  const [lineValues, setLineValues] = useState<Record<string, Record<string, number>>>(() =>
    seedLineValues(funds),
  );

  // Per-fund, per-line pending-delete flags (Increment 2, DECISION-052/053)
  // — keyed identically to lineValues. Initialized from each line's
  // pendingDeleteAt, updated instantly by BudgetEditor's
  // onPendingDeleteChange (ahead of the round-trip), reconciled with server
  // truth on the router.refresh() every successful commit already triggers.
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Record<string, Record<string, boolean>>>(
    () => seedPendingDeleteKeys(funds),
  );

  // Per-fund, per-line cents to subtract for cause lines individually
  // pending-delete on their own flag (Budgeting Page Restructure,
  // DECISION-054 item 2) — the third computeFundLineSums parameter. Same
  // re-sync contract as lineValues/pendingDeleteKeys; updated instantly
  // (ahead of the round-trip) by BudgetEditor's
  // onCauseLinePendingDeltaChange, bubbled up from BudgetCauseEditor.
  const [causeLinePendingCents, setCauseLinePendingCents] = useState<
    Record<string, Record<string, number>>
  >(() => seedCauseLinePendingCents(funds));

  // Budget Star & Notes (DECISION-057) — per-fund, per-line star state, keyed
  // identically to the other three maps. Updated instantly (ahead of the
  // PATCH round trip) by BudgetEditor's onStarChange, so renderFlowSection's
  // sort-to-top reorders the moment the treasurer clicks, not after the next
  // router.refresh(). Re-synced from server truth in the same useEffect
  // below.
  const [starOverrides, setStarOverrides] = useState<Record<string, Record<string, boolean>>>(
    () => seedStarOverrides(funds),
  );

  // Scroll-to-newly-added-category (Budgeting UX Polish, 2026-07-30) —
  // `${categoryId}_${flow}` of the category just added via either "+ Add
  // category" mode, set the instant the add resolves (before
  // router.refresh() completes) and cleared by whichever BudgetEditor
  // instance's row actually matches it (see that component's own
  // scrollToKey effect). Only one of the several BudgetEditor instances
  // mounted across funds/flows will ever find a match, since category ids
  // are unique.
  const [scrollToKey, setScrollToKey] = useState<string | null>(null);

  // Re-sync all three maps from `funds` whenever the server sends fresh data. The
  // useState initializers above run only at mount, but every successful edit
  // fires router.refresh(), which re-renders the Server Component page and
  // hands down a new `funds` prop — without this, the running Income /
  // Expenses / Banked-used totals stay frozen at their mount-time values and
  // drift after adds, restores, cause-breakdown commits, or any server-
  // normalized amount. `funds` is a prop from the Server Component, so its
  // identity changes only on a server re-render (refresh / navigation), never
  // on this island's own setState — the reseed therefore fires exactly on
  // refresh/page-load and can't clobber in-flight typing (which only happens
  // before a commit/refresh).
  useEffect(() => {
    setLineValues(seedLineValues(funds));
    setPendingDeleteKeys(seedPendingDeleteKeys(funds));
    setCauseLinePendingCents(seedCauseLinePendingCents(funds));
    setStarOverrides(seedStarOverrides(funds));
  }, [funds]);

  function handleInputChange(fundId: string, key: string, value: string) {
    const trimmed = value.trim();
    let cents = 0;
    if (trimmed !== "") {
      const n = parseFloat(trimmed);
      if (!isNaN(n) && n >= 0) cents = Math.round(n * 100);
    }
    setLineValues((prev) => ({
      ...prev,
      [fundId]: { ...(prev[fundId] ?? {}), [key]: cents },
    }));
  }

  function handlePendingDeleteChange(fundId: string, key: string, pendingDelete: boolean) {
    setPendingDeleteKeys((prev) => ({
      ...prev,
      [fundId]: { ...(prev[fundId] ?? {}), [key]: pendingDelete },
    }));
  }

  /**
   * Budget Star & Notes (DECISION-057) — fired by BudgetEditor's
   * onStarChange the instant a star toggle resolves optimistically (and
   * again with the previous value if the PATCH fails), so this fund's
   * sort-to-top reacts before the round trip completes.
   */
  function handleStarChange(fundId: string, key: string, starred: boolean) {
    setStarOverrides((prev) => ({
      ...prev,
      [fundId]: { ...(prev[fundId] ?? {}), [key]: starred },
    }));
  }

  /**
   * Fired the instant a cause-line/group removal starts its hold (or
   * resolves) or an undo/restore reverses it, bubbled from BudgetCauseEditor
   * through BudgetEditor (Budgeting Page Restructure) — BEFORE any round
   * trip completes, so the live balance badge reacts on the click, not after
   * the next router.refresh(). Positive delta = subtract; negative = add
   * back (mirrors onPendingDeltaChange's own doc comment).
   */
  function handleCauseLinePendingDeltaChange(fundId: string, key: string, deltaCents: number) {
    setCauseLinePendingCents((prev) => {
      const fundMap = prev[fundId] ?? {};
      const nextValue = (fundMap[key] ?? 0) + deltaCents;
      return { ...prev, [fundId]: { ...fundMap, [key]: nextValue } };
    });
  }

  /**
   * Live "excluded from the running total" projection (DECISION-052 item
   * 1, extended to cause-line grain by DECISION-054 item 2) — entirely
   * client-side. A pending-delete line's amount is dropped from both
   * incomeCents/expenseCents the instant soft-delete/restore resolves —
   * whether at the whole-category grain or, now, at the individual
   * cause-line/group grain — so the treasurer sees the effect on the
   * balance badge before the budget is ever finalized. getFundReport's own
   * committed totals are completely unaffected (see that function's doc
   * comment).
   */
  function fundSums(fundId: string): { incomeCents: number; expenseCents: number } {
    return computeFundLineSums(
      lineValues[fundId] ?? {},
      pendingDeleteKeys[fundId] ?? {},
      causeLinePendingCents[fundId] ?? {},
    );
  }

  /**
   * Total pending-delete items across every fund — feeds the Approve & lock
   * warning copy. Counts whole-category pending-deletes (unchanged) PLUS
   * every individually pending-delete cause line (Budgeting Page
   * Restructure) — a cause-group removal flips every member row's own flag,
   * so this loop counts both single-line and group removals uniformly with
   * no separate bookkeeping. Only server-committed cause-line state counts
   * here (a client-side hold that hasn't fired yet isn't guaranteed to be
   * purged if Approve & lock is clicked before it resolves).
   */
  function totalPendingDeleteCount(): number {
    let count = 0;
    for (const m of Object.values(pendingDeleteKeys)) {
      for (const v of Object.values(m)) {
        if (v) count += 1;
      }
    }
    for (const fund of funds) {
      for (const line of fund.budgetEditorLines) {
        for (const cl of line.causeLines ?? []) {
          if (cl.pendingDeleteAt != null) count += 1;
        }
      }
    }
    return count;
  }

  function openAddCategory(fund: FundSetupItem, flow: "income" | "expense") {
    const hasExisting = fund.unbudgetedCategories[flow].length > 0;
    setAddCategoryState({
      fundId: fund.fundId,
      flow,
      mode: hasExisting ? "existing" : "new",
      existingCategoryId: fund.unbudgetedCategories[flow][0]?.id ?? "",
      name: "",
      countsAsGiving: true,
      form990Line: "",
      submitting: false,
    });
  }

  async function submitNewCategory(fund: FundSetupItem) {
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
          fundId: addCategoryState.fundId,
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

  async function handleApprove() {
    const trimmed = boardMinute.trim();
    if (!trimmed) {
      toast.error("Board minute reference is required.");
      return;
    }
    setApproving(true);
    try {
      const res = await fetch("/api/admin/ledger/budget-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, fiscalYear: targetFiscalYear, boardMinute: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not lock the budget. Try again.");
      }
      toast.success(`FY${targetFiscalYear} budget locked.`);
      setBoardMinute("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not lock the budget. Try again.");
    } finally {
      setApproving(false);
    }
  }

  async function handleUnlock() {
    const trimmed = unlockReason.trim();
    if (!trimmed) {
      toast.error("A reason is required to unlock this budget.");
      return;
    }
    setUnlocking(true);
    try {
      const res = await fetch("/api/admin/ledger/budget-approvals/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, fiscalYear: targetFiscalYear, unlockReason: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not unlock the budget. Try again.");
      }
      toast.success(`FY${targetFiscalYear} budget unlocked for editing.`);
      setUnlockReason("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not unlock the budget. Try again.");
    } finally {
      setUnlocking(false);
    }
  }

  const targetLabel = `FY${targetFiscalYear}`;
  const editorDisabled = locked || !canManage;
  const pendingDeleteCount = totalPendingDeleteCount();

  /**
   * One labeled Income/Expense section per fund (Budgeting Page Restructure)
   * — replaces the old flat, fund-wide interleaved list. Each section
   * independently renders its own "+ Add category" trigger at the HEADER
   * (moved up from the bottom of the card) and its own empty state (Flow 7:
   * a fund with categories in only one flow still shows the other flow's
   * header + add control, not silence).
   */
  function renderFlowSection(fund: FundSetupItem, flow: "income" | "expense") {
    // Stable sort: starred rows first, existing order preserved otherwise
    // (Phase 1 Decision 1, user-confirmed). Read from starOverrides (not
    // line.starred directly) so a star click reorders the instant
    // BudgetEditor's onStarChange fires — well before the PATCH round trip
    // or the next router.refresh() completes. Array.prototype.sort has been
    // stable since ES2019, so relative order within the starred/unstarred
    // partitions is preserved for free.
    const isStarredFor = (key: string) => starOverrides[fund.fundId]?.[key] ?? false;
    const sectionLines = [...fund.budgetEditorLines.filter((l) => l.flow === flow)].sort(
      (a, b) =>
        Number(isStarredFor(`${b.categoryId}_${b.flow}`)) -
        Number(isStarredFor(`${a.categoryId}_${a.flow}`)),
    );
    const addingToThisSection =
      addCategoryState?.fundId === fund.fundId && addCategoryState.flow === flow;
    const sectionLabel = flow === "income" ? "Income" : "Expense";
    // Distinct, low-saturation section tints (UX Polish, 2026-07-30) so it's
    // obvious which half of the fund you're in while scrolling/editing.
    // Income = a faint lions-blue wash (on-brand); expense = a faint warm
    // gray (stone, not amber — amber is already the "Needs review" balance
    // badge color elsewhere on this page, so reusing it here would read as
    // a warning). Nested white boxes (empty state, add-category form) below
    // get bg-white instead of bg-gray-50 so they still pop against the tint.
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
              onClick={() => openAddCategory(fund, flow)}
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
            onInputChange={(key, value) => handleInputChange(fund.fundId, key, value)}
            onPendingDeleteChange={(key, pendingDelete) =>
              handlePendingDeleteChange(fund.fundId, key, pendingDelete)
            }
            onCauseLinePendingDeltaChange={(key, deltaCents) =>
              handleCauseLinePendingDeltaChange(fund.fundId, key, deltaCents)
            }
            disabled={editorDisabled}
            showRemoveControl={canManage && !locked}
            labelOptions={labelOptions}
            showAnnotationControls={canManage}
            onStarChange={(key, starred) => handleStarChange(fund.fundId, key, starred)}
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
                void submitNewCategory(fund);
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

  return (
    <div className="space-y-6">
      {/* Locked-state banner — informational tone (lions-gold), never lions-red */}
      {locked && (
        <div className="bg-lions-gold/10 rounded-2xl shadow-sm overflow-hidden p-5 flex items-start gap-3">
          <svg
            className="h-5 w-5 text-lions-blue flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
          <div>
            <h2 className="font-semibold text-gray-900">
              {targetLabel} budget is locked
            </h2>
            <p className="mt-1 text-sm text-gray-700">
              Approved by {approval?.approvedByName ?? "Unknown"}
              {approval?.approvedAtLabel ? ` on ${approval.approvedAtLabel}` : ""}
              {approval?.boardMinute ? ` — board minute: ${approval.boardMinute}` : ""}.
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Editing is disabled until a LEDGER_APPROVE holder unlocks it below.
            </p>
          </div>
        </div>
      )}

      {/* Approve / Unlock panel — visible whenever canApprove, independent of canManage */}
      {canApprove && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
          {!locked ? (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                Approve &amp; lock {targetLabel}
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Locking records a board vote to adopt this budget and makes every fund&rsquo;s{" "}
                {targetLabel} budget read-only until it&rsquo;s unlocked. This is allowed even if a
                fund below is flagged &ldquo;Needs review&rdquo; — the status is advisory only.
              </p>
              {funds.length > 0 && (
                <ul className="flex flex-wrap gap-2 mb-4">
                  {funds.map((fund) => {
                    const sums = fundSums(fund.fundId);
                    const balance = computeBudgetBalanceStatus(
                      fund.fundKind,
                      sums.incomeCents,
                      sums.expenseCents,
                    );
                    return (
                      <li
                        key={fund.fundId}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${balanceBadgeClass(balance.status)}`}
                      >
                        {fund.fundName}
                        <span className="opacity-75">
                          {balance.status === "warn" ? "Needs review" : balance.status === "info" ? "Informational" : "Balanced"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="max-w-md">
                <label htmlFor="board-minute" className="block text-sm font-medium text-gray-700 mb-1">
                  Board minute reference
                </label>
                <input
                  id="board-minute"
                  type="text"
                  value={boardMinute}
                  onChange={(e) => setBoardMinute(e.target.value)}
                  placeholder="e.g. 2026-07 board meeting, item 4"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                />
              </div>
              <button
                type="button"
                onClick={() => setApproveConfirmOpen(true)}
                disabled={approving || !boardMinute.trim()}
                className="mt-4 bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              >
                {approving ? "Locking…" : `Approve & lock for ${targetLabel}`}
              </button>
              {approval?.unlockedAtLabel && (
                <p className="mt-3 text-xs text-gray-500">
                  Last unlocked by {approval.unlockedByName ?? "Unknown"} on {approval.unlockedAtLabel}
                  {approval.unlockReason ? `: "${approval.unlockReason}"` : ""}.
                </p>
              )}
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                Unlock {targetLabel} to amend
              </h2>
              <p className="text-sm text-gray-500 mb-4">
                Reopens this budget for editing. The current approval (board minute, approver,
                date) stays on record — you&rsquo;ll need to re-approve after amending.
              </p>
              <div className="max-w-md">
                <label htmlFor="unlock-reason" className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for unlocking
                </label>
                <textarea
                  id="unlock-reason"
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  rows={2}
                  placeholder="e.g. Board approved a mid-year amendment on 2026-09-12"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                />
              </div>
              <button
                type="button"
                onClick={() => setUnlockConfirmOpen(true)}
                disabled={unlocking || !unlockReason.trim()}
                className="mt-4 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              >
                {unlocking ? "Unlocking…" : "Unlock to amend"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Per-fund review cards — two columns only when there's more than one
          fund, so a single-fund entity (e.g. the Foundation's lone Charitable
          Fund) spans full width instead of leaving half the screen empty. */}
      <div className={`grid grid-cols-1 gap-4 ${funds.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {funds.map((fund) => {
          const sums = fundSums(fund.fundId);
          const balance = computeBudgetBalanceStatus(fund.fundKind, sums.incomeCents, sums.expenseCents);

          return (
            <div key={fund.fundId} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 pt-5 pb-3 border-b border-gray-100">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-900 text-base">{fund.fundName}</h3>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-lg bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap">
                      {fundKindLabel(fund.fundKind)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${balanceBadgeClass(balance.status)}`}
                    >
                      {balance.status === "warn" ? "Needs review" : balance.status === "info" ? "Informational" : "Balanced"}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-sm text-gray-600">
                  {balanceMessage(fund.fundKind, balance.status, balance.netCents)}
                </p>
                {balanceWhyNote(fund.fundKind) && (
                  <p className="mt-1 text-xs text-gray-500">{balanceWhyNote(fund.fundKind)}</p>
                )}
                {/* Live running totals behind the balance verdict — recompute
                    from fundSums on every keystroke. "Banked used" = drawdown
                    from the fund balance when expenses outrun income; a surplus
                    reads as "To balance". */}
                <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-center">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400">Income</dt>
                    <dd className="text-sm font-semibold tabular-nums text-gray-900">
                      {formatDollars(sums.incomeCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400">Expenses</dt>
                    <dd className="text-sm font-semibold tabular-nums text-gray-900">
                      {formatDollars(sums.expenseCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400">
                      {balance.netCents < 0 ? "Banked used" : balance.netCents > 0 ? "To balance" : "Net"}
                    </dt>
                    <dd
                      className={`text-sm font-semibold tabular-nums ${
                        balance.netCents < 0 ? "text-amber-700" : "text-gray-900"
                      }`}
                    >
                      {formatDollars(Math.abs(balance.netCents))}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Income / Expense sections (Budgeting Page Restructure) —
                    each independently rendered, each carrying its own
                    "+ Add category" header control and its own empty state
                    (Flow 7). */}
                {renderFlowSection(fund, "income")}
                {renderFlowSection(fund, "expense")}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        title={`Lock ${targetLabel} budget?`}
        description={`This records board minute "${boardMinute.trim()}" and makes every fund's ${targetLabel} budget read-only.${pendingDeleteCount > 0 ? ` ${pendingDeleteCount} budget line${pendingDeleteCount === 1 ? "" : "s"} marked for removal will be permanently deleted when you lock this budget.` : ""} It can be unlocked later to amend, then must be re-approved.`}
        confirmLabel="Approve & lock"
        destructive={pendingDeleteCount > 0}
        onConfirm={() => {
          setApproveConfirmOpen(false);
          void handleApprove();
        }}
      />

      <ConfirmDialog
        open={unlockConfirmOpen}
        onOpenChange={setUnlockConfirmOpen}
        title={`Unlock ${targetLabel} budget?`}
        description={`This reopens a board-approved budget for editing. Reason on record: "${unlockReason.trim()}". You'll need to re-approve after amending.`}
        confirmLabel="Unlock"
        destructive
        onConfirm={() => {
          setUnlockConfirmOpen(false);
          void handleUnlock();
        }}
      />
    </div>
  );
}

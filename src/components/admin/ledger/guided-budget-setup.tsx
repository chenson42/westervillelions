"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import BudgetEditor from "@/components/admin/ledger/budget-editor";
import { computeBudgetBalanceStatus, type SeedProposedLine } from "@/lib/ledger";

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

type SeedMode = "fill-empty" | "overwrite";

interface SeedResponseFund {
  fundId: string;
  fundName: string;
  seededCount: number;
  skippedCount: number;
  overwrittenCount: number;
}

interface SeedResponse {
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: SeedResponseFund[];
}

export interface FundSetupItem {
  fundId: string;
  fundSlug: string;
  fundName: string;
  fundKind: string;
  /** Total lines that could be seeded for this fund (deriveSeedLinesForFund output length). */
  seedableCount: number;
  /** Subset of seedableCount that already has a value for the target FY. */
  collisionCount: number;
  /** True when the fund had zero prior-FY actuals and the fallback to prior-FY budget fired. */
  seededFromBudgetFallback: boolean;
  seedableLines: SeedProposedLine[];
  budgetEditorLines: {
    categoryId: string;
    categoryName: string;
    flow: "income" | "expense";
    budgetCents: number | null;
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
  priorFiscalYear: number;
  targetFiscalYear: number;
  funds: FundSetupItem[];
  /** Gates add/remove line, create-category, seed/overwrite. */
  canManage: boolean;
  /** Gates the Approve/Lock and Unlock panels — independent of canManage. */
  canApprove: boolean;
  /** Single source of truth for read-only rendering — mirrors isBudgetLocked() server-side. */
  locked: boolean;
  approval: BudgetApprovalSummary | null;
}

/**
 * Compact, scrollable review list of the proposed seed lines for one fund —
 * category, flow, proposed amount, and (when the category already has a
 * FY{target} value) what it would be overwritten from. Read-only preview;
 * the actual write only happens via the Seed/Overwrite actions.
 */
function ProposedLinesList({
  lines,
  targetFiscalYear,
}: {
  lines: SeedProposedLine[];
  targetFiscalYear: number;
}) {
  if (lines.length === 0) return null;
  const income = lines.filter((l) => l.flow === "income");
  const expense = lines.filter((l) => l.flow === "expense");

  return (
    <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100">
      <ul className="divide-y divide-gray-100 text-sm">
        {[...income, ...expense].map((line) => (
          <li key={`${line.categoryId}_${line.flow}`} className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <span className="text-xs uppercase tracking-wide text-gray-400 mr-2">{line.flow}</span>
              <span className="text-gray-700 truncate">{line.categoryName}</span>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="font-medium text-gray-900 tabular-nums">
                {formatDollars(line.proposedAmountCents)}
              </span>
              {line.collision && (
                <span className="block text-xs text-amber-700 tabular-nums">
                  currently {formatDollars(line.existingTargetAmountCents ?? 0)} for FY{targetFiscalYear}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ConfirmTarget = {
  scope: "all" | string; // "all" or a fundId
  fundName?: string;
  collisionCount: number;
  seedableCount: number;
};

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
 * Guided budgeting client island: entity-wide + per-fund "seed from last
 * year" actions (POST /api/admin/ledger/budgets/seed), the overwrite
 * ConfirmDialog, per-fund seed-preview + live balance readout, the existing
 * BudgetEditor reused for line-level adjustment (with an explicit remove
 * control), inline category creation, and the Approve/Lock + Unlock panels.
 *
 * Per architect Ruling 4 / tech-lead's design: computeBudgetBalanceStatus is
 * presentation-only and is recomputed here on every keystroke via
 * BudgetEditor's onInputChange — no write path is aware of its output,
 * including the Approve panel's balance summary (warns, never blocks).
 *
 * Two-tier visibility (Ruling 3): canManage gates add/remove/create-category/
 * seed; canApprove gates Approve/Unlock, independent of canManage. A locked
 * budget hides every canManage-only control regardless of role and renders
 * BudgetEditor disabled — server-side assertBudgetUnlocked() is the real
 * enforcement, this is defense-in-depth only.
 */
export default function GuidedBudgetSetup({
  entityId,
  priorFiscalYear,
  targetFiscalYear,
  funds,
  canManage,
  canApprove,
  locked,
  approval,
}: GuidedBudgetSetupProps) {
  const router = useRouter();
  const [seedingScope, setSeedingScope] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [addCategoryState, setAddCategoryState] = useState<AddCategoryState | null>(null);

  const [boardMinute, setBoardMinute] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

  const [unlockReason, setUnlockReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);

  // Per-fund, per-line live dollar values (cents), seeded from the current
  // target-FY budget so the balance readout is correct before any typing.
  const [lineValues, setLineValues] = useState<Record<string, Record<string, number>>>(() => {
    const init: Record<string, Record<string, number>> = {};
    for (const fund of funds) {
      const m: Record<string, number> = {};
      for (const line of fund.budgetEditorLines) {
        m[`${line.categoryId}_${line.flow}`] = line.budgetCents ?? 0;
      }
      init[fund.fundId] = m;
    }
    return init;
  });

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

  function fundSums(fundId: string): { incomeCents: number; expenseCents: number } {
    const m = lineValues[fundId] ?? {};
    let incomeCents = 0;
    let expenseCents = 0;
    for (const [key, cents] of Object.entries(m)) {
      if (key.endsWith("_income")) incomeCents += cents;
      else if (key.endsWith("_expense")) expenseCents += cents;
    }
    return { incomeCents, expenseCents };
  }

  async function runSeed(mode: SeedMode, fundIds?: string[]) {
    const scopeKey = fundIds && fundIds.length === 1 ? fundIds[0] : "all";
    setSeedingScope(scopeKey);
    try {
      const res = await fetch("/api/admin/ledger/budgets/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          targetFiscalYear,
          mode,
          ...(fundIds && fundIds.length > 0 ? { fundIds } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to seed budget.");
      }
      const data: SeedResponse = await res.json();
      const summary = data.funds
        .filter((f) => f.seededCount > 0 || f.overwrittenCount > 0 || f.skippedCount > 0)
        .map((f) => {
          const parts = [`${f.seededCount} seeded`];
          if (f.overwrittenCount > 0) parts.push(`${f.overwrittenCount} overwritten`);
          if (f.skippedCount > 0) parts.push(`${f.skippedCount} already set`);
          return `${f.fundName}: ${parts.join(", ")}`;
        })
        .join(" · ");
      toast.success(summary || "Budget seeded.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seed budget. Try again.");
    } finally {
      setSeedingScope(null);
    }
  }

  function handleConfirmOverwrite() {
    if (!confirmTarget) return;
    const { scope } = confirmTarget;
    setConfirmTarget(null);
    void runSeed("overwrite", scope === "all" ? undefined : [scope]);
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
      toast.success(`Added "${trimmedName}" as a new ${addCategoryState.flow} category.`);
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

  const totalSeedable = funds.reduce((s, f) => s + f.seedableCount, 0);
  const totalCollisions = funds.reduce((s, f) => s + f.collisionCount, 0);
  const allEmpty = totalSeedable === 0;
  const anySeeding = seedingScope !== null;
  const priorLabel = `FY${priorFiscalYear}`;
  const targetLabel = `FY${targetFiscalYear}`;
  const editorDisabled = locked || !canManage;

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

      {/* Entity-wide actions — LEDGER_MANAGE only, hidden while locked */}
      {canManage && !locked && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            Seed all funds from {priorLabel}
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Copies last year&rsquo;s posted actuals (or last year&rsquo;s budget, for a fund with no
            posted activity) into {targetLabel} for every category that doesn&rsquo;t
            already have a value. Existing values are never touched unless you choose to overwrite.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runSeed("fill-empty")}
              disabled={allEmpty || anySeeding}
              className="bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
            >
              {seedingScope === "all" ? "Seeding…" : "Seed all funds"}
            </button>
            {totalCollisions > 0 && (
              <button
                type="button"
                onClick={() =>
                  setConfirmTarget({ scope: "all", collisionCount: totalCollisions, seedableCount: totalSeedable })
                }
                disabled={anySeeding}
                className="border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
              >
                Overwrite all funds&hellip;
              </button>
            )}
          </div>
          {allEmpty && (
            <p className="mt-3 text-sm text-gray-500">
              No {priorLabel} activity or budget found for this entity — enter amounts
              directly below.
            </p>
          )}
        </div>
      )}

      {/* Per-fund review cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {funds.map((fund) => {
          const sums = fundSums(fund.fundId);
          const balance = computeBudgetBalanceStatus(fund.fundKind, sums.incomeCents, sums.expenseCents);
          const isSeedingThisFund = seedingScope === fund.fundId;
          const addingToThisFund = addCategoryState?.fundId === fund.fundId;

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
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Seed preview summary — LEDGER_MANAGE only, hidden while locked */}
                {canManage && !locked && (
                  <>
                    {fund.seedableCount === 0 ? (
                      <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-500">
                        No {priorLabel} activity or budget to copy from &mdash; enter
                        amounts directly below.
                      </div>
                    ) : (
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>
                          <span className="font-medium text-gray-900">{fund.seedableCount}</span>{" "}
                          categor{fund.seedableCount === 1 ? "y" : "ies"} would be seeded from{" "}
                          {fund.seededFromBudgetFallback
                            ? `${priorLabel}'s budget`
                            : `${priorLabel} actuals`}
                          {fund.collisionCount > 0 && (
                            <>
                              {" "}
                              &mdash;{" "}
                              <span className="font-medium text-gray-900">{fund.collisionCount}</span>{" "}
                              already {fund.collisionCount === 1 ? "has" : "have"} a value for{" "}
                              {targetLabel}.
                            </>
                          )}
                        </p>
                        {fund.seededFromBudgetFallback && (
                          <p className="text-xs text-gray-400">
                            {priorLabel} had no posted activity for this fund &mdash;
                            seeding from last year&rsquo;s budget instead of actuals.
                          </p>
                        )}
                        <ProposedLinesList lines={fund.seedableLines} targetFiscalYear={targetFiscalYear} />
                      </div>
                    )}

                    {/* Per-fund seed / overwrite actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void runSeed("fill-empty", [fund.fundId])}
                        disabled={fund.seedableCount === 0 || anySeeding}
                        className="border-2 border-lions-blue text-lions-blue px-4 py-2 rounded-lg text-sm font-semibold hover:bg-lions-blue/5 transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                      >
                        {isSeedingThisFund ? "Seeding…" : "Seed this fund"}
                      </button>
                      {fund.collisionCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({
                              scope: fund.fundId,
                              fundName: fund.fundName,
                              collisionCount: fund.collisionCount,
                              seedableCount: fund.seedableCount,
                            })
                          }
                          disabled={anySeeding}
                          className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-2 py-2 min-h-[44px]"
                        >
                          Overwrite this fund&hellip;
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Line-level adjustment — rendered whenever there's something to
                    show (has lines) OR the viewer can add the fund's first one.
                    Fixes the empty-fund gap: a brand-new fund with zero
                    categories now still gets an "Add category" affordance. */}
                {(fund.budgetEditorLines.length > 0 || (canManage && !locked)) && (
                  <div className="pt-3 border-t border-gray-100 space-y-3">
                    {fund.budgetEditorLines.length > 0 ? (
                      <BudgetEditor
                        fundId={fund.fundId}
                        fiscalYear={targetFiscalYear}
                        lines={fund.budgetEditorLines}
                        onInputChange={(key, value) => handleInputChange(fund.fundId, key, value)}
                        disabled={editorDisabled}
                        showRemoveControl={canManage && !locked}
                      />
                    ) : (
                      <div className="bg-gray-50 rounded-2xl p-4 text-center text-sm text-gray-500">
                        No categories yet for this fund &mdash; add the first one below.
                      </div>
                    )}

                    {/* "+ Add category" — LEDGER_MANAGE only, hidden while locked */}
                    {canManage && !locked && (
                      <div>
                        {!addingToThisFund ? (
                          <div className="flex gap-4">
                            <button
                              type="button"
                              onClick={() => openAddCategory(fund, "income")}
                              className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
                            >
                              + Add income category
                            </button>
                            <button
                              type="button"
                              onClick={() => openAddCategory(fund, "expense")}
                              className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-2 min-h-[44px]"
                            >
                              + Add expense category
                            </button>
                          </div>
                        ) : (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (addCategoryState?.mode === "existing") {
                                void addExistingCategory();
                              } else {
                                void submitNewCategory(fund);
                              }
                            }}
                            className="bg-gray-50 rounded-2xl p-4 space-y-3"
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

                            {fund.unbudgetedCategories[addCategoryState?.flow ?? "income"].length > 0 && (
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="flex-1 min-w-[10rem]">
                                  <label
                                    htmlFor={`existing-cat-${fund.fundId}`}
                                    className="block text-xs font-medium text-gray-600 mb-1"
                                  >
                                    Use an existing category
                                  </label>
                                  <select
                                    id={`existing-cat-${fund.fundId}`}
                                    value={addCategoryState?.existingCategoryId ?? ""}
                                    onChange={(e) =>
                                      setAddCategoryState((s) =>
                                        s ? { ...s, mode: "existing", existingCategoryId: e.target.value } : s,
                                      )
                                    }
                                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
                                  >
                                    {fund.unbudgetedCategories[addCategoryState?.flow ?? "income"].map((c) => (
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
                              {fund.unbudgetedCategories[addCategoryState?.flow ?? "income"].length > 0
                                ? "…or create a new category:"
                                : "Create a new category:"}
                            </p>

                            <div>
                              <label
                                htmlFor={`new-cat-name-${fund.fundId}`}
                                className="block text-xs font-medium text-gray-600 mb-1"
                              >
                                Category name
                              </label>
                              <input
                                id={`new-cat-name-${fund.fundId}`}
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
                                id={`counts-as-giving-${fund.fundId}`}
                                type="checkbox"
                                checked={addCategoryState?.countsAsGiving ?? true}
                                onChange={(e) =>
                                  setAddCategoryState((s) =>
                                    s ? { ...s, countsAsGiving: e.target.checked } : s,
                                  )
                                }
                                className="h-4 w-4 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                              />
                              <label htmlFor={`counts-as-giving-${fund.fundId}`} className="text-sm text-gray-700">
                                Counts as giving (philanthropy/impact reporting)
                              </label>
                            </div>

                            <div>
                              <label
                                htmlFor={`form990-${fund.fundId}`}
                                className="block text-xs font-medium text-gray-600 mb-1"
                              >
                                IRS Form 990 line (optional)
                              </label>
                              <input
                                id={`form990-${fund.fundId}`}
                                type="text"
                                value={addCategoryState?.form990Line ?? ""}
                                onChange={(e) =>
                                  setAddCategoryState((s) =>
                                    s ? { ...s, form990Line: e.target.value } : s,
                                  )
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
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
        title={confirmTarget?.scope === "all" ? "Overwrite all funds?" : `Overwrite ${confirmTarget?.fundName}?`}
        description={
          confirmTarget
            ? `${confirmTarget.collisionCount} of ${confirmTarget.seedableCount} categories already have a budget for FY${targetFiscalYear}. Overwriting will replace those values with FY${priorFiscalYear} figures. Categories without an existing value are unaffected either way. This cannot be undone.`
            : ""
        }
        confirmLabel="Overwrite"
        destructive
        onConfirm={handleConfirmOverwrite}
      />

      <ConfirmDialog
        open={approveConfirmOpen}
        onOpenChange={setApproveConfirmOpen}
        title={`Lock ${targetLabel} budget?`}
        description={`This records board minute "${boardMinute.trim()}" and makes every fund's ${targetLabel} budget read-only. It can be unlocked later to amend, then must be re-approved.`}
        confirmLabel="Approve & lock"
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

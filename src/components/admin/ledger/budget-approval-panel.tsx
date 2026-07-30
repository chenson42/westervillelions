"use client";

/**
 * Approve & Lock / Unlock panel — extracted from guided-budget-setup.tsx
 * (Budgeting Overview/Drill-Down Restructure, architect Ruling 3). Overview-
 * only (Flow 6): the lock is scoped to (entityId, targetFiscalYear), not to a
 * single fund, so this panel has no home on the drill-down. No behavior
 * change from the original inline panel — same copy, same two ConfirmDialogs,
 * same two fetch calls.
 *
 * One real shape change vs. the original: this component no longer computes
 * fund balance badges from a live client `fundSums()` closure over four
 * re-sync maps (those maps moved entirely to BudgetFundEditor, which now owns
 * the only editor). It receives `fundBalances` as a prop, computed once
 * server-side from the same committed data BudgetOverviewTable uses — the
 * overview is read-only by design, so there's no live typing to reconcile
 * against.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { computeBudgetBalanceStatus } from "@/lib/ledger";
import { balanceBadgeClass } from "@/components/admin/ledger/budget-plan-status";

export interface BudgetApprovalSummary {
  approvedByName: string | null;
  approvedAtLabel: string | null;
  boardMinute: string | null;
  unlockedByName: string | null;
  unlockedAtLabel: string | null;
  unlockReason: string | null;
}

interface BudgetApprovalPanelProps {
  entityId: string;
  targetFiscalYear: number;
  /** Gates the Approve/Lock and Unlock panels — independent of canManage. */
  canApprove: boolean;
  /** Single source of truth for read-only rendering — mirrors isBudgetLocked() server-side. */
  locked: boolean;
  approval: BudgetApprovalSummary | null;
  /** Sum across ALL funds — computed server-side from committed data, mirrors
   *  the original totalPendingDeleteCount() but as a pure server computation
   *  (no live client edits to sum; this panel has no editor of its own). */
  pendingDeleteCount: number;
  /** One entry per fund — feeds the "Balanced / Needs review" badge list
   *  shown before the Approve button. Sourced from computeFundPlanSums per
   *  fund instead of a client-side fundSums() closure. */
  fundBalances: { fundName: string; fundKind: string; incomeCents: number; expenseCents: number }[];
}

export default function BudgetApprovalPanel({
  entityId,
  targetFiscalYear,
  canApprove,
  locked,
  approval,
  pendingDeleteCount,
  fundBalances,
}: BudgetApprovalPanelProps) {
  const router = useRouter();

  const [boardMinute, setBoardMinute] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

  const [unlockReason, setUnlockReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);

  const targetLabel = `FY${targetFiscalYear}`;

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
            <h2 className="font-semibold text-gray-900">{targetLabel} budget is locked</h2>
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
              {fundBalances.length > 0 && (
                <ul className="flex flex-wrap gap-2 mb-4">
                  {fundBalances.map((fund) => {
                    const balance = computeBudgetBalanceStatus(
                      fund.fundKind,
                      fund.incomeCents,
                      fund.expenseCents,
                    );
                    return (
                      <li
                        key={fund.fundName}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${balanceBadgeClass(balance.status)}`}
                      >
                        {fund.fundName}
                        <span className="opacity-75">
                          {balance.status === "warn"
                            ? "Needs review"
                            : balance.status === "info"
                              ? "Informational"
                              : "Balanced"}
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

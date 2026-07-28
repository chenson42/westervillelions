"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  BankLineWithMatch,
  CandidateTransactionRow,
  MatchedTransactionRow,
} from "@/lib/reconciliation-queries";
import type { LedgerFund, LedgerCategory } from "@/lib/db/schema";
import ReconciliationMatchPicker from "./reconciliation-match-picker";
import ReconciliationCreateFromBankLineDialog from "./reconciliation-create-from-bank-line-dialog";

function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Same signed convention as the match picker's own `signedAmount()` and the
 *  server's exact-sum re-check — expense negative, income positive. */
function signedAmount(txn: { flow: string; amountCents: number }): number {
  return txn.flow === "expense" ? -txn.amountCents : txn.amountCents;
}

interface ReconciliationMatchingGridProps {
  sessionId: string;
  bankLines: BankLineWithMatch[];
  candidateTransactions: CandidateTransactionRow[];
  /** Every matched transaction across the session, one row per match —
   *  grouped below by bankLineId to render each matched line's expandable
   *  "Matched · N" list and to source each row's own matchId for its
   *  per-row Unmatch action (DECISION-051). A legacy 1:1 match is simply a
   *  group of length 1 — no special-casing needed. */
  matchedTransactions: MatchedTransactionRow[];
  funds: LedgerFund[];
  categories: LedgerCategory[];
  isOpen: boolean;
  canRecord: boolean;
}

/**
 * In-period bank-line table with inline Match / Unmatch / Create-transaction
 * actions, plus a visually distinct, clearly-labeled collapsed section for
 * out-of-period lines (never mixed into the primary grid — Phase 1 Pass 4:
 * out-of-period rows are flagged, never silently dropped or silently
 * included in this session's tie-out/close gate).
 *
 * A matched line — whether a single 1:1 pick or a batch of N — renders as
 * "Matched · N", expandable to the underlying transaction list with a
 * per-row Unmatch action. v1 is per-row unmatch only: correcting a wrong
 * pick inside a batch means unmatching every row down to zero, then
 * re-opening the picker to select the corrected full set fresh (architect
 * §4 / DECISION-051) — a bank line with any match at all is "claimed" and
 * won't reopen the picker until it has zero matches again.
 *
 * Read-only (no action column) once the session is closed or the viewer
 * lacks LEDGER_RECORD.
 */
export default function ReconciliationMatchingGrid({
  sessionId,
  bankLines,
  candidateTransactions,
  matchedTransactions,
  funds,
  categories,
  isOpen,
  canRecord,
}: ReconciliationMatchingGridProps) {
  const router = useRouter();
  const [matchPickerLine, setMatchPickerLine] = useState<BankLineWithMatch | null>(null);
  const [createLine, setCreateLine] = useState<BankLineWithMatch | null>(null);
  const [unmatchTarget, setUnmatchTarget] = useState<{ matchId: string; label: string } | null>(
    null,
  );
  const [showOutOfPeriod, setShowOutOfPeriod] = useState(false);
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(new Set());

  const inPeriod = bankLines.filter((l) => l.inStatementPeriod);
  const outOfPeriod = bankLines.filter((l) => !l.inStatementPeriod);

  const matchesByBankLineId = new Map<string, MatchedTransactionRow[]>();
  for (const m of matchedTransactions) {
    const arr = matchesByBankLineId.get(m.bankLineId) ?? [];
    arr.push(m);
    matchesByBankLineId.set(m.bankLineId, arr);
  }

  const canAct = isOpen && canRecord;

  function toggleExpanded(lineId: string) {
    setExpandedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  async function handleUnmatch() {
    if (!unmatchTarget) return;
    try {
      const res = await fetch(
        `/api/admin/ledger/reconciliation/sessions/${sessionId}/match/${unmatchTarget.matchId}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to unmatch this transaction.");
      }
      toast.success("Unmatched.");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not unmatch this transaction. Try again."
      );
    } finally {
      setUnmatchTarget(null);
    }
  }

  function renderTable(lines: BankLineWithMatch[]) {
    const colSpan = canAct ? 6 : 5;
    return (
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Description
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Check/Slip #
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                  Status
                </th>
                {canAct && (
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {lines.map((line) => {
                const matched = line.matchedTransactionIds.length > 0;
                const lineMatches = matchesByBankLineId.get(line.id) ?? [];
                const expanded = expandedLineIds.has(line.id);
                return (
                  <Fragment key={line.id}>
                    <tr>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {formatDate(line.postingDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[20rem] truncate">
                        {line.description}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 tabular-nums whitespace-nowrap">
                        {line.checkOrSlipNumber ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold tabular-nums text-right whitespace-nowrap">
                        {formatDollars(line.amountCents)}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {matched ? (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(line.id)}
                            aria-expanded={expanded}
                            className="inline-flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 text-green-800 text-xs font-semibold px-2 py-0.5 hover:bg-green-100 transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
                          >
                            <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                            Matched &middot; {line.matchedTransactionIds.length}
                          </button>
                        ) : (
                          <span className="inline-flex items-center rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-2 py-0.5">
                            Unmatched
                          </span>
                        )}
                      </td>
                      {canAct && (
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                          {!matched && (
                            <>
                              <button
                                type="button"
                                onClick={() => setMatchPickerLine(line)}
                                className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
                              >
                                Match
                              </button>
                              <button
                                type="button"
                                onClick={() => setCreateLine(line)}
                                className="text-sm font-semibold text-lions-blue hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
                              >
                                Create transaction
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                    {matched && expanded && (
                      <tr>
                        <td colSpan={colSpan} className="bg-gray-50 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
                            Matched transactions
                          </p>
                          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
                            {lineMatches.map((m) => (
                              <li
                                key={m.matchId}
                                className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="text-sm text-gray-700">
                                  <span className="tabular-nums">{formatDate(m.txnDate)}</span>
                                  {" · "}
                                  {m.party || m.memo || <span className="text-gray-400">&mdash;</span>}
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="text-sm font-semibold tabular-nums">
                                    {formatDollars(signedAmount(m))}
                                  </span>
                                  {canAct && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setUnmatchTarget({
                                          matchId: m.matchId,
                                          label: `${formatDate(m.txnDate)} · ${
                                            m.party || m.memo || "this transaction"
                                          } (${formatDollars(signedAmount(m))})`,
                                        })
                                      }
                                      className="text-sm font-semibold text-gray-600 hover:text-red-600 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
                                    >
                                      Unmatch
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Bank lines (this statement period)
        </h2>
        {inPeriod.length === 0 ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500">
            No bank lines yet — upload a statement above to get started.
          </div>
        ) : (
          renderTable(inPeriod)
        )}
      </div>

      {outOfPeriod.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowOutOfPeriod((v) => !v)}
            className="flex items-center gap-1 text-sm font-semibold text-gray-600 hover:text-gray-900 transition focus:outline-none focus:ring-2 focus:ring-lions-blue rounded px-1 py-0.5"
            aria-expanded={showOutOfPeriod}
          >
            <span aria-hidden="true">{showOutOfPeriod ? "▾" : "▸"}</span>
            {showOutOfPeriod ? "Hide" : "Show"} {outOfPeriod.length} row
            {outOfPeriod.length === 1 ? "" : "s"} outside this statement period
          </button>
          {showOutOfPeriod && (
            <div className="mt-3">
              <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                These rows fell outside this session&rsquo;s statement period. They&rsquo;re excluded
                from this session&rsquo;s tie-out and close gate.
              </div>
              {renderTable(outOfPeriod)}
            </div>
          )}
        </div>
      )}

      {matchPickerLine && (
        <ReconciliationMatchPicker
          sessionId={sessionId}
          bankLine={matchPickerLine}
          candidateTransactions={candidateTransactions}
          open={Boolean(matchPickerLine)}
          onOpenChange={(o) => !o && setMatchPickerLine(null)}
        />
      )}

      {createLine && (
        <ReconciliationCreateFromBankLineDialog
          sessionId={sessionId}
          bankLine={createLine}
          funds={funds}
          categories={categories}
          open={Boolean(createLine)}
          onOpenChange={(o) => !o && setCreateLine(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(unmatchTarget)}
        onOpenChange={(o) => !o && setUnmatchTarget(null)}
        title="Unmatch this transaction?"
        description={
          unmatchTarget
            ? `Removes ${unmatchTarget.label} from this batch. It returns to unmatched — you can re-match at any time. Any other transactions matched to this bank line are unaffected.`
            : "This removes the link between the bank line and the transaction. It returns to unmatched — you can re-match at any time."
        }
        confirmLabel="Unmatch"
        destructive
        onConfirm={handleUnmatch}
      />
    </div>
  );
}

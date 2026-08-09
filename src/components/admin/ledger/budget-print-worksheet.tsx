import { Fragment } from "react";
import {
  computeFundPlanSums,
  formatBudgetReferenceCents,
  isCauseLineLive,
  sumBudgetCauseLines,
} from "@/lib/ledger";
import type { BudgetApprovalSummary } from "@/components/admin/ledger/budget-approval-panel";
import RichMarkdownContent from "@/components/rich-markdown-content";

interface PrintCauseLine {
  cause: string;
  label: string;
  amountCents: number;
  /** Own-flag soft-delete state (Budgeting Page Restructure, DECISION-054/
   *  055/056) — combined with the parent category's own flag via
   *  isCauseLineLive, never read alone. Optional/defaulted (mirrors
   *  BudgetCauseLine's own field) so this type stays assignable from the
   *  same FundSetupItem.budgetEditorLines[].causeLines the page already
   *  builds for the drill-down editor — no separate query for the print
   *  path. */
  pendingDeleteAt?: string | null;
  /** Budget Star & Notes (DECISION-057, docs/work-log/2026-07-28-budget-
   *  star-notes.md). Optional (mirrors pendingDeleteAt?'s convention at this
   *  grain). */
  starred?: boolean;
  note?: string | null;
}

interface PrintLine {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  budgetCents: number | null;
  priorBudgetCents: number | null;
  priorActualCents: number | null;
  /**
   * Soft-delete/restore-until-finalize (Increment 2, DECISION-052/053).
   * Non-null lines are excluded entirely from the printout — the worksheet
   * is a forward-looking plan of the budget that will actually take effect,
   * and a line already marked for removal isn't part of that plan.
   */
  pendingDeleteAt: string | null;
  /**
   * Cause/beneficiary detail (Budgeting Page Restructure — folds in B-31:
   * line items on the printable/mailed budget). null = lump-sum category,
   * never broken down by cause.
   */
  causeLines: PrintCauseLine[] | null;
  /** Budget Star & Notes (DECISION-057). Star renders as a "★ " prefix on
   *  the category name; note renders as a compact italic line directly
   *  under the row, only when non-empty. */
  starred: boolean;
  note: string | null;
}

interface PrintFund {
  fundId: string;
  fundName: string;
  budgetEditorLines: PrintLine[];
}

interface PrintableFund {
  fund: PrintFund;
  sums: { incomeCents: number; expenseCents: number };
  openingCents: number;
}

/**
 * Board-presentation / mailed-review budget document (B-31, folded into the
 * Budgeting Overview/Drill-Down Restructure). Rebuilt from the original
 * live-meeting annotation sheet ("Budget Worksheet" — category grain, blank
 * ruled lines, no totals, no balances) into a single, clean, mailable
 * document per Chris's Locked Decisions (docs/work-log/2026-07-30-printable-
 * budget-b31.md): a one-page all-funds Consolidated Summary ahead of
 * page-broken per-fund detail sections carrying Income/Expense Total rows, a
 * Net Surplus/(Deficit) line, and Beginning/Projected-Ending balance blocks,
 * plus a three-state DRAFT/APPROVED/Reopened-for-Amendment status stamp and
 * a reconciliation-completeness footnote.
 *
 * `hidden print:block` — invisible on screen, shown only when the treasurer
 * clicks "Print / Save as PDF" and the browser's print dialog opens over
 * this markup instead of the interactive editor (which is wrapped in
 * `print:hidden` by the parent page).
 *
 * Deliberately a static snapshot built from server-fetched props — NOT any
 * live client input — so print never reflects an in-progress, unsaved edit.
 *
 * Totals/balances are computed via computeFundPlanSums (src/lib/ledger.ts,
 * DECISION-060) — the SAME shared function BudgetOverviewTable calls on the
 * SAME fund data, so the on-screen summary and this printed document can
 * never structurally disagree.
 */
export default function BudgetPrintWorksheet({
  entityName,
  priorFY,
  targetFY,
  funds,
  locked,
  approval,
  openingCentsByFundId,
  juneNotReconciled,
  budgetNotes,
}: {
  entityName: string;
  priorFY: number;
  targetFY: number;
  funds: PrintFund[];
  locked: boolean;
  approval: BudgetApprovalSummary | null;
  openingCentsByFundId: Record<string, number>;
  juneNotReconciled: boolean;
  budgetNotes: string | null;
}) {
  // Computed once, top-level: every fund's committed sums + opening balance,
  // filtered to funds with at least one LIVE (non-pending-delete) income or
  // expense line — the same predicate the per-fund section used to apply on
  // its own, pulled up here so the Consolidated Summary and the per-fund
  // detail sections can never disagree about which funds are "in" this
  // printout (zero-budget funds omitted, as before — Locked Decision).
  const printableFunds: PrintableFund[] = funds
    .map((fund) => ({
      fund,
      sums: computeFundPlanSums(fund.budgetEditorLines),
      openingCents: openingCentsByFundId[fund.fundId] ?? 0,
    }))
    .filter((pf) =>
      pf.fund.budgetEditorLines.some((l) => l.pendingDeleteAt === null),
    );

  return (
    <div className="hidden print:block text-gray-900">
      <DocumentHeader
        entityName={entityName}
        priorFY={priorFY}
        targetFY={targetFY}
        locked={locked}
        approval={approval}
      />

      <ConsolidatedSummary
        printableFunds={printableFunds}
        targetFY={targetFY}
        juneNotReconciled={juneNotReconciled}
      />

      {budgetNotes && (
        <div className="mb-8 break-inside-avoid-page">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 border-b border-gray-300 pb-1 mb-2">
            Notes &amp; Assumptions
          </h2>
          <RichMarkdownContent className="text-gray-900">{budgetNotes}</RichMarkdownContent>
        </div>
      )}

      {printableFunds.map((pf) => (
        <FundWorksheet key={pf.fund.fundId} pf={pf} priorFY={priorFY} targetFY={targetFY} />
      ))}
    </div>
  );
}

function DocumentHeader({
  entityName,
  priorFY,
  targetFY,
  locked,
  approval,
}: {
  entityName: string;
  priorFY: number;
  targetFY: number;
  locked: boolean;
  approval: BudgetApprovalSummary | null;
}) {
  // Three-state status stamp: `locked` can be false even when `approval` is
  // non-null (a budget approved once, then unlocked to amend) — a bare
  // "DRAFT" in that case would misleadingly suggest it was never approved.
  let statusNode: React.ReactNode;
  if (locked) {
    statusNode = (
      <p className="font-semibold">
        APPROVED — adopted {approval?.approvedAtLabel ?? "—"}
        {approval?.boardMinute ? `, board minute: ${approval.boardMinute}` : ""}.
      </p>
    );
  } else if (approval) {
    statusNode = (
      <>
        <p className="font-semibold">DRAFT — Reopened for Amendment</p>
        <p className="mt-1 text-xs font-normal">
          Previously approved {approval.approvedAtLabel ?? "—"}; reopened{" "}
          {approval.unlockedAtLabel ?? "—"} by {approval.unlockedByName ?? "Unknown"}
          {approval.unlockReason ? `: "${approval.unlockReason}"` : ""}.
        </p>
      </>
    );
  } else {
    statusNode = <p className="font-semibold">DRAFT — Not Yet Approved by the Board</p>;
  }

  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold">
        {entityName} — Annual Operating Budget, FY{targetFY}
      </h1>
      <p className="text-sm text-gray-600 mt-1">
        FY{targetFY} budget &bull; prior-year reference: FY{priorFY}
      </p>
      <div className="mt-3 border-2 border-gray-900 rounded px-3 py-2 text-sm inline-block">
        {statusNode}
      </div>
    </div>
  );
}

function ConsolidatedSummary({
  printableFunds,
  targetFY,
  juneNotReconciled,
}: {
  printableFunds: PrintableFund[];
  targetFY: number;
  juneNotReconciled: boolean;
}) {
  const totals = printableFunds.reduce(
    (acc, pf) => {
      const netCents = pf.sums.incomeCents - pf.sums.expenseCents;
      return {
        openingCents: acc.openingCents + pf.openingCents,
        incomeCents: acc.incomeCents + pf.sums.incomeCents,
        expenseCents: acc.expenseCents + pf.sums.expenseCents,
        netCents: acc.netCents + netCents,
        endingCents: acc.endingCents + pf.openingCents + netCents,
      };
    },
    { openingCents: 0, incomeCents: 0, expenseCents: 0, netCents: 0, endingCents: 0 },
  );

  return (
    <div className="mb-8 break-inside-avoid-page">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th colSpan={6} className="text-left text-xs uppercase tracking-wide text-gray-500 pb-1">
              Consolidated Summary
            </th>
          </tr>
          <tr className="border-b-2 border-gray-900">
            <th className="text-left py-1 pr-2 font-semibold">Fund</th>
            <th className="text-right py-1 px-2 font-semibold">Beginning Balance (7/1)</th>
            <th className="text-right py-1 px-2 font-semibold">Budgeted Income</th>
            <th className="text-right py-1 px-2 font-semibold">Budgeted Expense</th>
            <th className="text-right py-1 px-2 font-semibold">Net Surplus/(Deficit)</th>
            <th className="text-right py-1 pl-2 font-semibold">Projected Ending Balance (6/30)</th>
          </tr>
        </thead>
        <tbody>
          {printableFunds.map((pf) => {
            const netCents = pf.sums.incomeCents - pf.sums.expenseCents;
            const endingCents = pf.openingCents + netCents;
            return (
              <tr key={pf.fund.fundId} className="border-b border-gray-300">
                <td className="py-1 pr-2">{pf.fund.fundName}</td>
                <td className="text-right py-1 px-2 tabular-nums">
                  {formatBudgetReferenceCents(pf.openingCents)}
                </td>
                <td className="text-right py-1 px-2 tabular-nums">
                  {formatBudgetReferenceCents(pf.sums.incomeCents)}
                </td>
                <td className="text-right py-1 px-2 tabular-nums">
                  {formatBudgetReferenceCents(pf.sums.expenseCents)}
                </td>
                <td className="text-right py-1 px-2 tabular-nums">
                  {formatBudgetReferenceCents(netCents)}
                </td>
                <td className="text-right py-1 pl-2 tabular-nums font-semibold">
                  {formatBudgetReferenceCents(endingCents)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-gray-900 font-bold">
            <td className="py-1.5 pr-2">All Funds</td>
            <td className="text-right py-1.5 px-2 tabular-nums">
              {formatBudgetReferenceCents(totals.openingCents)}
            </td>
            <td className="text-right py-1.5 px-2 tabular-nums">
              {formatBudgetReferenceCents(totals.incomeCents)}
            </td>
            <td className="text-right py-1.5 px-2 tabular-nums">
              {formatBudgetReferenceCents(totals.expenseCents)}
            </td>
            <td className="text-right py-1.5 px-2 tabular-nums">
              {formatBudgetReferenceCents(totals.netCents)}
            </td>
            <td className="text-right py-1.5 pl-2 tabular-nums">
              {formatBudgetReferenceCents(totals.endingCents)}
            </td>
          </tr>
        </tbody>
      </table>
      {juneNotReconciled && (
        <p className="mt-2 text-xs italic text-gray-500">
          Beginning balances above reflect posted transactions through June 30, {targetFY};
          reconciliation for that period is not yet complete, and these figures may still change
          before it closes.
        </p>
      )}
    </div>
  );
}

function FundWorksheet({
  pf,
  priorFY,
  targetFY,
}: {
  pf: PrintableFund;
  priorFY: number;
  targetFY: number;
}) {
  const income = pf.fund.budgetEditorLines.filter(
    (l) => l.flow === "income" && l.pendingDeleteAt === null,
  );
  const expense = pf.fund.budgetEditorLines.filter(
    (l) => l.flow === "expense" && l.pendingDeleteAt === null,
  );
  const netCents = pf.sums.incomeCents - pf.sums.expenseCents;
  const endingCents = pf.openingCents + netCents;

  return (
    <section className="mb-8 break-before-page">
      <h2 className="text-lg font-semibold border-b-2 border-gray-900 pb-1 mb-2">
        {pf.fund.fundName}
      </h2>
      <p className="text-sm mb-4">
        Beginning Fund Balance, July 1, FY{targetFY}:{" "}
        <span className="font-semibold">{formatBudgetReferenceCents(pf.openingCents)}</span>
      </p>

      {income.length > 0 && (
        <FlowTable
          title="Income"
          lines={income}
          priorFY={priorFY}
          targetFY={targetFY}
          totalCents={pf.sums.incomeCents}
        />
      )}
      {expense.length > 0 && (
        <FlowTable
          title="Expense"
          lines={expense}
          priorFY={priorFY}
          targetFY={targetFY}
          totalCents={pf.sums.expenseCents}
        />
      )}

      <p className="text-sm mt-4">
        Net Surplus/(Deficit): <span className="font-semibold">{formatBudgetReferenceCents(netCents)}</span>
      </p>
      <p className="text-sm mt-1">
        Projected Ending Balance, June 30, FY{targetFY}:{" "}
        <span className="font-semibold">{formatBudgetReferenceCents(endingCents)}</span>
      </p>
    </section>
  );
}

function FlowTable({
  title,
  lines,
  priorFY,
  targetFY,
  totalCents,
}: {
  title: string;
  lines: PrintLine[];
  priorFY: number;
  targetFY: number;
  totalCents: number;
}) {
  // Total row extends the Prior Budget/Prior Actual columns too — nulls
  // treated as 0 for the sum (a per-line "—" is legitimately "no data for
  // that one line," but a TOTAL that silently drops missing lines instead of
  // zero-filling them would understate the prior-year comparison).
  const priorBudgetTotalCents = lines.reduce((sum, l) => sum + (l.priorBudgetCents ?? 0), 0);
  const priorActualTotalCents = lines.reduce((sum, l) => sum + (l.priorActualCents ?? 0), 0);

  return (
    <table className="w-full text-sm mb-6 border-collapse">
      <thead>
        <tr>
          <th colSpan={4} className="text-left text-xs uppercase tracking-wide text-gray-500 pb-1">
            {title}
          </th>
        </tr>
        <tr className="border-b border-gray-800">
          <th className="text-left py-1 pr-2 font-semibold">Category</th>
          <th className="text-right py-1 px-2 font-semibold w-28">Prior Budget (FY{priorFY})</th>
          <th className="text-right py-1 px-2 font-semibold w-28">Prior Actual (FY{priorFY})</th>
          <th className="text-right py-1 pl-2 font-semibold w-28">New Budget (FY{targetFY})</th>
        </tr>
      </thead>
      {lines.map((line) => {
        const liveCauseLines = (line.causeLines ?? []).filter((cl) =>
          isCauseLineLive(cl.pendingDeleteAt ?? null, line.pendingDeleteAt),
        );
        const causeGroups = new Map<string, PrintCauseLine[]>();
        for (const cl of liveCauseLines) {
          const bucket = causeGroups.get(cl.cause);
          if (bucket) bucket.push(cl);
          else causeGroups.set(cl.cause, [cl]);
        }

        return (
          <tbody key={line.categoryId} className="break-inside-avoid-page">
            <tr className="border-b border-gray-400">
              <td className="py-1.5 pr-2 font-medium">
                {line.starred ? "★ " : ""}
                {line.categoryName}
              </td>
              <td className="text-right py-1.5 px-2 tabular-nums text-gray-600">
                {formatBudgetReferenceCents(line.priorBudgetCents)}
              </td>
              <td className="text-right py-1.5 px-2 tabular-nums text-gray-600">
                {formatBudgetReferenceCents(line.priorActualCents)}
              </td>
              <td className="text-right py-1.5 pl-2 tabular-nums font-semibold">
                {formatBudgetReferenceCents(line.budgetCents)}
              </td>
            </tr>
            {line.note && (
              <tr className="border-b border-gray-200">
                <td colSpan={4} className="py-0.5 pl-4 text-xs italic text-gray-500">
                  Note: {line.note}
                </td>
              </tr>
            )}
            {Array.from(causeGroups.entries()).map(([cause, causeLines]) => {
              const subtotalCents = sumBudgetCauseLines(causeLines);
              return (
                <Fragment key={`${line.categoryId}-${cause}`}>
                  <tr className="border-b border-gray-200">
                    <td className="py-1 pr-2 pl-4 text-xs font-semibold text-gray-700" colSpan={3}>
                      {cause}
                    </td>
                    <td className="text-right py-1 pl-2 tabular-nums text-xs font-semibold text-gray-700">
                      {formatBudgetReferenceCents(subtotalCents)}
                    </td>
                  </tr>
                  {causeLines.map((cl, i) => (
                    <Fragment key={`${line.categoryId}-${cause}-${i}`}>
                      <tr className="border-b border-gray-100">
                        <td className="py-0.5 pr-2 pl-8 text-xs text-gray-600" colSpan={3}>
                          {cl.starred ? "★ " : ""}
                          {cl.label || "(generic)"}
                        </td>
                        <td className="text-right py-0.5 pl-2 tabular-nums text-xs text-gray-600">
                          {formatBudgetReferenceCents(cl.amountCents)}
                        </td>
                      </tr>
                      {cl.note && (
                        <tr className="border-b border-gray-100">
                          <td colSpan={4} className="py-0.5 pl-10 text-xs italic text-gray-400">
                            Note: {cl.note}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        );
      })}
      <tbody className="break-inside-avoid-page">
        <tr className="border-t-2 border-gray-900 font-bold">
          <td className="py-1.5 pr-2">{title} Total</td>
          <td className="text-right py-1.5 px-2 tabular-nums">
            {formatBudgetReferenceCents(priorBudgetTotalCents)}
          </td>
          <td className="text-right py-1.5 px-2 tabular-nums">
            {formatBudgetReferenceCents(priorActualTotalCents)}
          </td>
          <td className="text-right py-1.5 pl-2 tabular-nums">
            {formatBudgetReferenceCents(totalCents)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

import { formatBudgetReferenceCents } from "@/lib/ledger";

interface PrintLine {
  categoryId: string;
  categoryName: string;
  flow: "income" | "expense";
  budgetCents: number | null;
  priorBudgetCents: number | null;
  priorActualCents: number | null;
  /**
   * Soft-delete/restore-until-finalize (Increment 2, DECISION-052/053).
   * Non-null lines are excluded entirely from the printout (see FlowTable)
   * — the worksheet is a forward-looking plan of the budget that will
   * actually take effect, and a line already marked for removal isn't part
   * of that plan.
   */
  pendingDeleteAt: string | null;
}

interface PrintFund {
  fundId: string;
  fundName: string;
  budgetEditorLines: PrintLine[];
}

/**
 * Print-only budget worksheet (2026-07-28-budgeting-page-redesign,
 * Increment 1, MUST-HAVE for the 2026-07-28 budget meeting). `hidden
 * print:block` — invisible on screen, shown only when the treasurer clicks
 * "Print / Save as PDF" (PrintBudgetButton) and the browser's print dialog
 * opens over this markup instead of the interactive GuidedBudgetSetup UI
 * (which is wrapped in `print:hidden` by the parent page).
 *
 * Deliberately a static snapshot built from server-fetched props — NOT the
 * live BudgetEditor `<input>` values — per Phase 1's recommendation (render
 * the current input's value as static text, not a live control, in print).
 * A treasurer who wants the printout to reflect an in-progress edit should
 * let it save (blur/Enter) first, same as any other BudgetEditor consumer.
 *
 * Each category prints with ~2 blank ruled lines for hand-written
 * additions/subtractions, grouped in its own `<tbody>` with
 * `break-inside-avoid-page` so a category and its blank lines never split
 * across a page boundary (Phase 1 gap note: print pagination).
 *
 * Pending-delete lines (Increment 2, DECISION-052/053) are excluded entirely
 * — see FlowTable's filter. A line marked for removal isn't part of the
 * forward-looking plan this worksheet exists to print and hand-annotate.
 */
export default function BudgetPrintWorksheet({
  entityName,
  priorFY,
  targetFY,
  funds,
}: {
  entityName: string;
  priorFY: number;
  targetFY: number;
  funds: PrintFund[];
}) {
  return (
    <div className="hidden print:block text-gray-900">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{entityName} — Budget Worksheet</h1>
        <p className="text-sm text-gray-600 mt-1">
          FY{targetFY} budget &bull; prior-year reference: FY{priorFY}
        </p>
      </div>

      {funds.map((fund) => (
        <FundWorksheet key={fund.fundId} fund={fund} priorFY={priorFY} targetFY={targetFY} />
      ))}
    </div>
  );
}

function FundWorksheet({
  fund,
  priorFY,
  targetFY,
}: {
  fund: PrintFund;
  priorFY: number;
  targetFY: number;
}) {
  // Pending-delete lines (Increment 2, DECISION-052/053) are excluded before
  // the empty-check below, so a fund whose only lines are all marked for
  // removal is omitted entirely — same "nothing to print" behavior this
  // check already gave a fund with zero budget lines at all.
  const income = fund.budgetEditorLines.filter(
    (l) => l.flow === "income" && l.pendingDeleteAt === null,
  );
  const expense = fund.budgetEditorLines.filter(
    (l) => l.flow === "expense" && l.pendingDeleteAt === null,
  );

  if (income.length === 0 && expense.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold border-b-2 border-gray-900 pb-1 mb-3">
        {fund.fundName}
      </h2>
      {income.length > 0 && (
        <FlowTable title="Income" lines={income} priorFY={priorFY} targetFY={targetFY} />
      )}
      {expense.length > 0 && (
        <FlowTable title="Expense" lines={expense} priorFY={priorFY} targetFY={targetFY} />
      )}
    </section>
  );
}

function FlowTable({
  title,
  lines,
  priorFY,
  targetFY,
}: {
  title: string;
  lines: PrintLine[];
  priorFY: number;
  targetFY: number;
}) {
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
      {lines.map((line) => (
        <tbody key={line.categoryId} className="break-inside-avoid-page">
          <tr className="border-b border-gray-400">
            <td className="py-1.5 pr-2 font-medium">{line.categoryName}</td>
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
          {/* Spare hand-annotation lines — ~2 per category, per treasurer request. */}
          <tr className="border-b border-dotted border-gray-300">
            <td colSpan={4} className="h-7">
              &nbsp;
            </td>
          </tr>
          <tr className="border-b border-dotted border-gray-300">
            <td colSpan={4} className="h-7">
              &nbsp;
            </td>
          </tr>
        </tbody>
      ))}
    </table>
  );
}

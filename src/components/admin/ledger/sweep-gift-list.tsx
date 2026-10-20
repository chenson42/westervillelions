import type { ReactNode } from "react";
import type { SweepCandidateRow } from "@/lib/ledger-sweep";
import { formatSweepDate, formatSweepMoney } from "./sweep-builder-logic";

export interface SweepGiftListItem {
  row: SweepCandidateRow;
  /** Extra line under the gift, such as the reason it is held back. */
  note?: string;
  /** Right-hand action, such as Unmark. */
  action?: ReactNode;
}

interface SweepGiftListProps {
  items: SweepGiftListItem[];
  caption: string;
  /** When set, each row has a checkbox. */
  selection?: { selected: ReadonlySet<string>; onToggle: (sourceId: string) => void; idPrefix: string };
  /** Show the "goes to {Foundation category}" column. */
  showDestination?: boolean;
}

/**
 * One list of gifts: cards below `xl`, a table at `xl` and wider, from a single
 * set of elements (so a checkbox exists once and keeps one id). The table
 * display classes switch at `xl` because the admin sidebar leaves a wide table
 * clipped until 1280px.
 */
export default function SweepGiftList({ items, caption, selection, showDestination = true }: SweepGiftListProps) {
  return (
    <table className="block xl:table w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="hidden xl:table-header-group bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
        <tr>
          <th scope="col" className="px-4 py-3">Gift</th>
          <th scope="col" className="px-4 py-3">Date</th>
          <th scope="col" className="px-4 py-3">Category</th>
          {showDestination && <th scope="col" className="px-4 py-3">Goes to</th>}
          <th scope="col" className="px-4 py-3 text-right">Amount</th>
        </tr>
      </thead>
      <tbody className="block xl:table-row-group space-y-3 xl:space-y-0 xl:divide-y xl:divide-gray-100">
        {items.map(({ row, note, action }) => {
          const payer = row.party?.trim() || "No payer recorded";
          const checkboxId = selection ? `${selection.idPrefix}-${row.sourceId}` : undefined;
          return (
            <tr
              key={row.sourceId}
              className="block xl:table-row rounded-2xl xl:rounded-none border border-gray-200 xl:border-0 bg-white p-3 xl:p-0 shadow-sm xl:shadow-none"
            >
              <td className="block xl:table-cell xl:px-4 xl:py-2 align-top">
                {selection ? (
                  <label htmlFor={checkboxId} className="flex items-center gap-3 min-h-[44px] cursor-pointer">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      checked={selection.selected.has(row.sourceId)}
                      onChange={() => selection.onToggle(row.sourceId)}
                      className="h-5 w-5 shrink-0 rounded border-gray-300 text-lions-blue focus:outline-none focus:ring-2 focus:ring-lions-blue"
                    />
                    <span className="font-medium text-gray-900 break-words">{payer}</span>
                  </label>
                ) : (
                  <span className="font-medium text-gray-900 break-words">{payer}</span>
                )}
                {!row.hasDonor && (
                  <span className="block text-xs text-gray-500 xl:ml-8">No donor record</span>
                )}
                {note && <p className="mt-1 text-xs text-gray-700 xl:ml-8 max-w-prose">{note}</p>}
              </td>
              <td className="block xl:table-cell xl:px-4 xl:py-2 text-gray-600 align-top">
                <span className="xl:hidden text-gray-500">Gift date: </span>
                {formatSweepDate(row.giftDate)}
              </td>
              <td className="block xl:table-cell xl:px-4 xl:py-2 text-gray-600 align-top">
                <span className="xl:hidden text-gray-500">Category: </span>
                {row.categoryName ?? "None"}
              </td>
              {showDestination && (
                <td className="block xl:table-cell xl:px-4 xl:py-2 text-gray-600 align-top">
                  <span className="xl:hidden text-gray-500">Goes to: </span>
                  {row.foundationCategoryName ?? "No Foundation category"}
                </td>
              )}
              <td className="block xl:table-cell xl:px-4 xl:py-2 xl:text-right font-semibold text-gray-900 tabular-nums align-top">
                {formatSweepMoney(row.amountCents)}
                {action && <div className="mt-1 xl:text-right">{action}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

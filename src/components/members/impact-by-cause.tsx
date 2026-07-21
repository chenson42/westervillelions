"use client";

import { useState } from "react";
import type { PhilanthropyByCause } from "@/lib/ledger-queries";

interface ImpactByCauseProps {
  /** All-time cause breakdown — shown when the "All" pill is selected. */
  allTime: PhilanthropyByCause[];
  /** Per-fiscal-year cause breakdowns, keyed by fiscal-year start-year. Has
   *  an entry (possibly []) for every year in `fixedFiscalYears` and
   *  `moreFiscalYears`. */
  byCauseByFy: Record<number, PhilanthropyByCause[]>;
  /** Always-visible fiscal-year pills, most recent first (current FY, then
   *  up to 2 prior FYs — never earlier than the earliest FY with data). */
  fixedFiscalYears: number[];
  /** Older data-bearing fiscal years, most recent first, revealed behind the
   *  "More" pill. Empty when there's nothing older to show. */
  moreFiscalYears: number[];
  /** The current fiscal year — pre-selected on load. */
  currentFiscalYear: number;
}

function formatDollarsWhole(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/** Short pill label, e.g. fyPillLabel(2026) → "FY2026–27". */
function fyPillLabel(fy: number): string {
  return `FY${fy}–${String(fy + 1).slice(-2)}`;
}

/**
 * Client-side FY filter for the "Giving by Cause" section of /members/impact.
 * All data (all-time + every data-bearing fiscal year) is computed
 * server-side in getPhilanthropy() and handed down as props. Which years
 * render as fixed pills vs. behind "More" is decided server-side by
 * deriveCauseFyPills() (src/lib/fiscal-year.ts); switching pills and
 * revealing "More" are both local useState swaps with no server round-trip.
 */
export default function ImpactByCause({
  allTime,
  byCauseByFy,
  fixedFiscalYears,
  moreFiscalYears,
  currentFiscalYear,
}: ImpactByCauseProps) {
  const [selected, setSelected] = useState<"all" | number>(currentFiscalYear);
  const [showMore, setShowMore] = useState(false);

  const allPillYears = [...fixedFiscalYears, ...moreFiscalYears];
  if (allTime.length === 0 && allPillYears.every((fy) => (byCauseByFy[fy] ?? []).length === 0)) {
    return null;
  }

  const visibleFiscalYears = showMore ? allPillYears : fixedFiscalYears;
  const activeList = selected === "all" ? allTime : byCauseByFy[selected] ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900 mb-3">Giving by Cause</h3>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSelected("all")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
              selected === "all"
                ? "bg-lions-blue text-white"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            All
          </button>
          {visibleFiscalYears.map((fy) => (
            <button
              key={fy}
              type="button"
              onClick={() => setSelected(fy)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition min-h-[44px] focus:outline-none focus:ring-2 focus:ring-lions-blue ${
                selected === fy
                  ? "bg-lions-blue text-white"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {fyPillLabel(fy)}
            </button>
          ))}
          {!showMore && moreFiscalYears.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition min-h-[44px] border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-lions-blue"
            >
              More
            </button>
          )}
        </div>
      </div>

      {activeList.length === 0 ? (
        <div className="px-6 py-8 text-center text-gray-500 text-sm">
          <p>No giving recorded yet this fiscal year.</p>
          {selected !== "all" && (
            <button
              type="button"
              onClick={() => setSelected("all")}
              className="mt-2 text-sm font-semibold text-lions-blue hover:text-lions-blue-dark hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded"
            >
              View All giving instead
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-50 px-6 py-2">
          {activeList.map((cause) => (
            <li key={cause.causeKey || "__other__"} className="py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className="text-sm text-gray-800 truncate max-w-[60%]"
                  title={cause.causeLabel}
                >
                  {cause.causeLabel}
                </span>
                <div className="flex items-center gap-3 ml-2 shrink-0">
                  <span className="text-xs text-gray-500">{cause.pct}%</span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatDollarsWhole(cause.totalCents)}
                  </span>
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-sm h-2.5">
                <div
                  className="bg-lions-blue h-2.5 rounded-sm"
                  style={{ width: `${Math.max(cause.pct, 2)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { fiscalYearLabel } from "@/lib/fiscal-year";

interface FiscalYearSelectorProps {
  fiscalYears: number[];
  currentFY: number | "all";
  /** Extra params to preserve (e.g. entity=) when changing FY */
  basePath: string;
  /**
   * When true, renders an extra "All Years" option (value="all") above the
   * year list. Additive — omitted (the default) leaves every existing call
   * site unchanged. Added for the Unlinked Gifts worklist
   * (docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md), whose
   * page is responsible for translating the "all" param value to
   * `fiscalYear: undefined` before calling its query — this component only
   * emits the string.
   */
  allowAll?: boolean;
}

/**
 * Dropdown selector for the active fiscal year.
 * Navigates to basePath with updated ?fy= param.
 * Always includes currentFY in the list even if no transactions exist.
 */
export default function FiscalYearSelector({
  fiscalYears,
  currentFY,
  basePath,
  allowAll,
}: FiscalYearSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Ensure currentFY is in the list (the "all" sentinel is rendered as its
  // own option below, never mixed into the numeric year list).
  const years =
    currentFY === "all" || fiscalYears.includes(currentFY)
      ? fiscalYears
      : [currentFY, ...fiscalYears].sort((a, b) => b - a);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("fy", e.target.value);
    router.push(`${basePath}?${params}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        htmlFor="ledger-fy-selector"
        className="text-sm font-medium text-gray-700 whitespace-nowrap"
      >
        Fiscal Year
      </label>
      <select
        id="ledger-fy-selector"
        value={currentFY}
        onChange={handleChange}
        className="rounded-md border border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
      >
        {allowAll && <option value="all">All Years</option>}
        {years.map((fy) => (
          <option key={fy} value={fy}>
            {fiscalYearLabel(fy)}
          </option>
        ))}
      </select>
    </div>
  );
}

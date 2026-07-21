"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { fiscalYearLabel } from "@/lib/fiscal-year";

interface FiscalYearSelectorProps {
  fiscalYears: number[];
  currentFY: number;
  /** Extra params to preserve (e.g. entity=) when changing FY */
  basePath: string;
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
}: FiscalYearSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Ensure currentFY is in the list
  const years = fiscalYears.includes(currentFY)
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
        {years.map((fy) => (
          <option key={fy} value={fy}>
            {fiscalYearLabel(fy)}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { fiscalYearLabel } from "@/lib/dues";

interface DuesYearSelectorProps {
  knownFiscalYears: number[];
  currentFY: number;
  basePath: string;
  /** Extra search params to preserve (e.g. status, search) */
  extraParams?: Record<string, string>;
}

/**
 * Fiscal-year selector for the admin dues list and member self-view pages.
 * On change, navigates to the same path with fy= updated.
 */
export default function DuesYearSelector({
  knownFiscalYears,
  currentFY,
  basePath,
  extraParams = {},
}: DuesYearSelectorProps) {
  const router = useRouter();

  // Always include the current FY in the list even if there are no records yet
  const years = knownFiscalYears.includes(currentFY)
    ? knownFiscalYears
    : [currentFY, ...knownFiscalYears];

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams({ ...extraParams, fy: e.target.value });
    router.push(`${basePath}?${params}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="dues-fy-selector"
        className="text-sm font-medium text-gray-700 whitespace-nowrap"
      >
        Fiscal Year
      </label>
      <select
        id="dues-fy-selector"
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

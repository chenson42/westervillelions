"use client";

import { useRouter } from "next/navigation";
import type { MonthOption } from "@/lib/financial-report-ui";

export type FinancialReportEntityOption = {
  slug: string;
  label: string;
  months: MonthOption[];
};

interface FinancialReportPickerProps {
  entities: FinancialReportEntityOption[];
  currentEntitySlug: string;
  currentMonth: string;
}

/**
 * Client leaf: entity + month <select> pair, navigating to
 * /members/financial-reports/[entitySlug]/[month] on change — same
 * immediate-navigate convention as the admin FiscalYearSelector (no
 * separate "Go" button). Used on both the landing page (jump to any
 * published month) and the statement detail page (switch entity/month while
 * viewing). Always print:hidden — the printed/saved page shows only the
 * statement itself. See docs/work-log/2026-07-28-monthly-financial-report.md
 * Phase 4 (UI).
 */
export default function FinancialReportPicker({
  entities,
  currentEntitySlug,
  currentMonth,
}: FinancialReportPickerProps) {
  const router = useRouter();
  const currentEntity = entities.find((e) => e.slug === currentEntitySlug) ?? entities[0];

  if (!currentEntity || currentEntity.months.length === 0) return null;

  function handleEntityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const slug = e.target.value;
    const entity = entities.find((en) => en.slug === slug);
    const month = entity?.months[0]?.value;
    if (entity && month) {
      router.push(`/members/financial-reports/${slug}/${month}`);
    }
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/members/financial-reports/${currentEntitySlug}/${e.target.value}`);
  }

  const monthSelectValue = currentEntity.months.some((m) => m.value === currentMonth)
    ? currentMonth
    : (currentEntity.months[0]?.value ?? "");

  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <div className="flex items-center gap-2">
        <label htmlFor="fr-entity-select" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Fund
        </label>
        <select
          id="fr-entity-select"
          value={currentEntity.slug}
          onChange={handleEntityChange}
          className="min-h-[44px] rounded-md border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          {entities.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="fr-month-select" className="text-sm font-medium text-gray-700 whitespace-nowrap">
          Month
        </label>
        <select
          id="fr-month-select"
          value={monthSelectValue}
          onChange={handleMonthChange}
          className="min-h-[44px] rounded-md border border-gray-300 py-2 pl-3 pr-8 text-sm focus:border-lions-blue focus:outline-none focus:ring-1 focus:ring-lions-blue"
        >
          {currentEntity.months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

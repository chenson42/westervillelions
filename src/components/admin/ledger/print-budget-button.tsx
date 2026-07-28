"use client";

/**
 * Client leaf: triggers the browser's native print dialog over the budgeting
 * page's print-only worksheet (BudgetPrintWorksheet). This IS the "Save as
 * PDF" flow — copied from src/components/members/print-statement-button.tsx
 * per the 2026-07-28-budgeting-page-redesign Phase 1/tech-lead brief (no
 * PDF-generation dependency, same pattern already shipped for the member
 * Monthly Statement). print:hidden so the button itself never appears on the
 * printed/saved page.
 */
export default function PrintBudgetButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue print:hidden min-h-[44px]"
    >
      <span aria-hidden="true">🖨️</span>
      Print / Save as PDF
    </button>
  );
}

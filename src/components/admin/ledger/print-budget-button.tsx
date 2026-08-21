"use client";

/**
 * Client leaf: triggers the browser's native print dialog over the budgeting
 * page's print-only worksheet (BudgetPrintWorksheet). This IS the "Save as
 * PDF" flow — copied from src/components/members/print-statement-button.tsx
 * per the 2026-07-28-budgeting-page-redesign Phase 1/tech-lead brief (no
 * PDF-generation dependency, same pattern already shipped for the member
 * Monthly Statement). print:hidden so the button itself never appears on the
 * printed/saved page.
 *
 * The hint below it exists because the browser's default "Headers and
 * footers" print-dialog option (on by default in Chrome/Edge/Safari) prints
 * the page title, date, URL and page number on every sheet — there is no
 * CSS/JS hook to suppress it, only the dialog's own toggle.
 */
export default function PrintBudgetButton() {
  return (
    <div className="flex flex-col items-end print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center gap-2 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue min-h-[44px]"
      >
        <span aria-hidden="true">🖨️</span>
        Print / Save as PDF
      </button>
      <p className="text-xs text-gray-500 mt-1">
        For a cleaner page, uncheck &ldquo;Headers and footers&rdquo; under More settings in the print dialog.
      </p>
    </div>
  );
}

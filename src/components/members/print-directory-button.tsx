"use client";

/**
 * Client leaf: triggers the browser's native print dialog. This IS the
 * "Save as PDF" flow for the printable member directory (Phase 1/3 locked
 * decision — no PDF-generation dependency), mirroring
 * print-statement-button.tsx. print:hidden so the button itself never
 * appears on the printed/saved page.
 *
 * The hint below it exists because the browser's default "Headers and
 * footers" print-dialog option (on by default in Chrome/Edge/Safari) prints
 * the page title, date, URL and page number on every sheet — there is no
 * CSS/JS hook to suppress it, only the dialog's own toggle.
 */
export default function PrintDirectoryButton() {
  return (
    <div className="flex flex-col items-end print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center gap-2 text-lions-blue px-3 py-2 rounded-lg font-semibold hover:bg-lions-blue/5 hover:text-lions-blue-dark transition focus:outline-none focus:ring-2 focus:ring-lions-blue"
      >
        <span aria-hidden="true">🖨️</span>
        Print Directory / Save as PDF
      </button>
      <p className="text-xs text-gray-500 px-3">
        For a cleaner page, uncheck &ldquo;Headers and footers&rdquo; under More settings in the print dialog.
      </p>
    </div>
  );
}

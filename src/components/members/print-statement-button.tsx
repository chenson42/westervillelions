"use client";

/**
 * Client leaf: triggers the browser's native print dialog. This IS the
 * "Save as PDF" flow (locked Phase 1 decision — no PDF-generation
 * dependency). print:hidden so the button itself never appears on the
 * printed/saved page.
 */
export default function PrintStatementButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue print:hidden"
    >
      <span aria-hidden="true">🖨️</span>
      Print / Save as PDF
    </button>
  );
}

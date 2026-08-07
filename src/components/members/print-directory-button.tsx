"use client";

/**
 * Client leaf: triggers the browser's native print dialog. This IS the
 * "Save as PDF" flow for the printable member directory (Phase 1/3 locked
 * decision — no PDF-generation dependency), mirroring
 * print-statement-button.tsx. print:hidden so the button itself never
 * appears on the printed/saved page.
 */
export default function PrintDirectoryButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center justify-center gap-2 border-2 border-lions-blue text-lions-blue px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue/5 transition focus:outline-none focus:ring-2 focus:ring-lions-blue print:hidden"
    >
      <span aria-hidden="true">🖨️</span>
      Print Directory / Save as PDF
    </button>
  );
}

import BudgetNotesMarkdown from "./budget-notes-markdown";

export interface PrintableAcknowledgmentLetter {
  ackId: string;
  donorName: string;
  donorAddress: string;
  letterText: string;
}

/**
 * Print-only acknowledgment-letter batch (Acknowledgment Letter Generation,
 * DECISION-072 §5, 2026-08-08). Reuses the exact `hidden print:block` +
 * always-mounted pattern BudgetPrintWorksheet already established
 * (budget-print-worksheet.tsx) — invisible on screen, shown only when the
 * browser's print stylesheet takes over (triggered by
 * AcknowledgmentLetterSelector's "Print / Save as PDF" button calling
 * window.print()). Always mounted (not generated only on click) so
 * window.print() never races an async render.
 *
 * One <section> per letter, `break-before-page` on every section after the
 * first — the identical Tailwind print utility budget-print-worksheet.tsx:333
 * already uses for its own multi-section document. A 30-letter selection
 * prints as 30 clean pages, one donor per page: today's date, the donor's
 * mailing block, then the full composed letter body rendered through
 * BudgetNotesMarkdown (the SAME renderer the budget notes print surface
 * uses — Markdown-only, no raw HTML passthrough, per DECISION-073's reuse
 * note). No letterhead/logo — out of scope for this increment.
 *
 * This component renders exactly what generateAcknowledgmentLetters()
 * returned/wrote server-side — it never re-composes or re-derives letter
 * text itself.
 */
export default function AcknowledgmentLettersPrint({
  letters,
}: {
  letters: PrintableAcknowledgmentLetter[];
}) {
  const formattedTodayDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="hidden print:block text-gray-900">
      {letters.map((letter, i) => (
        <section key={letter.ackId} className={i === 0 ? "mb-8" : "mb-8 break-before-page"}>
          <p className="text-sm">{formattedTodayDate}</p>
          <p className="mt-4 text-sm whitespace-pre-line">
            {letter.donorName}
            {"\n"}
            {letter.donorAddress}
          </p>
          <div className="mt-6">
            <BudgetNotesMarkdown>{letter.letterText}</BudgetNotesMarkdown>
          </div>
        </section>
      ))}
    </div>
  );
}

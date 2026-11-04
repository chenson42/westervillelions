"use client";

import { BOOK_COPY } from "@/lib/santas-workshop/collage-ui";

// window.print() opens the browser's print dialog; it is not alert/confirm/prompt.
export function BookPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="sw-noprint inline-flex min-h-[44px] items-center justify-center rounded-lg bg-lions-blue px-6 py-3 font-semibold text-white transition hover:bg-lions-blue-dark focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
    >
      {BOOK_COPY.button}
    </button>
  );
}

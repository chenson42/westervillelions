"use client";

import { FAMILY_COPY } from "@/lib/santas-workshop/family-ui";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="sw-noprint inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-lions-blue px-6 py-3 font-semibold text-lions-blue transition hover:bg-lions-blue/5 focus:outline-none focus:ring-2 focus:ring-lions-blue focus:ring-offset-2"
    >
      {FAMILY_COPY.print}
    </button>
  );
}

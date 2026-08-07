"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Shared `?highlight=<id>` deep-link handler (DECISION-062/063,
 * docs/work-log/2026-08-06-ledger-search.md) — owned by search, honored by
 * the register ([fundSlug]/page.tsx) and the budgeting drill-down
 * (budgeting/[fundSlug]/page.tsx). Renders nothing.
 *
 * On mount: if `targetId` is set, look up `${idPrefix}${targetId}` in the
 * DOM. If found, smooth-scroll it into view and flash a temporary gold ring
 * (~2.5s) — never auto-opens the row's edit dialog/editor (Phase 3's
 * explicit "scroll-and-flash only" call). If not found (e.g. the
 * transaction was hard-deleted between search and click), no-op silently —
 * both destination pages already render correctly with or without the row.
 *
 * Either way, strips `highlight` from the URL via router.replace (scroll:
 * false) so a manual refresh of the now-highlight-free URL never re-triggers
 * the effect — the stale-highlight-on-refresh case named in the brief.
 */
export default function RowHighlighter({
  targetId,
  idPrefix,
}: {
  targetId?: string;
  idPrefix: "txn-" | "budget-line-";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!targetId) return;

    const el = document.getElementById(`${idPrefix}${targetId}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-lions-gold", "bg-lions-gold/10");
      timer = setTimeout(() => {
        el.classList.remove("ring-2", "ring-lions-gold", "bg-lions-gold/10");
      }, 2500);
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("highlight");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });

    return () => {
      if (timer) clearTimeout(timer);
    };
    // Only re-run if the target itself changes — searchParams/pathname/router
    // are read once per highlight, not re-triggers (the replace() call above
    // deliberately changes searchParams on its own next render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, idPrefix]);

  return null;
}

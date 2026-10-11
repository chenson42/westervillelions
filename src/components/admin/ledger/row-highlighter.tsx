"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RING_CLASSES = ["ring-2", "ring-lions-gold", "bg-lions-gold/10"] as const;

/** The subset of Document the highlighter uses, so the logic is testable in the node env. */
export interface HighlightDoc {
  getElementById(id: string): HighlightElement | null;
  querySelectorAll(selector: string): ArrayLike<HighlightElement>;
}

export interface HighlightElement {
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  focus(options?: FocusOptions): void;
  getClientRects(): ArrayLike<unknown>;
  classList: { add(...c: string[]): void; remove(...c: string[]): void };
}

/**
 * The first rendered `[data-row-id="<id>"]`. A page that mounts both a table
 * and a card list (the Approvals page) has two matches, one inside a
 * `display: none` ancestor, which has no client rects. Only ever called with a
 * UUID the server already validated; the id is still stripped of quotes.
 */
export function findVisibleRow(doc: HighlightDoc, targetId: string): HighlightElement | null {
  const safe = targetId.replace(/["\\]/g, "");
  const matches = Array.from(doc.querySelectorAll(`[data-row-id="${safe}"]`));
  return matches.find((el) => el.getClientRects().length > 0) ?? null;
}

/**
 * Runs one highlight. Default mode: flash the gold ring for ~2.5s, then strip
 * `highlight` from the URL (`stripHighlight`). Persistent mode (Approvals
 * `?txn=`): the server already rendered the ring, so only scroll and focus the
 * first visible match; no class changes, no URL change. Returns a cleanup.
 */
export function runRowHighlight(opts: {
  doc: HighlightDoc;
  targetId: string;
  idPrefix: string;
  persistent: boolean;
  stripHighlight: () => void;
}): () => void {
  const { doc, targetId, idPrefix, persistent, stripHighlight } = opts;

  if (persistent) {
    const el = findVisibleRow(doc, targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus({ preventScroll: true });
    }
    return () => {};
  }

  const el = doc.getElementById(`${idPrefix}${targetId}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add(...RING_CLASSES);
    timer = setTimeout(() => {
      el.classList.remove(...RING_CLASSES);
    }, 2500);
  }
  stripHighlight();
  return () => {
    if (timer) clearTimeout(timer);
  };
}

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
 *
 * `persistent` mode (Approvals `?txn=`, work-log 2026-10-10-approvals-mobile-and-history):
 * scroll and focus only; see the prop.
 */
export default function RowHighlighter({
  targetId,
  idPrefix,
  persistent = false,
}: {
  targetId?: string;
  idPrefix: "txn-" | "budget-line-";
  /**
   * Approvals `?txn=` mode: the row is server-rendered with its ring, which
   * stays; this only scrolls to and focuses the first visible `data-row-id`
   * match and leaves the URL alone (the banner needs `txn` to survive a
   * refresh).
   */
  persistent?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!targetId) return;
    return runRowHighlight({
      doc: document as unknown as HighlightDoc,
      targetId,
      idPrefix,
      persistent,
      stripHighlight: () => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("highlight");
        const query = params.toString();
        router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
      },
    });
    // Only re-run if the target itself changes: searchParams/pathname/router
    // are read once per highlight, not re-triggers (the replace() call above
    // deliberately changes searchParams on its own next render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, idPrefix, persistent]);

  return null;
}

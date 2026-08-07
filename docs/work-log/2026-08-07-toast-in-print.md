# Toast text appears in printed budgets — Work Log

> **Slug:** `2026-08-07-toast-in-print`
> **Surface:** (dashboard) admin — printable budget worksheet, but the fix is global
> **Permission(s):** none — presentation only
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-08-07 |
| 2 — Architectural review | architect | Skipped | — | 2026-08-07 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-08-07 |
| 4 — Implementation | coordinator | Complete | — | 2026-08-07 |
| 5 — Verification | qa | Partial (see below) | — | 2026-08-07 |
| 6 — Shipped vs intent | analyst | Skipped | — | 2026-08-07 |

**Phases skipped, and why** (CLAUDE.md forbids silent skips): the bug is a one-rule CSS
omission with an unambiguous cause and no behavioural surface — nothing to refine
functionally (1), no structure touched (2), and a design doc would be longer than the fix (3).
Phase 6 is skipped because the "intent" is self-evident: transient toasts must not print.

---

## Report

The treasurer printed a budget and found **"Budget notes saved."** at the top of the printout.

## Root cause

`toast.success("Budget notes saved.")` fires in
`src/components/admin/ledger/budget-notes-editor.tsx:54` after saving Notes & Assumptions.
The sonner toast container is mounted globally as `<Toaster richColors position="top-center" />`
in `src/app/layout.tsx:112`, and **nothing excluded it from print**. Because it is
fixed-position at the top-center of the viewport, a toast still on screen when the treasurer
hits Print is rendered into the page — at the top, above the board-facing worksheet.

This is not specific to the budget worksheet. Any print of any page taken within the toast's
lifetime would have included it; the budget worksheet is simply the one page that is routinely
printed, and saving notes then printing is the natural sequence that exposed it.

## Fix

A single print-media rule in `src/app/globals.css`:

```css
@media print {
  [data-sonner-toaster] { display: none !important; }
}
```

Targeted at sonner's own `data-sonner-toaster` attribute (confirmed emitted by the installed
sonner 2.0.7) rather than at a `className` prop on `<Toaster>`, so it holds regardless of how
the Toaster is later configured, and covers every page rather than just the budget worksheet.

## Reproduction

1. Open `/admin/ledger/budgeting?entity=club&fy=2026`.
2. Edit Notes & Assumptions and save — the "Budget notes saved." toast appears.
3. While it is still visible, print (or Print to PDF) the budget worksheet.
4. **Before:** the toast text appears at the top of the printed page.
   **After:** the printed page contains only the worksheet.

## Verification

- `pnpm exec tsc --noEmit` — PASS.
- `pnpm build:only` — PASS, compiled successfully.
- **Not verified by a real print/PDF render.** This is a CSS-only, print-media change; neither
  the unit suite nor Playwright exercises print stylesheets in this project, and the existing
  `hidden print:block` conventions in `budget-print-worksheet.tsx` are likewise untested. The
  treasurer should confirm on the next print. Recorded here rather than claimed as verified.

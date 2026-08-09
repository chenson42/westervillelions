# View Rendered Email from the Admin Email Queue — Work Log

> **Slug:** `2026-08-09-email-queue-preview`
> **Surface:** (dashboard) admin
> **Permission(s):** existing `admin.users` covers this (same gate as the rest of `/admin/email-queue`)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 skipped (rationale below)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | — | 2026-08-09 |
| 2 — Architectural review | architect | Skipped | — | 2026-08-09 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-08-09 |
| 4 — Implementation | ux-developer | Complete | — | 2026-08-09 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Why Phases 1–3 were skipped

This is a small, fully-specified addition to an existing, already-gated admin page — no new
permission, no new route, no new dependency, no schema change. The requester (treasurer, via the
session orchestrating this work) supplied a complete brief: the exact page and sibling file to
extend, the precise rendering constraint (sandboxed iframe, no `dangerouslySetInnerHTML`, no
`allow-scripts`), the security rationale, the status to make legible, and the open design question
(whether blocked messages should get their own section) with instructions to decide and record the
choice. That brief *is* the Phase 1–3 output — re-deriving it through analyst/architect/tech-lead
would have re-produced the same brief with more overhead. Per CLAUDE.md's "no silent skips" rule,
recording this here explicitly rather than omitting the phases.

If QA or the Phase 6 review surfaces a functional or architectural gap this brief didn't
anticipate, loop back to the appropriate earlier phase per the standard rule (earliest phase where
the failure originated).

---

# Phase 4 — Implementation (UI) — 2026-08-09

**Owner:** ux-developer
**Status:** complete

## Summary

Added a "View" action to every row in the admin Email Queue page (`/admin/email-queue`) that opens
a dialog rendering the queued message's stored HTML inside a sandboxed `<iframe>` (no
`allow-scripts`), alongside recipient, status, and queued timestamp. Added a new "Blocked
(Non-Production)" section to the page — previously `blocked_non_production` messages were queued
but invisible on this page, which showed only `failed` and `sent`. The blocked section uses a
distinct blue treatment (not amber/error) with explanatory copy, since a blocked message means the
guardrail in `src/lib/email.ts` worked as intended, not that something went wrong.

## What I did

- Read `src/lib/email.ts` to confirm the `blocked_non_production` status, its trigger condition, and that `html` is already persisted to `email_queue` before the guardrail check — so no API change is needed to read it back.
- Read the existing `email-queue/page.tsx` and `retry-button.tsx` for the current table/section conventions and status-badge treatment (amber pill on the Failed section header).
- Surveyed existing in-repo dialog usage (`category-rename-dialog.tsx`, `dues-add-payment-button.tsx`, etc.) — this codebase's convention is a feature-local component built directly on `@radix-ui/react-dialog` (not a shared `ui/dialog.tsx` wrapper), matching `ConfirmDialog`'s use of `@radix-ui/react-alert-dialog`. Followed that convention rather than introducing a new shared primitive.
- Extended `page.tsx`'s server query to also select `status = 'blocked_non_production'` (ordered by `createdAt desc`, limit 50) alongside the existing `failed` and `sent` queries.
- Added a "Blocked (Non-Production)" section between Failed and Recently Sent — chose this placement because during local/dev testing (the treasurer's actual context) blocked messages are the ones most likely to need inspection, and burying them below "Recently Sent" would make them the least visible entry on the page in exactly the situation that matters most.
- Added a `ViewEmailDialog` client component (`view-email-dialog.tsx`) that takes `{ to, subject, status, createdAt, html }`, renders a Radix `Dialog.Root` styled per the codebase's dialog convention (`rounded-2xl`, overlay, focus ring on close), and renders the HTML via `<iframe sandbox srcDoc={html} title="Email preview">` with no `allow-scripts` token — so any script tag in stored HTML is inert. Header line shows To / Status pill / Queued timestamp above the iframe.
- Added a small shared `StatusPill` helper (in `view-email-dialog.tsx`, exported for reuse) so the pill styling is defined once: `sent` = green, `failed` = amber, `blocked_non_production` = blue with label "Blocked (not production)".
- Wired a "View" button into each row of all three sections (Failed, Blocked, Recently Sent) — the dialog is generically useful (the brief noted this: nobody has visually verified the minutes-email renderer), so it isn't limited to the blocked section.
- Did not touch `src/lib/email.ts`, `src/lib/email-guardrail.test.ts`, or any send path.
- Did not touch `scripts/`.

## Outputs

- `src/app/(dashboard)/admin/email-queue/page.tsx` — added blocked-messages query, new section, `ViewEmailDialog` wired into all three tables' rows.
- `src/app/(dashboard)/admin/email-queue/view-email-dialog.tsx` — new. Client component: Radix dialog + sandboxed iframe preview + `StatusPill`.
- Decision: blocked messages get their own visible section on this page (not folded into Failed, not left absent). Logged here rather than `docs/decisions.md` since it's page-local UX, not a cross-cutting architectural decision.

## Gates

- `pnpm exec tsc --noEmit`: PASS (clean, exit 0).
- `pnpm test`: PASS — 67 files / 1251 tests passed, exactly matching the reported baseline (1251) with no regression; no concurrent change had moved the count at the time this was run.
- `pnpm build:only`: PASS (exit 0), full production build completed including all existing routes.

No unit tests were added for this change — see note below.

### Why no new tests

Reviewed for a natural test seam per the brief. The only new logic is presentational (JSX,
Tailwind classes, an `<iframe sandbox>` prop) plus a pure label/class lookup table
(`STATUS_LABEL`/`STATUS_CLASS` in `view-email-dialog.tsx`) that has no branching worth unit-testing
beyond what TypeScript's exhaustiveness already guarantees via the `QueuedEmailStatus` union. There
is no server logic, no new query shape beyond swapping a status-literal in an existing
`db.select().from(emailQueue).where(eq(...))` pattern already exercised elsewhere, and no
`email.ts` change — the file under the strictest scrutiny (`email-guardrail.test.ts`) was
untouched. Flagging this explicitly rather than silently skipping tests; qa should decide in Phase
5 whether a Playwright click-through of the dialog (open → iframe renders → close) is warranted
given there's no RTL/jsdom harness in this project for component-level assertions.

### Open questions / handoff notes

- **What a reviewer should click through:** `/admin/email-queue` as an `admin.users`-gated user. Confirm three sections render (Failed / Blocked (Non-Production) / Recently Sent), each row's "View" button opens the dialog, the iframe renders the email's inline-styled HTML with no layout bleed into the admin chrome, and the status pill in the dialog matches the row's section. Trigger a fresh `blocked_non_production` row locally (e.g. exercise the minutes-email flow against `club@`/`board@` in dev) to see the new section populate live, or rely on any pre-existing blocked rows in the dev DB.
- **New copy strings the Lions Club may want to refine:** "Blocked (Non-Production)" section heading; explanatory line "These messages were withheld because this isn't the production environment — nothing was sent."; pill label "Blocked (not production)".
- **UX decisions / tradeoffs:**
  - Blocked section placed second (between Failed and Recently Sent), not last, per the reasoning above — open to reordering if the treasurer disagrees.
  - `html` is already loaded into the page's server-rendered payload (the existing `.select()` calls select all columns, `html` included) — the dialog receives it as a prop rather than lazy-fetching from a new API route on open. This keeps the change UI-only with no new endpoint, appropriate for a small, well-scoped preview feature; if queued HTML payloads grow large enough to bloat the page (unlikely for club emails), a follow-up could lazy-load via an API route instead.
  - Reused the amber-pill visual language for `failed` (unchanged) but deliberately used blue, not amber/red, for `blocked_non_production` so it doesn't read as an error — this directly answers the brief's requirement to make the status "legible" as intentional, not broken.
- **Next agent:** qa (Phase 5) — please run the standard gates and manually click through the flow above. Phase 6 (analyst, shipped-vs-intent) follows after QA passes; since Phase 1 was skipped, Phase 6 should compare shipped behavior against this work-log's Phase 4 summary and the original brief rather than a separate Phase 1 document.

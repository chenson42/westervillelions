# ESLint Warning Cleanup — Work Log

> **Slug:** `2026-09-10-eslint-warning-cleanup`
> **Surface:** mixed (admin, member portal, API routes, scripts, tests)
> **Permission(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | fix doesn't touch invariants — mechanical lint cleanup | 2026-09-10 |
| 2 — Architectural review | architect | Skipped | no structural changes | 2026-09-10 |
| 3 — Technical design | tech-lead | Skipped | trivial per-file fixes; root causes documented below | 2026-09-10 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-09-10 |
| 5 — Verification | qa | Not started | — | — |
| 6 — Shipped vs intent | analyst | Not started | — | — |

---

## Root cause

The lint gate had been crashing outright for a period and was only just restored
(`eslint.config.mjs` — separately fixed, ignores generated output and honors the `^_`
"deliberately unused" convention). 33 `@typescript-eslint/no-unused-vars` /
`@next/next/no-img-element` / stale-`eslint-disable` warnings accumulated unseen in
application code during that window.

## Reproduction

`pnpm lint` on `main` at the start of this task: 0 errors, 33 warnings.

## Phase 4 — Implementation (full-stack) — 2026-09-10

**Owner:** full-stack-developer
**Status:** complete

### Summary

Cleared 32 of the 33 warnings: deleted genuinely-dead imports/bindings in ~20 files,
converted two unused catch bindings to optional-catch syntax, fixed a misplaced
`eslint-disable` in the image cropper, wired up a dead `isSaving` state pair in the
permissions matrix (a real missing-loading-indicator bug), fixed a dropped date-format
call in the ack queue (a real display bug), removed dead code in `mark-sent-dialog.tsx`
and `ledger-queries.ts` (confirmed not a dropped bug in either case), and confirmed
`next-auth.d.ts`'s `NextAuth` import is safely removable (module augmentation still
typechecks via the remaining `DefaultSession` import). One warning is deliberately left
in place — see below.

### What I did

- Deleted straightforward dead imports/vars in: `scripts/create-test-user.mjs`,
  `scripts/port-ledger-dev-to-prod.ts`, `admin/membership/page.tsx`,
  `admin/permissions/page.tsx` (import + dead `key` local var — confirmed not a dropped
  React key or Map key, just unused), `admin/proposals/[id]/page.tsx`, `admin/roles/page.tsx`,
  `admin/social-requests/[id]/page.tsx`, `api/admin/groups/[id]/route.ts`,
  `api/admin/ledger/transactions/[id]/acknowledge/route.ts`,
  `api/events/[id]/viewer-context/route.ts`, `api/members/reimbursements/route.ts`,
  `components/admin/dues-status-filter.tsx`, `components/admin/ledger/reject-dialog.tsx`,
  `lib/permissions-server.ts`, and test files `lib/dues-ledger-sync.test.ts`,
  `lib/ledger-queries.test.ts`, `lib/receipt-storage/receipt-storage.test.ts`.
- Converted unused `catch (error)` to `catch {` in `forgot-password/page.tsx` and
  `permissions-matrix.tsx` (matches the project's existing style; no other catch blocks
  nearby to match against).
- **`image-cropper.tsx`**: moved a misplaced `eslint-disable-next-line
  @next/next/no-img-element` from a wrapping `<div>` onto the actual `<img>` element one
  line below, with a comment stating the `<img>` is deliberate (client-side blob/data URL
  preview, not an optimizable static asset). No conversion to `next/image` — not
  appropriate here.
- **`permissions-matrix.tsx`**: `isSaving`/`setIsSaving` were declared but never wired to
  anything — a real missing-loading-indicator bug. Wired `isSaving` into a guard against
  overlapping toggles, disabled every checkbox while a request is in flight
  (`disabled:opacity-50 disabled:cursor-not-allowed`), and added a small "Saving…" status
  indicator (`role="status"`) above the matrix.
- **`ack-queue.tsx`**: `formatDate` was dead — but git history shows it was added in the
  *same commit* that rendered `{row.txn.txnDate}` raw in the Date column, i.e. it was
  written to format that column and never wired up. Other ledger components
  (`reconciliation-matching-grid.tsx`, `acknowledgment-letter-selector.tsx`) format
  `txnDate` for display via the same local-date-construction pattern; this table alone
  showed the raw `YYYY-MM-DD` string. Wired `formatDate(row.txn.txnDate)` into the Date
  cell and rewrote `formatDate` to use the codebase's established safe pattern (explicit
  `new Date(y, m-1, d)` local construction) instead of `new Date(isoString)`, which parses
  as UTC midnight and can display a day off in a US timezone — the same
  naive-timestamp-as-UTC class of bug this project has hit before.
- **`mark-sent-dialog.tsx`**: `body` (built from `sentAt` + `letterText`) was fully dead —
  neither fetch call in the function uses it; the actual requests use
  `JSON.stringify({ sentAt })` for the initial PATCH and a separately-built `finalBody`
  for the final PATCH. Not a dropped error message — deleted.
- **`ledger-queries.ts`**: `shouldClearBudgetLineLink` is correctly wired into the PATCH
  auto-clear contract, but via a *direct* import in
  `src/app/api/admin/ledger/transactions/[id]/route.ts` (imported line 85, called line
  544), not through `ledger-queries.ts`. DECISION-061 in `docs/decisions.md` confirms
  that route file is the auto-clear logic's home. `ledger-queries.ts`'s copy of the name
  in its large destructured import from `@/lib/ledger` was simply surplus. No bug —
  deleted.
- **`next-auth.d.ts`**: removed the unused `NextAuth` default import, kept the named
  `DefaultSession` import (which still makes the file a module, so the `declare module`
  augmentation stays valid). Verified via full-project `tsc --noEmit` (clean) that
  `session.user.memberId` / `session.user.features` still typecheck at call sites.

### Deliberately NOT fixed — 1 warning remains

`src/components/admin/ledger/budget-context-panel.tsx:114` — stale-looking
`eslint-disable-next-line react-hooks/exhaustive-deps`. Investigated and found it is
masking two real `eslint-plugin-react-hooks` "compiler" findings
(`react-hooks/refs`, `react-hooks/set-state-in-effect`) that only surface once the
directive is removed. A **concurrent session** (this repo currently has another
in-progress investigation) independently reached the same finding and wrote it up in
`docs/work-log/2026-09-10-budget-context-panel-compiler-findings.md`, correctly
concluding this needs full Phase 1-3 design treatment before a fix lands, because the
"obvious" fix (move the render-body ref write into a `useEffect`) changes a
staleness-guard's timing in money-adjacent code and is not provably safe. I independently
arrived at the same conclusion after prototyping and rejecting a `useEffect`-based fix,
then reverted my attempt via `git checkout --` to avoid landing a second, conflicting
resolution to the same finding. **Do not delete this directive without doing that Phase
1-3 work** — see that work-log for the full analysis.

### Outputs

- Files modified (see `git diff --stat`): 25 application-code files across
  `scripts/`, `src/app/(dashboard)/admin/`, `src/app/api/`, `src/components/admin/`,
  `src/lib/`, `src/types/`.
- No schema changes, no new `FEATURES` entries, no new env vars.
- No new API endpoints or server actions.

### Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 102 files, 1933 tests passing (baseline in the task prompt was 1926;
  the difference is a new `use-chunked-upload.test.ts` from the concurrent session, not
  anything introduced here).
- `pnpm build:only` — production build succeeds.
- `pnpm lint` — **0 errors, 1 warning** (the deliberately-deferred item above).

### Open questions / handoff notes

- The one remaining warning needs a tracked follow-up: run
  `docs/work-log/2026-09-10-budget-context-panel-compiler-findings.md` through Phase
  1-3 (analyst → architect → tech-lead) before any implementer touches that file again.
- `src/app/(dashboard)/admin/ledger/page.tsx` carries a similar deliberate
  `react-hooks/error-boundaries` suppression per that same work-log — flagged there as
  "same shape of problem, also still open," not in scope for this cleanup.
- Recommend `qa` for Phase 5: confirm the permissions-matrix Saving indicator and the
  ack-queue Date column render correctly in the browser (the two behavior-affecting
  fixes), and confirm the four verification commands above stay green.

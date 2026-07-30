# Budgeting Page UX Polish — Work Log

> **Slug:** `2026-07-30-budgeting-ux-polish`
> **Surface:** (dashboard) admin — `/admin/ledger/budgeting`
> **Permission(s):** none — UI-only, no new gate; existing `LEDGER_MANAGE`/`LEDGER_APPROVE` gating on the surrounding controls is unchanged
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix / polish variant — three independent UI polish items, no schema/API/permission change. Phases 1–3 skipped per the bug-fix variant table (functional intent and design were specified directly by the requester in the task brief); documented here instead of separate stub entries since all three ship together in one pass.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped | Trivial polish, intent given directly | 2026-07-30 |
| 2 — Architectural review | architect | Skipped | No schema/dependency/structural change | 2026-07-30 |
| 3 — Technical design | tech-lead | Skipped | Approach specified in the task brief | 2026-07-30 |
| 4 — Implementation | ux-developer | Complete | — | 2026-07-30 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 4 — Implementation (UI) — 2026-07-30

**Owner:** ux-developer
**Status:** complete

### Summary

Three independent UX polish items on the guided budgeting editor
(`/admin/ledger/budgeting`): (1) smooth-scroll a newly-added category into
view instead of leaving it below the fold, (2) distinct low-saturation
background tints for a fund's Income vs. Expense sections, and (3) reserve
the star/note annotation controls' exact footprint on an uncommitted cause
line (disabled + hinted) instead of letting them pop in after the line's
first commit. All three are presentation-only — no new endpoints, no schema
change, no permission change. Builds on the 2026-07-28 Budget Star & Notes
feature and the 2026-07-29 Budgeting Page Restructure without touching
either's write paths.

### What I did

**Item 1 — scroll new category into view**
- `guided-budget-setup.tsx`: added `scrollToKey` state
  (`${categoryId}_${flow}`). `submitNewCategory` sets it from the created
  category's `id` (the POST `/api/admin/ledger/categories` response);
  `addExistingCategory` sets it from the already-known
  `addCategoryState.existingCategoryId` — both fire before `router.refresh()`.
  Threaded into every `<BudgetEditor>` call in `renderFlowSection` as
  `scrollToKey` + `onScrolledToKey={() => setScrollToKey(null)}`.
- `budget-editor.tsx`: added a `rowRefs` map (keyed identically to
  `inputs`), attached a callback ref to the outer `<div>` of all three row
  render branches (pending-delete, in-breakdown, lump-sum), and a
  `useEffect` on `[scrollToKey, lines, onScrolledToKey]` that
  `scrollIntoView({ behavior: "smooth", block: "center" })`s the matching
  ref once it exists, then calls `onScrolledToKey()`. Several
  `BudgetEditor` instances mount at once (income/expense × per-fund); only
  the instance whose `lines` actually contains the key acts — category ids
  are unique, so exactly one instance ever matches, and an unrelated
  re-render (e.g. typing in a sibling field) can't accidentally re-trigger
  a scroll since the effect no-ops unless `scrollToKey` is non-null.
  `scrollToKey`/`onScrolledToKey` are optional props (default `null`), so
  the other existing caller (`[fundSlug]/report/page.tsx`) is unaffected.

**Item 2 — Income/Expense section shading**
- `guided-budget-setup.tsx`: `renderFlowSection`'s outer wrapper changed
  from a plain `pt-3 border-t border-gray-100` divider to a tinted,
  padded, `rounded-xl` box: `bg-lions-blue/5` for income, `bg-stone-50` for
  expense. The existing "Income"/"Expense" `<h4>` label (already present
  from the Budgeting Page Restructure) now sits inside the tinted box, so
  no new copy was needed. The nested empty-state box and the inline
  "add category" form (both previously `bg-gray-50`) were bumped to
  `bg-white` so they still read as distinct surfaces against the new
  section tint instead of blending into it.
- Judgment call: used `bg-stone-50` (a warm-toned gray) rather than
  `amber-50`/`orange-50` for the expense tint. Amber is already this same
  page's "Needs review" balance-badge color (`balanceBadgeClass`'s `warn`
  case) — reusing it as a background wash would read as "this section has
  a problem" rather than just "this is the expense half." `lions-blue/5`
  for income stays on-brand without competing with the page's actual blue
  UI chrome (buttons, links) at that low an opacity.
- Both tints are pale enough (5% blue tint, `stone-50`) that existing text
  colors (`gray-500`/`gray-700`/`gray-900`) keep full contrast; no color
  changes were needed on any text. No `dark:` variants were added — a
  repo-wide grep found zero existing `dark:` usage anywhere in `src/`
  (`tailwind.config.ts` has `darkMode: ["class"]` configured but nothing
  in the app opts into it), so there's no dark-mode behavior to preserve
  and adding one-off `dark:` classes here would be inconsistent with every
  other admin surface.

**Item 3 — no layout jump on annotation controls**
- `budget-cause-editor.tsx`: `renderLineAnnotationControls` no longer
  returns `null` for an uncommitted row (`row.id === null`) when
  `showAnnotationControls` is true. It now renders the identical wrapper
  (`flex items-center gap-0.5 flex-shrink-0`) with two `<button disabled>`
  elements sized exactly like the committed star/note buttons
  (`min-h-[44px] min-w-[44px] rounded-lg`), muted to `text-gray-200`
  (fainter than the committed-but-unstarred `text-gray-300`, so a
  disabled state reads as visually distinct from "unstarred but usable"),
  with `cursor-not-allowed` and
  `title="Save the line to star it or add a note"` plus a matching
  `aria-label`. No behavior changes on commit — the moment `commitCreate`
  gives the row a real `id`, the next render swaps straight to the normal
  working buttons in the same slot; there is no code path that tries to
  make annotations work pre-commit (they can't — no id yet).
- This only affects cause-line rows in `BudgetCauseEditor`. Category-grain
  rows in `budget-editor.tsx` were not touched because every category row
  already has a real, persisted `categoryId` from `getFundReport` (never
  `null`) — there is no "uncommitted category row" state to reserve space
  for.

### Outputs

- `src/components/admin/ledger/guided-budget-setup.tsx` — `scrollToKey`
  state + wiring (Item 1), `renderFlowSection` tint wrapper + `bg-white`
  nested surfaces (Item 2)
- `src/components/admin/ledger/budget-editor.tsx` — `scrollToKey`/
  `onScrolledToKey` props, `rowRefs`, scroll effect, refs on all three row
  branches (Item 1)
- `src/components/admin/ledger/budget-cause-editor.tsx` —
  `renderLineAnnotationControls`'s reserved/disabled branch for
  `row.id === null` (Item 3)
- `e2e/budgeting-restructure.spec.ts` — new test: "'+ Add category' scrolls
  the newly-added category into view (UX Polish, 2026-07-30)"; polls the
  new row's bounding box against the viewport after `scrollIntoView`'s
  smooth animation settles, rather than a fixed sleep
- `e2e/budget-star-notes.spec.ts` — extended the existing never-saved-row
  test (renamed to reflect the new behavior) with assertions that the
  reserved star/note buttons are present (count 1), disabled, and
  correctly disappear (count 0) once the row commits; file-level doc
  comment updated to describe the reserved-footprint behavior instead of
  "no controls at all." No new fixture/FY needed — both specs already run
  against the existing isolated FY2099 fixtures per their own file-level
  doc comments (Foundation/Charitable Fund for the restructure spec, Club/
  Activity Fund for the star-notes spec); the scroll test's own added
  category (`"E2E QA Scroll Target"`) is a normal, permanently-left
  fixture row, same convention as the suite's other "E2E QA …" rows.

### Tests

- `pnpm exec tsc --noEmit`: PASS, no errors.
- `pnpm test` (Vitest): PASS, 33 files / 833 tests, no regressions.
- `pnpm exec playwright test e2e/budgeting-restructure.spec.ts
  e2e/budget-star-notes.spec.ts`: PASS, 20/20, run against a live
  `pnpm dev` server — includes both new/modified assertions.
- `pnpm build:only` was explicitly NOT run per the task brief (left for
  qa/deployment-engineer).
- `pnpm lint` was not run; CLAUDE.md/task brief note a pre-existing
  unrelated ESM failure in this repo's lint config — not touched here.

### Open questions / handoff notes

- **For qa (Phase 5 nominee):** please run `pnpm build:only` (not run
  here per instructions) and a manual click-through:
  - Open `/admin/ledger/budgeting` for an entity with two funds side by
    side (e.g. the Club entity) — confirm the income section reads with a
    faint blue wash and the expense section with a faint warm-gray wash,
    and that it's visually obvious which section you're in while
    scrolling.
  - Use "+ Add category" (new-category mode) on a fund with enough
    existing categories that the new row would otherwise land off-screen —
    confirm it smooth-scrolls into view and lands roughly centered.
  - Start a cause breakdown on a giving-eligible expense category, click
    "+ Add line item" to get a brand-new blank row, and confirm the
    star/note icon slots are visible but grayed-out/disabled with a
    tooltip, then fill+commit the row and confirm the icons "light up" in
    place with no shift in the row's height or the layout below it.
  - Recheck mobile at 360px (existing `budgeting-restructure.spec.ts` test
    already covers 44px tap targets generally, but the new reserved
    buttons are new elements worth a manual glance).
- **New copy strings** the Lions Club may want to refine: the disabled
  hint `"Save the line to star it or add a note"` (used as both `title`
  and folded into two `aria-label`s: `"Flag for discussion — save this
  line first"` / `"Add note for discussion — save this line first"`). No
  other new user-facing copy — the "Income"/"Expense" section labels
  already existed.
- **UX decisions/tradeoffs made** (also called out inline above): the
  `bg-stone-50` vs. `amber-50` choice for the expense tint (avoiding
  overlap with the existing "Needs review" balance-badge color), and using
  `<button disabled>` rather than a bare `<span>` for the reserved
  annotation placeholders (keeps consistent semantics/hover cursor with
  every other disabled control on this page, e.g. the disabled Approve
  button).
- Did not touch `[fundSlug]/report/page.tsx`'s own (non-guided,
  single-flow-mixed) `BudgetEditor` usage — it doesn't opt into
  `showAnnotationControls` or pass `scrollToKey`, so Items 1 and 3 have no
  visible effect there, and Item 2's shading lives entirely in
  `guided-budget-setup.tsx`'s `renderFlowSection`, which that page doesn't
  use.

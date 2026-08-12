# Dues Payment-Method Donut Chart — Work Log

> **Slug:** `2026-07-20-dues-method-pie`
> **Surface:** (dashboard) admin — `/admin/dues`
> **Permission(s):** existing `FEATURES.DUES_VIEW` / `FEATURES.DUES_MANAGE` gate on the page cover this; no new permission needed.
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phases 1–3 condensed into this brief (full-stack-developer implemented directly per the dispatching agent's brief); Phase 2 (architect) explicitly skipped — no new directories, no new npm dependency, no structural change (one new component under the existing `src/components/admin/` tree, one new helper in an existing lib file).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | (condensed, below) | Done | READY FOR DESIGN | 2026-07-20 |
| 2 — Architectural review | — | Skipped | n/a — no structural change | 2026-07-20 |
| 3 — Technical design | (condensed, below) | Done | Design complete | 2026-07-20 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-20 |
| 5 — Verification | full-stack-developer (self-verified; qa recommended for full sign-off) | PASS | — | 2026-07-20 |
| 6 — Shipped vs intent | analyst (not yet run) | Pending | — | — |

---

## Condensed Phases 1–3

**Request (treasurer, via user):** "for dues tracking it might be nice to see a pie chart versus the paid/partial/unpaid cards. Check/Zeffy/Cash/Other/Unpaid. Still would want to see the total collected."

**Flow:** Admin/treasurer with `dues.view` or `dues.manage` opens `/admin/dues` → sees a "Payment Composition" donut card in place of the three paid/partial/unpaid stat cards → reads dollar composition by method plus a center "Total Collected" figure, and can still see paid/partial/unpaid member counts in a compact line under the chart.

**Design decisions (see `references/*.md` in the `dataviz` skill, invoked before any chart code was written):**
- **Form:** donut, not the skill's default part-to-whole recommendation (horizontal stacked bar). Deliberate exception — the user explicitly asked for "a pie chart," and a donut's center hole embeds the required "total collected" hero figure directly in the mark, which a stacked bar cannot do as cleanly. Noted as a scoped override of the default heuristic, not a miss.
- **Color job:** categorical (identity — which payment method), assigned in the palette's fixed slot order: Check → slot 1 (blue `#2a78d6`), Zeffy → slot 2 (aqua `#1baf7a`), Cash → slot 3 (yellow `#eda100`), Other → slot 4 (green `#008300`). Validated: `node scripts/validate_palette.js "#2a78d6,#1baf7a,#eda100,#008300" --mode light` → all 4 checks PASS (worst adjacent CVD ΔE 24.2; light-mode contrast WARN on aqua/yellow, mitigated per the skill's relief rule by the always-visible legend + sr-only table, never color-alone). Dark-mode steps also validated (CVD floor-band WARN, same relief rule) but **not wired up** — this admin surface has no dark-mode variants anywhere today (confirmed via `grep -rl "dark:" src/app/(dashboard)/admin src/components/admin` → zero hits), so adding `dark:` classes to one new component would be inconsistent with the rest of the surface. Flagged as a handoff note below rather than silently done.
- **Unpaid is not a categorical hue** — muted gray (`#c3c2b7`), explicitly reads as absence rather than competing with the four method identities.
- **Marks:** SVG annular wedges with a 2px-equivalent angular gap between slices (the "surface gap" spacer from `marks-and-anatomy.md`), no stroke borders.
- **Accessibility:** legend carries every slice's identity + dollar + %, so color is never the only channel; SVG has a full descriptive `aria-label`; a `sr-only` `<table>` gives screen readers a tabular equivalent of every slice plus the total.
- **Interaction:** deliberately non-interactive (no hover/tooltip layer) — the page and this chart are Server Components per CLAUDE.md's server/client boundary invariant and the task's explicit "keep it a Server Component" constraint; the always-visible legend carries what a tooltip would.
- **Denominator / edge-case math** (see `computeDuesMethodComposition` doc comment in `src/lib/dues.ts`): 100% of the pie = `totalCollectedCents + unpaidCents`. This is `totalExpectedCents` when collected falls short of it, but falls back to `totalCollectedCents` itself on overpayment (once `unpaidCents` clamps to 0) — so a slice can never read as more than 100%, and "dues not configured" (`totalExpectedCents` ≤ 0) still charts fine as 100% of whatever's been collected.

**Implementer:** full-stack-developer (small, tightly coupled: one pure function + one query helper + one presentational component + a page wire-up, well under the ~150-line full-stack threshold).

---

# Phase 4 — Implementation

## Files Created

- `src/components/admin/dues-method-donut.tsx` — Server Component. Renders the donut (plain inline SVG, no chart library — none exists in this project and CLAUDE.md says not to add one), the center "Total Collected" figure, a legend (swatch + label + $ + %), a compact "N paid · N partial · N unpaid" line, an `sr-only` table for accessibility, and the empty state (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, matching the page's existing empty-state pattern) when dues aren't configured and/or no payments exist.

## Files Modified

- `src/lib/dues.ts` — added `computeDuesMethodComposition()` (pure function, no DB access — consistent with this file's existing "pure functions only" convention), plus `DuesMethodKey`, `DUES_METHOD_ORDER`, `DUES_METHOD_LABELS`, `DuesMethodSlice`, `DuesMethodComposition` types.
- `src/lib/dues-queries.ts` — added `getDuesMethodTotals(fiscalYear, opts?: { search? })`, a raw grouped-SUM query over `dues_payments` joined to `members` (active only), scoped identically to `listMemberDuesStatus` (same active-member population, same optional name/email search filter) so the donut and the page's search box stay in sync — searching the member table also re-scopes the chart, matching the exact behavior of the stat cards it replaces.
- `src/app/(dashboard)/admin/dues/page.tsx` — replaced the paid/partial/unpaid/total-collected 4-card grid with `<DuesMethodDonut>`; fetches `getDuesMethodTotals` alongside the existing `Promise.all`; computes `totalExpectedCents` from the already-fetched `members` list; wires `computeDuesMethodComposition(methodTotals, totalExpectedCents, totalCollectedCents)`. `paidCount`/`partialCount`/`unpaidCount` are still computed and passed through to the chart's compact counts line — not destroyed, per the task's explicit instruction.
- `src/lib/dues.test.ts` — 9 new tests for `computeDuesMethodComposition` (see Phase 5).

## Schema Changes

None. `dues_payments.method` is already a free-text column (`'check' | 'cash' | 'zeffy' | 'other'` by convention, not a DB enum), so no migration was needed to support arbitrary/unexpected method values folding into "Other."

## Implementer Notes

- **`totalCollectedCents` is a passed-in trusted value, not recomputed from method sums.** The page already computes it from `listMemberDuesStatus` (summed per-member `totalPaidCents`). `computeDuesMethodComposition` takes it as a parameter and displays it verbatim for the "Total Collected" figure, rather than re-deriving it from `methodTotalsCents`. This matters because a per-method sum is clamped at 0 before contributing a wedge (so a net-negative refund on one method doesn't draw a negative slice) — recomputing the headline number from clamped method sums could quietly understate it in that edge case. The prominent total is always the same number the rest of the page already trusts.
- **Overpayment percent-clamp:** initially used `totalExpectedCents` as the pie's denominator whenever it was > 0. That's wrong on overpayment — a single "Check: 150%" slice — so the denominator is `totalCollectedCents + unpaidCents` instead (see design note above). Caught this while writing the overpayment unit test, before it reached qa.
- **Zero-value slices are omitted entirely** (not shown as $0 legend rows) — chosen for cleanliness given the categorical color budget is already near its CVD floor at 4 method hues; a fixed decision, noted per the task's "consider... only if the dataviz skill favors it" — the skill has no specific guidance either way, so this was a judgment call.
- **Dark mode was not implemented** for the new component — see the condensed-design note above. This is a pre-existing surface-wide gap, not something newly introduced.

---

# Phase 5 — Verification (self-verified by implementer; recommend qa for independent sign-off)

**Date:** 2026-07-20

## Unit Tests

`pnpm test`: **322 passed** (313 pre-existing + 9 new in `src/lib/dues.test.ts` for `computeDuesMethodComposition`): normal case, no payments (Unpaid-only), no payments + no expected total (empty state), overpayment clamp, unknown-method bucketing, null/undefined method bucketing, negative/refund method clamp, zero-slice omission, no-expected-total-but-payments-exist (100%-of-collected, no Unpaid slice). All existing tests stayed green.

## Type Check

`pnpm exec tsc --noEmit`: **PASS**, no errors.

## Lint

`pnpm lint`: **pre-existing environment failure**, unrelated to this change — ESLint 9.39.2's flat-config loader crashes on `minimatch` (`SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`) before it even reads a config file or touches project source. Not caused by or fixable within this feature's diff; flagging for the 30-day dependencies review.

## Dev-Server Smoke Test / Manual Click-Through (Playwright, against the already-running `localhost:3000`)

Wrote a temporary spec at `e2e/dues-donut-temp.spec.ts`, run via `pnpm exec dotenv -e .env.local -- playwright test e2e/dues-donut-temp.spec.ts`:

| Flow | Result | Notes |
|------|--------|-------|
| Sign in as admin, load `/admin/dues` | PASS | `Payment Composition` heading renders |
| Donut SVG renders with correct `aria-label` | PASS | |
| "Total Collected" center label visible | PASS | |
| Empty-state fallback path exists | Not exercised live (this FY has real data) | Covered by the empty-state unit-equivalent logic in `computeDuesMethodComposition` (empty-slices case tested) and by manual code read of the component's early-return branch |

Also took two screenshots (via a second, separately-deleted temp spec) to eyeball the render per the dataviz skill's step 7: the full page (real production-shaped data: 41 active members, FY2026, $X,XXX.XX collected of $X,XXX.XX expected, all via Check so far) and a cropped shot of just the SVG. The donut rendered a clean small blue "Check" wedge (~4.5%) against a large muted-gray "Unpaid" wedge (~95.5%), a visible 2px-equivalent gap between them, and a legible centered "TOTAL COLLECTED" figure — confirming the arc-path math (`donutWedgePath`) produces a correctly seated wedge rather than a floating/disconnected shape, which a small-slice case like this is exactly the kind of edge case that would expose.

Both temporary spec files and `test-results/` / `playwright-report/` were deleted after verification; `e2e/dues-donut-temp.spec.ts` does not exist in the final diff. The dev server was left running, untouched.

## Regression Notes

Not applicable — new feature, not a bug fix.

## Verdict

**PASS** (self-verified). Recommend routing to `qa` for an independent Phase 5 pass and then `analyst` for Phase 6 shipped-vs-intent before this is considered fully closed per the standard pipeline — this work-log intentionally used the small-feature accelerated path per CLAUDE.md, with full-stack-developer covering Phase 4 and a self-verification in place of a separately-dispatched Phase 5.

---

# Phase 6 — Shipped vs Intent (analyst)

Not yet run. Recommended next step if the user wants the full pipeline closed out.

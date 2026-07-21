# Impact Drill-Down Focus Ring — Work Log (bug-fix stub)

> **Slug:** `2026-07-21-impact-drilldown-focus-ring`
> **Surface:** (dashboard) member portal — `/members/impact`
> **Permission(s):** none touched
> **Estimated complexity:** trivial (one class change)
> **Pipeline mode:** Bug-fix variant, minimal stub — Phases 1-3 skipped (user-reported polish
> item with an unambiguous one-line fix; no design or architectural surface). Phase 4 by the
> orchestrating session; Phase 5 folded into the concurrent public-note QA pass (same screen);
> Phase 6 = user's own visual confirmation.

**User report (2026-07-21):** "On the Our Community Impact screen selecting a category doesn't
need the highlighted border. It is enough that the details slide open/close."

**Root cause:** the cause row became a real `<button>` in the drill-down feature (v1.30.0) with
`focus:ring-2 focus:ring-lions-blue`. After a mouse click the button retains focus, so the ring
lingers and reads as a selection highlight.

**Fix:** `src/components/members/impact-by-cause.tsx` cause-row button — `focus:ring-2
focus:ring-lions-blue` → `focus-visible:ring-2 focus-visible:ring-lions-blue`. Keyboard users
(Tab + Enter/Space, per the shipped Flow D accessibility requirement) still get the ring;
mouse/tap users get only the expand/collapse motion. The FY filter pills keep their `focus:`
rings — they have intentional selected-state styling and were not part of the report.

**Reproduction:** click any cause row with a mouse → blue ring remains around the row after
expansion. Post-fix: no ring on mouse click; ring still appears when focusing via keyboard.

**Verification:** typecheck + full test suite + build run by the concurrent public-note Phase 4
gates (component compiles); visual click-through assigned to the public-note Phase 5 QA pass
(same screen, same dev-server session).

**Verdict: PASS** (2026-07-21, qa). Confirmed the fix at
`src/components/members/impact-by-cause.tsx:157` — the cause-row `<button>` carries
`focus:outline-none focus-visible:ring-2 focus-visible:ring-lions-blue` (not `focus:ring-2`); the
FY-filter pills (lines 100, 113, 126) correctly still use `focus:ring-2 focus:ring-lions-blue`,
confirming they were deliberately left alone (they have intentional selected-state styling and
were never part of the report). Drove both interaction modes live in a real Chromium browser via a
temporary Playwright spec (deleted after the run, `git status --porcelain e2e/` empty):
- **Real mouse click** on a cause row button → `getComputedStyle(el).boxShadow === "none"`
  immediately after the click. No lingering ring.
- **Real keyboard navigation** — clicked a different, deterministic element (the last FY-filter
  pill) to establish a known focus point without touching the button under test, then pressed a
  single real `Tab` keypress, landing on the cause-row button (`document.activeElement === el`,
  matching its DOM position as the very next focusable element after the pills row) →
  `getComputedStyle(el).boxShadow` was **not** `"none"` and contained an `rgb(...)` value — the
  ring renders for keyboard users exactly as required.

Both assertions passed. No defect found; nothing to hand back to the implementer.

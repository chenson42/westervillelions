# Impact Drill-Down Row Layout — Work Log (polish stub)

> **Slug:** `2026-07-21-impact-drilldown-row-layout`
> **Surface:** (dashboard) member portal — `/members/impact`
> **Permission(s):** none touched
> **Estimated complexity:** trivial (single-component layout restructure)
> **Pipeline mode:** Bug-fix/polish variant, minimal stub — Phases 1-3 skipped (user-reported
> layout feedback with screenshot; unambiguous small fix). Phase 4 by the orchestrating session;
> Phase 5 = gates + user's own visual confirmation (user is actively viewing the screen).

**User report (2026-07-21, with screenshot):** "I wonder if we can clean up the details layout?
The centered 'payee' makes it feel a bit chaotic."

**Root cause:** the expanded gift row rendered three columns on one line — date (left), payee
(middle/floating), amount (right) — so the payee's horizontal position varied per row, and the
public note beneath created a second left-aligned axis. Two competing alignment axes = chaotic
scan.

**Fix:** `src/components/members/impact-by-cause.tsx` expanded-row markup restructured to one
left-aligned stack + right amount:
- Line 1: payee (or "Recipient not recorded") — `text-gray-900 font-medium truncate`, now the
  row's primary element; amount stays right (`shrink-0`).
- Line 2 (when present): public note — unchanged `text-xs text-gray-500 break-words`.
- Line 3: date — demoted to `text-xs text-gray-400`.
All text left-aligned in a `min-w-0` column; `items-start` so the amount tops-aligns with the
payee. No data/logic changes.

**Verification:** typecheck + unit tests re-run (layout-only change); visual confirmation by the
user on their own screen. Ships as v1.31.1 once the concurrent reconciliation-inc2 increment
frees the tree for a stable gate run (selective staging — inc2's uncommitted files excluded).

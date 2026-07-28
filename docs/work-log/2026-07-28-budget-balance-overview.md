# Budget-Balance Overview per Account (at FY boundary) — Work Log

> **Slug:** `2026-07-28-budget-balance-overview`
> **Surface:** (dashboard) admin — The Ledger (per-account overview)
> **Permission(s):** existing ledger view/manage expected — confirm Phase 1/3
> **Estimated complexity:** medium (mostly reuse of existing balance logic; the genuinely new part is the dues-timing allocation math)
> **Pipeline mode:** Full

## Treasurer's request (verbatim intent, 2026-07-28)
"Kick off a feature to show an **overview at the top of each account** that tells us **whether the budget is balanced or not**. Base it off the **end of June (aka new fiscal year)**. Note that **some dues for this FY come in prior to the FY ending** — we'll need to figure out that math."

## Interpretation to refine in Phase 1
- **"each account" / "at the top":** likely the top of each entity/fund's Ledger view (the per-fund report page `/admin/ledger/[fundSlug]/report`, and/or the two-entity Ledger dashboard `/admin/ledger`). Confirm which surface(s).
- **"whether the budget is balanced or not":** a clear balanced / not-balanced status indicator (with the shortfall/surplus amount), summarizing the year's budget vs. reality.
- **"base it off end of June (new fiscal year)":** evaluate the balance assessment at the **fiscal-year boundary** (FY ends 6/30, new FY starts 7/1 — per `src/lib/fiscal-year.ts`). i.e. a full-year, at-close view, not a mid-year snapshot.
- **The dues-timing math (the hard/new part):** members pay **next FY's dues before the current FY ends** — e.g. the 2026-2027 (FY2026) dues collected via Zeffy in **June 2026** (the close of FY2025; see the June bank statement "Dues 696.00 — 2026-2027 dues payments" and the auto-post `payment_method='zeffy'` rows). On a strict cash basis those early dues inflate the FY they're *received* in and are missing from the FY they're *for*, distorting a "balanced?" assessment. Phase 1 must surface the allocation decision: **cash basis (count when received)** vs. **allocate dues to the membership year they're for (deferred revenue)** — and whether the overview should present one, both, or an adjusted figure. This needs the treasurer's call.

## Existing logic to build on (Phase 1/3 must read — reuse, don't reinvent)
- `computeBudgetBalanceStatus()` in `src/lib/ledger.ts` — already computes a per-fund budget net / balance-status (warns admin funds when income < expense; charitable/scholarship/activity handled differently per the two-fund LCI rule). The budgeting page's balance badges + `guided-budget-setup.tsx` `fundSums()` already surface a live balance readout.
- `getFundReport(fundId, fiscalYear[, {asOfDate}])` — per-category budget vs. FYTD actuals + opening/ending fund balance rollforward; the member Monthly Statement + fund-report page consume it.
- The dues auto-post model (`dues_payments`, `payment_method='zeffy'` income rows dated on pay-date) and the FY convention (`fiscal-year.ts`, FY labeled by start year; today 2026-07-28 = FY2026).
- The two-fund LCI rule (admin holds a reserve; charitable/activity meant to be disbursed — a planned drawdown is legitimate, not an imbalance) — see the budgeting guide + `computeBudgetBalanceStatus`. A "balanced?" overview must respect that funds differ (an admin deficit is a flag; a charitable drawdown is intended).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review | architect | Skipped (accelerated pipeline) | — | 2026-07-28 |
| 3 — Technical design | tech-lead | Skipped (accelerated pipeline) | — | 2026-07-28 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-28 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

Grounded in code: `computeBudgetBalanceStatus()` (`src/lib/ledger.ts`), `getFundReport()` (`src/lib/ledger-queries.ts`), `fiscal-year.ts`, `dues_payments`/`ledger_transactions` schema (`src/lib/db/schema.ts`), `syncDuesCreate()` (`src/lib/dues-ledger-sync.ts`), the fund-report page and dashboard page permission gates, and `guided-budget-setup.tsx`'s `fundSums()`. The shape of the feature is clear and nearly all of it is reuse; the one open item is a genuine treasurer decision (dues-allocation basis), not a functional ambiguity I can resolve alone — hence notes, not rework.

## ONE-LINE TAKE

> A read-only "is this fund's year balanced?" banner at the top of each fund's report page, reusing the existing fund-kind-aware balance engine fed with actual (not budgeted) FY totals, with a second adjusted figure that re-homes early-paid dues to the membership year they're actually for.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (ledger viewer/recorder/manager) | Opens a fund's report page (`/admin/ledger/[fundSlug]/report`) and reads the balance-status banner at the top | Per visit |
| Admin | Switches fiscal year via the existing `FiscalYearSelector` and re-reads the banner for a prior/closed year | On demand |
| Admin | Reads the dues-adjustment footnote/toggle to see cash-basis vs. adjusted figures for the Administrative fund | On demand, Administrative fund only |

No anonymous-visitor or signed-in-member surface is touched. This is 100% admin/Ledger.

## Flows

**Flow 1 — View a fund's FY-close balance status:**
Entry: admin navigates to `/admin/ledger/[fundSlug]/report` (from the Ledger dashboard, budgeting page, or a direct link) → page loads with a fiscal year resolved (default: see Gap/Question below) → `getFundReport(fund.id, fiscalYear)` already runs (existing code) → new step: the banner computes `computeBudgetBalanceStatus(fund.kind, report.totalIncomeCents, report.totalExpenseCents)` (reusing the existing function's per-fund-kind rule against **actuals**, not budgeted amounts) → outcome: a status card renders one of {Balanced, Surplus, Deficit-flag (administrative only), Planned-drawdown-OK (charitable/scholarship), Off-balance (activity, either direction)} with the net dollar amount.
- Failure: if `getFundReport` returns `null` (fund not found) the page already `notFound()`s before reaching the banner — no new failure mode there. If the underlying query throws (DB blip), the banner must not crash the whole report page — degrade to an inline "Balance status unavailable right now" note inside a `bg-gray-50 rounded-2xl` card rather than a Next.js error boundary; the rest of the report (which already has its own resilience) should still render.

**Flow 2 — Understand the dues-timing adjustment (Administrative fund only):**
Entry: same report page, Administrative fund selected → banner shows the cash-basis actual net (today's `getFundReport` totals, unchanged) → a labeled secondary figure/footnote shows the adjusted net, computed by re-homing any ledger row with a non-null `duesPaymentId` to the fiscal year recorded on its linked `dues_payments.fiscal_year` (not the fiscal year implied by `txnDate`) → outcome: treasurer sees both "$X received in FY2025" and "$X actually earned by FY2025 membership" with a one-line explanation of the difference.
- Failure: if the join for the adjustment query fails or returns nothing (e.g., a fund with no dues activity), fall back silently to showing cash-basis only — no adjustment row rendered, not an error state. A brand-new install with zero dues rows shows cash-basis only, with no confusing "$0 adjustment" line.

## Permissions

- **Permission(s):** No new key. Reuses the existing gate already on both pages: `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE])` → redirect `/access-pending` if none. This feature adds a read-only banner to an already-gated page; no separate permission needed since it exposes no data the page doesn't already show (it's a derived view over `getFundReport`'s existing totals plus one new dues join).
- **Default roles:** Whatever already holds `LEDGER_VIEW`/`LEDGER_RECORD`/`LEDGER_MANAGE` (Treasurer, President/Admin roles per existing role bindings) — unchanged.

## Gaps the Request Didn't Address

- **Which fiscal year does the banner default to?** The request says "base it off end of June" but doesn't say whether that means the just-closed FY (today 2026-07-28 → FY2025, which closed 6/30/2026) or the current, just-started FY (FY2026, in progress). Matters because a mid-year "balanced?" reading on an in-progress FY is a very different claim than a final, closed-year verdict. **Suggested resolution:** default to the most recently *closed* FY (current FY − 1) when the banner is first painted, keep the existing `FiscalYearSelector` fully live so the treasurer can flip to the current or any historical year, and label the banner "FY2025 — closed" vs. "FY2026 — in progress" so the verdict's finality is never ambiguous. **Escalated to Open Questions — genuinely the treasurer's call.**
- **Is "balanced" about actuals or about budget-vs-budget?** `computeBudgetBalanceStatus` was built for the *budgeted* income/expense comparison (guided budgeting, before the year starts). This request is asking something different: "did the year that just happened balance?" — an actuals question. **Suggested resolution:** reuse the same function (it's generic over two cent totals) but feed it `report.totalIncomeCents` / `report.totalExpenseCents` (actuals from `getFundReport`) instead of budgeted lines. Confirmed as the right read in Pass 3 below, but flagging since it's a repurposing of an existing function's *inputs*, not just a straight reuse.
- **Empty state — brand-new fund, no activity yet.** A fund created mid-year (or a fresh install) with zero budget and zero actuals must not render "Deficit" or any alarming state. **Suggested resolution:** a "No activity recorded yet for FY2026" neutral state (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, matching the existing empty-state pattern) rather than running the fund-kind math against all-zero inputs, which would technically read as "Balanced" (0 == 0) — misleadingly confident for a fund with no data at all.
- **Pre-inc6a dues rows with no `duesPaymentId` link.** Historical ledger rows recorded before the dues↔ledger auto-post existed (or any dues entered as a plain manual transaction bypassing the dues flow) won't have a `duesPaymentId` to join against, so they silently stay cash-basis in the adjusted figure. Not a bug, but worth a footnote ("$X of dues income could not be re-allocated — recorded before dues/ledger linking") only if the amount is material, so the treasurer isn't left wondering why the adjusted number doesn't fully reconcile.
- **Mobile / brand.** No new interaction pattern is introduced (no forms, no destructive actions, no `window.confirm`), so this is mostly "don't regress" rather than a gap: the banner card must use `rounded-2xl` (never mixed with `rounded-xl`), sit above the existing budget-vs-actual table, and stack cleanly at 360px like the rest of the report page.
- **Email queue / Google Group sync.** Not applicable — this is a read-only view with no notification and no member/committee membership implication. Confirmed out of scope, not silently skipped.

## Out of Scope (confirm with user)

- Adding the balance banner to the two-entity Ledger dashboard (`/admin/ledger`) — v1 is scoped to the per-fund report page only, since that's where `computeBudgetBalanceStatus` and `getFundReport` already live together. A cross-entity "N of M funds balanced" rollup on the dashboard is a plausible follow-on, not v1.
- Any write/action affordance on the banner (e.g., a shortcut to record a transfer to cover a deficit). This is presentation only — no new POST/PATCH.
- Emailing or exporting the FY-close balance summary to the board.
- Extending the dues-allocation adjustment to funds other than Administrative — confirmed via `syncDuesCreate` that dues income only ever posts to the Club entity's Administrative fund (hardcoded `slug: 'club'` / `slug: 'administrative'`), so there's no other fund this math applies to today.
- Backfilling/repairing historical dues rows that predate the `duesPaymentId` link — treated as a known, footnoted gap (above), not a data-migration task for this feature.

## Open Questions

1. **Dues-allocation basis (the crux):** confirm allocating dues income to the fiscal year recorded on `dues_payments.fiscal_year` (the membership year it's *for*) rather than the fiscal year implied by `txn_date`/`payment_date` (when it was *received*) — shown as an **adjusted figure alongside the existing cash-basis actuals**, not replacing them. This is option (b), presented per option (c)'s "show both" framing. Does the treasurer want it framed this way, or adjusted-primary/cash-basis-secondary instead?
2. **Default fiscal year for the banner:** most-recently-closed FY (recommended) or the current in-progress FY?
3. **"Balanced" definition:** confirm evaluating actual FY income vs. actual FY expense (fund-kind-aware via the existing `computeBudgetBalanceStatus` rule, fed actuals instead of budgeted lines) is the right reading of "is the budget balanced" — as opposed to a budget-vs-budget-plan comparison, or an ending-balance-vs-reserve-target comparison (which the existing reserve-threshold guardrail already covers separately and shouldn't be duplicated here).
4. **v1 surface scope:** confirm per-fund report page only (not the two-entity dashboard) for this increment.
5. **Manual dues entries bypassing the dues flow:** is there a real workflow where a treasurer records a dues payment as a plain ledger transaction instead of through Dues → auto-post? If so, should those rows be flagged ("$X unclassified — not linked to a dues payment") rather than silently staying cash-basis in the adjusted figure?

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Skipped — accelerated pipeline (time-pressed treasurer request).** Documented per CLAUDE.md's
"skipping a phase requires explicit notation" rule. No new directories, no new npm dependencies,
no new server/client boundary decisions beyond what Phase 1 already called out (Server Component,
reuses existing data already fetched on the page) — nothing here warranted a full architectural
pass. If Phase 5/6 surfaces a structural concern, loop back here per the standard rule.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

**Skipped — accelerated pipeline.** Phase 1's "Confirmed design" (fast-tracked defaults from the
treasurer, quoted verbatim in the implementer's task) served as the design doc: reuse
`computeBudgetBalanceStatus()` as-is fed actuals, default FY anchor = most-recently-closed FY, a
new `getDuesTimingAdjustment()` query + `computeDuesTimingAdjustment()` pure helper for the dues
re-homing math, one new Server Component banner, no schema change, no new permission. See the
"Confirmed design" bullets at the top of this file (added by the launching agent) for the full
spec the implementer worked from — that document IS Phase 3 for this accelerated run.

## Implementer

full-stack-developer

---

# Phase 4 — Implementation

## Files Created

- `src/components/admin/ledger/fund-balance-overview.tsx` — new Server Component. Renders the
  balance-status badge (via `computeBudgetBalanceStatus`, fed cash-basis actuals), a one-line
  message + fund-kind "why" note, and — only when the fund has any dues-linked activity — a
  cash-basis-vs-dues-adjusted income comparison with a one-line footnote. A zero-activity fund
  gets a neutral "No activity recorded yet" empty state instead of a misleading 0==0 "Balanced".

## Files Modified

- `src/lib/ledger.ts` — appended (did not touch any existing exports, including the in-flight
  soft-delete/cause-line work already in this file): added `import { getFiscalYear } from
  "@/lib/fiscal-year"` (file previously had zero imports) and the new pure function
  `computeDuesTimingAdjustment(rows, fiscalYear)` + its `DuesTimingSourceRow` /
  `DuesTimingAdjustment` types. Also added a header-comment paragraph documenting the addition,
  matching this file's existing per-feature changelog convention.
- `src/lib/ledger-queries.ts` — appended (again, did not modify `getFundReport`, `getFunds`,
  `setBudgetLinePendingDelete`, or any other in-flight function): added `duesPayments` to the
  schema import list, `computeDuesTimingAdjustment`/`DuesTimingAdjustment` to the `@/lib/ledger`
  import list, and the new `getDuesTimingAdjustment(fundId, fiscalYear)` query function at the end
  of the file.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx` —
  - Imported `getDuesTimingAdjustment` and the new `FundBalanceOverview` component.
  - Changed the fiscal-year default: was `currentFY` (in-progress), now `currentFY - 1` (the
    most-recently-closed FY) whenever no `?fy=` query param is present. Added `isClosedFY = fiscalYear
    < currentFY` so the banner (and only the banner) can label the year "Closed" vs. "In progress".
    The `FiscalYearSelector` is untouched and still lets the treasurer view any other year,
    including the in-progress current one.
  - Added `getDuesTimingAdjustment(fund.id, fiscalYear)` to the page's existing `Promise.all`.
  - Rendered `<FundBalanceOverview>` as the first element inside the "report exists" branch — the
    top of the rendered report, above the existing Opening/Income/Expense/Ending stat grid.

## Schema Changes

None. Read-only feature — no new table, column, or index. `dues_payments.fiscal_year` and
`ledger_transactions.dues_payment_id` already existed.

## The Dues Re-Homing Approach

`getDuesTimingAdjustment(fundId, fiscalYear)` runs ONE query: every posted, income-flow
`ledger_transactions` row for the fund that has a `dues_payment_id`, inner-joined to
`dues_payments` for its `fiscal_year` column — **no `txnDate` bound at all**, across every fiscal
year the fund has ever had dues activity in. That's deliberate: a dues payment can be dated in any
FY relative to the membership year it's actually for (paid early in June, paid late the following
fall, etc.), so bounding the query to one FY window would silently drop the exact rows this
feature exists to catch.

The pure function `computeDuesTimingAdjustment(rows, fiscalYear)` (`src/lib/ledger.ts`) then makes
two independent passes over that unbounded row set for the ONE fiscal year currently being viewed:

- **`cashBasisDuesCents`** — sum of rows whose `txnDate` falls inside `fiscalYear`'s Jul 1 – Jun 30
  window (i.e., "received in FY X"). This is the same subset of dollars already inside
  `getFundReport`'s cash-basis `totalIncomeCents` for that FY — no double-count risk, since it's
  purely informational, never added a second time to a total.
- **`adjustedDuesCents`** — sum of rows whose `dues_payments.fiscal_year` equals `fiscalYear`
  (i.e., "FOR FY X"), regardless of when the row was actually dated.
- **`deltaCents = adjustedDuesCents - cashBasisDuesCents`** — the caller (the banner component)
  adds this to the fund's cash-basis `totalIncomeCents` to get the dues-adjusted total shown
  side-by-side.

Concretely: a member's 2026-2027 (FY2026) dues paid via Zeffy in June 2026 (inside FY2025's window)
produces one row with `txnDate = '2026-06-xx'` and `duesFiscalYear = 2026`. Viewing FY2025:
`cashBasisDuesCents` includes it (received this year), `adjustedDuesCents` excludes it (it's for
next year) → `deltaCents` is negative → FY2025's adjusted income is lower than its cash-basis
figure. Viewing FY2026: the opposite — `cashBasisDuesCents` excludes it, `adjustedDuesCents`
includes it → `deltaCents` is positive → FY2026's adjusted income is higher than its cash-basis
figure. Exactly the "received in FY X but for FY Y" split the design asked for.

**Naive-timestamp-as-UTC guard:** the FY-from-`txnDate` computation never calls `new Date(txnDate)`
on the raw string (which parses as UTC and can shift a date-only value across a month boundary
depending on server timezone — the exact bug already flagged project-wide). Instead it splits the
`'YYYY-MM-DD'` string into `[y, m, d]` and calls `new Date(y, m - 1, d)` — the local-component
constructor, matching the same pattern already used by `computeDueDate()` elsewhere in this file.

**Status badge stays cash-basis, by design.** Per the confirmed design, the dues adjustment is a
secondary, additive figure only — it never feeds back into `computeBudgetBalanceStatus()`'s
status computation, which stays strictly `report.totalIncomeCents` / `report.totalExpenseCents`
(cash-basis actuals) exactly as it already worked for the guided-budgeting page. Only the
Administrative fund will ever show a non-zero adjustment (dues income is hardcoded to that
fund/entity in `syncDuesCreate` — confirmed in Phase 1), so every other fund's banner renders with
`duesAdjustment` present-but-all-zero and the adjustment block simply doesn't render.

**Graceful degradation:** `getDuesTimingAdjustment` wraps its query in try/catch and returns `null`
on any failure. The banner component treats `null` and an all-zero adjustment identically — hide
the adjustment block — so a DB blip on this one extra query degrades to a cash-basis-only banner
rather than crashing the whole report page (confirmed working: the query is entirely independent
of `getFundReport`, which is unaffected by any failure here).

## Tests Added

- `src/lib/ledger.test.ts` — 6 new cases under `describe("computeDuesTimingAdjustment")`: the named
  scenario (a dues row received in FY2025 but for FY2026 excluded from FY2025's adjusted income,
  counted in FY2026's), same-year receive/for nets to zero delta, empty input, multiple rows
  grouped independently per requested FY, and two FY-boundary cases (July 1 reads as the new FY,
  June 30 reads as the prior FY) proving no naive-UTC off-by-one.
- `src/lib/ledger-queries.test.ts` — 3 new cases under `describe("getDuesTimingAdjustment")`,
  reusing the file's existing hermetic `vi.mock("@/lib/db")` FIFO-queue pattern: the FY2025/FY2026
  re-homing round-trip, no-dues-activity returns an all-zero object (not null — distinct from a
  failure), and a forced `db.select` throw returns `null` (via `vi.spyOn`).
- Fund-kind-aware status pass-through is exercised indirectly: `FundBalanceOverview` calls the
  existing, already-tested `computeBudgetBalanceStatus()` unchanged — no new test needed there,
  per the design's "reuse as-is" instruction. Its label/message/badge mapping (the genuinely new
  presentation logic) lives in the Server Component itself, which this repo has no component-test
  infra for (no jsdom/RTL) — verified instead via the manual click-through in Phase 5.

## Gates Confirmed

- `pnpm exec tsc --noEmit`: clean.
- `unset DATABASE_URL DB_URL; pnpm test`: **695 passed** (was 686 + 9 new: 6 in `ledger.test.ts`, 3
  in `ledger-queries.test.ts`).
- `pnpm build:only`: passed.
- No `console.log` in any touched/new file.
- Confirmed via `git diff --stat` / hunk inspection that `ledger.ts` and `ledger-queries.ts` were
  touched ONLY by appending new code after existing content (plus one header-comment addition and
  one import line in `ledger.ts`) — the other in-flight uncommitted work already in this tree
  (fund ordering by kind in `getFunds`, the DECISION-052/053 soft-delete/pending-delete plumbing,
  the cause-line prior-year-reference helpers) is untouched by this change.
- No schema change, no version bump, no release notes, no commit — per explicit instruction.

## Implementer Notes

Diverged from nothing in the confirmed design — implemented literally as specified. One judgment
call not explicitly spelled out: whether a second, dues-adjusted STATUS badge should also be shown
alongside the existing cash-basis badge. Re-reading Phase 1 point 2 ("render the resulting status
... + the net dollar amount" from cash-basis actuals) and point 4 ("show BOTH... figures... with a
footnote" — about the income numbers, not a second verdict), I read the design as one status badge
(cash-basis) plus a secondary income comparison, not two competing badges. Flagging this
explicitly for Phase 6 in case the treasurer's intent was actually to see whether the ADJUSTED
figures change the verdict (e.g., an administrative fund that reads "Deficit flagged" on cash basis
but would read "Balanced" once dues are re-homed) — that would be a small, additive follow-up
(recompute `computeBudgetBalanceStatus` a second time against the adjusted totals and show both
badges) if wanted.

## Human Check List (for qa / manual click-through)

1. Open `/admin/ledger/administrative/report` (Club entity). With no `?fy=` param, confirm the
   banner defaults to **FY2025 — Closed** (today is 2026-07-28; current FY2026 is in progress, so
   the most-recently-closed FY is FY2025) and the page's own report table/stat grid also reflects
   FY2025 (the default changed for the whole page, not just the banner).
2. On the Administrative fund FY2025, confirm the dues-adjusted income block renders (Administrative
   is the only fund with dues activity) and that the dues-adjusted figure genuinely differs from the
   cash-basis figure — the June 2026 early FY2026 dues payments should be excluded from FY2025's
   adjusted total even though they're included in cash-basis.
3. Flip to FY2026 via `FiscalYearSelector` — confirm the banner now reads **"In progress"**, and the
   dues-adjusted figure for FY2026 is HIGHER than cash-basis (the early payments now count toward
   the year they're actually for).
4. Open a charitable or scholarship fund's report page with a planned drawdown (expense > income for
   the year) — confirm the badge reads "Planned drawdown — OK" (gold/info styling), NOT a red/amber
   "broken" treatment, and the dues-adjustment block does not render (no dues activity on that fund).
5. Open the Activity fund — confirm "Balanced" within the $100 pass-through tolerance, "Off-balance"
   outside it, and no dues-adjustment block.
6. Find (or create) a fund/FY combination with zero income and zero expense — confirm the neutral
   "No activity recorded yet for FY20XX" empty state renders instead of a misleading "Balanced".
7. Confirm the existing report table, budget editor, and FiscalYearSelector below the new banner are
   completely unaffected — this feature is purely additive.
8. Mobile check at ~360px: banner card stacks cleanly, badge doesn't overflow, dues-adjustment grid
   collapses to one column.

**Nominate for Phase 5:** qa (typecheck/build already re-confirmed green above; qa should still run
its own pass plus the manual click-through above, especially items 1-3 which need a real DB with
actual dues/ledger data to observe, not just the hermetic unit tests).

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]

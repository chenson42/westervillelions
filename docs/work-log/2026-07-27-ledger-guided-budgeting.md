# Ledger Guided Budgeting (Copy-Forward + Balance Check) — Work Log

> **Slug:** `2026-07-27-ledger-guided-budgeting`
> **Surface:** (dashboard) admin — `/admin/ledger/*`
> **Permission(s):** existing `LEDGER_MANAGE` covers this — no new `FEATURES` key expected
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-27 |
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## Grounding note — what already exists (do not rebuild)

I read the code before writing this review. Confirmed, all present and working today:

- `ledger_budgets` (`src/lib/db/schema.ts:772-797`) — one row per `(fundId, fiscalYear, categoryId, flow)`, `annualAmountCents`. Unique constraint on that 4-tuple; indexed on `(fundId, fiscalYear)`.
- `getFundReport()` (`src/lib/ledger-queries.ts:357`) already builds a full Budget/Actual/Variance table per fund × FY, left-joining actuals against budget rows, including categories that only have actuals (no budget → "—") and deactivated categories that still have posted history.
- `budgetVariance()` (`src/lib/ledger.ts:245`) — unit-tested, handles the `budgetCents === null` and `budgetCents === 0` cases correctly (positive variance = under budget).
- The report page (`src/app/(dashboard)/admin/ledger/[fundSlug]/report/page.tsx`) renders this today, with an inline `BudgetEditor` (`src/components/admin/ledger/budget-editor.tsx`) that PATCHes `/api/admin/ledger/budgets` per category/flow line, gated by `LEDGER_MANAGE` (checked both in the Server Component and again inside the route handler — good defense in depth). Empty amount = delete the row; `0` is a valid explicit budget.
- Fund model confirmed from `drizzle/migrations/0044_ledger_books.sql`: **Club** entity owns `administrative` + `activity` funds; **Foundation** entity owns `charitable` + `scholarship` funds. This is the concrete shape of "two self-balancing budgets" — Administrative is the Club's operating budget, Activity is the Club-side charitable clearing account, and Charitable/Scholarship are the Foundation's program funds.
- Transfers (`src/app/api/admin/ledger/transactions/route.ts:420-448`, DECISION-016/017) are two linked rows with `transferGroupId` set but **no `categoryId`**. `getFundReport`'s actual-aggregation only buckets transactions `if (txn.categoryId)` — so transfers are already excluded from per-category actuals today. **Not a gap**; confirmed by reading the insert path, not assumed.
- `getEntityReport()` (`src/lib/ledger-queries.ts:1666`) hardcodes `budgetCents: null` at lines 1799/1813 — the entity-level rollup genuinely has no budget story. Confirmed, and out of scope per the brief (secondary gap, not this increment).

What's missing, confirmed by reading `budget-editor.tsx` and the route: there is **no copy-forward**, **no cross-fund balance indicator**, and **no adoption/versioning concept anywhere in the codebase** (grepped `docs/decisions.md` and `src` for "adopted"/"board adopt" — zero hits specific to budgets). Today, building next year's budget means typing every line into a blank input, fund by fund, with no signal about whether income and expense targets balance.

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Let the treasurer seed next year's budget from this year's actuals with one action per fund (or all four at once), then show a live "does income cover expense" balance readout while they adjust — but the request leaves open five decisions (copy source, overwrite policy, what "balanced" numerically means per fund kind, advisory-vs-block, and whether "adopted" status is in scope) that materially change the design and must be settled before Phase 3.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (LEDGER_MANAGE) | Navigate to a budgeting entry point for a target fiscal year | Once per budget season (typically spring, ahead of the Jul 1 FY start) |
| Admin (LEDGER_MANAGE) | Trigger "copy forward" for one fund or all four funds | Once per fund per season (idempotent re-trigger should be safe — see gaps) |
| Admin (LEDGER_MANAGE) | Review the pre-filled category/flow lines seeded from last year | Per fund |
| Admin (LEDGER_MANAGE) | Adjust individual budget line amounts inline (reusing `BudgetEditor`) | Per line, as needed |
| Admin (LEDGER_MANAGE) | Read a per-fund balance indicator (income target vs. expense target) | Continuously, as they edit |
| Admin (LEDGER_MANAGE) | (Open question) Mark a fund's budget "adopted"/final | Once per fund per season — **not confirmed in scope** |

No other surface touches this. Anonymous visitors, access-pending members, and signed-in members never see a budget number — `LEDGER_VIEW`/`LEDGER_RECORD` users can already *see* the existing Budget vs Actual report (read-only), but guided setup itself is `LEDGER_MANAGE`-only, matching the existing `BudgetEditor` gate.

## Flows

**Flow 1 — Seed a fund's budget from last year:**
Entry: a new action on the existing fund report page (or a new `/admin/ledger/budgeting` landing — **Phase 2/3 placement decision, see gaps**) — e.g. "Copy FY2026 actuals forward to FY2027."
→ Treasurer picks the target FY (defaults to next FY after the latest FY with data) and confirms the source (prior actuals vs. prior budget — **open question**).
→ System copies one row per active category+flow into `ledger_budgets` for `(fund, targetFY)`.
→ Treasurer lands on the (now-familiar) `BudgetEditor`, pre-filled instead of blank, and adjusts numbers inline exactly as today.
→ **Success outcome:** budget rows exist for the target FY, editable individually, same save-on-blur UX as today.
→ **Failure path (not addressed by the request):** target FY already has some budget rows for this fund (partial or complete). Today's blank-editor flow never has to answer "overwrite or merge?" — guided setup does. No behavior specified. Needs a `<ConfirmDialog>`-driven choice (merge/skip-existing vs. overwrite-all), not a silent overwrite.
→ **Failure path (empty prior year):** prior FY has zero posted transactions for this fund (brand-new fund, or first budget season) — button should say why it's disabled/no-op ("No FY2026 activity to copy from — enter amounts directly below") rather than silently producing an empty result that looks like the action did nothing.

**Flow 2 — Balance guidance while editing:**
Entry: same page, live as budget lines are entered/edited (post-seed or from-scratch).
→ System sums budgeted income vs. budgeted expense for the fund being edited.
→ **Success outcome:** a visible status readout — e.g. "Income $X vs. Expense $Y — balanced" (green) or "Expense exceeds income by $Z" (amber).
→ **Failure/warning path:** what happens when a fund is *not* balanced is the central undefined behavior in the request. Is it advisory only (readout stays amber, save still succeeds — my recommendation, see gaps) or a hard block on saving further lines? The request says "guide," which reads as advisory, but this needs an explicit answer, not an inferred one.

## Permissions

- **Permission:** existing `LEDGER_MANAGE` ("Manage funds, budgets, entities, and opening balances," `src/lib/permissions.ts:56,123`) covers both copy-forward and the balance readout — same gate the current `BudgetEditor`/`PATCH /api/admin/ledger/budgets` already enforce. No new `FEATURES` key needed.
- **Default roles:** whichever roles are already bound to `LEDGER_MANAGE` (treasurer, admin) — unchanged.
- A new copy-forward endpoint (likely `POST /api/admin/ledger/budgets/seed` or similar) must re-check `hasFeature(..., FEATURES.LEDGER_MANAGE)` server-side, exactly as `budgets/route.ts` does today — do not rely on the page-level gate alone.

## Gaps the Request Didn't Address

- **Copy source — prior actuals or prior budget?** The request says "guide us through budgeting... measure against the budget," and Chuck's ask says "copy prior-year actuals forward as a starting budget." That reads as: default source = prior FY's *actual* spend/income, not prior FY's *budget* (if one existed). But if a category has a prior budget and zero actuals (e.g., a new program that never got funded), copying "actuals" gives $0, silently discarding the prior intent. **Resolution to confirm with user:** default to prior-year actuals; if a category has actuals of $0 AND a nonzero prior budget, surface both and let the treasurer pick, rather than silently picking one.
- **New/removed categories.** A category active this year but not last year has no actual to copy — leave the line blank (treasurer fills manually), same as today's blank editor. A category deactivated since last year should not appear (matches `getFundReport`'s existing `isActive` scoping) even though it may have had a budget or actuals last year. This should be stated explicitly in the design, not left implicit.
- **Round/inflation adjustment.** Raw dollar-for-dollar copy (no automatic inflation bump) is the safer v1 default — treasurers can eyeball and adjust individual lines using the existing editor. Confirm this is acceptable; if the club wants a "+3% across the board" toggle, that's an explicit, separate control, not baked into copy-forward silently.
- **Per-fund vs. all-funds-at-once.** With only 4 funds total (administrative, activity, charitable, scholarship), a single "copy all funds forward" action followed by fund-by-fund review is plausible and lower-friction than four separate button clicks — but each fund's *balance check* is inherently per-fund, so the review step is still per-fund regardless of how copy is triggered. Confirm which UX the user wants; my read of "guide us through budgeting" leans toward a single guided sweep across all four funds with the balance check as the per-fund checkpoint.
- **Overwrite vs. merge on re-trigger.** If a treasurer runs copy-forward, edits some lines, then re-runs it (e.g. wrong source FY picked first), what happens to lines they've already touched? Silently clobbering manual edits is a real footgun. Recommend: copy-forward only fills categories that have **no existing row** for the target FY by default, with an explicit, confirm-dialog-gated "overwrite everything" option for a genuine do-over.
- **What "self-balancing" means numerically, per fund kind — this is the crux of the feature and is not fully specified.** Article VII §3(g) is about *use of publicly-raised funds*, not "every fund must net to zero every year." Concretely, for the two-entity/four-fund shape actually in the schema:
  - **Administrative fund (Club):** operating budget — income target should cover expense target (dues, fundraising-earmarked-for-ops if any, etc. ≥ operating costs), since public donations may never subsidize it. This is the fund where the invariant is sharpest.
  - **Activity fund (Club):** a clearing account for publicly-raised charitable money passing through the Club before disbursement — "balanced" here plausibly means *planned receipts ≈ planned disbursements* (net near zero by design), not "income exceeds expense."
  - **Charitable / Scholarship funds (Foundation):** program funds that may legitimately run a planned deficit funded from an existing reserve or endowment (a scholarship fund spending down an accumulated balance is normal, not a violation). Applying the same "income ≥ expense" rule here could produce false-positive warnings that erode trust in the tool.
  This means a single balance rule cannot mechanically apply to all four funds identically. **I'm flagging this rather than guessing** — the user (Chuck, as treasurer) needs to confirm which fund(s) get which rule before tech-lead can design the check.
- **Advisory vs. hard block.** Recommend the balance indicator is advisory only (never blocks saving a line) — a treasurer may legitimately plan a drawdown year. A hard block would fight real, legitimate budgeting decisions. Confirm with user; this is a one-sentence decision but changes the API contract (does the PATCH endpoint need a "confirm anyway" override, or is it purely a UI-side readout with no server enforcement?).
- **Draft vs. adopted budget.** Chuck's framing says "the board formally ADOPTS the budget." Today `ledger_budgets` rows are just upsert-in-place with no draft/final state, no board-minute reference (contrast with `ledgerTransactions.boardMinute`, which *does* exist for approved disbursements). Capturing "adopted" is a real, named requirement in the brief, not a hypothetical — but the brief also frames guided setup as the priority increment and lists adoption capture as open. **Recommend:** v1 guided setup ships as upsert-in-place (no draft/adopted state), and "capture board adoption of the budget (date + board-minute reference, mirroring `ledgerTransactions.boardMinute`)" is logged as an explicit follow-up/backlog item — not silently dropped. This needs the user's explicit sign-off since it's a named ask, not an inferred nice-to-have.
- **Mid-year FY rollover during editing.** Low risk: `ledger_budgets` rows are keyed by an explicit `fiscalYear` integer chosen by the treasurer, not an implicit "current FY," so a session spanning a Jul 1 rollover doesn't corrupt anything — the treasurer is editing whatever FY they picked in the selector. Confirmed safe by reading `currentFiscalYear`/`fyBounds` usage; no special handling needed.
- **Entity-level rollup absence (secondary, per brief).** `getEntityReport` hardcodes `budgetCents: null` — a "does the whole Club balance" or "does the whole Foundation balance" view doesn't exist. The brief explicitly scopes this out of the current increment; I agree that's reasonable, but the guided-setup UI will *feel* incomplete without at least showing the Administrative+Activity pair and Charitable+Scholarship pair side by side during setup, since that pairing is the actual Lions-Way self-balancing unit. Recommend tech-lead scope a small new aggregation (sum of already-fetched fund reports client/server-side), not a rebuild of `getEntityReport`.
- **Mid-year/prorated pacing (secondary, per brief).** Confirmed out of scope — targets stay annual-only for this increment. Noted so it isn't silently forgotten; log to backlog if not already there.

## Out of Scope (confirm with user)

- Consolidated entity-level (Club-wide / Foundation-wide) budget-vs-actual rollup — brief already defers this.
- Mid-year YTD/prorated budget pacing — brief already defers this.
- Formal "adopted" budget status + board-minute capture — recommended as a follow-up, not this increment, pending user confirmation (see gap above; this is the one item where "out of scope" is my recommendation, not an assumption already agreed).
- Automatic inflation/COLA adjustment on copy-forward — raw copy only, unless the user asks otherwise.

## Open Questions

- Copy source: prior-year **actuals**, prior-year **budget**, or "whichever is nonzero, prefer actuals"?
- All-funds-at-once seeding with per-fund review, or one explicit action per fund?
- Overwrite policy on re-trigger: skip-existing (merge) by default, with an explicit destructive "overwrite all" path? Or always overwrite with a single confirm?
- What does "balanced" mean numerically for the Activity fund and for the two Foundation funds (Charitable, Scholarship) — same "income ≥ expense" rule as Administrative, or a different rule (e.g., "planned draw from reserve is fine, flag only if it exceeds available fund balance")?
- Advisory-only balance warning, or does an unbalanced fund block anything (e.g., prevents navigating away, requires an acknowledgment)?
- Is board-adoption capture (date, board-minute reference) in scope for this increment, or logged as a named follow-up?

---

# Phase 2 — Architectural Review (architect)

## Verdict

Pending

---

# Phase 3 — Technical Design (tech-lead)

Pending

---

# Phase 4 — Implementation

Pending

---

# Phase 5 — Verification (qa)

Pending

---

# Phase 6 — Shipped vs Intent (analyst)

Pending

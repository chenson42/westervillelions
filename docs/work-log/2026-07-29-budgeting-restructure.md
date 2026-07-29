# Budgeting Page Restructure — Work Log

> **Slug:** `2026-07-29-budgeting-restructure`
> **Surface:** (dashboard) admin — The Ledger budgeting (`/admin/ledger/budgeting`) + printable worksheet
> **Permission(s):** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) — no new key
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Backlog:** B-29 (see `docs/backlog.md`); folds in B-31 (line items on the printable/mailed budget)

---

## Feature Request / Intent (source for Phase 1)

Came directly out of the FY2026 budget meeting, where the treasurer (Chris) had to
take notes by hand because the budgeting page fought him on the two most common
actions — **adding and removing lines** — live in front of the board.

**The problem, in the treasurer's words + our diagnosis:**
- **Add category** lives at the *bottom* of each fund card — hard to find mid-meeting.
- **Adding a beneficiary line** requires first clicking "Break down by cause" (non-obvious),
  then a single bottom "+ Add line" that creates a row **hard-defaulted to the first cause
  ("Vision & Eye Care")**, which jumps into that group and forces a per-row cause dropdown
  to fix. Chris described it as "add line just added a line to the first cause."
- **Removing** required **multiple clicks to register** (suspected "blur eats the first click":
  a focused amount input's `onBlur` commits + `router.refresh()`, re-rendering the trash button
  out from under the cursor before the click lands).
- There is **no explicit remove for a whole cause**, and **no category-level remove once a
  category is in breakdown mode** — Chris wants removal explicit at every level.

**Agreed shape (settled with Chris across the 2026-07-29 debrief):**

Under each fund, replace the flat interleaved income/expense list with two labeled
**sections**:

- **Income** section (header) — header carries a `+ add category` control.
- **Expense** section (header) — header carries a `+ add category` control.

`+` affordances (little icons) at each grain:
- **Section header → `+ add category`** (existing-or-new picker; moved to the top).
- **Category row → `+ add cause`** — only on **giving-eligible expense categories**
  (`isCauseEligibleCategory`: expense + countsAsGiving). Opens a cause picker once.
- **Cause row → `+ add line item`** — the new line **inherits that cause by context**, so the
  per-line cause `<select>` in `budget-cause-editor.tsx` **goes away entirely**.

Removes — **explicit at every level, reliable on the first click**:
- **Line item** → immediate remove **+ quiet Undo**.
- **Cause** → explicit remove, **confirm** ("Remove *Environment* and its N line items?").
- **Category** → explicit remove, available **even in breakdown mode**, **confirm** when it
  takes causes/lines with it.
- Fix the multi-click race so one click always works.

**Printable worksheet (B-31 folded in):** `budget-print-worksheet.tsx` renders at the
*category grain only* today. The printable version is **what gets mailed to members/board to
review**, so it must render the **cause + line-item detail** and be presentable/traceable.

**Model is UNCHANGED:** line items always live under a cause; causes only on eligible expense
categories. No bare line items on a category. (Chris explicitly withdrew the "add line item
directly under a category" idea.)

**Explicitly deferred (NOT this feature — separate backlog items):**
- **B-30** — explicit transaction→budget-line link (retires the label=party string match).
  Sequenced *after* this. Note: because B-30 will free the label from being the reconciliation
  key, **do not build a label=party autocomplete here** — it would be undone by B-30.
- **Star/notes** discussion flags (`docs/work-log/2026-07-28-budget-star-notes.md`, Phases 1–2
  done) — hangs on *this* new layout, sequenced third.
- **T-25** — category catalog cleanup / traceability (books task, runs alongside B-30).

**Known interactions Phase 1 must weigh:** the lump-sum ↔ cause-breakdown transition (a category
with no causes shows just an amount; adding the first cause enters breakdown; removing the last
cause / "collapse to lump sum" reverses it), the Approve-&-lock state (all add/remove controls
disabled when locked — `assertBudgetUnlocked` is the real gate), soft-delete/restore behavior for
category rows (DECISION-052/053 — `pending_delete_at`, stays visible struck-through until finalize)
vs. the new "immediate + undo" ask (reconcile these two removal models), empty sections (a fund/flow
with zero categories still shows its header + add control), and the live Income/Expenses/Banked-used
running totals (must keep tracking through the new add/remove flows — see
`2026-07-28-budget-live-totals-stale.md`).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-29 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-29 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-29 |
| 4 — Implementation | database-admin (schema) → api-developer → ux-developer | Complete | schema + API + UI all complete, qa next | 2026-07-29 |
| 5 — Verification | qa | Complete | PASS | 2026-07-29 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-29 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Splitting Income/Expense and pushing add-affordances up to the section/category/cause grain is a clean, low-risk reshuffle of an existing screen — but "explicit remove at every grain, reliable on the first click" collides head-on with a server guard that today hard-rejects removing a category that still has cause-line children, so the single biggest thing this Phase 1 review resolves-or-flags is *what "remove a category in breakdown mode" actually does to its children*, not the section/header cosmetics.

## User Verbs

All verbs below are **Admin, `ledger.manage`** only — this feature has no public or member-portal surface.

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.manage`) | Click "+ add category" on an Income or Expense section header | Occasional, mid-meeting |
| Admin (`ledger.manage`) | Pick an existing-or-new category in the add-category form | Occasional |
| Admin (`ledger.manage`) | Click "+ add cause" on a giving-eligible expense category row | Occasional, mid-meeting |
| Admin (`ledger.manage`) | Pick a cause from the one-time cause picker | Occasional |
| Admin (`ledger.manage`) | Click "+ add line item" on a cause row | Frequent, mid-meeting (this is the treasurer's most common live action) |
| Admin (`ledger.manage`) | Type a beneficiary label + amount for a new line item | Frequent |
| Admin (`ledger.manage`) | Remove a line item (immediate + Undo) | Frequent |
| Admin (`ledger.manage`) | Click Undo on a just-removed line item | Occasional, time-boxed |
| Admin (`ledger.manage`) | Remove a whole cause group (confirm) | Occasional |
| Admin (`ledger.manage`) | Remove a whole category, lump-sum or in breakdown (confirm) | Occasional |
| Admin (`ledger.manage`) | Restore a soft-deleted category before finalize | Occasional |
| Admin (`ledger.manage`) | Collapse a category's breakdown back to lump sum (existing, unchanged) | Rare |
| Admin (`ledger.manage`) | Print/save the budget worksheet (now cause + line-item grain) | Per board meeting |
| Admin (`ledger.manage`) | Approve & lock / Unlock the FY budget (existing, unchanged) | Rare |

The request is entirely verb-shaped already (concrete clicks named in the debrief) — no "the system supports X" language to flag here.

## Flows

**Flow 1 — Add a category from a section header.**
Entry: `/admin/ledger/budgeting`, a fund card, the **Income** or **Expense** section header's `+ add category`.
Step: click opens the existing-or-new picker (unchanged form, just relocated + triggered from the header instead of the bottom of the card).
Step: pick an existing unbudgeted category, or type a new name (+ counts-as-giving + optional 990 line).
Outcome: category row appears under the section header at `$0`/blank, section total updates.
Failure: blank name on "new" → inline "Category name is required" (existing). Network/DB failure on either path → toast error, form stays open with entered values intact (existing pattern, confirmed in `guided-budget-setup.tsx`'s catch blocks) — no silent loss of typed input.

**Flow 2 — Add a cause to a giving-eligible expense category.**
Entry: a category row under **Expense** where `isCauseEligibleCategory` is true (expense + `countsAsGiving`), currently lump-sum.
Step: click `+ add cause` on the category row → a one-time cause picker (the 8 `BUDGET_CAUSES` + "Other community support," excluding causes already in use on this category) → pick one.
Outcome: category enters breakdown mode with one pending, unsaved row under the chosen cause (mirrors today's `enterBreakdown`/`OTHER_COMMUNITY_SUPPORT_CAUSE` pre-fill, just cause-selected instead of hard-defaulted). Per-line cause `<select>` does not appear — the row is already scoped to the chosen cause.
Step: type an amount (and optionally a label) → blur/Enter commits, creating the category's first `ledger_budgets` + `ledger_budget_lines` rows.
Outcome: cause group renders with a subtotal; `+ add cause` remains available on the category row so a **second, third** cause can be added later (this must not disappear after the first cause — see Gap 2).
Failure: leaving the pending row blank and navigating away is a no-op (existing "Cancel" behavior in `budget-cause-editor.tsx`, nothing was ever written) — this must still work once entry is triggered from the category row instead of the bottom "Break down by cause" link.

**Flow 3 — Add a line item under an existing cause.**
Entry: an existing cause group (rendered under a category already in breakdown), the group's `+ add line item`.
Step: click appends a new blank labeled row **already scoped to that cause** — no cause dropdown, matching the brief's "add line just added a line to the first cause" complaint being fixed at the root.
Step: type a label (optional, datalist-assisted) + amount → blur/Enter commits (`commitCreate`, existing).
Outcome: new line appears under the correct cause group immediately; cause subtotal and category/fund totals update live.
Failure: over-length label → existing inline toast ("Label must be N characters or fewer"); duplicate `(cause, label)` → existing `409 duplicate_cause_label` → "A line for this cause and label already exists — edit it instead."

**Flow 4 — Remove a line item (immediate + Undo).**
Entry: any committed cause-line row's remove control.
Step: single click removes the line **immediately, no ConfirmDialog** — this is a change from today's behavior (today: no confirm only when the amount is $0; a `ConfirmDialog` otherwise). A toast/snackbar with "Removed — Undo" appears for a short window.
Outcome (no Undo clicked): line is gone from the category total and (eventually) the server; window closes, action is final.
Outcome (Undo clicked): line and its exact values (cause, label, amount) reappear as if nothing happened.
Failure: the remove/undo network call fails → toast "Could not remove/restore this line. Try again," line reverts to its pre-action state (must not leave the UI showing a line that no longer exists server-side, or vice versa).
**Open design question this flow surfaces:** is "Undo" a *delayed commit* (the DELETE request itself is held for the toast's duration and only actually fires if Undo isn't clicked) or a *fire-then-recreate* (DELETE fires immediately; Undo does a fresh `POST`/create with the same values)? These have different failure modes — see Gap 3.

**Flow 5 — Remove a whole cause group.**
Entry: a cause group header's remove control (new — doesn't exist today).
Step: click → `ConfirmDialog`: "Remove *Environment* and its N line items?" (brief's own copy).
Outcome (confirm): every line under that cause is deleted in one action; if it was the category's last remaining cause, the category reverts to lump sum, blank (mirrors today's single-line-at-a-time "emptied" `onExitBreakdown` path, just reached in one click instead of N).
Failure: locked budget / network error → existing-style toast, no partial deletion (must be one transaction, not N sequential DELETEs that could partially fail).

**Flow 6 — Remove a whole category (lump sum or in breakdown).**
Entry: a category row's remove control — must now render **even when the category is in breakdown mode**, which is new (today `BudgetEditor`'s trash icon is only rendered in the non-breakdown branch, and the server 409s `has_cause_breakdown` on any category write while cause-line children exist).
Step: click → `ConfirmDialog`. Copy must differ meaningfully when causes/lines exist ("Remove *Peace Poster Contest* and its 3 causes / 7 line items?") vs. a plain lump-sum category ("Remove *Peace Poster Contest*?").
Outcome: category (and, if applicable, everything nested under it) disappears from the section; section/fund totals update.
Failure: locked budget → existing 409 lock message. **This flow cannot be built as a thin UI change** — it requires resolving the server-side conflict named in Gap 1 first.

**Flow 7 — Empty section.**
Entry: a fund with zero categories in one flow (e.g., a brand-new Charitable fund with expense categories but no income categories yet).
Outcome: the **Income** (or **Expense**) section still renders its header and `+ add category` — today this is fund-wide ("No categories yet for this fund" spans both flows via a single `budgetEditorLines.length > 0` check), so a fund with expense-only categories currently shows no "add the first one" affordance for income at all. This must become per-section, not per-fund.

**Flow 8 — Locked budget.**
Entry: any of the above, with `locked === true`.
Outcome: every add/remove/undo control is hidden or disabled (existing `editorDisabled = locked || !canManage` pattern extends to the new controls); `assertBudgetUnlocked()` is the real gate for any new server endpoint this feature introduces (cause-group cascade delete, category cascade delete) — same as every existing write path.

## Permissions

- **Permission:** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) — covers every verb above, identical to today's add-category/edit-amount/cause-line gate. No new `FEATURES` key.
- **Default roles:** unchanged — whichever roles already carry `ledger.manage` (Admin, Treasurer-equivalent).
- **New server endpoints this feature implies** (cause-group cascade delete, category cascade delete covering the breakdown case) must each independently call `assertBudgetUnlocked()` and re-check `ledger.manage` server-side — the existing pattern (every write helper in `ledger-queries.ts` re-derives the lock from `fund.entityId` + `fiscalYear`, never trusts the client) must extend to these, not be skipped because "the UI already hid the button."

## Gaps the Request Didn't Address

1. **The two removal models collide, and the collision is a real server guard, not a hypothetical.** `upsertBudgetLine` (the function behind every category-level write, including soft-delete) explicitly 409s with `reason: "has_cause_breakdown"` — *"This category is broken down by cause — edit its cause lines instead"* — whenever `ledger_budget_lines` rows exist under it (`src/lib/ledger-queries.ts` ~line 986). That's precisely the case Flow 6 needs to support ("available even in breakdown mode"). Today's category soft-delete/restore-until-finalize model (DECISION-052/053, `pendingDeleteAt`) also has no equivalent flag on `ledger_budget_lines` — there's no way to "soft-delete" a category's children in step with it. Two structurally different resolutions are possible, and Phase 3 needs to pick one on purpose:
   - **(a) Category removal cascades as a hard delete when it carries causes/lines** (matching cause-line removal's own semantics — gone means gone, no Restore), while a **plain lump-sum category** keeps today's reversible soft-delete/Restore. This is the smaller change (no schema touch) but means "Remove category" behaves differently depending on whether it's in breakdown mode — a real, if narrow, inconsistency a treasurer could be surprised by ("I could undo removing this category yesterday, why not today?").
   - **(b) Extend the soft-delete/restore-until-finalize model down to `ledger_budget_lines`** (a `pendingDeleteAt` column there too, purged atomically with the parent on Approve & lock, restored atomically on category Restore). This makes category removal *uniformly* reversible-until-finalize regardless of breakdown state — the more consistent mental model — but is a schema change and touches the finalize-purge transaction, the live-totals exclusion (`computeFundLineSums` would need to also exclude pending-delete cause lines, not just category lines), and the print-worksheet exclusion filter.
   - **My recommendation:** (b). The brief's own stated goal is "removal explicit at every level" as one coherent story, and the existing category-level reversibility is a feature the treasurer already relies on (DECISION-052 exists *because* accidental deletion was judged too costly to be irreversible) — it would be a regression in the exact scenario (mid-meeting, in front of the board) this whole feature is for if lump-sum categories stay recoverable but breakdown categories don't. But this is a schema-touching call, not a cosmetic one, so it's flagged as an open question rather than silently assumed.
2. **"+ add cause" persistence isn't specified.** The brief says the category row's `+ add cause` "opens a cause picker once" — read literally that could mean the control disappears after the first cause is added. But a category can legitimately have multiple causes (the existing `budget-cause-editor.tsx` already groups rows by cause and supports several groups per category), so `+ add cause` must **stay available** on a category already in breakdown, offering only causes not yet in use, to add a second/third cause group. If it's meant to disappear after one use, that's a real scope-narrowing the brief didn't say out loud and would contradict the existing multi-cause data model.
3. **"Undo" mechanism is unspecified and has two structurally different implementations.** Delayed-commit (hold the DELETE until the toast expires, cancel-able) vs. fire-then-recreate (DELETE now, Undo re-`POST`s the same values). The second reuses 100% existing endpoints but loses the original row's `id` (fine functionally, since `causeLineReferenceKey` matches on `(categoryId, cause, label)` content, not id) and briefly shows a real gap in the server's row set if `router.refresh()` lands between the delete and an undo click. The first avoids that gap but requires a new client-side pending-action queue that doesn't exist anywhere in this codebase's editors today. Recommend tech-lead pick delayed-commit for the lower race-condition surface, but this is worth naming explicitly rather than each implementer guessing differently.
4. **The multi-click remove bug — named precisely for a fix, not just "make it reliable."** The failure is a **blur-vs-click race triggered by `router.refresh()`**: every amount-input's `onBlur` fires `handleCommit` → `commitValue` (async `fetch`) → on success, `router.refresh()`. If a treasurer's mouse action requires the amount input to lose focus at the same moment the trash icon is clicked (e.g., they just typed a value on that row, or an adjacent row, and go straight for the remove button), the native event order is: `mousedown` → synchronous `blur` fires on the still-focused input (queuing the async commit) → `mouseup`/`click` fires on the trash icon shortly after. If the commit's `router.refresh()` resolves and React reconciles the fund's category list **before** the click event is dispatched (plausible on any real network latency, and *guaranteed* if the reconciliation reorders rows, which soft-delete/restore and the new add flows all do), the click lands on a DOM node that either moved or was replaced — the browser has nothing live to deliver the click to, so it's silently dropped. The very next click, with no pending blur in front of it, lands cleanly. **Concrete repro for QA:** focus any amount input, type a value, then — without blurring first — click a *different* row's remove control on a slow/throttled network; observe the first click does nothing and a second click is required. **Concrete fix directions for tech-lead:** (i) `onMouseDown={(e) => e.preventDefault()}` on every remove/add control to suppress the blur-triggered commit from racing the click at all, or (ii) key every row on something stable across a refresh (already true — `${categoryId}_${flow}` and cause-line `id` are both stable) *and* avoid remounting the button (only updating props) so a mid-flight refresh can't detach the exact node the browser is mid-click on, or (iii) disable-and-hold every remove control for the duration of any in-flight commit anywhere on the page, so a race can't land on a half-updated list. Any of these needs a Playwright test that simulates the exact interleaving (type → don't blur → click elsewhere under artificial latency), not just a manual click-through, since the bug is timing-dependent and can pass a quick manual test while still shipping broken.
5. **Printable worksheet at cause + line-item grain — the exclusion rules used today were written for category-only rendering and need re-deriving, not just extending.** `budget-print-worksheet.tsx` currently filters out `pendingDeleteAt !== null` categories entirely (Gap resolution (b) above would introduce an equivalent flag on cause lines that this filter needs to also honor, or a partially-deleted category could print with stale children). Concretely in scope for this increment: each category prints its cause-group subtotals and per-line labels/amounts (the treasurer's stated need: "traceable" back to what the board actually voted on a beneficiary-by-beneficiary basis). Concretely **out of scope**: preserving the "~2 blank ruled lines per category" hand-annotation convention at the *line-item* grain too (that would roughly double or triple the page count for a heavily-broken-down fund) — recommend keeping the blank ruled lines at the category-subtotal level only, with cause/line rows rendered compactly above them. Flag this specific print-density tradeoff to the user rather than have ux-developer invent a page-count answer under deadline pressure.
6. **This restructure is a hard dependency for the already-drafted Star & Notes feature** (`docs/work-log/2026-07-28-budget-star-notes.md`, Phases 1–2 already complete, explicitly sequenced to start *after* this). That work-log's Phase 1 flows describe star/note affordances anchored to "a category row in `budget-editor.tsx`" and "a cause line row in `budget-cause-editor.tsx`" — if this restructure changes those components' row/section shape materially (which it does — sections, cause-group headers with their own remove controls, category-level breakdown-mode remove), whoever picks up Star & Notes next needs to re-confirm its Phase 1 flow descriptions still match the post-restructure DOM/row structure before writing code. Not a blocker for *this* feature, but worth a one-line pointer in this work-log's handoff so it isn't rediscovered the hard way.
7. **Mobile at 360px.** Every new affordance (`+ add cause`, `+ add line item`, cause-group remove, category remove-in-breakdown) is another small tap target layered onto an already-dense, three-level-nested editor (`budget-cause-editor.tsx`'s own doc comment already calls itself "the third nested layer in an already-dense editor"). The existing 44px min-height/min-width convention must extend to every new control — flag this explicitly since a board-meeting user is at least as likely to be on a phone as a laptop.

## Out of Scope (confirm with user)

- **B-30** (transaction→budget-line link) and any label=party autocomplete built in anticipation of it — explicitly withdrawn by the brief, noting again here per the boundary instructions so no implementer reintroduces it "for convenience."
- **Star/notes** (separate work-log, sequenced third) — not touched by this feature beyond the dependency note in Gap 6.
- **T-25** (category catalog cleanup/traceability) — books task, runs alongside B-30, not this feature.
- Changing the underlying line-item-always-lives-under-a-cause data model — brief confirms this is unchanged; this review found no reason to revisit that.
- Extending the print worksheet's blank-ruled-lines hand-annotation convention down to individual cause/line rows (see Gap 5) — recommend category-subtotal grain only for the annotation lines, cause/line detail rendered compactly without its own blank lines, unless the user wants the denser (and longer) alternative.

## Open Questions

1. **Gap 1 (the load-bearing one): does category removal in breakdown mode hard-cascade-delete its causes/lines (asymmetric with lump-sum categories, which stay soft-delete/Restore-able), or does the soft-delete/restore-until-finalize model extend down to `ledger_budget_lines` (schema change, uniform behavior, more work)?** My recommendation is the latter for consistency, but this changes Phase 3's data model and is the one thing genuinely worth the treasurer's sign-off before tech-lead designs the API.
2. **Does "+ add cause" stay visible on a category already in breakdown (to add a second/third cause), or is it truly one-shot per category?** (Gap 2) I'm assuming "stays visible, offers unused causes" as the only interpretation consistent with the existing multi-cause data model — flagging in case the treasurer actually wants one-cause-per-category as a new constraint.
3. **Undo semantics for line-item removal — delayed-commit vs. fire-then-recreate?** (Gap 3) Recommend delayed-commit; needs a decision before Phase 3 names the API shape.
4. **Print-worksheet density at cause/line grain** (Gap 5) — compact rendering with category-level annotation lines only (my recommendation), or full parity with today's per-category blank-line convention pushed down to every cause/line row (longer printout, but the treasurer explicitly wants this mailed doc to be hand-annotatable)?

**Recommended Phase 4 implementer split:** This spans schema (Gap 1's resolution + any print-exclusion field), two-to-three new/changed API routes (cause-group cascade delete, category cascade delete honoring breakdown mode, possibly an Undo-supporting endpoint shape) with real business logic (transactional cascades, lock/cause-line-child guards), and a substantial UI reorganization across three existing client components plus the print worksheet. This is exactly the shape the specialist split exists for (per prior Ledger increments) — **database-admin** (Gap 1's schema resolution + migration) → **api-developer** (cascade-delete endpoints, Undo mechanism, print-worksheet data assembly) → **ux-developer** (section split, header/row-grain `+` affordances, ConfirmDialog wiring, the blur/click-race fix in the UI layer, mobile tap targets). Reserve full-stack-developer only if Phase 3 finds the actual diff is much smaller than it looks from here.

## Open Questions — Resolved (Chris, 2026-07-29)

- **Q1 (category removal in breakdown mode) → RESOLVED: option (b), extend soft-delete/restore
  down to `ledger_budget_lines`.** Removing any category — lump-sum or broken-down — is
  reversible-until-finalize via Restore; children (cause lines) get a `pendingDeleteAt`-equivalent,
  excluded from the live totals (`computeFundLineSums`) and the print worksheet immediately, purged
  atomically with the parent on Approve & lock, restored atomically on category Restore. This is the
  **schema-touching decision** Phase 2/3 must design around. Uniform "remove = recoverable until
  finalize" mental model across both category shapes; no asymmetry.
- **Q4 (print-worksheet density) → RESOLVED: compact.** Every cause group + beneficiary line prints
  with its label/amount and per-cause subtotal; the blank hand-annotation ruled lines stay at the
  **category-subtotal grain only** (not per line item). Keeps the mailed packet a sensible length
  while remaining fully traceable beneficiary-by-beneficiary.
- **Q2 (`+ add cause` persistence) → DEFAULT applied:** stays visible on a category already in
  breakdown, offering only causes not yet used (the only reading consistent with the multi-cause
  model). Not one-shot.
- **Q3 (Undo mechanism) → DEFAULT applied:** delayed-commit (hold the DELETE until the toast
  expires, cancel-able) — tech-lead's call to finalize the API shape, analyst's recommendation
  stands as the default.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The reshuffle stays inside the existing four files plus
schema/queries under existing paths — no new directories, modules, or dependencies. The
schema move Chris resolved (Q1 → option (b)) is sound and mirrors the `ledger_budgets`
precedent exactly, but the finalize-purge transaction and the `has_cause_breakdown` guard
both need specific, non-cosmetic changes that Phase 3 must design deliberately, not
discover mid-implementation. Details below; nothing here should loop back to Phase 1 —
the resolved decisions already answer the open questions that mattered.

## Placement

No new top-level directories, modules, or npm dependencies are warranted. Everything stays
inside the paths named in the brief:

- `src/components/admin/ledger/guided-budget-setup.tsx`, `budget-editor.tsx`,
  `budget-cause-editor.tsx`, `budget-print-worksheet.tsx` — all four already live under
  `src/components/admin/ledger/` (not directly under `src/components/admin/`), which is
  the correct home per the directory rules (admin-only compositions) and is where every
  prior Ledger budgeting increment has landed. No relocation needed.
- `src/lib/db/schema.ts` (`ledgerBudgets`, `ledgerBudgetLines`) — schema change lands here
  first, per Key Invariants.
- `drizzle/migrations/` — new idempotent migration alongside the existing
  `0066_ledger_budgets_pending_delete.sql` precedent.
- `src/lib/ledger-queries.ts` (`upsertBudgetLine`, `setBudgetLinePendingDelete`,
  `createBudgetCauseLine`/`updateBudgetCauseLine`/`deleteBudgetCauseLine`,
  `collapseBudgetCauseLines`) and `src/lib/ledger.ts` (`computeFundLineSums`) — existing
  files, existing functions extended, no new files required.
- `src/app/api/admin/ledger/budget-approvals/route.ts` (the finalize-purge transaction)
  and `src/app/api/admin/ledger/budgets/cause-lines/route.ts` (cause-line DELETE) — existing
  route handlers, extended in place.

No new dependency is justified: the delayed-commit Undo needs only `setTimeout` (built-in)
and `sonner`'s existing `action` button on `toast()` — both already in the dependency set.

## Server / Client Split

Confirmed correct as scoped. All four components are already `'use client'` islands
consuming an existing API; nothing here needs a new server capability beyond what's named
below.

- **Delayed-commit Undo belongs entirely in the client island.** The "hold the DELETE
  until the toast expires" timer is pure client-side state (a `setTimeout` handle keyed by
  row id/reference-key, cleared on Undo, firing the real `DELETE` request only on expiry)
  living in `budget-cause-editor.tsx` (line-item Undo) and `budget-editor.tsx`
  (cause-group/category Undo, if those also get the delayed-commit treatment — Phase 3
  should confirm scope; the brief's Flow 4 names line items explicitly). **No new server
  endpoint is needed for Undo itself** — it's the same existing cause-line `DELETE`
  (`src/app/api/admin/ledger/budgets/cause-lines/route.ts`) the client would have called
  immediately today; delayed-commit only changes *when* the client fires the request it
  already knows how to send. Category/cause-group cascade delete (Flow 5/6) reuses
  `setBudgetLinePendingDelete` (see Invariants below) rather than a new route.
- **This is a new state-management shape for the project, but a small, well-contained
  one — not a concern.** I searched for an existing "hold an action, cancel via toast"
  pattern and found none: the one `setTimeout` in this component family
  (`acknowledge-dialog.tsx` line 60) is an unrelated search debounce, not a delayed-commit
  queue. So the pending-action timer (a `Record<key, ReturnType<typeof setTimeout>>` ref,
  a cleanup on unmount, a `sonner` toast with an `action: { label: "Undo", onClick }`) is
  genuinely new to this codebase's editors. It doesn't need a new dependency or a new
  shared primitive, though — it's local `useRef`/`useState` plus an existing toast
  capability. Flag it as new, not as a problem: Phase 3 should write down the exact
  contract once (row key format, timer duration, what happens if the user navigates away
  or the fund card re-renders mid-hold — `router.refresh()` firing from an unrelated
  commit must not silently cancel or double-fire a pending delayed delete) so
  `ux-developer` doesn't invent a different shape per component. If this pattern recurs on
  a third feature, it's worth promoting to a shared hook in `src/lib/hooks/`; one
  reasonable use doesn't justify that abstraction yet.

## Invariants Touched

This is the heart of the review — four invariants, in the order the prompt named them.

### 1. Schema-is-source-of-truth — the new `pendingDeleteAt` on `ledger_budget_lines`

**Ruling: sound, mirror the precedent exactly.** Add to `src/lib/db/schema.ts`, on
`ledgerBudgetLines` (currently `id`, `budgetId`, `cause`, `label`, `amountCents`,
`createdAt`, `updatedAt` — `src/lib/db/schema.ts:810-833`):

```ts
pendingDeleteAt: timestamp("pending_delete_at"),
```

Same nullable-timestamp semantics as `ledgerBudgets.pendingDeleteAt`
(`schema.ts:791`) — no default, null = normal row, set = marked for removal. The
migration is a one-line idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, matching
`drizzle/migrations/0066_ledger_budgets_pending_delete.sql` verbatim in shape (just a
different table name). Schema-first, migration-second ordering must be followed as usual.

**One thing Phase 3 must decide and write down, because it changes what "restore brings
the number back exactly" means at this grain too:** does a pending-delete cause line's
`amountCents` stay untouched and still count toward its parent's `annualAmountCents`
rollup while it's pending (mirroring the category-level precedent's own doc comment —
`setBudgetLinePendingDelete`'s "annual_amount_cents is never read or written by this
function... that is what makes 'restore brings the number back exactly' true by
construction, not by special-casing," `ledger-queries.ts:1092-1093`), or does the parent
total get recomputed to exclude it immediately? **Recommend the former** — it's the only
choice consistent with the existing precedent and it means `createBudgetCauseLine` /
`updateBudgetCauseLine` / `deleteBudgetCauseLine`'s existing `sumBudgetCauseLines(childRows)`
recompute (`ledger-queries.ts:1461-1470`, `1607-1616`, `1683-1697`) needs **zero changes** —
it keeps summing whatever rows physically exist, same as today, and a pending-delete row is
still a physically-existing row. All "live" exclusion then happens at the presentation/query
layer (item 4 below), never by mutating `annualAmountCents`. This is the same shape as the
category-level design and keeps the diff small; naming it explicitly here so nobody
re-derives an inconsistent answer independently in Phase 3/4.

### 2. Migrations re-run every deploy / idempotency

No concerns beyond the standard pattern — a single `ADD COLUMN IF NOT EXISTS` statement is
trivially idempotent and needs no seed-data or backfill logic (existing rows get `NULL`,
which is the correct "not pending-delete" default with no migration-time write required).

### 3. The finalize-purge transaction (Approve & lock)

This is where the review earns its keep. `src/app/api/admin/ledger/budget-approvals/route.ts`
(lines 148-164) currently runs exactly one statement inside the lock transaction:

```ts
await tx.delete(ledgerBudgets).where(
  and(eq(ledgerBudgets.entityId, entityId), eq(ledgerBudgets.fiscalYear, fiscalYear),
      isNotNull(ledgerBudgets.pendingDeleteAt)),
);
```

...and its own comment currently asserts (lines 152-155): *"Cause-line children can never
reach pending-delete (`setBudgetLinePendingDelete`'s own guard prevents it), so this delete
never triggers an unexpected `ledger_budget_lines` cascade."* **That comment becomes false
the moment this feature ships** and must be rewritten, not just left stale — a quiet
invariant violation is exactly the kind of thing the 30-day code review exists to catch,
so I'm flagging it now instead of waiting a month.

**Same transaction, extended — confirmed, not a new transaction.** But it needs two
additions, both real, neither cosmetic:

1. A second delete for cause lines that are pending-delete on their **own** flag while
   their parent category is **not** itself pending-delete (the "partial deletion within a
   live category" case named in the brief — Flow 4/5 acting alone, category never
   touched):
   ```ts
   await tx.delete(ledgerBudgetLines).where(
     and(
       inArray(ledgerBudgetLines.budgetId, tx.select({ id: ledgerBudgets.id }).from(ledgerBudgets)
         .where(and(eq(ledgerBudgets.entityId, entityId), eq(ledgerBudgets.fiscalYear, fiscalYear)))),
       isNotNull(ledgerBudgetLines.pendingDeleteAt),
     ),
   );
   ```
   Order relative to the existing category delete doesn't matter for correctness — the
   `ON DELETE CASCADE` on `ledgerBudgetLines.budgetId` already removes every child (pending
   or not) when its parent category is purged in step 1, so by the time step 2 runs, only
   children of *surviving* categories remain candidates.
2. **A recompute step step 1 never needed and this feature introduces:** once step 2
   physically deletes some-but-not-all of a live category's cause lines, that category's
   `annualAmountCents` (still holding the pre-purge sum, per the item-1 ruling above) is now
   stale and must be recomputed from the surviving children — the same
   `sumBudgetCauseLines`-shaped `UPDATE` `createBudgetCauseLine`/`deleteBudgetCauseLine`
   already do on every real-time edit, just run again here for every `budgetId` step 2
   touched. **And**: if step 2 deletes a category's *last* surviving cause line (every
   child was independently pending-delete, but nobody ever explicitly removed the category
   itself), the now-childless parent `ledger_budgets` row must also be deleted — mirroring
   `deleteBudgetCauseLine`'s existing "emptying the last line deletes the parent"
   behavior (`ledger-queries.ts:1688-1691`) exactly, just reached via finalize instead of a
   live edit. This is a genuinely new edge case (today's purge is a single unconditional
   `DELETE` with no downstream recompute, because deleting the *whole* category makes
   recompute moot) — Phase 3 must design this recompute-and-possibly-cascade step
   explicitly, not treat "extend the transaction" as a one-line change.

Both additions stay inside the **same** `db.transaction()` — no new transaction, no
change to the lock-check-then-write atomicity the existing code already closes a race on.

### 4. The `has_cause_breakdown` server guard

**Ruling: reuse `setBudgetLinePendingDelete`, with its own copy of the guard removed for
this function — no new code path.** Today (`ledger-queries.ts:1183-1199`)
`setBudgetLinePendingDelete` runs the identical cause-line-children check
`upsertBudgetLine` runs (`ledger-queries.ts:968-999`) and 409s with `has_cause_breakdown`
in both directions (soft-delete and restore), on the stated rationale that "a category
broken down by cause can never be marked pending-delete... this is defense-in-depth
against a direct API call" (`ledger-queries.ts:1183-1186`) — because until this feature,
the UI genuinely never offered that action. Flow 6 now requires exactly what that guard
forbids, so the guard must come out of **this function specifically**.

Critically, **`upsertBudgetLine`'s own copy of the same guard (lines 968-999) must stay
untouched** — that guard protects a completely different hazard (a numeric
`annualAmountCents` overwrite silently desyncing from real children, or a hard `DELETE`
cascading them away outright) that has nothing to do with the reversible soft-delete path
and is unrelated to this feature. Removing the guard in one place and not the other is not
an inconsistency; it's two different functions guarding two different write shapes.

**Why no cascade-write onto children is needed, and how "partial deletion within a live
category" stays coherent:** don't have category-level pending-delete *write* a flag onto
its children at all. Instead, every consumer that currently checks
"`pendingDeleteAt IS NOT NULL`" for exclusion purposes (the print worksheet, the
live-totals helper, the finalize purge above) must treat a cause line as excluded when
**either its own `pendingDeleteAt` is set, or its parent category's `pendingDeleteAt` is
set** — an OR, computed at read time, never written down. This is the cleanest resolution
of the exact edge case named in the brief: a cause line independently removed via Flow 4
keeps its own flag regardless of what later happens to the category (remove-then-restore
the *category* doesn't resurrect a line the treasurer separately removed on purpose), and
removing the whole category needs zero writes to its children — `setBudgetLinePendingDelete`
stays the pure single-row flag-flip it already is (`ledger-queries.ts:1201-1208`), just
without the guard blocking it. Restore is symmetric for the same reason. Name this OR
condition once, as a small shared predicate, so the print worksheet / live-totals /
finalize-purge don't each reinvent slightly different exclusion logic.

### `computeFundLineSums` — signature must change, stays pure

**Ruling: the Vitest seam is preserved, but the signature cannot stay two-argument.**
Today (`src/lib/ledger.ts:1702-1714`) it takes `lineValues` (one number per
`${categoryId}_${flow}`, the category's rolled-up total) and `pendingDeleteKeys` (one
boolean per same key, whole-category exclusion only). That's category-grain in and
category-grain out — it has no way to express "this category is live, but $40 of its
rolled-up total belongs to a cause line that's individually pending-delete and shouldn't
count." Per the item-1 ruling, cause-line pending-delete never touches
`annualAmountCents`, so that stale-but-uncorrected number is exactly what will flow into
`lineValues` unless something subtracts the pending-delete children back out before the
sum happens.

Phase 3 must pick the exact shape, but it should stay a **pure function** (no DB access,
same Vitest-seam rationale the existing doc comment gives for why this logic was pulled
out of the component in the first place — `ledger.ts:1687-1694`) and should account for
cause-line-grain exclusion explicitly rather than push the subtraction into
`guided-budget-setup.tsx`'s data assembly where it won't be independently testable. A
third parameter (e.g., a `${categoryId}_${flow}` → cents-to-subtract map, built from
whatever cause-line pending-delete data the API already returns per category) is the
natural extension; the caller — not this function — is responsible for computing which
cause lines are pending given the OR rule above. This is Phase 3's call to finalize, not
mine, but the *fact* that the signature changes (not just its callers) belongs in the
design doc explicitly.

## Notes

- **Nothing here loops back to Phase 1.** Chris's four resolved decisions already answer
  every open question Phase 1 raised; what's left is pure Phase 2/3 mechanics (how the
  schema/guard/transaction changes are shaped), not a functional-intent question.
- **Print worksheet exclusion** (`budget-print-worksheet.tsx:89-93`) currently filters
  categories only (`l.pendingDeleteAt === null`) and has no concept of cause lines at all
  yet — Phase 3 needs to design its data-assembly query to fetch cause lines per category
  and apply the same OR-exclusion rule as the live-totals helper, at the compact
  category-subtotal-plus-cause/line-detail grain Chris resolved (Q4).
- **Three new/changed write surfaces to name explicitly in the Phase 3 API contract:**
  (1) category-level cascade delete/restore now succeeding on breakdown categories via the
  degated `setBudgetLinePendingDelete` above (Flow 6), (2) a cause-*group* cascade delete
  (Flow 5 — "remove this whole cause and its N lines" as one transaction, not N sequential
  DELETEs, per the brief's own failure-mode note), and (3) the existing cause-line DELETE
  now paired with delayed-commit on the client (no change to the endpoint's contract
  itself, just its caller's timing). Tech-lead should confirm whether (2) is a new route or
  a bulk variant of the existing single-line DELETE.
- **Mobile tap targets and the blur/click race fix** (Gaps 4 and 7) are UX-layer concerns
  with no architectural dimension — correctly reserved for `ux-developer` in Phase 4, not
  this review.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're reshaping the budgeting page's Income/Expense flat list into two labeled sections, each
carrying its own `+ add category` at the header instead of the bottom of the card, and pushing
`+ add cause` / `+ add line item` down to category- and cause-grain affordances so the treasurer
never again lands a new line in the wrong cause group. The harder half of this feature is the
locked Q1 decision: removal becomes uniformly reversible-until-finalize at **every** grain —
category (already true today), cause-group (new), and individual line item (new — this is the
one that used to be a hard `DELETE`). That means `ledger_budget_lines` gets its own
`pending_delete_at` column, mirroring `ledger_budgets`' existing one exactly, and every read
consumer (live totals, print worksheet, finalize purge) has to learn a new exclusion rule: a
cause line is "dead" when **either its own flag or its parent category's flag** is set — an OR,
computed at read time, never cascade-written onto children. The `has_cause_breakdown` guard comes
out of `setBudgetLinePendingDelete` specifically (not `upsertBudgetLine`) so a category can be
soft-deleted while still carrying causes/lines underneath it. Line-item removal gets a genuinely
new mechanic for this codebase — a delayed-commit Undo (hold the flag-flip request client-side
until a toast expires, cancel by never sending it) — while cause-group and category removal stay
confirm-then-immediate, matching the existing category precedent. The blur-vs-click race that's
been eating the treasurer's first click gets fixed with `onMouseDown` `preventDefault()` on every
add/remove control, which suppresses the racing blur-commit at the point of contact instead of
trying to guarantee no reconciliation ever moves a button mid-click.

No new `FEATURES` key, no new top-level files or directories — everything lands inside the four
existing components, `ledger-queries.ts`, `ledger.ts`, and two existing (plus one new sibling)
route files, per the architect's placement ruling.

## Permissions

- **Permission:** existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) — unchanged, covers every
  verb in this feature (add/remove at every grain, including the two new write surfaces below).
  No new `FEATURES` key, no new migration for role bindings.
- **Independent gate, unchanged:** `assertBudgetUnlocked()` on every new/changed write path,
  identical to every existing budgeting write — re-derived server-side from `fund.entityId` +
  `fiscalYear`, never trusted from the client. Both directions (soft-delete AND restore) run the
  lock check, same as `setBudgetLinePendingDelete` already does at category grain.

## API Contract

Three write surfaces change or are added. All three reuse the existing PATCH-with-mutually-
exclusive-body-shape convention this feature area already established (DECISION-053 item 1) —
no route forks a duplicate auth/lock/guard sequence.

### 1. `PATCH /api/admin/ledger/budgets/cause-lines` — cause-line DELETE becomes a flag-flip

The existing `DELETE` handler on this route (hard `DELETE FROM ledger_budget_lines`) is retired
for the interactive remove path. In its place, the existing `PATCH` handler gains a **third**
mutually-exclusive body shape, dispatched on the presence of `pendingDelete`:

```
PATCH /api/admin/ledger/budgets/cause-lines
Body: { id: string; pendingDelete: boolean }
Response 200: { action: 'pending-delete' | 'restored' }
Errors: 400 (bad id), 404 (no line with this id), 409 { error, reason: 'locked' }
```

Backed by a new query function, `setBudgetCauseLinePendingDelete({ id, pendingDelete }, tx)` in
`ledger-queries.ts`, addressed by the line's own `id` (matching `updateBudgetCauseLine`/
`deleteBudgetCauseLine`'s existing addressing convention, not the 4-tuple
`setBudgetLinePendingDelete` uses at category grain). Shape:

1. Look up the line by `id` → 404 if missing.
2. Look up its parent `ledger_budgets` row → its `fundId`/`fiscalYear` → `assertBudgetUnlocked()`,
   same placement as every other write (after shape validation, before the flag write).
3. **Pure flag-flip** — `UPDATE ledger_budget_lines SET pending_delete_at = now()|NULL WHERE id = $1`.
   Never touches `amountCents`. Never recomputes the parent's `annualAmountCents` (mirrors
   architect Ruling 1 exactly — this is the same "restore brings the number back exactly by
   construction" property `setBudgetLinePendingDelete` already has at category grain).
4. No `has_cause_breakdown`-style guard needed — that guard exists to stop *category-grain*
   writes from clobbering line children; it has no meaning for a function that operates directly
   on one line.

The existing `DELETE /api/admin/ledger/budgets/cause-lines` handler **stays in the codebase**,
unchanged — it's still the correct primitive for a never-saved row's local cancel (no network
call happens there at all) and is not otherwise called by the new UI. It is not removed in this
increment; nothing currently calls it for a committed row once the flag-flip ships, but deleting
dead code is a 30-day code-review concern, not a Phase 4 one — flagging this explicitly so nobody
"cleans it up" as an uncommitted side quest and accidentally breaks something Star & Notes or a
future increment turns out to depend on. *(Correction check for ux-developer: grep for any other
caller of this DELETE handler before assuming it's fully dead.)*

**What Undo actually calls:** nothing, in the common case. Delayed-commit means the flag-flip
`PATCH` above is not sent until the toast's hold window elapses. Undo clicked inside that window
= `clearTimeout()`, zero network calls, the row was never touched server-side. If the hold
window elapses and the `PATCH` fires, the row is now in the same "struck-through, Restore-able"
state a soft-deleted category already renders — a later Restore click is the **same** endpoint,
`{ id, pendingDelete: false }`. One endpoint, both directions, exactly like
`setBudgetLinePendingDelete` already works at category grain. No new server endpoint for Undo
itself, confirming the architect's Phase 2 note.

### 2. `PATCH /api/admin/ledger/budgets/cause-lines/group` — cause-group cascade (new sibling route)

Flow 5 ("remove *Environment* and its N line items", one action, one transaction) needs to flip
every line under one `(budgetId, cause)` pair atomically — not N sequential single-line PATCHes,
per the brief's own failure-mode note ("must be one transaction, not N sequential DELETEs that
could partially fail"). New sibling route, following the existing `.../cause-lines/collapse`
precedent (a genuinely different address shape than the single-line route, so it gets its own
file rather than a fourth branch jammed into the main PATCH):

```
PATCH /api/admin/ledger/budgets/cause-lines/group
Body: { fundId: string; fiscalYear: number; categoryId: string; flow: 'income'|'expense';
        cause: string; pendingDelete: boolean }
Response 200: { action: 'pending-delete' | 'restored'; lineCount: number }
Errors: 400 (shape), 404 (no budget row for this category/flow, or no lines for this cause),
        409 { error, reason: 'locked' }
```

Backed by `setBudgetCauseGroupPendingDelete(params, tx)`:

1. Resolve `fundId`/`fiscalYear`/`categoryId`/`flow` → the `ledger_budgets` row (same lookup
   `createBudgetCauseLine` already does) → 404 if none.
2. `assertBudgetUnlocked()`.
3. `UPDATE ledger_budget_lines SET pending_delete_at = now()|NULL WHERE budget_id = $1 AND cause = $2 RETURNING id` inside one transaction — this is the one-transaction requirement satisfied
   trivially (a single `UPDATE` touching every matching row, not a loop).
4. 404 if zero rows matched (no lines exist for that cause — nothing to flip).
5. Same non-recompute rule as #1: pure flag-flip, no `annualAmountCents` touch, no guard.

Group-level restore uses the same endpoint with `pendingDelete: false` — matching the "confirm,
no undo-timer, but still reversible-until-finalize via a persistent Restore control" UX Q1's
resolution implies at this grain (see Component Plan).

### 3. `PATCH /api/admin/ledger/budgets` — category delete now succeeds in breakdown mode (no new route)

Flow 6. **No endpoint change** — same URL, same body shape (`{ fundId, fiscalYear, categoryId,
flow, pendingDelete }`) already in production since DECISION-053. The only change is inside
`setBudgetLinePendingDelete` itself: its private copy of the `has_cause_breakdown` guard
(`ledger-queries.ts:1183-1199`) is deleted. `upsertBudgetLine`'s own copy of the identical-looking
check (`ledger-queries.ts:968-999`) is **left untouched** — it guards a different hazard (a
numeric overwrite or hard-delete-via-cascade silently desyncing children) that has nothing to do
with this reversible path.

### Read-layer exclusion — one shared predicate, three consumers

New pure export in `src/lib/ledger.ts`:

```ts
export function isCauseLineLive(
  causeLinePendingDeleteAt: string | null,
  categoryPendingDeleteAt: string | null,
): boolean {
  return causeLinePendingDeleteAt === null && categoryPendingDeleteAt === null;
}
```

Consumers:

1. **`getFundReport` (`ledger-queries.ts`)** — no exclusion logic added here (same as today's
   category-grain `pendingDeleteAt`, which is "purely informational" and never affects this
   report's own totals). It only needs a **shape change**: the `budgetLineRows` select at
   `ledger-queries.ts:578-588` gains `pendingDeleteAt: ledgerBudgetLines.pendingDeleteAt`,
   threaded through `causeLinesByBudgetId`/`causeLinesFor()` into
   `FundReportCategoryLine.causeLines[].pendingDeleteAt: string | null` (serialized as an ISO
   string, same convention as the category-grain field one line above it in the same type).
2. **`computeFundLineSums` (`ledger.ts:1687-1710`)** — signature grows a third parameter, stays
   pure:
   ```ts
   export function computeFundLineSums(
     lineValues: Record<string, number>,
     pendingDeleteKeys: Record<string, boolean> = {},
     causeLinePendingCents: Record<string, number> = {},
   ): { incomeCents: number; expenseCents: number } {
     let incomeCents = 0;
     let expenseCents = 0;
     for (const [key, cents] of Object.entries(lineValues)) {
       if (pendingDeleteKeys[key]) continue;
       const adjusted = cents - (causeLinePendingCents[key] ?? 0);
       if (key.endsWith("_income")) incomeCents += adjusted;
       else if (key.endsWith("_expense")) expenseCents += adjusted;
     }
     return { incomeCents, expenseCents };
   }
   ```
   `causeLinePendingCents[key]` (`${categoryId}_${flow}` → cents) is the sum of every cause line
   under that category+flow that is individually pending-delete on its **own** flag (per
   `isCauseLineLive`, with the parent's flag always `false` here — if the parent were pending-
   delete, `pendingDeleteKeys[key]` already `continue`s the whole category, so no double
   subtraction). Seeded/re-synced in `guided-budget-setup.tsx` from the exact same `useEffect`
   that already re-syncs `lineValues`/`pendingDeleteKeys` on every `funds` prop change (see
   Component Plan) — this closes the gap the architect named: `annualAmountCents` never gets
   decremented for a pending cause line (Ruling 1), so without this third param the re-seeded
   `lineValues[key]` would silently include a dead line's dollars after every refresh, not just
   between keystrokes.
3. **`budget-print-worksheet.tsx`'s data assembly** — `PrintLine` gains
   `causeLines: { cause: string; label: string; amountCents: number; pendingDeleteAt: string | null }[] | null`
   (page.tsx threads this straight from the same `report.income`/`report.expense` the category
   fields already come from — no new query, reuses `getFundReport`'s now-widened `causeLines`).
   `FlowTable` filters each category's `causeLines` with
   `isCauseLineLive(cl.pendingDeleteAt, line.pendingDeleteAt)` before rendering — in practice the
   parent-flag half is already redundant by the time a line reaches `FlowTable` (categories with
   `pendingDeleteAt` are filtered out one level up, same as today), but passing both keeps the
   predicate the single source of truth every consumer calls the same way, per the architect's
   explicit ask that these three not reinvent slightly different exclusion logic.

## Data Model

**One column.** `src/lib/db/schema.ts`, on `ledgerBudgetLines` (currently `id`, `budgetId`,
`cause`, `label`, `amountCents`, `createdAt`, `updatedAt`):

```ts
// Soft-delete-until-finalize (DECISION-056). Nullable, no
// default: null = normal row; set = marked for removal, purged in the same transaction
// as Approve & lock. Mirrors ledgerBudgets.pendingDeleteAt exactly — never written
// alongside amountCents, so "restore brings the number back exactly" holds by
// construction, not by special-casing (see setBudgetCauseLinePendingDelete).
pendingDeleteAt: timestamp("pending_delete_at"),
```

Migration `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`:

```sql
-- Soft-delete-until-finalize for ledger_budget_lines (DECISION-056). Mirrors
-- 0066_ledger_budgets_pending_delete.sql at the cause-line grain.
ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;
```

No default needed, no backfill — every pre-existing row becomes `NULL` (not pending-delete),
which is the correct default with zero migration-time write. No other schema change: no new
table, no index (the column is only ever filtered by `budget_id`, which is already indexed via
`ix_ledger_budget_lines_budget`).

## Component / Page Plan

### Pages

- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — modified. Thread `pendingDeleteAt`
  through `enrichCauseLines()` (currently maps `causeLines` to add `priorBudgetCents`/
  `priorActualCents`; add `pendingDeleteAt: cl.pendingDeleteAt`, one line). Everything else about
  this file's shape is unchanged — the section split and add-category relocation live entirely
  inside `GuidedBudgetSetup`, not the server page.

### Components modified (no new files)

**`src/components/admin/ledger/guided-budget-setup.tsx`**

- **Section split.** Where the fund card currently renders one `<BudgetEditor lines={fund.budgetEditorLines} .../>` covering both flows, split into two sections, each independently rendered regardless of whether the other flow has zero categories (fixes Flow 7):
  ```
  <FundCard>
    <IncomeSection>
      header: "Income" + "+ add category" (always visible when canManage && !locked)
      <BudgetEditor lines={incomeLines} flow="income" .../>  (or empty-state message)
    </IncomeSection>
    <ExpenseSection>
      header: "Expense" + "+ add category"
      <BudgetEditor lines={expenseLines} flow="expense" .../>
    </ExpenseSection>
  </FundCard>
  ```
  `incomeLines`/`expenseLines` = `fund.budgetEditorLines.filter(l => l.flow === "income"|"expense")`
  computed once per fund per render (cheap — these lists are already small). The existing
  `addCategoryState` machinery (`openAddCategory`, `submitNewCategory`, `addExistingCategory`)
  is **reused as-is** — only its trigger buttons move (from one bottom-of-card row with two
  buttons, to two section-header single buttons), and `addCategoryState.flow` already
  disambiguates which section's picker is open, so no new state shape is needed.
- **New state: `causeLinePendingCents`**, sibling to the existing `lineValues`/`pendingDeleteKeys`
  pair, same lifecycle (lazy-seeded once, re-synced in the *same* existing `useEffect` keyed on
  `funds`):
  ```ts
  function seedCauseLinePendingCents(funds: FundSetupItem[]): Record<string, Record<string, number>> {
    const init: Record<string, Record<string, number>> = {};
    for (const fund of funds) {
      const m: Record<string, number> = {};
      for (const line of fund.budgetEditorLines) {
        const key = `${line.categoryId}_${line.flow}`;
        const pending = (line.causeLines ?? []).filter((cl) => cl.pendingDeleteAt !== null);
        m[key] = sumBudgetCauseLines(pending); // reuse existing pure sum helper
      }
      init[fund.fundId] = m;
    }
    return init;
  }
  ```
  `fundSums()` calls `computeFundLineSums(lineValues[fundId], pendingDeleteKeys[fundId], causeLinePendingCents[fundId])`.
  A new callback, `onCauseLinePendingDeltaChange(fundId, key, deltaCents)`, bubbles up from
  `BudgetCauseEditor` → `BudgetEditor` → here, fired **optimistically at the moment a hold starts
  or a group/committed-line pending-delete resolves** (mirrors `onPendingDeleteChange`'s existing
  "before the round-trip completes" precedent) — `+deltaCents` on remove/hold-start, `-deltaCents`
  on Undo/Restore — so the Income/Expenses/Banked-used badges move the instant the treasurer
  clicks, not after the next `router.refresh()`.
- **`totalPendingDeleteCount()`** extended to also count cause-line-grain pending items (both
  individually-pending lines and pending groups) so the Approve & lock confirmation copy reflects
  what will actually be purged — e.g. "This will permanently remove 2 categories and 5 cause
  lines." Exact copy is a small UX-developer call, not a technical one.

**`src/components/admin/ledger/budget-editor.tsx`**

- Gains a `flow: "income" | "expense"` prop (matches what the parent now passes per section) —
  used only to drop the now-redundant per-row `INCOME`/`EXPENSE` badge (`<span>{line.flow}</span>`
  at `budget-editor.tsx:470`), freeing horizontal space for the denser tap-target layout Gap 7
  flagged. This is optional polish, not required for correctness (the badge is harmless if left
  in), but worth doing since it's a one-line removal once every caller is single-flow.
- **Render-order fix, required for correctness:** today's per-line branch checks
  `if (inBreakdown) { ... } else if (line.pendingDeleteAt) { ... } else { ... }` — `inBreakdown`
  is checked *first*. Once the `has_cause_breakdown` guard comes out, a category can be
  **both** `pendingDeleteAt` **and** carrying `causeLines`. The pending-delete branch must be
  checked **first** so a removed-in-breakdown-mode category renders the struck-through/Restore
  treatment (not `BudgetCauseEditor`) regardless of whether it has cause lines underneath. This
  is a one-line reorder of the existing `if`/`else if` chain, but it is not optional — without it,
  Flow 6 silently fails to render any remove-confirmation state for a category that was in
  breakdown when removed.
- The existing pendingDeleteAt-row block (`budget-editor.tsx:410-464`) needs **no structural
  change** for the breakdown case — it already renders category name + Restore + a read-only
  amount input, and per Ruling 4 the category's own row is what carries the flag, not its
  children, so this same block is correct for both lump-sum and formerly-broken-down categories.
  One copy tweak: the "Deleted — removed when finalized" pill's row should additionally show a
  small "(N cause lines)" hint when `line.causeLines` is non-empty, so the treasurer isn't
  surprised at finalize time about what's being purged. (Reads `line.causeLines?.length`, no new
  data needed.)
- `requestRemove`/`requestRestore` unchanged (still call `setPendingDelete`, unchanged endpoint) —
  the only reason Flow 6 didn't already work is the now-removed server guard, not any client code.
- Add `onMouseDown={(e) => e.preventDefault()}` to the remove-trash button and the Restore button
  (blur/click-race fix — see Edge Cases).

**`src/components/admin/ledger/budget-cause-editor.tsx`** — the biggest diff of the three.

- **Per-line cause `<select>` removed entirely.** `addRow()` becomes `addRowForCause(cause: string)`,
  called from a new **per-cause-group** "+ add line item" control (rendered once per cause group,
  not once per category) instead of today's single category-wide "+ Add line" at the bottom. The
  new row is created with `cause` already set to the group it was added from — no dropdown, ever,
  matching the locked decision. `handlePendingCauseChange` (the never-saved-row cause `<select>`
  handler) is deleted along with the `<select>` JSX branch.
- **`+ add cause` on the category row** (rendered by `BudgetEditor`, not `BudgetCauseEditor` —
  it's the affordance that starts a *new* group, so it lives at the category level even when a
  category is already in breakdown, exactly like today's now-relocated "Break down by cause"
  link). Clicking it shows a small inline picker of causes **not yet used on this category**
  (computed from `ALL_CAUSES` minus the distinct `cause` values already present in `initialLines`/
  `rows`) — pick one → `addRowForCause(pickedCause)` seeds a new pending row in that group. Stays
  visible after use (not one-shot), offering only the shrinking set of remaining unused causes;
  hidden entirely once all causes are in use (defensive — `ALL_CAUSES` is finite).
- **Row-level removal state.** `Row` gains:
  ```ts
  interface Row {
    // ...existing fields...
    /** Server-committed pending-delete state — struck-through + Restore, same as
     *  BudgetEditor's category-grain treatment. */
    pendingDeleteAt: string | null;
    /** Client-only "toast is counting down" state — visually identical to
     *  pendingDeleteAt !== null, but Undo here is a pure clearTimeout, no network call. */
    holdingForDelete: boolean;
  }
  ```
  A row renders in the "dead" (struck-through, amount input disabled) treatment when
  `pendingDeleteAt !== null || holdingForDelete` — both states look the same, they differ only
  in what the Restore/Undo control does:
  - `holdingForDelete`: click "Undo" → `clearTimeout(timerRef.current[rowKey])`,
    `holdingForDelete: false`. No `fetch`, ever, if clicked in time.
  - `pendingDeleteAt !== null` (timer already fired, or this is a page-load-time already-pending
    row): click "Restore" → `PATCH .../cause-lines { id, pendingDelete: false }`.
  - Rows in either dead state are excluded from `currentTotalCents(rows)` (the on-screen "Category
    total: $X" and each group's "Subtotal: $X"), keeping the component's own live numbers
    consistent with the fund-level badges above it.
  - A `useRef<Record<string, ReturnType<typeof setTimeout>>>` keyed by row `id` (or a client-
    generated temp key for a not-yet-committed row — though a never-saved row's remove stays the
    existing synchronous `doRemoveLocal`, no timer involved, since there's nothing server-side to
    hold) holds the pending timers; a `useEffect` cleanup clears every outstanding timer on
    unmount (defense-in-depth per the architect's flagged concern — an unrelated
    `router.refresh()` does not unmount this component since its React `key` is stable, but a
    category-level breakdown-exit/collapse *would* unmount it, and any outstanding hold must not
    silently fire a request against a component that's gone).
  - Toast: `sonner`'s `toast(message, { action: { label: "Undo", onClick } , duration: 6000 })` —
    6s window (sonner's own default toast visible duration is 4000ms; this needs the explicit
    override so the countdown and the toast's own dismissal line up, otherwise the toast could
    disappear while the hold is still live, leaving Undo with nothing to click).
- **Group-level remove** — a new control on each cause-group header (next to the existing
  subtotal): click → `ConfirmDialog` ("Remove *Environment* and its N line items?", brief's own
  copy) → on confirm, `PATCH /budgets/cause-lines/group { ..., cause, pendingDelete: true }` →
  every row in that group flips to the dead-row treatment as a unit, optimistically, before the
  round-trip resolves (same "instant, not after refresh" precedent). A persistent "Restore this
  group" control renders on the now-dead group header (calls the same endpoint with
  `pendingDelete: false`) — no time limit, matches the uniform reversible-until-finalize model,
  distinct from the per-line toast-Undo (Locked decision: only line-item remove gets the
  delayed-commit toast; cause/category removal are confirm-then-immediate).
- `onMouseDown={(e) => e.preventDefault()}` on every remove/add/collapse/restore button in this
  file (line-remove, group-remove, group-restore, add-line, add-cause-picker's pick buttons,
  collapse).

**`src/components/admin/ledger/budget-print-worksheet.tsx`**

- `PrintLine.causeLines: { cause: string; label: string; amountCents: number; pendingDeleteAt: string | null }[] | null` added.
- `FlowTable` renders, per category `<tbody>`: the existing category subtotal row, then — when
  `causeLines` is non-null — one compact sub-row per **live** cause group (cause name + its
  subtotal) and one compact sub-row per live line beneath it (label or "(generic)" + amount), no
  prior-year reference columns at this grain (Q4's "compact" resolution — those stay category-
  grain only). The **existing** ~2 blank hand-annotation ruled lines stay exactly where they are
  today: after the category row, at category-subtotal grain only — not duplicated per cause or
  per line (Q4, explicitly resolved, do not relitigate).
- Exclusion: `(line.causeLines ?? []).filter(cl => isCauseLineLive(cl.pendingDeleteAt, line.pendingDeleteAt))` before rendering — category-level exclusion is unchanged (still filtered one level up in `FundWorksheet`).

## Implementation Order

1. **Schema** (`database-admin`) — add `pendingDeleteAt` to `ledgerBudgetLines` in `schema.ts`;
   write `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`; run
   `pnpm db:migrate` locally against `.env.local`'s Neon DB and confirm `\d ledger_budget_lines`
   shows the new nullable column.
2. **Server logic** (`api-developer`), in this order so each step's tests can build on the last:
   a. `isCauseLineLive` in `ledger.ts`; extend `computeFundLineSums`'s signature (+ Vitest).
   b. `setBudgetCauseLinePendingDelete` + `setBudgetCauseGroupPendingDelete` in
      `ledger-queries.ts`; the guard removal in `setBudgetLinePendingDelete` (leave
      `upsertBudgetLine`'s copy alone).
   c. Route changes: extend `PATCH /budgets/cause-lines`'s dispatch; new
      `PATCH /budgets/cause-lines/group/route.ts`.
   d. `getFundReport` shape change (thread `pendingDeleteAt` through `causeLines`).
   e. Finalize-purge transaction in `budget-approvals/route.ts` — the two additions from
      architect Ruling 3 (second `DELETE` for live-category cause-line orphans; recompute-or-
      cascade-delete-parent for categories whose last surviving line was purged). Rewrite the
      now-false "cause-line children can never reach pending-delete" comment.
   f. Unit tests named below.
3. **UI** (`ux-developer`) — page.tsx's one-line `enrichCauseLines` addition; the section split +
   add-category relocation in `guided-budget-setup.tsx`; the render-order fix + `+ add cause`
   picker + blur/click-race fix in `budget-editor.tsx`; the per-cause `+ add line item` +
   row/group removal states + toast-Undo timer in `budget-cause-editor.tsx`; the print worksheet
   cause/line rendering. Mobile tap-target pass (44px minimum, per Gap 7) across all new controls.
4. **Star & Notes handoff note** (no action this feature, just a pointer): once this ships,
   whoever picks up `docs/work-log/2026-07-28-budget-star-notes.md` needs to re-confirm its
   Phase 1 flow descriptions against the new row/section shape (cause-group headers now exist as
   a distinct row grain that didn't before) before writing code.

## Edge Cases & Risks

- **Blur-vs-click race fix, chosen approach: `onMouseDown={(e) => e.preventDefault()}` on every
  add/remove/restore/collapse control**, over the other two directions the analyst named.
  Rejected: (ii) "stable node identity, no remount" — this would require guaranteeing zero
  remounts across every render path this feature touches (breakdown-mode transitions, pending-
  delete transitions, category add/remove, section add/remove), and a future, unrelated change
  could silently regress it with no test catching the regression until a treasurer hits it live
  again. Rejected: (iii) "disable every control during any in-flight commit anywhere on the page"
  — this directly fights the feature's own goal ("reliable on the first click") by making the UI
  feel locked during completely unrelated, non-racing typing-then-click sequences. Chosen: (i)
  suppresses the root cause (a synchronous `blur` firing and queuing a commit a fraction of a
  second before the click dispatches) at the exact point of contact — the browser never fires the
  blur-triggered commit in the first place when the mousedown target is a control that's about to
  consume the click, so there's no window for a reconciliation to move anything under the click.
  This needs a Playwright test simulating the named interleaving (type in one row, don't blur,
  click a different row's remove control under artificial latency) since the bug is timing-
  dependent and can pass a quick manual click-through while still shipping broken (per Gap 4).
- **A category can end up with every cause line individually pending-delete while the category
  itself stays "live."** This is valid and intentional under Ruling 4 (no cascade in either
  direction) — the category's `annualAmountCents` stays untouched until finalize, at which point
  the finalize-purge's recompute-or-delete-parent step (Ruling 3, addition 2) resolves it, exactly
  mirroring what `deleteBudgetCauseLine` already does for a live one-at-a-time removal that empties
  the last line. Live UI shows the category "balance" correctly reduced via `computeFundLineSums`'s
  third parameter even though the stored `annualAmountCents` hasn't moved yet — this is by design,
  not a bug, but worth calling out so nobody "fixes" the apparent inconsistency by writing to
  `annualAmountCents` early and breaking the restore-brings-it-back-exactly property.
- **The retired `DELETE /api/admin/ledger/budgets/cause-lines` handler is dead code for the
  interactive UI as of this feature**, but is left in place rather than removed — deleting it is
  out of scope here (a 30-day code-review candidate, not a Phase 4 task) and removing it
  prematurely risks breaking a caller this design doc didn't find. `api-developer` should grep for
  any other caller before touching it, but should not delete it as part of this ship.
- **Toast duration vs. sonner's default dismissal** — must pass an explicit `duration` on the
  Undo toast (see Component Plan) or the toast can visually vanish before the hold timer fires,
  leaving no way to click Undo even though the delete hasn't actually committed yet. Small but
  easy to miss.
- **Mobile tap targets (Gap 7).** Every new control (`+ add cause` picker entries, per-cause
  `+ add line item`, group-remove, group-restore) must hit the existing 44px min-height/min-width
  convention already used elsewhere in these three files — flagging again since this feature adds
  more controls to an already-dense, three-level-nested editor than any prior increment.
- **Line-items-under-non-cause-categories (Rudolph Run vendors) is explicitly out of scope** —
  noting per the boundary instructions that this is a real gap the print worksheet's usefulness
  will still have after this ships (a non-giving-eligible expense category still can't show
  vendor-level detail), but it's a separate, undecided model change the treasurer hasn't signed
  off on. Not designed around here.
- **B-30 / label-as-party autocomplete** — not built. The per-line label `<input>` keeps its
  existing free-text + datalist behavior unchanged; nothing here should be mistaken for laying
  groundwork toward a party-linked structured field.

## Implementer

**Specialist split, as the analyst recommended, confirmed:** this is exactly the shape the split
exists for — real schema change, real transactional business logic (two new write functions, a
widened finalize-purge transaction, a widened read query), and a substantial multi-component UI
reorganization. Splitting keeps each phase's diff reviewable and matches every prior Ledger
budgeting increment.

1. **database-admin** — `schema.ts` + `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql`.
2. **api-developer** — `isCauseLineLive` + `computeFundLineSums` (`ledger.ts`);
   `setBudgetCauseLinePendingDelete` + `setBudgetCauseGroupPendingDelete` + the guard removal in
   `setBudgetLinePendingDelete` (`ledger-queries.ts`); the extended `PATCH /budgets/cause-lines`
   dispatch + new `PATCH /budgets/cause-lines/group/route.ts`; `getFundReport`'s shape widening;
   the finalize-purge transaction's two additions in `budget-approvals/route.ts`.
3. **ux-developer** — `page.tsx`'s one-line thread-through; the section split + add-category
   relocation in `guided-budget-setup.tsx` (+ the `causeLinePendingCents` state/seed/callback
   wiring); the render-order fix, `+ add cause` picker, and blur/click-race fix in
   `budget-editor.tsx`; the per-cause `+ add line item`, row/group removal states, and toast-Undo
   timer in `budget-cause-editor.tsx`; the print worksheet's cause/line rendering.

### Unit tests to write (implementer delivers these — not qa)

- `isCauseLineLive` — four cases: both flags null (live), own flag set (dead), parent flag set
  (dead), both set (dead).
- `computeFundLineSums` — extend the existing suite with the new third parameter: a category with
  no cause-line-grain pending amounts (unchanged behavior, backward-compatible default `{}`); a
  category with a partial cause-line-grain subtraction (own-flag-only case); confirm a whole-
  category `pendingDeleteKeys` exclusion is not double-subtracted when the third param also has an
  entry for that key (the `continue` short-circuits before the subtraction line runs).
- `setBudgetCauseLinePendingDelete` — happy path both directions; 404 on unknown id; 409 on
  locked budget (both directions); confirm `amountCents` and the parent's `annualAmountCents` are
  byte-for-byte unchanged after a flag-flip.
- `setBudgetCauseGroupPendingDelete` — happy path both directions on a multi-line group; 404 when
  the cause has no lines; 409 locked; confirm it's a single `UPDATE` (no partial-failure window)
  by asserting all N rows flip atomically.
- Finalize-purge transaction (`budget-approvals/route.ts`) — extend existing coverage: a live
  category with some-but-not-all cause lines pending-delete purges only those lines and recomputes
  `annualAmountCents` from survivors; a live category whose *every* cause line was independently
  pending-delete has its now-childless parent deleted too, mirroring `deleteBudgetCauseLine`'s
  existing last-line behavior.

---

# Phase 4 — Implementation

## Phase 4a — Schema (database-admin) — 2026-07-29

**Owner:** database-admin
**Status:** complete — api-developer is next

### Summary
Added the one column the Phase 3 design doc's Data Model section specified: `pendingDeleteAt`
on `ledgerBudgetLines`, mirroring `ledgerBudgets.pendingDeleteAt` exactly (DECISION-056). No
other schema change — no new table, no index (the column is only ever filtered by `budget_id`,
already indexed via `ix_ledger_budget_lines_budget`).

### What I did
- Read the existing `ledgerBudgets.pendingDeleteAt` definition (`src/lib/db/schema.ts:791`) and
  `drizzle/migrations/0066_ledger_budgets_pending_delete.sql` as the precedent to mirror.
- Added `pendingDeleteAt: timestamp("pending_delete_at")` to `ledgerBudgetLines` in
  `src/lib/db/schema.ts` — same nullable timestamp type, no default, same column-naming
  convention, doc comment cross-referencing DECISION-056 and the "restore brings the number
  back exactly by construction" property.
- Wrote `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql` as a single idempotent
  `ALTER TABLE ledger_budget_lines ADD COLUMN IF NOT EXISTS pending_delete_at TIMESTAMP;`,
  matching 0066's shape verbatim (just the new table name).
- Confirmed the next migration number by running `ls drizzle/migrations/*.sql | sort | tail -3`
  at the start of this phase (0066 was latest → took 0067), per the migration-numbering rule.
- Applied locally (`pnpm db:migrate`) and verified via `psql "$DATABASE_URL" -c "\d
  ledger_budget_lines"` — column present as `timestamp without time zone`, nullable, no default,
  identical shape to `ledger_budgets.pending_delete_at`.
- Re-ran `pnpm db:migrate` a second time to confirm idempotency — the new statement produced the
  expected `NOTICE: column "pending_delete_at" of relation "ledger_budget_lines" already exists,
  skipping` with no error.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Did **not** run `pnpm db:push` (out of scope per instructions — schema/migration only).
- Did **not** touch `ledger-queries.ts`, `ledger.ts`, any route handler, or any React component —
  those are api-developer's and ux-developer's lanes per the Phase 3 design doc's write-surface
  plan (`setBudgetCauseLinePendingDelete`, the new `.../cause-lines/group` route,
  `computeFundLineSums`'s third parameter, `isCauseLineLive`, section-split UI, etc.).

### Outputs
- `src/lib/db/schema.ts` — `ledgerBudgetLines.pendingDeleteAt` added (around line 825, immediately
  after `amountCents`, before `createdAt`).
- `drizzle/migrations/0067_ledger_budget_lines_pending_delete.sql` — new file, single idempotent
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement, verified safe to re-run.
- Tables affected: `ledger_budget_lines` (one nullable column added; no other tables touched).
- No role bindings / seed rows — this feature has no new `FEATURES` key (existing `ledger.manage`
  covers everything per Phase 3's Permissions section).
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm
  db:migrate` (schema.ts already matches the live column shape 1:1, so `pnpm db:push` is not
  required for this change, and was intentionally not run per scope).

### Open questions / handoff notes
- **api-developer is next.** Per the Phase 3 API Contract section: (1) `PATCH
  /api/admin/ledger/budgets/cause-lines` gains the `{ id, pendingDelete }` flag-flip body shape
  backed by a new `setBudgetCauseLinePendingDelete(...)` in `ledger-queries.ts`; (2) new sibling
  route `PATCH /api/admin/ledger/budgets/cause-lines/group` backed by
  `setBudgetCauseGroupPendingDelete(...)`; (3) `setBudgetLinePendingDelete`'s private
  `has_cause_breakdown` guard (`ledger-queries.ts:1183-1199`) needs to be removed (leave
  `upsertBudgetLine`'s copy at lines 968-999 untouched — different hazard); (4) the finalize-purge
  transaction in `budget-approvals/route.ts` needs the second delete + recompute-and-possible-
  cascade step the architect's review spelled out in detail; (5) `computeFundLineSums`
  (`src/lib/ledger.ts`) needs its third parameter; (6) the new `isCauseLineLive` pure predicate
  needs to be added to `src/lib/ledger.ts` and used by all three read consumers (live totals,
  finalize purge, print worksheet data assembly).
- The new column is nullable with no default: existing rows are `NULL` (live, not pending-delete),
  matching the "restore brings the number back exactly" property by construction — `amountCents`
  is never touched by any pending-delete write.
- `ledgerBudgetLines` FK/relationship shape is otherwise unchanged: `budgetId` → `ledgerBudgets.id`
  (`ON DELETE CASCADE`), so a hard-deleted parent still cascades away children regardless of their
  own `pendingDeleteAt` state — only the finalize-purge transaction's *new* second delete step
  (api-developer's job) needs to reason about lines pending-delete independently of their parent.

---

## Phase 4 — Implementation (API) — 2026-07-29

**Owner:** api-developer
**Status:** complete — ux-developer is next

### Summary
Implemented every server/logic-layer item the Phase 3 design named: the shared
`isCauseLineLive` OR-predicate and `computeFundLineSums`'s third parameter in `src/lib/ledger.ts`;
`setBudgetCauseLinePendingDelete` and `setBudgetCauseGroupPendingDelete` in
`src/lib/ledger-queries.ts`, plus removal of `setBudgetLinePendingDelete`'s private
`has_cause_breakdown` guard (`upsertBudgetLine`'s own copy is untouched); `getFundReport`'s
`causeLines[]` widened to carry each line's own `pendingDeleteAt`; the two-step finalize-purge
extension in `budget-approvals/route.ts`; the new `PATCH .../cause-lines/group` sibling route; and
the third body shape on the existing `PATCH .../cause-lines` route. All Phase 3-named unit tests are
written and passing, on top of the full existing suite.

### What I did
- Read the Phase 3 design doc in full (API Contract, Data Model, Component Plan, Implementation
  Order, Edge Cases, Unit Tests to Write) and DECISION-054/055/056 before touching any code.
- `src/lib/ledger.ts`: added `isCauseLineLive(causeLinePendingDeleteAt, categoryPendingDeleteAt)`
  (pure OR-exclusion predicate); gave `computeFundLineSums` a third parameter,
  `causeLinePendingCents: Record<string, number> = {}` (defaulted, backward-compatible), subtracted
  from a still-live category's rolled-up total after the existing whole-category
  `pendingDeleteKeys` `continue` check (no double-subtraction).
- `src/lib/ledger-queries.ts`:
  - Widened `FundReportCategoryLine.causeLines[]` to include `pendingDeleteAt: string | null` per
    line; widened `getFundReport`'s `budgetLineRows` select and `causeLinesFor()` to thread it
    through (ISO string when set, else `null` — same convention as the category-grain field).
  - Removed the `has_cause_breakdown` guard from `setBudgetLinePendingDelete` only (the query that
    checked for `ledger_budget_lines` children before allowing a pending-delete flip) — left
    `upsertBudgetLine`'s own copy of that check completely untouched (different hazard, per
    architect Ruling 4). Rewrote the function's doc comment and narrowed
    `SetBudgetLinePendingDeleteResult.reason` from `"locked" | "has_cause_breakdown"` to just
    `"locked"` since the function can no longer produce the latter.
  - Added `setBudgetCauseLinePendingDelete({ id, pendingDelete }, tx = db)` — single-row flag-flip
    on one `ledger_budget_lines` row addressed by its own `id`; never touches `amountCents` or the
    parent's `annualAmountCents`; runs the lock check both directions; 404 on unknown id.
  - Added `setBudgetCauseGroupPendingDelete({ fundId, fiscalYear, categoryId, flow, cause,
    pendingDelete }, tx)` — one `UPDATE ... WHERE budget_id = $1 AND cause = $2` flipping every
    matching row atomically (`.returning({id})` to report `lineCount`); 404 when the resolved
    budget row doesn't exist, and a separate 404 when the cause has zero matching lines; lock
    check before the write.
- Routes:
  - `PATCH /api/admin/ledger/budgets/cause-lines` — added a third mutually-exclusive body shape,
    `{ id, pendingDelete: boolean }`, checked BEFORE the existing UPDATE branch (so a flag-flip body
    with neither `label` nor `amountCents` never falls into "at least one is required"). Routes to
    `setBudgetCauseLinePendingDelete`. Create/update shapes and the standalone `DELETE` handler are
    untouched; updated the route's header doc comment to describe the new shape and clarified the
    retained `DELETE` handler is for a never-saved row's local cancel only, no longer called by the
    interactive remove-a-committed-line flow.
  - New sibling route `src/app/api/admin/ledger/budgets/cause-lines/group/route.ts` — `PATCH`,
    follows the `.../cause-lines/collapse` precedent for auth/validation/error shape (session +
    `LEDGER_MANAGE`, shape-check every field, wraps `setBudgetCauseGroupPendingDelete` in
    `db.transaction()`).
  - `PATCH /api/admin/ledger/budgets` — no code change (Phase 3 confirmed none needed); updated its
    header doc comment since Shape B (`pendingDelete`) can no longer 409 with
    `has_cause_breakdown` now that the guard is gone from `setBudgetLinePendingDelete`. Category
    removal in breakdown mode (Flow 6) needed no new route — it now succeeds through this existing
    endpoint once the guard was removed.
  - `budget-approvals/route.ts` (finalize-purge transaction) — added, inside the SAME
    `db.transaction()`, a second purge step: after the existing category-grain delete, select
    surviving (non-purged) `ledger_budgets` ids for the entity+FY, delete every
    `ledger_budget_lines` row among them still individually pending-delete
    (`.returning({budgetId})`), then for each distinct affected `budgetId` either recompute
    `annualAmountCents` from survivors (`sumBudgetCauseLines`) or, if the purge emptied the
    category's last surviving line, delete the now-childless parent — mirroring
    `deleteBudgetCauseLine`'s existing last-line behavior. Rewrote the file's header doc comment and
    the now-false "cause-line children can never reach pending-delete" inline comment.
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build:only` after every meaningful step, not
  just at the end.

### Outputs

**Endpoints / server actions (all gate: session + `hasFeature(FEATURES.LEDGER_MANAGE)`):**

- `PATCH /api/admin/ledger/budgets/cause-lines` — third body shape:
  - Request: `{ id: string; pendingDelete: boolean }`
  - Response 200: `{ action: 'pending-delete' | 'restored' }`
  - Errors: `400` (bad `id`/`pendingDelete` type), `404` (no line for this id),
    `409 { error, reason: 'locked' }`
  - Existing create (`{ fundId, fiscalYear, categoryId, flow, cause, label?, amountCents }`) and
    update (`{ id, label?, amountCents? }`) shapes, and the standalone `DELETE { id }`, are
    unchanged.
- `PATCH /api/admin/ledger/budgets/cause-lines/group` — **new route**:
  - Request: `{ fundId: string; fiscalYear: number; categoryId: string; flow: 'income'|'expense'; cause: string; pendingDelete: boolean }`
  - Response 200: `{ action: 'pending-delete' | 'restored'; lineCount: number }`
  - Errors: `400` (shape), `404` (no budget row for this category/flow, or no lines for this cause),
    `409 { error, reason: 'locked' }`
- `PATCH /api/admin/ledger/budgets` — unchanged contract. Shape B (`{ ..., pendingDelete }`) now
  succeeds even when the category is in breakdown mode (Flow 6) — it can no longer 409 with
  `has_cause_breakdown`; Shape A (`{ ..., annualAmountCents }`) is completely unchanged, including
  its own `has_cause_breakdown` 409.

**Library functions (`src/lib/ledger-queries.ts` unless noted):**

- `isCauseLineLive(causeLinePendingDeleteAt: string | null, categoryPendingDeleteAt: string | null): boolean`
  — `src/lib/ledger.ts`. `true` iff BOTH are `null`.
- `computeFundLineSums(lineValues, pendingDeleteKeys = {}, causeLinePendingCents = {}): { incomeCents, expenseCents }`
  — `src/lib/ledger.ts`. **Signature change**: new third parameter,
  `causeLinePendingCents: Record<string, number>` keyed `${categoryId}_${flow}` → cents to subtract
  from that category's rolled-up total for cause lines individually pending-delete on their own
  flag. Defaulted to `{}` — every existing call site compiles and behaves identically unchanged.
- `setBudgetCauseLinePendingDelete({ id, pendingDelete }, tx = db): Promise<{ ok: true; action: 'pending-delete' | 'restored' } | { ok: false; error; status: 404 | 409; reason?: 'locked' }>`
- `setBudgetCauseGroupPendingDelete({ fundId, fiscalYear, categoryId, flow, cause, pendingDelete }, tx): Promise<{ ok: true; action: 'pending-delete' | 'restored'; lineCount: number } | { ok: false; error; status: 404 | 409; reason?: 'locked' }>`
- `getFundReport(...)` return shape change: every `causeLines[]` entry now carries
  `pendingDeleteAt: string | null` (own line's flag, ISO string or `null`) alongside the existing
  `id`/`cause`/`label`/`amountCents`. **Additive only** — existing callers that destructure a subset
  of fields (e.g. `guided-budget-setup.tsx`'s `enrichCauseLines`, which spreads `...cl`) already
  compile and already carry the new field forward without any code change on their part, since it's
  a superset of the old shape, not a breaking one.
- `setBudgetLinePendingDelete` — same signature/contract, `has_cause_breakdown` guard removed;
  `SetBudgetLinePendingDeleteResult.reason` narrowed from `"locked" | "has_cause_breakdown"` to
  `"locked"`.

**Schema:** none — database-admin's Phase 4a already added `ledgerBudgetLines.pendingDeleteAt` and
migration `0067_ledger_budget_lines_pending_delete.sql`. No further schema change this phase.

**Tests added** (all in the existing files' established mock-tx/mock-db patterns, no new test
infra):
- `src/lib/ledger.test.ts` — `isCauseLineLive` (4-case truth table); `computeFundLineSums` extended
  with 3 new cases (third-param default/backward-compat, partial cause-line-grain subtraction on a
  still-live category, whole-category exclusion not double-subtracted when the third param also has
  an entry for that key).
- `src/lib/ledger-queries.test.ts` — `setBudgetCauseLinePendingDelete` (soft-delete, restore, 404
  unknown id, 409 locked both directions, byte-for-byte `amountCents`/no-parent-write assertions);
  `setBudgetCauseGroupPendingDelete` (soft-delete + restore happy path on a 3-line group asserting a
  SINGLE update call flips all 3, 404 no lines for cause, 404 no budget row, 409 locked); rewrote the
  now-obsolete `setBudgetLinePendingDelete` "rejects has_cause_breakdown" test into one proving the
  opposite (succeeds on a category with children, writes only the category row, never
  `ledger_budget_lines`); added `pendingDeleteAt: null` to the two `causeLines` fixture/assertion
  spots in the pre-existing `causeActualsByKey` describe block so they still match the widened
  shape.
- `src/app/api/admin/ledger/budget-approvals/route.test.ts` — extended the mock transaction to
  support `select`/`update` (previously insert/delete only) and added two tests per Phase 3's named
  list: a live category with some-but-not-all cause lines pending-delete purges only those and
  recomputes `annualAmountCents` from survivors; a live category whose every cause line was
  independently pending-delete has its now-childless parent deleted too. Both existing Phase 3
  tests 9/10 and the already-locked-409 test pass unchanged (the new select/update calls default to
  empty results when unqueued, so the added purge step is a no-op for those fixtures).
- Full suite: `pnpm test` → 713 passed (was 695 before this phase; net +18 across the above).
  `pnpm exec tsc --noEmit` clean. `pnpm build:only` clean (the new
  `/api/admin/ledger/budgets/cause-lines/group` route appears in the route manifest).

**Decisions logged:** none new this phase — DECISION-054/055/056 (already logged by tech-lead in
Phase 3) fully covered every design call this implementation needed to make.

### Open questions / handoff notes
- **ux-developer is next.** Per Phase 3's Component/Page Plan, the remaining work is entirely
  client-side: `page.tsx`'s `enrichCauseLines` (verify whether the existing `...cl` spread already
  threads `pendingDeleteAt` through without a code change — I did NOT touch this file, but traced
  the spread and believe it may already be sufficient; please confirm rather than assume either
  way); the section split + add-category relocation + `causeLinePendingCents` state/seed/callback
  wiring in `guided-budget-setup.tsx`; the render-order fix + `+ add cause` picker + blur/click-race
  fix in `budget-editor.tsx`; the per-cause `+ add line item` + row/group removal states + toast-Undo
  timer in `budget-cause-editor.tsx`; the print worksheet's cause/line rendering. I did not touch any
  of the four named client files, per my scope.
- **Dead client-side branch to clean up while you're in `budget-editor.tsx` anyway:** its
  `setPendingDelete()` function (around line ~199) has a
  `data.reason === "has_cause_breakdown" ? "This category is broken down by cause — remove its
  cause lines first." : ...` fallback for the `PATCH /api/admin/ledger/budgets` Shape B error path.
  Since `setBudgetLinePendingDelete` can no longer return that reason, this branch is now dead code
  (harmless — just unreachable) — worth deleting as part of your Flow 6 pass since you're already
  touching this exact function, but not a blocker.
- **New response shapes to build against**, in full:
  - `PATCH /api/admin/ledger/budgets/cause-lines { id, pendingDelete }` → `{ action: 'pending-delete' | 'restored' }`, 409 `{ error, reason: 'locked' }`, 404 plain `{ error }`.
  - `PATCH /api/admin/ledger/budgets/cause-lines/group { fundId, fiscalYear, categoryId, flow, cause, pendingDelete }` → `{ action: 'pending-delete' | 'restored', lineCount: number }`, same error shapes.
  - `getFundReport`'s `causeLines[]` items now have `pendingDeleteAt: string | null` — use
    `isCauseLineLive(cl.pendingDeleteAt, line.pendingDeleteAt)` (import from `@/lib/ledger`) to
    decide whether a cause line renders as live vs. dead, and to build the `causeLinePendingCents`
    map `computeFundLineSums`'s new third parameter needs.
  - `computeFundLineSums(lineValues, pendingDeleteKeys, causeLinePendingCents)` — the third argument
    is required for the live balance badges to stay correct once a cause line is individually
    pending-delete under a still-live category; omitting it (relying on the default `{}`) will
    silently overcount until the category itself is also removed.
- **Delayed-commit Undo (Flow 4) is entirely your layer** — no server endpoint change needed for it
  (per architect's Phase 2 note, confirmed in Phase 3): Undo-in-time never calls the flag-flip PATCH
  at all; a hold that expires just calls the same `PATCH .../cause-lines { id, pendingDelete: true }`
  this phase already ships. A later Restore click is the same endpoint with `pendingDelete: false`.
- **Mobile tap targets and the blur/click-race `onMouseDown` fix** (Gaps 4/7) are entirely
  UI-layer — nothing in this phase's server contract depends on them.
- **Star & Notes handoff reminder** (Phase 3's item 4, unchanged): once this ships, re-confirm
  `docs/work-log/2026-07-28-budget-star-notes.md`'s Phase 1 flow descriptions against the new
  row/section shape before writing that feature's code.

---

## Phase 4 — Implementation (UI) — 2026-07-29

**Owner:** ux-developer
**Status:** complete — qa (Phase 5) is next

### Summary
Implemented every client-layer item the Phase 3 design named across the four existing
components (no new files): the Income/Expense section split with `+ add category` relocated to
each section header (`guided-budget-setup.tsx`); the render-order fix, the `+ add cause` control
(replacing the old hard-defaulted "Break down by cause" link, reused for both first-entry and
second/third-group add), category remove-in-breakdown, and the blur/click-race `onMouseDown`
fix (`budget-editor.tsx`); the per-cause `+ add line item` (no per-line cause `<select>` anywhere
now), delayed-commit toast-Undo for single line-item removal, and confirm-then-immediate
cause-group removal/restore (`budget-cause-editor.tsx`); and the compact cause/line-item detail
on the print worksheet with category-subtotal-grain hand-annotation lines only
(`budget-print-worksheet.tsx`). `page.tsx` needed one small type-widening edit (see below) — the
`...cl` spread already threaded `pendingDeleteAt` through at runtime, but its declared type
didn't say so.

### What I did
- Read the Phase 3 design doc in full (Component/Page Plan, Implementation Order, Edge Cases,
  the API contracts api-developer shipped) and DECISION-054/055/056 before touching any code.
- **`src/app/(dashboard)/admin/ledger/budgeting/page.tsx`** — widened `enrichCauseLines`'s
  parameter type to declare `pendingDeleteAt: string | null` explicitly. Confirmed (per
  api-developer's handoff note) that the `...cl` spread was already forwarding the field at
  runtime since `getFundReport`'s widened shape is a superset of the old one — this was a
  type-declaration-only fix, not a behavior change.
- **`src/components/admin/ledger/guided-budget-setup.tsx`**:
  - Added `seedCauseLinePendingCents` (mirrors `seedLineValues`/`seedPendingDeleteKeys`'s
    contract exactly) and a `causeLinePendingCents` state map, re-synced in the *same* existing
    `useEffect` keyed on `funds` — did not touch the mount-vs-refresh re-sync fix from
    `2026-07-28-budget-live-totals-stale.md`, only extended it to a third map.
  - Added `handleCauseLinePendingDeltaChange(fundId, key, deltaCents)`, wired into
    `BudgetEditor`'s new `onCauseLinePendingDeltaChange` prop, which bubbles up from
    `BudgetCauseEditor`'s `onPendingDeltaChange`.
  - `fundSums()` now calls `computeFundLineSums` with all three arguments.
  - `totalPendingDeleteCount()` extended to also count individually pending-delete cause lines
    (server-committed only, across every fund/category) — a cause-group removal flips every
    member row's own flag, so this single loop counts both single-line and group removals
    uniformly with no separate bookkeeping.
  - Replaced the single fund-wide content block with a `renderFlowSection(fund, flow)` helper
    called twice per fund (`"income"`, `"expense"`) — each section independently renders its own
    header, its own `+ Add category` trigger (moved from the bottom-of-card two-button row up to
    the section header, one button per section), its own empty state (Flow 7 — a fund with
    categories in only one flow still shows the other flow's header + add control), and its own
    add-category form (the existing `addCategoryState` machinery is reused as-is; only the
    trigger buttons and form `id`s moved/became per-section).
- **`src/components/admin/ledger/budget-editor.tsx`** (the render-order fix + the new
  `+ add cause` control + Flow 6):
  - Added an optional `flow` prop; when set, drops the now-redundant per-row INCOME/EXPENSE
    badge (kept for the one remaining mixed-flow caller, `[fundSlug]/report/page.tsx`, which
    doesn't pass it).
  - **Render-order fix**: the pending-delete branch is now checked *before* the breakdown
    branch. A category can now be both `pendingDeleteAt` and carry `causeLines` (Flow 6), and the
    deleted/Restore-able treatment must win regardless of breakdown state.
  - The pending-delete row now shows a `"(N cause lines)"` hint when `line.causeLines` is
    non-empty, so the treasurer isn't surprised at finalize time about what's riding along.
  - Removed the dead `has_cause_breakdown` fallback message from `setPendingDelete`'s error
    handling (api-developer flagged this as dead code once the guard came out server-side).
  - New `+ add cause` control (`renderAddCauseControl`), rendered on every giving-eligible
    expense category row regardless of breakdown state, computing unused causes from the
    server-sourced `line.causeLines` (not any local uncommitted row — matches the Phase 3
    design's own "initialLines" wording). Picking a cause on a lump-sum category enters
    breakdown mode with that cause pre-filled (`breakdownInitialCause` state, replacing the old
    hard `OTHER_COMMUNITY_SUPPORT_CAUSE` default); picking a cause on a category already in
    breakdown sets a `requestedNewCause` **command prop** that the mounted `BudgetCauseEditor`
    consumes via a `useEffect` to append a fresh pending row, then clears back to `null` via
    `onNewCauseRequestHandled`. Stays visible after use (not one-shot); hides entirely once every
    cause is in use.
  - Added a category-remove control (trash icon) inside the breakdown-mode render branch — Flow
    6. Per the Phase 3 design's explicit call, `requestRemove`/`requestRestore` are **unchanged**
    (still immediate, no `ConfirmDialog` — matches the existing lump-sum precedent; the
    persistent Restore row is the safety net, not a confirm dialog). The only reason this didn't
    already work was the server-side `has_cause_breakdown` guard api-developer removed.
  - `onMouseDown={(e) => e.preventDefault()}` added to every remove/restore/add-cause-picker
    control in this file (DECISION-054 item 1).
- **`src/components/admin/ledger/budget-cause-editor.tsx`** (the biggest diff):
  - Exported `ALL_CAUSES` (previously a local `const`) so `budget-editor.tsx` can compute unused
    causes for its picker.
  - `Row` gains `pendingDeleteAt: string | null` (server-committed own flag) and
    `holdingForDelete: boolean` (client-only toast-countdown state) — a row renders "dead"
    (struck-through, inputs disabled, excluded from every on-screen total) when either is set.
  - Removed the per-line cause `<select>` and `handlePendingCauseChange` entirely. `addRow()`
    became `addRowForCause(cause)`, called both by a new per-cause-group "+ add line item"
    control and by the `requestedNewCause` command-prop effect.
  - **Delayed-commit Undo** for single line-item removal (Flow 4) — see "How Undo is implemented"
    below.
  - **Cause-group remove/restore** (Flow 5) — confirm-then-immediate (no timer), one atomic
    `PATCH /budgets/cause-lines/group` flipping every committed row in the group; any
    never-saved row in the same group is dropped locally in the same action. A persistent
    "Restore group" control replaces the trash icon once every row in a group is dead.
  - Replaced `currentTotalCents` to exclude dead rows (both the on-screen "Category total: $X"
    footer and each group's "Subtotal: $X") — this is a purely local, render-time computation
    with no prop plumbing; it has no bearing on `onTotalChange`'s payload (see next point).
  - **Confirmed `onTotalChange` needs zero new calls for any remove/undo/restore transition.**
    A soft-deleted row's `amountCents` is never touched (mirrors Ruling 1) and the row stays in
    the `rows` array (just flagged dead) rather than being spliced out — so the category's GROSS
    total genuinely doesn't change across a hold-start/cancel/commit/restore. All cross-cutting
    live-balance bookkeeping instead flows through the new `onPendingDeltaChange` prop, which
    keeps this component's own local total logic simple and avoids double-accounting.
  - `onMouseDown={(e) => e.preventDefault()}` added to every add/remove/restore/collapse control
    in this file (DECISION-054 item 1).
  - Removed the old single-line `removeConfirm`/`ConfirmDialog` and `doRemoveCommitted` (the hard
    `DELETE` path) entirely for the committed-row remove flow — replaced by the flag-flip PATCH
    behind the hold timer. `doRemoveLocal` (never-saved row, no server call) is unchanged.
- **`src/components/admin/ledger/budget-print-worksheet.tsx`**:
  - `PrintLine` gains `causeLines: PrintCauseLine[] | null`; `PrintCauseLine` is
    `{ cause, label, amountCents, pendingDeleteAt? }` (optional to stay structurally assignable
    from `FundSetupItem.budgetEditorLines[].causeLines`, which the page already builds — no new
    query).
  - `FlowTable` groups each category's live cause lines (`isCauseLineLive(cl.pendingDeleteAt ??
    null, line.pendingDeleteAt)`) by cause and renders one compact subtotal row + one compact
    per-line row underneath the category row, using a `Fragment` (imported from `react`) so each
    group's rows key correctly inside the `<tbody>`. The existing ~2 blank hand-annotation ruled
    lines stay exactly where they were — after the category row, at category-subtotal grain only,
    not duplicated per cause or per line (Q4, resolved: compact).
- Ran `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build:only` after each file, not just at
  the end.

### How the delayed-commit Undo is implemented
Entirely client-side in `budget-cause-editor.tsx`, no new server endpoint (confirmed per
architect/tech-lead's Phase 2/3 notes):
- `startHold(rowId)` — captures the row's current `amountCents` synchronously, flips
  `holdingForDelete: true` on that row (renders it dead immediately), fires
  `onPendingDeltaChange(amountCents)` so the fund-level live balance excludes it right away, sets
  a `setTimeout` (`HOLD_MS = 6000`, overriding sonner's own 4000ms default so the toast can't
  disappear before the hold window elapses) keyed by the row's own server `id` in a
  `useRef<Record<string, Timeout>>`, and shows a `sonner` toast with an `action: { label: "Undo",
  onClick: () => cancelHold(...) }`.
- **Undo clicked in time** (`cancelHold`) — `clearTimeout`, flips `holdingForDelete: false`,
  fires `onPendingDeltaChange(-amountCents)`. Zero network calls ever happen — the row was never
  touched server-side.
- **Hold expires** (`commitHoldDelete`) — fires the same `PATCH /budgets/cause-lines { id,
  pendingDelete: true }` api-developer already shipped. On success the row moves from
  `holdingForDelete` to a server-committed `pendingDeleteAt` (visually identical, same dead-row
  treatment, but a later click now goes through `restoreCommittedLine` — the same endpoint with
  `pendingDelete: false` — instead of `cancelHold`). On failure, reverts the row and gives the
  delta back via `onPendingDeltaChange(-amountCents)`, with a toast error.
- **Cleanup on unmount** — a `useEffect` clears every outstanding timer (without firing the
  request) when the component unmounts, e.g. a category-level remove-in-breakdown or a
  "Collapse to lump sum" that unmounts this whole editor before a hold's 6s window elapses. Per
  Ruling 4 (category-level pending-delete never cascades a write onto children), this is
  correct — the line's own flag simply never gets set, matching what would have happened if the
  treasurer had clicked Undo.
- Cause-**group** removal (Flow 5) deliberately does **not** use this hold/timer mechanism — it's
  confirm-then-immediate, reversible only via a persistent "Restore group" control, per
  DECISION-055 item 2's explicit distinction between the two removal models.

### Outputs
- `src/app/(dashboard)/admin/ledger/budgeting/page.tsx` — `enrichCauseLines`'s parameter type
  widened to declare `pendingDeleteAt: string | null` (no runtime change).
- `src/components/admin/ledger/guided-budget-setup.tsx` — section split, `causeLinePendingCents`
  state/seed/delta-handler, `totalPendingDeleteCount` extended, `renderFlowSection` helper.
- `src/components/admin/ledger/budget-editor.tsx` — `flow` prop, render-order fix, `+ add cause`
  control + `requestedNewCause` command prop, category remove-in-breakdown, dead
  `has_cause_breakdown` message removed, `onMouseDown` fix on every control.
- `src/components/admin/ledger/budget-cause-editor.tsx` — exported `ALL_CAUSES`; `Row` gains
  `pendingDeleteAt`/`holdingForDelete`; per-line cause `<select>` removed; `addRowForCause`
  replaces `addRow`; delayed-commit Undo (`startHold`/`cancelHold`/`commitHoldDelete`);
  cause-group remove/restore (`doGroupRemove`/`doGroupRestore`) with its own `ConfirmDialog`;
  old single-line `removeConfirm`/`doRemoveCommitted` removed; `onMouseDown` fix on every
  control.
- `src/components/admin/ledger/budget-print-worksheet.tsx` — `PrintCauseLine` type, compact
  cause/line-item rendering via `isCauseLineLive`, category-subtotal-grain hand-annotation lines
  preserved unchanged.
- No schema or API changes this phase (database-admin's Phase 4a and api-developer's Phase 4 API
  section already shipped everything this phase consumes).

**Verification (Phase 4 gate, all before reporting done):**
- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 713 passed (unchanged from api-developer's phase; no new unit tests were added
  this phase — the Phase 3 design doc's "Unit tests to write" list names only pure/library
  functions, all of which api-developer already delivered; this phase's surface is UI
  composition with no new pure logic to unit-test).
- `pnpm build:only` — clean production build, `/api/admin/ledger/budgets/cause-lines/group`
  present in the route manifest (built by api-developer's phase, unchanged here).
- `pnpm lint` — **could not run**; pre-existing environment issue unrelated to this change (a
  `minimatch`/ESM export mismatch inside `@eslint/eslintrc`'s dependency chain, reproduces on a
  clean `pnpm lint` with no files changed). Flagging for the dependencies review rather than
  attempting a fix in this work-log's scope.
- No native browser dialogs introduced (`window.confirm`/`alert`/`prompt` — none; every
  destructive confirm uses `<ConfirmDialog>`).
- No `console.log` in any of the four touched components or `page.tsx`.
- Every mutation path already surfaces failures via `toast.error` (unchanged pattern, extended to
  the new hold/group functions); every new/existing control respects `disabled`/locked state.

### Open questions / handoff notes
- **qa (Phase 5) is next.** Focus areas, in priority order:
  1. **The blur/click-race fix** — Gap 4's named repro: focus an amount input, type a value,
     then *without blurring first* click a different row's remove/restore/add control under a
     throttled network; confirm the first click always registers (no more "click did nothing,
     second click worked").
  2. **Lump-sum ↔ breakdown transitions** — picking a cause via `+ add cause` on a lump-sum
     category enters breakdown correctly pre-filled to the chosen cause (not
     `OTHER_COMMUNITY_SUPPORT_CAUSE`); picking a *second* cause on an already-in-breakdown
     category correctly appends a new group without disturbing existing groups' typed-but-not-
     yet-committed values; "Collapse to lump sum" and "Cancel" (never-committed pre-fill) both
     still work.
  3. **Delayed-commit Undo** — remove a committed line, confirm the toast appears and the row
     goes dead immediately; click Undo before ~6s and confirm zero network calls fire (check the
     Network tab) and the row returns to normal; let the hold expire and confirm the `PATCH`
     fires and a later page load still shows it Restore-able.
  4. **Cause-group remove/restore** — confirm dialog copy, all N rows go dead as a unit, "Restore
     group" brings them all back; try it with a never-saved (uncommitted) row mixed into the
     group.
  5. **Category remove in breakdown mode (Flow 6)** — remove a category that has 2+ causes/lines
     underneath it; confirm the "(N cause lines)" hint shows the right count, Restore brings the
     whole category (and its cause lines' own individual flags — unaffected either way) back.
  6. **Empty sections (Flow 7)** — a fund with categories in only one flow shows the *other*
     flow's header + "+ Add category" control, not silence.
  7. **Mobile at ~360px** — every new control (`+ add cause` picker chips, `+ add line item`,
     group remove/restore, Undo) hits the 44px tap-target minimum and doesn't overflow.
  8. **Print worksheet** — a fund with cause-broken-down categories prints cause subtotals + line
     labels/amounts compactly, with the blank hand-annotation lines still only at the
     category-subtotal grain (not duplicated per cause/line); a pending-delete line/category is
     excluded.
- **New copy strings the Lions Club may want to refine**: "Removed …" toast text; "Remove this
  cause group?" / `Remove "{cause}" and its N line item(s)?` confirm copy; the
  "(N cause lines)" hint pill text; "+ Add cause" / "+ Add line item" / "Restore group" button
  labels.
- **UX decision/tradeoff worth flagging explicitly**: per the Phase 3 design's own instruction,
  category-level remove (Flow 6) stays **unconfirmed** (matches the pre-existing lump-sum
  behavior) even when it takes causes/lines with it — the Phase 1 analyst pass had recommended a
  `ConfirmDialog` with copy naming the cause/line count for this case, but Phase 3 explicitly
  overrode that in favor of keeping `requestRemove`/`requestRestore` unchanged, reasoning that
  the persistent Restore-until-finalize control is the safety net. I followed Phase 3 (the
  closer-to-implementation, most-recent decision) rather than Phase 1's flow description; qa
  and/or the analyst's Phase 6 review should confirm this is the intended final behavior, since
  it's a real divergence between two phases of this same work-log.
- **`pnpm lint` is broken in this environment** independent of this change — worth a note to
  deployment-engineer/dependencies review rather than silently working around it.
- **Star & Notes handoff reminder** (unchanged from api-developer's phase): once this ships,
  whoever picks up `docs/work-log/2026-07-28-budget-star-notes.md` needs to re-confirm its
  Phase 1 flow descriptions against the new row/section shape (cause-group headers are now a
  distinct row grain that didn't exist before) before writing code.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-29
**Verified by:** qa

## Summary

**Verdict: PASS.** Re-ran every automated gate myself rather than trusting the implementers'
reports: `tsc --noEmit` clean, `pnpm test` 713/713 passing (all Phase-3-named regression tests for
`isCauseLineLive`, `computeFundLineSums`'s third arg, `setBudgetCauseLinePendingDelete`,
`setBudgetCauseGroupPendingDelete`, and the finalize-purge extension are present and green), and
`pnpm build:only` clean with `/api/admin/ledger/budgets/cause-lines/group` in the route manifest.
Added a 13-test Playwright regression suite (`e2e/budgeting-restructure.spec.ts`) driven against a
real running dev server and the dev DB, covering every item on the implementers' Phase 5 focus
list, including a mechanism-level regression test for the blur/click race (Gap 4) — the whole
reason this feature exists. All 13 pass, twice in a row from a clean fixture state, and the full
existing e2e suite (43 tests) still passes except one pre-existing, unrelated flake (see below).
One divergence is flagged for Phase 6, per the instruction not to silently pass it: category
remove-in-breakdown (Flow 6) ships **unconfirmed** (no `ConfirmDialog`), which is what Phase 3
explicitly decided, overriding Phase 1's ask — analyst should sign off on this consciously.

## What I did

- Read the full work-log (Phases 1–4, all "for QA to focus on" handoff notes) before touching
  anything.
- Re-ran `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm build:only` myself from scratch (not
  trusting the implementers' self-reported numbers).
- Read the actual shipped code in all four touched components
  (`guided-budget-setup.tsx`, `budget-editor.tsx`, `budget-cause-editor.tsx`,
  `budget-print-worksheet.tsx`) and the three write-surface routes
  (`api/admin/ledger/budgets/cause-lines/route.ts`, `.../cause-lines/group/route.ts`,
  `api/admin/ledger/budgets/route.ts`) to verify the feature-gate audit and to get the exact
  accessible names needed for real Playwright selectors, rather than inferring behavior from the
  design doc alone.
- Started the dev server (`pnpm dev`) against `.env.local`'s Neon dev DB and used direct SQL to
  confirm what fund/category/fiscal-year fixture data already existed before writing any e2e code.
- Wrote `e2e/budgeting-restructure.spec.ts` — a new, 13-test Playwright suite exercising every item
  on both implementers' "for QA to focus on" lists against the Foundation entity's Charitable Fund
  at a dedicated fiscal year (FY2099) chosen specifically so this suite never touches the
  treasurer's real FY2026 budget.
- **Discovered and worked around a real, pre-existing race** while writing the first version of the
  suite (not new to this feature — see "Incidental finding" below): filling a cause line's amount
  field then its label field back-to-back, without waiting for each field's own blur-triggered
  commit to resolve, lets the first commit's async success handler overwrite the second field's
  just-typed value before it's ever sent. Fixed by writing a `fillAndCommitCauseLine` test helper
  that waits for each field's PATCH to actually resolve before touching the next field — this is
  also exactly the cadence a real treasurer typing at normal speed already uses, so it isn't a
  contrived test-only accommodation.
- Ran the new suite to a clean pass, cleaned the fixture DB state, and re-ran it a second time from
  scratch to confirm it isn't flaky before trusting it.
- Ran the full existing e2e suite (`pnpm test:e2e`, all files) to confirm nothing else regressed.
- Read `src/components/ui/confirm-dialog.tsx` and the `budget-editor.tsx`/`budget-cause-editor.tsx`
  remove/restore code paths directly to confirm, by reading code (not by inferring from passing
  tests), that category-level remove-in-breakdown genuinely ships with no `ConfirmDialog` while
  cause-group remove genuinely has one — the flagged divergence is asserted by an automated test,
  not just noted in prose.
- Ran a scoped Vitest coverage pass on `src/lib/ledger.ts` (home of `isCauseLineLive` and
  `computeFundLineSums`) to get a concrete number for this feature's new pure logic.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — zero errors, including the new `e2e/budgeting-restructure.spec.ts`
(e2e files are included by the root `tsconfig.json`, not a separate config).

## Unit Tests

`pnpm test`: **PASS**
Total: 713 | Passed: 713 | Failed: 0
Duration: ~0.9s
Confirmed present and green (not just counted): `isCauseLineLive` 4-case truth table
(`src/lib/ledger.test.ts:2489`), `computeFundLineSums`'s three new third-arg cases
(`src/lib/ledger.test.ts:2515`), `setBudgetCauseLinePendingDelete` and
`setBudgetCauseGroupPendingDelete` happy-path/404/409 suites (`src/lib/ledger-queries.test.ts:691,782`),
and the finalize-purge transaction's two new cases (partial-purge recompute; purge-the-last-surviving-line
cascades to the parent) in `src/app/api/admin/ledger/budget-approvals/route.test.ts`.

## Production Build

`pnpm build:only`: **PASS** — clean build, zero warnings/errors in the build output. Confirmed
`/api/admin/ledger/budgets/cause-lines/group` appears in the route manifest (`ƒ
/api/admin/ledger/budgets/cause-lines/group`), alongside the unchanged `.../cause-lines` and
`.../cause-lines/collapse` siblings.

`pnpm lint`: **FAIL, but pre-existing and unrelated** — reproduces on a clean tree with zero files
changed (`@eslint/eslintrc`'s bundled `minimatch` dependency has an ESM default-export mismatch:
`SyntaxError: The requested module 'minimatch' does not provide an export named 'default'`). Not a
regression from this feature; flagging again for the dependencies review per both implementers'
notes.

## End-to-End Tests

`pnpm test:e2e` (full suite, all files): **PASS** (one pre-existing, unrelated flake — see below)
Total: 43 | Passed: 42 | Failed: 1 (pre-existing) | Skipped: 1 (write-in-signups Test 2, itself
depends on Test 1's fixture state per that file's own design) | Did not run: several downstream
of the one failure in a serial block
Duration: ~59s (full suite, 8 workers)

New suite alone (`e2e/budgeting-restructure.spec.ts`), run twice from a clean fixture state to rule
out flakiness:
Total: 13 | Passed: 13 | Failed: 0 (both runs)
Duration: ~55s per run

**The one full-suite failure is unrelated to this feature:**
`recurring-signup-rollup.spec.ts:203` ("cancelled occurrence excluded from list count and detail
rollup header") failed twice under the full 8-worker parallel run with an off-by-one attendee count
(32 vs. 33), but **passed cleanly in isolation** when I re-ran just that file alone. This matches
`admin-security.spec.ts`'s own documented rationale for running serially: `recurring-signup-rollup.spec.ts`
and `cancel-occurrence.spec.ts` share a single fixture event and are timing-sensitive under high
worker parallelism. This is a pre-existing concurrency flake in an unrelated events/RSVP suite, not
a regression from the budgeting restructure — my new suite doesn't touch events, RSVPs, or that
fixture at all.

## Manual / Structural Verification (things the e2e runner couldn't reach or that were faster to verify by reading code)

| Item | Result | Notes |
|------|--------|-------|
| Mobile 44px tap targets across every new control | Verified both ways | Grepped every new button in `budget-editor.tsx`/`budget-cause-editor.tsx` for `min-h-[44px]`/`min-w-[44px]` (all present) AND asserted two representative controls' real bounding boxes at a 360px viewport in the e2e suite. |
| `onMouseDown` preventDefault present on every add/remove/restore/collapse control | Verified by code | Grepped both files: 13 occurrences in `budget-cause-editor.tsx`, 6 in `budget-editor.tsx`, matching every control named in the design doc. |
| `has_cause_breakdown` guard removed from `setBudgetLinePendingDelete` only, `upsertBudgetLine`'s copy untouched | Verified by code | Read `src/lib/ledger-queries.ts` directly rather than inferring from the passing test suite. |
| Print worksheet compact rendering + category-subtotal-grain-only annotation lines | Verified by code + e2e | Read `budget-print-worksheet.tsx` in full; e2e test confirms live cause/line detail renders and a pending-delete line is excluded from the hidden `print:block` DOM. |

## Regression Tests Added

All in `e2e/budgeting-restructure.spec.ts` (new file):

- **"regression: a single click on a different row's remove control always registers — no second
  click required (Gap 4)"** — `e2e/budgeting-restructure.spec.ts:241` — guards against the
  blur-vs-click race that was the entire reason for this feature. Focuses a committed row's amount
  input, types a new value without blurring, then clicks a *different* row's remove control once,
  and asserts (a) the first input is **still focused** immediately afterward — the mechanism-level
  proof that `onMouseDown={preventDefault}` suppressed the browser's default focus-shift/blur
  entirely, not just that the race happened not to lose — and (b) the other row goes dead
  (Undo-visible) after that single click, no second click needed.
- **"delayed-commit Undo: clicking Undo in time fires zero network calls; letting the hold expire
  commits the flag-flip"** — `e2e/budgeting-restructure.spec.ts:301` — guards against a regression
  to the old immediate-hard-DELETE model. Captures every PATCH request to `.../cause-lines` during
  an Undo-in-time and asserts the count is exactly zero (mirrors the design's own "zero network
  calls" contract), then separately asserts the *hold-expires* path does send exactly one
  `pendingDelete: true` PATCH and that a full page reload still shows the line Restore-able.
- **"Flow 6: category remove-in-breakdown is UNCONFIRMED (no ConfirmDialog) — flagged divergence
  from Phase 1's ask, per Phase 3's explicit override"** — `e2e/budgeting-restructure.spec.ts:424`
  — guards against a future refactor silently reintroducing a ConfirmDialog here (which would be a
  behavior change, not a bug fix) or silently removing the persistent Restore safety net. Asserts
  zero `alertdialog`s appear on click and that the "(N cause lines)" hint shows the correct count.
- **"cause-group remove/restore: confirm dialog copy, mixed committed + uncommitted rows, group
  Restore"** — `e2e/budgeting-restructure.spec.ts:375` — guards against the one-transaction
  requirement regressing to N sequential calls, and against an uncommitted row surviving a group
  remove it should be silently dropped from. Asserts the exact ConfirmDialog copy (cause name +
  line count) and that the count includes the uncommitted row.
- **"live totals: the fund card's Expenses total already excludes a pending-delete cause line
  before any reload"** — `e2e/budgeting-restructure.spec.ts:466` — guards against
  `computeFundLineSums`'s new third parameter (`causeLinePendingCents`) silently going stale or
  never being wired up client-side; asserts the exact dollar figure, not just "changed."

## Incidental finding (not a regression from this feature — flagging for the record)

While writing the suite, sequential amount-then-label entry on a brand-new cause line (fill amount,
Tab, fill label, Tab — the natural order) can, under real network latency, lose the typed label:
each field commits independently on blur (`commitRow`), and the **first** field's async success
handler unconditionally overwrites `row.label`/`row.value` from the server's response, even if the
second field has since been edited locally. This predates this feature (the per-field
commit-on-blur design is from B-17/Labeled Cause Budget Lines) and this restructure didn't touch
that mechanism — it only changed how a new row is *added* (per-cause, no dropdown), not how a
single row's fields commit. I did not chase or fix this; it's out of scope for this feature's PASS
verdict, but worth a line in `docs/backlog.md` or a future tech-lead review, since a treasurer
typing at normal speed on a slow connection could plausibly hit it. Noting it here so it isn't
lost.

## Coverage on Critical Modules

The three modules named in this project's standing coverage targets
(`src/lib/events.ts`, `src/lib/permissions.ts`, `src/lib/members.ts`) are **untouched by this
feature** — not applicable here. For the modules this feature actually changed:

- `src/lib/ledger.ts` (home of `isCauseLineLive` and `computeFundLineSums`'s new third arg):
  **100% statements, 95.7% branches, 100% functions** (scoped Vitest coverage run).
- `src/lib/ledger-queries.ts`: not meaningfully summarizable as a single percentage — it's a
  ~4,400-line file covering the entire Ledger surface (reconciliation, transactions, donors,
  filings, etc.), not just this feature's two new functions. The two new functions
  (`setBudgetCauseLinePendingDelete`, `setBudgetCauseGroupPendingDelete`) each have a dedicated
  happy-path/404/409/lock-check test suite (`src/lib/ledger-queries.test.ts:691-870`), which is the
  meaningful unit here.

## Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `PATCH /api/admin/ledger/budgets/cause-lines` (existing route, third body shape added) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `PATCH /api/admin/ledger/budgets/cause-lines/group` (new route) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `PATCH /api/admin/ledger/budgets` (existing route, no shape change — guard removed one layer down) | yes | yes | `FEATURES.LEDGER_MANAGE` |
| `budget-approvals` finalize-purge transaction (existing route, transaction body extended) | yes | yes | `FEATURES.LEDGER_APPROVE` (correct — locking/finalizing is a distinct, pre-existing gate from day-to-day budget editing, unchanged by this feature) |

Verified by reading each route file directly (not inferred from passing tests), per the mandatory
instruction. All four correctly restrict to the role that owns budget-editing/approval — this
feature carries no bulk-PII export or read-only endpoint that would need a `*_VIEW`-shaped key
instead.

## Verdict: PASS

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-29
**Reviewed by:** analyst

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

The restructure delivers exactly what the treasurer asked for at the meeting-table grain —
header-level `+ add category`, contextual `+ add cause`/`+ add line item` that never again lands
a line in the wrong cause group, a verified first-click fix for the blur/click race, and a
uniformly reversible-until-finalize remove model at every grain — with one conscious exception,
category-remove-in-breakdown shipping **unconfirmed** against the brief's own explicit "confirm"
language, that needs Chris's affirmative word (not just his awareness) before this work-log closes
clean.

## What's Working

- **The actual complaint is fixed, and QA proved the mechanism, not just the symptom.** The
  blur-vs-click race (Gap 4) — the reason this whole feature exists — is fixed with
  `onMouseDown={preventDefault}` on every add/remove/restore control in `budget-editor.tsx` and
  `budget-cause-editor.tsx` (19 occurrences, grepped by QA), and the e2e regression test at
  `e2e/budgeting-restructure.spec.ts:241` asserts the *mechanism* (the focused input is still
  focused after the click — proof the browser never fired the racing blur-commit at all), not
  just "the click worked once." That's a materially stronger guarantee than a flaky-prone
  behavioral assertion would have been.
- **"Add line just added a line to the first cause" is structurally impossible now.** The per-line
  cause `<select>` is gone entirely from `budget-cause-editor.tsx`; every new line is created via
  `addRowForCause(cause)` scoped to the group it was clicked from. This isn't a UI polish fix, it's
  the root-cause fix the brief asked for.
- **Delayed-commit Undo does exactly what Phase 1's open question (Gap 3) asked for**, and picked
  the analyst's own recommended resolution: Undo-in-time fires zero network calls (verified by the
  e2e suite capturing PATCH requests, not just watching the UI), and a hold that expires flips to
  the same struck-through/Restore treatment a category-level soft-delete already has — one mental
  model across every grain.
- **`+ add cause` stays visible and offers only unused causes** (Gap 2's resolution), confirmed by
  reading `budget-editor.tsx`'s `renderAddCauseControl` rather than inferring from a passing test.
- **Print worksheet hits the treasurer's stated need** ("traceable... beneficiary-by-beneficiary")
  at the compact density Chris resolved (Q4) — cause subtotals + per-line labels/amounts render,
  the category-subtotal-grain hand-annotation lines are undisturbed, and a pending-delete line is
  excluded from the printed DOM (verified by e2e, not just code reading).

## Intent-vs-Shipped Diff

| Phase 1 flow | Shipped | Verdict |
|---|---|---|
| Flow 1 — add category from section header | `renderFlowSection` per flow, header carries `+ add category`, existing picker reused as-is | matches |
| Flow 2 — add cause to giving-eligible category, stays visible after first use | `renderAddCauseControl`, computed from unused causes, visible in and out of breakdown | matches |
| Flow 3 — add line item under a cause, no per-line cause dropdown | per-cause-group `+ add line item`, `addRowForCause`, `<select>` deleted entirely | matches |
| Flow 4 — line-item remove immediate + quiet Undo, delayed-commit semantics | `startHold`/`cancelHold`/`commitHoldDelete`, 6s window, zero network calls if undone in time (e2e-verified) | matches |
| Flow 5 — cause-group remove, confirm, one transaction | `ConfirmDialog` with cause+count copy, single `PATCH .../cause-lines/group` flipping all rows atomically, persistent "Restore group" | matches |
| Flow 6 — category remove in breakdown mode, **confirm** when it takes causes/lines with it | ships **unconfirmed** — `requestRemove`/`requestRestore` unchanged, matching lump-sum precedent, persistent Restore row as the stated safety net | **acceptable drift, conditional — see ruling below** |
| Multi-click remove race fixed at the root | `onMouseDown` preventDefault everywhere, e2e mechanism-level proof | matches |
| Line items on printable/mailed worksheet (B-31 folded in) | compact per-cause-group + per-line rows, category-subtotal-grain annotation lines preserved, pending-delete lines excluded | matches |
| Empty section shows its own header + add control (Flow 7) | `renderFlowSection` called independently per flow, no fund-wide gating | matches |
| Locked budget disables every control (Flow 8) | existing `editorDisabled` pattern extended; `assertBudgetUnlocked()` re-derived server-side on both new write surfaces | matches |

## Ruling on the Flow 6 confirm-dialog divergence

This is the one item that needs a conscious decision recorded here, not a rubber stamp.

**What actually diverged, and from whom.** The "confirm" requirement for category-remove-in-
breakdown isn't just an analyst embellishment from Phase 1 — it's in the brief's own
"Agreed shape (settled with Chris)" language at the top of this work-log: *"Category → explicit
remove, available even in breakdown mode, **confirm** when it takes causes/lines with it."* Phase
3 (tech-lead) then made a deliberate, well-reasoned call to override that and keep
`requestRemove`/`requestRestore` unconfirmed, on the grounds that the persistent
Restore-until-finalize row is a stronger safety net than a modal a treasurer will reflexively
click through mid-meeting. That reasoning is sound as UX judgment — a confirm dialog on a
reversible action is often theater, and a board member fumbling through a modal is exactly the
"fighting him on the two most common actions" complaint this feature exists to fix. QA correctly
declined to silently pass this and flagged it explicitly, and even wrote a regression test
(`e2e/budgeting-restructure.spec.ts:424`) that pins the unconfirmed behavior down so a future
refactor can't silently change it either direction without the test failing.

**Why I'm not calling this "matches" outright.** Chris was told about the divergence mid-project
and said it's "easy to add a confirm if I'd prefer one" — that's *awareness*, not *approval*. He
hasn't affirmatively said "ship it unconfirmed," and the thing being overridden is his own
explicit word from the debrief, not an inference the analyst made on his behalf. Shipping a
directly-contradicted explicit requirement on the strength of "he didn't object" is a real gap,
even though the severity is low (the safety net genuinely does mitigate the risk this was meant to
guard against — an accidental category removal is recoverable until Approve & lock, same as
today's lump-sum categories already are).

**My recommendation:** ship as-is (unconfirmed) — Phase 3's reasoning is good UX and consistent
with the existing lump-sum precedent — but this closes as **SHIP WITH NOTES**, not SHIP IT,
specifically because of this one item. The follow-up is not "add the confirm dialog," it's "get
Chris's explicit yes/no on the unconfirmed behavior now that it's live and he can click through it
himself in front of the board," with implementing the `ConfirmDialog` (a small, contained change —
wrap `requestRemove` when `line.causeLines` is non-empty, same pattern the cause-group remove
already uses) as the fallback if he says he'd rather have it. Do not treat his mid-project comment
as the sign-off; get the sign-off after he's used the shipped feature once.

## Edge Cases

| Case | Result | Notes |
|---|---|---|
| Empty per-section states (Flow 7) | pass | Verified by code (`renderFlowSection` called unconditionally per flow) and not contradicted by e2e |
| Failure microcopy | pass | Existing toast patterns extended, not reinvented — "Could not remove/restore this line. Try again" style, human language, no stack traces surfaced to the user |
| Permission/lock gate | pass | QA's feature-gate audit table confirms `auth()` + `hasFeature(FEATURES.LEDGER_MANAGE)` on all three budgeting write surfaces and `FEATURES.LEDGER_APPROVE` (correct, distinct gate) on the finalize-purge; `assertBudgetUnlocked()` re-derived server-side, not trusted from the client, on both new write surfaces |
| Mobile 360px / 44px tap targets | pass | Verified two ways: grepped every new control for `min-h-[44px]`/`min-w-[44px]` AND e2e bounding-box assertion at a 360px viewport |
| Brand consistency (rounded-2xl cards, rounded-lg buttons, ConfirmDialog not window.confirm) | pass | No native dialogs introduced; cause-group and category-lump-sum removes both go through `<ConfirmDialog>` where a dialog is used at all; Flow 6's category-in-breakdown is the one path with no dialog, by the ruling above |

## Pre-existing issues QA surfaced (not this feature's bugs)

- **B-35 — cause-line label lost when amount then label are committed back-to-back.** Confirmed
  in `docs/backlog.md` with a concrete repro, root cause (each field's blur-commit success handler
  unconditionally overwrites local state, clobbering a since-edited field), and fix direction
  (don't overwrite a field edited since the request fired). Originates in B-17/DECISION-047/048,
  predates this restructure, and this restructure's own e2e suite worked around it with a
  `fillAndCommitCauseLine` helper rather than masking it. **Does not block SHIP** — it's a
  pre-existing data-loss bug in a mechanism this feature didn't touch (how a single row's fields
  commit), not a regression this feature introduced (how a new row is added).
- **`pnpm lint` environment failure (`@eslint/eslintrc`/`minimatch` ESM mismatch).** Reproduces on
  a clean tree with zero files changed; not a regression from this feature. **Does not block
  SHIP.** Flagging once more here (as both implementers and QA already did) since it's been noted
  three times now in this same work-log without landing in a tracked follow-up — recommend it get
  a line in the next dependencies review rather than being re-discovered fresh each feature.

## Follow-Ups (SHIP WITH NOTES)

1. ✅ **RESOLVED 2026-07-29 — Chris chose the confirm dialog.** Asked directly post-Phase-6; he
   picked "Add the confirm dialog" (restoring his original Flow 6 ask), on the consistency argument
   (category remove is more destructive than cause-group remove, which already confirms). Implemented
   in `budget-editor.tsx`: the breakdown-mode category-remove trash now opens a `<ConfirmDialog>`
   ("Remove *{category}*? This removes it and its N cause(s) / M line item(s). It stays as a
   Restore-able row until this budget is finalized."), reusing the existing ConfirmDialog pattern;
   the lump-sum remove stays immediate. The Flow-6 e2e test (`e2e/budgeting-restructure.spec.ts`) was
   flipped to assert the dialog appears and is confirmed. Typecheck + 713 unit tests + `build:only`
   all green. **This closes the last open note — B-29 is now effectively SHIP IT.**
2. **B-35 (cause-line label-loss race)** — already logged in `docs/backlog.md`, no action needed
   here beyond confirming it's tracked (it is). Recommend scheduling it soon since it's a real
   data-loss bug a treasurer could hit typing at normal speed on a slow connection, not because
   this feature is responsible for it.
3. **`pnpm lint` environment failure** — recommend deployment-engineer pick this up in the next
   30-day dependencies review rather than letting it get re-flagged a fourth time with no owner.
4. **Star & Notes handoff** (already noted by every prior phase, repeating once more since this is
   the last checkpoint before that work resumes): whoever picks up
   `docs/work-log/2026-07-28-budget-star-notes.md` must re-confirm its Phase 1 flow descriptions
   against the new row/section shape (cause-group headers are now a distinct row grain) before
   writing any code.

## Red Flags (if NEEDS REWORK)

None. No functional flow is broken, no permission gate is missing, no brand-consistency violation
was found, and the one open item (Flow 6's confirm-dialog divergence) has a safety net already in
place (persistent Restore-until-finalize) — it's a conscious UX tradeoff awaiting the user's final
word, not a defect.

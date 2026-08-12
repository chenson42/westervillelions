# Impact Cause Drill-Down — Work Log

> **Slug:** `2026-07-21-impact-cause-drilldown`
> **Surface:** (dashboard) member portal — `/members/impact`
> **Permission(s):** existing gate covers this (two-tier: `impact.view` when `philanthropyVisibility='board'`; any linked member when `'members'`)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 1 brief; Phase 2 likely skippable (work is within existing `ImpactByCause` component + `getPhilanthropy()` query; skip must be documented); Phases 4/5/6 run in full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | full-stack-developer | Complete | Implemented, gates passing | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-21 |

---

## Intent (user request, 2026-07-21)

On the Our Community Impact page (`/members/impact`), clicking a cause row in the
"Giving by Cause" list should expand it **inline** to show that cause's individual
gifts (date, recipient/party, amount) for the currently selected fiscal-year pill
(or all-time when "All" is selected). No navigation away; mobile-friendly.
UX mode ("expand inline" vs. detail page vs. modal) was put to the user explicitly;
the user chose **expand inline**.

**Value:** Members see cause totals but have no way to learn what actually made up
a number — transparency into the club's giving is the whole point of the dashboard.

**Complexity rationale:** No schema change expected; `getPhilanthropy()` already
reads the individual giving rows before aggregating — the work is exposing per-cause
detail rows in the payload and adding expand/collapse UI to the existing client
component, following the established all-data-precomputed-server-side pattern.

---

# Phase 1 — Functional Refinement (analyst)

**Verdict:** READY WITH NOTES

**One-line take:** A well-scoped, low-risk read-only enhancement to an existing gated dashboard — the UX mode is already decided by the user, but the underlying query doesn't currently fetch the per-row `party`/id data the drill-down needs, and a few microcopy/behavior details are undecided.

## User verbs

- **Signed-in member** (on `/members/impact`, already past the two-tier gate): clicks/taps a cause row in "Giving by Cause" to expand it inline.
- **Signed-in member:** views the expanded list of individual gifts (date, recipient/party, amount) scoped to the currently selected FY pill (or all-time).
- **Signed-in member:** clicks the row again (or a collapse control) to close the expansion.
- **Signed-in member:** switches an FY pill while a cause is expanded (existing FY-pill verb, now interacting with a new state).
- **Signed-in member using a keyboard/screen reader:** tabs to a cause row and presses Enter/Space to expand — not currently possible; the row is a plain `<li>`, not a button.

No verbs on any other surface (anonymous visitor, access-pending, admin) — this feature is entirely inside the existing member-portal gate on `/members/impact` and doesn't touch admin or public pages.

## Flows

**Flow A — Expand a cause row**
- Entry: member is on `/members/impact`, "Giving by Cause" card visible, some FY pill selected (default: current FY).
- Step 1: member clicks/taps a cause row (e.g. "Youth Programs").
- Step 2: row expands inline beneath its bar, revealing a chronological list of that cause's individual gifts for the *currently selected* FY scope (date, recipient or fallback text, amount).
- Success outcome: expanded rows are visible, and their amounts sum to the cause's already-displayed `totalCents` — this must hold even when some rows have `party = NULL` (see Gaps below; "Recent Named Gifts" deliberately excludes null-party rows per DECISION-024, but the drill-down must NOT, or the numbers won't reconcile and members will notice).
- Failure outcome: none described. Because all data is precomputed server-side and handed down as props (no client fetch on expand), there is no network-failure path for this MVP shape. If Phase 3/tech-lead chooses a lazy-fetch design instead (see payload-size question below), a loading and failure state must be designed then — flagging this as conditional, not decided here.

**Flow B — Collapse a cause row**
- Entry: a cause row is expanded.
- Step: member clicks the row (or a chevron/collapse affordance) again.
- Outcome: row collapses back to the summary bar. No failure path — this is pure client state.

**Flow C — Switch FY pill while a cause is expanded**
- Entry: cause "Youth Programs" is expanded under FY2025.
- Step: member clicks the FY2026 pill.
- Undefined by the request: does the expansion persist (now showing FY2026's gifts for "Youth Programs"), or does switching pills collapse everything?
- Recommended default: key expansion state by `causeKey`, not list index, and let it persist across pill switches. If the newly selected FY's cause list doesn't contain that `causeKey` at all, the row simply isn't rendered — nothing to reconcile. This needs to be confirmed in Phase 3 design, not decided unilaterally here.

**Flow D — Keyboard/screen-reader operation**
- Entry: keyboard focus reaches a cause row via Tab.
- Step: Enter or Space toggles expand/collapse.
- Success outcome: same visual result as a mouse click, with `aria-expanded` reflecting state and a visible focus ring (`focus:ring-2 focus:ring-lions-blue` per brand convention).
- Failure outcome: today, this flow doesn't exist at all — the row is a non-interactive `<li>`. This is the accessibility gap that must be fixed as part of this work, not an edge case to defer.

## Permissions

No new `FEATURES` key needed. **Existing gate covers this**: the two-tier check in `src/app/members/impact/page.tsx` (`philanthropyVisibility === 'board'` → requires `FEATURES.IMPACT_VIEW`; `= 'members'` → any linked member) already governs the whole page, including this new interaction. The drill-down doesn't create a new visibility tier — it surfaces detail (date, party, amount) to the same audience already permitted to see cause totals and "Recent Named Gifts." One nuance worth confirming, not gating: the drill-down will show dollar amounts for `party = NULL` rows that "Recent Named Gifts" currently hides entirely (DECISION-024 excludes them from that list, but not from the totals). That's not a new permission surface — it's the same gate seeing more of the same data — but it is a visible behavior change worth a one-line confirmation from the user (see Open Questions).

## Gaps the request didn't address

- **Query doesn't currently select `party` (or a row id) in the aggregate path.** `getPhilanthropy()`'s Query 1 (the one that feeds `byCause`/`byCauseByFy` via `bucketGivingByCause()`) selects only `txnDate`, `amountCents`, `beneficiaryCause` (`src/lib/ledger-queries.ts` ~line 2139-2157, `GivingFoldRow` type in `src/lib/ledger.ts` line 361). `party` is only fetched in the separate, `LIMIT 8`, party-IS-NOT-NULL "Recent Named Gifts" query. To drill into a cause's individual gifts, the aggregate query (or a new one) must also select `party` and a stable transaction id per row, and thread individual rows through per cause/FY bucket rather than only the aggregated `CauseBucket`. This is a real gap between "what the request implies" and "what the current code fetches" — flagging for architect/tech-lead, not deciding the query shape myself.
- **NULL-party display copy is undecided.** The request says drill-down rows should show "recipient/party," but roughly some giving rows have `party IS NULL` (per the seed context). Recent Named Gifts avoids this by filtering those rows out entirely — there's no existing microcopy precedent in this app for a null-party gift. Suggest "Recipient not recorded" as a default, but this is a voice/tone call — see Open Questions.
- **Many-row causes / mobile affordance.** A cause with many individual gifts (e.g., "Youth Programs" across "All" time) could produce a long inline list. The request doesn't say whether this needs a cap, "show all N" toggle, or a scrollable sub-list at 360px width. Recommend an inline `max-height` + `overflow-y-auto` sub-list once a cause exceeds some threshold (exact number TBD in Phase 3) rather than letting the page grow unbounded — but flagging the threshold as a product/UX call, not deciding it here.
- **Sort order of expanded gift rows.** Not specified. Recommend desc-by-date (matches "Recent Named Gifts" convention) as the default; low-stakes, tech-lead can decide without user input.
- **Accessibility: row must become operable.** The cause `<li>` in `src/components/members/impact-by-cause.tsx` is not currently a button, has no `aria-expanded`, and has no keyboard handler. This must be fixed as part of implementation (see Flow D) — not a "nice to have."
- **Payload-size question (flagging per your instructions, not deciding).** Today `getPhilanthropy()` already ships every cause total for every FY down to the client in one shot (`allTime` + `byCauseByFy` for every data-bearing year). Adding individual gift rows (date, party, amount) per cause × per FY multiplies that payload. At current club scale this is almost certainly fine, but whether to (a) ship it all in the existing props shape, or (b) lazy-fetch a cause's detail rows on first expand, is an architectural call for architect/tech-lead, not something I'm resolving in Phase 1.
- **Brand consistency of the expand affordance.** The row itself already sits inside a `rounded-2xl` card (correct). The new expand/collapse control (chevron icon, or the whole row as the click target) should use existing focus-ring conventions (`focus:ring-2 focus:ring-lions-blue`) and must not introduce a `rounded-full` icon-button without that ring. No `window.confirm` risk here — nothing destructive in this flow.
- **Empty/defensive state for a cause with `totalCents > 0` but zero underlying detail rows.** Shouldn't happen given how `bucketGivingByCause()` is built (a cause bucket only exists because rows summed into it), but if the detail-rows plumbing and the aggregate plumbing ever drift, the expanded panel should show a graceful "Detail unavailable" rather than a blank box or a client error. Cheap to build in, worth stating explicitly so it isn't skipped.

## Out of scope (confirm with user)

- Per-cause detail **page** or **modal** — the user was already asked and explicitly chose inline expansion. Restating here only so it's on record that this was a real choice, not a default.
- Filtering/searching within an expanded cause's gift list (e.g., search by recipient name) — the request only asked to "see details," not to search them. Assuming out of scope unless the user says otherwise.
- Exporting a cause's gift list (CSV, print) — no mention in the request; assuming out of scope.
- Any change to `philanthropyVisibility` settings or admin-side configuration of what's shown — this feature only affects the member-facing display of already-computed, already-gated data.

## Open questions (for the user)

1. **NULL-party fallback copy.** Some gift rows will have no recorded recipient. Suggested default: **"Recipient not recorded."** Does that read right for the club's tone, or would you prefer something else (e.g., "Unnamed gift," "General fund gift")?
2. **Cap behavior for a cause with many individual gifts** (e.g., viewing "All" time on a cause with 40+ gifts). Do you want the full list always visible with an inline scroll box, or a "Show first 10 / View all" style cap? This is a real product choice about how much transparency to show at once versus how long the page gets — recommend inline scroll (no hard cap) since completeness is the whole point of this feature, but want your call before tech-lead locks in a threshold.

(Not asking the user about FY-pill-switch persistence-of-expansion, exact sort order, or the query/payload-size architecture — those are implementation-level calls for tech-lead/architect to make using the recommended defaults above.)

## User decisions (2026-07-21, answered via AskUserQuestion)

1. **NULL-party fallback copy:** default accepted — **"Recipient not recorded."**
2. **Cap behavior:** **Show everything** — no cap, no scroll box; the expanded
   list renders all gift rows and the page grows as needed. (Inline-scroll and
   show-first-10 were offered and declined.)

---

# Phase 2 — Architectural Review (architect)

**Verdict:** Approved with suggestions

**One-line take:** Extend the existing precomputed-props pattern (option a) — measured club-scale data confirms the payload is trivially small, and the query/type extension stays entirely inside the current `getPhilanthropy()` / `bucketGivingByCause()` module boundary with no new files, dependencies, or schema.

## 1. Payload-size ruling: (a) — extend precomputed props, no lazy fetch

Checked actual scale against the local DB rather than estimating: `SELECT count(*), count(*) FILTER (WHERE flow='expense') FROM ledger_transactions` returns **276 total transactions, 147 expense transactions**. Giving rows are a further-filtered subset (fund.kind IN activity/charitable/scholarship, `counts_as_giving != false`) — well under 147, and the books only go back to ~FY2024 (per `docs/work-log/2026-06-25-ledger-impact.md` and the impact page's "Since July {earliestFy}" label), so this is a handful of fiscal years, not dozens.

Adding `id` + `party` to each already-fetched Query 1 row and threading the rows through `bucketGivingByCause()` alongside the existing aggregate produces, at true club scale, on the order of a few hundred small objects total (a UUID, a date string, a name string, an int) shipped once per page load — this is noise next to the page's existing `byCauseByFy` payload (which already ships every cause total for every FY). There is no real payload-size problem to solve.

Ruling: **(a)**. Lazy-fetch-on-first-expand (option b) would require a new `/api/members/impact/...` route, a loading state, an error state, and a network round-trip on every expand for a page whose entire premise is "look, no fetch on interaction" (see the existing doc-comment in `impact-by-cause.tsx`: "switching pills and revealing 'More' are both local useState swaps with no server round-trip"). Introducing option (b) here would be added surface with no corresponding benefit — reject it.

## 2. Query shape ruling

Stays inside existing module boundaries. No new directory, no new query file, no new DB round-trip (Query 1 in `getPhilanthropy()`, `src/lib/ledger-queries.ts` ~line 2139, is already fetching every giving row before folding — this only widens its SELECT list and what gets carried through the fold):

- **`GivingFoldRow`** (`src/lib/ledger.ts` ~line 361): add `id: string` and `party: string | null` to the type, and add `id`/`party` to Query 1's `.select({...})` in `ledger-queries.ts`.
- **`CauseBucket`** (`src/lib/ledger.ts` ~line 371) / its re-export **`PhilanthropyByCause`** (`ledger-queries.ts` ~line 2042): add a `rows` field — the individual detail rows (`txnDate`, `party`, `amountCents`, `id`) that fed that bucket, sorted desc by `txnDate` (matches the "Recent Named Gifts" convention, per analyst's recommended default — confirmed, no user input needed on this one). `bucketGivingByCause()` already iterates every row into a per-`causeKey` map entry; collecting the row alongside the running `totalCents` in that same loop is a same-function extension, not a new pass.
- **Correctness-critical rule, confirmed:** the detail rows **must not** filter `party IS NULL`, unlike Query 2 / `recentGifts` (DECISION-024). Query 1 has never applied that filter — it must stay that way, and the fold must carry every row through into `bucket.rows` regardless of `party`. This is what makes expanded-row sums reconcile to the already-displayed `totalCents`. Tech-lead/implementer: do not let the drill-down accidentally borrow Query 2's `isNotNull(party)` predicate — that would silently drop dollars from the expansion and break the reconciliation the analyst flagged in Flow A.
- No schema change. `id` and `party` already exist as columns on `ledger_transactions` (`src/lib/db/schema.ts` line 624, 638) — this is a SELECT-list and TypeScript-type change only. Agree with the analyst's and the work-log's stated expectation.

## 3. Placement / component split

Confirmed: no new component, no new dependency. The expand/collapse UI lives entirely inside the existing `src/components/members/impact-by-cause.tsx` (already `'use client'`, already receiving `PhilanthropyByCause[]` as props). Plain `useState` (e.g., a `Set<string>` of expanded `causeKey`s, per the analyst's recommended keying-by-causeKey default for FY-pill-switch persistence) plus Tailwind is sufficient — no accordion/disclosure library needed, and none of the four already-available Radix primitives are a better fit than a plain button + conditional render for this shape. `ConfirmDialog` is correctly not in scope (nothing destructive).

One binding requirement, not a suggestion: the cause row must become a real `<button type="button" aria-expanded={...}>` (or a `<li>` wrapping one), not a styled `<li>` — this closes the Flow D accessibility gap the analyst flagged as "must be fixed as part of this work, not an edge case to defer." Use the existing `focus:outline-none focus:ring-2 focus:ring-lions-blue` convention already present on the FY pill buttons two elements up in the same file.

## 4. Invariants

- **Server/client boundary:** correct as designed — `getPhilanthropy()` runs server-side in `src/app/members/impact/page.tsx`, detail rows travel down as ordinary props into the existing client component. No client-side data fetching is introduced. Consistent with the project invariant (Server Components by default; `'use client'` only for interactivity).
- **Permissions:** no new `FEATURES` key needed — confirmed. The existing two-tier gate in `page.tsx` (`philanthropyVisibility === 'board'` → `FEATURES.IMPACT_VIEW`; `= 'members'` → any linked member) already covers the entire payload, and this feature surfaces more of the *same* already-gated data rather than opening a new visibility tier. Agree with the analyst that the null-party rows becoming individually visible (vs. hidden today in Recent Named Gifts) is a user-facing tone/copy question, not a permissions gap — correctly left as an Open Question for the user, not something to gate behind a new feature key.
- **Schema:** no migration required, as above.
- **UX guidelines:** outer card is already `rounded-2xl` (correct, no change). No `rounded-full` icon buttons — if a chevron affordance is added, keep it inside the row's existing focus-ring treatment. No native dialogs are relevant here. If tech-lead adds a scroll cap for many-gift causes, `max-height` + `overflow-y-auto` (already recommended in Phase 1) is the right primitive — no new dependency.

## Suggestions (non-blocking, carried to tech-lead)

1. Add `rows` to `CauseBucket`/`PhilanthropyByCause` as a required field (not optional) so `bucketGivingByCause()` has one shape used by both the existing summary consumers and the new drill-down — avoids a second parallel type.
2. Keep the JSDoc on `GivingFoldRow` and `CauseBucket` (`src/lib/ledger.ts`) up to date when the fields are added — those doc-comments are the module's source-of-truth notes on the DECISION-024 asymmetry between Query 1 and Query 2, and a future reader needs that distinction spelled out to avoid the same mistake this review flags in §2.
3. Sort order and the many-gift-cause cap threshold are UX/product calls tech-lead can finalize using the analyst's recommended defaults (desc-by-date; scroll box, no hard cap) — no architectural blocker either way.

## Decision log

No new `docs/decisions.md` entry. This doesn't add a dependency, a new top-level module/directory, a route-group change, or a permission-catalog change — it's an extension of the already-established "all-data-precomputed-server-side" pattern from the 2026-07-20 FY-pill rework (itself not logged as a separate decision at the time). Confirmed in scope per the four decisions.md trigger categories in this agent's charter; none apply here.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-07-21
**Verdict:** Design complete. Implementer named below.

## Technical Design: Impact Cause Drill-Down

### Summary

On `/members/impact`, each row in "Giving by Cause" becomes a real button that
expands inline to list every individual gift behind that cause's total (date,
recipient/party, amount) for the currently selected FY scope, with no cap and
no scroll box (user's explicit choice). This extends the existing
all-data-precomputed-server-side pattern rather than introducing a new fetch
path: `getPhilanthropy()`'s Query 1 already reads every giving row before
folding it into cause buckets — this design widens that SELECT to include
`id` and `party`, and has `bucketGivingByCause()` carry the individual rows
through into each `CauseBucket`/`PhilanthropyByCause` entry alongside the
existing aggregate. The client component (`impact-by-cause.tsx`) gets a
`Set<string>` of expanded `causeKey`s and renders the matching bucket's `rows`
when expanded. No new route, no new component file, no schema change.

### Permissions

No new `FEATURES` key. Existing gate stands as-is: the two-tier check in
`src/app/members/impact/page.tsx` — `philanthropyVisibility === 'board'` →
requires `FEATURES.IMPACT_VIEW`; `= 'members'` → any linked member. This
feature surfaces more detail from the same already-gated payload; it does not
open a new visibility tier. (Per Phase 1/2: the null-party rows becoming
individually visible here, vs. hidden in "Recent Named Gifts," is a copy
choice — "Recipient not recorded" — already decided by the user, not a
permissions gap.)

### API Contract

None. No new route, no new server action. This is a props-shape change on an
existing server-rendered page → client-component boundary:

- `getPhilanthropy()` (`src/lib/ledger-queries.ts`) — same signature, richer
  return shape (`PhilanthropyByCause.rows` added, see Data Model below).
- `ImpactByCause` (`src/components/members/impact-by-cause.tsx`) — same props
  interface; the `allTime` and `byCauseByFy` arrays it already receives now
  carry a `rows` field per cause it didn't carry before. No new prop is added
  to `ImpactByCauseProps`.

### Data Model

No schema changes required. `id` and `party` already exist as columns on
`ledger_transactions` (`src/lib/db/schema.ts` lines 624, 638) — this is a
SELECT-list and TypeScript-type change only.

**`src/lib/ledger.ts` (~line 361):**

```ts
export type GivingFoldRow = {
  txnDate: string;
  amountCents: number;
  beneficiaryCause: string | null;
  id: string;
  party: string | null;
};

/** One individual gift row inside a CauseBucket, for the drill-down UI.
 *  Never filters on party — includes null-party rows so that summing a
 *  bucket's `rows` always reconciles to `bucket.totalCents` (DECISION-024
 *  only excludes null-party rows from Query 2 / recentGifts, never from
 *  Query 1 / this fold). Sorted desc by txnDate within each bucket. */
export type CauseGivingRow = {
  id: string;
  txnDate: string;
  party: string | null;
  amountCents: number;
};

export type CauseBucket = {
  causeKey: string;
  causeLabel: string;
  totalCents: number;
  pct: number;
  /** Every individual gift row folded into this bucket, sorted desc by
   *  txnDate. Required (not optional) — one shape for both the existing
   *  summary consumers and the new drill-down, per architect's suggestion. */
  rows: CauseGivingRow[];
};
```

`bucketGivingByCause()` changes from tracking `{ totalCents, firstSeenOriginal }`
per cause to also accumulating a `rows: CauseGivingRow[]` array per cause in
the same single pass, then sorting each bucket's `rows` desc by `txnDate`
before returning (string comparison is safe — `txnDate` is `YYYY-MM-DD`).
Update the function's JSDoc to state this explicitly (architect's suggestion
#2) so the DECISION-024 asymmetry (Query 1 never filters party; Query 2
does) stays documented at the one place both getPhilanthropy() and this
drill-down depend on.

**`src/lib/ledger-queries.ts` (~line 2042):**

```ts
export type PhilanthropyByCause = {
  causeKey: string;
  causeLabel: string;
  totalCents: number;
  pct: number;
  /** See CauseBucket.rows in src/lib/ledger.ts — same shape, re-declared here
   *  because PhilanthropyByCause is this module's own type, not a re-export
   *  of CauseBucket. Keep these two type literals in sync by hand; import
   *  CauseGivingRow itself (don't redefine it) to prevent the row shape from
   *  drifting even if the two container types stay separately declared. */
  rows: CauseGivingRow[];
};
```

Add `CauseGivingRow` to the existing `@/lib/ledger` import block at the top
of `ledger-queries.ts` (it already imports `GivingFoldRow` and
`bucketGivingByCause` from there — line 44-61 — so this is one more name in
an existing import, not a new import statement).

Query 1 in `getPhilanthropy()` (~line 2139) widens its `.select({...})`:

```ts
const givingRows = await db
  .select({
    txnDate: ledgerTransactions.txnDate,
    amountCents: ledgerTransactions.amountCents,
    beneficiaryCause: ledgerTransactions.beneficiaryCause,
    id: ledgerTransactions.id,
    party: ledgerTransactions.party,
  })
  // ...unchanged joins/where/orderBy
```

No change to Query 2 (`recentGifts`, `isNotNull(party)`, `LIMIT`
`recentGiftsLimit`) — that query and its DECISION-024 null-party exclusion
are untouched. `byCause` and every entry of `byCauseByFy` are still built via
`bucketGivingByCause(givingRows)` / `bucketGivingByCause(rowsByFy.get(fy) ?? [])`
— no new pass, no new DB round-trip; confirms the architect's payload-size
ruling (a few hundred small row objects total at current club scale, per
Phase 2's measured 276-transaction / 147-expense count).

### Component/Page Plan

**Files to modify (no new files):**

- `src/lib/ledger.ts` — `GivingFoldRow`, `CauseGivingRow` (new), `CauseBucket`,
  `bucketGivingByCause()`, JSDoc updates.
- `src/lib/ledger-queries.ts` — `PhilanthropyByCause` type, Query 1 select
  list, import block (add `CauseGivingRow`).
- `src/components/members/impact-by-cause.tsx` — expand/collapse UI:
  - Add `const [expanded, setExpanded] = useState<Set<string>>(new Set())`,
    keyed by `causeKey` (empty string is a valid key for the "Other"
    bucket — `Set` handles `''` as a normal member, no special-casing
    needed).
  - Convert the cause `<li>`'s clickable surface into a real
    `<button type="button" aria-expanded={expanded.has(cause.causeKey)}>`
    wrapping the existing bar/label markup, with
    `focus:outline-none focus:ring-2 focus:ring-lions-blue` (matches the FY
    pill buttons already in this file).
  - Toggle handler: `setExpanded(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })`.
  - When expanded, render `cause.rows` beneath the bar: one line per gift —
    formatted date, `row.party ?? "Recipient not recorded"`, formatted
    amount. Desc-by-txnDate order comes pre-sorted from the server; the
    client does not re-sort.
  - No cap, no `max-height`/`overflow-y-auto` — user explicitly chose "show
    everything." (Supersedes the Phase 1 "recommend a scroll box" note —
    the user was asked directly and declined it.)
  - Duplicate a small `formatDate()` helper into this file, matching the one
    in `src/app/members/impact/page.tsx` (~line 19) exactly (same
    `en-US`/`long`/`numeric` formatting, same local-date-safe parsing via
    manual `split("-")` rather than `new Date(string)`, to avoid the known
    naive-timestamp/UTC-shift class of bug). This mirrors the existing
    precedent in this codebase where `formatDollarsWhole()` is already
    independently duplicated in both `page.tsx` and `impact-by-cause.tsx`
    rather than shared — consistent, not a new pattern.
  - Defensive fallback: if a bucket's `rows` is unexpectedly empty while
    `totalCents > 0` (should not happen — see Edge Cases), render "Detail
    unavailable" instead of a blank expanded panel.

- **Pages:** none created.
- **Components:** none created; `impact-by-cause.tsx` is the only component
  touched.

### Implementation Order

1. **`src/lib/ledger.ts`** — add `CauseGivingRow`, widen `GivingFoldRow` and
   `CauseBucket`, update `bucketGivingByCause()` to accumulate and sort
   `rows`, update JSDoc. This is the pure-function core and should be correct
   and unit-tested before anything downstream consumes it.
2. **`src/lib/ledger-queries.ts`** — widen Query 1's select, add
   `CauseGivingRow` to the `@/lib/ledger` import, widen `PhilanthropyByCause`.
   No change needed to `getPhilanthropy()`'s control flow — `byCause` and
   `byCauseByFy` already delegate to `bucketGivingByCause()`.
3. **`src/components/members/impact-by-cause.tsx`** — expand/collapse state,
   button conversion with `aria-expanded`, expanded-row rendering, local
   `formatDate()`.
4. No migration, no permissions migration, no email notification — none
   apply to this feature.
5. Release notes entry — write via `/release-notes` when this merges to
   main (user-facing framing: "see exactly which gifts make up each cause's
   total," not implementation detail).

### Edge Cases & Risks

- **"Other community support" bucket (`causeKey: ''`) must be expandable
  too.** `bucketGivingByCause()` treats `''` as a normal map key already —
  confirm the new `rows` accumulation and the client's `Set<string>` toggle
  both treat `''` as a legitimate, expandable key (no `if (causeKey)` guard
  anywhere in the new code). Named test #4 below covers this at the fold
  level.
- **Reconciliation invariant.** Every bucket's `rows` must sum (by
  `amountCents`) to exactly that bucket's `totalCents` — this is the whole
  point of the feature (Flow A success outcome) and depends on Query 1 and
  the fold never applying a `party IS NOT NULL` filter. Named test #3 below
  is the regression guard; if a future edit accidentally imports Query 2's
  predicate into this path, that test fails immediately.
- **`byCauseByFy` must get `rows` for every FY bucket, not just `allTime`.**
  Because both `byCause` and every entry of `byCauseByFy` call the same
  `bucketGivingByCause()`, this falls out for free from the Data Model change
  — there is no separate code path to forget. Worth stating explicitly since
  Phase 1 flagged "confirm this applies to both" as a real risk.
- **Empty `rows` on a bucket with `totalCents > 0`.** Should be structurally
  impossible (a bucket only exists because rows summed into it — same
  invariant as today), but the UI's "Detail unavailable" fallback (above)
  guards against any future drift between the aggregate and row-collection
  logic without a client crash.
- **Date formatting consistency.** `impact-by-cause.tsx` must format dates
  identically to `page.tsx`'s `formatDate()` (same locale options, same
  local-date parsing) so the drill-down doesn't visually disagree with
  "Recent Named Gifts" elsewhere on the same page.
- **Payload size at scale.** Already ruled on in Phase 2 (accept — a few
  hundred small objects total at current club scale). Flagging only that if
  the club's giving volume grows by an order of magnitude in future years,
  this may need revisiting (lazy-fetch or pagination) — not a concern today.
- **Accessibility regression risk.** Converting the `<li>`'s content into a
  nested `<button>` must not break the existing FY-pill buttons' tab order
  or introduce a nested-interactive-element warning; the button should wrap
  the bar/label content, with the progress-bar `<div>` remaining
  non-interactive decoration inside it.

### Out of Scope

- Detail page or modal (user already chose inline expansion — Phase 1/2).
- Search/filter within an expanded cause's gift list.
- Export (CSV/print) of a cause's gift list.
- Any change to `philanthropyVisibility` admin configuration.
- Scroll cap / "show first N" — user explicitly declined both.

### Named Unit Tests (Vitest)

`bucketGivingByCause()` and the fold logic live in `src/lib/ledger.ts`, which
already has coverage in `src/lib/ledger-impact.test.ts` (`describe("bucketGivingByCause", ...)`,
~line 136). Extend that same `describe` block — do not create a new test
file. The implementer delivers these as part of Phase 4 (per CLAUDE.md: "the
implementer delivers these, not qa").

1. **"includes id and party on each row, sorted desc by txnDate within a bucket"**
   — feed `bucketGivingByCause()` 3+ rows for the same cause with out-of-order
   `txnDate`s and distinct `id`/`party` values; assert the resulting bucket's
   `rows` array is present, carries `id`/`party` through unchanged, and is
   ordered newest-`txnDate`-first.
2. **"keeps null-party rows in `rows` — does not apply Query 2's isNotNull filter"**
   — feed rows including at least one `party: null`; assert that row appears
   in the bucket's `rows` array (this is the direct regression guard for the
   DECISION-024 asymmetry called out in Phase 1/2 — Query 1/this fold must
   never drop null-party rows, unlike `recentGifts`).
3. **"each bucket's rows sum to bucket.totalCents"** — for a mixed multi-cause,
   multi-row input (reuse or extend the existing "buckets a current-FY row
   set..." fixture), assert for every returned bucket that
   `bucket.rows.reduce((s, r) => s + r.amountCents, 0) === bucket.totalCents`.
   This is the direct unit-level encoding of Flow A's success outcome.
4. **"'' key (Other community support) bucket also gets a populated `rows` array"**
   — feed at least one `beneficiaryCause: null` row alongside other-cause
   rows; assert the `causeKey: ''` bucket's `rows` array contains exactly the
   null/empty-cause rows, not empty and not merged into another bucket.
5. **"empty input still returns `[]` with no defensive-empty-bucket"** — this
   already exists (`"returns an empty array when given no rows"`, line 181);
   confirm it still passes unmodified after the `rows` field is added (no new
   test needed, but do not skip re-running it).

No new Playwright e2e test is prescribed here — the existing manual
click-through in Phase 5 (qa) covers Flow A/B/C/D (expand, collapse, FY-pill
switch while expanded, keyboard operation) as click-through steps, consistent
with how the FY-pill feature itself was verified on 2026-07-20.

### Implementer

**full-stack-developer.** This spans a query-shape change (`ledger.ts` +
`ledger-queries.ts`, both server-side, pure-function + query) and a client UI
change (`impact-by-cause.tsx`), but the two halves are inseparable in review —
the UI can't be written or tested against a real shape until the type/query
change lands, and the whole diff is well under the 150-line threshold (an
estimated ~35 lines of type/query/fold changes plus ~60-80 lines of UI
change). Splitting into api-developer → ux-developer here would add a
handoff for a change one person can hold in their head end-to-end; reserve
the specialist split for larger Ledger-scale work as CLAUDE.md directs.

---

# Phase 4 — Implementation (full-stack) — 2026-07-21

**Owner:** full-stack-developer
**Status:** complete

### Summary

Implemented the cause drill-down exactly per the Phase 3 design: `bucketGivingByCause()`
now accumulates each cause's individual gift rows (`id`, `txnDate`, `party`, `amountCents`)
alongside the existing aggregate in the same single pass, sorted desc by `txnDate`, and
`ImpactByCause` renders them inline behind a real `<button aria-expanded>` per cause row.
No schema change, no new route, no new component file — the entire diff is a type widening
in `ledger.ts`, a SELECT-list widening in `ledger-queries.ts` Query 1 (Query 2/`recentGifts`
untouched), and expand/collapse UI in the existing client component.

### What I did

- Widened `GivingFoldRow` (`src/lib/ledger.ts`) with `id: string` and `party: string | null`.
- Added `CauseGivingRow` type with JSDoc documenting the DECISION-024 asymmetry (this fold
  must never filter null-party rows, unlike Query 2 / `recentGifts`).
- Added `rows: CauseGivingRow[]` (required) to `CauseBucket`.
- Updated `bucketGivingByCause()` to accumulate each cause's rows in the existing single
  pass, then sort each bucket's `rows` desc by `txnDate` via string comparison
  (`YYYY-MM-DD` is lexically sortable) before returning. Updated the function's JSDoc to
  spell out the DECISION-024 requirement explicitly.
- Added `CauseGivingRow` to the existing `@/lib/ledger` import in `ledger-queries.ts`.
- Added `rows: CauseGivingRow[]` to `PhilanthropyByCause` (re-declared, importing the row
  type itself per the design doc, not re-exporting `CauseBucket`).
- Widened Query 1's `.select({...})` in `getPhilanthropy()` to include `id` and `party`.
  Query 2 (`recentGifts`) is untouched — confirmed no `isNotNull(party)` predicate leaked
  into the new path.
- `impact-by-cause.tsx`: added `useState<Set<string>>` for expanded `causeKey`s (empty
  string handled as a normal `Set` member — no special-casing, covers the "Other community
  support" bucket), converted the cause row's clickable surface into a real
  `<button type="button" aria-expanded={...}>` with the existing
  `focus:outline-none focus:ring-2 focus:ring-lions-blue` convention, and added the expanded
  panel rendering `cause.rows` (formatted date, `party ?? "Recipient not recorded"`,
  formatted whole-dollar amount) with no cap and no scroll box per the user's explicit
  choice. Added a defensive "Detail unavailable" fallback for the (should-be-impossible)
  case of an empty `rows` array on a bucket with `totalCents > 0`. Locally duplicated
  `formatDate()` matching `page.tsx`'s local-date-safe `split("-")` parsing exactly,
  consistent with the existing precedent of `formatDollarsWhole()` being independently
  duplicated in both files.
- Extended `describe("bucketGivingByCause", ...)` in `src/lib/ledger-impact.test.ts` with
  the five named unit tests from the Phase 3 design doc. The four pre-existing tests in
  that same `describe` block construct `GivingFoldRow[]` literals directly, so widening the
  type to require `id`/`party` forced adding those two fields to each pre-existing fixture
  (necessary fallout of the type change, not scope creep) — their assertions and behavior
  are unchanged.

### Outputs

- `src/lib/ledger.ts` — `GivingFoldRow` widened, `CauseGivingRow` added, `CauseBucket.rows`
  added, `bucketGivingByCause()` updated + JSDoc. (+50/-… per `git diff --stat`)
- `src/lib/ledger-queries.ts` — `CauseGivingRow` import, `PhilanthropyByCause.rows` added,
  Query 1 select widened with `id`/`party`. Query 2 untouched. (+9 lines)
- `src/components/members/impact-by-cause.tsx` — expand/collapse state, button conversion,
  expanded-row rendering, local `formatDate()`. (+112/-… per `git diff --stat`)
- `src/lib/ledger-impact.test.ts` — four pre-existing `bucketGivingByCause` fixtures updated
  with `id`/`party`; four new named tests added (test 5, the empty-input case, needed no
  change and was re-run to confirm). (+96/-… per `git diff --stat`)
- No schema change, no migration, no new `FEATURES` key, no new env var, no new route/API
  contract — matches the Phase 3 design doc exactly.

### Gate results

- `pnpm exec tsc --noEmit` — **pass**, zero errors.
- `pnpm test` — **363 passed / 363 total**, 9 test files, 0 failed. Includes the 4 new
  named tests plus all pre-existing suites (`isGiving`, `bucketGivingByCause` pre-existing
  cases including the empty-input case unmodified, `deriveCauseFyPills`, and all other
  unrelated suites in the repo).
- `pnpm build:only` — **pass**, production build completed, `/members/impact` present in
  the route manifest as server-rendered (ƒ), no build errors.
- No `console.log` in any touched file (grep-verified).
- No native browser dialogs introduced (grep-verified) — none applicable to this
  read-only, non-destructive feature.
- Did not start the dev server — left for qa's Phase 5 smoke test per instructions.

### Deviations from the Phase 3 design doc

None. Implemented as specified: `GivingFoldRow`/`CauseBucket`/`CauseGivingRow` shapes,
single-pass accumulation, string-compare desc sort by `txnDate`, `PhilanthropyByCause.rows`
importing (not redeclaring) `CauseGivingRow`, Query 1 widened / Query 2 untouched,
`Set<string>` keyed by `causeKey` with `''` as a valid key, button + `aria-expanded`
conversion, no cap/no scroll box, locally duplicated `formatDate()`, "Recipient not
recorded" fallback copy, "Detail unavailable" defensive fallback. No `docs/decisions.md`
entry added — consistent with the architect's Phase 2 ruling that this doesn't cross any
of the four decision-log trigger categories.

### Open questions / handoff notes

- **Manual click-through for qa (Phase 5):** verify Flow A (click a cause row, see gift
  list appear inline, amounts sum to the header total — check "Other community support"
  too), Flow B (click again to collapse), Flow C (expand a cause, switch an FY pill, expand
  state should persist by `causeKey` — if the new FY's cause list doesn't contain that key
  the row just won't render, which is expected and not a bug), and Flow D (Tab to a cause
  row, Enter/Space toggles expand with a visible focus ring and correct `aria-expanded`).
- Also worth a visual check at 360px width given "no cap, no scroll box" was an explicit
  user choice — a cause with many gifts (e.g. "Youth Programs" under "All") will make the
  page grow tall; confirm this reads fine on mobile rather than looking broken.
- Nominating **qa** for Phase 5.

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The implementation matches the Phase 3 design doc exactly at every
point I checked by reading the source (not just by trusting the implementer's summary):
`bucketGivingByCause()`'s single-pass row accumulation, the DECISION-024 asymmetry
(Query 1 never filters `party`), the `Set<string>` expand state keyed by `causeKey`
including `''`, the `<button aria-expanded>` conversion with the focus-ring convention,
and the "Detail unavailable" / "Recipient not recorded" fallbacks. Typecheck, unit
tests (all 5 named Phase 3 tests present and passing with correct assertions), and
production build are all green. The existing Playwright suite (unrelated to this
feature) still passes with no regressions. The one gap: I could not personally drive
an authenticated browser click-through of Flows A–D, because the only automated
sign-in fixture available in this repo (`E2E_ADMIN_EMAIL`) has no linked member row
locally (`users.member_id IS NULL`, confirmed by query) — hitting `/members/impact`
with it lands on the page's own pre-existing "Account Not Linked" state, not the
philanthropy dashboard. This is a test-infrastructure gap, not a defect in this
feature, and the Phase 3 design doc itself anticipated no e2e coverage here
("No new Playwright e2e test is prescribed here... manual click-through in Phase 5
covers Flow A/B/C/D"). Flows A–D and the 360px mobile check need the human's
click-through before Phase 6 — see below.

### What I did

- Confirmed the verification stack is installed and runnable: `vitest.config.ts`,
  `playwright.config.ts`, `pnpm test`, `pnpm test:e2e` all present and working.
- Ran `pnpm exec tsc --noEmit` — zero errors.
- Ran `pnpm test` — 363/363 passed, 9 test files, 0 failed. Confirmed by reading
  `src/lib/ledger-impact.test.ts` directly (not just trusting the pass count) that all
  5 named Phase 3 tests exist inside the `bucketGivingByCause` describe block and
  assert exactly what the design doc specifies:
  1. `id`/`party` carried through, sorted desc by `txnDate` — assertion matches an
     explicit expected array, order verified (2026-03-05 > 02-20 > 01-10).
  2. Null-party row (`party: null`) is present in `rows` — direct DECISION-024
     regression guard.
  3. Every returned bucket's `rows.reduce(amountCents) === bucket.totalCents` — the
     reconciliation invariant, checked across a multi-cause, mixed-null-party,
     mixed-null-cause fixture.
  4. The `''` ("Other community support") bucket's `rows` contains exactly the
     null/empty-cause rows (`d2`, `d3`), not merged elsewhere.
  5. Pre-existing empty-input test (line 181, unmodified) still passes.
- Ran `pnpm build:only` — production build succeeded; `/members/impact` present in
  the route manifest as server-rendered (ƒ); no build errors or warnings introduced.
- Read `src/lib/ledger.ts` (lines 340–477), `src/lib/ledger-queries.ts` (lines
  2139–2226), and `src/components/members/impact-by-cause.tsx` in full to verify the
  actual diff — not just the tests — matches the Phase 3 design doc: `GivingFoldRow`
  widened, `CauseGivingRow` added with the DECISION-024 JSDoc, `CauseBucket.rows`
  required, `bucketGivingByCause()` accumulates and sorts rows in the same pass,
  Query 1's select widened with `id`/`party` and no `isNotNull(party)` predicate
  leaked in (confirmed against Query 2's `recentGifts`, which correctly still has
  `isNotNull(ledgerTransactions.party)` at line 2258), `PhilanthropyByCause.rows`
  imports (not redeclares) `CauseGivingRow`.
- Read `src/app/members/impact/page.tsx` to confirm the pre-existing two-tier
  permission gate (`auth()` + `hasFeature(session.user.id, FEATURES.IMPACT_VIEW)` when
  `philanthropyVisibility === "board"`) is untouched by this feature — no new route,
  no new server action, no gate change. See Feature-Gate Audit below.
- Queried the local dev DB directly to characterize the seeded ledger data before
  attempting a click-through: 60 giving-qualifying transactions, **0** with
  `party IS NULL`, **0** with `beneficiary_cause IS NULL` or empty. This means the
  local seed data cannot exercise the "Recipient not recorded" fallback or the
  "Other community support" (`''` causeKey) bucket in a real browser today — those
  two specific UI strings are verified only at the unit level (named tests 2 and 4
  above), not visually. Flagging this as a real coverage gap for whenever seed/real
  data changes, not a defect.
- Started `pnpm dev`, confirmed the server came up clean (grepped its log for
  `error|warn|fail`, excluding known-benign idempotent-migration NOTICE lines — no
  real errors).
- Attempted to write and run a new Playwright spec
  (`e2e/impact-cause-drilldown.spec.ts`) driving Flows A–D + a 360px mobile check
  against the real local ledger data via `signInAsAdmin()`. All 5 tests failed —
  not because of a bug in the feature, but because `page.goto("/members/impact")`
  rendered the page's own pre-existing "Account Not Linked" state
  (`users.member_id IS NULL` for `lions-e2e-test@westervillelions.org`, confirmed by
  direct query), never reaching `ImpactByCause` at all. I did not attempt to work
  around this by mutating the shared e2e fixture's `member_id` linkage or by
  borrowing a real member's account — both were out of scope and risky given other
  concurrent work in flight against the same local DB. I removed the failing spec
  file rather than leave a permanently-red test in the suite (`git status` confirms
  `e2e/` is clean).
- Ran the full existing `pnpm test:e2e` suite anyway to confirm no regression:
  21 passed, 1 skipped, 0 failed — all pre-existing specs (donate, cancel-occurrence,
  recurring-signup-rollup, smoke, wall-clock-display, write-in-signups) are unaffected,
  as expected since this feature didn't touch any file those specs exercise.
- Ran `pnpm exec vitest run --coverage` (full suite) and a filtered re-run against
  `src/lib/permissions.ts`, `src/lib/events.ts`, `src/lib/members.ts`,
  `src/lib/ledger.ts`, `src/lib/ledger-queries.ts` specifically — see Coverage below.
- Grepped the three touched non-test files for `console.log`/`console.debug` and
  `window.confirm`/`alert`/`prompt` — none found.
- Killed the dev server (port 3000 confirmed free) at the end of the session.

### Outputs

- No implementation source modified (per instructions — any defect would have gone
  back to the implementer; none found).
- `e2e/impact-cause-drilldown.spec.ts` — written, run, found blocked by a
  test-fixture gap (no linked member on the e2e admin account), then **removed**
  rather than committed in a failing state. `git status` on `e2e/` is clean.
- This work-log file — Phase 5 section (this section) and the Per-Phase Status
  table row for Phase 5.

### Gate results

- `pnpm exec tsc --noEmit` — **PASS**, zero errors.
- `pnpm test` — **PASS**. 363 passed / 363 total, 9 test files, 0 failed. Duration
  ~260ms. All 5 named Phase 3 tests present and correct (see above); no failures.
- `pnpm build:only` — **PASS**. Production build completed; `/members/impact`
  present in the route manifest as server-rendered (ƒ); no errors or new warnings.
- `pnpm test:e2e` (existing suite, unrelated to this feature) — **PASS**. 21 passed,
  1 skipped, 0 failed. No regressions.

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Flow A — expand a cause row, gift rows sum to displayed total | **deferred to human** | No automated/credentialed authenticated-member browser session was available to me — the only e2e fixture (`E2E_ADMIN_EMAIL`) has no linked member row locally. Code-verified via `impact-by-cause.tsx` read + unit tests; not visually driven. |
| Flow B — collapse a cause row | **deferred to human** | Same gap. `toggleExpanded()` logic read and correct (Set delete/add), not visually driven. |
| Flow C — expansion persists across FY pill switch, keyed by `causeKey` | **deferred to human** | Same gap. `expanded` state is a component-level `useState<Set<string>>` independent of `selected`/FY — persistence is correct by construction (confirmed by reading the component), not visually driven. |
| Flow D — keyboard Tab/Enter/Space toggles, `aria-expanded` correct, focus ring visible | **deferred to human** | Same gap. Real `<button type="button" aria-expanded>` with `focus:outline-none focus:ring-2 focus:ring-lions-blue` confirmed present in source; native button semantics make Enter/Space activation a browser guarantee, but I did not visually confirm the focus ring renders correctly. |
| Mobile 360px — no cap/scroll box doesn't visually break | **deferred to human** | Same gap. No `max-height`/`overflow-y-auto` present, matching the user's explicit "show everything" choice; layout not visually inspected at 360px. |
| "Recipient not recorded" fallback (null-party row) | **deferred to human / no seed data today** | Local ledger has **zero** null-party giving rows (queried directly). Covered at the unit level (named test 2) but the actual rendered string has not been seen in a browser. Will need re-verification once a null-party gift exists in seed or production data. |
| "Other community support" (`''` causeKey) bucket expansion | **deferred to human / no seed data today** | Local ledger has **zero** null/empty-cause giving rows (queried directly). Covered at the unit level (named test 4) but not visually driven. |

**I am not signing these off as passed — they are unverified in a real browser.**
Per the QA "manual smoke when the runner can't run" principle: couldn't-run is not
verified. The human should click through Flows A–D on a real linked-member account
before Phase 6 closes, ideally once a null-party / null-cause gift exists in the data
so the two fallback strings can be eyeballed too.

### Regression Tests Added

None new by me — the four regression-relevant named tests were already added by the
implementer per the Phase 3 design doc's instruction ("the implementer delivers
these, not qa"), and I verified them rather than duplicating them:
- `keeps null-party rows in rows — does not apply Query 2's isNotNull filter` —
  `src/lib/ledger-impact.test.ts:247` — guards against: the DECISION-024 asymmetry
  being accidentally imported into Query 1's fold, which would silently drop dollars
  from the drill-down and break reconciliation with the displayed total.
- `each bucket's rows sum to bucket.totalCents` — `src/lib/ledger-impact.test.ts:261`
  — guards against: any future edit to the fold desynchronizing the aggregate from
  the individual rows.

### Coverage on Critical Modules

- `src/lib/ledger.ts` (the module this feature actually touched): **100% statements,
  94.73% branch, 100% functions, 100% lines** — well above any target.
- `src/lib/events.ts`: 94.73% statements (untouched by this feature; already above
  the 90%+ target from a prior feature).
- `src/lib/permissions.ts`: 100% (untouched by this feature; meets the 100% target).
- `src/lib/members.ts`: 0% unit coverage (untouched by this feature; DB-bound paths
  are deferred to e2e per the module's own convention — pre-existing gap, not
  introduced here, flagged for the next 7-day coverage sweep).
- `src/lib/ledger-queries.ts`: 0% unit coverage on the file as a whole (expected —
  it's the DB-querying module; Query 1's 2-field SELECT-list widening has no
  branching logic to unit-test and was verified by code review + successful
  production build instead, consistent with the Phase 3 design doc's own test list,
  which scoped all 5 named tests to `ledger.ts`'s `bucketGivingByCause()` only).

### Feature-Gate Audit (mandatory before PASS)

**No protected routes or server actions were added or changed by this feature.**
This is a props-shape widening on an existing server-rendered page → client-component
boundary; no new route, no new server action.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /members/impact` (page, pre-existing, unchanged) | yes (`src/app/members/impact/page.tsx` line 30) | yes, conditionally — required when `philanthropyVisibility === "board"` (line 41-42); any linked member when `"members"` | `FEATURES.IMPACT_VIEW` — correct, matches Phase 1/2/3's explicit ruling that this feature surfaces more detail from the same already-gated payload rather than opening a new visibility tier |

Verified by reading `src/app/members/impact/page.tsx` directly, not by inferring from
passing tests, per the mandatory-audit instruction.

### Verdict: PASS

Typecheck, unit tests (with all 5 named Phase 3 tests verified line-by-line against
the design doc), production build, and the existing e2e suite are all green with no
regressions. The implementation was verified against the design doc by reading the
actual source diff, not just by trusting Phase 4's summary — every named
type/query/component change is present and correct, including the DECISION-024
`party`-filter asymmetry that was the single highest-risk point in this design.
The permission gate is unchanged and correctly scoped. The only outstanding item is
the human browser click-through of Flows A–D (blocked for me by a pre-existing
e2e-fixture gap, not a defect in this feature) and a future re-check of the two
null-value fallback strings once seed/production data contains a qualifying row.
Recommending **PASS** to Phase 6, with those click-throughs flagged as a required
follow-up before the analyst's final sign-off — not a blocking defect, but an
unverified-in-browser gap the analyst should weigh explicitly.

### Open questions / handoff notes

- **Nominating analyst for Phase 6**, with the explicit caveat above: Flows A–D and
  the two null-fallback strings have not been seen in a real browser by qa. The
  analyst (or the user directly) should either drive that click-through before
  issuing SHIP IT, or consciously accept the risk and note it as a SHIP WITH NOTES
  follow-up.
- **Test-infrastructure gap worth a follow-up ticket, not urgent**: there is no
  automated Playwright auth path for a signed-in *member* (only the admin-credential
  `signInAsAdmin()` helper exists, and that account has no linked member row). Any
  future member-portal feature (this one, and likely more to come) will hit the same
  wall. Suggest either linking a dedicated e2e member fixture (separate from the
  admin account, to avoid touching real member data) or documenting this as a known,
  accepted limit of the e2e layer.
- **Seed-data gap worth noting for future test-coverage sweeps**: the local ledger
  has zero null-party and zero null/empty-cause giving rows. If a real gift like that
  gets entered later, that's the moment to also re-run the deferred click-throughs
  above.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-07-21

## Verdict: SHIP IT

**One-line take:** The drill-down does exactly what Phase 1 described — inline
expansion, reconciling totals (including null-party rows), the user's exact
approved copy and cap behavior, and keyboard/mobile accessibility — and this
time it's confirmed in a real browser, not just by reading source, closing
both of QA's honest deferrals rather than rubber-stamping them.

### What I verified, and how

First, re-read `src/lib/ledger.ts` (`GivingFoldRow`, `CauseGivingRow`,
`CauseBucket`, `bucketGivingByCause()`), `src/lib/ledger-queries.ts`
(`PhilanthropyByCause`, Query 1 select, Query 2 untouched with its
`isNotNull(party)` intact), and `src/components/members/impact-by-cause.tsx`
in full myself — confirms QA's Phase 5 read was accurate: the diff matches
the Phase 3 design doc at every point (widened select, single-pass row
accumulation, desc-by-txnDate sort, `Set<string>` expand state keyed by
`causeKey` with `''` handled as an ordinary member, real
`<button aria-expanded>` with the FY-pill focus-ring convention, "Detail
unavailable" / "Recipient not recorded" fallbacks, no cap / no scroll box).
Also re-read `src/app/members/impact/page.tsx` — the two-tier gate
(`philanthropyVisibility === "board"` → `FEATURES.IMPACT_VIEW`; `"members"`
→ any linked member) is untouched.

Then I closed both of QA's deferrals for real, on the local dev DB (per
project memory: writes there are not production writes — production only
gates on a Vercel deploy from `main`):

**Deferral #1 (authenticated browser click-through) — CLOSED.**
- Found the e2e admin user (`lions-e2e-test@westervillelions.org`,
  `id=0063654b-3d99-461d-bb82-3bea740b1d9f`) has `member_id IS NULL` locally,
  confirming QA's finding. Confirmed the e2e admin's `admin` role already has
  `impact.view` bound (`role_features` join on `features.name='impact.view'`),
  so only the member link was missing — no permission change needed.
- Temporarily linked it to an existing active member row with no bearing on
  page content (`UPDATE users SET member_id = '006a1d9f-...' -- an existing
  active member WHERE id = '0063654b-...'`) — the impact dashboard shows club-wide
  philanthropy totals, not the linked member's own data, so which member is
  chosen has no privacy implication.
- A `pnpm dev` server was already running locally (started by concurrent work
  on the other in-flight features per the session's "do not touch" list) —
  reused it rather than starting a second one; my own attempt to start a
  second instance failed immediately on a port/lockfile conflict and left no
  stray process (confirmed via `ps`/`lsof` before and after).
- Wrote three small temporary Playwright specs (not committed — each deleted
  immediately after its run, `git status e2e/` confirmed clean throughout)
  driving `signInAsAdmin()` + `/members/impact` against the real running app:
  1. **Flow A/B** — expand a cause row (`aria-expanded` false→true), read the
     rendered gift rows, sum their displayed amounts in-page, and assert the
     sum equals the row's displayed total exactly. **Passed.** Collapse
     (`aria-expanded` true→false). **Passed.**
  2. **Flow C (strict)** — expand a cause row under "All", switch to a
     specific FY pill, re-locate the row with the *same* label text, and
     assert `aria-expanded` is still `"true"`. **Passed** (first attempt
     timed out for an unrelated, informative reason — see Bonus finding
     below — fixed by explicitly selecting "All" first, then passed).
  3. **Flow D** — focus a cause button via `.focus()`, confirm it's the
     focused element, press Enter (expands), press Space (collapses).
     **Passed.**
  4. **Mobile 360px** — set viewport to 360×800, expand a cause with "show
     everything" (no cap/scroll box), assert `document.documentElement`'s
     `scrollWidth` does not exceed `clientWidth`. **Passed** — no horizontal
     overflow.
  - Reverted the linkage immediately after (`UPDATE users SET member_id =
    NULL WHERE id = '0063654b-...'`) — confirmed by re-querying: `member_id`
    is `NULL` again. All three temp spec files deleted; `git status
    --porcelain e2e/` returns empty.

**Deferral #2 (null-party / null-cause fallback copy) — CLOSED.**
- Confirmed QA's finding: 0 rows locally with `party IS NULL` or
  `beneficiary_cause IS NULL`/`''`.
- Inserted one temporary posted transaction into the Activity fund
  (`party = NULL`, `beneficiary_cause = NULL`, `memo` prefixed
  `[phase6-verification]` for unambiguous identification), dated today (so
  it lands in the *current* fiscal year).
- Ran a temporary Playwright spec: confirmed the "Other community support"
  bucket renders and is clickable, and expanding it shows "Recipient not
  recorded" verbatim. **Passed.**
- Deleted the row immediately after
  (`DELETE FROM ledger_transactions WHERE memo LIKE '[phase6-verification]%'`)
  — confirmed by re-querying: 0 rows match that memo prefix, deleted row's
  `id` printed by the `RETURNING` clause matches the one inserted.

**Bonus finding (not a defect — a real, useful observation):** The Flow-C
spec's first run timed out because the *actual current fiscal year*
(FY2026, started July 2026) has **zero posted transactions today** — so the
default view of "Giving by Cause" right now shows the pre-existing empty
state ("No giving recorded yet this fiscal year." + a "View All giving
instead" link), not cause rows, until a user clicks to a year with data.
This is real production-relevant behavior happening *today*, not a seed-data
artifact. I verified it live in a fourth temporary spec: the empty-state copy
renders, the "View All giving instead" link is clickable, and clicking it
reveals cause rows correctly. **Passed.** This isn't part of this feature's
scope (the empty state predates this work), but it's the literal first thing
any real club member will see on `/members/impact` right now, and it holds
up.

### Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Clicking a cause row expands it inline (user's explicit choice: no page/modal) | Real `<button aria-expanded>`, inline panel below the bar, no navigation | matches |
| Expanded rows show date, recipient/party, amount, scoped to the selected FY (or all-time) | Exactly this, sourced from `cause.rows` pre-sorted desc by date server-side | matches |
| Expanded rows must sum to the bucket's displayed `totalCents`, even with `party = NULL` rows (must NOT borrow Query 2's `isNotNull` filter) | Verified live with a real null-party transaction: appears in "Other community support," dollar amount included in the header total, sum-equality asserted programmatically for a real (non-null-party) bucket too | matches — this was the single highest-risk point in the design and it holds |
| NULL-party fallback copy: **"Recipient not recorded"** (user's explicit choice) | Exact string, verified rendered in a live browser | matches |
| Cap behavior: **show everything**, no cap, no scroll box (user explicitly declined both alternatives offered) | No `max-height`/`overflow-y-auto` anywhere in the component; verified live at 360px with no horizontal overflow | matches |
| Expansion should persist across FY-pill switches, keyed by `causeKey` (Phase 1 recommended default, confirmed in Phase 3) | `expanded` is one `useState<Set<string>>` independent of `selected`; verified live — same causeKey stays expanded after switching pills | matches |
| Keyboard operability must be added, not deferred (Phase 1 called this a "must fix") | Real `<button>`, Tab reaches it, Enter/Space toggle, `aria-expanded` correct, focus ring present | matches |
| "Other community support" (`causeKey: ''`) bucket must be expandable too | Verified live with the inserted null-cause row | matches |
| Defensive "Detail unavailable" for the should-be-impossible empty-`rows`-with-`totalCents`-positive case | Present in code, correctly gated (`cause.rows.length === 0 && cause.totalCents > 0`) — not exercised live because the invariant that would trigger it (aggregate/row-collection drift) doesn't and shouldn't exist; this is dead code by design, same as the QA read concluded | matches (present, correctly unreachable) |
| No new `FEATURES` key / no new visibility tier | Confirmed — same two-tier gate, untouched | matches |

### Edge cases

| Edge case | Result |
|---|---|
| Empty state (current FY, zero transactions) | **pass** — verified live today; helpful copy + working "View All" link, not a blank box |
| Failure microcopy | **not applicable** — by design, per Phase 1/2/3: all data is precomputed server-side and handed down as props, so there is no client-side fetch-on-expand and therefore no network-failure path to design for in this MVP shape |
| Permission gate | **pass** — verified by source read (gate code identical to pre-feature) and implicitly exercised live (the click-through only worked because the e2e admin's `admin` role already carries `impact.view`) |
| Mobile 360px | **pass** — verified live, no horizontal overflow with an expanded, uncapped cause list |
| Brand consistency (`rounded-2xl` card, no `rounded-full`, `lions-blue` focus ring, no native dialogs) | **pass** — confirmed by source read; nothing destructive in this feature so `ConfirmDialog` correctly doesn't apply |
| Accessibility (Flow D) | **pass** — verified live: keyboard reaches the row, Enter/Space toggle, `aria-expanded` reflects state correctly |

### Follow-ups

None required to ship — both of QA's deferrals are now closed with live
verification, not accepted risk. One process-level (not feature-level) gap
surfaced along the way: this repo's e2e suite has no `signInAsMember()`
fixture, only `signInAsAdmin()`, and the admin account has no linked member
row — meaning every future member-portal feature will hit the same
"no automated auth path for a signed-in member" wall QA hit here. Logged as
**B-02** in `docs/backlog.md` (test-infrastructure debt, not a defect in this
feature) rather than gating this ship on it.

### What I did (for the work-log record)

- Read `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`,
  `src/components/members/impact-by-cause.tsx`, and
  `src/app/members/impact/page.tsx` in full to confirm the shipped diff
  against the Phase 1 intent and Phase 3 design doc.
- Queried the local dev DB directly (`psql`) to confirm the e2e admin's
  `member_id` was `NULL` and that its `admin` role already carries
  `impact.view`.
- Temporarily set `users.member_id` for the e2e admin account to an existing
  active member's id, drove four short-lived Playwright specs against the
  already-running local dev server (reused, did not start a second one),
  then reverted the linkage to `NULL` — confirmed by re-query.
- Inserted one temporary `[phase6-verification]`-tagged `ledger_transactions`
  row (`party = NULL`, `beneficiary_cause = NULL`, posted, Activity fund,
  dated today) to exercise the null-party/null-cause UI paths live, then
  deleted it — confirmed by re-query (count = 0).
- Deleted all four temporary Playwright spec files after each ran; confirmed
  `git status --porcelain e2e/` is empty.
- Appended **B-02** to `docs/backlog.md` for the e2e member-auth-fixture gap.
- Updated the Per-Phase Status table (Phase 6 row) in this file.

### Outputs

- `docs/work-log/2026-07-21-impact-cause-drilldown.md` — this Phase 6
  section, Per-Phase Status row.
- `docs/backlog.md` — added **B-02** (e2e member auth fixture gap).
- No implementation source modified. No schema, migration, decisions.md,
  permissions.ts, or auth/ files touched, per this session's scope.
- Temporary DB state (member linkage, verification transaction) and
  temporary e2e spec files were all created and fully reverted/deleted
  within this session — confirmed by re-query and `git status`.

### Open questions / handoff notes

- None outstanding. Pipeline closed — this feature is shipped.

# Minutes Browsing: Year Pills & Search Context — Work Log

> **Slug:** `2026-09-09-minutes-browse-and-search-context`
> **Surface:** (dashboard) member portal — `/members/records`
> **Permission(s):** None new. `/members/records` is deliberately ungated (any linked member, any kind, any status) — DECISION-077 §6.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-09 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-09 |
| 3 — Technical design | tech-lead | Complete | DESIGN COMPLETE | 2026-09-09 |
| 4 — Implementation | api-developer → ux-developer | Complete | — | 2026-09-09 |
| 5 — Verification | qa | Complete (FAIL → fixed → re-verified 21/21) | PASS after loop-back | 2026-09-09 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-09-09 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Turn the 49-record wall at `/members/records` into a chunked, honestly-labeled browse-and-search experience — calendar-year pills (current year selected by default) for paging, visible match snippets for search context, and a page that visibly *tells* a member "these are search results" — all as URL-driven state, no new permission, but `searchMinutes()` has to start returning which field matched and an excerpt before any of the UI work can start.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | Lands on `/members/records` and sees a list already narrowed to a sane size (not all 49 rows) | Every visit |
| Signed-in member | Clicks a year pill to view a different year's minutes | On demand |
| Signed-in member | Clicks an "All years" pill to see the full list on purpose | Occasional |
| Signed-in member | Clicks a kind tab (All / General / Board) in combination with a year pill | On demand |
| Signed-in member | Types a keyword/name/motion phrase into the search box and submits | On demand |
| Signed-in member | Reads a result's excerpt to judge relevance before clicking through, without opening the record | Every search |
| Signed-in member | Visually distinguishes "I'm browsing" from "I'm looking at search results" from page chrome alone (heading, count, a Clear-search control) — this is the literal defect being fixed | Every search |
| Signed-in member | Clears an active search and returns to browsing (currently: only by manually emptying the box) | On demand |
| Signed-in member | Bookmarks or shares a URL with a specific year/kind/search combination and gets the same view back | Occasional |

No admin verbs — this request is scoped to the member-facing page only (see Out of Scope).

## Flows

**Flow 1 — Default landing:** entry: member navigates to `/members/records` (nav link, no query params) → step: page defaults `kind=All`, `year=<current calendar year>` → step: member sees a list scoped to that year alongside visible year pills (`All`, 2026, 2025, 2024, …) and the existing kind tabs → outcome: member sees a manageable list (14 rows for 2026 today, not 49).
- Failure: current year has zero records yet (real for the first weeks of a new calendar year, before that year's first meeting is recorded/approved). Member must see an empty state that names the year and offers a next step — not a bare "No meeting minutes have been posted yet" that reads as "this club stopped keeping minutes." Recommend a link to the nearest year that does have records.

**Flow 2 — Filter by year:** entry: member clicks a year pill from anywhere on the page → step: GET reload with `?year=2025`, preserving any active `kind`/`q` in the URL exactly as `KindFilterTabs`/`SearchBox` already preserve each other → outcome: list re-scopes, pill shows active state (same visual treatment `KindFilterTabs` already uses for `kind`).
- Failure: a hand-edited or bookmarked `?year=1900` or `?year=banana`. Must not 500, must not silently render an empty list with no explanation. Falls back to the default (current year) and the pill row reflects that fallback — never shows a nonexistent year as "selected."

**Flow 3 — Search:** entry: member types a term and submits the existing GET form → step: page re-renders with `?q=<term>` (kind preserved as today; see the year-scoping decision below) → step: each result shows a short excerpt of the matched text plus a label naming where it matched (minutes body, a motion, an action item) → step: page chrome visibly shifts to a "search results" state — a count, a "Results for '<term>'" heading, a Clear-search control — distinct from the plain browse list → outcome: member can tell at a glance these are search hits, judge relevance from the excerpt, and click through confidently.
- Failure: zero results shows "No minutes match '<term>'" (already implemented). Because search is recommended to ignore the year pill entirely (below), the "zero hits in my selected year but hits exist in another year" trap named in the request cannot occur — there is no year scoping left to produce it.

**Flow 4 — Clear search, return to browsing:** entry: member clears the box or clicks Clear-search → outcome: back to Flow 1's browse list. Recommend the `year` param persists inertly in the URL/hidden field while a search is active, so clearing search restores the member's prior year selection instead of resetting to the default.
- Failure: none beyond Flow 1's own failure path.

## Permissions

- **Permission(s):** None new. `/members/records` stays ungated — `auth()` + inline `memberId` check only, no `FEATURES` key (DECISION-077 §6, mirrors `/members/financial-reports`). Confirmed by reading `src/app/members/records/page.tsx`: paging/search state is pure `searchParams`, orthogonal to the permission question.
- **Default roles:** Unchanged — any linked member, regardless of granted `FEATURES`. Worth stating explicitly: a member who is signed in but holds zero granted features (who gets redirected to `/access-pending` as their post-login *landing*) is not blocked from navigating directly to `/members/records` today, and nothing in this request changes that. This feature works identically for a member mid-onboarding as for a fully-provisioned one.

## Gaps the Request Didn't Address

- **`searchMinutes()` returns no matched text at all.** `MinutesSearchRow` is `{ id, kind, meetingDate, status, title }` — no excerpt, no indication of which of the seven `ILIKE` targets (title, body, motion text/mover/seconder, action-item text/owner) actually matched. Snippets are not a UI-only change; the query layer's return shape has to grow. This is the single biggest gap blocking ask #2 and #3 and belongs in Phase 3's data model, not Phase 4 improvisation.
- **No visible browse/search distinction exists today** — this is literally the bug behind ask #3 (the user's "I could NOT tell it was search results"). Both code paths render through the identical `<ul>`/card markup with no count, no "results for" heading, no Clear-search control. Must be designed, not just styled.
- **Snippet accuracy depends on the matched field being tracked per-row, not guessed.** If a record matches on `title`/`bodyMarkdown` but the snippet-picking logic defaults to showing `moverName` (or vice versa), a member could see a useless snippet like "Motion by: Not recorded" attached to a body-text hit. This is the real shape of the "Not recorded" risk named in the request — not false-positive name matching (ILIKE on `moverName='Not recorded'` will never match a person's name unless someone literally searches "not recorded"), but snippet *quality* if the matched field isn't tracked precisely. Phase 3 needs to resolve this by having `searchMinutes()` return which field matched, not just that a match occurred.
- **Invalid `?year=` has no defined behavior** (Flow 2 failure path above). Needs explicit fallback semantics before Phase 4.
- **Zero-record-year empty state isn't specified.** Distinct from "no minutes exist at all" (today's only empty-state copy) — needs its own message and, ideally, a way out (link to nearest year with data).
- **Mobile chrome composition.** Kind tabs (up to 3 buttons) + year pills (recommend ~4-5: All + 3-4 years) + a search box is real width pressure at 360px. Not resolving the pixel layout here (that's tech-lead/ux-developer's job), but flagging that "just add a row of pills" without a mobile pass is likely to wrap awkwardly or crowd the tap targets below the 44px minimum this codebase otherwise enforces.
- **Year pills alone may not fully answer "paging" at today's heavier years.** 2025 alone holds 23 records — half the original 49-row wall, on one pill. Year chunking clearly helps (49 → ≤23), but isn't a complete answer to "some sort of paging" if the club's meeting cadence increases. Recommend, as a lightweight mitigation now rather than true limit/offset pagination: show a visible record count near the list header (and optionally on each pill, e.g. "2025 (23)") so the member always knows the size of what they're looking at. Flag true pagination as a follow-up if a single year ever comfortably exceeds ~30-40 rows.
- **Admin's own `/admin/minutes` list has the identical unbounded-wall problem** (same table, same growth) but wasn't mentioned in the request, which is scoped to the member page. Listed under Out of Scope below — confirm with the user rather than silently assuming it's excluded or silently including it.

## Out of Scope (confirm with user)

- Full-text search / relevance ranking / stemming — sequential `ILIKE` stands (architect Ruling 2, "cheap at this club's data volume"); this request doesn't ask to revisit that.
- Multi-year range selection (e.g., "2024–2025" as one selection) — request asks for single-year pills only.
- `/admin/minutes` list paging — same underlying data, same eventual problem, but a separate surface and a separate audience; not mentioned in the request.
- A "committee" minutes kind — `MINUTES_KINDS` is `["general", "board"]` only today; unrelated to this request, noted only so it isn't confused with the CLAUDE.md admin-nav list that mentions "committee" in a different context.

## Open Questions — RESOLVED 2026-09-09

All four are settled. Phase 3 must design to these answers, not to the analyst's
original recommendations, which the first item overrides.

1. **Calendar year vs. Lions year for the pills — USER DECIDED: Lions year (Jul–Jun).**
   This overrides the analyst's calendar-year recommendation above. Rationale accepted
   by the user: the club governs on the Lions year, and `fiscal-year.ts` already labels
   a year that way for the Ledger, dues and budgets — having `/members/records` mean
   something different by "2026" was judged the worse cost. Pills are therefore
   `2023-24 · 1`, `2024-25 · 24`, `2025-26 · 22`, `2026-27 · 2`, plus an "All years"
   pill, and they MUST reuse `fiscalYearLabel()` / `getFiscalYear()` from
   `src/lib/fiscal-year.ts` rather than deriving a second notion of a club year.
   The default selection is the **literal current** Lions year (`currentFiscalYear(now)`),
   accepted with eyes open: the user saw a mock showing "Showing 2 of 49" on arrival and
   chose it anyway. Do NOT substitute "newest year with data" — that option was offered
   and explicitly not chosen.

2. **Empty / near-empty state — link to the nearest year with data.** Decided. This
   matters more under the Lions-year default than it would have under calendar year,
   because the default bucket is sparse for the first months of every Lions year by
   construction. The state must not read as an error: the club has 49 records and the
   member is one click from them.

3. **Per-year record counts — yes, on the pills themselves** (`2024-25 · 24`), in
   addition to a single `Showing X of 49` line above the list. Under the Lions-year
   default this is load-bearing, not decoration: it is what tells a member landing on a
   2-record page that 24 more sit one pill to the left. One grouped query, not N.

4. **`/admin/minutes` — explicitly out of scope this round.** Confirmed, not an
   oversight. Same underlying growth problem, different audience and different
   permission surface; it gets its own work-log entry if and when it's wanted.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature shape is right — URL-driven `searchParams`, no new permission, no schema change, Server Components throughout. The one real structural decision (the query-layer rework needed to return "which field matched") has an obvious, low-risk shape once you stop trying to keep `selectDistinct` + two `LEFT JOIN`s. Rulings below; nothing here should loop back to Phase 1.

## Placement

- **Directory placement — no new top-level module.** Everything lands in the existing minutes family:
  - `src/lib/minutes.ts` — one new pure function, `extractSnippet()` (name is Phase 3's call), alongside `escapeIlikeTerm()`. Pure string work belongs exactly where `escapeIlikeTerm()` already lives — same file, same "no DB access" contract, same reason it isn't duplicated per call site.
  - `src/lib/minutes-queries.ts` — `searchMinutes()`'s return shape and internal query structure change (see "Query Layer Ruling" below); `listMinutesForMembers()` grows an optional `year` filter; a new exported function returns per-fiscal-year record counts for the pills.
  - `src/components/minutes/` — one new component, `year-filter-pills.tsx` (naming mirrors `kind-filter-tabs.tsx`), plus a small presentational piece for rendering an excerpt with a safely-highlighted match (can be a function inside the existing list-rendering code in `page.tsx`, or its own tiny component — Phase 3's call, not architecturally significant either way).
  - No new directory, no new top-level file family. This stays inside the boundary DECISION-074 Ruling 2 already drew for minutes.

- **Server vs Client split — year pills are a Server Component, no exception.** Rule: `year-filter-pills.tsx` mirrors `KindFilterTabs` exactly — a `<nav>` of `<Link>`s built from `URLSearchParams`, zero `'use client'`, zero JS shipped. There is no interactivity requirement here that a client component would justify (no live-typing, no debounce, no optimistic state) — it's a GET reload, same as every other filter control on this page. The snippet/highlight rendering is also server-rendered: it's pure JSX composition from data already present in the page's props, not a browser API or event handler.

- **Dependencies — no, and I agree with your prior.** This is a bounded substring search (`indexOf`/`toLowerCase`) plus a window-and-ellipsize, and a `reduce` over a small fetched row set for the per-year counts. No highlighting library, no fuzzy-search package, no date library beyond what's already imported (`fiscal-year.ts`, `nowEastern()`). Explicitly flagging this so Phase 3/4 doesn't reach for one: **no new dependency is justified for any part of this feature.**

## Query Layer Ruling — the one real design decision

The request correctly identifies that `selectDistinct` over two `LEFT JOIN`s can't tell you which `OR` branch fired, and can't safely carry per-row field text either (joining `minutesMotions` and `minutesActionItems` together produces a cross-join: N motions × M action items per minutes row, which is exactly the row-multiplication risk flagged in the brief). Don't patch that shape — replace it.

**Ruling: `searchMinutes()` should stop being one query with two joins, and become three independent, single-join (or joinless) queries, merged in JS.**

1. Query A — `minutes.title` / `minutes.bodyMarkdown` ILIKE match. No join.
2. Query B — `minutesMotions.text` / `moverName` / `seconderName` ILIKE match, joined only to `minutes` (for `meetingDate`/`kind`/`status`/soft-delete filtering). One motion row per match.
3. Query C — same shape as B, against `minutesActionItems`.

Merge in JS: group by `minutes.id`, and where a minutes record matches in more than one place (or more than one motion), pick one field deterministically by a documented priority (e.g. title > body > motion > action item; first child row if multiple of the same kind match) — this is a UX call for Phase 3/4 to make and document in the module's header comment, in keeping with how heavily this file already documents its own reasoning. I'm not mandating the exact order, only that it be deterministic and written down.

This is still **one bounded set of round trips, not N** — three queries regardless of how many minutes records exist, same complexity class as today's one query. It resolves the row-multiplication risk by construction (no query joins motions to action items), and it's the only way to know which field matched without guessing.

**Suggestion, not a requirement:** if Phase 3 finds the title case genuinely trivial, it can skip snippet machinery for a title match entirely — the title already renders as the visible card headline, so "matched in title" needs no excerpt or label at all. That would let Query A drop to body-only, slightly simplifying the merge. Worth considering, not mandating.

**A real pitfall to flag for Phase 4:** `escapeIlikeTerm()` produces a string escaped for SQL `ILIKE` (backslash/`%`/`_` escaped). That is emphatically not the string to use for the JS-side "where in this text did it match" scan — reuse the *raw, trimmed* query term for the JS substring search, not the escaped one. A copy-paste of the wrong variable here would either fail to find real matches or (worse) highlight the wrong span.

## Highlighting the Matched Term — safe by precedent, not by exception

This does **not** touch the no-raw-HTML-passthrough rule at all, because it never needs to produce an HTML string. The codebase already has the exact right precedent: `renderHighlightedLabel()` in `src/components/admin/admin-sidebar.tsx` (paired with `src/lib/fuzzy-match.ts`'s `positions: number[]` contract) takes plain text plus match positions and returns React nodes — a `<span>` around the matched characters, built by `.split()` and `.map()`, composed as JSX. No `dangerouslySetInnerHTML`, no HTML string ever exists.

**Ruling:** the snippet extractor returns plain data — excerpt text plus a match offset/length (or start/end indices) within that excerpt — and a small presentational function/component turns that into JSX (`<>{before}<mark>...</mark>{after}</>` or the `.split()`+`.map()` shape already established). This is architecturally identical to the sidebar's existing pattern, just applied to a substring range instead of a sparse character set. No exception to the raw-HTML rule is being requested or granted, because raw HTML is never in the picture.

## Per-Year Counts — "one grouped query" ruled as one round trip, not a SQL `GROUP BY`

Decision #3 says "one grouped query, not N." I'm ruling that literally as **one SQL round trip**, not necessarily a SQL-side `GROUP BY fiscal_year`, and specifically steering away from a SQL-side fiscal-year computation. Reasoning: `getFiscalYear()`'s Jan–Jun/Jul–Dec split is business logic that already lives in exactly one place, `fiscal-year.ts`. Reimplementing that same split as a Postgres `CASE WHEN EXTRACT(MONTH ...)` expression to get a SQL-side `GROUP BY` would be the exact "same decision implemented in more than two places" pattern CLAUDE.md's duplication rule exists to catch — and it's avoidable for free at this data volume.

**Ruling:** fetch one narrow row set (`id`, `meetingDate`, `kind`, filtered by `pendingDeleteAt IS NULL` and, per the open question below, possibly by `kind`) in a single query, then `reduce()` it in JS into per-fiscal-year counts using the existing `getFiscalYear()`. One query, zero duplicated business logic. At 49 rows growing ~24/year this is trivially cheap for years; revisit only if minutes ever reaches an order of magnitude more rows than that, which is not a near-term concern.

**Concrete bug to flag for Phase 3/4 — this is the same bug class as the naive-timestamp-as-UTC issue already logged elsewhere in this project's memory, applied to a `date` column instead of a `timestamp` column.** `minutes.meetingDate` is a plain `date` column, so Drizzle returns it as a `'YYYY-MM-DD'` string. Calling `getFiscalYear(new Date(row.meetingDate))` directly is wrong: `new Date('YYYY-MM-DD')` parses as UTC midnight, and `.getMonth()`/`.getFullYear()` then read it back in the server's local timezone — right at the Jun 30/Jul 1 boundary this can silently shift a record into the wrong fiscal year. The codebase already has the correct, established fix for exactly this pattern (`ledger.ts`, `ledger/transactions/route.ts`, `reimbursements/[id]/route.ts`): **append a local-noon-or-midnight time component before constructing the `Date`** — `getFiscalYear(new Date(row.meetingDate + "T00:00:00"))` — forcing local-time parsing instead of UTC parsing. Phase 3 must specify this explicitly; Phase 4 must not reuse a bare `new Date(meetingDate)`.

By contrast, the **year-filter WHERE clause** (turning a selected `year=2025` pill into a date-range condition) should use `fyBounds(fy)` from `fiscal-year.ts` directly against the `date` column via `gte`/`lt` — comparing `'YYYY-MM-DD'` strings against `fyBounds`'s `'YYYY-MM-DD'` boundaries never goes through `new Date()` at all, so this path has no TZ exposure. Only the *counting/grouping* path (which needs a JS `Date` to call `getFiscalYear()`) carries the risk above.

## Invariants Touched

- **Server/Client boundary** — respected. Every new piece of UI (year pills, snippet/highlight rendering) is a Server Component or plain JSX composition; no `'use client'` is justified anywhere in this feature.
- **Permissions are the only gating mechanism** — respected, and explicitly not widened. `/members/records` stays ungated (`auth()` + inline `memberId` check only). Adding `?year=` is pure `searchParams` state, read by the query layer, with zero interaction with `FEATURES`/`hasFeature()`. A member with zero granted features reaches this page and every year/kind/search combination on it today, and nothing here changes that — confirmed by re-reading `page.tsx`, which never branches on `session.user.features`.
- **Schema Is The Source Of Truth** — a clean no-op. No table, column, or index changes. Confirmed no index is needed at 49 rows / ~24-per-year growth: the year-range filter (`fyBounds` + `gte`/`lt` on `meetingDate`) is cheaper than the sequential-`ILIKE` search this table already runs unindexed (architect Ruling 2, prior review), and the counts query is a single narrow unindexed scan. Revisit only if this table's growth assumption changes by an order of magnitude.
- **Migrations re-run on every deploy** — not applicable; no migration file is created by this feature.
- **Anti-duplication review rule** — checked and clean. No excerpt/snippet helper exists anywhere else in the codebase today (`ledger-search-queries.ts` returns full rows, no snippets); the one new helper in `minutes.ts` is new, not a second copy of something that already exists. `getFiscalYear()`/`fiscalYearLabel()`/`fyBounds()` are reused from `fiscal-year.ts`, not reimplemented — as the resolved Open Question #1 requires. One near-duplication risk worth naming for the record, not blocking: `fiscal-year.ts` already has `deriveCauseFyPills()`, a "which FYs get a pill" helper built for `/members/impact`. It doesn't fit here as-is — it truncates to a fixed 3-year window plus a "More" disclosure, whereas this request wants every Lions year with data shown as its own pill (there are only 4 today). Don't force-fit it now. If the number of Lions years with minutes ever grows large enough that showing all of them as pills becomes its own version of the wall-of-49 problem, that's the moment to go back and generalize `deriveCauseFyPills()`'s fixed+more shape for reuse — noted for a future work-log, not this one.
- **No Personal Data / No Secrets / Outbound Email deny-by-default** — not implicated; this feature touches no email, no PII beyond what `/members/records` already displays (meeting minutes text, already member-visible), no environment variables.

No new architectural decision is logged in `docs/decisions.md` — nothing here crosses the threshold in my role's ownership (no new dependency, no new top-level module, no route-group change, no permission-catalog change). The query-layer rework is a data-model-shape decision within an existing module, which is tech-lead/database-admin territory to detail in Phase 3, not an architect-logged decision.

## Notes — binding on Phase 3

1. **URL state contract to specify explicitly** (not fully closed by the four resolved Open Questions):
   - `year` absent → default to `currentFiscalYear(nowEastern())` (use `nowEastern()`, already imported in `minutes-queries.ts`, for consistency with how this file already treats "now" — not a new invariant, just local consistency).
   - `year=all` → no year filter, full list.
   - `year=<FY>` where `<FY>` is a fiscal year that actually has a rendered pill (i.e., appears in the counts result, or equals the current FY, which always renders per decision #1) → filter to that year via `fyBounds`.
   - Any other `year` value (non-numeric, or numeric but not a rendered pill — "1900" and "banana" are the same failure case per Flow 2) → silently fall back to the default and render the pill row with the default selected, never a phantom pill "selected." Validate against the same known-year set the pills are built from — don't invent a second validity rule.
   - **`year` is carried as inert state through kind-tab and search-box interactions** (hidden field / link param, exactly like `kind` and `q` already thread through each other) but is **not** passed into `searchMinutes()` — per Flow 3's recommendation ("search is recommended to ignore the year pill entirely") and Flow 4's requirement that clearing a search restores the prior year selection. This wasn't one of the four items explicitly marked RESOLVED, but it's the only reading consistent with both flows as written; Phase 3 should state it as settled rather than re-opening it, unless the user objects.
   - `kind-filter-tabs.tsx` and `search-box.tsx` both need a `year` prop threaded through the same way `query`/`kind` already are today.

2. **Open question Phase 3 must pin down, not the architect's call:** do per-pill counts reflect the currently-active `kind` filter (Flow 2 explicitly names "a kind tab in combination with a year pill") or are they always all-kind totals? Either is architecturally fine; it changes one query's `WHERE`, not the shape ruled on above. Just don't leave it implicit.

3. **`MinutesSearchRow`'s new shape** needs, at minimum: which field matched (an enum: title/body/motion/action-item), the excerpt text, and enough position data to highlight safely (offsets into the excerpt, not the full body — never send a full `bodyMarkdown` to the client just to let it compute a match position, that's needless payload for a page already listing up to dozens of rows).

4. **Empty-state and "nearest year with data" (resolved Open Question #2)** needs the counts data structure to double as "which years exist at all" — the same query that powers the pills tells the empty state which year to link to. Don't build a second query for that.

Everything else in the four RESOLVED Open Questions is unambiguous and needs no further architectural comment — Phase 3 should treat them as settled inputs.


## Phase 2 Open Question — RESOLVED (coordinator, 2026-09-09)

**Do the per-pill counts respect the active `kind` filter? YES.**

The counts must be computed under the same `kind` predicate that filters the list.
A pill reading `2024-25 · 24` while the Board tab is active, when only 9 of those 24
are board minutes, is a count that promises records the current view will not show —
the member clicks it and lands on 9. Counts describe *what you will get*, not what
exists in the abstract. Concretely: with kind=board the pills read
`2023-24 · 1 / 2024-25 · 5 / 2025-26 · 9 / 2026-27 · 1` (illustrative — derive the
real numbers in the query, do not hardcode these).

Corollary for Phase 3: the counts query takes the same `kind` argument as
`listMinutesForMembers()`, and the "All years · N" pill's N is likewise kind-scoped.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're turning `/members/records`' unbounded 49-row wall into a Lions-year-chunked browse
experience (year pills, current FY selected by default, per-pill kind-scoped counts) and
making search visibly distinct from browsing (result count, "Results for…" heading, excerpt +
match-location label per result, Clear-search affordance). No schema change, no new
permission — this is a query-layer rework (`searchMinutes()` split into three single-join
queries merged in JS, plus a new fiscal-year-counts query and a `year` filter on
`listMinutesForMembers()`) feeding a page/component rewrite that stays 100% Server Components.
The one real correctness risk is `minutes.meetingDate` (a `date` string) getting parsed as
`Date` for fiscal-year bucketing — the design below names every call site and pins the fix with
a unit test.

## Permissions

**None new. Confirmed unwidened.** `/members/records` keeps its existing gate — `auth()` +
inline `memberId` check only, no `FEATURES` key (DECISION-077 §6). `?year=` is read from
`searchParams` *after* that check, purely to shape which rows the (already-permitted) query
functions return; it never touches `session.user.features` and is invisible to
`hasFeature()`. Confirmed by re-reading `page.tsx`: when `memberId` is null, `rows`/`pointers`/
`documents` are set to `[[], [], []]` *before* any minutes query — including the new counts
query — is ever attempted, so a member with an unlinked account cannot use `?year=` to probe
data any more than they can today with `?kind=`/`?q=`. Default role bindings: unchanged (any
linked member).

## API Contract

These are Server Component data functions and a `searchParams` URL contract, not REST routes.

### `src/lib/minutes.ts` (pure, no DB — new exports)

```ts
export interface MinutesSearchSnippet {
  /** Windowed, ellipsized text — never the full field value. */
  excerpt: string;
  /** Offset into `excerpt` (not the full field), start of the matched span. */
  matchStart: number;
  matchLength: number;
}

/**
 * Finds `term` in `text` (case-insensitive, literal — never a regex built
 * from `term`, so ILIKE metacharacters `%`/`_` and regex metacharacters
 * alike are inert) and returns a windowed excerpt with match offsets
 * relative to the excerpt, or `null` if `term` does not literally occur in
 * `text`. Ellipsis (`…`) is prepended/appended only when the window
 * actually truncates that side. Doubles as the "does this field match"
 * test everywhere in minutes-queries.ts's search merge — one indexOf
 * implementation, not one per call site.
 *
 * Caller MUST pass the raw, trimmed query term — never `escapeIlikeTerm()`'s
 * output (that string carries literal backslashes for SQL and would
 * corrupt a JS substring search or highlight the wrong span).
 */
export function extractSnippet(
  text: string,
  term: string,
  windowSize = 60,
): MinutesSearchSnippet | null;

/** Display label for a search-result's matched field, e.g. for the "matched
 *  in…" chip. 'title' is intentionally not a caller of this — see Component
 *  Plan for why title matches render no label at all. */
export function minutesSearchMatchFieldLabel(
  field: "body" | "motion" | "action_item",
): string; // "Minutes text" | "Motion" | "Action item"

/**
 * Pure parse of the `?year=` URL param against the known-year set (current
 * FY plus every FY with >=1 record for the active kind). Implements the
 * full absent/all/valid/garbage contract below — see "URL State Contract."
 */
export function resolveYearParam(
  raw: string | undefined,
  knownYears: number[],
  currentFY: number,
): { year: number; isAll: boolean };

/**
 * Nearest fiscal year (by absolute distance, ties broken toward the more
 * recent year) to `target` among `candidates`. Returns `null` only when
 * `candidates` is empty (no minutes exist for this kind at all — the
 * caller falls back to today's "No meeting minutes have been posted yet"
 * copy, unchanged).
 */
export function nearestFiscalYearWithData(target: number, candidates: number[]): number | null;
```

### `src/lib/minutes-queries.ts` (DB-facing — changed/new exports)

```ts
export type MinutesSearchMatchField = "title" | "body" | "motion" | "action_item";

export interface MinutesSearchRow {
  id: string;
  kind: string;
  meetingDate: string;
  status: string;
  title: string | null;
  matchField: MinutesSearchMatchField;
  /** null exactly when matchField === "title" — the title is already the
   *  visible card headline, nothing more to show. */
  snippet: MinutesSearchSnippet | null;
}

// Unchanged public signature; internal implementation is now 3 queries + a
// JS merge (see Component/Query design below). Still ignores `year` by
// design (Flow 3: search spans all years).
export async function searchMinutes(query: string, kind?: string): Promise<MinutesSearchRow[]>;

export interface MinutesMemberListFilters {
  kind?: string;
  /** Fiscal year to scope to, via fyBounds() string-range comparison on the
   *  `date` column — no `new Date()` parse, no TZ exposure. Omitted = no
   *  year filter (all years). */
  year?: number;
}

export async function listMinutesForMembers(
  filters?: MinutesMemberListFilters,
): Promise<MinutesSummaryRow[]>; // return type unchanged

export interface MinutesFiscalYearCount {
  fiscalYear: number;
  count: number;
}

/**
 * One query (meetingDate only, `pendingDeleteAt IS NULL`, `kind`-scoped when
 * given), reduced in JS via getFiscalYear() from fiscal-year.ts — never a
 * SQL-side fiscal-year CASE expression (that would duplicate business logic
 * that already lives in exactly one place). Only fiscal years with >=1
 * record appear; the current FY is NOT force-included here — the caller
 * unions it in, since decision #1 requires it to always render regardless
 * of data. Sorted desc by fiscalYear.
 *
 * THE ONE RISKY CALL SITE in this feature: each row's `meetingDate` string
 * is turned into a JS Date via `new Date(row.meetingDate + "T00:00:00")`
 * — the established local-midnight fix (ledger.ts,
 * reimbursements/[id]/route.ts) — never a bare `new Date(meetingDate)`,
 * which parses as UTC and can shift a Jun 30 / Jul 1 record into the wrong
 * fiscal year.
 */
export async function getMinutesFiscalYearCounts(kind?: string): Promise<MinutesFiscalYearCount[]>;
```

### URL State Contract — `/members/records?kind=&q=&year=`

`searchParams: Promise<{ kind?: string; q?: string; year?: string }>`

- `year` **absent** → `{ year: currentFiscalYear(nowEastern()), isAll: false }` (the default —
  decision #1's literal-current-FY choice).
- `year=all` → `{ isAll: true }` — no year filter, full kind-scoped list.
- `year=<FY>` where `<FY>` parses as an integer AND (`<FY> === currentFY` OR `<FY>` appears in
  the kind-scoped counts result) → that year, via `fyBounds(FY)`.
- Anything else (non-numeric, or a numeric year with zero records for the active kind — "1900"
  and "banana" are the same failure case) → **silently falls back to the default**; the pill row
  renders with the current-FY pill active, never a phantom "selected" pill for a year that isn't
  rendered. `resolveYearParam()` above is the single place this is decided — both the page and
  any future caller validate against the *same* known-year set the pills are built from, per
  architect's note.
- `year` is **inert during search** (`q` non-empty): carried through as a hidden field in
  `SearchBox` and a link param in `KindFilterTabs`, exactly like `kind`/`q` already carry each
  other, but never passed into `searchMinutes()`. Clearing search returns to the member's prior
  year selection, not the default. `YearFilterPills` itself is not rendered while a search is
  active (see Component Plan) — there is nothing for it to do when year doesn't scope search
  results, and hiding it (rather than rendering inert-looking clickable pills) is what makes the
  "this is a browse control, not a search control" distinction legible.
- Counts (and therefore the known-year set and the pills' numbers) are **kind-scoped** — computed
  with the same `kind` argument that scopes the list (Phase 2 Open Question, resolved YES).

## Data Model

**No schema changes required.** Confirmed by architect: no index needed at 49 rows / ~24-per-
year growth — the year-range filter (`fyBounds` + `gte`/`lt` on `meetingDate`) and the counts
query (a single narrow unindexed scan) are both cheaper than the sequential-`ILIKE` search this
table already runs unindexed.

## Component / Page Plan

### Files to create

- `src/components/minutes/year-filter-pills.tsx` — new. Server Component, mirrors
  `kind-filter-tabs.tsx` exactly: a `<nav>` of `<Link>`s built from `URLSearchParams`, zero
  `'use client'`. Props:
  ```ts
  interface YearFilterPillsProps {
    /** undefined = "All years" pill active */
    activeYear: number | undefined;
    currentFY: number;
    /** kind-scoped, only years with count > 0 (from getMinutesFiscalYearCounts) */
    counts: { fiscalYear: number; count: number }[];
    /** kind-scoped sum, for the "All years · N" pill */
    totalCount: number;
    kind?: string;
  }
  ```
  Pills = `{currentFY} ∪ counts.map(c => c.fiscalYear)`, deduped, sorted desc, each rendered as
  `2025-26 · 22` (a small local, non-exported `shortFyLabel(fy)` — `"${fy}-${String((fy+1) %
  100).padStart(2,'0')}"` — formats the short pill text; `fiscalYearLabel()` from
  `fiscal-year.ts` is not reused here because it's a different, longer format built for prose
  ("FY2026 (Jul 2026 – Jun 2027)"), not a pill — this is presentation formatting, not a second
  definition of *which* year a date belongs to, so it doesn't trip the project's duplication
  rule), plus a leading "All years · {totalCount}" pill. Href for the pill matching the default
  (current FY, not "all") omits `year` entirely — same clean-URL convention `KindFilterTabs`
  already uses for its "All" tab.

### Files to modify

- **`src/lib/minutes.ts`** — add `extractSnippet()`, `minutesSearchMatchFieldLabel()`,
  `resolveYearParam()`, `nearestFiscalYearWithData()`, and the `MinutesSearchSnippet` type.
  Pure, no DB import — preserves the file's "importable without a database" contract.
- **`src/lib/minutes-queries.ts`** — rewrite `searchMinutes()` (see Query Design below); add
  `year` to `MinutesMemberListFilters` and its `WHERE`; add `getMinutesFiscalYearCounts()`.
  Needs `gte`, `lt` added to the existing `drizzle-orm` import line, and `getFiscalYear` /
  `fyBounds` imported from `@/lib/fiscal-year`, and `extractSnippet` / `MinutesSearchSnippet`
  from `@/lib/minutes`.
- **`src/components/minutes/kind-filter-tabs.tsx`** — add a `year?: string` prop (the
  already-normalized param value — `undefined` at default, `"all"`, or a numeric string; page
  computes this once, component does not re-derive fallback logic) and thread it into every
  tab's `href()` alongside `kind`/`q`, exactly mirroring how `query` is threaded today.
- **`src/components/minutes/search-box.tsx`** — same `year?: string` prop, rendered as a second
  `<input type="hidden">` alongside the existing `kind` hidden field.
- **`src/app/members/records/page.tsx`** — the substantial change:
  - `searchParams` type grows `year?: string`.
  - Compute `currentFY = currentFiscalYear(nowEastern())` (import both from `@/lib/fiscal-year`
    and `@/lib/events` — `nowEastern()` is already this codebase's "now" for this domain).
  - When `!query`: fetch `counts = await getMinutesFiscalYearCounts(kind)` (kind-scoped), derive
    `knownYears = counts.map(c => c.fiscalYear)`, resolve `{ year, isAll } =
    resolveYearParam(rawYear, knownYears, currentFY)`, then `rows = await listMinutesForMembers({
    kind, year: isAll ? undefined : year })`. `totalCount = counts.reduce((s,c) => s+c.count, 0)`.
  - When `query`: unchanged shape — `rows = await searchMinutes(query, kind)` — but `counts` is
    **not fetched at all** (saves a round trip the search view has no use for).
  - Render: `KindFilterTabs` and `SearchBox` always render (both take the new `year` prop).
    `YearFilterPills` renders **only when `!query`**. When `query` is set, render the search
    chrome instead of the plain list: a `"Results for "<query>""` heading, a `{rows.length}
    result(s)` count, and a Clear-search link (`/members/records?kind=&year=` — carries `kind`
    and the inert `year`, drops `q`).
  - Empty state, browse mode (`!query && rows.length === 0`): if `nearestFiscalYearWithData(year,
    knownYears)` returns a year, render "No {kindLabel} minutes recorded yet for
    {shortFyLabel(year)}." plus a link to that nearest year (`?year=<fy>&kind=`) labeled with its
    count. If it returns `null` (truly zero minutes of this kind, ever), render today's unchanged
    "No meeting minutes have been posted yet."
  - Empty state, search mode: unchanged copy ("No minutes match "…"").
  - Search-result rows: each renders the existing title/date/kind/status chrome, plus — only when
    `matchField !== "title"` — a small "matched in {minutesSearchMatchFieldLabel(matchField)}"
    label and the highlighted excerpt. A local, non-exported `renderSnippet()` helper builds the
    highlight the same way `renderHighlightedLabel()` does in `admin-sidebar.tsx`: JSX composed
    from `excerpt.slice(0, matchStart)` / `<mark>{excerpt.slice(matchStart, matchStart +
    matchLength)}</mark>` / the tail — never `dangerouslySetInnerHTML`. Title-match rows render
    exactly like today's browse rows: no label, no excerpt, no highlight (see "Title matches"
    below for why).

### Query design — `searchMinutes()`'s three-query rewrite (architect's binding ruling)

Replaces the single `selectDistinct` + two `LEFT JOIN`s with three independent, single-join (or
joinless) queries, merged and deduped by `minutes.id` in JS:

1. **Query A** — no join. `WHERE (ilike(title, escaped) OR ilike(bodyMarkdown, escaped)) AND
   pendingDeleteAt IS NULL AND (kind ? eq(kind) : true)`. Selects the full summary shape
   (`id, kind, meetingDate, status, title, bodyMarkdown`).
2. **Query B** — one join to `minutes` (for `kind`/`pendingDeleteAt` filtering + the summary
   columns). `WHERE (ilike(minutesMotions.text/moverName/seconderName, escaped)) AND …`, ordered
   by `minutesMotions.createdAt` (existing convention from `getMinutesDetail()`).
3. **Query C** — same shape as B, against `minutesActionItems` (`text`/`ownerName`).

**Per-row field resolution (reuses `extractSnippet()` as the single "does this field match"
test — no second indexOf implementation)**:
- Query A row: `extractSnippet(row.title ?? "", rawTerm)` first. If non-null → `matchField =
  "title"`, `snippet = null` (see "Title matches" below — this is deliberate, not a placeholder).
  Else → `matchField = "body"`, `snippet = extractSnippet(row.bodyMarkdown ?? "", rawTerm)`.
- Query B rows, grouped by `minutesId`, first row per id (by `createdAt` asc — "first child row
  if multiple of the same kind match," per architect): try `text` → `moverName` → `seconderName`
  in that order via `extractSnippet`; first non-null wins. `matchField = "motion"`.
- Query C: same shape, `text` → `ownerName`. `matchField = "action_item"`.
- **Documented merge priority (title > body > motion > action item)**: build a `Map<id, Row>`,
  insert Query A's rows first, then Query B's rows only for ids not already present, then Query
  C's rows only for ids not already present. A record matching in both its body and a motion
  therefore surfaces as a body match — this is the deterministic, written-down order the
  architect required, and it's a one-paragraph header comment on the merge function, matching
  this file's existing documentation density.
- Reuse the *raw, trimmed* query term (the same `term` variable already computed at the top of
  today's `searchMinutes()`) for every `extractSnippet()` call — never `escaped` (the
  `escapeIlikeTerm()` output), per architect's flagged pitfall.
- Final sort: `Array.from(merged.values()).sort((a, b) => b.meetingDate.localeCompare(a.meetingDate))`
  — string comparison on `'YYYY-MM-DD'`, matching the existing `desc(minutes.meetingDate)`
  ordering without a second SQL round trip.
- Still exactly **3 queries regardless of record count** — same complexity class as today's 1
  query, resolves the row-multiplication risk by construction (motions are never joined to
  action items).

### Title matches — the architect's "genuinely trivial" case, resolved

Adopted: a title match renders with **no label, no excerpt, no highlight** — identical to a
plain browse-list row. The member already sees the full, untruncated title (it's the card
headline in every view, search or browse), so there's nothing left to surface. This is stronger
than the architect's "skip snippet *machinery*" suggestion — it also skips highlighting the
title itself — because Query A's `WHERE` clause still tests `title` directly (so a title-only
match still surfaces as a result; findability is untouched), and rendering a highlighted span
inside text the member is already reading in full adds no information. This removes an entire
JSX code path and its own test cases, and is why `minutesSearchMatchFieldLabel()`'s type
signature excludes `"title"` — a label is never rendered for it.

## Implementation Order

1. `src/lib/minutes.ts` — `extractSnippet()`, `minutesSearchMatchFieldLabel()`,
   `resolveYearParam()`, `nearestFiscalYearWithData()`, `MinutesSearchSnippet` type, plus their
   unit tests (see below).
2. `src/lib/minutes-queries.ts` — three-query `searchMinutes()` rewrite + merge; `year` on
   `MinutesMemberListFilters`/`listMinutesForMembers()`; `getMinutesFiscalYearCounts()`; unit
   tests extending `minutes-queries.test.ts`'s existing mock-db FIFO harness.
3. `src/components/minutes/year-filter-pills.tsx` — new component.
4. `src/components/minutes/kind-filter-tabs.tsx` and `search-box.tsx` — add the `year` prop.
5. `src/app/members/records/page.tsx` — searchParams/query rewrite, browse-vs-search chrome,
   snippet rendering, empty states.
6. No email notification, no `FEATURES` entry, no migration — steps 1/2/5 from the template
   don't apply to this feature.
7. Release notes entry — tech-lead writes this at ship time (Phase 6 SHIP IT), not the
   implementer.

## Edge Cases & Risks

- **The date-parsing bug (highest-risk item in this design).** `minutes.meetingDate` is a plain
  `date` column → Drizzle returns `'YYYY-MM-DD'` strings. `getMinutesFiscalYearCounts()` is the
  **only** place in this feature that needs a JS `Date` (to call `getFiscalYear()`), and it MUST
  use `new Date(row.meetingDate + "T00:00:00")`, never a bare `new Date(row.meetingDate)` — the
  bare form parses as UTC midnight and can silently misfile a record right at the Jun 30/Jul 1
  Lions-year boundary the user just chose as the default view. `listMinutesForMembers()`'s year
  filter has **no such exposure** — it compares `fyBounds(fy)`'s `'YYYY-MM-DD'` strings directly
  against the `date` column via `gte`/`lt`, never constructing a `Date` at all. Required test:
  pin both paths, especially the boundary.
- **`?year=` referencing a real-but-dataless year.** Handled by validating against the
  kind-scoped known-year set, not "is it a plausible 4-digit number" — a stale bookmark from
  before a kind filter removed a year's only record falls back cleanly instead of showing a
  phantom-selected pill over an empty list with no explanation.
- **Zero-record current-FY landing, by construction, every Jul–Sep.** This is not an edge case
  under the Lions-year default — it is the *common* state for roughly a quarter of the year.
  The nearest-year link is load-bearing, not a nicety; `nearestFiscalYearWithData()` is
  unit-tested accordingly.
- **`extractSnippet()` disagreeing with Postgres `ILIKE`'s match.** Defensive fallback for Query
  B/C: if none of a row's candidate fields register a client-side match despite the SQL `WHERE`
  finding one (not expected for this club's English-language content, but collation differences
  are a real category of bug), fall back to `matchField`'s first candidate field with a plain,
  unwindowed excerpt (`text.slice(0, 120)`) and `matchLength: 0` — renders as an excerpt with no
  highlighted span rather than throwing or silently dropping the result.
- **Mobile width** (flagged in Phase 1, not resolved there): kind tabs + year pills + search box
  in one row is real pressure at 360px. This design keeps `YearFilterPills` on its own row below
  `KindFilterTabs`/`SearchBox` (not crammed inline) specifically to give ux-developer room to
  wrap it independently; final pixel layout is ux-developer's call within the existing
  `min-h-[44px]` tap-target and `rounded-lg` pill conventions already used by `KindFilterTabs`.
- **`/admin/minutes`** — untouched, confirmed out of scope per Phase 1 resolution #4.

## Unit Tests the Implementer Must Deliver

All in `src/lib/minutes.test.ts` unless noted; extend, don't replace, existing `describe` blocks
where a sibling already exists.

**Fiscal-year boundary (the named highest-risk item)** — exercised through
`getMinutesFiscalYearCounts()` in `src/lib/minutes-queries.test.ts` (using the file's existing
mock-db FIFO/`.where()`-capture harness), not through `fiscal-year.ts` directly (that file's own
`getFiscalYear()` unit is unchanged and untested by this feature):
1. A `meetingDate` of `'2026-06-30'` buckets into FY2025, not FY2026.
2. A `meetingDate` of `'2026-07-01'` buckets into FY2026.
3. A `meetingDate` of `'2026-01-01'` (New Year's Day) buckets into FY2025 (Jan is still H1 of
   the fiscal year that started the previous July).
4. Regression guard: assert the implementation is NOT reachable via a bare `new Date(dateString)`
   by constructing the test around a server timezone where UTC-vs-local would disagree if the
   fix were reverted (mirrors how the ledger/reimbursements tests already pin this pattern).

**`extractSnippet()`:**
5. Match at the very start of the text → no leading ellipsis, `matchStart === 0`.
6. Match at the very end of the text → no trailing ellipsis.
7. Match plus surrounding text entirely shorter than the window → whole text returned, no
   ellipsis on either side.
8. Text with no occurrence of the term → returns `null`.
9. Term containing ILIKE wildcards (`"50%_off"`, echoing the existing `searchMinutes()` test
   fixture) → found via literal substring match; proves the raw/unescaped term is what's being
   searched, not `escapeIlikeTerm()`'s output, and that `%`/`_` are inert to the JS search (no
   regex construction from the term).
10. Case-insensitive match (e.g. term `"quorum"` against text containing `"Quorum"`).

**`resolveYearParam()` — the year-param contract:**
11. `raw === undefined` → `{ year: currentFY, isAll: false }`.
12. `raw === "all"` → `{ isAll: true }`.
13. `raw` is a numeric string equal to a known year (in `knownYears` but not `currentFY`) →
    that year, `isAll: false`.
14. `raw` is garbage (`"banana"`) → falls back to `{ year: currentFY, isAll: false }`.
15. `raw` is a well-formed number but NOT in `knownYears` and not `currentFY` (e.g. `"1900"`) →
    same fallback as garbage — proves the two failure cases in Flow 2 are handled identically.
16. `raw === String(currentFY)` → resolves to `currentFY` even when `currentFY` has zero
    records (not required to appear in `knownYears` — decision #1's "always renders, data or
    not").

**`nearestFiscalYearWithData()`:**
17. Empty `candidates` → `null`.
18. A single candidate → that candidate, regardless of distance.
19. Multiple candidates on both sides of `target` → picks the closer one.
20. A tie in distance → picks the more recent (larger) year.

**`searchMinutes()` three-query merge** (extending `src/lib/minutes-queries.test.ts`'s existing
`describe("searchMinutes", …)` block, using its established mock-queue-per-query-in-call-order
convention):
21. A record matching only in `bodyMarkdown` → `matchField: "body"`, non-null `snippet`.
22. A record matching only in a motion's `text` → `matchField: "motion"`.
23. A record matching in both `bodyMarkdown` AND a motion → `matchField: "body"` (priority
    order), not `"motion"`.
24. A record matching only in `title` → `matchField: "title"`, `snippet: null`.
25. Still exactly 3 `db.select`/query calls regardless of how many motions/action items exist on
    a matched record (no N+1) — assert against the mock's call count.
26. `kind` scoping still applies identically across all three queries (extends the existing
    `kind="board"` test).

**`listMinutesForMembers()` year filter:**
27. `year` provided → the captured `.where()` condition compiles (via the file's existing
    `PgDialect` SQL-compilation helper) to a `gte`/`lt` range matching `fyBounds(year)`, not a
    `new Date()`-derived comparison.
28. `year` omitted → no date-range condition present (existing behavior unchanged).

## Implementer

**api-developer**, then **ux-developer** — the specialist split, not full-stack-developer.

This is not a "small, tightly coupled ~<150 line" feature despite having no schema change: the
query-layer rewrite alone (`searchMinutes()`'s three-query merge, the new counts query, the
year filter, and four new pure helpers in `minutes.ts`) is a genuine server-logic piece with
~28 named unit tests, and the page/component rewrite (a new Server Component, two component
edits, and a real restructuring of `page.tsx`'s list/results region with two distinct render
paths) is a comparable amount of UI work. Combined this is easily 500+ lines across both layers
— well past the threshold where a single generalist adds more risk (one agent context-switching
between query-shape correctness and JSX/Tailwind chrome) than a handoff costs. **api-developer**
owns `src/lib/minutes.ts` and `src/lib/minutes-queries.ts` plus every unit test listed above —
consistent with the agent roster's "route handlers, server actions, business logic" scope, and
with this being genuinely server-side data-shape work, not schema (no `database-admin` step
needed — confirmed no migration). **ux-developer** then builds
`year-filter-pills.tsx`, the two component edits, and the `page.tsx` rewrite on top of
api-developer's already-shipped, already-tested contract — per that agent's own mandate ("built
on top of an existing API surface, never ahead of it"). No component-level Vitest tests are
named for the UI layer, matching this codebase's existing precedent (`kind-filter-tabs.tsx` and
`search-box.tsx` have no test files today) — qa's Phase 5 manual click-through is the verification
surface for the rendered chrome; Phase 4's gate is the ~28 tests above, all in the data layer
where the real risk (fiscal-year math, snippet correctness, merge priority, URL-param fallback)
actually lives.

---

# Phase 4 — Implementation

## Phase 4 (server slice) — api-developer — 2026-09-09

**Status:** complete

### Summary

Built the full server slice named in Phase 3: the four pure helpers in `minutes.ts`
(`extractSnippet`, `minutesSearchMatchFieldLabel`, `resolveYearParam`,
`nearestFiscalYearWithData`), and in `minutes-queries.ts` the `searchMinutes()`
three-query rewrite (title/body, motions, action items — merged and deduped in JS by
`minutes.id` with documented priority title > body > motion > action item), the `year`
filter on `MinutesMemberListFilters`/`listMinutesForMembers()`, and the new
`getMinutesFiscalYearCounts()`. All 28 named unit tests are written and passing, plus a
handful of additional structural-coverage tests preserving what the old single-query
`searchMinutes()` tests verified (kind scoping, soft-delete exclusion, escaping) that
would otherwise have been lost in the rewrite. No UI files touched.

### Files Modified

- `src/lib/minutes.ts` — added `MinutesSearchSnippet` type, `extractSnippet()`,
  `minutesSearchMatchFieldLabel()`, `resolveYearParam()`, `nearestFiscalYearWithData()`.
  Pure, no DB import — file's "importable without a database" contract preserved.
- `src/lib/minutes-queries.ts` — rewrote `searchMinutes()` as three independent queries
  (Query A: title/body, no join; Query B: motions, one join; Query C: action items, one
  join) run concurrently via `Promise.all` (still exactly 3 round trips, confirmed by a
  `selectCalls` counter added to the test harness) and merged in JS by
  `mergeMinutesSearchResults()`; `MinutesSearchRow` grew `matchField` and `snippet`;
  added `year?: number` to `MinutesMemberListFilters` and its `WHERE` (via `fyBounds()` +
  `gte`/`lt` on the `date`-typed `meetingDate` column — no `new Date()` parse); added
  `getMinutesFiscalYearCounts(kind?)` and its `MinutesFiscalYearCount` type — the one
  place in this feature that legitimately constructs a `Date` from `meetingDate`, and it
  uses `getFiscalYear(new Date(row.meetingDate + "T00:00:00"))` per the design's binding
  fix, never the bare form.
- `src/lib/minutes.test.ts` — added `describe` blocks for `extractSnippet` (6 tests),
  `minutesSearchMatchFieldLabel` (1 test), `resolveYearParam` (6 tests),
  `nearestFiscalYearWithData` (4 tests).
- `src/lib/minutes-queries.test.ts` — extended the mock-db harness with a `selectCalls`
  counter (increments on every `db.select()`/`db.selectDistinct()` invocation,
  independent of the existing `queue`/`wheres` tracking) so the "exactly 3 round trips,
  no N+1" claim is asserted structurally. Rewrote `describe("searchMinutes", ...)`
  entirely for the three-query shape (14 tests: blank query, call-count, soft-delete +
  no-attendance-reference, per-query field targeting, escaping, kind scoping, body-only,
  motion-only, action-item-only, body-beats-motion priority, title-only/no-snippet,
  dedup-with-no-N+1, sort order). Added `describe("listMinutesForMembers — year
  filter", ...)` (2 tests) and `describe("getMinutesFiscalYearCounts — fiscal-year
  boundary", ...)` (6 tests: Jun 30, Jul 1, New Year's Day, the UTC-vs-local regression
  guard via a forced `process.env.TZ = "Pacific/Midway"`, multi-row aggregation, kind
  scoping).

### Schema Changes

None. Confirmed by Phase 2/3: no index, no column, no migration for this feature.

### Test / Typecheck Results

- `pnpm exec tsc --noEmit`: PASS (clean, no errors)
- `pnpm test`: PASS — 101 files, 1926 tests (67 in the two files this slice touched,
  all new/rewritten ones included)
- No `console.log` in either modified file.

### Implementer Notes

- **`searchMinutes()`'s three queries run concurrently (`Promise.all`), not
  sequentially.** The Phase 3 design describes them as "three queries" without
  mandating sequential awaits; `getMinutesDetail()` elsewhere in this same file already
  uses `Promise.all` for its two child-row fetches, so this matches existing file
  convention. Still exactly 3 round trips — confirmed by the new `selectCalls` counter
  test — and the query order (A, B, C) is preserved because `Promise.all` invokes
  `.then()` on each element in array order, which the mock harness's FIFO queue relies
  on (same ordering guarantee the existing `getNextMeetingPointer` tests already lean
  on for its own `Promise.all`-free two-query sequence... actually that one already used
  sequential awaits before this change; only `getMinutesDetail` used `Promise.all`
  previously — noting this only because it's the one place a future reader might wonder
  whether concurrent execution could reorder queue consumption. It can't, for the reason
  above.)
- **Query B/C use `innerJoin`, not `leftJoin`.** The old single-query `searchMinutes()`
  used `leftJoin` twice (because it needed every `minutes` row regardless of whether a
  motion/action-item existed, to also catch title/body matches in the same pass).
  Splitting into three queries removes that requirement — Query B/C only exist to find
  rows with a *matching* child, so `innerJoin` is the correct, simpler join for them.
  Functionally equivalent to a `leftJoin` here anyway (a `leftJoin` with a null child row
  would fail the `ilike(null, ...)` condition and be filtered by the same `WHERE`), but
  `innerJoin` says what's actually true.
- **Defensive fallback added beyond the four named per-row resolvers**: Phase 3 "Edge
  Cases" names a fallback for "`extractSnippet()` disagreeing with Postgres `ILIKE`'s
  match" (collation mismatch) — implemented as `fallbackSnippet()`, a plain unwindowed
  `text.slice(0, 120)` with `matchLength: 0`, used only when `extractSnippet()` returns
  `null` for every candidate field despite the SQL `WHERE` having matched the row. Not
  separately unit-tested (the design didn't name a test for it, and it's not reachable
  through this club's English-language content in practice) — flagged here in case a
  future qa pass wants to add one.
- **`resolveYearParam()`'s `isAll: true` branch still returns a `year` field** (set to
  `currentFY`) because the design's type signature (`{ year: number; isAll: boolean }`)
  has no optional `year`. Callers must branch on `isAll` first and treat `year` as
  meaningless when `isAll` is true — documented in the function's own doc comment.
- **No divergence from the Phase 3 design.** Every named function signature, the merge
  priority order, the `T00:00:00` fix, and the `fyBounds`/`gte`/`lt` year-filter shape
  match the design as written.

## Phase 4 (client slice) — ux-developer — 2026-09-09

**Status:** complete

### Summary

Built the full UI slice on top of api-developer's already-shipped, already-tested
contract: a new `YearFilterPills` Server Component, `year` threaded as inert preserved
state through `KindFilterTabs`/`SearchBox`, and a rewrite of `/members/records`' list
region into two visually distinct branches — a plain browse list and a "Results for…"
search view with a count, a Clear-search control, and per-result matched-field labels
plus highlighted excerpts. No `'use client'` anywhere in this feature; no new
dependency.

### What I did

- Built `YearFilterPills` mirroring `KindFilterTabs` exactly: a `<nav>` of `<Link>`s from
  `URLSearchParams`, zero client JS. Pills read `"2025-26 · 22"` via a small exported
  `shortFyLabel()`, plus a leading `"All years · {totalCount}"` pill. The pill set is
  `{currentFY} ∪ counts.map(fiscalYear)`, deduped/sorted desc, so the current FY always
  renders its own pill even at zero records (decision #1).
- Threaded `year` through `KindFilterTabs` and `SearchBox` as **raw, unvalidated
  passthrough** — the same treatment `kind`/`q` already get from each other — rather than
  resolving/normalizing it before handing it to those components. `resolveYearParam()` is
  the single place validity is decided, and only on the next page load in browse mode;
  carrying a stale/garbage `year` string through a kind switch or a search is harmless
  because it re-falls-back cleanly.
- Rewrote `page.tsx`'s data-fetching to branch on `query` before touching year state at
  all: the search branch never fetches `getMinutesFiscalYearCounts()` (a round trip the
  search view has no use for, per Phase 3), the browse branch fetches counts first, unions
  `currentFY` into `knownYears` itself (the documented split — the query layer
  deliberately doesn't do this), then calls `resolveYearParam()` before
  `listMinutesForMembers()`.
- Split the list region into two non-shared render paths gated on `query`, per the
  headline defect (see below) — `YearFilterPills` renders only in the browse path.
- Wired the near-empty-state "nearest year with data" link using
  `nearestFiscalYearWithData()`, deliberately called with the **raw counts-derived years**
  (not the `currentFY`-unioned set) so it still returns `null` — and therefore falls back
  to today's unchanged "No meeting minutes have been posted yet." — when a kind truly has
  zero minutes ever, rather than always finding "itself" as the nearest year once
  `currentFY` was unioned in for a different purpose.
- Built `renderSnippet()` following `renderHighlightedLabel()`'s exact pattern from
  `admin-sidebar.tsx` — `excerpt.slice()` three ways around `<mark>`, never
  `dangerouslySetInnerHTML`.

### How the search view is now unmistakably a search view

This was the user's headline complaint ("I couldn't tell it was search results") and the
literal defect named in Phase 1. Concretely, today's rewrite makes search and browse
render through **entirely separate JSX branches**, not shared markup with a conditional
tweak:

- A `<h2>Results for "term"</h2>` heading plus a `"{N} result(s)"` count line — neither
  exists in browse mode.
- A `Clear search` link (blue, `hover:text-lions-blue-dark`) that drops `q` while
  preserving `kind` and the raw `year` — nothing equivalent exists in browse mode; there
  is nothing to clear.
- `YearFilterPills` disappears entirely while a search is active (Phase 3 decision 1) —
  rather than rendering inert-looking clickable pills next to a heading they don't scope,
  the whole row is absent. A member scanning the page sees fewer controls, not
  same-looking-but-broken ones.
- Each search result that matched outside the title gets a second content block below the
  existing title/date/badges row: a small blue uppercase "Matched in {Minutes text |
  Motion | Action item}" label, then the highlighted excerpt with the matched span in a
  `<mark>` (gold background, `bg-lions-gold/40`). Browse-mode rows never have this block —
  there's nothing to excerpt when nothing was searched. A title match renders with none of
  this (Phase 3 "Title matches" — the title's already the full visible headline).
- The empty-state copy itself differs by mode: search's unchanged
  `No minutes match "term".` vs. browse's new `No {kind} minutes recorded yet for
  {year}.` plus a `View {nearest year} instead →` link.

Net effect: a member can tell which mode they're in from the page chrome alone even with
the list scrolled off-screen — the heading/count/Clear-search cluster (or its total
absence) is the tell, exactly as Phase 1 asked for.

### 360px behavior

Per Phase 3's explicit design ("keeps `YearFilterPills` on its own row below
`KindFilterTabs`/`SearchBox`... to give ux-developer room to wrap it independently"), the
three controls are three separate flex containers, not one crowded row:

- `KindFilterTabs` + `SearchBox` sit in a `flex flex-col gap-3 sm:flex-row` container —
  stacked full-width at 360px, side-by-side from `sm:` up. `KindFilterTabs` itself already
  wraps (`flex flex-wrap gap-2`) if its 2-3 tabs ever need a second line.
  `SearchBox` is full-width in the stacked layout.
- `YearFilterPills` renders in its own `<div>` below that container (browse mode only),
  also `flex flex-wrap gap-2` — its pills (up to 5: All years + up to 4 fiscal years today)
  wrap onto additional lines at narrow widths rather than compressing or overflowing.
- Every pill/tab keeps its 44px tap target: `KindFilterTabs`' existing `min-h-[44px]`,
  `YearFilterPills`' `py-3` (per CLAUDE.md's "chips still need a 44px tap height" rule —
  `rounded-full` is correct for pills, not a `rounded-lg` violation).

No single row ever has to fit kind tabs + year pills + search box simultaneously, which is
what the Phase 1 gap flagged as the overflow risk.

### Files Created

- `src/components/minutes/year-filter-pills.tsx` — new. `YearFilterPills` Server
  Component + exported `shortFyLabel()` helper (exported, not module-private, because
  `page.tsx` reuses the identical short-year format for the nearest-year empty-state link
  — one definition, not a second copy).

### Files Modified

- `src/components/minutes/kind-filter-tabs.tsx` — added `year?: string` prop, threaded
  into every tab's `href()` as raw passthrough alongside `kind`/`query`.
- `src/components/minutes/search-box.tsx` — added `year?: string` prop, rendered as a
  second `<input type="hidden">` alongside the existing `kind` field.
- `src/app/members/records/page.tsx` — `searchParams` type grew `year?: string`;
  data-fetching branches on `query` before any year resolution; browse-vs-search chrome is
  now two distinct render paths (see above); new `recordsHref()` and `clearSearchHref()`
  page-local URL builders; new `renderSnippet()` highlight renderer; `pointers` state
  properly typed against `NextMeetingPointerData`/`MostRecentApprovedMinutes` (no `any`).

### Gate Check Results

- `pnpm exec tsc --noEmit`: PASS (clean, no errors)
- `pnpm test`: PASS — 101 files, 1926 tests (unchanged count — no new UI test files, per
  Phase 3's stated precedent that `kind-filter-tabs.tsx`/`search-box.tsx` carry no test
  files today; qa's Phase 5 manual click-through is the verification surface for this
  slice)
- `pnpm build:only`: PASS — `/members/records` builds as a dynamic (`ƒ`) route, no
  build-time errors or warnings touching any file in this slice
- No `console.log` in any modified/created file (grep-verified)
- `/members/records` confirmed still ungated: no `hasFeature`/`FEATURES` reference
  anywhere in `page.tsx`; only `auth()` + inline `memberId` check, matching DECISION-077
  §6
- `pnpm lint`: **could not run** — pre-existing environment failure unrelated to this
  slice (`ESLint: minimatch` ESM/CJS interop `SyntaxError` inside
  `node_modules/@eslint/eslintrc`, thrown before any file is linted). Not caused by any
  file touched in this feature; flagging for deployment-engineer's dependency review
  rather than treating it as a gate failure here.

### Open questions / handoff notes for qa

- **Click-through path:** `/members/records` as a linked member. Confirm (1) the current
  FY pill is selected by default and reads a small count (2 for FY2026-27 per the work-log
  narrative), (2) clicking an older year pill (e.g. `2025-26 · 22`) re-scopes the list and
  updates the active pill, (3) combining a kind tab with a year pill narrows correctly and
  the pill counts themselves change to reflect the kind (e.g. Board-only counts), (4)
  searching a term shows the "Results for…" heading + count + Clear search, with
  `YearFilterPills` gone from the page, (5) Clear search returns to the year/kind that was
  active before searching, (6) a non-title search hit shows the "Matched in…" label and a
  highlighted excerpt; a title-only hit shows neither, (7) landing on an empty current-FY
  (or navigating to one, e.g. via a stale bookmark) shows the nearest-year link and it
  goes to the right place.
- **New copy strings the Lions Club may want to refine:** `"Results for "{query}""`,
  `"{N} result(s)"`, `"Clear search"`, `"Matched in {field}"` labels ("Minutes text" /
  "Motion" / "Action item"), `"No {kind} minutes recorded yet for {year}."`, `"View {year}
  instead →"`, `"Showing {N} of {total} record(s)"`, `"All years · {N}"` pill text.
- **UX decision worth flagging:** `year` is carried as **raw, unvalidated** passthrough
  through `KindFilterTabs`/`SearchBox` rather than a normalized value — a deliberate
  simplification matching how `kind`/`q` already behave (neither is validated before
  being handed to the sibling component either). A hand-edited `?year=banana` will ride
  along through a kind switch or search until the member returns to browse mode, where
  `resolveYearParam()` silently falls back. No user-visible bug results (verified in the
  `resolveYearParam` unit tests already delivered by api-developer), but it's worth qa
  clicking through deliberately rather than assuming.
- **`pnpm lint` is broken in this environment** independent of this feature (see Gate
  Check Results) — qa should not treat a lint failure as this slice's regression; it
  reproduces on a clean checkout before any file here was touched.
- Next: **qa** for Phase 5 verification.

### Handoff Contract for ux-developer

**`src/lib/minutes.ts`** (pure, no DB — safe to import from a Server Component):

```ts
export interface MinutesSearchSnippet {
  excerpt: string;      // windowed, ellipsized — never the full field value
  matchStart: number;   // offset into `excerpt`, start of matched span
  matchLength: number;
}

export function extractSnippet(text: string, term: string, windowSize?: number): MinutesSearchSnippet | null;

export function minutesSearchMatchFieldLabel(field: "body" | "motion" | "action_item"): string;
// "body" -> "Minutes text", "motion" -> "Motion", "action_item" -> "Action item"
// NOTE: "title" is not a valid input — a title match renders no label at all.

export function resolveYearParam(
  raw: string | undefined,
  knownYears: number[],
  currentFY: number,
): { year: number; isAll: boolean };
// raw undefined -> { year: currentFY, isAll: false }
// raw "all" -> { year: currentFY, isAll: true } — treat `year` as meaningless when isAll is true
// raw numeric === currentFY, or numeric AND in knownYears -> that year, isAll: false
// anything else (non-numeric, or a well-formed but unknown year) -> falls back to the default

export function nearestFiscalYearWithData(target: number, candidates: number[]): number | null;
// null only when candidates is empty
```

**`src/lib/minutes-queries.ts`** (DB-facing):

```ts
export type MinutesSearchMatchField = "title" | "body" | "motion" | "action_item";

export interface MinutesSearchRow {
  id: string;
  kind: string;
  meetingDate: string;
  status: string;
  title: string | null;
  matchField: MinutesSearchMatchField;
  snippet: MinutesSearchSnippet | null; // null exactly when matchField === "title"
}

// Unchanged public signature. Still ignores `year` — search spans all years by design.
export async function searchMinutes(query: string, kind?: string): Promise<MinutesSearchRow[]>;

export interface MinutesMemberListFilters {
  kind?: string;
  year?: number; // omitted = no year filter (all years)
}
export async function listMinutesForMembers(filters?: MinutesMemberListFilters): Promise<MinutesSummaryRow[]>;
// (MinutesSummaryRow return shape is unchanged from before this feature)

export interface MinutesFiscalYearCount {
  fiscalYear: number;
  count: number;
}
export async function getMinutesFiscalYearCounts(kind?: string): Promise<MinutesFiscalYearCount[]>;
// One row per fiscal year that has >=1 record for the given kind (or all kinds if
// omitted). Does NOT force-include the current FY if it has zero records — the PAGE
// must union `currentFY` in itself before deriving `knownYears` for
// resolveYearParam()/YearFilterPills, per decision #1 ("always renders, data or not").
// Sorted descending by fiscalYear.
```

**Auth/permission note (unchanged, confirmed by design):** none of this is gated —
`/members/records` stays ungated per DECISION-077 §6. `?year=` is pure post-auth data
filtering; it never touches `session.user.features`.

### Open questions / handoff notes for ux-developer

- Build `src/components/minutes/year-filter-pills.tsx`, thread the `year` prop through
  `kind-filter-tabs.tsx` and `search-box.tsx`, and rewrite `src/app/members/records/page.tsx`
  per Phase 3's Component/Page Plan — all untouched by this slice, as instructed.
- Remember to union `currentFY` into `knownYears` yourself before calling
  `resolveYearParam()` — `getMinutesFiscalYearCounts()` does NOT do this (see the
  contract note above); this is a deliberate split, not an oversight.
- `page.tsx`'s `!query` branch needs `counts = await getMinutesFiscalYearCounts(kind)`
  fetched BEFORE calling `resolveYearParam()`/`listMinutesForMembers()`, since
  `knownYears` (derived from `counts`) is an input to `resolveYearParam()`.
- The `query` branch should NOT fetch counts at all (Phase 3: "saves a round trip the
  search view has no use for") — `searchMinutes()` doesn't take `year`.
- Snippet rendering: `matchField !== "title"` is the gate for showing a
  "matched in {minutesSearchMatchFieldLabel(matchField)}" label + highlighted excerpt.
  A title match (`matchField === "title"`, `snippet === null`) renders like a plain
  browse row — no label, no excerpt.

---

# Phase 5 — Verification (qa)

**Date:** 2026-09-09
**Verified by:** qa

## Summary

**Verdict: FAIL.** Every automated gate is clean (typecheck, 1926 Vitest tests, production
build, 20/21 new Playwright assertions) and every flow named in the Phase 4 handoff behaves
exactly as designed — year pills, kind-scoped counts, the browse/search chrome split, snippet
labeling and highlighting, the ILIKE-wildcard-is-literal guarantee, URL-state fallback rules,
back/forward, 360px layout, and the ungated-for-any-member access story all check out against a
real signed-in member and real fixture data. But one genuine, reproducible defect blocks sign-off:
the "nearest year with data" empty-state link renders its words glued together — **"View
2025-26instead →"** instead of "View 2025-26 instead →" — confirmed in the raw
server-rendered HTML itself (not a browser/hydration artifact). This is exactly the class of bug
the codebase's own `{" "}` JSX-whitespace idiom exists to prevent, and this same file already
uses that idiom correctly one paragraph above (the "…minutes recorded yet for{" "}" line) — this
one link was missed. Routing back to **ux-developer** (Phase 4) for a one-line fix, then back to
qa to flip the new regression test green.

## What I did

- Read the full work-log (Phases 1–4) before touching anything.
- Ran the three automated gates myself from a clean shell: `pnpm exec tsc --noEmit`, `pnpm test`,
  `pnpm build:only`.
- Read every file this feature touched or added end to end (`src/lib/minutes.ts`,
  `src/lib/minutes-queries.ts`, `src/app/members/records/page.tsx`,
  `src/components/minutes/year-filter-pills.tsx`, `kind-filter-tabs.tsx`, `search-box.tsx`) —
  not just the diff summary — to audit against CLAUDE.md's UX/invariant rules directly, rather
  than inferring compliance from passing tests.
- Checked what the **dev** database (the one `.env.local`'s `DATABASE_URL` points at, `neondb`
  on Neon host `ep-orange-sunset-am8erati-pooler`) actually contains before asserting anything
  about record counts: **1 minutes row** (kind=board, 2026-08-07), not the 49 the work-log
  narrative describes. Per the qa brief, that 49-row count is production-only data; this dev DB
  is the user's own and safe to write disposable fixtures into (per project memory
  `feedback_local_db_is_neon`).
- Wrote a new, purpose-built Playwright suite,
  `e2e/minutes-year-pills-and-search-context.spec.ts` (21 tests), because the dev DB's real
  content couldn't exercise the matrix this feature needs verified (multiple fiscal years, a
  body match, a motion match, an action-item match, a title-only match, an ILIKE-wildcard term).
  The suite creates 6 disposable fixture minutes records (spanning FY2023–FY2025, deliberately
  **none** in the current FY for `kind=general`, to force the true "current-year-lands-empty"
  path) plus one disposable linked member+user bound to **only** the base `member` role, signs
  in as that member for real through `/signin`, and cleans up everything in `afterAll` — verified
  by direct `psql` query after both a clean run and a failing run (0 residual rows either way).
  "Expected" counts are computed from the **actual pre-fixture DB state** (queried independently,
  via plain date-string slicing — never by calling the app's own
  `getFiscalYear()`/`getMinutesFiscalYearCounts()`, which would make the assertions
  tautological), so the suite is robust to whatever the target database already holds, not
  dependent on a clean table.
- Ran the existing `e2e/minutes-present-count-round-trip.spec.ts` (the admin-side minutes suite,
  which shares the same `minutes`/`minutesMotions`/`minutesActionItems` tables and the rewritten
  `searchMinutes()`'s neighborhood) to confirm this feature's query-layer rewrite didn't regress
  admin create/edit/present-count behavior — 5/5 passed, unchanged.
- Investigated one Playwright failure down to the byte level (Playwright accessible-name check →
  `el.outerHTML` → `el.textContent` via `JSON.stringify` → a raw `fetch()` of the
  server-rendered HTML using the session cookie, bypassing the browser entirely) to rule out a
  test-tooling artifact before calling it a real product defect. Also `od -c`'d the exact byte
  sequence of the source `.tsx` line in question to confirm the space really is present in the
  source and is being lost somewhere in Next.js/Turbopack's JSX-to-HTML pipeline for that
  specific line, not miswritten by the implementer.
- Audited every changed/created file for `console.log`/`console.warn`/`console.error`, native
  browser dialogs (`window.confirm`/`alert`/`prompt`), `lions-red`, and `rounded-xl` — none
  found (grep-verified).
- Read `src/proxy.ts` directly (not inferred from a passing test) to verify the "ungated" claim
  in the Phase 3 Permissions section: `/^\/members/` **does** require `FEATURES.MEMBERS_VIEW` at
  the proxy layer — the "ungated" claim is specifically that `page.tsx` adds no gate **beyond**
  that generic rule, and `MEMBERS_VIEW` is granted to the base `member` role by
  `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql` (line ~254), so any ordinary
  linked member reaches this page. Confirmed empirically too: the e2e fixture user is bound to
  **only** the base `member` role (no `admin.dashboard`, no board features) and reached every
  year/kind/search combination across all 21 tests.

## Outputs

- `e2e/minutes-year-pills-and-search-context.spec.ts` (new, 21 tests) — the click-through
  vehicle for this Phase 5 pass and the permanent regression suite for this feature going
  forward. Left in the repo with the real bug's test **active** (not skipped) per the
  "regression test before the fix" discipline — it currently fails, honestly, against
  unfixed code.
- No other files modified. This is a verification-only phase; the FAIL below routes back to
  Phase 4, not a Phase 5 code change.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no errors.

## Unit Tests

`pnpm test`: **PASS**
Total: 1926 | Passed: 1926 | Failed: 0
Duration: ~2.0s (test execution; ~14s wall including transform/import)
Files: 101, all passed, including the 67 new/rewritten tests in `minutes.test.ts` and
`minutes-queries.test.ts` api-developer added for this feature (fiscal-year boundary math,
`extractSnippet()`, `resolveYearParam()`, `nearestFiscalYearWithData()`, the three-query
`searchMinutes()` merge, the `year` filter on `listMinutesForMembers()`).
Failures: none.

## Production Build

`pnpm build:only`: **PASS**
Notes: 124 routes generated (`Generating static pages using 15 workers (124/124)`), no
warnings or errors in the build log. `/members/records` builds as `ƒ` (dynamic, server-rendered
on demand) as expected for a `searchParams`-driven page with `export const dynamic =
"force-dynamic"`.

## End-to-End Tests

`pnpm test:e2e` (this feature's new spec, run directly against a locally started `pnpm dev`):
**FAIL** (1 of 21 new tests fails; the failure is a real product defect, not a test bug)
Total: 21 | Passed: 20 | Failed: 1 | Duration: ~26–32s per full run

Failures:
- `minutes-year-pills-and-search-context.spec.ts:374` — "the nearest-year-with-data empty state
  appears when the CURRENT fiscal year has zero rows for the active kind, and its link lands on
  real data" — see **Defect** below.

Also ran `e2e/minutes-present-count-round-trip.spec.ts` (pre-existing, admin-side, shares the
`minutes` tables and neighbors the rewritten `searchMinutes()`): 5/5 passed, no regression from
this feature's query-layer rewrite.

Database observed: the **dev** Neon database at `.env.local`'s `DATABASE_URL`
(`neondb` on `ep-orange-sunset-am8erati-pooler.c-5.us-east-1.aws.neon.tech`) — confirmed via
direct `psql` query to hold exactly 1 pre-existing minutes row before fixture insertion. All
counts asserted in the new suite are computed relative to that observed baseline, not hardcoded
against an assumed-clean table.

## Defect — FAIL, routed to ux-developer (Phase 4 loop-back)

**"View {year} instead →" renders as "View {year}instead →" — the year and "instead" are glued
together with no space, in real server-rendered HTML.**

- **File:** `src/app/members/records/page.tsx`, line 390 (inside the browse-mode
  "nearest-year-with-data" empty state).
- **Source (confirmed correct via `od -c`, so this is not a typo in the file):**
  `View {shortFyLabel(nearestYear)} instead &rarr;` — there IS a literal space (0x20) between
  `}` and `instead` in the `.tsx` source.
- **Rendered (confirmed via three independent checks, ruling out a Playwright accessible-name
  normalization artifact):**
  - `el.outerHTML` on the real link in a real Chromium page:
    `<a ...>View <!-- -->2025-26<!-- -->instead →</a>`
  - `el.textContent` via `JSON.stringify`: `"View 2025-26instead →"` (no space — this is the
    literal DOM string, not a display/rendering illusion).
  - A raw `fetch()` of the server-rendered HTML (using the signed-in session cookie, entirely
    outside the browser/hydration path): `...>View <!-- -->2025-26<!-- -->instead →</a>` — the
    glued text is already present in the HTML Next.js sends over the wire, so this is not a
    client-side hydration bug either.
- **Reproduction:** Sign in as any linked member with no minutes recorded for a `kind` in the
  current Lions fiscal year (e.g. a fresh Jul–Sep window before that year's first meeting is
  entered, or — as in this suite's fixture — a kind with older data but nothing yet this year).
  Visit `/members/records?kind=general` (or whichever kind is empty for the current year). The
  empty-state paragraph reads correctly ("No General minutes recorded yet for 2026-27."), but
  the link beneath it reads "View 2025-26instead →" with the year and "instead" run together.
- **Why this matters:** this is the exact "nearest year with data" affordance the Phase 1
  analyst called load-bearing under the new Lions-year default ("the current FY lands empty for
  roughly a quarter of every year by construction") — it's the one-click path off a page that
  otherwise looks broken. Shipping it with glued text is a real, visible defect for both sighted
  users and screen readers (the DOM text itself is glued, not just a CSS/whitespace-collapse
  display quirk).
- **Suggested fix:** the codebase has an established idiom for exactly this JSX-whitespace class
  of bug — `{" "}` — used 139 times elsewhere and already used correctly by this SAME file one
  paragraph above (`minutes recorded yet for{" "}` / `{isAllYears ? "any year" :
  shortFyLabel(resolvedYear)}.`). The simplest, most robust fix is likely to collapse the whole
  link body into a single template-literal expression (`{`View ${shortFyLabel(nearestYear)}
  instead →`}`), which sidesteps JSX text-node whitespace handling entirely rather than relying
  on getting the `{" "}` placement exactly right a second time. Root cause in the Turbopack/SWC
  JSX-text compilation itself was not chased down (out of scope for this phase, and not needed —
  the established idiom is a known, reliable workaround already proven elsewhere in this exact
  file); worth a codebase-wide grep for the same "TEXT {expr} TEXT" single-line pattern (without
  `{" "}`) as a follow-up **code review** item, since the risk pattern is now confirmed real in
  this build, not just theoretical.
- **Regression test:** `e2e/minutes-year-pills-and-search-context.spec.ts:374` — asserts the
  exact, correctly-spaced link text (`View ${shortFy(nearest)} instead →`), not a
  whitespace-tolerant regex, specifically so this test stays red until the glued-text bug is
  fixed and goes green the moment it is. Left active (not skipped) in the committed suite per
  the "write the failing test before the fix" discipline.

## Manual Click-Through

All driven live through a real signed-in member session against `pnpm dev`
(`http://localhost:3000`), using the new e2e suite as the click-through vehicle (each row below
is one of its 21 assertions unless noted). Database: dev Neon (see above).

| Flow | Result | Notes |
|------|--------|-------|
| Default arrival, no query params → current Lions year selected | pass | Pill for the current FY is active and its printed count matches "Showing N of M". Near-empty (dev DB has only 1 baseline record) but comprehensible — not a bare blank list. |
| Nearest-year-with-data empty state appears + link works | **FAIL** | See Defect above — empty-state message is correct, link text is glued. |
| Old (non-current) year with zero rows for the active kind | pass | Confirmed this silently falls back to the current FY per the documented URL-state contract, rather than rendering an empty state — distinct code path from the current-FY-is-empty case, and both are now covered. |
| Each year pill, incl. "All years" — per-pill counts match rows listed | pass | Verified for FY2023/2024/2025 and "All years" against dynamically-computed expected counts (baseline + fixtures). |
| Counts respect the active kind filter | pass | Same FY2024 view: switching Board → General changed both the visible rows AND the active pill's own printed count (1 → 2), not just the list. |
| Year + kind composed, then search on top | pass | `?year=2024&kind=general` then submitting a search preserved `kind`, carried `year` as inert state, and the search view ignored `year` entirely per design. |
| Search: heading, count, Clear search, year pills hidden, kind tabs visible | pass | `YearFilterPills` nav is entirely absent from the DOM while `q` is set; `KindFilterTabs` nav remains. |
| Snippet: body match | pass | "Matched in Minutes text" label + `<mark>` around the term. |
| Snippet: motion match | pass | "Matched in Motion" label + highlighted term inside the motion text. |
| Snippet: action-item match | pass | "Matched in Action item" label + highlighted term. |
| Snippet: title-only match | pass | No "Matched in" label, no `<mark>` at all — confirmed by design (title is already the visible headline). |
| ILIKE-wildcard term (`%`, `_`) treated literally | pass | Searching `qapills50%_off<runid>` returned exactly the one fixture record containing that literal string, not every row (which is what a live, unescaped `%`/`_` would have matched). |
| Zero-result search | pass | "0 results" + `No minutes match "term".` (curly-quote entities render correctly). |
| Clear search restores prior year/kind | pass | Set `year=2024&kind=general`, searched, cleared — landed back on `year=2024&kind=general`, not the default. |
| Deep-linking + browser back/forward across `?year=` | pass | `goBack()`/`goForward()` both restored the correct active pill and URL — plain `<Link>`s, real browser history, no client JS involved. |
| `?year=` garbage (`banana`) | pass | HTTP 200, falls back to current FY, no phantom-selected pill. |
| `?year=` well-formed but dataless (`1900`) | pass | Same fallback as garbage — both failure cases handled identically, per design. |
| `?year=` absent | pass | Covered by the default-landing test above. |
| 360px mobile — no horizontal overflow, 44px tap targets | pass | `document.documentElement.scrollWidth === clientWidth` (0px overflow); every kind-tab/year-pill link's bounding-box height ≥ 43px. |
| Page stays ungated; `?year=` cannot widen access | pass | Fixture member bound to ONLY the base `member` role (no admin/board features) reached every year/kind/search combination across all 21 tests. Unauthenticated request to `/members/records?year=2024` redirects to `/signin`. |
| No `console.log`, no native dialogs, brand colors only, `rounded-2xl` cards, focus rings | pass | Grep-audited every changed/created file directly — zero hits for `console.*`, `window.confirm/alert/prompt`, `lions-red`, `rounded-xl`. Every new `<Link>`/button carries `focus:outline-none focus:ring-2 focus:ring-lions-blue`. |

### Manual click-through the runner could reach directly (no browser tool needed beyond Playwright)

Every flow in the qa brief's list was reachable through the Playwright suite above — nothing in
this feature touches Google OAuth, Givebutter, Resend, or live Google Workspace sync, so no
flow required a human-driven manual pass this round.

## Regression Tests Added

- `e2e/minutes-year-pills-and-search-context.spec.ts:374` — "the nearest-year-with-data empty
  state appears when the CURRENT fiscal year has zero rows for the active kind, and its link
  lands on real data" — guards against: the glued "View {year}instead →" text defect found in
  this phase (see Defect above). Currently failing, by design, until the implementer fixes it.
- The remaining 20 tests in the same file are new coverage, not fixes for a prior bug, but are
  written with the same "assert exact behavior, not a loose regex" discipline so any future
  regression in year-pill counting, kind-scoping, search-mode chrome, snippet field priority,
  the ILIKE-escaping/JS-substring-search split, or the URL-state fallback contract will be
  caught here rather than discovered in production.

## Coverage on Critical Modules

Not separately re-measured with `--coverage` this round (the qa brief's named targets —
`events.ts`, `permissions.ts`, `members.ts` — are untouched by this feature). For the modules
this feature DID touch: api-developer's Phase 4 report lists 28 named unit tests plus additional
structural-coverage tests for `minutes.ts`/`minutes-queries.ts`, all passing (confirmed above,
`pnpm test`: 1926/1926). No component-level Vitest tests exist for
`year-filter-pills.tsx`/`kind-filter-tabs.tsx`/`search-box.tsx`, matching this codebase's
existing precedent for these files (Phase 3 named this explicitly, with the e2e suite as the
verification surface for rendered chrome — now delivered).

## Feature-Gate Audit (mandatory before PASS)

**No protected routes or server actions were added or changed by this feature.** This is a
`searchParams`-driven Server Component page reading through existing query-layer functions — no
new `/api/admin/**` or `/api/<protected>/**` route, no new `"use server"` action.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /members/records` (page, unchanged gate from before this feature) | yes (`page.tsx` calls `auth()` directly) | no — by design | N/A — DECISION-077 §6: this page is deliberately ungated beyond the generic proxy rule below |
| `src/proxy.ts` generic `/^\/members/` rule (not new; pre-existing, applies to this page like every `/members/*` route) | yes | yes | `FEATURES.MEMBERS_VIEW` — granted to the base `member` role by `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql`, so every ordinary linked member has it. Confirmed by reading `src/proxy.ts` directly (not inferred from passing tests) and empirically, via an e2e fixture user bound to ONLY the base `member` role reaching every year/kind/search combination. |

`?year=` is pure post-auth `searchParams` state read inside the page body, after both gates
above have already run; it never touches `session.user.features` and cannot widen access —
confirmed by reading `page.tsx` (the `memberId` null-check short-circuits every minutes query,
including the new counts query, before `?year=`/`?kind=`/`?q=` are ever consulted) and by the
e2e "unauthenticated redirect" and "base-role-only member" tests above.

## Verdict

**FAIL** — one real defect (see Defect above). Everything else — typecheck, unit tests,
production build, and 20 of 21 new end-to-end assertions — is clean. This is a one-line JSX fix,
not a design problem; no escalation to Phase 3 is warranted.


---

## Phase 4 loop-back fix + Phase 5 re-verification (coordinator, 2026-09-09)

**Fixed.** `src/app/members/records/page.tsx` — the nearest-year link body is now a single
template-literal expression (`{`View ${shortFyLabel(nearestYear)} instead →`}`) instead of the
`View {expr} instead` adjacent-text-node form. This removes the text-node boundary entirely
rather than depending on `{" "}` placement.

**Re-verified:** `pnpm exec tsc --noEmit` clean; the full 21-test suite
`e2e/minutes-year-pills-and-search-context.spec.ts` now passes **21/21** against a live
`pnpm dev` and the dev Neon database (`ep-orange-sunset-am8erati-pooler`) — including
`:374`, the regression test qa deliberately left red. Phase 5's FAIL is cleared.

### Correction to Phase 5's root-cause analysis — do NOT action its follow-up as written

Phase 5 concluded that "something in the Turbopack/SWC JSX pipeline drops the space for this
specific line" and recommended a codebase-wide grep for the `TEXT {expr} TEXT` single-line
pattern as a code-review follow-up. **That generalization is disproven, and the sweep is not
justified on this evidence.** `page.tsx:374` — in the *same file*, same build, same render pass —
is `Showing {browseRows.length} of {totalCount} record{...}`, the identical pattern, and Phase 5's
own click-through table records it rendering correctly as "Showing N of M". The pattern is used
widely elsewhere too (`about/page.tsx:179`, `members/dues/page.tsx:197`,
`admin/dues/page.tsx:289`, `admin/users/page.tsx:343`). If the compiler dropped these spaces,
"Showing 14of 49records" would be visible across the admin portal. It is not.

**What is actually established, and what is not:**

- ESTABLISHED: the source line carried a real `0x20` between `}` and `instead` (independently
  confirmed by `od -c`, twice — by qa and by the coordinator).
- ESTABLISHED: the served HTML glued the words (qa confirmed three ways, including a raw
  `fetch()` of the server response outside the browser, so not a hydration artifact).
- ESTABLISHED: collapsing to one expression fixes it, verified by the regression test flipping
  green.
- **NOT established: why.** The blanket compiler-bug theory is contradicted by line 374. The
  specific trigger for this one line remains unexplained. It is deliberately left that way in
  this record rather than replaced with a second guess.

Anyone revisiting this should start from that unexplained gap, not from a repo-wide whitespace
hunt. The fix is safe and verified regardless of the cause.

**Process note:** this one-line fix was applied by the coordinator inline rather than by
re-spawning ux-developer, per CLAUDE.md Workflow Rule 9 ("trivial single-step actions ... may
stay inline"). The substantive Phase 4 work remains ux-developer's; this is recorded here so the
loop-back is not invisible.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-09-09
**Owner:** analyst
**Status:** complete

## Summary

I re-read my own Phase 1 review, re-read Phases 2–5 and the coordinator's loop-back note, and
walked the shipped code (`src/app/members/records/page.tsx`,
`src/components/minutes/year-filter-pills.tsx`) directly against both — not just against qa's
click-through table — to check the one item qa's discipline can verify but can't fully judge:
whether the agreed mitigations for the sparse Lions-year default actually read as comprehensible
to a member, not merely "present." They do. All three of the user's original asks are delivered
as described in Phase 1, the one real defect qa found is fixed and re-verified (21/21), and the
items still open (true pagination at higher volume, `/admin/minutes`, data-quality caveats in the
underlying minutes content) were knowingly scoped out in Phase 1 with the user's confirmation, not
silently dropped. **Verdict: SHIP IT.**

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The 49-record wall at `/members/records` is now a Lions-year-chunked browse experience with a
> visibly distinct, contextualized search mode — all three things the club president asked for
> are there, the one QA-caught defect is fixed and reproducibly verified, and the riskiest design
> choice (defaulting to a frequently-sparse current year) ships with real, working context rather
> than a bare "no results."

## What's Working

- **The sparse-default mitigation is real, not decorative.** I read the rendered branch directly
  (`page.tsx` lines ~371–401): when `totalCount > 0`, the "Showing {browseRows.length} of
  {totalCount} record(s)" line renders *above* the list or empty-state box regardless of whether
  the current year has 0, 2, or 22 rows — so a member landing on FY2026-27 with 2 records sees
  "Showing 2 of 49 records" in the same breath as the pill row showing `2026-27 · 2`,
  `2025-26 · 22`, `2024-25 · 24`, `2023-24 · 1`, `All years · 49`. That is three independent,
  consistent signals (the count line, the per-pill counts, and — when the bucket is fully empty —
  the "View {year} instead →" link) all telling the same story: more data exists, one click away.
  This is exactly the mock the user was shown and accepted eyes-open in the resolved Open Question
  — and having read the code rather than trusted the description, I agree it lands as intended
  rather than as a trap.
- **The browse/search chrome split is unmistakable, and I mean that literally — I read both JSX
  branches.** They share zero markup: search renders `Results for "term"` / a result count / a
  `Clear search` link, and `YearFilterPills` is absent from the DOM entirely (confirmed by qa's
  DOM check, consistent with the source). Browse renders none of that. This is the literal fix for
  the user's "I could NOT tell it was search results," and it's the strongest part of the ship —
  a member scanning the page has three separate cues, not one subtle one.
- **The fix for the QA-caught defect is structurally sound, not a patch.** Collapsing `View {expr}
  instead →` into one template-literal expression removes the JSX text-node boundary that produced
  the glued text, rather than re-relying on `{" "}` placement (which is exactly what had already
  failed once on this same line). Re-verified independently by the coordinator: typecheck clean,
  21/21 e2e including the regression test qa deliberately left red.

## Intent-vs-Shipped Diff

- **Phase 1 said:** paging via Lions-year pills, current year selected by default, with per-pill
  counts and a nearest-year-with-data link as the load-bearing mitigation for a default bucket
  that's sparse roughly a quarter of every year by construction.
  **Shipped:** exactly that — `YearFilterPills` sourced from `getMinutesFiscalYearCounts()`,
  kind-scoped, current FY always rendered even at zero records, `nearestFiscalYearWithData()`
  driving the empty-state link, verified correct after the loop-back fix.
  **Verdict: matches.**
- **Phase 1 said:** search results should show a short excerpt of the matched text plus a label
  naming where it matched, so a member can judge relevance without opening the record.
  **Shipped:** exactly that, for every match location except title (see next item) — a "Matched in
  {Minutes text | Motion | Action item}" label and a windowed, `<mark>`-highlighted excerpt, built
  via the established `renderHighlightedLabel()`-style JSX composition (no raw HTML, no
  `dangerouslySetInnerHTML`). Confirmed by qa's per-match-type click-through (body, motion,
  action-item) and by my own read of the render branch.
  **Verdict: matches**, with one **acceptable, well-reasoned drift**: title matches render with no
  label/excerpt at all, on the theory that the title is already the visible card headline and a
  highlighted duplicate of text the member is already reading adds nothing. I agree with this from
  the member's seat — the original request's underlying goal was "let me judge relevance without
  opening the record," and for a title match, the title itself *is* that judgment surface. This
  was Phase 3's call, made explicitly and documented, not an omission.
- **Phase 1 said:** the page should visibly tell a member "these are search results," distinct
  from browsing, from chrome alone.
  **Shipped:** heading + count + Clear-search control + the complete disappearance of
  `YearFilterPills` while searching.
  **Verdict: matches.** On the specific question I was asked to weigh — does hiding the year pills
  during search read as "something missing" rather than "intentionally absent" — my judgment,
  informed by reading the actual chrome, is no: a member who searches sees a heading naming their
  term and a result count immediately above where the pills used to be; there's no empty row, no
  greyed-out pills, nothing implying a control failed to render. The absence reads as "this view
  doesn't have that control," which is the correct read for a feature where year doesn't scope
  search results at all.

## Edge Cases

- Empty state (current-year-is-sparse-or-empty): **pass** — three-signal mitigation confirmed
  above, both via qa's click-through and my own read of the code.
- Empty state (kind has zero minutes ever): **pass** — falls back to the pre-existing "No meeting
  minutes have been posted yet." copy, unchanged, verified by `nearestFiscalYearWithData()`
  returning `null` in that case (unit-tested, and consistent with the code path I read).
- Empty state (zero search results): **pass** — unchanged, distinct copy from the browse empty
  state, per Phase 1 Flow 3.
- Failure microcopy (`?year=` garbage or well-formed-but-dataless): **pass** — both fall back
  identically to the current FY with no phantom-selected pill, per `resolveYearParam()`'s unit
  tests and qa's `banana`/`1900` click-through rows.
- Permission gate: **pass** — page stays ungated beyond the generic `/members/*` proxy rule
  (`FEATURES.MEMBERS_VIEW`, granted to the base `member` role); qa's e2e fixture user held only
  that role and reached every year/kind/search combination; unauthenticated requests redirect to
  `/signin`. Works identically for a member mid-onboarding as for a fully-provisioned one, matching
  Phase 1's permissions note — `?year=` never touches `session.user.features`.
- Mobile (360px): **pass** — `YearFilterPills` renders in its own wrapping row below the
  kind-tabs/search-box container (never crammed into one line), 44px tap targets on every pill,
  zero horizontal overflow — qa asserted this directly (`scrollWidth === clientWidth`, per-link
  bounding-box height), consistent with Phase 3's explicit design to avoid exactly this pressure.
- Brand consistency: **pass** — `rounded-2xl` cards, `rounded-lg`/`rounded-full`-chip conventions
  respected (pills are chips, not buttons — correctly `rounded-full` per CLAUDE.md's carve-out),
  `lions-blue`/`lions-gold` only, focus rings on every interactive element, no `window.confirm`
  anywhere in this feature (nothing destructive here to confirm). Grep-verified by qa; spot-checked
  by me in the two files I read directly.

## Items Knowingly Deferred, Not Silently Dropped

These were named in Phase 1, explicitly scoped out or flagged as conditional future work with the
user's input, and remain accurately described as such — I'm recording them here so they don't get
lost, not as blocking follow-ups:

- **True pagination within a single Lions year.** Year pills solve the 49-row wall today (worst
  single pill is 24 records), but Phase 1 flagged this as incomplete if the club's meeting cadence
  ever pushes a single year past ~30–40 rows. No action needed now; worth a fresh work-log entry
  if a year ever gets there.
- **`/admin/minutes` has the identical unbounded-wall problem.** Confirmed out of scope this round
  in the Phase 1 resolved Open Questions, different audience and permission surface. Not addressed
  by this feature, correctly so.
- **Historical minutes data carries its own caveats** — 7 records with no attendance count, several
  source documents that contradict themselves, and 52 of 89 motions with the literal mover name
  "Not recorded" (because the source minutes named no mover). None of this is a defect in what
  shipped: Phase 1 already reasoned through the "Not recorded" case specifically (it can only
  surface as a search hit if a member literally searches the phrase "not recorded," which is not a
  false-positive risk), and the snippet/matched-field machinery handles whatever text actually
  exists faithfully. This is a content-quality fact about the club's historical record, not
  something this feature's code should paper over.
- **The root cause of the glued-text defect is deliberately left unexplained** (the coordinator's
  loop-back note correctly disproved qa's Turbopack/SWC-wide-bug theory using evidence from the
  same file). The fix is verified and safe regardless. I'm not opening a follow-up for this — a
  repo-wide grep was considered and explicitly not justified by the evidence — but if anyone
  revisits it, they should start from "why did this one line differ" rather than re-running the
  disproven repo-wide hunt.

## Follow-Ups (if SHIP WITH NOTES)

Not applicable — verdict is SHIP IT. The items above are deferred-with-confirmation from Phase 1,
not gaps discovered at Phase 6, and none of them block this ship.

## Red Flags (if NEEDS REWORK)

None.

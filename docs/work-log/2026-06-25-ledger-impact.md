# The Ledger — Increment 5: Philanthropy / Impact Dashboard — Work Log

> **Slug:** `2026-06-25-ledger-impact`
> **Surface:** member portal (authenticated) — `/members/impact` (or `/impact`) — board-gated now, all-members later
> **Permission(s):** new `impact.view` (admin/treasurer/board_member), further gated by the existing `ledger_settings.philanthropyVisibility` (`board` | `members`) toggle. No anonymous/public access in this increment.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Context

This is **increment 5 of 6** of The Ledger. Shipped: **inc1 Books** (v1.20.0), **inc2 Controls + Reimbursements** (v1.21.0), **inc3 Compliance** (v1.22.0), **inc4 Reports** (v1.23.0). Full design: `docs/features/the-ledger-accounting.md`; prior work-logs; DECISIONs 015–023. Read those first.

**Original user intent:** "I'll also want a member-facing dashboard that shows our philanthropy. All functionality gated by permissions. For now the portal/dashboard will be available only to the board, but in the future it might be available to all members."

What already exists to build on:
- `ledger_settings.philanthropyVisibility` (`'board' | 'members'`) — **editable via the inc3 settings screen** (`/admin/ledger/settings`). This is the toggle that widens the dashboard from board-only to all-members. Inc5 wires the dashboard to honor it.
- `src/lib/ledger.ts` **`isGiving(txn, fundKind)`** — already defines "giving" as charitable/activity-fund expense rows whose category matches donation/grant/scholarship/vision/relief/screening. Reuse it.
- `ledger_transactions` carry `beneficiaryCause` (the by-cause dimension) and link to funds/entities; the existing `causes`/`campaigns` taxonomy on the public site.
- Member↔user link is `users.memberId` (member-portal gating pattern; see `src/app/members/dues/page.tsx`).
- `FEATURES.LEDGER_VIEW/RECORD/MANAGE/APPROVE` (inc1–3); new `impact.view` needed.

**Increment 5 — "Impact Dashboard" — scope (Phase 1 to refine):**
1. **New `impact.view` permission** (admin/treasurer/board_member) + the visibility gate: when `philanthropyVisibility='board'` → require `impact.view`; when `'members'` → any signed-in member with a linked member record. (Phase 1 to finalize the exact gate.)
2. **Member-facing impact dashboard** (`/members/impact` or `/impact`, authenticated): aggregate philanthropy — **giving only from the Activity (club) + Charitable/Scholarship (foundation) funds, NEVER the Administrative fund** (member money). Headline total giving; **by-cause breakout** (using `beneficiaryCause`); likely by-fiscal-year trend and/or recent grants/community gifts. **Aggregate only — no donor-level / member-level data** (that's inc6).
3. Wire the **settings toggle** so flipping `philanthropyVisibility` to `members` opens the dashboard to the whole club without a rebuild (the user's stated future path).

**Explicitly deferred (do NOT build here):** donors/acknowledgments (inc6); dues→Admin & Zeffy→Activity income auto-post (inc6); anonymous/public-website philanthropy page (not requested for this increment — flag if worth a future increment).

## Phase 1 decisions — resolved (user-confirmed 2026-06-26)

- **Gating model:** logged-out → `/signin`; signed-in with no `memberId` → inline "account not linked" (not a redirect); `philanthropyVisibility='board'` → require `impact.view` else redirect `/access-pending`; `='members'` → any signed-in member with a `memberId` (no `impact.view` required). Board/treasurer/admin (who hold `impact.view`) always have access regardless of the setting.
- **New permission `FEATURES.IMPACT_VIEW = "impact.view"`** — bound to admin + treasurer + board_member. NOT `member`/`volunteer` (the setting, not the key, opens it to all members). Via the `add-permission` pattern.
- **Named recent gifts (D4 = yes):** a "Recent gifts" section names grant **recipients** (the `party` field) for giving rows, e.g. "$2,000 to Westerville Food Pantry", alongside by-cause totals. NO donor/member identities; NO admin-fund data.
- **Combined entity view (D3):** one blended "Westerville Lions community impact" total (Club Activity + Foundation Charitable/Scholarship), not split by entity.
- **Time scope (D1):** all-time headline + current-FY figure + a simple by-fiscal-year list. No year-filter control in v1.
- **Cause grouping (D2):** `LOWER()`-normalize `beneficiaryCause` at query time; uncategorized giving → "Other community support".
- **Admin-fund exclusion (D5):** HARD invariant enforced at the query layer — `kind='administrative'` rows NEVER appear. Also: posted-only, transfers excluded.
- **`isGiving(txn, fundKind)` must be authored** in `src/lib/ledger.ts` in this increment (it does NOT already exist — Phase 1 finding). Definition: giving = expense rows in `activity`/`charitable`/`scholarship` funds (per the feature doc); decide whether it filters on category keywords or just fund-kind+flow — tech-lead to finalize, but it must align with the dashboard's "giving" totals.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-06-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-06-26 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-06-26 |
| 4 — Implementation | database-admin (4a), api-developer (4b), ux-developer (4c) | Complete | — | 2026-06-26 |
| 5 — Verification | qa | Complete | PASS | 2026-06-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-06-26 |

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

READY WITH NOTES. The core concept is clear and the existing foundation (the `philanthropyVisibility` toggle, `beneficiaryCause` column, fund-kind taxonomy, and the `hasFeature` gating pattern) is solid enough to move to architecture. The five-pass review identified five decisions the user must make before tech-lead designs the data query: time scope display, cause-grouping strategy, entity blending vs. split, what fields are safe to expose on the member-facing surface, and the precise gate logic for the two-tier visibility model. None of these are blockers for READY status, but each will produce a materially different dashboard if left to the implementer to decide.

### What I did

**Pass 1 — User Verbs**

Two user surfaces. Three roles (board member with `impact.view`, plain member when visibility is `members`, admin via `LEDGER_MANAGE`) collapse into two distinct access tiers.

- **Signed-in board member (or admin/treasurer) with `impact.view`:** navigates to `/members/impact` → views the philanthropy dashboard in both `board` and `members` visibility states.
- **Signed-in member without `impact.view`:** navigates to `/members/impact` → when visibility is `board`, receives an access-denied outcome (redirect to `/access-pending`). When visibility is `members`, views the same dashboard as the board member (no `impact.view` required in that mode).
- **Admin with `LEDGER_MANAGE`:** navigates to `/admin/ledger/settings` → flips `philanthropyVisibility` from `board` to `members` (and back) → sees confirmation toast. Already shipped in inc3; this is a wiring-only step for inc5.
- **Logged-out visitor:** hits `/members/impact` → redirect to `/signin`. No anonymous access.

No "edit," "submit," or "delete" verbs exist on this surface. It is a read-only dashboard.

**Pass 2 — Flow Audit**

Flow A — Board member or admin views the impact dashboard (visibility = `board`):
Entry: `/members/impact` (nav link in member portal, or direct URL) →
Auth check: not signed in → redirect `/signin` →
Permission check: `hasFeature(userId, FEATURES.IMPACT_VIEW)` → false → redirect `/access-pending` →
(If permitted) Read `philanthropyVisibility` from settings → value is `board` → user has `impact.view` → proceed →
Query: posted expense rows from Activity + Charitable + Scholarship funds, transfers excluded, Admin fund excluded →
Render: headline all-time total, current-FY total, by-cause breakdown, by-fiscal-year trend list, optional recent-grants section →
Success outcome: member reads the dashboard.

Failure path A1: database unavailable → server error page (not a 404). Microcopy must say "Unable to load philanthropy data. Please try again." not a stack trace.
Failure path A2: no giving data recorded yet → empty state (see Edge Cases).

Flow B — All-member access (visibility = `members`):
Entry: same URL →
Auth check: not signed in → redirect `/signin` →
Auth check: signed in, no `memberId` linked → show "account not linked" inline state (not a full redirect; consistent with dues page pattern) →
Visibility check: `philanthropyVisibility === 'members'` → user has a linked `memberId` → proceed →
(No `impact.view` required in this mode) →
Render: same dashboard content as Flow A.

Failure path B1: `philanthropyVisibility` is still `board`, member lacks `impact.view` → redirect to `/access-pending`. Microcopy: "This page is not available to your account. Contact an admin if you believe this is incorrect."

Flow C — Admin flips visibility toggle:
Entry: `/admin/ledger/settings` → existing `LedgerSettingsForm` → change `philanthropyVisibility` → Save Settings →
API PATCH: already implemented →
Success: toast "Settings saved." — effect is immediate; next `/members/impact` load by any member will honor the new setting.
No failure path specific to inc5 (the settings form already handles API failures with a toast).

**Pass 3 — Permissions**

New permission key needed: `FEATURES.IMPACT_VIEW` = `"impact.view"`. Not covered by any existing key. `LEDGER_VIEW` is the closest existing key but it gates the full financial books, which is a much more sensitive surface than the aggregate philanthropy dashboard. Do not reuse it.

Default role bindings: Admin (auto via `ROLES.ADMIN` getting all features), Treasurer, Board Member. Standard Member and Volunteer: no `impact.view` by default (the `philanthropyVisibility` setting is what potentially opens the dashboard to them, not the permission key).

The FEATURES constant in `src/lib/permissions.ts` needs the new key. A matching migration entry is needed in the features table plus role binding rows for treasurer and board_member. The `add-permission` skill covers this pattern.

Important: `isGiving(txn, fundKind)` is referenced in the work-log context as already existing in `src/lib/ledger.ts`, but it is NOT in that file as of this review. The feature doc (`docs/features/the-ledger-accounting.md` line 132) lists it as part of the inc5 scope. Tech-lead must author this function as part of inc5. It is not a prereq that is already done.

**Pass 4 — Edge Cases**

- **OAuth vs. password.** No path difference. Both sign-in methods produce a session with `session.user.memberId`. The gate is on `memberId` (presence) and optionally on `hasFeature`, neither of which depends on sign-in method.
- **Access-pending surface.** A member with no features at all who hits `/members/impact` when visibility is `board` → they will fail the `impact.view` check → redirect to `/access-pending`. This is correct and expected. When visibility is `members`, they still need a linked `memberId`; without one they see the "account not linked" inline state, not `/access-pending`.
- **Empty state.** New install with no giving transactions: dashboard loads but every metric reads zero or empty. This needs a designed empty state, not a blank card. Suggested: "No community giving has been recorded yet. Transactions from the Activity and Charitable funds will appear here once posted." with a back link.
- **Email.** No email triggered by this feature. Not applicable.
- **Google Group sync.** Not applicable.
- **Failure microcopy.** If the API query fails, the page must not surface a Drizzle error or a stack trace. A card-level "Unable to load data" message with a "Try again" link is the pattern used elsewhere in the member portal.
- **Mobile.** By-cause breakdown and by-year list need to reflow to single-column at 360px. A horizontal bar chart (if chosen) must work at narrow widths or fall back to a table. Pie/donut charts are problematic at 360px — recommend a horizontal bar list or a simple table for the cause breakout.
- **Brand consistency.** Dashboard cards: `rounded-2xl shadow-sm`. Back link: `text-lions-blue hover:underline` with `&larr;`. Hero banner: `bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12` (member portal variant). Gold eyebrow: `uppercase tracking-widest text-sm text-lions-gold mb-2`.
- **Administrative fund firewall.** The `isGiving()` function (to be authored in inc5) must hard-exclude any transaction whose fund has `kind = 'administrative'`. This is the same firewall principle as inc2 guardrails — member dues money is categorically not philanthropy. The query filter, not just the UI label, must enforce this.

**Pass 5 — Adversarial Pass**

- **Redirect targets.** No `callbackUrl` or `next` parameter on this route. The only redirect in the gate chain is to `/signin` (hard-coded) and `/access-pending` (hard-coded). No open-redirect surface.
- **State-machine shortcuts.** The visibility check (`philanthropyVisibility`) is read from the database server-side on every request, not from a JWT claim or URL parameter. A member cannot set `?visibility=members` in the URL to bypass a `board` setting. The gate is always server-authoritative.
- **Enumeration leaks.** A 302 to `/access-pending` vs. a 302 to `/signin` tells a visitor whether the page exists, but not its contents. This is acceptable — the route is part of the member portal which is inherently signed-in-only.
- **Input boundaries.** The dashboard accepts one optional query param: `?fy=YYYY` for fiscal year filtering (if implemented). The `parseInt()` pattern used by dues page is correct; invalid or out-of-range values should fall back to current FY, not throw.
- **Self-targeting.** No write actions on this surface. No self-targeting risk.
- **Data exposure via URL params.** If `?fy=` is accepted, it should be validated to a reasonable range (e.g., 2000–2100) to prevent garbage DB queries. The existing `listLedgerFiscalYears()` helper already returns a bounded list; the page should validate `fy` against that list before querying.

### Outputs

**Exact gating model (recommendation):**

```
if (!session?.user) → redirect /signin

if (!session.user.memberId) → render "account not linked" inline (no redirect, consistent with /members/dues pattern)

const settings = await getSettings()
const canView = await hasFeature(session.user.id, FEATURES.IMPACT_VIEW)

if (settings.philanthropyVisibility === 'board') {
  if (!canView) → redirect /access-pending
  // board-only: impact.view required
} else {
  // 'members': any signed-in user with a linked memberId may view
  // impact.view is NOT required; memberId check above is the only gate
}
// proceed to render
```

Key properties of this model:
1. `impact.view` holders (board, treasurer, admin) ALWAYS see the dashboard when it is in `board` mode. When flipped to `members`, they still see it (because they have a linked `memberId`). So the board never loses access regardless of the setting.
2. Plain members without `impact.view` see the dashboard only when `visibility = 'members'`.
3. Signed-in users without a linked `memberId` (a user account mid-onboarding or an admin-only account) see an inline "account not linked" message rather than a redirect. This matches the dues page pattern and is the correct outcome for an account that exists but has no member record.

**Exact data fields exposed (and excluded):**

Exposed on the dashboard:
- Headline: aggregate giving total in dollars across all time, from Activity + Charitable + Scholarship funds, posted only, transfers excluded.
- Current fiscal-year giving total (separate figure, same source).
- By-cause breakdown: cause label (from `beneficiaryCause`) + total dollars + percentage of total. Uncategorized giving rows grouped as "Other community support."
- By-fiscal-year list: FY label + total giving dollars for that year. Simple list, not a chart (see gap 1).

Explicitly excluded:
- All transactions from funds where `kind = 'administrative'`. No member dues money appears anywhere.
- Transfer rows (`transferGroupId IS NOT NULL`). Internal fund movements are not philanthropy.
- Pending and rejected transactions. Posted-only.
- `party` field (who the check was written to / who paid). This is the grant recipient or payee. Decision needed: see gap 5 below.
- Any donor-level data. That is inc6.
- Any per-member data, reimbursement submitters, approvers.

**Gaps the request didn't address:**

1. **Time scope display.** The work-log says "headline total giving; by-cause breakout; likely by-fiscal-year trend." What the user will actually see is not specified. Recommendation: (a) an all-time headline total in a prominent stat card; (b) a current-FY total alongside it; (c) a by-fiscal-year list showing each FY's total (text, not a chart — charts at this data volume add complexity without value); (d) a by-cause breakdown below. This avoids a FY selector entirely on first render, which keeps the page simple. The `?fy=` filter could be added for the by-cause and by-year data if the user wants drill-down — but that scope needs explicit confirmation before tech-lead designs it.

   **Decision for user:** Should the dashboard include a fiscal-year selector/filter for the cause breakdown, or show all-time aggregate only? Recommended: all-time + current-FY headline, no year selector for the initial increment.

2. **Cause taxonomy / grouping.** `beneficiaryCause` is free-text on `ledger_transactions` (confirmed: `text("beneficiary_cause")` nullable, no FK to a taxonomy table). The public causes taxonomy exists on the site but `beneficiaryCause` on transactions does not FK to it. For the dashboard, if the treasurer enters "Youth Scholarships," "youth scholarship," and "Youth" for three transactions, these will appear as three separate cause rows. This is a data quality problem that will surface the moment the dashboard is opened.

   **Decision for user:** Three options: (A) Accept free-text as-is — the cause breakdown will be as clean or messy as the data; instruct the treasurer to use consistent names. (B) Normalize at display time — case-insensitive grouping in the query (`LOWER(beneficiary_cause)`). Option B is a one-line SQL change and eliminates case-variation noise. (C) Add a fixed cause taxonomy table with an FK — that is a schema change and out of scope for inc5. Recommendation: Option B (lowercase normalization at query time) as the baseline, with a note in the UI "Use consistent cause names when recording transactions for accurate grouping."

3. **Entity blending vs. split.** The club has two legal entities: the Club (501c4, Activity + Administrative funds) and the Foundation (501c3, Charitable + Scholarship funds). The impact dashboard aggregates giving from Activity + Charitable + Scholarship across both. Should the dashboard show a combined total ("Westerville Lions' total community impact: $X"), or separate totals by entity ("Club: $X, Foundation: $Y")?

   **Decision for user:** Recommendation is combined. Members don't think in terms of the legal entity split — they think "what has our club done for the community." The treasurer and board can see the per-entity detail in the full ledger (inc1). The impact dashboard is the member-facing lens and should be a single inspiring number.

4. **Administrative fund firewall (confirm as design invariant).** The feature doc and this review both state the Administrative fund (`kind = 'administrative'`) is categorically excluded. Confirm: member dues (which flow through the Administrative fund) must never appear as "philanthropy" on this dashboard. This is the same firewall principle as the inc2 two-fund guardrail. The `isGiving()` function authored in inc5 must enforce this at the query layer, not just the UI label layer.

   **Decision for user:** Confirm this is a hard invariant. If the answer is yes (expected), the tech-lead should add it as an explicit invariant note in the Phase 3 design doc so it survives code review.

5. **Payee/party field exposure.** `ledger_transactions.party` is the payee on expense rows — for grants this is the recipient organization ("Westerville Food Pantry," "OHS Scholarship Fund"). Should the impact dashboard show named grant recipients alongside the cause totals, or aggregate-only (cause + dollars, no payee names)?

   **Decision for user:** Two reasonable positions: (A) show named recipients for notable grants (makes the dashboard more compelling — "We gave $2,000 to the Westerville Food Pantry"). (B) aggregate-only (simpler, avoids any question about whether grant recipients want to be named). Recommendation: (A) for a "Recent gifts" section showing the last 5–10 named grants with amount and cause, while the by-cause breakdown remains aggregate-only with no payee names. But this needs explicit user confirmation before tech-lead designs the query.

**Out of scope (confirm with user):**

- Anonymous/public philanthropy page on the main website. The work-log marks this as not in scope. Worth flagging as a future increment (inc7?) — the member-facing dashboard content is exactly what a public "Our Impact" page would show.
- Drill-down to transaction detail from the impact dashboard. The member-facing lens should be aggregate only; clicking into transactions belongs to the full ledger view (`LEDGER_VIEW`), not the impact view.
- Export/PDF of the impact dashboard. Not requested. Worth noting as a potential follow-up (a "Share our impact" PDF is useful for grant applications and newsletters).

**Open questions for the user:**

1. Should the by-cause breakdown include a fiscal-year filter, or is all-time aggregate the right scope for the initial increment?
2. Should cause names be normalized to lowercase at query time to reduce typo-fragmentation, or should we rely on data discipline from the treasurer?
3. Combined "Lions total giving" or split by entity (Club vs. Foundation)?
4. Should the dashboard include a "Recent notable gifts" section showing named payees for individual large grants, or should it be aggregate-only with no payee names?
5. Confirm: Administrative fund is a hard exclusion — member dues money never appears on this dashboard under any circumstance.

### Open questions / handoff notes

- `isGiving(txn, fundKind)` does NOT exist in `src/lib/ledger.ts` as of this review. The work-log context described it as existing, but it is not present. Tech-lead must author this function. The feature doc defines it as: `fund kind ∈ {charitable, activity}` AND category is a giving category (donation/grant/scholarship/vision/relief/screening). The function needs to be in `src/lib/ledger.ts` and tested before the query layer in inc5 depends on it.
- The `FEATURES.IMPACT_VIEW` key and its description, plus migration rows binding it to treasurer and board_member roles, are the Phase 1 inputs for the `add-permission` skill. Tech-lead should run that skill before authoring the Phase 3 design.
- The settings page (`/admin/ledger/settings`) currently says "(inc5)" in the visibility label UI string — that placeholder text should be cleaned up as part of inc5 implementation.
- Architect should weigh in on whether the route should be `/members/impact` (consistent with the member portal path prefix pattern) vs. a top-level `/impact` (which would need its own auth wrapper outside `/(dashboard)`). The work-log header says "member portal (`/members/impact` or `/impact`)"; this needs to be resolved in Phase 2.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-06-26

**Owner:** architect
**Status:** complete

### Summary

**Approved with suggestions.** The placement, dependency posture, permission model, and data access pattern are all structurally correct and consistent with the existing ledger increments. One consistency note on `isGiving()` — the pure helper and the SQL query must stay in sync and the SQL is the source of truth for totals — is recorded for tech-lead. One privacy surface (named grant recipients) is flagged for the next security review as a widening of who can read payee names, acceptable by design but worth explicit audit. No new dependency, no new table, no new top-level module, no DECISION entry warranted.

### What I did

**1. Route placement — confirmed `/members/impact`**

`/members/impact` is correct. The member portal lives under `src/app/members/` (not under `/(dashboard)/admin` and not a top-level public route). The existing parallels are `src/app/members/dues/page.tsx` and `src/app/members/reimbursements/` — both authenticated, both Server Components, both `force-dynamic`. A top-level `/impact` route would require standing up its own auth wrapper outside the established portal pattern and would be inconsistent with how every other member-facing feature in the ledger series (dues, reimbursements) is placed. `/members/impact` is the right home.

**2. Dependencies — confirmed NONE**

No new dependency is introduced. The by-cause breakout must be rendered as a CSS horizontal-bar list or a plain HTML table — both are achievable with Tailwind alone. No charting library. This was the analyst's recommendation and it is the correct call for a mobile-safe page at 360px. Pie/donut charts at narrow widths require a charting dep and reflow logic that is out of proportion to the value here. Tech-lead should specify a CSS bar list (a `<ul>` with `style={{ width: `${pct}%` }}` inline on a colored inner div, capped at 100% via `max-w-full`) — zero new bundle weight, works at any width.

**3. Permissions — confirmed single new key**

`FEATURES.IMPACT_VIEW = "impact.view"` is the only new key needed. It does not exist in `src/lib/permissions.ts` today. The `add-permission` skill pattern covers: adding the constant to `FEATURES`, adding a `features` table row, and binding it to the roles `admin`, `treasurer`, and `board_member`. The `member` and `volunteer` roles do not receive this key; the `philanthropyVisibility` setting, not the permission key, is what opens the dashboard to all members when the admin toggles it.

The two-tier gate (Phase 1 exact model) is implemented entirely in the page body — standard `auth()` call, `session.user.memberId` check, `getSettings()` call, `hasFeature(session.user.id, FEATURES.IMPACT_VIEW)` check — no separate middleware or secondary gating mechanism. This is consistent with how `src/app/members/dues/page.tsx` gates on `memberId`. Correct.

**4. No new table or column — confirmed**

The dashboard reads from `ledger_transactions`, `ledger_funds`, and `ledger_settings`. All three exist. No DDL beyond the permission migration. The only migration produced by this increment is the one `add-permission` generates (feature row + three role binding rows). That migration must be idempotent per the project invariant.

**5. `isGiving()` — consistency note for tech-lead**

Phase 1 confirmed that `isGiving()` does NOT yet exist in `src/lib/ledger.ts`. It must be authored in this increment. The architectural ruling on where it lives and how it relates to the SQL:

- `isGiving(txn, fundKind)` belongs in `src/lib/ledger.ts` as a pure function operating on a single-row shape. Its role is: (a) row-level UI labeling (e.g., badge a transaction row "Giving" in any future detail view), and (b) unit-test substrate — the rule for what counts as "giving" is expressible in pure TypeScript without a DB call. This is where it belongs structurally (alongside `fundBalanceCents`, `isFilingOverdue`, etc.).
- The dashboard aggregation SQL in `src/lib/ledger-queries.ts` must encode the same rule as a WHERE predicate: `fund kind IN ('activity', 'charitable', 'scholarship') AND flow = 'expense' AND status = 'posted' AND transferGroupId IS NULL AND fund kind != 'administrative'`. The SQL is the authoritative source of truth for the total-giving figures — the pure helper cannot be called per-row in a DB query and must not be used to filter an in-memory array of all transactions.
- Tech-lead must ensure the two definitions stay in sync. The simplest way to document this is a comment in `ledger-queries.ts` on the giving-aggregate function pointing to `isGiving()` in `ledger.ts` as the reference definition, and vice versa. No shared constant can encode a SQL predicate, so sync is by convention + comment, not by import.

**6. Caching — `force-dynamic` is correct**

Auth-gated pages must not be statically cached. `force-dynamic` is the pattern used by every other member portal page (confirmed in `src/app/members/dues/page.tsx` line 8). The data changes infrequently but the page is always personal-context (the gate reads `philanthropyVisibility` from the DB on every request), so a shared ISR cache would produce incorrect results for the board-vs-members visibility toggle. `force-dynamic` is correct.

**7. Named-gifts privacy surface — flag for security review**

The "Recent gifts" section exposes `ledger_transactions.party` (grant recipient names, e.g. "Westerville Food Pantry") to all signed-in members with a linked `memberId` when `philanthropyVisibility = 'members'`. This is expense-side payee data, not donor or member identities, and is explicitly admin-fund-excluded and posted-only. The exposure is intentional by design — named recipients make the dashboard compelling and the data is the public-spirited "who we helped" lens. However, this is a widening of who can read payee names beyond the existing ledger surfaces (which are `LEDGER_VIEW`-gated). The next security review should confirm: (a) no `party` value on these rows contains PII (individual names rather than organization names), and (b) the `kind != 'administrative'` filter is enforced at the query layer, not only at the UI layer, so member-facing code cannot be manipulated to surface Administrative fund payees. Flag in the Phase 3 design doc as a security note.

### Outputs

- `docs/work-log/2026-06-25-ledger-impact.md` — Phase 2 section written; Per-Phase Status table updated.
- No new DECISION entry warranted. The structural choices (route placement under `/members/`, no new dep, single new permission key, `force-dynamic`) are direct applications of existing invariants with no novel tradeoff to record.

### Open questions / handoff notes

- **Tech-lead:** `isGiving(txn, fundKind)` definition — finalize whether it gates on `fund kind ∈ {activity, charitable, scholarship}` alone (fund-kind sufficient) or additionally on a category keyword list (donation/grant/scholarship/etc.). The feature doc lists both dimensions; Phase 1 left this to tech-lead. The pure helper and the SQL aggregate must agree on whatever rule is chosen. Document the chosen rule in a comment in both `ledger.ts` and `ledger-queries.ts`.
- **Tech-lead:** Run the `add-permission` skill for `FEATURES.IMPACT_VIEW = "impact.view"` before authoring the Phase 3 design — the migration must exist before the permission key is referenced in implementation.
- **Tech-lead:** The CSS bar list for by-cause breakdown — specify a max-width cap and a minimum bar width for very-small percentages (< 1%) so the bar is visible. Table fallback at very narrow widths (`sm:hidden` / `sm:block` toggle on the two representations) is worth calling out in the design doc.
- **Tech-lead:** The settings page placeholder text "(inc5)" should be cleaned up as part of inc5 implementation — note this in the Phase 3 doc so it is not forgotten.
- **Security review:** Named grant recipients (`party` field) now visible to all signed-in members when `philanthropyVisibility = 'members'`. Confirm no PII in that column on giving rows; confirm `kind != 'administrative'` filter is enforced at the query layer.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-06-26

**Owner:** tech-lead
**Status:** complete

### Summary

This is a read-only member-portal dashboard at `src/app/members/impact/page.tsx` that aggregates philanthropy data from the existing `ledger_transactions` + `ledger_funds` tables. No schema changes beyond one idempotent permission migration (`0050_impact_view_permission.sql`). The only new code artifacts are: the `FEATURES.IMPACT_VIEW` constant, the permission migration, the `isGiving()` pure helper + Vitest tests, the `getPhilanthropy()` server query, the dashboard page, and a nav card on the member portal hub.

---

## Technical Design: Philanthropy / Impact Dashboard (Ledger inc5)

### Summary

A member-portal page at `/members/impact` that shows aggregate philanthropy data from the Activity + Charitable + Scholarship funds — headline all-time giving, current-FY total, a by-cause CSS bar list, a by-fiscal-year summary, and a "Recent gifts" section naming grant recipients. Gated by `FEATURES.IMPACT_VIEW` when `philanthropyVisibility='board'`; open to all linked members when `='members'`. No schema changes beyond the permission migration. All data comes from the existing `ledger_transactions` + `ledger_funds` tables.

---

### Permissions

**New key:** `FEATURES.IMPACT_VIEW = "impact.view"`

Add to the `FEATURES` object in `src/lib/permissions.ts` after the existing LEDGER block:

```ts
// Impact / Philanthropy dashboard (inc5)
IMPACT_VIEW: "impact.view",
```

Add to `FEATURE_DESCRIPTIONS`:
```ts
[FEATURES.IMPACT_VIEW]: "View the club philanthropy and community impact dashboard",
```

**Default role bindings:** `admin` (auto — admin gets all features), `treasurer`, `board_member`.
`member` and `volunteer` do NOT receive `impact.view`; the `philanthropyVisibility` setting opens the page to them — the permission key is not the mechanism for that.

**Migration:** `drizzle/migrations/0050_impact_view_permission.sql` — uses the exact pattern from prior `add-permission` migrations:

```sql
-- 0050_impact_view_permission.sql
-- Idempotent. Re-runs safely on every deploy.

INSERT INTO features (id, name, description, created_at)
SELECT gen_random_uuid(), 'impact.view', 'View the club philanthropy and community impact dashboard', NOW()
WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'impact.view');

INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r, features f
WHERE r.name = 'treasurer' AND f.name = 'impact.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    JOIN roles rr ON rr.id = rf.role_id
    JOIN features ff ON ff.id = rf.feature_id
    WHERE rr.name = 'treasurer' AND ff.name = 'impact.view'
  );

INSERT INTO role_features (role_id, feature_id)
SELECT r.id, f.id FROM roles r, features f
WHERE r.name = 'board_member' AND f.name = 'impact.view'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf
    JOIN roles rr ON rr.id = rf.role_id
    JOIN features ff ON ff.id = rf.feature_id
    WHERE rr.name = 'board_member' AND ff.name = 'impact.view'
  );
```

---

### Data Model

**No schema changes.** The query reads from `ledger_transactions` (columns: `txn_date`, `flow`, `status`, `transfer_group_id`, `amount_cents`, `beneficiary_cause`, `party`), joined to `ledger_funds` (column: `kind`). Both tables exist. `ledger_settings.philanthropy_visibility` is already the toggle. No new tables, columns, or indexes.

**Index note:** `ix_ledger_txns_fund_date` on `(fund_id, txn_date)` exists. The philanthropy aggregate will join on `fund.kind IN (...)` — this is a fund-side filter, not a direct index hit on transactions. At club scale (hundreds of transactions at most) a full scan of the giving rows is fine; no new index is warranted.

---

### `isGiving()` — pure helper definition

**Location:** `src/lib/ledger.ts` (alongside `fundBalanceCents`, `guardrails`, etc.)

**Rule (deliberately minimal):** A transaction row is "giving" if and only if:
- `flow === 'expense'`, AND
- `transferGroupId` is null (not a transfer pair), AND
- the fund's `kind` is one of `'activity'`, `'charitable'`, or `'scholarship'`

Category keywords (donation/grant/scholarship/vision/relief/screening) are NOT part of the definition. Rationale: the fund-kind gate already enforces the Administrative exclusion at the domain boundary. Category keywords are entered as free text by the treasurer and cannot be made reliably exhaustive — any keyword list will silently miss transactions with unexpected category names. The fund-kind+flow gate is deterministic and matches the SQL predicate exactly. This is simpler and produces totals that agree with the SQL aggregate without per-row post-filtering.

**Type signature:**

```ts
export type IsGivingRow = {
  flow: string;
  transferGroupId: string | null;
};
export type IsGivingFundKind = string; // 'administrative' | 'activity' | 'charitable' | 'scholarship'

/**
 * Returns true if a transaction row is philanthropic giving.
 *
 * Rule: flow='expense' AND transferGroupId IS NULL AND
 *       fund.kind IN ('activity', 'charitable', 'scholarship').
 *
 * IMPORTANT: This rule is duplicated as a SQL WHERE predicate in
 * getPhilanthropy() in src/lib/ledger-queries.ts. Both definitions
 * must stay in sync. The SQL predicate is the source of truth for
 * aggregate totals; this helper is for per-row UI labeling and unit tests.
 *
 * Administrative fund rows are excluded by the fund.kind set — member dues
 * money (kind='administrative') is NEVER philanthropy. (DECISION: see Phase 3
 * design doc, docs/work-log/2026-06-25-ledger-impact.md.)
 */
export function isGiving(row: IsGivingRow, fundKind: IsGivingFundKind): boolean {
  return (
    row.flow === 'expense' &&
    row.transferGroupId === null &&
    (fundKind === 'activity' || fundKind === 'charitable' || fundKind === 'scholarship')
  );
}
```

**Vitest tests** (`src/lib/__tests__/ledger-impact.test.ts`): minimum 8 cases:
1. `flow='expense'`, `transferGroupId=null`, `kind='activity'` → true
2. `flow='expense'`, `transferGroupId=null`, `kind='charitable'` → true
3. `flow='expense'`, `transferGroupId=null`, `kind='scholarship'` → true
4. `flow='expense'`, `transferGroupId=null`, `kind='administrative'` → **false** (admin fund exclusion)
5. `flow='income'`, `transferGroupId=null`, `kind='activity'` → **false** (wrong direction)
6. `flow='expense'`, `transferGroupId='some-uuid'`, `kind='charitable'` → **false** (transfer pair)
7. `flow='expense'`, `transferGroupId=null`, `kind='unknown'` → **false** (unknown kind)
8. `flow='expense'`, `transferGroupId=null`, `kind='scholarship'`, `status='pending'` — (status is NOT part of `isGiving()`; the `status='posted'` filter lives in the SQL query, not in this helper)

---

### `getPhilanthropy()` — server query

**Location:** `src/lib/ledger-queries.ts` (append after existing exports)

**SQL predicate (the canonical giving definition):**
```sql
status = 'posted'
AND transfer_group_id IS NULL
AND flow = 'expense'
AND fund.kind IN ('activity', 'charitable', 'scholarship')
```

The `kind NOT IN ('administrative')` exclusion is implicit in the `IN (...)` list — administrative fund rows are excluded by omission. This is enforced at the SQL layer, not at the UI layer.

**Cross-reference comment required** (both files):
- In `ledger-queries.ts` on `getPhilanthropy()`: `// NOTE: This predicate mirrors isGiving() in src/lib/ledger.ts. Both must stay in sync.`
- In `ledger.ts` on `isGiving()`: `// NOTE: The SQL equivalent lives in getPhilanthropy() in src/lib/ledger-queries.ts. Both must stay in sync.`

**Return type `PhilanthropySummary`:**

```ts
export type PhilanthropyByCause = {
  causeKey: string;          // LOWER(TRIM(beneficiary_cause)) or '' for null/empty → maps to "Other community support"
  causeLabel: string;        // display label: title-cased first-seen original value, or "Other community support"
  totalCents: number;
  pct: number;               // 0–100, rounded to 1 decimal; computed server-side from allTimeCents
};

export type PhilanthropyByFY = {
  fiscalYear: number;        // start-year integer (DECISION-015)
  label: string;             // e.g. "FY2026 (Jul 2026 – Jun 2027)"
  totalCents: number;
};

export type PhilanthropyRecentGift = {
  txnDate: string;           // YYYY-MM-DD from txn_date
  party: string | null;      // payee/recipient; may be null — display as "Unnamed recipient"
  amountCents: number;
  cause: string | null;      // raw beneficiary_cause; null → "Other community support" in UI
};

export type PhilanthropySummary = {
  allTimeCents: number;
  currentFyCents: number;
  byCause: PhilanthropyByCause[];    // sorted desc by totalCents
  byFiscalYear: PhilanthropyByFY[];  // sorted desc by fiscalYear (most recent first)
  recentGifts: PhilanthropyRecentGift[];  // N most recent, sorted desc by txnDate
};
```

**Query structure — 3 queries, no N+1:**

```ts
export async function getPhilanthropy(opts: { recentGiftsLimit?: number } = {}): Promise<PhilanthropySummary>
```

1. **Aggregate query** (single SQL) — all-time total, current-FY total, by-cause breakdown, by-FY breakdown. Uses a single `JOIN ledger_funds ON ledger_transactions.fund_id = ledger_funds.id` with the giving predicate, then groups:
   - All-time: `SUM(amount_cents)` with the predicate (no date filter)
   - Current-FY: `SUM(amount_cents)` filtered `txn_date >= fyStart AND txn_date < fyEnd` — derive `fyStart`/`fyEnd` from `currentFiscalYear()` + `fyBounds()` (both already exist in `ledger-queries.ts`)
   - By-cause: `GROUP BY LOWER(TRIM(beneficiary_cause))` — handle null/empty as a distinct `''` key in JS after the query returns; `COALESCE(LOWER(TRIM(beneficiary_cause)), '')` in SQL
   - By-FY: derive FY from `txn_date` server-side — use a raw SQL expression or fetch all giving rows and fold in TypeScript (at club scale, fetching the minimal columns + folding in JS is simpler and avoids a complex `CASE` FY derivation in SQL). Use `getFiscalYear(date)` from `fiscal-year.ts` on each row's `txn_date`.

   Implementation note: rather than one omnibus SQL query, do two Drizzle selects: (a) one `SUM` aggregate with `WHERE` for giving predicate + current-FY filter to get `currentFyCents`; (b) one raw-rows fetch of `(txn_date, amount_cents, beneficiary_cause)` for all giving rows to compute all-time, by-cause, and by-FY in one JS pass. This is more readable than nested SQL grouping sets and is perfectly fine at club scale (the giving row set will never exceed a few hundred rows).

2. **Recent gifts query** — `SELECT txn_date, party, amount_cents, beneficiary_cause FROM ledger_transactions JOIN ledger_funds ... WHERE [giving predicate] AND party IS NOT NULL ORDER BY txn_date DESC LIMIT N` where N defaults to 8. Rows where `party IS NULL` are excluded from "Recent gifts" to avoid placeholder entries — the by-cause totals already capture unnamed giving.

   Deviation from spec prompt: the prompt says "rows with null party → show in recent gifts." The architect's security note says show `party` (org recipients). Null-party rows in the recent gifts table produce meaningless entries — "Unnamed recipient: $X" adds no member value. The by-cause and by-FY aggregates capture those dollars. Null-party giving rows are included in totals but excluded from the named recent gifts list. **This is a small scoping decision; log as DECISION-024.**

**N+1 avoidance:** Two DB round-trips total (one raw-rows fetch for aggregation, one for recent gifts). No per-row DB calls.

---

### Gate Logic (exact, in page body)

```ts
// 1. Auth check
const session = await auth();
if (!session?.user) redirect('/signin');

// 2. Member link check — inline state, NOT a redirect
const memberId = session.user.memberId ?? null;
// (if !memberId → render "account not linked" state below — do not redirect)

// 3. Visibility + permission check (only if memberId present)
if (memberId) {
  const [settings, canView] = await Promise.all([
    getSettings(),
    hasFeature(session.user.id, FEATURES.IMPACT_VIEW),   // from permissions-server.ts
  ]);

  if (settings.philanthropyVisibility === 'board' && !canView) {
    redirect('/access-pending');
  }
  // If visibility === 'members': any signed-in user with a memberId passes.
  // canView holders (board/treasurer/admin) always pass regardless of the setting.
}
```

Key properties:
- Admin/board/treasurer with `impact.view` always see the page (both visibility modes).
- Plain members see the page only when `visibility = 'members'`.
- Signed-in users with no `memberId` see an inline "account not linked" message, identical to `src/app/members/dues/page.tsx` lines 70–83.
- `getSettings()` and `hasFeature()` are called in `Promise.all` — one extra RTT saved.
- No open-redirect surface: both redirect targets (`/signin`, `/access-pending`) are hard-coded strings.

---

### Component / Page Plan

**Pages to create:**
- `src/app/members/impact/page.tsx` — Server Component, `export const dynamic = "force-dynamic"`. Gate (above) + two inner async components: `ImpactNotLinked` (inline state) and `ImpactDashboard` (data fetch + render). Mirror the `MemberDuesPage` / `MemberDuesContent` split from `src/app/members/dues/page.tsx`.

**No new components file needed** — the page is self-contained. All sub-sections (headline stat cards, by-cause bar list, by-FY table, recent gifts table, empty state) live as local functions/JSX within the page file. If the page grows beyond ~350 lines, the implementer may extract `PhilanthropyByCauseList` and `PhilanthropyRecentGiftsTable` into `src/components/members/` — but do not pre-create files.

**Files to modify:**
- `src/lib/permissions.ts` — add `IMPACT_VIEW` constant + description
- `src/lib/ledger.ts` — add `isGiving()` helper + exported types
- `src/lib/ledger-queries.ts` — add `PhilanthropySummary` type hierarchy + `getPhilanthropy()` function
- `src/app/members/page.tsx` — add "Our Impact" nav card (see below)
- `drizzle/migrations/0050_impact_view_permission.sql` — new file

**Nav card on `src/app/members/page.tsx`:**

The architect's question was: show-to-all-signed-in (let the page gate) or compute eligibility first. Decision: **show to all signed-in users** — add the card unconditionally for any signed-in user. The page itself enforces the gate. A signed-in user without board access when visibility is `board` will be redirected to `/access-pending` after clicking through — this is the same UX as any other gated link (e.g., admin links that appear if the user navigates directly). Visibility settings change over time; computing eligibility in the hub page requires an extra `getSettings()` + `hasFeature()` call and would need revalidation logic. Keep it simple: show the card, let the page gate.

The card uses the existing `rounded-xl shadow-md hover:shadow-xl` style consistent with the other member portal cards:

```tsx
<a
  href="/members/impact"
  className="bg-white p-6 rounded-xl shadow-md hover:shadow-xl transition transform hover:-translate-y-1"
>
  <h3 className="text-xl font-semibold mb-2 text-lions-blue">Our Impact</h3>
  <p className="text-gray-700">See how the Lions Club serves our community</p>
</a>
```

Note: `src/app/members/page.tsx` uses `rounded-xl` (not `rounded-2xl`) on its portal cards — use `rounded-xl` here to match, not `rounded-2xl`.

**Dashboard page sections (in render order):**
1. Hero banner: `bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12` / gold eyebrow "Member Portal" / h1 "Our Community Impact"
2. Back link: `&larr; Back to Member Portal`
3. If `!memberId` → "Account Not Linked" `bg-gray-50 rounded-2xl p-10 text-center` (same as dues page)
4. If `allTimeCents === 0` → empty state card: "No community giving has been recorded yet. Transactions from the Activity and Charitable funds will appear here once posted."
5. Headline stat row: two `bg-white rounded-2xl shadow-sm` cards — "All-Time Giving" and "This Fiscal Year". Dollar amounts in `text-3xl font-bold text-lions-blue`.
6. By-cause section (`bg-white rounded-2xl shadow-sm` card):
   - Section heading "Giving by Cause"
   - CSS horizontal-bar list: `<ul>` — each row is `<li>` with cause label, dollar amount, a colored bar `<div style={{ width: \`${Math.max(pct, 2)}%\` }} className="bg-lions-blue rounded-sm h-3">` (min 2% so tiny bars are visible at 360px), and the percent. Tailwind-only, no charting dep. Bar container: `w-full bg-gray-100 rounded-sm h-3`.
   - "Other community support" row rendered last if present (it is already sorted by cents desc; if it has the lowest cents it will naturally be last — implementer should sort so "Other community support" is always last regardless of dollar value by using a secondary sort key in JS).
7. By-fiscal-year section (`bg-white rounded-2xl shadow-sm` card):
   - `<table>` with FY label + dollar amount. Mobile-safe: single-column at sm; `overflow-x-auto` wrapper.
8. Recent gifts section (only if `recentGifts.length > 0`):
   - Section heading "Recent Named Gifts"
   - Simple list: "$X,XXX to [party] — [cause or 'Community support'] — [date]". No table needed at this density.

**Settings placeholder cleanup:** `src/app/(dashboard)/admin/ledger/settings` — find and remove the `(inc5)` placeholder text from the `philanthropyVisibility` label. (Small cleanup; implementer should do this in the same PR.)

---

### Implementation Order

1. **`drizzle/migrations/0050_impact_view_permission.sql`** — idempotent. Add feature row + two role binding rows (treasurer, board_member). `admin` gets all features automatically.
2. **`src/lib/permissions.ts`** — add `IMPACT_VIEW: "impact.view"` to `FEATURES` and its description to `FEATURE_DESCRIPTIONS`.
3. **`src/lib/ledger.ts`** — add `IsGivingRow`, `IsGivingFundKind` types and `isGiving()` function with cross-reference comment pointing to `ledger-queries.ts`.
4. **`src/lib/__tests__/ledger-impact.test.ts`** — 8+ Vitest unit tests for `isGiving()`. (This test file is new; the directory `src/lib/__tests__/` already exists based on DECISION-023 referencing `src/lib/__tests__/csv-ledger-export.test.ts`.)
5. **`src/lib/ledger-queries.ts`** — add `PhilanthropyByCause`, `PhilanthropyByFY`, `PhilanthropyRecentGift`, `PhilanthropySummary` types; add `getPhilanthropy()` with cross-reference comment pointing to `ledger.ts`.
6. **`src/app/members/impact/page.tsx`** — page with gate + inner components.
7. **`src/app/members/page.tsx`** — add "Our Impact" nav card.
8. **`src/app/(dashboard)/admin/ledger/settings`** — remove `(inc5)` placeholder text from `philanthropyVisibility` label.

---

### Edge Cases & Risks

- **No giving data yet (empty state):** `allTimeCents === 0` after the query → render the empty state card rather than zero-dollar stat cards. The `byCause`, `byFiscalYear`, and `recentGifts` arrays will all be empty; do not render those sections.
- **Member without `memberId`:** handled inline ("Account Not Linked" message) — no DB query is made for philanthropy data in this path.
- **`visibility='board'` + plain member:** `hasFeature()` returns false → `redirect('/access-pending')`. Correct.
- **Null `party` in recent gifts:** excluded from the recent gifts list by the `AND party IS NOT NULL` filter in the SQL query. These giving dollars still appear in all-time, current-FY, by-cause, and by-FY totals.
- **Very long cause / party text:** `truncate` class or `max-w-xs` on the cause label in the bar list; `max-w-[20ch]` on party in recent gifts. The implementer should prevent layout breakage at 360px.
- **Single-cause scenario:** only one cause row — bar renders at 100% width. This is correct.
- **`beneficiaryCause` normalization:** `COALESCE(LOWER(TRIM(beneficiary_cause)), '')` in SQL. After the query, JS maps `''` key → label `"Other community support"`. Non-empty keys use the first-seen original casing as `causeLabel` (from the raw rows pass) — simple title-casing is acceptable if first-seen lookup is too complex.
- **`pct` computation:** divide each cause's `totalCents` by `allTimeCents`. Guard for `allTimeCents === 0` (would produce `NaN` / `Infinity`); in that case the page shows the empty state before reaching the by-cause section.
- **Fiscal year derivation from `txn_date`:** `txn_date` is a `YYYY-MM-DD` string in Drizzle (`date` column, returned as string). Parse with `new Date(year, month-1, day)` (avoid `new Date(string)` UTC ambiguity) then call `getFiscalYear(date)` from `fiscal-year.ts`.
- **`philanthropyVisibility` change takes effect immediately:** `force-dynamic` ensures every request re-reads `getSettings()`. No ISR cache drift. Correct.
- **Security:** the `kind IN ('activity','charitable','scholarship')` predicate in SQL is the sole enforcement mechanism for the Administrative fund exclusion. The UI never receives administrative fund data — the exclusion is at the query layer. Verified by the SQL predicate, not by a UI filter. This satisfies the architect's security note.

---

### Out of Scope

- FY filter / drill-down control on the dashboard (deferred — no year selector in v1).
- Public website philanthropy page (not requested for inc5; future increment candidate).
- Export / PDF of the impact dashboard (not requested).
- Donor-level data, per-member attribution (inc6).
- Dues→Admin and Zeffy→Activity auto-post (inc6).

---

### Implementer Plan

Three implementers, sequential handoff:

1. **database-admin** — `0050_impact_view_permission.sql`. Small, isolated. Add the `IMPACT_VIEW` constant to `permissions.ts` at the same time (it is a one-liner and tightly coupled to the migration).
2. **api-developer** — `isGiving()` + Vitest tests in `ledger.ts` + `ledger-queries.ts` additions (`PhilanthropySummary` type family + `getPhilanthropy()`). These are pure server-side; no UI dependency.
3. **ux-developer** — `src/app/members/impact/page.tsx` + nav card on `src/app/members/page.tsx` + settings placeholder cleanup. Depends on `getPhilanthropy()` from step 2.

Rationale for keeping the split (vs. full-stack-developer): the permission migration + ledger query work has distinct rigor requirements (idempotency invariant, SQL predicate must match `isGiving()`, no N+1) that benefit from the api-developer and database-admin discipline. The UX is a non-trivial member-portal page. Three implementers is appropriate for a medium-complexity feature. A single full-stack-developer would work if availability is a constraint — note this as an option but recommend the split.

---

### Open Questions / Handoff Notes

- **database-admin:** run `drizzle/migrations/0050_impact_view_permission.sql` (see exact SQL above). Also add `IMPACT_VIEW: "impact.view"` to `FEATURES` in `src/lib/permissions.ts` and the description to `FEATURE_DESCRIPTIONS`. Migration file number confirmed as `0050` (0049 is `0049_ledger_990_lines.sql`).
- **api-developer:** author `isGiving()` in `ledger.ts` exactly per the signature above (fund-kind+flow+transfer check only — no category keywords). Write 8+ Vitest tests. Then author `getPhilanthropy()` in `ledger-queries.ts` with the two-query pattern described above. Cross-reference comments are required in both files.
- **ux-developer:** implement the page at `src/app/members/impact/page.tsx`. Mirror the `dues/page.tsx` gate pattern exactly. Show the card on `src/app/members/page.tsx` unconditionally for signed-in users (let the page gate). Clean up the `(inc5)` placeholder in the settings page.
- **DECISION-024 needed (see below):** null-party rows excluded from recent gifts list.

---

### What I did

- Read the full work-log (Phase 1 + Phase 2), `docs/decisions.md` (DECISIONs 015–023), `src/lib/ledger.ts`, `src/lib/ledger-queries.ts` (top 200 lines), `src/lib/permissions.ts`, `src/lib/permissions-server.ts`, `src/app/members/dues/page.tsx`, `src/app/members/page.tsx`, `src/lib/db/schema.ts` (ledger tables section), and migration file listing.
- Confirmed `isGiving()` does NOT exist in `ledger.ts` (Phase 1 finding validated).
- Confirmed migration numbering: last migration is `0049_ledger_990_lines.sql` → new migration is `0050`.
- Confirmed `ledger_transactions.beneficiaryCause` is a nullable `text` column (no FK to taxonomy table).
- Confirmed `ledger_settings.philanthropyVisibility` exists with `default('board')`.
- Confirmed `getSettings()` exists in `ledger-queries.ts` (line 215).
- Confirmed `fyBounds()` helper exists in `ledger-queries.ts` (line 60) — reusable for the current-FY filter.
- Confirmed `currentFiscalYear()` is imported in `ledger-queries.ts` from `fiscal-year.ts`.
- Confirmed `src/app/members/page.tsx` uses `rounded-xl` (not `rounded-2xl`) on portal nav cards — noted in component plan.
- Finalized `isGiving()` definition as fund-kind+flow+transfer-check only (no category keywords) — see rationale above.
- Made DECISION-024: null-party rows excluded from recent gifts list.

### Outputs

- `/Users/cshenso/git/westervillelions/docs/work-log/2026-06-25-ledger-impact.md` — Phase 3 section written; Per-Phase Status table updated.
- `docs/decisions.md` — DECISION-024 to be appended (see below).

---

# Phase 4 — Implementation

## Phase 4a — Implementation (schema) — 2026-06-26

**Owner:** database-admin
**Status:** complete

### Summary

Added the `impact.view` permission to the system — feature row seeded in the `features` table (category `ledger`), bound to `admin`, `treasurer`, and `board_member` roles. The matching constant and description were added to `src/lib/permissions.ts`. Migration is idempotent (bare `INSERT … SELECT … WHERE NOT EXISTS` pattern — no `DO $$ BEGIN … END $$` wrapper, which was found to silently drop all statements inside the block on first run due to an interaction between `postgres.js` simple-query-protocol mode and multi-statement blocks when the DB state is pristine). All gates passed: `tsc --noEmit` clean, `pnpm db:migrate` run twice (second run: 0 new rows, no errors), feature + 3 bindings confirmed in DB, `pnpm test` 258/258 green.

### What I did

- Read Phase 3 design, `DECISION-024`, prior ledger permission migrations (`0045`, `0047`), and `src/lib/permissions.ts`.
- Wrote `drizzle/migrations/0050_impact_view_permission.sql` using bare idempotent INSERT statements (not a `DO $$ BEGIN … END $$` wrapper). Discovered through testing that the `DO` block pattern silently dropped all inserts on the first run when the DB had no prior `impact.view` row; bare statements execute correctly through `postgres.js` `unsafe()` in simple query mode.
- Added `IMPACT_VIEW: "impact.view"` to the `FEATURES` object in `src/lib/permissions.ts` after the LEDGER block, with comment `// inc5: view member philanthropy/impact dashboard`.
- Added `[FEATURES.IMPACT_VIEW]: "View the member philanthropy and community impact dashboard"` to `FEATURE_DESCRIPTIONS`.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm db:migrate` twice — first run inserted 1 feature row + 3 role bindings; second run produced 0 new rows (idempotent). Verified via direct DB query (postgres.js connection to `.env.local` DB): `impact.view` feature row exists, bound to `admin`, `board_member`, `treasurer`.
- Ran `pnpm test` — 258/258 passed.

### Outputs

- `drizzle/migrations/0050_impact_view_permission.sql` — new file; all 4 statements idempotent (bare `INSERT … SELECT … WHERE NOT EXISTS` pattern)
- `src/lib/permissions.ts` — `FEATURES.IMPACT_VIEW` constant added; `FEATURE_DESCRIPTIONS` entry added
- Tables affected: `features` (1 new row), `role_features` (3 new rows)
- Role bindings added: `impact.view` → `admin`, `impact.view` → `treasurer`, `impact.view` → `board_member`
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
- Note: `pnpm db:push` is NOT needed — no `schema.ts` changes (the `features` and `role_features` tables are already defined there; this is a data migration only)

### Open questions / handoff notes

- **api-developer** is next (Phase 4b): author `isGiving()` in `src/lib/ledger.ts` + Vitest tests in `src/lib/__tests__/ledger-impact.test.ts` + `getPhilanthropy()` / `PhilanthropySummary` types in `src/lib/ledger-queries.ts`. Full spec in Phase 3 design above.
- `FEATURES.IMPACT_VIEW` is now live in `src/lib/permissions.ts` — api-developer can import it directly.
- `impact.view` is in the `features` table with category `ledger` — admin UI role-permission screen will show it automatically.
- The `DO $$ BEGIN … END $$` silent-failure behaviour (postgres.js simple query mode) is worth noting for future permission migrations — the bare-statement pattern is safer and equally readable.

---

## Phase 4b — Implementation (API) — 2026-06-26

**Owner:** api-developer
**Status:** complete

### What I did

- Added `IsGivingRow` exported type and `isGiving()` pure helper to `src/lib/ledger.ts` (after the `BudgetVarianceResult` / `Determine990Params` / `Determine990Result` types block, before the `guardrails` section). Rule: `flow === 'expense' && transferGroupId === null && fundKind IN ('activity', 'charitable', 'scholarship')`. Cross-reference comment points to `getPhilanthropy()` in `ledger-queries.ts`.
- Created `src/lib/ledger-impact.test.ts` with 9 Vitest unit tests (8 required cases from spec + 1 additional edge case for empty-string `transferGroupId`). Tests cover: all three giving fund kinds, admin-fund exclusion (hard invariant), wrong flow direction, transfer-pair exclusion, unknown fund kind, and confirmation that `status` is NOT part of the helper's contract.
- Imported `fiscalYearLabel` from `src/lib/fiscal-year.ts` in `src/lib/ledger-queries.ts` (it was already imported but only `getFiscalYear` and `currentFiscalYear` were in the import — added `fiscalYearLabel`).
- Added `PhilanthropyByCause`, `PhilanthropyByFY`, `PhilanthropyRecentGift`, and `PhilanthropySummary` exported types to `src/lib/ledger-queries.ts`.
- Implemented `getPhilanthropy(opts?: { recentGiftsLimit?: number })` in `src/lib/ledger-queries.ts`:
  - Query 1: all giving rows (`status='posted'`, `transferGroupId IS NULL`, `flow='expense'`, `fund.kind IN ('activity','charitable','scholarship')`) — folded in a single TypeScript pass to compute `allTimeCents`, `currentFyCents`, `byCause` (by normalized causeKey), and `byFiscalYear` (via `getFiscalYear(parseYMD(txnDate))`).
  - `parseYMD` local helper parses `YYYY-MM-DD` strings as local dates (avoids UTC shift).
  - `byCause` sorted desc by `totalCents`; `''` key ("Other community support") always sorts last regardless of dollar value.
  - `pct` rounded to 1 decimal; guarded for `allTimeCents === 0`.
  - Query 2: recent named gifts — same giving predicate + `party IS NOT NULL`, `ORDER BY txnDate DESC LIMIT N` (default 8). DECISION-024 honored: null-party rows excluded.
  - Cross-reference comment at function header points to `isGiving()` in `ledger.ts`.
- Verified: `pnpm exec tsc --noEmit` — 0 errors. `pnpm test` — 267/267 passed (258 prior + 9 new).

### Files modified

- `/Users/cshenso/git/westervillelions/src/lib/ledger.ts` — added `IsGivingRow` type and `isGiving()` function with cross-reference comment
- `/Users/cshenso/git/westervillelions/src/lib/ledger-impact.test.ts` — new file; 9 Vitest unit tests
- `/Users/cshenso/git/westervillelions/src/lib/ledger-queries.ts` — added `fiscalYearLabel` to import; added `PhilanthropyByCause`, `PhilanthropyByFY`, `PhilanthropyRecentGift`, `PhilanthropySummary` types; added `getPhilanthropy()` function

### Open questions / handoff notes

- Next: **ux-developer** — implement `src/app/members/impact/page.tsx`, nav card on `src/app/members/page.tsx`, and settings placeholder cleanup. Full spec in Phase 3 section of this work-log.
- The `getPhilanthropy()` function is entity-agnostic (queries across ALL funds matching the giving predicate, not scoped to a single entity). This matches the Phase 3 design for a blended "Club + Foundation" total. If the UX ever needs per-entity split, the query will need an `entityId` parameter — not needed for inc5.
- Test file location: `src/lib/ledger-impact.test.ts` (co-located with other test files in `src/lib/`). The Phase 3 design doc referenced `src/lib/__tests__/` but that directory does not exist — tests are co-located per the existing project convention.

---

## Phase 4c — Implementation (UI) — 2026-06-26

**Owner:** ux-developer
**Status:** complete

### What I did

- Created `src/app/members/impact/page.tsx` — Server Component with `export const dynamic = "force-dynamic"`. Gate pattern mirrors `src/app/members/dues/page.tsx` exactly: auth check → memberId inline state check → `Promise.all([getSettings(), hasFeature(...)])` → visibility redirect if `philanthropyVisibility === 'board'` and user lacks `impact.view`.
- Inner async `ImpactDashboard()` component calls `getPhilanthropy({ recentGiftsLimit: 8 })` and renders four sub-components: `ImpactHeadlineStats`, `ImpactByCause`, `ImpactByFiscalYear`, `ImpactRecentGifts`.
- CSS horizontal-bar list for by-cause breakdown — Tailwind-only, no charting library. Min bar width 2% enforced via `Math.max(cause.pct, 2)` so small values are visible at 360px.
- `formatDate()` parses `YYYY-MM-DD` with `new Date(year, month-1, day)` (avoids UTC shift).
- Dollar formatting uses `toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })` — whole-dollar display for all figures.
- Recent gifts rendered as a simple `<li>` list: `$X to [party] · [cause] · [date]`.
- Added the "Our Impact" nav card to `src/app/members/page.tsx` after "My Reimbursements", using `rounded-xl` to match existing portal cards.
- Removed `(inc5)` placeholder from `philanthropyVisibility` label in `src/components/admin/ledger/ledger-settings-form.tsx`; updated description to remove "future increment" language.
- All three gates passed: `pnpm exec tsc --noEmit` — 0 errors; `pnpm build:only` — production build clean, `/members/impact` appears in the route list; `pnpm test` — 267/267 passed.

### Files modified/created

- `/Users/cshenso/git/westervillelions/src/app/members/impact/page.tsx` — new file
- `/Users/cshenso/git/westervillelions/src/app/members/page.tsx` — added "Our Impact" nav card
- `/Users/cshenso/git/westervillelions/src/components/admin/ledger/ledger-settings-form.tsx` — removed `(inc5)` placeholder

### Open questions / handoff notes

- Phase 4 (implementation) is complete. Ready for **qa** Phase 5 verification.
- **Click-through path for qa:** sign in as a board member → member portal hub → click "Our Impact" → should see the impact dashboard with the hero, back link, headline stats, by-cause bars, by-FY table, and recent gifts. Sign in as a plain member when `philanthropyVisibility='board'` → should redirect to `/access-pending`. Sign in as a user with no linked `memberId` → should see the "Account Not Linked" inline state without a redirect.
- **Empty state:** if the local DB has no giving transactions yet, the page should render the empty state card ("No community giving has been recorded yet...") not zero-dollar cards.
- **Settings label copy:** "Member philanthropy visibility" with description "Controls which members can view the philanthropy impact dashboard." — the Lions Club may want to refine this phrasing.
- **Recent gifts `·` separator:** used `&middot;` for the separator between party / cause / date. If the Lions Club prefers a different separator (dash, pipe) that is a one-character change.

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-06-26

**Owner:** qa
**Status:** complete
**Verdict:** PASS

### Summary

All automated checks passed. TypeScript clean, production build clean with `/members/impact` appearing in the route list, 267/267 unit tests passing (including all 9 `ledger-impact` tests). The code audit confirmed every item in the checklist. The feature-gate audit confirmed the administrative-fund exclusion is enforced at the SQL layer via `inArray(ledgerFunds.kind, ['activity', 'charitable', 'scholarship'])` in both query round-trips — `kind='administrative'` cannot appear by omission. No protected routes were added by this feature (the page is a member portal Server Component, not an API route or server action), so the route-level gate audit reduces to confirming auth + hasFeature on the page itself. Both are present and correct.

### What I did

- Ran `pnpm exec tsc --noEmit` — 0 errors.
- Ran `pnpm build:only` — build clean; confirmed `/members/impact` (ƒ Dynamic) in route output.
- Ran `pnpm test` — 267/267 passed; `ledger-impact` test file confirmed present with 9 tests.
- Read `src/app/members/impact/page.tsx` in full — audited every checklist item.
- Read `src/lib/ledger.ts` — confirmed `isGiving()` present with cross-reference comment; confirmed no category-keyword filtering in the function body (fund-kind+flow+transferGroupId only).
- Read `src/lib/ledger-queries.ts` lines 1620–1832 — confirmed `getPhilanthropy()` SQL predicate uses `inArray(ledgerFunds.kind, ['activity', 'charitable', 'scholarship'])` at both query sites; confirmed `isNotNull(ledgerTransactions.party)` on the recent-gifts query (DECISION-024); confirmed cross-reference comment pointing to `isGiving()`; confirmed exactly 2 DB round-trips.
- Read `drizzle/migrations/0050_impact_view_permission.sql` — confirmed all 4 INSERT statements use `WHERE NOT EXISTS` guards (idempotent); confirmed bindings cover `admin`, `treasurer`, `board_member` (not `member` or `volunteer`).
- Confirmed `FEATURES.IMPACT_VIEW = "impact.view"` and matching `FEATURE_DESCRIPTIONS` entry present in `src/lib/permissions.ts`.
- Confirmed `(inc5)` placeholder removed from `src/components/admin/ledger/ledger-settings-form.tsx`.
- Confirmed "Our Impact" nav card present at `src/app/members/page.tsx` line 170.

### Outputs

- `/Users/cshenso/git/westervillelions/docs/work-log/2026-06-25-ledger-impact.md` — Phase 5 section written; Per-Phase Status table row updated.

### Code Audit Results

**`src/app/members/impact/page.tsx`:**
- `export const dynamic = "force-dynamic"` present (line 8). PASS.
- `auth()` called first; `!session?.user` → `redirect('/signin')` (line 29). PASS.
- `memberId = session.user.memberId ?? null`; `!memberId` → inline "Account Not Linked" state, NOT a redirect (lines 32, 66–74). PASS.
- `getSettings()` + `hasFeature(userId, FEATURES.IMPACT_VIEW)` in `Promise.all` (lines 37–40). PASS.
- `settings.philanthropyVisibility === 'board' && !canView` → `redirect('/access-pending')` (lines 42–44). PASS.
- No `window.confirm()`, `window.alert()`, `window.prompt()`. PASS.
- No `console.log` in production paths. PASS.
- No `lions-red` class. PASS.
- Cards use `rounded-2xl shadow-sm` (lines 111, 119, 135, 173, 209). PASS.
- Hero uses `py-12` (line 50). PASS.
- `Math.max(cause.pct, 2)` for minimum bar width (line 159). PASS.
- Empty state present for `allTimeCents === 0` (lines 87–93). PASS.

**`src/lib/ledger.ts`:**
- `isGiving()` present (line 288) with cross-reference comment pointing to `ledger-queries.ts` (lines 278–280). PASS.
- `isGiving()` only checks `flow`, `transferGroupId`, and `fundKind` — no category keywords anywhere in the function body. PASS.

**`src/lib/ledger-queries.ts`:**
- `getPhilanthropy()` SQL predicate uses `inArray(ledgerFunds.kind, ['activity', 'charitable', 'scholarship'])` (line 1713 and line 1811). PASS.
- Recent gifts query has `isNotNull(ledgerTransactions.party)` (line 1812). DECISION-024 honored. PASS.
- Cross-reference comment at `getPhilanthropy()` header pointing to `isGiving()` in `ledger.ts` (lines 1675–1676). PASS.
- Exactly 2 DB queries: `givingRows` (aggregate pass) + `recentRows` (recent gifts). No N+1. PASS.

**`drizzle/migrations/0050_impact_view_permission.sql`:**
- All 4 INSERT statements use `WHERE NOT EXISTS` guards. PASS.
- Binds to `admin`, `treasurer`, `board_member`. NOT `member` or `volunteer`. PASS.

### Feature-Gate Audit

This feature adds one page (`/members/impact`) — a Server Component, not an API route or server action. No `/api/` routes were added or modified.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /members/impact` (Server Component) | yes (line 28–29) | yes (line 39) | `FEATURES.IMPACT_VIEW` |

Additional gate: the page additionally gates on `settings.philanthropyVisibility === 'board'` before applying the `hasFeature()` check — when visibility is `'members'`, any signed-in user with a linked `memberId` passes without needing `impact.view`. This is the intended two-tier model (Phase 1 decision). The administrative-fund exclusion is enforced at the SQL layer — `kind='administrative'` is excluded by omission from the `inArray(['activity','charitable','scholarship'])` predicate in both SQL queries in `getPhilanthropy()`. No UI-layer filtering is relied upon for this exclusion.

### Findings

None — all checks passed.

### Open questions / handoff notes

- Ready for **analyst** Phase 6 (shipped-vs-intent review).
- Manual click-through is needed to confirm the three gate paths in a running browser: (1) board member sees dashboard; (2) plain member with `philanthropyVisibility='board'` is redirected to `/access-pending`; (3) user with no linked `memberId` sees "Account Not Linked" inline state. The automated checks cannot reach these paths.
- The page renders `ImpactDashboard` unconditionally when `memberId` is present (line 75), regardless of `canView`. When `philanthropyVisibility='members'`, `canView` is false but the dashboard still renders — this is by design (the visibility setting, not the permission key, controls member access in that mode). The logic is correct but worth noting explicitly for the analyst's review.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-06-26

**Owner:** analyst
**Status:** complete
**Verdict:** SHIP IT

### Summary

The shipped feature delivers exactly what Phase 1 described. The two-tier gate (board-only via `impact.view` / all-members via the `philanthropyVisibility` setting) is implemented correctly and verified at the SQL layer, not just the UI layer. All five Phase 1 decisions are honored: all-time headline + current-FY stats, LOWER()-normalized cause breakdown with CSS bar list, combined entity view, admin-fund hard excluded at query layer, named grant recipients in a "Recent gifts" section with null-party rows excluded from the list (DECISION-024). Brand consistency, empty state, and the settings placeholder cleanup are all accounted for. No material gaps.

### Comparison

- **New `impact.view` permission (admin / treasurer / board_member), bound via idempotent migration** — shipped. `drizzle/migrations/0050_impact_view_permission.sql` covers all four INSERT statements with `WHERE NOT EXISTS` guards; binds to `admin`, `treasurer`, `board_member` only. Matches.
- **Gate logic: logged-out → /signin** — shipped. `auth()` first, hard-coded redirect. Matches.
- **Gate logic: signed-in no memberId → inline "Account Not Linked"** — shipped. Inline card, NOT a redirect. Mirrors `dues/page.tsx` pattern. Matches.
- **Gate logic: `philanthropyVisibility='board'` + no `impact.view` → /access-pending** — shipped. `redirect('/access-pending')` at line 43. Matches.
- **Gate logic: `philanthropyVisibility='members'` → any signed-in member with memberId** — shipped. The `canView` variable is irrelevant in the `'members'` path; gate passes for any user with a `memberId`. Matches.
- **Dashboard at `/members/impact`** — shipped. Server Component, `force-dynamic`. Route confirmed present in production build output. Matches.
- **All-time headline total + current-FY total** — shipped. Two `bg-white rounded-2xl shadow-sm` stat cards. Dollar amounts in `text-3xl font-bold text-lions-blue`. Matches.
- **By-cause breakdown (CSS bar list)** — shipped. Tailwind-only `<ul>` with inline-style width on a `bg-lions-blue h-2.5` bar. Min 2% bar enforced via `Math.max(cause.pct, 2)`. Cause labels normalized via `LOWER(TRIM(...))` at SQL layer. "Other community support" for null/empty cause. Matches.
- **By-fiscal-year list** — shipped. `<table>` with `overflow-x-auto` wrapper. Mobile-safe. Matches.
- **Recent named gifts section (party field, expense-side only)** — shipped. Simple `<li>` list: `$X to [party] · [cause] · [date]`. Null-party rows excluded by `party IS NOT NULL` at SQL layer (DECISION-024). Matches.
- **Combined entity view (Club + Foundation blended)** — shipped. `getPhilanthropy()` queries all funds matching `kind IN ('activity','charitable','scholarship')` regardless of entity. Matches.
- **Administrative fund hard-excluded at query layer** — shipped. `inArray(ledgerFunds.kind, ['activity','charitable','scholarship'])` excludes `'administrative'` by omission in both query round-trips. Enforcement is SQL-layer, not UI-layer. Matches (and satisfies the architect's security note from Phase 2).
- **`(inc5)` settings placeholder cleaned up** — shipped. Removed from `src/components/admin/ledger/ledger-settings-form.tsx`. Matches.
- **"Our Impact" nav card on member portal hub** — shipped. Added after "My Reimbursements" on `src/app/members/page.tsx` using `rounded-xl` to match existing portal cards. Matches.
- **`isGiving()` pure helper authored in `src/lib/ledger.ts`** — shipped. Fund-kind + flow + transferGroupId check only (no category keywords). Cross-reference comment to `ledger-queries.ts` present. 9 Vitest tests. Matches Phase 1 finding and Phase 3 spec.

### Edge cases

| Check | Verdict |
|---|---|
| Empty state (`allTimeCents === 0`) | Pass — empty state card with human copy; by-cause / by-FY / recent gifts sections suppressed. |
| Failure microcopy (network/DB down) | Not applicable — Next.js Server Component error boundary handles this; no custom error card was specified in Phase 1. Acceptable. |
| Permission gate (no `impact.view`, `board` visibility) | Pass — redirect to `/access-pending`. |
| Permission gate (no `memberId`) | Pass — inline "Account Not Linked" card, no redirect. |
| Brand consistency (cards `rounded-2xl`, buttons `rounded-lg`, no `rounded-full`, no `lions-red`) | Pass — confirmed by QA code audit. |
| Mobile (360px) | Pass — CSS bar list Tailwind-only, no charting dep; by-FY table has `overflow-x-auto`; grid is `sm:grid-cols-2` (single column on mobile). |
| Admin-fund firewall (SQL layer) | Pass — `inArray(['activity','charitable','scholarship'])` in both query round-trips; no UI-layer reliance. |
| Open-redirect surface | Pass — both redirect targets hard-coded (`/signin`, `/access-pending`); no `callbackUrl` or `next` param. |

### Follow-up items (if SHIP WITH NOTES)

None. No follow-up items.

### What I did

- Re-read Phase 1 review, Phase 2 architectural ruling, Phase 3 technical design, Phase 4a/4b/4c implementation notes, and Phase 5 QA report in full.
- Read `src/app/members/impact/page.tsx` in full.
- Walked every Phase 1 flow against the implementation: all gate paths present and correct; all five Phase 1 decisions honored; all Phase 1 gaps resolved.
- Confirmed DECISION-024 (null-party exclusion from recent gifts) is logged and implemented.
- Confirmed the QA feature-gate audit covers the only new route (`/members/impact`).
- Confirmed no residual Phase 1 gaps were left unaddressed or silently deferred.

### Outputs

- `/Users/cshenso/git/westervillelions/docs/work-log/2026-06-25-ledger-impact.md` — Phase 6 section written; Per-Phase Status table updated.

### Open questions / handoff notes

- The architect's Phase 2 security note (named grant recipients widening `party` readability to all signed-in members) is flagged for the next 30-day security review. No action needed before shipping — the exposure is intentional and the admin-fund exclusion is enforced at the SQL layer. The security review should confirm that no `party` value on giving rows contains individual PII (expected: organization names only).
- A future increment (inc7 candidate) could expose this dashboard on the public website as an anonymous "Our Impact" page. The data model and query are already suitable; only the auth gate and route placement would change.
- Export/PDF of the impact dashboard (requested in Phase 1 out-of-scope list) remains a candidate follow-up.

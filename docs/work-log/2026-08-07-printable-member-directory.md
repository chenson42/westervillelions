# Printable Member Directory (+ address on the directory) — Work Log

> **Slug:** `2026-08-07-printable-member-directory`
> **Surface:** member portal — `/members` (directory)
> **Permission(s):** existing `members.view` — newly ENFORCED on `/members` (see Treasurer Decisions); no new key
> **Estimated complexity:** small–medium
> **Pipeline mode:** **Accelerated recommended.** No schema change (address columns already exist), no new dependency (the `window.print()` / no-PDF-library precedent is locked by `print-statement-button.tsx`'s own doc comment), no new directory or route (one new print-styled component + one gate check, following `budget-print-worksheet.tsx`'s `print:hidden`/`hidden print:block` convention). Architect's Phase 2 should be a fast confirmation, not a structural review — nothing here adds a dependency, a top-level directory, or a new server/client boundary pattern. Tech-lead's Phase 3 still needs to do real work: lock the print typography numbers, the `MEMBERS_VIEW` gate decision, and the four open questions above into a design doc before implementation — this isn't small enough to skip Phase 3 outright.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-08-07 |
| 2 — Architectural review | architect | **Skipped** | see rationale | 2026-08-07 |
| 3 — Technical design | tech-lead | **Abbreviated** (coordinator) | — | 2026-08-07 |
| 4 — Implementation | full-stack-developer | complete | — | 2026-08-07 |
| 5 — Verification | qa | complete | FAIL — header renders in print, loop back to Phase 4 | 2026-08-07 |
| 6 — Shipped vs intent | analyst | complete | SHIP WITH NOTES | 2026-08-07 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Add a mailing-address column to the (already-existing) online directory and a `window.print()` "Print / Save as PDF" button that renders a readable, alphabetical, two-column roster — the hard parts (address self-service, schema, and the no-PDF-library precedent) are already solved; what's undecided is exact print typography, who gets to see the new address field, and a few scope calls Phase 3 needs to lock down.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | Views the online directory at `/members` (existing — unchanged except the row now includes address) | on demand |
| Signed-in member | Edits their own **Street Address / City / State / ZIP** on `/members/profile` (existing, already wired — confirmed below) | occasional |
| Signed-in member | Clicks a new **"Print Directory"** button on `/members`, which calls `window.print()` (no new page/route — same pattern as `PrintStatementButton`) | occasional, mostly around board meetings/events |
| Signed-in member (mobile) | Uses the OS print sheet to choose "Save as PDF" instead of a physical printer | occasional |

No admin or anonymous-visitor verb is implicated — this is entirely inside the signed-in member portal.

## Flows

**Flow 1 — View & search the online directory (existing, unchanged):** entry `/members` (nav tile) → member searches/filters by name, branch, or group → outcome: cards show name, group/board tags, email, phone, **+ address (new)**.
- Failure: filtering to zero results shows "No members found — Try adjusting your search or filter criteria" (`src/components/members/member-directory.tsx:326-332`). That copy is also what a *genuinely empty club* (zero members, fresh install) would see, which is misleading ("adjust your filter" when there's nothing to adjust) — pre-existing, not introduced by this feature, but worth a one-line fix while this component is already open.

**Flow 2 — Update my own mailing address (existing, confirmed complete):** entry `/members/profile` → member edits **Street Address / City / State / ZIP** (already present in `src/components/members/profile-form.tsx:109-148`) → clicks **Save Changes** → `PUT /api/members/profile` persists `address/city/state/zip` to the same `members` columns the directory reads (`src/app/api/members/profile/route.ts:57-71`) → outcome: green "Saved!" text + `toast.success("Profile updated successfully")`.
- Failure: request throws → `toast.error(err.message || "Failed to save profile")` (route.ts:74-77, profile-form.tsx:56-57). This is a real, human failure message, not a stack trace.
- **This clause of the request needs no new work.** It is member-editable (not admin-only), fully wired end-to-end, and already uses the exact columns (`members.address/city/state/zip`, `schema.ts:27-30`) the directory would read from. Say so and move on.

**Flow 3 — Print / save the roster as PDF (new):** entry: "Print Directory" button on `/members` → click triggers `window.print()` (no new fetch — the print view reveals data the page already fetched server-side, following `print:hidden`/`hidden print:block` convention used in `budget-print-worksheet.tsx`) → browser's native print dialog opens showing the two-column, print-styled roster → outcome: member prints to a physical printer, or picks "Save as PDF" as the destination.
- Failure: **no members to print** (filtered-to-zero or brand-new install) has no defined behavior today — needs explicit copy ("No members to display") rather than a blank page. Undefined until Phase 3.
- Failure/friction, mobile: on **Android Chrome**, "Save as PDF" is a first-class entry in the print destination list — this works as plainly as "download a PDF." On **iOS Safari**, there is no direct "Save as PDF" destination; the user must open the print preview, pinch-open the thumbnail to get a full-page view, then use the share icon to save to Files. That's meaningfully worse for the "older members, on a phone" audience the treasurer specifically flagged — but it is the *identical* tradeoff already accepted for `PrintStatementButton`, so it's inherited risk, not new risk. Flagging, not blocking.

## Permissions

- **Permission:** existing `FEATURES.MEMBERS_VIEW` (`"members.view"`, `src/lib/permissions.ts:12`) covers directory visibility conceptually — but it currently **does not gate the page that will show the new address column.**
- **What I found, verified against the live DB:** `src/app/members/page.tsx` has no `hasFeature()` check at all — only `if (!session?.user) redirect("/signin")` (line 12-14). `MEMBERS_VIEW` today only gates the *admin* members list (`src/app/api/admin/members/route.ts:31`) and the private-event `.ics` download (`src/app/api/events/[id]/ics/route.ts:61`). Any signed-in session — including a brand-new account with **zero granted features**, the exact population `/access-pending` exists to catch — can browse `/members` today and see every member's email and phone. This is a pre-existing gap, not something this feature creates.
- **Why it matters now:** adding a home mailing address to that same, effectively ungated surface meaningfully raises the stakes of the gap. Email/phone are already semi-public in most club contexts; a printed sheet of every member's home address is a different order of exposure.
- **Cost of closing it is close to zero.** I queried the live DB: `members.view` is already bound to the `admin`, `board_member`, and `member` roles (`role_features` join). Every one of the 52 users with any role at all holds at least one of those three (`user_roles` join, see below) — no currently-legitimate member would lose access by adding `hasFeature(session.user.features, FEATURES.MEMBERS_VIEW)` to `/members/page.tsx` per the standard pattern in CLAUDE.md. It would only block the zero-role/mid-onboarding accounts `/access-pending` is designed for.
- **Recommendation:** bundle a one-line gate (`redirect("/access-pending")` on missing `MEMBERS_VIEW`) into this feature's Phase 3/4 scope rather than filing it separately — it's the same file this feature is already touching, and it's the thing that makes "add a home address to the directory" safe to ship. Posed as an open question below since it's technically adjacent scope, not what was literally asked for.
- **Default roles:** no new feature key needed. `admin`, `board_member`, `member` already carry `members.view`; no change to role bindings required.

## Gaps the Request Didn't Address

- **The `/members` access gate (above).** Why it matters: printing a home-address roster from a page any signed-in account can reach — regardless of granted features — undercuts the privacy expectation implicit in "board members should be in it" (i.e., this is club-internal, not public). Resolution: add the `MEMBERS_VIEW` gate as part of this feature's implementation (see Permissions).
- **Readability vs. multi-column density (his own tension).** Concrete resolution, not "make it legible": **US Letter, portrait, 2 columns** (not 3+ — a 3rd column forces ~2.5in column width, which with a full street address either wraps awkwardly or forces sub-10pt type, which directly fights "older people have a hard time reading"). Name **bold, ~13pt**; email/phone/address lines **~11pt**, set in a dark, high-contrast ink (screen currently uses `text-gray-600` for contact lines — fine on a backlit screen, too light once toned down by a printer/toner-saver; print copy should be near-black). Line-height ~1.35. Three lines per entry: (1) **Last, First** + board/group tag, (2) email · phone, (3) street, city ST ZIP. No gridlines/box rules at all — a spreadsheet reads as rules-and-cells to an older reader; a single thin hairline *between* entries (not a full table) plus generous whitespace reads as a roster. Alphabetical section jump-letters (bold "A", "B"…) as anchors instead of a sortable-table header row. At ~0.78in per entry and ~9in of usable column height, that's **~11 entries per column, ~22 per page** in 2 columns. **41 active members today** (verified via DB: 41 active, 0 prospective, 7 ended/excluded) → roughly **2 pages**, with headroom to ~55-60 members before a 3rd page is needed. Lock these numbers in Phase 3 rather than leaving "readable" undefined.
- **Board members are already in the online directory today — confirmed, not a bug.** `/members/page.tsx` fetches "groups shown in directory" (`showInDirectory=true`) and tags members accordingly (lines 21-67). I queried the live DB: the "Board of Directors" group has `show_in_directory=true` and `show_position_as_tag=true`, and all 12 members with a non-null `boardPosition` (President, Treasurer, 1st/2nd VP, Directors, etc.) are correctly linked to it — they already show up on-screen tagged with their actual position (e.g., "President," "Treasurer"), because the base member query (`membershipStatus IN ('active','prospective')`) never excludes them. **The gap is print-only:** the printed roster needs to carry that same group/position tag through, or the treasurer's ask ("board members should be in the printable directory as well") won't actually be satisfied even though the underlying data problem doesn't exist.
- **Generated-on date / club header / page numbers.** Not mentioned in the request. Every other printable surface in this app (`budget-print-worksheet.tsx`, the financial-statement print flow) is a board-facing document with this kind of framing. Recommend: club name/logo header, "Directory as of [date]" line, and page X of Y footer — cheap, and it's what makes a printed roster look official rather than like a screenshot.
- **Empty/one-member states on print.** Not addressed — needs explicit copy for zero members and should render cleanly (not break the 2-column grid) for exactly one member. Small but must be decided in Phase 3, not discovered in QA.
- **Whether prospective and non-board group tags print.** The online directory shows tags for *any* group with `showInDirectory=true` (currently: Board of Directors, Modernization — Pizza Tasting Committee is `showInDirectory=false`). Recommend the print view mirror the same set for consistency, kept terse (small parenthetical, not a full badge) so it doesn't fight the density budget above. Needs an explicit decision, not an implicit "whatever's easiest."
- **Whether "Print Directory" prints the full roster or the current on-screen filtered view.** If a member has typed a search term or picked a branch filter when they click Print, should the printed sheet reflect that subset, or always print everyone? Given the request describes "the member directory" as a roster document (not a search result), recommend the print action always renders the full, unfiltered active+prospective roster — but this needs to be an explicit decision, since the obvious naive implementation (print whatever's currently rendered) would silently produce a wrong roster if someone had a filter active.
- **New-endpoint risk.** Flagging so Phase 3 rules it out explicitly: the print view should render from the *same server-fetched member list* `/members/page.tsx` already passes to `MemberDirectory` (mirroring how `PrintStatementButton` prints already-rendered DOM), not a new API route. A new `/api/members/print` endpoint would be a second, easier-to-forget-to-gate surface for the same PII this Phase 1 review is already flagging.

## Out of Scope (confirm with user)

- A per-member "exclude me from the printed directory" or "exclude my address" opt-out flag. No such column exists on `members` today, and the request doesn't ask for one. The online directory has never had an opt-out for email/phone either, so this isn't a new asymmetry — but a printed, physically-portable document is a different risk class than a screen. Recommend shipping v1 without it (matches existing precedent) but flagging it explicitly rather than silently deciding for the treasurer.
- Any change to who can *edit* another member's address (admin-side member edit) — the request is about self-service, which already works.
- Landscape orientation, letter-size envelopes/labels, or any output format beyond the browser print dialog.
- Sync of address changes to Google Groups — address isn't a Group-sync attribute; not implicated by this feature.

## Open Questions

- **Bundle the `/members` `MEMBERS_VIEW` gate into this feature, or file it as its own quick work-log entry first?** I recommend bundling it (same file, zero cost to real users per the DB check above), but it's adjacent scope to what was literally requested, so I want it on the record as your call, not mine.
- **Should the print roster include `prospective` members** (same status filter as the online directory), or only fully `active` members? Zero prospective members exist today, so this is invisible until the club has one — better to decide now than discover the mismatch later.
- **Does the treasurer want any group tag besides Board of Directors on the printed sheet** (e.g., Modernization committee), or should print show board position only, keeping the sheet as lean as possible?
- **Is a v1 without a per-member print/address opt-out acceptable**, given the artifact now physically leaves the building? A plain "yes, ship without one" is a fine answer — I just want it said out loud rather than assumed.

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions

- Permission key(s): `area.action`
- Default role bindings: [list]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → add migration in `drizzle/migrations/` and update `src/lib/db/schema.ts`
2. `FEATURES` entry in `src/lib/permissions.ts` + role binding migration
3. Route handlers / server actions
4. UI
5. Email notification (if applicable) — enqueue via `sendEmail` in `src/lib/email.ts`
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

---

# Phase 4 — Implementation

**Owner:** full-stack-developer
**Status:** complete
**Date:** 2026-08-07

### Summary

Enforced the missing `members.view` gate on `/members`, added address to the on-screen directory
(never rendering an empty label or stray comma), and built a print-only two-column roster —
active members only, alphabetical jump-letters, board position tag — with a `window.print()` button,
mirroring `print-statement-button.tsx` / `budget-print-worksheet.tsx`. No schema change, no new
dependency.

### What I did

- Added the `hasFeature(session.user.id, FEATURES.MEMBERS_VIEW)` gate to `/members/page.tsx`,
  placed **before** any DB query (redirects to `/access-pending`), following the
  `permissions-server` convention already used on `/members/impact`.
- Extended the page's `membersWithTags` mapping to carry `address/city/state/zip/boardPosition`
  through to both the on-screen directory and a new active-only, last-name-sorted `printMembers`
  array (Treasurer Decision #2).
- Added a `formatCityStateZip` / `hasAnyAddress` helper (`src/lib/member-address.ts`) shared by both
  the on-screen and print views, so the "no stray comma / no empty label" rule lives in one place.
- Rendered address on the on-screen `MemberDirectory` cards (new address block, location-pin icon,
  only shown when at least one address field is present).
- Built `MemberDirectoryPrint` (`hidden print:block`, server component) — US Letter, CSS multi-column
  (`columns-2`) roster grouped by first letter of last name, 13pt bold "Last, First", small uppercase
  board-position tag, 11pt contact block (email / phone / street / city-state-zip, each line omitted
  if absent), club header with a generated-on date, thin per-entry hairline (no gridlines/zebra),
  `break-inside-avoid` on every entry and `break-after-avoid` on jump-letter headings.
- Built `PrintDirectoryButton` (client leaf, `window.print()`, `print:hidden`), mirroring
  `PrintStatementButton` exactly.
- Wrapped the rest of `/members` (hero, quick-links grid, birthdays, interactive `MemberDirectory`,
  the print button itself) in `print:hidden` so only the new print view survives into the print/PDF
  output, per the shape locked in Phase 3.

### Outputs

- `src/app/members/page.tsx` — added the `MEMBERS_VIEW` gate (before any query), address/boardPosition
  fields on `membersWithTags`, `printMembers` (active-only) + `generatedOn`, `print:hidden` wrappers,
  and rendering of `PrintDirectoryButton` + `MemberDirectoryPrint`.
- `src/components/members/member-directory.tsx` — `Member` interface gained
  `address/city/state/zip`; new conditional address block on each card.
- `src/components/members/member-directory-print.tsx` (new) — the print-only roster view.
- `src/components/members/print-directory-button.tsx` (new) — client leaf, mirrors
  `print-statement-button.tsx`.
- `src/lib/member-address.ts` (new) — `formatCityStateZip` / `hasAnyAddress`, shared by both views.
- No schema change (`members.address/city/state/zip` and `members.boardPosition` already existed).
  No migration. No new `FEATURES` key — reused existing `members.view`.
- No new npm dependency — `window.print()` only, per the locked precedent.

**Tests written (Phase 3's named unit tests):**
- `src/app/members/page.test.ts` — the gate: no session → `/signin` before any check; session lacking
  `members.view` → `/access-pending` before any DB query (`db.query.members.findMany` asserted never
  called in both cases); session with `members.view` → no redirect, query proceeds.
- `src/components/members/member-directory.test.tsx` — address-omitted-when-null rendering: full
  address renders with no stray comma, all-null renders no address block at all, partial combinations
  (street-only, city/state/zip-only) each render correctly without stray punctuation.
- `src/lib/member-address.test.ts` — pure unit coverage of the shared formatting helper (all
  present/partial/absent combinations), since both rendering tests above depend on it being correct.

### Deviations from the Phase 3 design (and why)

1. **Line grouping on the print entry differs slightly from Phase 1's literal "3 lines" example.**
   Phase 1 sketched "(2) email · phone" as one combined line and "(3) street, city ST ZIP" as another
   combined line (3 lines total). Phase 3's abbreviated design superseded that with "email, phone,
   then address across up to 2 lines" (implying up to 5 lines: name+tag, email, phone, street,
   city/state/zip). I followed **Phase 3** (the later, more authoritative doc) and gave email, phone,
   street, and city/state/zip each their own line, each independently omitted when absent — this
   reads cleaner for the "older members" audience than cramming two fields per line with a middot
   separator, at the cost of slightly more vertical space per entry than Phase 1's original page-count
   math assumed. With only 12 of 41 active members carrying a board tag, and many members missing one
   or more address fields, the actual footprint should land close to Phase 1's ~2-page estimate, but I
   did not re-verify exact page count on a real print — flagged for qa/treasurer to confirm.
2. **Page numbers are not implemented via CSS.** Chromium/WebKit's print engine does not implement CSS
   Paged Media margin boxes (`@page { @bottom-center }`), and `budget-print-worksheet.tsx` — the
   explicit precedent this component mirrors — also doesn't attempt this. Page numbering relies on the
   browser's own "Headers and footers" print-dialog option (on by default in Chrome/Edge/Safari), not
   on anything this component renders. Documented in the component's own doc comment.
3. **Print button label** is "Print Directory / Save as PDF" (vs. `PrintStatementButton`'s "Print /
   Save as PDF") — surfaced which document is being printed, since `/members` will eventually have
   more than one printable surface.
4. Print CSS itself was not machine-verified (not possible in this project, per Phase 3) — needs a
   real print/Save-as-PDF check by the treasurer.

### Gates

- `pnpm exec tsc --noEmit`: **PASS** (clean).
- `pnpm test`: **PASS** — 958 passed (40 files), up from the 943 baseline with no regressions (15 new
  tests: 8 in `member-address.test.ts`, 4 in `member-directory.test.tsx`, 3 in `page.test.ts`).
- `pnpm build:only`: **PASS** — production build succeeds; `/members` compiles as a dynamic route with
  no errors or warnings.

### Open questions / handoff notes for qa (Phase 5)

- **Cannot be verified by automated tests — needs a real browser print/Save-as-PDF check:** 2-column
  US Letter layout, jump-letters, entry `break-inside: avoid` (no entry split across a column/page),
  board-position tags on the 12 board members, no gridlines/zebra striping, and roughly the ~2-page
  count Phase 1 estimated for 41 active members.
- Click-through: sign in as a plain `member`-role account, confirm `/members` still loads (not
  redirected) since all 52 users with any role already hold `members.view` per Phase 1's DB check;
  then click "Print Directory / Save as PDF" and inspect the browser print preview.
- Verify a member profile with no address at all still renders cleanly on-screen (no empty
  label/comma) and in print (entry just has fewer lines, no orphaned address section).
- Verify the `/access-pending` gate: temporarily strip `members.view` from a test user's role (or
  reason from the code path, since Phase 1 confirmed no real user is currently affected) to confirm
  the redirect actually fires end-to-end, not just in the unit test.
- Nominate **qa** for Phase 5.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-07
**Verified by:** qa

## Summary

**Verdict: FAIL.** Everything Phase 1/3 asked for on the *content* side of the printed roster is
correct and now proven with a real generated PDF — 2 columns, alphabetical jump-letters, 41 active
members, all 12 board-position tags, no gridlines, no stray comma on incomplete addresses — and the
permission gate is genuinely gate-before-query, confirmed both by reading `page.tsx` directly and by
signing in as a real zero-role account. But the print output has a real, screenshot-and-PDF-verified
defect the review explicitly asked me to check for: the site's global nav header (logo, Donate, Admin,
Member Portal, Sign Out, hamburger button) renders at the top of page 1 of the actual PDF, above the
"Westerville Lions Club / Member Directory" print header. `src/components/layout/header.tsx`'s
`<header>` has no `print:hidden` — unlike `footer.tsx`, which does. This is a pre-existing gap in a
shared component (not touched by this feature's Phase 4 diff), but it directly breaks this feature's
own explicit requirement that "the screen-only chrome is gone in print: ... nav/header." Filed as a new
regression e2e test that reproducibly fails on current code; hand back to the implementer.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (clean, no output).

## Unit Tests

`pnpm test`: **PASS**
Total: 958 | Passed: 958 | Failed: 0 (40 files)
Duration: ~1.1s
Matches the work-log's claimed baseline exactly (958 passed, 40 files, 15 new tests across
`member-address.test.ts`, `member-directory.test.tsx`, `page.test.ts`). No regressions.

## Production Build

`pnpm build:only`: **PASS**. Production build succeeds, no warnings or errors in the build log.
`/members` compiles as a dynamic (`ƒ`) route alongside the rest of the member portal. Route count and
shape match the rest of the app — nothing unexpected.

## End-to-End Tests

`pnpm test:e2e`: **FAIL on one new test (intentional regression evidence)** — see below.
Total: 85 | Passed: 51 | Failed: 6 | Skipped: 1 | Did not run: 27 (cascading skips inside serial
`describe` blocks whose first test in the file failed — expected behavior, not new)
Duration: 1.1m

Of the 6 failures, **5 exactly match the documented known-bad baseline**: `budget-star-notes`,
`budgeting-restructure`, `cancel-occurrence`, `prior-year-cause-line-reconcile`,
`transaction-budget-line-link`. `admin-security` did not run in this pass (consistent with its
documented intermittent status). **The 6th failure is my own new regression test**
(`e2e/member-directory-print.spec.ts:42`), written and confirmed red on the current code to document
the header-in-print bug above — see Regression Tests Added. No other new failures. The other two new
tests in the same file (2-column layout + screen-chrome-hidden; real `page.pdf()` generation with no
console errors) both pass.

## Manual / Real-Browser Print Verification

Ran a live Playwright session against `pnpm dev` (not just DOM assertions): signed in as the real
`E2E_ADMIN` account, navigated to `/members`, called `page.emulateMedia({ media: 'print' })`, and
generated a real PDF with `page.pdf({ format: 'Letter', printBackground: true })`.

**PDF saved to:** `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/6e9d0d17-5851-4a8f-b3c5-78259abe1286/scratchpad/member-directory.pdf`
(page renders also saved as `page-1.png` … `page-4.png` in the same directory for visual inspection.)

| Check | Result | Observation |
|---|---|---|
| Column count | **PASS** | `getComputedStyle(...).columnCount === "2"` — genuinely 2 columns, not 3+. |
| Entries split across column/page break | **PASS** | Visual inspection of all 4 rendered pages shows no entry cut mid-block; `break-inside-avoid` holds. |
| Print button hidden | **PASS** | Ancestor-aware visibility check (own + all ancestor `display`/`visibility`) confirms not rendered. |
| Search box / interactive directory hidden | **PASS** | Same check — not rendered under print media. |
| Toast container hidden | **PASS** | No `[data-sonner-toaster]` node present at all on this page load (nothing to hide); the global `@media print` rule in `globals.css` is confirmed present and unconditional. |
| **Site nav/header hidden** | **FAIL** | **Confirmed rendered.** Screenshot of PDF page 1 shows the full site header (Lions logo, Donate, Admin, Member Portal, Sign Out, hamburger) above the "Westerville Lions Club" print header, eating real estate on page 1. `header.tsx`'s `<header>` (line 32) has no `print:hidden`; `footer.tsx`'s `<footer>` does (line 6). Root cause confirmed by reading both files directly, not inferred. |
| Club header / generated-on date | **PASS** | "Westerville Lions Club" + "Member Directory • Generated August 7, 2026" render correctly. |
| Page numbers | **N/A, documented deviation** | Phase 4 correctly notes Chromium doesn't implement CSS Paged Media margin boxes; relies on the browser's own print-dialog "Headers and footers" toggle, same as `budget-print-worksheet.tsx`. Not a defect. |
| Board-position tag | **PASS** | All 12 active board members (verified against the live DB's 12-member board count) show their tag: e.g. `TAIL TWISTER/IPP`, `MEMBERSHIP CHAIR`, `LION TAMER`, `1ST YEAR DIRECTOR` ×2, `SECRETARY`, `2ND VICE PRESIDENT`, `TREASURER`, `PRESIDENT`, `1ST VICE PRESIDENT`, `2ND YEAR DIRECTOR` ×2. |
| Page count | **4 pages**, not the Phase 1 estimate of ~2 | Reported as the actual count, not assumed. Root cause: Phase 4's documented deviation #1 (5-line entries — name, board tag, email, phone, street, city/state/zip each on their own line — instead of Phase 1's denser 3-line sketch) costs more vertical space per entry than the original page-count math assumed. This is **not a new defect** — it was disclosed by the implementer as an unverified assumption in the Phase 4 handoff, and I'm now closing that open question with a real number. 4 pages for 41 members on a document meant to be kept for months is still reasonable and legible; not blocking on its own. |

## On-Screen Verification (not just print)

| Check | Result | Observation |
|---|---|---|
| Address renders on `/members` cards | **PASS** | Confirmed via the passing unit tests in `member-directory.test.tsx` (full/partial/absent address combinations, no stray comma) plus live-data corroboration: the printed PDF shows a real member ("Blaine, John") whose city/state render with no ZIP and no stray comma, exercising the exact `formatCityStateZip` partial-data path against production-shaped data, not just a synthetic fixture. |
| Mobile at 360px | **PASS** | Screenshot at 360×800 shows single-column stacking, no horizontal overflow (`document.documentElement.scrollWidth <= clientWidth` confirmed programmatically). |
| Permission gate — code path | **PASS** | Read `src/app/members/page.tsx` directly: `auth()` → redirect to `/signin` if no session (line 16-18) → `hasFeature(session.user.id, FEATURES.MEMBERS_VIEW)` → redirect to `/access-pending` if false (line 26-28) — **both checks run before the first `db.query.members.findMany` call** (line 30). No fetch-then-hide. |
| Permission gate — live browser | **PASS** | Created a disposable zero-role user directly in the dev DB (`qa-zero-role-temp@example.test`, no `user_roles` row), signed in through the real `/signin` credentials form in a live browser, and confirmed landing on `/access-pending` with no member data anywhere in the page body. Deleted the temp user immediately after. This is the "not just the unit test" check the Phase 4 handoff asked for. |
| Permission gate — role-binding safety net | **PASS** | Re-queried the live DB: 0 users currently have zero roles, so enforcing this gate locks out no real user today, consistent with Phase 1's finding. |

## Regression Tests Added

- `e2e/member-directory-print.spec.ts:42` — **"the site's global nav header is hidden under print
  media"** — guards against: the site's global nav (logo/Donate/Admin/Member Portal/Sign Out) rendering
  above the printed member roster because `src/components/layout/header.tsx`'s `<header>` lacks
  `print:hidden` (unlike `footer.tsx`, which has it). **Currently RED on `main` + this feature's diff** —
  written and confirmed failing before any fix, per regression discipline. Will go green once the
  implementer adds `print:hidden` to `header.tsx` line 32.
- `e2e/member-directory-print.spec.ts:20` — 2-column layout + screen-chrome-hidden-under-print — passes;
  guards against the print roster regressing to 1 or 3+ columns, or the search box/print button leaking
  into the printed page.
- `e2e/member-directory-print.spec.ts:79` — real `page.pdf()` generation with zero console errors —
  passes; guards against a client-only crash (e.g. a hook misuse in the print component) that would only
  surface when the browser actually renders print media, not on a normal page load.
- `src/app/members/page.test.ts` (written by Phase 4, verified by me) — the three-way gate test
  (no session / lacking `members.view` / has `members.view`), each asserting `db.query.members.findMany`
  was never called on the two redirect paths. Read and executed; correctly hermetic (mocks `@/lib/auth`,
  `@/lib/permissions-server`, `@/lib/db`, and every child component).

## Coverage on Touched Modules

- `src/lib/member-address.ts` — not captured by name in the coverage report path grouping (rolled into
  the `lib` bucket), but every branch of `formatCityStateZip`/`hasAnyAddress` (full/partial/absent ×
  each field) is exercised in `member-address.test.ts`, and corroborated against real data in the
  generated PDF (see "Blaine, John" above). Effectively 100% on the branches that matter.
- `src/components/members/member-directory.tsx` — 60% statements / 40.78% branch in this run's targeted
  coverage pull. The uncovered branches are pre-existing filter/search/badge logic this feature didn't
  touch; the new address block (the only code this feature added to this file) is covered by all 4
  presence/absence combinations in `member-directory.test.tsx`.
- `src/app/members/page.tsx` — 44.89% statements / 15.55% branch in the targeted pull, which reflects
  the large amount of unrelated JSX in this file (birthdays, quick-links grid, hero). The
  security-critical gate logic specifically — the three branches at lines 16-28 — is 100% branch-covered
  by the three cases in `page.test.ts`, each asserting the DB was never queried on a redirect path. Low
  whole-file coverage here is a JSX-bulk artifact, not a gate-testing gap.

## Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /members` (page) | yes (line 14, redirects to `/signin` if absent) | yes (line 26, redirects to `/access-pending` if false) — **runs before the first DB query**, confirmed by direct code read | `FEATURES.MEMBERS_VIEW` — correct: this route returns bulk PII (every active/prospective member's email, phone, and now home address), and `members.view` is the key that already restricts admin's member roster export elsewhere in the app. |

No new API route or server action was added by this feature (the print view renders from data the page
already fetched — no `/api/members/print` endpoint, per the Phase 1 review's explicit "new-endpoint
risk" call-out, confirmed not present). This is the only protected surface this feature touches.

## Verdict

**FAIL** — one confirmed defect (site nav header renders on the printed page, contradicting this
feature's own "screen-only chrome must be gone in print" requirement), evidenced by a real generated PDF
and a new, currently-red regression test. Every other checked flow — column layout, entry-split
avoidance, board tags, generated-on date, address rendering (screen + print), permission gate (code path
+ live zero-role account), mobile 360px, typecheck, unit tests, production build — passes cleanly.
Hand back to the implementer with a one-line fix: add `print:hidden` to the `<header>` className in
`src/components/layout/header.tsx` (mirroring `footer.tsx`'s existing pattern), then re-run
`pnpm test:e2e -- e2e/member-directory-print.spec.ts` to confirm the regression test goes green. Because
`header.tsx` is a shared, app-wide component, this fix will also correct the same latent defect on every
other existing print surface (`budget-print-worksheet.tsx`, the financial-statement print flow) —
worth a one-line mention in that commit, not a separate work-log entry.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-08-07
**Reviewed by:** analyst

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The treasurer's four literal asks (print a PDF, name/email/phone/address with self-service editing, board members included, readable for older eyes) are all genuinely delivered — verified against real generated PDFs, not just code — and the one qa-caught defect (site nav bleeding onto the printed page) is fixed and independently re-confirmed by me, both by re-running the regression e2e test and by generating a fresh post-fix PDF; the only open item is that the fix's app-wide blast radius (two other board-facing print documents) was reasoned about but never actually re-printed to confirm.

## Independent Verification I Did (not just re-reading qa's report)

- Read `src/app/members/page.tsx`: `hasFeature(session.user.id, FEATURES.MEMBERS_VIEW)` (line 26) runs after only the session check and strictly before the first `db.query.members.findMany` (line 30). Gate-before-query confirmed by direct read, matching qa's claim.
- Read `src/components/layout/header.tsx`: `print:hidden` is present on the `<header>` (line 36), with a code comment explicitly naming the blast radius (member directory, budget worksheet, financial statements). This is an uncommitted working-tree change (`git diff` confirms it, `git status` shows `M`), not yet on `main` — noted for whoever pushes.
- I noticed the qa-saved screenshots (`page-1.png`, `member-directory.pdf`, mtime 11:20:32) predate `header.tsx`'s on-disk fix (mtime 11:37:10) — those images are the **pre-fix** state, not proof the fix works. So I didn't rely on them for the header check. Instead I:
  - Ran `pnpm test:e2e -- e2e/member-directory-print.spec.ts` myself against the live dev server: **3/3 passed**, including the header-ancestor-chain regression test qa wrote.
  - Generated a fresh PDF against current code (`member-directory-postfix.pdf` in the scratchpad) and read page 1 directly: the site nav is gone, the printed page now opens straight on "Westerville Lions Club / Member Directory."
- Read `src/components/members/member-directory.tsx`, `member-directory-print.tsx`, `print-directory-button.tsx`, `src/lib/member-address.ts` in full — confirmed the address-omitted-when-null logic, the board-position tag, the active-only print filter, and brand-consistent button styling (`rounded-lg` on `PrintDirectoryButton`, not `rounded-full`).

## What's Working

- **The permission gate is real, not decorative.** Verified three independent ways across this pipeline (Phase 5's live zero-role-account browser test, my own direct code read, my own passing e2e run) that `/members` now actually blocks a session without `members.view` before any PII leaves the database — closing a real pre-existing hole, not just a theoretical one.
- **Address rendering has no stray-comma edge cases.** `formatCityStateZip`/`hasAnyAddress` in `src/lib/member-address.ts` is shared by both the on-screen and print views, so "no address," "city+state, no zip," "street only" etc. all render correctly in one place instead of two divergent implementations. Confirmed against a real member's partial address ("Blaine, John" — city/state, no zip, no stray comma) in the printed PDF I generated.
- **The print roster reads like a roster, not a spreadsheet.** Having now looked at the actual page renders: near-black 13pt bold names, 11pt contact lines, generous line-height, a single thin hairline between entries (no gridlines, no zebra striping), alphabetical jump-letters as anchors. This is a genuinely different reading experience than the on-screen directory's dense card grid, and it's the thing the treasurer said mattered most.

## Intent-vs-Shipped Diff

- Phase 1 said: "download a PDF" via `window.print()`, no PDF library. Shipped: exactly that, mirroring `PrintStatementButton`. **Matches.**
- Phase 1 said: name, email, phone, mailing address on both the online directory and the print roster, with self-service address editing already working via `/members/profile`. Shipped: address block on-screen (`member-directory.tsx:306-331`), address lines in print (`member-directory-print.tsx:94-95`), profile editing untouched and already correct. **Matches.**
- Phase 1 said: board members must carry their position tag onto the printed sheet specifically (the online directory already had this). Shipped: all 12 board members' position tags print, confirmed by qa against the live DB's board roster and re-confirmed by me in the fresh post-fix PDF. **Matches.**
- Phase 1 said: bundle the missing `MEMBERS_VIEW` gate into this feature since it's the same file and makes shipping addresses safe. Shipped: gate added, before the query, verified end-to-end. **Matches.**
- Phase 1 estimated ~2 pages for 41 active members. Shipped: 4 pages, because Phase 4 deliberately gave every field (email, phone, street, city/state/zip) its own line instead of Phase 1's denser "email · phone" combined line, in service of the exact "older reader" readability goal Phase 1 was estimating around. **Acceptable drift** — looking at the actual page renders, the extra whitespace is what makes it readable; collapsing back to 2 pages would mean shrinking type or combining lines, which is the wrong trade for this audience. Four physical pages (or a 4-page PDF) is not a meaningful burden.
- Phase 5 found the site nav rendering on page 1 of the PDF, contradicting this feature's own "screen-only chrome must be gone in print" requirement. Shipped: fixed, `print:hidden` added to `header.tsx`, verified independently by me via a fresh PDF render and a live e2e re-run. **Matches** (defect closed).

## Edge Cases

- Empty state (print): **pass** — "No active members to display." reads as intended, not a blank page. (Zero-member online directory copy is pre-existing, flagged in Phase 1 as out of scope for this feature, unchanged.)
- Failure microcopy: **not applicable** — this is a server-rendered read path with no user-submitted form; no new failure surface introduced.
- Permission gate: **pass** — enforced before the query, verified by code read, live browser test (Phase 5), and my own passing e2e run.
- Mobile (360px): **pass** — qa's programmatic overflow check (`scrollWidth <= clientWidth`) plus screenshot confirm single-column stacking with no horizontal scroll.
- Brand consistency: **pass on new code** — `PrintDirectoryButton` uses `rounded-lg` (not `rounded-full`), print view intentionally avoids the card/`rounded-2xl` pattern in favor of a flowing roster with hairlines (a deliberate, Phase-1-specified departure from card UI, not an oversight). One **pre-existing, untouched-by-this-feature** violation noted below under Follow-Ups, not blocking.

## Follow-Ups (SHIP WITH NOTES)

- **Confirm the `header.tsx` fix's blast radius on the two other print surfaces it touches.** `header.tsx` is app-wide, so the same `print:hidden` fix that closes this feature's defect also silently changes what's printed for `budget-print-worksheet.tsx` and the `/members/financial-reports` print flow — both genuinely board-facing documents that get printed monthly. The fix is reasoned to be a strict improvement (those surfaces presumably had the same nav-bar-on-page-1 bug all along, since only `footer.tsx` had `print:hidden` before today), but nobody has actually re-printed either of those two documents to confirm removing the header doesn't shift a header/margin/pagination assumption those components were quietly relying on. Concrete action: a 5-minute real-print (or Playwright `page.pdf()`) check of both surfaces, same technique qa already used here. Low risk, cheap to close, worth doing before the next board meeting rather than after.
- **Pre-existing `rounded-xl` on the on-screen member-directory card container** (`member-directory.tsx:227`, and the `/members` quick-links tiles in `page.tsx`) violates CLAUDE.md's "always `rounded-2xl`" card rule — but confirmed via `git diff` that this feature did not touch that class; it predates this work. Not blocking this feature; worth a small cleanup pass whenever that component is next open for another reason.
- **Land the `header.tsx` fix on `main`.** It's currently an uncommitted working-tree change (confirmed via `git status`/`git diff`), not yet pushed. Not a defect in the feature itself, just a reminder that "ship" here means "commit and push," which hasn't happened yet as of this review.

## Red Flags (if NEEDS REWORK)

None. No blocking issues found.


---

## Treasurer Decisions (2026-08-07)

1. **Bundle the missing directory permission gate into this work.** `src/app/members/page.tsx` has no
   `hasFeature()` check today, so any signed-in session — including a zero-role account that
   `/access-pending` exists to catch — can read every member's contact details. Verified against the
   live database: all 52 users holding any role already have `members.view`, so enforcing it locks out
   no real user. Adding home addresses to this page is what made the gap consequential enough to fix now.
2. **Printed roster covers active members only** (~41 people, ~2 pages) — matching what the online
   directory shows. A printed sheet is kept for months, so including non-active people makes it wrong faster.
3. **No per-member print opt-out in v1.** No such flag exists; adding one would mean a schema change,
   a profile control, and honoring it in two surfaces. Ship the roster; add an opt-out if a member asks.
   It is additive, not a rewrite.
4. Coordinator default, treasurer may override: **board position is the only tag carried onto the
   printed sheet** — other group tags are omitted to protect legibility, which is the point of item 4
   in the original request.

---

# Phase 2 — Architectural Review

**SKIPPED**, deliberately, per the Accelerated pipeline mode and CLAUDE.md's no-silent-skips rule.

Rationale: this feature introduces **no new npm dependency** (printing is the browser's own dialog,
following the locked precedent in `src/components/members/print-statement-button.tsx`), **no new
top-level directory or module**, and **no schema change** (`members.address/city/state/zip` already
exist and are already member-editable). It adds one client leaf, one print-only view, and enforces an
existing permission on an existing page. There is no structural question for the architect to rule on.
If implementation surfaces one — in particular any temptation to add a PDF-generation library — Phase 4
must stop and escalate to Phase 2 rather than deciding it inline.

---

# Phase 3 — Technical Design (abbreviated, written by coordinator)

Accelerated mode permits a paragraph rather than a full design doc. Phase 1 already fixed the
typography, field set, ordering, and privacy posture; this records the remaining build decisions.

**Shape.** Follow the financial-statement precedent exactly: a screen view plus a print-only view in the
same page, toggled by Tailwind `print:hidden` / `hidden print:block`, with a client leaf calling
`window.print()`. That single button IS the "download a PDF" flow — the browser's Save-as-PDF
destination — with no PDF library, matching `print-statement-button.tsx` and
`budget-print-worksheet.tsx`.

**Files.** A new `print-directory-button.tsx` client leaf (mirroring `print-statement-button.tsx`,
including its own `print:hidden`), and a new print-only directory view component under
`src/components/members/`. `src/app/members/page.tsx` gains the `members.view` gate and renders both.
`member-directory.tsx` gains the address display for the on-screen directory.

**Print layout.** US Letter, 2 columns, 13pt bold `Last, First` over an 11pt contact block (email,
phone, then address across up to 2 lines), 3–5 lines per entry, no gridlines or zebra striping,
alphabetical jump-letters, board position rendered as a small tag under the name. Club header plus a
generated-on date and page numbers. Entries must not split across a column or page break
(`break-inside: avoid`).

**Data.** Active members only, ordered by last name then first. Address renders as a single line where
it fits and wraps to two where it doesn't; a member with no address simply omits those lines rather
than printing an empty label.

**Edge cases.** Zero members and one member both render the header and a sensible body. Missing
email/phone/address each omit their line. Long names and long emails wrap rather than overflow the
column.

**Tests.** Gate enforcement on `/members` (a session lacking `members.view` is redirected, mirroring the
existing pattern in the admin pages) and the address-omitted-when-null rendering case. Print CSS itself
is not machine-verifiable in this project — the treasurer confirms on a real print, as with v1.56.1.

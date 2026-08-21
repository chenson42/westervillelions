# Welcome Packet — Live Page Under Club Records — Work Log

> **Slug:** `2026-08-21-welcome-packet-live-page`
> **Surface:** (dashboard) member portal — `/members/records`
> **Permission(s):** none new expected — mirror `/members/records` and `/members/financial-reports`, which gate on `auth()` + a linked member record, no `FEATURES` key
> **Estimated complexity:** small
> **Pipeline mode:** Full (feature is small, but touches a new route + a new content-serving pattern, so run the phases — keep them brief)

---

## Context (from the user, 2026-08-21)

The club's annual "welcome packet" is maintained as static HTML in
`docs/club-documents/welcome-packet-<lions-year>.html` (currently
`welcome-packet-2026-27.html`), rendered to PDF via
`scripts/render-welcome-packet.sh` for print. See
`docs/club-documents/welcome-packet-2026-27.html`'s own header comment for
the full authoring rules (one-slide-per-page, no em dashes, no gendered
language, LCI figures must come from the ledger, etc.) — those rules govern
the *content* file and are unaffected by this work.

Two related content changes shipped earlier in this same session, ahead of
this work-log (content-only edits to static docs, not app code, so they
did not go through this pipeline — noted here for the record):

1. The two blank service-record log sheets (formerly slides 18-19 of the
   packet) were extracted into their own file,
   `docs/club-documents/service-record-sheets-2026-27.html`, so they can be
   reprinted independently of the full packet. The packet's own "Record
   your service hours" slide was reworded to say the sheets are "printed
   separately and included in this packet as an insert" rather than being
   part of the same PDF. The packet was renumbered 29 → 27 slides and
   re-verified with the render script (slide count == page count, both
   files OK).
2. The "Your club directory" slide (member names/phone/email printed in
   the packet) was replaced with "Your club directory is online" — points
   to the portal, and notes a limited number of printed directories are
   kept on hand for pickup (ask at a meeting or the Secretary) rather than
   including a directory snapshot in every packet.

**This work-log covers the new part:** the user considers the welcome
packet a **living document** — it will be edited year to year — and wants
it **published on the website**, under Club Records
(`/members/records`, alongside meeting minutes and governing documents),
as a live HTML page rather than a static file to re-upload. User's own
words: "i think the welcome packet will be a living document that will
change from year to year and be published to the website. as part of this
lets add references to it and put it on the website under club records."

User confirmed via AskUserQuestion: **live HTML page** (renders the
packet content in-browser, like `/members/financial-reports` reproduces
the treasurer's static report), not a downloadable PDF link — reasoning:
always current, no file to re-upload each year, browser print handles
paper copies.

## Known constraints an implementer needs

- The source HTML file's own header comment says it is "also published as
  a Claude artifact, which supplies its own `<html>`/`<head>` wrapper" —
  it deliberately has no `<!doctype>`/`<html>`/`<body>` of its own. It is
  a `<title>`, a `<style>` block, and a `<div class="deck">...</div>` of
  `<section class="slide">` blocks.
- The `<style>` block sets CSS **on `:root` and `body`** (custom
  properties like `--ink`, `--paper`, `--accent`, plus `body { background
  ...; padding ...; }`). Injected verbatim into a Next.js page, `:root`
  and `body` rules are **global** — they would repaint the whole app
  (nav, other pages' shared layout) for as long as the page is mounted,
  not just the embedded content. **Do not inject the style block
  verbatim.** Scope it — e.g. rewrite the `:root` selector and the bare
  `body` selector to a wrapper class (`.welcome-packet-embed` or similar)
  before rendering, so the custom properties and background/padding apply
  only inside that wrapper. Everything else in the stylesheet targets
  classes already scoped to the deck's own markup (`.slide`, `.box`,
  `.rule`, `.grid`, etc.) and is fine as-is.
- The packet is a **living document that changes yearly** — the filename
  embeds the Lions year (`welcome-packet-2026-27.html`,
  `welcome-packet-2027-28.html` next year, etc.). Don't hardcode this
  year's filename with no update path. Prefer resolving "the current
  packet" at request time — e.g. list `docs/club-documents/`, match
  `welcome-packet-<year>.html` (excluding the `-presenters` variant),
  sort, take the most recent — so next year's packet author doesn't have
  to remember to update a route file too. Use your judgment on the exact
  mechanism; this is a judgment call for Phase 2/3, not a fixed
  requirement.
- Content is authored by admins in the repo, not user-submitted — reading
  it server-side and rendering it (`dangerouslySetInnerHTML` or
  equivalent) is not an XSS boundary the way user input would be. Treat it
  like the app already treats other repo-authored static content.
- A companion doc, `docs/club-documents/membership-packet-your-first-month.html`,
  also exists in the same directory. Confirm with Phase 1/2 whether it's
  in scope for this page or explicitly out of scope — the user only
  mentioned "the welcome packet."
- "Add references to it" (the user's phrasing) probably means: a link/card
  from the `/members/records` hub page (which already lists Governing
  Documents and meeting-minutes pointers in a similar card style), not
  necessarily anywhere else — but Phase 1 should confirm where a reference
  is expected (nav? admin release notes? just the hub?).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-21 |
| 3 — Technical design | tech-lead | Complete | Design complete — implementer named | 2026-08-21 |
| 4 — Implementation | ux-developer | Blocked, superseded | Code complete, tests passing — feature cannot function in production as designed (see below) | 2026-08-21 |
| 4b — Loop-back: revised design (DB-backed) | analyst (supplemental Phase 1 done) → architect (Phase 2 Revised done) → tech-lead (Phase 3 Revised done) → database-admin (schema/migration done) → api-developer (queries/routes/nav/seed script done) → ux-developer (admin UI + member page verification done) | Complete | All implementer steps done — typecheck, full test suite, `pnpm build:only`, and a manual dev-server click-through all clean; ready for qa (Phase 5) | 2026-08-21 |
| 5 — Verification | qa | Complete | PASS | 2026-08-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-21 |

---

## LOOP-BACK — Phase 4 discovered a design-invalidating blocker (2026-08-21)

ux-developer implemented Phase 3's file-based design exactly as specified (code is real,
typechecked, tested — see "Phase 4 — Implementation (UI)" below), then stopped short of
handing off to QA because building the required `<!-- WELCOME-PACKET: CURRENT -->` marker
into `docs/club-documents/welcome-packet-2026-27.html` surfaced this: **that entire directory,
and `scripts/render-welcome-packet.sh`, are gitignored** (`.gitignore` line 57), deliberately,
per commit `aa3b539` ("security: remove the club's financial and donor data ahead of
publishing") — the packet embeds the club's real giving/budget figures and "remains in the
private archive," not source control. Verified independently (`git check-ignore -v`, `git log`,
reading the commit message and `.gitignore`'s own comment) — this is not a misread.

**Why this invalidates the Phase 2/3 design, not just Phase 4:** Vercel builds from the
committed git tree, so `docs/club-documents/` never exists in production — `resolveCurrentPacket()`
would return the "no current packet" empty state forever, not intermittently. Worse: even
setting deployment aside, a plain git-committed file in a *public* repo is visible to anyone
browsing GitHub directly, regardless of the app's `auth()` + `memberId` gate — the member-portal
auth boundary and the public-repo boundary are two different things, and the file-based design
only respected one of them. The Phase 2 architect's "docs/ ships in the deployed bundle" claim
was verified only against `docs/release-notes/` (tracked) and never checked against
`docs/club-documents/` (untracked) — a real gap in that review, not a hypothetical one.

**User's decision (asked directly, 2026-08-21):** move the packet's content into the database,
mirroring how `minutes`/governing `documents` already work (DB-backed, admin-authored, never a
git-tracked file) — chosen over "scrub figures and keep it a committed file" and "don't publish
it live, drop this feature." This is **bigger than Phase 3's original scope**: it now needs a
schema, an admin authoring surface (a new user verb Phase 1 explicitly said didn't exist), and a
one-time migration path for the real content currently sitting only in the gitignored local file
(and the private archive) into the database.

**What carries forward from the superseded Phase 4 work, and what doesn't:**
- **Reusable as-is:** the CSS-scoping transform and `.flag`-suppression logic in
  `src/lib/welcome-packet.ts` (drop the `prefers-color-scheme: dark` block; rewrite `:root`-shaped
  selectors and bare `body` to `.welcome-packet-embed`; append the flag-suppression rule) is
  input-source-agnostic — it takes a raw HTML string in and returns scoped `styleHtml`/`deckHtml`
  out. Whoever redesigns Phase 2/3 should point this logic at a DB-fetched string instead of a
  file-read string rather than rewrite it from scratch, and keep its existing unit tests (adapt
  fixtures from temp files to fixture strings).
- **Not reusable, must be redesigned:** the "current" resolution mechanism (was: directory
  listing + HTML-comment marker; needs to become: a DB column/flag, e.g. an `isCurrent` boolean
  or a status the way `documents.currentVersionId` already models "the operative version" for
  governing documents — that's the closer existing precedent to study, not `minutes`), the page's
  data-fetching (was `fs.readFileSync`, needs a DB query), and everything about authoring (there
  was none; now there must be an admin UI, a permission key, and a migration story for the
  existing real content).
- **The hub card** on `src/app/members/records/page.tsx` (Phase 1 Flow 2) is very likely still
  correct as designed — it just needs to point at data that may or may not exist yet, same as
  the Governing Documents block already handles "not yet published."

Next: a scoped Phase 1 supplemental pass (analyst) covering only the new admin-authoring verb
and the one-time content migration, since the member-viewing flow Phase 1 already analyzed
remains valid. Then Phase 2/3 redesign the storage layer, then implementation (likely the
specialist split: database-admin for schema, api-developer or a server action for authoring,
ux-developer for both the admin editor and the already-mostly-built member page).

---

# Phase 1 — Functional Refinement (analyst)

## Verdict: READY WITH NOTES

## One-line take

Publish the current Lions-year welcome packet as a scoped, in-browser HTML page under `/members/records`, gated identically to its two siblings (`minutes`, `financial-reports`) — small and low-risk on the read side, but the "living document" framing hides a real timing hazard in how "current" gets resolved, and the source file's own gold "open items" flags were written for internal board review, not for members.

## User verbs

Confirmed against `src/app/members/records/page.tsx` and `src/app/members/financial-reports/page.tsx` for pattern precedent, and against `docs/club-documents/welcome-packet-2026-27.html`'s own header comment and `membership-packet-your-first-month.html`.

**Signed-in member:**
- Opens `/members` → clicks the existing "Club Records" tile (no copy change needed there — it already fans out) → lands on `/members/records`.
- On `/members/records`, sees a new card/section pointing to the welcome packet (mirroring the existing "Governing Documents" card block on that same page) and clicks it.
- Views the current packet rendered in-browser — scrolls through it like the existing `/members/financial-reports` statement view.
- Uses the browser's native print (Cmd/Ctrl+P) to get a paper copy — no in-app "download PDF" button, per the user's confirmed decision.
- (Implicit, not stated) Uses browser back / the page's own back-link to return to `/members/records`.

**No admin verb exists in this feature.** The packet is edited by committing a new/updated file to `docs/club-documents/` in the repo — that's a developer/repo action, not something any club officer does through the app UI, even though the header comment says the "no em dash" house style was "set by the treasurer." Nothing in the request asks for an in-app editor, and I'm not assuming one. Flagged below as a confirm-with-user item, not a gap to fix.

**Anonymous visitor:** no verb — this is member-portal-only, not on the public site. (The request never asked for public visibility, and the packet's own directory-slide rewrite in this same session already pointed the *public* directory info to the portal, not the reverse — so I'm not inferring a public surface here.)

## Flows

**Flow 1 — View the current welcome packet**
- Entry: `/members/records` → click the welcome-packet card (or a direct/bookmarked URL to the new route).
- Step 1: Server resolves "the current packet" — lists `docs/club-documents/`, matches `welcome-packet-<year>.html` (excluding `-presenters`), sorts, takes the most recent.
- Step 2: Server reads and renders that file's content inside a scoped wrapper (per the Known Constraints note — `:root`/`body` rules rewritten to a wrapper class before injection).
- Success outcome: member sees the packet, styled per its own navy/gold slide-deck aesthetic, scrollable, printable.
- Failure outcomes — **not described in the request; this is the biggest flow gap:**
  - No file matches the naming pattern (fresh checkout, renamed file, typo). What does the member see? Needs a defined empty/error state (see Gaps), not a stack trace or a blank `<div>`.
  - The matched file fails to parse as expected (missing `<title>`, malformed `<style>` block that the scoping rewrite can't safely rewrite). Same ask: human microcopy, not a 500.
  - Signed-in but unlinked account (no `memberId`) — should replicate the "Account Not Linked" block both sibling pages already show, not a different error.
  - Signed out — should redirect to `/signin` like the siblings, not 404 or render nothing.

**Flow 2 — Discover the packet from the Club Records hub**
- Entry: `/members/records`.
- Step: new card appears in a section on that page (styling to match the existing "Governing Documents" card block: `bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1`).
- Outcome: click-through to Flow 1.
- No failure path needed here beyond Flow 1's — the card itself can't fail independently.

## Permissions

- **No new `FEATURES` key.** Existing precedent from `src/lib/permissions.ts` confirms it: `minutes`/`documents` only have *authoring* keys (`MINUTES_MANAGE`, `MINUTES_DELETE`, `DOCUMENTS_MANAGE`) — there is no `minutes.view` or `documents.view` key, because both sibling pages deliberately gate reads on `auth()` + a linked `memberId` only, open to every linked member regardless of role. This feature should do the same: `auth()` + `session.user.memberId` check, redirect to `/signin` if no session, show the sibling pages' "Account Not Linked" block if `memberId` is null. No role list to bind — every linked member gets it by default, same as club records and financial statements.
- One real consequence of mirroring this gate exactly: a member who is signed in and linked but has **zero granted `FEATURES.*` keys** (an access-pending member per this project's definition) still sees this page, because the gate never checks `hasFeature()`. That matches the two siblings' existing, deliberate policy ("expose accountability/records to the entire club," not just members with an active role) — I'm treating it as correct-by-precedent, not a new gap, but naming it explicitly since Pass 4 asks about the access-pending surface directly.

## Gaps the request didn't address

1. **"Current" resolution can surface a draft early — this is the sharpest gap.** The suggested mechanism (list the directory, sort by filename, take the most recent `welcome-packet-<year>.html`) is lexicographic-latest, not "the year the club has actually rolled over to." If next year's packet author creates `welcome-packet-2027-28.html` in May while drafting — months before the September rollout — and it gets merged to `main` before it's ready, the live member-facing page would silently start showing the unfinished draft as "current" the moment the file lands, with no gate in between. Given the header comment already documents `class="flag"` gold "open items ... so the board can see what is still outstanding" as an expected mid-draft state, this isn't a hypothetical — the source file format anticipates being reviewed while incomplete. **Suggested resolution:** either (a) the resolution logic needs an explicit "this is the live one" marker in the file itself (a header token, not filename recency) that an editor flips only at rollover, or (b) the workflow convention is "don't create/merge next year's file into `docs/club-documents/` until it's ready to go live" — which is a process rule, not code, and needs the user's explicit sign-off since it constrains how the club's own volunteers work in the repo. I'd rather this be a conscious choice than an accident of the sort algorithm.
2. **Board-review flags (`class="flag"`) becoming visible to the general membership.** The header comment says these flags "DO print, so the board can see what is still outstanding while reviewing" — that's an internal-review affordance, not member-facing content. If the currently-committed file has any open flags at the moment it's live on the portal, every member sees "still outstanding" annotations that were meant for the board's eyes. Needs a decision: suppress `.flag` elements in the live web render (they'd still print via the existing PDF workflow, unaffected), or accept that "current" only ever means "board-finalized, no open flags" as a publishing convention. Either is fine — silence on this isn't.
3. **Empty/failure state undefined.** See Flow 1 failure outcomes above — no file found, malformed file, and the general "something broke" case all need human microcopy per this project's UX Guidelines empty-state pattern (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`), not a framework error page.
4. **Mobile at 360px is a real open question, not a given.** The packet's own stylesheet is an 11×8.5in landscape slide deck (`--slide-w: 62rem`, `min-height: 8.5in`, `print-color-adjust: exact` navy backgrounds) built for print and presenter viewing, not for a phone. Rendering it verbatim (even scoped) in a mobile member-portal browser will almost certainly require horizontal scrolling per slide at minimum, and may be genuinely hard to read. The request never says how this should behave on mobile, and I don't think "it's fine, it'll scroll" is a safe assumption to make silently — Phase 2/3 needs an explicit call here (horizontal-scroll slide viewer vs. a separate reflowed web rendering vs. accept degraded-but-usable).
5. **`membership-packet-your-first-month.html` — recommend explicit OUT OF SCOPE, not just "confirm."** I read the file: it is not a standalone document. Its own header comment says so directly — *"This is a fragment, not a standalone page: it expects the Welcome Packet's stylesheet... Paste it into whatever deck it ends up in and renumber `.num` to suit."* It has no `<title>`, no `<style>`, just one bare `<section class="slide">`, and was extracted from the welcome packet on 2026-08-14 "held here for the Membership packet" — a document that doesn't exist yet as an assembled file. There is nothing to publish today; it can't render on its own. This should be deferred to its own future work-log entry once (if) a "Membership packet" is actually assembled as a standalone file — not bundled into this feature.
6. **"Add references to it" — I'm reading this narrowly; confirm.** My assumption: one card/section on `/members/records` only, styled like the existing "Governing Documents" block on that same page. I am *not* assuming: a rewrite of the top-level `/members` "Club Records" tile copy (it already fans out generically — "Read meeting minutes — general and board" doesn't need to enumerate everything under the hub), a mention on any public page (`/join`, `/about`), or an admin nav entry (there's no admin CRUD surface for this feature at all — see User Verbs). If the user meant something broader by "add references," this needs to be said explicitly before Phase 2.
7. **No archive/history of past years' packets.** `/members/financial-reports` and the governing-documents pages both offer some form of history (a month picker, a version/diff view). This request only asks for "the" (current) packet, consistent with "living document" framing — I'm treating history as explicitly out of scope for this pass, not a gap, but naming it so it's a conscious cut rather than an oversight.

## Out of scope (confirm with user)

- `membership-packet-your-first-month.html` (see Gap 5) — not ready to publish; defer.
- Any in-app authoring/editing UI for the packet — content stays repo-committed, edited by whoever has repo access, exactly like release notes today.
- Public-site placement (`/join`, `/about`, etc.) — member-portal only per the request's own wording ("published to the website... under club records").
- An archive of past Lions-years' packets — only "current" is requested.
- The service-record log sheets and the directory-slide rewrite that already shipped this session — explicitly noted in the work-log as done, ahead of and outside this pipeline run.

## Open questions

1. Where does "current" get its authority — filename recency, or an explicit marker the editor sets at rollover? (Gap 1 — this is the one I'd block on if the answer is "just sort by filename and ship it.")
2. Should `class="flag"` board-review annotations be suppressed on the live member-facing render, or is "no open flags" a publishing precondition the club will just observe by convention? (Gap 2)
3. What should mobile actually look like — scrollable slide deck, reflowed web layout, or something else? (Gap 4)
4. Is "add references to it" fully satisfied by a single card on `/members/records`, or did the user have another surface in mind? (Gap 6)
5. What is the exact desired route path? (Not blocking — Phase 2/3's call — but `/members/records/welcome-packet` is my working assumption if nobody has a preference.)

## Adversarial pass

- **Redirect targets:** none — no `callbackUrl`/`next`/`redirect` param anywhere in this flow. N/A.
- **State-machine shortcuts:** the new route must perform its own `auth()` + `memberId` check in the page body (per this project's invariant that the proxy/nav is never the only gate) — flagging explicitly so Phase 3/4 don't rely on "it's only linked from a gated page" as the access control.
- **Enumeration leaks:** N/A — single current-document view, no per-ID resource, nothing to enumerate.
- **Input boundaries — the one real finding here:** if the "current packet" resolution or any future archive/picker feature (see Gap 7, currently out of scope) ever takes a year/filename from a URL path segment or query parameter, that value must never be concatenated directly into a filesystem path (`fs.readFileSync(join(CLUB_DOCS_DIR, userInput))` is a path-traversal risk). For *this* feature, the resolution is entirely server-determined from a directory listing with no client input, which is the right shape — I'm noting this so it stays true if history/archive ever gets built later.
- **Self-targeting:** N/A — read-only page, no state a member can mutate, no permission a member can grant themselves.

## What I did

- Read the full work-log context, the two sibling pages (`src/app/members/records/page.tsx`, `src/app/members/financial-reports/page.tsx`) to confirm the "no `FEATURES` key, `auth()` + `memberId` only" gating pattern is real precedent and not an assumption.
- Read `docs/club-documents/welcome-packet-2026-27.html`'s full header comment (authoring rules, print mechanics, the `class="flag"` open-items convention) and confirmed the file structure matches the Known Constraints note (no `<!doctype>`/`<html>`/`<body>`, `:root`/`body`-scoped CSS custom properties).
- Read `docs/club-documents/membership-packet-your-first-month.html` in full — confirmed by its own header comment that it is a non-standalone fragment, not a companion document ready to publish.
- Read `src/app/members/page.tsx`'s six-tile portal grid to confirm the "Club Records" tile already fans out generically and doesn't need a copy change.
- Grepped `src/lib/permissions.ts` to confirm there is no `minutes.view`/`documents.view`-style read key — only authoring keys exist for this document family, supporting the "no new `FEATURES` key" call.
- Grepped for existing `readFileSync`/directory-listing patterns (`src/app/(dashboard)/admin/release-notes/page.tsx`, `src/app/api/admin/release-notes/route.ts`) as precedent for "resolve current file from a directory listing" — relevant prior art for Phase 2/3, not a decision I'm making here.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 1 section, and the Per-Phase Status table row for Phase 1 (Complete / READY WITH NOTES / 2026-08-21).

## Open questions / handoff notes

- Verdict is **READY WITH NOTES**, not NEEDS REWORK — the core feature (render the current packet, scoped, under Club Records, gated like its siblings) is small and well-precedented. The notes are the five open questions above; architect/tech-lead should treat Gap 1 (current-packet authority) and Gap 2 (board-flag visibility) as the two that most need an explicit answer before Phase 4, since both are silent behavior changes if left to default logic rather than a deliberate choice.
- Phase 2/3: the CSS-scoping rewrite described in Known Constraints (rewrite `:root`/bare `body` selectors to a wrapper class before injection) is a correctness requirement, not a nice-to-have — an unscoped inject repaints the whole app shell for as long as the page is mounted. Confirm the chosen implementation approach actually does this before Phase 5.

## User answers to Open Questions (2026-08-21)

1. **Current-packet authority: explicit marker, not filename recency.** The user chose "Explicit marker in the file" over "sort by filename, ship it." Architect/tech-lead: design a small header token (e.g. an HTML comment or a `data-` attribute near the top of the file, in the spirit of the existing `class="flag"` convention) that whoever finalizes a packet flips at rollover; the resolution logic reads for that marker and ignores filename recency entirely. If no file carries the marker (e.g. between Lions years, or a fresh checkout before anyone has flipped it), that's the "no current packet" empty state from Gap 3 — treat it as a normal, expected state, not an error.
2. **Board-review flags: suppressed on the live page.** The user chose "Suppress on the live page" over "leave them visible." `class="flag"` elements still print via the existing PDF workflow, unaffected — the web render must strip/hide them so members never see board-only "still outstanding" annotations. This is a rendering-time concern (strip the flag elements, or CSS `display: none` scoped to the embed wrapper) — tech-lead's call which is cleaner given the scoping rewrite already in flight for `:root`/`body`.
3. **Mobile, "add references" scope, and route path (Q3–Q5 from Phase 1) were not separately asked** — they're lower-priority per the analyst's own note ("I'd block on... if the answer is 'just sort by filename'", which is now resolved). Proceed on the analyst's stated working assumptions unless Phase 2/3 finds a concrete reason to deviate: mobile can be degraded-but-usable (the packet is inherently a presenter/print slide deck, matching its existing PDF nature — no reflow redesign required for this pass); "add references" = one card on `/members/records` only, styled like the existing Governing Documents block, nothing on public pages or admin nav; route path `/members/records/welcome-packet` unless Phase 3 has a reason to pick otherwise.

---

# Phase 2 — Architectural Review (architect)

## Verdict: Approved with suggestions

## One-line take

The shape is exactly right — a thin Server Component page under the existing `records` route, a testable `src/lib` helper doing all the file I/O and string transforms, no new dependency, no new `FEATURES` key — and none of it requires a new `docs/decisions.md` entry. The suggestions below are about making the marker mechanism unambiguous and making the CSS-scoping transform defensive, not about restructuring anything.

## What I reviewed

- Both sibling pages in full: `src/app/members/records/page.tsx` and `src/app/members/financial-reports/page.tsx`, to confirm the `auth()` + inline `memberId` gate (no `FEATURES` key) is real, current precedent and not something Phase 1 inferred.
- `src/app/(dashboard)/admin/release-notes/page.tsx` — the existing `readdirSync`/`readFileSync`-at-request-time precedent for "resolve current file from a directory listing," including its numeric-aware sort. This is the closest prior art in the codebase for the resolution logic, and it runs directly in the page body today (not a `src/lib` helper) — worth naming since I'm recommending this feature *not* repeat that placement.
- `docs/club-documents/welcome-packet-2026-27.html` in full — the header comment (rendering rules, the `class="flag"` convention, print mechanics) and the entire `<style>` block, specifically the `:root` / `body` / `.flag` rules that Known Constraints and Gap 2 are about.
- `src/lib/` directory listing for the `minutes`/`documents`/`financial-report` module pairs, to confirm the project's "thin `-queries.ts` for DB access, plain `.ts` for pure logic, `.test.ts` alongside each" convention.
- `package.json` dependencies — confirmed no HTML-parsing library (`cheerio`, `jsdom`, etc.) is currently installed; `rehype-raw` exists but is a `react-markdown` plugin, not a general-purpose parser, and isn't the right tool here.

## Directory placement

**Route:** `src/app/members/records/welcome-packet/page.tsx`. This nests under the existing `records` route group exactly the way `src/app/members/records/documents/[slug]/page.tsx` already does for governing documents — same parent, same "Club Records" umbrella, no new top-level route group and no change to the route-group rules in CLAUDE.md. Approved as proposed.

**Helper module:** `src/lib/welcome-packet.ts` — not a `-queries.ts`. This project's `-queries.ts` suffix consistently means "talks to the database" (`minutes-queries.ts`, `documents-queries.ts`, `financial-report-queries.ts` all wrap Drizzle calls). This feature has no database access at all — it's pure filesystem I/O plus string transforms — so it belongs in the same shape as `minutes.ts`/`documents.ts` (the plain, DB-free half of those pairs): pure functions, easy to unit-test without a DB fixture. Give it a co-located `welcome-packet.test.ts`, matching every other `src/lib` module in this family.

Do **not** put the resolution/extraction logic directly in the page body, even though that's what `admin/release-notes/page.tsx` currently does. That page predates this project's now-consistent "thin page over `src/lib` helper" pattern in the `records`/`financial-reports`/`impact` family, and the CSS-scoping and marker-scanning logic here is exactly the kind of thing that should have unit tests independent of Next.js's request lifecycle (per the Phase 4 gate: "Every unit test named in the Phase 3 design doc is written and passing"). Suggest the helper export roughly:

- `resolveCurrentPacket(): { html: string; sourceFile: string } | null` — directory scan + marker check (see below), returns `null` for the "no current packet" empty state.
- `extractPacketContent(html: string): { title: string; style: string; deckHtml: string }` — pulls `<title>`, the `<style>` block, and the `.deck` div's inner markup out of the source file.
- `scopePacketStyles(css: string, wrapperClass: string): string` — the `:root`/`body` rewrite.
- `stripBoardFlags(deckHtml: string): string` — removes `.flag` elements per the user's Open Question 2 answer.

The page itself should be little more than `auth()` → `memberId` check → call the helper → render. That composition is a Phase 3/4 concern, not mine to finalize, but the *split* (page vs. lib) is architecturally correct and I want it named explicitly so it survives into the design doc.

## Server/client split

Entirely a Server Component. No `'use client'` anywhere in this feature. Confirming two things Phase 1 didn't need to but that are worth stating for Phase 3/4:

1. `dangerouslySetInnerHTML` does **not** require a Client Component — it's a normal DOM prop and works fine in SSR output. Nothing about rendering the extracted deck markup forces `'use client'`.
2. The only other candidate for interactivity — a horizontal-scroll slide viewer on mobile — can be done with plain CSS (`overflow-x-auto` on the wrapper), which the user's answer to Q3 already scoped down to "degraded-but-usable" anyway. If Phase 3 later wants JS-driven slide navigation (arrows, keyboard paging), that would need a small client island, but nothing in Phase 1's flows asks for that, and I'd treat it as scope creep against the "no client interactivity" framing this task was given. Flagging so nobody backs into it by accident while polishing mobile.

## New dependency: none — and I'd push back on adding a real HTML parser

Confirmed via `package.json`: no `cheerio`/`jsdom`/general HTML-parser dependency currently exists. Running this against the Dependency Evaluation Criteria: the content isn't user input, it's one repo-committed file with a fixed, known shape (one `<title>`, one `<style>` block, one `<div class="deck">`), authored under the file's own strict house rules. Extracting three well-anchored substrings (`<title>...</title>`, `<style>...</style>`, `<div class="deck">...</div>`) with `indexOf`/regex on known literal anchors is well within what plain string slicing handles reliably for a fixed-shape input, and it's what `criterion 1` (already solved without a dependency) and `criterion 4` (bundle size on a public-facing, fast-first-paint site) both argue for. A full parser would be defensible if this fed on arbitrary or adversarial HTML, but it doesn't — I'm affirming Phase 1/Known-Constraints' framing here, not overriding it. **No new dependency; approved as scoped.**

One real wrinkle for the extraction/scoping code, found by reading the actual `<style>` block rather than assuming its shape: it is not one bare `:root` and one bare `body`. There are **four** selectors the scoping rewrite has to account for:

```
:root { ... }                                   /* line 62 */
@media (prefers-color-scheme: dark) {
  :root { ... }                                 /* line 88 — nested */
}
:root[data-theme="dark"] { ... }                /* line 102 */
:root[data-theme="light"] { ... }               /* line 115 */
body { ... }                                     /* line 130 */
```

A naive single-shot `:root` → `.wrapper` replace happens to work here because all four are the literal token `:root` (a `/:root\b/g` replace handles the attribute-selector variants and the nested one for free), but the implementer needs to know that going in rather than discover it by trial and error against a 450-line file. Also worth a Phase 3 decision, not mine to make: the member portal shell has no dark-mode toggle and nothing else in `/members` responds to `prefers-color-scheme`. Scoping the `@media (prefers-color-scheme: dark)` block to the wrapper class means a member with an OS-level dark preference will see the embedded packet flip to navy-on-navy while the surrounding nav/chrome stays light — technically "correctly scoped" (it only affects the wrapper, not the app shell) but a visibly inconsistent look. Tech-lead should decide whether to keep it as-is (still correctly contained, just inconsistent chrome) or strip the dark-mode block entirely for this render path. Not a blocker — either choice is architecturally sound — just don't let it go undecided by default.

## Invariants touched

**Server/Client Boundary** — satisfied; see above. No client component needed anywhere in this feature.

**Permissions Are the Only Gating Mechanism** — confirmed against both sibling pages' actual source, not just the work-log's description of them: `/members/records` and `/members/financial-reports` both gate on `auth()` + a non-null `session.user.memberId`, with **no** `hasFeature()` call and no `FEATURES.*` key at all for the read path (only `minutes.manage`/`minutes.delete`/`documents.manage` exist, and those gate *authoring*, which this feature doesn't have). The welcome packet page should do exactly the same: redirect to `/signin` if no session, render the existing "Account Not Linked" empty-state block if `memberId` is null, and otherwise show the page to every linked member regardless of role — consistent with this project's established "expose accountability/records to the entire club" policy family (records, financial-reports, impact-when-visibility=members). No new `FEATURES` key, no migration, no role binding. Approved.

**Repo-authored static content vs. `dangerouslySetInnerHTML`** — Phase 1's reasoning is correct and I'm confirming it, not just accepting it on faith: this content is committed to the repo by whoever has write access (the same trust boundary as `release-notes` `.md` files rendered by `ReleaseNotesViewer`, and as minutes/documents content authored under `minutes.manage`/`documents.manage`). It is never accepted from a request body, query string, or form submission, so it is not the kind of XSS boundary "no unescaped user content" is meant to police — that rule is about content a site visitor supplied, not content a trusted contributor committed to `main`. Two things carry forward as hard requirements into Phase 3/4, both of which Phase 1's adversarial pass already named and I want restated as binding, not optional:
- The file-resolution logic must **never** accept a filename, year, or path segment from the request (URL param, query string, header) — it must only ever enumerate `docs/club-documents/` server-side and choose among what it finds there. This route has no dynamic segment today, so this is naturally satisfied by the current design; it becomes a real requirement only if an archive/picker feature is ever added later (already correctly called out of scope in Phase 1's Gap 7).
- `docs/` is confirmed to ship in the deployed bundle and be readable at runtime — `admin/release-notes/page.tsx` already does `readFileSync` against `docs/release-notes/` in production today, so this is proven precedent, not an open question.

## The explicit-marker mechanism (concrete proposal for Phase 3)

Per the user's answer to Open Question 1: an explicit marker in the file, not filename-recency sort. Concrete, minimal proposal:

- **Token:** a single HTML comment, its own line, exact literal text `<!-- WELCOME-PACKET: CURRENT -->`.
- **Placement convention:** immediately after the closing `-->` of the file's existing top-of-file authoring-rules comment block, before the `<title>` tag. Document this placement in that same header comment block (the file already documents its own rendering/authoring rules there, so this is one more line in a place editors already read).
- **Why a bare boolean token, not a year value:** the year already lives in the filename (`welcome-packet-2026-27.html`). Repeating it inside the marker (`<!-- WELCOME-PACKET-CURRENT: 2026-27 -->`) creates two sources of truth that can drift (rename the file, forget to update the comment, or vice versa). A presence/absence marker has nothing to keep in sync.
- **Resolution algorithm** (in `resolveCurrentPacket()`):
  1. `readdirSync(docs/club-documents/)`, filter to filenames matching `/^welcome-packet-\d{4}-\d{2}\.html$/` — this regex already excludes `-presenters.html` for free (Phase 1's exclusion requirement) without needing a separate negative check.
  2. For each candidate, read the file and check for the exact marker line's presence (a plain substring/`includes()` check is sufficient given this is a fixed-format, repo-authored file — no need to scope the search to "just the header," since the token is deliberately unique and unlikely to appear elsewhere).
  3. **Zero files carry the marker** → return `null`. Per the user's answer, this is a normal, expected empty state (between Lions years, or a fresh checkout before rollover), not an error — render Gap 3's empty-state microcopy, not a 500.
  4. **Exactly one file carries the marker** → that's the current packet.
  5. **More than one file carries the marker** — this case was not addressed in Phase 1 or the user's answer, and I want to name it explicitly rather than let it fall to whatever the implementer does by default: this is the same "two people finalize two different years" hazard the marker exists to prevent, just moved one step over (instead of an accidental filename-sort pick, it's an accidental double-flip). Silently picking one (e.g., first match, or most-recently-modified) reintroduces exactly the failure mode this whole mechanism was designed to close. Recommend treating multiple markers the same as zero markers — fall back to the empty/"no current packet" state — since showing nothing is safe and showing the wrong one to the whole club is not. Tech-lead should make this an explicit line in the Phase 3 design doc rather than leaving it to implementer discretion.
- **Rollover workflow (process note, not code):** the editor finalizing next year's packet adds the marker line to the new file and removes it from the outgoing year's file in the same commit. Worth one sentence in the file's own header comment (which already documents rendering/authoring rules) so a future editor doesn't have to reconstruct this from the code.

## CSS-scoping rewrite: request-time transform, not a build step

Recommend a **request-time string transform** inside `src/lib/welcome-packet.ts`, not a build-time preprocessing step. Reasoning:

- This project's build pipeline (`pnpm build` = migrate + push + `next build`) has no existing precedent for a custom content-preprocessing stage, and both sibling pages (`records`, `financial-reports`) already declare `export const dynamic = "force-dynamic"` and do their file/DB reads fresh per request — this feature should match that convention rather than introduce a new one.
- `admin/release-notes/page.tsx` already proves the pattern at the right order of magnitude: `readFileSync` on a docs file, at request time, in production, with no caching layer, and it's fine for a low-traffic member/admin portal. A welcome-packet HTML file (tens of KB) is not meaningfully different in cost.
- A build-time step would add a new pipeline stage (another script to keep idempotent, another artifact to keep in sync with `docs/club-documents/`, another thing that can silently go stale between a content commit and the next deploy) for a feature Phase 1 sized as "small." Not worth it here.
- Concretely: `scopePacketStyles()` does an anchored replace — `css.replace(/:root\b/g, \`.${wrapperClass}\`)` handles all four `:root`-shaped selectors in one pass (see the dependency section above), and a targeted replace of the literal `\nbody {` (confirmed to appear exactly once in the file, at line 130) handles the bare `body` rule. Recommend the helper assert/warn if it doesn't find at least one `:root` and one `body` match — cheap defense against a future reformatting (e.g., `:root{` with no space, or a second `body` rule added later) silently regressing back to unscoped global CSS, which Known Constraints already flagged as a real repaint hazard, not a cosmetic one. No caching is required for Phase 3/4 to ship; if request volume or file size ever becomes a concern, an in-memory memoization keyed on file mtime is a cheap later addition, not a Phase 2 requirement.

## `membership-packet-your-first-month.html`

Confirmed out of scope, concurring with Phase 1's Gap 5 finding: the file's own header comment states it's a fragment expecting to be pasted into a not-yet-assembled document, with no `<title>`/`<style>`/`.deck` structure to extract. Nothing to build against today. No architectural action needed; revisit only if/when that document is assembled as a standalone file.

## Decision-log check

No `docs/decisions.md` entry required for this feature. Running it against this agent's own trigger list: no new dependency (explicitly declined above), no new top-level module (nests under the existing `records` route group), no change to route-group layout, no change to the permission catalog (no new `FEATURES` key). The explicit-marker convention is a reusable pattern worth remembering, but it's a technical-design choice scoped to one content file, not a structural change to the codebase — recording it here in the work-log and in the source file's own header comment is sufficient; it doesn't rise to the decisions-log bar.

## What I did

- Read both sibling pages (`src/app/members/records/page.tsx`, `src/app/members/financial-reports/page.tsx`) in full to verify the no-`FEATURES`-key gating pattern against actual source, not the work-log's paraphrase of it.
- Read `src/app/(dashboard)/admin/release-notes/page.tsx` in full as the closest existing precedent for directory-scan + read-current-file logic, and to determine that its page-body placement (vs. a `src/lib` helper) should not be repeated here.
- Read `docs/club-documents/welcome-packet-2026-27.html`'s header comment and full `<style>` block, and located the `.flag` rule and all four `:root`-shaped selectors plus the one `body` selector by line number.
- Confirmed via `ls src/lib/` that the project's `minutes`/`documents`/`financial-report` module family follows a consistent "`.ts` for pure logic + `-queries.ts` for DB access + co-located `.test.ts`" shape, informing the `welcome-packet.ts` (no `-queries` suffix) recommendation.
- Confirmed via `package.json` that no HTML-parsing dependency is currently installed, supporting the "no new dependency" call.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 2 section, and the Per-Phase Status table row for Phase 2 (Complete / Approved with suggestions / 2026-08-21).
- No `docs/decisions.md` entry — see Decision-log check above for why this feature doesn't meet the bar.

## Open questions / handoff notes for tech-lead (Phase 3)

1. **Formalize the "more than one marker" case.** Not addressed by Phase 1 or the user's answer; my recommendation is to treat it the same as zero markers (empty state), not pick one — but this needs to be an explicit line in the Phase 3 design doc, not left to implementer discretion.
2. **Decide whether to scope-and-keep or strip the `@media (prefers-color-scheme: dark)` block.** The member portal shell has no dark-mode toggle; scoping the dark-mode variables to the wrapper class is correct containment but produces a visibly inconsistent look (embedded packet goes navy while nav stays light) for a member with an OS dark preference. Either keeping it (still correctly scoped) or stripping it is architecturally fine — just make the call explicitly.
3. **Helper API shape** (`resolveCurrentPacket` / `extractPacketContent` / `scopePacketStyles` / `stripBoardFlags`) is a suggestion, not a mandate — tech-lead should feel free to consolidate or rename, but keep the page thin and the logic in `src/lib/welcome-packet.ts` with a co-located test file.
4. Gaps 3 (empty/failure state copy) and 4 (mobile) from Phase 1 still need concrete answers in the design doc — Phase 2 doesn't change their status, just confirms neither one is an architectural blocker (both are plain server-rendered markup/CSS, no new client code required).

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete

## Summary

Add one read-only Server Component page, `src/app/members/records/welcome-packet/page.tsx`, and one pure-logic helper module, `src/lib/welcome-packet.ts`, that together resolve "the current welcome packet" from `docs/club-documents/` by an explicit marker comment (not filename sort), extract its `<title>`/`<style>`/`.deck` content with anchored string operations (no new dependency), rewrite its `:root`-shaped and `body` CSS selectors to a wrapper class so the embedded stylesheet can never leak into the app shell, drop the stylesheet's OS-dark-mode block entirely (decision below), and suppress board-only `.flag` annotations via a scoped CSS rule rather than HTML surgery. A new card on `/members/records` links to it. No schema, no new `FEATURES` key, no API route — this is a filesystem read at request time, exactly like `admin/release-notes/page.tsx` already does in production.

I verified two things by reading the actual source file rather than trusting the work-log's paraphrase, both of which shape the design below:

- **Neither committed `welcome-packet-*.html` file currently carries the marker.** `grep -n "WELCOME-PACKET" docs/club-documents/*.html` returns nothing. That means, as designed, this feature ships showing the empty state on day one unless the marker is added to `welcome-packet-2026-27.html` as part of this same change — I've made that an explicit Implementation Order step, not an assumption left to the implementer to notice.
- **`<div class="deck">` is the single outermost, last-closed element in the file.** `grep -c "<div"` and `grep -c "</div>"` both return 149, and the file's final line is a bare `</div>`. That makes a greedy `<div class="deck">([\s\S]*)<\/div>\s*$` extraction exactly correct — it cannot over- or under-capture — rather than something that merely happens to work today and needs a real HTML parser tomorrow.

## Permissions

No new `FEATURES` key. Gate exactly mirrors `/members/records` and `/members/financial-reports` (verified against their live source, not paraphrase):

```ts
const session = await auth();
if (!session?.user) redirect("/signin");
const memberId = session.user.memberId ?? null;
```

If `memberId` is null, render the same "Account Not Linked" empty-state block both siblings use (copy adjusted to say "view the welcome packet"). No `hasFeature()` call anywhere in this feature — every linked member sees it regardless of role, consistent with the project's "expose accountability/records to the entire club" policy family. No role binding, no migration.

## API Contract

**No API route and no server action.** The page is a Server Component that calls `resolveCurrentPacket()` from `src/lib/welcome-packet.ts` directly in its own body at render time — the same shape `/members/financial-reports` uses for `getEntities()`/`getFunds()` and `/members/records` uses for `listMinutesForMembers()`. `export const dynamic = "force-dynamic"` at the top of the page, matching both siblings, so the marker scan runs fresh per request rather than being cached by a route segment.

## Data Model

No schema changes required. No table, no column, no migration. The "database" for this feature is `docs/club-documents/*.html`, already proven to ship in the deployed bundle and be readable via `readFileSync` at runtime (`admin/release-notes/page.tsx`).

## Component/Page Plan

**Pages to create:**
- `src/app/members/records/welcome-packet/page.tsx`

**Components to create:** none. Everything renders inline in the page — no interactivity anywhere in this feature (confirmed by architect: `dangerouslySetInnerHTML` needs no `'use client'`, and a JS-driven slide navigator is explicitly out of scope). No new files under `src/components`.

**Files to modify:**
- `src/app/members/records/page.tsx` — add a new "Welcome Packet" section/card (exact placement and copy below).
- `docs/club-documents/welcome-packet-2026-27.html` — add the marker line and a one-sentence rollover-workflow note to the existing header comment (see Implementation Order step 3).

**Files to create:**
- `src/lib/welcome-packet.ts`
- `src/lib/welcome-packet.test.ts`

### `src/lib/welcome-packet.ts` — exact shape

```ts
export const WELCOME_PACKET_MARKER = "<!-- WELCOME-PACKET: CURRENT -->";
export const WELCOME_PACKET_WRAPPER_CLASS = "welcome-packet-embed";

const CLUB_DOCUMENTS_DIR = join(process.cwd(), "docs", "club-documents");
// Matches welcome-packet-2026-27.html; excludes welcome-packet-2026-27-presenters.html
// for free (no separate negative check needed — verified against the real filenames).
const WELCOME_PACKET_FILENAME_RE = /^welcome-packet-\d{4}-\d{2}\.html$/;

export interface WelcomePacketContent {
  sourceFile: string;   // e.g. "welcome-packet-2026-27.html", for logging/debugging only
  title: string;        // trimmed <title> text
  styleHtml: string;    // scoped CSS text — ready to inline verbatim inside a <style> element
  deckHtml: string;     // inner markup of <div class="deck">...</div>, with board flags suppressed
}

// (a) List candidate files.
export function listWelcomePacketFiles(dir: string = CLUB_DOCUMENTS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => WELCOME_PACKET_FILENAME_RE.test(f));
}

// (b) Of those, the ones carrying the marker. Plain substring check — the marker is a
// deliberately unique literal token in a fixed-format, repo-authored file; no need to
// scope the search to a "header region".
export function findMarkedPacketFiles(dir: string = CLUB_DOCUMENTS_DIR): string[] {
  return listWelcomePacketFiles(dir).filter((f) =>
    readFileSync(join(dir, f), "utf-8").includes(WELCOME_PACKET_MARKER),
  );
}

// (c) Zero or multiple matches are the SAME safe empty state — collapsed to one code path
// (`marked.length !== 1`) rather than two branches that could drift apart later.
// (d)+(e)+(f) below.
export function resolveCurrentPacket(dir: string = CLUB_DOCUMENTS_DIR): WelcomePacketContent | null {
  const marked = findMarkedPacketFiles(dir);
  if (marked.length === 0) return null; // expected/normal — between Lions years, fresh checkout. No log.
  if (marked.length > 1) {
    console.warn(`welcome-packet: ${marked.length} files carry ${WELCOME_PACKET_MARKER} (${marked.join(", ")}) — treating as no current packet until this is resolved to exactly one.`);
    return null;
  }

  const sourceFile = marked[0];
  const raw = readFileSync(join(dir, sourceFile), "utf-8");

  let parts;
  try {
    parts = extractPacketParts(raw);
  } catch (err) {
    console.error(`welcome-packet: ${sourceFile} carries the marker but failed to parse (${(err as Error).message}) — treating as no current packet.`);
    return null;
  }

  return {
    sourceFile,
    title: parts.title,
    styleHtml: scopePacketStyles(parts.styleCss, WELCOME_PACKET_WRAPPER_CLASS),
    deckHtml: parts.deckHtml,
  };
}

// (d) Anchored extraction — no HTML parser. Each anchor is a literal, fixed structural
// marker the source file's own header comment already documents as invariant (one
// <title>, one <style> block, one outermost <div class="deck">).
export function extractPacketParts(html: string): { title: string; styleCss: string; deckHtml: string } {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  // Greedy + end-anchored: correct because <div class="deck"> is provably the single
  // outermost, last-closed element in the file (verified: <div> count === </div> count,
  // and the file's final line is a bare </div>).
  const deckMatch = html.match(/<div class="deck">([\s\S]*)<\/div>\s*$/);

  if (!titleMatch || !styleMatch || !deckMatch) {
    const missing = [
      !titleMatch && "<title>",
      !styleMatch && "<style>",
      !deckMatch && '<div class="deck">',
    ].filter(Boolean).join(", ");
    throw new Error(`missing expected anchor(s): ${missing}`);
  }

  return { title: titleMatch[1].trim(), styleCss: styleMatch[1], deckHtml: deckMatch[1] };
}

// (e) + (f) CSS scoping AND board-flag suppression, folded into one transform — see
// "Dark mode" and ".flag suppression" decisions below for why .flag is CSS, not HTML.
export function scopePacketStyles(css: string, wrapperClass: string): string {
  // 1. Drop the OS-dark-mode block entirely (decision below) BEFORE the :root rewrite,
  //    so its nested :root never needs touching. Two-level brace match — safe because
  //    the block's declarations contain no nested braces (verified against the real file).
  let out = css.replace(
    /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^{}]*\{[^{}]*\}[^{}]*\}/,
    "",
  );

  // 2. Rewrite all :root-shaped selectors to the wrapper class in one pass — the bare
  //    :root, and the two [data-theme="..."] attribute-selector variants (which remain
  //    in the output but are inert: nothing in this render ever sets a data-theme
  //    attribute, so .welcome-packet-embed[data-theme="dark"] never matches. Leaving them
  //    scoped-but-inert is simpler and safer than special-casing their removal).
  out = out.replace(/:root\b/g, `.${wrapperClass}`);

  // 3. Rewrite the bare `body` selector. Global + defensive: warns instead of silently
  //    doing nothing if the stylesheet is ever reshaped to no longer have one.
  const BODY_RE = /(^|\n)(\s*)body(\s*\{)/g;
  if (!/(^|\n)\s*body\s*\{/.test(out)) {
    console.warn("welcome-packet: no bare `body` selector found while scoping CSS — stylesheet shape may have changed; verify no unscoped global rule slipped through.");
  } else {
    out = out.replace(BODY_RE, (_m, pre, indent, brace) => `${pre}${indent}.${wrapperClass}${brace}`);
  }

  // 4. Suppress board-review flags (CSS, not HTML — see decision below).
  out += `\n.${wrapperClass} .flag { display: none; }\n`;

  return out;
}
```

**Why `.flag` suppression is a CSS rule, not HTML stripping (architect left this open — my call):** `.flag` elements are plain `<div class="flag"><b>...</b><p>...</p></div>` blocks nested inside `.slide` sections, among 149 other `<div>`s in the file. Regex-stripping an arbitrary tagged block out of a large, deeply-nested HTML document (balanced-tag matching, `[\s\S]*?` non-greedy traps) is exactly the kind of "this only works by luck against today's file shape" risk the architect's dependency section already ruled out a real parser for handling generally — I don't want to reintroduce that risk just for `.flag`. A single, easily-tested CSS rule (`.welcome-packet-embed .flag { display: none; }`) hides every `.flag` element and everything inside it, regardless of nesting depth, with no HTML surgery at all. This is acceptable exactly because this is repo-authored, non-secret club content (open items like "confirm the scholarship amount"), not PII or anything requiring true removal from the DOM — the existing trust-boundary reasoning in Phase 2 already covers this. Net effect for the member: flags never render, full stop; view-source technically still contains the text, which is a non-issue for this content.

**Why the dark-mode block is stripped, not scoped (architect's explicit open call) — decision: STRIP.**

I grepped `src/` for `prefers-color-scheme` and found **zero** matches outside `docs/club-documents/` itself — nothing else in this codebase, admin or member portal, reacts to OS dark-mode preference. CLAUDE.md's Brand Guidelines and UX Guidelines sections define exactly one palette (`lions-blue`/`lions-gold` on white/gray-50) with no dark variant anywhere. Scoping the block (keeping it, correctly contained to the wrapper) would make this the *only* surface in the entire member portal that changes appearance based on OS setting — a one-off inconsistency for zero user-facing benefit, since nothing signals to a member that this one page behaves differently from every other page they've just navigated through.

The "match the packet's own PDF/artifact behavior" argument for scoping doesn't actually hold up: the PDF is generated by `scripts/render-welcome-packet.sh` via a headless browser in *print* media, where `print-color-adjust: exact` and the light palette apply regardless of OS theme — the PDF has never varied by dark mode in practice, only the *live HTML* page could newly introduce that variance. So stripping doesn't create an inconsistency between the web page and the PDF; it prevents one from being introduced. Decision: **strip the `@media (prefers-color-scheme: dark)` block entirely** (step 1 of `scopePacketStyles` above), forcing the light palette unconditionally, matching the rest of the fixed-light-theme portal. The `:root[data-theme="dark"]`/`:root[data-theme="light"]` attribute-selector rules are left in place but scoped-and-inert (see step 2) rather than also stripped, since nothing sets a `data-theme` attribute anywhere in this render path and removing them adds code for no behavioral difference.

### `src/app/members/records/welcome-packet/page.tsx` — exact shape

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveCurrentPacket, WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packet";

export const dynamic = "force-dynamic";

export default async function WelcomePacketPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const memberId = session.user.memberId ?? null;

  const packet = memberId ? resolveCurrentPacket() : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-lions-blue to-lions-blue-dark text-white py-12">
        <div className="container mx-auto px-4">
          <p className="uppercase tracking-widest text-sm text-lions-gold mb-2">Member Portal</p>
          <h1 className="text-3xl font-bold mb-1">Welcome Packet</h1>
          <p className="text-blue-100 max-w-2xl">
            New-member orientation and a look at what the club is doing this year — the same
            packet handed out at the September meetings, published here so it&apos;s always current.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <Link
          href="/members/records"
          className="inline-flex items-center text-sm text-lions-blue hover:underline focus:outline-none focus:ring-2 focus:ring-lions-blue rounded mb-6"
        >
          &larr; Back to Club Records
        </Link>

        {!memberId ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Account Not Linked</h2>
            <p className="text-sm">
              Your user account is not linked to a member record. Contact the club treasurer or an
              administrator to have your account linked so you can view the welcome packet.
            </p>
          </div>
        ) : !packet ? (
          <div className="bg-gray-50 rounded-2xl p-10 text-center text-gray-500 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">No Current Packet Published</h2>
            <p className="text-sm">
              The welcome packet for this Lions year hasn&apos;t been published here yet. Check back
              soon, or ask at a meeting for a printed copy.
            </p>
          </div>
        ) : (
          <div className={`${WELCOME_PACKET_WRAPPER_CLASS} overflow-x-auto`}>
            <style dangerouslySetInnerHTML={{ __html: packet.styleHtml }} />
            <div className="deck" dangerouslySetInnerHTML={{ __html: packet.deckHtml }} />
          </div>
        )}
      </div>
    </div>
  );
}
```

Notes on this shape:
- **Standard portal hero, not the packet's own cover slide, serves as the page header.** Every sibling page in this family (`records`, `financial-reports`) uses the blue/gold `py-12` gradient hero from CLAUDE.md's Page Hero Banners convention. The packet's own cover slide (navy/gold, different font stack, `.slide` chrome) renders as the *first slide inside the scoped deck*, below the app's hero — it does not replace it. Reason: the whole point of the CSS-scoping work is to draw a hard visual boundary between "app chrome" and "embedded foreign-styled document." Promoting the packet's cover slide to double as the page's own header would blur exactly that boundary, and would make this the one page in the portal without the standard hero, for no stated user benefit. This was Phase 1's open question 5-adjacent ("packet's own cover slide as hero" option) — resolving it against, explicitly, here.
- `resolveCurrentPacket()` is only called when `memberId` is non-null — matches the sibling pages' pattern of skipping all data work when the account isn't linked (see `records/page.tsx`'s `memberId ? await Promise.all([...]) : [[], [], []]`).
- `overflow-x-auto` on the wrapper is the entire mobile treatment, per the user's confirmed answer (degraded-but-usable, no reflow redesign) — the deck's own `--slide-w: 62rem` slides scroll horizontally on a narrow viewport instead of squishing.
- `<style>` placed inline in the body (not `next/head`) is valid HTML5 flow content and needs no special handling; this mirrors how the scoped stylesheet must live exactly where its wrapper does, request to request, with no risk of leaking into a shared `<head>` across navigations.

### `src/app/members/records/page.tsx` — exact change

New section, placed **immediately before** the existing `documents.length > 0 &&` Governing Documents block (i.e., first content block inside the `memberId` branch, right after the `!memberId ? ... : (<>` opening). Unconditional — always renders, unlike Governing Documents' zero-state hide, because there is exactly one fixed destination (not a variable-length list) and the destination page owns its own empty state (Phase 1 Flow 2: "the card itself can't fail independently"):

```tsx
<div className="space-y-3">
  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">New Member Welcome Packet</h2>
  <Link
    href="/members/records/welcome-packet"
    className="block bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1 overflow-hidden p-4 max-w-md focus:outline-none focus:ring-2 focus:ring-lions-blue"
  >
    <p className="font-semibold text-gray-900">Welcome Packet</p>
    <p className="text-sm text-gray-500">
      New-member orientation and club overview for the current Lions year.
    </p>
  </Link>
</div>
```

This costs the hub page nothing extra at request time — it does not call `resolveCurrentPacket()` itself, so there's no double file-read between the hub and the destination page.

## Implementation Order

1. ~~Schema~~ — none.
2. ~~Permissions~~ — none.
3. **Add the marker to the live content file, in the same change.** `docs/club-documents/welcome-packet-2026-27.html` currently carries no marker (verified — see Summary). Add `<!-- WELCOME-PACKET: CURRENT -->` on its own line, immediately after the closing `-->` of the existing top-of-file authoring-rules comment and before `<title>` (per architect's placement convention), plus one sentence to that same header comment documenting the rollover workflow: *"At rollover, add this marker to next year's file and remove it from this one, in the same commit."* Do this **before or alongside** step 5 — otherwise the feature ships and the live page immediately shows the empty state, which is not the intent.
4. `src/lib/welcome-packet.ts` + `src/lib/welcome-packet.test.ts` — the helper and its unit tests (see below). Pure, no Next.js/DB dependency; write and pass this in isolation first.
5. `src/app/members/records/welcome-packet/page.tsx` — the page, per the exact shape above.
6. `src/app/members/records/page.tsx` — add the hub card, per the exact shape above.
7. Manual verification (qa, Phase 5): view the page signed in as a linked member with the marker present (normal case); temporarily remove the marker and confirm the empty-state copy renders, not an error; confirm no visible flicker/repaint of the surrounding nav/chrome when the page mounts (the original repaint hazard this whole scoping mechanism exists to prevent); confirm a `.flag` element (temporarily add one to a test fixture, not the real file) does not render; confirm OS dark mode does not change the embedded packet's palette.
8. Release notes entry (tech-lead, at merge time) — one line, e.g. "The welcome packet is now published under Club Records and always reflects the current Lions year."

## Edge Cases & Risks

- **Both real files currently carry zero markers.** Addressed as Implementation Order step 3, not left implicit — the biggest risk here is shipping the code correctly and forgetting the content change, which would make the feature appear broken on first deploy even though it's working exactly as designed.
- **Malformed marked file** (missing `<title>`/`<style>`/`.deck` anchor) → `extractPacketParts` throws, `resolveCurrentPacket` catches it, logs `console.error`, returns `null` → member sees the same empty-state copy as "no current packet," never a stack trace. Distinguished from the zero-marker case only in the server log, never in the UI.
- **Two or more marked files** → `console.warn`, same empty-state return as above. Per the user's answer and architect's Phase 2 recommendation, this is treated identically to zero markers rather than picking one — showing nothing is safe, showing the wrong year to the whole club is not.
- **`-presenters.html` variant exclusion is automatic**, not a separate check — `WELCOME_PACKET_FILENAME_RE` requires the filename to end exactly at `-\d{4}-\d{2}\.html`, which `welcome-packet-2026-27-presenters.html` fails (confirmed against the real filename in the repo).
- **File size.** The source file embeds a base64 PNG emblem inline, making one line of the file ~150KB+. This has no bearing on the regex/string operations used here (they operate on the whole string regardless of line length) and is well within what a single `readFileSync` per request handles fine at this traffic scale (same order of magnitude as the `admin/release-notes` precedent) — noted so nobody is surprised opening the file in an editor or wonders whether a streaming read is needed. It is not.
- **`[data-theme="dark"]`/`[data-theme="light"]` selectors remain in the scoped output, rewritten but inert** (see design above) — intentional, not a bug; nothing in this render path ever sets a `data-theme` attribute.
- **No path-traversal surface today** — the route has no dynamic segment, and `resolveCurrentPacket()` takes an optional `dir` override used only by tests, never by request-derived input. This must remain true if an archive/picker feature is ever built later (explicitly out of scope now, per Phase 1 Gap 7) — re-run this reasoning if that ever changes.
- **Mobile** — accepted as degraded-but-usable per the user's answer to Q3; `overflow-x-auto` is the entire treatment, no reflow redesign.

## Out of Scope

- `docs/club-documents/membership-packet-your-first-month.html` — not a standalone document (confirmed by its own header comment); revisit only once/if it's assembled into a real file.
- Any in-app authoring/editing UI for the packet — content stays repo-committed.
- Public-site placement (`/join`, `/about`, etc.) — member-portal only.
- An archive/history of past Lions-years' packets.
- A dark-mode toggle anywhere in the member portal — this feature actively removes the one place that would have introduced OS-driven dark mode, it doesn't add a toggle.
- JS-driven slide navigation (arrows, keyboard paging) — plain CSS scroll only.

## Route path

`/members/records/welcome-packet` — confirmed as proposed, no override. Nests under the existing `records` route group exactly as `records/documents/[slug]` already does; no reason found to deviate.

## Implementer

**ux-developer.** Per the Phase 4 implementer-selection table: this feature has no schema work (no database-admin needed) and no route handler/server action (no api-developer needed) — it is a single Server Component page plus one small, dependency-free `src/lib` helper with its own unit tests, which is exactly the "React components, pages, forms" lane ux-developer owns. It is not a full-stack-developer case either, despite being small: there's no API/UI split to avoid handing off across, since there's no API at all — it's one coherent client-facing surface (page + lib) with no server-logic layer distinct from "read a file and transform a string." Use **ux-developer** for the whole thing, including writing `welcome-packet.test.ts` (Phase 4 gate: the implementer delivers named unit tests, not qa).

## Unit tests to write (`src/lib/welcome-packet.test.ts`)

Test strategy: write real temp fixture files (`fs.mkdtempSync(os.tmpdir())` + `writeFileSync`) and pass the temp dir via each function's optional `dir` parameter — no `fs` mocking. Clean up in `afterEach`. This exercises the real `readdirSync`/`readFileSync` code path, not a mocked stand-in.

Required cases:

1. **Marker found on exactly one file, parses cleanly** — `resolveCurrentPacket(dir)` returns a `WelcomePacketContent` with the expected `title`, and `deckHtml`/`styleHtml` containing the fixture's known content.
2. **Marker present on zero files** — `resolveCurrentPacket(dir)` returns `null`. No file in the fixture dir carries the marker.
3. **Marker present on two or more files** — `resolveCurrentPacket(dir)` returns `null` (not either candidate); assert a `console.warn` was called (spy).
4. **`-presenters.html` variant is excluded** — a fixture named `welcome-packet-2026-27-presenters.html` carrying the marker is never returned as current; `listWelcomePacketFiles` doesn't include it.
5. **Marked file fails to parse** (fixture missing `<style>` or `.deck`) — `resolveCurrentPacket(dir)` returns `null`; assert a `console.error` was called; `extractPacketParts` itself throws for that fixture when called directly.
6. **`extractPacketParts` extraction correctness** — given a small fixture with known `<title>`, `<style>`, and `<div class="deck">` content, asserts each of the three returned fields matches exactly (including that `deckHtml` correctly captures nested `<div>`s inside the deck without truncating early or running past the real end).
7. **`scopePacketStyles` — `:root`/`body` rewrite correctness** — given a fixture CSS string containing all four `:root`-shaped selectors (bare, the two `[data-theme=...]` variants, and the `@media (prefers-color-scheme: dark) { :root {...} }` block) plus a bare `body {...}` rule, assert: the `@media (prefers-color-scheme: dark)` block is entirely absent from the output; the bare `:root` and both `[data-theme=...]` selectors are rewritten to `.welcome-packet-embed` / `.welcome-packet-embed[data-theme="..."]`; the `body` selector is rewritten to `.welcome-packet-embed`; no bare `:root` or `body` token survives anywhere in the output.
8. **`.flag` suppression rule is present** — `scopePacketStyles(css, wrapperClass)`'s output contains the literal `.${wrapperClass} .flag { display: none; }` rule.
9. **`scopePacketStyles` warns, doesn't throw, on a CSS string with no `body` selector at all** — defensive-path coverage for the `console.warn` branch, confirming a reshaped stylesheet degrades safely rather than crashing.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 3 section, and the Per-Phase Status table row for Phase 3 (Complete / Design complete — implementer named / 2026-08-21).
- No `docs/decisions.md` entry — architect already ruled this feature doesn't meet the decisions-log bar (no new dependency, no new top-level module, no permission-catalog change). The two design calls I made here (strip dark-mode block; suppress `.flag` via CSS not HTML) are implementation decisions scoped to one feature's rendering of one content file, not reusable architectural precedent — recorded in this design doc, which is sufficient per the same reasoning architect already applied.

## Open questions / handoff notes

- **Implementer: ux-developer.** Build in the order given above (lib + tests first, then the two pages), and do not skip Implementation Order step 3 (adding the marker to the real content file) — without it, the feature will appear broken on first deploy despite working correctly.
- Both open architect questions are resolved above: the "more than one marker" case is treated identically to zero (empty state, with a `console.warn`), and the dark-mode block is **stripped**, not scoped, with the reasoning given in "Why the dark-mode block is stripped."
- Phase 1 Gaps 3 and 4 (empty-state copy, mobile) are answered concretely above (exact microcopy; `overflow-x-auto` only).
- One thing qa should specifically watch for in Phase 5 that unit tests can't catch: the CSS-scoping mechanism's entire purpose is to prevent a repaint of the app shell (nav, other pages) while this page is mounted — that's a runtime/visual property, not something `welcome-packet.test.ts` can assert. The manual click-through (Implementation Order step 7) must include actually looking at the nav/background while the packet page is open, not just confirming the page itself renders.

---

# Phase 4 — Implementation (UI) — 2026-08-21

**Owner:** ux-developer
**Status:** blocked

### Summary

Built exactly what Phase 3 specified: `src/lib/welcome-packet.ts` (marker resolution, anchored `<title>`/`<style>`/`.deck` extraction, the `:root`/`body` CSS-scoping rewrite, dark-mode-block stripping, CSS-based `.flag` suppression), its 9 named unit tests (all passing, using real temp-file fixtures per the spec — no `fs` mocking), the `/members/records/welcome-packet` page, and the new hub card on `/members/records`. Typecheck is clean and the full suite (1532 tests) passes.

**But while implementing Implementation Order step 3 — adding the marker to `docs/club-documents/welcome-packet-2026-27.html` — I discovered that directory is not tracked by git at all.** `.gitignore` line 57 excludes `docs/club-documents/` entirely, with its own comment explaining why: *"Club documents kept locally, never committed. The 2026-27 welcome packet and its renderer were deleted in aa3b539 because the packet embeds the club's real giving and budget figures. This repository is public; that content stays on disk (and in the private archive), not in source control."* `git log -- docs/club-documents/` confirms it: the most recent commit in this repo, `aa3b539` ("security: remove the club's financial and donor data ahead of publishing," 2026-08-12), explicitly deleted the welcome packet from git — its message calls it out by name: *"the welcome packet (a member handout, not code)"* — alongside nine scripts carrying real budget/transaction figures, specifically **because** it embeds real numbers. I confirmed those real numbers are still in the current local file (`$27,075` given to the community, `$7,500` in scholarships, `$4,500` to WARM as the largest single gift, Rudolph Run revenue breakdowns, etc.) — this is exactly the class of content that commit removed and the `.gitignore` rule now permanently blocks from re-entering.

This directly contradicts a load-bearing assumption baked into Phase 1 (Known Constraints), Phase 2 (architect's "docs/ is confirmed to ship in the deployed bundle and be readable at runtime... proven precedent, not an open question"), and Phase 3 (the entire design). That precedent check was only ever run against `docs/release-notes/`, which **is** git-tracked — nobody checked `docs/club-documents/` specifically, and it is deliberately excluded, for a security reason established one commit before this work-log's own `git log` snapshot at session start.

**Practical consequence:** Vercel deploys build from the git-tracked source tree. `docs/club-documents/` will never exist on a deployed server — not "empty until someone finalizes it," but permanently absent. `resolveCurrentPacket()` will therefore always return `null` in production, regardless of the marker, forever — the page will always render "No Current Packet Published." This is not the recoverable "day-one empty state" Phase 3 anticipated (fixable by adding a marker); it is a structural dead end that no code change on my end can fix, because the one thing the function needs to read will never be deployed.

I did **not** attempt to work around this myself — specifically, I did not weaken or remove the `.gitignore` rule, and I did not commit the real content file. Both would directly reverse a very recent, deliberate security decision, which is not a call for ux-developer to make unilaterally. I did add the marker comment to the local (gitignored, uncommitted) copy on disk, purely so local `pnpm dev` and any local QA click-through can exercise the real success path — `git status` confirms this edit produces no diff and cannot be accidentally committed.

**This needs to loop back to Phase 2 (architect) or Phase 1 (analyst/user), not proceed to Phase 5 QA as-is.** The feature as designed cannot ship. Options for whoever picks this up next, none of which are mine to choose:
- Store the packet content in Postgres instead of the filesystem, authored through an admin UI — the same shape as `documents`/`minutes` (which are DB-backed, not file-backed, for exactly this reason: they need to be committed-content-free and still live-editable).
- Publish a version of the packet with dollar figures replaced by placeholders (the same treatment `aa3b539` applied to the 59 files it scrubbed in place, rather than deleted) — but that's a content decision for the club/user, not an implementation detail, since it changes what members actually see vs. what's printed.
- Some out-of-band production deployment of the real file (e.g., private blob storage, an env-injected secret) — meaningfully more architecture than Phase 2/3 scoped.
- Decide the "living document, always current, browser-rendered" approach doesn't fit this content family and downscope to something else entirely.

### What I did

- Read the full work-log (Phases 1-3) and the sibling pages (`src/app/members/records/page.tsx`, `src/app/members/financial-reports/page.tsx`) to confirm the gating pattern before writing any code.
- Read `docs/club-documents/welcome-packet-2026-27.html` in full and confirmed its structure (marker absence, 149/149 balanced `<div>`s, single `<title>`/`<style>`/`.deck`) matches Phase 3's verified claims.
- Implemented `src/lib/welcome-packet.ts` and `src/lib/welcome-packet.test.ts` exactly per the Phase 3 code listing (function names, signatures, the 4-step `scopePacketStyles` transform, the zero-and-multiple-marker-both-return-null collapse).
- Implemented `src/app/members/records/welcome-packet/page.tsx` and the hub card in `src/app/members/records/page.tsx` exactly per Phase 3's exact-shape listings.
- Added the marker comment plus a one-sentence rollover-workflow note to `docs/club-documents/welcome-packet-2026-27.html`'s header comment (local-disk only — see Status above for why this doesn't reach production).
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm exec vitest run src/lib/welcome-packet.test.ts` (9/9 passing), and the full suite `pnpm exec vitest run` (1532/1532 passing, no regressions).
- Verified against the real content file with a throwaway script that `resolveCurrentPacket()`'s file-listing/marker logic correctly finds exactly one candidate, excludes the `-presenters` variant, and detects the marker — confirming the code is correct; the gap is entirely about what will and won't exist in the production filesystem.
- Discovered and investigated the `.gitignore`/`git log` conflict documented above; did not attempt to route around it.
- Did **not** touch `service-record-sheets-2026-27.html`, `welcome-packet-2026-27-presenters.html`, or `membership-packet-your-first-month.html` — out of scope, confirmed untouched.
- Did **not** run the production build or do QA click-through — out of scope for this phase per the task instructions; also moot until the blocking issue above is resolved, since a production build would not surface this (the directory is simply absent, no build error).

### Outputs

**Files Created**
- `src/lib/welcome-packet.ts` — marker resolution, extraction, and CSS-scoping helper module.
- `src/lib/welcome-packet.test.ts` — the 9 named unit tests from Phase 3, all passing.
- `src/app/members/records/welcome-packet/page.tsx` — the live packet page.

**Files Modified**
- `src/app/members/records/page.tsx` — added the "New Member Welcome Packet" hub card, placed immediately before the Governing Documents block per Phase 3.
- `docs/club-documents/welcome-packet-2026-27.html` — added the `<!-- WELCOME-PACKET: CURRENT -->` marker and a rollover-workflow sentence to the header comment. **Local disk only** — this directory is git-ignored (`.gitignore` line 57) and this change produces no `git status` diff; it does not and cannot reach any deployment. Documented here for the record and for whoever picks up the blocking issue next, not as a shipped change.

**Schema Changes**

None.

### Implementer Notes

- The blocker is not a bug in anything I wrote — `tsc`, the full unit suite, and a direct verification script against the real file all confirm the lib/page code does exactly what Phase 3 specified. The blocker is that the one input the whole feature depends on (`docs/club-documents/*.html`) is structurally excluded from every deployed build, by a security decision the pipeline made one commit before this work-log started and that none of Phases 1-3 cross-checked against this specific directory.
- Per CLAUDE.md's "No Personal Data in the Repository" / financial-data-scrub precedent and my own role's instruction to "stop and surface to tech-lead" rather than push through a conflict silently, I'm reporting this as **blocked**, not complete, and recommending a loop-back rather than handing this to qa as if it were ready. Marking it "complete" would mean either qa passes a feature that is permanently non-functional in production, or someone downstream quietly commits real club financial data to a public repository to make it "work" — both worse outcomes than surfacing this now.
- If the resolution is "move this to the database" (my best guess at the most consistent fix, matching how `minutes`/`documents` already solve "member-portal content that must be live-editable without living in the git-tracked filesystem"), most of `src/lib/welcome-packet.ts`'s pure string-transform logic (`extractPacketParts`, `scopePacketStyles`) is still reusable as-is against whatever text gets pulled from a `packet_content` column instead of `readFileSync` — only `listWelcomePacketFiles`/`findMarkedPacketFiles`/the file-resolution half of `resolveCurrentPacket` would need to be replaced with a DB query. Flagging this so the next design pass doesn't have to start from zero.
- Nothing in this change touched `.gitignore`, committed the real content file, or altered the security posture established by `aa3b539` in any way.

---

# Phase 1 (Supplemental) — Admin Authoring & Migration (analyst)

**Scope note:** this is a supplemental pass, not a redo. The member-viewing flow (Flow 1/2, the empty state, the no-`FEATURES`-key read gate, mobile, `.flag` suppression, dark-mode stripping) from the original Phase 1 above is unchanged and still governs the reader page. This pass covers only what's new: an admin-authoring verb that didn't exist before, and the one-time migration of real content into whatever storage replaces the gitignored file. I read `src/lib/documents-queries.ts` (405 lines) and `src/lib/minutes-queries.ts` in full, both admin UIs (`src/components/admin/minutes/minutes-body-editor.tsx`, `src/components/admin/documents/document-version-form.tsx`, `src/app/(dashboard)/admin/minutes/`, `src/app/(dashboard)/admin/documents/`), both permission-binding migrations (`0080_minutes_permissions.sql`, `0082_governance_documents_permissions.sql`), `scripts/seed-governance-document.ts` in full, the `documents`/`documentVersions`/`minutes` table definitions in `src/lib/db/schema.ts`, `src/lib/permissions.ts`'s full `FEATURES`/`ROLES` catalog, and — because it turned out to be the single most consequential finding below — `src/components/rich-markdown-content.tsx`/`.test.tsx` and `src/components/documents/document-view.tsx`'s comment citing **DECISION-076 Ruling 3**. I also re-opened the actual local (gitignored) `docs/club-documents/welcome-packet-2026-27.html` to check its "who to contact" slide, since the task asked me not to assume who the author is.

## Verdict: READY WITH NOTES

## One-line take

The CRUD shape here is well-precedented (minutes' simpler create/edit/one-current-pointer/soft-delete pattern fits far better than governing documents' adoption/diffing machinery) and the one-time migration has a ready-made template in `scripts/seed-governance-document.ts` — but authoring this content as raw admin-typed HTML, rendered to the whole membership via `dangerouslySetInnerHTML`, is a real deviation from this project's own established policy (DECISION-076 Ruling 3: markdown-only, no raw-HTML passthrough, precisely to avoid this) and needs the user's explicit, informed sign-off before Phase 2 locks in a design, not just my assumption that "it's fine because git-committed content was already trusted."

## User verbs

**Admin (new surface — this verb did not exist before):**
- Signs in, navigates to a new admin nav item (proposed: `/admin/welcome-packet`, mirroring `/admin/minutes` and `/admin/documents` as siblings, not nested under either — it's a distinct content family).
- Sees a list of packet content records, one per Lions year (e.g. "2026-27", "2027-28"), each showing which one (if any) is current.
- Clicks "New" or an existing record to open an editor: a title field, a Lions-year field, and a large raw-HTML textarea (see Gap 1 below on why raw HTML, not markdown or rich text).
- Saves a draft (not yet live) — can save repeatedly without affecting what members see.
- Clicks a separate "Mark as current" action, confirmed via `<ConfirmDialog>` (never `window.confirm`), which is the actual publish step — this is the moment content becomes visible on `/members/records/welcome-packet` to every linked member.
- (New, optional, recommended below) Clicks "Export as HTML" on the current record to download a standalone file for local PDF rendering via the existing `scripts/render-welcome-packet.sh`.

**Who, specifically, gets this verb is an open question, not a given** — the task flagged this explicitly and I'm not assuming. Evidence from the packet's own content: line 41 of the file's header comment says the "no em dash" house style was "set by the treasurer"; the file's own "Who to contact" slide (line 855) says "Find Chris Henson or anyone on the Technology Committee" for exactly this kind of site/portal question, and the same person is listed as both Treasurer (line 923) and Technology Committee chair (line 722) today — but that's one person's dual role right now, not a role the permission system should be bound to by name. Neither "Technology Committee" nor any equivalent (e.g. `webmaster`) exists in `src/lib/permissions.ts`'s `ROLES` catalog today; the closest precedent for "a new role created specifically for one content family" is `notetaker` (created in `0080_minutes_permissions.sql` for secretary-shaped work), but a webmaster-shaped role is a genuinely different job than "takes minutes," and inventing one is a role-catalog decision, not something I should default into. **Recommendation, per CLAUDE.md's own stated default** ("bind the new `FEATURES.*` key only to the Admin role until you're ready to widen it"): ship bound to `admin` only, and treat "should this widen to treasurer, or to a new role altogether" as an explicit open question for the user, not a design assumption.

## Flows

**Flow A — Admin drafts new packet content**
- Entry: `/admin/welcome-packet` → "New".
- Step 1: Admin enters a title (e.g. "Welcome Packet 2027-28"), a Lions-year identifier, and pastes the full raw HTML (the same `<title>`/`<style>`/`<div class="deck">` shape the file has today) into a textarea.
- Step 2: Admin saves. Server validates the content parses — reusing the already-built `extractPacketParts()` from `src/lib/welcome-packet.ts` (Phase 4 confirmed this logic is storage-agnostic and reusable as-is) — and rejects a save that's missing `<title>`, `<style>`, or `<div class="deck">` with a specific, human error naming which anchor is missing, not a generic "save failed."
- Success outcome: a new draft record exists, visible in the admin list, not yet shown to any member.
- Failure outcomes — **not addressed by the task prompt, needed for Phase 3:** empty submission (blank textarea — reject, don't save an empty "packet"); parse failure (missing one of the three anchors — reject with the specific missing-anchor message, mirroring what `extractPacketParts()` already throws); a save that's technically valid HTML but produces a broken scoped render (e.g., a `<style>` block with no `body` selector at all — `scopePacketStyles()` already just `console.warn`s and continues rather than throwing, which is correct for the *reader* path's resilience but means the *admin* gets no signal at save time that something is off; Phase 3 should decide whether the admin save path treats that warning as a hard validation error instead of a silent pass-through).

**Flow B — Admin marks a draft "current" (publish)**
- Entry: the admin detail view for a draft record, or the list view's row action.
- Step: click "Mark as current" → `<ConfirmDialog>` (per CLAUDE.md — this is a real destructive-adjacent action, since it changes what the whole club sees) → confirm.
- Success outcome: this record becomes current; whatever was previously current (if anything) stops being current — server-side, in one transaction, mirroring `documents.currentVersionId`'s "insert-and-flip in the same transaction" invariant, not two separate writes that could race or partially fail.
- Failure outcome — **not addressed, needed for Phase 3:** what if two admins race to publish two different drafts at once? The governing-documents precedent (`documents-queries.ts`) solves exactly this shape of problem with a single non-nullable pointer column reassigned inside one DB transaction — the same mechanism (not a boolean flag, which is more race-prone: a boolean model needs an application-level "unset all others, set this one" step that a governance-doc-style single pointer avoids for free) should carry over here. Flagging as a Phase 3 data-model input, not resolving it myself.

**Flow C — Admin edits an existing (draft or current) record**
- Entry: `/admin/welcome-packet` → click an existing record.
- Step: edit the same fields as Flow A, save.
- Success outcome: if the record being edited is the current one, the live member-facing page reflects the edit on next request (`force-dynamic`, per the existing Phase 3 design — no caching to invalidate).
- Failure outcome: same validation as Flow A. **One sharp edge worth naming:** editing the *currently live* record in place, with no draft/review step, means a bad save is live to the whole membership the instant it's saved — there is no "preview before publish" distinct from "save this draft" the way minutes has (draft → approved) or documents has (pending substantive version → adopt). Recommend Phase 3 consider whether editing an already-current record should write to a fresh (non-current) row instead, requiring a second "mark as current" confirm to go live — cheap insurance against exactly this, and it reuses Flow B's "mark current" step rather than adding a new one.

**Flow D — One-time content migration (script, not a recurring feature)**
- Entry: whoever has both repo access (to the gitignored local file) and DB write access runs `pnpm exec tsx scripts/seed-welcome-packet.ts` (dry-run default) then `--apply`, following the exact convention `scripts/seed-governance-document.ts` already establishes: `PROD_DATABASE_URL || DATABASE_URL || DB_URL` target resolution with a loud `*** TARGET: PRODUCTION ***` banner, `SCRIPT_OPERATOR_EMAIL` for write attribution (never a hardcoded person's email, per CLAUDE.md's "No Personal Data" rule), not wired into `drizzle/migrations/` so it can never be silently re-triggered by a routine deploy.
- Step: script reads the local `docs/club-documents/welcome-packet-2026-27.html` (confirmed present on disk right now, 375KB, un-ignored-but-untracked — `git status` shows no diff for it), runs it through the same `extractPacketParts()` used by the reader path, and inserts one record with Lions year "2026-27", marked current.
- Success outcome: dry run prints a preview (title, byte counts, anchor-found confirmation); `--apply` writes the row and prints the new record's id.
- Failure outcome: extraction fails the same way Flow A's save-time validation would — refuse to write, print the specific missing anchor, exit non-zero. Script must **never** weaken `.gitignore` or commit the source file — same explicit non-negotiable the Phase 4 ux-developer already correctly refused to cross.
- **Recommended over "paste it by hand into the new admin UI once it's built"**, for one concrete reason: the real file is 375KB including a base64-embedded PNG emblem. Hand-pasting that into a browser textarea (copy from a local file, paste into a form, submit) is exactly the kind of interaction likely to silently truncate, hang the browser tab, or corrupt whitespace-sensitive HTML — a scripted read-and-insert has none of those failure modes for a one-time, already-correct source file. Hand-entry-via-the-new-UI is the right tool for *future* year-over-year edits (smaller, incremental changes, plus it exercises the same path a real editor will use going forward), not for this one bulk migration.

**Flow E — Admin exports the current packet as a standalone HTML file (recommended addition, for printing)**
- Entry: `/admin/welcome-packet` → current record → "Export as HTML".
- Step: server reassembles the record's stored (unscoped) title/style/deck back into one standalone file (`<!doctype html><html><head><title>...</title><style>...</style></head><body><div class="deck">...</div></body></html>` — trivial, since Phase 3's design already stores/extracts these as separate raw parts, and scoping is applied only at *member-page render time*, never to the stored copy).
- Outcome: a downloaded `.html` file the admin can run locally through the **unchanged** `scripts/render-welcome-packet.sh`, preserving its slide-count/page-count integrity check exactly as it works today.
- No failure path beyond "current record doesn't exist yet" (same empty state as the reader page).
- **This is my recommendation for the task's Question 4**, over teaching the app to generate PDFs itself: no new dependency (headless-browser PDF rendering would be a real architect-level addition — new binary, new build-time cost, new failure surface, for a low-frequency admin action), and it keeps the existing, already-working, already-valuable integrity check intact rather than reimplementing it.

## Permissions

- **New `FEATURES` key required.** Neither `MINUTES_MANAGE`/`MINUTES_DELETE` nor `DOCUMENTS_MANAGE` covers this — those gate different content tables entirely, and this project's convention (confirmed against both) is one dedicated key per content family, never a shared/overloaded one. Proposed: `WELCOME_PACKET_MANAGE: "welcome_packet.manage"` — covers create, edit, and mark-current in one key, following `DOCUMENTS_MANAGE`'s precedent (one key, author-and-publish combined) rather than `MINUTES_MANAGE`/`MINUTES_DELETE`'s split, since there's no analog here to "deletion is admin-only, authoring is broader" — nothing about this content needs a separate delete-only gate (no destructive action beyond superseding a record with a new "current," which Flow B already gates).
- **Default role binding: `admin` only**, per CLAUDE.md's explicit stated default for a new key without a settled answer on who else should hold it. **Open question, not resolved by me:** should this widen to `treasurer` (house-style precedent), to a new role mirroring how `notetaker` was purpose-built for minutes/documents (something like `webmaster` or `technology_chair`), or stay `admin`-only indefinitely? I'm flagging three real candidates, not picking one, because the file's own evidence points at a specific person's dual role today (Treasurer + Technology Committee chair), not a settled organizational answer.
- **The reader-side gate is unchanged** — no `FEATURES` key for reading, per the original Phase 1's finding (still valid): `auth()` + linked `memberId`, open to every linked member regardless of role.
- **Every authoring route must re-check `hasFeature()` server-side**, not just gate the admin nav entry — per CLAUDE.md's "the proxy is a coarse outer gate, not the gate" invariant and `src/lib/admin-page-feature-gates.test.ts`'s build-time enforcement. Naming this explicitly since it's a new admin area and easy to get half-right (nav-gated but route-open).

## Gaps the request didn't address

1. **Raw-HTML admin authoring conflicts with this project's own established policy — the sharpest finding of this pass.** The task's own framing (a rich-text editor would fight this content shape badly) is correct, and the minutes/documents precedent (`minutes-body-editor.tsx`, `document-version-form.tsx`) does use plain `<textarea>` inputs, not WYSIWYG — but for **markdown**, rendered through `RichMarkdownContent`, which is explicitly, deliberately built with **no `rehype-raw`** (`src/components/rich-markdown-content.tsx`'s own comment: "deliberately NO rehype-raw / raw-HTML passthrough," with a unit test asserting it: `rich-markdown-content.test.tsx`, "never passes through raw HTML"). `document-view.tsx`'s own comment cites this by name: **DECISION-076 Ruling 3** chose markdown-only specifically over `ReleaseNotesViewer`'s `rehype-raw` pipeline. And `ReleaseNotesViewer`'s raw-HTML rendering is not actually a counter-example — its content is `docs/release-notes/*.md` files, git-committed and (implicitly) PR-reviewed before merge, the same trust boundary as code. The welcome packet's proposed authoring path has neither of that governance doc's safeguards: it would be raw HTML, typed directly into a form by one admin, saved, and (once "marked current") rendered via `dangerouslySetInnerHTML` to every linked member on their next page load — no second reviewer, no diff, no PR gate, no markdown sanitization layer. **This is a real, deliberate policy the project already chose once for a very similar problem (member-facing content authored by a small trusted group) and chose the safer of two options.** I'm not silently recommending an exception to it. Two honest paths forward, and this needs the user's explicit call, not mine:
   - **(a) Accept raw HTML, explicitly, as a documented exception** — reasoning: the packet cannot be expressed in markdown at all (custom CSS variables, `.box`/`.grid`/`.rule` classes, base64-embedded images, precise slide pagination) the way governance-document prose can; the permission is narrowly scoped (default `admin`-only, not "any linked member" or even "any admin-adjacent role"); and anyone holding `welcome_packet.manage` already has real elevated trust in this system. If chosen, this should be written down as a decision (`docs/decisions.md`), the same way DECISION-076 Ruling 3 was, precisely because it's the exception to that ruling, not a fresh, unrelated call.
   - **(b) Sanitize server-side before storage or before render** (an HTML allowlist sanitizer, e.g. scoped to permit `style`/`div`/`section`/`img` and the packet's known custom attributes) — closes the gap but is real, sizable new work: a new dependency (none of `cheerio`/`jsdom`/a sanitizer currently exists in `package.json`, confirmed by the Phase 2 architect's own dependency check on this same feature), and risks breaking the exact base64-image/custom-CSS shape this content needs, the same concern the architect already raised about a general parser for the *reader* side.
   I'd lean toward (a) given the small, known admin population and the content's inherent shape — but I'm flagging this as the single item most worth a direct question to the user before Phase 2 designs around either answer.
2. **Versioning model: minutes-style fits, documents-style doesn't — my recommendation, with reasoning.** Governing documents' `changeType` (`editorial` vs `substantive`), `adoptedByUserId`/`adoptedAt`/`citingMinutesId`, and full diff/compare UI all exist to serve a **board-ratification** process — a substantive by-laws change requires a vote and doesn't take effect until adopted. Nothing about the welcome packet has an equivalent ratification step; it's edited at the author's own discretion, same as minutes are drafted/approved by the notetaker without a formal amendment-adoption workflow. The original (base) Phase 1 also already scoped "an archive/history of past years' packets" as **explicitly out of scope** for the reader-facing side — members only ever see "the current one." Given both of those, I recommend: **one row per Lions year, a single current-pointer mechanism (not a boolean — see Flow B's race-condition note; a `currentPacketId`-style singleton pointer mirroring `documents.currentVersionId`'s pattern is safer), no diff/compare view, no adoption metadata.** Unlike minutes' true soft-delete-forever-retained model (minutes are a permanent governance record by IRS-guidance reasoning), I don't see an equivalent permanence requirement here — but I'd still keep old (non-current) year-rows retrievable in the admin list rather than hard-deleting them, purely as an accidental-overwrite safety net, which costs nothing and answers the task's own "is last year's packet worth keeping accessible" question with "keep it in the DB for admin reference; still don't expose a member-facing archive unless that's separately requested."
3. **The base64-embedded image bloats a `text` column and makes textarea-editing painful — a real authoring-UX gap, not just a schema footnote.** The current file is 375KB, dominated by one inline base64 PNG. Storing that verbatim in a Postgres `text` column works fine at the DB layer (no practical size limit), but (a) pasting/editing 375KB of single-line-heavy HTML in a plain `<textarea>` in a browser is a genuinely bad authoring experience compared to the paragraph-length content minutes/documents forms were designed around, and (b) every future small text edit re-saves the entire multi-hundred-KB blob. Not something I should resolve (that's a Phase 2/3 data-model and UX call — e.g., moving the emblem to a small set of stored static assets referenced by URL rather than embedded per-packet), but it's a materially different authoring shape than the two precedents this task asked me to study against, and deserves an explicit decision rather than "just use the same textarea pattern" by default.
4. **Save-time validation needs to be at least as strict as the reader path's, and arguably stricter.** `resolveCurrentPacket()`'s existing (Phase 4-built) failure handling — catch a parse error, log, fall back to the empty state — is the right behavior for a *reader* hitting unexpected content, but it is the wrong behavior for an *admin's save action*: silently accepting a save that will later degrade to "No Current Packet Published" for the whole club, with no error shown to the person who just clicked Save, is a worse failure mode than rejecting the save up front with a specific error. Flow A/B above name this; restating it here because it's a genuine gap in what the task described, not implied by studying the two precedents alone (their save paths already validate against much simpler shapes).
5. **Race condition on "mark as current" is unaddressed by either precedent directly** — see Flow B. `documents.currentVersionId`'s single-pointer-in-one-transaction pattern is the right model to copy; a naive `isCurrent: boolean` column (set this row's flag, unset all others') is not atomic without extra care and is worth ruling out explicitly rather than defaulting to it because it "looks simpler."
6. **`service-record-sheets-2026-27.html` and `membership-packet-your-first-month.html` are NOT part of this migration, and I recommend keeping them explicitly out of scope, not silently folding them in.** The task's Context section mentions the service-record sheets as one of the "real content" items sitting only on local disk — but neither the base Phase 1 (which never scoped them as a page to render) nor Phase 3's design (which only ever resolves `welcome-packet-<year>.html`, not the sheets file) treats them as part of "the current packet" object. The sheets file is explicitly a *print-only insert*, referenced by the packet's own text ("printed separately... included in this packet as an insert") but never rendered inline. Folding it into this migration/schema would silently expand this feature's scope beyond what any phase has designed for. **Named risk, not a task for this pass:** it exists only on local disk and in the private archive today, with no backup plan of its own — worth a one-line note to the user, not a scope change here.
7. **No admin nav entry currently exists for this content family** — `/admin/welcome-packet` (or wherever Phase 2/3 places it) needs to be added to `ADMIN_NAVIGATION` (`src/lib/permissions.ts`), which is also what auto-derives the proxy's protection rule for that route segment per DECISION-082 ("Admin-Area Protection Is Derived, Never Hand-Maintained") — flagging so Phase 3/4 don't hand-roll a separate route guard that could drift from the nav-derived one.

## Out of scope (confirm with user)

- `service-record-sheets-2026-27.html` and `membership-packet-your-first-month.html` — neither is part of "the current packet" as any phase has designed it; migrating or publishing either is new scope, not this pass's.
- Server-side PDF generation — Flow E's "export as HTML + run the existing local script" is the recommendation instead; building in-app PDF rendering would be a new dependency and a new architect-level decision.
- A member-facing archive of past years' packets — the base Phase 1 already scoped this out for readers; this pass's "keep old rows retrievable in the admin list" recommendation is an admin-only safety net, not a public/member archive.
- Inventing a new role (e.g. `webmaster`) for this permission — flagged as a real candidate, not decided here; defaulting to `admin`-only until the user says otherwise.

## Open questions

1. **Raw HTML, accepted as a documented policy exception (my lean), or sanitized?** (Gap 1 — the one I'd most want answered before Phase 2, since it changes the data model, the admin form, and possibly requires a `docs/decisions.md` entry either way.)
2. **Who should hold `welcome_packet.manage` by default beyond `admin`?** Treasurer (house-style precedent), a new purpose-built role (mirroring `notetaker`), or stay `admin`-only? (Permissions section.)
3. **Should editing an already-current record require a second "mark current" confirm to go live, or is direct in-place editing of the live record acceptable?** (Flow C.)
4. **Is the base64-embedded emblem staying inline per-packet, or moving to a referenced static asset?** (Gap 3 — affects schema size and textarea-editing UX materially.)
5. **Confirm the migration plan:** a one-off `scripts/seed-welcome-packet.ts` (Flow D), following `seed-governance-document.ts`'s dry-run/`--apply`/`SCRIPT_OPERATOR_EMAIL` convention, reading the still-present local `docs/club-documents/welcome-packet-2026-27.html` once and never again. Any objection to that shape?

## Adversarial pass

- **Redirect targets:** none — no `callbackUrl`/`next`/`redirect` param anywhere in the new admin flows. N/A.
- **State-machine shortcuts:** the authoring/mark-current routes must independently re-check `hasFeature(session.user.features, FEATURES.WELCOME_PACKET_MANAGE)` in the route/action body, not rely on the admin nav or proxy alone — restated explicitly because this is a brand-new admin area (see Gap 7) and the project's own admin-page-feature-gates test exists specifically to catch this class of miss.
- **Enumeration leaks:** low risk — record ids are only ever admin-facing (no public/member-facing per-id route for individual (non-current) packets), so there's no enumeration surface exposed to a lower-privileged user. N/A beyond the standard "don't leak other years' draft content to members" rule, which the reader page's "only ever fetch the current record" design already satisfies by construction.
- **Input boundaries — the real finding, restated from Gap 4:** an empty or malformed save must be rejected server-side with a specific error, not silently accepted and left to fail later at read time. This is the one place this feature's adversarial surface differs meaningfully from the base Phase 1's read-only pass: there is now a write path, and "what happens on a bad write" needs the same rigor Pass 4 already gave the read failure states.
- **Self-targeting:** N/A — no role a member (or even a lower-privileged admin) can grant themselves; `welcome_packet.manage` is a role-binding decision made in a migration, not something any UI in this feature exposes.

## What I did

- Read `src/lib/documents-queries.ts` (405 lines) and `src/lib/minutes-queries.ts` in full, plus the `documents`/`documentVersions`/`minutes` table definitions in `src/lib/db/schema.ts`, to compare the two versioning shapes concretely rather than from the work-log's summary of them.
- Read both admin authoring UIs (`src/components/admin/minutes/minutes-body-editor.tsx`, `src/components/admin/documents/document-version-form.tsx`) and confirmed both use plain `<textarea>` for markdown body content, not a rich-text editor — supporting the task's own textarea instinct, but for markdown, not raw HTML.
- Read `src/components/rich-markdown-content.tsx` and its test file, and `src/components/documents/document-view.tsx`'s header comment, which is where I found the DECISION-076 Ruling 3 citation — the load-bearing finding of this pass.
- Read `src/components/admin/release-notes-viewer.tsx` and confirmed its `rehype-raw` usage renders git-committed `.md` files, not DB-backed admin-typed content — ruling it out as a counter-precedent for "raw HTML from an admin form is already accepted here."
- Read both permission-binding migrations (`0080_minutes_permissions.sql`, `0082_governance_documents_permissions.sql`) in full to confirm the exact role-binding pattern (`admin` + `notetaker` for both) and to ground the "no existing role fits" finding for this feature.
- Read `scripts/seed-governance-document.ts` in full as the migration-script template (dry-run default, `--apply` flag, `PROD_DATABASE_URL` resolution/banner, never-a-migration reasoning).
- Read `src/lib/permissions.ts`'s full `FEATURES`/`ROLES`/`ADMIN_NAVIGATION` catalog to confirm no existing key or role covers this, and to note the DECISION-082 nav-derived-proxy-protection requirement for whatever admin route Phase 3 picks.
- Re-opened the local (gitignored, present-on-disk, untracked) `docs/club-documents/welcome-packet-2026-27.html` specifically to check its "Who to contact" slide and header-comment house-style attribution, per the task's explicit instruction not to assume who the author is — found evidence for both Treasurer and Technology Committee, not a clean single answer.
- Confirmed via `ls`/`git status` that the real content file is still present and untracked, and that `service-record-sheets-2026-27.html` and `welcome-packet-2026-27-presenters.html` also exist locally, informing the out-of-scope call in Gap 6.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 1 (Supplemental) section, and the Per-Phase Status table's "4b" row updated to reflect analyst-supplemental-complete.

## Open questions / handoff notes

- **Verdict is READY WITH NOTES, not NEEDS REWORK** — every open question here is answerable, and none of them invalidates the overall shape (a DB table mirroring minutes' simplicity, a new `welcome_packet.manage` key defaulted to `admin`, a one-off migration script following the governance-document seed template, `extractPacketParts()`/`scopePacketStyles()` reused as-is per the Phase 4 ux-developer's own note). But **Gap 1 (raw HTML vs. this project's own no-raw-HTML-passthrough precedent) is the one item I'd genuinely block Phase 2 on** if it goes forward silently as "just use a textarea" without the user explicitly weighing in — it's not a stylistic nice-to-have, it's a live conflict with a decision (DECISION-076 Ruling 3) this same codebase already made once, deliberately, for a materially similar problem.
- Architect (Phase 2): the data-model recommendation above (single current-pointer, not a boolean; minutes-style retention, not documents-style diffing) is a functional-level call, not a schema — the exact column shapes are yours and database-admin's to design. Please specifically confirm the pointer-vs-boolean choice against the race condition named in Flow B before it's built either way.
- Tech-lead (Phase 3): Flow E (export-as-HTML for the existing local render script) is a recommendation, not a requirement from the user — confirm it's wanted before designing it in; if not, the render-script/PDF story is simply unaddressed by this feature going forward, which is also an acceptable (if less complete) outcome.

## User answers to Open Questions (2026-08-21)

Asked directly, per Gap 1's recommendation not to let this go forward silently:

1. **Raw-HTML vs. DECISION-076 Ruling 3: documented narrow exception, not sanitization.** The user chose "Document a narrow exception" over "add server-side sanitization (DOMPurify)." Architect/tech-lead: this needs its own decisions.md entry (next available number) recording that `welcome_packet.manage`-gated raw-HTML authoring is a deliberate, scoped carve-out from DECISION-076 Ruling 3 — content that cannot be expressed as markdown (custom CSS, fixed slide pagination, embedded images) authored by a small, trusted, admin-only population, not a general-purpose raw-HTML feature. No sanitization library is being added; the safety argument rests entirely on the permission gate staying admin-only (see next point) — do not widen `welcome_packet.manage` beyond `admin` without revisiting this decision.
2. This reinforces the supplemental Phase 1's own lean on **who holds `welcome_packet.manage`: default to `admin` only**, exactly as recommended — the raw-HTML exception's safety argument depends on it.

Proceed to Phase 2 (architect) for the DB-backed redesign, informed by both this section and the Phase 1 (Supplemental) analysis above.

---

# Phase 2 (Revised) — Architectural Review (architect)

**Owner:** architect
**Status:** complete

## Verdict: Approved with suggestions

## One-line take

The shape holds: two small sibling tables (no `documents`-style diff/adoption machinery), a lib-module split that resolves the naming collision cleanly, one new `FEATURES` key bound to `admin` only, and a decisions-log entry written now rather than deferred — the "suggestions" are two implementation-order notes for tech-lead (validate raw HTML at save time, not just at read time; don't let the singleton-current table's seed row be forgotten in the migration) rather than anything structural.

## What I reviewed

- The full Phase 1 (Supplemental) section above, in particular Flows A-E, the permissions section, and Gaps 1-7, plus the user's answers to its two open questions (raw-HTML exception accepted; `admin`-only confirmed).
- `src/lib/db/schema.ts`'s `minutes` (lines 1506-1611), `documents` (1676-1717), and `documentVersions` (1718-~1770) table definitions in full, specifically `documents.currentVersionId`'s extensive inline comment (DECISION-076/081) and `minutes`' deliberate no-`unique(kind, meetingDate)` comment, to ground the pointer-vs-boolean and uniqueness calls below in this codebase's actual precedent rather than the work-log's paraphrase of it.
- The existing singleton-row pattern, confirmed via `grep` against two real instances (`ledgerSettings`, the acknowledgment-letter-template table) — both are a plain `uuid` PK with `.defaultRandom()`, "one row" enforced by application convention, not a hardcoded literal id. This is the pattern I'm reusing for `welcomePacketCurrent`, not `documents.currentVersionId`'s on-the-parent placement (see Schema below for why those are different shapes).
- `docs/decisions.md`'s DECISION-076 (full text) and DECISION-082 (full text) to cite both precisely rather than from memory.
- `src/lib/permissions.ts` lines 350-400, specifically the `ADMIN_NAVIGATION` "Records" group (`Minutes` → `/admin/minutes`, `Governing Documents` → `/admin/documents`) and its comment explaining why `MINUTES_DELETE` must appear in `requiredFeature` even though only `admin` (who bypasses feature checks) holds it — directly informs the new nav entry below.
- `scripts/seed-governance-document.ts`'s header comment and dry-run/`--apply`/`PROD_DATABASE_URL` structure as the confirmed template for `scripts/seed-welcome-packet.ts`.
- The latest `docs/decisions.md` entry number (`DECISION-089`) to assign `DECISION-090` correctly.

## 1. Exact schema

Two sibling tables, placed in `src/lib/db/schema.ts` immediately after `documentVersions` (per the task's explicit precedent — this keeps the whole "records-family" cluster of `minutes`/`documents`/`documentVersions`/`welcomePackets`/`welcomePacketCurrent` contiguous):

```ts
export const welcomePackets = pgTable(
  "welcome_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Administrative label only — e.g. "2027-28". NOT parsed from rawHtml's
    // <title> (that stays a display string inside the content, extracted at
    // read time by extractPacketParts()); NOT unique-constrained, for the
    // same reason minutes has no unique(kind, meetingDate) — a redo or
    // correction for one Lions year must stay representable as a second row,
    // not force an overwrite.
    lionsYear: text("lions_year").notNull(),
    // The ENTIRE admin-authored source file content — <title>/<style>/
    // <div class="deck">...</div>, unmodified. Single field, not split into
    // title/style/deck columns at write time: the admin authors and edits
    // this as one raw-HTML textarea (the content cannot be usefully
    // decomposed at the UI layer — the <style> block and the deck markup are
    // authored together, in one pass, by one person), and extractPacketParts()
    // already parses this exact shape reliably at read time. Storing three
    // separate columns would just be a redundant, driftable cache of what
    // one parse of this field already gives you for free.
    rawHtml: text("raw_html").notNull(),
    // Same attribution convention as every other *_user_id column in this
    // schema (minutes.authorUserId, documentVersions.authorUserId) —
    // nullable, ON DELETE SET NULL, never displayed to members, internal
    // accountability only.
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // NO pendingDeleteAt / soft-delete column. Unlike minutes (permanent
    // governance record, IRS-guidance retention) there is no equivalent
    // permanence requirement here, but more to the point: no delete verb is
    // scoped anywhere in Phase 1 (Supplemental)'s Flows A-E. Don't build a
    // column for a verb that doesn't exist yet — add it later, against
    // minutes' or ledgerBudgets' precedent, if a real delete requirement
    // shows up.
  },
  (t) => [index("ix_welcome_packets_lions_year").on(t.lionsYear)],
);

export type WelcomePacket = typeof welcomePackets.$inferSelect;
export type NewWelcomePacket = typeof welcomePackets.$inferInsert;

// Singleton current-pointer, same convention as ledgerSettings / the
// acknowledgment-letter-template table: exactly one row ever exists, by
// application convention (seeded once by the migration, never inserted
// again), not a hardcoded literal id. This is NOT documents.currentVersionId
// copied verbatim — that pointer lives ON the parent `documents` row because
// every documentVersions row belongs to exactly one document identity.
// Welcome packets have no equivalent parent: each Lions year is a peer row,
// not a version of one shared document. The pointer therefore needs its own
// tiny home rather than a column on any given welcomePackets row.
export const welcomePacketCurrent = pgTable("welcome_packet_current", {
  id: uuid("id").primaryKey().defaultRandom(),
  packetId: uuid("packet_id").references(() => welcomePackets.id, { onDelete: "set null" }),
  setByUserId: uuid("set_by_user_id").references(() => users.id, { onDelete: "set null" }),
  setAt: timestamp("set_at"),
});

export type WelcomePacketCurrent = typeof welcomePacketCurrent.$inferSelect;
```

**Pointer over boolean — confirming the supplemental analyst's lean, with the exact mechanism.** "Mark as current" becomes a single statement: `UPDATE welcome_packet_current SET packet_id = $id, set_by_user_id = $user, set_at = now() WHERE id = $singletonId`. This is structurally race-free — one column can only ever hold one value at a time, so there is no "two rows both claim current" state to even reach, unlike a boolean-per-row model where "unset all others, set this one" is two logical operations that still need one transaction to appear atomic, and a bug in that transaction (or a future direct-SQL fix that forgets it) can produce two `true` rows with nothing at the schema level to prevent it. The singleton table makes that failure mode structurally impossible rather than merely disciplined-against.

**`lionsYear` validation is app-level, no DB `CHECK`** — same DECISION-041 pattern as `minutes.kind`/`documents.changeType`/`ledgerBudgets.cause`: format-validated (e.g. `/^\d{4}-\d{2}$/`) inside the pure `welcome-packets.ts` module, not a database constraint. Tech-lead/database-admin should follow this precedent as a matter of course, not reopen it.

## 2. The base64-embedded emblem image

**Recommendation: leave it inline in `rawHtml`. Do not build image-storage infrastructure for this pass.**

I considered splitting it to `@vercel/blob` (already an approved dependency, already used for member profile pictures — this would be "reuse an existing capability," not a new one, so it clears the Dependency Evaluation Criteria cleanly). I'm still recommending against it, for a concrete reason specific to how this content actually gets edited: the expected authoring workflow — confirmed by both the existing `scripts/render-welcome-packet.sh` print workflow and the one-time migration script (Flow D) — is "edit the whole file locally in a real text editor, then submit the whole updated file," not incremental in-browser retyping of a wall of base64. Nobody is going to hand-edit a 375KB textarea character by character; they're going to paste over the entire field from their own locally-edited copy, exactly as the migration script does today. Splitting the image out doesn't change that workflow shape at all — the deck's own custom HTML/CSS is still tens of KB that has to be reviewed and pasted as a whole regardless of where the image lives — while it does add a new admin verb (image upload), a new failure mode (a broken `<img>` reference if the blob is ever moved or deleted independently of the packet row), and a coupling between two storage systems for content that has shipped exactly one way, successfully, for as long as this file has existed. Postgres has no practical concern with a ~375KB `text` row.

**Escalation path, not required now:** if this genuinely becomes painful in practice (e.g., a future editor who isn't comfortable working with the raw file locally), moving the emblem to `@vercel/blob` with `rawHtml` storing an `<img src="...">` reference instead of inline base64 is the natural next step — flagged here so it isn't reinvented from scratch, not committed to.

## 3. Where the admin authoring UI lives

**Route: `/admin/welcome-packets`** (plural — overriding the supplemental analyst's tentative `/admin/welcome-packet` suggestion). Reasoning: `/admin/minutes` is the closer structural precedent, not `/admin/documents` — minutes is a list of many independent peer rows (one per meeting, keyed by a natural period), which is exactly this feature's shape (one row per Lions year, admin sees a list, picks one to edit or mark current). `/admin/documents` is a corpus-of-one document's version history (DECISION-076: "no `kind` column — the current inventory is one document") — a materially different admin surface (one document, many versions of it) from "many independent yearly records." Route path plurality should track the closer analogy.

**Nav entry — required, not optional, per DECISION-082's mechanics.** Add to the existing `ADMIN_NAVIGATION` "Records" group (`src/lib/permissions.ts`, ~line 362), as a third sibling after Governing Documents:

```ts
{
  name: "Welcome Packet",
  href: "/admin/welcome-packets",
  icon: "🎒",              // tech-lead's call on the exact glyph — placeholder
  requiredFeature: FEATURES.WELCOME_PACKET_MANAGE,
},
```

This is what makes `getAdminProtectionRules()` derive the matching proxy rule for the `/admin/welcome-packets` segment automatically — confirming the mechanics the task asked me to confirm: `getAdminProtectionRules()` groups `ADMIN_NAVIGATION` items by top-level path segment and unions each segment's `requiredFeature`(s) into one proxy rule (DECISION-082's own description, verified against its full text). Without this nav entry, the route falls to the `ADMIN_DASHBOARD` catch-all — not broken, but wrong (an `admin`-only feature would incidentally also require `ADMIN_DASHBOARD`, which every `admin` holds anyway in practice, but this is exactly the "absent from `ADMIN_NAVIGATION` entirely" failure mode DECISION-082's own text names as the one thing it does *not* guard against). Add it.

**Point 1 of the admin-proxy-protection invariant still applies in full**: the `/admin/welcome-packets` page (and any server action it calls) must independently call `auth()` + `hasFeature(session.user.features, FEATURES.WELCOME_PACKET_MANAGE)` in its own body — the proxy is a coarse outer gate, not the gate, and `src/lib/admin-page-feature-gates.test.ts` will fail the build if this is skipped. Naming this explicitly since it's a brand-new admin area.

## 4. Member-facing page placement — confirmed unchanged

`src/app/members/records/welcome-packet/page.tsx` holds, exactly as Phase 3 originally placed it. Singular — "the current packet" — consistent with `/members/financial-reports`' own singular framing ("the current month's statement"), and consistent with the reader-side Phase 1's explicit scoping ("members only ever see the current one, no archive"). The only change is internal to the page's data-fetching: `resolveCurrentPacket()`'s file-based body is replaced by a call into the new `welcome-packets-queries.ts` (a join against the `welcomePacketCurrent` singleton, returning `null` if no packet is currently set — the exact same "no current packet" empty state Phase 3 already designed, just sourced from a null FK instead of a missing marker). No route change, no change to the gating logic (`auth()` + linked `memberId`, no `FEATURES` key on the read side — unaffected by any of this), no change to the CSS-scoping or `.flag`-suppression behavior.

## 5. Server/client split and dependencies

**Still entirely Server Components on the read side** — no change from the original Phase 2 ruling. `dangerouslySetInnerHTML` needs no `'use client'`; nothing here changes that.

**Admin authoring surface needs exactly one small, already-existing client island, not a new dependency.** The create/edit form (title, Lions-year label, raw-HTML textarea) is a plain `<textarea>` inside a `<form action={serverAction}>` using a Next.js server action — no `'use client'` required for the form itself, matching `minutes-body-editor.tsx`/`document-version-form.tsx`'s precedent (confirmed by the supplemental analyst: both already use plain textareas, not rich text). The one place a client component is genuinely needed is the "Mark as current" action, because it must go through `<ConfirmDialog>` per CLAUDE.md's no-native-dialogs rule — `ConfirmDialog` is a client component (`useState` for open/close), so the button that triggers it lives in a small client wrapper calling a server action on confirm. This is not new infrastructure; it's the exact same shape every other destructive-adjacent admin action in this codebase already uses. **No rich-text editor, no HTML sanitizer, no new npm dependency of any kind.** This confirms the user's decision (raw HTML, no DOMPurify) is fully buildable within the existing dependency set.

## 6. Invariants

**Permissions Are the Only Gating Mechanism** — satisfied. One new `FEATURES` key, `welcome_packet.manage`, bound to `admin` only via a migration (the `add-permission` skill is the right tool for database-admin to reach for in Phase 4 — it exists precisely for "idempotent migration + role binding" of a new key). No environment flag, no parallel gating mechanism. The reader side needs no new key at all (unchanged from the original Phase 2 ruling).

**Admin-Area Protection Is Derived, Never Hand-Maintained (DECISION-082)** — satisfied, mechanics confirmed above in section 3: add the `ADMIN_NAVIGATION` entry, `getAdminProtectionRules()` picks it up automatically, and the page must still carry its own `auth()`/`hasFeature()` check regardless (point 1 of that invariant, restated because it's easy to get half-right on a brand-new admin area).

**The DECISION-076 Ruling 3 exception — write it now, not defer it.** I'm writing `docs/decisions.md`'s `DECISION-090` as part of this Phase 2 (Revised) pass, not leaving it to Phase 3/4, for the same reason the original (superseded) Phase 2 didn't need one and this redesign does: this now involves a new permission-catalog key, two new tables, and — the part that actually crosses the decisions-log bar on its own — a documented, explicit exception to a previous architectural ruling. CLAUDE.md's ownership line is direct on this: "change to the permission catalog... gets a numbered entry in `docs/decisions.md`," and architect owns architectural entries. Waiting until Phase 3/4 to write it risks exactly the failure mode DECISION-076 itself exists to prevent — a policy exception that lives only in a work-log's prose and never becomes a citable, numbered rule the next person can find. **`DECISION-090` is written; see `docs/decisions.md`** (inserted above `DECISION-089`, newest-first). It records the exception's exact scope (raw HTML, `welcome_packet.manage`, `admin`-only, no sanitizer) and states explicitly that widening the permission or citing this decision to justify raw HTML elsewhere both require revisiting it directly — the same "narrow and named, not blanket cover" framing the user's own answer specified.

## Suggestions (not blocking, for tech-lead)

1. **Save-time validation should be strict, per the supplemental analyst's Gap 4 — make this an explicit Phase 3 line item, not an assumption.** `extractPacketParts()` should be called and required to succeed (all three anchors found) before a save is accepted; `scopePacketStyles()`'s existing `console.warn`-and-continue behavior is correct for the *reader* path's resilience but wrong for the *admin save* path — a save that will later degrade to "No Current Packet Published" needs to fail loudly at save time, with the specific missing-anchor message `extractPacketParts()` already throws, not silently succeed and surface as a member-facing empty state days later.
2. **Don't let the `welcome_packet_current` singleton row go unseeded.** The migration that creates the table must also insert its one row (`INSERT INTO welcome_packet_current (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM welcome_packet_current)` or equivalent), same as `ledgerSettings`' own migration does — otherwise `getCurrentWelcomePacket()`'s query has no row to read `packetId: null` from, and every query site needs its own "row doesn't exist yet" branch instead of the query itself always finding exactly one row with a possibly-null pointer. This is a one-line migration detail but worth naming since it's exactly the kind of thing that "works in dev because someone manually poked a row in" and breaks on a fresh environment.
3. **Confirm Flow C's open question (edit-in-place vs. fresh-row-plus-republish for an already-current record) before Phase 4**, per the supplemental analyst's own flag — the schema above supports either answer without modification (a fresh row is just another `welcomePackets` insert; "mark current" already requires an explicit confirm either way), so this doesn't block Phase 2, but it does change the exact server-action wiring and should be settled in the design doc rather than left to implementer discretion.

## What I did

- Re-read the full Phase 1 (Supplemental) section and the user's answers in this same work-log.
- Read `minutes`, `documents`, and `documentVersions`' full table definitions and inline comments in `src/lib/db/schema.ts` to ground the schema recommendation in this codebase's actual, already-reasoned precedent rather than a generic redesign.
- Grepped `src/lib/db/schema.ts` for the existing singleton-row convention (`ledgerSettings`, the acknowledgment-letter-template table) and read `ledgerSettings`' definition in full to confirm the exact shape (`uuid` PK + `.defaultRandom()`, no fixed literal id).
- Read DECISION-076 and DECISION-082 in full from `docs/decisions.md` to cite both precisely.
- Read `src/lib/permissions.ts`'s `ADMIN_NAVIGATION` "Records" group and its surrounding comments to place the new nav entry correctly and confirm the DECISION-082 derivation mechanics.
- Read `scripts/seed-governance-document.ts`'s header comment and structure as the confirmed template for the future `scripts/seed-welcome-packet.ts`.
- Wrote `docs/decisions.md`'s `DECISION-090`, inserted newest-first above `DECISION-089`.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 2 (Revised) section, and the Per-Phase Status table's "4b" row updated to reflect architect-complete / Approved with suggestions.
- `docs/decisions.md` — new **DECISION-090** (newest-first, inserted above DECISION-089): records the DECISION-076 Ruling 3 exception, the `welcomePackets`/`welcomePacketCurrent` schema shape, the `welcome_packet.manage` key and its `admin`-only binding, the inline-emblem call, the one-off-script convention, the `welcome-packet.ts` → `welcome-packets.ts` rename, and the new admin route + nav entry.

## Open questions / handoff notes for tech-lead (Phase 3)

1. **Schema, permission key, table placement, route paths, and the lib-module rename are all settled above** — Phase 3 should treat these as inputs, not open questions, unless it finds a concrete reason to deviate (in which case it loops back here, per the pipeline's normal rule).
2. **Three items explicitly left to Phase 3, not resolved here:** (a) save-time validation strictness (Suggestion 1 above — my recommendation is "hard fail," but the exact error-surfacing UX is tech-lead's/ux-developer's call); (b) whether editing an already-current record edits in place or requires a fresh row + republish (Suggestion 3 above — schema supports either); (c) whether Flow E (export-as-standalone-HTML for the existing local PDF render script) is wanted — still just a recommendation from the supplemental analyst, not a requirement.
3. **`WELCOME_PACKET_MANAGE`'s exact icon/copy in the admin nav** is a placeholder (🎒) above — cosmetic, tech-lead's or ux-developer's call.
4. **Database-admin (Phase 4) should use the `add-permission` skill** for the `welcome_packet.manage` migration + `admin`-only role binding, matching how `documents.manage`/`minutes.manage` were bound, and should seed the `welcome_packet_current` singleton row in the same migration that creates the table (Suggestion 2 above).
5. **The one-time content migration (`scripts/seed-welcome-packet.ts`) should be written and run once real schema/table names are final** — it reads the still-present local `docs/club-documents/welcome-packet-2026-27.html` (confirmed present and untracked, unaffected by any of this review) through the unchanged `extractPacketParts()`, and inserts one `welcomePackets` row plus one `welcomePacketCurrent` update, following `scripts/seed-governance-document.ts`'s exact dry-run/`--apply`/`SCRIPT_OPERATOR_EMAIL` template. Per the standing project-wide rule on destructive/one-time seeds: **do not re-run it after `--apply` succeeds.**

---

# Phase 3 (Revised) — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete

## Summary

Replace the file-based, git-committed welcome packet with a DB-backed content family: two tables (`welcomePackets`, `welcomePacketCurrent`), one new admin-only `FEATURES` key (`welcome_packet.manage`), a small REST admin surface at `/admin/welcome-packets`, and an unchanged member route (`/members/records/welcome-packet`) whose only change is its data source. This section takes DECISION-090 and Phase 2 (Revised) as settled ground truth — schema shape, permission naming, and the raw-HTML exception are not re-litigated here — and turns them into exact column lists, migration SQL, query-function signatures, route contracts, component plans, and named unit tests that two implementers can build from without further judgment calls.

Two design calls this pass makes that Phase 2 (Revised) explicitly left open:

1. **Editing an already-current record edits that row in place.** No fresh-row-plus-republish requirement (see "Edit-in-place vs. fresh-row" below for the reasoning and its mitigation).
2. **Save-time validation is a hard fail, not a warn-and-continue.** `extractPacketParts()` must succeed (all three anchors found) before any create or edit is accepted; `scopePacketStyles()`'s existing `console.warn`-and-continue behavior stays exactly as-is for the *reader* path (Suggestion 1, adopted as stated).

Flow E (export-as-standalone-HTML for the local PDF render script) is **not** included in this pass — it was a recommendation, not a requirement, and nothing in this design blocks adding it later as a follow-up (the stored `rawHtml` already contains everything a future export route would need to reassemble a standalone file). Named explicitly in Out of Scope below so it isn't silently dropped.

## Permissions

One new `FEATURES` key, exactly as DECISION-090 specifies:

```ts
// src/lib/permissions.ts — FEATURES object, immediately after PROPOSALS_REVIEW
// Welcome Packet (docs/work-log/2026-08-21-welcome-packet-live-page.md,
// DECISION-090). Raw-HTML admin authoring is a documented, narrow exception
// to DECISION-076 Ruling 3 — the safety argument rests entirely on this key
// staying admin-only. Do not widen without revisiting DECISION-090.
WELCOME_PACKET_MANAGE: "welcome_packet.manage", // create, edit, and mark-current — one key, no delete verb
```

`FEATURE_DESCRIPTIONS` entry:

```ts
[FEATURES.WELCOME_PACKET_MANAGE]: "Author and publish the member welcome packet",
```

Role binding: **`admin` only**, in the migration (see Data Model). No `notetaker` bind — deliberate, per DECISION-090 point 2.

Reader-side gate is **unchanged**: `auth()` + linked `memberId`, no `FEATURES` key, open to every linked member. This was never in question in the revised design — only the admin authoring side is new.

Every admin route/page independently calls `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` and redirects on failure — required by `src/lib/admin-page-feature-gates.test.ts`, which fails the build if a new top-level `src/app/(dashboard)/admin/*` segment either (a) has no `ADMIN_NAVIGATION` entry, or (b) has a `page.tsx` with no `hasFeature(`/`hasAnyFeature(`/`FEATURES.` match **and** no `redirect(` call. `welcome-packets` will be a new top-level admin segment, so it is automatically in scope for both assertions — confirmed by reading the test file directly (`src/lib/admin-page-feature-gates.test.ts`, the `topLevelAdminSegments()` walk + `it.each` loops), not assumed from CLAUDE.md's description of it.

## API Contract

Mirrors `/api/admin/minutes`'s route shape exactly (list+create at the collection route, single-record GET/PATCH at `[id]`, a dedicated action route for the one state-transition verb) — the closer structural precedent per Phase 2 (Revised)'s own reasoning for why `/admin/welcome-packets` (plural, many peer rows) tracks `/admin/minutes`, not `/admin/documents`.

- **`GET /api/admin/welcome-packets`** — list, for the admin list view. Gated `welcome_packet.manage`. Response: `{ packets: WelcomePacketListItem[] }` (see Data Model for the shape — **excludes `rawHtml`**, which can be ~375KB; the list view never needs the body).
- **`POST /api/admin/welcome-packets`** — create a new packet row. Body: `{ lionsYear: string; rawHtml: string }`. Validates `lionsYear` against `/^\d{4}-\d{2}$/` (`isValidLionsYear()` in `src/lib/welcome-packets.ts`) and calls `extractPacketParts(rawHtml)` — a thrown error becomes `400 { error: "Couldn't save: missing <specific anchor(s)> in the pasted HTML." }` (reusing `extractPacketParts()`'s own thrown message, per the hard-fail decision above). On success: `201 { id: string }`.
- **`GET /api/admin/welcome-packets/[id]`** — single record, including `rawHtml`, for the edit view. `404 { error: "Not found" }` if the id doesn't resolve. Response: `{ packet: WelcomePacketDetail }`.
- **`PATCH /api/admin/welcome-packets/[id]`** — edit-in-place. Body: `{ lionsYear: string; rawHtml: string }`. Same `isValidLionsYear()` + `extractPacketParts()` hard-fail validation as POST. `404` if the id doesn't exist. Response: `{ ok: true }`.
- **`POST /api/admin/welcome-packets/[id]/mark-current`** — the publish action (mirrors `/api/admin/minutes/[id]/restore`'s "dedicated action route, no body" shape). No request body. `404 { error: "Not found" }` if the id doesn't resolve to an existing packet. Response: `{ ok: true }`.

All five routes: `const session = await auth(); if (!session?.user?.id) return 401; if (!(await hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE))) return 403;` at the top, before touching the request body — matching `/api/admin/documents/[slug]/versions/route.ts`'s own opening shape.

**No API route for the member-facing read.** `src/app/members/records/welcome-packet/page.tsx` calls `getCurrentWelcomePacket()` from `welcome-packets-queries.ts` directly in its own Server Component body — same as today, only the function's internals change (DB query instead of `fs.readFileSync`). No new API surface for reading.

## Data Model

### `src/lib/db/schema.ts` — exact additions, placed immediately after `documentVersions` (per DECISION-090 point 3 / Phase 2 (Revised) §1)

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Welcome Packet — DB-backed, admin-authored raw HTML
// docs/work-log/2026-08-21-welcome-packet-live-page.md, DECISION-090.
//
// A documented, narrow, admin-only exception to DECISION-076 Ruling 3
// (governing documents' markdown-only, no-raw-HTML-passthrough policy) — the
// packet's custom CSS variables, fixed print pagination, and embedded images
// cannot be expressed as markdown. The entire safety argument rests on
// welcome_packet.manage staying bound to `admin` only; no sanitization
// library was added (the user's explicit choice). Do not widen the
// permission, and do not cite this table as precedent for raw HTML
// elsewhere, without revisiting DECISION-090 directly.
//
// Two sibling tables, NOT `documents`' parent-pointing-at-child shape —
// welcome packets have no parent identity; each Lions year is a peer row,
// not a version of one shared document.
// ─────────────────────────────────────────────────────────────────────────────

export const welcomePackets = pgTable(
  "welcome_packets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Administrative label only (e.g. "2027-28"), validated against
    // /^\d{4}-\d{2}$/ in src/lib/welcome-packets.ts (DECISION-041 pattern,
    // no DB CHECK). NOT parsed from rawHtml's <title> — that stays a
    // display string inside the content, extracted at read time.
    // NOT unique-constrained — same reasoning as minutes' no-
    // unique(kind, meetingDate): a redo or correction for one Lions year
    // must stay representable as a second row, not force an overwrite.
    lionsYear: text("lions_year").notNull(),
    // The ENTIRE admin-authored source — <title>/<style>/<div class="deck">
    // ...</div>, unmodified. One field, not split into title/style/deck
    // columns: the admin authors and edits this as one raw-HTML textarea,
    // and extractPacketParts() already parses this exact shape reliably at
    // read time. Storing three separate columns would just be a redundant,
    // driftable cache of what one parse of this field already gives for
    // free.
    rawHtml: text("raw_html").notNull(),
    // Attribution only, same convention as minutes.authorUserId /
    // documentVersions.authorUserId — nullable, ON DELETE SET NULL, never
    // displayed to members.
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // NO pendingDeleteAt / soft-delete column — no delete verb is scoped in
    // this feature (Phase 1 Supplemental, Flows A-E). Add one later, against
    // minutes' or ledgerBudgets' precedent, if a real delete requirement
    // shows up. Do not build a column for a verb that doesn't exist yet.
  },
  (t) => [index("ix_welcome_packets_lions_year").on(t.lionsYear)],
);

export type WelcomePacket = typeof welcomePackets.$inferSelect;
export type NewWelcomePacket = typeof welcomePackets.$inferInsert;

// Singleton current-pointer — same convention as ledgerSettings / the
// ledger acknowledgment-letter-template table (plain uuid PK, "one row"
// enforced by application convention, not a hardcoded literal id). NOT
// documents.currentVersionId copied verbatim — that pointer lives ON the
// parent `documents` row because every documentVersions row belongs to one
// document identity; welcome packets have no equivalent parent, so the
// pointer needs its own tiny home. "Mark as current" is a single
// `UPDATE welcome_packet_current SET packet_id = $id, ...` — structurally
// race-free, since one column can only ever hold one value (unlike a
// boolean-per-row model, which needs "unset all others, set this one" as
// two logical operations).
export const welcomePacketCurrent = pgTable("welcome_packet_current", {
  id: uuid("id").primaryKey().defaultRandom(),
  packetId: uuid("packet_id").references(() => welcomePackets.id, { onDelete: "set null" }),
  setByUserId: uuid("set_by_user_id").references(() => users.id, { onDelete: "set null" }),
  setAt: timestamp("set_at"),
});

export type WelcomePacketCurrent = typeof welcomePacketCurrent.$inferSelect;
```

### Migration: `drizzle/migrations/0090_welcome_packets.sql`

One file, following `0080_minutes_permissions.sql`'s pattern of bundling table/role creation with its permission grant in a single `DO $$ ... END $$` block where the statements are logically one unit of work. `0090` is the next available number (`0089_ledger_ack_purpose.sql` is the latest on disk). Every statement idempotent (`IF NOT EXISTS`, `WHERE NOT EXISTS`), per CLAUDE.md's standing rule that every migration re-runs on every deploy.

```sql
-- Welcome Packet — schema + permission
-- (docs/work-log/2026-08-21-welcome-packet-live-page.md, DECISION-090)
--
-- Two new tables (welcome_packets, welcome_packet_current — the latter a
-- singleton-pointer table, seeded with its one row here) and one new
-- permission, welcome_packet.manage, bound to admin only. All statements
-- idempotent and safe to run on every deploy.

CREATE TABLE IF NOT EXISTS welcome_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lions_year TEXT NOT NULL,
  raw_html TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_welcome_packets_lions_year ON welcome_packets (lions_year);

CREATE TABLE IF NOT EXISTS welcome_packet_current (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id UUID REFERENCES welcome_packets(id) ON DELETE SET NULL,
  set_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  set_at TIMESTAMP
);

-- Seed the singleton row exactly once (Phase 2 Revised, Suggestion 2) — every
-- query site depends on exactly one row existing, with a possibly-null
-- packet_id, rather than needing its own "row doesn't exist yet" branch.
INSERT INTO welcome_packet_current (id)
SELECT gen_random_uuid()
WHERE NOT EXISTS (SELECT 1 FROM welcome_packet_current);

DO $$ BEGIN
  -- 1. Insert welcome_packet.manage feature
  INSERT INTO features (name, category, description)
  SELECT 'welcome_packet.manage', 'welcome_packet',
    'Author and publish the member welcome packet'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'welcome_packet.manage');

  -- 2. Bind welcome_packet.manage -> admin ONLY. Do not add a notetaker (or
  --    any other role) bind here without revisiting DECISION-090 — the raw-
  --    HTML exception's entire safety argument depends on this staying
  --    admin-only.
  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'welcome_packet.manage'
  AND NOT EXISTS (
    SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id
  );
END $$;
```

Verified column names (`features.name`/`category`/`description`, `role_features.role_id`/`feature_id`) against `0080_minutes_permissions.sql` and `0082_governance_documents_permissions.sql` directly, not the `/add-permission` skill's generic doc example (which shows a `features.key` column that does not exist in this schema — database-admin should follow the two real migrations, not the skill doc's example verbatim, if the two ever disagree). `welcome_packet_current`'s singleton seed runs as a plain top-level `INSERT ... WHERE NOT EXISTS` (no `DO $$` needed — it's a single statement, matching how other singleton-row migrations in this codebase seed their one row) and is placed **before** the `DO $$` permission block so table creation and its data are grouped together, with the permission grant as its own clearly separated unit.

### `ADMIN_NAVIGATION` entry — `src/lib/permissions.ts`, "Records" group, third item after Governing Documents

```ts
{
  name: "Welcome Packet",
  href: "/admin/welcome-packets",
  icon: "🧳",
  requiredFeature: FEATURES.WELCOME_PACKET_MANAGE,
},
```

(Icon changed from Phase 2's placeholder 🎒 to 🧳 — cosmetic, no functional difference; either is fine, this is just making the "tech-lead's call" in Phase 2's open item concrete rather than leaving 🎒 unconfirmed.)

## Component/Page Plan

**Files to create:**
- `src/lib/welcome-packets-queries.ts` — DB reads/writes (function signatures below).
- `src/lib/welcome-packets-queries.test.ts` — unit tests (named below).
- `src/app/(dashboard)/admin/welcome-packets/page.tsx` — list view.
- `src/app/(dashboard)/admin/welcome-packets/new/page.tsx` — create form (mirrors `admin/minutes/new/page.tsx`'s separate-route-for-create precedent over a modal).
- `src/app/(dashboard)/admin/welcome-packets/[id]/page.tsx` — edit view (form + "Mark as current" panel).
- `src/components/admin/welcome-packets/welcome-packet-form.tsx` — the shared create/edit form (label + raw-HTML textarea + save button). Plain server-renderable markup; the save button posts to the API route via a small client wrapper (`fetch` + `toast`, matching `pending-versions-panel.tsx`'s idiom) since it needs a busy state and a toast on error — not `'use client'` at the whole-page level, just this one form island.
- `src/components/admin/welcome-packets/mark-current-button.tsx` — the one `<ConfirmDialog>`-wrapped client island (see below).
- `src/app/api/admin/welcome-packets/route.ts` — GET (list), POST (create).
- `src/app/api/admin/welcome-packets/[id]/route.ts` — GET (single), PATCH (edit).
- `src/app/api/admin/welcome-packets/[id]/mark-current/route.ts` — POST (publish).
- `src/app/api/admin/welcome-packets/route.test.ts`, `.../[id]/route.test.ts`, `.../[id]/mark-current/route.test.ts` — route-level tests, matching the `.test.ts`-alongside-every-route convention already used under `api/admin/documents/` and `api/admin/minutes/`.
- `scripts/seed-welcome-packet.ts` — one-off migration script (see below).

**Files to rename:**
- `src/lib/welcome-packet.ts` → `src/lib/welcome-packets.ts` — drops `listWelcomePacketFiles`, `findMarkedPacketFiles`, `WELCOME_PACKET_MARKER`, and the file-reading half of `resolveCurrentPacket` (all dead — no filesystem resolution left in this feature). Keeps `extractPacketParts()` and `scopePacketStyles()` verbatim (confirmed source-agnostic — they take a string in, return a string/object out, with zero filesystem awareness). Adds one new pure function: `isValidLionsYear(value: string): boolean` (`/^\d{4}-\d{2}$/.test(value)`, the DECISION-041-pattern validator this table's `lionsYear` column needs, following `src/lib/minutes.ts`'s `MINUTES_KINDS`-adjacent validator pattern).
- `src/lib/welcome-packet.test.ts` → `src/lib/welcome-packets.test.ts` — see "Unit tests to write" below for exactly what carries over vs. needs new fixtures.

**Files to modify:**
- `src/lib/permissions.ts` — `FEATURES.WELCOME_PACKET_MANAGE`, `FEATURE_DESCRIPTIONS` entry, `ADMIN_NAVIGATION` entry (all above).
- `src/lib/db/schema.ts` — the two new tables (above).
- `src/app/members/records/welcome-packet/page.tsx` — swap `resolveCurrentPacket()` (from the old `welcome-packet.ts`) for `getCurrentWelcomePacket()` (from the new `welcome-packets-queries.ts`); everything else (the hero, the two empty states, the wrapper div, `overflow-x-auto`) is unchanged (see exact diff below).
- `src/app/members/records/page.tsx` — **no change needed.** The hub card added in the superseded Phase 4 round already links to `/members/records/welcome-packet` unconditionally (Phase 3 original design: "the destination page owns its own empty state") and doesn't call `resolveCurrentPacket()`/`getCurrentWelcomePacket()` itself — confirmed this still holds by inspection, since the card's whole point was to cost the hub page nothing extra at request time regardless of which page fetches the content.

### `src/lib/welcome-packets-queries.ts` — exact function signatures and return shapes

```ts
import { db } from "@/lib/db";
import { welcomePackets, welcomePacketCurrent, users, type WelcomePacket } from "@/lib/db/schema";
import { extractPacketParts, scopePacketStyles, WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packets";
import { desc, eq } from "drizzle-orm";

export interface WelcomePacketListItem {
  id: string;
  lionsYear: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  isCurrent: boolean;
}

export interface WelcomePacketDetail extends WelcomePacketListItem {
  rawHtml: string;
}

export interface WelcomePacketContent {
  packetId: string;
  lionsYear: string;
  title: string;
  styleHtml: string;
  deckHtml: string;
}

export type SaveWelcomePacketResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_lions_year" | "parse_error"; message: string };

export type MarkCurrentResult = { ok: true } | { ok: false; reason: "not_found" };

/** Admin list view — never includes rawHtml (can be ~375KB; the list never needs it). */
export async function listWelcomePackets(): Promise<WelcomePacketListItem[]>;

/** Admin edit view — the one place rawHtml is fetched by id. Null if id doesn't resolve. */
export async function getWelcomePacketById(id: string): Promise<WelcomePacketDetail | null>;

/**
 * Validates lionsYear format + extractPacketParts(rawHtml) BEFORE inserting
 * (hard-fail per this design's Summary — a save that will later degrade to
 * "No Current Packet Published" must fail loudly at save time, not silently
 * succeed). Returns a discriminated result rather than throwing, so the
 * route handler can turn `ok: false` into a 400 with `message` verbatim.
 */
export async function createWelcomePacket(input: {
  lionsYear: string;
  rawHtml: string;
  createdByUserId: string | null;
}): Promise<SaveWelcomePacketResult>;

/** Same validation as createWelcomePacket, applied to an in-place edit. `ok: false, reason: "not_found"` is NOT part of this union — the route handler checks existence via getWelcomePacketById() first (see API Contract) and returns 404 itself before calling this; keeps this function's contract identical to createWelcomePacket's plus one usage difference (UPDATE vs INSERT). */
export async function updateWelcomePacket(
  id: string,
  input: { lionsYear: string; rawHtml: string; updatedByUserId: string | null },
): Promise<SaveWelcomePacketResult>;

/**
 * The transactional pointer flip (Phase 2 Revised §1 / DECISION-090 point 3).
 * Pre-checks the target packet exists (returns not_found rather than letting
 * a bad id surface as a raw FK violation), then updates the ALREADY-SEEDED
 * singleton row (migration 0090 guarantees exactly one row exists — this
 * function does NOT insert one). Single transaction: existence check +
 * pointer update, so a concurrent "mark current" on two different ids can't
 * interleave into an inconsistent read in between.
 */
export async function markWelcomePacketCurrent(packetId: string, setByUserId: string | null): Promise<MarkCurrentResult>;

/**
 * The member page's one read. Resolves the singleton pointer, loads that
 * packet, parses + scopes it. Returns null for BOTH "no packet is current"
 * (packetId is null) AND "the current packet's stored rawHtml fails to
 * parse" (logs console.error with the packet id + lionsYear, same shape as
 * the old file-based resolveCurrentPacket()'s parse-failure branch) — same
 * empty-state UI either way, per the original design's "showing nothing is
 * safe" reasoning, now applied to a DB row instead of a marked file.
 */
export async function getCurrentWelcomePacket(): Promise<WelcomePacketContent | null>;
```

Implementation notes for whoever writes this file (api-developer):

- `listWelcomePackets()`/`getWelcomePacketById()`/`getCurrentWelcomePacket()` all need "what's current" — read `welcomePacketCurrent`'s single row's `packetId` once per call (there is exactly one row, per the migration seed) and compare, the same `isCurrent: r.id === currentId` idiom `documents-queries.ts`'s `listVersionHistoryForMembers()`/`listVersionsForAdmin()` already use for `documents.currentVersionId`.
- `createWelcomePacket()`/`updateWelcomePacket()` validation order: `isValidLionsYear(input.lionsYear)` first (cheap, no parsing) → `extractPacketParts(input.rawHtml)` in a `try/catch` → on either failure, return the `ok: false` result *without* touching the database. Only on both passing does the `INSERT`/`UPDATE` run.
- `markWelcomePacketCurrent()`'s transaction body: `SELECT id FROM welcome_packets WHERE id = $packetId` (not_found if empty) → `SELECT id FROM welcome_packet_current LIMIT 1` (guaranteed non-empty by the migration seed — no not-found branch needed here) → `UPDATE welcome_packet_current SET packet_id = $packetId, set_by_user_id = $setByUserId, set_at = now() WHERE id = $singletonId`.
- `getCurrentWelcomePacket()` calls `extractPacketParts()` then `scopePacketStyles(parts.styleCss, WELCOME_PACKET_WRAPPER_CLASS)` — exactly the same two calls the old file-based `resolveCurrentPacket()` made, just fed from `packet.rawHtml` (a DB column) instead of `readFileSync()`'s return value. This is the "most of `welcome-packet.ts`'s logic is still reusable as-is" claim from the Phase 4 ux-developer's own handoff note, now concretely wired up.

## Edit-in-place vs. fresh-row — resolved: edit in place

**Decision: editing an existing `welcomePackets` row — current or not — updates that row via `PATCH`. No fresh-row-plus-republish requirement, no draft/preview distinction from "the live content."**

Reasoning: DECISION-090 already ruled out a `documents`-style version chain for this content family (no diff/compare UI is scoped, no adoption metadata, one row per Lions year as a peer record, not a version history) — introducing "edit creates a new row" here would quietly reintroduce exactly the versioning machinery Phase 2 (Revised) declined to build, for a content family with no ratification step and a trust population of one small, already-vetted admin group (the same population DECISION-090's raw-HTML safety argument already leans on). The supplemental analyst's own Flow C framing offered this as a real option worth naming, not a requirement — and the schema (per Phase 2 Revised, Suggestion 3) supports either answer without modification, so choosing the simpler one costs nothing to reverse later if it becomes a real problem.

**The mitigation for the sharp edge Flow C named** ("a bad save to the currently-live record is live to the whole membership the instant it's saved, with no preview step") **is the hard-fail save-time validation already adopted above, not a versioning workflow.** `extractPacketParts()` must succeed before either `createWelcomePacket()` or `updateWelcomePacket()` writes anything — the one failure mode Flow C worried about most concretely (a malformed save silently degrading to "No Current Packet Published" for the whole club) is exactly what hard-fail validation closes, without needing draft/publish machinery on top of an already-simple, already-narrow feature. A *content* mistake that still parses cleanly (wrong text, a typo) is not something any technical guardrail here is meant to catch — that's what a small trusted admin population editing carefully is for, the same trust boundary DECISION-090 already accepted for the raw-HTML exception itself.

## Admin UI — exact plan

### List view (`/admin/welcome-packets/page.tsx`)

Server Component. `auth()` + `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` → redirect to `/admin` on failure (matches `admin/documents/page.tsx`'s exact gate shape). Calls `listWelcomePackets()` directly (no self-fetch of the API route — same precedent as `admin/documents/page.tsx` calling `listDocumentsForMembers()` directly).

Columns/content per row (`bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1` card, matching the documents list's row style):
- **Lions Year** label (`lionsYear`), as the row's primary text.
- **Current badge** — `bg-lions-blue/10 text-lions-blue` pill reading "Current" when `isCurrent`, nothing rendered otherwise (not a "Draft" badge — there's no draft/published state distinction per the edit-in-place decision above, just "is this the one members currently see").
- **Last updated** (`updatedAt`, formatted like `pending-versions-panel.tsx`'s `formatDate()`).
- **Edit** — the whole row is a `<Link href={/admin/welcome-packets/${id}}>`, same "entire card is the link" idiom `admin/documents/page.tsx` uses.

A **"New Packet"** button/link at the top of the page → `/admin/welcome-packets/new`, styled as the standard primary button (`bg-lions-blue text-white px-6 py-3 rounded-lg font-semibold hover:bg-lions-blue-dark transition`).

Empty state (`listWelcomePackets()` returns `[]`): `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` block, copy: *"No welcome packets exist yet. Create one, or run `scripts/seed-welcome-packet.ts` to import the current packet from the local archive."* — mirroring `admin/documents/page.tsx`'s own empty-state pattern of naming the relevant seed script.

### Create form (`/admin/welcome-packets/new/page.tsx`)

Server Component page (gate identical to the list view) rendering `<WelcomePacketForm mode="create" />`. On submit, `WelcomePacketForm` (client island, `fetch` + `toast`, no `ConfirmDialog` — creating a new, not-yet-current row is not destructive) POSTs to `/api/admin/welcome-packets`; on `201`, `router.push('/admin/welcome-packets/' + id)` so the admin lands on the edit view of what they just created (where "Mark as current" lives) rather than back on the list.

### Edit view (`/admin/welcome-packets/[id]/page.tsx`)

Server Component: gate, then `getWelcomePacketById(id)` → `notFound()` (Next.js) if null. Renders:
1. A header showing the Lions Year label and, if `isCurrent`, the same "Current" badge as the list view.
2. `<WelcomePacketForm mode="edit" packet={...} />` — pre-filled label + raw-HTML textarea, PATCHes `/api/admin/welcome-packets/[id]` on submit, toasts success/error, no redirect on save (stays on the same edit page — matches the "edit in place" decision; there's nothing to navigate to afterward).
3. `<MarkCurrentButton packetId={id} lionsYear={...} isCurrent={isCurrent} />` — rendered but disabled/hidden when already `isCurrent` (nothing to confirm — it's already the one members see).

### `WelcomePacketForm` — the two fields

- **Label field:** `<input type="text">`, e.g. `placeholder="2027-28"`, client-side pattern hint but the real validation is server-side (`isValidLionsYear()`), matching this project's "validate on the server, hint on the client" convention elsewhere (no new client validation library).
- **Raw-HTML textarea:** a plain `<textarea rows={20} className="font-mono text-xs w-full ...">`, matching `minutes-body-editor.tsx`/`document-version-form.tsx`'s plain-`<textarea>` precedent (confirmed by the supplemental analyst) — `font-mono`/small text size specifically because this field routinely holds ~375KB including a long single-line base64 image, and a monospace view makes the anchors (`<title>`, `<style>`, `<div class="deck">`) easier to spot when scrolling. No rich-text editor, no syntax highlighting library — both would be new dependencies for a field almost nobody hand-edits character-by-character (per DECISION-090 point 4's "paste the whole updated file" authoring workflow).
- Submit button: standard primary button, `disabled` while the in-flight `fetch` is pending, matching `pending-versions-panel.tsx`'s `busy` state idiom.
- On a `400` from the API (validation failure), `toast.error(data.error)` surfaces `extractPacketParts()`'s own specific missing-anchor message verbatim — the admin sees exactly which anchor is missing, not a generic "save failed."

### `MarkCurrentButton` — the one `<ConfirmDialog>` island

```tsx
"use client";
// Same shape as PendingVersionsPanel's Adopt flow: a plain button opens
// state, ConfirmDialog gates the actual POST, toast + router.refresh() on
// success.
<ConfirmDialog
  open={confirmOpen}
  onOpenChange={setConfirmOpen}
  title={`Publish the ${lionsYear} packet?`}
  description="This makes it the packet every linked member sees immediately at /members/records/welcome-packet, replacing whatever is current now. It can be undone by marking a different packet current, but there is no separate preview step before this takes effect."
  confirmLabel="Publish"
  destructive
  onConfirm={() => void submitMarkCurrent()}
/>
```

`destructive` per CLAUDE.md's rule ("Use `destructive` prop for irreversible actions" — this isn't strictly irreversible, since another packet can be marked current afterward, but it is immediately club-wide-visible with no undo/preview, the same bar `PendingVersionsPanel`'s Adopt confirmation uses for "Adopt Version," which is reversible in the identical sense — a further version can always be adopted later — and still gets `destructive` styling). `submitMarkCurrent()` POSTs to `/api/admin/welcome-packets/[id]/mark-current`, toasts, `router.refresh()` on success so the edit page's "Current" badge updates without a full reload.

## Member page plan (`src/app/members/records/welcome-packet/page.tsx`)

Exact diff from the current (already-built, file-based) version:

```diff
-import { resolveCurrentPacket, WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packet";
+import { getCurrentWelcomePacket } from "@/lib/welcome-packets-queries";
+import { WELCOME_PACKET_WRAPPER_CLASS } from "@/lib/welcome-packets";
 ...
-  const packet = memberId ? resolveCurrentPacket() : null;
+  const packet = memberId ? await getCurrentWelcomePacket() : null;
```

Everything else — the hero, the "Account Not Linked" block, the "No Current Packet Published" block, the `${WELCOME_PACKET_WRAPPER_CLASS} overflow-x-auto` wrapper, the `<style dangerouslySetInnerHTML>` + `<div className="deck" dangerouslySetInnerHTML>` pair — is **unchanged**, because `WelcomePacketContent`'s shape (`{ title, styleHtml, deckHtml }` plus the new `packetId`/`lionsYear` fields the page doesn't need to read) is a strict superset of what the page already destructures from the old file-based `WelcomePacketContent`. The empty state ("No Current Packet Published") copy needs **no wording change** — "hasn't been published here yet" reads correctly whether the underlying cause is "no marker set" (old) or "the singleton pointer is null" (new); it was never implementation-specific.

## Migration/seed script plan (`scripts/seed-welcome-packet.ts`)

Follows `scripts/seed-governance-document.ts`'s template exactly — same dry-run-default/`--apply` flag, same `PROD_DATABASE_URL || DATABASE_URL || DB_URL` resolution with the loud production banner, same `SCRIPT_OPERATOR_EMAIL`-for-attribution convention (never a hardcoded person, per "No Personal Data in the Repository").

- **Source:** reads the still-present, gitignored, untracked local file `docs/club-documents/welcome-packet-2026-27.html` via `readFileSync(resolve(__dirname, "../docs/club-documents/welcome-packet-2026-27.html"))`. This path is a **hardcoded literal in the script's source** (the filename, not its content) — that's fine to commit: it's a relative path string, not personal data, not a secret, and not the 375KB of real content itself (which stays out of git, exactly as `.gitignore` line 57 requires). The script file itself is ordinary logic; it contains zero real content and is **committed normally**, same as `seed-governance-document.ts` is committed while `docs/club-constitution-and-bylaws.md` is a separate, larger question already resolved elsewhere. (Answering the task's explicit question: no, this script does not need to be gitignored — only the content it *reads* stays out of git, and it already does.)
- **Dry run (default):** reads the file, runs `extractPacketParts()` against it (fails loudly with the specific missing-anchor message if that throws — same hard-fail standard as the admin save path), prints `title`, byte length, anchor-found confirmation, and the Lions-year label it will use (`"2026-27"`, hardcoded to match the source filename — this script is a one-time migration for one specific file, not a generalized importer). No DB write.
- **`--apply`:** wraps in a single `db.transaction()`: calls `createWelcomePacket({ lionsYear: "2026-27", rawHtml: raw, createdByUserId: null })` — `createdByUserId: null` because there is no session, matching `seed-governance-document.ts`'s own `authorUserId: null` precedent for script-run inserts, **not** `SCRIPT_OPERATOR_EMAIL`, since that env var is documented as populating a `recorded_by_user_id`/`created_by`/audit-actor field by resolving to a real `users.id` — this script doesn't currently look up a user by email anywhere in its design. **Revisit note for database-admin/api-developer:** if attribution to a real user id is wanted here (matching `SCRIPT_OPERATOR_EMAIL`'s stated purpose more literally), add a `users` lookup by that env var's email before the insert and pass its `id` as `createdByUserId`; `seed-governance-document.ts` itself doesn't do this (it hardcodes `null`), so following that exact precedent (as this design does) is defensible, but the env var's own CLAUDE.md description suggests the alternative is also reasonable — implementer's call, not a blocking design gap.
- Then calls `markWelcomePacketCurrent(newPacketId, null)` in the same transaction, so a successful `--apply` run always leaves the packet both created and current in one atomic step — never a state where the row exists but isn't published, which would otherwise require a second manual "mark as current" click through the just-built admin UI for what is meant to be a one-shot migration.
- **Success:** prints the new packet's id and "current" confirmation. **Never re-run after `--apply` succeeds** — per the standing project-wide rule (this exact memory note already exists for the Ledger's Quicken seed) — restated in the script's own header comment, matching `seed-governance-document.ts`'s idempotency-guard-is-defense-in-depth-not-primary-defense framing. Unlike the by-laws seed script, this one has **no** `WHERE NOT EXISTS`-style idempotency guard against re-insertion, because `welcomePackets` deliberately has no unique constraint on `lionsYear` (a second run would silently create a *second* "2026-27" row rather than erroring) — the script's own header comment must say this explicitly, in bold, since the by-laws script's guard pattern is not available here and a reader skimming for "does this have the usual re-run protection" needs to be told it doesn't.

## Unit tests to write

### `src/lib/welcome-packets.test.ts` (renamed from `welcome-packet.test.ts`)

**Carries over unchanged** (source-agnostic, still exercise `extractPacketParts()`/`scopePacketStyles()` against string fixtures, no `dir`/filesystem involvement):
- Case 6 (`extractPacketParts` — title/style/deck extraction correctness, including nested divs).
- Case 7 (`scopePacketStyles` — `:root`/`body` rewrite, dark-mode block dropped).
- Case 8 (`.flag` suppression rule present).
- Case 9 (`scopePacketStyles` warns, doesn't throw, on CSS with no `body` selector).

**Dropped** (tested dead code — `resolveCurrentPacket`, `listWelcomePacketFiles`, `findMarkedPacketFiles`, and the whole `mkdtempSync`/`writeFileSync` fixture-file scaffolding that existed only to exercise the file-resolution half): Cases 1-5 in their current form, and the `beforeEach`/`afterEach` temp-dir setup entirely — this file no longer touches `fs` at all once the rename is done.

**New case to add:**
10. **`isValidLionsYear()` format validation** — `isValidLionsYear("2027-28")` → `true`; `isValidLionsYear("2027")`, `isValidLionsYear("27-28")`, `isValidLionsYear("2027-2028")`, `isValidLionsYear("")` → `false`. Small, but this is the one new pure function the rename introduces and it has no coverage yet anywhere else.

### `src/lib/welcome-packets-queries.test.ts` (new)

Test strategy: exercise real DB writes against the test/dev database via the project's existing Drizzle test-DB convention (same pattern `documents-queries.test.ts`/`minutes-queries.test.ts` already use — no mocking `db`), wrapping each test in a way that leaves the `welcome_packet_current` singleton row's pre-existing state intact for other tests (insert-and-clean-up per test, matching the sibling query test files' own setup/teardown shape — implementer should read `documents-queries.test.ts`'s `beforeEach`/`afterEach` for the exact idiom already in use before inventing a new one).

Required cases, per this design doc's Phase 4 gate ("every unit test named in the Phase 3 design doc is written and passing," implementer's own delivery, not qa's):

1. **`createWelcomePacket()` — valid input succeeds.** Given a well-formed `rawHtml` fixture and a valid `lionsYear`, returns `{ ok: true, id }`, and the row is readable back via `getWelcomePacketById(id)` with `isCurrent: false` (nothing marked current yet).
2. **`createWelcomePacket()` — invalid `lionsYear` is rejected without writing.** `lionsYear: "2027"` → `{ ok: false, reason: "invalid_lions_year", message }`; assert no row was inserted (e.g. `listWelcomePackets()` length unchanged before/after).
3. **`createWelcomePacket()` — malformed `rawHtml` (missing an anchor) is rejected without writing.** Same shape as case 2 but `reason: "parse_error"`, and `message` contains the specific missing-anchor text `extractPacketParts()` throws.
4. **`updateWelcomePacket()` — edits an existing row in place; no new row is created.** Create a packet, then `updateWelcomePacket(id, {...new rawHtml...})`; assert `listWelcomePackets()` still has exactly one row with that `lionsYear`/id, and `getWelcomePacketById(id).rawHtml` reflects the new content.
5. **`updateWelcomePacket()` — same validation rejections as create (case 2/3 shape), applied to edit.**
6. **`markWelcomePacketCurrent()` — the transactional correctness case named explicitly in this task.** Create two packets (`A`, `B`). Mark `A` current — assert `getWelcomePacketById(A.id).isCurrent === true` and `getCurrentWelcomePacket()?.packetId === A.id`. Mark `B` current — assert `A.isCurrent` flips to `false`, `B.isCurrent` becomes `true`, and `getCurrentWelcomePacket()?.packetId === B.id`. This is the one-column-can-only-hold-one-value property from Phase 2 (Revised) — confirm it holds through two sequential publishes, not just one.
7. **`markWelcomePacketCurrent()` — unknown id returns `not_found`, and the singleton pointer is unchanged.** Mark some packet `A` current, then call `markWelcomePacketCurrent("<a random uuid that doesn't exist>", null)`; assert the result is `{ ok: false, reason: "not_found" }` **and** `getCurrentWelcomePacket()?.packetId` is still `A`'s id — a failed mark-current must never leave the pointer in an inconsistent or cleared state.
8. **`getCurrentWelcomePacket()` — returns `null` when the singleton's `packetId` is `null`** (the fresh-install / between-Lions-years state — no packet ever marked current).
9. **`getCurrentWelcomePacket()` — returns `null` and logs `console.error` when the current packet's stored `rawHtml` fails to parse.** Mark a packet current whose `rawHtml` is deliberately malformed (bypassing `createWelcomePacket()`'s own validation via a direct test-only insert, to simulate data that became malformed after the fact — e.g. a hand-edited DB row) — mirrors the old file-based case 5's "marked file fails to parse" defensive branch, now applied to a DB row instead of a file.
10. **`listWelcomePackets()` never includes `rawHtml` in its result shape** — a type-level/shape assertion (e.g. `expect(row).not.toHaveProperty("rawHtml")`) guarding the "list view never needs the ~375KB body" design decision against a future accidental `select()` widening.

### API route tests (`src/app/api/admin/welcome-packets/**/*.test.ts`)

Matching the existing `route.test.ts` convention under `api/admin/documents/`/`api/admin/minutes/` (mocking `auth()`/`hasFeature()`, exercising the handler directly):

11. **Every route returns 401 with no session, 403 for a session without `welcome_packet.manage`.** One parameterized-or-repeated case per route (`GET`/`POST /welcome-packets`, `GET`/`PATCH /welcome-packets/[id]`, `POST /welcome-packets/[id]/mark-current`) — this is the exact class of regression `admin-page-feature-gates.test.ts` exists to catch at the page level; the route level needs its own equivalent coverage since that suite only walks `page.tsx` files, not `route.ts` files.
12. **`POST /welcome-packets` with a `parse_error`-triggering body returns 400 with the specific missing-anchor message**, not a generic error.
13. **`POST /welcome-packets/[id]/mark-current` with an id that doesn't exist returns 404.**

## Implementation Order

1. **Schema** — `src/lib/db/schema.ts` (both tables) + `drizzle/migrations/0090_welcome_packets.sql` (tables, singleton seed, permission + admin-only binding). **database-admin.**
2. **Lib rename** — `src/lib/welcome-packet.ts` → `src/lib/welcome-packets.ts` (drop file-resolution functions, add `isValidLionsYear()`), `welcome-packet.test.ts` → `welcome-packets.test.ts` (drop Cases 1-5 + fixture scaffolding, add Case 10). Small and mechanical enough to bundle with step 3 rather than its own handoff. **api-developer.**
3. **`src/lib/welcome-packets-queries.ts` + `welcome-packets-queries.test.ts`** (Unit tests 1-10 above). **api-developer.**
4. **API routes** (5 routes + their `.test.ts` files, Unit tests 11-13 above). **api-developer.**
5. **`ADMIN_NAVIGATION` entry + `FEATURES`/`FEATURE_DESCRIPTIONS`** in `src/lib/permissions.ts`. Small; bundle with step 4 rather than a separate handoff, since api-developer is already touching permission-consuming code at that point. **api-developer.**
6. **Admin UI** — list, new, edit pages; `WelcomePacketForm`, `MarkCurrentButton`. **ux-developer.**
7. **Member page swap** — the four-line diff in `src/app/members/records/welcome-packet/page.tsx`. Small; bundle with step 6 since it's the same "consume `welcome-packets-queries.ts`" work and the same implementer already has full context on `WelcomePacketContent`'s shape from building the admin UI against it. **ux-developer.**
8. **`scripts/seed-welcome-packet.ts`** — reuses `createWelcomePacket()`/`markWelcomePacketCurrent()` directly from step 3's module, so it should be written by whoever built that module (**api-developer**), *after* steps 3-4 are merged (needs the real function signatures, not a guess). Run once against dev to verify, but **do not run `--apply` against production** as part of this pipeline — that's the user's own call, same as `seed-governance-document.ts`'s standing rule, and should happen only after qa/analyst sign off on the shipped feature.
9. Manual verification (qa, Phase 5): sign in as a linked member with no packet marked current (empty state renders, not an error); as `welcome_packet.manage`-holding admin, create a packet with deliberately malformed HTML (missing `.deck`) and confirm the specific error surfaces, not a generic failure; create a valid packet, mark it current, confirm it appears at `/members/records/welcome-packet` on next request (no caching to invalidate — `force-dynamic` is unchanged); mark a second packet current and confirm the first stops appearing; confirm a non-`welcome_packet.manage` admin account gets redirected away from `/admin/welcome-packets` (both the nav-derived proxy gate and the page's own `hasFeature()` check); confirm no visible repaint of app chrome when the member page mounts, same visual check the original Phase 3 already named.
10. Release notes entry (tech-lead, at merge time).

## Edge Cases & Risks

- **`markWelcomePacketCurrent()`'s pre-check-then-update is two statements inside one transaction, not a single atomic UPDATE with a subquery** — deliberate, for the clearer `not_found` error path (Unit test 7); the transaction wrapper is what keeps it race-free against a concurrent mark-current call, not statement count.
- **`scripts/seed-welcome-packet.ts` has no re-run guard** (see Migration/seed script plan) — restated here because it's the one place this design's normal idempotency expectations don't hold, and it must be documented loudly in the script itself, not just this design doc.
- **The base64 emblem inline in every `rawHtml` value means `listWelcomePackets()`'s column selection must explicitly exclude `raw_html`, not just "not display it" in the UI** — a `select()` that pulls the column and merely doesn't render it still pays the transfer cost on every list-page load. Named as an explicit implementation requirement (Unit test 10), not left to "the UI just won't show it."
- **`WELCOME_PACKET_MANAGE`'s route falling to the `ADMIN_DASHBOARD` catch-all if the `ADMIN_NAVIGATION` entry is ever accidentally omitted** — this is exactly the DECISION-082 failure mode `admin-page-feature-gates.test.ts` exists to catch at build time; Unit test set (page-level, not this design's own new tests) already covers it structurally as long as `src/app/(dashboard)/admin/welcome-packets/page.tsx` exists and calls `hasFeature()` + `redirect()`.
- **A hand-edited/corrupted `rawHtml` row bypassing `createWelcomePacket()`'s validation** (e.g. a future direct-SQL fix) is exactly what `getCurrentWelcomePacket()`'s `try/catch` (Unit test 9) exists to degrade gracefully from — same defense-in-depth reasoning the original file-based design already established for a malformed marked file.
- **No delete verb anywhere in this design** — confirmed intentional (DECISION-090, Phase 2 Revised schema comments) — old, non-current packets accumulate in the table indefinitely as an admin-only reference/safety net (Phase 1 Supplemental Gap 2's recommendation), never exposed to members, never purged by this feature.

## Out of Scope

- **Flow E (export the current packet as standalone HTML for the local `scripts/render-welcome-packet.sh` PDF workflow)** — a supplemental-analyst recommendation, not a requirement; not built in this pass. The stored `rawHtml` already contains everything a future export route would need (title/style/deck as one string), so adding it later is a small, self-contained follow-up, not a redesign.
- **Any delete verb** for `welcomePackets` rows — no schema support, no route, no UI. Revisit only if a real need appears (per the schema comment's own framing).
- **A member-facing archive of past years' packets** — unchanged from the original Phase 1's scoping; old rows stay admin-visible-only.
- **Widening `welcome_packet.manage` beyond `admin`** (to `treasurer`, a new `webmaster`-shaped role, or otherwise) — explicitly requires revisiting DECISION-090 first, not a default this design opens the door to.
- **A rich-text editor or HTML sanitizer** — no new dependency of any kind, confirmed buildable entirely within the existing dependency set (Phase 2 Revised §5).
- **`service-record-sheets-2026-27.html` and `membership-packet-your-first-month.html`** — unchanged from every prior phase's scoping; neither is part of this feature.

## Implementer(s)

**The full specialist split: database-admin → api-developer → ux-developer**, per CLAUDE.md's own guidance ("For a large feature with new schema + API + UI, run the specialist split... every increment of The Ledger ran this way cleanly"). This is not a full-stack-developer case despite parts of it being small in isolation — the total surface (two new tables, five new API routes, three new admin pages, two new client islands, a renamed lib pair, a migration script) is well past the "~150 lines across API + UI" full-stack-developer bar, and the layers are cleanly separable with clear handoff points (schema → query functions → routes → UI), exactly the shape the specialist split exists for.

**Order, restated from Implementation Order above:**
1. **database-admin** — schema + migration (step 1). Hand off to api-developer once `0090_welcome_packets.sql` is applied locally and `pnpm exec tsc --noEmit` is clean against the new `schema.ts` exports.
2. **api-developer** — lib rename, `welcome-packets-queries.ts` + its tests, the five API routes + their tests, the `permissions.ts` additions, and `scripts/seed-welcome-packet.ts` (steps 2-5, 8). Hand off to ux-developer once all API-layer unit tests (Unit tests 1-13 above) pass and `pnpm build:only` is clean.
3. **ux-developer** — admin list/new/edit pages, `WelcomePacketForm`, `MarkCurrentButton`, and the member-page four-line swap (steps 6-7). Hands off to qa (Phase 5) once typecheck + `pnpm build:only` pass, no native browser dialogs are used anywhere in the new admin UI, and a local click-through against dev data (including running `scripts/seed-welcome-packet.ts` against dev to get a real packet to look at) confirms the packet actually renders correctly end-to-end.

Each implementer should re-read this design doc's Data Model / API Contract / Component Plan sections in full before starting their step — the exact shapes above (especially `WelcomePacketListItem` excluding `rawHtml`, and `markWelcomePacketCurrent()`'s pre-check-then-update transaction shape) are load-bearing for the next implementer in the chain, not suggestions to reinterpret.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 3 (Revised) section, and the Per-Phase Status table's "4b" row updated to reflect tech-lead-complete / implementers named.
- No new `docs/decisions.md` entry from this pass — DECISION-090 already covers every architectural call this design implements (schema shape, permission naming, the raw-HTML exception, the singleton-pointer mechanism, the lib rename, the admin route). The two calls this pass makes on its own (edit-in-place vs. fresh-row; hard-fail save-time validation) are implementation-level decisions scoped to one feature's save/publish flow, not reusable architectural precedent — recorded in this design doc, consistent with how the original (superseded) Phase 3 handled its own two implementation-level calls (dark-mode stripping, CSS-based `.flag` suppression) without a separate decisions-log entry.

## Open questions / handoff notes

- **First implementer: database-admin**, for schema + migration (Implementation Order step 1). Everything downstream depends on the exact table/column names above being real in `schema.ts` and applied via `0090_welcome_packets.sql` before api-developer can write real Drizzle queries against them.
- **`scripts/seed-welcome-packet.ts`'s `createdByUserId: null` vs. a `SCRIPT_OPERATOR_EMAIL`-resolved user id** is flagged as the implementer's call, not a blocking design gap (see Migration/seed script plan) — either is defensible; api-developer should pick one and note which in the work-log when done.
- **Flow E (export-as-HTML) remains available as a clean follow-up** if the user wants it later — nothing in this design forecloses it, and it wasn't re-asked about in this pass since it was never more than a recommendation.
- **Do not run `scripts/seed-welcome-packet.ts --apply` against production** as part of this implementation pipeline. Run it against dev for qa's click-through; production `--apply` is a separate, explicit user decision after the feature ships, matching `seed-governance-document.ts`'s own standing rule about not being a routine step.

---

# Phase 4 (Revised) — Implementation — 2026-08-21

## Database-admin: schema + migration

**Owner:** database-admin
**Status:** complete

### Summary

Added the two `welcomePackets` / `welcomePacketCurrent` tables to `src/lib/db/schema.ts` exactly as Phase 3 (Revised) specified, wrote the idempotent migration `drizzle/migrations/0090_welcome_packets.sql` (tables + singleton-row seed + `welcome_packet.manage` feature bound to `admin` only), and added the `WELCOME_PACKET_MANAGE` key to the `FEATURES` catalog in `src/lib/permissions.ts`. Verified the `features`/`role_features` column shape against the two real migrations named in the task (`0080_minutes_permissions.sql`, `0082_governance_documents_permissions.sql`) rather than trusting the `/add-permission` skill's generic doc example — both use `features(name, category, description)` and `role_features(role_id, feature_id)`, which is what `0090` uses; there is no `features.key` column in this schema. Applied the migration against the local dev database twice (fresh + re-run) to confirm it is genuinely idempotent, and confirmed by direct query that the singleton row seeded with a null `packetId` and that `welcome_packet.manage` is bound to `admin` only, no other role.

### What I did

- Read the Phase 2 (Revised) and Phase 3 (Revised) sections of this work-log in full, and DECISION-090 in `docs/decisions.md`, for the schema shape and reasoning.
- Ran `ls drizzle/migrations/*.sql | sort | tail -5` at the start of this step (not trusting Phase 3's proposed number) — latest on disk was `0089_ledger_ack_purpose.sql`, confirming `0090` is genuinely the next available number.
- Read `drizzle/migrations/0080_minutes_permissions.sql` and `drizzle/migrations/0082_governance_documents_permissions.sql` in full to confirm the exact `features`/`role_features` column names before writing SQL against them.
- Read `src/lib/db/schema.ts` around the `documentVersions` table (and its imports) to confirm placement and that all needed Drizzle helpers (`pgTable`, `text`, `timestamp`, `uuid`, `index`) were already imported — no import changes needed.
- Read `src/lib/permissions.ts` in full for the `FEATURES` / `FEATURE_DESCRIPTIONS` shape. `FEATURE_DESCRIPTIONS` is typed `Record<FeatureName, string>`, so I added the matching description entry as well as the `FEATURES` key — omitting it would fail `tsc --noEmit`. I did **not** add a `FEATURE_CATEGORIES` entry or an `ADMIN_NAVIGATION` entry — the former isn't required for typecheck and the latter is explicitly api-developer's step (Implementation Order step 5) per Phase 3 (Revised).
- Added both tables to `src/lib/db/schema.ts`, placed immediately after `documentVersions`'s type exports, verbatim per Phase 3 (Revised)'s exact column list and comments.
- Wrote `drizzle/migrations/0090_welcome_packets.sql`.
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Found `DATABASE_URL` present in `.env.local`, so applied the migration locally: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` — `0090_welcome_packets.sql` applied with no errors. Ran it a second time — every statement reported "already exists, skipping" (Postgres `NOTICE`s), confirming idempotency.
- Queried the local DB directly (via the real Drizzle schema objects and raw SQL) to confirm: `welcome_packet_current` has exactly one row, `packetId: null`; `features` has one `welcome_packet.manage` row (`category: 'welcome_packet'`); `role_features` binds it to `admin` only — no other role.
- Attempted `pnpm db:push` to check for schema drift. It hit an unrelated interactive prompt about `ledger_entities_slug_unique` (a pre-existing constraint on the `ledger_entities` table, which this change never touches) and aborted because the shell has no TTY. This is pre-existing drift in the local dev database unrelated to this change — I did not force through it, since resolving unrelated drift is out of this task's scope. Flagging for whoever next runs `db:push` locally.

### Outputs

- `src/lib/db/schema.ts` — added `welcomePackets` (table `welcome_packets`: `id`, `lions_year`, `raw_html`, `created_by_user_id`, `updated_by_user_id`, `created_at`, `updated_at`, index on `lions_year`) and `welcomePacketCurrent` (table `welcome_packet_current`: `id`, `packet_id` → `welcome_packets.id` ON DELETE SET NULL, `set_by_user_id` → `users.id` ON DELETE SET NULL, `set_at`), placed immediately after `documentVersions`. Exported types `WelcomePacket`, `NewWelcomePacket`, `WelcomePacketCurrent`.
- `drizzle/migrations/0090_welcome_packets.sql` — creates both tables (idempotent `CREATE TABLE IF NOT EXISTS`), the `ix_welcome_packets_lions_year` index (`CREATE INDEX IF NOT EXISTS`), seeds the `welcome_packet_current` singleton row (`INSERT ... WHERE NOT EXISTS`), inserts the `welcome_packet.manage` feature (`INSERT ... WHERE NOT EXISTS`) and binds it to `admin` only (`INSERT ... WHERE NOT EXISTS`). Every statement idempotent; applied twice locally with no errors on the second run.
- `src/lib/permissions.ts` — added `FEATURES.WELCOME_PACKET_MANAGE = "welcome_packet.manage"` (matches the migration's `features.name` string exactly) and its `FEATURE_DESCRIPTIONS` entry ("Author and publish the member welcome packet"). No `ADMIN_NAVIGATION` entry added — that's api-developer's step per Phase 3 (Revised)'s Implementation Order.
- Tables affected: `welcome_packets` (new), `welcome_packet_current` (new), `features` (one new row), `role_features` (one new row: `admin` ↔ `welcome_packet.manage`).
- Role binding: `welcome_packet.manage` → `admin` only, via `SELECT r.id, f.id FROM roles r CROSS JOIN features f WHERE r.name = 'admin' AND f.name = 'welcome_packet.manage' AND NOT EXISTS (...)`. No `notetaker` bind, per DECISION-090's explicit instruction that the raw-HTML exception's safety argument depends on this staying admin-only.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` — ran successfully, twice, confirming idempotency against a real database. `pnpm db:push` was attempted but blocked on unrelated pre-existing `ledger_entities_slug_unique` drift (see What I did) — not run to completion, and not something this change caused.
- `pnpm exec tsc --noEmit` — passes clean.

### Open questions / handoff notes

- **Next: api-developer.** Per Phase 3 (Revised)'s Implementation Order steps 2-5: rename `src/lib/welcome-packet.ts` → `src/lib/welcome-packets.ts` (drop file-resolution functions, add `isValidLionsYear()`), write `src/lib/welcome-packets-queries.ts` + its tests (Unit tests 1-10 in the design doc), the five `/api/admin/welcome-packets*` routes + their tests (Unit tests 11-13), and the `ADMIN_NAVIGATION` entry + `FEATURE_CATEGORIES` entry in `src/lib/permissions.ts` (I deliberately left both out — see What I did above).
- New tables now real and queryable: `welcomePackets` / `welcome_packets` (`id`, `lionsYear`/`lions_year`, `rawHtml`/`raw_html`, `createdByUserId`/`created_by_user_id`, `updatedByUserId`/`updated_by_user_id`, `createdAt`/`created_at`, `updatedAt`/`updated_at`) and `welcomePacketCurrent` / `welcome_packet_current` (`id`, `packetId`/`packet_id`, `setByUserId`/`set_by_user_id`, `setAt`/`set_at`) — column names match Phase 3 (Revised)'s Data Model section exactly, confirmed both in `schema.ts` and against the live local DB.
- Foreign keys: `welcome_packets.created_by_user_id` / `updated_by_user_id` → `users.id` (`ON DELETE SET NULL`); `welcome_packet_current.packet_id` → `welcome_packets.id` (`ON DELETE SET NULL`); `welcome_packet_current.set_by_user_id` → `users.id` (`ON DELETE SET NULL`).
- The `welcome_packet_current` singleton row already exists in the local dev DB (seeded by this migration run), with `packetId: null` — `getCurrentWelcomePacket()` can be built and tested against real data immediately; no manual seeding needed before api-developer starts.
- `welcome_packet.manage` is live and bound to `admin` only in the local dev DB — confirmed by direct query, not just by reading the SQL.
- **Pre-existing, unrelated drift found:** `pnpm db:push` prompted about `ledger_entities_slug_unique` on the `ledger_entities` table, which this change does not touch. Not resolved here (out of scope) — noting it so it isn't mistaken for something this migration introduced.

## Api-developer: queries, routes, nav, seed script

**Owner:** api-developer
**Status:** complete

### Summary

Built the DB-facing half of the feature per Phase 3 (Revised)'s exact signatures: renamed `src/lib/welcome-packet.ts` → `src/lib/welcome-packets.ts` (dropped the dead file-resolution functions, kept `extractPacketParts()`/`scopePacketStyles()` verbatim, added `isValidLionsYear()`), wrote `src/lib/welcome-packets-queries.ts` with all six named functions including the transactional `markWelcomePacketCurrent()`, five API routes under `src/app/api/admin/welcome-packets/` mirroring `/api/admin/minutes`'s shape, the `ADMIN_NAVIGATION` + `FEATURE_CATEGORIES` entries in `src/lib/permissions.ts`, and `scripts/seed-welcome-packet.ts`. Every unit test named in the Phase 3 (Revised) design doc (cases 1-13) is written and passing, plus the 6 carried-over/extended `welcome-packets.test.ts` cases. `pnpm exec tsc --noEmit`, the full `pnpm exec vitest run` (1562/1562), and `pnpm build:only` are all clean.

One necessary deviation from the design doc, found and fixed during implementation (see "Open questions / handoff notes" for the full account): `scripts/seed-welcome-packet.ts` does **not** call `createWelcomePacket()`/`markWelcomePacketCurrent()` as originally specified — a real dry-run test proved that path throws `DATABASE_URL or DB_URL environment variable is not set` even with a valid `.env.local`, because those functions go through the app's shared `@/lib/db` singleton, whose module-level connection setup is a tsx import-hoisting hazard for any script that needs to route `PROD_DATABASE_URL` into that slot. The script now builds its own `postgres`/`drizzle` client (exactly like the working `scripts/seed-governance-document.ts` already does, for the same reason) and reimplements the two small writes directly, while still reusing `extractPacketParts()`/`isValidLionsYear()` (DB-free, no hazard) for validation. Confirmed working: a real dry run against the actual local `docs/club-documents/welcome-packet-2026-27.html` (374,277 characters) correctly resolved `TARGET: *** PRODUCTION ***` (this machine's `.env.local` currently has `PROD_DATABASE_URL` active, per the project's documented convention), found all three anchors, and printed the correct preview — no `--apply` run was made.

A second small, necessary deviation: the task instructed me not to touch admin/member page UI, but renaming `welcome-packet.ts` to `welcome-packets.ts` and dropping `resolveCurrentPacket()` entirely (dead code — the DB replaces the file-resolution mechanism) unavoidably breaks `src/app/members/records/welcome-packet/page.tsx`'s existing import, and the Phase 3 (Revised) design doc's own implementer gate requires `pnpm build:only` to be clean before handing off to ux-developer. I applied exactly the four-line diff the design doc itself pre-specified in "Member page plan" (swap `resolveCurrentPacket()`/`@/lib/welcome-packet` for `getCurrentWelcomePacket()`/`@/lib/welcome-packets-queries` + `@/lib/welcome-packets`) and touched nothing else on that page — hero, empty states, and wrapper markup are byte-for-byte unchanged, left for ux-developer.

### What I did

- Read the full work-log (Phase 3 Revised design doc, and database-admin's just-completed Phase 4 schema/migration subsection) before writing any code.
- Read `src/lib/minutes-queries.ts`, the `/api/admin/minutes` route family (`route.ts`, `[id]/route.ts`, `[id]/restore/route.ts`) and their `.test.ts` files, and `src/app/api/admin/documents/[slug]/versions/route.ts` for the real house style — confirmed the actual auth pattern is `hasFeature(session.user.id, FEATURES.X)` from `@/lib/permissions-server` (not the `hasFeature(session.user.features, FEATURES.X)` shape shown in CLAUDE.md's generic top-level example), and followed the real pattern throughout.
- Read `src/lib/admin-page-feature-gates.test.ts` in full and confirmed it is a pages-only static-source check (walks `src/app/(dashboard)/admin/*/page.tsx`) — it does not cover API routes at all, so route-level auth/gate coverage had to come from this task's own route `.test.ts` files (Unit tests 11-13), which I wrote. Adding the `ADMIN_NAVIGATION` entry now, ahead of ux-developer building the actual `/admin/welcome-packets` page, does not trip this test — it only inspects directories that already exist under `src/app/(dashboard)/admin/`.
- Renamed `src/lib/welcome-packet.ts` → `src/lib/welcome-packets.ts`: kept `extractPacketParts()`/`scopePacketStyles()`/`WELCOME_PACKET_WRAPPER_CLASS` verbatim, dropped `WELCOME_PACKET_MARKER`, `listWelcomePacketFiles()`, `findMarkedPacketFiles()`, `resolveCurrentPacket()` (all dead — no filesystem resolution remains), added `isValidLionsYear()`.
- Renamed `src/lib/welcome-packet.test.ts` → `src/lib/welcome-packets.test.ts`: dropped the old cases 1-5 and the `mkdtempSync`/`writeFileSync` fixture scaffolding (tested-now-dead file-resolution code), kept cases 6-9 (`extractPacketParts` correctness, `scopePacketStyles`'s four-selector rewrite + dark-mode-drop + `.flag` suppression + no-`body`-selector warn path), added case 10 (`isValidLionsYear` format validation) and one extra `extractPacketParts` throw-message test.
- Wrote `src/lib/welcome-packets-queries.ts` with the exact six function signatures from the design doc (`listWelcomePackets`, `getWelcomePacketById`, `createWelcomePacket`, `updateWelcomePacket`, `markWelcomePacketCurrent`, `getCurrentWelcomePacket`), the exact `isCurrent: r.id === currentId` idiom from `documents-queries.ts`, hard-fail validation ordering (`isValidLionsYear()` then `extractPacketParts()` try/catch, no DB touch on either failure) on both writes, and `markWelcomePacketCurrent()` wrapped in `db.transaction()` doing the pre-check-then-update sequence the design doc specifies.
- Wrote `src/lib/welcome-packets-queries.test.ts`, hermetic (mocks `@/lib/db` — no `DATABASE_URL`/`DB_URL` needed to run `pnpm test`), following the established FIFO-select-queue + captured-insert/update-calls + `transaction: async (cb) => cb(makeClient())` mock pattern from `src/lib/ledger-category-queries.test.ts` / `src/lib/ledger-acknowledgment-letter-queries.test.ts` (note: the design doc's claim that `documents-queries.test.ts`/`minutes-queries.test.ts` use a real, unmocked test DB is inaccurate — `documents-queries.test.ts` doesn't exist, and `minutes-queries.test.ts` mocks `@/lib/db` too; I followed the real, verified convention instead). All 10 named cases written and passing, including case 6 (the transactional mark-current correctness case, proven structurally across two sequential publishes: mark A current, confirm reads see A; mark B current, confirm A flips to `isCurrent: false` and B becomes `isCurrent: true`) and case 7 (unknown id → `not_found`, zero `UPDATE` calls issued — the strongest available unit-level proof the pointer is never touched on failure).
- Wrote the five API routes under `src/app/api/admin/welcome-packets/` (`route.ts` for GET list/POST create, `[id]/route.ts` for GET detail/PATCH edit-in-place, `[id]/mark-current/route.ts` for the publish action) — every route independently calls `auth()` then `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` before touching the request body, per CLAUDE.md's "the proxy is a coarse outer gate, not the gate" invariant. POST/PATCH surface `createWelcomePacket()`/`updateWelcomePacket()`'s `message` verbatim in the 400 body so the admin sees the specific missing-anchor text, not a generic error.
- Wrote the three route `.test.ts` files, hermetic (mock `@/lib/auth`, `@/lib/permissions-server`, `@/lib/welcome-packets-queries`), covering named cases 11 (401/403 on every route), 12 (a `parse_error` POST body returns 400 with the specific message), and 13 (mark-current on an unknown id returns 404).
- Added `FEATURE_CATEGORIES.WELCOME_PACKET: "welcome_packet"` and the `ADMIN_NAVIGATION` "Welcome Packet" entry (`/admin/welcome-packets`, icon `🧳`, `requiredFeature: FEATURES.WELCOME_PACKET_MANAGE`) to `src/lib/permissions.ts`, placed as the third item in the "Records" group per Phase 2 (Revised)'s placement call. `FEATURES.WELCOME_PACKET_MANAGE` and its `FEATURE_DESCRIPTIONS` entry were already added by database-admin (confirmed present, untouched by me).
- Wrote `scripts/seed-welcome-packet.ts` following `scripts/seed-governance-document.ts`'s template (dry-run default, `--apply` flag, `PROD_DATABASE_URL || DATABASE_URL || DB_URL` resolution with the loud production banner). Discovered and worked around the `@/lib/db` import-hazard described above. The script's header comment states in bold, per Phase 3 (Revised)'s explicit instruction, that this script has **no re-run guard** (`welcomePackets.lionsYear` is not unique) and must never be `--apply`'d twice. Ran it **without** `--apply` against the currently-active target (which happens to be production, per this machine's `.env.local` having `PROD_DATABASE_URL` set right now) — confirmed it correctly reads the real local `docs/club-documents/welcome-packet-2026-27.html` (374,277 characters), finds all three anchors, and prints the correct preview. **Did not run `--apply`**, per the task's explicit instruction — that step is left for the user or a later explicit step.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm exec vitest run` for the new/adapted files (39/39 passing) and the full suite (1562/1562 passing, no regressions), and `pnpm build:only` (clean — all three new routes and `/members/records/welcome-packet` appear correctly in the route listing).

### Outputs

**API contract for ux-developer to consume:**

- `GET /api/admin/welcome-packets` — Gate: `auth()` + `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)`. Response: `200 { packets: WelcomePacketListItem[] }` (no `rawHtml`).
- `POST /api/admin/welcome-packets` — same gate. Body: `{ lionsYear: string; rawHtml: string }`. Responses: `201 { id: string }`; `400 { error: string }` (missing field, or the exact missing-anchor message from `extractPacketParts()`).
- `GET /api/admin/welcome-packets/[id]` — same gate. Responses: `200 { packet: WelcomePacketDetail }` (includes `rawHtml`); `404 { error: "Not found" }`.
- `PATCH /api/admin/welcome-packets/[id]` — same gate. Body: `{ lionsYear: string; rawHtml: string }`. Responses: `200 { ok: true }`; `400 { error: string }`; `404 { error: "Not found" }`.
- `POST /api/admin/welcome-packets/[id]/mark-current` — same gate, no body. Responses: `200 { ok: true }`; `404 { error: "Not found" }`.
- All five: `401 { error: "Unauthorized" }` with no session; `403 { error: "Forbidden" }` without the feature.
- `src/lib/welcome-packets-queries.ts` exports `WelcomePacketListItem`, `WelcomePacketDetail`, `WelcomePacketContent`, `SaveWelcomePacketResult`, `MarkCurrentResult` — ux-developer can import these types directly rather than re-deriving them from the JSON shapes above.

**Files created:**
- `src/lib/welcome-packets.ts` (renamed from `welcome-packet.ts`)
- `src/lib/welcome-packets.test.ts` (renamed from `welcome-packet.test.ts`)
- `src/lib/welcome-packets-queries.ts`
- `src/lib/welcome-packets-queries.test.ts`
- `src/app/api/admin/welcome-packets/route.ts`
- `src/app/api/admin/welcome-packets/route.test.ts`
- `src/app/api/admin/welcome-packets/[id]/route.ts`
- `src/app/api/admin/welcome-packets/[id]/route.test.ts`
- `src/app/api/admin/welcome-packets/[id]/mark-current/route.ts`
- `src/app/api/admin/welcome-packets/[id]/mark-current/route.test.ts`
- `scripts/seed-welcome-packet.ts`

**Files deleted:**
- `src/lib/welcome-packet.ts`, `src/lib/welcome-packet.test.ts` (superseded by the plural rename; neither was ever committed, so this is not a tracked deletion)

**Files modified:**
- `src/lib/permissions.ts` — added `FEATURE_CATEGORIES.WELCOME_PACKET` and the `ADMIN_NAVIGATION` "Welcome Packet" entry (third item in "Records", after "Governing Documents"). `FEATURES.WELCOME_PACKET_MANAGE` and its `FEATURE_DESCRIPTIONS` entry were database-admin's, not touched here.
- `src/app/members/records/welcome-packet/page.tsx` — the exact four-line import/data-source swap the design doc's own "Member page plan" pre-specified (`resolveCurrentPacket()` → `await getCurrentWelcomePacket()`, `@/lib/welcome-packet` → `@/lib/welcome-packets-queries` + `@/lib/welcome-packets`), required to keep the build green after the lib rename. No other change to this file — hero, empty states, and the `.welcome-packet-embed` wrapper markup are unchanged, left for ux-developer.

**Schema changes:** none in this pass — database-admin's migration (`0090_welcome_packets.sql`) already covers the full data model.

**Decisions logged:** none new — this pass implements DECISION-090 (already written by architect in Phase 2 Revised) exactly as specified; no additional architectural decision was made here. The two implementation-level deviations above (seed script's own DB client instead of the query module; the four-line member-page fix) are documented in this work-log entry, not in `docs/decisions.md`, consistent with how Phase 3 (Revised) itself handled its own two implementation-level calls.

### Open questions / handoff notes

- **Next: ux-developer.** Per Phase 3 (Revised)'s Implementation Order steps 6-7: build the admin list/new/edit pages (`src/app/(dashboard)/admin/welcome-packets/page.tsx`, `.../new/page.tsx`, `.../[id]/page.tsx`), `WelcomePacketForm` and `MarkCurrentButton` (the one `<ConfirmDialog>`-wrapped client island — publishing is club-wide-visible with no preview step), and confirm the member page (already updated by me for the import swap only) renders correctly end-to-end. The design doc's exact component plan, admin UI copy, and `MarkCurrentButton`'s `<ConfirmDialog>` copy are all pre-written in Phase 3 (Revised) — nothing there needs re-deriving.
- **The `ADMIN_NAVIGATION` entry already exists** (`/admin/welcome-packets`, gated on `WELCOME_PACKET_MANAGE`) but **no `src/app/(dashboard)/admin/welcome-packets/` directory exists yet** — `src/lib/admin-page-feature-gates.test.ts` will start requiring that page.tsx to call `hasFeature()`/`hasAnyFeature()` and `redirect()` the moment ux-developer creates the directory (it walks the filesystem, not the nav list, so nothing fails until the directory exists). Build the page's own gate from the start — don't rely on the nav-derived proxy rule alone.
- **Two deviations from the design doc, both explained above and both necessary, not judgment calls left open for debate:** (1) `scripts/seed-welcome-packet.ts` uses its own `postgres`/`drizzle` client rather than calling `createWelcomePacket()`/`markWelcomePacketCurrent()` — verified failure mode documented in the script's own header comment. (2) The member page's import was updated as part of this step (not left fully untouched) because the lib rename made the old import a hard compile error — only the exact diff the design doc itself specified was applied.
- **Do not run `scripts/seed-welcome-packet.ts --apply`** — not run in this step, per the task's explicit instruction. This machine's `.env.local` currently has `PROD_DATABASE_URL` active (uncommented), so an `--apply` run today would target production. Whoever runs it should confirm the target deliberately (comment out `PROD_DATABASE_URL` in `.env.local` first for a dev-only test run, if that's the intent) before applying.
- **Test coverage note for the 7-day test-coverage review:** every unit test named in the Phase 3 (Revised) design doc (cases 1-13) is written and passing, delivered by this step as required — none left for qa to author for the first time.

---

## Ux-developer: admin UI, member page, hub card

**Owner:** ux-developer
**Status:** complete

### Summary

Built the admin authoring surface at `/admin/welcome-packets` (list, new, edit) plus its two client islands (`WelcomePacketForm`, `MarkCurrentButton`), following Phase 3 (Revised)'s "Admin UI — exact plan" section and the visual conventions of `/admin/documents` and `/admin/minutes`. Confirmed — did not need to change — the two other items in scope: the member page (`src/app/members/records/welcome-packet/page.tsx`) was already fully correct after api-developer's four-line import swap, and the hub card on `/members/records` was already present from the superseded original Phase 4 round and still points at the right destination. `pnpm exec tsc --noEmit`, the full `pnpm exec vitest run` (1565/1565, up from api-developer's 1562 — the three new cases are `admin-page-feature-gates.test.ts`'s dynamically-generated checks against the new `welcome-packets` directory, not new test files I wrote), and `pnpm build:only` are all clean. Ran a full manual dev-server click-through (16/16 checks passed) covering create, validation rejection, publish, the current-packet flip, and the member-facing render.

### What I did

- Read the full work-log — Phase 3 (Revised)'s exact component plan, admin UI copy, and API contract, plus api-developer's just-completed subsection — before writing any code.
- Read the current state of `src/app/members/records/welcome-packet/page.tsx` (api-developer's four-line diff) and `src/app/members/records/page.tsx` (the hub card) and confirmed both already satisfy Phase 3 (Revised)'s "Member page plan" and Flow 2 respectively — no changes needed to either file.
- Read `src/app/(dashboard)/admin/documents/page.tsx`, `src/app/(dashboard)/admin/minutes/page.tsx`, `.../minutes/new/page.tsx`, `.../minutes/[id]/page.tsx` for the real admin list/create/edit page shape (gate pattern, card styles, empty-state copy, "New X" button placement).
- Read `src/components/admin/documents/pending-versions-panel.tsx` and `src/components/admin/documents/document-version-form.tsx` for the real `"use client"` fetch-and-toast idiom (busy state, `toast.error`/`toast.success`, `router.refresh()`) and the plain-`<textarea>` precedent for raw content fields.
- Read `src/components/ui/confirm-dialog.tsx` to confirm its exact prop shape (`open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `destructive`, `onConfirm`) before wiring `MarkCurrentButton`.
- Read `src/lib/admin-page-feature-gates.test.ts` in full — confirmed it's a filesystem-walk registry test with no manual entries to add; it automatically picked up the new `welcome-packets` directory and asserted its `page.tsx` calls `hasFeature()`/`redirect()`, which it does.
- Read `src/app/api/admin/welcome-packets/**/*.ts` (all five routes, already built by api-developer) to confirm the exact request/response shapes the UI needed to match.
- Built `src/components/admin/welcome-packets/welcome-packet-form.tsx` — the shared create/edit form: a Lions Year text input (`pattern="\d{4}-\d{2}"` client hint, real validation server-side) and a `rows={20}` `font-mono text-xs` textarea for the raw HTML, matching `document-version-form.tsx`'s idiom. POSTs to `/api/admin/welcome-packets` on create (navigates to the new row's edit view on `201`), PATCHes `/api/admin/welcome-packets/[id]` on edit (stays in place, `router.refresh()`). Surfaces the API's `error` message verbatim via `toast.error()` on a `400`.
- Built `src/components/admin/welcome-packets/mark-current-button.tsx` — the one `<ConfirmDialog>` client island. Renders a disabled-style "This is the current packet." indicator when already current (nothing to confirm); otherwise a "Mark as Current" button that opens `<ConfirmDialog destructive>` with the exact title/description text Phase 3 (Revised) specified, POSTs to the mark-current route, toasts, and `router.refresh()`s.
- Built the three admin pages:
  - `src/app/(dashboard)/admin/welcome-packets/page.tsx` — list view. `auth()` + `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` → `redirect("/admin")`. Calls `listWelcomePackets()` directly. Each row is a full-card link (`bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1`) showing Lions Year, "Last updated" date, and a "Current" pill (`bg-lions-blue/10 text-lions-blue`) when applicable. Empty state names `scripts/seed-welcome-packet.ts`, matching `/admin/documents`'s own empty-state pattern.
  - `src/app/(dashboard)/admin/welcome-packets/new/page.tsx` — same gate, renders `<WelcomePacketForm mode="create" />`.
  - `src/app/(dashboard)/admin/welcome-packets/[id]/page.tsx` — same gate, `getWelcomePacketById(id)` → `notFound()` if null, renders the Lions Year heading (+ "Current" badge if applicable), `<MarkCurrentButton>`, then `<WelcomePacketForm mode="edit" packet={...} />`.
- Ran `pnpm exec tsc --noEmit` (clean), the full `pnpm exec vitest run` (83 files, 1565/1565 passing — no regressions, +3 from api-developer's 1562 attributable entirely to `admin-page-feature-gates.test.ts`'s dynamic per-directory generation now including `welcome-packets`), and `pnpm build:only` (clean — `/admin/welcome-packets`, `/admin/welcome-packets/new`, `/admin/welcome-packets/[id]` all appear in the route listing alongside the existing `/members/records/welcome-packet`).
- Grepped the new/modified files for `window.confirm`/`window.alert`/`window.prompt`/`console.log` — none found (the one `window.confirm()` match is inside a doc comment referencing the CLAUDE.md invariant it satisfies, not a call site).
- Started `pnpm dev` against the local dev Neon database (the one already configured in `.env.local` — writes here are dev writes, not production, per this project's standing note that production gates on the Vercel deploy from `main`, not the Neon hostname) and ran a disposable Playwright script (not committed — written to the scratchpad, deleted afterward) signed in as the `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` fixture account used by this repo's existing e2e specs. All 16 checks passed:
  1. Sign in as admin.
  2. `/admin/welcome-packets` loads without being redirected away; shows the "Welcome Packet" heading.
  3. Submitting `/admin/welcome-packets/new` with HTML missing the `<div class="deck">` anchor stays on the page (no navigation) and shows an error toast containing the specific missing-anchor message (`Couldn't save: missing expected anchor(s): <div class="deck">.`) — confirms the hard-fail validation surfaces exactly the message api-developer designed, not a generic failure.
  4. Submitting valid fixture HTML (with `:root`, a `prefers-color-scheme: dark` block, `:root[data-theme]` variants, a bare `body` rule, and a `.flag` element) succeeds and navigates to the new row's edit view.
  5. The edit form is pre-filled with the correct Lions Year; the "Mark as Current" button is present (not yet current).
  6. Clicking "Mark as Current" opens a Radix `<ConfirmDialog>` with the exact title `"Publish the 2099-00 packet?"` — confirmed as a real dialog element, not `window.confirm()`.
  7. After confirming, the edit view immediately shows "This is the current packet."
  8. The hub card at `/members/records` (once the test account's `memberId` was temporarily linked to a real member row for this one check, then reverted — see below) is present and links to `/members/records/welcome-packet`.
  9. The member page renders the `.deck` content.
  10. The `.flag` element from the fixture HTML is present in the DOM but **not visible** — confirms `scopePacketStyles()`'s `.flag { display: none; }` suppression rule is actually wired into the render, not just unit-tested in isolation.
  11. `document.body`'s computed background color is `rgba(0, 0, 0, 0)` (transparent, inherited from the app shell), not the packet's navy — confirms the CSS scoping never leaked `:root`/`body` rules outside `.welcome-packet-embed`, and the surrounding nav/chrome was not repainted.
  12. Publishing a second packet flips the first one's edit view away from "This is the current packet." — confirms the singleton-pointer "one column can only hold one value" property holds through the UI, not just the unit tests.
  13. The member page reflects the change after the second publish.

  **On the account-linking step:** the `E2E_ADMIN_EMAIL` fixture account has no linked `memberId` by default (same as any admin-only account, and correctly triggers the "Account Not Linked" empty state — verified this is pre-existing, unrelated behavior shared by every sibling page, not a defect in this feature). To exercise the hub-card and member-page checks under a real linked-member session, I temporarily set that one test account's `users.memberId` to an existing member row's id via a direct DB update against the **local dev database** (not production — confirmed via `.env.local`'s `DATABASE_URL`), ran the checks, then reverted `memberId` back to `null` immediately afterward. I also deleted the three fixture `welcome_packets` rows (`lionsYear` `2099-00`/`2099-01`) and cleared the `welcome_packet_current` singleton pointer back to `null` once the click-through finished, so the dev database is left in the same "no packet ever marked current" state it was in before this verification pass — no leftover fixture rows, no lingering `memberId` link. All temporary scripts used for this were deleted; none were committed.

### Outputs

**Files created:**
- `src/app/(dashboard)/admin/welcome-packets/page.tsx` — admin list view.
- `src/app/(dashboard)/admin/welcome-packets/new/page.tsx` — admin create view.
- `src/app/(dashboard)/admin/welcome-packets/[id]/page.tsx` — admin edit view.
- `src/components/admin/welcome-packets/welcome-packet-form.tsx` — shared create/edit form (client island).
- `src/components/admin/welcome-packets/mark-current-button.tsx` — the one `<ConfirmDialog>`-wrapped client island (client island).

**Files verified unchanged (already correct from prior steps in this pipeline):**
- `src/app/members/records/welcome-packet/page.tsx` — api-developer's four-line import swap to `getCurrentWelcomePacket()` is complete and correct; the "Account Not Linked" block matches `/members/financial-reports`'s wording pattern exactly (verified by direct comparison), the "No Current Packet Published" empty state is unchanged, and `scopePacketStyles()`'s output is rendered inside the `.welcome-packet-embed` wrapper via `<style dangerouslySetInnerHTML>` scoped to that wrapper — confirmed both by reading the source and by the dev-server click-through (`.flag` suppressed, no `body`/`:root` leak).
- `src/app/members/records/page.tsx` — the "New Member Welcome Packet" card block (added in the superseded original Phase 4 round) is present, styled identically to the Governing Documents card block below it (`bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1`), and links unconditionally to `/members/records/welcome-packet` — confirmed working end-to-end via the click-through.

**No files modified** beyond the Per-Phase Status table row and this section of the work-log — this step was additive only.

**Decisions logged:** none new — this pass implements Phase 3 (Revised)'s already-decided admin UI plan exactly as specified; no additional architectural or UX decision was made here.

### Open questions / handoff notes

- **Next: qa (Phase 5).** Typecheck, full test suite, and `pnpm build:only` are all clean; a full manual click-through (create → validate-rejects-malformed → publish → flip-current → member-render → flag-suppression → no-chrome-leak) has already been run once by this step and passed 16/16, but that was a one-off disposable script, not committed regression coverage — qa should decide whether any of those checks (especially the `.flag`-suppression-is-actually-rendered and the current-pointer-flip-visible-in-the-UI checks) are worth a permanent Playwright spec versus staying covered by the existing unit/route tests plus this manual verification.
- **Copy for the Lions Club to review, if they want to adjust:** the admin list empty-state copy ("No welcome packets exist yet... run `scripts/seed-welcome-packet.ts`..."), the `MarkCurrentButton` confirm-dialog copy (verbatim from Phase 3 (Revised), not altered), and the "Packet HTML" field's helper text explaining the raw-HTML-by-design exception. None of this is new user-facing copy on the member side — the member page's copy was already reviewed in the original (superseded) Phase 4 pass.
- **One UX judgment call, not pre-specified by Phase 3 (Revised):** when a packet is already current, `MarkCurrentButton` renders a small blue info panel ("This is the current packet.") instead of hiding the whole button area — Phase 3 (Revised) said "rendered but disabled/hidden," leaving the exact choice open. I chose "replace with a status indicator" over "render a disabled button" because a disabled `<button>` with no explanation reads as broken, not as "already done" — but this is a legitimate two-way door if the Lions Club prefers a plainer disabled-button treatment instead.
- **No delete verb exists anywhere in this admin UI** (by design, per DECISION-090 / Phase 3 (Revised)'s schema comments) — old, non-current packets accumulate in the list indefinitely, admin-visible-only. Confirmed this matches the design doc; not a gap I introduced.
- **Production seed step still pending, deliberately not run by this step:** `scripts/seed-welcome-packet.ts --apply` has still not been run against production by anyone in this pipeline (api-developer ran only a dry run). Per Phase 3 (Revised)'s explicit instruction, that remains a separate, later decision for the user/treasurer, not something qa or this step should do.

---

# Phase 5 — Verification (qa)

**Owner:** qa
**Status:** complete

## Summary

**Verdict: PASS.** Independent adversarial verification (typecheck, full unit-test suite, production build, and a manual dev-server click-through I drove myself, not a re-read of the implementers' own claims) confirms the feature works as Phase 3 (Revised) designed it and that DECISION-090's safety argument holds in the running code, not just in the design doc. I found one real gap — not a defect, but a coverage blind spot worth naming — in how much protection `admin-page-feature-gates.test.ts` actually provides for this feature's nested admin routes (see finding 2 below); everything else checked out clean. No leftover test data in dev; production has no `welcome_packets`/`welcome_packet_current` tables at all yet (migration not yet deployed there), confirming `scripts/seed-welcome-packet.ts --apply` has never been run anywhere.

## What I did

- Read the full work-log (LOOP-BACK section, Phase 3 (Revised) design doc, all three Phase 4 (Revised) implementer subsections) and DECISION-090 in `docs/decisions.md` before touching any tooling.
- Read `drizzle/migrations/0090_welcome_packets.sql` directly and queried both the local dev DB (`DATABASE_URL`) and production (`PROD_DATABASE_URL`) directly via `psql` — not just re-reading the SQL — to confirm the `welcome_packet.manage` → `admin` binding.
- Read `src/lib/welcome-packets.ts` (`extractPacketParts`, `scopePacketStyles`, `isValidLionsYear`) and `src/lib/welcome-packets-queries.ts` (all six exported functions) in full, plus `src/lib/welcome-packets-queries.test.ts` and `src/lib/welcome-packets.test.ts`, to assess the atomicity claim and the hard-fail validation claim against real code, not the design doc's paraphrase of it.
- Read all three new admin pages (`src/app/(dashboard)/admin/welcome-packets/page.tsx`, `.../new/page.tsx`, `.../[id]/page.tsx`) and all five API routes under `src/app/api/admin/welcome-packets/` directly, confirming each independently calls `auth()` then `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` before doing anything else.
- Read `src/lib/admin-page-feature-gates.test.ts` in full (not just its docstring) to verify ux-developer's "picked up the new directory automatically" claim — see Finding 2.
- Read `src/app/members/records/welcome-packet/page.tsx` and `scripts/seed-welcome-packet.ts` in full.
- Ran `pnpm exec tsc --noEmit`, the full `pnpm test`, and `pnpm build:only` myself, from a clean invocation (not trusting the implementers' reported pass/fail).
- Started `pnpm dev` against the local dev DB, wrote a disposable Playwright spec (`e2e/_qa-welcome-packet-verify.spec.ts`, never committed, deleted after this run) exercising the flow end to end as a real signed-in browser session — sign-in, malformed-HTML rejection, valid create, publish, member-page render with live inspection of the rendered `<style>` tag's selectors and `document.body`'s computed background, a second publish flipping currency, and the two distinct signed-out / unlinked-member edge states — then reverted every DB write the spec made (fixture packets deleted, singleton pointer cleared, the admin fixture account's `memberId` restored to its prior `NULL`) and confirmed the revert with a direct `psql` query afterward, same discipline ux-developer used.
- Ran `pnpm exec vitest run --coverage` scoped to `welcome-packets.test.ts` + `welcome-packets-queries.test.ts` and read the generated HTML coverage report directly for exact statement/branch numbers, then deleted the generated `coverage/` directory (gitignored, not meant to be committed).
- Stopped the dev server and confirmed port 3000 is free.

## Outputs

### Type Check
`pnpm exec tsc --noEmit`: **PASS** — clean, no errors.

### Unit Tests
`pnpm test`: **PASS**
Total: 1565 | Passed: 1565 | Failed: 0
Duration: 1.63s (83 test files)
Failures: none.

### Production Build
`pnpm build:only`: **PASS**
Notes: Exit code 0. All six new routes present in the route manifest: `/admin/welcome-packets`, `/admin/welcome-packets/[id]`, `/admin/welcome-packets/new`, `/api/admin/welcome-packets`, `/api/admin/welcome-packets/[id]`, `/api/admin/welcome-packets/[id]/mark-current`, plus the unchanged `/members/records/welcome-packet`. No new warnings attributable to this feature.

### End-to-End Tests
No permanent Playwright spec exists for this feature yet (ux-developer's own handoff note left that as an open decision for me). I ran a disposable, uncommitted spec covering the full flow (see below) rather than skip e2e verification — all 3 test cases (16 assertions across create/reject/publish/render/flip/edge-states) passed on the first fixed run. **Recommendation, not a blocker for this PASS:** promote a trimmed version of this spec to a permanent `e2e/welcome-packet-admin-and-member.spec.ts` — the `.flag`-suppression-is-actually-rendered and the CSS-non-leak checks in particular are exactly the kind of "looks fine, isn't" regression a future refactor of `scopePacketStyles()` could silently reintroduce, and neither is covered by any permanent automated test today.

### Manual Click-Through (independent, browser-driven — not implementers' self-reports)

| Flow | Result | Notes |
|------|--------|-------|
| Admin loads `/admin/welcome-packets` | pass | Heading renders, no redirect. |
| Create with HTML missing `<div class="deck">` | pass | Stays on the create page, toast shows `Couldn't save: missing expected anchor(s): <style>...` verbatim (my fixture omitted both `<style>` and `.deck`) — confirms the specific message, not a generic failure. |
| Create with valid fixture HTML | pass | Navigates to the new row's edit view. |
| Mark as current via `<ConfirmDialog>` | pass | Confirmed it's a real Radix dialog element (`getByText("Publish the 2099-91 packet?")`), not `window.confirm()`. Edit view flips to "This is the current packet." after confirming. |
| Member page renders the just-published packet | pass | `/members/records/welcome-packet` shows the packet's own `<h1>` content inside the `.welcome-packet-embed` wrapper. |
| `.flag` element present but invisible | pass | `locator(".flag")` has count 1 (in the DOM) and `toBeHidden()` (not visually rendered) — confirms `scopePacketStyles()`'s `.welcome-packet-embed .flag { display: none; }` rule is wired into the actual render, not just unit-tested in isolation. |
| No CSS leak into the app shell | pass | `document.body`'s computed background color did not match the packet's fixture `body { background: red; }` rule. The rendered `<style>` tag's own innerHTML, read directly from the DOM, contains **zero** bare `:root {` or `body {` selectors and **zero** `prefers-color-scheme` (dark-mode block fully stripped, per Phase 3 (Revised)'s decision) — every custom-property/background rule is rewritten under `.welcome-packet-embed`. |
| Publish a second packet | pass | The first packet's edit view immediately stops showing "This is the current packet." and shows the "Mark as Current" button again. |
| Member page reflects the second publish | pass | Shows the second packet's content; the first packet's content is gone on reload — no caching artifact. |
| Signed-out visitor at `/members/records/welcome-packet` | pass | Redirects to `/signin`. |
| Signed-in, unlinked-member account at the same URL | pass | Shows the "Account Not Linked" block — distinct from, and not confused with, the signed-out case. |
| `welcome_packet.manage` bound only to `admin` (dev DB, direct query) | pass | `role_features` join returns exactly one row: `admin`. No `notetaker`, no other role. |
| `welcome_packet.manage` bound only to `admin` (production DB, direct query) | pass (vacuously) | `welcome_packets`/`welcome_packet_current` tables **do not exist yet** in production — migration `0090` has not been deployed there. `role_features` query for `welcome_packet.manage` returns 0 rows. Confirms nothing has leaked to production by any path. |
| `scripts/seed-welcome-packet.ts --apply` never run | pass | Dev DB: 0 rows in `welcome_packets`, singleton `packet_id` is `NULL`. Production: table doesn't exist. Neither shows any sign of the real 2026-27 content having been imported. |

### Regression Tests Added

None added to the permanent suite this pass — see "End-to-End Tests" above for the recommendation to promote the disposable spec. The permanent unit-test coverage (Phase 3 (Revised)'s named cases 1-13, delivered by api-developer, all still passing) already covers the regression-relevant logic (hard-fail validation, transactional pointer flip, list-never-includes-rawHtml) at the unit level; my manual click-through is the layer above that, confirming the same properties hold through real HTTP requests and real DOM rendering, not just through mocked function calls.

### Coverage on Critical Modules
- `src/lib/welcome-packets.ts`: **100%** statements / 100% branches / 100% functions / 100% lines (19/19, 13/13, 4/4, 18/18).
- `src/lib/welcome-packets-queries.ts`: **91.48%** statements (43/47) / 81.25% branches (13/16) / 100% functions (9/9) / 93.02% lines (40/43). Uncovered lines are 153-156 (the defensive "singleton row somehow missing" `console.error` branch in `getCurrentWelcomePacket` — genuinely unreachable in practice, since migration 0090 guarantees the row and nothing in this feature deletes it) and 277 (the equivalent defensive throw in `markWelcomePacketCurrent`). Both are intentional defense-in-depth for a state the schema itself prevents; not a real gap.
- `src/lib/permissions.ts`: not independently re-measured this pass — the full 1565-test suite (which includes this project's existing `permissions.test.ts` completeness checks for `FEATURES`/`ROLES`/`FEATURE_DESCRIPTIONS`) passed clean, and I confirmed by direct `grep` that `WELCOME_PACKET_MANAGE` has both a `FEATURES` entry and a `FEATURE_DESCRIPTIONS` entry (line 201) — a missing description would have failed that existing suite, not just left a gap.

## Specific Checks Requested (numbered per the task)

1. **`welcome_packet.manage` bound only to `admin`.** Confirmed three ways: reading `drizzle/migrations/0090_welcome_packets.sql` directly (the `role_features` insert filters `WHERE r.name = 'admin'`, no other role touched anywhere in the file); querying the dev DB directly (`role_features` join returns exactly one row, `admin`); querying production directly (table doesn't exist yet — migration not deployed there, so there is nothing to leak). **PASS.**
2. **All three admin pages independently gate.** Confirmed by reading all three `page.tsx` files directly — each has its own `auth()` → `redirect("/signin")` and `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` → `redirect("/admin")` before touching any data. **However, ux-developer's claim that `admin-page-feature-gates.test.ts` "picked up the new directory automatically" is only true for the list page.** Reading that test file's `topLevelAdminSegments()` walk shows it enumerates only the top-level directories under `src/app/(dashboard)/admin/` and checks only `join(ADMIN_DIR, segment, "page.tsx")` for each — i.e., it asserts a gate exists on `/admin/welcome-packets/page.tsx` alone. It has **no assertion at all** covering `/admin/welcome-packets/new/page.tsx` or `/admin/welcome-packets/[id]/page.tsx` — nested routes are entirely outside this test's filesystem walk. Both nested pages do, today, have their own correct gates (verified by direct source read and by my live click-through, which could not have reached the create/edit flows otherwise) — there is no live defect — but this is a **coverage gap, not a false claim about today's code**: if a future edit ever strips the gate from `new/page.tsx` or `[id]/page.tsx` specifically, this registry test would not catch it, and nothing else in the automated suite would either. Flagging as a follow-up, not a blocker for this PASS.
3. **CSS scoping actually prevents the leak.** Confirmed live, not by code-reading alone: with a fixture packet published, `/members/records/welcome-packet`'s rendered `<style>` tag (read directly from the DOM) contains no bare `:root {` or `body {` selector and no `prefers-color-scheme` block — the transform generalizes correctly to real content, and `document.body`'s computed background color never picked up the packet's own `background: red` rule. **PASS.**
4. **`.flag` elements are genuinely invisible, not accidentally absent.** My fixture packet's `<div class="deck">` included one `<p class="flag">BOARD ONLY: still need final numbers</p>`. Confirmed via Playwright that the element has DOM count 1 (it survived `extractPacketParts()`/rendering — not stripped from the markup) and is hidden (`toBeHidden()` — the CSS rule is doing the work, not an HTML-surgery step that happened to remove it). Source confirms the rule is `.${wrapperClass} .flag { display: none; }`, scoped under the same wrapper class every other scoped rule uses — it would survive a flag anywhere inside `.deck`. **PASS.**
5. **`markWelcomePacketCurrent()` atomicity.** The production code wraps the existence-check + singleton-update in one real `db.transaction()` — that's the actual atomicity mechanism, and it rests on Postgres's own transactional guarantees, not on anything the unit test does. **The unit test (case 6/7 in `welcome-packets-queries.test.ts`) proves end-state correctness across two sequential, complete calls against a mocked DB — it does not, and structurally cannot, simulate a genuine concurrent or interrupted write** (the mock's `transaction()` just hands the callback a client; there's no interleaving, no lock contention, no partial-write simulation). This is an honest and expected limitation of a hermetic unit test, not a defect in the test — real concurrency proof would require an integration test against live Postgres with two overlapping connections, which is out of scope for a unit suite and wasn't promised. I independently exercised the "two sequential publishes" property live (mark A current, then B) and confirmed the same correct end-state through real HTTP requests and a real Postgres transaction, which is the strongest verification available without a dedicated concurrency-integration test. **Assessment: the code's atomicity claim is sound (rests on Postgres, correctly used); the unit test's atomicity claim should be understood narrowly as "sequential correctness," not "concurrency-proof" — worth a one-line correction in the design doc's own framing if it's ever revisited, not a blocker here.**
6. **Malformed `rawHtml` rejected at save time, both create and update.** Confirmed in code (`createWelcomePacket`/`updateWelcomePacket` both call `extractPacketParts()` in a `try/catch` and return `ok: false` before any DB write), in the unit tests (cases 3 and 5b, both asserting zero insert/update calls on rejection), and live (my click-through's malformed-HTML create attempt surfaced the specific missing-anchor message and never navigated away from the form). I did not separately re-test the PATCH/update path live (only create), since the code path is identical and already covered by the unit tests (case 5b) — noting this as the one specific check in this list I verified live for create only, not update. **PASS.**
7. **Signed-out vs. signed-in-unlinked-member — two distinct states.** Confirmed both live, as two separate assertions: a signed-out browser context redirects to `/signin`; a signed-in session with `memberId: null` renders the "Account Not Linked" block and never reaches `/signin`. **PASS.**
8. **`scripts/seed-welcome-packet.ts` was not run with `--apply`.** Confirmed by direct DB query against both dev and production (see table above) — no `welcome_packets` rows exist anywhere, and the dev singleton pointer is still `NULL`. Production doesn't even have the migration applied yet, which is itself confirmation nothing could have been seeded there. **PASS.**

## Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|--------------------|------------------------------|------------------------------|
| `GET /admin/welcome-packets` (page) | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `GET /admin/welcome-packets/new` (page) | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `GET /admin/welcome-packets/[id]` (page) | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `GET /api/admin/welcome-packets` | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `POST /api/admin/welcome-packets` | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `GET /api/admin/welcome-packets/[id]` | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `PATCH /api/admin/welcome-packets/[id]` | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `POST /api/admin/welcome-packets/[id]/mark-current` | yes | yes | `FEATURES.WELCOME_PACKET_MANAGE` |
| `GET /members/records/welcome-packet` (page) | yes (`auth()` + `memberId` check, no `hasFeature()`) | n/a by design | n/a — matches sibling `records`/`financial-reports` policy of "any linked member, no FEATURES key," confirmed correct precedent in Phase 2/3 |

One key correctly restricts a bulk-content-authoring surface (`WELCOME_PACKET_MANAGE`, admin-only) rather than defaulting to any broader "content editor" role; there is no read-side key to get wrong, since the member-facing read deliberately has none, matching two already-established siblings. No route in this feature returns bulk PII — `rawHtml` is repo/admin-authored content, not member data, and the list endpoint explicitly excludes it from being fetched at all for size reasons, not a privacy reason. All eight gated surfaces read the correct key; the ninth (member page) correctly has none. **No missing or wrong gate found.**

## Verdict: PASS

## Open questions / handoff notes

- **Next: analyst, for Phase 6 (shipped vs. intent).** Everything Phase 1/1-Supplemental asked for is present and independently verified working: the live DB-backed page under Club Records, the admin authoring surface, the explicit publish action, board-flag suppression, and the two distinct empty/edge states. Phase 6 should confirm the shipped feature still matches the *original* Phase 1 intent (the "living document, published to the website" framing) now that the storage mechanism changed shape mid-pipeline — the user-facing behavior is unchanged from what Phase 1 scoped, only the admin-authoring verb (added in the Phase 1 Supplemental pass) is new relative to the very first Phase 1 pass, which explicitly said no admin verb existed. Worth Phase 6 explicitly confirming the user is fine with that scope growth (an admin editor that didn't exist in the original ask) rather than assuming it's implicitly fine because a later phase asked for it.
- **Two follow-ups worth tracking in `docs/backlog.md`, neither blocking this PASS:**
  1. Promote a trimmed version of my disposable e2e spec to a permanent `e2e/welcome-packet-admin-and-member.spec.ts` — the CSS-non-leak and `.flag`-suppression checks are exactly the "looks fine until a refactor breaks it silently" class of regression this project's e2e layer exists to catch, and nothing permanent covers them today.
  2. `admin-page-feature-gates.test.ts` only asserts a gate on each top-level admin segment's own `page.tsx` (e.g. `/admin/welcome-packets/page.tsx`), not on nested routes like `/admin/welcome-packets/new/page.tsx` or `/admin/welcome-packets/[id]/page.tsx`. Both are correctly gated today, verified by hand — but the registry test provides no safety net if that ever regresses. Worth considering whether that test's filesystem walk should be extended to also check every `page.tsx` nested under a gated top-level segment, not just the top-level one — a broader fix than this one feature, so flagging for tech-lead's 30-day agent/instruction review rather than fixing it myself here.
- **Production seed step is still the user's own call, unchanged from api-developer/ux-developer's notes.** `scripts/seed-welcome-packet.ts --apply` has never been run anywhere (confirmed above). This machine's `.env.local` currently has `PROD_DATABASE_URL` active, so whoever runs it next should confirm the target deliberately before applying.
- No test data left behind: the disposable e2e spec's three fixture `welcome_packets` rows were deleted, the `welcome_packet_current` singleton was reset to `NULL`, and the admin fixture account's `memberId` was restored to its prior value — all confirmed by direct `psql` query after cleanup, not just trusted from the spec's own `afterAll`. The disposable spec file itself was deleted and is not part of this commit's diff.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

## Verdict: SHIP WITH NOTES

## One-line take

The shipped feature is a correctly-built, independently-verified, DB-backed authoring-and-publishing system that does exactly what the redesigned (DECISION-090) plan specified — but "published to the website" is not yet true for any member, because the one step that actually puts this year's real content in front of the club (running the seed script, or pasting the content through the new admin UI, against production) was correctly never taken by this pipeline and still requires the user's own action; and the pipeline grew from "add a link" into a small CMS for reasons that were each individually justified but are worth naming plainly as real, lasting scope, not a detour that reverts to something smaller later.

## Re-reading Phase 1 against what shipped

I re-walked both Phase 1 passes (original + supplemental) against the code on disk (spot-checked independently: `src/lib/permissions.ts` lines 114/201/398, `src/lib/db/schema.ts` lines 1796-1852, all three `src/app/(dashboard)/admin/welcome-packets/**/page.tsx` files, `src/app/members/records/welcome-packet/page.tsx`, `drizzle/migrations/0090_welcome_packets.sql`, `.gitignore` line 57) rather than re-trusting qa's report alone, though qa's Phase 5 findings agree with what I found.

**Original Phase 1 — the member-viewing flow.** Every verb, flow, and permission call from the original (file-based) Phase 1 survived the mid-pipeline redesign intact, just re-plumbed onto a database instead of a file:
- Flow 1 (view the current packet) — present, gated `auth()` + linked `memberId`, no `FEATURES` key, exactly as scoped. The two failure states named in Phase 1 ("no file matches" / "signed in but unlinked" / "signed out") map cleanly onto today's three real states (no packet marked current; "Account Not Linked"; redirect to `/signin`) — all three independently verified live by qa, and I re-confirmed the unlinked-vs-signed-out distinction is real by reading the page source above: `if (!session?.user) redirect("/signin")` happens before the `memberId` branch is even reached, so the two states can't be confused with each other in code, not just in testing.
- Flow 2 (discover it from the `/members/records` hub) — present, unconditional link, matches Phase 1's exact card styling ask (`bg-white rounded-2xl shadow-lg hover:shadow-xl transition transform hover:-translate-y-1`).
- Gap 1 (current-packet authority) — resolved by the user (explicit marker) in the file-based design, then **superseded entirely** by the DB redesign's singleton-pointer table, which is a strictly stronger answer to the same question (structurally race-free, not just convention-race-free). Matches, arguably improves on, original intent.
- Gap 2 (board-review flags visible to members) — shipped, verified live by qa (`.flag` present in DOM, `display: none` via the scoped CSS rule, not HTML surgery). Matches.
- Gap 3 (empty/failure state) — shipped with human microcopy ("No Current Packet Published... Check back soon, or ask at a meeting for a printed copy"), not a stack trace. Matches.
- Gap 4 (mobile) — accepted in Phase 1 as "degraded-but-usable," `overflow-x-auto` only. Shipped exactly as specified. **Never actually verified at any viewport width, by any implementer or by qa — see Edge Cases below.** This is a real gap between "the design called for X" and "anyone confirmed X actually behaves acceptably," not a shipped-vs-intent mismatch in the design itself.
- Gap 6 ("add references") — narrowly interpreted as one hub card, confirmed with the user, shipped as scoped. Matches.
- Adversarial pass — no redirect params, no enumeration surface, no self-targeting; all still true of the DB-backed version. The one adversarial finding that mattered (never accept a filename/id from request input) was superseded by "never accept anything but the singleton pointer's own FK" — same principle, new mechanism, still honored (confirmed: no route in this feature takes a client-supplied id for the *reader* path; the *admin* `[id]` routes do take a client-supplied id, but that's a new, expected admin-CRUD surface Phase 1 original never anticipated and Phase 1 Supplemental covered under its own adversarial pass instead — see below).

**Phase 1 Supplemental — the admin-authoring flow.** This is the pass that actually matters for Phase 6, since it's where the feature's real shape was decided:
- Flow A (draft) — shipped as a hard-fail validation (Phase 3 Revised's explicit upgrade over the supplemental's original "at least as strict" ask) — the admin sees the exact missing-anchor message, verified live by qa's click-through. **Matches, and resolves Gap 4 from the supplemental pass more decisively than that pass asked for** (it recommended "consider" hard-fail; Phase 3 made it a hard requirement).
- Flow B (mark current) — shipped through `<ConfirmDialog>` exactly as required, with the singleton-pointer mechanism the supplemental analyst and architect both converged on independently. Matches.
- Flow C (edit in place vs. fresh-row) — tech-lead decided "edit in place," which was one of the two options the supplemental pass explicitly left open, with the sharp edge (a bad save going live instantly) covered by hard-fail validation rather than a draft/preview workflow. This is the single largest interpretive call made after Phase 1 without looping back to ask the user directly — I'm calling it **acceptable drift**, not a defect: the supplemental analyst framed it as a real two-way door ("the schema supports either answer without modification"), tech-lead's reasoning for picking the simpler one is sound and explicitly written down, and the mitigating control (hard-fail validation) is the stronger of the two safety nets the supplemental pass named. But it is a design call a human never explicitly signed off on the way the raw-HTML exception and the DB-vs-file question were signed off on — worth naming, not worth blocking on.
- Flow D (one-time migration) — `scripts/seed-welcome-packet.ts` exists, follows the `seed-governance-document.ts` template, dry-run tested against the real 374,277-character local file, **never run with `--apply`**, exactly as every implementer was explicitly told not to. This is correct pipeline discipline, not an omission — see "Does a member see the real packet today" below for why it still needs to be surfaced loudly.
- Flow E (export-as-HTML for the local PDF script) — explicitly out of scope for this pass, confirmed absent from the shipped code, confirmed named as a clean available follow-up in three separate places in the work-log. Matches — a conscious cut, not a silent one.
- Permissions — `welcome_packet.manage`, bound to `admin` only, confirmed in the migration SQL, confirmed by direct DB query (dev) in qa's Phase 5, confirmed absent-because-table-doesn't-exist-yet in production. Matches the user's explicit answer exactly.
- Gap 1 (raw HTML vs. DECISION-076 Ruling 3) — the user chose the documented-exception path over sanitization; DECISION-090 records it; I read the decision's text against the shipped code above and it accurately describes what's running, with one small inaccuracy (point 6 says the new query module exports a unified `saveWelcomePacket()`; the shipped module actually exports separate `createWelcomePacket()`/`updateWelcomePacket()` functions, per Phase 3 Revised's own, later, more specific API contract, which superseded that detail). This is a decision-log accuracy nit, not a safety-relevant discrepancy — the *substance* DECISION-090 is defending (admin-only gate, no sanitizer, narrow scope) matches the code exactly. Worth a one-line fix, not a blocker.

## What's working

- **The CSS-scoping/`.flag`-suppression mechanism is the single best-verified part of this feature**, and for good reason — it's the one place a subtle regression would be invisible without deliberately looking (an unscoped `:root`/`body` rule silently repainting the whole app shell). qa didn't just re-run the unit tests; it read the actual rendered `<style>` tag's `innerHTML` from a live DOM and confirmed zero bare `:root {`/`body {` selectors and zero `prefers-color-scheme` block survive, and confirmed `document.body`'s *computed* background never picked up the packet's own `background: red` fixture rule. That's the right level of paranoia for a mechanism whose entire job is "prevent an invisible-until-it-happens bug," and it's exactly the kind of check a unit test alone can't provide.
- **The singleton-pointer "mark current" mechanism does what it claims, verified past the point where design intent could hide a coding error.** qa didn't stop at "the transaction wraps two statements" — it independently drove two sequential real publishes through actual HTTP requests against a real Postgres instance and confirmed the first packet's "Current" state flips off the instant the second is published, with no intermediate state where the wrong packet claims current.
- **The hard-fail-at-save-time decision closes exactly the sharp edge Flow C worried about**, and it's wired all the way through: `extractPacketParts()` throws with a specific missing-anchor message → the query functions surface it as a discriminated `ok:false` result → the route surfaces it as a `400` with that exact string → the form surfaces it via `toast.error()` verbatim. qa confirmed the whole chain live, not just at the unit-test layer, which matters because this is precisely the kind of multi-layer plumbing where any one layer swallowing the specific message and falling back to something generic would go unnoticed without an end-to-end check.

## Intent-vs-shipped diff

| # | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| 1 | Publish the packet as a live HTML page under `/members/records`, gated like `minutes`/`financial-reports` | Exactly this, unchanged in URL, gate, or member-facing behavior from the original design | matches |
| 2 | "Current" resolved by an explicit marker the editor flips at rollover | Resolved by a singleton DB pointer flipped via an admin "Mark as Current" action, gated `welcome_packet.manage` | acceptable drift — a strictly stronger mechanism for the same user-facing guarantee, forced by the file-based design being fundamentally unbuildable (see below) |
| 3 | Board-review `.flag` annotations suppressed on the live page | Suppressed via a scoped CSS rule, verified live | matches |
| 4 | Content authored by "whoever has repo access," no in-app editor ("No admin verb exists in this feature") | A full admin authoring UI (create/edit/publish), gated `welcome_packet.manage`, admin-only | **not a match to the original Phase 1 — this is the single largest intent-vs-shipped delta in this feature**, though it is a match to the *supplemental* Phase 1 the user explicitly asked for and approved once the file-based approach turned out to be a dead end. Calling this "acceptable drift" undersells it: it's a genuine, user-approved scope expansion, not drift, and it needs to be named as such rather than folded quietly into "matches." |
| 5 | One-time migration of the real content into whatever replaces the gitignored file | `scripts/seed-welcome-packet.ts` built, dry-run verified against the real file, correctly never `--apply`'d | matches the letter of the design (this step was never supposed to auto-run) — but see below for why this leaves the *user-facing outcome* ("a living document... published to the website") not yet actually true |
| 6 | Mobile: "degraded-but-usable," `overflow-x-auto` only, no reflow redesign | Shipped exactly as specified | matches the *design*; **the behavior itself was never verified at any point in this pipeline** — see Edge Cases |
| 7 | "Add references to it" = one card on `/members/records`, nothing else | One card, unconditional, styled to match Governing Documents | matches |
| 8 | No archive of past years' packets (explicitly out of scope) | No archive UI exists; old rows persist in the DB, admin-visible-only, never member-facing | matches (and is honestly a nicer outcome than the file-based design would have given for free, since old files would have just been deleted/overwritten with no trace) |

## Does a member actually see the real welcome packet today? Walking the end-to-end path.

This is the sharpest question in the brief, and the honest answer is **no, not yet, and "SHIP IT" without saying so would be misleading.**

Right now, on production: the `welcome_packets`/`welcome_packet_current` tables don't exist yet (qa confirmed this by direct query — migration `0090` hasn't been deployed there), so even the empty state can't render correctly until this branch reaches `main` and a deploy runs `pnpm db:migrate`. Once deployed, the migration auto-creates both tables and seeds the singleton row with `packetId: null` — that part is fully automatic, no human action required, exactly like every other migration in this project.

What is **not** automatic, and was correctly never done by any agent in this pipeline: getting this year's real content into the `welcomePackets` table and marking it current. Two paths exist, both requiring a human with the right access to act, deliberately outside this pipeline's scope:

1. **Run `scripts/seed-welcome-packet.ts --apply` against production**, once deployed — reads the still-present local `docs/club-documents/welcome-packet-2026-27.html`, inserts one row, marks it current, in one transaction. This is the fast path and the one the pipeline built specifically for this transition. It requires deliberately confirming the target (per api-developer's own flag: `.env.local` currently has `PROD_DATABASE_URL` active on the machine that did this work, so an unthinking `--apply` run would already point at production — which is *correct* for this one-time step, but worth the user knowing explicitly, not discovering by accident).
2. **Or**, going forward (and for this year, if the seed script's one-shot nature feels too fragile), sign in as an `admin`, go to `/admin/welcome-packets`, paste the same real HTML into "New Packet," and click "Mark as Current" through the `<ConfirmDialog>`.

Until one of these happens, `/members/records/welcome-packet` will show "No Current Packet Published" to every member — which is the *correct, designed* empty state, not a bug, but it means the feature as experienced by an actual club member is currently indistinguishable from "not built yet." Every phase from qa backward has flagged that this step remains outstanding, correctly, but none of them elevated it to the thing it actually is: **the one remaining action between "this pipeline is done" and "the user's original request is fulfilled."** I'm elevating it here, explicitly, as the first follow-up below — not as a code defect, but as the literal last mile of "publish it to the website," which is the verb the user's own request used.

## Is the delivered shape proportionate to "let's add references to it and put it on the website"?

Saying so plainly, as asked: **the total delivered surface is substantially larger than the sentence that started this work — two new tables, five new API routes, three new admin pages, two new client islands, a new permission key, and a numbered exception to a prior architectural ruling, for a request that read as "add a link and render a file."** That is a true statement about the shape of the diff, and it would be dishonest to call it anything smaller.

It is also, on the evidence in this work-log, **the minimum necessary shape once the actual constraint was discovered**, not padding:
- The user's own framing — "a living document that will change from year to year" — already implied *someone* needs a repeatable way to update it. The file-based design satisfied that with "commit a new file," which is a real, if developer-shaped, editing mechanism. The moment that mechanism was ruled out by `.gitignore`/`aa3b539` (a security decision made one commit before this pipeline even started, for good reason — the packet carries real financial figures), *some* replacement editing mechanism became mandatory, not optional, for the feature to remain "living" at all. A DB-backed store with zero authoring surface would not be a living document; it would be a read-only snapshot of whatever got seeded once.
- Every expansion point was put to the user directly and answered explicitly, not assumed: DB-backed storage over "scrub the figures and keep it a file" or "drop the feature" (Phase 4 loop-back); raw-HTML authoring as a documented exception over adding a sanitizer dependency (Phase 1 Supplemental open question 1); `admin`-only binding, not a new role (Phase 1 Supplemental open question 2). None of this was invented by an implementer working alone.
- The two tables are deliberately the smallest shape considered (no version history, no diff view, no soft-delete, no adoption metadata — architect and tech-lead both explicitly ruled out the heavier `documents`-style machinery as unwarranted for this content).

So: **overshoot relative to the literal sentence, proportionate relative to the actual requirement once the blocker surfaced.** Both things are true and the user should hear both, not just the reassuring half. One concrete consequence worth naming for the user, not just for the record: this feature now carries its own slice of the project's ongoing maintenance surface — a permission key that needs to stay admin-only per DECISION-090's own safety argument, an admin CRUD surface that needs to appear in future security reviews, and a raw-HTML-to-`dangerouslySetInnerHTML` path that is now a second instance of a pattern this project had previously kept to exactly one (release notes). That's a reasonable trade for what the user actually needs, but it's a standing cost, not a one-time one, and "add a link" undersold that when the work started.

## Edge cases

| Check | Result | Notes |
|---|---|---|
| Empty state (member page, no packet current) | pass | "No Current Packet Published... Check back soon, or ask at a meeting for a printed copy" — human, not a stack trace. Verified live by qa and confirmed in source. |
| Empty state (admin list, zero packets) | pass | Names `scripts/seed-welcome-packet.ts` directly, matching `/admin/documents`'s own pattern of pointing at the relevant seed script. |
| Failure microcopy (malformed save) | pass | The exact missing-anchor message (`Couldn't save: missing expected anchor(s): <div class="deck">.`) surfaces via `toast.error()`, verified live end-to-end (extraction → query layer → route → form), not just at the unit-test layer. |
| Permission gate (member read) | pass | `auth()` + linked `memberId`, no `FEATURES` key, matches sibling pages exactly; signed-out and signed-in-unlinked verified as two distinct states, both live. |
| Permission gate (admin write) | pass | All three admin pages and all five API routes independently call `auth()` + `hasFeature(..., FEATURES.WELCOME_PACKET_MANAGE)`; confirmed bound to `admin` only in the dev DB by direct query; confirmed the table doesn't exist yet in production (nothing to leak). |
| Permission gate — **automated regression coverage** | **not fully covered** | `admin-page-feature-gates.test.ts` only walks each top-level admin segment's own `page.tsx` (`/admin/welcome-packets/page.tsx`) — it has no assertion at all on `/admin/welcome-packets/new/page.tsx` or `/admin/welcome-packets/[id]/page.tsx`. Both are correctly gated *today*, verified by direct source read and by a live click-through that could not have reached those routes otherwise — this is a coverage gap, not a live defect. See "Blocking?" discussion below. |
| Brand consistency (cards, buttons, ConfirmDialog) | pass | `rounded-2xl` cards throughout (admin list rows, hub card), `rounded-lg` buttons, `<ConfirmDialog destructive>` for "Mark as Current" (verified as a real Radix dialog element in qa's click-through, not `window.confirm()`), `lions-blue`/`lions-gold` accents on the "Current" pill and hero. No violations found in either my reading of the source or qa's grep for native dialogs/`console.log`. |
| CSS containment (no app-shell repaint) | pass | Verified live via DOM inspection — zero bare `:root`/`body` selectors, zero `prefers-color-scheme` block, `document.body`'s computed background unaffected. This is the one mechanism in this feature where "looks right" and "is actually contained" could diverge silently, and it was checked at the right level (rendered DOM, not just source). |
| Mobile (360px) | **not verified** | Phase 1 accepted "degraded-but-usable" as a design call, not an untested assumption — but nobody in this pipeline (ux-developer's 16-check click-through, qa's manual verification) actually resized a viewport to 360px, or any narrow width, and confirmed `overflow-x-auto` produces a usable — not just theoretically-scrollable — experience. The admin `font-mono text-xs` textarea in particular (20 rows, holding up to ~375KB of single-line-heavy content) has never been looked at on a narrow screen at all; Phase 1's mobile scoping only ever discussed the *member-facing* deck, not the *admin* authoring form, which is new surface Phase 1 never anticipated. This is an assumption that was carried through four design/redesign passes without ever being checked, not a confirmed "acceptable, verified degradation." |

## Blocking? — the two real judgment calls

**1. Does the nested-admin-route gate-coverage gap block SHIP IT?** No. There is no live defect — I independently re-confirmed (reading `[id]/page.tsx` and `new/page.tsx` directly) that both call `auth()` and `hasFeature(session.user.id, FEATURES.WELCOME_PACKET_MANAGE)` before touching data, matching every other admin page in this codebase. The gap is that `admin-page-feature-gates.test.ts`'s filesystem walk only checks each top-level admin segment's own `page.tsx`, which predates this feature and is not something this feature introduced. But this feature is the first one where I'd actually worry about it in practice: DECISION-090's entire safety argument for the raw-HTML exception rests on `welcome_packet.manage` staying `admin`-only and the gate staying intact — a future refactor of the edit or create page that accidentally dropped the `hasFeature()` check would ship a raw-HTML-to-`dangerouslySetInnerHTML` authoring surface open to any authenticated member, with nothing in the automated suite catching it before qa's next manual pass caught up to it (if it did). That elevates this from "generic test-infra nit" to "worth a tracked follow-up with real urgency," even though it's correctly not a blocker for *this* PASS, since nothing is broken today. Follow-up below.

**2. Does the seed script never having been `--apply`'d block SHIP IT?** No, and I want to be precise about why: shipping code that correctly displays "not published yet" until a human deliberately publishes real content is not a failure state — it's the exact behavior this design was built to produce on day one, and forcing an agent to run `--apply` against production as part of a pipeline step would violate this project's own standing rule about production data writes being a human's explicit call, not a routine implementation step. The gate here is a documentation-and-handoff gate, not a code gate: the user needs to walk away from this review knowing, in plain terms, that nothing changes for members until they (or an admin) take one more action. That's what "SHIP WITH NOTES" is for.

## Follow-ups (SHIP WITH NOTES)

1. **[Required next step, not optional polish] Get this year's real content live.** Either run `scripts/seed-welcome-packet.ts --apply` against production (confirm the target deliberately first — `PROD_DATABASE_URL` is currently active in the machine's `.env.local`, which is the *right* target for this one-time step, but should be a conscious choice, not a default), or use the new `/admin/welcome-packets` UI to paste the real content and mark it current. Until this happens, the feature is fully built and fully correct but invisible to every member. This is the single item that actually closes the loop on the user's original request.
2. **Verify mobile behavior at a real narrow viewport (≤360px), both surfaces.** Confirm the member-facing deck's `overflow-x-auto` treatment is genuinely usable (not just non-broken) at 360px, and separately check the admin authoring textarea (`rows={20}`, `font-mono text-xs`, holding up to ~375KB) on a narrow screen — Phase 1's mobile scoping only ever considered the member-facing deck, and the admin form is new surface nobody has evaluated at any width. A quick Playwright viewport check or a manual phone check closes this; it doesn't need a redesign unless it turns out to be genuinely broken, not just "degraded."
3. **Extend `admin-page-feature-gates.test.ts` (or add a targeted regression test) to cover nested admin routes**, at minimum `/admin/welcome-packets/new/page.tsx` and `/admin/welcome-packets/[id]/page.tsx`. Both are correctly gated today; this closes the gap where a future refactor could silently drop that gate with nothing catching it, which matters more here than on a typical admin page because DECISION-090's raw-HTML exception is explicitly conditioned on this permission never leaking. qa already recommended routing the general fix to tech-lead's 30-day agent/instruction review since the underlying test's filesystem walk is broader than this one feature; a narrower, feature-specific regression test (even a one-off `it()` asserting both files contain the right `hasFeature`/`redirect` calls) could ship immediately as a smaller, faster mitigation in the meantime.
4. **Promote qa's disposable e2e spec to a permanent `e2e/welcome-packet-admin-and-member.spec.ts`**, per qa's own recommendation — the CSS-non-leak and `.flag`-suppression checks are exactly the "looks fine until a silent refactor breaks it" class of regression this project's e2e layer exists to catch, and nothing permanent covers either one today.
5. **Minor: fix DECISION-090 point 6's description of `welcome-packets-queries.ts`'s exports.** It says the module holds a unified `saveWelcomePacket()`; the shipped module (per Phase 3 Revised's own, later, more specific design) exports separate `createWelcomePacket()`/`updateWelcomePacket()` functions instead. Doesn't affect the decision's substance (admin-only gate, no sanitizer) — a one-line accuracy fix, not urgent.
6. **Confirm with the user, explicitly, that the scope-growth from "add a link" to a small admin-authoring CMS is acceptable as a standing feature**, not just as a means to an end. Every individual expansion point was approved in the moment it came up, but nobody has asked the user, after seeing the whole finished shape at once, "this is now a maintained admin surface with its own permission key and its own documented policy exception — are you good with that as a permanent part of the app, not just as today's fix." Cheap to ask, and the honest thing to do given how much this grew past the original one-sentence request.

## What I did

- Re-read the entirety of my own two Phase 1 passes (original + supplemental) against the shipped code, not against the intervening phases' paraphrases of them.
- Re-read Phase 2/2-Revised, Phase 3/3-Revised, and all three Phase 4 (Revised) implementer subsections in full, plus the LOOP-BACK section, to trace exactly which Phase 1 commitments survived the mid-pipeline redesign unchanged, which were superseded by a stronger mechanism, and which were genuinely new scope introduced only after the blocker was found.
- Re-read qa's full Phase 5 section, including its numbered "Specific Checks Requested" and its Feature-Gate Audit table, and treated its live-verified claims as trustworthy rather than re-running the same checks myself — but independently spot-checked a sample of qa's most load-bearing claims directly against the source: `src/lib/permissions.ts` (FEATURES key, description, nav entry), `src/lib/db/schema.ts` (both tables), all three admin `page.tsx` files' gate calls, `src/app/members/records/welcome-packet/page.tsx`'s full header comment and gate logic, `drizzle/migrations/0090_welcome_packets.sql`, and `.gitignore` line 57 (confirming `docs/club-documents/` is still excluded, so the original file-based design remains permanently non-viable, not just temporarily blocked).
- Read `docs/decisions.md`'s DECISION-090 in full against the shipped `welcome-packets-queries.ts` API to check the decision record's accuracy now that real code exists to check it against — found one small, non-safety-relevant inaccuracy (see Follow-up 5).
- Grepped production and dev DB state indirectly by trusting qa's direct `psql` queries (already independently run, not something I re-executed) rather than re-running the same read-only queries myself, since qa's report included exact row counts and was itself run from a clean, non-implementer-trusting posture.

## Outputs

- `docs/work-log/2026-08-21-welcome-packet-live-page.md` — this Phase 6 section, and the Per-Phase Status table's Phase 6 row (Complete / SHIP WITH NOTES / 2026-08-21).

## Open questions / handoff notes

- **This work-log entry is now closed with SHIP WITH NOTES**, not SHIP IT — per CLAUDE.md's own rule, that means each numbered follow-up above should become its own tracked item (either a `docs/backlog.md` entry or a fresh, small work-log entry when picked up), not left to be rediscovered by re-reading this file later.
- **Follow-up 1 is the one item that actually matters to whether the user's original request is fulfilled** — everything else in this list is quality/robustness polish on an already-correct feature. If the user only acts on one thing after reading this, it should be that one.
- No loop-back is warranted. Nothing found here reflects a functional defect, a missed invariant, or a wrong design call — every item is either a deliberate, correctly-deferred human action, a coverage gap on already-correct code, or a documentation nit. The pipeline's work on this feature is done; the club's is not, yet.

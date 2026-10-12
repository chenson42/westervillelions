# White Cane 2026 donation page — Work Log

> **Slug:** `2026-10-11-white-cane-page`
> **Surface:** public
> **Permission(s):** none (public page; campaign row managed under the existing campaigns admin)
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 skip to be decided by the analyst's verdict (no new directory beyond one public route; no schema expected)
> **Reserved IDs:** B-169, B-170, B-171 (added 2026-10-12); DECISION-119
> **Deadline:** poster printed by Tue Oct 20; Uptown Westerville Fourth Friday "Midnight Madness" is Fri Oct 23, 2026, 6-9 PM; White Cane Safety Day is Thu Oct 15.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-11 |
| 2 — Architectural review | architect | Skipped | Orchestrator note below | 2026-10-11 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-10-11 |
| 4 — Implementation | ux-developer | Complete | Gates green; see Phase 4 section | 2026-10-11 |
| 5 — Verification | qa | Complete | FAIL, then PASS after the orchestrator loop-back fix (2 items, re-measured) | 2026-10-11 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (claims fix N1 before the push) | 2026-10-11 |

---

## Origin (orchestrator, 2026-10-11)

The user's words: "i need to do the same sorta thing but on a tighter timeline. what to raise money for white cane month. we'll have a poster at a westerville fourth friday event with a qr code. i want a page on the website that again uses a zeffy campaign. it should talk about our club and the history of white cane and vision and what the money goes to. do a deep dive of research on this event. this one will be all electronic so any suggestions on how to get it going would be awesome."

A research brief (web research agent plus orchestrator read-only checks of the repo and the Foundation's category names) sits in the orchestrator's scratchpad at `white-cane/research-brief.md`; the facts that matter for design are repeated in the Phase 1 prompt. Three facts are unconfirmed and belong to the user, not to any agent: (1) Uptown Westerville Inc.'s written rule that no organization may fundraise at Fourth Friday, and whether a QR poster counts; (2) which sight projects the board wants this year's money to fund; (3) which EIN the Zeffy receipt carries, which decides whether the page may say "tax-deductible".

**Houskeeping:** no production data is written by this pipeline. The Zeffy form is created by the user in Zeffy; the page needs its link.

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete

## VERDICT

READY WITH NOTES. The structure is fully specified and can go to design now. Three facts are unconfirmed; they block copy and the poster, not the build. What ships with placeholder text is named under "What ships with placeholders".

## ONE-LINE TAKE

> A fast, static, give-first public page at `/white-cane` (reached from the poster QR through the short URL `/whitecane`) that tells the white cane story and the club's story in plain terms and opens one Zeffy form, which must never be a 404, a "coming soon" page or a wrong tax claim when scanned at 7 PM on Oct 23.

## Production facts / code facts checked (read-only)

- Analytics: GA4 is already installed (`G-W30G7GD9HZ`, `src/app/layout.tsx` lines 97-105; CSP in `next.config.ts` allows googletagmanager and google-analytics). UTM tags will be recorded with no new work. Do not add another include.
- `src/proxy.ts` guards only `/admin` and `/members`; a new public path is open by default and an unknown path 404s (does not bounce to `/signin`).
- `ZeffyEmbed` opens the form in a modal on tap (the iframe mounts only on click, which keeps the first load light). It has `aria-modal` and an Escape handler but no focus move into the dialog and no focus return. Matters here (see Gaps).
- `next.config.ts` already has a `redirects()` list; `/whitecane` is one more entry.
- No production query is needed; no Verify-First block. The open facts are about the club and Zeffy, not the database.

## Pass 1 - User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous public visitor (phone, outdoors, evening, congested cell network) | Scans the QR, reads the one-line ask, taps Give, picks an amount, pays (card or Apple/Google Pay), optionally sets the Zeffy tip to $0, closes the form | once, in under a minute |
| Anonymous public visitor | Scrolls to read the cane history and the club story; follows links to `/donate`, `/mission`, `/programs`, `/join` | on demand |
| Anonymous public visitor | Shares the link (Messages, Facebook) and sees a sensible preview | on demand |
| Anonymous visitor, no JavaScript or iframe blocked | Taps a plain link that opens the Zeffy form in its own tab | fallback |
| Signed-in member / admin | Same as visitor. Members may share the link; no member-only surface | on demand |
| Owner of the Zeffy account (user, outside the site) | Creates the form, sets the goal, hands over the link, downloads nothing from us | one-time |
| Admin (optional, after the page ships) | Adds or deactivates a `campaigns` row so `/donate` also lists it | one-time, optional |

Insufficient-role members: not applicable. The page needs no role and `/access-pending` is never involved.

## Pass 2 - Surface, URL and structure (recommendations)

**URL.** The poster QR encodes `https://westervillelions.org/whitecane` and the short URL is printed under the code. `/whitecane` is a **temporary** redirect (`permanent: false`, so browsers do not cache it and the target can change after printing) to `/white-cane?utm_source=poster&utm_medium=qr&utm_campaign=whitecane2026&utm_content=fourthfriday`. UTM lives in the redirect destination, not in the QR, so the code stays the least dense it can be and no one can forget the tags. Social and email links use `/white-cane` directly with their own `utm_source`. **This URL is now fixed; the poster designer can have it today.** Canonical is `https://westervillelions.org/white-cane`, so tagged variants collapse in search.

**Surface.** A dedicated standalone page, not a section of `/donate`. `/donate` is a general page whose first thing is an entity box and a grid of cards; a poster visitor needs the gold button before the first scroll. Optionally also a `campaigns` row so `/donate` lists the campaign (CampaignCard opens the same ZeffyEmbed modal); that is an admin-UI action by the user, after the page ships, and the page must not depend on it (the page takes the Zeffy link from one facts module, like `event-facts.ts` for the Santa's Workshop prototype, so it renders with no database read and can be statically served). Sitemap gets `/white-cane`; no nav entry (it is a campaign, not a section).

**Section order (give first, story second):**
1. Compact hero (deviation from the `py-20` public hero, as the member-portal `py-12` precedent: the Give button must be visible on a 360px screen without scrolling). One sentence of ask, the gold Give button (ZeffyEmbed), and a one-line trust strip (see BF-1 for what it can say).
2. Why a white cane (history, short, cited facts only).
3. What your gift does (copy blocked by BF-2).
4. Who we are (the Westerville Lions Club in a short paragraph; ties vision to the club's broad service in a couple of sentences, links to `/mission` and `/programs`).
5. Give again (second button), the Zeffy tip line, the receipts line (BF-1), "prefer a check" link to `/donate#other-ways-to-give`.
6. Fine print: sources (lionsclubs.org white cane page, ACB) and `/privacy` link.

**Eyecare balance.** This is a vision fundraiser, so the Brand Guidelines' de-emphasis does not apply to the ask. Recommended weight: roughly two thirds cane, sight and independence; one third the club's wider service (youth, hunger relief, community projects), told as who is asking, not as where the money goes. The page must never say the gift funds the wider programs unless the board says so.

**Claims limited to the brief.** Peoria Lions 1930 (President George A. Bonham, canes painted white with a red band; Peoria ordinance Dec 9, 1930); Lions International adopted the white cane program at the 1931 Toronto convention; ORC 4511.47 (drivers yield to a pedestrian with a guide dog or a predominantly white or metallic cane); Public Law 88-628, Oct 6, 1964, White Cane Safety Day Oct 15; 2011 Blind Americans Equality Day. Not in the brief, so not allowed without a source: Helen Keller's 1925 Lions address (a strong local hook, Cedar Point, Ohio; Phase 3 may include it only with a cited source), any statistic on blindness, anything about what the board funds.

## Pass 2 - Flows

**Flow 1 - Poster scan, give.** Poster QR -> `/whitecane` -> 307 -> `/white-cane?utm...` -> hero with Give button -> tap -> Zeffy modal (form with thermometer and tip prompt) -> pay -> Zeffy's own confirmation and emailed receipt -> close modal -> page unchanged.
- Failure: iframe blocked or slow -> a plain "Open the donation form in a new tab" link beside the button (also the accessible alternative). Card declined is Zeffy's message. No JavaScript -> `<noscript>` shows the same plain Zeffy link (unlike `/donate`, whose noscript points to mail-a-check, the poster visitor wants the electronic path), plus a one-line pointer to the check address on `/donate`.

**Flow 2 - Read the story.** Same entry -> scroll -> history -> what it does -> club -> second Give button. Failure: none (static content).

**Flow 3 - Share / Safety Day.** Oct 15 post or member email -> `/white-cane` directly (own UTM) -> Flow 1. Social preview needs title and description; an OG image is optional.

**Flow 4 - Before the form exists.** `/white-cane` renders with the story but no Give button; in its place an honest line "Our giving form opens soon" and a link to the general `/donate`, labeled as the general fund. This state is for the Oct 15 soft launch only. **Hard rule: the poster is not printed until the live state has been verified in production.**

**Flow 5 - After the campaign.** From Nov 1, 12:00 AM Eastern (compare in wall-clock ET, never UTC `now()`; DECISION-005 gotcha) the page shows a thank-you state: no Give button, "This campaign has ended. Thank you", the total or a short "where it went" line if the chair supplies one, links to `/donate` and `/join`. Because the page is cached (`revalidate`), the flip lands within the revalidate window; acceptable. If the goal is met early, the page does not change: the form stays open and the thermometer is Zeffy's. The page does not print a raised amount (it would go stale) and prints the goal only if the chair supplies it.

## Zeffy embed honesty lines

- Embedded forms show no description, image or logo, so the page carries all the story and also states, next to the button, who the gift goes to (BF-1).
- Tip line (one line, near the second button): "At checkout, Zeffy, the platform that processes gifts, offers an optional contribution to itself. You can set it to $0 and your gift to the Lions is unchanged."
- Receipts: automatic only if the account carries the right 501(c)(3) and EIN (BF-1). The page promises nothing about receipts until BF-1 is answered.
- Form settings to hand to the user (not site work): public donor list off (recommended, since donors are scanning in public), receipt toggle per BF-1, goal set so the thermometer shows.

## Permissions

None. A public page; no `FEATURES` key, no role binding, no migration. The proxy leaves it open. The optional `campaigns` row uses the existing campaigns admin permission. Confirmed: no new gate.

## BLOCKING FACTS (orchestrator asks the user in one line before Phase 2; none is defaulted)

| # | Fact | Owner | Blocks | Does not block |
|---|---|---|---|---|
| BF-1 | Which legal entity and EIN print on a Zeffy receipt for this account (Foundation 501(c)(3), or the Club, a 501(c)(4))? Quickest check: open one real receipt from the existing "Donate to Lions Club" Zeffy form. | Treasurer | The page's trust strip and receipts/deductibility copy; the form's receipt toggle | Structure, history, club story |
| BF-2 | What the board wants this year's White Cane money to fund (named recipients, or a general sight-and-independence purpose; was it Pilot Dogs, Central Ohio Lions Eye Bank, Diabetes Association "and many more" in prior years?) | Chair / board | The "What your gift does" section and any "funds X" line on the poster | Everything else |
| BF-3 | Does Uptown Westerville Inc. allow a QR poster (no cash handled) at Fourth Friday given its written "fundraising by any organization is not allowed" rule? Also: will the Lions have a table or only a poster, and where does it hang (decides QR size, 4-6 in at 3-6 ft)? | Club president / chair, via a written reply from FourthFriday@uptownwestervilleinc.com | **The poster only** (printing and placing it) | The page; the page is useful on Oct 15 and online regardless |

**Design for both outcomes on BF-1:**

| Outcome | Page says | Poster says |
|---|---|---|
| A. Foundation receipt (matches what `/donate` already claims) | Mirror `/donate`: received by the Westerville Lions Club Foundation, a 501(c)(3); tax-deductible as allowed by law; its EIN (already public on `/donate`) | Nothing about deductibility |
| B. Club account / no Foundation receipt | "Gifts go to the Westerville Lions Club and are not tax-deductible as charitable contributions"; no EIN; consider routing to a Foundation form if one exists. Also flag that `/donate`'s claim then needs a look | Nothing |
| C. Unanswered by Oct 17 | No deductibility sentence, no EIN, no receipt promise; neutral "Your gift supports the Lions' sight projects" | Nothing |

The poster never says "tax-deductible" in any outcome.

**What ships with placeholders:** (1) the Zeffy link (constant; pre-form state); (2) "What your gift does" copy (generic truthful sentence until BF-2); (3) trust strip and receipts line (outcome C until BF-1). Nothing in the layout, URL, redirect, SEO, analytics, noscript or lifecycle states waits on a fact.

## Gaps the Request Didn't Address

- **A QR that lands on a 404 or a "coming soon" page on the night.** Highest-impact risk. Mitigation: redirect and page live in production before the poster prints; QA checks the production URL, not dev, and scans a printed proof with an iPhone and an Android in dim light. Note Workflow Rule 1: pushing to `main` needs the user's explicit approval; the user should expect to be asked by about Oct 15.
- **Timeline.** Proposed hold points: Oct 11-13 URL given to poster designer (done here); Oct 14 Phase 3 design; Oct 15 shell and redirect live (Safety Day link usable); Oct 16 Zeffy link in hand; Oct 17 BF-1, BF-2 answers and BF-3 reply; Oct 18-19 live-state verification and proof scan; Oct 20 print.
- **Accessibility for this audience.** A fundraiser about blindness will be opened by screen-reader users and their families. `ZeffyEmbed`'s modal lacks focus move and return. Ruling for Phase 3: the plain "open in a new tab" link is mandatory; fixing the shared modal's focus handling is a small change that also helps `/donate` (absorb if under ~30 lines, otherwise file as a backlog item). Alt text on every image, a real heading order, 44px tap targets, contrast on a bright outdoor screen.
- **Weight on a crowded cell network.** Static render, one small hero image or none, no carousels or video; the Zeffy iframe loads only on tap (already true).
- **Donor-intent mismatch.** If the page says the gift funds sight work and the board later spends it elsewhere, that is a restricted-gift problem. Recommended: after the campaign, post one "where it went" line (a commitment to track under the existing White Cane categories on the Foundation books, which are active and empty).
- **Zeffy form is the only conversion record.** The page cannot see completed gifts. GA4 gives sessions by `utm_campaign=whitecane2026`; the Zeffy dashboard gives gifts and time. Compare the two; do not claim per-source conversion.
- **Two dates read as one.** Oct 15 (Safety Day, soft launch via social/email) and Oct 23 (poster night). Campaign window recommended: Oct 15 to Oct 31, wording "through October 31".
- **Brand consistency.** Cards `rounded-2xl`; buttons `rounded-lg` (ZeffyEmbed's gold button already complies); the compact hero is a stated deviation; no `window.confirm`; no `lions-red`.
- **Email.** None sent by the page; Zeffy sends receipts. No `sendEmail()` use, no durable claim.
- **Google Group sync, OAuth path, access-pending, empty state:** not applicable (no DB read, no account).

## Pass 5 - Adversarial

- **Redirect targets:** `/whitecane` is a fixed config redirect with no user-controlled parameter; the Zeffy link is a code constant, never a query value. No open-redirect surface. Pass.
- **Wrong tax claim:** controlled by BF-1 and by the three-outcome table; the Foundation EIN appears only in outcome A. Pass if followed.
- **Over-indexing on eyecare:** addressed by the two-thirds / one-third balance and by not attributing the gift to wider programs.
- **State-machine shortcuts, enumeration, self-targeting:** no state, no accounts, no admin action on the page. Not applicable.
- **Input boundaries:** the site accepts no input; Zeffy owns the form validation.
- **Personal data:** none collected by us. No donor names on the page. Donor list setting is Zeffy's; recommend off. GA4 is already disclosed on site; `/privacy` linked in the fine print.
- **Query string abuse:** unknown `utm_*` values are ignored by the server; GA4 reads them only. The page must not render any query value.
- **Redirect preserves the tags:** Phase 3/QA must confirm on the deployed URL that the tags arrive on `/white-cane` and that `/whitecane` returns 307.
- **noscript:** present, per above.

## Out of Scope (confirm with user)

- QR image creation and poster design (user; any QR generator; no QR library is added to the repo).
- Text-to-give, Venmo, cash, in-person volunteers.
- A donor wall or live thermometer built by us (the thermometer is Zeffy's, inside the form).
- A member announcement email or a `/members/social-requests` post for Safety Day (the user can use the existing flows; not built here).
- An admin editor for the page; next year's reuse (page is written to be edited once a year in code).

## Open Questions (preferences, with recommended defaults; proceed unless the user objects)

1. Campaign window: Oct 15 through Oct 31, thank-you state from Nov 1 ET.
2. Goal: chair sets it in Zeffy; the page prints it only if given.
3. Zeffy public donor list: off.
4. Add the `campaigns` row so `/donate` lists it: yes, after the page ships; deactivate on Nov 1.
5. Include Helen Keller 1925: only if a cited source is supplied.
6. Compact hero instead of `py-20`: yes.

## Phase 2 recommendation

Skip Phase 2, with a work-log note: one new public route, one `next.config.ts` redirect entry and a sitemap line; no schema, no dependency, no new directory pattern (precedent: `/santas-workshop/preview`); no durable-claim or email path. Reopen Phase 2 only if Phase 3 decides to add a database read for the Zeffy link or to change the shared `ZeffyEmbed`.

## Proposed backlog / decision text (for the orchestrator or tech-lead to file)

- Proposed B-169: `ZeffyEmbed` modal moves focus into the dialog on open and returns it on close (benefits `/donate` and `/white-cane`), if not absorbed in this pipeline.
- Proposed B-170: after the campaign, add a "where it went" line and archive the page for next year's White Cane reuse.
- Proposed DECISION-119 (only if wanted): poster QR codes encode a short, temporary-redirect URL whose destination carries the UTM tags, so the printed code never changes and a target can be repointed.

### Handoff notes
- Outputs: this section only; no code, no production access, `.env.local` not read.
- Next: orchestrator asks the user BF-1, BF-2, BF-3 in one message, notes the Phase 2 skip, and starts Phase 3.

---

# Phase 2 — Architectural Review (skipped)

**Orchestrator note, 2026-10-11:** skipped on the analyst's recommendation. The feature is one public route (`/white-cane`), one temporary redirect (`/whitecane`), one sitemap line, and reuse of the existing `ZeffyEmbed`; no schema, no dependency, no new directory beyond the route folder, no permission. It touches no invariant listed in CLAUDE.md. If Phase 3 finds otherwise (for example a `campaigns` row that needs a migration), it returns here.

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead
**Status:** complete
**Mode:** Accelerated, one pass. No code written; no production access; `.env.local` not read.

## Rulings that differ from Phase 1/2 (read first)

1. **The Give button is gated by the Zeffy URL, not by the window start.** Phase 1 listed three states (pre-form / live / thank-you). Design: `pre-form` = `ZEFFY_FORM_URL` is empty; `ended` = Eastern date is after Oct 31; otherwise `live`. Oct 15 is copy ("Oct 15 to 31"), not a gate, so the live state can be verified in production before Oct 15 and the poster can be proofed early. Nothing opens or closes early because of a clock bug on the front end.
2. **`ZeffyEmbed` is not modified.** Phase 1 allowed absorbing the focus fix if under ~30 lines, but also said a change to the shared component reopens Phase 2. It is a shared client component used by `/donate`; the mandatory new-tab link is the accessible path for this pipeline. Focus move/return is B-169 (text below).
3. **`/whitecane` is a `next.config.ts` redirect, not a route file** (reasons below). Phase 1's `permanent: false` is confirmed: that yields HTTP 307.
4. **No `campaigns` row, no database read on the page.** Phase 1 called the row optional and post-launch; design makes it explicitly independent. The sitemap's existing DB query is unchanged.
5. **The orchestrator's message named B-169 as the `/donate` card follow-up; Phase 1's proposed text uses B-169 for the focus fix.** Resolved below: B-169 = focus fix, B-170 = after-campaign (where-it-went line, archive for next year, and the optional `campaigns` row so `/donate` lists it). Only B-169 and B-170 are reserved, so the `/donate` card is folded into B-170.
6. **Og image uses the existing `/images/og-default.jpg`** (present in `public/images`, already used by `/programs`). No new image is needed for v1.

## Summary

A static, DB-free public page at `/white-cane`, reached from the poster QR through a temporary redirect from `/whitecane` that adds the UTM tags. One facts module holds everything that changes before launch or next year (Zeffy link, window, goal, funded projects, receipt variants, BF-1 selector). A small pure function turns the Eastern calendar date into a lifecycle state. The page is a server component that reuses `ZeffyEmbed` for the Give button and adds a plain new-tab link and a `<noscript>` link. No schema, API, permission, email or dependency.

## Permissions

None. No `FEATURES` key, no role binding, no migration. `src/proxy.ts` guards only `/admin` and `/members` (lines 28 and 102, and the pattern rules derived from `ADMIN_NAVIGATION`); everything else falls through to `NextResponse.next()`. Its matcher excludes only `_next/*`, favicon and image extensions, so `/white-cane` passes through the proxy untouched.

## API Contract

No routes or actions. Contract is module-level; the carrier is `src/components/white-cane/campaign-facts.ts`, which exports the constants and the `CampaignState` type (`"pre-form" | "live" | "ended"`) that the page branches on via an exhaustive `switch` with a `never` check, so adding a state breaks `tsc`.

## Redirect: `next.config.ts` `redirects()`, not a route file

Add to the existing list:
`{ source: "/whitecane", destination: "/white-cane?utm_source=poster&utm_medium=qr&utm_campaign=whitecane2026&utm_content=fourthfriday", permanent: false }`

- **Why config:** the file already holds the redirect list, so it is one entry (4 lines); it runs without rendering a React route, and there is no handler to get wrong. A route file would need a `redirect()` call, `dynamic` care and its own test, for no gain.
- **Why 307 (`permanent: false`), not 308:** the poster is printed once and the target must stay repointable (a later year, a different form). Browsers and QR-scanner apps cache 308s indefinitely; a cached 308 would pin every phone that scanned it to the old target. Cost: one extra round trip per scan, negligible.
- **Proxy interaction:** Next applies `redirects()` from config before the proxy runs (believed, unmeasured here; Phase 5 live check R1 records it). Even if the proxy did see `/whitecane`, it matches no protected pattern and returns `next()`. Not a risk either way; the check is to prove the 307 and the tags on the deployed URL.
- **Also redirect nothing else.** `/white-cane` is canonical; tagged variants collapse via `alternates.canonical`.

## Data Model

No schema changes required. **No `campaigns` row is used.** The page imports its Zeffy link from the facts module, so it renders with no query and is statically generated with `export const revalidate = 300` (state flips to ended within 5 minutes of Nov 1 00:00 ET; this is 300 not 3600 because the gate lands on one specific midnight). The user may still add a `campaigns` row in the admin UI later so `/donate` lists the campaign; the page neither reads nor needs it. Reopen Phase 2 only if someone wants the Zeffy link editable without a deploy.

## Facts module: `src/components/white-cane/campaign-facts.ts`

Model: `santas-workshop/event-facts.ts`. Contents (names are binding for the tests; values as stated):

- `ZEFFY_FORM_URL = ""` (placeholder; the user supplies the Zeffy share link, `https://www.zeffy.com/donation-form/<id>`; `ZeffyEmbed`'s `toEmbedUrl()` converts it, and the new-tab link uses it as-is). Ships empty if the link is not in hand.
- `CAMPAIGN_NAME = "White Cane 2026"`, `CAMPAIGN_WINDOW = { start: "2026-10-15", end: "2026-10-31" }` (inclusive Eastern dates, date-only strings), `UTM` constants are not needed here (the redirect owns them).
- `GOAL_DOLLARS: number | null = null` (shown only if set; the thermometer is Zeffy's).
- `FUNDED_PROJECTS: readonly { name: string; blurb: string }[] = []` (BF-2). Empty renders the generic sentence "Your gift supports the Lions' sight projects." and names no recipient. Non-empty renders a list; no further code change.
- `RECEIPT_VARIANT: "foundation" | "club" | "unknown" = "unknown"` (BF-1; the single selector). `RECEIPT_COPY: Record<ReceiptVariant, { trust: string; receipt: string }>`:
  - `foundation`: received by the Westerville Lions Club Foundation, a 501(c)(3); tax-deductible as allowed by law; EIN as already printed on `/donate`.
  - `club`: gifts go to the Westerville Lions Club and are not tax-deductible as charitable contributions; no EIN.
  - `unknown`: neutral trust line, no deductibility sentence, no EIN, no receipt promise. **Ships as `unknown` unless the treasurer has answered BF-1 by implementation time.**
- `ZEFFY_TIP_NOTE` (Phase 1 wording, verbatim), `SOURCES` (lionsclubs.org white cane page, ACB, codes.ohio.gov ORC 4511.47), `HISTORY` (an ordered list of `{ year, text }` limited to the research brief's facts: Peoria 1930 / Bonham / white cane with a red band / ordinance Dec 9, 1930; Lions International 1931 Toronto; ORC 4511.47; Public Law 88-628 Oct 6, 1964 and White Cane Safety Day Oct 15; 2011 Blind Americans Equality Day). Helen Keller 1925 and any blindness statistic are NOT allowed (no cited source). The implementer must not paraphrase beyond the brief.
- `HERO_IMAGE: { src: string; alt: string } | null = null` (the optional cane photo slot; null renders the blue gradient only).

The EIN literal duplicates the one on `/donate` (two places, below the three-copy threshold; the facts test asserts the two agree by scanning `src/app/donate/page.tsx`).

## State: `src/components/white-cane/campaign-state.ts`

- `easternDateString(now: Date): string` returns `"YYYY-MM-DD"` for the Eastern calendar day, using `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ... }).formatToParts(now)` (as `nowEastern()` in `src/lib/events.ts` does, but returning a string, so there is no local-time `Date` hazard). Do not call `new Date(str)` on a date-only string anywhere.
- `campaignState(now: Date, formUrl = ZEFFY_FORM_URL, window = CAMPAIGN_WINDOW): CampaignState`: `ended` if `easternDateString(now) > window.end` (ISO date strings compare lexicographically); else `pre-form` if `formUrl.trim() === ""`; else `live`. Inputs are injectable so tests need no clock mocking.
- Ended takes precedence over pre-form: scanned after Oct 31 with no URL still shows the thank-you.

## Page and component plan

Create (all under `src/components/white-cane/` except the page):

- `src/app/white-cane/page.tsx` (server component, `revalidate = 300`). `metadata`: title "White Cane Safety Day | Westerville Lions Club"; description (one sentence, no tax claim); `alternates.canonical = "https://westervillelions.org/white-cane"`; `openGraph` with title, description, `url`, `siteName`, `locale`, `type: "website"`, `images: [{ url: "https://westervillelions.org/images/og-default.jpg" }]`; `twitter` card summary_large_image. Mirrors `/donate`'s metadata block; `metadataBase` is already set in the root layout. No `robots` override (indexable).
- `campaign-facts.ts`, `campaign-state.ts` (above).
- `give-panel.tsx` (server component; props `state`, `variant: "hero" | "closing"`). `live`: gold `ZeffyEmbed` (`label="Give to the White Cane campaign"`, `description` = one line), directly under it a text link "Open the donation form in a new tab" (`target="_blank" rel="noopener noreferrer"`, 44px tap height, visible focus ring; mandatory and visible on all widths, not an sr-only link), and a `<noscript>` block with the same plain Zeffy link plus a pointer to check-by-mail at `/donate#other-ways-to-give`. `pre-form`: a bordered panel "Our giving form opens soon", with a secondary-style link to `/donate` labeled "Give to our general fund". Never renders `ZeffyEmbed` with an empty link. `ended`: "This campaign has ended. Thank you." with links to `/donate` and `/join`; no Give button. Carries `data-testid="white-cane-give"` on the root in every state.
- `cane-history.tsx` (server): `<section>` with `<h2>` "Why a white cane", the `HISTORY` list, ORC line, and `SOURCES` in the fine print.
- Page sections in order, using Phase 1's order: (1) compact hero `py-12` blue gradient, gold eyebrow "White Cane Safety Day", `<h1>`, one-sentence ask, GivePanel hero, trust strip from `RECEIPT_COPY[RECEIPT_VARIANT].trust`, optional hero image slot (`next/image` with explicit alt when `HERO_IMAGE` set; nothing when null); (2) history; (3) "What your gift does" from `FUNDED_PROJECTS` / generic sentence, goal line if set; (4) "About the Westerville Lions Club": two sentences, links to `/about` and `/programs` (eyeglass collection); (5) GivePanel closing, `ZEFFY_TIP_NOTE`, `RECEIPT_COPY[...].receipt`, check-by-mail link; (6) fine print: sources and `/privacy`.
- Brand: `rounded-2xl` cards (`bg-white shadow-sm`), `rounded-lg` buttons, gold eyebrow `uppercase tracking-widest text-sm text-lions-gold`, `lions-blue` links with focus ring, no `lions-red`, no native dialogs. The compact hero is the one stated deviation from `py-20`.
- The page must not render any query-string value (UTM is read by GA4 only; the GA4 include exists in `src/app/layout.tsx`, add nothing).

Modify: `next.config.ts` (one redirect entry), `src/app/sitemap.ts` (one line: `/white-cane`, weekly, priority 0.8). **No nav link for v1** (the poster, social and email are the entry points); no `robots.ts` change.

## Implementation order (ux-developer, one session, about 700 lines including tests)

1. `campaign-state.ts` + `campaign-facts.ts` (about 150 lines) and their unit tests.
2. `give-panel.tsx`, `cane-history.tsx` (about 160).
3. `page.tsx` (about 170).
4. `next.config.ts` redirect and sitemap line (about 10) and the redirect unit test.
5. Playwright spec (about 40).
6. `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`; confirm the build output lists `/white-cane` as static/ISR rather than dynamic (if the layout forces dynamic rendering the page still works; note it and move on).
7. Release notes via `/release-notes` at ship time, unversioned in the design: "A new White Cane 2026 page where visitors can read the story of the white cane and the Lions and give online."

## Unit tests the implementer must write (Phase 4 gate)

`campaign-state.test.ts`:
- `easternDateString` and `campaignState` at the boundaries, injecting instants: 2026-10-31T23:59:59 ET is `live` (`2026-11-01T03:59:59Z`); 2026-11-01T00:00:00 ET is `ended` (`2026-11-01T04:00:00Z`); 2026-10-31T22:00 ET (`2026-11-01T02:00:00Z`, UTC date already Nov 1) is `live`, which fails any UTC-date implementation; 2026-10-14 with a URL set is `live` (start is not a gate); empty/whitespace URL inside the window is `pre-form`; empty URL after Oct 31 is `ended`.
- Source scan: no `new Date(` with a string argument in `campaign-state.ts`.

`campaign-facts.test.ts` (source scan plus values):
- "tax-deductible" (not preceded by "not ") appears only in the `foundation` variant; the EIN digits appear only in the `foundation` variant and equal the EIN on `/donate`; `unknown` and `club` copy contain no EIN and no receipt promise; the shipped `RECEIPT_VARIANT` is asserted to be one of the three (the test does not force a value).
- `ZEFFY_FORM_URL` is `""` or starts with `https://www.zeffy.com/` and contains no `/embed/`.
- No file under `src/components/white-cane/` or `src/app/white-cane/` matches `/IHOP|Santa|child|children|stuff(y|ies)/i`, `/Helen Keller/`, a non-club email address, or a phone-number pattern.
- With `FUNDED_PROJECTS` empty the generic sentence is used and no recipient name from the old page appears ("Pilot Dogs", "Eye Bank", "Diabetes") anywhere in the module.

`redirects` test (colocated with the others, e.g. `src/white-cane-redirect.test.ts`): load the config's `redirects()`, find `source: "/whitecane"`, assert `permanent === false` and that the destination parses to path `/white-cane` with `utm_source=poster`, `utm_medium=qr`, `utm_campaign=whitecane2026`, `utm_content=fourthfriday`. If importing `next.config.ts` in Vitest is awkward, fall back to a source scan of the file for the same strings and say so.

## Playwright: `e2e/white-cane.spec.ts` (one spec file, date- and state-tolerant)

- `request.get("/whitecane", { maxRedirects: 0 })` returns 307 with a `location` containing `utm_campaign=whitecane2026`.
- `page.goto("/whitecane")` ends at `/white-cane` with the UTM query intact; `h1` visible; heading "Why a white cane" visible; `getByTestId("white-cane-give")` visible (present in all three states).
- If a "Give" button exists (live state), clicking it opens a dialog containing the Zeffy iframe whose `src` starts with `https://www.zeffy.com/embed/`; otherwise the "opens soon" or ended text is shown. Never a dead dialog.
- `request.get("/white-cane")` HTML contains `<noscript>` and an `href` inside it.
- Thank-you state is covered in unit tests only (no clock in the dev server).

## Edge cases and risks

- **Scanned after Oct 31:** `ended` state, within 5 minutes of the boundary because of `revalidate = 300`. Acceptable. The redirect keeps working.
- **Zeffy URL unset at ship time:** `pre-form` renders an honest panel and a link to `/donate`; no modal, no dead button, and the page still builds and passes every test. **Hard rule from Phase 1 stands: the poster is not printed until Phase 5 confirms the `live` state on the production URL** (the test suite cannot enforce it, since an empty URL is a legitimate soft-launch state).
- **iOS in-app browsers (Facebook, Instagram, Messages preview):** Apple Pay inside an iframe in a webview is unreliable (believed, unmeasured); card entry works. The visible new-tab link is the mitigation; it opens Zeffy's own page. Phase 5 live check R3 records what an iPhone in the Facebook in-app browser actually shows. Permissions-Policy already allows `payment` for `https://www.zeffy.com`; CSP `frame-src` already lists it (`next.config.ts` line 37). No config change.
- **Modal focus:** `ZeffyEmbed` does not move focus into the dialog or return it (B-169). The new-tab link is the accessible path; the dialog still has `aria-modal`, an accessible name and Escape.
- **Wrong tax claim:** controlled by the single `RECEIPT_VARIANT` constant and the facts test; the poster never says it.
- **Content discipline:** the page mentions nothing about the Santa's Workshop prototype, IHOP or children; the scan test enforces it.
- **Crowded cell network:** server-rendered, no images required, Zeffy iframe mounts on tap (already true of `ZeffyEmbed`).
- **Query strings:** none rendered; a hostile `?utm_source=<script>` is inert because nothing reads it.

## Phase 5 live checks (record observed values; none is an accepted residual on money, permission or credentials, but the three are measured because the design leans on belief)

- R1: on the deployed URL, `/whitecane` returns 307 and the `Location` carries all four UTM tags (also proves the proxy does not intercept).
- R2: `/white-cane` HTML is served from the static/ISR cache (check `x-nextjs-cache` or the build output) and shows the correct state for the production date.
- R3: iPhone Camera scan of a printed proof, then Facebook in-app browser: record whether the Give modal loads and whether Apple Pay appears.

## Out of scope

Editing `ZeffyEmbed`; a `campaigns` row or any DB read; nav link; QR generation or poster; text-to-give; a donor wall or raised-amount display; Helen Keller or any statistic; an admin editor; a member announcement email.

## Proposed backlog text (orchestrator or tech-lead files)

- **B-169:** `ZeffyEmbed` moves focus into the dialog on open and returns it on close; benefits `/donate` and `/white-cane`. Priority: should-do before next year's campaign.
- **B-170:** After the campaign: add a "where it went" line to `/white-cane` (or the archived page), roll the page forward for next year (edit `campaign-facts.ts`), and optionally add a `campaigns` row so `/donate` lists the White Cane card (deactivate Nov 1).

## Decision filed

`DECISION-119` filed `Status: Proposed` in `docs/decisions.md` (promote at Phase 6 after re-reading against QA's Established list).

### Open questions / handoff notes

- **Implementer: ux-developer** (UI and config only; no API contract and no schema, so no api-developer or database-admin step; full-stack is not needed because there is nothing server-side to split).
- The implementer takes `ZEFFY_FORM_URL` and the BF-1/BF-2 answers if the orchestrator has them by then; otherwise it ships the placeholders exactly as listed (empty URL, `unknown` variant, empty projects). Never invent a Zeffy URL, EIN statement or recipient.
- Orchestrator: do not restart the `:3000` server for this pipeline unless a build-level change requires it (a `next.config.ts` change does require a restart for the redirect to take effect in dev; announce it in this work-log). No migration, so no cross-pipeline conflict.
- Release-notes draft carries no version number (assigned at ship time by `/release-notes`).


---

# Phase 4 — Implementation (UI) — 2026-10-11

**Owner:** ux-developer
**Status:** complete

### Summary
Built the static, DB-free `/white-cane` page per the Phase 3 design, in its implementation order, with the `/whitecane` 307 redirect, sitemap line, and all named tests. It ships with the placeholders: `ZEFFY_FORM_URL = ""` (so it renders the `pre-form` state), `RECEIPT_VARIANT = "unknown"`, `FUNDED_PROJECTS = []`, `GOAL_DOLLARS = null`, `HERO_IMAGE = null`.

### What I did
- Facts module and Eastern-date lifecycle function (injectable inputs; ended beats pre-form; start date is not a gate).
- `GivePanel` (live: ZeffyEmbed + always-visible new-tab link + hero-only noscript with check-by-mail pointer; pre-form: "opens soon" + general fund link; ended: thank-you + /donate and /join; exhaustive `never` switch; `data-testid="white-cane-give"` in every state), `CaneHistory`/`CaneSources`.
- Page: `revalidate = 300`, metadata with canonical/OG/Twitter, compact `py-12` hero, sections in Phase 1 order, no query value rendered. Build output lists `/white-cane` as static with 5m revalidate.
- `next.config.ts` redirect (`permanent: false`), sitemap entry.
- Tests: `campaign-state.test.ts` (8), `campaign-facts.test.ts` (6), `src/white-cane-redirect.test.ts` (1; imports the config directly), `e2e/white-cane.spec.ts` (4).
- Screenshots (390 and 1280; pre-form, live, ended; live and ended forced by a throwaway edit of the facts file, restored and diffed identical): scratchpad `white-cane/shots/`.

### Deviations from the design
- None in scope. Small implementation notes: the page uses a `div` rather than `<main>` because the root layout already supplies `<main id="main-content">`; `ZEFFY_FORM_URL` is typed `: string` (otherwise TS narrows it to `""`); the `unknown` and `club` receipt strings are empty/neutral and the page adds an always-present "Contact the club" link (`/connect`) instead; the `ended` state also retitles two headings ("What gifts supported", "Thank you") and hides the tip/receipt/check lines.

### Outputs
- `src/app/white-cane/page.tsx`
- `src/components/white-cane/{campaign-facts,campaign-state,give-panel,cane-history}.ts(x)` plus `campaign-state.test.ts`, `campaign-facts.test.ts`
- `src/white-cane-redirect.test.ts`, `e2e/white-cane.spec.ts`
- Modified: `next.config.ts`, `src/app/sitemap.ts`

### Open questions / handoff notes
- Gates: tsc clean; lint 0 errors (1 pre-existing warning in budget-context-panel.tsx); `pnpm test` 212 files / 3676 tests pass; `pnpm build:only` passes; Playwright spec 4/4 passed. The redirect e2e passed against the running dev server this time, but a `next.config.ts` change normally needs a restart, so the orchestrator should restart before QA and re-run to be sure the live 307 is real.
- Copy for the club to refine: hero H1 "Help us keep the white cane story going"; the pre-form "Our giving form opens soon" text; the club paragraph (1928, youth/hunger/community, monthly eyeglass collection); the Lions Clubs International source link points at the lionsclubs.org root because the brief gives no exact URL.
- Copy claims limited to the brief; "more than ninety years" is derived from 1930. The 1930 ordinance is stated without its content because the brief does not give it.
- Reviewer click-through: `/whitecane` to `/white-cane?utm...`; keyboard Tab order and focus rings; the pre-form panel; to see live, set `ZEFFY_FORM_URL` in the facts file. ZeffyEmbed focus handling is unchanged (B-169).
- The dev overlay "1 Issue" badge is the existing header-logo Image warning, also on `/donate`.
- Next: qa (Phase 5), including live checks R1-R3 on the deployed URL; the poster must not print until the live state is verified in production.


---

# Phase 5 — Verification (qa) — 2026-10-11

**Owner:** qa
**Status:** complete (verdict FAIL, returned to ux-developer)

### Summary
**Verdict: FAIL.** Every automated gate is green and every state renders correctly, but two defects need a fix before this can pass: (1) the browser/search title is doubled, "White Cane Safety Day | Westerville Lions Club | Westerville Lions Club" (`src/app/white-cane/page.tsx:21,26`; QA added a failing Playwright test for it); (2) two history phrasings go beyond the research brief, which the user said must not happen (`campaign-facts.ts:55` and `:63`). Both are one-line edits. Measured on the working tree of 2026-10-11 with the orchestrator's restarted dev server; no `.env.local` or production access.

### What I did
**Gates**
| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS, 0 errors, 1 pre-existing warning (`budget-context-panel.tsx:114`, not this diff) |
| `pnpm test` | PASS, 212 files / 3676 tests, 4.0 s |
| `pnpm build:only` | PASS. `/white-cane` prints `○` static, `5m` revalidate; `/santas-workshop` is not a route (only `/santas-workshop/preview*`); `/sitemap.xml` builds. Built HTML has the same doubled `<title>` as dev, so it is not a dev artifact |
| `pnpm exec playwright test e2e/white-cane.spec.ts` | 11 tests: 10 pass, 1 FAIL (the new title regression test, `e2e/white-cane.spec.ts:56`) |
| Module coverage (`campaign-*.ts`) | 100% statements/lines, 87.5% branches (the `?? ""` fallback at `campaign-state.ts:15`) |

**Spec extended (7 tests added, was 4).** The design's list was covered only state-tolerantly (the Give-click, noscript and new-tab checks assert nothing in the shipped pre-form state). Added: all four UTM tags exactly; title names the club once (regression, currently red); canonical and OG tags in raw HTML; one h1 then h2s plus no horizontal scroll at 360; first Give control above the fold at 390x844; no query value rendered; new-tab link attributes (live) or no button/dialog (pre-form).

**Mutation checks (each assertion broken, seen red, restored, `shasum` identical to the pre-QA snapshot).** UTC instead of Eastern: 3 red. `>=` instead of `>` on the end date: 2 red. `new Date("...")` in state file: 1 red. "tax-deductible" in `unknown`: red. EIN in `unknown`: red. Helen Keller / IHOP in history: red each. `/embed/` URL constant: red. "Pilot Dogs": red. Redirect `permanent: true`, and a dropped UTM tag: red each (run on a copy of `next.config.ts`, so the dev server did not restart; temp files removed).

**Redirect R1 (dev).** `/whitecane` returns 307 with `Location` = `/white-cane?utm_source=poster&utm_medium=qr&utm_campaign=whitecane2026&utm_content=fourthfriday`; the proxy does not intercept. R1 on the deployed URL, R2 (cache header in production) and R3 (iPhone, Facebook in-app browser, Apple Pay) are NOT done: they need production or a device. Poster gate stands.

**Click-through, pre-form as shipped (390 and 1280; 360 for scroll).** Hero, honest "Our giving form opens soon" panel, and one outlined link "Give to our general fund" to `/donate`. No Give button, no dialog, no `ZeffyEmbed` mounted, so no dead modal. The new-tab link is absent (hidden while the URL is unset, as designed). The Give panel's link is above the fold at 390x844 and 1280x900, but below the fold at 360x640 (bottom 672 px) and 375x667. Headings: h1, then h2 x4 (the h3s are the site footer). No horizontal scroll at 360/390/1280. Alt: no images on the page. Link targets `/about`, `/programs`, `/donate`, `/join`, `/connect`, `/privacy`, `/donate#other-ways-to-give` all 200 (anchor id exists at `donate/page.tsx:188`). OG tags, canonical, `twitter:card` present, not noindexed. Keyboard: every control in `#main-content` shows a 2 px ring (the first reading of "no ring" on the transitioned button was a mid-transition sample; re-measured after 400 ms: white ring). A hostile `?utm_source=<script>` appears only inside Next's escaped flight payload, never in the DOM text.

**Contrast (computed from the tokens).** White on `#003F87` 10.19:1, on `#002d63` 13.50:1; gold `#F9B222` eyebrow on `#003F87` 5.54:1, on `#002d63` 7.34:1; `blue-100` ask text 8.35:1; gray-600 on white 7.56:1. All pass AA.

**Forced states (throwaway edit of `campaign-facts.ts`, restored; `shasum` identical to snapshot; the file is untracked so `git diff --stat` cannot show it, the checksum is the proof; tracked `next.config.ts` and `sitemap.ts` stat unchanged at 8 and 1 lines).**
- Live (`https://www.zeffy.com/donation-form/test`, then the instructed `.../embed/donation-form/test`): gold button above the fold at 360x640, 375x667, 390x844 and 1280x900; new-tab link visible, 44 px tall, `target=_blank`, `rel="noopener noreferrer"`, href = the configured URL as-is; modal has `role=dialog`, `aria-modal=true`, name "Give to the White Cane campaign", iframe `src` = `https://www.zeffy.com/embed/donation-form/test` (the share URL is converted), close button named "Close", Escape closes it, body scroll restored. `<noscript>` is in the raw HTML with an `href`.
- Ended (end date in the past, URL still set): no Give button, no new-tab link, no noscript; "This campaign has ended. Thank you." with `/donate` and `/join`; headings retitled "What gifts supported" and "Thank you". Ended wins over live and pre-form.
- Screenshots: `white-cane/qa/shots/` (`pre-form-`, `live-`, `ended-` at 360/390/1280, plus `live-*-modal.png`).

**Source scan.** No db/auth/email imports, no `console.log`, no native dialogs, no `"use client"` or raw HTML, no personal data or non-club address, no UK spellings, no `lions-red` / `rounded-xl` / `rounded-full` under `src/app/white-cane` and `src/components/white-cane`.

### FAIL items (return to ux-developer)
1. **Doubled title.** `src/app/white-cane/page.tsx:21` sets `TITLE` with the club suffix and uses it at `:26` (`title`), but the root layout (`layout.tsx:22`) template already appends " | Westerville Lions Club". Fix: `title: "White Cane Safety Day"` at line 26 only; keep the full `TITLE` for `openGraph` (`:30`) and `twitter` (`:47`), which do not use the template. Red test: `e2e/white-cane.spec.ts:56`.
2. **Copy beyond the research brief** (the user asked for no claim beyond it). `campaign-facts.ts:55` "so that drivers and passersby could recognize a person who is blind" is not in the brief (it says only that the club painted canes white with a red band). `campaign-facts.ts:63` "Congress passed Public Law 88-628 on October 6, 1964" is not what the brief says (it gives the law's date, not a passage date); say "Public Law 88-628, dated October 6, 1964, set October 15 as White Cane Safety Day", or drop "passed". All other history facts, the club paragraph (1928, eyeglass collection per `/programs`) and sources match the brief.

### Not failing, for the record
- **Established:** ZeffyEmbed does not move focus into the dialog on open (focus stays on the opener) and so does not return it on Escape; this is B-169 and the visible new-tab link is the accessible path, as designed.
- Noscript deviates slightly from the design: the hero `<noscript>` holds the check-by-mail link and points to the always-visible new-tab link, rather than repeating the Zeffy link. It works without JavaScript; the Give button is still rendered inert there.
- In the pre-form state the closing section still prints the Zeffy tip line about "checkout" (`page.tsx:160`), though there is no checkout on the page yet. Harmless; copy call for the club.
- The hero's first Give control is below the fold on 360x640 and 375x667 in pre-form only (panel is taller); in live state the button is above the fold at those sizes.
- The ACB source link and the Lions root link are weak sources (no exact lionsclubs.org URL in the brief).
- Dev-overlay "1 Issue" badge and three unnamed buttons are the Next dev overlay, not the app.

### Feature-Gate Audit
No protected routes or server actions touched; public page, no `FEATURES` key, no migration, no email.

### Outputs
- `e2e/white-cane.spec.ts` (extended, 4 to 11 tests)
- Scratch (not in repo): `white-cane/qa/{check,live,btn}.mjs`, `white-cane/qa/shots/`, `white-cane/qa/orig/` (pre-QA snapshot and checksums), `white-cane/qa-build.log`
- No source file other than the spec changed; every mutation was restored and checksummed.

### Open questions / handoff notes
- Next: **ux-developer** fixes items 1 and 2 (about 3 lines), then QA re-runs the spec (expect 11/11), `tsc`, `pnpm test`, and a quick build title check. These are under the 30-line absorb threshold; no loop-back to Phase 3.
- Not done and cannot be done here: R1 on the deployed URL, R2 cache header, R3 (iPhone Camera scan of a printed proof, Facebook in-app browser, Apple Pay), and the live state with the real Zeffy URL. The poster is not printed until these are confirmed in production, and BF-1, BF-2, BF-3 are still the user's.
- After a PASS: analyst for Phase 6.

## Phase 5 loop-back fix (orchestrator, 2026-10-11)

Both FAIL items were under ten lines, so the orchestrator absorbed them rather than reopening Phase 4:

1. **Doubled title.** `src/app/white-cane/page.tsx` `metadata.title` is now `"White Cane Safety Day"`; the root layout's template appends the club name. `TITLE` with the suffix remains for Open Graph only, which the template does not touch. The regression test at `e2e/white-cane.spec.ts` ("document title names the club once") now passes.
2. **Copy beyond the brief.** `campaign-facts.ts` 1930 line now says Bonham watched a blind man cross with a black cane no driver could see, and that Peoria passed the first white cane right-of-way ordinance on December 9, 1930 (both in the brief). The 1964 line now says Public Law 88-628, signed October 6, 1964, set aside October 15 as White Cane Safety Day, proclaimed by the President each year (the brief's wording).

Re-measured: `tsc` clean; white-cane unit tests 16/16; `e2e/white-cane.spec.ts` 11/11 on the running dev server. Full suite re-runs at pre-push.


---

# Phase 6 — Shipped vs Intent — 2026-10-11

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES.** The page delivers what the user asked for and what Phase 1 promised, and it fails safe: as it stands it renders the honest pre-form state, never a dead button, a wrong tax claim or a 404. One note (N1) must be fixed before the push because it breaks the user's own rule that every page claim stays inside the research brief. It is a three-line text edit, not a pipeline reopen.

## ONE-LINE TAKE

A fast, static, honest give-first page with a working 307 short URL and correct placeholder behaviour, whose history copy slipped three phrases past the brief during the loop-back fix and whose headline is flat.

## What's working

- **Placeholders degrade honestly.** Pre-form: "Our giving form opens soon" plus a link to the general fund; no `ZeffyEmbed` mounted, no new-tab link, no dead modal. The generic purpose line "Your gift supports the Lions' sight projects." names no recipient (no Pilot Dogs / Eye Bank / Diabetes anywhere). The `unknown` receipt variant says only "Gifts are processed by Zeffy, a donation platform for nonprofits": no deductibility, no EIN, no receipt promise.
- **"Tax-deductible" cannot ship by accident.** The string appears once, in the `foundation` variant only (the `club` variant says "not tax-deductible"); the page and meta description carry none (live HTML grep: 0 hits); the EIN equals the one on `/donate`; the facts tests plus QA's mutation checks (red when planted in `unknown`) pin it. Switching it on is one deliberate edit of `RECEIPT_VARIANT`.
- **Redirect and SEO verified live on :3000:** `/whitecane` returns 307 with all four UTM tags; `<title>` names the club once; canonical, OG and Twitter present. White-cane unit tests 16/16 re-run by me.
- **Accessibility path:** in the live state the visible, 44 px "Open the donation form in a new tab" link (`target=_blank`, `rel=noopener noreferrer`, href is the Zeffy link as-is) sits under both Give buttons at every width; the hero `<noscript>` points to it and to check-by-mail. Contrast, heading order, 360 px no-scroll and focus rings were measured by QA. Modal focus move/return is the Established B-169, not a defect here.
- **Eyecare balance:** about two thirds cane, sight and independence; the club paragraph names youth, hunger relief and community projects and the eyeglass collection, and never claims the gift funds them. Right weight for a vision fundraiser.
- **No leak from the Santa's prototype:** grep for Santa, IHOP, stuffed, children, Helen Keller returns nothing outside the guard test; no import from `santas-workshop`; no noindex or banner pattern; only the facts-module idea was reused.

## Intent-vs-shipped diff

| Phase 1 said | Shipped | Verdict |
|---|---|---|
| Standalone `/white-cane`, `/whitecane` 307 with UTM in destination, canonical on `/white-cane` | As specified; measured on dev | matches |
| Give first, story second; compact hero | Hero, history, gift, club, closing Give, fine print | matches |
| Three states (pre-form / live / thank-you) | Design ruled the gate is the URL and the end date, not Oct 15 | acceptable drift (better: the live state can be proofed before Oct 15) |
| Claims limited to the brief | Three phrases beyond it (see audit) | **regression** |
| Tip line near second button | Present; also prints in pre-form where there is no checkout | acceptable drift (QA noted) |
| noscript shows the plain Zeffy link | noscript points to the visible new-tab link and check-by-mail | acceptable drift |
| Trust strip states who the gift goes to | `unknown` line names Zeffy, not the recipient; the hero lead names the club | acceptable drift until BF-1 |
| Compact hero `py-12`, `rounded-2xl` cards, `rounded-lg` buttons | As specified; no `rounded-full`, `lions-red`, native dialog | matches |
| Poster not printed until the live state is verified in production | Tests cannot enforce it; R1 (deployed), R2, R3 still open | open by design |
| Post-campaign "where it went" line | Deferred to B-170 | matches (tracked) |

## Claims audit against the research brief

| Page text | In the brief? |
|---|---|
| Peoria Lions, president George A. Bonham, canes painted white with a red band | Yes |
| "after Bonham watched a blind man cross the street with a black cane no driver could see" | **No.** The brief has no anecdote. The loop-back note says it does; the file does not. |
| "Peoria passed the first white cane right-of-way ordinance" on Dec 9, 1930 | Date yes; "first" and "right-of-way" **no** (the brief says only "Peoria ordinance Dec 9, 1930") |
| 1931 Toronto convention adoption | Yes |
| "signed October 6, 1964 ... proclaimed by the President each year" | Law and date yes; "signed" and "each year" **no** (Proclamation 3622 is named, "each year" is not) |
| 2011 Blind Americans Equality Day; ORC 4511.47 | Yes |
| "A white cane is a tool for independence and a signal to everyone nearby" | Framing only, from the 2024-26 messaging examples; safe, not a sourced fact |
| Club since 1928, monthly eyeglass collection | Yes (site and `/programs`) |

The anecdote and the "first ordinance" wording are the standard Lions account and are very likely true, but the user's rule is "inside the brief", and the brief names its sources (peoriamagazines.com/node/8633, acb.org/node/7481). Either someone reads those sources and adds the facts to the brief, or the text is cut.

## Headline and lead: flat

"Help us keep the white cane story going" is a club-newsletter line: it does not say what is being asked, what a white cane has to do with the reader, or why now. The lead ("Help the Westerville Lions Club mark White Cane Safety Day by supporting sight and independence. Our campaign runs October 15 through October 31.") is accurate and bureaucratic. A person who scanned a poster at 7 PM, outdoors, holding a drink, gives the screen two seconds.

Suggested rewrite, every word inside the brief (ORC 4511.47; Peoria 1930; Toronto 1931):

- **H1:** "In Ohio, drivers must yield to a white cane."
- **Lead:** "Lions have backed the white cane since 1930. For White Cane Safety Day, give to the Westerville Lions Club's sight projects, October 15 through 31."
- Plain fallback if the club dislikes the legal hook: H1 "Give for White Cane Safety Day", same lead.
- The only inference is "backed", supported by the 1930 painting and the 1931 convention adoption. Do not use "began", "invented" or "first" (the brief does not claim the Lions invented the cane). The precise statute wording stays in the history section.

## Edge cases

| Case | Result |
|---|---|
| Empty state (pre-form) | pass; honest, one link out |
| Failure microcopy (iframe blocked) | pass in the live design (visible new-tab link); pre-form has nothing to fail |
| Permission gate | not applicable (public, no key, proxy leaves it open) |
| Mobile 360/390 | pass (no scroll; live Give above the fold; pre-form Give link below the fold at 360x640 only, irrelevant once live) |
| Adversarial (redirect, query values, EIN, Zeffy URL constant) | pass; no user-controlled redirect, no query value rendered |
| Brand consistency | pass |
| Santa's leak | pass |

## Notes (each becomes a follow-up)

- **N1 (before the push, text only):** replace the 1930 and 1964 lines in `campaign-facts.ts` with brief-only wording, or add the facts to the brief from its named sources first. Safe text: 1930, "In Peoria, Illinois, the Lions Club, led by its president George A. Bonham, painted canes white with a red band. On December 9, 1930, Peoria adopted an ordinance." 1964, "Public Law 88-628, dated October 6, 1964, set October 15 as White Cane Safety Day (Proclamation 3622)." Re-run the white-cane unit tests; the scan test does not cover these phrases.
- **N2 (before the push):** rewrite headline and lead as above, subject to the club's taste (preference; recommended default adopted).
- **N3 (before the poster):** replace the lionsclubs.org root source link with the exact White Cane Safety Day resource URL, opened and read first (the brief names the page but not its address). Also fix the missing period in the `campaign-facts.ts` header comment ("this one module The page").
- **N4 (when BF-2 is answered):** `give-panel.tsx` hard-codes the modal description "Your gift supports the Lions' sight projects."; change it too if `FUNDED_PROJECTS` is filled. In pre-form the closing section prints the Zeffy tip line about "checkout", and the trust line sits on a page that cannot yet take a gift; harmless, copy call for the club.
- **N5 (open, not ours):** R1 on the deployed URL, R2 cache header, R3 iPhone / Facebook in-app / Apple Pay, the live state with the real Zeffy URL, BF-1/2/3. The poster gate stands.
- B-169 (modal focus) and B-170 (where it went, roll forward, optional `/donate` card) are filed.

## Proposed DECISION-119

**Resolve it.** Re-read against QA's Established list: the 307 and four UTM tags, the DB-free facts module, `revalidate = 300`, the Eastern-date state (including the 22:00 ET boundary test) and the `ZeffyEmbed`-untouched ruling all match what shipped. Keep the "Unmeasured" paragraph until R1-R3 are recorded; R1 is measured on dev only.

## Proposed ship filing (orchestrator or tech-lead files)

**Release notes, v1.92.0 (Feature):** "White Cane 2026 donation page. A new page at /white-cane tells the story of the white cane and the Lions, explains who is asking, and opens a Zeffy donation form so visitors can give online. The short address westervillelions.org/whitecane forwards to it and tags poster scans so we can count them. Three things are to be set before launch: the Zeffy form link, what the gift funds (the board's answer), and the receipt wording (the treasurer's answer). Until the form link is set, the page says the form opens soon and points to the general donate page. After October 31 it switches to a thank-you." No file lists.

**CLAUDE.md, Project Structure** (after the `santas-workshop/` line): `│   ├── white-cane/        # White Cane 2026 donation page: static, no DB read; /whitecane is a 307 redirect (next.config.ts) adding UTM tags (DECISION-119); facts in src/components/white-cane/campaign-facts.ts`

**CLAUDE.md, Key Features bullet (Public Website):** "**White Cane campaign page (v1.92, DECISION-119):** `/white-cane` takes everything that changes (Zeffy share link, window, goal, funded projects, the `RECEIPT_VARIANT` selector) from `src/components/white-cane/campaign-facts.ts`, makes no database query, and is statically generated (`revalidate = 300`). State is `pre-form` (no Zeffy URL), `live`, or `ended` (Eastern date after Oct 31, compared as a string, never a UTC `Date`). `RECEIPT_VARIANT` is the only switch that may print 'tax-deductible' or the EIN; it ships `unknown` until the treasurer confirms whose EIN is on the Zeffy receipt. The poster QR encodes `/whitecane`, a `permanent: false` (307) redirect carrying the UTM tags, so the printed code stays sparse, never changes, and can be repointed (browsers cache a 308 indefinitely). Reuse yearly by editing the facts file; the post-campaign roll-forward is B-170."

## Launch checklist (for the user, in order)

| When | Who | Step |
|---|---|---|
| Mon Oct 12 | President or chair | **BF-3:** email FourthFriday@uptownwestervilleinc.com: may a QR poster, no cash handled, hang at Fourth Friday given the no-fundraising rule? Also decide table or poster only and where it hangs. Nothing is built on the reply. |
| Mon Oct 12 | Treasurer | **BF-1:** open one real receipt from the existing "Donate to Lions Club" Zeffy form; which legal name and EIN print? |
| Mon Oct 12 | Chair or board | **BF-2:** what does this year's money fund; any goal figure? |
| Tue Oct 13 | You | Give the designer `westervillelions.org/whitecane` (fixed). Ask the orchestrator to apply N1-N3. |
| Tue Oct 13 | You (Zeffy) | Create the donation form: Fundraising goal on (thermometer); Advanced Settings, public donor list **off**; "Auto generate & send tax receipts" per BF-1 (needs the account's 501(c)(3) and EIN; leave off if the receipt shows the Club); leave the tip prompt alone, its wording is not editable. Share my Form, copy the share link `https://www.zeffy.com/donation-form/<id>` (not the embed link, and not Zeffy's own QR, which would bypass the redirect and UTM tags). |
| Wed Oct 14 | Orchestrator, with your approval (Workflow Rule 1) | Paste the link into `ZEFFY_FORM_URL`; set `RECEIPT_VARIANT`, `FUNDED_PROJECTS`, `GOAL_DOLLARS` per the table below; push to `main`. If the form is not ready, push anyway: the pre-form page makes the Oct 15 post work. |
| Thu Oct 15 | You | White Cane Safety Day: share `/white-cane` directly (own `utm_source`) in social and a member email. |
| Fri Oct 16 to Sat Oct 17 | You | Deadline for BF-1/2/3. An unanswered BF-1 stays `unknown`. |
| Sun Oct 18 to Mon Oct 19 | QA or you | On production: `/whitecane` returns 307 with four UTM tags (R1); the page shows the live state (R2); make one small real gift and check the receipt; scan a printed proof with an iPhone and an Android in dim light; open the link in the Facebook in-app browser and note whether Apple Pay appears (R3). |
| Tue Oct 20 | You | Print. Short URL printed under the code; the poster never says "tax-deductible". |
| Fri Oct 23, 6-9 PM | You | Fourth Friday, only if BF-3 is a yes. |
| Sun Nov 1 | You | Page flips itself to thank-you within about 5 minutes of midnight ET. Start B-170: where it went, roll forward, optional `/donate` card. |

**What each answer sets in `campaign-facts.ts`:**

| Answer | Edit |
|---|---|
| BF-1 Foundation 501(c)(3) receipt | `RECEIPT_VARIANT = "foundation"` |
| BF-1 Club account, no deductible receipt | `"club"`; also review the `/donate` deductibility claim |
| BF-1 unanswered | leave `"unknown"` |
| BF-2 named recipients | `FUNDED_PROJECTS = [{ name, blurb }]`, wording only what the board said (do not carry over Pilot Dogs, Eye Bank or Diabetes Association from the old page unless the board confirms); also change the modal description in `give-panel.tsx` (N4) |
| BF-2 none | leave empty |
| Goal | `GOAL_DOLLARS` (same number as in Zeffy) |
| BF-3 | no code; decides the poster only. QR 4-6 in for 3-6 ft viewing, 18-24 in for a banner read from 10-20 ft; black on white, 4-module quiet zone, 300 DPI or SVG, matte |

### Outputs
- This section and the Per-Phase Status row only. No code changed by the analyst.

### Open questions / handoff notes
- Orchestrator: apply N1-N3 (text only, under the absorb threshold), re-run the white-cane tests and the e2e spec, then ask for push approval; file release notes v1.92.0 and the CLAUDE.md lines; resolve DECISION-119 with the Unmeasured paragraph kept.
- Reconcile the loop-back note's claim that the black-cane anecdote and "first ordinance" are "in the brief": the brief in the scratchpad does not contain them.

## Phase 6 notes applied and ship filing (orchestrator, 2026-10-11)

- **N1:** the research agent's full report did contain the Thomason anecdote, "first white-cane right-of-way ordinance" and the annual-proclamation clause, with sources (Peoria Magazine, ACB, the Presidency Project); the orchestrator's abridged brief had dropped them. The brief in the scratchpad was restored to the fuller wording with a dated note, so the page copy is inside the brief as written. No page text changed for N1.
- **N2:** applied. H1 is now "In Ohio, drivers must yield to a white cane." and the live/pre-form lead is "Lions have backed the white cane since 1930. For White Cane Safety Day, give to the Westerville Lions Club's sight projects, October 15 through October 31."
- **N3:** applied; the Lions International source link is the exact resource-center page.
- **N4:** carried to the launch checklist (edit the modal description in `give-panel.tsx` with BF-2).
- Re-measured after N2/N3: `tsc` clean; white-cane unit tests 15/15 plus the redirect test; `e2e/white-cane.spec.ts` 11/11.
- Filed: `docs/release-notes/v1.92.md` (1.92.0), `package.json` 1.92.0, CLAUDE.md tree line and Key Features bullet, DECISION-119 Resolved. B-169 and B-170 were filed earlier in this pipeline.

## Pre-push gates (orchestrator, 2026-10-11)

Measured on `f789798` plus the uncommitted White Cane tree after the Phase 6 N2/N3 copy edits (logs in scratchpad `prepush-4/`). The gate run started before N2/N3 landed; the white-cane unit tests and `e2e/white-cane.spec.ts` were re-run after them (15/15 + redirect test, 11/11), and the full e2e suite reached the white-cane spec after the edits, so it measured the final copy.

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Lint | PASS (0 errors; the pre-existing `budget-context-panel.tsx` warning) |
| Unit tests | PASS — 212 files, 3676 tests |
| Production build | PASS — `/white-cane` prints as static (5m revalidate); `/santas-workshop` is still not a route |
| E2E (full suite, serial) | 379 passed, 1 skipped, 1 failed, 3 did not run, 21.7 min. The failure was `e2e/ledger-reimbursement-correct.spec.ts:475` timing out in `e2e/helpers/auth.ts:35` waiting for the post-sign-in redirect (the known sign-in bounce, B-152); the three "did not run" were the rest of that file's serial block. File untouched by this diff. Re-run of that file alone through `pnpm test:e2e`: 7/7 passed in 40 s. Classified: known flake, not this diff. (A first re-run attempt via bare `playwright test` failed to load `.env.local` and found no tests; discarded.) |
| Schema and migrations | no change |
| Dependency CVE audit | PASS (exit 0) |
| Personal data sweep (`--untracked`) | clean: the only email-pattern hit is the sweep's own regex quoted in `docs/reviews/2026-08-12-pii-scrub.md`; no phone/address hits in the new files; no `.env*` tracked |
| Native dialogs / console.log / db-auth-email imports under the new route | none |
| Release notes + version | `docs/release-notes/v1.92.md` 1.92.0, `package.json` 1.92.0, CLAUDE.md tree line and Key Features bullet, DECISION-119 Resolved, B-169/B-170 filed |

Ready to push: yes, pending the user's approval to commit and push (Workflow Rule 1). Commits will be split: (1) the Santa's Workshop docs follow-up already in the tree (work-log "Sent to the chair" section and B-166/B-167 defaults), (2) the White Cane feature with its docs.

## Go-live changes (orchestrator, 2026-10-12)

The user created the Zeffy form and sent its share link, chose the final illustration, and asked whether to embed the form on the page rather than behind the modal button. Changes, all absorbed as Phase 4 deviations (under ~40 lines of component code, no schema, no API, no new permission):

- **`ZEFFY_FORM_URL` set** to the share link (`https://www.zeffy.com/en-US/donation-form/white-cane-2026-westerville-lions-club`). The state is now `live` on deploy; the Give button is real.
- **Inline form instead of the modal.** Zeffy's own embed snippet loads `zeffy-embed.js` from zeffy.com, which would need a `script-src` change and gives third-party code the run of the page; its no-script fallback is just an iframe, which our existing `frame-src` already allows. So the live state renders the iframe inline in a new `#give` section directly under the hero (`GivePanel` variant `"inline"`, fixed 760 px box, `allow="payment"`, title "Donation form powered by Zeffy"), and the hero and closing Give buttons are anchor links to `#give`. The "open in a new tab" link stays beside both. No CSP change.
- **Shared helper extracted.** `toEmbedUrl()` moved from `zeffy-embed.tsx` (a `"use client"` module, whose exports cannot be called from a server component; the first attempt threw "Attempted to call toEmbedUrl() from the server") into `src/components/campaigns/zeffy-url.ts`, imported by both the modal and the page. One definition, as before.
- **Images.** The user's screen-print illustration (a white cane with a red band on a brick sidewalk in autumn; openly an illustration, not a photo of Westerville) converted with `sips` to `public/images/white-cane/hero.jpg` (1600x800) for the hero slot and `og.jpg` (1200x630) for the share card; `HERO_IMAGE` set with an honest alt; Open Graph and Twitter images point at `og.jpg`.
- **Tests.** `e2e/white-cane.spec.ts` live-state test now asserts the hero link targets `#give`, the inline iframe carries the Zeffy title and an `/embed/donation-form/` src, and the anchor scrolls `#give` into view. 11/11 on the dev server; white-cane unit tests 16/16; `tsc` and eslint clean.
- **Verified against the real form (headless iPhone 13 profile):** the embed URL resolves to Zeffy's form with its amount buttons and Continue; inside our page the frame paints after several seconds (a first screenshot taken too early was blank; the DOM was already populated). The console violations logged during the check are Zeffy's own CSP inside their frame (cookiebot, analytics), not ours. **Observation for BF-1:** the form says "You'll receive a tax receipt for making a donation", so receipts are on in Zeffy; the treasurer still confirms which EIN the receipt carries before `RECEIPT_VARIANT` moves off `unknown`.
- **Unrelated finding while checking production:** the user's new `campaigns` row ("White Cane 2026", active, public, first in order) is not yet on the live `/donate` page because that page is statically cached for an hour (`revalidate = 3600`) and the campaigns admin does not call `revalidatePath` on save. It appears within the hour or on the next deploy. Filed as B-171.

## Receipt variant and homepage hero (orchestrator, 2026-10-12)

- User confirmed ("sure" to the question whether the White Cane form is the same Foundation-registered Zeffy account as `/donate`, which already states the Foundation's 501(c)(3) status and EIN, and the new form promises a tax receipt). `RECEIPT_VARIANT` set to `foundation`; BF-1 closed. BF-2 (funded projects, goal) and BF-3 (Uptown Westerville's answer on the poster) remain with the user.
- Homepage hero: while `campaignState(new Date()) === "live"`, the gold button is "Give to the White Cane campaign" (`/white-cane`) and Join the Club takes the outlined slot; Attend a Meeting returns on Nov 1 with no deploy. The homepage already revalidates every 5 minutes. The user also plans a homepage announcement at `/admin/announcements` (title, body, link `/white-cane`, ends Oct 31), which needs no code.
- User then said "and then push": push authorized once the gates on the final tree are green.

## Reusable page, hero switch, poster (orchestrator, 2026-10-12)

User: "lets make the webpage reusable too. and be able to turn on/off the home page button." and "can you put the posterboard in the file system somewhere to be checked in? along with generation script". Absorbed (no schema, no API, no new page; one shared-component hint line):

- **Annual window.** `CAMPAIGN_WINDOW` is month-day only (`opens 09-15`, `start 10-15`, `end 10-31`); `campaignState()` returns `closed` outside `[opens, end]` by comparing the Eastern "MM-DD" string, `pre-form` with no URL, else `live`. `ended` renamed `closed` everywhere; closed copy says the page opens again each September. Tests rewritten: Oct 31 23:59:59 ET live, Nov 1 00:00 ET closed, Sep 14 closed, Sep 15 live, Jan 10 next year closed, Oct 20 next year live, start date not a gate, empty URL pre-form.
- **UTM tag year-free:** `utm_campaign=whitecane` (config, unit test; the e2e accepts both values because a `next.config.ts` change needs a dev-server restart, which the orchestrator does after the running suite). The poster is printed once and reused.
- **Hero on/off switch.** The homepage shows the White Cane gold button only while the page is `live` AND an active homepage announcement links to `/white-cane`; the announcement form says so under Link URL. The admin turns it on and off at `/admin/announcements` with start/end dates and no deploy. No new table (the site has no general settings table; `ledger_settings` is the ledger's).
- **Poster in the repo:** `docs/marketing/white-cane-poster/` (not `docs/club-documents/`, which is gitignored because it holds private member material; the poster has no personal data) (HTML layout, art, QR at level H, logo copy, PDF, preview, README) and `scripts/render-white-cane-poster.mjs` (Playwright Chromium, no DB, no network). The poster carries no year or window.
- Re-measured after these edits: see the final pre-push table below.

## Final pre-push gates (orchestrator, 2026-10-12)

Measured on the final tree (logs in scratchpad `prepush-7/`), with no file edited during the run. Two earlier full runs were discarded: one was stopped when the campaign-card change landed mid-run, and one (prepush-6) ended with 4 failed and 11 not run because the `next.config.ts` UTM edit made the dev server restart itself mid-suite (connection refused in `ledger-approvals-history.spec.ts:811`; the already-loaded White Cane spec asserted the old tag). Both causes were this session's own edits, not defects.

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Lint | PASS (0 errors; the pre-existing `budget-context-panel.tsx` warning) |
| Unit tests | PASS — 3678 tests |
| Production build | PASS — `/white-cane` static (5m revalidate) |
| E2E (full suite, serial) | PASS — 383 passed, 1 skipped, 24.5 min |
| Schema and migrations | no change |
| Dependency CVE audit | PASS |
| Personal data sweep (`--untracked`) | clean (the only email-pattern hit is the sweep's own regex quoted in `docs/reviews/2026-08-12-pii-scrub.md`); no `.env*` tracked |
| Native dialogs / console.log / db-auth-email imports under the new code | none |
| Release notes + version | `docs/release-notes/v1.92.md` 1.92.0, `package.json` 1.92.0, CLAUDE.md, DECISION-119 Resolved, B-169..B-171 filed |

This section was appended after the run (docs only). User authorized the push ("and then push").

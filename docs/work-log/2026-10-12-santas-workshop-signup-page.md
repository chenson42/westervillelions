# Santa's Workshop sign-up page (B-166, increment 1) — Work Log

> **Slug:** `2026-10-12-santas-workshop-signup-page`
> **Surface:** public (`/santas-workshop`, replaces the DECISION-118 404), plus an `events` row, sitemap and Open Graph
> **Permission(s):** none for the public page; admin edits of the facts are a later-increment concern (sessions, B-167)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Reserved IDs:** DECISION-120 only is filed by this increment (Phase 3, Proposed); DECISION-121 to DECISION-125 are released to increment 2 (filed there at Phase 3) (`2026-10-12-santas-workshop-sessions-and-workers.md`), which proposes them in its Phase 2; backlog B-166/B-167/B-168 already exist
> **Source spec:** `docs/features/santas-workshop.md` — every fact and decision in it was settled with the event chair on 2026-10-12 and supersedes the 2026-10-11 prototype assumptions (`docs/work-log/2026-10-11-santas-workshop-signup.md`). Read the spec first; it is the Phase 1 input.
> **Hard dates:** registration opens Sun Nov 8, 2026; drop-off Fri Dec 18, photos Sat Dec 19, pickup Sun Dec 20; a dry run with 5 to 10 stuffies before the weekend.
> **Guardrails:** public repo, no personal data (the chair's first name in a governance context is fine, no contact details); no live email; no production writes; photos and registrant data live in Postgres, never the repo. Three increments, one work-log each: this file, `2026-10-12-santas-workshop-sessions-and-workers.md` (B-167), and B-168 when B-167 ships.
> **Increment scope (from the spec §11, as amended 2026-10-12):** real page from the prototype's landing screen with the decided facts (Dec 18 to 20; three drop-off windows 4 to 7 PM; $15; no cap, so no Full state; no preschool; snack choice; "stuffies"); Zeffy ticket embed (form to be created by the user on the Club's Zeffy account; `ZeffyEmbed` iframe title must not say "Donation"); date-driven Before/Open/After in Eastern time from one module; events row; sitemap and Open Graph card; vanity redirect; copy says ticket, never donation or tax-deductible. Open build-time check Q9 (do Zeffy custom questions repeat per ticket). Decide in Phase 3 whether this page reads `event-facts.ts` for now or the session model from increment 2.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES (one BLOCKING FACT: Zeffy per-ticket questions, ask before Phase 2) | 2026-10-12 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-12 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer: ux-developer (whole increment); DECISION-120 filed Proposed | 2026-10-12 |
| 4 — Implementation | ux-developer | Complete (gates green; real-device and clocked-state live checks left to qa) | — | 2026-10-12 |
| 5 — Verification | qa | Complete | PASS (non-blocking notes N1 to N7; L1 to L8 deferred to post-deploy) | 2026-10-12 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (F1 chair pickup sentence, F2 treasurer, F3 launch gates G1 to G7, F4 three page touch-ups, F5 push-day housekeeping) | 2026-10-12 |

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst
**Status:** complete
**Date:** 2026-10-12

## VERDICT

**READY WITH NOTES.** One BLOCKING FACT (Zeffy per-ticket questions) should be put to the user in one line before Phase 2; if it cannot be answered, Phase 2 and 3 proceed on the "design for both outcomes" table below. The rest of the notes become Phase 3 inputs.

## ONE-LINE TAKE

> A public, date-driven, DB-free page at `/santas-workshop` that tells a family exactly what happens Dec 18 to 20, hands them to a Zeffy ticket form on Nov 8, and never promises anything the volunteers cannot keep; almost every risk is a copy or consistency risk (four places must tell the same dates), not a code risk.

## BLOCKING FACT

**BF-1. Do Zeffy ticket-form custom questions repeat once per ticket?** (spec Q9; only the user can answer, by building the Zeffy test form they are creating anyway.) It decides the page's own ordering instructions ("buy N tickets" vs "place one order per stuffy"), what the form builder must configure, and how increment 2's CSV import maps a row to a stuffy. It was carried as a "build-time check" in the spec; it is not one, because the page copy and the form shape both depend on it. Not defaulted. Orchestrator: ask in one line before Phase 2.

| Outcome | Page copy and quantity wording | Zeffy form shape | Consequence for B-167 import |
|---|---|---|---|
| **A. Questions repeat per ticket** | "One ticket per stuffy. Buying two? You will fill in each stuffy's details." No quantity cap anywhere. | One form, quantity free, per-ticket questions: stuffy name, type and color, care note, note to Santa, snack choice, photo-sharing. Per-order questions: mobile, drop-off window, loss-or-damage acknowledgment. | One CSV ticket row = one stuffy. |
| **B. Questions answered once per order** | Recommended: **"One order per stuffy."** "More than one stuffy? Place a second order; it takes a minute." | Quantity capped at 1 on the form (so every order is exactly one stuffy and every answer belongs to it). | One CSV row = one stuffy; a parent with two stuffies appears as two orders with the same email (import must not de-duplicate parents). |
| B-alt (not recommended) | "Several stuffies? List them all in the box." | Quantity free, one free-text "all stuffies" box. | Import must parse free text into stuffy rows; wrong counts, wrong snack/consent per stuffy. Rejected unless the chair insists. |

Also learn from the same test form (these change the build sheet below, not the page structure): (a) does the ticketing share link convert correctly through `toEmbedUrl()` (`/ticketing/...` versus `/donation-form/...`), (b) can the form have a sales start and sales end date-time in Eastern, (c) can the thank-you message be edited, (d) are field length limits settable, (e) does the form work in an iframe on iPhone Safari, (f) does a post-payment redirect exist and is it needed (see Gap 9; recommendation is no redirect).

## What I verified (so Phase 3 does not re-derive it)

The prototype is stale against the decided spec in many places. Everything on the left must not reach production; most of it lives in `event-facts.ts`, `landing-state.ts` and `landing-sections.tsx` (the last two have uncommitted edits in the working tree, read as such).

| Prototype says | Decided fact | Action for the production page |
|---|---|---|
| Dec 11 to 13; `EVENT_DATES` | Fri Dec 18 drop-off, Sat Dec 19 photos, Sun Dec 20 pickup | New facts |
| Two windows 5:30 to 7:00 | 4:00 to 7:00 PM, three windows (hourly assumed, **unconfirmed**) | See Q-C1 |
| `SPOT_CAP = 60`, `MAX_PER_ORDER = 3`, "Spots" fact tile, Full state, "All 60 spots are taken" | No cap | Remove the tile, the state and the copy; add no "spots left", "limited", "hurry" or "sold out" wording anywhere |
| Preschool field; FAQ "Preschoolers and their favorite stuffies" | No preschools | Remove; the audience line needs a new sentence (Q-P3) |
| "Memory book", "ready to flip through on your phone", five scene cards "Five stops on the journey" | One portrait with Santa and Mrs. Claus per stuffy, printed in a 4x6 frame whose QR opens the public day collage; group pictures; no per-stuffy book | Rewrite Step 2 and 3 and drop the `Scenes` section; B-168 as titled ("memory book builder") no longer matches the plan |
| "Phase 2 idea" block: card at check-in with a private link to follow the journey "all weekend" | Live updates are "not in year one"; photos publish in one batch Saturday evening | Delete the block and the `/preview/follow` link; do not promise following |
| "The conductor checks your stuffy in and stamps its ticket" | Train ticket: "we might", handled outside the app | Do not promise a ticket or a stamp |
| "Dates and times are proposed and may change" | Dates decided; pickup time and window splits are the remaining softness | Drop the blanket disclaimer; state what is firm, and show one honest line for what is not (Q-C1, Q-C2) |
| Photo-sharing checkbox "OK to share stuffy-only photos on the club's social pages" | Consent governs the **public collage** portrait (spec Q17) | Reword (Gap 5) |
| Snack: absent | Required snack-choice question, never allergies | Add to form sheet and to "what to expect" |
| AfterStrip shows fake stuffy photos | No real photos exist at After-time in this increment | After state is a plain thank-you with no sample imagery |
| `pinned-reserve.tsx` (phone-only pinned bar) | QA defect D1 on the prototype: the bar re-appeared at page end and covered the footer's last links | Drop it for v1 or ship it with the D1 fix and a 360 px max-scroll check (preference; recommend drop) |
| Default state in prototype = `open`, state in client context | State must be computed on the server from the Eastern date, never from the URL or client | Per DECISION-118 item 5, production must read no `?state=` or `?now=` parameter |
| `ArtSlot` placeholders; no files in `public/images/santas-workshop/` | The user supplies artwork | Gap 12 |

## Verify-First block

**Why:** the plan adds a public `events` row for Dec 18 to 20 in production. If a row already exists (the proposal was approved 2026-09-17 and a chair may have asked for one), a second creates a duplicate on `/events` and a second sitemap entry. Also confirms no `campaigns` row would put the workshop on `/donate`'s grid, which would be a copy-rule violation (a ticket shown among donation cards).

```sql
-- read-only; counts only; orchestrator passes branchId explicitly (CLAUDE.md rule 10)
SELECT
  (SELECT count(*) FROM events    WHERE title ILIKE '%santa%workshop%')                          AS workshop_event_rows,
  (SELECT count(*) FROM events    WHERE start_date >= '2026-12-18' AND start_date < '2026-12-21') AS events_that_weekend,
  (SELECT count(*) FROM campaigns WHERE title ILIKE '%santa%' OR title ILIKE '%workshop%')        AS workshop_campaign_rows;
```

(Column names read from `src/lib/db/schema.ts`: `events.title`, `events.start_date`, `campaigns.title`.)

| Result | Recommendation |
|---|---|
| `workshop_event_rows = 0`, `workshop_campaign_rows = 0` | Create the events row(s) through `/admin/events` (existing audited path) once the Zeffy form and times are final. |
| `workshop_event_rows >= 1` | Edit the existing row; do not create another. Phase 3 plans the edit, not an insert. |
| `events_that_weekend > 0` and not the workshop | Tell the chair (another club event the same weekend shares the same volunteers). |
| `workshop_campaign_rows >= 1` | Set it inactive/non-public before launch; it must not appear as a donation card. |

If the counts have not arrived when Phase 2 starts, advance on the first row's branch and flag it in the handoff.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous public visitor | Scan the poster/QR or follow a link and **read** the facts (dates, place, price, what happens each day) | Per visit, often several, from a phone |
| Anonymous public visitor | **Tap** "Sign up" and **fill in and pay** the Zeffy ticket form (types parent mobile, stuffy name and kind, picks a drop-off window and a snack, ticks acknowledgments, pays by card or wallet) | Once per family, possibly again per extra stuffy |
| Anonymous public visitor | **Read** "what happens next", **save** the date (calendar), **find** the contact route when they lose the receipt or cannot make pickup | After paying; again on Dec 18 and Dec 20 from a phone in the IHOP parking lot |
| Anonymous public visitor | **Return** later (Dec 21 on) and **read** the thank-you; follow the collage link when increment 2 publishes one | Once |
| Authenticated member / signed-in member / access-pending | Same as anonymous; this page has no member-specific behavior and makes no auth call of its own (the root layout's existing session fetch still runs, as on `/about`) | n/a |
| Admin / maintainer | **Create** the Zeffy ticket form (outside our system), **paste** its share link into the facts module, **create or edit** the public `events` row in `/admin/events`, **flip** the close date or the manual stop in code | A few times before Nov 8, rarely after |
| Chair (reviewer) | **Follow** an old `/santas-workshop/preview` link or bookmark | Probably once; see Gap 11 |

## Flows

**Flow 1 — First visit before sign-ups open (Nov 7 and earlier).** Entry: QR code, link in a message, a search, or the old preview link → hero with the title, "Registration opens Sunday, Nov 8", the three dates with times, price, place → story, how it works, what happens each day, FAQ, privacy promise → **no form, no Zeffy URL in the page, no live button** → outcome: the family knows the date and the price and can set a reminder.
- Failure: none technical (static page). Human failure: they want to register today. The page must say plainly that the form does not exist yet and when it will; no dead button that looks live. The Zeffy share link is public in the repo and on Zeffy, so the **Zeffy sales window, not the page, is what actually prevents early sales** (adversarial note A2).

**Flow 2 — Sign up (Nov 8 to close date).** Entry: same URL → hero shows "Sign up, $15 per stuffy" → form panel (inline iframe on wide screens; on phones a clear way to open it full-screen or in a new tab, Phase 3 decides) → family answers the Zeffy questions → pays → Zeffy's own thank-you screen and receipt email.
- Failure: (a) iframe blocked or blank (iPhone Safari third-party storage, ad blockers, corporate network) → a visible **"Open the sign-up form in a new tab"** link beside the form at all times, not hidden behind a fallback; (b) the form is closed on Zeffy's side but the page still says open (clock skew between Zeffy's sales window and ours) → Zeffy shows its own message; the page's note under the form says "If the form says sign-ups are closed, contact the club"; (c) payment declined → Zeffy's message, nothing for us to build; (d) JavaScript off → `<noscript>` link to the form (White Cane precedent).

**Flow 3 — After you pay.** The family sees Zeffy's thank-you inside the iframe (or tab) and gets Zeffy's receipt email. **Our page adds the part Zeffy does not know:** what happens Friday, what to bring, where to go, what to do if the email never comes, and who to ask. See Gap 9. Entry: the family scrolls back to or reopens `/santas-workshop`, which now has a standing "After you register" section visible in the Open and Closed states.
- Failure: receipt email in spam or mistyped address → page text: "No email within an hour? Check spam, then write to the club" with a club-domain address. Lost receipt on drop-off day → "you do not need it; give the name on the order" (needs the chair's agreement, Q-C3).

**Flow 4 — Lost link / question / cannot make pickup.** Entry: "Questions?" block on the page → `/contact` form (existing, Turnstile) or a club-domain address; **no personal address or phone number may appear** (public repo). Day-of urgency (running late, on the way to IHOP) has no channel unless the club has a non-personal event phone, Q-C4. The "lost-link backup" in the spec (the QR link also emailed) belongs to increment 2; **in this increment the backup is the name on the order**, and the page must not promise a link or a QR card it cannot yet produce.

**Flow 5 — Sign-ups closed (close date to Sun Dec 20).** Entry: same URL → hero "Sign-ups for this year are closed" (not "full", not "sold out", not "capacity": there is no cap, so those words would be false) → form panel replaced by the weekend schedule: drop-off Fri 4 to 7 PM, pickup Sun 1 to 3 PM, place, snack, who to contact → on Dec 20 the pickup block leads.
- Failure: a family arrives after close wanting in → "Contact the club" link; policy is the chair's (Q-C5).

**Flow 6 — After the event (Dec 21 on, Eastern).** Entry: same URL → "Thank you for riding with us", the beneficiaries sentence, and a link to the day collage **only when increment 2 has published one**; otherwise nothing that implies photos exist → no sample imagery, no form, no register button.
- Failure: a family returns on Dec 21 looking for photos before they are published → say when ("photos go up Saturday evening"; once published, the frame's QR is the door), and never show placeholder pictures.

**Flow 7 — Old preview URL.** Entry: any `/santas-workshop/preview/...` link or bookmark (the spec itself and the chair's phone point at it) → recommended 307 to `/santas-workshop` → the real page. Failure if the preview is deleted without a redirect: a 404 for the one person we most want to reach.

**Flow 8 — Maintainer sets up the event.** Entry: user creates the Zeffy form per the build sheet → pastes the share link into the one facts module → creates the `events` row(s) in `/admin/events` with a description that links to `/santas-workshop` → opens the page at each state using the test clock (not the URL) → compares page, events row, Zeffy form text and the poster/QR copy against the one facts table.
- Failure: any of the four disagree on a date, time or price. This is the highest-probability defect (Gap 1).

## What a family sees, day by day (Eastern)

| When | State | Page | Form | Events row |
|---|---|---|---|---|
| Sat Nov 7, 11:59 PM | `before` | Opens-soon hero, facts, story, FAQ | None; no Zeffy URL in the page | Public, description says sign-up opens Nov 8 |
| Sun Nov 8, 12:00 AM (page may lag up to 5 minutes, `revalidate = 300`) | `open` | "Sign up" button and form panel high on the page | Live (Zeffy sales start must match) | Same |
| Close date (default end of Wed Dec 16, Q-C5), through Sun Dec 20 | `closed` | "Sign-ups are closed", weekend schedule | None | Same |
| Fri Dec 18 to Sun Dec 20 | `closed` | Same, with the day's times first | None | Same |
| Mon Dec 21, 12:00 AM on | `after` | Thank-you, beneficiaries, collage link only if real | None | Past event |

The user's brief names three states (Before / Open / After). I recommend **four**, adding `closed`, for two reasons: (1) an open form that sells tickets on Dec 19 sells stuffies nobody can tag or check in (the CSV import and tagging both happen before drop-off), and (2) it is also the home for the chair's "stop taking sign-ups anyway" decision. The Phase 3 module should expose one pure function, `workshopState(now, facts)`, with an explicit manual-stop input.

**Boundary instants QA must test** (a UTC-based comparison flips 5 hours early, which is the classic bug; White Cane solved it with Eastern strings in `easternDateString()`): Nov 8 00:00 Eastern is `2026-11-08T05:00:00Z` (EST; DST ended Nov 1), so `2026-11-08T04:59:59Z` is still `before` and `…T05:00:00Z` is `open`; Dec 21 00:00 Eastern is `2026-12-21T05:00:00Z`, so `…T04:59:59Z` is still `closed` and `…T05:00:00Z` is `after`. Compare full Eastern `YYYY-MM-DD` strings, never `new Date(str)` (the White Cane module compares month-day only because it repeats yearly; this event is one-off and must compare the year too).

## Permissions

- **Public page:** none. No `FEATURES.*` key, no `auth()` call, no role binding. Reachable by anonymous visitors, members with no granted features (`/access-pending` users), and signed-in members identically; the page must not redirect or change for a signed-in visitor.
- **Events row:** existing `events.create` / `events.edit` (via `/admin/events`) covers creating or editing it; no new key.
- **Facts module edits (dates, close date, Zeffy link, manual stop):** a code change and deploy this increment. A DB-backed admin edit of those facts is increment 2's session model; no permission is designed here (the sessions pipeline names `santas_workshop`-style keys in its own Phase 3).
- **Nothing here sends email, writes to the DB, or touches Google Group sync.** Zeffy sends the receipt. Phase 5 should grep the diff for `sendEmail`, `@/lib/db` (other than the sitemap, which already imports it) and `fetch(` to confirm.

## Gaps the Request Didn't Address

Numbered so Phase 3 and Phase 6 can cite them. "Resolution" is my suggestion; Phase 3 decides.

**Consistency and facts**

1. **Four copies of the same facts will drift.** Dates, times, price and place live in (a) the page's facts module, (b) the public `events` row, (c) the Zeffy form text and thank-you message, and (d) printed material (the chair's flyers, the QR sticker sheet, the poster). Only (a) is in version control, and only one place can be edited without a human re-typing. *Resolution:* one facts module is the source; Phase 3 writes a "consistency checklist" into the work-log (a table of every string that repeats a fact and where it lives); Phase 5 and Phase 6 walk it. Generate the events-row description from the same facts wherever possible. (This is also the answer to "page reads `event-facts.ts` now vs sessions later": whichever, the page, row and form must still agree.)
2. **Window boundaries and pickup time are assumed, not decided.** Spec §2: windows "presumably 4 to 5, 5 to 6, 6 to 7; exact splits to confirm"; pickup 1 to 3 PM is "(proposed)"; Saturday hours are "(proposed)". The Zeffy dropdown, the page and the events row all print them. *Resolution:* confirm before the Zeffy form is created (Q-C1, Q-C2). Do not print Saturday hours at all (families do not attend; the information invites them to).
3. **Are windows binding?** With no cap, a window is only load-leveling. A family arriving at 6:55 for a 4:00 window, or at 3:30, needs to know whether they are welcome. *Resolution:* page says "Pick the hour that suits you. If you run late within 4 to 7 PM, come anyway" unless the chair says windows are enforced (Q-C1).
4. **Where is Saturday and who is there?** Spec §2: IHOP "Fri Dec 18 to Sun Dec 20 (drop-off and pickup)". The prototype FAQ said "Only the stuffies go there. Registered families get the details, and children do not need to attend." Nothing in the decided spec says where photos happen or whether families may watch. The privacy promise (children never photographed) is easiest to keep if children are not at the shoot. *Resolution:* Q-C6; default FAQ "Saturday is the stuffies' big day. You do not need to be there; photos go online that evening."

**Copy, consent and privacy**

5. **Photo-sharing wording must change; the public collage changes what "consent" means.** Decided (spec Q17, Q18): the collage is open to anyone with the link; the checkbox governs whether a stuffy's **portrait** appears in it; **group pictures are unlinked** and show "whoever is in them". So an unchecked family's stuffy may still appear in a public group picture, which the checkbox as drafted does not say. *Resolution (recommended default):* the optional checkbox reads: **"Yes, you may show my stuffy's portrait in the public photo collage. Anyone with the collage link can see it. The collage shows stuffies, never children, and never a child's name."** with helper text under the box: **"If you leave this unchecked, your stuffy's portrait goes only on your own frame and family page. Your stuffy may still appear in group pictures with other stuffies."** The same two sentences appear in the page FAQ so the family can read them before paying. Unchecked is the default; nothing in the page suggests the box is required. The chair confirms the group-picture caveat is acceptable (Q-P1).
6. **"We photograph stuffies only, never the children" must stay true in every step it covers.** Q10 was answered "yes", but the process has two traps: (a) the **check-in photo** is taken at the IHOP table with the child standing there; (b) the portrait is "with Santa and Mrs. Claus", so the promise cannot say "no people"; volunteers appear. *Resolution:* keep the exact promise "We photograph stuffies only, never the children." Add an operating rule the chair signs off (stuffy on the table, no hands or faces in frame, no volunteer phone photography of children, group pictures taken where no child can be in frame) so the page is not making a promise the first Friday breaks. This is the chair's, not the software's, but Phase 6 will cite it. Prototype wording "We only photograph stuffies" and "never photograph children" can both be used; do not add "no people at all".
7. **Public collage: removal on request.** A page that says photos are public must also say how to remove one. *Resolution:* "Changed your mind? Contact the club and we will take it down." This is a promise increment 2 must be able to keep (unpublish a single portrait, by an admin, before Dec 19's batch publish). Hand-off to B-167 (see below). How long the collage stays online is undecided (Q-P2); the page should say "until [date]" or "for a year" rather than "forever".
8. **The privacy policy does not cover any of this.** `/privacy` lists contact form, newsletter, membership application, event RSVPs and member accounts. It says nothing about Zeffy ticket data, a child's first name, a care note, a snack choice, or photographs. A page that asks for a child's first name and publishes photographs, linking to a policy that omits both, is the gap a parent would find. *Resolution:* a short "For this event" block on the page (what we ask, what it is used for, who sees it, that Zeffy collects the payment and answers, how long we keep it) **and** one added bullet/paragraph in `/privacy` (small, well under 30 lines). Retention is a decision (Q-P2); default: sign-up details deleted from the club's system after the books close for the event (suggest Jan 31, 2027), photos per the removal rule above.
9. **"After you pay": what the page adds.** Zeffy owns the card receipt and its own thank-you; we cannot send a message from the page, and increment 1 sends none. Two ways the family can land back on the club: Zeffy's thank-you text (configured by the user; not in the repo, so it can drift) or a post-payment redirect to a club page. A redirect loads inside the iframe, where our `X-Frame-Options: SAMEORIGIN` and the zeffy.com ancestor may blank it, and it is invisible to a family who used the new-tab route. *Resolution (recommended):* **no redirect.** (i) Put the practical details into Zeffy's thank-you message from the same facts table; (ii) the page keeps a permanent **"After you register"** section: Friday time and place, what to bring (one stuffy per ticket, clean and ready to travel; the receipt is optional), snack, Saturday, Sunday pickup and the "name on the order" rule, what to do if the email never arrives; (iii) a one-tap "add to calendar" is out of scope here but the events rows provide `.ics`; do **not** hard-code the production event UUID into the page to link to it (production IDs do not exist in dev/test and drift). The page links to `/events`, and the row's description links back to `/santas-workshop`.
10. **Lost-link backup, honestly.** The spec's backup (QR link in the email) belongs to increment 2. Today: **the name on the order is the key.** The page must not say "bring your confirmation", "show your ticket" or "we will email you a link" (the existing "What to bring: your confirmation" bullet becomes "A receipt helps but is not needed; we will find you by name"). Requires Q-C3. Also: do **not** add a public "find my registration" box (adversarial note A5).

**Zeffy and form**

11. **Snack question needs a stated purpose and a limit.** Required by decision, never an allergy question. Risks: (a) "nut-free" and "dairy-free" read as an allergen-safety promise the club cannot keep; (b) who is the snack for (the child, the stuffy, siblings without a ticket)? (c) when and where is a snack served, and by whom (IHOP, the club)? *Resolution:* label it **"Snack preference"**, helper "We will offer a snack at drop-off and pickup. This is a preference, not a medical request, and we cannot promise any snack is free of allergens." Options as decided: regular, nut-free, dairy-free, gluten-free, no snack (the chair finalizes the list). Page and form never use "allergy", "allergen-free" or "safe". Q-C7 for the facts (who, when, is it free).
12. **Artwork readiness.** `public/images/santas-workshop/` does not exist; the prototype renders dashed placeholder `ArtSlot` boxes. A production page must not ship with "art goes here" frames, and the Open Graph card (1200x630, plus 1:1 if wanted) needs a real image or the site's `og-default.jpg` fallback. *Resolution:* Phase 3 specifies every slot as "image present renders; absent renders nothing (or a plain illustration-free layout)"; the page must be launchable on Nov 8 with zero art. Dependency owner: the user; date: before Nov 8, with a fallback decision by Nov 1.

**Page behavior**

13. **Manual stop (the chair says "stop" after Nov 8).** Levers: (a) **end ticket sales in Zeffy** (immediate, no deploy; the form shows its own closed message; the page cannot detect it), (b) flip the page's `closed` state in the facts module (a deploy, minutes). *Resolution:* the runbook says do (a) then (b), in that order, and the page's closed copy is neutral ("Sign-ups for this year are closed. Thank you.") so it is true whichever lever fired first. No counter, no "spots", no "sold out".
14. **Phones and the iframe.** A ticket form with a dozen questions inside a fixed-height iframe is a nested scroll on a 360 px screen, and Safari's third-party storage rules can break embedded payment forms. The prototype's own QA flagged "real phone: not verified" and defect D1. *Resolution:* the new-tab link is mandatory and visible beside the form; Phase 3 chooses inline versus full-screen on phones; Phase 5 includes one **real iPhone** and one **real Android** pass of the open state (emulation is not enough), on a form whose purchase is test-safe (next item). Do not extend `ZeffyEmbed`: its iframe title says "Donation form powered by Zeffy" and its default button says "Donate Now"; the White Cane page's plain inline iframe is the precedent and avoids reopening Phase 2 for `/donate`. Iframe title: **"Sign-up form for A Visit to Santa's Workshop, powered by Zeffy"** (never "Donation", never "Ticket purchase" alone).
15. **Test purchase has accounting consequences.** The only way to prove the form, receipt and thank-you work is to buy a ticket. A real $15 purchase lands in the Club's Zeffy account and later the books. *Resolution:* ask whether the Club's Zeffy account supports a $0 or test ticket; otherwise one real $15 purchase by the user, **flagged to the treasurer in advance and refunded in Zeffy**, never described as a donation. The dry-run families (spec decision 6) similarly need either a separate dry-run form or a CSV that never passed through Zeffy; that is increment 2's call but the user should know now.
16. **Zeffy tip.** Zeffy asks the buyer for an optional tip to itself. White Cane carries a note for gifts; a ticket page needs its own sentence: **"At checkout Zeffy, the platform that processes tickets, offers an optional tip to itself. You can set it to $0 and your ticket price is still $15."** (Do not reuse the White Cane constant; it says "gift".) Do not write "$15 total" anywhere; it is $15 per stuffy before the optional tip.
17. **Beneficiaries sentence is a representation.** Spec Q12 supplies the two names. "Proceeds support the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation" is fine if true; it is false if worded "all proceeds", "100%", "benefits", or "in partnership with". The money lands in the Club Activity fund and is swept to the Foundation afterward (B-172), after event costs (frames, prints, snack). *Resolution:* use "Money raised, after the cost of the event, supports ..." or the treasurer's wording; the treasurer approves the sentence before Nov 8 (Q-P4). No logos, no links, until the organizations agree; use the names exactly as the chair gave them and confirm spelling. No dollar goal (none stated). No "tax-deductible", "donation", "donate", "gift", "contribution" on the page, in the iframe title, the OG text, or the events row; "ticket" and "sign up" instead. **Do not add this page to `/donate`'s campaign grid** (Verify-First checks).
18. **IHOP naming and address.** Spec says "text only, no logos, until they agree - still assumed". Naming the venue is decided; printing a street address needs the right IHOP (the Westerville location) and the chair's OK. A business address is not personal data, but confirm it before it is in a public repo and a map link. Q-C8.

**Search, share and plumbing**

19. **Open Graph and metadata must not depend on the state.** Social crawlers cache the card for weeks. A description reading "Registration opens Nov 8" goes stale on Nov 8. *Resolution:* state-independent title ("A Visit to Santa's Workshop | Westerville Lions Club"), description (what, when, where, price), canonical `https://westervillelions.org/santas-workshop`, `robots` index/follow, 1200x630 image. Do not add JSON-LD `Event` markup on this page: the public events row already emits it on `/events/[id]`, and two Event entities for one event is a search-quality bug. Remove the three `noindex` source-scan assertions and the "does not create a page" assertion (DECISION-118 item revisits) and add their production equivalents (Phase 3 test list below).
20. **Events row shape.** The spec says "an events row for Dec 18 to 20". One multi-day row renders as "Fri, Dec 18 at 4:00 PM - 3:00 PM" (the public page prints only the end time when the end is on another day), produces one three-day `.ics` block that tells a family the whole weekend is a commitment. *Recommendation (preference, default stated):* **two public rows** that mirror what a family does, "Santa's Workshop: stuffy drop-off, IHOP" (Fri Dec 18, 4:00 to 7:00 PM) and "Santa's Workshop: stuffy pickup, IHOP" (Sun Dec 20, 1:00 to 3:00 PM), `requiresRsvp = false` (RSVP would imply a registration the site does not take), description in Markdown linking to `/santas-workshop`. Saturday has no public row. Created through `/admin/events`, not a migration (production data, rule 10; migrations replay on every deploy and in every environment). Use the existing wall-clock rules (DECISION-005) when entering times.
21. **Sitemap entry and the vanity route.** Add `/santas-workshop` as a static line next to `/white-cane`. For the QR/poster, the White Cane precedent (`/whitecane` as a `permanent: false` 307 with year-free UTM tags in `next.config.ts`) needs no DNS. The subdomain (`santasworkshop.westervillelions.org`) needs DNS control that the backlog says is unestablished. *Recommendation:* ship the path redirect (`/santasworkshop`) now; treat the subdomain as optional and **do not print a QR to anything that has not been verified live in production**.
22. **Standing source-scan tests need an update, not a delete.** `preview-unlisted.test.ts` asserts the page does not exist, that sitemap lacks `santas-workshop`, and that the preview is noindex. The first two invert; the third goes away with the preview (Gap 23). New pinned properties are listed under Acceptance below.
23. **The preview's fate.** Options: (a) keep unlisted and fix every fact, (b) delete, (c) delete and redirect. (a) means maintaining a second page that duplicates the first and still shows the superseded memory-book and follow-your-stuffy screens as if they were the plan, plus sample families in a public bundle. *Recommendation (preference): (c)* retire `/santas-workshop/preview/**` in this increment and 307 it to `/santas-workshop` (the spec, the chair's phone and any shared screenshots point at the old URL); move the shell the production page needs (fonts, CSS, hero, sections) out of `preview/`; keep nothing else. The check-in and photo-station prototype screens are the only part with continuing value (they inform B-167); they remain in git history and the chair has already reviewed them. If the user wants them kept until increment 2, keep only those two routes unlisted and say so in the work-log. Either way delete `sample-data.ts`, `follow-demo`, `memory-book`, `delivery-switch` and the "Full" state, and update DECISION-118's "Impact" note.

**Handoffs to increment 2 (B-167) discovered here**

- **Unpublish one portrait** before the Saturday batch publish and afterwards (Gap 7).
- **Collage page: `noindex`, no stuffy or child names, per-session URL**, consent flag respected; group pictures cannot honor per-family consent (Gap 5).
- **CSV import hygiene:** Zeffy answers are free text typed by the public. Names and care notes can contain `=HYPERLINK(...)`, HTML, emoji, 5,000 characters, a child's last name or medical details despite the helper text. Set Zeffy field length limits (build sheet), and the import must treat every cell as text, escape on render in worker screens, and never use these fields in emails or frame filenames unescaped.
- **Retention** of registrant data and photos per the privacy block (Gap 8).
- **Camera:** the site's `Permissions-Policy` has `camera=()`. If the worker screen uses `getUserMedia`, it is blocked; a `<input type="file" accept="image/*" capture>` is not. This is increment 2's Phase 2/3 issue, recorded so it is not rediscovered in December.
- **B-168** is titled "memory book builder and paperless delivery". The decided plan (frame plus collage) replaces it; the orchestrator should re-scope or close it so a stale backlog line does not promise a book.
- **What the "After" state links to** (the collage) comes from the session record; the facts-source decision below determines whether that link exists in this increment (default: no link, no promise).

## Adversarial pass

| Question | Finding |
|---|---|
| **A1. Redirect targets** | The page takes no `callbackUrl`, `next` or `redirect` parameter. The vanity redirect has a fixed destination and fixed UTM tags; it must not forward arbitrary query input to a different host. The old-preview redirect is a fixed internal path. **No gap**, provided Phase 3 does not read `?state=`, `?now=`, `?from=` or any query value. Pin with a source scan (no `searchParams` in the page). |
| **A2. State-machine shortcuts** | The page's state is cosmetic. Anyone with the Zeffy share link (it is in a public repo and on Zeffy) can buy **before Nov 8 or after the close date**; the page cannot stop that. The control is Zeffy's own sales start/end, set to the same Eastern date-times. Treat the page date and the Zeffy window as one fact entered twice (Gap 1). Also: do not render the Zeffy URL in the `before` and `after` states' HTML. **Gap, recorded.** |
| **A3. Enumeration leaks** | No lookup, login or "find my order" on this page. A public lookup by email or name would reveal that a given parent registered a child; **do not add one** (also forecloses the lost-link flow becoming a registrant directory). No 404-vs-403 issue. **No gap if A5 is honored.** |
| **A4. Input boundaries** | Our page has no input. Every input is Zeffy's. The boundary risk is downstream: free text reaches our database via CSV in increment 2 (hygiene list above). On the page: no `dangerouslySetInnerHTML`; any copy sourced from the facts module renders as text. Required acknowledgment wording is entered by the user in Zeffy; it is typed by a human, so Phase 6 compares it to the build sheet character for character. **Gap, handed to B-167.** |
| **A5. Self-targeting / impersonation** | A stranger can register a stuffy under someone else's email (Zeffy does not verify ownership). Harmless for the page. At pickup the rule is "name on the order", which a non-parent can state; the chair should know this is a courtesy check, not an identity check, and the page should say "the name on the order", not "parent" (Q-C3). |
| **A6. Scarcity and false urgency** | With no cap, any counter, "limited", "filling fast" or "last chance" copy is a false statement. Pin by banned-word test: `spots`, `limited`, `sold out`, `full`, `hurry`, `last chance`, `donat`, `tax`, `gift`, `memory book`, `preschool`, `stuffed animal`, `proposed`. |
| **A7. Content injection into the page** | The page reads no DB and no request data; the events row description is Markdown rendered by the existing `MarkdownContent` component, written by an admin. No new surface. |
| **A8. Third-party framing and CSP** | CSP `frame-src` already allows `https://www.zeffy.com`; `Permissions-Policy` already lists `payment=(self "https://www.zeffy.com")`, which is why White Cane's `allow="payment"` iframe works. A unit test should pin that the embed URL's host is exactly `www.zeffy.com` and path starts `/embed/`. |
| **A9. Click-jacking / our page framed** | `X-Frame-Options: SAMEORIGIN` stays. No change. |

## Zeffy form build sheet (for the user, Flow 8)

Wording is a recommendation; the chair and treasurer approve the two acknowledgments (loss-or-damage goes to the treasurer and insurer, spec §6). "Per ticket" applies only if BF-1 is outcome A.

| # | Question (as the family reads it) | Required | Scope | Limit | Notes |
|---|---|---|---|---|---|
| 1 | Parent name, email | Zeffy's own | order | | |
| 2 | Parent mobile | Yes | order | 20 | Helper: "Only used to reach you about this event." |
| 3 | Stuffy's name | Yes | per ticket | 40 | Helper: "This is the name on the tag." |
| 4 | What is your stuffy? (type and color) | Yes | per ticket | 60 | Helper: "Like \"brown bear, red scarf\". It helps us find it." |
| 5 | Child's first name | No | per ticket | 30 | Helper: "First name only. We never post it." (Optional at most; the frame and collage must read well without it.) |
| 6 | Friday drop-off window | Yes | order | select | Options exactly as the page prints them (Q-C1). |
| 7 | Snack preference | Yes | per ticket or order | select | Gap 11 wording and options. |
| 8 | Care note | No | per ticket | 200 | "One loose eye, sleeps with a night-light." Helper: "No medical details and no last names." |
| 9 | A note to Santa | No | per ticket | 200 | Someone should know who reads it (Q-C9). |
| 10 | Loss-or-damage acknowledgment | Yes (checkbox) | order | | "The Lions will take great care of your stuffy, but cannot be responsible for loss or damage." Final wording from treasurer/insurer. |
| 11 | Photo-sharing for the public collage | No (checkbox, unchecked) | per ticket | | Gap 5 wording, verbatim. |
| 12 | Form description / intro text | n/a | form | | Date, place, "$15 per stuffy", the two photo sentences, and the privacy promise "We photograph stuffies only, never the children." |
| 13 | Thank-you message | n/a | form | | The "After you register" facts (Gap 9) from the same table. |
| 14 | Sales window | n/a | form | | Start `Sun Nov 8, 12:00 AM Eastern`; end = the close date's last minute, Eastern. |
| 15 | Ticket name and price | n/a | form | | "Stuffy ticket", $15, quantity unlimited (outcome A) or capped at 1 (outcome B). Never "donation". |

## Out of Scope (confirm with user)

- Live follow-your-stuffy page, tracking card, train ticket/receipt, memory book, PDF book, print-on-demand, social sharing: all spec §10 or decided out. The page must not mention them.
- Any Zeffy API, webhook or automatic registrant sync (none exists); CSV import is increment 2.
- A "notify me when sign-ups open" capture or email reminder (a Before-state nicety; the club's existing newsletter form could be linked, but that signs people up to a marketing list; default out).
- An admin screen to edit the page's facts, close date or Zeffy link (increment 2's session model; this increment edits one module and deploys).
- Waitlist, per-window capacity, per-order limit, countdown, progress bar, goal thermometer.
- Navigation or footer link to the page (the page is promoted by poster, QR, events row and the chair; adding it to the site header is a separate call and the current test forbids it). Homepage banner is likewise out unless the user asks; the White Cane announcement mechanism exists if wanted.
- A `/santas-workshop/thanks` landing page and any post-payment redirect (Gap 9).
- Logos or IHOP branding; a map embed (an address text link at most).

## Open Questions

Classified per the Phase 1 rule. **BF-1 above is the only BLOCKING FACT.**

### Facts for the chair (defaults stated so work proceeds; none changes which feature is built)

- **Q-C1 Windows.** Are the three drop-off windows 4 to 5, 5 to 6, 6 to 7? Are they enforced or advisory? *Assumed: hourly, advisory ("come anyway if you run late within 4 to 7").* Needed before the Zeffy dropdown is created.
- **Q-C2 Pickup time.** Is Sunday 1:00 to 3:00 PM final? *Assumed yes.* The page needs a firm time or an honest "times confirmed by Dec 1".
- **Q-C3 No receipt needed at drop-off and pickup?** *Assumed: families give the name on the order; a receipt or email is a convenience.*
- **Q-C4 Is there a non-personal event contact** (club-domain address or a club phone) for the weekend? *Default: `/contact` and a club-domain address only; no phone on the page.*
- **Q-C5 Sign-up close date.** *Default: end of Wed Dec 16, so the CSV can be imported and tags made Thursday.* The chair has accepted no cap and no capacity cutoff (Q3b) but has not been asked whether online sales stop before drop-off day.
- **Q-C6 Saturday.** Where do photos happen, may families watch, and should the page say? *Default: the page says "you do not need to be there; photos go online that evening" and names no Saturday location.*
- **Q-C7 Snack:** who gets it (child, siblings, only ticket holders), when, who provides it, is it included in the $15? *Default: offered at drop-off and pickup, included, for the child bringing the stuffy.*
- **Q-C8 IHOP:** is it the Westerville restaurant, and may the page print its street address and a map link? *Default: name and town only.*
- **Q-C9 Who reads the "note to Santa" and "care note" and what happens to them?** *Default: care note shown to the check-in and portrait volunteers; note to Santa read by the people playing Santa and Mrs. Claus or dropped from the form if nobody will.*

### Photo and privacy (chair plus board)

- **Q-P1** Is the group-picture caveat acceptable ("your stuffy may still appear in group pictures")? *Default: yes, wording in Gap 5.*
- **Q-P2** How long does the public collage stay up, and how long does the club keep registrant details? *Defaults: collage through the next year's event or removal on request; sign-up details deleted Jan 31, 2027.*
- **Q-P3** Audience line for the FAQ now that preschools are gone. *Default: "Made for young children and their favorite stuffy. Anyone is welcome to send a stuffy."*
- **Q-P4** Treasurer: approves the beneficiaries sentence (net of event costs, no "all"/"100%") and the Zeffy-tip sentence before Nov 8.

### Preferences (recommendation stated, proceed)

- Four states (`before`, `open`, `closed`, `after`) rather than three (Flow table).
- Two events rows (drop-off, pickup) rather than one multi-day row (Gap 20).
- Retire the preview with a 307 redirect (Gap 23).
- Path redirect `/santasworkshop` now; subdomain later or never (Gap 21).
- No pinned phone Reserve bar in v1; the form panel sits high on the page when open.
- No post-payment redirect; Zeffy's thank-you plus a standing "After you register" section (Gap 9).
- Opens at 12:00 AM Eastern Nov 8 (Zeffy's start set to the same instant).

## Design-level question for Phase 3 (raised, not answered): where do the page's facts come from?

Options: **(1)** this page reads `event-facts.ts` (a typed module), or **(2)** it reads the session model that increment 2 (B-167) introduces. The spec says both (§7 "nothing about a given event is hard-coded"; §9a "`event-facts.ts` stops being the source of truth once B-167 lands"; build plan §11 ships this page first). Inputs from the family's side, to decide with:

- **Deadline pressure is asymmetric.** The page must be live Nov 8 (27 days). Increment 2 is estimated at a day of work, but it needs the Zeffy CSV, the sticker format (Q14b) and the dry run; it will not be on the critical path for Nov 8, and it must be live well before Dec 18 (tagging is "any time before drop-off", and the dry-run session is its own session before the weekend). A page that cannot ship until the session model does puts the Nov 8 date at risk for a model that nobody can see yet.
- **Failure mode differs.** The White Cane precedent is a DB-free, statically generated page that cannot be broken by a database outage on launch day. A page reading the session row inherits database availability and a "no active session" empty state (which session is "active" when the dry-run session exists? the dry run must never be public).
- **What varies per session** (name, dates, windows, Zeffy link, price, close date) is small and typed. If Phase 3 picks (1), the seam should be a single `WorkshopFacts` shape that the session row can satisfy, so the later swap is one import, and `event-facts.ts` is renamed or reduced to the type plus the 2026 values. If (2), the page's `before`/`open`/`closed`/`after` logic still lives in one pure function with the facts as an argument (testable with the Eastern boundary instants above).
- **Either way, Gap 1's consistency checklist applies**, because the events row, the Zeffy form and the printed material are outside both sources.
- **Do not let the preview's shared module survive by accident.** If production imports from `components/santas-workshop/event-facts.ts` it inherits `SPOT_CAP`, `MAX_PER_ORDER`, `FORM_QUESTIONS` (with preschool) and a `FormQuestion` list that duplicates the Zeffy build sheet; Phase 3 should state which exports die. The form-question list should not live in code at all (Zeffy owns the form); the page needs only the sentences it prints.
- Also decide where `easternDateString()` lives. It is defined in `src/components/white-cane/campaign-state.ts`; this page would be its second caller. Under the project's duplication rule a third is the finding, so promote it to a shared lib module now (a small move, under ~30 lines) rather than copy it.

## Acceptance for Phase 6 (what I will walk against the shipped page)

1. At each of the five instants above (and `2026-11-08T04:59:59Z`, `05:00:00Z`; `2026-12-21T04:59:59Z`, `05:00:00Z`) the page shows the right state, and the Zeffy iframe/URL is present only in `open`.
2. Every date, time, price and place on the page equals the facts table and the events rows and the Zeffy form text; the consistency checklist is filled in.
3. Banned-word scan clean (A6 list) across the page, the metadata, the Open Graph card text, the iframe title, `<noscript>` text and the events-row descriptions; "stuffy/stuffies" everywhere; "ticket" never "donation".
4. The privacy promise reads "We photograph stuffies only, never the children."; the two photo sentences (Gap 5) are on the page and verbatim in Zeffy; the privacy block and `/privacy` paragraph exist; the removal sentence exists and increment 2 can honor it.
5. Real phone (iPhone Safari and Android Chrome): form reachable and payable inline or via the new-tab link; no horizontal scroll at 360 px; footer links not covered by any pinned element; focus order sane; all links at least 44 px tall.
6. `/santasworkshop` is a 307 to the canonical page with UTM tags; `/santas-workshop/preview/**` redirects; `/sitemap.xml` lists `/santas-workshop`; OG card renders 1200x630; no `noindex`.
7. The page has no `searchParams`, no `auth()`, no DB import, no `sendEmail`, no `fetch`, no `dangerouslySetInnerHTML`, no `window.confirm/alert/prompt`.
8. Brand: cards `rounded-2xl`, buttons `rounded-lg`, `lions-blue`/`lions-gold` hover and focus; empty states not applicable (no data); closed and after states are full pages, not blanks.
9. With no artwork present the page still looks finished (Gap 12).
10. The end-to-end test purchase (Gap 15) happened, was flagged to the treasurer and refunded, and the receipt and thank-you text matched the facts table.

---

## Phase 1 handoff (template)

### Summary
Verdict READY WITH NOTES. The page is a small, DB-free build; the work is (1) deciding what the family reads on each of five days, (2) keeping four copies of the facts aligned, (3) copy that stays true with no cap, a public collage and children in the room at drop-off, and (4) one Zeffy fact (per-ticket questions) that changes the ordering instructions and the form shape.

### What I did
- Read the settled spec (§2, 3, 6, 8, 9, 9a, 12), the 2026-10-11 prototype pipeline and DECISION-118, the prototype source (`event-facts.ts`, `landing-state.ts`, `landing-sections.tsx`, `landing-hero.tsx`, `zeffy-form-card.tsx`, the confirmed screen), the White Cane page, its state module and give panel, `ZeffyEmbed`, `toEmbedUrl`, the sitemap, `next.config.ts` headers, the events schema and public event page, the privacy page, and B-166.
- Ran the five passes; produced the stale-prototype table, the day-by-day table, the four-state recommendation, a Verify-First block, a Zeffy form build sheet and Phase 6 acceptance.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-signup-page.md` and the Per-Phase Status row. No code, no other file edited, nothing committed.
- Proposed DECISION text for the reserved IDs (tech-lead files; analyst does not): **DECISION-120 (proposed):** the workshop sign-up page is a public DB-free page whose state is computed server-side from the Eastern date; the page's state is cosmetic and Zeffy's sales window is the control; copy bans scarcity, donation and tax words. **DECISION-121 (proposed, if Phase 3 adopts it):** the preview prototype is retired and redirected when the production page ships (supersedes DECISION-118's "keep or delete" clause).
- Proposed backlog text for the orchestrator: re-scope or close **B-168** (memory book -> frame plus collage); add a B-167 item "unpublish one portrait; collage page noindex; CSV hygiene; retention"; add a small item "privacy policy paragraph for the workshop (Zeffy ticket data, child's first name, photographs)" if Phase 3 does not fold it in.

### Open questions / handoff notes
- Orchestrator: ask BF-1 in one line before Phase 2; run the Verify-First counts and paste them under a "Production facts (orchestrator, 2026-10-12)" heading directly beneath this section.
- Architect (Phase 2): rule on the facts source, the shared home for `easternDateString()`, retiring the preview (and its `santas-workshop.css`/font move), and whether the `/santas-workshop/preview/**` redirect lives in `next.config.ts`.
- Tech-lead (Phase 3): the consistency checklist, the state function and its boundary tests, the list of exports that die from `event-facts.ts`, the art-optional rendering rule, the inline-versus-full-screen decision for phones, and whether the privacy paragraph is in this increment.
- The prototype's working-tree edits (`art-slots.ts`, `landing-sections.tsx`, `landing-state.ts` modified, uncommitted) belong to a concurrent change; confirm with the orchestrator before Phase 4 touches or deletes those files.

---

## Production facts (orchestrator, 2026-10-12)

Read-only counts via `PROD_DATABASE_URL` (no personal data read):

| Query | Count |
|-------|-------|
| `events` rows whose title contains "santa" or "workshop" | 0 |
| `events` rows starting 2026-12-18 to 2026-12-20 | 0 |
| `campaigns` rows whose title contains "santa" or "workshop" | 0 |

So the events rows are created fresh in `/admin/events` (no collision, no existing row to edit), and no `/donate` card exists for the workshop (correct: ticket, not donation).

## Blocking fact resolved (orchestrator, 2026-10-12)

**Zeffy custom questions do repeat per ticket.** Zeffy's ticketing forms offer "per attendee" questions, asked once for every ticket in an order (an order with 3 tickets yields 3 answers to the same question), printed on each e-ticket and included in the payments report, as opposed to "buyer" questions asked once per order. Sources: Zeffy support, "Obtain all event attendee names when multiple tickets are purchased" (support.zeffy.com/…-qjy33) and "Custom questions and custom contact fields" (support.zeffy.com/…-9ai9s). So the form is **one order, one ticket per stuffy, per-attendee questions for the stuffy fields** (stuffy name, what it is, snack choice, note to Santa, photo consent) and buyer questions for the parent fields (mobile, drop-off window, loss-or-damage acknowledgment). Increment 2's CSV import maps one payments-report row per ticket to one stuffy. The user still builds the form and runs one test order to confirm the export's column shape (that part of Q9 remains a build-time check).

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-10-12 · **Covers:** this increment, reviewed together with increment 2 (`2026-10-12-santas-workshop-sessions-and-workers.md`) so the shared data model is not painted into a corner. Inputs read: both work-logs, the spec, DECISION-094/095/118/119, the prototype (`src/app/santas-workshop/preview/`, `src/components/santas-workshop/`), the White Cane page and `campaign-state.ts`, `src/proxy.ts`, `next.config.ts` (headers, redirects, CSP), `sitemap.ts`, `zeffy-url.ts`, and the Next 16 `headers` doc in `node_modules/next/dist/docs/`.

## Verdict

**Approved with suggestions.** The facts-seam ruling does not change this increment's shape: it stays a DB-free, statically generated page like White Cane. Phase 1 does not need to re-answer anything. Increment 2's storage and ingestion changes (Google Drive for photos, Zeffy webhook for registrants, see its Phase 2) do not touch this increment's code. They add three copy implications below.

## Ruling 1 — the facts seam: the page reads a code module now (Option A); no table in this increment

**Pick: Option A.** The page reads `WORKSHOP_2026` through a typed seam. No `santas_workshop_sessions` table ships in increment 1.

| | A. Code module now | B. Minimal sessions table in increment 1 |
|---|---|---|
| Migration cost in this increment | none: no schema, no migration, no new env var | one table, `schema.ts` entry, one idempotent migration, a seed for the 2026 row |
| Migration cost later | none required. Increment 2 may switch the loader body (optional, see below) | none, but only if increment 2's design happens to match the guessed columns |
| Launch-day risk | none: the page cannot be broken by a database outage or an admin edit (DECISION-119 reasoning) | page inherits database availability and needs a "which session is public" rule before increment 2 has designed sessions |
| Editing a fact on Nov 7 | edit one module, deploy (reviewable in git) | no admin UI exists until increment 2, so editing means a new migration. A replayed `UPDATE` migration would also **clobber later admin edits**, because migrations re-run on every deploy |
| Collision with increment 2 | none | increment 1 would need a migration, so it joins the worktree and Neon-branch regime and the migration-number race |
| Schema-drift risk | none | columns guessed now are renamed in increment 2 under `drizzle-kit push --force`, which can drop data on a rename |

Option B's one real advantage is a single source of truth for the windows. That is a valid concern (Gap 1 in the Phase 1 write-up), and Option A handles it with a seam rather than a table:

1. `src/lib/santas-workshop/facts.ts` is pure and client-safe. It exports the `WorkshopFacts` type (slug, title, host, price, dates, `registrationOpens`, `signupsClose`, `windows[]` with id/label/start/end, pickup window, place, `zeffyShareUrl`, beneficiaries sentence, `manualStop`) and the `WORKSHOP_2026` constant. **Facts are data. Prose stays in components.** The form-question list does not live in code at all (Zeffy owns the form).
2. `src/lib/santas-workshop/state.ts` exports `workshopState(now, facts)`. It is pure, takes the facts as an argument, and returns `before | open | closed | after`, with the manual stop as an explicit input.
3. `src/lib/santas-workshop/public-facts.ts` exports `getPublicWorkshopFacts(): Promise<WorkshopFacts>`. It is `async` from day one and today returns the constant. The page awaits it, so a later swap changes one function body and no page code.
4. **Increment 2 decides whether to flip the loader to the session row. My recommendation is not to flip it in year one.** The page's DB-free property is worth more on a launch weekend than "no deploy to change a date" is worth in year one. Instead, increment 2's "New session" form pre-fills from `WORKSHOP_2026`, so the 2026 windows are authored once in code and copied once into the real session. The window-label join in increment 2 (an unmapped label is flagged, never dropped) is the drift alarm. If increment 2 does flip, its Phase 3 must satisfy all of these: a partial unique index allowing exactly one public *real* session, a fallback to the constant on no row or a database error, and a test that the seeded row maps to `WORKSHOP_2026`.

`easternDateString()` moves from `src/components/white-cane/campaign-state.ts` to a new flat `src/lib/eastern-date.ts` (checked: no Eastern-date helper exists in `format-date.ts`). White Cane's import and its test change in the same diff. This page is the second caller; moving now avoids a third copy. Compare full Eastern `YYYY-MM-DD` strings including the year (White Cane compares month-day only because it repeats yearly; this event does not).

## Ruling 2 — placement (increment 1 portion; the full tree is in increment 2's Phase 2)

```
src/app/santas-workshop/layout.tsx      fonts + CSS only; NO robots, NO canonical (nested layouts and token pages set noindex, and metadata merges shallowly)
src/app/santas-workshop/page.tsx        Server Component, revalidate = 300; no auth(), no @/lib/db, no searchParams, no fetch
src/lib/santas-workshop/                folder (facts, state, public-facts now; many more in increment 2). Precedent: club-file-storage/, receipt-storage/, auth/, db/
src/lib/eastern-date.ts                 shared helper, flat
src/components/santas-workshop/         production public components only
```

- **Server vs Client.** The whole page is a Server Component, as White Cane is, including the plain `<iframe>` form panel with a visible "open in a new tab" link and a `<noscript>` link. `'use client'` is permitted only for purely decorative behaviour (`in-view.tsx`). Recommendation: drop it for v1 so the page ships zero client JS of its own.
- **Iframe.** Use the White Cane plain-iframe precedent. **Do not extend `ZeffyEmbed`** (its title says "Donation", its button says "Donate Now"). Title: "Sign-up form for A Visit to Santa's Workshop, powered by Zeffy". `toEmbedUrl()` stays where it is in this increment (it is a shared pure function; moving it is increment 2's tidy-up, see its Phase 2). The page renders the Zeffy URL only in `open`.
- **Redirects in `next.config.ts`**, both `permanent: false` (307), per DECISION-119's reasoning: `/santasworkshop` → `/santas-workshop?utm_source=poster&utm_medium=qr&utm_campaign=santasworkshop2026`, and `/santas-workshop/preview/:path*` → `/santas-workshop`. Config, not route files. Whether Next applies config redirects before `src/proxy.ts` is *believed, unmeasured* for this path, though the proxy matches nothing under `/santas-workshop` either way, so ordering cannot matter. QA records the 307 on the deployed URL.
- **Sitemap:** one static line next to `/white-cane`. `robots.ts` untouched.
- **Proxy:** no change. `/santas-workshop/**` falls through `src/proxy.ts` (only `/admin` and `/members` are protected).
- **Retire the preview (Gap 23, option c): agreed.** Delete `src/app/santas-workshop/preview/**` and every prototype-only component. Keep nothing that exists only to demo a flow. The surviving production components move or are rewritten under `src/components/santas-workshop/`. Dies with the preview: `sample-data*`, `follow-demo`, `memory-book`, `delivery-switch`, `preview-state`, `prototype-shell`, `phone-frame`, `screens`, `flow-footer`, `pinned-reserve`, `check-in*`, `photo-station`, `journey*`, `conductor-list`, `zeffy-form-card` (client and prototype-bound; rewrite as a server component), and the prototype `event-facts.ts` exports `SPOT_CAP`, `MAX_PER_ORDER`, `FORM_QUESTIONS`, `SCENES`, `EVENT_DATES`. The check-in and photo-station screens remain in git history for increment 2's UX reference.
- **Working-tree caution.** `git status` shows uncommitted edits to `art-slots.ts`, `landing-sections.tsx`, `landing-state.ts` and the spec. Phase 4 must not delete or move those files until the orchestrator has committed or discarded them.
- **Tests.** `preview-unlisted.test.ts` is rewritten, not deleted: the "page does not exist", "sitemap lacks santas-workshop" and "noindex" assertions invert or go away. Add the production pins from Phase 1's acceptance list: no `searchParams`/`auth(`/`@/lib/db`/`sendEmail`/`fetch(`/`dangerouslySetInnerHTML`/`window.confirm|alert|prompt` in the page, a banned-word scan (Phase 1 A6), the boundary-instant tests for `workshopState`, and the Zeffy host pin (`www.zeffy.com`, path `/embed/`).

## Ruling 3 — dependencies for this increment

**None.** No `package.json` change. (The orchestrator bumps the version at release.)

## Ruling 5 — invariants touched by this increment

- **Permissions:** none; the page is public and calls no `auth()`.
- **Email:** nothing in this increment sends mail (confirmed against Phase 1's out-of-scope list); Phase 5 greps the diff.
- **No raw HTML:** copy comes from components and the facts module as text. The events-row description is Markdown through the existing `MarkdownContent`.
- **No personal data in the repo:** the only person in the facts is none. The beneficiaries sentence names organizations. No contact details appear in the page, only a club-domain address or `/contact`.
- **Art:** `public/images/santas-workshop/` is non-personal artwork only. An absent slot renders nothing (Gap 12); the page must launch with zero art.
- **Zeffy window is the control** (A2): the page state is cosmetic; the user must set Zeffy's sales start and end to the same Eastern instants.

## Copy implications from increment 2 (Phase 3 and the user, not a code change here)

1. The "For this event" privacy block and `/privacy` paragraph should name the processors truthfully: Zeffy (payment and ticket answers), the club's **Google Workspace** (where photos are stored), and the retail photo service (frames). Phrase photo storage in the future tense, since photos exist only from Dec 19. If the storage decision changes, it is one string in the facts module.
2. **Removal wording.** Photos live in Google Drive, so "removed" means deleted from Drive and unpublished from the collage. Whether Workspace retention or Vault copies persist is *believed, unmeasured*; phrase the promise as "we will take it down", not "erased everywhere".
3. A live "N stuffies registered" count is **not recommended** for the public page: it would add a database read and a live dependency to a page whose launch-day strength is having neither, and Phase 1's copy rules ban counters. If the board wants it later, it must degrade to nothing on any failure and must not turn this page dynamic.

## Ruling 6 — concurrency (increment 1 side)

Increment 1 has no migration, no dependency change and no schema, so it runs on the main tree. Recommended order: Phase 4/5 first, and **push early** (target before Oct 31) so the QR and poster target is verified live well before Nov 8. Increment 2's Phase 3 runs in parallel (read-only); its Phase 4 runs in a worktree (see increment 2).

## Notes for Phase 3

- Name which `WorkshopFacts` fields increment 2's session form will pre-fill from.
- Specify art-optional rendering per slot.
- Decide the phone presentation of the form: inline iframe versus new-tab-first.
- Keep `getPublicWorkshopFacts()` async even though it returns a constant.
- The Zeffy per-ticket questions fact (BF-1) is doubly resolved: Zeffy's `Item.questions[]` carries per-ticket answers (see increment 2). The form build sheet in Phase 1 stands. **Question wording is a contract with increment 2's mapper**: once the first real test purchase exists, question text is only changed with a mapper update.
- Migration-number note: this increment adds none.

## Phase 2 handoff

### Summary
Verdict **Approved with suggestions.** The page reads a typed code module through an async loader (Option A); no table, no dependency, no migration. The prototype is retired with 307 redirects. The one structural change is moving `easternDateString()` to `src/lib/eastern-date.ts`.

### What I did
- Ruled the facts seam and its migration costs; ruled placement, server/client split, redirects, preview retirement, test changes; confirmed no dependency, permission, email or schema impact.

### Outputs
- This section and the Per-Phase Status row. No code, no `docs/decisions.md` or backlog edit, nothing committed.
- **Proposed DECISION-120 (tech-lead files it):** the sign-up page is public, DB-free and statically generated; facts come from a typed `WorkshopFacts` read through an async loader (the module today, optionally the session row later); state is computed server-side from the Eastern date by one pure function; the page state is cosmetic and Zeffy's sales window is the control; the prototype is retired with 307 redirects, superseding DECISION-118's "keep or delete" clause.

### Open questions / handoff notes
- Orchestrator: commit or discard the prototype working-tree edits before Phase 4. Ask the user for the Zeffy sales window to equal the page window to the minute.
- Privacy copy depends on increment 2's storage ruling (Google Drive); confirm with the user before the page text is frozen.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-10-12 · **Inputs read:** this work-log (Phase 1, production facts, BF-1 resolution, Phase 2), the increment 2 work-log (Rulings 1, 2, 7 and its Phase 3 notes), `docs/features/santas-workshop.md`, DECISION-118/119, the prototype (`src/app/santas-workshop/preview/**`, `src/components/santas-workshop/**`, their tests, `e2e/santas-workshop-preview.spec.ts`), the White Cane precedent (`src/app/white-cane/page.tsx`, `src/components/white-cane/*`, `src/white-cane-redirect.test.ts`, `e2e/white-cane.spec.ts`, `campaigns/zeffy-url.ts`), `next.config.ts` (redirects, CSP, Permissions-Policy), `src/app/sitemap.ts`, `src/app/privacy/page.tsx`, `src/app/events/[id]/page.tsx`, `vitest.config.ts`.

## Technical Design: Santa's Workshop sign-up page (B-166, increment 1)

### Rulings that differ from Phase 1/2 (read first)

Each row is a deliberate change; the implementer follows this column, not the earlier phase.

| # | Earlier text | Ruling | Why |
|---|---|---|---|
| R1 | Phase 1: "`workshopState(now, facts)` with an explicit manual-stop input". Phase 2: a `manualStop` field. | **No `manualStop` field.** The manual close is editing `lastSignupDay` to yesterday's date and deploying (the brief's "a date in the facts constant"). | A boolean and a date would be two ways to say one thing, and a stale `manualStop: true` could survive into next year. A date in the past closes the page on the next render with no second concept. |
| R2 | Phase 2 field name `signupsClose`. | Renamed **`lastSignupDay`**, an Eastern `YYYY-MM-DD`, **inclusive**. | "Close" reads as an instant; the chair's default is "end of Wed Dec 16", which is the whole of Dec 16. |
| R3 | Phase 1 Flow 4 and Gap list: contact via `/contact`. | Link **`/connect`** and the club-domain address `info@westervillelions.org`. | `next.config.ts` 308s `/contact` to `/connect`; White Cane links `/connect`. One hop saved, no behavior change. |
| R4 | Phase 2: vanity redirect to `?...utm_campaign=santasworkshop2026`. | **`utm_campaign=santasworkshop`** (no year), three tags only: `utm_source=poster&utm_medium=qr&utm_campaign=santasworkshop`. | White Cane dropped the year in v1.92.0 for the same reason: the printed code outlives the year (DECISION-119 item 1). |
| R5 | Phase 1 Gap 5 helper text: "goes only on your own frame and family page". | Reads **"only on your own printed frame"** (final strings in Appendix A). | The family page is increment 2's and not guaranteed. The page must not promise a thing the first ship cannot produce (Phase 1 Gap 10 principle). The frame is decided (spec §3 item 5). |
| R6 | Brief: "`ZeffyEmbed` iframe title parameterised". Phase 2: do not extend `ZeffyEmbed`. | **Phase 2 stands. `ZeffyEmbed` is not touched.** This page uses a plain inline iframe with its own title constant (`SIGNUP_FRAME_TITLE`), pinned by a unit test that also bans "Donation" in it. | The page never renders `ZeffyEmbed`, so parameterising it would be dead code in this increment and would reopen `/donate`. If a modal ticket embed is ever wanted, add a `title` prop then. |
| R7 | Phase 1: "Phase 3 chooses inline vs full-screen on phones". | **Inline iframe at every width plus a prominent, always-visible "open in a new tab" button** (the likelier path to work on an iPhone). A **pre-decided, CSS-only fallback**: if either real-device pass (live check L4) fails, hide the inline frame below `md` and keep the button; no redesign. | Keeps the page zero-JS and one layout; the fallback is one class change, so Phase 5 does not loop back to Phase 3. |
| R8 | Phase 1 Flow 8 "opens the page at each state using the test clock (not the URL)". | A **development-only server clock override**, env `SANTAS_WORKSHOP_NOW` (a full ISO instant), read by `clock.ts` only when `NODE_ENV !== "production"`. Never a URL parameter. | QA and the chair need to see `closed` and `after` before December. Under ~40 lines, no schema, no API, so absorbed here. Needs one line in CLAUDE.md's env list (see Documentation edits; I did not edit CLAUDE.md). |
| R9 | Phase 1: "the page links to `/events` ... do not hard-code the production event UUID". | Confirmed. The page links to **`/events`** (the list); the two events rows link back to the page with an absolute URL. No database read on the page. | A UUID would not exist in dev or test and drifts. |
| R10 | Phase 1 acceptance 6 and the brief: a `collage` link in `after` "only when increment 2 has published one". | One more facts field, **`collagePath: string \| null`** (default `null`). `after` renders a link only when it is set; validation requires the prefix `/santas-workshop/c/`. | Gives increment 2 (or the user, by one edit) a way to turn the link on without a new page version, and gives the "no link, no promise" default a test. |
| R11 | Phase 1: "up to 5 minutes" lag at each boundary. | **Believed, unmeasured, and probably wrong in one respect:** with time-based ISR the first request after expiry is likely served stale and triggers regeneration, so the first visitor after midnight Nov 8 may still see `before`. Pre-decided fallback: add `export const dynamic = "force-dynamic"` to `page.tsx` (the page reads no database, so it stays outage-proof). Measured by live check L2 before launch, not on launch night. | Rule (a): the claim carries a label and a check. The brief names `revalidate = 300`, so it ships as the default. |
| R12 | Phase 1 resolution for Gap 4 and Phase 1 Q-C list. | All Q-C and Q-P defaults are **adopted as the shipped strings**. Each is tabulated in Appendix F with the single place it lives, so a chair answer is one edit and one deploy. Nothing in Phase 4 waits on a chair answer. Copy freeze: **Sun Nov 1**. | The chair's open answers change words, not structure. |
| R13 | Header: DECISION-120 to 124 reserved. Increment 2 proposes 121 (worker credential), 122, 123, 124. | **This increment files DECISION-120 only** and releases 121 to 124 to increment 2. The analyst's "121 (retire the preview)" is folded into 120 as an item that amends DECISION-118. | Avoids a number collision. Increment 2's Phase 1 text still says "proposed DECISION-120" for the worker code; that is stale (its Phase 2 renumbered it 121). |
| R14 | Phase 1: `pinned-reserve.tsx` "recommend drop"; Phase 2: drop `in-view`. | **Both dropped.** The train drawing stays as a static inline SVG (the prototype's CSS already renders a static final state by default). The page ships **no `"use client"` file**. | Prototype QA defect D1 lived in the pinned bar. Zero client JS of its own is a stronger launch-day property than a scroll flourish. |
| R15 | Phase 1: a fifth effective state for "open but the Zeffy link is still empty". | Not a fifth state. `state` stays one of four; the body derives **`signupAvailable = state === "open" && zeffyShareUrl !== ""`**. In `open` with no URL the signup section shows a plain "The sign-up form is not ready yet" notice and no button. | On Nov 8 a missing paste must read as honest, not as a dead button. It also lets the page ship in October with an empty URL (the form is gated behind increment 2's go-live checklist). |

### Summary

A public, database-free, statically generated page at `/santas-workshop` that replaces the 404 DECISION-118 reserved. Its facts are one typed constant (`WORKSHOP_2026`) read through an async loader; its state (`before | open | closed | after`) is a pure function of the Eastern calendar date; it embeds the Zeffy ticket form inline only while open, with a visible new-tab link; and its copy is held in one pure module that tests scan for banned words (donation, tax, scarcity, "memory book", and the rest). The old prototype is deleted and `/santas-workshop/preview/**` 307s to the real page; `/santasworkshop` 307s to it with UTM tags for the poster QR. `/privacy` gains a section for the data this event collects. Nothing here reads or writes the database (the sitemap already does), sends mail, or needs a migration or a dependency. **Hard dates:** live in `before` state by **Oct 31** (target push Oct 24 to Oct 27), Zeffy URL pasted and deployed by **Nov 6**, open at 12:00 AM Eastern **Sun Nov 8**.

### Permissions

None. No `FEATURES` key, no `auth()` call, no role binding. The page is identical for anonymous, signed-in and `/access-pending` visitors. The two events rows use the existing `events.create` / `events.edit` through `/admin/events`. `src/proxy.ts` is unchanged (it protects only `/admin` and `/members`).

### API Contract

**No API routes and no server actions.** The contracts in this increment are:

1. **Facts and state carriers (client-safe, pure).**
   - `src/lib/santas-workshop/facts.ts` exports the `WorkshopFacts` type, `DropoffWindow`, `WORKSHOP_2026` and `validateWorkshopFacts(facts): string[]` (returns problems; empty = valid).
   - `src/lib/santas-workshop/state.ts` exports `WORKSHOP_STATES` (`["before","open","closed","after"] as const`), `WorkshopState`, `FocusDay`, `workshopState(now, facts)` and `focusDay(now, facts)`. **The UI imports `WorkshopState` and switches over it with a `never` exhaustiveness check**, so adding or removing a state breaks `tsc` (precedent: `ledger-correction.ts`).
   - `src/lib/santas-workshop/public-facts.ts` exports `getPublicWorkshopFacts(): Promise<WorkshopFacts>`.
   - `src/lib/santas-workshop/clock.ts` exports `workshopNow(env, real): Date`.
   - `src/lib/santas-workshop/format.ts` exports the slice-based date and time formatters (moved from the prototype's `event-facts.ts`).
   - `src/lib/eastern-date.ts` exports `easternDateString(now: Date): string` (moved from `campaign-state.ts`, body unchanged).
2. **Two redirect rules in `next.config.ts`**, both `permanent: false` (HTTP 307):
   - `/santasworkshop` → `/santas-workshop?utm_source=poster&utm_medium=qr&utm_campaign=santasworkshop`
   - `/santas-workshop/preview/:path*` → `/santas-workshop` (no query forwarded; `:path*` is expected to match the bare `/santas-workshop/preview` too, *believed, unmeasured*, live check L3 requests it)
3. **Page head contract** (static `export const metadata`, never `generateMetadata`, so it cannot depend on state): title `A Visit to Santa's Workshop` (the root layout appends the club name, as on White Cane), canonical `https://westervillelions.org/santas-workshop`, no `robots` key, Open Graph and Twitter blocks built from the strings in `copy.ts`, image `https://westervillelions.org/images/santas-workshop/og.jpg` when that file is supplied and `https://westervillelions.org/images/og-default.jpg` (verified 1200x630) otherwise. **No JSON-LD** (the public events rows already emit `Event` markup on `/events/[id]`; two Event entities for one event would be a search-quality bug).

### The `WorkshopFacts` module (shape and values)

Facts are data; prose lives in `copy.ts` and the components. The only sentences allowed in facts are the three that someone outside the build must approve (beneficiaries) or that restate a date.

```ts
// src/lib/santas-workshop/facts.ts  (pure, no imports)
export interface DropoffWindow { id: string; start: string; end: string }   // "HH:mm" 24h; label is DERIVED, never stored
export interface WorkshopFacts {
  title: string;                       // "A Visit to Santa's Workshop"
  host: string;                        // "Westerville Lions Club"
  priceDollars: number;                // 15
  dates: { dropoff: string; photos: string; pickup: string };  // "2026-12-18" | "2026-12-19" | "2026-12-20"
  registrationOpens: string;           // "2026-11-08": open from 00:00 Eastern
  lastSignupDay: string;               // "2026-12-16": last Eastern day sign-ups are open, inclusive. THE manual-stop lever (R1)
  windows: readonly DropoffWindow[];   // fri-1600, fri-1700, fri-1800
  pickup: { start: string; end: string };                      // 13:00 to 15:00
  place: { name: string; town: string };                       // IHOP, Westerville (name and town only, Q-C8)
  zeffyShareUrl: string;               // "" until the form exists
  beneficiaries: { names: readonly string[]; sentence: string };  // treasurer-approved sentence (Q-P4)
  signupDataDeletedBy: string;         // "2027-01-31" (Q-P2 default)
  collagePath: string | null;          // null until increment 2 publishes (R10)
}
```

- **Derived, not stored:** the window labels (`formatTimeRange("16:00","17:00")` is `"4:00 to 5:00 PM"`), the date range ("Dec 18 to 20"), weekday names, the "Today" focus. A unit test pins the three window labels to literal strings because **they are a contract with the Zeffy dropdown and with increment 2's window join** (an unmapped label is flagged there, never dropped).
- **Exports that die from the prototype `event-facts.ts`:** `SPOT_CAP`, `MAX_PER_ORDER`, `SCENES`, `SceneDef`, `FORM_QUESTIONS`, `FormQuestion*`, `EVENT_DATES` (replaced by `dates`), `REGISTRATION_OPENS` (replaced by `registrationOpens`), `DROPOFF_WINDOWS` (replaced by `windows`), `PICKUP_WINDOW`, `DROPOFF_PLACE`, `PRICE_DOLLARS`, `EVENT_TITLE`, `HOST_NAME`, and the file itself. **Survivors, moved and unchanged in behavior:** `weekdayIndex`, `formatLongDate`, `formatShortDate`, `formatDateRange` (now takes the `dates` argument) into `format.ts`. The form-question list does not live in code at all (Zeffy owns the form).
- **Fields increment 2's "New session" form pre-fills** (copy once, then the session row owns them): `title`, `dates`, `windows`, `pickup`, `priceDollars`, `place`, `zeffyShareUrl` (as the form link), `registrationOpens`, `lastSignupDay`. Not pre-filled: `beneficiaries`, `signupDataDeletedBy` (retention is a session policy there) and `collagePath` (the session owns its collage token).
- **`validateWorkshopFacts` rules** (each is a named test): every date is a real `YYYY-MM-DD`; `dates` are Fri, Sat, Sun and consecutive; `registrationOpens <= lastSignupDay < dates.dropoff`; windows are non-empty, contiguous, non-overlapping and inside `00:00 to 23:59` with `start < end`; `pickup.start < pickup.end`; `priceDollars` is a positive integer; `zeffyShareUrl` is `""` or an `https://www.zeffy.com/` URL whose path is not `/donation-form/...` and that has no query string or fragment (a guard against pasting the White Cane link into a ticket page); `collagePath` is `null` or starts with `/santas-workshop/c/`; `signupDataDeletedBy > dates.pickup`; `beneficiaries.names` non-empty and every name appears in the sentence.
- **Values** (all "decided, chair, 2026-10-12" except as marked): title; host; price 15; dates 18/19/20; `registrationOpens` 2026-11-08; `lastSignupDay` 2026-12-16 *(default, Q-C5, pending the chair)*; windows 16:00 to 17:00, 17:00 to 18:00, 18:00 to 19:00 *(hourly split assumed, Q-C1)*; pickup 13:00 to 15:00 *(Q-C2)*; place IHOP, Westerville *(Q-C8)*; `zeffyShareUrl` `""`; beneficiaries Central Ohio Diabetes Association and Ohio Lions Pediatric Cancer Foundation with the sentence in Appendix A *(Q-P4)*; `signupDataDeletedBy` 2027-01-31 *(Q-P2)*; `collagePath` null.

### The loader seam

`getPublicWorkshopFacts()` is `async` from day one and returns `WORKSHOP_2026`. It does not validate at runtime (a thrown error on launch morning is worse than the constant the tests already guarantee). The page awaits it, so a later swap is one function body. Increment 2's recommendation (not to flip it in year one) and the three conditions if it does (one public real session by partial unique index, fallback to the constant on no row or a database error, a test that the seeded row maps to `WORKSHOP_2026`) are Phase 2 Ruling 1 and stand.

### State machine

Compare Eastern `YYYY-MM-DD` **strings including the year** (never `new Date(str)`, never a UTC comparison). Let `d = easternDateString(now)`:

1. `d > dates.pickup` → **after**
2. else `d > lastSignupDay` → **closed**
3. else `d < registrationOpens` → **before**
4. else → **open**

Order matters: an invalid config with `lastSignupDay < registrationOpens` degrades to `closed`, which is the safe direction (and `validateWorkshopFacts` rejects it in CI).

| State | From (Eastern) | Boundary instant (EST, UTC-5; DST ended Sun Nov 1) | Last second of the previous state |
|---|---|---|---|
| before | any day before Nov 8 | page deploys by Oct 31 | n/a |
| open | Sun Nov 8, 12:00 AM | `2026-11-08T05:00:00Z` | `2026-11-08T04:59:59Z` is `before` |
| closed | Thu Dec 17, 12:00 AM (the day after `lastSignupDay`) | `2026-12-17T05:00:00Z` | `2026-12-17T04:59:59Z` is `open` (Dec 16, 11:59:59 PM) |
| after | Mon Dec 21, 12:00 AM | `2026-12-21T05:00:00Z` | `2026-12-21T04:59:59Z` is `closed` (Dec 20, 11:59:59 PM) |

`focusDay(now, facts)` returns `"dropoff" | "photos" | "pickup" | null` when `d` equals that day (Fri Dec 18, Sat Dec 19, Sun Dec 20); the `closed` page uses it to put the day's block first with a "Today" label (Phase 1 Flow 5). Boundary instants: `2026-12-18T05:00:00Z`, `2026-12-19T05:00:00Z`, `2026-12-20T05:00:00Z`.

**Manual stop runbook** (Zeffy first because it is immediate and the page cannot see it): (1) end ticket sales in Zeffy; (2) set `lastSignupDay` in `facts.ts` to yesterday's date; (3) deploy. The closed copy is neutral ("Sign-ups for this year are closed. Thank you.") so it is true whichever lever fired first. Reopening is the same edit in reverse.

**Dev clock (R8).** `workshopNow(env, real)`: in production always `real`; otherwise, if `env.SANTAS_WORKSHOP_NOW` matches a strict ISO-8601 instant with `Z` or an offset (`Date.parse`, never a date-only string), return that instant, else `real`. `page.tsx` calls `workshopNow(process.env, new Date())`. QA runs one throwaway dev server per instant on its own port (not :3000; rule 2 of Concurrent Pipelines): `SANTAS_WORKSHOP_NOW=2026-11-08T05:00:00Z pnpm dev -p 3101`.

### Page composition (all Server Components; zero `"use client"`)

Sections by state (the body switches on `state` with a `never` check):

| Section (`id`) | before | open | closed | after |
|---|---|---|---|---|
| Hero (`h1`; fact tiles When / Cost / Where; status pill or CTA) | pill "Registration opens Sunday, Nov 8" | gold button "Sign up, $15 per stuffy" → `#signup` | pill "Sign-ups for this year are closed" | title "Thank you for riding with us", no tiles, no CTA |
| Static train (decor) | yes | yes | yes | yes |
| Sign up (`#signup`): price line, inline iframe, new-tab button, tip note, "form closed?" line, close date, `<noscript>` | — | **yes, first after the hero** | — | — |
| After you register (`#after-you-register`) | — | yes | **yes, first after the hero** | — |
| The story | yes | yes | — | — |
| The weekend (three day cards, `focusDay` first and tagged "Today" when set; link to `/events`) | yes | yes | yes | — |
| What to bring | yes | yes | yes | — |
| Good to know (FAQ `<details>`) | yes | yes | yes | — |
| Your privacy (`#privacy`) | yes | yes | yes | yes |
| Where the money goes (beneficiaries sentence) | yes | yes | yes | yes |
| Thank-you block (beneficiaries again is not repeated; optional collage link when `collagePath` is set; "We hope to see you again.") | — | — | — | yes |
| Questions (`/connect`, `info@`) and Presented by (About the club) | yes | yes | yes | yes |

- **`after` is a full page, not a blank**, with no sample imagery, no iframe, no form, no register button, and a collage link only when `collagePath` is set (Phase 1 Flow 6).
- **Headings:** exactly one `h1`; sections are `h2`; day cards and FAQ summaries may use `h3` but never skip a level.
- **Wrapper:** the page root carries `data-state={state}` and `data-testid="workshop-page"`; the signup section carries `data-testid="workshop-signup"`; the frame wrapper `data-testid="workshop-signup-frame"`. These are the e2e hooks and are not user-visible.
- **Signup section (open, `signupAvailable`):** the frame wrapper is `relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white h-[900px] sm:h-[820px]` (the White Cane precedent, 760 px, grows because this form has per-ticket questions); `<iframe title={SIGNUP_FRAME_TITLE} src={toEmbedUrl(facts.zeffyShareUrl)} loading="lazy" allow="payment" className="absolute inset-0 h-full w-full border-0">`. `toEmbedUrl` from `@/components/campaigns/zeffy-url` stays where it is (moving it is increment 2's tidy-up). Above the frame a **solid button** (`min-h-[44px]`, `rounded-lg`) "Open the sign-up form in a new tab" and below it a text link with the same destination, both `target="_blank" rel="noopener noreferrer"` and `href={facts.zeffyShareUrl}`. A `<noscript>` block repeats the link and says the form needs JavaScript. The Zeffy URL is rendered **only here** (A2).
- **Open without a URL:** the section shows the "not ready yet" notice (R15), a link to `/connect`, no iframe, no button, and no noscript link.
- **Zeffy form says it is closed:** one sentence under the frame, "If the form says sign-ups are closed, contact the club", with the `/connect` link.
- **Art (Gap 12):** `Art` renders **`null` when a slot is not in `SUPPLIED`** and the surrounding layout collapses (hero ends after the CTA; step cards drop the icon column; the story becomes one column; the OG image falls back to `og-default.jpg`). The prototype's dashed "Art slot" placeholders are deleted. Production slots and the artist brief are in Appendix E. A unit test fails if any `SUPPLIED` file is missing from `public/`.
- **Brand:** cards `rounded-2xl`, buttons `rounded-lg` (the status pill is a `rounded-lg` block, not `rounded-full`), `lions-blue`/`lions-gold`, focus ring on every interactive element, no `lions-red` token, tap targets at least 44 px. The prototype's visual design (QA'd for contrast, overflow at 360/390/768/1280, reduced motion) is kept; only its content and the removed components change.

### Zeffy ticket embed and the phone decision

See R6, R7, R15. The iframe's `allow="payment"` works today because the site `Permissions-Policy` already lists `payment=(self "https://www.zeffy.com")` and the CSP `frame-src` already allows `https://www.zeffy.com`; no header change. **Embed-URL conversion for a ticketing share link (`/ticketing/...` rather than `/donation-form/...`) through `toEmbedUrl` is believed correct, unmeasured (live check L5);** the unit test pins that the converted URL's host is exactly `www.zeffy.com` and its path starts `/embed/` for the share-link shapes we know. Because a missing or wrong embed degrades to the always-visible new-tab link, the page cannot be worse than "open the form in a tab".

### "After you register", and the lost-link backup

A standing section, present in `open` and `closed`, built from facts (Appendix A). It holds the Friday time and place, what to bring, snack, Saturday, Sunday pickup, and "No email within an hour? Check spam, then write to the club." **The lost-link backup in this increment is the name on the order:** "You do not need your receipt. At pickup give the name on the order and we will find your stuffy." The page never says "bring your confirmation", "show your ticket", "we will email you a link" or mentions a QR card, and there is **no public "find my registration" box** (Phase 1 A3/A5). The wording says "the name on the order", never "parent", because this is a courtesy check, not an identity check. The real backup (link in an email) is increment 2's.

### Copy and metadata rules (enforced by tests, not by review)

- All prose that more than one place prints, and every metadata string, is exported from `src/components/santas-workshop/copy.ts` (pure, no JSX). Component-local prose is allowed but is covered by the rendered-HTML scan below.
- **Banned in visible text, metadata, Open Graph text, the iframe title, `<noscript>`, and the events-row text in Appendix C** (case-insensitive; the scan is a table of `[pattern, reason]` in the test so a failure names the reason):
  `donat` (donation, donate), `\btax`, `deductible`, `\bgifts?\b`, `contribut`, `sold out`, `\blimited\b`, `\bspots?\b`, `\bfull\b`, `capacity`, `waitlist`, `hurry`, `last chance`, `filling fast`, `\bonly \d+ left`, `all proceeds`, `100\s*%`, `in partnership`, `\bbenefit`, `memory book`, `preschool`, `stuffed animal`, `\bproposed\b`, `conductor`, `\bstamp`, `train ticket`, `your confirmation`, `show your ticket`, `QR card`, `follow your stuffy`, `allergy|allergies|allergen-free`, `\bsafe(ly)?\b`. (`allergens` appears once, inside the required no-guarantee sentence, and is deliberately not matched: "allergen" is allowed only inside that sentence, which a separate test requires verbatim.)
- **Required, verbatim, tested for presence:** the promise "We photograph stuffies only, never the children."; the photo box label and helper (Appendix A); the snack no-guarantee sentence; the Zeffy tip sentence; the removal sentence; the iframe title.
- **Stray-date and stray-amount scan** over each state's rendered text: every `Mon D`-shaped date must be in the set derived from facts (opens, last sign-up day, the three event days, `signupDataDeletedBy`), and every `$` amount must be `$15` or `$0` (the tip sentence). This is what stops a hard-coded "Dec 12" or "$20" surviving in prose.
- **"Stuffy/stuffies" everywhere**, never "stuffed". **"Ticket" and "sign up"**, never "register for a spot".
- **Open Graph and metadata are state-independent** (static object; description names what, when, where and price only) so a crawler's cached card does not go stale on Nov 8.
- **Source scans on the page code** (A1, acceptance 7): no `searchParams`, `auth(`, `@/lib/db`, `sendEmail`, `fetch(`, `dangerouslySetInnerHTML`, `next/headers`, `cookies(`, `window.confirm|alert|prompt`, `console.log`, `"use client"` in `src/app/santas-workshop/**` (non-test) or the public components and lib files.

### Photo consent, snack and privacy wording

Final strings are in Appendix A (`copy.ts` constants, so the page, `/privacy` and the Zeffy form share one source). Rulings:

- **Photo box** (optional, unchecked by default, never presented as required): label *"Yes, you may show my stuffy's portrait in the public photo collage. Anyone with the collage link can see it. The collage shows stuffies, never children, and never a child's name."* Helper *"If you leave this unchecked, your stuffy's portrait goes only on your own printed frame. Your stuffy may still appear in group pictures with other stuffies."* (R5; the group-picture caveat is Q-P1, default accepted.)
- **Privacy promise** verbatim: *"We photograph stuffies only, never the children."* The operating rule that keeps it true on Friday (stuffy on the table, no hands or faces in frame, no volunteer phone photography of children, group pictures taken where no child can be in frame) belongs to the chair; Phase 6 cites it (Phase 1 Gap 6).
- **Snack preference** (required in Zeffy, never an allergy question): *"We will offer a snack at drop-off and pickup. This is a preference, not a medical request, and we cannot promise that any snack is free of allergens."* Options: Regular, Nut-free, Dairy-free, Gluten-free, No snack.
- **Where the data goes** is stated as: Zeffy takes the payment and keeps its own record; the club's volunteers see the answers; photos "will be kept in the club's own online storage"; frames "are printed at a photo printing service". This phrasing is true under either storage outcome of increment 2 and uses the future tense because photos exist only from Dec 19. If increment 2 names Google Workspace in public, it is one string in `copy.ts` (`PHOTO_STORAGE`).
- **Collage and removal:** "The collage stays online until next year's event, and sooner if you ask us to take your stuffy down. Changed your mind? Contact the club and we will take it down." This is a promise increment 2 must be able to keep (unpublish a single portrait before and after the Saturday batch publish); it is already in increment 2's handoff list.

### `/privacy` addition

In `src/app/privacy/page.tsx`: (1) one bullet in "What We Collect" and (2) one new `<section>` "A Visit to Santa's Workshop" placed after "How We Use It", under 30 lines, built from `copy.ts` constants and `getPublicWorkshopFacts()` (the deletion date) so the policy and the page cannot drift. (3) `EFFECTIVE_DATE` is set to the **day of the push** (the policy promises to update it). Draft in Appendix A. The page keeps `revalidate = 86400`.

### Retiring the preview and what happens to the DECISION-118 tests

- **Delete** `src/app/santas-workshop/preview/**` (all seven routes, `layout.tsx`, the CSS), and from `src/components/santas-workshop/`: `sample-data.ts` and its test, `follow-demo`, `memory-book`, `delivery-switch`, `preview-state`, `prototype-shell`, `phone-frame`, `screens.ts`, `flow-footer`, `screen-header`, `pinned-reserve`, `in-view`, `check-in.ts` and its test, `photo-station`, `journey*` and its test, `conductor-list`, `zeffy-form-card`, `landing-hero`, `landing-sections`, `landing-state` and its test, `event-facts`, `art-slot` (replaced), and `e2e/santas-workshop-preview.spec.ts`. The check-in and photo-station screens stay in git history as increment 2's UX reference (the chair has already reviewed them). Increment 2's worker screens live under `/santas-workshop/crew/`, so the preview redirect never collides with them.
- **Keep, moved:** the CSS to `src/app/santas-workshop/santas-workshop.css` (trim rules for deleted components: ticket stub, perforation, scroller, pinned bar); the Fraunces `next/font` setup to the new `layout.tsx`. **The new `layout.tsx` sets only the font variable and the stylesheet. It sets no `robots` and no `alternates`** (nested layouts and token pages set their own, and metadata merges shallowly: increment 2's collage and family pages are `noindex` under the same segment).
- **`preview-unlisted.test.ts` is rewritten, not deleted**, as `src/app/santas-workshop/public-page.test.ts` (names below). Of its six assertions: "layout is noindex" and "no preview page overrides robots" go away with the preview; "does not create a page at /santas-workshop" **inverts** (the page must exist); "is not in the sitemap" **inverts** (it must be listed once; `/santas-workshop/preview` and `/santasworkshop` must not be); "is not in the header or footer" **is not carried over** (the user has not decided on navigation; the test would pin a choice nobody made; revisit only if the user adds a nav link); "imports no db, auth or email" **is kept** and widened to the production files.
- **DECISION-118** keeps its status line plus "(items 1 to 4 amended by DECISION-120)". Its item 5 (state is never read from the URL) continues as a production property and is tested.

### The events rows

Two public rows, created by the user in `/admin/events` (existing audited path, not a migration; migrations replay in every environment and production data is not ours to seed), **after the Zeffy form and times are final and no earlier than the page going live**. Exact titles, wall-clock times (DECISION-005), location and Markdown descriptions are in Appendix C. `requiresRsvp = false` (an RSVP would imply a registration the site does not take). Saturday has no public row. Descriptions are state-independent ("Sign up ... at westervillelions.org/santas-workshop"), so they cannot go stale on Nov 8 or Dec 17. The page links to `/events`; each row's detail page already offers the `.ics` download. Production check (orchestrator, read-only, 2026-10-12): zero existing rows and zero `campaigns` rows, so these are fresh inserts and there is no `/donate` card.

### Redirects, sitemap, revalidate

- `next.config.ts` redirects: the two rules in the API Contract, placed beside `/whitecane`. Unit test `src/santas-workshop-redirect.test.ts` copies the precedent in `src/white-cane-redirect.test.ts` (imports `../next.config`, awaits `redirects()`). Whether Next applies config redirects before `src/proxy.ts` is *believed, unmeasured*; the proxy matches nothing under `/santas-workshop`, so the order cannot change the outcome (Phase 2 said the same).
- `src/app/sitemap.ts`: one static line beside `/white-cane`: `{ url: ".../santas-workshop", changeFrequency: "weekly", priority: 0.8 }`. `robots.ts` untouched.
- `export const revalidate = 300` on the page (R11 for the staleness caveat and fallback).
- **Printed QR rule:** do not print a QR for `/santasworkshop` until live check L3 has passed on the deployed URL.

### Component / Page Plan

- **Create (pure lib):** `src/lib/eastern-date.ts` (+ test), `src/lib/santas-workshop/{facts,format,state,clock,public-facts}.ts` (+ tests).
- **Create (app):** `src/app/santas-workshop/{layout.tsx,page.tsx,santas-workshop.css}`.
- **Create (components, `src/components/santas-workshop/`):** `copy.ts`, `workshop-page.tsx` (composition and the exhaustive switch), `hero.tsx`, `signup-section.tsx` (frame, buttons, noscript, not-ready notice), `sections.tsx` (Story, Weekend, AfterYouRegister, WhatToBring, Faq, YourPrivacy, WhereTheMoneyGoes, ThankYou, Questions, PresentedBy), `art.tsx`, `art-slots.ts` (rewritten, production slots only), `train-motif.tsx` (static; adapted from the prototype).
- **Create (tests and e2e):** the lists below.
- **Modify:** `src/components/white-cane/campaign-state.ts` (import `easternDateString` from `@/lib/eastern-date`, delete the local definition) and `campaign-state.test.ts` (drop the moved `easternDateString` describe, keep every `campaignState` and source-scan test unchanged: they prove the move changed nothing); `next.config.ts`; `src/app/sitemap.ts`; `src/app/privacy/page.tsx`.
- **Delete:** the list under "Retiring the preview".
- **Do not touch:** `src/components/campaigns/zeffy-embed.tsx`, `zeffy-url.ts`, `src/proxy.ts`, `robots.ts`, `package.json`, `drizzle/**`, `src/lib/db/schema.ts`, the header and footer.

### Tests the implementer must deliver (Phase 4 gate: all written and passing)

**Unit (Vitest, node environment; component tests use `renderToStaticMarkup` as `admin-sidebar.test.tsx` does):**

`src/lib/eastern-date.test.ts`
- `uses the Eastern calendar day, not the UTC day` (the two cases moved from White Cane)
- `rolls over at 05:00Z in EST: 2026-11-08T04:59:59Z is Nov 7 and 05:00:00Z is Nov 8`
- `still reads Oct 31 at 03:59Z on Nov 1 (EDT)`
- `never passes a string to new Date() in eastern-date.ts` (source scan)

`src/lib/santas-workshop/state.test.ts`
- `is before at 2026-11-08T04:59:59Z and open at 2026-11-08T05:00:00Z`
- `is open at 2026-12-17T04:59:59Z (11:59:59 PM Dec 16 Eastern, UTC date already Dec 17) and closed at 05:00:00Z`
- `is closed at 2026-12-21T04:59:59Z and after at 2026-12-21T05:00:00Z`
- `is before in October and after in 2027`
- `a lastSignupDay of yesterday closes the page at once (manual stop)` and `a lastSignupDay later than today reopens it`
- `an invalid lastSignupDay before registrationOpens degrades to closed, never open`
- `WORKSHOP_STATES is exactly before, open, closed, after in that order`
- `focusDay is dropoff, photos, pickup on their Eastern days (boundaries 2026-12-18T05:00:00Z, -19, -20) and null on Dec 17 and Dec 21`
- `state.ts and format.ts never pass a string to new Date()` and `state.ts imports no db, auth, email or next module` (source scans)

`src/lib/santas-workshop/facts.test.ts`
- `WORKSHOP_2026 has no validation problems`
- `the event days are Friday, Saturday and Sunday, consecutive`
- `registration opens Sunday Nov 8 2026 and the price is 15`
- `the three windows tile 4:00 to 7:00 PM and print exactly "4:00 to 5:00 PM", "5:00 to 6:00 PM", "6:00 to 7:00 PM"` (Zeffy and mapper contract)
- `pickup prints "1:00 to 3:00 PM"` and `the date range prints "Dec 18 to 20"`
- `formatLongDate("2026-12-18") is "Friday, Dec 18" and formatShortDate is "Fri, Dec 18"`; `formatTimeRange prints the meridiem once when it matches and twice when it differs`
- table-driven `validateWorkshopFacts rejects: a malformed date, non-consecutive days, wrong weekdays, lastSignupDay before registrationOpens or on/after drop-off, overlapping or gapped windows, start not before end, a zero or fractional price, an http Zeffy URL, a non-zeffy host, a /donation-form/ path, a URL with a query string, a collagePath outside /santas-workshop/c/, a deletion date before pickup, a beneficiary name missing from the sentence`
- `accepts an empty zeffyShareUrl` (form not built yet)
- `toEmbedUrl on a ticketing share link, with and without the locale segment, yields host www.zeffy.com and a path starting /embed/` (the Zeffy host pin from Phase 1 A8)

`src/lib/santas-workshop/public-facts.test.ts`
- `getPublicWorkshopFacts resolves to WORKSHOP_2026` and `returns a Promise` (the seam is async)

`src/lib/santas-workshop/clock.test.ts`
- `returns real time in production even when SANTAS_WORKSHOP_NOW is set`
- `honors a strict ISO instant outside production`
- `ignores a date-only, empty or malformed override`

`src/components/santas-workshop/copy.test.ts`
- `no exported copy string contains a banned pattern` (walks every exported string, array and object value of `copy.ts` and of the `facts.ts` strings; failure names the pattern and its reason)
- `the promise is exactly "We photograph stuffies only, never the children."`
- `the photo box label and helper are exactly the decided wording and the helper names group pictures`
- `the snack sentence has the no-guarantee line and no allergy wording`
- `SIGNUP_FRAME_TITLE is "Sign-up form for A Visit to Santa's Workshop, powered by Zeffy" and does not contain "donation"` (the iframe-title pin, R6)
- `the tip note says optional tip and $0 and never gift or donation`
- `the metadata strings are state-independent: they contain no month name other than the facts-derived event dates and no opens/closed wording`

`src/components/santas-workshop/workshop-page.test.tsx` (each test loops the four states, with a test URL set and with it empty)
- `the Zeffy iframe renders only in open, and only when a URL is set`
- `the Zeffy URL string appears nowhere in before, closed or after HTML (links, noscript, attributes)`
- `open with an empty URL shows the not-ready notice and no iframe, no button, no noscript link`
- `the new-tab link has target _blank, rel noopener noreferrer and href equal to the share URL; a noscript block holds a link`
- `every state has exactly one h1 and never skips a heading level`
- `no banned pattern appears in the visible text of any state`
- `no date or dollar amount appears that is not derived from the facts ($15 and $0 only)`
- `after you register renders in open and closed and in no other state`
- `before shows "Registration opens Sunday, Nov 8" and no sign-up button`
- `closed says sign-ups are closed, offers contact, and never says full, sold out or capacity`
- `after has no img, iframe, form or register link; a collage link only when collagePath is set`
- `closed puts the focused day first and tags it Today`
- `renders with no art supplied: no "Art slot" or "Placeholder" text and no empty aspect-ratio box`
- `the root exposes data-state matching the state`

`src/components/santas-workshop/art-slots.test.ts` (rewritten)
- `ids are unique and paths are local to /images/santas-workshop/`; `aspect agrees with pixels within 1%`; `every non-decorative slot has alt text`; `every SUPPLIED slot has its file under public/`; `no dropped prototype slot id remains`

`src/app/santas-workshop/public-page.test.ts` (replaces `preview-unlisted.test.ts`; source scans)
- `page.tsx is a Server Component with revalidate = 300 and a static metadata export`
- `the page code has no searchParams, auth, db, email, fetch, next/headers, cookies, dangerouslySetInnerHTML, native dialogs, console.log or "use client"` (page, layout, public components, public lib files)
- `layout.tsx sets no robots and no alternates`
- `page.tsx metadata sets canonical https://westervillelions.org/santas-workshop and no robots key`
- `the preview directory is gone` and `no non-test source mentions SPOT_CAP, MAX_PER_ORDER, sample-data or the Prototype banner`
- `sitemap.ts lists /santas-workshop exactly once and never /santas-workshop/preview or /santasworkshop`
- `the page reads the clock only through workshopNow` (guards R8: no direct `process.env.SANTAS_WORKSHOP_NOW` elsewhere)

`src/santas-workshop-redirect.test.ts` (model: `src/white-cane-redirect.test.ts`)
- `/santasworkshop is a temporary redirect to /santas-workshop with exactly utm_source=poster, utm_medium=qr, utm_campaign=santasworkshop`
- `/santas-workshop/preview/:path* is a temporary redirect to /santas-workshop with no query`
- `neither rule is permanent`

`src/app/privacy/workshop-section.test.ts` (source scan)
- `the privacy page has a Santa's Workshop section and a collected-data bullet`
- `it imports its promise and photo sentences from copy.ts rather than retyping them`

`src/components/white-cane/campaign-state.test.ts` (modified)
- every existing `campaignState` and source-scan test passes unchanged (regression proof of the move)

**Playwright** `e2e/santas-workshop.spec.ts` (replaces `e2e/santas-workshop-preview.spec.ts`; it computes the expected state with `workshopState(new Date(process.env.SANTAS_WORKSHOP_NOW ?? Date.now()), WORKSHOP_2026)` so one file runs against the live clock or a clocked server on another port):
- `/santasworkshop is a 307 to /santas-workshop carrying exactly three UTM tags` (restart the dev server first; it reads `next.config.ts` at startup, as the White Cane spec notes)
- `/santas-workshop/preview and a deep preview path are 307s to /santas-workshop`
- `the page returns 200 with one h1, no skipped heading level, and no horizontal scroll at 360px`
- `data-state equals the expected state`
- `head carries canonical, Open Graph and Twitter tags, no noindex, and a title that names the club once`
- `the iframe exists only in open: title, src under https://www.zeffy.com/embed/, allow=payment; before, closed and after have no iframe and no zeffy.com in the HTML`
- `in open the new-tab link opens a new tab with noopener, and the server HTML has a noscript link`
- `before shows the opening date and no sign-up control`
- `closed and after show their full pages, not blanks`
- `never renders a query-string value into the page and ignores ?state= and ?now=` (A1)
- `the visible text and head description pass the banned-pattern scan`
- `sitemap.xml lists /santas-workshop`
- `/privacy has the Santa's Workshop section`
- `the first sign-up control is visible within a 390x844 viewport` (branches on state; open only)
- `no console error or CSP violation while the page loads` (dev server)

### Implementation Order

1. **Preconditions.** The orchestrator commits or hands over the uncommitted prototype edits (`art-slots.ts`, `landing-sections.tsx`, `landing-state.ts`, the spec); the implementer **keeps their "stuffy" wording** in every rewritten string and deletes none of those files until that is done. Re-derive nothing for migrations: **there is none**. Increment 2's Phase 4 runs in a worktree; this increment runs on the main tree.
2. **Shared helper.** `src/lib/eastern-date.ts` + test; update `campaign-state.ts` and its test; confirm White Cane's tests pass unchanged.
3. **Seam.** `facts.ts`, `format.ts`, `state.ts`, `clock.ts`, `public-facts.ts` with their tests. **Checkpoint:** `pnpm test` on these files green before any UI.
4. **Copy.** `copy.ts` and `copy.test.ts` (Appendix A is the source text).
5. **Art registry and `Art`**, then the components, `layout.tsx`, `page.tsx`, CSS move, `workshop-page.test.tsx`, `public-page.test.ts`.
6. **Plumbing.** `next.config.ts` redirects + `santas-workshop-redirect.test.ts`; sitemap line; privacy section + test.
7. **Retire the preview.** Delete the files listed, rewrite the e2e, grep that nothing imports a deleted module.
8. **Gates.** `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`; then `pnpm dev` and walk all four states with the dev clock; hand to qa. Nothing is committed (rule 1).
9. **Release notes** via `/release-notes` when preparing the push; the design's draft is below and carries no version number (rule (c)).

### Edge Cases & Risks

1. **Four copies of the facts drift** (page, events rows, Zeffy form, printed material): Appendix D is the checklist Phase 5 and Phase 6 walk; the page itself is covered by tests, the other three are typed by a human.
2. **Zeffy's sales window is the only control** on buying outside the page window (the share link is in a public repo and on Zeffy). The page does not render the URL in `before`, `closed` or `after`, but that is cosmetic. The user sets the Zeffy start to Sun Nov 8 12:00 AM Eastern and the end to Wed Dec 16 11:59 PM Eastern, and live check L1 records what Zeffy does at each edge.
3. **ISR staleness at the boundary** (R11): fallback is one line; measured before launch (L2).
4. **Empty URL on Nov 8** (R15): honest notice, no dead button; the URL deploy is scheduled for Nov 6 so this should not occur.
5. **Late edit to `facts.ts` on Nov 6 to 7** runs the full pre-push gates; if a gate fails for a concurrent reason (Concurrent Pipelines rule 3), the fallback is the not-ready notice, not a rushed bypass.
6. **iPhone Safari embedded checkout** (third-party storage, Apple Pay in an iframe): unknown until a real device runs it; the new-tab button is the designed escape and R7 pre-decides the fallback.
7. **Art not delivered:** the page is finished without it (Appendix E); fallback decision date Nov 1.
8. **Free text is Zeffy's, not ours:** nothing from a registrant reaches this page. Increment 2's mapper owns the hygiene list from Phase 1 (formula cells, HTML, length).
9. **Question wording is a contract with increment 2's mapper** (Phase 2): once the first test purchase exists, a changed question string needs a mapper update.
10. **The "photos go online that evening" sentence rests on increment 2.** It is a decided plan (spec decision 2), printed in the weekend plan; if increment 2 slips, the sentence must change in `copy.ts` first.
11. **Cross-increment layout reuse:** the new `layout.tsx` also wraps increment 2's crew, collage and family routes. It supplies only fonts and scoped CSS tokens; any route that needs `noindex` or another background sets it itself.
12. **No email, no database write, no durable "sent" claim** exists in this increment, so the DECISION-102/103 durable-claim exception does not apply; Phase 5 greps the diff to confirm.

### Out of Scope

Everything in Phase 1's Out of Scope list stands: follow-your-stuffy, tracking card, train ticket, memory book, a "notify me" capture, any admin edit of facts (increment 2's session model), waitlist, per-window capacity, counters, a header or footer link, a homepage banner, a `/thanks` page or post-payment redirect, logos, a map embed. Also out: JSON-LD on this page; `ZeffyEmbed` changes; moving `toEmbedUrl`; the Zeffy webhook and the CSV question (increment 2); editing CLAUDE.md (user approval needed, see below).

### Live checks for Phase 5 (rule (a): each records an observed rate for a claim that is believed, not measured)

| # | Claim | Check | Recorded by |
|---|---|---|---|
| L1 | Zeffy's sales window stops purchases outside Nov 8 to Dec 16 (the only control, accepted residual) | On the practice form, set sales to end in 10 minutes; after expiry, open the share link and try to reach payment; record n of n refused. Before the real start, open the real form's link and record what Zeffy shows. | orchestrator or user |
| L2 | Time-based ISR serves one stale page after expiry and then fresh | On the deployed page: `curl -sI` for `x-vercel-cache` and `age`; wait over 300 s; request three times; record the sequence (STALE then HIT expected). If the first visit after expiry is stale, apply the `force-dynamic` fallback (R11). | orchestrator, after the first deploy |
| L3 | Both 307s work on the deployed URL, including the bare `/santas-workshop/preview` | `curl -sI` each, record status and `location`. Print no QR before this passes. | orchestrator |
| L4 | The inline Zeffy frame loads and reaches payment on a real iPhone (Safari) and a real Android (Chrome) | Load the open state (a dev-clock server with the real share link in a local facts edit, or production after Nov 8); record frame loads, questions usable, payment step reached, Apple Pay sheet appears (yes/no each). Fail on either device triggers the R7 fallback. | user with a phone, orchestrator records |
| L5 | A `/ticketing/` share link converts to an embed URL that loads in a plain tab and in the iframe with no CSP violation | Paste the real share link into a local facts edit; load both; record the console. | qa or user |
| L6 | The Open Graph card renders (1200x630) and does not change with state | Fetch the head HTML at two clock instants and diff; run a link-preview debugger on the deployed URL. | qa |
| L7 | Launch-night state | Nov 8, 12:05 AM Eastern: load the page twice, record the state each time; confirm the form shows. | orchestrator |
| L8 | The events rows exist, are public, link back, and the `.ics` opens | After the user creates them: `/events` lists both, each detail page shows the right wall-clock time. | qa |

### Release-notes draft (no version number; `/release-notes` assigns one at ship time)

**Feature: A Visit to Santa's Workshop sign-up page.** Background: the club's Santa's Workshop weekend (drop off a stuffy Fri Dec 18, pick it up Sun Dec 20) now has its own page at `/santas-workshop`. Changes: the page shows the weekend plan, price and place, and tells families when sign-ups open (Sun Nov 8); from then until Dec 16 it holds the ticket form; afterward it shows how the weekend works and, after the event, a thank-you. A short address, `/santasworkshop`, forwards to it for printed posters. The old preview address now forwards to the real page. The privacy policy now explains what the event collects and how photos are handled. The page uses the word "ticket", never "donation".

### Documentation edits (not made; they need the user's approval because they change CLAUDE.md)

1. `CLAUDE.md` Project Structure line `santas-workshop/preview/ ... 404 until B-166` becomes a `santas-workshop/` line for the real page (DECISION-120).
2. The "Unlisted prototypes (DECISION-118)" bullet: change "The first is Santa's Workshop (`/santas-workshop/preview`, v1.91); the real page is B-166" to say the preview was retired by DECISION-120 and the pattern stays valid for future prototypes.
3. Add a "Santa's Workshop sign-up page" bullet beside the White Cane one (facts module, four states, Zeffy window is the control, banned-word tests).
4. Environment Variables: one line for `SANTAS_WORKSHOP_NOW` (development only, ignored in production).
5. **Stale "no Zeffy API" statements** (CLAUDE.md has none; the only ones are in `docs/features/santas-workshop.md` lines 139 and 185, and the matching spec §10 text). That file is not touched by this increment and carries the concurrent session's uncommitted edits, so **they are listed for increment 2's Phase 3 to correct** (it owns DECISION-123, the webhook ruling, and was told to update them when filing).
6. `docs/backlog.md` B-166 still says "Dec 11 to 13", "modal embed on phones" and "manual Full flip"; B-168 still says "memory book". Proposed replacement text for the orchestrator is in the handoff below.

---

## Appendix A — Copy deck (source text for `copy.ts`; dates, times and price are rendered from facts, shown here for reading)

Banned patterns do not occur in any string below; the tests prove it.

**Page head.** Title: `A Visit to Santa's Workshop`. Description (also Open Graph and Twitter): "Bring your favorite stuffy to meet Santa and Mrs. Claus. Drop off Friday, Dec 18 and pick up Sunday, Dec 20 at IHOP in Westerville. $15 per stuffy, from the Westerville Lions Club." Open Graph title: `A Visit to Santa's Workshop | Westerville Lions Club`.

**Hero.** Eyebrow: "Westerville Lions Club presents". Title: "A Visit to Santa's Workshop" (after: "Thank you for riding with us"). Lead (before, open): "Bring your favorite stuffy to meet Santa and Mrs. Claus. You drop it off on Friday, Dec 18, and pick it up on Sunday, Dec 20." Lead (closed): "Thank you for the warm welcome. Sign-ups for this year are closed. Here is how the weekend works." Lead (after): "The stuffies are home and Santa says thank you." Tiles: When "Dec 18 to 20"; Cost "$15 per stuffy"; Where "IHOP, Westerville". Status/CTA: before "Registration opens Sunday, Nov 8"; open "Sign up, $15 per stuffy"; closed "Sign-ups for this year are closed".

**Sign up (open).** H2 "Sign up for the weekend". "$15 per stuffy. Each ticket is for one stuffy: for two stuffies, buy two tickets and fill in the details for each." Button "Open the sign-up form in a new tab" (and text link below the frame). Under the frame: "If the form says sign-ups are closed, contact the club." Close line: "Sign-ups close Wednesday, Dec 16." Photos pointer: "Before you sign up, read how we handle photos under Your privacy." Tip note: "At checkout, Zeffy, the platform that processes tickets, offers an optional tip to itself. You can set it to $0 and your ticket is still $15." Not-ready notice: "The sign-up form is not ready yet. Please check back soon, or contact the club." Noscript: "The sign-up form needs JavaScript. Open it here in a browser that allows it, or contact the club."

**Story.** "Every December, a little train sets out for the North Pole. This year it has room for your child's favorite stuffy." / "On Friday evening you drop your stuffy off at IHOP. On Saturday it has its portrait taken with Santa and Mrs. Claus, along with a crowd of other stuffies. On Sunday you pick it up with a printed frame of its picture." / "It is a small way to make the season feel big, from your neighbors at the Westerville Lions Club."

**The weekend (three day cards).** Fri, Dec 18, "Drop off your stuffy": "Come to IHOP, Westerville, between 4:00 and 7:00 PM. When you sign up you pick one of three one-hour windows: 4:00 to 5:00 PM, 5:00 to 6:00 PM or 6:00 to 7:00 PM. Running late within those hours? Come anyway. We check your stuffy in with a quick photo." Sat, Dec 19, "Photo day": "Your stuffy has its portrait taken with Santa and Mrs. Claus and joins group pictures with other stuffies. You do not need to be there. The pictures go online that evening." Sun, Dec 20, "Pick up your stuffy": "Come to IHOP, Westerville, between 1:00 and 3:00 PM. Give the name on the order and we will find your stuffy. It comes home with a printed 4x6 frame of its portrait." Link: "See drop-off and pickup on the events calendar".

**After you register (open, closed).** "Zeffy emails your receipt to the address you gave. No email within an hour? Check your spam folder, then write to the club." / "Friday, Dec 18: drop off at IHOP, Westerville, in the window you chose, between 4:00 and 7:00 PM." / "Bring one stuffy for each ticket. You do not need to bring your receipt." / "Saturday, Dec 19: your stuffy has its portrait taken. You do not need to be there." / "Sunday, Dec 20, 1:00 to 3:00 PM: pick up at IHOP. Give the name on the order. Someone else can collect for you; they give the same name." / "Questions? Contact the club."

**What to bring.** "One stuffy for each ticket, clean and ready to travel." / "Nothing else. A receipt is handy but not required; we find you by the name on the order." / "Anything we should know, like a loose eye or a favorite night-light, goes in the care note on the sign-up form." Note: "Please leave behind any accessory that cannot be replaced. The Lions take great care, but cannot be responsible for loss or damage."

**Good to know.** (1) "How much does it cost?" "$15 per stuffy. Each ticket is for one stuffy." (2) "Who is it for?" "Made for young children and their favorite stuffy. Anyone is welcome to send a stuffy." (3) "How many stuffies can I send?" "As many as you like. Buy one ticket for each and fill in the details for each stuffy." (4) "What if I lose my receipt?" "You do not need it. Give the name on the order at pickup." (5) "What about snacks?" SNACK sentence below plus "Choices on the form are regular, nut-free, dairy-free, gluten-free or no snack." (6) "Will my stuffy's picture be online?" "Your stuffy's portrait appears in the public photo collage only if you say yes on the sign-up form. Group pictures show whoever is in them. The details are under Your privacy."

**Your privacy.** Promise (bold): "We photograph stuffies only, never the children." Asked: "When you sign up, Zeffy asks for your name, email and mobile number, your stuffy's name and what it is, and a snack preference. A child's first name, a care note and a note to Santa are optional." Use: "We use these only to run the weekend: to find your stuffy, to reach you about it, and to offer a snack. We never sell or rent them." Who: "Zeffy takes your payment and keeps its own record of your order. The club's volunteers see your answers. Photos will be kept in the club's own online storage, and frames are printed at a photo printing service." Photos: "On the form, one optional box reads: [PHOTO_BOX_LABEL]. [PHOTO_BOX_HELPER]" Keeping: "The collage stays online until next year's event, and sooner if you ask us to take your stuffy down. We delete sign-up details from the club's records by Jan 31, 2027." Removal: "Changed your mind? Contact the club and we will take it down." Link: "Read the privacy policy".

`PHOTO_BOX_LABEL`: "Yes, you may show my stuffy's portrait in the public photo collage. Anyone with the collage link can see it. The collage shows stuffies, never children, and never a child's name."
`PHOTO_BOX_HELPER`: "If you leave this unchecked, your stuffy's portrait goes only on your own printed frame. Your stuffy may still appear in group pictures with other stuffies."
`SNACK`: "We will offer a snack at drop-off and pickup. This is a preference, not a medical request, and we cannot promise that any snack is free of allergens."

**Where the money goes.** `beneficiaries.sentence`: "What is left after the cost of the event supports the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation." (names exactly as the chair gave them; no logos, no links; treasurer approves before Nov 8.)

**After.** "Thank you for riding with us." / lead above / beneficiaries sentence / (only if `collagePath`) "See the photos from the weekend" link / "We hope to see you again."

**Questions / presented by.** "Questions? Contact the club" (`/connect`, `info@westervillelions.org`). "Presented by the Westerville Lions Club. Neighbors serving Westerville since 1928." Links: About the club.

**`/privacy` bullet** (What We Collect): "**Santa's Workshop sign-ups:** collected for us by Zeffy: your name, email and mobile number, your stuffy's name and description, a snack preference and, if you choose to give them, a child's first name, a care note and a note to Santa."

**`/privacy` section** "A Visit to Santa's Workshop": (1) "We use sign-up details only to run the event: to find your stuffy, to reach you, and to offer a snack. Zeffy processes the payment and keeps its own record. The club's volunteers see your answers. We delete sign-up details from the club's records by Jan 31, 2027." (2) PROMISE. (3) PHOTO sentences (label and helper), the collage sentence and "We will keep the collage online until next year's event." (4) "To remove a photo or a detail, contact us at info@westervillelions.org and we will take it down." (5) link "Back to A Visit to Santa's Workshop".

## Appendix B — Zeffy form build sheet v2 (for the user; replaces Phase 1's table; BF-1 is resolved as per-ticket questions)

Create it on the **Club's** Zeffy account (not the Foundation's; the copy rule "ticket, never donation or tax-deductible" depends on it). **Question text below is a contract with increment 2's mapper: type it exactly; change it only with a mapper update after the first test purchase.**

| # | Question as the family reads it | Scope | Required | Limit | Helper text (verbatim) |
|---|---|---|---|---|---|
| form | Title "A Visit to Santa's Workshop"; ticket "Stuffy ticket", **$15**, no per-order cap (set the highest Zeffy allows; note the number); sales start **Sun Nov 8, 12:00 AM Eastern**, end **Wed Dec 16, 11:59 PM Eastern** (these two must equal `registrationOpens` and `lastSignupDay`) | | | | |
| form | Event date shown on the e-ticket: Fri Dec 18, 4:00 to 7:00 PM, IHOP, Westerville. Intro text and thank-you message: Appendix D rows 14 and 15 | | | | |
| B1 | Mobile phone | per buyer | Yes | 20 | "Only used to reach you about this event." |
| B2 | Friday drop-off window | per buyer | Yes | select | options exactly "4:00 to 5:00 PM", "5:00 to 6:00 PM", "6:00 to 7:00 PM"; helper "Pick the hour that suits you. If you run late within 4:00 to 7:00 PM, come anyway." |
| B3 | Loss or damage | per buyer | Yes (checkbox) | | "The Lions will take great care of your stuffy, but cannot be responsible for loss or damage." (final wording from the treasurer and insurer) |
| T1 | Stuffy's name | per ticket | Yes | 40 | "This is the name on the tag." |
| T2 | What is your stuffy? | per ticket | Yes | 60 | "Type and color, like \"brown bear, red scarf\". It helps us find it." |
| T3 | Child's first name | per ticket | No | 30 | "First name only. We never post it." |
| T4 | Snack preference | per ticket | Yes | select | options Regular, Nut-free, Dairy-free, Gluten-free, No snack; helper = `SNACK` sentence |
| T5 | Care note | per ticket | No | 200 | "Like \"one loose eye, sleeps with a night-light\". No medical details and no last names." |
| T6 | A note to Santa | per ticket | No | 200 | Keep only if someone will read it (Q-C9); otherwise drop the question |
| T7 | Photo box | per ticket | No (checkbox, **unchecked by default**) | | label = `PHOTO_BOX_LABEL`, helper = `PHOTO_BOX_HELPER`; if Zeffy has no helper line, put the helper directly after the label in the same field |

After building: (1) copy the form's **public share link** (not the embed or admin link) and give it to the orchestrator for `zeffyShareUrl`; (2) run the practice-form test purchase per increment 2's go-live checklist, flag it to the treasurer in advance, and refund it in Zeffy (never describe it as a donation); (3) read the export or webhook payload and confirm each question's text and scope came through as above; (4) only then is the URL pasted and deployed (target Nov 6). Zeffy shows its own optional tip to itself at checkout; the page says so (tip note).

## Appendix C — Events rows (created by the user in `/admin/events`; wall-clock times per DECISION-005)

| | Row 1 | Row 2 |
|---|---|---|
| Title | Santa's Workshop: stuffy drop-off at IHOP | Santa's Workshop: stuffy pickup at IHOP |
| When | Fri 2026-12-18, 4:00 PM to 7:00 PM | Sun 2026-12-20, 1:00 PM to 3:00 PM |
| Location | IHOP, Westerville | IHOP, Westerville |
| Public / RSVP | public, `requiresRsvp` off | public, `requiresRsvp` off |
| Description (Markdown) | Bring your favorite stuffy to meet Santa and Mrs. Claus. Drop off between 4:00 and 7:00 PM; when you sign up you choose one of three one-hour windows. The ticket is $15 per stuffy.<br><br>Sign up and read the whole weekend plan at [westervillelions.org/santas-workshop](https://westervillelions.org/santas-workshop). | Pick up your stuffy and its printed portrait frame between 1:00 and 3:00 PM. Give the name on the order and we will find your stuffy.<br><br>The whole weekend plan is at [westervillelions.org/santas-workshop](https://westervillelions.org/santas-workshop). |

No Saturday row (families do not attend). No "opens Nov 8" and no close date in either description (state-independent). The banned-pattern list applies to these texts; Phase 5 greps them on the live `/events` pages (L8).

## Appendix D — Consistency checklist (four copies of the facts; Phase 5 and Phase 6 walk it)

Source of truth is `WORKSHOP_2026` and `copy.ts`. The page is test-covered; the other three copies are typed by a human from this table.

| # | Fact | Value | Page | Events rows | Zeffy form | Printed material |
|---|---|---|---|---|---|---|
| 1 | Title | A Visit to Santa's Workshop | facts, hero, head | row titles use "Santa's Workshop:" prefix | form title | poster, flyer |
| 2 | Drop-off day and time | Fri Dec 18, 4:00 to 7:00 PM | weekend card, after-you-register | row 1 | e-ticket event time, B2 helper, intro, thank-you | poster |
| 3 | The three windows (exact strings) | 4:00 to 5:00 PM, 5:00 to 6:00 PM, 6:00 to 7:00 PM | weekend card | description says "three one-hour windows" | B2 options verbatim | flyer if it lists them |
| 4 | Pickup | Sun Dec 20, 1:00 to 3:00 PM | weekend card | row 2 | intro, thank-you | poster |
| 5 | Photo day | Sat Dec 19, no hours printed anywhere | weekend card ("you do not need to be there") | none | intro (no hours) | poster |
| 6 | Place | IHOP, Westerville (no street address until Q-C8) | tiles, cards | location field | event location, intro | poster |
| 7 | Price | $15 per stuffy, one ticket per stuffy | tiles, FAQ, signup | row 1 | ticket rate | poster |
| 8 | Opens | Sun Nov 8, 12:00 AM Eastern | `before` pill | **not printed** | sales start | poster if it says "opens" |
| 9 | Last sign-up day | Wed Dec 16, 11:59 PM Eastern | signup line | **not printed** | sales end | poster if it says "by" |
| 10 | Promise | We photograph stuffies only, never the children. | privacy, `/privacy` | none | intro | poster |
| 11 | Photo box label and helper | `PHOTO_BOX_LABEL`, `PHOTO_BOX_HELPER` verbatim | privacy | none | T7 verbatim | none |
| 12 | Snack sentence and options | `SNACK`; five options | FAQ | none | T4 helper and options | none |
| 13 | Loss or damage | final treasurer/insurer wording | what-to-bring note | none | B3 verbatim | none |
| 14 | Intro text | one paragraph from rows 2, 4, 6, 7, 10 | n/a | n/a | form description | n/a |
| 15 | Thank-you message | rows 2, 4, 6, "you do not need your receipt; give the name on the order" | after-you-register | n/a | thank-you | n/a |
| 16 | Beneficiaries sentence | treasurer-approved | where-the-money-goes | none | none (no deductibility or proceeds claims on the form) | only if the poster says it, same words |
| 17 | Contact | `/connect` and `info@westervillelions.org` only | questions, after-you-register | none | none | poster URL |
| 18 | Short address and QR | `westervillelions.org/santasworkshop` | redirect | description link is the full URL | none | QR encodes the short address; print only after L3 |
| 19 | Words | stuffy/stuffies; ticket; never donation, tax, scarcity | tests | read by eye | read by eye | read by eye |

## Appendix E — Art brief (replaces the deleted `/santas-workshop/preview/art` page; files go under `public/images/santas-workshop/`, then add the id to `SUPPLIED` in `art-slots.ts`; every slot is optional)

| id | File | Size | Used for | If absent |
|---|---|---|---|---|
| `hero-scene` | `.webp` | 2400x1600, 3:2 (focal subject in the center third; crops to about 4:5 on phones, 21:9 wide) | hero | hero ends after the CTA |
| `train` | `.svg` | 900x300, transparent, side view facing right | replaces the drawn train | the drawn train stays |
| `track-tile` | `.svg` | 1200x120 seamless | under the train | CSS track stays |
| `step-dropoff`, `step-photos`, `step-pickup` | `.svg` | 256x256, transparent | weekend day cards | cards without an icon |
| `story-art` | `.svg` | 512x512, transparent | story section | single-column story |
| `og` | `.jpg` | 1200x630 (optional 1200x1200) | Open Graph and Twitter | `images/og-default.jpg` |

Dropped from the prototype registry: `scene-*`, `stuffy-*`, `book-cover`, `step-journey` (now `step-photos`), `conductor-stamp` (now `story-art`). Alt text for stuffies must never show children. Owner: the user. Needed before Nov 8; fallback decision by **Nov 1**.

## Appendix F — Open facts and the defaults this design ships

| Q | Default shipped | Lives in | Needs |
|---|---|---|---|
| Q-C1 windows hourly and advisory | hourly; "Running late within those hours? Come anyway." | `facts.windows`, weekend card | chair before the Zeffy dropdown is built |
| Q-C2 pickup 1:00 to 3:00 PM final | yes | `facts.pickup` | chair |
| Q-C3 no receipt needed, name on the order | yes | copy (what to bring, FAQ 4, after-you-register) | chair |
| Q-C4 event contact | `/connect` and `info@`; no phone | copy | chair, if a club event phone exists |
| Q-C5 sign-ups stop end of Wed Dec 16 | yes | `facts.lastSignupDay`, Zeffy end | chair |
| Q-C6 Saturday | no location, no hours, "you do not need to be there" | copy | chair |
| Q-C7 snack included in the $15, for the child bringing the stuffy | only the sentence "We will offer a snack at drop-off and pickup" is printed; "included" is not claimed | copy | chair; add "included" only on his word |
| Q-C8 IHOP | name and town only | `facts.place` | chair, before a street address or map link |
| Q-C9 who reads notes | keep both questions; drop T6 if nobody will | Zeffy form | chair |
| Q-P1 group-picture caveat | accepted | `PHOTO_BOX_HELPER` | chair |
| Q-P2 retention | collage until next year's event; details deleted by Jan 31, 2027 | `facts.signupDataDeletedBy`, copy | chair and board |
| Q-P3 audience line | "Made for young children and their favorite stuffy. Anyone is welcome to send a stuffy." | copy | chair |
| Q-P4 beneficiaries sentence and tip sentence | as in Appendix A | `facts.beneficiaries.sentence`, `ZEFFY_TIP_NOTE` | treasurer, before Nov 8 |

## Implementer

**ux-developer, for the whole increment**, in the order above. Why not the api-developer to ux-developer split Phase 3 usually nominates: there is no route, query layer or server action here; the "contract" is about 120 lines of pure functions (`facts`, `state`, `clock`, `format`, `eastern-date`) specified above to the signature, and handing it across would add a round trip for no gain. It is also not a full-stack-developer job: it is a roughly 700-line public page with a heavy test list, not a small coupled change. Checkpoint at step 3 (the seam and its tests green) before any markup. **Deviations from the design** go in the Phase 4 section, routed by size (under about 30 lines, no schema, no new API: absorb with a note; a new page or API: back to Phase 3; a new flow or permission: back to Phase 1).

## Phase 3 handoff

### Summary
Design complete. A DB-free, statically generated `/santas-workshop` page reading `WORKSHOP_2026` through an async loader; four states from a pure function of the Eastern date (boundaries at `2026-11-08T05:00:00Z`, `2026-12-17T05:00:00Z`, `2026-12-21T05:00:00Z`); the Zeffy iframe only in `open`, always with a visible new-tab button; copy centralised and scanned by tests; the preview deleted and redirected; `/santasworkshop` as the poster short address; a `/privacy` section. No schema, dependency, permission, email or API.

### What I did
- Read the whole work-log, the spec, the increment 2 rulings, DECISION-118/119, the prototype source and tests, the White Cane precedent, `next.config.ts`, the sitemap, the privacy page and the events page.
- Resolved the open Phase 3 questions: the manual-stop mechanism (R1), phone presentation (R7), the clock for QA (R8), ISR staleness handling (R11), the unmapped-URL state (R15), the preview's fate and its tests, the exports that die, art-optional rendering, and `ZeffyEmbed` (untouched).
- Wrote the full copy deck, the Zeffy build sheet v2, the two events rows, the consistency checklist, the art brief, the open-facts table and the live-check table; drafted release notes without a version.
- Filed **DECISION-120 (Proposed)** at the top of `docs/decisions.md` and added the amendment note to DECISION-118's Status line.

### Outputs
- This section and the Per-Phase Status row of `docs/work-log/2026-10-12-santas-workshop-signup-page.md`; the Reserved IDs line now says this increment files 120 only.
- `docs/decisions.md`: DECISION-120 (Proposed) and the DECISION-118 Status line amendment.
- No code, no commit, no CLAUDE.md or backlog edit.

### Open questions / handoff notes
- **Implementer: ux-developer** (whole increment). Start only after the orchestrator has committed or handed over the uncommitted prototype edits (keep the "stuffy" wording).
- **Orchestrator:** (1) DECISION-121 to 124 belong to increment 2; increment 2's Phase 1 text that says "proposed DECISION-120" is stale. (2) CLAUDE.md edits 1 to 4 above need the user's approval. (3) Proposed backlog text: **B-166** "Santa's Workshop sign-up page: Dec 18 to 20, no cap, no preschool; real page per `docs/work-log/2026-10-12-santas-workshop-signup-page.md`; Zeffy ticket form on the Club's account; inline frame with new-tab button; four states; events rows created by hand." and **B-168** re-scope or close (the plan is a frame plus a collage, not a memory book). (4) Ask the user: build the Zeffy form per Appendix B and the practice purchase per increment 2's checklist; deliver art by Nov 1 or accept none; create the two events rows after the push; set Zeffy sales to Nov 8 12:00 AM and Dec 16 11:59 PM Eastern. (5) Ask the chair the Appendix F facts; copy freeze Nov 1. (6) The dev-clock QA servers run on their own ports, not :3000.
- **qa:** walk Appendix D and the live checks L1 to L8; run the unit and e2e lists against four clocked servers (`2026-11-08T04:59:59Z`, `2026-11-08T05:00:00Z`, `2026-12-17T05:00:00Z`, `2026-12-21T05:00:00Z`) plus the live clock.
- **Increment 2's Phase 3:** correct the "no Zeffy API" lines in `docs/features/santas-workshop.md` (139, 185); keep the window labels in `facts.ts` as the join strings; keep `layout.tsx` free of `robots`; note that `/santas-workshop/preview` is permanently redirected so it is not available as a route.
- **analyst (Phase 6):** compare against Phase 1 acceptance 1 to 10; items 5 and 10 depend on real devices and the practice purchase.

---

# Phase 4 — Implementation

**Owner:** ux-developer · **Status:** complete · **Date:** 2026-10-12

## Files Created

- `src/lib/eastern-date.ts` (+ `.test.ts`) — `easternDateString()` moved here from White Cane.
- `src/lib/santas-workshop/{facts,format,state,clock,public-facts}.ts` — `WORKSHOP_2026`, `validateWorkshopFacts`, formatters, `workshopState`/`focusDay`, dev clock, async loader. Tests: `facts.test.ts`, `state.test.ts`, `clock.test.ts`, `public-facts.test.ts`.
- `src/app/santas-workshop/{layout.tsx,page.tsx,santas-workshop.css}` — fonts and scoped CSS only in the layout (no robots, no canonical); static metadata in the page; `revalidate = 300`. Test: `public-page.test.ts`.
- `src/components/santas-workshop/{copy.ts,banned.ts,art-slots.ts,art.tsx,train-motif.tsx,hero.tsx,signup-section.tsx,sections.tsx,workshop-page.tsx}` — zero `"use client"`. Tests: `copy.test.ts`, `art-slots.test.ts` (rewritten), `workshop-page.test.tsx`.
- `src/santas-workshop-redirect.test.ts`, `src/app/privacy/workshop-section.test.ts`, `e2e/santas-workshop.spec.ts`.

## Files Modified

- `src/components/white-cane/campaign-state.ts` and `.test.ts` — import the shared helper; moved describe dropped, every other test unchanged and passing.
- `next.config.ts` — two 307 rules (`/santasworkshop` with three UTM tags; `/santas-workshop/preview/:path*`).
- `src/app/sitemap.ts` — one static `/santas-workshop` line.
- `src/app/privacy/page.tsx` — collected-data bullet, "A Visit to Santa's Workshop" section built from `copy.ts` and the loader's deletion date, `EFFECTIVE_DATE` set to October 12, 2026 (**the push day may differ; update it on push day**).

## Files Deleted

`src/app/santas-workshop/preview/**` and every prototype-only component and test listed in the design (`sample-data*`, `follow-demo`, `memory-book`, `delivery-switch`, `preview-state`, `prototype-shell`, `phone-frame`, `screens`, `flow-footer`, `screen-header`, `pinned-reserve`, `in-view`, `check-in*`, `photo-station`, `journey*`, `conductor-list`, `zeffy-form-card`, `landing-hero`, `landing-sections`, `landing-state*`, `event-facts`, `art-slot`, `preview-unlisted.test.ts`) and `e2e/santas-workshop-preview.spec.ts`. The uncommitted "stuffy" edits to `landing-sections.tsx`, `landing-state.ts` and `art-slots.ts` were carried into `copy.ts` and the new `art-slots.ts` (the wording is the Appendix A deck); no `stuffed` remains.

## Schema Changes

None. No migration, dependency, permission, email or API.

## Gates (2026-10-12, main tree)

- `pnpm exec tsc --noEmit`: clean (the only errors seen mid-way were stale `.next/types` from the running dev server, gone after `pnpm build:only`).
- `pnpm lint`: 0 errors, 1 pre-existing warning in `src/components/admin/ledger/budget-context-panel.tsx` (not this diff).
- `pnpm test`: 217 files, 3735 tests green.
- `pnpm build:only`: passes; `/santas-workshop` prerenders static with 5m revalidate.
- `pnpm exec playwright test e2e/santas-workshop.spec.ts` against the orchestrator's `:3000` dev server (live clock, state `before`): 10 passed, 1 skipped (open-only test). curl: `/santasworkshop` 307 with exactly three UTM tags; `/santas-workshop/preview` and `/preview/check-in` 307 to `/santas-workshop`.

## Deviations from the design

All under ~30 lines, no schema, no new API; absorbed.

1. `facts.ts` imports `weekdayIndex` from `format.ts` (design said "no imports"); both are pure.
2. Banned-pattern table lives in `src/components/santas-workshop/banned.ts` (shared by `copy.test.ts`, `workshop-page.test.tsx` and the e2e spec) instead of being retyped per test. Not imported by app code.
3. One extra copy string, `hero.statusNotReady` ("The sign-up form is coming soon"): in `open` with an empty URL the hero shows this status pill instead of a "Sign up" button that would lead to a not-ready notice. Design R15 asked for the notice in the signup section; the hero pill is the consistent companion.
4. `WhereTheMoneyGoes` renders in all four states (design table) and `ThankYou` does not repeat the sentence; the design's "Thank-you block" is therefore only the optional collage link and the closing line.
5. `copy.ts` exposes `workshopCopy(facts)` for facts-derived strings plus verbatim constants; the test walks both.
6. Not run: the four clocked dev servers (Next 16 refuses a second `next dev` in one directory and the orchestrator owns `:3000`); all four states are rendered and scanned by `workshop-page.test.tsx` instead. The e2e spec reads `SANTAS_WORKSHOP_NOW` so qa can run it against a clocked server.

7. Post-QA fix: the e2e "no console error or CSP violation" test now ignores console errors whose source URL host is zeffy.com (third-party frame); our own errors and CSP violations reported against this site still fail it. It was not skipped on an empty `zeffyShareUrl` before and still is not (it passes with an empty URL).
8. Post-QA fix: the `next.config.ts` comment and the redirect test name for `/santas-workshop/preview/:path*` now say the query is forwarded to the fixed same-origin path and ignored by the page. Redirect behaviour unchanged.

9. Post-Phase-6 fix: removed "Someone else can collect for you; they give the same name." from "After you register" (who may collect is an open chair question); pickup is by the name on the order only. A test pins its absence.
10. Post-Phase-6 fix: `COLLAGE_KEEPING` now reads "The collage and portraits stay online through the end of January 2027, and sooner if you ask us to take your stuffy down." (DECISION-125). The page and `/privacy` share the one constant; the Jan 31, 2027 deletion sentence is unchanged.
11. Post-Phase-6 fix: in `open` with an empty Zeffy URL, "After you register" is hidden.
12. Post-Phase-6 fix: `after` with no `collagePath` shows "Photos: contact the club and we will point you to them."; `closed` shows the collage link (new `CollageLink`) whenever `collagePath` is set.

## Implementer Notes

- `easternDateString` source-scan style tests use a regex that allows `new Date(Date.UTC(...))` (the weekday arithmetic in `format.ts`) but rejects a string or an identifier argument.
- Zeffy URL appears only in `signup-section.tsx`, rendered only in `open` with a non-empty URL (the `before`, `closed`, `after` bodies do not include that component).
- Hero artwork, story art, day icons and the OG image render nothing until supplied; `og` falls back to `images/og-default.jpg`. Nothing is supplied today.
- Pre-decided phone fallback (R7) is untouched: if L4 fails on a real device, hide the frame below `md` with one class on the wrapper in `signup-section.tsx`.
- Dev-only clock: `SANTAS_WORKSHOP_NOW` (full ISO instant), ignored when `NODE_ENV === "production"`; needs the CLAUDE.md env-list line (not edited by me).

## Handoff to qa

- Click through at 360 px: `before` (live today), then `open`, `closed`, `after` using a clocked dev server on its own port after the orchestrator frees `.next` (or temporarily via the env var on `:3000` if the orchestrator agrees).
- Open state with a real Zeffy link: paste it into `facts.ts` locally; check L4/L5 on real phones.
- Check `/privacy` section and bullet, the sitemap entry, view-source of the `<head>` (canonical, OG, no robots).
- Copy strings the Lions may want to refine: all of Appendix F, plus the new hero pill "The sign-up form is coming soon".

---

## Orchestrator note (2026-10-12): dev server handover for Phase 5

For Phase 5 the qa agent owns `:3000` and may stop and restart it with `SANTAS_WORKSHOP_NOW` set to view each state; no other pipeline has live checks on the main tree right now (increment 2 is in design/worktree). qa restores a plain `pnpm dev` on `:3000` when done.

# Phase 5 — Verification (qa)

**Date:** 2026-10-12
**Verified by:** qa
**Tree state the PASS is measured on:** `git rev-parse HEAD` = `cb2f0bcaa74cafdba2fa9cb4ad30fca49f7dcdc8` plus the **uncommitted increment-1 diff** (69 `git status` entries: new `src/app/santas-workshop/`, `src/components/santas-workshop/`, `src/lib/santas-workshop/`, `src/lib/eastern-date.ts`, tests, `e2e/santas-workshop.spec.ts`; modified `next.config.ts`, `src/app/sitemap.ts`, `src/app/privacy/page.tsx`, `src/components/white-cane/campaign-state{,.test}.ts`; deleted prototype files). Also present in the tree and **concurrent, not this diff**: `docs/decisions.md`, `docs/features/santas-workshop.md`, the increment 2 work-log. Scratch files: `<scratchpad>/santas-workshop-signup-page/` (walk script, JSON per state, screenshots, boundary log).

## Verdict (first, as required)

**PASS.** Every gate is green, every test Phase 3 names exists and passes, all four states render correctly on desktop and at 360 px on a clocked dev server, the six boundary instants resolve correctly live, and nothing the design forbids appears. Seven non-blocking observations (N1 to N7 below) go to the implementer or orchestrator; none changes the verdict. Live checks that need a deployment or a phone are listed as **deferred to post-deploy**, not as passes.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (exit 0, 4.5 s).

## Lint

`pnpm lint`: **PASS** (0 errors; 1 pre-existing warning in `src/components/admin/ledger/budget-context-panel.tsx:114`, a file this diff does not touch: concurrent, not this diff).

## Unit Tests

`pnpm test`: **PASS**. 217 files, **3735 passed**, 0 failed, 3.96 s. (Same totals as the implementer's run.)

Phase 3 named tests, checked by name against the verbose run (all present, all green):

| File | Named in design | Found |
|---|---|---|
| `src/lib/eastern-date.test.ts` | 4 | 4 |
| `src/lib/santas-workshop/state.test.ts` | boundaries (3 pairs), October/2027, manual stop both ways, invalid-date degrade, `WORKSHOP_STATES`, `focusDay`, 2 source scans | all |
| `src/lib/santas-workshop/facts.test.ts` | validity, weekdays, opens/price, window labels, pickup/range, long/short dates, meridiem, every `validateWorkshopFacts` rejection in the table plus accept-empty-URL, `toEmbedUrl` host/path pin (2 share-link shapes) | all |
| `public-facts.test.ts` (2), `clock.test.ts` (3) | 5 | 5 |
| `src/components/santas-workshop/copy.test.ts` | 7 | 7 (+3 extras) |
| `workshop-page.test.tsx` | 14, looping the four states with a URL set and with it empty | 14 (+ instants-to-state map) |
| `art-slots.test.ts` | 5 | 5 |
| `src/app/santas-workshop/public-page.test.ts` | 7 | 7 (+ scanned-files list) |
| `src/santas-workshop-redirect.test.ts` | 3 | 3 |
| `src/app/privacy/workshop-section.test.ts` | 2 | 2 |
| `src/components/white-cane/campaign-state.test.ts` | every existing test unchanged | all 9 `campaignState`/source-scan tests pass; `white-cane-redirect` and `campaign-facts` tests pass |

Coverage on the new pure modules (`vitest --coverage`, scoped): statements 95.65%, branches 89.47%, functions 96.66%, lines 98.08% across the files the report listed (`eastern-date.ts` 100%, `copy.ts` 100%, `format.ts` 100%, `facts.ts` 91.3%, `art-slots.ts` 85.7%). `state.ts`, `clock.ts` and `public-facts.ts` did not appear in the text report (I did not chase why; they are exercised by the named tests above). The project's critical-module targets (`events.ts`, `permissions.ts`, `members.ts`) are not touched by this diff and were not re-measured.

## Production Build

`pnpm build:only`: **PASS** (10 s). 275 route rows listed; `/santas-workshop` is `○ Static`, `5m` revalidate, `1y` expire; `/privacy` static `1d`; `/white-cane` static `5m`. No warnings or unused-export notices in the output.

**Production ignores the dev clock (R8), live:** rebuilt with `SANTAS_WORKSHOP_NOW=2026-12-22T12:00:00Z` exported (an `after` instant), then `next start -p 3102` with the same env. Result: `data-state="before"`, "Registration opens Sunday, Nov 8", and `?state=after&now=2026-12-22T12:00:00Z` also `before`. Unit test `returns real time in production even when SANTAS_WORKSHOP_NOW is set` backs it. The override is never read from the URL (`public-page.test.ts` scan plus the query tests below).

## Dev-Server Smoke Test (live clock, then four clocked servers on :3000)

`next dev` was stopped by me (orchestrator note: qa owns :3000) and restarted per instant via `serve.sh` (`dotenv -e .env.local -- next dev -p 3000`, no migration step, with `SANTAS_WORKSHOP_NOW` set). Per state I drove Chromium at **1280, 768, 390 and 360 px**, plus a Tab-order focus audit, a JavaScript-disabled load and a `?state=`/`?now=` load.

| State (instant) | `data-state` all 4 widths | Horizontal overflow (px) | Console errors | iframe | One `h1` | Banned words in page text and metadata (`donation`, `donate`, `tax-deductible`, `sold out`, `limited`) | `zeffy.com` in HTML |
|---|---|---|---|---|---|---|---|
| before (live clock, Oct 12) | before | 0 / 0 / 0 / 0 | none | 0 | yes | none | no |
| open (`2026-11-10T12:00:00Z`), URL empty | open | 0 / 0 / 0 / 0 | none | 0 | yes | none | no |
| closed (`2026-12-17T12:00:00Z`) | closed | 0 / 0 / 0 / 0 | none | 0 | yes | none | no |
| after (`2026-12-22T12:00:00Z`) | after | 0 / 0 / 0 / 0 | none | 0 | yes ("Thank you for riding with us") | none | no |

(The only `donate` string on the full document is the site header and footer "Donate" links, which are outside `[data-testid=workshop-page]`: site chrome, not this page.)

## Manual Click-Through

| Flow | Result | Notes |
|---|---|---|
| **Before**: hero, status pill | pass | Pill "Registration opens Sunday, Nov 8"; tiles When "Dec 18 to 20", Cost "$15 per stuffy", Where "IHOP, Westerville"; no sign-up control, no `#signup` anchor, no form section. Desktop and 360 px screenshots reviewed. |
| **Open, empty Zeffy URL**: not-ready notice | pass | Hero pill "The sign-up form is coming soon" (deviation 3), section "Sign up for the weekend" with "The sign-up form is not ready yet. Please check back soon, or contact the club."; no iframe, no button, no `<noscript>` link, no `zeffy.com` in the HTML. |
| **Open, temporary fixture URL** (see "Fixture" below) | pass | One iframe titled per `SIGNUP_FRAME_TITLE`, `allow=payment`; solid "Open the sign-up form in a new tab" button above and text link below; tip note ("optional tip ... set it to $0 and your ticket is still $15"); "If the form says sign-ups are closed, contact the club"; "Sign-ups close Wednesday, Dec 16."; `<noscript>` link present in server HTML; 0 px overflow at 360/390/768/1280. Frame content blank only because the slug was fake. |
| **Closed** | pass | Pill "Sign-ups for this year are closed"; lead "Here is how the weekend works."; "After you register" first after the hero; weekend, bring, FAQ, privacy, beneficiaries present; never "full", "sold out" or "capacity". `focusDay`: at `2026-12-18T05:00:00Z` the Fri Dec 18 card is first and tagged "Today"; at `2026-12-20T17:00:00Z` the Sun Dec 20 card is first and tagged "Today". |
| **After** | pass | h1 "Thank you for riding with us", lead, no tiles, no CTA, no iframe/form/img; shows Your privacy, Where the money goes, "We hope to see you again.", Questions, Presented by. No collage link (`collagePath` is null). Full page, not a blank. |
| Facts check, all states where applicable | pass | Fri Dec 18 drop-off 4:00 to 7:00 PM; three windows "4:00 to 5:00 PM", "5:00 to 6:00 PM", "6:00 to 7:00 PM"; Sat Dec 19 photo day with no hours; Sun Dec 20 1:00 to 3:00 PM; IHOP, Westerville; "Registration opens Sunday, Nov 8" (before); $15 per stuffy; "Sign-ups close Wednesday, Dec 16." (open with a URL); data-deletion date Jan 31, 2027. Independent stray scan: dates seen are only Dec 16/18/19/20, Nov 8, Jan 31; dollars only $15 and $0 (tip note). |
| Snack sentence | pass | Present verbatim in the FAQ ("We will offer a snack at drop-off and pickup. This is a preference, not a medical request, and we cannot promise that any snack is free of allergens.") plus the five options. |
| Privacy section wording | pass | Promise "We photograph stuffies only, never the children."; photo-box label and helper verbatim (helper names group pictures, says "your own printed frame"); collage-retention and removal sentences; Zeffy/volunteers/photo-storage sentences. |
| "Where the money goes" | pass | "What is left after the cost of the event supports the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation." (no "all proceeds", "benefit" or logos). |
| Redirects (dev, then production server) | pass | `/santasworkshop` 307 to `/santas-workshop?utm_source=poster&utm_medium=qr&utm_campaign=santasworkshop`; `/santas-workshop/preview`, `/preview/anything`, `/preview/check-in/deep/er` all 307 to `/santas-workshop`. See N1 for query pass-through. |
| Sitemap | pass | `/sitemap.xml` lists `https://westervillelions.org/santas-workshop` once, next to `/white-cane`; no `/preview` or `/santasworkshop` entry (also source-scanned). |
| `/privacy` additions | pass | "Santa's Workshop sign-ups: collected for us by Zeffy: ..." bullet and the "A Visit to Santa's Workshop" section render; deletion date and the promise come from `copy.ts`/facts; effective date now "October 12, 2026" (update on push day, see handoff). |
| Open Graph and head, state-independent | pass | Head metadata captured in all four states: **byte-identical** (md5 equal). Title once with the club name; canonical `https://westervillelions.org/santas-workshop`; no `robots` meta; OG/Twitter blocks from `copy.ts`; `og:image` is the `og-default.jpg` fallback (no `og.jpg` supplied yet). Description is the Appendix A sentence, no banned words. |
| Keyboard focus | pass | Tab walk (skip link, header, page links/buttons, footer, 18 stops in `before`) shows a visible outline or ring on every stop in every state. Only exception: with a Zeffy URL the iframe element itself takes focus with no ring (N6). |
| JavaScript disabled | pass | Status 200, correct `data-state`, same text length as the JS render (within 200 chars), one h1, `#signup` anchor present in open, `<noscript>` link present in open-with-URL. The page is a Server Component with no client JS of its own. |
| Query strings | pass | `?state=after&now=2030-01-01T00:00:00Z&x=ZZQUERYZZ` leaves `data-state` unchanged in every state and the marker never appears inside `[data-testid=workshop-page]`. (Marker does appear in Next's own flight payload in dev: N4.) A 6,000-character query string returns 200. |
| Trailing slash and HEAD | pass | `/santas-workshop/` is Next's default 308 to `/santas-workshop`, which is 200; `HEAD /santas-workshop` is 200 with `Cache-Control: s-maxage=300, stale-while-revalidate=...`, CSP `frame-src` includes `https://www.zeffy.com`, `Permissions-Policy` has `payment=(self "https://www.zeffy.com")` (production server). |
| White Cane after the `easternDateString()` move | pass | `/white-cane` 200 on dev and production server; all White Cane unit tests and the 11 White Cane e2e tests pass. |

**Fixture (reverted, verified).** The open-state e2e test and the iframe checks cannot run with `zeffyShareUrl: ""`, so I temporarily set it to `https://www.zeffy.com/en-US/ticketing/qa-fixture-not-a-real-form` in `src/lib/santas-workshop/facts.ts` (Phase 3 L5 sanctions a local edit), ran, then restored the file from a copy. `shasum` before the edit and after the restore are identical (`9608af86a5657bcf68ac67228f13342519f22be1`), and `zeffyShareUrl: ""` is back at line 55. No commit.

### Boundary instants, live (clocked dev server, `data-state` read from the HTML)

| Instant | State read |
|---|---|
| `2026-11-08T04:59:59Z` | before |
| `2026-11-08T05:00:00Z` | open |
| `2026-12-17T04:59:59Z` | open |
| `2026-12-17T05:00:00Z` | closed |
| `2026-12-21T04:59:59Z` | closed |
| `2026-12-21T05:00:00Z` | after |

All six match Phase 3's table and the unit tests. A date-only override (`2026-12-22`) is ignored (state stays `before`), as `clock.test.ts` requires.

## End-to-End Tests

`pnpm exec dotenv -e .env.local -- playwright test e2e/santas-workshop.spec.ts`, serial, against the clocked server for each state:

| Server clock | Result |
|---|---|
| live (before) | 10 passed, 1 skipped (open-only test) |
| open `2026-11-10T12:00:00Z`, URL empty | 10 passed, 1 skipped (the open-only test is gated on a non-empty URL as well, so a clocked open server alone does **not** un-skip it: N3) |
| closed `2026-12-17T12:00:00Z` | 10 passed, 1 skipped |
| after `2026-12-22T12:00:00Z` | 10 passed, 1 skipped |
| open + fixture URL | 10 passed, **1 failed**: `no console error or CSP violation while the page loads`. The first-sign-up-control test ran and **passed**, as did the iframe test. The failure's messages are all from inside the embedded zeffy.com frame (Zeffy's own pages refusing framing and logging their own CSP blocks for its scripts) because the fixture slug is not a real form, not from this site's CSP. Believed (not measured) to recur with a real form because Zeffy's own page logs CSP messages of its own; see N2 and L5. |
| final run on the restored plain `pnpm dev` (live clock), `white-cane.spec.ts` + `santas-workshop.spec.ts` | 21 passed, 1 skipped |

## Regression Tests Added

Not a bug fix; no regression suffix required. The tests that pin the previously costly classes of bug are the Eastern-day boundary tests (`state.test.ts`, `eastern-date.test.ts`: the UTC-versus-Eastern misclassification), the banned-pattern scans, and `public-page.test.ts` (no preview directory, no db/auth/email/fetch/client JS, state read only through `workshopNow`).

## Feature-Gate Audit

**No protected routes or server actions touched.** The diff adds no `src/app/api/**` route and no `"use server"` file. A grep of the production files (`src/app/santas-workshop`, `src/components/santas-workshop`, `src/lib/santas-workshop`, `src/lib/eastern-date.ts`, excluding tests) for `sendEmail`, `@/lib/db`, `fetch(`, `use client`, `console.log`, `dangerouslySetInnerHTML`, `searchParams`, `auth(`, `next/headers`, `cookies(`, native dialogs returns exactly one hit: `process.env` at `page.tsx:50` (`workshopNow(process.env, new Date())`, intended). No schema, migration, `package.json` or `proxy.ts` change. No personal email or phone number in the new files (grep clean). Intended: the public page is identical for anonymous and signed-in visitors and makes no `auth()` call.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /santas-workshop` (public page) | no, by design | no, by design | n/a, public |
| `/santasworkshop`, `/santas-workshop/preview/:path*` | n/a, config redirects | n/a | n/a |

## Appendix D walk (page column; the other three copies are human-typed and out of reach)

Rows 1 to 13 and 15 to 19 as they apply to the page: title, drop-off day and time, the three window strings, pickup, photo day (no hours), place, price, opens (before pill), last sign-up day (open signup line), promise, photo-box label and helper, snack sentence and options, loss-or-damage note, thank-you facts, beneficiaries sentence, contact (`/connect`, `info@westervillelions.org`), words: all present and consistent with `WORKSHOP_2026` and `copy.ts` on the rendered page. Rows for the events rows, the Zeffy form and printed material are not verifiable from the repo: **deferred (L8 and the user's Zeffy build).**

## Observations (non-blocking; none is a defect against Phase 3's contract)

- **N1. The preview and vanity redirects forward the incoming query string.** `/santas-workshop/preview/a/b?next=https://evil.example` redirects to `/santas-workshop?next=https%3A%2F%2Fevil.example`; `/santasworkshop?utm_source=x&foo=1` gives `?utm_source=poster&foo=1&utm_medium=qr&utm_campaign=santasworkshop`. The target path is fixed and same-origin, the page ignores query values, so this is not an open redirect. But the code comment ("no query forwarded") and the design text are inaccurate, and the unit test only checks the destination string. *Established:* the behavior above. *Belief, not tested:* it is Next's default redirect behavior, which the White Cane rule shares. Implementer: correct the comment, or leave it. No code defect.
- **N2. The e2e `no console error or CSP violation` test is likely to fail once a real Zeffy URL is pasted**, because the page's console capture includes messages logged by the embedded Zeffy frame. Established with a fake slug (all messages were zeffy.com's own). Not established for a real form. Implementer/orchestrator: when L5 is done with the real link, re-run that test; if it fails the same way, filter to this site's origin.
- **N3. The open-state e2e test cannot run until `zeffyShareUrl` is non-empty**, however the clock is set. I ran it only via the temporary fixture. The brief's "run against a clocked open-state server so the skipped test runs" is not achievable without a URL in `facts.ts`; that is the design's R15 gating, not a bug.
- **N4. In dev, Next's flight payload embeds the request query string** (the `?x=ZZQUERYZZ` marker appears in the document but not in the rendered page tree). Framework behavior, dev only observed; I did not check the production server's payload.
- **N5. Copy consideration:** in open-with-no-URL the "After you register" section ("Zeffy emails your receipt ... drop off ... in the window you chose") shows beside "The sign-up form is not ready yet." Literal to design R15 and the section table; the analyst may want it hidden until a form exists.
- **N6. With a form URL the iframe receives keyboard focus with no visible ring** on our side (the frame's own content styles its focus). Cosmetic.
- **N7. `/privacy` `EFFECTIVE_DATE` is "October 12, 2026"** and must be set to the push day at push time (the implementer noted this).

## Deferred to post-deploy / needs a person or phone (not passes)

| # | What | Exact step |
|---|---|---|
| L1 | Zeffy sales window actually refuses purchases outside Nov 8 to Dec 16 | On the practice form set sales to end in 10 minutes; after expiry open the share link, try to reach payment, record n of n refused; before the real start open the real form's link and record what Zeffy shows. (orchestrator or user) |
| L2 | ISR staleness at a boundary | On the deployed page: `curl -sI https://westervillelions.org/santas-workshop` for `x-vercel-cache` and `age`; wait over 300 s; request three times; record the sequence. If the first request after expiry is stale, apply the R11 `force-dynamic` fallback. (orchestrator, after first deploy) |
| L3 | Both 307s on the deployed URL, including bare `/santas-workshop/preview` | `curl -sI` `/santasworkshop` and `/santas-workshop/preview`; record status and `location`. **Print no QR until this passes.** (Local dev and production-server results above are not the deployed host.) |
| L4 | Zeffy inline frame loads and reaches payment on a real iPhone (Safari) and a real Android (Chrome) | Open state with the real share link (local facts edit with a clocked server, or production after Nov 8); record frame loads, questions usable, payment step reached, Apple Pay sheet yes/no per device. Fail triggers R7 fallback. (user with phone; I cannot do this) |
| L5 | A `/ticketing/` share link converts to an embed URL that loads in a tab and in the iframe with no CSP violation | Paste the real link into a local `facts.ts` edit; load both; record the console (also resolves N2). Unit test pins only host `www.zeffy.com` and path `/embed/`. |
| L6 | Open Graph card on a link-preview debugger | Run a link-preview debugger on the deployed URL (head HTML identical across the four states is already verified locally). |
| L7 | Launch-night state | Nov 8, 12:05 AM Eastern: load the page twice, record the state; confirm the form shows. (orchestrator) |
| L8 | Events rows exist, public, link back, `.ics` opens; banned-word grep of their text | After the user creates the two rows: `/events` lists both with the right wall-clock times; each detail page's `.ics` opens. (qa) |
| Appendix D | Zeffy form text, thank-you message, printed material vs the facts table | Human read-through after the form is built. |

## Verdict

**PASS** (tree state as stated at the top). Next agent: **analyst** for Phase 6.

## Phase 5 handoff

**Owner:** qa · **Status:** complete

### Summary
PASS. Typecheck, lint, 3735 unit tests, production build and the new e2e spec are green; all four states, six boundary instants, redirects, sitemap, `/privacy` and the White Cane regression were verified live; deferred live checks are listed above and are not claimed as passes.

### Outputs
- This section and the Per-Phase Status row. No code changed. `facts.ts` was edited temporarily for the open-state fixture and restored (checksum verified). Plain `pnpm dev` is running again on `:3000` with no `SANTAS_WORKSHOP_NOW` (verified: the server's environment has none).

### Open questions / handoff notes
- **Next agent: analyst (Phase 6).** Items 5 and 10 of Phase 1 acceptance depend on L4 and the practice purchase; the Appendix D rows for the Zeffy form and events rows are unverified.
- **Orchestrator:** at push time set `EFFECTIVE_DATE` in `src/app/privacy/page.tsx` to the push day (N7); the CLAUDE.md env-list line for `SANTAS_WORKSHOP_NOW` and the doc edits in Phase 3 still need the user's approval; do not print the poster QR until L3 passes on the deployed host.
- **Implementer (optional, non-blocking):** N1 comment, N2 console-test filter before the real URL goes in.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-12 · **Owner:** analyst · **Status:** complete
**Measured on:** HEAD `cb2f0bc` plus the uncommitted increment-1 diff (the same tree QA measured). Read: this whole work-log, `docs/features/santas-workshop.md`, `src/app/santas-workshop/`, `src/components/santas-workshop/`, `src/lib/santas-workshop/`, `src/lib/eastern-date.ts`, the `next.config.ts`, `sitemap.ts` and `privacy/page.tsx` diffs, DECISION-120, and increment 2's retention and B-168 rulings. Viewed the live `:3000` server (state `before`, live clock) read-only: page text, head tags, the three redirects, the sitemap. The two post-QA cleanups (Playwright console filter, redirect comment and test name) are already in the tree and are treated as done. I could not walk anything that needs a deployed host, a Zeffy form, a phone or the events rows; those are listed as carried, not passed.

## VERDICT

**SHIP WITH NOTES.** The page that exists matches the page Phase 1 asked for, line for line, and every deviation Phase 3 and 4 took is one I accept. It is safe to push as a pre-opening page: with `zeffyShareUrl` empty it cannot show a form, and it opens honestly ("The sign-up form is coming soon") if the paste is late. It does not earn SHIP IT because four things I committed to walking in Phase 1 cannot be walked yet (acceptance 2, 4's Zeffy half, 5's real phones, 10's practice purchase), one sentence on the page makes a policy promise the chair has not made (F1), and two small page behaviors are worth fixing before Nov 8 (F4). None is a code defect in what shipped.

## ONE-LINE TAKE

> A static, database-free, four-state page that tells a family exactly what happens Dec 18 to 20, says plainly what it will and will not do with a photo, opens a Zeffy ticket form only on Nov 8, and stays honest (no scarcity, no donation words, no promised email) in every state; what remains is people's work (the form, the events rows, the chair's and treasurer's sign-offs, two phones) and three small copy-and-state touch-ups.

## What's Working

- **The four states are real and cheap to trust.** `workshopState()` compares Eastern `YYYY-MM-DD` strings including the year; QA read all six boundary instants live (`04:59:59Z`/`05:00:00Z` on Nov 8, Dec 17 and Dec 21) and every one matched my Phase 1 table. A manual stop is one edit of `lastSignupDay`, with no second boolean to go stale. The exhaustive `never` switches in the page body, hero and CTA mean a fifth state cannot be added without the compiler objecting.
- **The honest-copy rules are enforced by tests, not by my eye.** A 32-row banned table (`banned.ts`) runs over copy strings, rendered HTML of all four states (with and without a URL), and the e2e spec. My own scan of the live `before` page found no `tax`, `spot`, `limited`, `full`, `sold out`, `memory book`, `preschool`, `stuffed` or `confirmation`; the single `donat` hit is the site header and footer "Donate" links, outside the page. Stray-date and stray-amount scans keep a hard-coded "Dec 12" or "$20" from surviving.
- **The Zeffy URL is rendered in exactly one component, in exactly one state.** `signup-section.tsx` is the only importer of the URL and the body only includes it in `open`; with an empty URL the section is a plain notice with no button, no frame and no `<noscript>` link. The new-tab button sits above the frame and a text link below it, so an iPhone that blanks the frame still has a way to pay.
- **The privacy story is complete and single-sourced.** The promise, photo-box label and helper, collage-keeping sentence and deletion date come from `copy.ts` and the facts, and `/privacy` imports them instead of retyping, so the policy and the page cannot drift. The collected-data bullet and the new section meet Phase 1 Gap 8.
- **Nothing fragile was added.** No migration, dependency, permission, API, email, database read, `searchParams` or client JavaScript; `easternDateString()` moved to a shared module and White Cane's tests passed unchanged. The head is a static object: QA's four state-by-state head captures were byte-identical, and my curl of the live page shows canonical, OG title and image, and no `robots` meta.
- **The preview retirement is clean.** The directory is gone (a test pins it), `/santas-workshop/preview` and a deep path both 307 to the page (I curled them), `/santasworkshop` 307s with exactly three year-free UTM tags, and the sitemap lists the page once and neither alias.

## Intent-vs-Shipped Diff

### Phase 1 flows

| # | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| Flow 1 | Before: facts, story, FAQ, privacy; no form, no Zeffy URL, no live button; say when it opens | Pill "Registration opens Sunday, Nov 8"; tiles When/Cost/Where; Story, Weekend, What to bring, Good to know, Privacy, Money, Questions; no `#signup`, no URL in the HTML (confirmed on the live page: zero `iframe`) | matches |
| Flow 2 | Open: CTA, form panel; visible new-tab link always; "form closed?" line; `<noscript>`; phone presentation decided in Phase 3 | Gold CTA to `#signup`; inline frame at every width plus solid new-tab button and text link; closed-form line to `/connect`; `<noscript>` link; R7 CSS fallback pre-decided | matches (phone behavior carried to L4) |
| Flow 3 | A standing "After you register" in Open and Closed; spam/no-email route; no receipt needed | Present in both, first after the hero in Closed; "No email within an hour? Check your spam folder, then write to the club"; "You do not need to bring your receipt" | matches. One drift, see F4a (it also shows in Open with no URL) |
| Flow 4 | Contact via `/connect` or a club-domain address; no personal address or phone; day-of channel is a chair question | `/connect` and `info@westervillelions.org` only; no phone | matches; the "no day-of channel" consequence stands as Phase 1's accepted default (Q-C4) |
| Flow 5 | Closed: neutral copy, not "full/sold out"; weekend schedule; day's block first with "Today" | "Sign-ups for this year are closed", "Thank you for the warm welcome"; `focusDay` reorders and tags "Today" (QA saw Dec 18 and Dec 20) | matches |
| Flow 6 | After: thank-you, beneficiaries, collage link only when real, no sample imagery, no form; if photos are not yet up, say when | Full page: title "Thank you for riding with us", privacy, money, closing line, questions; link only when `collagePath` is set; no imagery | matches, except the "say when" half, see F4b |
| Flow 7 | Old preview URL redirects | 307 to `/santas-workshop`, deep paths included (verified on dev) | matches (deployed host carried to L3) |
| Flow 8 | Maintainer: one facts module; test clock not URL; consistency checklist | `WORKSHOP_2026`, `SANTAS_WORKSHOP_NOW` (server env, ignored in production, proved by a production-server run), Appendix D walked for the page column | matches; the other three columns carried (G3) |

### Phase 1 acceptance, 1 to 10

| # | Check | Result |
|---|---|---|
| 1 | Right state at the five instants, URL only in `open` | **pass.** Six instants live (QA), URL absent from `before`, `closed`, `after` HTML (QA grep; my live `before` curl agrees) |
| 2 | Page = events rows = Zeffy text = printed material; checklist filled | **partly carried.** Page column passes; the events rows, Zeffy form and printed material do not exist yet (G3) |
| 3 | Banned-word scan across page, metadata, OG text, iframe title, `<noscript>`, events-row text; "stuffy"; "ticket" | **pass for everything in the repo.** Events-row text is not created yet (L8) |
| 4 | Promise verbatim; two photo sentences on page and verbatim in Zeffy; privacy block and `/privacy` paragraph; removal sentence honorable by increment 2 | **pass on the page and `/privacy`.** "Verbatim in Zeffy" carried (G3). Increment 2 can honor removal (its design hides any photo at any time and purges) |
| 5 | Real iPhone and Android; 360 px; no pinned element hiding the footer; sane focus; 44 px targets | **partly carried.** 360 px emulated: 0 px overflow in all four states at 360, 390, 768, 1280; no pinned element exists (dropped, R14); focus ring on every stop; targets set to `min-h-[44px]`. Real phones are G3/L4, not passed |
| 6 | `/santasworkshop` 307 with UTM; preview redirects; sitemap; OG 1200x630; no `noindex` | **pass on dev and on a production server;** the deployed host (L3) and a link-preview debugger (L6) carried. OG is the `og-default.jpg` fallback until art is supplied |
| 7 | No `searchParams`, `auth()`, db, `sendEmail`, `fetch`, `dangerouslySetInnerHTML`, native dialogs | **pass** (`public-page.test.ts` scan over every non-test file, plus QA's grep: one `process.env` read, intended) |
| 8 | Brand | **pass.** Grep finds no `rounded-full`, `rounded-xl` or `lions-red` in the page code; cards `rounded-2xl`; the status pill, "Today" tag and every button are `rounded-lg`; the hero CTA's `hover:scale-105` is the sanctioned hero variant. Day labels use a fixed seasonal red hex, not the undefined token: acceptable drift, not a violation |
| 9 | Finished without art | **pass.** `Art` renders nothing when unsupplied, layouts collapse, no dashed placeholders in the HTML |
| 10 | Test purchase happened, flagged to the treasurer, refunded; receipt and thank-you match | **carried (G3).** Cannot be walked until the Zeffy form exists |

### The specific points the orchestrator asked about

| Point | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| Four states plus Closed | before/open/closed/after, closed as its own state | `WORKSHOP_STATES` of four, exhaustive switches | matches |
| "Not ready yet" for an empty URL | no dead button; honest line | Hero pill "The sign-up form is coming soon" plus section notice "The sign-up form is not ready yet. Please check back soon, or contact the club."; no button, frame or noscript | matches (the hero pill is a small addition I accept) |
| Ticket, never donation | none of donat/tax/gift/contribut anywhere, iframe title included | `SIGNUP_FRAME_TITLE` "Sign-up form for A Visit to Santa's Workshop, powered by Zeffy", pinned by test; scans clean | matches |
| No cap, no scarcity words | no counter, "limited", "spots", "full", "sold out" | None in page, metadata or FAQ; FAQ says "As many as you like" | matches |
| Snack preference wording | "Snack preference", no-guarantee sentence, never an allergy question | Sentence verbatim in FAQ with the five options; the word "allergens" appears only inside that required sentence (the one place I allowed it) | matches |
| Photo consent for a public collage | label and helper naming the public collage and group pictures; unchecked by default | `PHOTO_BOX_LABEL` verbatim; `PHOTO_BOX_HELPER` says "only on your own printed frame" (R5); FAQ and privacy repeat both | matches. The box itself lives in Zeffy (G3) |
| The privacy promise and `/privacy` | exact promise; "For this event" block and a `/privacy` paragraph | `PROMISE` verbatim, bold; page section plus `/privacy` bullet and section, built from shared constants | matches |
| Lost-link backup = name on the order | no "bring your confirmation", no "we will email you a link", no find-my-order box | "the name on the order" in four places; none of the banned phrases; no lookup | matches. One added sentence goes beyond it, see F1 |
| Beneficiaries | net-of-costs sentence, no logos, no "all proceeds" | "What is left after the cost of the event supports the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation." in all four states | matches; treasurer approval is still outstanding (G2) |
| Preview retired, two redirects | delete and 307; vanity 307 with fixed tags | Done; verified | matches |
| Events rows left for the user | two public rows created by hand after the push | Not created by the code; Appendix C holds the text | matches (L8 carried) |
| Open Graph state-independent | static title/description/image, no JSON-LD, no `noindex` | Static `metadata`; four identical heads; no JSON-LD in the page | matches |

### Phase 3 rulings that differed from Phase 1 (do I accept?)

| Ruling | Decision |
|---|---|
| R1 no `manualStop`, edit `lastSignupDay` | **Accept.** Better than my boolean: one concept, cannot outlive the year. The runbook order (Zeffy first, then the date, then deploy) is the right one |
| R2 `lastSignupDay` inclusive | **Accept** |
| R3 link `/connect` not `/contact` | **Accept** (one hop saved) |
| R4 `utm_campaign=santasworkshop`, year-free | **Accept** (same reasoning as White Cane; the poster outlives the year) |
| R5 "only on your own printed frame", not "family page" | **Accept.** Correct application of my own Gap 10 principle |
| R6 do not touch `ZeffyEmbed` | **Accept** |
| R7 inline frame everywhere plus new-tab button, CSS fallback pre-decided | **Accept, conditional on L4.** I asked for a decision and got one with an exit; the real-phone pass is what proves it |
| R8 dev-only server clock, never a URL parameter | **Accept.** Production-server run proves it is ignored; needs its CLAUDE.md env line (F5) |
| R9 link `/events`, no event UUID | **Accept** |
| R10 `collagePath` field | **Accept the field;** see F4c for where the link should show |
| R11 ISR staleness believed, unmeasured, `force-dynamic` fallback | **Accept.** The Phase 1 "up to 5 minutes" claim was mine and was withdrawn correctly. Measure at L2/L7; do not leave it for launch night |
| R12 all Q-C/Q-P defaults ship as the strings | **Accept, with one exception** (the pickup-by-someone-else sentence, F1), which was in Appendix A but not an Appendix F default and so was never put to the chair |
| R13 this increment files DECISION-120 only | **Accept** |
| R14 no `in-view`, no pinned bar, zero client JS | **Accept.** Removes the prototype's D1 class of defect entirely |
| R15 `signupAvailable` derived, not a fifth state | **Accept** (and Phase 4 deviation 3, the hero pill, with it) |

Phase 4 deviations 1 to 8: **all accepted.** None crosses the 30-line, schema, API or flow thresholds. Deviation 7 (console filter) and 8 (comment and test name) are in the tree.

## Edge Cases

- Empty state: **pass.** There is no data to be empty; the one empty input (no Zeffy URL) renders a notice, and `closed` and `after` are full pages, never blanks. With no art supplied the page still looks finished.
- Failure microcopy: **pass.** Form not ready, "If the form says sign-ups are closed, contact the club", `<noscript>` text, new-tab button as the answer to a blank frame, spam-folder line for a missing receipt. No stack trace is reachable: the page has no request-dependent input. The blank-frame path was only exercised with a fixture URL (L4/L5 cover a real form).
- Permission gate: **pass (none by design).** No `auth()`, no `hasFeature()`, no redirect for a signed-in or `/access-pending` visitor; the protected surfaces (`/admin`, `/members`) are untouched and `proxy.ts` is unchanged. No new key is needed and none was added.
- Mobile (360 px): **pass, emulated;** real iPhone and Android carried (L4).
- Adversarial pass re-walked: no redirect parameter is consumed (the page reads no query; the two redirects have fixed same-origin destinations, and QA's N1 about the query being forwarded is a comment error now corrected, not an open redirect); no lookup box (A3/A5 honored); no scarcity copy (A6 pinned); the Zeffy window remains the only control on early or late purchase (A2, carried as L1).

## Follow-Ups (SHIP WITH NOTES)

Each is a tracked item; proposed backlog text is in the block below (the orchestrator assigns IDs and edits `docs/backlog.md`).

- **F1. Chair: one unapproved promise on the page, plus the Q-C list, before the Nov 1 copy freeze.** The "After you register" list says "Someone else can collect for you; they give the same name." That is a pickup-authorization policy. The spec decides "the worker confirms the parent's name on the order"; who else may collect was an open chair question (B-167's old gate 6) and increment 2's dry run is still going to test "a pickup by someone other than the named parent". Phase 1 A5 said the check is a courtesy, not an identity check; this sentence turns the courtesy into a public promise. Recommendation: ask the chair; if there is no answer by Nov 1, delete the sentence (silence is safe, a promise cannot be walked back at the table). Same sitting: Appendix F Q-C1 to Q-C9, Q-P1 to Q-P3, the operating rule that keeps "never the children" true on Friday (stuffy on the table, no hands or faces in frame, no volunteer phone photography of children), and the retention alignment in F1b below.
  - **F1b. Retention wording versus increment 2's ruling.** The page and `/privacy` say sign-up details are deleted by Jan 31, 2027 (increment 2 proposes 30 days after pickup, about Jan 19, so that promise holds) and that the collage "stays online until next year's event" (increment 2 proposes keeping portraits and group photos through the end of the following January, which is later than next December's event). Make the two say the same thing before the freeze; each is one string in `copy.ts` or `facts.ts`.
- **F2. Treasurer sign-off (Q-P4).** The beneficiaries sentence and the Zeffy tip sentence, before Nov 8; and the loss-or-damage wording with the insurer.
- **F3. Launch gates the page cannot pass for itself (G1 to G7 below).** Tracked as one checklist item because they have one owner each and a Nov 8 deadline.
- **F4. Three small page touch-ups (about 15 lines, no schema, no API; absorb into the next ux-developer pass).**
  - **a.** In `open` with an empty URL, hide "After you register" (QA N5). "Zeffy emails your receipt" and "in the window you chose" sit beside "The sign-up form is not ready yet". Gate it on `signupAvailable`. Transient (the URL is meant to land Nov 6), but this is the Nov 8 failure case.
  - **b.** In `after` with `collagePath === null`, add one neutral, promise-free line ("Looking for the photos from the weekend? Contact the club.") so a family returning on Dec 21 is not left with silence (Phase 1 Flow 6).
  - **c.** Show the collage link in `closed` as well as `after` once `collagePath` is set. The Saturday card says "The pictures go online that evening", but the only place the page links to the collage is Monday on. This is increment 2's go-live step; it must flip `collagePath` and this together.
- **F5. Push-day housekeeping.** Set `EFFECTIVE_DATE` in `src/app/privacy/page.tsx` to the push day (QA N7; it says October 12, 2026 now). The four CLAUDE.md edits in Phase 3 "Documentation edits" need the user's approval (Project Structure line, DECISION-118 bullet, a Santa's Workshop bullet, and the `SANTAS_WORKSHOP_NOW` env line). Promote DECISION-120 from Proposed to Resolved after the re-read below. The two stale "no Zeffy API" lines in the spec (139, 185) are increment 2's. Backlog edits and release notes below.
- **F6. Not tracked, recorded.** QA N6 (the Zeffy frame takes focus with no ring on our side) is cosmetic and the frame's own page owns its focus style. QA N4 (dev flight payload echoes the query string) is framework behavior in dev only. When increment 2 decides whether to flip `getPublicWorkshopFacts()`, note that `page.tsx` builds its static `metadata` from the `WORKSHOP_2026` constant directly (deliberately, to stay state-independent), so a flipped loader must not change the head strings.

### Launch gates carried from Phases 3 and 5 (not code; each needs a person or a deployed host)

| # | Gate | Owner | Needed by |
|---|---|---|---|
| G1 | Push the pre-opening page; then L2 (ISR sequence), L3 (curl both 307s on the deployed host), L6 (link-preview card). **Print no QR before L3 passes.** | orchestrator | push by Oct 24 to 27, QR after L3 |
| G2 | Treasurer: beneficiaries and tip sentences (F2) | user | Nov 8 |
| G3 | Build the Zeffy form per Appendix B (question text is a contract with increment 2's mapper), practice purchase flagged to the treasurer and refunded, set sales to Sun Nov 8 12:00 AM and Wed Dec 16 11:59 PM Eastern (L1 records what Zeffy does at each edge), read Appendix D rows for Zeffy text and printed material against the facts, L4 on a real iPhone and a real Android, L5 with the real link (resolves QA N2) | user, orchestrator | form by Nov 6 |
| G4 | Paste `zeffyShareUrl`, deploy | orchestrator | Nov 6 |
| G5 | L7: Nov 8, 12:05 AM Eastern, load twice, record the state and that the form shows | orchestrator | Nov 8 |
| G6 | Create the two events rows from Appendix C in `/admin/events`; L8 | user, qa | after G4 |
| G7 | Art by Nov 1 or accept none; `og.jpg` optional | user | Nov 1 |

### DECISION-120 re-read (for tech-lead, who files)

Established by QA and my own reads: items 1 (no auth, db, fetch, searchParams, client JS), 2 (typed facts behind an async loader), 3 (state function, Eastern strings, dev clock ignored in production), 5 (copy rules held by tests) and 6 (preview deleted; both redirects, on dev and a production server). Not established until the deployed host exists, and already labeled "Unmeasured (rule (a))" in the entry: Zeffy's window as the control (L1), ISR staleness (L2), the redirects on the deployed host (L3), the frame on real phones (L4) and the ticketing-link conversion (L5). Recommendation: promote to Resolved at push and keep that Unmeasured block until G1 and G3 record their observed results.

### Proposed backlog text (orchestrator assigns IDs; only the orchestrator edits `docs/backlog.md`)

**Replace B-166** (stale: "Dec 11 to 13", "modal embed on phones", "manual Full flip", "blocked on the chair's four gating questions"):

> - [ ] **B-166 — Santa's Workshop production sign-up page at `/santas-workshop`.**
>   (added 2026-10-11; built 2026-10-12 from `docs/work-log/2026-10-12-santas-workshop-signup-page.md`, Phase 6 SHIP WITH NOTES; priority: time-boxed to the event: Zeffy form live Sun Nov 8, drop-off Fri Dec 18, photos Sat Dec 19, pickup Sun Dec 20)
>   Shipped: a static, database-free page (DECISION-120) with four states (before, open, closed, after) computed from the Eastern date; the Zeffy ticket form embedded inline only while open, always with an "open in a new tab" button and a `<noscript>` link; $15 per stuffy, no cap, no scarcity wording; the photo, snack and privacy wording with a matching `/privacy` section; `/santasworkshop` as a 307 short address with three year-free UTM tags; the old preview retired by 307; sitemap and a state-independent Open Graph head. Copy says ticket, never donation or tax-deductible.
>   **Remaining to close it (launch gates, not code):** build the Zeffy form on the Club's account per Appendix B of the work-log and paste `zeffyShareUrl` (target Nov 6); set Zeffy's sales window to Sun Nov 8 12:00 AM through Wed Dec 16 11:59 PM Eastern (the page state is cosmetic; Zeffy's window is the control); the practice purchase flagged to the treasurer and refunded; create the two `/admin/events` rows (Appendix C); live checks L1 to L8 (no QR is printed before L3 passes); art by Nov 1 or none; chair and treasurer copy sign-off before the Nov 1 freeze (see the sign-off item); set `EFFECTIVE_DATE` on `/privacy` at push.

**Replace B-168** (stale: "memory book builder", "printed keepsake card"; the plan is a frame plus a collage, and the family page was absorbed into B-167 by increment 2's ruling):

> - [ ] **B-168 — Santa's Workshop family-page delivery by email.**
>   (added 2026-10-11; re-scoped 2026-10-12: the decided plan is a printed 4x6 frame carrying a QR to the day collage, not a memory book, and the per-stuffy family page ships inside B-167; priority: only after B-167, and only if the chair wants an email)
>   What is left is emailing a family their page link. The site has no email path to non-member families, and an email that records "sent" is a durable-claim path: it must use `sendEmailForDurableClaim()` / `sendBulkMemberEmailForDurableClaim()` (DECISION-102/103) with an exhaustive outcome switch, and Phase 2 confirms that before design. A per-stuffy multi-scene book, a PDF and print-on-request are not planned (spec decisions 10 and 20).

**New item: chair and treasurer copy sign-off for the Santa's Workshop page** (priority: must-do before the Nov 1 copy freeze):

> - [ ] **B-nnn — Santa's Workshop page: chair and treasurer sign-off before the Nov 1 freeze.**
>   (added 2026-10-12, Phase 6 of `docs/work-log/2026-10-12-santas-workshop-signup-page.md`; priority: must-do, Nov 1)
>   Chair: decide whether someone other than the named person may collect on Sunday (the page now says "Someone else can collect for you; they give the same name", which no one has decided; delete it if there is no answer); confirm Appendix F Q-C1 to Q-C9 and Q-P1 to Q-P3; sign the Friday operating rule that keeps "We photograph stuffies only, never the children" true (stuffy on the table, no hands or faces in frame, no volunteer phone photography of children); settle collage and sign-up-detail retention so the page, `/privacy` and B-167's purge say the same thing. Treasurer: approve the beneficiaries sentence, the Zeffy tip sentence and, with the insurer, the loss-or-damage wording. Each answer is one string in `copy.ts` or `facts.ts` and one deploy.

**New item: small page touch-ups** (priority: should-do before Nov 8):

> - [ ] **B-nnn — Santa's Workshop page: hide "After you register" when no form exists; two collage-link states.**
>   (added 2026-10-12, Phase 6 of `docs/work-log/2026-10-12-santas-workshop-signup-page.md`; priority: should-do before Nov 8; about 15 lines, no schema)
>   (a) In the `open` state with an empty `zeffyShareUrl`, do not render "After you register" (gate on `signupAvailable`); (b) in `after` with `collagePath` null, show a promise-free "Looking for the photos from the weekend? Contact the club." line; (c) show the collage link in `closed` as well as `after` once `collagePath` is set, flipped together with B-167's publish step (the Saturday card promises photos "that evening").

**Add to B-167** (one line): "When this ships, set `collagePath` and the closed-state collage link together (see the touch-ups item); the page's static head reads the `WORKSHOP_2026` constant and must stay state-independent if `getPublicWorkshopFacts()` is ever flipped to a session row."

### Release-notes draft (no version number, user-facing value only; the orchestrator places it)

**A Visit to Santa's Workshop has its own page.** Families can now read the whole weekend plan at westervillelions.org/santas-workshop: bring a favorite stuffy to IHOP in Westerville on Friday, Dec 18, it has its portrait taken with Santa and Mrs. Claus on Saturday, and it comes home on Sunday, Dec 20, with a printed frame of its picture. Tickets are $15 per stuffy, with no limit on how many stuffies a family can send. Until Sunday, Nov 8 the page says when sign-ups open; while they are open it holds the ticket form, with a button to open the form in its own tab for phones that prefer it; after sign-ups close on Dec 16 it shows how the weekend works, and after the event it becomes a thank-you. It says plainly how photos are handled (stuffies only, never the children, and a stuffy's portrait goes in the public collage only if the family says yes), how snack choices work, and where the money goes. The short address westervillelions.org/santasworkshop now forwards to the page for the poster, the old preview address forwards there too, and the privacy policy now explains what the event collects and how long it is kept.

## Phase 6 handoff

### Summary
SHIP WITH NOTES. The shipped page matches Phase 1's flows, verbs and acceptance checks for everything that exists in the repository, and every Phase 3 ruling and Phase 4 deviation is accepted. What stops a plain SHIP IT is work that has not happened yet (the Zeffy form and practice purchase, the events rows, two real phones, a deployed host), one unapproved pickup promise in the copy, and three small page touch-ups.

### What I did
- Re-read my Phase 1, the orchestrator blocks, Phase 2, Phase 3 (all fifteen rulings, Appendices A to F), Phase 4 and Phase 5, and increment 2's retention and B-168 rulings.
- Read the shipped page, copy, facts, state, clock, loader, components, redirects, sitemap and `/privacy` diff; curled the live dev server for page text, head tags, redirects and sitemap; grepped the page code for brand and forbidden-pattern violations.
- Walked every Phase 1 flow and acceptance check, the orchestrator's named points, and each Phase 3 ruling; separated what is passed from what is carried.

### Outputs
- This section and the Per-Phase Status row of `docs/work-log/2026-10-12-santas-workshop-signup-page.md`. No code, CLAUDE.md, `docs/decisions.md` or `docs/backlog.md` edited; nothing committed; no production data read or written.
- Proposed backlog text (B-166 and B-168 replacements, two new items, one B-167 line) and a release-notes paragraph, above, for the orchestrator.

### Open questions / handoff notes
- **Orchestrator:** (1) ask the chair F1 in one line now: "May someone other than the named person collect on Sunday, or should the page stop saying so?"; (2) the pipeline closes on SHIP IT only; this entry ships with notes, so each follow-up needs its own backlog line; (3) do not print a QR before L3; (4) at push, set `EFFECTIVE_DATE`, run `/release-notes`, and ask the user to approve the four CLAUDE.md edits; (5) tech-lead promotes DECISION-120 per the re-read above.
- **ux-developer (next pass):** F4 a to c.
- **Increment 2:** F1b retention alignment and the collage-link flip belong in its Phase 3/4 copy checklist.

---

## Post-deploy live checks (orchestrator, 2026-10-12, v1.93.0 at commit 6343fa6)

| Check | Result |
|---|---|
| Deploy | `/santas-workshop` served the new page about 2 minutes after the push (HTTP 200, `before` state: "opens Sunday, Nov 8") |
| L3 redirects on the deployed host | `/santasworkshop` → 307 to `/santas-workshop?utm_source=poster&utm_medium=qr&utm_campaign=santasworkshop`; `/santas-workshop/preview/x` → 307 to `/santas-workshop`. **PASS — the poster QR may be printed.** |
| L6 link-preview head | `og:title`, `og:description` (dates, IHOP, $15), `og:image` (`/images/og-default.jpg` fallback until art lands), `twitter:card` all present and state-independent. PASS (card rendering in a real client not yet eyeballed) |
| L2 ISR staleness | not measurable until a state boundary; first candidate is Nov 8 00:00 Eastern (G5) |
| L1, L4, L5, L7, L8 | still open: Zeffy window, real phones, ticketing link, launch night, events rows |

**G3/G4 progress (orchestrator, 2026-10-12):** the user created the Zeffy ticket form (`https://www.zeffy.com/en-US/ticketing/a-visit-to-santas-workshop`); `zeffyShareUrl` is set in `facts.ts` (uncommitted; facts tests pass). `toEmbedUrl` yields `https://www.zeffy.com/embed/ticketing/a-visit-to-santas-workshop` and the page renders the iframe in `open` with the ticket-appropriate title. Headless Chromium received HTTP 403 and an `X-Frame-Options: sameorigin` refusal from zeffy.com — consistent with Cloudflare blocking a headless client (Zeffy 403s all non-browser fetches), so L5 is **not yet established**; the user is checking in a real browser against the clocked `:3000` server and a standalone test page. The question-text verification against the export (G3 step 3) and the practice purchase remain.

**L5 (orchestrator, 2026-10-12, user's real browser):** the embed URL `https://www.zeffy.com/embed/ticketing/a-visit-to-santas-workshop` renders the ticket form in a plain iframe — the headless 403 was Cloudflare's bot check. **L5 PASS for the URL shape.** But the rendered form shows an entity problem: an "Add a donation … to support Westerville Lions Club Foundation Inc" block with a suggested $242, "Tax receipt eligible", "You'll receive a tax receipt for $242", and a "Donate" button. Either the form was created on the Foundation's Zeffy organisation (the spec and DECISION-120 require the **Club's**), or the ticketing form's optional extra-donation feature is on. Raised with the user: confirm the organisation, turn the extra donation off, set the event end to Sun Dec 20 3:00 PM (shows 5:00 PM). The page's own copy is unaffected; the frame's text is Zeffy's. Appendix D row for Zeffy text must be re-walked after the fix.

**User clarification (2026-10-12):** the ticket itself is not receipted; only Zeffy's optional *extra donation* block issues a tax receipt, and that gift goes to the Foundation. So the rendered wording is correct for what it describes and the organisation is the one the club already uses for every Zeffy form. Consequences recorded: (1) our page copy stays "ticket" and never mentions receipts; Zeffy's receipt line applies to the optional gift only (Appendix D row for Zeffy text: acceptable); (2) the extra-donation input showed a pre-filled $242 — asked the user to clear any default amount so a family cannot pay $257 by not noticing; (3) event end time to be set to Sun Dec 20 3:00 PM; (4) for the books: a ticket payment and an extra donation arrive in ONE Zeffy payment with two item types (`ticket`, `additional_donation`); ticket money is Club Public Funds income, the extra donation is a receipted Foundation gift — exactly B-172's itemized-sweep case. Increment 2's mapper must keep `additional_donation` items on the order (amount, for the treasurer) and never turn them into stuffies; flagged for Slice 1 QA and Phase 6.

# Santa's Workshop Sign-up Page — Work Log

> **Slug:** `2026-10-11-santas-workshop-signup`
> **Reserved IDs:** B-166, B-167, B-168; DECISION-118 (all four used and filed at ship, 2026-10-11)
> **Surface:** public (one page under `src/app/santas-workshop/`, plus a vanity subdomain redirect); admin touch only if the Zeffy form link is managed through an existing admin surface
> **Permission(s):** none for the public page; existing `campaigns.*` / admin keys cover any admin-managed form link (Phase 1/2 to confirm)
> **Estimated complexity:** small to medium (re-scoped 2026-10-11 to a static clickable prototype: about six static screens with sample data, no schema, no API, no permission, no email)
> **Pipeline mode:** Accelerated (prototype; Phase 2 skipped unless a new dependency is proposed, Phase 3 brief). Was Full before the 2026-10-11 prototype re-scope.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES (prototype); production NOT YET (BLOCKING FACT: Zeffy account) | 2026-10-11 |
| 2 — Architectural review | architect | Skipped | Accelerated mode; no new dependency, no schema, no new shared primitive (orchestrator note under Phase 2) | 2026-10-11 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer: ux-developer (single); no dependency, so Phase 2 skip stands | 2026-10-11 |
| 4 — Implementation | ux-developer | Complete | Built as designed, no cuts; gates green (see Phase 4 handoff) | 2026-10-11 |
| 5 — Verification | qa | Complete | PASS on re-verification (first pass FAIL: D1 pinned bar over footer, D2 /book heading order; both fixed and re-measured); real-phone check of the bar still open | 2026-10-11 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (one copy fix recommended before commit; real-phone check and the chair's decisions tracked) | 2026-10-11 |

---

## Origin (orchestrator, 2026-10-11)

**Source.** An approved member proposal in production, "A Visit to Santa's Workshop" (type: both, approved 2026-09-17, chair Lion Howard). The user asked for the website to run the operation ("he wants to run the operation by building the functionality via our website. maybe put it at santasworkshop.westervillelions.org. we have zeffy as our payment provider"), then after a brainstorm and a one-page plan: "open the pipeline for the signup page. be creative but modern. i can figure out the artwork needed."

**The operation (from the proposal, club content, no personal data).** Preschoolers send a favourite stuffed animal ("stuffy") on an imaginary train trip to the North Pole. Parents drop the stuffy off on a Friday evening at IHOP, where a train conductor checks it in; on Saturday the stuffies are staged in photos at a decorated house (Mrs. Claus wrapping presents, Santa building toys in the workshop, cookies, Santa reading The Night Before Christmas, an elf feeding the reindeer); each stuffy gets a memory book; parents pick up at IHOP on Sunday. $15 per stuffy. Proposal estimate: $900 income (60 stuffies) against $400 cost. Publicity: invitation to local preschools, social media, a QR code.

**The plan the user and orchestrator agreed (one-page plan shared with the chair, not in the repo).**
- Dates: Friday Dec 11 to Sunday Dec 13, 2026 (second Saturday of December; the user's best guess, not yet confirmed with the chair or IHOP). Cap 60 stuffies.
- Registration AND payment through ONE Zeffy ticket form with custom questions (parent contact, child's first name, stuffy's name, what the stuffy is, drop-off window, preschool dropdown, optional note to Santa). No Google Form. Zeffy caps ticket count and charges the club no fee. Zeffy has no API; the sign-up list is a manual export later (Phase 2, not this pipeline).
- Three website phases: **Phase 1 (this pipeline), ready by 2026-11-01:** the public sign-up page with the story, dates, price, how it works, and the Zeffy form embedded; QR code target; vanity address `santasworkshop.westervillelions.org` redirecting to the page. Registration opens with the preschool invitation around 2026-11-08. **Phase 2 (later pipeline), by 2026-11-28:** roster, check-in on a phone, per-family tracking page. **Phase 3 (later pipeline), by 2026-12-05:** memory book builder. Phases 2 and 3 are out of scope here except where Phase 1 must leave room for them (e.g., a stable URL per family later, a page section that can become "track your stuffy").
- The page doubles as the prototype the chair screenshots for IHOP and the preschools, so it must look finished before the Zeffy form is live (the form can be embedded in test mode or behind a "registration opens Nov 8" state).

**Design direction from the user.** "Creative but modern." The user will supply artwork; the design must work with clearly marked art slots (hero, scene thumbnails, a train/journey motif) and look complete with placeholders. Brand: lions-blue/lions-gold stay present (club identity), but this page may carry its own seasonal palette as long as it reads as the club's site. Mobile-first: the primary visitor is a parent on a phone who scanned a QR code at preschool. No account, no login, one screen to the form.

**Existing building blocks (reuse, do not reinvent).** `ZeffyEmbed` (`src/components/campaigns/zeffy-embed.tsx`, iframes `https://www.zeffy.com/embed/…`; CSP `frame-src` already allows Zeffy); `ZeffyButton`; the `campaigns` table (`zeffyLink`, `image`) and `/donate` cards; Turnstile for public forms (not needed if Zeffy hosts the form); public page hero conventions (CLAUDE.md UX Guidelines, `py-20` blue gradient hero, `rounded-2xl` cards, `rounded-lg` buttons, focus rings, 44px targets); `robots.ts` / `sitemap.ts`; the Ledger's Zeffy fund routing (proceeds to the Club Activity fund; treasurer concern, not this page).

**Open questions for Phase 1 to carry (do not block on them).** (1) Dates and windows unconfirmed with the chair/IHOP. (2) Whether the Zeffy form link is hard-coded, env-driven, or a `campaigns` row (the latter gives the treasurer's existing routing and an admin edit path). (3) Subdomain: Vercel domain alias + redirect vs DNS-level redirect (deployment-engineer question; Phase 2 architect rules). (4) Pre-registration state: what the page shows before the form is live and after the cap is reached (Zeffy closes the form; the page should say so). (5) Whether any child-related copy needs a privacy line (only stuffies are photographed; child first name only on the form).

**Guardrails.** Public repo: no personal data; the chair's first name in a governance context is fine, no contact details. No live email, no production writes. Pipeline: Phase 1 analyst → Phase 2 architect → Phase 3 tech-lead → Phase 4 (likely ux-developer, with deployment-engineer for the subdomain) → Phase 5 qa → Phase 6 analyst. Reserved IDs in the header.

---

# Phase 1 — Functional Refinement (analyst)

> **Scope note (read first).** Re-scoped mid-review by the user: *"this is a prototype so we don't need all the functionality. just want to show and confirm look and feel and workflow with howard."* and *"i also wonder if we should do a paperless delivery."* This pipeline therefore builds a **clickable, static prototype** of the whole family experience, not the production sign-up page. Sections marked **Prototype** govern what Phase 3/4 build now. Sections marked **Production follow-ups** record what the review found for the real build so none of it is lost. Dates below are the user's best guess and are shown in the prototype as "proposed".

## VERDICT

**READY WITH NOTES** (for the prototype). Phase 2 may be skipped (Accelerated mode) provided the build adds no npm dependency; the notes below become Phase 3 inputs.
The *production* build is **NOT YET ready**: it is gated on the BLOCKING FACT in Open Questions (which Zeffy account issues the form) and on the dates being confirmed with the chair and IHOP.

## ONE-LINE TAKE

> A static, phone-first, unlisted walkthrough of the whole Santa's Workshop experience (QR scan, story, reserve and pay, confirmation, follow-your-stuffy, memory book, conductor check-in) with sample data and marked art slots, built so the chair can say "yes, that's the event" or point at what to change before anything real is built.

## Pipeline mode (recommended)

**Accelerated.** Phase 2 skipped unless a new dependency is proposed (none should be needed: CSS-only motion, no QR library, no animation library, art are static files). Phase 3 brief (route map, component list, sample-data module, noindex mechanics, the unit test named below). Implementer: **ux-developer** (no schema, no API, no permission, no migration, no email). The work-log header was updated to match.

## Prototype — where it lives

**Recommend `/santas-workshop/preview` (and sub-routes), not `/santas-workshop`.**
- The final URL `/santas-workshop` is **reserved for the production page** and deliberately returns 404 while only the prototype exists. A prototype at the final URL would be the thing a QR code or a shared link lands on the day someone prints early; a 404 is a better failure than a page full of sample data and a fake roster.
- Unlisted means: no nav, no footer link, not in `sitemap.ts` (it is a hand-written list, so absence is the default; do not add), `robots: { index: false, follow: false }` in the segment layout metadata, no `canonical`. Do **not** add the path to `robots.ts` `disallow`: robots.txt is public, so it advertises the URL and also stops crawlers from reading the `noindex`.
- Unlisted is not private: anyone with the link can open it, and it ships through `main`. Therefore nothing on it may be real (see adversarial pass).
- Every screen carries a slim **Prototype** banner ("Prototype: sample content, nothing here is real or saved") and a screen switcher so the chair can hop between screens on his phone without typing URLs.
- Suggested sub-routes: `/santas-workshop/preview` (landing), `/preview/confirmed`, `/preview/follow` (tracking), `/preview/book`, `/preview/check-in`, optional `/preview/photo-station`.
- Prototype landing states (Before opens / Open / Full / After the event) are switched by a client-side control in the banner, **not** a URL parameter, so no user-controlled value is reflected into the page.

## Prototype — screens and what each shows

Mobile first (design at 390px, check 360px, then scale up). Cards `rounded-2xl`, buttons `rounded-lg`, 44px targets, focus rings, `lions-blue` / `lions-gold` visible on every screen.

| # | Screen | Who (real-life) | What it shows |
|---|--------|-----------------|---------------|
| S1 | **Landing / sign-up** | Anonymous parent, from the QR code | Hero (art slot), eyebrow + title, a "Dec 11-13 · $15 per stuffy · 60 spots" fact row, primary **Reserve a spot** button (also pinned to the bottom on phones), the story in the club's warm voice, **three steps** (Friday drop-off at IHOP with the conductor; Saturday the journey; Sunday pickup with a memory book), the five **photo scenes** (art slots), **what to bring**, the **form card** (see below), a short FAQ, privacy line, contact, "Presented by the Westerville Lions Club" with a link to `/about`. Four states, below. |
| S2 | **After you pay** | Parent, minutes after paying | What the family sees and gets: "You're booked" summary (sample), the three dates as a calendar-style list, "bring your stuffy to the Friday window you chose", "your tracking card is handed to you at check-in" (flagged *Phase 2 idea*). Labeled as a mock of what Zeffy's receipt plus the club's next-steps would feel like; the real post-payment screen is Zeffy's. |
| S3 | **Follow your stuffy's journey** | Parent, over the weekend | A sample stuffy ("Pip", a penguin) moving along a vertical track through the stops: checked in at IHOP, boarded the train, arrived at the North Pole, Mrs. Claus's wrapping room, the workshop, cookies, the bedtime story, feeding the reindeer, ready for pickup. Current stop highlighted, finished stops show a photo slot, upcoming stops grey, "last updated" time, pickup window, the privacy line. Opaque, name-free URL shape shown as a note. Shows the **stuffy's name only, never the child's**. |
| S4 | **Memory book (paperless)** | Parent, Sunday | A phone-sized flipbook: cover with the stuffy's name in a name-plate slot, one page per scene with a photo slot and a caption, a conductor's certificate page, a **Save as PDF** and **Share with grandparents** button (inert, marked), and a one-line note "a printed keepsake card is handed over at pickup" showing the hybrid option. |
| S5 | **Conductor's check-in** | Volunteer, Friday evening, standing in a restaurant lobby | A phone list for the conductor: big counter ("23 of 60 checked in"), search box that filters the sample list locally, rows with tag number, stuffy name and type, drop-off window, a care-note line ("one loose eye"), status chip, and a large **Check in** button. Tapping toggles the chip **in memory only**; reload resets. A "walk-up / not on the list" row demonstrates the exception path. Sample families only. |
| S6 (optional) | **Saturday photo station** | Volunteer at the decorated house | Pick a scene, pick the stuffy by tag, "Take photo", "Done, send to next stop". This is the missing link that explains how photos reach S3 and S4; the chair needs to see it to judge volunteer effort (5 scenes x up to 60 stuffies is about 300 photos in one day). Recommend including; drop first if time is short. |

**Landing states (S1 toggle):**
| State | Hero CTA | Form card | Copy intent |
|-------|----------|-----------|-------------|
| Before registration opens | "Registration opens Nov 8" (disabled-looking, but readable; not a dead button) | Replaced by "Opens soon" with the date and "scan this code again then" | Full story and photos visible so the page works as the chair's pitch to IHOP and the preschools |
| Open | "Reserve a spot, $15" | Placeholder card where the Zeffy form goes, listing the questions it will ask | Normal |
| Full | "All 60 spots are taken, thank you" | "The train is full this year" + how to reach the chair/club, + "we'd love to see you next year" | The page cannot read Zeffy (no API), so in production this state is flipped by a person; the Zeffy form itself also shows its own sold-out message |
| After the event | none | none | A memory: "Thank you for riding with us", sample photo strip, "see you next December". The URL stays alive; do not redirect |

**Zeffy form on S1 (prototype default):** a realistic **placeholder card**, not a live form: it shows the 390px-wide look of the form (ticket quantity row, fields as they will appear, the "Pay with Apple Pay / card" row), is labeled "Zeffy form goes here", and its **Reserve** button leads to S2. If the user can create a Zeffy test form in a few minutes, swapping the placeholder for the embed is a one-component change and worth doing only because it also answers two production facts (per-ticket questions, post-payment redirect; see follow-ups). Do not spend more effort than that on it, and do not make `campaigns` rows, env config, or treasurer routing part of the prototype.

**Custom questions the card lists (confirm with the chair which belong on Zeffy):** parent name and email (Zeffy's own buyer fields), parent mobile (custom), child's **first name** only, stuffy's name, what the stuffy is (type and colour, so the conductor can find it in a pile), drop-off window (dropdown), preschool (dropdown plus "other / none"), care note ("loose eye, sleeps with a night-light"; helper text: no medical details, no last names), optional note to Santa, one required acknowledgment ("the Lions will take great care of your stuffy; they cannot be responsible for loss or damage"), one optional checkbox ("OK to share stuffy-only photos on the club's social pages"). Whether the acknowledgment wording needs the club's insurer is a chair/treasurer question, not a page question.

## Prototype — art slots the user supplies

Every slot renders a labeled, dashed placeholder (slot name + target size + aspect ratio) until art arrives, so the page looks complete and the user can see exactly what goes where. Files land under `public/images/santas-workshop/`; vector as SVG, photos/illustration as WebP or high-quality JPEG at 2x. Every image needs alt text (the user or the page author supplies it; decorative art is marked decorative).

| Slot | Where used | Aspect / size | Notes |
|------|-----------|---------------|-------|
| Hero scene | S1 top | Master 3:2 at 2400x1600, keep the focal subject in the centre third; the page crops to ~4:5 on phones and ~21:9 on wide screens | Night-sky / winter-town feel; must leave quiet space for the title or the title sits below it on phones |
| Train and track motif | Divider through S1, vertical line on S3 | Engine+cars SVG about 3:1 (e.g. 900x300, transparent); a seamless horizontal track tile 1200x120 | The journey motif; the same track becomes S3's route line |
| Scene illustrations/photos x5 | S1 gallery, S3 stop rows, S4 pages | 4:3 at 1200x900 each | Mrs. Claus wrapping presents; Santa in the workshop; cookies; Santa reading The Night Before Christmas; an elf feeding the reindeer |
| Step icons x3 | S1 "how it works" | 1:1, SVG, 256x256 | Drop off; the journey; pickup |
| Conductor character / stamp | S2, S5, S3 "checked in" stop | 1:1, 512x512, transparent | Reused as the check-in badge |
| Memory-book cover | S4 | Portrait 4:5 at 1200x1500 with a reserved name-plate area (about 70% width, 12% height) | The stuffy's name is typed into the plate |
| Sample stuffy photos x5 | S3, S4 | 4:3 at 1200x900 | One recognizable plush (or a placeholder silhouette) in each scene; stuffies only, no children in frame |
| Open Graph / share image | Production only | 1:1 and 1.91:1 (1200x630) | Production follow-up |

Art that the user must **not** supply without permission: IHOP's logo or branding (name in text only until IHOP agrees); any preschool's logo.

## Prototype — design constraints (inputs to Phase 3/4)

- **Palette:** club identity must read on every screen. `lions-blue` / `lions-blue-dark` carry the night-sky sections and `lions-gold` is the warm accent (lantern light, buttons on dark). A seasonal cranberry may be used **sparingly** (the train, a ribbon) but as a page-scoped CSS variable, **not** by adding `lions-red` to the theme (CLAUDE.md: undefined and renders transparent). Gold is for accents and dark-background text, not text on white (contrast); gold buttons keep dark text as the existing `ZeffyEmbed` button does.
- **Fonts:** the CSP has `font-src 'self'`. Any display face must be self-hosted through `next/font` like Open Sans; no Google Fonts link tags.
- **Motion:** subtle (a slow drift of snow or steam, a train that eases into place as the track scrolls into view), all behind `motion-safe:` and fully static under `prefers-reduced-motion`. No autoplay audio or video, no auto-advancing carousel.
- **Accessibility:** text contrast 4.5:1, visible focus on all links/buttons, 44px tap targets, headings in order, the S3 route readable as a list (not only as a drawing), state conveyed by text as well as colour.
- **Brand rules:** `rounded-2xl` cards, `rounded-lg` buttons (hero CTA may use larger padding and the `transform hover:scale-105` hero variant), `<ConfirmDialog>` if any confirm is ever needed (none expected), the site header and footer remain so it reads as the club's site.
- **Tone:** warm, a little playful, never saccharine; the club voice from CLAUDE.md Content Guidelines. De-emphasize eyecare as usual (irrelevant here).
- **One source of truth for facts:** dates, windows, price and cap live in one small module the screens import. The prototype's dates are *proposed*; they will change, and they will change after posters print.
- **Sample data hygiene:** fictional stuffy names and types, tag numbers, "Family 07" style labels; no real names, no real child names, no phone numbers or emails anywhere. S5's sample rows show no contact details at all.
- **Unit test the design should name:** one test that the preview layout exports `robots: { index: false }` and one that `sitemap.ts` output contains no `/santas-workshop` URL (guards the "unlisted" promise).

## User Verbs (Pass 1)

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous public visitor (parent) | Scan the QR code, read the story, tap Reserve, choose quantity, type the family and stuffy details, pay, read the confirmation | One-time per family |
| Anonymous public visitor (parent) | Open the tracking link, watch the stuffy move through stops, view photos | Several times over one weekend |
| Anonymous public visitor (parent) | Open the memory book on a phone, save the PDF, share it | Once or twice |
| Volunteer (conductor), no account today | Find a family on a phone list, tap Check in, add a care note, handle a walk-up | About 60 times in a few hours |
| Volunteer (photo station) | Pick scene and stuffy, take a photo, move the stuffy on | Up to about 300 times in a day |
| Chair (reviewer of the prototype) | Open the prototype on his phone, flip through the screens and landing states, and say what is wrong | A few review sessions |

Surfaces note: all three volunteer/family surfaces are **anonymous** in the prototype. In production the conductor and photo screens are *not* public and need a gate (Phase 2 question below); the prototype's lack of a gate is acceptable only because it contains no real data.

## Flows (Pass 2)

**Flow 1 — Parent signs up (S1 to S2).** QR code at preschool → phone camera opens the link (1 tap) → S1 landing → scroll story → tap **Reserve a spot** (tap 2) → Zeffy form (quantity, then details, then payment) → Zeffy's thank-you → (S2 mock of the club's next-steps).
- **Tap count, landing to paid:** roughly 5 taps plus typing 8 to 10 short fields on the real form: Reserve (1), quantity/continue (1-2), preschool and drop-off window dropdowns (2), payment (1 tap with Apple Pay or Google Pay; 3 extra fields with a card). Treat that as an estimate until a Zeffy test form exists. The page's job is to make the first tap obvious (a pinned Reserve button on phones) and to keep the story out of the way after that.
- Failure (production): form blocked by an ad blocker or CSP, or Zeffy down → the card shows "Having trouble? Open the sign-up form in a new tab" (a plain link to Zeffy) and the club's contact. Sold out → Zeffy shows its own message; the page copy never relies on being right about the count.
- **Prototype:** the placeholder card's Reserve goes straight to S2 so the chair feels the end-to-end path.

**Flow 2 — Parent follows the stuffy (S3).** Tag with QR given at Friday check-in → opens tracking page → sees the current stop and photos as they arrive → at the final stop sees "ready for pickup Sunday, 1-3 pm" (window proposed).
- Failure: link opened before check-in → "Your stuffy hasn't boarded yet. Check back after Friday check-in." Wrong or expired link → friendly "We can't find that journey" with the club contact, never a stack trace and never a hint of whether another family's page exists.

**Flow 3 — Parent gets the memory book (S4).** Sunday pickup tag or tracking link → book opens on the phone → page through → Save as PDF / Share. Hybrid: a pre-printed card at pickup.
- Failure: photos not ready → "Your book is being put together; check back this evening."

**Flow 4 — Conductor checks families in (S5).** Friday evening: open the roster on a phone → search by stuffy or tag → Check in → hand over the tracking card → counter ticks up. Exception: walk-up not on the list → "Add walk-up" (prototype shows the row only).
- Failure (production): no signal in the lobby → the list must still work (offline-tolerant) or be printable; flag for Phase 2.

**Flow 5 — Volunteer photographs (S6, optional).** Pick scene → pick stuffy → photo → next. Failure: wrong stuffy tagged → undo within the screen.

**Flow 6 — Chair reviews.** Chair opens `/santas-workshop/preview` → uses the screen switcher and state toggle → screenshots for IHOP and the preschools → tells the user what to change. The prototype's **success** condition is a short list of decisions from Open Questions, not a flawless page.

## Permissions (Pass 3)

- **Prototype:** none. Public static pages, no session, no `hasFeature()`, no API, no new key. `src/proxy.ts` already lets every path outside `/admin` and `/members` fall through, so no proxy change is needed.
- **Production (for the Phase 2 pipeline, not now):** the public sign-up page needs no permission. The conductor check-in and photo-station screens are volunteer surfaces and need a gate: either a new key (e.g. `santas_workshop.run`, bound to admin plus a committee/role the chair chooses) behind a member sign-in, or a short-lived link; this is exactly the kind of thing the chair should react to on S5 ("do your volunteers have accounts?"). Members must have user accounts per standing policy; non-member volunteers (youth, spouses) do not, which pushes toward a link/PIN. The tracking page is a capability link (unguessable token), public by design but indexed by nobody.

## Gaps the Request Didn't Address (Pass 4)

- **Prototype realism vs honesty.** A page that looks finished and takes no money can mislead if shared. Mitigation: the banner on every screen, "Reserve" leading only to a mock, no real contact form, and the "Opens soon" state as the default view when sharing outside the chair.
- **Page promises Phase 2.** The landing page may mention "you'll get a link to follow your stuffy's journey" **only if** Phase 2 is committed. The prototype shows it (so the chair can confirm it is wanted) but in S1 the sentence is isolated in one removable block, marked with the Phase 2 chip, and production copy must not carry it unless committed.
- **Tracking-link delivery.** The site sends no email in this pipeline, and Zeffy has no API, so per-family links cannot ride Zeffy's receipt. Cheapest workable path: hand each family a **card with a QR at check-in** (no email, no data flow). Offered as the recommended default; the alternative (emailing from the club) is out of scope here and would be a durable-send design in its own pipeline.
- **Privacy line must be true.** Draft: "We only photograph stuffed animals. We ask for your child's first name so Santa and the conductor can say hello; it is never posted, and we never photograph children." That promise needs a Saturday rule (no children at the house; no phones out at the IHOP hand-off by club volunteers) the chair should agree to. The tracking page and memory book show the **stuffy's name only**.
- **Zeffy checkout extras.** Zeffy's checkout may add an optional contribution/tip prompt or collect an address. Unverified. Copy should say "$15 per stuffy" (not "$15 total") until a test form shows the real checkout.
- **Entity framing.** `/donate` explains that gifts go to the Foundation (501(c)(3)) and are tax-deductible. Santa's Workshop proceeds are intended for the Club's Activity fund; the page must **not** say "tax-deductible" and must not be styled as a donation. It also should not be a row that appears on `/donate`'s campaign grid (see follow-ups).
- **Capacity reality.** 60 spots over one drop-off evening: window capacity (how many families per 30 or 45 minutes) is a chair decision that shapes S5 and the dropdown.
- **One family, many stuffies.** Does a family buy 2 or 3 tickets, and does Zeffy ask the custom questions once per ticket or once per order? Decides whether "one stuffy per ticket" is enforceable. Answerable only with a Zeffy test form.
- **Adjacent event.** The club's Rudolph 5K day (Sunday Dec 6) is five days earlier; the same volunteers carry both. Not a blocker; worth the chair's glance.
- **Empty/failure/offline states** for every prototype screen listed in Flows; **mobile** at 360px; **OAuth/password paths** not applicable (no sign-in); **Google Group sync** not applicable; **email queue** not applicable (nothing sends).
- **Accessibility of the journey drawing** (listed in constraints).

## Adversarial Pass (Pass 5)

- **Unlisted is discoverable.** Nothing real may be on the prototype: sample names and tags only; no live Zeffy link that takes money; no real contact details; S5 and S6 mock the *shape* of volunteer tools, not data. If a live Zeffy test form is embedded, keep it in test mode and unpublished.
- **Redirect/parameter reflection.** No `callbackUrl`, `next`, or query parameter is read or reflected. The state toggle is client state, not `?state=`. Production vanity-subdomain redirect must go to a fixed, hard-coded canonical URL, not a passed one.
- **A parent lands after the cap.** The page cannot know the count (no API), so it must never display "N spots left". Production: a person flips the Full state; Zeffy's own sold-out message is the source of truth inside the form.
- **Two parents buy the last ticket.** Zeffy's concern; the page doesn't claim availability, so there is nothing to contradict.
- **A child's name in a URL or page title: never.** Tracking tokens are opaque; `<title>` is generic ("Your stuffy's journey"); no first name in query strings, analytics events, or the share card. Tag numbers are not names.
- **Iframe blocked (CSP/ad blocker).** Production fallback link beside the form; the CSP already allows `https://www.zeffy.com` in `frame-src`. The existing modal `ZeffyEmbed` titles its iframe "Donation form powered by Zeffy"; production needs a ticket-appropriate title.
- **QR printed before the URL is final.** Pin now: canonical `https://westervillelions.org/santas-workshop`; vanity `santasworkshop.westervillelions.org`. The prototype's 404 at the final URL prevents an early print landing on sample data.
- **Date changes after posters print.** Dates in one module; the page is the source of truth the poster points at; consider "dates may change, check this page" in small print on the poster.
- **State-machine shortcuts / enumeration (production).** Tracking tokens high-entropy, same response for "unknown" and "expired", rate-limited; the roster/photo screens reject unauthenticated requests server-side, not by hiding the link.
- **Input boundaries / self-targeting.** No inputs in the prototype (the S5 search filters sample data in the browser). Care-note free text in production is untrusted: escape everywhere, cap length.

## Out of Scope (confirm with user)

- Any real roster, check-in write, photo upload, tracking token, or memory-book builder (later pipelines); any stored data about children or families.
- Any email from the site (confirmations, tracking links, reminders). Zeffy sends its own receipt.
- `campaigns` rows, env-driven form links, treasurer/Ledger routing, admin editing of dates or state.
- Subdomain redirect, Open Graph image and title polish, sitemap/SEO inclusion, an `events` row for Dec 11-13, structured data. (One line each under follow-ups.)
- Waitlist, refunds, cancellations, accounts for parents.
- Audio, video, or heavy animation.

## Open Questions

**Prototype-time questions for the chair (these are what the prototype is meant to settle).** Each has a recommended default; none block building the prototype.

1. **Memory book: printed, paperless, or paperless with a printed add-on?**
   - *Printed:* a keepsake in the child's hands at pickup is the emotional payoff; but printing 60 photo books between Saturday afternoon's photos and Sunday pickup is a production crunch (same-day print is costly and fragile; volunteer assembly the night before is the real risk), and the cost is the largest variable against the proposal's $400 estimate (I have not seen the breakdown).
   - *Paperless:* ready Saturday night, no print cost, easy for grandparents out of town to share; but no object at pickup, needs a smartphone, and the club must hold the photos online for some period (a retention question) — and families without a phone need a printed copy on request.
   - *Hybrid:* paperless book plus a small pre-printed keepsake **card** (train ticket / passport with the stuffy's name added at check-in) handed over Sunday, printable ahead of time with no photos.
   - **Recommended default: paperless book + pre-printed keepsake card**, with print-on-request for families without a phone. The prototype's S4 shows exactly this.
2. **Does the family get a tracking card with a QR at Friday check-in?** Default: yes (no email needed).
3. **Do photos appear live during Saturday or all at once Saturday evening?** Default: live per stop; confirm the volunteer effort on S6 (about 300 photos) is realistic. Fallback: all-at-once, which simplifies S3 to "arrives Saturday evening".
4. **How many tickets per family and how many drop-off windows?** Default: max 3 per order; two 45-minute windows Friday evening (capacity per window is the chair's call).
5. **After the cap: waitlist or not?** Default: no waitlist; the Full state tells people to check back and gives the club contact.
6. **Who may collect a stuffy on Sunday?** Default: whoever holds the pickup/tracking card.
7. **Title and tone:** "A Visit to Santa's Workshop" (proposal title) vs shorter. Default: keep the proposal title; URL stays `/santas-workshop`.
8. **Should the page name IHOP and the preschools?** Default: IHOP named in text, no logos, until IHOP agrees; preschools appear only in the form dropdown.
9. **Volunteers on S5/S6:** do they have accounts (members) or are they spouses/youth who don't? Decides the Phase 2 gate. Default: assume a mix; plan for a link/PIN.
10. **Photo-share checkbox and acknowledgment wording** on the Zeffy form: keep both? Default: yes; wording to the treasurer/insurer.

**BLOCKING FACT (blocks the production build, not the prototype) — not defaulted:**
11. **Which Zeffy organization account will issue the ticket form: the Club's or the Foundation's?** It decides where the money lands, whether any "tax-deductible" language is possible, and whether the treasurer must move it afterward. Design for both outcomes:

| Outcome | What it means for the page | What it means for the books |
|---------|---------------------------|-----------------------------|
| Club Zeffy account | No deductibility language; copy "ticket" not "donation" | Proceeds belong in the Club Activity fund with no correction |
| Foundation Zeffy account only | Page cannot imply a donation or a deduction either way; the form must read as a paid event | Proceeds would arrive in the Foundation's books; the one existing cross-entity Move is deliberately narrow (a gift physically deposited in the Club's bank) and does not obviously fit a Foundation payout, so do not assume it rescues this — the treasurer must decide before the form is created |

Ask the treasurer in one line before Phase 4 of the *production* pipeline. No Verify-First SQL is needed; this is a question about Zeffy accounts, not a database fact.

**Dates (fact, chair/IHOP):** Dec 11 (Fri) to Dec 13 (Sun) 2026, drop-off Friday evening, photos Saturday Dec 12, pickup Sunday window, house location, registration opening around Nov 8. The prototype shows them as "proposed".

## Production follow-ups (for the real build; not in this pipeline)

One line each, in the order the real pipeline should take them:
- **Form link source of truth.** Hard-coded constant (simplest) vs a `campaigns` row (gives admin edit and an `isActive` kill switch, but the row would appear on `/donate` and in the members-only list unless a discriminator is added, which is a schema change). Decide in the production Phase 3 after F11 is answered.
- **Date-driven states.** Before/Open/After computed from dates in one module (Eastern time, not UTC); "Full" is a manual flip.
- **Embed behavior on a phone.** Do not inline the iframe on a 390px screen (nested scroll inside the page); open Zeffy in the existing full-screen-ish modal (`ZeffyEmbed`) with a "open in new tab" fallback link; parametrize the iframe title; verify Apple Pay/Google Pay inside the frame (Permissions-Policy already lists `payment=(self "https://www.zeffy.com")`).
- **Zeffy test form** before launch: per-ticket questions, post-payment redirect or thank-you URL, tip/address prompts, sold-out message.
- **Subdomain** `santasworkshop.westervillelions.org`: who controls DNS for the apex domain is a fact to establish; mechanism is architect/deployment-engineer work; target a fixed canonical URL; QR encodes the vanity address only after it is verified live, and a temporary (not permanent) redirect so the target can move.
- **Open Graph / share card** (1200x630 and 1:1 image, title, description) so the link looks right on social media.
- **Sitemap** inclusion and removal of `noindex` when the production page replaces the prototype; add an `events` row for Dec 11-13 so `/events` and the calendar carry it.
- **Phase 2:** roster, check-in, tracking token model, volunteer gate/permission, retention of any family data, offline tolerance.
- **Phase 3:** memory-book builder, paperless delivery, photo retention period, print-on-request path.
- **Prototype cleanup:** delete `/santas-workshop/preview` and its sample-data module when the production page ships, or keep it behind noindex as the chair's reference.

## Proposed backlog / DECISION text (drafts only; do not file)

**Proposed DECISION-118 (draft):** *Santa's Workshop prototype is a static, unlisted, noindex, sample-data walkthrough at `/santas-workshop/preview`; `/santas-workshop` is reserved for the production page and 404s until it exists.* Rationale: the site deploys only through `main`, so a prototype is publicly reachable by definition; keeping the final URL unused means no QR code or shared link can land on sample data, and keeping all data fictional means reachability costs nothing. Revisit when the production page is built.

**Proposed B-166 (draft):** Production Santa's Workshop sign-up page: Zeffy ticket form (Club account — pending fact), date-driven states with a manual Full flip, phone-friendly modal embed with fallback link, entity-correct copy, `events` row, Open Graph card, sitemap, vanity subdomain redirect, QR URL pinned. Depends on: chair's answers, F11.

**Proposed B-167 (draft):** Santa's Workshop family tracking and volunteer check-in (Phase 2): per-family capability link, conductor roster with offline tolerance, photo station, volunteer gate; no email unless a separate durable-send pipeline is opened.

**Proposed B-168 (draft):** Santa's Workshop memory book builder and paperless delivery (Phase 3): per-stuffy book from scene photos, PDF export, retention window, printed keepsake card and print-on-request.

---

### Handoff block — Phase 1 — Functional Refinement — 2026-10-11

**Owner:** analyst
**Status:** complete

#### Summary
The request was re-scoped to a prototype. I reviewed the existing Zeffy components, `/donate`, the events page, the sitemap, `robots.ts`, `src/proxy.ts`, the CSP and the `campaigns` table, and produced a six-screen prototype specification (landing with four states, post-payment, follow-your-stuffy, paperless memory book, conductor check-in, optional photo station), the art-slot list with aspect ratios, design constraints, the five-pass review, a chair question list with recommended defaults, and a production follow-up list. Verdict READY WITH NOTES for the prototype; the production build is gated on which Zeffy account issues the form.

#### What I did
- Read the work-log, both user scope changes, `ZeffyEmbed`/`ZeffyButton`/`CampaignCard`, `/donate`, `/events`, `sitemap.ts`, `robots.ts`, `proxy.ts`, `next.config.ts` CSP, and `docs/decisions.md` (no prior decision on Zeffy public forms; only ledger-side Zeffy reconciliation decisions).
- Confirmed the proxy needs no change for a public static route, and that fonts must be self-hosted (`font-src 'self'`).
- Verified weekdays (Dec 11 Fri, Dec 12 Sat, Dec 13 Sun; Nov 8 Sun).
- Recommended route, unlisted mechanics, Accelerated pipeline mode.
- Updated the work-log header (pipeline mode, complexity) and the Phase 1 status row.

#### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-11-santas-workshop-signup.md` (Phase 1 section replaced; header and status row updated). Nothing else touched; no code, no commits, no `decisions.md`/`backlog.md` edits.

#### Open questions / handoff notes
- Orchestrator: ask the user to take Open Questions 1-10 to the chair; ask the treasurer question 11 (Zeffy account) before the production pipeline, not before the prototype.
- Phase 3 (brief): confirm route map, one sample-data module, one config module for dates/price/cap, shared prototype banner and screen switcher, the two named tests, no new dependency (if one is wanted, Phase 2 is reinstated).
- Implementer should avoid real-looking personal data in sample rows and keep S5/S6 free of any input that persists.
- A Zeffy test form is optional but would settle two production facts early; the user decides whether it is worth the minutes.

---

# Phase 2 — Architectural Review (architect)

**Skipped (orchestrator, 2026-10-11).** Accelerated mode for a prototype: no new npm dependency, no schema, no API route, no new shared primitive; one new public route group under `src/app/santas-workshop/preview/` with its own components under `src/components/santas-workshop/`, which the analyst's Phase 1 placed. The analyst's invariant pass (public repo, no personal data, no email, `noindex` via metadata not `robots.ts`, no nav or sitemap entry) stands in for the architect's. If Phase 3 finds it needs a dependency (for example a flipbook or QR library), this skip is void and the architect rules on it first.

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Santa's Workshop clickable prototype

### Summary

A static, unlisted, phone-first walkthrough at `/santas-workshop/preview` of the whole family and volunteer experience, built from Server Components with a few small client islands for the pieces that must react (landing state toggle, journey demo, flipbook, check-in list). It uses sample data only, writes nothing, reads nothing from the database, sends nothing, and adds **no dependency** (Phase 2 skip stands; if the implementer wants a library, stop and say so). Seven screens: landing (four states), after-you-pay, follow-your-stuffy, memory book, conductor check-in, photo station, and an art brief generated from the slot registry. The art slots are labelled inline-SVG placeholders driven by one registry, so the user sees exactly what to supply and swapping a real file in is a one-line edit.

### Rulings that differ from Phase 1 (read first)

1. **Site chrome is used, not a custom shell.** `src/app/layout.tsx` renders `Header` and `Footer` unconditionally; opting out would mean restructuring the app into route groups, which is a structural change for a throwaway. Phase 1 already wanted the site header and footer. The prototype adds its own banner under the header; the banner is **not** sticky (the site header is `sticky top-0 z-50`; a second sticky bar would need its height hard-coded).
2. **Real sub-routes, state in a context (not the URL).** Screens are routes so the chair can back-button, screenshot and share a screen. The landing state lives in a client context held by the layout's shell, so it survives soft navigation and resets on a hard reload. Nothing is read from the query string, nothing is stored in `localStorage`/cookies.
3. **Default landing state is `open`**, not "Opens soon" as the Phase 1 sharing mitigation suggested. The chair has to see the CTA and the form card first; the banner on every screen is the honesty mitigation. Anyone who shares the link outside the chair is told in the handoff to flip it to "Before" first.
4. **No live Zeffy test form.** The orchestrator supplied no URL, so the form card is the placeholder only; no `ZeffyEmbed` import and no seam constant. The swap later is one component (`zeffy-form-card.tsx`). Note for that day: `ZeffyEmbed` hard-codes its iframe `title` to "Donation form powered by Zeffy" and a "Donate Now" default label, both wrong for tickets; give it an optional `iframeTitle` prop then (a shared-file edit, out of scope now).
5. **Conductor roster is 24 sample rows and the counter says "of 24 (sample)"**, not "of 60": a counter whose denominator disagrees with the list under it looks like a bug on the chair's phone. The 60-spot cap is shown only as an event fact.
6. **Three additions beyond the Phase 1 screen list, all cheap and all absorbed here at Phase 3** (no schema, no API): (a) `/preview/art`, an "Art brief" page rendered from the slot registry (the user said they will make the artwork; this is the checklist); (b) a prev/next **flow footer** on every screen, because the screen switcher lives at the top and a chair at the bottom of a long landing page should not have to scroll back; (c) a three-way **delivery option switch** on the memory book (Paperless / Paperless + keepsake card / Printed) so the chair can see all three options of Open Question 1, defaulting to the recommendation. (c) is the first thing cut.
7. **Tests are source scans where the module cannot load under Vitest.** Vitest runs in `environment: "node"`: the layout imports `next/font`, and `sitemap.ts` imports `@/lib/db`, so neither can be imported in a unit test. Phase 1 asked for "sitemap output contains no `/santas-workshop` URL"; the test reads the file text instead (precedent: `src/lib/admin-page-feature-gates.test.ts`).
8. **Dates are display strings plus ISO date-only values; no `Date` parsing for display.** The project has a standing naive-timestamp bug family (event times read as UTC). Journey timestamps are wall-clock strings (`"2026-12-11T18:20"`, no `Z`, no offset) that the formatter slices; nothing calls `new Date(str)` to render. Tests use `Date.UTC` only to verify weekdays.

### Permissions

None. Public, anonymous, no session, no `hasFeature()`, no new `FEATURES` key, no role binding. `src/proxy.ts` falls through for paths outside `/admin` and `/members`. The preview imports nothing from `@/lib/db`, `@/lib/auth` or `@/lib/email` (a test pins this).

### API Contract

None. No route handlers, no server actions. **Carrier:** there is no wire contract; the client-safe pure modules below are the carriers the UI branches on, so a widened or removed member breaks `tsc`: `landing-state.ts` (`LandingState`, `LANDING_STATE_COPY: Record<LandingState, …>`), `journey.ts` (`JourneyStopId`, `stopStatus()`), `art-slots.ts` (`ArtSlotId`; `ArtSlot` takes only an `ArtSlotId`, so an unregistered slot cannot compile).

### Data Model

No schema changes required. No migration. Sample data is a TypeScript module.

### Route and component plan

All new. Server unless marked **client**. Pure TS modules (no React, no `"use client"`) are the unit-test targets.

`src/app/santas-workshop/preview/`
- `layout.tsx`: wraps children in `<PrototypeShell>`; imports `./santas-workshop.css`; loads the display font via `next/font/google` (Fraunces, `variable: "--font-sw-display"`, `display: "swap"`; self-hosted by `next/font`, so `font-src 'self'` holds exactly as for Open Sans; if the build cannot fetch it, fall back to a serif stack rather than a link tag); exports
  ```ts
  export const metadata: Metadata = {
    title: "Santa's Workshop (prototype)",
    description: "Prototype with sample content. Nothing here is real or saved.",
    robots: { index: false, follow: false },
    openGraph: { title: "Santa's Workshop (prototype)", description: "Prototype with sample content." },
  };
  ```
  No `alternates.canonical` (a canonical would point crawlers somewhere real). The OG title override matters: the root layout's default OG card would otherwise make a shared link look like the real page in iMessage. Child pages export no `robots` and no `alternates`, so the layout's value cascades.
- `page.tsx`: S1 landing. Server composition of `<LandingHero>` (**client**), `<HowItWorks>`, `<Scenes>`, `<WhatToBring>`, `<ZeffyFormCard>` (**client**), `<Faq>`, `<PrivacyLine>`, `<PresentedBy>`, `<PinnedReserve>` (**client**), `<FlowFooter>`.
- `confirmed/page.tsx` (S2), `follow/page.tsx` (S3, hosts `<FollowDemo>` **client**), `book/page.tsx` (S4, hosts `<MemoryBook>` **client**), `check-in/page.tsx` (S5, hosts `<ConductorList>` **client**), `photo-station/page.tsx` (S6, `<PhotoStation>` **client**), `art/page.tsx` (art brief). No `loading.tsx`/`error.tsx` (static).
- `santas-workshop.css`: page-scoped tokens and keyframes (below). Imported only from this layout.
- **Not created:** `src/app/santas-workshop/page.tsx`. `/santas-workshop` stays a 404.

`src/components/santas-workshop/`
- Pure modules: `event-facts.ts` (title, dates, price, cap, drop-off windows, pickup window, registration-opens date, form question list, all marked proposed; the one source of truth for facts), `landing-state.ts`, `journey.ts`, `art-slots.ts`, `check-in.ts` (`filterRoster`, `toggleBoarded`, `countBoarded`), `screens.ts` (ordered screen list `{ href, label, shortLabel, who }` used by the switcher, the flow footer and the tests), `sample-data.ts`.
- `prototype-shell.tsx` (**client**): provider + banner ("Prototype: sample content, nothing here is real or saved"), the screen switcher (horizontally scrollable pills, `aria-current="page"`, 44px targets), and, on the landing route only, the four-state toggle (a `role="radiogroup"` of buttons, state shown by text as well as colour).
- `preview-state.tsx` (**client**): context, `usePreviewState()`, `useLandingState()`.
- `landing-hero.tsx` (**client**), `zeffy-form-card.tsx` (**client**, reads state), `pinned-reserve.tsx` (**client**, phone only, `open` state only), `landing-sections.tsx` (server: HowItWorks, Scenes, WhatToBring, Faq, PrivacyLine, PresentedBy, the "after" photo strip; the Phase 2 teaser sentence stays an isolated removable block with a "Phase 2 idea" chip).
- `art-slot.tsx` (server): `<ArtSlot id="hero-scene" className?>`.
- `train-motif.tsx` (server): engine-and-cars placeholder SVG plus the track tile (CSS repeating gradient for ties and rails). The same track becomes S3's vertical route line.
- `journey-track.tsx` (server-safe presentational), `follow-demo.tsx` (**client**: "Demo: move Pip to the next stop" and "reset" buttons so the chair sees the movement without waiting a weekend).
- `memory-book.tsx` (**client**), `conductor-list.tsx` (**client**), `photo-station.tsx` (**client**), `phone-frame.tsx` (server: at `md+` S4/S5/S6 render inside a 390px device frame, `rounded-2xl`, so a desktop reviewer still sees phone proportions), `flow-footer.tsx` (server).

Files modified: none outside the new directories. `sitemap.ts`, `robots.ts`, `header.tsx`, `footer.tsx`, `next.config.ts`, `tailwind.config.ts` stay untouched.

### Sample data and the journey type

`sample-data.ts` (fictional on purpose, cartoon-obvious):
- `SAMPLE_STUFFIES`: 24 rows `{ tag: "A-01"… , familyLabel: "Family 07", name: "Pip", kind: "penguin", color: "blue scarf", careNote?: "one loose eye", windowId: "fri-early" | "fri-late" }`. Names from a fixed fictional list (Pip, Bramble, Marshmallow, Captain Waddles, Juniper, Biscuit, Mr. Buttons, Nimbus, Clementine, Truffle…). No child names, no surnames, no email, no phone, no postal address, no URL. Family labels are `Family NN`. Keys are a closed set; the test rejects any key matching `child|parent|email|phone|address|surname|contact`.
- `SAMPLE_JOURNEY_STUFFY` = the "Pip, a penguin" row.
- `SAMPLE_BOOK_CAPTIONS`: one warm caption per scene, in the club voice.

`journey.ts`:
```ts
export type JourneyStopId =
  | "checked-in" | "boarded" | "arrived" | "wrapping" | "workshop"
  | "cookies" | "story" | "reindeer" | "ready";
export type JourneyPlace = "ihop" | "train" | "north-pole";
export type StopStatus = "done" | "current" | "upcoming";

export interface JourneyStop {
  id: JourneyStopId;
  order: number;            // 0-based, strictly increasing
  title: string;            // "Checked in with the conductor"
  place: JourneyPlace;
  at: string;               // wall-clock "YYYY-MM-DDTHH:mm", no zone, never new Date()'d for display
  photoSlot: ArtSlotId | null;   // null for stops with no photo (boarded, arrived, ready)
  caption: string;
}
export interface Journey { stuffy: SampleStuffy; stops: readonly JourneyStop[]; updatedAt: string }

export function stopStatus(stop: JourneyStop, currentOrder: number): StopStatus;
export function formatWallClock(at: string): string;   // "Fri 6:20 PM", slice-based
```
Order and stop set as in Phase 1 S3 (IHOP check-in on Friday evening, train, arrival, then the five Saturday scene stops, pickup Sunday). The track renders as an `<ol>` (list semantics first, drawing second; Phase 1 accessibility constraint), the current item carries `aria-current="step"` and the words "Now:" as text.

### Art slots

`art-slots.ts` is the registry and the only place that knows slot facts:
```ts
export type ArtSlotId =
  | "hero-scene" | "train" | "track-tile"
  | "scene-wrapping" | "scene-workshop" | "scene-cookies" | "scene-story" | "scene-reindeer"
  | "step-dropoff" | "step-journey" | "step-pickup"
  | "conductor-stamp" | "book-cover" | "stuffy-photo-1" | … ;
export interface ArtSlotSpec {
  id: ArtSlotId; label: string; aspect: `${number}:${number}`; pixels: `${number}x${number}`;
  usedOn: readonly string[]; notes: string;
  path: string;            // "/images/santas-workshop/<id>.webp" (or .svg)
  src: string | null;      // null until the user supplies art; set to `path` to switch the slot on
  alt: string; decorative: boolean;
}
```
Values come straight from the Phase 1 art-slot table (hero 3:2 at 2400x1600 cropped by CSS `object-position` to about 4:5 on phones and 21:9 wide; train 3:1; track tile 1200x120; five scenes 4:3 at 1200x900; three step icons 1:1; conductor stamp 1:1 at 512; book cover 4:5 at 1200x1500 with a name-plate zone; stuffy photos 4:3). Open Graph is omitted (production only). `<ArtSlot>` renders, when `src` is null: an `<svg>`/CSS placeholder with a dashed border, a faint diagonal hatch, a simple glyph by kind (scene, train, icon, stamp, portrait) and a visible label "ART SLOT · hero-scene · 3:2 · 2400x1600"; the wrapper has the correct `aspect-ratio` so layout does not shift when art arrives. When `src` is set it renders `next/image` (local file, `fill`, `sizes` per use, `alt` from the registry or `alt=""` if decorative). Placeholder wrappers are `role="img"` with `aria-label` "Placeholder for <label>". The registry's local `path` values live under `public/images/santas-workshop/`; no external image host is considered (CSP `img-src` allows `https:` but nothing needs it, and the Zeffy-scraping restriction in CLAUDE.md makes any remote art a non-starter).

### Design system for the page

Scoped in `santas-workshop.css` on a `.sw-root` wrapper so nothing leaks to the rest of the site, and **not** added to `tailwind.config.ts` (shared file; `lions-red` stays undefined). Components use arbitrary values such as `bg-[var(--sw-night)]`.

| Token | Value | Use |
|-------|-------|-----|
| `--sw-night` | gradient `lions-blue-dark` (#002d63) to #001a3d | hero, check-in screen, banner dark variants |
| `--sw-lantern` | `lions-gold` #F9B222 | accents, buttons on dark, current-stop glow |
| `--sw-snow` | #f6f9ff | light section background |
| `--sw-paper` | #fff8ec | memory-book pages, ticket card |
| `--sw-cranberry` | #9b1c2e | the train, ribbon, "Full" state chip (white text only) |
| `--sw-pine` | #1f5c4a | "boarded / done" chips (white text only) |

`lions-blue` is the dominant identity colour on every screen (hero field, headings on light sections, primary buttons, banner). Contrast rules: gold only as an accent, or text on dark; gold buttons keep `text-gray-900` (as `ZeffyEmbed`); body copy `text-gray-700` or darker on snow and paper; `text-white` or `text-white/90` minimum on night; cranberry and pine only with white text; state is always text plus icon, never colour alone.

Type: Open Sans for body (inherited). Fraunces (display, variable serif) for the h1, h2, ticket numerals and the book cover plate. Scale: h1 `clamp(2.25rem, 9vw, 4rem)` / leading-tight; h2 `text-3xl md:text-4xl`; eyebrow `uppercase tracking-widest text-sm` in gold (public-page convention); body `text-base md:text-lg leading-relaxed`; captions `text-sm`. Cards `rounded-2xl`, buttons `rounded-lg`, hero CTA may use `px-8 py-4 text-lg transform hover:scale-105 transition`. Chips/badges only may be `rounded-full`. Every interactive element: `min-h-11` (44px), `focus:outline-none focus:ring-2 focus:ring-lions-blue` (ring offset or `ring-lions-gold` on dark).

Motif: the train and the track. The track (rails and ties from a CSS gradient, not an image) runs as a horizontal divider between landing sections and as the vertical spine of the S3 route. Ticket-stub cards (notched edge via CSS mask or two radial gradients) for the facts row, the form card, and the S2 "You're booked" summary; passport/ticket language for the keepsake card.

Motion (all decorative, none carries content): a slow snow drift in the hero (CSS only), steam puffs on the engine, the train easing along the track once when scrolled into view (a tiny IntersectionObserver in `train-motif`'s wrapper, or CSS only if simpler), a soft pulse on the current journey stop, a page-turn nudge on the flipbook. Keyframes and `animation` declarations live **inside** `@media (prefers-reduced-motion: no-preference)`; the default (no media match) is the fully static final state; Tailwind uses `motion-safe:`/`motion-reduce:`. **No content is hidden pending an animation** (no fade-in-from-opacity-0 on copy), so a failed script or reduced motion costs nothing. No autoplay audio or video, no auto-advancing carousel.

### Screen notes (only what is not obvious from Phase 1)

- **S1 states** are a table in `landing-state.ts`: `LANDING_STATE_COPY: Record<LandingState, { label; heroEyebrow; heroTitle; ctaLabel; ctaEnabled; formCard: "opens-soon" | "form" | "full" | "thanks"; pinnedReserve: boolean }>` where `LandingState = "before" | "open" | "full" | "after"`. Exhaustive `Record` makes a fifth state a compile error. "Before" shows the CTA as a readable status line ("Registration opens Sunday, Nov 8"), not a dead button. Only `open` has an enabled CTA, the form card, and the pinned bar. `isLandingState(x: unknown)` exists for the one place a value could arrive from outside the type system (none today; it keeps the door shut if someone adds a query param later). Copy never shows a spots-left count.
- **Form card (Zeffy placeholder)**: ticket-stub look at 390px: quantity row (stepper, max 3), the field list from `FORM_QUESTIONS` in `event-facts.ts` (marked "confirm with the chair which belong on Zeffy"), the payment row, labelled "Zeffy form goes here", a **Reserve** `Link` to `/santas-workshop/preview/confirmed`, and the fallback line "Having trouble? Open the sign-up form in a new tab" shown as inert sample text. Copy says "$15 per stuffy", never "$15 total", never "tax-deductible", never "donation".
- **S2** is labelled as a mock of the club's next-steps beside Zeffy's own receipt; it shows "Pip" and "Family 07" and no child name.
- **S4 memory book (CSS scroll-snap, no library)**: a `role="region"` `aria-label="Memory book"` `tabIndex={0}` horizontal scroller (`flex overflow-x-auto snap-x snap-mandatory`, pages `snap-center shrink-0 w-full`), so arrow keys and swipe both work natively. Eight pages: cover with the name-plate (Fraunces, stuffy name), five scene pages (photo slot, caption), conductor's certificate, closing page. Chrome: Prev/Next buttons (`scrollBy`, `behavior` honouring reduced motion), "Page 3 of 8" text, dots via one IntersectionObserver. Page-edge shadow and a slight paper gradient give the flipbook feel; that polish is cuttable, the counter is not. "Save as PDF" and "Share with grandparents" are buttons with `aria-disabled="true"` and a visible "Not wired in the prototype" chip; no native `alert`. The keepsake-card line and the delivery switch (ruling 6c) sit under the book.
- **S5 conductor**: `PhoneFrame`, night theme (readable under restaurant lighting), big counter "n of 24 checked in (sample)", labelled search input (`type="search"`, visible label, filters by stuffy name, kind or tag, case-insensitive, via `filterRoster`), two window chips plus "All", rows with tag, stuffy, kind and colour, care note, status chip with text ("Boarded", with a check icon) and a `min-h-12` **Check in** / **Undo** button, then a "Walk-up, not on the list" row that expands an inline sample panel (no dialog, nothing persisted). State is `useState` only; reload resets (Phase 1 verbatim). No contact details on any row.
- **S6 photo station (cut first)**: pick scene, pick stuffy by tag, a fake "Take photo" button that flashes a placeholder slot and ticks "N of 24 photographed at this scene" in memory, "Done, send to next stop". Same no-persistence rule.
- **Art brief**: a table/card list from the registry (label, aspect, pixels, where used, notes, target path, status "needed"/"supplied"), with the "do not supply IHOP logo or preschool logos" line from Phase 1.

### Implementation order (single implementer, ux-developer)

1. Pure modules and their tests first: `event-facts.ts`, `art-slots.ts`, `landing-state.ts`, `journey.ts`, `check-in.ts`, `screens.ts`, `sample-data.ts`, plus the six tests below (`pnpm test` green before any JSX).
2. `santas-workshop.css`, layout (metadata, font, shell), `art-slot.tsx`, `train-motif.tsx`, `phone-frame.tsx`, `flow-footer.tsx`.
3. S1 landing (all four states), then S2, S3 (+ demo), S5, S4, art brief, S6 last.
4. Self-check at 360/390/768/1280 and with reduced motion on/off, `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build:only`.
5. No migration, no permission, no email, no API step. Release notes belong to `/release-notes` at ship (unversioned in this design); a prototype's note is one user-facing line or none, the orchestrator's call.

### Unit tests (the implementer delivers these; named by file)

All under `src/components/santas-workshop/` (Vitest's `src/**` glob picks them up):
- `sample-data.test.ts`: no value in any exported sample structure contains `@`, `http`, a phone-shaped run (`\d{3}[-.\s)]*\d{3}[-.\s]*\d{4}`) or a street-address shape; no key matches `/child|parent|email|phone|address|surname|contact/i`; tags unique and match `/^[A-Z]-\d{2}$/`; family labels match `/^Family \d{2}$/`; every `windowId` exists in `event-facts.ts`; exactly 24 rows; all journey/book photo slots are in the registry.
- `preview-unlisted.test.ts` (source scans): `preview/layout.tsx` contains `robots` with `index: false` and `follow: false` and contains no `canonical`/`alternates`; no `preview/**/page.tsx` mentions `robots` or `alternates`; `src/app/sitemap.ts`, `src/app/robots.ts`, `src/components/layout/header.tsx` and `footer.tsx` contain no `santas-workshop`; `src/app/santas-workshop/page.tsx` does not exist (comment: delete this assertion when the production page ships); no file under the preview app directory or `src/components/santas-workshop/` imports `@/lib/db`, `@/lib/auth`, `@/lib/email` or `next-auth`, and none contains `window.confirm|alert|prompt(`, `localStorage`, `sessionStorage`, `document.cookie` or `fetch(`.
- `landing-state.test.ts`: the four states in order `before, open, full, after`; the copy table has an entry for each; only `open` has `ctaEnabled`, `formCard: "form"` and `pinnedReserve`; form-card kinds are distinct per state; no copy string contains "spots left", "tax-deductible" or "donat"; `isLandingState` accepts the four and rejects `""`, `"OPEN"`, `null`, `"open "`, and an object.
- `journey.test.ts`: `order` is 0..n-1 strictly increasing; `at` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/` and is non-decreasing; first stop is `checked-in`, last is `ready`; for every `currentOrder` in range exactly one stop is `current`, all earlier are `done`, all later `upcoming`; `formatWallClock` is slice-based (a string with a late-evening time renders the same under a different `TZ`, by asserting against fixed strings); every non-null `photoSlot` exists in the registry; Friday/Saturday/Sunday dates agree with `event-facts.ts`.
- `art-slots.test.ts` and `event-facts.test.ts` (one file may hold both if short): unique slot ids; `aspect` parses and agrees with `pixels` within 1%; every `path` starts `/images/santas-workshop/`; non-decorative slots have non-empty `alt`; every `usedOn` entry is a known screen href from `screens.ts`; weekdays of the three event dates computed with `Date.UTC(...).getUTCDay()` are Fri/Sat/Sun; Nov 8 is a Sunday; registration opens before the event; price is 15 and cap 60 (guards the "$15 per stuffy / 60" copy against silent edits); drop-off windows are ordered and non-overlapping.
- `check-in.test.ts`: `filterRoster` is case-insensitive over name, kind and tag, empty query returns all, whitespace-only query returns all, no match returns `[]`, input is not mutated; `toggleBoarded` flips only the target tag and returns a new array; `countBoarded` agrees.

### QA click-throughs (Phase 5)

Run at 360, 390, 768 and 1280 px, each with `prefers-reduced-motion` emulated on and off:
- Every screen: prototype banner present; no horizontal page scroll; the site header sits above the banner; focus ring visible on every control by keyboard; 44px targets; headings in order; page `<head>` carries `<meta name="robots" content="noindex, nofollow">` and no canonical; the OG title reads "Santa's Workshop (prototype)".
- Landing: cycle all four states, check CTA, form card, pinned bar (phone only, `open` only) per the table; "Reserve" reaches S2; state survives a soft navigation and resets on reload.
- S3: demo button walks the stop list and the `aria-current` stop moves; list reads sensibly with CSS off (no drawing-only meaning). S4: swipe and arrow keys, Prev/Next, page counter, the disabled buttons say why. S5: search narrows the list, check-in toggles and the counter ticks, reload resets, walk-up panel opens inline. S6 if built.
- Reduced motion on: no snow, steam, train travel, pulse or smooth scroll; content identical. Off: motion present, subtle, nothing flashes.
- `/santas-workshop` returns 404; `/sitemap.xml` and `/robots.txt` do not mention the path; the preview issues no network request to any origin except the site itself (plus the root layout's analytics, which already exists on every page; noted that the chair's visits will appear in the club's analytics, harmless); no sample value looks like a real email or phone on any screen.
- Contrast spot check of gold-on-night, cranberry chip, pine chip, grey captions on paper.

### Edge cases and risks

- **Reachable, not private.** Ships through `main`; anyone with the link sees it. Mitigated by fictional data (test-enforced), the banner, the 404 at `/santas-workshop`, and `noindex`. *Believed, unmeasured:* that crawlers will honour `noindex` promptly and that nothing links to the URL; no live check can measure the first, so QA records only that the header is emitted.
- **The page looks finished and takes no money.** If shared widely it could mislead a parent. Banner on every screen; "Reserve" only leads to a mock; no contact form.
- **Font fetch at build.** `next/font/google` fetches at build like Open Sans does; if it fails in the sandbox, use the serif stack fallback and say so in the work-log rather than adding a link tag (CSP `font-src 'self'`).
- **Sticky stacking.** Site header is `sticky top-0 z-50`; the pinned Reserve bar is bottom-fixed and must not cover the site footer's last content or the flow footer (give the landing page bottom padding on phones). Check the iOS safe area (`pb-[env(safe-area-inset-bottom)]`).
- **CSS bleed.** Imported CSS is global in Next; every rule is under `.sw-root` or prefixed `sw-`, and the file is imported only by the preview layout.
- **Scroll-snap and `overflow-x: hidden`** on `html, body` (globals.css): the flipbook's horizontal scroller is a nested container, which is fine; do not put `overflow-x-hidden` on its parent.
- **No customer-facing promises.** Dates, windows and price are "proposed"; every date string comes from `event-facts.ts` so a change is one edit.

### Cut list (if the pass runs long, in this order)

1. S6 photo station (and its switcher entry).
2. Delivery option switch on S4 (ruling 6c).
3. Flipbook polish (page-edge shadow, dots); keep Prev/Next and the page counter.
4. Train-in-view animation and engine steam; keep the static train and the snow.
5. The Art brief page can be reduced to a plain table.
Nothing in this list touches the test files, the banner, the four landing states, S2, S3, S5 or the noindex mechanics; those are the point of the prototype.

### Out of scope

Anything real or persistent: roster, check-in writes, photo upload, tracking tokens, email, Zeffy embed, `campaigns` row, `events` row, Open Graph art, sitemap, subdomain, structured data, analytics events, a `/santas-workshop` route. Also: a new npm dependency (QR, flipbook, animation), edits to `tailwind.config.ts`, `next.config.ts`, `layout.tsx` (root), `ZeffyEmbed`, `header.tsx`, `footer.tsx`, or `robots.ts`.

### Production follow-ups (carried from Phase 1, unchanged)

Form-link source of truth (constant vs `campaigns` row) after the Zeffy account answer (Q11, BLOCKING FACT for production only); date-driven Before/Open/After states with a manual Full flip; phone embed via modal with fallback link and a ticket-appropriate iframe title; Zeffy test form to settle per-ticket questions, redirect, tip/address prompts, sold-out text; vanity subdomain `santasworkshop.westervillelions.org` (temporary redirect to a fixed canonical URL); Open Graph card; sitemap, removal of `noindex`, `events` row; Phase 2 roster, check-in gate, tracking tokens, offline tolerance (B-167); Phase 3 memory-book builder, retention, print-on-request (B-168); production page (B-166); delete or keep `/santas-workshop/preview` and its sample-data module when production ships. Orchestrator files B-166..B-168 at ship; they are not edited here.

### DECISION-118

Filed in `docs/decisions.md` as `Status: Proposed` (rule (b)); promote to `Resolved` at Phase 6 after re-reading against QA's "Established" list.

### Implementer

**ux-developer**, single implementer: no schema, no API, no permission, no email, no dependency. Budget: one pass of a few hours; the cut list above is the pressure valve. If the pass needs a dependency, stop and return to Phase 2.

---

### Handoff block — Phase 3 — Technical Design — 2026-10-11

**Owner:** tech-lead
**Status:** complete

#### Summary
Designed the Santa's Workshop prototype as seven unlisted routes under `/santas-workshop/preview` sharing one client shell (banner, screen switcher, landing-state context), pure TS modules for facts, sample data, landing states, journey model, art-slot registry and check-in logic, a labelled SVG/CSS art-slot component, page-scoped seasonal tokens layered on `lions-blue`/`lions-gold`, and CSS-only motion gated on `prefers-reduced-motion`. No dependency, schema, API or permission; Phase 2 skip stands. DECISION-118 filed as Proposed.

#### What I did
- Read the work-log, CLAUDE.md sections named, `tailwind.config.ts`, root `layout.tsx`, `header.tsx` (sticky, `z-50`), `ZeffyEmbed`, `/donate`, `sitemap.ts`, `robots.ts`, `next.config.ts` CSP, `vitest.config.ts`, and the admin-gate source-scan test as the test precedent.
- Ruled on chrome (site header/footer, non-sticky banner), routes vs state, default state, no live Zeffy form, roster counter, three small additions, and source-scan tests (Vitest `node` environment cannot import `next/font` or `@/lib/db`).
- Named every file, server/client split, test file and assertion, QA widths and motion matrix, and the cut order.

#### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-11-santas-workshop-signup.md` (this section, status row).
- `/Users/cshenso/git/westervillelions/docs/decisions.md`: DECISION-118 (Proposed).
- No code, no dev-server contact, no commit, no `docs/backlog.md` edit.

#### Open questions / handoff notes
- Use the **ux-developer** agent for the whole build (single implementer). Start with the pure modules and tests (`pnpm test` green) before JSX; list any deviation under "Deviations from the design".
- Orchestrator: if you do want a live Zeffy test form on S1, supply a form URL and say so; it reopens ruling 4 (and needs the optional `iframeTitle` prop on `ZeffyEmbed`).
- Orchestrator: default state is `open`; tell the chair to switch to "Before" before forwarding the link to anyone else.
- Orchestrator: migration numbers and worktrees do not apply (no schema); the dev server is not touched by this design, and no restart is needed.
- QA: the matrix above; record the tree state the PASS was measured on.

---

# Phase 4 — Implementation (UI) — 2026-10-11

**Owner:** ux-developer
**Status:** complete

### Summary
Built the seven-route unlisted prototype at `/santas-workshop/preview` exactly as designed, in the design's order: pure modules and tests first, then CSS/layout/shell, then landing (four states), confirmed, follow, check-in, book, art brief, photo station. No dependency, no schema, no API, nothing persisted. Nothing from the cut list was cut.

### What I did
- Pure modules (`event-facts`, `art-slots`, `landing-state`, `journey`, `check-in`, `screens`, `sample-data`) and six test files (35 tests) before any JSX.
- Page-scoped seasonal tokens in `santas-workshop.css` (`.sw-root`, `sw-` prefix; cranberry and pine only as CSS variables, `tailwind.config.ts` untouched). Fraunces via `next/font/google` as `--font-sw-display`.
- Motif: inline stand-in train SVG with steam, CSS rails-and-ties track (horizontal and the vertical spine of the journey), ticket-stub cards (notched via mask, shadow on the wrapper), snowfall layers. All keyframes sit inside `prefers-reduced-motion: no-preference`; the default is the static final state; no content is hidden pending an animation.
- Landing: hero with state-driven copy, fact row, CTA (enabled only in Open; a readable status line in Before/Full; none in After), story, three steps plus the removable "Phase 2 idea" block, five scenes (scroll-snap on phones, grid at md+), what to bring, FAQ (native details), form card (boarding-pass placeholder with working 1-3 quantity stepper), privacy line, presented-by, flow footer, phone-only pinned Reserve bar (hides over the form and at the page end).
- Memory book: scroll-snap flipbook (8 pages, Prev/Next, "Page n of 8", dots, keyboard-scrollable region), name-plate cover, certificate, inert Save/Share buttons with a visible "Not wired" chip, and the three-way delivery switch defaulting to paperless plus keepsake card.
- Conductor list (search, window chips, counter with progress bar, Check in/Undo, walk-up panel), photo station, art brief rendered from the registry (cards with a proportional aspect box).

### Outputs
- `src/app/santas-workshop/preview/`: `layout.tsx`, `santas-workshop.css`, `page.tsx`, `confirmed/page.tsx`, `follow/page.tsx`, `book/page.tsx`, `check-in/page.tsx`, `photo-station/page.tsx`, `art/page.tsx`. No `src/app/santas-workshop/page.tsx`.
- `src/components/santas-workshop/`: `event-facts.ts`, `art-slots.ts`, `landing-state.ts`, `journey.ts`, `check-in.ts`, `screens.ts`, `sample-data.ts`, `preview-state.tsx`, `prototype-shell.tsx`, `art-slot.tsx`, `train-motif.tsx`, `in-view.tsx`, `phone-frame.tsx`, `flow-footer.tsx`, `screen-header.tsx`, `landing-hero.tsx`, `landing-sections.tsx`, `zeffy-form-card.tsx`, `pinned-reserve.tsx`, `journey-track.tsx`, `follow-demo.tsx`, `memory-book.tsx`, `delivery-switch.tsx`, `conductor-list.tsx`, `photo-station.tsx`.
- Tests: `sample-data.test.ts`, `preview-unlisted.test.ts`, `landing-state.test.ts`, `journey.test.ts`, `art-slots.test.ts` (also holds the event-facts tests), `check-in.test.ts`.
- Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/santas-workshop-signup/` (full-page PNGs per width and screen, all four landing states; `reduced-` prefix = reduced motion at 390; `crops/` are viewing crops). Scripts `shoot.mjs`, `keys.mjs` there too.
- No decisions filed (DECISION-118 stays Proposed).

### Tests and gates
- `pnpm exec tsc --noEmit`: clean (note: a stale `.next/types` vs `.next/dev/types` mismatch showed tsc errors until `pnpm build:only` regenerated `.next/types`; not a code issue).
- `pnpm lint`: 0 errors; 1 warning, pre-existing in `src/components/admin/ledger/budget-context-panel.tsx` (not mine).
- `pnpm test`: 209 files, 3659 tests, all green (the six new files hold 35 tests).
- `pnpm build:only`: passes; prints `/santas-workshop/preview`, `/art`, `/book`, `/check-in`, `/confirmed`, `/follow`, `/photo-station` (all static).
- `grep console.log` and `grep "@/lib/db"` over both directories: empty. No native dialogs.

### Browser verification (dev server :3000, not restarted)
- `/santas-workshop` returns 404; `/santas-workshop/preview` returns 200 with `<meta name="robots" content="noindex, nofollow"/>`, OG title "Santa's Workshop (prototype)", no canonical link.
- 360, 390, 768, 1280 px, motion no-preference and reduce: all seven screens plus all four landing states load with zero horizontal overflow (88 checks, all 0). Network origins: the site itself plus the root layout's existing Google Tag Manager only. Console: only the dev-mode React eval() CSP notice that every page here emits.
- Landing keyboard tab order (390px): skip link, site header, screen pills, state radios, hero CTA, Phase 2 link, scene scroller, four FAQ summaries, quantity stepper, Reserve, About, Contact. Targets are at least 44px; pills/links/buttons show a focus ring.
- Reduced motion: snowfall animation computes to `none` under reduce and `sw-fall` otherwise. Flows confirmed in a browser: search narrows the roster, Check in ticks the counter, journey demo moves the `aria-current="step"` stop, book Next goes to page 2 of 8, state survives a soft navigation (Full stays Full) and resets to Open on reload.

### Deviations from the design
- Under ~30 lines, absorbed: added `screen-header.tsx` (shared compact header for screens 2-7) and `in-view.tsx` (the small IntersectionObserver the design allowed for the train); the ticket stub is built from a top and bottom half whose notches meet at the perforation, so the notch always lines up (a single mask could not guarantee that).
- The stand-in train is drawn inline and `train` is still listed as a needed art slot; when its `src` is set the supplied art replaces the drawing.
- The delivery switch is a labelled `role="radiogroup"` (not a fieldset) so its heading renders cleanly.
- No other deviations; no new route, schema or permission.

### Cuts
None. Photo station, delivery switch, flipbook polish (shadow, dots, nudge), train animation and the card-style art brief all shipped.

### Open questions / handoff notes
- **QA click-through:** every screen via the pills at 360/390/768/1280; the four landing states; Reserve to Booked to Journey; the demo buttons on Journey (including "Before check-in" and the end-of-trip banner); book Prev/Next, arrow keys on the focused book, the three delivery options; conductor search, window chips, Undo, walk-up panel, no-match message; photo station (take, retake, undo, next stop, counter); art brief status chips.
- Not exercised by me: the pinned Reserve bar's hide-over-form behavior on a real phone (it is fixed-position, so full-page screenshots show it mid-page), iOS safe-area padding, and contrast measured with a tool (I used the design's contrast rules: white on cranberry/pine, dark text on gold, gray-700 or darker on light).
- New copy the club may want to refine: hero leads per state, story paragraphs, FAQ answers (cost, who it is for, Saturday house, dates), "Our promise" privacy line, the delivery-option pros and cons, the Phase 2 teaser wording, and the keepsake-card line. FAQ "Who is it for?" says preschoolers only.
- Tradeoffs: Default state is Open (design ruling 3), so tell the chair to flip to "Before it opens" before forwarding the link. The hero art placeholder is tall on phones (4:5 per the art brief).
- Dev note: `.next/dev/types` can disagree with `.next/types` for tsc until a build refreshes it.
- Next agent: qa (Phase 5). Record the tree state the PASS is measured on; nothing committed.

### Phase 4 loop-back fix — 2026-10-11

Fixed QA's D1 and D2 and absorbed the US-spelling copy fix.

- **D1 (pinned bar over the site footer):** `pinned-reserve.tsx` no longer uses an IntersectionObserver that could flip back. It now listens to scroll/resize and hides the bar while the form card is on screen and from the moment the flow footer (`#sw-end`) reaches the viewport onward, so it cannot reappear over the site footer. Re-checked at 360 and 390 px, Open state: bar visible mid-page, hidden at max scroll (screenshots `360-pinned-end-fixed.png`, `390-pinned-end-fixed.png` in the screenshot folder).
- **D2 (heading order on /book):** the flipbook page titles and the certificate title in `memory-book.tsx` are now `h2`, so the sequence is h1, h2, h2.
- **Spelling:** "favourite" to "favorite" (5 strings), "colour" to "color", plus "centre" to "center" (art-slot note), "neighbours" to "neighbors" (2 strings), and sample-data "grey" to "gray" (2 values). The internal function name `neighbours` in `screens.ts` is left alone (not user-facing). No test asserted the old spellings, so no string-test edits were needed.
- **Files:** `src/components/santas-workshop/{pinned-reserve.tsx,memory-book.tsx,landing-sections.tsx,landing-state.ts,event-facts.ts,art-slots.ts,sample-data.ts}`.
- **Results:** `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors (same one pre-existing warning); `pnpm test` 3659 passed; `pnpm exec playwright test e2e/santas-workshop-preview.spec.ts` 16 of 16 passed against :3000 (both regression specs now green). Not re-verified: a real phone, as QA noted. Nothing committed.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-11
**Verified by:** qa
**Owner:** qa
**Status:** complete (first pass FAIL, two defects fixed in the loop-back; re-verified PASS, see the re-verification note below)

**Tree state measured:** HEAD `c20ff24` plus the uncommitted tree: `docs/decisions.md` modified (DECISION-118), `src/app/santas-workshop/`, `src/components/santas-workshop/`, this work-log, and one new qa file `e2e/santas-workshop-preview.spec.ts`. `package.json` and `pnpm-lock.yaml` unchanged. Dev server `:3000` was only requested, never restarted. No commit. Concurrent pipelines: none observed touching these files.

## Verdict: FAIL

Everything the prototype is *for* works: all seven screens, all four landing states, the flows, unlistedness, no persistence, contrast, no overflow. Two defects against explicit Phase 3/Phase 5 criteria stop a PASS, and both are small:

| # | Defect | Severity | Returns to |
|---|--------|----------|------------|
| D1 | At 360 and 390 px in the **Open** state, the pinned Reserve bar **reappears at the very end of the page and covers the site footer's last line** ("Privacy Policy", "Lions Clubs International"). Phase 3 required it not to cover the footer's last content; the Phase 4 handoff says it "hides at the page end", which is only true while the flow footer (`#sw-end`) is on screen. Once the page is scrolled past that sentinel into the site footer, `covered` flips back to false and the bar returns. Measured at scrollY = max (7503): bar top 707 px, footer links at 700-744 px; the two links are under the bar and cannot be tapped. | Medium (real, 2 links, phone-only, Open state only) | ux-developer, Phase 4 |
| D2 | `/santas-workshop/preview/book` skips a heading level: `h1` then `h3` x6 (the flipbook page titles) and only later an `h2` ("How should the book be delivered?"). Criterion was "headings in order". | Low | ux-developer, Phase 4 |

**Suggested fix direction (theory, not tested):** D1, also observe the site `<footer>` (or keep the bar hidden once `#sw-end` has scrolled above the viewport) in `pinned-reserve.tsx`. D2, make the book page titles `h2` (or non-heading elements) so the sequence is h1, h2, h2.

Both are pinned by failing regression specs I added (below). Re-verification after the fix is: those two specs green plus `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, nothing more.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** (no output, 4.5 s; re-run after adding the e2e spec, still clean).

## Lint

`pnpm lint`: **PASS**, 0 errors, 1 warning, pre-existing in `src/components/admin/ledger/budget-context-panel.tsx:114` (not this diff). `eslint e2e/santas-workshop-preview.spec.ts`: clean.

## Unit tests

`pnpm test` (whole suite): **PASS**. Test Files 209 passed (209). Tests 3659 passed (3659). Duration 3.97 s. The six prototype files hold 35 tests (`pnpm exec vitest run src/components/santas-workshop`: 6 files, 35 tests, 166 ms).

All six files named by the Phase 3 design exist and pass; none missing: `sample-data.test.ts`, `preview-unlisted.test.ts`, `landing-state.test.ts`, `journey.test.ts`, `art-slots.test.ts` (holds the event-facts tests too, as the design allowed), `check-in.test.ts`. I read `preview-unlisted.test.ts`: it asserts the layout's `robots`/no `canonical`/no `alternates`, no `robots` in any preview page, no `santas-workshop` in sitemap/robots/header/footer, no `page.tsx` at `/santas-workshop`, and no db/auth/email/next-auth import, native dialog, browser storage, `fetch(` or `console.log` in any non-test source file. Coverage of the pure modules (v8, `src/components/santas-workshop/*.ts`): 79.8% statements, 67.7% branches (the three files under 100% are `art-slots.ts` 73.7%, `event-facts.ts` 74.1%, `screens.ts` 25%; the uncovered lines are format helpers and a lookup used only by the UI). Above the 70% pure-module target. The project's critical-module targets (`events.ts`, `permissions.ts`, `members.ts`) are not touched by this diff and were not re-measured.

## Production Build

`pnpm build:only`: **PASS** (exit 0). Route table prints the seven static routes `○ /santas-workshop/preview`, `/art`, `/book`, `/check-in`, `/confirmed`, `/follow`, `/photo-station`; a line-anchored grep for `/santas-workshop` with nothing after it matches 0 lines, so the bare path is not a route. 280 route lines in total; no warnings or errors in the log. Log: `qa/build.log` in the scratchpad.

## Dev-Server Smoke Test

Against the running `:3000`, no restart: **PASS**. Seven screens return 200. Console errors per run were all the dev-mode React `eval()` CSP notice that every page here emits.

## Unlisted-ness (measured, DECISION-118)

| Check | Observed |
|-------|----------|
| `GET /santas-workshop` | **404** (`/santas-workshop/` 308 to it, then 404) |
| `GET /santas-workshop/preview` | **200**; `<meta name="robots" content="noindex, nofollow"/>`; no `link rel=canonical`; `og:title` and `twitter:title` = "Santa's Workshop (prototype)"; title "Santa's Workshop (prototype) \| Westerville Lions Club" |
| Same on `/confirmed /follow /book /check-in /photo-station /art` | 200, same robots meta, 0 canonical (cascades from the layout as designed) |
| `/sitemap.xml` (200, 5483 bytes) and `/robots.txt` | 0 matches for `santas`; robots.txt lists only `/members /admin /api` as disallowed |
| Links to it from `src/` outside the two prototype dirs, `public/`, `next.config.ts` | none (grep for `santas-workshop`, `santas_workshop`, `Santa's Workshop`) |
| Banner on all seven screens | "Prototype / Sample content, nothing here is real or saved." present on 7/7 at 4 widths x 2 motion modes, and the site header sits above it |
| `package.json`, lockfile | unchanged; the only third-party imports are `react`, `next/link`, `next/image`, `next/navigation`, `next/font/google`, `next` types (grep of import lines) |

## Sample data and nothing persisted

- Greps over all 34 non-test source files in the two directories: `console.` none; `@/lib/(db|auth|email)`/`next-auth` none; native dialogs none; `localStorage|sessionStorage|document.cookie|fetch(|XMLHttpRequest|sendBeacon|indexedDB|use server` none; email shapes, phone shapes, `http(s)://`, `tel:`, `mailto:` none. Rendered text of all seven screens scanned in the browser: no `@`, no phone shape, no "spots left", "tax-deductible" or "donat" word (the site footer's own "Donate" link is outside `.sw-root` and excluded).
- Sample rows: 24 stuffies named from a fictional list (Bramble, Pip, Mr. Buttons, ...), `Family NN` labels, tags `A-01`..`B-12`; no child name, surname, or contact. No person named anywhere in the prototype (grep for Howard, Mr./Mrs./Dr. finds only "Mr. Buttons" and "Mrs. Claus").
- After a full click-through at 4 widths: `localStorage.length` 0, `sessionStorage.length` 0, `document.cookie` empty, URL carries no state (`search+hash` empty).
- Network during the walk (4 widths x 2 motion modes, 7 screens each): origins are `localhost:3000` and `https://www.googletagmanager.com` only. On the site origin, beyond page and `_next` assets: `GET /api/auth/session` (x4 per load), `POST /__nextjs_original-stack-frames` (dev overlay), and two httpOnly `authjs.*` cookies set by that session call. **These are not from the prototype**: the prototype has no `fetch`, and `/about` (not part of this diff) shows the identical requests and cookies. They come from the root layout's `SessionProvider` and the Next dev overlay. The brief said "only the existing GTM origin may appear"; strictly the site's own origin also appears, for those pre-existing calls.

## Click-through results (Playwright chromium, scripts in the scratchpad `qa/`)

Matrix: widths 360, 390, 768, 1280, each with `prefers-reduced-motion` no-preference and reduce, all seven screens.

| Check | Result |
|-------|--------|
| One `h1` per screen, banner, header above banner, robots/canonical/OG | **280/280 pass** (7 screens x 4 widths x 2 modes x 5 assertions) |
| Horizontal overflow (`scrollWidth - innerWidth`) | **0 at every one of 56 screen loads**, plus 48 further checks (all four landing states at 4 widths x 2 modes, book at page 8, walk-up panel open, no-match message). Zero failures |
| Landing four states x 4 widths | 100/100 assertions pass: Before = readable "Registration opens Sunday, Nov 8" status line (not a link) and "Opens soon" card; Open = gold "Reserve a spot, $15 per stuffy" link and the form card; Full = "All 60 spots are taken, thank you" and the Full card; After = no CTA and the thank-you card; pinned bar visible only in Open and only below 768 px |
| State survives soft navigation (Full, Booked, Sign up), back/forward; resets to Open on hard reload; never in the URL | pass at all four widths |
| Keyboard path, 390: 12 Tab presses from page top to the hero "Reserve a spot, $15" link (skip link, logo, menu, seven screen pills, state radios, CTA). 1280: 18 presses. Enter jumps to `#reserve`; two more Tabs reach the form card's Reserve link; Enter opens the Booked screen. Every stop on the way shows a visible focus indicator | pass |
| Reserve bar, phone: visible 0-4000 px, hidden while the form card is on screen, **reappears over the site footer at the end** (D1) | **FAIL on the end-of-page criterion only**; bar height 73 px; hidden-over-form pass |
| Focus not obscured by the bar or site header (tabbed 16 stops at 360 and 390) | pass (the first 16 stops are above the end-of-page zone, so D1's links were not exercised by tabbing; the geometry above shows them covered) |
| Reserve anchor (hero CTA and bar) | `#reserve` lands at 80 px from the viewport top, nothing hides it |
| S3 Journey | 9 stops in an `<ol>`; exactly one `aria-current="step"` carrying the text "Now:"; "Move Pip to the next stop" advances it to the end ("Ready for pickup" and the end-of-trip banner, button disabled); "Before check-in" clears it and shows "hasn't boarded yet"; Reset returns to the start; list text carries DONE / Now words, not colour alone |
| S5 Conductor | 24 rows, "n of 24 checked in (sample)"; search narrows ("pip" 1 row, "B-07" 1, "  PENGUIN " case and whitespace 2, "zzzz" shows the no-match message); Check in ticks the counter and shows the text chip "Boarded" with Undo; Undo restores; window chips 12/12; walk-up panel opens inline (`aria-expanded=true`); reload resets the counter |
| S4 Book | starts "Page 1 of 8", Prev disabled; Next to 8 of 8 (Next disabled), Prev back; arrow keys on the focused region move the page; Save as PDF and Share are `aria-disabled` with a visible "Not wired" chip and do nothing when clicked; delivery switch is a 3-radio group defaulting to "Paperless plus a keepsake card", ArrowDown/ArrowUp move the selection and swap the text, focus indicator visible |
| S6 Photo station | Take photo ticks "1 of 24", Retake does not double count, Done advances to the next stuffy, a different scene counts separately, Undo restores, reload resets |
| Art brief | **18 slots**, each with aspect, pixels, used-on, target path and description; every aspect and pixel value matches the Phase 1 table (checked against an independent hard-coded copy of the table, 0 mismatches); the IHOP/preschool logo line is present. The OG image is omitted as the design said |
| Native dialogs fired during the walk | 0 |
| Prev/Next flow footer | chain Sign up, Booked, Journey, Book, Check-in, Photo station, Art brief is intact |
| Reduced motion | CSS animations running on the four screens that have them: no-preference 6 at 390 (`sw-roll, sw-steam, sw-pulse, sw-nudge`) and 5 at 1280; **reduce: 0** at both widths. Book Next scrolls instantly under reduce (scrollLeft equals one page width right after the click); `scroll-behavior` is `auto`. Landing text identical with motion on or off (same string, 390 px) |

## Accessibility quick pass

- Headings: landing, Booked, Journey, Check-in, Photo station, Art brief are in order. **`/book` skips h1 to h3 (D2).** The site footer's own `h3`s after the page content are the existing site chrome, not counted.
- Images and slots: no `<img>` inside the prototype (every slot is a placeholder). Every slot is `role="img"` with an `aria-label` ("Placeholder for ..."), the stand-in train has its own label, every other prototype SVG is `aria-hidden`; 0 unlabelled SVGs inside `.sw-root`. No duplicate ids, one `<main>`, `lang="en"`.
- Targets under 44 px: none among controls. One inline text link, "See what that looks like" (the Phase 2 teaser), measures 183 x 22 px at 360 and 768 (inline links are exempt under WCAG; the project's own 44 px rule is for controls). Not a defect, noted.
- Radiogroups (state toggle, delivery switch) are native radios and operate with the arrow keys.

## Contrast (measured with a tool, not by the design rules)

Method: for every text run inside the prototype (3,554 runs across 7 screens, 4 landing states, 8 book pages, 3 extra interaction states, at 390 and 1280, reduced motion), text was made transparent, a full-page screenshot taken, and the real rendered background pixels under the text's bounding box sampled; each pixel's WCAG ratio was computed from the element's computed colour (alpha and ancestor opacity applied). Disabled controls (46 runs) excluded as exempt. The pinned bar (hidden during sampling) was not measured by pixels. Dev overlay hidden.

- **Every one of 3,508 measured runs passes at the 5th-percentile pixel** (4.5:1, or 3:1 for large text). Zero failures.
- Worst measured values at the 5th percentile: hero `h1` 11.38; hero lead text 10.68; gold button text (dark on gold) 9.65; banner text 14.07; banner "Prototype" chip 9.65; "Registration opens ..." and "All 60 spots ..." status lines 11.33 and 11.48; fact values 9.65; fact labels (gold on night) 5.54; hero eyebrow (gold on night) 5.85; small print "Dates and times are proposed" 10.28; screen pills 10.19; state-toggle labels 8.08; cranberry text 7.73; pine text 7.48; conductor gold label 7.34.
- Sub-threshold pixels exist but are rare and decorative: on the hero, white snowflake dots drift under the text. The worst pixel under the gold eyebrow is 1.38 and under the white lead 2.51, but at most 0.22% of that text's pixels fall below 4.5:1; the largest fraction anywhere is 1.64% (the tiny "4:3" ratio label on the book art placeholders). No element has 3% or more of its pixels below threshold. Judged acceptable; stated, not hidden.
- The pinned bar (gray-800 text on near-white, white text on `lions-blue`): from the design tokens, about 14:1 and 10.9:1; not pixel-measured.

## Manual Click-Through (what the runner cannot reach)

| Flow | Result | Notes |
|------|--------|-------|
| Pinned Reserve bar on a real phone (touch, rubber-banding, address-bar resize) | **not verified** | Playwright mobile emulation only (touch taps worked). Needs the user or the chair on an actual phone |
| iOS safe-area padding | **not verified; likely moot** | Source uses `pb-[max(0.75rem,env(safe-area-inset-bottom))]`; computed padding is 12 px here. The root viewport meta is `width=device-width, initial-scale=1` with no `viewport-fit=cover`, so on iOS `env(safe-area-inset-bottom)` is 0 and Safari keeps fixed bars above the home indicator anyway. This is a theory from the meta tag, not observed |
| Real screen reader pass | not run | Roles and labels are present as listed above; no VoiceOver/TalkBack run |

Per the standing rule, I am not signing off the phone-only items; they need a person with a phone after D1 is fixed.

## Established vs believed (for DECISION-118 and Phase 6)

**Established by measurement:** `/santas-workshop` 404; the preview and every sub-route return 200 with `noindex, nofollow` and no canonical; sitemap and robots.txt contain no `santas`; no link to the prototype from `src/` outside its two directories, `public/`, or `next.config.ts`; no db/auth/email import, no `fetch`, no storage, no cookie, no dialog, no `console.log`, no new dependency; sample data fictional (test-enforced and independently grepped); landing state is client state only (URL never carries it, survives soft navigation, resets on reload); zero horizontal overflow at 360/390/768/1280; contrast passes as above; reduced motion removes all CSS animation.
**Believed, unmeasured (the decision's own list):** that search engines honour `noindex` promptly and that no outside page links to the URL. Not measurable here.
**Not established:** D1 and D2 are fixed (open).
**Observed but not caused by this diff and not investigated:** the site header has `position: sticky` yet scrolls away on every page I tried (on `/about` at scrollY 1500 its top is -1500 px). The Phase 3 design said "the site header is sticky"; it is not behaving that way site-wide, presumably the existing `overflow-x: hidden` on `html, body`. This is a theory, not a finding; mentioned only because the design leaned on it.

## Other notes for the club / Phase 6 (not defects)

- Copy: American club, British spelling in 6 strings: "favourite" x5 (hero leads for Before and Open, story, FAQ, `landing-sections.tsx` ones) and "colour" x1 (form question, `event-facts.ts:103`).
- At the top of the page on a phone, the hero CTA and the pinned bar show two "Reserve" buttons at once; as specified, but the chair may notice.
- On `/book`, the phone frame wraps the flipbook in a region labelled "Memory book on a phone" and the scroller inside is another region labelled "Memory book" (two nested landmarks). Low.
- Compact art-slot placeholders (the three step icons) carry no visible text; the art brief is where they are identified.
- Default landing state is Open (design ruling 3). Tell the chair to flip to "Before it opens" before forwarding the link to anyone.
- `docs/decisions.md` DECISION-118 stays Proposed. Phase 6 may promote it once D1 and D2 are closed.

## Regression Tests Added

New file `/Users/cshenso/git/westervillelions/e2e/santas-workshop-preview.spec.ts` (16 Playwright tests, no sign-in, no database, no email; run with `pnpm test:e2e e2e/santas-workshop-preview.spec.ts`). Result against the current tree: **14 pass, 2 fail on purpose** (7 s). Both failing specs reproduce the defects before any fix, as the regression discipline requires:

- `should not let the pinned Reserve bar cover the site footer at the end of the page — regression for the bar re-appearing after the end-of-page sentinel scrolls out of view` (`:90`). Fails now: received `["Privacy Policy", "Lions Clubs International"]`. Guards D1.
- `should not skip heading levels inside the prototype on any screen — regression for the memory book jumping from h1 to h3` (`:111`). Fails now: `/santas-workshop/preview/book` has `h1 to h3`. Guards D2.

The other 14 pin the measured behaviour so it cannot silently regress: 404 at `/santas-workshop`; sitemap and robots.txt silent; noindex, banner and exactly one h1 on each of the seven screens; pinned bar only while Open on a phone; state survives soft navigation and resets on reload with nothing in the URL; no horizontal overflow at 360 px on any screen; delivery radiogroup arrow keys; conductor check-in resets on reload with nothing written to storage.

## Feature-Gate Audit

No protected routes or server actions touched. The prototype adds no route handler and no server action, imports nothing from `@/lib/auth` or `@/lib/db` (grep and unit test), and sits outside `/admin` and `/members`, so `src/proxy.ts` falls through. Nothing to gate.

## Verdict

**FAIL.** Return to **ux-developer** (Phase 4) for D1 (Medium) and D2 (Low). No design flaw, no escalation to Phase 3. After the fix, qa re-runs the 16-test spec, the gates and a phone check of the end-of-page bar; then Phase 6 (analyst).

**Screenshots and scripts:** `/private/tmp/claude-501/-Users-cshenso-git-westervillelions/cc4e88df-e85f-4880-b31e-2ecb8a0c63d9/scratchpad/santas-workshop-signup/qa/` (`shots/` holds my viewport shots at 360/390/768/1280 for all seven screens, the pinned-bar mid/form/end shots at 360 and 390 including `360-pinned-end.png` which shows D1, and the anchor shots; the `.mjs` scripts, `build.log`, `matrixA.out`, `matrixB.out`, `flows.out`, `more.out`, `contrast.json` are alongside). ux-developer's earlier screenshots are one level up.

---

### Handoff block — Phase 5 — Verification — 2026-10-11

**Owner:** qa
**Status:** complete

#### Summary
FAIL. The prototype meets its purpose and every unlisted, no-persistence, overflow, contrast, motion and flow check, but two explicit criteria fail: the pinned Reserve bar covers the site footer's last links at the end of the page on phones (D1, Medium), and `/book` skips a heading level (D2, Low). Both are pinned by failing specs I added.

#### What I did
- Ran tsc, lint, the full suite (209 files, 3659 tests), `pnpm build:only`, and the design's six test files (35 tests).
- Measured unlistedness with curl and greps, drove all seven screens and four landing states at four widths in both motion modes, measured contrast on 3,554 rendered text runs, and wrote 16 Playwright tests.

#### Outputs
- `/Users/cshenso/git/westervillelions/e2e/santas-workshop-preview.spec.ts` (new, 14 pass / 2 expected-fail).
- This section of `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-11-santas-workshop-signup.md`. No code, `decisions.md`, `backlog.md`, `package.json` or release-note edits; no commit; dev server untouched.

#### Open questions / handoff notes
- Next agent: **ux-developer** to fix D1 and D2, then qa re-verifies (the two specs plus the gates), then analyst for Phase 6.
- Someone with a real phone should look at the pinned bar after the D1 fix (touch behaviour and iOS cannot be reached from here).
- Orchestrator: decide whether the British spellings should be corrected before the chair sees it (copy, not a defect).

## Re-verification after the Phase 4 loop-back fix — 2026-10-11

**Final verdict: PASS.** The FAIL above stands as the record of the first pass; D1 and D2 are closed. Tree state measured: HEAD `c20ff24` plus the uncommitted tree (ux-developer's loop-back edits to `pinned-reserve.tsx`, `memory-book.tsx`, and the US-spelling edits in `landing-sections.tsx`, `landing-state.ts`, `event-facts.ts`, `art-slots.ts`, `sample-data.ts`); `package.json` unchanged; dev server untouched; nothing committed.

| Check | Result |
|-------|--------|
| `e2e/santas-workshop-preview.spec.ts` against :3000 | **16 of 16 pass** (6.2 s); both regression specs now green |
| D1, 360 and 390 px, Open state | Bar visible at 0-4000 px (73 px tall), hidden while the form card is on screen, **hidden at max scroll** (`bar=null`, previously covering "Privacy Policy" and "Lions Clubs International"); sampled every 500 px, it never reappears from 4500 px to the page end. Scrolling back up past the form brings it back (mid-page 73 px at y=600). Tap on the bar and on the hero CTA still lands `#reserve` at 80 px |
| D2, `/book` heading order | h1, h2, h2: 0 heading jumps on all 7 screens x 4 widths x 2 motion modes (280/280 structural assertions, 0 FAIL) |
| British spellings in rendered text | **None.** Scanned the rendered text, `aria-label`s and title of every screen, all four landing states, the three delivery options, the S3 end-of-trip state and the walk-up panel for favour/colour/centre/neighbour/grey and 20 other common variants: 0 hits. Source still contains "neighbour" only in an internal identifier and comments in `screens.ts` and `flow-footer.tsx`, not user-facing |
| `pnpm exec tsc --noEmit` | PASS (clean) |
| `pnpm lint` | PASS, 0 errors, the same 1 pre-existing warning in `budget-context-panel.tsx` |
| `pnpm test` | PASS, 209 files, 3659 tests, 3.97 s |
| Regression sweep of everything else | Landing states x 4 widths 100/100; flows (journey, conductor, book, delivery radiogroup, photo station) 128/128 across 4 widths; keyboard path 12/12; art brief and reduced-motion checks pass; 48 overflow checks all 0; contrast re-measured on 3,554 runs: 0 below threshold at the 5th percentile (same as before) |
| Network, storage, unlisted checks | Unchanged by the fix (the edits touched no routing, metadata or data layer); `package.json` and the lockfile unchanged |

One red line in the sweep is my own harness, not the app: the check that looks for the text "ART SLOT" followed by an id on the landing page fails because the placeholder renders the label and ratio on separate lines (verified in the first pass, the visible text is "Art slot / Hero scene / 3:2 · 2400x1600"). The art brief itself (18 slots, aspect and pixels) passes.

Still not verified, and needs a person with a real phone: the pinned bar's touch behaviour and iOS safe-area padding (likely moot, no `viewport-fit=cover`; a theory, not observed). Per my standing rule I am flagging this rather than signing it off from emulation; it does not block Phase 6 for a prototype but the chair should glance at it on his phone.

**Next:** analyst, Phase 6.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-11
**Measured on:** HEAD `c20ff24` plus the uncommitted tree (`docs/decisions.md` modified; `src/app/santas-workshop/`, `src/components/santas-workshop/`, `e2e/santas-workshop-preview.spec.ts`, this work-log). Re-ran `pnpm exec vitest run src/components/santas-workshop` (6 files, 35 tests, green). Walked all seven screens on the running dev server at 390 (touch emulation) and 1280 myself; read the source for the registry, event facts, delivery switch, check-in, confirmed and landing copy. Nothing edited except this work-log; dev server untouched.

## VERDICT

**SHIP WITH NOTES.**

## ONE-LINE TAKE

> The prototype does what the user asked: it lets the chair tap through the whole event on his phone (parent's path, conductor's path, Saturday photos, Sunday's delivery with all three paperless options side by side) with every artwork slot labelled, and it is safe to leave on a public host; two things stop it from being SHIP IT, a sentence on the Art brief that promises something the code does not do, and a phone behavior nobody has seen on a phone.

## What's Working

- **The chair can hold the whole event in his hand.** One banner on every screen says "Sample content, nothing here is real or saved", seven pills walk the weekend in order (Sign up, Booked, Journey, Book, Check-in, Photos, Art brief), a Previous/Next footer saves scrolling back, and the four landing states are a toggle on the first screen. Reserve leads to a booked screen, so the end-to-end feel is there without a payment form.
- **The paperless question is answerable on one screen.** `/book` shows the memory book as a swipeable phone-sized flipbook beside (desktop) or under (phone) a three-way "How should the book be delivered?" switch (Paperless / Paperless plus a keepsake card, marked Recommended / Printed book) with a Sunday line, a "Good" line and a "Watch for" line for each. The printed option names the real risk (sixty books between Saturday's photos and Sunday's pickup); the paperless option names the retention question. That is exactly the decision the user raised, framed so the chair can react to it rather than read about it.
- **Look and feel is distinct but still the club's.** Night-sky blue with `lions-blue-dark`, gold accents, a cream boarding-pass card for the form, a serif display face, a train-and-rails motif; the site header and footer remain; no `lions-red` (cranberry is a page-scoped variable). I saw no horizontal scroll, no stuck bar, and clear 44px controls at 390 and 1280.
- **Unlisted-ness and "nothing real" are enforced, not promised.** `/santas-workshop` is a 404, the preview is `noindex, nofollow` with no canonical and a prototype-specific OG title, nothing is in the sitemap, robots.txt, header, footer or any link, sample data is fictional by test, and the code imports nothing from the database, auth or email layers and stores nothing. QA measured each of these.
- **The art brief answers "what do I need to make?"** Eighteen slots, each with aspect, pixel size, where it appears, a note, a target path and suggested alt text; every value matches my Phase 1 table; the "no IHOP or preschool logos" line is present.

## 1. Screen by screen: does it show what the chair needs to confirm?

Legend: **Delivered** (as Phase 1 asked), **With difference** (shows it, differently or less), **Not delivered**.

### The parent's path

| Screen | Verdict | What the chair sees, and the difference if any |
|--------|---------|-----------------------------------------------|
| S1 Sign-up page (four states) | **Delivered** | Hero with title, proposed dates, "$15 per stuffy", "60 stuffies"; gold Reserve button; story; three steps with real windows; five scenes; what to bring; four FAQs; boarding-pass form card listing the eleven questions with Required/Optional; privacy sentence ("photos of the stuffies only, never the children"); phone-only pinned Reserve bar. Before/Open/Full/After all behave as the Phase 1 table said; no spots-left count anywhere; no "donation" or "tax-deductible". Difference (ruled at Phase 3, accepted): the default state is Open, not "Opens soon". |
| S2 After you pay | **Delivered** | "Pip has a seat on the train", honestly labelled as a mock of Zeffy's receipt plus the club's next steps; the three dates; the tracking-card explanation. |
| S3 Follow the journey | **Delivered** | Nine stops in a real ordered list, current stop highlighted with the word "Now:", done stops with photo slots, "Last updated" and the pickup window, stuffy's name only; demo buttons move Pip along so the chair sees it without waiting a weekend. |
| S4 Memory book | **Delivered** | Eight-page flipbook (cover with name plate, five scenes, certificate, closing), page counter, Prev/Next, Save as PDF and Share with grandparents as visibly "Not wired" buttons, plus the delivery switch. Difference: the page headline reads "The memory book, paperless" before the chair has chosen; on a phone the switch sits below the book. Harmless for a review, noted in the checklist. |

### The conductor's path

| Screen | Verdict | What the chair sees, and the difference if any |
|--------|---------|-----------------------------------------------|
| S5 Conductor check-in | **Delivered, with one difference** | Night-theme phone list: big counter ("8 of 24 checked in (sample)") with a progress bar, search by name/kind/tag, two window chips, rows with tag, stuffy, kind and color, a red care-note line, a "Boarded" chip and a large Check in / Undo button, and a walk-up row that opens inline. Nothing is saved; reload resets. **Difference:** Phase 1 Flow 4 ended "check in, hand over the tracking card". The Booked screen says the family is handed a QR card at check-in, but the conductor screen never shows that hand-over step, and the care note is displayed, not added. Neither changes what the chair is judging (list speed and shape), so I record it under the checklist, not as a defect. |

### Saturday's photo flow

| Screen | Verdict | What the chair sees |
|--------|---------|---------------------|
| S6 Photo station | **Delivered** | Pick one of five scenes, pick a stuffy by tag, a fake Take photo that ticks "n of 24 photographed", Done moves to the next stuffy. The page says "About 300 photos in one day, so each one needs seconds", which is the number the chair needs to judge volunteer effort. The link from a photo to S3's stops and S4's pages is by reading across screens, not by a live connection; that is the right amount of prototype. |

### Sunday's delivery, including paperless

| Piece | Verdict | Note |
|-------|---------|------|
| Landing step 3 and S4 book | **Delivered** | Pickup window 1 to 3 PM at IHOP, book "ready to open on your phone". |
| Paperless / hybrid / printed switch | **Delivered** | Defaults to the recommendation (Paperless plus a keepsake card). Cost of the printed option is described as "the largest cost risk", which is my Phase 1 opinion before I had seen the budget; the chair knows the numbers and should confirm or soften it. |
| Pickup hand-over (who may collect, how a parent reaches the book from the card) | **Not delivered** | There is no pickup screen, and Phase 1's Open Question 6 ("who may collect a stuffy on Sunday") is not asked anywhere in the prototype, nor is "how does the book reach a parent" (default: the same QR card opens it, no email). Phase 1 did not ask for a pickup screen, so this is a gap in my spec, not the build; both go on the chair's checklist as questions, not as more screens. |

## 2. Does it honor the user's three statements?

| The user said | Verdict | Evidence |
|---------------|---------|----------|
| "open the pipeline for the signup page. be creative but modern. i can figure out the artwork needed." | **Honored**, with one caveat | Creative and modern: night-sky field, boarding-pass form, ticket-stub cards, serif display type, train-and-track motif, snow and steam that stop under reduced motion. Artwork is the user's: 18 labelled dashed slots with the exact size and ratio, plus an Art brief page. **Caveat:** the Art brief says "Supply the file at the path shown and the slot switches on." The code does not do that: a slot only renders an image when `src` is set in `src/components/santas-workshop/art-slots.ts`, and the "Needed / Supplied" chip is driven by the same field. A user who drops a file in `public/images/santas-workshop/` and reloads will see no change and conclude the page is broken. (Note N1.) |
| "remember this is a prototype so we don't need all the functionality. just want to show and confirm look and feel and workflow with [the chair]." | **Honored** | Static, sample data, no database, no email, no Zeffy form, no accounts; the value is the workflow across seven screens and the decisions it surfaces. Nothing was built that the chair does not need to react to; nothing was cut from the Phase 3 list. |
| "i also wonder if we should do a paperless delivery." | **Honored** | The three-way switch with the recommendation preselected, a flipbook that shows what paperless looks like, inert Save as PDF / Share buttons, a retention warning in the "Watch for" line, and the hybrid keepsake card as a middle path. The chair can reach his own answer by tapping, which is the point. |

## 3. Phase 1 adversarial pass: closed or remaining

| Phase 1 item | Status | Evidence / where it goes |
|--------------|--------|--------------------------|
| Unlisted is discoverable; nothing real may be on it | **Closed** | Sample data fictional (test-enforced and independently grepped by QA); "Sample Preschool A/B"; no person named; no real contact details; banner on 7 of 7 screens. |
| Redirect / parameter reflection | **Closed** (prototype) | No query parameter read or reflected; landing state is client state; URL carries nothing. **Remaining (production):** vanity-subdomain redirect to a fixed canonical URL (B-166). |
| Parent lands after the cap | **Closed** | No spots-left count anywhere (test-enforced); Full state is a manual flip and says so. **Remaining (production):** who flips it (B-166). |
| Two parents buy the last ticket | **Not applicable** | Page never claims availability. |
| A child's name in a URL, title or card | **Closed** (prototype) | Titles generic; screens show the stuffy's name only; tags are not names. **Remaining (production):** opaque tracking tokens, same response for unknown and expired, rate limiting (B-167). |
| Iframe blocked / Zeffy down | **Remaining (production)** | The prototype shows the fallback line as inert sample text. Real embed, ticket-appropriate iframe title and "open in a new tab" link are B-166. |
| QR printed before the URL is final | **Closed** (prototype) | `/santas-workshop` is a 404, pinned by a test, so an early print fails loudly. **Remaining:** canonical and vanity URLs pinned (B-166). |
| Date changes after posters print | **Partly closed** | Every date comes from `event-facts.ts`; the page carries "Dates and times are proposed and may change. This page is always the latest." **Remaining:** the poster's own small print (chair/printer). |
| State-machine shortcuts and enumeration (tracking, roster, photo screens) | **Remaining (production)** | Server-side gates on roster and photo screens; no unauthenticated reads (B-167). |
| Input boundaries and self-targeting | **Closed** (prototype) | The only input is a local search over sample rows. **Remaining:** care-note text is untrusted in production; escape and cap (B-167). |
| "Page promises Phase 2" | **Closed** | The tracking sentence is one isolated block with a "Phase 2 idea" chip. Production must remove it unless B-167 is committed. |
| Privacy line must be true | **Open, needs the chair** | The sentence ships ("stuffies only, never the children"); it is only true if the chair agrees to the Saturday rule (no children at the house, no phones out at the hand-off). Checklist item. |
| Entity framing (no "donation", no "tax-deductible") | **Closed** (prototype) | Test and QA scan: none on any screen. **Remaining:** the Zeffy account question below decides production copy. |
| "$15 per stuffy, not $15 total"; one family many stuffies | **Closed** for copy; **Open** for the fact | Copy and a 1 to 3 stepper match. Whether Zeffy asks the custom questions once per ticket or once per order needs a Zeffy test form (B-166). |
| Real-phone behavior of the pinned bar | **Remaining** | See follow-up N2. |

## 4. The chair's review checklist (short, readable on a phone)

*Open `/santas-workshop/preview`, tap through Sign up, Booked, Journey, Book, Check-in, Photos. Dates and windows below are the user's proposals, not agreed.*

1. **Memory book:** paperless, paperless plus a printed keepsake card (recommended), or a printed book? Tap the three options on the Book screen.
2. **Dates:** drop-off Fri Dec 11, photos Sat Dec 12, pickup Sun Dec 13. Does IHOP agree? Registration opens Sun Nov 8?
3. **Windows:** two Friday drop-off windows (5:30 to 6:15, 6:15 to 7:00) and pickup Sunday 1 to 3 PM. How many families per window?
4. **Cap and tickets:** 60 stuffies, up to 3 per order, no waitlist. Right?
5. **Tracking card:** hand each family a QR card at check-in (no email)? Photos live on Saturday, or all at once Saturday evening (about 300 photos)?
6. **Sunday pickup:** whoever holds the card may collect? How does a parent reach the memory book (the same card)?
7. **Volunteers:** do the conductor and photo helpers have club accounts, or are some spouses and youth who do not?
8. **Preschools:** which belong in the dropdown? OK to name IHOP in text only, no logos, until IHOP agrees?
9. **The form:** keep parent mobile, care note, the photo-sharing checkbox, and the "not responsible for loss or damage" box? (Wording to the treasurer and insurer.)
10. **Privacy promise:** "We take photos of the stuffies only, never the children." Can the club keep that on Saturday?
11. **Title:** keep "A Visit to Santa's Workshop"?
12. **For the treasurer, one line (blocks the real page, not this prototype):** will the ticket form live on the **Club's** Zeffy account or the **Foundation's**? It decides where the money lands and what the page may say. Do not assume.

Tell the chair: flip to "Before it opens" before forwarding the link to anyone else; it opens in Open every time.

## 5. Artwork the user supplies

Files go in `public/images/santas-workshop/<slot-id>.webp` (or `.svg` for vector). Shapes and sizes below are what the Art brief page shows. **Do not supply IHOP's logo or any preschool's logo.** No children in any photo.

| Slot (id) | Aspect | Size | Where it appears |
|-----------|--------|------|------------------|
| Hero scene (`hero-scene`) | 3:2 | 2400x1600 | Sign up. Keep the subject in the center third; crops to about 4:5 on phones, 21:9 wide |
| Train, engine and cars (`train`) | 3:1 | 900x300 | Sign up, Booked. Transparent SVG, facing right (a stand-in is drawn today) |
| Track tile (`track-tile`, optional) | 10:1 | 1200x120 | Sign up, Journey (a CSS track is drawn today) |
| Scenes x5 (`scene-wrapping`, `-workshop`, `-cookies`, `-story`, `-reindeer`) | 4:3 | 1200x900 | Sign up |
| Step icons x3 (`step-dropoff`, `-journey`, `-pickup`) | 1:1 | 256x256 | Sign up. SVG, transparent |
| Conductor character or stamp (`conductor-stamp`) | 1:1 | 512x512 | Booked, Check-in, Journey, Book. Transparent |
| Memory-book cover (`book-cover`) | 4:5 | 1200x1500 | Book. Leave a name-plate zone near the bottom, about 70% wide by 12% tall |
| Stuffy photos x5 (`stuffy-wrapping`, `-workshop`, `-cookies`, `-story`, `-reindeer`) | 4:3 | 1200x900 | Journey, Book, Photos, Sign up. One plush per scene |

That is 18 files. The Open Graph share image is production only.

**Important until N1 is fixed:** dropping a file in the folder does not turn a slot on; `src` must also be set in `art-slots.ts`.

## Intent-vs-Shipped Diff

- Phase 1 said: a static, unlisted, noindex walkthrough at `/santas-workshop/preview` with `/santas-workshop` reserved. Shipped: exactly that, test-pinned. **Verdict: matches.**
- Phase 1 said: seven-ish screens with four landing states and a shared banner and switcher. Shipped: seven routes, banner and pills on all, state toggle on the landing page, state in context (not the URL). **Verdict: matches.**
- Phase 1 said: default Open or "Opens soon" for sharing. Shipped: Open (Phase 3 ruling 3). **Verdict: acceptable drift**, mitigated by the banner and the handoff line to flip it before forwarding.
- Phase 1 said: the Zeffy form is a realistic placeholder card whose Reserve leads to S2. Shipped: boarding-pass card with a working 1 to 3 stepper, the question list, an inert fallback line. **Verdict: matches.**
- Phase 1 said: conductor roster of "n of 60". Shipped: 24 sample rows, "n of 24 (sample)" (Phase 3 ruling 5). **Verdict: acceptable drift**, and better.
- Phase 1 said: conductor flow ends with handing over the tracking card. Shipped: not shown on S5 (shown on S2 only). **Verdict: acceptable drift**; checklist item 5.
- Phase 1 said: S4 shows hybrid with a keepsake line. Shipped: a three-way switch plus the line. **Verdict: acceptable drift** (an addition, Phase 3 ruling 6c), and the best part of the build.
- Phase 1 said: art slots with name, size and aspect, "the page looks complete with placeholders". Shipped: 18 slots, all values match, plus an Art brief page. **Verdict: matches**, except the switch-on sentence (N1). **Regression in copy only.**
- Phase 1 said: privacy line true, no "tax-deductible", no "donation", no spots-left count. Shipped: all four, three test-enforced. **Verdict: matches.**
- Phase 1 said: motion subtle, static under reduced motion, no content hidden pending an animation. Shipped: QA measured 0 running animations under reduce and identical text. **Verdict: matches.**
- Phase 1 said: accessibility (contrast 4.5:1, 44px targets, headings in order, list semantics). Shipped: 3,508 runs measured, zero failures at the 5th percentile; one heading skip found and fixed; journey is an `<ol>`. **Verdict: matches.**
- Phase 1 said: two tests (noindex, sitemap silent). Shipped: six files, 35 tests, plus a 16-test e2e spec. **Verdict: matches** (more).

## Edge Cases

- Empty state: **pass** (Before shows "Opens soon" and "scan the QR code again then", Full shows the full message, After shows thank-you; conductor search with no match says so and points to walk-up). Not applicable: a database empty state.
- Failure microcopy: **pass for the prototype** (no network, no database; no stack traces possible); the production failure copy (Zeffy blocked, wrong tracking link, photos not ready) is carried in B-166/B-167/B-168.
- Permission gate: **not applicable** (public, anonymous, no `FEATURES` key; the route is outside `/admin` and `/members`, so the proxy falls through). The conductor and photo screens being open is acceptable only because they hold fictional data; the gate is B-167.
- Mobile (360px): **pass** (QA: 0 px horizontal overflow at 360, 390, 768, 1280 on all screens and states; I saw 390 and 1280 myself). The pinned bar on a real phone is **not verified** (N2).
- Brand consistency: **pass** (cards `rounded-2xl`, buttons `rounded-lg`, chips only `rounded-full`, no `window.confirm`, gold on dark only, no `lions-red`).

## 6. Follow-ups (each its own work-log entry or backlog line)

**N1. Art brief copy overpromises (fix before commit; absorbable, under 30 lines, no schema or API).** The sentence "Supply the file at the path shown and the slot switches on" and the "Needed" chip are wrong while `src` is set in code. Two acceptable fixes, ux-developer's choice: (a) reword to "Put the file at the path shown, then the slot is switched on in `art-slots.ts`" and let the chip say "Needed" until set; or (b) have the server-rendered registry check that the file exists at build time and use it, which makes the sentence true. Prefer (b) only if it stays under about 30 lines with no new dependency; otherwise (a). If this is done before the commit it needs no backlog ID.

**N2. Real-phone check of the pinned Reserve bar (the user or the chair, 30 seconds).** On an actual phone, Open state: the bar stays put while scrolling, hides while the form card is on screen, and does not cover "Privacy Policy" and "Lions Clubs International" at the very end. Also glance at touch and the address-bar resize. QA could only emulate it; the bar is only on this prototype page, so if it misbehaves the cheap answer is to drop it, not to tune it. No backlog ID.

**N3. Chair-review polish pass (after the chair answers; fix in `event-facts.ts`, `delivery-switch.tsx`, `landing-sections.tsx`).** Fold in: confirm or soften "the largest cost risk" on the printed option; add the card hand-over line to S5; optionally retitle the Book hero to "The memory book" until the switch is chosen; the two nested landmarks on `/book` and the double Reserve button at the top of a phone (QA low items). No backlog ID; it is the next prototype pass if there is one.

**N4. Site header does not stay pinned (QA observation, not this diff).** QA saw `position: sticky` on the site header scroll away on `/about` (top at -1500 px), probably because of `overflow-x: hidden` on `html, body`. Theory, not verified. Not a Santa's Workshop issue; only the Phase 3 design leaned on it. Proposed backlog text below (needs the next free ID from the orchestrator, not one of the reserved three).

**Reserved IDs: which are needed.**

| ID | Needed? | Why |
|----|---------|-----|
| B-166 | **Yes** | The production sign-up page; carries the Zeffy BLOCKING FACT, the form-link decision, the embed and fallback, Open Graph, sitemap, `events` row, vanity subdomain and the prototype cleanup. |
| B-167 | **Yes** | Per-family tracking and conductor check-in with its volunteer gate; only worth filing if the chair says yes to item 5 and 7, but the findings (token model, gate, offline, retention of family data) are already specific enough to hold in a backlog line. |
| B-168 | **Yes** | The memory-book builder and paperless delivery; the user's paperless question makes this a real item, not a placeholder. |
| DECISION-118 | **Used** | See item 7. No second decision is needed. |
| Any further reserved ID | **Release** | N1 to N3 do not need one; N4 gets a fresh ID if the orchestrator wants it filed. |

### Proposed backlog text (drafts; the orchestrator or tech-lead files)

- [ ] **B-166 — Santa's Workshop production sign-up page at `/santas-workshop`.** Replaces the 404 reserved by DECISION-118. Zeffy ticket form with the custom questions the chair confirms (one ticket per stuffy; verify with a Zeffy test form whether questions repeat per ticket), opened in the existing modal embed on phones with an "open in a new tab" fallback and a ticket-appropriate iframe title (`ZeffyEmbed` hard-codes "Donation form powered by Zeffy"). Date-driven Before/Open/After computed in Eastern time from one module, manual Full flip. Entity-correct copy: ticket, never donation, never tax-deductible. Add an `events` row for Dec 11-13, sitemap entry, Open Graph card (1200x630 and 1:1), remove `noindex`, delete the "no page.tsx at /santas-workshop" assertion, vanity redirect `santasworkshop.westervillelions.org` (temporary redirect to the fixed canonical URL; establish who controls DNS), QR pinned only after the vanity address is verified live. Decide whether to keep or delete `/santas-workshop/preview` and its sample-data module. **Blocked on:** the chair's checklist answers and the treasurer's answer to which Zeffy account issues the form (Club or Foundation); do not default it.
- [ ] **B-167 — Santa's Workshop family tracking and volunteer check-in (event phase 2).** Per-family capability link (opaque high-entropy token, identical response for unknown and expired, rate limited), conductor roster with search and check-in that tolerates a weak signal in a restaurant lobby, photo station, a volunteer gate decided by whether volunteers have accounts (a new `FEATURES` key via `/add-permission`, or a short-lived link or PIN for non-members, rejected server-side not by hiding links), care-note text escaped and length-capped, retention of any family data decided up front. No email from the site unless a separate durable-send pipeline is opened. Depends on B-166 and on the chair confirming the tracking card.
- [ ] **B-168 — Santa's Workshop memory book builder and paperless delivery (event phase 3).** Per-stuffy book from the scene photos, Save as PDF, Share link, how long the club keeps the photos, a printed keepsake card and print-on-request for families without a phone, stuffy-only photos with the share opt-in respected. Depends on B-167 and on the chair's printed / paperless / hybrid choice.
- [ ] **B-NNN — Site header does not stay pinned while scrolling (QA observation 2026-10-11).** QA saw the `sticky top-0 z-50` header scroll away on `/about`; theory: the `overflow-x: hidden` on `html, body` in `globals.css`. Unverified. Confirm in a browser, then fix or correct the comment that says it is sticky. Low priority; assign the next free ID.

## 7. DECISION-118 status

**Promote from Proposed to Resolved, with two small wording edits (tech-lead edits `docs/decisions.md`; I did not).** I re-read every factual sentence against QA's "Established by measurement" list:

- Item 1 (`/santas-workshop/preview` and sub-routes; no `page.tsx` at `/santas-workshop`; 404): established (404 measured, test-pinned).
- Item 2 (`robots` in the layout, no canonical, prototype title and OG title, not in `robots.ts`, `sitemap.ts` or navigation): established (meta tag, 0 canonicals, `og:title` and `twitter:title`, sitemap and robots.txt silent, no links from `src/`, `public/` or `next.config.ts`).
- Item 3 (banner on every screen; nothing from database, auth or email; no browser storage; no `fetch`): established for the prototype's own code (greps, test, banner 7 of 7). **Edit 1:** "All data is fictional and held in one module" is slightly too tidy: the sample families live in `sample-data.ts`, but the proposed dates, price and cap live in `event-facts.ts` and are the user's real proposals, labelled "proposed". Say so. **Edit 2:** "issues no `fetch`" should read "its own code issues no `fetch`" because QA saw the root layout's existing `SessionProvider` call `/api/auth/session` on this page, exactly as on `/about`.
- Item 4 (source-scan tests): established (`preview-unlisted.test.ts`, `sample-data.test.ts`, 35 tests green; I re-ran them).
- Item 5 (landing state in client state, never the URL): established (survives soft navigation, resets on reload, URL carries nothing).
- "Unmeasured" paragraph (search engines honour `noindex` promptly; no outside page links to it): stays as written; it is still believed, unmeasured.

Proposed status line: `**Status:** Resolved (2026-10-11; promoted at Phase 6 after re-reading each sentence against QA's "Established" list; the "Unmeasured" paragraph still stands)`.

## 8. Release notes draft

The change is code on `main` (public routes, components, tests), so it deserves a version bump: **minor, 1.90.0 to 1.91.0**, a new `docs/release-notes/v1.91.md` (the `/release-notes` skill writes it and bumps `package.json`; the orchestrator or tech-lead owns those files). One Feature entry, no file lists:

> | [1.91.0](#1910) | 2026-10-11 | Feature | An unlisted, clickable preview of the Santa's Workshop sign-up experience for the event chair to review |
>
> ### Feature: Santa's Workshop preview
>
> **Background:** A member's approved proposal, "A Visit to Santa's Workshop", will have preschoolers send a stuffed animal on a pretend train ride to the North Pole. Before building the real sign-up, the club needs the event chair to confirm how it should look and work.
>
> **Changes:**
> - There is now a clickable preview of the whole weekend, from the parent's sign-up page and "you're booked" screen, to following the stuffy's journey and a swipeable memory book, to the volunteer conductor's check-in list and Saturday's photo station.
> - The memory-book screen lets you compare three delivery options (paperless, paperless with a printed keepsake card, or a printed book) side by side.
> - An Art brief page lists every picture the page needs, with sizes.
> - Everything in the preview is sample content: nothing is saved, no one is emailed, and no payment is taken. The preview is not linked from the site and is hidden from search engines; real registration will come in a later release.

## Red Flags (if NEEDS REWORK)

None. No red flag blocks the intent: the prototype shows the workflow, honors the three statements and is safe on a public host.

## 9. Verdict

**SHIP WITH NOTES.** It is not SHIP IT for two reasons that I am not willing to paper over: (1) the Art brief tells the person who will make the artwork that dropping a file in a folder switches a slot on, and it does not (N1, a copy fix the orchestrator can absorb before the commit, after which nothing in the build itself is outstanding); (2) the pinned bar has been seen only in emulation (N2), and the chair's decisions in section 4 are still open. Neither blocks the chair from reviewing it. Commit and push remain the user's call (Workflow Rule 1); `/pre-push` and `/release-notes` run at that point.

---

### Handoff block — Phase 6 — Shipped vs Intent — 2026-10-11

**Owner:** analyst
**Status:** complete

#### Summary
Walked all seven prototype screens (390 with touch emulation, 1280) and read the registry, facts, delivery switch, check-in and confirmed sources against my Phase 1. The prototype delivers the chair's four paths (parent, conductor, Saturday photos, Sunday delivery with a three-way paperless choice), honors all three of the user's statements, and closes every Phase 1 adversarial item that can close in a prototype. Verdict SHIP WITH NOTES: one copy defect on the Art brief (it says dropping a file switches a slot on; the code needs `src` set), one phone behavior only seen in emulation, and the chair's open decisions.

#### What I did
- Read the whole work-log, DECISION-118, QA's Established list; re-ran the 35 unit tests; walked the screens in Playwright; read `art-slots.ts`, `event-facts.ts`, `delivery-switch.tsx`, `landing-sections.tsx`, `confirmed/page.tsx`, `screens.ts`.
- Wrote the chair's checklist, the art table, the follow-ups with proposed backlog text, the DECISION-118 recommendation and the release-notes draft.
- Updated the Per-Phase Status row for Phase 6.

#### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-11-santas-workshop-signup.md` (this section; status row). Scratch screenshots in `<scratchpad>/santas-workshop-signup/p6/`. No source, `decisions.md`, `backlog.md`, `package.json` or release-note edits; no commit.

#### Open questions / handoff notes
- **Orchestrator:** (a) have ux-developer absorb N1 before the commit; (b) tell the chair to flip to "Before it opens" before forwarding the link, and to do the 30-second phone check (N2); (c) the user takes the section 4 checklist to the chair and asks the treasurer the Zeffy account question (no database fact is needed, so no Verify-First block).
- **Tech-lead:** promote DECISION-118 to Resolved with the two wording edits in section 7; file B-166, B-167, B-168 from the proposed text (all three are needed), the optional header item under a fresh ID, and release the rest; write v1.91.md and bump `package.json` to 1.91.0 when the user approves the commit.
- **Pipeline:** SHIP WITH NOTES ships; N1 is the only item to do before commit; the rest are tracked above.

---

## Ship filing (tech-lead, 2026-10-11)

**Owner:** tech-lead
**Status:** complete (filing only; no `src/`, `e2e/` or `public/` edits, no tests or builds run, no commit)

Filed, from the analyst's Phase 6:

- **DECISION-118** in `docs/decisions.md`: Proposed to Resolved (2026-10-11). Item 3 reworded with the analyst's two edits: the sample families are fictional and in `sample-data.ts` while the proposed dates, price and cap live separately in `event-facts.ts` and are real proposals labelled "proposed"; "issues no `fetch`" is now scoped to the prototype's own code, since the root layout's session call (`/api/auth/session`) still runs on the page. The "Unmeasured" paragraph is unchanged.
- **Backlog** (`docs/backlog.md`, ToC updated): B-166 (production sign-up page) under Soon, with the chair's gating questions and the treasurer's Zeffy-account question (Club or Foundation); B-167 (family tracking and conductor check-in) and B-168 (memory-book builder and paperless delivery) under Later, each carrying the chair's checklist items that gate it. Reserved IDs line in the header updated: all three IDs and DECISION-118 used.
- **Release notes:** new `docs/release-notes/v1.91.md` with one Feature entry, 1.91.0 (2026-10-11); `→ [v1.91](v1.91.md)` added to the bottom of `v1.90.md`; `package.json` bumped 1.90.0 to 1.91.0.
- **CLAUDE.md:** one Project Structure line for `santas-workshop/preview/`, and one Public Website bullet in Key Features for the unlisted-prototype pattern. Treasury guide: no applicable change (no Ledger surface touched).

Not filed, on purpose:

- **Site header does not stay pinned while scrolling (analyst N4).** QA saw the `sticky top-0` header scroll away on `/about`; theory is `overflow-x: hidden` on `html, body`. Unverified and outside this diff, so no backlog ID. If someone confirms it in a browser, file it then.

Still open from Phase 6 (not mine to close): N1 (Art brief copy overpromises; absorb before the commit), N2 (real-phone check of the pinned Reserve bar), N3 (chair-review polish pass), and the chair's section 4 checklist. Commit and push remain the user's call; `/pre-push` runs then.

### Orchestrator: Phase 6 note N1 fixed before commit (2026-10-11)

Absorbed deviation (under 30 lines, no schema, no API): the Art brief promised "supply the file at the path shown and the slot switches on", but a slot only switched on when `src` was set by hand. `ArtSlot` renders inside client components, so a file-system check is not available. Fix: `art-slots.ts` now exports a `SUPPLIED` set at the top of the file; `ART_SLOTS` derives `src: path` for any id in it. The artist puts the file at the slot's `path` under `public/`, adds the id to that one list, and the box becomes the image. The Art brief lead says exactly that. New unit test "SUPPLIED switch" in `art-slots.test.ts` (prototype unit tests 36/36). tsc and eslint clean on the touched files; the production build and full e2e re-measured at pre-push.

## Pre-push gates (orchestrator, 2026-10-11)

Measured on `c20ff24` plus the uncommitted prototype tree (logs in scratchpad `prepush-3/`). The art-slot `SUPPLIED` change landed while the e2e suite was at 91/373, before the prototype spec ran, so the suite covered the final code.

| Gate | Result |
|------|--------|
| Typecheck | PASS |
| Lint | PASS (0 errors; the pre-existing `budget-context-panel.tsx:114` warning) |
| Unit tests | PASS — 209 files, 3659 tests |
| Production build | PASS — re-run after the registry change; the seven `/santas-workshop/preview` routes print, `/santas-workshop` does not |
| E2E (full suite, serial) | PASS — 372 passed, 1 skipped, 21.9 min (includes `santas-workshop-preview.spec.ts` 16/16) |
| Schema and migrations | no change |
| Dependency CVE audit | PASS (exit 0); 1 low + 1 moderate advisory, unchanged |
| Personal data sweep (`--untracked`) | clean; no `.env*` tracked |
| Native dialogs / console.log / db imports under the prototype | none |
| Release notes + version | `docs/release-notes/v1.91.md` 1.91.0, `package.json` 1.91.0, CLAUDE.md updated |

Ready to push: yes, pending the user's approval to commit and push (Workflow Rule 1). Phase 6: SHIP WITH NOTES; N1 fixed before commit; N2 (real-phone check of the pinned bar) and the chair's checklist stay with the user.

## Deployed (orchestrator, 2026-10-11)

- User approved with "push". Committed as `c6c7f6b` (v1.91.0) and pushed to `main`; Vercel status `success` at 19:46 ET.
- Live checks: `https://westervillelions.org/santas-workshop/preview` 200 with `<meta name="robots" content="noindex, nofollow">`; `https://westervillelions.org/santas-workshop` 404; `robots.txt` carries no santas-workshop line. The local dev server on :3000 serves the same route.
- Treasurer question (checklist item 12) answered by the user the same evening: **the form lives on the Club's Zeffy account.** Money that belongs to the Foundation goes into the Club Activity fund and is swept to the Foundation afterward. Recorded on B-166; the production build is no longer blocked on it, only on the chair's checklist.
- Still with the user: forward the link to the chair after flipping the landing page to "Before it opens"; the 30-second real-phone scroll check of the pinned Reserve bar (N2); the chair's checklist items 1-11.

## Sent to the chair (user, 2026-10-11 evening)

The user emailed the chair the preview link with four questions that gate the start of the real build and a set of stated defaults for the rest. Recorded here because the defaults narrow the section 4 checklist and B-166/B-167 should start from them.

**Questions that gate the real build:** IHOP confirmed for Fri Dec 11 to Sun Dec 13; registration opens Sun Nov 8; 60 stuffies at $15, up to 3 per order, no waitlist; which preschools go in the dropdown.

**Stated defaults (pending the chair's objection):**
- Two Friday windows (5:30 to 6:15, 6:15 to 7:00), Sunday pickup 1 to 3 PM; families per window and Sunday at IHOP still to confirm. Overnight storage Friday and Saturday is a new open question.
- Train-ticket QR card at drop-off opens the journey and later the memory book; the same link goes in the email confirmation as the lost-card backup (new, from the outside review).
- Photos published in one batch Saturday evening, not live (checklist item 5 resolved toward the batch option).
- Memory book paperless plus a printed keepsake card (checklist item 1, the recommended middle option).
- Pickup: card plus the conductor confirming the parent's name on the order (new, replaces "whoever holds the card").
- Stuffies only, never children, stated on the page.
- Dry run with 5 to 10 stuffies before the weekend (new).
- Title stays "A Visit to Santa's Workshop"; tickets on the Club's Zeffy account; registration language to be reviewed before go-live (covers the loss-or-damage box and the insurer wording from item 9).
- Volunteer accounts (item 7) asked as-is.

**Form fields as described to the chair:** parent contact, stuffy's name and description, optional care note and note to Santa, photo-sharing permission. The email did not mention the child's first name, which the prototype asks for as required. The outside review suggested dropping it or making it optional; the real build should treat it as optional at most, and the memory book copy must read well without it.

**Design notes from the outside review carried to B-167:** the identifying tag must be visible to the photographer but kept out of the finished frame, because a photo attached to the wrong stuffy is hard to detect afterward.

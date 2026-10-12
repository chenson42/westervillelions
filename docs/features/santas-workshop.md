# A Visit to Santa's Workshop — Build Spec (living document)

> Started 2026-10-12 with the event chair in the room. Everything marked **(proposed)** is the
> website team's guess; everything marked **(decided)** was settled with the chair. Open items
> are numbered Q-n so notes can refer to them. The clickable prototype is at
> `/santas-workshop/preview` (local: http://localhost:3000/santas-workshop/preview, live:
> https://westervillelions.org/santas-workshop/preview). Backlog: B-166 (sign-up page),
> B-167 (tracking + check-in), B-168 (memory book). Prototype pipeline: `docs/work-log/2026-10-11-santas-workshop-signup.md`.

## 1. What we are building

A family registers a stuffy online, drops it off on a Friday evening, follows its
"train ride to the North Pole" on Saturday as volunteers photograph it in a series of scenes,
and picks it up Sunday with a memory book of the photos. The club raises money and goodwill;
the operation is run by volunteers with phones.

**Year-one principle:** the software is the easy part; the Saturday photo line is the risk.
Build only what the weekend needs, and run a dry run with 5 to 10 stuffies before the event.

## 2. Event facts

| Fact | Value | Status |
|------|-------|--------|
| Title | A Visit to Santa's Workshop | (proposed) keep |
| Event dates | **Fri Dec 18 to Sun Dec 20, 2026** | (decided, chair 2026-10-12; corrected from "19 to 21" in the same session) |
| Drop-off | **Fri Dec 18, 4:00 to 7:00 PM, three windows** (presumably 4 to 5, 5 to 6, 6 to 7; exact splits to confirm) | (decided, chair 2026-10-12) |
| Photos | **Sat Dec 19** | (decided, chair 2026-10-12); hours (proposed) |
| Pickup | **Sun Dec 20**; 1:00 to 3:00 PM | day (decided, chair 2026-10-12); time (proposed) |
| Place | **IHOP, confirmed** Fri Dec 18 to Sun Dec 20 (drop-off and pickup) | (decided, chair 2026-10-12) |
| Registration opens | **Sun Nov 8** | (decided, chair 2026-10-12) |
| Price | **$15 per stuffy** | (decided, chair 2026-10-12) |
| Cap | **No cap on stuffies** (prototype proposed 60); per-order limit and waitlist moot | (decided, chair 2026-10-12) |
| Families per window | unknown | Q1b |
| Overnight storage | not an app concern | (closed, chair 2026-10-12) |
| Preschools | **none; no preschool field** | (decided, chair 2026-10-12) |
| Payment | Zeffy ticket form on the Club's Zeffy account; proceeds land in the Club Activity fund; anything owed to the Foundation is swept afterward. **Form created 2026-10-12:** share link `https://www.zeffy.com/en-US/ticketing/a-visit-to-santas-workshop` (set in `facts.ts`; embed via `toEmbedUrl`) | (decided, treasurer 2026-10-11) |
| QR stickers | **ordered by the chair** (generic pre-printed stickers; the app binds whatever each encodes) | (decided, chair 2026-10-12) Q14b |
| Copy rule | "ticket", never "donation" or "tax-deductible" | (decided, follows from the account) |

## 3. The family's journey (screens in the prototype)

1. **Sign-up page** (`/santas-workshop`, real URL reserved; prototype has four states: Before it
   opens, Open, Full, After the event). Story, dates, price, the form (Zeffy embed), FAQ.
2. **After you pay.** Confirmation with the drop-off window, what to bring, the stuffy's ticket
   number. Zeffy sends the receipt email; the club's page adds the practical details.
3. **Drop-off.** The family's tag is already made and waiting on the table (see §4). A worker
   scans the tag's QR code, takes the stuffy's first photo, and the stuffy is checked in. The
   family may get a **train ticket / receipt** for the check-in (chair: "we might"; Q15). The
   QR link also goes in the email confirmation as the backup (decided).
4. **Photo day.** One **unique portrait of the stuffy with Santa and Mrs. Claus** (scan the
   tag, take the picture), plus **several group pictures** of many stuffies together. Photos
   are published in one batch that evening, not live (decided).
5. **Pickup.** The family receives a **printed frame with the stuffy's Santa portrait**; the
   frame carries a QR code to the **collage of the day**, the pictures of all the stuffies in
   the different scenes. The worker confirms the parent's name on the order before handing
   over (decided). The frame replaces the earlier "printed keepsake card".
6. **Memory book** becomes two things: the per-stuffy portrait (printed in the frame and on
   the journey page) and the shared day collage the frame's QR opens. The per-stuffy
   multi-scene book from the prototype is no longer the plan (decided, chair 2026-10-12).

## 4. The volunteers' journey (decided with the chair, 2026-10-12)

The chair has already printed cardboard tags. The process, in order:

1. **Register and pay** online through Zeffy (§6). The registration list reaches the app
   before drop-off day (CSV import; Q11 answered: not keyed in at drop-off).
2. **Tagging, any time before drop-off.** A worker opens the app **as a worker**, scrolls the
   registrants, fills out a physical cardboard tag by hand for one, puts a **QR sticker** on
   the tag, then **photographs (scans) the QR code with the phone** to bind that code to the
   record. The registrant is now in the state **tagged**. Workers can do this in any order, in
   several sittings, from anywhere.
3. **Drop-off day.** All tags are laid out on a table, probably alphabetical. When a child and
   stuffy arrive, the worker **scans the tag**, then **takes the first picture** of the stuffy.
   That is the check-in (state **checked in**). Possibly hand over a train ticket / receipt
   (Q15).
4. **Photo day.** For each stuffy: **scan the tag, take the one portrait** with Santa and Mrs.
   Claus (state **portrait taken**). Also take **group pictures** of many stuffies; these go to
   the day collage and need not be linked to individual records (Q18).
5. **Before pickup.** Print a **frame** per stuffy with its portrait and a QR code to the day
   collage (Q16: who prints, on what, and the overnight turnaround).
6. **Pickup day.** Find the stuffy (scan the tag or search by name), confirm the parent's name,
   hand over stuffy and frame (state **picked up**).

**State machine for a stuffy:** registered → tagged → checked in → portrait taken → picked up.
Every transition is one worker action on a phone, and the first three are each "scan, then
photo". Scanning an already-bound code at tagging time must warn, and scanning an unbound code
at check-in must refuse (the stuffy was never tagged).

- Q6 answered (chair, 2026-10-12): **a shared worker code** per session; no club login
  required. An admin sets the code on the session; a worker enters it once on the phone and
  every action records the session and code, not a person.
- Q14: **who makes the QR stickers.** If the app generates and prints them (each encoding a
  URL with an unguessable token), binding is just "scan sticker, pick registrant". If the chair
  already has generic stickers, the app must accept whatever they encode as an opaque key, and
  the family-facing link then has to be looked up by that key rather than carried in the code.

## 5. Scenes (decided, chair 2026-10-12)

**One unique portrait per stuffy with Santa and Mrs. Claus, plus several group pictures** of
many stuffies in different scenes. The six-solo-scene plan and the "economy option" in the
prototype are both superseded (Q7 answered). Per-stuffy work is one scan and one shot; the group
pictures are free-form. The prototype's five scene illustrations become the day-collage scenes
rather than per-stuffy pages.

## 6. The registration form (Zeffy custom questions)

Parent name and email (Zeffy's own), parent mobile, child's first name (**optional at most**;
the book must read well without it), stuffy's name, what the stuffy is (type and color), Friday
drop-off window, care note (optional; no medical details, no last names),
a note to Santa (optional), **snack choice (required; e.g. regular, nut-free, dairy-free, gluten-free, no snack) so the club can offer an appropriate snack without asking for allergies (decided, chair 2026-10-12)**, the loss-or-damage acknowledgment (required; wording to the
treasurer and insurer), photo-sharing permission (optional). Q8 answered 2026-10-12: nothing more for now.
Q9: verify with a Zeffy test form whether custom questions repeat per ticket.

Privacy promise on the page: **"We photograph stuffies only, never the children."** Q10: can
the club keep that on Saturday?

## 7. Data the app has to hold (sketch for the tech-lead)

- **Order** (from the Zeffy CSV import): parent name, email, mobile, window, Zeffy order id,
  paid amount, created at.
- **Stuffy** (one per ticket): order, name, description, child first name (optional), care
  note, note to Santa, photo-sharing flag, **state** (registered / tagged / checked
  in / portrait taken / picked up) with a timestamp and worker per transition, **tag code** (the
  value read from the QR sticker; unique; bound at tagging time), **token** for the family's
  link (unguessable; never the tag number; may equal the tag code only if the app prints the
  stickers, Q14).
- **Photo**: stuffy (nullable for group pictures), kind (check-in / portrait / group), file,
  taken at, taken by; bytes in Postgres like receipts and club files (the repo is public; images
  never enter it). Phone-camera capture straight from the worker screen.
- **Day collage**: the published set of group pictures plus, where the photo-sharing flag
  allows, every portrait; one public-ish page the frame's QR opens (Q17: open to anyone with
  the link, or only families?).
- **Frame**: a per-stuffy **4x6 JPEG** (1200x1800 at 300 dpi) with the portrait, the decorative
  frame art and the QR code to the day collage composited into the image; the app offers all
  of them as one zip download for upload to a photo service (decided, Q16).
- **Session (event run)**: everything above hangs off a session row (name, dates, windows,
  Zeffy form, scenes, collage page), so the **dry run is its own session** and the real event
  is another; next year is a third. Nothing about a given event is hard-coded (decided).
- No Zeffy API exists: orders arrive by CSV export before drop-off (Q11 answered).

## 8. Decisions already made

1. ~~Tracking card with QR at drop-off~~ **QR sticker on the chair's cardboard tag, bound before drop-off** (amended 2026-10-12); link also in the email. 2. Photos published in one batch the evening of photo day. 3. ~~Paperless book plus printed keepsake card~~ **printed frame with the Santa portrait, QR to the day collage** (amended 2026-10-12). 4. Pickup requires the card
plus the parent's name. 5. Stuffies only, never children, in photos. 6. Dry run with 5 to 10
stuffies before the weekend. 7. Title stays. 8. Club's Zeffy account; sweep to the Foundation. 9. The word is **"stuffy" / "stuffies"** everywhere, never "stuffed animal" (chair, 2026-10-12). 10. One portrait per stuffy with Santa and Mrs. Claus plus group pictures; no per-stuffy multi-scene book. 11. Tags are made from the registration list before drop-off by any worker, any time. 12. Check-in is scan plus first photo. 13. No cap on stuffies; photo-line risk accepted. 14. Frames are 4x6 photos with the frame art and collage QR composited in, downloaded as a zip and uploaded to a photo service by hand; no print API. 16. Registration asks for a snack choice, never allergies. 17. Workers use a shared per-session code, not club logins. 18. Stuffies only in photos, confirmed. 19. Proceeds go to the Central Ohio Diabetes Association and the Ohio Lions Pediatric Cancer Foundation. 20. No purchasable book; the family page is printable. 21. Group pictures are unlinked, collage only. 15. The workshop app is **reusable across sessions**: the dry run, the real event and future years are separate sessions in the same app.

## 9. Open questions (take these in order)

- Q1 answered: IHOP confirmed Fri Dec 18 to Sun Dec 20. Q1d resolved: **Dec 18 is drop-off**; the earlier "19 to 21" was off by one. Drop-off Fri 18, photos Sat 19, pickup Sun 20, which is the weekday pattern the prototype already assumes; only the dates in `event-facts.ts` change (11 to 13 → 18 to 20). Q1b families per window: moot with no cap unless IHOP sets one. (Q1c answered: drop-off Sat 19, photos Sun 20, pickup Mon 21. `event-facts.ts` still says Dec 11 to 13; B-166 updates it.)
- Q2 answered: Nov 8.
- Q3 answered: $15 per stuffy; no cap. Q3b closed: the chair accepts the photo-line risk of an uncapped sign-up (2026-10-12); no cutoff, no second station planned.
- Q4 answered: no preschools at all; the field comes off the form and the prototype. (IHOP naming: text only, no logos, until they agree — still assumed.)
- Q5 closed: not an app concern.
- Q6 answered: shared worker code per session (see §4).
- Q7 answered: one Santa and Mrs. Claus portrait per stuffy plus group pictures.
- Q8 Form fields: add or drop anything?
- Q9 answered (research, 2026-10-12): Zeffy has "per attendee" questions that repeat once per ticket and "buyer" questions asked once per order; stuffy fields go per attendee, parent fields per buyer. A test order still confirms the export's column shape.
- Q10 answered: yes, stuffies only, never children.
- Q11 answered: CSV import before drop-off; tags are made from that list.
- Q12 answered: proceeds support the **Central Ohio Diabetes Association** and the **Ohio Lions Pediatric Cancer Foundation** (page copy; both are Foundation-side beneficiaries, so the sweep in B-172 applies). No dollar goal stated.
- Q13 answered: **no** purchasable book, but the family's page (portrait plus collage) must be **printable** with a clean print stylesheet. Earlier proposal kept for reference: Proposed: a downloadable PDF of the B-168 book, rendered server-side (`@react-pdf/renderer`, no new infra), sold as a Zeffy add-on question or ticket tier and flagged from the CSV import; physical print-on-demand (Lulu Print API, Peecho, Gelato) is year two because it needs a shipping address.
- Q14 answered: the chair ordered QR stickers, so the app binds an **opaque code** read from the sticker. Q14b (when they arrive): confirm every sticker is unique and what it encodes (a serial, a random string, a URL); if it is a URL to some vendor site, the app stores the full text and matches on it exactly. The family link is then a separate app token sent by email and printed on the frame, not the sticker.
- Q15 answered: yes, a train ticket at check-in, but handled outside the app this year.
- Q16 answered (chair, 2026-10-12): **no print API.** The app renders each frame as a 4x6 image (300 dpi, 1200x1800) with the decorative frame and the collage QR code composited into the photo itself, bundles them as a **zip download**, and a worker uploads the batch to a photo service for pickup. Who uploads and which store are logistics, not software.
  Options checked 2026-10-12: **Walgreens Photo Prints API** (developer.walgreens.com/api/quickprints) is a public JSON API with same-day in-store pickup, prints ready in about an hour; needs a developer account and production approval, so apply early. **CVS and Walmart** same-day printing is driven by the Kodak Moments Print partner API (a partner program, not open self-serve). **Meijer** has no public API. Fallback that needs no API: the app renders every frame image at print size (4x6 or 5x7 at 300 dpi, QR baked in) as one zip, and a worker uploads the batch to any store's photo site for one-hour pickup.
- Q17 answered: the collage is open to anyone with the link. Follow-up for the form: the photo-sharing permission then governs whether a stuffy's portrait appears in the public collage; group pictures show whoever is in them.
- Q18 answered: group pictures are **not linked** to individual stuffies; they are common and live only in the collage.
- Q19 answered: a **snack choice** field, not an allergy question, so no health information is collected. The exact option list is copy for B-166 (proposed: regular, nut-free, dairy-free, gluten-free, no snack). The choice is shown to workers on the check-in screen.

## 9a. Reusability (decided, chair 2026-10-12)

The workshop is built as a **multi-session** feature, not a one-off. A session carries its own
name, dates, drop-off windows, Zeffy form link, scene list, registrant list, photos and collage
page. Consequences for the design: the dry run (decision 6) is a real session with test
registrants, so it exercises the same import, tagging, check-in, portrait, frame export and
collage code as the event; a session can be archived without deleting its photos; `event-facts.ts`
stops being the source of truth once B-167 lands and the public page reads the active session;
QR codes bind to a stuffy within a session, so a sticker from the dry run cannot check in at the
real event; the collage URL is per session. Admin surface: `/admin/santas-workshop` lists
sessions; the worker screens take the session from the URL.

## 10. Not in year one

Live photo updates during Saturday; a printed book for everyone; per-stuffy social sharing;
online pickup scheduling; anything that needs a Zeffy API (there is none).

## 11. Build plan for "later today"

Three pipelines, in this order, each shippable on its own:

1. **B-166 Sign-up page** (`/santas-workshop`): real page from the prototype's landing screen,
   Zeffy ticket embed, date-driven states, events row, sitemap, Open Graph card, vanity
   redirect. Needs: Q1 to Q4 answered and a Zeffy ticket form created. Half a day.
2. **B-167 Conductor + photo station**: orders and stuffies tables, CSV import, check-in list,
   tag numbers, card tokens and the family's journey page, photo upload per scene (phone
   camera, stored in Postgres), pickup confirmation. Needs: Q6, Q7, Q11. A day.
3. **B-168 Memory book**: book page per stuffy from its photos, batch publish, "ready" email,
   printable keepsake card. Needs: book copy template and the card design. Half a day.

## 12. Notes from the session (append below, newest last)

- 2026-10-12: session opened; chair reviewing the prototype on a phone.
- 2026-10-12: **Dates: Dec 19 to 21** (chair). That is Sat/Sun/Mon, not the Fri/Sat/Sun the prototype assumed; which day is drop-off, photos and pickup is still open (Q1c).
- 2026-10-12: **Copy: "stuffies", not "stuffed animals"** (chair). Applied to the prototype's landing copy, scene alt text and the FAQ; the privacy line now reads "We only photograph stuffies."
- 2026-10-12: **Drop-off 4:00 to 7:00 PM, three windows** (chair). Prototype has two windows 5:30 to 7:00; `event-facts.ts` `DROPOFF_WINDOWS` and the form's window select change to three. Exact window boundaries assumed hourly until confirmed.
- 2026-10-12: **No limit on the number of stuffies** (chair). Prototype's 60 cap, 3-per-order and "sold out" state come out; the Zeffy ticket form gets no quantity limit. Raises Q3b: the photo line was the named year-one risk, so capacity now comes from volunteers and hours, not the form.
- 2026-10-12: **Photo-line risk accepted** (chair). No registration cutoff or second station; the dry run (decision 6) is the mitigation.
- 2026-10-12: Chair asked about an ebook parents could buy. Answer: PDF from the same photos is cheap and needs no API; sell it as a Zeffy add-on; physical print via Lulu or similar is a year-two item (Q13).
- 2026-10-12: **Full worker process from the chair** (tag from the registration list with a QR sticker any time before drop-off; drop-off = scan + first photo; photo day = scan + one Santa and Mrs. Claus portrait, plus group pictures; pickup = printed frame with the portrait and a QR to the day collage). Rewrote §3 to §5 and §7; amended decisions 1 and 3; answered Q7 and Q11; opened Q14 to Q18.
- 2026-10-12: Chair asked about a local one-day print API. Walgreens has one (same-day, ~1 hour); CVS/Walmart via Kodak Moments partner program; Meijer none. Recorded under Q16 with a no-API batch-upload fallback.
- 2026-10-12: **Frames and printing decided** (chair): 4x6 photos, frame art and collage QR composited into the image, zip download, manual upload to a photo service; no print API. **Reusable sessions decided**: the dry run and the real event are separate sessions in one app (new §9a).
- 2026-10-12: **Registration asks about allergies** for the snack (chair). Added to §6; privacy handling proposed under Q19 (worker-only, purged at session close, or a snack-choice field instead).
- 2026-10-12: **Chair answered the open list:** QR stickers ordered (opaque codes, Q14); drop-off Sat Dec 19, so photos Sun 20 and pickup Mon 21 (Q1c); $15 (Q3); registration opens Nov 8 (Q2); collage open to anyone with the link (Q17); train ticket yes but not the app's job this year (Q15); no preschools (Q4); overnight storage not an app concern (Q5).
- 2026-10-12: **Snack choice, not allergies** (chair). Form asks a required snack-choice question; no health data held.
- 2026-10-12: **Chair closed the remaining list:** IHOP confirmed (but said "Friday through Sunday" — conflicts with Dec 19 to 21 being Sat to Mon; Q1d); shared worker code (Q6); stuffies only (Q10); proceeds to Central Ohio Diabetes Association and Ohio Lions Pediatric Cancer Foundation (Q12); no purchasable book, make the page printable (Q13); group pictures unlinked (Q18); nothing more on the form (Q8). Only Q1d, Q9 (Zeffy per-ticket test, a build step) and Q14b (sticker check on arrival) remain.
- 2026-10-12: **Dates corrected: Fri Dec 18 drop-off, Sat Dec 19 photos, Sun Dec 20 pickup**, confirmed with IHOP (chair). Supersedes the "Dec 19 to 21" note above. Q1d closed.
- 2026-10-12: **Zeffy ticket form created** by the user: `https://www.zeffy.com/en-US/ticketing/a-visit-to-santas-workshop`. Pasted into `WORKSHOP_2026.zeffyShareUrl` (unit tests pass). Headless Chromium got a 403 from the embed URL (Cloudflare bot check, not conclusive); a real-browser check (L5) is pending. Next: test purchase + refund, then API key and webhook secret.
- 2026-10-12: Zeffy form renders in the page (L5). Tickets are not receipted; only the optional extra-donation block is (Foundation gift). Keep our copy "ticket"; clear the pre-filled extra-donation amount; event end 3:00 PM. Extra donations and tickets share one payment: ticket → Public Funds, gift → Foundation (B-172).
- 2026-10-12: **Zeffy structure confirmed (user):** ONE Zeffy organisation serves both the Club and the Foundation; it pays out to the **Club's** bank account; Foundation gifts land in Public Funds (the Activity fund) and are swept to the Foundation. The user renamed the organisation so the form reads properly. Open check: what name and EIN Zeffy now prints on tax receipts (the donate and White Cane pages promise the Foundation's name and EIN 32-0467239).

**Zeffy facts (orchestrator, 2026-10-12):** the user generated the organisation API key (stored in `.env.local` of the main tree and the pipeline worktree as `ZEFFY_API_KEY`; never in the repo). A read-only `GET /api/v1/campaigns` succeeded (HTTP 200). Campaign ids (not personal data): **A Visit to Santa's Workshop** = `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e` (ticketing, active) — this is the id for Connect; White Cane 2026 = `b175c706-ad80-4eac-96d1-6beb8ddc15bb` (donation form); the general donate form = `39232196-d844-430f-9b5f-394dd940e07b`; a meeting raffle and a memberships form also exist. The S2a spike can now run against the real API once a test purchase exists.

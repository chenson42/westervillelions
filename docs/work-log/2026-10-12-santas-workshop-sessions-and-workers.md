# Santa's Workshop sessions, worker screens, frames and collage (B-167, increment 2) — Work Log

> **Slug:** `2026-10-12-santas-workshop-sessions-and-workers`
> **Surface:** mixed: admin (`/admin/santas-workshop` sessions, CSV import, worker code, frame zip export), a worker surface gated by a shared per-session code (no club login), a public per-session collage page, and a per-family tokenized page
> **Permission(s):** new admin key for session management (name via `/add-permission`, admin + board_member by default, to be confirmed in Phase 3); workers authenticate by a shared per-session code, rejected server-side
> **Estimated complexity:** large
> **Pipeline mode:** Full (specialist split: database-admin → api-developer → ux-developer)
> **Reserved IDs:** DECISION-120 to DECISION-125 (120 filed by increment 1; 121 to 125 filed by increment 2 at Phase 3); backlog B-166/B-167/B-168 already exist
> **Source spec:** `docs/features/santas-workshop.md` — every fact and decision in it was settled with the event chair on 2026-10-12 and supersedes the 2026-10-11 prototype assumptions (`docs/work-log/2026-10-11-santas-workshop-signup.md`). Read the spec first; it is the Phase 1 input.
> **Hard dates:** registration opens Sun Nov 8, 2026; drop-off Fri Dec 18, photos Sat Dec 19, pickup Sun Dec 20; a dry run with 5 to 10 stuffies before the weekend.
> **Guardrails:** public repo, no personal data (the chair's first name in a governance context is fine, no contact details); no live email; no production writes; photos and registrant data live in Postgres, never the repo. Three increments, one work-log each: this file, `2026-10-12-santas-workshop-sessions-and-workers.md` (B-167), and B-168 when B-167 ships.
> **Increment scope (spec §4, §7, §9a):** sessions (name, dates, windows, Zeffy link, scenes, worker code, collage); Zeffy CSV import → orders and stuffies; worker screens on a phone: scroll registrants, bind a QR sticker (opaque code from the chair's stickers, Q14b) to a stuffy, check-in = scan + first photo, portrait = scan + one photo with Santa and Mrs. Claus, group photos unlinked, pickup = scan or search + parent-name confirmation; state machine registered → tagged → checked in → portrait taken → picked up; photos in Postgres; per-stuffy 4x6 frame JPEG (portrait + frame art + collage QR) and a zip of all of them; public collage page per session; family page by token (printable; B-168 may fold in). Snack choice shown at check-in. No cap. Dry run is its own session.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-12 |
| 2 — Architectural review | architect | Complete | Approved with suggestions (one precondition: Phase 1 addendum) | 2026-10-12 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named (database-admin, then api-developer, then ux-developer, per slice; worktree + Neon branch) | 2026-10-12 |
| 4 — Implementation | database-admin (schema done), api-developer (server done), ux-developer (Slice 1 UI done) | Complete (Slice 1); qa next | — | 2026-10-12 |
| 5 — Verification | qa | Complete (Slice 1); re-verified twice (D1 to D3, then N1 to N3) | **PASS** (first run FAIL on D1/D2/D3, all fixed; tree: HEAD `6343fa6` + uncommitted Slice 1 diff in worktree) | 2026-10-12 |
| 6 — Shipped vs intent | analyst | Slice 1 complete; Slices 2 to 5 pending | Slice 1: **SHIP WITH NOTES** (N1 to N3 before Nov 8; N4 with Slice 2; N5 gate) | 2026-10-12 |

---

# Phase 1 — Functional Refinement (analyst)

**Date:** 2026-10-12 · **Inputs read:** spec `docs/features/santas-workshop.md` (§4, 5, 7, 8, 9, 9a, 12 as decided), B-167/B-168, `src/lib/club-file-storage/`, DECISION-039/094/095, `package.json`.

## VERDICT

**READY WITH NOTES.** Advance to Phase 2. One BLOCKING FACT (below) does not stop the architect but must be answered, or both branches designed, before Phase 3 freezes the import. The notes below become Phase 3 inputs.

## ONE-LINE TAKE

> A code-gated phone app that lets volunteers bind a sticker to an imported registrant, photograph the stuffy three times in its life (drop-off, portrait, group), hand it back after a parent-name check, and then produce a printable frame zip and a public collage, all inside a session that can be practised, closed and purged.

## BLOCKING FACT (ask the user in one line; Phase 3 cannot design the import without it)

**What does a real Zeffy ticket-form export look like?** The spec says "dedupe on the Zeffy order id" and Q9 ("do custom questions repeat per ticket?") is still open. The import's key, the stuffy count per order, where the snack / photo-sharing / care-note answers sit, and how a refund shows up all hang on the export shape, and no export exists yet (the Zeffy test form is not built). I cannot default it; I have not seen a Zeffy export.

**One line for the orchestrator to ask the user:** "When the Zeffy test form exists, buy two tickets in one order and refund one, export the CSV, and paste me the header row plus the order/ticket/status columns (use fake names), so we know the shape before the importer is designed."

**If it cannot be answered before Phase 3, design for both outcomes:**

| Export shape | Stuffy identity | Per-stuffy answers | Refund | Importer rule |
|---|---|---|---|---|
| A. One row per ticket, with an order id and a ticket id | `(session, zeffyOrderId, zeffyTicketId)` | read from the ticket's own row | status column or a separate refund row | upsert on the triple; additive on re-import |
| B. One row per order, quantity N, answers asked once | `(session, zeffyOrderId, index 1..N)`; N stuffies created, each named from the one answer, and **the importer flags "name N stuffies" for admin edit** | order-level (one snack, one sharing flag for all N) | order status; a partial refund is unknowable | upsert on order id; if N shrinks, mark extra stuffies `refunded-or-removed`, never delete |
| C. Per-ticket columns on one row ("Ticket 2 – Stuffy name") | as B, but names are present | per column group | as B | map by header pattern; refuse the file naming the unmapped columns |

Whatever the shape, the importer must: map columns **by header name** (never by position), refuse with the missing header named, report counts before committing, and treat the stored session window labels as the join to the Zeffy "drop-off window" answer text (an unmatched label imports as "unmapped window" with a warning, never dropped).

### Verify-First block (orchestrator runs; counts only, no personal columns)

Why: photos live in Postgres (decided), the sign-up has no cap, and Neon plans cap storage. My estimate (assumptions: client-downscaled JPEGs of roughly 0.5 to 1.5 MB; check-in + portrait + one retake per stuffy; 100 group photos; rendered frames cached) is on the order of **0.5 to 1 GB for a 200-stuffy session**, plus the practice session. I do not know current headroom.

```sql
-- run with an explicit branchId (production); sizes only
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT
  (SELECT count(*) FROM club_file_blobs)                         AS club_file_blobs,
  (SELECT pg_size_pretty(coalesce(sum(octet_length(data)),0)) FROM club_file_blobs) AS club_file_bytes,
  (SELECT count(*) FROM ledger_receipt_files)                    AS receipt_files;
```

- **Headroom of 3 GB or more under the plan limit:** proceed as designed (originals stored once, one derivative size).
- **Under about 1.5 GB of headroom:** Phase 3 must cap stored originals at about 1 MB / 2400 px long edge, store one derivative, render frames on demand rather than caching, and put a per-session byte quota on the admin page. Raise it with the user as a plan-limit question.

## User Verbs

Surfaces: **Public visitor** (anonymous), **Worker** (anonymous to the app, holds the session worker code; not one of the project's three standard surfaces, so named here explicitly), **Admin** (`/admin/santas-workshop`, new key), **Family** (anonymous, holds a per-stuffy token). Signed-in members with no features get no special handling: the worker and family surfaces do not look at the club login.

| Surface | Verb | Cadence |
|---|---|---|
| Admin | Create a session (practice or real), set name, dates, drop-off windows, Zeffy link, scenes, frame art | per event run |
| Admin | Preview the CSV import (counts, changes, refunds, unmapped windows), then commit it | several times per session |
| Admin | Generate / re-read / regenerate the worker code; pause or close worker access | per session, plus on a leak |
| Admin | Watch live counts by state and by window; open the "not yet picked up" list with parent contact | during the weekend |
| Admin | Add a complimentary or late registrant by hand (see Out of scope) | rare |
| Admin | Review group photos; hide or unhide any photo; publish the collage (one batch) | photo-day evening |
| Admin | Render frames, see which are missing or stale, download the zip (and the index CSV) | before pickup |
| Admin | Revert a stuffy's state with a reason; resolve a refunded-after-tagged flag | exception |
| Admin | Close a session; run the purge when eligible; reset a **practice** session | per event run |
| Worker | Enter the session code once on a phone | per device / per sitting |
| Worker | Scroll and search registrants (grouped by order), see window, stuffy, description, state | many times |
| Worker | Scan a sticker (or type its code) and bind it to a registrant; replace a sticker | per stuffy, before drop-off |
| Worker | Scan a tag at drop-off, see snack choice and care note, take the first photo | per stuffy, Fri |
| Worker | Scan a tag at the Santa station, confirm it is the right stuffy by its check-in photo, take the one portrait, retake if needed | per stuffy, Sat |
| Worker | Take group photos (unlinked) | repeatedly, Sat |
| Worker | At pickup, scan or search, confirm the person's name, mark picked up; show the family-page QR | per stuffy, Sun |
| Family | Open the collage from the frame's QR | once, after pickup |
| Family | Open their family page (portrait, collage link), print it | optional |
| Public | See nothing of the above; the collage page is "anyone with the link" | — |

## State machine (what each transition requires and records)

`registered → tagged → checked in → portrait taken → picked up`, with an append-only transition history per stuffy (precedent: proposal decisions): from, to, session, **code version**, **device id** (random per cookie, no person), server time, client capture time, idempotency key, optional note.

| Transition | Precondition | Worker action | Idempotent retry | Notes |
|---|---|---|---|---|
| registered → tagged | session active; not refunded | pick registrant, scan sticker | same sticker onto same stuffy = success, no new history row | rebind allowed while `tagged` (ConfirmDialog) |
| tagged → checked in | sticker resolves inside this session | scan, take photo (tag in the shot) | same idempotency key returns the stored result | "Check in without a photo" allowed, **flagged**; never blocks a family at the door |
| checked in → portrait taken | check-in done | scan, see check-in photo, take portrait (tag out of the shot), accept | retake replaces; old portrait kept as `superseded`, never shown | **one current portrait, enforced by a partial unique index, not by the screen** |
| (checked in or portrait taken) → picked up | not already picked up | confirm name, optional "collected by someone else" note | second tap returns "Already picked up at 1:42 PM" | **never blocked by a missing portrait**: it carries a "no portrait" warning, since the family must be able to take their stuffy home |
| tagged → picked up | — | refused | — | never dropped off; message says so |
| any backward move | admin only, reason required, appended as a new row | — | — | a worker "undo" for the last step within a few minutes is a Phase 3 call |

Every write is pinned to the expected current state (`expectedState`), taken under `FOR UPDATE`, and answers a stale screen with a typed 409 naming the current state and time, so a delayed retry cannot regress a stuffy.

## Flows

**Flow 1 — Admin sets up a session:** `/admin/santas-workshop` → New session (kind: **practice** or **real**, fixed at creation) → name, dates, three windows, Zeffy link, frame art, scenes → Create (state draft) → Activate → worker code shown once with copy button and the worker URL.
- Failure: duplicate slug, a window outside the event dates, no windows entered: field-level errors. A second *real* session marked public while one already is: refused with a sentence naming the other.

**Flow 2 — CSV import:** session page → choose file → server parses and **previews** ("12 new, 140 unchanged, 2 changed, 1 refunded, 3 unmapped windows, 0 rejected" with row-level reasons) → admin confirms → commit → import-history row (who, when, file hash, counts; never the contents).
- Re-import after late sign-ups **adds**; identical file again is a no-op and says so; changed rows update only import-owned fields; a row absent from a later export is marked "not in latest export", **never deleted**; worker-owned data (state, sticker, photos) is never overwritten.
- Failure: wrong file (missing required header named), over size or row cap, bad encoding (accept UTF-8 with BOM and Excel quirks, quoted newlines in care notes), nothing committed on any parse error (all-or-nothing).

**Flow 3 — Worker signs in:** text/email link to the worker URL (no code in the URL) → enter code → signed httpOnly cookie bound to session + code version + device id → registrant list.
- Failure: wrong, expired, revoked, locked-out and unknown-session all show **the same sentence** ("That code didn't work. Ask the event chair."); only a throttle adds "Wait a few minutes." Existing signed-in devices keep working during a throttle (otherwise an attacker can lock out the crew).

**Flow 4 — Tagging (any time, several sittings):** worker list → tap registrant → "Scan sticker" → code read → confirm card shows the **last 4 characters of the code and the stuffy name** → Save → state `tagged`, toast, list updates.
- Failure: see the binding-collision matrix. Weak signal: Save shows "Saving…", retries with the same idempotency key, and says "Saved" only after a server answer.

**Flow 5 — Drop-off (Fri):** worker list or scan → scan tag → card shows stuffy, description, **snack choice**, care note, window → take photo (tag in the shot) → preview with the stuffy's name above → Use photo → checked in.
- Failure: unbound code refused ("This sticker isn't tagged yet") with two buttons, **Tag it now** (opens Flow 4 with the code prefilled) and **Find by name**; camera denied → how to allow it; offline → photo held on the phone, a pending count in the header, nothing marked done until the server answers.

**Flow 6 — Portrait (Sat):** scan tag → card shows name, description and the **check-in photo** so the worker can confirm it is the right stuffy → take portrait → preview → accept → portrait taken. Retake replaces.
- Failure: not checked in yet → "Check in first" with a one-tap path to Flow 5 on the same record (a Saturday late arrival is real). Already has a portrait → "Replace the portrait?" ConfirmDialog.

**Flow 6b — Group photos:** worker → Group photo → take → accept. Lands **unpublished**, unlinked, counted per device; nothing is public until Flow 9.

**Flow 7 — Pickup (Sun):** scan tag or search name (3 or more characters, 10 rows max) → card → "Name on the order" is shown only after the worker taps **Confirm name** and records either "matched" or "someone else collecting: [note]" (the check is a recorded human step, not a string comparison) → Mark picked up → on success the screen offers the **family-page QR** for the parent to scan from the worker's phone.
- Failure: already picked up → shows when, no second action; no portrait → warning, hand-over still allowed; refunded flag → "Ask the event chair" banner, hand-over still allowed (a volunteer does not withhold a child's toy over a money question).

**Flow 8 — Frame export:** session page → Render frames (resumable, per-stuffy status, idempotent; a retaken portrait marks its frame **stale**) → report "138 ready, 4 stale, 6 have no portrait" → Download zip(s) (split by count if large) and a separate index CSV → admin uploads to the photo service by hand.
- Failure: render fails for one stuffy → listed by name with Retry; the zip never silently omits one.

**Flow 9 — Publish the collage (photo-day evening):** session page → review group photos (hide any) → Publish → the collage URL (stable, token-based, created at session creation) goes live; family pages go live at the same moment.
- Before publish the collage URL shows "The photos arrive on [date]", not a 404 (the QR is already printed by then).

**Flow 10 — Family:** scan frame QR → collage (group photos plus opted-in portraits) → optional family page from the pickup QR → Print.
- Failure: unknown or purged token shows one neutral "This page isn't available" (identical for unknown and expired); a purged collage shows a friendly "These photos have been removed" because printed frames last for years.

**Flow 11 — Close and purge:** Close session (workers locked out, import disabled) → on the eligible date, Purge (ConfirmDialog, count of what will go) → audit row of counts. **Practice reset** is the same screen, available only on practice sessions, and immediate.

## Permissions

- **Admin key:** one new key, `santas_workshop.manage` (final name via `/add-permission`, Phase 3). Covers sessions, import, worker code, live view, parent contact, hide/publish photos, frames, revert, close, purge, practice reset. Not split: the roster of people who may purge is the same roster who may import, and a second key is YAGNI.
- **Default roles:** `admin` and `board_member` (matches `events.announce` and `social_requests.review`). Do not bind to a broad member role: the key reads ~100 families' names, emails and mobiles. A holder who is neither (the event chair may not be a board member; see Open Questions, fact 3) is granted a role containing the key through `/admin/roles`, not by widening the default.
- **Proxy:** the admin page must appear in `ADMIN_NAVIGATION` (DECISION-082) **and** call `auth()` + `hasFeature()` itself (`admin-page-feature-gates.test.ts`).
- **Worker surface: code-gated, not permission-gated.** Rejected server-side on every route. A holder of the admin key may use the worker screens **without the code** (preview, testing, and a lock-out-proof fallback); those actions record device "admin". Recommend a **source-scan test** (precedent: `admin-page-feature-gates.test.ts`) that fails the build when a route under the worker path does not call the shared worker-auth helper, so a new route cannot ship ungated.
- **Family and collage surfaces:** token-gated, read-only, rate limited.

### Worker-code model (the ruling Phase 3 should adopt; proposed DECISION-120)

| Question | Ruling |
|---|---|
| Issued | Generated by the app when the session is activated: 8 or more characters from an unambiguous alphabet (no 0/O, 1/l/I), shown to the admin with a copy button. Admin-typed codes ("santa2026") are guessable and are not the default. |
| Re-read | The chair will forget it mid-weekend, so a permitted admin can **re-read** it; it is never logged, never in a URL, never in the repo or a work-log. |
| Entry | Typed once per device; the server sets a signed, httpOnly, same-site cookie bound to **session id + code version + device id + expiry**. Lifetime: long enough to cover one Friday-4-PM-to-Sunday-3-PM weekend without a mid-line re-entry (about 72 hours absolute), short enough that a lost phone is not a standing credential. |
| Throttle | The app has **no rate-limit infrastructure** (only `failed_login_attempts` as a DB-backed precedent; in-memory counters do not work across serverless instances). Needs a DB-backed counter per session and per IP, escalating delay, identical response, never affecting already-signed-in devices. |
| Rotation | Regenerate bumps the code version; every old cookie fails on its next request. Warn the admin first ("N devices were active in the last hour and will be signed out"), because rotating mid-drop-off strands the line. |
| Revocation | Separate from rotation: "Pause workers" and "Close session" lock everyone out instantly without issuing a new code. Closure is also evaluated lazily at request time against the session end (no cron exists in this project). |
| What each action records | session id, code version, device id, server time, client capture time, idempotency key. **No person, no IP, no name** (decided). |
| What a leaked code can do | Read the session's registrant list **minus email, mobile, Zeffy ids and notes-to-Santa**; bind and replace stickers while `tagged`; add photos and move stuffies forward through the states; mark picked up. Cannot: see another session, read the code or contact data, import, export, publish, hide, delete anything in a real session, revert, or reach `/admin`. |
| What it must never return | Parent email, parent mobile, Zeffy order/ticket ids, other sessions. Parent name appears only at pickup (after Confirm name) and on the tagging card (needed to write the tag). Search is minimum 3 characters, 10 results. |

## Binding-collision matrix

| Situation | Behaviour |
|---|---|
| Scan an unbound code at tagging | Normal bind. |
| Scan a code already bound to **the same** stuffy | Success, no new history row (this is the weak-signal retry). |
| Scan a code already bound to **another** stuffy that is only `tagged` | Warn showing the other stuffy's name; offer "Move this sticker to <this stuffy>" via ConfirmDialog; history keeps both bindings. |
| Same, but the other stuffy is `checked in` or later | Refuse; admin can fix with a reason. |
| Stuffy already has a different sticker | "Replace sticker?" ConfirmDialog; the old code becomes **retired**; scanning a retired code later says "This sticker was replaced" rather than "unknown". |
| Unbound code at check-in or portrait | Refuse (decided) with **Tag it now** / **Find by name** buttons. |
| Code bound in **another session** (dry-run tag at the real event) | Same message as unbound ("Not tagged in this session"); the app never looks across sessions on behalf of a worker. Uniqueness is `(session, code)`, so a recycled dry-run tag can be bound again in the real session. |
| Two workers bind the same code at once | The unique constraint decides; the loser gets the "already bound" path above, not a 500. |
| Every sticker decodes to the same text (a bad batch, or a vendor URL with no serial) | The second bind collides. The tagging screen shows the **last 4 characters**, and an admin "Test stickers" check (scan three, they must differ) is run when the roll arrives (Q14b). Raw text stored exactly, trimmed only, length-capped, treated as an opaque string: **a scanned URL is never navigated to or rendered as a link.** |
| Phone camera app opens the sticker's URL | If the stickers encode vendor URLs, scanning with the native camera app leaves our app. Scanning must happen **in the page**, with a "type the code" fallback. See architect note on decoder support. |

## Retention (proposed DECISION-121; recommended defaults, chair/board to nod)

| Data | Who sees it | Keep until (recommended) | At purge |
|---|---|---|---|
| Parent email, mobile, parent name, care note, note to Santa, child first name, snack | admin (name also workers, limited) | **30 days after pickup day** (the damage/dispute window) | nulled; Zeffy order ids kept as tombstones so a stale CSV cannot resurrect the people |
| Check-in photos (condition record) | workers, admin; **never public, never in the zip, never on a family page** | same 30 days | deleted |
| Portraits and published group photos | collage, family page | through **the end of the following January** (printed frames carry the QR for years, so the page should outlive the weekend) | collage replaced by "These photos have been removed"; bytes deleted |
| Superseded retakes | admin only | with check-in photos | deleted |
| Rendered frames | admin | until purge | deleted |
| Import history, transition history, counts | admin | permanently, no personal fields | kept |

Purge is an **admin-triggered action with a reminder** (no cron in this project), disabled until the eligible date, with a count preview. The orchestrator sets the reminder.

## Dry run versus real session

| Capability | Practice session | Real session |
|---|---|---|
| Kind | fixed at creation, immutable (a real session cannot be flipped to practice and wiped) | fixed at creation |
| Delete everything | yes: "Reset practice session", ConfirmDialog, immediate | **no**; only the dated purge after close |
| Delete a single photo | yes | **no**: hide/unhide by admin only |
| Revert a state | worker or admin | admin with a reason |
| Replace an import wholesale | yes | additive only |
| Public | collage and family pages **noindex**, banner "PRACTICE", excluded from the public sign-up page and sitemap | collage public after Publish |
| Frame QR | points at the practice collage; file names carry the session slug; a "PRACTICE" band on practice frames so one cannot be uploaded as real | real URL |
| Data | synthetic CSV (fixture in the repo may only be synthetic, `example.invalid`); volunteers may use their own stuffies, purged afterwards | Zeffy export |
| Worker code | random, same strength (it runs on the production app) | random |

The dry run must exercise, and Phase 6 will check it did: the **real stickers** (Q14b), iOS and Android phones, the real IHOP signal (airplane-mode toggles mid-photo), a low-light portrait, an actual frame zip **uploaded to the chosen photo service** (this is the only way to learn its file-name, size and orientation rules), a retake, a refund after tagging, a late re-import, and a pickup by someone other than the named parent.

## B-168 absorption ruling

- **Absorb (small):** the per-stuffy family page (portrait, collage link, thank-you and beneficiary lines, print stylesheet), its token, a full-size portrait download, and the pickup-screen QR. It is one read-only page over data this increment already holds.
- **Do not absorb:** any email ("your photo is ready"), the per-stuffy multi-scene book, PDF, print-on-request. If an email is ever added it is a **durable-claim path** and must use `sendEmailForDurableClaim()` (DECISION-102/103) with an exhaustive outcome switch; Phase 2 would have to confirm it. B-168 stays open, renamed "family-page delivery by email".
- **Delivery in year one:** the parent scans the QR on the worker's phone at pickup (after hand-over is recorded). Not printed on the frame (the frame carries only the collage QR; fewer links on an object uploaded to a third-party photo service). Not emailed: the site has no email path to non-member families.
- **Cut line if time is short:** collage and frame zip are hard dependencies (the printed QR must resolve by Sun Dec 20). The family page is the first thing to defer, and the pipeline can ship without it.

## Gaps the Request Didn't Address

1. **Spec §3.3 says "the QR link also goes in the email confirmation as the backup (decided)."** Nothing can do that: Zeffy sends the receipt and cannot carry a per-person token, and the site has no email path. Resolution: drop it. The backup for a lost tag is **search by name**, then "tag it now" (Flow 5). Confirm with the user so the spec stops promising it.
2. **Frame orientation.** Spec §7 says 1200x1800 (portrait); the kickoff brief says 1800x1200. They are different crops of a phone shot. Default: 1200x1800 per the spec, unless the frame art the chair has is landscape; the in-app camera guide must match. Needs the art in hand.
3. **The frame art does not exist yet** (art slots only in the prototype). Make art a per-session replaceable asset and ship a plain border so the pipeline is not blocked.
4. **Frame rendering must not be one request.** 200 frames in a single Vercel function will time out, and responses over 4.5 MB must stream. Render per stuffy, store, mark stale on retake, stream the zip. Zero-portrait stuffies are listed, never given a placeholder frame.
5. **Frame details a photo counter cares about:** baseline sRGB JPEG, no alpha, 300 dpi tag, EXIF orientation **baked in before compositing** (the classic phone-photo bug), QR inside a safe margin of about 0.25 in on a solid plate (kiosks crop 2 to 3 percent), QR short enough to scan at 4x6, human-readable URL under it, text drawn as pixels (stuffy names with emoji or non-Latin script need a font fallback or a stripped caption), caption = stuffy name only. QR must use the **single canonical app-URL helper** and the render must refuse a non-production base URL on a real session, so no frame carries `localhost`.
6. **Zip file names:** ASCII `[a-z0-9-]`, no spaces, unique, sorted in pickup order, **no personal data** (the third party sees them): `ssw-<session>-<NNN>.jpg`, number stable across re-export. The mapping number → family goes in a **separate admin-only index CSV** (formula-injection neutralised: a leading `=`, `+`, `-` or `@` is prefixed). Split into parts if the total is large.
7. **Third-party processing.** Frames are uploaded to a retail photo service. The sign-up copy (increment 1) should say frames are printed at a photo service. Stuffy portraits only; check-in photos never enter the zip. Confirm with the chair.
8. **Photo-sharing flag semantics.** The form question is optional; **blank must mean no** (opt-in). It governs only the public collage. A stuffy who opted out: portrait withheld from the collage, no name or caption, **frame and family page unaffected** (they are the family's own). Increment 1's form copy must word the question as "show my stuffy's portrait on the public collage page" and fix the answer values the importer reads. Cross-increment handoff, below.
9. **Group photos "show whoever is in them" contradicts "stuffies only, never the children."** A hand or face in a group shot is a promise broken in public. Resolution: group photos are unpublished until an admin reviews them (the batch publish already exists), any photo can be hidden at any time, the worker screen carries a one-line "stuffies only" reminder, and the collage page has a "Want a photo removed? Email info@westervillelions.org" line. Hidden photos must 404 immediately, so public images get short cache lifetimes and `404 on every failure, never 403` (club-files precedent).
10. **Quota and abuse.** Group photos are unlinked and uncapped: a leaked code could fill the database. Per-device upload rate, a per-session byte quota, and the publish gate.
11. **Weak signal needs a design, not a wish.** Minimum: client idempotency key per action, retry with the same key, "Saved" only after server answer, photo outbox surviving a reload (IndexedDB), a pending count in the header. **Tag lookup stays online** (caching every code and name on a phone is more personal data on a device). The photo is held, the lookup is not. Order of conflicting offline retakes: later capture on the same device wins, otherwise server order; superseded rows are kept.
12. **Photo upload size.** Phone originals exceed Vercel's 4.5 MB body cap. Client downscales and re-encodes (this also strips EXIF/GPS and bakes orientation) to about 1 MB before sending in **one request**; the chunked protocol (DECISION-095) is for 25 MB PDFs and is not needed unless Phase 3 finds otherwise. Reuse the HEIC path (DECISION-039). Server still validates by magic bytes, caps pixel dimensions before decode (decompression bomb), caps bytes, rejects zero-length.
13. **Tag in or out of the shot.** Check-in photo: tag visible (identity). Portrait: tag out of the frame (it ends up printed). Both are one-line worker prompts on the capture screen.
14. **The first photo is a condition record**, not decoration, because of the loss-or-damage acknowledgment. Hence 30-day retention, never public, shown to workers at the portrait and pickup stations. "Check in without a photo" is allowed but flagged and listed for the admin.
15. **Pickup check is theatre if the name is on screen.** Hence Confirm name before reveal and a recorded "someone else collecting" path. Whether a typed-name comparison is wanted is a Phase 3 call; my recommendation is no (spouses, grandparents, nicknames).
16. **Time zone.** Windows and dates are Eastern wall-clock values compared in `America/New_York`, never converted through UTC (DECISION-005 and the naive-timestamp bug in event/RSVP columns). Photo `takenAt` is a real instant and displays in Eastern.
17. **Public sign-up page must read "the public session."** Spec §9a says `event-facts.ts` stops being the source of truth once this lands. Rule: exactly one real session at a time is flagged public; practice sessions can never be. Whether increment 1 is migrated to read it in this increment or a follow-up is a Phase 3 call; increment 1 must not hard-code in a way that blocks it.
18. **Lifecycle of a session:** draft → active → closed (read-only for workers, import disabled) → purged. Archive = closed with photos retained. Closing is evaluated lazily at request time.
19. **Refund after tagging.** Default: flag on the worker card ("Ask the event chair"), never refuse. Admin resolves. Chair to confirm the policy.
20. **Empty states to specify:** no sessions ("Create a practice session first"); session with no registrants ("Import the Zeffy CSV"); worker list empty or search with no hit ("Not found. Signed up after the last import? Ask the chair."); collage before publish; collage published with zero photos; family page before portrait; frame export with nothing rendered.
21. **Failure microcopy** is specified per flow above; none shows a stack trace, a status code or the word "error" alone. Offline states say what is safe ("saved on this phone").
22. **Mobile and brand:** worker screens at 360 px, tap targets 44 px or more, inputs 16 px so iOS does not zoom, readable in a dim lobby. Cards `rounded-2xl`, buttons `rounded-lg`, `lions-blue` focus rings, every unbind, replace, revert, reset and purge through `<ConfirmDialog>`, no native dialogs. A file input with `capture` is not a dialog.
23. **Data minimisation on import.** Contact details are imported for admin follow-up only (lost tag, damaged item, unclaimed stuffy on Monday). Workers never receive them.
24. **Admin "awaiting pickup" list** with parent contact is needed for the Monday after: a stuffy in the club's custody is a real-world problem.
25. **Google Group sync, OAuth vs password, access-pending:** not applicable; none of these surfaces touch members or groups.

## Adversarial pass

| Area | Finding | Status |
|---|---|---|
| Redirects | Worker entry returns to the session's own worker URL; if a "return to" parameter is added it goes through `safeCallbackPath()`. A scanned QR is data, never a navigation target. | Gap: state in the design |
| Cross-session | Cookie bound to one session; every stuffy, photo and sticker id is checked against the cookie's session (IDOR). | Gap: must be tested |
| State shortcuts | Posting a later transition directly (picked up from tagged), a stale `expectedState`, a worker cookie on an admin route, a worker cookie after rotation or close. | Gap: server-pinned writes + 409 |
| Reset on a real session | Practice reset endpoint must check `kind = practice` server-side, not hide a button. | Gap |
| Enumeration | Wrong / expired / revoked / locked / unknown-session answers identical; unknown vs expired family token identical; "bound elsewhere" = "unbound"; session slug guessable, so the worker page for an unknown slug is indistinguishable from a wrong code. | Gap |
| Token pages | Referer, history and screenshots leak bearer URLs: `Referrer-Policy: no-referrer`, `noindex`, no third-party scripts, not in `robots.ts` or the sitemap (DECISION-118). Tokens 128-bit random, never derived from the sticker or a counter. Collage URL carries its own token, **not** the session slug. | Gap |
| Brute force | Code, family token and collage token endpoints rate limited; the code is the weak one (typed, shared). | Gap: no infra exists |
| Input bounds | Sticker text, names, care notes (escaped, length-capped), emoji/RTL/200-char names, CSV size and row cap, 5 MB-class files, photo dimensions and magic bytes, empty submissions, validated server-side. Care notes and names are drawn as pixels on frames and escaped everywhere else; no raw HTML passthrough. | Gap |
| CSV out | Any CSV the app emits neutralises formula-leading characters. | Gap |
| Self-targeting | A worker cannot read, change or learn the code; cannot raise their own access; an admin with the key using worker screens is recorded as "admin". Nobody here handles money, so the self-action rule does not arise. | Confirmed |
| Photo URLs | Public image route serves only published, unhidden photos of the right kind; check-in photos and superseded retakes have a separate worker/admin route. Streamed, 404 on every failure. | Gap |
| Denial of service | Uncapped group photos and uploads (item 10). | Gap |
| Third-party QR | A hostile QR shown to a worker decodes to text we store and display; escaped, never opened. | Covered by the rule above |

## Out of Scope (confirm with user)

- Email or SMS to families (ready notice, family-page link, receipts). Year-one delivery is the pickup QR.
- A purchasable or PDF book, print-on-request, the multi-scene book (decided out).
- A print API integration (decided out); the train-ticket receipt at check-in (decided: outside the app).
- Taking registrations at the door or keying in walk-ups (Q11). **Recommend one small exception:** an admin-only "add registrant" form for complimentary tickets and late additions, flagged `manual`, no contact details required. It also saves building a CSV for ad-hoc dry-run rows. Default: include if Phase 3 sizes it under about half a day.
- Overnight storage, IHOP logistics, who uploads to the photo service (not software).
- Live photo updates during Saturday (decided: one batch that evening).
- Per-stuffy social sharing, online pickup scheduling.
- Worker-side identity (names, logins): decided against; the device id is the only trace.
- A typed parent-name comparison engine at pickup.

## Open Questions

**Facts about the real situation**
1. **BLOCKING FACT (first section):** the Zeffy export shape. Not defaulted.
2. **Storage headroom:** the Verify-First block above. If it has not arrived, Phase 3 designs both branches (cap at about 1 MB and one derivative).
3. **Does the event chair hold `admin` or `board_member` today?** Decides whether a role grant is needed so the chair can run the admin side. Not feature-deciding; ask the user, do not query by identity.
4. **Q14b when the stickers arrive:** are they unique, and what do they encode (serial, random string, vendor URL)? Phase 5 and the dry run check it. If they encode a vendor URL, native camera scanning is a trap (see matrix).
5. **Which photo service will print the frames**, and its upload rules (file name, size, orientation, batch limit). Learned in the dry run; the zip generator takes these as session settings rather than constants.

**Preferences (recommended default, proceeding)**

| # | Question | Default |
|---|---|---|
| P1 | Worker code form | Generated, 8+ unambiguous characters, re-readable by admin, never in a URL |
| P2 | Cookie lifetime | About 72 hours absolute |
| P3 | Check-in without a photo | Allowed, flagged |
| P4 | Photo at check-in / portrait | One current photo each; retake replaces, old kept hidden |
| P5 | Frame orientation / size | 1200x1800 portrait, 4x6; stuffy-name caption |
| P6 | Collage URL | Own unguessable token, noindex, not in the sitemap |
| P7 | Public captions on collage | None |
| P8 | Note to Santa shown to workers | Yes, at the portrait step only (so Santa can read it) |
| P9 | Refund after tagging | Flag, never refuse |
| P10 | Retention | 30 days personal data and check-in photos; portraits/collage through the following January |
| P11 | Admin-only manual add of a registrant | Include if small |
| P12 | Family-page delivery | Pickup-screen QR only; no frame token, no email |
| P13 | Worker "undo last step" | Admin-only revert in year one |

## Handoff notes

**For the architect (Phase 2)**
- `package.json` lists **none** of: a QR decoder (iOS Safari has no `BarcodeDetector`; a JS decoder is needed, or a still-photo decode path), a QR encoder (frames), a zip/streaming-archive writer, an image compositor (`sharp` is not a direct dependency), a CSV parser. Each is a dependency decision. Check CSP (`img-src blob:`, `media-src`, the existing `'wasm-unsafe-eval'`).
- Directory: a sibling photo storage next to `club-file-storage/` (never reusing receipts or club files, DECISION-094), a worker-auth helper used by every worker route, a rate-limit helper (new primitive; DB-backed).
- Worker routes sit outside `/admin` and `/members`; the proxy must not bounce them; add the source-scan test.
- Hold the public repo rule: fixtures synthetic, art assets non-personal, no photos.

**For tech-lead (Phase 3)**
- Open with a "Rulings that differ from Phase 1/2" section. Slice so a **dry-runnable core ships first** (sessions, import, worker code, tagging, check-in, portrait, pickup), then frames and zip, then collage, then family page. Calendar: registration opens Nov 8, tagging needs the import by about Dec 1, the dry run is the week of Dec 7, Dec 18 is hard.
- Name which unit tests are mandatory: state machine with idempotent retries and stale `expectedState`; collision matrix; one-current-portrait unique index; import re-run (same file twice = no change, second export adds); CSV formula neutralisation; worker-route gate scan; public photo route serves only published unhidden portraits/groups; practice-only reset.
- Proposed text for you to file: **DECISION-120** (worker code is a session-scoped bearer credential with the blast radius in the table above; rotation vs revocation; no person recorded; admin key bypass), **DECISION-121** (retention schedule, photo kinds and visibility, opt-in sharing, practice/real asymmetry). If unused, release the IDs.
- B-168 text to replace: "Family-page delivery by email (durable-claim path; DECISION-102/103); the family page itself shipped with B-167."

**For the sibling Phase 1 (increment 1), via the orchestrator (I did not edit its file)**
- The photo-sharing question must be opt-in and worded for the public collage page; answer values must be fixed for the importer.
- Drop-off window labels on the Zeffy form must be the same strings the session's windows carry.
- The page should say frames are printed at a photo service, and should not promise an email link (gap 1).
- The page's facts source is slated to move to "the public session" (gap 17).

---

## Phase 1 handoff

## Phase 1 — Functional Refinement — 2026-10-12

**Owner:** analyst
**Status:** complete

### Summary
READY WITH NOTES. The decided process is coherent and buildable; the real risks are the worker code as a shared bearer credential over ~100 families' contact data, weak-signal idempotency, the public collage's "stuffies only" promise, retention with no cron, and an unknown Zeffy export shape. B-168 is absorbed only as a read-only family page; email delivery stays out.

### What I did
- Read the work-log header, the spec (§4 to 12), B-167/B-168, the club-file storage precedent, DECISION-039/094/095 and `package.json`.
- Ran the five passes; produced the state machine, worker-code model, collision matrix, retention table, dry-run asymmetry table, and an adversarial table.
- Wrote a Verify-First block for storage headroom and a design-for-both table for the Zeffy export.
- Rulings on B-168 absorption and the cut line.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md`; Per-Phase Status row updated.
- Proposed DECISION-120 and DECISION-121 text (above); no file in `docs/decisions.md` or `docs/backlog.md` edited.

### Open questions / handoff notes
- BLOCKING FACT (Zeffy export header row) to the user in one line; storage query to the orchestrator; chair role question to the user; sibling-increment items listed above.

---

## Production facts (orchestrator, 2026-10-12)

Read-only via `PROD_DATABASE_URL` (sizes and counts only):

| Query | Result |
|-------|--------|
| `pg_database_size(current_database())` | **22 MB** |
| per-table blob bytes | not run (the blob column is not named `data`; the database total above is the headroom figure that matters) |

The whole production database is 22 MB today, so the photo store would dominate it by an order of magnitude. **The plan limit is unknown to the orchestrator** (the Neon MCP in this session is connected to a different account and does not list the Lions project). Neon's free tier has historically capped storage at 0.5 GB per project and the paid tiers at 10 GB or more. Until the user confirms the plan, **Phase 3 designs the constrained branch**: client-side downscale to about 2400 px long edge / about 1 MB before upload, one stored derivative, frames rendered on demand and not cached, a per-session byte quota surfaced on the admin page, and the retention purge. That design is correct on either plan; the generous plan only relaxes the quota.

**Update (user, 2026-10-12, same session):** production is on **Neon's free plan** (0.5 GB), so photos cannot live in Postgres. The club has **Google Workspace for westervillelions.org with Google Drive**, and the user directed that photos be stored there. Forwarded to the architect mid-Phase 2 with the questions to rule on (reuse of the `google-groups.ts` OAuth client with a Drive scope and a separate refresh token vs a service account; an org-owned shared drive; private files served only through one app route; DB keeps ids and metadata, never bytes; upload path under Vercel's 4.5 MB cap; zip export; failure modes; purge; a storage interface with an in-memory fake for tests).

---

## Research: Zeffy API and webhooks (orchestrator, 2026-10-12)

**"No Zeffy API" is no longer true.** Verified against the live OpenAPI 3.1 document at `https://api.zeffy.com/api/docs` (Scalar page; the spec is embedded in the page script) and Zeffy's help article "Get Started With the Zeffy API":

- **Auth:** bearer API key, generated at Settings → Integrations in the Zeffy dashboard. Free, no add-on tier.
- **Read:** `GET /api/v1/payments` (paginated; filters by campaign, date, status, type), `GET /api/v1/payments/{id}`, contacts, `GET /api/v1/campaigns` (returns ticket **rate ids and titles**), users.
- **Write:** `POST /api/v1/payments` records an **offline** (cash/cheque) payment only. **There is no hosted-checkout or payment-link creation**, so a registration form hosted on our side with Zeffy as a pure payment step is not possible; the Zeffy ticket form stays the checkout.
- **Webhooks:** `payment.completed`, `payment.created`, `payment.updated` (refunds, buyer edits, status changes), `payment.deleted`, `contact.created|updated|deleted`. Header `Zeffy-Signature: t=<unix>,v1=<hex>`; `v1 = HMAC-SHA256(secret, "{t}.{rawBody}")`; secret `whsec_…` from Settings → Integrations → Webhook; verify on the raw body with a constant-time compare and a 5-minute tolerance; retries reuse the event `id`.
- **Payment object** (same shape in webhook `data` and GET): `id`, `created`, `amount` (cents), `status`, `type` online|manual|imported, `refund_status` none|partial|full, `refunds[]`, `buyer {email, first_name, last_name, address}`, `contact`, `campaign_id`, `campaign_category`, `occurrence_id`, `buyer_questions[] {question, type, answer}`, `items[] {id, type donation|ticket|additional_donation, amount, rate_id, rate_title, contact_id, questions[]}` with **per-ticket answers on each item**, `receipt_url`, `metadata` (reserved).

Consequence: one order with three stuffies arrives as one Payment with three ticket Items, each carrying its own per-ticket answers; the parent fields are `buyer_questions`. The CSV import can become the fallback and the webhook the primary path. Forwarded to the architect mid-Phase 2 for a ruling. CLAUDE.md ("anything that needs a Zeffy API (there is none)", Integrations → Zeffy) and the spec §10 are stale on this point; tech-lead to update when filing. This also unlocks B-120 (donation import) and a live White Cane total later.

---

## User answers to the Phase 2 questions (orchestrator, 2026-10-12)

| Question | Answer |
|----------|--------|
| Google Cloud project allows service-account keys, and a service account can join a shared drive | **Yes** (the Phase 4 day-0 Drive spike still verifies it live) |
| Workspace storage pool | Google for Nonprofits; **plenty** — no quota concern; keep the per-session byte display as information only |
| Zeffy organization owner (API key and webhook secret are owner-only) | **Yes**, the user is the owner |
| A hidden photo may remain visible up to 5 minutes in a browser that already loaded the collage | **Accepted** |

## Phase 1 addendum (2026-10-12): webhook ingestion and Drive photo store

**Owner:** analyst · **Reads:** "Production facts", "Research: Zeffy API and webhooks", architect Rulings 4, 5, 7, 8 and the Phase 2 Verdict precondition.
**What this supersedes in Phase 1:** Flow 2 (CSV import), the BLOCKING FACT (replaced by the S2 spike result, below), the Verify-First storage block (answered: 22 MB used, Neon free plan, photos to Drive), the importer rules, and the "keying in walk-ups" out-of-scope line (manual add is now **required**). Everything else stands: state machine, worker flows, collision matrix, collage, family page. Where a flow below disagrees with an earlier line, this addendum wins.

### Verbs that change

| Surface | Verb | Cadence |
|---|---|---|
| Admin | **Connect Zeffy form**: pick the campaign, mark which rates are the stuffy ticket, assign each seen question text to a field (several strings may map to one field) | once per session; practice has its own form and campaign |
| Admin | **Sync from Zeffy** (resumable, progress), **Reprocess** an event or payment | on demand; mandatory Friday morning |
| Admin | **Add registrant** by hand (required fallback; phone-usable) | rare |
| Admin | Resolve **needs attention** and **refund** flags | as they appear |
| Admin | **Test storage**, **Check storage** (orphans and missing files) | at activation, on demand |
| Admin | **Export frames** in the browser | once after photo day, again if portraits change |
| Worker | Pull to refresh the list (also refreshes on focus and about every 30 s) | continuous |
| (removed) | Import a CSV | — |

### Flow A — Registration arrival (webhook → order → stuffies)

**Setup order is a go-live gate:** create the Zeffy form → Connect it and map questions → test purchase on the practice form → only then does increment 1's page go live (Nov 8). The checklist lives on the session page: "Form connected, N rates marked, all questions mapped, last Zeffy event received, webhook secret set."

**Happy path:** family pays → Zeffy signs and posts `payment.completed` → verified, logged, one order and one stuffy per ticket item → **the stuffy is on the worker's list the next time it refreshes (seconds, no admin action)**, state `registered`, with window, description, snack choice. Worker header shows "Updated 12 s ago" so a missing family can be judged against freshness.

| Situation | What happens | Who sees what |
|---|---|---|
| Payment arrives **before** the campaign is mapped to a session | Logged as `ignored_unmapped`: ids, type, time, **no payload, no buyer data** (Ruling 7). Nothing is stored, so nothing can be "replayed". Recovery is **Sync from Zeffy** after mapping. | Admin: "Connected. N earlier payments exist in Zeffy. Sync to bring them in." The Connect step offers Sync immediately. Workers see nothing. |
| A question's text **does not match** the map (form reworded or reordered) | Stuffy created, flagged **needs attention**, raw text kept (length-capped, escaped), never dropped. A required field with no mapping is the same. | Admin: badge "N need attention" with the unmapped strings; assign, then Reprocess. Worker: the row shows "Details being checked" but **stays taggable and checkable** (the name and window are usually there). A missing stuffy name shows "Unnamed stuffy, order of N". |
| Photo-sharing answer absent, unchecked or unrecognised | **No** (opt-in). Never flagged. | — |
| Drop-off window text matches no session window | "Unmapped window" warning, stuffy still created. | Admin warning; worker sees "Window: ask the chair". |
| Buyer edits their order after paying | `payment.updated` is id-only, so the handler **fetches** and re-applies import-owned fields; state, sticker and photos untouched. | Admin history shows "updated by Zeffy". |
| Order of 40 tickets | 40 stuffies (no cap, decided). | Admin sees order size on the order card. |
| **Another campaign** (White Cane, donations) | Same endpoint, organization-wide: `ignored_unmapped`, 200, nothing stored. Items of type donation never become stuffies even inside a mapped campaign. | Admin event log row, no personal data. |
| Admin maps the **wrong** campaign (e.g. White Cane) to a session | Mapping shows campaign title beside the session; saving needs a ConfirmDialog; one campaign maps to at most one session (unique). A stuffy needs a rate the admin marked, so a wrong mapping creates nothing. | Admin sees an empty list and a checklist item "No stuffy rate marked". |
| **Zeffy outage** during registration | Families cannot pay (Zeffy's page, not ours). Deliveries retry for 3 days with the same event id; nothing is lost on our side. | Admin: "Last Zeffy event: N hours ago" turns amber if sales were recent. Run Sync after the outage. |
| Zeffy API down at the door (family shows a receipt, payment not on the list) | Worker cannot fix it. The **chair adds the registrant manually** on a phone, flagged `manual`, reason required ("receipt shown", "comp", "walk-up recorded offline"). | Worker: "Not on the list. Ask the chair." (no search-miss dead end; the chair's add appears at the next refresh). |
| Webhook secret rotated, or the endpoint 400s | Zeffy retries for 3 days; Sync closes any gap. | Admin: red "No valid Zeffy event since <time>" banner; runbook line "update the secret, then Sync". |
| Transient database or Zeffy-fetch failure | 500 so Zeffy retries; event row already stored. | Admin log: `failed`, with Reprocess. |

**Manual add:** fields are parent name, stuffy name, description, window, snack (required, because the check-in screen shows it), optional care note and note to Santa; contact optional. Stored as a stuffy with no Zeffy ids. If the same family later appears via Zeffy, the admin archives the manual row (never deletes; history kept). Phase 3 decides whether to offer "link to payment".

**Reconciliation pull:** "Sync from Zeffy" pages through the mapped campaign only, throttled under Zeffy's 100/minute (shared with webhook fetches), time-boxed and resumable. Progress bar and counts; "Zeffy is limiting requests, continuing…" is a normal message, not an error. Result: *new from Zeffy N, changed N, in Zeffy but missing here N (missed webhooks), here but gone in Zeffy N (flagged), refund state differs N.* Safe to press mid-event; idempotent. **Friday-morning Sync is on the checklist** because a dead webhook is silent. Dev and preview never receive real events; the practice campaign and the signed fixture script stand in.

### Flow B — Refunds (flag, never delete, never block a hand-over)

`payment.updated` and `payment.deleted` carry only an id, so the handler fetches; **a refund is a notification, and our state follows the fetched snapshot**, never the notification. A stale retry cannot un-refund (snapshot-age guard).

| Zeffy says | Stored as | Admin sees | Worker sees |
|---|---|---|---|
| Full refund | every stuffy of the order `refunded` | order card with amount | grey badge "Refunded" on the row |
| Partial refund | order flagged "partial refund, admin to resolve"; **no stuffy flagged** (the API does not say which ticket) | refunded amount against ticket price, with Keep / Withdraw choices | nothing until the admin marks a stuffy |
| Payment deleted / 404 | "payment removed in Zeffy" flag | flag | as full refund |
| Refund reversed | flag clears automatically, history row | history | badge gone |

- **Tagging:** a refunded stuffy sorts to the bottom behind the badge; tapping Tag shows a ConfirmDialog "Refunded. Ask the event chair before tagging. Tag anyway?" (Supersedes the Phase 1 state-table precondition "not refunded"; consistent with P9: warn, do not refuse.)
- **Check-in:** a banner "Refunded. Ask the event chair" with Continue; Continue is recorded in the history.
- **Pickup:** banner only; hand-over is **always** allowed.
- **Admin resolutions:** *Keep* (clears the flag, e.g. a goodwill partial refund), or *Withdraw* (removes from worker lists; allowed only while the state is `registered` or `tagged`). A stuffy already in the club's custody can only be flagged, never withdrawn. A refund arriving after pickup is a flag only.
- Workers never see amounts, reasons or Zeffy wording.

### Flow C — Frame export in the admin's browser

Entry: session page, **Export frames** (desktop browser; a phone gets "Use a laptop for this step"). The page first shows the manifest: *"138 with a portrait, 6 without (listed), last export Sat 9:40 PM, 3 portraits taken since."* (Recommended Phase 3 addition, about ten lines: stamp the export time and compare to each portrait's `created_at`, because Ruling 8 drops staleness tracking and a retake after upload would otherwise print the old picture.)

- **Progress:** "Frame 57 of 138 · Part 1 of 2", elapsed time, Pause and Cancel. Parts of about 100 download as each finishes, so memory stays bounded (a 200-stuffy run on a laptop is **unmeasured**; the dry run times 10 real frames and a synthetic 200 and Phase 5 records both). The browser may ask "allow multiple downloads"; the page says so.
- **Partial failure:** each portrait fetch retries with backoff; failures are collected, not fatal. The summary reads "132 of 138 done. 6 failed: [names]. Retry failed." A part is never presented as complete when frames are missing; the **index CSV has a `produced` column**. Closing the tab or a sleeping laptop loses at most the current part; running Export again resumes from scratch cheaply because nothing is stored.
- **Drive down during export:** fails fast with "Photo storage isn't answering. Nothing was downloaded."
- **File numbering** `ssw-<session>-<NNN>.jpg` must be stable across re-export (a retake keeps its number): Phase 3 persists the number at first export or derives it from a fixed ordering that late additions cannot shift.
- Hidden or opted-out stuffies still get frames (the frame is the family's own); check-in photos never enter the zip.

### Flow D — Photo store failures as the worker experiences them

The worker never sees the word Drive. DB-only actions (list, search, tagging, mark picked up) **keep working** through any storage failure.

| Failure | Check-in / portrait / group | Portrait station and checkpoint views |
|---|---|---|
| Drive slow | Per-photo progress; **the next scan is allowed while one uploads** (queue of 2), so a slow store does not stall the line | — |
| Drive 5xx, timeout, 429 | "Saving… will retry"; photo held in the phone outbox; header "3 photos waiting"; state does not advance until the server answers | Check-in photo thumbnail shows "photo unavailable"; name and description still shown; the portrait can proceed |
| Token invalid, key disabled, misconfigured | "Photos can't be saved right now. They're kept on this phone. Tell the chair." **Check in without a photo** stays (flagged). There is no photo-less portrait. | same |
| Quota or storage full | same sentence; the admin banner names the cause | same |
| Config missing in production | hard 503, never a silent local fallback | same |

- During a prolonged Saturday outage the portrait line can keep shooting; stuffies show "portrait waiting to send" and the state advances when the outbox drains. **Risk to name for the chair:** unsent photos exist only on a volunteer's phone ("keep this page open, do not clear browser data"). Pickup of a stuffy whose portrait never arrived follows the no-portrait warning rule.
- **Admin** sees a red storage banner, **Test storage** (write, read, delete) at activation and on demand, and **Check storage** (orphans and missing files). No email alert exists in this feature, so the banner is the alert; Phase 3 should show it on the session list, not only inside the session.
- The collage and family page show a placeholder tile for an image the store cannot return; text and consent logic come from the database.
- The dry run must **deliberately break storage** (invalid folder id on a preview) and watch the outbox drain, and test Test storage.

### Updated gaps and adversarial table (webhook and Drive)

| Area | Finding | Status |
|---|---|---|
| Forged delivery | Wrong or missing signature, stale or future timestamp (5 min), oversized body (about 256 KB): 400, no database write, no body logged. | Covered by Ruling 7; test matrix mandatory |
| Replayed delivery | Same event id is a no-op; a validly signed capture replayed inside five minutes hits the same dedupe. Payment-level advisory lock serialises concurrent deliveries. | Covered |
| Out-of-order events | `completed` arriving after a refund `updated`, or a retry days later: apply the fetched snapshot, refuse one older than stored. `deleted` for an unseen payment stores nothing. | Covered; stale-snapshot test mandatory |
| Org-wide webhook | White Cane and every other campaign hit the endpoint. Unmapped stores no payload. A dev server holding a production key reads only allowlisted campaigns. | Covered |
| Hostile or odd buyer text | HTML, 5,000-character care note, emoji, RTL in names and answers: stored as text with length caps, React-escaped, drawn with `fillText`; truncation is visible to admin. | Gap: state caps in design |
| Silent webhook death | No signal when Zeffy stops delivering. | Gap: "last event" display, Friday Sync checklist |
| Manual add abuse | Admin-only, reason required, flagged, in history. No worker path. | Covered |
| Mapping drift mid-sales | Form edited after payments exist: old and new strings both map to a field; Reprocess re-applies. | Gap: allow several strings per field |
| Secret rotation | Old secret dies instantly, 400s until env updated. | Runbook item |
| Drive file ids and links | Never in a response; no `permissions.create`, `webViewLink` or `webContentLink` anywhere (scan-tested). Shared-drive members can open every file, so membership is the integration identity plus one or two admins. | Covered by Ruling 4 |
| Duplicate upload on retry | A request that reached Drive but lost its reply would create a second file on retry. Look up by `appProperties.photo_id` before creating. | Gap: Phase 3 detail |
| Service-account key | A credential in an env var; never logged, never in an error body. | Covered; log scan |
| Orphans | Crash between Drive write and DB row, or a file deleted in Drive by a Workspace admin: Check storage lists both ways; public routes 404 into placeholders. | Covered |
| Idle credential in year two | Service account preferred because OAuth refresh tokens idle out. | Covered by Ruling 4 |
| Camera path | Camera policy exception scoped to the crew path only; admin export page needs none. | Covered by Ruling 5 |

### Notes for Phase 3 (from this addendum)

1. Specify the **Connect Zeffy form** screen and the session checklist as the go-live gate; Sync is offered on connect.
2. Worker list freshness: refresh on focus and every ~30 s with "Updated N s ago"; needs-attention rows remain taggable.
3. Reconcile the state table: refunded is a **warning, not a precondition** at tagging.
4. Manual add: required, phone-usable, `manual` flag and reason.
5. Per-session map allows several strings per field; the map is what Reprocess re-applies.
6. Export: persisted frame numbers, `produced` column in the index, "portraits since last export" indicator, laptop-only, parts of ~100, retry-failed.
7. Upload queue of 2, outbox in IndexedDB, storage banner on the session list, deliberate storage-failure drill in the dry run.
8. Mandatory tests from the architect stand; add: refund full / partial / reversed / deleted flag matrix; unmapped-campaign stores nothing; retry upload finds the existing Drive file; hand-over never blocked by refund, missing portrait or storage failure.
9. The old BLOCKING FACT now resolves into the architect's **S2 spike** (real two-ticket order, partial refund, exact question strings, `Item.id` stability, whether `$0` fires `completed`). If S2 shows no per-ticket answers or no API key can be issued, the contingent CSV adapter builds into the same snapshot shape.

**Verdict: READY WITH NOTES.** Flows A to D are specified enough to freeze Flow 2's replacement. The notes above are Phase 3 inputs. User questions still open (from the architect's handoff, not new): who owns the Zeffy account (API keys are owner-only), whether a service-account key can be created, and the Workspace storage pool size.

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-10-12 · Reviewed together with increment 1 (`2026-10-12-santas-workshop-signup-page.md`). Inputs read: both work-logs, the spec, DECISION-094/095/118/119, the prototype, White Cane, `src/lib/club-file-storage/`, the club-file download route, `src/proxy.ts`, `next.config.ts`, `package.json`, `src/lib/google-groups.ts`, `src/lib/heic-decode.ts`, `src/lib/image-resize.ts`, `src/lib/csv-safe.ts`, the Next 16 `headers` doc, and the Zeffy OpenAPI extract the coordinator saved (`zeffy-openapi.json`).

**Two coordinator messages arrived during this review and are ruled below; they supersede parts of Phase 1 and of the brief:**
1. Production is on Neon's free plan (0.5 GB), and the user wants photos in the club's Google Workspace Drive. **Postgres photo storage (brief item 4, spec §7, Phase 1 retention table and storage branch) is superseded by Ruling 4 below.**
2. Zeffy has a public REST API and signed webhooks. **The CSV import (Phase 1 Flow 2, its BLOCKING FACT, and the importer rules) is superseded by Ruling 7 below.**

## Verdict

**Approved with suggestions.** One precondition: before Phase 3 freezes Flow 2, the analyst adds a short Phase 1 addendum (about a page) for the user-visible flows that replaced the CSV importer and Postgres photos: connect a Zeffy form and map its questions, "Sync from Zeffy", webhook-failure and replay states, refund and "needs attention" flags, and the Drive-unavailable worker and admin microcopy. No re-answer of the feature shape is needed; the state machine, worker flows, collage and family page stand. Everything else below is a Phase 3 input or a Phase 4 day-0 spike.

Day-0 spikes in Phase 4 (everything marked *believed, unmeasured* in this section is checked here, before any code depends on it):
- **S1 Drive:** can the club's Google Cloud project create a service-account key; can the service account be a member of the shared drive (the Workspace "share outside the organization" setting may block it); which shared-drive role permits a permanent `files.delete`; whether creating into a hand-made folder works under the chosen scope; one 1 MB upload and download latency; cold-start cost of importing `googleapis` in a route.
- **S2 Zeffy:** one real test purchase (two tickets, one order, then one partial refund) captured as a redacted fixture: exact question strings and types, whether an unchecked checkbox appears as `false` or is absent, whether `Item.id` is stable across updates, whether `GET /payments` list items include `items[]` and `questions[]`, `status` values, whether `payment.completed` fires for a $0 ticket, what a partial refund does to `items[]`, delivery latency, and whether more than one webhook URL can be set.
- **S3 Browser:** the camera header exception applies on the crew path (Ruling 5); native `BarcodeDetector` availability and jsQR decode rate on the **real** stickers on iPhone and Android; `getUserMedia` inside the page on iOS Safari.

## Ruling 1 — facts seam between increments

See increment 1's Phase 2, Ruling 1: **the public page reads `WORKSHOP_2026` through an async loader now; no table in increment 1.** For this increment: the session row carries its own copies of dates and windows, pre-filled from `WORKSHOP_2026` by the "New session" form (one authoring path). Flipping the public page to the session row is optional in year one and is not recommended; conditions are in increment 1's section. Increment 2 also gains `zeffy_campaign_id` on the session (Ruling 7), so the admin screen can show a "Zeffy form vs our facts" consistency check (campaign start/end and occurrences from `GET /campaigns/{id}`).

## Ruling 2 — directory placement

```
src/app/santas-workshop/
  layout.tsx, page.tsx                       increment 1 (public, static)
  c/[token]/page.tsx                         public collage. Server Component. Dynamic (reads the database). noindex, referrer no-referrer
  f/[token]/page.tsx                         family page. Server Component with a print stylesheet. Same headers as the collage
  crew/[slug]/layout.tsx, page.tsx, ...      worker surface. Server page does the gate and renders either <CodeEntry/> or <CrewApp/> (both client)
src/app/(dashboard)/admin/santas-workshop/page.tsx, [sessionId]/page.tsx
                                             admin. Each page calls auth() + hasFeature(SANTAS_WORKSHOP_MANAGE). ADMIN_NAVIGATION entry so DECISION-082 derives proxy protection
src/app/api/admin/santas-workshop/...        admin handlers (sessions, Zeffy connect/map/sync, photo hide/publish, frame manifest, purge, storage check). Each: auth() + hasFeature()
src/app/api/santas-workshop/crew/[slug]/...  worker handlers. Each calls requireCrew() first
src/app/api/santas-workshop/photos/[id]/route.ts          the one public/crew/admin image door (thin)
src/app/api/santas-workshop/family/[token]/portrait/route.ts   family image door (thin; calls the same access module)
src/app/api/zeffy/webhook/route.ts           public, authenticated by signature
src/lib/zeffy/                               reusable (Ruling 7)
src/lib/santas-workshop/                     folder: facts, state, public-facts, session queries, stuffy state machine (pure + *-queries.ts), crew-auth, throttle, photo-store/, photo-access, retention, tokens, frame-layout (pure)
src/lib/eastern-date.ts                      shared helper (increment 1)
src/components/santas-workshop/              public components;  .../crew/  worker UI;  src/components/admin/santas-workshop/  admin compositions (precedent: components/admin/ledger/)
```

**Why the worker surface is not under `/(dashboard)` or `/members`:** both require a login (the proxy bounces `/admin` and `/members` to `/signin` or `/access-pending`). Crew are neither members nor admins and hold only a code. `/santas-workshop/crew/**` and `/api/santas-workshop/**` are outside the proxy's protected area (`isProtectedArea` is only `/admin`, `/members`; `/api/` is skipped), so **`src/proxy.ts` needs no change** and treats the crew surface as public. The page and every handler authenticate themselves. Enforcement is by source-scan tests, following `admin-page-feature-gates.test.ts`: (a) every `route.ts` under `src/app/api/santas-workshop/crew/` imports and calls `requireCrew`, (b) every `route.ts` under `src/app/api/admin/santas-workshop/` calls `auth()` and `hasFeature`, (c) every route that reads photo bytes goes through `photo-access.ts` (Ruling 5).

**Server vs Client.** Server Components: public page, collage, family page, admin page shells and their data, crew `page.tsx` (gate only). `'use client'` is required for: code entry form; the whole crew app (camera and QR scanning via `getUserMedia`, canvas photo downscale, IndexedDB outbox, search and list state, ConfirmDialog flows); the admin frame export (canvas composite, QR encode, zip); admin forms with local state. Heavy libraries (jsQR, qrcode, fflate) load by dynamic `import()` only on the screens that use them, so the public bundle is unchanged.

**Table names.** Use a short prefix (`sw_sessions`, `sw_orders`, `sw_stuffies`, `sw_stuffy_events`, `sw_photos`, `sw_crew_attempts`) plus generic `zeffy_events`. Drizzle derives foreign-key names from table and column names; long names exceed Postgres's 63-character limit and cause permanent `drizzle-kit push --force` drift (DECISION-117 item 8). Add a schema test like `ledger-approval-schema.test.ts`. Migration numbers are tentative: the latest on disk is `0112`; database-admin re-derives the real next-free number at Phase 4 start (`ls drizzle/migrations/*.sql | sort | tail -3`).

## Ruling 3 — dependencies

| Need | Decision | Package | Why |
|---|---|---|---|
| QR decoder (scan the chair's generic stickers) | **Yes, as a fallback** | `jsqr` (MIT, zero dependencies, pure JS, no WASM, no worker file, no CSP change) | Native `BarcodeDetector` first, when feature-detected with `qr_code` in `getSupportedFormats()`. iOS Safari lacks it (Phase 1), so jsQR runs on downscaled video frames. Loaded dynamically on the scan screen only. Hidden behind a `QrDecoder` interface. **Swap criterion:** if S3 shows a poor decode rate on the real stickers, replace the adapter with `zxing-wasm` (self-hosted `.wasm`, CSP already allows `'wasm-unsafe-eval'`). The "type the code" fallback ships regardless. Rejected now: `@zxing/browser` (heavy), `qr-scanner` (needs a worker asset and is less maintained). jsQR's age is a stability trait here; the QR format does not change. |
| QR encoder (collage QR on each frame; family-page QR on the pickup screen) | **Yes** | `qrcode` (+ `@types/qrcode` dev) (MIT) | Already the project's tool of record: it generated the White Cane poster QR that is in print. Use `QRCode.create()` to get the module matrix and draw integer-pixel modules on the canvas (crisp, controllable quiet zone). Admin and pickup screens only, dynamic import. |
| Zip writer (frame export) | **Yes** | `fflate` (MIT, zero dependencies, about 8 KB for `Zip` + `ZipPassThrough`) | Runs in the **admin's browser** (Ruling 8), so Vercel's response cap, function timeout and server memory do not apply. `ZipPassThrough` stores JPEGs without recompression. `archiver` and `jszip` exist only as transitive dependencies of `exceljs`; do not depend on a transitive. |
| Server-side image compositor | **No** | `sharp` | Not a direct dependency (installed only through `next`, pinned by `pnpm.overrides`; under pnpm a transitive is not importable by name, so it would have to be added). It could be added on Vercel, but compositing is moved to the browser (Ruling 8): (a) text on Vercel Lambdas has a known missing-fonts hazard, and the caption is a stuffy name that may contain emoji or non-Latin script; (b) building SVG text on the server from untrusted names is an injection vector, while `canvas.fillText` is not; (c) 200 renders in one request threaten the function timeout; (d) storing rendered frames is unnecessary. |
| Client image downscale | **No new dependency** | existing `src/lib/image-resize.ts` (pure math) and `src/lib/heic-decode.ts` (`libheif-js`, DECISION-039) | Use `createImageBitmap(file, { imageOrientation: 'from-image' })` for orientation, canvas for resize, `toBlob('image/jpeg')`. This bakes orientation and strips EXIF and GPS, which is also a privacy gain. The canvas glue exists in `receipt-file-input.tsx`; the workshop gets its own `photo-downscale.ts` (two copies is under the duplication threshold). File a backlog note to consolidate on a third caller. |
| CSV parser | **No (CSV deferred, Ruling 7)** | `papaparse` only if the contingency is triggered | Not needed while ingestion is webhook and API. If later built: `papaparse` (MIT, ~45 KB, server-only, BOM and quoted-newline safe) beats a hand parser, and `exceljs`' CSV reader coerces dates and numbers (a leading-zero mobile number would be mangled). |
| Google Drive client | **No new dependency** | existing `googleapis` ^173 | Phase 4 measures cold start of the upload route (S1). If material, swap to the official scoped `@googleapis/drive` + `google-auth-library` (Apache-2.0) inside the adapter. |
| Zeffy client / schema validation | **No** | none (no SDK, no `zod`) | `fetch` against `api.zeffy.com`; HMAC with `node:crypto`; hand-written narrowing guards for the one `Payment` shape (extra fields ignored; a missing required field marks the event `invalid`, not processed). |
| Rate limiting, cookie signing, IndexedDB | **No** | `node:crypto` HMAC; raw IndexedDB wrapper | Throttle is DB-backed (Ruling 5). |

## Ruling 4 — storage (supersedes brief item 4 and the Postgres-photos decision)

**Photo bytes live in a Google Workspace shared drive, behind a `PhotoStore` interface. The database holds metadata only. This supersedes spec §7 "bytes in Postgres" and the Postgres half of Phase 1's retention table for photos.** With Neon at 0.5 GB and a 22 MB database, a 200-stuffy session of roughly 0.4 GB (estimate: unmeasured; derived in the next table) cannot live in Postgres. The Neon free plan also counts dev-branch data against the project limit, so keeping bytes out of the database also keeps worktree branches cheap.

**Derivatives (client-made, no originals stored, ever).** One stored derivative per photo kind, plus one small thumbnail for the two kinds that can be public. Byte budget is a target, with a hard server cap:

| Kind | Long edge | Target / hard cap | Thumb | Visibility |
|---|---|---|---|---|
| check-in (condition record) | 1280 px | 300 KB / 500 KB | none | crew + admin only, never public, never in the zip |
| portrait (frame source) | 2400 px | 1 MB / 1.5 MB | 480 px, 60 KB / 100 KB | family page; collage only if consent |
| group | 1920 px | 600 KB / 1 MB | 480 px | collage after publish |

The planning figure for a 200-stuffy real session is about 60 MB check-in + 250 MB portraits (about 25% retakes) + 60 MB groups + 20 MB thumbs, roughly 0.4 GB in Drive, and **zero** in Neon. The practice session is a few tens of MB. Quota in Workspace's pooled storage is a user question; this is small against any plan. Superseded retakes keep their bytes until purge (Phase 1 P4); dropping them at retake is a one-line change if Drive space is ever tight.

**Auth to Drive.** Wrap it in one `getDriveAuth()`; configuration chooses the implementation.
- **Preferred: a service account** that is a member of the dedicated shared drive. It is least-privilege by construction (its reach is the one drive it is a member of, not "everything an officer can see"). It has no six-month idle expiry. This matters because the app is used a few weekends a year, and a Google OAuth refresh token unused for six months is invalidated (believed; the event would hit year two with a dead token). The JSON key lives in a Vercel env var; scope `drive` is acceptable because membership bounds it.
- **Fallback if S1 shows key creation is blocked or the shared drive will not accept the service account: a new OAuth refresh token** `GOOGLE_DRIVE_REFRESH_TOKEN` minted for a **dedicated Workspace user** (never an officer's personal account, never the existing token with a widened scope), scope `https://www.googleapis.com/auth/drive.file`. `drive.file` may not be able to create into a folder the app did not create (*believed, unmeasured*; S1); if so, widen to `drive` only because the dedicated account's reach is already just that shared drive. The existing `GOOGLE_GROUPS_*` token is not touched, so the Groups sync and Drive can be rotated or revoked independently.
- **Observation for the record (read from code, not tested):** `src/lib/google-groups.ts` builds an `OAuth2` client with a refresh token and assigns `.subject`, but `subject` is a service-account/domain-wide-delegation concept; on an `OAuth2Client` it is believed to be a no-op, so that sync acts as whoever consented the refresh token. CLAUDE.md's "domain-wide delegation" wording is probably inaccurate. Not this feature's problem, but the Drive design must not copy it.
- Env vars (production and local only, never the repo; proposed CLAUDE.md additions for tech-lead): `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` **or** `GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET` / `GOOGLE_DRIVE_REFRESH_TOKEN`, plus `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` (per environment: the dev `.env.local` points at a separate dev folder).

**Where files live.** A Workspace **shared drive owned by the organization** (not a personal My Drive, which would tie the archive to one officer). Membership is limited to the integration identity and one or two admins: shared-drive members can open every file, including check-in photos. Layout: `<env>/<session-slug>/` with flat files `<photoId>-full.jpg` and `<photoId>-thumb.jpg`. File names and `appProperties` carry opaque UUIDs only, never a stuffy, child or family name. The session folder id is stored on the session row and created idempotently at session creation. `appProperties.photo_id` makes orphan reconciliation possible.

**Files stay private; every read goes through the app.** No `permissions.create`, no "anyone with the link", no `webViewLink`/`webContentLink` ever sent to a browser, including for the public collage, which serves through the app. A scan test fails the build on `permissions.create`, `anyoneWithLink` or `webContentLink` anywhere in `src/`. The Drive file id never appears in a JSON response or page prop (DTO mappers omit it).

**What the database keeps** (`sw_photos`): id (uuid, equals the client's idempotency key), session id, stuffy id (null for groups), kind, `storage_kind` (default `'drive'`), `storage_key` (the Drive file id; named neutrally on purpose, see swap cost), `thumb_storage_key`, content type, byte size, thumb byte size, width, height, sha256, `taken_at` (client capture instant), `created_at`, `device_id`, `recorded_by_user_id` (admin path only), superseded flag and by-whom, hidden flag, `published_at`. **No bytes. No `bytea` column.**

**Upload path: phone → our route → Drive, in one request.** After client downscale the request is a multipart form of about 1.1 MB (full + thumb), far under Vercel's documented 4.5 MB **request** body cap (DECISION-094: the cap is enforced ahead of handler code). So the chunked protocol of DECISION-095 is **not** used. Use a route handler, **not a Server Action** (Server Actions have a 1 MB default body limit). Accept at most 2 MB total. The server validates before persisting: magic bytes (JPEG only, because the client always emits JPEG), a header-only dimension parse with a pixel cap, byte caps, non-empty. It never decodes the image, so there is no decompression-bomb exposure and no need for `sharp`. A direct phone-to-Drive resumable upload is rejected: it exposes an upload URL to the client, needs CORS, and skips the server-side validation. Set `maxDuration` explicitly on upload routes; the default is plan-dependent and unmeasured.

**Order of operations (no database lock across a Drive call).** (1) Upload to Drive (idempotent by photo id as the file name). (2) Then one short transaction: lock the stuffy row, check `expectedState`, insert the `sw_photos` row, append the state transition. A stale-state 409 deletes the just-uploaded Drive file best-effort. A crash between (1) and (2) leaves an orphan; the admin "Check storage" action lists Drive files with no row and rows missing a file, and offers cleanup. A retry with the same idempotency key finds the existing row and returns the stored result. Never hold `FOR UPDATE` across a network call to Drive or Zeffy.

**Read path: one door.** `src/lib/santas-workshop/photo-access.ts` is the **only** code that decides whether bytes leave Drive (viewer × photo kind × variant × session published × hidden × superseded × consent), and the only module that imports the store's read method (scan-tested). Thin routes resolve the credential (admin session with the key, crew cookie, family token, or none) and call it: `GET /api/santas-workshop/photos/[id]?v=thumb|full` and the family portrait route. This honors DECISION-094's "one visibility-checked route" in spirit: one decision, two thin credential adapters (a family bearer token cannot ride on the generic route without leaking in a query string). Every failure is **404, never 403**. The response streams (`Readable.toWeb` over the Drive stream), as the club-files route does. Headers: public variants `Cache-Control: private, max-age=300` (browser only, no shared cache); crew and admin `no-store`; `X-Robots-Tag: noindex`. A hide takes effect immediately for any new fetch; a browser that already has the image keeps it up to 5 minutes. That is a small relaxation of Phase 1 Gap 9's "immediately", and the chair should know.

**Frame zip: neither streamed from Drive nor built into Drive.** The zip is built in the admin's browser (Ruling 8): the browser fetches each portrait through the door as an ordinary sub-1.5 MB response, composites, and zips locally. Nothing about frames is stored in Drive or Postgres, so there is no stale-frame state to track and no frame purge.

**Failure modes and what a worker sees** (typed server error codes; none shows a stack trace):

| Failure | Server | Worker sees | Admin sees |
|---|---|---|---|
| Drive 5xx, timeout, 429 | one internal retry with backoff, then `503 storage_unavailable` (retryable) | "Saving… will retry"; photo stays in the phone's outbox; header shows "N photos waiting"; state does not advance until the server answers | storage badge on the session page |
| Token revoked or expired, key disabled, 401 `invalid_grant` | `503 storage_misconfigured` (not retryable) | "Photos can't be saved right now. Your photos are kept on this phone. Tell the chair." "Check in without a photo" stays available (flagged) so the line keeps moving | red banner on the session page; "Test storage" button |
| 403 quota (`storageQuotaExceeded`, file-limit, rate limit) | `503 storage_full` or `storage_rate_limited` | same wording as above | banner names the cause |
| Missing Drive config in production | **hard failure** (503), never a silent fallback to local or memory (the DECISION-040 / DECISION-102 lesson) | same wording as above | banner |
| Account change (employee leaves, drive membership removed) | same as revoked | same wording as above | banner |
| Drive down while a family opens the collage | image route 503 | broken tiles degrade to an `onError` placeholder; page text and consent logic still come from the database | none |

A "Test storage" check (`ping`: write, read back, delete a tiny file) runs on session activation and on demand, and the dry run must exercise it. Nothing emails an alert (no email in this feature), so the banner is the alert.

**Retention purge = Drive delete + row update, an admin action.** Permission `santas_workshop.manage`; disabled until the eligible date, which the **server** computes (not only the button); ConfirmDialog with counts. Each photo: `files.delete` (permanent, not trash), where a 404 means already gone (success), then set `purged_at` and null the keys. 700 deletes in one request would exceed any function timeout, so purge is **resumable and time-boxed** (about 30 s per request, client loops with a progress bar). Verify the shared-drive role that permits a permanent delete (S1). Registrant personal data in Neon is nulled in the same pass; Zeffy payment ids are kept as tombstones. Practice-session reset uses the same engine, gated server-side on `kind = 'practice'`. Deleted rows and files may persist in Neon's restore history and Workspace retention for a while (*believed, unmeasured*); the privacy copy says "we will take it down", not "erased everywhere".

**Quota.** `SUM(byte_size)` per session is a **soft display** on the admin page, with a default of about 600 MB real / 100 MB practice stored on the session row. It is not a Postgres constraint. One app-level guard stays in the upload route, because display alone gives a leaked worker code unlimited reach into the Workspace storage pool: reject (typed 413) over the soft quota (race-tolerant), and a per-device rate (count of that device's `sw_photos` rows in the last minute, no new table).

**Dev and test story** (mirrors `club-file-storage/`): `src/lib/santas-workshop/photo-store/` with `index.ts` (interface `put/get/delete/ping` and factory), `drive.ts`, `local.ts` (dev only, filesystem under a gitignored `.santas-workshop-store/`; add it to `.gitignore` in Phase 4 beside `.club-file-store/`), `memory.ts` (the in-memory fake). Selection: `NODE_ENV === 'test'` → memory; `NODE_ENV === 'production'` → Drive or hard failure; otherwise Drive if its env is present, else local. The same contract test suite runs against memory and local; the Drive adapter is unit-tested with an injected fake `drive` client (request shaping: `supportsAllDrives`, parents, multipart). **No test ever calls Drive.** A live Drive pass is a manual Phase 5 item on the dev folder. Photos never enter git: the pre-push check already scans binaries.

**Cost to swap back to Postgres on a paid plan.** One new adapter (about 60 lines, mirroring `club-file-storage/database.ts`) over a new `sw_photo_blobs` table (key, bytes `bytea`, content type, size; metadata and blobs separate so list queries never drag bytes), one migration, and one idempotent, resumable backfill script that streams each Drive file into the blob table and sets `storage_kind = 'db'` per row. Routes, UI, the state machine and the access module do not change, because they use `storage_key` and the interface. If the column were named `drive_file_id` the swap would also be a column rename on live data under `drizzle-kit push --force`, which is why the neutral name is a requirement, not a preference.

## Ruling 5 — invariants touched

**Worker credential model (propose DECISION-121).**
- A signed, httpOnly, `Secure`, `SameSite=Lax` cookie, `Path=/`, named per session (`__Host-swcrew-<shortSessionId>`). `Lax`, not `Strict`: the entry link arrives by text message, and `Strict` would drop the cookie on that first navigation. Payload: session id, code version, random device id, expiry (about 72 h absolute); HMAC with `node:crypto` using the existing auth secret. **The cookie is not self-sufficient: every request re-reads the session row** (status, code version, pause, close, end date) with one indexed query, so rotation, pause and close take effect on the next request. Closure is also evaluated lazily at request time (no cron exists).
- **Coexistence with NextAuth and `hasFeature()`:** a separate cookie. The crew cookie never populates `session.user`, never carries features, and no `FEATURES` check reads it. `requireCrew(request, sessionId)` returns `{ kind: 'crew', deviceId, codeVersion }`, or, when the crew cookie is absent or invalid, falls back to `auth()` and returns `{ kind: 'admin', userId }` if the user holds `santas_workshop.manage`. So **admin-key holders bypass the code**, and the bypass is checked in the shared helper, not per route. Everything else returns one identical unauthenticated answer.
- **`recorded_by`:** crew actions record `device_id` and code version, no person, no IP (as decided). Admin-path actions additionally record `recorded_by_user_id` (an existing accountable identity; recommended addition, no extra data about volunteers).
- **Throttle:** DB-backed `sw_crew_attempts` (session id + HMAC of the client IP, short TTL swept lazily). Identical response for wrong, revoked and unknown. Already-signed-in devices are never affected by a throttle, so an attacker cannot lock out the crew.
- **Camera permission.** The site-wide `Permissions-Policy: camera=()` blocks `getUserMedia`, and live scanning needs it. Add a **path-scoped** rule for `/santas-workshop/crew/:path*` that sets `camera=(self)`. Verified in the Next 16 `headers` doc: when two rules match the same path and key, **the last one wins**, so the crew rule goes **after** the global rule. Build both policy strings from one constant in `next.config.ts` so they cannot drift. The same block adds `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex` for `/santas-workshop/c/:token`, `/santas-workshop/f/:token`, the crew path and `/api/santas-workshop/:path*`. `<input type="file" capture>` needs no camera permission and stays the photo path.
- CSP check: `img-src` already allows `blob:`; `worker-src 'self' blob:`; `connect-src 'self'` suffices for same-origin uploads; no change.

**Other invariants.**
- **`FEATURES` key `santas_workshop.manage`** via `/add-permission`, bound to `admin` + `board_member` using the canonical `CROSS JOIN … NOT EXISTS` idiom (`default-role-bundles.test.ts` parses it). Not bound to `treasurer` or any member role: it exposes about 100 families' names, emails and mobiles. An event chair who is neither gets a custom role via `/admin/roles`. The bare `/admin` front door bounces holders without `admin.dashboard` (B-137), so give the chair the direct link.
- **No raw HTML.** All Zeffy-supplied text (names, care notes, notes to Santa) is untrusted: React text only; frames are drawn with `canvas.fillText`, not SVG or HTML strings. Emitted CSVs (frame index, awaiting-pickup list) go through the existing `src/lib/csv-safe.ts`.
- **Email:** nothing in this increment sends mail. The webhook, the sync, the crew actions and the family page send none. If B-168 ever adds "your photo is ready", it is a durable-claim path and must use `sendEmailForDurableClaim()` (DECISION-102/103) with the exhaustive outcome switch.
- **No personal data in the repo:** fixtures use `example.invalid`; `.santas-workshop-store/` is gitignored; the Zeffy fixture payload is synthetic and redacted; no photos in git; the Drive folder id is an env var, not a constant.
- **`ZeffyEmbed`:** not touched (increment 1 uses a plain iframe titled "Sign-up form for A Visit to Santa's Workshop, powered by Zeffy").
- **Retention as an admin action, no cron:** see Ruling 4. A reminder to run it is the orchestrator's.

## Ruling 6 — concurrency

**Do not strictly sequence; sequence by phase.**
- Increment 1 has no migration, no dependency and no schema, so it runs entirely on the main tree and ships first, early, so the QR target is verified live.
- Increment 2's **Phase 3 runs now in parallel** (read-only).
- Increment 2's **Phase 4/5 runs in an isolated worktree with its own Neon branch and `.env.local` copy.** It is worth it here, unlike a typical small feature: it adds migrations (and `pnpm dev` replays `drizzle/migrations/` on every server start, so an in-flight migration would hit increment 1's QA), adds about four packages (`package.json` and lockfile conflicts), edits `next.config.ts` (headers) in the same file increment 1 edits (redirects), and runs for weeks. The cost is small: a Neon branch, an `.env.local`, a `pnpm install`. Strict sequencing would start increment 2's Phase 4 around Nov 1 and compress Drive and Zeffy spikes, the build and a Dec 7 dry run into five weeks with no slack.
- Merge order: increment 1 lands first; increment 2 rebases onto it before its first deploy. Increment 2's first production deploy (which runs migrations) is only after increment 1 is live.
- Slice order for Phase 3: **dry-runnable core first** (sessions, Zeffy ingest, crew auth, `PhotoStore`, tagging, check-in, portrait, pickup), then collage, then frame export, then family page (the first thing to cut, per Phase 1).

## Ruling 7 — Zeffy webhook ingestion replaces the CSV importer

**Correction to the coordinator's summary, from the OpenAPI text itself:** `payment.completed` and `payment.created` deliver the **full `Payment`** in `data`. **`payment.updated` and `payment.deleted` deliver only `{ id, object }`** ("fetch the resource to read its current state"; a 404 on fetch means it was deleted). So a refund arrives as an id-only notification, and the handler must `GET /api/v1/payments/{id}`. That requires `ZEFFY_API_KEY` in production for webhooks to work at all, not only for reconciliation. There is no `updated` timestamp on a `Payment`, so two snapshots cannot be ordered by content.

**Ruling: webhook plus API fetch is the primary path; there is no CSV importer in the first build.** Reasons: a CSV parser means a second mapper into the same internal shape, kept alive for a path used rarely, which is exactly the code that rots. The fallback chain is: webhook → (missed events) "Sync from Zeffy" pull → (Zeffy API unavailable) the admin **manual add registrant** form, which is already recommended in Phase 1 and now becomes required (also the route for a walk-up recorded offline in Zeffy, which arrives as `type: manual` possibly without custom answers). **Trigger to build a CSV adapter later:** the S2 spike shows the payload lacks per-ticket answers, or the club's Zeffy account cannot issue an API key (owner-only). Design the internal snapshot so a CSV adapter would map into it (about half a day then).

**Reusable `src/lib/zeffy/` module** (also for B-120 donation import and White Cane later). It knows nothing about the workshop:
- `signature.ts` (pure; `now` injected): parse `Zeffy-Signature: t=…,v1=…` (accept repeated `v1`), 5-minute tolerance both directions, HMAC-SHA256 over `"{t}." + rawBodyBytes`, constant-time compare with a length check first. Tests: valid, tampered body, stale and future `t`, malformed header, wrong-length hex.
- `types.ts`: hand-typed subset of `Payment`, `Item`, `QuestionAnswer`, `Refund`, `Campaign`, `Rate`, plus narrowing guards.
- `client.ts` (server-only): bearer from `ZEFFY_API_KEY`, `listPayments({ campaignId })` (the campaign filter is a **required** parameter, so an org-wide pull is impossible by type), `getPayment(id)`, `listCampaigns()`, `getCampaign(id)`. Honors `Retry-After` on 429; the documented limits are 100 requests per minute and 20 per second per organization, shared with every key. Never exceeds them: sequential, throttled.
- `events-queries.ts` and the generic `zeffy_events` table (below), and `webhook-handler.ts`, which verifies, logs, dispatches to injected consumers, and returns the HTTP outcome. **Consumers are injected by the route** (`src/app/api/zeffy/webhook/route.ts` composes `[santasWorkshopConsumer]`), so the dependency points from the workshop to the module, never the other way.
- `embed-url.ts`: `toEmbedUrl()` moves here from `src/components/campaigns/zeffy-url.ts`, with its three importers updated and no shim (a lib function does not belong under `components/`). Done in this increment, not increment 1, to keep increment 1's diff small.

**The route `POST /api/zeffy/webhook`:** Node runtime, `dynamic = 'force-dynamic'`, no `auth()` (the signature is the authentication; the proxy skips `/api/`). Read the **raw bytes** (`arrayBuffer`) before any parsing, cap the body (about 256 KB), verify, then process. Bad signature or stale timestamp → 400, no database write, no body logged. Order: verify → insert `zeffy_events` row (primary key = Zeffy's event `id`, `ON CONFLICT DO NOTHING`, so a retry is a no-op) → process inline → 200. **Do not rely on work after the response** (serverless may freeze). Processing failures that are transient (database, Zeffy fetch) return 500 so Zeffy retries (12 attempts over 3 days, same event id); permanent ones (unknown campaign, unsupported `version`, `invalid` payload) return 200 and are recorded with an outcome the admin can see. A processing failure never loses the event, because the row is already stored.

**Idempotency, ordering, concurrency.** Idempotent on event id (log) and on payment id (state). Per-payment serialization with `pg_advisory_xact_lock(hashtext(paymentId))`. For `completed`/`created`, apply the embedded payload only when the payment is unseen; for every other event, and for any event on a known payment, **re-fetch and apply the fetched snapshot**, and refuse to apply a snapshot whose `fetchedAt` (our clock, taken just before the request) is older than the stored one, because a retry delivered days later must not un-refund an order. The Zeffy HTTP call happens **outside** the transaction and the lock.

**Mapping rules.**
- `campaign_id` → session via `sw_sessions.zeffy_campaign_id` (unique where not null). The webhook is **organization-wide**, so every White Cane gift and any other Zeffy payment reaches this endpoint. **Data minimization:** an unmapped campaign is logged with id, type, payment id, campaign id and time only, **no payload and no buyer data** (outcome `ignored_unmapped`), and nothing is stored from it.
- Only `status = 'succeeded'` creates registrants. `pending` waits; `failed` is ignored. `payment.created` for non-succeeded is noise: subscribe to `payment.completed`, `payment.updated` and `payment.deleted` only.
- One `Payment` → one `sw_orders` row (key: Zeffy payment id). Each `items[]` entry with `type = 'ticket'` and a rate in the session's configured ticket rate ids → one stuffy, key `(session, zeffy item id)`. Items of type `donation`/`additional_donation` never make a stuffy. A partial refund (`refund_status = 'partial'`, `refunds[]` carries amounts only, not which ticket) → **flag the order** "partial refund, admin to resolve", with the refunded amount shown against the ticket price; never auto-remove a stuffy. Full refund → flag every stuffy `refunded`; `payment.deleted` or a 404 on re-fetch → flag; an item that disappears from a later snapshot → flag `not_in_order_now`. **Never delete, never block a hand-over** (Phase 1 P9). Re-applying updates import-owned columns only (`ON CONFLICT … DO UPDATE SET <import-owned>`); worker-owned columns (state, sticker, photos) are never touched.
- **Questions: admin-mapped per session, matched by normalized question text (trim, collapse whitespace, case-fold) together with the answer `type`, never by position.** Reason: `QuestionAnswer` has no id, and form edits reorder or reword. The session stores `question_map` (field → normalized text). The admin screen, "Connect Zeffy form", does three things: lists the org's campaigns (`GET /campaigns`, metadata only, no personal data), lets the admin pick one and mark which `rates` are the stuffy ticket, and lists the distinct question strings seen for that campaign so the admin assigns them to fields (stuffy name, what it is, snack, note to Santa, care note, child first name, photo consent; buyer-level: mobile, drop-off window, acknowledgment). A required field with no mapping, or a question string not in the map, produces a stuffy flagged **needs attention** with the raw text shown to the admin; it is never dropped. Photo consent is **opt-in**: absent, `false` or unrecognized means no. The drop-off window answer joins to the session's window labels; an unmatched label imports as "unmapped window" with a warning (Phase 1 rule retained).
- **Minimization of what is stored.** Copy only what the mapper uses. Do **not** copy `buyer.address`, `receipt_url`, `payment_method`, `dispute`, or the buyer's last name beyond what the pickup check needs into workshop tables. The replay payload in `zeffy_events` is a **redacted whitelist projection**, not the raw body, and is nulled at the retention purge with the registrant data. Raw bodies are never persisted.

**`zeffy_events`** (generic): Zeffy event id (PK), type, version, payment id, campaign id, received_at, outcome (`processed | ignored_unmapped | ignored_type | invalid | unsupported_version | failed`), error code (no text from the payload), redacted `payload` (jsonb, nullable). Admin shows recent events for the session's campaign and a **Reprocess** button (reuses the stored projection or re-fetches). Reprocess and "Sync" call the same `applyPayment()` as the webhook: one code path.

**Reconciliation: "Sync from Zeffy"** (admin, `santas_workshop.manage`): `GET /payments?campaign=<id>&limit=100` paged by `starting_after` and `created[gte]`, then `getPayment` for anything unseen or changed, throttled under the rate limit, **time-boxed and resumable** (about 45 s per request, the client loops with a cursor and a progress bar). Reports: in Zeffy but not ours (missed webhooks), in ours but 404 in Zeffy (deleted), refund-state mismatches. Whether the list response includes `items[]` and `questions[]` is S2; if not, the per-payment fetch is required (300 payments is 3 minutes of the 100-per-minute budget).

**Secrets and environments.** `ZEFFY_WEBHOOK_SECRET` (`whsec_…`) and `ZEFFY_API_KEY` live in Vercel env (production only), never the repo. Zeffy allows one webhook URL for the organization, so **dev and preview never receive real events**. Because `.env.local` in this project has historically carried production credentials (the `RESEND_API_KEY` incident), apply the same deny-by-default idea: **in non-production, the Zeffy client refuses any call unless the campaign id is listed in `ZEFFY_DEV_CAMPAIGN_ALLOWLIST`** and discards payments from other campaigns unread, so a dev server holding a production key cannot pull real parents' data into a dev database. Dev/test uses a made-up `whsec_dev…` secret plus `scripts/zeffy-webhook-fixture.ts`, which signs and POSTs fixture payloads (`example.invalid`) to localhost, and the Reprocess button replays from the log. **Rotation:** Zeffy invalidates the old secret the moment a new one is generated, so there is no overlap window; deliveries fail with 400 until the env var is updated, and Zeffy retries for 3 days. The Sync pull covers any gap. Document that order in the admin runbook.

**Practice session.** Give the dry run its own Zeffy ticket form (own campaign id, mapped to the practice session) so the real webhook, mapper, refund flow and replay are exercised in production before the event. How to avoid a real charge (a $0 or 100%-discount rate) is the user's question (Phase 1 Gap 15).

**Docs that go stale (tech-lead):** CLAUDE.md (Integrations → Zeffy, and the "Zeffy 403s server-side fetches, do not scrape" note should say that applies to `www.zeffy.com`, not `api.zeffy.com`), the spec §7 ("No Zeffy API exists") and §10, Phase 1's out-of-scope bullet in the sign-up log, and B-120. Also CLAUDE.md's env list gets `ZEFFY_WEBHOOK_SECRET`, `ZEFFY_API_KEY`, `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` and the `GOOGLE_DRIVE_*` set.

## Ruling 8 — frames are composited in the admin's browser

The brief asked sharp-on-server versus canvas-on-client. **Canvas, in the browser.** The admin "Export frames" action fetches the manifest (a stuffy list with portrait ids, plus the collage URL), fetches each portrait through the photo door, draws the 1200×1800 frame on a canvas (frame art, caption as `fillText`, QR drawn from the `qrcode` matrix on a solid plate inside a safe margin), encodes JPEG, rewrites the JFIF density bytes to 300 dpi (the canvas leaves them unset; about ten lines), and zips with `fflate` in parts of about 100. Consequences: no Vercel timeout or response-cap exposure, no stored frames, no staleness tracking (always rendered from the current portrait), resumable by simply running it again, and no server-side font or injection concern. The layout math lives in a pure `frame-layout.ts` that Vitest covers; the canvas drawing is thin and is verified in the dry run by uploading a real zip to the chosen photo service. **The collage URL in the QR is built on the server** (the single `getAppUrl()` from `src/lib/email-compose.ts`) and the manifest endpoint refuses (409) to hand out URLs for a **real** session when the app URL is not the production origin, so no frame can carry `localhost`. Zero-portrait stuffies are listed, never given a placeholder frame. File names `ssw-<session>-<NNN>.jpg`, with the admin-only index CSV through `csv-safe.ts`.

## Notes for Phase 3 (rulings that differ from Phase 1)

- Flow 2 (CSV import) becomes: connect form → map questions → webhook live → Sync/Reprocess; Phase 1's import hygiene rules (all-or-nothing, header-name mapping, row caps) become the mapper's rules (text-only handling, escape on render, length caps, unmapped values flagged).
- Storage and retention tables use Drive; the 30-day personal-data purge also nulls `zeffy_events.payload`.
- Photo caching relaxes "hidden 404s immediately" to "immediately for new fetches, at most 5 minutes in an already-loaded browser".
- Mandatory tests (adds to Phase 1's list): signature verification matrix; replay of the same event id and a stale-snapshot order case; per-ticket mapping with an unmapped question; partial refund flagging; unmapped campaign stores no payload; photo-access matrix (viewer × kind × published × hidden × consent × superseded); source scans (crew gate, admin gate, single image door, no Drive sharing calls, drive id not in responses); `PhotoStore` contract suite on memory and local; session-scoped IDOR (cookie for session A against session B ids); practice-reset refused on a real session server-side; table-name length test.
- No dependency on Phase 4 day-0 spikes may be assumed in the design; each *believed* item above names the spike that settles it.

## Phase 2 handoff

### Summary
Verdict **Approved with suggestions**, with one precondition: a short Phase 1 addendum for the flows that replaced CSV import and Postgres photos. The public page reads a typed code module through an async loader. Photos go to a private Workspace shared drive behind a `PhotoStore` interface and are served only through one app door. Registrants arrive by signed Zeffy webhook with an API fetch for updates, reusable under `src/lib/zeffy/`. Frames are composited in the browser. The worker code is a session-scoped signed cookie that coexists with NextAuth and is bypassed by the admin key. Increment 2's Phase 4 runs in a worktree.

### What I did
- Read both work-logs, the spec, DECISION-094/095/118/119, the prototype, White Cane, club-file storage and its route, the proxy, `next.config.ts`, `google-groups.ts`, the HEIC and resize helpers, `csv-safe.ts`, the Next 16 `headers` doc, and the Zeffy OpenAPI extract.
- Ruled all six brief items plus the two coordinator changes (Drive; Zeffy API).

### Outputs
- This section; the Per-Phase Status row. No code, `docs/decisions.md`, `docs/backlog.md`, `CLAUDE.md` or spec edit; nothing committed.
- **Proposed DECISION-121 (worker credential and the single photo door):** session-scoped signed cookie re-verified against the session row on every request; admin-key bypass; device id, no person; DB throttle; path-scoped `camera=(self)` header; `photo-access.ts` is the only code that reads photo bytes; 404 on every failure.
- **Proposed DECISION-122 (needs a new reserved ID):** photo bytes live in an organization-owned Google shared drive behind `PhotoStore`; private files, app-served only; neutral `storage_key`/`storage_kind`; service account preferred, dedicated-user `drive.file` token as fallback; supersedes "photos in Postgres" for this feature only (DECISION-094 stands for club files).
- **Proposed DECISION-123 (new ID):** Zeffy ingestion by signed webhook plus API fetch, in a reusable `src/lib/zeffy/`; org-wide webhook means unmapped campaigns store nothing; CSV importer deferred with a named trigger; supersedes "no Zeffy API".
- **Proposed DECISION-124 (new ID):** frames are composited client-side (canvas, `qrcode`, `fflate`); `sharp` is not added.
- **Proposed backlog text (orchestrator):** consolidate the canvas downscale glue if a third caller appears; CSV adapter contingency (trigger: S2 payload lacks per-ticket answers or no API key); B-168 rename to "family-page delivery by email (durable-claim path)"; update CLAUDE.md/spec Zeffy statements; the optional "Zeffy form vs our facts" consistency check.

### Open questions / handoff notes
- **Orchestrator:** reserve DECISION-122 to DECISION-124; commit or discard the prototype working-tree edits before increment 1's Phase 4; ask the user (a) can the club's Google Cloud project create a service-account key and will the shared drive accept it, (b) the Workspace storage pool size, (c) a dedicated Workspace user seat if the OAuth fallback is needed, (d) whether the user is the Zeffy organization owner (API keys are owner-only).
- **Analyst:** the Phase 1 addendum named in the Verdict.
- **Tech-lead:** name the database-admin migration slice; keep `sw_` prefixes; decide the 72 h cookie lifetime and the throttle numbers; confirm the 5-minute cache relaxation with the chair.
- Migration numbers are placeholders; database-admin re-derives the real next-free number at Phase 4 start.

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-10-12 · **Inputs read:** this work-log in full (Phase 1, the Phase 1 addendum, orchestrator blocks, Phase 2), `docs/features/santas-workshop.md`, the sibling work-log's facts-seam ruling, `src/lib/club-file-storage/`, the club-file download route, `src/lib/google-groups.ts`, `src/lib/image-resize.ts`, `heic-decode.ts`, `csv-safe.ts`, `receipt-magic-bytes.ts`, `permissions.ts` (`FEATURES`, `ADMIN_NAVIGATION`, `getAdminProtectionRules()`), `src/proxy.ts`, `next.config.ts`, `drizzle/migrations/` (latest on disk: `0112`), `ledger-approval-decision.ts` and its hermetic test harness, `ledger-approval-schema.test.ts`, `/add-permission`, DECISION-082/094/095/102/117/118/119, and the Zeffy OpenAPI extract (envelope, `PaymentList`, `QuestionAnswer`, `Item`).

## Rulings that differ from Phase 1/2 (read first)

| # | Ruling | Differs from | Why |
|---|--------|--------------|-----|
| 1 | **`qrcode` is not a current dependency.** `package.json` and `node_modules` have no `qrcode`, `jsqr` or `fflate`; the White Cane poster QR was made with `npx --yes qrcode` (see `docs/marketing/white-cane-poster/README.md`). Phase 4 adds all three (`jsqr`, `qrcode` + `@types/qrcode`, `fflate`) with `pnpm add`; this is the architect's approved set, only the premise "already the tool of record" was wrong. | Phase 2 Ruling 3 premise | Verified by `grep` and `ls node_modules`. |
| 2 | **The worker code is stored encrypted (AES-256-GCM, key derived from `AUTH_SECRET`), not hashed.** Phase 1 requires an admin to be able to re-read it; a hash cannot be re-read. Verification is decrypt + `timingSafeEqual`. Rotating `AUTH_SECRET` makes the stored code unreadable: the admin regenerates (every cookie dies at the same moment anyway, same secret). | Brief ("worker code hash") | Re-read requirement (Phase 1, worker-code model). A plaintext column would put the live code in every Neon dev branch copy; ciphertext is undecryptable under a different `AUTH_SECRET` (dev has its own). |
| 3 | **Webhook dedupe applies to terminal outcomes only.** Ruling 7 said "`ON CONFLICT DO NOTHING`, so a retry is a no-op". Taken literally that also no-ops the retry of an event whose first processing returned 500, which is the one case retries exist for. Rule: insert-or-read the `zeffy_events` row; outcome in (`processed`, `ignored_*`, `invalid`, `unsupported_version`) returns 200 without calling the consumer; outcome `received` or `failed` re-runs the consumer. Concurrent duplicates serialise on the payment advisory lock. | Phase 2 Ruling 7 wording | Retries "reuse the event id" and "each retry is re-signed with a fresh timestamp" (OpenAPI text), so a days-late retry passes the 5-minute tolerance and must still be processed. |
| 4 | **Question match key is the normalized text only.** The answer `type` interprets the value (checkbox boolean, multi_select array) but is not part of the key. A field is looked up in its home scope first (ticket fields in `items[].questions`, buyer fields in `buyer_questions`), then the other scope as a fallback. | Ruling 7 ("text together with the answer type") | A form edit that turns a text question into a select must not orphan a mapping; the fallback survives S2 showing a question in the other scope. |
| 5 | **The stuffy's Zeffy key column is `zeffy_item_key`**, produced by one function `itemKey(payment, item, index)`: `item.id` by default, `${payment.id}#${index}` if S2 shows `Item.id` is not stable across updates. | Brief ("Zeffy item id unique") | S2 is the only way to know; a neutral column name makes the fallback a one-function change, not a column rename under `push --force`. |
| 6 | **No DB CHECK constraints and no `pgEnum`.** Text columns, a TypeScript `as const` tuple per vocabulary, pinned UPDATEs, and partial unique indexes. | Brief ("check", "state enum") | `src/lib/db/schema.ts` has zero `check(` uses; every status column in the project is text + comment. Adding the first CHECK adds a `drizzle-kit push` comparison surface that is *believed, unmeasured* to round-trip; the integrity that matters (one current portrait, one tag per session) is partial unique indexes, which the project already uses. |
| 7 | **Refund state is derived from the order, never stored per stuffy.** `refundOpen(order) = (refund_status != 'none' OR payment_deleted) AND refund_resolution_cents IS DISTINCT FROM refunded_cents`. Worker badge = `refundOpen AND (refund_status = 'full' OR payment_deleted)`. Partial refund = admin flag only. "Keep" stores the `refunded_cents` it kept, so a later bigger refund reopens the flag by itself. A reversed refund clears with no code. `withdrawn_at` on the stuffy is the only per-stuffy stored refund decision. | Addendum Flow B ("every stuffy stored `refunded`") | Same user-visible behavior; nothing to keep in sync. |
| 8 | **A hidden portrait is withheld from every non-admin surface, including the family page and the frame zip**, and listed in the frame manifest as "hidden by admin". Opted-out (no consent) portraits still appear on the family page and in frames. | Addendum Flow C ("hidden or opted-out stuffies still get frames") | A portrait hidden because a face or hand is in it must not be printed and handed over either. The admin fixes it by unhiding or by a retake (a retake is a new, unhidden photo row). |
| 9 | **Collage and family tokens are not throttled.** Tokens are 128-bit random (22 base64url characters), so enumeration is not a threat; a limiter would add a database write to every anonymous view, an amplifier. Unknown and expired tokens return one identical 404 page. The code-entry route is the only throttled surface. | Phase 1 adversarial table ("rate limited") | Cost/benefit; the residual is a forwarded link, which no limiter touches. Phase 5 check L4 records the distinguishable responses. |
| 10 | **Frame caption under the QR is the words "Scan for the day's photos" and `westervillelions.org`, not the 22-character token URL.** Frame art is a per-session key (`frame_art_key`, default `plain`, drawn in code) mapping to a PNG under `public/santas-workshop/frames/` that the chair's art replaces by deploy; there is no admin art upload this year. | Phase 1 gap 5 ("human-readable URL under it"), gap 3 ("per-session replaceable asset") | A token is not typeable, so printing it helps nobody; a deploy is a one-line change and art is not personal data. |
| 11 | **Frame numbers are persisted per stuffy and allocated alphabetically within each allocation batch** (parent last name, stuffy name, id); a late portrait gets `max + 1`. Zip order is therefore not pickup order; the **index CSV** is sorted for the pickup table. "Portraits taken since last export" compares the current portrait id with `frame_exported_photo_id`, not a clock. | Phase 1 gap 6 ("sorted in pickup order"); addendum ("export time stamp") | Stable numbers and a pickup sort cannot both be file order once a late arrival exists. Comparing ids is exact; a clock compare is not. |
| 12 | **Photos are taken with `<input type="file" capture>`; `getUserMedia` is used only for scanning.** Page state (current stuffy and view) lives in `sessionStorage` so a page reload after the camera app returns lands on the same card. A "Scan from a photo" path (still decode with `jsqr`) covers a blocked or absent live camera (for example an in-app browser). | Open between Phase 1 and 2 | Native capture gives flash, HDR and zoom in a dim lobby (Phase 1 dry-run list: low-light portrait); whether iOS Safari honors `capture` and reloads the page is *believed, unmeasured* and is S3. |
| 13 | **Non-production Drive use is opt-in.** Outside production the Drive adapter is used only when `SW_PHOTO_STORE=drive` is set; otherwise the local adapter. Production ignores the variable and hard-fails without Drive config. | Ruling 4 selection rule ("Drive if its env is present") | `.env.local` has historically carried production credentials (the `RESEND_API_KEY` incident); presence-based selection would let a stray dev run write into a real folder. |
| 14 | **The service account is one env var: `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, the key file minified to one line** (`jq -c . key.json`), pasted into Vercel's value field and, locally, single-quoted in `.env.local`. `JSON.parse` handles the escaped `\n` in `private_key`. | Brief (pick one) | One variable, no base64 layer, no `\n` replacement code. |
| 15 | **All tables ship in one front-loaded migration pair** (`0113` tables, `0114` permission; numbers re-derived at Phase 4 start). Later slices add no schema unless a spike forces it. | Phase 2 Ruling 6 slice order | Schema churn under `push --force` and migration-number races are the expensive failures; unused columns early are cheap. |
| 16 | **No admin edit of Zeffy-sourced stuffy fields.** A wrong field is fixed by the question map plus Reprocess; a manual row is corrected by Withdraw + Add again. | Silent in Phase 1 | Keeps import-owned vs worker-owned columns the only two classes (no per-field "admin edited" bookkeeping). |
| 17 | **A crew "revert" exists on practice sessions only** (server checks `kind = 'practice'`); real sessions are admin-revert with reason (Phase 1 P13). | Phase 1 state table (worker undo "a Phase 3 call") | The dry run needs to repeat flows; a real session must not give a volunteer a backward move. |
| 18 | **Question strings are learned from stored payments**, not from the campaign endpoint. Order: Connect (campaign + ticket rates) → test purchase or Sync → rows arrive `needs attention` with raw Q&A stored → admin assigns strings to fields → Reprocess (local, no Zeffy call). S2 records whether `GET /campaigns/{id}` also lists questions; if it does, the picker may pre-fill. | Addendum Flow A (silent on the chicken-and-egg) | An unmapped campaign stores nothing (Ruling 7), so strings can only be seen after the campaign is mapped. |
| 19 | **Worker roster search matches on parent name but never returns it.** Parent name leaves the server only in the tag card and in the `pickup-check` response; pickup itself is refused server-side (`409 pickup_check_required`) until a `pickup-check` event exists for the stuffy. | Phase 1 Flow 7 (UI-only sequencing) | "A recorded human step" is only recorded if the server demands it. |

## Summary

Increment 2 turns the approved Phase 2 shape into a buildable system. A `sw_sessions` row holds an event run (practice or real). Registrants arrive by signed Zeffy webhook into `sw_orders` and `sw_stuffies` through a reusable `src/lib/zeffy/` and one `applyPayment()` path shared with "Sync from Zeffy" and Reprocess. Volunteers use a code-gated phone app under `/santas-workshop/crew/[slug]` (signed cookie re-checked against the session row on every request) to tag, check in, photograph, and hand over; every state write is pinned on the expected current state and rolls back through a sentinel on zero rows. Photo bytes go to a private Google shared drive through a `PhotoStore` interface (Drive, local, memory adapters) and are served only through one access module. Frames are composited in the admin's browser and zipped with `fflate`. The collage (`/santas-workshop/c/[token]`) and the family page (`/santas-workshop/f/[token]`) are token-gated Server Components. Nothing in this increment sends email.

## Permissions

- New key `santas_workshop.manage` (`FEATURES.SANTAS_WORKSHOP_MANAGE`, category `santas_workshop`), added through `/add-permission`. Description (apostrophe-free, byte-identical in `FEATURE_DESCRIPTIONS` and migration `0114`): `Manage the Santa Workshop photo event: sessions, Zeffy registrations and parent contacts, worker access, photo review and publishing, frame export, and data purge`.
- Bound to `admin` and `board_member` with the canonical `CROSS JOIN ... NOT EXISTS` idiom (model 0093/0110) so `default-role-bundles.test.ts` parses it. **Never** `treasurer`, `member`, or an `admin.*` key. Holders see about 100 families' names, emails and mobiles.
- `ADMIN_NAVIGATION` entry in the **Engagement** group: `Santa's Workshop`, `/admin/santas-workshop`, `requiredFeature: FEATURES.SANTAS_WORKSHOP_MANAGE` (single key, no widening). DECISION-082 derives the proxy rule for `/admin/santas-workshop*` from it. Every admin page and every `/api/admin/santas-workshop/**` handler still calls `auth()` then `hasFeature()` itself.
- A chair who is neither admin nor board member gets a custom role in `/admin/roles` (not a wider default). JWT features load at sign-in: after migration `0114`, existing board members must sign out and in, then wait about 60 s for the server permission cache (CLAUDE.md, Treasurer baseline paragraph).
- **Crew surface is code-gated, not permission-gated.** `requireCrew()` returns `{ kind: 'crew', sessionId, deviceId, codeVersion }`, else (no valid crew cookie) falls back to `auth()` + `hasFeature()` and returns `{ kind: 'admin', userId, deviceId: 'admin' }`, else one identical unauthenticated answer. The crew cookie never populates `session.user` and no `FEATURES` check reads it.
- **Family and collage surfaces:** possession of a 128-bit token, read-only.

## Data Model

Prefix `sw_` (short, so derived FK names stay under 63 characters; `session-schema.test.ts` iterates every FK name). All timestamps `timestamp with time zone`; event dates are `date` columns read as `YYYY-MM-DD` strings and compared as Eastern wall-clock strings (never through UTC; DECISION-005; `easternDateString()` from `src/lib/eastern-date.ts`, landed by increment 1). Ids are `uuid primary key default gen_random_uuid()`. Vocabulary tuples are exported from the client-safe carriers.

### `sw_sessions`

| Column | Type | Notes |
|---|---|---|
| `slug` | text not null | `[a-z0-9-]{3,40}`, immutable; unique index `ux_sw_sessions_slug` |
| `name` | text not null | |
| `kind` | text not null | `practice` or `real`, **immutable** (no PATCH field; validator rejects it; tested) |
| `status` | text not null default `'draft'` | `draft`, `active`, `closed`, `purged` |
| `dropoff_date`, `photo_date`, `pickup_date` | date not null | the new-session form pre-fills these and `windows` from `WORKSHOP_2026` (increment 1); one authoring path |
| `windows` | jsonb not null default `'[]'` | `[{ id, label, start: 'HH:MM', end: 'HH:MM' }]`, Eastern wall-clock; ids immutable once any stuffy references them |
| `crew_closes_on` | date not null | inclusive Eastern date; default `pickup_date + 1 day`; crew access lapses lazily at request time (no cron) |
| `zeffy_campaign_id` | text | partial unique `ux_sw_sessions_zeffy_campaign ... WHERE zeffy_campaign_id IS NOT NULL` (one campaign, one session) |
| `zeffy_campaign_title` | text | display only, copied at Connect |
| `zeffy_ticket_rate_ids` | text[] not null default `'{}'` | only items with these `rate_id`s become stuffies |
| `question_map` | jsonb not null default `'{}'` | `{ [fieldKey]: string[] }` of normalized question texts; several strings per field allowed |
| `crew_code_enc` | text | AES-256-GCM `v1.<nonce>.<ct>.<tag>` (Ruling 2) |
| `crew_code_version` | int not null default 1 | bumped on rotate |
| `crew_paused` | boolean not null default false | |
| `collage_token` | text not null | 128-bit base64url, unique index; created with the session (the printed QR can exist before publish) |
| `collage_published_at` | timestamptz | the one publish switch for collage and family pages |
| `storage_folder_key` | text | `PhotoStore` folder key (Drive folder id); created lazily and idempotently by `ensureFolder` |
| `storage_quota_bytes` | bigint not null | 600 MB real / 100 MB practice at insert; soft, enforced in the upload route |
| `frame_art_key` | text not null default `'plain'` | Ruling 10 |
| `frame_file_prefix` | text not null default `''` | empty means `ssw-<slug>` |
| `frame_part_size` | int not null default 100 | photo-service rules are learned in the dry run, so these are settings not constants |
| `purge_personal_on`, `purge_public_on` | date not null | defaults from `defaultRetention(pickup_date)`: pickup + 30 days; Jan 31 of the following year |
| `personal_purged_at`, `public_purged_at` | timestamptz | `status` becomes `purged` when both are set |
| `created_by_user_id` | uuid FK `users` ON DELETE SET NULL | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

There is deliberately **no** `is_public` column: increment 1's page keeps reading `WORKSHOP_2026` (sibling Ruling 1; flipping it is not recommended in year one).

### `sw_orders`

`session_id` FK cascade; `zeffy_payment_id` text (null for manual); `source` text (`webhook`, `sync`, `manual`: how the row was created); `payment_status` text; `buyer_first_name`, `buyer_last_name`, `buyer_email`, `buyer_phone` text (capped, nullable; **no address, no receipt URL, no payment method**); `amount_cents` int; `refund_status` text default `'none'` (`none`, `partial`, `full`); `refunded_cents` int default 0; `payment_deleted` boolean default false; `refund_resolution_cents` int, `refund_resolved_at`, `refund_resolved_by_user_id` (Ruling 7); `window_id` text, `window_label_raw` text; `buyer_answers` jsonb default `'[]'` (all buyer-level Q&A as received, each value capped at 2,000 characters, array capped at 40); `acknowledged` boolean; `snapshot_at` timestamptz (our clock just before the Zeffy request, or `dispatchedAt` for an embedded payload); `manual_reason` text; `created_by_user_id`; `created_at`, `updated_at`.
Indexes: `ux_sw_orders_payment` unique on `zeffy_payment_id` WHERE NOT NULL; `ix_sw_orders_session` on `session_id`.

### `sw_stuffies`

`session_id` FK cascade (denormalized so the per-session unique indexes and the IDOR checks are single-column); `order_id` FK cascade; `zeffy_item_key` text; `name`, `description`, `child_first_name`, `snack`, `note_to_santa`, `care_note` text (each capped, 5,000 for the two notes); `photo_consent` boolean not null default false (opt-in); `raw_answers` jsonb default `'[]'` (this ticket's Q&A as received); `attention_codes` text[] not null default `'{}'` (`unmapped_question`, `missing_name`, `missing_snack`, `unmapped_window`, `not_in_order_now`, `truncated`); `needs_attention` boolean not null default false (true iff codes non-empty and `attention_dismissed_at` null); `attention_dismissed_at` timestamptz; `state` text not null default `'registered'`; `tagged_at`, `checked_in_at`, `portrait_at`, `picked_up_at` timestamptz; `tag_code` text (raw, trimmed, at most 200 characters, opaque); `family_token` text not null (128-bit, unique index); `frame_number` int; `frame_exported_photo_id` uuid; `withdrawn_at`, `withdrawn_by_user_id`, `withdrawn_reason`; `created_at`, `updated_at`.
Device ids live only in `sw_stuffy_events` (single place; the brief's per-row device columns are dropped).
Indexes: `ux_sw_stuffies_item` unique `(session_id, zeffy_item_key)` WHERE NOT NULL; `ux_sw_stuffies_tag` unique `(session_id, tag_code)` WHERE NOT NULL; `ux_sw_stuffies_family_token`; `ux_sw_stuffies_frame` unique `(session_id, frame_number)` WHERE NOT NULL; `ix_sw_stuffies_session_state (session_id, state)`; `ix_sw_stuffies_order`.

### `sw_stuffy_events` (append-only history; precedent: `proposalDecisions`)

`session_id`, `stuffy_id` FK cascade; `kind` text (`transition`, `revert`, `tag_bound`, `tag_replaced`, `tag_moved_in`, `tag_moved_out`, `pickup_check`, `refund_continue`, `withdraw`, `manual_add`); `from_state`, `to_state` text; `tag_code`, `prev_tag_code` text; `actor_kind` text (`crew`, `admin`); `device_id` text (22-char random, or `admin`); `code_version` int; `user_id` uuid FK SET NULL (admin path only); `idempotency_key` uuid; `client_taken_at` timestamptz; `note` text (capped 500; nulled at the personal purge because "someone else collecting" notes can hold a name); `created_at` timestamptz default now().
Indexes: `ix_sw_stuffy_events_stuffy (stuffy_id, created_at)`; `ux_sw_stuffy_events_idem` unique `(session_id, idempotency_key)` WHERE NOT NULL; `ix_sw_stuffy_events_prev_tag (session_id, prev_tag_code)` WHERE `prev_tag_code IS NOT NULL` (the "this sticker was replaced" lookup); `ix_sw_stuffy_events_device (session_id, created_at)` (active devices in the last hour).

### `sw_photos`

`id` uuid = the client's idempotency key (no default); `session_id` FK cascade; `stuffy_id` FK cascade, null for group; `kind` text (`check_in`, `portrait`, `group`); `storage_kind` text default `'drive'`; `storage_key`, `thumb_storage_key` text (opaque; null after purge); `content_type` text; `byte_size` int; `thumb_byte_size` int; `width`, `height` int; `sha256` text (server-computed); `taken_at` timestamptz (client capture instant); `created_at`; `device_id` text; `recorded_by_user_id` uuid FK SET NULL; `superseded_at`, `superseded_by_photo_id`; `hidden_at`, `hidden_by_user_id`; `published_at` (group photos: set by the publish batch); `purged_at`. **No bytes, no `bytea`.**
Indexes: **`ux_sw_photos_current` unique `(stuffy_id, kind)` WHERE `kind IN ('check_in','portrait') AND superseded_at IS NULL`** (one current portrait and one current check-in photo, enforced by the database); `ix_sw_photos_session_kind (session_id, kind)`; `ix_sw_photos_device (session_id, device_id, created_at)` (per-device upload rate); `ix_sw_photos_stuffy (stuffy_id)`.

### `zeffy_events` (generic; no `sw_` prefix)

`id` text primary key (the Zeffy event id); `type` text; `version` text; `payment_id` text; `campaign_id` text; `session_id` uuid FK SET NULL (set only when mapped); `received_at` timestamptz default now(); `dispatched_at` timestamptz; `processed_at`; `outcome` text (`received`, `processed`, `ignored_unmapped`, `ignored_type`, `invalid`, `unsupported_version`, `failed`); `error_code` text (a code, never payload text); `attempts` int default 1; `payload` jsonb (the **whitelisted `PaymentSnapshot`**, stored only when the campaign is mapped; nulled at the personal purge). Indexes: `(campaign_id, received_at desc)`, `(payment_id)`, `(received_at)`. Unmapped rows hold ids and times only. They are tiny and are not pruned this year.

### `sw_session_log` (admin-action audit; counts and ids only, never names or contact data)

`session_id` FK cascade, `user_id` FK SET NULL, `kind` text (`created`, `activated`, `closed`, `reopened`, `code_viewed`, `code_rotated`, `paused`, `resumed`, `campaign_connected`, `mapping_saved`, `sync_run`, `published`, `unpublished`, `photo_hidden`, `photo_unhidden`, `frames_exported`, `storage_test`, `storage_error`, `storage_check`, `purge_step`, `purge_done`, `reset`, `stuffy_reverted`, `stuffy_withdrawn`, `refund_resolved`), `detail` jsonb, `created_at`. Index `(session_id, created_at desc)`.

### `sw_crew_attempts` (DB-backed throttle)

`scope_key` text (`ip:<first 16 hex of HMAC(AUTH_SECRET, ip)>` or `sess:<uuid>`; never a raw IP), `created_at`. Failures only. Index `(scope_key, created_at)`. Swept lazily: each failure insert also runs `DELETE ... WHERE created_at < now() - interval '2 days'`.

### Migrations

- `0113_santas_workshop_tables.sql`: eight `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS` (partial ones with `WHERE`), every FK added inside a `pg_constraint`-guarded `DO $$` block with the name drizzle derives (`{table}_{column}_{reftable}_{refcolumn}_fk`; model `0112`). No seed data, no role binding, no personal data.
- `0114_santas_workshop_permission.sql`: feature insert + `admin` and `board_member` binds, `0093` shape, plus a guarded description `UPDATE`.
- `schema.ts` gets the eight tables first (schema is the source of truth); `.gitignore` gets `.santas-workshop-store/`.
- Numbers are tentative (`ls drizzle/migrations | sort | tail -3` at Phase 4 start; increment 1 adds none).

## Zeffy ingestion (`src/lib/zeffy/` plus the workshop consumer)

**Module split** (the module knows nothing about the workshop; the route composes the consumer, so the dependency points workshop to module):

| File | Responsibility |
|---|---|
| `signature.ts` | pure, `now` injected. Parse `Zeffy-Signature: t=...,v1=...` (accept repeated `v1`), 300 s tolerance both directions, HMAC-SHA256 over `"{t}." + rawBodyBytes`, length check then `timingSafeEqual`. |
| `types.ts` | hand-typed subset: `ZeffyEnvelope { id, type, version, dispatchedAt, data }`, `Payment`, `Item`, `QuestionAnswer { question, type, answer: string or string[] or boolean }`, `Refund`, `Campaign`, `Rate`, narrowing guards. |
| `snapshot.ts` | `toSnapshot(payment): PaymentSnapshot`, the **whitelist projection** (id, status, refund status, succeeded-refund sum, campaign id, buyer names and email, buyer questions, items `{ key, type, rateId, amount, questions }`). Drops address, receipt URL, payment method, dispute, discount, tribute. Caps lengths. `itemKey()` lives here (Ruling 5). Missing id or status returns `invalid`. |
| `client.ts` (server only) | bearer `ZEFFY_API_KEY`; `listPayments({ campaignId, startingAfter, limit })` (campaign **required by type and checked at runtime**), `getPayment(id)` (404 returns `{ gone: true }`), `listCampaigns()`, `getCampaign(id)`. Sequential, at least 700 ms between sync pages, honors `Retry-After`. **Non-production refuses any call whose campaign is not in `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` and discards other payments unread.** Never logs the key or a body. |
| `events-queries.ts` | `claimEvent()` (insert-or-read, Ruling 3), `finishEvent()`, `recentEvents(campaignId)`. |
| `webhook-handler.ts` | verify, claim, dispatch to injected consumers, map consumer result to HTTP. |
| `embed-url.ts` | `toEmbedUrl()` moved from `src/components/campaigns/zeffy-url.ts`, three importers updated, no shim, in this increment. |
| `test-helpers.ts` | `signZeffyBody(secret, body, t)` for tests and `scripts/zeffy-webhook-fixture.ts` only (a source-scan test fails if app code imports it). |

**Route** `POST /api/zeffy/webhook` (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, no `auth()`, no `@/lib/auth` import): read `arrayBuffer()` first, cap 256 KB, verify, then claim, then process inline, then 200. A missing `ZEFFY_WEBHOOK_SECRET` fails closed with 500 `not_configured` (never accepts unsigned). Bad signature, stale or future `t`, oversize, malformed JSON after a valid signature: one identical `400 { error: 'bad_request' }`, no database write, no body logged.

**Consumer** `santasWorkshopConsumer.handle(event, ctx)`, in `src/lib/santas-workshop/zeffy-consumer.ts`:

1. Accept `payment.completed`, `payment.updated`, `payment.deleted` only. Anything else (`payment.created`, `contact.*`) is `ignored_type`, ids only.
2. `completed`: `data.campaign_id` to session via `zeffy_campaign_id`. No session means `ignored_unmapped`, **no payload stored**. Mapped and payment unseen: apply the embedded payload (`snapshot_at = dispatchedAt`). Mapped and payment known: re-fetch and apply.
3. `updated` / `deleted` carry `{ id }` only. Known payment: fetch (404 sets `payment_deleted = true`) and apply. Unknown payment on `deleted`: `ignored_unmapped` code `unknown_payment`. Unknown payment on `updated`: fetch once; campaign mapped means apply (this also heals a missed `completed`); unmapped means discard the snapshot and record the campaign id only.
4. Only `status = 'succeeded'` creates registrants; `pending` and `failed` return `processed` with code `not_succeeded`.
5. Missing `ZEFFY_API_KEY` on a path that needs a fetch: `failed` code `no_api_key` (500, Zeffy retries for 3 days, the admin sets the key and presses Reprocess).
6. Transient database or fetch failure: `failed` (500). Permanent (`invalid`, `unsupported_version`): 200 with the outcome recorded.

**`applyPaymentSnapshot(snapshot, { sessionId, source, fetchedAt })`** is the one write path (webhook, Sync, Reprocess payment). Shape: Zeffy HTTP call happens **before** and outside the transaction; then `db.transaction`: `SELECT pg_advisory_xact_lock(hashtext($paymentId))` first; read the order; **refuse a snapshot whose `fetchedAt` is older than `sw_orders.snapshot_at`** (a late retry must not un-refund); pure `mapPaymentToRegistrants()` computes the desired order and stuffy values; compare with existing rows; insert missing, update only **import-owned** columns on changed rows, skip unchanged rows (so `updated_at` stays honest and the result can report `created / updated / unchanged / refundChanged`). Worker-owned columns (`state`, `*_at` state stamps, `tag_code`, `frame_*`, `withdrawn_*`, `family_token`) never appear in any SET list (source-scan test). An item absent from a later snapshot gets attention code `not_in_order_now` (flag, never delete). An order already stored under a different session than the campaign now maps to returns `failed` code `session_mismatch`.

**Mapper rules** (`payment-mapper.ts`, pure):
- Item becomes a stuffy iff `type = 'ticket'` and `rateId` is in `zeffy_ticket_rate_ids`. Donations and additional donations never do. A wrong campaign mapping (no marked rate) therefore creates nothing.
- Fields (`question-fields.ts`, client-safe, shared with the admin mapping screen): ticket scope `stuffy_name` (required), `stuffy_description`, `snack` (required), `note_to_santa`, `care_note`, `child_first_name`, `photo_consent`; buyer scope `buyer_phone`, `dropoff_window` (required), `acknowledgment`.
- `normalizeQuestionText`: NFKC, case-fold, collapse whitespace, strip trailing `*`, `:` and `?`.
- `answerToText`: string as-is, number/boolean to string, array joined with `, `, each capped.
- Consent: true only for boolean `true` or a normalized string in a fixed affirmative set; absent, `false`, blank or unrecognized means **no**. The exact affirmative set is fixed by S2 against the real form; unrecognized is never an error and never flagged.
- Unmatched question strings and unmapped required fields set `attention_codes` and keep the raw text (capped, React-escaped on render, drawn with `fillText` on frames; never HTML). Missing stuffy name displays "Unnamed stuffy, order of N".
- Window: normalized equality between the answer and a session window label; no match sets `unmapped_window` (worker sees "Window: ask the chair").
- Partial refund flags the order only; full refund or deleted is the derived worker badge (Ruling 7).
- Truncation (care note over 5,000 characters, and so on) adds `truncated`, visible to the admin.

**Sync from Zeffy** (`POST .../zeffy/sync`): `listPayments({ campaignId, status: 'succeeded', limit: 100, startingAfter })` (the OpenAPI `PaymentList` returns full `Payment` objects with `next_cursor` and `has_more`; whether list items carry `items[]` and `questions[]` is S2, and the per-payment fetch is the fallback). Each payment goes through `applyPaymentSnapshot` with `source: 'sync'`. Time-boxed to about 45 s per request; the cursor `{ startedAt, startingAfter, counts }` goes back to the client, which loops with a progress bar ("Zeffy is limiting requests, continuing..." is a normal message). On the last page, **stale = this session's non-manual orders with `snapshot_at < startedAt`** (every webhook or sync apply stamps `snapshot_at`, so no id list rides in the cursor); each is fetched individually and a 404 sets `payment_deleted`. Result counts: `newFromZeffy` (by definition a missed webhook), `changed`, `goneInZeffy`, `refundDiffers`.

**Reprocess:** (a) *Remap* re-applies the map to stored `raw_answers`/`buyer_answers` locally in batches of 200 with a cursor (no Zeffy call); (b) *Reprocess payment* re-fetches one payment and applies it; (c) *Reprocess event* re-runs the consumer from the stored snapshot (`zeffy_events.payload`) or, when none, re-fetches.

## Photo store (`src/lib/santas-workshop/photo-store/`)

```
interface PhotoStore {
  ensureFolder(name): Promise<folderKey>                               // idempotent
  put({ folderKey, photoId, variant: 'full'|'thumb', bytes, contentType, attempt }): Promise<{ key }>
  get(key): Promise<{ stream, contentType, size } | null>              // null = missing
  delete(key): Promise<void>                                           // missing = success
  list(folderKey, pageToken?): Promise<{ items: { key, photoId, variant, size }[], next? }>
  ping(): Promise<{ ok: true, latencyMs }>                             // write, read back, delete a tiny object
}
```

- **Keys are opaque** (`storage_key` holds the Drive file id; `storage_kind` defaults to `'drive'`). The swap-back-to-Postgres cost stays as Ruling 4 states it.
- **Factory** (`index.ts`): `NODE_ENV === 'test'` memory; `production` Drive or **hard failure** `StorageMisconfigured` (never local or memory); otherwise Drive only if `SW_PHOTO_STORE=drive`, else local (`.santas-workshop-store/`). Typed errors in `errors.ts`: `StorageUnavailable` (retryable), `StorageMisconfigured`, `StorageFull`, `StorageRateLimited`, mapped by the routes to `503 { code: 'storage_unavailable' | 'storage_misconfigured' | 'storage_full' | 'storage_rate_limited' }`. No message contains key material.
- **Drive adapter** (`drive.ts`): `googleapis` ^173 is already in `package.json` (confirmed). `getDrive()` does `await import('googleapis')` lazily so only photo routes pay its cold start (S1 measures; if material, swap inside this file to `@googleapis/drive` + `google-auth-library`). Auth: `google.auth.JWT` from `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, scope `https://www.googleapis.com/auth/drive`. Every call passes `supportsAllDrives: true`; listing uses `corpora: 'drive'`, `driveId: GOOGLE_DRIVE_SHARED_DRIVE_ID`, `includeItemsFromAllDrives: true`. `put`: `files.create` multipart (single request, about 1.1 MB), `parents: [folderKey]`, `name: <photoId>-<variant>.jpg`, `appProperties: { photo_id, variant }`. **First attempt creates directly; when the client header `X-SW-Attempt` is greater than 1, look up by `appProperties` first and return the existing file's key** (a request that reached Drive but lost its reply must not create a second file; this saves a Drive call on the happy path). `get`: `files.get({ alt: 'media' }, { responseType: 'stream' })`, wrapped with `Readable.toWeb`. `delete`: `files.delete` (permanent), 404 is success. One internal retry with jittered backoff on 5xx, 429 and network errors, then the typed error. **No `permissions.*`, `webViewLink`, `webContentLink` anywhere in `src/`** (scan test).
- **Folder layout:** `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` (per environment) / `<session-slug>` / flat `<photoId>-full.jpg`, `<photoId>-thumb.jpg`. Names and `appProperties` hold opaque uuids only.
- **Local** (`local.ts`) and **memory** (`memory.ts`) adapters: same interface; the local one rejects path traversal. One contract suite (`contract-suite.ts`) runs against both; the Drive adapter is exercised against an injected fake `drive` client. **No test calls Drive.**
- **Day-0 spike script** `scripts/spike-drive.ts` (S1): reads the same env, then (1) creates a folder under the root, (2) uploads a 1 MB random JPEG-shaped file, (3) downloads it and compares sha256, (4) lists with the `appProperties` filter, (5) permanently deletes it, (6) prints latency for each step and the cold-start cost of `import('googleapis')`, (7) attempts the delete under the role in use and prints the role result. Prints no secret.

## Crew authentication (`crew-code.ts`, `crew-cookie.ts`, `crew-auth.ts`, `crew-throttle.ts`)

- **Code:** 8 characters from an unambiguous alphabet (no `0 O 1 I L`), uppercase, generated with `crypto.randomInt`. Entry normalizes (uppercase, strips spaces and hyphens). Stored per Ruling 2.
- **Cookie:** `base64url(JSON { s: sessionId, v: codeVersion, d: deviceId, e: expiresEpoch }) + "." + base64url(HMAC-SHA256(key, payload))`, `key = HKDF(AUTH_SECRET or NEXTAUTH_SECRET, info "sw-crew-cookie")`, a different derived key from NextAuth's own. `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 72 h absolute (not sliding), `Secure` and the `__Host-` name prefix only when `NODE_ENV === 'production'` (a `__Host-` cookie needs `Secure`, which plain-http localhost may refuse). Name `swcrew-<first 8 hex of session id>` (one cookie per session). `Lax`, not `Strict`: the entry link arrives by text message.
- **`requireCrew(request, { slug } | { sessionId })`:** resolve the session row (indexed), read the cookie for that session, verify the signature, **then re-check the row on every request**: `status = 'active'`, `NOT crew_paused`, `crew_code_version === v`, `easternDateString(now) <= crew_closes_on`, `e > now`. Denial is `401 { code: 'crew_auth_required' }`; a `reason` (`paused`, `closed`, `signed_out`) is included **only when the cookie signature is valid** (the holder already proved they had the code), otherwise the body is identical for wrong, absent, forged and unknown-slug.
- **Admin bypass:** no valid crew cookie falls back to `auth()` + `hasFeature(SANTAS_WORKSHOP_MANAGE)`; works on `draft`, `paused` and `closed` sessions (lock-out-proof fallback). Admin writes record `actor_kind = 'admin'`, `device_id = 'admin'`, `user_id`.
- **Entry** `POST /api/santas-workshop/crew/[slug]/enter { code }` is the single route that does not call `requireCrew`. It checks the throttle first, then verifies (decrypt + `timingSafeEqual`), sets the cookie, and answers a wrong, revoked, paused, closed or unknown-slug code with the same sentence-bearing body (`"That code didn't work. Ask the event chair."`); only a throttle block adds "Wait a few minutes." Throttle: per IP-hash 5 failures per 10 min and 20 per 24 h; per session 30 failures per 10 min across all IPs. Successful entry does not clear counts. **Requests that carry a valid cookie never consult the throttle**, so an attacker cannot lock the crew out. IP is the first `x-forwarded-for` hop (set by Vercel), used only as an HMAC.
- **Rotation:** `rotate` bumps `crew_code_version` (old cookies fail on their next request, because every request re-reads the row). If devices were active in the last hour (distinct `device_id` in `sw_stuffy_events` and `sw_photos` for the current code version), the first call answers `409 { code: 'devices_active', count }`; the dialog repeats with `acknowledge: true`. Pause/resume toggles `crew_paused`. Close sets `status = 'closed'`.
- CSRF: `SameSite=Lax` cookies are not sent on cross-site POSTs; all crew mutations take JSON or multipart. No `Origin` check added (believed sufficient, unmeasured; the admin side already relies on the same property).

## State machine and the write idiom

`state-machine.ts` (pure, client-safe) exports `STUFFY_STATES = ['registered','tagged','checked_in','portrait_taken','picked_up']`, the forward table, `canTransition(from, to)`, `isPickupAllowedFrom(state)` (checked_in or portrait_taken), and `canRevert`. Illegal moves (`tagged` to `picked_up`, skipping states) are refused by the table, not by the screen.

**Every state-changing write** (`stuffy-transitions.ts`, hermetic-test style of `ledger-approval-decision.ts`):

1. *Idempotency pre-read:* an event with `(session_id, idempotency_key)` returns the stored result (`replayed: true`).
2. `db.transaction`: `SELECT ... FROM sw_stuffies WHERE id = $id AND session_id = $sessionId FOR UPDATE` (the session comes from the credential, never the body; a stuffy of another session is `404`, the IDOR guard). Re-read the idempotency key inside the lock.
3. `row.state !== expectedState` returns a typed `409 { code: 'stale_state', currentState, since }`; `withdrawn_at` set returns `409 withdrawn`.
4. `canTransition` check.
5. One UPDATE pinned `WHERE id = $id AND state = $expectedState` (tag changes also pin `tag_code IS NOT DISTINCT FROM $expectedTagCode`), `RETURNING id`; **zero rows throws `StaleTransitionRollback`** (a plain `return` from `db.transaction` commits).
6. Insert the `sw_stuffy_events` row (and for photo transitions the `sw_photos` row; a retake first sets `superseded_at` on the old current portrait, then inserts, so the partial unique index never sees two). A `23505` on the idempotency index rolls back and answers as a replay.
7. The sentinel is caught outside the transaction, the row re-read once, and the same `409` returned.

**Never hold a lock across a Drive or Zeffy call.** Photo order of operations: validate; replay check by photo id; `put` to the store (idempotent); then the transaction above. A `409` after upload deletes the just-uploaded files best-effort (unless the photo row already exists). A crash between upload and transaction leaves an orphan that "Check storage" lists.

**Tag binding** (`tag-binding.ts` pure decision + query): input `{ target, holder, code, mode }`. Code normalization: trim, 1 to 200 characters, no control characters, stored exactly, **never navigated to or rendered as a link**.

| Situation | Result |
|---|---|
| Unbound code | bind; event `tag_bound`; state `tagged` |
| Bound to the same stuffy | success, no new event |
| Bound to another stuffy that is `tagged` (or withdrawn) | `409 confirm_move { otherStuffyName }`; with `confirm: 'move'`: lock both rows in id order, other goes back to `registered` with `tag_moved_out`, this one gets `tag_moved_in`; history keeps both |
| Bound to another stuffy at `checked_in` or later | `409 holder_advanced { otherStuffyName }`; admin fixes with a reason |
| Target already has a different code | `409 confirm_replace { oldLast4 }`; with `confirm: 'replace'`: `tag_replaced` with `prev_tag_code`; scanning the old code later answers `retired` |
| Scan of an unbound code at check-in or portrait (`POST /scan`) | `{ result: 'not_tagged' }` with Tag it now / Find by name |
| Code bound in another session | the **same** `not_tagged` body (no cross-session lookup) |
| Two workers bind one code at once | the unique `(session_id, tag_code)` index decides; the loser gets the typed already-bound path, never a 500 |
| Every sticker decodes to the same text | second bind collides; the card shows the last 4 characters; admin "Test stickers" (scan three, they must differ) when the roll arrives |

## API contract

**Carriers (client-safe; the UI imports from them, so a removed or widened member breaks `tsc`):**
- `src/lib/santas-workshop/crew-contract.ts`: `STUFFY_STATES`, `PHOTO_KINDS`, `CrewErrorCode`, `CrewRosterRow`, the four view DTOs (`CrewTagCard`, `CrewCheckInCard`, `CrewPortraitCard`, `CrewPickupCard`), every crew request/response type, `StaleStateBody`, and `ScanResult` (`found | not_tagged | retired | withdrawn`, consumed with an exhaustive `never` switch, the DECISION-102/103 pattern).
- `src/lib/santas-workshop/admin-contract.ts`: `SESSION_KINDS`, `SESSION_STATUSES`, `ZEFFY_EVENT_OUTCOMES`, `SessionDto`, `ChecklistItem`, `SyncProgress`, `PurgeStep`, `FrameManifest`, the admin request/response types, `AdminErrorCode`.
- `src/lib/santas-workshop/photo-limits.ts`: one definition of kinds, dimensions, byte caps and the quality ladder, imported by the browser downscaler **and** the server validator (no duplicated number).
- `src/lib/santas-workshop/question-fields.ts` and `state-machine.ts`: as above.

Error envelope everywhere: `{ error: string, code: <enum> }`. Crew DTOs are built by dedicated mappers; the Drive key never appears in a response.

**Photo limits (planning numbers from Ruling 4, enforced server-side):** upload body at most 2 MB total; `check_in` long edge 1280 px, 500 KB hard cap, no thumb; `portrait` 2400 px, 1.5 MB hard cap, thumb 480 px at most 100 KB; `group` 1920 px, 1 MB, thumb 480 px. Server validation: JPEG magic bytes, header-only dimension parse (SOF0/SOF1/SOF2) with a pixel cap, dimensions equal to the metadata, non-empty, never decodes pixels.

### Webhook

| Route | Notes |
|---|---|
| `POST /api/zeffy/webhook` | as above; 200 `{ ok: true, outcome }`, 400 `bad_request`, 500 `failed` (retryable) |

### Admin (`/api/admin/santas-workshop/...`; `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` are the first two statements; JSON; `Cache-Control: no-store`)

| Method and path | Request | Response and notes |
|---|---|---|
| `GET /sessions` | | `{ sessions: SessionDto[], storage: { configured, lastTest, bannerCause } }` (storage banner shows on the list, not only inside a session) |
| `POST /sessions` | `{ name, slug, kind, dropoffDate, photoDate, pickupDate, windows[] }` | 201 `{ session }`; creates tokens and retention dates; no Drive call |
| `GET /sessions/[id]` | | `SessionDto` with counts by state and window, `needsAttention`, `refundsOpen`, `lastZeffyEventAt`, quota used, `portraitsSinceExport`, `checklist: ChecklistItem[]` |
| `PATCH /sessions/[id]` | name, dates, windows, `crewClosesOn`, retention dates, quota, frame settings | `kind` and `slug` rejected (`immutable_field`); removing a window in use is `409 window_in_use` |
| `POST /sessions/[id]/status` | `{ to: 'active' or 'closed' or 'draft' }` | activate generates the code if none and, for a **real** session, requires a successful storage test within 10 minutes (`409 storage_not_ready`); `purged` is terminal |
| `GET /sessions/[id]/crew-code` | | `{ code, version, paused, activeDevicesLastHour }`, `no-store`, logs `code_viewed` (never the code) |
| `POST /sessions/[id]/crew-code` | `{ action: 'rotate' or 'pause' or 'resume', acknowledge? }` | rotate returns the new code; `409 devices_active` first time |
| `GET /zeffy/campaigns` | | org campaigns, metadata only (`id`, `title`, dates, `rates[]`); non-production filtered by the allowlist |
| `PUT /sessions/[id]/zeffy` | `{ campaignId, ticketRateIds[] }` | one campaign to one session (`409 campaign_in_use`); the UI wraps it in a ConfirmDialog showing the campaign title |
| `GET /sessions/[id]/zeffy/questions` | | distinct normalized question strings seen in stored raw Q&A, with counts and current field |
| `PUT /sessions/[id]/zeffy/question-map` | `{ map }` | saves; returns the number of stuffies whose attention would change |
| `POST /sessions/[id]/zeffy/reprocess` | `{ cursor? }` | local remap, batches of 200 |
| `POST /sessions/[id]/zeffy/sync` | `{ cursor? }` | `{ cursor or null, progress, done, retryAfterMs? }` |
| `POST /sessions/[id]/zeffy/payments/[paymentId]/reprocess` | | fetch + apply one payment |
| `GET /sessions/[id]/zeffy/events` | `?limit` | recent events for this campaign, **no payload**, plus `lastValidEventAt` |
| `POST /zeffy/events/[eventId]/reprocess` | | re-run the consumer for one logged event |
| `GET /sessions/[id]/stuffies` | `?state&q&flag&page` | admin list with parent contact, flags, order size |
| `POST /sessions/[id]/stuffies` | manual add: parent first/last, stuffy name, description, windowId, snack, optional notes and contact, `photoConsent`, `reason` (required), `idempotencyKey` | 201; order `source: 'manual'`, event `manual_add` |
| `POST /stuffies/[stuffyId]/revert` | `{ toState, reason, expectedState }` | admin backward move; to `registered` clears the tag code (retire event) |
| `POST /stuffies/[stuffyId]/withdraw` | `{ reason }` | only from `registered` or `tagged`; a stuffy in custody can only be flagged |
| `POST /stuffies/[stuffyId]/dismiss-attention` | | sets `attention_dismissed_at` |
| `POST /orders/[orderId]/refund-resolution` | `{ resolution: 'keep' }` | stores `refund_resolution_cents = refunded_cents` |
| `GET /sessions/[id]/awaiting-pickup.csv` | | stuffies not picked up, with parent contact, through `csvCellSafe()` |
| `GET /sessions/[id]/photos` | `?kind&page` | DTOs `{ id, kind, takenAt, hidden, publishedAt, stuffyName? (portrait), consent }`, 60 per page, no keys |
| `POST /photos/[photoId]/hide` | `{ hidden: boolean }` | logs `photo_hidden`/`photo_unhidden` |
| `POST /sessions/[id]/publish` | `{ action: 'publish' or 'unpublish' }` | publish sets `collage_published_at` (first time) and `published_at = now()` on every unhidden, unpublished group photo; repeatable for late photos |
| `POST /sessions/[id]/frames/manifest` | | allocates missing frame numbers (idempotent, under a session-row lock, unique-index backstop with one retry on `23505`), returns `FrameManifest { kind, slug, collageUrl, items[{ stuffyId, frameNumber, name, parentLast, parentFirst, windowLabel, portraitPhotoId, consent }], withoutPortrait[], hidden[], sinceLastExport, settings }`; `409 non_production_origin` for a real session (below) |
| `POST /sessions/[id]/frames/exported` | `{ items: [{ stuffyId, photoId, frameNumber }], partial }` | sets `frame_exported_photo_id` for produced frames only (pinned on `frame_number`); logs `frames_exported` |
| `POST /storage/test` | | `{ ok, latencyMs }`, logs `storage_test` |
| `POST /sessions/[id]/storage/check` | `{ cursor? }` | lists Drive files with no row and rows with no file (resumable); `{ action: 'delete_orphans' }` variant |
| `POST /sessions/[id]/purge` | `{ phase: 'personal' or 'public', cursor? }` | resumable, time-boxed to about 30 s; **eligibility is computed on the server** (`409 not_eligible` before the date) |
| `POST /sessions/[id]/reset` | `{}` | **practice only**, checked on the server (`403 practice_only`); same engine as purge, immediate, then deletes order/stuffy/event rows |

**Frame origin guard:** `isProductionOrigin(url)` (pure, `origin.ts`): https, hostname not `localhost`, an IP, `*.vercel.app` or `*.local`. A **real** session's manifest additionally requires `VERCEL_ENV` unset or `production`, because `getAppUrl()` falls back to the production origin when `NEXTAUTH_URL` is unset (read in `email-compose.ts`), which on a preview deployment would print a QR to a database the preview does not have. Practice sessions are exempt (and drawn with a PRACTICE band).

### Crew (`/api/santas-workshop/crew/[slug]/...`; every handler's first awaited call is `requireCrew()`, except `enter`)

| Method and path | Request | Response and notes |
|---|---|---|
| `POST enter` | `{ code }` | sets cookie; uniform failure; throttle |
| `GET roster` | | `{ serverTime, session: { name, kind, windows, status }, stuffies: CrewRosterRow[] }` ordered by window then name, refunded to the bottom, withdrawn excluded. Row: `id, name, description (80), state, windowId, orderId, orderSize, last4?, refundBadge, detailsBeingChecked, hasCheckInPhoto, hasPortrait`. **No email, mobile, Zeffy ids, notes, parent name.** The client polls on focus and every 30 s ("Updated 12 s ago"). |
| `GET search?q=` | `q` at least 3 characters | at most 10 rows, same row shape; matches stuffy name, parent first/last name, never returns parent name (Ruling 19) |
| `GET stuffies/[id]?view=tag or checkin or portrait or pickup` | | the view DTO: tag = name, description, window, **parentName**, orderSize, state; checkin = name, description, **snack**, **careNote**, window, refund banner; portrait = name, description, **noteToSanta**, check-in photo id, hasPortrait; pickup = name, description, state, hasPortrait, check-in photo id, refund banner, `pickedUpAt?`. Least data per view. |
| `POST scan` | `{ code }` | `ScanResult`; the code is in the body, never in a URL |
| `POST stuffies/[id]/tag` | `{ tagCode, expectedState, expectedTagCode, confirm?: 'move' or 'replace', idempotencyKey, clientTakenAt }` | the collision table; 200 with the card, or typed 409 |
| `POST stuffies/[id]/check-in` | multipart `meta` + `full`, or JSON `{ withoutPhoto: true, ... }` | meta `{ photoId, expectedState: 'tagged', takenAt, width, height, refundContinue? }`; check-in without a photo is allowed and flagged (derived: state past tagged with no current check-in photo) |
| `POST stuffies/[id]/portrait` | multipart `meta` + `full` + `thumb` | meta adds `replace` (required `true` when a portrait exists, else `409 portrait_exists`); expected state `checked_in` or `portrait_taken` |
| `POST group-photos` | multipart `meta { photoId, takenAt }` + `full` + `thumb` | no state; unpublished until an admin publishes |
| `POST stuffies/[id]/pickup-check` | `{ result: 'matched' or 'someone_else', note?, idempotencyKey }` | records the event, returns `{ parentName }` |
| `POST stuffies/[id]/pickup` | `{ expectedState, idempotencyKey }` | `409 pickup_check_required`; never blocked by a missing portrait, a refund flag or a storage failure; success returns `{ pickedUpAt, familyUrl }`; a second tap with another key is `409 already_picked_up { at }` |
| `POST stuffies/[id]/revert` | `{ toState, expectedState }` | **practice sessions only** (`403 practice_only` otherwise) |

Upload responses: `413 too_large` or `quota_exceeded`, `415 not_jpeg`, `429 rate_limited` (more than 12 rows from one device in 60 s), `503 storage_*` with a `retryable` flag. Group photos and uploads are additionally bounded by `sw_sessions.storage_quota_bytes` (`SUM(byte_size)`, race-tolerant).

### Photo door and public pages

| Route | Notes |
|---|---|
| `GET /api/santas-workshop/photos/[id]?v=thumb or full` | resolves a credential (admin session with the key, crew cookie for **that photo's session**, or none) and calls `photo-access.ts`. Streams. **404 on every failure**, never 403. |
| `GET /api/santas-workshop/family/[token]/portrait?v=thumb or full&download=1` | family credential (token to stuffy) into the same access module; `download=1` sends `Content-Disposition: attachment; filename="stuffy-portrait.jpg"` (neutral name) |
| `/santas-workshop/c/[token]` | collage Server Component |
| `/santas-workshop/f/[token]` | family Server Component |
| `/santas-workshop/crew/[slug]` | server page does the gate and renders `<CodeEntry/>` or `<CrewApp/>` |

**`photo-access.ts` is the only module that calls the store's `get`** (scan-tested). Decision is `(viewer, photo, variant, session, stuffy) => allow or 404`:

| Viewer | Allowed | Always 404 |
|---|---|---|
| Admin | any kind, either variant, including hidden and superseded | purged |
| Crew (same session, valid cookie) | `check_in` full only; current, unhidden `portrait` (either variant); unhidden `group` (either variant) | other sessions; hidden; superseded; `check_in` thumb; purged |
| Family (token to its stuffy) | that stuffy's current, **unhidden** portrait, regardless of consent, once the session is published | any other photo; hidden; superseded; unpublished session; purged |
| Public | `group` with `published_at` set, unhidden, session published; `portrait` that is current, unhidden, `photo_consent`, session published | `check_in` always; superseded; unpublished; purged |

Headers: public and family variants `Cache-Control: private, max-age=300` (browser only, no shared cache); crew and admin `no-store`; all `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`. **Accepted residual (user, 2026-10-12):** a hidden photo may remain visible up to 5 minutes in a browser that already loaded it; a fresh fetch is `404` at once. Phase 5 check L3 records both numbers.

## Worker (crew) app

- `src/app/santas-workshop/crew/[slug]/page.tsx` (Server Component, dynamic) calls the same session lookup as `requireCrew`, then renders `<CodeEntry/>` or `<CrewApp initial=.../>`. `layout.tsx` sets `robots: noindex`. One client app with an internal view state (list, card, scan, capture, pickup) mirrored to `history.pushState` so the phone's back button works and the camera stream is not torn down by route changes.
- **Scanning** (`scanner.tsx`, `scan-loop.ts`, `qr-decoder.ts`): `QrDecoder` interface. Native `BarcodeDetector` when feature-detected and `getSupportedFormats()` includes `qr_code`; else `jsqr` on frames downscaled to at most 640 px wide every about 120 ms, loaded with `import('jsqr')` only on this screen. The loop accepts a result after two consecutive identical decodes, ignores text over 200 characters, and debounces repeats. **A "type the code" field is always visible**, and "Scan from a photo" (still decode) is the fallback. Swap criterion for `zxing-wasm` is S3's decode rate on the real stickers.
- **Photos** (`photo-capture.tsx`, `photo-downscale.ts`): `<input type="file" accept="image/*" capture="environment">`; preview with the stuffy's name above ("Use photo" / "Retake"); tag-in-shot prompt on check-in, tag-out-of-shot prompt on portrait, a one-line "stuffies only, never the children" reminder. HEIC (a library pick) uses the existing `decodeHeicFileToJpegBlob()`. Downscale: `createImageBitmap(file, { imageOrientation: 'from-image' })` (fallback: an `<img>` decode, which also applies EXIF in current browsers), canvas resize through the existing `computeResizeDimensions(w, h, max)`, `toBlob('image/jpeg')` with a quality ladder (0.82 down to 0.5, then a 15% dimension step) driven by a pure `planEncodeAttempt()`; re-encoding strips EXIF and GPS and bakes orientation. Never upscales.
- **Outbox** (`outbox-core.ts` pure with an injected storage; `outbox-idb.ts` the IndexedDB wrapper): a captured photo is written to IndexedDB **before** any network call, the UI says "Saved on this phone", the next scan is allowed immediately, and a drain loop uploads FIFO with at most 2 in flight, retrying with the same `photoId` and an `X-SW-Attempt` count and exponential backoff. The state does not advance in the UI until the server answers. Header shows "N photos waiting". `storage_misconfigured` stops automatic retry and shows "Photos can't be saved right now. They're kept on this phone. Tell the chair." with "Check in without a photo" available (flagged). A `409 stale_state` item is parked with a message, not retried. A 401 holds items and returns the worker to code entry. Tagging, search, pickup and other DB-only actions are online-only with a retry button and the same idempotency key. Tag lookup is never cached on the phone.
- **Pickup:** Confirm name (calls `pickup-check`, reveals the parent name) then Mark picked up; on success `qrcode` draws a QR of `familyUrl` large on the worker's phone for the parent to scan.
- **Copy and tap rules:** 360 px wide, 44 px targets, 16 px inputs, `rounded-2xl` cards, `rounded-lg` buttons, `lions-blue` focus rings, every unbind, replace, move, revert and portrait-replace through `<ConfirmDialog>`, practice sessions carry a PRACTICE band.

## Frame export (admin browser, laptop only)

Page `/admin/santas-workshop/[sessionId]/frames` (a phone sees "Use a laptop for this step"). Libraries `qrcode` and `fflate` load by dynamic `import()` on this page only.

1. `POST frames/manifest` (allocates numbers) then show: "138 with a portrait, 6 without (listed), 1 hidden by admin, 3 portraits taken since the last export".
2. For each item (3 concurrent, 3 retries with backoff): fetch the portrait through the photo door (`?v=full`, admin credential), `createImageBitmap`, composite on a **1200 x 1800** canvas (portrait orientation, per spec §7) with pure `frame-layout.ts` geometry: safe margin 75 px (0.25 in), cover-crop of the portrait into the photo window, frame art over the photo (`frame_art_key`: `plain` is drawn in code; a PNG must be exactly 1200 x 1800), caption = the stuffy name only (control and bidi-override characters stripped, whitespace collapsed, fit-shrink then truncate, `fillText` with a font stack that includes system emoji fonts, never SVG or HTML), a solid white plate holding the QR drawn from `QRCode.create()` module data at **integer pixels per module (7 or more) with a 4-module quiet zone**, ECC level M, and the words under it (Ruling 10). Practice sessions get a PRACTICE band.
3. Encode `toBlob('image/jpeg', 0.92)`, then `jpeg-dpi.ts` rewrites or inserts the JFIF APP0 so density is 300 x 300 dpi (the canvas leaves it unset); baseline sRGB, no alpha.
4. File name `ssw-<slug>-NNN.jpg` (or `<frame_file_prefix>-NNN.jpg`), ASCII `[a-z0-9-]`, no personal data, number from `frame_number` (3 digits, 4 if above 999).
5. `fflate` `Zip` + `ZipPassThrough` in parts of `frame_part_size` (default 100), each part downloaded as it completes (`ssw-<slug>-frames-part-1-of-2.zip`); the browser may ask to allow multiple downloads, and the page says so.
6. The **index CSV** (browser-built through `csvCellSafe()`): `file_name, frame_number, stuffy_name, parent_last, parent_first, window, produced, photo_consent`, sorted for the pickup table (parent last name, then stuffy). `produced` is `yes`, or `no: <reason>` for fetch/render failures and hidden or missing portraits. A part is never presented as complete when frames are missing; the summary reads "132 of 138 done. 6 failed: [names]. Retry failed."
7. After the run, `POST frames/exported` with only the produced items.

Memory per 100-frame part is about 70 MB of JPEG blobs (*estimate from 500 to 800 KB per frame, unmeasured*); a 200-stuffy run on a laptop is timed in the dry run with 10 real and 200 synthetic frames (check L11).

## Collage and family pages

Both are Server Components, `export const dynamic = 'force-dynamic'` (they read the database on every request; there is no static or ISR cache, so HTML never outlives a hide), `metadata.robots = noindex, nofollow`, never in `sitemap.ts` or `robots.ts` (DECISION-118), headers in the next section.

- **Collage** `c/[token]` (`collage-queries.ts`): look up `sw_sessions` by `collage_token`. States, each a distinct rendering: `unavailable` (no such token; identical 404 page), `pending` (not published: "The photos arrive on [date]", 200), `removed` (public purge done: "These photos have been removed", 200), `live`. Live content: published, unhidden group photos by `taken_at`, then current, unhidden portraits **whose stuffy has `photo_consent`**. The DTO carries photo ids only: **no stuffy names, no captions, no counts per family**. Images are `/api/santas-workshop/photos/[id]?v=thumb` with `loading="lazy"` and `decoding="async"`; a tile that errors shows a placeholder (the page text and consent logic come from the database, so a Drive outage degrades tiles, not the page). Tap opens the `full` variant in-page; no download button. Footer: "Want a photo removed? Email info@westervillelions.org" (club-domain address, allowed). Practice sessions: PRACTICE banner.
- **Family** `f/[token]` (`family-queries.ts`): token to stuffy to session. Shows the stuffy's own name, current unhidden portrait (any consent), a link to the collage, the thank-you and beneficiaries lines (prose in components; the beneficiaries sentence comes from `WORKSHOP_2026`), a "Download portrait" link, and a **print stylesheet** (`@media print`: hide navigation and buttons, large portrait, `@page` margin). States mirror the collage; a hidden portrait shows "This photo isn't available". The check-in photo never appears here.
- **Cache behavior:** page responses are dynamic and not cached; image responses `private, max-age=300`. That is the accepted 5-minute window.
- The family QR on the worker's phone is drawn client-side from `familyUrl` (built on the server with `getAppUrl()`), only after the pickup write succeeds.

## Headers (`next.config.ts`)

Build both Permissions-Policy strings from one function so they cannot drift: `permissionsPolicy(camera: '()' | '(self)')` returns the existing string with only the camera token varying (all other directives unchanged, `microphone=()` stays). Rules, in order:

1. existing `/(.*)` rule (`camera=()`, `Referrer-Policy: strict-origin-when-cross-origin`);
2. `{ source: '/santas-workshop/crew/:path*', headers: [Permissions-Policy camera=(self), Referrer-Policy no-referrer, X-Robots-Tag noindex] }`;
3. `{ source: '/santas-workshop/c/:token', ... }` and `{ source: '/santas-workshop/f/:token', ... }` with `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`;
4. `{ source: '/api/santas-workshop/:path*', headers: [X-Robots-Tag noindex] }`.

Per the Next 16 `headers` doc as read by the architect, the last matching rule wins for the same key, so rules 2 to 4 follow the global rule. The unit test simulates last-wins (it encodes our reading of the doc); **the measurement is Phase 5 check L5** (`curl -I` on the crew path, a token path, and `/santas-workshop`, on the dev server and on the production build). CSP is unchanged: `img-src` already allows `blob:`, `worker-src 'self' blob:`, and same-origin `connect-src` covers uploads; no `frame-src`/`script-src` change (QR libraries are bundled, not CDN).

## Retention and purge (`retention.ts`, `purge.ts`)

`defaultRetention(pickupDate)` returns `{ personalOn: pickup + 30 days, publicOn: Jan 31 of the next year }` as Eastern date strings; the admin can edit both on the session. Eligibility is computed on the **server** from `easternDateString(now) >= purge_*_on` and `status = 'closed'`, not by a disabled button. Two phases (both ConfirmDialog with the counts that will go):

- **Personal phase:** delete check-in photos and superseded retakes from the store (`delete` 404 is success), then set `purged_at` and null the keys per photo; once no photo of the phase remains, one transaction nulls `sw_orders` buyer fields and `buyer_answers`, `window_label_raw`, `manual_reason`; `sw_stuffies` `child_first_name`, `care_note`, `note_to_santa`, `snack`, `raw_answers`; `sw_stuffy_events.note`; `zeffy_events.payload` for the session; and writes `purge_step`/`purge_done` log rows with counts. **Tombstones kept:** Zeffy payment id, item key, tag code, state stamps, stuffy name and description, so a stale Sync cannot resurrect people (a re-applied payment for a purged order is refused with `purged_order`).
- **Public phase:** delete portraits, group photos and thumbs; the collage and family pages then show "removed".
- Each request is time-boxed to about 30 s and returns `{ done, remaining, deleted }`; the client loops with a progress bar. Drive-first-then-row ordering makes a crash safe to resume.
- **Practice reset** is the same engine, available only when `kind = 'practice'` (server-checked), immediate, and then deletes the order, stuffy, event and photo rows (config and Zeffy mapping stay; a later Sync can bring the practice payments back).
- Deleted rows may persist in Neon restore history and Workspace trash/retention for a while (*believed, unmeasured*): the privacy copy says "we will take it down", not "erased everywhere". The reminder to run the purge is the orchestrator's.

## Admin UI plan

Pages under `src/app/(dashboard)/admin/santas-workshop/` (each `auth()` + `hasFeature()` then `redirect('/access-pending')`; Server Components fetch, client islands act):

| Page | Content |
|---|---|
| `page.tsx` | sessions list; red storage banner; New session |
| `new/page.tsx` | form pre-filled from `WORKSHOP_2026` (dates, windows); kind chosen here and immutable after |
| `[sessionId]/page.tsx` | **go-live checklist** (campaign connected, N ticket rates marked, required fields mapped, webhook secret and API key set (booleans only), last valid Zeffy event with an amber state when sales are recent, storage tested, worker code issued, Friday-morning Sync done); counts by state and by window; needs-attention and refund badges; worker access card (show code, copy, rotate, pause); status buttons; "Close and purge" with eligibility dates and counts; practice reset |
| `[sessionId]/connect/page.tsx` | campaign picker, ticket-rate marking, question-string assignment, Sync, Remap, recent events with Reprocess |
| `[sessionId]/registrants/page.tsx` | filters; flags; manual add (phone-usable); withdraw, revert, dismiss, refund Keep; awaiting-pickup CSV |
| `[sessionId]/photos/page.tsx` | group photo and portrait review grids, hide/unhide, Publish/Unpublish, Check storage |
| `[sessionId]/frames/page.tsx` | frame export (above) |

Components in `src/components/admin/santas-workshop/`. `admin-page-feature-gates.test.ts` already covers the top-level directory; the scan test below also covers the API tree.

## Dev and test story

- **No live Zeffy or Drive anywhere in Vitest or Playwright.** Memory adapter under `NODE_ENV=test`; the dev server (e2e) uses the local adapter because `SW_PHOTO_STORE` is unset.
- **Fixtures** `src/lib/zeffy/__fixtures__/*.json`: synthetic or S2-redacted payments (`example.invalid` addresses, fake names, fake UUIDs); a unit test fails the build if any fixture holds an `@` outside `example.invalid`/`example.com` or a phone-shaped digit run.
- `scripts/zeffy-webhook-fixture.ts`: signs a fixture with a made-up `whsec_dev...` secret (`signZeffyBody`) and POSTs it to localhost. `scripts/zeffy-replay.ts`: replays rows from the **dev** database `zeffy_events` (refuses when `PROD_DATABASE_URL` is set, so it cannot replay production data to localhost). `scripts/spike-drive.ts` (S1) and `scripts/spike-zeffy.ts` (S2a: `GET /payments?campaign=` for the allowlisted practice campaign, writes a redacted fixture; refuses a campaign not in the allowlist).
- Dev and preview never receive real Zeffy events (one webhook URL per organization). `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` is mandatory for any non-production Zeffy call.
- Hermetic DB tests use the `vi.mock("@/lib/db")` harness style of `ledger-approval-decision.test.ts`; database-enforced properties (partial unique indexes) are checked by schema/migration scans in Vitest and by live checks on a real Neon branch in Phase 5 (L7).

## Implementation order (specialist split; each slice shippable)

**Calendar** (hard dates: registration opens **Sun Nov 8**, form must be connected and mapped before then; real registrants needed for tagging by about **Dec 1**; dry run the week of **Dec 7**; "working" target **Dec 5**; drop-off Fri Dec 18). Increment 1 lands first; this increment's worktree rebases onto it before its first deploy (Ruling 6).

| Slice | Window | Contents | Ships to production |
|---|---|---|---|
| **S0 spikes** | Oct 13 to 16 | S1 Drive, S2a Zeffy fetch, S3 browser (below) | no |
| **1 Ingest and sessions** | by Oct 30, deployed by Nov 5 | schema + both migrations, permission + nav, `src/lib/zeffy/`, webhook route, consumer, mapper, apply, sessions admin (list, new, overview, Connect, Sync, Reprocess, registrants read-only) | yes (needed before Nov 8) |
| **2 Dry-runnable core** | by Nov 20 | `PhotoStore` + adapters, crew auth/cookie/throttle, roster, scan, tag, check-in, portrait, group photo, pickup, outbox, admin registrants actions, manual add, storage test/check, code management, Permissions-Policy rule | yes |
| **3 Collage** | by Nov 27 | photo door complete, admin photos page, publish, collage page | yes |
| **4 Frames** | by Dec 4 | manifest, browser export, zip, index CSV, exported marking | yes |
| **5 Family page and retention** | by Dec 10 (family page is the first cut) | family page, print stylesheet, purge/reset engine and UI | yes |

**Spikes (day 0; nothing below may be assumed before its spike):**
- **S1 Drive** (`scripts/spike-drive.ts`; needs the user): service-account key creation, membership of the shared drive (the Workspace external-sharing setting may block it), which shared-drive role permits permanent `files.delete` (Contributor is believed not to; Content manager is believed to; *unmeasured*), create into a hand-made folder under the chosen scope, upload and download latency for 1 MB, cold-start cost of `import('googleapis')`. Fallback if blocked: dedicated-user OAuth token with `drive.file` (Ruling 4), `getDriveAuth()` is the only seam.
- **S2a Zeffy** (`scripts/spike-zeffy.ts`; the user creates the practice form, makes one real test purchase of two tickets in one order, then a partial refund): redacted fixture; exact question strings and answer shapes (checkbox `false` versus absent; select arrays); whether `Item.id` is stable across an order edit (Ruling 5); whether list items carry `items[]` and `questions[]`; `status` values; what a partial refund does to `items[]`; whether `GET /campaigns/{id}` lists questions (Ruling 18); the exact consent-affirmative strings. **S2b** (after Slice 1 deploys, on the practice form): delivery latency, whether a $0 ticket fires `payment.completed`, the `payment.updated` id-only shape for a refund, and whether more than one webhook URL can be set. If the payload lacks per-ticket answers or no API key can be issued, the contingent CSV adapter maps into `PaymentSnapshot` (about half a day).
- **S3 Browser** (needs a real iPhone and an Android phone and the real stickers): `camera=(self)` effective on the crew path; `BarcodeDetector` availability; `jsqr` decode rate on the real stickers (swap criterion for `zxing-wasm`); `<input capture>` behavior and page reload on return in iOS Safari; `getUserMedia` inside the page; IndexedDB blob survival across an airplane-mode reload; whether the sticker encodes a vendor URL (native-camera trap).

**Slice order inside the specialist split:** database-admin (schema, both migrations, schema/migration tests, `.gitignore`) then api-developer (libs, routes, carriers, all server-side unit tests, scripts) then ux-developer (admin pages, crew app, collage/family pages, frame export UI, client-logic tests, e2e), repeated per slice; `src/lib/zeffy/` and the consumer are api-developer from Slice 1. Step list per slice follows the template: (1) schema, (2) permission (`/add-permission`, then `default-role-bundles.test.ts` and the nav), (3) routes with `auth()` + `hasFeature()` / `requireCrew()`, (4) UI (Server Components by default, brand rules, ConfirmDialog), (5) no email, (6) release-notes entry via `/release-notes` at ship time.

**Phase 4/5 isolation (CLAUDE.md, Concurrent Pipelines item 5):** this pipeline adds migrations, four dependencies (`package.json` and lockfile), and edits `next.config.ts`. It runs in an `isolation: "worktree"` with its **own Neon branch** for the dev database and its own `.env.local` copy (own `AUTH_SECRET`, `SW_PHOTO_STORE`, `GOOGLE_DRIVE_*` pointing at a dev folder, `ZEFFY_DEV_CAMPAIGN_ALLOWLIST`, a made-up `ZEFFY_WEBHOOK_SECRET`; never the production `RESEND_API_KEY`; the dev `EMAIL_DEV_ALLOWLIST` stays empty because nothing here sends mail). Neon free-plan note: dev-branch data counts against the project limit, which is another reason bytes stay in Drive. The orchestrator owns the `:3000` dev server and announces schema-change restarts. Re-derive migration numbers at Phase 4 start.

## Unit tests (named; the Phase 4 implementer delivers and passes every one)

Colocated `*.test.ts` under `src/lib/**` and `src/components/santas-workshop/**` (pure modules, node environment).

**`zeffy/signature.test.ts`:** accepts a correctly signed body; rejects a body altered by one byte; rejects a header with no `v1`; rejects non-hex and wrong-length `v1` without throwing; rejects a timestamp 301 s old and 301 s in the future; accepts 299 s old; accepts when any one of repeated `v1` values is valid; rejects a non-integer `t`; signs raw bytes so a re-serialized JSON body fails; calls `timingSafeEqual` only after the length check; a replay inside tolerance still verifies (dedupe is the handler's job, asserted in the handler test).
**`zeffy/snapshot.test.ts`:** drops address, receipt URL, payment method, dispute, discount; tolerates unknown extra fields; missing `id` or `status` is `invalid`; refunded sum counts succeeded refunds only; `itemKey` default and `#index` fallback; caps long answers; boolean, array and string answers all normalize.
**`zeffy/client.test.ts`** (injected `fetch`): bearer header present; `listPayments` throws without a campaign; pagination follows `next_cursor`; 429 honors `Retry-After`; non-production refuses a non-allowlisted campaign without issuing the request; payments of other campaigns are discarded; 404 returns `{ gone: true }`; the key never appears in a thrown message.
**`zeffy/webhook-handler.test.ts`** (in-memory event store): bad signature returns 400 and writes nothing; stale timestamp 400; body over 256 KB 400; malformed JSON after a valid signature 400; a `processed` duplicate returns 200 without calling the consumer; a `failed` duplicate calls the consumer again; a `received` (crashed) duplicate calls it again; consumer retryable failure returns 500 and stores `failed`; permanent failure returns 200 with the outcome; `payment.created` and `contact.updated` are `ignored_type`; an unmapped campaign stores ids and times and a null payload; missing secret returns 500 and processes nothing; response bodies are identical across all 400 causes.
**`santas-workshop/question-fields.test.ts`:** normalization table (case, NFKC, whitespace, trailing `*`, `:`, `?`); consent interpretation table (true, false, absent, "Yes", "yes ", unrecognized); `answerToText` for string, number, boolean, array.
**`santas-workshop/payment-mapper.test.ts`:** single ticket maps all fields; three-ticket order yields three stuffies, each with its own answers and buyer fields shared; donation and additional-donation items never become stuffies; ticket with an unmarked rate is ignored; unmatched question sets `unmapped_question` and keeps the raw text; missing name shows "Unnamed stuffy, order of 3" and `missing_name`; consent absent, false and unrecognized are all false; consent "Yes" is true; window matches by normalized label; unmatched window sets `unmapped_window`; a buyer field found in the ticket scope still maps (fallback); two question strings map to one field; a 5,000+ character care note truncates and sets `truncated`; HTML in a name is stored verbatim as text; `pending` and `failed` statuses produce no registrants; full refund and `payment_deleted` produce the worker refund badge, partial produces the admin flag and no stuffy badge; `refundOpen` returns false after Keep and true again when `refunded_cents` grows; the mapper performs no IO.
**`santas-workshop/payment-apply.test.ts`** (mocked db): advisory lock is the first statement in the transaction; an older `fetchedAt` than `snapshot_at` is refused (a late retry cannot un-refund); unseen payment applies the embedded payload; known payment path requires a fetched snapshot; re-applying an identical snapshot writes nothing; SET lists contain no worker-owned column (source scan of the file for `state`, `tag_code`, `frame_`, `withdrawn_`, `family_token`, `*_at` state stamps); a missing item gets `not_in_order_now` and is not deleted; wrong-campaign mapping (no marked rate) creates nothing; session mismatch returns `failed session_mismatch`; a payment for a purged order is refused; `deleted` for an unseen payment stores nothing; the Zeffy HTTP call occurs outside the transaction (call-order assertion).
**`santas-workshop/state-machine.test.ts`:** each legal forward move; every illegal pair (including `tagged` to `picked_up`, `registered` to `checked_in`); pickup allowed from `checked_in` and `portrait_taken` only; nothing leaves `picked_up` except admin revert; `canRevert` is false for crew on a real session and true on practice.
**`santas-workshop/stuffy-transitions.test.ts`** (mocked db): same idempotency key returns the stored result with no second insert; stale `expectedState` returns 409 with current state and time; a concurrent duplicate (`23505` on the idempotency index) replays instead of 500; a zero-row pinned UPDATE throws the sentinel and rolls back, and the caller returns 409 (assert the throw, not a `return`); a retake supersedes the old portrait before inserting the new one; check-in without a photo records a flagged state; a second pickup with a different key returns `already_picked_up` with the time; pickup without a prior `pickup-check` returns `pickup_check_required`; pickup is allowed with no portrait, with an open refund and when the store is down; a withdrawn stuffy returns `withdrawn`; a stuffy of another session returns 404; admin actor records device `admin` and user id, crew actor records device and code version and no user; revert to `registered` clears the tag code with a retire event.
**`santas-workshop/tag-binding.test.ts`:** one test per row of the collision table (unbound bind; same stuffy no-op with no history row; other `tagged` returns `confirm_move` with the other name; confirmed move writes both events and returns the holder to `registered`; other `checked_in` returns `holder_advanced`; different existing code returns `confirm_replace` with last 4; replaced code scans as `retired`; code bound in another session returns a body byte-identical to unbound; concurrent bind `23505` returns the typed already-bound path); code normalization (trim, 200-character cap, control characters rejected); a scanned URL is stored verbatim and no DTO field is a link; identical-text stickers collide on the second bind and show last 4.
**`santas-workshop/crew-cookie.test.ts`:** sign/verify round trip; tampered payload rejected; tampered signature rejected; wrong session rejected; old code version rejected; expired rejected; cookie name is per session; `Secure` and `__Host-` only in production; derived key differs from the NextAuth secret; comparison is constant-time.
**`santas-workshop/crew-auth.test.ts`:** valid cookie returns crew; no cookie plus admin with the key returns admin; no cookie plus member without the key is denied; cookie for session A against session B's slug is denied; paused, closed and past `crew_closes_on` (Eastern string compare, boundary day inclusive) are denied for crew; admin bypass works while paused, closed and draft; `reason` appears only with a valid signature, otherwise every denial body is byte-identical.
**`santas-workshop/crew-code.test.ts`:** alphabet excludes `0 O 1 I L`; length at least 8; encrypt/decrypt round trip; same code encrypts to different ciphertexts; wrong key fails; entry normalization (case, spaces, hyphens); decrypt failure surfaces as "regenerate", not a crash.
**`santas-workshop/crew-throttle.test.ts`:** the 5th failure from one IP blocks the 6th even with the right code; another IP is unaffected; 30 session-wide failures block all IPs; success does not clear counts; a request carrying a valid cookie never calls the throttle; the stored scope key contains no raw IP; the sweep deletes rows older than 2 days; an unknown slug counts against the IP; wrong, revoked, paused, closed and unknown-slug answers are byte-identical, and only a block adds "Wait a few minutes".
**`santas-workshop/photo-store/contract.test.ts`** (memory and local): put/get round trip; put is idempotent per `(folder, photoId, variant)`; get of a missing key is `null`; delete of a missing key succeeds; list pages; `ensureFolder` is idempotent; `ping` ok; the local adapter rejects path traversal.
**`santas-workshop/photo-store/drive.test.ts`** (fake drive client): `put` sends `supportsAllDrives`, the parent, `appProperties.photo_id` and a multipart media body; `attempt > 1` looks up by `appProperties` and returns the existing key without creating; `get` 404 returns `null`; `delete` 404 succeeds; 5xx is retried once then `StorageUnavailable`; `invalid_grant` is `StorageMisconfigured`; `storageQuotaExceeded` is `StorageFull`; 429 is `StorageRateLimited`; config parse accepts the minified JSON and rejects a missing `client_email`; production with no config throws and never returns local or memory; `NODE_ENV=test` returns memory; development defaults to local; development with `SW_PHOTO_STORE=drive` returns Drive; no thrown message contains `private_key` text.
**`santas-workshop/jpeg-header.test.ts` and `photo-limits.test.ts`:** JPEG accepted; PNG, truncated and zero-length rejected; SOF0 and SOF2 dimensions parsed; dimensions above the pixel cap rejected before anything else; header dimensions must equal metadata; per-kind byte caps; combined body over 2 MB rejected; limits are imported from one module by both the downscaler and the validator.
**`santas-workshop/photo-access.test.ts`:** the full matrix of the table above, table-driven (viewer x kind x variant x published x hidden x consent x superseded x purged x session), asserting an allow only where the table says allow and **status 404, never 403**, everywhere else; crew cookie of another session; family token against another stuffy's photo.
**`santas-workshop/collage-queries.test.ts`:** includes consented, unhidden, current portraits and published, unhidden groups only; excludes non-consented, hidden, superseded, check-in; the DTO carries no name, caption or family count; unpublished returns `pending` with the date; public purge returns `removed`; unknown token returns `unavailable`; a malformed token returns the same `unavailable` without a query.
**`santas-workshop/frame-layout.test.ts`:** every rect lies inside the 75 px safe margin; QR module size is an integer of 7 or more; plate includes a 4-module quiet zone; no rects overlap; cover-crop math for 3:4, 4:3 and square sources; caption fit-shrink reaches a floor then truncates; art size other than 1200 x 1800 is rejected.
**`santas-workshop/frame-names.test.ts`:** `ssw-<slug>-NNN.jpg`; pads to 4 digits above 999; a custom prefix is sanitized to `[a-z0-9-]`; names are unique and contain no personal data.
**`santas-workshop/frame-numbering.test.ts`** (mocked db): first allocation is ordered by parent last name, stuffy name, id; re-running keeps existing numbers; a late portrait gets `max + 1`; a `23505` race retries once and yields unique numbers; a retake keeps its number; hidden portraits are excluded and listed; opted-out stuffies are included; stuffies without a portrait are listed; `sinceLastExport` compares portrait id to `frame_exported_photo_id`; `exported` marks only produced items.
**`santas-workshop/jpeg-dpi.test.ts`:** sets units 1 and density 300 x 300 on an existing JFIF segment; inserts one after SOI when absent; leaves entropy-coded bytes byte-identical; idempotent; non-JPEG throws.
**`santas-workshop/zip-parts.test.ts`:** 250 files split 100/100/50; each part unzips with `unzipSync`; entries are stored uncompressed; names preserved and unique; failed items are excluded and reported; an empty list produces no parts.
**`santas-workshop/csv-index.test.ts`:** a leading `=`, `+`, `-`, `@`, tab or CR is neutralized through `csvCellSafe`; quotes and newlines in names are escaped; `produced` values; pickup sort order.
**`santas-workshop/retention.test.ts`:** `defaultRetention` dates; eligibility is server-computed and Eastern-string based, per phase, and requires `closed`; practice reset on a real session is refused; purge returns `done: false` with `remaining` when time-boxed; a store `delete` 404 is success; database nulling happens only after zero photos remain; tombstones (payment id, item key, tag code) survive; the audit row holds counts and no personal fields; a purged order refuses re-apply.
**`santas-workshop/session-checklist.test.ts`:** each checklist item's state (including amber "no event in 24 h while sales are recent" and the Friday Sync item on drop-off day).
**`santas-workshop/origin.test.ts`:** `isProductionOrigin` for production, localhost, an IP, `*.vercel.app`; a real session's manifest is refused off-production and on a preview `VERCEL_ENV`; a practice session is exempt.
**`santas-workshop/session-schema.test.ts`** (model `ledger-approval-schema.test.ts`): every `sw_` table name and every derived FK name is at most 63 characters; migration `0113` uses only `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` and `pg_constraint`-guarded FKs (no bare `ADD COLUMN`); FK names equal what drizzle derives; each partial unique index exists in both `schema.ts` and the SQL with its `WHERE`; no `bytea` column in `sw_photos`; no `check(` or `pgEnum` in the new tables; the migration contains no `@` address; `PATCH` validator rejects `kind` and `slug`.
**`permissions.test.ts` additions:** the key and description are byte-identical in `FEATURE_DESCRIPTIONS` and migration `0114`; the nav entry carries the single key; `default-role-bundles.test.ts` covers the new binds (admin, board_member, and not treasurer or member).
**`zeffy/fixtures-no-pii.test.ts`:** every fixture under `__fixtures__` and the workshop test fixtures is clean.
**Client logic (pure, node):** `outbox-core.test.ts` (writes before sending; retries with the same photo id and a rising attempt count; at most 2 in flight; FIFO; survives re-open of the storage and reports the pending count; `storage_misconfigured` stops auto-retry; `stale_state` parks the item; 401 holds the queue; no duplicate enqueue of one photo id); `scan-loop.test.ts` (two identical decodes required; over-long text ignored; repeat debounce; native-versus-jsqr selection by feature detection); `photo-downscale.test.ts` (per-kind dimensions, quality ladder, never upscales, thumb dimensions).

**Source-scan tests (build-failing):**
- `crew-routes-gate.test.ts`: every `route.ts` under `src/app/api/santas-workshop/crew/` imports and calls `requireCrew` before any body read or `db` use; the only exception is `enter/route.ts`, which must call the throttle and the code verifier; the exception list is asserted to equal exactly that one file.
- `admin-routes-gate.test.ts`: every `route.ts` under `src/app/api/admin/santas-workshop/` calls `auth()` then `hasFeature(` with `SANTAS_WORKSHOP_MANAGE`, in that order, before any body read or `db` use.
- `photo-door.test.ts`: the store's `get`/read method appears only in `photo-access.ts`; the importer set of `photo-store` equals an explicit allowlist (access, upload, purge, storage check, admin storage test, scripts); no route file references `storageKey`/`thumbStorageKey` except the allowlisted modules; no response mapper includes them.
- `no-drive-sharing.test.ts`: no `permissions.create`, `anyoneWithLink`, `webViewLink` or `webContentLink` anywhere in `src/`.
- `permissions-policy.test.ts`: imports the default export of `next.config.ts`, calls `headers()`; the global rule has `camera=()`; the `/santas-workshop/crew/:path*` rule exists after it with `camera=(self)`; both strings are equal apart from the camera token (microphone, geolocation, payment unchanged); no other source sets `camera=(self)`; token paths and `/api/santas-workshop` set their referrer and robots headers after the global rule; a simulated last-wins resolution gives `camera=(self)` for `/santas-workshop/crew/x` and `camera=()` for `/santas-workshop`.
- `webhook-route-source.test.ts`: the route reads `arrayBuffer()` before any `json()`; has no `auth(` import; `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`; does not import `test-helpers`.
- `secrets-not-logged.test.ts`: no `console.*` call or template string in `src/lib/zeffy/` or `photo-store/` interpolates `ZEFFY_API_KEY`, `ZEFFY_WEBHOOK_SECRET`, `private_key` or a request body.
- `crew-contract-no-contact.test.ts`: crew DTO types contain no `email`, `phone`, `mobile`, `zeffy*` identifier, and `parentName`, `snack`, `careNote`, `noteToSanta` appear only in the view DTOs the table above names.
- `consumer-injection.test.ts`: `src/lib/zeffy/` imports nothing from `santas-workshop`.

## End-to-end specs (Playwright, serial, own practice session per spec, unique slug, reset at the end through the admin API)

1. `santas-workshop-admin-gate.spec.ts`: a signed-in member without the key is bounced from `/admin/santas-workshop`; admin and board member (after re-sign-in) can open it; nav entry visible only with the key.
2. `santas-workshop-webhook-to-roster.spec.ts`: create a practice session, map a fixture campaign through the admin API, POST a signed three-ticket fixture to `/api/zeffy/webhook`, see three stuffies on the admin registrants page, repost the same event (still three), post a bad signature (400, nothing new), post an unmapped-campaign event (nothing stored), open the crew app with the code and see the three rows with no parent contact in the page source.
3. `santas-workshop-crew-flow.spec.ts`: wrong code (uniform message), right code, tag by typing a code, move-confirmation on a duplicate, check-in with a generated JPEG through the file input (`setInputFiles`), portrait and retake (one current portrait), pickup refused before Confirm name then succeeds, second tap shows "Already picked up", closing the session blocks the crew and not the admin.
4. `santas-workshop-collage-consent.spec.ts`: publish; a consented portrait and a group photo appear; a non-consented portrait does not; hide returns 404 on a fresh fetch; the family page shows the non-consented portrait; check-in photos are never reachable anonymously.
5. `santas-workshop-frame-export.spec.ts`: export in the admin page, capture the downloads, unzip with `fflate` in the test, assert file names, count, JFIF density 300, index CSV `produced` column, and that the QR text equals the collage URL.
6. `santas-workshop-reset.spec.ts`: practice reset empties the session; the same request on a real session is refused.

Camera, live QR decoding and Drive are manual dry-run items (below), not e2e.

## Phase 5 live checks (accepted residuals name a measurement)

| # | Residual or property | What QA records |
|---|---|---|
| L1 | Wrong-code guessing | attempts until the first block from one IP (expect 5), that an already-signed-in device keeps working during the block, and that the per-session cap blocks a second IP |
| L2 | Rotation, pause and close take effect on the next request | requests served after each action (expect 0) and elapsed time |
| L3 | Hidden photo visible up to 5 minutes in a loaded browser (accepted by the user) | seconds until a fresh fetch returns 404 (expect immediate) and seconds a browser with a cached copy keeps showing it (expect up to 300) |
| L4 | Token pages | number of distinguishable responses for unknown, malformed and expired tokens (expect 1); purged and unpublished are distinct 200 pages by design |
| L5 | Permissions-Policy last-wins | `curl -I` result for the crew path, a token path and `/santas-workshop` on the dev server and the production build |
| L6 | Cross-session IDOR | a cookie for session A against session B's stuffy, photo and tag ids on every crew route: count succeeded (expect 0 of N, record N) |
| L7 | One current portrait | a second current insert on a real Neon branch fails `23505`; 20 parallel retakes leave exactly one current |
| L8 | Forged, stale and replayed webhooks against the deployed route | counts of 400 and of duplicate no-ops |
| L9 | Contact leakage to crew | a crawl of every crew response for a fixture session seeded with sentinel email, phone, Zeffy id and note strings: occurrences (expect 0 outside the named view DTOs) |
| L10 | Drive delete role | the role under which permanent delete succeeded (S1) |
| L11 | Frame export load | wall time and peak memory for 10 real and 200 synthetic frames on the chair's or a similar laptop |
| L12 | Weak signal | duplicate Drive files created across airplane-mode toggles mid-upload (expect 0 after the attempt-header lookup) |
| L13 | Origin guard | real-session manifest refused on a preview deployment |

**Dry-run checklist the analyst checks in Phase 6:** real stickers and S3 numbers; iOS and Android; real IHOP signal; a low-light portrait; a frame zip uploaded to the chosen photo service (file-name, size, orientation and batch rules learned and entered as session settings); a retake; a refund after tagging; a late Sync; a pickup by someone other than the named parent; a deliberately broken storage config on a preview watching the outbox drain; "Test storage"; a stuffy name with emoji on a frame.

## Edge cases and risks

- **Webhook death is silent.** Mitigation is visibility: last valid event shown on the checklist and the session list, amber when sales exist but no event arrived in 24 h, and the Friday-morning Sync on the checklist. Whether Zeffy's retry window (3 days) covers every outage is from the OpenAPI text, not measured.
- **Secret rotation** invalidates the old secret at once; deliveries 400 until the env var changes; Sync closes the gap (runbook line).
- **Zeffy rate limit** (100 per minute, shared by webhook fetches and Sync): sequential, 700 ms spacing; a 300-payment Sync is about 3 minutes of budget if S2 shows the per-payment fetch is required.
- **Org-wide webhook:** every White Cane gift reaches the endpoint; unmapped payloads are discarded unread after the campaign check; `updated` for an unknown payment costs one fetch whose body is held in memory only.
- **Hostile text** from the form: stored as text, capped, React-escaped, `fillText` on frames, formula-neutralized in CSV. Bidi controls stripped from captions.
- **Two workers binding one sticker, two taps on Save, a delayed retry:** idempotency key + `FOR UPDATE` + pinned UPDATE + unique indexes (L6/L7 measure the database half).
- **Drive:** a service-account key is a credential in one env var (never logged; scan test); shared-drive members can open every file including check-in photos, so membership is the integration identity plus one or two admins (Ruling 4); a Workspace admin deleting a file produces a "missing file" row that Check storage lists and the access door answers 404.
- **Unsent photos live only on a volunteer's phone** during a long outage ("keep this page open, do not clear browser data"); a stuffy whose portrait never arrives is handed over with the no-portrait warning. Tell the chair.
- **iOS Safari may purge IndexedDB after 7 days idle** (*believed, unmeasured*); the outbox only needs to survive a weekend.
- **Edge: crew cookie expires mid-line** (72 h absolute from entry; a worker who entered Wednesday loses access Saturday): the app returns to code entry while the outbox holds uploads. Chair guidance: enter the code on the day.
- **`AUTH_SECRET` change** makes the stored code unreadable and kills all crew cookies: regenerate the code.
- **Frame orientation** is 1200 x 1800 per the spec; if the photo service wants landscape or another size it is a code change in `frame-layout.ts` (the pure module keeps it a one-file change).
- **Deleted/purged data in provider history** (*believed, unmeasured*).
- **Pickup name check is a recorded human step**, not a string comparison; a worker can click "matched" falsely. Accepted residual on a pickup-authorization control; Phase 5 check: the event row exists for every pickup (count pickups without a `pickup_check` event, expect 0).
- **Search by parent name** lets a code holder confirm that a name exists in the session (3+ characters, 10 rows). Accepted residual on the contact-privacy invariant; L9 records leakage of the parent name outside the tag and pickup-check responses (expect 0).
- **Increment 1 dependency:** this work needs `src/lib/eastern-date.ts` and `WORKSHOP_2026` from increment 1; the worktree rebases onto it before the first deploy.

## Out of scope (confirm with the user)

Email or SMS to families; a CSV import (contingent adapter only if S2 triggers it); a book/PDF/print API; editing Zeffy-sourced fields in admin; flipping the public page to the session row; admin frame-art upload; live photo updates during Saturday; per-stuffy social sharing; worker identity; a typed parent-name comparison; automatic purge (no cron; the reminder is the orchestrator's); pruning `zeffy_events`; the train-ticket receipt.

## Release-notes draft (no version number; `/release-notes` assigns it at ship time)

Santa's Workshop events can now be run end to end from the website. Registrations from the club's Zeffy form arrive automatically, volunteers use a phone app (with a shared event code, no club login) to tag, check in and photograph each stuffy and hand it back, and the admin can review photos, publish a public collage, export print-ready 4x6 frames, and clear personal data after the event. Practice sessions let the club rehearse without touching real data.

## For the orchestrator (not edited by tech-lead this hour)

**Env vars to add to CLAUDE.md** (production Vercel and local `.env.local` only; never the repo):

| Variable | Purpose |
|---|---|
| `ZEFFY_WEBHOOK_SECRET` | `whsec_...` from Zeffy Settings, Integrations, Webhook; verifies deliveries; production only; dev uses a made-up `whsec_dev...` |
| `ZEFFY_API_KEY` | bearer key (organization owner generates it); needed for `updated`/`deleted` handling and Sync |
| `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` | comma-separated campaign ids a non-production process may read; unset means no Zeffy call |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | service-account key file minified to one line (`jq -c . key.json`) |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | the private shared drive |
| `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` | root folder (per environment; dev points at a dev folder) |
| `SW_PHOTO_STORE` | development only: `drive` to use Drive, anything else uses `.santas-workshop-store/`; ignored in production |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` (existing) | now also derives the crew-cookie key and the worker-code encryption key; changing it forces a code regeneration |
| `NEXTAUTH_URL` (existing) | must be the production origin in production: it is the host baked into printed frame QR codes |

**CLAUDE.md edits to make when this ships:** Project Structure (`santas-workshop/` now holds `c/`, `f/`, `crew/`; `api/zeffy/`, `api/santas-workshop/`, `api/admin/santas-workshop/`; `src/lib/zeffy/`, `src/lib/santas-workshop/`); Key Features entry for the workshop; Integrations → Zeffy (webhook + API; and the note "Zeffy 403s server-side fetches, do not scrape" applies to `www.zeffy.com` pages, not `api.zeffy.com`); Gotchas (camera Permissions-Policy is path-scoped; crew cookie is not NextAuth; Drive files are private and served only through `photo-access.ts`; `qrcode`/`jsqr`/`fflate` are dependencies); Key Invariants (the single photo door; the webhook is organization-wide so unmapped payments store nothing).

**Stale statements to fix (list only):** `docs/features/santas-workshop.md` §4 step 1 and Q11 ("CSV import"), §7 Order ("from the Zeffy CSV import"), §7 Photo ("bytes in Postgres"), §7 last bullet ("No Zeffy API exists", line 139) and §10 ("anything that needs a Zeffy API (there is none)", line 185), §3.3 ("QR link also goes in the email confirmation", analyst gap 1), §9a ("`event-facts.ts` stops being the source of truth once B-167 lands", superseded by the facts-seam ruling), the §11 build plan bullet 2 ("CSV import", "stored in Postgres"); `CLAUDE.md` Integrations → Zeffy and the Gotchas Zeffy line (above); backlog B-167 text (CSV, Postgres photos), B-120 (note that an API now exists), B-168 (rename to "family-page delivery by email, durable-claim path (DECISION-102/103); the family page itself shipped with B-167"); the Guardrails line in both Santa's Workshop work-log headers ("photos and registrant data live in Postgres": photos are in Drive, registrant data in Postgres); the sibling work-log's Phase 1 out-of-scope bullet ("Any Zeffy API, webhook or automatic registrant sync (none exists); CSV import is increment 2"); the Reserved IDs line (add the 125 reservation below).

**Proposed backlog text:** (1) consolidate the canvas downscale glue (`receipt-file-input.tsx` and `photo-downscale.ts`) if a third caller appears; (2) contingent CSV adapter into `PaymentSnapshot`, trigger "S2 shows no per-ticket answers or no API key can be issued"; (3) "Zeffy form vs our facts" consistency check from `GET /campaigns/{id}` (campaign dates and occurrences against the session); (4) prune old `zeffy_events` rows; (5) scheduled purge reminder or cron (no cron exists); (6) B-120 now unblocked by the shared `src/lib/zeffy/`.

## Proposed DECISIONs, ready to file

**Filed 2026-10-12 in `docs/decisions.md` (DECISION-121 to DECISION-125, newest first) by tech-lead after the sibling finished; the text there is authoritative (live checks are prefixed SW-L).** All `Status: Proposed` until Phase 6 (rule b). DECISION-120 is claimed by increment 1. 121 to 124 are the architect's reserved IDs; **125 needs a new reservation**.

### DECISION-121 (proposed): The worker credential is a session-scoped signed cookie re-checked against the session row on every request; photo bytes leave through one access module

**Status:** Proposed
**Decision:** Volunteers authenticate with a shared per-session code (8 unambiguous characters, stored AES-256-GCM-encrypted so an admin can re-read it, never in a URL, log or repo). Entry sets a signed `HttpOnly`, `SameSite=Lax` cookie bound to session id, code version, random device id and a 72-hour absolute expiry, using a key derived from `AUTH_SECRET` and distinct from NextAuth's. The cookie is not self-sufficient: `requireCrew()` re-reads the session row on every request (status, pause, code version, Eastern close date), so rotate, pause and close take effect on the next request. A holder of `santas_workshop.manage` bypasses the code in the same helper. Actions record device id and code version, never a person (the admin path also records the user id). Code entry is throttled in the database (per IP-hash and per session); requests with a valid cookie never consult the throttle. Crew DTOs never contain parent email, mobile, Zeffy ids or other sessions; parent name leaves the server only in the tag card and the `pickup-check` response, and pickup is refused until a `pickup-check` event exists. `src/lib/santas-workshop/photo-access.ts` is the only module that reads photo bytes; thin routes resolve a credential (admin, crew, family token, none) and every failure is 404. The crew path alone sets `Permissions-Policy: camera=(self)`.
**Accepted residuals (each with a Phase 5 measurement):** a leaked code is usable until rotated, paused, closed or 72 hours pass (L1, L2); a hidden photo stays visible up to 5 minutes in a browser that already loaded it (L3); pickup name matching is a recorded human step (pickup-without-check count, expect 0); parent-name search can confirm a name exists (L9).
**Enforced by:** source-scan tests (every crew route calls `requireCrew`; every admin route gates; only `photo-access.ts` reads bytes; `permissions-policy.test.ts`).

### DECISION-122 (proposed): Photo bytes live in a private Google shared drive behind a `PhotoStore` interface; the database keeps metadata only

**Status:** Proposed
**Decision:** For this feature only (DECISION-094 stands for Club Files), photo bytes are stored in an organization-owned Google Workspace shared drive, reached by a service account that is a member of that drive, through `PhotoStore` (`ensureFolder / put / get / delete / list / ping`) with Drive, local and in-memory adapters. `sw_photos` stores opaque `storage_key` / `thumb_storage_key` and `storage_kind`, never bytes. Files are never shared: no `permissions.*`, no web links, every read through the app. Production without Drive configuration fails hard; outside production Drive is opt-in (`SW_PHOTO_STORE=drive`). Uploads are single multipart requests of about 1.1 MB (a route handler, under Vercel's 4.5 MB body cap; the chunked protocol of DECISION-095 is not used). Upload order: store first (idempotent by photo id, retry looks up by `appProperties`), then one short transaction; no lock across a network call. Reason: production is on Neon's free plan (0.5 GB).
**Believed, unmeasured (S1):** the shared-drive role that permits permanent delete; the service account joining the shared drive; `googleapis` cold start; upload latency.
**Cost to swap back to Postgres:** one adapter over a new blob table, one migration, one resumable backfill; routes, UI, state machine and access module unchanged.

### DECISION-123 (proposed): Zeffy registrations arrive by signed webhook plus API fetch through a reusable `src/lib/zeffy/`; the CSV importer is deferred

**Status:** Proposed (supersedes the spec's "no Zeffy API exists")
**Decision:** `POST /api/zeffy/webhook` verifies `Zeffy-Signature` on the raw bytes (HMAC-SHA256 over `{t}.{body}`, constant-time, 300 s tolerance), logs the event id in `zeffy_events`, processes inline, and answers 2xx. Dedupe applies to terminal outcomes only; `received` and `failed` events re-run on retry. `payment.updated` and `payment.deleted` carry only an id, so the consumer fetches the payment and applies the fetched snapshot; a snapshot older than the stored one is refused. The webhook is organization-wide: an unmapped campaign is logged by ids and time only, no payload, nothing stored. Registrants are written by one function (`applyPaymentSnapshot`) shared by the webhook, "Sync from Zeffy" and Reprocess, serialized per payment by an advisory lock, import-owned columns only, never deleting. Questions are matched by admin-mapped normalized text. Non-production Zeffy calls require `ZEFFY_DEV_CAMPAIGN_ALLOWLIST`. The module is generic (consumers are injected) so B-120 can reuse it.
**Believed, unmeasured (S2):** `Item.id` stability, list responses including items and questions, `$0` tickets firing `completed`, delivery latency, a second webhook URL.
**Trigger to build a CSV adapter:** S2 shows no per-ticket answers, or no API key can be issued.

### DECISION-124 (proposed): Frames are composited in the admin's browser

**Status:** Proposed
**Decision:** 4x6 frames (1200 x 1800, 300 dpi tag) are drawn on a canvas in the admin's browser (portrait fetched through the photo door, art, `fillText` caption, QR from `qrcode` module data at integer pixels with a quiet zone on a solid plate) and zipped with `fflate` in parts of about 100. `sharp` is not added. No frames are stored, so there is no stale-frame state to track except `frame_exported_photo_id`. Frame numbers are persisted per stuffy so a re-export and a retake keep file names. Real-session QR URLs are refused off the production origin. A hidden portrait is withheld from frames; an opted-out portrait is not.
**Unmeasured:** laptop memory and time for a 200-stuffy run (L11).

### DECISION-125 (proposed, needs a new ID): Retention, visibility and the practice/real asymmetry for Santa's Workshop

**Status:** Proposed (chair/board to nod; Phase 1 recommended defaults)
**Decision:** Parent and child personal data and check-in photos are removed 30 days after pickup day; portraits and published group photos stay through January 31 of the following year (printed frames carry the QR for years), after which the collage shows "These photos have been removed". Purge is an admin action (no cron), eligibility computed on the server, resumable, Drive-delete first then row update; tombstones (payment id, item key, tag code) are kept so a stale Sync cannot resurrect people. Photo sharing is opt-in (absent or unrecognized means no) and governs only the public collage; group photos are unpublished until an admin reviews and publishes them, and any photo can be hidden at any time. A session's `kind` is immutable; only practice sessions can be reset, and only practice sessions allow a crew revert.

## Phase 3 handoff

## Phase 3 — Technical Design — 2026-10-12

**Owner:** tech-lead
**Status:** complete

### Summary
The design is above. Nineteen rulings amend Phase 1/2 where code, the Zeffy spec or the repo showed a better or truer shape (notably: `qrcode` is not yet a dependency; the worker code is encrypted, not hashed; webhook dedupe must not swallow retries of failed events; refund state is derived; hidden portraits are withheld from frames). All schema ships in one front-loaded migration pair; the build is five shippable slices behind three day-0 spikes, with Slice 1 (ingest, sessions, Connect) deployed before Registration opens on Nov 8.

### What I did
- Read the full work-log, the spec, the sibling facts-seam ruling, the club-file storage and download precedents, `google-groups.ts`, the image helpers, `permissions.ts`, the proxy, `next.config.ts`, the migration idiom, the ledger decision helper and its test harness, and the Zeffy OpenAPI extract.
- Specified tables, indexes and both migrations; the Zeffy module and the single write path; the `PhotoStore` and Drive adapter; the crew cookie, code and throttle; the pinned-write idiom with sentinel; the full API contract with carriers; the photo access matrix; the crew app; frame export; collage and family pages; headers; retention; admin pages; test and e2e lists; live checks; edge cases.
- Filed no DECISION, backlog item, CLAUDE.md or `package.json` edit; proposed text is above.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` and the Per-Phase Status row. Nothing else touched; nothing committed.
- Proposed DECISION-121 to DECISION-125 (125 needs a reservation), env-var list, CLAUDE.md and stale-statement lists, backlog text: above.

### Open questions / handoff notes
- **Implementers:** **database-admin** first (schema, `0113` and `0114` via `/add-permission`, schema tests, `.gitignore`), then **api-developer** (Zeffy module, consumer, mapper/apply, photo store, crew auth, transitions, routes, carriers, scripts, all server-side unit and scan tests) and **ux-developer** (admin pages, crew app, collage/family, frame export, client-logic tests, e2e), per slice, in that order. Do not use full-stack-developer: the contract is large and the UI is built on it (the minutes-browse precedent).
- **Worktree + Neon branch + own `.env.local` are required for Phase 4 and 5** (migrations, four dependencies, `next.config.ts`). Re-derive the migration numbers first. Implementers: read `node_modules/next/dist/docs/` for route handlers, `headers`, `maxDuration` and params-as-Promise before writing any route (the CLAUDE.md Next.js notice).
- **User/chair actions that gate the spikes:** create the practice Zeffy form (and say how to make a test purchase not charge a real card) and the real form before Nov 8; generate `ZEFFY_API_KEY` and the webhook secret (owner only); create the Google Cloud service-account key and the private shared drive, add the service account as a member, and report the role used (S1); tell us whether the chair holds `admin` or `board_member`; confirm the 30-day and January-31 retention defaults, the 5-minute hidden-photo window, and whether a plain border is acceptable until the chair's frame art arrives; bring a real iPhone, an Android phone and the stickers to S3.
- **Measure, do not assume:** S1, S2a, S2b, S3 and live checks L1 to L13 settle every item marked believed or unmeasured above.
- **Orchestrator:** file DECISION-121 to 125 after the sibling finishes (reserve 125); apply the CLAUDE.md, spec and backlog edits listed above at the right moments; announce `:3000` restarts; set the purge reminder; update the Reserved IDs line.


### Phase 3 addendum: session edit page (tech-lead, 2026-10-12)

**Trigger:** the ux-developer's Slice 1 deviation 4 (no edit surface), confirmed by the e2e run: drop-off window labels must equal the Zeffy buyer answers (normalized), and a label mistyped at creation cannot be fixed. This closes a hole in the page list above; it adds no schema and no route.

**Ruling 1, route.** A separate page, `/admin/santas-workshop/[sessionId]/edit`, not inline on the overview. The overview stays a status dashboard; the edit form is long and has unsaved state. It reuses `session-form.tsx` in an edit mode, calls the existing `PATCH /api/admin/santas-workshop/sessions/[id]`, and is linked from the overview and the session nav. The page does `auth()` then `hasFeature()` then `redirect("/access-pending")` before any query (already covered by `admin-page-feature-gates`). A purged session shows a read-only notice (the server already answers `409 session_purged`).

**Ruling 2, what is editable.**
- *Editable now:* `name`; `dropoffDate`, `photoDate`, `pickupDate`; `windows` (label, start, end; add a window; remove a window nobody chose); `crewClosesOn`; `purgePersonalOn`, `purgePublicOn`. The form sends **only changed fields** (so a second admin's unrelated edit is not overwritten) and disables Save when nothing changed.
- *Frozen, shown as plain text with "fixed once created":* `kind`, `slug` (and ids and tokens). The edit-mode form renders no input for them; the server validator already rejects them (`immutable_field`).
- *Not on this page:* campaign, rates and question map (Connect page); status, worker code, pause (Slice 2 overview cards); `storageQuotaBytes` (photos page) and the frame settings (frames page): each is added by the slice that consumes it, so no dead controls ship.
- *Window ids are never shown or edited.* An existing window keeps its id through label, time and order edits; a new window gets a fresh id. Removing a window a registrant chose stays the existing `409 window_in_use` (message in plain words: "Registrants chose this window; change its label instead").
- *Dates once registrants exist:* **allow, with a note**, no refusal. Nothing a registrant stored references a date (orders reference a window id only), so a date edit cannot orphan data. The server's `validateSessionDates` on the merged row remains the only gate. The page shows, when status is not `draft`, "The public page and the Zeffy form text carry these dates too; update them separately." (the facts live in three places; this page edits only the session). Changing `pickupDate` does **not** silently move `crewClosesOn` or the two purge dates; a button "Recalculate worker access and removal dates from pickup day" (client-side `defaultRetention()`) fills them for the admin to review before saving.

**Ruling 3, what a label change does to existing orders (the part that matters).** `PATCH` stays a plain configuration write: it does **not** recompute anything. Stored orders keep their `window_id`/`window_label_raw` and stuffies keep their `unmapped_window` attention code until the explicit, existing **Remap** runs (`remapRow` re-maps from stored raw answers using the session's *current* windows). After a save that changed any window label, the page says "Registrants are not updated until you run Remap" with a button that calls the existing reprocess route in the same loop the Connect page uses (`runRemapLoop`), and reports the result with the existing `remapSummary`. Consequences, stated on the page: renaming a label to match the stored answers clears `unmapped_window` for those registrants; renaming a label so it no longer matches turns previously matched registrants back to `unmapped_window` (nothing is lost, the raw answer is stored; renaming back and re-running Remap restores them). A flag the admin had dismissed resets when the reason set changes (Slice 1 deviation 4). No new preview endpoint: the effect is reversible and non-destructive, so a count-before-save is not worth an API change. To make the fix one click, the page lists **"Answers that matched no window"** (distinct normalized `window_label_raw` of this session's orders with a null window id, with counts, at most 10) as chips that copy the answer into the label field. That list is read directly by the Server Component through one small read function added to `session-queries.ts` (about 15 lines; no route, no schema; absorbed by whoever builds the page, like deviation 1). Purged orders have a null raw answer and are excluded.

**Confirmation of the three Phase 4 UI deviations.**
1. `RegistrantDto.unmatched`: **confirmed.** Admin DTO only; it must never reach `crew-contract.ts` (`crew-contract-no-contact.test.ts` already bans the identifiers a crew DTO may hold). The caps (10 pairs, 300 characters) stand.
2. `unmapped_window` label: **confirmed, with one wording addition** once the edit page exists: append "Fix the label under Edit session, then run Remap." so the message names the remedy.
3. Practice as the new-session default: **confirmed.** Because `kind` is immutable, the submit button must state the kind it creates ("Create practice session" / "Create real session") so creating the real session on Nov 8 is a deliberate click. Recommended, under 5 lines, absorbed.

**Tests (named).**
- *Unit, ux-developer:* `session-edit-patch.test.ts` (the patch builder returns only changed fields; returns nothing when unchanged; never includes `kind` or `slug` even if present in form state; existing windows keep their ids through label and time edits; new windows get fresh ids; removed windows are reported; "Recalculate" fills `crewClosesOn` and both purge dates from `defaultRetention`); `unmatched-window-answers.test.ts` (groups null-window orders by normalized raw answer with counts; excludes matched orders and purged nulls; caps at 10; treats text as plain data); `admin-ui.test.ts` additions (`window_in_use` message names the remedy; the `unmapped_window` label ends with the remedy; the post-save message appears only when a label changed); `admin-ui-source.test.ts` addition (the edit page gates before queries; edit mode renders no input named `kind` or `slug`; no `dangerouslySetInnerHTML`).
- *Server, confirm present or add (api-developer file, small):* in `session-queries.test.ts`, a label change on a window that orders reference succeeds (same id) and removal of an in-use window returns `window_in_use`; in `remap.test.ts`, renaming to a label equal to the stored raw answer sets `windowId` and clears `unmapped_window`, renaming to a non-matching label nulls `windowId` and adds `unmapped_window`, and renaming back restores it.
- *e2e, `e2e/santas-workshop-session-edit.spec.ts`:* create a practice session with a mistyped window label; connect the fixture campaign and map questions; post a signed order whose window answer is the correct label and see `unmapped_window` on the registrant; open Edit, see the chip with its count, click it, Save, run Remap, and the flag is gone and the window shows; edit the label to a wrong value, Remap, and the flag returns (reversible), then restore it; removing a window in use shows the plain-words error and saves nothing; `kind` and `slug` are text not inputs; changing name and dates is reflected on the overview; a member without the key is bounced from `/edit`; 360 px has no horizontal scroll.

**Implementer:** **ux-developer** (route and PATCH exist; the one added read function is a few lines in an api-developer file and is absorbed with a note). No loop-back to Phase 1 or 2: no new permission, schema or dependency. Qa re-runs the new spec with the Slice 1 specs.

---

# Phase 4 — Implementation

## Phase 4 — Implementation (schema step, Slice 1 steps 1 and 2) — 2026-10-12

**Owner:** database-admin
**Status:** complete (schema and permission only; no routes, no UI, no `src/lib/zeffy/`)

### Summary
All eight tables from the Phase 3 Data Model are in `schema.ts` and created by migration `0113`, and `santas_workshop.manage` is added by `0114` and bound to `admin` and `board_member`. `drizzle/run-migrations.mjs` ran twice cleanly and `drizzle-kit push` (twice) proposes nothing for any `sw_`/`zeffy_` object; `tsc`, `lint` (0 errors) and `pnpm test` (219 files, 3758 tests) pass. Nothing committed.

## Files Created

- `drizzle/migrations/0113_santas_workshop_tables.sql` — `sw_sessions`, `sw_orders`, `sw_stuffies`, `sw_stuffy_events`, `sw_photos`, `zeffy_events`, `sw_session_log`, `sw_crew_attempts`; 24 indexes (incl. all partial unique ones); 17 FKs, each in a `pg_constraint`-guarded `DO` block with drizzle's derived name (longest 48 chars). Numbers re-derived at start (`ls | sort | tail -3` showed `0112`).
- `drizzle/migrations/0114_santas_workshop_permission.sql` — feature insert (`WHERE NOT EXISTS`), two `CROSS JOIN ... NOT EXISTS` binds (`admin`, `board_member`), guarded description `UPDATE`.
- `src/lib/santas-workshop/session-schema.test.ts` — the named `session-schema.test.ts` (names <= 63 chars, FK names equal drizzle's, every schema index present in SQL with uniqueness and WHERE, one-current-portrait index in both places, no `bytea`/`check(`/`pgEnum`/`CHECK`/`CREATE TYPE`, only `CREATE TABLE IF NOT EXISTS`/guarded FKs/`IF NOT EXISTS` indexes, no `@`, no DML).
- `src/lib/santas-workshop/permission-migration.test.ts` — key/category, description byte-identical to `FEATURE_DESCRIPTIONS`, exactly two binds, no treasurer/member/`admin.*`.

## Files Modified

- `src/lib/db/schema.ts` — `bigint` import; eight tables, types `SwSession`, `NewSwSession`, `SwOrder`, `SwStuffy`, `SwStuffyEvent`, `SwPhoto`, `ZeffyEvent`. Exports: `swSessions`, `swOrders`, `swStuffies`, `swStuffyEvents`, `swPhotos`, `zeffyEvents`, `swSessionLog`, `swCrewAttempts`.
- `src/lib/permissions.ts` — `FEATURES.SANTAS_WORKSHOP_MANAGE`, `FEATURE_CATEGORIES.SANTAS_WORKSHOP`, `FEATURE_DESCRIPTIONS` entry.
- `src/lib/default-role-bundles.test.ts` — B2 now also forbids the key on `treasurer`; new describe: held by exactly `admin` and `board_member`, not `treasurer`/`member`.
- `.gitignore` — `.santas-workshop-store/`. (No fixture or Drive folder entries: the design lists none.)

## Schema Changes

- Tables affected: the eight above (all new; no existing table touched).
- Migrations: `0113`, `0114`. Every statement is idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`, guarded FK blocks, `WHERE NOT EXISTS` seed and binds, `IS DISTINCT FROM`-guarded UPDATE). No seed rows beyond the permission, no personal data.
- Role bindings: `santas_workshop.manage` -> `admin`, `board_member` (canonical idiom; `default-role-bundles.test.ts` parses them). Existing board members must sign out and in after deploy.
- **Idempotence proof** (on the pipeline's own Neon branch): `pnpm db:migrate` run twice: first run created the tables and the permission, second run reported success (only the pre-existing "already exists, skipping" notices from earlier migrations). Branch state afterwards: 8 tables, `ux_sw_photos_current` definition equals the design's, feature bound to exactly `admin` and `board_member`. `drizzle-kit push` run repeatedly: no statement naming a `sw_`/`zeffy_` table, index or FK after the first run (see deviation 3 for the one cosmetic exception).
- Local apply: `pnpm exec dotenv -e .env.local -- pnpm db:migrate`, then `pnpm db:push`.

## Implementer Notes

**Deviations from the design (routed by size; all under ~30 lines, no new API, no new flow):**
1. **Nav entry not added.** Step 2 says "then ... the nav". An `ADMIN_NAVIGATION` entry for `/admin/santas-workshop` before that page exists would fail `admin-page-feature-gates` and ship a dead link; the entry (single key, Engagement group) goes in with the first admin page (ux-developer, Slice 1 sessions admin). Absorbed.
2. **`superseded_by_photo_id` and `frame_exported_photo_id` have no FK** (the design lists them as plain columns; a self-FK on `sw_photos` would also block purge ordering). Kept as plain `uuid`. Absorbed.
3. **Array defaults in drizzle-kit push.** `text[] NOT NULL DEFAULT '{}'` (`sw_sessions.zeffy_ticket_rate_ids`, `sw_stuffies.attention_codes`) makes `push` re-emit `SET DEFAULT '{}'` every run. This is the identical pre-existing behavior of `ledger_donors.emails` (0077) and `social_requests.platforms`; it is a no-op re-set, tried the `sql\`'{}'::text[]\`` spelling and it did not remove it, so I kept the project's `.default([])` convention. Not a blocker; B-165-class noise.
4. **Pre-existing `push` prompts (B-165 family).** Besides `ledger_entities_slug_unique`, `push` also prompts for `dues_settings_fiscal_year_unique`, and re-proposes dropping and re-adding ten FKs whose names exceed 63 characters (Postgres truncates them). Neither involves this increment. Every truncate prompt was answered with the default "No, add the constraint without truncating the table"; never the destructive option. Recommend adding both to B-165.
5. **Branch verification wording.** The Neon pooled host is an endpoint id (`ep-divine-boat-...`), it does not contain the branch id `ama2ubpx`. Note: `neonctl connection-string --branch-id <id>` is silently ignored and returns the **production** endpoint; the branch id must be passed as the positional argument (`neonctl connection-string br-steep-cake-ama2ubpx ...`). I caught this before any write (the first string matched the `PROD_DATABASE_URL` host), discarded it, and verified the final host differs from both production and the shared dev endpoint. The worktree `.env.local` has `DATABASE_URL`/`DB_URL` on the branch, no `PROD_DATABASE_URL`, `RESEND_API_KEY=` empty, `EMAIL_DEV_ALLOWLIST` unset. No dev server was started.
6. The design's `session-schema.test.ts` line "PATCH validator rejects `kind` and `slug`" is not deliverable here (no validator exists yet); it moves to api-developer with the sessions route. The `permissions.test.ts` "nav entry carries the single key" assertion moves with the nav entry (deviation 1).

### Open questions / handoff notes (for api-developer)
- Tables and import names are listed under Files Modified. Dates are `date` columns (strings). `sw_photos.id` has no default (client-supplied idempotency key). `sw_sessions.kind` has no default and no update path; `slug` and `collage_token` have unique indexes; `crew_closes_on`, `purge_*_on`, `storage_quota_bytes` are NOT NULL with no DB default (the create route must supply them).
- Relationships: every `sw_*` child cascades from `sw_sessions`; `sw_stuffies` -> `sw_orders` cascade; `sw_stuffy_events`/`sw_photos` -> `sw_stuffies` cascade; `zeffy_events.session_id` is `SET NULL`; user-id columns are `SET NULL`.
- A pinned write that loses a race on `ux_sw_photos_current` / `ux_sw_stuffies_tag` / `ux_sw_stuffy_events_idem` raises `23505`; the design's handlers map those.
- Vocabulary tuples (`as const`) belong in the client-safe carriers you create; the schema stores plain text.
- The nav entry and its `admin-page-feature-gates` coverage land with the first admin page.
- Next agent: **api-developer** (Slice 1: `src/lib/zeffy/`, consumer, mapper/apply, webhook route, sessions admin routes). Orchestrator: the shared dev database has not been migrated by this step; the branch has.

## Phase 4 — Implementation (API, Slice 1 server step) — 2026-10-12

**Owner:** api-developer
**Status:** complete for Slice 1's server side (no UI, no nav entry, no email, nothing committed)

### Summary
Zeffy registrations now flow end to end on the pipeline's own Neon branch: a signed `payment.completed` posted to `/api/zeffy/webhook` created one order and three stuffies (with the admin-mapped question text, a "needs attention" flag on the unmatched question, photo consent opt-in), a redelivery was a no-op, a refund-style `payment.updated` failed with `no_api_key` (retryable, as designed) and a bad or missing signature got one identical 400. The reusable `src/lib/zeffy/` module, the one write path `applyPaymentSnapshot()`, Sync, Remap, Reprocess (payment and event), the sessions admin API and the client-safe carrier are in place. Gates: `tsc` clean, `pnpm lint` 0 errors (one pre-existing warning, `budget-context-panel.tsx`), `pnpm test` 237 files / 4061 tests green, `pnpm build:only` passes.

### What I did
- `src/lib/zeffy/` (nothing workshop-specific; a test pins it): `config.ts` (the only env reads: webhook secret, API key, dev allowlist, booleans for the checklist), `signature.ts` (raw-byte HMAC, repeated `v1`, 300 s tolerance both ways, length check before `timingSafeEqual`), `types.ts`, `snapshot.ts` (whitelist projection, `itemKey()` with the `ITEM_KEY_STRATEGY` switch for the S2 outcome, `isPaymentSnapshot`), `client.ts` (bearer, `listPayments` campaign required by type and at runtime, `getPayment` -> `{ gone: true }` on 404, `listCampaigns`/`getCampaign`, 700 ms spacing, `Retry-After`, dev allowlist deny-by-default, no key or body in any message), `event-outcomes.ts`, `events-queries.ts` (DB `ZeffyEventStore`, recent events, last-event times), `webhook-handler.ts` (framework-free verify -> claim -> dispatch -> HTTP), `embed-url.ts` (`toEmbedUrl` moved from `components/campaigns/zeffy-url.ts`, four importers updated, no shim), `redact.ts`, `test-helpers.ts`, fixtures.
- Workshop side: `question-fields.ts`, `payment-mapper.ts` (pure; also the derived refund helpers `refundOpen` / `workerRefundBadge` / `partialRefundFlag`), `payment-apply.ts` (advisory lock first, stale-snapshot refusal, import-owned columns only, never deletes, `markPaymentDeleted`), `zeffy-consumer.ts` (+ `fetchAndApply` shared with Reprocess), `zeffy-reprocess.ts`, `sync.ts` + `sync-cursor.ts`, `remap.ts`, `session-input.ts` (validators, `defaultSessionDraft()` from `WORKSHOP_2026`, `defaultRetention`), `session-queries.ts`, `session-checklist.ts`, `session-log.ts`, `admin-http.ts`, `storage-status.ts`, `tokens.ts`, `state-machine.ts` (tuple only), `session-vocabulary.ts`, `admin-contract.ts` (carrier).
- Routes and scripts: webhook route, twelve admin routes, `scripts/spike-zeffy.ts` (dry run, redacts, writes `__fixtures__/spike-redacted.json` only with `--write`), `scripts/zeffy-webhook-fixture.ts` (signs and posts to localhost only).
- Live smoke on `:3101` against the branch DB (host `ep-divine-boat-...`, checked in code before any write; test rows deleted afterwards): unmapped campaign -> `ignored_unmapped`; mapped three-ticket order -> 1 order + 3 stuffies, correct flags, event row `processed` with a stored snapshot; redelivery -> `duplicate: true`; id-only `payment.updated` with no API key -> 500 + `failed`/`no_api_key`; bad signature and missing signature -> 400 `bad_request`; admin route unauthenticated -> 401. Server stopped.

### Outputs
**Webhook** `POST /api/zeffy/webhook` (no `auth()`; the signature is the authentication; node runtime, force-dynamic): 200 `{ ok: true, outcome, duplicate? }`, 400 `{ error: "bad_request" }` (one identical body for oversize, bad or stale signature, malformed JSON, bad envelope), 500 `{ error: "not_configured" | "failed" }`.

**Admin** (`/api/admin/santas-workshop/...`; `auth()` then `hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE)` from `@/lib/permissions-server` are the first two statements; `Cache-Control: no-store`; error body `{ error, code: AdminErrorCode, field? }`; 401 `unauthorized`, 403 `forbidden`, bad uuid 404):

| Method and path | Request | Response |
|---|---|---|
| `GET sessions` | | `SessionListResponse` (`sessions: SessionListItem[]`, `storage: StorageStatus`) |
| `POST sessions` | `CreateSessionRequest` | 201 `SessionResponse`; 409 `slug_taken` |
| `GET sessions/[id]` | | `SessionOverview` (counts by state/window, `needsAttention`, `refundsOpen`, last event times, `lastSyncAt`, `zeffyConfig` booleans, `checklist`) |
| `PATCH sessions/[id]` | `UpdateSessionRequest` | `SessionResponse`; 400 `immutable_field` for `kind`/`slug`; 409 `window_in_use`, `session_purged` |
| `GET zeffy/campaigns` | | `ZeffyCampaignsResponse`; 503 `zeffy_not_configured`; non-production lists only allowlisted campaigns |
| `PUT sessions/[id]/zeffy` | `ConnectCampaignRequest` | `ConnectCampaignResponse` (`verified: false` when Zeffy could not be asked); 409 `campaign_in_use`; 404 `campaign_not_found`; 400 `unknown_rate` |
| `GET sessions/[id]/zeffy/questions` | | `QuestionsResponse` (question TEXT only, counts, current field) |
| `PUT sessions/[id]/zeffy/question-map` | `SaveQuestionMapRequest` | `SaveQuestionMapResponse` (`attentionWouldChange`); 400 `duplicate_mapping` |
| `POST sessions/[id]/zeffy/reprocess` | `RemapRequest` | `RemapResponse` (local Remap, batches of 200, post `cursor` back until `done`) |
| `POST sessions/[id]/zeffy/sync` | `SyncRequest` (`cursor?`) | `SyncResponse`; `maxDuration = 60`; `retryAfterMs` on a Zeffy rate limit (normal, not an error); 409 `not_mapped` |
| `POST sessions/[id]/zeffy/payments/[paymentId]/reprocess` | | `ReprocessResult`; 409 `session_mismatch`, 404 `payment_unknown`, 503 `zeffy_not_configured` |
| `GET sessions/[id]/zeffy/events?limit=` | | `ZeffyEventsResponse` (no payload, `hasPayload` only; `lastValidEventAt` any campaign) |
| `POST zeffy/events/[eventId]/reprocess` | | `ReprocessResult`; 404 `event_not_found` |
| `GET sessions/[id]/stuffies?state=&q=&flag=&page=` | | `RegistrantsResponse` (read-only, parent contact included, 50 per page) |

- **Carrier (client-safe, import types and vocabularies from here only):** `src/lib/santas-workshop/admin-contract.ts` (exports `SESSION_KINDS`, `SESSION_STATUSES`, `ZEFFY_EVENT_OUTCOMES`, `STUFFY_STATES`, `ATTENTION_CODES`, `ADMIN_ERROR_CODES`/`AdminErrorCode`, `REGISTRANT_FLAGS`, `QUESTION_FIELDS`, all DTOs). Also client-safe and meant for the forms: `session-input.ts` (`defaultSessionDraft()`, `validateCreateSession`, `validateUpdateSession`, `validateWindows`, `validateConnectCampaign`, `validateQuestionMap`, `defaultRetention`), `question-fields.ts` (`normalizeQuestionText`, field catalog), `payment-mapper.ts` (`displayStuffyName(name, orderSize)` -> "Unnamed stuffy, order of N"), `state-machine.ts`. `admin-routes-gate.test.ts` fails if any of these pulls in db, `node:`, `next/server` or `process.env`. Consumers grepped for this pass (`grep -rln` of the carrier, `session-input` and `payment-mapper` under `src/components` and `src/app`): the only importers are the admin route handlers; no client component consumes the carrier yet, so nothing to convert.
- **Schema/migrations:** none added by me (0113/0114 untouched). **Env vars read:** `ZEFFY_WEBHOOK_SECRET`, `ZEFFY_API_KEY`, `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` (all via `src/lib/zeffy/config.ts`).
- **Unit tests named for Slice 1, all written and passing:** `zeffy/signature`, `snapshot`, `client`, `webhook-handler`, `fixtures-no-pii`, `consumer-injection` + `secrets-not-logged` + `webhook-route-source` + test-helpers scan (`zeffy-module-source.test.ts`); `santas-workshop/question-fields`, `payment-mapper`, `payment-apply`, `zeffy-consumer` (refund notification -> fetch, unmapped campaign, ordering), `session-input` (PATCH rejects `kind`/`slug`; the line the schema step deferred), `session-checklist`, `admin-routes-gate` (every admin route's first two statements, plus carrier client-safety), and extras: `sync`, `remap`, `zeffy-reprocess`, `session-queries`, `redact`.
- Decisions: none filed (proposed text below).

### Deviations from the design (routed by size)
Absorbed (each under ~30 lines, no schema, no new flow):
1. **`GET /sessions/[id]` checklist** has `storage_tested` and `worker_code` as `info` placeholders and `StorageStatus` is a constant `{ configured: false }` until Slice 2 supplies the photo store; the contract fields exist now.
2. **Extra map key `ignored`** (an admin-seen question deliberately not mapped), so a generic buyer question can clear "needs attention" for every registrant; without it only per-stuffy dismissal existed. Listed in `QUESTION_MAP_KEYS`.
3. **`snapshot_at` is written on an identical re-apply** (only that column; `updated_at` untouched), because Sync's stale-detection depends on every apply stamping it. The design's "writes nothing" is true for every other column.
4. **A dismissed attention flag resets when the set of reasons changes** (apply and Remap), so a new problem is not hidden by an old dismissal.
5. **Connect proceeds unverified** (`verified: false`, title as typed) when Zeffy cannot be asked (no API key, or dev allowlist), so e2e specs can map a fixture campaign. With a key it validates the campaign and rate ids.
6. **`getPayment` returns `{ gone: true } | { gone: false, outOfScope: true } | { gone: false, outOfScope: false, payment }`** (the design named only `{ gone: true }`; the dev allowlist needs the middle case).
7. **`src/app/santas-workshop/public-page.test.ts` (increment 1's test) narrowed:** it scanned all of `src/lib/santas-workshop/` and so failed on the server code this increment must put there (db, `fetch`). It now scans the five public-page lib modules (`clock`, `facts`, `format`, `public-facts`, `state`) plus the app and components folders. The increment-1 owner should know; the rule it enforces on the public page is unchanged.
8. **`toEmbedUrl` moved** to `src/lib/zeffy/embed-url.ts` (design item, four importers updated; `git mv` left the rename staged in this worktree's index).
Not delivered here, by design (later slices or ux-developer): the `ADMIN_NAVIGATION` entry and admin pages (`admin-page-feature-gates` would fail on a nav entry without its page), `POST sessions/[id]/status`, crew code, photo store, `storage/test`, `zeffy-replay.ts` script, e2e specs.
Residual noted: a Zeffy rate limit raised mid-page by the per-payment-fetch fallback re-applies that page on resume (idempotent; counts can double for that page).

### QA fixes (api-developer, after the first QA FAIL)
- **D2:** `recentEvents()` (`src/lib/zeffy/events-queries.ts`) now filters on `session_id` OR the campaign id (`sessionEventsFilter()`), so a failed id-only `payment.updated`/`deleted` (session set, campaign NULL) is listed and can be Reprocessed; one OR over one table lists an event once after a retry fills `campaign_id`. It accepts a session object or, as the Connect page already calls it, a bare campaign id, which it resolves to the owning session, so the page needed no edit. The events route passes the session. Test `events-queries.test.ts` renders the SQL (hermetic mock; it asserts the OR arms and parameters, not row contents; row-level behaviour is for QA's live check).
- **D3:** `redact.test.ts` input address is now `someone@mail.example.test`; the redactor assertions still require it gone. PII grep from `/pre-push` prints nothing.
- **(a)** `ZEFFY_API_BASE_URL` override via `apiBaseUrl()` in `src/lib/zeffy/config.ts`, honoured only when `NODE_ENV !== "production"`; client tests cover honoured, ignored in production, blank default. (b) `additional_donation` mixed with tickets: new mapper test shows one stuffy and the order `amount_cents` keeping the full total (the extra donation is not stored as a separate column).
- Re-run: `tsc` clean, lint 0 errors (same pre-existing warning), `pnpm test` 245 files / 4156 tests green.

### Open questions / handoff notes
- **Next agent: ux-developer** for the Slice 1 admin UI: `src/app/(dashboard)/admin/santas-workshop/` (`page.tsx` list + storage banner slot, `new/page.tsx` using `defaultSessionDraft()`, `[sessionId]/page.tsx` overview and checklist, `[sessionId]/connect/page.tsx` for campaign picker -> rate marking -> question assignment -> Sync/Remap/events with Reprocess, `[sessionId]/registrants/page.tsx` read-only), plus the `ADMIN_NAVIGATION` entry (Engagement group, single key `FEATURES.SANTAS_WORKSHOP_MANAGE`) in the same pass as the first page. Copy rules: "Emailed" language does not apply; show "Zeffy is limiting requests, continuing..." for `retryAfterMs`; ConfirmDialog on Connect showing the campaign title; the Sync loop posts `cursor` back until `done`; a worker never sees `parentEmail`/`parentPhone` (admin DTO only). Name rendering: use `displayStuffyName`. Refund display: `refund: "refunded" | "partial_flag" | "none"` is already derived server-side.
- **Orchestrator:** (a) while stopping my `:3101` server I ran `pkill -f "next dev"`, which is broader than I intended; no `next` process is running now and `:3000` is not listening. I cannot tell whether a `:3000` server was running before, so if it was, it needs a restart (mine to own). (b) Add `ZEFFY_WEBHOOK_SECRET`, `ZEFFY_API_KEY`, `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` to Vercel/`.env.local` as listed under "For the orchestrator"; the webhook fails closed (500 `not_configured`) without the secret and `updated`/`deleted` handling needs the key. (c) S2a still needs the user's practice form and a real purchase; run `scripts/spike-zeffy.ts --campaign <id>` (dry run first), then decide `ITEM_KEY_STRATEGY` and the consent-affirmative set (`CONSENT_AFFIRMATIVE`, fails safe to "no").
- Proposed DECISION/backlog text: none new beyond the filed 121 to 125.

## Phase 4 — Implementation (UI, Slice 1 client step) — 2026-10-12

**Owner:** ux-developer
**Status:** Complete (Slice 1); qa next. Nothing committed. Slices 2 to 5 UI (status buttons, worker code card, photos, frames, purge/reset, manual add, registrant actions) are not in this step.

### Summary
The Slice 1 admin UI is in place on the pipeline worktree: the `ADMIN_NAVIGATION` entry (Engagement group, single key `FEATURES.SANTAS_WORKSHOP_MANAGE`), and five pages under `/admin/santas-workshop`: sessions list, new session, session overview with the go-live checklist, Connect (Zeffy form, question map, Sync, Remap, recent events with Reprocess) and a read-only registrants list. Gates on the worktree: `tsc` clean, `pnpm lint` 0 errors (the one pre-existing `budget-context-panel.tsx` warning), `pnpm test` 240 files / 4121 tests green, `pnpm build:only` passes, 10 of 10 new Playwright tests pass against `:3101`, test rows cleaned (verified: 0 leftover sessions, events, users).

### What I did
- Nav entry in `src/lib/permissions.ts` (after Events); pages call `auth()` then `hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE)` and `redirect("/access-pending")` in their own bodies, each before any query.
- Server Components fetch via `session-queries` / `events-queries` directly (no HTTP hop); client islands (`'use client'`) only for the new-session form, the Connect panel, the question-map editor, the Sync/Remap panel and the events list. They call the admin API through `callAdmin()` and import types and vocabularies from `admin-contract.ts` only.
- Pure logic, unit-tested, lives in `src/lib/santas-workshop/admin-ui.ts`: exhaustive `adminErrorMessage(code)` (a new `AdminErrorCode` breaks `tsc`), labels for states/statuses/attention codes/event outcomes, `runSyncLoop` (posts the cursor back until `done`; `retryAfterMs` waits and shows "Zeffy is limiting requests, continuing..."), `runRemapLoop`, `syncSummary`/`remapSummary`, question-map editing (`assignQuestion`, one field per string, the `ignored` key), `parseRegistrantFilters`/`registrantsHref`, Eastern instant formatting, slug helpers.
- New session form: pre-filled from `defaultSessionDraft()` (the `WORKSHOP_2026` constant), kind radios with plain-language consequences and "fixed once created", client validation with the server's own `validateCreateSession`, windows editor; server error codes (for example `slug_taken`) shown in plain words.
- Connect: "Find forms in Zeffy" (only offered when the API key is set), rate checkboxes, a by-hand entry for when Zeffy cannot be asked, and a `ConfirmDialog` that names the campaign title (and warns when replacing a connected form that already has registrants). `verified: false` shows an amber "saved without Zeffy confirming" note.
- Registrants: cards below `xl`, a real `<table>` at `xl+` from the same fragments (the approvals-page lesson: the admin sidebar clips a wide table until 1280px). Search, stage and flag filters (GET form), pagination, needs-attention reasons, refund badge, consent flag, state, tag last four, parent contact (admin only), and the raw unmatched question and answer text for attention rows. All buyer and Zeffy text is a plain React text node (source scan forbids `dangerouslySetInnerHTML`).

### Outputs
New:
- `src/app/(dashboard)/admin/santas-workshop/page.tsx`, `new/page.tsx`, `[sessionId]/page.tsx`, `[sessionId]/connect/page.tsx`, `[sessionId]/registrants/page.tsx`
- `src/components/admin/santas-workshop/`: `badges.tsx`, `styles.ts`, `session-nav.tsx`, `session-form.tsx`, `connect-panel.tsx`, `question-map-editor.tsx`, `sync-panel.tsx`, `events-list.tsx`, `registrants-table.tsx`, `admin-ui-source.test.ts`
- `src/lib/santas-workshop/admin-ui.ts` (+ `admin-ui.test.ts`), `unmatched-answers.ts` (+ test)
- `e2e/santas-workshop-admin-gate.spec.ts` (member bounced, admin sees nav and page, board member can open), `e2e/santas-workshop-webhook-to-roster.spec.ts` (create session in the UI, duplicate slug, Connect through the dialog, bad/missing signature 400 and nothing stored, unmapped campaign stores no payload, signed 3-ticket order becomes 3 registrants, redelivery adds none, raw text and `<b>` rendered as text, assign questions in the UI, Remap clears attention, search, 360 px no horizontal scroll on every page)
Modified: `src/lib/permissions.ts` (nav entry), `src/lib/permissions.test.ts` (the "nav entry carries the single key" and derived-proxy-rule assertions the database-admin deferred), `src/lib/santas-workshop/admin-contract.ts` and `session-queries.ts` (deviation 1).

### Deviations from the design (routed by size)
Absorbed (each under ~30 lines, no schema, no new API route):
1. **`RegistrantDto.unmatched`** added to the carrier and filled by `toRegistrantDto()` through the new pure `unmatchedAnswers()` for needs-attention rows only (capped at 10 pairs, 300 characters each). Phase 1 requires the raw unmatched text to be visible on attention rows and the DTO had no field for it. This edits two api-developer files; api-developer should know. `toRegistrantDto` gained an optional fourth-argument default, so the existing test is untouched.
2. **`unmapped_window` label** reads "Drop-off window answer matches none of this session's windows (labels must match the form)", because the mapper matches the buyer's answer to a window label exactly (normalized); a mismatch is invisible in the unmatched-text box (the question IS mapped).
3. **Default kind on the new-session form is Practice** (the first session should be a dry run); the admin can switch and the radios state the consequences.
Needs routing (not done, scope beyond this step):
4. **No session edit page (resolved, see "Session edit page" below).** `PATCH /sessions/[id]` exists and its rules are tested, but the design's page list has no edit surface, so a window label, a date or the retention dates cannot be corrected after creation. Because window labels must match the Zeffy form's answers exactly, this is a real gap the first time a label differs. A new page: back to Phase 3 (or a ruling that the new-session form is enough because the labels follow `formatTimeRange`, the same format the public page uses).
5. **No status buttons, worker code card or practice reset** on the overview (their API routes are Slice 2 and later); the status is shown read-only. The checklist items for storage and worker code render the API's `info` placeholders.

### Session edit page (Phase 3 addendum, built 2026-10-12)
Built per the tech-lead's addendum: `/admin/santas-workshop/[sessionId]/edit` (page body does `auth()` then `hasFeature()` then `redirect("/access-pending")` before any query; a purged session shows a read-only notice), linked from the overview ("Edit session") and the session nav tab. `session-form.tsx` now has `mode="edit"`; the edit form sends only changed fields (`buildSessionPatch`, which cannot carry `kind`/`slug`), disables Save when nothing changed, shows kind and slug as text under "Fixed once created", preserves window ids through label/time edits (new windows get a fresh id), shows the not-draft note about the public page and Zeffy text, and has a "Recalculate worker access and removal dates from pickup day" button that fills the three dates for review without saving. After a save that changed a window label the page says "Registrants are not updated until you run Remap" with a "Run Remap now" button (the same `runRemapLoop`). "Answers that matched no window" are chips (count is orders) that copy the answer into the label of the window edited last. `window_in_use` now reads "Registrants chose this window; change its label instead of removing it."; the `unmapped_window` label ends "Fix the label under Edit session, then run Remap."; the new-session button reads "Create practice session" / "Create real session".

- **Absorbed note (api-developer file):** `listUnmatchedWindowAnswers(id)` (about 8 lines, no route, no schema) added to `session-queries.ts`, grouping through the pure `unmatched-window-answers.ts`.
- **New files:** `session-edit-patch.ts`, `unmatched-window-answers.ts`, `[sessionId]/edit/page.tsx`, `e2e/santas-workshop-session-edit.spec.ts`, `session-update.test.ts` (updateSession: label change on an in-use window succeeds, in-use removal is `window_in_use` and writes nothing).
- **Tests:** unit `session-edit-patch.test.ts`, `unmatched-window-answers.test.ts`, `admin-ui.test.ts` additions, `admin-ui-source.test.ts` (six pages gated before queries; edit form has no kind/slug input), `remap.test.ts` (rename to the stored answer sets the window and clears `unmapped_window`; rename away flags; rename back restores). e2e (7 tests): mistyped label, flagged, chip, Save, Remap clears, wrong label flags again, restore; in-use removal refused with nothing saved; kind/slug are text; name and dates reach the overview and Recalculate proposes without saving; 360 px. The gate spec also covers `/edit`.
- **Gates (worktree):** `tsc` clean; `pnpm lint` 0 errors (same one old warning); `pnpm test` 243 files / 4143 tests green; `pnpm build:only` passes; 17 Santa's Workshop Playwright tests (gate 3, webhook-to-roster 7, session-edit 7) pass on `:3101`; no leftover rows; server stopped by PID. Existing spec `santas-workshop-webhook-to-roster.spec.ts` updated for the new button label.
- Deviation 4 above (no edit page) is now resolved by this page. Remaining limitation: a registrant-affecting label edit shows the Remap notice only in the session that saved it; leaving the page and returning shows the chips again (until Remap runs), which is the cue.

### Post-QA fix (D1, 2026-10-12)
The overview's Schedule card printed the weekday twice ("Friday, Friday, Dec 18"): `formatLongDate()` already leads with the weekday and the page prepended `formatWeekday()`. The card is now its own component, `src/components/admin/santas-workshop/schedule-card.tsx`, which uses `formatLongDate()` alone; `schedule-card.test.tsx` renders it and asserts each weekday appears exactly once (and no "Day, Day" pair). Re-run: `tsc` clean, `pnpm lint` 0 errors (only the old `budget-context-panel.tsx` warning), Santa's Workshop unit tests 24 files / 368 tests green. The e2e date check (`/Dec\w* 27/`) is unaffected. D2 and D3 are the api-developer's.

### Post-Phase-6 fixes (N1 to N3, 2026-10-12)
UI only; no schema, no route, nothing in `src/lib/zeffy/` touched. The Sync response already carries `counts.skipped` (`admin-contract.ts`).
- **N1:** `syncSummary()` now always names skipped payments ("M payments skipped because their ticket rate is not marked as the stuffy ticket. Review under Connect.") and never prints "Everything matches Zeffy" when any were skipped (it says "Synced N orders; nothing needed changing." instead).
- **N2:** after a successful Connect, `connectSuccessNote(verified, apiKeySet)` adds "Run Sync now: payments made before connecting are only picked up by Sync" with a real **Run Sync now** button (same `runSyncLoop`, progress and `syncSummary` outcome shown inline). Without an API key it explains instead of offering a button that cannot work.
- **N3:** failed (and every) event with an `errorCode` now shows a sentence from `EVENT_CODE_SENTENCES` (for example `no_api_key`: "Zeffy could not be asked for this payment because the API key is not set. Set it and press Reprocess.") with the raw code in a small "Code for support" line. The contract types `errorCode` as a plain string, not an enum, so `zeffy-event-codes.test.ts` scans the three producing sources and fails when a produced code has no sentence, or when the map holds a code nothing produces. Adding a server code now requires adding its sentence.
- Tests: `admin-ui.test.ts` (skipped > 0 and = 0, the Connect prompt with and without a key, the `no_api_key` sentence and fallback), `zeffy-event-codes.test.ts`. Gates: `tsc` clean, Santa's Workshop tests green, `pnpm lint` 0 errors (old warning only). No servers started.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** Start the app with `ZEFFY_WEBHOOK_SECRET=whsec_devexample PORT=3101 pnpm dev` (the made-up secret must match the e2e process), then `ZEFFY_WEBHOOK_SECRET=whsec_devexample PLAYWRIGHT_BASE_URL=http://localhost:3101 pnpm test:e2e e2e/santas-workshop-admin-gate.spec.ts e2e/santas-workshop-webhook-to-roster.spec.ts`. The webhook spec skips (does not fail) without a `whsec_dev` secret.
- **e2e environment finding (not caused by this work):** `pnpm exec dotenv -e .env.local -- node scripts/create-test-user.mjs` stored a bcrypt hash the sign-in rejected (CredentialsSignin; dotenv-cli expands `$` sequences in `E2E_ADMIN_PASSWORD_HASH`). On this worktree's Neon branch I reset that one user's password from `E2E_ADMIN_PASSWORD` directly so the admin specs could sign in. Anyone re-running `create-test-user.mjs` on a branch may hit the same thing.
- **What a reviewer should click through:** `/admin/santas-workshop` (empty state, then a card per session; the red storage banner slot is wired but the API reports no cause yet); New session (kind radios, the three pre-filled windows, add/remove a window, a duplicate short name); the overview (checklist marks, counts, links into filtered registrants); Connect (campaign by hand with the confirm dialog; with an API key set, "Find forms in Zeffy", rates, and a form already connected to another session being disabled); the question map (assign, Ignore, Save and re-read, the "N registrants will change" line); Sync and Remap buttons and the Reprocess buttons on events; registrants at 360 px and at 1280 px (cards versus table), search, the three filters, pagination past 50.
- **Not exercised here:** Sync, "Find forms in Zeffy" and per-event Reprocess against a real Zeffy (no API key in the pipeline environment); the loops are covered by `admin-ui.test.ts` with injected network calls. Phase 5 should run Sync once an API key and the practice form exist (S2a).
- **New copy the club may want to refine:** the kind descriptions on the new-session form, the Connect confirm text, every error string in `adminErrorMessage`, the sync summary sentence ("N registrations found that the live feed had missed, now added"), attention labels, and the empty states.
- **Accessibility:** question rows use a visually hidden label naming the question; checklist marks carry screen-reader text ("Done", "To do", "Needs a look") rather than colour alone; progress is an `aria-live` region; touch targets are 44 px.
- Proposed DECISION/backlog text: none new.

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-12
**Verified by:** qa
**Scope:** Slice 1 only (schema `0113`/`0114`, permission and nav, `src/lib/zeffy/`, webhook, consumer/mapper/apply, sessions admin: list, new, overview and checklist, Connect with question map, Sync/Remap/Reprocess, registrants read-only, edit page from the Phase 3 addendum). Slices 2 to 5 are not built and not judged here.
**Tree state measured:** `git rev-parse HEAD` = `6343fa6a2ebb49766d2ecb58605a09477f5b1ce3` (v1.93.0) plus the **uncommitted Slice 1 diff in the pipeline worktree** (about 104 files: 12 modified, 1 staged rename `zeffy-url.ts` -> `zeffy/embed-url.ts`, the rest untracked). Nothing committed. Worktree `.claude/worktrees/agent-a3dae9b276243994d`; database = the pipeline's own Neon branch (host `ep-divine-boat-...`, checked in code before every write by a guard that refuses any other host; `PROD_DATABASE_URL` absent, `RESEND_API_KEY` empty, `EMAIL_DEV_ALLOWLIST` unset). The shared dev DB and production were not touched.

## VERDICT: FAIL

Three defects, each small, each reproduced; everything else passes. A single red item is a red build, so Slice 1 goes back to its implementers. None is a design flaw; no escalation to tech-lead.

| # | Defect | Owner | Where | Fix size |
|---|--------|-------|-------|----------|
| D1 | Schedule card on the session overview prints the weekday twice: "Friday, Friday, Dec 18", "Saturday, Saturday, Dec 19", "Sunday, Sunday, Dec 20". | ux-developer | `src/app/(dashboard)/admin/santas-workshop/[sessionId]/page.tsx` lines 128 to 130 | one-line (drop `formatWeekday(...)`, or use `formatShortDate`) |
| D2 | **Failed id-only events are invisible on the Connect page, so the one recovery button cannot be pressed for them.** The "Recent Zeffy events" list is `recentEvents(campaignId)` = `WHERE campaign_id = X`. A `payment.updated`/`payment.deleted` (a refund notification) whose first processing fails has `campaign_id = NULL` (it is only learned from the fetched snapshot) even though `session_id` is set. | api-developer | `src/lib/zeffy/events-queries.ts` `recentEvents()` (line 114 to 133), plus the Connect page that calls it | small (also match `session_id = <this session>`; the route takes a session id already) |
| D3 | `src/lib/zeffy/redact.test.ts:9` contains `real.person@gmail.com` (plus "Realname", "9 Real Road"). It is synthetic, but it is a personal-domain address and **the `/pre-push` PII grep fails on it**; CLAUDE.md "No Personal Data" says tests use `example.com`/`example.invalid`. | api-developer | `src/lib/zeffy/redact.test.ts` line 9 (and the `not.toMatch(/real\.person\|gmail\|...` assertion on line 19) | one-line each |

**Established vs believed.**
- D1 *established*: seen in the screenshot of the live page and in source (`formatLongDate()` in `src/lib/santas-workshop/format.ts` already returns "Friday, Dec 18"; the page prepends `formatWeekday()`). The public page uses `formatLongDate` alone, which is why it is right there.
- D2 *established* two ways: (a) on the Connect page after firing `payment.updated` and `payment.deleted` at a mapped payment with no API key, both rows existed in `zeffy_events` with `outcome=failed`, `error_code=no_api_key`, `session_id` set, `campaign_id` NULL, and the page listed only the events that carried a campaign id; (b) after the stubbed refund notification succeeded, the same row gained `campaign_id` and appeared. *Believed (not exercised):* when Zeffy later retries the same event and it succeeds the row self-heals, so the harm is confined to the window where a notification is failing, which is exactly when an admin wants the button.
- D3 *established*: `git grep --untracked -InE "...@(gmail|...)\.[a-z.]+"` from the pre-push skill returns that one line and nothing else in the repo.
- I do not offer a root-cause theory beyond these three; there is no sweep to recommend (the format helper is used correctly elsewhere; `recentEvents` has one caller).

## Gates

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm exec tsc --noEmit` | **PASS** | exit 0, 15.5 s |
| `pnpm lint` | **PASS** | 0 errors, 1 pre-existing warning (`budget-context-panel.tsx:114`, unused eslint-disable) |
| `pnpm test` | **PASS** | 243 files, **4143 / 4143** passed, 0 failed, 3.9 s |
| `pnpm build:only` | **PASS** | exit 0, no warnings; 294 route rows. Present: `/admin/santas-workshop`, `/new`, `/[sessionId]`, `/[sessionId]/connect`, `/[sessionId]/edit`, `/[sessionId]/registrants` (all `ƒ`), 12 `/api/admin/santas-workshop/**` routes, `/api/zeffy/webhook`, and `/santas-workshop` (static, 5m). |
| Migrations, `pnpm db:migrate` x2 on the branch | **PASS** | both runs exit 0 and their logs are **identical** after stripping timings; the only `0113`/`0114` output is 31 "relation ... already exists, skipping" notices (8 tables incl. `zeffy_events`, 23 indexes); the 17 guarded FKs and the `0114` statements are silent. `pnpm dev` replayed them a third time at server start with no error. *Not independently re-proved:* the first-run "creates everything" case, because the branch already held the objects from the database-admin's run; that proof is theirs (their log, "Idempotence proof"). |
| Pre-push unguarded-statement grep on `0113`/`0114` | **PASS** | `0113`: no hits; 17 `ADD CONSTRAINT`, each behind a `pg_constraint` guard (18 mentions incl. one comment). `0114`: the 3 `INSERT INTO` hits are line-grep false positives; each is inside a `DO $$` block with `WHERE NOT EXISTS` on the following lines (read in full). |
| `santas_workshop.manage` bindings (read-only SQL) | **PASS** | bound to exactly `admin` and `board_member`; `budget_committee`, `member`, `notetaker`, `treasurer`, `volunteer` have it = false. |
| `getAdminProtectionRules()` | **PASS** | returns `{ segment: "santas-workshop", requiredFeatures: ["santas_workshop.manage"] }` (single key). |
| Playwright Slice 1 specs vs `:3101` | **PASS** | `santas-workshop-admin-gate` 3, `santas-workshop-webhook-to-roster` 7, `santas-workshop-session-edit` 7: **17 / 17 passed, 0 skipped**, 1.3 min, serial, `ZEFFY_WEBHOOK_SECRET=whsec_devexample`. No rows left behind (0 sessions/orders/stuffies/users added). |
| Feature-gate audit | **PASS** | below |
| PII / secrets / house rules | **FAIL on D3 only** | below |

### Unit tests Phase 3 names for Slice 1 and the addendum, confirmed by name in the verbose run
All present and green: `zeffy/signature` (13: valid, one-byte tamper, no `v1`, non-hex/wrong-length without throwing, 301 s past and future, 299 s accepted, repeated `v1`, non-integer `t`, raw bytes, length-before-`timingSafeEqual`, replay inside tolerance), `zeffy/snapshot` (9), `zeffy/client` (15: bearer, campaign required before any request, `next_cursor`, spacing, `Retry-After`, dev allowlist refuses without a request, other campaigns discarded, 404 -> `{gone:true}`, key never in a message), `zeffy/webhook-handler` (19: 400 matrix incl. oversize and identical bodies, processed/failed/received duplicates, retryable 500, permanent 200, unmapped = null payload, missing secret 500), `question-fields` (normalization and consent tables), `payment-mapper` (three-ticket order, donations never stuffies, unmarked rate, unmatched question, unnamed stuffy, consent matrix, window match/unmatch, fallback scope, two strings one field, 5,000+ truncation, HTML verbatim, pending/failed, refund derivations incl. Keep-then-bigger-refund), `payment-apply` (22: lock first, stale refused, identical re-apply writes only `snapshot_at`, no worker-owned column in any `.set()`, `not_in_order_now`, `session_mismatch`, `markPaymentDeleted`), `zeffy-consumer` (incl. refund notification fetches then applies, 404 flags, no Zeffy call during apply), `session-input` (PATCH rejects `kind`/`slug`), `session-checklist`, `session-schema` (14), `permission-migration` (5), `permissions.test.ts` nav-entry (2) and `default-role-bundles.test.ts`, `zeffy/fixtures-no-pii`, source scans `admin-routes-gate`, `zeffy-module-source` (`consumer-injection`, `secrets-not-logged`, test-helpers import ban, `webhook-route-source`), plus `sync`, `remap`, `zeffy-reprocess`, `session-queries`, `redact`.
Addendum: `session-edit-patch` (7), `unmatched-window-answers` (3), `admin-ui` window-copy tests ("window_in_use names the remedy and unmapped_window ends with it"; "post-save Remap notice appears only when a label changed"), `admin-ui-source` (six pages gate before queries; edit form has no `kind`/`slug` input and sends changed fields only; no raw HTML, no native dialogs), `session-update` (3), `remap` (rename to stored answer clears `unmapped_window`; rename away flags; rename back restores).
Not in this slice by design: `state-machine.test.ts` (only the tuple exists; transitions are Slice 2).
Weaker than the design wording (not defects): "call-order assertion" that the Zeffy HTTP call is outside the transaction is met by the `zeffy-consumer` test "the Zeffy call is never made while apply is running" plus the `payment-apply` source scan, not by a call-order spy in `payment-apply` itself.

### Coverage (v8, `src/lib/**`)
`permissions.ts` **100 / 100 / 100** (stmts/branch/lines; target 100); `events.ts` 94.9 / 88.4 / 96.3 (target 90); `members.ts` 86.8 / 70.8 / 85.3 (target 80); overall `src/lib` 75.2 / 73.6 / 76.5 (target 70). New: `zeffy/signature` 100, `webhook-handler` 93, `client` 84, `snapshot` 88; `payment-mapper` 98.7, `payment-apply` 93.8, `session-input` 94.4, `zeffy-consumer` 85.9, `sync` 85.7. Low by nature (DB-bound, exercised by e2e and my live run): `session-queries` 20.9, `remap` 42.9 (the DB loop), `zeffy/events-queries` 0, `admin-http` 0, `session-log` 50.

### Feature-gate audit (read from the route files, then exercised)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET/POST /api/admin/santas-workshop/sessions` | yes (first statement) | yes (second) | `SANTAS_WORKSHOP_MANAGE` |
| `GET/PATCH .../sessions/[id]` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `GET .../sessions/[id]/stuffies` (parent name, email, mobile) | yes | yes | `SANTAS_WORKSHOP_MANAGE` (admin + board only; this is the bulk-PII route and the key is the narrow one) |
| `GET .../zeffy/events`, `GET .../zeffy/questions` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `PUT .../zeffy`, `PUT .../zeffy/question-map` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `POST .../zeffy/sync`, `.../zeffy/reprocess`, `.../zeffy/payments/[paymentId]/reprocess` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `GET .../zeffy/campaigns`, `POST .../zeffy/events/[eventId]/reprocess` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| 6 admin pages (list, new, overview, connect, registrants, edit) | yes, in the page body | yes | `SANTAS_WORKSHOP_MANAGE`, then `redirect("/access-pending")` before any query (scan-tested, and read) |
| `POST /api/zeffy/webhook` | **deliberately none** (the signature is the authentication; route has no `auth` import, scan-tested) | n/a | n/a |

Exercised, not inferred: 14 admin route/method combinations and 6 pages as (a) anonymous: 14 x 401, pages 307 -> `/signin`; (b) a signed-in `member`: 14 x 403, pages 307 -> `/access-pending`; (c) a signed-in user whose role holds `admin.dashboard` + `events.edit` but **not** the workshop key (temporary role `qa_dash_only`, the sharpest negative case): 14 x 403, pages 307 -> `/access-pending`. Mutations in (b) and (c) were real requests (create session, PATCH name, PUT campaign) and changed nothing (verified by row counts). The temporary role and both users were deleted afterwards.

## Manual click-through

Environment: `PORT=3101 pnpm dev`, own branch DB, e2e admin signed in through the real credentials form, fixtures posted with `scripts/zeffy-webhook-fixture.ts` (the shipped script) and my own signed-POST helper using the same `signZeffyBody`. Desktop 1280/1440 and 360 px (screenshots in `<scratchpad>/santas-workshop-sessions/`).

| Flow | Result | Notes |
|------|--------|-------|
| List, empty state | pass | "No sessions yet. Create a practice session first to try the whole flow, then the real one." Nav entry "Santa's Workshop" under ENGAGEMENT. |
| New session | pass | Default kind Practice; button reads **"Create practice session"**; windows pre-filled "4:00 to 5:00 PM / 5:00 to 6:00 PM / 6:00 to 7:00 PM"; toast "Session created."; lands on the overview. |
| Overview and go-live checklist | **fail (D1)** otherwise pass | Eight rows with states and remedies ("Missing: API key.", "Not yet mapped: Stuffy name, Snack choice, Drop-off window."), counts, zeffy card (webhook secret Set / API key Not set, booleans only). Doubled weekday on the Schedule card (D1). |
| Connect by hand + confirm dialog | pass | Dialog names the campaign title and says "You typed this form in by hand, so it will be saved without Zeffy checking it."; amber "saved, but Zeffy could not be asked" note. |
| Fixture webhook, 3-ticket order | pass | 200 `processed`; 1 order + 3 stuffies; event stored with a whitelisted snapshot. |
| Redelivery (same event id) | pass | 200 `{"duplicate":true}`; still 1 order, 3 stuffies. |
| Unmapped campaign | pass | 200 `ignored_unmapped`, `payload` NULL, no `session_id`, nothing stored. (First attempt returned 500 because my fixture reused a payment id already stored under the practice session, so the consumer correctly took the known-payment refetch path and failed `no_api_key`; with an unseen payment id it is `ignored_unmapped`. My input, not a defect.) |
| Bad signature | pass | wrong secret, missing header, malformed header: 3 x 400 `{"error":"bad_request"}`, no row written. |
| Id-only `payment.updated` / `payment.deleted`, no API key | pass | 500 `{"error":"failed"}`; row `failed`/`no_api_key`; redelivering the same event id re-ran it (`attempts` 1 -> 2). Also 500 for an *unknown* payment (needs the fetch). |
| Registrants: 3 stuffies, raw unmatched text, consent flag | pass | Before mapping: three "Unnamed stuffy, order of 3" cards with reasons and the raw question/answer pairs ("Stuffy's name * : Mister Whiskers" ...). After mapping: names, "What it is", Snack, Note to Santa; "Photo sharing OK" only for the "Yes" ticket, "No photo sharing" for "No thank you" and for absent. Cards at 360 px (no horizontal scroll), real `<table>` at 1440. |
| Question map UI incl. `ignored` | pass | 10 selects, "Ignore: the club does not need this" chosen for "Anything else we should know?"; Save and re-read: "Every question is matched or ignored." |
| Remap and Reprocess microcopy | pass | "Re-read 3 registrants; 3 changed." / "0 changed." / "Reprocessed: Failed, will retry." / "Reprocessed: Processed." The failed-event message does not say why (the row chip says `no_api_key`); cosmetic. |
| Edit page flow (addendum) | pass | Chip "5:00 PM – 6:00 PM (1 order)" -> label -> Save: "Saved. Registrants are not updated until you run Remap. ..." with "Run Remap now": before 3 flagged, Remap "3 changed", after 0 flagged and window shows; reversed (label "5:00 to 6:00 PM") -> Remap -> 3 flagged again; restored -> 0 flagged. |
| In-use window removal | pass | "Registrants chose this window; change its label instead of removing it." Nothing saved (labels unchanged after reload). |
| `kind` / `slug` frozen | pass | no inputs; "Fixed once created: Kind Practice, Short name ..."; API `PATCH kind` and `slug` -> 400 `immutable_field`. |
| Recalculate proposes without saving | pass | editing pickup to 12-27 then the button moved `crewClosesOn` to 12-28 and personal purge to 2027-01-26; after reload all dates were the saved ones. |
| 360 px, all six pages | pass | `scrollWidth == clientWidth == 360` on every page; no element wider than the viewport; no console errors (an earlier hydration warning in the admin sidebar was an artifact of Playwright's screenshot caret hiding; with no screenshots, existing pages and all new pages log nothing). |
| Permission gate | pass | see audit above. |

### Stubbed-Zeffy phase (clearly **not** real Zeffy)
Zeffy's API base is hard-coded, so the notification -> fetch path needs a key. I restarted my server with a QA preload (`<scratchpad>/.../fake-zeffy.cjs`, `NODE_OPTIONS=--require`) that answers `fetch()` to `api.zeffy.com` **only**, from a JSON file, with a fake key `fake-dev-key` and `ZEFFY_DEV_CAMPAIGN_ALLOWLIST=campaign-practice-01,campaign-second-02`. No network call to Zeffy was made, no real credential used. It proves our code's behavior against the documented shapes; it does not prove Zeffy's actual shapes.

| Check | Result | Notes |
|-------|--------|-------|
| "Find forms in Zeffy" | pass | lists the two allowlisted forms, **not** "White Cane" (filtered by the allowlist); the connected form and its rate preselected; the form already connected to another session is disabled ("already connected to another session"). |
| Full refund via `payment.updated` (id only) | pass | the earlier failed event, redelivered, fetched the payment and went `processed`/`applied` (`attempts` 3); order `refund_status=full, refunded_cents=4500`; all three stuffies show **Refunded**; overview "Open refunds 1". |
| Partial refund | pass | all three show "Partly refunded ($15.00)"; open refunds 1; no per-stuffy removal. |
| Refund reversed | pass | open refunds 0, badges gone. |
| `payment.deleted` -> 404 on fetch | pass | `payment_deleted = true`; derived "Refunded" badge on all three. |
| Sync from Zeffy | pass | "1 registration found that the live feed had missed, now added; 1 updated; 1 no longer in Zeffy (flagged for review); 1 with a refund that differed (flagged for review). 0 already up to date." New order from `sync` with 2 stuffies; the order absent from the list was fetched, 404, flagged deleted; "Last Sync" updated; `sync_run` audit row holds counts only. |
| Reprocess payment | pass | owning session `processed/applied`; wrong session 409 `session_mismatch`; unseen payment 404 `payment_unknown`. |
| Connect against the allowlist | pass | unknown rate id 400 `unknown_rate`. Nonexistent or non-allowlisted campaign: 200 with `verified:false` because the dev allowlist means Zeffy "cannot be asked" (design deviation 5); with no allowlist (production) the code path is `404 campaign_not_found` (read at `session-queries.ts:358`, **deferred**, below). |

## Adversarial results (webhook and admin)

| Probe | Result |
|-------|--------|
| Body 1.2 MB, validly signed | 400 `bad_request`, no row |
| Body 300 KB (over the 256 KB cap), validly signed | 400 |
| Non-JSON validly signed / unsigned; empty body; `[]`; `null` | 6 x 400, identical bodies, no rows |
| Validly signed with `t` = 1 h ago, 1 h ahead | 2 x 400 |
| Validly signed with `t` = 299 s ago | accepted by the signature check (reached the consumer) |
| Replayed event id (processed / failed) | processed: 200 `duplicate:true`, consumer not re-run; failed: re-run (`attempts` increments) |
| `payment.created`, `contact.updated` | 200 `ignored_type`, ids only (the `contact.*` row stores the contact id in the `payment_id` column; cosmetic) |
| One campaign to two sessions | 409 `campaign_in_use`, "That Zeffy form is already connected to another session" |
| Buyer text `<script>`, `<img onerror>`, `<svg onload>` in answer, question text and parent name; `=HYPERLINK(...)` | rendered as literal text on registrants, Connect (question list) and overview; `window.__pwn` never set; 0 injected elements; 0 native dialogs. |
| Tampered `cursor` on Sync / Remap (object with SQL text, string) | 400 `invalid_input`, tables intact |
| Non-uuid / unknown session id | 404 |
| Hostile `q`, `page`, `state`, `flag` on registrants | 200 empty list |
| Create with bad slug, non-JSON body | 400 with field named |
| A payment whose item ids repeat another payment's | `db_error` 500 (retryable) from the `(session, item key)` unique index; my fixture's fault (real Zeffy item ids are unique); noted only because the event row says `db_error` with no further reason and the server logs nothing. |

House rules: **no `console.log`** in any new non-test file; one `console.error` (`admin-http.ts:60`, logs error name and code only, never a body or key); **no `window.alert/confirm/prompt`** (the one `confirm(` hit is a local function name in `connect-panel.tsx`); no `dangerouslySetInnerHTML`; **nothing sends email** (no `sendEmail`/`sendBulk`/`email_queue` reference in any new file; `email_queue` count on the branch was 1362 before and after my session, all recent rows `blocked_non_production`, `RESEND_API_KEY` empty). **Personal data:** only D3. Fixtures use `example.invalid` and "Pat Exampleton"; the migrations, scripts, e2e specs and fixtures are clean; no phone or street pattern anywhere.

## Cleanup and process
Rows I created were deleted and the branch re-measured against my baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_session_log` 0, `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362 (all as before). `zeffy_events` holds 1 row, `smoke-2` (`failed`/`no_api_key`), which **predates my run** (api-developer's smoke test left it; I did not delete another agent's row). My `:3101` servers (two, the second with the preload) were stopped by PID; no process of the worktree remains; the main tree's `:3000` was never touched. `create-test-user.mjs` was not run. Nothing committed.

## Deferred to post-deploy (needs a real Zeffy key or a deployed host); none of these is recorded as a pass
1. **Signature format against real Zeffy.** Our tests and fixtures sign with our own `signZeffyBody`, so they prove self-consistency, not that `Zeffy-Signature: t=...,v1=...` / HMAC over `"{t}.{rawBody}"` matches what Zeffy sends. Step: in Zeffy Settings > Integrations > Webhook register the production URL, use "send test event" (or buy a ticket on the practice form) and confirm the `zeffy_events` row is `processed`, not a 400. (S2b; also DECISION-123 "Unmeasured".)
2. **SW-L8 on the deployed route**: with the real secret, repeat the matrix I ran locally (forged signature, stale `t`, replayed event id) against the production host and record counts of 400s and duplicate no-ops. Local counts for comparison: 3 forged-signature 400s, 2 stale-`t` 400s, 7 malformed/oversize 400s, 2 duplicate no-ops.
3. **Set `ZEFFY_API_KEY` before registering the webhook URL.** Observed locally: with no key, every id-only `payment.updated` for a payment we have never seen returns 500, and the webhook is organization-wide, so White Cane and any other form's refund/edit events would 500 and be retried by Zeffy for 3 days. (Not a code defect; a deploy-order requirement to put in the runbook.)
4. **S2a spike**: `pnpm exec tsx scripts/spike-zeffy.ts --campaign <practice id>` (dry run first) with the real key; decide `ITEM_KEY_STRATEGY` and `CONSENT_AFFIRMATIVE`; confirm `Item.id` stability across an order edit, whether list responses carry `items[]`/`questions[]`, what a partial refund does to `items[]`, the real question strings and checkbox shape, whether a $0 ticket fires `payment.completed`.
5. **Real Connect**: with the key and no allowlist, "Find forms in Zeffy" lists the real campaigns; a nonexistent campaign id returns `404 campaign_not_found`; a wrong rate id returns `400 unknown_rate`; Sync against the practice form reports sensible counts and respects the 100/min limit.
6. **After deploy, `0114` reaches existing board members only after sign-out/in** and about 60 s of server permission cache: confirm the nav entry appears for a real board member.
7. **Deploy log**: `pnpm build` runs `drizzle-kit push --force` against production (B-165 prompts are known); confirm no statement names a `sw_`/`zeffy_` object after the first deploy.
8. **Session edit on a real form**: the buyer's drop-off answer text (not my fixture's) joins to a window label; confirm the chip appears with real text and the default labels ("4:00 to 5:00 PM") are what the club puts on the Zeffy form.
SW-L1 to L7 and L9 to L13 belong to Slices 2 to 5 and are not applicable yet.

## Other observations (not defects)
- The Phase 3 test list asks for a payment-apply call-order spy; the equivalent evidence is described above.
- `e2e/santas-workshop-admin-gate.spec.ts` covers the `member` role and one API route; my broader gate matrix (three identities, 14 routes, 6 pages) is manual. Consider extending the spec to loop the routes; not required.
- The admin layout renders a `<main>` inside `<main id="main-content">` (pre-existing, outside this feature); Playwright's strict `main` locator trips on it.
- Registrants table wraps a long email mid-word at 1440 px ("parent.one@example.inva / lid"); cosmetic.
- Pre-existing: one `smoke-2` row in `zeffy_events` on the branch.

## Regression tests added
None added by qa: no code defect was fixed in this phase (FAIL hands back). When D1, D2 and D3 are fixed the implementers should add, per "failing test first": D1 a render/format assertion on the overview schedule line (no repeated weekday); D2 a `recentEvents` test where an id-only event with `session_id` set and `campaign_id` NULL is returned for that session; D3 nothing new (the pre-push grep is the guard).

## Phase 5 — Verification — 2026-10-12

**Owner:** qa
**Status:** complete (verdict FAIL, handed back)

### Summary
Slice 1 **FAILS** on three small defects (D1 doubled weekday on the overview, D2 failed refund-notification events hidden from the Connect page's Reprocess list, D3 a personal-domain test address that the pre-push PII grep rejects). Everything else passes: typecheck, lint, 4143 unit tests, production build, migrations idempotent on re-run, 17/17 Playwright, both gates on all 12 admin routes and 6 pages with three identities, the full webhook adversarial matrix, hostile text inert, refund/Sync/Remap/Reprocess behavior including against a stubbed Zeffy API. Real-Zeffy items are listed as deferred, not passed.

### What I did
- Read the whole work-log and DECISION-121/123/125; ran every gate; confirmed the named unit tests by name; read the 12 routes and 6 pages for gates and exercised them as anonymous, member and dashboard-only users.
- Drove the admin UI at desktop and 360 px; fired the fixture script and a signed-POST helper for the full webhook matrix; ran a stubbed-Zeffy phase for refunds, Sync and Find forms.
- Cleaned every row I created, stopped both servers by PID, recorded tree state.

### Outputs
- `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` (this section, Per-Phase Status row). No code changed. Temp scripts and screenshots in `<scratchpad>/santas-workshop-sessions/`.

### Open questions / handoff notes
- **Next agent: the original implementers.** D1 -> **ux-developer**; D2 and D3 -> **api-developer**. Then qa re-runs `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`, the three specs, the pre-push PII grep, and re-checks D1 on the overview and D2 on the Connect page (fire a `payment.updated` at a mapped payment with no API key and see the failed row listed with its Reprocess button). Analyst Phase 6 waits for a PASS.
- Orchestrator: item 3 of the deferred list (set `ZEFFY_API_KEY` before registering the webhook) belongs in the deploy runbook; item 1 needs the user to register the webhook against a deployed host.

---

## Phase 5 re-verification (after the D1/D2/D3 fixes) — 2026-10-12

**Owner:** qa · **Status:** complete · **Verdict: PASS** (Slice 1)

**Tree state measured:** `HEAD` = `6343fa6a2ebb49766d2ecb58605a09477f5b1ce3` (v1.93.0) plus the **uncommitted Slice 1 diff in the pipeline worktree** (82 entries in `git status`: the first-run diff plus the QA fixes: `schedule-card.tsx` + test, `events-queries.ts` + test, `redact.test.ts`, `config.ts`/`client.ts` base-URL override, mapper test). No migration changed since the first run. Branch `ep-divine-boat` only; nothing committed.

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm exec tsc --noEmit` | PASS | exit 0 |
| `pnpm lint` | PASS | 0 errors, the same single old warning |
| `pnpm test` | PASS | **245 files, 4156 / 4156** passed (was 243 / 4143) |
| `pnpm build:only` | PASS | exit 0, no warnings, 294 route rows; the same 20 workshop/zeffy rows (6 pages, 12 admin routes, webhook, `/santas-workshop`) |
| Playwright Slice 1 specs on `:3101` | PASS | gate 3 + webhook-to-roster 7 + session-edit 7 = **17 / 17**, 0 skipped, 1.3 min; no rows left |
| PII grep (pre-push recipe: personal-domain emails over the whole repo, phones, street addresses) | PASS | **prints nothing** (D3 fixed: `redact.test.ts` now uses `someone@mail.example.test`, and its assertion still requires the redactor to remove it) |
| New tests confirmed by name | PASS | `schedule-card.test.tsx` (each weekday once); `events-queries.test.ts` `sessionEventsFilter` (5: session OR campaign, failed id-only event matched by the `session_id` arm, listed once after a retry, never another session's ids, no-campaign session); `client.test.ts` `ZEFFY_API_BASE_URL override` (3: honoured outside production, **ignored in production**, default when blank); `payment-mapper.test.ts` "additional_donation items stay on the order total and never produce a stuffy, mixed with tickets" |

### The three targeted live checks
- **D1 PASS.** Overview Schedule card, read from the DOM: `Drop-off = Friday, Dec 18`, `Photos = Saturday, Dec 19`, `Pickup = Sunday, Dec 20` (each weekday once).
- **D2 PASS, both halves.**
  - *Failed, no API key* (server started with `ZEFFY_API_KEY=` forced empty): after a signed `payment.completed` for a mapped payment, a signed id-only `payment.updated` and `payment.deleted` for it both returned 500 and were stored `failed`/`no_api_key` with `campaign_id` NULL. Connect's "Recent Zeffy events" listed **both** with "Failed, will retry", the `no_api_key` code and a **Reprocess** button (3 buttons incl. the processed `completed`). The id-only `payment.updated` for a payment of *no* session was correctly not listed.
  - *Successful retry via the local stub* (`ZEFFY_API_BASE_URL=http://127.0.0.1:3199`, fake key): pressing Reprocess on the failed `payment.updated` row gave "Event reprocessed."; the row became `processed`/`applied`, gained `campaign_id`, order `refund_status=full, refunded_cents=4500`, and the list showed it **exactly once** (one `payment.updated` row, one `payment.deleted` row). A signed redelivery of the failed `payment.deleted` event re-ran it (`processed`) and the next redelivery was `duplicate:true`; the events API returned 3 events with unique ids.
- **D3 PASS.** The grep above prints nothing.

### Things I want on the record
1. **A `ZEFFY_API_KEY` is now present in the worktree `.env.local`** (it was not there during my first run; the file is dated after it). I did not print it and never let it be used. In a non-production process the Zeffy client refuses every call unless the campaign is in `ZEFFY_DEV_CAMPAIGN_ALLOWLIST`, and checks the allowlist before any request in all four methods, so with the key present and no allowlist my first re-verify server answered id-only events `ignored_unmapped`/`out_of_scope` without contacting Zeffy (this is the deny-by-default doing its job, and it is why the no-key case had to be reproduced by forcing the variable empty). For the stub phase I forced `ZEFFY_API_KEY=fake-dev-key` into the process environment (which wins over `.env.local`) **and** pointed the base URL at `127.0.0.1:3199`; the stub logged every request's bearer: 2 requests, both `FAKE-OK`, none `UNEXPECTED`. Coordinator: if that key is real, it is a production credential in a dev file (the `RESEND_API_KEY` incident shape); keep `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` unset-or-practice-only locally, or remove it.
2. **Correction to my first report's email claim.** I wrote that `email_queue` was 1362 "before and after". That baseline was taken after my own e2e and fixture sign-ins, so it did not prove "no mail". The accurate statement: the specs' disposable member/board users, and my two fixture users, trigger the existing "New portal user needs member record review" notice on first sign-in. Four such rows were created by QA runs (two per e2e run, ids `c103aa5d-...`, `814f12d6-...`, `90298c70-...`, `8e47a15d-...`), all `status=blocked_non_production`, `sent_at` NULL, addressed to the club domain, with `RESEND_API_KEY` empty: nothing was delivered. That is existing sign-in behaviour, not workshop code (no new file references `sendEmail`/`email_queue`). I deleted those four rows (count now 1360).
3. `e2e/santas-workshop-webhook-to-roster.spec.ts` "sync is blocked with a clear reason..." is key-agnostic (it passed with and without a key present). Fine; it just does not assert the no-key text.
4. All deferred post-deploy items from the first report stand unchanged (real signature format, SW-L8 on the deployed route, `ZEFFY_API_KEY` before registering the webhook, S2a spike, real Connect `404 campaign_not_found`, board sign-out/in, deploy log, real window text).

### Cleanup
Session, order, stuffies, log rows and every `qa*` `zeffy_events` row deleted; branch re-measured: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`, which predates me), `users` 53, `roles` 7, `user_roles` 72. Servers stopped by PID (dev `:3101` x3 over the session, stub `:3199`); `:3101` and `:3199` free; no process of the worktree remains; `:3000` (pid 14545, the main tree) was never touched. No commit.

### Verdict
**PASS.** D1, D2 and D3 are fixed and verified live; every gate is green on the tree state above; no new defect found. **Phase 6 next** (analyst), carrying the deferred post-deploy list.

---

## Re-verification 2 (N1 to N3) — 2026-10-12

**Owner:** qa · **Verdict: PASS** (Slice 1 stays PASS). Tree state: `HEAD` `6343fa6a2ebb49766d2ecb58605a09477f5b1ce3` plus the uncommitted Slice 1 diff in the pipeline worktree (83 `git status` entries: the earlier diff plus the N1 to N3 UI changes in `admin-ui.ts`, `connect-panel.tsx`, `zeffy-event-codes.test.ts` and the updated tests). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the same one old warning) |
| `pnpm test` (full) | PASS: 246 files, **4189 / 4189** |
| `pnpm build:only` | PASS: exit 0, no warnings, 294 route rows, the same 20 workshop/webhook rows |
| Playwright Slice 1 specs on `:3101` (server with `ZEFFY_API_KEY=` forced empty) | PASS: **17 / 17**, 0 skipped |
| PII grep (pre-push recipe) | PASS: prints nothing |

### The three live checks
- **N1 PASS.** Local stub (`ZEFFY_API_BASE_URL=http://127.0.0.1:3199`, fake key, dev allowlist) returned one succeeded payment on the connected form whose ticket `rate_id` (`rate-other`) was not marked. Sync, pressed both from the inline prompt and from "Sync from Zeffy", read: "Synced 0 orders; nothing needed changing. 1 payment skipped because its ticket rate is not marked as the stuffy ticket. Review under Connect." The phrase "Everything matches Zeffy" was absent. Control with an empty stub list: "Everything matches Zeffy. 0 already up to date." (the all-clear still appears when nothing was skipped). No order or stuffy was created for the skipped payment.
- **N2 PASS.** With a key: after "Connect this form" and the confirm dialog, the note read "Connected. Zeffy confirmed the form and its ticket rates. Run Sync now: payments made before connecting are only picked up by Sync." with one working **Run Sync now** button; pressing it ran Sync inline and showed the outcome above in the same panel. Without a key (server with the variable forced empty): the note read "Saved, but Zeffy could not be asked to confirm the form ... Payments made before connecting are only picked up by Sync, which needs the Zeffy API key. Set it, then run Sync." and there were 0 buttons.
- **N3 PASS.** A signed id-only `payment.updated` for a mapped payment with no key: the Connect events list showed "Zeffy could not be asked for this payment because the API key is not set. Set it and press Reprocess." then "Code for support: no_api_key", "Failed, will retry" and a Reprocess button; the processed `payment.completed` row read "Registrations were added or updated." / "Code for support: applied".

### Surprises
1. **My stub was incomplete on the first try, not the code.** The standalone stub server lacked the `GET /api/v1/campaigns/{id}` route (my earlier preload version had it), so Connect's verification got a 599 and the page correctly showed "Zeffy could not be reached. Try again in a minute." I fixed the stub and re-ran; every N2/N1 result above is from the re-run. Worth knowing only because it shows Connect fails closed and says so in plain words when Zeffy errors.
2. The worktree `.env.local` still holds a `ZEFFY_API_KEY` (see Re-verification 1, item 1). I never let it be used: the server was started with the variable forced empty (no-key checks, e2e) or forced to `fake-dev-key` with the base URL pointing at the local stub (stub log: every request `bearer=FAKE-OK`, none unexpected).
3. The gate spec's two disposable users again each triggered the existing "New portal user needs member record review" notice (2 `blocked_non_production` rows, ids `9b75281c-...` and `ead6c74f-...`). Existing sign-in behaviour, not workshop code; deleted. `email_queue` is back to 1360.

### Cleanup
Session, orders, stuffies and `qa*` event rows deleted; branch re-measured: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`, predates me), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1360. Dev server (`:3101`, twice) and stub (`:3199`) stopped by PID; both ports free; no worktree process remains; `:3000` (pid 14545) untouched. Phase 6 notes N4 and N5 remain open as the analyst filed them; the deferred post-deploy list is unchanged.

---

# Phase 6 — Shipped vs Intent (analyst)

Later slices get their own heading below this one. Slice 1 is judged alone.

## Phase 6 — Slice 1 — 2026-10-12

**Scope judged:** schema `0113`/`0114`, the `santas_workshop.manage` permission and nav entry, `src/lib/zeffy/`, `POST /api/zeffy/webhook`, the workshop consumer/mapper/`applyPaymentSnapshot()`, and the sessions admin (list, new, overview with the go-live checklist, Connect with the question map, Sync/Remap/Reprocess, registrants read-only, the session edit page from the Phase 3 addendum). **Out of scope, not gaps:** worker screens, crew code, photos and the `PhotoStore`, collage, frames, family page, purge/reset, status buttons, manual add, refund Keep/Withdraw, attention dismissal (Slices 2 to 5).

**Tree state measured:** worktree HEAD `6343fa6` (v1.93.0) plus the uncommitted Slice 1 diff. Method: the whole work-log, then the shipped code (`src/lib/zeffy/`, the consumer, mapper, apply, sync, checklist, admin pages/components/routes, both migrations, the e2e specs), then a re-run of 35 test files / 673 tests over the Santa's Workshop, Zeffy, permissions, role-bundle and admin-gate suites (all green). I started no server and made no Zeffy call: the live evidence is QA's (17/17 e2e, the stubbed-Zeffy phase, the adversarial matrix), which I read and spot-checked against the code. **Everything below that depends on Zeffy's real payload shape is verified only against our own fixtures and a stub** (QA's own wording), and I carry it as unmeasured.

## VERDICT

**SHIP WITH NOTES.** Slice 1 delivers what Phase 1 and the addendum promised for ingestion and session setup, the permission model is right, and the failure paths that matter (forged delivery, replay, out-of-order refund, unmapped campaign, hostile text) are covered and were exercised. Three small items (N1 to N3) should land before Nov 8 because they sit on the setup and Friday-Sync path; one hard condition (N4) is that manual add and the refund/attention actions arrive with Slice 2; one measurement gate (N5) must close before registration opens. None reopens a phase.

## ONE-LINE TAKE

> The club can now create a Santa's Workshop session, connect the real Zeffy form, and watch each ticket arrive as a stuffy within seconds of payment, with anything it could not understand flagged instead of dropped, refunds marked instead of deleted, and a Sync button as the safety net for a webhook that dies silently; what it cannot yet do is anything a volunteer touches.

## What's Working

- **The org-wide webhook is treated as hostile and shared.** Every White Cane gift reaches the endpoint; an unmapped campaign is logged by ids and time only (`payload` NULL, no `session_id`) and nothing is stored. A signed forged/stale/oversize/malformed delivery gets one identical 400 and no row. QA reproduced both; the code agrees (`webhook-handler.ts` keeps a payload only when a session id is set).
- **Retry semantics are right where it counts.** Dedupe applies to terminal outcomes only, so a delivery that failed (database or Zeffy fetch) re-runs on Zeffy's retry instead of being swallowed. QA saw `attempts` climb 1 to 3 on one event id and then `duplicate: true`.
- **One write path.** Webhook, Sync and Reprocess all call `applyPaymentSnapshot()`: advisory lock on the payment, stale-snapshot refusal (a days-late retry cannot un-refund), import-owned columns only, never a delete. Re-apply is idempotent (QA: redelivery adds no stuffy).
- **Refund is derived, not stored per stuffy** (Phase 3 ruling 7). Full refund, partial refund, reversed refund and a payment that 404s each behaved as specified in QA's stubbed phase; a partial refund flags the order only and never removes a stuffy.
- **"Needs attention" does what Phase 1 asked.** An unmatched question or an unmapped required field keeps the stuffy and shows the raw question and answer to the admin (capped, rendered as text; `<script>`/`<img onerror>` rendered inert in QA). The question map accepts several strings per field and an `ignored` key, and Remap re-applies it locally with no Zeffy call.
- **The setup path is a real gate, not a hope.** The overview checklist names what is missing in plain words ("Not yet mapped: Stuffy name, Snack choice, Drop-off window."), shows webhook secret and API key as booleans only, and carries the last-event row and the drop-off-morning Sync row.
- **The edit page closes the one hole the first design left** (a mistyped drop-off label that cannot be fixed): chips of "answers that matched no window" with counts, Save, then an explicit Remap, reversible in both directions (QA walked rename, flag returns, restore).
- **Permission model is correct and tested twice.** One key, bound to `admin` and `board_member` only (verified by read-only SQL on the branch), nav entry derived into the proxy rule, every page and all 12 admin routes call `auth()` then `hasFeature()` in their own body, and QA exercised 14 routes and 6 pages as anonymous, plain member, and a user holding `admin.dashboard` + `events.edit` but not the key.
- **The page is quiet about what it does not do.** Nothing in the slice sends email (no `sendEmail`/`sendBulk`/`email_queue` reference in any new file), no native dialog, no `console.log`, no `dangerouslySetInnerHTML`, one `console.error` that logs a name and code only. Cards `rounded-2xl`, buttons `rounded-lg`; the only `rounded-full` items are chips (badges, the window-answer chips at 44 px with a focus ring) and a decorative checklist mark, all allowed by the chip rule.

## Intent-vs-Shipped Diff

Phase 1 addendum, Flow A and the go-live gate:

- **Registration arrival within about 30 s of payment.** Phase 1 said the stuffy is on the worker's list at the next refresh, with "Updated 12 s ago". Shipped: the stuffy exists in the database as soon as the signed delivery is processed inline (the response is sent last); the admin sees it on the registrants page on reload. The worker list and its freshness line are Slice 2. Delivery latency from Zeffy is **unmeasured** (S2b). Verdict: **matches for the server half; worker half deferred by design.**
- **Payment before mapping: logged by id only, recovered by Sync.** Shipped exactly: `ignored_unmapped`, ids and time, no payload; Sync lists the mapped campaign's succeeded payments and adds what is missing (QA: "1 registration found that the live feed had missed, now added"). Phase 1 also said the Connect step shows "N earlier payments exist in Zeffy. Sync to bring them in." Shipped: the Sync panel sits on the same page, but the Connect success note does not prompt it (it only says so in the unverified case). Verdict: **acceptable drift**, tightened by N2.
- **Unmatched question becomes needs-attention with raw text, taggable.** Shipped: stuffy created, flagged, raw pairs shown to the admin, assigned through the map, cleared by Remap. "Taggable" and the worker line "Details being checked" belong to Slice 2; nothing in the mapper can block tagging. Verdict: **matches.**
- **Drop-off window that matches no session window.** Shipped: `unmapped_window` with a message that names the remedy ("Fix the label under Edit session, then run Remap."), chips on the edit page, and a "No matching window" row with an explanation on the overview. Verdict: **matches (better than Phase 1: the remedy is one click).**
- **Refund is a flag, never a delete, derived from the order, never blocks a hand-over.** Shipped as the derived model of Phase 3 ruling 7; the worker badge and hand-over rules are Slice 2 consumers of `workerRefundBadge()`. The admin can see "Refunded"/"Partly refunded ($15.00)" and the open-refund count but **cannot yet resolve** (Keep/Withdraw). Verdict: **matches; resolution deferred (N4).**
- **Manual add is a required fallback.** Phase 1 made it required; Phase 3 scheduled it with Slice 2 (target Nov 20). **Not in Slice 1.** Is that acceptable before Nov 8? **Yes, on one condition.** Its job is the door on Dec 18 (Zeffy or its API down, a receipt shown, a comp), plus comps and offline sales between Nov 8 and the slice landing. No volunteer touches the roster before Slice 2, real registrants are not needed for tagging until about Dec 1, and a comp recorded in Zeffy itself arrives through the webhook like any payment. The condition: it ships in Slice 2, not later, and until then comps and walk-ups are kept on a paper list. A Zeffy-recorded offline payment with no custom answers will arrive "Unnamed stuffy" with no edit surface (ruling 16: withdraw and re-add) until Slice 2.
- **Go-live checklist.** Phase 1: connected, N rates marked, all questions mapped, last event, secret set. Shipped: all of those plus two `info` placeholder rows (storage tested, worker code) that say "arrives with the worker screens", and the Friday row. Verdict: **matches.** The amber rule differs slightly (see N6).
- **A dead webhook is silent, so the Friday-morning Sync is on the checklist.** Shipped: "Drop-off morning Sync" is `info` until Dec 18, `todo` from Dec 18 until a Sync on or after that day, and the last-event row turns amber after 24 quiet hours while registrants exist and drop-off has not passed. Nothing prompts anyone to open the page that morning; that is a human reminder (orchestrator, below). Verdict: **matches.**
- **Sync reports "in Zeffy but missing here / gone / refund differs".** Shipped for new, changed, gone, refund-differs. **Not shipped:** payments Sync *skipped* (not succeeded, no marked ticket rate, session mismatch) are counted in `skipped` and never shown, and the summary can read "Everything matches Zeffy" with skips present. If the club ever sells a second ticket rate that nobody marked, the Friday safety net would say all is well. Verdict: **regression against intent, small** (N1).
- **Reprocess an event or payment; failed events are visible and recoverable.** Shipped, including QA's D2 fix (a failed id-only `payment.updated`, stored with no campaign id, now lists on Connect and can be reprocessed). The row shows the machine code (`no_api_key`) rather than a sentence (N3). Verdict: **acceptable drift.**
- **Edit-page addendum** (editable fields, frozen kind and slug, window ids preserved, no silent recompute, Remap prompt after a label change, Recalculate button, "answers that matched no window" chips, button names the kind it creates). Verdict: **matches**, each point verified by QA's session-edit spec.
- **Permission model** (`santas_workshop.manage`; admin + board_member; proxy derived from `ADMIN_NAVIGATION`; pages and routes gate themselves; webhook has no `auth()` by design and a source scan pins that). Verdict: **matches.**

Phase 3 rulings (only those that touch Slice 1; the rest are later slices):

| # | Ruling | Verdict |
|---|---|---|
| 3 | Dedupe on terminal outcomes only | accept; QA reproduced the retry |
| 4 | Question match key is normalized text; type interprets, scope falls back | accept |
| 5 | `zeffy_item_key` via `itemKey()`, default `item.id` | accept; **unmeasured** (S2a) |
| 6 | No CHECK, no enum; text plus tuples plus partial unique indexes | accept; schema test pins it |
| 7 | Refund derived from the order | accept (differs from the addendum in storage only, not in what anyone sees) |
| 15 | All tables in one front-loaded migration pair | accept; idempotent on a second run, `push` proposes nothing for `sw_`/`zeffy_` objects |
| 16 | No admin edit of Zeffy-sourced stuffy fields | accept, with the Slice 2 dependency on manual add noted above |
| 18 | Question strings are learned from stored payments (Connect, then a purchase or Sync, then map, then Remap) | accept; it makes the test purchase a hard step of the setup order |
| 1, 2, 8 to 14, 17, 19 | dependencies, encrypted code, hidden portraits, camera, Drive, crew revert, pickup check | not in Slice 1; judged with their slices |

Phase 4 deviations: **database-admin** 1 (nav with the first page), 2 (no FK on the two photo pointer columns), 3 (array-default `SET DEFAULT` noise in `push`, same as `ledger_donors.emails`), 5 (branch verification) accepted; 4 (extra `push` prompts: `dues_settings_fiscal_year_unique` and ten FK names over 63 characters; every truncate prompt answered "No") accepted and goes to B-165 (N8); 6 (validator test moved) accepted. **api-developer** 1 to 8 accepted: the `info` placeholders, the extra `ignored` map key, `snapshot_at` stamped on an identical re-apply (needed for Sync's stale detection), dismissal reset when the reasons change, Connect proceeding unverified when Zeffy cannot be asked, `getPayment`'s out-of-scope variant, `toEmbedUrl` moved with four importers, and `ZEFFY_API_BASE_URL` (honoured only outside production, tested). Item 7 (narrowing increment 1's `public-page.test.ts` to five named lib modules) is accepted for now with a follow-up (N10). **ux-developer** 1 to 3 accepted (the `unmatched` DTO field stays admin-only, the window message names its remedy, practice is the default kind and the button states the kind); deviations 4 and 5 resolved by the edit page and by Slice 2. **QA fixes** D1 (weekday printed twice), D2, D3 verified fixed.

## What an admin sees on the morning of Nov 8

Admin menu, Engagement, "Santa's Workshop": a card for the real session (Real, Draft badges; stuffies, need-attention and "last Zeffy event 4 min ago" figures; an amber "No Zeffy form connected yet" if the Connect step was skipped). The overview opens on the go-live checklist (every row done except two grey placeholders and the Friday row), then four count tiles (Stuffies with the order count, Need attention, Open refunds, Withdrawn), "By stage" and "By drop-off window" lists, the schedule, and a Zeffy card with the form title, last event, last Sync and two Set/Not set lines. Each first order appears on reload as one card per stuffy with name, what it is, snack, note to Santa, consent flag, window, and the parent's contact (admin only). Anything odd carries an amber reason with the raw text. **What they cannot do yet:** activate the session, see a worker code, add a registrant by hand, resolve a refund or dismiss a flag. The session stays Draft; nothing about that blocks ingestion, which QA confirmed.

The one thing that will look wrong if setup was skipped: every first order is "Unnamed stuffy, order of N" with several amber reasons until the question map is assigned and Remap run. That is why a test purchase and the mapping belong **before** Nov 8 (deploy checklist, steps 8 and 9).

## Edge Cases

- Empty state (no sessions; session with no registrants; no events yet; no unmatched answers): **pass.** Sentences are specific ("Create a practice session first to try the whole flow, then the real one.", "After the Zeffy form is connected, each ticket sold appears here as a stuffy.").
- A campaign mapped to no session: **pass.** `ignored_unmapped`, ids only, 200, nothing stored; the admin sees nothing, by design (see the verification note in deploy step 7).
- A campaign mapped to the wrong session or twice: **pass.** 409 `campaign_in_use` in plain words; the Connect dialog names the form title; a payment already stored under another session fails `session_mismatch` rather than moving.
- A three-ticket order: **pass** (QA: 1 order, 3 stuffies, redelivery adds none). Rests on one unmeasured premise: that Zeffy returns one `ticket` item per attendee, not one item with a quantity. The OpenAPI document supports it (`Item.contact_id` is "the attendee, tickets only"; per-ticket `questions`), and nothing in the code reads a quantity. S2a settles it with a two-ticket purchase.
- A refunded order (full, partial, reversed, payment deleted): **pass** against stubbed Zeffy. Resolution actions not yet built (N4).
- Zeffy failure microcopy: **pass with a note.** Admin-facing sentences are human ("Zeffy could not be reached. Try again in a minute.", "Zeffy is limiting requests, continuing...", "Nothing already read was lost: run Sync again."). The events list prints the raw code beside a failed row (`no_api_key`), which is a code, not a stack trace, but not a sentence (N3). No path leaks a payload, a key or a stack trace; the webhook's only public answers are `ok`, `bad_request`, `not_configured` and `failed`.
- Hostile buyer text (HTML, `=HYPERLINK`, emoji, 5,000-character notes): **pass** (stored capped, rendered as React text, truncation visible via the `truncated` reason).
- Permission gate: **pass** (anonymous 401/307, plain member 403/`/access-pending`, near-miss role 403/`/access-pending`, admin and board member allowed). Board members need a sign-out/in after deploy because the nav and the proxy read the JWT.
- Mobile (360 px): **pass** per QA on all six pages (`scrollWidth == clientWidth == 360`), registrants as cards below `xl` and a table at `xl+`. One cosmetic: a long email wraps mid-word at 1440 px.
- Brand and dialogs: **pass.** `ConfirmDialog` on Connect; no native dialog anywhere.
- PII in the repository: **pass.** My grep over every new and modified non-doc file for personal-domain addresses, phone shapes and key/secret shapes prints nothing; fixtures use `example.invalid` and a unit test pins that.

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log entry. **N1 to N3 should land before Nov 8; N4 with Slice 2; N5 is a gate, not a code item.**

**N1 — Sync must show what it skipped (small, api + ux, before Nov 8).**
Proposed backlog text: *B-nnn Sync from Zeffy hides skipped payments. `SyncCounts.skipped` is collected (payment not succeeded, no marked ticket rate, session mismatch, purged) but `syncSummary()` never shows it and says "Everything matches Zeffy" even when payments were skipped. Show "N payments in Zeffy were not turned into stuffies" with the reasons split (no marked ticket rate is the one that matters: an unmarked second rate would otherwise sell tickets that never reach the roster), and never print "Everything matches" when skipped > 0. Test: a Sync over a fixture with one unmarked-rate payment prints the skip line.*

**N2 — Prompt Sync right after Connect (copy, before Nov 8).**
Proposed backlog text: *B-nnn After a successful Connect (verified or not), the note should say "Run Sync now to bring in any payments made before this form was connected" and link to the Sync panel; the registrants card on the overview should say so while a form is connected, no Sync has run and no event has arrived. Phase 1's "N earlier payments exist" count is optional (one `listPayments` page).*

**N3 — Say why an event failed, in words (small, ux, before Nov 8).**
Proposed backlog text: *B-nnn Map the event error codes (`no_api_key`, `zeffy_unauthorized`, `zeffy_unavailable`, `zeffy_rate_limited`, `db_error`, `session_mismatch`, `session_not_found`, `bad_payment`, `no_campaign`, `consumer_error`) to one sentence each beside the "Failed, will retry" chip, and make "Reprocessed: Failed" repeat the reason. `no_api_key` should say the API key is missing on the server and that Zeffy will keep retrying for three days.*

**N4 — Slice 2 commitments carried from Phase 1 (hard condition).**
Proposed backlog text: *B-167 Slice 2 must include, and Phase 6 will check for: manual add registrant (admin, phone-usable, flagged `manual`, reason required, in history), refund Keep/Withdraw, per-stuffy attention dismissal, status buttons (draft, active, paused, closed), worker code card, and Test storage. Until it ships, comps and walk-ups are tracked on paper. Target Nov 20; the latest tolerable date is the week of Dec 1, when tagging starts.*

**N5 — Measurement gate before registration opens (not code unless a result differs).**
Proposed backlog text: *B-167 S2a/S2b close-out, due before Sun Nov 8: with a practice purchase of two tickets in one order, confirm (a) the first real delivery verifies (Connect page "Last event of any kind" fills in), (b) `Item.id` is stable and unique and there is one ticket item per attendee, (c) `status` is `succeeded` for a paid order and what it becomes after a refund, (d) the real question strings and the checkbox/select answer shapes, and set `CONSENT_AFFIRMATIVE` to the real "yes" text (today an unrecognised answer fails safe to "no photo sharing", which silently under-includes families who opted in), (e) a buyer edit fires `payment.updated` and the id-only payload shape, (f) whether a $0 or 100%-discount ticket fires `payment.completed`, (g) delivery latency, (h) the drop-off options on the Zeffy form spell exactly the session window labels. A result that differs is a one-constant change (`ITEM_KEY_STRATEGY`, `CONSENT_AFFIRMATIVE`) or a window-label edit, not a redesign.*

**N6 — Make the quiet-feed amber mean "no recent sales" (low).**
Proposed backlog text: *B-nnn The "no event in 24 hours" amber fires whenever any order exists, so it will sit amber for weeks as sales taper and teach the chair to ignore it. Key it to a sale in the last N days, and add the same amber to the sessions list card (Phase 3 asked for the list).*

**N7 — Copy a question map from another session (low).**
Proposed backlog text: *B-nnn On Connect, offer "Copy matches from <other session>" so moving from the practice form to the real one does not mean re-assigning about ten selects by hand.*

**N8 — Housekeeping backlog.**
Proposed backlog text: *(a) Add to B-165: `drizzle-kit push` also prompts for `dues_settings_fiscal_year_unique` and re-proposes ten foreign keys whose names exceed 63 characters; every truncate prompt must be answered No. (b) Record that `neonctl connection-string --branch-id <id>` is silently ignored and returns the production endpoint (the branch id is positional); the database-admin caught it before any write. (c) `e2e` `create-test-user.mjs` through `dotenv-cli` expands `$` in `E2E_ADMIN_PASSWORD_HASH`, so the stored bcrypt hash is wrong. (d) The admin layout nests a `<main>` inside `<main id="main-content">`. (e) A long email wraps mid-word in the registrants table at 1440 px. (f) The `contact.*` webhook rows store the contact id in the `payment_id` column.*

**N9 — Runbook items for the orchestrator (not backlog).**
Set a reminder for **Friday Dec 18, morning: open the session page and run Sync before the doors open** (nothing will prompt it). Record in the club runbook: set `ZEFFY_API_KEY` before registering the webhook URL (without it every id-only event for an unseen payment 500s and is retried for three days; the webhook is organization-wide, so White Cane edits would do the same); rotating the webhook secret invalidates the old one instantly, so update Vercel, redeploy, then Sync to close the gap; Zeffy is believed to allow one webhook URL per organization (unmeasured), so dev and preview never see real events.

**N10 — Keep the public page's no-database guarantee after the narrowing (low).**
Proposed backlog text: *B-nnn `public-page.test.ts` now scans five named lib modules plus the two app/component folders because B-167 put server code in `src/lib/santas-workshop/`. Slice 2 adds `/santas-workshop/crew`, `/c` and `/f` under the scanned app folder, which will trip the public-page rules. Replace the folder walks with an import-graph check rooted at `src/app/santas-workshop/page.tsx` (it may import only the public modules; crew/collage/family routes get their own rules).*

## Deploy checklist for Slice 1 (in order)

**Answering the question put to me: connect the real campaign `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e` straight to a REAL session, never to a practice session first.** Reasons, all from the code: a campaign maps to at most one session and Slice 1 has no disconnect, so a form connected to a practice session cannot be moved; a session's kind is immutable; real families' orders would then live inside a practice session, which is the one kind Slice 5 can wipe in one click ("Reset practice session"). Rehearse on a **separate practice Zeffy form** (a copy of the real one, same question text and drop-off options) connected to a practice session. If the club will not build a practice form, skip the rehearsal session and do the test purchase on the real form: the chair buys one ticket and refunds it, and the refunded row stays in the real session as a "Refunded" stuffy until Slice 2 can withdraw it.

1. **Before the push (orchestrator).** The worktree is uncommitted on `6343fa6`; the main tree has its own uncommitted edits (the real `zeffyShareUrl` in `facts.ts`, backlog, spec, and a different copy of this work-log). Reconcile the two work-log copies by hand (main has the orchestrator blocks and placeholder phases, the worktree has the Phase 4 to 6 text). Stage by pipeline. Run `/pre-push` on the combined tree. Release notes and the version bump are the orchestrator's.
2. **Check Zeffy's sales window on the real form.** The public page only embeds the form from Nov 8, but the share link is already in the main-tree diff and Zeffy's own sales window is the real control. If the form can sell before you Connect, do step 9 first or expect to run Sync after it.
3. **Vercel production env:** `ZEFFY_API_KEY` and `ZEFFY_WEBHOOK_SECRET` are present (the secret must be the one Zeffy currently shows; regenerating it kills the old one at once). Leave `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` and `ZEFFY_API_BASE_URL` **unset** in production.
4. **Push to main.** The build runs `db:migrate` (`0113` eight tables, `0114` the permission) then `drizzle-kit push --force`. Read the deploy log: expect the known B-165 prompts forced through, and no statement that names a `sw_` or `zeffy_` object.
5. **Confirm the schema (orchestrator, read-only, explicit `branchId`).** Counts only: the eight tables exist; `santas_workshop.manage` is bound to exactly `admin` and `board_member`.
6. **Board members sign out and back in**, then wait about 60 seconds (the nav and the proxy read the JWT). Confirm one real board member sees "Santa's Workshop" under Engagement and that a plain member is bounced.
7. **Register or check the webhook** in Zeffy (Settings, Integrations, Webhook): URL `<production origin>/api/zeffy/webhook`; the three subscribed types that matter are `payment.completed`, `payment.updated`, `payment.deleted` (others are acknowledged and ignored). If the URL was registered before this deploy, expect a burst of retried events right away; all should be `ignored_unmapped`. **Verify the signature format:** create the first session, open Connect, and look at "Last event of any kind from Zeffy". It fills in only after a delivery passed the signature check (unmapped events are not listed per form, so this line is the only proof). If it stays empty while Zeffy shows failed deliveries, the format or the secret differs: fix that before anything else, because Sync is not a substitute for a working webhook.
8. **Rehearse on the practice form.** Create it in Zeffy (copy of the real form); create a practice session (the form defaults to Practice and the button reads "Create practice session"); Connect it, marking the stuffy rate; make a two-ticket test purchase (100 percent discount code or the smallest real charge; whether a $0 ticket fires `completed` is S2b, unknown) and a full and a partial refund; see the registrants, the unmapped questions, assign them, Remap; check the drop-off chips on the edit page; run Sync. Run `scripts/spike-zeffy.ts --campaign <practice id>` locally (dry run first, id allowlisted in your own `.env.local` only), then settle N5.
9. **Real session.** Create it with the button that reads "Create real session"; compare its window labels with the real form's drop-off options (they must match after trimming and case; edit if not); Connect `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e`, check the dialog shows "A Visit to Santa's Workshop", mark only the stuffy rate; **run Sync immediately** (it recovers any payment made before connecting); assign the questions as on practice and Remap. The checklist should then show every row done except the two grey placeholders and the Friday row.
10. **Nov 5 to 7.** Re-read the checklist, the Connect events list and the registrant cards once with the chair; confirm "Last event" is recent and "Need attention" is zero for the test order.
11. **Nov 8.** Watch the first real orders arrive. **Dec 18 morning:** Sync before the doors open (N9).

## Release-notes paragraph (no version number, no file list)

Santa's Workshop now has its own area in the admin menu. Admins and board members can set up a session, connect it to the club's Zeffy ticket form, and watch registrations appear on their own as families buy tickets, one entry for each stuffy with its drop-off window, snack choice and notes from the form. Anything the form said that the club has not matched up yet is flagged for a look instead of being lost, refunds are marked rather than removed, and a Sync button catches anything that was missed. A go-live checklist shows what is still to do before registration opens, and a session's dates and drop-off windows can be corrected at any time.

## CLAUDE.md edits for the orchestrator

1. **Environment Variables** (after `TURNSTILE_...`):
   - `ZEFFY_WEBHOOK_SECRET` - `whsec_...` from Zeffy Settings, Integrations, Webhook. Verifies `POST /api/zeffy/webhook`; unset makes the endpoint fail closed (500 `not_configured`). Production only; dev uses a made-up `whsec_dev...`.
   - `ZEFFY_API_KEY` - bearer key generated by the Zeffy organization owner. Needed for `payment.updated`/`payment.deleted` handling (those events carry only an id), Sync, Reprocess and the form picker. **Set it before registering the webhook URL.**
   - `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` - comma-separated Zeffy campaign ids a **non-production** process may read; unset means no Zeffy call. A dev server holding the production key can therefore never pull real parents' data. Never list a donation form.
   - `ZEFFY_API_BASE_URL` - test-only override of the Zeffy API host; honoured only when `NODE_ENV` is not `production`.
2. **Integrations -> Zeffy** (append; and change the last sentence of the cards bullet to "Zeffy's Cloudflare 403s server-side fetches of `www.zeffy.com` pages; the supported server path is the API below"): 
   - **API and webhooks (v1.94, DECISION-123):** `src/lib/zeffy/` is a workshop-agnostic module (signature check, hand-typed payload subset and the whitelist `toSnapshot()`, a rate-limited client whose `listPayments` requires a campaign id, the `zeffy_events` log, `toEmbedUrl()`). `POST /api/zeffy/webhook` has no `auth()`: the `Zeffy-Signature` HMAC over the raw bytes is the authentication. It is **organization-wide** (White Cane gifts arrive too), so a payment whose campaign no session maps is logged by ids and time only and **nothing is stored**. `payment.updated`/`deleted` carry only an id, so the consumer fetches the payment and applies the fetched snapshot; a snapshot older than the stored one is refused. Dedupe is on terminal outcomes only, so a failed event re-runs on Zeffy's retry. Registrants are written only by `applyPaymentSnapshot()` (webhook, Sync, Reprocess). Zeffy is believed to allow one webhook URL per organization (unmeasured, S2b), so dev and preview never receive real events; rotating the secret invalidates the old one at once (update Vercel, redeploy, then Sync).
3. **Gotchas**, replace the Zeffy line: "**Zeffy:** embedded donation forms are iframes (CSP `frame-src` must allow `https://www.zeffy.com`); `www.zeffy.com` 403s server-side fetches, `api.zeffy.com` with `ZEFFY_API_KEY` is the supported path; the webhook is organization-wide and stores nothing for an unmapped campaign". Add: "`neonctl connection-string --branch-id` is ignored and returns the production endpoint; pass the branch id positionally and compare the host."
4. **Project Structure:** under `api/` add `zeffy/webhook/  # signed Zeffy webhook (no auth(); the signature is the auth)` and `admin/santas-workshop/  # sessions, Connect, question map, Sync, Reprocess, registrants`; under `lib/` add `zeffy/  # generic Zeffy module` and `santas-workshop/ (now also server code: consumer, mapper, apply, sync, session queries)`; under `components/admin/` add `santas-workshop/`. The admin tree line on line 90 gains `santas-workshop` after `social-requests`.
5. **Key Features -> Santa's Workshop (new bullet, after the sign-up page bullet):** "**Santa's Workshop sessions and Zeffy ingestion (v1.94, B-167 Slice 1, DECISION-123):** `/admin/santas-workshop` under `santas_workshop.manage` (bound to `admin` and `board_member`; never `treasurer`, `member` or an `admin.*` key; the holders read about 100 families' names, emails and mobiles). A session (`practice` or `real`, immutable) carries its own dates, windows, the connected Zeffy campaign, the stuffy ticket rate ids and a per-session question map (normalized question text to field, several strings per field, plus `ignored`). Connect, then a purchase or Sync, then assign questions, then Remap. Needs attention is a flag with the raw text, never a drop; refund state is derived from the order, never stored per stuffy; Sync and Remap never touch worker-owned columns. The drop-off window answer joins to the session's window labels, so the labels must equal the Zeffy form's options (the edit page lists answers that matched none). One campaign maps to at most one session and Slice 1 cannot disconnect it; never connect a real form to a practice session. Worker screens, photos, collage, frames and the family page are Slices 2 to 5."
6. **Line 162** (sign-up page bullet), last sentence: replace "Sessions, workers, photos and the collage are B-167 (DECISION-121 to 125)." with "Slice 1 of B-167 (sessions admin and Zeffy ingestion) has shipped; workers, photos, the collage, frames and the family page follow (DECISION-121 to 125)."
7. **Database Migrations note:** `drizzle-kit push` also prompts for `dues_settings_fiscal_year_unique` and re-proposes ten FKs with names over 63 characters (B-165 family); answer No to every truncate prompt.

### Phase 6 handoff (Slice 1)

**Owner:** analyst
**Status:** complete (Slice 1 only; Phase 6 stays open for Slices 2 to 5)

### Summary
SHIP WITH NOTES for Slice 1. Ingestion, the sessions admin, Connect, the question map, Sync/Remap/Reprocess, the edit page and the permission model match Phase 1; the safety properties were exercised by QA and hold in the code. Three small items (N1 to N3) belong before Nov 8, manual add and the refund/attention actions must arrive with Slice 2 (N4), and the Zeffy-shape measurements (N5) gate registration opening.

### What I did
- Read the whole work-log in order, then the shipped server, UI, migrations and specs; re-ran 35 files / 673 tests; PII and secret-shape grep over new and modified non-doc files (clean).
- Walked each addendum flow, each applicable Phase 3 ruling and each Phase 4 deviation; found the Sync `skipped` blind spot (N1) by reading `countApplyResult` against `syncSummary`.
- Answered the deploy questions: real campaign to a real session; manual add deferral acceptable on a condition; what the admin sees on Nov 8.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` in the pipeline worktree and its Per-Phase Status row. No code, CLAUDE.md, decisions or backlog file touched; nothing committed.

### Open questions / handoff notes
- Orchestrator: merge the two work-log copies; apply the CLAUDE.md edits above when Slice 1 ships; set the Dec 18 morning Sync reminder; file N1 to N10 (proposed text above); N1 to N3 are small enough for one ux/api pass before Nov 8.
- User: build the practice Zeffy form (or decide to rehearse on the real form); confirm the real form's sales window and that its drop-off options spell the three window labels; the consent question's exact "yes" wording (N5d).
- The worktree `.env.local` holds a real `ZEFFY_API_KEY` (QA flagged it); keep `ZEFFY_DEV_CAMPAIGN_ALLOWLIST` limited to the Santa's Workshop and practice campaigns.

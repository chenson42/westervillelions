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
| 4 — Implementation, Slice 2 | api-developer (server), then ux-developer | Slice 2: Complete; qa next | — | 2026-10-12 |
| 4 — Implementation, Slice 3 | api-developer (server), then ux-developer | Slice 3: Complete; qa next | — | 2026-10-13 |
| 4 — Implementation, Slice 4 | api-developer (server), then ux-developer | Slice 4: Complete; qa next | — | 2026-10-13 |
| 4 — Implementation, Slice 5 | api-developer (server), then ux-developer | Slice 5: Complete; qa next | — | 2026-10-13 |
| 5 — Verification | qa | Slice 1: complete, PASS (re-verified twice). Slice 2: first run FAIL, fixed, re-verified twice (D1 to D3, then N1/N3/N4) | Slice 1 **PASS**; **Slice 2: PASS** (tree: HEAD `160b090` + uncommitted Slice 2 diff in worktree); **Slice 3: PASS** (first run FAIL on S3-D1, fixed and re-verified with real uploads, then post-Phase-6 N1 to N5 re-verified; tree: HEAD `dc3c67e` + uncommitted Slice 3 diff in worktree); **Slice 4: PASS** (first run FAIL on S4-D1 partial-export summary, fixed and re-verified live, then post-Phase-6 N1 to N4 and N6 re-verified; tree: HEAD `ab0b566` + uncommitted Slice 4 diff in worktree); **Slice 5: PASS** (first run FAIL on S5-D1 portrait waiting for the collage publish and S5-D2 reset of a purged practice session, both fixed and re-verified live; then post-Phase-6 S5-N1 purge scrub, S5-N3 eligibility and one-sheet print re-verified live (Re-verification 2); open: O1 collage footer on a full last sheet; tree: HEAD `0aff8cc` + uncommitted Slice 5 diff incl. all post-QA and post-Phase-6 fixes in worktree) | 2026-10-12 |
| 6 — Shipped vs intent | analyst | Slices 1 to 5 complete; increment 2 overall: SHIP WITH NOTES | Slice 1: **SHIP WITH NOTES** (N1 to N3 before Nov 8; N4 with Slice 2; N5 gate). Slice 2: **SHIP WITH NOTES** (S2-N1 gates the dry run; S2-N3 before Dec 17; S2-N5 decided Dec 14). Slice 3: **SHIP WITH NOTES** (S3-N1 and S3-N2 decided before the dry run). Slice 4: **SHIP WITH NOTES** (S4-N1 and S4-N2 before the first real counter upload; S4-N3 and S4-N4 settled by the test print). Slice 5: **SHIP WITH NOTES** (S5-N1 to S5-N4 before the real event; S5-N1 and S5-N2 before Jan 19, 2027) | 2026-10-13 |

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


### Phase 3 addendum: pickup name check (tech-lead, 2026-10-12)

**Trigger:** ux-developer "Routed up" R2 and R3 (Slice 2 UI). Today `POST .../stuffies/[id]/pickup-check` is the only call that returns the parent's name to the crew phone, and it records `matched` in the same call, before any human has compared names; a different collector then needs a second `someone_else` check.

**Ruling R2: option (b), split reveal from confirm.** Spec decision 4 says the worker confirms the name before hand-over; the history should be able to say a person acted *after* the name was on screen. Honest limit (rule a): the server cannot know a comparison happened. What (b) records is "name shown, then a human chose matched or someone else", with two timestamps, which is the strongest thing a code-gated app can record. It is cheaper than it looks (about 40 lines, no schema: `sw_stuffy_events.kind` is a text column).

- **Contract change (carrier `crew-contract.ts`):**
  - New `POST /api/santas-workshop/crew/[slug]/stuffies/[id]/pickup-name`, body `{ idempotencyKey }`, response `PickupNameResponse { parentName: string or null }`. This is now the **only** call besides the tag card that returns a parent name. Allowed from `checked_in` or `portrait_taken` only; `picked_up` answers `already_picked_up`, other states `illegal_transition`. Records one `name_shown` event (state unchanged, note null). If a `name_shown` newer than the stuffy's latest revert already exists, it returns the name **without** a second row, so reopening the card does not spam history.
  - `POST .../pickup-check` keeps its request (`{ result: 'matched' or 'someone_else', note?, idempotencyKey }`) but its response **no longer carries `parentName`** (`PickupCheckResponse { recorded: true }`), so any consumer still reading it breaks `tsc`. It is refused with new error code `name_not_shown` (409, added to the carrier's error-code tuple, so the exhaustive message switch in `crew-messages.ts` must handle it) unless a `name_shown` newer than the latest revert exists. It records `pickup_check` with note `matched` or `someone_else: <note>` as today.
  - `POST .../pickup` is unchanged: it still returns `pickup_check_required` without a `pickup_check` event newer than the latest revert (`hasPickupCheck`). Result: pickup requires `name_shown` then `pickup_check` then `transition`, in that order, and a revert resets all three.
- **Event kinds:** `name_shown` (new; add to the vocabulary comment in `schema.ts` and to any kinds tuple) and `pickup_check` (existing, semantics tightened to "a human chose after the name was shown"). Neither holds personal data except `pickup_check.note` ("someone else collecting" text), which is already nulled at the personal purge.
- **UI (`pickup-panel.tsx`):** "Show name on the order" calls `pickup-name` and displays the name; only then do "Name matches" and "Someone else is collecting" (note field) appear; both call `pickup-check`; "Mark picked up" stays disabled until the check is recorded. Offline behavior unchanged: these are online-only with the same idempotency keys.
- **Record updates at promotion (not done now):** DECISION-121 item 6 and its residual say "the `pickup-check` response"; at Phase 6 promotion that wording becomes "the `pickup-name` response", and the Phase 5 residual count becomes "pickups lacking a `name_shown` then `pickup_check` pair (expect 0)". The `crew-contract-no-contact` allowlist moves `parentName` from `PickupCheckResponse` to `PickupNameResponse`.

**Tests (named).**
- `stuffy-transitions.test.ts` additions: `pickup-name` records `name_shown` with no state change; a repeat returns the name and writes no second row; from `registered` or `tagged` it is `illegal_transition`; from `picked_up` it is `already_picked_up`; `pickup-check` without a prior `name_shown` is `name_not_shown`; with one it records `matched` and records `someone_else` with its note; `pickup` without `pickup_check` is still `pickup_check_required`; the full order `name_shown`, `pickup_check`, `transition` succeeds; a `name_shown` older than a revert does not satisfy `pickup-check`; a `name_shown` on another stuffy (or session) does not count (404 for another session's id).
- `crew-routes-gate.test.ts`: passes unchanged and must list `pickup-name/route.ts` among routes that call `requireCrew` first.
- `crew-contract-no-contact.test.ts`: `parentName` appears only in the tag card and `PickupNameResponse`; `PickupCheckResponse` has none.
- `crew-messages.test.ts`: `name_not_shown` has a worker-readable sentence (exhaustiveness).
- Panel logic test (pure state function extracted from `pickup-panel.tsx`): confirm buttons hidden before reveal; Mark picked up disabled until `pickup-check` succeeds; `already_picked_up` shows the time.
- e2e, update `santas-workshop-crew-flow.spec.ts`: `pickup-check` and `pickup` through the API before reveal are refused; after "Show name" the name is on screen and no earlier response contained it; "Name matches" then "Mark picked up" succeeds; a second stuffy with "Someone else is collecting" and a note succeeds; a second tap says already picked up; the response bodies of every crew call before the reveal contain no parent name (sentinel check, feeds L9).
- Phase 5: count pickups in the dry run lacking the `name_shown`, `pickup_check` pair (expect 0).

**Implementer:** **api-developer** for the route, `recordPickupName`, the `name_not_shown` gate and the carrier change (about 25 lines), then **ux-developer** for the panel and message (about 15 lines); same slice, tests above. Absorbable by size (under about 40 lines, no schema, one route that replaces a response field, no new flow or permission); recorded here so it is not a silent change.

**R3: accepted for the dry run, with a dated condition.** The family QR on the pickup screen encodes the server-built `familyUrl` (`/santas-workshop/f/[token]`), which 404s until Slice 5. That is fine for the dry run and qa should not log it as a defect. But Phase 1 named the family page "the first thing to cut", and a QR to a 404 on Dec 20 would be a visible failure at the door. Rule: Slice 5 stays on the must-ship list for Dec 20 (due Dec 10). If it has not landed and passed qa by **Dec 14**, `PickupResponse.familyUrl` becomes `string or null`, the server returns `null`, and the UI hides the QR (about 5 lines, decided on Dec 14, not discovered on Dec 20). Add a line to the dry-run checklist: "family QR resolves, or is hidden by decision".


### Phase 3 addendum: family portrait timing (tech-lead, 2026-10-12)

**Trigger:** Phase 5 Slice 5 defect S5-D1, with an orchestrator ruling that overrides the Phase 3 access table. The Phase 3 table said a family sees its own portrait "once the session is published". `family-queries.ts:101` and `photo-access.ts:75` implemented that, so a family scanning the pickup QR before the Saturday-evening publish got no image and a 404 at the photo door, even though the printed frame in its hands already shows the portrait.

**New rule.** A family always sees its own portrait from the moment a **current, unhidden** portrait exists, independent of consent and independent of the collage publish batch. Only the link to "see the whole day's photos" waits for publish. Reason: the portrait is the family's own and is already printed on the frame handed over at pickup, so withholding it online protects nothing; the publish gate exists for the *public* collage, which shows other families' photos.

**The access-matrix row it changes (this replaces the Family row at line 1048):**

| Viewer | Allowed | Always 404 |
|---|---|---|
| Family (token to its stuffy) | that stuffy's portrait when it is **current and not hidden** (`superseded_at IS NULL AND hidden_at IS NULL`), either variant, regardless of consent and **with no published condition** | any other photo; hidden; superseded; **purged**; check-in photos; group photos |

Unchanged and still enforced: a hidden portrait is withheld from the family exactly as from the public (Ruling 8: a portrait hidden because of a face or hand must not be shown to the family either); a purged portrait is refused (404); the family credential never reaches another stuffy's photo or a group photo; a family page for a token whose stuffy is in a purged session still shows "removed". The public and crew rows are untouched: the public collage still requires the session to be published and consent.

**Page behavior.** Three states for a valid token, instead of "unavailable until published":
1. *Portrait present, collage not yet published* (the new variant): show the portrait (and the download link), the thank-you line, and in place of the collage link the sentence "The whole day's photos will be here once the club has published them." No countdown, no date promise unless the session's `photo_date`-based copy already exists.
2. *Portrait present, collage published:* portrait plus the collage link (as shipped).
3. *No current unhidden portrait:* the existing "photo isn't available" or pending copy (a stuffy with no portrait, or a hidden one), unchanged.
Unknown token and the purged state are unchanged. The family image route (`/api/santas-workshop/family/[token]/portrait`) and the generic photo door must both stop requiring `collage_published_at`, through the single decision in `photo-access.ts` (no second copy of the rule in the page or route).

**Tests that change.**
- `family-queries.test.ts:65` (the case asserting a pending state before publish): now asserts that a current, unhidden portrait is returned before publish, with `collageLinkAvailable: false`; add cases for hidden portrait before publish (withheld), superseded portrait (the new one shows), no portrait before publish (pending copy), and published (collage link available).
- `photo-access.test.ts`, family rows of the matrix: unpublished session with a current unhidden portrait is **allow** (was 404); still 404 for hidden, superseded, purged, another stuffy's photo, a group photo, a check-in photo; consent false is allow; the public and crew rows are asserted unchanged in the same table.
- `family-ui` tests (the "pending" ones): the new view variant renders the portrait and the "will be here once the club has published them" sentence and no collage link; the published variant renders the link; the no-portrait variant is unchanged; a source scan that the page and the family route do not read `collagePublishedAt` for the portrait.
- `e2e/santas-workshop-family.spec.ts:86`: the unpublished-session test now expects the family page to show the portrait and the image URL to return 200 before publish, no collage link; after Publish the link appears; hiding the portrait makes both the page image and the door 404 again.
- Phase 5 live check: pick up a stuffy with a portrait **before** publishing and open its family link (page shows the portrait, door 200, no collage link).

**Record update at promotion (not done now):** one line in DECISION-125 item 3 and the Phase 6 note: "the family sees its own current, unhidden portrait before the publish batch; publish gates only the public collage and the collage link". The Phase 3 access table text at line 1048 above is superseded by this addendum and left in place for history.

**S5-D2 (reset of a purged practice session is a dead end), recorded as a design requirement.** `retention.ts:416` clears only `collage_published_at`; the purge markers and `status = 'purged'` stay, so the status route then answers 409 `session_purged` for every target while the card still offers "Reset practice session" and its copy promises "so the drill can start again". Rule: **reset of a practice session returns it to a usable, restartable state**: it clears `personal_purged_at`, `public_purged_at` and `collage_published_at`, resets `status` to **`draft`**, and keeps the configuration (windows, Zeffy mapping, dates, crew code and its version). Reset is still refused on a real session (`403 practice_only`, server-checked) and `purged` stays terminal for real sessions. Tests: `retention.test.ts` (reset of a purged practice session ends in `draft` with both purge markers and the publish stamp null; a status change to `active` then succeeds; a real purged session still refuses reset and stays `purged`); the retention e2e (purge a practice session, reset, then Activate works and the old family token is still 404). Implementer: **api-developer** for S5-D1 server and S5-D2; **ux-developer** for the pending-with-portrait copy.

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

## Phase 5 — Slice 2 "dry-runnable core" — 2026-10-12

**Owner:** qa · **Scope:** the worker (crew) app and API, the photo store (local adapter) and photo door, the Slice 2 admin controls (status, worker code, storage test/check, manual add, registrant actions, awaiting-pickup CSV), the `Permissions-Policy` rule, and the two Phase 3 addenda (session edit, pickup name check). Slice 1 was re-run as a regression and is unchanged.
**Tree state measured:** `HEAD` = `160b090a73c8c21dfbd1cf8a0dc72a58a183eeb9` (main, v1.94.0, which shipped Slice 1) plus the **uncommitted Slice 2 diff in the pipeline worktree** (89 `git status` entries). Branch `ep-divine-boat` only (host checked in code before every write); servers `:3101` (dev) and `:3102` (production build) stopped by PID; `:3000` never touched; no commit. `.env.local` carries a `ZEFFY_API_KEY`, so every server was started with `ZEFFY_API_KEY=` forced empty; no Zeffy call was possible or made. Photos: `SW_LOCAL_STORE_DIR` pointed at a scratch folder so no file entered the repo tree.

### VERDICT: FAIL

Three defects, each small, each reproduced. Everything else in the very large Slice 2 surface passed, including every adversarial case asked for. A single red item is a red build, so Slice 2 goes back to its implementers; no design flaw, no escalation to tech-lead.

| # | Defect | Owner | file:line | Fix size |
|---|--------|-------|-----------|----------|
| S2-D1 | **`pnpm build:only` now prints a Turbopack warning** ("Dynamic filesystem access causes tracing of the whole project") and the routes that import the photo store pull most of the repository into their function bundle. The first (Slice 1) builds had no warning. | api-developer | `src/lib/santas-workshop/photo-store/local.ts:50` (`mkdir(join(rootDir, folder))`; the same pattern at `:59` and in `pathOf`) | small (a `/*turbopackIgnore: true*/` comment on the path join, or load the local adapter with a dynamic `import()` only outside production so Drive-only production bundles never trace it) |
| S2-D2 | The pre-push **phone grep prints** `(614) 555-01xx` (a 555 fiction number) at `manual-add.test.ts:45` and `:46` (a real Columbus area code; the 555-01xx exchange is fictional but the grep and CLAUDE.md "No Personal Data" do not know that). | api-developer | `src/lib/santas-workshop/manual-add.test.ts:45-46` | one-line (use a placeholder with no real area code, for example `000-555-0100` shaped input the validator still accepts) |
| S2-D3 | After "Test storage" succeeds the card's **"Last test" stays "Never" and the go-live checklist item "Photo storage tested" stays "To do"** until the admin reloads (observed for 8 s). Status controls and the worker-code card call `router.refresh()`; the storage card does not. For a real session this is the one step the 10-minute activation rule hangs on. | ux-developer | `src/components/admin/santas-workshop/storage-card.tsx:34-35` (success branch of `runTest`; `status-controls.tsx:38` and `worker-code-card.tsx:68` show the pattern) | one line (`router.refresh()`) |

**Established vs believed.**
- S2-D1 *established*: the warning text and import trace are in the build log (`local.ts:50:21`, via `photo-store/index.ts` -> `photo-service.ts` -> the portrait route); measured from `.next/server/app/**/route.js.nft.json`: the five routes that import the store (`crew/.../portrait`, `photos/[id]`, `admin/.../storage/test`, plus the other upload routes) trace **~1,806 to 1,808 files / 58.7 MB** (including `docs/marketing` 15.9 MB, `docs/work-log` 11.6 MB, `public/images` 3.9 MB) against **128 to 131 files / 2.4 MB** for routes that do not import it (`crew/.../roster`, the Zeffy webhook). *Believed, not measured:* that this can approach Vercel's 250 MB function limit later or slow cold starts; 58.7 MB is well under the limit today. The theory that the local adapter is the cause is supported by the warning naming it; I did not rebuild with the adapter removed.
- S2-D2 *established* by running the recipe: the only hit in the repo.
- S2-D3 *established* by timing; the cause (missing refresh) is read from the source and matches the two siblings that do refresh.
- No sweep is recommended: S2-D1 is one module, S2-D3 one component.

### Gates

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm exec tsc --noEmit` | PASS | exit 0 |
| `pnpm lint` | PASS | 0 errors, the one old warning |
| `pnpm test` (verbose) | PASS | **279 files, 4746 / 4746**, 4.3 s |
| `pnpm build:only` | **PASS with a warning (S2-D1)** | exit 0; 318 route rows; present: crew page `/santas-workshop/crew/[slug]`, 13 crew API routes (`enter`, `roster`, `search`, `scan`, `group-photos`, `stuffies/[id]` and `/check-in`, `/portrait`, `/tag`, `/pickup-name`, `/pickup-check`, `/pickup`, `/revert`), photo door `/api/santas-workshop/photos/[id]`, the admin action routes (`status`, `crew-code`, `storage/check`, `storage/test`, `stuffies` POST, `stuffies/[stuffyId]/{revert,withdraw,dismiss-attention}`, `orders/[orderId]/refund-resolution`, `awaiting-pickup.csv`), and every Slice 1 route |
| Playwright, all workshop specs on `:3101`, local store | PASS | **49 passed, 1 skipped, 0 failed** (3.4 min): admin-gate 3, crew-admin 6, crew-entry 5, crew-flow 11, session-edit 7, webhook-to-roster 7, increment-1 public page 10 passed + 1 skipped (its "first sign-up control in a 390 px viewport (open only)" test, which skips unless the public page is in the `open` state; today it is `before`). Not a Slice 1/2 spec. |
| PII grep (emails, phones, streets) | **FAIL on S2-D2 only** | emails: prints nothing; streets: nothing; phones: the one pair above |
| No real photo or non-example address in the diff | PASS | the diff holds no image/PDF/zip file at all (`git ls-files --others` and `git diff --name-only` filtered for image extensions: none); every `@` address in the changed files is `example.invalid`/`example.com`/`example.test` or the club domain; `.santas-workshop-store/` is gitignored and holds only an empty `ping/` folder from earlier |
| `package.json` diff | PASS | exactly three additions: `jsqr ^1.4.0`, `qrcode ^1.5.4`, `@types/qrcode ^1.5.6` (`pnpm-lock.yaml`: 172 insertions, 0 deletions) |

### Unit tests Phase 3 and the addenda name for Slice 2, confirmed by name in the verbose run
`state-machine` (11), `tag-binding` (15, one per collision-table row incl. other-session-decides-like-unbound and identical-text collision), `stuffy-transitions` (58: idempotent replay, concurrent `23505` replay, stale 409, zero-row sentinel asserted as a throw, retake supersedes before insert, check-in without a photo flagged, second pickup `already_picked_up`, `pickup_check_required`, pickup with no portrait, other session 404, crew vs admin actor columns, revert clears the tag with a retire event, plus the addendum set: `pickup-name` records `name_shown` with no state change, a repeat writes no second row, `illegal_transition` from registered/tagged, `already_picked_up`, `name_not_shown`, `matched` and `someone_else` with its note, a `name_shown` older than a revert does not count, another session's stuffy 404, a revert resets the pair), `crew-cookie` (11), `crew-auth` (11), `crew-code` (8), `crew-throttle` (13), `photo-store/contract` and `photo-store/drive`, `jpeg-header` (7), `photo-limits` (13), `photo-access` (9, the viewer matrix), `permissions-policy` (7, including simulated last-wins and "no other source sets camera=(self)"), `crew-routes-gate` (35; the exception list is exactly `enter`), `photo-door` (9: store `.get(` only in `photo-access.ts`, importer allowlist, no storage key in routes or mappers, no Drive sharing, secrets not logged), `crew-contract-no-contact` (12: `parentName` only in the tag card and `PickupNameResponse`), `session-status` (11), `manual-add` (9), `crew-input`, `crew-queries`, `crew-admin`, `stuffy-admin`, `storage-admin`, `photo-service`, `session-checklist` (real storage and worker-code items), client logic `outbox-core` (17), `outbox-classify` (9), `scan-loop` (10), `photo-downscale` (8), `crew-messages` (10, a sentence for every error code incl. `name_not_shown`), `crew-ui` (11, the `pickupControls()` panel logic), `crew-api`, `crew-app-source` (73 source scans), `admin-actions-ui` (17).
Coverage: `permissions.ts` 100 / 100 / 100 (target 100); `events.ts` 94.9 (target 90); `members.ts` 86.8 (target 80); overall `src/lib` 76.9 / 74.7 / 78.4 (target 70). Slice 2 modules: `tag-binding`, `session-status`, `state-machine`, `crew-entry`, `crew-code` 100; `stuffy-transitions` 92.4; `photo-service` 91.8; `photo-upload` 95.6; `photo-access` 84.3; `crew-admin` 97; `crew-throttle` 79; `crew-auth` 71.1; DB-bound and exercised by my live run instead: `crew-queries` 28.8, `awaiting-pickup` 0 (the CSV was exercised live), `crew-http` 65.5, `crew-respond` 64.7.

### Manual click-through (Playwright Chromium with 390 px and 360 px phone emulation; a real phone is deferred)

Admin at 390 px (practice session created in the UI; screenshots in `<scratchpad>/.../s2/`):

| Flow | Result | Notes |
|------|--------|-------|
| Create practice session, status Draft -> Active | pass | button "Create practice session"; Activate needs no storage test on a practice session; status card says "Open to the crew..." |
| Worker code: show, copy, rotate, pause, resume | pass | code shown as `XXXX-XXXX` with "Copy code" / "Copy message for the crew"; the invitation names `/santas-workshop/crew/<slug>` and keeps the code out of any URL; Rotate asks first ("Rotate the worker code?", ConfirmDialog, no native dialog), version v1 -> v2; Pause shows a Paused chip and a Resume button; "N phones used it in the last hour" |
| Test storage / Check storage | pass, **S2-D3** | toast "Photo storage test passed."; Check storage reports 0 orphans / 0 missing, also after the outbox retries; the card and checklist do not refresh until reload |
| Manual add (phone-sized dialog) | pass | a missing reason is refused in words ("reason is required"); with a reason the registrant appears flagged as added by hand with the parent contact visible to the admin; a stuffy named `<script>window.__pwn=1</script>` with description `<img src=x onerror=...>` renders as literal text on the admin list and in the crew app and ran nothing |
| Registrant actions | pass | Dismiss flag clears the attention flag; Refund: keep asks first ("Keep this registration?") and stores the refunded amount kept; Refund: withdraw asks first and withdraws the order's registered/tagged stuffies; Withdraw refuses a missing reason, then records it in the history; admin "Go back a step (practice)" returns a tagged stuffy to Registered and frees its sticker. Refund and attention states were **set by SQL on the branch** (no Zeffy key, so none can arrive by webhook); the actions themselves went through the real UI and routes. |
| Awaiting-pickup CSV | pass | 200 `text/csv`, `attachment; filename="awaiting-pickup-<slug>.csv"`, 401 without a login, leading `=`/`+`/`@` neutralized with a tab; see observation 3 |
| Real session | pass | activation succeeded only after a passing storage test; its registrants page has no "Go back a step (practice)" control |
| 360 px admin overview, registrants, connect | pass | `scrollWidth == clientWidth` on all three |

Crew phone at 390 px (cookie-less context, own fake IP) and 360 px:

| Flow | Result | Notes |
|------|--------|-------|
| Visitor with no cookie | pass | only "Enter the worker code"; no session name, no stuffy names in the HTML |
| Wrong code x6 | pass | attempts 1 to 5: "That code didn't work. Ask the event chair." (byte-identical); the 6th adds "Wait a few minutes."; while blocked even the right code is refused |
| Right code (lowercase, spaces) -> roster | pass | seven stuffies; filters "All (7) / To tag (7) / Tagged / Checked in / Portrait done / Picked up" |
| **No contact data** | pass | roster page HTML and text, search results (by stuffy, by family name, by parent first name, by sentinel email text), scan results and every crew response captured over the whole session: **0 occurrences** of the sentinel email, mobile or the family surname; search by family name finds the row and never shows the name; the family name appears **only** in the tag-card response (and the pickup-name response). No crew JSON carries a key named email/phone/mobile/zeffy*/unmatched/rawAnswers/amount/paymentId/storageKey/buyer* (`orderId` is in roster rows by design). |
| Tag by typed code; re-bind same sticker, same stuffy | pass | "Sticker ready, ending 0001" then bound; the repeat returns 200 and writes **no** new history row |
| Sticker held by another **tagged** stuffy | pass | "Move this sticker? That sticker is on 'Max'..."; Cancel changes nothing |
| Sticker held by a **checked-in** stuffy | pass | refused, "That sticker belongs to 'Sunny', who is already checked in. Ask the event chair." (409 `holder_advanced`); not moved |
| Change sticker | pass | "Replace the sticker? Max already has a sticker ending 0001..."; roster then shows ending 0099; the old sticker scans as **retired** |
| Unbound sticker at the scan screen | pass | "This sticker isn't on a stuffy yet." with **Tag it now** and **Find by name** |
| Check-in with a generated PNG | pass | re-encoded to a JPEG (761 bytes), one current check-in photo row, no thumbnail; Snack choice and Care note ("Apple slices", "Loves a hug") shown once the card loads |
| Check-in without a photo | pass | asks first ("Check in without a photo?"); no photo row; history note marks it |
| Portrait, then retake | pass | retake asks "Replace the portrait?"; two rows, **one current**, the first superseded; SQL: 0 stuffies with two current portraits on the whole branch; the partial unique index `ux_sw_photos_current` exists |
| Photo door | pass | current portrait full and thumb 200 `image/jpeg` `no-store`; **superseded portrait 404 (both variants)**; check-in full 200, its thumb 404; no cookie 404; malformed id 404 (never 401/403) |
| Group photo | pass | filed against the session (`stuffy_id` NULL), unpublished |
| Pickup | pass | `pickup-check` before the reveal: 409 `name_not_shown`; `pickup` before a recorded check: 409 `pickup_check_required`; neither body contains the name; the UI shows "Mark picked up" **disabled** until a choice is recorded and the name is not on screen before "Show the name on the order"; after the reveal the name, **Name matches** and **Someone else is collecting** appear; Name matches -> Mark picked up enabled -> picked up; a second tap with a new key: 409 `already_picked_up` with the time; "Someone else" requires a note (stored as `someone_else: <text>`), no portrait still allowed (Kit) |
| Practice go-back from the crew UI | pass | dialog "Go back a step?"; the stuffy returns one step |
| 360 px crew screens | pass | no horizontal scroll on roster, tag card, scan, group, check-in, pickup reveal; every text input is 16 px or larger; every button is at least 44 px (the only short elements the probe listed were `<label>` captions and the site header's hidden menu button) |
| Outbox, server really stopped | pass | with the server killed by PID the photo shows "1 photo waiting to send", nothing is marked done, no raw error text; after restarting the server the photo sent by itself, the stuffy became checked in, the header returned to "No photos waiting", exactly one current check-in photo (no duplicate), Check storage 0 orphans |

### Production build: Permissions-Policy (L5, measured on `next start`, `:3102`)
`/santas-workshop/crew/<slug>` (and any deeper crew path): `camera=(self), microphone=(), geolocation=(), payment=(self "https://www.zeffy.com"), usb=(), ...`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`. `/santas-workshop`, `/`, `/about`, `/members`, `/admin`, the token paths `/santas-workshop/c/x` and `/f/x`, and `/api/santas-workshop/...`: `camera=()`. Token paths add `no-referrer` and `noindex, nofollow`. The last-wins reading holds on the production build as it did on dev. Production cookie flags (curl): `__Host-swcrew-<8 hex>=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=259200; Secure`, `cache-control: no-store`.

### Live checks (design L-table; "SW-L" ids), measured
| # | Result |
|---|--------|
| L1 wrong-code guessing | one IP: attempts 1 to 5 = 401, the **6th = 429 (first block at 6)**; a blocked IP is refused even with the right code; **an already-signed-in device keeps working** during the block (200); the per-session cap blocked a brand-new IP after **26 further distinct-IP failures** on top of the first IP's 5 or 6 (about 31 in total, design says 30); while the session cap is hit even the right code from a fresh IP is 429 (the documented residual: a spray can delay new sign-ins for the window; signed-in phones are unaffected). No raw IP is stored: `sw_crew_attempts` holds only hashed keys (19-char `ip:` and 41-char `sess:`), 0 rows matching an IPv4 pattern. |
| L2 rotate / pause / close | requests served on the **next** request after each action: **0**. Pause -> 401 `reason: paused`; rotate -> 401 `reason: signed_out`; close -> 401 `reason: closed`; the old code afterwards looks like any wrong code; closed: even the right code is refused; admin bypass still works on a paused or closed session and records `device_id = 'admin'`; reopening keeps the code; back to draft after activity is 409 `has_activity`; rotate with a phone active first answers 409 `devices_active { count: 1 }` |
| L5 headers | above |
| L6 cross-session IDOR | a session A cookie against session B's stuffy on **10 crew routes** (4 card views, tag, pickup-name, pickup-check, pickup, revert, check-in): **0 of 10 succeeded**, all 404; B's stuffy unchanged; session A cookie on B's roster 401; session A cookie with B's **photo id** at the photo door 404 while an admin gets 200 |
| L7 one current portrait | a direct insert of a second current portrait fails `23505`; **20 parallel retakes: 11 x 200 and 9 x 409 `stale_state`, 0 x 500; exactly one current portrait of 11 rows; Check storage 0 orphans, 0 missing** |
| L9 contact leakage | see "No contact data" above: 0 sentinel occurrences in every crew response; parent name only in the tag card and pickup-name responses |
| Pickups without a `name_shown` then `pickup_check` pair | **0** of 2 picked-up stuffies (ordered SQL: `name_shown` < `pickup_check` < the `picked_up` transition), and 0 branch-wide with no `name_shown` at all |
| Upload abuse | a 3 MB body: **413 `too_large`**; a PNG as the photo: **415 `not_jpeg`**; garbage `meta`: 400; none left a photo row or a state change; no 500 anywhere |
| Cookie abuse | a tampered cookie and no cookie: 401 with byte-identical bodies (no `reason` leaked); a paused, rotated or closed-session cookie: 401 on the very next request |

### Feature-gate audit (read from the route files, then exercised)

| Route or action | `auth()`/credential gate | `hasFeature(...)` | Key |
|-----------------|--------------------------|-------------------|-----|
| 13 crew routes under `/api/santas-workshop/crew/[slug]/**` | `requireCrew()` first (crew cookie re-checked against the session row, else admin with the key); `enter` is the single exception (throttle + code verify), asserted by `crew-routes-gate` | admin fallback uses `hasFeature(SANTAS_WORKSHOP_MANAGE)` | `SANTAS_WORKSHOP_MANAGE` |
| `GET /api/santas-workshop/photos/[id]` | resolves admin / crew / none, then `photo-access.ts`; 404 on every failure | admin arm requires the key | `SANTAS_WORKSHOP_MANAGE` |
| Admin: `status`, `crew-code` (GET/POST), `storage/test`, `storage/check`, `stuffies` POST, `stuffies/[id]/{revert,withdraw,dismiss-attention}`, `orders/[id]/refund-resolution`, `awaiting-pickup.csv` | `auth()` first | `hasFeature(SANTAS_WORKSHOP_MANAGE)` second | `SANTAS_WORKSHOP_MANAGE` (these hold parent contact data and the worker code; the single narrow key is right) |
| Server action ("use server") | none added | n/a | n/a |
Exercised: 401 anonymous on the admin routes and on the CSV; the Slice 1 gate matrix re-ran inside the 49 specs; the crew cookie never populates `session.user` and a crew cookie against an admin route is 401.

### Deferred (not passes), with the exact step
1. **Real iPhone and Android.** Camera permission prompt on `/santas-workshop/crew/...`; `BarcodeDetector` versus `jsqr` decode rate on the **real stickers** (and whether they encode a vendor URL, in which case the native camera app leaves our page); `<input capture>` return and page reload in iOS Safari (the view state is held in `sessionStorage`); the IndexedDB outbox surviving a closed tab with photos waiting (airplane-mode toggle mid-upload, then reopen). Step: open the dry-run crew URL on each phone, scan three stickers (they must differ: the "Test stickers" check), take a check-in, a portrait and a retake in low light, put the phone in airplane mode mid-upload, close and reopen the tab, confirm the count drains.
2. **Drive adapter.** No credentials exist; the adapter is only exercised against a fake client. Step: `scripts/spike-drive.ts` dry run, then `--apply` once the service account and shared drive exist; record the delete role (SW-L10), cold start and 1 MB latency; set `SW_PHOTO_STORE=drive` on a preview, run Test storage, then deliberately break the folder id and watch the outbox hold and drain (the Phase 1 failure drill); SW-L12 duplicates across airplane toggles (expect 0).
3. **Family QR.** The pickup success screen draws a QR for `familyUrl` (`/santas-workshop/f/<token>`), a 404 until Slice 5, by decision (Phase 3 addendum R3). Step: when Slice 5 lands, scan the QR from the worker's phone and confirm it resolves; if not landed by Dec 14, `familyUrl` becomes null and the QR is hidden (that decision date stands).
4. **Production-only:** the 10-minute storage-test rule against real Drive for a real session; `AUTH_SECRET` is the secret all keys derive from, so rotating it signs out every phone and makes stored worker codes unreadable (the card then says regenerate).
5. SW-L3, L4, L11, L13 belong to Slices 3 to 5.

### Observations (not defects)
1. The tag card is requested twice per open on the dev server (two identical `GET ...?view=tag` seen); likely React Strict Mode's double effect in dev; not measured on the production build.
2. In dev the Next.js "N" badge overlaps the bottom tab bar (the ux-developer already noted this).
3. The overview's "Waiting for pickup" card counts only checked-in/portrait-done stuffies ("Checked in, not yet handed back", 0 in my run) but the CSV behind its link lists **every not-picked-up stuffy including registered and tagged ones** (4 rows, with a State column), per the Phase 3 contract ("stuffies not picked up"). Consistent with the design; the card and file say different things to an admin who expects one list.
4. `e2e/santas-workshop-crew-flow.spec.ts` (and the other crew specs) delete their database rows but leave the photo files in the local store (a folder per spec slug); harmless (gitignored) but the cleanup is half done. The ux-developer removes them by hand.
5. The throttle's per-session cap means a deliberate spray from many addresses can delay new sign-ins for about 10 minutes (signed-in phones are unaffected). This is the Phase 1 trade-off, now measured (L1).
6. My probe also listed `W-real2` and `V5` as red at first; both were my harness (a text slice that landed in the sidebar; `<label>` captions and the hidden site-header menu counted as short tap targets), re-checked above, so not counted.

### Cleanup
All rows I created were deleted and the branch re-measured against the baseline taken before I started: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 3 (the three that predate me), `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. The admin-gate spec's two disposable users again produced two existing-behaviour "New portal user needs member record review" notices (both `blocked_non_production`, unsent); I removed exactly those two ids (`3551392c-...`, `fdba35b1-...`). The scratch photo store (78 files) was deleted; `.santas-workshop-store/` holds only the `ping/` folder that was there. Dev `:3101` (three starts, one real outage drill) and the production build on `:3102` were stopped by PID; no worktree process remains; `:3000` untouched; nothing committed.

### Phase 5 — Slice 2 handoff
**Status:** complete (FAIL, handed back). **Next agent: the original implementers**: S2-D1 and S2-D2 -> **api-developer**; S2-D3 -> **ux-developer**. Then qa re-runs `tsc`, `lint`, `pnpm test`, `pnpm build:only` (the warning must be gone and the nft counts for the photo routes should drop to the low hundreds), the seven workshop specs, the PII grep, and re-checks S2-D3 live. Regression tests to add per "failing first": S2-D3 a component test that the storage card calls `router.refresh` after a successful test (or a source scan, as `crew-app-source.test.ts` does); S2-D1 a source scan that no `fs` path in `photo-store/local.ts` is traced (or that the factory loads it lazily); S2-D2 none. The deferred list above goes to the dry run; Phase 6 waits for a PASS.

---

## Re-verification (Slice 2, D1 to D3) — 2026-10-12

**Owner:** qa · **Verdict: PASS** (Slice 2). Tree state: `HEAD` `160b090a73c8c21dfbd1cf8a0dc72a58a183eeb9` plus the **uncommitted Slice 2 diff in the pipeline worktree** (89 `git status` entries, now including the S2-D1 to D3 fixes). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 279 files, **4746 / 4746** |
| `pnpm build:only` | PASS: exit 0, **0 warnings, 0 "Dynamic filesystem access"**, 318 route rows (unchanged) |
| All seven workshop Playwright specs on `:3101` (default `.santas-workshop-store`, `ZEFFY_API_KEY=` forced empty) | PASS: **49 passed, 1 skipped, 0 failed** (3.5 min); the skip is increment 1's "open only" public-page test, as before |
| PII greps (phones over `src e2e scripts drizzle`; emails over the repo; streets) | PASS: all three print nothing |
| `package.json` diff | still exactly `jsqr`, `qrcode`, `@types/qrcode` |

### The three targeted live checks
- **D1 PASS.** The warning is gone from the build log. `turbopackIgnore` is on every `join(rootDir, ...)` in `photo-store/local.ts` (lines 39, 54, 63, 99). Photo-route `.nft.json` read from `.next/server/app/**`: portrait **173 files / 14.6 MB**, check-in 174 / 14.6, group-photos 172 / 14.6, photo door 171 / 14.6, `storage/test` 170 / 14.6, `storage/check` 173 / 14.6, against roster 131 / 2.4 and webhook 128 / 2.0 (before: 1,808 files / 58.7 MB). The remaining 12.8 MB is the route's own server bundle (`.next/server`), not the repo tree: `docs/` and `public/` no longer appear among the top contributors. The local adapter still works at runtime: the crew specs that store and fetch photos pass.
- **D2 PASS.** The phone grep prints nothing (and neither do the email and street greps).
- **D3 PASS, observed.** On a fresh practice session at 390 px the card read "Last test | Never" and the checklist "Photo storage tested : To do". After pressing "Test storage", with **no reload**, within 1.5 s the card read "Last test | Passed Oct 12, 2026, 11:03 PM" and the checklist item "Done: The last storage test passed."; the toast said "Photo storage test passed."; "Check storage" afterwards reported plainly and the card kept its state.
- **Photo store empty afterwards PASS.** After the specs `.santas-workshop-store/` held **0 files**; the crew helper removed every photo file. One thing it did not remove: an **empty folder named after the crew-flow spec's slug** (`e2e-flow-mv63gfgi`) was left beside `ping/` (see surprises).

### Surprises
1. The cleanup deletes the files but leaves the empty per-session directory (cosmetic, gitignored; I removed it with `rmdir`). Worth a line in the helper if the store should read as pristine.
2. The admin-gate spec's two disposable users again produced two existing-behaviour "New portal user needs member record review" notices (`blocked_non_production`, unsent); I removed those two ids and `email_queue` is back to 1362.
3. `.env.local` still holds a `ZEFFY_API_KEY` (unchanged from the earlier passes); every server was started with it forced empty.

### Cleanup
Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 3 (predate me), `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. Dev `:3101` stopped by PID; none of the worktree's processes remain; `:3000` untouched; nothing committed. The deferred list from "Phase 5 — Slice 2" (real phones, the Drive adapter spike, the family QR until Slice 5) stands unchanged.

### Verdict
**PASS.** S2-D1, S2-D2 and S2-D3 are fixed and verified; every gate is green on the tree state above; no new defect. **Phase 6 next** for Slice 2 (analyst), carrying the deferred list.

---

## Re-verification 3 (Slice 2, N1/N3/N4) — 2026-10-12

**Owner:** qa · **Verdict: PASS** (Slice 2 stays PASS), with one wording note on N4 below. Tree state: `HEAD` `160b090a73c8c21dfbd1cf8a0dc72a58a183eeb9` plus the **uncommitted Slice 2 diff in the pipeline worktree** (89 `git status` entries, now including the S2-N1/N3/N4 changes). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 279 files, **4749 / 4749** (was 4746) |
| `pnpm build:only` | PASS: exit 0, 0 warnings, 318 route rows |
| Seven workshop Playwright specs on `:3101` (`ZEFFY_API_KEY=` forced empty) | PASS: **50 passed, 1 skipped, 0 failed** (3.6 min; the skip is increment 1's "open only" public-page test; one more passing test than before, the new admin revert) |
| PII greps (phones, emails, streets) | PASS: print nothing |
| Photo store after the specs | 0 files (one empty spec-slug folder beside `ping/`, as noted before; removed) |

### The three live checks at 390 px (practice session `qa-r3p`, real session `qa-r3r`, both created through the admin API and deleted afterwards)
- **N1 PASS.** Pip checked in **with** a photo: the **portrait card** shows an `<img>` whose URL is `/api/santas-workshop/photos/<that check-in photo's id>?v=full` and which loaded (`complete`, `naturalWidth` 1: the generated 1x1 image); the **pickup card** shows the same image from the same URL; the browser fetched it through the photo door with **200**; Pip's card does not say "without a photo". Dot checked in **without** a photo: the card reads **"Checked in without a photo"**.
- **N3 PASS.** On the **real** session the admin registrants card for a checked-in stuffy offers **"Revert last step"**; it opens the reason dialog ("Revert the last step for RealOne? This is a real session. Going back to Registered also frees the sticker. The change and your reason are recorded in the history.") with a single target (the previous step only; a one-option field, where the practice dialog offers "Registered" and "Tagged"); submitting with no reason is refused in words and changes nothing; with a reason the stuffy went back **exactly one step (checked_in -> tagged)** and `sw_stuffy_events` holds one `revert` row (`checked_in` -> `tagged`, note "QA: tagged in error at the door", `actor_kind` admin). The **crew app on the real session offers no revert** (no "Go back a step", no "Practice session only" block; buttons were Check in without a photo / Change sticker / tabs), and the crew revert API is still **403 `practice_only`** even with the admin credential. Practice sessions are unchanged ("Go back a step (practice)", several earlier steps offered).
- **N4 PASS, with a note.** (a) Crew search with no match reads "No stuffy matches that. Check the spelling, or pick a different step above. **Not finding it? Ask the event chair.**" (b) The admin registrants card for a stuffy with no snack reads **"Snack: No snack choice recorded"**. (c) The overview card reads **"Checked in, not yet picked up."** (the old "not yet handed back" is gone). (d) The CSV link reads **"Download all stuffies not yet picked up (CSV)"**; the CSV head is unchanged (State column present). **Note:** the phrase "No snack choice recorded" was implemented on the admin list (`registrants-table.tsx:54`); the **crew check-in card** for the same stuffy still reads "Snack choice: None chosen. Ask the family." (`check-in-panel.tsx:79`), which already gives the worker a sentence and an instruction and is what the analyst's item (b) asked for on the check-in card, so I count it as met, but the two screens say the same thing in different words. If the club wants one phrase, that is a one-line copy change, not a defect.

### Surprises
1. My first probe flagged N3b and N4b as red; N3b was my harness (the real dialog's single target is a one-option select, not static text) and N4b was a question of where the phrase lives (the note above). Both re-checked.
2. The gate spec's two disposable users again produced two "New portal user needs member record review" notices (`blocked_non_production`, unsent); removed (ids `cd3980fe-...`, `8f0e4897-...`). The throttle table is now 0 rows at baseline (it held 3 earlier; another agent cleared them).
3. `.env.local` still holds a `ZEFFY_API_KEY`; every server was started with it forced empty.

### Cleanup
Sessions `qa-r3p-908` and `qa-r3r-908` deleted (children cascade); my check-in photo file and the empty spec folders removed from `.santas-workshop-store/` (only `ping/` remains). Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. Dev `:3101` stopped by PID; no worktree process remains; `:3000` untouched; nothing committed. The deferred list from "Phase 5 — Slice 2" is unchanged.

---

## Phase 5 — Slice 3 "Collage" — 2026-10-13

**Owner:** qa · **Scope:** the public collage `/santas-workshop/c/[token]`, the photo door's anonymous (public) branch, the admin photos page, hide/unhide, group-photo review, publish/unpublish, the collage URL and QR. Slices 1 and 2 re-ran as regression inside the Playwright set.
**Tree state measured:** `HEAD` = `dc3c67e4c1b88fdd30148dffa315781bf51cb58e` (main, v1.95.0) plus the **uncommitted Slice 3 diff in the pipeline worktree** (34 `git status` entries: 13 modified, the rest new). Branch `ep-divine-boat` only (host checked in code before every write); `:3101` (dev) and `:3102` (production build) stopped by PID; `:3000` never touched; no commit. `.env.local` still carries a `ZEFFY_API_KEY`, so every server was started with it forced empty.

### VERDICT: FAIL

One defect, severe, reproduced three ways; everything else in the Slice 3 surface passed. Not a design flaw (Phase 3's review idea is sound, the arithmetic is wrong), so it goes back to the api-developer, not to tech-lead.

| # | Defect | Owner | file:line | Fix size |
|---|--------|-------|-----------|----------|
| **S3-D1** | **The newest group photo can never be marked reviewed, so Publish is refused forever** (and so is "Publish late photos" after a first publish). The review cutoff `through` is `max(created_at)` read back as a JavaScript `Date` (milliseconds); `sw_photos.created_at` is a Postgres `timestamptz` with **microseconds**. The server then asks `created_at > cutoff` in SQL, so a photo whose time has a sub-millisecond part (essentially every photo uploaded through the real crew route) is still "not reviewed" after the admin reviews it. Pressing "Mark group photos reviewed" again sends the same `through` and changes nothing. The admin UI meanwhile computes "reviewed" in JavaScript (also milliseconds), so it shows every chip as Reviewed, **disables** the review button, and still gets `409 photos_unreviewed` (count 1) on Publish: a dead end with no visible cause. Only workaround found: hide the newest photo. | api-developer | `src/lib/santas-workshop/photo-admin.ts:92` (`newestGroupAt` = `max(created_at)` returned as `Date`), `:61` (`unreviewedSql`: `created_at > cutoff::timestamptz`), `:285` (`lte(created_at, cutoff)` in the stamping UPDATE), and `src/lib/santas-workshop/collage-review.ts:31` (`photo.createdAt.getTime() <= cutoff.getTime()`) | small: carry the cutoff as the exact `created_at` text (or compare on `date_trunc('milliseconds', created_at)`, or round the cutoff up by a millisecond) and use the same comparison on both sides |

**Established vs believed.**
- *Established, three ways.* (1) Through the real route: three group photos uploaded by the crew route (so `created_at` defaults to `now()` with microseconds, e.g. `04:22:18.500711`); the admin pressed "Mark group photos reviewed": audit row `through = 2026-10-13T04:22:18.500Z`, counts tile "Not reviewed 1", Publish `409 {"code":"photos_unreviewed","count":1}`. (2) Repeated: three more review calls with the same `through`: still 1 unreviewed, publish still 409. (3) Cause shown in the data: that photo's `created_at` was `.500711` (`to_char(...,'US')`), `through` was `.500`. Confirmation by experiment: after I truncated the three timestamps to milliseconds by SQL (a disclosed setup tweak), the same stored review covered all three at once, the button became disabled with its reason, and Publish succeeded. The late-photo path reproduces it a second time (a group photo uploaded after publish, `created_at` `.656241`): review leaves it unreviewed, "Publish late photos" is refused with count 1.
- *Why the tests missed it.* The unit tests mock the database and the collage e2e seeds photos directly with `new Date()` (`e2e/helpers/santas-workshop-crew.ts` `seedPhoto`, lines 181 to 205), which has millisecond precision. No test uses a real route upload or a microsecond timestamp.
- *Believed, not measured:* that the truncation in the driver's `Date` conversion is the only lossy step; I did not change code.
- No repo-wide sweep is recommended: the other `created_at` comparisons I read (`session-queries`, door matrix) compare database values with database values.

### Gates

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm exec tsc --noEmit` | PASS | exit 0 |
| `pnpm lint` | PASS | 0 errors, the one old warning |
| `pnpm test` (verbose) | PASS | **287 files, 4835 / 4835** |
| `pnpm build:only` | PASS | exit 0, **0 warnings** (no "Dynamic filesystem access"), 324 route rows; present: `/admin/santas-workshop/[sessionId]/photos`, `/santas-workshop/c/[token]` (dynamic), `/api/santas-workshop/photos/[id]`, and the four new admin routes (`sessions/[id]/photos`, `.../photos/review`, `photos/[photoId]/hide`, `sessions/[id]/publish`) |
| Playwright, all workshop specs on `:3101` (default local store) | PASS | **61 passed, 1 skipped, 0 failed** (4.1 min); 11 collage tests; the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS | print nothing; no image/PDF/zip in the diff; every `@` address in the changed files is `example.*` or the club domain; no `console.log` in the new modules; `package.json` untouched |
| Collage e2e `afterAll` cleanup (asked) | **rows and files PASS; empty folders left** | `e2e-col*` rows in `sw_sessions`: **0 before, 0 after**; photo files in `.santas-workshop-store/`: **0 before, 0 after**; but the specs leave an **empty folder per run** (before the run: 5 `e2e-col-*` folders; after: 6 `e2e-col-*` plus 1 `e2e-flow-*`); gitignored and empty, cosmetic. I removed this run's two. |

### Unit tests named for Slice 3, confirmed in the verbose run
`collage-queries` (14: consented and unhidden portraits and published unhidden groups included; blank consent, hidden, unpublished, superseded, purged and **check-in photos never**; nothing while unpublished; tile is exactly `{ id, kind }`; stable order; malformed token is null and never queries; unknown null; unpublished `pending` with the photo date; purged `removed`; live; live and empty), `collage-door` (4: the public viewer's set equals the collage's set, identical null refusals, hidden refused on the next fetch, 5-minute private cache and noindex), `photo-admin` (14: URL and **QR payload are the same string**, hide/unhide write one audit row with ids only, no-op and race write none, **publish refused with unreviewed photos (409 `photos_unreviewed` + count)**, publish after review, zero photos allowed, repeat keeps the original time, unpublish, purged), `collage-review` (8), `collage-contract-no-pii` (8: no name, contact, caption, family or storage field; the token stays out of logs and audit rows), `collage-ui` (11: **publish-refused copy** names the count, **QR payload byte for byte**, review gating, markers, public copy and alt text), `collage-page-source` (5: includes a render of the real page for live, pending, removed and unknown, asserting **no registrant text**), `photos-panel-source` (3), and `admin-routes-gate` (the four new routes: `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first two statements). Gap named above: nothing exercises sub-millisecond timestamps.

### Feature-gate audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Key |
|-----------------|-------------------|----------------------------|-----|
| `GET .../sessions/[id]/photos` | yes (line 20) | yes (line 22) | `SANTAS_WORKSHOP_MANAGE` |
| `POST .../sessions/[id]/photos/review` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `POST .../photos/[photoId]/hide` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `POST .../sessions/[id]/publish` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `/admin/santas-workshop/[sessionId]/photos` (page) | yes, then redirect | yes, then `redirect("/access-pending")` | `SANTAS_WORKSHOP_MANAGE` |
| `GET /api/santas-workshop/photos/[id]` | none by design: admin, crew or **public** viewer, decided by `photo-access.ts`; 404 on every failure | n/a | n/a |
| `/santas-workshop/c/[token]` | none by design (possession of a 128-bit token; read-only; no registrant column read) | n/a | n/a |
Exercised: anonymous 401 on all four admin routes (production build) and 307 to `/signin` on the page; the read of each route file above. A plain-member 403 matrix was not re-run for these four routes (the Slice 1 matrix pattern and the `admin-routes-gate` scan cover them).

### Manual click-through (desktop 1280 px and 360 px; admin UI plus an anonymous browser context)
Seed: a practice session whose **name is `<script>window.__pwn=1</script> QA collage`**, 3 stuffies (Alpha and Bravo consented, Charlie not) with sentinel parent name, email, mobile and notes, a portrait for each, and 3 group photos, all uploaded through the real crew routes with real JPEGs.

| Flow | Result | Notes |
|------|--------|-------|
| Admin photos page, before anything | pass | collage card "Not published / Practice", link with Copy and Open, QR, the amber sentence "3 group photos have not been reviewed yet...", counts tiles (3 group, 0 hidden, 3 not reviewed, 2 on the collage, 1 no consent); group tiles "Not reviewed yet" + Hide; portrait tiles with the stuffy's name and **"On the collage: family agreed"** (Alpha, Bravo) or **"Not on the collage: no consent"** (Charlie); the script-laden session name shows as literal text |
| Publish before review | pass | refused with the sentence and the count 3; nothing published, no audit row |
| Hide asks first; Cancel changes nothing | pass | ConfirmDialog "Hide this photo? It leaves the collage and the family page right away. Someone who already has the page open may still see it for up to 5 minutes." |
| Mark group photos reviewed | **FAIL (S3-D1)** | leaves the newest photo unreviewed with real data; passes with millisecond data |
| Publish | pass (with ms data) | session stamped, status "Published", **5 "Visible to anyone with the link" chips** (3 group, Alpha, Bravo; none on Charlie), one `collage_published` audit row holding counts only (no token or URL) |
| **Public page, anonymous, desktop and 360 px** | pass | **3 group pictures + 2 stuffy portraits**, every image loaded from the photo door; alt text ordinal ("Group picture 1".."3", "Stuffy portrait 1".."2"); **no registrant text in the HTML or the RSC flight data** (no names, parent names, notes, email, mobile, session name, slug); the two fixed lines "We photograph stuffies only, never children." and "Changed your mind? Contact the club and we will take your stuffy down." with a working link to `/connect`; `<meta robots noindex, nofollow, nocache>`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`; **no site header, footer or nav** (only the club-name band); PRACTICE banner; no horizontal scroll at 360 px; no console error; the script in the session name did not run (`window.__pwn` unset) |
| Tap a tile | pass | the **full** variant opens in a dialog; no download control |
| Hide one group photo | pass | admin chip "Hidden", count 1, one `photo_hidden` row; a **fresh** page fetch no longer lists it; the door answers **404 at once** (thumb and full); a browser that already had the thumb still served it from its cache, a cache-bypassing fetch was 404 (the accepted 5-minute residual, **L3 measured**); the stranger's page on reload shows 2 group + 2 portrait tiles |
| Unhide | pass | back on the page, door 200, one `photo_unhidden` row |
| A photo uploaded **after** publish | pass | not on the page, door **404** for a stranger, 200 for the admin; the admin page flags it "Not reviewed yet" and offers "Publish late photos" (which is then blocked by S3-D1; with ms data it publishes it and keeps the original publish time) |
| Unpublish | pass | ConfirmDialog ("The link goes back to 'The photos arrive on...'..."); the link now says **"The photos arrive on Saturday, Dec 19"**, lists no photo; the door is 404 for the previously public photos for a stranger **and for another session's crew cookie**; the admin still sees them; the date **follows the session's photo day** (changed the session to Sat Nov 28: "Saturday, Nov 28"), then restored |
| Re-publish | pass | the same link shows the tiles again |
| Removed state | pass | with `public_purged_at` set by SQL (the Slice 5 engine does not exist yet): "These photos have been removed / The Westerville Lions Club has taken this collage down. Thank you for joining us.", no tile; publish/unpublish refused 409 `session_purged` |
| QR on the admin page | pass | decoded with `jsqr` to **exactly** `qrPayload` (`http://localhost:3000/santas-workshop/c/<token>`, no extra characters) |
| Copy link | pass | the clipboard holds exactly the collage URL; toast "Collage link copied." |
| Admin photos page at 360 px | pass | no horizontal scroll |
| Print (`page.pdf()`, Letter) | pass, with nits | 2 pages, header band, PRACTICE note, the 3-column grid of all 6 tiles, the two lines; **no site header, footer or nav**, no "Contact" link text beyond the sentence; see observations 3 and 4 |

### Adversarial and live checks
| Probe | Result |
|-------|--------|
| **Crew cookie from another session** at the door | collage-visible photos 200 (it is just a stranger; the same as any visitor), the non-consented portrait 404; after an admin hides a collage portrait, 404 for that cookie too; after unpublish, 404 for all |
| **Collage token in a Referer** | production build: **0 of 30** requests from the collage page (images, scripts, fonts, the `/connect` navigation) carried the token in a Referer; a request that arrives with the token in its Referer is answered identically and echoes nothing |
| **L4 token pages** | 9 bad tokens (unknown 22 chars, too short, spaces, `../../etc/passwd`, `%2e%2e%2f`, emoji, SQL-ish, a real token minus one character and plus one, **10,000 characters**): all **404**; rendered page (status, title, visible text, robots, cache headers) identical: **1 distinguishable response**; the 10,000-character token answered in **34 ms**; every 404 is noindex. A real token is 200 |
| **Public DTO scan** | the page HTML and flight data contain none of the sentinel names, notes, email, mobile, session name or slug; the door's headers carry no file name, key or token and add `nosniff` |
| `<script>` in the session name | not rendered on the collage (fixed title), literal text in the admin |
| Door: anonymous | group thumb 200 with `private, max-age=300`, `X-Robots-Tag: noindex`; consented portrait full 200; non-consented portrait thumb and full 404, same as an unknown id |
| Headers on the production build | collage page: `noindex, nofollow`, `Referrer-Policy: no-referrer`, `camera=()`, `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` |

### Deferred (not passes)
1. **Real iPhone/Android at 360 px** for the public page and the admin photos page (tap-to-open dialog, pinch zoom, scanning the QR from the admin screen with a phone). Step: open the published link from the frame QR on each phone and the admin page on a laptop.
2. **Drive-backed photos** (no credentials): the 5-minute hidden-photo window and the placeholder tile on a store outage (`onError`), L3 against Drive.
3. **Printing with background graphics on** and a real printer (observation 3).
4. **The removed state against the real purge engine** (Slice 5): QA set the marker by SQL, so the door's behaviour after a real purge (observation 5) is not yet exercised.
5. SW-L11, L13 and the family page belong to Slices 4 and 5.

### Observations (not defects)
1. **The collage link and QR carry `NEXTAUTH_URL` (`http://localhost:3000/...`) in development.** "Open the collage" therefore opens the **main tree's** `:3000` server (another database), not the server under test; to view the page I used `:3101` plus the path. By design (`getAppUrl()`); Slice 4's origin guard covers the frame QR, not this card.
2. **Dev-only Referer on a font request:** on the dev server one request (`/__nextjs_font/geist-latin.woff2`) carried the page URL, token included, in its Referer; the production build sends none (0 of 30). Not reproducible in production.
3. **Print contrast:** the header band uses a blue gradient with `print:text-black`; with a browser's "Background graphics" option on, the title prints black on dark blue (it is fine when backgrounds are dropped, the default).
4. **Print pagination:** the "Stuffy portraits" heading can be stranded at the bottom of page 1 with its grid on page 2 (a `break-after: avoid` on the headings would keep them together).
5. **The photo door does not read the session's `public_purged_at`.** After the marker was set the page said "removed" but a stranger who already knew a photo id still got 200 (the page lists no ids). Per DECISION-125 the purge deletes bytes and sets each photo's `purged_at` first, and the door refuses purged photos, so this is expected once Slice 5 exists; flagging it so the Slice 5 engine is not skipped on the photo side.
6. The 404 for a bad token has the collage route's title ("Santa's Workshop photos | ...") and echoes the requested path (escaped) in its payload (57 KB for a 10,000-character token); neither distinguishes an unknown from a malformed token.
7. The e2e specs leave empty per-run folders in `.santas-workshop-store/` (see gates).

### Cleanup
Sessions `qa-s3-24134` and `qa-s3b-26159` deleted (children cascade); my 28 photo files and their folder removed, plus the two empty spec folders created by this run; the two "New portal user needs member record review" notices produced by the gate spec's disposable users (`blocked_non_production`, unsent) removed (`email_queue` back to 1362). Branch re-measured equal to the baseline taken before I started: `sw_sessions` 0 (of which `e2e-col*` 0), `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. Photo store: 0 files; `ping/` and the five pre-existing empty `e2e-col-*` folders (not mine) remain. No worktree process remains; `:3000` untouched; nothing committed.

### Phase 5 — Slice 3 handoff
**Status:** complete (FAIL, handed back). **Next agent: api-developer** for S3-D1 (and a regression test that uploads through the real group-photo route or inserts a microsecond `created_at`, then reviews and publishes; also an assertion that the UI's "reviewed" marker and the server's unreviewed count agree). Then qa re-runs `tsc`, `lint`, `pnpm test`, `pnpm build:only`, the eight workshop specs, the PII greps, and the live check: upload three group photos through the crew route, Mark reviewed once, Publish succeeds, then upload a fourth after publish, review, "Publish late photos" succeeds. Observations 3 and 4 are for the ux-developer if the club prints the collage. Phase 6 waits for a PASS.

---

## Re-verification (Slice 3, S3-D1) — 2026-10-13

**Owner:** qa · **Verdict: PASS** (Slice 3). Tree state: `HEAD` `dc3c67e4c1b88fdd30148dffa315781bf51cb58e` plus the **uncommitted Slice 3 diff in the pipeline worktree** (32 `git status` entries; `collage-review.ts` and its test are gone, the S3-D1 fix is in). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 286 files, **4831 / 4831** (one file and four tests fewer: the deleted `collage-review` module) |
| `pnpm build:only` | PASS: exit 0, 0 warnings, 324 route rows |
| All eight workshop Playwright specs on `:3101` (default local store, `ZEFFY_API_KEY=` forced empty) | PASS: **62 passed, 1 skipped, 0 failed** (4.4 min); 12 collage tests including the new "late photo from the real upload route: review once, then Publish late photos succeeds"; the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS: print nothing; no image, PDF or zip in the diff |

The fix as read: `reviewCutoffSql` / `reviewCoveredSql` (`photo-admin.ts:59` and `:69`) compare a photo's stored `created_at` with the stored `created_at` of the photo the admin saw (`throughPhotoId`), entirely in SQL, and are used by the count, the aggregate, the per-photo flag and the stamping UPDATE; no timestamp is parsed or compared in JavaScript for the review (the remaining `toISOString` calls are display fields). New unit tests by name include "the cutoff is a subselect of the stored photo's own created_at, bound only to the session id", "a micro-second photo time (.500711) cannot be made to differ from itself: nothing in the review path parses a timestamp", "a through photo that is not a group photo of this session is a 400 and writes nothing", "records the newest photo id the admin saw (never a timestamp)", and the UI scan "review sends the newest group photo id the admin saw (never a timestamp)".

### The live check that failed, repeated with real uploads (admin UI at 1280 px plus an anonymous context; seed and photos through the real crew routes)
| # | Step | Result |
|---|------|--------|
| V0 | Three group photos uploaded through the crew route | **PASS**: all three carry a sub-millisecond `created_at` (3 of 3 rows differ from their millisecond truncation), i.e. exactly the condition that broke S3-D1 |
| V1 to V2 | Before review | server 3 unreviewed, UI 3 "Not reviewed yet" chips, review button enabled; Publish refused with the count 3 |
| **V3** | **Mark group photos reviewed, once** | **PASS**: server 0 unreviewed, UI 0 "Not reviewed yet" chips (3 "Reviewed"), tile "Not reviewed 0", button disabled: **the chips agree with the server** |
| V4 | Audit | one `group_photos_reviewed` row holding `throughPhotoId` and counts; no timestamp |
| **V5** | **Repeated review** (same body, three more times) | **PASS, harmless**: 200 each time, still 0 unreviewed, no photo un-reviewed. Each repeat does write another audit row (4 rows after 4 calls): noise, not harm (observation) |
| V6 | A `throughPhotoId` that is not a group photo of this session, junk, or the old `{ through: <timestamp> }` body | 400, 400, 400; nothing written |
| **V7** | **Publish** | **PASS**: succeeds after the single review; the card says Published, **5** "Visible to anyone with the link" chips (3 group, Alpha, Bravo; none on Charlie) |
| V8 | Stranger | page lists all three group photos and the door serves each (200) |
| V9 | A **4th** group photo uploaded after publish, captured 10 minutes earlier (as an outbox upload is) | not public: door 404 for a stranger |
| V10 | Admin page agrees with the server on the late photo | server 1 unreviewed, UI 1 chip, button enabled |
| V11 | "Publish late photos" before reviewing | refused with the count 1 (the gate still works) |
| **V12 to V13** | **Review once, then "Publish late photos"** | **PASS**: server 0, UI 0 chips, button disabled; a **stranger's door fetch of the 4th photo is 200** (thumb and full) and the public page lists it |
| V14 | Audit and times | two `collage_published` rows (`first: true` with 3, then `first: false` with 1); the original publish time is unchanged |
| V15 to V16 | A 5th group photo, **hidden** before review | not counted as unreviewed (0); publishing succeeds; the hidden photo stays 404 to a stranger |

### Cleanup (rows, files, and the empty folders this time)
Session `qa-s3-87693` deleted (children cascade; `e2e-col*` sessions 0); the two gate-spec "New portal user needs member record review" notices (`blocked_non_production`, unsent) removed (`email_queue` 1362); my 32 photo files and folder removed; **every empty `e2e-*` folder deleted (9: eight `e2e-col-*` and one `e2e-flow-*`, including the ones from earlier runs by other agents; `rmdir` only, so nothing non-empty could go)**. Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. Photo store: **0 files**, only the long-standing empty `ping/` folder. `:3101` stopped by PID (`:3102` not used this time); no worktree process remains; `:3000` untouched; nothing committed.

### Surprises
1. The Playwright specs (collage and crew-flow) still leave one empty folder per run in `.santas-workshop-store/` even though rows and files are removed; I cleared them by hand. A one-line `rmdir` in the helper's cleanup would stop it.
2. Pressing "Mark group photos reviewed" repeatedly is harmless but each call writes an audit row (the button is disabled once everything is covered, so only an API caller can do it).
3. `.env.local` still holds a `ZEFFY_API_KEY`; every server was started with it forced empty.

### Verdict
**PASS.** S3-D1 is fixed and verified with real uploads (one review is enough; the admin chips agree with the server; repeated review is harmless; the late-photo flow reaches a stranger's door with a 200). The deferred list and observations from "Phase 5 — Slice 3" stand unchanged (real phones, Drive-backed photos, print with background graphics, the removed state against the real purge engine). **Phase 6 next** for Slice 3 (analyst).

---

## Re-verification 2 (Slice 3, post-Phase-6) — 2026-10-13

**Owner:** qa · **Verdict: PASS** (Slice 3 stays PASS). Tree state: `HEAD` `dc3c67e4c1b88fdd30148dffa315781bf51cb58e` plus the **uncommitted Slice 3 diff in the pipeline worktree** (34 `git status` entries, now including the S3-N1 to N5 changes). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 286 files, **4841 / 4841** (was 4831) |
| `pnpm build:only` | PASS: exit 0, 0 warnings, 324 route rows |
| All eight workshop Playwright specs on `:3101` (`ZEFFY_API_KEY=` forced empty) | PASS: **63 passed, 1 skipped, 0 failed** (4.5 min); includes the new "pending after the photo day has passed says the photos are being prepared"; the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS: print nothing; no image, PDF or zip in the diff |

New unit tests confirmed by name: "a portrait retaken after publish is a stranger 404 until Publish late photos stamps it, then 200" (door), "late portraits ride the publish batch" (2: the stamping UPDATE covers consented portraits; a publish after a retake reports the portrait), `needsPublish after an unhide (S3-N3)` (4), and the public-copy tests for the un-hide hint, the late-pictures sentence and the removal line.

### Live checks (admin UI at 1280 px, anonymous stranger context, crew cookie of the session; every upload through the real crew routes, no seed)
Seed: practice session, 3 stuffies (Alpha, Bravo consented; Charlie not) with sentinel contact data, portraits and 3 group photos through the crew routes; reviewed once and published (the audit row now counts both kinds: `photosPublished: 5`, no `groupPublished`).

| # | Check | Result |
|---|-------|--------|
| R0 | Retake Alpha's portrait **after publish** through the real crew portrait route (`replace: true`, a crew phone's cookie) | accepted (200) |
| **R1 to R3** | The stranger | **404 for the retake (thumb and full)**; the superseded old portrait is 404 too; the public page now lists 4 photos (3 groups + Bravo), Alpha's portrait is absent until the batch |
| **R4** | The crew cookie of that session and the admin | door **200 immediately** (thumb and full) |
| R5 | Admin API | the retake is `awaitingPublish: true`, `onCollage: false`; `counts.portraitsAwaitingPublish` 1, `awaitingPublish` 1 |
| **R6 to R7** | Admin tile and sentence | Alpha's tile has **no "Visible to anyone with the link" chip** (Bravo's still does); the sentence reads "1 picture taken since the last publish is not yet public." |
| **R8** | **"Publish late photos"** (no review step for portraits) | a stranger's door fetch of the retake is **200** (thumb and full) and the page lists it |
| R9 | Audit | second `collage_published` row with `photosPublished: 1`, `first: false`; the original publish time is unchanged |
| R10 | Chips and sentence | after a retake exactly **one** portrait is "Visible to anyone" and the late sentence shows; after publishing there are **two** and the sentence is gone (re-checked with a cleaner state after my first probe's text slicing was wrong) |
| R11 | A **second** retake | held (404); the first retake, now superseded, is 404: no stale or unpublished portrait is ever public |
| N3a | Un-hide a photo that was **never published** | the hint **"This picture returns to the collage when you press Publish late photos."** appears |
| N3b | API | un-hide of an already-published photo returns `needsPublish: false`; the hide response `false` |
| Family view | not applicable live: the family page and token route are Slice 5; the rule "family and crew see their own retake at once" is covered by the door matrix unit tests (photo-access) and was exercised here for the crew viewer |

### The copy changes, as specified
- **S3-N1 PASS.** Admin instruction: "Hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies. Then mark them reviewed so the collage can be published." The refusal sentence carries it with the count ("3 group photos have not been reviewed yet. Look through them (hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies), mark them reviewed, then publish."). Crew Group photo screen: "Take a photo of the stuffies together with Santa and Mrs. Claus. **No children in frame.**" The public line is unchanged: "We photograph stuffies only, never children."
- **S3-N4 PASS.** Removal line (shown on the removed page, the pending page and the live footer): "Changed your mind, or see someone who should not be in a picture? Email info@westervillelions.org and we will take it down." with the address as `mailto:info@westervillelions.org`, plus **"Or use the contact form"** linking to `/connect`. The only email address anywhere on the public page is the club's.
- **S3-N5 PASS.** Photo day in the future (Dec 19): "The photos arrive on Saturday, Dec 19"; **photo day is today** (2026-10-13 Eastern): still the date ("Tuesday, Oct 13"); **photo day in the past** (Oct 10): **"The photos are being prepared. They will be right here soon. Please check back."** with no stale date.
- Privacy re-scan of the final public page (live state): none of the sentinel names, notes, email, mobile, session name or slug.

### Surprises
1. After a retake, **Alpha's portrait disappears from the public collage entirely** until "Publish late photos" (the old one is superseded, the new one is held). That is exactly the specified rule, but it is the thing a chair will notice on photo night: a retake after publishing briefly removes the family's portrait from the page. The late-pictures sentence and the button are the cue.
2. The gate spec's two disposable users again produced two "New portal user needs member record review" notices (`blocked_non_production`, unsent); removed.
3. The specs again left empty `e2e-col-*` and `e2e-flow-*` folders (four this run); removed by hand, all by `rmdir`.
4. `.env.local` still holds a `ZEFFY_API_KEY`; every server was started with it forced empty.

### Cleanup
Session `qa-s3-19201` deleted (children cascade); my 40 photo files and folder removed; four empty spec folders removed (only `ping/` remains; **0 files**); the two notice rows removed (`email_queue` 1362). Branch re-measured equal to the pre-run baseline: `sw_sessions` 0 (`e2e-col*` 0), `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. `:3101` stopped by PID; no worktree process remains; `:3000` untouched; nothing committed.

### Verdict
**PASS.** S3-N1 to N5 behave as specified and the post-publish retake rule holds end to end through the real routes. The deferred list from "Phase 5 — Slice 3" stands (real phones, Drive-backed photos, print with background graphics, the removed state against the real purge engine, the family page in Slice 5).

---

## Phase 5 — Slice 4 "Frames" — 2026-10-13

**Owner:** qa · **Scope:** the Frames page `/admin/santas-workshop/[sessionId]/frames`, the two admin routes (`frames/manifest`, `frames/exported`), the browser composite (1200 x 1800 JPEG, QR from `qrPayload`, 300 dpi JFIF), the zip parts and `index.csv`, the origin guard and its dev override, "Export only new and retaken", "Retry failed". Slices 1 to 3 re-ran as regression inside the Playwright set.
**Tree state measured:** `HEAD` = `ab0b566365439435bb71e86e1723faa37e5e0745` (main, v1.96.0, pending push) plus the **uncommitted Slice 4 diff in the pipeline worktree** (36 `git status` entries: 10 modified, 26 new). Branch `ep-divine-boat` only; `:3101` (dev, once with the frame-origin override) and `:3102` (production build) stopped by PID; `:3000` never touched; no commit. `.env.local` still carries a `ZEFFY_API_KEY`, so every server was started with it forced empty.

### VERDICT: FAIL

One defect, small and cosmetic-to-confusing, reproduced; everything else in Slice 4, including the 200-frame run and every adversarial case asked for, passed. A single red item is a red build, so it goes back to the ux-developer; no design flaw.

| # | Defect | Owner | file:line | Fix size |
|---|--------|-------|-----------|----------|
| **S4-D1** | After **"Export only new and retaken (1)"** the summary reads **"1 of 3 frames done."** instead of "1 of 1". The denominator is the manifest's whole frame list (`items.length`), not the number of frames this run set out to make. It reads like two frames failed, in a screen whose own rule is "a part is never presented as complete when frames are missing" (Phase 1 Flow C). The one produced frame, its zip and its marking were all correct. | ux-developer | `src/components/admin/santas-workshop/frames-panel.tsx:208` (`{doneCount} of {items.length} frame...`; `items` is `manifest?.items` at line 103) | one line: count the run's own planned frames (the e2e only covers a full run, so nothing asserts the partial case) |

**Established vs believed.** *Established:* reproduced live (retake Bravo, "Export only new and retaken (1)": text "1 of 3 frames done."; the zip held exactly one JPEG, `-002.jpg`, the new colour, QR intact) and read at the cited line. After a "Retry failed" the same sentence correctly read "4 of 4" because the run was a full one. *Not claimed:* anything about why the e2e missed it beyond "it never runs the partial export".

### Gates

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm exec tsc --noEmit` | PASS | exit 0 |
| `pnpm lint` | PASS | 0 errors, the one old warning |
| `pnpm test` (verbose) | PASS | **296 files, 4948 / 4948** |
| `pnpm build:only` | PASS | exit 0, **0 warnings** (no "Dynamic filesystem access"), 327 route rows; present: `/admin/santas-workshop/[sessionId]/frames`, `/api/admin/santas-workshop/sessions/[id]/frames/manifest`, `.../frames/exported` |
| Playwright, all nine workshop specs on `:3101` (default local store) | PASS | **68 passed, 1 skipped, 0 failed** (4.7 min); the 5 frames tests included; the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS | print nothing; no image, PDF or zip in the diff; no `frame-art.png` added to the repo; no `console.log` in the new modules |
| `package.json` diff | PASS | exactly one line: `"fflate": "^0.8.3"` (lockfile: `fflate@0.8.3` only) |

### Unit tests named, confirmed in the verbose run
`frame-layout` (27: 1200 x 1800; every rect inside the 75 px margin for QR 21 to 43; integer module size of 7 or more with a 4-module quiet zone and a QR of at least 300 px; no overlaps; the caption is the words plus the club address, never a link; cover-crop for 3:4, 4:3 and square; fit-shrink then truncate; never splits an emoji; art must be 1200 x 1800), `jpeg-dpi` (5: sets units 1 and 300 x 300 on an existing JFIF, inserts one after SOI, leaves the rest byte-identical, idempotent, throws on non-JPEG), `zip-parts` (7: 250 into 100/100/50, round trip, stored uncompressed, `index.csv` rides along, a part is settled only when every frame produced or is listed failed), `csv-index` (6: `produced` yes/no with a reason, comma and quote escaping, formula guard, newline survives, left-out rows have no file name, sort order), server tests `frame-manifest` (13: stable alphabetical numbering, late portrait gets max + 1, withdrawn numbers kept, hidden and portrait-less get no number, opted-out included, retake keeps its number, `changed` after a retake, no contact data in the manifest), `frame-export` (12: 404, origin refusal **before** allocation, one write, `23505` retry, idempotent re-run, mark-exported marks / is idempotent / stamps the photo actually used / rejects mismatches and another session's stuffy / refuses purged and oversize), `frame-origin` (7, including "ignores the dev override in production"), `frame-names` (8), `frame-export-input` (3), `frame-export-ui` (6). The two routes are covered by `admin-routes-gate` (`auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first two statements) and the page by `admin-ui-source`. The design called the numbering and origin files `frame-numbering` and `origin`; the same assertions live in `frame-manifest` and `frame-origin`.

### Feature-gate audit

| Route or action | `auth()` | `hasFeature(...)` | Key |
|-----------------|----------|--------------------|-----|
| `POST .../sessions/[id]/frames/manifest` | yes (first statement) | yes (second) | `SANTAS_WORKSHOP_MANAGE` |
| `POST .../sessions/[id]/frames/exported` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `/admin/santas-workshop/[sessionId]/frames` (page) | yes, then redirect | yes, then `redirect("/access-pending")` | `SANTAS_WORKSHOP_MANAGE` |
Exercised: both routes 401 for an anonymous caller. A plain-member 403 matrix was not re-run for these two routes (the Slice 1 pattern plus the `admin-routes-gate` scan). The manifest carries no email, mobile, note or token (sentinel scan) and the audit rows hold counts and flags only.

### Live checks (admin UI at 1280 px; local photo store; every upload through the real crew routes; practice sessions unless stated)
Seed: 5 stuffies with sentinel contact data; Alpha (parent Zulu), Bravo (Yankee, **no photo consent**) and **`Rex, "Q"/..\x`** (Xray) have portraits; Delta has none; Echo's portrait is hidden.

| # | Check | Result |
|---|-------|--------|
| F1 to F4 | **Prepare export** | "3 frames to make, 2 left out" with "Echo: portrait hidden by an admin" and "Delta: no portrait taken yet"; numbers alphabetical by parent last name (Rex 1, Bravo 2, Alpha 3); the two withheld have no number; the non-consented Bravo **is** included (a family's own frame) |
| F5 | Manifest | no email, mobile or note; `qrPayload` equals the collage link |
| **Z1 to Z4** | **Export, download, unzip** (`fflate` in node) | exactly **3 JPEGs plus `index.csv`**, names exactly the manifest's (`ssw-<slug>-001..003.jpg`); every JPEG is **1200 x 1800 (SOF0, 3 components)** with **JFIF 1.1 units 1, 300 x 300 dpi**; 197 to 217 KB each; part named `ssw-<slug>-frames-part-1-of-1.zip`; the three produced stuffies are stamped exported, the two left-out are not; the audit row holds `{marked: 3, partial: false, rejected: 0, unchanged: 0}` only |
| **Z6 to Z9** | **`index.csv`** | header `frame_number,file_name,stuffy_name,parent_last,parent_first,window,produced,reason,photo_consent`; **5 rows**: 3 `produced=yes`, Echo and Delta `produced=no` with the reasons "No frame: portrait hidden by an admin" / "No frame: no portrait taken yet"; **`"Rex, ""Q""/..\x"`** is correctly quoted (the comma and quotes escaped, the column count intact); **file names carry no stuffy name and no path separators** |
| **Z10** | **QR in every frame** | `jsqr` on the decoded pixels of each of the 3 JPEGs returns **exactly `qrPayload`** (`http://localhost:3000/santas-workshop/c/<token>`) |
| Eyeball | Two frames rendered | blue border, gold rule, cream mat, "A Visit to Santa's Workshop 2026", the portrait filling its window with a **"PRACTICE, not for print"** band, the stuffy name large under it (including `Rex, "Q"/..\x` drawn as text), the QR on a white plate bottom left, and "Scan to see the whole day's photos / westervillelions.org" beside it |
| P1 to P3 | **Re-Prepare** | all three read `current`; numbers identical across 4 consecutive manifest calls (1,2,3); the page shows the last export time and "Retaken since last export 0" |
| **P4 to P5** | **Retake Bravo** through the real crew portrait route | Bravo reads **`changed`**, the other two `current`, `changedSinceExport` 1, Bravo **keeps number 2**; the page reads "Retaken since last export 1", "1 portrait was retaken since the last export." and offers **"Export only new and retaken (1)"** |
| **P6 to P9** | **Export only new and retaken (1)** | produces **one** frame: a zip with `-002.jpg` and `index.csv`, 1200 x 1800 at 300 dpi, the **new (orange)** portrait, QR intact; after it all three read `current` again. **S4-D1: the summary said "1 of 3".** |
| **P11** | **A new portrait whose parent name sorts first (Aardvark)** | gets **max + 1 = 4**; nobody else is renumbered; reads `never` |
| **R1 to R7** | **Failure path** (I deleted one stored portrait file) | the run says "3 of 4 frames done. 1 failed." (never shown as complete) and lists "Alpha (ssw-...-003.jpg): The portrait is no longer available"; the part holds the 3 produced JPEGs only and the index lists Alpha `produced=no` with that reason; **only produced frames were marked exported**; after restoring the file **"Retry failed (1)"** produced `ssw-<slug>-frames-retry-1.zip` with exactly frame 003, Alpha is then marked exported and the sentence reads "4 of 4" |
| Z0 | **A session with 0 portraits** | Prepare says "0 frames to make, 1 left out" and "No portraits have been taken yet, so there are no frames to make."; **no Export button exists**; the API manifest has 0 items, 1 withheld (`no_portrait`), no number allocated |
| 360 px | Frames page | "Use a laptop for this step. Making the frames needs a bigger screen and some patience."; no Prepare or Export controls; no horizontal scroll |

### Origin guard
| Check | Result |
|-------|--------|
| **REAL session**, dev server (`NEXTAUTH_URL` is `localhost:3000`), no override | API **409 `collage_url_not_production`**; the page shows the sentence "The collage link on this server is not the club's real web address, so a QR printed from it would not work. Frames for a real session can only be made from the live site." and no Export button; **no number was allocated** (0 `frame_number` rows) |
| Same server restarted with **`SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1`** | the real session's manifest proceeds (200, 1 item), the page shows "1 frame to make", the export downloads a valid 1200 x 1800 / 300 dpi JPEG **without the PRACTICE band** |
| **Production build** (`next start`) **with the same override set** | the real session is **still refused 409 `collage_url_not_production`**: the override is ignored in production (measured, not just unit-tested) |
| Practice sessions | exempt (every practice export above ran on the dev origin) |
| **Purged session** (status set by SQL; no purge engine yet) | manifest **409 `session_purged`**; `exported` 409 too; the page shows "This session's photos have been removed, so there is nothing left to export." and no Prepare button |

### Adversarial
| Probe | Result |
|-------|--------|
| `exported` with a **photo id from another session** | counted in `rejected`, nothing marked, the stuffy's marker unchanged |
| `exported` naming a **stuffy of another session** | rejected, nothing written |
| `exported` with the **wrong frame number** | rejected |
| **More than 500 items** | **400 `invalid_input`**; exactly 500 is accepted (duplicates collapse to one `unchanged`) |
| Malformed bodies (not an array, non-uuid ids, negative frame number, no body) | all 400, never 500 |
| `exported` with a photo that is **no longer current** (Bravo's superseded first portrait) | **accepted and stamped** (`marked: 1`, `rejected: []`), after which the stuffy reads `changed`. This is the api-developer's documented rule ("stamps the photo id the browser actually used, so a retake during export reads changed"; the photo must be a portrait of that stuffy), **not** the "counted in `rejected`" you expected. Recorded as a discrepancy of expectation, not a defect: the effect is conservative (it can only make a frame look stale) and a photo of another stuffy is still rejected. Say if you want it refused. |
| Stuffy name containing `,` `"` and a path separator | CSV escaped, the frame draws the name as text, file names are `ssw-<slug>-NNN.jpg` only |
| Audit rows | counts and flags only (no name, photo id or file name) |
| Anonymous | both routes 401 |

### 200-frame run (L11), headless Chromium 
Setup (disclosed): one **real 1,082,847-byte, 1800 x 2400 portrait** uploaded through the crew route; **199 more stuffies, orders and portrait rows inserted by SQL on the branch** that point at that same stored file (so the browser fetched and decoded a realistic 1 MB image 200 times; the server and the browser may have cached the identical bytes, which flatters the network side). Manifest: 200 items, numbers 1 to 200 with no gaps, identical on a repeat call.
- **Wall time: 37.9 s** from the click to "200 of 200 frames done." (3 frames at a time).
- **Memory:** peak **JS heap 14 MB** (total 22 MB); peak **whole-browser resident memory 202 MB against 98 MB before the export** (about +104 MB; that figure sums every Chromium process that uses a Playwright profile on this machine, which included a second, idle profile, so the increase is the better number). The zip bytes live in ArrayBuffers, not the JS heap.
- **Two parts of 100**: `...-frames-part-1-of-2.zip` and `...-part-2-of-2.zip`, **41.4 MB each** (about 414 KB per frame); part 1 holds `-001..-100`, part 2 `-101..-200`, each with its own `index.csv` of 100 rows; **all 200 JPEGs are 1200 x 1800 with 300 dpi**; names unique; all 200 stuffies stamped exported; progress text moved "Frame 44 of 200, part 1 of 2 (Syn045)" through "Frame 200 of 200, part 2 of 2".
- *Believed, not measured:* that the chair's laptop and a larger real-photo set behave the same (deferred below).

### Deferred (not passes), with the exact step
1. **A 200-frame run on the chair's laptop** with real portraits (different sizes, EXIF orientation, HEIC-converted files) in the browser she will use (Chrome, Safari or Firefox; the 2 x 41 MB downloads and the "allow multiple downloads" prompt). Step: on the dry-run session after the real portraits exist, Prepare, Export, record the time and watch memory in the browser's task manager; confirm both parts download.
2. **A photo counter accepting the zip.** Step: upload one part to the chosen service, learn its rules (file-name pattern, maximum size or count per upload, orientation, accepted DPI), then set `frame_part_size` and `frame_file_prefix` on the session (the columns exist; there is no UI for them yet) and re-export.
3. **The real frame art overlay.** The optional `frame-art.png` (exactly 1200 x 1800; photo window x 75, y 225, 1050 x 990; name band y 1235 to 1335; QR plate x 75, y 1365) was not available, and I added nothing to `public/`. Step: drop the chair's file at `public/images/santas-workshop/frame-art.png` on a preview, Prepare, Export, and eyeball that the portrait, name and QR plate line up.
4. **A printed 4x6 and a phone scan.** The QR modules are 7 px minimum (0.6 mm at 300 dpi); the decode is proven from pixels, not from paper. Step: print one frame at 100 % on the counter's printer and scan it with an iPhone and an Android phone at arm's length.
5. **Production QR origin.** On the live site `NEXTAUTH_URL` must be `https://westervillelions.org` or the guard refuses real-session frames (it did here with the dev origin); step: after deploy, Prepare on the real session and confirm no refusal and that a decoded QR starts with the production host.

### Observations (not defects)
1. **A console 404 on every Prepare/Export:** the page fetches the optional `/images/santas-workshop/frame-art.png`, which does not exist yet, so the browser logs "Failed to load resource: 404" and the server logs a 404. The plain frame is drawn as intended; it will stop once the art is added.
2. **A partial export reuses the full export's zip name** (`...-frames-part-1-of-1.zip` for "only new and retaken"), so saving both to one Downloads folder makes the browser rename one with " (1)". A retry zip has its own name (`...-frames-retry-1.zip`).
3. The index CSV uses the column order `frame_number, file_name, ...` and a `reason` column (the api and ux notes record this deviation from the design's `file_name, frame_number` and `no: <reason>`).
4. On this branch the "Last export" time shows about four hours later than wall-clock time (the database clock on the branch, seen since Slice 1); I did not investigate whether production is affected.
5. The gate spec's two disposable users again produced two "New portal user" notices (blocked, unsent; removed); the specs again left empty `e2e-*` folders in the photo store (five this run; removed by `rmdir`).

### Cleanup
Sessions `qa-s4`, `qa-s4z`, `qa-s4r` and `qa-s4l` deleted (children cascade, including the 199 synthetic stuffies, orders and photo rows); their four photo folders (36 files) and the five empty spec folders removed; the two notice rows removed (`email_queue` 1362). Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. Photo store: **0 files**, only the long-standing empty `ping/`. `:3101` and `:3102` stopped by PID; no worktree process remains; `:3000` untouched; nothing committed.

### Phase 5 — Slice 4 handoff
**Status:** complete (FAIL, handed back). **Next agent: ux-developer** for S4-D1 (one line at `frames-panel.tsx:208`, plus a test that a partial export's summary counts the run's own frames). Then qa re-runs `tsc`, `lint`, `pnpm test`, `pnpm build:only`, the nine workshop specs, the PII greps and the one live check (retake one portrait, "Export only new and retaken (1)", read "1 of 1 frames done."). Phase 6 waits for a PASS.

---

## Re-verification (Slice 4, S4-D1) — 2026-10-13

**Owner:** qa · **Verdict: PASS** (Slice 4). Tree state: `HEAD` `ab0b566365439435bb71e86e1723faa37e5e0745` plus the **uncommitted Slice 4 diff in the pipeline worktree** (37 `git status` entries, now including the S4-D1 fix and the three cleanups). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 296 files, **4949 / 4949** (one more than before: "runSummarySentence > counts against this run's own target") |
| `pnpm build:only` | PASS: exit 0, 0 warnings, 327 route rows |
| All nine workshop Playwright specs on `:3101` (`ZEFFY_API_KEY=` forced empty) | PASS: **69 passed, 1 skipped, 0 failed** (4.6 min); includes the new "a partial export counts against its own target and names its zip distinctly" (6 frames tests now); the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS: print nothing; no image, PDF or zip in the diff; `package.json` still only `fflate` |

### Live (admin UI at 1280 px, a fresh practice session with 3 stuffies and portraits uploaded through the real crew routes)
| # | Check | Result |
|---|-------|--------|
| V1 | Full export | "**3 of 3 frames done.**" (plural); zip `ssw-<slug>-frames-part-1-of-1.zip` (no suffix) |
| **V5** | **S4-D1: retake Bravo, "Export only new and retaken (1)"** | **"1 of 1 frame done."** (singular, against its own target; it read "1 of 3" before) |
| **V6 to V7** | **Subset zip name** | **`ssw-<slug>-frames-part-1-of-1-new.zip`**, distinct from the full run's (so both can sit in one Downloads folder); it holds exactly Bravo's `-002.jpg`, 1200 x 1800 at 300 dpi |
| V8 | A failed frame (I deleted one stored portrait file) | the summary reads **"0 of 1 frame done. 1 failed."**; after restoring the file, "Retry failed" produced **`ssw-<slug>-frames-retry-1.zip`** |
| **V10** | **No `frame-art.png` request at all** | 0 requests for it during Prepare, both exports, the failure and the retry |
| V9 | No console 404 during Prepare/Export | the whole session logged exactly **one** console error and had exactly **one** response of 400 or more: the photo door's 404 for the stored portrait file **I deliberately deleted** for V8. Nothing else (the previous run's art 404 is gone). My probe flagged V9 red only because that deliberate failure was inside the measured window |
| **V2 to V4** | **"Last export" with the ET label** | the page shows **"Oct 13, 2026, 2:00 AM ET"**. Computed independently right after the export: the branch's own audit row `created_at` converted to Eastern = **02:00 AM**, the branch's `now()` in Eastern = **02:00 AM** (UTC 06:00:11), and this machine's wall clock in Eastern = **2:00 AM**. All three agree to the minute, so the four-hour offset is gone |

### Surprises
1. On this branch `now()` and the machine clock now agree (06:00 UTC on both; `TimeZone` is GMT); my earlier note that the branch clock ran about four hours ahead was therefore the display bug the coordinator named (a bare timestamptz string formatted as if local), not a database skew. Withdrawn.
2. The gate spec's two disposable users again produced two "New portal user" notices (blocked, unsent); removed. The specs again left four empty `e2e-*` folders in the photo store; removed by `rmdir`.
3. `.env.local` still holds a `ZEFFY_API_KEY`; every server was started with it forced empty.

### Cleanup
Session `qa-s4v-89216` deleted (children cascade) and its photo folder emptied and removed; four empty spec folders removed (only `ping/` remains, **0 files**); the two notice rows removed (`email_queue` 1362). Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. `:3101` stopped by PID (`:3102` not used); no worktree process remains; `:3000` untouched; nothing committed.

### Verdict
**PASS.** S4-D1 and the three cleanups are verified. The deferred list from "Phase 5 — Slice 4" stands unchanged (a 200-frame run on the chair's laptop, a photo counter accepting the zip, the real frame art overlay, a printed 4x6 phone scan, the production QR origin). **Phase 6 next** for Slice 4 (analyst).

---

## Re-verification 2 (Slice 4, post-Phase-6) — 2026-10-13

**Owner:** qa · **Verdict: PASS** (Slice 4 stays PASS). Tree state: `HEAD` `ab0b566365439435bb71e86e1723faa37e5e0745` plus the **uncommitted Slice 4 diff in the pipeline worktree** (38 `git status` entries, now including S4-N1 to N4 and N6). Branch `ep-divine-boat` only; no commit.

| Gate | Result |
|------|--------|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors, the one old warning) |
| `pnpm test` | PASS: 296 files, **4955 / 4955** (was 4949); new by name: "frame zips never carry the index (privacy) > the export engine does not build or zip a CSV", "buildZip round trip > a part holds pictures only", "frameImageFileName > appends the portrait's short id once the frame was exported before", "frame number and QR size for the real link > the number tag sits inside the canvas margin and is disjoint from the QR plate, the name and the caption" and "...a 69-character collage link (QR version 5) prints at 8 px per module or more with its quiet zone" |
| `pnpm build:only` | PASS: exit 0, 0 warnings, 327 route rows |
| All nine workshop Playwright specs on `:3101` (`ZEFFY_API_KEY=` forced empty) | PASS: **69 passed, 1 skipped, 0 failed** (4.5 min); the skip is increment 1's "open only" public-page test |
| PII greps (phones, emails, streets) | PASS: print nothing; no image, PDF or zip in the diff; `package.json` still only `fflate` |

### Live (admin UI at 1280 px; practice session, 5 stuffies, portraits through the real crew routes; the dev server started with `NEXTAUTH_URL=https://westervillelions.org` so the collage link is the production-shaped link)
| # | Check | Result |
|---|-------|--------|
| Q0 | The link | `https://westervillelions.org/santas-workshop/c/8JoUUg_O3rY6RI532h6Q9A`: exactly **69 characters** |
| **Z1 to Z2** | **Full export, unzip** | the zip holds **only `.jpg` entries** (3: `ssw-<slug>-001..003.jpg`); no `index.csv`, no other file; no entry contains CSV text (`frame_number,file_name` and `produced,reason` found in none) |
| Z3 | Page copy | "The zips hold only pictures, so they are safe to upload to the photo counter. The index below lists every stuffy with the parent's name, drop-off window and photo consent, including the ones left out and why. It is for the club only: keep it off the photo counter." |
| **Z4 to Z6** | **Index download** ("Download index (admin only)", a separate control) | file `ssw-<slug>-frames-index.csv` with the header and **all 5 rows**: Rex, Bravo, Alpha `produced=yes`; Echo `no` / "No frame: portrait hidden by an admin"; Delta `no` / "No frame: no portrait taken yet"; the name `"Rex, ""Q""/..\x"` correctly escaped; plain file names |
| **Q1 to Q4** | **QR decode and module size** | `jsqr` decodes every frame's QR to exactly the 69-character link; the QR is **version 5 (37 modules)**; measured from the decoded finder-pattern locations (centre-to-centre distance 240.0 px over 30 modules): **module size 8.00 px horizontally and 8.00 px vertically** (the unit test predicts 8 px at 360 px) |
| Eyeball | One frame at full resolution | **"No. 001"** in the brand serif at the **bottom right** of the QR block, inside the gold rule, clear of the QR plate (which ends at the bottom margin), the caption "Scan to see the whole day's photos / westervillelions.org", the name above, and the photo window; the PRACTICE band, title and year unchanged (note: the coordinator wrote bottom left, the implementer placed it bottom right because the left is the QR plate; the number does not overlap anything) |
| **R1 to R3** | **Retake, re-export** | after a retake through the real crew route and "Export only new and retaken (1)", the subset zip `...-frames-part-1-of-1-new.zip` holds one entry **`ssw-<slug>-002-63b976.jpg`**, where `63b976` is the first six hex characters of the new portrait's id (`63b976f7-...`); the first export had used the plain `-002.jpg`; the subset zip also has only the `.jpg`; the index downloaded afterwards lists Bravo under the new name |
| **C1** | **Crew portrait prompt** (390 px) | reads exactly: "Take the portrait with Santa and Mrs. Claus. Turn the phone sideways (landscape) and leave room around the stuffy. Keep the sticker out of the shot." followed by "Stuffies only, never the children." |

### Surprises
1. **The index is, by design, a file full of personal data** (parent first and last name, window, photo consent) and is now a browser download of the admin only. It is a plain CSV with no protection once downloaded; the page warns to keep it off the photo counter, which is the control. Nothing in a zip can carry it any more (verified by bytes, not just names).
2. A re-export of a never-changed frame keeps its short-id name only after an earlier export; the first export of a frame is always the plain name, so a counter that already received `-002.jpg` will receive a differently named `-002-63b976.jpg` for the retake rather than an overwrite. That is the S4-N6 intent; I note it so nobody expects the counter to replace the old file.
3. The gate spec's two disposable users again produced two "New portal user" notices (blocked, unsent); removed. The specs again left six empty `e2e-*` folders in the photo store; removed by `rmdir`.
4. `.env.local` still holds a `ZEFFY_API_KEY`; every server was started with it forced empty.

### Cleanup
Session `qa-s4-25911` deleted (children cascade) and its photo folder emptied and removed; six empty spec folders removed (only `ping/` remains, **0 files**); the two notice rows removed (`email_queue` 1362). Branch re-measured equal to the pre-run baseline: `sw_sessions` 0, `sw_orders` 0, `sw_stuffies` 0, `sw_stuffy_events` 0, `sw_photos` 0, `sw_crew_attempts` 0, `sw_session_log` 0, `zeffy_events` 1 (`smoke-2`), `users` 53, `roles` 7, `user_roles` 72, `email_queue` 1362. `:3101` stopped by PID (`:3102` not used); no worktree process remains; `:3000` untouched; nothing committed.

### Verdict
**PASS.** S4-N1, N2, N4, N6 and the S4-N3 copy behave as specified (the N3 guide rectangle was deliberately not built, per the ux-developer's note). The deferred list from "Phase 5 — Slice 4" stands (a 200-frame run on the chair's laptop, a photo counter accepting the zip, the real frame art overlay, a printed 4x6 phone scan, the production QR origin). **Phase 6 next** for Slice 4 (analyst).

---

## Phase 5 — Slice 5 "Family page and retention" — 2026-10-13

**Owner:** qa
**Status:** complete (FAIL, back to the implementer)
**Tree state measured:** worktree on main `0aff8cc` (Slices 1 to 4 merged, v1.97.0 pending push) plus the uncommitted Slice 5 diff (42 `git status` entries; no migration, no dependency, no new env var). Dev server on `:3101` by PID with `ZEFFY_API_KEY` forced empty and `ZEFFY_WEBHOOK_SECRET=whsec_devexample`; database branch `ep-divine-boat` (host checked before every write); local `PhotoStore`; nothing emailed. Servers stopped by PID; the orchestrator's `:3000` untouched.

### Summary
**Verdict: FAIL.** All gates are green and 77 workshop Playwright tests pass, but the one question the coordinator asked me to settle first comes out the wrong way. **The family page does NOT show the portrait from pickup; it waits for the collage to be published.** Before publish the page says "Your stuffy's portrait is on its way", renders no image, and the family portrait door answers 404 (checked live, a consenting and a non-consenting family, both picked up with a current portrait on file). The intended rule is "from the moment it exists, only the whole-day link waits", so this is a defect, and it is in the **server** (two files), not only the UI. One smaller defect: a practice session that has been purged and then reset is emptied but is a dead end (status stays `purged`, cannot be reopened) while the dialog promises "so the drill can start again". Everything else on the retention side held, including a personal purge that left no sentinel value in any table.

### The portrait-visibility question, answered
- **Established (live, no database edits):** practice session, Biscuit (family agreed to photo sharing) and Sir Hops (family did not), both tagged, checked in, portrait uploaded through the real crew route, picked up through the real route. Collage not published (`collage_published_at` null). `GET /santas-workshop/f/<token>`: 200, `family-portrait` count 0, no collage link, heading "Your stuffy's portrait is on its way", "The photos arrive on Saturday, Dec 19". `GET /api/santas-workshop/family/<token>/portrait?v=full`: **404** for both. After `publish`: page shows the portrait (naturalWidth 240), the door returns 200 (full, thumb and `download=1` with `Content-Disposition: attachment`), the collage link appears, for the consenting AND the non-consenting family (consent-independent, as designed). So the api-developer's "regardless of consent and of the publish batch" is true of consent and of the per-photo `published` stamp only; ux-developer's "only once the collage is published" describes what ships.
- **Where it waits (server, two places; the UI only follows the view):**
  1. `src/lib/santas-workshop/family-queries.ts:101` returns `portrait: { state: "none" }` for every unpublished session before it ever looks for a portrait row (file header lines 8 to 10 say the same).
  2. `src/lib/santas-workshop/photo-access.ts:75` (`case "family"` requires `photo.sessionPublished`), so the door refuses even a direct request.
- **Tests that pin the wrong rule and need to change with the fix:** `family-queries.test.ts:65` ("pending has none, and no portrait"), the `family` rows of `photo-access.test.ts` (line 42 of its reference model) and the written table in the Phase 3 design (work-log line 1048, "once the session is published"), `family-ui.test.ts` "pending", the page-source test "pending: ... no image", and `e2e/santas-workshop-family.spec.ts:86` (asserts `family-portrait` count 0 before publish). The page's pending copy also needs a variant for "portrait present, photo day not yet" (the headline today says the portrait is on its way).
- Note for tech-lead: Phase 3's own table (line 1048) said "once the session is published", so the code matches the written design; the rule I was given is a change to it. Hidden, superseded, purged and the public-purge marker must keep refusing; only the `sessionPublished` requirement goes, and the collage link stays gated on publish.

### What I did
- **Gates.** `pnpm exec tsc --noEmit`: PASS. `pnpm lint`: PASS (only the old `budget-context-panel.tsx` warning). `pnpm test`: **PASS, 303 files, 5043/5043**. `pnpm build:only`: **PASS**, 0 warnings (no dynamic-filesystem warning), 332 route rows including `/santas-workshop/f/[token]`, `/api/santas-workshop/family/[token]/portrait`, and `/api/admin/santas-workshop/sessions/[id]/{purge,reset,retention/preview}`. Coverage run not repeated this slice.
- **Slice 5 unit tests, confirmed by name in the verbose run:** `family-queries.test.ts` (8: portrait without consent and without a publish stamp once published; collage link only when published; removed after public purge; hidden is `unavailable`; practice banner; unknown, malformed, wrong-length and withdrawn tokens are the same null and a malformed one never queries; the door's lookup); `family-contract.no-contact.test.ts` (6: DTO names no parent, child, contact, order, sticker, Zeffy or storage field; never reads the check-in photo; decides through the door's own function; never logs); `retention.test.ts` (26: refused before the date with 409 and nothing touched; active session refused; Eastern midnight turnover; force without reason 400; scope already purged is a no-op; bytes deleted before the stamp; both markers move status to `purged`; tombstones survive; audit rows carry counts only; resumability with a failing adapter delete, time budget `done:false`, a late upload, zero-row sentinel; reset refused on real with 403; reset resumes after a failing delete); `retention-policy.test.ts` (7); `retention-ui.test.ts` (7, the dialog copy and blocked/due state text); `family-ui.test.ts` (10, including source scans); `admin-actions-ui.test.ts` close warning (B-181, none/singular/plural); `session-queries.test.ts` "no check-in photo (B-180)" and `photo-access.test.ts` / `photo-door.test.ts` (door refuses after `public_purged_at`, and check-in/superseded after `personal_purged_at`); `admin-routes-gate` rows for purge, reset and preview.
- **Playwright, all workshop specs on `:3101`:** family 8 + frames 6 + collage 13 = 27 passed; admin-gate, crew-admin, crew-entry, crew-flow, `santas-workshop.spec.ts` = 36 passed, 1 skipped (the open-only first-sign-up control at 390x844, a documented skip); session-edit 7 + webhook-to-roster 7 = 14 passed once `ZEFFY_WEBHOOK_SECRET=whsec_devexample` was also exported to the runner (without it both specs skip by design; the first run showed 14 skipped for that reason, not a failure). **77 passed, 0 failed.**
- **PII and hygiene greps** (phones, personal-provider addresses, street addresses over `src e2e scripts drizzle` and the whole tree): none. No image, PDF or zip in the diff. `package.json` and `pnpm-lock.yaml`: no change (no new dependency). No `console.log`/`console.debug` in the new family, retention and page files. No native dialogs.
- **Live lifecycle on a practice session** (real routes for every write; webhook order posted signed; SQL used only to read, and to read the sentinel tables): registered five stuffies (one signed three-ticket Zeffy order mapped and re-read, two manual adds with sentinel contact values, later two more), tagged, checked in (one with a check-in photo, the rest without), portraits, pickup name check and pickup, one withdrawn.
  - **QR decode:** the pickup screen on a 390 px phone (real crew UI, admin cookie) shows a QR that jsQR decodes to `<origin>/santas-workshop/f/<familyToken>` (560 px image) and that URL resolves.
  - **Family page after publish:** portrait shows for Biscuit (agreed), Sir Hops (did not agree), a `<script>` named stuffy and Quill; collage link is a relative `/santas-workshop/c/<22-char token>`; no console error; HTML holds no parent name, email, sentinel mobile or visible token; `X-Robots-Tag: noindex`; door `Cache-Control: private, max-age=300`.
  - **`<script>` in a stuffy name:** the heading reads `<script>window.__xss=1</script>Scripty` as text and `window.__xss` is undefined.
  - **Print (Letter, `page.pdf`):** no site chrome (no nav, sign-in, footer links); the Print button is hidden; the collage QR is present and decodes to the collage URL; the token appears only inside the QR (pdftotext finds none); the title is black on white, no blue gradient (B-183). It prints on **two** sheets: the one-line takedown paragraph strands alone on page 2 (observation O1 below).
  - **Tokens:** unknown, a second well-formed unknown, withdrawn, short, 60-char, `..%2e%2e`, SQL-ish and unicode tokens all give the same plain 404 for the page and the door (same content type, cache header and body; the two page bodies differ only in Next's per-request id, checked by diff). A malformed token never reaches the database (unit-tested).
  - **A family token against other surfaces** (as header, cookie and bearer): crew roster, crew stuffy card, crew pickup POST, admin retention preview, purge, reset: 401; `/admin/santas-workshop/<id>`: 307 to `/signin`. The public photo door gives 404 for the non-consented portrait and 200 for the consented published one (as designed).
  - **Retention, closed session before its dates:** preview returns counts only (5 orders, 5 stuffies, 1 check-in photo, 14 event notes, 1 webhook snapshot). `purge personal` and `purge public` before the date: **409 `not_eligible`** "This cannot run yet: the date is 2027-01-19." / "...2027-01-31." On an active real session: 409 "the session is not closed and the date is 2027-01-19." `force` with no reason, a blank reason, or 501 characters: 400 with plain sentences; unknown phase and malformed JSON: 400; another session's id and a malformed id: 404. No refusal moved a marker, a status or added an audit row (log count 20 before and after).
  - **Personal purge, forced with a typed reason through the UI (390 px):** the confirm button is disabled until a reason is typed, then enables; the run finished in one round (1 photo deleted). Marker set, status still `closed`. **SQL sentinel scan over `sw_orders`, `sw_stuffies`, `sw_stuffy_events`, `sw_session_log` and `zeffy_events` payloads for the session's campaign: 14 patterns (family surname and first name, sentinel email and mobile, note to Santa and care note sentinels, `example.invalid`, the webhook order's buyer surname, phone answer, note and care text, snack, window label) each present before (positive control: 1 to 4 hits per pattern per table) and zero hits everywhere after.** The registrants list shows no parent or contact data and still lists the stuffy names; tag codes (6) and family tokens (7) remain as tombstones; no check-in photo row is left un-purged and the admin photo door answers 404 for the check-in photo. The family page still shows the stuffy name and the portrait. `sw_session_log` holds the typed reason twice (`purge_step`, `purge_done`, with counts) and **no stuffy or family name** (0 rows match). A second personal purge is a harmless no-op (`noop:true`, 0 photos, no new audit).
  - **Public purge, forced with a reason (API re-post loop, 1 round, 4 of 4 photos):** both markers set and status becomes `purged`; every photo 404s for anonymous AND admin, full and thumb; no un-purged photo row; the local store folder is empty (bytes deleted); the family page says "These photos have been removed" with no portrait and no link; the family door is 404; the collage page says removed with no photo URLs.
  - **Reset:** on the practice session: confirm dialog states "5 orders, 7 stuffies and 5 photos will be deleted"; afterwards orders, stuffies, photos, events and webhook snapshots are all 0 and the old family token is 404 (but see S5-D2). On a **REAL** session: **403 `practice_only`** for the signed-in admin, nothing deleted, and the real session's preview offers no reset.
  - **B-180:** the overview tile counts the four checked-in-or-later stuffies with no check-in photo (matches SQL), links to `?flag=no_checkin_photo`, the filtered list names exactly those four (not Biscuit, who has one), each row carries the "No check-in photo" badge.
  - **B-181:** a worker phone (worker code, real enter route) that has written (a tag) counts as one device (the count is writes, not roster reads); the Close dialog then adds "1 phone used the code in the last hour. Photos still waiting on it cannot be sent after closing."; with no such phone it says nothing extra. (My first attempt used a roster read, counted zero, and closed the session; I reopened it and repeated with a write. Both transitions are in that session's history; the session is deleted.)
  - **B-183 on the collage print:** with 8 group pictures and 9 portraits, "Group pictures" and "Stuffy portraits" each stay with their first row (no stranded heading); title is black on white. With lazy images that have not loaded (a headless `page.pdf` without scrolling) the unloaded tiles print as empty frames; after scrolling the page every tile prints (O2).
- **Feature-gate audit** (read from the route files, plus the static gate test rows above, plus live 401 for an anonymous caller):

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /api/admin/santas-workshop/sessions/[id]/retention/preview` | yes (line 18) | yes (line 20) | `SANTAS_WORKSHOP_MANAGE` (counts only, no personal data) |
| `POST .../sessions/[id]/purge` | yes (27) | yes (29) | `SANTAS_WORKSHOP_MANAGE`; server recomputes eligibility; `force` needs a reason |
| `POST .../sessions/[id]/reset` | yes (23) | yes (25) | `SANTAS_WORKSHOP_MANAGE`; refused with 403 on a real session whoever asks |
| `GET/POST .../sessions/[id]/stuffies` (touched for B-180) | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `/admin/santas-workshop/[sessionId]` page (RetentionCard) | yes (23) | yes (25, redirect) | `SANTAS_WORKSHOP_MANAGE` |
| `GET /santas-workshop/f/[token]` and `GET /api/santas-workshop/family/[token]/portrait` | none by design (token-gated, 128-bit, identical 404) | n/a | the door still runs `decidePhotoAccess` with the family viewer |

  Not exercised live: a signed-in member WITHOUT the key against the three new admin routes (the existing gate e2e only loops the pages and the sessions list; the static `admin-routes-gate` test pins `auth()` then `hasFeature()` as the first two statements of all three and I read them).

### Defects (route to the implementer; S5-D1 is a design change, so tech-lead should confirm the rule first)
- **S5-D1 — portrait waits for publish (settles the coordinator's question).** Server: `src/lib/santas-workshop/family-queries.ts:101` and `src/lib/santas-workshop/photo-access.ts:75`; UI follows the view (`family-ui.ts:51-55`, `src/app/santas-workshop/f/[token]/page.tsx`) but needs a "portrait present, collage pending" variant. Reproduce: pick up a stuffy with a portrait before publishing and open its family link: no image, door 404. Fix then re-run `e2e/santas-workshop-family.spec.ts` (its line 86 test must change).
- **S5-D2 (low) — reset of a purged practice session is a dead end.** `src/lib/santas-workshop/retention.ts:416` clears only `collage_published_at`; the purge markers and `status='purged'` stay, and `POST .../status` then answers 409 `session_purged` for active, draft and closed. The card still offers "Reset practice session" (`retention-card.tsx:230` region; `RESET_COPY.body` in `retention-ui.ts:92` says "so the drill can start again"). Either hide the reset on a purged session, or have reset clear the markers and return the session to a usable status, and say so.

### Observations (not defects)
- **O1:** at Letter the family page prints on two sheets (portrait and QR fill page 1; the takedown paragraph is alone on page 2); the collage print's footer also lands alone on page 3. No heading is stranded.
- **O2:** unscrolled headless `page.pdf()` prints not-yet-loaded lazy images as empty frames (collage); a real browser print dialog normally loads them, but nobody has checked on the club's printer path.
- **O3:** a local-store purge leaves the empty session folder behind; the e2e specs and the storage check leave empty `e2e-*` and `ping` folders; and `.santas-workshop-store/s5-smoke-68306/` still holds 12 orphan photo files (no database rows) from the api-developer's own smoke run, which I did not remove because they are not mine.
- **O4:** purge and reset are gated by the area's single key `santas_workshop.manage` (held by admin and board_member by default); there is no separate key for the two irreversible actions. This follows the Phase 3 design; the chair should know a board member can run them.
- **O5:** the publish response's `collage.url` carries `http://localhost:3000` in dev (origin from env), while the page links and QRs I measured used the request origin; not a production concern.
- Not verifiable here: a real phone camera scan of the pickup QR (decoded from the rendered image only), a Drive-backed purge, a live `done:false` time-boxed resume and a concurrent double purge (all unit-tested with a failing/slow adapter), and the real Zeffy API.

### Cleanup and tree state
Sessions, orders, stuffies, events, photos, attempts, logs: 0; `zeffy_events` 1 (`smoke-2`); users 53, roles 7, user_roles 72; `email_queue` 1362 (the two "New portal user needs member record review" notices the gate spec creates were removed by id). My three sessions (`qa-s5-…`, `qa-s5r-…`, `qa-s5c-…`) and my webhook snapshot row are deleted; their bytes were deleted through the app's own reset. The store holds only the 12 files noted in O3; empty folders removed with `rmdir`. Nothing committed; `git status` still 42 entries.

### Open questions / handoff notes
- **Next agent: the original implementer(s) (api-developer for S5-D1 server and S5-D2, ux-developer for the pending-with-portrait copy), after tech-lead confirms the S5-D1 rule and updates the Phase 3 table.** Then qa re-verifies (family spec, door matrix, a live pickup-before-publish check). Do not hand to analyst for Phase 6 until then.
- Decision for tech-lead: S5-D1 reverses a sentence in the Phase 3 design (line 1048), so it deserves a one-line DECISION entry.

### Re-verification (Slice 5, S5-D1/D2) — 2026-10-13

**Verdict: PASS for S5-D1 and S5-D2** (both fixed and verified live). Two print results fall short of what the fix notes claimed (O1 below); they are cosmetic and were never part of the two defects, so I left them as observations. Tree: HEAD `0aff8cc` plus the uncommitted Slice 5 diff with the post-QA fixes (42 `git status` entries; no migration, no dependency).

**Gates (all re-run after the last edits):** `pnpm exec tsc --noEmit` PASS. `pnpm lint` PASS (the one old `budget-context-panel.tsx` warning). `pnpm test` PASS, 303 files, **5048/5048** (up 5 from 5043). `pnpm build:only` PASS, 0 warnings, 332 route rows including `/santas-workshop/f/[token]`, `/api/santas-workshop/family/[token]/portrait` and `.../sessions/[id]/{purge,reset,retention/preview}`. Workshop Playwright on `:3101` with `ZEFFY_WEBHOOK_SECRET=whsec_devexample`: **77 passed, 1 skipped** (the open-only 390x844 control), 0 failed. PII greps (phones, personal-provider addresses, street addresses), images/PDF/zip in the diff, `package.json` and lockfile, `console.log`: all clean. New tests confirmed by name in the verbose run: `getFamilyView > S5-D1: the family sees its own portrait BEFORE the collage is published; only the collage link waits`, `getFamilyView > pending with a hidden portrait withholds it, and with none says none`, `familyModel > pending with a portrait: the portrait shows, the collage link waits (S5-D1)`, `familyModel > pending without a portrait: on its way, plus the photo day`, `resetPracticeSession > S5-D2: a purged practice session is returned to draft with both purge markers cleared, so the drill can restart`, plus the updated photo-access matrix.

**S5-D1 live (practice session, real routes, no database edits):**
- Pickup before any publish (`collage_published_at` null): Biscuit (family agreed), Sir Hops (did not) and the `<script>`-named stuffy each show the portrait on the family page (naturalWidth 240), the family door answers 200 for full, thumb and `download=1`, there is **no collage link**, and "The photos arrive on Saturday, Dec 19" replaces it. No contact data in the HTML, no console errors, `<script>` stays text. The public photo door still answers 404 for the consented portrait, and the collage page still shows no photos (portraits stay private to strangers until publish).
- Publish: the link "See the whole day's photos" appears, the arrival sentence goes, the portrait stays.
- Hide the portrait: **family door 404, no image**; the page does not say "on its way", it says "This photo isn't available. The club has set this picture aside. Please ask a member of the crew." (the `unavailable` state from the original design, also with the collage link when published). Another stuffy's portrait is unaffected; unhide brings it back at once. Pending plus hidden: no image, door 404, no link, same "isn't available" wording plus the arrival day. Unhide before publish returns the portrait immediately. The coordinator's expectation was "says it is on its way"; the shipped wording is the deliberate `unavailable` copy, so I treated door 404 and no image as the pass condition and flag the wording for a decision (S5-N1).
- Unpublish: the family keeps the portrait; the link disappears.
- Close, then forced public purge (re-post loop): family page "These photos have been removed", no image, door 404, status still `closed`.

**S5-D2 live:** forced personal purge on top gave status `purged`, both markers set; control: `POST status` to active answered 409 `session_purged`. The Retention card's reset dialog now reads "Its removal markers are cleared and the session returns to draft, so you can activate it again." plus the counts. After the reset (UI): orders, stuffies, photos, events and webhook snapshots 0; **status `draft`; `personal_purged_at`, `public_purged_at` and `collage_published_at` all null**; the audit row is `reset` with counts only (events 26, orders 3, stuffies 5, photosDeleted 4); the card shows the two scopes as "Not yet". The old family token answers 404 for page and door. The **Activate button is offered and works** (status `active`); a new registrant added to the restarted drill gets a working family page. Reset on a REAL session: still 403 `practice_only`, status untouched.

**Print (Letter and A4, headless `page.pdf`, images loaded):**
- Collage at Letter: with 8 group pictures and 9 or 8 portraits it prints on **three** sheets and the footer sits alone on the third; with 6 or 5 portraits (or fewer) it is two sheets and the footer sits under the portraits; with 3 and 3 it is one sheet. At A4 (9 portraits) the footer is not alone. Headings stay with their first row in every case; title black on white.
- Family page at Letter: **pending with portrait is one sheet** (the claim holds), but **published (the page families print, with the collage QR block) is two sheets**, the footer alone on the second. It overflows by a few millimetres (content height about 968 px against about 965 px available); at A4 it is one sheet. The print QR decodes to the collage URL; the token is not printed as text.

**Feature-gate audit:** no route or gate changed in the post-QA fixes (the family door and `getFamilyView` are token-gated by design; reset stays `SANTAS_WORKSHOP_MANAGE` behind `auth()` and the real-session 403). The audit table in the first Slice 5 report stands.

**Remaining observations (not defects):**
- **S5-N1:** hidden-portrait wording ("isn't available") differs from the "on its way" the coordinator expected; if "on its way" is the intent, it is a one-line copy change in `family-ui.ts`/`family-copy` plus its test.
- **O1 (print, cosmetic):** the published family page at Letter and a collage whose last portrait sheet is full strand the footer on an extra sheet. `.sw-print-footer { break-before: avoid }` only helps when the footer physically fits. Options if the chair cares: shave `max-height` of `.sw-family-portrait` (currently 125mm) a few millimetres, or let the portrait grid break between rows.
- Not verifiable here, unchanged: real phone camera scan, Drive-backed purge, live `done:false` resume, concurrent purge (all unit-tested).

**Cleanup:** my sessions (`qa-s5-…`, `qa-s5c-…`, `qa-s5r-…`) and the webhook snapshot row are deleted (bytes through the app's own reset); the gate spec's two "New portal user needs member record review" rows were removed by id; counts are back to baseline (sessions, orders, stuffies, events, photos, attempts, logs 0; `zeffy_events` 1; users 53, roles 7, user_roles 72, `email_queue` 1362). The local store holds no files and no folders (the implementers' earlier orphan files were already gone when I started; I removed only empty directories). Dev server stopped by PID; `:3000` untouched. Nothing committed.

**Next agent:** analyst for Phase 6 on Slice 5, with S5-N1 and O1 as decisions for the chair, not blockers.

### Re-verification 2 (Slice 5, post-Phase-6) — 2026-10-13

**Verdict: PASS.** The three Phase 6 changes (S5-N1 purge scrub of description, withdraw reason and log reasons; S5-N3 "event finished" eligibility; the one-sheet Letter family print) all behave as specified on a live practice session. Tree: HEAD `0aff8cc` plus the uncommitted Slice 5 diff with all post-QA and post-Phase-6 edits (42 `git status` entries; no migration, no dependency).

**Gates:** `pnpm exec tsc --noEmit` PASS. `pnpm lint` PASS (the one old warning). `pnpm test` PASS, 303 files, **5051/5051** (up 3). `pnpm build:only` PASS, 0 warnings, 332 route rows including the family page, the family portrait door and the purge, reset and preview routes. Workshop Playwright on `:3101` with `ZEFFY_WEBHOOK_SECRET=whsec_devexample`: **77 passed, 1 skipped** (the open-only 390x844 control), 0 failed; the "photo day has passed" collage test did not flake after the restart. PII greps, images/PDF/zip in the diff, `package.json`/lockfile, `console.log` in the touched files: all clean. New tests confirmed by name: `purgeSession: personal scope > S5-N1: the personal scope also nulls the description, the withdraw reason and admin reasons in the session log, keeping the stuffy name and the forced-purge reason`; `purgeSession: eligibility ... > S5-N3: an unclosed session whose pickup day is at least a day in the past is eligible without force`; `... > refuses an active session whose pickup day has not passed, even past the date (S5-N3)`; `retentionScopeStatus > an unclosed session is eligible once the pickup day is at least a day in the past (S5-N3), not before`.

**S5-N1 live (practice session, real routes, Eastern today 2026-10-13; the engine's clock is injectable only in code, so I used the real clock with dates in the past instead of a simulated date).** One signed Zeffy order plus three manual adds, one withdrawn with a typed reason, one reverted with a typed reason, one with a portrait. Sentinels planted: a stuffy description (`SENTINEL-DESC-S5`), a snack, three manual-add reasons, a withdraw reason, a revert reason, sentinel parent names, email and mobile, and the webhook order's own buyer, phone and note text. **Disclosed SQL setup:** no app route writes an admin reason into a non-purge `sw_session_log` row (manual add, withdraw and revert reasons live in `sw_stuffy_events.note`, which was already scrubbed), so to exercise the new log scrub I inserted one `status_changed` row whose `detail` carried `reason: SENTINEL-LOG-S5`.
- **Positive control before the purge:** 18 patterns each present 1 to 4 times in the expected tables (orders, stuffies, events, zeffy payload); the planted log sentinel present.
- **Sequence:** forced public purge with the reason "QA s5 forced purge reason n1" (the public scope left all personal data alone: 4 orders still held buyer email), then the **unforced** personal purge (HTTP 200, `forced:false`).
- **After:** **zero sentinel hits in `sw_orders`, `sw_stuffies`, `sw_stuffy_events`, `sw_session_log` and the `zeffy_events` payload** for every pattern. `sw_stuffies.description` and `withdrawn_reason` are null on all 6 rows; stuffy names (6), tag code, family tokens (6) and the withdrawn stamp remain. The planted log row keeps `to`/`from` and lost only its `reason` key. **The forced public purge's reason survives in both its `purge_step` and `purge_done` rows**, and the unforced personal `purge_done` row carries `logReasons: 1` and no reason. Status became `purged`.
- Note: the purge audit counts `stuffies: 6` (every row it updated) while the preview counted 5 (rows that actually hold personal fields; Rexy had none). Cosmetic, not a defect.

**S5-N3 live (practice sessions, real clock):**

| Session | Result |
|---|---|
| active, pickup yesterday, personal date today | state due, no blockers; unforced purge succeeded (above) |
| active, pickup two days ago, personal date today | due, no blockers; unforced purge 200 `forced:false` |
| active, pickup **today**, personal date tomorrow | blocked `["session_open","before_date"]`; unforced purge **409** "This cannot run yet: the event has not finished yet and the date is 2026-10-14."; the old "the session is not closed" wording is gone |
| active, pickup past, personal date in 5 days | blocked by the date only; 409 "the date is 2026-10-18" |
| closed, pickup today, date tomorrow | blocked by the date only (closed counts as finished) |

(The personal date must be after the pickup day, so "pickup today" always carries the date blocker as well; the session_open wording was seen in the API, the card text and the purge dialog, which says "This is earlier than planned: the event has not finished yet and the date is 2026-10-14. Give a reason to run it now." and states "Each stuffy keeps only its name, its portrait and its family page link", now true.)

**One-sheet print, published family page, headless `page.pdf` at Letter and A4, practice banner included (the worst case), images loaded:** a 1800x2400 portrait, a 2400x1800 landscape, a 2000x2000 square and a 1800x2400 portrait under a 62-character stuffy name that wraps to two lines: **every one prints on exactly one page at both Letter and A4**; the print caps the image at about 340 px tall; the print QR decodes to the collage URL; the token is not printed as text. The earlier two-sheet overflow is gone. (The collage print's footer-alone-on-a-full-last-sheet case from Re-verification 1 was not part of this change and was not re-measured.)

**Feature-gate audit:** no route or gate changed beyond the purge engine's internals; the three admin routes still start with `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` (static gate test green; anonymous 401s unchanged); the family page and door stay token-gated by design.

**Cleanup:** all my sessions (`qa-s5n-…` including one orphaned by a script error in my first attempt, `qa-s5nb…ne`, `qa-s5p-…`) were reset through the app where they held photos, then deleted, with their webhook snapshot; the gate spec's two notice rows removed by id. Counts are back to baseline (sessions, orders, stuffies, events, photos, attempts, logs 0; `zeffy_events` 1; users 53, roles 7, user_roles 72, `email_queue` 1362). The local store holds no files or folders. Dev server stopped by PID; `:3000` untouched. Nothing committed.

**Next agent:** none for Slice 5 beyond the orchestrator's push gates; the open O1 observation (collage footer on an exactly-full last sheet) stands as a chair decision.

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

## Phase 6 — Slice 2 — 2026-10-12

**Scope judged:** the "dry-runnable core": the worker (crew) app at `/santas-workshop/crew/[slug]`, its 13 API routes, the photo store (memory, local and Drive adapters) and the one photo door, the encrypted worker code, cookie, throttle, pause and rotate, the sticker-binding rules, the state machine with its pickup name check, the phone photo outbox, and the Slice 2 admin controls (status buttons, worker-code card, Test and Check storage, manual add, refund Keep/Withdraw, attention dismissal, withdraw, practice go-back, awaiting-pickup CSV), plus the `Permissions-Policy` rule. **Out of scope, not gaps:** collage, publish/hide and the admin photos page (Slice 3), frame export (Slice 4), the family page, purge and practice reset (Slice 5).

**Tree state measured:** worktree on main `160b090` (v1.94.0, Slice 1 shipped) plus the uncommitted Slice 2 diff (89 `git status` entries; no migration, three dependencies `jsqr`, `qrcode`, `@types/qrcode`). Method: the whole work-log (my Phase 1 and addendum, my Slice 1 Phase 6, both Phase 3 addenda, the Slice 2 Phase 4 sections with R1/R2 and D1 to D3, QA's FAIL then PASS), DECISION-121/122/125 and spec §4, then the shipped code: `crew-auth/entry/throttle/cookie`, `tag-binding`, `stuffy-transitions`, `photo-service`, `photo-store/config` and factory, `session-status`, `storage-admin`, `crew-messages`, the crew panels, `registrant-actions`, `next.config.ts`, `scripts/spike-drive.ts`. I re-ran 104 test files (1,652 tests) over the workshop, Zeffy, components, permission and gate suites (green) and a PII/key grep over new and changed non-doc files (no personal address, phone or live key; the only hits are fake key text in `drive.test.ts` fixtures, see S2-N10). I then drove the real app myself on `:3101` (branch database, local photo store in the scratchpad, `ZEFFY_API_KEY` forced empty, no Sync, stopped by PID, `:3000` untouched, test rows deleted and the branch re-measured at 0 sessions, orders, stuffies and photos): admin overview at 390 px, the code screen, the roster, a tag by typed sticker code, the check-in card, a queued photo, the portrait card, and the pickup name reveal, all at 360 px. Everything that depends on a real phone or the real Drive is **unmeasured** (QA's deferred list is mine too).

## VERDICT

**SHIP WITH NOTES.** The core process works end to end on a phone-sized screen, the credential and contact-data rules hold, every Slice 1 N4 condition is present, and the failure paths QA could reach (stale state, parallel retakes, cross-session ids, pause/rotate/close, offline outbox) passed with numbers. One real intent miss was found by reading the cards against Phase 1: **the check-in photo, the condition record the whole "first picture" step exists for, is stored but never shown to anyone** (S2-N1). It is a UI-only fix on data and routes that already exist, nothing real is exposed before the dry run, so it ships as a note, but it is a **gate**: if it is not fixed and re-verified before the dry run (week of Dec 7) my verdict for the dry run is NEEDS REWORK. Two other notes also gate dates: an admin-revert button for real sessions (S2-N3, before Dec 17) and the family-QR decision (S2-N5, Dec 14).

## ONE-LINE TAKE

> A volunteer can open a phone, enter the shared code, tag a stuffy by scanning a sticker, check it in with a first photo and the snack choice on screen, take and retake the one portrait, shoot group photos, and hand the stuffy back after seeing and confirming the name on the order, with photos waiting safely on the phone when the signal or storage fails; what a volunteer, and the chair, still cannot do is look at the check-in photo they took.

## What's Working

- **The spec §4 process, step by step, on a phone.** Step 2 (tagging): roster with filters and search, scan or type the sticker, a confirm card that shows the last four characters, "Sticker put on Max". Step 3 (check-in): the card leads with the **snack choice** and the care note in large type, then "Take photo", with "Check in without a photo" behind a ConfirmDialog. Step 4 (portrait): one current portrait, retake asks "Replace the portrait?" and supersedes (QA: 20 parallel retakes, one current portrait, 0 500s), group photos are filed against the session with no stuffy and land unpublished. Step 6 (pickup): scan or search, "Ask the person for their name, then tap the button to see the name on the order", the name appears only after the tap, then "Name matches" or "Someone else is collecting" (note required), then "Mark picked up", which is shown disabled until a choice is recorded. I watched all of this on `:3101` at 360 px; the parent name was absent from the page before the reveal and present after.
- **The collision table is implemented one row per outcome, in plain words.** Same sticker on the same stuffy is a no-op with no history row; a sticker on another tagged stuffy asks "Move this sticker?" and names the other stuffy; a sticker on a checked-in stuffy is refused ("Ask the event chair"); a stuffy with a different sticker asks "Replace the sticker?" and the old code later scans as retired; an unbound sticker at the scan screen offers **Tag it now** and **Find by name**; two workers racing for one sticker get one 200 and one `tag_already_bound`, never a 500 (unique index, QA measured it live).
- **The worker code is bounded the way Phase 1 asked.** Eight unambiguous characters stored AES-GCM-encrypted (so the chair can re-read it), never in a URL; the cookie is `HttpOnly`, `SameSite=Lax`, 72 hours absolute, `__Host-` and `Secure` in production, and **re-checked against the session row on every request**, so pause, rotate and close took effect on the very next request in QA's measurement (0 requests served after each). Wrong, rotated, paused, closed, draft and unknown-slug codes return a byte-identical body; only a block adds "Wait a few minutes."; a signed-in phone is never throttled, and the first block came on the 6th attempt from one address. An admin holding the key bypasses the code and the pause and is recorded as `device_id = 'admin'`.
- **What a leaked code can and cannot do matches Phase 1.** It reads a roster with no parent email, mobile, Zeffy id or note; it can tag, photograph, advance and hand over; it cannot revert on a real session, see another session (0 of 10 cross-session probes succeeded), read the code, import, publish or reach `/admin`. The parent's name leaves the server only in the tag card (the worker needs it to write the cardboard tag) and the `pickup-name` response; search matches parent names but never returns them. QA crawled every crew response for sentinel contact strings: 0 occurrences.
- **The pickup split (R2) makes the history say what Phase 1 wanted, as far as a code-gated app can.** The history now holds `name_shown`, then `pickup_check` (`matched` or `someone_else: <note>`), then the transition, in that order, and a revert resets all three. The server cannot know a human compared names; it can know the name was on screen first and that a person then chose. QA counted pickups lacking the pair: 0 of 2 (and 0 branch-wide with no `name_shown`).
- **Failure never names the storage service and never strands the line.** A grep of the crew components, page and server helpers for "Drive" finds nothing in worker copy; the storage-down codes (unavailable, misconfigured, full) all read "Photos can't be saved right now. They're kept on this phone. Tell the chair." and a busy store reads "Photo saving is busy. Your photos are kept on this phone and will go in a moment."; the header shows "N photos waiting to send" with the plain warning "Photos not sent yet exist only on this phone. Don't clear this browser's data until this says none are waiting."; "Check in without a photo" stays available; tagging, search and pickup are database-only and keep working. QA stopped the server mid-upload: nothing was marked done, then the photo sent itself on restart with no duplicate.
- **The N4 hard conditions from my Slice 1 verdict are all present:** manual add (reason required, 3 to 500 characters, a `manual_add` history row, the order flagged as added by hand, contact optional), refund Keep and Withdraw (each behind a ConfirmDialog; Withdraw leaves any stuffy already in custody flagged), per-stuffy attention dismissal, status buttons (Draft, Active, Closed, plus the crew pause), the worker-code card (show, copy, "Copy message for the crew", rotate with a `devices_active` repeat, pause, resume), and Test storage and Check storage. The overview checklist rows for storage and the worker code are now real.
- **Practice versus real behaves as DECISION-125 item 4 says, as far as Slice 2 reaches.** `kind` stays immutable; the crew app shows "PRACTICE RUN: NOTHING HERE IS REAL" on a practice session; a crew revert on a real session answers `practice_only` for any credential; activating a **real** session requires a passing storage test in the last 10 minutes and fails closed, loudly; a practice session needs none.
- **Built to fail closed in production.** The factory selects Drive in production and hard-fails (never a silent local or memory fallback); outside production Drive is opt-in; Drive files are never shared (no permission, web-link or file id in any response, scan-tested); there is one photo door and it answers 404 to every failure, including a superseded portrait, a check-in thumbnail and a malformed id. The camera is granted only on `/santas-workshop/crew/*` (`camera=(self)`); every other path, the token paths and the API keep `camera=()`, measured on a production build.

## Intent-vs-Shipped Diff

Phase 1, Phase 1 addendum and spec §4:

- **Tag from the roster with a sticker scan.** Phase 1 said scan in the page with a typed fallback, last four shown, rebind with a dialog. Shipped: scanner with an always-visible typed field and "Scan from a photo", the confirm card, "Change sticker" on tagged stuffies (R1 fix: it works from a crew phone with `expectedLast4`). Verdict: **matches.** Live-camera decode of the real stickers is **unmeasured** (S3).
- **Check-in = scan + first photo, snack choice shown, check-in without a photo.** Shipped as above; the "without a photo" check-in is recorded in the history note and reachable. **Phase 1 also asked that it be "flagged and listed for the admin."** Nothing lists it: there is no admin flag, filter or count for a stuffy checked in with no photo (the registrants table shows state and consent only). Verdict: **acceptable drift for the dry run, a gap for the weekend** (S2-N2).
- **Portrait = scan + one photo, retake replaces, the card shows the check-in photo so the worker can confirm the stuffy.** Retake replaces, verified. **The card does not show the check-in photo.** `CrewPortraitCard` and `CrewPickupCard` both carry `checkInPhotoId`, the photo door serves a check-in full-size image to the crew, and no component reads the field (the portrait and pickup panels show only the *portrait* thumbnail). Phase 1's retention table also says check-in photos are "shown to workers at the portrait and pickup stations", and their stated purpose is a condition record for the loss-or-damage acknowledgment. As built, the first photo is write-only: no worker, and no admin page (Slice 3's photos page lists portraits and group photos), can look at it. Verdict: **regression against intent** (S2-N1).
- **Group photos unlinked and unpublished.** Matches (no stuffy, no state, unpublished; the capture screen carries "Stuffies only, never the children."). The upload rate (12 a minute per device), per-kind byte caps and the soft session quota are in place.
- **Pickup = scan or search, name shown, then a human choice, then hand-over.** Matches, improved by R2 (see above). Phase 1's wording ("Confirm name" before the reveal) was self-contradictory; the Phase 3 addendum's order (the worker asks the person first, the app then shows the name, then records the choice) is what shipped. Verdict: **acceptable drift (better).** Hand-over is never blocked by a missing portrait, a refund flag or storage (verified: pickup with no portrait succeeded).
- **The worker never sees contact data.** Matches (QA's 0 of every response). The tag card does show the family name, by design.
- **Outbox and the "unsent photos exist only on this phone" warning.** Matches, including the "this browser can't keep photos if the page is closed" variant when IndexedDB is unavailable, per-photo Retry and Discard (Discard behind a ConfirmDialog), and a hold when the code must be re-entered. One edge to name for the chair: closing the session (or the Eastern closing date passing) locks phones out, and a photo still waiting on a phone cannot then be sent (S2-N7).
- **Storage failures never name Drive.** Matches in worker copy. The admin side names the cause on a red banner and in the storage card, as Phase 1 allowed.
- **Throttle, pause, rotate, admin bypass.** Matches and measured (L1, L2). The IP key reads the first `x-forwarded-for` hop; whether Vercel overwrites a client-supplied header is **unmeasured**, and the per-session cap (30 in 10 minutes) bounds the damage if it does not (deploy step 8).
- **Manual add (required fallback).** Present. Phase 1 listed snack as required because the check-in card shows it; shipped as optional (only parent name, stuffy, window and reason are required). Verdict: **acceptable drift**; a manual stuffy with no snack shows no snack line, so the chair must type it (S2-N4).
- **Refund Keep/Withdraw, dismissal, status, worker-code card, Test storage.** Present and gated by `santas_workshop.manage`; verified by QA through the real UI.
- **Practice-only revert, and real-session admin revert with a reason.** The practice half matches. The admin API (`POST stuffies/[id]/revert`) accepts a revert on **any** session kind with a required reason, as Phase 1 P13 and Phase 3 ruling 17 say, but **the admin UI offers the button only on practice sessions** ("Go back a step (practice)"). On the real weekend, a wrong stuffy checked in or a portrait taken on the wrong card has no screen to correct it. Verdict: **gap** (S2-N3).
- **No dead end on a missing family.** Phase 1: a search miss reads "Not on the list. Ask the chair." Shipped: "No stuffy matches that. Check the spelling, or pick a different step above." Verdict: **acceptable drift** (S2-N4, one line).
- **Family QR (R3).** The pickup success screen draws a QR for `/santas-workshop/f/<token>`, a 404 until Slice 5. **Accepted for the dry run, as decided.** The Dec 14 rule stands (S2-N5): the field is a required `string` today, so the fallback is a contract change, not a UI toggle.
- **A refunded stuffy.** Matches the addendum (grey badge, Continue dialog at check-in, hand-over never blocked, refunded rows sort last).
- **Registration list freshness.** Matches the addendum: refresh on focus, a 20-second poll, "Updated just now" and a Refresh button.

Phase 3 rulings touching Slice 2:

| # | Ruling | Verdict |
|---|---|---|
| 2 | Worker code encrypted (AES-GCM, key derived from `AUTH_SECRET`), not hashed | accept; rotating `AUTH_SECRET` makes the stored code unreadable and signs out every phone (the card then says regenerate): put in the deploy checklist |
| 12 | Photos by `<input capture>`, `getUserMedia` only for scanning, view state in `sessionStorage`, "Scan from a photo" | accept; **unmeasured on iOS Safari** (S3) |
| 13 | Drive is opt-in outside production | accept (verified in the factory) |
| 14 | One env var for the service account | accept |
| 15 | No migration after the front-loaded pair | accept (none in this diff) |
| 17 | Crew revert on practice only | accept, with S2-N3 for the admin half |
| 19 | Parent name never leaves except the tag card and the pickup path; pickup refused until a check exists | accept; strengthened by R2 |
| 1, 8 to 11 | frames, hidden-portrait rule, token pages, caption, numbering | not in Slice 2 |

Phase 4 deviations and fixes: **api-developer** 1 to 9 accepted (storage test logged against a session, status limited to draft/active/closed with the crew pause, Refund `withdraw`, Check storage as one pass, the CSV, `photo-access.ts` carrying the whole viewer matrix now, header rules added early, crew revert refused on real sessions for any credential, plain sentences for new error codes). **ux-developer** 1 to 3 accepted (full-screen fixed layer, portrait id taken from the pickup card, e2e advance after a no-photo check-in). **R1** (re-tag with `expectedLast4`, "Change sticker" on tagged stuffies only) and **R2** (reveal split from check) accepted. **R3** accepted with the Dec 14 date. **QA fixes** D1 (Turbopack tracing: `/*turbopackIgnore*/` on the local adapter, the five photo routes fell from about 1,800 files to about 170), D2 (a phone-shaped test string), D3 (`router.refresh()` after Test storage) verified fixed. The Slice 2 api-developer note that the e2e helpers leave an empty per-session folder in the local store is cosmetic.

## What the chair sees at the dry run

**On the admin page (laptop or phone):** the session card with Practice and Active badges and a status block with Close session and Back to draft; a "Worker access" card showing the code in big groups (`ABCD-EF23`), Show, Copy code, "Copy message for the crew" (a ready text naming the `/santas-workshop/crew/<slug>` address and keeping the code out of the link), Rotate, Pause; a go-live checklist that now names storage ("Run Test storage before the first photo is taken") and the worker code, with the storage card saying a practice session does not need a passing test; counts by stage and window; a "Waiting for pickup" card with the CSV; a "Photo storage" card with Test storage and Check storage and an amber or red banner when something is wrong. On the registrants list: per-row Dismiss flag, Refund keep or withdraw, Withdraw, "Go back a step (practice)" and an "Add registrant" form.

**On a volunteer's phone:** a code screen; a header with the session name, "Updated just now" and Refresh; the PRACTICE band; a find-a-stuffy box and step filters; one card per stuffy; a bottom bar of Stuffies, Scan and Group photo; a "photos waiting" strip that appears only when something is queued.

**What the chair cannot do yet, and will notice:** look at any photo (the check-in photo has no screen at all, the portrait is visible only on the portrait and pickup cards), see which check-ins had no photo, reset a practice session to run the drill again (create a new practice session instead; Slice 5), or correct a mistake on a real session from the admin page (S2-N3). Collage, frames and the family page are later slices.

## Edge Cases

- Empty state: **pass** ("No stuffies are registered yet. When families sign up they appear here by themselves."; the admin lists and cards have sentences; the outbox strip is absent when nothing waits).
- Failure microcopy: **pass.** One plain sentence for every crew error code, enforced by an exhaustive switch and a test; no status number, stack trace or storage-service name reaches a worker; the code screen answers every failure identically. Minor: a missing-family search reads "No stuffy matches that" (S2-N4).
- Permission gate: **pass.** 13 crew routes call `requireCrew()` first (the only exception, `enter`, is asserted by a scan test); all admin routes call `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)`; the photo door resolves a credential then answers 404 on any failure; no new permission; a crew cookie never populates `session.user` and is 401 on an admin route.
- Mobile (360 px): **pass.** QA measured `scrollWidth == clientWidth == 360` on the roster, tag, scan, group, check-in and pickup screens, text inputs at 16 px or larger and buttons at 44 px or more; I confirmed the same on screen. A real phone is deferred.
- Hostile text and abuse: **pass.** A stuffy named `<script>…` and an `<img onerror>` description render as text in the admin list and the crew app; a 3 MB body is 413, a PNG as the photo is 415, garbage meta is 400, none leaves a row or a state change.
- Brand and dialogs: **pass.** `ConfirmDialog` for unbind, replace, retake, discard, check-in without a photo, rotate, Keep and Withdraw; no native dialog; chips and the checklist marks are the only `rounded-full` items.
- Build and dependencies: **pass.** `pnpm build:only` is warning-free after D1; three added packages, nothing else in `package.json`.
- Secrets: **pass.** No key in any new file; the service-account JSON is read only in `photo-store/config.ts` (scan-tested) and never logged.

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log entry. Numbered S2-N so they do not collide with Slice 1's N1 to N10. **S2-N1 gates the dry run; S2-N3 gates Dec 17; S2-N5 is dated Dec 14.**

**S2-N1 — Show the check-in photo to the people who need it (gate for the dry run; small, ux-developer).**
Proposed backlog text: *B-nnn The check-in photo is stored and never shown. `CrewPortraitCard.checkInPhotoId` and `CrewPickupCard.checkInPhotoId` are populated and the photo door already serves a check-in full-size image to the crew, but `portrait-panel.tsx` and `pickup-panel.tsx` render only the portrait. Show the check-in photo (full size, tap to enlarge) on the portrait card ("Is this the stuffy in front of you?") and on the pickup card, with a plain "No check-in photo was taken" line when a stuffy was checked in without one; show it on the admin registrant row as well so the chair can answer a damage question on Dec 20. Test: a pickup card for a stuffy with a check-in photo renders an image whose source is the photo door; one without renders the sentence. Check-in photos stay out of the zip, the collage and the family page.*

**S2-N2 — List check-ins that have no photo for the admin (before the dry run; small, api + ux).**
Proposed backlog text: *B-nnn "Check in without a photo" is allowed and recorded only as a history note (`without_photo`); nothing lists it. Add a derived "No check-in photo" flag and filter to the registrants page and a count on the overview ("N checked in without a photo"), and the same count in the awaiting-pickup CSV. Phase 1 gap 14 asked for it to be listed.*

**S2-N3 — Admin revert on a real session (before Dec 17; small, ux-developer).**
Proposed backlog text: *B-nnn The admin revert route accepts any session kind with a required reason, but `registrantActions()` offers it only when `sessionKind === "practice"`. Offer "Go back a step" on real sessions through the existing reason dialog (the copy should say the reason is kept in the history and that going back to Registered frees the sticker), and keep "(practice)" off the label. This is the only way to fix a wrong scan on the real weekend. Test: `registrantActions` returns `revert` for a real session; the dialog posts the reason; a crew phone still gets `practice_only`.*

**S2-N4 — Copy gaps from Phase 1 (small).**
Proposed backlog text: *B-nnn (a) A roster search with no match should end "Not signed up yet? Ask the event chair." (Phase 1: no search-miss dead end; a family added by hand appears on the next refresh). (b) A manual registrant with no snack should show "No snack recorded. Ask the family." on the check-in card, or the manual-add form should require it as Phase 1 did. (c) The overview "Waiting for pickup" card counts only checked-in and portrait-done stuffies while its CSV lists every stuffy not yet picked up; label the card "Checked in, not yet handed back" or add the CSV's State column to the card's description (QA observation 3).*

**S2-N5 — Family QR: a dated decision (Dec 14).**
Proposed backlog text: *B-167 Slice 5 stays on the must-ship list for Dec 20. Decision on Dec 14: if the family page has not landed and passed QA, `PickupResponse.familyUrl` becomes `string | null`, the pickup route returns `null`, `pickup-panel.tsx` hides the QR and the carrier tests are updated (about 5 lines, but a contract change: the field is a required string today). Add "family QR resolves, or is hidden by decision" to the dry-run checklist.*

**S2-N6 — Measurements that gate the dry run, not code.**
Proposed backlog text: *B-167 S1 and S3 close-out before Dec 7: (a) `scripts/spike-drive.ts --apply` against the real service account and shared drive, recording the lazy `googleapis` import time, 1 MB upload and download latency, whether a permanent delete is allowed under the chosen shared-drive role (SW-L10) and what the Test storage ping reports on the deployed host; (b) a real iPhone and a real Android phone: the camera prompt on the crew path, decode of three real stickers (they must differ), whether the stickers encode a vendor URL, `<input capture>` return and reload in iOS Safari, a low-light portrait, and the IndexedDB outbox surviving an airplane-mode toggle mid-upload and a closed tab; (c) deliberately break the folder id (or remove the service account from the drive) and watch the outbox hold, the red banner appear and the photos drain after the repair, with zero duplicate Drive files (SW-L12). Until (a) is recorded DECISION-122 stays Proposed.*

**S2-N7 — Do not strand photos when closing (low).**
Proposed backlog text: *B-nnn Closing a session, or the Eastern closing date passing, signs phones out, and photos still waiting on a phone cannot then be sent. Make Close session warn with the same `devices_active` count the rotate dialog uses ("N phones used the code in the last hour; photos still waiting on them cannot be sent after closing"), and put "no phone says photos are waiting" on the dry-run and Sunday checklists.*

**S2-N8 — Housekeeping (low).**
Proposed backlog text: *B-nnn (a) Test fixtures in `drive.test.ts` contain the strings `-----BEGIN PRIVATE KEY-----` and `private_key`; assemble them in code so a repository secret scanner cannot flag the file. (b) The crew card is requested twice per open on the dev server (probably React Strict Mode); measure on the production build. (c) The Next.js dev badge overlaps the bottom tab bar in development only. (d) The crew spec helper leaves an empty per-session folder in the local store. (e) An unmeasured assumption: the throttle trusts the first `x-forwarded-for` hop; confirm on the deployed host that Vercel overwrites a client-supplied value (deploy step 8).*

**Decision records (for the orchestrator or tech-lead; I did not edit `docs/decisions.md`).**
- **DECISION-121:** items 1 to 5, 7 and 8 hold against QA's Established list; promote once S2-N6(b) (iOS capture) is recorded, or promote now and leave that single line in "Unmeasured". Item 6 and its residual must change wording: "the `pickup-check` response" becomes "the `pickup-name` response"; "`pickup` is refused until a `pickup-check` event exists" becomes "`pickup-check` is refused until a `name_shown` event exists, and `pickup` until a `pickup-check` event exists, each newer than the stuffy's last revert"; the QA check becomes "pickups lacking a `name_shown` then `pickup_check` pair (expect 0; measured 0 of 2)". The throttle numbers are measured (first block at the 6th attempt; the session cap blocked after about 31 failures against the design's 30).
- **DECISION-122:** keep **Proposed**. The local adapter and the contract suite are measured; the Drive adapter has only run against a fake client, and the role that permits permanent delete, the cold start and the latency are all still believed, not measured (S2-N6).
- **DECISION-125:** keep Proposed. Item 4 is half delivered (immutable kind, practice-only crew revert, real-session activation gate); practice reset and the retention engine are Slice 5.

## Deploy checklist for Slice 2 (in order)

1. **Google side first (the user, with a Workspace admin).** In the club's Google Cloud project create a service account and a key (an organisation policy can forbid key creation; the user already answered yes, S1 re-proves it). Create a **private shared drive** and add the service account as a member with a role that permits a permanent delete (Content manager is believed to; Contributor is believed not to; unmeasured). Keep membership to the service account and one or two admins: anyone in the drive can open every file, check-in photos included. Do not enable "anyone with the link" anywhere. Optionally make a folder in the drive for the app and note its id.
2. **Prove it from your own laptop before production.** In your own `.env.local` set `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (the key minified with `jq -c . key.json`, single-quoted), `GOOGLE_DRIVE_SHARED_DRIVE_ID` and, if used, `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID`. Run `scripts/spike-drive.ts` (a dry run that prints booleans only), then `--apply`. Record the import time, upload and download latency, and whether the permanent delete worked under the role (SW-L10). If the service account cannot join the drive or cannot delete, stop: the fallback is the dedicated-user token behind `getDriveAuth()`, a change before anything else ships. Never paste the key into a work-log or chat.
3. **Vercel production environment:** `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (one line), `GOOGLE_DRIVE_SHARED_DRIVE_ID`, and `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` if used. Do **not** set `SW_PHOTO_STORE` or `SW_LOCAL_STORE_DIR` in production (ignored there; production always selects Drive and hard-fails without it). Confirm `AUTH_SECRET` (or `NEXTAUTH_SECRET`) is set and decide now that it will **not** be rotated before Dec 20: it derives the cookie key and the worker-code encryption key, so a rotation signs out every phone and makes the stored code unreadable (the worker-access card then says to regenerate it).
4. **Combine and push.** Reconcile this work-log with the main copy by hand; `/pre-push` on the combined tree (typecheck, tests, build, the PII grep); release notes and the version bump are the orchestrator's. Slice 2 adds no migration and three dependencies (`jsqr`, `qrcode`, `@types/qrcode`); read the deploy log for the lockfile install and a warning-free build.
5. **Check the header on the deployed host:** `curl -I` of `/santas-workshop/crew/anything` must show `camera=(self)`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`; `/santas-workshop`, `/santas-workshop/c/x`, `/santas-workshop/f/x` and `/api/santas-workshop/photos/x` must show `camera=()`. Vercel is a different host from the `next start` QA measured, so this is the one measurement that counts for the camera.
6. **Practice session in production.** Create a practice session, press **Test storage** on the card (it writes, reads and deletes a small object in the real shared drive; expect a pass with a latency), Activate, read the code, enter it on a phone, tag, check in and take a portrait with a real photo, and confirm the files appear in the shared drive and nowhere else; Check storage reports 0 orphans and 0 missing. Rotate and Pause once, with a phone signed in, and see it signed out on its next tap.
7. **Failure drill (once, on a practice session).** Remove the service account from the drive (or set a wrong folder id) and take a check-in photo: the phone must say "1 photo waiting to send" and the storage sentence, the admin page must show the red banner, "Check in without a photo" must work; restore, and the photo must drain by itself with no duplicate file in the drive (SW-L12).
8. **Throttle on the real edge.** From one real address make six wrong code attempts and confirm the sixth is blocked with "Wait a few minutes"; then repeat sending a made-up `x-forwarded-for` header and confirm it does not reset the count (if it does, the first hop is spoofable; the per-session cap still bounds it, but record it).
9. **Real-phone pass with the chair's stickers (S3).** One iPhone and one Android: the camera permission prompt, three stickers that decode to three different codes (note whether they are vendor URLs, in which case the phone's own camera app must not be used), `<input capture>` return and page state in iOS Safari, a low-light portrait, a retake, airplane mode mid-upload then close and reopen the tab.
10. **Fix S2-N1 and S2-N2 and re-verify before the dry run; S2-N3 before Dec 17; decide S2-N5 on Dec 14.**
11. **Dry-run checklist (the week of Dec 7, its own practice session, volunteers' own stuffies):** the real stickers (Q14b); iPhone and Android; the real IHOP signal (airplane toggles during photos); a low-light portrait; a retake; a refund after tagging (a real $ test purchase refunded in Zeffy, the badge and the Continue dialog); a late registrant added by hand (it appears on the next refresh); a pickup by someone other than the named parent (note recorded); pause and resume; rotate with phones active; the storage failure drill; Test and Check storage; time ten real check-ins at the table and a burst of group photos for throughput; count pickups lacking the `name_shown` then `pickup_check` pair (expect 0); crawl the crew screens for any parent email or mobile (expect none); the family QR resolves, or is hidden by decision.
12. **Dec 17 evening, the real session:** create the real session (the button says "Create real session"), press Test storage, then Activate **within ten minutes**, text the worker message, and confirm the worker count shows phones active.

## Release-notes paragraph (no version number, no file list)

Volunteers can now run Santa's Workshop from their phones. They open a private page, type the shared event code (no club login needed), and work down the list of registered stuffies: tag one by scanning its sticker, check it in with a first photo while the snack choice and care note are on screen, take its one portrait with Santa and Mrs. Claus (and retake it if it isn't right), snap group photos, and hand the stuffy back after seeing the name on the order and confirming who is collecting. If the signal drops or photo storage has a problem, photos wait safely on the phone and send themselves later, and nothing stops the line. Admins can open and close a session, share or change the event code, pause volunteer access, add a family by hand with a reason, handle refunds, test photo storage and run a practice session first. Volunteers never see families' email addresses or phone numbers.

## CLAUDE.md edits for the orchestrator

1. **Environment Variables** (after the Zeffy entries):
   - `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` - the Santa's Workshop photo store's service-account key file minified to one line (`jq -c . key.json`). Read only by `src/lib/santas-workshop/photo-store/config.ts`. Production hard-fails without it; never logged, never in a work-log.
   - `GOOGLE_DRIVE_SHARED_DRIVE_ID` - the private shared drive the service account is a member of.
   - `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` - optional folder inside that drive (default: the drive root).
   - `SW_PHOTO_STORE` - development only: `drive` opts a non-production process into Drive; anything else uses the local store (`.santas-workshop-store/`, gitignored). Ignored in production, where Drive is mandatory (an `.env.local` has carried production credentials before, so a key's presence never selects Drive in development).
   - `SW_LOCAL_STORE_DIR` - development only: where the local adapter writes (default `.santas-workshop-store`).
   - Amend the `AUTH_SECRET` / `NEXTAUTH_SECRET` entry: "also derives the Santa's Workshop crew-cookie key, the worker-code encryption key and the IP-hash key (HKDF, distinct from NextAuth's); rotating it signs out every worker phone and makes every stored worker code unreadable, so the admin must regenerate it."
2. **Project Structure:** under `santas-workshop/` add `crew/[slug]/  # worker app: code screen or CrewApp, noindex layout`; under `api/` add `santas-workshop/crew/[slug]/  # 13 worker routes, each calls requireCrew() first (enter excepted)` and `santas-workshop/photos/[id]/  # the one photo door`; under `lib/` extend `santas-workshop/` with `photo-store/ (memory, local, Drive adapters behind PhotoStore)`; under `components/` add `santas-workshop/crew/  # worker app and phone outbox`.
3. **Key Features -> Santa's Workshop** (extend the Slice 1 bullet, or add one): "**Worker (crew) surface (v1.95, B-167 Slice 2, DECISION-121/122):** `/santas-workshop/crew/<slug>` is code-gated, not permission-gated. A volunteer enters a shared per-session code (8 unambiguous characters, stored AES-GCM-encrypted so an admin can re-read it, never in a URL) and receives a signed `HttpOnly` cookie bound to session id, code version, a random device id and 72 hours; `requireCrew()` re-checks the session row on **every** request (active, not paused, code version, Eastern closing date), so pause, rotate and close take effect on the next request. A holder of `santas_workshop.manage` bypasses the code in the same helper. Entry is throttled in `sw_crew_attempts` (per IP-hash 5 failures in 10 minutes, per session 30); a signed-in phone is never throttled; every denial is one identical 401. Crew DTOs carry no parent email, mobile, Zeffy id or note (source-scanned); the parent's name leaves the server only in the tag card and the `pickup-name` response, and the history must hold `name_shown`, then `pickup_check`, then the pickup transition, each newer than the last revert. Every write is pinned to the expected state under `FOR UPDATE` with a rollback sentinel on zero rows; a crew revert exists on practice sessions only. **Photo store:** bytes live in a private Google shared drive reached by a service account behind `PhotoStore` (Drive in production or a hard failure, local in development, memory in tests); `sw_photos` holds metadata and opaque keys; files are never shared and every read goes through `photo-access.ts`, the one photo door, which answers 404 to every failure. Uploads are one multipart request of about 1 MB after the browser downscales; a photo that cannot be sent waits in an IndexedDB outbox on the phone. A REAL session can be activated only after a passing storage test in the last 10 minutes. **Camera:** `Permissions-Policy: camera=(self)` is set only on `/santas-workshop/crew/:path*` (both policy strings come from one function in `next.config.ts`, the crew rule after the global rule); every other path keeps `camera=()`."
4. **Gotchas:** add "The crew cookie is not a NextAuth session and never populates `session.user`." and "A photo that has not sent exists only on the volunteer's phone; closing a session signs phones out, so check that none say photos are waiting first."
5. **Key Invariants:** add "**One photo door.** Only `photo-access.ts` reads photo bytes; routes resolve a credential and every failure is 404. No `permissions.*`, web link or Drive file id anywhere in `src/` (scan-tested)." and "**A crew response never carries contact data** (`crew-contract-no-contact.test.ts`)."
6. **Dependencies line / Technology Stack:** note the three new packages `jsqr`, `qrcode`, `@types/qrcode` (`fflate` arrives with frame export).

### Phase 6 handoff (Slice 2)

**Owner:** analyst
**Status:** complete (Slice 2 only; Phase 6 stays open for Slices 3 to 5)

### Summary
SHIP WITH NOTES for Slice 2. The worker process, the sticker collision rules, the shared code with its throttle, pause, rotate and admin bypass, the no-contact-data rule, the outbox and the storage-failure copy all match Phase 1 and held in QA's measurements and in my own run on a phone-sized screen. One intent miss, the check-in photo that is stored but never shown (S2-N1), gates the dry run; the admin revert for real sessions (S2-N3) gates Dec 17; the family-QR decision is dated Dec 14.

### What I did
- Read the whole work-log and DECISION-121/122/125, then the shipped crew, photo, transition, status, storage and admin code; re-ran 104 test files (1,652 tests) and a PII/key grep.
- Drove the real app on `:3101` (local store, no Zeffy, no Drive): code entry, roster, tag, check-in card, queued photo, portrait card, pickup reveal at 360 px; cleaned the branch back to zero workshop rows and stopped the server by PID.
- Found S2-N1 (check-in photo never rendered), S2-N2 (no admin list of photo-less check-ins), S2-N3 (admin revert hidden on real sessions) by reading each Phase 1 flow against the cards and `registrantActions()`.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` in the pipeline worktree and its Per-Phase Status row. No code, `CLAUDE.md`, `decisions.md` or `backlog.md` touched; nothing committed. Scratch screenshots and scripts are in the session scratchpad only.

### Open questions / handoff notes
- Orchestrator: file S2-N1 to S2-N8 (proposed text above); S2-N1 and S2-N2 are one small ux + api pass and should land before the dry run; apply the CLAUDE.md edits and the DECISION-121 wording change when Slice 2 ships; keep DECISION-122 Proposed until the Drive spike is recorded; set the Dec 14 reminder (family QR).
- User and chair: create the Google service account and private shared drive and run the spike (deploy steps 1 and 2); bring the stickers and an iPhone and an Android phone to the real-phone pass; confirm the AUTH_SECRET will not be rotated before Dec 20.
- If S2-N1 is judged a hard regression rather than a gated note, the loop-back is Phase 4 (ux-developer, about 20 lines, no schema, no new route); I rated it a note because the data is intact, the route and DTO field exist, and no real session can run before the dry run.


---

## Phase 6 — Slice 3 — 2026-10-13

**Scope judged:** the public collage page `/santas-workshop/c/[token]`, the photo door's anonymous viewer, the admin photos page (`/admin/santas-workshop/[sessionId]/photos`), hide/unhide, the group-photo review and the publish/unpublish gate, the collage link and QR. **Out of scope, not gaps:** frames and the frame QR's origin guard (Slice 4), the family page and the real public purge engine (Slice 5).

**Tree state measured:** worktree on main `dc3c67e` (v1.95.0) plus the uncommitted Slice 3 diff (32 `git status` entries; no migration, no dependency, no env var). Method: the whole work-log in the order the coordinator listed (my Phase 1 and addendum, my Slice 1 and 2 notes that touched the collage, Phase 3's collage sections and Flow 9, both Phase 4 sections including S3-D1, QA's FAIL then PASS), DECISION-125, spec §3.5, §5, §7 and Q17, then the shipped code (`collage-contract`, `collage-queries`, `photo-admin`, `photo-access`, the collage page and gallery, `collage-ui` copy, `photos-panel`). I re-ran no test suite (QA's 4,831 tests and 12 collage e2e tests stand), and drove the real app myself on `:3101` (branch database, local photo store in the scratchpad, `NEXTAUTH_URL` set to the server's own origin, `ZEFFY_API_KEY` forced empty, no Sync): a practice session with two registered stuffies (one family agreed to photo sharing, one did not), both taken through tag, check-in and portrait, two group photos, then the pending page, a refused publish, review, publish, the live page at 360 px, a hide, and a retake after publish, plus the admin photos page at 390 px and a print to PDF. I stopped the server by PID, deleted the session and re-measured the branch at 0 sessions, orders, stuffies and photos, `email_queue` 1362. Everything that depends on the real Drive (the placeholder tile on an outage, the 5-minute window against Drive) or a real phone is unmeasured.

## VERDICT

**SHIP WITH NOTES.** The collage does what Phase 1 and Phase 3 describe: strangers see only group pictures an admin reviewed and the portraits of stuffies whose family agreed, nothing carries a name, a hide takes effect at the door at once, and the page is honest in all three of its states. The review gate is a real server-side gate, not a formality, but it is a tripwire and not a proof that anyone looked; and I found three places where the shipped behaviour or wording does not match what the chair will believe on photo-day evening. None is a defect in the build; two need a chair or orchestrator decision before the dry run (S3-N1, S3-N2).

## ONE-LINE TAKE

> Scan the frame's QR and you get a calm, nameless, unlisted page of group pictures and the portraits of families who said yes, which an admin can hide from at any moment and must explicitly release (group pictures only) before anyone outside can see it; the weak spots are portraits, which go public the instant they exist, and the words telling the admin what to look for.

## What's Working

- **One visibility rule, used by the door and the page.** `decidePhotoAccess({ kind: "public" })` decides both what the collage lists and what the photo door will serve a stranger, and `photoFactsFrom()` is the single row-to-facts mapper (the admin's "Visible to anyone with the link" chip uses it too). QA's `collage-door` test proves the two sets are equal; in my run the page listed exactly two group pictures and one portrait and the admin page showed the same one portrait chip as visible.
- **Consent governs portraits exactly as Phase 1 and the spec (Q17) say.** The family that agreed (Alpha) is on the collage; the family that did not (Bravo) is not on the page and its portrait answers 404 at the door; group pictures are public once released. The admin page labels each portrait in plain words ("On the collage: family agreed" or "Not on the collage: no consent") and counts them ("Portraits on the collage 1", "No consent 1, kept off the collage").
- **No names anywhere a stranger can read.** The public DTO is a photo id and a kind (scan-tested: no name, caption, family, count or storage key); alt text is ordinal ("Group picture 1", "Stuffy portrait 1"); the page title and every line of copy are fixed strings (a hostile session name never reached the page in QA's test, and the script in it did not run); the door's response headers carry no file name, key or token. QA found no registrant text in the HTML or the RSC flight data. A child's first name, which the form may collect, has no path to this page.
- **A real gate, enforced on the server.** Publish is refused with a sentence and a count until every unhidden group photo has been covered by an explicit review (my run: "2 group photos have not been reviewed yet", 409). The review covers only photos uploaded up to the newest one the admin was looking at, so a photo that arrives later is not released by an earlier click: QA verified a late photo is 404 at the door and "Publish late photos" is refused until it is reviewed too. The S3-D1 fix compares the cutoff entirely in SQL, so a Postgres microsecond timestamp can no longer make the newest photo permanently unreviewable (QA re-ran it with real uploads: review once, publish, late photo, review, publish late photos).
- **Hide is immediate where it can be.** My run: hide, then a stranger's door fetch is 404 at once; the page is `force-dynamic` so a reload no longer lists it; only a browser that already has the image may keep showing it for up to 5 minutes (`private, max-age=300`), as the user accepted and QA measured (L3).
- **The three states of the printed QR are friendly and honest.** Before publish: "The photos arrive on Saturday, Dec 19. Check back in the evening." (200, not a 404, because the QR is printed before the photos exist). Live: the grids. After a public purge: "These photos have been removed. The Westerville Lions Club has taken this collage down. Thank you for joining us." An unknown, malformed or hostile token is one identical 404 (9 bad tokens, 1 distinguishable response, a 10,000-character token in 34 ms; L4 measured).
- **A quiet, unlisted page.** `noindex, nofollow` in the meta and the header, `Referrer-Policy: no-referrer` (0 of 30 requests carried the token in a Referer on the production build), not in `sitemap.ts` or `robots.ts`, no site header, footer or navigation (only the club-name band), a PRACTICE banner on practice sessions, no download button, tap opens the full picture in a dialog, a quiet "Photo not available right now" tile if an image cannot be served, lazy thumbnails with fixed dimensions. 360 px has no sideways scroll (QA, and my own screenshot).
- **The admin page is usable on a phone and tells the truth.** Collage card with the link (Copy, Open), a QR that decodes to exactly the link, status chips, four counts, group and portrait grids with Hidden, Reviewed and consent chips, Hide behind a ConfirmDialog that states the 5-minute caveat, Unpublish behind a ConfirmDialog, a late-photo path ("Publish late photos"). The `photos_unreviewed` refusal and an unavailable "Mark reviewed" state both explain themselves.
- **Fail-safe by construction.** The review marker lives in the session log; if that log were ever pruned, photos would simply read as unreviewed (the safe direction). Photos keep a per-photo publish stamp that only reviewed photos receive.

## Intent-vs-Shipped Diff

- **Collage open to anyone with the link (Q17), unlisted.** Phase 1 said open, not indexed. Shipped: 128-bit token, noindex, no-referrer, no OG preview image, never in the sitemap. Verdict: **matches.** There is no token rotation (a printed frame cannot be re-issued); the only remedies for a link that travels are Unpublish (everyone) or Hide (per photo). That is the design's accepted shape and the chair should hear it plainly.
- **Consent governs portraits; group pictures show whoever is in them.** Matches the spec's Q17 wording. **But Phase 1 gap 9 resolved the tension with "stuffies only, never the children" by requiring review and a one-line worker reminder.** The wording that implements that resolution is inconsistent (S3-N1): the admin is told "Hide any that shows a person", the crew app asks the volunteers to photograph the stuffies "together with Santa and Mrs. Claus", the public page says "We photograph stuffies only, never children", and the spec says portraits are taken with Santa and Mrs. Claus. An admin who obeys the first instruction would hide every picture with Santa in it; one who does not has been given a rule they are expected to ignore. Verdict: **gap (copy and a chair ruling).** I did not catch the crew-side wording when I judged Slice 2; I should have.
- **Admin review before publish.** Phase 1: review group pictures, hide any, then publish. Shipped: an explicit "Mark group photos reviewed" action that the server requires before it will publish, re-required for every photo that arrives later. Verdict: **matches, with honest limits**, see "Is review a real gate?" below.
- **Hide at any time.** Matches (immediate at the door, up to 5 minutes in a browser that already has it, both accepted and measured). Unhide of a photo that was hidden **before** the first publish does not put it on the collage; it needs "Publish late photos", and nothing says so (S3-N3).
- **Removal contact line.** Phase 1 asked for "Want a photo removed? Email info@westervillelions.org". Shipped: "Changed your mind? Contact the club and we will take your stuffy down." with a link labelled "Contact the club" to `/connect` (a contact form and the club address further down the page). Verdict: **acceptable drift, narrower than intended** (S3-N4): the sentence is addressed to a family withdrawing consent for its own stuffy; it does not speak to a parent who spots a person in a group picture, and the address is two steps away.
- **Stuffies only, never children, never a child's name.** The sentence is on the page and no name can reach it. Matches.
- **Pending and removed as 200 states, unknown as 404.** Phase 3 wanted this; the brief's wording said 404. The design wins (the printed QR must not 404 before the photos exist). Verdict: **matches the design; accepted** (Phase 4 deviation 2).
- **Portraits follow consent and hide live, not the release batch.** Phase 3 ruled that the live collage is "published unhidden group photos, then current unhidden portraits whose stuffy has consent". Phase 1 Flow 9 pictured "one batch". Shipped as Phase 3: portraits have no release step and no review. **I measured the consequence:** after the collage was published, a retake of the consenting stuffy's portrait was served to a stranger at the door immediately (200), with no admin action and nothing on the admin page saying a new portrait had gone public. The pickup card has a "Retake the portrait" button, so retakes after publish are an ordinary flow on pickup day. Verdict: **design drift with a real consequence** (S3-N2).
- **Printable public page, reusable by the family page.** Print rules exist (`.sw-noprint`, a 3-column grid, no chrome). QA's PDF is two pages with every tile; two nits stand (S3-N6). Verdict: **acceptable drift.**
- **Zero photos, no consented portraits, practice collage.** See Edge Cases; all pass.

Phase 3 rulings touching Slice 3:

| # | Ruling | Verdict |
|---|---|---|
| 8 | A hidden portrait is withheld from every non-admin surface (family page, frame zip) | the collage and the door half is shipped and measured; the family and zip halves are Slices 4 and 5 |
| 9 | Collage and family tokens are not throttled; unknown and malformed tokens one identical 404 | accept; measured (L4: 9 bad tokens, one distinguishable response) |
| 10 | The frame caption is words, not the token URL | not Slice 3 |
| Collage section | `force-dynamic`, noindex, pending/removed 200, no names or counts per family, images `private, max-age=300` | accept; every point verified |
| Flow 9 | Review group pictures, publish in one batch, URL stable from session creation, "pending" before publish | accept, with S3-N2 on portraits |

Phase 4 deviations: **api-developer** 1 (the review marker as a session-log row, now the **id of the newest group photo seen**, compared in SQL) accepted: no schema, safe-fail direction, and S3-D1 proves it needed the SQL-only comparison; deviation 2 (pending/removed are 200) accepted; 3 (no JSON route) accepted; 4 (origin guard is Slice 4; the admin card shows the URL as built) accepted, with the deploy check below. **ux-developer** 1 (`force-dynamic` rather than a 5-minute `revalidate`) accepted; 2 (site chrome hidden with a scoped `<style>` on `body > header, body > footer`) accepted as a stopgap, but it is a selector coupled to the root layout (S3-N8); 3 (`object-contain`, no crop) accepted; 4 (Publish stays clickable while photos are unreviewed, the server's refusal is the authority) accepted; 5 (admin tile shows the stuffy's name on portraits) accepted (admin only). **QA findings:** S3-D1 fixed and re-verified with real uploads; repeated review writes extra audit rows (harmless noise); the empty e2e folders were cleaned by hand.

## Is "review before publish" a real gate or a formality?

Real, with these limits stated so the chair does not over-trust it:

- **It is a server gate.** The API refuses (409 `photos_unreviewed`, with a count) until every unhidden group photo is covered by a review; a photo uploaded after the review is not released and is 404 to strangers until it is reviewed and published late. QA and my run both saw this.
- **It cannot know that anyone looked.** One button marks every group photo up to the newest as reviewed. The grid loads 60 at a time; with the roughly 100 group pictures Phase 1 estimated, the button is available while page 2 has never been opened. Today the page tells the admin to "Look at each picture", which is guidance, not a check (S3-N3).
- **It covers group pictures only.** Portraits are not reviewed; they are public as soon as the collage is published if the family agreed, and any later portrait is public at once (S3-N2).
- **A hide is the real safety valve.** Because hide is immediate at the door, a mistake found after publish costs at most a 5-minute cache window.

## What a family sees

- **Before photo day, scanning the QR** (the QR is printed on frames, so this mostly means a tester or an early link): "The photos arrive on Saturday, Dec 19. Check back in the evening. The stuffy pictures will be right here.", the two fixed lines, no pictures, noindex. After that Saturday has passed and before the chair publishes (a Sunday-morning pickup is the realistic case) it still says "arrive on Saturday, Dec 19", a date in the past (S3-N5).
- **On the evening of photo day, once published:** "Group pictures" in capture order, then "Stuffy portraits", ordinal alt text, no captions. A family that did not agree to sharing will not find its own stuffy here and nothing explains why; its portrait is for the frame and, in Slice 5, its family page (S3-N4).
- **In February after the public purge date:** the page is "removed" **only if the Slice 5 purge has been run**. Nothing expires a collage by itself (there is no cron, as the design says); until the admin runs the purge, the collage stays live past January 31. Once the purge sets the marker the page shows the friendly "These photos have been removed". The photo door does not itself read the session's purge marker; it relies on each photo's own purged stamp, so the Slice 5 engine must delete the bytes and stamp every photo, not just the session (QA observation 5).

## Edge Cases

- Empty state: **pass.** A live collage with no tiles says "No photos have been added yet. Please check back soon."; the admin photos page has empty-state sentences; "Mark reviewed" explains why it is unavailable ("There are no group photos to review yet."). Publishing an empty collage is allowed (design); it reads as live.
- A session with zero consented portraits: **pass.** Only the group grid renders (no empty "Stuffy portraits" heading); the admin sees "Portraits on the collage 0, No consent N". Note the cross-slice dependency: the consent answer text is still the unmeasured N5 item from Slice 1, and an unrecognised answer fails safe to "no" (a collage with no portraits, never one with the wrong ones).
- The collage of a practice session: **pass.** Same token form and the same page with a PRACTICE banner; still noindex. A practice collage URL is as public as a real one, so practice photos should be sample photos.
- A token shared on social media: **works as designed, no revocation.** Anyone with the link can open it; the page is noindex with no preview image (no Open Graph tags), the referrer is stripped, and the token cannot be rotated because frames are printed. The remedies are Hide (per photo) and Unpublish (the whole link). Also decide whether the club's own sign-up page should link to it (deploy checklist 3(b)).
- Failure microcopy: **pass.** A photo the store cannot serve becomes "Photo not available right now" and the page text still comes from the database; there is no stack trace or status code anywhere public.
- Permission gate: **pass.** The four admin routes and the page call `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first; the page and the door have no login by design; the door answers 404 for every failure, never 403.
- Mobile (360 px): **pass** on the public page (QA and my screenshot). The admin photos page has no sideways scroll at 390 px, but each group tile is a full-width block, which makes reviewing a hundred pictures a very long scroll on a phone (S3-N8).
- Brand and dialogs: **pass.** `rounded-2xl` cards, `rounded-lg` buttons, `ConfirmDialog` for hide and unpublish, no native dialog.
- PII in the repository: **pass** per QA's greps (phones, emails, streets; no image, PDF or zip in the diff); fixtures are `example.*` names and generated images.

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log entry. Numbered S3-N. **S3-N1 and S3-N2 need a decision before the dry run (week of Dec 7); the rest are small.**

**S3-N1 — Say one true thing about people in photos (copy plus a chair ruling; before the dry run).**
Proposed backlog text: *B-nnn The words about people in pictures disagree. The admin page says "Hide any that shows a person" (group heading, `publishRefusedText()`), the crew group-photo prompt says "Take a photo of the stuffies together with Santa and Mrs. Claus", the spec takes every portrait with Santa and Mrs. Claus, and the public line says "We photograph stuffies only, never children." Ask the chair whether Santa and Mrs. Claus (adult volunteers) may appear in public pictures, then make all four strings say the same: for example "Hide any photo that shows a child, or anyone who should not be public", crew prompt unchanged or reworded, public line "We photograph stuffies, never children." Update `collage-ui.ts` and the strings' tests together; the review instruction is the control the whole privacy promise rests on.*

**S3-N2 — Portraits released without review, including retakes after publish (decision, then about 30 lines; before the dry run).**
Proposed backlog text: *B-nnn Portraits are public the moment the session is published (if the family agreed) and every later portrait or retake is public at once; the door served a post-publish retake to a stranger immediately and the admin page did not flag it. Recommended: treat portraits like group pictures. Stamp `published_at` on the portraits the admin has seen at Publish, require `published` for the public viewer's portrait case in `decidePhotoAccess`, show "N portraits are new since you published" with "Publish late photos", and have the review button cover the portraits grid too. This changes Phase 3's live-follow ruling (no schema: `sw_photos.published_at` already exists). If the chair prefers live-follow, say so in DECISION-125 and add only the "new since you looked" notice so the admin can see what went public. Tests: a retake after publish is 404 to a stranger until Publish late photos; the collage and door still agree.*

**S3-N3 — Make the review gate say what it can and harden the edges (small).**
Proposed backlog text: *B-nnn (a) Disable "Mark group photos reviewed" until every page of group photos has been loaded, or show "Viewed N of M" and require M of M (60 per page today; Phase 1 expects about 100). (b) After "Unhide" of a photo that was hidden before the first publish, say "It will appear after you press Publish late photos" (or release it automatically: unhiding is a deliberate act). (c) Do not write a new audit row when the same `throughPhotoId` is already the latest review (QA noted repeats). (d) Group tiles on a phone should be two columns so a hundred pictures are reviewable.*

**S3-N4 — Removal line and a consent explanation on the public page (copy).**
Proposed backlog text: *B-nnn Replace "Changed your mind? Contact the club and we will take your stuffy down." with a sentence that covers any photo ("Want a photo taken down? Email info@westervillelions.org and tell us which one") and show the address itself, as Phase 1 asked, next to the link to `/connect`; name who watches that mailbox and the contact-form inbox on Dec 19 to 21 and who can hide a photo that day. Add "Portraits appear here only when a family chose to share them." so a family that opted out is not left wondering where its own stuffy is.*

**S3-N5 — The pending page after the date has passed (copy).**
Proposed backlog text: *B-nnn `pendingHeadline()` prints "The photos arrive on <photo day>" even when that day is in the past. When the Eastern date is after `photoDate` and the collage is still unpublished, say "The photos will be here soon" (the Sunday-pickup case).*

**S3-N6 — Print nits before the family page reuses them (small).**
Proposed backlog text: *B-nnn In print, the blue gradient header keeps its background image when "Background graphics" is on, so the title prints black on dark blue (add `print:bg-none` beside `print:bg-white`); a "Stuffy portraits" heading can strand at the foot of page 1 (add `break-after: avoid` to the headings). Fix in the shared collage print rules because the family page reuses them.*

**S3-N7 — The collage does not expire by itself (process).**
Proposed backlog text: *B-167 Slice 5 must delete the bytes, stamp every photo `purged_at`, then set `public_purged_at`, because the door does not read the session marker. Orchestrator reminder for Jan 31, 2027 to run the public purge (the page stays live until then); fallback is Unpublish. Add to backlog: a scheduled purge reminder or cron (already proposed at Phase 3).*

**S3-N8 — Housekeeping (low).**
Proposed backlog text: *B-nnn (a) `HIDE_SITE_CHROME` is a `<style>` on `body > header, body > footer`; give the root layout an opt-out for chrome-free pages so a layout change cannot bring the site menu back onto the collage and the family page. (b) The e2e collage and crew specs leave an empty per-run folder in `.santas-workshop-store/`; add an `rmdir` to the cleanup helper. (c) The collage 404 page repeats the collage route's title and echoes the escaped path (neither distinguishes unknown from malformed; keep identical). (d) Alt text is ordinal only; fine for privacy, thin for screen-reader users, and acceptable until the club says otherwise.*

**Decision records (I did not edit `docs/decisions.md`).**
- **DECISION-125:** items 3 and 4 hold for what Slice 3 delivers (opt-in portraits, group pictures unpublished until reviewed, hide at any time, check-in photos never public). Record SW-L3 as measured (a fresh fetch after a hide is 404 at once; a browser that already had the image still served it from its cache) and SW-L4 as measured (9 bad tokens, 1 distinguishable response). Add the S3-N2 outcome to the decision (portraits gated like group pictures, or live-follow recorded as accepted with the new-since-published notice). Keep Proposed until Slice 5 (purge, reset, retention dates). Re-read "the collage shows removed after January 31" as "after the admin runs the public purge".
- **DECISION-122:** unchanged and still Proposed; the placeholder tile on a Drive outage and the 5-minute window against Drive remain unmeasured.

## Deploy checklist additions for Slice 3 (in order, after Slice 2's)

1. **Nothing to configure.** Slice 3 adds no migration, no dependency and no environment variable. Read the deploy log for a clean build.
2. **Header and page check on the deployed host.** `curl -I https://<production origin>/santas-workshop/c/anything` must be a 404 with `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` and `camera=()`; a real token's page must be 200 with the same headers and `Cache-Control: no-store`; the photo door's images must show `private, max-age=300`.
3. **Decide with the chair before the dry run:** (a) the S3-N1 ruling on Santa and Mrs. Claus in public pictures; (b) the S3-N2 choice for portraits; (c) whether the club's own sign-up page should link to the collage. That page reads `collagePath` from `WORKSHOP_2026` (currently `null`, so no link): setting it needs the real session's token, known only after the real session exists, and a deploy. The QR on the frames works without it. If the link goes on the public page, the collage is findable from the club's website; say so to the chair; (d) who watches `info@westervillelions.org` and the contact-form inbox on Dec 19 to 21 and who holds `santas_workshop.manage` that weekend to hide a photo.
4. **Production practice run of the collage (on the practice session from Slice 2's checklist, real Drive):** take portraits and group photos through the crew app, open the Photos tab, try Publish before review (refused with a count), review, publish, open the link logged out in a private window and by scanning the admin QR with a phone, hide one picture and time how long a phone that already loaded it keeps showing it (SW-L3 against Drive), then deliberately break storage and confirm tiles degrade to "Photo not available right now" while the page text stays, repair, unpublish (the date reads "The photos arrive on..."), republish.
5. **Real session.** The collage token is created with the session. After creating the real session, read the collage link from the Photos page and check it begins with the **production origin** (it is built from `NEXTAUTH_URL`; a wrong value would print a wrong QR on every frame; Slice 4's origin guard will refuse a non-production origin for a real session, but do not rely on it for the admin card). Send the exact link to whoever builds the frames.
6. **Photo-day evening procedure.** Open the Photos tab on a laptop; page through every group picture and the portrait grid; hide anything showing a child; press Mark reviewed (the button is available even if some pages were never opened, so do open them all); press Publish; open the link logged out and scan it from the QR; watch the count of "Visible to anyone with the link". Pictures taken afterwards need review and "Publish late photos"; **until S3-N2 is done, a retaken or late portrait of a family that agreed goes public at once**, so take retakes before publishing or check the portrait grid after.
7. **Reminders (orchestrator).** The collage and portraits are intended to stay up through Jan 31, 2027, and nothing removes them automatically: set a reminder for the public purge (Slice 5) and note that Unpublish is the immediate fallback.

## Release-notes paragraph (no version number, no file list)

Santa's Workshop now has a public photo collage. After the event, an admin reviews the group pictures, hides any that should not be shared, and publishes the collage; the link on each family's printed frame then opens a quiet page of group pictures and the portraits of stuffies whose families agreed to share. The page never shows a name, and families who did not agree are kept off it. A photo can be hidden at any time and disappears right away, and the admin can unpublish the whole page or add late photos in a second step. Before the photos are published the same link simply says when to check back.

## CLAUDE.md edits for the orchestrator

1. **Project Structure:** under `santas-workshop/` add `c/[token]/  # public collage: noindex, force-dynamic, no names`; under `components/santas-workshop/` add `collage/  # the public gallery client island`; under the admin segment note a `photos` page for the session.
2. **Key Features -> Santa's Workshop** (add after the worker-surface bullet): "**Collage (v1.96, B-167 Slice 3, DECISION-125):** `/santas-workshop/c/<token>` is 'anyone with the link': a 128-bit token created with the session, never rotated, never in a sitemap, `noindex, nofollow`, `Referrer-Policy: no-referrer`, `force-dynamic` so HTML never outlives a hide, images `private, max-age=300` (the accepted 5-minute window). **One visibility rule:** `decidePhotoAccess({ kind: 'public' })` in `photo-access.ts` decides both what the collage lists and what the photo door serves a stranger (published, unhidden group pictures; current, unhidden portraits whose family opted in; never check-in photos), through one row mapper, so the page cannot list what the door would refuse. The public DTO is a photo id and a kind only: no name, caption, count or storage key (scan-tested); alt text is ordinal and every sentence is a fixed string. A token for a session that is not yet published shows 'The photos arrive on <photo day>', a publicly purged one 'These photos have been removed' (both 200 because the QR is printed before the photos exist and outlives them); an unknown or malformed token is one identical 404. **Review before publish is a server gate:** group photos are unpublished until an admin presses 'Mark group photos reviewed', recorded as a `group_photos_reviewed` session-log row holding the id of the newest group photo seen; Publish is refused (409 `photos_unreviewed`, with a count) while any unhidden group photo is not covered, and stamps `published_at` only on covered photos, so a later upload stays private until it is reviewed and 'Publish late photos' is pressed. Hide and unhide are audited and take effect at the door on the next fetch. [If S3-N2 lands: portraits are gated the same way; if live-follow is kept, say so here.]"
3. **Gotchas:** add "A Postgres `timestamptz` carries microseconds and a JavaScript `Date` only milliseconds: never read a cutoff into a `Date` and compare it back in SQL (S3-D1 left the newest photo permanently unreviewable); keep such comparisons in SQL or carry the row id." and "The collage page hides the site header and footer with a scoped `<style>` on `body > header, body > footer`; the family page reuses it."
4. **Key Invariants:** add "**The public collage and the photo door share one visibility rule** (`decidePhotoAccess`); never add a second filter on the page." and "**The collage's review gate is enforced by the server, not the button.**"
5. **Integrations or Gotchas, Zeffy consent line:** note once that an unrecognised photo-sharing answer means no portrait on the collage.

### Phase 6 handoff (Slice 3)

**Owner:** analyst
**Status:** complete (Slice 3 only; Phase 6 stays open for Slices 4 and 5)

### Summary
SHIP WITH NOTES for Slice 3. The collage matches the design: one visibility rule shared by page and door, no names, opt-in portraits, group pictures behind a real server-side review gate, an immediate hide, three honest states for the printed QR and one identical 404 for bad tokens. Two things need a decision before the dry run: the wording about people in photos contradicts itself (S3-N1), and portraits, including retakes after publish, go public with no review, which I measured (S3-N2).

### What I did
- Read the whole work-log in the order given, DECISION-125 and spec §3.5, §5, §7 and Q17, then the shipped collage, photo-admin, door and page code.
- Drove the real app on `:3101` (local store, no Zeffy, no Drive): pending page, refused publish, review, publish, live page at 360 px, hide, retake after publish, admin photos page at 390 px, print to PDF; cleaned the branch to zero workshop rows and stopped the server by PID.
- Found S3-N1 (conflicting people-in-photos wording, including a Slice 2 crew prompt I missed), S3-N2 (post-publish portraits public at once), S3-N3 (review covers unloaded pages; unhide trap), S3-N5 (stale pending date) by reading the copy and the access rule against Phase 1.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` in the pipeline worktree and its Per-Phase Status row. No code, `CLAUDE.md`, `decisions.md` or `backlog.md` touched; nothing committed. Screenshots and scripts are in the session scratchpad only.

### Open questions / handoff notes
- Orchestrator: file S3-N1 to S3-N8 (text above); take S3-N1 and S3-N2 to the chair before the dry run; apply the CLAUDE.md edits and the DECISION-125 updates when Slice 3 ships; set the Jan 31 public-purge reminder and make Slice 5 delete bytes, stamp every photo, then set the session marker.
- Chair: may Santa and Mrs. Claus appear in public pictures; should the club website link to the collage; who answers removal requests on Dec 19 to 21.


---

## Phase 6 — Slice 4 — 2026-10-13

**Scope judged:** the admin Frames page (`/admin/santas-workshop/[sessionId]/frames`), the two admin routes (`frames/manifest`, `frames/exported`), persisted frame numbers, the browser composite (1200 x 1800 JPEG at 300 dpi, QR from the collage link, caption words, stuffy name), zip parts and the index CSV, the origin guard, "Export only new and retaken" and "Retry failed", and the optional `frame-art` slot. **Out of scope, not gaps:** the family page and the purge/reset engine (Slice 5).

**Tree state measured:** worktree on main `ab0b566` (v1.96.0) plus the uncommitted Slice 4 diff (37 `git status` entries; one dependency, `fflate`; no migration; no env var except a dev-only override). Method: the work-log in the order given (my Phase 1 addendum Flow C and gap 5/6, Phase 2 Ruling 8, Phase 3 "Frame export" and DECISION-124, both Phase 4 sections with the post-QA fixes, QA's FAIL then PASS, my Slice 3 note on the QR caption), spec §4 step 5, §7 "Frame" and decision 14, then the shipped code (`frame-layout`, `frame-manifest`, `frame-names`, `frame-origin`, `csv-index`, `zip-parts`, `frame-compose`, `frames-panel`, `art-slots`). I did not re-run the test suite (QA's 4,949 tests and the 6 frames e2e tests stand). I ran the real export myself on `:3101` (branch database, local photo store in the scratchpad, `NEXTAUTH_URL` set to the server's own origin, the frame-origin dev override set, `ZEFFY_API_KEY` forced empty, no Sync): a **real** session (so no PRACTICE band) with four stuffies taken through tag, check-in and portrait (two with the same name "Teddy", one 49-character name, one with emoji and an accent; one portrait shot vertical, the others horizontal, each carrying labels at its edges so I could see exactly what is cropped) plus one stuffy with no portrait; I used the page's Prepare and Export, downloaded the part through the browser, unzipped it, read the JPEGs' headers, looked at three frames, decoded the QR, and computed the QR's module size for the **production** link. I then deleted both sessions, re-measured the branch at 0 sessions, orders, stuffies and photos (`email_queue` 1362), and stopped the server by PID. A photo counter, a printer, a phone scanning paper, the chair's laptop and the chair's art are all unmeasured.

## VERDICT

**SHIP WITH NOTES.** The export does what the design says and does it carefully: numbers are stable, nothing about a frame is stored, a zip never looks complete when it is not, the origin guard fails closed, the QR decodes exactly to the collage link, and the default frame is clean enough to print if no art ever arrives. But reading the finished frames against how the chair will really use them turned up two things I would not want to meet on Sunday morning: **the print carries no frame number, so matching prints to families relies on the stuffy's name** (and two stuffies named Teddy look the same), and **every zip the page tells the chair to upload also contains `index.csv` with parents' names**. Neither is a bug in the build; both are one-line-class changes that should land before the first real upload to a photo counter (the dry run). A third matter, how a vertical phone portrait is cropped, decides whether the frames look right and needs the test print.

## ONE-LINE TAKE

> From a laptop the chair can turn every stuffy's portrait into a numbered 4x6 JPEG with the stuffy's name and a QR to the collage, in parts she can download and upload by hand, with the ones that could not be made listed and never hidden; what the frame does not carry is its own number, and what the zip carries that it should not is the parents' names.

## What's Working

- **Flow C, as specified.** Prepare shows the counts up front ("4 frames to make, 1 left out"), names each stuffy that gets no frame and why ("Nopic: no portrait taken yet"), shows "Retaken since last export" and the last export time; Export shows "Frame N of M, part P of Q" with the current name, Stop that keeps finished parts, and ends with a sentence counted against the run's own target ("4 of 4 frames done."; QA's S4-D1 fix: "1 of 1 frame done." for a subset). A failed frame is retried three times, listed by name with its reason, left out of the zip, written into the index as `produced = no`, never marked exported, and "Retry failed" makes a separate zip (QA reproduced all of it).
- **Stable frame numbers.** Allocated under a row lock the first time a stuffy has an exportable portrait, alphabetically by parent last name within the batch, never reassigned; a late portrait gets `max + 1`; a retake keeps its number. File names are `ssw-<slug>-NNN.jpg` (ASCII, no name, no path characters; a hostile stuffy name `Rex, "Q"/..\x` was drawn as text and quoted in the CSV in QA's run). The name printed on the frame and the portrait come from the same stuffy row, so the code cannot attach one stuffy's portrait to another's name.
- **Everything is made in the browser and nothing is stored.** No server rendering, no Drive or Postgres frame bytes; the only server calls are the manifest (which allocates numbers) and "exported" (which stamps the photo id actually used, so a retake during an export reads "changed"). Measured by QA on a fast machine with a realistic 1 MB image 200 times: 37.9 s for 200 frames, two parts of 100 (41.4 MB each, about 414 KB a frame), about +104 MB of browser memory; the zip is stored, not compressed, because JPEG does not compress. My own run: four 1200 x 1800 JPEGs (176 to 215 KB with my synthetic images) with JFIF density 1, 300 x 300 dpi.
- **The QR is exactly the collage link, with the caption in words.** `qrPayload` is the same string the admin photos page shows; I decoded a frame to it, and it still decoded after I shrank the image to one third (about 100 dpi). The caption is "Scan to see the whole day's photos / westervillelions.org", never the 22-character token (Phase 3 ruling 10; my Slice 3 note on the caption is satisfied).
- **The origin guard fails closed and cannot be talked out of it in production.** A real session's manifest is refused (409 `collage_url_not_production`, with a plain sentence and no Export button, and **no number allocated**) unless the collage link starts with `https://westervillelions.org/` on a Vercel production deploy; practice sessions are exempt; the dev override is honoured only off production (QA measured it ignored on a production build). The club's real origin is `https://westervillelions.org` everywhere else in the app (layout, sitemap), so the guard matches.
- **Hostile and awkward names are handled.** Control and bidi characters are stripped, the name shrinks from 84 px to a 44 px floor, then truncates by code point with an ellipsis (my 49-character name printed as "Sir Reginald Fluffington the Third of Wester…", legible); the emoji name "Bear 🐻🎄 Noël" rendered in color with its accent on this Chromium. Zero portraits: no Export button and a sentence; a one-frame run works; a purged session is refused.
- **The default frame is good enough to print.** A blue border, a gold rule, a cream mat, "A Visit to Santa's Workshop 2026" in a serif, a near-square photo window with a gold edge, the stuffy's name large beneath it, the QR on a white plate bottom left with the caption to its right, all inside the 75 px safe margin. It is plain, tidy and consistent with the club's colors; it would not embarrass the club if no art arrives. The optional `frame-art` slot is ready (exactly 1200 x 1800 transparent PNG; window x 75, y 225, 1050 x 990; name band y 1235 to 1335; QR plate x 75, y 1365; the page loads it only when the slot is switched on, so there is no console 404 until then).

## Intent-vs-Shipped Diff

- **Manifest up front; progress by frame and part; failures collected and retried; the zip never looks complete (Flow C).** Matches (QA's failure drill: a deleted portrait file produced "3 of 4 frames done. 1 failed.", a part of the 3 good frames, a `no` row with a reason, and a retry zip with the one frame).
- **Index CSV with a `produced` column.** Shipped as `produced` yes/no plus a separate `reason` column (design said `no: <reason>` in one cell); columns `frame_number, file_name, stuffy_name, parent_last, parent_first, window, produced, reason, photo_consent`. Verdict: **acceptable drift.** **But Phase 1 gap 6 said the number-to-family mapping goes in a separate, admin-only index CSV, because the third party sees what is uploaded. Shipped: the index rides inside every zip part (and again as a combined download), and the page tells the chair to "Upload them to the photo counter by hand."** I confirmed it: my zip's entries were the four JPEGs plus `index.csv`, which holds each stuffy's parent's first and last name, the drop-off window and the photo-consent answer. Verdict: **regression against intent** (S4-N2).
- **Stable frame numbers.** Matches. **"Match frames to stuffies by number":** the design's own file naming makes the number the join key, but **the number is not on the print.** My frames show the stuffy's name, the portrait and the QR; no number, no parent. A photo counter prints the picture, not the file name. So at pickup the only thing on the print that identifies the family is the stuffy's name, and in my test two frames read simply "Teddy". The chair can tell them apart by looking at the stuffy and by the index (by parent last name), but only if she knows which print is which: that is a wrong-portrait risk at the door that one small printed "No. 002" in the safe margin would remove, and the number is not personal data. Verdict: **gap** (S4-N1). The wrong-portrait risk upstream of the frame is covered separately: the check-in photo is now shown at the portrait and pickup stations (the Slice 2 note landed), so a portrait taken on the wrong stuffy has a chance of being caught at the Santa station.
- **"Portraits taken since last export."** Matches. It compares portrait ids exactly (not clocks): the indicator and the "Export only new and retaken (N)" button appear after a retake, the stuffy keeps its number, and the subset zip is named `...-part-1-of-1-new.zip` so it can sit beside the full run's zip. One residue: the JPEG inside has the **same file name** as the earlier one (`-002.jpg`), so a counter that already received frame 002 will see a duplicate name (S4-N6).
- **Withheld list.** Phase 1: hidden or portrait-less stuffies are listed, never given a placeholder frame. Shipped exactly that, in the page ("Left out of the zip: Echo: portrait hidden by an admin") and in the index with a reason. **What the page does not say is what to do about them.** A family with no frame on pickup morning is a real conversation; the page names the problem but not the remedies (unhide the portrait on the Photos page, or take a new portrait and use "Export only new and retaken") (S4-N5).
- **Photo window and how a portrait is cropped (Phase 1 gap 2, left open).** The window is 1050 x 990, almost square, on a 4x6 portrait card, and the portrait is **cover-cropped** into it. I measured both shapes with edge labels: a **horizontal** phone photo loses about 20 percent off the left and right (my "TOP" and "BOTTOM" labels survived, the "L" and "R" at the edges were trimmed in; Santa, Mrs. Claus and the stuffy sitting side by side survive); a **vertical** phone photo loses about 29 percent of its height, 14.5 percent off the top and bottom each (my "TOP EDGE" and "BOTTOM EDGE" labels were gone entirely: a Santa hat or a stuffy's feet would be cut). The crew app's portrait prompt says only "Take the portrait with Santa and Mrs. Claus. Keep the sticker out of the shot." Verdict: **drift with a real consequence** (S4-N3): either tell volunteers to shoot sideways with everyone in the middle, or decide the window shape before the chair's art is made; the test print with real portraits shot both ways settles it.
- **QR "scannable at 4x6 print size".** Shipped: integer pixels per module, at least 7, a 4-module quiet zone, ECC M, on a solid white plate. **Reasoning at 300 dpi, using the real production link:** `https://westervillelions.org/santas-workshop/c/<22-character token>` is 69 characters, which is QR version 5 (37 modules), so the layout's floor of 7 px per module is what it gets: each module is 7 px = **0.59 mm**, the symbol is 21.9 mm wide and the plate with its quiet zone is 26.7 mm (about 1.05 in). QA's note that "the real link is about 50 characters (version 4)" described the development link (62 characters, 33 modules, 8 px, 0.68 mm); the production link is longer. 0.59 mm is above the roughly 0.5 mm that phones read from arm's length, but it is a floor, not a margin, and a glossy print's dot gain eats into it. The block has room: a target of 360 px (instead of 340) gives 8 px per module on the production link and still ends at the bottom safe margin. Verdict: **acceptable drift, tighten** (S4-N4), and the printed-paper scan stays a hard gate.
- **Default frame versus the chair's art.** Decision 14 allows either; the default is printable (see above). One print-trim note: the outer 36 px (3 percent) is solid blue, and photo counters often trim 2 to 3 percent, so an uneven blue edge on some prints is likely and harmless; a cream outer edge with the blue inset one step in would not show a trim at all (S4-N8).
- **Origin guard and the practice exemption.** Matches Phase 3 (with the code renamed `collage_url_not_production`, accepted).
- **Index CSV honesty rule.** Matches: every `no` row carries a reason, a part is offered only after every frame in it produced or is listed failed, hidden and portrait-less stuffies appear with their reasons, and the combined index covers everyone.
- **Frames for families that opted out of photo sharing.** Included (it is the family's own frame), as DECISION-125 says; their QR leads to the public collage, which does not show their portrait, which is correct.
- **Third-party processing.** Phase 1 gap 7 asked that the sign-up copy say frames are printed at a photo service; I did not re-read that copy for this slice (increment 1); confirm it (deploy checklist).

Phase 3 rulings touching Slice 4:

| # | Ruling | Verdict |
|---|---|---|
| Ruling 8 / DECISION-124 | Browser canvas composite, `fflate` zip, no server rendering, no stored frames | accept; measured on QA's machine, the chair's laptop is still unmeasured |
| 10 | The caption is words plus `westervillelions.org`, not the token URL | accept; shipped wording is "Scan to see the whole day's photos" (the decision's text says "Scan for the day's photos"): update the decision |
| 11 | Persisted numbers allocated alphabetically within a batch; zip order is not pickup order; the index CSV is the pickup table; "since last export" compares photo ids | accept; note a late portrait gets `max + 1`, so prints are in family-name order only for the first batch |
| 8 (hidden portrait withheld from the zip; opted-out included) | accept; shipped and tested |
| 15 | No schema after the front-loaded migration | accept (none in this diff) |

Phase 4 deviations: **api-developer** 1 (error code `collage_url_not_production`), 2 (no `producedAt`; the last-export time comes from the audit row), 3 (one `withheld[]` list with a reason) and 4 (`sinceLastExport` includes never-exported portraits, so the UI shows "retaken" from `changedSinceExport`) accepted. **ux-developer** 1 (`zipSync` at level 0 per part instead of streaming `Zip` with `ZipPassThrough`) accepted: simpler and measured (a 100-frame part is built in memory once; update DECISION-124 item 2's wording); 2 (the `produced` and `reason` columns) accepted with S4-N2; 3 (the layout throws if the QR would exceed 43 modules, a link over roughly 100 characters) accepted, a hard stop that fails loudly rather than printing a tiny QR; 4 ("Export only new and retaken" and "Retry failed") accepted; 5 (title and year drawn only when there is no art overlay; name, QR and caption always at fixed positions) accepted. **Post-QA:** S4-D1 (summary counted against the whole list), the art 404 cleanup, the distinct `-new` zip name, and the "last export" time (the manifest query returned a bare `timestamptz` string that some runtimes read as local time; now an unambiguous ISO instant shown with an ET label) accepted and verified by QA.

## What the chair does, and what could go wrong

**Saturday evening (photo day), after the portraits are done and the collage is published:** open the session's Frames tab on a laptop, press Prepare export, read the counts and the left-out list; fix what can be fixed now (unhide a portrait, take the missing portrait); press Export frames; wait (about 40 seconds for 200 on QA's machine); click each "Download part" button (the browser may ask permission for several files); **unzip, and upload the JPEGs, not the index**; order 4x6 prints for pickup. **Sunday morning (pickup):** collect the prints; match each to its stuffy by the printed name and the index (sorted by parent last name); for any late or retaken portrait press Prepare again and "Export only new and retaken", upload that file separately; hand over stuffy and frame after the parent-name check.

**Could a family receive the wrong portrait?** Not through the app's own pairing: name and portrait come from one row. Three ways it can still happen, none of them a code defect: (1) a worker photographed the wrong stuffy at the Santa station (the check-in photo is now shown there to catch it); (2) two stuffies share a name and the print carries no number (S4-N1); (3) a retake after the first upload: the old print may already be printed and the new file has the same name (S4-N6). The frame's name is the stuffy's name only, never a child's, and file names carry nothing personal.

## Edge Cases

- Zero portraits: **pass** (no Export button; "No portraits have been taken yet, so there are no frames to make."; the API allocates no number).
- A one-frame run: **pass** ("1 of 1 frame done." singular; subset zip `-new`).
- A failed fetch mid-part: **pass** (QA: collected, listed with the reason, excluded from the zip and from "exported", retried into a separate zip).
- 200 frames on a slow laptop: **unmeasured.** QA's 37.9 s and +104 MB are a fast machine with the same 1 MB image fetched 200 times (which may flatter the network). Stop keeps finished parts and re-running is cheap because nothing is stored, so the failure mode is "slow", not "lost". Measure on the chair's laptop in the dry run.
- A name with emoji, an accent or 49 characters: **pass on Chromium.** The font stack lists system emoji fonts; Windows, Safari and Firefox rendering is unmeasured.
- Duplicate stuffy names: **pass in the code, a gap on the print** (S4-N1).
- A purged session, a real session on a non-production host, a phone: **pass** (each refused with a sentence; a phone is told to use a laptop).
- Permission gate: **pass.** Both routes and the page call `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first; the manifest carries no email, mobile, note or token (QA's sentinel scan) but **does** carry parent first and last names for the index, so it is rightly behind the narrow key.
- Mobile: **pass** by design (a phone sees "Use a laptop for this step"; QA checked 360 px).
- Brand and dialogs: **pass.** No native dialog, no `console.log`, the 50-row and 500-item bounds enforced on the server.
- PII in the repository: **pass** per QA's greps; no image, PDF, zip or `frame-art.png` in the diff.

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log entry, numbered S4-N. **S4-N1 and S4-N2 should land before the first real upload to a photo counter (the dry run); S4-N3 and S4-N4 are settled by the test print.**

**S4-N1 — Print the frame number on the frame (small, ux-developer).**
Proposed backlog text: *B-nnn The printed frame carries the stuffy's name but not its frame number, so a print cannot be matched to its row in the index, and two stuffies with the same name are indistinguishable on paper. Draw a small "No. 007" (the number from the manifest, no personal data) inside the safe margin, for example bottom right under the caption, in `frame-compose.ts` with its rectangle in `frame-layout.ts`; the file name already carries it. Update the art-slot note (keep that corner plain). Test: the layout rect sits inside the margin and overlaps nothing; the e2e unzip decodes a frame whose number matches its file name.*

**S4-N2 — Keep parents' names out of the zip (small, ux-developer; before the dry run).**
Proposed backlog text: *B-nnn Each zip part contains `index.csv` (parent first and last name, drop-off window, photo-consent answer), and the page says to upload the zips to the photo counter. Phase 1 gap 6 required the number-to-family index to be separate and admin-only because the third party sees what is uploaded. Remove `index.csv` from the zip parts and offer it only as the separate "Download index" (per part, or combined), change the sentence to say "unzip, upload the JPEG files only, keep the index on your laptop", and add a line on how to unzip (counters take pictures, not zips). Test: no zip entry named `index.csv` or containing a parent name; the index download still lists every stuffy with its reason.*

**S4-N3 — Decide how portraits are cropped before the art is made (decision plus copy).**
Proposed backlog text: *B-nnn The photo window is 1050 x 990 and the portrait is cover-cropped into it: a vertical phone photo loses about 14.5 percent off the top and bottom each, a horizontal one about 10 percent off each side (measured with edge labels). Either (a) change the crew portrait prompt to "Hold the phone sideways. Keep Santa, Mrs. Claus and the stuffy in the middle" (and photograph both ways at the dry run), or (b) change the window or the card orientation (a 1800 x 1200 landscape 4x6 suits horizontal portraits and leaves more room for the name and QR) before the chair's art is drawn, since the art's window is fixed to these numbers. Record the choice in DECISION-124 and the `frame-art` slot note.*

**S4-N4 — Give the QR a margin on the production link (one constant).**
Proposed backlog text: *B-nnn The production collage link is 69 characters, QR version 5, which puts the layout at its floor of 7 px per module (0.59 mm at 300 dpi). Raise `QR_TARGET_PX` from 340 to 360 so the production link prints at 8 px per module (0.68 mm; the block still ends at the bottom safe margin), correct the art-slot note ("about 340 px square") and the unit test's expectations, and keep the "link too long" guard. Printing one frame and scanning it with an iPhone and an Android phone at arm's length remains the gate.*

**S4-N5 — Tell the chair what to do about a left-out family (copy).**
Proposed backlog text: *B-nnn Under "Left out of the zip" add a next step per reason: hidden ("Unhide it on the Photos page, or take a new portrait") and no portrait ("Take the portrait at the Santa station or at pickup, then use Export only new and retaken"), and a one-line reminder that these families receive no printed frame until then. Consider a "Left-out list" download so the chair can bring it to pickup.*

**S4-N6 — A retaken frame keeps its file name (low).**
Proposed backlog text: *B-nnn A retake is exported as the same file name (`-002.jpg`), so a counter that already has frame 002 sees a duplicate, and the old print may already exist. Name a re-export `-002-r2.jpg` (or add the export date) while the frame number stays stable, and say on the page "Reprint this one and put the old print aside".*

**S4-N7 — The frame settings have no screen (small).**
Proposed backlog text: *B-nnn `frame_part_size`, `frame_file_prefix` and `frame_art_key` exist on the session and the PATCH route, but the Edit session form does not show them. The counter's rules (maximum files or size per upload, file-name pattern) are only learned in the dry run and must be applied without a deploy: add the three fields to the edit form with plain labels and validation (`sanitizeFilePrefix`, part size 1 to 500).*

**S4-N8 — Print-trim and housekeeping (low).**
Proposed backlog text: *B-nnn (a) The default frame's outer 36 px is solid blue; counters that trim 2 to 3 percent will leave an uneven blue edge. Use a cream outer edge with the blue band inset beyond 3 percent. (b) Emoji and accent rendering is measured on Chromium on macOS only: check Windows and Safari at the dry run. (c) A late portrait is numbered `max + 1`, so prints are in family-name order only for the first batch; the index stays the pickup table. (d) The page says "Upload them to the photo counter by hand" (the zips): reword with S4-N2.*

**Decision records (I did not edit `docs/decisions.md`).**
- **DECISION-124:** promote after these edits to its text: item 2 (shipped `zipSync` at level 0, one part at a time, not streaming `Zip` with `ZipPassThrough`; the index handling per S4-N2); item 3 (the index columns, `produced` and `reason`; the caption "Scan to see the whole day's photos"); item 5 (error code `collage_url_not_production`); and record SW-L11 as measured on QA's machine (37.9 s, +104 MB, two parts of 41.4 MB for 200 frames) with the chair's laptop still unmeasured. Keep "the photo service accepts these files and file names" and "the printed QR scans" in Unmeasured until the test print; and note S4-N3's outcome once decided.

## Deploy checklist additions for Slice 4 (in order, after Slice 3's)

1. **Dependencies and config.** Slice 4 adds one dependency (`fflate`), no migration and no environment variable. Confirm the Vercel **production** `NEXTAUTH_URL` is exactly `https://westervillelions.org` (no `www`, no path): the guard refuses real-session frames otherwise (it fails closed, with a sentence). Never set `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN` in Vercel (it is ignored in production anyway).
2. **Smoke on production with the practice session** (real Drive, real portraits from the Slice 2 pass): Prepare, Export, download the part, unzip, open one JPEG, scan its QR with a phone (it opens the practice collage on the real site), retake one portrait and run "Export only new and retaken", hide one portrait and see it listed as left out.
3. **Test print at a photo counter before the dry run (the gate for everything in this slice).** Use the practice export (it carries a "PRACTICE · not for print" band, which is fine for a test) built from portraits shot **both vertical and horizontal** with a real stuffy, a long name and an emoji name, and two stuffies with the same name. Ask the counter and write down: file types and the 1200 x 1800 size accepted; whether it takes several files or a zip (it will almost certainly want pictures, so unzip first); the maximum files and megabytes per upload; whether prints come out in file-name order; whether it auto-crops or adds a border (turn both off, "fit" or "no crop"); and the **turnaround**, which decides whether a Saturday-evening upload can be ready for Sunday pickup. Print one 4x6 at 100 percent, then **scan its QR with an iPhone and an Android phone at arm's length, indoors and in dim light**, read the stuffy's name from a metre away, and judge the portrait crop (S4-N3). Record the answers on the session: set `frame_part_size` and `frame_file_prefix` (S4-N7 if the screen exists; otherwise through the session PATCH route).
4. **If the chair supplies frame art:** it must be a transparent PNG of exactly 1200 x 1800 with a clear window at x 75, y 225, 1050 x 990 and plain areas for the name (y 1235 to 1335) and the QR plate and caption (from y 1365); put it at `public/images/santas-workshop/frame-art.png`, add `frame-art` to `SUPPLIED` in `art-slots.ts`, deploy, and repeat the test print and the phone scan. A mis-sized file is refused with a sentence, never silently stretched. If no art arrives the default frame is the plan.
5. **Dry-run additions (the week of Dec 7):** an export with 100 or more frames so it makes two parts, timed on the **chair's own laptop and browser** (record the time and the browser's memory; accept the "download several files" prompt); a retake after the first export and "Export only new and retaken"; a hidden portrait and a stuffy with no portrait and what the chair does about them; unzip and upload to the counter; at a mock pickup, match prints to stuffies by name and by the index, including the two same-named stuffies.
6. **Saturday evening and Sunday runbook (until S4-N1 and S4-N2 land):** confirm the collage is published (Slice 3) so the QR resolves when families scan it on Sunday; Prepare, read the counts and the left-out list; Export; download every part; **delete `index.csv` from the unzipped folder, or upload only the JPEG files**, and keep the index on the laptop; print one frame first and scan it before ordering the rest; on Sunday, late or retaken portraits go in a separate, clearly named upload. After S4-N1 the number on each print joins it to the index.
7. **Check the sign-up copy** (increment 1) says the frames are printed at a photo service (Phase 1 gap 7).

## Release-notes paragraph (no version number, no file list)

Admins can now make a printed keepsake frame for every stuffy. From a laptop, the Frames page prepares the list (who gets a frame, who is left out and why), then makes a 4x6 picture for each stuffy with its portrait, its name and a code that opens the day's photos, in numbered zip files of about 100 pictures ready to upload to a photo counter. If a portrait is retaken afterwards, only that frame needs to be made again. The page never presents a set as complete when a frame is missing, and a real event's frames can only be made from the club's live website, so the code on every printed frame always opens the right page.

## CLAUDE.md edits for the orchestrator

1. **Project Structure:** under the admin segment note a `frames` page for the session; under `lib/santas-workshop/` note the pure frame modules (`frame-layout`, `frame-manifest`, `frame-names`, `frame-origin`, `jpeg-dpi`, `zip-parts`, `csv-index`, `frame-export-ui`) and under `components/admin/santas-workshop/` the browser-only `frame-compose.ts` and `frame-export-run.ts`.
2. **Dependencies:** add `fflate` (zip) beside `qrcode` and `jsqr`.
3. **Key Features -> Santa's Workshop** (add after the collage bullet): "**Frame export (v1.97, B-167 Slice 4, DECISION-124):** `/admin/santas-workshop/<id>/frames` (laptop only) turns each stuffy's current portrait into a **1200 x 1800 (4x6 at 300 dpi) JPEG composited in the admin's browser** (canvas; portrait cover-cropped into a 1050 x 990 window, the stuffy's name by `fillText`, never SVG or HTML; the collage QR from `qrcode` module data at whole pixels per module, minimum 7, with a 4-module quiet zone, on a white plate inside a 75 px safe margin; caption in words plus `westervillelions.org`, never the token link; JFIF density rewritten to 300 dpi by `jpeg-dpi.ts`) and zips them with `fflate` in parts of `frame_part_size` (default 100). **Nothing about a frame is stored** and there is no server rendering. The server does two things: `POST .../frames/manifest` allocates and persists **frame numbers** (`sw_stuffies.frame_number`, under a row lock, alphabetical by parent last name within the batch, never reassigned, a late portrait gets `max + 1`) and lists withheld stuffies (a hidden portrait, or no portrait) with reasons, and `POST .../frames/exported` stamps `frame_exported_photo_id` with the portrait id actually used, so a retake reads 'changed' and 'Export only new and retaken' can redo just those. An opted-out family still gets a frame; a hidden portrait does not. A part is offered only when every frame in it produced or is listed as failed; the index CSV (`produced` yes/no plus a reason) is built through `csvCellSafe()` and, per S4-N2, is never uploaded to the photo counter. **Origin guard:** a REAL session's manifest is refused (409 `collage_url_not_production`) unless the collage link starts with `https://westervillelions.org/` on a Vercel production deploy, because a frame's QR outlives the event; practice sessions are exempt (their frames carry a PRACTICE band); `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1` lets a developer export from localhost and is ignored in production. **Art:** the optional `frame-art` slot (`art-slots.ts`) is a transparent 1200 x 1800 PNG that replaces the default border and title; it must leave the photo window (x 75, y 225, 1050 x 990), the name band (y 1235 to 1335) and the QR block (from y 1365) plain, and is switched on by adding the id to `SUPPLIED`."
4. **Environment Variables:** add `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN` ("development only: `1` allows exporting a real session's frames from a non-production origin; ignored in production") and, in the `NEXTAUTH_URL` entry, "must be exactly `https://westervillelions.org` in production: Santa's Workshop frame export refuses a real session otherwise".
5. **Gotchas:** add "A frame's QR encodes the collage link; the production link is 69 characters (QR version 5), so the QR is at its 7 px floor unless `QR_TARGET_PX` is raised (S4-N4)." and "A vertical phone portrait loses about 29 percent of its height in the frame's near-square window; shoot portraits sideways (S4-N3)."

### Phase 6 handoff (Slice 4)

**Owner:** analyst
**Status:** complete (Slice 4 only; Phase 6 stays open for Slice 5)

### Summary
SHIP WITH NOTES for Slice 4. The browser export is careful and honest: stable numbers, nothing stored, incomplete parts never look complete, the origin guard fails closed, the QR decodes to the collage link, and the default frame is printable. Two things should land before the first real counter upload: the print carries no frame number (so duplicates like two "Teddy" prints cannot be told apart) and the zip the page tells the chair to upload also holds `index.csv` with parents' names. How a vertical portrait is cropped, and the QR sitting at its 7 px floor on the production link, are settled by the test print.

### What I did
- Read the work-log in the order given, spec §4, §7 and decision 14, then the shipped frame modules, the page and the art slot.
- Ran the real export on `:3101` (a real session with the dev override, local store, no Zeffy, no Drive): prepare, export, download, unzip, read the JPEG headers, looked at three frames, decoded the QR (also at one third resolution), measured both portrait crops with edge labels, and computed the QR's module size for the production link; cleaned the branch to zero workshop rows and stopped the server by PID.
- Found S4-N1 (no number on the print), S4-N2 (`index.csv` inside the zip, contradicting Phase 1 gap 6), S4-N3 (the crop), S4-N4 (QR at its floor; QA's "version 4" described the dev link), S4-N6 and S4-N7 by comparing the frames and the code to Phase 1 Flow C.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` in the pipeline worktree and its Per-Phase Status row. No code, `CLAUDE.md`, `decisions.md` or `backlog.md` touched; nothing committed. Screenshots, frames and scripts are in the session scratchpad only.

### Open questions / handoff notes
- Orchestrator: file S4-N1 to S4-N8 (text above); S4-N1 and S4-N2 are one small ux pass before the dry run; apply the CLAUDE.md edits and the DECISION-124 text changes when Slice 4 ships; keep the Dec 7 test print on the calendar.
- Chair: which photo counter, its file and upload rules and turnaround; whether art will arrive and, if so, its window shape (S4-N3); whether volunteers will shoot portraits sideways.


---

## Phase 6 — Slice 5 — 2026-10-13

**Scope judged:** the family page `/santas-workshop/f/[token]` and its portrait door, the retention engine (preview, personal purge, public purge, practice reset) and its Retention card, the photo door's refusal by the session purge markers, B-180 (check-ins with no photo), B-181 (the Close warning) and B-183 (print nits), plus the post-QA fixes S5-D1 (the family sees its own portrait from the moment it exists) and S5-D2 (a purged practice session can be reset and restarted).

**Tree state measured:** worktree on main `0aff8cc` (Slices 1 to 4 shipped through v1.97.0) plus the uncommitted Slice 5 diff (42 `git status` entries; no migration, no dependency, no new env var). Method: the work-log in the order given (my Phase 1 and addendum, my Phase 3 addendum reading "family portrait timing", both Phase 4 sections and the post-QA fixes, QA's FAIL then PASS), DECISION-125 as promoted in `docs/decisions.md`, spec §3.6 and §7, B-180/B-181/B-183, the club's privacy page and the sign-up page copy, then the shipped code (`family-queries`, `family-ui`, the page, `retention`, `retention-policy`, `retention-ui`, `photo-access`). I did not re-run the test suite (QA's 5,048 tests and 77 workshop e2e tests stand). I drove the real lifecycle myself on `:3101` (branch database, local photo store in the scratchpad, `NEXTAUTH_URL` set to the server's own origin, `ZEFFY_API_KEY` forced empty, no Sync): a practice session with two stuffies carrying sentinel family, parent, note, care, snack, description and withdraw-reason text; one taken through tag, check-in photo, portrait, pickup name check and pickup (so the QR path is the real one); the family page and its door before publish, after publish, after a forced personal purge and after a forced public purge, at 360 px; a Letter print to PDF; an early (unforced) purge; and a SQL scan of the session's rows for every sentinel after the purges. I then deleted the session, re-measured the branch at 0 sessions, orders, stuffies and photos (`email_queue` 1362), and stopped the server by PID. A real Drive purge, a real phone scan of the pickup QR, a time-boxed resume on a session of about 200 stuffies, and Neon or Workspace restore history are unmeasured.

## VERDICT

**SHIP WITH NOTES.** The family page and the retention engine deliver what Phase 1 and DECISION-125 describe: the family's own portrait is visible from the moment it exists, no family can reach another family's stuffy, the purge is resumable and deletes bytes before it stamps rows, and the practice reset restarts a drill while a real session can never be wiped. But checking the engine against the **privacy page's own promises** found three places where the mechanism does not yet keep them, and one the app cannot keep at all without a human: **a purge leaves a registrant's free-text description and an admin's withdraw reason behind forever (measured), the family page still prints the stuffy's name after the photos are "removed", nothing in the app nudges anyone to press the two purge buttons, and the promise to "remove a detail on request" has no per-family tool.** None of these is a defect against the written design; each is a promise the club has already published. They should land before the real event (S5-N1 to S5-N4); none reopens an earlier phase.

## ONE-LINE TAKE

> A family that scans the pickup QR sees its own stuffy's portrait at once, can save and print it, and later finds the whole day's photos; the club can take every photo down and wipe every parent's details with two button presses on two dates it must remember, with a few free-text leftovers and a quiet failure mode if nobody presses.

## What's Working

- **The family's experience, from the pickup QR.** On the worker's phone the pickup screen draws a QR for `/santas-workshop/f/<token>` (QA decoded it from the rendered image and it resolves). In my run, **before the collage was published** the page showed the stuffy's name as its heading, the **portrait immediately**, "Save this portrait", the note "The photos arrive on Saturday, Dec 19. Check back in the evening.", a Print button, and the fixed footer; the family door answered 200 at the same moment. After Publish the note became a "See the whole day's photos" link. That is the S5-D1 ruling working: the portrait is the family's own and is already printed on the frame in their hands, so only the public link waits.
- **No family can see another family's stuffy.** A token is 128 random bits (22 characters), unique-indexed, one per stuffy (an order of three stuffies has three tokens). The page query selects the stuffy name, the photo date and the session's markers, no parent, child, contact, order or sticker column (scan-tested). The family door goes through the same `decidePhotoAccess` as everything else: allowed only for that stuffy's current, unhidden portrait; never a check-in photo, never a group photo, never another stuffy's. Unknown, malformed, withdrawn and 60-character tokens all answer one identical 404 for page and door (QA: same body, content type and cache header; a malformed token never reaches the database); a family token against crew, admin or retention routes is 401. The collage link on the family page leads to the public collage, which shows other families' portraits only where **they** agreed. `<script>` in a stuffy's name rendered as text.
- **Printing at home.** No site chrome, no buttons, the portrait large, the stuffy's name, a QR to the collage drawn from the link (the token never prints as text; QA confirmed with `pdftotext`), a black-on-white title (B-183's gradient fix). **Measured nit:** the published page at Letter in my run printed on **two** sheets (the footer alone on the second), as QA's O1 said; the tweak that is landing should be re-measured (deploy checklist).
- **The retention engine matches DECISION-125.** Two scopes with their own date and marker; eligibility computed on the server (the session must be closed and the Eastern day on or after the date, else 409 `not_eligible`; my early purge answered "This cannot run yet: the date is 2027-01-19."); each photo's bytes are deleted from the store first and the row stamped second, so a crash or a store failure leaves a row naming bytes that may be gone, never bytes with no row; a store failure stops the run and rethrows; the database part runs in one transaction under a row lock after a recount, with a rollback sentinel; the marker is set only when no photo of the scope remains; `purged` status only when both markers are set. Purge preview is counts only. In my run the personal purge with a forced, typed reason deleted the check-in photo, nulled the order's buyer fields, the stuffies' notes, care notes, snack and raw answers, the event notes and the manual-add reason, kept the tag codes and family tokens, and left the family page working; QA's sentinel scan of 14 patterns across five tables found zero hits after, against 1 to 4 per table before. The public purge then deleted every portrait and group photo for every viewer, the family page said "These photos have been removed", and the door answered 404 for the token's portrait.
- **The practice/real asymmetry holds.** A real session answers 403 `practice_only` to Reset from any credential and its preview offers none; a practice reset deletes bytes and rows, clears both markers and the publish stamp, returns the session to draft and keeps its settings, and the Activate button works again (S5-D2, QA re-verified). A purged real session is terminal.
- **B-180, B-181, B-183 are delivered and QA-verified.** The overview counts check-ins with no check-in photo, links to a filter and each row carries an amber "No check-in photo" chip (QA: matches SQL); the Close dialog adds "N phone(s) used the code in the last hour. Photos still waiting on it cannot be sent after closing." when a worker phone has written within the hour (a roster read does not count); the shared print rules strand no heading and drop the header gradient.
- **The only free text is fenced.** The forced-purge reason (1 to 500 characters, required, stored in the purge audit row) is the one free-text field in the audit log; the dialog says "Do not type any family's name here." and keeps Confirm disabled until a reason is typed. QA's scan found no stuffy or family name in `sw_session_log`.
- **Nothing here emails**, and no personal data was added to the repository.

## Intent-vs-Shipped Diff

- **A family sees its own portrait from the moment it exists; publish gates only the collage link.** Phase 3 addendum, DECISION-125 item 3. Shipped (S5-D1) and measured live (before publish: portrait shown, door 200, no collage link; hidden portrait: neither). Verdict: **matches.**
- **The collage link later.** A relative `/santas-workshop/c/<token>` appears only once the collage is published; before that, a note. Verdict: **matches.** (The pending note reads "being prepared" after the photo day, as S3-N5 asked.)
- **A hidden portrait.** The family sees "This photo isn't available. The club has set this picture aside. Please ask a member of the crew." (QA's S5-N1: the coordinator expected "on its way"). **The orchestrator keeps this wording and I accept it:** it is honest, it does not say why, and it matches the frame (a hidden portrait is withheld from the zip too, Slice 4). The dry run should include "a family arrives whose portrait is set aside" so the crew knows what to do (checklist).
- **Printing at home.** Phase 1 and spec §3.6: a clean, printable family page. Shipped; the Letter page count is the open nit (S5-N6).
- **What a family sees in February.** After the public purge the page says "These photos have been removed. The Westerville Lions Club has taken these photos down. Thank you for joining us." with no image and no link, and the QR on a printed frame resolves to that page, not a 404 (my run, and the collage behaves the same). **But the page's heading still prints the stuffy's name** ("Maple" above "These photos have been removed"), because the name is a kept tombstone (S5-N2).
- **Retention against DECISION-125 and the privacy page.** DECISION-125: parent and child data and check-in photos at 30 days after pickup (Jan 19, 2027 for pickup Dec 20), portraits and group photos through Jan 31, 2027, both by manual admin action with two calendar reminders. The privacy page and the sign-up page say: "We delete sign-up details from the club's records by January 31, 2027" and "The collage and portraits stay online through the end of January 2027, and sooner if you ask us". Two reconciliations: (a) the personal date (Jan 19) is earlier than the promise (Jan 31), which is safe; the public date is **the same day as the promise's last day**, and the purge is eligible from the start of Jan 31, so a collage taken down that morning is down a few hours before "the end of January": harmless and in the safe direction; (b) the promises are kept only if a person presses the buttons (see "If nobody presses the buttons"). **What the mechanism does not delete is the problem:** see S5-N1.
- **The two manual reminders as the mechanism.** Delivered as designed: the Retention card shows each scope's date and a state ("Not yet", "Due", "Purged") with the blocker in words. The reminders themselves are the orchestrator's; the app has no part in them (S5-N3).
- **The forced-purge reason as the only free text.** Matches, with the dialog warning. Note the withdraw reason is a **second** free-text field (S5-N1) that this fence does not cover.
- **Practice/real asymmetry (DECISION-125 item 4).** Matches (above).
- **B-180/B-181/B-183.** Delivered and verified (above). **S2-N5 (the family QR):** resolved: the page exists, so the Dec 14 fallback (hide the QR) is not needed; keep the date as a check that the page is deployed and the QR resolves on production.
- **"To remove a photo or a detail, contact us and we will take it down" (privacy page and the page footers).** A request about **one family** has no tool: the admin can hide a photo (immediate), but the only way to delete a family's details is the session-wide personal purge, which needs a closed session and, before Jan 19, a forced reason that wipes everyone's details at once. Without hand SQL (forbidden) the club cannot honour a single-family request. Verdict: **gap against a published promise** (S5-N4).

Phase 3 rulings and addenda touching Slice 5:

| # | Ruling | Verdict |
|---|---|---|
| Addendum, family portrait timing | A family sees its own current, unhidden portrait before publish; only the collage link waits; hidden, superseded and purged still refused | accept; implemented and measured |
| 8 | A hidden portrait is withheld from the family page and the zip | accept (page: shipped; zip: Slice 4) |
| 9 | Collage and family tokens are not throttled; one identical 404 | accept; measured (QA's 9-token matrix; mine: unknown and withdrawn alike) |
| Retention and purge | Two scopes; drive bytes first; tombstones kept (payment id, item key, tag code, stuffy name **and description**); practice reset immediate, real sessions never reset | accept the engine; **do not accept keeping `description` as a tombstone** (S5-N1) |
| 15 | No schema after the front-loaded migration | accept (none in this diff) |

Phase 4 deviations and fixes: **api-developer** (the door also refuses by the session markers, S3-N7: accepted, and verified: after the public purge every photo is 404 for admin and anonymous alike; reset also clears the publish stamp and nulls the session's webhook snapshots: accepted; `photosDeleted` on reset counts rows including already-stamped ones: accepted; the typed reason in the audit row: accepted with the S5-N1 caveat); **ux-developer** (`ConfirmDialog` gained an optional `confirmDisabled`, backward compatible: accepted; five overview tiles: accepted; "Save this portrait" and Print: accepted; no e2e for the Close warning with a live phone count: acceptable, QA verified it by hand; the original chair note "the portrait waits for publish" was overtaken by S5-D1); **post-QA** S5-D1 and S5-D2 and the print footer tweak accepted.

## If nobody presses the buttons

The two purges are manual and nothing in the app prompts them. The Retention card shows "Due" only on the session's own page, which nobody has a reason to open in January; the sessions list, the admin dashboard and the session overview's checklist do not flag it, and no email is sent (deliberately). If nobody presses them: the parents' names, emails, mobiles and children's first names stay in the database past **Jan 31, 2027**, the check-in photos stay in the shared drive, the collage and portraits stay online past "the end of January", and the privacy page is simply wrong, with no signal inside the product that it is. A second trap sits in front of the first button: **purge requires the session to be Closed.** Nothing closes a session by itself (the crew-closing date only locks phones out; the status stays Active), so on Jan 19 the card will say "the session is not closed", the only way through is a forced run with a typed reason, and forcing becomes the routine path (S5-N3). The mechanism is therefore exactly two calendar reminders plus a Close on Dec 21; they belong on the user's and the chair's calendars now (to-do list below).

## Edge Cases

- **A purge interrupted midway:** **pass in the design, unmeasured at scale.** Resumable by construction: re-posting continues from the photos still unstamped; a store failure stops the run (503 with the storage code), audits `interrupted`, and nothing past the failure is touched; the marker is set only when nothing of the scope remains. Unit-tested with a failing adapter and a time budget (`done:false`, `remaining`); the 25-second budget and the multi-round loop have not run on a real-sized session or on Drive. **One transient oddity:** while a public purge is half done, a family whose portrait has already been deleted sees "Your stuffy's portrait is on its way" (the portrait reads as not yet taken) until the run finishes (S5-N7).
- **A family page after the personal purge but before the public one:** **pass.** Measured: the heading, the portrait and the collage link all still work; only parent and child details and check-in photos are gone, as the design says.
- **A token printed on a frame after a public purge:** **pass.** The collage shows "These photos have been removed" and the family page the same (200, friendly, noindex); no 404 on a printed code; the door answers 404 for every photo.
- **A purge before its date or on an open session:** **pass.** 409 `not_eligible` with the reason in words, nothing touched; forcing needs a reason (blank or over 500 characters is 400).
- **A real session, reset:** **pass** (403, nothing deleted, no button).
- **A purged practice session:** **pass** after S5-D2 (reset returns it to draft; Activate works).
- **A stuffy withdrawn or refunded:** a withdrawn stuffy's token answers 404 (a withdrawn family has no page); a refunded stuffy in custody keeps its page.
- **Permission gate:** **pass.** The three retention routes call `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first; the page and door are token-gated by design. Both irreversible actions share the area's single key (held by admin and board_member by default); there is no separate purge key (QA O4; S5-N8).
- **Mobile (360 px):** **pass** (my screenshot and QA's): the portrait fills the width, the save, collage and print controls are 44 px.
- **Brand and dialogs:** **pass.** Destructive `ConfirmDialog`s with counts, no native dialog.
- **PII in the repository:** **pass** per QA's greps.

## Follow-Ups (SHIP WITH NOTES)

Each becomes its own work-log entry, numbered S5-N. **S5-N1 to S5-N4 should land before the real event (Dec 17); S5-N1 and S5-N2 must land before Jan 19.**

**S5-N1 — A purge must delete every free-text detail it can leave behind (small, api-developer; I measured this).**
Proposed backlog text: *B-nnn The personal purge nulls buyer fields, notes, care notes, snack, raw answers, event notes, the manual-add reason and webhook snapshots, but two free-text columns survive both purges: `sw_stuffies.description` (typed by the registrant, e.g. "Grandma Rosalind's old bear"; the Phase 3 design kept it as a tombstone) and `sw_stuffies.withdrawn_reason` (typed by an admin in the Withdraw dialog, e.g. "Quimby family asked to cancel"). In a practice run, after the forced personal and public purges both still held their sentinel text. Null both in the personal scope (and count them in the preview), keep only opaque identifiers as tombstones (payment id, item key, tag code, family token, state stamps), change the Withdraw dialog to say "Do not type a family's name", and correct `scopeDescription()` ("Each stuffy keeps only its name, its portrait and its family page link"). Test: a sentinel in each free-text column is gone after the personal purge.*

**S5-N2 — The removed page should not print a name (small, ux-developer plus api-developer).**
Proposed backlog text: *B-nnn After the public purge the family page's heading still prints the stuffy's name ("Maple" over "These photos have been removed"), and `sw_stuffies.name` is kept forever as a tombstone. The privacy page promises sign-up details are deleted by Jan 31, 2027, and a stuffy is often named after a child. In the removed state use the fallback heading ("Your stuffy") and stop selecting the name; at the public purge null `name` as well (frames and the collage no longer need it), or record in DECISION-125 and on the privacy page that the toy's name is kept. Test: the removed family page contains no registrant text.*

**S5-N3 — Nudge the purge, and let it start from "closed or past the closing date" (small, ux plus api).**
Proposed backlog text: *B-nnn Nothing tells anyone a purge is due. Show a "Retention due" badge on the sessions list card and the admin dashboard when either scope is Due, and on the overview checklist; consider emailing the holders of `santas_workshop.manage` on the due date only if it can be done without a durable claim (otherwise leave email out). Purge also requires status Closed, which nothing sets: either treat an Active session whose crew-closing date has passed as eligible, or add "Close session and purge" to the card, so Jan 19 does not require a forced, free-text reason. Put "Close the session on Dec 21 after no phone has photos waiting" on the calendar (B-181's dialog already warns).*

**S5-N4 — A per-family removal tool for the promise the privacy page makes (api plus ux; before the real event).**
Proposed backlog text: *B-nnn The privacy page and every footer say "To remove a photo or a detail, contact us and we will take it down." The admin can hide one photo, but cannot delete one family's details except by running the session-wide personal purge, which needs a closed session or a forced reason and wipes everyone at once; hand SQL is forbidden. Add "Remove this family's details" on the registrant row (ConfirmDialog with counts; nulls that order's and its stuffies' personal columns including description and withdraw reason, keeps tombstones, writes an audit row of counts) and make the existing Hide the documented route for a photo. Test: one family's sentinels vanish and the others' stay.*

**S5-N5 — A set-aside portrait: the crew's script (process).**
Proposed backlog text: *Dry-run item, not code: the family page says "This photo isn't available. The club has set this picture aside. Please ask a member of the crew." and the frame is withheld too. The crew needs one sentence for what to do (take a new portrait at pickup, then the admin uses Export only new and retaken). The orchestrator keeps the wording (QA's S5-N1); no change.*

**S5-N6 — Print: the published family page spills to a second sheet at Letter (cosmetic).**
Proposed backlog text: *B-nnn Measured in this tree: the published family page at Letter prints on two sheets (the footer alone on the second; one sheet at A4); the collage's last footer can also strand. The landing tweak (`.sw-print-footer`, portrait cap) should be re-measured at Letter and A4 in the browsers the club uses; lazy-loaded images that have not loaded print as empty frames (QA O2): load them eagerly in print.*

**S5-N7 — Transient states during an interrupted public purge (low).**
Proposed backlog text: *B-nnn While a public purge is half done, a family whose portrait is already deleted sees "Your stuffy's portrait is on its way". Treat a stuffy whose portrait row is purged as "removed" for the family page, and let the Retention card show "N photos left" until finished.*

**S5-N8 — Housekeeping and a decision (low).**
Proposed backlog text: *B-nnn (a) Purge and reset share `santas_workshop.manage`, which board members hold; decide whether the two irreversible actions need their own key (`santas_workshop.purge`, bound to admin only) before the real event. (b) Retention dates are editable on the edit page and nothing checks them against the privacy page's published date (`signupDataDeletedBy`, 2027-01-31): add a validation that `purgePersonalOn` is on or before it. (c) A local-store purge leaves an empty session folder; the e2e specs leave empty `e2e-*` folders. (d) QA could not verify a purge against Drive, a live `done:false` resume or a concurrent double purge; run them in the dry run.*

**Decision records (I did not edit `docs/decisions.md`).** DECISION-125 is already Resolved in the main tree. Corrections to make: item 1's "after which the collage shows removed" is true only once the admin has run the public purge (say so); item 2's tombstone list must drop `description` and the stuffy name per S5-N1/S5-N2 or state why they stay; item 2's "only free text in `sw_session_log`" is true, but the withdraw reason is a second free-text column in `sw_stuffies`; the Unmeasured block stays (Drive-backed purge, a real-sized resume, restore history, the chair/board nod on the dates).

## Deploy checklist for Slice 5 (in order, after Slice 4's)

1. **Nothing to configure.** No migration, no dependency, no environment variable. Read the deploy log for a clean build.
2. **Confirm the S1 Drive delete result before anything else here.** The purge needs a permanent file delete under the service account's shared-drive role (SW-L10, the S2-N6 spike). If delete is not allowed, the personal purge cannot finish and the privacy promise cannot be met: change the role or the design before the real event, not in January.
3. **Smoke on production with the practice session** (real Drive): register or add two stuffies, take them to pickup, scan the pickup QR with a phone (it opens the family page; before publish it shows the portrait and "The photos arrive on..."), publish and see the collage link, print the page at Letter in the browser the club uses (record the page count), then Close the session, run the personal purge **early with a forced reason** (the dialog must warn about names), confirm the check-in photo is gone from the drive and the details are gone from the registrants page, run the public purge, confirm the files are gone from the drive and the family page and QR say "removed", then Reset the practice session and Activate it again.
4. **Re-measure the print** after the footer tweak lands (Letter and A4, family and collage).
5. **Before the real event:** land S5-N1 to S5-N4 (or knowingly defer them with the chair's agreement); confirm the retention dates on the real session are Jan 19, 2027 and Jan 31, 2027 (shown on the Retention card) and that the chair and board have nodded to them (DECISION-125 still lists the nod as unmeasured); set the calendar reminders (to-do list).
6. **After the event:** Close the session on Dec 21; run the two purges on Jan 19 and Jan 31, 2027 from the session's Retention card (counts first, then confirm; re-press until the progress line finishes); afterwards check the shared drive is empty of that session's folder contents.

## Release-notes paragraph (no version number, no file list)

Every stuffy now has its own photo page. A family scans the code on the volunteer's phone at pickup and sees its stuffy's portrait right away, can save it and print it, and gets a link to the whole day's photos once the club has published them. After the event the club can take every photo down and delete the sign-up details from its records from one screen, in steps it can pause and resume; the printed codes keep working and then say the photos have been removed. Practice sessions can be reset and run again. Admins can also see which stuffies were checked in without a photo, and closing a session now warns if a volunteer's phone still has photos waiting.

## CLAUDE.md corrections to the drafted "Family page and retention" bullet

1. "printable as one sheet": measured two sheets at Letter for the published page (one at A4); say "prints cleanly; one sheet at A4, check Letter" until the footer tweak is re-measured.
2. "Tombstones kept: payment id, item key, tag code, family token, state stamps, stuffy name": add "(and, until S5-N1 lands, the stuffy's `description` and an admin's `withdrawn_reason`, which the personal purge does not clear)"; after S5-N1/S5-N2 reword to the new list.
3. After "`personal` nulls parent and child data...": add "check-in photos and superseded retakes".
4. After "eligible only when the session is closed": add "**Nothing closes a session by itself**, so Close it first (Dec 21) or every purge needs a forced, reasoned run".
5. After "the family page shows the stuffy's name": add "the removed state still prints it until S5-N2".
6. Add the invariant "**Purging is a promise-keeping mechanism, not an automatic one:** the privacy page publishes Jan 31, 2027; the reminders are on calendars, not in the product."

### Phase 6 handoff (Slice 5)

**Owner:** analyst
**Status:** complete (Slice 5; see the increment summary below)

### Summary
SHIP WITH NOTES for Slice 5. The family page shows a family its own portrait at once and cannot show another family's; the retention engine is resumable, deletes bytes first, refuses early runs and never touches a real session's reset. Against the privacy page's promises it leaves free-text details behind (a registrant's description and an admin's withdraw reason, measured), keeps printing the stuffy's name on the removed page, has no per-family removal and gives no nudge to anyone to press the two purge buttons.

### What I did
- Read the work-log in the order given, DECISION-125, the spec, the backlog items, the privacy and sign-up copy and the shipped family, retention and door code.
- Ran the real lifecycle on `:3101` (practice session, local store, no Zeffy, no Drive) from pickup through publish, a Letter print, an early purge, a forced personal purge, a forced public purge, and a SQL sentinel scan; cleaned the branch and stopped the server by PID.
- Found S5-N1 (description and withdraw reason survive), S5-N2 (the removed page prints a name), S5-N3 (no nudge; purge needs Closed, which nothing sets), S5-N4 (no per-family removal) by comparing the engine to the published promises.

### Outputs
- This section of `docs/work-log/2026-10-12-santas-workshop-sessions-and-workers.md` in the pipeline worktree and its Per-Phase Status row. No code, `CLAUDE.md`, `decisions.md` or `backlog.md` touched; nothing committed. Screenshots, the PDF and scripts are in the session scratchpad only.


---

## Phase 6 — Increment 2 overall (B-167: sessions, workers, collage, frames, family page) — 2026-10-13

**Verdict for the increment: SHIP WITH NOTES.** B-167 closes as a build with its notes tracked; "SHIP IT" is reserved for the day the real-world gates below are measured. All five slices individually shipped with notes, no slice was reopened after Phase 5 PASS, and no phase is reopened by Slice 5.

**Does the whole deliver Phase 1's intent for the weekend?** Yes, in the sense that every verb Phase 1 listed now exists and was exercised end to end on a phone-sized screen with the real routes. Registration arrives by signed Zeffy webhook with Sync, Remap and Reprocess as the safety nets (Slice 1, the CSV importer replaced by design); the chair creates and edits sessions, shares a worker code, pauses and rotates it, adds a family by hand with a reason, handles refunds and flags, and sees live counts and the awaiting-pickup list (Slices 1 and 2); volunteers tag by scanning a sticker, check in with a first photo and the snack choice on screen, take and retake the one portrait, shoot group photos, and hand a stuffy back only after the name was shown and a human chose, with photos waiting safely on the phone through bad signal or a storage fault and no contact data ever on a crew screen (Slice 2); the admin reviews, hides and publishes a nameless public collage, with portraits gated like group pictures after S3-N2 (Slice 3); the chair makes numbered 4x6 frames in the browser with a QR to the collage and a guard against printing a wrong-origin QR (Slice 4); every family gets its own portrait page from the moment it exists and the club can take the photos down and clear the details (Slice 5). The practice session lets the whole thing be rehearsed and reset. What was deliberately **not** built: email or SMS to families (B-168 stays "delivery by email, a durable-claim path"), a purchasable book, a print API, and a typed pickup-name comparison.

**What remains is not code.** Everything the build cannot prove from inside the repository is on the list below: the real Zeffy payload shapes and the consent wording (Slice 1 N5), the Drive service account and **whether the role it holds can permanently delete** (which the purge and the privacy promise depend on), the real stickers and an iPhone and an Android phone (S3), a photo counter's file rules, turnaround and a printed QR scanned from paper (S4), the chair's laptop for a 200-frame export, the chair's frame art and the portrait crop (S4-N3), the retention dates' nod from the chair and board, and four small notes that should land before the real event: **S5-N1 (free-text leftovers in the purge), S5-N2 (the removed page prints a name), S5-N3 (no nudge; Close first) and S5-N4 (per-family removal)**. The weakest links for the weekend, in my order: (1) Drive delete permission and the service account, (2) the real Zeffy shapes and the consent text, (3) a printed frame's QR from a counter, (4) real phones and stickers, (5) the two purge dates nobody is reminded of.

### Consolidated dry-run checklist (the week of Dec 7; its own practice session; the practice Zeffy form; volunteers' own stuffies; real stickers; real phones; the real photo counter)

**A. Registration and setup (Slice 1).** A two-ticket test purchase on the practice form arrives within seconds; a reworded question lands as "needs attention" with its raw text and is cleared by mapping then Remap; full, partial and reversed refunds show the right badge and flag; a buyer edit arrives as an updated order; the drop-off window chips on the Edit page match the form's real options; Sync reports missed and skipped payments; the consent question's real "yes" text makes a family's portrait appear on the collage; the checklist is green except the placeholders you expect.

**B. The crew (Slice 2).** Three real stickers decode to three different codes (note whether they are vendor URLs); an iPhone and an Android phone: camera prompt, scan, `<input capture>` return, a low-light portrait; tag, change sticker, move a sticker, a sticker on a checked-in stuffy refused; check-in with a photo (the snack choice and care note on screen), check-in without a photo and the admin's "No check-in photo" list; the check-in photo shown at the portrait and pickup stations; a portrait and a retake; group photos; airplane-mode toggles mid-photo with the "photos waiting" strip, closing and reopening the tab, and the photos draining with no duplicate; the **storage failure drill** (wrong folder id, or the service account removed) with the red banner, "Check in without a photo", and recovery; rotate with phones active, pause and resume, six wrong codes then the throttle; the admin revert on a real-kind session; a late registrant added by hand; a pickup by someone other than the named parent with its note; time ten check-ins at the table; count pickups lacking the `name_shown` then `pickup_check` pair (expect 0); look for any parent email or mobile on any crew screen (expect none).

**C. The collage (Slice 3).** Publish refused until reviewed; the chair's ruling on Santa and Mrs. Claus in public pictures applied to the review wording; portraits and late photos wait for "Publish late photos"; hide a picture and time how long a phone that already loaded it keeps showing it (on Drive); a logged-out phone opens the link from the QR; the removal line and who answers the mailbox; a broken storage turns tiles into "Photo not available right now".

**D. Frames (Slice 4).** A test print at the counter (practice export, portraits shot vertical and horizontal, a long name, an emoji name, two stuffies with the same name): the counter's file rules, unzip-then-upload, order, turnaround, crop settings off; scan the printed QR with an iPhone and an Android phone at arm's length, indoors and dim; judge the crop; a 100-plus-frame export on the chair's laptop and browser (record time and memory); a retake after the first export and "Export only new and retaken"; a hidden portrait and a stuffy with none in the left-out list and what the chair does about them; match prints to stuffies by name and the index at a mock pickup; upload the JPEGs, not the index.

**E. Family page and retention (Slice 5).** Scan the pickup QR on production: the portrait shows before publish, the collage link after; a family whose portrait is set aside sees the "ask the crew" page and the crew knows what to do; print the family page at Letter and A4; Close the practice session, run the personal purge early with a forced reason (the dialog warns about names), confirm on the drive that the check-in photo is gone and the registrants page shows no details, run the public purge, confirm the files are gone and the QR says "removed"; Reset and Activate again.

**F. Across the board.** The sign-up copy says frames are printed at a photo service; the privacy page's two dates (details deleted by Jan 31, 2027; collage through the end of January 2027) match the Retention card's dates; the Dec 14 check, the Dec 18 Sync, the Dec 21 Close and the two January reminders are on calendars.

### Consolidated to-do list for the user and the chair (dates are 2026 unless stated)

| By | Who | What |
|---|---|---|
| Oct 30 | User | Create the Google service account and the private shared drive, add the account as a member with a role that permits a permanent delete, run `scripts/spike-drive.ts --apply`, record the delete result (SW-L10). Set `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_SHARED_DRIVE_ID` in Vercel; confirm `AUTH_SECRET` is set and will not be rotated before Jan 31, 2027; confirm production `NEXTAUTH_URL` is exactly `https://westervillelions.org`. |
| Oct 30 | User and chair | Build the practice Zeffy form (a copy of the real one: same question text, rate and drop-off options); confirm the real form's drop-off options spell the three window labels and the consent question's exact "yes" wording; check whether the real form can already sell. |
| Oct 30 | Chair (decisions) | Retention dates (Jan 19 and Jan 31, 2027) and the privacy promises; may Santa and Mrs. Claus appear in public pictures; whether the club's sign-up page links to the collage; who answers `info@westervillelions.org` and the contact form on Dec 19 to 21 and who holds the manage key that weekend; whether a board member should be able to run the irreversible purges (S5-N8); which photo counter, and whether art will arrive (and its window shape). |
| Nov 5 | User | Deploy Slice 1 (done in v1.94); with the key set, register the Zeffy webhook URL; Connect the real campaign `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e` to a **real** session (never a practice one), mark only the stuffy ticket rate, **Sync at once**, map the questions, Remap; run the S2a spike on the practice form and set the item-key and consent constants. |
| Nov 8 (Sun) | User | Registration opens; watch the first orders arrive; check "Need attention" is zero. |
| Nov 20 | Orchestrator | Slice 2 on production earlier than this if possible (needed for the dry run); the real-phone pass with the chair's stickers once they arrive (S3). |
| Dec 1 | Chair | Tagging begins from the real registrations; a test print at the photo counter this week (its turnaround and rules decide the Saturday-evening plan). |
| Dec 7 (week) | Chair and user | The dry run (checklist above), then fix what it finds. |
| Dec 14 | Orchestrator | Confirm the family page is deployed and the pickup QR resolves on production (S2-N5 closes); S5-N1 to S5-N4 landed or consciously deferred. |
| Dec 17 (Thu) evening | User | On the real session: Test storage, then Activate **within ten minutes**; text the worker message; confirm phones show as active. |
| Dec 18 (Fri) morning | User | **Sync from Zeffy before the doors open** (a dead webhook is silent); drop-off. |
| Dec 19 (Sat) | Chair | Photo day. Evening: look through every group picture and the portrait grid, hide anything showing a child, mark reviewed and publish; open the link logged out; Prepare frames, Export, print **one** frame and scan it before ordering the rest; upload only the JPEG files (not the index); order prints. |
| Dec 20 (Sun) | Chair | Pickup: collect prints, match by the printed name and the index; late or retaken portraits go in a separate "only new and retaken" export; hand over after the name check; keep the index on the laptop only. |
| Dec 21 (Mon) | Chair | Make sure no volunteer's phone still says photos are waiting, then **Close the session** (purge needs it Closed). |
| Jan 19, 2027 | User | Run the personal purge from the session's Retention card (counts first, re-press until the progress line finishes). |
| Jan 31, 2027 | User | Run the public purge ("Take photos down"); afterwards check the shared drive holds none of the session's files and a printed QR says "removed". |


---

## Orchestrator note (2026-10-12): dev-server collision

The api-developer's `pkill -f "next dev"` (meant for its own `:3101` server in the worktree) also killed the main tree's `:3000` server. No pipeline had a live check running on it at the time. The orchestrator restarted a plain `pnpm dev` on `:3000` from the main tree. Collision count for this pipeline: 1. Rule reminder for later agents: stop your own server by its PID (`kill $(lsof -tiTCP:3101 -sTCP:LISTEN)`), never by pattern.

**Zeffy facts (orchestrator, 2026-10-12):** the user generated the organisation API key (stored in `.env.local` of the main tree and the pipeline worktree as `ZEFFY_API_KEY`; never in the repo). A read-only `GET /api/v1/campaigns` succeeded (HTTP 200). Campaign ids (not personal data): **A Visit to Santa's Workshop** = `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e` (ticketing, active) — this is the id for Connect; White Cane 2026 = `b175c706-ad80-4eac-96d1-6beb8ddc15bb` (donation form); the general donate form = `39232196-d844-430f-9b5f-394dd940e07b`; a meeting raffle and a memberships form also exist. The S2a spike can now run against the real API once a test purchase exists.

## Phase 4 — Implementation (API, Slice 2 "dry-runnable core", server step) — 2026-10-12

**Owner:** api-developer (resumed from a stopped predecessor; its partial files were kept, completed and tested)
**Status:** complete for Slice 2's server side. No UI, no email, no migration, nothing committed. Worktree `agent-a3dae9b276243994d`, Neon branch `ep-divine-boat` (verified in code before every write).

### Summary
The worker (crew) API, the photo store and the photo door are built and were exercised end to end on `:3101` against the branch database with the local-filesystem adapter: code entry and throttle, roster, search, scan, tag (every collision-table row incl. a real two-worker race, which the unique index resolves to `tag_already_bound`), check-in with and without a photo, portrait and retake (one current portrait), group photo, pickup-check and pickup, practice-only revert, pause and rotate honoured on the next request, and the photo door's uniform 404. The admin side adds status transitions, the encrypted worker code (show, rotate, pause, resume), manual add, revert, withdraw, attention dismissal, refund Keep/Withdraw, Test storage, Check storage and an awaiting-pickup CSV. Gates: `tsc` clean; `pnpm lint` 0 errors (the one pre-existing `budget-context-panel.tsx` warning); `pnpm test` 270 files / 4561 tests green; `pnpm build:only` passes.

### What I did
- **Kept from the predecessor (read, verified, tested):** `photo-store/` (types, errors, config, memory, local, Drive over an injected client, factory, contract suite), `crew-code.ts`, `crew-cookie.ts`, `crew-secret.ts`, `crew-throttle.ts`, `crew-auth.ts` (`requireCrew`), `crew-http.ts`, `crew-contract.ts` (carrier), `crew-queries.ts`, `stuffy-transitions.ts`, `tag-binding.ts`, `jpeg-header.ts`, `photo-limits.ts`, and the `state-machine.ts` forward table.
- **Written new:** `crew-entry.ts` (code entry: throttle, verify, cookie; injected dependencies), `crew-input.ts` (request validators), `crew-respond.ts` (transition result to HTTP, write context), `photo-upload.ts` (header-only validator, multipart reader), `photo-service.ts` (validate, replay check, device rate limit, quota, store, then the transaction; cleanup on refusal), `photo-access.ts` (the one module that calls the store's `get`; full viewer matrix incl. family and public for Slices 3 and 5), `session-status.ts` (transition table, 10-minute storage-test rule), `crew-admin.ts` (status, code show/rotate/pause/resume), `stuffy-admin.ts` (manual add, revert, withdraw, dismiss, refund Keep/Withdraw), `manual-add.ts`, `storage-admin.ts` (Test, Check, orphan delete), `awaiting-pickup.ts`, `scripts/spike-drive.ts`, test-support `photo-fixtures.ts`.
- **Changed:** `next.config.ts` (one `permissionsPolicy(camera)` function; crew rule after the global rule; token-page and API rules), `admin-contract.ts` (Slice 2 types, new error codes, `StorageStatus.mode`, `SessionOverview.workerAccess`, `AdminErrorBody.count/currentState`), `admin-http.ts` (extras, `storageFailure`), `session-queries.ts` (exports `failure`, checklist facts, `workerAccess`), `session-checklist.ts` (storage and worker-code items now real), `session-log.ts` (kinds), `storage-status.ts` (real banner), `admin-ui.ts` (exhaustive-switch compile fix only: one plain sentence per new code; ux-developer owns copy), `state-machine.ts`, `crew-contract.ts` (`SimpleErrorBody` made a type alias for lint), `sessions/[id]/stuffies/route.ts` (adds POST).

### Outputs: contracts the next agent consumes
All crew responses: `Cache-Control: no-store`, `X-Robots-Tag: noindex`; errors `{ error, code, ... }` (`CrewErrorBody`, consume with an exhaustive switch). Carrier: `src/lib/santas-workshop/crew-contract.ts` (types, `CREW_ERROR_CODES`, `CREW_VIEWS`, `ScanResult`, `SW_ATTEMPT_HEADER`); shared limits: `photo-limits.ts` (import these in the browser downscaler, `MAX_UPLOAD_BODY_BYTES`, `PHOTO_LIMITS`, `QUALITY_LADDER`, `DIMENSION_STEP`); state vocabulary and `canTransition`/`canRevert`: `state-machine.ts`; the sticker collision table: `tag-binding.ts`. Admin carrier additions: `admin-contract.ts` (`SetStatusRequest/Response`, `CrewCodeResponse`, `CrewCodeActionRequest`, `ManualAddRequest`, `RegistrantResponse`, `AdminRevertRequest`, `AdminWithdrawRequest`, `RefundResolution*`, `StorageTest*`, `StorageCheck*`); client-safe validators for forms: `manual-add.ts` (`validateManualAdd`), `session-status.ts` (`SETTABLE_STATUSES`).

**Crew** (`/api/santas-workshop/crew/[slug]/...`; every handler's first awaited call after reading params is `requireCrew()`; a valid crew cookie for that session, else an admin holding `santas_workshop.manage`; re-checked against the session row on every request; a `reason` (`paused|closed|signed_out`) appears only when the cookie signature was valid):

| Method and path | Request | Success | Notable errors |
|---|---|---|---|
| `POST enter` (no gate) | `{ code }` | 200 `{ ok: true }` + `Set-Cookie` (`swcrew-<8 hex>`, HttpOnly, SameSite=Lax, 72 h, `__Host-`/Secure in production) | 401 uniform body `{ error: "That code didn't work. Ask the event chair.", code: "crew_auth_required" }` for wrong, rotated, paused, closed, draft, unknown slug; 429 `throttled` adds "Wait a few minutes." |
| `GET roster` | | `CrewRosterResponse` (no contact data; refunded rows last; withdrawn excluded) | 401 |
| `GET search?q=` | q >= 3 chars | `CrewSearchResponse` (<= 10 rows; matches parent name, never returns it) | |
| `GET stuffies/[id]?view=tag|checkin|portrait|pickup` | | `CrewViewCard` (least data per view) | 404 |
| `POST scan` | `{ code }` | `ScanResult` (`found|not_tagged|retired|withdrawn`) | 400 |
| `POST stuffies/[id]/tag` | `TagRequest` (idempotencyKey is a uuid) | `CrewActionResponse` | 409 `stale_state{currentState,since}`, `confirm_move{otherStuffyName}`, `confirm_replace{oldLast4}`, `holder_advanced{otherStuffyName}`, `tag_already_bound`, `illegal_transition` |
| `POST stuffies/[id]/check-in` | multipart `meta`+`full` (`CheckInMeta`) or JSON `CheckInWithoutPhotoRequest`; header `x-sw-attempt` | `CrewActionResponse` | 409 `stale_state`; 413 `too_large|quota_exceeded`; 415 `not_jpeg`; 429 `rate_limited`; 503 `storage_*` with `retryable` |
| `POST stuffies/[id]/portrait` | multipart `meta`(`PortraitMeta`)+`full`+`thumb`; `x-sw-attempt` | `CrewActionResponse` | 409 `portrait_exists` unless `replace:true`; same upload errors |
| `POST group-photos` | multipart `meta`(`GroupPhotoMeta`)+`full`+`thumb` | `GroupPhotoResponse` | same upload errors |
| `POST stuffies/[id]/pickup-check` | `PickupCheckRequest` | `PickupCheckResponse { parentName }` | |
| `POST stuffies/[id]/pickup` | `PickupRequest` | `PickupResponse { pickedUpAt, familyUrl, replayed }` | 409 `pickup_check_required`, `already_picked_up{at}`; never blocked by a missing portrait, refund flag or storage |
| `POST stuffies/[id]/revert` | `RevertRequest` | `CrewActionResponse` | 403 `practice_only` on a real session |

**Photo door** `GET /api/santas-workshop/photos/[id]?v=thumb|full`: admin (any), crew of that photo's session (check-in full only; current unhidden portrait and unhidden group, either variant). Streams; **404 on every failure, never 401/403**; crew/admin `no-store`.

**Admin** (`/api/admin/santas-workshop/...`; `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first two statements; `no-store`):

| Method and path | Request | Response and errors |
|---|---|---|
| `POST sessions/[id]/status` | `{ to: draft|active|closed }` | `SetStatusResponse`; 409 `invalid_transition`, `has_activity` (back to draft after any tag or photo), `storage_not_ready` (REAL session needs a passing storage test in the last 10 minutes), `session_purged`. Activating issues the worker code if none. Table: draft->active|closed, active->closed|draft, closed->active. |
| `GET sessions/[id]/crew-code` | | `CrewCodeResponse` (`code`, `formatted` "ABCD-EF23", `unreadable`, `version`, `paused`, `activeDevicesLastHour`); logs `code_viewed` (never the code) |
| `POST sessions/[id]/crew-code` | `{ action: rotate|pause|resume, acknowledge? }` | `CrewCodeResponse`; first rotate with phones active in the last hour is 409 `devices_active { count }`, repeat with `acknowledge: true`. Pause is the "Paused" button (a pause keeps status Active). |
| `POST sessions/[id]/stuffies` | `ManualAddRequest` | 201 `RegistrantResponse` (200 on a double-tap replay); order `source: manual`, `manual_add` history row with the reason; required: parent first and last name, stuffy name, window, reason (3 to 500), request uuid |
| `POST stuffies/[stuffyId]/revert` | `AdminRevertRequest` (reason required) | `RegistrantResponse`; 409 `stale_state{currentState}` |
| `POST stuffies/[stuffyId]/withdraw` | `{ reason }` | `RegistrantResponse`; 409 `withdraw_not_allowed` once in custody |
| `POST stuffies/[stuffyId]/dismiss-attention` | | `RegistrantResponse` (idempotent) |
| `POST orders/[orderId]/refund-resolution` | `{ resolution: keep|withdraw }` | `RefundResolutionResponse { withdrawn, stillInCustody, resolved }`; Keep stores the refunded amount seen; Withdraw withdraws the order's registered/tagged stuffies and leaves the flag open for any in custody |
| `POST storage/test` | `{ sessionId? }` | `StorageTestResponse { ok, latencyMs, mode }`; failure is 503 with a storage code |
| `POST sessions/[id]/storage/check` | `{ action?: "delete_orphans" }` | `StorageCheckResponse` (orphan files older than 10 minutes; rows with no file; `complete`) |
| `GET sessions/[id]/awaiting-pickup.csv` | | CSV through `csvCellSafe()`, parent contact included |
| (existing) `GET sessions/[id]` | | now also `workerAccess { issued, paused, version }`; checklist `storage_tested`/`worker_code` are real; `GET sessions` `storage` has `mode` and a real `bannerCause` |

Env vars read (centralised): `AUTH_SECRET`/`NEXTAUTH_SECRET` (`crew-secret.ts` only; HKDF-derived keys for the cookie, the code encryption and the IP hash, all different from NextAuth's own use), `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_SHARED_DRIVE_ID`, `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID`, `SW_PHOTO_STORE`, `SW_LOCAL_STORE_DIR` (`photo-store/config.ts` only; a scan test fails on any other `process.env` read in the worker modules). No new env var is required to run in development.

### Unit tests Phase 3 names for Slice 2: all written and passing
`state-machine`, `tag-binding` (one test per collision-table row), `stuffy-transitions` (mocked db: replay, concurrent 23505, stale, zero-row sentinel asserted as a throw plus rollback, retake supersedes before insert, check-in without photo, second pickup, `pickup_check_required`, pickup with no portrait, withdrawn, other-session 404, actor columns, revert clears the tag with a retire event), `crew-cookie` (sign/verify/tamper/wrong session/old version/expiry/name/`Secure` and `__Host-`/derived key/constant-time), `crew-auth` (valid cookie, admin bypass, member without key, cross-session cookie, paused/closed/closing-day boundary Eastern inclusive, rotation, byte-identical denials), `crew-code`, `crew-throttle` (5th failure, other IP, 30 session-wide, success does not clear, daily, no raw IP, sweep, unknown slug, uniform bodies), `photo-store/contract` (memory + local, path traversal), `photo-store/drive` (fake client: `supportsAllDrives`, parent, `appProperties`, attempt > 1 lookup, 404s, retry once, `invalid_grant`, `storageQuotaExceeded`, 429, no key material in any message, config parse, factory modes), `jpeg-header`, `photo-limits` (+ validator, body cap), `photo-access` (the whole viewer x kind x variant x published x hidden x consent x superseded x purged x session matrix against an independently written table), `permissions-policy` (source scan plus simulated last-wins), `crew-routes-gate`, `photo-door` (store `get` only in `photo-access.ts`, importer allowlist, no storage key in routes or mappers, no Drive sharing, secrets not logged, env reads centralised), `crew-contract-no-contact`, `session-status`, `manual-add`. Extras: `photo-service`, `crew-input`, `crew-queries`, `crew-admin`, `stuffy-admin`, `storage-admin`, and `session-checklist` updated for the real storage and worker-code items.

### Live checks on `:3101` (branch database, local adapter; test rows deleted afterwards, server stopped by PID, `:3000` untouched)
61 assertions, all passed, including: uniform wrong-code body; cookie flags; roster JSON contains no parent name, email, mobile or notes; search never returns the parent name; two workers binding one sticker at the same moment yield one 200 and one `409 tag_already_bound` (no 500) and exactly one holder; a double tap with one key is `ok` plus `replayed`; pause answers `reason: paused`, rotation `signed_out`, on the very next request; the 6th attempt from one IP is 429 with the wait sentence, a cookie holder and another IP are unaffected; check-in replay (`x-sw-attempt: 2`) is idempotent; a PNG is 415; the check-in thumb, a superseded portrait and a request with no cookie are all 404 at the photo door; pickup refused before the parent check, allowed with no portrait, second tap gives `already_picked_up`. **Header measurement (Phase 5 L5, first reading):** `curl -I` on the dev server shows `camera=(self)` on `/santas-workshop/crew/...` and `camera=()` on `/santas-workshop`, the token path and the API, so the last-wins reading holds on `next dev`; the production-build measurement is still Phase 5's. All 11 new admin routes answer 401 unauthenticated.

### Deviations from the design (routed by size)
Absorbed (each under ~30 lines, no schema, no new flow):
1. **`POST /storage/test` logs against a session**: `sw_session_log.session_id` is NOT NULL, so the route takes an optional `sessionId` (the session page sends it); with none it logs on the newest session; with no session at all it still tests and logs nothing. `lastStorageTest()` reads the newest `storage_test` row of any session.
2. **Status route allows `draft|active|closed`**; "Paused" is the crew-code pause (a pause keeps status Active). Back to draft is refused once anything has been tagged or photographed (`has_activity`); reopening a closed session keeps its code.
3. **Refund `withdraw`** is an additional resolution beside `keep` (the Slice 1 N4 condition says Keep/Withdraw); it withdraws only registered/tagged stuffies and marks the refund resolved only when none remain in custody.
4. **Check storage is one pass, not resumable**: it lists the session folder in up to 50 pages (about 10,000 files, far above a session's 3-per-stuffy count) in one request and reports `complete: false` if it hits the cap. No cursor.
5. **`awaiting-pickup.csv`** (listed in the admin table, not in the Slice 2 row) is included; about 50 lines.
6. **`photo-access.ts` carries the family and public viewers and the whole matrix now** (pure decision, tested); the family, collage and public routes themselves are Slices 3 and 5.
7. **`next.config.ts` token-page and API header rules** are added now with the crew rule (design "Headers" lists all four together; harmless until the pages exist).
8. **Crew `revert` returns 403 `practice_only` for any credential on a real session**, including an admin one (the admin route with a reason is the real-session path).
9. **`admin-ui.ts`** got one plain sentence per new `AdminErrorCode` so its exhaustive switch compiles; ux-developer owns the final copy.
Not delivered, by design (Slices 3 to 5): collage, family and public routes, publish/hide, frames, purge and reset engines. `zeffy-replay.ts` and the e2e specs are still outstanding from earlier slices.

### Open questions / handoff notes
- **Next agent: ux-developer** for the Slice 2 client: the worker app (`/santas-workshop/crew/[slug]` server page that resolves the gate and renders `<CodeEntry/>` or `<CrewApp/>`, `layout.tsx` noindex), the phone outbox (`outbox-core`, `scan-loop`, `photo-downscale` pure modules and their tests from the design), and the Slice 2 admin UI (status buttons Draft/Active/Closed, worker code card with show/copy/rotate/pause and the `devices_active` repeat, manual add (phone-usable), revert/withdraw with reason, dismiss attention, refund Keep/Withdraw, Test storage and Check storage, awaiting-pickup CSV link). Slice 1 N4 hard conditions map to routes: manual add -> `POST sessions/[id]/stuffies`; refund Keep/Withdraw -> `POST orders/[orderId]/refund-resolution`; per-stuffy attention dismissal -> `POST stuffies/[stuffyId]/dismiss-attention`; status buttons -> `POST sessions/[id]/status` plus crew-code pause; worker code card -> `GET/POST sessions/[id]/crew-code`; Test storage -> `POST storage/test`.
- **Client rules from the contract:** every write carries a fresh uuid idempotency key (photo uploads use the `photoId`) and the state the screen saw (`expectedState`); a photo upload sets `x-sw-attempt` (1, then rising) so Drive does not create a second file on a lost reply; `stale_state` parks the outbox item and refreshes the card; `storage_misconfigured` and `storage_full` are `retryable: false` (stop auto-retry); `crew_auth_required` holds the queue (show the `reason` sentence when present); import the byte caps and the quality ladder from `photo-limits.ts`, do not copy numbers; show `last4`, never a sticker as a link; the parent name appears only on the tag card and the pickup-check response. Page-load camera: the crew path already carries `Permissions-Policy: camera=(self)`.
- **How to run without Drive (development):** leave `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` unset; with `SW_PHOTO_STORE` unset the local adapter stores files under `.santas-workshop-store/` (gitignored). Set `AUTH_SECRET` (already in `.env.local`) because the worker code and cookie keys derive from it. Create a practice session in the admin UI, Activate it (practice needs no storage test), read the code from the worker-access card. To use Drive in development set `SW_PHOTO_STORE=drive` plus the three Drive variables; production hard-fails without them. Tests use the in-memory adapter automatically (`NODE_ENV=test`). `scripts/spike-drive.ts` is a dry run until `--apply`; run it once the service account exists and record the numbers (S1: cold start, upload and download latency, whether permanent delete is allowed under the chosen shared-drive role).
- **Orchestrator:** (a) no Drive credentials exist yet, so the Drive adapter has only been exercised against a fake client: S1 is outstanding and gates Slice 2 reaching production (a real session needs a passing storage test to activate, so a misconfigured Drive fails closed, loudly, before a volunteer needs it). (b) Production needs `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_SHARED_DRIVE_ID` and `GOOGLE_DRIVE_PHOTO_ROOT_FOLDER_ID` set in Vercel, and `AUTH_SECRET` is already present (rotating it makes stored worker codes unreadable: the admin card says regenerate). (c) Phase 5 should measure the `Permissions-Policy` rule on a production build (L5) and run Chrome, iPhone Safari and Android camera checks (S3). (d) The temporary `scripts/_tmp-*` seed and cleanup helpers I used for the live checks were deleted; the scratchpad holds `smoke.mjs` and `smoke2.mjs` (the 61-assertion drivers) if QA wants to reuse them.
- Proposed DECISION/backlog text: none new beyond 121 to 125. Backlog suggestion for the orchestrator: B-new "Check storage resumable cursor" only if a session ever exceeds ~10,000 files (not expected).


## Phase 4 — Implementation (UI, Slice 2 client step) — 2026-10-12

**Owner:** ux-developer
**Status:** Slice 2: Complete; qa next. Nothing committed. Worktree `agent-a3dae9b276243994d`, Neon branch `ep-divine-boat`, server on `:3101` only (stopped by PID; `:3000` untouched).

### Summary
The worker app (`/santas-workshop/crew/[slug]`), the phone photo outbox and the Slice 2 admin controls are built on the api-developer's contract. The page gates through `requireCrew` (same gate as the API) and renders only the code screen otherwise. Gates: `tsc` clean, `pnpm lint` 0 errors (the one pre-existing `budget-context-panel.tsx` warning), `pnpm test` 279 files / 4726 tests green, `pnpm build:only` passes, 21 new e2e tests pass on `:3101` plus the 17 Slice 1 e2e tests re-run green.

### What I did
- **Crew app** (`src/components/santas-workshop/crew/`): `code-entry`, `crew-app` (view stack mirrored to `history.pushState`, 20 s poll, back button), `roster-view` (search by stuffy name plus server family-name search, step filters), `scanner` (camera, always-visible typed field, "Scan from a photo"), `scan-view` ("Tag it now" / "Find by name"), `stuffy-screen` with `tag-panel`, `check-in-panel` (snack and care note, refund Continue, "check in without a photo"), `portrait-panel` (retake replaces, current thumbnail), `pickup-panel` (name check, someone-else note, family QR), `group-panel`, `outbox-bar`, `photo-capture`.
- **Pure client logic with tests:** `outbox-core` (+`outbox-classify`, `outbox-send`, `outbox-idb`), `scan-loop`, `qr-decoder`, `photo-downscale` (+browser half), `crew-messages` (a sentence for every `CrewErrorCode`, map test), `crew-api`, `crew-ui`, `crew-app-source.test.ts` (source scans).
- **Admin** (no new pages, so the six-page gate test is unchanged): `status-controls`, `worker-code-card` (show, copy, rotate with `devices_active` repeat, pause, resume), `storage-card` (Test and Check storage, delete strays), `registrant-actions` (dismiss, refund Keep/Withdraw, withdraw with reason, practice-only go back), `manual-add-form`, `reason-dialog`, overview "Waiting for pickup" card with CSV link; `admin-actions-ui.ts` (+test pinning the status table to `checkStatusChange`).
- **Dependencies added:** `jsqr`, `qrcode`, `@types/qrcode` (Phase 2 set; `fflate` waits for Slice 4).

### Outputs
- New: `src/components/santas-workshop/crew/*`, `src/app/santas-workshop/crew/[slug]/{page,layout}.tsx`, `src/components/admin/santas-workshop/{status-controls,worker-code-card,storage-card,registrant-actions,manual-add-form,reason-dialog}.tsx`, `src/lib/santas-workshop/admin-actions-ui{,.test}.ts`, `e2e/helpers/santas-workshop-crew.ts`, `e2e/santas-workshop-crew-{entry,flow,admin}.spec.ts`.
- Changed: overview, registrants page and `registrants-table.tsx`; `admin-ui.ts` (Slice 2 paths in `ADMIN_API`; `AdminFailure` now carries `count` and `currentState`); `public-page.test.ts` (excludes the separate crew surface); `package.json`, `pnpm-lock.yaml`.

### Deviations from the design (routed by size)
Absorbed: (1) the crew app is a full-screen fixed layer so the site header and footer do not eat a phone screen; (2) the photo-door URL for the current portrait comes from the pickup card (the portrait card carries no portrait id); (3) the e2e check-in without a photo advances the card to the portrait step instead of the list.
**Routed up (not absorbed, needs api-developer or tech-lead):**
- **R1 re-tag of an already tagged stuffy is unreachable.** `TagRequest.expectedTagCode` must equal the stored full code, but no crew DTO carries it (only last4), so a client cannot send it and the server answers `stale_state`. The move path (scan on a stuffy with no sticker, confirm "Move") covers the usual fix and is tested; the UI offers no "change sticker" button, and the `confirm_replace` dialog exists but cannot be reached. Suggested fix: accept `expectedLast4` or ignore `expectedTagCode` when `confirm === "replace"`.
- **R2 pickup-check records `result: "matched"` before the name is shown**, because the name is only returned by that call. If someone else collects the worker records a second `someone_else` check with a note. If the history must say "matched" only after a human compared, the API needs a separate reveal step.
- **R3 family QR points at `familyUrl`, whose page is Slice 5.** Until then the QR leads to a 404; fine for the dry run, so qa should not read it as a defect, and Slice 5 must ship before Dec 20.

### Open questions / handoff notes (for qa, Phase 5)
- Click through at 360 px on a real iPhone and an Android phone: camera permission and `BarcodeDetector` versus `jsqr` decode of the real stickers (S3), `<input capture>` return in iOS Safari, IndexedDB outbox surviving a closed tab with photos waiting (only the offline-then-online retry is e2e-tested), and `Permissions-Policy` on a production build (L5).
- Copy the chair may want to refine: the throttle and pause sentences, the storage-down sentence ("Photos can't be saved right now. They're kept on this phone. Tell the chair."), "Name matches: mark picked up", the crew invitation text on the worker access card.
- In dev the Next.js "N" badge overlaps the bottom tab bar; it is not in production.
- The admin pickup list is a plain `<a download>` link to the CSV route.
- Leftover e2e photo folders under `.santas-workshop-store/` were removed; the folder is gitignored.
- Next agent: qa (Phase 5).

### Post-UI fix R1 (api-developer, 2026-10-12): replacing a sticker from a crew phone
`TagRequest` now accepts optional `expectedLast4` (the `last4` the roster row and cards already carry). When sent it replaces the full `expectedTagCode` check: inside the row lock the server compares it with the last four of the stored code (mismatch or no sticker -> `409 stale_state`), and the pinned UPDATE pins on the stored code read under the lock. It works on the first call too, so the UI sends `expectedLast4` (not `expectedTagCode`) with `confirm` omitted, gets `409 confirm_replace { oldLast4 }`, then repeats with `confirm: "replace"`. The collision rules are unchanged (a sticker held elsewhere is still `confirm_move` / `holder_advanced`); the full `expectedTagCode` path stays for admin callers. The history row keeps the old and new full codes (`prev_tag_code`, `tag_code`); the UI only ever shows last four. Files: `stuffy-transitions.ts`, `crew-input.ts`, `crew-contract.ts`, the tag route; tests added to `stuffy-transitions.test.ts` and `crew-input.test.ts`.


### Post-UI fix R2 (api-developer, 2026-10-12): pickup name reveal split from the check
Per the Phase 3 addendum (option b). New `POST .../crew/[slug]/stuffies/[id]/pickup-name { idempotencyKey }` -> `PickupNameResponse { parentName }`, allowed from `checked_in`/`portrait_taken` (`picked_up` -> `already_picked_up`, else `illegal_transition`), records `name_shown` (no state change; a repeat since the last revert writes no second row). `pickup-check` keeps its request, now returns `PickupCheckResponse { recorded: true }` and is 409 `name_not_shown` unless a `name_shown` newer than the last revert exists. `pickup` is unchanged; the required order is `name_shown` -> `pickup_check` -> transition, and a revert resets all three (one helper, `hasEventSinceRevert`). Carrier: `crew-contract.ts` (`PickupNameRequest/Response`, `PickupCheckResponse`, `name_not_shown` in `CREW_ERROR_CODES`). Compile-fix edits in UI files, behaviour minimal and ux-developer's to refine: `crew-api.ts` (`pickupName` path), `crew-messages.ts` and `outbox-classify.ts` (`name_not_shown`), `pickup-panel.tsx` (Show name calls `pickup-name`; "Name matches: mark picked up" records `matched` then picks up). The Phase 5 count query (pickups lacking a `name_shown` then `pickup_check` pair, expect 0) is a Phase 5 SQL check; no helper was named in code. Tests: `stuffy-transitions`, `crew-input`, `crew-queries` (error map), `crew-contract-no-contact` (name only in the tag card and `PickupNameResponse`).


### Post-routing fixes R1 and R2 (ux-developer, 2026-10-12)
- **R1 (re-tag):** `tag-panel.tsx` sends `expectedLast4` (the row's `last4`) with `expectedTagCode: null` when the stuffy has a sticker; first call without `confirm` gets `confirm_replace { oldLast4 }`, the existing replace dialog is now reachable, then the call repeats with `confirm: "replace"`. `stuffy-screen.tsx` shows a "Change sticker" button (and "Keep the current sticker") on **tagged** stuffies. Deviation: not on checked-in stuffies, because the binding rules refuse a target past `tagged` (`illegal`), so the button would only fail. e2e: change sticker, confirm, roster shows the new last four; a card made stale behind the phone's back shows "Someone else just changed this stuffy".
- **R2 (pickup):** `pickup-panel.tsx` now runs "Show the name on the order" (`pickup-name`, idempotent key), then the name with "Name matches" (records `matched`) and "Someone else is collecting" (note required, records `someone_else`); "Mark picked up" is shown disabled from the start and enabled only after a recorded choice (pure `pickupControls()` in `crew-ui.ts`, tested). `name_not_shown` sentence reworded to "name on the order". e2e: check and pickup refused before the reveal (`name_not_shown`, `pickup_check_required`), no earlier response holds the parent name, Name matches path, Someone else path with note, second tap `already_picked_up`.
- R3 untouched. Gates: tsc clean, lint 0 errors, `pnpm test` 279 files / 4746 tests, Slice 2 e2e 22 passed (entry 5, flow 11, admin 6); `:3101` stopped by PID, store folders removed. Status row stays "Slice 2: Complete; qa next".

### Post-QA fixes (api-developer, 2026-10-12)
- **D1 (build warning):** `photo-store/local.ts` now marks every `join(rootDir, ...)` with `/*turbopackIgnore: true*/` (comment in the file says why). `pnpm build:only` no longer prints "Dynamic filesystem access causes tracing of the whole project". Traced size (route `route.js.nft.json`): portrait route 1,808 files / 58.8 MB -> 173 files / 14.6 MB; photo door 1,806 / 58.7 MB -> 171 / 14.6 MB; a roster route stays 131 / 2.4 MB. The remaining ~12 MB above the others is the lazily imported `googleapis` of the Drive adapter, which production needs; behaviour is unchanged.
- **D2:** `manual-add.test.ts` phone fixture changed to a non-phone string; `git grep ... -- src` for the pre-push phone patterns prints nothing.
- **E2E file cleanup:** `cleanupSession` in `e2e/helpers/santas-workshop-crew.ts` now lists and deletes the session's stored files through the photo-store adapter (local mode only, best effort) before deleting the rows.

### Post-QA fix D3 (ux-developer, 2026-10-12)
`storage-card.tsx` now calls `router.refresh()` after Test storage (success and failure) and Check storage / delete strays, like `status-controls.tsx` and `worker-code-card.tsx`, so "Last test" and the "Photo storage tested" checklist item update without a reload. The admin e2e "Test storage" test now asserts both. tsc clean, lint 0 errors, 1348 santas-workshop-area unit tests green, admin e2e 6/6 on `:3101` (stopped by PID).

### Post-Phase-6 fixes S2-N1, N3, N4 (ux-developer, 2026-10-12)
- **S2-N1:** new `crew/check-in-thumb.tsx` renders the check-in photo (photo door, full variant) on the portrait and pickup panels, or "Checked in without a photo". The stuffy header has no photo id of its own, so those two cards are where it shows. e2e: both cards render an `<img>` with the photo-door URL that loads (naturalWidth > 0); the no-photo sentence is asserted.
- **S2-N3:** admin "Revert last step" now shows on real sessions (any state past registered); a real session offers only the previous step, practice any earlier one. It uses the existing reason dialog (a ConfirmDialog cannot take the required reason) saying the change and reason are recorded in the history. Crew-side revert stays practice-only. Unit tests updated (`admin-actions-ui.test.ts`); admin e2e reverts one stuffy on a real session with a reason.
- **S2-N4:** crew search no-match adds "Not finding it? Ask the event chair."; empty snack shows "No snack choice recorded"; the overview card says "Checked in, not yet picked up." and the CSV link reads "Download all stuffies not yet picked up (CSV)".
- Gates: tsc clean, lint 0 errors, 1351 santas-workshop-area unit tests green, crew e2e flow 11 / entry 5 / admin 7 passed on `:3101` (stopped by PID).

## Deploy record — Slice 1 shipped as v1.94.0 (orchestrator, 2026-10-12)

Pushed `6343fa6..160b090` (Slice 1 merge `d76e667`, artwork + Zeffy link `dbd0836`, lint ignore `160b090`). Pre-push on the merged tree: tsc clean; lint 0 errors after excluding `.claude/worktrees/**` (ESLint had exhausted the heap walking the worktree copy — exit 134, a gate that did not run, fixed before push); unit 246 files / 4189 tests; build PASS; e2e 380 passed, 16 skipped (the webhook spec skips without a `whsec_dev` secret), 0 failed; audit high/critical clean; PII sweeps ran and matched nothing; migrations 0113/0114 guarded.

Post-deploy, live host, about 2 minutes after the push:

| Check | Result |
|---|---|
| Unsigned `POST /api/zeffy/webhook` | HTTP 400 (route exists; signature required) |
| Anonymous `/admin/santas-workshop` | 307 to `/signin?callbackUrl=…` (proxy rule derived from the nav entry) |
| Anonymous `GET /api/admin/santas-workshop/sessions` | 401 |
| Artwork served on `/santas-workshop` | hero, og, three step icons, story art |
| Production schema (read-only) | 8 `sw_*`/`zeffy_events` tables present; `santas_workshop.manage` bound to exactly `admin, board_member` |

Still to do on the deploy checklist: board members sign out and in; create the real session and Connect campaign `1d4e4e1e-aa31-43ec-aa46-ca859c843b7e`; first signed Zeffy delivery observed on the Connect page (signature format proof); practice form + S2a spike; N5 measurement gate before Nov 8.

## Phase 4 — Implementation (API), Slice 3 "Collage" — 2026-10-13

**Owner:** api-developer
**Status:** complete (server side; ux-developer next)

### Summary
The collage's server side: the public lookup by token, the photo door's anonymous branch, the admin photos list, hide/unhide, group-photo review, and publish/unpublish. Visibility is decided in exactly one place, `decidePhotoAccess({ kind: "public" })`: the collage query reads candidate rows and filters them through it, so the page can never list a photo the door would refuse. No schema change, no migration, no email.

### What I did
- `photo-access.ts`: extracted `photoFactsFrom()` (the one row-to-facts mapper; the door, the collage and the admin list all use it). Matrix unchanged.
- `/api/santas-workshop/photos/[id]`: a request with no admin session and no valid crew cookie for that photo's session is now the **public** viewer instead of an immediate 404. Same 404 for every failure; public responses `private, max-age=300`, noindex, nosniff.
- `collage-queries.ts` `getCollage(token)` -> `CollageLookup` (`null` = unknown or malformed token, no query for a malformed one). Pure `selectCollageTiles()` for the filtering and the order (groups first, then portraits, each by capture time then id).
- `photo-admin.ts`: `listSessionPhotos`, `setPhotoHidden`, `markGroupPhotosReviewed`, `setCollagePublished`, `collageUrl`/`collageAdminInfo` (URL built from `getAppUrl()` + `COLLAGE_PATH_PREFIX`; `qrPayload` is that exact string, for the frame slice).
- Review rule without a column: `collage-review.ts`. A `group_photos_reviewed` row in `sw_session_log` holds `through` (the newest group-photo upload the admin was looking at). A group photo is reviewed when published or uploaded at or before the latest `through`. Publish is refused (409 `photos_unreviewed`, `count`) while any unhidden, unpublished group photo is not; the stamping UPDATE is also bounded by `created_at <= through`, so a photo uploaded between the check and the write stays private.
- Tokens: unchanged (created once, 128-bit, at session creation; no rotate path). Scan test: audit rows and `photo-admin.ts` never mention the token or URL and have no `console.*`.

### Outputs
Contracts (carriers): `src/lib/santas-workshop/collage-contract.ts` (public, scan-tested for no PII) and the Slice 3 section at the end of `src/lib/santas-workshop/admin-contract.ts`. New `AdminErrorCode` `photos_unreviewed` (sentence added to `admin-ui.ts`'s exhaustive switch; ux owns the final copy). Consumers grepped: `admin-ui.ts` is the only exhaustive `AdminErrorCode` switch; no `.kind ===` consumers of the new unions exist yet.

Admin routes (all `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first; `no-store`; error envelope as before):
- `GET /api/admin/santas-workshop/sessions/[id]/photos?kind=group|portrait&page=1` -> `PhotosListResponse { photos[], page, hasMore, counts, collage, sessionKind }`. `AdminPhotoDto { id, kind, takenAt, createdAt, hidden, publishedAt, reviewed, consent, stuffyName, onCollage }`; 60 per page; current photos only (superseded and purged excluded); hidden included. `counts.newestGroupAt` is what to send back as `through`.
- `POST .../sessions/[id]/photos/review` `{ through: ISO }` -> `ReviewPhotosResponse { counts, collage }` (audit `group_photos_reviewed`).
- `POST .../photos/[photoId]/hide` `{ hidden: boolean }` -> `HidePhotoResponse { photo, noop }` (audit `photo_hidden` / `photo_unhidden`; already-in-state and concurrent toggles are `noop`, no second audit row). 404 for unknown or purged.
- `POST .../sessions/[id]/publish` `{ action: "publish" | "unpublish" }` -> `PublishResponse { collage, counts, newlyPublished, noop }`; `409 photos_unreviewed` with `count`; `409 session_purged`. Audit `collage_published` (`groupPublished`, `first`) / `collage_unpublished`. Publishing with zero group photos is allowed; publishing again stamps late reviewed photos and keeps the original publish time.
- `CollageAdminInfo { url, qrPayload, published, publishedAt, reviewedThrough }` is in the list, review and publish responses.

Public data access (no route handler; the page calls it): `getCollage(token)` -> `CollageView { state: "pending" | "removed" | "live", practice, arrivesOn, tiles[{ id, kind: "group" | "portrait" }] }` or `null`. Images: `collagePhotoPath(id, "thumb" | "full")` (the photo door). No names, captions, counts or keys in the DTO.

Files: `collage-contract.ts`, `collage-queries.ts`, `collage-review.ts`, `photo-admin.ts` (new); `admin-contract.ts`, `admin-ui.ts`, `session-log.ts` (5 new kinds), `photo-access.ts`, `/api/santas-workshop/photos/[id]/route.ts` (edited); four new admin route files (photos, photos/review, publish, photos/[photoId]/hide). Tests (48 new): `collage-queries.test.ts` (consent, hidden, superseded, purged, check-in, unpublished, order, DTO shape, unknown/malformed/pending/removed/live), `collage-door.test.ts` (public viewer set equals the collage set, identical null refusals, hidden refused on the next fetch, cache headers), `photo-admin.test.ts` (audit rows, no-op, pinned-update race, publish refused with unreviewed, publish transaction, zero photos, repeat, unpublish, purged), `collage-review.test.ts`, `collage-contract-no-pii.test.ts`; `admin-routes-gate.test.ts` now also checks `collage-contract.ts` is client-safe and auto-covers the four new routes' gate. Gates: `tsc` clean, `pnpm lint` 0 errors (1 pre-existing warning), `pnpm test` 4810 passed, `pnpm build:only` clean (no dynamic-filesystem warning), no `console.log`, fixtures are `example.invalid` and the existing generated PNG.

### Deviations from the design (routed by size)
1. **Review marker (absorbed, no schema):** the design had no "reviewed" state; implemented as a session-log row (above) plus `POST .../photos/review`. About 60 lines including the route. If the tech-lead prefers a column (`sw_photos.reviewed_at`), that is a database-admin change; the log approach needs none.
2. **Pending and removed are 200 states, not 404 (design wins over the brief's wording):** the brief said unpublished and expired tokens should 404 identically; Phase 3 (Flow 9, collage section, named test "unpublished returns pending with the date; purge returns removed") says the printed QR must show "The photos arrive on [date]" before publish and "These photos have been removed" after the purge. I built the design: only an unknown or malformed token is `null` (one identical 404). Photo-door requests for unpublished or purged material are identical 404s. Flipping pending/removed to 404 is a one-line change in the page if the orchestrator rules otherwise.
3. **No JSON route for the collage:** the page (Server Component) calls `getCollage()` directly; the design lists only the page.
4. Origin guard (`isProductionOrigin`) is Slice 4's manifest; `collageAdminInfo.url` is shown as-is (a localhost URL in dev).

### Open questions / handoff notes
- **Next agent: ux-developer.** Build `/admin/santas-workshop/[sessionId]/photos` (group grid first, portraits second; hidden badge; consent badge on portraits "Not on the collage: no consent"; unreviewed count; "Mark reviewed" sends `counts.newestGroupAt` as `through` and is disabled when null; Publish disabled with the reason while `groupUnreviewed > 0`, and handle `photos_unreviewed`; Unpublish through a ConfirmDialog; show `collage.url` with copy and a QR from `collage.qrPayload`), and the public page `/santas-workshop/c/[token]` (`export const dynamic = "force-dynamic"`, noindex, `null` -> `notFound()`, pending/removed/live per the design, PRACTICE banner when `practice`, footer removal line with `CONTACT_EMAIL`, lazy thumbs with an `onError` placeholder, tap opens `full`, no download button, empty-live message). Thumbs for admin tiles come from the same door (`/api/santas-workshop/photos/[id]?v=thumb`, admin credential via the session).
- Hidden-photo cache window: 5 minutes in a browser that already loaded the image (accepted).
- Not mine, still open: the "quiet feed" and "do not strand photos" Phase 6 notes.


## Phase 4 — Implementation (UI, Slice 3 "Collage" client step) — 2026-10-13

**Owner:** ux-developer
**Status:** complete (qa next)

### Summary
The admin photos page (`/admin/santas-workshop/[sessionId]/photos`) and the public collage (`/santas-workshop/c/[token]`) are built on the api-developer's contract. Admins review group photos, hide and unhide with a confirmation, mark them reviewed, and publish or unpublish; strangers see only group pictures and consented portraits, with fixed copy and no registrant text.

### What I did
- Admin page: Server Component with `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` in its body, loads group and portrait page 1 through `listSessionPhotos`. Client island `photos-panel.tsx`: collage card (link with Copy, Open, QR from `collage.qrPayload` via `qrText`, Publish / Unpublish / "Publish late photos", status line, the `photos_unreviewed` sentence with the server count in an amber alert, four counts), group grid with "Mark group photos reviewed" (sends `counts.newestGroupAt` as `through`; disabled with the reason when none or all reviewed), portrait grid, tiles with Hidden / consent / review / "Visible to anyone with the link" chips, Hide (ConfirmDialog) / Unhide, "Show more", empty states, per-tile broken-image placeholder. After any write the loaded pages are re-fetched so markers and counts are the server's.
- Session overview: "Photos" tab added to `SessionNav` and a "Review photos" button on the overview.
- Public page: Server Component, `force-dynamic`, noindex (`robots` + `referrer: no-referrer`), `null` is `notFound()`, pending ("The photos arrive on Saturday, Dec 19" plus an evening line), removed ("These photos have been removed"), live (group pictures then stuffy portraits), PRACTICE banner, fixed lines "We photograph stuffies only, never children." and "Changed your mind? Contact the club and we will take your stuffy down." with a link to `/connect`. Grid is a client island (`collage-gallery.tsx`): lazy thumbs with width/height, tap opens the full picture in a Radix dialog, no download button, quiet placeholder on error. Alt text is ordinal ("Group picture 2"), never a name. Site header and footer are hidden on this page by a scoped `<style>` (`body > header, body > footer`), leaving only the club-name band. Print rules (`.sw-collage-*`, `.sw-noprint`, `@media print`) added to `santas-workshop.css` for the family page to reuse.
- Pure logic and copy in `src/lib/santas-workshop/collage-ui.ts` (`COLLAGE_COPY`, `publishRefusedText`, `qrText`, `reviewDisabledReason`, `publishStatusLine`, `photoMarkers`, alt helpers); `ADMIN_API` gained the four photo endpoints.

### Outputs
New: `src/app/(dashboard)/admin/santas-workshop/[sessionId]/photos/page.tsx`, `src/components/admin/santas-workshop/{photos-panel.tsx,collage-qr.tsx}`, `src/app/santas-workshop/c/[token]/page.tsx`, `src/components/santas-workshop/collage/collage-gallery.tsx`, `src/lib/santas-workshop/collage-ui.ts`. Edited: `session-nav.tsx`, overview `page.tsx`, `admin-ui.ts` (`ADMIN_API`), `santas-workshop.css`, `admin-ui-source.test.ts` (page list), `src/app/santas-workshop/public-page.test.ts` (the `collage/` component dir is excluded from the static public-page rules, as `crew/` is, because the gallery is a client island; it has its own scan).
Tests: `collage-ui.test.ts` (publish-refused copy, QR payload verbatim, review gating, markers, public copy), `collage-page-source.test.ts` (source scan plus a render of the real page with the data layer stubbed: live, pending, removed, unknown token; asserts no registrant text), `photos-panel-source.test.ts` (QR through `qrText`, two ConfirmDialogs, `photos_unreviewed` handling, `through`). E2E: `e2e/santas-workshop-collage.spec.ts` (11 tests, all pass on `:3101`: pending and unknown token, publish refused with count, markers, review then hide then publish, published page with groups and only consented portraits, hide disappears from the public page and the door, 360 px no sideways scroll on both pages, unpublish with confirmation, removed) with seeding helpers (`solidPng`, `seedStuffy`, `seedPhoto`, `collageToken`) appended to `e2e/helpers/santas-workshop-crew.ts`. Gates: `tsc` clean, `pnpm lint` 0 errors (1 old warning), `pnpm test` 287 files / 4835 tests, `pnpm build:only` passes, no `console.log`, no native dialogs, example names only. Server on `:3101` stopped by PID; the spec's `afterAll` removed its session (children cascade) and stored files.

### Deviations from the design (routed by size)
1. **`force-dynamic`, not a 5-minute `revalidate` (absorbed):** the brief asked for `revalidate` consistent with the 5-minute window; Phase 3 says the page reads the database on every request so HTML never outlives a hide. Kept the design; only images carry the 5-minute browser window.
2. **Site chrome hidden by a scoped `<style>` (absorbed, about 3 lines):** the root layout always renders `Header`/`Footer`; I did not edit shared layout components. The two shared components are untouched.
3. **Group tiles use `object-contain`, not cropped (absorbed):** capture orientation is unknown and a crop could cut a person or stuffy out of frame.
4. **Publish button stays clickable while photos are unreviewed (absorbed):** the server is the authority and its refusal (sentence plus count) is the specified behaviour; a status line states the reason beforehand. Earlier handoff suggested disabling; this keeps one source of truth.
5. **Admin tile shows the stuffy's name on portraits** (admin-only surface, as the contract allows).

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** Click through: create a practice session, add photos from the crew app (Group photo button, portraits), open Photos tab; Hide (cancel, then confirm), Unhide; Publish before review (amber refusal with count), Mark reviewed, Publish; open the copied link in a private window; scan the QR with a phone; Unpublish (confirm) and reload the link; set `public_purged_at` through the retention flow later (Slice 5) for "removed". Print preview of the published page (header band prints plain, link hidden, 3-column grid). A real iPhone check at 360 px is deferred.
- Not measured here: the 5-minute hidden-photo window (Phase 5 L3) and Drive-backed photos; I used the local store with generated PNGs.
- New copy the club may want to refine: the pending evening line, "Group pictures" / "Stuffy portraits" headings, the removal and stuffies-only lines, the two ConfirmDialog bodies, "Publish late photos".
- The collage URL shows as built by the server (a localhost URL in dev); Slice 4's origin guard applies to the frame QR.

### Post-QA fix S3-D1 (api-developer, 2026-10-13) — the newest group photo could never be reviewed
**Root cause:** the review cutoff was `max(created_at)` read into a JavaScript `Date` (milliseconds) and compared in SQL against `created_at` (microseconds), so the newest photo stayed "unreviewed" forever and Publish returned 409 `photos_unreviewed` with no visible cause.

**Fix (option a; no schema change):** a review is now recorded as the **id of the newest group photo the admin saw** (`throughPhotoId` in the `group_photos_reviewed` log row). "Reviewed" is `created_at <= (that photo's created_at)`, evaluated entirely in SQL by two fragments in `photo-admin.ts` (`reviewCutoffSql`, `reviewCoveredSql`), used by the unreviewed count, the counts aggregate, the list's per-photo `reviewed`, and the publish stamping UPDATE. No timestamp is parsed, bound or compared in JavaScript any more (`reviewedThrough` is the database's own `::text`, display only). `collage-review.ts` and its test were deleted (nothing left to parse).
- **Carrier changes:** `ReviewPhotosRequest { throughPhotoId }` (was `through: ISO`); `PhotoCounts.newestGroupPhotoId` added (`newestGroupAt` kept, display only); `CollageAdminInfo.reviewedThrough` documented display-only. The route validates a UUID and the service checks it is a group photo of this session (400 `invalid_input` otherwise).
- **Minimal UI compile-fix edits (behaviour untouched):** `photos-panel.tsx` sends `throughPhotoId: counts.newestGroupPhotoId`; `collage-ui.ts` `reviewDisabledReason` reads `newestGroupPhotoId`; the matching assertions in `photos-panel-source.test.ts` and `collage-ui.test.ts`. The chip already used the server's `photo.reviewed` boolean (`photos-panel.tsx` `Chip tone={photo.reviewed ...}`), so the UI never recomputed it. Consumers grepped: `newestGroupAt|reviewedThrough|through` across `src` and `e2e`.
- **Tests that cannot pass with millisecond truncation:** `photo-admin.test.ts` renders the SQL with drizzle's `PgDialect` and asserts the cutoff is a subselect of the stored photo's own `created_at` bound only to the session id (no `Date`/timestamp parameter exists to truncate), that the covered fragment compares the stored column to it, and that `photo-admin.ts` contains no `Date.parse`, `lte(`, `::timestamptz` or the old parse helpers; review/publish flows are re-tested around the photo-id model with a microsecond display value (`2026-12-19 14:05:00.500711+00`). There is no precedent in the repo for a branch-backed Vitest, so the DB-level proof is the e2e below, which runs against the real branch database.
- **e2e:** `uploadGroupPhoto()` in `e2e/helpers/santas-workshop-crew.ts` posts through the real `group-photos` route (admin accepted by `requireCrew`), so `created_at` is the database's `now()`. The collage spec's seed now uploads one such photo (the newest), so the first review and publish cover it (asserted "Visible to anyone with the link"), and a new test uploads a late photo, reviews once, "Publish late photos" succeeds and a stranger's door fetch is 200. Adjusted counts (3 group photos; 2 on the public page) in the affected assertions.
- **Results:** `tsc` clean; `pnpm lint` 0 errors (one pre-existing warning; I also removed an unused import I had left); `pnpm test` 4831 passed (286 files); collage e2e **12 of 12 passed** on `:3101` (started and stopped by PID, `:3000` untouched, branch host `ep-divine-boat` verified before the run). I did not re-run the spec against the pre-fix code.
- **Dev-only note:** the collage link and QR are built from `NEXTAUTH_URL` (`getAppUrl()`), so in dev they point at `:3000` unless the dev server is started with `NEXTAUTH_URL` set to its own origin (I did, for this run). Production behaviour is unchanged and correct; Slice 4's manifest origin guard (`isProductionOrigin`) is the real-session safeguard.

**Next agent:** qa re-runs `tsc`, `lint`, `pnpm test`, `pnpm build:only`, the workshop specs, the PII greps, and the live check from S3-D1 (three group photos through the crew route, Mark reviewed once, Publish, a fourth after publish, review, Publish late photos).

### Post-Phase-6 fixes S3-N1, N3, N4, N5 (ux-developer, 2026-10-13)
- **S3-N1:** admin instruction and the `photos_unreviewed` sentence now read "Hide any picture that shows a child, or anyone other than Santa, Mrs. Claus and the stuffies." (`REVIEW_INSTRUCTION` in `collage-ui.ts`, `admin-ui.ts`); the crew group prompt (`crew/group-panel.tsx`) adds "No children in frame."; the public line is unchanged.
- **S3-N3:** after an un-hide, the panel shows "This picture returns to the collage when you press Publish late photos." when the response has `needsPublish: true` (field from `admin-contract.ts`); while published, `counts.awaitingPublish > 0` shows "N pictures taken since the last publish are not yet public." (`latePicturesSentence`).
- **S3-N4:** public removal line is "Changed your mind, or see someone who should not be in a picture? Email info@westervillelions.org and we will take it down." with a `mailto:` link (address from `CONTACT_EMAIL`), plus "Or use the contact form" to `/connect`.
- **S3-N5:** pending says "The photos are being prepared" when the photo day is before today (Eastern, via `workshopNow` + `easternDateString`, computed in the page, DTO unchanged); the photo day itself still shows the date.
- Tests: `collage-ui.test.ts`, `collage-page-source.test.ts` updated; collage e2e gained "pending after the photo day" and the un-hide hint assertions. Gates: tsc clean, lint 0 errors, `vitest run src` 285 files / 4828 tests, collage e2e 13/13 on `:3101` (stopped by PID).

### Post-Phase-6 fix S3-N2 and S3-N3 (api-developer, 2026-10-13)
**S3-N2 — late portraits wait for the batch.** A portrait uploaded or retaken after the session's last publish is private to strangers until the admin presses "Publish late photos", the same rule group photos follow. One rule, one place: `decidePhotoAccess` public viewer now requires `consent && published` for a portrait (`photo-access.ts`), and both the collage query and the photo door already read it, so the page and the door agree. The publish transaction's stamping UPDATE now also stamps every unhidden, current, consented portrait (no review step for portraits); consent and hidden are unchanged. Family and crew rules are unchanged (the family sees its own retake at once). The audit detail key `groupPublished` became `photosPublished` (it counts both kinds).
**S3-N3 — `needsPublish` on hide/unhide.** `HidePhotoResponse.needsPublish` is true after an unhide of a photo that has never been published and would be on the collage (a group photo, or a consented portrait); false after a hide, for an already-published photo, an unconsented portrait or a check-in photo (`needsPublishFor()`).

**Contract change for ux-developer (`admin-contract.ts`):**
- `HidePhotoResponse { photo, noop, needsPublish: boolean }` — say "This photo will appear after you press Publish late photos" when true.
- `PhotoCounts.awaitingPublish: number` (unhidden unpublished group photos + unhidden unpublished consented portraits; group photos also need the review) and `PhotoCounts.portraitsAwaitingPublish: number` (the portrait part: retakes and new portraits after the last publish). Use these to enable or label "Publish late photos" (it is currently always enabled while published).
- `AdminPhotoDto.awaitingPublish: boolean` (per tile: unhidden, unpublished, would be on the collage once published) and `AdminPhotoDto.publishedAt` is now set for portraits too (was always null). `onCollage` already reflects the new rule, so a late portrait shows no "Visible to anyone with the link" until published.
- `PublishResponse.newlyPublished` counts group photos and portraits together.
- No change to `getCollage()` / `CollageView`; the public page just stops listing an unpublished portrait.

**Tests:** photo-access matrix model updated (portrait needs `published`) plus spot checks; `collage-queries.test.ts` (late consented portrait withheld, then shown once stamped); `collage-door.test.ts` (retake after publish: stranger null, admin served, then stamped: served); `photo-admin.test.ts` (`needsPublishFor` table, unhide returns `needsPublish: true`, hide false, already-published false, publish after a retake reports it, stamping SQL covers consented portraits and the awaiting counts exist). The new awaiting-count SQL is only source-scanned in unit tests; the e2e exercises it end to end. **e2e:** the collage late-photo test now supersedes the consented portrait and seeds a retake after publish: stranger gets 404 on it, the admin tile lacks "Visible to anyone with the link", "Publish late photos" makes it 200 and visible, and the superseded one stays 404. Gates: `tsc` clean, `pnpm lint` 0 errors, `pnpm test` all passing, collage e2e **13 of 13** on `:3101` (started and stopped by PID; branch host verified; `:3000` untouched).

## Deploy record — Slice 2 shipped as v1.95.0 (orchestrator, 2026-10-13)

Pushed `160b090..dc3c67e` (Slice 2 merge `5c97d03`). Pre-push on the merged tree: tsc clean; lint 0 errors; unit 279 files / 4749 tests; build PASS with no dynamic-filesystem warning; e2e 403 passed, 16 skipped, 0 failed; audit clean at high; PII sweeps clean (the one phone-pattern hit was this work-log quoting the removed fixture; reworded); schema and migrations unchanged since v1.94; dependencies added `jsqr`, `qrcode`, `@types/qrcode`.

Post-deploy, live host, about 2 minutes after the push:

| Check | Result |
|---|---|
| `Permissions-Policy` on `/santas-workshop/crew/<slug>` | `camera=(self)` (SW-L5 on the deployed host: PASS) |
| `Permissions-Policy` on `/santas-workshop` | `camera=()` |
| Crew page, no cookie | 200 (renders only the code screen) |
| Photo door, no cookie | 404 |
| Crew roster API, unknown slug, no cookie | 404 (identical denial) |
| Anonymous `/admin/santas-workshop` | 307 to sign-in |
| Unsigned webhook POST | 400 |

Not yet done on the live host: the Drive spike (`scripts/spike-drive.ts --apply`) and the two Drive env vars in Vercel (user to create the shared drive and service account); a real session cannot activate until Test storage passes. The real-phone pass with the chair's stickers remains deferred (S2-N6).

## Phase 4 — Implementation (API), Slice 4 Frames — 2026-10-13

**Owner:** api-developer
**Status:** complete (server side); ux-developer next

### Summary
Slice 4's server side: the frame-export manifest (persisted frame numbers, withheld hidden and portrait-less stuffies, counts, QR payload, index-CSV row data), the "mark exported" endpoint, and the production-origin guard. Compositing, zip and the index CSV are built in the browser (DECISION-124). `fflate` is added to `package.json` and the lockfile now so the ux step touches no dependencies. No schema change: `frame_number`, `frame_exported_photo_id` and the three `frame_*` session columns already existed (migration 0113).

### What I did
- Branch was already at `ab0b566` (`git merge --ff-only main`: up to date); worktree clean at start. DB host verified as the pipeline branch (`ep-divine-boat`), not printed further; no DB writes were run (tests mock the db); no server started.
- `pnpm add fflate`, then `pnpm install --frozen-lockfile` green.
- Pure modules: `frame-origin.ts` (guard), `frame-names.ts` (file prefix, `ssw-<slug>-NNN.jpg`, part names, printable-name cleaner), `frame-manifest.ts` (allocation order, plan, entries, counts, export status), `frame-export-input.ts` (request parser; kept out of the route file because a Next route may export only handlers).
- `frame-export.ts` (server-only): `buildFrameManifest()`, `markFramesExported()`, `exportedItemMatches()`.
- Routes, both `auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)` first, covered by `admin-routes-gate.test.ts`.
- Carrier additions in `admin-contract.ts`; `collage_url_not_production` added to `ADMIN_ERROR_CODES` and to the exhaustive switch in `admin-ui.ts`; `frames_exported` added to `SESSION_LOG_KINDS`.

### Outputs
**Endpoints** (gate for both: `santas_workshop.manage`; responses `Cache-Control: no-store`; errors use the `{ error, code, field? }` envelope)

| Method + path | Body | Response |
|---|---|---|
| `POST /api/admin/santas-workshop/sessions/[id]/frames/manifest` | none | `FrameManifest` (200); 404 `not_found`; 409 `session_purged`; 409 `collage_url_not_production` |
| `POST /api/admin/santas-workshop/sessions/[id]/frames/exported` | `{ items: [{ stuffyId, photoId, frameNumber }], partial? }` (max 500) | `FramesExportedResponse { marked, unchanged, rejected: stuffyId[] }`; 400 `invalid_input`; 404; 409 `session_purged` |

POST, not GET, for the manifest: it allocates numbers (the design's choice). Carrier: `src/lib/santas-workshop/admin-contract.ts` (`FrameManifest`, `FrameItem`, `FrameWithheld`, `FrameManifestCounts`, `FrameExportStatus`, `FRAME_EXPORT_STATUSES`, `FrameWithheldReason`, `FRAME_WITHHELD_REASONS`, `FRAMES_EXPORTED*`, `FRAME_WIDTH_PX` 1200, `FRAME_HEIGHT_PX` 1800, `FRAME_EXPORTED_MAX_ITEMS`).

**Manifest shape.** `qrPayload` (exact string to encode; equals `collageAdminInfo.qrPayload`), `collageUrl`, `kind`, `slug`, `frameArtKey`, `filePrefix` (sanitised, used for frame and part names; `framePartFileName()` is exported from `frame-names.ts`, client-safe), `partSize`, `lastExportAt` (ISO of the last `frames_exported` audit row, display only, null if none), `items[]` (stuffies that get a frame, in frame-number order: `stuffyId, name` as it should print, `parentFirst, parentLast, windowLabel, consent, frameNumber, fileName, portraitPhotoId, photoUrl` = same-origin door path `?v=full`, `exportedPhotoId, exportStatus` = `never | current | changed`), `withheld[]` (same base fields plus `reason: "hidden" | "no_portrait"`; `frameNumber`/`fileName` null until numbered; these are the "6 without" list and the index CSV's `no: <reason>` rows), `counts { total, withPortrait, withoutPortrait, hidden, neverExported, changedSinceExport, sinceLastExport }`. The browser builds the index CSV from `items` + `withheld` (all non-withdrawn stuffies), sorted by parent last name then stuffy.

**Rules implemented.** An exportable stuffy has a current (not superseded, not purged) portrait that is not hidden; consent is ignored. Numbers are persisted under a `FOR UPDATE` on the session row, allocated alphabetically (parent last name, stuffy name, id) from `max(frame_number) + 1` over the whole session (withdrawn stuffies' numbers included), never reassigned, one retry on a unique violation. A hidden or portrait-less stuffy gets no number until it has an exportable portrait. `exportStatus` compares the current portrait id with `frame_exported_photo_id`. `exported` stamps the photo id the browser actually used (so a retake during export reads `changed`), pinned on stuffy, session and `frame_number`, only if the value differs; it requires the photo to be a portrait of that stuffy; repeating a call is `unchanged` and writes no audit row. Audit row `frames_exported` holds counts and the partial flag only.

**Origin guard** (`frame-origin.ts`, `frameOriginAllowed`): a real session needs the collage URL to start with `https://westervillelions.org/` AND a deploy that is Vercel production or off Vercel; practice sessions are exempt (per the Phase 3 design: PRACTICE band, not for print). Dev override: `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1`, ignored when the runtime is production (`VERCEL_ENV=production`, or no `VERCEL_ENV` and `NODE_ENV=production`). The guard runs before any number is allocated. The error code is `collage_url_not_production` (the task's name; the Phase 3 table said `non_production_origin`).

**Unit tests** (all named Slice 4 server tests): `frame-manifest.test.ts` (stable numbering, alphabetical, late `max + 1`, hidden withheld, opted-out included, no-portrait listed, `sinceLastExport`, retake => `changed`, contact scan), `frame-export.test.ts` (mocked db: 404, origin refusal before allocation, numbering written once, 23505 retry, re-run writes nothing, manifest JSON contact scan, mark-exported marks/idempotent/retake marker/rejections/purged/oversize), `frame-origin.test.ts` (incl. override ignored in production), `frame-names.test.ts` (file names, sanitised prefix, name cleaning), `frame-export-input.test.ts`. The Phase 3 tests for `frame-layout`, `jpeg-dpi`, `zip-parts`, `csv-index` are browser-side pure modules and belong to ux-developer.

**Gates:** `tsc --noEmit` clean; `pnpm lint` 0 errors (1 pre-existing warning in `budget-context-panel.tsx`); `pnpm test` 291 files, 4890 tests pass; `pnpm build:only` passes, both routes listed as dynamic, no dynamic-filesystem warning; no `console.log`; fixtures use `example.invalid`.

### Deviations from the design
1. Error code is `collage_url_not_production` (task) rather than the design's `non_production_origin`.
2. No `producedAt` timestamp exists (no column named in the design). The per-stuffy marker is `exportedPhotoId` + `exportStatus`; the "last export" time comes from the `frames_exported` audit row.
3. Manifest adds `withheld[]` in place of the design's separate `withoutPortrait[]` and `hidden[]` (one list with a `reason`), and carries `fileName`/`filePrefix` so the UI never rebuilds names.
4. `counts.sinceLastExport` includes never-exported portraits (on a first export it equals the portrait count); the UI should show `changedSinceExport` as "retaken since last export" and only mention `sinceLastExport` when `lastExportAt` is not null.

### Open questions / handoff notes
- **Consumers grepped:** `grep -rn "\.code ===\|ADMIN_ERROR_CODES\|switch (code)" src/components src/lib/santas-workshop`: the only exhaustive switch over `AdminErrorCode` is `adminErrorMessage` in `admin-ui.ts` (updated); `photos-panel.tsx` compares one code by `===` and needs nothing. No component consumed the union with a ternary.
- **Next agent: ux-developer.** Build `/admin/santas-workshop/[sessionId]/frames` per the "Frame export (admin browser, laptop only)" section: dynamic `import()` of `qrcode` and `fflate`, `frame-layout.ts`, `jpeg-dpi.ts`, `zip-parts.ts`, `csv-index.ts` and their Phase 3 tests, the export-page copy for `collage_url_not_production`, and the e2e spec. Encode `manifest.qrPayload` exactly; the QR caption is the words plus `westervillelions.org`, not the token URL (ruling 10). Call `frames/exported` per part with only the produced items, using the photo id actually composited.
- To export from a local dev server for a real session, start it with `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1` (and `NEXTAUTH_URL` set to its own origin); otherwise use a practice session.
- Deploy check (carried from Slice 3): `NEXTAUTH_URL` on Vercel production must be the production origin; the guard now refuses frames if not.
- Nothing committed.

## Phase 4 — Implementation (UI), Slice 4 Frames — 2026-10-13

**Owner:** ux-developer
**Status:** complete; qa next

### Summary
The admin Frames page at `/admin/santas-workshop/[sessionId]/frames`: Prepare export (manifest, counts, withheld list, retaken indicator, origin-guard sentence), then Export frames, which composites each portrait in the browser at exactly 1200x1800, encodes JPEG at 0.92 with a 300 dpi JFIF density, zips in parts of `partSize` with `fflate`, puts an `index.csv` in every part, marks each part exported, and offers a download button per part plus a combined index. Failed frames are retried three times, listed, and can be retried as one extra zip. No chair-supplied art exists, so the default frame is drawn in code (blue border, gold rule, cream mat, title and year), with an optional `frame-art.png` overlay slot. I looked at a real exported frame (name too long truncates with an ellipsis, QR and caption present, PRACTICE band on a practice session).

### What I did
- Page, nav tab "Frames", and a "Make frames" button on the overview. Gate in the page body (`auth()` then `hasFeature(SANTAS_WORKSHOP_MANAGE)`); the page-list source test now includes it. A narrow screen shows "Use a laptop for this step".
- Pure modules (all in `src/lib/santas-workshop/`, client-safe): `frame-layout.ts` (rects, QR module maths, cover-crop, text fit), `jpeg-dpi.ts`, `zip-parts.ts`, `csv-index.ts`, `frame-export-ui.ts` (sentences, counts, index rows, retry constants).
- Browser modules (`src/components/admin/santas-workshop/`): `frame-compose.ts` (canvas painting, QR from `qrcode` module data, optional art), `frame-export-run.ts` (engine: 3 at a time, 3 tries with backoff, no retry for a missing or unreadable portrait; a part is zipped and offered only after every frame in it produced or failed), `frames-panel.tsx`.
- `ADMIN_API.framesManifest` / `framesExported` added. QR encodes `manifest.qrPayload` verbatim; caption is "Scan to see the whole day's photos" over "westervillelions.org".
- Art slot `frame-art` registered (optional, not in `SUPPLIED`); window coordinates are in its notes: portrait window x 75, y 225, 1050 x 990; name band y 1235 to 1335; QR plate x 75, y 1365.

### Outputs
New: `src/lib/santas-workshop/{frame-layout,jpeg-dpi,zip-parts,csv-index,frame-export-ui}.ts` and their `.test.ts`; `src/components/admin/santas-workshop/{frame-compose,frame-export-run}.ts`, `frames-panel.tsx`; `src/app/(dashboard)/admin/santas-workshop/[sessionId]/frames/page.tsx`; `e2e/santas-workshop-frames.spec.ts`.
Edited: `session-nav.tsx`, the session overview `page.tsx`, `admin-ui.ts` (two paths), `art-slots.ts`, `admin-ui-source.test.ts`.
Tests: frame-layout (rects inside the safe margin and non-overlapping, integer module size at least 7, quiet zone, 1200x1800, cover-crop, fit-shrink then truncate, art size), jpeg-dpi, zip-parts (round trip of 250 into 100/100/50, stored), csv-index (`produced`, comma and quote escaping, formula guard), frame-export-ui (sentence map coverage, `collage_url_not_production` and `session_purged` sentences). Gates: `tsc` clean, `pnpm lint` 0 errors (the one pre-existing warning), `pnpm test` 296 files, 4948 tests pass, `pnpm build:only` passes (page and both routes dynamic), no console output, no native dialogs. e2e on `:3101`: 5 of 5 pass (prepare 3 and 1, export, unzip: three 1200x1800 JPEGs at 300 dpi, `index.csv`, exported endpoint marks 3, next manifest all `current`, retake gives `changed` and the indicator reads 1, frame numbers unchanged, phone notice). Server on `:3101` stopped by PID.

### Deviations from the design
1. **`zipSync` at level 0, not `Zip` + `ZipPassThrough` streaming** (under 30 lines, no schema/API): a 100-frame part is built in memory once per part; simpler and deterministic. Memory is the Phase 3 estimate (about 70 MB per part), still unmeasured.
2. **Index CSV columns** are `frame_number, file_name, stuffy_name, parent_last, parent_first, window, produced, reason, photo_consent`: `produced` is `yes`/`no` with a separate `reason` column (the task brief), not the design's `no: <reason>` text. Each part's CSV holds that part's frames plus all left-out stuffies; the combined CSV holds everyone.
3. **QR size ceiling:** the layout throws if the QR would need more than 43 modules (version 6) at 7 px per module (a link over roughly 100 characters). The real link is about 50 characters (version 4).
4. Added a secondary "Export only new and retaken (N)" button and a "Retry failed" extra zip (`...-frames-retry-N.zip`), both under 30 lines of UI, using the same engine.
5. The title and year are drawn only when there is no overlay; with `frame-art.png` present it replaces the border and title but the name, QR plate and caption are still painted at the fixed positions above.

### Open questions / handoff notes
- **Click through (laptop width):** open a practice session, Frames tab, Prepare export (counts, left-out list, "Retaken since last export"), Export frames (progress line, Download part buttons, combined index), open a JPEG (Preview: 4x6 in at 300 dpi), unzip and open `index.csv`. A real session on a non-production server shows the origin sentence; for a local real-session export start the server with `SW_ALLOW_NON_PRODUCTION_FRAME_ORIGIN=1` and `NEXTAUTH_URL` set to its own origin.
- Not exercised: a multi-part run (over 100 frames), memory and time for 200 frames (L11 in the dry run), a real photo with Santa, and the chair's art overlay.
- New copy for the chair to refine: the page intro, "Left out of the zip", the title "A Visit to Santa's Workshop" with the year, and the caption lines.
- Next agent: qa (Phase 5).

### Post-QA fixes (Slice 4 UI) — 2026-10-13
- **S4-D1 (the FAIL):** the summary now counts against the run's own target (`runTarget`: full run = all items, "new and retaken" = that subset, retry = the failed subset), via `runSummarySentence()` in `frame-export-ui.ts` (unit-tested). The sentence is singular for one ("1 of 1 frame done."). Frames e2e gained a partial-export test asserting it.
- **Cleanup (a):** `loadFrameArt()` returns null without a request unless `isSupplied("frame-art")`, so no console 404.
- **Cleanup (b):** a subset export names its zips `<prefix>-frames-part-N-of-M-new.zip` (`framePartFileName(..., suffix)`; test added); retry zips stay `<prefix>-frames-retry-N.zip`. The e2e checks the `-new.zip` name.
- **"Last export" four hours off:** root cause was the manifest query, not the formatter. `max(created_at)` came back as a raw timestamptz string (`2026-10-13 05:30:00+00`), which some runtimes parse as server-local time. It is now selected as `to_char(max(...) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`, an unambiguous ISO instant, then shown through the existing `formatEasternInstant` with an "ET" label; `admin-ui.test.ts` pins a summer UTC instant to its EDT clock time. Not verified against a live non-UTC server, only the shape and the e2e label.
- Gates: tsc clean, lint 0 errors, `pnpm test` all green, frames e2e 6 of 6 on `:3101` (server stopped by PID); the spec's `afterAll` removes its session, rows and photo files.

### Post-Phase-6 fixes (Slice 4 UI) — 2026-10-13
- **S4-N2 (privacy):** `index.csv` is no longer in any zip; the engine builds no CSV (a source scan in `admin-ui-source.test.ts` pins it). The combined index is a separate "Download index (admin only)" button built in the browser, and the page says the zips hold only pictures and the index must stay off the photo counter. The per-part produced/failed counts and the failed list stay on the page. Tests: `zip-parts` now asserts a part holds only `.jpg`; the e2e asserts the same, then downloads the index and checks all four rows, the `produced` column, the escaped name and the withheld reason.
- **S4-N1:** "No. 002" in the brand serif on every frame. Deviation: bottom RIGHT of the QR block, not bottom left, because the bottom left is the QR plate and the margin below it is gone at 8 px modules. `frame-layout` test: the rect is inside the margin and disjoint from the QR plate, name, caption and photo.
- **S4-N4:** `QR_TARGET_PX` 360. A 69-character link (QR version 5) prints at 8 px per module with its 4-module quiet zone, plate 360 px ending exactly at the bottom margin (unit test builds a real QR). Densest QR that fits is still version 6 at 7 px.
- **S4-N6:** once a frame has been exported before, its file name gets the portrait's short id (`ssw-x-002-ab12cd.jpg`); the first export keeps the plain name. Done in the browser by `frameImageFileName()` (no server change), applied to the zip entries, the failed list and the index. `frame-names` test added; the e2e checks the retaken frame's name.
- **S4-N3:** copy only: the crew portrait prompt now reads "Take the portrait with Santa and Mrs. Claus. Turn the phone sideways (landscape) and leave room around the stuffy. Keep the sticker out of the shot." The guide rectangle is NOT built: the preview is letterboxed (`object-contain`) so a faithful 1050x990 overlay needs image-box measurement, well over 20 lines.
- Gates: tsc clean, lint 0 errors, `pnpm test` 296 files / 4955 tests, frames plus crew-flow e2e 17 of 17 on `:3101` (server stopped by PID, never `:3000`). A one-off look at an exported frame confirmed the layout; the temporary spec was deleted.

## Deploy record — Slice 3 shipped as v1.96.0 (orchestrator, 2026-10-13)

Pushed `dc3c67e..ab0b566` (Slice 3 merge `ab0b566`). Pre-push on the merged tree: tsc clean; lint 0 errors; unit 286 files / 4841 tests; build PASS, no dynamic-filesystem warning; e2e 416 passed, 16 skipped, 0 failed; audit clean at high; PII sweeps clean; schema and migrations unchanged; package.json diff = version only.

Post-deploy, live host, about 2 minutes after the push:

| Check | Result |
|---|---|
| Collage route, unknown token | 404 with `x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`, `cache-control: private, no-store` |
| Collage route, malformed token | 404 (identical) |
| Anonymous admin photos page | 307 to sign-in |
| Anonymous publish / hide routes | 401 |

Orchestrator defaults adopted at Phase 6 (chair to confirm, B-173): Santa and Mrs. Claus may appear in public pictures, children never; portraits uploaded after the last publish wait for "Publish late photos". Calendar reminder set for Jan 31, 2027 (public purge). Photo-night habit for the chair: press "Publish late photos" before leaving on photo night and again after pickup, because a retake removes the old portrait from the collage until the new one is published.

## Phase 4 — Implementation (API, Slice 5 server step) — 2026-10-13

**Owner:** api-developer
**Status:** complete (server step; the family page, retention UI and print stylesheet are ux-developer's)

### Summary
Slice 5's server side: the family view by token and its portrait door, the retention engine (preview, personal and public purge, practice reset) with its three admin routes, a retention status on the session overview, the B-180 check-in-photo flag on registrants, and the door now also refuses by the session purge markers (S3-N7). No schema change: `personal_purged_at`, `public_purged_at` and `sw_photos.purged_at` were front-loaded by migration 0113. Nothing emails.

### What I did
- **Family view** (`family-queries.ts`, carrier `family-contract.ts`): `getFamilyView(token)` returns `FamilyView { state: pending | removed | live, practice, stuffyName, arrivesOn, portrait: none | unavailable | available{version}, collagePath }` or null (malformed token never queries; unknown and withdrawn tokens are the same null). The portrait is the stuffy's current, unhidden portrait regardless of consent and of the publish batch, decided by `decidePhotoAccess({kind:"family"})`; the check-in photo is never read. `collagePath` only when live. `familyPortraitPath(token, variant, {download, version})` builds the door URL.
- **Family portrait door**: `GET /api/santas-workshop/family/[token]/portrait?v=thumb|full&download=1` (new route, through `servePhoto` with the family viewer; 404 on every failure; `download=1` sends `stuffy-portrait.jpg`).
- **Door hardening (S3-N7)**: `PhotoFacts` gained `sessionPersonalPurged` / `sessionPublicPurged` (set by `photoFactsFrom`, loaded by `loadPhotoRecord`). `decidePhotoAccess` refuses every portrait and group photo for every viewer, admin included, once `public_purged_at` is set, and every check-in photo or superseded retake once `personal_purged_at` is set, in addition to each photo's own `purged_at`.
- **Retention engine** (`retention.ts`, pure policy `retention-policy.ts`): `getRetentionPreview`, `purgeSession`, `resetPracticeSession`. Photos drain in batches (bytes deleted from the `PhotoStore` first, then a pinned UPDATE stamping `purged_at` and nulling both keys, or a DELETE for reset); a store failure stops the run, audits `interrupted`, and rethrows the typed `StorageError` (route: 503 with the storage code); a 25 s budget returns `done:false` with `remaining`. Only when zero photos of the scope remain does one transaction (session row `FOR UPDATE`, photo recount, pinned marker UPDATE with a rollback sentinel on zero rows) null the personal columns and set the marker; `status` becomes `purged` when both markers are set. Personal scope = check-in photos and superseded retakes + orders' buyer fields / `buyer_answers` / `window_label_raw` / `manual_reason`, stuffies' child first name / snack / note to Santa / care note / `raw_answers`, `sw_stuffy_events.note`, `zeffy_events.payload`. Tombstones kept (payment id, item key, tag code, family token, state stamps, stuffy name and description). Public scope = current portraits and group photos (`PERSONAL_PHOTO` and its SQL complement partition every photo). Eligibility is computed on the server: session `closed` and Eastern day >= scope date (string compare); anything else is 409 `not_eligible` unless `force: true` with a reason (1 to 500 characters). Reset: practice only (403 `practice_only`), no date rule, deletes bytes then photo rows, then orders (cascade to stuffies and events), nulls the session's webhook snapshots, and clears `collage_published_at` so the practice collage returns to "pending".
- **Overview**: `SessionOverview.retention: RetentionStatus` (per scope: `dueOn`, `purgedAt`, `state purged | due | blocked`, `blockers session_open | before_date`; plus `canReset`).
- **B-180**: `RegistrantDto.hasCheckInPhoto` (one SQL definition, `registrant-photo.ts`, used by the list and the single-registrant lookup) and a list filter `flag=no_checkin_photo` (checked in or later, no current check-in photo).
- **`PickupResponse.familyUrl`**: unchanged. It is the relative path `/santas-workshop/f/<familyToken>`; the token is `newToken128()` (16 random bytes, 22 base64url characters) at all three creation sites (`payment-apply.ts` x2, `stuffy-admin.ts`), unique-indexed; the pickup panel resolves it against `window.location.origin`. It resolves to a page only once ux-developer builds `/santas-workshop/f/[token]`.
- **Live check against the pipeline branch** (host verified `ep-divine-boat`, local photo store, throwaway practice session created and deleted by a scratch script, no server started): preview counts, early purge 409, personal purge (bytes gone, check-in photo stamped, buyer email and answers nulled, stuffy name and token kept), repeat is a no-op, public purge sets `status = purged`, family view turns `removed`, audit rows hold counts only, reset empties the session. Row counts on the branch are back to baseline for `sw_*`.

### Outputs
**Gates (all measured on this tree):** `pnpm exec tsc --noEmit` clean; `pnpm lint` 0 errors (1 pre-existing warning in `budget-context-panel.tsx`, not mine); `pnpm test` 300 files / 5015 tests pass; `pnpm build:only` passes with no dynamic-filesystem or other warning; no `console.log` (the only `console.error` is the pre-existing door one); no email path; no personal data in code or fixtures (`example.invalid`).

**Contracts** (carriers: `admin-contract.ts` re-exporting `retention-policy.ts`; `family-contract.ts`):
| Endpoint | Gate | Request | Response |
|---|---|---|---|
| `GET /api/admin/santas-workshop/sessions/[id]/retention/preview` | `auth()` + `SANTAS_WORKSHOP_MANAGE` | none | `RetentionPreview { sessionId, kind, today, personal: ScopePreview, public: ScopePreview, reset: ResetPreview or null }` (counts only; 404 unknown) |
| `POST .../sessions/[id]/purge` | same | `PurgeRequest { phase: "personal" or "public", force?, reason? }` | `PurgeResponse { phase, done, remaining, photosDeleted, noop, forced, retention }`; 400 `invalid_input` (phase, force, reason), 409 `not_eligible`, 503 storage codes. Call again while `done` is false |
| `POST .../sessions/[id]/reset` | same | none | `ResetResponse { done, remaining, photosDeleted, removed: {orders, stuffies, events} or null }`; 403 `practice_only`. Call again while `done` is false |
| `GET /api/santas-workshop/family/[token]/portrait?v=&download=` | token only; 404 on every failure | | image bytes, `private, max-age=300`, noindex |
| `GET .../sessions/[id]/stuffies?flag=no_checkin_photo` | same as before | | `RegistrantsResponse` (each registrant now has `hasCheckInPhoto`) |
| Server component data | none (token) | `getFamilyView(token)` in `family-queries.ts` | `FamilyLookup` (null = identical 404) |

New `AdminErrorCode` members: `not_eligible`, `practice_only` (the exhaustive switch in `admin-ui.ts` `adminErrorMessage` got two neutral cases; ux-developer owns the copy). New `SESSION_LOG_KINDS`: `purge_step`, `purge_done`, `reset`. `QueryFailure.status` gained 403.

**Consumers grepped:** `grep -rn "AdminErrorCode\|RegistrantDto\|SessionOverview" src/components src/lib` plus `tsc` (green): `admin-ui.ts` (the only exhaustive switch over error codes, fixed), `registrants-table.tsx`, `registrant-actions.tsx` (Pick types, unaffected), `admin-actions-ui.ts/.test.ts`. No ternary over a widened union found.

**Files:** `src/lib/santas-workshop/{retention.ts, retention-policy.ts, family-contract.ts, family-queries.ts, registrant-photo.ts}` (new); `{admin-contract.ts, admin-ui.ts, photo-access.ts, session-log.ts, session-queries.ts, stuffy-admin.ts}` (edited); routes `src/app/api/admin/santas-workshop/sessions/[id]/{retention/preview,purge,reset}/route.ts` and `src/app/api/santas-workshop/family/[token]/portrait/route.ts` (new), `.../stuffies/route.ts` (doc comment only). Tests (new): `retention.test.ts` (26), `retention-policy.test.ts`, `family-queries.test.ts`, `family-contract-no-contact.test.ts`; extended: `photo-access.test.ts` (purge-marker matrix), `photo-door.test.ts` (allowlist gains `retention.ts`), `session-queries.test.ts`.

**Phase 3 unit tests for Slice 5, confirmed by name:** family view by token (consent-independent portrait, collage link only when published, pending, removed, identical null for unknown/malformed/withdrawn) in `family-queries.test.ts`; family DTO contact scan in `family-contract-no-contact.test.ts`; reset refused on real, purge refused while active or before dates without force (and the Eastern-midnight edge), force needs a reason, resumability with a failing adapter delete (first run keeps progress and writes no marker, second run finishes), time-box, photos-raced, rollback sentinel, already-finished, tombstone-column scan, audit counts only, and the retention-date defaults, in `retention.test.ts` / `retention-policy.test.ts`; door refuses after `public_purged_at` (and after `personal_purged_at`) in `photo-access.test.ts`.

### Deviations from the design (routed by size)
- Absorbed (small): the photo door refuses by the session markers too, not only by `purged_at` (Phase 6 S3-N7 asked for the engine to stamp photos; the extra refusal is the "also make the door refuse" instruction). Reset also clears `collage_published_at` and nulls `zeffy_events.payload` for the session (practice data may be a real-form copy). `photosDeleted` on reset counts photo rows removed, including ones already purge-stamped (no bytes).
- Not built, by scope: the family page itself (`/santas-workshop/f/[token]` Server Component, print stylesheet, "Download portrait" link), which is what makes the pickup QR resolve; and every retention screen. Both are ux-developer's.
- The purge audit row stores the admin's typed `reason` on a forced run (the only free text in `sw_session_log`). The retention dialog copy should tell the admin not to type family names.

### Open questions / handoff notes
- **Next agent: ux-developer.** Build `/santas-workshop/f/[token]` from `getFamilyView` (states and copy mirror the collage; hidden portrait shows "This photo isn't available"; no portrait yet shows a neutral line; print stylesheet; noindex; `force-dynamic`; `familyPortraitPath(token, "full", { version })` for the image and `{ download: true }` for the link; PRACTICE banner when `practice`). Header rules for `/santas-workshop/f/:token` already exist in `next.config.ts`. Then the retention card on the session page: status per scope from `overview.retention`, preview via the GET route, a ConfirmDialog with the counts, a loop that re-POSTs while `done` is false with a progress line, the force path (reason box) only after `not_eligible`, and the practice "Reset" with its own ConfirmDialog. Use an exhaustive switch (with a `never` check) over `RetentionBlocker` and `FamilyPortrait["state"]`.
- **S2-N5 (family QR):** resolves as soon as the page exists; if it has not landed and passed qa by Dec 14 the fallback in the Phase 3 addendum (R3) stands.
- **S2-N7 / B-181 (closing warns about phones with unsent photos):** UI slice, not touched here.
- **Orchestrator:** the Jan 31, 2027 public-purge reminder and the personal-purge reminder (30 days after pickup) are still yours; nothing expires a collage by itself. Proposed DECISION-125 note: the engine is as written above; keep Proposed until the UI lands and qa has run a purge end to end.
- Not measured: a purge against the Drive adapter (local store only here); the 25 s budget against real Drive latency.



## Phase 4 — Implementation (UI, Slice 5 client step) — 2026-10-13

**Owner:** ux-developer
**Status:** complete (Slice 5; qa next)

### Summary
The family page `/santas-workshop/f/[token]` now exists, so the pickup QR resolves (S2-N5). The session overview has a Retention card (per-scope date and state, purge dialogs with a forced-reason path, resumable progress, practice reset), a "No check-in photo" count, filter and badge (B-180), and the Close dialog warns about phones that used the code in the last hour (B-181). The shared print rules carry the B-183 fixes.

### What I did
- **Family page** (Server Component, `force-dynamic`, noindex/nofollow, no-referrer, site chrome hidden, `notFound()` for the identical null): `familyModel(view, today)` in `family-ui.ts` decides every state with exhaustive `never` switches over view state and portrait state. Live shows the portrait from the family door with a "Save this portrait" link; none shows "Your stuffy's portrait is on its way"; withheld shows "This photo isn't available"; the collage link and a print-only QR appear only when published; pending shows the photo-day note (reusing the collage wording, "being prepared" after the day); removed shows the friendly line only. Footer carries "We photograph stuffies only, never children." and the club email. Print: portrait large, stuffy name, QR drawn client-side with `qrcode` from `origin + collagePath` with the frame caption words; the token never prints as text (the QR only). Client islands: portrait with broken-image fallback, print button, print QR.
- **Retention card** (`retention-card.tsx`, pure copy in `retention-ui.ts`): scope rows with Purged / Due / Not yet and the blocker reason; "Purge personal data" and "Take photos down" fetch the preview, then a destructive ConfirmDialog states what is deleted, the counts and that it cannot be undone; when blocked it requires a reason (Confirm stays disabled until typed) and says "Do not type any family's name here." A loop re-posts while `done:false` with a progress line (deleted so far, left; safety stop at 400 rounds). "Reset practice session" only when `canReset`, own destructive dialog with counts.
- **B-180**: `no_checkin_photo` added to `REGISTRANT_FLAGS`, `FLAG_LABELS`, the filter dropdown, an amber "No check-in photo" chip (`needsCheckInPhoto()`), and an overview tile linking to the filter (count via `listRegistrants`).
- **B-181**: `closeWarningText(n)`; `StatusControls` reads `activeDevicesLastHour` from GET crew-code (the same source as the rotate dialog) before opening the Close dialog and adds the amber sentence when n > 0.
- **B-183 / S3-N6**: `print:bg-none` on the collage and family gradient headers; `break-after: avoid` on h1 to h3 in the shared print rules, plus `background-image: none` on the root and a portrait height cap.
- **Pickup QR (S2-N5)**: URL logic untouched; the e2e decodes the rendered QR with jsqr and opens it (200).

### Outputs
- New: `src/app/santas-workshop/f/[token]/page.tsx`; `src/components/santas-workshop/family/{family-portrait,family-print-qr,print-button}.tsx`; `src/lib/santas-workshop/{family-ui,retention-ui}.ts`; `src/components/admin/santas-workshop/retention-card.tsx`; tests `family-ui.test.ts`, `retention-ui.test.ts`, `src/components/santas-workshop/family/family-page-source.test.ts` (renders the real page per state); `e2e/santas-workshop-family.spec.ts` (8 tests).
- Edited: admin overview page, `status-controls.tsx`, `registrants-table.tsx`, `admin-contract.ts` (flag list), `admin-ui.ts` (ADMIN_API, labels, `needsCheckInPhoto`), `admin-actions-ui.ts` (+tests), `santas-workshop.css`, collage page header, `components/ui/confirm-dialog.tsx`, `app/santas-workshop/public-page.test.ts` (exempts the `family` client islands like `collage`).
- **Gates:** `tsc` clean; `pnpm lint` 0 errors (the same one pre-existing warning); `pnpm test` 303 files / 5043 tests pass; `pnpm build:only` passes (`/santas-workshop/f/[token]` is dynamic); e2e on `:3101` (local store): the new family spec 8/8, plus `santas-workshop-crew-admin` and `santas-workshop-collage` (20/20) re-run for regressions. Dev server stopped by PID; `:3000` untouched; nothing committed; no new dependencies.

### Deviations from the design (routed by size)
- Absorbed (under ~30 lines each): `ConfirmDialog` gained an optional `confirmDisabled` prop (backward compatible) so the forced-reason dialog cannot confirm blank; overview tile row is now 5 columns; the family page also offers "Save this portrait" (download door option from the server step) and a Print button.
- Not built: no e2e for the Close warning with a live phone count (unit-tested; needs a signed-in worker phone). The 25 s time-box and the multi-round loop are exercised only by the server unit tests, since the local store finishes in one round.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** Click through: admin overview, Retention card (blocked reasons, dialogs, forced reason, progress), No check-in photo tile and filter; family page on a phone at 360 px in each state, then print preview (portrait large, QR, no gradient header, no token text); scan the pickup QR with a real phone; Close dialog with a phone signed in (warning sentence).
- **Copy the club may refine:** "Your stuffy's portrait is on its way", "Save this portrait", "See the whole day's photos", the retention dialog wording, the "Do not type any family's name here." line.
- **Decision for the chair:** the family page shows the portrait only once the collage is published (server rule: a family sees its own portrait from publish, not from pickup). Before publish the page says the photos arrive on the photo day.
- Reminders still the orchestrator's: Jan 31, 2027 public purge; personal purge 30 days after pickup.

### Post-QA fixes, Slice 5 server step (api-developer, 2026-10-13)

- **S5-D1 (family portrait waits for the collage publish).** Orchestrator ruling: a family sees its own current, unhidden portrait from the moment it exists, independent of consent and of the publish batch; only the collage link waits for publish; hidden still withheld; purged still refused. `photo-access.ts` family branch no longer requires `sessionPublished`; `getFamilyView` looks up the portrait before the pending check (removed still returns none). Contract change in `family-contract.ts`: `FamilyView.state` (`FamilyState`, `FAMILY_STATES`) is replaced by `FamilyView.collage: "pending" | "live" | "removed"` (`FamilyCollageState`, `FAMILY_COLLAGE_STATES`). `portrait` is now independent of it (available whenever it exists and is unhidden, even while `collage` is `pending`; always `none` when `removed`); `arrivesOn` is set only when `collage` is `pending`; `collagePath` only when `live`. Minimal compile-fix in `family-ui.ts` (`familyModel` now computes the block from `portrait` and the collage part from `collage`; copy and behaviour beyond that are ux-developer's) and a key rename in `family-ui.test.ts` and `family-page-source.test.ts`. Tests: `family-queries.test.ts` (pending with portrait, hidden, none), `photo-access.test.ts` (family allowed on an unpublished session; hidden, purged, other stuffy and public still refused; matrix `expected` updated).
- **S5-D2 (purged practice session could not restart).** `resetPracticeSession` now sets `status = 'draft'` and clears `personal_purged_at` and `public_purged_at` along with `collage_published_at` in the finalizing transaction. Test: "a purged practice session is returned to draft with both purge markers cleared" in `retention.test.ts`.
- Gates: tsc clean; lint 0 errors; santas-workshop, components and app test folders 83 files / 1249 tests pass.


### Post-QA fixes (ux-developer, after Phase 5 FAIL on Slice 5) — 2026-10-13
- **S5-D1 (UI side):** the family page follows the new contract (`FamilyView.collage: pending | live | removed`, portrait state independent). `familyModel()` renders the portrait whenever the portrait state allows it; only the collage link waits: pending replaces "See the whole day's photos" with "The photos arrive on <photo day>" / "being prepared"; removed shows only the friendly line. Unit tests (`family-ui.test.ts`, `family-page-source.test.ts`) cover pending-with-portrait and pending-without. `e2e/santas-workshop-family.spec.ts` line 86 now asserts the portrait is visible and the family door is 200 before any publish, with no collage link; after publish both appear.
- **S5-D2 copy:** the Reset dialog on a session with a purge marker adds "Its removal markers are cleared and the session returns to draft, so you can activate it again." (`RESET_COPY.purgedNote`; relies on the server change).
- **Print (O1):** `.sw-print-footer` (break-before/inside avoid, tighter margins) on the family and collage footers and the family portrait cap lowered to 125 mm; the e2e asserts the family print is one Letter sheet. Not measured: the collage print's page count (CSS applied only).
- **Cleanup:** deleted `.santas-workshop-store/s5-smoke-68306` (gitignored local store); dev server on :3101 stopped by PID.
- **Gates:** tsc clean; lint 0 errors; `pnpm test` passes; family e2e 8/8 and collage e2e 13/13 on :3101.

### Post-QA print fix 2 (ux-developer) — 2026-10-13
- Family print at Letter, published variant: the portrait cap went 125mm to 90mm (115mm still left 2 sheets once the header and QR block were counted), print header padding and main top padding trimmed, and the gap between the portrait and collage sections tightened. The collage footer rule is unchanged except `break-inside: avoid` (already on `.sw-print-footer`). Only `santas-workshop.css` and the family e2e changed.
- e2e: the published-state print test stretches the seeded 120x160 PNG (a real portrait is far larger) so the height cap is what limits it, then asserts exactly one PDF page. Measured content height 913px against ~964px printable.
- Gates: tsc clean, lint 0 errors, family e2e 8/8, collage e2e 13/13 on :3101 (one transient failure of collage test 3 on a combined run right after a server restart; it passed on rerun). Dev server stopped by PID; local `e2e-*` store folders removed.

### Post-Phase-6 fixes, Slice 5 server step (api-developer, 2026-10-13)

- **S5-N1 (free text survived both purges).** The `personal` scope now also nulls `sw_stuffies.description` and `withdrawn_reason` (the stuffy NAME stays as the tombstone), and removes the `reason` key from `sw_session_log.detail` for the session except on `purge_step` / `purge_done` rows (the forced-purge reason the audit needs). Already covered and re-asserted: `sw_orders.manual_reason`, and `sw_stuffy_events.note`, which is where revert, withdraw and manual-add reasons are stored (event kinds and timestamps stay). There is no separate "attention note" column. `purge_done` detail gained `logReasons` (count). The preview's stuffy count includes rows with a description or withdraw reason. Tests: new "S5-N1" case in `retention.test.ts` (set lists, name untouched, log scrub excludes purge kinds). Because a mock cannot prove the SQL, I also planted a `SENTINEL` string in the order, description, withdraw reason, event note and a log reason on a throwaway practice session on the pipeline branch and ran the real engine: no sentinel survived, name, event kind and the log row (minus `reason`) stayed; session deleted afterwards.
- **S5-N3 (nothing closes a session).** `retentionScopeStatus` now takes `pickupDate`; the event counts as finished when status is `closed` or `purged`, or the Eastern day is at least one day after the pickup day (`eventFinished()`, string compare). The blocker value stays `session_open` (no consumer change); its sentence is now "the event has not finished yet". The per-scope date rule and the force path are unchanged. `retentionStatusFor` requires `pickupDate` on its structural input (callers pass the session row). Tests updated in `retention-policy.test.ts` and `retention.test.ts` (unclosed session with pickup a day past is eligible unforced; pickup today or later is blocked; per-scope date still applies); one string in `retention-ui.test.ts` follows the new sentence. Live: an `active` session with pickup Dec 20 purged unforced on Jan 19.
- Gates: tsc clean; lint 0 errors (the one old warning in `budget-context-panel.tsx`); santas-workshop, components and app tests pass.

## Deploy record — Slice 4 shipped as v1.97.0 (orchestrator, 2026-10-13)

Pushed `ab0b566..0aff8cc` (Slice 4 merge `0aff8cc`). Pre-push on the merged tree: tsc clean; lint 0 errors; unit 296 files / 4955 tests; build PASS, no dynamic-filesystem warning; e2e 419 passed, 16 skipped, 1 failed — `ledger-approvals-history.spec.ts:1030` (sign-in callback), a file this diff does not touch, passed alone on re-run (2 passed), recorded on B-174 as the second flaky spec; audit clean at high; PII sweeps clean; schema and migrations unchanged; dependency added `fflate`.

Post-deploy, live host, about 2 minutes after the push:

| Check | Result |
|---|---|
| `POST …/frames/manifest`, anonymous | 401 |
| `POST …/frames/exported`, anonymous | 401 |
| Anonymous frames page | 307 to sign-in |
| Collage unknown token | 404 |
| Crew page | 200 (code screen) |

Still on the user: `NEXTAUTH_URL` on Vercel must be exactly `https://westervillelions.org` for real-session frames (verify in the Vercel dashboard); a test print at a photo counter before the dry run.

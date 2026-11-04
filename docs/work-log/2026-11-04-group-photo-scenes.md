# Santa's Workshop group-photo scenes (storyline titles and captions) — Work Log

> **Slug:** `2026-11-04-group-photo-scenes`
> **Surface:** mixed: admin session setup, crew phone app (group photo), public collage
> **Permission(s):** existing `santas_workshop.manage` (admin) and the crew code (volunteers) are expected to cover this; analyst to confirm
> **Estimated complexity:** medium (a day or two)
> **Pipeline mode:** Full (schema + crew API + public collage). Hard dates: dry run week of Dec 7, event Dec 18–20, 2026
> **Reserved IDs:** DECISION-128 (this feature; filed Proposed in `docs/decisions.md`). Migration number re-derived at Phase 4 start (latest on disk 2026-11-04: 0116; likely 0117). No backlog IDs reserved.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-04 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-11-04 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named | 2026-11-04 |
| 4 — Implementation | database-admin → api-developer → ux-developer (worktree + own Neon branch) | Schema step complete (database-admin); api-developer next | — | 2026-11-04 |
| 5 — Verification | qa | Complete | FAIL (2 defects, see Phase 5 report at end) | 2026-11-04 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Request (user, 2026-11-04, from the practice test)

> "for the group photos, can we preset up templates. basically, howard is going to set up a storyline and when we stage the group photos we will want to be able to choose the title and text that goes with each."

Background: "scenes" were in the original increment-2 scope (session setup: "frame art, scenes") and were dropped; group photos today are unlinked, untitled photos (`sw_photos.kind = 'group'`).

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst · **Date:** 2026-11-04 · **Status:** complete

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> An admin presets an ordered storyline of scenes (title + caption) for a session, the volunteer taps a scene before taking each group photo, and the public collage shows the group pictures as that storyline in scene order; the request is sound and small, but it makes the public collage carry admin-typed prose for the first time, so one documented invariant (the public DTO is "a photo id and a kind only") has to be changed deliberately, not by accident.

## Confirmation of the read

Your read is correct, with three refinements:

1. **Preset only on the phone.** The volunteer picks from Howard's list; they never type a title or caption. The crew surface is a shared code held by many people, and it should not be able to publish prose to a public page. "Choose the title and text" = choose a scene.
2. **A scene is a section, not a per-photo caption.** Title and caption belong to the scene; photos hold only a reference to it. Several photos can sit in one scene. Renaming a scene therefore changes the collage immediately (live reference, no snapshot).
3. **The storyline order is Howard's order, not the order photos were taken.** Today group photos sort by capture time; with scenes they group by scene position first, capture time second.

**User confirmation (relayed 2026-11-04): the public collage MUST present the storyline.** Group photos grouped by scene in scene order, each scene with its title and text, is a firm requirement and is part of Slice A, not an option or a later nicety. The design builds on the collage chrome just restyled (`src/components/santas-workshop/collage/collage-decor.tsx`, `src/app/santas-workshop/c/[token]/page.tsx`; uncommitted at the time of writing): the single "Group pictures" section in `page.tsx` is replaced by storyline sections (heading, caption, grid per scene, "Other pictures" last), while the header train, footer train, state art, noindex/force-dynamic/no-referrer and the portraits section stay as restyled. `CollageGallery` takes one scene's tiles per call (or sections as a prop). A zero-scene session renders the restyled page exactly as it does now.

Not in scope unless you say otherwise: burned-in text, per-photo captions, group-photo prints, text on the family page, and anything on the frames (frames are per-stuffy portraits and are untouched).

## Rulings (recommended defaults; each is a preference unless marked)

| # | Question | Ruling |
|---|---|---|
| 1 | Who authors scenes | `santas_workshop.manage` (existing key). No new key, no crew-code authoring path. Whether Howard holds it is a **fact** (see Open Questions, with a both-outcomes table). |
| 2 | Edit scene after photos attached | Allowed. Rename/caption edit propagates (live reference). After publish an edit is live at once; the collage is already `force-dynamic`. Admin-only, admin-typed, same trust as hide/unhide. |
| 3 | Reorder | Allowed. Up/down buttons (no drag library, works at 360px). Position is the storyline order. |
| 4 | Delete a scene with photos attached | Allowed through `<ConfirmDialog destructive>` that states the count ("3 photos in this scene will move to Other pictures"). Photos are never deleted; they fall back to no scene. Server result is the same if a delete races an upload. |
| 5 | Several photos per scene | Yes, unlimited. Within a scene: capture-time order. No "lead photo" concept in v1. |
| 6 | Photo with no scene | Allowed and required as a fallback ("Other pictures"), shown last on the collage. A session with **zero** scenes behaves exactly as today (one "Group pictures" grid, no picker on the phone). |
| 7 | Admin reassigns a photo's scene | Yes, on `/admin/santas-workshop/[id]/photos` (select per group photo, includes "No scene"). This is the safety net for a wrong tap on a busy Saturday and for photos taken before the storyline was entered. Does not touch `publishedAt`, `createdAt`, or the review gate. |
| 8 | Text displayed vs burned in | **Displayed as HTML text beside/above the photos on the collage.** Never composited into the image. Group prints are out of scope. |
| 9 | Copy practice scenes to the real session | A **button on the real session's scenes card**: "Copy scenes from another session" (title, caption, order only; never photos). Offered only when the target has no scenes (else it would silently double the list); one confirm. Not automatic at session creation, because the real session may already exist. |
| 10 | Practice reset | `resetPracticeSession` keeps scenes (configuration, like windows and frame art) and deletes the photos, so Howard can rehearse repeatedly. |
| 11 | Text policy for scenes | Plain text only. Title 1 to 60 characters, caption 0 to 280. Max 20 scenes per session. NFC-normalized, trimmed, control characters and newlines collapsed to spaces, rendered only as React text nodes (no HTML, markdown or links). Server-validated; also rejects an email-shaped string, a URL, or a 7+ digit run (obvious contact details). The editor says: "This text is public. Do not use the names of children, families or stuffies." Policy cannot be machine-enforced beyond that. |
| 12 | Banned-word list | Do not reuse the sign-up page `banned.ts` set (ticket/donation/scarcity rules are about a sales page). The collage has no price or tax claims. |
| 13 | Retention | Scene text is club copy, not personal data: the **personal purge does not touch it**; the **public purge leaves the rows** (configuration, like frame art) but the collage is in the `removed` state and serves no scenes or tiles. The purge dialog copy and the privacy page need no change. |
| 14 | Family page | No change. A family sees its own portrait and the collage link only. |
| 15 | Offline outbox | `sceneId` rides inside the queued group-photo metadata (as `GroupPhotoMeta` already carries the other fields), and the outbox label shows the scene title ("Group photo: The Sleigh Arrives"). The upload route treats a scene id that is unknown, deleted, or from another session as **no scene** and still accepts the photo (identical outcome in all three cases, so no enumeration signal). Retrying the same `photoId` is idempotent: the first stored scene wins. |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin | Add a scene (title, caption) to a session's storyline | per session, several times |
| Admin | Edit, reorder, delete a scene | during setup and rehearsal |
| Admin | Copy scenes from another session (practice to real) | once |
| Admin | See each group photo's scene on the photos page; reassign it; hide it | photo-day evening |
| Worker (crew code) | Choose a scene, then take a group photo (camera or saved photo) | repeatedly, Saturday |
| Worker | Change the scene between photos; take several photos in the same scene | repeatedly |
| Anonymous public visitor | Read the collage as a storyline: scene title, caption, pictures | once, after publish |
| Signed-in member / access-pending | nothing: no surface in this feature | n/a |

## Flows

**Flow 1 - Howard (or an admin) writes the storyline.** `/admin/santas-workshop/[id]` (new "Group photo scenes" card; or a `/scenes` subpage if Phase 3 prefers) → Add scene → title, caption → Save → appears at the end of the list → Up/Down to order → Edit/Delete as needed.
- Failure: empty title, over-length, contact-detail-shaped text: field-level error naming the limit. 20-scene cap: a sentence. Network/DB down: toast "Couldn't save the scene. Try again", form keeps its text. A second admin edited at the same time: last write wins for text; reorder submits the full id list so it can't duplicate a position.
- Empty state: "No scenes yet. Group pictures will show in one grid. Add scenes to tell the day as a story." with an "Add the first scene" button.

**Flow 2 - Worker takes a group photo in a scene.** Crew app → Group photo → scene list (large tappable rows, title with caption below it, "Other (no scene)" last) → tap a scene (stays selected for the next photo; shown as a pill above the camera and again on the preview: "For: The Sleigh Arrives") → Take / Choose a saved photo → Use photo → saved on the phone → "Group photo saved in The Sleigh Arrives. Sending..." → change scene or take another.
- When scenes exist, **Take photo is disabled until a scene or "Other" is picked** (prevents silent unsorted photos); after the first pick the choice is sticky for the session on that phone.
- Failure: camera denied, too big, storage full: unchanged messages. Scene list could not load (offline at first open): "Scenes didn't load. You can still take the photo; an admin will put it in a scene." and the photo goes in as no scene. Scene list is cached on the phone after the first successful load so a dead-signal staging area still shows it. A scene deleted or renamed while a photo sits in the outbox: the photo still sends (see ruling 15); a renamed scene shows its new title on the collage.
- Empty state (no scenes defined): panel looks exactly as today.

**Flow 3 - Admin reviews and fixes scenes before publishing.** `/admin/santas-workshop/[id]/photos` → group photos each show a scene badge → "Move to scene" select (includes No scene) → saved with a toast → review → mark reviewed → Publish.
- Failure: select shows the previous value and a toast on error. Stale scene id (deleted in another tab): 409-style message "That scene no longer exists" and the list refreshes.
- Admin sees a read-only preview of the storyline (scene title/caption with photo counts, including scenes with zero photos flagged "empty: will not show").

**Flow 4 - Visitor reads the collage.** Frame QR/link → `/santas-workshop/c/[token]` → "Group pictures" area now renders, in scene position order: scene title (heading), caption (paragraph), grid of that scene's published, unhidden pictures; then "Other pictures" (only if any exist and at least one scene is shown); then Stuffy portraits unchanged.
- A scene with **no visible picture is not rendered at all** (no empty heading, no hidden-photo hint, no storyline spoiler).
- `pending` and `removed` states print no scene text: the storyline cannot leak before publish, and is gone after the public purge.
- Failure/edge: unknown/malformed token: the same identical 404 as today. A scene whose only photos are hidden vanishes on the next load (HTML is `force-dynamic`; images keep the accepted 5-minute window).

## Permissions

- **Permission(s):** none new. `santas_workshop.manage` gates scene create/edit/reorder/delete/copy and photo reassign (each route calls `auth()` + `hasFeature()`; `admin-routes-gate.test.ts` already enforces this shape for new admin routes). Choosing a scene is part of the crew group-photo route and rides on `requireCrew()`, which already re-checks the session on every request. The crew DTO gains scene titles and captions (club copy, no contact data; `crew-contract-no-contact.test.ts` stays green).
- **Default roles:** unchanged: `admin`, `board_member`. Never `treasurer`, `member`, or an `admin.*` key.

## Adversarial pass

- **Redirects:** none introduced.
- **State shortcuts:** a crew device hitting the scene-mutation routes directly is a 401/403 (those routes are `auth()`-gated, not crew-gated). A crew device cannot read another session's scenes (the list is derived from the code's session). A scene id belonging to another session is treated as no scene (ruling 15), never an error that confirms the id exists.
- **Enumeration:** one identical outcome for unknown/deleted/foreign scene id. Public 404 behaviour unchanged.
- **Input boundaries:** server validates title/caption (ruling 11) before the DB; client limits are cosmetic. Empty title rejected; emoji and combining characters are counted by code point after NFC; RTL/zero-width characters stripped or rejected in the same validator. Public render is text nodes only: no stored XSS path.
- **Self-targeting:** n/a (no role or identity change). The nearest risk is the shared-code surface publishing text: closed by "crew picks, never types".
- **Public-leak path (the real one):** scene text is the first admin-typed prose on the public collage. Mitigations: length caps, contact-shape rejection, the editor warning, text visible to the admin in the photos-page preview before publish, and sections existing only via already-approved tiles.

## Gaps the Request Didn't Address

1. **Visibility invariant must not fork.** Scene sections must be built only from tiles that `decidePhotoAccess({ kind: "public" })` already approved (group by scene after the filter), so a scene can never reveal a photo, a count, or a title the door would refuse. No second filter on the page. `decidePhotoAccess` and the photo door do not change; `sceneId` is not a visibility fact.
2. **Documented invariant changes.** CLAUDE.md (DECISION-125 bullet) and `collage-contract-no-pii.test.ts` say the public DTO is a photo id and a kind only, and that "every sentence is a fixed string". This feature deliberately adds, per section, a scene `title` and `caption` and nothing else (no scene id needed, no photo count, no timestamps). The scan test must be amended to allow exactly those two fields from exactly one source (the scenes table), and the CLAUDE.md bullet updated. Architect to rule; tech-lead logs the decision.
3. **Spoiler/pending leak.** Scene text must not appear in `pending` or `removed` states (covered in Flow 4; needs a test).
4. **Alt text.** Current alt text is ordinal and fixed. Keep it fixed; associate the scene heading with its list via `aria-labelledby` so screen readers get the title without putting admin text in every `alt`.
5. **Sticky selection and wrong taps.** Stickiness speeds a scene with several photos but makes a forgotten switch likely; hence the always-visible "For: <scene>" pill on the preview, and admin reassign. Optional nicety for Phase 3: a "Next scene" button on the saved-confirmation.
6. **Rename after publish bypasses the review gate.** Accepted (ruling 2); stated so it is a decision, not a surprise. The admin photos page should show the exact public heading and caption beside each scene.
7. **Practice-to-real copy** is the only way Howard's rehearsed text reaches the real session without retyping (public typos risk). Ruling 9.
8. **Stale phone cache.** A phone holding yesterday's scene list can queue a photo for a scene that was deleted: handled by ruling 15; the cache refreshes on every successful load of the group panel.
9. **Seed/migration:** zero-scene sessions (all existing ones, including the live practice session) must render and behave unchanged; the migration only adds structure and a nullable reference, no data backfill.
10. **Brand/UI:** cards `rounded-2xl`, buttons `rounded-lg`, delete through `<ConfirmDialog>`, scene rows are at least 44px tall and work at 360px, gold/blue focus rings. No raw HTML, no new dependency (up/down buttons instead of drag-and-drop).
11. **Email, Google Groups, OAuth-vs-password, access-pending:** not touched. No email is sent; the crew and public surfaces never look at the member login.
12. **Concurrent working tree.** The collage page restyle (`collage-decor.tsx`, `c/[token]/page.tsx`, `collage-page-source.test.ts`) is the base this feature builds on and is uncommitted. Other uncommitted changes from other pipelines sit in files this feature must edit: `src/app/santas-workshop/c/[token]/page.tsx` and `collage-page-source.test.ts` (collage art), plus `e2e/santas-workshop-crew-flow.spec.ts` and `photo-capture.tsx` (saved-photo choice). Phase 4 should start after those are committed, or the implementer takes the working copy as the base and notes it; the migration number is re-derived at Phase 4 start; a Neon branch is needed if another pipeline is in Phase 4 at the same time.

## Out of Scope (confirm with user)

- Text burned into images, group-photo prints or an extra frame for group photos. (A PDF storybook is now IN scope as a later slice: see the Storybook PDF section.)
- A per-photo caption that differs from its scene's caption, or volunteers typing text on the phone.
- A "lead photo" per scene, drag-and-drop ordering, scene images/icons.
- Showing scene text on the family page, the frames, or the admin CSV.
- Scheduling a scene to appear at a time, or auto-assigning scenes by time of day.
- Per-scene hiding (hide the photos instead).

## Schedule and size

Dry run week of Dec 7; event Dec 18 to 20; today Nov 4. Total effort about 2 to 3 working days across the pipeline (1 table + 1 nullable column + 1 migration; about 6 admin handlers; crew contract/upload tweak; group panel picker; collage query/contract/gallery; admin card and photos-page select; amendments to 3 to 4 existing tests; new tests).

- **Slice A, the smallest thing the dry run can use (target: shipped by about Nov 25, so Howard can author and rehearse in time):** scenes table; admin card (add, edit, delete with ConfirmDialog, up/down reorder); crew scene picker with "Other" fallback and outbox metadata; server-side scene validation on upload; **public collage storyline sections (REQUIRED, user-confirmed; built on the restyled collage page)**; the CLAUDE.md/DTO-scan amendment; tests (visibility parity, pending-leak, text policy, offline outbox, foreign scene id).
- **Slice B (before Dec 14, so it is tested in the dry run's aftermath and in place before Dec 18):** admin reassign on the photos page with scene badges and storyline preview; "Copy scenes from another session"; practice-reset note and test.
- **Slice C (after A and B): the storybook PDF, shape (a) recommended; see the section below. Target Dec 11, hard Dec 16.** It depends on Slice A only.
- Cut line if time slips: B's copy button can fall back to Howard retyping, but reassign should not be cut, because it is the only recovery from a wrong tap besides hide-and-retake.

## Storybook PDF (reopened by the user 2026-11-04; Slice C, after the dry-run slice)

**Scope change to record.** The 2026-10-12 work-log decided "a purchasable or PDF book, print-on-request, the multi-scene book" out. The user has now reopened a narrower version: a **free, session-level storybook** (cover, then one page per scene: title, caption, that scene's group pictures, in storyline order) that anyone with the collage link can save as a PDF. It is not per-family, not purchasable, not emailed, and not a print API. The old ruling still stands for those; tech-lead logs the reopening as a decision. B-168 (family-page delivery by email) is unaffected.

**Rules common to both shapes (non-negotiable):**
- The book is built from `getCollage()`'s approved view only (the same scene sections the collage renders). No second query, no second filter, no new reader of photo bytes (images are fetched through the one photo door by id).
- Group pictures only. **No stuffy portraits** (consent-based, per-family), **never check-in photos**, no stuffy or family names, no photo timestamps or counts. The text is fixed strings (cover, closing line) plus the admin-typed scene text under ruling 11.
- Available only in the `live` state with at least one visible group picture; `pending` and `removed` show no book and no link (a book URL in those states answers the collage's state page or the identical 404, never scene text).
- Same posture as the collage: same token (no new credential), `noindex, nofollow`, `Referrer-Policy: no-referrer`, `force-dynamic`, and the same removal sentence ("see someone who should not be in a picture? email ... and we will take it down") on the closing page.
- A file a family has already saved cannot be recalled after a hide or a purge. This is true of any saved image today, but a book makes it more visible: the closing page and the privacy page should say "a copy you save stays on your device". The privacy page string needs a one-line addition (copy owner: the user; one string).

### Shape (a): print-friendly storybook page + browser "Save as PDF" (recommended)

A second route under the same token, `/santas-workshop/c/[token]/book` (or a `?book=1` mode of the collage page; Phase 3's call, route preferred), rendered from `getCollage()`: cover page, one scene per page (`break-before: page`, `break-inside: avoid` on the scene block), a closing page. A "Download as PDF" button on the collage (live state, only when a scene section exists) opens it; on the book page a button calls `window.print()` with a one-line instruction. Built on the existing print plumbing: `.sw-noprint` / `.sw-print-footer` in `santas-workshop.css` (already used by the family page) and the new `collage-decor.tsx` art (decor stays `sw-noprint` or becomes a small cover motif; `@page` margin 0 plus own padding so the browser's URL header/footer, which would print the token link, is suppressed in Chrome).

- **For:** no new dependency, no server rendering, no new route that touches bytes; visibility is identical by construction; reversible; testable with the existing source-scan style; works on a laptop today.
- **Against / honest limits:** the PDF comes from the family's browser. Desktop Chrome/Edge/Firefox/Safari: "Save as PDF" in the print dialog works. Android Chrome: works. **iPhone/iPad Safari is the awkward one** (Share, Print, then pinch-open the preview to save a PDF); most parents will be on phones, so the page needs a short three-step hint for iOS. Page breaks and image scaling differ a little by browser. Images in print should be the `full` variant, which the collage grid does not use (it loads thumbs), so the book route renders `full` images (eager, with width/height) and a book of ~20 pictures is a real download on mobile data: put a "This page loads all the pictures" note above the button.
- **Size:** about 1 working day (route and print CSS 0.5, button and copy 0.1, tests 0.3: no portrait/no check-in/no name strings, pending/removed produce nothing, `sw-noprint` on controls, `full` variant used). Needs a real print check in Chrome and one iPhone.

### Shape (b): a generated PDF file

(b1) **Client-side generation** (in the family's browser, like the frame export): fetch each picture through the photo door, compose pages, download a file. Needs a PDF library (new dependency, Phase 2 must evaluate; precedent: `fflate`, `qrcode`) and an embedded font for the display type. Risks: memory on phones with 20 full-size JPEGs (this is where a library tends to crash an older iPhone), no fallback if it fails, the file cannot be styled with the page's art without more work. About 2 to 3 days plus device testing.
(b2) **Server-side generation**: a new route that builds a PDF per request. The response exceeds Vercel's 4.5 MB buffered cap so it must stream; the function must read Drive bytes itself, which is **a second reader of photo bytes** unless it goes through `photo-access.ts` (and it would need its own cache/purge story: nothing may be stored, or the public purge must delete it). Fonts, memory and timeout limits apply. About 3 to 5 days plus infrastructure risk. **Not recommended.**

### Recommendation

Ship **(a)** as Slice C. It meets the stated need ("download a PDF book") for desktop and Android families immediately, with an iOS hint, at about a day, and cannot widen visibility. Revisit (b1) only if the dry run shows parents on iPhones cannot save a PDF, and only with the user's go-ahead: it is a dependency and a new failure mode, and the family-page "download your portrait" precedent already covers the "give me a file" instinct for the one picture a family actually owns.

### Schedule against Dec 18 to 20

The collage publishes Saturday evening Dec 19; families open it from Sunday Dec 20. The book must therefore be live by the evening of Dec 19 and tested before it. Slice C can only be exercised in the dry run if it lands by about Dec 11; otherwise test it on the practice collage in the week of Dec 14. Recommended landing: **Dec 11 (target), Dec 16 (hard)**. If it misses, drop the button and ship without it: the collage storyline (Slice A) stands alone and nothing else depends on the book.

Preference default (proceed unless the user objects): the book contains group pictures only, never a family's own portrait. A per-family book (their portrait plus the storyline) would hang off the family page token and is a separate follow-up.

## Open Questions

**RESOLVED 2026-11-04 (user, relayed): Howard is on the board, so he holds `board_member` and therefore `santas_workshop.manage`, and authors the scenes himself; no role change and no admin-enters-for-him path (see Phase 3, T1). Original question kept for the record:** *Does Howard have an account with the `admin` or `board_member` role (so `santas_workshop.manage`)?* Default if you do not know: assume no, and plan to grant it.

Design for both outcomes (same build either way; only a role binding differs, no code):

| Answer | What happens |
|---|---|
| Yes, Howard already holds `santas_workshop.manage` | He authors on the session page. Nothing extra. |
| No | Recommended: you (admin) enter his storyline for him from his list (zero setup, fits the 5-week window); or bind `santas_workshop.manage` to him through the existing role admin. Caution: that key also reads about 100 families' names, emails and mobiles, and a role change only takes effect after he signs out and back in (JWT features load at sign-in, plus ~60 s permission cache). Not recommended: a code-gated authoring path for the shared crew code (public prose from a shared secret). |

Preference questions, with my default (proceed unless you object):
- Scene cap 20, title 60, caption 280: confirm these are enough for Howard's storyline (his draft list would settle it).
- Collage only for the text: yes (no group prints).
- Scenes with no visible photo are hidden from the public: yes.
- Photo with no scene appears last under "Other pictures": yes.

## Handoff

- **Summary:** Verdict READY WITH NOTES. Create Phase 2 with: (a) the DTO/scan-test invariant change (Gap 2), (b) placement of scene queries/validators next to existing `santas-workshop` modules (no new dependency), (c) the public-section-from-approved-tiles rule (Gap 1).
- **Production facts:** none needed; no Verify-First block.
- **Outputs:** this Phase 1 section only. No code, commit or push.

---

# Phase 2 — Architectural Review (architect)

**Owner:** architect · **Date:** 2026-11-04 · **Status:** complete

## Verdict

**Approved with suggestions.** The shape is right: one new session-scoped table, one nullable pointer on `sw_photos`, no new permission, no new dependency, no change to `photo-access.ts`, `photoFactsFrom` or the photo door. Two documented invariants change deliberately (the public DTO and the crew DTO) and both are bounded below with the exact allowed fields and build-failing scans, so the change cannot widen silently. The suggestions are Rulings R1 to R14; the three that Phase 3 must not drop are R1 (DTO shape and the parity test), R5 (crew never writes scene text) and R12 (worktree only after the collage-art files are committed).

## Placement

Names are proposals for Phase 3; the placement rules are what is ruled.

- **Table:** `sw_scenes` in `src/lib/db/schema.ts` (beside the other `sw_*` tables) plus `sw_photos.scene_id` (nullable uuid). Session-scoped configuration like windows and frame art: `session_id` FK `ON DELETE CASCADE`; `sw_photos.scene_id` FK `ON DELETE SET NULL` so a deleted scene sends its photos to "Other pictures" in the database, not in application code. No new index on `sw_photos` (every read is already `session_id`-filtered).
- **Lib (`src/lib/santas-workshop/`, existing pattern of carrier / pure input / queries / admin writes):**
  - `scene-contract.ts` — client-safe: limits (title 1 to 60, caption 0 to 280, max 20), the admin row type, request/response types. No db, no node imports (add to the client-safe scan in `admin-routes-gate.test.ts`).
  - `scene-input.ts` — pure validator (NFC, trim, collapse control characters and newlines, strip zero-width/bidi, count by code point, reject email-, URL- and 7+-digit-shaped text). The ONLY function that may produce a title or caption value for a write.
  - `scene-queries.ts` — server reads: crew list (`id, title, caption` for one session), admin list with photo counts (admin-only), `resolveSceneId(sessionId, raw)` (returns the id only if that scene belongs to that session, else `null`).
  - `scene-admin.ts` — server writes with audit (create, update, delete, reorder, copy, reassign photo). Only module that inserts/updates/deletes `swScenes`.
  - The pure grouping function lives in `collage-queries.ts` next to `selectCollageTiles` (precedent: pure selector in the same file as the loader).
  - `session-log.ts`: add kinds `scene_created`, `scene_updated`, `scene_deleted`, `scenes_reordered`, `scenes_copied`, `photo_scene_changed`. `detail` carries ids and counts only, never title or caption text (the log is not purged, and `collage-contract-no-pii.test.ts` already pins the "ids and counts" style for photo-admin).
- **Admin routes (all behind the existing GATE regex, `SANTAS_WORKSHOP_MANAGE`, `auth()` then `hasFeature()` as the first two statements):** `api/admin/santas-workshop/sessions/[id]/scenes` (GET, POST), `…/scenes/[sceneId]` (PATCH, DELETE), `…/scenes/order` (PUT full id list), `…/scenes/copy` (POST `{ fromSessionId }`), and `api/admin/santas-workshop/photos/[photoId]/scene` (PUT). No new permission key and no role migration, so `default-role-bundles.test.ts` and `permission-migration.test.ts` are untouched.
- **Admin UI:** a **card on the existing session page** `/admin/santas-workshop/[sessionId]` (`components/admin/santas-workshop/scenes-card.tsx`), not a subpage: that page already hosts schedule, worker-code, storage and retention cards, scenes are session configuration, and `ADMIN_NAVIGATION` is untouched so the derived proxy rules are unchanged. Move to a subpage only if Phase 3 finds the page unreasonably long at 20 scenes. The photos page `[sessionId]/photos` keeps its server page and `photos-panel.tsx` client island and gains a scene badge, a "Move to scene" control and the read-only storyline preview. There is no `Select` primitive in `components/ui/`: use a native `<select>`; do not add a dependency for it.
- **Crew:** `components/santas-workshop/crew/scene-picker.tsx` rendered by the existing `group-panel.tsx`. Scene list via a **new** `GET /api/santas-workshop/crew/[slug]/scenes` (`requireCrew()` first, `no-store` through `crewOk`, session derived from the credential, never from the URL), loaded when the group panel opens, not added to the roster response (the roster is polled and the scene list is not needed there). `CrewScene` lives in `crew-contract.ts`.
- **Public collage:** storyline sections are rendered by the existing Server Component `src/app/santas-workshop/c/[token]/page.tsx` (extract a server-only `collage-storyline.tsx` beside `collage-decor.tsx` if the page grows). `CollageGallery` stays the only client island; it is called once per section. Its ordinal alt text restarts per call, so give it an optional start offset (or keep the ordinal global) so alts stay unique; the section heading is tied to its list with `aria-labelledby`.
- **Book (Slice C):** `src/app/santas-workshop/c/[token]/book/page.tsx`, a Server Component with its own `metadata` (noindex, no-referrer) and `dynamic = "force-dynamic"` (child pages do not inherit a sibling `page.tsx`'s exports). The only client code is the print button (reuse `family/print-button.tsx` or lift it to `components/santas-workshop/`; its copy string must then not be `FAMILY_COPY`).
- **Server/client split summary:** everything is a Server Component except the four islands that already need state: `scenes-card.tsx` (forms, `ConfirmDialog`, up/down), `photos-panel.tsx` (existing), `scene-picker.tsx` + `group-panel.tsx` (existing), `collage-gallery.tsx` (existing) and the print button. No `'use client'` is added to any page.
- **Dependencies:** **none.** Up/down buttons instead of drag-and-drop; the book is a print-styled route plus the browser's "Save as PDF". Evaluation of a PDF library against the project criteria, recorded so it is not re-litigated: a client-side generator (shape b1) holds up to ~20 full-size JPEGs in memory on a phone (the platform most families use) and adds bundle weight to a public page; a server generator (b2) is a second reader of photo bytes and breaches the "one photo door" invariant outright. Neither is approved. If the dry run shows iPhone parents cannot save the PDF, that comes back to Phase 2 as its own review, not as a Slice C tweak.
- **Concurrency / worktree:** confirmed, see R12.

## Invariants Touched

1. **Public DTO "a photo id and a kind only" (CLAUDE.md DECISION-125 bullet; `collage-contract-no-pii.test.ts`) — AMENDED, narrowly.** The collage is "anyone with the link", so the amendment is a closed list, not a loosening. See R1 for the exact shape. The one-line summary: the only new public strings are `title` and `caption` of scenes that contain at least one picture `decidePhotoAccess({ kind: "public" })` already approved; `CollageTile` stays exactly `{ id, kind }`; no scene id, count, position or timestamp reaches the DTO.
2. **One visibility rule — HELD.** `decidePhotoAccess`, `PhotoFacts`, `photoFactsFrom` and `photo-access.ts` are not edited. `sceneId` is not a visibility fact and must not be added to `PhotoFacts`. Scenes are grouped AFTER the single approval pass, from its output only; the page and the book add no filter.
3. **One photo door — HELD.** The book renders `<img>` tags pointing at `collagePhotoPath(id, "full")`; the visitor's browser fetches them through the door as a public viewer. No new module calls `PhotoStore.get`; `photo-door.test.ts` stays as is.
4. **Crew contract least-data (DECISION-121/122) — EXTENDED, narrowly.** The crew DTO gains `CrewScene { id, title, caption }` (club copy, no contact data) and `GroupPhotoMeta` gains optional `sceneId`. Crew gains read access to its own session's scenes and no write access to scene text. See R5.
5. **Review-before-publish gate — unchanged, with a stated gap.** The gate (newest group photo reviewed) covers pictures. Scene text edited after publish goes live at once (analyst ruling 2, accepted). The same `santas_workshop.manage` holders can already hide/unhide and publish, so this adds no new trust boundary; the gap is recorded in the proposed decision so it is a choice, not a surprise.
6. **Retention (DECISION-125) — HELD.** Scene rows are club copy, outside the personal purge; the public purge leaves them but the collage is `removed` and serves none; `resetPracticeSession` keeps `sw_scenes` and deletes photos (which now carry `scene_id`, deleted with them). Accepted residual risk: an admin who types a family name into a scene would leave it in the database after the purge. The editor warning is the only control, and the retention card copy must not claim every typed word is gone.
7. **Migrations idempotent, schema canonical — HELD.** See R10.
8. **Permissions the only gate; admin protection derived — HELD.** No new key; no `ADMIN_NAVIGATION` change; every new admin route matches the GATE regex; every new crew route calls `requireCrew()` first (`crew-routes-gate.test.ts`).
9. **Outbound email, durable claims — not touched.** No email path.
10. **No personal data in the repo — HELD.** Test fixtures use invented scene text ("The Sleigh Arrives"); no real storyline copy from Howard is committed unless it is the real, public club copy.
11. **Brand/UX:** `rounded-2xl` cards, `rounded-lg` buttons, `<ConfirmDialog destructive>` for delete (states the photo count), 44px rows, no native dialogs, no `lions-red`.

## Rulings

**R1. Public DTO amendment (rule on Q1).** Amend, do not fork. Recommended shape, which keeps a zero-scene session's DTO identical to today plus an empty array:

```
CollageTile  = { id, kind }                                  // unchanged, scan-pinned
CollageScene = { title: string; caption: string | null; tiles: CollageTile[] }   // NEW, exactly these 3 fields, no id
CollageView  = { state, practice, arrivesOn, scenes: CollageScene[], tiles: CollageTile[] }
```

`scenes` holds only scenes with at least one approved group tile, in storyline order; `tiles` keeps its present meaning for everything NOT in a scene (unscened group tiles first, then consented portraits, each by capture time then id). `pending` and `removed` return `scenes: []` before the scenes query runs. The page shows "Group pictures" as the heading when `scenes` is empty and "Other pictures" when it is not, so the zero-scene page is byte-for-byte today's page. Phase 3 may rename, but these constraints are fixed:
   - **Single approval pass.** `decidePhotoAccess(` appears exactly once in `collage-queries.ts` (scan). Grouping is a pure function over that pass's output plus a `Map<sceneId, {title, caption, position}>` built from the SAME session's scenes only. A photo whose `scene_id` is absent from that map (deleted, or foreign) falls to `tiles`; scenes are built from tiles, never the other way round, so an empty or all-hidden scene cannot render a heading, a count or a gap.
   - **Parity property test (the load-bearing one).** For random rows: the multiset of tile ids across `scenes[].tiles` plus `tiles` equals the multiset `selectCollageTiles`-style approval alone would return; no tile appears twice; no tile appears that the door would refuse (assert against `decidePhotoAccess` directly, as `collage-door.test.ts` does).
   - **Provenance.** `title`/`caption` come only from a `swScenes` select that is `eq(swScenes.sessionId, session.id)`-scoped and appears after the `removed`/`pending` early returns (source-order scan). No other table feeds public text.
   - **Test amendments, exact.** In `collage-contract-no-pii.test.ts`: (a) the banned-word scan (`caption|name|family|…`) runs on the contract with the `CollageScene` interface body removed, and a second test pins `CollageScene`'s fields to exactly `title, caption, tiles` (this is how the word `caption` is allowed in one place and nowhere else); (b) `CollageView`'s key list becomes `state, practice, arrivesOn, scenes, tiles`; (c) the existing `queries` scan keeps banning `.name\b`, `description`, storage and contact columns, and a new assertion bans `sceneId`/`scene_id` from the contract file (the id is internal to the query); (d) `collageToken` still appears once. In `collage-page-source.test.ts`: scene text must reach the page only as a React text node (no `dangerouslySetInnerHTML`, already banned) and the render test adds a storyline case, a zero-scene case (identical to today), and `pending`/`removed` cases asserting no scene text.
   - **Documentation.** CLAUDE.md DECISION-125 collage bullet and the header comment in `collage-contract.ts` change from "a photo id and a kind only" / "every sentence is a fixed string" to "a photo id and a kind per tile, plus, per scene that has a visible picture, its admin-typed title and caption (plain text, rendered as text nodes)". Proposed DECISION text is at the end of this section; tech-lead files it and edits CLAUDE.md.

**R2. Scene text authorship and policy.** Accept analyst ruling 11 as the validator spec, placed in `scene-input.ts`. Server-validated on create, update AND copy (copy re-runs the validator; there is no unvalidated write path, scan-tested: `swScenes` is written only in `scene-admin.ts` and only after `validateScene…`). Do not add DB CHECK constraints unless they are also declared in `schema.ts` (`drizzle-kit push --force` drops anything not in the schema); the validator is the gate.

**R3. Row concurrency.** Cap (20) and "copy only into an empty session" are decided under `SELECT … FOR UPDATE` on the session row inside one transaction (count then insert), pinned like the other state writes. Reorder takes the full ordered id list and 409s `scenes_changed` if the set differs from the stored set; positions are dense integers rewritten in one transaction. No unique index on `(session_id, position)` (a swap would violate it mid-transaction); ties break on `created_at, id`. Delete is one transaction: count the attached photos for the confirm dialog on GET, then delete the row (FK sets `scene_id` null).

**R4. Photo reassign.** `PUT …/photos/[photoId]/scene { sceneId | null }`: update pinned `WHERE id = $1 AND kind = 'group' AND purged_at IS NULL`, scene validated to belong to the photo's session, rollback sentinel on zero rows, audit `photo_scene_changed` (ids only). It never touches `published_at`, `created_at`, `hidden_at` or the review gate. A stale scene id is 409 `scene_gone`, with the list refreshed by the client.

**R5. Crew can read scenes, never author them (rule on Q2).** Structural, not by convention:
   - **Read:** `CrewScene { id, title, caption }` only; list scoped by the credential's session. Add to `crew-contract-no-contact.test.ts`: `title` and `caption` appear only in `CrewScene`; `CrewScene` is exactly `id, title, caption`; the contract still contains no `email|phone|mobile|zeffy`. These words are club copy so the existing scans pass, but the new holder test keeps them from spreading to roster/tag/pickup cards.
   - **Write:** a scan that no file under `app/api/santas-workshop/crew/**`, `crew-*.ts` or `components/santas-workshop/crew/**` contains `insert(`, `update(` or `delete(` against `swScenes`, and none imports `scene-admin`. The only crew-supplied scene datum is a UUID on a group upload.
   - **Upload:** `sceneId` is parsed by a separate `parseGroupSceneId(meta)` called only by the group-photos route (not folded into `parsePhotoMeta`, which check-in and portrait uploads share; a stray `sceneId` on those is ignored). The route resolves it with `resolveSceneId(session.id, raw)` and stores the result. Unknown, deleted, foreign and malformed all yield `null` with the same 200 and the same body (no enumeration signal; analyst ruling 15). `GroupPhotoResponse` does not echo the scene.
   - **Commit:** `commitGroupPhoto` gains an optional `sceneId`; to avoid a delete-during-upload race failing the photo on a foreign-key error, the insert resolves the scene in the same statement (or catches Postgres `23503` and retries once with `null`); a scene problem must never fail or lose a photo. `onConflictDoNothing` already makes the first stored scene win on a retry of the same `photoId`.
   - **Admin-uploaded group photos** (if the admin photos route accepts uploads) take the same optional `sceneId` through the same resolver.

**R6. Offline outbox (rule on Q3).** `sceneId?: string | null` rides in `GroupPhotoMeta` inside the existing IndexedDB `OutboxItem.meta` JSON blob, keyed by `photoId`. No IndexedDB schema/version bump (the object store has no index on meta). The outbox `label` ("Group photo: The Sleigh Arrives") is a local display string and must never be sent in the request (assert in `outbox-send` tests, as for other labels). An item queued before this deploys has no `sceneId` and uploads as unscened. The scene picker's last choice and the cached scene list are per-device, keyed by session slug, held in `localStorage` behind try/catch (the accessor can throw or be empty), cleared where the app already clears crew state on sign-out, and the group panel must render and work with the cache absent. No new outbox outcome in `outbox-classify` is needed because the route never refuses on scene. Stale cache after a scene is deleted: the photo still uploads (R5) and lands in "Other pictures".

**R7. Book route is a second page over the same approved view (rule on Q4).** `/santas-workshop/c/[token]/book` calls `getCollage(token)` and nothing else: no `@/lib/db`, no `photo-access`, no `photo-store`, no second query, no filter. It renders `view.scenes` (scene order, one scene per page) and never `view.tiles` portraits; whether unscened group pictures appear (an "Other" page) is a Phase 3 copy choice and, if included, they come from the group-kind tiles of `view.tiles` only. Rules the source-scan test must pin (extend `collage-page-source.test.ts`, which already scans the `collage/` directory, to the book page): imports only `getCollage` and UI/copy modules; contains no `portrait`-kind rendering, no `check_in`, no `.name`; `state !== "live"` or `scenes.length === 0` redirects to the collage page (which then shows the pending/removed state) and never renders scene text; invalid token is `notFound()` like the collage; `noindex, nofollow`, `referrer: no-referrer`, `force-dynamic` present in the book page itself; not listed in `sitemap.ts`/`robots.ts`; the print-only CSS uses `@page` inside a route-scoped `<style>` (the global `@page { margin: 12mm }` in `santas-workshop.css` is shared with the family page and must not be edited for the book); controls carry `sw-noprint`; the token link is not printed (page header/footer suppression is best-effort in browsers; the visible text must not contain the URL). The "Download as PDF" button on the collage appears only in `live` with at least one scene. Images in the book use the `full` variant through the door.

**R8. Retention and the book.** A saved PDF cannot be recalled. Privacy-page one-liner ("a copy you save stays on your device") is a required deliverable of Slice C; `app/privacy/workshop-section.test.ts` pins that page, so the string and its test move together.

**R9. Where the storyline preview gets its data.** The admin storyline preview (scene title/caption with photo counts and "empty" flags) is an admin-only query in `scene-queries.ts`; it must not call `getCollage` (which returns nothing before publish and would create a second consumer of the public view) and must not be imported by any `collage-*` module (scan). Counts exist only on admin surfaces.

**R10. Migration (idempotent; the number is a placeholder).** Next free on disk is `0117` as of this review (`0116_ledger_sweep_batches.sql` is the latest); **treat any number in this section as tentative: database-admin re-derives it with `ls drizzle/migrations/*.sql | sort | tail -3` at Phase 4 start.** Content, all in the 0113 idiom: `CREATE TABLE IF NOT EXISTS sw_scenes (id uuid PK DEFAULT gen_random_uuid(), session_id uuid NOT NULL, title text NOT NULL, caption text, position integer NOT NULL DEFAULT 0, created_at/updated_at timestamptz NOT NULL DEFAULT now())`; `CREATE INDEX IF NOT EXISTS` on `(session_id, position)`; `ALTER TABLE sw_photos ADD COLUMN IF NOT EXISTS scene_id uuid`; the two foreign keys added inside guarded `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)` blocks with the exact names drizzle derives (`sw_scenes_session_id_sw_sessions_id_fk`, `sw_photos_scene_id_sw_scenes_id_fk`, both far under 63 characters, so the B-165 truncation drift does not apply). No data backfill, no role binding, no seed. It is additive and nullable, so the deploy order (migrate, then push, then build) is safe and existing sessions, including the live practice session, behave unchanged. `schema.ts` is edited first; the migration matches it.

**R11. Photo door and `photo-access.ts` do not change (rule on Q5).** Add one scan to `photo-access.test.ts` or `photo-door.test.ts`: `photo-access.ts` contains no `scene`. `photoFactsFrom` and `PhotoFactsSource` are unchanged; the collage query may select `swPhotos.sceneId` for grouping, but it must not pass it into `photoFactsFrom`.

**R12. Concurrent pipelines (confirm).** Yes: Phase 4 adds a migration, so it runs in `isolation: "worktree"` with its **own Neon branch** and its own `.env.local` copy (CLAUDE.md "Concurrent Pipelines" 2 and 5). Create the branch from the dev project's non-production parent and compare the host before any write (`neonctl connection-string <branch-id> --project-id … --pooled`, branch id positional; the `--branch-id` flag silently returns the production endpoint). Two ordering conditions for the tech-lead and orchestrator:
   - **A worktree is created from the committed HEAD and will not contain uncommitted work.** The collage-art changes (`collage-decor.tsx` untracked, `c/[token]/page.tsx`, `collage-page-source.test.ts`) are the base this feature edits, and the saved-photo change (`photo-capture.tsx`, `e2e/santas-workshop-crew-flow.spec.ts`) is in the files the scene picker and the dry-run e2e touch. So the orchestrator must **commit** those (pushing is not required for the worktree, but it is for deploy) **before** the Phase 4 worktree is created; otherwise the implementer starts from stale `page.tsx` and a hand-merge is guaranteed. If they cannot be committed in time, start Slice A's non-colliding parts (migration, schema, `scene-*` modules, admin routes and card, crew route) and hold the collage page and picker edits until the base lands.
   - **No collision with the festive frame** (`frame-layout.ts`, `frame-compose.ts` and their test): this feature touches neither. Do not let the implementer "fix" them.
   - Per rule 2, the migration file must not be added to the main tree until the owner's schema step completes; the worktree contains it from the start, and the main tree's dev server must not pick it up before the push.
   - Soft cap: this is one pipeline past Phase 3 plus whatever else is in Phase 4; if another pipeline with a migration is also in Phase 4, each needs its own branch (not shared).

**R13. Slicing (agree, with one reorder).** Slice A as the analyst wrote it, with R1 and R5 as acceptance criteria. Slice B's photos-page reassign is the recovery path for a wrong tap, so it ships with A if the schedule allows (it needs only `PUT …/photos/[photoId]/scene`, a select and a badge); the copy button and storyline preview may trail. Slice C depends on A and R7 only. Cut order if time slips: Slice C button first, then copy-scenes, then the preview; never the reassign.

**R14. Docs touched at ship time (tech-lead/orchestrator).** CLAUDE.md: the collage bullet (DTO sentence), the crew bullet (scene list read, no authoring), the retention bullet (scenes kept, reset keeps them), directory notes for `sw_scenes`; release notes; `docs/decisions.md` entry below. No new env var.

## Notes for Phase 3

- Open fact, not blocking: whether Howard holds `santas_workshop.manage` (admin or board_member). The design is identical either way; if not, the admin enters his list. Do NOT widen the key or invent a crew-code authoring path; the key also reads about 100 families' names and contact details.
- Working-tree state at review time (git status 2026-11-04): **uncommitted and unpushed** and relevant to this feature: `src/components/santas-workshop/collage/collage-decor.tsx` (untracked), `src/app/santas-workshop/c/[token]/page.tsx`, `src/components/santas-workshop/collage/collage-page-source.test.ts` (collage art, this feature's base); `src/components/santas-workshop/crew/photo-capture.tsx` and `e2e/santas-workshop-crew-flow.spec.ts` ("Choose a saved photo", which the scene picker sits beside and the e2e group-photo step shares); `frame-layout.ts`, `frame-layout.test.ts`, `frame-compose.ts` (festive frame, no overlap). The orchestrator expects to push these before Phase 4; see R12 for why commit-before-worktree matters more than the push. The design doc should name which version of each file Phase 4 assumes.
- The existing collage render test asserts the live page order (Group pictures, then Stuffy portraits) and reads the stubbed view's `tiles`; adding `scenes` to `CollageView` makes the stub type-fail until updated. Update the stub and add the new cases rather than loosening the type.
- `publicTileAlt(kind, i)` is ordinal per call; with per-scene galleries the same "Group picture 1" repeats. Fix with an offset so alts stay fixed strings and unique.
- Scene captions are plain text rendered in React text nodes; headings are `h2` with ids for `aria-labelledby`. Do not render captions inside `alt`, `title` attributes, `<title>` or metadata.
- The editor's public-text warning ("Do not use the names of children, families or stuffies") is a required string; it cannot be machine-enforced beyond the validator's shape checks.
- Export/index CSV, frames, family page and `retention-ui` copy: unchanged.

## Proposed DECISION (for tech-lead to file; number to be reserved by the orchestrator, next free appears to be DECISION-128)

**DECISION-NNN: Santa's Workshop group-photo scenes: the public collage carries admin-typed scene title and caption for scenes that have an approved picture, and nothing else**

**Status:** Proposed (Phase 2, 2026-11-04). **Design:** `docs/work-log/2026-11-04-group-photo-scenes.md`. Amends DECISION-125 (collage DTO and "every sentence is a fixed string") and extends DECISION-121/122 (crew contract). Reopens, narrowly, the 2026-10-12 "no multi-scene book" ruling for a free session-level storybook that is a print-styled page (no PDF library).

**Context.** The practice test asked for preset titles and text for each staged group photo. A scene is a session-level section (title, caption) with an order; group photos hold only an optional reference to one. The public collage must present the storyline. That makes the collage carry admin-typed prose for the first time, against the documented rule that its DTO is "a photo id and a kind only".

**Decision.**
1. New table `sw_scenes` (session-scoped configuration) and nullable `sw_photos.scene_id` (`ON DELETE SET NULL`). No new permission: `santas_workshop.manage` authors scenes; the crew code can choose a scene on a group upload and read its session's scene list, and can never create, edit or delete scene text.
2. The public DTO grows exactly one type: `CollageScene { title, caption, tiles }`, present only for scenes with at least one picture that `decidePhotoAccess({ kind: "public" })` already approved. `CollageTile` stays `{ id, kind }`. No scene id, count, position or timestamp is public. Scenes are grouped after the single approval pass from its output only; `decidePhotoAccess`, `PhotoFacts` and the photo door are unchanged and `sceneId` is not a visibility fact. `pending` and `removed` carry no scene text.
3. Scene text is plain text (title 1 to 60, caption 0 to 280, at most 20 per session), validated server-side in one module, rejecting email-, URL- and 7+-digit-shaped text, rendered only as React text nodes, and stored in the audit log never (ids and counts only).
4. Text edited after publish is live at once; the review-before-publish gate covers pictures only. Accepted: same trust as hide/unhide.
5. Retention: scenes are club copy; the personal purge does not touch them; the public purge leaves the rows and the collage serves none; practice reset keeps them. Accepted residual: a family name typed into a scene by an admin would persist in the database after purge; the editor warns and the retention card must not overclaim.
6. Storybook: `/santas-workshop/c/[token]/book`, a second Server Component page over `getCollage()`'s approved view; group pictures only, never portraits or check-in photos; images via the one photo door at the `full` variant; non-live or scene-less redirects to the collage; same token, noindex, no-referrer, force-dynamic. No PDF dependency (client generation risks phone memory; server generation would be a second reader of photo bytes). The privacy page gains "a copy you save stays on your device".

**Consequences.** `collage-contract-no-pii.test.ts` is amended to an allow-list (exactly the three `CollageScene` fields), plus a parity property test that the grouped output equals the approved set. `crew-contract-no-contact.test.ts` gains the `CrewScene` holder test and a no-write scan. CLAUDE.md DECISION-125, DECISION-121/122 and retention bullets are updated at ship time.

## Handoff

**Owner:** architect · **Status:** complete

### Summary
Verdict **Approved with suggestions**. Scenes table, admin card, crew picker and collage sections are placed inside the existing `santas-workshop` modules with no new dependency and no change to `photo-access.ts` or the photo door. The public and crew DTO amendments are bounded by exact field lists and build-failing scans (R1, R5). Phase 4 must run in a worktree with its own Neon branch, created only after the collage-art and saved-photo changes are committed (R12).

### What I did
- Read CLAUDE.md Santa's Workshop bullets and the Phase 1 section; read the collage contract, query, page and scan tests, crew contract and no-contact scan, group-photos route, photo service, photo-access, session-log, retention reset, admin and crew route-gate tests, group panel and outbox.
- Ruled on placement, server/client split, dependencies, the five invariants named in the brief, migration shape, slicing and concurrency.

### Outputs
- This section of `/Users/cshenso/git/westervillelions/docs/work-log/2026-11-04-group-photo-scenes.md`. No code, no commit, no push.
- Proposed DECISION text above (not filed in `docs/decisions.md`; the tech-lead files it per the concurrent-pipelines filing rule).

### Open questions / handoff notes
- Howard's role (`santas_workshop.manage`): user to answer; no design impact.
- Orchestrator: commit the collage-art and saved-photo files before creating the Phase 4 worktree; reserve a DECISION id and a Neon branch.
- Tech-lead: decide card vs subpage (default card), the final field names in R1, whether the book includes an "Other" page, and the exact `@page` handling for the book; name the Phase 4 split (database-admin, then api-developer, then ux-developer, per CLAUDE.md for schema + API + UI).

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead · **Date:** 2026-11-04 · **Status:** complete
**Design basis (working-tree state this design assumes):** the collage-art files (`collage-decor.tsx`, `c/[token]/page.tsx`, `collage-page-source.test.ts`), `photo-capture.tsx` ("Choose a saved photo") and `e2e/santas-workshop-crew-flow.spec.ts` as they sit uncommitted on 2026-11-04, **committed by the orchestrator before the Phase 4 worktree is created** (R12). The festive-frame files (`frame-layout.ts`, `frame-compose.ts`, `frame-layout.test.ts`) are not touched by this feature.

## Rulings that differ from Phase 1/2 (read first)

Everything not listed here is as Phase 1 (rulings 1 to 15) and Phase 2 (R1 to R14) say.

| # | Phase 1/2 said | Phase 3 ruling | Why |
|---|---|---|---|
| T1 | Open question: does Howard hold `santas_workshop.manage`? | **Resolved by the user (relayed 2026-11-04): Howard is on the board, so he holds `board_member` and therefore `santas_workshop.manage`, and authors the storyline himself in admin.** No role change, no admin-enters-for-him path, no new key. The question is dropped. Go-live note below. | User answer. |
| T2 | R5: the group-photos route resolves `sceneId` with `resolveSceneId(session.id, raw)` before the commit | **The route only parses a UUID (`parseGroupSceneId`); the scene is resolved inside the INSERT** (`scene_id = (SELECT id FROM sw_scenes WHERE id = $1 AND session_id = $2)`), and `commitGroupPhoto` retries once with `null` on Postgres `23503`. `resolveSceneId` still exists, for the admin reassign path only. | One statement means no window between "resolve" and "insert", and unknown, deleted and foreign ids are identical by construction (all store `null`). The retry covers the only remaining race (a delete committed between the sub-select snapshot and the FK check). |
| T3 | Phase 1 put admin reassign in Slice B; R13 said "ships with A if the schedule allows" | **Reassign ships in Slice A** (last task of A). Copy-scenes and the storyline preview stay in Slice B. | It is the only recovery from a wrong tap on photo day, and the dry run (Dec 7) should exercise it. Cost is one route, one select, one badge (about 60 lines). |
| T4 | R3: "count the attached photos on GET" for the delete confirm | There is **no per-scene GET**. The list endpoint carries `photoCount` per scene; the confirm dialog reads the count from the list the card already holds, and the DELETE response returns the authoritative `movedPhotos`. The dialog says "about" nothing: it states the count it has and the toast states the real one. | One fewer route; a count that is a minute stale is harmless because the outcome (photos fall to Other pictures) is the same. |
| T5 | R7: whether the book has an "Other" page is a Phase 3 copy choice | **No "Other" page.** The book is the storyline only: scenes in order, each with at least one visible picture. Unscened pictures stay on the collage only. | A wrong-tap photo should not end up in a keepsake; it keeps the book's "one scene per page" shape; it removes the only reason the book would read `view.tiles`. If the book has no scene, it redirects. The book therefore reads **`view.scenes` only** (a scan pins "no `view.tiles`"). |
| T6 | Phase 1 ruling 6: "Take photo is disabled until a scene or Other is picked" | Same, with two precisions: (a) **both** capture buttons ("Take group photo" and "Choose a saved photo") are disabled, with the reason visible under them ("Pick a scene first."); (b) if the scene list could not be loaded **and** there is no cached list, nothing is disabled and the photo goes in unscened (Phase 1 failure message). A cached list that is stale is used as-is. | Matches Flow 2; (b) is the offline path. |
| T7 | R6: localStorage for the sticky choice and cached list "where the app already clears crew state on sign-out" | The crew app **does not use localStorage today** (grep: none under `components/santas-workshop/crew/`; the outbox is IndexedDB). So a new small module `scene-store.ts` owns both keys, every access in try/catch, and the crew app's existing auth-lost path (`crew_auth_required` handling in `crew-app.tsx`) clears them. Keys: `sw-scenes:<slug>` (`{ savedAt, scenes }`) and `sw-scene-choice:<slug>` (`<sceneId>` or `none`). | R6's premise (an existing clear point) was wrong; this is the smallest honest version. |
| T8 | R1 listed `CollageGallery` taking sections "or a start offset" | `CollageGallery` gains two **optional** props: `startIndex` (default 0; the ordinal in `publicTileAlt` becomes `startIndex + i`, so alt text stays fixed and unique across the whole page) and `testId` (default `collage-${kind}`). Scene lists pass `testId="collage-scene"`; the unscened list keeps `collage-group`. A zero-scene page is therefore byte-identical to today's. | Keeps existing e2e selectors valid and keeps the zero-scene page unchanged. |
| T9 | Phase 1: "Reorder submits the full id list" | Same, plus: positions are rewritten dense (0..n-1) in one transaction under the session row lock; **create** appends at `max(position)+1` in the same lock; **delete leaves a gap** (harmless: order is `position, created_at, id`). | Smallest correct thing; no unique index on `(session_id, position)` (R3). |
| T10 | Phase 2 left the card-versus-subpage question open | **Card on the existing session page** (`/admin/santas-workshop/[sessionId]`), as the architect defaulted. Revisit only if QA finds the page unreasonable at 20 scenes. | `ADMIN_NAVIGATION` untouched, so the derived proxy rules are untouched. |

## Summary

A scene is session-level configuration (`sw_scenes`: title, caption, order). A group photo carries only a nullable pointer to one (`sw_photos.scene_id`, `ON DELETE SET NULL`). Howard (an admin-side `santas_workshop.manage` holder) writes the storyline on the session page; a volunteer on the crew phone picks a scene before taking a group photo (the id rides in the queued upload's metadata); the public collage groups its already-approved group tiles by scene, in storyline order, with the scene's title and caption as plain text, and "Other pictures" last. Slice C adds a print-styled book route over the same approved view. No new permission, no new dependency, no change to `photo-access.ts` or the photo door. The public and crew DTOs each grow by exactly one bounded type, pinned by build-failing scans (R1, R5).

## Permissions

- **No new key.** `santas_workshop.manage` gates every scene admin route and the photo reassign route (each handler: `await auth()` then `hasFeature(session.user.id, FEATURES.SANTAS_WORKSHOP_MANAGE)` as its first two statements, per `admin-routes-gate.test.ts`, which already walks `app/api/admin/santas-workshop/**` and will pick the new routes up automatically).
- **Crew:** one new read route (`GET …/crew/[slug]/scenes`, `requireCrew()` first, `crew-routes-gate.test.ts` enforces). The only scene datum a crew device can send is a UUID on a group upload. Crew has no scene write path (scan below).
- **Default roles:** unchanged (`admin`, `board_member`; never `treasurer`, `member`, an `admin.*` key). **No migration binds a role**, so `default-role-bundles.test.ts` and `permission-migration.test.ts` are untouched.
- **Go-live note (T1):** Howard holds the key through the Board role. Features load at sign-in, so after any role or group change he must sign out and back in and wait about 60 seconds for the server permission cache. **Before the Dec 7 dry run, the orchestrator confirms in production (read-only: role and group names only) that Howard's account is in the Board role and a linked member**, and asks Howard to open `/admin/santas-workshop` once.

## API Contract

All JSON. Admin errors use `AdminErrorBody` (`{ error, code, field? }`); crew responses use `crewOk` / `crewError`.

### Carriers (client-safe, no db / node / server-only imports)

- **`src/lib/santas-workshop/scene-contract.ts`** (new; add to the client-safe scan in `admin-routes-gate.test.ts`):
  - `SCENE_TITLE_MAX = 60`, `SCENE_CAPTION_MAX = 280`, `SCENES_MAX = 20`.
  - `SceneTextInput { title: string; caption: string | null }`.
  - `AdminSceneDto { id; title; caption: string | null; position: number; photoCount: number; unhiddenCount: number; createdAt; updatedAt }` (counts are admin-only, R9).
  - Requests and responses: `ScenesListResponse { scenes: AdminSceneDto[] }`, `SceneSaveRequest = SceneTextInput`, `SceneSaveResponse { scene: AdminSceneDto }`, `SceneDeleteResponse { ok: true; movedPhotos: number }`, `SceneOrderRequest { order: string[] }` (returns `ScenesListResponse`), `SceneCopyRequest { fromSessionId: string }` (returns `ScenesListResponse`), `PhotoSceneRequest { sceneId: string | null }`, `PhotoSceneResponse { ok: true; sceneId: string | null; sceneTitle: string | null }`.
  - `SCENE_EDITOR_WARNING = "This text is public. Do not use the names of children, families or stuffies."` (required string, Phase 2 notes) and the field-error strings keyed by validator reason (`SceneRejectReason = "title_required" | "title_too_long" | "caption_too_long" | "looks_like_email" | "looks_like_link" | "looks_like_phone"`), so the UI branches on a closed enum.
- **`admin-contract.ts`:** `ADMIN_ERROR_CODES` gains `scene_limit`, `scene_gone`, `scenes_changed`, `scenes_not_empty`, `no_scenes_to_copy`. `AdminPhotoDto` gains `sceneId: string | null` and `sceneTitle: string | null` (group photos only; portraits `null`). `PhotosListResponse` is unchanged (the page passes the scene options to the panel as a prop).
- **`crew-contract.ts`:** `CrewScene { id: string; title: string; caption: string | null }`, `CrewScenesResponse { scenes: CrewScene[] }`, and `GroupPhotoMeta` gains `sceneId?: string | null`. `GroupPhotoResponse` does **not** echo the scene.
- **`collage-contract.ts`:** exactly Phase 2 R1: `CollageScene { title: string; caption: string | null; tiles: CollageTile[] }` and `CollageView { state; practice; arrivesOn; scenes: CollageScene[]; tiles: CollageTile[] }`. `CollageTile` is unchanged. Update the file header from "photo ids and a kind" to the amended sentence.
- **`collage-ui.ts`:** `COLLAGE_COPY` gains `otherHeading: "Other pictures"` and (Slice C) `BOOK_COPY` (cover line, "Download as PDF", the three-step iOS hint, "This page loads all the pictures", the closing line, "A copy you save stays on your device").

### Admin routes (`santas_workshop.manage`; session row lock = `SELECT id FROM sw_sessions WHERE id = $1 FOR UPDATE` inside every write transaction)

Writes are refused with `409 session_purged` once `public_purged_at` is set (nobody should author text for a removed collage). Any other session status is writable.

| Route | Purpose | Request | Success | Errors |
|---|---|---|---|---|
| `GET /api/admin/santas-workshop/sessions/[id]/scenes` | storyline with admin counts | none | `200 ScenesListResponse` (ordered `position, created_at, id`) | 404 `not_found` |
| `POST …/sessions/[id]/scenes` | add a scene at the end | `SceneSaveRequest` | `201 SceneSaveResponse` | 400 `invalid_input` (`field` = `title`/`caption`, `error` = the reject sentence); 404 `not_found`; 409 `scene_limit` ("A session can have 20 scenes."); 409 `session_purged` |
| `PATCH …/sessions/[id]/scenes/[sceneId]` | replace title and caption (last write wins) | `SceneSaveRequest` | `200 SceneSaveResponse` | 400 `invalid_input`; 404 `not_found` (unknown scene or a scene of another session: one body); 409 `session_purged` |
| `DELETE …/sessions/[id]/scenes/[sceneId]` | delete; photos fall to no scene via the FK | none | `200 SceneDeleteResponse` | 404 `not_found`; 409 `session_purged` |
| `PUT …/sessions/[id]/scenes/order` | reorder | `SceneOrderRequest` (the complete list of the session's scene ids) | `200 ScenesListResponse` | 400 `invalid_input` (non-uuid or duplicate id); 409 `scenes_changed` ("The storyline changed in another tab. It has been refreshed.") when the set differs from the stored set |
| `POST …/sessions/[id]/scenes/copy` | copy title, caption, order from another session (Slice B) | `SceneCopyRequest` | `200 ScenesListResponse` | 400 `invalid_input` (not a uuid, or same session); 404 `not_found` (source missing); 409 `scenes_not_empty` (target already has scenes); 409 `no_scenes_to_copy`; 409 `session_purged` |
| `PUT /api/admin/santas-workshop/photos/[photoId]/scene` | reassign one group photo | `PhotoSceneRequest` | `200 PhotoSceneResponse` | 400 `invalid_input` (`sceneId` neither a uuid nor null); 404 `not_found` (unknown, not a group photo, or purged: one body); 409 `scene_gone` ("That scene no longer exists.") when the scene is not in the photo's session |

Behavior notes the implementer must keep:
- **One validator.** Create, update and copy all pass text through `validateSceneText()` (`scene-input.ts`); `swScenes` is written only in `scene-admin.ts`, only after that call (scan). Copy re-validates each source row and, if a legacy row fails, copies it with the validator's repaired value only when the repair is lossless; otherwise it fails the whole copy with `invalid_input` naming the scene's position (never a partial copy). Believed unreachable (every stored row already passed the validator), written so it cannot silently drop a scene.
- **Reassign** is one pinned UPDATE: `UPDATE sw_photos SET scene_id = $s WHERE id = $p AND kind = 'group' AND purged_at IS NULL RETURNING id`, preceded in the same transaction by a scene lookup `WHERE id = $s AND session_id = (SELECT session_id FROM sw_photos WHERE id = $p)`; rollback sentinel on zero rows (a plain `return` from `db.transaction` commits). It never writes `published_at`, `created_at`, `hidden_at`, or any review/publish column (scan). Setting the same value again is a success with no audit row (idempotent double-click).
- **Audit** (`session-log.ts`; kinds `scene_created`, `scene_updated`, `scene_deleted`, `scenes_reordered`, `scenes_copied`, `photo_scene_changed`): `detail` holds ids and counts only, never title or caption text (the log is not purged). A scan in `scene-admin.test.ts` pins that no `logSessionEvent(` call mentions `title` or `caption`.
- **Validator spec** (`scene-input.ts`, pure): coerce to string (non-string -> `title_required`); NFC; strip zero-width and bidi controls (U+200B to U+200F, U+202A to U+202E, U+2060 to U+2064, U+2066 to U+2069, U+FEFF); replace C0/C1 controls, tabs and newlines with a space; collapse runs of whitespace; trim; length counted by code point (`[...s].length`); title 1 to 60, caption 0 to 280 (empty caption stores `null`). Shape rejections on the cleaned text: email `/\S+@\S+\.\S+/`; link `/https?:\/\/|www\./i` or a bare domain `/\b[a-z0-9-]+\.(com|org|net|edu|gov|io|us|co|info)\b/i`; phone `/\d(?:[ ().-]?\d){6,}/` (seven or more digits with optional separators). A date written "Dec 18-20, 2026" passes (the comma breaks the run); "2026-12-18" does not, and the error sentence says to write the date in words. Each reject returns `{ ok: false, field, reason }`; the UI maps `reason` to its sentence from `scene-contract.ts`.

### Crew routes (`requireCrew()` first; session from the credential, never the URL)

- `GET /api/santas-workshop/crew/[slug]/scenes` -> `crewOk(CrewScenesResponse)` (`no-store`, `noindex` via `crewOk`). `select id, title, caption from sw_scenes where session_id = gate.session.id order by position, created_at, id`. No counts. Loaded when the group panel opens and on every successful re-open; not added to the roster response (the roster is polled).
- `POST /api/santas-workshop/crew/[slug]/group-photos` (existing): `parseGroupSceneId(upload.parts.meta)` returns a lower-cased UUID or `null` (non-string, malformed, absent all `null`); it is called **only** by this route, never folded into `parsePhotoMeta` (check-in and portrait uploads ignore a stray `sceneId`). `commitGroupPhoto(ctx, photo, sceneId)` stores the resolved scene (T2). Response and status are identical whether the scene was valid, unknown, deleted, foreign or absent. A retry of the same `photoId` is `onConflictDoNothing`: the first stored scene wins.

### Public (Server Components, no API)

- `/santas-workshop/c/[token]`: unchanged URL; renders `view.scenes` then the unscened group list then portraits.
- `/santas-workshop/c/[token]/book` (Slice C): Server Component over `getCollage(token)` only (R7, T5).

## Data Model

New migration (number **re-derived at Phase 4 start**: `ls drizzle/migrations/*.sql | sort | tail -3`; on 2026-11-04 the latest is `0116_ledger_sweep_batches.sql`, so likely `0117_santas_workshop_scenes.sql`). `schema.ts` first, migration second, matching exactly. Idempotent, additive, nullable, no backfill, no seed, no role binding:

```sql
CREATE TABLE IF NOT EXISTS sw_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  title text NOT NULL,
  caption text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sw_scenes_session_position ON sw_scenes (session_id, position);
ALTER TABLE sw_photos ADD COLUMN IF NOT EXISTS scene_id uuid;
-- FK sw_scenes_session_id_sw_sessions_id_fk  (session_id -> sw_sessions.id ON DELETE CASCADE)
-- FK sw_photos_scene_id_sw_scenes_id_fk      (scene_id   -> sw_scenes.id   ON DELETE SET NULL)
-- each inside DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '...') THEN ALTER TABLE ... END IF; END $$;  (0113 idiom)
```

`schema.ts`: `swScenes` beside the other `sw_*` tables (`index("ix_sw_scenes_session_position").on(t.sessionId, t.position)`), and `sceneId: uuid("scene_id").references(() => swScenes.id, { onDelete: "set null" })` on `swPhotos`. **No CHECK constraints** (`drizzle-kit push --force` drops anything not declared in `schema.ts`; the validator is the gate, R2). Both FK names are far under 63 characters, so the B-165 truncation drift does not apply. No index on `sw_photos.scene_id`: deleting a scene scans `sw_photos` for the SET NULL, which is fine for now because the table holds hundreds of photos per event (believed, unmeasured; Phase 5 live check L2 times a delete on a practice session with seeded photos); revisit if the table grows past the tens of thousands.

Deploy order is the project's own (migrate, then push, then build); existing sessions, including the live practice session, have zero scenes and behave unchanged.

## Component / Page Plan

**Create (server / shared):**
- `src/lib/santas-workshop/scene-contract.ts`, `scene-input.ts` (validator + `parseGroupSceneId`), `scene-queries.ts` (crew list; admin list with counts; `resolveSceneId(sessionId, raw)` for the admin path), `scene-admin.ts` (the only writer of `swScenes` and of `sw_photos.scene_id`), plus a `.test.ts` for each.
- Routes: `app/api/admin/santas-workshop/sessions/[id]/scenes/route.ts`, `…/scenes/[sceneId]/route.ts`, `…/scenes/order/route.ts`, `…/scenes/copy/route.ts` (Slice B), `app/api/admin/santas-workshop/photos/[photoId]/scene/route.ts`, `app/api/santas-workshop/crew/[slug]/scenes/route.ts`.

**Create (UI):**
- `components/admin/santas-workshop/scenes-card.tsx` (client: list, add/edit form with live character counts and the required public-text warning, up/down buttons, `<ConfirmDialog destructive>` delete stating the count, empty state, copy-from-session control in Slice B).
- `components/santas-workshop/crew/scene-picker.tsx` and `scene-store.ts` (try/catch localStorage wrapper, pure and unit-testable).
- `components/santas-workshop/collage/collage-storyline.tsx` (server-only section renderer, only if `page.tsx` grows past about 150 lines) and, Slice C, `app/santas-workshop/c/[token]/book/page.tsx` plus `components/santas-workshop/collage/book-print-button.tsx`.

**Modify:**
- `src/lib/db/schema.ts`; `drizzle/migrations/<NNNN>_santas_workshop_scenes.sql`.
- `session-log.ts` (six kinds; the only consumer of the list is that file, so `tsc` is the check).
- `admin-contract.ts` (error codes, `AdminPhotoDto` fields); `photo-admin.ts` `listSessionPhotos` (left join `swScenes` for `sceneId`/`sceneTitle`; ordering unchanged).
- `crew-contract.ts`; `photo-service.ts` (`commitGroupPhoto` third argument, in-statement resolution, `23503` retry); the group-photos route.
- `collage-contract.ts`, `collage-queries.ts` (below), `collage-ui.ts`, `collage-gallery.tsx` (T8), `c/[token]/page.tsx`.
- `group-panel.tsx` (scene state, picker, pill, "For:" line, disabled capture, `build` adds `sceneId`, label `Group photo: <title>`), `photo-capture.tsx` (one optional `disabledReason?: string` prop disabling both buttons; this is the file with the saved-photo change, hence the commit-first ordering), `crew-app.tsx` (clear scene storage on auth lost).
- `app/(dashboard)/admin/santas-workshop/[sessionId]/page.tsx` (render the card; load scenes server-side), `…/photos/page.tsx` and `photos-panel.tsx` (badge, select, `scenes` prop, `router.refresh()` on `scene_gone`), Slice B: storyline preview block on the photos page.
- Tests listed below; CLAUDE.md and docs at ship time (R14).

### Collage query design (the load-bearing part)

```
CollagePhotoRow (+ sceneId: string | null)
selectCollage(rows, scenes: { id, title, caption }[] /* already ordered, SAME session only */) -> { scenes: CollageScene[]; tiles: CollageTile[] }
```
- `decidePhotoAccess(` appears **once** in `collage-queries.ts`, inside the approval step of `selectCollage`. Grouping runs only on that step's output.
- Approved group rows whose `sceneId` is a key of the scene map are bucketed by scene (each bucket `byTaken`); every other approved row stays in `tiles` exactly as today (group first, then portraits, each `byTaken`). A scene with an empty bucket is dropped. Only `kind === "group"` rows can be scened.
- `selectCollageTiles(rows)` stays exported as `selectCollage(rows, []).tiles` so existing tests keep their meaning (and double as the zero-scene identity test).
- `getCollage`: early returns for `removed` and `pending` first (they return `scenes: []`), **then** one `Promise.all` of the photo select (adds `sceneId`) and `select id, title, caption from sw_scenes where session_id = session.id order by position, created_at, id`. The row mapper destructures `sceneId` off before calling `photoFactsFrom` (R11: it never enters the visibility facts). Nothing else reads `swScenes` in a `collage-*` module.

### Page rendering rules

- Live, `scenes.length > 0`: one `<section aria-labelledby="scene-<index>-heading">` per scene (`h2.sw-display` = title; caption as a `<p>` only when non-null; `<CollageGallery kind="group" startIndex testId="collage-scene" />`), then, if `tiles` holds group tiles, an "Other pictures" section (`COLLAGE_COPY.otherHeading`, `testId` default), then portraits. `scenes.length === 0`: today's page exactly ("Group pictures").
- The empty-live message shows only when `scenes.length === 0 && tiles.length === 0`.
- Scene text is rendered only as React text nodes; never in `alt`, `title`, `<title>`, metadata or `aria-label`.
- Slice C: on the collage, a "Download as PDF" link (`sw-noprint`) appears only in `live` with `scenes.length > 0`. The book: cover, one `break-before: page` block per scene (heading, caption, 2-column grid of `full` images, `loading="eager"`, fixed 4:3 boxes since tiles carry no dimensions, `break-inside: avoid` per figure), closing page (removal sentence, the "copy you save stays on your device" line). Route-scoped `<style>` with `@page { size: Letter; margin: 0 }` and own padding; the global `@page { margin: 12mm }` in `santas-workshop.css` is not edited. Non-live or no scenes: `redirect()` to the collage. Invalid token: `notFound()`. Practice banner shown when `view.practice`.

## Implementation Order

Slices and dates (today Nov 4; dry run week of Dec 7; event Dec 18 to 20). All specialists run in **one worktree** `isolation: "worktree"` (R12), branch `feature/group-photo-scenes`, with **its own Neon branch** and its own `.env.local` copy; the worktree is created only after the orchestrator has committed the collage-art and saved-photo files. Merge back to `main` at the end of Slice A (target Nov 25) and again after B and C; rebase the worktree between slices.

### Slice A — storyline end to end (target merged by Nov 25; Howard authors from then on)
1. **database-admin** (about 1 hour; first, alone): re-derive the migration number; create the Neon branch (branch id **positional** in `neonctl connection-string <branch-id> --project-id … --pooled`; compare the host to production before any write); `schema.ts` first, then the migration; run it twice against the branch (idempotence); `pnpm exec tsc --noEmit`.
2. **api-developer**, in this order: (a) carriers first (`scene-contract.ts`, the `crew-contract.ts`, `collage-contract.ts`, `admin-contract.ts` additions) and commit them to the worktree so the UI can start; (b) `scene-input.ts`, `scene-queries.ts`, `scene-admin.ts`, `session-log.ts` kinds; (c) admin routes (list, create, update, delete, order) and the reassign route; (d) crew `scenes` route, `parseGroupSceneId`, `commitGroupPhoto` change, group-photos route; (e) `collage-queries.ts` (`selectCollage`, `getCollage`) and `photo-admin.ts` DTO fields; (f) all server unit tests below; amend `collage-contract-no-pii.test.ts`, `crew-contract-no-contact.test.ts`, `admin-routes-gate.test.ts`.
3. **ux-developer** (may start on the admin card, picker and page once step 2a has landed, in disjoint files): `scenes-card.tsx`; `scene-picker.tsx`, `scene-store.ts`, `group-panel.tsx`, `photo-capture.tsx` prop, `crew-app.tsx` clear; collage page + `collage-gallery.tsx` (T8) + `collage-ui.ts`; photos page badge + select (reassign, T3). UI unit/source tests below; extend `e2e/santas-workshop-crew-flow.spec.ts` with a scene pick on the group step (zero-scene path stays covered by the existing steps).
4. Docs for the slice: CLAUDE.md edits (R14 list), release-notes entry via `/release-notes` at ship time (the draft below carries no version number).

### Slice B — copy and preview (done before Dec 14)
5. api-developer: `scenes/copy` route + `copyScenes()` + tests. ux-developer: "Copy scenes from another session" control on the card (visible only when the target has no scenes; one `ConfirmDialog`; source `<select>` of the other sessions), storyline preview on the photos page (exact public heading and caption per scene, `photoCount`, "no unhidden photos: will not show" flag; data from `scene-queries.ts` admin list, never `getCollage`), practice-reset note and test (reset keeps scenes).

### Slice C — storybook (target Dec 11, hard Dec 16; first to be cut)
6. ux-developer (api-developer not needed: no new query): book route, print button, `BOOK_COPY`, collage link, privacy-page one-liner and its `workshop-section.test.ts` move together (copy owner: the user, one string), `collage-page-source.test.ts` extended to the book page (R7 list). A real print check in desktop Chrome and one iPhone is a Phase 5 item.
- Cut order if time slips: Slice C link, then copy-scenes, then the preview; **never reassign** (R13).

## Edge Cases & Risks

- **Delete during upload / queued photo for a deleted scene:** photo is stored with `scene_id = NULL` and lands in "Other pictures"; never a failed upload (T2). Live check L2.
- **Stale phone cache:** a cached scene list that names a deleted scene is harmless (same path). A sticky choice whose id is absent from a freshly loaded list is cleared and the picker returns to "Pick a scene first" (only when scenes exist).
- **Offline at first open of the group panel, no cache:** message "Scenes didn't load. You can still take the photo; an admin will put it in a scene."; capture enabled; photo uploads unscened.
- **Items already in the outbox before deploy:** no `sceneId`; upload as unscened. No IndexedDB version bump (the item `meta` is an unindexed JSON blob).
- **The outbox label** ("Group photo: The Sleigh Arrives") is local-only and is asserted absent from the multipart `meta` (`outbox-send` test).
- **Rename or edit after publish is live at once** (accepted, DECISION-128 item 4); the photos-page preview (Slice B) shows the exact public text beforehand.
- **Concurrent edits:** last write wins on text; reorder 409s `scenes_changed` and the card refetches; cap and copy are decided under the session row lock.
- **Zero scenes everywhere** (every existing session): panel, collage, admin photos page behave as today. Pinned by tests, not by hope.
- **`pending` / `removed`:** `scenes: []` returned before the scenes query runs; HTML carries no scene text. Public purge leaves scene rows; the collage is `removed`. Practice reset keeps scenes. Personal purge never touches them.
- **Accepted residual (public prose):** an admin can type a family or child name into a scene; the validator cannot detect names. Controls: the required editor warning, the Slice B preview, and a human read before publish. After the public purge the text would persist in the database. The retention card must not claim every typed word is deleted. Live check L5 records the observed acceptance of name-shaped strings.
- **Docs drift risk:** CLAUDE.md still says "a photo id and a kind only" and "every sentence is a fixed string"; the Slice A merge is not complete until those sentences, the crew bullet and the retention bullet are edited (R14).
- **Worktree hygiene:** the migration file must not appear in the main tree before the Slice A merge (a main-tree `pnpm dev` would replay it against the shared dev database). The implementer does not touch `frame-layout.ts`, `frame-compose.ts` or their test.
- **Time:** about 2 to 3 working days of work; the float to Dec 7 is about a week after the Nov 25 target.

## Unit tests the implementers must write (Phase 4 gate; names are the `describe`/`it` titles to use)

**Server**
1. `scene-input.test.ts` — "validateSceneText": NFC and trim; control/newline collapse; zero-width and bidi stripped; code-point length (emoji and combining marks counted by code point at the 60/280 edges); empty title rejected; empty caption becomes `null`; rejects email, link, bare domain, 7-digit run with separators; accepts "Dec 18-20, 2026"; rejects non-string input. **"parseGroupSceneId (sceneId parse)"**: valid uuid (any case) -> lowercased; malformed, empty, number, object, array, absent, `null` -> `null`; never throws.
2. `collage-queries.test.ts` — **"selectCollage parity (property test)"**: seeded random rows (kinds group/portrait/check_in, hidden/superseded/purged/published/unpublished, consent, random `sceneId` drawn from {null, a known scene, a deleted/foreign id}) and 0 to 6 scenes; assert (a) the multiset of tile ids in `scenes[].tiles` plus `tiles` equals the set the single approval pass accepts (computed independently by calling `decidePhotoAccess` directly, as `collage-door.test.ts` does); (b) no id appears twice; (c) no id appears that `decidePhotoAccess({ kind: "public" })` refuses; (d) every scene in the output has at least one tile; (e) portraits never appear in a scene. **"zero scenes is identical to today"**: for random rows, `selectCollage(rows, []).tiles` deep-equals the pre-change `selectCollageTiles` output (keep a frozen copy of the old function inside the test) and `scenes` is `[]`. **"grouping order"**: scenes in `position, created_at, id` order (ties on position broken by created_at then id); tiles within a scene by capture time then id; unscened tiles last in `tiles`; a hidden-only scene is absent. **"foreign or deleted scene id falls to tiles"**. **"pending and removed carry no scenes and never query scenes"** (the stubbed `db` records calls; `swScenes` select not invoked).
3. `collage-contract-no-pii.test.ts` (amended exactly as R1): banned-word scan runs with the `CollageScene` body removed; `CollageScene` fields are exactly `title, caption, tiles`; `CollageView` keys are `state, practice, arrivesOn, scenes, tiles`; `CollageTile` still `id, kind`; contract contains no `sceneId|scene_id`; `collageToken` still appears once in the queries file; **`decidePhotoAccess(` appears exactly once in `collage-queries.ts`**; `swScenes` is selected only after the `removed`/`pending` early returns (source-order scan) and only with `eq(swScenes.sessionId, session.id)`; no other table feeds public text.
4. **"photo-access unchanged (scene scan)"** in `photo-door.test.ts` or `photo-access.test.ts`: `photo-access.ts` contains no `scene` (case-insensitive); `PhotoFacts` has no scene field; `collage-queries.ts` does not pass `sceneId` into `photoFactsFrom`.
5. `scene-admin.test.ts` — create appends at max+1; 21st scene -> `scene_limit`; update replaces text and bumps `updated_at`; delete returns `movedPhotos` and leaves the photos with `sceneId` null; reorder dense rewrite, `scenes_changed` on missing/extra id, duplicate id -> `invalid_input`; reassign: pinned UPDATE, `scene_gone` for foreign scene, `not_found` for non-group / purged / unknown photo, same-value is a no-op without an audit row, never touches `published_at|created_at|hidden_at`; copy only into an empty session (Slice B): `scenes_not_empty`, `no_scenes_to_copy`, same-session -> `invalid_input`, copies title/caption/order and no photos; `session_purged` blocks every write; **audit rows hold ids and counts only** (no call mentions `title`/`caption`); **"swScenes is written only in scene-admin.ts and only after validateSceneText"** (source scan over `src/`).
6. `crew-contract-no-contact.test.ts` (extended): "CrewScene is exactly id, title, caption"; "`title` and `caption` appear only in CrewScene" (no other crew interface mentions them); contract still has no `email|phone|mobile|zeffy`. **"crew no-write scan"**: no file under `app/api/santas-workshop/crew/**`, `crew-*.ts` or `components/santas-workshop/crew/**` contains `insert(`/`update(`/`delete(` against `swScenes` or an import of `scene-admin`; the crew `scenes` route imports `requireCrew` and its query is scoped by `gate.session.id` (never `slug` or a request param). `crew-routes-gate.test.ts` passes for the new route.
7. `photo-service.test.ts` (extended): `commitGroupPhoto` with a valid scene stores it; unknown, foreign and `null` all store `null` with `{ ok: true, replayed: false }`; replay of the same photo id keeps the first scene; **"`23503` retries once with null"** (stub the insert to throw once); the group-photos route returns the same status and body for valid, unknown, deleted, foreign and absent scene ids (**no enumeration signal**); `GroupPhotoResponse` has no scene field.
8. `retention.test.ts` / `retention-policy.test.ts`: "practice reset keeps scenes" (rows survive, photos deleted, `scene_id` columns gone with them); "personal and public purge never reference swScenes" (source scan of `retention.ts`).
9. Migration/schema: "the scenes migration is idempotent and matches schema.ts" using the existing migration-parse test style (table, column, index and both FK names present).

**Client**
10. `scene-store.test.ts`: round-trip; a throwing `localStorage` accessor yields `null`/no-op without throwing; keys are per slug; clear removes both.
11. `crew-app-source.test.ts` / new `group-panel-source.test.ts`: group panel builds `sceneId` into `GroupPhotoMeta`; the outbox label contains the title and **the multipart `meta` does not contain `label`** (extend `outbox-send` test); with zero scenes the panel renders exactly today's controls (no picker, capture enabled); with scenes and no choice both capture buttons are disabled with "Pick a scene first."; with a cached list and failed fetch the picker still renders; with no cache and failed fetch capture is enabled and the "Scenes didn't load" sentence shows; a stale sticky id is cleared. Cleared on `crew_auth_required`.
12. `collage-page-source.test.ts` (amended per R1): storyline render case (headings, captions, per-scene lists, "Other pictures" last, portraits last); zero-scene case identical to today (heading "Group pictures", `collage-group` test id, no `collage-scene`); `pending`/`removed` cases assert no scene text in the HTML; scene text appears only as text nodes (no `dangerouslySetInnerHTML`, none in `alt`/`title`/`aria-label`); alt text ordinals are unique across sections (`startIndex`); the stubbed view type includes `scenes`.
13. `scenes-card` source/unit test (`admin-ui-source.test.ts` style): delete uses `ConfirmDialog` with `destructive`; no `window.confirm|alert|prompt`; the public-text warning string is rendered; up/down buttons have 44px targets; `rounded-2xl` cards and `rounded-lg` buttons; no `lions-red`. `photos-panel-source.test.ts` extended: badge and native `<select>` per group photo including "No scene"; `scene_gone` triggers refresh.
14. Slice C: `collage-page-source.test.ts` extended to the book page — imports only `getCollage` and UI/copy modules (no `@/lib/db`, `photo-access`, `photo-store`); no `portrait` rendering, no `check_in`, no `.name`, no `view.tiles`; `state !== "live" || scenes.length === 0` redirects; `notFound()` on null; `noindex`, `referrer: "no-referrer"`, `force-dynamic` present in the page itself; not in `sitemap.ts`/`robots.ts`; controls carry `sw-noprint`; images use `collagePhotoPath(id, "full")`; the global `@page` rule in `santas-workshop.css` is unchanged; `workshop-section.test.ts` pins the privacy sentence.

## Phase 5 live checks (record observed rates; they back the accepted residuals)

- **L1 (cross-session scene id):** with a practice crew cookie, post group uploads naming (a) a valid scene, (b) a scene id from another session, (c) a deleted id, (d) a random uuid, (e) garbage. Record the status and body of each. Expected: identical 200 bodies; DB shows scene set only for (a). Observed count of distinguishable responses expected 1.
- **L2 (delete during upload):** 20 uploads racing a delete of their scene on a practice session with seeded photos; record failed uploads (expected 0), photos that landed with a null scene, and the DELETE duration (backs the "no index on scene_id" claim).
- **L3 (public parity, after a practice publish):** every tile id on the collage returns 200 to an anonymous fetch of the photo door; a hidden photo is absent from the collage and 404 at the door; the multiset of ids on the page equals the set the door serves. Record mismatches (expected 0).
- **L4 (state leaks):** `curl` the collage for a `pending` and a `removed` session (and the book URL once Slice C ships) and grep for every scene title: expected 0 matches.
- **L5 (accepted residual on public prose):** submit ten name-shaped scene titles ("Emma's Sleigh Ride", "The Hendersons Visit Santa"); record how many the validator accepts (expected 10 of 10: names cannot be machine-rejected, which is why the warning and the preview exist) and ten contact-shaped strings (expected 10 of 10 rejected).
- **L6 (phone):** on a real phone: pick a scene, go offline, take three photos, go online; record whether all three arrive in that scene and the label shown in the outbox. Then delete the scene on the laptop before the queue drains and record where the photos land.
- **L7 (print, Slice C):** one desktop Chrome and one iPhone Safari save-as-PDF of a practice book; record page count, whether the token URL prints, and time to load N pictures on mobile data.

## Release-notes draft (no version number; `/release-notes` assigns it at ship time)

> **Santa's Workshop: tell the day as a story.** Admins can now write a storyline for each session (a title and a short note for each scene, in the order they want) on the session page. When a volunteer takes a group photo on the crew phone they tap the scene it belongs to, and the public photo page shows the group pictures as that story, scene by scene, with any other pictures after. An admin can move a group photo to a different scene from the Photos page if a volunteer tapped the wrong one. Scene text is public, so it never includes children's, families' or stuffies' names.

(Later slices extend this entry: "copy last session's storyline", "download the storyline as a PDF".)

## Implementer

- **Specialist split, not full-stack:** a new table and column, about six new admin handlers, one crew route and an upload change, a public query/contract amendment, and four UI surfaces is well past the ~150-line full-stack bound, and the api-developer to ux-developer handoff has a real contract to hand off (the carriers). The api-developer is asked to land carriers first so the UI can overlap.
- **database-admin** -> **api-developer** -> **ux-developer**, as in Implementation Order. Slice C needs ux-developer only.
- **Worktree + own Neon branch:** all of Phase 4 (database-admin, api-developer, ux-developer) and Phase 5 qa for these slices, per R12. Phase 6 (analyst) shares the main tree.

## Open questions / handoff notes

- **Nothing blocks Phase 4.** The only open fact (Howard's role) is answered (T1).
- **Orchestrator:** (1) commit the collage-art and saved-photo files before creating the worktree (R12); (2) create the worktree and the Neon branch, announce the dev-server and migration status in the work-log; (3) before the Dec 7 dry run, read-only confirm in production that Howard's account is in the Board role and linked to a member; ask him to sign out and in once; (4) re-derive the migration number at Phase 4 start.
- **User preferences I defaulted (proceed unless you object):** (a) the storybook has no "Other" page (T5); (b) reassign ships with Slice A (T3); (c) scene caps 20 / 60 / 280 stay (Howard's draft list would settle it; ask him for it before Nov 25); (d) the privacy-page sentence is "A copy you save stays on your device." (user owns the wording, one string).
- **DECISION-128** is filed `Status: Proposed` in `docs/decisions.md`; it is promoted to `Resolved` at Phase 6 after each factual sentence is re-read against QA's "Established" list. DECISION-125 (item 3) and DECISION-121 (item 6) Status lines carry the amendment marker.
- **Reserved IDs** for this feature: DECISION-128 only. No backlog IDs reserved or used.

## Handoff

**Owner:** tech-lead · **Status:** complete

### Summary
Design complete for Slices A, B and C. T2 (resolve the scene inside the INSERT), T3 (reassign in Slice A), T5 (no "Other" page in the book) and T7 (no existing localStorage in the crew app) are the substantive departures from Phases 1 and 2. Howard holds the key through the Board role (user answer), so there is no authoring workaround.

### What I did
- Read the contract, query, page, gallery, crew contract, group-photos route, photo service, admin gate test, admin photo query, retention reset, group panel, photo-queue/outbox and the decisions log; re-derived the migration number (latest 0116).
- Wrote the design, the test list and the live checks; filed DECISION-128 as Proposed; added the amendment markers to DECISION-125 and DECISION-121.

### Outputs
- This section of `/Users/cshenso/git/westervillelions/docs/work-log/2026-11-04-group-photo-scenes.md`.
- `/Users/cshenso/git/westervillelions/docs/decisions.md` (DECISION-128, Proposed; Status-line markers on 125 and 121).

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]


## Phase 4 — Implementation (schema) — 2026-11-04

**Owner:** database-admin
**Status:** complete

### Summary
Added `sw_scenes` and the nullable `sw_photos.scene_id` exactly per the Phase 3 data model, with migration `0117_santas_workshop_scenes.sql`. Applied twice to the feature's own Neon branch (idempotent); no production access.

### What I did
- Neon branch `feature/group-photo-scenes`, id `br-rough-math-ams0lc2m`, child of the dev branch `br-divine-paper-amvfuhzm` (project `tiny-fog-13725730`). Pooled host `ep-steep-field-amz4eiik-pooler.c-5.us-east-1.aws.neon.tech`; verified different from dev (`ep-orange-sunset-…`) and production (`ep-rough-smoke-…`) before any write. Dev vs production mapping was confirmed with positional `neonctl connection-string`.
- Worktree `.env.local` (gitignored) copied from the main tree with `DATABASE_URL` repointed at the branch and `PROD_DATABASE_URL` commented out. `pnpm install` run.
- `schema.ts`: `swScenes` (before `swPhotos`), index `ix_sw_scenes_session_position (session_id, position)`; `swPhotos.sceneId` FK `ON DELETE SET NULL`. No CHECK constraints, no new index on `sw_photos.scene_id` (per design).
- Migration 0117 (re-derived: latest was 0116): `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, both FKs in pg_constraint-guarded DO blocks with drizzle-derived names, `CREATE INDEX IF NOT EXISTS`. No seed, backfill or role binding.

### Outputs
- `src/lib/db/schema.ts`, `drizzle/migrations/0117_santas_workshop_scenes.sql`; tables affected: `sw_scenes` (new), `sw_photos` (column).
- Local apply: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (run twice, both clean). Catalog check on the branch confirmed columns, nullability, defaults, both FK definitions and the index.
- Gates: `pnpm exec tsc --noEmit` clean; `default-role-bundles.test.ts` passes (no permission change). The design names no schema-level unit tests for this step.

### Deviations
- `drizzle-kit push --force` could not complete non-interactively: it still stops on the pre-existing B-165 prompt (`ledger_entities_slug_unique`, "truncate?") and needs a TTY. Not caused by this change; the migration alone created every object, so push has nothing of ours to add. Whoever has a terminal should run `pnpm db:push` and answer No to truncate prompts to confirm zero scene-related diff.

### Open questions / handoff notes
- For api-developer: `swScenes` (`id, sessionId, title, caption (nullable), position, createdAt, updatedAt`) and `swPhotos.sceneId` (nullable) are exported from `@/lib/db/schema`. Deleting a scene nulls `sw_photos.scene_id` in the database; deleting a session cascades scenes.
- Dev server in the worktree must use the worktree `.env.local` (branch DB); never point it at the main tree's DB.
- Next agent: api-developer.


## Phase 4 — Implementation (API) — 2026-11-04

**Owner:** api-developer
**Status:** complete (Slice A server side; Slice B copy-scenes deliberately not built)

### Summary
Built the whole Slice A server surface per Phase 3: carriers first (committed separately as 54ec7a2 so the UI could start), the scene validator, queries and the single writer module, five admin routes plus the photo reassign route, the crew scenes read route, the group-upload `sceneId` parse with in-INSERT resolution and the 23503 retry (T2), and the collage grouping after the single approval pass (R1). Zero scenes returns today's collage unchanged (proved against a frozen copy of the old function). Gates: `tsc` clean, `pnpm lint` 0 errors (1 pre-existing warning in `budget-context-panel.tsx`), `pnpm test` 336 files / 5886 tests passing. `pnpm build` not run (as instructed); no dev server was started.

### What I did
- `scene-contract.ts` (carrier), `scene-input.ts` (`validateSceneText`, `parseGroupSceneId`, `parseSceneOrder`), `scene-queries.ts` (crew list, admin list with counts, `resolveSceneId`), `scene-admin.ts` (the only writer of `sw_scenes` and of the reassign; session row `FOR UPDATE` in every transaction; `session_purged` guard; audit with ids/counts only), `pg-error.ts` (`isForeignKeyViolation`).
- Contracts: `admin-contract.ts` (5 error codes, `AdminPhotoDto.sceneId/sceneTitle`), `crew-contract.ts` (`CrewScene`, `CrewScenesResponse`, `GroupPhotoMeta.sceneId?`), `collage-contract.ts` (`CollageScene`, `CollageView.scenes`), `session-log.ts` (six kinds).
- `photo-service.ts`: `commitGroupPhoto(ctx, photo, sceneId = null)`; scene resolved in the INSERT; one retry with null on 23503. `photo-admin.ts`: `listSessionPhotos` left-joins `sw_scenes` (group photos only). `collage-queries.ts`: `selectCollage(rows, scenes)`; `selectCollageTiles` kept as `selectCollage(rows, []).tiles`; `getCollage` early-returns `pending`/`removed` with `scenes: []` before any scenes query, then one `Promise.all` of the photo select (adds `sceneId`) and the session-scoped scenes select. `photo-access.ts` and the photo door are untouched.
- `retention.ts`: comment only (scenes survive purge and reset); behaviour unchanged.
- Live SQL check on the feature's Neon branch (no write, nothing created): the in-INSERT sub-select compiles and parameter types infer; the statement stops at the unrelated session FK as expected.

### Outputs
**Carriers (the UI imports these):** `src/lib/santas-workshop/scene-contract.ts`, `crew-contract.ts`, `collage-contract.ts`, `admin-contract.ts`; error text mapped in `admin-ui.ts` (`scene_limit`, `scene_gone`, `scenes_changed`, `scenes_not_empty`, `no_scenes_to_copy`).

**Endpoints** (all admin routes: `await auth()` then `hasFeature(user.id, FEATURES.SANTAS_WORKSHOP_MANAGE)`, first two statements; errors are `AdminErrorBody`):

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/admin/santas-workshop/sessions/[id]/scenes` | none | 200 `ScenesListResponse` | 404 `not_found` |
| `POST …/sessions/[id]/scenes` | `SceneSaveRequest` | 201 `SceneSaveResponse` | 400 `invalid_input` (`field` title/caption, `error` = reject sentence); 404; 409 `scene_limit`, `session_purged` |
| `PATCH …/sessions/[id]/scenes/[sceneId]` | `SceneSaveRequest` | 200 `SceneSaveResponse` (with counts) | 400; 404 (unknown or other session's scene); 409 `session_purged` |
| `DELETE …/sessions/[id]/scenes/[sceneId]` | none | 200 `{ ok: true, movedPhotos }` | 404; 409 `session_purged` |
| `PUT …/sessions/[id]/scenes/order` | `{ order: string[] }` | 200 `ScenesListResponse` | 400 `invalid_input` (non-uuid or repeated id); 409 `scenes_changed`, `session_purged` |
| `PUT /api/admin/santas-workshop/photos/[photoId]/scene` | `{ sceneId: string \| null }` | 200 `{ ok: true, sceneId, sceneTitle }` | 400 (`sceneId` neither uuid nor null); 404 (unknown, not group, purged); 409 `scene_gone` |
| `GET /api/santas-workshop/crew/[slug]/scenes` | none (`requireCrew()` first) | 200 `{ scenes: CrewScene[] }`, `no-store` | crew 401 envelope |
| `POST …/crew/[slug]/group-photos` (existing) | meta gains optional `sceneId` | unchanged body `{ ok, photoId, replayed }` | unchanged; identical for valid, unknown, deleted, foreign, malformed, absent scene |

**Collage view for the page:** `CollageView = { state, practice, arrivesOn, scenes: CollageScene[], tiles: CollageTile[] }`; `scenes` only when live and only scenes with at least one approved group tile, in storyline order; `tiles` = unscened group tiles first, then portraits. `CollageScene = { title, caption: string | null, tiles }` (no id).

**Tests written** (all names from the Phase 3 list for the server step): `scene-input.test.ts` (validateSceneText, parseGroupSceneId, parseSceneOrder), `scene-schema.test.ts` (migration idempotent and matches schema), `collage-queries.test.ts` (parity property test over 400 seeded runs, zero-scenes identical to a frozen copy over 300 runs, grouping order, foreign/deleted scene falls to tiles, live grouping, pending/removed never query scenes), `collage-contract-no-pii.test.ts` (amended per R1: CollageScene exactly title/caption/tiles, caption only inside it, CollageView keys, no sceneId in contract, `decidePhotoAccess(` once, scenes select placement/scoping), `photo-access.test.ts` (no "scene" in photo-access.ts, none in PhotoFacts or any photoFactsFrom call), `scene-admin.test.ts` (create/cap/update/delete/reorder/reassign, session_purged, audit has no text, writers scan), `crew-contract-no-contact.test.ts` (CrewScene exactly id/title/caption, title/caption only there, crew no-write scan, scenes route scoping), `photo-service.test.ts` (in-INSERT resolution, replay keeps first, 23503 retry once, no retry without a scene), `group-photos-scene-route.test.ts` (no enumeration signal, response never echoes scene), `retention.test.ts` (reset keeps scenes, purges never reference scenes), `admin-routes-gate.test.ts` (carrier list). The admin and crew route-gate tests pick up the new routes automatically and pass.

### Deviations from the design
1. **Pre-existing tests I had to amend (schema step left them red):** `ledger-sweep-schema.test.ts` asserted 0116 is the highest migration (it fails for any later migration; now asserts it exists and owns its number); `session-schema.test.ts` (0113) now excludes `sw_photos.scene_id` and its FK, which belong to 0117 and are guarded by the new `scene-schema.test.ts`.
2. **Minimal compile-fix edits in UI-owned files:** `collage-page-source.test.ts` stubs gained `scenes: []` (type required it; no behaviour change); `admin-ui.ts` gained five `case`s in its exhaustive error-code switch (the `never` check broke), with fixed sentences from `scene-contract.ts` for three and short plain sentences for the two Slice B codes. ux-developer owns the copy.
3. **Collage page does not render `scenes` yet.** `c/[token]/page.tsx` is untouched, so until the ux-developer lands the page a scened group picture is in `view.scenes` and not drawn. Do not deploy the server step without the page.
4. **`parseGroupSceneId(meta)` takes the whole multipart meta** and reads `meta.sceneId` (the design said "`parseGroupSceneId(meta)`"; a bare-id variant would have needed a second helper). A non-string or absent caption is treated as no caption (the reject enum has no reason for it).
5. **Session audit is written after the transaction commits**, not inside it (`logSessionEvent` uses the shared `db`), same as the existing admin modules.
6. `SceneSaveResponse` from PATCH carries real counts (re-read from the list); from POST the counts are 0 (a new scene has no photos).
7. **Not built:** `scenes/copy` route, `copyScenes()`, `SceneCopyRequest` consumer (Slice B; the contract type and error codes exist). `scene_store`, picker and page edits are UI work.
8. `drizzle-kit push` was not run (needs a TTY, B-165); no schema change in this step beyond the schema handoff.

### Consumers grepped
`grep -rn "\.kind ===\|action:\|AdminErrorCode\|CollageView\|AdminPhotoDto\|GroupPhotoMeta" src/components src/app` plus the `never`-checked switches: the only exhaustive switch over a widened union was `admin-ui.ts` `adminErrorMessage` (fixed). `CollageView` consumers: `c/[token]/page.tsx` (reads `tiles` only, still compiles) and `collage-page-source.test.ts` (stubs fixed). `AdminPhotoDto` is built only in `photo-admin.ts`; no UI literal of it exists yet. `GroupPhotoMeta` is built in `group-panel.tsx` (field is optional, compiles).

### Open questions / handoff notes
- **Next agent: ux-developer** (admin `scenes-card`, crew picker/`scene-store`/`group-panel`/`photo-capture` prop/`crew-app` clear, collage page + `CollageGallery` `startIndex`/`testId` + `COLLAGE_COPY.otherHeading`, photos page badge and select). Build on the contracts above; the card gets `photoCount`/`unhiddenCount` from the list and shows the delete count from it (T4).
- The page should show "Group pictures" when `scenes` is empty and "Other pictures" when it is not (R1); the empty-live message only when `scenes.length === 0 && tiles.length === 0`.
- A crew scene fetch is `GET …/crew/[slug]/scenes` (not part of the roster poll). `sceneId` goes in the group upload's `meta` JSON; never send the outbox label.
- Phase 5 live checks L1 to L6 still apply; L1/L2 are now runnable against the server step.
- Commits are on `feature/group-photo-scenes` in the worktree; nothing pushed or merged.


## Phase 4 — Implementation (client) — 2026-11-04

**Owner:** ux-developer
**Status:** complete (Slice A UI; Slice B copy control and preview, Slice C book not built)

### Summary
Built the Slice A UI on the api-developer's contract: the admin scenes card on the session page, the scene badge and "Move to scene" select on the photos page, the crew scene picker with sticky choice and cached list, and the storyline sections on the public collage. A zero-scene session renders exactly today's controls and page. Gates: `tsc` clean, `pnpm lint` 0 errors (the 1 pre-existing warning in `budget-context-panel.tsx`), `pnpm test` 339 files / 5916 tests passing, `pnpm build:only` passes. e2e not run (as instructed); one spec extended, one adjusted. No dev server was started.

### What I did
- **Admin** `scenes-card.tsx` (client): ordered list with title, caption and photo counts (amber chip when a scene has only hidden photos), add/edit form with live code-point counts, the `SCENE_EDITOR_WARNING` note, inline title/caption errors from `invalid_input` + `field`, up/down buttons (44px) calling `PUT …/scenes/order` (refetch on `scenes_changed`), delete via destructive `ConfirmDialog` naming the photo count and "Other pictures", empty state. Wired into the session page from `listAdminScenes`. `ADMIN_API` gained `scenes`, `scene`, `scenesOrder`, `photoScene`.
- **Admin photos:** page loads the scenes and passes a `scenes` prop; each group photo shows a scene chip ("Other pictures" when none) and a native `<select>` "Move to scene" (only when the session has scenes) calling `PUT …/photos/[id]/scene`; `scene_gone` shows the sentence and `router.refresh()`; success reloads the loaded pages.
- **Crew:** `scene-store.ts` (localStorage per slug, every access try/catch; choice + cached list; `clearSceneStore`), `scene-picker.tsx` (radio-style 56px buttons: scenes then "Other"), `group-panel.tsx` (loads `GET …/scenes`, cache shown first, sticky choice, stale id forgotten after a fresh load, `sceneId` in the queued meta, label `Group photo: <title>` local only), `photo-capture.tsx` gained `disabledReason` and `pill` (both Take and Choose-a-saved-photo disabled together; saved-photo path untouched), `crew-app.tsx` clears the store whenever the code screen shows (covers 401 anywhere), `crew-api.ts` gained `scenes`.
- **Collage:** `c/[token]/page.tsx` renders `view.scenes` as `<section aria-labelledby="scene-N-heading">` (title `h2`, caption `<p>` only when non-null, `CollageGallery` with `startIndex` and `testId="collage-scene"`), then the unscened group list headed "Other pictures" (or "Group pictures" when there are no scenes), then portraits. `CollageGallery` gained `startIndex`/`testId`; `COLLAGE_COPY.otherHeading` added. No new filter on the page; scene text is only text nodes.
- Replaced the api-developer's placeholder sentences for `scenes_not_empty` and `no_scenes_to_copy` in `admin-ui.ts`.

### Tests written
`scene-store.test.ts` (round trip, per slug, clear, throwing accessor, corrupt cache), `group-panel-source.test.ts` (sceneId in meta, label local, disabled + "Pick a scene first.", zero scenes unchanged, failed-fetch paths, stale id, clear on auth loss, pill), `scenes-card-source.test.ts`, `photos-panel-source.test.ts` (badge, native select, `scene_gone` refresh), `collage-page-source.test.ts` (storyline order, null caption, unique ordinal alt, scene text never in attributes, zero scenes identical, empty-live rule, pending/removed leak nothing). e2e: `santas-workshop-crew-flow.spec.ts` waits for capture to enable (the panel loads scenes first) and has a new scene-pick test.

### Deviations from the design
1. `photo-capture.tsx` already had a `disabled` prop; I added `disabledReason` (which also forces `disabled`) plus a `pill` prop instead of only the one prop the design named.
2. While the scene list is loading with no cache, capture is disabled with "Loading scenes…" (design did not name this state); it opens as soon as the load resolves, so a zero-scene session is enabled after a moment, not at first paint.
3. The picker is a radiogroup of buttons rather than a `<select>` (thumb targets on a phone); the admin photos page uses the native `<select>` per the ruling.
4. The scene store is cleared by `crew-app.tsx` whenever the code screen is shown (not only inside the panel's own fetch), which also covers a 401 on the roster or an upload.
5. Slice B (copy control, storyline preview) not built, as scoped. No `scene-picker` standalone render test: its behavior is pinned by source scans and the e2e.
6. The "For: <scene>" pill sits under the preview's existing "For: the group" line.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** Click through: admin session page, add/edit/reorder/delete a scene (delete dialog count); photos page, move a group photo between scenes and to Other; crew group panel at 390px (pick a scene, Take and Choose a saved photo, offline with and without a cached list, rotate the worker code and confirm the choice is forgotten); the collage with 0, 1 and several scenes, plus a scene with only hidden photos (should be absent); Phase 5 live checks L1 to L6.
- New copy for the Lions Club to refine: "Which scene is this photo for?", "Pick a scene first.", "Loading scenes…", the delete dialog sentence, the empty-state sentence, "Other pictures".
- Still do not deploy without all of Slice A merged together; the collage now draws scenes.


## Phase 5 — Verification — 2026-11-04

**Owner:** qa
**Status:** complete (verdict FAIL, back to implementers)

### Summary
**Verdict: FAIL.** Two defects, both reproduced. **D2:** the admin Storyline card and the delete dialog always say "No photos" because the count subquery compares `sp.scene_id` to the photo's own id (Drizzle renders `${swScenes.id}` unqualified inside a correlated subquery). **D1:** the phone's sticky scene and cached list survive a worker-code rotation or cookie expiry when the app is cold-loaded, because only a live `CrewApp` clears them. Everything else passed: typecheck, lint, 339 files / 5916 unit tests, production build, L1/L2/L3/L4/L5, the phone flow at 360 px, scene CRUD, Move to scene incl. `scene_gone`, the storyline collage, zero-scene parity, removed state, practice reset. Measured on worktree HEAD ecf6e16 plus one new untracked spec (committed with this report).

### What I did
Environment: worktree `/Users/cshenso/git/westervillelions-scenes`, feature Neon branch (host `ep-steep-field-amz4eiik-pooler…`, confirmed before any write), dev server on :3200 (NEXTAUTH_URL/AUTH_URL overridden to :3200), `RESEND_API_KEY` blank and no `EMAIL_DEV_ALLOWLIST`, so nothing could send. Did not touch :3000, the main tree, the dev branch or production.

**Gates**
| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS (exit 0) |
| `pnpm lint` | PASS (0 errors; 1 pre-existing warning, `budget-context-panel.tsx:114`) |
| `pnpm test` | PASS: 339 files, 5916 tests, 5.3 s |
| `pnpm build:only` | PASS (exit 0; `/santas-workshop/c/[token]`, `/crew/[slug]`, `/f/[token]` dynamic; no warnings) |

**Existing santas-workshop e2e specs (80 tests, :3200, 1 worker)**: 66 passed, 1 failed, 1 skipped, 12 did not run (serial skip after the failure). Per spec: admin-gate, collage (all 14), crew-admin, crew-entry, family, frames, session-edit, webhook-to-roster, santas-workshop (public page): all pass. `santas-workshop-crew-flow.spec.ts`: two tests fail, **both pre-existing and unrelated to this diff**. `:53 the roster shows the registered stuffies…` and `:206 pickup: name shown first…` assert the string "Parent" is absent from the roster HTML/JSON, but the fixture's parent last name is "Parent" and `familyLastName` is deliberately on the roster since v1.100.2 (`crew-contract.ts:136` exists at base 517b6d5; the same two assertions exist at base `spec.ts:58` and `:223`). Re-ran the other 11 crew-flow tests with those two excluded: 11/11 pass, including the extended "a group photo is filed in the scene the volunteer picked". Fix (not mine to make): use a parent last name that is not a substring of anything rendered, in the fixture.

**New spec `e2e/santas-workshop-scenes.spec.ts` (13 tests, written by QA, committed here)**: 12 pass when run in order up to the defects; final runs: tests 1-11 and the removed/reset test pass; **#12 (delete dialog and row count) FAILS on D2** and **#13 (rotation forgets the sticky scene) FAILS on D1**. These two are intentionally left red.

**Manual / live checks**
| Check | Result | Observed |
|---|---|---|
| Scenes card: add, edit, reorder (up/down, ends disabled, persists after reload), delete with ConfirmDialog (Cancel keeps, confirm removes), public-text warning, inline title/caption errors, live code-point counters, 20-scene cap message and disabled Add | pass | e2e #1, #2 |
| Limits: 60/280 code points (60 emoji accepted, 61 rejected), empty title, email/link/domain/7-digit/phone rejected, "Dec 18-20, 2026" accepted, 21st scene 409 `scene_limit` | pass | e2e #2 |
| Admin scene routes and crew scenes route reject anonymous callers | pass | 401/403 |
| **L1** cross-session/deleted/random/garbage/number/object/absent scene id on the real crew upload route | pass | 1 distinct response signature (`200 {"ok":true,"photoId":…,"replayed":false}`) over 8 variants; DB: scene set only for the valid one; replay keeps the first scene |
| **L2** 20 uploads racing delete of their scene | pass | DELETE 200 in 494-881 ms; 0 failed uploads; 20/20 rows; all 20 `scene_id` null; 0 dangling |
| **L3** collage parity after publish | pass | 15 images on the page, 0 photo-door mismatches for an anonymous fetch |
| **L4** state leaks | pass | pending HTML has none of the scene titles; removed state (public purge) shows "These photos have been removed", no scene text, no photo images |
| **L5** name-shaped titles / contact-shaped text | 10/10 accepted (expected residual) / 10/10 rejected | |
| Phone 360x740: picker (3 radios, each >= 44 px, no horizontal scroll), Take and Choose-saved both disabled with "Pick a scene first.", enabled after pick, "For: <scene>" pill, scene upload, choose-saved-photo upload in a second scene, "Other" upload with no pill, choice sticky after save and after reload | pass | e2e #6; screenshot reviewed |
| Scene list fails to load, no cache: capture enabled, "Scenes didn't load…" shown; zero-scene session: no picker, capture enabled | pass | e2e #7, #8 |
| Admin photos: scene chip, Move to scene between scenes, `scene_gone` sentence plus refreshed options, nothing moved | pass | e2e #9 |
| Collage storyline at 390 px: headings in order Santa arrives, Cookies, cocoa and carols, Other pictures; caption shown; scene-only-hidden photos makes the scene vanish; unhide restores | pass | e2e #9; screenshot reviewed |
| Scene text with `<b>`, `<script>`, `<img onerror>` renders as literal text, no elements | pass | e2e #10 |
| Zero-scene session: one "Group pictures" grid (`collage-group`), no `collage-scene`, no scene controls on the photos page | pass | e2e #11 |
| Practice reset keeps scenes, deletes photos | pass | e2e removed/reset test |
| Admin card count text and delete-dialog count | **FAIL (D2)** | see below |
| Code rotation forgets the sticky choice | **FAIL (D1)** | see below |
| Real phone, offline outbox (L6), Safari/iOS | not run | needs a device; request user verification before ship (offline outbox with a cached list; photos queued for a scene deleted before the queue drains) |
| L7 print | n/a (Slice C not built) | |

### Defects (send back to implementers)

**D2 (api-developer; ux consequence) — scene photo counts are always 0.** `src/lib/santas-workshop/scene-queries.ts:40-41`. *Established:* Drizzle's generated SQL for the select is `select "id", (select count(*) from sw_photos sp where sp.scene_id = "id")::int from "sw_scenes" …` (printed with `toSQL()`); inside the subquery the unqualified `"id"` binds to `sp.id`, so the predicate is `scene_id = <photo's own id>` and never matches. Live repro: scene "Santa arrives" held 2 photos (DB count 2, and the same scene renders on the public collage) while the card row read "No photos yet. It will not show on the collage until it has one." and the delete dialog read "No photos are in this scene." (e2e #12, failing at `santas-workshop-scenes.spec.ts` `toContainText("2 photos")`). Consequences: the T4 requirement (dialog states the real count) is not met, the amber "all hidden, will not show" chip can never appear, and an admin is told a visible scene is empty. *Belief (not independently proven):* the unit tests mock the DB, so none could see it. Fix: qualify the outer reference (for example write `sw_scenes.id` in the raw SQL, or join and group), and add a test that renders the query's SQL or an integration check. I found no other correlated subquery in the scene modules. The DELETE response `movedPhotos` (toast) was not reached by the failing test, so recheck it after the fix.

**D1 (ux-developer) — sticky scene and cached list survive code rotation or expiry on a cold load.** `src/app/santas-workshop/crew/[slug]/page.tsx:32` renders the server-side `CodeEntry` when the cookie is invalid; the only `clearSceneStore(slug)` calls are in `crew-app.tsx:125-129` (a live `CrewApp` that sees a 401) and in the panel's own auth-lost branch, so neither runs on a cold load. Repro (e2e #13): pick a scene, rotate the worker code (`POST …/crew-code {action:"rotate",acknowledge:true}`), reload (code screen shows), re-enter the new code, open Group photo: the previous choice is still selected and capture is enabled instead of "Pick a scene first." Contradicts the design comment in `crew-app.tsx` and the ux handoff ("rotate the worker code and confirm the choice is forgotten"). Impact is a wrong-scene tap risk on a phone reused after the 72-hour cookie lapses; admin reassign is the recovery. Fix: call `clearSceneStore(slug)` from a mount effect in `code-entry.tsx`.

### Outputs
- `e2e/santas-workshop-scenes.spec.ts` (new, 13 tests; two are the red regression tests for D1 and D2 and will pass once fixed).
- Feature-gate audit (read from the route files; no migrations touched by QA):

| Route or action | `auth()` | `hasFeature(...)` | Key |
|---|---|---|---|
| `GET/POST /api/admin/santas-workshop/sessions/[id]/scenes` | yes | yes | `FEATURES.SANTAS_WORKSHOP_MANAGE` |
| `PATCH/DELETE …/scenes/[sceneId]` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `PUT …/scenes/order` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `PUT /api/admin/santas-workshop/photos/[photoId]/scene` | yes | yes | `SANTAS_WORKSHOP_MANAGE` |
| `GET /api/santas-workshop/crew/[slug]/scenes` | n/a (crew code) | `requireCrew()` first | crew gate, scoped by the code's session |
| `POST …/crew/[slug]/group-photos` (changed) | n/a (crew code) | `requireCrew()` first | crew gate |

- Coverage on `events.ts` / `permissions.ts` / `members.ts`: not re-measured (no change to those modules in this diff).
- Branch DB after cleanup (feature branch, `ep-steep-field-…`): `sw_sessions` 0, `sw_scenes` 0, `sw_photos` 0, `sw_crew_attempts` 0 (every spec's afterAll removed its rows). The e2e admin user was inherited from the parent branch and left. The gitignored local photo store `.santas-workshop-store/` in the worktree was deleted. Dev server on :3200 stopped.

### Open questions / handoff notes
- **Next agent: api-developer for D2, ux-developer for D1**, then QA re-runs `santas-workshop-scenes.spec.ts` (expect 13/13) and the full gate stack. After D2 is fixed, also confirm the delete toast says the real count.
- The two `crew-flow` failures ("Parent" fixture collision) are pre-existing at base and should be filed separately; they also hide the 12 tests that follow them in that serial spec.
- Before ship: user to verify L6 on a real phone (offline outbox with a cached scene list; delete a scene while photos wait; iOS Safari "Choose a saved photo").
- `drizzle-kit push` was not run (B-165 prompt); migration 0117 alone created the objects, and dev startup applied it idempotently again.

## Phase 4 fix (D1, D2) — 2026-11-04

**Owner:** full-stack-developer. **Status:** complete.

- D2: `scene-queries.ts` correlated counts now use `sw_scenes.id` (Drizzle renders a single-table select unqualified, so `${swScenes.id}` bound to `sw_photos.id`). Regression: `scene-query-sql.test.ts` (source scan). The delete route's `movedPhotos` count was never affected (plain filtered count) and the e2e dialog/row assertions now see the real counts.
- D1: `code-entry.tsx` calls `clearSceneStore(slug)` in a mount effect; source test added to `group-panel-source.test.ts`.
- Gates: tsc, lint (1 pre-existing warning), test (340 files, 5918 tests), `pnpm build:only` pass. `santas-workshop-scenes.spec.ts` on :3300 against the feature branch DB: 14/14 pass (incl. #12, #13). Dev server stopped.
- Note: `movedPhotos` counts unpurged photos including superseded ones, while the card count excludes superseded; minor wording divergence, not changed.
- Next: qa re-run of the full gate stack.

## Phase 5 — Re-verification — 2026-11-04

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** D1 and D2 are fixed and the rest of the stack is green. Measured on worktree `/Users/cshenso/git/westervillelions-scenes`, branch `feature/group-photo-scenes`, HEAD `8739460` (rebased onto main `9aeb578`, v1.100.5), clean tree before this entry. Branch DB host `ep-steep-field-amz4eiik-pooler` confirmed before any write; dev server on :3400 (NEXTAUTH_URL/AUTH_URL overridden, `RESEND_API_KEY` blank, no `EMAIL_DEV_ALLOWLIST`, so nothing could send); main tree, :3000, dev branch and production untouched.

### What I did
| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors; the 1 pre-existing warning at `budget-context-panel.tsx:114`) |
| `pnpm test` | PASS: 343 files, 5937 tests, 5.3 s |
| `pnpm build:only` | PASS (exit 0; `/santas-workshop/c/[token]`, `/crew/[slug]`, `/f/[token]` dynamic, no warnings) |
| Dev start / migrations | `pnpm db:migrate` replay clean (only idempotent NOTICEs); no new migration needed from main |
| e2e `santas-workshop-scenes.spec.ts` + `-crew-flow.spec.ts` + `-clone.spec.ts` (:3400, 1 worker) | **39/39 pass** (3.9 min) |
| e2e `santas-workshop-collage.spec.ts` (post-rebase collage smoke) | 13/13 pass |

- **D2 fixed (confirmed live):** scene #1 (card row) and #37 (delete dialog and toast) assert the real counts via DB: card row reads "N photos", dialog reads "N photos are in this scene and will move to “Other pictures”.", toast reads "Scene deleted. N photos moved to Other pictures."; the scene then vanishes from the collage and the photos appear under "Other pictures".
- **D1 fixed (confirmed live):** #38 rotates the worker code, cold-reloads (code screen), re-enters the new code, and the Group photo panel again says "Pick a scene first." with no sticky choice.
- **Crew flow:** all 13 crew-flow tests pass, including the formerly failing "Parent" roster assertions (main's fixture fix) and "a group photo is filed in the scene the volunteer picked".
- **Clone coexists with scenes:** all 12 clone tests pass. A throwaway spec (created and deleted by me, not committed) made a practice session with one scene and cloned it via `cloneFrom`: 201, source has 1 scene, clone has 0 scenes (expected: scenes are not copied yet), and the clone form opens.
- **Collage storyline:** headings in order Santa arrives / Cookies, cocoa and carols / Other pictures, 15 images with 0 photo-door mismatches, zero-scene session still one "Group pictures" grid, removed state prints no scene text.
- L1, L2, L4, L5 re-ran inside the scenes spec and held (L1: 1 response signature across 8 id variants; L2: 20 racing uploads, 0 failed, all fall to no scene; L5: 10/10 name-shaped accepted, 10/10 contact-shaped rejected).
- Feature-gate audit: unchanged since the Phase 5 report (no route files changed by D1/D2 or the rebase); all four admin scene routes carry `auth()` + `hasFeature(FEATURES.SANTAS_WORKSHOP_MANAGE)`, crew routes call `requireCrew()` first.
- Cleanup: every spec removed its rows; branch DB counts after: `sw_sessions` 0, `sw_scenes` 0, `sw_photos` 0, `sw_crew_attempts` 0. Local photo store deleted, dev server on :3400 stopped (port free). Coverage not re-measured (no change to events/permissions/members).

### Outputs
- This work-log entry only (no code changes).

### Open questions / handoff notes
- Still unverified by any runner (carried from the first report, needs a real phone before ship): L6 offline outbox with a cached scene list, a scene deleted while photos wait in the queue, iOS Safari "Choose a saved photo".
- `drizzle-kit push` not run (B-165 prompt); migration 0117 alone creates the objects.
- Minor wording divergence noted by the implementer: toast `movedPhotos` counts superseded photos, card count does not. Not a defect.
- Next agent: `analyst` for Phase 6.

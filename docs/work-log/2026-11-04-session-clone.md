# Clone a Santa's Workshop session — Work Log

> **Slug:** `2026-11-04-session-clone`
> **Surface:** (dashboard) admin (`/admin/santas-workshop`)
> **Permission(s):** existing `santas_workshop.manage` covers this (no new key, no role binding)
> **Estimated complexity:** small (about a day; no schema)
> **Pipeline mode:** Full, with a brief Phase 2 (one structural question: how clone shares the create path and, later, the scenes copy). Hard dates: real event Dec 18 to 20, 2026; dry run week of Dec 7.
> **Reserved IDs:** DECISION-129
> (earlier note: DECISION-128 is taken by the scenes feature, Proposed)

---

## Request (user, 2026-11-04, after a practice run)

> "we might want to be able to clone a session (minus the pictures) so less setup is needed. you would enter a new zeffy campaign and whether it was practice or live"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-04 |
| 2 — Architectural review | tech-lead (accelerated, see Phase 2) | Complete | Approved | 2026-11-04 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-11-04 |
| 4 — Implementation | full-stack-developer | Complete (gates green) | — | 2026-11-04 |
| 5 — Verification | qa | Complete | PASS | 2026-11-04 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-11-04 |

---

# Phase 1 — Functional Refinement (analyst)

**Owner:** analyst · **Date:** 2026-11-04 · **Status:** complete

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> An admin starts a new draft session from an existing one, with the setup copied (dates, drop-off windows, question map, frame settings, and later the scenes) and everything that belongs to a specific run left fresh (Zeffy form, worker code, collage link, photos, people); the proposed shape is right, but three of the "copied" items are traps if copied blindly (storage quota and frame file prefix change meaning with the kind, dates change meaning with the year), and the scenes copy cannot live only inside clone because the real session will exist before Howard writes the storyline.

## Confirmation of the proposed shape

Confirmed, with these corrections and refinements.

1. **Clone is the existing "New session" form, pre-filled from a source session, not a second creation path.** `/admin/santas-workshop/new` already collects name, slug, kind, the three dates and the windows (`SessionForm`, `validateCreateSession`, `createSession`). Clone = the same page with `?cloneFrom=<session id>` that pre-fills those fields from the source instead of from `WORKSHOP_2026`. The button is "Clone session" on the source session's page. The server fills in everything the form does not collect by reading the source row itself. The client never posts the question map, frame settings, quota or scenes: those are read server-side from the source, so there is nothing for a forged request to inject. One create path means one place that mints the collage token, retention defaults and audit row (the CLAUDE.md duplication rule).
2. **Kind: all four directions allowed**, including real to real (next year) and real to practice. Recommended default confirmed. The kind is chosen on the form and immutable after, exactly as today.
3. **Zeffy is not entered in the clone form; clone lands on the new session's Connect page.** See "Zeffy" below. This still satisfies "you would enter a new Zeffy campaign": it is the very next screen, with the existing picker, rate selection and verification.
4. **No schema change.** Nothing is recorded on the row about where it came from; the audit row says so (ids only). So there is no migration, no Neon branch, no worktree needed for the schema reason, and no collision with the scenes pipeline's migration.
5. **The scenes dependency is real but one-directional:** clone core ships first and does not touch scenes; the scenes feature (or a follow-on task owned by it) adds the scene copy later. See "Scenes".

## What is copied and what is fresh (the ruling table)

| Item | Clone does | Why / trap |
|---|---|---|
| name | **Fresh, required.** Pre-filled with the default name for the chosen kind (as `defaultSessionDraft` does), never "Copy of <source>" and never the source's name | A copied name like "Santa's Workshop dry run" on a live session is the kind of mistake nobody notices until it is on a frame or an email |
| slug | **Fresh, required, blank.** Unique (409 `slug_taken`, field error, form keeps its values) | Immutable, and it names the Drive folder; a second click on submit gets the same 409, which makes double-submit harmless |
| kind | **Chosen** (practice or real) | Immutable after |
| dropoff / photo / pickup dates | **Pre-filled from the source, editable, validated** by the existing validators | Copying a past year's dates silently is wrong for real to real; the form shows them so the admin sees them. A date before today (Eastern) shows a warning, not a refusal |
| crew-closes-on and the two purge dates | **Copied from the source only when the new pickup date equals the source's; otherwise the standard defaults** (`defaultCrewClosesOn`, `defaultRetention`), and the result is checked with `validateSessionDates` | The form does not collect them today. Re-dating the pickup and keeping an old purge date would produce an impossible or already-due schedule |
| windows (id, label, start, end) | **Pre-filled, editable** through the existing window validator | Window ids are session-local text on the orders, so reusing them is safe. Labels must match the Zeffy form's drop-off answers; a mismatch surfaces through the existing unmatched-window-answers panel, not silently |
| question map | **Copied** (server-side, from the source row) | See "Question map" |
| frame art key, part size | **Copied** | `frameArtKey` is a plain string selecting art that ships in the app (`frame-art` slot); there is no per-session asset in the photo store, so no asset copy is needed or possible |
| frame file prefix | **Copied only when the kind is unchanged; reset to the default (empty) when the kind changes** | A prefix typed for a practice run ends up on the real frames' file names otherwise. Phase 3 to confirm what values are used in practice |
| storage quota | **Same kind: copied. Different kind: the default for the new kind** (real 600 MB, practice 100 MB) | **Copying blindly is a trap:** practice to real would give the live session the practice 100 MB cap, and the first photo day would fail on a full quota. Show the resulting quota on the form as a read-only line |
| scenes | **Later** (Slice-A-dependent); see "Scenes" | Table does not exist yet |
| status | **draft** | Never active: activation generates the worker code, and a real session also needs a fresh storage test |
| worker code, code version, paused flag | **Fresh** (code null until activation, version 1, not paused) | A code is a credential |
| collage token | **Fresh** (`newToken128()`), never copied | The old token's URL is printed on frames and QR codes; a copy would make two sessions answer to a printed link (the unique index would reject it anyway, but a test must pin it) |
| storage folder key | **Fresh (null)** | Created from the new slug on the first upload |
| Zeffy campaign id, title, ticket rate ids | **Fresh (null, empty)** | One campaign maps to one session (unique index), and rate ids belong to the form |
| orders, stuffies, photos, history, session log, publish/reviewed stamps, purge markers, frame numbers | **Not copied** | "Minus the pictures", and minus every person |
| created-by | The cloning admin | Normal |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Admin (`santas_workshop.manage`) | Click "Clone session" on a session's page | Once per year for a real run; once or twice a season for practice |
| Admin | Review the pre-filled form (name, slug, kind, dates, windows), fix the dates, choose practice or real, submit | Same |
| Admin | Land on the new session's Connect page and connect its own Zeffy form | Same |
| Admin | Check the copied question map after the first test purchase, then do the normal go-live steps | Same |
| Anonymous visitor, signed-in member, access-pending member, crew volunteer | None. Nothing here is visible to them, and a draft session has no public surface | n/a |

## Flows

**Flow 1 — Clone for the live run (practice to real).** `/admin/santas-workshop/<practice id>` → "Clone session" → `/admin/santas-workshop/new?cloneFrom=<id>` with a banner "Starting from <source name>. Dates, drop-off windows and question mapping are copied. The Zeffy form, worker code and photos are not." → choose **Live** (existing UI labels the kind; the user's word is "live", the stored value is `real`), enter name and slug, correct the dates to the real event, submit → `201`, redirect to `/admin/santas-workshop/<new id>/connect` with a one-line "Cloned. Next: connect this session's Zeffy form." → pick the form and the ticket rates → the session page, where the go-live checklist already shows what remains (the "required fields unmapped" item is satisfied at once by the copied map).
- Failure: slug taken → field error on the slug, nothing else lost. A date that fails validation → the existing field error. Source session deleted or id malformed → the new-session page shows "That session no longer exists" with a link back to the list (never a blank form silently falling back to defaults, which would hide that the copy did not happen). Database down → the form's existing error toast, form keeps its text. A partial clone is impossible: the create is one transaction.

**Flow 2 — Clone for next year (real to real), source purged.** Same screen. Expected to be the most common source in a year: this year's real session will be personal-purged by Jan 19 and public-purged by Jan 31, 2027, and the clone is made in the fall of 2027. **A purged (or closed) source must be allowed**, since it holds only configuration after the purge. Phase 3 must confirm in code that neither purge nulls or alters windows, the question map or frame settings (it should not: the purge nulls parent/child data, raw answers, notes and the webhook snapshot).
- Failure/edge: dates arrive as last year's, in the past; the form warns on each stale date. Nothing blocks, because rehearsing a past date is legitimate in a test environment.

**Flow 3 — Clone for the dry run (real to practice, or practice to practice).** Same screen, kind Practice, quota resets to the practice default, prefix to the default. The practice form in Zeffy is a separate campaign; connect it on the next page. (The Dec 7 dry run may instead simply reuse the existing practice session through the existing Reset, which keeps configuration; clone is for when a clean second practice session is wanted.)

## Permissions

- **Permission(s):** existing `santas_workshop.manage`. The page calls `auth()` + `hasFeature()` like its siblings and redirects a non-holder to `/access-pending`; the create route (or a new `…/sessions/[id]/clone` route, Phase 3's call) calls `auth()` then `hasFeature()` as its first two statements so `admin-routes-gate.test.ts` covers it, 401/403 otherwise.
- **Default roles:** unchanged (`admin`, `board_member`). Never `treasurer`, `member`, or an `admin.*` key.
- A clone reveals nothing a holder could not already read: the holders manage every session, and the response is the new session's own DTO. There is no per-session ACL to bypass.

## Zeffy (the one the user named)

Recommendation: **clone first, then the Connect page, not an embedded picker in the clone form.**
- Connect already does everything needed: campaign picker, ticket-rate selection (hydrated again as of today's fix), verification against Zeffy, the unique-campaign 409 (`campaign_in_use`, "already connected to another session"), and the unverified path when Zeffy cannot be asked.
- Embedding it in the clone form would couple creation to the Zeffy API (rate limits, outage, the dev allowlist): a Zeffy failure would block creating the session. As two steps, a Zeffy outage leaves a perfectly good draft.
- A draft with no campaign is already a valid, supported state; nothing breaks if the admin walks away between the two steps (the session page checklist says "connect a Zeffy form").
- **Preference, not a question to the user:** if they would rather type the Zeffy form id on the clone screen, that is an additive follow-up. Default stands.

## Question map with a different campaign

The map is normalized question text to a field (several strings per field). Strings that never appear on the new form are inert: nothing matches them, and any question on the new form that is not in the map shows up in the existing Needs attention flow with its raw text, never dropped. So stale strings are harmless. The upside is large: if the new Zeffy form was made by duplicating the old one, every string matches and the mapping step disappears. Two small gaps:
- The map is only proved by the first purchase. Say so on the post-clone banner: "Question mapping was copied. Make a test purchase and check Needs attention." (No new UI beyond a sentence; the checklist already has the unmapped-required-fields item.)
- A string may belong to one field only (`duplicate_mapping`). The copy is valid by construction; the server still passes it through `validateQuestionMap` before writing (no unvalidated write path).

## Scenes (sequencing and the correction to "Slice B is replaced")

Sound idea, but the premise needs a correction. The scenes design's Slice B has "Copy scenes from another session" as a button on an existing, empty target session. The user expects clone to replace it. **Clone can replace it only when the scenes exist before the clone is made.** The real session will exist first (created about Nov 5, taking sign-ups from Nov 8), while Howard writes the storyline later, during the rehearsal (scenes Slice A targets Nov 25). At that moment the target already exists, and clone cannot add to an existing session by design. Therefore:

| Where Howard authors the storyline | What carries it to the other session |
|---|---|
| In the **practice** session, real already exists (the likely order) | Slice B's "Copy scenes from another session" button on the real session. Clone cannot do this. |
| In the **real** session | Clone real to practice later carries them, if clone includes scenes. |
| Next year, real to real | Clone carries them. |

**Recommended default (preference, proceed):** keep Slice B's copy-scenes control (it is already designed, about one route and one button) **and** have clone call that same `copyScenes()` helper, so the logic exists once. Do not build a second implementation inside clone. Constraints for Phase 2/3, because scenes' own scans bind them: `swScenes` may be written only in `scene-admin.ts` after `validateSceneText`, so clone must call into `scene-admin` (passing the open transaction), never insert scene rows itself; the cap and "target must be empty" decision is made under `FOR UPDATE` on the session row (R3), which is trivially satisfied for a session created in the same transaction. The whole clone (session row plus scenes) is one transaction: if the scene copy fails, no session is created.

Sequence: **clone core ships now and needs nothing from scenes.** When the scenes feature is merged (its worktree rebases onto main; the files that both touch are `admin-contract.ts` error codes, `session-log.ts` kinds, `session-queries.ts` and the session page), a small follow-on adds an "Include the N scenes" checkbox (default on, shown only when the source has scenes). That follow-on belongs to whichever pipeline merges second. Clone core must not import `swScenes`, because the table does not exist on main yet.

## Gaps the Request Didn't Address

1. **Kind-sensitive settings** (quota, file prefix): copying them as-is is wrong when the kind changes (table above). Without the rule, the main use case (practice to real) gets a 100 MB cap on photo day. Resolution: same-kind copies, cross-kind uses the target kind's default, quota shown on the form.
2. **Dates are not a pure copy.** Purge and crew-closes dates are derived from the pickup date today; the clone rule above keeps the schedule coherent when the date moves. A test must pin: pickup changed gives default derivations; pickup unchanged copies; never a schedule `validateSessionDates` rejects.
3. **Purged and closed sources must work**, and the clone must not read anything the purge removed (the stored webhook snapshot, raw answers). Resolution: the clone reads only the config columns by explicit name (never `select *` into a DTO), pinned by a source scan.
4. **Never copy a credential or an identifier of a run:** worker code ciphertext and version, collage token, storage folder key, Zeffy ids, publish stamp, purge markers. Resolution: an allow-list of copied columns in the clone function (not a spread of the source row), plus a test that a source with every field populated yields a clone where each fresh column differs.
5. **One-active-real-session (B-209) interplay.** Clone makes a draft, so it can never create a second active real session; the conflict would appear at Activate, where B-209's typed 409 handles it once that lands. No special handling in clone. Stated so nobody adds one.
6. **Audit.** One `sw_session_log` row on the new session: kind `created` with detail `{ kind, clonedFrom: <source id>, scenes: <n or omitted> }` (ids and counts only, like every other row; never the name, slug text, or question strings). An optional second row on the source ("cloned") is not needed and not recommended.
7. **Where to learn the source.** A reviewer or the chair opening the new session later has no visible link to its origin. Acceptable (the audit row holds it); a "Created from <name>" line on the session page needs a column and is out of scope.
8. **Rate ids and the question map interplay with Remap.** After connecting, a Remap (existing) re-evaluates stored orders; there are none on a clone. No change.
9. **Empty state / brand / mobile:** the clone screen is the existing form, so cards stay `rounded-2xl`, buttons `rounded-lg`, 360px behavior inherited. The "Clone session" button is a secondary-style button in the session header, 44px tall, with the gold/blue focus ring. No `ConfirmDialog` is needed (nothing destructive, and the form is the confirmation).
10. **Email, Google Groups, OAuth-vs-password, access-pending:** not touched. Nothing is sent, nothing syncs. Not a durable-claim path.
11. **Concurrent working tree.** The scenes pipeline works in `/Users/cshenso/git/westervillelions-scenes` on a branch. Clone core touches `session-queries.ts`, `session-input.ts` (a clone pre-fill helper), `admin-contract.ts`, `session-log.ts` (only if a `cloned` kind is wanted; the recommendation is to reuse `created`, so no change), the new page and the session page header. No migration, so the main tree and the main dev server are safe; the scenes branch will rebase over it.

## Adversarial pass

- **Redirects:** `?cloneFrom=` is a uuid, not a URL. A non-uuid is treated as absent with the visible "That session no longer exists" message. The post-create redirect target is built server-side from the new id (`/admin/santas-workshop/<id>/connect`), no user-controlled `callbackUrl`.
- **State shortcuts:** POSTing a clone directly is the same gate as POSTing a create (`santas_workshop.manage`); the crew cookie is not a NextAuth session and cannot reach it. The source id is looked up server-side; an unknown id is a 404 with the same body whether it never existed or was deleted.
- **Enumeration:** none beyond what holders already see (the sessions list).
- **Input boundaries:** all form fields go through the existing create validators (length, slug pattern, dates, windows cap). The copied values come from the database, not the client, and still pass the same validators before the insert (rules may have tightened since the source was made). Overlong or empty name/slug is rejected on the server.
- **Self-targeting:** no role or identity change.
- **Double submit:** the slug uniqueness makes the second submit a 409 rather than a second session.
- **Leak by copy:** nothing personal can be copied because no personal column is in the allow-list; the question map contains question text, which is club copy (the form's questions), not answers.

## Out of Scope (confirm with user)

- Cloning orders, stuffies, photos, history or the worker code (explicitly excluded by "minus the pictures" and by privacy).
- Cloning into an existing session, other than the scenes copy that stays in scenes' Slice B.
- Creating or duplicating the Zeffy form itself through the Zeffy API.
- A reusable "template" object, bulk clone, or a visible "created from" link (needs a column).
- Changing B-209 or the one-active-real-session index.
- Renaming "real" to "live" in the stored data (only the label question below).

## Open Questions

None is a BLOCKING FACT: the build is the same either way. One fact changes the order of work, shown as a both-outcomes table so nothing is defaulted:

| Question (a fact about the club's real situation) | If the real session already exists (created by hand) | If it does not exist yet |
|---|---|---|
| Has the real (live) session been created already, or will it be created from the practice session? | Clone does not help this launch; its value is the Dec 7 dry-run session and next year. Ship it on the normal schedule (target before Dec 7); keep Slice B's copy-scenes for the real session. | Clone is worth shipping first, before the Nov 8 launch if the pipeline can finish in time; practice to real then carries dates, windows and the question map. Anything not done by the launch is created by hand as today. |

Preferences (defaults stated; proceed unless the user objects):
- All directions allowed, including real to real: confirmed, default.
- Dates pre-filled from the source and editable, with a warning (not a refusal) for a date already past.
- Name pre-filled with the new kind's default, slug blank; quota and prefix follow the kind rule above.
- Zeffy connected on the next page, not in the clone form.
- Keep Slice B's "copy scenes from another session" button; clone shares its helper (the user expected clone to replace it; see "Scenes").
- UI label: use the existing admin wording for the kind. The user says "live", the stored value is `real`; keep whichever label the form uses today and mention it in Phase 3 if "Live" would read better.
- Audit as one `created` row with `clonedFrom`; no schema.

## Production facts

None needed. No Verify-First block. The only "fact" the verdict depends on (whether purge preserves configuration columns) is answerable by reading `retention.ts`, which Phase 3 does.

## Handoff

**Owner:** analyst · **Status:** complete

### Summary
READY WITH NOTES. Clone is the existing New session form pre-filled from a source session, plus a server-side copy of the configuration the form does not collect, landing on the Connect page for the new session's own Zeffy form. It adds no schema, no permission and no dependency. The notes become Phase 3 inputs: kind-sensitive quota and prefix, date handling, allow-listed columns only, purged sources allowed, atomic create, and scenes copied through the shared `copyScenes()` helper once scenes lands.

### What I did
- Read CLAUDE.md Santa's Workshop bullets, the scenes work-log (Phases 1 to 3), B-209, the session schema, `session-input.ts`, `session-queries.ts` (create, connect), `session-status.ts`, `session-log.ts`, the checklist and the new-session page.
- Ran the five passes: verbs, flows, permissions, gaps, adversarial.
- Corrected two assumptions in the brief: that the quota and frame settings can be copied verbatim (quota and prefix are kind-sensitive), and that clone fully replaces scenes' copy button (it cannot when the target already exists).

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-11-04-session-clone.md` (this file). No code, commit or push.

### Open questions / handoff notes
- User, one line (not blocking): has the real session already been created? It sets the order of work, not the design (table above).
- Architect (Phase 2): confirm (a) clone as `?cloneFrom=` on the existing page and create route versus a separate route, (b) that clone core does not import `swScenes` and the scenes copy arrives via `scene-admin` with a transaction handle, (c) the allow-list-of-columns approach and its scan test.
- Tech-lead (Phase 3): confirm in `retention.ts` that neither purge alters the copied config; decide whether the kind label should read "Live"; name the implementer (full-stack-developer is expected).
- Orchestrator: no Neon branch or worktree is needed for this pipeline (no migration); the scenes branch will need a rebase over the merged clone core.

---

# Phase 2 — Architectural Review

**Phase 2 performed by tech-lead (accelerated: no new directory, dependency, schema or permission; one create path reused).**

**Owner:** tech-lead · **Date:** 2026-11-04 · **Status:** complete · **Verdict:** Approved

### Checks, each answered from the code

1. **Structure.** No new directory (the new files sit in `src/lib/santas-workshop/`), no dependency, no schema, no permission, no new `FEATURES` key. Clone is the existing create path (`POST /api/admin/santas-workshop/sessions`, `createSession`, the New session page and `SessionForm`) with an optional `cloneFrom`. A second route would duplicate the one place that mints the collage token, the retention defaults and the audit row (CLAUDE.md duplication rule). Approved as `?cloneFrom=` on the existing page and route.
2. **The client never posts uncopied fields.** The request carries the form's own fields (`name, slug, kind, dropoffDate, photoDate, pickupDate, windows`) plus `cloneFrom` (a uuid). `validateCreateSession` already reads only named keys, so an extra posted key (question map, quota, token) is ignored by construction. The question map, quota, frame art, part size and the crew-closes and purge dates are read from the source row **on the server**, inside the create transaction's data load.
3. **Explicit column allowlist, one transaction.** Two allowlists, both written out by name and scan-tested: (a) the **read** list, `getCloneSource()` selects named columns only (`db.select({ ... })`, never `select()`), so `crewCodeEnc`, `collageToken`, `zeffy*`, `storageFolderKey` and the stamps are never loaded into memory; (b) the **write** list, the insert values are built from a typed `CloneConfig` object, never a spread of the source row. Source read, session insert and `created` audit row run in one `db.transaction`; the audit row is inserted with `tx` (the existing `logSessionEvent()` uses the global `db` and would escape the transaction). A slug collision rolls the whole transaction back and maps to `409 slug_taken`, as today.
4. **Purged and closed sources are allowed, confirmed in `retention.ts`.** The only writes to `sw_sessions` in the file are line 288 (`{ ...marker, status: "purged" when both scopes done, updatedAt }`) and line 426 (practice reset: `collagePublishedAt: null, status: "draft", personalPurgedAt: null, publicPurgedAt: null, updatedAt`). The personal scope (lines 244 to 275) rewrites `sw_orders`, `sw_stuffies`, `sw_session_log.detail` and the `zeffy_events` payloads; the public scope touches `sw_photos` rows and bytes. **Neither purge, nor reset, touches `windows`, `question_map`, `storage_quota_bytes`, `frame_art_key`, `frame_file_prefix`, `frame_part_size`, the three dates, `crew_closes_on` or the purge dates.** The clone reads none of the tables the purge empties. Allowed for every status including `purged`.
5. **Scenes seam.** Clone core must not import or write `sw_scenes`: the table and `scene-admin.ts` exist only in the scenes worktree (`/Users/cshenso/git/westervillelions-scenes`, untracked `scene-admin.ts` and `scene-queries.ts` there) and a `swScenes` import would not compile on main. The seam is a single function, `insertClonedSession(tx, ...)`, that runs inside the transaction and returns the new row; the later step adds one call, `await copyScenes(tx, sourceId, newId)` (from `scene-admin.ts`, passing the open transaction, no direct insert), after it and before commit, plus an `includeScenes` request flag and the "Include the N scenes" checkbox. A source scan pins that the clone module and the clone section of `session-queries.ts` contain neither `swScenes`, `sw_scenes` nor `scene-admin`.
6. **Invariants.** Not a durable-claim path (no email, nothing sent). Not a money, permission or credential write: the credential rule is that the worker code is **not** copied, pinned by the allowlist test. No raw SQL, no `callbackUrl`. Auth and gate stay the route's first two statements (`admin-routes-gate.test.ts` already covers the sessions route).

No loop-back to Phase 1. One refinement of Phase 1 is a ruling in Phase 3 (frame prefix).

---

# Phase 3 — Technical Design (tech-lead)

**Owner:** tech-lead · **Date:** 2026-11-04 · **Status:** complete

## Rulings that differ from Phase 1/2 (read first)

1. **Frame file prefix is never copied** (Phase 1: copy when the kind is unchanged). Reason read from `frame-names.ts`: an empty prefix already derives `ssw-<slug>` from the new slug, which is unique and right; a non-empty prefix is by nature one run's identity, and a real-to-real copy next year would stamp 2026's prefix on 2027's frames. The clone's prefix is always `""`. Quota keeps Phase 1's rule (same kind copies, different kind uses `DEFAULT_QUOTA_BYTES[kind]`).
2. **The clone form opens on Practice**, whatever the source's kind (the existing page's default). A wrong click toward Real is the unrecoverable one (kind is immutable, and Real gets the 600 MB quota and the one-active-real-session rule). So real-to-real needs one deliberate click. The kind labels stay "Practice" and "Real" as the whole admin area uses them; no "Live" rename (it would touch labels in about ten places for no gain, and the user's word is already understood).
3. **No new error codes and no new `SessionLogKind`.** Clone reuses `created` with `detail: { kind, clonedFrom }` (ids only). This keeps `admin-contract.ts` to one added optional field and leaves `session-log.ts` untouched, both of which the scenes branch edits.
4. **The non-clone create becomes transactional too** (small deviation, under 30 lines): today `createSession` inserts the row and then logs with the global `db`; the shared helper takes a `tx`, so both paths are atomic. Behavior is unchanged to the caller.
5. **Slug suggestion avoids the source slug** (new, about 6 lines): `suggestSlug("practice", "2026-12-18")` returns `practice-2026`, which collides with a source of the same name in the common practice-to-practice case. The clone form suggests `<suggestion>-2` when the suggestion equals the source's slug. The 409 stays the backstop.
6. **A persistent hint on Connect** (`?cloned=1`, about 10 lines in the Connect page) in addition to the toast, because a toast disappears and the "make a test purchase" instruction is the one that matters. Optional for the implementer's judgment only if it grows beyond 30 lines.

## Summary

An admin clicks "Clone session" on a session page and lands on the New session form pre-filled from that session. They choose the kind, give a name and slug, adjust the dates, and submit. The server creates a draft session in one transaction, copying the configuration the form does not collect (question map, quota, frame art and part size, and the crew-closes and purge dates when the pickup date has not moved) from the source row, and leaves everything that belongs to one run fresh. The browser then opens the new session's Connect page for its own Zeffy form. No schema, no migration, no permission, no dependency.

## Permissions

None new. `santas_workshop.manage` (bound to `admin`, `board_member`), checked by `auth()` then `hasFeature()` as the first two statements of the existing route and page. No role binding, no migration.

## API contract

**Carrier:** `src/lib/santas-workshop/admin-contract.ts`, one added optional field on the existing request type; response and error envelope unchanged. The UI imports it, so removing the field breaks `tsc` in the form.

```ts
export interface CreateSessionRequest {
  name: string; slug: string; kind: SessionKind;
  dropoffDate: string; photoDate: string; pickupDate: string;
  windows: SessionWindow[];
  /** Clone: the source session id. The server reads every field the form does not collect from that row. */
  cloneFrom?: string;
}
```

`POST /api/admin/santas-workshop/sessions` (existing), body as above, response `201 { session: SessionDto }` (the new draft).

| Case | Status / code | Field |
|---|---|---|
| Not signed in / no permission | 401 `unauthorized` / 403 `forbidden` | |
| `cloneFrom` present but not a uuid | 400 `invalid_input` | `cloneFrom` |
| Any existing create validation failure | 400 `invalid_input` | as today |
| `cloneFrom` is a uuid and no such session | 404 `not_found` (nothing inserted) | `cloneFrom` |
| The source's copied values no longer pass the validators (rules tightened since it was made) | 400 `invalid_input`, message "The source session's settings need fixing before it can be cloned" | `cloneFrom` |
| Slug in use | 409 `slug_taken` (transaction rolled back) | `slug` |

**Server behavior, in order** (all in `createSession(input, userId)`; `input.cloneFrom` undefined takes the existing path unchanged):

1. `validateCreateSession` (adds: `cloneFrom`, when present, must match a uuid regex).
2. If `cloneFrom`: `getCloneSource(id)` selecting only `id, slug, name, kind, pickupDate, crewClosesOn, purgePersonalOn, purgePublicOn, storageQuotaBytes, frameArtKey, framePartSize, questionMap` (a typed `CloneSource`). Null returns the 404.
3. `cloneConfig(source, input)` (pure, below) returns a `CloneConfig` or a typed failure.
4. `db.transaction`: insert the row from `buildSessionValues(...)` (shared with the plain path: slug, name, kind, the three dates, windows, fresh `newToken128()`, `createdByUserId`, plus the clone config or the plain defaults), then insert the `created` audit row with `tx`. Return the DTO.

### Copy rules (`cloneConfig`, pure)

| Column | Rule |
|---|---|
| `windows`, name, slug, kind, three dates | From the request (the form pre-filled them from the source); not read from the source row |
| `crewClosesOn`, `purgePersonalOn`, `purgePublicOn` | If the posted `pickupDate` equals the source's: the source's three values; else `defaultCrewClosesOn(pickup)` / `defaultRetention(pickup)`. The chosen set goes through `validateSessionDates` with the posted dates; a copied set that fails falls back to the defaults (they are derived, so a fallback loses nothing the admin typed) |
| `storageQuotaBytes` | `input.kind === source.kind` and the source value passes the quota range: the source value; otherwise `DEFAULT_QUOTA_BYTES[input.kind]` |
| `frameFilePrefix` | Always `""` (ruling 1) |
| `frameArtKey`, `framePartSize` | Source values, checked by `validateUpdateSession({ frameArtKey, framePartSize })` (no new validator); failure is the 400 above |
| `questionMap` | Source value, checked by `validateQuestionMap({ map })`; failure is the 400 above. The validated (normalized) result is what is stored |
| Everything else | Column defaults: `status` draft, `zeffy*` null/empty, `crewCodeEnc` null, `crewCodeVersion` 1, `crewPaused` false, `collagePublishedAt` null, `storageFolderKey` null, purge stamps null. **Collage token is minted fresh and the source's is never read** |

Kind transitions: all four directions allowed. Practice-to-real gets 600 MB, real-to-practice gets 100 MB.

## Data model

No schema changes required. No migration, no Neon branch.

## Audit

One `sw_session_log` row on the **new** session, kind `created`, `detail: { kind, clonedFrom: <source uuid> }` (ids only; never a name, slug text or question string). No row on the source. The later scenes step adds `scenes: <n>` to the same row.

## Component / page plan

**New files**
- `src/lib/santas-workshop/session-clone.ts` (pure, client-safe, no DB): `CloneSource` type, `cloneConfig()`, `cloneDraft(source, kind?)` (name = default for the kind, never the source name; dates and windows from the source), `cloneQuotaBytes(sourceKind, sourceQuota, newKind)`, `suggestCloneSlug(kind, dropoffDate, sourceSlug)`, `isPastDay(day, today)`.
- `src/lib/santas-workshop/session-clone.test.ts`, `session-clone-source.test.ts` (tests below).

**Modified**
- `src/lib/santas-workshop/admin-contract.ts`: the one optional field.
- `src/lib/santas-workshop/session-input.ts`: `cloneFrom` check in `validateCreateSession` (about 5 lines).
- `src/lib/santas-workshop/session-queries.ts`: `getCloneSource()`, `createSession` refactor (transaction, shared `buildSessionValues`, `insertClonedSession` seam).
- `src/app/(dashboard)/admin/santas-workshop/new/page.tsx`: read `searchParams.cloneFrom` (a Promise in Next 16; read `node_modules/next/dist/docs/` for the current shape before writing). Absent: today's page. Present and valid: load the source, banner "Starting from <source name>. Dates, drop-off windows and question mapping are copied. The Zeffy form, worker code and photos are not.", and the form with `cloneDraft(...)`. Present and unusable (not a uuid, or no row): no form; a `rounded-2xl` empty-state card "That session no longer exists" with the back link. Never silently fall back to a blank form.
- `src/components/admin/santas-workshop/session-form.tsx` (`CreateSessionForm` only): optional `clone` prop `{ sourceId, sourceName, sourceSlug, sourceKind, sourceQuotaBytes, today }`; sends `cloneFrom`; slug via `suggestCloneSlug`; a gold-text inline note under each date earlier than `today` ("This date has already passed", a warning, never a block); a read-only line under the kind picker, "Photo storage limit: N MB (from the source)" or "(the default for a Real session)", from `cloneQuotaBytes`; on success `router.push(/admin/santas-workshop/<id>/connect?cloned=1)`.
- `src/app/(dashboard)/admin/santas-workshop/[sessionId]/page.tsx`: one `<Link href={`/admin/santas-workshop/new?cloneFrom=${s.id}`} className={BTN_SECONDARY}>Clone session</Link>` in the existing button row after "Edit session" (line 77). No `ConfirmDialog` (nothing destructive; the form is the confirmation).
- `src/app/(dashboard)/admin/santas-workshop/[sessionId]/connect/page.tsx`: read `searchParams.cloned`; when `"1"`, a short info card "Cloned. Next: connect this session's own Zeffy form. Question mapping was copied from the source: make a test purchase and check Needs attention."

Brand: `rounded-2xl` cards, `rounded-lg` buttons, `BTN_SECONDARY`, 44px tap height, 360px layout inherited from the form.

## Implementation order

1. `session-clone.ts` and its unit tests (pure, first).
2. `admin-contract.ts` field, `session-input.ts` check.
3. `session-queries.ts`: `getCloneSource`, transactional `createSession`, seam.
4. Route needs no edit (it already passes the validated body through); confirm.
5. New page, form, session-page button, Connect banner.
6. Release notes via `/release-notes` at ship time (draft below carries no version).

## Unit tests (named; the implementer delivers these)

`session-clone.test.ts`
- `cloneConfig copies the quota for the same kind and uses the new kind's default across kinds` (practice to real is 600 MB, real to practice is 100 MB; an out-of-range source quota falls to the default).
- `cloneConfig always resets the frame file prefix to empty`.
- `cloneConfig copies crew-closes and purge dates only when the pickup date is unchanged` (table of moved and unmoved pickups; moved yields the `defaultCrewClosesOn` / `defaultRetention` values).
- `cloneConfig never produces a date set validateSessionDates rejects` (over a table of pickup dates including year-end and a past year).
- `cloneConfig stores the validated, normalized question map and fails with a typed error when the source map is invalid`.
- `cloneConfig result has exactly the allowlisted keys` (key list `toEqual`; none of `crewCodeEnc, crewCodeVersion, crewPaused, collageToken, collagePublishedAt, zeffy*, storageFolderKey, status, *PurgedAt`).
- `cloneDraft uses the default name for the kind, never the source name, and takes dates and windows from the source`.
- `suggestCloneSlug differs from the source slug` and `isPastDay compares Eastern day strings, equal is not past`.
- `validateCreateSession accepts a uuid cloneFrom, rejects a non-uuid with field cloneFrom, and ignores posted questionMap, storageQuotaBytes and collageToken`.

`session-queries.test.ts` (extend; stub `db.transaction` with a recording fake)
- `clone inserts one session and one created log row with detail { kind, clonedFrom } in the same transaction`.
- `clone mints a collage token different from the source's` (the source token is not selected at all; assert the select shape).
- `clone of a missing source returns 404 not_found and inserts nothing`.
- `clone slug collision returns 409 slug_taken` and `the plain create path still logs { kind } only`.

`session-clone-source.test.ts` (source scans, the repo's habit)
- `getCloneSource selects the named columns only and none of the credential, token, Zeffy or stamp columns`.
- `session-clone.ts and the clone section of session-queries.ts never mention swScenes, sw_scenes or scene-admin`.
- `the session page links to /admin/santas-workshop/new?cloneFrom= and the new page never falls back to a blank form for a bad cloneFrom` (extend `admin-ui-source.test.ts` if that is its home).

`admin-routes-gate.test.ts` needs no change (the route is the existing one).

## Phase 5 live checks (rule a: unmeasured claims named, with the check that records the rate)

- **5-1 Credential not copied (credential invariant).** Clone a session that has an active worker code issued, paused flag set and code version above 1. Record, for the new session: code not issued, version 1, not paused, collage token differs, status draft. Expected 0 of 5 copied; record the observed result.
- **5-2 Purged source.** Take a practice session through personal and public purge (or a closed real one), clone it; record that the clone's windows, question-map counts and frame settings equal the source's and that no 500 occurs. (Believed, unmeasured outside the code reading above.)
- **5-3 Question map carries over a duplicated Zeffy form** (believed, unmeasured): connect the clone to a Zeffy form duplicated from the source's, make one test purchase, and record how many questions land in Needs attention. If not 0, record which question texts differ; the design does not claim zero.
- **5-4 Double submit.** Submit the clone form twice quickly; record exactly one new session and one 409 on the second.
- **5-5 Bad source ids.** `?cloneFrom=not-a-uuid` and a well-formed unknown uuid both show "That session no longer exists", never a blank form.

## Edge cases and risks

- **Source edited between page load and submit:** the server reads the source at submit, so the clone takes the newer values; the form's pre-filled dates and windows are the client's own and are validated as typed. Acceptable (single-admin tool), stated so nobody adds locking. We would revisit if two admins clone and edit concurrently, which the club does not do.
- **Source deleted between load and submit:** 404, the form shows the toast message with the field `cloneFrom`; the admin returns to the list.
- **Source quota or art key odd but valid:** copied; the form's line shows the quota only for display.
- **One active real session (B-209):** a clone is a draft and cannot create a second active real session; the conflict is B-209's at Activate. Nothing added here.
- **Unique collage token collision** (2^-128): surfaces as a 500, not mapped, as today.
- **The pre-filled windows' labels** must match the new Zeffy form's drop-off answers; a mismatch surfaces in the existing unmatched-window-answers panel (Phase 1).
- **Stale past dates in a real-to-real clone** warn, never block.
- **Idempotent `?cloneFrom` on refresh:** the page is read-only; the create happens only on submit.

## Coordination with the scenes branch (`/Users/cshenso/git/westervillelions-scenes`)

The scenes tree currently changes: `crew/[slug]/group-photos/route.ts`, `collage-queries.ts`, `photo-admin.ts`, `photo-service.ts`, and adds `scene-admin.ts`, `scene-queries.ts`, `pg-error.ts`, scene routes; its design also edits `session-log.ts`, `admin-contract.ts`, the session page and the photos page.

Overlap I foresee, smallest first:
- `admin-contract.ts`: scenes edits `ADMIN_ERROR_CODES` and `AdminPhotoDto`; clone adds one optional field to `CreateSessionRequest`. Different hunks, a clean merge expected.
- `[sessionId]/page.tsx`: scenes renders a storyline card and loads scenes server-side; clone adds one `Link` in the button row at line 77. Different hunks; if scenes also edits that row, the conflict is one line.
- `session-log.ts`: **not touched by clone** (reuses `created`).
- `session-queries.ts`, `session-input.ts`, the sessions route, the New session page, `session-form.tsx`, the Connect page: not in the scenes tree's change list or design. The scenes branch should not edit `createSession`.
- The later follow-on (whichever branch merges second): add `includeScenes?: boolean` to `CreateSessionRequest`, the `copyScenes(tx, sourceId, newId)` call at the seam, `scenes: n` in the `created` detail, the checkbox "Include the N scenes" (default on, only when the source has scenes), and the scan test's allowance. Until then the scan forbids scene imports in the clone code.
- Orchestrator: land clone on main first (no migration, nothing blocks), then rebase the scenes worktree. No Neon branch or worktree is needed for clone.

## Out of scope

Cloning registrants, photos, history, the worker code or the collage token; cloning into an existing session; creating the Zeffy form; a "created from" column or link; a reusable template; changing B-209; renaming "real" to "live"; the scenes copy (follow-on above); selecting a Zeffy form on the clone screen.

## Release notes draft (no version number)

> **Clone a Santa's Workshop session.** On any session's page, "Clone session" opens the New session form with the dates, drop-off windows and question mapping already filled in. Choose Practice or Real, give it a name and a short web name, fix the dates, and you land on the Connect page to pick the new session's own Zeffy form. The worker code, photos, registrants and the public photo link are always new, so nothing from one run reaches the next.

## Proposed DECISION text (orchestrator to reserve the id; DECISION-128 is taken)

**DECISION-129: A Santa's Workshop session is cloned through the existing create path, with every uncopied field read from the source row on the server and written through an explicit column allowlist**
**Status:** Proposed (2026-11-04, Phase 3; promote to Resolved at Phase 6 after re-reading each sentence against QA's Established list)
1. Clone is `cloneFrom` on `POST /api/admin/santas-workshop/sessions`, not a second route, so token minting, retention defaults and the audit row exist once.
2. The read and write column lists are explicit and scan-tested; the credential, token, Zeffy and stamp columns are never loaded or written.
3. Quota follows the new kind unless the kind is unchanged; the frame file prefix is never copied (the default derives from the new slug); the crew-closes and purge dates copy only when the pickup date is unchanged.
4. Clone core never touches `sw_scenes`; the scenes copy joins the same transaction through `scene-admin.ts` later.
5. Purged and closed sources are allowed because neither purge nor reset writes any copied column (read from `retention.ts` lines 288 and 426; Phase 5 check 5-2 records it).
6. The claim that a duplicated Zeffy form needs no re-mapping is believed, unmeasured (check 5-3).

## Handoff

**Owner:** tech-lead · **Status:** complete

### Summary
Clone is `cloneFrom` on the existing create route and New session page, with the copy rules in one pure module and the DB work in one transaction. No schema, permission or dependency. Roughly 150 to 200 lines including tests, tightly coupled, so one implementer.

### Outputs
- This work-log section only. No code, commit, push, `docs/decisions.md` or `docs/backlog.md` edit.

### Open questions / handoff notes
- Use the **full-stack-developer** agent in the main tree (no worktree, no migration, no Neon branch). Read `node_modules/next/dist/docs/` for the `searchParams` Promise shape first.
- Do not import or mention `swScenes`, `sw_scenes` or `scene-admin` in the clone code.
- Orchestrator: reserve a DECISION id; land clone before the scenes rebase.
- User question (not blocking): the form opens on Practice for every clone, including real-to-real, so next year's clone needs one click on Real. Say if you would rather it open on the source's kind.

---

# Phase 4 — Implementation (full-stack) — 2026-11-04

**Owner:** full-stack-developer
**Status:** complete (no commit, no push)

### Summary
Clone is `cloneFrom` on the existing create route and New session page. Pure copy rules live in `session-clone.ts`; `createSession` is now one transaction (session row plus `created` audit row via `tx`) for both the plain and clone paths. No schema, migration, permission or dependency.

### What I did
- `session-clone.ts`: `CloneSource`, `CloneConfig` (allowlist), `cloneConfig`, `cloneQuotaBytes`, `cloneDraft`, `suggestCloneSlug`, `isPastDay`.
- `getCloneSource()` selects named columns only; `createSession` reads the source server-side, 404 / 400 / 409 as designed, audit detail `{ kind, clonedFrom }`.
- `validateCreateSession` accepts an optional uuid `cloneFrom` (field error `cloneFrom`), still ignores every other posted key.
- New page: `searchParams` Promise; bad or unknown `cloneFrom` shows "That session no longer exists" (no blank-form fallback); banner text as designed; form opens on Practice.
- `CreateSessionForm`: optional `clone` prop, slug suggestion avoiding the source slug, past-date warning, read-only quota line, push to `/connect?cloned=1`.
- Session page: "Clone session" secondary link after "Edit session". Connect page: persistent `cloned=1` hint card.

### Outputs
- Created: `src/lib/santas-workshop/session-clone.ts`, `session-clone.test.ts`, `session-clone-queries.test.ts`, `session-clone-source.test.ts`.
- Modified: `src/lib/santas-workshop/admin-contract.ts` (one optional field on `CreateSessionRequest`), `session-input.ts`, `session-queries.ts`, `src/app/(dashboard)/admin/santas-workshop/new/page.tsx`, `[sessionId]/page.tsx` (one Link line), `[sessionId]/connect/page.tsx`, `src/components/admin/santas-workshop/session-form.tsx`.
- Endpoint: existing `POST /api/admin/santas-workshop/sessions` (auth() then hasFeature(SANTAS_WORKSHOP_MANAGE), unchanged); route file not edited.
- Schema/migration/FEATURES/env: none. Decision: DECISION-129 (Proposed text above; tech-lead files it).
- Gates: `tsc --noEmit` clean; `pnpm lint` 0 errors (1 pre-existing warning in ledger budget-context-panel.tsx, not this diff); `pnpm test` 335 files / 5804 tests pass; `pnpm build:only` passes.

### Deviations from the design
1. `CloneSource` also selects `dropoffDate`, `photoDate` and `windows` (design list omitted them) because `cloneDraft` and the page need them to pre-fill the form. Still named columns, scan-tested.
2. Query tests are in a new file `session-clone-queries.test.ts` rather than extending `session-queries.test.ts` (that file mocks `db` as `{}` module-wide; a transaction fake needs its own mock). Same named cases, plus one extra (source settings no longer validate returns 400).
3. The source-scan test is `session-clone-source.test.ts` and holds the page-link/blank-fallback scan too (not in `admin-ui-source.test.ts`).
4. The "past date" warning uses the real clock (`easternDateString(new Date())`), not `workshopNow()` (that override is for the public page and takes env arguments).
5. The `created` audit insert is done inline with `tx` instead of `logSessionEvent()` (which uses global `db`); `logSessionEvent` is unchanged and `session-log.ts` untouched.

### Open questions / handoff notes
- Browser checks for qa (Phase 3 live checks 5-1 to 5-5): clone with active/paused/rotated code source; purged source; duplicated-Zeffy-form question map; double submit (one 201, one 409); `?cloneFrom=not-a-uuid` and unknown uuid. Also: kind switch updates quota line; past dates show the amber note; 360px layout.
- No dev server was started by me. Scenes branch: only hunks to rebase over are the one optional field in `admin-contract.ts` and one Link line in `[sessionId]/page.tsx`.
- Next: qa (Phase 5).

---

# Phase 5 — Verification (qa) — 2026-11-04

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** Measured on the uncommitted main tree (`main` at 517b6d5 plus the clone diff and the new untracked files `session-clone*.ts`, `session-clone*.test.ts`, and `e2e/santas-workshop-clone.spec.ts`; the unrelated `docs/backlog.md` and `docs/work-log/2026-10-17-*` modifications and the scenes worktree were not touched). Typecheck, unit tests and production build are green; a new 12-test Playwright spec covering the clone flow and Phase 3 live checks 5-1, 5-2, 5-4 and 5-5 passes against my own dev server on :3100. One non-blocking copy nit (below).

### What I did
- **Type check** `pnpm exec tsc --noEmit`: PASS (no output, ~5 s).
- **Unit tests** `pnpm test`: PASS. 335 files, 5804 tests, 0 failed, 5.2 s (matches the implementer's count; this was before my e2e spec, which is Playwright, not Vitest).
- **Production build** `pnpm build:only`: PASS. Route list rendered, no errors.
- **Environment safety:** `DATABASE_URL` host is `ep-orange-sunset-am8erati-pooler` (the dev database); `PROD_DATABASE_URL` is a different host (`ep-rough-smoke-...`) and is never read by the app. Dev server was `pnpm dev -p 3100` (started and stopped by me; nothing was listening on :3000 before or after). `EMAIL_DEV_ALLOWLIST` is unset, so nothing could send; the flow sends no email anyway. No Zeffy call was made.
- **Browser click-through** (Playwright chromium, signed in as the e2e admin through the real credentials form), `PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm test:e2e e2e/santas-workshop-clone.spec.ts`: **12 passed, 0 failed, 41.5 s** (only this spec was run, not the full suite). Two earlier runs failed on bugs in my own spec (wrong window input index; creating a fixture before signing in; wrong expected wording for the slug error), fixed and re-run; no failure was in the feature.

| Flow / check | Result | Evidence |
|---|---|---|
| "Clone session" link on the session page opens `/new?cloneFrom=<id>` | pass | link click, URL asserted |
| Pre-fill: banner text, opens on Practice (source was practice; real-to-practice case below shows it still opens on Practice), default name (not the source's), slug suggested and different from the source slug, three dates and every window label equal the source | pass | field values asserted against the DB row |
| Read-only quota line (not an input) | pass | "250 MB (from the source)" on Practice; "600 MB (the default for a Real session)" on Real; no quota input exists |
| Past-date warning | pass | source with 2025 dates shows "This date has already passed." exactly 3 times; submit still succeeds (draft created) |
| Practice to Real, pickup moved (check 5-1) | pass | clone: status draft, `crewCodeEnc` null, version 1 (source 3), not paused (source paused), collage token differs and non-null, `collagePublishedAt`, Zeffy campaign/title/rates, `storageFolderKey`, both purge stamps all null/empty: **0 of 13 run-specific fields copied**; quota 600 MB; prefix "" (source "oldprefix"); part size 50 and art key copied; question map deep-equals the source; windows equal; crew-closes pickup+1, purge dates pickup+30 / Jan 31 (derived, not the source's custom ones) |
| Practice to Practice, pickup unchanged | pass | custom crew-closes and both purge dates copied; quota 250 MB copied; prefix "" |
| Real to Practice | pass | form opens on Practice (quota line "100 MB, default for Practice"); choosing Real shows "600 MB (from the source)"; clone stored at 100 MB |
| No people, no pictures | pass | zero `sw_orders`, `sw_stuffies`, `sw_photos` rows on the clone |
| Audit row | pass | exactly one `sw_session_log` row, kind `created`, detail exactly `{ kind: "real", clonedFrom: <source id> }`, name text absent; source's worker code, version, token and Zeffy id unchanged afterward |
| Redirect | pass | lands on `/admin/santas-workshop/<new id>/connect?cloned=1`, persistent hint "Question mapping was copied from the source: make a test purchase and check Needs attention." visible |
| Slug collision (409) | pass | field error "That short name is already used by another session. Pick a different one.", form values kept, URL unchanged, still one row with that slug |
| Double submit (check 5-4) | pass | two simultaneous POSTs: statuses `[201, 409]`, one session, one audit row |
| Bad source ids (check 5-5) | pass | `not-a-uuid`, an unknown uuid, and a repeated-param value each show "That session no longer exists" with no Create button; API gives 400 (field `cloneFrom`) for malformed and 404 for unknown, nothing inserted |
| Closed and fully purged source (check 5-2) | pass | real purge route (force, both scopes, `done:true`) took a practice source to status `purged`; clone page loads, clone is a draft with purge stamps null, windows, question map, part size 40 and quota 300 MB copied, no 500 |
| Unauthenticated POST | pass | 401/403/redirect, nothing created |
| 360 px | pass | no horizontal scroll on the clone page or the session page |

- **Not done:** check 5-3 (duplicated Zeffy form, test purchase, count of Needs-attention questions). It needs a real Zeffy form and the dev campaign allowlist; I made no Zeffy calls. It remains "believed, unmeasured" and DECISION-129 item 6 must keep that wording. A clone from a closed (not purged) source was not separately run; the purged case already covers `closed` as a precondition (the source was closed before purging).

### Regression / new tests added
- `/Users/cshenso/git/westervillelions/e2e/santas-workshop-clone.spec.ts` (12 tests, serial, unique `e2e-clone-<stamp>` slugs, all created sessions deleted in `afterAll`). Guards against: copying a credential or run identifier on clone; quota/prefix/schedule rules regressing across kind changes; bad `cloneFrom` falling back to a blank form; a non-atomic or doubled create.
- Implementer's unit tests were re-run as part of the 5804 and not re-edited.

### Coverage on critical modules
Not re-measured this pass (clone adds no change to `events.ts`, `permissions.ts` or `members.ts`).

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/admin/santas-workshop/sessions` (create and clone; route file unchanged, read at lines 32 to 35) | yes | yes | `FEATURES.SANTAS_WORKSHOP_MANAGE` |
| `/admin/santas-workshop/new` page (reads `cloneFrom`) | yes (redirect `/signin`) | yes (redirect `/access-pending`) | `FEATURES.SANTAS_WORKSHOP_MANAGE` |
| `/admin/santas-workshop/[sessionId]` page (Clone link) and `/connect` page (`cloned` hint) | yes | yes | `FEATURES.SANTAS_WORKSHOP_MANAGE` |

The new page is the only new reader of a source row and it sits behind the gate before `getCloneSource` is called. No new route, no new FEATURES key.

### Cleanup
- Dev database: 0 `e2e-clone-*` sessions left (checked by query after the run; the dev database held 0 sessions in total, so nothing pre-existing was touched). No production access of any kind. The :3100 dev server was stopped; :3000 never touched. I removed the ignored `test-results/` directory my runs created. Screenshot and logs are in the scratchpad only.

### Findings (non-blocking)
1. **Copy nit.** The clone form still shows the New-session sentence "Starting values come from the club's 2026 event facts. Change them here for another year or a dry run." under Dates, which is wrong when the dates come from the source. Suggest a clone-aware sentence (under 30 lines, absorb in Phase 4 or defer). Not a defect in behavior.
2. The unauthenticated-POST test accepts 401, 403 or a redirect because the proxy answers before the route does; it asserts "nothing created", which is the property that matters.

### Open questions / handoff notes
- Next: **analyst for Phase 6** (PASS). Phase 6 should keep DECISION-129 item 6 (duplicated Zeffy form needs no re-mapping) as believed/unmeasured; items 1 to 5 are now backed by the evidence above (the spec is the Established list for items 2, 3 and 5).
- The new e2e spec joins the full e2e suite; it needs no Zeffy secret and no Drive, but it does activate and purge a practice session in the dev database and cleans up after itself.
- Not committed or pushed.

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> An admin can now clone any session (including a closed or purged one) from a "Clone session" button into the ordinary New session form, pick Practice or Real, and land on the new session's Connect page to enter its own Zeffy form; the copy rules are right and the run-specific fields are provably not copied, but the one claim the user's time-saving argument rests on (a duplicated Zeffy form needs no re-mapping) is still unmeasured.

## What's working

- **The user's three verbs are all there.** Clone (button on the session page), say practice or real (kind picker on the form), enter a new Zeffy campaign (the very next screen, existing picker with its verification and `campaign_in_use` 409). Setup that used to be retyped (dates, drop-off windows, the question map, frame art and part size, schedule dates) arrives filled in.
- **The traps Phase 1 named are closed, with evidence, not just code.** QA's spec measured 0 of 13 run-specific fields copied (worker code, version, pause flag, collage token, Zeffy ids, storage folder, publish and purge stamps); quota follows the kind (practice to real 600 MB, real to practice 100 MB) and is shown as a read-only line; the frame prefix is always empty; crew-closes and purge dates copy only when the pickup day is unchanged and otherwise re-derive.
- **Purged and closed sources work** (check 5-2, via the real purge route). This matters most: next year's clone will be made from a purged source.
- **Failure handling is human.** A bad or unknown `cloneFrom` shows "That session no longer exists" with a way out, never a blank form; slug collision keeps the form values and names the field; a source whose settings no longer validate shows a plain sentence in the form's alert; double submit gives exactly one 201 and one 409; the create plus audit row is one transaction.
- **Permissions and privacy held.** No new key; the existing route and pages gate on `santas_workshop.manage`; no people, orders, photos or history are copied; the audit row carries ids only (`{ kind, clonedFrom }`).
- **Mobile and brand.** No horizontal scroll at 360px; cards `rounded-2xl`, the Clone link uses the shared secondary button style, no native dialogs. The QA copy nit (Dates note wording under a clone) is fixed in `session-form.tsx` and I re-read it: clone shows "Starting values come from the session you are cloning."

## Intent-vs-shipped diff

| Item | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| Clone is the New session form pre-filled, one create path | `?cloneFrom=` on the existing page and route | Same; `createSession` branches on `cloneFrom` | matches |
| Zeffy | Clone first, then Connect, not in the clone form | Redirect to `/connect?cloned=1` with a persistent hint card | matches. See the note on the user's wording below |
| Kind | All four directions, chosen on the form | Same; form opens on Practice every time | acceptable drift (Phase 3 ruling 2, deliberate; see follow-up 2) |
| Name | Fresh, never the source's | Default name for the kind | matches |
| Slug | Fresh; 409 on collision | Suggestion avoids the source slug; 409 backstop | matches |
| Dates | Pre-filled, editable, warn on past | Same; warning is amber text "This date has already passed." | acceptable drift (amber rather than gold, for contrast; still a warning, not a block) |
| Crew-closes and purge dates | Copy only if pickup unchanged | Same, with a validated fallback to defaults | matches |
| Quota | Same kind copies, else kind default, shown read-only | Same | matches |
| Frame prefix | Copy when kind unchanged | Never copied (Phase 3 ruling 1) | acceptable drift, better than Phase 1 |
| Frame art key and part size, question map | Copied server-side, validated | Same | matches |
| Credentials, token, Zeffy ids, stamps | Fresh | Fresh, measured | matches |
| Orders, stuffies, photos, history | Not copied | Zero rows | matches |
| Purged/closed source allowed | Required | Passed (purged); closed-not-purged not run separately but is a precondition of the purged case | matches |
| Audit | One `created` row with `clonedFrom` | Same, written with `tx` | matches |
| Scenes | Later, shares `copyScenes()`; Slice B button stays | Not touched; scan test forbids scene imports | matches (deferred as planned) |
| Post-clone "make a test purchase" instruction | Banner sentence | Persistent card on Connect (survives the toast) | matches |
| B-209 | No special handling | None | matches |

**User's wording versus shipped.** The user said "you would enter a new Zeffy campaign and whether it was practice or live" as if one step. Shipped is two screens (kind on the clone form, campaign on Connect), as Phase 1 recommended so a Zeffy outage cannot block creating the session. This is a preference-level drift the user has not yet seen; the release notes should say plainly that the Zeffy form is the next screen.

## Edge cases

| Case | Result |
|---|---|
| Empty state (no source / bad id) | pass |
| Failure microcopy (404 source, 400 stale source, 409 slug) | pass (the `cloneFrom` field errors render in the form-level alert, `session-form.tsx` lines 260 to 261) |
| Permission gate (page, Connect hint, route; unauthenticated POST creates nothing) | pass |
| Mobile 360px | pass (QA measured; I did not re-measure) |
| Brand (`rounded-2xl`, `rounded-lg`, no native dialog) | pass |
| Email, Google Groups, OAuth-vs-password | not applicable |
| Past-date warning for real-to-real | pass |

## DECISION-129 re-read (Proposed to Resolved, tech-lead files it)

Each sentence against the evidence:
1. Clone through the existing create route: **backed** (code, route file unchanged).
2. Explicit read and write allowlists, scan-tested: **backed** (scan test, 0 of 13 measured).
3. Quota follows kind, prefix never copied, schedule dates copy only when pickup unchanged: **backed** (e2e and unit tests).
4. Clone core never touches `sw_scenes`: **backed** (scan test).
5. Purged and closed sources allowed: **backed** for purged (check 5-2); retention.ts reading unchanged.
6. A duplicated Zeffy form needs no re-mapping: **NOT backed.** Check 5-3 was not run. Keep the wording "believed, unmeasured", and do not state it as fact in release notes or in the checklist.

Recommend promoting items 1 to 5 to Resolved and leaving item 6 as an open, labelled belief with the measurement named in follow-up 1.

## Follow-ups (each gets its own work-log entry or backlog line)

1. **Measure check 5-3 (unmeasured claim, owner: orchestrator or the user with the chair).** On the first real use (the Dec 7 dry-run session cloned from the existing practice session, connected to a Zeffy form duplicated from the source), make one test purchase and record how many questions land in Needs attention and which texts differ. The design does not claim zero; the persistent hint already tells the admin to look. If the count is not zero, consider a "carry mapping by position" or a one-click Remap hint; do not build that before the number exists. This is the only rate the feature's value argument depends on.
2. **Kind default on the clone form.** The form opens on Practice for every source, so the user's own stated use (practice to live, and next year real to real) costs a deliberate click on Real. That was a conscious, safe choice (Phase 3 ruling 2, with the question to the user still open in the Phase 3 handoff). Ask the user once; if they prefer the source's kind or a "Clone as" pair of buttons on the session page, it is under 30 lines. No change until they answer.
3. **Scenes follow-on** (already planned): whichever pipeline merges second adds `includeScenes`, the `copyScenes(tx, ...)` call at the seam, `scenes: n` in the audit detail and the checkbox. Track it in the scenes work-log; the clone scan test's allowance must change in the same PR.
4. **Closed-but-not-purged source** was covered only as a precondition of the purged case. Cheap to add one e2e case; low risk.
5. **Release note wording.** Use the Phase 3 draft, adding that the Zeffy form is chosen on the next screen and that the question mapping is "copied; check after a test purchase", not "no re-mapping needed".
6. **Housekeeping, not blocking.** The quota line says "(from the source)" even in the rare case the source quota was out of range and the default was used; negligible, noted so nobody is surprised. The e2e spec activates and purges a practice session in the dev database and cleans up after itself; flag it when the full suite runs (about 12 minutes serial).

## Handoff

### Summary
SHIP WITH NOTES. The feature delivers what Phase 1 promised and what the user asked for, with two screens instead of one for the Zeffy step. The unmeasured Zeffy re-mapping claim and the kind-default question are the two notes; neither blocks pushing.

### What I did
- Re-read Phases 1 to 5, the full source diff, the new pure module `session-clone.ts`, and the form's error rendering; walked each Phase 1 flow, gap and adversarial item against QA's evidence table.
- Did not re-run tests or browser checks; I relied on QA's PASS and named what it did not cover.

### Outputs
- This section only. No code, commit or push. DECISION-129 stays with tech-lead to file.

### Open questions / handoff notes
- Orchestrator or tech-lead: promote DECISION-129 items 1 to 5 to Resolved, keep item 6 labelled unmeasured; write release notes via `/release-notes`; push only on the user's approval (`/pre-push` first).
- User (not blocking): should the clone form open on the source's kind instead of Practice? And please confirm the two-screen Zeffy step is fine.


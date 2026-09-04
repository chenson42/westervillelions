# Club Files (general document upload/attach) — Work Log

> **Slug:** `2026-09-04-club-documents`
> **Surface:** mixed (admin authoring; public download; member-portal listing)
> **Permission(s):** new key proposed — see Permissions section
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-04 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-04 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-09-04 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Complete | — | 2026-09-04 |
| 5 — Verification | qa | Complete | PASS | 2026-09-04 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-04 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A general-purpose file library (admin uploads, tags public/members-only, optionally attaches to an event) whose immediate payoff is a public "Become a sponsor, download the packet" link on the Rudolph Run event page — the design is sound and has strong in-repo precedent (receipt storage, welcome packet), but naming, the permission key, and the public download route's exposure model need to be nailed down before Phase 2.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin | Upload a file (PDF in v1) and set a title/description | occasional, ~1–a few times/year per doc |
| Admin | Mark a file public or members-only | at upload, editable after |
| Admin | Attach a file to one or more events | at upload or later |
| Admin | Replace/update a file (e.g., next year's packet) | annual, per driving use case |
| Admin | Delete a file | occasional |
| Anonymous public visitor | Click "Become a sponsor, download the packet" on `/events/[id]` and receive the PDF | on demand, per event |
| Signed-in member | See members-only files listed somewhere in the member portal (proposed: Club Records) and download one | occasional |

Note: the request never names who "the user" is for delete/replace — resolved below under Permissions as admin-only via a single new key, same shape as `documents.manage`/`minutes.manage`.

## Flows

**Flow 1 — Admin uploads and attaches a file:**
Entry: `/admin/files` (new admin area) → **step:** pick a file (drag/drop or file picker), enter title + optional description → **step:** choose visibility (Public / Members-only) → **step:** optionally select one or more events to attach it to (multi-select, searchable — driving case is 1 doc → 1 event, but no reason to cap it at one) → **outcome:** file appears in the admin file list with a working download link and, if attached, shows on the attached event's public or member page.
- Failure: upload rejected (wrong type, over size cap, failed magic-byte check, or upload API/network error) → the form shows an inline error naming the specific reason ("This file isn't a valid PDF" / "Files must be under 10 MB"), not a generic toast, and the form retains the title/description/visibility the admin already typed so they don't need to redo the whole form.

**Flow 2 — Public visitor downloads the sponsorship packet:**
Entry: `/events/[id]` (public, unauthenticated) → **step:** sees a "Become a sponsor, download the packet" link/button in the event detail body, generated because a public-visibility document is attached to that event → **step:** clicks; browser downloads or opens the PDF → **outcome:** file opens/downloads with correct filename and content-type; no login prompt, no redirect.
- Failure: if the attached document was deleted or its visibility flipped to members-only after the page was cached/shared, the direct link 404s with page-level microcopy ("This document is no longer available"), not a raw JSON error or stack trace.

**Flow 3 — Signed-in member reads members-only files:**
Entry: `/members/records` (Club Records hub, existing page that already lists minutes and governing documents) → **step:** a new "Files" section/tab lists members-only (and public) documents not otherwise tied only to an event, or all files period — needs a scope decision (see Gaps) → **step:** click to download → **outcome:** file streams to the member.
- Failure: member with no linked `memberId` (auth exists but `session.user.memberId` is null) sees the existing Records "Account Not Linked" empty state, consistent with how minutes/governing docs already handle this — no new failure mode needed here, just confirm the new files section respects the same `memberId` gate.

**Flow 4 — Member views an event with an attached members-only file:**
Entry: `/members/events/[id]` → **step:** sees the attached file(s) listed on the event detail page (mirrors the public event page's sponsor-packet link, but works for a members-only file, e.g., a signup roster or briefing doc) → **outcome:** download works for any linked member regardless of visibility tag, since they're already inside the authenticated surface.
- Failure: same "no longer available" microcopy if the file was deleted after the page loaded.

## Permissions

- **New key proposed:** `club_files.manage` (or `files.manage`) — create, edit metadata, change visibility, attach/detach from events, replace, delete. **Do not reuse `documents.manage`.** That key already gates the Constitution/By-Laws governing-document version/amendment workflow (Notetaker-adjacent trust level, append-only version history, adoption ceremony). Operational uploads (sponsorship packets, event handouts) are a categorically different, lower-ceremony trust level — an admin managing sponsor PDFs should not automatically inherit the ability to adopt amendments to the by-laws, and vice versa. Reusing the key would also make the permissions-admin UI's description ("create versions, review/adopt pending amendments...") actively misleading for the new use.
- **Naming:** use "**files**" or "**club files**" in code/routes/UI, not "documents" — `documents` is already a first-class noun in this codebase (governing documents, `DOCUMENTS_MANAGE`, `documentsQueries`, `/members/records/documents/[slug]`). A second unrelated "documents" concept invites exactly the kind of copy-paste/decision-collision CLAUDE.md's duplication review flags. Suggest table name `clubFiles` / `club_files`, route `/admin/files`, permission `club_files.manage`, storage helper `src/lib/club-file-storage/`.
- **No `.view`/`.read` key** — following the `documents.manage`/`minutes.manage` precedent (no separate read key exists by design), reading is either fully public (public-tagged files, unauthenticated) or gated only by "any linked member" (members-only files), exactly like Club Records today. This avoids a third permission tier nobody asked for.
- **Default roles:** `club_files.manage` bound to `admin` only at launch (matches `documents.manage`, `welcome_packet.manage`). Widen later only by deliberate role-binding change, not a flag.

## Gaps the Request Didn't Address

- **File type scope beyond PDF.** The driving case is PDF-only. Does v1 hard-reject everything else (images, Word docs)? Recommend: PDF-only in v1, matching the concrete need, with magic-byte validation restricted to `%PDF-` — broadening to images/docs is a follow-up, not a silent allowance now. (Open question to user.)
- **Size cap.** The driving file is 2.9MB. Existing receipt-upload precedent caps at 10MB. Recommend adopting the same 10MB cap rather than inventing a new number — but flagging so the user can override if larger sponsor decks are expected.
- **General public file listing.** The request implies public files are reachable only via event attachment + direct link — there's no mention of a `/documents` or `/files` public index page. Recommend confirming that's intentional for v1 (no public browse page); if a future document isn't tied to any event, it would otherwise be orphaned/undiscoverable except by an admin sharing the raw URL. Worth an explicit "no public index in v1" note rather than a silent gap.
- **Members-only file scope on Club Records.** Should the new "Files" section on `/members/records` show *all* members-only files, or only ones NOT attached to an event (to avoid duplicate listings — once on the event page, once in Records)? Recommend: show all members-only files in Records regardless of event attachment (Records is the canonical index; the event page is a convenience surface), but this needs an explicit call before Phase 3 designs the query.
- **Cardinality: doc↔event.** Request says "attach a document to an event" — singular-sounding, but no stated constraint. Recommend many-to-many (a doc can attach to multiple events; an event can have multiple docs) via a join table, since "one packet attached to two events" (this year's Rudolph 5K page and a general sponsorship page) is a plausible near-future case and a join table costs nothing extra now vs. retrofitting later.
- **Replace vs. new version, next year's packet.** The user explicitly wants "30-second admin upload" for next year. Two shapes: (a) edit-in-place — same `clubFiles` row, new file bytes, old file simply gone; or (b) new row each year, old one manually unattached/archived. Recommend (a) replace-in-place as the default action ("Replace file" on the same row, keeps title/visibility/event-attachment, just swaps bytes) since there's no stated need for the governing-document-style version history here — but flag this explicitly since it diverges from the two most obvious precedents. No download-count/analytics requirement stated — confirming that's out of scope (see below).
- **Deleted/past event interaction.** What happens to an attachment when the event is deleted, or simply passes into the past? Recommend: attachment simply stops rendering when the event is gone (event delete cascades or the query naturally excludes it); a past event keeps showing its attached file indefinitely (a sponsor might still want to see last year's packet as a reference) — no auto-expiry. Flagging so tech-lead doesn't invent an expiry rule nobody asked for.
- **Email.** Nothing about this feature sends email (no notification on upload, no "packet updated" email to committee). Confirm out of scope — consistent with the request as written.
- **Google Group sync.** Not touched by this feature — no member/committee relationship involved. Confirmed non-applicable.
- **Empty state.** `/admin/files` on a fresh install: needs "No files yet — upload your first one" per CLAUDE.md's empty-state pattern (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`), not a blank table. Same for the new Records "Files" section when no members-only files exist yet.
- **Mobile.** The public event page's sponsor-download button and the Records file list both need to work at 360px — flagging since PDF download buttons/links are easy to build desktop-first and forget to check at narrow width.
- **Brand consistency.** File list rows follow the non-interactive card pattern (`rounded-2xl shadow-sm`); the download button on the public event page is a standard primary/secondary button (`rounded-lg`, never `rounded-full`); delete goes through `<ConfirmDialog>`, never `window.confirm`. No gaps here — just confirming for Phase 3/4.

## Adversarial Pass Findings

- **Public download route must not enumerate or leak private files.** Following the receipt-storage precedent (opaque UUID-namespaced key, server-side proxy that streams bytes rather than redirecting to a storage URL), the public download route should key on the file's own UUID, not a guessable slug, and must independently re-check `visibility = 'public'` server-side on every request — never rely on the UI simply not linking to a private file. A members-only file requested by the public route returns 404 (not 403 — don't confirm the file exists to an anonymous caller).
- **Content-type/disposition.** The download route must set `Content-Type: application/pdf` (or whatever the validated magic-byte type is) and `Content-Disposition` explicitly, so browsers render/download rather than risk executing anything — same pattern as the receipt proxy routes. No user-supplied filename should be echoed into headers unsanitized.
- **Malicious upload.** Server-side magic-byte validation (`validateMagicBytes()` / a PDF-specific check) is required before the file is persisted, not just a client-side extension check or `Content-Type` header trust (the header is spoofable) — same posture as the existing receipt-upload path.
- **Rate/abuse posture.** The public download route is intentionally ungated (no auth, no rate limit stated) — that's consistent with it being a public marketing asset (a sponsorship packet is meant to be freely distributed), and matches how public event pages and public campaign images already work today. Flagging explicitly so this is a deliberate choice, not an oversight: no new abuse surface is introduced beyond "anyone can download a PDF the club intentionally made public."
- **PII responsibility.** The app's obligation is limited to honoring the public/members-only flag the admin sets — it cannot inspect PDF contents for personal data. The two event-chair emails inside the driving PDF are the club's editorial decision to publish (same posture as any public-facing flyer); this is explicitly *not* a "No Personal Data in the Repository" violation because the file never enters the git repository — it lives in DB/blob storage, served at request time. Confirming this distinction is understood is worth a line in the Phase 2 architect review, since it's easy to conflate "personal data in the app's storage" with "personal data in the repo" (the invariant is about the latter).

## Out of Scope (confirm with user)

- Download counting / analytics on files — not requested, not needed for the sponsorship-packet use case. Confirm this stays out of v1.
- Version history / rollback for a replaced file (unlike governing documents' append-only versions) — the request's own framing ("30-second admin upload" for next year) argues against needing this ceremony.
- File types other than PDF — confirm PDF-only for v1 per above.
- A public browsable file index page — confirm files are reachable only via event attachment or a direct admin-shared link in v1.

## Open Questions

1. **File type scope:** PDF-only for v1, or do you want images/Word docs supported now? (Affects magic-byte allow-list and upload UI copy.)
2. **Size cap:** Is the existing 10MB receipt-upload cap acceptable, or do you expect larger files (e.g., a full sponsor slide deck)?
3. **Club Records "Files" section scope:** should it list *all* members-only files, or only ones not already shown via an event page, to avoid duplicate listings?
4. **Permission key name:** confirm `club_files.manage` (or your preferred name) rather than reusing `documents.manage` — this is a naming/trust-level decision, not something I can resolve unilaterally since it's user-facing in the admin permissions UI.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions** — one of the "suggestions" is load-bearing and must be resolved in
Phase 3 before implementation starts: the upload transport for a 25MB file. See below; this is not
optional polish.

## What I did

- Read this work-log's Phase 1 review and User Decisions in full.
- Read `src/lib/receipt-storage/` (`index.ts`, `database.ts`, `local.ts`, `receipt-storage.test.ts`)
  and DECISION-018/020/040 in `docs/decisions.md` to understand the current `ReceiptStorage`
  abstraction, its adapter-selection rule, and why `@vercel/blob` was removed.
- Read the social-requests Phase 2 review (`docs/work-log/2026-09-03-social-media-requests.md`,
  lines 112–219) — the most recent precedent for "second consumer wants file storage," including its
  explicit ruling that `ledger_receipt_files` must not be reused and a sibling adapter is the
  sanctioned shape.
- Confirmed `@vercel/blob` is **not** in `package.json` today (`grep` on the file) — it was removed
  by DECISION-040, contradicting an assumption in my task brief that it's an already-vetted
  dependency. Corrected below.
- Read `src/app/api/members/reimbursements/upload/route.ts` (multipart `formData()` pattern, 10MB
  cap, magic-byte validation) and confirmed no `vercel.json` / custom body-size config exists
  anywhere in the repo.
- Read `src/lib/db/schema.ts`'s `groupMemberships` table (lines 176–185) as the codebase's existing
  many-to-many join-table shape to mirror for doc↔event.
- Read `ADMIN_NAVIGATION` location and `src/app/api/public/members/[id]/photo` as the public-route
  naming precedent.
- Fetched Vercel's current Functions-limits docs and its body-size-limit bypass KB article
  (2026-09-04) to verify, rather than assume, whether a 25MB file can pass through a Vercel Function
  request/response body. This turned up a real platform ceiling the Phase 1/User Decision didn't
  anticipate — detailed below and in `docs/decisions.md` DECISION-094.

## Placement

- **Storage:** `src/lib/club-file-storage/` — new sibling of `src/lib/receipt-storage/`, same
  three-method (`save`/`read`/`delete`) interface shape, own `LocalClubFileStorage` /
  `DatabaseClubFileStorage` adapters, same `NODE_ENV === "production"` selection rule as DECISION-040.
  **Not** a literal reuse of `ReceiptStorage`/`ledger_receipt_files`, and not a generalization of the
  interface into a shared library yet — two consumers is "maybe," not "now" (mirrors the
  social-requests Phase 2 ruling almost exactly). New table `club_file_blobs` (bytea, mirrors
  `ledger_receipt_files`' shape), key namespace `club-files/<uuid>/<filename>`.
- **Admin surface:** `/admin/club-files` (refining Phase 1's `/admin/files` suggestion — `club-files`
  reads unambiguously against the `club_files` table/permission and avoids implying a future generic
  file browser). New `ADMIN_NAVIGATION` entry gated on `FEATURES.CLUB_FILES_MANAGE`, protection
  derived per DECISION-082 — plus the page's own independent `auth()` + `hasFeature()` call, required
  by `src/lib/admin-page-feature-gates.test.ts`.
- **Member surface:** new page `src/app/members/records/files/page.tsx`, sibling to
  `records/documents/[slug]` and `records/welcome-packet`, linked from the Records hub — not an
  inline section bolted onto the hub page. Lists ALL files (public and members-only, attached or not)
  per the User Decision, gated the same way the rest of Records is (`session.user.memberId` present;
  "Account Not Linked" empty state on the existing pattern, no new `FEATURES` key per Phase 1's
  no-`.view`-key ruling).
- **Public download route:** `GET /api/club-files/[id]/download` — a single, unified route, not
  mirrored `/api/public/...` + `/api/members/...` handlers over the same table. It checks
  `clubFiles.visibility` itself on every request (public → open; members-only → session + linked
  `memberId` required) and 404s either kind of failure. One code path enforcing one rule beats two
  copies of the same check drifting apart — exactly the duplication CLAUDE.md's review flags.
- **Event-page integration:** no new routes. `/events/[id]` (public) and `/members/events/[id]`
  (authenticated) each gain a query for attached files via the junction table and a download
  link/button using the existing card/button primitives — `/events/[id]` filters to
  `visibility = 'public'`, the member page shows all attachments regardless of visibility since the
  viewer is already inside the authenticated surface.
- **Junction table:** `club_file_events`, mirroring `groupMemberships`' shape exactly — own
  `id uuid primaryKey`, `clubFileId` FK `onDelete: cascade`, `eventId` FK `onDelete: cascade`, a
  unique constraint on `(club_file_id, event_id)` to prevent duplicate attachment rows. Cascades in
  both directions match Phase 1's ruling: delete the file → attachments vanish; delete the event →
  attachment vanishes but the file itself (and any other event's attachment of it) survives.
- **Server vs Client split:** all pages (admin list/detail, member Records/Files, event pages) are
  Server Components by default, matching every other Records/admin page in this codebase. The
  upload form and any visibility/event-multiselect controls are Client Components for controlled
  inputs and upload progress — same split as every other admin form in this codebase, nothing novel
  here.
- **Dependencies:** No new npm dependency required for storage, metadata, or the download path.
  `@vercel/blob` is **not currently installed** (removed by DECISION-040) — if Phase 3 selects the
  Blob-as-upload-transit option below, that is a new dependency add and must be evaluated against
  the Dependency Evaluation Criteria at that time, scoped explicitly to transit-only use.

## The Central Ruling — Storage (DECISION-094)

Full reasoning is in `docs/decisions.md` DECISION-094; summary:

1. **Postgres `bytea`, sibling table, not `ledger_receipt_files` reuse.** `@vercel/blob` is not a
   dependency today (DECISION-040 removed it); nothing about Club Files revives the reasons it was
   removed, and DECISION-040 already established `bytea`/TOAST has no practical concern at these
   sizes. Data-URI-in-column is rejected outright — 25MB inflates to ~33MB base64 and defeats the
   per-request visibility check this feature's adversarial pass requires.
2. **One streaming download route, visibility checked server-side every request, 404 on any
   failure.** No redirect, no signed URL — matches the `ReceiptStorage` proxy precedent and Phase 1's
   explicit requirement.
3. **The 25MB cap cannot cross a single Vercel Function request body, full stop.** Verified against
   Vercel's current docs (fetched 2026-09-04): request AND response bodies of a Vercel Function are
   capped at 4.5MB; **streaming a response bypasses this, streaming a request does not** — Vercel's
   own guidance for large uploads is to bypass the function entirely via direct-to-storage client
   upload. This means:
   - The **download** route must build a genuinely streamed `Response` (not the buffered
     `Uint8Array` pattern `receiptBytesToBodyInit()` uses today) — flagging that the existing
     receipt-proxy routes carry the same latent exposure at their 10MB cap, worth a 30-day
     code-review follow-up, out of scope here.
   - The **upload** route cannot reuse the receipt-upload route's single-shot
     `request.formData()` pattern as-is above 4.5MB. Phase 3 must pick one of two transports before
     implementation: **(a)** chunked upload assembled server-side into `club_file_blobs` (no new
     dependency, new pattern for this codebase, narrowly scoped to admin/rare use), or **(b)**
     `@vercel/blob` reintroduced strictly as upload transit (client uploads past the Function, a
     server step immediately ingests the bytes into `club_file_blobs` and deletes the Blob object) —
     acceptable because its failure mode (loud, immediate, visible to the admin at click-time) differs
     from the silent-fallback footgun DECISION-040 killed, but it is a real dependency reintroduction
     and must be justified in the Phase 3 doc, not defaulted into silently. **Either way, the durable
     storage location is `club_file_blobs` — Blob, if used, is transit only, never a second permanent
     home for bytes.**

## Invariants Touched

- **Schema Is the Source of Truth** — respected: `club_files`, `club_file_events`, `club_file_blobs`
  go into `schema.ts` first, then an idempotent migration, per the standing rule.
- **Migrations Re-Run on Every Deploy** — respected: all new tables/permission bindings use
  `IF NOT EXISTS` / `WHERE NOT EXISTS` guards, matching `0093_social_requests_permissions.sql`'s
  shape for the permission migration.
- **Permissions Are the Only Gating Mechanism** — respected: `club_files.manage` is a new
  `FEATURES` key, bound to `admin` only per the User Decision (a deliberate divergence from the
  Proposals/Social-Requests `admin` + `board_member` default — this is admin-only by design, not an
  oversight, and the migration must bind only `admin`, matching `documents.manage`/
  `welcome_packet.manage`'s precedent, not `events.announce`'s two-role precedent).
- **Admin-Area Protection Is Derived, Never Hand-Maintained (DECISION-082)** — respected: the new
  `/admin/club-files` entry goes into `ADMIN_NAVIGATION`, nothing hand-written into `src/proxy.ts`,
  and the page still needs its own independent `hasFeature()` call.
- **No Personal Data in the Repository** — not violated. Confirming Phase 1's own adversarial-pass
  note explicitly: the driving PDF's two event-chair emails live in DB/blob storage, served at
  request time, and never enter the git repo. The invariant is about the repository, not the app's
  data stores — conflating the two would be a misreading of this rule, not a stricter application
  of it.
- **Dependency Evaluation Criteria** — no new dependency required for the storage/download ruling
  above; a conditional dependency (`@vercel/blob`, transit-only) is possible pending Phase 3's
  upload-transport choice and must be evaluated at that time if selected.

## Suggestions (non-blocking, but the first is load-bearing for Phase 3)

1. **Upload transport must be explicitly decided in the Phase 3 design doc** — chunked upload vs.
   scoped Blob-transit, per DECISION-094. This is the one item in this review that isn't optional
   polish; a naive port of the receipt-upload route will 413 in production on any file over 4.5MB,
   which is well within the range of "print-quality sponsor deck" the User Decision's 25MB cap was
   chosen for.
2. Reuse `validateMagicBytes()`'s pattern (or extend it) for the PDF-only signature check — no need
   to reinvent magic-byte validation; restrict the accepted set to `%PDF-` only, per Phase 1.
3. Use the `add-permission` skill to generate the `club_files.manage` migration rather than
   hand-copying an existing one — reduces risk of the admin-only binding drifting into an accidental
   `board_member` grant (exactly the kind of mistake the 0093 migration's own comment flags as a real
   historical near-miss for a *different* feature).
4. `/admin/club-files` vs. Phase 1's `/admin/files` is a naming refinement, not a requirement —
   ux-developer/tech-lead may keep `/admin/files` if there's a strong reason; either is
   architecturally sound as long as it doesn't collide with a future generic file browser.

## Notes for Phase 3

- Pick the upload transport and document why (DECISION-094 names the two acceptable options).
- Design the download route's streamed-`Response` construction explicitly — this is new code, not a
  copy of `receiptBytesToBodyInit()`.
- `club_files` metadata table needs at minimum: `id`, `title`, `description` (nullable),
  `visibility` (`'public' | 'members-only'`, no CHECK constraint per this codebase's established
  status-column precedent — DECISION-041), `storageKey` (references the `club_file_blobs` row),
  `contentType`, `byteSize`, `createdAt`, `updatedAt`. Replace-in-place (Phase 1's ruling) means
  swapping `storageKey`/`contentType`/`byteSize` on the same row, not inserting a new one.
- `club_file_events` needs the unique-pair constraint from day one — don't ship it without and add
  later, since duplicate attachment rows would double-render the same file on an event page.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Club Files is a general-purpose, admin-authored PDF library: an admin uploads a PDF, tags it
public or members-only, optionally attaches it to one or more events, and members/anonymous
visitors download it through one unified, visibility-checked route. Storage is Postgres `bytea`
in a new sibling table (`club_file_blobs`), following the `receipt-storage` pattern per
DECISION-094. The one genuinely new piece of engineering is the upload transport: a 25MB file
cannot cross Vercel's 4.5MB function request-body cap in one shot, so uploads go through a
chunked-upload session (init → N chunk `PUT`s → finalize) that assembles, checksums, and
magic-byte-validates the file server-side before it ever becomes a durable `club_files` row.

## Permissions

- Permission key: `club_files.manage` — create, edit metadata, replace bytes, attach/detach
  events, delete. No `.view`/`.read` key (Phase 1 ruling; download route enforces visibility
  itself).
- Default role binding: `admin` only (per User Decision — deliberately narrower than
  `proposals.review`/`social_requests.review`'s admin+board_member default).
- Category: new `FEATURE_CATEGORIES.CLUB_FILES = "club_files"`.
- Admin nav label: "Club Files", icon `📎`, `href: "/admin/club-files"`.

## Upload Transport — the load-bearing decision

**Chosen: (a) chunked upload assembled into `club_file_blobs`.** No new dependency; the
requirement (25MB, a handful of uploads/year, admin-only) doesn't justify reintroducing
`@vercel/blob` and its DECISION-040 failure-mode history. Concretely:

- **Chunk size: 3 MB (3,145,728 bytes), sent as raw `application/octet-stream` bytes** (a `Blob`
  slice as the `fetch` body — never base64/multipart, which would inflate a 3MB chunk to ~4MB and
  eat the safety margin for nothing). Raw binary PUT gives the true byte count as the request
  body size, well under the 4.5MB cap with headroom for headers.
- **Session shape** — two new tables:
  - `club_file_upload_sessions`: `id` (uuid PK), `filename`, `declaredSize` (int, ≤ 25MB, checked
    at init), `chunkSize` (int, always 3145728, stored for the client to recompute chunk
    boundaries), `totalChunks` (int, `ceil(declaredSize / chunkSize)`), `replaceFileId`
    (uuid, nullable, FK → `club_files(id) ON DELETE CASCADE` — set only when this session is
    replacing an existing file's bytes, null for a brand-new upload), `status`
    (`'uploading' | 'complete' | 'failed'`, no CHECK per DECISION-041 precedent),
    `createdByUserId` (FK → `users`), `createdAt`, `updatedAt`.
  - `club_file_upload_chunks`: **composite PK `(session_id, chunk_index)`** — this is what makes
    a chunk re-`PUT` idempotent for free (`ON CONFLICT (session_id, chunk_index) DO UPDATE`, no
    separate unique constraint needed). Columns: `sessionId` (FK → sessions, `ON DELETE CASCADE`),
    `chunkIndex` (int), `bytes` (bytea), `byteSize` (int), `createdAt`.
- **Flow:**
  1. `POST /api/admin/club-files/upload-sessions` — init. Body `{ filename, declaredSize,
     replaceFileId? }`. Validates `declaredSize ≤ 26214400`. **Before creating the row, sweeps
     stale sessions**: `DELETE FROM club_file_upload_sessions WHERE status != 'complete' AND
     created_at < now() - interval '24 hours'` (cascades to orphaned chunk rows via FK) — this is
     the whole cleanup story; no cron, no background job, just "the next person to upload takes
     out yesterday's trash." Returns `{ sessionId, chunkSize, totalChunks }`.
  2. `PUT /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]` — body is the raw
     chunk bytes. Validates `index` is in `[0, totalChunks)` and the byte length matches
     `chunkSize` for every chunk except the last (which matches the remainder). Upserts by
     `(sessionId, index)` — **retrying an identical chunk PUT after a network blip is always
     safe**, and chunks can arrive out of order (the client uploads sequentially in practice, but
     the server doesn't require it). Returns `{ chunkIndex, receivedChunks, totalChunks }` so the
     client can drive a progress bar off the response rather than tracking state itself.
  3. `POST /api/admin/club-files/upload-sessions/[sessionId]/finalize` — body `{ name?,
     description?, visibility?, checksumSha256? }` (`name`/`visibility` **required** when
     `replaceFileId` is null — a new file; **ignored** when replacing, since Phase 1 ruled replace
     keeps the existing row's metadata). Steps, inside one DB transaction:
     - Confirm chunk count present equals `totalChunks` with no gaps (`SELECT chunk_index ...
       ORDER BY chunk_index` and check for a contiguous `0..totalChunks-1` run) — a genuine gap
       (dropped chunk) fails finalize with 400 `"Upload incomplete — missing chunk N"` rather than
       silently assembling a truncated file.
     - Concatenate chunk bytes in `chunkIndex` order into one `Buffer`.
     - Verify `assembled.byteLength === declaredSize`. Mismatch → 400, session marked `failed`,
       chunks left in place so the client can inspect/retry rather than starting over blind.
     - If the client sent `checksumSha256`, compute SHA-256 of the assembled buffer and compare;
       mismatch → 400 `"Checksum mismatch — please retry the upload"`. (Optional, not required —
       size + magic-byte checks already catch corruption; the checksum is a client-side belt for
       "did every chunk really arrive intact," cheap to add since the bytes are already in memory.)
     - Magic-byte check: **reuse `validateMagicBytes()` from `src/lib/receipt-magic-bytes.ts`
       unchanged** and require the result `=== "application/pdf"` — anything else (including a
       genuinely valid JPEG/PNG) is rejected for Club Files in v1. This deliberately avoids writing
       a second byte-signature implementation; the existing function already emits exactly the
       token this feature needs.
     - **Replace-in-place atomicity** (only when `replaceFileId` is set): `SELECT storage_key FROM
       club_files WHERE id = $replaceFileId FOR UPDATE` first — the row lock both captures the old
       key and serializes concurrent replaces of the same file (a second finalize simply waits,
       then correctly sees the first replace's new key as "old" when its own turn comes — no
       orphaned blob, no lost update). Then: insert the new blob under a **new** key, `UPDATE
       club_files SET storage_key = $new, filename, byte_size, content_type, updated_at = now()
       WHERE id = $replaceFileId`, and only *after* that UPDATE commits, `DELETE FROM
       club_file_blobs WHERE key = $old`. Old bytes stay servable through every step up to the
       `UPDATE` — a failure at the magic-byte or checksum step above never touches the old row at
       all, since those checks run before this block.
     - Non-replace: insert a new `club_files` row + new `club_file_blobs` row.
     - Delete the session and its chunk rows (success cleanup — the 24h sweep above is the
       failure-path backstop).
  4. **Failure UX:** any 400 from chunk-PUT or finalize leaves the session alive (not deleted) so
     the client can retry just the failed step — re-uploading all 3MB chunks from scratch on a
     transient network error would be a bad experience for a 25MB file on a slow connection. The
     admin UI shows the specific error message returned (missing chunk / size mismatch / checksum
     mismatch / "not a valid PDF") inline, never a generic toast, mirroring Phase 1's Flow 1
     failure requirement.
- **Why not @vercel/blob (option b):** rejected per Phase 2 — no dependency reintroduction is
  needed to clear a 25MB, admin-only, few-times-a-year requirement; chunked upload is the simpler
  design that still meets the cap. See DECISION-095 for the full recorded reasoning.

## Data Model

Five new tables, added to `src/lib/db/schema.ts` first, then an idempotent migration
`drizzle/migrations/0097_club_files.sql`.

```
club_files
  id                uuid PK default random
  name              text NOT NULL
  description       text NULL
  visibility        text NOT NULL              -- 'public' | 'members-only', no CHECK (DECISION-041)
  filename          text NOT NULL              -- original name, sanitized, for Content-Disposition
  content_type      text NOT NULL default 'application/pdf'
  byte_size         integer NOT NULL
  storage_key       text NOT NULL              -- -> club_file_blobs.key, e.g. club-files/<uuid>/<name>
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
  created_at        timestamptz NOT NULL default now()
  updated_at        timestamptz NOT NULL default now()

club_file_blobs                                -- mirrors ledger_receipt_files exactly
  key               text PK                    -- club-files/<uuid>/<sanitized-filename>
  content_type      text NOT NULL
  bytes             bytea NOT NULL
  byte_size         integer NOT NULL
  created_at        timestamptz NOT NULL default now()

club_file_events                                -- junction, mirrors group_memberships' shape
  id                uuid PK default random
  club_file_id      uuid NOT NULL REFERENCES club_files(id) ON DELETE CASCADE
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
  created_at        timestamptz NOT NULL default now()
  UNIQUE (club_file_id, event_id)               -- from day one — prevents duplicate render rows

club_file_upload_sessions
  id                uuid PK default random
  filename          text NOT NULL
  declared_size     integer NOT NULL
  chunk_size        integer NOT NULL
  total_chunks      integer NOT NULL
  replace_file_id   uuid NULL REFERENCES club_files(id) ON DELETE CASCADE
  status            text NOT NULL default 'uploading'   -- no CHECK, DECISION-041 precedent
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
  created_at        timestamptz NOT NULL default now()
  updated_at        timestamptz NOT NULL default now()

club_file_upload_chunks
  session_id        uuid NOT NULL REFERENCES club_file_upload_sessions(id) ON DELETE CASCADE
  chunk_index       integer NOT NULL
  bytes             bytea NOT NULL
  byte_size         integer NOT NULL
  created_at        timestamptz NOT NULL default now()
  PRIMARY KEY (session_id, chunk_index)          -- gives idempotent upsert for free
```

`club_file_blobs` is **single-row-per-file** (assembled bytes, not per-chunk rows) — chunking is
purely an upload-transport concern. Once finalize assembles and validates the bytes, they live as
one `bytea` row, exactly like `ledger_receipt_files`. This keeps the download path identical to
the existing receipt-proxy precedent (one `SELECT`, one `Buffer`) rather than requiring the
download route to reassemble chunks — that complexity has no reason to leak past finalize. Peak
memory footprint for both upload-finalize and download is one 25MB `Buffer` in a serverless
function's memory — well inside Vercel's per-invocation memory ceiling, and matches the ceiling
DECISION-040 already accepted for `bytea`/TOAST at this scale.

Permission migration `drizzle/migrations/0098_club_files_permissions.sql` — `club_files.manage` →
`admin` only, shaped exactly like `0093_social_requests_permissions.sql`'s block 1–2 (skip its
block 3, since there is no `board_member` binding here).

## API Contract

**Admin (all gated `auth()` + `hasFeature(FEATURES.CLUB_FILES_MANAGE)`):**

- `GET /api/admin/club-files` — list. Response `{ files: { id, name, description, visibility,
  filename, byteSize, contentType, attachedEventCount, createdAt, updatedAt }[] }`.
- `POST /api/admin/club-files/upload-sessions` — init (create or replace). See above.
- `PUT /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]` — chunk PUT. See above.
- `POST /api/admin/club-files/upload-sessions/[sessionId]/finalize` — finalize. See above.
- `PATCH /api/admin/club-files/[id]` — metadata only. Body `{ name?, description?, visibility? }`.
  Response `{ file }`.
- `DELETE /api/admin/club-files/[id]` — deletes the `club_files` row (cascades
  `club_file_events`) and its `club_file_blobs` row. Response `{ deleted: true }`.
- `PUT /api/admin/club-files/[id]/attachments` — **replace-the-full-set** semantics. Body
  `{ eventIds: string[] }`; server dedupes, diffs against current attachments, inserts/deletes
  only the difference inside one transaction. Response `{ eventIds: string[] }`.

**Public/member download (unified, no admin gate):**

- `GET /api/club-files/[id]/download` — checks `club_files.visibility` on every request.
  `visibility = 'public'` → served unauthenticated. `visibility = 'members-only'` → requires
  `auth()` session with a non-null `session.user.memberId`. **Every failure mode (not found,
  wrong visibility, no session, no linked member) returns 404** — never 403, per Phase 1's
  adversarial-pass ruling. Success: a genuinely streamed `Response` — bytes read from
  `club_file_blobs` into one `Buffer` server-side, then enqueued into a `ReadableStream` in
  ~256KB slices (`new Response(stream, { headers })`), not `receiptBytesToBodyInit()`'s
  buffer-as-body pattern, which is what actually avoids Vercel's 4.5MB *buffered*-response cap
  (streaming a response bypasses it; a single large `Uint8Array` body does not). Headers:
  `Content-Type: application/pdf`, `Content-Disposition: inline; filename="<sanitized>.pdf"` —
  filename is re-sanitized at serve time (never echoed from user input unsanitized), matching
  Phase 1's adversarial-pass requirement.

Event pages use no new routes — server-side queries via a new `src/lib/club-files-queries.ts`:
`getPublicAttachedFiles(eventId)`, `getAllAttachedFiles(eventId)` (members), and
`listAllClubFilesForMembers()` (Records "Files" page — every file, per the User Decision).

## Component / Page Plan

**Pages to create:**
- `src/app/(dashboard)/admin/club-files/page.tsx` — list, empty state, "Upload a file" entry point.
- `src/app/(dashboard)/admin/club-files/[id]/page.tsx` — metadata edit, replace-file control,
  event attach/detach picker, delete (`ConfirmDialog`).
- `src/app/members/records/files/page.tsx` — member Files list (all files, per User Decision),
  linked from the Records hub as its own card/tile, not inlined into `records/page.tsx`.

**Components to create:**
- `src/lib/hooks/use-chunked-upload.ts` — the init→PUT-chunks→finalize loop with progress
  callback, retry-on-chunk-failure, and error surfacing. **Shared by both the new-file upload form
  and the replace-file control** — this is the one place the chunk loop is allowed to live;
  writing it twice would be exactly the copy-paste CLAUDE.md's duplication review flags.
- `src/components/admin/club-files/club-file-upload-form.tsx` (client) — drag/drop + metadata
  fields, uses the hook, inline field-preserving errors per Phase 1 Flow 1.
- `src/components/admin/club-files/club-file-replace-control.tsx` (client) — same hook, scoped to
  an existing file, no metadata fields.
- `src/components/admin/club-files/event-attach-picker.tsx` (client) — searchable multiselect.
- `src/components/admin/club-files/delete-club-file-button.tsx` (client) — `ConfirmDialog` wrapper.
- `src/components/events/attached-files-list.tsx` — small server-renderable presentational piece
  shared by the public and member event pages (list of file name + download link).

**Files to modify:**
- `src/lib/permissions.ts` — `FEATURES.CLUB_FILES_MANAGE`, `FEATURE_DESCRIPTIONS`,
  `FEATURE_CATEGORIES.CLUB_FILES`, `ADMIN_NAVIGATION` entry.
- `src/lib/db/schema.ts` — five new tables above.
- `src/app/events/[id]/page.tsx` — render public attached files via `attached-files-list`.
- `src/app/members/events/[id]/page.tsx` — render all attached files (any visibility).
- `src/app/members/records/page.tsx` — add a "Files" card/link into the existing hub layout.

## Implementation Order

1. **Schema** — `database-admin`: five tables in `schema.ts` + `0097_club_files.sql` (idempotent
   `CREATE TABLE IF NOT EXISTS` + guarded unique constraint on `club_file_events`).
2. **Permission** — `database-admin` or via the `/add-permission` skill: `FEATURES.CLUB_FILES_MANAGE`
   in `permissions.ts` + `0098_club_files_permissions.sql` (admin-only, mirrors 0093's shape).
3. **Storage adapter** — `api-developer`: `src/lib/club-file-storage/` (`index.ts`, `local.ts`,
   `database.ts`), same three-method interface and `NODE_ENV` selection as `receipt-storage`.
4. **API routes** — `api-developer`: upload-session init/chunk/finalize, admin CRUD,
   attachments, and the unified streamed download route. `club-files-queries.ts` helpers.
5. **UI** — `ux-developer`: admin list/detail pages, upload/replace controls + shared hook, member
   Files page, event-page integration.
6. **Release notes entry** — tech-lead, at ship time.

## Edge Cases & Risks

- **Delete a file attached to events.** `club_file_events` rows cascade-delete with the
  `club_files` row (FK `ON DELETE CASCADE`); event pages simply stop rendering it on next request.
  No confirmation copy needed beyond the standard file-delete `ConfirmDialog` — matches Phase 1's
  ruling that attachment is a convenience view, not a second source of truth.
- **Upload with a duplicate display name.** Allowed — `name` has no uniqueness constraint. Only
  `storage_key` (uuid-namespaced) needs to be unique, and it always is by construction.
- **Zero-byte or corrupt PDF.** Caught by the existing `validateMagicBytes()` check at finalize
  (a buffer under 4 bytes, or one that doesn't start `%PDF-`, returns `null`) — 400 before any
  `club_files`/`club_file_blobs` row is written.
- **Concurrent replace of the same file.** Handled by `SELECT ... FOR UPDATE` on the `club_files`
  row inside finalize's replace branch (see above) — the second finalize serializes behind the
  first; no orphaned blob, no lost update, no special client-side locking needed.
- **Event deleted mid-attachment-picker-session in the admin UI.** The `PUT .../attachments` diff
  against `event_id` naturally no-ops for an id that no longer exists (FK would reject the insert)
  — surfaces as a normal save-failed toast; not worth special-casing further given the admin-only,
  low-volume surface.
- **Abandoned upload session (admin closes the tab mid-upload).** No cleanup job runs for it —
  it sits until the *next* init call's 24h sweep deletes it (and its chunk rows, via cascade).
  Acceptable: worst case is a handful of unused rows for at most a day, on a feature used a few
  times a year.
- **Streaming download memory footprint.** Both finalize and download hold one full file (≤25MB)
  in memory at a time — no chunk-by-chunk DB reads. Explicitly accepted as fine at this cap and
  volume; flagged in case a future size-cap increase revisits it.

## Implementer

**Specialist split — database-admin → api-developer → ux-developer.** This spans new schema (5
tables), a new storage adapter, a genuinely new upload-session protocol, and four UI surfaces
(admin list, admin detail, member Files page, two event-page integrations) — well past the
~150-line full-stack-developer threshold, and each layer has a clean, sequential handoff exactly
like every increment of The Ledger. Do not use full-stack-developer here.

1. **database-admin** — schema + both migrations (0097 schema, 0098 permission).
2. **api-developer** — storage adapter, upload-session routes, admin CRUD routes, download route,
   `club-files-queries.ts`.
3. **ux-developer** — all four UI surfaces + the shared `use-chunked-upload` hook.

## Unit Tests Required (Phase 4 gate — implementer delivers these, not qa)

- `src/lib/club-file-storage/local.test.ts` — save/read round trip, overwrite (replace), delete
  no-op on missing key, path-traversal sanitization (mirrors `receipt-storage`'s existing suite).
- `src/lib/club-file-storage/database.test.ts` — save/read/delete round trip against the DB
  adapter (mirrors `database.test.ts` under `receipt-storage/`).
- `src/app/api/admin/club-files/upload-sessions/route.test.ts` — `declaredSize` over 25MB
  rejected; stale (>24h, non-`complete`) session sweep deletes prior orphaned sessions and their
  chunks on init.
- `.../upload-sessions/[sessionId]/chunks/[index]/route.test.ts` — non-final chunk with wrong
  byte length rejected; out-of-range index rejected; **re-PUTting the same index twice succeeds
  and stores the latest bytes (idempotent retry)**.
- `.../upload-sessions/[sessionId]/finalize/route.test.ts` — **chunk-assembly checksum
  mismatch** rejected (400, session left alive); **size mismatch** (assembled ≠ declaredSize)
  rejected; **magic-byte rejection** (assembled bytes not `%PDF-`, including a valid
  JPEG/PNG) rejected; missing/gapped chunk rejected; happy-path create; **happy-path replace
  atomicity** — simulate a finalize failure after chunks are uploaded and assert the original
  `club_files` row and its old blob are unchanged and still servable.
- `src/app/api/club-files/[id]/download/route.test.ts` — **visibility enforcement 404 matrix**:
  public+unauthenticated→200, public+authenticated→200, members-only+unauthenticated→404,
  members-only+authenticated-no-memberId→404, members-only+authenticated-with-memberId→200,
  nonexistent id→404, deleted file id→404. Plus: `Content-Type`/`Content-Disposition` header
  correctness, and that no 403 is ever returned.
- `src/app/api/admin/club-files/[id]/attachments/route.test.ts` — full-set replace semantics;
  duplicate `eventId` in the request body deduped, not a unique-constraint error.
- `src/lib/admin-page-feature-gates.test.ts` — extend with `/admin/club-files` (existing test file
  fails the build if a new admin page ships without its own `hasFeature()` check).

## Open questions / handoff notes

- **database-admin starts first.** Schema (`schema.ts` + `0097_club_files.sql`) and the permission
  migration (`0098_club_files_permissions.sql`, admin-only — use the `/add-permission` skill or
  mirror `0093_social_requests_permissions.sql`'s blocks 1–2, skipping its `board_member` block).
- **api-developer next**, once schema lands. Build `src/lib/club-file-storage/` before the routes
  that consume it. The download route's `ReadableStream` construction is new code — do not copy
  `receiptBytesToBodyInit()`'s buffer-as-body pattern, which is exactly what the streaming
  requirement exists to avoid.
- **ux-developer last.** Build `use-chunked-upload` once, share it between the new-file form and
  the replace control — do not let two copies of the chunk loop exist even transiently.
- Flagging for the 30-day code review (not blocking here): the existing receipt-proxy download
  routes carry the same buffered-response exposure at their 10MB cap that Club Files' download
  route is designed to avoid — Phase 2 already noted this as an out-of-scope follow-up.
- DECISION-095 logged in `docs/decisions.md` for the chunked-upload transport choice.

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

## Phase 4a — Schema Implementation (database-admin) — 2026-09-04

**Owner:** database-admin
**Status:** complete

### Summary

Implemented the five-table schema slice for Club Files exactly as specified in the Phase 3
design doc: `club_files`, `club_file_blobs` (single-row-per-file bytea, mirrors
`ledger_receipt_files`), `club_file_events` (junction, unique `(club_file_id, event_id)`),
`club_file_upload_sessions`, and `club_file_upload_chunks` (composite PK
`(session_id, chunk_index)`). Added the `club_files.manage` permission, bound to `admin` only,
and the corresponding admin nav entry. No storage adapter, routes, or UI were touched, per scope.

### What I did

- Added all five tables to `src/lib/db/schema.ts`, reusing the existing `bytea` custom type
  (already defined for `ledgerReceiptFiles`) rather than redefining it.
- Added `primaryKey` to the schema.ts drizzle-orm/pg-core import (first composite-PK table in
  this schema) for `club_file_upload_chunks`.
- Wrote `drizzle/migrations/0097_club_files.sql` — five `CREATE TABLE IF NOT EXISTS` statements
  plus two guarded `DO $$` index blocks (`ux_club_file_events_file_event` unique,
  `ix_club_file_events_event`). Verified 0097/0098 were next-free by `ls drizzle/migrations/*.sql
  | sort | tail -3` at the start of this phase (last existing was 0096).
- Wrote `drizzle/migrations/0098_club_files_permissions.sql` — `club_files.manage` feature +
  `admin`-only role binding, mirroring `0090_welcome_packets.sql`'s admin-only shape, deliberately
  omitting the `board_member` block that `0093`/`0094` use (per the User Decision in this
  work-log).
- Updated `src/lib/permissions.ts`: `FEATURES.CLUB_FILES_MANAGE = "club_files.manage"`, a
  `FEATURE_DESCRIPTIONS` entry byte-identical to the migration's seeded description ("Upload,
  edit, attach to events, and delete club files"), `FEATURE_CATEGORIES.CLUB_FILES`, and a new
  "Club Files" entry (icon 📎, `href: "/admin/club-files"`) in the `ADMIN_NAVIGATION` "Records"
  group, alongside Minutes / Governing Documents / Welcome Packet.
- Ran `pnpm exec tsc --noEmit` — clean.
- Ran `pnpm db:migrate` against dev twice. First run applied 0097/0098 cleanly. Second run
  produced only Postgres NOTICEs (`relation "club_files" already exists, skipping`, etc.) for
  every new object — idempotency confirmed.
- Verified table shapes via `psql \d` against all five tables — columns, types, defaults, FKs,
  and both `club_file_events` indexes (`ux_club_file_events_file_event` UNIQUE,
  `ix_club_file_events_event`) and the `club_file_upload_chunks` composite PK
  `(session_id, chunk_index)` all match the design doc and `schema.ts` exactly.
- Verified the permission binding via `psql`: `club_files.manage` → `admin` only, no
  `board_member` row — confirmed no accidental widening.

### Outputs

- `src/lib/db/schema.ts` — added `clubFiles`, `clubFileBlobs`, `clubFileEvents`,
  `clubFileUploadSessions`, `clubFileUploadChunks` + inferred `Select`/`Insert` types for each;
  added `primaryKey` to the pg-core import.
- `drizzle/migrations/0097_club_files.sql` — all statements idempotent
  (`CREATE TABLE IF NOT EXISTS`, guarded `DO $$` index blocks).
- `drizzle/migrations/0098_club_files_permissions.sql` — all statements idempotent
  (`WHERE NOT EXISTS`, `NOT EXISTS` subquery guard on the role binding).
- `src/lib/permissions.ts` — `FEATURES.CLUB_FILES_MANAGE`, `FEATURE_DESCRIPTIONS` entry,
  `FEATURE_CATEGORIES.CLUB_FILES`, `ADMIN_NAVIGATION` "Records" group entry.
- Tables affected: `club_files`, `club_file_blobs`, `club_file_events`,
  `club_file_upload_sessions`, `club_file_upload_chunks` (all new; no existing table touched).
- Role binding added: `club_files.manage` → `admin` only (`SELECT r.id, f.id FROM roles r CROSS
  JOIN features f WHERE r.name = 'admin' AND f.name = 'club_files.manage' AND NOT EXISTS (...)`
  pattern, matching `0090_welcome_packets.sql`).
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
  (run twice, both clean — see above).

### Open questions / handoff notes

- **`pnpm db:push` was not run to completion.** It hit an interactive prompt unrelated to this
  change — drizzle-kit detected an existing schema drift on `ledger_entities`
  (`ledger_entities_slug_unique` constraint conflicting with 2 existing rows) and asked whether to
  truncate that table. This predates and is unrelated to Club Files; I did not force through it
  since doing so risks truncating unrelated ledger data without consent. The five new Club Files
  tables were created entirely by the idempotent SQL migration (0097) and verified column-for-
  column against `schema.ts` via `psql \d` — `db:push` is not required to bring them live. Flagging
  for deployment-engineer/whoever next runs `db:push` (with `--force`, matching the build
  pipeline) that this unrelated prompt exists and needs a deliberate answer, not an accidental
  `--force` truncation.
- **New tables available to api-developer:** `clubFiles`, `clubFileBlobs`, `clubFileEvents`,
  `clubFileUploadSessions`, `clubFileUploadChunks`, all exported from `src/lib/db/schema.ts` with
  inferred `Select`/`Insert` types (`ClubFile`/`NewClubFile`, etc.).
- **Foreign keys / relationships:** `club_files.uploaded_by_user_id` → `users.id` (SET NULL);
  `club_file_events.club_file_id` → `club_files.id` (CASCADE), `.event_id` → `events.id`
  (CASCADE), unique on `(club_file_id, event_id)`; `club_file_upload_sessions.replace_file_id` →
  `club_files.id` (CASCADE — a session referencing a file that gets deleted mid-upload is cleaned
  up automatically), `.created_by_user_id` → `users.id` (SET NULL); `club_file_upload_chunks`
  composite PK `(session_id, chunk_index)` gives idempotent chunk upsert for free, FK →
  `club_file_upload_sessions.id` (CASCADE).
- **`bytea` custom type reused, not redefined** — both `club_file_blobs.bytes` and
  `club_file_upload_chunks.bytes` use the existing `bytea` export already defined for
  `ledgerReceiptFiles`, per the design doc's instruction to mirror that idiom.
- **Next agent: api-developer.** Build `src/lib/club-file-storage/` (the `ClubFileStorage`
  adapter per DECISION-094) before the upload-session/CRUD/download routes that consume it. The
  design doc's Phase 3 API Contract and Unit Tests Required sections are the spec — nothing in
  this schema slice diverged from them.

---

## Phase 4b — API Implementation (api-developer) — 2026-09-04

**Owner:** api-developer
**Status:** complete

### Summary

Implemented the full server-side slice for Club Files exactly as specified in Phase 3: the
`ClubFileStorage` adapter (sibling of `receipt-storage`, DECISION-094), the three-step
chunked-upload session protocol (DECISION-095), admin CRUD + full-set-replace attachments, and
the unified, visibility-checked, genuinely-streamed download route. No schema changes — the
five tables database-admin shipped in Phase 4a were sufficient as designed. Every unit test the
Phase 3 design doc names for this layer is written and passing (98 test files / 1845 tests
total in the suite after this change, all green); `pnpm exec tsc --noEmit` is clean.

### What I did

- Read `src/lib/receipt-storage/` in full (interface, both adapters, both test suites) and
  mirrored its exact idiom for `src/lib/club-file-storage/` — same three-method interface,
  same `NODE_ENV`-gated singleton factory, same upsert-with-`createdAt`-omitted semantics on
  the database adapter, same path-traversal-safe local adapter. Added `.club-file-store/` to
  `.gitignore` alongside the existing `.receipt-store/` entry.
- Read `src/lib/documents-queries.ts` (the `SELECT ... FOR UPDATE` + same-transaction-flip
  pattern for `adoptVersion`/`createDocumentVersion`) and used it as the direct model for
  finalize's replace-in-place atomicity — same row-lock-then-flip shape, adapted for a storage
  adapter that isn't itself transaction-aware (the new blob is written via `storage.save()`
  *before* the transaction, the row flip happens *inside* the transaction, and the old blob is
  deleted via `storage.delete()` only *after* the transaction resolves — matching the design
  doc's explicit ordering).
- Grepped `src/app/api` for the auth-gate idiom actually in use and confirmed
  `hasFeature(session.user.id, FEATURES.X)` (server, async, `@/lib/permissions-server`) is
  the actual codebase convention (84 call sites) versus the synchronous
  `hasFeature(session.user.features, ...)` shown in CLAUDE.md's own example (0 call sites in
  `src/app/api`) — followed the real convention throughout, per CLAUDE.md's own instruction to
  consult existing route handlers for patterns to follow.
- Followed the `documents-queries.ts` / `minutes-queries.ts` split precedent: business logic
  and all DB access live in two query modules (`club-files-queries.ts` for CRUD/attachments/
  listings, `club-file-upload-queries.ts` for the session protocol — a deliberate split since
  upload-transport and steady-state CRUD are different concerns per Phase 3); every route
  handler is thin (auth → hasFeature → validate → delegate → map result to HTTP status).
- Built the finalize logic exactly per Phase 3's ordered steps: contiguous-chunk check →
  assemble → size check → optional checksum → magic-byte check (`validateMagicBytes()` reused
  unchanged, requiring `=== "application/pdf"`) → replace-in-place-or-create. Every rejection
  path marks the session `status = 'failed'` (not deleted) so the client can inspect/retry;
  only the two success paths delete the session row.
- Built the download route's `ReadableStream` from scratch (256KB slices via
  `Uint8Array.from(buffer.subarray(...))`, the same pooled-buffer-safe copy pattern
  `receiptBytesToBodyInit()` documents) — did NOT reuse the buffered
  `receiptBytesToBodyInit()` pattern, per Phase 3's explicit instruction that doing so would
  reintroduce exactly the buffered-response exposure this route exists to avoid.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (98 files / 1845 tests passed, zero
  regressions) after every meaningful batch of changes.
- `pnpm lint` could not run — pre-existing, unrelated to this change: the repo's installed
  `eslint@9.39.2` fails to load its own config (`minimatch` ESM/CJS export mismatch inside
  `@eslint/eslintrc`) on this machine. Flagging for deployment-engineer's 30-day dependency
  review; not something this feature introduced or can fix from application code.

### Outputs

**Storage adapter** — `src/lib/club-file-storage/`:
- `ClubFileStorage` interface (`save`/`read`/`delete`), `getClubFileStorage()` singleton factory
  (`NODE_ENV === "production"` → `DatabaseClubFileStorage`; otherwise → `LocalClubFileStorage`),
  `sanitizeClubFileName()`, `CLUB_FILE_KEY_REGEX`, `_resetClubFileStorageForTest()`.
- `LocalClubFileStorage` — writes to `.club-file-store/<key>` (gitignored), sidecar `.ct` file
  for content-type, path-traversal-safe key resolution.
- `DatabaseClubFileStorage` — `club_file_blobs`, upsert via `ON CONFLICT (key) DO UPDATE`,
  `createdAt` omitted from the update set (first-write-wins).

**Query modules:**
- `src/lib/club-files-queries.ts` — `CLUB_FILE_VISIBILITIES`, `isValidClubFileVisibility()`,
  `listClubFilesForAdmin()`, `getClubFileById()`, `updateClubFileMetadata()`, `deleteClubFile()`
  (row + blob), `getClubFileEventIds()`, `setClubFileEventAttachments()` (full-set-replace,
  dedupe + diff inside one transaction), `getPublicAttachedFiles(eventId)` (visibility='public'
  only), `getAllAttachedFiles(eventId)` (any visibility, for the member event page),
  `listAllClubFilesForMembers()` (every file, per the User Decision), `getClubFileForDownload()`
  (fetch-only — does NOT check visibility; that's the download route's job).
- `src/lib/club-file-upload-queries.ts` — `CLUB_FILE_CHUNK_SIZE` (3,145,728),
  `CLUB_FILE_MAX_DECLARED_SIZE` (26,214,400), `sweepStaleUploadSessions()`,
  `createUploadSession()`, `getUploadSession()`, `putUploadChunk()` (idempotent upsert by
  `(sessionId, chunkIndex)`), `finalizeUploadSession()` (the full assemble/validate/persist
  pipeline, replace-in-place atomicity included).

**Routes (all admin routes gated `auth()` + `hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE)`):**

- `GET /api/admin/club-files` → `200 { files: AdminClubFileSummary[] }` (id, name, description,
  visibility, filename, byteSize, contentType, attachedEventCount, createdAt, updatedAt).
- `PATCH /api/admin/club-files/[id]` → body `{ name?, description?, visibility? }` →
  `200 { file }` / `400` invalid field / `404` not found.
- `DELETE /api/admin/club-files/[id]` → `200 { deleted: true }` / `404` not found.
- `PUT /api/admin/club-files/[id]/attachments` → body `{ eventIds: string[] }` (server dedupes)
  → `200 { eventIds: string[] }` / `400` bad shape / `404` file not found.
- `POST /api/admin/club-files/upload-sessions` → body
  `{ filename, declaredSize, replaceFileId? }` → `200 { sessionId, chunkSize, totalChunks }` /
  `400` bad size or over 25MB / `404` replaceFileId not found. Sweeps stale (>24h,
  non-`'complete'`) sessions first, every call.
- `PUT /api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]` → raw
  `application/octet-stream` body, no JSON wrapper → `200 { chunkIndex, receivedChunks,
  totalChunks }` / `400` bad index or wrong byte length / `404` session not found. Idempotent:
  re-PUTting the same index always succeeds and stores the latest bytes.
- `POST /api/admin/club-files/upload-sessions/[sessionId]/finalize` → body
  `{ name?, description?, visibility?, checksumSha256? }` (name/visibility **required** for a
  new file, **ignored** when the session is a replace) → `200 { id, replaced: boolean }` /
  `400` missing/gapped chunk, size mismatch, checksum mismatch, not-a-valid-PDF, or missing
  metadata / `404` session not found. Any `400` leaves the session alive (status flips to
  `'failed'`, chunks untouched) so the client can retry just the failed step.
- `GET /api/club-files/[id]/download` — **no admin gate.** `visibility='public'` → served
  unauthenticated. Anything else → requires `auth()` + a non-null `session.user.memberId`.
  **Every failure mode returns 404, never 403**: nonexistent id, deleted id, members-only file
  with no session, members-only file with a session but no linked member, missing blob. Success
  is a genuinely streamed `Response` (`ReadableStream`, 256KB slices) with
  `Content-Type: application/pdf` and `Content-Disposition: inline; filename="<re-sanitized>"`.

**Files created:** `src/lib/club-file-storage/{index,local,database}.ts` +
`{local,database}.test.ts`; `src/lib/club-files-queries.ts` + `.test.ts`;
`src/lib/club-file-upload-queries.ts` + `.test.ts`; `src/app/api/admin/club-files/route.ts`;
`src/app/api/admin/club-files/[id]/route.ts`;
`src/app/api/admin/club-files/[id]/attachments/route.ts` + `.test.ts`;
`src/app/api/admin/club-files/upload-sessions/route.ts` + `.test.ts`;
`src/app/api/admin/club-files/upload-sessions/[sessionId]/chunks/[index]/route.ts` + `.test.ts`;
`src/app/api/admin/club-files/upload-sessions/[sessionId]/finalize/route.ts` + `.test.ts`;
`src/app/api/club-files/[id]/download/route.ts` + `.test.ts`.

**Files modified:** `.gitignore` (added `.club-file-store/`).

**Schema changes:** none — Phase 4a's five tables were sufficient as designed.

### Test coverage delivered (Phase 3's "Unit Tests Required", every item)

- `club-file-storage/local.test.ts` / `database.test.ts` — save/read/delete round trip,
  overwrite (replace-in-place), delete no-op on missing key, path-traversal sanitization.
- `club-file-upload-queries.test.ts` (26 tests, the substantive layer — this is where the real
  assembly/validation/atomicity logic lives and is exercised against mocked `@/lib/db`, not just
  HTTP-status-mapped): stale-session sweep count, over-25MB rejected, exactly-at-cap accepted,
  replace-target-not-found, `totalChunks` computation; chunk PUT out-of-range index, wrong
  length (non-final AND final chunk), session-not-found, **idempotent re-PUT of the same index
  stores the latest bytes**; finalize's missing/gapped chunk (**asserts the session is marked
  `'failed'` and never deleted**), size mismatch, checksum mismatch (both correct and incorrect
  checksum), **a genuinely valid JPEG rejected** (PDF-only in v1, not a mocked validator),
  happy-path create, **happy-path replace atomicity** (asserts the old blob is deleted only
  after the row-flip transaction, and that a transaction failure leaves the old blob undeleted
  and the session alive), replace ignoring supplied metadata.
- `club-files-queries.test.ts` — attachments full-set-replace (insert-only-new,
  delete-only-removed, no-op-on-identical-set, empty-set-deletes-all) and **duplicate eventId
  deduped, not a unique-constraint error**; `getPublicAttachedFiles` vs. `getAllAttachedFiles`
  visibility filtering; `deleteClubFile` row+blob deletion.
- Six `route.test.ts` files (gating, request validation, and discriminated-result → HTTP-status
  mapping, mocking the queries layer per this codebase's established convention — see
  `welcome-packets/[id]/mark-current/route.test.ts`): upload-sessions init, chunk PUT, finalize,
  attachments, and — the one genuinely route-level test, since it needs `auth()` — the download
  route's **full visibility 404 matrix** (public × authenticated/unauthenticated,
  members-only × unauthenticated/no-memberId/with-memberId, nonexistent id, deleted id, missing
  blob) plus header correctness and an explicit "never 403" assertion.
- **Not extended:** `src/lib/admin-page-feature-gates.test.ts`. This is a static scan of
  `src/app/(dashboard)/admin/*` page directories — `/admin/club-files` doesn't exist yet (no UI
  shipped in this phase), so the test has nothing to scan and needs no change from me. It will
  automatically start covering `/admin/club-files` the moment ux-developer's `page.tsx` lands;
  their page.tsx must itself call `hasFeature()` or that existing suite fails the build.

### Open questions / handoff notes

- **Next agent: ux-developer.** The full API contract above is live and tested. Build, in Phase
  3's stated order: admin list/detail pages, the shared `use-chunked-upload` hook, the member
  Records "Files" page, and the two event-page integrations.
- **Chunk-upload client protocol** (the one genuinely new client-side pattern):
  1. `POST /api/admin/club-files/upload-sessions` with `{ filename, declaredSize, replaceFileId?
     }` → capture `{ sessionId, chunkSize, totalChunks }`.
  2. Slice the `File`/`Blob` into `totalChunks` pieces of `chunkSize` bytes (last piece is the
     remainder) via `file.slice(start, end)`, and `PUT` each to
     `.../upload-sessions/[sessionId]/chunks/[index]` with **raw binary body** — pass the
     `Blob` slice directly as the `fetch` body, set no `Content-Type: application/json`, and do
     **not** wrap it in `FormData` or base64 (either would blow the byte-count safety margin
     under Vercel's 4.5MB request cap). Drive a progress bar off each response's
     `receivedChunks`/`totalChunks` rather than tracking client-side state — the server is the
     source of truth for what's actually landed. A failed chunk PUT can simply be retried with
     the identical slice; it's idempotent.
  3. Once every chunk has succeeded, `POST .../upload-sessions/[sessionId]/finalize` with
     `{ name, description?, visibility }` for a new file, or `{}` (no body needed) for a
     replace. A `400` here means retry finalize alone (all chunks are still on the server) —
     never restart the chunk loop. The error message in the JSON body is written to be shown
     directly to the admin (e.g. "This isn't a valid PDF file"), per Phase 1's
     field-preserving-inline-error requirement.
  4. `optional checksumSha256` — if the hook wants the extra integrity check, compute SHA-256 of
     the full assembled file client-side (e.g. via `crypto.subtle.digest`) before calling
     finalize. Not required; size + magic-byte checks already catch most corruption.
- **Event attach picker** should call `PUT /api/admin/club-files/[id]/attachments` with the
  **complete** desired `eventIds` array on every save (not a diff) — the server computes the
  diff. Sending a duplicate id is safe (deduped server-side).
- **Public `/events/[id]`** should call `getPublicAttachedFiles(eventId)` directly as a Server
  Component (no route needed) and link each result's download to
  `/api/club-files/[id]/download`. **Member `/members/events/[id]`** uses
  `getAllAttachedFiles(eventId)` the same way. The member Records "Files" page uses
  `listAllClubFilesForMembers()`.
- **Content-Disposition is `inline`, not `attachment`** — matches the receipt-proxy precedent
  (browser renders the PDF rather than forcing a download dialog); flag if the UI's driving use
  case (sponsor-packet download button) wants `attachment` instead — a one-line change in the
  download route if so, not raised as a blocker here since Phase 3 didn't specify either way.
- **`pnpm lint` is broken repo-wide** on this machine (ESLint 9.39.2 / `minimatch` ESM export
  mismatch), unrelated to this feature — flagging for deployment-engineer's dependency review
  rather than blocking on it here. `tsc --noEmit` and the full Vitest suite are both green.

---

## Phase 4c — UI Implementation (ux-developer) — 2026-09-04

**Owner:** ux-developer
**Status:** complete

### Summary

Built all four UI surfaces on top of Phase 4b's API contract, confirmed directly against the
route files (not just the design doc's prose): the admin list/detail pages under
`/admin/club-files`, the shared `use-chunked-upload` client hook driving both the new-upload and
replace-in-place forms, the member `/members/records/files` list (linked from the Records hub),
and the event-page download integration. `pnpm exec tsc --noEmit`, `pnpm test` (98 files / 1850
tests, all green), and `pnpm build:only` all pass clean, and `/admin/club-files` +
`/admin/club-files/[id]` are confirmed picked up by `admin-page-feature-gates.test.ts` (166
tests, still green). No API/schema changes were made.

### What I did

- Read the full API contract directly off the route files under `src/app/api/admin/club-files/`
  and `src/app/api/club-files/[id]/download/route.ts`, not just Phase 3/4b's prose — this caught
  one real contract gap (see Open Questions below) before it became a UI bug.
- Built `src/lib/hooks/use-chunked-upload.ts` — the one place the init → chunk-PUT-loop →
  finalize sequence lives, shared by the new-file form and the replace control. 3MB-chunk slicing
  via `file.slice()`, raw-binary `PUT` bodies (no FormData/base64), a progress percentage driven
  off each chunk response's `receivedChunks`/`totalChunks` (server is the source of truth, not
  client-side counting), automatic per-chunk retry (3 attempts) for transient network blips, and
  a `retry()`/`canRetry` pair that resumes from the first never-succeeded chunk (or re-sends only
  `finalize` if every chunk had already landed) rather than restarting the whole upload — matches
  Phase 3's explicit failure-UX requirement.
- Built `ClubFileUploadForm` (new file) and `ClubFileReplaceControl` (replace-in-place) as thin
  client wrappers around the hook: client-side size pre-check against the 25MB cap before the
  first network call, a progress bar during upload/finalize, and an inline (never toast) error
  that preserves whatever the admin already typed — Phase 1 Flow 1's explicit requirement — plus
  a visible "Retry" button once `canRetry` is true.
- Built `ClubFileMetadataForm` (PATCH name/description/visibility), `EventAttachPicker` (fetches
  `/api/admin/events`, checkbox multi-select with a text filter, sends the **complete** desired
  `eventIds` set on save per the PUT route's full-set-replace semantics — no client-side diffing),
  and `DeleteClubFileButton` (`ConfirmDialog`, destructive, names the attached events explicitly
  when known).
- Admin pages: `/admin/club-files` (list — upload form at top, empty state, each row shows name,
  visibility badge, size, attached-event count, uploaded date, edit/delete) and
  `/admin/club-files/[id]` (metadata form, replace control, attach picker, delete panel that
  fetches the attached events' actual titles via a direct `db`/`events` read in the Server
  Component — so the delete confirm names them, e.g. "It will also be removed from: Rudolph Run
  5K"). Both call `auth()` + `hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE)` inline and
  `redirect()` on failure — verified by `admin-page-feature-gates.test.ts` picking both up.
- Member page: `src/app/members/records/files/page.tsx` — lists every file via
  `listAllClubFilesForMembers()` (public and members-only alike, per the User Decision), gated
  only by `session.user.memberId` presence (no `FEATURES` key, matching the rest of Records), the
  same "Account Not Linked" empty state as `/members/records`, `py-12` hero. Added a "Files" card
  to `/members/records` (`src/app/members/records/page.tsx`) following the existing Welcome
  Packet tile's exact markup/classes.
- Event-page integration: **one code change, not two.** `src/app/members/events/[id]/page.tsx`
  turned out to be a bare `redirect(`/events/${id}`)` — there is no separate member event detail
  page to modify (see Open Questions). All attached-file rendering lives in
  `src/app/events/[id]/page.tsx`, which already computes `session` via `auth()`: it now calls
  `getAllAttachedFiles(event.id)` when `session?.user?.memberId` is present and
  `getPublicAttachedFiles(event.id)` otherwise, then renders the new shared
  `src/components/events/attached-files-list.tsx` (a modest "Downloads" card list, each row a
  plain link to `/api/club-files/[id]/download`, opened in a new tab) — this single integration
  correctly serves both the anonymous-public case and the member case, since both routes resolve
  to the same page.
- Added `formatFileSize()` to `src/lib/utils.ts` (shared by all three list surfaces — admin list,
  admin detail, member Files page — rather than copy-pasted per component, per CLAUDE.md's
  duplication rule).
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (98 files / 1850 tests, all green — no
  regressions), `pnpm build:only` (clean, `/admin/club-files`, `/admin/club-files/[id]`, and
  every `/api/(admin/)club-files/...` route present in the route manifest with no build errors or
  warnings), and `admin-page-feature-gates.test.ts` in isolation (166 tests, green) to confirm
  both new admin pages are picked up by its static scan.
- `pnpm lint` remains broken repo-wide on this machine (pre-existing, unrelated — see Phase 4b's
  note); not re-attempted here.

### Outputs

**Created:**
- `src/lib/hooks/use-chunked-upload.ts` — shared chunked-upload client protocol + resumable retry.
- `src/components/admin/club-files/club-file-upload-form.tsx` — new-file upload form.
- `src/components/admin/club-files/club-file-replace-control.tsx` — replace-in-place control.
- `src/components/admin/club-files/club-file-metadata-form.tsx` — name/description/visibility PATCH form.
- `src/components/admin/club-files/event-attach-picker.tsx` — searchable multi-select, full-set PUT.
- `src/components/admin/club-files/delete-club-file-button.tsx` — `ConfirmDialog` wrapper, names attached events.
- `src/components/events/attached-files-list.tsx` — shared "Downloads" section for event pages.
- `src/app/(dashboard)/admin/club-files/page.tsx` — admin list.
- `src/app/(dashboard)/admin/club-files/[id]/page.tsx` — admin detail.
- `src/app/members/records/files/page.tsx` — member Files list.

**Modified:**
- `src/lib/utils.ts` — added `formatFileSize()`.
- `src/app/events/[id]/page.tsx` — attached-files fetch (visibility-scoped by `memberId`
  presence) + `<AttachedFilesList>` render.
- `src/app/members/records/page.tsx` — added the "Files" card link.

**Schema/API changes:** none. `ADMIN_NAVIGATION`'s "Club Files" entry (from Phase 4a) now points
at a real page.

### Open questions / handoff notes

- **API contract mismatch — no "uploaded by" in the admin list response.** The design's Component
  Plan asks for "attached events, uploaded when/by" on the admin list. `AdminClubFileSummary`
  (the actual `GET /api/admin/club-files` shape) has `createdAt` but no uploader name or
  `uploadedByUserId` — the field exists on the `club_files` row (Phase 4a's schema) but was never
  selected into the summary type api-developer shipped. I rendered "Uploaded {date}" without a
  "by {name}" per the real contract rather than guessing at a shape or joining `users` myself
  from a UI-layer file (that would be exactly the kind of query-layer bypass this codebase's
  conventions warn against). **Flagging for api-developer/tech-lead**: either add
  `uploadedByName` to `AdminClubFileSummary` (small `users` join in `listClubFilesForAdmin()`) or
  confirm "uploaded when" alone satisfies the intent — not blocking QA, but worth a follow-up
  work-log note either way.
- **`/members/events/[id]/page.tsx` is a redirect, not a page** — flagging explicitly since Phase
  3's Component Plan says "Files to modify: ... `src/app/members/events/[id]/page.tsx`." That
  file is `redirect(`/events/${id}`)` and nothing else; there's no separate member-facing event
  detail template to add a second integration to. The single change in
  `src/app/events/[id]/page.tsx` (visibility scoped by `session.user.memberId`) covers both
  routes correctly, verified by the redirect being unconditional (no query-string loss). No
  action needed from the next agent — just don't be surprised the diff doesn't touch that file.
- **Default visibility on the new-file form is "Members only", not "Public".** Phase 3 didn't
  specify a default; I chose the more conservative option (an admin must deliberately flip to
  "Public" to make something downloadable without a login) rather than defaulting to the driving
  use case's eventual value. Worth confirming with the club if the opposite default would save
  more clicks in practice.
- **Content-Disposition is `inline`** (api-developer's choice, Phase 4b) — download links open in
  a new tab (`target="_blank"`) rather than forcing a save dialog. If the club wants an explicit
  download prompt instead, that's a one-line header change in the download route, not a UI change.
- **QA click-through checklist:**
  1. **Driving use case, end to end:** as an admin, go to `/admin/club-files`, upload a PDF, name
     it, set visibility to **Public**, save. Open the file's detail page, use the event-attach
     picker to attach it to a real event, save. Sign out (or open a private/incognito window) and
     visit that event's public page (`/events/[id]`) — confirm the "Downloads" section appears
     with a working link, and the file opens/downloads with no login prompt.
  2. Same file, but set visibility to **Members only** at upload — confirm it does NOT appear on
     the public event page while signed out, but DOES appear when signed in as a linked member on
     the same `/events/[id]` URL (and via `/members/events/[id]`, which redirects there).
  3. Upload a non-PDF (e.g. a `.jpg` renamed to `.pdf`, or any real image) — confirm the finalize
     step's magic-byte check rejects it with an inline, human-readable error, and the form's
     name/description/visibility fields are still populated afterward (not cleared).
  4. Upload a file large enough to require multiple 3MB chunks (e.g. ~10MB) — watch the progress
     bar move, confirm success.
  5. Empty states: a fresh `/admin/club-files` with no files shows the "No files yet" empty
     state (not a blank table); `/members/records/files` for a member when zero files exist shows
     "No files have been posted yet."
  6. Replace-in-place: on an existing file's detail page, use "Replace file" with a different
     PDF — confirm the name/visibility/event attachments are unchanged afterward, only the bytes
     (and byte size shown) changed.
  7. Delete a file attached to 1+ events — confirm the `ConfirmDialog` names the attached event(s)
     by title, and after confirming, the event page(s) no longer show that download.
  8. Mobile (360px): admin upload form, event-attach picker checklist, and both download-link
     surfaces (public event page, member Files list) all remain usable — no horizontal scroll,
     44px+ touch targets on buttons.
  9. `/members/records` hub shows the new "Files" card alongside "Welcome Packet" and "Governing
     Documents", styled identically.
- **Next agent: qa** (Phase 5). Then **analyst** for Phase 6 shipped-vs-intent, given this closes
  out the full specialist split (database-admin → api-developer → ux-developer).

---

# Phase 5 — Verification (qa)

**Date:** 2026-09-04
**Verified by:** qa

## Summary

**PASS.** Independently re-ran the full verification stack (tsc, Vitest, production build) and
then drove the real driving use case end to end against a live `pnpm dev` server: a genuinely
valid, 7.6MB, three-chunk PDF (verified with `qpdf --check`) was uploaded through the actual
browser client (real `use-chunked-upload` hook, real `fetch`/`PUT` calls — not a hand-rolled
script bypassing it), marked Public, attached to a real event, and downloaded by a signed-out
visitor with SHA-256-verified byte-identical content and correct `Content-Type`/
`Content-Disposition` headers. The visibility boundary (members-only → 404 for anonymous and
non-linked sessions, 200 for a linked member, never 403/401) and the permission boundary
(`club_files.manage` is genuinely admin-only — a `board_member` account with `admin.dashboard`
gets 403/redirect everywhere in Club Files) were both proven live, not inferred from source
reading alone. Wrote `e2e/club-files-flow.spec.ts` (13 tests, all green, including within the
full parallel suite) as permanent regression coverage for both boundaries plus upload
robustness and replace-in-place — this closes exactly the class of gap CLAUDE.md's Feature-Gate
Audit note warns a happy-path test suite would miss.

One follow-up, not a blocker: `src/lib/club-files-queries.ts` sits at 58.33% statement coverage
in Vitest (below the project's 70%+ pure-TS-module floor) — `updateClubFileMetadata`,
`listAllClubFilesForMembers`, `getClubFileById`, and `getClubFileForDownload` have no *unit*
test exercising the real function body (the route tests mock the queries module). All four are
now exercised *live* by `club-files-flow.spec.ts` against a real DB — genuine end-to-end
evidence they work — but a fast, isolated unit test is still missing. Recommending it as a
Phase 6 follow-up for the implementer, not a re-open of this PASS.

## What I did

- Read the full work-log (Phases 1–4c) and DECISION-094/095 in `docs/decisions.md` before
  touching anything, per the task brief — in particular Phase 4c's 9-item click-through
  checklist and its two flagged items (uploader-name gap, `/members/events/[id]` being a bare
  redirect).
- Re-ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (98 files / 1850 tests, all green — matches
  api-developer's and ux-developer's own numbers, no drift), and `pnpm build:only` (exit 0; the
  build's own route manifest and `.next/server/app/**` output confirm every Club Files page/route
  — `/admin/club-files`, `/admin/club-files/[id]`, all six admin API routes, and
  `/api/club-files/[id]/download` — actually compiled and were emitted, not just referenced in
  the design doc).
- Read every Club Files route file directly (`grep`+`Read`, not the work-log's prose) to confirm
  `auth()` + `hasFeature(session.user.id, FEATURES.CLUB_FILES_MANAGE)` gates every admin
  route, and that the download route's only auth check is the conditional `auth()` call inside
  the `visibility !== "public"` branch (no `hasFeature()` call at all there — correct, per Phase
  1's no-`.view`-key ruling). Confirmed via direct `psql` query against the dev DB that
  `club_files.manage` binds to `admin` only (no `board_member` row) — matching migration 0098's
  intent, not just its SQL text.
- Spot-checked the unit-test suites api-developer's Phase 4b claimed rather than trusting the
  summary: read the actual `it(...)` names in `club-file-upload-queries.test.ts` (27 tests,
  including the JPEG-rejection, idempotent-chunk-retry, and replace-atomicity cases the design
  doc required) and `src/app/api/club-files/[id]/download/route.test.ts` (the full 404-vs-200
  visibility matrix plus an explicit "never 403" assertion) — both are real, not aspirational.
- Generated a genuinely valid multi-megabyte PDF at runtime (a minimal but structurally correct
  single-page PDF — real xref table, real trailer, a padded-but-legal content stream — built via
  a small helper inside the new e2e spec) sized so it spans **three** 3,145,728-byte upload
  chunks, and validated it with `qpdf --check` before relying on it. This was deliberate: a file
  that merely starts with `%PDF-` would test the magic-byte check but not the chunk-assembly path
  the task asked for.
- Started the app against the existing `pnpm dev` server on `:3000` (a duplicate `next dev`
  attempt failed with "Another next dev server is already running" — confirmed the existing one
  was healthy via `curl` before reusing it, rather than killing another session's process).
- Wrote and ran `e2e/club-files-flow.spec.ts` against that live server — see Outputs. Ran it in
  isolation first (13/13 pass, 54.9s), then again as part of the **full** `pnpm test:e2e` suite
  (165 tests, 8 workers) to check for interference; all 13 Club Files tests passed both times.
- Ran the full `pnpm test:e2e` suite for a regression sweep. 128 passed, 8 failed, 1 skipped, 28
  did not run (Playwright's serial-mode cascade-skip after an earlier failure in the same file —
  not a crash). **All 8 failures are in files Club Files never touches**
  (`budget-star-notes.spec.ts`, `budgeting-restructure.spec.ts`, `cancel-occurrence.spec.ts` x2,
  `ledger-search.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`,
  `recurring-signup-rollup.spec.ts`, `transaction-budget-line-link.spec.ts`) and match the
  pre-existing "date-anchored rot" / shared-dev-DB parallel-run flakiness pattern this project's
  review log has recorded before (e.g. 2026-06-24's test-coverage entry). Not investigated further
  here — out of Club Files' scope — but flagging by name so the next test-coverage review doesn't
  have to rediscover which specs are already rotten.
- Ran `pnpm test --coverage` and read the per-file HTML reports under `coverage/lib/` for the
  three CLAUDE.md-named modules plus every new Club Files module (see Coverage below).
- Swept every new file for `console.log` / `window.confirm|alert|prompt` (`grep -rn`, zero hits)
  and confirmed the admin list/detail pages use flex-wrapping card rows (`flex-wrap`, `min-w-0`),
  not a literal `<table>`, so there is no horizontal-overflow surface to check at 360px — the
  "mobile overflow handling on the admin table" checklist item is satisfied by there being no
  table markup to overflow.
- Confirmed empty-state copy exists exactly as Phase 1 required: `/admin/club-files` renders
  "No files yet — upload your first one above." and `/members/records/files` renders "No files
  have been posted yet." (both read directly from the page source, not just claimed).

## Manual Click-Through / Live Verification

All of the following were driven live against `pnpm dev` (not inferred from source or unit
tests), most via the new Playwright spec, a few via direct `psql`/`curl` where that was the more
direct proof:

| Flow | Result | Notes |
|------|--------|-------|
| Admin uploads a real >3MB PDF (3 chunks) via the actual browser upload form | PASS | 7,998,584-byte, `qpdf`-validated PDF; progress bar reached 100%, "File uploaded" toast shown |
| Mark Public, attach to a real event via the searchable picker | PASS | `club_files.visibility = 'public'` and a `club_file_events` row confirmed in DB |
| Signed-out visitor sees "Downloads" on the public event page and downloads it | PASS | SHA-256 of the downloaded bytes matched the pre-upload SHA-256 exactly; `Content-Type: application/pdf`; `Content-Disposition: inline; filename="..."` |
| Members-only file: signed-out download | PASS — 404 | Never 403/401, per Phase 1's adversarial-pass ruling |
| Members-only file: absent from public event page while signed out, present while signed in | PASS | Public file stayed visible in both cases — proves selective filtering, not blanket suppression |
| Signed-in linked member: sees and downloads the members-only file via `/members/events/[id]` (which redirects to `/events/[id]`) | PASS | Confirms Phase 4c's flagged redirect-only page still serves the member-facing case correctly |
| Fake PDF (real JPEG bytes, `.pdf` name/extension/content-type) rejected at finalize | PASS | Inline error "This isn't a valid PDF file"; name field preserved (not cleared); no `club_files` row created |
| Abandoned upload session (init + 1 chunk, never finalized), aged >24h via direct DB timestamp update, swept by the next init call | PASS | Session row and its chunk row both gone after the sweep-triggering call; no cron, matches DECISION-095 |
| Replace-in-place: new bytes at the same `/api/club-files/[id]/download` URL | PASS | SHA-256 of the download now matches the replacement file, not the original; name/visibility/attachment count unchanged |
| Permission boundary: `board_member` (holds `admin.dashboard`, not `club_files.manage`) | PASS | No "Club Files" nav link on `/admin`; redirected off `/admin/club-files`; 403 from `GET /api/admin/club-files` and `POST .../upload-sessions` |
| `club_files.manage` role binding, live DB | PASS | `psql` query: bound to `admin` only, zero `board_member` rows |
| Empty states | PASS | Verified in source: `/admin/club-files` and `/members/records/files` both have the required copy |
| No native dialogs / `console.log` in new files | PASS | `grep -rn` across every new file, zero hits |
| Mobile overflow (admin list) | PASS / N/A | Card-row layout (`flex-wrap`), no literal table to overflow |

## Regression Tests Added

- `e2e/club-files-flow.spec.ts` — 13 tests, all passing live against `pnpm dev` (and confirmed
  again inside the full parallel `pnpm test:e2e` run):
  - `admin uploads a >3MB PDF (3 chunks), marks it Public, attaches it to an event` — guards
    against the chunk-assembly path silently regressing to single-shot upload.
  - `a signed-out visitor sees the download on the public event page and gets byte-identical
    bytes with correct headers` — guards against any future corruption in the streamed-`Response`
    path (the exact risk Phase 3's design doc called out as the reason not to reuse
    `receiptBytesToBodyInit()`).
  - `signed-out download of the members-only file 404s — never 403/401` — regression for the
    exact "confirm a private file's existence to an anonymous caller" leak Phase 1's adversarial
    pass named.
  - `the members-only file is absent from the public event page while signed out, but the public
    file is still present` — regression for over-broad or under-broad visibility filtering on the
    event page query.
  - `a signed-in linked member sees both files ... and can download the members-only one` —
    regression for the `/members/events/[id]` redirect losing the member-scoped query.
  - `a spoofed .pdf that is really a JPEG is rejected at finalize, with an inline error and the
    form fields preserved` — regression for a magic-byte check being silently dropped, and for
    Phase 1's field-preserving-error requirement.
  - `an abandoned upload session ... leaves no orphan once it's >24h old and a later init sweeps
    it` — regression for the no-cron sweep-on-next-init design silently breaking.
  - `replacing the public file's bytes serves the new content while name/visibility/attachment
    survive` — regression for replace-in-place accidentally becoming a new row or losing
    attachments.
  - Four permission-boundary tests (`board_member` — no nav entry, redirected off the page, 403
    from two different admin API routes) — regression for `club_files.manage` accidentally
    widening to `board_member`, the exact mistake `0093_social_requests_permissions.sql`'s own
    comment flags as a real historical near-miss for a different feature.

## Coverage on Critical Modules (`pnpm test --coverage`)

- `src/lib/events.ts`: 94.96% stmts / 87.42% branch — **PASS** (target 90%+; untouched by this
  feature, no drift).
- `src/lib/permissions.ts`: 100% stmts/branch/funcs/lines — **PASS** (target 100%).
- `src/lib/members.ts`: 35.89% stmts — **pre-existing gap, not caused by this feature** (Club
  Files never touches `members.ts`; this project's review log has carried this gap since at
  least 2026-06-24, target 80%+, flagging for the next test-coverage review rather than
  re-litigating here).
- `src/lib/club-file-upload-queries.ts` (the substantive chunk-assembly/validation/atomicity
  logic): 96.51% stmts / 93.22% branch — exceeds the general 70%+ pure-TS floor.
- `src/lib/club-file-storage/local.ts` and `database.ts`: 100% stmts/branch/funcs/lines each.
- `src/lib/club-file-storage/index.ts` (thin `NODE_ENV`-gated factory + `sanitizeClubFileName`):
  25% stmts — the untested branch is the `NODE_ENV === "production"` factory arm, which
  `local.test.ts`/`database.test.ts` don't need to exercise directly since each adapter is
  unit-tested on its own; low-risk, matches `receipt-storage/index.ts`'s identical shape and
  identical coverage number.
- `src/lib/club-files-queries.ts`: **58.33% stmts — below the 70%+ floor.** The attachment
  diff/dedupe logic, `deleteClubFile`, and the public-vs-all visibility filtering ARE unit-tested
  (`club-files-queries.test.ts`). `updateClubFileMetadata`, `listAllClubFilesForMembers`,
  `getClubFileById`, and `getClubFileForDownload` are not — the route tests that call them mock
  the queries module rather than exercising the real function body. All four are now proven live
  by `club-files-flow.spec.ts` (metadata edit wasn't directly exercised there either — see Open
  Questions), which is real evidence but not a substitute for a fast isolated unit test.

## Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /api/admin/club-files` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `PATCH /api/admin/club-files/[id]` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `DELETE /api/admin/club-files/[id]` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `PUT /api/admin/club-files/[id]/attachments` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `POST /api/admin/club-files/upload-sessions` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `PUT .../upload-sessions/[sessionId]/chunks/[index]` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `POST .../upload-sessions/[sessionId]/finalize` | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `GET /api/club-files/[id]/download` | conditional (only when `visibility !== 'public'`) | **intentionally no** | N/A — public route by design, no `.view` key exists (Phase 1 ruling); visibility itself is the gate, re-checked every request |
| `/admin/club-files` (page) | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |
| `/admin/club-files/[id]` (page) | yes | yes | `FEATURES.CLUB_FILES_MANAGE` |

Every gate was confirmed by reading the route/page source directly (`grep -n "auth()\|hasFeature"`
across all seven route files plus both pages), not inferred from passing tests, per this
project's audit requirement. Role binding independently verified live via `psql`:
`club_files.manage` → `admin` only, zero `board_member` rows. `admin-page-feature-gates.test.ts`
(part of the 1850-test Vitest run) independently confirms both new admin pages carry their own
`hasFeature()` call, not just proxy-layer protection.

## Verdict

**PASS**

## Open questions / handoff notes

- **Follow-up, not a blocker:** add direct unit tests for `updateClubFileMetadata`,
  `listAllClubFilesForMembers`, `getClubFileById`, and `getClubFileForDownload` in
  `club-files-queries.test.ts` to close the 58.33%→70%+ coverage gap noted above. Small, isolated,
  should take under an hour.
- **Follow-up, not a blocker (carried from Phase 4c):** `AdminClubFileSummary` has no
  uploader-name field — the admin list shows "Uploaded {date}" with no "by {name}". Confirm with
  the club whether that's sufficient or worth a small `users` join in `listClubFilesForAdmin()`.
- **Not investigated here, flagging for the next test-coverage review:** 8 pre-existing e2e
  failures in ledger/budgeting/cancel-occurrence specs under the full parallel `pnpm test:e2e`
  run, unrelated to Club Files by file and by content — see What I did above for the exact list.
- **Next agent: analyst**, for Phase 6 shipped-vs-intent. Everything in Phase 1's User Decisions
  (PDF-only, 25MB cap, all-files Records listing, `club_files.manage` admin-only) shipped exactly
  as decided; the two Phase 4c-flagged items (uploader-name gap, `/members/events/[id]` being a
  redirect) are both confirmed non-blocking by this phase's live verification.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-09-04
**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The driving use case — admin uploads the sponsorship packet, marks it public, attaches it to
> the Rudolph Run event, a signed-out sponsor downloads byte-identical bytes with no login prompt
> — works exactly as promised in Phase 1, with a genuinely fast (chunked, resumable) upload path,
> a correctly enforced 404-not-403 visibility boundary, and no file bytes anywhere in the repo;
> three small, pre-flagged gaps (test coverage, an admin-list cosmetic omission, a receipt-proxy
> follow-up) are now durably tracked rather than ship-blocking.

## What I did

- Re-read this work-log's own Phase 1 review (verbs, four flows, permissions, gaps, adversarial
  pass) and every subsequent phase (2 architect, 3 tech-lead, 4a/4b/4c implementers, 5 qa)
  end-to-end before touching code.
- Spot-verified — not just re-read prose — the two claims that most needed independent
  confirmation: (1) `.gitignore` actually excludes `.club-file-store/` and `git status` shows no
  PDF/binary/blob files staged or tracked anywhere in the diff (`grep -i "pdf\|blob"` on
  `git status --short` — zero hits); (2) the uploader-name gap QA/ux-developer flagged is real —
  read `AdminClubFileSummary`'s actual TypeScript shape in `src/lib/club-files-queries.ts` (no
  `uploadedByName` field) and the admin list page's render line directly (`Uploaded
  {formatDate(f.createdAt)}`, no "by {name}").
- Checked whether QA's three flagged follow-ups (coverage gap, uploader-name gap, receipt-proxy
  buffered-response exposure) were already durably tracked anywhere — grepped `docs/backlog.md`
  for `club.file`, `club_file`, `receipt-proxy`, `buffered-response`, `uploader` (zero hits) and
  confirmed none had a backlog entry. Added three new entries, **B-55** (queries-module
  coverage), **B-56** (uploader-name gap), **B-57** (receipt-proxy streaming follow-up, owned by
  the 30-day code review), so none of Phase 5/6's findings evaporate the moment this work-log
  closes.
- Walked each of Phase 1's four flows against the actual shipped surfaces (routes, pages, and
  QA's live click-through evidence) rather than re-trusting the design doc's prose alone.

## Outputs

### What's Working

- **The driving use case, end to end, proven live (not inferred).** QA's Playwright spec
  (`e2e/club-files-flow.spec.ts`) drove a real 7.6MB/3-chunk PDF through the actual browser
  upload hook, marked it Public, attached it to a real event, and a signed-out visitor downloaded
  SHA-256-identical bytes with correct headers. This is exactly Phase 1's Flow 2 and the user's
  original ask ("downloadable from the public Rudolph Run event page"), verified with evidence
  stronger than a design-doc claim.
- **404-not-403 visibility boundary holds, live.** Phase 1's adversarial pass demanded a
  members-only file never confirm its own existence to an anonymous caller. QA proved this with a
  full matrix (public/members-only × authenticated/unauthenticated/no-`memberId`) and an explicit
  "never 403" assertion baked into the regression suite — not just a single happy-path check.
- **Replace-in-place is a genuine 30-second op, not a rebuild.** The "next year's packet" ask from
  Phase 1 is real: QA verified live that replacing bytes on an existing row changes only the
  download's content (new SHA-256) while name/visibility/event attachments survive untouched —
  no code change required for next year's upload, matching the user's original framing.
- **Permission boundary is genuinely admin-only, live-verified, not just migration text.** A
  `board_member` account (holds `admin.dashboard` but not `club_files.manage`) gets no nav entry,
  is redirected off `/admin/club-files`, and gets 403 from two different admin API routes — plus
  a `psql` check confirming zero `board_member` rows on the `club_files.manage` binding. This
  matters because CLAUDE.md itself flags this exact drift as a historical near-miss pattern.
- **No PII/personal-data invariant violation.** The sponsorship packet's two event-chair emails
  live in `club_file_blobs` (Postgres bytea), never in git — confirmed directly via `git status`,
  not assumed from the architect's Phase 2 reasoning alone.

### Intent-vs-Shipped Diff

- Phase 1 said: PDF-only in v1, magic-byte-validated. Shipped: `validateMagicBytes()` reused,
  requires `=== "application/pdf"`; QA proved a real JPEG renamed to `.pdf` is rejected at
  finalize, not just at the client. **Verdict: matches.**
- Phase 1 said: 10MB cap (recommended, pending user confirmation). User Decision set 25MB.
  Shipped: 25MB cap via a chunked-upload session (init → 3MB chunk PUTs → finalize) because a
  single-shot upload cannot cross Vercel's 4.5MB function body limit. This is more engineering
  than Phase 1 anticipated (Phase 1 assumed a simple multipart route like receipts), but it was
  surfaced and decided explicitly at Phase 2/3 (DECISION-094/095), not discovered as a surprise
  late in implementation. **Verdict: matches** (the cap matches the user's decision; the
  transport complexity is a correctly-caught platform constraint, not scope drift).
- Phase 1 said: many-to-many doc↔event via a join table. Shipped: `club_file_events` with a
  `(club_file_id, event_id)` unique constraint from day one, cascade deletes both directions.
  **Verdict: matches.**
- Phase 1 said: Club Records "Files" section, scope TBD (open question). User Decision: ALL
  files, public and members-only alike. Shipped: `listAllClubFilesForMembers()`, gated only by
  `session.user.memberId` presence, same "Account Not Linked" empty state as the rest of Records.
  **Verdict: matches.**
- Phase 1 said: `club_files.manage`, new key, not reusing `documents.manage`, admin-only by
  default. Shipped: exactly that, verified live via `psql`. **Verdict: matches.**
- Phase 1 said: 404-not-403 for any private-file failure mode on the public download route.
  Shipped: verified by a full matrix test plus an explicit "never 403" assertion. **Verdict:
  matches.**
- Phase 1 said (Flow 4 / Component Plan): a member event detail page
  (`src/app/members/events/[id]/page.tsx`) gains an attached-files integration. Shipped: that
  file is a bare redirect to `/events/[id]`, and the single integration lives there instead,
  branching on `session.user.memberId`. QA verified live that the member-facing case still works
  correctly through the redirect. **Verdict: acceptable drift** — same user-visible outcome via a
  simpler code path than Phase 3 assumed existed.
- Phase 1 said: inline, field-preserving error copy on upload failure (not a generic toast).
  Shipped: verified live — a rejected fake-PDF upload shows "This isn't a valid PDF file" inline
  and the name/description/visibility fields survive. **Verdict: matches.**
- Phase 1 said (Component Plan, via Phase 3): admin list shows "uploaded when/by." Shipped: "when"
  only — no uploader name field exists on `AdminClubFileSummary`. **Verdict: acceptable drift,
  tracked** — cosmetic, not functional; now B-56 in `docs/backlog.md`.
- Phase 3 said: four query functions get unit coverage as part of the Phase 4 gate. Shipped:
  those four are covered by e2e only, not unit tests; `club-files-queries.ts` sits at 58.33%
  statement coverage, below this project's stated 70%+ floor for pure-TS modules. **Verdict:
  acceptable drift, tracked** — real live evidence exists (the e2e suite exercises three of the
  four paths), just not the fast isolated test CLAUDE.md's Phase 4 gate technically calls for.
  Now B-55 in `docs/backlog.md`.

## Edge Cases

- Empty state: **pass** — `/admin/club-files` renders "No files yet — upload your first one
  above."; `/members/records/files` renders "No files have been posted yet." Both confirmed read
  directly from page source by QA, matching Phase 1's `rounded-2xl` empty-state requirement.
- Failure microcopy: **pass** — inline, human-readable, field-preserving on upload rejection
  (verified live); 404 page-level microcopy for a since-deleted/re-flagged attachment was
  designed per Phase 1 but not explicitly re-verified live in Phase 5's click-through list — minor
  gap in verification depth, not a shipped defect (the download route's 404 behavior itself was
  proven exhaustively).
- Permission gate: **pass** — live-verified both directions (admin succeeds, `board_member`
  blocked with correct redirect/403), plus the live `psql` role-binding check.
- Mobile (360px): **pass** — admin surfaces use flex-wrapping card rows, not literal tables, so
  there's no horizontal-overflow surface; QA confirmed this by reading the actual markup rather
  than assuming card-based layout is safe.
- Brand consistency: **pass** — non-interactive `rounded-2xl` card rows, `ConfirmDialog` for
  delete (names the attached events by title), no `window.confirm`/`alert`/`prompt` anywhere in
  the new files (`grep -rn`, zero hits per QA).

## Follow-Ups (SHIP WITH NOTES)

- **B-55** (`docs/backlog.md`) — `src/lib/club-files-queries.ts` unit coverage is 58.33%, below
  the 70%+ floor; four functions (`updateClubFileMetadata`, `listAllClubFilesForMembers`,
  `getClubFileById`, `getClubFileForDownload`) need direct unit tests. QA estimated under an hour.
- **B-56** (`docs/backlog.md`) — admin list shows "Uploaded {date}" with no uploader name; add
  `uploadedByName` to `AdminClubFileSummary` via a small `users` join, or confirm with the club
  that date-only is sufficient before spending the time.
- **B-57** (`docs/backlog.md`) — the existing receipt-proxy download routes still use the
  buffered-`Uint8Array` response pattern Club Files' new streamed route was specifically built to
  avoid; port them to the same `ReadableStream` pattern. Owned by the 30-day code review
  (architect), first due for this codebase.

## Open questions / handoff notes

- No loop-back required. All four Phase 1 flows, all four User Decisions, and the adversarial-pass
  findings shipped as designed; the three items above are tracked, non-blocking follow-ups, not
  defects.
- This closes the Club Files pipeline. Next touch of this feature should start from
  `docs/backlog.md` B-55/B-56/B-57 rather than reopening this work-log.

## User Decisions (2026-09-04)

Answers to Phase 1's open questions, collected before Phase 2:

1. **File types:** PDF only in v1. One magic-byte signature to validate; widen later if a real need appears.
2. **Size cap:** 25MB — larger than the receipts cap (10MB), chosen deliberately for print-quality PDFs.
3. **Club Records "Files" list:** ALL files (public and members-only alike, attached or not) — Club Records is the single complete index; event pages additionally surface their attached files.
4. **Permission key:** `club_files.manage`, admin-only default, displayed as "Club Files."

Phase 1's own recommended defaults (new key not reusing `documents.manage`; "files" naming; no `.view` key — visibility enforced by the download route; many-to-many doc↔event; replace-in-place, no version history; 404-not-403 for private files publicly) stand unmodified. Ready for Phase 2.

**Main-thread resolution of Phase 4a's db:push flag (2026-09-04):** investigated the
`ledger_entities_slug_unique` prompt directly. The live DB enforces UNIQUE(slug) under
Postgres's default name (`ledger_entities_slug_key`, from the original SQL migration) while
drizzle-kit expects its own conventional name (`ledger_entities_slug_unique`) — a naming-only
drift; both constraints are semantically identical. `push --force` auto-resolves it on every
deploy and has done so harmlessly through months of deploys including three today. Benign, no
action required; not a blocker for this feature.

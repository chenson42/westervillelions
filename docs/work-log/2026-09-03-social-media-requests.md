# Social Media Post Requests — Work Log

> **Slug:** `2026-09-03-social-media-requests`
> **Surface:** (dashboard) member portal (submit) + (dashboard) admin (review dashboard)
> **Permission(s):** New `FEATURES.SOCIAL_REQUESTS_REVIEW` (admin dashboard). Submission itself: no new gate — any linked member, matching the Proposals precedent.
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-03 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-09-03 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-09-03 |
| 4 — Implementation (schema) | database-admin | Complete | — | 2026-09-03 |
| 4 — Implementation (API) | api-developer | Complete | — | 2026-09-03 |
| 4 — Implementation (UI) | ux-developer | Complete | — | 2026-09-03 |
| 5 — Verification | qa | Complete | PASS | 2026-09-03 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-03 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A member-portal form lets any linked member ask the board to post something to the club's social media accounts; requests land in a new admin dashboard and trigger an email to `board@westervillelions.org` — but the request as stated doesn't say what fields the form collects, whether the board records a decision in-app or just replies by email, or whether a member can see what happened to their own request.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member (any linked member — no role gate, matching Proposals) | Submits a social media post request via a form | Occasional, per request |
| Signed-in member | Views their own submitted requests and status | On demand |
| Signed-in member (open question) | Edits or withdraws a request before it's acted on | Occasional |
| Admin (new `SOCIAL_REQUESTS_REVIEW` holder) | Views dashboard listing all requests | Per session |
| Admin (open question) | Marks a request Posted / Declined, or the workflow ends at "notified via email" | Per request |

The original request says "a form... in the member portal" and "an admin dashboard" without naming which of the four surfaces in CLAUDE.md's model each half belongs to. Resolved here as signed-in-member (submit) + admin (review), following the Proposals precedent — confirm with user.

## Flows

**Flow 1 — Submit a request:** Entry: `/members/social-requests/new` (linked from a `/members/social-requests` list page, mirroring `/members/proposals` → `/members/proposals/new`) → member fills the form (fields TBD — see Gaps) → submits → success: request recorded, confirmation shown, email enqueued to `board@westervillelions.org` via `sendEmail()`.
- Failure: not specified. Needs inline validation errors for required fields, and — critically — the record-then-notify order must not couple to email delivery. Recommend the same pattern as the Ledger acknowledgment-letter send: the DB write is the source of truth; if `sendEmail()`'s underlying send fails, the request is still recorded and visible on the dashboard, and the email queue's own state (`/admin/email-queue`) is the record of what happened to the notification — the requester should not see a form error just because outbound mail failed.

**Flow 2 — Member views own requests:** Entry: `/members/social-requests` → list of the member's own submissions with status → outcome: empty state on first visit ("You haven't submitted a request yet" + button), populated list otherwise.
- Failure: not specified in the request. If DB read fails, needs human microcopy, not a stack trace.

**Flow 3 — Admin reviews dashboard:** Entry: `/admin/social-requests` (or a tab under an existing admin area — open question) → gated by `hasFeature(FEATURES.SOCIAL_REQUESTS_REVIEW)`, redirect to `/access-pending` otherwise → list of requests, detail view per request.
- Failure: no permission → `/access-pending`. Not signed in → `/signin`.

**Flow 4 — Decision / disposition (undetermined):** The request only specifies an email notification, not an in-app decision step. Two shapes are consistent with "next up, form + dashboard + email":
  (a) **Log-and-notify only** — the dashboard is a read-only audit trail; the board decides and coordinates over email/in person; no status workflow needed.
  (b) **Proposals-shaped** — the dashboard supports marking a request Posted / Declined / Needs Changes, with an append-only decision history like `proposalDecisions`, and the member-facing list reflects that status.
  This is the single biggest open question in the request — it changes the schema, the admin UI, and whether Flow 1's "edit/withdraw" verb exists at all.

## Permissions

- **Permission(s):** New `FEATURES.SOCIAL_REQUESTS_REVIEW` gates the admin dashboard (list + detail), following `FEATURES.PROPOSALS_REVIEW`'s exact shape. Submission requires only a linked member record (`session.user.memberId`), no new gate — matches how Proposals submission has no `PROPOSALS_SUBMIT` key.
- **Default roles:** Admin, at minimum. The request doesn't say who else should see it (Proposals binds review to a board-shaped role). Open question: should this default to Admin-only, or should it also bind to whichever role handles the club's social media/marketing (if such a role exists in the roles table)?

## Gaps the Request Didn't Address

- **Request fields are unspecified.** The request says "a form" with no field list. At minimum a post-request needs: target platform(s) (Facebook / Instagram / etc., likely multi-select), the post copy/caption (text), an optional image or link, and a desired post date. Without these, tech-lead has nothing to model. Suggested resolution: confirm this field list with the user before Phase 3.
- **Dashboard placement.** "Should show up in an admin dashboard" could mean a new admin nav entry (`/admin/social-requests`) or folding into the existing Announcements area, which is the closest existing admin surface conceptually. New nav entries have real cost (CLAUDE.md's derived-protection-rules pattern, its own page-level gate, its own row in `ADMIN_NAVIGATION`). Recommend a new, small admin area rather than overloading Announcements, but confirm.
- **Is the board email the whole workflow, or a notification of an in-app workflow?** See Flow 4 above. This is not a nice-to-have clarification — it determines whether there's a status column, a decision table, and a member-facing status view at all.
- **Does the member see the outcome of their request?** Not stated. If the board's reply happens entirely over email (outside the app), the member-facing list can only ever show "Submitted" — which may be a fine, deliberately minimal v1, but should be a stated choice, not a silent gap.
- **Edit/withdraw before action.** Not mentioned. Proposals allows editing while in `draft`/before lock. Does a social request need the same, given posts are often time-sensitive?
- **Image/attachment handling.** Not mentioned. The codebase has upload infrastructure already in use for profile pictures and Ledger receipts (`src/lib/receipt-magic-bytes.ts`, HEIC decode helper), so this is reusable infra, not new — but the request doesn't say whether an image is required, optional, a file upload, or just a pasted link/URL. Needs a decision before Phase 3.
- **Email failure handling.** Per CLAUDE.md's deny-by-default outbound email rules, a blocked or failed send must never silently fail the request submission, and must never look like "Delivered" to anyone — this needs explicit mention in the design doc, not just inherited by convention.
- **Empty states.** Neither the member list nor the admin dashboard's empty state is described. Both need one (see `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention).
- **Urgency / desired post date vs. SLA.** If a post is time-sensitive (e.g., "post this by Friday"), does the board get any escalation if unacted-on, similar to Dues Reminders' last-reminded badge? Reasonable to declare out of scope for v1, but should be explicit.
- **Actual posting mechanism.** Nothing in the request or codebase suggests real Facebook/Instagram API integration — confirm this is purely an internal request-routing tool, and an admin/board member posts manually outside the app after seeing the request. If real API posting were intended, that's a much larger feature.

## Out of Scope (confirm with user)

- Automated posting to social platforms via their APIs (Facebook Graph API, Instagram, etc.) — this feature routes a request to a human, it does not post on the club's behalf.
- SLA/escalation reminders for un-acted-on requests (Dues Reminders-style).
- Google Group sync — this feature has no membership/committee dimension, so it should not touch `google-groups.ts`.

## Open Questions

1. What fields does the submission form actually need (platform, copy, image/link, desired date, notes)?
2. Does the board record a decision in-app (Posted/Declined, append-only history like Proposals), or is the dashboard a read-only log and the email is the entire workflow?
3. Does the admin dashboard get its own new nav entry, or fold under an existing admin area (e.g., Announcements)?
4. Who besides Admin should default-hold `SOCIAL_REQUESTS_REVIEW`? Is there a marketing/PR-chair role already in the roles table this should bind to?
5. Can a member edit or withdraw a request before it's acted on?
6. Does the member-facing list need to reflect an outcome, or is "Submitted" the only state a member ever sees?

## User Decisions (2026-09-03)

Answers to the Open Questions above, collected before Phase 2:

1. **Form fields:** Core set — platform(s) to post to, post copy/caption, optional image upload or link, desired post date, and free-text notes/context.
2. **Workflow shape:** In-app decision, Proposals-shaped — the board marks each request Posted / Declined / Deferred in the dashboard with an append-only decision history (mirroring `proposalDecisions`); the member sees the outcome, not just "Submitted."
3. **Dashboard placement:** New nav entry (`/admin/social-requests` or similar), not folded into Announcements.
4. **Review permission default roles:** Bind `FEATURES.SOCIAL_REQUESTS_REVIEW` to **`admin` and `board_member`** — the same two-role pattern already used for `FEATURES.PROPOSALS_REVIEW` (see `drizzle/migrations/0085_proposals_permissions.sql`). No new role needed; `board_member` already exists for exactly this purpose.
5. Not explicitly asked as a standalone question — deferred to tech-lead (Phase 3) to decide based on the Proposals precedent (which allows editing while a decision is pending/before lock). Flag as an implementation detail, not a blocking gap.
6. Resolved by decision #2 — the member sees the real outcome (Posted/Declined/Deferred), not just "Submitted."

These resolve Open Questions 1–4 and 6 fully; ready to advance to Phase 2 (architect).

---

# Phase 2 — Architectural Review (architect)

## VERDICT

**Approved with suggestions**

## Summary

The Proposals feature (`src/app/members/proposals/`, `src/app/(dashboard)/admin/proposals/`, `proposals` + `proposalDecisions` tables, `FEATURES.PROPOSALS_REVIEW`) is a correct and complete template for Social Media Post Requests — same submit/edit/list member surface, same append-only decision-history admin surface, same permission shape. No new npm dependency is needed. Two things need explicit deviation from the template: the image upload (Proposals has no file upload at all) and the multi-select platform field (Proposals has no analogous multi-value field). Both are solvable with existing infrastructure; neither requires new tooling.

## What I did

- Read `src/lib/db/schema.ts` lines 1875–2014 (`proposals` + `proposalDecisions` tables and their doc comments) to confirm the two-table, append-only-decisions shape and the value+unknown tri-state convention.
- Read `drizzle/migrations/0084_proposals.sql` and `0085_proposals_permissions.sql` to confirm the idempotent migration pattern and the exact `admin` + `board_member` role-binding shape to replicate for `FEATURES.SOCIAL_REQUESTS_REVIEW`.
- Read all five Proposals route files (`members/proposals/page.tsx`, `members/proposals/new/page.tsx`, `members/proposals/[id]/page.tsx`, `(dashboard)/admin/proposals/page.tsx`, `(dashboard)/admin/proposals/[id]/page.tsx`) to confirm the server-component-by-default pattern, the `auth()` + `hasFeature()` gate placed directly in each admin page body, the locked-vs-editable proposer view split, and the snapshot-columns-for-deleted-member pattern.
- Read `src/lib/permissions.ts` around `ADMIN_NAVIGATION` (lines 462–484, the "Inbox" group containing the existing "Proposals" entry) and `src/lib/admin-page-feature-gates.test.ts` to confirm the derived-protection mechanics from DECISION-082 and the CI check that fails a page missing its own gate.
- Investigated existing upload/image infrastructure: `src/lib/receipt-storage/index.ts` (pluggable `ReceiptStorage` adapter — DB-backed in production, filesystem in dev, opaque key + server-proxied read, built for Ledger receipts), `src/lib/receipt-magic-bytes.ts` (magic-byte MIME validation for JPEG/PNG/PDF), `src/lib/image-resize.ts` (client-side downscale math), and the simpler precedent at `src/app/api/members/profile-picture/route.ts` (member-uploaded image stored as a capped ~300KB `data:image/...` URI directly in a `text` column, no separate storage adapter). Confirmed `@vercel/blob` is listed as available in CLAUDE.md but has zero actual usages in `src/` — it is not a live pattern to imitate.
- Confirmed no new npm dependency is required for any part of this feature.

## Directory Placement

Approved as proposed:
- `src/app/members/social-requests/page.tsx` (list, mirrors `members/proposals/page.tsx`)
- `src/app/members/social-requests/new/page.tsx` (submit, mirrors `members/proposals/new/page.tsx`)
- `src/app/members/social-requests/[id]/page.tsx` (detail — editable pre-decision, locked+timeline post-decision, mirrors `members/proposals/[id]/page.tsx`)
- `src/app/(dashboard)/admin/social-requests/page.tsx` (review list, mirrors `(dashboard)/admin/proposals/page.tsx`)
- `src/app/(dashboard)/admin/social-requests/[id]/page.tsx` (review detail + decide, mirrors `(dashboard)/admin/proposals/[id]/page.tsx`)

Component homes follow the existing surface split: submission form and status-timeline/badge components under `src/components/members/` (mirrors `src/components/members/proposal-form.tsx`, `proposal-status-timeline.tsx`); the admin review table and decision panel under `src/components/admin/social-requests/` (mirrors `src/components/admin/proposals/proposal-review-table.tsx`, `proposal-decision-panel.tsx`). Query/domain helpers as `src/lib/social-requests.ts` (status-vocabulary + validation logic, mirrors `src/lib/proposals.ts`) and `src/lib/social-requests-queries.ts` (mirrors `src/lib/proposals-queries.ts`). No new top-level directory — this slots entirely into the existing surface-based module layout.

## Schema Shape

Two tables, following `proposals`/`proposalDecisions` exactly:
- `social_requests` — mutable while unlocked (pre-decision), with the same nullable-FK + name/email/phone snapshot pattern as `proposals.proposerMemberId`/`proposerNameSnapshot` etc. (a hard-deleted member's already-decided request is still a governance record). `status` follows the same `'draft' | 'submitted' | ...` vocabulary — tech-lead should decide the exact terminal states (Posted/Declined/Deferred per the user decision, so likely `draft | submitted | under_review | posted | declined | deferred`, dropping `approved` since "Posted" is the terminal-success state here, not "Approved").
- `social_request_decisions` — append-only, identical shape to `proposalDecisions` (`decidedByUserId`, `decidedAt`, `citingMinutesId` optional, `note` optional). The Proposals precedent for why a single mutable decision column is wrong (a repeated Deferred would silently overwrite the prior deferral's timestamp) applies identically here.

Two fields have no Proposals analog and need tech-lead's explicit design:
- **Platform(s)** — multi-select (Facebook/Instagram/etc.). Recommend a `text[]` column (Postgres native array, already used elsewhere per `ledgerDonors.emails`) over a join table — this is a small, closed, rarely-changing vocabulary, not a relationship needing referential integrity.
- **Desired post date** — `date`, not `timestamp`, same reasoning as `proposals.proposedDate` (DECISION referenced inline in schema.ts: a day a member picked, not a wall-clock instant). No value+unknown pair needed here unless tech-lead decides "no preference" is a real answer distinct from "field left blank" — flag as a design-doc decision, not an architectural one.

## Image Upload — Reuse, Don't Rebuild

No new dependency needed either way. Two existing patterns are available, and the choice affects data-layer shape, so it belongs to tech-lead/database-admin, not this review:

1. **Data-URI-in-column** (`src/app/api/members/profile-picture/route.ts` precedent) — simplest, no new storage adapter, caps at ~300KB. Fits if a social-media reference image is a small, low-resolution thumbnail attached to a request.
2. **Pluggable adapter** (`src/lib/receipt-storage/`) — DB-backed in production / filesystem in dev, opaque key, server-proxied reads, handles larger files with magic-byte validation (`src/lib/receipt-magic-bytes.ts`, JPEG/PNG signatures) and client-side downscaling (`src/lib/image-resize.ts`). Fits if requesters attach a real photo they want posted as-is.

Recommendation: reuse the *magic-byte validator* (`validateMagicBytes()`) regardless of which storage shape is chosen — never trust a client-supplied Content-Type. Do **not** literally write into the `ledger_receipt_files` table or the `receipts/<uuid>/<name>` key namespace — that storage is semantically and operationally scoped to the Ledger's compliance/audit trail (DECISION-020/040 built it for that purpose). If the pluggable-adapter shape is chosen, it should be a sibling adapter/table (e.g. `social_request_images`), not a literal reuse of `ReceiptStorage`. Given the form also accepts a plain link as an alternative to upload, and the field is explicitly optional, the data-URI-in-column approach is likely sufficient for v1 and keeps this feature schema-self-contained — but this is tech-lead's call, not an architectural blocker either way.

## Permissions

`FEATURES.SOCIAL_REQUESTS_REVIEW` = `"social_requests.review"`, added to `src/lib/permissions.ts`'s `FEATURES` catalog and `FEATURE_DESCRIPTIONS`, following `PROPOSALS_REVIEW`'s exact shape (one key covers both viewing and deciding — no Ledger-style view/record/approve split, since there's no separation-of-duties reasoning here). Migration mirrors `0085_proposals_permissions.sql` byte-for-byte in structure: idempotent `INSERT ... WHERE NOT EXISTS` for the feature row, then two idempotent `role_features` bindings (`admin`, `board_member`), each independently guarded — do not assume the binding rides along on any existing grant. The `add-permission` skill should be used to generate this migration mechanically rather than hand-copying 0085.

Submission itself stays ungated beyond a linked member record (`session.user.memberId`), matching Proposals' "no `PROPOSALS_SUBMIT` key" precedent.

## Admin Navigation (DECISION-082 mechanics)

A new entry is required in `ADMIN_NAVIGATION` (`src/lib/permissions.ts`) — recommend adding it to the existing "Inbox" group (lines 462–484), immediately after the "Proposals" entry, since a social media request is conceptually the same shape of thing (a member-initiated ask routed to the board):

```ts
{
  name: "Social Requests",
  href: "/admin/social-requests",
  icon: "📣",
  requiredFeature: FEATURES.SOCIAL_REQUESTS_REVIEW,
},
```

Because `src/proxy.ts`'s admin-area admission is derived from `ADMIN_NAVIGATION` (DECISION-082, `getAdminProtectionRules()`), this single addition is sufficient for the proxy to admit `SOCIAL_REQUESTS_REVIEW` holders to `/admin/social-requests*` — no hand-written proxy rule needed or wanted. This is exactly the mechanism CLAUDE.md warns must not be reintroduced by hand.

This does **not** replace the page-level gate. Both `(dashboard)/admin/social-requests/page.tsx` and `.../[id]/page.tsx` must independently call `auth()` + `hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW)` and `redirect()` on failure, exactly matching `(dashboard)/admin/proposals/page.tsx`'s doc comment: *"Independent page-level gate (not just the derived proxy rule) — `src/lib/admin-page-feature-gates.test.ts` fails the build without this."* That same test suite will automatically require the gate on the new pages once the directory exists under `src/app/(dashboard)/admin/social-requests/` — no separate test-suite change is needed, but the implementer should be aware the build fails without the explicit `hasFeature()` call.

## Server / Client Split

Follows Proposals exactly: all five pages are Server Components (`async function`, `auth()` called directly, no `'use client'`). The submission form (`SocialRequestForm`, mirroring `ProposalForm`) is a Client Component for controlled inputs, draft-save, and image-upload interactivity. The status badge/timeline components are Server Components where Proposals' equivalents are (no interactivity needed to render a badge or a read-only timeline) — confirm this against `proposal-status-timeline.tsx`'s actual export shape in Phase 3, but nothing in the request suggests a deviation.

## Email

Board notification on submission must go through `sendEmail()` (`src/lib/email.ts`), addressed to `board@westervillelions.org` (a club-domain address, allowed under "No Personal Data in the Repository"). Per CLAUDE.md's deny-by-default rule, this is inherited automatically outside production — no extra code needed to prevent a QA run from mailing the board, but the design doc should still state this explicitly rather than leaving it implicit, per the Phase 1 analyst's note. This is a single notification, not a bulk send — `sendBulkMemberEmail()` does not apply here.

## Dependencies

No new npm dependency required. `text[]` (platform multi-select) is native Postgres/Drizzle. Image handling reuses existing patterns (see above). Confirmed against the Dependency Evaluation Criteria — nothing here needs anything not already in `package.json`.

## No Automation on Decision

Per the Proposals precedent (approving a proposal does not auto-create an event/campaign/budget line), marking a request "Posted" must trigger no automation — no auto-post to any social platform, no calendar entry. This matches the Phase 1 analyst's confirmed out-of-scope item (no Facebook/Instagram Graph API integration) and should be stated explicitly in the Phase 3 design doc so it isn't accidentally scope-crept during implementation.

## Suggestions (non-blocking)

1. Confirm with tech-lead whether "Posted" needs a free-text field for *where/when* it was actually posted (a URL or timestamp), since unlike Proposals' "Approved," "Posted" describes a completed real-world action a board member performed outside the app — the decision `note` field may already suffice, but worth a deliberate call rather than a silent gap.
2. Reuse the `add-permission` skill for the migration rather than hand-authoring — reduces risk of the role-binding drifting from the 0085 pattern (e.g., forgetting the `board_member` bind, which the 0085 migration's own comment flags as a real historical mistake ["board_member does NOT already hold documents.manage/minutes.manage"]).
3. Icon choice (📣 suggested above) is cosmetic — tech-lead/ux-developer may pick differently; not architecturally significant.

## Outputs

- Files read (no files modified — review only): `src/lib/db/schema.ts`, `drizzle/migrations/0084_proposals.sql`, `drizzle/migrations/0085_proposals_permissions.sql`, `src/app/members/proposals/page.tsx`, `src/app/members/proposals/new/page.tsx`, `src/app/members/proposals/[id]/page.tsx`, `src/app/(dashboard)/admin/proposals/page.tsx`, `src/app/(dashboard)/admin/proposals/[id]/page.tsx`, `src/lib/permissions.ts`, `src/lib/admin-page-feature-gates.test.ts`, `src/lib/receipt-storage/index.ts`, `src/lib/receipt-magic-bytes.ts`, `src/lib/image-resize.ts`, `src/app/api/members/profile-picture/route.ts`.
- No new architectural decision logged to `docs/decisions.md` — this feature follows an already-established pattern (Proposals) with no new structural primitive, dependency, or route-group rule introduced. Nothing here rises to the bar of a numbered `DECISION-NNN` entry.
- Work-log updated: this section, and the Per-Phase Status table (row 2 marked Complete / Approved with suggestions).

## Open questions / handoff notes

- tech-lead must pick the image-upload shape (data-URI-in-column vs. new pluggable adapter) and the exact `social_requests.status` vocabulary (does "posted" replace "approved," or coexist with it) before database-admin can write schema.
- tech-lead must resolve edit/withdraw semantics before decision (deferred by the user to Phase 3, per the Proposals precedent — editable while `draft`/`submitted`/`under_review`, locked at a terminal state).
- tech-lead should decide whether `desired post date` needs a value+unknown pair (does "no preference" need to be distinguishable from "left blank")?
- database-admin: use the `add-permission` skill to generate the `SOCIAL_REQUESTS_REVIEW` migration rather than hand-copying 0085.
- ux-developer: the admin nav icon and exact "Inbox" vs. new group placement is a suggestion, not a requirement — sanity-check against the live sidebar before finalizing.

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Social Media Post Requests

### Summary

A member-portal form lets any linked member ask the board to post something to the club's
social media accounts; the board reviews and decides on requests in a new admin dashboard, and
the member sees the real outcome. This is the Proposals feature's shape (`src/app/members/proposals/`,
`src/app/(dashboard)/admin/proposals/`, `proposals` + `proposalDecisions`) reused almost exactly:
two tables (mutable pre-decision row + append-only decision history), the same visibility rule
(requester or reviewer only, never club-wide), the same edit-lock semantics, and the same
"decision triggers no automation" rule. Three things deliberately diverge from the Proposals
template, each justified below rather than copied by default: the terminal-status vocabulary
(`posted`, not `approved`), the absence of a minutes-citation trio on decisions (a social post
request is an operational routing decision, not a formal club commitment the board votes into
minutes), and a new multi-value `platforms` field with no Proposals analog.

### Permissions

- **New key:** `FEATURES.SOCIAL_REQUESTS_REVIEW` = `"social_requests.review"`. One key covers
  both viewing submitted requests and recording the board's decision — mirrors
  `FEATURES.PROPOSALS_REVIEW`'s exact precedent (one role authors and decides; no Ledger-style
  view/record/approve split, since there's no separation-of-duties reasoning for a marketing
  request the way there is for money).
- **Default roles:** `admin` and `board_member`, bound independently (do not assume either rides
  along on an existing grant — the 0085 migration's own comment records that `board_member` does
  **not** already hold `documents.manage`/`minutes.manage`, so the same independent-bind
  discipline applies here).
- **Migration:** Use the `add-permission` skill to generate `drizzle/migrations/0092_social_requests_permissions.sql`,
  structured identically to `drizzle/migrations/0085_proposals_permissions.sql`:
  1. Idempotent `INSERT INTO features ... WHERE NOT EXISTS` for `social_requests.review`.
  2. Idempotent `role_features` bind to `admin`.
  3. Idempotent `role_features` bind to `board_member`, each guarded independently.
- **`src/lib/permissions.ts` additions:**
  - `FEATURES.SOCIAL_REQUESTS_REVIEW: "social_requests.review"` in the `FEATURES` catalog
    (immediately after `PROPOSALS_REVIEW`, same doc-comment style explaining the one-key
    rationale and the explicit admin+board_member bind).
  - `[FEATURES.SOCIAL_REQUESTS_REVIEW]: "View and decide social media post requests"` in
    `FEATURE_DESCRIPTIONS` — this string must be byte-for-byte identical to the migration's
    `description` column, per the Proposals precedent.
  - A new `ADMIN_NAVIGATION` entry in the "Inbox" group, immediately after "Proposals":
    ```ts
    {
      name: "Social Requests",
      href: "/admin/social-requests",
      icon: "📣",
      requiredFeature: FEATURES.SOCIAL_REQUESTS_REVIEW,
    },
    ```
    Because `src/proxy.ts` derives admin-area admission from `ADMIN_NAVIGATION`
    (`getAdminProtectionRules()`, DECISION-082), this single addition is sufficient for the proxy
    — no hand-written proxy rule. Both `(dashboard)/admin/social-requests/page.tsx` and
    `.../[id]/page.tsx` must still independently call `auth()` + `hasFeature()` in their own body;
    `src/lib/admin-page-feature-gates.test.ts` scans the directory tree and fails the build if
    either page ships without it — no test-suite change is needed for this to apply.
- **Submission itself:** No new gate. Requires only `session.user.memberId` — matches Proposals'
  "no `PROPOSALS_SUBMIT` key" precedent exactly.

### API Contract

All five routes mirror the Proposals route set's shape, error codes, and enumeration-resistance
rules (404, not 403, on a non-owner requesting another member's request — never confirm
existence to a non-owner or non-reviewer).

1. **`POST /api/members/social-requests`** — create a new draft.
   - Gate: `session.user.memberId` required (403 if absent), 401 if unauthenticated.
   - Body: `{}` or any subset of the request's writable fields (first autosave tick may be
     partial). `status`, `requesterMemberId`, `requesterUserId` are never client-writable —
     stripped/rejected by `parseSocialRequestBody()`, then force-set server-side, mirroring
     `createDraftProposal()`'s two-layer defense.
   - Response `201`: `{ socialRequest }`. `400` on validation error. `401`/`403` per above.

2. **`PATCH /api/members/social-requests/[id]`** — autosave / manual edit / explicit save.
   - Gate: ownership (`requesterUserId === session.user.id`), 404-not-403 on mismatch.
   - Allowed only while `isSocialRequestEditableByRequester(status)` (`draft` or `submitted`);
     `409` once locked (`under_review` or a terminal status), including the race where a board
     member locks it between this route's read and write (same atomic `UPDATE ... WHERE status
     IN ('draft','submitted')` guard as `updateProposal()`).
   - Body: partial field merge — see Data Model for the full field list and the one deliberate
     deviation from Proposals' "always send full state" rule (`imageDataUri`, see Edge Cases).
   - Response `200`: `{ socialRequest }`.

3. **`DELETE /api/members/social-requests/[id]`** — discard a draft.
   - Gate: ownership, 404-not-403 rule. `409` if `status !== 'draft'`. Hard delete (cascades to
     `social_request_decisions`, always empty for a draft — no decision row exists pre-submit).
   - Response `204`.

4. **`POST /api/members/social-requests/[id]/submit`** — `draft` → `submitted`.
   - Gate: ownership, 404-not-403 rule. `409` if not currently `draft` (idempotency guard against
     a double-click re-emailing the board). `422` with a field-keyed error map on validation
     failure (never a bare 400/500) so the client can re-render the in-progress form intact.
   - On success, in one transaction: snapshot `requesterName/Email/PhoneSnapshot` from the live
     `members` row, flip `status='submitted'`, stamp `submittedAt`, insert the first
     `social_request_decisions` row (`status='submitted'`, `decidedByUserId` = the requester's
     own user id — a self-transition, same as `submitProposal()`).
   - After commit (never inside the transaction, never blocking it): `sendEmail()` to
     `BOARD_EMAIL` (required per Phase 1/2), and — as a deliberate small extension of the literal
     spec, matching the Proposals precedent's "we'll email you when there's an update" pattern —
     a best-effort confirmation email to the requester's own snapshot address. A send failure
     (blocked or real) never blocks or fails the submission; the row is already committed. See
     Edge Cases for why coupling DB-write success to email-delivery success is explicitly
     forbidden here.
   - Response `200`: `{ socialRequest }`. `404`/`409`/`422` per above.

5. **`POST /api/admin/social-requests/[id]/decide`** — board decision.
   - Gate: `FEATURES.SOCIAL_REQUESTS_REVIEW`. `403` (not 404) on missing permission — this is
     authenticated-but-unauthorized, not existence-hiding, matching the Proposals decide route's
     reasoning (a request's existence isn't secret from other reviewers the way it is from the
     general membership).
   - `404` if the request doesn't exist OR is still `status='draft'` (defense in depth; a draft
     is never board-visible).
   - Body: `{ status: 'under_review'|'posted'|'declined'|'deferred', note?: string }`. No
     `citingMinutesId`/`meetingDate`/`chairName` — see Data Model for why this feature drops the
     minutes-citation trio Proposals carries.
   - `409` if `status === request.status` (same-status guard — no duplicate decision row, no
     duplicate requester email). Any other transition is allowed, including revisiting a prior
     status (`deferred` → `under_review` → `deferred` again) — status is not one-way.
   - After commit: best-effort email to the requester (snapshot address, falling back to a live
     member lookup the same way `resolveProposerContactEmail()` does) with the new status and the
     decision `note` if present. `note` is also where a board member records *where/when* a
     request was actually posted (a URL, a date) when marking it `posted` — no separate column,
     per the architect's suggestion #1; this keeps the schema minimal since it's free text either
     way.
   - Response `200`: `{ socialRequest, decision }`.

No backfill-decision endpoint (Proposals' `PATCH /api/admin/proposals/[id]/decisions/[decisionId]`
has no analog here) — there is nothing to backfill once `citingMinutesId`/`meetingDate` are
dropped from the decision row (see Data Model).

### Data Model

Two new tables, sequenced after `proposals`/`proposal_decisions` (no ordering dependency on
either — no FK between the two features) in a new migration
`drizzle/migrations/0092_social_requests.sql` (permissions migration is `0093` — see
Implementation Order for exact numbering once database-admin confirms nothing else lands first).

**`social_requests`** — mutable while `status` is `draft`/`submitted`; append-only once locked.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK, `default gen_random_uuid()` | |
| `requester_member_id` | `uuid`, `REFERENCES members(id) ON DELETE SET NULL` | Nullable FK + snapshot, same shape as `proposals.proposerMemberId` — a hard-deleted member's already-decided request survives as a governance record. |
| `requester_user_id` | `uuid`, `REFERENCES users(id) ON DELETE SET NULL` | |
| `requester_name_snapshot` | `text` | Null while draft; written once, at submit, never recomputed. |
| `requester_email_snapshot` | `text` | |
| `requester_phone_snapshot` | `text` | |
| `status` | `text NOT NULL DEFAULT 'draft'` | `'draft' \| 'submitted' \| 'under_review' \| 'posted' \| 'declined' \| 'deferred'`. Validated in `src/lib/social-requests.ts`, no DB CHECK (DECISION-041 pattern). **Deviation from Proposals:** `posted` replaces `approved` as the terminal-success state — "posted" is what actually happened (a board member did it), not an approval of a future action; there is no `approved` state here because approving and posting are the same event for this workflow. |
| `platforms` | `text[] NOT NULL DEFAULT '{}'` | Native Postgres array (no join table — a small, closed, rarely-changing vocabulary; matches `ledgerDonors.emails`'s `text[]` precedent). Vocabulary: `'facebook' \| 'instagram' \| 'twitter_x' \| 'linkedin' \| 'other'`, validated in `src/lib/social-requests.ts`. Draft rows may be empty; `submit` requires at least one. |
| `post_copy` | `text` | The caption/post text. Required at submit; blank allowed in draft. |
| `image_data_uri` | `text` | Nullable. **Chosen shape: data-URI-in-column**, mirroring `src/app/api/members/profile-picture/route.ts` — not the `ReceiptStorage` adapter. Justification: the field is explicitly optional, a plain link is an equally valid alternative, and the architect's own read was that this is "likely sufficient for v1" — building a second storage adapter for an optional nice-to-have would be the wrong complexity trade for what this feature needs today. Capped at the same ~300KB (409,600 char) limit as the profile-picture route. **Unlike** the profile-picture route, the upload route here calls `validateMagicBytes()` (`src/lib/receipt-magic-bytes.ts`) against the decoded bytes and rejects anything that isn't `image/jpeg` or `image/png` — the profile-picture route's bare `data:image/` prefix check is not copied forward; per the architect's explicit note, a client-supplied Content-Type/prefix is never trusted on its own. |
| `link_url` | `text` | Nullable. Alternative/supplement to an uploaded image — e.g., a link to a flyer, event page, or existing photo elsewhere. Not mutually exclusive with `image_data_uri`; both may be set. Validated as `http(s)://` at write time. |
| `desired_post_date` | `date` | Nullable, **no value+unknown pair** — deliberate deviation from `proposals.proposedDate`. `proposedDate` needs the pair because "not sure yet" gates other conditional UI/logic (Proposals Phase 3). `desiredPostDate` gates nothing downstream — a blank value is inherently and unambiguously "no preference," so a second boolean column would model a distinction with no behavioral consequence. This is the minimum complexity that solves today's problem; if a future need ever makes "no preference" and "haven't decided" meaningfully different here, add the pair then. |
| `notes` | `text` | Free-text context. Optional. |
| `submitted_at` | `timestamptz` | Null while draft. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Indexes: `ix_social_requests_requester_member`, `ix_social_requests_requester_user`,
`ix_social_requests_status`.

**`social_request_decisions`** — append-only, one row per status transition. Same reasoning as
`proposalDecisions`: a repeated `deferred` must never overwrite the prior deferral's timestamp.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `social_request_id` | `uuid NOT NULL REFERENCES social_requests(id) ON DELETE CASCADE` | |
| `status` | `text NOT NULL` | The status this row transitions the request TO. Same vocabulary as `social_requests.status` minus `draft`. |
| `decided_by_user_id` | `uuid REFERENCES users(id) ON DELETE SET NULL` | |
| `decided_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `note` | `text` | Optional free text — also carries "posted where/when" detail on a `posted` transition (see API Contract #5). |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Deviation from Proposals:** no `meeting_date` / `citing_minutes_id` columns. Proposals carries
these because a proposal is a formal club commitment the board votes on and records in minutes —
the citation is the governance paper trail. A social media post request is an operational
routing decision (closer to a Suggestion or a Contact-form triage than a budget vote); nothing
in the Phase 1/2 record asks for minutes traceability, and adding it here would be schema
ceremony with no consumer. If that changes later, the columns and the backfill route can be
added the same way Proposals' were.

Indexes: `ix_social_request_decisions_request`, `ix_social_request_decisions_status`.

**`src/lib/db/schema.ts`** gains both tables (Drizzle definitions mirroring `proposals`/
`proposalDecisions`'s structure exactly, `text("platforms").array()` for the platform column),
plus `SocialRequest`/`NewSocialRequest`/`SocialRequestDecision`/`NewSocialRequestDecision`
exported types.

### Component/Page Plan

**Pages (all Server Components, `auth()` called directly, no `'use client'`):**
- `src/app/members/social-requests/page.tsx` — list, mirrors `members/proposals/page.tsx`
  exactly: "Account Not Linked" empty state, drafts/in-review/decided grouping (decided =
  `posted`/`declined`/`deferred`), "You haven't submitted a request yet" empty state.
- `src/app/members/social-requests/new/page.tsx` — mirrors `members/proposals/new/page.tsx`.
- `src/app/members/social-requests/[id]/page.tsx` — editable pre-lock / locked+timeline
  post-lock split, mirrors `members/proposals/[id]/page.tsx`.
- `src/app/(dashboard)/admin/social-requests/page.tsx` — review list, mirrors
  `(dashboard)/admin/proposals/page.tsx`; independent `auth()` + `hasFeature()` gate in the page
  body (required — see Permissions); never lists drafts.
- `src/app/(dashboard)/admin/social-requests/[id]/page.tsx` — review detail + decide, mirrors
  `(dashboard)/admin/proposals/[id]/page.tsx`; independent gate; 404s on a still-draft request.

**Components:**
- `src/components/members/social-request-form.tsx` (Client Component) — mirrors
  `proposal-form.tsx`'s hand-rolled `useState` + debounced (~2s) autosave + explicit
  save/discard/submit actions, no `react-hook-form` (consistency with the architect's prior
  ruling against it for this exact shape of form). Checkboxes (not radio buttons) for the
  `platforms` multi-select, 44px+ tap targets, every required field marked "Required," every
  optional field marked "(optional)." **Deviation from the "always send full state" rule:** every
  other field is resent in full on every autosave tick (per the Proposals precedent, since it's
  cheap text), but `imageDataUri` is included in a save's body only when the image was actually
  added/changed/removed in that tick — resending an unchanged ~300KB base64 string on every 2s
  autosave tick, and re-running server-side magic-byte validation against it every time, has no
  upside and a real bandwidth/CPU cost this feature doesn't need to pay. The client tracks an
  `imageDirty` flag; `parseSocialRequestBody()` treats `imageDataUri: undefined` (key absent) as
  "leave unchanged," same as every other optional field already does for `PATCH`.
  - Client-side downscale before upload: reuses the **pure math** `computeResizeDimensions()`
    from `src/lib/image-resize.ts` (parameterized by `maxDimension`, not receipt-specific) with
    new constants (e.g., a `1200px`/`0.82` pair defined locally in the new component, not
    imported from `RECEIPT_IMAGE_MAX_DIMENSION` — those constants and the canvas-drawing glue in
    `receipt-file-input.tsx` are scoped to receipts; only the parameterized geometry function is
    generic enough to share). This is a UX nicety only — the server-side ~300KB cap and magic-byte
    check remain the actual trust boundary, exactly as `image-resize.ts`'s own doc comment says
    for receipts.
- `src/components/members/social-request-status.tsx` — `SocialRequestStatusBadge` +
  `SocialRequestStatusTimeline`, Server Components (no interactivity needed), mirrors
  `proposal-status-timeline.tsx`'s two exports and visual shape. Shared by both the member detail
  page and the admin detail page. No `citingMinutes` field on the timeline row (see Data Model).
- `src/components/admin/social-requests/social-request-review-table.tsx` — mirrors
  `proposal-review-table.tsx`.
- `src/components/admin/social-requests/social-request-decision-panel.tsx` (Client Component) —
  mirrors `proposal-decision-panel.tsx`; a `<select>` (not radio buttons — small, tech-comfortable
  board audience, same reasoning as Proposals), status change not wrapped in `<ConfirmDialog>`
  (additive history, not destructive). No `minutesOptions` prop and no citing-minutes `<select>`
  (see Data Model deviation) — this panel is simpler than its Proposals counterpart: status
  `<select>` + `note` textarea + submit button only.

**Library modules:**
- `src/lib/social-requests.ts` — pure, no DB import (unit-testable without `DATABASE_URL`,
  importable from a `"use client"` file): status/platform vocabularies and validators,
  `isSocialRequestEditableByRequester()`, `socialRequestVisibleTo()`, `isNoOpDecision()`,
  `validateSocialRequestSubmission()`, `parseSocialRequestBody()`, `socialRequestStatusLabel()`,
  `socialRequestSubjectLine()` (truncates `postCopy` to ~60 chars for email subject lines and
  admin-list row titles, since there's no `projectName`-equivalent field), image
  size/magic-byte/URL validation helpers.
- `src/lib/social-requests-queries.ts` — DB-facing: `createDraftSocialRequest`,
  `getOwnedSocialRequest`, `updateSocialRequest`, `discardDraftSocialRequest`,
  `submitSocialRequest`, `listMySocialRequests`, `listSubmittedSocialRequestsForReview`,
  `getSocialRequestById`, `resolveRequesterContactEmail`, `listDecisionsForSocialRequest`,
  `decideSocialRequest` — one-for-one mirrors of the `proposals-queries.ts` functions of the
  same shape, including the same transaction boundaries, the same atomic `WHERE status IN
  (...)` edit-lock guard, and the same 404-not-403 ownership-resolution contract.
- **`src/lib/html-escape.ts`** *(new, shared)* — `escapeHtml(s: string): string`. The HTML
  escaper this feature's email builders need already exists, separately, in `src/lib/proposals.ts`
  (`escapeProposalHtml`), `src/lib/dues-reminders.ts`, and `src/lib/ledger-acknowledgment-letter.ts`
  — three copies, which is exactly the pattern CLAUDE.md's "Duplication Is a Review Finding"
  section calls out by name (the escaper specifically, "6 times... in three different shapes," of
  which these are 3 of the historical 6). Adding this feature's email builders as a **fourth**
  copy, while already aware of the documented finding, would be the wrong call. Instead: pull a
  single `escapeHtml()` into a new pure module (no imports, mirrors `club-contacts.ts`'s
  "importable from anywhere, no DB coupling" precedent) and have `social-requests.ts`'s email
  builders be its first consumer. **Scope discipline:** do not touch the three existing copies —
  rewiring `proposals.ts`/`dues-reminders.ts`/`ledger-acknowledgment-letter.ts` to import the new
  shared helper is unrelated to this feature and belongs to the architect's 30-day code review
  (which already owns exactly this class of finding), not to this PR.

### Implementation Order

1. **Schema** (database-admin) — add `socialRequests`/`socialRequestDecisions` to
   `src/lib/db/schema.ts`; write idempotent `drizzle/migrations/0092_social_requests.sql`
   (tables + indexes, `CREATE TABLE IF NOT EXISTS`, guarded `DO $$ ... CREATE INDEX $$` blocks —
   same pattern as `0084_proposals.sql`).
2. **Permissions** (database-admin, via the `add-permission` skill) —
   `drizzle/migrations/0093_social_requests_permissions.sql`; `FEATURES.SOCIAL_REQUESTS_REVIEW` +
   `FEATURE_DESCRIPTIONS` + `ADMIN_NAVIGATION` entry in `src/lib/permissions.ts`.
3. **Pure library layer** (api-developer) — `src/lib/html-escape.ts`, `src/lib/social-requests.ts`,
   with the unit tests below written and passing before moving on.
4. **API routes** (api-developer) — the five routes under `src/app/api/members/social-requests/`
   and `src/app/api/admin/social-requests/[id]/decide/`, plus `src/lib/social-requests-queries.ts`.
   `auth()` + `hasFeature()` on the admin route; ownership + 404-not-403 on every member route.
5. **UI** (ux-developer) — the five pages, the four components, brand consistency
   (`rounded-2xl` cards, `rounded-lg` buttons, `ConfirmDialog` — note the decision panel
   deliberately does **not** use `ConfirmDialog`, additive history isn't a destructive action).
6. **Email** — wired into steps 4 (submit route: board notification + requester confirmation)
   and the decide route (requester decision notification), via `sendEmail()`. No separate
   implementation step; this is part of the API routes' own scope.
7. **Release notes** — write via the `/release-notes` skill when this feature reaches Phase 6
   SHIP IT, per tech-lead's standing ownership of that step.

### Edge Cases & Risks

- **Email delivery must never gate the DB write.** Per CLAUDE.md's deny-by-default outbound-email
  invariant, `sendEmail()` to a non-production process without an allowlisted address is silently
  blocked (still queued, still returns success). The submit and decide routes must call
  `sendEmail()` strictly **after** their transaction commits, in a `try/catch` that only
  `console.error`s on failure — exactly the Proposals routes' pattern. A member must never see a
  form error, or fail to have their request recorded, because outbound mail was blocked or Resend
  itself failed.
- **`board@westervillelions.org` is an allowed club-domain address** under "No Personal Data in
  the Repository" — it is not, itself, an environment-variable-gated destination, and it is
  distinct from `CLUB_GROUP_EMAIL` (`club@`, the ~44-person synced Google Group) that caused the
  2026-08-09 QA incident. Still: because this is a non-production-process concern, not an
  address-specific one, the deny-by-default guard applies uniformly regardless of which club
  address is the recipient — no special-casing needed or wanted.
- **Race on lock:** a board member advancing a request to `under_review` between a member's
  `PATCH` read and write is handled by the same atomic `WHERE status IN ('draft','submitted')`
  guard `updateProposal()` uses — the write returns zero rows, and the route surfaces a `409`
  rather than silently succeeding against a stale precondition.
- **Simultaneous decisions:** two `SOCIAL_REQUESTS_REVIEW` holders deciding at once can each pass
  the same-status guard and each insert a legitimate decision row — both persist as the honest
  append-only record, same as Proposals' documented behavior. No additional locking.
- **Image upload trust boundary:** the ~300KB length cap and `validateMagicBytes()` check are
  both server-side and both mandatory; the client-side resize is UX-only and provides zero
  security guarantee on its own (identical framing to `image-resize.ts`'s own doc comment for
  receipts).
- **Malformed/spoofed data URI:** a `data:image/...` prefix with non-image bytes after the
  base64 boundary (or a mismatched declared MIME type) must be rejected by
  `validateMagicBytes()` against the *decoded* bytes, not the string prefix — this is the one
  place this feature is intentionally stricter than its own `profile-picture` precedent.
- **`linkUrl` is not fetched or previewed server-side** — it is stored and rendered as a plain
  link, never scraped (same reasoning CLAUDE.md's Zeffy section documents for a different
  integration: outbound scraping of third-party URLs at request time is a footgun this codebase
  avoids as a matter of course).
- **No automation on decision.** Marking a request `posted` does nothing except write the
  decision row and send the notification email — no auto-post to any platform, no calendar entry,
  matching the Phase 1 analyst's confirmed out-of-scope item and the Proposals precedent this
  entire design mirrors.
- **Empty states** on both the member list and the admin dashboard follow the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention, text mirroring Proposals'
  own copy ("You haven't submitted a request yet" / "No requests submitted yet").

### Out of Scope

- Automated posting to social platforms via their APIs (Facebook Graph API, Instagram, etc.) —
  confirmed by the Phase 1 analyst; this feature routes a request to a human.
- SLA/escalation reminders for un-acted-on requests (Dues Reminders-style last-reminded badge).
- Minutes citation / backfill on decisions (see Data Model deviation).
- Migrating the three existing `escapeHtml`-shaped functions to the new shared
  `src/lib/html-escape.ts` — flagged for the architect's 30-day code review, not this feature.
- Google Group sync — no membership/committee dimension here.

### Required Unit Tests (implementer delivers these, not qa)

**`src/lib/html-escape.test.ts`** *(new file)*
- `escapeHtml()` escapes `&`, `<`, `>`, `"` and leaves plain alphanumeric/punctuation text
  unchanged.
- `escapeHtml()` is safe against a value that already contains an entity-like substring (e.g.
  `"AT&T"` → `"AT&amp;T"`, not double-encoded on a second pass within the same call).

**`src/lib/social-requests.test.ts`** *(new file, mirrors `src/lib/proposals.test.ts`'s structure
— pure, `environment: "node"`, no DB)*
- `isValidSocialRequestStatus()` accepts every value in the status vocabulary and rejects an
  arbitrary string.
- `isValidDecisionTargetStatus()` accepts `under_review`/`posted`/`declined`/`deferred` and
  rejects `draft` and `submitted` (a decision route can never target either).
- `isValidPlatform()` / a platform-array validator accepts a mix of valid platform values and
  rejects an array containing one invalid value; rejects an empty array **only** in the
  submission-validation context (a draft may legitimately have zero platforms).
- `isSocialRequestEditableByRequester()` returns `true` for `draft`/`submitted`, `false` for
  `under_review`/`posted`/`declined`/`deferred`.
- `socialRequestVisibleTo()`: reviewer sees everything regardless of ownership; a matching
  `requesterUserId`/`viewerUserId` pair is visible; a `null` `requesterUserId` (deleted account)
  is never visible to a non-reviewer even when `viewerUserId` is also `null`; a mismatched pair
  is not visible.
- `isNoOpDecision()`: same-status pair rejected; different-status pair allowed; a status that
  matches a *prior, non-consecutive* value (e.g. `deferred` again after an intervening
  `under_review`) is correctly **not** treated as a no-op.
- `validateSocialRequestSubmission()`: rejects an empty `platforms` array; rejects blank/whitespace
  `postCopy`; accepts a minimal valid submission (one platform, non-blank copy, no image, no
  link, no date); `desiredPostDate` absent is not an error (no tri-state coherence check exists
  for this field, unlike Proposals' `proposedDate`).
- `parseSocialRequestBody()`: rejects a body containing `status`, `requesterUserId`, or
  `requesterMemberId`; accepts a valid `platforms` array and rejects one containing an unknown
  value; rejects a malformed `desiredPostDate` (not `YYYY-MM-DD`); rejects `linkUrl` that isn't
  `http://`/`https://`; rejects `imageDataUri` exceeding the ~300KB cap; rejects `imageDataUri`
  whose decoded bytes fail `validateMagicBytes()` (fixture: a `data:image/png;base64,...` string
  wrapping non-PNG bytes); accepts a valid small fixture JPEG and a valid small fixture PNG data
  URI; trims and length-caps `postCopy` and `notes`.
- `socialRequestStatusLabel()` returns the correct label per status, including `posted` (not
  `approved`).
- `socialRequestSubjectLine()` truncates a long `postCopy` to the documented length with an
  ellipsis and falls back to a fixed string for an empty/null `postCopy`.

### Implementer Selection

**Specialist split: database-admin → api-developer → ux-developer.** Per CLAUDE.md's Phase 4
table, `full-stack-developer` is reserved for work "small enough that splitting adds overhead"
(~< 150 lines across API + UI). This feature is two new tables, five API routes with real
business logic (transactional submit/decide, tri-state-free but still multi-field validation, a
new image-upload trust boundary with server-side magic-byte validation), five pages, four
components, and a new shared library module — comfortably past that bar, and structurally
identical in shape and size to Proposals, which the architect confirmed ran the specialist split
cleanly. Sequencing:
1. **database-admin** — schema + both migrations (Implementation Order steps 1–2).
2. **api-developer** — `src/lib/html-escape.ts`, `src/lib/social-requests.ts` (+ unit tests),
   `src/lib/social-requests-queries.ts`, all five API routes (Implementation Order steps 3–4, 6).
3. **ux-developer** — all five pages and four components, consuming the API contract above
   as a fixed surface (Implementation Order step 5).

## Phase 3 — Technical Design — 2026-09-03

**Owner:** tech-lead
**Status:** complete

### Summary

Full design doc above. Social Media Post Requests reuses the Proposals feature's two-table
(mutable request + append-only decisions), Server-Component-by-default, ownership-gated shape
almost exactly, with three named deviations: `posted` replaces `approved` as the terminal state,
decisions carry no minutes-citation trio (an operational routing decision, not a formal club
commitment), and `desiredPostDate` is a plain nullable `date` with no value+unknown pair (nothing
downstream depends on distinguishing "no preference" from "blank"). The image field resolves the
architect's open storage-shape question in favor of data-URI-in-column (mirroring the
profile-picture route, not a new `ReceiptStorage`-style adapter), strengthened with
`validateMagicBytes()` against the decoded bytes — the one place this feature is stricter than
its own precedent. A new shared `src/lib/html-escape.ts` avoids adding a documented, already-flagged
piece of duplication (the HTML escaper) a fourth time, without expanding scope to touch the three
existing copies.

### What I did

- Read the full work-log: Phase 1 (READY WITH NOTES) and Phase 2 (Approved with suggestions),
  including all six open questions and their 2026-09-03 resolutions.
- Read `src/lib/db/schema.ts`'s `proposals`/`proposalDecisions` tables in full (columns, indexes,
  doc comments) as the structural template.
- Read `drizzle/migrations/0084_proposals.sql` and `0085_proposals_permissions.sql` for the exact
  idempotent migration shape to replicate (`0092`/`0093` for this feature — next available
  numbers after `0091_bank_account_opening_balance.sql`).
- Read all five Proposals route files (member list/new/detail, admin list/detail) and both
  library modules (`src/lib/proposals.ts`, `src/lib/proposals-queries.ts`) in full, plus the two
  API route handlers with real business logic (`submit`, `admin/.../decide`) to confirm the
  transaction boundaries, the after-commit email pattern, and the 404-not-403 enumeration-resistance
  rule.
- Read `src/lib/permissions.ts`'s `FEATURES`/`FEATURE_DESCRIPTIONS`/`ADMIN_NAVIGATION` sections
  around the existing `PROPOSALS_REVIEW` entries to confirm the exact insertion shape.
- Read `src/app/api/members/profile-picture/route.ts` and `src/lib/receipt-magic-bytes.ts` to
  settle the image-upload storage-shape question the architect left open, and confirmed
  `src/lib/image-resize.ts`'s resize math (`computeResizeDimensions()`) is generic/parameterized
  rather than receipt-specific, making it safe to reuse without touching the receipts-scoped
  constants or the `ReceiptStorage` adapter.
- Searched for an existing shared HTML-escaping helper (`grep` across `src/lib` and `src/app`) and
  confirmed three separate implementations exist today (`proposals.ts`, `dues-reminders.ts`,
  `ledger-acknowledgment-letter.ts`) with no canonical shared module — decided to introduce one
  rather than add a fourth copy, scoped narrowly to not touch the existing three.
- Confirmed via `find` that only pure library modules (`proposals.ts`, not `proposals-queries.ts`)
  carry a dedicated Vitest file in this codebase's existing pattern — informed the Required Unit
  Tests scope (pure `social-requests.ts` + new `html-escape.ts`, not the DB-facing queries file,
  which qa's Phase 5 click-through and e2e coverage handles instead).

### Outputs

- `docs/work-log/2026-09-03-social-media-requests.md` — this Phase 3 section, plus the Per-Phase
  Status table (row 3 marked Complete).
- No `src/` files modified — design only.
- No new `docs/decisions.md` entry, per the orchestrator's explicit instruction; the two most
  implementation-decision-shaped calls in this doc (posted-vs-approved, dropping the minutes
  trio, the data-URI image shape, and the new shared `html-escape.ts` module) are recorded here
  in the design doc's Data Model / Component Plan sections instead.

### Open questions / handoff notes

- **database-admin**: start with schema + the `add-permission` skill for the permissions
  migration (Implementation Order steps 1–2). Confirm `0092`/`0093` are still the next free
  migration numbers before writing the files (check `ls drizzle/migrations | sort -V | tail`
  again — another feature may have landed migrations since this design was written).
- **api-developer**: build `src/lib/html-escape.ts` and `src/lib/social-requests.ts` first, with
  the full unit test list above passing, before the API routes — the routes and the UI both
  depend on `parseSocialRequestBody()`'s exact validation contract. Do not touch
  `proposals.ts`/`dues-reminders.ts`/`ledger-acknowledgment-letter.ts`'s existing escapers; that
  consolidation is explicitly out of scope for this feature (see Out of Scope).
- **ux-developer**: wait for api-developer's route contract to land before starting (per
  CLAUDE.md's standing api-first ordering) rather than building against this design doc's
  API Contract section directly — the actual response shapes are the source of truth once
  written.
- **qa**: this feature has no dedicated `social-requests-queries.test.ts` by design (matches the
  Proposals precedent, where DB-facing query functions are exercised via the manual click-through
  and any e2e coverage rather than a Vitest suite) — confirm the manual click-through covers: a
  full submit-to-decide cycle including the requester's outcome view, the edit-lock `409` on a
  locked request, the draft-discard `204`, and — given this is the one genuinely new risk surface
  in this feature — an image upload with a spoofed/mismatched extension actually getting rejected
  server-side, not just client-side.
- **tech-lead (self, at Phase 6)**: confirm the deliberate spec extension (requester confirmation
  email on submit, beyond what Phase 1/2 literally asked for) reads as a good call once shipped,
  not scope creep — flag for the Phase 6 shipped-vs-intent review specifically, since it's the one
  place this design goes beyond what was explicitly requested.

---

## Phase 4a — Schema Implementation (database-admin) — 2026-09-03

**Owner:** database-admin
**Status:** complete

### Summary

Implemented the two-table schema from the Phase 3 design exactly as specified: `social_requests`
(mutable request row, pre-decision) + append-only `social_request_decisions`, both modeled
directly on `proposals`/`proposalDecisions`. Added the `FEATURES.SOCIAL_REQUESTS_REVIEW`
permission (bound to `admin` + `board_member`) and the "Social Requests" `ADMIN_NAVIGATION` entry
in the "Inbox" group. Confirmed `0092`/`0093` were still the next free migration numbers before
writing (last existing file was `0091_bank_account_opening_balance.sql`). Both migrations ran
clean on the dev DB, twice (idempotency check), and `pnpm exec tsc --noEmit` passes with no
errors.

### What I did

- Read the full work-log (Phases 1–3) and the `proposals`/`proposalDecisions` schema, plus
  `0084_proposals.sql` and `0085_proposals_permissions.sql`, as direct templates.
- Verified the live `features`/`role_features` column shapes directly against `schema.ts`
  (`features.name`/`category`/`description`, `role_features.role_id`/`feature_id` — not the
  generic `key`/`feature_key` shape in the `add-permission` skill's template or CLAUDE.md's
  illustrative example) and followed `0085`'s actual, verified pattern instead.
- Added `socialRequests` and `socialRequestDecisions` tables to `src/lib/db/schema.ts`, mirroring
  `proposals`/`proposalDecisions`'s structure, doc-comment style, and index set, with the three
  named deviations from the design doc: `status` vocabulary uses `posted` not `approved`; no
  `meetingDate`/`citingMinutesId` on decisions; `platforms` is a new `text[]` column
  (`text("platforms").array().notNull().default([])`, matching `ledgerDonors.emails`'s
  precedent); `desiredPostDate` is a plain nullable `date` with no value+unknown pair.
- Wrote `drizzle/migrations/0092_social_requests.sql` (both tables + 5 guarded indexes,
  idempotent `CREATE TABLE IF NOT EXISTS` / `DO $$ ... pg_indexes ... $$`).
- Wrote `drizzle/migrations/0093_social_requests_permissions.sql`, structured identically to
  `0085_proposals_permissions.sql`: idempotent feature insert (`social_requests.review`), then two
  independently-guarded `role_features` binds (`admin`, `board_member`) — neither assumed to ride
  along on an existing grant, per 0085's own correction note.
- Updated `src/lib/permissions.ts`: `FEATURES.SOCIAL_REQUESTS_REVIEW = "social_requests.review"`
  (doc comment mirrors `PROPOSALS_REVIEW`'s), the matching `FEATURE_DESCRIPTIONS` entry
  (byte-for-byte identical to the migration's `description` column), and a new "Social Requests"
  entry in `ADMIN_NAVIGATION`'s "Inbox" group immediately after "Proposals" (icon `📣`, href
  `/admin/social-requests`, gated on the new feature key) — this alone is sufficient for
  `src/proxy.ts`'s derived admin protection (DECISION-082); no hand-written proxy rule added or
  needed.
- Ran `pnpm db:migrate` against the dev DB twice in a row to confirm idempotency — second run
  produced only "already exists, skipping" NOTICEs, no errors, no duplicate rows.
- Verified the live table/index/FK shape and the permission + role-binding rows directly via
  `psql` (`\d social_requests`, `\d social_request_decisions`, and a `role_features` join query
  confirming exactly `admin` + `board_member` hold `social_requests.review`).
- Ran `pnpm exec tsc --noEmit` — passes clean, no output.

### Outputs

- `src/lib/db/schema.ts` — added `socialRequests`, `socialRequestDecisions` tables and their
  `SocialRequest`/`NewSocialRequest`/`SocialRequestDecision`/`NewSocialRequestDecision` exported
  types, inserted immediately after the `proposalDecisions` block.
- `drizzle/migrations/0092_social_requests.sql` — new. Creates `social_requests` (16 columns) and
  `social_request_decisions` (7 columns), plus 5 indexes (`ix_social_requests_requester_member`,
  `ix_social_requests_requester_user`, `ix_social_requests_status`,
  `ix_social_request_decisions_request`, `ix_social_request_decisions_status`). Every statement
  idempotent (`CREATE TABLE IF NOT EXISTS`, guarded `DO $$ ... pg_indexes ... $$` for indexes).
- `drizzle/migrations/0093_social_requests_permissions.sql` — new. Idempotent insert of the
  `social_requests.review` feature row (`WHERE NOT EXISTS`) and two independently-guarded
  `role_features` binds to `admin` and `board_member`.
- `src/lib/permissions.ts` — `FEATURES.SOCIAL_REQUESTS_REVIEW`, `FEATURE_DESCRIPTIONS` entry, and
  `ADMIN_NAVIGATION` "Inbox" group entry ("Social Requests", `/admin/social-requests`, `📣`,
  gated on `FEATURES.SOCIAL_REQUESTS_REVIEW`).
- Tables affected: `social_requests` (new), `social_request_decisions` (new), `features` (1 row
  inserted), `role_features` (2 rows inserted: `social_requests.review` → `admin`,
  `social_requests.review` → `board_member`). No existing table modified.
- No `docs/decisions.md` entry — this is a direct, unmodified reuse of an already-established
  pattern (Proposals), per the tech-lead's Phase 3 call not to log one.
- Local apply command used: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm
  db:migrate` — ran clean on first pass and again on a second pass (idempotency confirmed).
  `pnpm exec tsc --noEmit` passes with no errors.

### Open questions / handoff notes

- **api-developer** (next): `socialRequests`/`socialRequestDecisions` are live in both
  `schema.ts` and the dev DB. Build `src/lib/html-escape.ts` and `src/lib/social-requests.ts`
  (with the full Required Unit Tests list from Phase 3) first, then
  `src/lib/social-requests-queries.ts` and the five API routes, per the Phase 3 Implementation
  Order. `FEATURES.SOCIAL_REQUESTS_REVIEW` is importable now for the admin decide route's gate.
- Foreign keys: `social_requests.requester_member_id` → `members(id)` `ON DELETE SET NULL`;
  `social_requests.requester_user_id` → `users(id)` `ON DELETE SET NULL`;
  `social_request_decisions.social_request_id` → `social_requests(id)` `ON DELETE CASCADE`;
  `social_request_decisions.decided_by_user_id` → `users(id)` `ON DELETE SET NULL`. No FK to
  `minutes` (deliberate — see Data Model deviation in Phase 3).
- `platforms` is `text[] NOT NULL DEFAULT '{}'` — Drizzle reads/writes it as a plain `string[]`;
  no join table, no CHECK constraint (vocabulary validation belongs in
  `src/lib/social-requests.ts`, per DECISION-041 pattern, same as `status`).
- Did not touch `proposals`/`proposalDecisions` or any other existing table, per the assigned
  scope boundary.
- `ADMIN_NAVIGATION`'s new entry means `/admin/social-requests*` is already proxy-admitted for
  `SOCIAL_REQUESTS_REVIEW` holders (DECISION-082 derivation) even though no page exists yet under
  that path — ux-developer's pages must still each independently call `auth()` +
  `hasFeature()`; `src/lib/admin-page-feature-gates.test.ts` will fail the build once the
  directory exists if either admin page omits that call.

---

## Phase 4b — API Implementation (api-developer) — 2026-09-03

**Owner:** api-developer
**Status:** complete

### Summary

Built the pure library layer, the DB-facing query layer, and all five API routes from the
Phase 3 design doc, one-for-one mirroring the Proposals feature's shape as specified. Added the
new shared `src/lib/html-escape.ts` (`escapeHtml()`) as this feature's email builders' only
escaper, without touching the three pre-existing copies. Image uploads are validated with
`validateMagicBytes()` against the *decoded* bytes (not just the `data:` prefix), stricter than
the profile-picture route precedent, per the architect's explicit note. Every unit test named in
the Phase 3 design doc is written and passing (47 new tests across `social-requests.test.ts` and
`html-escape.test.ts`). `pnpm exec tsc --noEmit` and `pnpm test` both pass clean with no
regressions (85 test files, 1707 tests total).

### What I did

- Read the full work-log (Phases 1–3, and database-admin's Phase 4a schema section) and the live
  `socialRequests`/`socialRequestDecisions` schema in `src/lib/db/schema.ts` to confirm exact
  column names/types (`platforms: text[]`, `posted` not `approved`, no `meetingDate`/
  `citingMinutesId` on decisions, `desiredPostDate` with no value+unknown pair) — all matching
  the design doc.
- Read the full Proposals precedent as the direct template: `src/lib/proposals.ts`,
  `src/lib/proposals-queries.ts`, all five Proposals route handlers (member create/update-delete/
  submit, admin decide), `src/lib/club-contacts.ts` (`BOARD_EMAIL`), `src/lib/email.ts`'s
  `sendEmail()` signature, `src/app/api/members/profile-picture/route.ts` (image precedent),
  `src/lib/receipt-magic-bytes.ts` (`validateMagicBytes()`), and `src/lib/proposals.test.ts` (test
  structure/fixture conventions).
- Wrote `src/lib/social-requests.ts` — pure, no DB import: status/decision-target/platform
  vocabularies + validators, `isSocialRequestEditableByRequester()`, `socialRequestVisibleTo()`,
  `isNoOpDecision()`, `validateSocialRequestSubmission()`, `parseSocialRequestBody()` (rejects
  client-writable `status`/`requesterUserId`/`requesterMemberId`; validates `platforms`,
  `postCopy`, `notes`, `linkUrl` (`http(s)://` only), `desiredPostDate` (`YYYY-MM-DD`), and
  `imageDataUri`), `socialRequestStatusLabel()`, `socialRequestSubjectLine()` (60-char truncation
  with a fixed fallback string, since there's no `projectName`-equivalent field),
  `socialRequestPlatformLabel()`, and `validateImageDataUri()` (length cap + well-formed
  data-URI shape + `validateMagicBytes()` against the decoded bytes — the one place this feature
  is intentionally stricter than the profile-picture route's bare prefix check).
- Wrote `src/lib/html-escape.ts` — a new, intentionally import-free module exporting a single
  `escapeHtml()`, this feature's email builders' only escaper. Did **not** touch
  `src/lib/proposals.ts`'s `escapeProposalHtml`, `src/lib/dues-reminders.ts`, or
  `src/lib/ledger-acknowledgment-letter.ts` — that consolidation is explicitly out of scope per
  the Phase 3 design doc and belongs to the architect's 30-day code review.
- Wrote `src/lib/social-requests-queries.ts` — one-for-one mirrors of `proposals-queries.ts`:
  `createDraftSocialRequest`, `getOwnedSocialRequest`, `updateSocialRequest` (atomic
  `WHERE status IN ('draft','submitted')` edit-lock guard), `discardDraftSocialRequest`,
  `submitSocialRequest` (transactional: validate → snapshot requester name/email/phone → flip
  `status='submitted'` → insert the first `social_request_decisions` row as a self-transition),
  `listMySocialRequests`, `listSubmittedSocialRequestsForReview`, `getSocialRequestById`
  (enforces `socialRequestVisibleTo()` server-side, returns `null` not a 403 for a non-visible
  row), `resolveRequesterContactEmail`, `listDecisionsForSocialRequest`, `decideSocialRequest`
  (transactional append-only decision insert + status update, same-status no-op guard). No
  backfill-decision function — nothing to backfill once the minutes-citation trio is dropped.
- Wrote all five API routes:
  - `POST /api/members/social-requests` (`src/app/api/members/social-requests/route.ts`)
  - `PATCH` + `DELETE /api/members/social-requests/[id]`
    (`src/app/api/members/social-requests/[id]/route.ts`)
  - `POST /api/members/social-requests/[id]/submit`
    (`src/app/api/members/social-requests/[id]/submit/route.ts`) — sends the board notification
    (to `BOARD_EMAIL`) and a best-effort requester confirmation email, both strictly **after**
    the transaction commits, each in its own `try/catch` that only `console.error`s — a send
    failure never blocks or fails the submission, per CLAUDE.md's deny-by-default outbound-email
    invariant.
  - `POST /api/admin/social-requests/[id]/decide`
    (`src/app/api/admin/social-requests/[id]/decide/route.ts`) — gated on
    `hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW)`, 403 (not 404) on missing
    permission; 404 on a non-existent or still-`draft` request; 409 on a same-status no-op;
    sends a best-effort requester decision-notification email after commit.
- Wrote `src/lib/social-requests.test.ts` (30 tests) and `src/lib/html-escape.test.ts` (4 tests)
  covering every case named in the Phase 3 "Required Unit Tests" section, including the
  spoofed-image-extension fixture (`data:image/png;base64,...` wrapping non-PNG bytes, rejected
  by `validateMagicBytes()` against the decoded bytes) and valid small fixture JPEG/PNG data URIs
  built from raw magic-byte-matching buffers (not real images — `validateMagicBytes()` only
  inspects leading bytes, so this is sufficient and avoids committing binary test fixtures).
- Ran `pnpm exec tsc --noEmit` — clean, no errors.
- Ran `pnpm test` (Vitest) — 85 test files, 1707 tests, all passing; reran the two new files in
  isolation to confirm (`pnpm exec vitest run src/lib/social-requests.test.ts
  src/lib/html-escape.test.ts` → 2 files, 47 tests, all passing).
- Attempted `pnpm lint` — failed with a pre-existing, unrelated environment error (`eslint`'s
  `@eslint/eslintrc` dependency importing `minimatch` in a way incompatible with the installed
  `minimatch` version's exports; `SyntaxError: The requested module 'minimatch' does not provide
  an export named 'default'`). Confirmed via `git stash` that this fails identically on unmodified
  `main` — not caused by anything in this feature. Flagging for deployment-engineer's 30-day
  dependency review rather than attempting a fix outside this task's scope.

### Outputs

**New files:**
- `src/lib/social-requests.ts` — pure validators/helpers (no DB import).
- `src/lib/social-requests-queries.ts` — DB-facing query/mutation functions.
- `src/lib/html-escape.ts` — new shared `escapeHtml()`, first consumer is this feature.
- `src/lib/social-requests.test.ts` — unit tests.
- `src/lib/html-escape.test.ts` — unit tests.
- `src/app/api/members/social-requests/route.ts`
- `src/app/api/members/social-requests/[id]/route.ts`
- `src/app/api/members/social-requests/[id]/submit/route.ts`
- `src/app/api/admin/social-requests/[id]/decide/route.ts`

**No files modified** — schema/permissions were already complete from Phase 4a; this phase added
only new files.

**API contract for ux-developer to consume (all response bodies are the literal Drizzle row
shape — `SocialRequest` / `SocialRequestDecision` from `@/lib/db/schema`):**

1. `POST /api/members/social-requests` — Gate: `session.user.memberId` (401 unauthenticated, 403
   no linked member). Body: `{}` or any subset of writable fields (see `parseSocialRequestBody()`
   for the full list: `platforms`, `postCopy`, `notes`, `linkUrl`, `desiredPostDate`,
   `imageDataUri`). `status`/`requesterUserId`/`requesterMemberId` rejected with 400 if present.
   201 → `{ socialRequest }`. 400 on validation error.
2. `PATCH /api/members/social-requests/[id]` — Gate: ownership, 404-not-403. 409 once locked
   (`under_review`/`posted`/`declined`/`deferred`) or on a lock race. Body: partial field merge,
   same field list as #1. `imageDataUri` follows "key absent = leave unchanged" — omit the key
   entirely to keep the stored image; send `imageDataUri: null` to remove it; send a new data URI
   to replace it. 200 → `{ socialRequest }`.
3. `DELETE /api/members/social-requests/[id]` — Gate: ownership, 404-not-403. 409 if
   `status !== 'draft'`. 204 no body.
4. `POST /api/members/social-requests/[id]/submit` — Gate: ownership, 404-not-403. 409 if not
   `draft`. 422 → `{ errors: { platforms?: string, postCopy?: string } }` on validation failure
   (client should re-render the in-progress form, not navigate away). 200 → `{ socialRequest }`
   on success — `status` is now `'submitted'`, `submittedAt` is stamped, requester snapshot
   columns are populated.
5. `POST /api/admin/social-requests/[id]/decide` — Gate:
   `hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW)` (401 unauthenticated, 403
   missing permission). Body: `{ status: 'under_review'|'posted'|'declined'|'deferred', note?:
   string }`. 404 if not found or still `draft`. 409 if `status` equals the current status. 400 on
   a malformed body. 200 → `{ socialRequest, decision }`.

**Library exports ux-developer will need directly (all in `src/lib/social-requests.ts` unless
noted):**
- `SOCIAL_REQUEST_STATUSES`, `isValidSocialRequestStatus()`, `SocialRequestStatus`
- `DECISION_TARGET_STATUSES`, `isValidDecisionTargetStatus()`, `DecisionTargetStatus`
- `SOCIAL_REQUEST_PLATFORMS`, `isValidPlatform()`, `SocialRequestPlatform`,
  `socialRequestPlatformLabel()`
- `isSocialRequestEditableByRequester()` — drives the editable-vs-locked page split
- `socialRequestStatusLabel()` — always use this in UI, never render the raw `status` string
- `socialRequestSubjectLine()` — for list-row titles (no `projectName` field exists)
- `POST_COPY_MAX_LEN`, `NOTES_MAX_LEN`, `MAX_IMAGE_DATA_URI_LENGTH` — for client-side form limits/
  counters (server is still the authoritative check)
- `listDecisionsForSocialRequest()` (`social-requests-queries.ts`) — feeds the status timeline
  component; each row's `status` should be rendered through `socialRequestStatusLabel()`, never
  raw.

**Schema changes:** none — Phase 4a (database-admin) is unchanged by this phase.

### Open questions / handoff notes

- **Next: ux-developer.** Build the five pages and four components per the Phase 3 Component/Page
  Plan, consuming the API contract above (the actual shipped response shapes) rather than
  re-deriving field names from the design doc's prose. Note the deliberate deviations already
  baked into the routes: no `chairName`-equivalent editable-by-reviewer field on the decide route,
  no `citingMinutesId`/`meetingDate` in the decide body, and `imageDataUri`'s "send key only when
  dirty" contract (client must track an `imageDirty` flag — resending an unchanged ~300KB string
  on every autosave tick works but is wasteful and was deliberately designed against).
- For the client-side image resize (`computeResizeDimensions()` reuse from `src/lib/image-resize.ts`)
  — that's UX-only per the Phase 3 design doc; the server-side cap and magic-byte check here are
  the actual trust boundary and need no further hardening from ux-developer's side.
- `pnpm lint` is currently broken on `main` (pre-existing `minimatch`/`eslint` environment issue,
  confirmed unrelated to this feature via `git stash`) — flagging for deployment-engineer's next
  dependency review; not a blocker for this feature's own gate (typecheck + tests both pass
  clean).
- No `docs/decisions.md` entry added — this phase is a direct implementation of Phase 3's already-
  recorded design decisions, no new architectural call was made here.
- Confirmed (again, independently) that no admin page exists yet under
  `src/app/(dashboard)/admin/social-requests/` — `src/lib/admin-page-feature-gates.test.ts` has
  nothing to check yet and passed cleanly in the full test run; it will start enforcing the
  gate the moment ux-developer's admin pages land, per Phase 4a's note.

---

## Phase 4c — UI Implementation (ux-developer) — 2026-09-03

**Owner:** ux-developer
**Status:** complete

### Summary

Built all five pages and four components named in the Phase 3 Component/Page Plan, consuming
api-developer's shipped route/response shapes directly (read from the route files themselves,
not re-derived from the design doc's prose, per the Phase 4b handoff note). Every surface is a
direct structural/visual mirror of the Proposals feature — same hero banners, card styles, empty
states, autosave form pattern, and append-only status timeline — with the deviations the design
doc calls for: checkboxes (not radio buttons) for the `platforms` multi-select, an image
upload/preview/remove control instead of a text-only form, no minutes-citation UI anywhere, and
a `<select>`-based decision panel with no chair/backfill panel. `pnpm exec tsc --noEmit`,
`pnpm test` (1712 tests, 85 files, all passing), and `pnpm build:only` all pass clean with no
regressions. `src/lib/admin-page-feature-gates.test.ts` now covers the two new admin pages and
confirms both carry an independent `auth()` + `hasFeature()` gate.

### What I did

- Read the full work-log (Phases 1–4b) and the exact API contract from the shipped route files
  (`src/app/api/members/social-requests/route.ts`, `.../[id]/route.ts`, `.../[id]/submit/route.ts`,
  `src/app/api/admin/social-requests/[id]/decide/route.ts`), `src/lib/social-requests.ts`, and
  `src/lib/social-requests-queries.ts` — response shapes, field names, and the
  `imageDataUri`-only-when-dirty PATCH contract all came from these files directly, not the
  design doc.
- Read the Proposals feature end to end as the structural template: all five pages
  (`src/app/members/proposals/{page,new/page,[id]/page}.tsx`,
  `src/app/(dashboard)/admin/proposals/{page,[id]/page}.tsx`) and all four components
  (`proposal-form.tsx`, `proposal-status-timeline.tsx`, `proposal-review-table.tsx`,
  `proposal-decision-panel.tsx`).
- Read the image-upload precedents: `src/components/members/profile-picture-uploader.tsx` (crop
  dialog — not reused; this feature needs a plain add/replace/remove control, not a cropper) and
  `src/components/admin/ledger/receipt-file-input.tsx` (the canvas-resize glue pattern this
  feature's client-side downscale is modeled on) plus `src/lib/image-resize.ts`'s
  `computeResizeDimensions()`.
- Built `src/components/members/social-request-status.tsx` — `SocialRequestStatusBadge` +
  `SocialRequestStatusTimeline`, Server Components, mirrors `proposal-status-timeline.tsx` with
  no `meetingDate`/`citingMinutes` row (this feature's decisions carry no minutes-citation trio).
  Uses `socialRequestStatusLabel()` from the lib rather than a duplicated label map.
- Built `src/components/members/social-request-form.tsx` (Client Component) — hand-rolled
  `useState` + debounced (~2s) autosave + explicit Save/Discard/Submit, same promise-mutex
  `persist()` pattern as `proposal-form.tsx` (including its documented fix for the
  overlapping-save race). Platform selection is checkboxes over `SOCIAL_REQUEST_PLATFORMS`
  (exactly the vocabulary `social-requests.ts` validates — facebook/instagram/twitter_x/linkedin/
  other). Image upload: file input → `createImageBitmap` → `computeResizeDimensions(…, 1200)` →
  canvas → `toDataURL("image/jpeg", 0.82)`, tracked via an `imageDirty` flag so an unmodified
  image is never resent on an autosave tick — `buildPayload()` omits the `imageDataUri` key
  entirely unless `imageDirty` is true, matching `parseSocialRequestBody()`'s "key absent = leave
  unchanged" contract. A client-side length check against `MAX_IMAGE_DATA_URI_LENGTH` gives an
  immediate error before the network round trip; the server's cap and `validateMagicBytes()`
  check remain the actual trust boundary.
- Built `src/components/admin/social-requests/social-request-review-table.tsx` — mirrors
  `proposal-review-table.tsx`'s filter-buttons-plus-table shape; columns adapted (Request /
  Platforms / Submitted / Status) since there's no `type`/`chair` equivalent.
- Built `src/components/admin/social-requests/social-request-decision-panel.tsx` (Client
  Component) — `<select>` (not radio) + `note` textarea + submit button only, no
  `<ConfirmDialog>` (additive history, not destructive, per the design doc's explicit ruling), no
  minutes/chair backfill UI.
- Built all five pages:
  - `src/app/members/social-requests/page.tsx` — list, Account Not Linked empty state,
    drafts/in-review/decided grouping, "You haven't submitted a request yet" empty state.
  - `src/app/members/social-requests/new/page.tsx` — new-request form.
  - `src/app/members/social-requests/[id]/page.tsx` — editable pre-lock / locked+timeline
    post-lock split via `isSocialRequestEditableByRequester()`.
  - `src/app/(dashboard)/admin/social-requests/page.tsx` — review list, independent
    `auth()` + `hasFeature(FEATURES.SOCIAL_REQUESTS_REVIEW)` gate in the page body, "No requests
    submitted yet" empty state.
  - `src/app/(dashboard)/admin/social-requests/[id]/page.tsx` — review detail + decide,
    independent gate, 404s on a still-draft request (`request.status === "draft"` check even
    though `getSocialRequestById()` with `viewerHasReviewAccess: true` would return the row).
- Verified the existing `ADMIN_NAVIGATION` "Social Requests" entry (added in Phase 4a) links to
  `/admin/social-requests`, which now resolves to a real page — confirmed via `grep` against
  `src/lib/permissions.ts`.
- Applied one deliberate, safe deviation from the Proposals precedent: date formatting for the
  plain `desiredPostDate`/`submittedAt` `date`-typed values appends `T00:00:00` before
  `new Date(...)` parsing (forcing local-time interpretation instead of UTC midnight) — this
  sidesteps the exact naive-date/UTC-shift bug class already found and fixed elsewhere in this
  codebase (per project memory on the naive-timestamp bug, and matching the trick
  `proposal-status-timeline.tsx` already uses for `meetingDate`, just applied consistently
  everywhere a plain date string is formatted in this feature rather than inconsistently as
  Proposals does).
- Ran `pnpm exec tsc --noEmit` — clean, exit 0.
- Ran `pnpm test` (Vitest) — 85 files, 1712 tests, all passing (no new test files added — the
  Phase 3 "Required Unit Tests" section named only `html-escape.test.ts` and
  `social-requests.test.ts`, both pure-library files already written and passing by
  api-developer in Phase 4b; nothing in that list was UI-layer).
- Ran `pnpm build:only` — production build succeeds, exit 0, no errors. Confirmed all five new
  routes appear in the build's route listing (`/members/social-requests`,
  `/members/social-requests/[id]`, `/members/social-requests/new`, `/admin/social-requests`,
  `/admin/social-requests/[id]`) and the new API routes are present alongside them.
- Ran `pnpm exec vitest run src/lib/admin-page-feature-gates.test.ts` in isolation — 159 tests
  passing, confirming the new admin list and detail pages are now covered by the gate scan and
  both carry their own `auth()` + `hasFeature()` call (not just the derived proxy rule).

### Outputs

**New files:**
- `src/app/members/social-requests/page.tsx`
- `src/app/members/social-requests/new/page.tsx`
- `src/app/members/social-requests/[id]/page.tsx`
- `src/app/(dashboard)/admin/social-requests/page.tsx`
- `src/app/(dashboard)/admin/social-requests/[id]/page.tsx`
- `src/components/members/social-request-form.tsx`
- `src/components/members/social-request-status.tsx`
- `src/components/admin/social-requests/social-request-review-table.tsx`
- `src/components/admin/social-requests/social-request-decision-panel.tsx`

**No files modified** — schema, permissions, and the API layer were already complete from
Phases 4a/4b; this phase added only new files. Did not touch `src/lib/social-requests.ts`,
`src/lib/social-requests-queries.ts`, or any API route.

**No `docs/decisions.md` entry** — no new architectural decision was made in this phase; the one
notable implementation choice (the `T00:00:00` date-parsing guard) is a direct application of an
already-known, already-documented bug class, not a new structural call.

### Open questions / handoff notes

- **qa (next):** manual click-through should cover the full submit-to-decide cycle (draft → save
  → submit → board notification + requester confirmation emails queued → admin decides → status
  email queued), the edit-lock `409` on a locked request (try editing after a board member has
  moved it to Under Review), the draft-discard `204`, and — the one genuinely new risk surface —
  an image upload with a spoofed/mismatched extension actually rejected server-side (the client
  always re-encodes to real JPEG via canvas, so a client-crafted bad file is hard to exercise
  through the UI itself; test directly against the API per api-developer's Phase 4b note if the
  UI path doesn't surface it).
- New copy strings the Lions Club may want to refine: "Request a Social Media Post" (page title),
  "Ask the board to post something to the club's social media accounts" (list subtitle), the
  platform vocabulary labels (Facebook / Instagram / X (Twitter) / LinkedIn / Other), and the
  decision-panel note placeholder ("Posted to Facebook and Instagram 9/5" / "Declined — off-brand
  messaging").
- UX decision: image upload always re-encodes to JPEG via canvas (matching the receipt-upload
  precedent) regardless of whether the source file was JPEG or PNG — simpler client code, one
  fewer branch, and the server accepts both anyway. A user uploading a PNG with transparency will
  get a flattened JPEG; no complaint expected for a social-media reference photo, but flagging in
  case the club specifically wants to preserve PNG transparency for a logo-style graphic.
- UX decision: reused `socialRequestSubjectLine()` (as api-developer's handoff note recommended)
  for every list-row/page-title context, including its "your social media request" fallback
  string for a blank draft — reads slightly generic as a page `<h1>` on a brand-new draft, but
  avoids a second title-truncation implementation living only in the UI layer.
- No dedicated component-level test file was written — the Phase 3 design doc's "Required Unit
  Tests" section names only two pure-library files, both delivered by api-developer in Phase 4b;
  nothing in that list is UI-layer, and this codebase's existing pattern (confirmed by tech-lead
  in Phase 3) doesn't give Proposals' own components dedicated Vitest files either — coverage for
  this layer is the manual click-through above, per that same precedent.
- Reviewer click-through path: `/members/social-requests` → "Request a Post" → fill form (pick
  1+ platforms, enter post copy, optionally add an image/link/date) → "Save Draft" → reload the
  page to confirm the draft persisted → "Submit Request" → confirm the request now shows
  "Submitted" and is no longer editable... actually it remains editable until `under_review` per
  `isSocialRequestEditableByRequester()`, so also verify a `submitted` request is still editable
  → as an admin/board_member, visit `/admin/social-requests`, open the request, record a decision
  (e.g. Under Review, then Posted with a note) → back on the member side, confirm the request is
  now locked and the status timeline shows both transitions with the note visible.

---

## Phase 5 — Verification — 2026-09-03

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Independently re-ran every layer of the verification stack rather than
trusting the implementers' reports: `pnpm exec tsc --noEmit`, `pnpm test` (Vitest), and
`pnpm build:only` all pass clean with no regressions. Wrote and ran a new Playwright regression
suite (`e2e/social-requests-flow.spec.ts`, 8 tests, mirroring `proposals-permission-boundary.spec.ts`'s
fixture pattern) against a live dev server and a real Neon Postgres dev DB — it drives the actual
submit-to-decide cycle through the UI, proves the permission boundary and enumeration-resistance
rules with a real non-privileged session (not the admin E2E bypass fixture), and proves the
server-side image magic-bytes trust boundary directly against the API with a spoofed
`image/png`-prefixed data URI wrapping non-image bytes — all 8 pass. Both new admin pages
(`/admin/social-requests`, `/admin/social-requests/[id]`) were read directly and confirmed to
carry their own independent `auth()` + `hasFeature(FEATURES.SOCIAL_REQUESTS_REVIEW)` gate, not
just the derived proxy rule — the exact class of bug flagged in
`docs/work-log/2026-09-03-admin-subpage-auth-gate.md` did not reappear here. No `console.log` or
native browser dialogs in any new file. Both empty states match the standard convention. One
pre-existing, unrelated gap found and out of scope: `src/lib/members.ts` coverage sits at 35.89%,
well under this project's 80% target — flagged for the next 7-day coverage review, not a blocker
for this feature (this feature never touches `members.ts`).

### What I did

- Read the full work-log (Phases 1–4c) in two passes (1139 lines total) to capture the exact
  field list, permission shape, status vocabulary, edit-lock semantics, image-upload trust
  boundary, and every implementer's self-reported test/build results before independently
  re-verifying any of them.
- Ran `pnpm exec tsc --noEmit` — clean, no output, exit 0.
- Ran `pnpm test` (Vitest) — 85 test files, 1712 tests, all passing, 1.67–1.92s duration across
  several re-runs (including two coverage-instrumented runs). Matches api-developer's and
  ux-developer's self-reported counts exactly.
- Ran `pnpm build:only` — production build succeeds, exit 0. Confirmed all five new routes appear
  in the build's route listing (`/members/social-requests`, `/members/social-requests/[id]`,
  `/members/social-requests/new`, `/admin/social-requests`, `/admin/social-requests/[id]`) plus
  the four new API routes, with no unexpected warnings.
- Read both new admin pages directly (not inferred from passing tests, per the Feature-Gate Audit
  requirement below) — `(dashboard)/admin/social-requests/page.tsx` and `.../[id]/page.tsx` — and
  confirmed each independently calls `auth()` then
  `hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW)` with a `redirect()` on failure,
  before touching any data.
- Read `src/app/api/admin/social-requests/[id]/decide/route.ts` and confirmed the same gate
  (401 unauthenticated, 403 on missing `SOCIAL_REQUESTS_REVIEW`), plus the 404-on-draft
  defense-in-depth check and the same-status 409 guard.
- Read `src/lib/social-requests.ts`'s `validateImageDataUri()` and confirmed it decodes the
  base64 payload and runs `validateMagicBytes()` (`src/lib/receipt-magic-bytes.ts`) against the
  *decoded bytes*, not the declared `data:image/...` prefix, and confirmed both
  `POST /api/members/social-requests` and `PATCH /api/members/social-requests/[id]` route through
  the same `parseSocialRequestBody()` → `validateImageDataUri()` path (grepped both route files
  for the import).
- Read `src/app/members/social-requests/page.tsx` and `(dashboard)/admin/social-requests/page.tsx`
  directly and confirmed both empty states use the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention with the copy named in the
  design doc.
- Grepped every new file (`src/lib/social-requests.ts`, `social-requests-queries.ts`,
  `html-escape.ts`, all 4 API routes, all 5 pages, all 4 components) for `console.log` (excluding
  `console.error`) and `window.confirm|alert|prompt` / bare `confirm(`/`alert(`/`prompt(` — zero
  matches on both. Confirmed the one destructive action (draft discard) uses `<ConfirmDialog>`,
  and the one additive action (board decision) deliberately does not, per the design doc's own
  ruling.
- Queried the dev Postgres DB directly (`psql`, same `DATABASE_URL` from `.env.local` the app
  itself uses — this is the shared dev DB, not a production write, per project memory) to find
  password-enabled test accounts and confirm `social_requests`/`social_request_decisions`' live
  column shapes before writing fixtures.
- Wrote `e2e/social-requests-flow.spec.ts` — a new Playwright regression suite, structurally
  mirroring `e2e/proposals-permission-boundary.spec.ts`'s DB-fixture pattern (disposable
  `member`-role and `board_member`-role users created via direct DB insert, cleaned up in
  `afterAll`). Eight tests:
  1. A plain member is redirected from `/admin/social-requests` to `/access-pending`.
  2. A plain member gets `403`, not a silent `200`, from
     `POST /api/admin/social-requests/[id]/decide`.
  3. A plain member requesting another member's request detail page gets `404`, not `403`
     (enumeration resistance).
  4. A plain member `PATCH`ing another member's request gets `404`, not `403`.
  5. A `data:image/png;base64,...` data URI wrapping plain-text (non-image) bytes is rejected with
     `400` and an error mentioning JPEG/PNG — direct proof the server checks decoded bytes, not
     the client-declared prefix, independent of the UI's canvas re-encode (which the ux-developer
     handoff flagged as unable to exercise this path itself).
  6. A `board_member` reaches `/admin/social-requests` and sees a submitted request.
  7. The full cycle, driven through the real browser UI on the member side: sign in → empty state
     → "Request a Post" → check a platform checkbox → fill post copy/notes → "Submit Request" →
     toast confirms submission → request appears under "Submitted & In Review" → the board
     notification email is confirmed queued in `email_queue`, addressed to `BOARD_EMAIL`, with
     `status = 'blocked_non_production'` (never silently missing) → admin decides Under Review
     (with a note) → the now-`under_review` request returns `409` on a member `PATCH` (edit-lock)
     → admin decides Posted (with a note) → the member-facing detail page shows the real "Posted"
     outcome and both decision notes in the status timeline, not just "Submitted."
  8. A draft can be discarded (`204`) and disappears from the member's list.
- Started `pnpm dev` against the same dev DB, confirmed `200` on `/`, then ran the new spec file
  alone (`pnpm exec dotenv -e .env.local -- playwright test e2e/social-requests-flow.spec.ts`) —
  found and fixed two Playwright strict-mode selector ambiguities (two "Request a Post" links on
  the empty-state page; a toast and a save-state indicator both matching "All changes saved" —
  neither is a product bug, both are selector-scoping errors in the test itself) — then reran to
  8/8 passing.
- Ran the full `pnpm test:e2e` suite (145 tests across 24 spec files) to confirm no regression
  outside this feature. Result: all 8 `social-requests-flow.spec.ts` tests passed; 110 other tests
  passed; 7 failed, all in `budget-star-notes.spec.ts`, `budgeting-restructure.spec.ts`,
  `cancel-occurrence.spec.ts`, `ledger-search.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`,
  and `transaction-budget-line-link.spec.ts` — all Ledger/Events-area specs this feature never
  touches (confirmed by reading the failure messages: a missing "Community & Civic" budget
  category fixture, a cancelled-occurrence error-string mismatch, a stale FY-filter assumption —
  none reference `social_requests`, `social-requests`, or any file this feature added). Flagging
  as a pre-existing dev-DB-state/fixture-drift issue for the next 7-day coverage review, not a
  Phase 5 blocker for this feature.
- Confirmed the new fixture DB rows were fully cleaned up after the run (`psql` count queries for
  `qa-social-requests-%` emails and `%QA e2e%`/`%QA Gate Fixture%` post-copy text — all zero).
- Ran `pnpm exec vitest run --coverage` scoped to `src/lib/social-requests.ts`,
  `src/lib/html-escape.ts`, `src/lib/events.ts`, `src/lib/permissions.ts`, and
  `src/lib/members.ts` to check this feature's critical-module coverage against the QA charter's
  standing targets (see Coverage below).
- Stopped the dev server and deleted the generated `coverage/` directory (not committed).

### Outputs

- **New file:** `e2e/social-requests-flow.spec.ts` — 8 Playwright tests, all passing, covering the
  permission boundary, enumeration resistance, the image magic-bytes trust boundary, the full
  submit-to-decide cycle (UI-driven), the edit-lock 409, and the draft-discard 204. This is the
  regression suite this feature leaves behind — if any of these five gates ever regresses, this
  file fails.
- No `src/` files modified — verification only, no code changes.
- `docs/work-log/2026-09-03-social-media-requests.md` — this Phase 5 section, plus the Per-Phase
  Status table (row 5 marked Complete / PASS).

### Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no output.

### Unit Tests

`pnpm test`: **PASS**
Total: 1712 | Passed: 1712 | Failed: 0
Duration: ~1.7–1.9s
Failures: none

### Production Build

`pnpm build:only`: **PASS**
Notes: All five new page routes and four new API routes appear in the build's route listing
(`/members/social-requests`, `/members/social-requests/new`, `/members/social-requests/[id]`,
`/admin/social-requests`, `/admin/social-requests/[id]`, plus
`/api/members/social-requests`, `/api/members/social-requests/[id]`,
`/api/members/social-requests/[id]/submit`, `/api/admin/social-requests/[id]/decide`). No
unexpected warnings. `pnpm lint` remains broken on `main` for the pre-existing,
feature-unrelated `minimatch`/`eslint` environment issue api-developer already flagged in Phase
4b — reconfirmed unrelated (not attempted again here; deployment-engineer's 30-day dependency
review owns it).

### End-to-End Tests

`pnpm test:e2e`: **PASS** for this feature's coverage (new spec: 8/8). Full-suite run: 145 total,
110 passed, 7 failed (all pre-existing, all in unrelated Ledger/Events specs — see What I did),
1 skipped, 27 did not run (cascading skips within the failing specs' own `serial` describe
blocks — not this feature's files).
Total (new spec only): 8 | Passed: 8 | Failed: 0
Duration: ~24.5s (new spec only)
Failures: none in `e2e/social-requests-flow.spec.ts`. Unrelated failures elsewhere: see What I
did for file names and root causes — none reference `social_requests`/`social-requests`.

### Manual Click-Through

No flow in this feature depends on Google OAuth, Givebutter, or the live Google Workspace — the
whole feature is DB + Resend (deny-by-default outside production) + the app's own auth. The
Playwright suite above **is** the manual click-through: it drives a real Chromium browser against
a real dev server and a real Postgres DB, not a mock. No additional hand-driven browser session
was needed on top of it.

| Flow | Result | Notes |
|------|--------|-------|
| Full submit-to-decide cycle (member UI → board email queued → admin decides → member sees outcome) | pass | Driven end-to-end by Playwright, not simulated; `email_queue` row confirmed via direct DB read with `status='blocked_non_production'`, addressed to `BOARD_EMAIL` — queued and visible, never silently missing, per CLAUDE.md's deny-by-default rule. |
| Edit-lock (draft/submitted editable, under_review+ locked) | pass | `409` confirmed directly against the API on a request an admin had just moved to `under_review`. |
| Draft discard | pass | `204`, row removed from the member's list. |
| Image magic-bytes rejection (spoofed `image/png` prefix, non-image bytes) | pass | `400` with a JPEG/PNG-mentioning error, confirmed directly against the API — this is the one path the UI itself can't exercise (client always re-encodes via canvas), per ux-developer's Phase 4c handoff note. |
| Admin gate on both new admin pages and the decide route | pass | Read directly (not inferred from tests) — see Feature-Gate Audit below. |
| Empty states (member list, admin dashboard) | pass | Read directly; both use the standard `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention. |
| No console.log / no native dialogs | pass | Grepped every new file; zero matches for either. |

### Regression Tests Added

- `e2e/social-requests-flow.spec.ts` — "must not reach /admin/social-requests — redirected to
  /access-pending" — guards against: the admin-area proxy or page gate silently admitting a
  non-privileged member.
- `e2e/social-requests-flow.spec.ts` — "must get 403, not a silent 200, from
  POST /api/admin/social-requests/[id]/decide — regression for a missing hasFeature() gate" —
  guards against: the exact class of bug found and fixed elsewhere in this codebase today
  (`docs/work-log/2026-09-03-admin-subpage-auth-gate.md`) reappearing on this feature's decide
  route.
- `e2e/social-requests-flow.spec.ts` — "requesting another member's request detail page gets 404,
  not 403" / "PATCHing another member's request gets 404, not 403" — guards against:
  existence-leaking enumeration (Phase 1's Adversarial Pass).
- `e2e/social-requests-flow.spec.ts` — "a data URI whose decoded bytes are not a real image is
  rejected server-side even with a spoofed image/png prefix — regression for a
  client-Content-Type-only trust boundary" — guards against: the image upload trust boundary
  degrading to a bare prefix/Content-Type check (the exact weaker precedent the profile-picture
  route sets, which this feature was deliberately built to be stricter than).
- `e2e/social-requests-flow.spec.ts` — full cycle test's inline `409` assertion mid-test — guards
  against: the edit-lock race between a board member's decision and a member's in-flight `PATCH`
  silently succeeding against a stale precondition.

### Coverage on Critical Modules

- `src/lib/events.ts`: 94.96% statements / 86.28% branch (target 90%+) — **meets target**, no
  change this feature (untouched).
- `src/lib/permissions.ts`: 100% (target 100%) — **meets target**, no change this feature beyond
  the new `FEATURES.SOCIAL_REQUESTS_REVIEW` key and `ADMIN_NAVIGATION` entry (both exercised by
  `src/lib/admin-page-feature-gates.test.ts` and the new e2e boundary tests).
- `src/lib/members.ts`: 35.89% statements (target 80%+) — **below target**, pre-existing, this
  feature does not touch `members.ts`. Flagging for the next 7-day coverage review rather than
  expanding scope here.
- `src/lib/social-requests.ts` (new this feature, no standing numeric target): 85.45% statements /
  82% branch / 88.88% functions, via the 30 tests api-developer wrote in Phase 4b (every case
  named in the Phase 3 "Required Unit Tests" section) plus this phase's e2e coverage of the
  image-validation and decision-target-status paths at the API layer.
- `src/lib/html-escape.ts` (new this feature): 100% statements/branches/functions, via the 4 tests
  api-developer wrote in Phase 4b.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|------------------------------|----------------------------|
| `GET (dashboard)/admin/social-requests/page.tsx` | yes | yes | `FEATURES.SOCIAL_REQUESTS_REVIEW` |
| `GET (dashboard)/admin/social-requests/[id]/page.tsx` | yes | yes | `FEATURES.SOCIAL_REQUESTS_REVIEW` |
| `POST /api/admin/social-requests/[id]/decide` | yes | yes | `FEATURES.SOCIAL_REQUESTS_REVIEW` |
| `GET/POST members/social-requests/*` pages + routes | yes (`auth()`, no feature gate) | n/a — by design | No `FEATURES` key required; matches the Proposals precedent (`session.user.memberId` is the only gate; any linked member may submit) — confirmed correct per Phase 1/2/3's explicit, repeated ruling, not an oversight. |

Verified by reading each file directly (`(dashboard)/admin/social-requests/page.tsx`,
`.../[id]/page.tsx`, `api/admin/social-requests/[id]/decide/route.ts`), not inferred from passing
tests, per this agent's standing instruction that a route wrongly returning `200` to an
under-privileged user still passes a happy-path test. All three protected surfaces call `auth()`
first, then `hasFeature(session.user.id, FEATURES.SOCIAL_REQUESTS_REVIEW)`, and `redirect()`/`403`
on failure — no missing or wrong gate found. This audit is additionally now backed by an
executable regression test (test #2 in the new e2e spec) rather than resting on a one-time manual
read alone.

The four member-facing routes under `src/app/api/members/social-requests/*` and
`src/app/members/social-requests/*` are correctly ungated beyond `session.user.memberId` — this
is a deliberate design choice (Phase 1 Q4/Q5, Phase 2, Phase 3 all independently confirm "no
`PROPOSALS_SUBMIT`-equivalent key," matching the Proposals precedent), not a gap. Ownership
(`requesterUserId === session.user.id`) is enforced separately on every mutation, with the
404-not-403 enumeration-resistance rule confirmed by e2e tests #3 and #4.

### Verdict: PASS

### Open questions / handoff notes

- **Next: analyst, Phase 6 (shipped-vs-intent).** In particular, confirm tech-lead's own flagged
  question from the Phase 3 handoff notes: does the deliberate spec extension (a requester
  confirmation email on submit, beyond what Phase 1/2 literally asked for) read as a good call
  once shipped, or as scope creep?
- **7-day coverage review (self, next cycle):** `src/lib/members.ts` sits at 35.89% statement
  coverage against this project's 80% target — pre-existing, unrelated to this feature, but now
  freshly observed and should be logged/tracked rather than left to be rediscovered cold.
- **Unrelated e2e fragility, flag only:** 7 pre-existing failures in
  `budget-star-notes.spec.ts`, `budgeting-restructure.spec.ts`, `cancel-occurrence.spec.ts`,
  `ledger-search.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`, and
  `transaction-budget-line-link.spec.ts` surfaced during the full `pnpm test:e2e` run. None
  reference this feature. Likely dev-DB fixture/category drift (e.g., a missing "Community &
  Civic" budget category in the current dev DB snapshot) rather than a code regression, but worth
  a look at the next coverage review since a red full-suite run is a real signal even when this
  feature's own slice is green.
- **deployment-engineer (30-day dependency review):** `pnpm lint` is still broken on `main`
  (pre-existing `minimatch`/`eslint` environment incompatibility, reconfirmed unrelated to this
  feature) — carried forward from api-developer's Phase 4b note, still unresolved.
- New copy strings ux-developer flagged for the club's review (page titles, platform labels,
  decision-note placeholders) are unchanged from Phase 4c — still open for the club, not a QA
  blocker.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-09-03

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

The shipped feature delivers exactly what the original request asked for, refined through
Phase 1's questions and the user's own decisions — a member-portal form that routes a social
media request to a new admin review dashboard and reliably queues a board notification email —
with no regression against the Phase 1 flows and no unresolved Phase 1 gap that wasn't either
addressed or explicitly deferred with a tracked follow-up.

## What's Working

- **The submit-to-decide cycle is real, not simulated.** QA's Playwright suite drove it through
  an actual browser against a live Postgres dev DB, not a mock: draft → save → submit → board
  email queued → admin decides Under Review → edit-lock 409 → admin decides Posted with a note →
  member sees the real outcome and both decision notes in the timeline. This is the single
  biggest thing Phase 1 flagged as undetermined (Flow 4 — "log-and-notify only" vs.
  "Proposals-shaped"), and the user's decision (Proposals-shaped, in-app Posted/Declined/Deferred
  with append-only history) shipped exactly as decided, verified live rather than inferred from
  a passing unit test.
- **Enumeration resistance and the permission gate are both proven, not just read.** A plain
  member gets 404 (not 403) on another member's request, and 403 (not a silent 200) from the
  admin decide route without `SOCIAL_REQUESTS_REVIEW` — both are Phase 1 Adversarial Pass
  concerns, and both now have an executable regression test guarding them, not just a one-time
  code read.
- **The image-upload trust boundary is the one genuinely new risk surface this feature
  introduced, and it's the best-verified part of the build.** `validateMagicBytes()` runs against
  the *decoded* bytes, proven directly against the API with a spoofed `image/png`-prefixed data
  URI wrapping non-image bytes (400, rejected) — exactly the class of bug Phase 2's architect
  flagged by name ("never trust a client-supplied Content-Type").

## Intent-vs-Shipped Diff

- **"a form... in the member portal."** Phase 1 said: signed-in member, no new permission gate,
  matching the Proposals precedent. Shipped: `/members/social-requests/new`, gated only on
  `session.user.memberId`, confirmed in QA's Feature-Gate Audit. **Matches.**

- **"requests should show up in the dashboard."** Phase 1 flagged this as underspecified and
  raised it as an open question; the user's decision (before Phase 2) specified a *new* admin
  nav entry at `/admin/social-requests`, not folding into an existing area. Shipped: exactly that
  — a new "Social Requests" entry in `ADMIN_NAVIGATION`'s "Inbox" group (confirmed by direct read
  of `src/lib/permissions.ts` this session), proxy-admitted via the derived DECISION-082
  mechanism, with an independent page-level `auth()`+`hasFeature()` gate on both the list and
  detail pages (confirmed by direct read, not inferred from tests, both in QA's Phase 5 and my
  own verification this session). Reading "the dashboard" as a new admin area rather than
  shoehorning it into Announcements was the analyst's Phase 1 recommendation and the user's
  explicit choice — reasonable given the original request never named a specific existing
  surface. **Matches.**

- **"requests should generate an email to board@westervillelions.org."** Confirmed by direct
  code read of `src/app/api/members/social-requests/[id]/submit/route.ts` this session:
  `sendEmail()` is called with `to: BOARD_EMAIL` (`src/lib/club-contacts.ts` line 38, literal
  value `"board@westervillelions.org"` — the exact club-domain address the request named, not
  the ~44-person `club@` Google Group that caused the 2026-08-09 incident), strictly after the DB
  transaction commits, in its own `try/catch` that only logs on failure — a blocked or failed
  send can never fail the submission or silently vanish. QA independently proved the queued
  state live: a real `email_queue` row with `status = 'blocked_non_production'`, addressed to
  `BOARD_EMAIL`, confirmed via direct DB read in the Playwright suite — queued and visible, never
  falsely marked "delivered," matching CLAUDE.md's deny-by-default invariant and the
  acknowledgment-letter precedent's "say Emailed, never Delivered" discipline (this feature has
  no delivered/emailed status copy at all, so there's no wording to get wrong). **Matches.**

- **In-app Posted/Declined/Deferred decisions with append-only history.** User decision #2.
  Shipped: `social_request_decisions` is genuinely append-only (insert-only, confirmed via
  Phase 4b/5's reports of `decideSocialRequest()`), the decision panel's `<select>`
  (`src/components/admin/social-requests/social-request-decision-panel.tsx`, read directly this
  session) offers exactly `under_review` / `posted` / `declined` / `deferred` via
  `DECISION_TARGET_STATUSES`, and a same-status transition is rejected with 409 rather than
  silently duplicating a history row. Revisiting a prior status (e.g. `deferred` →
  `under_review` → `deferred` again) is allowed, each transition gets its own timestamped row —
  exactly the behavior the append-only design exists to guarantee. **Matches.**

- **admin + board_member as the review roles.** User decision #4. Shipped: confirmed by direct
  read of `drizzle/migrations/0093_social_requests_permissions.sql` this session — two
  independently-guarded `role_features` inserts, one for `admin`, one for `board_member`,
  neither assumed to ride along on an existing grant (the 0085 migration's own historical
  correction, deliberately re-applied here). **Matches.**

- **Requester confirmation email on submit (a spec extension beyond the literal request).**
  Tech-lead flagged this in the Phase 3 handoff for explicit Phase 6 judgment: good call, or
  scope creep? Judgment: **good call, not creep.** The original request only asked for a board
  notification, but a member who hears nothing back until a board decision (which could be days
  or weeks out) is a worse experience than the Proposals precedent this feature deliberately
  mirrors, and the email is best-effort, after-commit, and never gates the submission — it
  carries none of the risk the deny-by-default invariant exists to guard against. **Acceptable
  drift, in the user's favor.**

- **Edit/withdraw before a decision (Phase 1 Open Question 5, deferred to tech-lead).**
  Tech-lead resolved it following the Proposals precedent: editable while `draft`/`submitted`,
  locked at `under_review` and every terminal state, with an atomic `WHERE status IN (...)` guard
  against the lock-race Phase 1's Adversarial Pass would have asked about. Shipped and verified
  live (QA's edit-lock 409 test). **Matches** the deferred resolution; no drift to flag.

## Edge Cases

- **Empty state:** pass. Both `/members/social-requests` ("You haven't submitted a request yet")
  and `/admin/social-requests` ("No requests submitted yet") use the standard
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` convention — confirmed by QA's direct
  read and consistent with closing the Phase 1 gap on this point.
- **Failure microcopy:** pass. The submit route's 422 returns a field-keyed error map for
  in-progress re-rendering rather than a bare 500; the decide route's 409/403/404 all carry
  human-readable `error` strings, not stack traces (confirmed via direct route reads this
  session and QA's Phase 5 read).
- **Permission gate:** pass. Both admin pages and the decide route independently call `auth()` +
  `hasFeature(FEATURES.SOCIAL_REQUESTS_REVIEW)`; proven by an executable e2e test (a plain
  member is redirected to `/access-pending` from the page, and gets 403 not 200 from the route),
  not resting on a one-time code read alone.
- **Mobile (360px):** not independently verified this session. Neither Phase 4c nor Phase 5
  records an explicit narrow-viewport check, and no browser tool was available in this Phase 6
  pass to check it live. The form reuses `proposal-form.tsx`'s already-mobile-verified layout
  primitives (44px+ tap targets are explicitly called out in Phase 4c's own notes for the
  platform checkboxes), so the risk is low, but this is an honest gap in the verification record
  rather than a confirmed pass — flagged as a follow-up below, not silently waved through.
- **Brand consistency:** pass. Cards use `rounded-2xl` (`social-request-decision-panel.tsx`
  confirmed by direct read this session: `bg-white rounded-2xl shadow-sm overflow-hidden`),
  buttons use `rounded-lg` (`bg-lions-blue text-white px-6 py-3 rounded-lg`), the one destructive
  action (draft discard) uses `<ConfirmDialog>` and the one additive action (recording a
  decision) deliberately does not — matching the design doc's explicit ruling, not an oversight.

## Follow-ups (SHIP WITH NOTES)

1. **B-52** (new, added to `docs/backlog.md` this session) — `src/lib/members.ts` unit coverage
   (35.89%, target 80%+) is a pre-existing gap re-observed by QA's Phase 5 run, first logged in
   the 2026-05-20 and 2026-06-24 coverage reviews and never tracked past the review log until
   now. Not caused by or blocking this feature (this feature never touches `members.ts`).
2. **B-53** (new, added to `docs/backlog.md` this session) — 7 pre-existing e2e failures across
   6 unrelated Ledger/Events specs (`budget-star-notes.spec.ts`, `budgeting-restructure.spec.ts`,
   `cancel-occurrence.spec.ts`, `ledger-search.spec.ts`,
   `prior-year-cause-line-reconcile.spec.ts`, `transaction-budget-line-link.spec.ts`), surfaced
   by QA's full-suite run. `cancel-occurrence.spec.ts` is a second occurrence of the same
   hardcoded-date-rot class fixed once already on 2026-06-24 — the earlier fix was a one-time
   date bump, not a structural fix. None reference this feature.
3. **Mobile viewport (360px) verification is outstanding** — no session in this pipeline
   (Phase 4c or Phase 5) recorded an explicit narrow-viewport check for the new form, list, or
   admin pages. Low risk (built on already-mobile-verified Proposals primitives), but should be
   confirmed rather than assumed the next time a browser tool is available — not severe enough
   to hold this at SHIP WITH NOTES, but tracked here rather than silently closed.
4. **Copy review** — ux-developer's Phase 4c handoff flagged several new user-facing strings
   (page titles, platform labels, decision-note placeholders) as open for the club's own review.
   Not a defect; carrying forward as a note so it isn't lost now that the pipeline is closing.

I searched `docs/decisions.md`, `docs/backlog.md`, and the welcome-packet work-log
(`docs/work-log/2026-08-21-welcome-packet-live-page.md`) for the "documents/welcome_packets bare
timestamp" architect note referenced in this Phase 6 task and found no matching entry under that
description anywhere in `docs/` — nothing to reconcile or re-track. If this refers to something
outside this repository's `docs/` tree, it needs a pointer before I can act on it.

## Outputs

- `docs/work-log/2026-09-03-social-media-requests.md` — this Phase 6 section; Per-Phase Status
  table's final row marked Complete / SHIP WITH NOTES.
- `docs/backlog.md` — two new tracked items: **B-52** (`members.ts` coverage gap) and **B-53**
  (six red e2e specs from fixture/date drift), carrying QA's Phase 5 findings forward into a
  trackable item instead of leaving them only in the work-log's prose.
- No `src/` files modified — Phase 6 is verification only.

## Open questions / handoff notes

- Pipeline closes here. No loop-back required — every Phase 1 flow, every user decision, and
  every Phase 1/2/3 open question either shipped as specified or was resolved with an explicit,
  logged deferral.
- Next opportunistic step (not blocking): confirm the 360px viewport by hand next time a browser
  tool is available for this app, and fold that into the next coverage-review cycle rather than
  opening a third backlog item for a single manual check.

---

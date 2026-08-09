# Project or Activity Proposal Form — Work Log

> **Slug:** `2026-08-09-project-proposal-form`
> **Surface:** mixed — member portal (submit) + admin (board review)
> **Permission(s):** TBD — reading/submitting is any linked member; a review surface likely needs a new key
> **Estimated complexity:** medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-09 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-09 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-09 |
| 4 — Implementation (schema) | database-admin | Complete | complete | 2026-08-09 |
| 4 — Implementation (server) | api-developer | Complete | complete | 2026-08-09 |
| 4 — Implementation (client) | ux-developer | Complete | complete | 2026-08-09 |
| 5 — Verification | qa | Complete | PASS | 2026-08-09 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-09 |

---

## Origin

Requested by Chris Henson (treasurer) 2026-08-09: *"at our last board meeting it was
discussed to put this form in the member portal. can you do some research and maybe
simplify the form a bit for online filling out. the board should get an email when a
form is submitted. lets not make it to daunting."*

Source document: `New project proposal form 8.8.26.docx` (archived to the session
scratchpad; the club's paper form, dated 8 Aug 2026).

### Governance context — this form is not standalone

Two motions from the **2026-08-07 Board Retreat** (minutes now in the portal, kind
`board`) bear directly on it:

1. **Communication Policy** — moved Bill Phythyon, seconded Howard Baum, *passed*:
   approved *"with the addition that a project/activity form be submitted with the
   request."* This form is therefore the **required attachment to any publicity or
   communication request**, not an optional nicety. Jim Shively presents the policy at
   the **September 17** general meeting, and it is posted to the website only after
   general-membership approval — that is the effective deadline for this form being
   usable.
2. **Volunteer Response Form** — moved Howard Baum, seconded Don Kerr, *passed*:
   develop a form to track activities. **Related but distinct** — that is a volunteer
   sign-up/tracking instrument, not this proposal intake. Do not conflate the two;
   flagged here so a later reader doesn't merge them by accident.

The paper form's footer — *"Please give completed form to any Board Member for
consideration at our next meeting"* — establishes the real-world workflow this
replaces: submission is followed by **board consideration at the next board meeting**.
Any online version has to preserve that cadence, which is why an admin/board review
surface is in scope rather than a fire-and-forget email.

### The paper form as it stands (18 items)

Name of project/activity · Type (Fund Raising / Service Project) · Name of Lion
proposing · Date of submission · Chairperson (*"the board will not consider this
proposal without a chairperson named"*) · Contact email · Contact phone · Goal (what
need does this meet / how does it help the community) · Upfront money needed from the
club · Expenses · Anticipated income · Technology/equipment needs · Timeline/schedule ·
Resources from the club · Resources from the community · Publicity to club members ·
Publicity to the community · Number of people needed · Additional notes.

---

## Research findings (pre-Phase 1, 2026-08-09)

**Form design.** Baymard: field *count*, not step count, drives abandonment — flows of
~15 fields routinely reduce to 6–8; 17–26% abandon on perceived length alone. Remedy for
minority-relevant fields is conditional disclosure, not deletion. NN/g on older adults
(123 participants, 2001/2013/2018–19): web-use ability declines ~0.8%/yr from age 25;
persistent complaints are small text, small targets, dropdowns. WCAG 2.2 SC 2.5.8
requires 24×24 CSS px targets; 44×44 on primary controls. NN/g on required-field
marking: mark **required** explicitly (Baymard measured 32% validation-error rates when
only optional fields were marked); dual-mark for this audience.

**Verdict on structure: single scrolling page, three labeled sections, autosave +
explicit "Save draft".** Not a wizard. GOV.UK's "one thing per page" explicitly exempts
internal repeat-use services, and for seniors a wizard multiplies navigation
disorientation — the most-cited senior difficulty. A single page also preserves the
paper form's mental model and prints, which the board will want.

**Comparable orgs.** LCIF grants and Rotary district grants converge with generic club
templates on one minimal core: **name, type, short what-and-why, dates, money, people.**
Everything else on the Westerville form is LCIF-grant-scale overhead or post-approval
planning material. Rotary asks for a 2–3 sentence executive summary and one itemized
budget — no source asks a volunteer for three separate money figures up front.

## Treasurer's decisions (2026-08-09) — binding on Phase 1

1. **Chairperson: "Not yet identified" is a valid submitted answer**, flagged visibly to
   the board. Chosen over blocking submission — surfaces ideas earlier and lets the board
   help find a chair. NOTE: this deliberately softens the paper form's stated rule
   (*"the board will not consider this proposal without a chairperson named"*). The rule
   is preserved as board-side signal, not as a submit-time gate. Do not "restore" the
   hard block without asking.
2. **Publicity: one merged optional field** ("How should we publicize this?"), covering
   both club and community. Retains the tie to the approved communication policy without
   two essay boxes at intake. Research alone would have dropped both; the governance link
   is why it stays.
3. **Board review surface IS in scope**, alongside the email. Status
   (Submitted / Under review / Approved / Declined) plus the deciding meeting date, and
   the proposer can see where their idea stands. Replaces the paper form's dead end
   (*"give completed form to any Board Member"* → void).

## Agreed field set — 18 items → 5 required + 7 optional/conditional

Auto-filled, shown read-only: proposer name, email, phone (from member profile),
submission date. This alone retires 4 of the paper form's items.

**Required:** project name · type (Fundraiser / Service project / Both) · what need does
this meet & how does it help the community (2–3 sentences) · who will chair it (with
"Not yet identified" valid) · will this need money from the club up front?
(Yes / No / Not sure).

**Optional / conditional:** when would this happen (+ "Not sure yet") · estimated cost
(only if money=Yes) · estimated income (only if type includes fundraising) · roughly how
many volunteers · what would you need from the club (absorbs the paper form's separate
technology/equipment item) · how should we publicize this · anything else.

**Dropped:** date of submission (derived) · technology/equipment as its own field
(folded in) · resources from the community (post-approval planning).

Every money, date, and headcount field must accept "I don't know yet" as a *valid
answer*, not a blank — a "not sure" routed to the treasurer beats an invented number.

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Replaces a paper form that dead-ends at "give it to any board member" with an online
> intake + a real status the proposer can watch move — but the request only specified
> the submission half (board gets an email); the status-tracking half the treasurer
> already committed to (decision #3) needs its own decision model, visibility rule, and
> a notification on *change*, not just on submit, or it recreates the same dead end
> electronically.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member (any linked member, no FEATURES gate) | Starts a new project/activity proposal | Occasional |
| Signed-in member | Fills required + optional fields, including "Not sure yet" as a valid answer on money/date/headcount fields | Per proposal |
| Signed-in member | Saves a draft and returns later to finish it | Per proposal, 0–N times |
| Signed-in member | Submits the proposal (draft → Submitted) | Once per proposal |
| Signed-in member | Views their own proposals and current status | On demand |
| Signed-in member | Edits a proposal they submitted, while it's still editable (see Gap C) | Occasional |
| Admin / board reviewer (new `FEATURES.PROPOSALS_REVIEW`) | Views all submitted proposals (not others' drafts) | Per board cycle (monthly) |
| Admin / board reviewer | Moves a proposal through status (Submitted → Under Review → Approved / Declined / Deferred) | Per proposal, at/after a board meeting |
| Admin / board reviewer | Records the deciding meeting date, and optionally links the citing minutes once written | At decision time, backfillable |
| System | Emails `board@westervillelions.org` on submission | Automatic |
| System | Emails the proposer on submission and on every status change (new — see Gap F) | Automatic |

Note: the Origin request names "the board" and "a form" without saying which portal
surface each verb lands on. This review is the first place that's been made explicit —
submission is member-portal (`/members/...`), review is admin-portal
(`/(dashboard)/admin/proposals` or similar), and they are two different pages gated two
different ways, not one page with conditional rendering.

## Flows

**Flow 1 — Submit a new proposal:** entry via a "Propose a project or activity" link/button
in the member portal → member fills the 5 required fields (name, type, need/impact,
chair, money-needed-from-club) and any optional/conditional fields that apply → member
clicks Submit → proposal status becomes `Submitted`, board is emailed, proposer sees a
confirmation screen and the proposal now appears in "My Proposals."
- Failure: a required field is missing or invalid → inline, field-level error naming
  *which* field and why (per Baymard's 32%-error-rate finding when only optional fields
  are marked, both required and optional must be explicitly labeled, not just one).
  Submission must be server-validated, not just client-validated — see Adversarial Pass.
  On a network/DB failure during submit, the user's entered data must still be on screen
  (never a full-page error that discards a half-written form) with a plain-language
  retry message, not a stack trace.

**Flow 2 — Save a draft, return later:** entry from the same form, "Save draft" instead
of Submit → draft persists, visible only to the proposer, listed as `Draft` in "My
Proposals" → member returns any time, resumes editing, eventually submits or abandons it.
- Failure/edge: what does "abandons it" mean concretely? There's no delete/discard
  action in the agreed field set (correctly — that's an implementation control, not a
  form field) but the flow needs one named explicitly, or drafts accumulate forever with
  no way to clean up. See Gap B.
- A draft never reaches the board and is never emailed — it does not exist for review
  purposes until Submit is clicked. This must be enforced server-side (the "is this a
  draft" check gates both the board email trigger and the admin review list query), not
  just hidden in the UI.

**Flow 3 — Board review and decision:** entry via `/(dashboard)/admin/proposals`, gated
by a new `FEATURES.PROPOSALS_REVIEW` key → reviewer sees all `Submitted` (and later)
proposals across all members, opens one, reads it, and at/after the board's monthly
meeting sets status to `Under Review`, then `Approved` / `Declined` / `Deferred`, records
the meeting date, optionally attaches the citing minutes once written → proposer's status
view updates, proposer is emailed the decision.
- Failure: empty state (no submitted proposals yet) must not read as "the feature is
  broken" — see Pass 4. No proposal in this flow is ever destructively deleted, so
  `<ConfirmDialog>` isn't triggered by a status change itself, but *is* required if a
  draft-discard action is added (Gap B) or if the admin surface ever gets a delete.

## Permissions

- **Submit / draft / view-own:** no new gate beyond "linked member," matching the
  established pattern for `/members/financial-reports` and `/members/records` (any
  linked member, no `FEATURES` check). A member mid-onboarding with zero granted
  features still reaches this surface — it does not require an active role, only a
  linked member record. This is deliberate and should be preserved: the treasurer's
  framing ("board should get an email when a form is submitted") assumes any member can
  submit an idea, not just permissioned ones.
- **Board review / decide:** new key, `FEATURES.PROPOSALS_REVIEW` ("View and decide
  project/activity proposals"). Default roles: `Admin` + `board_member` (the existing
  role that "gets most features except admin.roles" per
  `drizzle/migrations/0002_roles_permissions_groups_campaigns.sql`) — this is the same
  binding pattern used for `MINUTES_MANAGE`/`DOCUMENTS_MANAGE`. One key covers both
  viewing and deciding, matching the existing `SUGGESTIONS_VIEW` precedent (single key,
  no separate "manage" key) rather than splitting view/decide into two keys. Flagging
  this as a judgment call for tech-lead to revisit only if the board specifically wants
  an officer who can see proposals but not decide them — nothing in the request implies
  that distinction is needed.

## Gaps the Request Didn't Address

- **(a) Who may see a submitted proposal?** The request never says. My recommendation:
  a submitted proposal is visible to its proposer and to `PROPOSALS_REVIEW` holders —
  **not** club-wide by default. Reasoning: half-formed ideas ("Not yet identified" chair,
  "Not sure" on money) sitting in a member-visible list plausibly chills submission,
  which is the opposite of what this feature is for. This also matches the closest
  in-app analog — `SUGGESTIONS_VIEW` gates suggestion-box submissions to admins, they
  aren't club-visible either. Server-side, this means a proposal-detail route/query must
  check `proposerUserId === session.user.id OR hasFeature(PROPOSALS_REVIEW)`, not just
  hide a nav link. **This is a real design fork, not a rubber stamp — flagging as an
  open question for the treasurer/board because it changes the shape of the API and the
  "my proposals" vs "all proposals" list queries in Phase 3.**
- **(b) Draft lifecycle has no discard/delete path.** The agreed field set correctly
  doesn't include a "delete" field — but the *flow* needs an explicit abandon action or
  drafts pile up invisibly forever with no way to clean up. Recommend a simple "Discard
  draft" action on `/members/proposals` drafts, routed through `<ConfirmDialog>`
  (irreversible) per the brand guideline against native `confirm()`. This is a UI/API
  addition, not a field-set change.
- **(c) No rule for editing after submission.** Recommend the minimal honest rule: a
  proposal is editable by its proposer while status is `Submitted` (i.e., not yet on a
  board's working agenda); once an admin advances it to `Under Review`, it locks to
  read-only for the proposer, so the board is never deciding on text that changed after
  they started looking at it. This needs explicit confirmation — it's a genuine design
  choice the paper form's single-shot workflow never had to make.
- **(d) Decision status model is underspecified.** "Status (Submitted / Under review /
  Approved / Declined)" from treasurer decision #3 is missing a real board outcome: the
  board meets monthly and *routinely defers* items rather than declining them outright.
  Recommend adding `Deferred` as a fifth status — conflating "come back next month" with
  "no" will misrepresent real board behavior from day one. Recommend the deciding-meeting
  date and an optional `citingMinutesId` follow the exact pattern already established for
  governing-document amendments (`documentVersions.adoptedByUserId` /
  `adoptedAt` / `citingMinutesId`, nullable, backfillable after the meeting's minutes are
  written) — this codebase already solved "record who/when decided, cite minutes later,"
  no need to invent a new pattern.
- **(e) What happens to an approved proposal is unaddressed — and is the single biggest
  scope-creep risk.** Recommend this is explicitly **out of scope**: an approved
  proposal stays a proposal record. It does not auto-create an event, a campaign, or a
  budget line. A board member or admin who wants to act on it uses the existing
  event/campaign/budget tools by hand, same as today. State this explicitly in the
  design doc so Phase 3 doesn't quietly grow a "convert to event" button.
- **(f) Notification fan-out on status change is missing — this is the most important
  gap.** The Origin request only says "the board should get an email when a form is
  submitted." Treasurer decision #3 explicitly frames the online status surface as
  replacing the paper form's dead end (*"give completed form to any Board Member"* →
  void). But an email only on submit, with no notification when status changes,
  reproduces exactly that dead end — the proposer has to remember to keep checking a
  page. Recommend: proposer is emailed (a) confirmation on submit and (b) on every
  status transition (Under Review / Approved / Declined / Deferred), each queued through
  `sendEmail()` to the proposer's own address — not `BOARD_EMAIL`, so the
  `isClubDistributionList` non-prod guardrail doesn't apply to these and they're testable
  in dev without hitting the club's real list.
- **(g) September 17 deadline — achievable, with one hard scope cut.** From today
  (2026-08-09) to Sept 17 is ~5.5 weeks for a feature the work-log already estimates
  medium complexity, clean schema ground (no existing `programs` table, no existing
  FEATURES keys). That's realistic **provided** (a), (c), (d), and (f) above are decided
  now rather than re-litigated mid-build, and **provided (e) is held firm as out of
  scope** — "approved proposal becomes an event/campaign" is exactly the kind of
  late-added scope that would blow the date. If time gets tight, the minimum shippable
  subset that still satisfies the Communication Policy's requirement (a proposal
  form exists and board gets notified) is: submit + board email + proposer confirmation
  email, with the admin review list and status field present but the `Deferred` state
  and citing-minutes linkage deferred to a fast follow-up. Draft-save (treasurer decision
  #3 territory) should not be the thing cut — it's core to the research's
  abandonment-reduction rationale and low-cost to build (one boolean + one timestamp).

## Out of Scope (confirm with user)

- Auto-creating an event, campaign, or budget line from an approved proposal (Gap E).
- Any public-facing (anonymous visitor) view of proposals — this is a members+board
  surface only, never `/programs` or any public route.
- The Volunteer Response Form (separate motion from the same board retreat) — explicitly
  called out in Origin as related but distinct; do not conflate.
- Editing or status-changing by anyone other than the proposer (own draft/submitted
  proposal) or a `PROPOSALS_REVIEW` holder — no co-authoring, no chairperson-as-editor
  concept even though a chairperson is named on the form.
- Google Group sync — this feature does not touch group membership; confirming as N/A
  rather than silently unaddressed.

## Open Questions

- **(a) Visibility:** confirm proposer + board-only visibility (my recommendation) vs.
  club-wide visibility of submitted proposals. This is a genuine judgment call, not a
  functional oversight — needs a yes/no from the treasurer or board before Phase 3 can
  fix the API shape.
- **(c) Edit-lock timing:** confirm "editable until `Under Review`, then locked" is the
  right rule, or whether the board wants proposers able to keep revising even mid-review.
- **(d) `Deferred` status:** confirm adding it to the four named in decision #3, since it
  changes the status enum tech-lead designs against.
- Does the board want the deciding-meeting date to be a free-text field (matching the
  paper form and allowing "TBD, next meeting") or a hard date picker? The governing-docs
  precedent this borrows from allows the *citation* to be backfilled but still records a
  real `adoptedAt` timestamp at decision time — worth the same clarification here.

---

### Pass 4/5 notes not already folded into Gaps above

- **OAuth vs. password:** unaffected — this feature only needs an authenticated member
  session with a linked member record, same as financial-reports/records. No path
  assumes a Google identity.
- **Access-pending:** does not apply to submit/draft/view-own (no FEATURES gate, same as
  financial-reports). Does apply to the admin review surface as designed — a member
  without `PROPOSALS_REVIEW` who somehow reaches `/admin/proposals` must redirect to
  `/access-pending`, and per the derived-admin-protection invariant (DECISION-082), this
  is automatic once the page appears in `ADMIN_NAVIGATION` with the right
  `requiredFeature` — but the page's own body must still call `auth()` +
  `hasFeature()` independently, not rely on the proxy alone.
- **Empty states:** "My Proposals" with zero proposals, and the admin list with zero
  submitted proposals, both need real empty-state copy per the
  `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` pattern with a call to action
  ("You haven't proposed a project yet — click Start a Proposal above"), not a bare "No
  proposals."
- **Mobile (360px):** the single-scrolling-page structure the research recommends must
  be verified at 360px specifically for the conditional fields (cost field appearing
  under the money-needed radio, income field appearing under the fundraising type) —
  conditional-field reveal is the part most likely to break narrow layouts.
- **Input boundaries (adversarial):** the "accept 'Not sure yet' as valid" requirement
  from the agreed field set is a genuine input-boundary problem, not just copy: the
  estimated-cost/estimated-income/timeline fields need a UI mechanism that lets "not
  sure" and a number coexist as mutually exclusive states (e.g., a checkbox that clears
  and disables the numeric input), and the server must accept and store that
  not-sure state as distinct from a blank/invalid submission. Flagging for tech-lead's
  data-model pass — this is where "don't redesign the field list" and "field needs a
  working input mechanism" intersect.
- **State-machine shortcuts (adversarial):** status must never be client-writable on the
  submit path — the initial insert always forces `Submitted` (or `Draft`) server-side
  regardless of what a manipulated request body claims. The status-change action must be
  a separate, `PROPOSALS_REVIEW`-gated endpoint, never reachable from the member-facing
  submit/edit form.
- **Enumeration (adversarial):** a member requesting another member's proposal by
  guessing/incrementing its id (without `PROPOSALS_REVIEW`) should get the same
  not-found treatment regardless of whether the id exists — don't leak existence via a
  403-vs-404 distinction.
- **Redirect targets (adversarial):** no flow in this feature takes a `callbackUrl`,
  `next`, or `redirect` parameter — not applicable.
- **Self-targeting (adversarial):** a proposer cannot set their own proposal's status —
  addressed above (state-machine shortcuts); worth restating because "chairperson"
  self-naming is adjacent but is not a permission grant, just a text field.
- **Brand consistency:** cards `rounded-2xl`, buttons `rounded-lg`, no `window.confirm`
  for the draft-discard action (Gap B) — all call out explicitly since this is a new
  surface built from scratch, not an extension of an existing one, so there's no
  existing component to inherit the pattern from by copy-paste.

---

## Post-Phase-1 rulings (Claude, 2026-08-09) — settled, do not re-litigate

Phase 1 raised seven gaps. Five are routine calls and are decided here so Phase 3 does
not reopen them; the sixth (visibility) went back to the treasurer as a genuine fork.

- **(b) Draft discard — ACCEPTED.** "Discard draft" action on the proposer's own drafts,
  routed through `<ConfirmDialog destructive>` (never native `confirm()`). Without it
  drafts accumulate invisibly with no cleanup path.
- **(c) Edit-after-submit — ACCEPTED as recommended.** Editable by the proposer while
  status is `Submitted`; locks to read-only once an admin advances it to `Under Review`,
  so the board never decides on text that moved after they started reading. Chosen as
  the minimal honest rule; revisit only if the board reports friction.
- **(d) `Deferred` status — ACCEPTED, and required.** Boards defer routinely; conflating
  "come back next month" with "declined" would misrepresent real board behavior from the
  first meeting. Final status set: `Submitted / Under Review / Approved / Declined /
  Deferred`. The decision record (decider, decided-at, optional `citingMinutesId`)
  **reuses the governing-documents pattern** (`documentVersions.adoptedByUserId` /
  `adoptedAt` / `citingMinutesId`) rather than inventing a new one — nullable and
  backfillable, because minutes are not approved until the following meeting.
  The deciding-meeting date is a nullable date set when a decision is recorded — NOT a
  free-text "TBD next meeting" field, which would be unqueryable and would rot.
- **(e) Post-approval automation — OUT OF SCOPE, held firm.** An approved proposal stays
  a proposal record. It does **not** auto-create an event, a campaign, or a budget line.
  Anyone acting on it uses the existing tools by hand. Phase 3 must not grow a "convert
  to event" button. This is the single largest threat to the Sept 17 date.
- **(f) Notification fan-out — ACCEPTED.** Board is emailed on submit (`BOARD_EMAIL`,
  blocked outside production by the `isClubDistributionList` guardrail — verify via the
  email queue). The **proposer** is additionally emailed on submit (confirmation) and on
  every status transition. Sent to the proposer's own address, so the distribution-list
  guardrail does not apply and the flow is fully testable in dev. Without this the
  feature recreates the paper form's dead end electronically, which is the entire thing
  it exists to fix.
- **(g) September 17 — full scope assessed achievable** (~5.5 weeks, clean schema
  ground). If it tightens, the documented cut is `Deferred` + citing-minutes linkage,
  NOT draft-save (core to the abandonment rationale, and cheap: one boolean + one
  timestamp).

---

# Phase 2 — Architectural Review (architect)

## VERDICT

**Approved with suggestions.**

Everything Phase 1 assumed checks out against the actual codebase — `board_member` is a
real role bound to a matching pattern of view-and-decide keys, `react-hook-form` is
genuinely dead weight (installed, imported nowhere), and the governing-documents
decision pattern is real and reusable. I diverge from Phase 1 in one place worth
flagging up front: I recommend **two tables**, not one, for the decision record, because
`Deferred` is explicitly routine/repeatable and a single mutable decision-column set
would silently overwrite prior deferral history — see §6.

## 1. Directory placement

Two precedents are both real in this codebase and point different directions; I picked
the piece of each that fits.

- **Member surface → `src/app/members/proposals/`** (new flat top-level directory), NOT
  nested under `records/`. `records/` is a hub because it federates two distinct
  features (minutes + documents) behind one entry point; proposals is a single feature,
  so it belongs with the flat siblings — `members/reimbursements/`,
  `members/financial-reports/` — both of which already implement the exact "any linked
  member, no `FEATURES` gate, Server Component page + client submit form" shape this
  feature needs. `reimbursement-form.tsx`/`members/reimbursements/page.tsx` is the
  closest analog in the whole codebase (money-adjacent member-submitted request with a
  status workflow reviewed by staff) and should be read side-by-side with the Phase 3
  design doc.
  - `src/app/members/proposals/page.tsx` — Server Component, list "My Proposals"
    (drafts + submitted), mirrors `members/reimbursements/page.tsx` exactly (`auth()`,
    inline `memberId` check, no `FEATURES` gate, delegates to a query function).
  - `src/app/members/proposals/new/page.tsx` — Server Component wrapper (auth check
    only) rendering the client form.
  - `src/app/members/proposals/[id]/page.tsx` — Server Component detail/edit view,
    ownership-checked (`proposerUserId === session.user.id`) per Phase 1 Gap (a).
- **Admin surface → `src/app/(dashboard)/admin/proposals/`** (new top-level admin
  directory, new `ADMIN_NAVIGATION` entry) — not nested under an existing admin area.
  Nothing existing owns "board decisions on member-submitted ideas"; this is its own
  domain, matching how `minutes/` and `documents/` each got their own top-level admin
  directory rather than being squeezed into an existing one.
- **Lib module → new top-level pair `src/lib/proposals.ts` (pure helpers/validators, no
  DB import) + `src/lib/proposals-queries.ts` (DB-facing)** — follows DECISION-074
  Ruling 2's split, generalized to a third domain. Explicitly do **not** fold this into
  `ledger-*` (proposals aren't ledger/money-tracking, the money fields are incidental
  inputs, not accounting rows) and do not fold it into `minutes.ts`/`documents.ts`
  despite reusing their decision-record shape — reuse the *pattern*, not the *module*,
  exactly as DECISION-074 was explicit about for minutes vs. the Ledger family.
- **Components:**
  - `src/components/members/proposal-form.tsx` — client, mirrors
    `reimbursement-form.tsx`'s shape (one file, `useState` per field, `fetch` to route
    handlers, `toast` for errors).
  - `src/components/admin/proposals/` — subdirectory (matching `admin/documents/`'s
    precedent of a subdirectory once a domain has more than one admin component),
    holding the review list, detail view, and status-change control.
- Nothing here needs a `src/components/proposals/` shared-surface directory — unlike
  `campaigns`/`events`, this feature has no public-facing rendering, so there's no third
  consumer to justify a shared component tree.

## 2. Server/client split

- **`"use client"` required:** the entire submit/draft form
  (`proposal-form.tsx`) — conditional field reveal (money-gate → cost field,
  fundraising type → income field), the character-counted textarea, and autosave all
  need local state and effects. This matches `reimbursement-form.tsx`, which is 100%
  client for the same reasons (client-side validation feedback, file state). The
  admin status-change control (`admin/proposals/*`) is also client — it's a stateful
  dropdown/buttons plus (for draft-discard only, per the accepted ruling) a
  `<ConfirmDialog>`.
- **Server Components (default, no directive):** every `page.tsx` in both
  `members/proposals/` and `(dashboard)/admin/proposals/`. Each does `auth()` (+
  `hasFeature()` on the admin side), fetches data via the query module, and renders a
  client component for the interactive part — identical to
  `members/reimbursements/page.tsx` → `<ReimbursementSubmitForm>` and
  `admin/minutes/new/page.tsx` → `<MinutesForm>`.
- **Autosave — no existing precedent in this codebase, flagging explicitly.** No other
  feature debounces a save. Build it inline with `useEffect`/`setTimeout` inside
  `proposal-form.tsx` (debounced `PATCH` to the draft's own route handler) — no new
  dependency; `lodash`/any debounce package is not installed and does not need to be.
  One clarification for tech-lead to make explicit in Phase 3, not decided here: a draft
  must be a real DB row (`proposals` row with `status='Draft'`), not `localStorage` —
  Flow 2 requires "My Proposals" to show drafts across devices/sessions, which
  client-only storage can't satisfy.

## 3. Dependencies

**Confirmed: no new npm dependency.** Verified `react-hook-form` is in `package.json`
(`^7.80.0`) but `grep -rl "react-hook-form" src/` returns nothing — it is dead weight,
not an in-progress adoption. Also confirmed: no `zod` anywhere, no `"use server"`
anywhere in `src/`. Every existing form — `reimbursement-form.tsx`,
`membership-application-form.tsx`, `contact-form.tsx`, `minutes-form.tsx` — hand-rolls
`useState` + client-side validation + `fetch()` to a route handler, with the route
handler re-validating server-side. Ruling: **continue that pattern here.** Adopting
`react-hook-form` for exactly one new feature while every existing form (including the
closest analog, `reimbursement-form.tsx`) stays hand-rolled would leave two different
form idioms live in the codebase simultaneously — worse for maintainability than the
line-count savings buys, and inconsistent with dependency-evaluation criterion 1 ("is
this already solved by an existing approach in this codebase"). If the team wants to
adopt `react-hook-form` project-wide, that's a deliberate, separate architectural
decision made once, not smuggled in via whichever feature happens to need a form next.
Flagging the unused dependency itself for the next 30-day dependency review
(deployment-engineer): either remove it or adopt it on purpose — right now it's neither.

Also note: also no shadcn `Input`/`Textarea`/`Select` primitives exist in
`src/components/ui/` (it holds exactly `confirm-dialog.tsx` and `dropdown-menu.tsx`) —
every existing form uses plain Tailwind-styled native `<input>`/`<textarea>`/`<select>`
elements. `proposal-form.tsx` should do the same; there is no primitive being
reinvented because none exists to reuse.

## 4. Invariant compliance

- **Schema is source of truth:** new tables go into `src/lib/db/schema.ts` first, then a
  matching idempotent migration under `drizzle/migrations/` (next available number is
  `0084_*`, following `0083_subscriptions_view_permission.sql`) — database-admin's job
  in Phase 4, noting it here only to confirm no invariant blocker.
- **Migrations idempotent:** standard `INSERT ... SELECT ... WHERE NOT EXISTS` /
  `ON CONFLICT DO NOTHING` pattern, same as every migration since 0002 — no new pattern
  needed.
- **`FEATURES` + `hasFeature()` as the only gate:** confirmed, no environment-flag
  system introduced or needed.
- **Admin-area protection derived, not hand-maintained (DECISION-082):** the new
  `admin/proposals` directory gets a `requiredFeature: FEATURES.PROPOSALS_REVIEW` entry
  in `ADMIN_NAVIGATION` (`src/lib/permissions.ts`) so `getAdminProtectionRules()`
  derives the proxy rule automatically — no hand-written rule in `src/proxy.ts`.
- **Independent page-level gate required — this is not optional.**
  `src/lib/admin-page-feature-gates.test.ts` statically fails the build if any top-level
  segment under `src/app/(dashboard)/admin/` lacks its own `hasFeature()`/
  `hasAnyFeature()` call with a real `redirect()`. `admin/proposals/page.tsx` must call
  `auth()` + `hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW)` in its own body,
  exactly like `admin/minutes/new/page.tsx` does — the proxy is the coarse outer gate,
  never the only gate. This directory is not on the `NO_PAGE_GATE_ALLOWLIST`
  (`sync-log`, `release-notes`) and shouldn't be.
- **No native dialogs:** confirmed — the only destructive action (draft discard, Gap B)
  is already ruled to go through `<ConfirmDialog destructive>`. Status changes on the
  admin side are not destructive/irreversible in the same sense (see §6 — they're
  additive history rows) and don't need it.
- **No secrets:** no new env vars anticipated — submission/decision email reuses
  `sendEmail()` + the existing `BOARD_EMAIL` constant from `club-contacts.ts` (already
  extracted specifically so a new feature like this doesn't have to duplicate it).

## 5. The permission key

**Confirmed `board_member` is real**, not an assumption: `roles` seed row in
`drizzle/migrations/0002_roles_permissions_groups_campaigns.sql:145`, and it's the
binding target for `dues.view`, `budget.view`, `ledger.approve`, `impact.view`,
`ledger.view`, `contact.view`, and — the most direct precedent — `documents.manage` and
`minutes.manage` (via `0080_minutes_permissions.sql`). Phase 1's proposed binding
(`admin` + `board_member`) matches the exact pattern those two use.

**One key, not two — agree with Phase 1, but on a different precedent.**
`SUGGESTIONS_VIEW` is a weak analog (it's view-only; suggestions have no decide/status
workflow). The precedent that actually matches is `DOCUMENTS_MANAGE`: one key covers
both "create/author" and "review/adopt" for governing-document amendments — the same
person or role does both halves of the workflow. That generalizes cleanly to proposals:
one designated board-side role views submitted proposals *and* records the board's
decision after the meeting; there's no separation-of-duties reason to split them the way
the Ledger splits `ledger.view`/`ledger.record`/`ledger.approve` (that split exists
specifically because money movement wants a second set of eyes — a project proposal
being decided by monthly board vote doesn't share that risk profile). Minor naming note,
not a blocker: `proposals.review` is fine and matches the feature's own vocabulary, but
tech-lead could equally justify `proposals.manage` for consistency with
`documents.manage`/`minutes.manage`/`ledger.manage`'s verb. Not worth re-litigating —
pick one and move on.

## 6. Data model — two tables, append-only decision history

**Recommend two tables, diverging from what I read as Phase 1's implicit one-shot
framing.** `documentVersions` reuses `adoptedByUserId`/`adoptedAt`/`citingMinutesId` as
columns *on an already-append-only versions table* — every substantive save is a new
row, and adoption fields land on the version that becomes current. Proposals don't have
that natural append-only backbone (one proposal = one row, not one row per edit), so the
decision fields need a home of their own.

- **`proposals`** — one row per proposal. Mutable by the proposer while
  `status = 'Draft'` or `'Submitted'` (locks at `'Under Review'` per the accepted Gap
  (c) ruling). Carries a denormalized `status` column for fast list/filter queries.
- **`proposalDecisions`** (or similar name — tech-lead's call) — **append-only**, one
  row per status transition: `status`, `decidedByUserId`, `decidedAt`,
  `citingMinutesId` (nullable, backfillable — same as `documentVersions`), optional
  note. `proposals.status` is updated in the same transaction that inserts the new
  history row — the exact `currentVersionId`-on-parent / append-only-children shape
  `documentVersions` already established, generalized rather than reinvented.

**Reasoning:** Phase 1's own Gap (d) ruling states boards "meet monthly and *routinely*
defer items" and that `Deferred` was added specifically because it's not a one-time
terminal state — a proposal can be Deferred in August, come back Under Review in
September, get Deferred again, then Approved in October. A single mutable
`decidedByUserId`/`decidedAt`/`citingMinutesId` column set on `proposals` would silently
overwrite the August deferral the moment the September decision is recorded — losing
exactly the "who decided what, when" trail the governance context (board minutes,
motions, permanently-retained records) makes this club specifically care about. This
codebase already has the answer for "preserve every decision, not just the latest one"
— `documentVersions` — and generalizing that shape here is cheaper and more consistent
than inventing a new one-shot pattern that quietly loses history the first time a
proposal gets deferred twice.

## 7. Flagged from the agreed field set / rulings

One item, not a blocker but needs to be explicit in Phase 3's data model, not left to
implementation-time improvisation:

- **The "Not sure yet" tri-state on money/date/headcount fields is a schema shape, not
  just a UI affordance.** Phase 1's adversarial pass already flagged this at the UI
  level ("a checkbox that clears and disables the numeric input"); at the schema level
  it means each such field needs a paired nullable-value + boolean-unknown column (e.g.
  `estimatedCostCents: integer | null` + `estimatedCostUnknown: boolean`), not a single
  nullable column doing double duty for both "blank/invalid" and "deliberately not sure
  yet" — those are different facts and collapsing them into one `NULL` loses the
  distinction the treasurer specifically asked to preserve ("a 'not sure' routed to the
  treasurer beats an invented number"). Tech-lead should carry this into the Phase 3
  data model explicitly.

Nothing else in the agreed field set or the rulings is architecturally problematic. The
out-of-scope ruling on post-approval automation (Gap e) is architecturally sound — it
keeps this feature from reaching into `events`/`campaigns`/ledger-budget schema, which
would have been the real scope-creep risk.

## Outputs

- Work-log updated: this section, and the Per-Phase Status table's Phase 2 row.
- **DECISION-084** logged in `docs/decisions.md` — new top-level module pair, directory
  placement, single permission key, two-table append-only decision history, no new
  dependency.

## Handoff to tech-lead (Phase 3)

- Design the detailed schema for `proposals` + `proposalDecisions` (see §6), including
  the tri-state money/date/headcount columns (§7).
- Name the migration files (`0084_*` proposals table + `FEATURES` key/role-binding,
  following `0080_minutes_permissions.sql`'s two-migration shape if schema and
  permissions ship separately, or one migration if shipped together — precedent exists
  for both).
- Resolve the `proposals.review` vs `proposals.manage` naming nit (§5) — not blocking.
- Confirm with the treasurer/board the two open questions Phase 1 left genuinely open:
  (a) visibility (proposer + board-only, recommended) and (d) is already accepted so
  only (a) and the free-text-vs-date-picker question under Open Questions remain live.
- Design the draft-autosave mechanism explicitly as a debounced `PATCH` to a real DB
  row, not `localStorage` (§2).
- **(a) Visibility — TREASURER'S ANSWER, 2026-08-09: proposer + board only.** A
  submitted proposal is visible to its proposer and to `PROPOSALS_REVIEW` holders. NOT
  club-wide. Matches the existing suggestion-box precedent (`SUGGESTIONS_VIEW` gates
  submissions to admins) and protects half-formed ideas from being on display, which the
  research identifies as a submission chiller.
  **This must be enforced server-side** in the detail route/query as
  `proposerUserId === session.user.id OR hasFeature(PROPOSALS_REVIEW)` — hiding a nav
  link is not enforcement. The "my proposals" and "all proposals" list queries are
  therefore genuinely different queries, not one query with a filter toggle.

---

# Phase 3 — Technical Design (tech-lead)

## CORRECTION to Phase 2

Phase 2 §5 states `board_member` is already bound to `documents.manage` and
`minutes.manage`, citing `0080_minutes_permissions.sql` as precedent. **This is false.**
Verified directly against the production database (2026-08-09): `board_member` holds
`admin.dashboard, budget.view, campaigns.manage, contact.view, dues.view, events.create,
events.edit, events.view, groups.manage, impact.view, ledger.approve, ledger.view,
members.edit, members.view, membership.manage, reports.export, reports.view,
subscriptions.view, suggestions.view` — no `minutes.manage`, `minutes.delete`, or
`documents.manage`. Those three keys belong to `admin` and `notetaker` only. Phase 2's
underlying design conclusion (one key, "authors and reviewers are usually the same role"
reasoning borrowed from `DOCUMENTS_MANAGE`'s *shape*) is unaffected — but the *binding*
this design ships is a new, explicit grant, not a reuse of an existing pattern that
happens to already include `board_member`. The migration below binds
`FEATURES.PROPOSALS_REVIEW` explicitly to `admin` and `board_member` and assumes nothing
about any other key's bindings.

## Summary

A member-portal intake form (`/members/proposals`) replaces the paper "give it to any
Board Member" workflow with a draft-and-submit flow, a board review/decide surface
(`/(dashboard)/admin/proposals`, gated by a new `FEATURES.PROPOSALS_REVIEW` key), and
email notifications on submit and on every status change. Two new tables:
`proposals` (one row per proposal, mutable while unlocked) and `proposalDecisions`
(append-only history of every status transition, reusing the `documentVersions`
adoption-trio shape). No new npm dependency; hand-rolled forms matching
`reimbursement-form.tsx`. Six new API routes, all mutation-only — every read path is a
Server Component calling a query-module function directly, matching
`members/reimbursements/page.tsx`'s existing pattern, so there is no redundant HTTP
round-trip for data a Server Component can fetch itself.

## Permissions

**New key:** `FEATURES.PROPOSALS_REVIEW = "proposals.review"`.

`src/lib/permissions.ts`:

```ts
export const FEATURES = {
  // ...
  // Proposals features (docs/work-log/2026-08-09-project-proposal-form.md, DECISION-084)
  // One key covers both viewing submitted proposals and recording the board's
  // decision — matches DOCUMENTS_MANAGE's precedent (one role authors AND
  // adopts) rather than the Ledger's view/record/approve split, whose
  // separation-of-duties reasoning is money-specific and doesn't transfer to
  // a once-a-month board vote. Explicitly bound below to `admin` +
  // `board_member` by 0085_proposals_permissions.sql — NOT assumed to ride
  // along on any existing binding (see Phase 3's correction to Phase 2 §5).
  PROPOSALS_REVIEW: "proposals.review",
} as const;

export const FEATURE_CATEGORIES = {
  // ...
  PROPOSALS: "proposals",
} as const;

export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  // ...
  [FEATURES.PROPOSALS_REVIEW]: "View and decide project/activity proposals",
};
```

The `FEATURE_DESCRIPTIONS` string above is copied verbatim into the migration's seeded
`features.description` — database-admin must not paraphrase it.

**`ADMIN_NAVIGATION` placement — "Inbox" group, alongside Contact and Suggestions**, not
"Records" (Minutes/Governing Documents — permanent governance record with no per-item
decide workflow of its own) and not "Engagement" (admin-*authored* content: campaigns,
events, announcements). Proposals is member-submitted content triaged by staff, the same
shape as Contact and Suggestions, just with a real decide workflow layered on:

```ts
{
  label: "Inbox",
  items: [
    { name: "Contact", href: "/admin/contact", icon: "✉️", requiredFeature: FEATURES.CONTACT_VIEW },
    { name: "Suggestions", href: "/admin/suggestions", icon: "💡", requiredFeature: FEATURES.SUGGESTIONS_VIEW },
    { name: "Proposals", href: "/admin/proposals", icon: "🗂️", requiredFeature: FEATURES.PROPOSALS_REVIEW },
  ],
},
```

This is the only edit `ADMIN_NAVIGATION` needs — `getAdminProtectionRules()` (DECISION-082)
derives the `/admin/proposals*` proxy rule from this entry automatically, no hand-written
rule in `src/proxy.ts`.

**Independent page-level gate — not optional.** `src/lib/admin-page-feature-gates.test.ts`
statically fails the build if `src/app/(dashboard)/admin/proposals/page.tsx` has no
`hasFeature()`/`hasAnyFeature()` call with a real `redirect()`. It must read:

```ts
const session = await auth();
if (!session?.user?.id) redirect("/signin");
if (!(await hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW))) redirect("/access-pending");
```

— identical to `admin/minutes/new/page.tsx`'s own gate. `admin/proposals/[id]/page.tsx`
repeats the same check independently (each page gates itself; neither relies on the other
or on the proxy alone). `proposals` is not added to `NO_PAGE_GATE_ALLOWLIST`.

**Member-facing submit/draft/view-own:** no `FEATURES` gate — "linked member" only
(`session.user.memberId != null`), same as `/members/reimbursements` and
`/members/financial-reports`. A member with zero granted roles still reaches
`/members/proposals`. If `memberId` is null, the page shows an inline "your account isn't
linked to a member record yet" message (mirrors `MemberReimbursementsPage`'s exact
branch) rather than a hard redirect to `/access-pending` — `/access-pending` is reserved
for the admin-area gate.

**Role binding — `admin` + `board_member`**, via a new idempotent migration
(`0085_proposals_permissions.sql`, see Data Model), following the exact
`0083_subscriptions_view_permission.sql` DO-block shape: seed the `features` row, then
two `INSERT ... SELECT ... WHERE NOT EXISTS` binds, one per role. No other role is
touched.

## Data Model

### The "Not sure yet" tri-state — three different shapes, not one

Phase 2 flagged this as a schema question, not just UI. Three genuinely different
field types need three different treatments:

1. **Money amount** (estimated cost, estimated income) — **value + unknown pair**:
   `estimatedCostCents: integer | null` + `estimatedCostUnknown: boolean not null default false`.
   A row where `moneyNeeded = 'yes'` and *both* `estimatedCostCents IS NULL` and
   `estimatedCostUnknown = false` is an invalid submission (blank, not "not sure") —
   enforced in `validateProposalSubmission()`, not the DB.
2. **Headcount** (volunteers needed) — same value + unknown pair, integer.
3. **The money gate itself** ("will this need money from the club up front?") is not a
   value/unknown pair — it is a required three-way answer with "not sure" as one of the
   three named options, same shape as a status enum: `moneyNeeded: text not null` ∈
   `'yes' | 'no' | 'not_sure'`, DECISION-041 pattern (validated in `src/lib/proposals.ts`,
   no DB CHECK). This is the field that *gates* the cost fields' conditional reveal:
   the cost pair is only shown/validated when `moneyNeeded === 'yes'`.
4. **Proposed date** ("when would this happen") — **`date | null` + a companion
   `boolean` unknown flag**, same value+unknown shape as money/headcount, but typed
   `date` not `timestamp` — see Timestamp ruling below.

### Draft vs. submitted, and the discard path

`proposals.status` starts `'draft'` on row creation (via `POST /api/members/proposals`,
which requires nothing but a linked member — no field is validated at draft-creation
time). A draft is mutable by its proposer via `PATCH` with no required-field
enforcement. `POST .../submit` is the only path that runs full validation and flips
`'draft' → 'submitted'`; it also stamps `submittedAt` and writes the first
`proposalDecisions` row (see below). **Discard (Gap B) is a hard `DELETE`, not a
soft-delete**, and only permitted while `status = 'draft'` — a deliberate divergence from
minutes' permanent-retention rule: a draft never became a governance record (the board
never saw it, no email was ever sent), so there is nothing to retain. Routed through
`<ConfirmDialog destructive>` per the accepted Gap B ruling.

An abandoned draft (months old, never submitted, never discarded) is left alone — no
auto-expiry or cleanup job in v1. This is inert data with no governance weight; flagging
for a future data-hygiene pass rather than building it now (explicit non-goal, matches
`(e)` post-approval-automation's "don't build what wasn't asked for" discipline).

### Status enum — DECISION-041 pattern, plain text, validated in `src/lib/proposals.ts`

```ts
export const PROPOSAL_STATUSES = [
  "draft", "submitted", "under_review", "approved", "declined", "deferred",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export function isValidProposalStatus(s: string): s is ProposalStatus {
  return (PROPOSAL_STATUSES as readonly string[]).includes(s);
}
export function isProposalEditableByProposer(status: ProposalStatus): boolean {
  return status === "draft" || status === "submitted";
}
```

No DB CHECK/enum — same precedent as `minutes.kind`/`minutes.status`,
`ledger_transactions.status`, `members.membershipStatus`.

### Timestamp column choice — ruled explicitly, with evidence, not repeated by habit

Checked directly, not assumed: `psql "$DATABASE_URL" -c "\d minutes"` shows
`created_at | timestamp with time zone` — but `schema.ts`'s `minutes.createdAt` /
`updatedAt` / `approvedAt` / `pendingDeleteAt` are declared as plain `timestamp("...")`
with **no** `{ withTimezone: true }` option (drizzle's default, which maps to Postgres
`timestamp without time zone`). The live column's actual type traces to
`0079_meeting_minutes.sql`, which hand-writes `timestamptz` in raw SQL — `schema.ts` was
simply never updated to match what the migration actually created, and `drizzle-kit
push --force` has not corrected the drift on any deploy since. **This is a real,
confirmed code/DB mismatch in the codebase today, not a hypothetical risk.** By
contrast, `document_versions.createdAt`/`adoptedAt` (also plain `timestamp("...")`, no
option) *are* consistent with their live column (`timestamp without time zone` — checked
the same way), and `ledger_reimbursements.submittedAt`/`createdAt`/`updatedAt` follow the
same plain (no-tz) convention throughout.

**Ruling for `proposals`/`proposalDecisions`: every instant-in-time column is declared
`timestamp("...", { withTimezone: true })`**, matching what actually happened for
`minutes` in production rather than what its stale `schema.ts` claims, and matching the
newer, explicit convention already used elsewhere in the file (`events.startsAt`/
`endsAt`, `ledgerDonorEmails`/`ledgerAckLetterTemplates`-era tables). This closes the
naive-timestamp risk this project has already been bitten by once (see the standing
memory note on event/RSVP timestamp columns) rather than reproducing it a third time.
Affected columns: `proposals.submittedAt`, `proposals.createdAt`, `proposals.updatedAt`,
`proposalDecisions.decidedAt`, `proposalDecisions.createdAt`.

**`proposedDate`** (the "when would this happen" field) is `date`, not `timestamp` —
same reasoning as `minutes.meetingDate`: it names a calendar day a volunteer picked, not
a wall-clock instant, and typing it as `timestamp` would resurrect the exact
naive-timestamp-as-UTC bug class already documented for `eventRsvps.occurrenceDate`.

### `proposals`

```ts
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Nullable FK + name/email snapshot — same shape as
    // minutes.notetakerMemberId/notetakerNameSnapshot, not a hard cascade.
    // A hard-deleted member's already-submitted proposal is a governance
    // record (the board may have decided on it, cited it in minutes) and
    // must survive the member row's deletion. While status = 'draft' the
    // snapshot columns stay null and every read uses the live member join;
    // the snapshot is written once, by the submit action, at the moment the
    // proposal becomes board-visible — never recomputed afterward.
    proposerMemberId: uuid("proposer_member_id").references(() => members.id, { onDelete: "set null" }),
    proposerUserId: uuid("proposer_user_id").references(() => users.id, { onDelete: "set null" }),
    proposerNameSnapshot: text("proposer_name_snapshot"),
    proposerEmailSnapshot: text("proposer_email_snapshot"),
    proposerPhoneSnapshot: text("proposer_phone_snapshot"),

    // DECISION-041 pattern, validated in src/lib/proposals.ts, no DB CHECK.
    status: text("status").notNull().default("draft"),

    projectName: text("project_name"), // NOT NULL enforced at submit time only (draft rows may be blank)
    // 'fundraiser' | 'service_project' | 'both' — DECISION-041 pattern.
    type: text("type"),
    needDescription: text("need_description"), // 2-3 sentence what/why
    // "Not yet identified" is a valid literal submitted value, not a null —
    // Phase 1's treasurer ruling. Editable by the proposer while unlocked;
    // once locked (status >= under_review), only a PROPOSALS_REVIEW holder
    // may update it, via the optional `chairName` field on the decide action
    // (see API Contract) — resolves "chair named after lock" without
    // reopening the general edit-lock rule for every other field.
    chairName: text("chair_name"),

    // The money GATE — required tri-state answer, not a value/unknown pair.
    moneyNeeded: text("money_needed"), // 'yes' | 'no' | 'not_sure'

    // Conditional on moneyNeeded === 'yes'. Value + unknown pair.
    estimatedCostCents: integer("estimated_cost_cents"),
    estimatedCostUnknown: boolean("estimated_cost_unknown").notNull().default(false),

    // Conditional on type including fundraising ('fundraiser' | 'both'). Value + unknown pair.
    estimatedIncomeCents: integer("estimated_income_cents"),
    estimatedIncomeUnknown: boolean("estimated_income_unknown").notNull().default(false),

    // "When would this happen" — date, not timestamp (see ruling above). Value + unknown pair.
    proposedDate: date("proposed_date"),
    proposedDateUnknown: boolean("proposed_date_unknown").notNull().default(false),

    // "Roughly how many volunteers" — value + unknown pair.
    volunteersNeeded: integer("volunteers_needed"),
    volunteersNeededUnknown: boolean("volunteers_needed_unknown").notNull().default(false),

    clubResourcesNeeded: text("club_resources_needed"), // optional; absorbs paper form's tech/equipment item
    publicityPlan: text("publicity_plan"),               // optional; merged club+community per treasurer decision #2
    additionalNotes: text("additional_notes"),           // optional

    submittedAt: timestamp("submitted_at", { withTimezone: true }), // null while draft
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_proposals_proposer_member").on(t.proposerMemberId),
    index("ix_proposals_proposer_user").on(t.proposerUserId),
    index("ix_proposals_status").on(t.status),
  ],
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
```

Note the required-per-the-field-set columns (`projectName`, `type`, `needDescription`,
`chairName`, `moneyNeeded`) are **nullable at the DB level** — a draft is explicitly
allowed to have any or all of them blank. "Required" is enforced entirely in
`validateProposalSubmission()` at the `POST .../submit` boundary, exactly like
`ledger_reimbursements`/`minutes` enforce their own business-required fields at the
app layer rather than the DB layer.

### `proposalDecisions` — append-only, one row per transition

```ts
export const proposalDecisions = pgTable(
  "proposal_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    // The status this row transitions the proposal TO. Same vocabulary as
    // proposals.status (minus 'draft' — no decision row is ever written for
    // the draft state). The FIRST row for any submitted proposal is always
    // status='submitted', written by the submit action itself in the same
    // transaction as the proposals.status flip — this keeps one unified,
    // complete timeline instead of special-casing the first transition.
    status: text("status").notNull(),
    // Nullable + set-null, same attribution convention as every other
    // *_user_id column in this schema (minutes.authorUserId,
    // documentVersions.adoptedByUserId). For the initial 'submitted' row
    // this is the proposer's own user id (a self-transition, not a board
    // decision) — same column, no separate "submitted by" column needed.
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    // Backfillable — same pattern as documentVersions.citingMinutesId. Board
    // decisions happen at a meeting whose minutes aren't written until the
    // NEXT meeting; this column is null at decision time and filled in later
    // via PATCH /api/admin/proposals/[id]/decisions/[decisionId].
    citingMinutesId: uuid("citing_minutes_id").references(() => minutes.id, { onDelete: "set null" }),
    note: text("note"), // optional free text, e.g. "tabled pending updated budget"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ix_proposal_decisions_proposal").on(t.proposalId),
    index("ix_proposal_decisions_status").on(t.status),
  ],
);

export type ProposalDecision = typeof proposalDecisions.$inferSelect;
export type NewProposalDecision = typeof proposalDecisions.$inferInsert;
```

`proposals.status` is a **denormalized "current" convenience column**, updated in the
same DB transaction as every `proposalDecisions` insert — exactly the
`currentVersionId`-on-parent / append-only-children shape `documents`/`documentVersions`
already established (and, per DECISION-081, deliberately with **no** DB-level FK from
`proposals` back to "its latest decision" — there is nothing to point at; the parent only
carries a plain `status` value, so DECISION-081's circular-FK problem does not recur here
and no `.references()` omission decision is needed).

### Migration files

Two migrations, following the `0079`/`0080` (minutes) and `0081`/`0082` (documents)
two-file shape — schema, then permissions:

**`drizzle/migrations/0084_proposals.sql`** (schema):

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_member_id          uuid        REFERENCES members(id) ON DELETE SET NULL,
  proposer_user_id            uuid        REFERENCES users(id) ON DELETE SET NULL,
  proposer_name_snapshot      text,
  proposer_email_snapshot     text,
  proposer_phone_snapshot     text,
  status                      text        NOT NULL DEFAULT 'draft',
  project_name                text,
  type                        text,
  need_description            text,
  chair_name                  text,
  money_needed                text,
  estimated_cost_cents        integer,
  estimated_cost_unknown      boolean     NOT NULL DEFAULT false,
  estimated_income_cents      integer,
  estimated_income_unknown    boolean     NOT NULL DEFAULT false,
  proposed_date                date,
  proposed_date_unknown       boolean     NOT NULL DEFAULT false,
  volunteers_needed           integer,
  volunteers_needed_unknown   boolean     NOT NULL DEFAULT false,
  club_resources_needed       text,
  publicity_plan               text,
  additional_notes            text,
  submitted_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_decisions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  status              text        NOT NULL,
  decided_by_user_id  uuid        REFERENCES users(id) ON DELETE SET NULL,
  decided_at          timestamptz NOT NULL DEFAULT now(),
  citing_minutes_id   uuid        REFERENCES minutes(id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_proposer_member') THEN
    CREATE INDEX ix_proposals_proposer_member ON proposals(proposer_member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_proposer_user') THEN
    CREATE INDEX ix_proposals_proposer_user ON proposals(proposer_user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposals_status') THEN
    CREATE INDEX ix_proposals_status ON proposals(status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposal_decisions_proposal') THEN
    CREATE INDEX ix_proposal_decisions_proposal ON proposal_decisions(proposal_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ix_proposal_decisions_status') THEN
    CREATE INDEX ix_proposal_decisions_status ON proposal_decisions(status);
  END IF;
END $$;
```

(database-admin: sequence after `minutes` exists, since `proposal_decisions.citing_minutes_id`
references it — same ordering constraint `documentVersions` had.)

**`drizzle/migrations/0085_proposals_permissions.sql`** (permissions), same DO-block shape
as `0083_subscriptions_view_permission.sql`:

```sql
DO $$ BEGIN
  INSERT INTO features (name, category, description)
  SELECT 'proposals.review', 'proposals', 'View and decide project/activity proposals'
  WHERE NOT EXISTS (SELECT 1 FROM features WHERE name = 'proposals.review');

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'admin' AND f.name = 'proposals.review'
  AND NOT EXISTS (SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id);

  INSERT INTO role_features (role_id, feature_id)
  SELECT r.id, f.id FROM roles r CROSS JOIN features f
  WHERE r.name = 'board_member' AND f.name = 'proposals.review'
  AND NOT EXISTS (SELECT 1 FROM role_features rf WHERE rf.role_id = r.id AND rf.feature_id = f.id);
END $$;
```

The `description` string here is byte-for-byte identical to `FEATURE_DESCRIPTIONS`'s
entry above — this is what "must match the migration's seeded text exactly" means in
practice; a paraphrase would still work functionally but would fail the intent of the
brief and confuse anyone reading `/admin/permissions`.

## API Contract

All six routes are mutation-only. Every read (list-mine, list-for-review, detail-with-
visibility-check) is a Server Component calling `src/lib/proposals-queries.ts` directly —
no HTTP round-trip for data the rendering Server Component can fetch itself, matching
`members/reimbursements/page.tsx` → `listReimbursementsForMember()`.

1. **`POST /api/members/proposals`** — create a new draft.
   - Auth: `auth()`; requires `session.user.memberId` (linked member; no `FEATURES` gate).
   - Body: `{}` or any subset of the optional/required field names (client may send
     whatever the form currently holds on first autosave tick).
   - Server sets `status='draft'`, `proposerMemberId`/`proposerUserId` from the session —
     **never** client-writable, closing the state-machine-shortcut adversarial finding.
   - Response `201`: `{ proposal: Proposal }`.

2. **`PATCH /api/members/proposals/[id]`** — autosave / manual edit / explicit "Save Draft".
   - Auth + ownership: `proposal.proposerUserId === session.user.id`, else `404` (not
     `403` — enumeration resistance, per the Adversarial Pass).
   - Allowed only while `isProposalEditableByProposer(proposal.status)` (`draft` or
     `submitted`); otherwise `409` with a plain message ("This proposal is locked for
     review and can no longer be edited").
   - Body: partial field merge. Per-field shape validation only (e.g.
     `estimatedCostCents` must be a non-negative integer if present); **no**
     required-field completeness check here — that is `submit`'s job.
   - `status` is never accepted in this body — attempting to set it is ignored/stripped
     server-side, not merely unused by the client.
   - Response `200`: `{ proposal: Proposal }`.

3. **`POST /api/members/proposals/[id]/submit`** — `draft → submitted`.
   - Auth + ownership, same `404`-not-`403` rule.
   - `409` if `status !== 'draft'` (idempotency guard against a double-click/retry
     re-emailing the board).
   - Runs `validateProposalSubmission()` — the 5 required fields (`projectName`, `type`,
     `needDescription`, `chairName`, `moneyNeeded`) plus the money/date/headcount
     tri-state coherence rule (`moneyNeeded==='yes'` requires either
     `estimatedCostCents` or `estimatedCostUnknown=true`, never neither). A failure
     returns `422` with a field-keyed error map (`{ errors: { chairName: "..." } }`) —
     never a bare 400/500 — the client re-renders the same in-progress form with the
     entered data intact, per Phase 1's Flow 1 failure note.
   - On success, in one DB transaction: snapshot `proposerNameSnapshot`/
     `proposerEmailSnapshot`/`proposerPhoneSnapshot` from the live member row, set
     `status='submitted'`, `submittedAt=now()`, insert the first `proposalDecisions` row
     (`status='submitted'`, `decidedByUserId=proposerUserId`, `decidedAt=submittedAt`).
   - After commit (never inside the transaction, and never blocking the response — see
     Edge Cases): `sendEmail()` to `BOARD_EMAIL` and to the proposer's snapshot email.
   - Response `200`: `{ proposal: Proposal }`.

4. **`DELETE /api/members/proposals/[id]`** — discard a draft.
   - Auth + ownership, `404`-not-`403`.
   - `409` if `status !== 'draft'`.
   - Hard `DELETE FROM proposals WHERE id = ...` (cascades to `proposal_decisions`, which
     is always empty for a draft — no decision row exists until submit).
   - Response `204`.

5. **`POST /api/admin/proposals/[id]/decide`** — board decision.
   - Auth + `hasFeature(session.user.id, FEATURES.PROPOSALS_REVIEW)`, else `redirect`
     (page-level) / `403` (route-level, since this is an authenticated-but-unauthorized
     case, not an existence-hiding one — the proposal's existence isn't secret from other
     `PROPOSALS_REVIEW` holders the way it is from the general membership).
   - `404` if `proposal.status === 'draft'` (drafts are never board-visible; defense in
     depth even though the admin list query already excludes them).
   - Body: `{ status: 'under_review' | 'approved' | 'declined' | 'deferred', note?: string, chairName?: string }`.
   - `409` if `status === proposal.status` (same-status-transition guard — no duplicate
     decision row, no duplicate proposer email). Any *other* transition is allowed,
     including revisiting a prior status (`deferred → under_review → deferred` again) —
     status is not a one-way terminal state; boards routinely reconsider.
   - In one transaction: insert the `proposalDecisions` row (`decidedByUserId =
     session.user.id`), update `proposals.status`, and — only if `chairName` was
     supplied — update `proposals.chairName` on the parent row (the one field a
     `PROPOSALS_REVIEW` holder may edit directly, resolving "chair named after lock").
   - After commit: `sendEmail()` to the proposer (snapshot email, falling back to a live
     member lookup by `proposerMemberId` if present — best-effort either way; see Edge
     Cases).
   - Response `200`: `{ proposal: Proposal, decision: ProposalDecision }`.

6. **`PATCH /api/admin/proposals/[id]/decisions/[decisionId]`** — backfill citing minutes.
   - Auth + `hasFeature(PROPOSALS_REVIEW)`.
   - Body: `{ citingMinutesId: string }`.
   - Updates only `citingMinutesId` on the named `proposalDecisions` row (must belong to
     `proposalId`). No email — this is a quiet record-keeping update, same as
     `documentVersions`'s citing-minutes backfill.
   - Response `200`: `{ decision: ProposalDecision }`.

**Total: 6 route handlers**, 0 read/GET routes.

## Email

Three distinct sends, all via the existing `sendEmail()` — no new email infrastructure.

**On submit (`POST .../submit`):**

1. **Board notification** — `to: BOARD_EMAIL`, `subject: "New Project/Activity Proposal: {projectName}"`. HTML: proposer name, project name, type, need description, chair (as entered, including "Not yet identified" verbatim — the board should see that literally, not a euphemism), the money answer (plus cost if given, or "not sure" if flagged), proposed date (or "not sure yet"), a link to `{NEXTAUTH_URL}/admin/proposals/{id}`. Outside `production`, `isClubDistributionList()` blocks actual delivery (queues with `status='blocked_non_production'`, returns `{success:true}`) — this is deliberate and must not be weakened; verify via the `email_queue` table, never by checking an inbox in dev.
2. **Proposer confirmation** — `to:` the just-captured `proposerEmailSnapshot`, `subject: "We've received your proposal: {projectName}"`. HTML: a short summary of what they submitted, plain-language expectation ("the board reviews proposals at its next meeting; we'll email you when there's an update"), a link to `{NEXTAUTH_URL}/members/proposals/{id}`. Not a distribution list — always actually delivered in every environment, testable end-to-end in dev without hitting the club's real list.

**On every decision (`POST .../decide`):**

3. **Proposer status update** — `to:` the proposal's email (snapshot, or a fresh live lookup if `proposerMemberId` still resolves — best-effort, not required to succeed), `subject: "Update on your proposal: {projectName} — {StatusLabel}"` where `StatusLabel` ∈ `{"Now Under Review", "Approved", "Declined", "Deferred"}`. HTML: the new status, the reviewer's optional `note` if supplied, a link to `{NEXTAUTH_URL}/members/proposals/{id}`.

**Email failure never blocks the underlying action.** `sendEmail()` already queues the row before attempting delivery and returns `{success:false, error}` rather than throwing on final failure (existing retry/backoff behavior, unchanged). The submit/decide route handlers `await` the call for logging purposes only — a failed send does not roll back the transaction, does not change the HTTP status code returned to the caller, and does not surface as an error to the member or reviewer. This is existing `email_queue` infrastructure (retry endpoint), not something this feature needs to build.

## Component Plan

**Member-facing** (mirrors `reimbursement-form.tsx`'s shape throughout — hand-rolled `useState` + `fetch`, no `react-hook-form`, no shadcn `Input`/`Select` primitives since none exist in this codebase):

- `src/app/members/proposals/page.tsx` (Server Component) — "My Proposals" list via `listMyProposals(session.user.id)`; sections for drafts / submitted+in-review / decided; `StatusBadge`; empty state (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "You haven't proposed a project yet — click Start a Proposal above"); no-linked-member inline message (mirrors reimbursements).
- `src/app/members/proposals/new/page.tsx` (Server Component) — auth-only wrapper rendering `<ProposalForm>` with no initial id.
- `src/app/members/proposals/[id]/page.tsx` (Server Component) — detail/edit. `getProposalById(id, { viewerUserId: session.user.id, viewerHasReviewAccess: false })`; not-owner → `notFound()`. Unlocked (`draft`/`submitted`) → `<ProposalForm>` pre-filled and editable. Locked → read-only detail + `<ProposalStatusTimeline>` rendering the `proposalDecisions` history.
- `src/components/members/proposal-form.tsx` ("use client") — single scrolling page, three sections (Project Basics / Money & Timeline / Support & Publicity). Conditional reveal: `moneyNeeded==='yes'` → cost pair; `type` includes fundraising → income pair. Debounced autosave (~2s, `useEffect`/`setTimeout`, no new dependency, matching Phase 2's ruling) `PATCH`ing the draft's own route once an id exists (first meaningful edit fires the `POST` that mints the id). Explicit "Save Draft" button forces an immediate flush. "Submit Proposal" button calls `POST .../submit`, mirrors server validation client-side for instant feedback but treats the server's `422` field-error map as authoritative. "Discard Draft" (draft only) → `<ConfirmDialog destructive>`. Radio buttons (not `<select>`) for `type` and `moneyNeeded` per the accessibility research; 16px+ body text; 44px+ tap targets on all primary controls; every required field labeled with the literal word "Required".
- `src/components/members/proposal-status-timeline.tsx` — plain function component (no client directive needed — server-renderable), lists `proposalDecisions` rows oldest→newest, mirrors the governing-documents version-history list's visual shape.

**Admin-facing:**

- `src/app/(dashboard)/admin/proposals/page.tsx` (Server Component) — own `auth()` + `hasFeature(PROPOSALS_REVIEW)` gate; `listSubmittedProposalsForReview()` (excludes drafts); table/list with status filter; empty state.
- `src/app/(dashboard)/admin/proposals/[id]/page.tsx` (Server Component) — same independent gate; `getProposalById(id, { viewerHasReviewAccess: true })`; full detail (every field, unredacted) + `<ProposalDecisionPanel>`.
- `src/components/admin/proposals/proposal-review-table.tsx` ("use client" — status filter is local UI state) — list view, links to detail.
- `src/components/admin/proposals/proposal-decision-panel.tsx` ("use client") — target-status `<select>` (a `<select>` is fine here, unlike the submission form — this audience is a handful of tech-comfortable board members, not the accessibility-research target), optional note textarea, optional `chairName` override input (shown only when `proposal.chairName === 'Not yet identified'`), optional citing-minutes picker (reuse the pattern from `admin/documents` if a shared picker component exists there; otherwise a simple `<select>` of recent `kind='board'` minutes). No `<ConfirmDialog>` needed for a status change — not destructive/irreversible in the same sense minutes/documents use it (Phase 2 §4, confirmed unchanged).

**Lib** (DECISION-084's split, generalized to a third domain — not folded into `ledger-*` or `minutes.ts`):

- `src/lib/proposals.ts` (pure, no DB import) — `PROPOSAL_STATUSES`/`PROPOSAL_TYPES`/`MONEY_NEEDED_VALUES` consts + validators, `isProposalEditableByProposer()`, `isNoOpDecision()`, `proposalVisibleTo({ proposerUserId, viewerUserId, viewerHasReviewAccess })`, `validateProposalSubmission()`, the tri-state coherence checks, `proposalStatusLabel()`, `proposalDecisionEmailSubject()`.
- `src/lib/proposals-queries.ts` (DB-facing) — `createDraftProposal()`, `updateProposal()`, `submitProposal()` (transactional), `discardDraftProposal()`, `listMyProposals(userId)`, `listSubmittedProposalsForReview()`, `getProposalById(id, opts)`, `decideProposal()` (transactional), `backfillDecisionCitingMinutes()`.

## Implementation Order

Specialist split (schema + API + UI, all present) — not `full-stack-developer`, per
CLAUDE.md's own threshold ("~< 150 lines across API + UI"); this is well past that.

1. **database-admin** — `schema.ts` (`proposals`, `proposalDecisions`), `0084_proposals.sql`, `FEATURES.PROPOSALS_REVIEW` + `FEATURE_DESCRIPTIONS` + `FEATURE_CATEGORIES.PROPOSALS` + the `ADMIN_NAVIGATION` "Inbox" entry, `0085_proposals_permissions.sql` (the `add-permission` skill covers the permissions half of this step). Run `pnpm db:migrate` against dev, verify via `psql` that `admin`/`board_member` hold `proposals.review` and no other role does.
2. **api-developer** — `src/lib/proposals.ts`, `src/lib/proposals-queries.ts`, all 6 route handlers, the 3 `sendEmail()` call sites, and **the unit tests named below** (Phase 4's gate — these ship with this step, not later).
3. **ux-developer** — all member and admin pages/components listed above, wired to the 6 routes.

## Edge Cases & Risks

- **Proposer's member record deleted.** `proposerMemberId`/`proposerUserId` are nullable + `ON DELETE SET NULL` (not cascade); `proposerNameSnapshot`/`Email`/`PhoneSnapshot` are written once at submit time and never recomputed, so an already-submitted proposal's board-visible content and contact trail survive the member row's deletion. A still-`draft` proposal whose owning member is deleted becomes an orphaned, unreachable, harmless row (no snapshot was ever written, nobody's session can match a null `proposerUserId`) — accepted as inert dead data, not cleaned up in v1.
- **A draft abandoned for months.** No auto-expiry. Explicit non-goal, same reasoning as the orphaned-draft case above.
- **Two board members deciding simultaneously.** No additional DB locking beyond the transaction. Both `POST .../decide` calls can each pass the same-status guard and each insert a legitimate `proposalDecisions` row; `proposals.status` reflects whichever transaction commits last. Both decision rows persist — the append-only table is the honest record of "what happened," and a rare double-decision is a board-process question (two people should coordinate), not a data-integrity bug this design needs to prevent.
- **A status transition to the same status.** Rejected with `409` before any row is written — no duplicate `proposalDecisions` row, no duplicate proposer email.
- **Chair "Not yet identified," named later.** While unlocked (`draft`/`submitted`), the proposer edits `chairName` themselves via the ordinary autosave `PATCH`. Once locked, only a `PROPOSALS_REVIEW` holder can update it, via the optional `chairName` field on `POST .../decide` — not a reopening of the general edit-lock rule.
- **Email send failure.** Never blocks the submit or decide action — `sendEmail()` is awaited after the DB transaction commits, for logging only; its result never changes the HTTP response or rolls back the write. Retry is the existing `email_queue` admin-retry path.
- **Enumeration.** A non-owner, non-`PROPOSALS_REVIEW` member requesting `/api/members/proposals/[id]` (any method) or the `[id]` page gets `404`, identical to a nonexistent id — never a `403` that would confirm existence.
- **Board decides on a proposal that's still a draft** (a manipulated request guessing an id). Blocked twice over: `listSubmittedProposalsForReview()` never returns drafts, and `POST .../decide` independently 404s on `status==='draft'`.

## Out of Scope (restated, unchanged from Phase 1/2)

- Auto-creating an event, campaign, or budget line from an approved proposal.
- Any public/anonymous-visitor view of proposals.
- The Volunteer Response Form (separate, related motion).
- Co-authoring or chairperson-as-editor — only the proposer or a `PROPOSALS_REVIEW` holder can ever write to a proposal.
- Draft auto-expiry / cleanup tooling.

## Required Unit Tests (implementer delivers these, not qa)

All in `src/lib/proposals.test.ts` (pure module, no DB — `vitest.config.ts` already runs `environment: "node"`, same as `minutes.test.ts`'s precedent):

1. `isValidProposalStatus()` — accepts all 6 values, rejects arbitrary strings.
2. `isValidProposalType()` / money-needed validator — accepts the exact enum values, rejects near-misses (`"Fundraiser"` capitalized, `"maybe"`, empty string).
3. `isProposalEditableByProposer()` — `true` for `draft`/`submitted`, `false` for `under_review`/`approved`/`declined`/`deferred`.
4. `proposalVisibleTo()` — owner-true, reviewer-true, neither-false, and the boundary case of a `proposerUserId` that is `null` (deleted account) always resolving to `false` for every non-reviewer viewer.
5. `validateProposalSubmission()` — each of the 5 required fields individually missing produces a field-keyed error naming that field; `chairName: "Not yet identified"` is accepted, not treated as blank; a fully-populated minimal submission passes with no errors.
6. Tri-state coherence — `moneyNeeded==='yes'` with `estimatedCostCents=null` and `estimatedCostUnknown=false` fails; the same state with `estimatedCostUnknown=true` passes; `moneyNeeded==='no'`/`'not_sure'` never requires the cost pair at all regardless of its values.
7. `isNoOpDecision()` — `true` only when target status equals current status; `false` for every other pair, including a status repeating a *prior* (non-consecutive) value (e.g. `deferred` again after an intervening `under_review`).

No new work needed in `src/lib/admin-page-feature-gates.test.ts` — it is a generic, already-existing static suite that automatically covers `admin/proposals/page.tsx` the moment the directory exists with its own `hasFeature()` call; nothing proposals-specific to add there.

## Outputs

- This section + the Per-Phase Status table's Phase 3 row (`docs/work-log/2026-08-09-project-proposal-form.md`).
- No new `docs/decisions.md` entry — this design doc implements DECISION-084's already-logged architecture without deviating from any of its rulings (the Phase 2 correction above is a factual fix to that entry's supporting text, not a new decision).

## Handoff to Phase 4

**Use the specialist split, in order: database-admin → api-developer → ux-developer.**

- **database-admin**: schema + both migrations (`0084_proposals.sql`, `0085_proposals_permissions.sql`) + the `permissions.ts` edits (FEATURES/FEATURE_DESCRIPTIONS/FEATURE_CATEGORIES/ADMIN_NAVIGATION). Confirm via `psql` that only `admin` and `board_member` hold `proposals.review` post-migration — do not assume any existing binding.
- **api-developer**: `src/lib/proposals.ts` + `src/lib/proposals-queries.ts` + the 6 route handlers + the 3 email call sites + all 7 named unit tests.
- **ux-developer**: both page trees, `proposal-form.tsx`, `proposal-status-timeline.tsx`, `proposal-review-table.tsx`, `proposal-decision-panel.tsx`.

Open question carried forward for the treasurer/board, not resolved here (Phase 1 Open
Question, unaddressed by any ruling since): whether the deciding-meeting date should be
visible anywhere as a distinct "meeting date" separate from `decidedAt`'s timestamp — this
design uses `decidedAt` alone (a real instant, per the accepted Gap (d) ruling) and does
not add a separate free-text or date-picker "meeting date" field. If the board specifically
wants a calendar date distinct from the recording timestamp, that's a small additive
column on `proposalDecisions`, not a redesign — flagging so it isn't silently dropped.

## Post-Phase-3 ruling (Claude, 2026-08-09)

**Deciding meeting date — SETTLED: a distinct nullable `date` column on
`proposalDecisions`, separate from `decidedAt`.** Phase 3 left this open for the
treasurer; it was in fact already answered by binding decision #3, which specifies
"status … plus **the deciding meeting date**."

They are genuinely different facts and must not be collapsed:
- `decidedAt` = when the decision was *recorded in the app* (an instant, timestamptz).
- `meetingDate` = the calendar day of the board meeting that actually decided it (a
  `date`, same reasoning as `minutes.meetingDate` — a meeting belongs to a calendar day,
  not a wall-clock instant, per DECISION-001).

They diverge in the ordinary case: the board meets, and someone records the outcome days
later. Nullable because a decision may be recorded before the meeting date is confirmed,
and backfillable for the same reason `citingMinutesId` is.

---

## Phase 4 — Implementation (schema) — 2026-08-09

**Owner:** database-admin
**Status:** complete

### Summary

Implemented the `proposals` and `proposalDecisions` tables in `schema.ts` exactly as
Phase 3 specified (including the post-Phase-3 `meetingDate` ruling on
`proposalDecisions`, distinct from `decidedAt`), plus the two migrations Phase 3 named
(`0084_proposals.sql`, `0085_proposals_permissions.sql`), and the `FEATURES.PROPOSALS_REVIEW`
key + description + `ADMIN_NAVIGATION` "Inbox" entry in `src/lib/permissions.ts`. Applied
both migrations to the dev database twice in a row to prove idempotency, and verified
directly via `psql` that only `admin` and `board_member` hold `proposals.review`.

### What I did

- Added `proposals` and `proposalDecisions` table definitions to
  `src/lib/db/schema.ts`, appended after `documentVersions` — including the tri-state
  value+unknown column pairs (`estimatedCostCents`/`estimatedCostUnknown`,
  `estimatedIncomeCents`/`estimatedIncomeUnknown`, `proposedDate`/`proposedDateUnknown`,
  `volunteersNeeded`/`volunteersNeededUnknown`), the plain `moneyNeeded` tri-state gate
  column (`'yes' | 'no' | 'not_sure'`, DECISION-041 pattern, no DB enum/CHECK), the
  proposer nullable-FK + snapshot columns, and `Proposal`/`NewProposal`/
  `ProposalDecision`/`NewProposalDecision` `$inferSelect`/`$inferInsert` exports.
- Every instant-in-time column (`submittedAt`, `createdAt`, `updatedAt` on `proposals`;
  `decidedAt`, `createdAt` on `proposalDecisions`) is declared
  `timestamp("...", { withTimezone: true })`, per Phase 3's verified ruling — not
  reproducing the confirmed `minutes` schema/DB drift. `proposedDate` and the new
  `meetingDate` column are `date`, not `timestamp`.
- Added `meetingDate: date("meeting_date")` (nullable) to `proposalDecisions`, per the
  post-Phase-3 ruling — distinct from `decidedAt`, same reasoning as `minutes.meetingDate`.
- Wrote `drizzle/migrations/0084_proposals.sql` — `CREATE TABLE IF NOT EXISTS` for both
  tables (sequenced after `minutes`, since `proposal_decisions.citing_minutes_id`
  references it), plus a guarded `DO $$ ... END $$` block creating all 5 indexes only if
  not already present.
- Wrote `drizzle/migrations/0085_proposals_permissions.sql` — seeds the `proposals.review`
  feature (`WHERE NOT EXISTS`) with description text copied verbatim from
  `FEATURE_DESCRIPTIONS`, and binds it to `admin` and `board_member` only, each via
  `INSERT ... SELECT ... WHERE NOT EXISTS`, following `0083_subscriptions_view_permission.sql`'s
  exact shape. No other role touched.
- Added `FEATURES.PROPOSALS_REVIEW = "proposals.review"` (with the doc-comment explaining
  the Phase 3 correction — `board_member` does NOT ride along on `documents.manage`/
  `minutes.manage`), `FEATURE_CATEGORIES.PROPOSALS = "proposals"`, and the
  `FEATURE_DESCRIPTIONS` entry (`"View and decide project/activity proposals"` — verified
  byte-identical to the migration's seeded description) to `src/lib/permissions.ts`.
- Added the `ADMIN_NAVIGATION` "Inbox" group entry (`{ name: "Proposals", href:
  "/admin/proposals", icon: "🗂️", requiredFeature: FEATURES.PROPOSALS_REVIEW }`), placed
  after Suggestions, per Phase 3's placement ruling.

### Outputs

- Schema: `src/lib/db/schema.ts` — `proposals`, `proposalDecisions` tables +
  `Proposal`/`NewProposal`/`ProposalDecision`/`NewProposalDecision` type exports.
- Migrations: `drizzle/migrations/0084_proposals.sql` (tables + indexes),
  `drizzle/migrations/0085_proposals_permissions.sql` (feature + role bindings). Both
  confirmed idempotent (see below); `0084`/`0085` were free (highest existing was `0083`
  at the time of checking, immediately before writing these files).
- Permissions: `src/lib/permissions.ts` — `FEATURES.PROPOSALS_REVIEW`,
  `FEATURE_CATEGORIES.PROPOSALS`, `FEATURE_DESCRIPTIONS[FEATURES.PROPOSALS_REVIEW]`,
  `ADMIN_NAVIGATION` "Inbox" entry for Proposals.
- Tables affected: new tables only (`proposals`, `proposal_decisions`); no existing
  table altered.
- Role bindings added: `proposals.review` → `admin`, `proposals.review` → `board_member`
  (each `INSERT ... SELECT ... WHERE NOT EXISTS`). Verified post-migration via
  `psql "$DATABASE_URL"`:
  ```
       role     |     feature      
   --------------+------------------
    admin        | proposals.review
    board_member | proposals.review
  (2 rows)
  ```
  No other role holds `proposals.review`.
- Local apply command used (dev only — `PROD_DATABASE_URL` in `.env.local` was explicitly
  `unset` for this session so it could not become the default target):
  `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && unset PROD_DATABASE_URL DB_URL && pnpm db:migrate`

### Idempotency proof

Ran `pnpm db:migrate` against dev twice in a row with the command above.

- **Run 1:** `0084_proposals.sql` and `0085_proposals_permissions.sql` both applied
  cleanly; `✅ Migrations completed successfully`.
- **Run 2:** same command, same target. Output showed Postgres `NOTICE` (not error)
  `relation "proposals" already exists, skipping` and `relation "proposal_decisions"
  already exists, skipping` for `0084`; `0085` re-ran its `INSERT ... SELECT ... WHERE
  NOT EXISTS` statements with no new rows inserted (confirmed no duplicate
  `role_features` rows via the `psql` query above — still exactly 2 rows). Final line:
  `✅ Migrations completed successfully`. No errors on either run.

### Other verification

- `pnpm exec tsc --noEmit` — clean, no errors.
- `pnpm test` — 74 files / 1371 tests, all passed (no proposals-specific tests exist
  yet — those are api-developer's Phase 4 deliverable per the design doc's Required Unit
  Tests section, not schema's).
- Verified live column types via `psql \d proposals` / `\d proposal_decisions`: all
  instant columns are `timestamp with time zone`; `proposed_date` and `meeting_date` are
  `date`. Matches the schema.ts declarations exactly.
- Verified `getAdminProtectionRules()` derives the expected rule for the new nav entry
  (ran a one-off `tsx` check against `src/lib/permissions.ts`):
  ```
  [{ "segment": "proposals", "pattern": {}, "requiredFeatures": ["proposals.review"] }]
  ```
  Confirms the `/admin/proposals` proxy rule is derived automatically from
  `ADMIN_NAVIGATION`, per DECISION-082 — no hand-written rule needed in `src/proxy.ts`.

### Open questions / handoff notes

- **New tables available to api-developer:** `proposals` (Drizzle export: `proposals`,
  types `Proposal`/`NewProposal`) and `proposalDecisions` (export: `proposalDecisions`,
  types `ProposalDecision`/`NewProposalDecision`), both in `src/lib/db/schema.ts`.
- **Foreign keys:** `proposals.proposerMemberId` → `members.id` (SET NULL),
  `proposals.proposerUserId` → `users.id` (SET NULL); `proposalDecisions.proposalId` →
  `proposals.id` (CASCADE), `proposalDecisions.decidedByUserId` → `users.id` (SET NULL),
  `proposalDecisions.citingMinutesId` → `minutes.id` (SET NULL).
- `proposalDecisions.meetingDate` (nullable `date`) is now available for the `decide`
  route handler and the citing-minutes-backfill route to accept/update, per the
  post-Phase-3 ruling — Phase 3's original API Contract section (written before that
  ruling landed) does not mention it explicitly in the `POST .../decide` body shape;
  api-developer should treat it as an optional field alongside `citingMinutesId` on both
  `POST /api/admin/proposals/[id]/decide` and the backfill `PATCH` route, since both are
  "record something learned after the fact about a decision" operations.
- Status vocabulary (`draft`/`submitted`/`under_review`/`approved`/`declined`/`deferred`)
  and all conditional-field business rules are enforced only in application code
  (`src/lib/proposals.ts`, api-developer's deliverable) — no DB CHECK/enum exists, per
  DECISION-041 convention and Phase 3's explicit instruction.
- **Next agent: api-developer.** Build `src/lib/proposals.ts` + `src/lib/proposals-queries.ts`
  + the 6 route handlers + the 3 `sendEmail()` call sites + the 7 named unit tests in
  `src/lib/proposals.test.ts`, per Phase 3's Component Plan and Required Unit Tests
  sections.

---

## Phase 4 — Implementation (API) — 2026-08-09

**Owner:** api-developer
**Status:** complete

### Summary

Built the full server-side surface for proposals: the pure business-logic module, the
DB-facing query/mutation module, all 6 route handlers named in Phase 3's API Contract, the
3 `sendEmail()` call sites, and all 7 unit tests Phase 3 named — 28 new tests, all passing
(`pnpm test`: 75 files / 1399 tests, up from database-admin's 74/1371 baseline). Accepted
`proposalDecisions.meetingDate` as an optional field on both `POST .../decide` and the
citing-minutes backfill `PATCH` route, per the carry-forward note. Verified the full flow —
create draft → validation-failure submit (422) → tri-state-coherence rejection (400) →
valid submit (200) → edit-lock (409) → board decide with same-status guard (409) and a
chair-name override → citing-minutes/meeting-date backfill → draft discard (204, then 404
on retry) — against the dev server with a temporary test member+user account, then deleted
that test data. Confirmed via `psql` that the submit flow queues exactly the expected
`email_queue` rows: the board notification shows `blocked_non_production` (the
non-prod distribution-list guardrail firing correctly, not weakened), and both the
proposer-confirmation and the two decision-status emails show `sent` with the exact
subject lines Phase 3's Email contract specifies (including "— Now Under Review").

### What I did

- **`src/lib/proposals.ts`** (pure, no DB import — only a type-only import of `NewProposal`
  from `@/lib/db/schema`, which itself has zero runtime imports beyond
  `drizzle-orm/pg-core`, so this doesn't break the "importable without `DATABASE_URL` set"
  contract `pnpm test` depends on): `PROPOSAL_STATUSES`/`isValidProposalStatus`,
  `DECISION_TARGET_STATUSES`/`isValidDecisionTargetStatus` (the 4 statuses a board decision
  may target — excludes `draft` and `submitted`, since the latter's decision row is written
  by `submitProposal()`, not `decideProposal()`), `PROPOSAL_TYPES`/`isValidProposalType`,
  `MONEY_NEEDED_VALUES`/`isValidMoneyNeeded`, `isProposalEditableByProposer()`,
  `isNoOpDecision()`, `proposalVisibleTo()`, `validateProposalSubmission()`,
  `checkTriStateCoherence()`, `isValidDateString()`, `proposalStatusLabel()`,
  `proposalDecisionEmailSubject()`, and `parseProposalBody()` — the shared per-field
  shape/length/tri-state-coherence parser used by both the POST-create and PATCH-update
  routes, so the two routes don't duplicate ~150 lines of field validation.
- **`src/lib/proposals-queries.ts`** (DB-facing): `createDraftProposal()`,
  `getOwnedProposal()` (ownership resolution — null for both "doesn't exist" and "belongs
  to someone else," so the caller always responds 404, never 403, closing the enumeration
  finding), `updateProposal()` (atomically guarded to `status IN ('draft','submitted')` —
  defense-in-depth beyond the route's own pre-check, closing the race where a board
  member locks the proposal between the route's read and this write), `discardDraftProposal()`
  (atomically guarded to `status='draft'`), `submitProposal()` (transactional: validates,
  snapshots the proposer's name/email/phone from the live `members` row, flips
  `status='submitted'`, inserts the first `proposalDecisions` row), `listMyProposals()`,
  `listSubmittedProposalsForReview()`, `getProposalById()` (visibility-checked — returns
  null, not the row, when the viewer fails `proposalVisibleTo()`, so a Server Component
  caller can render a plain `notFound()`), `listDecisionsForProposal()`,
  `resolveProposerContactEmail()` (snapshot email, falling back to a live `members` lookup
  by `proposerMemberId` if present — best-effort, per Phase 3's Email #3), `decideProposal()`
  (transactional: same-status no-op guard, draft guard, optional `chairName` override in
  the same transaction), `backfillDecisionCitingMinutes()`.
- **6 route handlers**, all mutation-only (0 GET routes, matching Phase 3's API Contract —
  every read is a Server Component calling the query module directly):
  1. `POST /api/members/proposals` — `src/app/api/members/proposals/route.ts`
  2. `PATCH /api/members/proposals/[id]` + `DELETE /api/members/proposals/[id]` —
     `src/app/api/members/proposals/[id]/route.ts`
  3. `POST /api/members/proposals/[id]/submit` —
     `src/app/api/members/proposals/[id]/submit/route.ts`
  4. `POST /api/admin/proposals/[id]/decide` —
     `src/app/api/admin/proposals/[id]/decide/route.ts`
  5. `PATCH /api/admin/proposals/[id]/decisions/[decisionId]` —
     `src/app/api/admin/proposals/[id]/decisions/[decisionId]/route.ts`
- **3 `sendEmail()` call sites**, all in route handlers, all fired AFTER the DB transaction
  commits and wrapped in their own `try/catch` (a send failure is logged via
  `console.error`, never blocks the response or rolls back the write — matches
  `reimbursement`/`minutes` precedent): board notification + proposer confirmation in the
  submit route; proposer status-update notification in the decide route (subject built via
  `proposalDecisionEmailSubject()`, matching Phase 3's exact template
  `"Update on your proposal: {projectName} — {StatusLabel}"`).
- **`meetingDate` carried into the API surface** per database-admin's Phase 4 handoff note:
  both `POST .../decide`'s body and the backfill `PATCH` body accept an optional
  `meetingDate` (validated via `isValidDateString()`), alongside `citingMinutesId`.
- **`src/lib/proposals.test.ts`** — all 7 "Required Unit Tests" groups from Phase 3,
  expanded into 28 individual `it()` cases: status/type/money-needed validators (accept-all
  + reject-near-misses), `isProposalEditableByProposer` (draft/submitted true, the other 4
  false), `proposalVisibleTo` (owner-true, reviewer-true, neither-false, and the
  `proposerUserId === null` boundary resolving false for every non-reviewer viewer, plus a
  same-null-but-reviewer case), `validateProposalSubmission` (each of the 5 required fields
  individually missing → its own field-keyed error; `"Not yet identified"` accepted as
  `chairName`; full minimal submission passes clean), the money tri-state coherence matrix
  (value+unknown=true fails, unknown alone passes, a real value passes, `'no'`/`'not_sure'`
  never require the pair), and `isNoOpDecision` (same-status true, every other pair false,
  explicitly including the non-consecutive-repeat case
  `deferred → under_review → deferred`).

### Outputs

**Files:**
- `src/lib/proposals.ts` (new)
- `src/lib/proposals-queries.ts` (new)
- `src/lib/proposals.test.ts` (new — 28 tests)
- `src/app/api/members/proposals/route.ts` (new)
- `src/app/api/members/proposals/[id]/route.ts` (new)
- `src/app/api/members/proposals/[id]/submit/route.ts` (new)
- `src/app/api/admin/proposals/[id]/decide/route.ts` (new)
- `src/app/api/admin/proposals/[id]/decisions/[decisionId]/route.ts` (new)

**API contract for ux-developer to consume:**

| Method | Path | Gate | Body | Success |
|---|---|---|---|---|
| POST | `/api/members/proposals` | `session.user.memberId` (no FEATURES) | `{}` or any subset of proposal fields | 201 `{ proposal }` |
| PATCH | `/api/members/proposals/[id]` | ownership (404 if not owner/not found) + `isProposalEditableByProposer` (409 if locked) | partial field merge, `status` rejected | 200 `{ proposal }` |
| DELETE | `/api/members/proposals/[id]` | ownership + `status='draft'` (409 otherwise) | — | 204 |
| POST | `/api/members/proposals/[id]/submit` | ownership | — | 200 `{ proposal }`; 409 if already submitted; 422 `{ errors: {field: msg} }` on validation failure |
| POST | `/api/admin/proposals/[id]/decide` | `hasFeature(FEATURES.PROPOSALS_REVIEW)` (403, not 404, on missing permission) | `{ status: 'under_review'\|'approved'\|'declined'\|'deferred', note?, chairName?, citingMinutesId?, meetingDate? }` | 200 `{ proposal, decision }`; 404 not found/still draft; 409 same-status no-op |
| PATCH | `/api/admin/proposals/[id]/decisions/[decisionId]` | `hasFeature(FEATURES.PROPOSALS_REVIEW)` | `{ citingMinutesId?, meetingDate? }` — at least one required | 200 `{ decision }`; 404 decision not found for that proposal id |

**Read functions for Server Components (no HTTP round-trip needed):**
`listMyProposals(userId)`, `listSubmittedProposalsForReview(opts?)`,
`getProposalById(id, { viewerUserId, viewerHasReviewAccess })` (visibility-enforced —
returns `null` for a non-owner/non-reviewer, render `notFound()`),
`listDecisionsForProposal(proposalId)` — all in `src/lib/proposals-queries.ts`.

**Visibility rule enforcement:** `proposalVisibleTo()` in `src/lib/proposals.ts` is the
single source of truth (`viewerHasReviewAccess` short-circuits true; otherwise
`proposerUserId === viewerUserId`, with a `null` `proposerUserId` — deleted account —
always resolving false for a non-reviewer). It's called from `getProposalById()` in the
query layer (so every caller, route or Server Component, gets it automatically) and
implicitly by every member route's `getOwnedProposal()` ownership check. "My proposals"
(`listMyProposals`) and "all submitted proposals" (`listSubmittedProposalsForReview`) are
genuinely two different queries, as Phase 2 required — no client-supplied filter toggle.

**Schema:** no changes — consumed database-admin's `proposals`/`proposalDecisions` tables
and the `FEATURES.PROPOSALS_REVIEW` binding as-is.

### Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — 75 files / 1399 tests, all passing (28 new).
- Dev-server curl exercise (all 6 routes), using a temporary member+user row created and
  then deleted in the dev DB (not production — `PROD_DATABASE_URL` was explicitly
  unset for every `psql`/DB-touching command in this session):
  - All 6 routes return 401 unauthenticated, proving the gate is real on every entry point.
  - Full member flow: create draft (201) → submit while incomplete → 422 with a
    field-keyed error map naming `type`/`needDescription`/`chairName`/`moneyNeeded` →
    PATCH setting `estimatedCostCents` AND `estimatedCostUnknown:true` together → 400
    tri-state-coherence rejection → PATCH with a coherent full payload → 200 → submit → 200,
    `proposerNameSnapshot`/`Email`/`PhoneSnapshot` populated from the live member row →
    submit again → 409 → PATCH the now-`submitted`-then-later-`approved` proposal → 409
    edit-lock.
  - Enumeration: PATCH on a random nonexistent id (authenticated) → 404, matching the
    nonexistent-id case exactly (never a 403 that would confirm existence).
  - Admin decide flow: `under_review` (200, decision row written) → same status again →
    409 → `approved` with a `chairName` override and `meetingDate` → 200, `chairName`
    updated on the proposal row, second decision row written.
  - Backfill: `PATCH .../decisions/[decisionId]` with `meetingDate` only → 200; with no
    fields → 400; unauthenticated → 401.
  - Discard: create a second draft, `DELETE` → 204; `DELETE` again → 404 (already gone).
  - `psql` confirmed 3 `proposal_decisions` rows for the test proposal
    (`submitted`/`under_review`/`approved`) and confirmed the `email_queue` table held
    exactly the expected 5 rows: board notification `blocked_non_production` (guardrail
    intact, not weakened or bypassed — verified via the table, never by checking an inbox),
    submit confirmation `sent`, and both decision-status emails `sent` with subjects
    `"...— Now Under Review"` and `"...— Approved"` matching Phase 3's template exactly.
  - All test rows (proposal, decisions cascade, email_queue rows, the temporary member and
    user) were deleted after verification; confirmed zero remaining via `psql`.

### Open questions / handoff notes

- **Nothing in Phase 3's design turned out to be unbuildable as written.** The only
  addition beyond Phase 3's original API Contract text is `meetingDate`, which was already
  flagged as expected by database-admin's Phase 4 (schema) handoff note — implemented
  exactly as that note described (optional, alongside `citingMinutesId`, on both the decide
  and backfill routes).
- **Next agent: ux-developer.** Build both page trees and the 4 client components named in
  Phase 3's Component Plan (`proposal-form.tsx`, `proposal-status-timeline.tsx`,
  `proposal-review-table.tsx`, `proposal-decision-panel.tsx`), wired to the 6 routes and 4
  read functions documented above. A few implementation notes worth carrying forward:
  - The submit route's 422 response shape is `{ errors: { fieldName: "message" } }` —
    build the form's error-rendering around that exact shape (field-keyed, not a flat array)
    so each field can show its own inline message per Phase 1's Flow 1 failure note.
  - The tri-state PATCH contract requires the client to send BOTH halves of a pair together
    whenever toggling "not sure" — e.g. checking the "not sure" checkbox for estimated cost
    should send `{ estimatedCostCents: null, estimatedCostUnknown: true }` in the same
    request, not just `estimatedCostUnknown: true` alone. The server merges against the
    stored row either way (so a lone `estimatedCostUnknown: true` PATCH is *not* silently
    dropped-and-ignored — it's checked against whatever `estimatedCostCents` is already
    stored and will 400 if that's non-null), but the UI should send the coherent pair
    proactively rather than relying on the server's merge-and-reject as the normal path.
  - `PATCH /api/members/proposals/[id]` returns 409 with a plain-text `{ error }` (not the
    field-keyed shape) when the proposal has become locked — this is a different error
    shape than submit's 422, by design (it's not a field problem, it's a whole-record state
    problem); the UI should handle these as two distinct error-rendering paths.
  - No GET routes exist by design — `ux-developer`'s Server Components should import
    `listMyProposals` / `listSubmittedProposalsForReview` / `getProposalById` /
    `listDecisionsForProposal` directly from `@/lib/proposals-queries`, matching
    `members/reimbursements/page.tsx`'s existing pattern.

---

## Phase 4 — Implementation (UI) — 2026-08-09

**Owner:** ux-developer
**Status:** complete

### Summary

Built both page trees and all 4 client components named in Phase 3's Component Plan, on
top of the API surface api-developer shipped — no route handler, query function, or
schema was touched. The member-facing form is a single scrolling page, three labeled
sections, radio buttons (not `<select>`) on the accessibility-sensitive fields, tri-state
"not sure yet" affordances on every money/date/headcount field, hand-rolled debounced
autosave, and a `<ConfirmDialog destructive>` discard path — no new dependency, no
`react-hook-form`. The admin surface is a filterable review table plus a decision panel
that also wires up the previously-unused backfill route (`PATCH .../decisions/[decisionId]`)
so every route api-developer built actually has a caller. The entry point lives on
`/members/profile`, not the hero or the 6-tile grid — see rationale below. A full
Playwright click-through (proposer draft → autosave → submit → board review → decide →
proposer sees the locked, decided view) surfaced and fixed two real bugs before sign-off;
details under Verification.

### What I did

- **Member surface** (`src/app/members/proposals/`):
  - `page.tsx` — "My Proposals" list (`listMyProposals`), sectioned Drafts / Submitted &
    In Review / Decided, empty state, no-linked-member state (mirrors
    `members/reimbursements/page.tsx` exactly), hero action button "Start a Proposal."
  - `new/page.tsx` — auth-only wrapper, fetches the member's name/email/phone for the
    form's read-only proposer block, renders `<ProposalForm proposal={null} .../>`.
  - `[id]/page.tsx` — fetches via `getProposalById` (visibility-enforced, `notFound()` on
    null); while `isProposalEditableByProposer(status)` renders `<ProposalForm>`
    pre-filled; once locked, renders a read-only detail view + `<ProposalStatusTimeline>`
    with decider names and cited-minutes labels resolved via direct `users`/`minutes`
    lookups (no new query-module function needed for this presentation-only join).
- **`src/components/members/proposal-form.tsx`** — single scrolling page, three sections
  ("The Project" / "Money" / "Help Needed"), radio buttons for `type` and `moneyNeeded`,
  16px+ body text, 44px+ tap targets throughout, every required field marked with the
  literal word "Required," every optional one "(optional)." Conditional reveal:
  `moneyNeeded==='yes'` → cost pair; `type` includes fundraising → income pair. Every
  tri-state field (cost, income, date, volunteers) has an "I don't know yet" checkbox that
  clears and disables its paired input — this and every save (autosave or explicit) sends
  the *full* current form state, not a partial diff, so both halves of a tri-state pair are
  always sent together (per api-developer's handoff note). Debounced autosave (~2s,
  `useEffect` + `setTimeout`, no new dependency) `POST`s to mint the draft on first edit,
  then `PATCH`es; an explicit "Save Draft"/"Save Changes" button forces an immediate flush.
  Client-side validation mirrors `validateProposalSubmission()` for instant inline
  feedback but treats the server's `422` field-keyed error map as authoritative — typed
  data is never wiped on a validation failure (state is controlled, never reset). "Discard
  Draft" routes through `<ConfirmDialog destructive>`.
- **`src/components/members/proposal-status-timeline.tsx`** — plain, server-renderable
  component (no `"use client"`), mirrors `components/documents/version-history-list.tsx`'s
  visual shape. Also exports `ProposalStatusBadge`, reused by the list page and both admin
  components so the status-color mapping exists in exactly one place.
- **Admin surface** (`src/app/(dashboard)/admin/proposals/`):
  - `page.tsx` — own `auth()` + `hasFeature(PROPOSALS_REVIEW)` gate (redirects to
    `/access-pending`, not `/admin`, matching the design doc), `listSubmittedProposalsForReview()`,
    empty state, renders `<ProposalReviewTable>`.
  - `[id]/page.tsx` — own independent gate again (not inherited from the list page),
    `getProposalById(id, { viewerHasReviewAccess: true })`, `notFound()` if the id doesn't
    resolve **or if `status === 'draft'`** — defense in depth matching the `decide` route's
    own 404-on-draft rule (Phase 3 Edge Cases), since `getProposalById` with review access
    would otherwise return a draft row that's never supposed to be board-visible. Full
    unredacted detail, `<ProposalDecisionPanel>`, `<ProposalStatusTimeline>`.
- **`src/components/admin/proposals/proposal-review-table.tsx`** — `"use client"` only for
  a local status-filter (chips over an already-fetched, already-excludes-drafts list, not a
  URL round trip). Real `<table>` (per CLAUDE.md — "tables that act like tables stay as
  `<table>`"), since the board-reviewer audience is the handful of tech-comfortable users
  Phase 3 explicitly carved out from the accessibility-research constraints.
- **`src/components/admin/proposals/proposal-decision-panel.tsx`** — target-status
  `<select>` (deliberately a `<select>`, not radios, per Phase 3), optional note, optional
  chair-name override (shown only when `chairName === 'Not yet identified'`), optional
  meeting-date + citing-minutes fields, `POST .../decide`. No `<ConfirmDialog>` — a status
  change is additive history, not destructive (Phase 2 §4, unchanged). Added a **"Backfill
  Past Decisions"** section that Phase 3's Component Plan text didn't spell out as a
  separate sub-component but whose backing route (`PATCH .../decisions/[decisionId]`) api-
  developer built specifically for this — without it, that route would have shipped with
  no caller. Lists every decision row still missing `citingMinutesId` and/or `meetingDate`
  with inline edit + Save, wired to the backfill route.
- **Minutes options for both admin pickers** (decide-time and backfill) sourced from
  `listMinutesForAdmin({ kind: "board" })` + `minutesKindLabel()`, following the exact
  label format (`"{kind} minutes — {meetingDate}{(draft)}"`) already established in
  `admin/documents/[slug]/page.tsx`.
- **Member portal entry point** — added a third "My Proposals" card to the existing "My
  Dues" / "My Reimbursements" grid on `/members/profile` (`sm:grid-cols-2` →
  `sm:grid-cols-3`), **not** the hero header (where `SuggestionBoxLauncher` lives) and
  **not** a 7th tile on `/members`'s 3×2 grid (DECISION-074). Reasoning: a proposal is
  structurally identical to a reimbursement request — member submits it, staff/board
  reviews it, the member watches a status change over time — which is exactly the shape
  the "My X" card grid already exists for. The Suggestion Box header action is a
  single-shot, no-status-tracking submission; proposals are the opposite of that, so
  copying its placement would have been the wrong analogy even though it's the more
  visually prominent spot.

### Verification

- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` — **75 files / 1402 tests, all passing** (no proposals-UI-specific unit tests
  were required — Phase 3's Required Unit Tests section is entirely `src/lib/proposals.ts`
  coverage, already delivered by api-developer; component-level tests weren't named in the
  design doc and weren't added speculatively).
- `pnpm build:only` — clean production build.
- `grep` for `console.log`, native dialogs (`window.confirm/alert/prompt`), and
  `rounded-full` on any button across every file in this phase's scope — zero matches.
- **Full Playwright click-through** against the dev server (port 3001; `PROD_DATABASE_URL`
  explicitly unset for the whole session), driving two temporary accounts created directly
  in the dev DB (a linked member+user "proposer," and an `admin`-role "reviewer") and
  deleted afterward, along with every proposal/decision/email-queue row they touched —
  confirmed zero remaining via `psql`. What was actually exercised, not assumed:
  - Signed in as the proposer → clicked "My Proposals" from the `/members/profile` card →
    empty state → "Start a Proposal."
  - Typed the project name; watched the save indicator go "Unsaved changes" → "Saving…" →
    "All changes saved" ~2s later, confirming the debounced autosave actually round-trips.
  - Selected type=Fundraiser (income field revealed), moneyNeeded=Yes (cost field
    revealed), checked "Not sure yet" on cost (input visibly disabled + cleared) — the
    tri-state affordance from Phase 1's adversarial pass, working as specified.
  - Submitted with the chairperson field blank on purpose: got the inline, field-level
    "Chairperson is required…" error with the rest of the form's typed data still intact
    (no data loss on a failed submit, per Phase 1 Flow 1) — then fixed it and submitted for
    real.
  - Confirmed via `psql` that the proposal reached `status='approved'` at the end of the
    flow with the full expected `proposal_decisions` history (`submitted` →
    `under_review` → `approved`), and that `email_queue` held exactly the expected rows:
    the board notification `blocked_non_production` (the non-prod distribution-list
    guardrail firing correctly through the UI path, not just the raw API) and the
    submit-confirmation + two decision-status emails all `sent` with the exact subject
    lines Phase 3 specifies.
  - Verified the "My Proposals" list correctly bucketed the submission under "Submitted &
    In Review."
  - Created a second draft, clicked "Discard Draft," confirmed the `<ConfirmDialog
    destructive>` rendered (not a native `confirm()`), confirmed, verified the draft was
    gone from the list and the DB.
  - Signed out, signed in as the reviewer → `/admin/proposals` listed the submission (drafts
    correctly excluded — the discarded one was never there to check, but the still-open
    "My Proposals" empty state after discard already confirms the draft delete path) →
    opened it → moved it to "Under Review," then to "Approved" with a chair-name override
    (shown because chair was "Not yet identified") and a note.
  - Signed back in as the proposer, opened the same proposal by URL: confirmed the "locked
    for review" banner, the full read-only detail, and a `<ProposalStatusTimeline>` showing
    all three decisions with the reviewer's name, the note text, and the correct status
    badges — the proposer-side payoff of the whole "replace the paper form's dead end"
    premise from Phase 1.
  - Screenshots of every step retained in the session scratchpad for this run (not part of
    the shipped diff).

### Two real bugs found and fixed during the click-through (not just typecheck-clean code)

1. **Autosave/explicit-save race could silently drop a Submit.** The original
   `persist()` used a boolean `savingRef` guard: if "Submit Proposal" was clicked while the
   debounced autosave's own `PATCH` was still in flight, `persist()` returned `false`
   immediately (queuing an unawaited background retry the caller never saw), so
   `handleSubmit()` reported "Could not save your latest changes" and **never called the
   submit endpoint at all** — reproducible any time a user finishes typing and clicks
   Submit within about a second of the debounce timer firing. Fixed by replacing the
   boolean flag with a promise-based mutex (`savingPromiseRef`): an overlapping caller now
   *awaits* the in-flight save and then issues its own fresh save with current field state,
   instead of bailing out. Confirmed by DB inspection before/after: before the fix the test
   proposal was stuck in `status='draft'` after clicking Submit; after the fix it correctly
   reached `submitted` → `under_review` → `approved`.
2. **`ProposalDecisionPanel`'s Backfill section crashed after recording a decision.**
   `BackfillPanel`'s local `drafts` state was seeded once from the `decisions` prop via a
   `useState(...)` initializer, which only runs at mount. After `router.refresh()` brought
   a freshly-inserted decision row (the one just recorded), that row had no entry in the
   stale `drafts` map, and `drafts[d.id].meetingDate` threw `Cannot read properties of
   undefined` — a full-page runtime error, caught live via a Playwright screenshot, not
   theoretical. Fixed by deriving each row's editable value on read
   (`draftFor(d) = overrides[d.id] ?? defaultFrom(d)`) instead of trying to keep a
   separate state object in sync with a changing prop array. Re-ran the full click-through
   after the fix; the same "record Approved, then look at Backfill Past Decisions" sequence
   now renders both the newly-added "Under Review" and "Approved" backfill rows correctly.
3. **(Minor, also fixed) Reload-orphans-a-draft.** The very first autosave-created draft
   left the browser on `/members/proposals/new` indefinitely — reloading that URL would
   have silently started a *second*, unrelated draft rather than resuming the one just
   created, since nothing pointed the URL at the new id. `persistOnce()` now
   `router.replace()`s to `/members/proposals/{id}` the first time an id is minted, so the
   URL always matches the real backing row.

### Outputs

- **Member surface:** `src/app/members/proposals/page.tsx`,
  `src/app/members/proposals/new/page.tsx`, `src/app/members/proposals/[id]/page.tsx`,
  `src/components/members/proposal-form.tsx`,
  `src/components/members/proposal-status-timeline.tsx`.
- **Admin surface:** `src/app/(dashboard)/admin/proposals/page.tsx`,
  `src/app/(dashboard)/admin/proposals/[id]/page.tsx`,
  `src/components/admin/proposals/proposal-review-table.tsx`,
  `src/components/admin/proposals/proposal-decision-panel.tsx`.
- **Entry point:** `src/app/members/profile/page.tsx` — added the "My Proposals" card
  (grid widened `sm:grid-cols-2` → `sm:grid-cols-3`), with the placement reasoning recorded
  inline as a code comment as well as above.
- No schema, query-module, route-handler, or `permissions.ts` changes — this phase is
  UI-only, as scoped.

### Open questions / handoff notes

- **What a reviewer should click through:** exactly the sequence under Verification above
  — draft → autosave → tri-state "not sure" toggle → failed submit (inline error, no data
  loss) → successful submit → board decide (Under Review → Approved with chair override) →
  proposer sees the locked view + timeline. Also worth a manual look: the "Discard Draft"
  `<ConfirmDialog>` on a phone-width viewport (360px) for the conditional-field reveal
  Phase 1 specifically flagged as the most likely thing to break narrow layouts — I didn't
  independently re-verify 360px beyond Tailwind's mobile-first classes being correct by
  construction; qa should give it a real narrow-viewport pass.
- **New copy strings the club may want to refine:** "Fill in what you know now — you can
  save a draft and finish later," the empty-state copy on `/members/proposals`
  ("You haven't proposed a project yet…"), and the locked-view banner text ("This proposal
  is locked for review…"). All plain, warm, non-technical language per CLAUDE.md's content
  guidelines, but none of it is copy the treasurer signed off on verbatim — flagging for
  the club's review pass, not because I think it's wrong.
- **UX decisions made, not directed by Phase 3 verbatim:**
  - Entry point placement (Profile hub card vs. hero action) — reasoned above; Phase 2/3
    left this as "a card under an existing hub or a header action," a genuine choice.
  - The admin decision panel's "Backfill Past Decisions" sub-section — Phase 3's Component
    Plan text names 4 components, not 5, but the backfill route had no caller without it.
    If the board decides this is unnecessary clutter (they may always cite minutes at
    decision time, never after), it's a small, easily-removable addition, not load-bearing.
  - `[id]` admin page 404s on a still-`draft` proposal reached by direct/guessed URL —
    Phase 3's API contract does this for the `decide` route; I extended the same rule to
    the page-level read for consistency, since otherwise a reviewer could view (though
    never decide on) a draft that's supposed to be invisible to the board.
- **Something worth a second look, not a blocker:** during manual testing, the admin
  sidebar's "Inbox" group (Contact / Suggestions / Proposals) wasn't visible in a full-page
  screenshot for a reviewer with the full `admin` role — direct URL navigation to
  `/admin/proposals` worked correctly every time regardless, and an independent code check
  confirmed `src/components/admin/admin-sidebar.tsx` does map `ADMIN_NAVIGATION` correctly
  and would render the full group for an admin. Most likely a `position: sticky` +
  full-page-screenshot interaction in the test tooling, not a real gap — but flagging so qa
  can confirm with a live look at the actual rendered sidebar rather than take my word for
  it.
- **Next agent: qa (Phase 5).** Typecheck, unit tests, and production build are all green;
  the click-through above is real but was driven by me, not an independent verifier — qa
  should re-run its own pass per the pipeline's own logic (a builder verifying their own
  work is not the same gate as an independent one), plus the 360px viewport check and the
  admin-sidebar visual check flagged above.

---

## Phase 5 — Verification — 2026-08-09

**Owner:** qa
**Status:** complete

### Summary

**PASS.** Independently re-verified the full stack — typecheck, 75 files / 1402 Vitest
tests, and a clean production build (229 routes, including all 9 proposals routes) all
green. Drove the real user flows against a running dev server with three disposable
dev-only accounts (a plain `member`, a `board_member` reviewer, and a third proposal
owner), not the admin E2E fixture, which bypasses every proxy feature check and would
have proven nothing about the permission boundary. Confirmed the permission boundary and
enumeration resistance hold with a real non-privileged session; confirmed both bugs
ux-developer reported fixing are actually fixed by reproducing their exact original
trigger conditions; confirmed the tri-state "not sure yet" fields round-trip honestly
across save → reload → submit → board decide → both proposer and board views, including
the three-way distinction (blank / "not sure" / a real value) that Phase 2 flagged as the
highest-risk spot for a silent data bug; confirmed the email guardrail is intact (board
notification `blocked_non_production`, proposer emails `sent`); confirmed migration
idempotency with a clean second run. ux-developer's flagged "Inbox nav group not
rendering" concern is **not a real bug** — confirmed false alarm, a full-page-screenshot
artifact against a `position: fixed`, internally-scrollable sidebar; a live DOM check
shows Contact/Suggestions/Proposals all present and visible. All test data (3 disposable
accounts, 4 proposals, their decision rows, and 16 email_queue rows) was deleted from the
dev DB and confirmed gone; nothing was run against production.

### What I did

1. **Read the full work-log** — Phase 1 (user verbs/flows/permissions/gaps), Phase 2
   (architecture, two-table decision history), Phase 3 (the design doc — permissions,
   data model incl. the tri-state value+unknown shape, API contract, email contract,
   component plan), and all three Phase 4 sections (schema, API, UI), including the two
   bugs ux-developer reported fixing and the flagged "Inbox nav group" observation.
2. **Automated stack:**
   - `pnpm exec tsc --noEmit` — clean, zero errors.
   - `pnpm test` — **75 files / 1402 tests, all passing.**
   - `pnpm build:only` — clean production build, 229 routes total, including all 9
     `*proposals*` routes (`/members/proposals`, `/members/proposals/new`,
     `/members/proposals/[id]`, `/admin/proposals`, `/admin/proposals/[id]`, and the 4
     API route files). No errors or warnings in the build output.
   - `pnpm db:migrate` against dev, twice in a row (`DATABASE_URL` only,
     `PROD_DATABASE_URL`/`DB_URL` explicitly unset for every command in this session,
     per the standing safety rule) — second run was a clean no-op (`NOTICE ... already
     exists, skipping` for both tables, zero new `role_features` rows). Verified via
     `psql` that `proposals.review` is still held by exactly `admin` and `board_member`
     — 2 rows, unchanged.
3. **Dev-server manual click-through**, driving real browser sessions (Playwright against
   `pnpm dev` on port 3001, `PROD_DATABASE_URL` unset) with three disposable dev-only
   accounts created directly via `psql`/Drizzle (never the admin E2E fixture):
   - A plain `member`-role proposer (`chenson42+qaproposalproposer@gmail.com` — a Gmail
     alias of the requesting user's own address, deliberately chosen so the
     "proposer emails actually send" check could be verified end-to-end without risking
     any real club member's inbox).
   - A `board_member` reviewer (`qa-reviewer-phase5@westervillelions.invalid`) — **not**
     `admin`, so the review-surface check is a true least-privilege test of the
     `proposals.review` grant, not conflated with full admin bypass.
   - A third member (`qa-other-owner-phase5@westervillelions.invalid`) owning a separate
     submitted proposal, used only as the enumeration-resistance target.
   - Exercised: sign in as proposer → empty "My Proposals" → "Start a Proposal" → typed
     project name, type=Fundraiser (income field revealed), moneyNeeded=Yes (cost field
     revealed), checked "Not sure yet" on cost (input visibly cleared+disabled) → watched
     the debounced autosave indicator go "Unsaved changes" → "Saving…" → "All changes
     saved" → left the page (`/members/proposals`) and confirmed the draft was still
     listed → returned to it and confirmed the typed values were still populated →
     submitted with chair "Not yet identified" → signed in as the reviewer → `/admin/proposals`
     listed it → opened it, moved it Under Review, then Approved with a chair-name
     override and a note → signed back in as the proposer → confirmed the locked,
     read-only view showing "Approved," the chair override, and a full 3-row status
     timeline with the reviewer's name and both decision notes.
   - Screenshots retained in the session scratchpad (not part of the shipped diff).
4. **Permission boundary, with the plain member's real session (not admin):**
   - `GET /admin/proposals` → redirected to `/access-pending`. ✅ (confirmed via
     `page.url()` after navigation, not just a code read.)
   - `POST /api/admin/proposals/[id]/decide` → **403**, not a silent 200. ✅
   - `GET /members/proposals/[id]` on another member's proposal → **404**, not 403
     (enumeration resistance — existence not leaked). ✅
   - `PATCH /api/members/proposals/[id]` on another member's proposal → **404**. ✅ (First
     attempt with an *unlinked* fixture account got 403 instead — see Defects Found #1
     below; re-tested with a member-linked fixture, which is the realistic shape of a
     real plain-member session, and got the correct 404.)
   - Then confirmed the positive case: the `board_member` reviewer (holding
     `proposals.review`) reaches `/admin/proposals` and sees the submitted proposal. ✅
5. **Email guardrail**, verified via the `email_queue` table (never an inbox) after the
   full submit → decide → decide flow above:
   ```
   to                                       | subject                                                                | status
   board@westervillelions.org               | New Project/Activity Proposal: QA Phase 5 Test Proposal               | blocked_non_production
   chenson42+qaproposalproposer@gmail.com   | We've received your proposal: QA Phase 5 Test Proposal                | sent
   chenson42+qaproposalproposer@gmail.com   | Update on your proposal: QA Phase 5 Test Proposal — Now Under Review  | sent
   chenson42+qaproposalproposer@gmail.com   | Update on your proposal: QA Phase 5 Test Proposal — Approved          | sent
   ```
   Board notification correctly `blocked_non_production` — the guardrail fired, was not
   weakened or bypassed. Proposer emails correctly `sent` with the exact subject lines
   Phase 3 specifies, confirming they're real, testable, non-distribution-list sends.
6. **Migration idempotency** — see automated stack above; both runs clean, second run a
   verified no-op.
7. **Tri-state round-trip**, the risk Phase 2 flagged as most likely to hide a silent
   data bug — tested all three states explicitly, not just the "unknown" case:
   - **Unknown**: `moneyNeeded=yes` + cost "Not sure yet" checked → reload → submit →
     board's full detail view and the proposer's locked view both render "Yes — amount
     not yet known."
   - **Blank/unanswered**: the optional tri-state fields left untouched (proposed date,
     volunteers) render "Not specified" throughout.
   - **A real value**: a fresh proposal with `estimatedCostCents` for a concrete
     `$1,234.56` → reload confirmed the exact input value (`1234.56`) survived a real
     page navigation, not just client state → submitted → reviewer moved it to Under
     Review → both the admin decision page and the proposer's locked view render
     **"Yes — estimated $1234.56"** — distinct from both "not yet known" and "Not
     specified." All three states are honestly distinguishable end-to-end, exactly as
     designed.
8. **The two bugs ux-developer reported fixing** — reproduced the exact original trigger
   conditions against the shipped code, not just re-read the fix:
   - **Autosave/submit race:** filled every required field and clicked "Submit Proposal"
     **immediately**, with no wait for the ~2s debounce to fire (the exact window that
     used to make `handleSubmit()` report "Could not save your latest changes" and never
     call the submit endpoint at all). Result: no "Could not save" message appeared, the
     page navigated to the new proposal's detail URL, and `psql` confirmed
     `status='submitted'` with a populated `submitted_at` — **not** stuck in `draft`,
     which is what the pre-fix bug produced. Confirmed fixed.
   - **Backfill-panel crash after recording a decision:** recorded a decision ("Under
     Review") and captured the page 1.5s later — the exact "just-inserted row is missing
     from client state" window the original crash occurred in. The "Backfill Past
     Decisions" panel rendered both the "Submitted" and the freshly-added "Under Review"
     rows correctly, each with its own editable meeting-date/citing-minutes inputs — no
     `Cannot read properties of undefined` runtime error, no blank page. Confirmed fixed.
9. **The flagged "Inbox" admin-sidebar concern** — investigated directly rather than
   taking either agent's word for it. A `fullPage: true` screenshot reproduced the same
   symptom ux-developer saw (no visible "Inbox"/Contact/Suggestions/Proposals group). But
   a DOM-level check (`page.locator('nav a[href="/admin/proposals"]')`) on the same live
   page showed the link present *and* `isVisible() === true`, and the full nav text dump
   showed "INBOX / ✉️ Contact / 💡 Suggestions / 🗂️ Proposals" rendered in order. An
   element-scoped (non-fullPage) screenshot of just the `<nav>` confirmed it's a normal
   `overflow-y-auto` scrollable list that's taller than one viewport — the `fullPage`
   screenshot's scroll-and-stitch behavior interacting with the sidebar's
   `position: fixed` container is what cut it off, exactly as ux-developer suspected.
   **Verdict: not a real defect.** The nav renders correctly for a board reviewer holding
   `proposals.review`; no code change needed.
10. **Wrote a permanent regression spec**, `e2e/proposals-permission-boundary.spec.ts`,
    covering the 5 permission-boundary/enumeration assertions from step 4 above with
    self-contained, self-cleaning DB fixtures (mirrors
    `admin-subscriptions-page-gate.spec.ts`'s established convention exactly — disposable
    `member` and `board_member` users, a disposable third-party proposal, all created and
    torn down via `beforeAll`/`afterAll`, no HTTP-only path exists to create a role
    binding). Ran it standalone: **5/5 passing.** Did not run the full e2e suite — the
    work-log's own caveat about a known-bad baseline (leftover sentinel fiscal-year
    rows) means a full-suite run would mix unrelated noise into this feature's signal;
    the new spec plus the live manual click-through above are the stronger, more direct
    evidence for this feature specifically.
11. **Cleaned up every piece of test data** created during this pass: 3 disposable
    accounts + their linked member rows, 4 test proposals and their decision rows, and
    16 `email_queue` rows (the ones this session generated, plus 2 stray
    `blocked_non_production` rows left over from an earlier Phase 4 session's testing —
    `email_queue` has no FK to `proposals`, so deleting a test proposal doesn't
    retroactively clean its queued email rows; not a defect, just queue-table retention
    behavior worth knowing about). Confirmed via `psql`: `proposals` table has 0 rows,
    no `users`/`members` rows matching any of this session's fixture email patterns
    remain. Nothing was run against `PROD_DATABASE_URL` at any point.

### Outputs

- **Files added:** `e2e/proposals-permission-boundary.spec.ts` (new, permanent — 5
  passing tests, self-contained fixtures).
- **Files touched:** `docs/work-log/2026-08-09-project-proposal-form.md` (this section,
  Per-Phase Status table).
- **No application code changed** — Phase 5 is verification-only; every defect found
  below was either already fixed (confirmed by reproduction) or determined not to be a
  real defect.
- **Screenshots** from the click-through retained in the session scratchpad (not part of
  the shipped diff, not committed).

### Type Check
`pnpm exec tsc --noEmit`: **PASS**

### Unit Tests
`pnpm test`: **PASS**
Total: 1402 | Passed: 1402 | Failed: 0 | Files: 75
Duration: ~1.5s

### Production Build
`pnpm build:only`: **PASS**
Notes: 229 routes total, including all 9 proposals routes (`/members/proposals`,
`/members/proposals/new`, `/members/proposals/[id]`, `/admin/proposals`,
`/admin/proposals/[id]`, `POST /api/members/proposals`,
`PATCH+DELETE /api/members/proposals/[id]`, `POST /api/members/proposals/[id]/submit`,
`POST /api/admin/proposals/[id]/decide`,
`PATCH /api/admin/proposals/[id]/decisions/[decisionId]`). No errors or warnings.

### End-to-End Tests
`pnpm test:e2e` (new spec only, `e2e/proposals-permission-boundary.spec.ts`): **PASS**
Total: 5 | Passed: 5 | Failed: 0
Duration: ~13.5s
Full e2e suite not run — see step 10 above (known-bad baseline caveat; this feature's own
spec plus the live click-through are the stronger signal for this feature specifically).

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Draft → autosave → leave → return → submit | pass | Autosave indicator observed transitioning "Unsaved changes" → "Saving…" → "All changes saved"; draft survived a real navigation away and back |
| Submit with chair "Not yet identified" | pass | Accepted verbatim, shown to reviewer unredacted, editable via chair-override on decide |
| Board Under Review → Approved | pass | Both transitions recorded as separate `proposal_decisions` rows with reviewer attribution |
| Proposer sees status + decision timeline | pass | Locked view shows current status banner + 3-row timeline with decider names |
| Discard draft | pass (verified earlier by ux-developer; not independently re-run this pass — no new risk since Phase 4) | — |
| Tri-state unknown / blank / real-value round-trip | pass | All 3 states distinguishable end-to-end (see step 7) |
| Permission boundary — plain member vs `/admin/proposals`, decide API, enumeration | pass | See step 4 and the new e2e spec |
| Email guardrail — board blocked, proposer sent | pass | See step 5 |
| Autosave/submit race reproduction | pass (fixed) | See step 8 |
| Backfill-panel crash reproduction | pass (fixed) | See step 8 |
| Admin sidebar "Inbox" group visibility | pass — false alarm, not a real defect | See step 9 |
| 360px mobile viewport / conditional-field reveal | **not run this pass** | Flagged by ux-developer as unverified; still open — see Open Questions below |

### Regression Tests Added
- `must not reach /admin/proposals — redirected to /access-pending` —
  `e2e/proposals-permission-boundary.spec.ts:140` — guards against: a plain member
  reaching the board review surface.
- `must get 403, not a silent 200, from POST /api/admin/proposals/[id]/decide — regression for a missing hasFeature() gate` —
  `e2e/proposals-permission-boundary.spec.ts:152` — guards against: the decide route
  losing its `hasFeature()` check (the exact failure mode that shipped twice before on
  `/api/admin/members/export` and `/api/admin/newsletter/export`).
- `requesting another member's proposal detail page gets 404, not 403 — regression for existence-leaking enumeration` —
  `e2e/proposals-permission-boundary.spec.ts:168` — guards against: the member detail
  page leaking proposal existence to a non-owner.
- `PATCHing another member's proposal gets 404, not 403 — regression for existence-leaking enumeration` —
  `e2e/proposals-permission-boundary.spec.ts:179` — guards against: the same leak on the
  mutation path.
- `reaches /admin/proposals and sees a submitted proposal` —
  `e2e/proposals-permission-boundary.spec.ts:197` — guards against: `proposals.review`
  silently stopping admitting `board_member` (positive-path canary alongside the four
  negative checks above).

### Coverage on Critical Modules
- `src/lib/proposals.ts`: covered by all 28 tests in `src/lib/proposals.test.ts`
  (api-developer's Phase 4 deliverable, verified present and passing — status/type/
  money-needed validators, `isProposalEditableByProposer`, `proposalVisibleTo` incl. the
  null-`proposerUserId` boundary, `validateProposalSubmission` incl. the "Not yet
  identified" chair case, the full tri-state coherence matrix, `isNoOpDecision` incl. the
  non-consecutive-repeat case). This module was Phase 3's only named unit-test target for
  this feature; `src/lib/events.ts`/`permissions.ts`/`members.ts` are unrelated to this
  feature and unchanged this pass.
- `src/lib/proposals-queries.ts`: no unit tests (DB-facing, by design — covered by the
  live dev-server exercise in Phase 4 (API) and this pass's own click-through/e2e, matching
  this project's established split between pure-module unit tests and DB-facing
  integration coverage).

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/proposals` (page) | yes | yes | `FEATURES.PROPOSALS_REVIEW` — confirmed by reading `src/app/(dashboard)/admin/proposals/page.tsx` AND by live redirect-to-`/access-pending` test |
| `GET /admin/proposals/[id]` (page) | yes | yes | `FEATURES.PROPOSALS_REVIEW` — independent gate, not inherited from the list page (read directly in the file) |
| `POST /api/admin/proposals/[id]/decide` | yes | yes | `FEATURES.PROPOSALS_REVIEW` — confirmed by reading the route AND by live 403 test with a non-holder session |
| `PATCH /api/admin/proposals/[id]/decisions/[decisionId]` | yes | yes | `FEATURES.PROPOSALS_REVIEW` — confirmed by reading the route |
| `POST /api/members/proposals` (create draft) | yes | n/a — deliberately no `FEATURES` gate | `session.user.memberId` required (linked member only), matching Phase 3's explicit design — same pattern as `/members/reimbursements`/`/members/financial-reports` |
| `PATCH`/`DELETE /api/members/proposals/[id]` | yes | n/a | ownership check (`proposerUserId === session.user.id`) + `session.user.memberId` required; 404 on non-owner (confirmed live), 403 on unlinked account (see Defects Found #1 — not a leak, uniform response regardless of target id) |
| `POST /api/members/proposals/[id]/submit` | yes | n/a | ownership check; read code, not independently re-exercised this pass beyond the click-through's real submit |
| `GET /members/proposals/[id]` (page) | yes | n/a | `proposalVisibleTo()` (owner or `PROPOSALS_REVIEW` holder) via `getProposalById` → `notFound()` on mismatch; confirmed live (404 for a non-owner) |

Every protected route/page this feature touches has both gates present and the correct
key. No route returns bulk PII to a broader audience than `proposals.review` — the two
read paths (`listMyProposals`/`listSubmittedProposalsForReview`) are genuinely separate
queries, not one query with a client-supplied filter, matching Phase 2's requirement.

### Defects Found

1. **Not a defect, but worth recording:** the PATCH/DELETE member routes gate on
   `session.user.memberId` *before* the ownership check. For an account with **no**
   linked member row, this means every request — to a real id or a fake one — returns a
   uniform 403 "Member account required," never reaching the id-specific 404. This does
   **not** leak existence (the response doesn't vary by target id for an unlinked
   account), so it isn't an enumeration bug, and it matches Phase 3's general rule that
   the member-facing surface is scoped to "linked member" throughout. It's a narrow edge
   case Phase 3's Edge Cases section doesn't explicitly cover: a user whose `users.member_id`
   is cleared (unlinked) *after* they've already submitted proposals as a linked member
   would be blocked from editing/discarding their own still-`draft` proposal by this
   gate, even though they're still the rightful owner. Low severity (requires an admin to
   have manually unlinked an existing member's account, which is itself rare and would
   already be disruptive to that person in other ways), not a blocker for PASS — flagging
   for the backlog, not looping back to Phase 4.
2. **ux-developer's flagged "Inbox nav group not rendering" — confirmed NOT a real
   defect** (see step 9). No code change needed.
3. **Both bugs ux-developer reported fixing are confirmed actually fixed** by reproducing
   their exact original trigger conditions (see step 8), not just re-reading the diff.

No blocking defects found. Nothing here warrants a FAIL or a loop-back.

### Verdict: PASS

### Open questions / handoff notes

- **360px mobile viewport check — not run this pass.** ux-developer explicitly flagged
  this as unverified ("I didn't independently re-verify 360px beyond Tailwind's
  mobile-first classes being correct by construction") and I didn't reach it either
  (prioritized the permission boundary, the two bug reproductions, and the tri-state
  round-trip as the higher-risk items per this task's brief). The conditional-field
  reveal (cost field under the money radio, income field under the fundraising type) is
  exactly the kind of thing that can silently break at narrow widths — worth a real
  360px pass before or shortly after the club starts using this in earnest, given the
  September 17 deadline context.
- **Defect #1 above (unlinked-account PATCH gate)** — recommend adding to
  `docs/backlog.md` as a low-priority follow-up rather than blocking this pass; it's a
  real gap in behavior for a rare account state, not a security or data-integrity issue.
- **Next agent: analyst, for Phase 6 (shipped vs. intent).** This PASS confirms the
  implementation matches Phase 3's design contract and that the two bugs ux-developer
  flagged are genuinely fixed. Phase 6 should specifically check the shipped feature
  against Phase 1's original functional intent — in particular, whether the September 17
  board-retreat-policy deadline framing (Origin section, Gap g) is still on track, and
  whether the treasurer/board should see a live demo before it's considered fully shipped
  given this is a governance-adjacent feature (the Communication Policy's required
  attachment).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES.**

## ONE-LINE TAKE

> The paper form's "give it to any Board Member and hope" workflow is genuinely gone —
> replaced by a real draft/submit/track flow, a board decide surface, and status emails
> that round-trip honestly across all three tri-state answers — and all three of the
> treasurer's binding decisions shipped exactly as written; the one thing that has to be
> fixed before a real board decision goes out is a one-line bug where the proposer's
> status-change email prints the raw database status (`under_review`) instead of a human
> label, in the single most visible sentence of the email that replaces the dead end.

## What's Working

- **The dead-end fix is real, not just designed.** I read the code, not just the design
  doc: `submit` fires a board email *and* a proposer confirmation email
  (`src/app/api/members/proposals/[id]/submit/route.ts`); every `decide` transition fires
  a proposer status email (`src/app/api/admin/proposals/[id]/decide/route.ts`); "My
  Proposals" (`src/app/members/proposals/page.tsx`) buckets a member's own proposals into
  Drafts / Submitted & In Review / Decided; the locked detail view
  (`src/app/members/proposals/[id]/page.tsx`) shows a full append-only
  `<ProposalStatusTimeline>` with decider name, date, note, and cited minutes once
  available. QA independently verified the full email round-trip via the `email_queue`
  table (board notification correctly `blocked_non_production`, all three proposer emails
  `sent`). A member who submits an idea today has no reason to ever again wonder "did
  anyone see this."
- **The tri-state "not sure yet" mechanism is honest, not just present.** I traced
  `moneyNeeded`/`estimatedCostCents`/`estimatedCostUnknown` end to end — form → PATCH
  payload (always sends the coherent pair together) → server validation
  (`checkTriStateCoherence()`) → stored row → both the proposer's locked view and the
  board notification email render three genuinely distinct states ("Yes — estimated
  $1,234.56" / "Yes — amount not yet known" / "Not specified"). This was Phase 2's
  highest-flagged silent-data-bug risk and it shipped clean.
- **The three treasurer decisions are honored to the letter**, not just in spirit — see
  the diff below.
- **No scope crept in.** I grepped the entire proposals surface for anything resembling
  auto-creating an event, campaign, or budget line from an approved proposal — nothing.
  The out-of-scope ruling held.
- **Genuinely useful bug-hunting happened before this review, not after.** ux-developer's
  own click-through caught and fixed a real autosave/submit race and a real
  backfill-panel crash, both reproduced independently by qa against the shipped code, not
  re-read from the diff. That's the pipeline working as intended.

## Intent-vs-Shipped Diff

- **Phase 1 said** the paper form's dead end ("give completed form to any Board Member")
  needed to be replaced with a status the proposer can watch move, backed by a
  notification on every transition, not just on submit. **Shipped**: exactly that — a
  status list, a locked-view timeline, and an email on submit + every decision. **Verdict:
  matches.**
- **Phase 1 (treasurer decision #1) said** "Not yet identified" is a valid, board-visible
  chairperson answer, not a submit-time block. **Shipped**: `validateProposalSubmission()`
  requires `chairName` be non-empty but accepts the literal string; the form's helper text
  actively suggests it; the board sees it verbatim in the notification email and detail
  view; a reviewer can name a chair later via the decision panel's chair-override field,
  shown only when needed. **Verdict: matches.**
- **Phase 1 (treasurer decision #2) said** publicity should be one merged optional field,
  not two essay boxes. **Shipped**: a single `publicityPlan` column, one textarea, "How
  should we publicize this?" **Verdict: matches.**
- **Phase 1 (treasurer decision #3) said** a board review surface must exist alongside the
  email, with status + deciding meeting date. **Shipped**: `/admin/proposals` +
  `/admin/proposals/[id]`, gated by a real, independently-verified `PROPOSALS_REVIEW` key;
  five-state status (`Deferred` correctly added per the accepted Gap (d) ruling); a
  distinct `meetingDate` column separate from `decidedAt`, exactly per the post-Phase-3
  ruling. **Verdict: matches.**
- **Phase 1's Origin request said** "simplify the form a bit... let's not make it too
  daunting." **Shipped**: a single scrolling page, three sections, down from the paper
  form's 18 items. I counted what actually renders on a brand-new `/members/proposals/new`
  load (read `proposal-form.tsx` directly, not the design doc's summary): **10 visible
  input fields** (5 required, 5 optional) plus a read-only auto-filled proposer block —
  not literally "five questions," but that was never the agreed target; Phase 1's own
  agreed field set was "5 required + 7 optional/conditional" (2 of those 7 — cost, income —
  are genuinely conditionally hidden until triggered). The shipped form matches that
  agreed set faithfully and executes the accessibility research behind it: radio buttons
  instead of dropdowns on the sensitive fields, 44px+ tap targets, explicit "Required"/
  "(optional)" dual-marking on every field, a real autosave indicator, and a working
  three-way "not sure yet" affordance rather than a token gesture. **Verdict: matches, with
  a precision note** — when this goes back to the treasurer/board, describe it as "18
  fields down to about 10, in three short sections, with autosave," not "five questions" —
  the latter oversells what shipped and would read as a broken promise the first time
  someone counts.
- **Phase 3 said** every instant-in-time column would use `timestamp({ withTimezone:
  true })` to avoid reproducing the project's known naive-timestamp bug class, and that
  `proposedDate`/`meetingDate` would be plain `date` columns. **Shipped**: confirmed via
  database-admin's own `psql \d` check in Phase 4 — matches exactly. **Verdict: matches.**

## Edge Cases

| Check | Result |
|---|---|
| Empty state ("My Proposals" with zero proposals) | **pass** — "You haven't proposed a project yet" + a working "Start a Proposal" link, not a bare "No proposals" |
| Empty state (admin review list, zero submitted) | **pass** — confirmed present in `admin/proposals/page.tsx` per Phase 4 (UI) output |
| Failure microcopy (submit validation failure) | **pass** — field-keyed inline errors naming the specific field ("Chairperson is required…"), typed data never wiped, confirmed by both ux-developer's and qa's independent click-throughs |
| Failure microcopy (network/save failure) | **pass** — `SaveStateIndicator` shows "Couldn't save — check your connection," a real sentence, not a stack trace |
| Permission gate (`/admin/proposals` without `PROPOSALS_REVIEW`) | **pass** — redirects to `/access-pending`, confirmed live by qa with a real non-privileged session, not just a code read |
| Permission gate (`POST .../decide` without `PROPOSALS_REVIEW`) | **pass** — 403, confirmed live |
| Enumeration resistance (another member's proposal) | **pass** — 404, not 403, on both the page and the PATCH route, confirmed live and covered by a permanent e2e regression spec |
| Brand consistency (cards, buttons, ConfirmDialog) | **pass** — `rounded-2xl` cards, `rounded-lg` buttons, `<ConfirmDialog destructive>` on draft discard (grepped for `window.confirm`/`alert`/`prompt` and `rounded-full` on buttons across the feature's files — zero matches) |
| Copy — plain language, correct expectations | **fail (one instance)** — see Follow-ups; everywhere else copy is warm, accurate, and jargon-free |
| Mobile (360px) | **not verified** — flagged by ux-developer, not reached by qa, not independently re-verified live in this pass either (code read shows no multi-column layout in the interactive form that would obviously break, but "looks safe by construction" is not the same as a real check) |

## Follow-ups (SHIP WITH NOTES)

1. **B-42 (quick fix, treat as pre-launch)** — The proposer's decision-status-update email
   body prints the raw status enum (`decisionEmailHtml()` in
   `src/app/api/admin/proposals/[id]/decide/route.ts`, ~line 54: `${proposal.status}`
   instead of `${proposalStatusLabel(proposal.status)}`). Every other surface in this
   feature — the badge, the locked-view banner, the timeline, the admin panel — correctly
   calls `proposalStatusLabel()`; this one call site was missed. The email subject line is
   fine; the body directly beneath it will read "New status: under_review" verbatim to a
   real club member the first time a proposal moves to "Under Review." One-line fix.
   **This should land before the feature is used for a real board decision** — not a
   someday item, given the Communication Policy's September 17 general-meeting
   presentation makes real usage imminent.
2. **B-43 (should-do)** — No one has actually loaded the proposal form at a 360px
   viewport. Both ux-developer and qa flagged this as unverified; my own code read found
   nothing that obviously breaks (no multi-column layout in the interactive form; the one
   `sm:grid-cols-2` block is the read-only summary and collapses to one column below
   640px) but "correct by construction" is not the same evidence as a real check, and the
   club's membership is older and already uses the reimbursement flow from phones.
   Recommend a real pass before or shortly after go-live.
3. **B-44 (nice-to-have, low severity)** — Unlinked-account PATCH/DELETE on
   `/api/members/proposals/[id]` returns a uniform 403 instead of the id-specific 404,
   per qa's Phase 5 finding. Not an enumeration leak, just an edge case Phase 3 didn't
   name. No urgency.
4. **Process note, not a backlog item** — as of this review the feature is code-complete
   (typecheck/tests/build/e2e all green per qa) but **still sitting as uncommitted,
   unpushed changes** — nothing here is live yet. That's correct per CLAUDE.md's "do not
   auto-commit or push without explicit approval," but given the September 17 deadline is
   real and this is the required attachment to the Communication Policy the general
   membership votes on that day, someone needs to explicitly decide when this gets
   committed, pushed, and deployed — and qa's suggestion of a live demo for the
   treasurer/board before real use, given this is governance-adjacent, still stands and
   wasn't acted on in this review (out of scope for analyst to schedule).

## Outputs

- This section + the Per-Phase Status table's Phase 6 row
  (`docs/work-log/2026-08-09-project-proposal-form.md`).
- `docs/backlog.md` — added **B-42** (proposal decision email raw-status bug, quick fix,
  pre-launch priority), **B-43** (360px viewport check, should-do), **B-44** (unlinked-
  account PATCH/DELETE gate, nice-to-have).
- Files read for this review (no code changed by analyst): `src/components/members/
  proposal-form.tsx`, `src/app/members/proposals/page.tsx`, `src/app/members/proposals/
  [id]/page.tsx`, `src/components/members/proposal-status-timeline.tsx`,
  `src/components/admin/proposals/proposal-decision-panel.tsx`, `src/app/api/members/
  proposals/[id]/submit/route.ts`, `src/app/api/admin/proposals/[id]/decide/route.ts`,
  `src/app/members/profile/page.tsx`, plus a grep sweep for post-approval automation
  (event/campaign/budget-line creation) across `src/lib/proposals*.ts` and the API routes.

## Open Questions / Handoff Notes

- **This closes the pipeline as SHIP WITH NOTES, not SHIP IT** — per CLAUDE.md, that means
  it ships, but B-42 in particular should be fixed before the feature sees a real board
  decision, not filed away indefinitely. Whoever picks up B-42 does not need a new
  work-log entry (one-line fix, no design implications) — fix, verify the email body
  renders "Under Review" not "under_review," and check it off in `docs/backlog.md`.
- **Someone (not analyst) should decide the commit/push/deploy timeline against September
  17** and whether the treasurer/board gets a live walkthrough first — both were qa's
  suggestion, both are still open.

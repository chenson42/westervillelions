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
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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

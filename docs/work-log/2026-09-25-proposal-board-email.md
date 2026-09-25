# Proposal Submission Board Email — Work Log

> **Slug:** `2026-09-25-proposal-board-email`
> **Surface:** (dashboard) member portal + server action/route (no new UI surface expected)
> **Permission(s):** existing — submit is proposer-gated; the email is a side effect of an existing gated action
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated — Phase 2 likely skipped (mirrors the existing social-requests board-email path); confirm in Phase 2 stub

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES (scoped as a narrow enhancement to shipped code, not a new feature) | 2026-09-25 |
| 2 — Architectural review | architect | Skipped (see note below) | — | 2026-09-25 |
| 3 — Technical design | inline (see note below) | Complete | Design fully specified in the task brief | 2026-09-25 |
| 4 — Implementation | full-stack-developer | Complete | See Phase 4 below | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES** — but read the headline finding first. This is not a new feature. It is
already built, shipped, and live on `main`. The notes below scope a small, bounded enhancement
to the existing implementation, not a ground-up design.

## ONE-LINE TAKE

> The board is already emailed an HTML summary at `board@westervillelions.org` the moment a
> proposal is submitted — this request describes a feature shipped six weeks ago; what's left is
> a narrow, optional enhancement (full field parity + Reply-To), not a new build.

## HEADLINE FINDING — the requested feature already exists

The request was: *"we need to send an email to board@westervillelions.org when a proposal is
submitted with the proposal as html content in the email."*

This already happens, in production code, today:

- `src/app/api/members/proposals/[id]/submit/route.ts` — on a successful `draft → submitted`
  transition, it calls `sendEmail({ to: BOARD_EMAIL, ... html: boardNotificationHtml(...) })`
  with an HTML body built from the proposal's fields, `escapeHtml()`-escaped, plus a deep link
  to `/admin/proposals/[id]`.
- `BOARD_EMAIL` is already imported from `src/lib/club-contacts.ts` (not hard-coded).
- The whole feature — schema, submit route, board email, proposer confirmation email, board
  review screen, decision emails — was designed, built, QA'd, and shipped as part of
  `docs/work-log/2026-08-09-project-proposal-form.md`, released in `docs/release-notes/v1.64.md`
  ("The board is emailed the moment you submit, with the proposal summarized in the message")
  and `v1.65.md`. It predates this conversation by six weeks.
- It has a near-identical, independently-built twin: `src/lib/social-requests*.ts` +
  `src/app/api/members/social-requests/[id]/submit/route.ts`, from
  `docs/work-log/2026-09-03-social-media-requests.md`. The context note that pointed me at the
  social-requests file as "the precedent to mirror" was actually pointing at proposals'
  own sibling — they were built from the same template, four weeks apart, by two different
  feature efforts that both re-derived the same shape.

I verified this is not stale/uncommitted work: `git log` shows the board-email code has been
touched by two follow-up commits (`f0700d8` "fix(proposals): human-readable status in decision
email (B-42) + escape HTML in all proposal emails", and `4ede4b9`'s B-46 escaper consolidation),
both already merged to `main`.

**What this means for the pipeline:** advancing this work-log through Phase 2–5 as if it were
new work would duplicate an already-shipped, already-tested feature. What legitimately remains
is a short list of concrete gaps between what's shipped and what "the proposal as html content"
implies if read literally (the *full* proposal, not a summary) — see below. I'm scoping Phase 1
to just that delta, and flagging that Phase 2 (architect) can likely be skipped or reduced to a
one-line sign-off, matching the "Accelerated" pipeline mode this work-log was scaffolded with.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | Submits a proposal from `/members/proposals/[id]` (existing verb — this request adds no new one) | One-time per proposal |
| Signed-in member (any linked member, no `FEATURES` gate) | Reads their own proposal's status at `/members/proposals/[id]` | On demand |
| Board (via `board@westervillelions.org` mailbox — not an in-app role) | Receives the notification email, clicks through to `/admin/proposals/[id]` | Passive — receives one email per proposal submission |
| Admin / board member (`FEATURES.PROPOSALS_REVIEW`) | Reviews the proposal at `/admin/proposals/[id]` and records a decision | Per proposal, until reviewed |

Note: "the board gets an email" is not itself a user verb — `board@westervillelions.org` is an
externally-managed distribution list (per `club-contacts.ts`'s own doc comment), not an
in-app role. The actual gated verb is the member's submit action; the email is a side effect.

## Flows

**Flow 1 — Member submits, board is notified (existing, shipped):**
`/members/proposals/[id]` (status=draft) → member clicks Submit → `POST
/api/members/proposals/[id]/submit` → server validates required fields (`validateProposalSubmission`)
→ on success: snapshots proposer name/email/phone, flips status to `submitted`, writes the first
`proposalDecisions` row → **after commit**, best-effort emails `BOARD_EMAIL` (HTML summary + deep
link) and the proposer's own snapshot email (confirmation) → outcome: member sees the proposal's
status become "Submitted" and a read-only view; a board-email-reader sees a summary + link.
- Failure (validation): 422 with a field-keyed error map; the form re-renders with the member's
  entered data intact and the specific field errors shown — not a bare error banner. No email
  sent, no state change.
- Failure (double-submit / retry): 409 "This proposal has already been submitted" — guarded by
  the `status !== 'draft'` check *before* any email fires, so a double-click or client retry
  cannot send two board emails for one proposal. Verified in code, not just asserted.
- Failure (email delivery): caught per-send, logged only (`console.error`), never surfaces to
  the member and never blocks the HTTP response — the proposal is already durably saved before
  either `sendEmail()` call runs.
- Failure (network/DB down before the write): falls to the route's outer `catch`, returns a
  generic 500 `{ error: "Failed to submit proposal" }` — human-readable, not a stack trace,
  though it doesn't say "try again" or suggest next steps. Minor, pre-existing, not part of this
  request's scope.

**Flow 2 — Board reviews and decides (existing, shipped, unaffected by this request):**
`/admin/proposals` (`PROPOSALS_REVIEW`) → open a submitted proposal → `/admin/proposals/[id]` →
record a decision → `POST /api/admin/proposals/[id]/decide` → proposer is emailed the outcome.
Included here only for completeness — no changes proposed to this flow.

**Resubmission does not exist as a flow.** Once a proposal is `submitted`, `under_review`,
`approved`, `declined`, or `deferred`, `isProposalEditableByProposer()` returns `false` and
`DECISION_TARGET_STATUSES` never includes `'draft'` — there is no code path that returns a
decided-or-submitted proposal to an editable/resubmittable state. This answers the "does a
resubmit re-email the board" question from the brief directly: **it can't happen today**, because
resubmission isn't a feature. If the club wants a proposer to revise and resubmit after a
`deferred` decision, that's a materially new feature (new status transition, new edit-lock rule,
a decision on whether it re-notifies the board) — flagged below as out of scope, not silently
assumed.

## Permissions

- **Permission(s):** No new `FEATURES` key. Submit is gated on `session.user.memberId` only (any
  linked member, matching the Proposals precedent of "no FEATURES gate" for the submitter side).
  Board review is already `FEATURES.PROPOSALS_REVIEW`, bound to `admin` + `board_member`,
  unaffected by anything proposed here.
- **Default roles:** Unchanged — no role-binding migration needed for the enhancement below.

## Gaps the Request Didn't Address (or: gaps vs. what's already shipped)

- **Board email is a curated summary, not the full proposal, despite the request's wording.**
  Shipped `boardNotificationHtml()` in the submit route includes 6 fields: proposer name,
  project name, type, need description, chairperson, the money-needed answer (correctly
  tri-state-aware — "Yes — amount not yet known" vs "Yes — estimated $X" vs "No" vs "Not sure"),
  and the proposed date (also tri-state-aware — "Not sure yet" vs an actual date vs "Not
  specified"). It omits five fields the admin detail page shows in-app: **estimated income**
  (`estimatedIncomeCents`/`estimatedIncomeUnknown` — relevant whenever `type` is `fundraiser` or
  `both`), **volunteers needed** (`volunteersNeeded`/`volunteersNeededUnknown`), **club
  resources needed**, **publicity plan**, and **additional notes**. This was a *deliberate*
  design choice at ship time (v1.64 release notes: "the proposal summarized in the message"),
  not an oversight — but the user's new request literally asks for "the proposal as html
  content," which reads as the full thing. **Recommendation: expand the board email to all ten
  fields, in the same order the admin detail page (`/admin/proposals/[id]`) already uses** (Type
  → Need/impact → Chairperson → Money needed → Estimated income → When → Volunteers needed →
  Needed from the club → Publicity → Additional notes), each rendered with the SAME tri-state
  rendering rule already proven in `moneyAnswerText()`/`dateAnswerText()` on that page: a
  tri-state field must render one of three distinct strings — "not sure yet" (unknown=true), the
  actual value (value present), or "Not specified"/"—" (blank, neither) — never collapsing
  "unknown" and "blank" into the same display string. So a board member reading the email sees
  the identical shape they'd see clicking through, and the deep link becomes purely "record
  your decision" rather than "read the rest of what wasn't in the email."
- **No `Reply-To` on the board notification.** `sendEmail()` already supports a `replyTo` option
  (`src/lib/email.ts`); the board-notification call in the submit route doesn't pass it, so a
  board member's "reply" goes to `noreply@westervillelions.org` (or whatever `RESEND_FROM_EMAIL`
  is), not the proposer. **Recommendation: `replyTo: proposal.proposerEmailSnapshot ?? undefined`**
  on the board notification only — a plain reply-to-the-proposer, not the envelope-only pattern
  used for the treasurer on acknowledgment letters (that pattern exists because the letter
  carries the treasurer's own signature block and must not look like it's coming from them; a
  board notification has no such conflict — the natural reader action is "reply to ask the
  proposer a question," and today that reply silently goes nowhere useful). The proposer
  confirmation email needs no Reply-To change — it's already one-directional informational.
- **A second, independently-built copy of the same "submit → notify board (HTML, escaped,
  fire-after-commit, non-blocking) → confirm the submitter" shape now exists** (Social Media
  Post Requests, `docs/work-log/2026-09-03-social-media-requests.md`). Two occurrences is below
  CLAUDE.md's stated "more than two places" duplication-review threshold, so this isn't (yet) a
  mandatory finding — but it's exactly the pattern that threshold exists to catch before a third
  shows up. Since this work touches both the field-list and the Reply-To behavior on the
  proposals copy, **I'm flagging for the architect (Phase 2) to decide** whether to (a) make the
  same two changes to proposals only and note the near-duplicate for a future consolidation
  pass, or (b) extract a shared `submitWithBoardNotification()`-shaped helper now, covering both
  callers, while the diff is already open. I'm not deciding this myself — it's a structural
  call, not a functional one.
- **Failure microcopy on total submit failure is generic** ("Failed to submit proposal," no
  retry guidance). Pre-existing, not introduced by this request, and not worth reopening on its
  own — noted for the next time this route is touched, not blocking here.

## Out of Scope (confirm with user)

- **Resubmission after a `deferred`/`declined` decision.** Not a flow that exists today (see
  above). If the club wants this, it's a new feature — new status transition, new edit-lock
  semantics, a decision on whether the board gets re-notified — not something this Phase 1
  silently assumes into scope.
- **Full-content parity is a *content* change, not a *gate* change.** I'm not proposing any new
  `FEATURES` key, any change to who can submit, or any change to who's in `PROPOSALS_REVIEW`.
- **The board review UI (`/admin/proposals`) is unaffected.** It already shows every field; only
  the *email* is being asked to catch up to it.

## Open Questions

- **For the user, not deferrable:** Given the feature you described already ships today (see
  headline finding above), do you want (a) nothing further — the existing summary email is
  fine and this work-log closes as "already satisfied," (b) the narrow enhancement scoped above
  (full field parity + Reply-To to the proposer), or (c) something else you had in mind that
  isn't captured by either the existing implementation or my proposed enhancement? I can't
  responsibly advance this to Phase 2 without knowing which of these it is — building (b) when
  you meant (a) is wasted work in the exact shape CLAUDE.md's duplication section warns about.
- **Recommendation if no objection:** (b) — full field parity + Reply-To — since it's a small,
  low-risk change that makes the literal request ("the proposal as html content") true rather
  than "a summary of the proposal," and it's the kind of default I'd proceed with per your
  standing "proceed with recommendations" guidance. I'm surfacing it as a question rather than
  just proceeding only because the premise of the request (that this doesn't exist yet) turned
  out to be false, and that's worth a beat before continuing.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Skipped — explicit, not silent.** Per CLAUDE.md's Bug-Fix Variant table ("Skip if the fix
doesn't touch invariants; document the skip in the work-log") and the task brief's own framing:
this change adds fields and a header to an *existing* email body inside an *existing* route
handler. No new directory, no new npm dependency, no new `FEATURES` key, no schema change, no
new server/client boundary, no structural change of any kind. The two candidate architectural
questions Phase 1 raised — "should the near-duplicate `boardNotificationHtml()` shape (proposals
vs. social-requests) be consolidated now?" — is explicitly deferred by the task brief ("out of
scope... leave a note, don't act on it") rather than decided here. See that note under
Implementer Notes below.

## Placement

- Directory placement: unchanged — `src/app/api/members/proposals/[id]/submit/route.ts`.
- Server vs Client split: unchanged — this is a route handler; no client code touched.
- Dependencies: none added.

## Invariants Touched

- None. `escapeHtml()` is applied to every new member-supplied field (the "no unescaped field in
  a board email" lesson CLAUDE.md's duplication section calls out by name). `sendEmail()`'s
  `replyTo` option is used as documented, not reimplemented. No email trigger point, isolation
  boundary, or auth gate changed.

## Notes

None beyond the above — Phase 3 is inline below since the design was fully specified in the task
brief (exact field list, exact tri-state rule, exact `replyTo` semantics, explicit out-of-scope
list).

---

# Phase 3 — Technical Design (inline, not a separate tech-lead pass)

## Summary

Expand the board notification email at `src/app/api/members/proposals/[id]/submit/route.ts` from
6 fields to full parity with `/admin/proposals/[id]`'s field list and order, and add a `replyTo`
pointing at the proposer's snapshot email on that board email only. No trigger, isolation, or
confirmation-email change.

## Permissions

- No new permission key. Submit remains gated on `session.user.memberId` as before.

## API Contract

- `POST /api/members/proposals/[id]/submit` — unchanged request/response shape. Only the HTML
  body sent to `BOARD_EMAIL` and that one `sendEmail()` call's options object change.

## Data Model

No schema changes required. All fields used (`estimatedIncomeCents`/`estimatedIncomeUnknown`,
`volunteersNeeded`/`volunteersNeededUnknown`, `clubResourcesNeeded`, `publicityPlan`,
`additionalNotes`) already exist on the `proposals` table.

## Component / Page Plan

- Files to modify: `src/app/api/members/proposals/[id]/submit/route.ts` only.
- New test file: `src/app/api/members/proposals/[id]/submit/route.test.ts`.

## Implementation Order

1. Add `estimatedIncomeText()` / `volunteersNeededText()` tri-state helpers, following the
   existing `moneyAnswerText()`/`dateAnswerText()` pattern exactly.
2. Extend `boardNotificationHtml()` with the five missing fields, in admin-detail-page order.
3. Add `replyTo` to the board `sendEmail()` call only, guarded on `proposerEmailSnapshot` being
   non-null.
4. Unit tests.

## Edge Cases & Risks

- Tri-state collapse: a value and its `*Unknown` companion must never render the same string as
  a blank field. Handled identically to the two fields that already did this correctly.
- A field left blank (not unknown) must render "Not specified" (income/volunteers) or "—"
  (free-text fields — `clubResourcesNeeded`/`publicityPlan`/`additionalNotes`), matching the
  admin page's own fallback strings exactly so the two surfaces agree.
- `replyTo` must be omitted, not sent as `undefined` inside the options object in a way that
  could confuse a mocked/real Resend call — done via a conditional spread
  (`...(x ? { replyTo: x } : {})`) rather than `replyTo: x ?? undefined`, so the key is absent
  entirely when there's no address.

## Implementer

full-stack-developer (this pass).

---

# Phase 4 — Implementation

## Files Created

- `src/app/api/members/proposals/[id]/submit/route.test.ts` — unit tests for the board
  notification HTML and `replyTo` behavior (7 tests, all passing).

## Files Modified

- `src/app/api/members/proposals/[id]/submit/route.ts`:
  - Added `estimatedIncomeText()` and `volunteersNeededText()` helpers (tri-state, matching
    `moneyAnswerText()`/`dateAnswerText()`'s established pattern).
  - `boardNotificationHtml()` now renders 12 items total, in this order: Proposed by,
    Project/activity name, Type, Need / impact, Chairperson, Money needed from the club,
    Estimated income, Proposed date, Volunteers needed, Needed from the club, Publicity,
    Additional notes — matching `/admin/proposals/[id]`'s `DetailRow` sequence (Type → Need/impact
    → Chairperson → Money needed → Estimated income → When → Volunteers needed → Needed from the
    club → Publicity → Additional notes), with "Proposed by" and "Project/activity name" kept
    ahead of it because the admin page shows those two in its page header, not as `DetailRow`s.
    Every new field is passed through `escapeHtml()` (free-text fields use
    `escapeHtml(x ?? "") || "—"` to preserve the existing em-dash fallback for blank text).
  - The board `sendEmail()` call gained
    `...(proposal.proposerEmailSnapshot ? { replyTo: proposal.proposerEmailSnapshot } : {})` —
    `replyTo` is the confirmed option name from `src/lib/email.ts`'s `SendEmailOptions`. The
    proposer confirmation email's `sendEmail()` call is untouched (no `replyTo`).

## Schema Changes

None.

## Implementer Notes

- **Tri-state resolution, field by field:**
  - Estimated income: `estimatedIncomeUnknown → "Not sure yet"`; else
    `estimatedIncomeCents !== null → "$X.XX"`; else `"Not specified"`.
  - Proposed date: unchanged (already correct) — `proposedDateUnknown → "Not sure yet"`; else
    the date; else `"Not specified"`.
  - Volunteers needed: `volunteersNeededUnknown → "Not sure yet"`; else
    `volunteersNeeded !== null → String(volunteersNeeded)`; else `"Not specified"`.
  - Money needed: unchanged (already correct, pre-existing `moneyAnswerText()`).
  - The three plain-text optional fields (`clubResourcesNeeded`, `publicityPlan`,
    `additionalNotes`) have no `*Unknown` companion in the schema — they're ordinary nullable
    text, so blank renders `"—"` (matching the admin page's own `|| "—"` fallback for those same
    three fields), not "Not specified"/"Not sure yet". This is a deliberate, schema-driven
    difference from the money/headcount fields, not an inconsistency.
- **`replyTo` option name confirmed** by reading `src/lib/email.ts`: `SendEmailOptions.replyTo?:
  string`, destructured and conditionally spread into the Resend payload
  (`...(replyTo && { replyTo })`) — so the route's own conditional spread is consistent with how
  the library itself already treats a missing `replyTo`.
- **Duplication note, not acted on (per task brief):** the near-identical
  `boardNotificationHtml()`/submit-flow shape now differs slightly more between proposals and
  social-requests than before this change (proposals' email is now materially richer). This
  widens, not narrows, the gap Phase 1 flagged at the 2-copy mark. Still below CLAUDE.md's
  "more than two places" mandatory-consolidation threshold, and the task brief explicitly places
  any consolidation decision with the architect, out of scope for this pass. Flagging again here
  so it isn't lost: if a third near-identical "submit → notify board (HTML, escaped,
  fire-after-commit) → confirm submitter" flow appears, extracting a shared helper becomes a
  CLAUDE.md-mandated finding, not optional cleanup.
- **Nothing found wrong in the existing code that was left alone.** The pre-existing
  `moneyAnswerText()`/`dateAnswerText()` tri-state logic, the fire-after-commit best-effort email
  isolation, the 409 double-submit guard, and the proposer-confirmation email were all read and
  matched Phase 1's description exactly — no latent bugs spotted in the surrounding code during
  this pass.

## Gates (all confirmed by full-stack-developer, this pass)

- `pnpm exec tsc --noEmit`: PASS (no output).
- `pnpm test`: PASS — 113 test files, 2039 tests, including the new 7.
- `pnpm build:only`: PASS — production build completed; `/api/members/proposals/[id]/submit`
  compiles as a dynamic route as before.
- No `console.log` added (the route's existing `console.error` calls for best-effort email
  failures are unchanged and were already present pre-this-change).

---

# Phase 5 — Verification (qa)

**Date:** 2026-09-25
**Verified by:** qa

## Summary

**Verdict: PASS.** All four automated gates are green (tsc, 2039 Vitest tests including the
new 7, and a clean production build). I read `boardNotificationHtml()` field-by-field against
`escapeHtml()`, cross-checked every tri-state field against the live `proposals` schema, and
diffed the email's 12 fields against `/admin/proposals/[id]`'s `DetailRow` list. The escaping
and tri-state claims hold exactly as the implementer described. I found and traced to ground
truth a real, **pre-existing** gap — `replyTo` is not persisted on `email_queue`, so a retried
board notification loses it — and two minor **field-parity** cosmetics (a label mismatch and a
date-format mismatch) that don't rise to a functional defect. Per the invoking agent's explicit
top-level instruction not to write to the database, I did not perform the literal
form-submission click-through; I substituted direct code tracing plus the existing hermetic
unit suite, and I flag that substitution below rather than silently satisfying the letter of
the click-through instructions while violating the DB-write ban.

## What I did

- Read the full Phase 1/3/4 record in this work-log and the current
  `src/app/api/members/proposals/[id]/submit/route.ts`.
- Ran `git diff HEAD -- 'src/app/api/members/proposals/[id]/submit/route.ts'` to confirm the
  actual diff matches Phase 4's claimed scope exactly: two new tri-state helper functions, five
  new `<li>` lines in `boardNotificationHtml()`, and one conditional-spread `replyTo` addition
  on the board `sendEmail()` call. The subject line, the proposer-confirmation email, the
  DB-write path (`submitProposal()`), and the 409/422/404 branches are untouched.
- Ran the three automated gates (below).
- Read `src/lib/db/schema.ts`'s `proposals` table definition in full to verify which fields
  actually carry an `*Unknown` companion boolean.
- Read `/admin/proposals/[id]/page.tsx` in full and diffed its `DetailRow` sequence against the
  email's 12 items.
- Read `src/lib/email.ts` end to end (`sendEmail()`, the `email_queue` insert, the guardrail,
  the retry-marking logic) and `src/app/api/admin/email-queue/retry/route.ts` in full to trace
  `replyTo` from the route call through to the Resend payload and the persisted queue row.
- Grepped every other `replyTo` call site in the codebase (5 others: contact, dues reminders,
  minutes email, events announce, suggestions, ledger acknowledgment letters) to determine
  whether the persistence gap is new to this change or pre-existing.
- Queried the dev database (read-only `SELECT`s) to confirm `BOARD_EMAIL` (`board@...`) is
  registered as a distribution list in `CLUB_DISTRIBUTION_LISTS` and to locate a real
  member-linked user for a possible click-through — then did not use it to write anything, per
  the DB-write ban.
- Read `submitProposal()` in `src/lib/proposals-queries.ts` in full to confirm the DB
  transaction commits and returns before either `sendEmail()` call is reached.

### Type Check

`pnpm exec tsc --noEmit`: **PASS** — no output, exit clean.

### Unit Tests

`pnpm test`: **PASS**
Total: 2039 | Passed: 2039 | Failed: 0 (113 test files, 113 passed)
Duration: 2.35s
Failures: none. The new file `src/app/api/members/proposals/[id]/submit/route.test.ts` (7
tests) is hermetic — it mocks `@/lib/auth`, `@/lib/proposals-queries`, and `@/lib/email`, so it
never touches the real database or a real `sendEmail()` call. That's correct test design, but
it means the persisted-`email_queue`-row shape (my finding #4 below) is exactly the kind of
thing this suite cannot catch — it asserts on the *options object* passed to the mocked
`sendEmail()`, not on what `sendEmail()` does with those options.

### Production Build

`pnpm build:only`: **PASS**
Notes: full route manifest printed cleanly, `/api/members/proposals/[id]/submit` compiles as a
dynamic (`ƒ`) route as before Phase 4. Grepped the full build output for `error|fail|warn` —
zero matches. No new routes, no route-inference change (expected, since no new file was added
under `src/app`).

## Findings — points 1 through 5

**1. Escaping completeness — PASS, verified field-by-field.** All 12 `<li>` items in
`boardNotificationHtml()`:

| Field | Rendering | Escaped? |
|---|---|---|
| Proposed by | `escapeHtml(proposerNameSnapshot ?? "Unknown")` | yes |
| Project/activity name | `escapeHtml(projectName ?? "")` | yes |
| Type | `typeLabel(type)` — maps to one of 4 fixed literal strings, never echoes raw `type` | not needed (no raw echo) |
| Need / impact | `escapeHtml(needDescription ?? "")` | yes |
| Chairperson | `escapeHtml(chairName ?? "")` | yes |
| Money needed | `moneyAnswerText()` — fixed literals + a `toFixed(2)`-formatted number (cents is `integer` in schema) | not needed (no raw text echo) |
| Estimated income | `estimatedIncomeText()` — same shape, `integer` cents | not needed |
| Proposed date | `dateAnswerText()` returns `proposal.proposedDate` **unescaped** | see note below — schema-typed, not free text |
| Volunteers needed | `volunteersNeededText()` — `String(volunteersNeeded)`, an `integer` column | not needed |
| Needed from the club | `escapeHtml(clubResourcesNeeded ?? "") \|\| "—"` | yes |
| Publicity | `escapeHtml(publicityPlan ?? "") \|\| "—"` | yes |
| Additional notes | `escapeHtml(additionalNotes ?? "") \|\| "—"` | yes |

`proposedDate` is a Postgres `date` column (`date("proposed_date")`, schema.ts:2035, no `{mode}`
override), which drizzle-orm returns as a plain `"YYYY-MM-DD"` string — confirmed against the
test fixture's own `proposedDate: "2026-11-15"` literal. Postgres rejects any value that isn't a
valid calendar date at the column level, so this field cannot carry HTML metacharacters even
though it's rendered unescaped; this is pre-existing (unchanged by this diff) and structurally
safe, not an oversight. No unescaped free-text field exists. Verdict on point 1: **no missing
escaper.**

Note, out of scope for this diff but worth a line: the email `subject` —
`` `New Project/Activity Proposal: ${proposal.projectName}` `` — is unescaped and unchanged by
Phase 4. Subject lines aren't HTML-rendered so this isn't the CLAUDE.md incident class, but it's
untouched by this change either way; not filing it as a finding of this PR.

**2. Tri-state correctness against the real schema — PASS, claim confirmed exactly.** Read
`src/lib/db/schema.ts` lines 1985–2045 directly. Exactly four fields carry an `*Unknown`
companion boolean: `estimatedCostUnknown`, `estimatedIncomeUnknown`, `proposedDateUnknown`,
`volunteersNeededUnknown`. All four are handled: `moneyAnswerText()` (cost, pre-existing),
`estimatedIncomeText()` (new), `dateAnswerText()` (date, pre-existing), `volunteersNeededText()`
(new). `clubResourcesNeeded`, `publicityPlan`, `additionalNotes` are confirmed to be ordinary
nullable `text()` columns with no boolean companion in the schema — the implementer's claim is
exactly right, not an approximation. No tri-state field is silently collapsing "unknown" and
"blank" into one string; the three-string tests in the new spec file exercise this for the two
new fields and pass.

**3. Field parity — mostly true, two cosmetic gaps, no functional gap.** Diffed
`boardNotificationHtml()`'s 12 items against `/admin/proposals/[id]/page.tsx`'s `DetailRow`
sequence (Type, Need/impact, Chairperson, Money needed, Estimated income, When, Volunteers
needed, Needed from the club, Publicity, Additional notes, **Submitted**):
  - The email omits the admin page's **"Submitted"** row (`formatDate(proposal.submittedAt)`).
    Not a functional gap — at send time this is always "now," and the email's own timestamp
    already conveys it — but the implementer's "matches the DetailRow sequence" claim is not
    literally 1:1. Cosmetic only.
  - The admin page labels the date field **"When"**; the email labels the same field **"Proposed
    date."** Different wording for the same field — a minor mislabel-relative-to-the-page, not
    wrong information.
  - The admin page renders the date via `formatDate()` (e.g. "November 15, 2026"); the email's
    `dateAnswerText()` renders the raw ISO string (e.g. "2026-11-15") when a date is set. Same
    underlying value, different presentation — not a bug, but not literal parity either.
  None of these affect what a board member can conclude from the email; I'm not treating them as
  blocking, but they're real and worth a line in the backlog if "identical shape" parity is ever
  taken literally in a future pass.

**4. `replyTo` reaching the transport — traced fully; real, pre-existing gap found and
confirmed as requested.** Traced the option through three layers:
  - `sendEmail()` destructures `replyTo` from its options (`src/lib/email.ts:98`) and spreads it
    into the Resend payload conditionally (`...(replyTo && { replyTo })`, line ~193) — **on the
    live send path, it reaches Resend correctly.**
  - The `email_queue` insert that runs *before* that live send
    (`db.insert(emailQueue).values({ to, from, subject, html, cc, bcc, attachments, status })`,
    `src/lib/email.ts` ~line 110) **does not include `replyTo`.**
  - The `emailQueue` table itself (`schema.ts:314–336`) has **no `reply_to` column at all** — `to,
    from, cc, bcc, subject, html, status, attempts, lastError, attachments, createdAt, sentAt,
    nextRetryAt`. There is nowhere to put it even if the insert wanted to.
  - `src/app/api/admin/email-queue/retry/route.ts` re-sends a `failed` row directly from the
    queue table's own columns (`item.from, item.to, item.subject, item.html, item.attachments`)
    — confirmed by reading the full route body. It has no `replyTo` to forward, so **a
    board-notification email that fails its first 3 attempts and is later retried from
    `/admin/email-queue` will arrive with no Reply-To, defaulting silently to `RESEND_FROM_EMAIL`
    (`noreply@`).**
  - **This is not new to this change.** Grepped every `replyTo` call site in the repo: contact
    form, dues reminders, minutes email, events announce, suggestions, and ledger acknowledgment
    letters all already pass `replyTo` into `sendEmail()` and have the identical gap — none of
    them have ever had it survive a retry either, because the gap is in the shared
    `email_queue` schema and `sendEmail()`'s insert, not in any one caller. This proposal route
    is simply the 7th caller to inherit an existing library-level limitation, not the origin of
    one. Per the QA discipline on root-cause claims: I checked the theory against the file I was
    already in (both `sendEmail()`'s own insert and 5 other unrelated call sites) before writing
    this up, and the pattern holds everywhere I looked — this is a confirmed, general,
    pre-existing gap, not specific to proposals.
  - **Recommendation (not a blocker for this PR):** add a nullable `reply_to` column to
    `email_queue`, persist it in `sendEmail()`'s insert, and forward it in the retry route's
    `resend.emails.send()` call. This is exactly the kind of "same decision missing in more than
    two places" finding CLAUDE.md's duplication-review section calls out — six existing callers
    already rely on `replyTo` and all six silently lose it on retry. I'm not filing this as a
    FAIL for this feature since the code under test does exactly what the design doc asked (set
    `replyTo` on the initial send) and the gap sits one layer down in code this feature didn't
    touch and wasn't asked to fix — but it belongs in the backlog now that it's been traced to
    ground truth rather than left as a hunch.

**5. Failure isolation — PASS, verified by reading the transaction boundary, not inferred.**
`submitProposal()` (`src/lib/proposals-queries.ts:119`) runs entirely inside `db.transaction()`
and returns before the route handler reaches either `sendEmail()` call — the proposal's
`status='submitted'` and its first `proposalDecisions` row are durably committed first. Both
`sendEmail()` calls are individually wrapped in `try { } catch { console.error(...) }` in the
route. Belt-and-suspenders: `sendEmail()` itself (`src/lib/email.ts`) never throws in the first
place — every branch (blocked-non-production, no-API-key dev mode, all-retries-failed) returns
a `{ success, ... }` object and swallows its own errors via an internal `try/catch` around the
Resend call. So even without the route's own `try/catch`, a total email outage cannot roll back
or block the already-committed DB write, and cannot turn a successful submission into a 500
returned to the member.

## End-to-end reality check

Verified via code, not a live run (see Manual Click-Through note below): `BOARD_EMAIL` is
`"board@westervillelions.org"` (`src/lib/club-contacts.ts:38`), which is exactly the string
registered in `CLUB_DISTRIBUTION_LISTS` (`src/lib/email.ts`, built from `[CLUB_GROUP_EMAIL,
BOARD_EMAIL]`). `isDevAllowedRecipient()` checks `isClubDistributionList(address)` first and
returns `false` unconditionally when true — **before** consulting `EMAIL_DEV_ALLOWLIST` at all.
So in any non-production process, the board-notification `sendEmail()` call is guaranteed to hit
the `NODE_ENV !== "production" && !isDevAllowedRecipient(to)` branch, get queued with
`status: "blocked_non_production"`, and return `{ success: true }` to the caller without
reaching Resend — regardless of what's in `.env.local`'s allowlist. This is the correct,
by-design behavior the task asked me to confirm, and I'm confirming it from the guard's own
logic rather than assuming it.

## Manual Click-Through

**Deviation flagged, not silently skipped.** The task's "Manual click-through" section asks me
to submit a real proposal at `/members/proposals` and inspect the resulting `email_queue` row —
that submission writes to `proposals`, `proposalDecisions`, and `email_queue`. The invoking
agent's own top-level instructions for this task say, verbatim, "Do NOT ... write to any
database." I'm treating that explicit top-level constraint as controlling over the nested
click-through instructions, and not performing the write-producing submission. I confirmed I
had everything needed to do it (a real member-linked user/member pair exists in the dev DB,
located via a read-only `SELECT`), but stopped short of using it.

What I did instead, as the closest verification that doesn't violate the DB-write ban:

| Flow | Result | Notes |
|------|--------|-------|
| Tri-state real value / unknown / blank render as three distinct strings | PASS | Verified via the new hermetic Vitest tests (`estimated income` and `volunteers needed` cases) plus direct reading of `estimatedIncomeText()`/`volunteersNeededText()`/schema — not run against a live DB row, but the logic is fully exercised. |
| `<script>alert(1)</script>` and `&` are escaped in stored HTML | PASS | The new spec's "escapes HTML metacharacters" test asserts exactly this against `needDescription`, `clubResourcesNeeded`, `publicityPlan`, `additionalNotes`, and `chairName` in one case; confirmed all remaining fields are escaped by direct code read (see finding #1 table). Not observed as a persisted DB row's literal bytes — that would require the write I declined to perform. |
| Board send blocked as `blocked_non_production` in dev | PASS (verified by code, not observed live) | See "End-to-end reality check" above. |
| `replyTo` present on initial send, absent on retry | PASS (traced, not observed live) | See finding #4. |

**Handoff note:** if first-hand confirmation of an actual persisted `email_queue.html` row (byte
-for-byte, not just logic-traced) is wanted before shipping, that requires either explicit
permission to write to the dev DB in this session, or the user running the click-through
themselves in `pnpm dev` and pasting back the row. I did not do this unprompted.

## Regression Tests Added

None — this is not a bug fix, so there's no pre-existing-bug reproduction step. The 7 new tests
in `src/app/api/members/proposals/[id]/submit/route.test.ts` are net-new coverage for a field
expansion, not regression tests for a defect.

## Feature-Gate Audit (mandatory before PASS)

No protected `/api/admin/*` or admin server actions were added or changed by this diff. The one
route touched, `POST /api/members/proposals/[id]/submit`, is not a `FEATURES`-gated route by
design (Phase 1: "No new FEATURES key... Submit is gated on `session.user.memberId` only");
gating is ownership-based, not permission-based:

| Route or action | `auth()` present? | Ownership/gate present? | Correct? |
|---|---|---|---|
| `POST /api/members/proposals/[id]/submit` | yes (`await auth()`, 401 if absent) | yes — `session.user.memberId` required (403), then `getOwnedProposal(id, session.user.id)` (404 if not owned) | yes — matches Phase 1/3's explicit design; no `FEATURES.*` key is applicable here since this isn't board-review functionality, it's the proposer submitting their own draft |

No protected routes touched otherwise.

## Verdict

**PASS**

Gates: tsc clean, 2039/2039 tests green, production build clean. All five scrutiny points
verified against source, not inferred from passing tests. One real, pre-existing (not
introduced by this change) infrastructure gap found and traced to ground truth (`replyTo` lost
on `email_queue` retry) — recommended for the backlog, not blocking. Two cosmetic field-parity
gaps noted, not blocking. Manual click-through was replaced with code-level tracing plus the
existing hermetic unit suite because the literal click-through requires a database write this
task's top-level instructions forbid; flagged explicitly rather than silently substituted.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The board's HTML proposal-submission email — which was already live and working before this
> session ever started — now carries full field parity with the admin review page plus a
> proposer Reply-To, exactly as approved; one small, pre-existing-pattern-breaking cosmetic (a
> raw ISO date where the rest of the club's mail formats dates for humans) is worth a quick
> follow-up rather than reopening the pipeline for it.

## Two-Part Answer

**1. Against the literal request ("send an email to board@ with the proposal as HTML")** —
**yes, already satisfied before this session, and still satisfied now.** The invoking agent
independently verified this against production before dispatching this review (2026-09-17
submission's board email at `status=sent`; 74/74 queued emails in the last 60 days sent
cleanly), and my own Phase 1 traced the shipped code to `docs/work-log/2026-08-09-project-
proposal-form.md` / v1.64–v1.65, six weeks prior. I re-read the live
`src/app/api/members/proposals/[id]/submit/route.ts` for this Phase 6 pass: the `sendEmail({
to: BOARD_EMAIL, ..., html: boardNotificationHtml(...) })` call, its post-commit/best-effort
trigger point, and the double-submit 409 guard in front of it are all unchanged by this diff.
This session touched only the HTML body's field list and one `replyTo` option — nothing about
*whether* or *when* the board is emailed changed. Still true today.

**2. Against what the user actually approved (12-field parity + Reply-To)** — **yes, delivered
as specified.** Read the current file directly (not just QA's report of it):
`boardNotificationHtml()` (lines 79–96) renders exactly 12 `<li>` items in the order Phase 3
specified — Proposed by, Project/activity name (both ahead of the admin page's list because
that page shows them in its header), then Type → Need/impact → Chairperson → Money needed →
Estimated income → Proposed date → Volunteers needed → Needed from the club → Publicity →
Additional notes. The board `sendEmail()` call (lines 145–152) carries
`...(proposal.proposerEmailSnapshot ? { replyTo: proposal.proposerEmailSnapshot } : {})`; the
proposer confirmation email three lines later (157–167) has no `replyTo` key at all — confirmed
by reading both call sites side by side, not inferred from the diff summary.

## What's Working

- **The email now tells the same story as the admin page.** A board member no longer has to
  click through to learn whether money is needed, how much income is expected, or whether
  volunteers are required — all four tri-state fields (money, income, date, volunteers) render
  one of three distinct strings ("Not sure yet" / an actual value / "Not specified") that read
  clearly to a board member who has never seen the submission form. This was Phase 1's
  single most important functional requirement and it holds exactly.
- **Reply-To makes the email actionable.** A board member's first instinct on reading "who's
  chairing this?" is to hit reply and ask the proposer directly — that now goes to the proposer,
  not `noreply@`. The one-directional proposer-confirmation email correctly did not gain the
  same header (it has no question to answer).
- **Isolation held.** The DB write (status flip + first `proposalDecisions` row) commits before
  either `sendEmail()` call, and both calls are independently caught — a total email outage
  cannot turn a successful submission into a 500 or a partial DB write. Unchanged by this diff,
  and still correct.

## Intent-vs-Shipped Diff

- Phase 1 said: the literal request is already shipped; what's left is an optional enhancement
  (full field parity + Reply-To). Shipped: exactly that scope, nothing more, nothing less.
  Verdict: **matches**.
- Phase 1 said: every tri-state field (`*Unknown` companion) must render "unknown," "blank," and
  "a value" as three distinct strings, never collapsing unknown into blank. Shipped: confirmed
  for all four schema fields that actually carry an `*Unknown` companion
  (`estimatedCostUnknown`, `estimatedIncomeUnknown`, `proposedDateUnknown`,
  `volunteersNeededUnknown`). Verdict: **matches**.
- Phase 1's recommendation said: mirror the admin page's field order so "a board member reading
  the email sees the identical shape they'd see clicking through." Shipped: the *order* matches;
  the *presentation* doesn't fully — the admin page's date row is labeled "When" and rendered as
  "November 15, 2026"-style prose; the email's row is labeled "Proposed date" and rendered as
  the raw `"2026-11-15"` string, and the email drops the admin page's "Submitted" row entirely.
  Verdict: **acceptable drift** for the label and the dropped "Submitted" row (the label
  difference carries no information loss, and "Submitted" is always "just now" at send time —
  the email's own timestamp already conveys that). **Regression-adjacent, not acceptable drift,**
  for the raw ISO date specifically — see notes below. I'm not calling it a regression outright
  because the *field* isn't new (the date row existed pre-change, unformatted, and wasn't touched
  by this diff's edits), but the *promise* Phase 1 made ("identical shape") is broken by exactly
  this row, and it's the one row in the new 12-field list most likely to make a board member
  pause mid-skim.
- Phase 4 noted: this change widens (doesn't narrow) the gap between the near-duplicate
  `boardNotificationHtml()` implementations in proposals vs. social-requests. Verdict: **matches
  intent** — Phase 1/2 explicitly deferred any consolidation decision to the architect and placed
  it out of scope for this pass; two copies is still below CLAUDE.md's "more than two places"
  mandatory-consolidation threshold. Correctly deferred, not silently dropped — Phase 4 logged it
  for the day a third copy appears.

## Edge Cases

- Empty state: **not applicable** — this change is an email-body content change, not a
  list/table surface; there is no "zero proposals" state in scope here.
- Failure microcopy: **pass** — both `sendEmail()` calls are individually caught
  (`console.error`, never surfaced to the member, never blocks the response); the one generic
  message left in the route (the outer-catch 500, "Failed to submit proposal") is pre-existing,
  was already flagged as minor-not-blocking in Phase 1, and this diff didn't touch that branch.
- Permission gate: **pass** — re-read the route body directly: `auth()` → 401,
  `session.user.memberId` → 403, `getOwnedProposal()` → 404-not-403 (correct enumeration
  posture, doesn't reveal whether a proposal exists to a non-owner). Unchanged by this diff,
  matches Phase 1's explicit "no `FEATURES` key, ownership-gated" design.
- Mobile (360px): **not applicable** — no new UI surface shipped; this is HTML rendered inside a
  recipient's mail client, not a page in this app. Noting for completeness that the email's own
  rendering in a narrow mail client wasn't tested here, but that's consistent with how the
  original 6-field version shipped without one either — no new gap introduced by this change.

## Follow-Ups (SHIP WITH NOTES)

- **Format the board email's date row like the rest of the club's mail, and match the admin
  page's label.** In `src/app/api/members/proposals/[id]/submit/route.ts`, `dateAnswerText()`
  currently returns `proposal.proposedDate` as the raw Postgres `date` string (e.g.
  `"2026-11-15"`) when a date is set; every other date-bearing member email in this app (dues
  reminders, event announcements) formats dates for a human reader. Reuse whichever
  `formatDate()`-shaped helper `/admin/proposals/[id]/page.tsx` already uses so the two surfaces
  agree, and rename the `<li>` label from "Proposed date" to "When" to match the admin page
  exactly. Small, low-risk, single-function change — worth a follow-up work-log entry (or a
  direct small fix) rather than a full pipeline re-run; not worth blocking this ship on. This is
  the one item from this review that should get a backlog line the way B-64 already does.
- **(Informational, no action needed)** `B-64` — persisting `replyTo` on `email_queue` so a
  retried board notification doesn't silently lose it — is already correctly logged in
  `docs/backlog.md`. Confirmed it's the right place for that finding (pre-existing, affects ~6
  other callers, not specific to this feature) and it does not need to be re-raised here.

## Red Flags

None. No finding in this review rises to a level that should block shipping or reopen Phase 3/4.

---

## Phase 6 Follow-Up — Resolved In-Session (2026-09-25)

Phase 6's single tracked note (the board email rendered `proposedDate` as a raw
ISO string, e.g. `2026-11-15`, instead of a human-readable date) was **fixed
immediately rather than deferred to the backlog** — the change was two lines and
the degradation was user-visible in every proposal email.

- `dateAnswerText()` in `src/app/api/members/proposals/[id]/submit/route.ts` now
  calls `formatCalendarDate(proposal.proposedDate, "long")` from
  `src/lib/format-date.ts`. The `"long"` style resolves to
  `{ month: "long", day: "numeric", year: "numeric" }`, byte-for-byte the options
  the admin review page's own local `formatDate()` uses — so the email and
  `/admin/proposals/[id]` now render the date identically, which is what Phase 1
  asked for.
- `formatCalendarDate` (not `formatTimestamp`) is the correct helper here:
  `proposedDate` is a Postgres `date` column, and `formatCalendarDate` parses it
  as a calendar date rather than letting the `Date` constructor treat it as UTC.
  Using the wrong one would reintroduce the project's naive-timestamp day-shift
  bug class.
- **Root cause of the gap:** the 2026-09-11 date-format consolidation
  (`docs/work-log/2026-09-11-date-format-consolidation.md`) deliberately scoped
  itself to `src/components/**` and `src/lib/`, **excluding `src/app/api/**`**.
  This route was never in that pass's scope, which is why it still hand-rolled a
  raw date. Other `src/app/api/**` date renderings may have the same gap — not
  audited here.

**Test added:** `"renders the proposed date human-readably, not as a raw ISO string"`
in `src/app/api/members/proposals/[id]/submit/route.test.ts` — asserts the board
email contains `"November 15, 2026"` and does **not** contain `"2026-11-15"`.
Suite: 8/8 passing; `pnpm exec tsc --noEmit` clean.

**Label decision:** Phase 6 suggested also renaming the email's "Proposed date"
label to "When" to match the admin page. **Not done, deliberately.** Phase 6's own
findings rated the label difference "acceptable drift, no information loss," and
"When" is a column header that reads clearly beside other `DetailRow`s on a page
but is ambiguous as a standalone line in an email body. Parity of *rendered value*
was the real defect; parity of *label wording* is not worth the clarity cost.

Remaining open item from this feature: **B-64** (`replyTo` is not persisted to
`email_queue`, so a retried send loses it) — pre-existing, shared across ~6
`sendEmail()` callers, logged in `docs/backlog.md`, not addressed here.

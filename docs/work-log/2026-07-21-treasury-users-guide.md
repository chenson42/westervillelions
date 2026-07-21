# Treasury User's Guide — Work Log

> **Slug:** `2026-07-21-treasury-users-guide`
> **Surface:** (dashboard) admin — The Ledger (in-app guide surface; shape TBD in Phase 1)
> **Permission(s):** likely existing `LEDGER_VIEW` (guide describes ledger surfaces) — Phase 1/3 to confirm
> **Estimated complexity:** medium (content-heavy, light logic)
> **Pipeline mode:** Full — content architecture matters more than code here; Phase 2 may be
> light but placement (new page vs contextual panels) is a real architect call
> **Origin:** backlog **B-01** (graduated 2026-07-21 at the user's request, to run in parallel
> with reconciliation inc2)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-21 |
| 4 — Implementation | ux-developer | Complete | — | 2026-07-21 |
| 5 — Verification | qa | Complete | PASS | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-21 |

---

## Intent (B-01 + user's content notes, 2026-07-21)

An in-app user's guide for The Ledger, embedded in the treasury/admin surface.
Audience: the treasurer **and a future successor** — this doubles as
treasurer-succession documentation (same motivation as v1.27's books
onboarding). Should reflect shipped reconciliation behavior — the
reconciliation section lands when inc2 ships, or is written against inc2's
design (Phase 1 to recommend sequencing).

### User's content notes (2026-07-21, verbatim intent — the guide's seed outline)

1. **Chase account ownership transition** (treasurer succession):
   - Meeting minutes are required when switching people as signers on the
     account, plus **two forms of ID** (a credit card works as a second ID).
   - Make the **treasurer the primary** on the account.
   - Attendees needed at the bank: the **new president, the new treasurer, and
     one of the two signers from the previous year**.
   - Budget about **two hours** at the branch.
2. **Compliance calendar:** **Form 990** (IRS annual filing; FY ends June 30 →
   990-N/990-EZ due November 15). User confirmed 2026-07-21 ("590" was a typo).
   The Ledger's compliance/990-prep surface should be cross-referenced here.
3. **Compliance and reports:** the guide should cover the Ledger's compliance
   view (guardrails and what their warnings mean) and the reports surface.
4. **Donors & acknowledgments: EXCLUDED for now** — user: "not sure about the
   use for donors yet, let's leave that doc out." Do not document that surface
   in v1 of the guide.
5. **Zeffy + fund routing** (per the revised T-17 policy):
   - Dues paid via Zeffy land in the **club (admin) account**.
   - Donations via Zeffy land in the club account too but are recorded to the
     **Activity Fund** — a clearing account / "landing place" for
     foundation-bound money — and must be **promptly moved to the Foundation
     account**; document the transfer process (write the check/transfer, record
     club Activity Fund expense → Foundation income, cite the board minute
     where applicable).
6. **Ledger settings:** document what they are and establish an **annual
   review** of them (e.g., at fiscal-year rollover / treasurer transition).

### Additional grounding for Phase 1 (orchestrator notes)

- `docs/treasurer-todo.md` reference notes (Activity Fund pass-through policy,
  Zeffy Monday lump-deposit behavior) are source material for §5.
- The Ledger's existing surfaces to document: books/register, dues,
  reimbursements, compliance/990 prep, reports, uncashed checks, receipts +
  waivers (v1.31), public gift descriptions (v1.31), reconciliation (inc2, in
  flight), settings.
- Bank-transition content (§1) is club operational knowledge, not app
  behavior — Phase 1 should decide where it lives (a "treasurer transition"
  guide section alongside app docs is the obvious answer).

---

# Phase 1 — Functional Refinement (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** READY WITH NOTES

## Summary

A single in-app Ledger guide page, hardcoded server-rendered content, gated on the existing
broadest Ledger read-gate (no new `FEATURES` key). The user's six content notes are the
required **spine**, not the full table of contents — a successor treasurer reading end-to-end
needs the *whole* Ledger surface documented (books, dues, reimbursements, receipts/waivers,
compliance/990, reports, uncashed checks, reconciliation, settings), and Phase 3 should treat
the six notes as mandatory sections within a larger, complete TOC. The reconciliation section
is the one place this feature must be careful: inc2 (sessions/CSV upload/tie-out) is designed
but not yet built past schema, so v1 of the guide documents what's *actually live today*
(check numbers, the per-row reconcile toggle, the uncashed-checks panel) and stubs the rest as
"coming soon," rather than either blocking on inc2 or publishing instructions for a UI that
doesn't exist yet and may still shift. No open questions require the user — every fork point
below has a recommended default; the user's real decisions (donors excluded, T-17's revised
single-Zeffy-account/Activity-Fund plan) are already made and just need to be carried forward
accurately.

## What I did

Read the work-log Intent in full (user's six content notes + orchestrator grounding notes).
Read `docs/treasurer-todo.md` in full, especially T-04 and T-17 (Activity Fund pass-through
policy and its 2026-07-21 revision — single Zeffy account, donations routed through the
Activity Fund and swept to the Foundation) and the two reference notes (Activity Fund
target-balance-$0 policy; Zeffy Monday lump-payout reconciliation practice). Enumerated the
actual admin Ledger route tree: `/admin/ledger` (dashboard/overview), `/compliance`,
`/reports`, `/donors` + `/donors/[id]`, `/reimbursements`, `/approvals`, `/settings`,
`/[fundSlug]` + `/[fundSlug]/report`. Read the auth gates on `page.tsx`, `compliance/page.tsx`,
`settings/page.tsx`, `reports/page.tsx`, `approvals/page.tsx`, `reimbursements/page.tsx` —
every read surface gates on `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE,
(LEDGER_APPROVE on reimbursements)])`; `settings` alone gates strictly on `LEDGER_MANAGE`.
Read `src/lib/permissions.ts` (`LEDGER_VIEW` / `LEDGER_RECORD` / `LEDGER_MANAGE` /
`LEDGER_APPROVE` definitions). Read `ledger-settings-form.tsx` in full for the exact settings
fields (disbursement approval threshold, reserve warning threshold, public-fund holding-period
days, treasurer-bonded checkbox, philanthropy visibility). Grepped `guardrails()` in
`src/lib/ledger.ts` for the full list of guardrail titles/severities (14 distinct guardrails).
Read `panel-990.tsx` to confirm the 990 determination is a *live, computed* value
(`determine990()`), not something to hardcode. Read release notes v1.27 (treasurer's books
onboarding precedent — `docs/treasurer-todo.md` origin, real-books seed), v1.30 (structured
check numbers, failed-login visibility, receipt-upload groundwork), v1.31 (transaction receipts
+ waivers, public gift descriptions). Read the in-flight reconciliation parent work-log
(`2026-07-21-bank-reconciliation.md`, Phases 1-3 complete) and inc2's design doc
(`2026-07-21-ledger-reconciliation-sessions.md`, Phase 3 complete, Phase 4 "in progress —
Increment A (database-admin: schema + migration + parser lib) complete" — meaning **no route
or UI exists yet** for sessions/CSV upload/matching/close/reopen) to ground the reconciliation-
timing recommendation in what is actually shippable today versus still speculative.

### Pass 1 — User verbs

Single surface: **Admin** (treasurer / successor treasurer / any board member holding a
`LEDGER_*` permission). No anonymous, access-pending, or signed-in-member verbs apply — this
is not a public or member-portal surface, and it's the exception to the project's usual
three-surface spread for the same reason the reconciliation feature is: purely internal
tooling. Naming this explicitly so it isn't read as an oversight.

- Admin: opens the guide from the Ledger nav (new sidebar entry, alongside Compliance/Reports/
  Donors/Settings)
- Admin: reads a table of contents and jumps to a section via anchor link
- Admin: reads a section start-to-finish (successor-treasurer full read-through is the primary
  use case named in the Intent)
- Admin: follows a cross-link out of a guide section into the live surface it describes (e.g.,
  "Guardrails" section → link to `/admin/ledger/compliance`)
- Admin: (recommended, not requested) prints the page for the in-person bank-transition visit

No "the user" ambiguity to flag here — every verb is unambiguously the admin/treasurer surface.
The one nuance worth naming: a board member who holds only `LEDGER_APPROVE` (approves
disbursements/reimbursements but doesn't record or manage) should still be able to read the
guide, since some sections describe actions they can't personally perform (e.g., Settings is
`LEDGER_MANAGE`-only) — the guide is descriptive for everyone with any Ledger foothold, not
prescriptive only for whoever can act on every section.

### Pass 2 — Flow audit

This feature is read/navigation only — no mutation, so the flow audit is thinner than a typical
Ledger feature by design. Naming that explicitly rather than inventing a false failure path.

**Flow 1 — Land on the guide**
Entry: Admin sidebar → Ledger → new "User's Guide" nav entry.
Steps: page loads (server component, hardcoded content — no DB fetch required for most
sections, see Storage recommendation below); table of contents at top; reader scrolls or
clicks a TOC entry to jump to `#anchor-id`.
Success: reader can read linearly end-to-end (the successor-treasurer primary use case) or jump
directly to one topic.
Failure: none in the traditional sense — there's no network/DB call to fail for statically
hardcoded content. This is itself a point in favor of the storage recommendation below: hard-
coding eliminates an entire failure-path category ("what if the guide's content fails to load")
that a DB-backed page would have to handle with its own loading/error state (matching the
existing `LoadErrorCard` pattern on `/admin/ledger`). If Phase 3 chooses to hydrate a few live
values (see Pass 4), *those specific inserts* need the existing error-fallback pattern — the
static prose around them does not.

**Flow 2 — Cross-link into a live surface**
Entry: a guide section names a live surface (e.g., "see your current 990 determination on the
Compliance page").
Steps: click an internal `<Link>` → navigate to the real page (`/admin/ledger/compliance`,
`/admin/ledger/settings`, etc.).
Success: lands on the real, current, live surface — never a stale copy of what that surface
shows.
Failure: link rot if a target route is ever renamed — mitigated by using Next.js `<Link>` (so a
broken href is at least visually/manually catchable during Phase 5's click-through) rather than
raw `<a>` tags; no dynamic route params are involved since every cross-link target is a static
top-level Ledger subpage.

**Flow 3 — Successor onboarding read-through (the feature's actual reason to exist)**
Entry: a newly-onboarded treasurer, freshly granted `LEDGER_*` features as part of a transition,
opens the guide for the first time.
Steps: reads the bank-transition section (club process, not app), the compliance-calendar
section (990/Nov 15), the guardrails + reports sections, the Zeffy/fund-routing section, the
settings + annual-review section, plus the fuller surface-area sections named in Outputs below.
Success: the successor understands the operational and app picture without needing to
interview the outgoing treasurer for basics — this is the actual value proposition and should
be the yardstick Phase 6 measures against.
Failure: N/A (read-only); the "failure" in spirit is stale content drifting from shipped
behavior — addressed under Maintenance below, not as a runtime failure path.

### Pass 3 — Permissions

**`LEDGER_VIEW` — confirmed, no new key.** Every existing Ledger read surface
(`/admin/ledger`, `/compliance`, `/reports`) gates on
`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])`; `/reimbursements` additionally
includes `LEDGER_APPROVE`. The guide describes all of these surfaces, including reimbursements
and approvals, so recommend gating it on the **broadest** existing set —
`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` — matching the
reimbursements page's precedent exactly, so anyone with *any* foothold in the Ledger can read
the guide. Default roles: nothing to bind in a migration — whoever already holds any
`LEDGER_*` feature (Treasurer today, any board approver) sees the guide automatically the
moment it ships.

### Pass 4 — Edge cases the request didn't mention

- **OAuth vs. password:** not applicable — inert content behind an existing feature gate,
  identical for both sign-in paths.
- **Access-pending:** a user with zero Ledger features gets the existing `/access-pending`
  redirect via the same gate every other Ledger subpage already uses — no new handling needed.
- **Email queue:** not applicable — no email in this feature; confirming as an explicit
  non-goal so it isn't invented in Phase 3.
- **Google Group sync:** not applicable — no membership/committee touchpoint.
- **Empty state:** not applicable in the traditional DB-empty-list sense (no list to be empty)
  — **but the reconciliation section is this feature's real analog to an empty state**, and it
  must read as a deliberate "this is coming, here's what exists today" note, not as a silent gap
  that looks like an oversight. See the reconciliation-timing recommendation below — this is
  the single most important edge case in this feature.
- **Failure microcopy:** minimal surface, since content is static. The one place a real fetch
  could occur: if Phase 3 chooses to hydrate a few numeric values live (see below), those
  specific inserts need the existing `LoadErrorCard`-style fallback; the surrounding static
  prose does not.
- **Mobile (360px):** text-and-links content is inherently mobile-friendly. The one risk is a
  fixed-position sidebar TOC — recommend a simple stacked/inline TOC (or a `<details>`
  disclosure) rather than a fixed side rail, consistent with how Compliance/Reports already
  just stack content top-to-bottom on narrow screens.
- **Brand consistency:** section cards `rounded-2xl` (matching the `Panel990`/
  `StandingReminders` precedent already on the Compliance page); breadcrumb + eyebrow + `h1`
  header matching the Settings/Compliance page convention rather than a new hero style;
  cross-links `text-lions-blue hover:underline`; no forms, so `<ConfirmDialog>` doesn't apply.
- **Live-value drift (new edge case this feature specifically introduces):** several sections
  describe numbers that can change independently in Settings (disbursement threshold, reserve
  threshold, holding-period days) or are computed dynamically (990 form determination). If the
  guide hardcodes example numbers ("a guardrail warns when reserves fall below $1,000"), those
  numbers **will** drift from whatever the treasurer actually configures and the guide will
  start lying. Recommend: numeric threshold callouts and the current 990 form should either (a)
  be phrased generically ("the amount configured on the Settings page," not a dollar figure) or
  (b) be pulled live via the existing `getSettings()` / `determine990()` calls for just those
  specific inserts. Flagging as a Phase 3 design choice, not deciding it here — either resolves
  the drift risk, (a) is simpler and has zero failure-path surface.
- **Print (asked explicitly in the brief):** recommend relying on the browser's native print,
  with a light `print:hidden` Tailwind treatment on the admin sidebar/nav chrome so a printed
  copy is just the guide content. This is a real, cheap value-add given §1 describes an
  in-person bank visit where a printed reference plausibly helps — recommend it as a nice-to-
  have Phase 3 can include almost for free, not a hard requirement.

### Pass 5 — Adversarial pass

This pass is almost entirely not-applicable because the feature is a read-only content page,
not a transactional flow — naming that explicitly rather than skipping the rubric silently.

- **Redirect targets:** none — no `callbackUrl`/`next`/`redirect` parameters anywhere in this
  feature.
- **State-machine shortcuts:** not applicable — nothing to skip; there's no sequence of steps
  to short-circuit on a read-only page. If Phase 3 adds live-value hydration (Pass 4), that data
  must flow through the existing gated query functions (`getSettings()`, `determine990()`), not
  a new ungated endpoint — trivially satisfied since it reuses the existing page pattern.
- **Enumeration leaks:** not applicable — no account-existence disclosure surface.
- **Input boundaries:** not applicable — no form on this page in v1.
- **Self-targeting:** not applicable — no privilege-granting action here.

## Outputs

- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 1 section; Per-Phase Status
  row updated to `Complete / READY WITH NOTES / 2026-07-21`.
- No source files touched (Phase 1 is read-only on source per this task's instructions).

### Shape recommendation

**Single guide page under `/admin/ledger` (`/admin/ledger/guide`), sectioned with linkable
anchors — not contextual per-surface help panels, and not both, for v1.** The successor-
treasurer end-to-end read is the primary use case named in the Intent, and a single linear
document serves that far better than help scattered across a dozen pages that a first-time
reader would have to discover one at a time. Contextual pointers (a small "?" link on, say, the
Compliance page's guardrail list that jumps to `/admin/ledger/guide#guardrails`) are cheap,
optional polish that can be added later or even in this same increment if trivial — but they
are not a substitute for the single page, and building a full contextual-help system alongside
the single page would be solving a problem the Intent didn't ask for. Route/component placement
follows the existing per-subpage convention exactly (`settings`, `donors`, `compliance`,
`reports`, `reimbursements`, `approvals`, `[fundSlug]` all live the same way today) — new nav
entry in the admin sidebar's Ledger section, alongside the existing four.

### Content storage recommendation

**Hardcoded server-component content (JSX prose + `<section id="...">` anchors), not
DB-backed.** This mirrors the existing `Panel990`/`StandingReminders` precedent already living
on the Compliance page — static explanatory content composed with a handful of live data
inserts where drift risk is real (Pass 4). Arguments for hardcoded over DB-backed: (1) the
guide's authors are developers who ship it alongside the feature it documents — there is no
non-technical content-editor persona for this project the way there might be for, say, public
marketing copy; (2) DB-backed editable content means building a small CMS (schema, an edit UI,
a permission gate on *editing* the guide) for a single page, which is a materially larger scope
than the Intent asked for; (3) hardcoded content ships through the same PR/review discipline as
the feature changes it documents, which directly supports the Maintenance recommendation below.
Flagging for architect to rule on formally (per the brief's explicit ask), but this is not a
close call given the codebase's existing precedent.

### Reconciliation-timing recommendation

**Ship the guide now, in parallel with inc2/inc3, with a scoped "live today" section plus an
explicit "coming soon" callout — do not block on inc2, and do not write step-by-step
instructions against inc2's design.** Concretely:

- Document what's **actually shipped and reachable today**: the structured `checkNumber` field
  on transactions (v1.30), the per-row reconcile toggle, and the uncashed-checks panel. These
  are real, stable UI a successor treasurer will encounter regardless of when inc2 ships.
- Add a clearly-labeled "Bank statement reconciliation (coming soon)" subsection describing *at
  the concept level* what's planned (upload a Chase statement export, the system helps match it
  against the books, a session only closes when it balances to the penny) — enough to set
  correct expectations, without naming specific buttons, routes, or screens that don't exist yet
  and could still change (inc2's Phase 4 has only landed schema; no route or UI exists as of
  this writing).
- When inc2 (and later inc3) ships, expanding this section is a normal follow-up task on that
  feature's own work-log — not a dependency that blocks this guide's v1 release. This is the
  shape that satisfies "wanted in parallel" without either blocking on unfinished work or
  publishing instructions that will be wrong the day inc2 actually ships.

### Permission recommendation

`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` — see Pass 3. No
new `FEATURES` key, no migration.

### Content scope — the spine vs. the full table of contents

The user's six notes are necessary but **not sufficient** as a table of contents. A successor
treasurer doing an end-to-end read needs the *whole* Ledger documented, not just the six topics
that were top of mind when the backlog item was written. Recommend Phase 3 treat the six notes
as **mandatory sections** within a fuller TOC that also covers the existing surfaces the
orchestrator's grounding notes already named: books/register & transaction entry, dues,
reimbursements + approvals, receipts & waivers (v1.31), public gift descriptions (v1.31),
uncashed checks, the fund detail/report pages (`[fundSlug]`), and settings. Concretely:

1. **Treasurer transition — Chase account ownership** (user's note 1; club/bank process, not
   app behavior; label it as such so a reader doesn't go hunting for a matching UI screen).
2. **Compliance calendar — Form 990** (user's note 2; cross-link to the live Compliance page's
   990 determination rather than hardcoding a form name/date beyond "November 15").
3. **Compliance guardrails** (user's note 3, part A) — recommend documenting **all 14**
   guardrails found in `guardrails()` (`src/lib/ledger.ts`): negative fund balance, reserves
   below threshold, treasurer not bonded, income missing itemized source, cash disbursements
   recorded, expenses missing receipt documentation, disbursements pending approval,
   unreconciled transactions from prior months, two-fund firewall violation, 990 revocation
   risk, overdue compliance filings, dues payment sync mismatch, aged public-fund holding,
   public-category income posted direct-to-admin — each with what it means and the concrete
   next action (several of these map directly to open `treasurer-todo.md` items, e.g. T-04, T-16
   — cross-linking to that file's relevant items, where it doesn't reveal anything sensitive,
   reinforces rather than duplicates it).
4. **Reports** (user's note 3, part B) — brief; what's on the reports page and when to use it.
5. **Zeffy + fund routing** (user's note 5) — write this against the **revised** 2026-07-21
   T-17 plan verbatim: single Zeffy account, dues → admin income unchanged, donations → Activity
   Fund → prompt sweep to Foundation, plus the transfer-recording process (club Activity Fund
   expense → Foundation income, citing the board minute) and the Monday lump-payout
   reconciliation practice. **Risk flagged explicitly:** T-17 was revised today (2026-07-21),
   superseding an earlier two-Zeffy-account plan recorded in the same file — whoever writes this
   section in Phase 3/4 must read T-17's current text, not an earlier mental model of it.
6. **Ledger settings + annual review** (user's note 6) — document all five settings fields
   (disbursement approval threshold, reserve warning threshold, public-fund holding-period days,
   treasurer-bonded checkbox, philanthropy visibility) and recommend the annual-review trigger
   be fiscal-year rollover / treasurer transition, matching the user's own suggestion.
7. **Bank statement reconciliation** — scoped per the timing recommendation above.
8. **The rest of the surface area** (not in the user's six notes, but real and existing):
   books/register & recording a transaction, dues tracking, reimbursements (member-submitted
   expense requests) + the approvals queue, receipt uploads and waivers, public gift
   descriptions, the uncashed-checks list, and the per-fund detail/report pages. These can be
   thinner sections than the spine topics, but their absence would leave real, live UI
   undocumented for exactly the successor-treasurer reader this feature exists for.
- **Donors & acknowledgments — confirmed excluded from v1**, per the user's explicit 2026-07-21
  call ("not sure about the use for donors yet, let's leave that doc out"). Recorded here as
  out of scope, not silently dropped.

### Maintenance recommendation

Recommend a lightweight, existing-process-based convention rather than a new review cadence:
**any work-log entry that changes behavior on a surface this guide documents should include a
one-line note — "guide updated / not applicable" — in its own Phase 4 or Phase 5 section**,
the same way release notes are already a mandatory step on every push to main. This piggybacks
on the discipline the project already has (every Ledger feature to date has shipped release
notes — v1.27, v1.30, v1.31) rather than inventing a new periodic-review type or an in-app
editing surface. Where this convention gets formally recorded (a CLAUDE.md line, a
`docs/decisions.md` entry, or a note in the release-notes skill) is an architect/tech-lead call,
not mine to make or to write, since I'm read-only on both files this session.

## Out of scope (confirm with user)

- **Donors & acknowledgments** — explicitly excluded by the user, 2026-07-21. Confirmed above,
  not re-litigated.
- **Member-facing help** — this is an admin-only guide describing admin-only surfaces; nothing
  here extends to `/members/*` pages.
- **An in-app editing UI for the guide's content** — content ships as code (hardcoded), edited
  via normal PRs, not through an admin content-editor screen.
- **Contextual per-surface help panels** — cheap, optional future polish (see Shape
  recommendation); not built in v1.
- **PDF export / a dedicated "print" button** — recommend relying on browser print with light
  `print:hidden` styling instead of building an export feature.

## Open questions

None that require the user. Every fork point above (shape, storage, reconciliation timing,
permission gate, content scope, maintenance convention) has a recommended default grounded in
existing codebase precedent; the two decisions that actually needed the user's judgment — donors
excluded, and the T-17 Zeffy/Activity-Fund policy — were already made in the source material
this task pointed at, and this review's job was to carry them forward accurately, not to
re-ask them.

---

# Phase 2 — Architectural Review (architect) — 2026-07-21

**Owner:** architect
**Status:** complete
**Verdict:** Approved with suggestions

## Summary

Phase 1's shape is architecturally sound and matches existing Ledger precedent closely: a
server-component page at `/admin/ledger/guide`, gated with the same `hasAnyFeature` call the
Reimbursements page already uses, surfaced from the same sidebar section as Compliance/Reports/
Donors/Settings. Two adjustments to Phase 1's recommendation: (1) the page must be split into
per-section components under `src/components/admin/ledger/guide/`, not one long `page.tsx` —
this codebase already composes content-heavy Ledger pages this way (Compliance imports
`Panel990`/`StandingReminders`/`FilingsCalendar`), and a monolith is the wrong shape for content
that gets touched on every future Ledger release; (2) I checked the "MDX would add a dependency"
premise directly and it's *slightly* off — `react-markdown`/`remark-gfm`/`rehype-raw` are already
installed and already render developer-authored, git-committed markdown in-app (Release Notes).
I still land on hardcoded JSX, but for a sharper reason than "no new dependency": this guide needs
typed `next/link` cross-links and a few live-value inserts (Pass 4's drift risk), and Release
Notes' markdown path only gets raw `<a>` tags via `rehypeRaw` with no live-value interpolation —
markdown is right for Release Notes' shape (prose + tables, no live data, no internal typed
links) and wrong for this one. No new dependency either way. Everything else in Phase 1's
recommendation — permission gate, nav placement, reconciliation "coming soon" scoping, donors
exclusion, mobile TOC as a stacked/`<details>` list, no schema/migrations — is confirmed against
the actual code and carries forward unchanged.

## What I did

- Read the Phase 1 section in full (all five passes, shape/storage/reconciliation-timing/
  permission/content-scope/maintenance recommendations).
- Enumerated the actual Ledger route tree (`ls src/app/(dashboard)/admin/ledger`) — confirmed
  `settings`, `donors[/​[id]]`, `reimbursements`, `compliance`, `approvals`, `[fundSlug][/report]`,
  `reports` are the only existing subpages; `guide` does not yet exist.
- Read `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` and `compliance/page.tsx` in
  full to confirm the exact auth/gate pattern, breadcrumb convention, header convention
  (eyebrow + h1 + subtitle), and section-component composition style.
- Confirmed `hasAnyFeature` exists in `src/lib/permissions-server.ts` with signature
  `hasAnyFeature(userId: string, features: string[])` and is called today exactly as
  `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD,
  FEATURES.LEDGER_MANAGE, FEATURES.LEDGER_APPROVE])` on the Reimbursements page — this is the
  precedent Phase 3 should copy verbatim, not just approximate.
- Read `src/components/admin/admin-sidebar.tsx` in full for the nav mechanism. Found the nav
  item shape is `requiredFeature?: string` (singular), filtered via
  `userFeatures.includes(item.requiredFeature)` (line ~246) — **not** an array/`hasAnyFeature`
  check. Compliance, Reports, Donors, and Ledger Settings are all top-level items in the
  "Treasury" group's Ledger sub-list; Reimbursements and Approvals are **not** in the sidebar at
  all (reached only via cross-links). This matters for where the guide's nav entry lands and
  what single feature key it declares (see Ruling 5).
- Grepped for `react-markdown` usage across `src/` and read
  `src/components/admin/release-notes-viewer.tsx` in full, plus confirmed its content source is
  `docs/release-notes/*.md` files read via `src/app/api/admin/release-notes/route.ts` — this is
  the project's one existing precedent for rendering developer-authored, git-committed long-form
  content, and it's markdown, not hardcoded JSX. Weighed this directly against Phase 1's "MDX
  would add a dependency" framing (see Ruling 3).
- Read `.claude/skills/release-notes/SKILL.md` in full to find the exact landing spot for the
  maintenance convention (Ruling 7) — Step 4 ("Update CLAUDE.md") already runs a drift-check
  bullet list on every release; this is the existing hook to extend rather than inventing a new
  one.
- Checked `docs/decisions.md`'s own stated scope (new dependency, new top-level module, route-
  group change, permission-catalog change) against this feature: none apply. No entry logged;
  see the note under Ruling 8.

## Rulings

**1. Placement and server/client split — confirmed, no change.**
`src/app/(dashboard)/admin/ledger/guide/page.tsx`, pure Server Component, no `'use client'`
anywhere in the page or its section children. Nothing in this feature needs interactivity —
anchor navigation, the mobile TOC disclosure (native `<details>`/`<summary>`, which needs no JS),
and `next/link` cross-links are all server-renderable. If Phase 3 wants a "copy link" button next
to each heading (nice-to-have, not requested), that one control would need `'use client'`
scoped to a tiny leaf component — it must not push `'use client'` up to the page or section
level.

**2. Content architecture — split into section components, not one long `page.tsx`.**
`page.tsx` should be a thin shell: gate, breadcrumb, header, a `<nav>` TOC built from a typed
array of `{ id, label }` entries, and then a list of imported section components rendered in
order. Each section (the Phase 1 spine items 1–7, plus item 8's "rest of the surface area",
which may itself be one file or several) gets its own file under
`src/components/admin/ledger/guide/`, e.g. `bank-transition-section.tsx`,
`compliance-calendar-section.tsx`, `guardrails-section.tsx`, `reports-section.tsx`,
`zeffy-fund-routing-section.tsx`, `settings-section.tsx`, `reconciliation-section.tsx`, plus one
or more files for item 8's thinner sections. Reasoning: (a) this is exactly how
`compliance/page.tsx` already composes content today (`Panel990`, `StandingReminders`,
`FilingsCalendar` are separate files); (b) this guide is explicitly a page "edited every time a
Ledger feature ships" per the brief — a single 800+ line file is a merge-conflict magnet and a
"where do I even edit this" tax on every future Ledger increment, whereas one-file-per-topic
means a typical follow-up (e.g., inc2 expanding the reconciliation section) touches exactly one
new/existing file; (c) it matches directory rule 3 (`src/components/admin/` for admin-only
compositions) cleanly. Each section component takes any live values it needs as props (see
Ruling 3) rather than fetching independently, so `page.tsx` remains the single place that loads
data.

**3. Hardcoded JSX vs MDX/markdown — hardcoded JSX confirmed, but not for the reason Phase 1
gave.** Phase 1's "MDX would add a dependency" premise is not quite accurate — `react-markdown`,
`remark-gfm`, and `rehype-raw` are already installed and already render exactly this kind of
content (developer-authored, git-committed, non-editable-by-admin-UI prose) for Release Notes
via `ReleaseNotesViewer`. So the "no new dependency" bar alone doesn't settle this — a
markdown-file-driven guide reusing the existing Release Notes pattern is genuinely available at
zero new dependency cost, and Phase 3 should not cite "avoids a new dependency" as the reason to
reject it, because it wouldn't be a new dependency. The real reason to still choose hardcoded
JSX: this guide has two requirements Release Notes' markdown path doesn't handle well. First,
Flow 2's cross-links need `next/link` (typed routes, prefetch, and — per Phase 1's own
reasoning — Phase 5 click-through catches a broken href); `ReleaseNotesViewer`'s `rehypeRaw`
path only supports raw `<a href>` tags, which lose all of that. Second, Pass 4's live-value
drift risk (settings thresholds, the 990 determination) is naturally handled by JSX prop/
expression interpolation (`{result.determination}`) and is awkward to do inside a markdown
string without inventing a templating convention on top of it. Release Notes' shape — pure prose
and tables, no live data, no internal typed links — is exactly where markdown earns its keep;
this guide's shape is exactly where it stops paying for itself. Net: hardcoded JSX, no new
dependency, and Phase 3 should drop "avoids a dependency" from the design doc's reasoning in
favor of "needs typed Links and live-value interpolation that the existing markdown pipeline
doesn't give us."

**4. Gate — confirmed exactly as Phase 1 specified.** `hasAnyFeature(session.user.id,
[FEATURES.LEDGER_VIEW, FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE, FEATURES.LEDGER_APPROVE])`
from `@/lib/permissions-server`, called the same way the Reimbursements page calls it today
(confirmed by reading that file, not just trusting the name matches). No new `FEATURES` key, no
migration — matches the repo's own rule that a feature "off by default" is a role-binding
choice, and here nothing is being restricted further than the existing broadest Ledger read-gate.

**5. Nav — one new sidebar item, `src/components/admin/admin-sidebar.tsx`, Treasury group's
Ledger sub-list.** The sidebar's `requiredFeature` field is a single string, not an array — it
does **not** support the same `hasAnyFeature` logic the page itself uses. Compliance, Reports,
and Donors all declare `requiredFeature: FEATURES.LEDGER_VIEW` in the nav even though their
pages gate more broadly; follow that exact precedent for the guide's nav entry
(`requiredFeature: FEATURES.LEDGER_VIEW`). This means a user who holds only `LEDGER_APPROVE` (no
`LEDGER_VIEW`) won't see the guide link in the sidebar but can still load the page directly and
pass its `hasAnyFeature` gate — that's an existing, accepted inconsistency in this codebase
(Reimbursements/Approvals aren't in the sidebar at all, for the same underlying reason), not a
new gap this feature introduces. Phase 3 should place the new item in the array literally
alongside the existing four (after "Ledger" or after "Ledger Settings" — ordering is a UX call,
not an architectural one).

**6. Invariants — confirmed, one addition.** Server Component (Ruling 1); `rounded-2xl` section
cards matching the Compliance page's guardrail-card treatment; breadcrumb
`&larr; Ledger Overview` in the exact `text-lions-blue hover:underline ... focus:ring-2
focus:ring-lions-blue` classes already used on Reimbursements/Compliance; eyebrow + `h1` +
subtitle header matching those same two pages, not a new hero style. Mobile TOC: no fixed side
rail (confirmed no existing Ledger subpage uses one); a stacked list or native `<details>`
disclosure is correct and needs no client JS. No schema or migration changes — confirmed nothing
in this feature writes to the database; if Phase 3 chooses to hydrate live values (990
determination, settings thresholds), those reuse existing read functions (`getSettings()`,
`determine990()`) already called by `settings/page.tsx` and `compliance/page.tsx` — no new
query surface. No new permissions catalog entry — confirmed under Ruling 4.

**7. Maintenance convention — lands in `.claude/skills/release-notes/SKILL.md`, Step 4.** Step 4
("Update CLAUDE.md") already runs a drift-check bullet list on every release before the version
bump — that is the existing hook Phase 1's "piggyback on release-notes discipline" idea should
attach to, not a new review type or a CLAUDE.md section. Add a fourth bullet to Step 4's list:

> **"Treasury User's Guide"** (`/admin/ledger/guide`) — if the release changes behavior on a
> Ledger surface the guide documents (books/register, dues, reimbursements, receipts/waivers,
> compliance/990, reports, uncashed checks, reconciliation, settings, Zeffy/fund routing), update
> the guide's matching section; if not applicable, note "guide: no applicable change" same as the
> existing CLAUDE.md skip note.

This is a Phase 3/4 edit (tech-lead or the implementer touches `SKILL.md` as part of shipping
this feature) — I'm naming the exact location, not making the edit, since Phase 2 is read-only on
everything but this work-log.

**8. `docs/decisions.md` — no entry warranted; deferred to Phase 3 if they disagree.** The
decision log's own stated scope is new dependencies, new top-level modules, route-group changes,
or permission-catalog changes. None apply here: no new dependency (Ruling 3), no new top-level
module (`guide/` is a leaf addition to the existing `src/components/admin/ledger/` tree, not a
new module), no route-group change (`/admin/ledger/guide` follows the existing per-subpage
convention exactly), no permission-catalog change (Ruling 4). Per this task's read-only
instruction on `docs/decisions.md`, I have not written an entry. If tech-lead judges the
section-component-split convention (Ruling 2) or the JSX-vs-markdown reasoning (Ruling 3) worth
recording as precedent for future content-heavy admin pages, that's a Phase 3 call and entry.

## Outputs

- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 2 section; Per-Phase Status
  row updated to `Complete / Approved with suggestions / 2026-07-21`.
- No source files touched (read-only on source per this task's instructions).
- No `docs/decisions.md` entry (Ruling 8 — not warranted under this repo's own criteria; not
  touched, per instructions).

## Open questions / handoff notes

- Tech-lead should name the exact section-component file list in the Phase 3 design doc (Ruling
  2's list is a strong starting point, not a mandate) and the exact TOC entry ids/order.
- Tech-lead should decide nav ordering within the Treasury group (Ruling 5) — not an
  architectural question.
- Tech-lead should decide, per Pass 4/Ruling 3, which specific values get live interpolation
  (990 determination is the clearest candidate; settings thresholds could go either way) versus
  phrased generically — Phase 1 already flagged this as a Phase 3 choice, and my ruling on JSX
  vs. markdown doesn't resolve it, it just confirms JSX can support either answer cleanly.
- If Phase 3 wants the Step 4 `SKILL.md` edit (Ruling 7) done as part of this feature's own PR
  rather than a separate one, say so explicitly in the design doc so the implementer doesn't
  drop it.

---

---

# Phase 3 — Technical Design (tech-lead) — 2026-07-21

**Owner:** tech-lead
**Status:** complete

## Summary

A single Server Component page at `/admin/ledger/guide`, gated identically to the
Reimbursements page (`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE,
LEDGER_APPROVE])`), composed from eleven section components under
`src/components/admin/ledger/guide/` plus a thin `page.tsx` shell that owns the TOC, the
gate, and the two live-data reads the guide needs. The user's six content notes become
seven of the eleven sections (guardrails and reports split per Phase 1's note-3
subdivision); the remaining four cover books/register, dues, reimbursements+approvals,
uncashed checks, and reconciliation — the full-surface coverage Phase 1 required, with
receipts/waivers/public notes folded in as subsections of Books & the Register rather
than standalone files, keeping the thinner topics thin as Phase 1 recommended. Exactly
two sections touch the database (990 determination, current settings recap) — see
DECISION-037 for the reasoning and the failure-fallback shape. Implementer: **ux-developer**,
sole owner, no split — this is one route, no new API surface, and the two live reads
reuse existing query functions verbatim.

## Technical Design: Treasury User's Guide

### Permissions

No new `FEATURES` key, no migration. Gate on the existing broadest Ledger read-gate,
called identically to `reimbursements/page.tsx` (confirmed by reading that file in Phase
2, not just matching by name):

```ts
const canView = await hasAnyFeature(session.user.id, [
  FEATURES.LEDGER_VIEW,
  FEATURES.LEDGER_RECORD,
  FEATURES.LEDGER_MANAGE,
  FEATURES.LEDGER_APPROVE,
]);
if (!canView) redirect("/access-pending");
```

Sidebar nav (`src/components/admin/admin-sidebar.tsx`, Treasury group's Ledger sub-list):
one new item, **last** in that sub-list (after "Ledger Settings" — a reference/help entry
reads naturally as the last thing in the group, not competing with the four action
surfaces above it):

```ts
{
  name: "User's Guide",
  href: "/admin/ledger/guide",
  icon: "📖",
  requiredFeature: FEATURES.LEDGER_VIEW,
}
```

Per architect Ruling 5, this is a known, accepted inconsistency already present for
Reimbursements/Approvals: a `LEDGER_APPROVE`-only holder won't see the sidebar link (the
field is a single string, not an array) but can still load `/admin/ledger/guide` directly
and pass the page's own `hasAnyFeature` gate. Not a new gap — matches existing precedent
exactly.

### API Contract

None. No route handlers, no server actions — this is a read-only page consuming existing
query functions (`getEntities`, `getComplianceOverview`, `getSettings`, all already
exported from `src/lib/ledger-queries.ts` and already called by `compliance/page.tsx` /
`settings/page.tsx`). No new endpoint of any kind.

### Data Model

No schema changes required. No new tables, columns, or indexes.

### Component/Page Plan

**Page:** `src/app/(dashboard)/admin/ledger/guide/page.tsx`

Thin shell only: `auth()` + gate, breadcrumb (`&larr; Ledger Overview`, exact classes from
`compliance/page.tsx`), eyebrow ("The Ledger") + `h1` ("User's Guide") + one-paragraph
intro (audience: the treasurer and a future successor; how to use the page — read
linearly or jump via the TOC) written inline in `page.tsx`, not its own section file (two
sentences don't need a component). Below the intro: a native `<details open>` TOC block
(see Mobile below) built from a typed `const TOC: { id: string; label: string }[]` array
literal declared in the same file, immediately above the JSX return — colocating the
array with the imports means adding a twelfth section later is exactly one import line +
one array entry, no separate `toc.ts` file to keep in sync. Then the eleven section
components render in TOC order. `export const dynamic = "force-dynamic"` (matches every
other Ledger subpage; also required here because two sections carry live reads — see
Live-Value Interpolation below).

**TOC / section order** (also the file list under `src/components/admin/ledger/guide/`):

| # | TOC id | Label | File | Source (user note / full-surface) |
|---|--------|-------|------|-----------|
| 1 | `bank-transition` | Treasurer Transition — Bank Account | `bank-transition-section.tsx` | Note 1 (spine) |
| 2 | `books-register` | Books & the Register | `books-register-section.tsx` | Full-surface (Phase 1 item 8) |
| 3 | `zeffy-fund-routing` | Zeffy & Fund Routing | `zeffy-fund-routing-section.tsx` | Note 5 (spine) |
| 4 | `dues` | Dues | `dues-section.tsx` | Full-surface |
| 5 | `reimbursements` | Reimbursements & Approvals | `reimbursements-section.tsx` | Full-surface |
| 6 | `uncashed-checks` | Uncashed Checks | `uncashed-checks-section.tsx` | Full-surface |
| 7 | `compliance-990` | Compliance Calendar — Form 990 | `compliance-calendar-section.tsx` | Note 2 (spine) |
| 8 | `guardrails` | Compliance Guardrails | `guardrails-section.tsx` | Note 3a (spine) |
| 9 | `reports` | Reports | `reports-section.tsx` | Note 3b (spine) |
| 10 | `reconciliation` | Bank Reconciliation (Coming Soon) | `reconciliation-section.tsx` | Full-surface, scoped per Phase 1 |
| 11 | `settings` | Ledger Settings & Annual Review | `settings-section.tsx` | Note 6 (spine) |

Ordering rationale: succession process first (what a brand-new treasurer needs before
touching the software at all), then the books/money-in flow in the order money actually
moves (record a transaction → how Zeffy money is routed → dues → reimbursements going
*out* → uncashed checks as a books hygiene topic), then compliance/reporting as a group,
then reconciliation (forward-looking) and settings/governance last (an annual-review
topic, not a daily-use one). Donors & acknowledgments has no row — confirmed excluded
per the user's 2026-07-21 call, carried forward from Phase 1/2 unchanged.

**Per-section content outline:**

1. **`bank-transition-section.tsx`** — club/bank operational process, explicitly labeled
   as such so a reader doesn't go hunting for a matching UI screen (Phase 1 Pass 2, Flow
   3). Content, verbatim from the user's note 1:
   - Meeting minutes required before switching signers.
   - Two forms of ID required at the bank (a credit card counts as the second ID).
   - Make the **treasurer** the **primary** signer on the account.
   - Attendees needed: the **new president**, the **new treasurer**, and **one of the two
     signers from the previous year**.
   - Budget **~2 hours** at the branch.
   - No cross-link (this section describes a bank visit, not an app surface).
2. **`books-register-section.tsx`** — what a "fund," a "transaction," and "posted vs.
   pending" mean; walks the transaction form fields as they exist today: category,
   party/payer, payment method (including `debit_card`), **check number** (structured
   field, v1.30 — not parsed from memo text, per DECISION-034), receipt upload, receipt
   **waiver** (v1.31 — when a receipt genuinely can't be obtained), and the **public gift
   description** field (v1.31 — the note shown on the public impact dashboard for named
   gifts). Cross-link to `/admin/ledger` (the dashboard — the entry point into each
   fund's own register; no specific fund slug is hardcoded since fund slugs are
   per-entity and dynamic).
3. **`zeffy-fund-routing-section.tsx`** — written against **`docs/treasurer-todo.md`'s
   T-17, current text as of 2026-07-21** (single Zeffy account; superseded an earlier
   two-account plan recorded in the same file — verified by reading T-17's live text this
   session, not carrying forward a stale mental model): dues via Zeffy → admin income,
   unchanged; donations via Zeffy → recorded to the **Activity Fund** (a $0-target
   clearing account, per the reference note), then promptly swept to the Foundation;
   document the transfer itself (club Activity Fund expense → Foundation income, citing
   the board minute where one exists); the Monday lump-payout reconciliation practice
   (Zeffy settles the prior week in one Monday deposit — sum the week's Zeffy-method
   Ledger rows and it should match the deposit exactly, since Zeffy takes no ledger-side
   fee). Names the caveat: a club-side Zeffy gift is legally a gift to the club, not the
   501(c)(3) — steer larger/deduction-sensitive donors to Foundation channels. Cross-link
   to `/admin/ledger/compliance` (aged-public-fund guardrail) and to the relevant
   `treasurer-todo.md` items by ID (T-04, T-17) as *references*, not hyperlinks (that file
   isn't a web route).
4. **`dues-section.tsx`** — brief: where dues show up in the ledger (auto-post from
   payment), where a member's own dues history lives (`/members/dues`, for context), and
   where the admin-side dues surface is (`/admin/dues`, cross-linked).
5. **`reimbursements-section.tsx`** — the member-submitted expense-reimbursement flow
   (submitted → approved → paid, or rejected) and the separate **Approvals** queue
   (`/admin/ledger/approvals`, gated more strictly on `LEDGER_APPROVE` alone via
   `hasFeature`, not `hasAnyFeature` — noted explicitly since it's a real, stricter gate
   than every other Ledger subpage including this guide). Cross-links to both
   `/admin/ledger/reimbursements` and `/admin/ledger/approvals`.
6. **`uncashed-checks-section.tsx`** — what the uncashed-checks panel on the main Ledger
   dashboard shows (checks recorded but not yet reconciled) and when to act on it (a check
   stale for months, per `treasurer-todo.md` T-02, is a "contact the payee, consider
   voiding and reissuing" situation, not a data-entry error). Cross-link to `/admin/ledger`
   (the dashboard where the panel lives).
7. **`compliance-calendar-section.tsx`** — Form 990: IRS annual filing, club/Foundation
   fiscal year runs July 1 – June 30, **990-N/990-EZ due November 15**. Explains that the
   *specific* form (990-N vs. 990-EZ vs. 990) depends on gross receipts/assets and is
   determined automatically by the Ledger, not chosen by the treasurer — then shows the
   **live current-FY determination** for each entity (see Live-Value Interpolation).
   Cross-link to `/admin/ledger/compliance` for the full filing calendar and history.
8. **`guardrails-section.tsx`** — all **14** guardrails from `guardrails()`
   (`src/lib/ledger.ts`), each with its title verbatim and a one-line "what to do" note.
   Static content — no hardcoded dollar figures or day counts (Pass 4 drift risk resolved
   generically here per DECISION-037):

   | Guardrail title (verbatim) | Severity | What to do |
   |---|---|---|
   | Negative fund balance: {kind} | high | Review recent transactions in that fund immediately — a fund should never go negative. |
   | Reserves below minimum threshold | warn | Entity balance is below the reserve threshold configured in Settings — review upcoming expenses or replenish reserves. |
   | Treasurer not bonded | warn | Confirm the fidelity bond is active (see `treasurer-todo.md` T-05), then check the "treasurer bonded" box in Settings. |
   | Income entries missing itemized source | warn | Add the payer/party to each flagged income row — required for itemized-receipt compliance. |
   | Cash disbursements recorded | warn | Prefer check or electronic payment going forward; cash reduces audit traceability. |
   | Expenses missing receipt documentation | info | Attach a receipt to each flagged expense, or record a waiver if one genuinely can't be obtained. |
   | Disbursements pending board approval | warn | Review the Approvals queue — these amounts are excluded from posted balances until approved. |
   | Unreconciled transactions from prior months | warn | Confirm each flagged transaction against your bank statement and mark it reconciled. |
   | Two-fund firewall violation | high | Reverse or reclassify — Activity/public fund money must never move into the Administrative fund. |
   | IRS 990 revocation risk — 3 consecutive unfiled returns | high | File the overdue returns immediately — the IRS auto-revokes exempt status after 3 consecutive misses (IRC §6033(j)). |
   | Overdue compliance filings | warn | Review the Compliance page and file, or mark the filing N/A if it doesn't apply this year. |
   | Dues payment sync mismatch | warn | A dues payment was edited/deleted after its ledger row reconciled — review and correct the ledger row by hand. |
   | Public fund(s) holding undisbursed balance past threshold | warn | Disburse or sweep the balance, or — if earmarked for a specific multi-year project — document that in board minutes (see `treasurer-todo.md` T-16). |
   | Public-category income posted directly to Administrative fund | warn | Reclassify to an Activity/Charitable fund — public money can't post directly to Administrative (see T-04). |

   Cross-link to `/admin/ledger/compliance` (where these render live, with real numbers)
   and to `docs/treasurer-todo.md` item IDs as plain-text references where a guardrail
   maps to an open item (T-04, T-05, T-16), per Phase 1's "reinforces rather than
   duplicates" framing.
9. **`reports-section.tsx`** — what `/admin/ledger/reports` shows (entity-wide report
   across all funds for a fiscal year: gross receipts, net, guardrail summary) and that
   each fund also has its own `Report` view reachable from that fund's own page (no
   specific fund slug hardcoded — fund slugs are dynamic per entity). Cross-link only to
   the static `/admin/ledger/reports` route.
10. **`reconciliation-section.tsx`** — two clearly separated halves, per Phase 1's
    reconciliation-timing recommendation (do not block on inc2, do not describe unshipped
    UI as present):
    - **Live today:** the structured check-number field, the per-row reconcile toggle, and
      the uncashed-checks panel (cross-referenced back to section 6).
    - **Coming soon** (explicitly labeled, concept-level only, no button/route/screen
      names): upload a bank statement export, the system helps match it against the
      books, a reconciliation session only closes when it balances to the penny. No
      cross-link to an inc2 route — none exists yet.
11. **`settings-section.tsx`** — all five settings fields, generic explanations (no
    hardcoded numbers): disbursement approval threshold, reserve warning threshold,
    public-fund holding-period days, treasurer-bonded checkbox, philanthropy visibility.
    Below the static prose, a **live "current values" recap** (see Live-Value
    Interpolation). Recommends the **annual review** trigger be fiscal-year rollover /
    treasurer transition, matching the user's own suggestion. Cross-link to
    `/admin/ledger/settings`.

### Live-Value Interpolation

Exactly two sections read the database; both reads happen once in `page.tsx` and are
passed down as props (Ruling 2 — `page.tsx` stays the single place that loads data). Full
reasoning in **DECISION-037**.

- **`compliance-calendar-section.tsx`**: `page.tsx` calls `getEntities()`, then for each
  entity `getComplianceOverview(entity.id, currentFiscalYear(new Date()))` (from
  `@/lib/fiscal-year` and `@/lib/ledger-queries`) and reads `.determine990Result` (`{ form,
  why }`) off the result. **Does not call `ensureFilingsForFY()` first** — unlike
  `compliance/page.tsx`, this is a read-only page and must not trigger that function's
  write side effect; `determine990Result` is computed from financial totals inside
  `getOverview()`, independent of whether filing rows exist for the FY, so skipping it
  doesn't affect the value shown. Wrapped in try/catch; on failure, empty `getEntities()`,
  or a null result, the section renders one fallback line ("Unable to load the current 990
  determination — see the Compliance page.") instead of a value.
- **`settings-section.tsx`**: `page.tsx` calls `getSettings()` (same function
  `settings/page.tsx` already calls) and passes the flat object straight through as a
  prop. On failure, one fallback line ("Unable to load current settings — see the
  Settings page.").

No other section takes a data prop. All guardrail thresholds and the 990 form-name
mechanics are phrased generically in `guardrails-section.tsx` and
`compliance-calendar-section.tsx`'s explanatory prose — only the two live inserts above
carry real numbers/values.

### Implementation Order

1. **`page.tsx`** — gate, breadcrumb, header, intro paragraph, `TOC` array, the two live
   reads (`getEntities`/`getComplianceOverview` loop + `getSettings`, each in its own
   try/catch), and the ordered list of section-component imports.
2. **Section components**, in TOC order (1–11 above) — each a standalone file under
   `src/components/admin/ledger/guide/`; the two with live props
   (`compliance-calendar-section.tsx`, `settings-section.tsx`) accept an
   optional/nullable prop and render the fallback line on absence, per DECISION-037. All
   eleven use `rounded-2xl` section cards, the `text-lions-blue hover:underline
   focus:outline-none focus:ring-2 focus:ring-lions-blue rounded` link classes for every
   cross-link, and `next/link` (never raw `<a>`) for every internal cross-link, per
   architect Ruling 3.
3. **Sidebar entry** — `src/components/admin/admin-sidebar.tsx`, Treasury group, appended
   after "Ledger Settings" (see Permissions above).
4. **Print styling (nice-to-have, cheap)** — a `print:hidden` Tailwind class on the admin
   sidebar/nav chrome (the shared dashboard layout, not a guide-specific change) so a
   printed copy of the guide page is just its content — directly useful for the
   in-person bank visit `bank-transition-section.tsx` describes. Verify this doesn't
   regress print behavior on any other admin page (none currently styles for print, so
   there's nothing to conflict with).
5. **`.claude/skills/release-notes/SKILL.md`, Step 4** — add the maintenance bullet the
   architect drafted in Phase 2 Ruling 7, verbatim, to the existing drift-check list:

   > **"Treasury User's Guide"** (`/admin/ledger/guide`) — if the release changes behavior
   > on a Ledger surface the guide documents (books/register, dues, reimbursements,
   > receipts/waivers, compliance/990, reports, uncashed checks, reconciliation, settings,
   > Zeffy/fund routing), update the guide's matching section; if not applicable, note
   > "guide: no applicable change" same as the existing CLAUDE.md skip note.

   This is a documentation edit, not a design decision — carried into the implementer's
   deliverables per this task's instruction, not re-litigated here.
6. **`CLAUDE.md` "Key Features" bullet** — under the Member Portal → Admin line (the
   sentence listing Ledger sub-surfaces: "…The Ledger (online accounting: books,
   reimbursements, compliance/990, reports, donors & acknowledgments)…"), append ", and an
   in-app Treasury User's Guide (`/admin/ledger/guide`)". Small, mechanical, done by the
   implementer alongside the SKILL.md edit above.
7. **Release notes** — out of scope for the implementer. Per this project's ownership
   split, tech-lead writes the release-notes entry via `/release-notes` when the branch is
   prepared to merge to main (Phase 6), not the implementer at Phase 4. Noting it here so
   it isn't dropped, not assigning it to ux-developer.

### Named Tests

This is a static content page; naming what's honestly testable rather than inventing
coverage for its own sake.

- **No new unit tests are warranted** beyond what `src/lib/ledger.ts` and
  `src/lib/ledger-queries.ts` already have for `determine990()` / `getSettings()` /
  `getComplianceOverview()` — this feature adds zero new pure logic. If the implementer
  ends up extracting any real conditional formatting logic (e.g., choosing which fallback
  line to show, or formatting the settings recap), that specific helper should get a
  Vitest unit test; otherwise none is needed, and the implementer should say so explicitly
  in the Phase 4 write-up rather than silently skipping the "named tests" gate.
- **What Phase 5 (qa) verifies by click-through, not automated test:**
  - Gate audit: a session with only `LEDGER_APPROVE` can load `/admin/ledger/guide`
    directly (passes the page's `hasAnyFeature` gate) but does not see it in the sidebar
    (single-string `requiredFeature: LEDGER_VIEW`) — confirming Ruling 5's accepted
    inconsistency, not a new bug.
  - Every TOC entry (all 11 rows above) scrolls to the correct `#anchor-id`.
  - Every cross-link resolves to a real, current route: `/admin/ledger`,
    `/admin/ledger/compliance`, `/admin/ledger/settings`, `/admin/ledger/reports`,
    `/admin/ledger/reimbursements`, `/admin/ledger/approvals`, `/admin/dues`.
  - The live 990 determination and settings recap render real values (production is
    seeded as of the 2026-07-20/21 Quicken import) — and, separately, that the fallback
    line renders sanely if either read is forced to fail (e.g., temporarily point
    `getEntities()` at an empty result in a local test, or otherwise simulate failure) —
    confirming this page never crashes to a blank screen.
  - Mobile at 360px: the `<details>` TOC is usable (opens/closes, no fixed side rail), no
    horizontal scroll on any section, including the guardrails table (must scroll inside
    its own container, not the page).
  - The reconciliation section's "coming soon" half names no button/route/screen that
    doesn't exist today (spot-check against the actual inc2 work-log state at review
    time, since that state can change independently of this feature).

### Edge Cases & Risks

- **Guide accuracy vs. live app — the reconciliation section is the sharpest risk.** Its
  "coming soon" copy must describe concepts only; if inc2 ships a UI before this guide's
  next update, the section will read as stale (not wrong, just behind) — acceptable per
  Phase 1's timing recommendation, and covered going forward by the SKILL.md maintenance
  bullet, not a technical guard.
- **Guardrail-count drift.** If `guardrails()` gains a 15th check in a future increment,
  `guardrails-section.tsx`'s table silently becomes incomplete. No automated
  count-matching check is proposed (would require a test asserting against `guardrails()`
  purely for documentation-completeness, which is disproportionate to the risk) — this is
  exactly the kind of change the SKILL.md maintenance bullet exists to catch.
- **Empty-data / failure states for the two live reads.** Handled per DECISION-037: a
  one-line inline fallback per affected section, not the full-page `LoadErrorCard`
  pattern (that's for a whole page failing, not one subsection of a long static page).
  Production is seeded (T-12/T-22 in `treasurer-todo.md`), so an empty-`getEntities()`
  scenario is not expected in practice, but the fallback must still be built and verified
  (Phase 5) since local/dev environments and future entity-management changes could hit
  it.
- **`ensureFilingsForFY` must not be called from this page** — see Live-Value
  Interpolation. Calling it would make a nominally read-only guide page perform a
  database write as a side effect of being viewed, which is both surprising and
  unnecessary (the value the guide shows doesn't depend on it).
- **T-17 currency.** `zeffy-fund-routing-section.tsx` must be written against T-17's
  *current* (2026-07-21) text, not the superseded two-Zeffy-account plan recorded earlier
  in the same file — flagged by Phase 1, re-confirmed here by reading the live file this
  session (see What I did).
- **Print styling scope.** The `print:hidden` sidebar class is a small shared-layout
  change, not scoped to the guide page alone — verify at Phase 5 it doesn't visually
  regress print output on any other admin page (none currently has print-specific
  styling, so there's nothing to conflict with, but it's still a shared file).

### Out of Scope

- **Donors & acknowledgments** — excluded per the user's explicit 2026-07-21 call,
  carried forward unchanged from Phase 1/2.
- **An in-app editing UI for the guide's content** — ships as code, edited via normal PRs.
- **Contextual per-surface help panels** ("?" links from Compliance/Settings pointing into
  the guide) — cheap future polish, not built in v1.
- **PDF export / a dedicated print button** — relying on browser print + `print:hidden`
  instead.
- **Expanding the reconciliation section for inc2/inc3** — a normal follow-up on those
  features' own work-logs when they ship, not part of this feature's v1.

## What I did

- Read the Phase 1 and Phase 2 sections in full (all passes, all eight architect
  rulings) — treated both as binding per this task's instructions.
- Read `docs/treasurer-todo.md` in full to confirm T-17's current (2026-07-21, revised)
  text verbatim for the Zeffy/fund-routing section, plus T-02, T-04, T-05, T-16 (the
  guardrail cross-references) and the two reference notes (Activity Fund pass-through
  policy; Zeffy Monday lump-payout practice).
- Grepped and read `guardrails()` in full (`src/lib/ledger.ts`, lines ~768–963) to
  transcribe all 14 guardrail titles verbatim and write a one-line "what to do" note for
  each, cross-referenced against the matching `treasurer-todo.md` items where one exists.
- Read `src/lib/permissions.ts` for the exact `LEDGER_*` feature keys and descriptions.
- Read `reimbursements/page.tsx` and `compliance/page.tsx` in full to confirm the exact
  gate call, breadcrumb, and header conventions to copy verbatim (not approximate).
- Read `ledger-settings-form.tsx` for the exact five settings fields and their storage
  shape (cents vs. dollars, `holdingPeriodWarnDays` as a raw integer,
  `philanthropyVisibility` as `"board" | "members"`).
- Read `src/lib/ledger.ts` for `Determine990Result` (`{ form, why }`) and confirmed
  `determine990()`'s inputs are financial (tax classification, charity status, gross
  receipts, assets) — not filing-row-dependent.
- Grepped `ledger-queries.ts` for all exported functions to confirm `getEntities`,
  `getSettings`, `getComplianceOverview`, and `get990Prep` exist with the signatures used
  above, and read `getComplianceOverview()` in full (lines 1541–1588) — confirmed it
  reads `listFilings()` (a read) but never writes, and that `determine990Result` comes
  from `getOverview()`'s financial computation, not from filing rows — the basis for
  deciding the guide should skip `ensureFilingsForFY()`.
- Read `src/app/(dashboard)/admin/ledger/page.tsx` (dashboard/`LoadErrorCard` pattern),
  `reports/page.tsx` (entity-wide report), `[fundSlug]/page.tsx` (per-fund register), and
  confirmed `approvals/page.tsx` exists and gates on `hasFeature(session.user.id,
  FEATURES.LEDGER_APPROVE)` alone (stricter, single-feature gate) — informs the
  Reimbursements & Approvals section's note about that page's gate being an exception.
- Grepped `transaction-form.tsx` for the exact field list (category, party, payment
  method, check number, receipt waiver, public note) for the Books & Register section
  outline.
- Read `src/components/admin/admin-sidebar.tsx` (Treasury group, lines 78–119) to confirm
  the exact insertion point and existing sibling-item shape.
- Read `.claude/skills/release-notes/SKILL.md` in full to place the maintenance bullet
  precisely (Step 4) and confirm the `/release-notes` skill's ownership boundary (tech-lead
  writes it at merge time, not the implementer).
- Read `docs/decisions.md`'s format and current top entry number; logged **DECISION-037**
  for the one implementation decision Phase 2 explicitly punted to this phase (which
  values get live interpolation, and why `ensureFilingsForFY` must not be called from a
  read-only page).

## Outputs

- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 3 section; Per-Phase
  Status row updated to `Complete / Design complete, implementer named / 2026-07-21`.
- `docs/decisions.md` — new **DECISION-037** entry (live-value interpolation scope +
  `ensureFilingsForFY` write-avoidance), added above DECISION-036.
- No other source files touched — Phase 3 is design-only; the SKILL.md and CLAUDE.md
  edits named in Implementation Order steps 5–6 are explicitly Phase 4 (implementation)
  work, not made here.

## Open questions / handoff notes

- **Use the ux-developer agent for the whole feature** — one route, eleven section
  components, two trivial live reads reusing existing query functions verbatim, no new
  API surface. This does not warrant a database-admin/api-developer/ux-developer split;
  it's content-heavy UI work with a couple of prop-drilled data reads, squarely
  ux-developer's territory.
- The implementer should treat the per-section content outline above as authoritative
  copy direction, not just a file list — in particular, the guardrails table's 14 rows
  and the Zeffy section's T-17-current framing are load-bearing content, not placeholder
  prose to be rewritten from scratch.
- The implementer owns steps 3–6 of Implementation Order (sidebar entry, print styling,
  SKILL.md bullet, CLAUDE.md bullet) as part of this feature's own PR, per this task's
  explicit instruction that the SKILL.md edit is implementation, not design.
- Release notes (Implementation Order step 7) are **not** the implementer's job — flag to
  tech-lead at Phase 6 / merge-prep time.
- Phase 5 (qa) should pay particular attention to the two failure-fallback paths
  (compliance-990, settings) since they're the only DB-dependent surface in an otherwise
  fully static page, and to the reconciliation section's wording against inc2's state at
  review time (that state can have moved since this design was written).

---

## Design amendment (user request, 2026-07-21, post-Phase 3)

**The guide must also be reachable from the Ledger overview page** (`/admin/ledger`),
not only the sidebar. Implementer adds a discoverable entry point on the overview —
e.g., a "Treasurer's Guide" link/card in the dashboard header area or alongside the
existing panel links, following the overview page's existing link conventions
(text-lions-blue, focus ring). Small additive edit to the overview page; include it
in the Phase 5 click-through list.

---

# Phase 4 — Implementation (UI) — 2026-07-21

**Owner:** ux-developer
**Status:** complete

### Summary

Built the Treasury User's Guide exactly per the Phase 3 design: a thin Server Component shell at
`/admin/ledger/guide` composing eleven section components under
`src/components/admin/ledger/guide/`, gated on the reimbursements-page precedent
(`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])`), with the two live
reads (990 determination per entity, current settings recap) each try/catch-wrapped with a
one-line fallback. One deliberate deviation from the design doc: the reconciliation section was
upgraded to document the real, shipped manual reconciliation workbench instead of the "coming
soon" stub the design was written against — see Deviation below. Added the sidebar nav entry,
the overview-page entry point per the post-Phase-3 amendment, the release-notes SKILL.md
maintenance bullet, and the CLAUDE.md Key Features line. Typecheck, unit tests (432/432), and the
production build all pass clean, with `/admin/ledger/guide` present in the build manifest as a
dynamic route.

### What I did

- Read the Phase 1–3 sections and the post-Phase-3 design amendment in full; treated all as
  binding per this task's instructions.
- Read `docs/treasurer-todo.md` in full, especially T-17's current (2026-07-21, revised)
  single-Zeffy-account text, T-04 (Activity Fund $84.52), T-02 (uncashed OLF checks), T-05
  (bonding), T-16 (aged public-fund earmarking), and the two reference notes (Activity Fund
  pass-through policy; Zeffy Monday lump-payout practice) — the Zeffy & Fund Routing and
  Uncashed Checks sections are written against this text directly, not a stale mental model.
- Read `guardrails()` in full (`src/lib/ledger.ts` lines 768–964) and transcribed all 14 titles
  verbatim (generic phrasing only where the live title interpolates a dynamic value — fund kind,
  day-count threshold — per the design's drift-avoidance ruling), each with the design doc's
  "what to do" line.
- Read `src/lib/permissions.ts` / `permissions-server.ts` for the exact `LEDGER_*` keys and
  `hasAnyFeature` signature; read `reimbursements/page.tsx`, `compliance/page.tsx`,
  `settings/page.tsx`, and `reports/page.tsx` in full to copy the exact gate call, breadcrumb,
  eyebrow/`h1`/subtitle header convention, and `rounded-2xl` card treatment verbatim.
- Read `ledger-queries.ts`'s `getComplianceOverview()` and `getSettings()` signatures/return
  shapes, and `getEntities()`'s `LedgerEntity` shape (`slug`, `name`, `shortName`).
- Read `ledger-settings-form.tsx` for the five exact settings field names
  (`disbApprovalThresholdCents`, `reserveWarnThresholdCents`, `holdingPeriodWarnDays`,
  `treasurerBonded`, `philanthropyVisibility`) and `transaction-form.tsx` for the real
  Books & Register field set (category, party/payer-payee, `paymentMethod` including
  `debit_card`, structured `checkNumber`, memo, beneficiary cause, `publicNote`, receipt +
  waiver).
- **Read the actual shipped reconciliation surface** —
  `src/app/(dashboard)/admin/ledger/reconciliation/page.tsx`,
  `reconciliation/[sessionId]/page.tsx`, `new-reconciliation-session-form.tsx`, and
  `reconciliation-tie-out-summary.tsx` — to confirm inc2 is fully built (not schema-only, as the
  Phase 1/3 design assumed): a session list with New Session / Open / Closed filters, a
  per-session workbench (CSV upload → matching grid → tie-out summary → hard-gated Close →
  LEDGER_MANAGE-gated Reopen). Grepped `reconciliation-matching-grid.tsx` and confirmed no
  auto-match/suggestion logic exists yet — matching is manual, one bank line at a time — so
  "auto-match" and "Zeffy payout batch matching" are the only things still honestly "coming
  soon."
- Read `src/app/(dashboard)/admin/ledger/page.tsx` (the two-entity Overview / `LoadErrorCard`
  pattern) and `ledger-dashboard.tsx` (the actual "Overview" `h1` component rendered at bare
  `/admin/ledger`) to place the amendment's entry point in the right file and match its existing
  header-row and link conventions.
- Read `src/components/admin/admin-sidebar.tsx` (Treasury group, Ledger sub-list) to confirm
  "Ledger Settings" is the last item and append after it.
- Read `.claude/skills/release-notes/SKILL.md` Step 4 to place the architect's drafted bullet
  verbatim.
- Ran `pnpm exec tsc --noEmit` (clean), `pnpm test` (432/432 passing, no new tests added — see
  Named Tests note below), and `pnpm build:only` (passes; `/admin/ledger/guide` appears in the
  route manifest as a dynamic/`ƒ` route).
- Verified every cross-link's target route exists by grepping the build manifest: `/admin/dues`,
  `/admin/ledger`, `/admin/ledger/approvals`, `/admin/ledger/compliance`,
  `/admin/ledger/reconciliation`, `/admin/ledger/reimbursements`, `/admin/ledger/reports`,
  `/admin/ledger/settings`, `/members/dues` — all present.
- Grepped the new files for `console.*`, native dialogs, and `'use client'` — none found; the
  entire guide surface is pure Server Components as required.

### Deviation — Reconciliation section upgraded beyond the Phase 3 design

The Phase 3 design's `reconciliation-section.tsx` outline was written when Bank Reconciliation
inc2 had shipped only schema (no route or UI), so it scoped the section to "live today: check
numbers, per-row reconcile toggle, uncashed checks" plus a concept-level "coming soon" half.
Per this task's explicit instruction, I verified the actual current tree and found inc2 is now
**complete**: `/admin/ledger/reconciliation` and `/admin/ledger/reconciliation/[sessionId]` are
real, shipped pages implementing the full manual workflow (open a session against a bank
account → upload a CSV bank-statement export → match each bank line to a ledger transaction (or
create one) → a running tie-out summary → a hard-gated Close (disabled until balanced to the
penny and every in-period line is matched, no override) → Reopen, gated stricter on
`LEDGER_MANAGE`).

Publishing the design's original "coming soon" copy would have been actively wrong — it would
tell a successor treasurer a shipped, real feature doesn't exist yet. I upgraded
`reconciliation-section.tsx` to document the real workflow step-by-step, cross-linked to
`/admin/ledger/reconciliation`, and narrowed "coming soon" to only the two things still
genuinely unbuilt: automatic match suggestions and a Zeffy Monday-lump-deposit batch-matching
mode (confirmed by reading `reconciliation-matching-grid.tsx` — matching today is one bank line
at a time, no auto-suggest logic exists). I also dropped the TOC label's "(Coming Soon)"
qualifier for this section, since the section is now primarily documentation of a live feature.
This is a deviation-with-cause from the Phase 3 design doc, not a silent rewrite — recording it
here per this task's instruction, and flagging it for Phase 6 (analyst) as a place where the
shipped feature exceeds rather than merely matches the Phase 3 design's letter.

### Named Tests

Per the Phase 3 design's own "Named Tests" section: no new unit tests are warranted. This
feature adds zero new pure logic — the two live reads reuse `getEntities()`,
`getComplianceOverview()`, and `getSettings()` verbatim (already covered by existing tests where
they have logic worth testing), and I did not extract any new conditional-formatting helper that
would itself warrant a Vitest unit test (the fallback rendering is a simple ternary in each
section component, not a function). `pnpm test` remains 432/432 — unchanged from before this
feature, confirming no regression.

### Print styling — scoped to the guide page only, not the shared layout

The Phase 3 design's Implementation Order step 4 called for a `print:hidden` class on the shared
admin sidebar/layout (`src/app/(dashboard)/admin/layout.tsx`), so a printed copy of the guide is
just its content. This task's explicit footprint instruction lists only
`src/components/admin/admin-sidebar.tsx` (for the one nav-item insertion) and does not include
the shared layout file, with an explicit "Do NOT touch anything else." I did not touch the
shared layout. As a same-effect substitute fully inside my footprint, I added `print:hidden` to
the guide page's own breadcrumb and table-of-contents blocks (in the new `page.tsx` itself) —
this trims the least useful chrome from a printed copy without editing any shared file. The
sidebar itself will still print alongside the guide content until a future change (in scope for
whoever owns the shared layout) adds the class there. Flagging this explicitly rather than
silently narrowing scope.

### Outputs

- `src/app/(dashboard)/admin/ledger/guide/page.tsx` (new) — thin Server Component shell: auth +
  `hasAnyFeature` gate, breadcrumb, header, intro, native `<details open>` TOC (11 entries, no
  client JS), the two try/catch-wrapped live reads, and the ordered section-component list.
- `src/components/admin/ledger/guide/` (11 new files, one per TOC entry):
  `bank-transition-section.tsx`, `books-register-section.tsx`,
  `zeffy-fund-routing-section.tsx`, `dues-section.tsx`, `reimbursements-section.tsx`,
  `uncashed-checks-section.tsx`, `compliance-calendar-section.tsx` (exports the
  `Entity990Determination` prop type), `guardrails-section.tsx` (all 14 guardrail rows),
  `reports-section.tsx`, `reconciliation-section.tsx` (upgraded per Deviation above),
  `settings-section.tsx` (nullable `LedgerSettings` prop).
- `src/components/admin/admin-sidebar.tsx` — one nav item ("User's Guide", 📖,
  `/admin/ledger/guide`, `requiredFeature: FEATURES.LEDGER_VIEW`) appended after "Ledger
  Settings" in the Treasury group's Ledger sub-list, per the design's ruling.
- `src/components/admin/ledger/ledger-dashboard.tsx` — design-amendment entry point: the
  Overview page's header is now a `flex` row with a "Treasurer's Guide" text link
  (`text-lions-blue hover:text-lions-blue-dark`, focus ring, book-icon SVG) alongside the
  existing "Overview" `h1`, following this page's own header/link conventions.
- `.claude/skills/release-notes/SKILL.md` — Step 4 gained the architect's drafted maintenance
  bullet verbatim (the "Treasury User's Guide" drift-check line).
- `CLAUDE.md` — the Member Portal → Admin "Key Features" line now includes ", and an in-app
  Treasury User's Guide at `/admin/ledger/guide`" inside the existing Ledger parenthetical.
- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 4 section; Per-Phase Status
  row updated to `Complete / — / 2026-07-21`.
- No other files touched. No `docs/decisions.md` entry added (nothing here meets that log's
  stated scope of new dependency / new top-level module / route-group change / permission-catalog
  change — the guardrails table and reconciliation deviation are content decisions, not
  architectural ones).

### Gate results

- `pnpm exec tsc --noEmit` — clean, zero errors.
- `pnpm test` — 432/432 passing (no new tests added; see Named Tests above).
- `pnpm build:only` — passes; `/admin/ledger/guide` appears in the route manifest as a dynamic
  (`ƒ`) route, alongside every other Ledger subpage.
- No `console.*`, no native browser dialogs, no `'use client'` anywhere in the new files
  (grepped and confirmed).
- No migrations, no schema changes, no new `FEATURES` key.

### Open questions / handoff notes

- **Next: qa (Phase 5).** Click-through list:
  - **Gate audit:** confirm a session holding only `LEDGER_APPROVE` can load
    `/admin/ledger/guide` directly (passes the page's `hasAnyFeature` gate) but does **not** see
    the "User's Guide" link in the sidebar (single-string `requiredFeature: LEDGER_VIEW`) — this
    is Ruling 5's accepted, pre-existing inconsistency (same as Reimbursements/Approvals), not a
    new bug.
  - **Every TOC anchor** (all 11): Treasurer Transition — Bank Account, Books & the Register,
    Zeffy & Fund Routing, Dues, Reimbursements & Approvals, Uncashed Checks, Compliance Calendar
    — Form 990, Compliance Guardrails, Reports, Bank Reconciliation, Ledger Settings & Annual
    Review — scrolls to the correct `#anchor-id`.
  - **Every cross-link** resolves to a real page: `/admin/ledger`, `/admin/ledger/compliance`,
    `/admin/ledger/settings`, `/admin/ledger/reports`, `/admin/ledger/reimbursements`,
    `/admin/ledger/approvals`, `/admin/ledger/reconciliation`, `/admin/dues`, `/members/dues`.
  - **Live values render real data:** the 990 determination for both entities (Club,
    Foundation) and the settings recap (all five current values) render actual numbers, not
    fallback text, against the seeded local DB.
  - **Fallback paths render sanely:** simulate a failure in `getEntities()`/
    `getComplianceOverview()` and in `getSettings()` (e.g., temporarily throw inside a local
    copy) and confirm each affected section shows its one-line fallback instead of crashing the
    page — the surrounding static sections must still render normally.
  - **Overview-page entry point:** bare `/admin/ledger` shows the "Treasurer's Guide" link in the
    header next to "Overview," and it navigates to `/admin/ledger/guide`.
  - **Mobile at 360px:** the `<details>` TOC opens/closes with no fixed side rail; no horizontal
    scroll anywhere on the page; the guardrails table scrolls inside its own
    `overflow-x-auto` container, not the page body.
  - **Reconciliation section accuracy:** spot-check the section's described workflow (session →
    upload → match → tie-out → close → reopen) against the live `/admin/ledger/reconciliation`
    pages at review time, and confirm the "coming soon" callout names only auto-match/
    Zeffy-batch-matching, nothing already shipped.
  - **Donors is absent:** confirm no TOC entry, section, or cross-link mentions donors or
    acknowledgments anywhere on the page (explicit user exclusion).
- **New copy the Lions Club may want to refine:** the intro paragraph's tone/wording; the
  Zeffy caveat callout wording ("a gift made through the club-side Zeffy form is legally a gift
  to the club, not the 501(c)(3) Foundation"); the annual-review callout wording in the Settings
  section. None of these are load-bearing facts — all are safe to wordsmith later without a
  re-review of content accuracy.
- **UX decisions/tradeoffs made this session:**
  - Dropped the design doc's "(Coming Soon)" TOC-label suffix on the reconciliation section — see
    Deviation above.
  - Added a cross-link to `/members/dues` in the Dues section (named in the Phase 3 design's
    outline as "for context") worded as "See the member-portal dues history page" rather than
    "view a member's dues" — clicking it as an admin shows the admin's own dues history if
    they're a linked member, not an arbitrary member's, so the wording avoids implying otherwise.
  - Print styling narrowed to the guide page's own chrome only, not the shared admin layout — see
    the Print styling note above; a genuine scope call given the footprint restriction, not an
    oversight.
- **Release notes are still not this agent's job** — tech-lead writes them at Phase 6/merge-prep
  time per the Phase 3 design's Implementation Order step 7; not done here.

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete
**Verdict:** PASS

## Summary

PASS. All four gates are clean (tsc, 432/432 unit tests, production build with
`/admin/ledger/guide` in the manifest, and a full Playwright click-through against a live dev
server). The gate audit confirms `page.tsx` calls `auth()` + `hasAnyFeature([LEDGER_VIEW,
LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])`, matching the Reimbursements precedent exactly,
with sidebar and overview-page entry points both present and working. Content-accuracy spot-checks
found no wrong words: the bank-transition facts, the November 15 Form 990 date, the Zeffy/Activity
Fund routing (verified verbatim against T-17's current, revised text), the 14-row guardrails table
(diffed 1:1 against `guardrails()` in `src/lib/ledger.ts` — titles and severities both match), the
payment-method list, and the reconciliation section's description of the real, shipped
reconciliation workbench (verified against the actual route files and the hard-close-gate code)
all check out. Donors & acknowledgments are absent from the guide's own content (the one "donors"
href on the page is the pre-existing sidebar item, not a guide cross-link). No defects found.

## What I did

- Read the full work-log (Phases 1–4, the post-Phase-3 design amendment, and the Phase 4
  deviation note on reconciliation) before touching anything.
- **Gates:**
  - `pnpm exec tsc --noEmit` — clean, zero errors.
  - `pnpm test` — 13 files, 432/432 passing, ~0.3s duration (matches the implementer's claim,
    confirming no regression).
  - `pnpm build:only` — passed; confirmed `/admin/ledger/guide` present in the route manifest as
    a dynamic (`ƒ`) route via `grep` on the build output; no errors/warnings.
- **Gate audit (source read):** read `src/app/(dashboard)/admin/ledger/guide/page.tsx` in full —
  confirmed `auth()` + redirect-to-`/signin`, then `hasAnyFeature(session.user.id, [LEDGER_VIEW,
  LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` + redirect-to-`/access-pending`, exactly per the
  Phase 3 design and the Reimbursements-page precedent. Read `admin-sidebar.tsx` (Treasury group)
  and confirmed one new item — `"User's Guide"`, `/admin/ledger/guide`, `requiredFeature:
  FEATURES.LEDGER_VIEW` — appended after "Ledger Settings", matching the single-string-gate
  precedent used by every other Treasury sidebar item. Read `ledger-dashboard.tsx` and confirmed
  the post-Phase-3 amendment's "Treasurer's Guide" link is present in the Overview header, wired
  to `/admin/ledger/guide`.
- **Dev-server click-through:** started `pnpm dev` on port 3000, wrote a temporary Playwright spec
  (`e2e/_qa-tmp-guide-clickthrough.spec.ts`, deleted after this run — not a permanent regression
  test, since the Phase 3 design's own "Named Tests" section correctly found no new pure logic
  here) using the existing `signInAsAdmin` helper, and ran it via `dotenv -e .env.local --
  playwright test`. Results:
  - Overview-page entry point: the "Treasurer's Guide" link is visible on `/admin/ledger` and
    navigates to `/admin/ledger/guide` — confirmed.
  - All 11 TOC anchor ids (`bank-transition`, `books-register`, `zeffy-fund-routing`, `dues`,
    `reimbursements`, `uncashed-checks`, `compliance-990`, `guardrails`, `reports`,
    `reconciliation`, `settings`) exist as real `<section id="...">` elements — 0 missing.
  - All 9 cross-link targets (`/admin/ledger`, `/admin/ledger/compliance`,
    `/admin/ledger/settings`, `/admin/ledger/reports`, `/admin/ledger/reimbursements`,
    `/admin/ledger/approvals`, `/admin/ledger/reconciliation`, `/admin/dues`, `/members/dues`) are
    present as rendered `<a href>` targets on the page — 0 missing.
  - Live 990 determination renders real per-entity values, not fallback text: "Club: 990-N —
    501(c)(4) with gross receipts ≤ $50,000 may file Form 990-N." / "Foundation: 990-N — Public
    charity with gross receipts ≤ $50,000 may file Form 990-N (e-Postcard)." — both sourced from
    `getComplianceOverview()`, matching what `/admin/ledger/compliance` computes from the same
    function.
  - Live settings recap renders real current values, not fallback text: Disbursement threshold
    $100.00, Reserve warning threshold $25,000.00, Public-fund holding period 365 days, Treasurer
    bonded Yes, Philanthropy visibility Board only — sourced from `getSettings()`, the same
    function `/admin/ledger/settings` calls.
  - Donors absent: 0 donor-related cross-links inside the guide's own content; the only
    `/admin/ledger/donors` href found on the page is the pre-existing Treasury sidebar item
    (present on every admin Ledger page), not something the guide itself links to. Grepped the
    guide's `page.tsx` and all 11 section files for "donor" beforehand — the only source-level
    hits are the Phase-4 doc-comment noting the exclusion and the Zeffy section's donor
    tax-deductibility caveat (both expected, neither is a Donors *surface* reference).
  - Mobile at 360px: `document.documentElement.scrollWidth === clientWidth` (360 === 360) — no
    page-level horizontal scroll. The `<details>` TOC toggled correctly (opened by default per
    `<details open>`, closed on a summary click). The guardrails table has its own
    `.overflow-x-auto` scroll container (confirmed present via locator count), so it scrolls
    independently rather than widening the page. Screenshot captured and visually reviewed — no
    clipped or overflowing content.
  - Sidebar: the "User's Guide" link is present and visible for the full-featured admin test
    account (`SIDEBAR_GUIDE_LINK_COUNT: 1`).
- **Content-accuracy spot-check (this feature's real risk):**
  - **Bank-transition section** (`bank-transition-section.tsx`) matches the user's verbatim
    facts exactly: meeting minutes required before switching signers; two forms of ID with a
    credit card counting as the second; treasurer made primary signer; attendees = new president +
    new treasurer + one of the two prior-year signers; budget ~2 hours at the branch. No
    deviation.
  - **Form 990** (`compliance-calendar-section.tsx`): fiscal year July 1–June 30, filing due
    November 15 — matches the user's 2026-07-21 confirmation ("590 was a typo," corrected to
    November 15). Correctly describes the specific form (990-N/990-EZ/990) as computed
    automatically, not hardcoded.
  - **Zeffy & Fund Routing** (`zeffy-fund-routing-section.tsx`): read T-17's live, current
    (2026-07-21 revised) text in `docs/treasurer-todo.md` side-by-side with the section and
    confirmed an exact match — single Zeffy account (no second account opened), dues → admin
    income unchanged, donations → Activity Fund → prompt sweep to Foundation, the transfer-record
    process (Activity Fund expense → Foundation income, citing the board minute), the Monday
    lump-payout reconciliation practice (Zeffy takes no ledger-side fee, so the weekly sum should
    equal the deposit exactly), and the club-vs-501(c)(3) donor caveat. No trace of the superseded
    two-Zeffy-account plan.
  - **Guardrails** (`guardrails-section.tsx`): read `guardrails()` in `src/lib/ledger.ts`
    (lines 768–964) in full and diffed all 14 titles + severities against the guide's table
    1-for-1: Negative fund balance (high), Reserves below minimum threshold (warn), Treasurer not
    bonded (warn), Income entries missing itemized source (warn), Cash disbursements recorded
    (warn), Expenses missing receipt documentation (info), Disbursements pending board approval
    (warn), Unreconciled transactions from prior months (warn), Two-fund firewall violation (high),
    IRS 990 revocation risk — 3 consecutive unfiled returns (high), Overdue compliance filings
    (warn), Dues payment sync mismatch (warn), Public fund(s) holding undisbursed balance past
    threshold (warn), Public-category income posted directly to Administrative fund (warn) — 14/14
    match, including the two guardrails with dynamic-value titles (fund kind, day-count threshold)
    correctly generalized per DECISION-037's drift-avoidance rule rather than hardcoded.
  - **Reconciliation** (`reconciliation-section.tsx`): opened
    `/admin/ledger/reconciliation/page.tsx` and `[sessionId]/page.tsx` side-by-side with the
    section's claimed workflow. Every claimed step exists in the shipped code: session creation
    excludes cash-type accounts (confirmed — `eligibleAccounts` filters `accountType !== "cash"`,
    matching the section's Petty Cash example); CSV upload once per session
    (`!reconSession.uploadedAt` gate); manual one-line-at-a-time matching grid (grepped
    `reconciliation-matching-grid.tsx` for auto-match/suggest/batch logic — none found, confirming
    "coming soon" is correctly scoped to only that); a running tie-out summary; a hard Close gate
    with `disabled={!canClose || closing}` where `canClose = tieOut.balanced &&
    tieOut.unmatchedInPeriodCount === 0` and the component's own comment says "HARD gate, no
    override" — matches the guide's claim exactly; Reopen gated on `canManage`
    (`hasFeature(..., LEDGER_MANAGE)`), stricter than view/record, matching the guide's note. The
    "coming soon" callout correctly names only auto-match suggestions and Zeffy-batch matching —
    both genuinely unbuilt, confirmed by the same grep. This is a deviation-with-cause from the
    Phase 3 design (which assumed inc2 was schema-only) and the implementer's Phase 4 write-up
    disclosed it accurately — my independent read of the shipped reconciliation code confirms the
    upgraded section is itself accurate, not just consistent with the implementer's own claim.
  - **Payment methods** (`books-register-section.tsx`): "Check, Cash, Zeffy, Debit Card, or Other"
    matches `METHOD_LABELS` in `transaction-form.tsx` exactly (`check`, `cash`, `zeffy`,
    `debit_card`, `other`).
  - **Settings** (`settings-section.tsx`): all five fields (disbursement threshold, reserve
    threshold, holding-period days, treasurer-bonded, philanthropy visibility) match
    `ledger-settings-form.tsx`'s field set; no hardcoded numbers in the static prose, per
    DECISION-037.
  - No wrong words found anywhere in the spot-check. Every claim checked against its ground truth
    (user's verbatim notes, `treasurer-todo.md`, `guardrails()`, the live reconciliation route
    files, `transaction-form.tsx`) matched.
- **Forced-failure fallback:** did not force a live DB failure (would require temporarily
  modifying source outside this task's footprint restriction). Verified by code-read instead —
  both `compliance-calendar-section.tsx` and `settings-section.tsx` render a simple ternary
  (`entity990s && entity990s.length > 0 ? <real content> : <italic gray fallback line>` and
  `settings ? <real content> : <italic gray fallback line>`), and `page.tsx` wraps both reads in
  `try/catch` that sets the value to `null` on any thrown error, so a failure in either
  `getComplianceOverview()`/`getEntities()` or `getSettings()` cannot crash the page — it degrades
  to the documented one-line fallback while every other (static) section renders normally. This
  matches DECISION-037's design exactly; I did not observe it live.
- Cleaned up: deleted the temporary Playwright spec (`e2e/_qa-tmp-guide-clickthrough.spec.ts`),
  confirmed `git status` shows no stray QA artifacts, and killed the `pnpm dev` process on port
  3000.

### Type Check
`pnpm exec tsc --noEmit`: **PASS** — zero errors.

### Unit Tests
`pnpm test`: **PASS**
Total: 432 | Passed: 432 | Failed: 0
Duration: ~0.3s (13 test files)
Failures: none

### Production Build
`pnpm build:only`: **PASS**
Notes: `/admin/ledger/guide` present in the route manifest as a dynamic (`ƒ`) route, alongside
every other Ledger subpage. No unexpected warnings.

### End-to-End Tests
`pnpm test:e2e` (existing suite): not run separately — this feature added no new API surface or
mutation flow for the existing `e2e/*.spec.ts` suite to regress against. Verification instead used
a temporary, feature-specific Playwright script (see What I did) covering every item on the
implementer's Phase 4 click-through list; deleted after this run per the Phase 3 design's own
"no new unit tests warranted" conclusion (no new pure logic to protect with a permanent spec).
Total: 2/2 temporary checks passed | Duration: ~10s combined.

### Manual Click-Through (anything the runner can't reach)

| Flow | Result | Notes |
|------|--------|-------|
| Narrower-permission gate behavior (`LEDGER_APPROVE`-only session: page loads, sidebar link hidden) | pass (source-read) | No second seeded test user with a `LEDGER_APPROVE`-only role exists in this environment; verified via source read instead — `page.tsx`'s `hasAnyFeature` includes `LEDGER_APPROVE`, and the sidebar's `requiredFeature` field is a single string (`LEDGER_VIEW`), matching the identical, already-accepted Reimbursements/Approvals precedent (architect Ruling 5). Not a live behavioral test. |
| Forced live-read failure fallback (990/settings) | pass (code-read) | Not forced live (would require editing source outside this task's footprint); ternary + try/catch code-read confirms the fallback renders instead of crashing. |

### Regression Tests Added
None. Per the Phase 3 design's own "Named Tests" section (correctly carried into Phase 4): this
feature adds zero new pure logic — both live reads reuse `getComplianceOverview()`/`getEntities()`/
`getSettings()` verbatim, and no new conditional-formatting helper was extracted that would
otherwise warrant a Vitest unit test. Agreeing with that call rather than inventing coverage for
its own sake.

### Coverage on Critical Modules
Unchanged by this feature (no new pure-TS logic added):
- `src/lib/events.ts`: not touched by this feature.
- `src/lib/permissions.ts`: not touched by this feature.
- `src/lib/members.ts`: not touched by this feature.
- `src/lib/ledger.ts` (`guardrails()`, transcribed verbatim into the guide's content, not
  re-implemented): pre-existing coverage unaffected.

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)`/`hasAnyFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `GET /admin/ledger/guide` (page) | yes | yes — `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` | Yes — matches the broadest existing Ledger read-gate (Reimbursements-page precedent), correct for a read-only surface describing all Ledger subpages including reimbursements/approvals. |

No server actions or API routes were added by this feature (confirmed — no route handlers, no
`"use server"` files in the Phase 4 Outputs list). The sidebar's `requiredFeature: LEDGER_VIEW`
(single-string field) is a *nav-visibility* filter, not a security gate — the page's own
`hasAnyFeature` call is the actual enforcement, and it is broader than the nav filter by design
(an accepted, pre-existing inconsistency also present on Reimbursements/Approvals, not a gap this
feature introduces).

### Verdict: PASS

## Outputs

- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 5 section; Per-Phase Status row
  updated to `Complete / PASS / 2026-07-21`.
- No implementation source files modified. Temporary verification artifact
  (`e2e/_qa-tmp-guide-clickthrough.spec.ts`) created and deleted within this session; `git status`
  confirmed clean of QA residue afterward.
- Dev server (port 3000) started for verification and killed at the end of this session.

## Open questions / handoff notes

- **Next: analyst (Phase 6).** Shipped-vs-intent should weigh the one deliberate deviation flagged
  by the implementer: the reconciliation section was upgraded beyond the Phase 3 design's "coming
  soon" stub to document the real, shipped reconciliation workbench — I independently verified
  this upgraded content against the live route files and found it accurate, not merely
  self-consistent with the implementer's own claim. This is a case where the shipped feature
  exceeds the Phase 3 design's letter in a way that improves accuracy, not a defect.
  Recommend Phase 6 treat it as a positive deviation, not a gap.
- No defects found. No loop-back needed.
- The narrower-permission (`LEDGER_APPROVE`-only) gate check and the forced-failure fallback check
  were both verified by source-read rather than live behavioral test (no second seeded test user;
  forcing a live DB failure would have required editing source outside this task's footprint). If
  a future review wants a live behavioral confirmation of either, that would need a seeded
  `LEDGER_APPROVE`-only test account or a dependency-injection seam for the two live reads —
  neither exists today and neither is a defect in this feature.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** SHIP WITH NOTES

## Summary

The shipped Treasury User's Guide delivers what Phase 1 promised: a single, linear, in-app
reference at `/admin/ledger/guide` that carries the user's six verbatim content notes as
mandatory sections inside a full 11-section table of contents, gated identically to the
Reimbursements-page precedent, reachable from both the sidebar and (per the post-Phase-3
amendment) the Ledger Overview header. I re-read the Phase 1–5 sections in full, then read the
actual shipped `page.tsx` and all eleven section components myself, as the successor-treasurer
persona Phase 1 named as the primary use case — not just QA's accuracy diff, which I also
independently spot-checked rather than took on faith. Two things earn "notes" rather than a bare
ship: the print-support recommendation was only partially delivered (disclosed and justified,
but still a real gap against Phase 1's stated in-person-bank-visit use case), and two gate/
fallback behaviors were verified by source-read only, not a live behavioral test, because no
`LEDGER_APPROVE`-only seeded account exists. Neither blocks shipping; both are concrete,
trackable follow-ups.

## What I did

- Read the full work-log (Phases 1–5, the post-Phase-3 design amendment, DECISION-037, and the
  Phase 4 deviation note on reconciliation) before touching anything.
- Read the actual shipped source myself, independent of QA's diff: `src/app/(dashboard)/admin/
  ledger/guide/page.tsx` and all eleven files under `src/components/admin/ledger/guide/`
  (`bank-transition-section.tsx`, `books-register-section.tsx`,
  `zeffy-fund-routing-section.tsx`, `dues-section.tsx`, `reimbursements-section.tsx`,
  `uncashed-checks-section.tsx`, `compliance-calendar-section.tsx`, `guardrails-section.tsx`,
  `reports-section.tsx`, `reconciliation-section.tsx`, `settings-section.tsx`) — read them in
  TOC order, as a successor treasurer would, to judge coherence and assumed context, not just
  word-for-word accuracy.
- Grepped and read `.claude/skills/release-notes/SKILL.md` (Step 4, the maintenance bullet) and
  `CLAUDE.md` (the Key Features admin line) to confirm both maintenance-convention edits landed
  verbatim as designed.
- Grepped `src/components/admin/admin-sidebar.tsx` and `src/components/admin/ledger/
  ledger-dashboard.tsx` to confirm the sidebar nav entry and the design-amendment overview entry
  point are both present and wired to `/admin/ledger/guide`.
- Weighed the reconciliation-section deviation against the Intent section's own text ("Should
  reflect shipped reconciliation behavior") rather than only against the Phase 3 design doc's
  necessarily-earlier "coming soon" letter.
- Weighed the print-scope note and the `LEDGER_APPROVE` sidebar inconsistency as notes vs.
  defects, per this task's framing.

## The successor-treasurer read (my independent judgment)

I read the guide front-to-back as the persona Phase 1 named as its actual reason to exist: a
newly-onboarded treasurer with no prior context. It holds together. The sequencing (bank
transition → books/register → Zeffy routing → dues → reimbursements/approvals → uncashed checks
→ compliance calendar → guardrails → reports → reconciliation → settings) follows money and
process in a sensible order, terms are defined before they're leaned on (fund, entity, posted
vs. pending all land in §2 before later sections use them), and every section that describes an
app surface links out to the live page rather than freezing a screenshot-era description of it.
The two live-value inserts (990 determination, settings recap) read as genuinely useful rather
than decorative — a successor gets the real current numbers, not a stale example. The one rough
edge: §5 (Reimbursements & Approvals) references "the approval threshold" before §11 (Settings)
formally defines "Disbursement approval threshold" — a forward reference, not a broken one (the
term is self-explanatory in context and Settings is cross-linked elsewhere), so I'm not treating
it as a defect, just noting it. Bank-transition content is clearly labeled as club/bank process
with no matching UI, exactly as Phase 1 required, so a reader won't go hunting for a screen that
doesn't exist. Donors & acknowledgments do not appear anywhere in the guide's own content — the
only "donors" href on the page is the pre-existing sidebar item, confirmed by my own read, not
just QA's grep. Net: this guide would actually onboard a successor without requiring an
interview with the outgoing treasurer for the basics — the yardstick Phase 1 set, met.

## Deviation ruling — reconciliation section upgrade

**Ruled: more faithful to intent, not merely acceptable drift.** The Intent section states the
guide "Should reflect shipped reconciliation behavior" — that is the actual instruction, and it
is more specific than the Phase 3 design doc's "coming soon" stub, which was written when inc2
had only shipped schema. By the time of Phase 4 implementation, inc2 had shipped a complete
manual reconciliation workbench (sessions, CSV upload, one-line-at-a-time matching, a tie-out
summary, a hard no-override Close gate, and a `LEDGER_MANAGE`-gated Reopen). Publishing the
design doc's original stub would have told a successor treasurer a real, live feature doesn't
exist — actively wrong, not just conservative. The implementer's upgrade, and QA's independent
verification of it against the live route files (session eligibility excludes cash accounts,
the CSV-upload-once gate, the manual matching grid with no auto-suggest code, the hard close
gate's exact condition), both hold up under my own read of `reconciliation-section.tsx`: it
correctly narrows "coming soon" to only the two things genuinely unbuilt (auto-match suggestions,
Zeffy-batch matching) and makes no claim beyond what the shipped code supports. This is the
correct call and should be the template for future cases where a design doc's assumptions about
an in-flight dependency go stale before implementation lands.

## Intent-vs-shipped diff

- Phase 1 said: six user content notes (bank transition, 990/Nov 15, compliance+reports,
  donors excluded, Zeffy/Activity-Fund routing per revised T-17, settings+annual-review) as
  mandatory spine sections. Shipped: all six present, verbatim-accurate (my own read confirms
  QA's word-level diff). **Verdict: matches.**
- Phase 1 said: full 11-section TOC covering the whole Ledger surface, not just the spine, with
  receipts/waivers/public-notes folded into Books & the Register. Shipped: exactly that — 11
  sections, receipts/waivers/public-note subsections present inside `books-register-section.tsx`
  as designed. **Verdict: matches.**
- Phase 1 said: donors & acknowledgments excluded from v1. Shipped: absent from the guide's own
  content (confirmed by my own read of all 11 files, not just QA's grep). **Verdict: matches.**
- Phase 1/3 said: reconciliation section scoped to "live today" + concept-level "coming soon."
  Shipped: full documentation of the actually-shipped reconciliation workbench, "coming soon"
  narrowed to only auto-match + Zeffy-batch matching. **Verdict: matches intent more faithfully
  than the design doc's letter** — see Deviation ruling above.
- Design amendment said: guide must also be reachable from the Ledger Overview page. Shipped:
  a "Treasurer's Guide" link in `ledger-dashboard.tsx`'s header, confirmed present and wired.
  **Verdict: matches.**
- Phase 1/3 said: gate on `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE,
  LEDGER_APPROVE])`, matching the Reimbursements precedent exactly; sidebar nav uses the single
  `requiredFeature: LEDGER_VIEW` field, an accepted pre-existing inconsistency (also true of
  Reimbursements/Approvals). Shipped: exactly that, confirmed by my own read of `page.tsx` and
  `admin-sidebar.tsx`. **Verdict: matches** (the inconsistency is expected precedent, not a
  regression this feature introduced).
- Phase 2/3 said: maintenance convention lands as a Step 4 bullet in the release-notes SKILL.md,
  plus a CLAUDE.md Key Features line. Shipped: both present verbatim, confirmed by my own grep/
  read. **Verdict: matches.**
- Phase 1 said (recommended, not requested): browser-print support via `print:hidden` on the
  admin sidebar/nav chrome, motivated by the in-person bank-visit use case in §1. Shipped:
  `print:hidden` applied only to the guide page's own breadcrumb and TOC blocks, not the shared
  admin layout/sidebar, because the implementer's footprint restriction excluded that file — a
  disclosed, reasoned substitution, not a silent gap. **Verdict: acceptable drift, but a real,
  trackable gap against the original recommendation** — see Follow-ups.

## Edge cases

- Empty state: not applicable (no list to be empty) — **pass** (correctly named as N/A rather
  than invented).
- Failure microcopy: **pass** — both live-value fallbacks (990 determination, settings recap)
  render a plain-language one-line fallback ("Unable to load the current 990 determination —
  see the Compliance page.") rather than a stack trace or blank section; confirmed by my own
  read of the ternary + try/catch in `page.tsx`, `compliance-calendar-section.tsx`, and
  `settings-section.tsx`.
- Permission gate: **pass** — `auth()` + `hasAnyFeature(...)` redirect-to-`/access-pending`
  confirmed present in `page.tsx`, matching the Reimbursements precedent exactly.
- Mobile (360px): **pass** — native `<details>` TOC (no fixed side rail, no client JS), and the
  guardrails table wrapped in its own `overflow-x-auto` container rather than widening the page;
  confirmed by my own read and consistent with QA's live 360px measurement.
- Brand consistency: **pass** — every section uses `rounded-2xl shadow-sm overflow-hidden p-6`
  (non-interactive card convention, correctly chosen over the interactive-card treatment since
  nothing here is clickable/hoverable), every cross-link uses the standard
  `text-lions-blue hover:underline ... focus:ring-2 focus:ring-lions-blue rounded` classes, no
  `rounded-full` anywhere, no native dialogs (none needed — no destructive actions on this page).

## Follow-ups (tracked per SHIP WITH NOTES)

1. **Extend print support to the shared admin chrome.** Phase 1 recommended `print:hidden` on
   the admin sidebar/nav so a printed copy of the guide is just its content, directly useful for
   the in-person bank-visit workflow §1 describes. The implementer's footprint restriction this
   session excluded the shared layout file, so the guide's own breadcrumb/TOC are print-hidden
   but the admin sidebar chrome still prints alongside. Low effort: add `print:hidden` to the
   sidebar/nav wrapper in `src/app/(dashboard)/admin/layout.tsx` (or wherever the shared chrome
   lives) in a follow-up PR; verify it doesn't regress print output on any other admin page
   (none currently styles for print).
2. **Add live behavioral coverage for the two source-read-only verifications.** QA confirmed (a)
   a `LEDGER_APPROVE`-only session can load `/admin/ledger/guide` but won't see the sidebar link,
   and (b) the two live-read fallbacks render correctly on failure — both by code-read, since no
   `LEDGER_APPROVE`-only seeded test account exists and forcing a live DB failure would have
   required editing source outside the QA footprint. Recommend the next 7-day test-coverage
   review either seed a `LEDGER_APPROVE`-only test account or add a small dependency-injection
   seam for `getEntities`/`getComplianceOverview`/`getSettings` so both paths get a real
   behavioral test rather than a read-the-code confirmation.

Neither follow-up blocks shipping — the feature delivers the promised content accurately, the
permission model is correct and matches existing precedent, and both fallbacks are logically
sound even though unexercised live in this review.

## Outputs

- `docs/work-log/2026-07-21-treasury-users-guide.md` — this Phase 6 section; Per-Phase Status
  row updated to `Complete / SHIP WITH NOTES / 2026-07-21`.
- No source files touched — Phase 6 is a read-only review per this task's instructions.

## Open questions / handoff notes

- Pipeline closes with **SHIP WITH NOTES**. The two follow-ups above should get their own
  backlog entries (or a short addendum to this work-log) so they aren't lost:
  - Print-support gap (shared admin layout) — small, low-risk, no design work needed.
  - Live-behavioral test coverage for the `LEDGER_APPROVE`-only gate path and the two live-read
    failure fallbacks — flag for qa's next 7-day test-coverage review.
- No loop-back to any earlier phase is warranted — nothing here is wrong, incomplete relative to
  the six content notes, or a regression. The reconciliation-section deviation is a positive one
  and should not be reverted.

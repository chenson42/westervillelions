# Backlog

Feature ideas and follow-ups that are agreed-on but not yet started. Items here
have **no work-log entry yet** — when one is picked up, run `/new-feature`, create
its work-log, and check it off here (append date + work-log slug rather than
deleting). Stable `B-nn` IDs for cross-referencing.

Phase 6 "SHIP WITH NOTES" follow-ups may also land here when they don't warrant an
immediate work-log.

**Reorganized 2026-09-05.** Structure: items are grouped into priority tiers
(`Now` / `Soon` / `Later` / `Watching / needs info` / `Likely obsolete — verify
and close`) instead of chronological insertion order. **IDs are stable and are
never renumbered, reused, or deleted** — an ID always refers to the same item for
the life of this document, regardless of which tier it moves through. Moving an
item between tiers, or into the obsolete tier, is a filing change, not a
judgment that the underlying work never mattered. Item text is unchanged from
how it was originally written; a `Priority note:` line is added under an item
only where its tier placement isn't obvious from the text alone. The obsolete
tier cites concrete evidence (file, work-log, or schema) for every claim that an
item already shipped — a human still has to verify and check it off; nothing
was deleted on the strength of this review alone.

---

## Table of Contents

**Now**
- B-33 — Decouple cause-breakdown eligibility from `countsAsGiving`
- B-34 — Explicit inter-fund transfers (remaining scope: consolidated roll-up double-count)
- B-38 — Publish the club constitution and by-laws (production seed step)
- B-47 — Receive Resend delivery webhooks, so a bounce is visible
- B-58 — Choose and ship the new homepage hero tagline
- B-60 — Trust-content follow-ups from the site review
- B-62 — Add www.westervillelions.org in the Vercel dashboard

**Soon**
- B-13 — Centralize the ledger payment-method list + labels
- B-27 — Increment 2: soft-delete/restore-until-finalize for budget lines
- B-32 — Post-changes budget analysis pass
- B-46 — Consolidate the copy-pasted scaffolding around every email send
- B-48 — Route-level automated test for the treasury CC rule
- B-53 — Six-to-nine e2e specs red on `main` outside the feature that surfaced them
- B-57 — Receipt-proxy download routes carry the same buffered-response exposure
- B-59 — Event type field + public calendar badges

**Later**
- B-02 — No Playwright auth fixture for a signed-in member
- B-03 — No e2e fixture for admin sub-permission variance
- B-04 — Oversized-file error message is unreachable in practice
- B-06 — No repair path for a mis-uploaded reconciliation-session CSV
- B-07 — Print support for the Treasury User's Guide
- B-08 — Member reimbursement upload has no HEIC support
- B-09 — Member profile picture upload has no HEIC-specific handling
- B-10 — CI-repeatable fixture for modern iPhone HEIC
- B-11 — Live HTTP round-trip test for the acknowledgment-letter byte guard
- B-12 — CI tripwire for "storage adapter silently wrong in production"
- B-15 — Consolidated entity-level budget-vs-actual rollup + YTD pacing
- B-18 — Structured cause on transactions & reimbursements
- B-20 — Playwright e2e coverage for the Ledger budgeting module
- B-22 — Batch-match correction fast-follow
- B-23 — Auto-suggest a batch match
- B-24 — Unmatch's `<ConfirmDialog>` uses destructive styling
- B-28 — Delete the unreachable seed API route and dead seed-computation code
- B-36 — Posted Sweep shows a generic "Transfer" label in the fund register
- B-37 — Carry forward last year's causes AND cause line-items
- B-43 — 360px mobile-viewport pass for the proposal form's conditional fields
- B-44 — Unlinked-account PATCH/DELETE returns uniform 403 instead of 404
- B-49 — Named regression test for the deny-by-default email guard (single send)
- B-50 — Playwright spec for the acknowledgment-letter email-send UI flow
- B-51 — Aggregate "no email on file" summary on the acknowledgment-letter selector
- B-52 — `src/lib/members.ts` unit test coverage under the 80% target
- B-54 — `sendEmail()`'s `_bulkMemberSend` option is dead code
- B-55 — `src/lib/club-files-queries.ts` under the 70%+ unit-coverage floor
- B-61 — Newsletter self-service unsubscribe

**Watching / needs info**
- B-56 — Club Files admin list shows "Uploaded {date}" with no uploader name

**Likely obsolete — verify and close**
- B-01 — Ledger user's guide built into the treasury page
- B-05 — Reconciliation matching grid shows no preview of what a bank line is matched to
- B-14 — Board-adoption capture for Ledger budgets
- B-16 — Standalone ledger-category management surface
- B-17 — Cause-level budget detail: cause-tagged line items under a category (Increment A)
- B-19 — Cause-level budget-vs-actual
- B-21 — Dedicated rename endpoint for cause-line budget rows
- B-25 — Enter the approved FY2025 budget
- B-26 — Club/Administrative fund budget: missing rows + missing categories
- B-29 — Budgeting page restructure: Income/Expense sections + inline add/remove
- B-30 — Explicit transaction → budget-line link
- B-31 — Printable budget as a mailed review document
- B-35 — Cause-line label lost when amount then label are committed back-to-back
- B-39 — Adopt-version confirm dialog should render as destructive
- B-40 — State authoritative status on the member-facing governing-document page
- B-42 — Proposal decision email shows a raw status enum instead of a human label
- B-45 — Email the donor acknowledgment letter, instead of only printing it

---

## Now

- [ ] **B-33 — Decouple "supports cause/line-item breakdown" from `countsAsGiving`.**
  (added 2026-07-29, from a books-cleanup review finding #3;
  priority: medium — needs Phase 1) Today `isCauseEligibleCategory` = `expense && countsAsGiving`,
  and `countsAsGiving` *also* drives `/members/impact` giving-by-cause (`bucketGivingByCause`). Chris's
  rule "Rudolph expenses should be for a cause, storage should not" breaks the coupling: Rudolph Run
  event costs need cause/line-item breakdown (multiple vendors) but must **not** count as
  philanthropic giving (that would inflate impact reporting with event-vendor invoices). Add a
  separate cause-breakdown-eligibility concept (e.g. a `supportsBreakdown`/`causeEligible` column, or
  make eligibility an explicit per-category opt-in) independent of `countsAsGiving`, so a non-giving
  expense category can be itemized without appearing in giving reports. Then: Rudolph = eligible +
  not-giving; Storage/Operations = neither (stays lump-sum); Charitable donation out / Grant out /
  Scholarships = both. **Cause value for event costs (DECIDED 2026-07-29, Chris):** reinstate a
  dedicated **"Fundraising / Event Costs"** cause — *not* Community & Civic, which would pollute a
  real beneficiary cause and muddy `/members/impact`. (The taxonomy had dropped "Fundraising event
  costs" via `isValidBudgetCause`; this brings back a clean, purpose-named cause for it.) Sequenced
  with/after B-29 (it only changes *which* categories show "+ add cause", not the restructure
  mechanics) and feeds B-31 (print) + T-25 (category cleanup). Does not block B-29.
  **Priority note (2026-09-05):** Rudolph Run is the club's December event — its costs will start
  hitting the books soon, and without this fix they either can't be itemized by vendor or wrongly
  inflate giving totals. Confirmed still unbuilt: `isCauseEligibleCategory` (`src/lib/ledger.ts:617-619`)
  still takes `countsAsGiving` directly, no separate eligibility column exists, and no "Fundraising /
  Event Costs" cause string exists anywhere in the codebase.

- [ ] **B-34 — Explicit inter-fund transfers (Zeffy pass-through: Club Activity → Foundation).**
  (added 2026-07-29, from the same books-cleanup review, §G6;
  priority: medium — needs Phase 1) Zeffy is wired to the **Club** bank account, so online public
  donations land in the Club's **Activity fund** and must transfer to the **Foundation**. Chris wants
  this modeled **explicitly**, not via `Public donations`/`Misc`. Minimum: dedicated categories
  `Zeffy Donations` (Activity income), `Transfer to Foundation` (Activity expense — collapse the
  existing `Donations to Foundation` into it), `Transfer from Club` (Foundation income, NOT
  `Public donations`). The real design question: whether a transfer is just a **pair of ordinary
  entries in explicit categories** (simplest) or a **recognized "transfer" type** that auto-pairs the
  two legs and is **eliminated from any consolidated/org-wide income roll-up** (the same dollar is
  income in two funds, so a naive total double-counts). Also retroactively re-files the
  "tailtwisting transfer" currently booked as Foundation `Public donations`. Keep the Activity fund
  as a **zeroed-out balanced pass-through** (don't retire it — corrects an earlier §G3 draft). Pairs
  with T-25 (category cleanup) and the "no Miscellaneous" cleanup (§G7).
  **Update 2026-07-29 (v1.51.0):** the transfer/**sweep** *mechanism* is now SHIPPED (account-to-account
  transfer + cross-entity Club Activity→Foundation sweep, deny-by-default directional allow-list,
  pair-aware over-threshold approval — see `docs/work-log/2026-07-29-ledger-account-transfers.md`,
  DECISION-058). **Remaining B-34 sub-scope, still open:** (a) dedicated transfer categories
  (`Zeffy Donations` / `Transfer to Foundation` / `Transfer from Club`) — the shipped sweep defaults the
  Foundation leg to `Public donations` with an override picker, so this is now a category-catalog task,
  not a code task; (b) **eliminating paired transfer legs from any consolidated/org-wide income
  roll-up** (the swept dollar is income in two funds — a naive cross-entity total double-counts; the
  sweep is a new vector for this and it is NOT handled yet); (c) retroactive re-file of the
  tailtwisting transfer.
  **Priority note (2026-09-05):** the remaining scope — a naive consolidated income total
  double-counting swept dollars — is a real correctness risk for any org-wide total pulled during
  Form 990 preparation (filing season, due Nov 15). Worth confirming with the treasurer whether the
  990 workflow ever reads a consolidated (not per-fund) income figure before deciding how urgently to
  fix this specific sub-item vs. the lower-urgency category-catalog cleanup.

- [x] **B-38 — Publish the club constitution and by-laws on the site.** (added 2026-08-08, from Chris;
  **partially answered 2026-08-08** — member-portal placement and format decided, see
  `docs/work-log/2026-08-08-meeting-minutes.md` ADDENDUM 2: folded into the renamed Minutes tile,
  scan hosted as-is. **Resolved 2026-08-09:** members-only, NOT public. Transcription is complete and verified
  (`docs/club-constitution-and-bylaws.md`). The website version becomes AUTHORITATIVE once live.
  **Delivered 2026-08-09** → `docs/work-log/2026-08-09-governance-document-versioning.md` — SHIP WITH
  NOTES. Versioning/diffing/adoption infrastructure is built and verified end-to-end (real
  concurrency, permission, and pending-version adversarial testing); production has **not yet been
  seeded** — `pnpm tsx scripts/seed-governance-document.ts --apply` against `PROD_DATABASE_URL` is a
  deliberate, separate, human action the treasurer still needs to take before any member can read the
  by-laws in the app. See that work-log's Phase 6 for the full note list.)
  Make the club's governing documents available rather than living in someone's files. Open questions
  for whoever picks this up: **public or members-only** — Lions International's own constitution and
  by-laws are public documents and many clubs post theirs openly, but the board may prefer
  members-only; **format** — a rendered page (searchable, linkable by article/section, consistent with
  the site) versus a PDF upload (matches the printed document the board approved and is what gets
  amended); and **amendment history**, since a constitution is amended by vote and the version in
  force on a given date can matter. Pairs naturally with the meeting-minutes work
  (`docs/work-log/2026-08-08-meeting-minutes.md`) — amendments are adopted *in* minutes, so the two
  records reference each other, and both are governance documents with retention expectations.
  **Priority note (2026-09-05):** re-checked as of this reorganization — `docs/work-log/2026-08-09-governance-document-versioning.md:2979`
  still reads "I found no evidence in the repo that `scripts/seed-governance-document.ts --apply` has
  been run against `PROD_DATABASE_URL`," and no later work-log or decision records that it has since
  run. Everything else about this item is done; this is a single command, blocking a fully-built
  feature from having any effect for members. Whoever holds `PROD_DATABASE_URL` access should run it
  (or confirm it's already been run outside this repo's paper trail) — this is the highest
  effort-to-impact item in the whole backlog.

- [ ] **B-47 — Receive Resend delivery webhooks, so a bounce is visible.**
  *(Raised 2026-08-12, from the acknowledgment-letter Phase 1.)*

  **The gap, stated precisely,** because it is easy to think retry already covers it:
  `sendEmail()` retries 3× in-request and, on failure, marks the row `failed` with the error
  and a `next_retry_at`; `/admin/email-queue` re-sends those. That covers **Resend refusing
  the message** — API error, bad key, malformed request. It works and is not the problem.

  A **bounce is a different event**. Resend *accepts* the message, returns success, and the
  row goes to `sent`. Minutes or hours later the recipient's server rejects it: dead address,
  full mailbox, domain gone. That is asynchronous and after the request has ended. Resend
  knows; **this codebase has no webhook receiver anywhere**, so it never hears. Retry cannot
  help, because there was nothing to retry.

  **Why it matters most for acknowledgments.** A donor acknowledgment is a tax document. A
  mistyped address produces a row that says `sent` and a donor with no valid receipt, and
  nothing anywhere contradicts it. The same is true, less severely, of dues reminders,
  reimbursement notifications, and minutes.

  **Shape of the fix:** one public route handler receiving Resend's `email.delivered`,
  `email.bounced` and `email.complained` events (signature-verified), matched back to the
  `email_queue` row, plus a status column and a visible state on `/admin/email-queue`.
  Small — one endpoint, one column — and it improves **every** email in the app rather than
  one feature. Prerequisite for treating an emailed acknowledgment as reliable.
  **Priority note (2026-09-05):** B-45 (email the donor acknowledgment letter) has since
  **shipped** — `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts` exists and is
  tested, so the club is now actually emailing tax receipts in production. That makes this gap
  live risk, not theoretical, right in the middle of Form 990 filing season (due Nov 15) when
  donor-receipt accuracy is under the most scrutiny.

- [x] **B-41 — Carried-forward admin-permission gaps from DECISION-083's 22-area audit, not fixed,
  not blocking.** (added 2026-08-09, Phase 6 of
  `docs/work-log/2026-08-09-governance-document-versioning.md`, priority: idea — needs Phase 1)
  Three items surfaced by the audit and explicitly deferred as out of scope for that pass: (1)
  `/admin/sync-log` shows Google-Group sync history including real member email addresses to any
  `ADMIN_DASHBOARD` holder, with no dedicated permission key — genuinely PII-adjacent, pre-existing,
  unaffected by DECISION-082/083's own fixes. (2) `/api/admin/members/export/route.ts` has the same
  standalone-`REPORTS_EXPORT`-only gating shape the newsletter export had before DECISION-083 fixed
  it (not live-exploitable today since `reports.export` currently implies `admin`/`board_member`
  only, but the same shape). (3) The admin dashboard's "Newsletter Subscribers" stat card links to
  `/admin/newsletter`, which doesn't exist — should point to `/admin/subscriptions`. Logged here so
  they aren't lost, per that decision's own note.
  **Priority note (2026-09-05):** re-checked — sub-item (3) is **already fixed** (`src/app/(dashboard)/admin/page.tsx:177`
  now links to `/admin/subscriptions`); sub-items (1) and (2) are both still exactly as described
  (`sync-log/page.tsx` has no `hasFeature()` call at all, only a bare `auth()` check; the members
  export route still gates on `REPORTS_EXPORT` alone). **Moved to Now** (elevated from the original
  "idea — needs Phase 1" framing): sub-item (1) is not a hypothetical — it's a live, real exposure of
  member email addresses to any admin holding a single unrelated permission, and it's a
  deliberately-allowlisted exception (`NO_PAGE_GATE_ALLOWLIST` in
  `src/lib/admin-page-feature-gates.test.ts` explicitly names `"sync-log"`), not an accidental gap
  the build would catch on its own. The fix is small — one new `FEATURES` key bound to
  `admin`/`board_member`, remove the allowlist entry — and shouldn't wait for a routine security
  review to notice it again.
  **Closed 2026-09-05 — `docs/work-log/2026-09-05-b41-sync-log-permission.md` (bug-fix variant,
  Phases 1–3 skipped, root cause and rationale documented in the work-log).** Sub-item (1): new
  `FEATURES.SYNC_LOG_VIEW` (`sync_log.view`) bound to `admin`/`board_member`
  (`drizzle/migrations/0100_sync_log_view_permission.sql`); `/admin/sync-log`'s `ADMIN_NAVIGATION`
  item now declares it and the page gates on it; removed from
  `NO_PAGE_GATE_ALLOWLIST`. Sub-item (2): `/api/admin/members/export/route.ts` now gates on
  `hasAnyFeature([MEMBERS_EDIT, REPORTS_EXPORT])`, mirroring DECISION-083's newsletter-export fix
  exactly. Sub-item (3): confirmed already fixed pre-existing, no code change.

- [ ] **B-58 — Choose and ship the new homepage hero tagline.** *(Raised 2026-09-04, site-review
  Batch 5 — flagged for the immediate future.)* The current line ("Helping our community thrive
  through service and care") is generic. Three grounded replacements are drafted in
  `docs/work-log/2026-09-04-site-review-fixes.md` (Batch 5, item 7):
  1. "From the Rudolph Run to eyeglass recycling bins across town, we turn small acts into real
     community impact."
  2. "Scholarships for local students. Eyeglasses for neighbors in need. One Lions Club, eight
     causes, since 1928."
  3. "Fun runs, food drives, and eyeglass drop-offs — see how Westerville Lions shows up for
     this community all year long."
  The club picks one (or supplies BioBlitz copy — that program couldn't be verified in the repo
  and was deliberately left out). One-line change in `src/app/page.tsx` once chosen.

- [ ] **B-60 — Trust-content follow-ups from the site review.** *(Raised 2026-09-04/05.)*
  1. Club review of the /privacy page text — it shipped Claude-drafted (flagged in the
     2026-09-04-site-review-fixes work-log) and should be read by an officer.
  2. Confirm the Foundation's legal name against the IRS determination letter:
     `ledger_entities` says "Westerville Lions Foundation"; every donor-facing letter and the
     new /donate copy say "Westerville Lions Club Foundation". Fix whichever is wrong.
  3. Verify the mobile audit's "13×13px consent checkbox" on /join on a real device — the
     element doesn't exist in the codebase; likely a stale finding, but confirm and close.
  **Priority note (2026-09-05):** item 2 (legal-name mismatch) is worth resolving before Form 990
  filing season closes out, since the Foundation's legal name should be unambiguous across donor
  receipts and any filing paperwork.

- [ ] **B-62 — Add www.westervillelions.org in the Vercel dashboard.** *(Raised 2026-09-04.)*
  Not a code change. The `www` DNS record points at Vercel but no cert covers it, so
  `https://www.westervillelions.org` shows a browser security error. Add the domain to the
  Vercel project (issues a cert and 308s to the apex). Five minutes, needs dashboard access.

---

## Soon

- [ ] **B-13 — Centralize the ledger payment-method list + labels.**
  (added 2026-07-22, priority: should-do) The expense/ledger payment-method set
  (`check/cash/zeffy/debit_card/bill_pay/other`) is duplicated across three API validators
  (`transactions`, `transactions/[id]`, reconciliation `create-from-bank-line`) and two
  `METHOD_LABELS` dropdown maps — adding "Bill Pay" (2026-07-22) meant editing six places, and the
  reimbursement pay set drifted to a smaller `check/cash/other` list. Hoist one shared const +
  label map into `src/lib/` and import everywhere. While there: the register/fund-detail cell
  (`[fundSlug]/page.tsx` ~L455) renders the raw stored value with CSS `capitalize`, so `debit_card`
  and `bill_pay` show as "Debit_card" / "Bill_pay" — route it through the shared label map too.
  **Priority note (2026-09-05):** re-checked — still duplicated (`transaction-form.tsx`,
  `reconciliation-create-from-bank-line-dialog.tsx`, `pay-reimbursement-dialog.tsx`, `dues.ts`, and
  others still hold their own copies; no shared `PAYMENT_METHODS`/`METHOD_LABELS` constant exists).
  CLAUDE.md's own "Duplication Is a Review Finding" rule names exactly this shape of problem.

- [ ] **B-27 — Increment 2: soft-delete/restore-until-finalize for budget
  lines.**
  (added 2026-07-28, deferred from `docs/work-log/2026-07-28-budgeting-page-redesign.md`
  Phase 1's recommended two-increment split; priority: medium) The treasurer's
  original request item #4 — removing a budget line marks it "deleted" with a
  visible restore toggle instead of immediately hard-deleting it, and the
  deletion only takes effect when the budget is finalized (approve & lock).
  Phase 1 spec'd this as a persisted `pending_delete_at` nullable timestamp on
  `ledger_budgets` (schema.ts:772), excluded from the live balance calc
  immediately, committed (rows hard-deleted) in the same transaction as the
  finalize/lock write, gated identically to today's `showRemoveControl`
  (`canManage && !locked`). Cause-line-grain removal (`ledgerBudgetLines`,
  `BudgetCauseEditor`) stays hard-delete — out of scope, unchanged. This is a
  genuine new persisted state machine interacting with the existing lock
  invariant (`assertBudgetUnlocked`) and needs its own architect + tech-lead
  pass (Phase 2/3), not a continuation of Increment 1's accelerated pipeline.
  See Phase 1's "Gaps"/"Open Questions" sections in that work-log for the
  resolved design questions (implicit-restore-on-edit, confirm-dialog removal,
  balance-calc exclusion) to carry into Phase 3.

- [ ] **B-32 — Post-changes budget analysis pass.**
  (added 2026-07-29, priority: medium — process) Once B-29/B-30/B-31 and the
  star/notes feature land, Chris wants a **round of analysis** over the budgeting
  surface end-to-end: does budget → transaction → report trace cleanly, are the new
  add/remove flows actually meeting-usable, did the explicit link improve
  budget-vs-actual, is the mailed PDF review-ready. Run this as an analyst-led review
  (Phase 6-style shipped-vs-intent across the whole program, not one feature), and
  feed anything it surfaces back here as new B-items.
  **Priority note (2026-09-05):** B-29, B-30, B-31, and the star/notes feature have all since
  shipped (see the "Likely obsolete" tier below for evidence) — this analysis pass is now ripe to
  run and shouldn't wait much longer, since the context for what changed will only get staler.

- [ ] **B-46 — Consolidate the copy-pasted scaffolding around every email send.**
  *(Raised 2026-08-12 by the treasurer, after the guardrail incident.)*

  Not the send sites themselves: ~18 features legitimately send different messages. It is the
  boilerplate repeated around each one, counted 2026-08-12:

  | Duplicated | Copies |
  |---|---|
  | `process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"` | 12 |
  | Hand-rolled HTML escaper (3 identical one-liners, 3 multi-line variants) | 6 |
  | `NEXTAUTH_URL` fallback for building links into emails | 8 |

  **Why it matters beyond tidiness.** A rule that lives in twelve places is twelve places to
  get it wrong, and no place to change it. The 2026-08-12 incident turned on exactly this
  class of problem: behaviour that should have been decided once, centrally, was instead
  scattered and therefore unreviewable. The escaper is worse than untidy — one copy was
  missing entirely from the proposal emails until it was caught in review, which meant
  member-supplied text going unescaped into a mail sent to the whole board.

  **Shape of the fix:** a small `src/lib/email-compose.ts` owning the from-address, the app
  URL, and escaping, so a send site supplies only its recipient, subject and body. Mechanical
  and well covered by tests, but touches ~18 files, so it wants its own pass rather than being
  smuggled into a feature.

- [ ] **B-48 — Route-level automated test for the treasury CC rule at the five existing ledger
  send sites.** *(Raised 2026-08-12, Phase 6 of Dues Reminder Emails.)*

  The treasury CC rule (`resolveTreasurer()` CC'd onto every treasury email) is applied
  correctly at all five existing send sites — three in
  `src/app/api/admin/ledger/reimbursements/[id]/route.ts` (approved/rejected/paid) and two in
  `src/app/api/admin/ledger/transactions/route.ts` (the `LEDGER_APPROVE`-approver-loop
  notifications) — confirmed by direct code review during Phase 6. But that review is the only
  coverage: `resolveTreasurer()` itself is unit-tested, and the dues-reminder path is
  unit-tested, but no test exercises the CC behavior at these five specific call sites. QA
  deliberately declined to live-trigger them, correctly, given that doing exactly that mid-build
  is what mailed 16 real board members (see the `ff613f1` incident). A future refactor of the
  ledger routes could silently drop the CC and nothing would fail red.

  **Shape of the fix:** mock `resolveTreasurer()` and `sendEmail()` the way
  `dues-reminders.test.ts` mocks its own dependencies (no live transaction, no live send) and
  assert the `cc` field is present when `resolveTreasurer()` resolves and absent — not thrown —
  when it doesn't. `src/app/api/admin/ledger/reimbursements/[id]/route.ts` has no `route.test.ts`
  at all today; this is also the first coverage of that file.
  **Priority note (2026-09-05):** re-confirmed still true — no `route.test.ts` exists for
  `reimbursements/[id]/route.ts`. Treasurer-facing email correctness during 990 filing season is
  a reasonable nudge to do this one sooner rather than later.

- [ ] **B-53 — Six e2e specs are red on `main` outside the feature that surfaced them (dev-DB
  fixture/date drift, not a code regression).**
  *(Raised 2026-09-03, Phase 6 of Social Media Post Requests; QA's Phase 5 full
  `pnpm test:e2e` run.)*

  A full-suite run (145 tests, 24 spec files) showed 7 failures — all in
  `budget-star-notes.spec.ts`, `budgeting-restructure.spec.ts`, `cancel-occurrence.spec.ts`,
  `ledger-search.spec.ts`, `prior-year-cause-line-reconcile.spec.ts`, and
  `transaction-budget-line-link.spec.ts` — none referencing `social_requests` or any file
  the Social Media Post Requests feature touched. QA's read of the failure messages points to
  dev-DB fixture/category drift (a missing "Community & Civic" budget category, a
  cancelled-occurrence error-string mismatch, a stale fiscal-year-filter assumption) rather
  than a product regression. `cancel-occurrence.spec.ts` specifically failed on the same
  hardcoded-date-rot class the 2026-06-24 test-coverage review already fixed once
  (`CANCEL_DATE`/`SIGNUP_BLOCKED_DATE` advancing past "today" again) — the earlier fix was a
  one-time date bump, not a structural fix, so it has now rotted a second time. A red
  full-suite run is a real signal worth closing even when the change under review is
  unrelated and green.

  **Shape of the fix:** re-anchor `cancel-occurrence.spec.ts`'s hardcoded dates relative to
  the current date (or compute them at runtime) so this class of rot can't recur; refresh or
  seed the dev DB's "Community & Civic" budget category fixture; re-run the other four specs
  individually to isolate whether each is a fixture gap or an actual assertion drift, and fix
  or re-anchor each at the next 7-day test-coverage review.

  **Update (2026-09-04, pre-push full-suite re-run):** re-ran the full suite a few hours after
  QA's pass, immediately before pushing this feature — 8 failures this time, same six spec
  files plus a new one, `recurring-signup-rollup.spec.ts` ("admin events list shows sum of
  RSVPs across two occurrences"). Consistent with the drift theory above (the fixture state
  keeps moving under a shared dev DB), not a regression from this push — the new
  `social-requests-flow.spec.ts` suite was isolated and re-run separately: 8/8 green. Raising
  the failure count and file list here rather than opening a duplicate item.

  **Update (2026-09-04, QA Phase 5 of Event Announcement Emails):** full-suite re-run showed 9
  failures — `cancel-occurrence.spec.ts` (2, confirmed via isolated re-run to be the same
  hardcoded-date-rot class already named above: `CANCEL_DATE`/`SIGNUP_BLOCKED_DATE` have drifted
  into the past again), plus the same six ledger/budgeting/rollup files already listed here
  (`budget-star-notes`, `budgeting-restructure`, `ledger-search`,
  `prior-year-cause-line-reconcile`, `recurring-signup-rollup`, `transaction-budget-line-link`) —
  no new spec files, picture unchanged from the pre-push update above. One additional failure,
  `write-in-signups.spec.ts`, appeared only in the full-parallel run and passed clean in
  isolation — concurrent-worker interference (`fullyParallel: true`, shared dev DB), not a fixture
  regression, and not added to the file list above since it isn't reproducible standalone. None of
  the 9 reference `event_announcements`, `email.ts`, or any file Event Announcement Emails
  touched. Confirms this item is still an accurate, current picture as of 2026-09-04 — no scope
  change needed.
  **Priority note (2026-09-05):** this has now been re-confirmed stale across at least three
  separate feature passes without being fixed — the CI signal on the whole suite degrades a
  little further each time. Worth fixing at the very next 7-day test-coverage review rather than
  deferring again.

- [ ] **B-57 — Receipt-proxy download routes carry the same buffered-response exposure Club
  Files' download route was built to avoid.**
  *(Raised 2026-09-04, Phase 2/3 of Club Files; flagged again by analyst at Phase 6 for the
  30-day code review.)*

  Club Files' download route (`GET /api/club-files/[id]/download`) builds a genuinely streamed
  `Response` (`ReadableStream`, 256KB slices) specifically because Vercel Functions cap a
  *buffered* response body at 4.5MB — a single large `Uint8Array` body does not bypass that cap,
  only a true stream does. The existing `ledger_receipt_files` download routes still use the
  older `receiptBytesToBodyInit()` buffered-`Uint8Array`-as-body pattern at their 10MB cap, which
  is close enough to the 4.5MB ceiling to be a real latent risk on a large receipt image, not
  just a theoretical one. **Shape of the fix:** port the receipt-proxy download route(s) to the
  same `ReadableStream` pattern Club Files now uses (`src/app/api/club-files/[id]/download/
  route.ts` is the reference implementation) — no new dependency, contained change. Owner: the
  30-day code review (architect) per CLAUDE.md's cadence, or api-developer as a standalone fix
  whenever the receipt-proxy routes are next touched.
  **Priority note (2026-09-05):** ranked by real-world likelihood, not the theoretical
  worst-case framing above — a receipt photo landing close enough to 4.5MB to actually trip this
  requires a fairly large phone photo upload, which happens but isn't the common case. Real and
  worth fixing at the next code review pass; not urgent enough to jump to Now.

- [ ] **B-59 — Event type field + public calendar badges.** *(Raised 2026-09-04, site review.)*
  The public calendar lists ~14 internal General/Activities meetings alongside genuine community
  events with no distinction — it reads "closed club" on the site's main recruiting surface. The
  `events` table has no type/category field, so this needs schema (database-admin) + UI
  (ux-developer): a `kind` or similar column, badges ("Open to everyone" vs "Club meeting —
  visitors welcome"), and optionally a default public-view filter. Do not infer type from titles.
  **Priority note (2026-09-05):** public-site trust/conversion follow-up in the same family as
  B-58/B-60, which shipped in v1.75.0 — confirmed still fully unbuilt (`events` table has no
  `kind`/`type`/`category` column in `schema.ts`).

---

## Later

- [ ] **B-02 — No Playwright auth fixture for a signed-in member (only admin).**
  (added 2026-07-21, priority: nice-to-have) `e2e/helpers/auth.ts` only has
  `signInAsAdmin()`, and the e2e admin account (`E2E_ADMIN_EMAIL`) has no
  linked `member_id` locally — so any e2e spec that needs to exercise a
  member-portal page gated on "must have a linked member" (e.g.
  `/members/impact`) cannot run automated without manually linking/unlinking
  a member row first. Surfaced during Phase 5/6 of
  `2026-07-21-impact-cause-drilldown.md` (qa deferred the browser
  click-through for exactly this reason; analyst closed it manually via a
  temporary dev-DB linkage + revert rather than fixing the fixture). Fix:
  add a dedicated e2e member fixture (a `signInAsMember()` helper backed by
  its own permanently-linked test member row, separate from the admin
  account) so future member-portal features get real Playwright coverage
  instead of a manual click-through every time.

- [ ] **B-03 — No e2e fixture for an authenticated user lacking a specific
  admin sub-permission (only a full-Admin account exists).** (added
  2026-07-21, priority: nice-to-have) `e2e/helpers/auth.ts`'s only signed-in
  fixture (`signInAsAdmin()`) is bound to every `FEATURES.*` key via the
  `admin` role. There is no fixture for "authenticated, can reach
  `/admin`, but lacks one specific sub-permission" — so any admin sub-page's
  `hasFeature()` redirect (e.g. `/admin/security`'s redirect to `/admin` for
  a session without `admin.security_view`) can only be verified by reading
  the page's source, never by driving a real denied request through the
  browser. Surfaced during Phase 6 of
  `2026-07-21-failed-login-visibility.md` (qa verified the gate via code
  read, not a live test, for exactly this reason). Related to B-02 (which
  covers the member-portal fixture gap) but distinct: this is about
  *admin-side* permission variance, not member-linkage. Fix: add a second
  admin-ish e2e test account/role bound to a strict subset of `admin.*`
  features (or a helper that temporarily revokes one feature from the e2e
  admin account and restores it after), so permission-gate redirects on
  admin sub-pages get real browser coverage instead of a standing code-read
  exception.
  Also surfaced during Phase 6 of `2026-07-21-transaction-receipts.md`: the
  receipt-waiver control's `LEDGER_MANAGE`-vs-`LEDGER_VIEW` distinction (waive
  button hidden client-side, and the waive/un-waive routes' server-side
  `hasFeature(LEDGER_MANAGE)` gate) was verified live only against the
  all-permissions e2e admin; a `LEDGER_VIEW`-only denied request was confirmed
  by reading the route source, not by driving a live request from a
  restricted session. Same root gap as above.

- [ ] **B-04 — Receipt/reimbursement upload routes' oversized-file error
  message is unreachable in practice.** (added 2026-07-21, priority:
  nice-to-have) Both `POST /api/admin/ledger/transactions/upload` and
  `POST /api/members/reimbursements/upload` intend to return
  `"File exceeds the 10 MB size limit"` for a file over the 10MB cap, but
  `request.formData()` throws first for bodies at/above roughly that size, so
  the response falls back to the routes' generic `try/catch`
  `"Invalid multipart form data"` 400 instead — confirmed via `curl`-based
  binary search (9MB parses and hits the real size check; 10MB does not) in
  QA's Phase 5 pass of `2026-07-21-transaction-receipts.md`. Not a crash or a
  500 — both routes already return a human-readable 400 either way — just a
  copy-precision gap: the specific size-limit message never actually shows.
  Fix (scope TBD in Phase 1): likely an explicit body-size limit configured
  upstream of `request.formData()` (e.g., checking `Content-Length` before
  parsing, or a route-level body-size config) so oversized uploads are
  rejected with the intended message before multipart parsing begins. Same
  fix should apply to both upload routes since they share the pattern.

- [ ] **B-06 — No repair path for a mis-uploaded reconciliation-session
  CSV.** (added 2026-07-21, priority: nice-to-have) Surfaced during Phase 6 of
  `2026-07-21-ledger-reconciliation-sessions.md` (bank-reconciliation inc2),
  named in that increment's own Phase 3 design doc as a real, if narrow, gap
  rather than an oversight. inc2 enforces one CSV upload per session
  (`uploadedAt` one-shot gate, intentional — the primary duplicate-upload
  defense) with no replace/re-upload affordance. If a treasurer uploads the
  wrong file (wrong account's export, wrong period, or a corrupted file that
  still happens to pass header validation), the only recourse in the current
  UI is to abandon that session — there is no delete-session or
  clear-and-re-upload action anywhere in the product. A `DELETE
  /api/admin/ledger/reconciliation/sessions/[sessionId]` route (blocked once
  any match exists, mirroring the guard patterns already used elsewhere in
  this feature) plus a matching UI affordance would close this. Deferred
  intentionally at design time pending real-world pain; worth revisiting once
  the treasurer works a few live months and this either comes up or doesn't.

- [ ] **B-07 — Print support for the Treasury User's Guide.** (added 2026-07-21, priority:
  nice-to-have) The guide page hides its own breadcrumb/TOC when printing, but the shared admin
  sidebar/layout chrome still prints — a `print:hidden` pass on the shared admin layout would let
  the treasurer print the guide cleanly as a handoff document. Small PR touching the shared
  layout; flagged during `2026-07-21-treasury-users-guide.md` Phase 6 (footprint restriction kept
  it out of the feature). Related: the same Phase 6 recommended the next 7-day test-coverage
  review add a seeded narrow-permission test account (e.g., LEDGER_APPROVE-only) — same root gap
  as B-03; noted there rather than duplicated.

- [ ] **B-08 — Member reimbursement upload has no HEIC support at all.**
  (added 2026-07-21, priority: nice-to-have) Flagged during Phase 1 of
  `docs/work-log/2026-07-21-receipt-heic-wasm-fallback.md` and confirmed
  out of scope for that increment. `src/components/members/reimbursement-form.tsx`
  (`accept=".pdf,.jpg,.jpeg,.png"`, no HEIC in the accept list, no
  client-side resize/decode step) is a fully separate implementation from
  the admin Ledger's `receipt-file-input.tsx` — it doesn't share code, so
  the WASM HEIC decode fallback landing there does nothing for members. A
  member picking a `.heic` file today is either blocked by the OS picker's
  extension filter or uploads raw HEIC bytes the server's magic-bytes check
  rejects. Lower urgency than the admin flow: members mostly upload from
  the same phone that took the photo, and iOS Safari's picker already
  re-encodes to JPEG in that case. Fix (scope TBD in Phase 1): likely reuse
  the same native-decode-then-WASM-fallback approach and `heic-decode.ts`
  helper this increment introduces, once there's a resize pipeline on this
  surface to plug it into (there isn't one today).

- [ ] **B-09 — Member profile picture upload has no HEIC-specific handling.**
  (added 2026-07-21, priority: nice-to-have) Same source as B-08.
  `src/components/members/profile-picture-uploader.tsx` (`accept="image/*"`)
  has no HEIC-specific handling and wasn't touched by the receipt HEIC WASM
  fallback work. Confirmed out of scope for that increment; flagging so the
  gap has a record rather than being silently left. Lower priority than
  B-08 — profile pictures are a smaller, more discretionary upload than a
  reimbursement receipt.

- [ ] **B-10 — CI-repeatable fixture for modern iPhone HEIC (10-bit `heix` + HDR gain-map `tmap`).**
  (added 2026-07-21, priority: should-do) The `2026-07-21-heic-modern-iphone-decode.md` defect —
  heic2any's stale libheif rejecting modern iPhone photos — was only catchable with a real 48 MP
  `heix`/`tmap` file, and the only such file available is the user's personal photo, which exists
  on one machine and must never be committed. Source or generate a small non-personal fixture in
  that format (e.g., a downscaled photo taken specifically for this purpose, or ffmpeg/libheif-cli
  generated 10-bit output) and add it to `e2e/fixtures/heic/` with a decode e2e case, so a future
  decoder regression on modern files fails in CI instead of in production.

- [ ] **B-11 — Live HTTP round-trip test for the acknowledgment-letter view route's byte guard.**
  (added 2026-07-21, priority: nice-to-have) In `2026-07-21-receipt-storage-in-database.md`, the
  `receiptBytesToBodyInit()` fix on `acknowledgments/[id]/letter` GET was verified only by
  code-identity argument (same two-line change already proven live on two other routes), not a
  live authenticated HTTP round-trip — it needs an ack-gift + letter-upload fixture. Low risk;
  close it when the ack-acknowledgment e2e fixtures exist.

- [ ] **B-12 — CI tripwire for "storage adapter silently wrong in production."**
  (added 2026-07-21, priority: should-do) The Vercel-Blob-token bug (and its DB replacement) both
  hinge on `getReceiptStorage()` picking the right adapter by environment. There's no automated
  guard that a production-mode build actually round-trips a receipt through the intended backend —
  the class of bug that reached production twice now (missing token → read-only FS write). Consider
  a smoke test that boots the app under `NODE_ENV=production` against an ephemeral DB and asserts an
  upload→view→delete cycle, so an adapter-selection regression fails in CI, not in production.

- [ ] **B-15 — Consolidated entity-level budget-vs-actual rollup + mid-year YTD pacing.**
  (added 2026-07-27, priority: nice-to-have) Flagged in Phase 1 of
  `docs/work-log/2026-07-27-ledger-guided-budgeting.md` and reconfirmed
  untouched at Phase 6: `getEntityReport()` (`src/lib/ledger-queries.ts`,
  currently hardcodes `budgetCents: null` at the per-category-rollup level)
  has no budget story at the Club-wide or Foundation-wide level — a
  treasurer can see per-fund budget-vs-actual today (`getFundReport()`) but
  not "does the whole Club balance" or "does the whole Foundation balance,"
  which is the actual Lions-Way self-balancing unit (Administrative+Activity
  pair; Charitable+Scholarship pair). Also bundles the separately-deferred
  mid-year YTD/prorated budget pacing (targets are annual-only today).
  Recommend a small new aggregation on top of already-fetched fund reports
  rather than a rebuild of `getEntityReport` (per architect's Phase 2 note
  on the guided-budgeting increment).

- [ ] **B-18 — Structured cause on transactions & reimbursements (promote free-text `beneficiaryCause` to a controlled type).**
  (added 2026-07-27, priority: nice-to-have — split out of B-17 Increment A's Phase 1;
  **reshaped by B-30's Phase 1 (2026-07-30)** — kept, but no longer a budget-vs-actual
  prerequisite: `/members/impact`'s giving-by-cause bucketing reads `beneficiaryCause`
  directly and stays independent of B-30's explicit link, so B-18's remaining value is
  narrower — un-linked transactions' fallback-match quality and the impact dashboard's
  buckets. See `docs/work-log/2026-07-30-transaction-budget-line-link.md`.)
  Today `ledgerTransactions.beneficiaryCause` and `ledgerReimbursements.beneficiaryCause`
  are free `text` with no enum/FK; cause is only ever *derived* at Quicken-import time
  by `deriveCause` (`scripts/import-quicken-ledger.ts`), a controlled ~9-value taxonomy
  that lives nowhere as a shared app type. Promote that taxonomy to a shared app-level
  constant, add a constrained cause picker to the transaction and reimbursement forms,
  and backfill existing free-text values. Independently valuable: it also tightens the
  `/members/impact` "giving by cause" buckets (which currently collapse anything
  null/blank to "Other community support"). **Prerequisite for B-19.** Note the taxonomy
  warts reconciled in B-17 Increment A (drop "Fundraising event costs"; fold "Scholarships"
  into "Youth & Education") and the open question of whether Scholarship Fund
  (`ledgerFunds.kind='scholarship'`) expenses get cause-tagged going forward.
  **Priority note (2026-09-05):** B-19 (its stated prerequisite target) has since shipped via
  B-30's superseding approach instead — see the obsolete tier. B-18's remaining value is
  real but narrower than originally scoped, as its own text already says.

- [ ] **B-20 — Playwright e2e coverage for the Ledger budgeting module (currently zero specs).**
  (added 2026-07-27, priority: nice-to-have — surfaced in `docs/work-log/2026-07-27-ledger-cause-budget-lines.md`
  Phase 5/6; widened 2026-07-28 per `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`
  Phase 6) qa's Phase 5 passes on B-17 Increment A and on the Labeled Cause Lines
  follow-up both had no browser-automation tool available and could not reach
  client-only flows. Combined list still needing Playwright coverage:
  navigate-away-without-committing a breakdown pre-fill, `ConfirmDialog` gating on
  cause-line remove, guided-seed confirm-dialogs/toast copy, 360px row stacking,
  **grouped-by-cause display (cause header → per-cause subtotal → nested labeled
  lines → category total)**, **`<datalist>` label autocomplete (entity-scoped,
  cross-fund)**, **in-place label edit with no visible row flicker (independent
  amount/label dirty-tracking)**, **locked-budget UI disabling + the two distinct
  toast copies (`locked` vs `duplicate_cause_label`)**, and **the "+ Add line"
  cause `<select>` offering an already-used cause without exclusion**. (The old
  "live dropdown rename of a committed cause line" item is dropped — that flow no
  longer exists; see B-21.) `e2e/` today covers events/donate/admin-security/
  receipts/signups — none of it touches Ledger/budgeting at all. Add Playwright
  specs for all of the above (and the existing `BudgetEditor`/guided-budgeting
  flows they sit alongside) during the next 7-day test-coverage review.
  **Priority note (2026-09-05):** the premise has partly changed since this was written —
  `e2e/budget-star-notes.spec.ts`, `e2e/budgeting-restructure.spec.ts`,
  `e2e/prior-year-cause-line-reconcile.spec.ts`, and `e2e/transaction-budget-line-link.spec.ts`
  now exist, so "currently zero specs" is no longer accurate. Whether the *specific* scenarios
  named above (grouped-by-cause display, datalist autocomplete, dirty-tracking, etc.) are
  actually covered by those newer specs wasn't verified line-by-line in this pass — re-scope
  against what those specs actually assert before assuming either "fully covered" or "still all
  missing."

- [ ] **B-22 — Batch-match correction fast-follow: allow adding to an
  already-matched-but-still-short line, instead of unmatch-to-zero-then-re-pick.**
  (added 2026-07-28, priority: nice-to-have) Surfaced during Phase 3/6 of
  `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md` (DECISION-051 item
  4). Today, once a bank line has any match at all, `POST .../match` 409s
  unconditionally (architect §4's "matched once, as a complete set" rule) —
  so fixing one wrong pick inside a 6-row batch means unmatching every
  remaining row down to zero and re-selecting the corrected full set, not
  adding the one missing transaction back in isolation. Accepted as bounded
  v1 friction (Phase 1's binding per-row-only-unmatch answer), but named as a
  reversible fast-follow if real usage makes it painful: relax the
  bank-line-already-matched gate in `match/route.ts` from "reject whenever
  any match exists" to "reject only when the line is already balanced" (sum
  of existing matches equals the bank line amount), so a partially-unmatched,
  still-short line can accept an additional POST instead of requiring a full
  re-pick.

- [ ] **B-23 — Auto-suggest a batch match (sum a week of same-payment-method
  rows against a deposit automatically).**
  (added 2026-07-28, priority: nice-to-have) Named out of scope in Phase 1 of
  `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md` and in the
  Bank-Reconciliation guide's own "Coming soon" callout (`reconciliation-section.tsx`
  §10) — an existing schema-index comment (`ix_ledger_bank_lines_check_slip`,
  "shape inc3's auto-match will need") already anticipated this as a later
  increment. v1 (shipped 2026-07-28) is manual multi-select only; this item
  is the auto-clustering/auto-suggestion layer on top — propose a likely set
  of candidate rows (e.g. same payment method, adjacent dates, summing near
  the bank line's amount) instead of requiring the treasurer to hand-pick
  every row.

- [ ] **B-24 — Unmatch's `<ConfirmDialog>` uses `destructive` (red) styling
  despite being a fully reversible action.**
  (added 2026-07-21, carried forward from B-05 2026-07-28, priority:
  nice-to-have) Originally noted alongside B-05 during Phase 6 of
  `2026-07-21-ledger-reconciliation-sessions.md`; B-05 itself was resolved by
  `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md` but this cosmetic
  nit was out of scope for that pass and remains open. Unmatch (both the
  legacy single-match button and the new per-row batch Unmatch action in
  `reconciliation-matching-grid.tsx`) is a low-stakes, one-click-reversible
  action — re-matching costs nothing — yet its `<ConfirmDialog>` renders with
  `destructive` (red) styling, which overstates the risk. Recommend softening
  to the non-destructive style next time this component is touched.

- [ ] **B-28 — Delete the unreachable seed API route and dead seed-computation
  code.**
  (added 2026-07-28, priority: nice-to-have — flagged in Phase 4/6 of
  `docs/work-log/2026-07-28-budgeting-page-redesign.md`) Increment 1 removed
  every UI path to "seed from last year" (both `ProposedLinesList` and the
  seed action itself, per the treasurer's Human Answer), but left
  `POST /api/admin/ledger/budgets/seed` and `computeSeedFromPriorYear`/
  `SeedProposedLine` in `ledger-queries.ts`/`ledger.ts` in place — unreachable
  from the UI, harmless to the build, but dead code. Delete the route file and
  the now-unused exports once confirmed nothing else imports them (grep first
  — `guided-budget-setup.tsx` no longer references either). Also check
  `/admin/ledger/guide#budgeting` (the in-app Treasury User's Guide) for stale
  "seed from last year" instructional copy describing the removed flow.

- [ ] **B-36 — Posted Sweep shows a generic "Transfer" label in the fund register.**
  (added 2026-07-29, found in Phase 6 of the account-transfers feature; priority: low — cosmetic, no
  data/amount/category/reconciliation impact) In `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`
  the per-row partner lookup is entity-scoped, so a **posted** cross-entity Sweep's Club-side leg can't
  resolve its Foundation partner and falls back to a generic "Transfer" label instead of "Sweep." Fix:
  widen the partner lookup to be entity-unscoped (mirror `getPendingApprovals`, which already resolves
  cross-entity partners). Confirmed cosmetic by code trace in the Phase 6 review.
  **Priority note (2026-09-05):** re-checked, no clear evidence in `[fundSlug]/page.tsx` that the
  partner lookup has been widened to entity-unscoped yet — treat as still open; low priority per its
  own text (cosmetic, no functional impact).

- [ ] **B-37 — Carry forward last year's causes AND cause line-items as a budget starting point.**
  (added 2026-07-30, from Chris; Phase 1 done 2026-07-30 →
  `docs/work-log/2026-07-30-prior-year-line-items.md`, READY WITH NOTES) When building a new fiscal
  year's budget, pre-populate not just the categories but the prior year's **cause breakdowns and
  their line items** (labels + amounts) as an editable starting point. **Scope correction from Phase
  1:** prior-budget-per-line and prior-actuals-per-line (the reference *display*) are NOT part of this
  — they already shipped in v1.45.0 (`2026-07-28-causeline-prior-year-reference.md`); B-37 is
  carry-forward only. Phase 1 also found (a) a real, confirmed **bug** where a newly-added cause line
  never picks up its prior reference values in the same browser session even when a match exists (see
  work-log "Bug Finding" — routed as a loop-back to Phase 4 of the 2026-07-28 work-log, recommended
  fixed before B-37), and (b) a confirmed real label/party drift case ("Pilot Dogs" vs "Pilot Dogs,
  Inc.") breaking today's exact-match Prior Actual — tracked separately, not a B-30 prerequisite.
  Builds on the existing `budgets/seed` category-grain machinery and the B-17/DECISION-047/048
  cause-line model, but needs a **new** seed function at `(cause, label)` grain — neither existing
  seed helper (`deriveSeedLinesForFund` nor `computeCauseSeedForCategory`/`deriveCauseSeedLines`)
  carries forward individual labeled line items today. Pairs with B-31 (printable budget) and the
  guided-budget-setup flow.
  **Priority note (2026-09-05):** Phase 1 only — no Phase 2/3/4 work exists for this item
  (`docs/work-log/2026-07-30-prior-year-line-items.md` ends at Phase 1's open questions). Genuinely
  useful but tied to the next annual budget-building cycle, not urgent right now.

- [ ] **B-43 — 360px mobile-viewport pass never run for the proposal form's conditional
  fields.** (added 2026-08-09, Phase 6 of `docs/work-log/2026-08-09-project-proposal-form.md`,
  priority: should-do — the club's members are mostly older adults and already use the
  reimbursement flow from phones) ux-developer flagged this as unverified beyond
  "correct by construction," and qa explicitly did not reach it this pass. A code read
  in Phase 6 found no multi-column layout in the interactive form itself (the one
  `sm:grid-cols-2` block is the read-only proposer-info summary, which collapses to one
  column below 640px) and full-width inputs/stacked radios throughout — low risk, but
  the conditional-field reveal (cost field under the money radio, income field under the
  fundraising type) is exactly the kind of thing that can silently break at narrow
  widths and was never actually looked at on a real 360px viewport. Recommend a real pass
  before or shortly after the club starts using this in earnest.
  **Priority note (2026-09-05):** the 2026-09-04 site-review mobile audit (Batch 4) did a broad
  390×844 pass across the public site but did not specifically name the proposal form (a
  member-portal surface) among the pages it audited — this item is likely still un-addressed.

- [ ] **B-44 — Unlinked-account PATCH/DELETE on `/api/members/proposals/[id]` returns a
  uniform 403 instead of the id-specific 404.** (added 2026-08-09, Phase 6 of
  `docs/work-log/2026-08-09-project-proposal-form.md`, priority: nice-to-have — low
  severity, rare account state) Flagged by qa in Phase 5 as a non-blocking defect: the
  member routes gate on `session.user.memberId` before the ownership check, so an account
  whose member link was cleared *after* it already owned proposals gets a uniform 403 on
  every request, real id or fake, rather than reaching the id-specific 404. Not an
  enumeration leak (response doesn't vary by target id for an unlinked account), just a
  narrow edge case Phase 3's Edge Cases section didn't cover. Confirmed via code read,
  not re-tested independently in Phase 6.

- [ ] **B-49 — Named regression test confirming the deny-by-default email guard blocks a
  single, non-bulk `sendEmail()` call, not just `sendBulkMemberEmail()`.**
  *(Raised 2026-08-12, Phase 6 of Dues Reminder Emails.)*

  `ff613f1` moved the non-production guard to deny-by-default at the `sendEmail()` chokepoint
  itself, which is the reason the guard now covers every call site rather than just the ones a
  feature author remembered to route through `sendBulkMemberEmail()`. `email-guardrail.test.ts`
  has direct coverage for the club-distribution-list guard and for `sendBulkMemberEmail()`'s
  unconditional block, but no test explicitly asserts the shape that actually caused the second
  2026-08-12 incident: a `for` loop calling plain `sendEmail()` once per recipient (the
  `LEDGER_APPROVE`-approver notification), not routed through `sendBulkMemberEmail()` at all.
  Reading the guard condition shows it covers this shape correctly today — but the incident that
  motivated the rewrite deserves a test in that exact shape, not just a read-through.

  **Shape of the fix:** add a test asserting a single, non-bulk `sendEmail({ to: <fabricated,
  never-allowlisted address> })` call is blocked outside production with `RESEND_API_KEY` unset
  or set — mirroring the loop shape in `transactions/route.ts`'s approver notification, not the
  bulk shape already covered.
  **Priority note (2026-09-05):** `src/lib/email-guardrail.test.ts:106-113` ("does NOT deliver to
  an ordinary individual recipient outside production") already asserts the core claim this item
  wants — a single, non-bulk `sendEmail()` call to a non-allowlisted address is blocked outside
  production. What's still missing is a test literally shaped like the `transactions/route.ts`
  approver-loop call site; lower priority than the title suggests given the substantially
  overlapping coverage that already exists.

- [ ] **B-50 — Commit a Playwright spec for the acknowledgment-letter email-send UI flow.**
  *(Raised 2026-08-12, Phase 6 of Emailing the Donor Acknowledgment Letter.)*

  QA passed the feature on independently-reproduced API/DB-layer proof (the atomic claim, the
  permission gate, the deny-by-default guard, all driven live against a real dev DB and a real
  route) plus a direct read of the unit tests for the two paths that can't be driven live under
  this codebase's own testing constraints (revert-on-total-failure, the shared-address zip). The
  existing `acknowledgment-letter-generation.spec.ts` Playwright spec still passes with no
  regression from this feature's changes to the shared PATCH mark-sent route and selector
  component. But no *new* committed Playwright spec exists for the email-send flow itself — the
  Send by Email button, the non-destructive confirm dialog's donor/address-count wording, the
  results panel's "Emailed never Delivered" copy, and dedup-on-a-second-click **at the UI layer**
  (as opposed to the already-proven server-side atomic claim). The implementer's own Phase 4 (UI)
  verification drove this exact flow live via a throwaway Playwright script, but that script was
  discarded after use rather than committed.

  **Shape of the fix:** a new `e2e/acknowledgment-letter-email.spec.ts`, sibling to the existing
  generation spec, covering: the Email column's per-row states (address count, "No email on
  file," and the em-dash for no donor linked), the Send-by-Email button's disabled-with-reason
  state when nothing is eligible, the confirm dialog's non-red button and count-based copy, the
  results panel's summary + disclaimer + per-row detail, and a deliberate rapid-double-click on
  the confirm button to prove the UI-level race lands on the same "second call skipped" outcome
  already proven at the API layer.
  **Priority note (2026-09-05):** re-checked, no `e2e/acknowledgment-letter-email.spec.ts` (or
  similarly named spec) exists yet — still fully open.

- [ ] **B-51 — Aggregate "N donors in this batch have no email on file" summary on the
  acknowledgment-letter selector, not just the per-row amber badge.**
  *(Raised 2026-08-12, Phase 6 of Emailing the Donor Acknowledgment Letter.)*

  Not a gap against what Phase 1 asked for — Phase 1's "at a glance" requirement is satisfied
  literally by the per-row amber "No email on file" badge, which deliberately mirrors the
  already-trusted "Missing address" pattern on the same table. But the specific failure mode
  Phase 1 was written to prevent — "a donor silently gets neither a print nor an email" — is
  best guarded by a signal a treasurer cannot scroll past, and a batch of 30+ generated letters
  makes a single amber cell among many rows easier to miss than an aggregate count would be.
  Low priority: this is an enhancement to an already-correct, already-shipped pattern, not a
  defect.

  **Shape of the fix:** a one-line summary above or beside the Send-by-Email button — e.g. "3 of
  22 donors in this batch have no email on file — they'll need a printed letter" — computed from
  the same `rows` the Email column and eligibility check already read, no new data fetch
  required.
  **Priority note (2026-09-05):** re-checked, `acknowledgment-letter-selector.tsx` has no such
  aggregate summary string yet — still open, low priority per its own text.

- [ ] **B-52 — `src/lib/members.ts` unit test coverage is well under the project's 80% target.**
  *(Raised 2026-09-03, Phase 6 of Social Media Post Requests; the gap itself is older —
  first logged in the 2026-05-20 and 2026-06-24 test-coverage reviews as "pre-existing,
  e2e-covered" and never tracked past the review log.)*

  `src/lib/members.ts` sits at 35.89% statement coverage against this project's 80% target
  (QA's Phase 5 run, 2026-09-03; earlier reviews recorded it at 0%). No feature to date has
  touched this file directly enough to justify closing the gap as a side effect, so it has
  been re-observed cold at least three times across four months without ever becoming a
  tracked, assignable item — this entry exists so the next coverage review has something to
  check off instead of rediscovering it.

  **Shape of the fix:** a `src/lib/members.ts` Vitest suite covering its exported functions
  directly (not just via e2e), sized to bring statement coverage to 80%+; qa to scope the
  exact function list at the next 7-day test-coverage review.
  **Priority note (2026-09-05):** `src/lib/members.test.ts` currently exists at 275 lines — not
  obviously closed against an 80% target without re-running coverage; treat the gap as still
  open until confirmed otherwise at the next test-coverage review.

- [ ] **B-54 — `sendEmail()`'s `_bulkMemberSend` option is dead code; its doc comment overclaims
  what it does.**
  *(Raised 2026-09-04, Phase 5 of Event Announcement Emails; QA's Feature-Gate Audit.)*

  `SendEmailOptions._bulkMemberSend` (`src/lib/email.ts:70`, added 2026-08-12 in commit
  `ff613f1`, unrelated to this feature) is documented as widening the non-production email guard
  "unconditionally (no address matching)" for bulk-member sends. It is destructured at line 98
  but never referenced anywhere in the actual guard (`isDevAllowedRecipient(to)` at line 142 is
  the only check applied, identical for bulk and single sends) — confirmed by direct grep, not
  inferred. The real deny-by-default behavior is correct and was independently observed working
  live during this feature's QA pass (`blocked_non_production` on every queued row, nothing sent
  to Resend); this is not a regression and does not loosen the guard. It means the comment's
  stronger claim is simply unimplemented, and both `sendBulkMemberEmail()` consumers to date
  (Dues Reminders and now Event Announcement Emails) share the same dead parameter.

  **Shape of the fix:** either wire `_bulkMemberSend` into `isDevAllowedRecipient()` to match
  what the comment promises, or delete the parameter and comment entirely if the extra guard was
  never actually wanted. Small, contained to `src/lib/email.ts` — a natural pickup for the next
  30-day security review (also flagged there independently) or as a standalone one-line fix
  whenever `email.ts` is next touched.

- [ ] **B-55 — `src/lib/club-files-queries.ts` is under the 70%+ unit-coverage floor (58.33%
  statements).**
  *(Raised 2026-09-04, Phase 5 of Club Files; QA's coverage sweep; confirmed by analyst at Phase 6.)*

  `updateClubFileMetadata`, `listAllClubFilesForMembers`, `getClubFileById`, and
  `getClubFileForDownload` have no unit test exercising the real function body — the route tests
  that call them mock the queries module. All four are exercised live by
  `e2e/club-files-flow.spec.ts` against a real DB (genuine end-to-end evidence they work), but
  that's not a substitute for a fast isolated unit test, and the metadata-update path
  (`updateClubFileMetadata`) isn't even directly hit by the e2e spec. QA estimated this at under
  an hour of work: add cases to `src/lib/club-files-queries.test.ts` mirroring the existing
  attachment/deletion tests already in that file. Small and contained — a natural pickup
  whenever `club-files-queries.ts` is next touched, or the next test-coverage review.
  **Priority note (2026-09-05):** `src/lib/club-files-queries.test.ts` currently exists at 228
  lines; QA estimated under an hour of work here — a good quick pickup at the next test-coverage
  review.

- [ ] **B-61 — Newsletter self-service unsubscribe.** *(Raised 2026-09-04, site review.)*
  Unsubscribe is currently "contact us." Add a tokenized one-click unsubscribe link to
  newsletter sends and an unsubscribe confirmation page; update the /privacy wording once live.

---

## Watching / needs info

- [ ] **B-56 — Club Files admin list shows "Uploaded {date}" with no uploader name.**
  *(Raised 2026-09-04, Phase 4c of Club Files; confirmed by analyst at Phase 6.)*

  Phase 3's design doc asked the admin list to show "attached events, uploaded when/by."
  `club_files.uploaded_by_user_id` exists on the row (Phase 4a's schema) but was never selected
  into `AdminClubFileSummary` (`src/lib/club-files-queries.ts`), so
  `src/app/(dashboard)/admin/club-files/page.tsx` can only render the date, not "by {name}."
  ux-developer deliberately did not join `users` from the UI layer to avoid a query-layer bypass.
  **Shape of the fix:** add `uploadedByName` to `AdminClubFileSummary` via a small `users` join in
  `listClubFilesForAdmin()`, then render it on the admin list row. Confirm with the club first
  whether the date alone is actually sufficient in practice before spending the time — it may not
  be worth fixing.
  **Priority note (2026-09-05):** this item explicitly asks for a club decision before any work
  starts ("confirm ... before spending the time — it may not be worth fixing") — filed here rather
  than in a work tier until that confirmation happens.

---

## Likely obsolete — verify and close

- [x] **B-01 — Ledger user's guide built into the treasury page.** (graduated 2026-07-21 →
  `docs/work-log/2026-07-21-treasury-users-guide.md`; user supplied a content outline — bank
  transition, 990 calendar, compliance/reports, Zeffy/Activity Fund routing, settings review;
  donors doc explicitly excluded from v1.) (added
  2026-07-21, priority: soon) An in-app user's guide for The Ledger, embedded in
  the treasury/admin ledger surface — how the books are organized (two entities,
  funds, categories), how to record income/expenses/transfers, dues tracking,
  reimbursements, reconciliation, the compliance guardrails and what their
  warnings mean, and month/year-end routines. Audience: the treasurer (and a
  future successor — this doubles as treasurer-succession documentation, the
  same motivation as v1.27.0's treasurer books onboarding). Shape TBD in Phase 1
  (e.g., a help page under `/admin/ledger` with sections, or contextual help
  panels per surface). Should reflect whatever reconciliation ships from
  `2026-07-21-bank-reconciliation.md` — sequence this after that feature lands,
  or write the guide's reconciliation section against the shipped behavior.
  **Evidence:** already marked delivered in its own text, work-log exists with SHIP WITH NOTES verdict.

- [x] **B-05 — Reconciliation matching grid shows no preview of what a bank
  line is matched to.**
  (resolved 2026-07-28 → `docs/work-log/2026-07-28-zeffy-batch-reconciliation.md`;
  SHIP WITH NOTES — the expandable "Matched · N" list built for batch
  reconciliation, sourced from `getMatchedTransactionsForSession()`, now shows
  every matched row's date/party/amount inline, superseding the plain
  "Matched" badge this item was filed against. See B-23 below for the
  companion destructive-styling nit noted in the same original review, which
  this pass did not touch and remains open.)
  (added 2026-07-21, priority: nice-to-have) Surfaced
  during Phase 6 of `2026-07-21-ledger-reconciliation-sessions.md`
  (bank-reconciliation inc2). `BankLineWithMatch` (the session-detail API
  response) only carries `matchedTransactionId` — a bare UUID — so the
  matching grid can only show a plain "Matched" badge + Unmatch button, not
  the counterpart transaction's date/amount/party. A treasurer who wants to
  double-check a match must Unmatch first (reverting the decision) to see
  what it was matched to. Not a functional defect — ux-developer and qa both
  flagged it as an intentional, disclosed gap, not a bug — but a real
  workflow friction point once inc3's auto-match increases match volume. Fix:
  extend the session-detail query (`reconciliation-queries.ts`) to join the
  matched transaction's `date`/`amountCents`/`party` alongside
  `matchedTransactionId`, and render a small inline summary instead of the
  bare badge. Natural to bundle with inc3 (auto-match/Zeffy batch matching)
  since that increment already touches this same query path.
  **Evidence:** already marked resolved in its own text, citing the shipped work-log.

- [x] **B-14 — Board-adoption capture for Ledger budgets (date + board-minute reference).**
  (delivered 2026-07-27 → `docs/work-log/2026-07-27-ledger-budget-approve.md`; SHIP WITH NOTES —
  see that work-log's Phase 6 for the live-click-through and migration-apply follow-ups.)
  (added 2026-07-27, priority: nice-to-have) Flagged in Phase 1 of
  `docs/work-log/2026-07-27-ledger-guided-budgeting.md` as a real, named ask
  from Chuck ("the board formally ADOPTS the budget") but explicitly deferred
  out of the guided-budgeting increment — `ledger_budgets` today is
  upsert-in-place with no draft/final state and no board-minute reference,
  in contrast to `ledgerTransactions.boardMinute`, which already exists for
  approved disbursements. Shape reached for when picked up: a new
  `ledger_budget_approvals` table, one row per `(entityId, fiscalYear)`,
  carrying an adopted date + board-minute reference string (plus a logged
  unlock reason/date/user), mirroring the existing `ledgerTransactions.boardMinute`
  column. Enforced server-side (`assertBudgetUnlocked()`, called from inside
  `upsertBudgetLine` and explicitly from `POST /categories`) — a locked
  `(entity, fiscalYear)` cannot be edited via any write path, not just a
  UI-disabled control.
  **Evidence:** already marked delivered in its own text.

- [ ] **B-16 — Standalone ledger-category management surface (edit, deactivate, reorder).**
  (added 2026-07-27, priority: nice-to-have) Flagged in Phase 1/2 of
  `docs/work-log/2026-07-27-ledger-budget-approve.md` and deliberately deferred:
  that increment shipped the *first-ever runtime category-creation path*
  (`POST /api/admin/ledger/categories`), but only the minimal inline
  "name + flow, everything else defaulted" form, scoped to the fund card
  being budgeted. There is still no surface anywhere in the app to edit a
  category's name, `form990Line`, `sortOrder`, or `countsAsGiving` after
  creation, or to deactivate one — those remain SQL-migration-only edits.
  Architect Ruling 4 (same work-log) explicitly recommended not over-building
  this speculatively; pick it up once real usage of the inline create shows
  what full category CRUD actually needs.
  **Evidence this shipped (found in analyst's own review, not in the automated pass above):**
  `docs/work-log/2026-08-07-ledger-category-management.md` records a full Phase 1–6 pipeline
  (database-admin → api-developer → ux-developer implementation, qa PASS, analyst **SHIP WITH
  NOTES**, all dated 2026-08-07) for exactly this surface — edit, deactivate, and manage
  categories outside the inline create path. Confirmed live via
  `e2e/ledger-category-management.spec.ts`.

- [ ] **B-17 — Cause-level budget detail: cause-tagged line items under a category.**
  (picked up 2026-07-27 → `docs/work-log/2026-07-27-ledger-cause-budget-lines.md`;
  Phase 1 READY WITH NOTES split B-17 into three increments — **Increment A**
  (planning-only cause budget line items) is the one now in the pipeline; the
  actuals-matching and vs-actual halves are split out as **B-18** and **B-19** below.)
  (added 2026-07-28, priority: idea — needs Phase 1) Chuck's model, raised while
  reviewing whether the budget can hit the `/members/impact` "giving by cause"
  grain. Shape: a budget **category** target can be built up from **line items**,
  each assigned a **cause** + amount, where the category total = sum of its cause
  line items — OR the treasurer just enters a lump sum for the category and skips
  the breakdown (both modes supported). Cause becomes a **structured field on a
  budget line item** (not free text). Because a line item lives *under* a category
  (which is per-fund), the same cause can appear under several categories/funds as
  separate line items — which matches the historical data exactly.
  **Why this shape (vs. the two alternatives explored 2026-07-28):**
  the Quicken import already derives category and cause via *two different*
  functions (`mapFoundation`/`mapClub` → categoryName; `deriveCause` → a controlled
  9-value cause taxonomy on every charitable/activity EXPENSE row — see
  `scripts/import-quicken-ledger.ts:213-292,525-529`). Causes genuinely **cross**
  categories and funds (e.g. "Youth & Education" spans `Scholarships` +
  `Charitable donation out`; generic buckets like `Grant out` hold many causes),
  so (A) "make each cause a category" would force a category re-org + per-fund
  cause duplication, and (B) a fully independent cause axis is a much bigger build.
  This category→cause **two-level** model keeps categories as the top grain (what
  v1.39.0 shipped), needs no category re-org, and adds cause as sub-detail.
  **Seeding:** pull the past ~2 FYs of cause-tagged transactions, group by
  (category, cause), present those as starting line items under each category.
  **Open questions for Phase 1:** (1) null-cause giving rows need an "Other
  community support" line item — get the live count (read-only analysis was
  staged this session but the prod query was not run); (2) taxonomy warts to
  reconcile — "Disaster Relief" already exists as both a cause *and* a category;
  "Fundraising event costs" is in the cause list but isn't beneficiary giving;
  "Scholarships" folds into Youth or stays a finer cause; (3) how a cause line
  item's actuals are matched — actuals key on `categoryId` today, so cause-level
  budget-vs-actual needs the transaction's `beneficiary_cause` to become a
  structured, pickable value too (not free text) for the match to be reliable;
  (4) schema: a `ledger_budget_lines` child of `ledger_budgets` (or a nullable
  `cause` on a revised budget row) + how it interacts with the v1.39.0
  `ledger_budget_approvals` lock.
  **Evidence Increment A shipped:** `ledgerBudgetLines` exists in `schema.ts` and is exercised
  throughout `src/components/admin/ledger/budget-cause-editor.tsx`; the subsequent Labeled Cause
  Lines increment (DECISION-047/048, referenced by B-21 below) explicitly describes replacing
  in-place cause editing *on top of* this feature, confirming it was live and in production use by
  2026-07-28. Increment A's B-18/B-19 successors are tracked separately (see Later / obsolete).

- [x] **B-19 — Cause-level budget-vs-actual (reach the `/members/impact` giving-by-cause grain).**
  (added 2026-07-27, priority: nice-to-have — split out of B-17 Increment A's Phase 1;
  **depends on B-17 Increment A + B-18**) The piece that actually delivers B-17's original
  motivation: compare each cause budget line item (from Increment A) against actuals.
  Actuals key on `categoryId` today, so a reliable cause-grain match needs the
  transaction's cause to be structured (B-18) — it cannot be built correctly on free text.
  **SUPERSEDED by B-30 (2026-07-30):** B-30 delivers this directly, at a finer
  (line-item, not just cause) grain, via an explicit FK instead of a structured-cause
  dependency — B-18 is no longer needed as this item's prerequisite. See
  `docs/work-log/2026-07-30-transaction-budget-line-link.md`.
  **Evidence:** already marked superseded in its own text; B-30 (also in this tier) confirms
  the FK (`budgetLineId`) actually shipped — `src/lib/db/schema.ts:916`.

- [x] **B-21 — Dedicated rename endpoint for cause-line budget rows — SUPERSEDED, closed 2026-07-28.**
  (added 2026-07-27, closed 2026-07-28 — see `docs/work-log/2026-07-28-ledger-labeled-cause-lines.md`
  DECISION-047/048) The DELETE+PATCH rename window this item worried about no
  longer exists: the Labeled Cause Lines increment removed in-place cause editing
  entirely (a line's cause is fixed at creation; moving it to a different cause is
  now an explicit DELETE + CREATE, a deliberate, user-confirmed scope cut, not a
  workaround). Amount and label edits both go through a single `PATCH { id, ... }`
  with no delete-then-recreate step at all. Nothing left to build here.
  **Evidence:** already marked closed in its own text.

- [x] **B-25 — Enter the approved FY2025 budget so "Prior Budget" isn't blank.**
  (added 2026-07-28, priority: high — meeting-critical follow-up from
  `docs/work-log/2026-07-28-budgeting-page-redesign.md` Phase 5/6) The new
  Prior Budget reference column is correct code (`formatBudgetReferenceCents(null)`
  → "—") but renders blank for every category because last year's *approved*
  budget was never entered into `ledger_budgets` for FY2025 — only FY2026's
  actuals-seeded budget exists, and `ledger_budgets` has zero rows at any
  fiscal year on the local DB per qa's direct query. Prior Actual populates
  fine (it's a live sum of `ledger_transactions`, not dependent on a stored
  budget row). Not an Increment 1 code defect — the feature is doing exactly
  what it should with the data that exists — but the reference column is
  half as useful as intended until FY2025's adopted numbers are typed in.
  Action: have the treasurer (or whoever holds the original paper/spreadsheet
  budget) enter FY2025's approved budget line-by-line using the existing
  `BudgetEditor` at `?fy=2025`, once, per entity/fund.
  **RESOLVED 2026-07-28** — `scripts/enter-fy2025-approved-budget.ts` (dry-run
  reconciled to the penny, then `--apply`'d to production): 28 `ledger_budgets`
  category-grain rows entered at fiscal_year=2025 across Club Administrative
  and Foundation Charitable, matching the approved-budget PDF totals
  exactly. No `ledger_budget_lines` (cause/beneficiary) detail was entered for
  FY2025 — category grain only, per the treasurer-approved scope.
  **Evidence:** already marked resolved in its own text.

- [x] **B-26 — Club/Administrative fund budget: missing rows + missing
  categories entirely, vs. the approved budget.**
  (added 2026-07-28, priority: high — surfaced by a separate budget audit,
  filed here per Phase 6 of `docs/work-log/2026-07-28-budgeting-page-redesign.md`)
  The Club (Administrative) fund currently has no budget rows at all, and is
  also missing categories the approved budget actually itemizes: New Member
  Fee, 4th of July Parade, Awards, Contingency, Lion L Support, Membership —
  plus District dues and International dues are not split (today likely one
  combined "dues" category, if any). This is a data-completeness gap, not a
  code defect in Increment 1's reference-column or print work. Needs a
  category-inventory pass against the club's approved budget before the next
  budget cycle, then the corresponding `ledger_budgets` rows entered.
  **RESOLVED 2026-07-28** — same script as B-25 above. Created the 6 missing
  Club/Administrative categories (New Member Fee, 4th of July Parade, Awards,
  Contingency, Lion L Support, Membership) plus 3 Foundation/Charitable
  categories (White Cane, Restaurant fundraisers, Miscellaneous) — 9 total —
  and entered all 13 Club/Administrative expense + 3 income budget rows for
  FY2025. District dues + International dues + Intl new-member fee were
  combined onto the existing "Per-capita tax" category per the
  treasurer-approved mapping, rather than split into separate categories.
  **Evidence:** already marked resolved in its own text.

- [ ] **B-29 — Budgeting page restructure: Income/Expense sections + inline add/remove at every grain.**
  (added 2026-07-29, priority: high — live meeting pain; needs Phase 1) During the
  FY2026 budget meeting the treasurer struggled to add and remove lines. Agreed shape:
  under each fund, split the flat interleaved list into an **Income** section and an
  **Expense** section, each with a header. `+` affordances at each grain: **section
  header → add category** (moved up from the bottom, where it was hard to find);
  **category row → add cause** (giving-eligible expense categories only —
  `isCauseEligibleCategory`); **cause row → add line item** (inherits that cause, so
  the per-line cause `<select>` in `budget-cause-editor.tsx` goes away entirely).
  **Removes must be explicit at every level** (line item / cause / category) and
  **reliable on the first click** — today there is no cause-level or (in breakdown
  mode) category-level remove, and the existing trash controls need multiple clicks
  to register. Root-cause hypothesis for the multi-click bug: a focused amount
  input's `onBlur` fires a commit + `router.refresh()` that re-renders the trash
  button out from under the cursor before the click lands ("blur eats the first
  click") — confirm in Phase 3; fix via mouse-down arming or a non-disruptive
  commit. Decisions taken with Chris: line-item removal is immediate + Undo; cause
  and category removal **confirm** (each takes multiple lines with it). Model is
  **unchanged** — line items always live under a cause. Touches
  `guided-budget-setup.tsx`, `budget-editor.tsx`, `budget-cause-editor.tsx`, and
  (per B-31) `budget-print-worksheet.tsx`. Note the label=party autocomplete idea
  raised mid-discussion is **dropped** if B-30 lands (see B-30).
  **Evidence this shipped:** `docs/work-log/2026-07-29-budgeting-restructure.md:1831` —
  "This closes the last open note — B-29 is now effectively SHIP IT." Phase 6 verdict
  recorded as SHIP WITH NOTES (line 1706). `src/components/admin/ledger/budget-editor.tsx:172`
  references rendering "one BudgetEditor per Income/Expense section."

- [ ] **B-30 — Explicit transaction → budget-line link (retire the fuzzy string-match reconciliation).**
  (added 2026-07-29, priority: high — redefines what a "line item" is; **Phase 1
  complete 2026-07-30 (READY WITH NOTES), Phase 2 fast-tracked/approved 2026-07-30
  (trivial footprint — no new dir/dependency), Phase 3 complete 2026-07-30** — full
  design in `docs/work-log/2026-07-30-transaction-budget-line-link.md`. **Locked by
  Chris (2026-07-30):** reimbursements in scope now (mark-paid gains a required
  category + optional link picker); collapse-with-links warns via `<ConfirmDialog>`
  with a real linked-transaction count; backfill runs against all historical FYs in
  one pass, dry-run first. **Named implementer sequence:** database-admin (schema +
  migration `0072`) → api-developer (pure helpers, report-query exact/fuzzy split,
  route handlers, backfill script) → ux-developer (shared `<BudgetLinePicker>`, both
  forms, both report surfaces) → qa. **Subsumes**
  `docs/work-log/2026-07-30-fiscal-report-cause-breakdown.md`'s Phase 1 in full — that
  work-log's design (member Statement scope, all-zero omission rule, "Other"
  catch-all) stands, and now ALSO covers the admin Fund Report as a peer surface
  (not just a fast-follow); its accuracy-caveat footnote narrows to only the rows
  still resolved via the fuzzy fallback, footnoted and visually distinct, once
  B-30's link exists.
  **Reshapes B-18/B-19:** B-18 (structured cause taxonomy) is **kept**, but at
  lower urgency — `/members/impact`'s giving-by-cause bucketing reads
  `beneficiaryCause` directly and stays independent of the link, so B-18 still
  matters for un-linked transactions and the impact dashboard, just no longer
  as a budget-vs-actual prerequisite. B-19 (cause-level budget-vs-actual) is
  **superseded** — B-30 delivers it directly, at a finer (line-item) grain, via
  an FK instead of a structured-cause dependency. Reimbursement mark-paid
  transactions were found to carry no `categoryId`/`beneficiaryCause` at all
  today (confirmed in code) — **now in scope, resolved**: mark-paid gains a
  required category select + optional budget-line picker; `beneficiaryCause`
  (already member-supplied at submission) is carried onto the created
  transaction, which it wasn't before.
  Today budget lines reconcile to actuals by a **soft join on `(category, cause,
  label==party)`** at report time (`causeLineReferenceKey` in `ledger.ts` —
  `${categoryId}::${cause}::${normalizedLabel}`; there is NO FK). Chris's insight:
  the payee is often a poor **description** of the budgeted intent and **drifts year
  to year**, so string-matching label→party is fragile. Proposed: a **nullable
  `budget_line_id` FK on `ledger_transactions`**; the transaction entry form gets an
  optional "applies to budget line" picker that can auto-fill category+cause from the
  chosen line. Frees the budget **label to be purely descriptive** (this retires
  B-29's label=party autocomplete). Load-bearing design questions to resolve in
  Phase 1/2: (1) **hybrid vs replace** — historical books (FY2025/26, Quicken seed)
  have no links, so prior-year **Actual** columns need the string-match as a
  fallback; a linked txn must never *also* string-match (double-count). (2) **Not
  everything has a line** — cause lines exist only under broken-down giving-eligible
  expense categories; lump-sum categories and all income have no line to point at.
  (3) **Line lifecycle** — a label edit keeps the line `id` (link survives, the
  desired win), but collapsing a breakdown deletes lines (`ON DELETE SET NULL`
  orphans links) — decide whether collapse is even allowed once txns are attached.
  (4) **Backfill** — forward-only vs a one-time hand-reviewed backfill. (5)
  **Per-FY scoping** of the picker. Grain confirmed with Chris: link is at the
  **line-item** grain, transaction → one line, optional.
  **Evidence this shipped:** `src/lib/db/schema.ts:916` — `budgetLineId: uuid("budget_line_id").references(...)`
  with a matching index at line 930; `e2e/transaction-budget-line-link.spec.ts` exists.

- [ ] **B-31 — Printable budget as a mailed review document (not just a meeting worksheet).**
  (added 2026-07-29, priority: high; **Phase 1 complete 2026-07-30, verdict READY WITH
  NOTES** — see `docs/work-log/2026-07-30-printable-budget-b31.md`) `budget-print-worksheet.tsx`
  now renders cause/line-item detail and star/notes (shipped alongside the Budgeting
  Page Restructure), but still has **no fund/section totals, no net surplus/(deficit),
  no beginning/ending balances, no fund-level page breaks, and no draft-vs-approved
  status** — all required now that Chris is escalating this as **the document used for
  board presentation**, mailed to people who never see the screen. Phase 1 resolved the
  July-1 balance source (`getFundReport(fund.id, targetFY).openingCents` — already
  fetched, no new query, same rolled-forward balance the Statement of Financial
  Condition treats as canonical) and cited 6 nonprofit board-budget-presentation
  conventions (income/expense subtotals + net line, prior-year comparison columns,
  balances as reference-only rather than folded into budget math, fund/functional
  separation matching Lions' own Administrative/Activities split, notes/assumptions,
  and formal approval status). Six open questions for Chris before Phase 2 (single vs.
  dual print mode re: hand-annotation lines, reconciliation caveat on the balance,
  consolidated all-funds summary page, empty-fund handling, mail audience/PII check,
  notes roll-up). Pairs with T-25 (category cleanup/traceability).
  **Evidence this shipped (verify before closing):** this work-log's own header
  (`docs/work-log/2026-07-30-printable-budget-b31.md:1-9`) declares it **SUPERSEDED**
  — the Phase 1-3 design was implemented inside
  `docs/work-log/2026-07-30-budgeting-overview-restructure.md` Phase 4 (marked Complete),
  with `DECISION-060` logging the `printFundSums`→`computeFundPlanSums` relocation, and
  `e2e/budgeting-overview-restructure.spec.ts` exists. **Caveat:** the host work-log's
  own Phase 5/6 sections are still literally written as "Pending" in the file — the code
  appears shipped but the formal QA/analyst sign-off paperwork looks unfinished. Confirm
  the print output actually has totals/balances/status in the live app before checking
  this off; if it does, the missing paperwork is a documentation gap, not a shipping gap.

- [ ] **B-35 — Cause-line label lost when amount then label are committed back-to-back.**
  (added 2026-07-29, found by QA's e2e suite during B-29 verification; priority: medium — real
  data-loss bug, pre-existing) In `budget-cause-editor.tsx`, filling a new cause line's **amount then
  label** in natural typing order can **lose the label**: each field commits independently on blur,
  and the first commit's success handler unconditionally overwrites local row state from the server
  response, clobbering the label the user typed second. Predates B-29 — originates in B-17 /
  DECISION-047/048 (Labeled Cause Budget Lines), untouched by the restructure. Fix: on commit-response
  reconciliation, don't overwrite a field the user has edited since the request fired (track per-field
  dirty state, or merge rather than replace). Add the e2e case QA already has the harness for.
  **Evidence this shipped:** `src/components/admin/ledger/budget-cause-editor.tsx:372-373` has
  `dirtyAmountRef`/`dirtyLabelRef`, with the commit-reconciliation logic at lines 663-771 checking
  per-field dirty state before overwriting — exactly the fix this item describes.

- [x] **B-39 — [**Resolved 2026-08-09** — `destructive` added to the adopt confirm dialog.]  Adopt-version confirm dialog should render as destructive.** (added 2026-08-09,
  Phase 6 of `docs/work-log/2026-08-09-governance-document-versioning.md`, priority: quick fix)
  `src/components/admin/documents/pending-versions-panel.tsx`'s `<ConfirmDialog>` for "Adopt Version
  N" doesn't pass `destructive`, even though its own description text says "It cannot be undone" and
  a nearby code comment calls adoption out as qualifying. CLAUDE.md: "Use the `destructive` prop for
  irreversible actions." One-line fix.
  **Evidence:** already marked resolved in its own title/text.

- [x] **B-40 — [**Resolved 2026-08-09** — the member-facing document view now states it is the club's governing text of record.]  State authoritative status on the member-facing governing-document page itself.**
  (added 2026-08-09, Phase 6 of `docs/work-log/2026-08-09-governance-document-versioning.md`,
  priority: nice-to-have) The treasurer's Decision 1 (2026-08-09) was "the website version becomes
  AUTHORITATIVE once live" — but that framing only exists in `docs/club-constitution-and-bylaws.md`
  (a git file) and the seed script's console banner, neither of which any member ever sees. The
  member-facing `/members/records/documents/[slug]` page (`document-view.tsx`) only says "Current —
  the club's operative text." That's a reasonable practical signal but never states the document
  supersedes the 1998 print/scan. For a page whose entire job is being the club's legal governing
  text, add one sentence making the supersession explicit and member-visible, not just recorded in
  a file developers read.
  **Evidence:** already marked resolved in its own title/text.

- [x] **B-42 — Proposal decision email shows a raw status enum instead of a human label.**
  **RESOLVED 2026-08-09, before launch.** `decisionEmailHtml()` now calls `proposalStatusLabel()`.
  Locked by regression tests in `src/lib/proposals.test.ts` asserting no status label ever
  contains an underscore. Fixing it surfaced a second, unlogged defect — see the note below.
  **Evidence:** already marked resolved in its own text.

  **Related, no separate ID (fixed the same hour, kept here for the record):** *Proposal emails
  did not escape member-supplied HTML.* All three proposal email builders interpolated free text —
  project name, need description, chair name, the board's decision note — straight into HTML. The
  board notification is delivered to `board@westervillelions.org`, i.e. every board member at once,
  so an unescaped `<` silently swallowed the rest of a line in an HTML mail client and a deliberate
  `<a href>` would have put an arbitrary link inside an email that looks like it came from the club.
  Fixed by lifting the `esc()` pattern already used by `src/app/api/suggestions/route.ts` into
  `escapeProposalHtml()` in the pure `src/lib/proposals.ts`, applied at every interpolation of
  member-supplied text. Enum- and number-derived values (status labels, money/date summaries) are
  generated by this codebase and are deliberately NOT escaped, to avoid double-encoding. Covered by
  four new tests. (added 2026-08-09, Phase 6 of `docs/work-log/2026-08-09-project-proposal-form.md`,
  priority: quick fix — treat as pre-launch, before this feature is used for a real board decision)

- [ ] **B-45 — Email the donor acknowledgment letter, instead of only printing it.**
  *(Raised 2026-08-12 by the treasurer, on discovering the send path was never built.)*

  **What exists already.** v1.61.0 shipped the whole letter: `ledgerAcknowledgments` rows,
  IRS Pub. 1771-compliant composition (written-ack ≥$250 and quid-pro-quo ≥$75, including the
  DESCRIPTION of goods received per DECISION-073), an editable club-wording template whose
  writable surface is only the four "warmth" slots, batch generation, and `sentAt` to mark a
  letter sent. Donor email addresses were deliberately captured then — a donor can hold
  several — with the release note saying they "will be used when emailing arrives." This item
  is that arrival.

  **What is missing.** There is no `sendEmail` call anywhere under the donors surface. Every
  letter is printed and handed or posted.

  **Depends on** the `cc`/`bcc` work in `docs/work-log/2026-08-12-dues-reminder-emails.md`,
  which adds those fields to `sendEmail()` and `email_queue`, and establishes the single
  Board-position resolver for "who is the treasurer". Build this AFTER that lands, and inherit
  both: the treasury CC rule, and one definition of the treasurer.

  **Things the design will have to decide, noted now so they are not rediscovered:**
  - A donor with several addresses: all of them, or a nominated primary? The club's very first
    donor asked for two, which is why multiple addresses exist at all.
  - A donor with NO email address still needs a printed letter. The two paths must coexist,
    and the treasurer needs to see at a glance which donors fall on which side.
  - `sentAt` currently means "the treasurer says this went". If some letters are emailed and
    some printed, the record should say WHICH, or the audit trail quietly loses that.
  - An emailed acknowledgment is a tax document. A bounce is not a cosmetic failure — it means
    a donor has no valid receipt. Bounces need to be visible, not swallowed.
  - "A letter, once sent, is fixed" is already the rule. Emailing must not create a second way
    to regenerate a sent letter.
  - Attachment or inline HTML? Minutes email inline by deliberate choice; a tax receipt a donor
    may need to keep for their records is a different case, and worth deciding rather than
    defaulting.
  **Evidence this shipped:** `src/app/api/admin/ledger/acknowledgments/letters/email/route.ts`
  exists with a matching `route.test.ts`; UI lives at
  `src/app/(dashboard)/admin/ledger/donors/letters/page.tsx`. CLAUDE.md's own "Key Features"
  section documents this as a shipped feature ("Acknowledgment Letter Email... atomic on
  purpose... UI must say 'Emailed', never 'Delivered'"). Its own Phase 6 follow-ups (bounce
  visibility, CC test, UI e2e spec, aggregate no-email summary) are tracked separately as
  B-47, B-48, B-50, B-51 — those remain open even though B-45 itself is done.

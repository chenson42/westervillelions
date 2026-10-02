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
- B-63 — `ackNotRequired`-category acknowledgments never generate a letter, even by request
- B-108 — Paid reimbursements must be reconcilable and correctable.
- B-111 — Treasurer permission baseline: bind or split `ledger.manage`, fix two gating mismatches.

**Soon**
- B-110 — Officer-handover screen.
- B-109 — Ledger structure admin: bank accounts, opening balances, funds, entity.
- B-112 — Treasury Guide refresh and handover/close checklists.
- B-113 — Start-a-new-fiscal-year flow.
- B-115 — Complete audit coverage and one audit page.
- B-122 — Email operations for the treasurer role.
- B-120 — Zeffy donation import.
- B-125 — `sync-roster.ts` and `import-roster.ts` write a `members.userId` column that does not exist.
- B-126 — Prior-fiscal-year cross-entity move has no web path
- B-96 — Deferred fund-move shapes (expense moves first)
- B-93 — Detector for public money entered in the Administrative fund
- B-92 — Retire or govern the legacy per-row reconcile toggle
- B-83 — Board-visible monthly list of reimbursements paid
- B-82 — `google_group_sync_log` keeps member email lists forever, with no retention
- B-77 — `dotenv` is an undeclared transitive dependency that breaks under `tsx` when a `@/`-aliased import shares its module graph
- B-75 — `financial-report-send.ts`'s `not_delivered` case writes the same message for both blocked-non-production and no-API-key
- B-74 — Generic email-queue retry has no awareness of any durable-claim table it doesn't own
- B-73 — `dues_reminders`/`event_announcements` read raw `.success`, never migrated to the durable-claim helpers
- B-72 — A permanent send failure is indistinguishable from a transient one in the retry UI
- B-71 — `listReadyToSendReports()` recomputes every already-`sent` month forever; no skip-window
- B-70 — No type/lint enforcement that a durable-claim caller checks `SendEmailResult.blocked`
- B-69 — No nav-level signal that a financial statement is ready to send to the board
- B-68 — Extract a shared `attemptResendSend()` helper for `sendEmail()` and the retry route
- B-67 — A blocked (non-production) send still satisfies the acknowledgment-letter claim
- B-66 — A retry stranded at `retrying` is invisible and un-retryable
- B-64 — Persist `replyTo` on `email_queue` so a retried send keeps it
- B-13 — Centralize the ledger payment-method list + labels
- B-27 — Increment 2: soft-delete/restore-until-finalize for budget lines
- B-32 — Post-changes budget analysis pass
- B-46 — Consolidate the copy-pasted scaffolding around every email send
- B-48 — Route-level automated test for the treasury CC rule
- B-53 — Six-to-nine e2e specs red on `main` outside the feature that surfaced them
- B-57 — Receipt-proxy download routes carry the same buffered-response exposure
- B-59 — Event type field + public calendar badges
- B-87 — Email Queue tables clip their right-hand columns on a phone
- B-89 — Reimbursements admin table: Mark Paid and Reject are off-screen at 360px
- B-91 — Reconciliation session detail page scrolls sideways on a phone
- B-98 — Mirror-direction pointer: a Club entry whose money is in the Foundation's bank account (delete here, enter on the Foundation's register)
- B-99 — Make lock next steps visible on phones, and add the bank-account help text.
- B-105 — The reconciliation match route re-verifies the transaction under a lock

**Later**
- B-114 — Fiscal-year close.
- B-123 — Complete read-only year export.
- B-118 — Donor merge.
- B-119 — Undo "Mark sent" on an acknowledgment letter.
- B-121 — Roster import UI.
- B-116 — Reconciliation input flexibility.
- B-124 — Compliance filing editing.
- B-127 — Bank-account PATCH re-verifies "not matched" under a lock
- B-128 — Consider retiring the aged public-fund guardrail entirely
- B-117 — Dues "Mark Paid" should ask the payment method.
- B-97 — Dues-synced row deletion and the fiscal-year delete gate
- B-95 — Migrate the seven existing `insert(ledgerAuditLog)` sites to `recordLedgerAudit()`
- B-94 — Consolidate duplicated ledger transaction guards
- B-84 — Consolidate the reimbursement $10,000 ceiling into one constant
- B-85 — Ledger transactions created by a reimbursement carry no marker back to it
- B-86 — Transactions created from a reconciliation bank line carry no marker back to it
- B-88 — Reimbursements admin page does not clamp an out-of-range `?page=`
- B-90 — The UUID-shape check is defined three times
- B-100 — "Moved from Administrative" marker (and optional History) in the register.
- B-101 — Sent-statement warning covers only the row's own month.
- B-102 — Sweep prefill memo date.
- B-103 — DOM component-test harness.
- B-104 — Club-to-Foundation move (the mirror direction as a move)
- B-106 — Tighten the acknowledgment issuer column
- B-107 — Duplicate-candidate warning cannot see a bundled deposit
- B-81 — Stranded `pending` email-queue rows are invisible on the Email Queue page and the nav badge
- B-79 — Let the treasurer record an earmark on a public fund so a deliberate multi-year hold stops tripping the aged-fund warning
- B-78 — Time-of-day / duration fan-out for same-title sibling events (bulk-edit)
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
- B-76 — Live public-form spam guard can't protect membership applications from a burst-leading/isolated bot submission
- B-80 — Aged-fund guardrail resets the clock on inter-fund transfers

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

- [ ] **B-63 — `ackNotRequired`-category acknowledgments never generate a letter, even by request.** *(Raised
  2026-09-22, Phase 6 of `docs/work-log/2026-09-22-donor-worklist-and-any-amount-ack.md`.)*
  `generateAcknowledgmentLetters()` / `listGeneratableAcknowledgments()`
  (`src/lib/ledger-acknowledgment-letter-queries.ts`) hard-exclude any acknowledgment whose
  transaction's category is flagged `ackNotRequired`, regardless of amount and regardless of
  whether an acknowledgment record was deliberately created via `typeOverride`. This was already
  true today for $250+ gifts in those categories (grants, race entries, pooled fundraiser
  deposits, internal transfers) — it is pre-existing behavior, not a regression. It became more
  reachable with the 2026-09-22 ticket above, where the Treasurer's own scoping decision ("any
  income category should be considered") now lets him link a donor and record a courtesy
  acknowledgment against a gift in one of these categories — and that acknowledgment will then
  silently never appear on `/admin/ledger/donors/letters`. Three separate phases of that ticket
  (tech-lead, ux-developer, qa) each recommended logging this and none did, which is why it's
  showing up here three weeks later instead of the day it was found. **Needs the Treasurer's
  decision**, not an implementation default: should `ackNotRequired` mean "never generate a letter"
  (current, silent) or "not legally required, but generate on request" (a real code change to stop
  hard-excluding a category once an acknowledgment record already exists for it)? Until decided, he
  should be told directly that acknowledgments he records against these categories won't show up in
  Generate Letters.

- [ ] **B-108 — Paid reimbursements must be reconcilable and correctable.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-1; audit priority P0; audit top-10 rank 1)
  **Verify first (code reading only; no live DB was queried).** The pay route inserts the ledger row with no `bankAccountId` and no `checkNumber` and stamps it approved-and-locked. `getCandidateTransactionsForMatching()` requires `bankAccountId = session account`, so the row can never appear as a match candidate, cannot be edited to add the account, and the bank's check line is left unmatched. The likely workaround, "create from bank line", would record the expense twice. Before scheduling, run a read-only query for `ledger_transactions` rows with a linked `ledger_reimbursements.ledger_transaction_id` and a NULL `bank_account_id`, and for expense rows created from a bank line that duplicate a reimbursement's amount and date. If no reimbursement check has cleared yet, the fix is preventive rather than corrective.
  **Fix shape:** (a) the pay dialog collects the bank account (default pre-selected, as the transaction form does) and check number, and the route writes both; (b) a narrow, allowlisted, audited carve-out in the approved-row lock (modelled on DECISION-099's `donorId` carve-out) lets a `ledger.record` holder set `bankAccountId`/`checkNumber` on a reimbursement-derived row that has none, so existing rows can be repaired without a script; (c) decide whether a paid reimbursement may be corrected (category, date, method) through an audited edit instead of an offsetting entry. None of this may change a closed session's arithmetic.
  **Related:** B-85 (the missing reverse marker; only notes the symptom). Repair today is the `backfill-bank-account.ts` script or SQL. Audit rows M10, M17, R3, R4. Needs Phase 1.

- [ ] **B-111 — Treasurer permission baseline: bind or split `ledger.manage`, fix two gating mismatches.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-4; audit priority P0, mostly a role-binding decision; audit top-10 rank 2)
  `ledger.manage` is bound to `admin` only, so a non-admin `treasurer` cannot reopen a reconciliation, edit a fund, manage categories, change settings, add a compliance filing, waive a receipt, move a reconciled or prior-year entry, or delete a donor. (Today's treasurer is presumably an admin, which hides all of this; audit open question 1 is whether the successor will be one. If yes, this item shrinks to the two gating fixes below.) Decide which of those abilities the `treasurer` role should hold by default and either bind `ledger.manage` to `treasurer` in a migration or split it into narrower keys (for example a corrections key versus a destructive-admin key). In the same change fix two mismatches: (1) the budget page "+ Add category" button is shown to `budget.edit` holders but `POST /categories` requires `ledger.manage`, so the treasurer and budget_committee get a 403; (2) the Email Queue nav entry carries no `requiredFeature` while its page requires `admin.users` (the access fix is B-122). Add a test that every control rendered for a permission is accepted by the server for the same permission. Widening a nav permission widens proxy access (CLAUDE.md, Admin-Area Protection): confirm every page under a widened segment gates independently. **Related:** B-97 (inconsistent record-versus-manage gate for prior-year deletes), B-16 (standalone category management, listed in the obsolete tier). Audit rows Y7, Y9, M5, H5. Needs a Phase 1 role-binding decision from the treasurer.
  **Amendment (2026-10-01, Phase 6 of the cross-entity work-log):** Add: cross-entity Move, and the Reopen step its checklist depends on, both need `ledger.manage`, so a successor on the `treasurer` role alone can read the checklist but cannot act on it. Someone with production access should confirm the current treasurer's account also holds `admin` (QA only read the dev role table).
  **Confirmed 2026-10-02 (treasurer):** next year's treasurer will probably NOT be an admin, so this is the first handover item to build; B-108 second.

---

## Soon

- [ ] **B-126 — Prior-fiscal-year cross-entity move has no web path.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md`; DECISION-112)
  The cell is refused with `prior_fiscal_year_cross_entity` and the Move button is omitted on prior-year Foundation rows
  (X10), so a June gift found at the July reconciliation — exactly the shape that prompted the feature — has nothing to do
  in the UI, and a receipted gift cannot be deleted (409 `receipt_sent`), so the fallback today is SQL. (a) **Now, cheap:**
  show Move disabled with the reason ("Gifts from an earlier fiscal year cannot be moved to the Club yet; ask the board")
  instead of omitting it, and add one guide sentence naming the interim path. (b) **After the treasurer answers whether
  prior-year moves should be allowed:** either allow it under `ledger.manage` with a stronger warning (it restates two
  entities' totals for a closed year, which feeds each entity's filed return) or specify the supported correction (e.g. a
  dated refund entry plus re-entry) so it is a documented web procedure. Priority: Soon — the real risk to the
  "next treasurer never needs SQL" goal.
  **Decided 2026-10-02 (treasurer):** prior-year gifts stay NOT movable. Part (b) is closed; only part (a) remains — show Move disabled with the reason and add one guide sentence pointing at the documented correction (refund entry on the Foundation register + re-entry on the Club register where the cash sits, then sweep). Priority drops to Later.

- [ ] **B-110 — Officer-handover screen.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-3; audit priority P1; audit top-10 rank 3)
  One page (visible to the treasurer, president, secretary and admin) showing: who `resolveTreasurer()` resolves to and, if it fails, why (`none`, `multiple`, `no_board_group`); who holds the `treasurer` role; every `ledger.record` holder (so "a submitter cannot pay their own reimbursement" stays satisfiable); and the letter-signature name versus the resolved Treasurer. A guided "Hand over to [member]" action sets the Board position and grants or revokes the `treasurer` role in the safe order, and offers to clear a stale hand-typed signature. Today this is three order-sensitive pages (role in Users, position in Groups, signature in Letter Template); if the outgoing Treasurer's Board position is not cleared first, Send to Board and dues reminders hard-block with "multiple treasurers". **Needs a Phase 1 on who may perform it:** the role change is `admin.users` (admin only) today, and an outgoing non-admin treasurer cannot do it. Audit rows Y15, M16, H2, H3, H4, H6. The written (guide) half is B-112.

- [ ] **B-109 — Ledger structure admin: bank accounts, opening balances, funds, entity.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-2; audit priority P1; audit top-10 rank 4)
  A `ledger.manage` page under Settings to add, rename, deactivate and set-default **bank accounts** (institution, type and **opening balance**, which has no writer anywhere: `ledger_bank_accounts.opening_balance_cents`, DECISION-091, is touched only by import scripts), create and deactivate **funds**, and edit **entity** details (name, EIN, fiscal-year end; the schema comment says "editable via ledger.manage" but no route exists). Audited. Include "why can't I delete this" explanations (an account with transactions can only be deactivated). Replaces the guide's "adding an account needs a developer script." Fund edit (name, opening balance) today is also unaudited and unlocked against reconciled periods and sent statements, so editing it after a statement went out silently rewrites history; this item should lock or warn on that (see B-115 for the audit half). Audit rows Y3 to Y6. Priority note: moves from "rare" to "next" if the club changes banks or adds an account soon (audit open question 3). Needs Phase 1.
  **Confirmed 2026-10-02 (treasurer):** a bank change is possible but low priority; keep in Soon at low priority.

- [ ] **B-112 — Treasury Guide refresh and handover/close checklists.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-5; audit priority P1; audit top-10 rank 5)
  The guide is the successor's only documentation. **Fix four stale statements:** (1) `budgeting-section.tsx:63-71` still tells the treasurer to click "Seed from last year", which no longer exists in any UI (`budget-fund-editor.tsx:152-154`; removed on purpose, B-28); (2) `settings-section.tsx:34-35` and the copy in `ledger-settings-form.tsx:105-106` say "at or above" the approval threshold, but `transactions/route.ts:361` approves only strictly above; (3) the v1.86 changes are undocumented: the register's reconcile checkbox is locked for session-cleared rows, a changed bank account on an entry matched in an open session is refused, and the Delete section omits the 10-to-500-character reason rule and the 90-day "Recent corrections" list on Compliance; (4) the `page.tsx` comment says "twelve section files" and there are thirteen.
  **Add:** a monthly close checklist (record, reconcile, statement, acknowledgments, dues); start-a-fiscal-year and year-end checklists; officer handover, app side; the Send to Board panel and corrected resend; Settings sub-pages (Categories, Acknowledgment Letter), that Settings needs manage, and category merge/deactivate; dues season setup and `/admin/dues/reminders`; donors, acknowledgments and emailing letters (**reverses the 2026-07-21 decision to exclude them**; see B-45, B-51, B-63); budget approve, lock and unlock; the email queue and retry; the Chase CSV format, 2 MB cap and one-upload rule; compliance filing status; B-98's Foundation-case paragraph; and a named developer contact for deploy, keys and backups (audit open question 5). Extend the release-notes skill so it requires a guide update for any new treasurer surface. Cheap, and unlocks B-110 and B-113. Related: B-07 (guide print). Audit rows Y2, Y7, Y10, Y11, Y13, Y15, M16, D2, H7, X8.

- [ ] **B-113 — Start-a-new-fiscal-year flow.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-6; audit priority P1; audit top-10 rank 6)
  One page, in order: confirm the prior year is closed (B-114); create next FY's budget from last year as an **editable starting point, including cause lines** (B-37); bulk-retire categories unused this FY (replaces `deactivate-unused-categories.ts --fy=YYYY --apply`); configure the dues season; confirm compliance filings; review settings. Delete the dead `POST /budgets/seed` route and its seed-computation code (B-28) as part of it. **Phase 1 must ask the treasurer why the old "Seed from last year" button was removed (B-28) before reviving it.** Today year-start is re-typing every budget line by hand, a script for bulk retirement, and a stale guide pointing at the removed button. Audit rows Y1, Y8, Y10, Y14. Open question 4: should closing the prior year be mandatory or advisory before a new budget is approved?

- [ ] **B-115 — Complete audit coverage and one audit page.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-8; audit priority P1; audit top-10 rank 7)
  A successor must be able to answer "what did my predecessor change, and why." Record ordinary transaction edits (field-level before/after), fund and opening-balance edits, settings, dues edits, donor edits and deletes, filings, and session close/reopen in `ledger_audit_log` via `recordLedgerAudit()` (**absorbs B-95**; also covers the legacy reconcile toggle that writes no audit row, B-92), and add `/admin/ledger/audit` with filters by actor, record, action and date range beyond 90 days. Today the only reader is "Recent corrections" on Compliance (moves and deletes only, 90 days, 25 rows); no page lists category, discard, template or donor-link rows. Must keep reasons and names off any member-facing surface (the existing `ledger-audit.ts` import-guard rule). **Related defect, not otherwise filed:** `PATCH /transactions/[id]` never reads the approval-threshold setting (the check runs only at creation), so a small posted expense can be edited upward without approval; decide in Phase 1 whether that belongs here or as its own fix. Audit rows A1, M3, Y3.

- [ ] **B-122 — Email operations for the treasurer role.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-14; audit priority P1; audit top-10 rank 8)
  A narrow permission (view and retry failed emails) bindable to `treasurer`, instead of overloading `admin.users`; hide the Email Queue nav entry from those who lack it (today it is visible to every admin-area user, who is then redirected away; see B-111); a manual "dismiss with reason" for stuck rows (today SQL). **When scheduled, fold in B-81 (stranded `pending` rows invisible) and B-72 (permanent versus transient failure in the retry UI); those stay open until then.** Statements, receipts and reminders all depend on mail, and a non-admin treasurer today cannot see or retry a failed send. A bounce is still invisible (B-47). Related: B-66, B-74. Audit rows X1, X2, X3.

- [ ] **B-120 — Zeffy donation import.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-12; audit priority P1; audit top-10 rank 10)
  Upload Zeffy's donation export; propose Activity-fund income rows (payment method `zeffy`), match donors by email, de-duplicate on the Zeffy transaction id, and never post public money to Administrative (this also delivers B-93's detector at the point of entry). Today every donation is hand-keyed, one entry each, the biggest recurring data-entry job and the likeliest source of wrong-fund entries. Related: B-34 (Zeffy pass-through Activity to Foundation), B-93, B-23 (batch-match on the Monday lump payout). Zeffy 403s server-side fetches, so this is an upload, never a scrape (CLAUDE.md, Zeffy). Audit rows M2, M19.

- [ ] **B-125 — `sync-roster.ts` and `import-roster.ts` write a `members.userId` column that does not exist.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, roster-script finding, Y12 and "Incidental defects" 6; **verified 2026-10-01 against `src/lib/db/schema.ts` and both scripts**; priority: Soon, small)
  The analyst was right on the main point and **understated it**. Verified: (1) `members` has no `userId` column. The link runs the other way, `users.memberId` (schema.ts line 13, FK to `members.id`). `sync-roster.ts` does `eq(members.userId, existingUser.id)` (line 88) and inserts `userId` into `members` (lines 110, 131); `import-roster.ts` inserts `userId` into `members` (line 121). (2) Neither script supplies `email` when inserting a member, and `members.email` is `NOT NULL` (schema.ts line 26), so the insert would fail even with the `userId` fixed. (3) Both scripts create the `users` row first and the `members` row second, the reverse of the FK direction, and never set `users.memberId`, so even a successful run would leave no linked account, which CLAUDE.md treats as a defect ("members must always have user accounts"). (4) **The hard-coded personal path default is in both scripts, not only `import-roster.ts`:** `/Users/<name>/Downloads/Roster as of 2-3-2026...` at `import-roster.ts:147` and `sync-roster.ts:160`. It names a home directory, which sits against the No Personal Data invariant. These went unnoticed because `tsconfig.json` excludes `scripts/` from `pnpm exec tsc --noEmit`. A successor who finds them will assume they work.
  **Fix shape:** either delete both scripts (if B-121 will replace them soon) or rewrite them to insert the `members` row first (with `email`), then upsert the `users` row with `memberId`, take the file path as a required CLI argument with no default, and have `sync-roster.ts` match existing members by email or `memberNumber` rather than the nonexistent column; reuse the `isActive`/`membershipStatus` rule from `src/lib/members.ts`. Optionally add the `scripts/` directory to a typecheck pass so schema drift is caught. Dry-run by default, `--apply` to write, like the other scripts. Related: B-121 (the UI that supersedes them).

- [ ] **B-98 — Mirror-direction pointer: a Club entry whose money is in the Foundation's bank account.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; **re-aimed 2026-10-01** in Phase 3 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md`; DECISION-109/110/111/112)
  The original item proposed a Delete-dialog pointer on Foundation income rows ("delete it here, re-enter it as Activity Fund income, then sweep"). That path is blocked once a receipt was sent (the hardened DELETE returns 409 `receipt_sent`), and the Foundation-to-Club direction is now served by Move (DECISION-112), so the item is re-aimed at the **mirror**: a Club entry whose money is actually in the Foundation's bank account. The supported path is delete the Club entry (a Club row cannot carry a receipt, so nothing blocks it) and enter the gift on the Foundation's register in the bank account the money landed in, which is bank-consistent on both sides. Deliverables: (a) a **static** one-line pointer in the Delete dialog on any Club income row ("If this gift's money is actually in the Foundation's bank account, delete this entry here and enter the gift on the Foundation's register, in the bank account the money landed in."), with no server field and no free-text heuristic (that is B-93's territory); (b) the same paragraph in the Treasury guide under "Deleting an entry"; (c) the same sentence as the denial reason when a Club Administrative income row lists the Foundation's Charitable fund as a denied Move destination (`club_to_foundation_not_supported`). **Ships in the cross-entity increment's UI** (Phase 3 design); keep open until it ships. Small.

- [ ] **B-99 — Make lock next steps visible on phones, and add the bank-account help text.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109/110/111)
  (a) Show `LOCK_COPY[kind].nextStep` as wrapped visible text at every width, not `hidden sm:inline` plus a `title` on a disabled button (touch devices do not reliably surface it); the Move-disabled message already does this. (b) Add the Phase 1 Flow 3 help text to the edit form's bank-account field: "Pick the account the money actually went into. If it went into one account and was later moved to another, record a Transfer instead of editing this." Copy only.

- [x] **B-105 — The reconciliation match route re-verifies the transaction under a lock.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md` as B-next-C; priority raised to Soon by the Phase 3 design, ruling X4; DECISION-112)
  `reconciliation/sessions/[sessionId]/match/route.ts` reads each submitted transaction's `bank_account_id` and `reconciled` flag with a plain unlocked SELECT and inserts the match afterwards. A plain SELECT is not blocked by the cross-entity move's `FOR UPDATE`, and the match insert's key-share lock on the referenced row simply waits for the move to commit and then succeeds, so a match request whose read lands anywhere **inside the move transaction** (roughly the length of its round trips, not sub-millisecond as first written) can leave a Club row matched to a Foundation reconciliation session's bank line. The same read-then-write shape exists against the bank-account PATCH. Needs two admins acting on one row at once, and, contrary to this item's first draft, the close-time tie-out did not surface it (fixed in v1.87.0, see below), but it breaks the one invariant a cross-entity move relies on. Fix shape: run the insert in one transaction, re-select the submitted rows `FOR SHARE` (which waits for any in-flight `FOR UPDATE`), and re-check status, account and `reconciled = false` before inserting; return the existing 400/409 shapes. Live check 2c of the cross-entity work-log records whether the orphan is reproducible. Medium; pull it into the next ledger increment.
  **Picked up 2026-10-01 (v1.87.0):** qa reproduced the race live 4/4 (F1 in the cross-entity work-log) and found close never checked a matched row's bank account. Fix shipped in the same release: the match route re-verifies account + posted status under FOR UPDATE and 409s; the close route refuses (400) when any matched row's bank account differs from the session's.

- [x] **B-96 — Deferred fund-move shapes (expense moves first).**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109)
  v1 allows exactly one move: same entity, income, Administrative to Activity. Still denied: **expense moves**
  (Activity to Administrative first, because it cures Activity money spent on Club operations and is the more
  compliance-valuable cell; it needs the budget-line clear of DECISION-061, handling of `publicNote` and
  `beneficiaryCause` which render on `/members/impact`, and a decision on receipt and approval semantics),
  **away-from-public income moves** (a member's dues paid through the club Zeffy form and booked as an Activity
  donation is the realistic case; v1 answer is delete and re-enter as dues), and any **cross-entity correction**
  (needs a board decision, not a ledger feature; a Foundation-to-Club re-entry would put a Club row on a bank
  account the cash never touched). Enabling an expense cell is a one-branch flip in `checkFundMove()`, which already
  has the branch and a unit-test slot. Priority: first follow-up if the treasurer hits an expense mis-booking.
  **Amendment (2026-10-01, Phase 6 of the move-or-cancel work-log):** two properties the expense cell will bring. (1) Enabling Activity to Administrative expense moves can un-gate a month (an unreconciled Administrative expense row gates; the same row in Activity does not, per T20), so the dialog and release note must say so then; v1 income moves cannot (uncleared deposits never gate, DECISION-059). (2) When the cross-entity item is designed, run the direction policy before the bank-account assertion so a cross-entity request returns 403 `cross_entity` with the policy reason instead of 409 `bank_account_entity_mismatch`.
  **Amendment (2026-10-01, Phase 3 of the cross-entity work-log):** the cross-entity item above is now partly decided. One cell, income Foundation Charitable to Club Activity, shipped as DECISION-112 (the unsafe case named earlier is cash in the *Foundation's* account; cash in the *Club's* account is exactly what that cell serves). The mirror direction is B-104; cross-entity **expense** moves and Foundation-to-Administrative stay denied. The direction-policy-before-bank-assertion reordering this item asked for is done in DECISION-113.
  **Closed 2026-10-02 (won't do):** the treasurer confirmed the only cross-entity move cell will ever be Foundation Charitable → Club Activity (shipped v1.87.0, DECISION-112). The Club→Foundation mirror and the expense cell are not wanted.

- [ ] **B-93 — Detector for public money entered in the Administrative fund.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109)
  `adminPublicIncomeCount` is blind (category fund kind is forced equal to fund kind) and `firewallViolations`
  counts only transfer groups, so a single public donation entered in Administrative trips nothing; the treasurer
  found the original mistake by eye. Candidate tell: non-dues income in an Administrative fund with
  `paymentMethod = 'zeffy'`. This is how the mistake could be caught at entry rather than after the fact.
  Priority: medium; ship the move's release note first so the treasurer knows why no flag fired.

- [ ] **B-92 — Retire or govern the legacy per-row reconcile toggle.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109)
  The toggle is a second reconciliation mechanism that the session workbench supersedes. PATCH and DELETE do not
  lock a `reconciled = true` row that has no session pointer; rows matched in an open session remain editable
  (non-bank fields). DECISION-109 closes only the worst half (the toggle can no longer clear a closed session's
  pointer). Decide whether to retire the toggle, lock legacy-reconciled rows, and how existing legacy rows (likely
  including the Quicken-seeded ones, which predate sessions) get released. **Do not just add a guard:** it would
  strand rows whose only unlock is the toggle. Priority: medium.
  **Amendment (2026-10-01, Phase 6 of the move-or-cancel work-log):** the legacy reconcile toggle writes no audit row. The un-toggle-then-move sequence (a record-only user clears a legacy mark, then moves at the `record` tier) leaves a move audit row showing `reconciled: false` and `tier: record`, so the bypass is invisible in Recent corrections. B-92's decision (retire the toggle, lock legacy-reconciled rows, or at least audit the toggle) should cover this explicitly; the lock-or-retire choice stays B-92's.

- [ ] **B-89 — Reimbursements admin table: Mark Paid and Reject are off-screen at 360px.**
  (added 2026-10-01, Phase 6 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106; found by qa)
  The table scrolls horizontally inside its card, so a treasurer who opens the new-request email on a phone must
  scroll sideways to find the action buttons. Fix shape: below `sm`, stack each row as a card (member, amount,
  description, then the actions), or move the actions under the description. Related to B-87 (Email Queue tables
  clip on a phone) and B-91 (reconciliation detail page); consider fixing the Ledger tables together.
  Priority: should-do.

- [ ] **B-91 — The reconciliation session detail page scrolls sideways on a phone.**
  (added 2026-10-01 from Phase 5/6 of `docs/work-log/2026-10-01-discard-reconciliation-session.md`; pre-existing, found by qa)
  At a 360px viewport `/admin/ledger/reconciliation/[sessionId]` has a document width of 848px. The cause is the
  bank-lines `<table class="min-w-full">` (839px) in the matching grid (`reconciliation-matching-grid.tsx`), which
  sits in no horizontally scrolling container, so the whole page scrolls instead of just the table. Idea: wrap the
  table in `overflow-x-auto` (or a stacked card layout per row on small screens), then re-measure at 360px with an
  open session that has bank lines; check the unmatched-transactions list on the same page while there.
  Priority: low-to-medium (the treasurer reconciles on whatever device is nearest). Related: B-87, B-89.

- [ ] **B-87 — Email Queue tables clip their right-hand columns on a phone.**
  (added 2026-10-01, from Phase 6 of `docs/work-log/2026-10-01-email-queue-retention.md`; pre-existing, found by qa at 360px)
  At 360px the "Not Sent" table on `/admin/email-queue` is about 874px wide inside an `overflow-hidden`
  wrapper, so every column after "To" is cut off and cannot be scrolled to. That hides the status,
  error and the per-row Retry control on a phone. `/admin/sync-log` has no overflow at 360px, so the
  problem is this page's table markup, not the shared layout. The "Failed" and "Recently Sent" tables
  use the same wrapper and almost certainly share it; check all three. Fix shape: wrap each table in
  `overflow-x-auto` (or stack to cards below `sm`), keeping the `rounded-2xl` / existing card styling.
  Separate observation, not part of this item: at 360px the mobile admin top bar sits over the page's
  h1 (same coordinates as `/admin/sync-log`), which is shared layout and would be its own item if
  anyone cares. Priority: should-do (small; CLAUDE.md "Mobile-first" gotcha).

- [ ] **B-83 — Board-visible monthly list of reimbursements paid.**
  (added 2026-10-01, from Phase 2 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106)
  The board's decision to drop reimbursement approval is premised on seeing them afterward, but today the
  Monthly Statement shows category totals only (by design: it is member-visible and never carries `party`/`memo`)
  and the only named view is the Paid tab of `/admin/ledger/reimbursements`. Add a `ledger.view`-gated
  "Reimbursements paid" section to the admin Reports page, scoped to a month (names allowed: admin-only), and
  optionally the same list in the "Send to Board" email. The email half touches the DECISION-100/101 durable-claim
  send path and needs its own pipeline pass (it must use the durable-claim helpers, DECISION-102/103); do not let
  it ride along with the Reports section. The member-visible Monthly Statement must still never list
  reimbursements by name. Priority: normal-next, not "someday": it is the prerequisite for the board's
  after-the-fact review being more than a tab.

- [ ] **B-82 — `google_group_sync_log` keeps member email lists forever, with no retention.**
  (added 2026-10-01, from Phase 1 of `docs/work-log/2026-10-01-email-queue-retention.md`; DECISION-107)
  Every Google Group sync writes a row to `google_group_sync_log` carrying `added`, `removed` and `failed`
  jsonb arrays of member **email addresses** (plus `groupEmail`, the trigger source, and the error text), and
  nothing ever deletes one. It feeds `/admin/sync-log`. This is the same data-minimisation gap DECISION-107 closes
  for `email_queue`, in a different table with a different page and a different retention question: an
  audit-trail value (who was added/removed from which group, and when) that the board may want to keep far
  longer than six months, versus the addresses inside the arrays that do not need to outlive the event. Needs a
  Phase 1 of its own to decide: purge whole rows after N months vs scrub the address arrays but keep the row
  (count + timestamp + actor + outcome), what window, and whether the trigger is the same lazy page-load idiom
  (`/admin/sync-log`) or the sync path itself. Do not copy DECISION-107's 183 days without making that call.
  Priority: should-do; also a candidate for the 30-day security review's PII sweep.

- [ ] **B-77 — `dotenv` is an undeclared transitive dependency that breaks under `tsx` when a
  `@/`-aliased import shares its module graph.**
  (added 2026-09-28, from Phase 6 of `docs/work-log/2026-09-28-public-form-spam.md`, flagged
  independently by both qa and full-stack-developer during Phase 4/5 Revision 2; priority:
  should-do, needs a real Phase 1) Found while building `scripts/purge-form-spam.ts`: once that
  script's module graph included `../src/lib/form-guard` (which contains a dynamic
  `await import("@/lib/db")`, a tsconfig-`@/`-aliased bare specifier), `tsx`'s tsconfig-paths-aware
  resolver stopped resolving the bare specifier `"dotenv"` for that file — `Cannot find package
  'dotenv'`, reproducibly, independent of environment variables. Root cause: `dotenv` is not a
  declared dependency anywhere in `package.json` (only `dotenv-cli` is, a separate package used for
  the `dev`/`test:e2e` npm scripts) — it has been resolving "by accident" as a transitive dependency
  of something else in this pnpm-strict tree, and pulling in a `@/`-aliased import anywhere in a
  script's module graph exposes that phantom dependency as a hard failure. This feature's own script
  no longer depends on it (switched to Node's built-in `process.loadEnvFile()`, stable since Node
  20.6, matching `.nvmrc`'s Node 20.x target), but roughly 19 other scripts under `scripts/` still
  `import { config } from "dotenv"` directly against this same undeclared package — any of them could
  hit the identical failure the day their own module graph happens to pick up a `@/`-aliased import.
  **Shape of the fix:** either declare `dotenv` as a direct `package.json` dependency (stops it being
  phantom, doesn't fix the underlying `tsx`-resolver interaction) or migrate the other scripts to
  `process.loadEnvFile()` the same way this feature's script did (removes the dependency entirely,
  the more durable fix). Not urgent — every script that hits this today has a documented workaround
  (pre-export `DATABASE_URL`/`DB_URL` before running, which the project's own script-running
  convention already recommends) — but worth closing before the next script picks up a `@/`-aliased
  import and rediscovers this the hard way. See `docs/work-log/2026-09-28-public-form-spam.md`
  (Phase 4 Revision 2, "Deviations" #2, and Phase 5 Revision 2 section 4a) for the full reproduction.

- [ ] **B-75 — `financial-report-send.ts`'s `not_delivered` case writes the same message for both
  `blocked_non_production` and `dev_no_api_key`, so the panel can't tell an admin which one
  actually happened.**
  (added 2026-09-25, from the B-73 follow-up sweep,
  `docs/work-log/2026-09-25-bulk-send-success-columns.md`; priority: nice-to-have, small) In
  `sendMonthlyFinancialReport()`'s `switch (sendResult.outcome)` (`src/lib/financial-report-send.ts`,
  the `case "not_delivered":` block around line 636), the inserted `financialReportSends` row and
  the returned `{ reason: "blocked_non_production", detail }` both always use the single
  `blockedError` string — `"Blocked — outbound email is disabled outside production
  (EMAIL_DEV_ALLOWLIST). Nothing was delivered."` — regardless of whether
  `sendResult.reason` (a real, already-typed field on `DurableSendOutcome`, see
  `src/lib/email-durable-claim.ts`) is actually `"blocked_non_production"` or `"dev_no_api_key"`.
  The two reasons are meaningfully different for a developer debugging a dev/QA environment — one
  means "add yourself to `EMAIL_DEV_ALLOWLIST`," the other means "no `RESEND_API_KEY` is set at
  all" — but today's message always suggests the allowlist fix even when the real problem is a
  missing key. B-73's new shared helper, `src/lib/durable-claim-row.ts`'s
  `durableOutcomeToRow()`, already makes exactly this distinction (it has two separate message
  constants, one per reason) for its two call sites (`dues_reminders`, `event_announcements`); this
  item is bringing `financial-report-send.ts`'s pre-existing, untouched inline `switch` up to that
  same precision, once that file is next legitimately open — not folding it into
  `durableOutcomeToRow()` itself, since `financial_report_sends` has a stricter invariant (a
  partial unique index on `success = true`) and its own established inline pattern that Phase 2/3
  of B-73 both explicitly ruled out-of-scope to touch. Fix: branch on `sendResult.reason` and use
  `durable-claim-row.ts`'s two existing message strings (or copy them) instead of the single
  `blockedError` constant. No schema change. Small enough this likely doesn't need a full Phase 1,
  but per this project's Bug-Fix Variant, it still gets a documented root-cause note and an
  explicit phase-skip notation in whatever work-log picks it up.

- [ ] **B-74 — The generic email-queue retry route has no awareness of any durable-claim table it
  doesn't own, which can re-open the exact double-send risk the claim exists to prevent.**
  (added 2026-09-25, from the 7-day test-coverage review, `docs/reviews/2026-09-25-test-coverage.md`;
  priority: should-do, needs a real Phase 1) `src/app/api/admin/email-queue/retry/route.ts` retries
  any `email_queue` row with `status = 'failed'`, with no join to and no awareness of
  `ledger_acknowledgments`, `financial_report_sends`, `dues_reminders`, or `event_announcements` —
  the durable "this was sent" tables DECISION-102 names. Each of those tables independently decides
  "sent" vs. "not sent" once, at the original send attempt, and — by design — leaves a failed
  attempt re-sendable from its own feature (`ledgerAcknowledgments.sentAt` reverts to null on
  failure; `financialReportSends`' partial unique index only ever covers a successful claim). If an
  admin instead retries the same underlying row from the generic `/admin/email-queue` screen and it
  succeeds, the message is actually delivered while the domain table's own claim is untouched — a
  human looking at the ack-letters or financial-reports screen sees "not sent" for something that
  already went out, and clicking "send" again there creates a genuine second delivery. For
  `dues_reminders`/`event_announcements` the consequence is milder but still real: the "last
  reminded"/"already announced" badge stays permanently wrong in the understating direction.
  Established by reading code across module boundaries (retry route confirmed to touch only
  `email_queue`; ack-letter and financial-report revert/re-attempt logic confirmed by their own
  test suites) — not reproduced live. Needs a real Phase 1: should the retry route look up and
  update any linked durable claim on success? Should a claim-bearing `email_queue` row be excluded
  from the generic retry UI and only retryable from its own feature? Recommended regression test
  once designed: send via a durable-claim caller such that it fails (claim reverts, `email_queue`
  row lands `failed`) → retry that row via the admin route → mock the retry as a Resend success →
  assert the claim table's own state, before and after the fix.

- [x] **B-73 — `dues_reminders` and `event_announcements` read `sendBulkMemberEmail()`'s raw
  `.success` directly, the exact pre-DECISION-102 pattern, and were never migrated to the new
  durable-claim helpers.**
  (added 2026-09-25, resolved 2026-09-25 —
  `docs/work-log/2026-09-25-bulk-send-success-columns.md`) Fixed: both routes now go through
  `sendBulkMemberEmailForDurableClaim()` and a new shared helper, `src/lib/durable-claim-row.ts`,
  mapping the exhaustive `DurableSendOutcome` to an honest `{success, error}` row — a
  `not_delivered` (blocked or no-API-key) send now records `success: false` with a distinguishing
  reason, never a false `success: true`. No schema change; no wire-shape change to either route's
  JSON response. `dues/reminders/route.test.ts` created (10 tests, this route had none before);
  `events/[id]/announce/route.test.ts` extended (3 new tests) plus its existing mocks migrated to
  the new entrypoint. Original text preserved below for context.
  `src/app/api/admin/dues/reminders/route.ts` and
  `src/app/api/admin/events/[id]/announce/route.ts` both write `success: result?.success ?? false`
  into their durable per-recipient table straight off `sendBulkMemberEmail()`'s result.
  `SendBulkMemberEmailResult` now forwards `blocked`/`notAttempted` (DECISION-103), so `success:
  true` is returned — and written to the durable table — for a blocked-non-production or
  no-API-key send. Since `sendBulkMemberEmail()` unconditionally sets the bulk guard, every
  dev/QA test of either feature against real member/board addresses hits the blocked path,
  guaranteeing a false `success: true` row the next time either is manually tested outside
  production. Missed by 2026-09-25's own "hunt for a third instance"
  (`docs/work-log/2026-09-25-email-silent-success.md`) because that audit was scoped to "who writes
  `emailQueue.status` directly" (correctly clearing these two files of *that* defect) and never
  asked the separate caller-layer question DECISION-102 rule 2 poses. `dues/reminders/route.ts` has
  no test file at all; `events/[id]/announce/route.test.ts` exists (18 tests) but no test passes
  `blocked: true`/`notAttempted: true` through the mocked `sendBulkMemberEmail()`. Fix: migrate
  both routes to `sendBulkMemberEmailForDurableClaim()` (`src/lib/email-durable-claim.ts`), matching
  DECISION-103's two existing migrations — the type has no bare `success` field, making this exact
  mistake uncompilable. Implementer: api-developer.

- [ ] **B-72 — A permanent send failure is indistinguishable from a transient one in the retry UI.**
  (added 2026-09-25, from `docs/work-log/2026-09-25-shared-resend-attempt.md` Phase 6; priority:
  should-do, needs a real Phase 1) `attemptResendSend()` returns a `retryable` flag classifying the
  Resend error as permanent (revoked key, invalid from-address, validation error) or transient
  (rate limit, transport). `sendEmail()` uses it to skip wasted in-request retries. The email-queue
  retry route **receives it and discards it** — `.retryable` appears nowhere in that route. So an
  admin retrying a message that can never succeed sees exactly the same `failed` + `nextRetryAt`
  outcome as one that merely needs a moment, with nothing to tell them apart. They can retry a
  revoked-key failure indefinitely and learn nothing.
  This predates the B-68 extraction (the retry route never classified at all); B-68 deliberately
  preserved the asymmetry because a behaviour-identical refactor should stay behaviour-identical.
  Resolving it is a **UX and scheduling decision** — should a permanent failure be labelled, hidden
  from bulk retry, or block retry entirely? — so it needs a genuine Phase 1, not a cleanup pass.

- [ ] **B-71 — `listReadyToSendReports()` recomputes every already-`sent` month forever; no skip-window.**
  (added 2026-09-25, from QA's Phase 5 review of the ready-to-send-badge feature,
  `docs/work-log/2026-09-25-ready-to-send-badge.md`; priority: should-do, not urgent today)
  `listReadyToSendReports()` (`src/lib/financial-report-send.ts`) walks every month from
  `CUTOFF_MONTH` through each entity's latest open month on **every call**, recomputing a full
  `MonthlyStatement` via `getMonthlyStatement()` for each one — roughly **15-16 sequential DB round
  trips per (entity, month)** (two full `getFundReport()` calls, each 6 sequential queries, plus
  gating checks). There is no skip for a month whose `state` is already `"sent"`. QA's numbers:
  ~30 round trips/render at 1 elapsed month, ~360 at 12 elapsed months, ~720 at 24 — and this now
  runs on **every admin page render** for a `FEATURES.LEDGER_REPORT_SEND` holder (not just on
  `/admin/ledger/reports`), because B-69 moved the count into the admin layout for the nav badge.
  QA's assessment: this plausibly degrades the whole admin area within about a year of ship, for
  any admin/treasurer account, regardless of how promptly statements are sent — the range only
  grows, month over month, forever.

  **Immediate stopgap already shipped** (same work-log, this task, 2026-09-25): a 2-minute
  module-level TTL cache around `getReadyToSendReportCount()` specifically
  (`getReadyToSendReportCountCached()`), used only by the admin layout's badge fetch. This bounds
  *how often* the expensive walk runs (at most once per 2 minutes per server instance, instead of
  once per page render) but does **not** bound its *size* as the calendar advances — the walk
  itself still gets slower every month, just less frequently paid for. `listReadyToSendReports()`
  itself (the Reports page panel, and re-validated fresh inside `sendMonthlyReportToBoard()`)
  remains deliberately uncached and exact — this backlog item must not touch that guarantee.

  **The real fix is a product decision, not just an optimization.** The tempting fix — skip
  `getMonthlyStatement()` entirely for any month already `state: "sent"` — doesn't work as stated,
  because detecting `state: "corrected"` (a books correction made to an already-sent month)
  *requires* recomputing that month's fingerprint to compare against the stored one. Skipping
  sent months entirely would silently stop catching corrections to old months. The likely shape is
  a **trailing window**: only recompute-and-compare the last N elapsed months (e.g. 2-3) for
  possible correction, and treat anything older that's already `sent` as settled without
  recomputation. That means choosing N — i.e., deciding **how far back a books correction can
  still be caught and re-flagged as "corrected, needs resend"** — which is a policy call for
  whoever owns the treasury workflow, not something to pick unilaterally inside a performance fix.
  Needs Phase 1 (analyst) before implementation: what's an acceptable correction-detection window
  in practice, and does it ever need to be reopened wider (e.g. during an audit)?

  **Forcing function (added 2026-09-25, on analyst's Phase 6 recommendation):** this item has a
  *deadline*, not just a priority. Act on it when the walked range reaches **~6 months past
  `CUTOFF_MONTH` (i.e. by 2026-03)**, not when a slowdown becomes visible — by then the admin area
  is already degraded for every `ledger.report_send` holder. **The 30-day Code review must check
  this item explicitly each cycle** and report the current walked-month count. This forcing
  function exists because 2026-09-25 produced six same-shaped defects whose common thread was a
  correct diagnosis sitting in a document nobody re-opened on schedule; a well-specified backlog
  entry alone was judged insufficient for this one.

- [x] **B-70 — No type/lint enforcement that a durable-claim caller checks `SendEmailResult.blocked`.**
  (added 2026-09-25, resolved 2026-09-25 — see DECISION-103, `docs/work-log/2026-09-25-send-result-type.md`,
  Phase 6: SHIP WITH NOTES) DECISION-102
  requires any caller writing a durable, hard-to-reverse "this was sent" claim to branch on
  `sendEmail()`'s full three-way outcome (delivered / failed / blocked), not on the boolean
  `success` field alone — `blocked` is optional on `SendEmailResult` and nothing today stops a new
  caller from reading `success` alone and repeating the financial-report false-claim defect
  (fixed 2026-09-25) or the still-open B-67. Candidate fixes, in order of preference: (a) a
  discriminated-union return type that removes `success` as a shortcut and forces every caller to
  handle three cases; (b) a second, narrower helper (`sendEmailForDurableClaim()`, or similar)
  with no bare `success` field, reserved for durable-claim callers; (c) a lint rule flagging a
  `.success` read on a `SendEmailResult`-typed value outside `sendEmail()`/`sendBulkMemberEmail()`
  themselves. Until this lands, catching a new violation is review-only — flag it explicitly in
  any future architect/tech-lead review of a feature that persists a "sent" outcome.

  **Extended 2026-09-25 (after the B-67 fix):** a fifth instance of this class was found while
  fixing B-67 — `SendBulkMemberEmailResult` in `src/lib/email.ts` **does not propagate `blocked`
  at all**, so every durable-claim caller routed through `sendBulkMemberEmail()` is structurally
  unable to obey DECISION-102's caller rule even if it wants to. B-67's fix had to work around
  this by reading back each message's persisted `email_queue.status` — correct, and it avoided
  duplicating the guard predicate, but indirect. Propagating `blocked` through
  `SendBulkMemberEmailResult` belongs in this item's scope: the point of the discriminated-union
  redesign is that a caller *cannot* fail to handle the third outcome, and a wrapper type that
  silently drops it defeats that at the first hop.

  **Phase 3 design complete 2026-09-25 — `docs/work-log/2026-09-25-send-result-type.md`,
  DECISION-103.** Chose option (b): a second, narrower helper pair
  (`sendEmailForDurableClaim()` / `sendBulkMemberEmailForDurableClaim()`, new file
  `src/lib/email-durable-claim.ts`) whose return type has no bare `success` field at all, rather
  than rewriting `SendEmailResult` everywhere. `sendEmail()`/`sendBulkMemberEmail()` keep their
  exact existing contract (DECISION-085 holds, the 17+4 guardrail tests are untouched); the other
  ~16 call sites see zero churn. `SendBulkMemberEmailResult` gains the `blocked` propagation this
  extension asked for, plus a further fix found during design: a `notAttempted` field for the
  `dev_no_api_key` path, a sixth latent instance of the same defect shape that neither `blocked`
  nor B-67's read-back workaround covered. The two known durable-claim callers migrate to the new
  functions; the ack-letter DB read-back workaround is deleted, not just pinned. Implementer:
  api-developer. Does not absorb B-68 (separate layer, separately filed).

- [x] **B-67 — A blocked (non-production) send still satisfies the acknowledgment-letter claim.**
  (added 2026-09-25, found while fixing the same defect in `financial-report-send.ts`; priority: should-do)
  `emailAcknowledgmentLetters()` in `src/lib/ledger-acknowledgment-letter-queries.ts` claims the
  acknowledgment atomically **before** sending and reverts only when every address genuinely fails. A
  merely *blocked* address (non-production, per DECISION-085) returns `success: true` from `sendEmail()`,
  so `anySucceeded` stays true and the claim sticks — the row records a donor receipt as sent that was
  never delivered, and because the claim is deliberately permanent ("a donor must never receive one
  receipt twice") nobody can re-send it. Same defect class as the financial-report false claim fixed on
  2026-09-25, but with the timing inverted and higher stakes, since the subject is a donor receipt.
  `sendEmail()` now exposes a `blocked?: true` field for exactly this — the fix is to consult it.
  Needs a short design pass first: what *should* "blocked, not delivered, not failed" mean for an
  acknowledgment? Lower-severity cousins: the per-recipient `event_announcements` and `dues_reminders`
  writes record the same inaccuracy but carry no durable claim, so nothing becomes un-resendable.
  **Closed 2026-09-25 — `docs/work-log/2026-09-25-ack-letter-blocked-claim.md` (bug-fix variant, Phases
  1–3 skipped per DECISION-102's existing diagnosis).** `emailAcknowledgmentLetters()` now branches on the
  full three-way outcome: any address genuinely delivered keeps the claim (`emailed`), zero delivered with
  a real rejection reports `failed` and reverts, zero delivered with everything blocked reports a new
  `blocked` status and reverts. Because `sendBulkMemberEmail()` doesn't forward `sendEmail()`'s `blocked`
  field, the fix reads back `email_queue.status` for the batch's own queued rows — a documented,
  caller-specific workaround, not a new general pattern. Analyst Phase 6: **SHIP WITH NOTES** — both halves
  of the invariant hold (verified independently, not just re-read from qa's report); two follow-ups filed
  (soften the `"blocked"` reason copy for a non-technical reader; add a pinning test for the read-back
  workaround's reachability assumption, since nothing today would catch it silently breaking if
  `sendBulkMemberEmail()`'s bulk-guard behavior ever changes). See that work-log's Phase 6 section for the
  analyst's position that B-70 should now gate any *new* durable-claim email caller.

- [x] **B-65 — `sendEmail()` discards the Resend SDK's returned `error` and records the send as `sent`.**
  (added 2026-09-25, from `docs/work-log/2026-09-25-email-silent-success.md`; priority: **high — this is the
  bug that caused the 2026-08-28 → 2026-09-25 outage**) Resend's SDK v6 returns `{ data, error }` and does
  **not throw** on API errors. `src/lib/email.ts`'s primary send path does `await resend.emails.send(...)`
  and discards the result, then unconditionally writes `status: 'sent'`. So a revoked key (401), an
  unverified domain, an exceeded quota, or a suppressed recipient all resolve normally, `catch` never fires,
  and the queue records a delivery that never happened. This is exactly how ~34 real messages were lost for
  a month with zero failed rows to show for it. The **retry** path was fixed (it now inspects `error`); the
  primary path was deliberately left out of that scope. Fix = check `error` and treat non-null as a failure,
  mirroring what `handleTargetedRetry()` already does.
  **Closed 2026-09-25 — `docs/work-log/2026-09-25-sendemail-unchecked-error.md` (bug-fix variant, Phases
  1–3 skipped, root cause already diagnosed by the task brief).** `sendEmail()`'s primary send loop now
  inspects `result?.error`, classifies it permanent-vs-retryable against Resend's `RESEND_ERROR_CODE_KEY`
  enum, and lands `status: 'failed'` with the real message on any unresolved error — never `sent`. QA
  independently reproduced the pre-fix failure (5/7 new regression tests fail against the stashed pre-fix
  code) and confirmed the fix on the two highest-stakes call sites (acknowledgment-letter claim,
  event-announcement per-recipient rows). See B-68 below for the one follow-up this shipped with.

- [x] **B-68 — Extract a shared `attemptResendSend()` helper for `sendEmail()` and the email-queue retry
  route.** (added 2026-09-25, follow-up from closing B-65, `docs/work-log/2026-09-25-sendemail-unchecked-error.md`;
  priority: should-do) `sendEmail()`'s send loop (`src/lib/email.ts`) and `attemptSend()` in
  `src/app/api/admin/email-queue/retry/route.ts` both now independently implement "a resolved `{ error }`
  from `resend.emails.send()` is a failure, never a success" — the exact decision CLAUDE.md's duplication
  rule targets when the same decision lives in more than one place. The two are not fully identical
  (`sendEmail()` additionally classifies permanent-vs-retryable Resend error codes; the retry route treats
  every failure as retryable-by-admin-click, which is a defensible but undocumented-as-permanent
  divergence) and are currently kept in sync only by hand-written, two-way pointer comments in both files —
  not a build-time guarantee. Proposed: a small `attemptResendSend(resend, params): Promise<{success:true} |
  {success:false, error:string, retryable:boolean}>` in `src/lib/email-guard.ts` or a new
  `src/lib/resend-send.ts`, used by both call sites, folding the permanent/retryable classification in for
  both. Not a correctness bug today (both paths are independently verified correct), so this doesn't block
  anything currently in flight — but the pointer-comment mitigation is exactly the "protected only by
  someone remembering" pattern that let the original B-65/B-66/B-67-class bugs survive.

- [x] **B-66 — A retry stranded at `retrying` is invisible and un-retryable.**
  (added 2026-09-25, from `docs/work-log/2026-09-25-email-silent-success.md` Phase 5 re-verification;
  priority: should-do) The duplicate-send fix claims a row atomically via
  `UPDATE ... SET status='retrying' WHERE id=$1 AND status='failed' RETURNING id` before sending, and
  `settleClaim()` always writes a terminal status. But a JS `try/catch` cannot survive a hard process death
  — a Vercel function timeout, an instance kill, or a deploy landing mid-request. A row left at `retrying`
  is then invisible to **both** retry paths (both require `status='failed'`), to all three sections of
  `/admin/email-queue`, and to the failed-count nav badge: permanently un-retryable and silently uncounted.
  Narrow and low-probability, and strictly better than the duplicate-send hazard it replaced, but it is the
  same *shape* as the bug this whole work-log exists to fix. Proposed fix (from qa): add a `retrying_at`
  timestamp column and fold a staleness reset (`retrying` older than N minutes → back to `failed`) into the
  existing bulk sweep — no new cron infrastructure required, which matters given this project deliberately
  has none.
  **Closed 2026-09-25 — `docs/work-log/2026-09-25-retry-stranding.md` (bug-fix variant, Phase 2 skipped and
  documented).** Added `email_queue.retrying_at`, `RETRY_STALE_MINUTES = 5` (a 30x margin over Vercel
  Hobby's 10-second function cap, verified absent any `vercel.json`/`maxDuration`), and
  `resetStaleRetryingEmails()` called from both the bulk sweep and the `/admin/email-queue` page load, plus
  a read-only fold-in on the failed-count badge — no new cron infrastructure. A stranded row is now visible
  within 5 minutes and self-heals with no manual SQL. Analyst Phase 6: **SHIP WITH NOTES** — invisibility is
  genuinely cured (traced independently); two follow-ups filed (cross-reference the hosting-tier assumption
  from a location a future plan/timeout change would actually touch, not only from `RETRY_STALE_MINUTES`'s
  own file; watch the failed-count badge's independent staleness predicate if a third caller ever needs the
  same check). See that work-log's Phase 6 section for detail.

- [x] **B-69 — No nav-level signal that a financial statement is ready to send to the board.**
  (added 2026-09-25, Phase 6 follow-up from `docs/work-log/2026-09-25-financial-report-auto-send.md`;
  priority: should-do) The board-send feature is deliberately one-click, not literal autosend — the
  treasurer must reconcile (on `/admin/ledger/[fundSlug]`), then separately visit `/admin/ledger/reports`
  and click "Send to Board." Nothing prompts that second visit: no nav badge, no toast on reconciliation
  close, no reminder if a month sits `never_sent` or `corrected` for a week. The admin sidebar already
  grew exactly this kind of signal today for a different silent-state problem
  (`failedEmailCount` in `src/components/admin/admin-sidebar.tsx`, wired in
  `src/app/(dashboard)/admin/layout.tsx`) — the same pattern (a cheap count query, gated on the same
  permission that gates the action, `formatBadgeCount`-capped) would close this gap: a small "N ready to
  send" badge on the Ledger/Reports nav entry, visible only to `LEDGER_REPORT_SEND` holders, computed from
  `listReadyToSendReports()`'s existing `never_sent`/`corrected` count. Without it, the honest risk is that
  the treasurer reconciles monthly but doesn't habitually revisit the Reports page afterward, and the
  board simply doesn't get statements — the exact failure mode "autosend" was meant to prevent, now
  reintroduced one layer up as "remember to click."

- [ ] **B-64 — Persist `replyTo` on `email_queue` so a retried send keeps it.**
  (added 2026-09-25, from `docs/work-log/2026-09-25-proposal-board-email.md` Phase 5;
  priority: should-do) `SendEmailOptions` accepts `replyTo` and passes it to Resend on the
  first attempt, but `email_queue` has no `reply_to` column and `sendEmail()`'s insert never
  stores it. The retry route (`src/app/api/admin/email-queue/retry/route.ts`) re-sends the
  persisted row directly, bypassing `sendEmail()` — so a retried message silently loses its
  Reply-To and lands back at `noreply@`. This is the same failure shape DECISION-092 fixed for
  attachments (persisted in `email_queue.attachments` precisely because the retry path bypasses
  `sendEmail()`); `replyTo` was never given the same treatment. Pre-existing and shared: at least
  6 `sendEmail()` callers set `replyTo` today, including the proposal board notification, and all
  of them inherit the gap. Fix = add a `reply_to` column (idempotent migration + `schema.ts`),
  persist it on insert, and forward it from the retry route.

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

  | Duplicated | 2026-08-12 | 2026-09-10 |
  |---|---|---|
  | `process.env.RESEND_FROM_EMAIL ?? "noreply@westervillelions.org"` | 12 | **15** |
  | Hand-rolled HTML escaper | 6 | **4 implementations in 2 disagreeing shapes** |
  | `NEXTAUTH_URL` fallback for building links into emails | 8 | **19** |

  **This is growing while the item sits open.** Re-counted by the 2026-09-10 code review:
  the from-address is up 12 → 15 and the app-URL fallback 8 → 19, in a month. The escaper
  count fell only because a shared module was built to absorb them — and then four copies
  survived it, in two shapes that disagree with each other.

  **It has already produced one real defect.** Of those 19 app-URL sites,
  `src/app/api/auth/forgot-password/route.ts` had *no fallback at all* — a bare
  `${process.env.NEXTAUTH_URL}`. With the env var unset, the password-reset email would
  have carried a literal `undefined/reset-password?token=…` link, locking the recipient out
  with nothing to explain why. Fixed in place 2026-09-10, but that is the second time this
  cluster has produced a bug caught by luck rather than structure (the first being the
  omitted escaper below). The remaining 18 sites still use at least three different shapes,
  including `?? ""`, which yields a relative URL that is broken inside an email.

  Adjacent, same root cause, found by the same review: **37 files carry a local date
  formatter, 13 of them byte-identical** — several written specifically to work around the
  naive-timestamp-as-UTC bug this project has now hit four times (DECISION-001,
  DECISION-015, the 2026-08 meeting-schedule import, and `ack-queue.tsx` on 2026-09-10).
  Thirteen independent copies of the same correct workaround is thirteen chances to write
  the incorrect one, and it happened at least once.

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

  **Update 2026-10-01 (DECISION-106):** the reimbursement-route half is folded into
  `docs/work-log/2026-10-01-reimbursements-no-board-approval.md` Phase 3 (a new `route.test.ts` for the admin
  reimbursement `[id]` route asserts the CC on rejected/paid and the tolerant no-CC path, and the submit route gets
  its own test). The reimbursement `approve` CC site no longer exists, so the existing-site count is **four**, not
  five: two in the reimbursement route (rejected/paid) and the two `LEDGER_APPROVE`-approver-loop notifications in
  `src/app/api/admin/ledger/transactions/route.ts`. The two transactions-route sites remain open under this item.

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

- [ ] **B-128 — Consider retiring the aged public-fund guardrail entirely.**
  (added 2026-10-02 from the treasurer's sign-off on DECISION-105)
  On signing off the oldest-first reading the treasurer said the check "can probably just go away". It now only fires
  for money genuinely parked past the holding period (e.g. a dormant opening-balance-only fund), which the Treasury
  guide already tells the treasurer to sweep. Decide at the next ledger touch: delete the flag, the `holdingPeriodWarnDays`
  setting and its guide rows, or keep it as info-severity. If deleted, DECISION-027/028/105 get a superseding note and
  B-79/B-80 close as moot. Priority: low.

- [ ] **B-127 — Bank-account PATCH re-verifies "not matched" under a lock.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md`; DECISION-112)
  The match route (v1.87.0, B-105) re-verifies under `FOR UPDATE`, but the bank-account PATCH still has a read-then-write
  against reconciliation; the close-time refusal is the only backstop. Re-select the row `FOR UPDATE` inside the PATCH
  transaction and re-check "not matched in an open session" before writing. Optional with it: make the close-refusal toast
  list the offending entries, not only the message. Priority: low.

- [ ] **B-114 — Fiscal-year close.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-7; audit priority P2; audit top-10 rank 9)
  An explicit "close FY" that soft-locks prior-year transactions (edits and deletes then need `ledger.manage` plus a reason, audited), gated on a checklist (all months reconciled, all statements sent, acknowledgments sent). Reversible by a manager with a reason. Today there is no concept of "FY2026 is done": prior-year rows stay editable by `ledger.record`, and the only lock is the budget approve-and-lock. Resolves B-97's inconsistent record-versus-manage gate for prior-year deletes. Pairs with B-123 (the archive export) and B-113 (the start-of-year flow checks it). Audit rows E2, C4.

- [ ] **B-123 — Complete read-only year export.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-15; audit priority P2)
  A CSV or ZIP per fiscal year with every ledger column (check number, bank account, donor, budget line, receipt reference, reconciliation session), the donor and acknowledgment list, receipts, and sent letters, for the audit committee and the successor. Fixes the current transactions CSV's omissions (no donor, check number or bank-account columns; no donor-level export for Schedule B). Pairs with B-114. Audit rows D6, E3, C4.

- [ ] **B-118 — Donor merge.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-11a; audit priority P2)
  Pick a survivor, re-point transactions and acknowledgments, union emails, audit it; refuse if both donors have sent letters unless the treasurer confirms. Today merging is impossible: the only option is hard delete (manage), which sets transaction and acknowledgment FKs to NULL, and re-linking is manual. Audit row D3.

- [ ] **B-119 — Undo "Mark sent" on an acknowledgment letter.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-11b; audit priority P2)
  With a reason, audited, using the durable-claim helpers (DECISION-102/103); **never a bare `sentAt = null`**. Today there is no unmark action and regenerate is refused after `sentAt`, so a wrongly marked letter is fixed in SQL. Because it reverses a durable "this was sent" claim, it falls under the Bug-Fix Variant's durable-claim exception: no Phase 2 skip and no abbreviated Phase 3, and it must not ride along with an unrelated change. Related: B-70, B-73, B-47 (no bounce visibility; the UI must keep saying "Emailed", never "Delivered"). Audit row D4.

- [ ] **B-121 — Roster import UI.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-13; audit priority P2; the broken-scripts half is filed separately as B-125)
  Upload the LCI roster CSV, show a dry-run diff (add, update, deactivate), then apply; replaces `sync-roster.ts` and `import-roster.ts`. Dues cohorts depend on an accurate roster, and today the annual refresh is a script run by a developer. Do not build this on the existing scripts' linkage logic (see B-125). Must route through the same `isActive`/`membershipStatus` derivation as the rest of `src/lib/members.ts`, and must not write personal data into the repo. Audit row Y12.

- [ ] **B-116 — Reconciliation input flexibility.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-9; audit priority P2)
  Edit an open session's period and balances (no PATCH exists; today a typo means Discard and recreate, and a closed session needs Reopen then Discard under manage); replace the CSV in an open session (one upload per session today); make the bank-statement parser pluggable. Chase format is the only parser, so a bank change is a developer task: this moves from "fine" to "blocker" if the club changes banks (audit open question 3). Related: B-22 (batch-match correction), B-23 (auto-suggest a batch match). Audit rows M11, M13.

- [ ] **B-124 — Compliance filing editing.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-16; audit priority P3)
  A UI for the existing filing-metadata PATCH (agency, title, due date; the API exists with no UI caller) and the `N/A` status, which cannot be set today. Audit row C2.

- [ ] **B-117 — Dues "Mark Paid" should ask the payment method.**
  (added 2026-10-01 from `docs/reviews/2026-10-01-treasurer-self-sufficiency.md`, NEW-10; audit priority P3)
  The Mark Paid button hard-codes method `zeffy` even for a check. Ask the method, or default from the member's last payment. Small. Related: B-97 (deleting through the register orphans the dues link). Audit row M18.

- [ ] **B-100 — "Moved from Administrative" marker (and optional History) in the register.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109/110/111)
  Phase 1 Flow 1 step 8 promised the Activity register would show the moved gift with a note; only the compliance page shows it today. Needs a batched lookup on `ix_ledger_audit_log_transaction` for the rows on the page; a moved row later deleted detaches (FK is `ON DELETE SET NULL`), which is acceptable. Suggestion-grade, not a defect.

- [ ] **B-101 — Sent-statement warning covers only the row's own month.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109/110/111)
  The One-Month column buckets reconciled rows by bank-cleared date and the Twelve-Month column by `txnDate`, so a move or delete can change a sent statement for a different month (the bank-clear month, or any later month whose twelve-month window includes the entry). The "Resend Corrected Statement" panel is read-side and still flips correctly, so nothing drifts silently; only the up-front warning under-reports. Either widen `findSentStatementMonth()` to "any successful send whose window includes this entry" or soften the sentence to "statements already sent that include this entry will read as changed." Low.

- [ ] **B-102 — Sweep prefill memo date.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109/110/111)
  The prefilled memo says "moved from Administrative on <date>" using the UTC date of the page load (`nowIso.slice(0, 10)`), which can read as tomorrow after about 8 pm Eastern, and it says "moved" even if a hand-built `sweepFrom` link names a row that was never moved. Use the move's audit date (or drop the date). Very low; the treasurer edits the memo anyway.
  **Update (2026-10-01, Phase 3 of the cross-entity work-log):** addressed by the cross-entity increment (DECISION-113 item 7): the memo takes its source label and date from the move's audit row and makes no "moved" claim when there is none. Close this item when that increment ships.

- [ ] **B-103 — DOM component-test harness.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-109/110/111)
  The dialogs' state machines (stay open on a failed delete, refresh only on Done) are asserted through pure helpers and source checks. A jsdom plus testing-library setup would be a dependency decision; only worth it if more dialog-heavy features follow.

- [ ] **B-104 — Club-to-Foundation move (the mirror direction as a move).**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md` as B-next-B; DECISION-112)
  Deferred. The cell is denied as its own branch (`club_to_foundation_not_supported`). Today's answer is delete the Club entry and enter the gift on the Foundation's register (B-98). Revisit only if the treasurer hits a case delete-and-re-enter cannot serve. Conditions if it is ever enabled: it lands in the Foundation's Charitable fund on a **picked Foundation account**; `LEDGER_MANAGE`; a **board-minute reference required** (otherwise it bypasses the sweep's gate); a new Foundation acknowledgment becomes available on the moved row; and the mutual-exclusion test needs one named, tested exemption for that single cell (it would put one pair in both policies). Extends B-96.

- [ ] **B-106 — Tighten the acknowledgment issuer column.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md` as B-next-D; DECISION-112)
  After one release (the migration and the move have stamped every row), set `ledger_acknowledgments.donee_entity_id NOT NULL` and drop the COALESCE fallback in `ackDoneeEntityId`; assert in a test that every acknowledgment writer sets it. Optional: show "Receipt issued by <issuer>" in the donor giving history (`getDonor()`).
  **Amendment (2026-10-01, Phase 6 of the cross-entity work-log):** Enumerate every writer of `ledger_acknowledgments`, including `scripts/*.ts` and raw SQL (today `scripts/close-out-historical-acknowledgments.ts` inserts without `donee_entity_id`), and either stamp it or delete the script, before setting `NOT NULL`.

- [ ] **B-107 — Duplicate-candidate warning cannot see a bundled deposit.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-cross-entity-transaction-move.md` as B-next-E; reworded by the Phase 3 design, ruling X12; DECISION-112)
  The cross-entity move's advisory (same amount, income, posted, within 30 days in the destination entity, cap 5) ships in the first increment. What remains is the case it cannot detect: a Foundation gift that was deposited **together with other money** in one Club deposit, or recorded on the Club side as a lump, has no single row of the same amount. Revisit if the treasurer reports a double count; options are a matched-deposit lookup through the Club's reconciliation bank lines or a manual "this was already recorded" acknowledgment in the dialog. If the advisory is cut from the first increment for size, this item becomes the whole feature.

- [ ] **B-97 — Dues-synced row deletion and the fiscal-year delete gate.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-110)
  Deleting a dues-synced ledger row through the register orphans the dues payment's ledger link, `syncDuesDelete`
  hard-deletes with no audit row, and a prior-fiscal-year DELETE is gated at `LEDGER_RECORD` (the move requires
  `LEDGER_MANAGE` for the same row). The new delete snapshot at least records `duesPaymentId`. Priority: low.

- [ ] **B-95 — Migrate the seven existing `insert(ledgerAuditLog)` sites to `recordLedgerAudit()`.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; DECISION-110)
  Two in the transaction PATCH route, and one each in the acknowledge route, `reconciliation-queries.ts`,
  `ledger-category-queries.ts` (two) and `ledger-acknowledgment-letter-queries.ts`. DECISION-110 introduces the
  helper for the new move and delete writers only; widening its typed action map to cover the existing actions
  removes the last hand-rolled inserts. Pure refactor. Priority: low.

- [ ] **B-94 — Consolidate duplicated ledger transaction guards.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-move-or-cancel-transaction.md`; duplication rule)
  (a) Category-versus-fund-kind-and-flow validation has three inline copies (`transactions/route.ts` regular POST and
  `handleTransfer`, and `[id]/route.ts` PATCH); the move uses the shared helper in
  `src/lib/ledger-transaction-validation.ts`, and these three should migrate onto it (the helper already carries
  each copy's exact message and status). (b) The approved / rejected / reconciled / transfer guard set, repeated in
  PATCH, DELETE, split and move, should sit on the classifier in `src/lib/ledger-transaction-lock.ts`, preserving
  DECISION-099 item 4's ordering for the donor-link carve-out. (c) The Radix Dialog chrome in
  `split-transaction-dialog.tsx` and `transaction-form-dialog.tsx` should move onto `LedgerDialogShell`. Priority: low.

- [ ] **B-88 — Reimbursements admin page does not clamp an out-of-range `?page=`.**
  (added 2026-10-01, Phase 6 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106)
  `/admin/ledger/reimbursements?tab=paid&page=99` shows "No paid reimbursements yet." and "Showing 4901–56 of 56
  requests." with a Previous link to page 98. Fix: when `total > 0` and `offset >= total`, redirect to the last page
  (`ceil(total / 50)`). Reachable only by editing the URL, or by paying the last row of a second page on an Awaiting
  queue larger than 50. Priority: low.

- [ ] **B-90 — The UUID-shape check is defined three times.**
  (added 2026-10-01 from Phase 6 of `docs/work-log/2026-10-01-discard-reconciliation-session.md`; duplication rule)
  `isUuid()` in `src/lib/utils.ts` (added for the discard route) duplicates `UUID_RE` in `src/lib/ledger-queries.ts`
  and in `src/app/api/admin/ledger/budget-context/route.ts`. Migrate the two older copies to `isUuid()` and delete
  them; then grep `src/` for any other inline `[0-9a-f]{8}-[0-9a-f]{4}` pattern. Pure refactor, no behaviour change.
  Priority: low; take it with the next Ledger touch.

- [ ] **B-84 — Consolidate the reimbursement $10,000 ceiling into one exported constant.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106)
  `AMOUNT_MAX = 1_000_000` (cents) is copied in `src/app/api/members/reimbursements/route.ts`,
  `src/app/api/members/reimbursements/[id]/route.ts`, and the client form (`max="10000"` plus two copy strings).
  Three copies of one rule; export a single `REIMBURSEMENT_MAX_CENTS` (client-safe home, e.g. `src/lib/ledger.ts`)
  and derive the form copy from it. Priority: low. Note it is a typo guard, not a policy threshold; whether the
  board wants a real ceiling is a separate decision (DECISION-106, accepted risk).

- [ ] **B-85 — Ledger transactions created by a reimbursement carry no marker back to it.**
  (added 2026-10-01, Phase 2 of `docs/work-log/2026-10-01-reimbursements-no-board-approval.md`; DECISION-106)
  The link only runs reimbursement -> transaction (`ledger_reimbursements.ledger_transaction_id`); a reimbursement's
  posted expense is indistinguishable in the register from any other expense. If the board wants to filter or
  flag reimbursements in the register, add a reverse marker (column or derived join). Priority: low; revisit
  after B-83 ships and the board says whether the Paid tab and report are enough.

- [ ] **B-86 — Transactions created from a reconciliation bank line carry no marker back to it.**
  (added 2026-10-01, Phase 1 and 3 of `docs/work-log/2026-10-01-discard-reconciliation-session.md`; DECISION-108;
  same family as B-85) `create-from-bank-line` inserts a real `status = 'posted'` row into `ledger_transactions`
  plus a match link, and nothing on the transaction records that it came from a bank line. When a reconciliation
  session is discarded the match link is deleted with it, so such a transaction becomes indistinguishable from any
  other posted row, and the discard dialog can only warn generically ("any transaction you created from a bank
  line stays in your books") rather than say "3 transactions you created will stay" and link them. In the
  treasurer's own scenario (a session opened against the wrong account) those rows are on the **wrong** bank
  account and must be found and deleted by hand, because a transaction's bank account is not editable after
  creation. Idea: a nullable marker on `ledger_transactions` (for example `created_from_bank_line_id`, or a
  `source` value) set by that route, so the dialog can count and list them and the register can filter them.
  Priority: low; revisit if a discard on a session with created transactions is ever done by mistake, and decide
  alongside B-85 so the two transaction-provenance markers share one shape.

- [ ] **B-81 — Stranded `pending` email-queue rows are invisible on the Email Queue page and the nav badge.**
  (added 2026-10-01, from Phase 1 of `docs/work-log/2026-10-01-email-queue-retention.md`; DECISION-107)
  `sendEmail()` inserts a row at `status = 'pending'` and later writes a terminal status; if the process dies
  between the two (a Vercel timeout, an instance kill, a deploy landing mid-request) the row stays `pending`
  forever. `/admin/email-queue` shows only `failed`, `blocked_non_production` / `dev_no_api_key` and `sent`;
  the sidebar badge (`getFailedEmailCount()`) counts only `failed` and stale `retrying`; both retry paths
  require `status = 'failed'`. A stranded `pending` row is therefore invisible and un-retryable, the same shape
  as the `retrying` stranding fixed under B-66 (`resetStaleRetryingEmails()`). DECISION-107's purge cleans such
  rows at six months, but one stranded for an hour is as invisible as one stranded for a year. Fix shape to
  decide in a Phase 1: a "Stuck pending" section and/or fold stale `pending` (older than a threshold, comfortably
  longer than a request can live, cf. `RETRY_STALE_MINUTES`) into the badge count; and whether such a row should
  be recoverable (reset to `failed` so the existing retry paths can pick it up) or merely surfaced, which matters
  because a `pending` row may in fact have been sent (the process may have died after the Resend call), so a
  blind retry could duplicate a delivery. Same family as B-66 and B-74.

- [ ] **B-79 — Let the treasurer record an earmark on a public fund so a deliberate multi-year hold stops tripping the aged-fund warning.**
  (added 2026-10-01, Phase 1 of `docs/work-log/2026-10-01-aged-public-fund-fifo.md`; DECISION-105)
  The aged public-fund guardrail (after the FIFO fix) only ever tells the treasurer to "document the
  project and expected disbursement date in the board minutes", and that documentation lives nowhere the
  guardrail can see. Add a per-fund (or per-amount) earmark: project name, earmarked amount, expected
  disbursement date, optional minutes citation. The guardrail would then subtract the earmarked amount from
  the aged portion, and show earmarked-but-overdue holds distinctly. Needs a Phase 1 of its own: who may
  create one (board action vs treasurer), whether it expires, and how it interacts with the audit log.

- [ ] **B-78 — Time-of-day / duration fan-out for same-title sibling events (bulk-edit).**
  (added 2026-09-29, deferred from Phase 1 of
  `docs/work-log/2026-09-29-bulk-edit-same-title-events.md`, carried through Phases 2–5 as an
  explicit "must not be silently dropped" note without ever being filed here — filed now in
  Phase 6; priority: fast-follow, only once actually needed) The shipped "apply to other
  upcoming same-title events" fan-out (`EVENT_SIBLING_FAN_OUT_FIELDS` in `src/lib/events.ts`)
  deliberately excludes start time-of-day and duration/end-time. `events.startDate`/`endDate`
  are single naive wall-clock timestamp strings with no separate time-of-day column
  (DECISION-005), so fanning out "the new start time" is not a flat `SET col = value` —
  per sibling row it means keep that row's own calendar date and replace only its time
  component, then reapply the edited event's new duration to derive a new end time. That is
  real per-row decompose/recompose logic, and this project has a recorded incident of exactly
  this class of bug (`project_naive_timestamp_tz_bug` — a naive timestamp read as UTC, meetings
  displaying hours off). Build this only when an admin actually needs to retime a whole
  schedule at once (e.g. "Board Meeting moves from 7:00 PM to 7:30 PM starting next month"),
  and design the per-row date-preserving time replacement explicitly, reusing
  `parseWallClock()`/`nowEastern()` rather than inventing new date math. Not urgent today — the
  shipped v1 flat-field allowlist (`location`, `description`, `isPublic`, `requiresRsvp`,
  `maxAttendees`, `allowGuestCount`, `extraQuestion`, `extraQuestionType`,
  `extraQuestionOptions`, `extraQuestionRequired`) already covers the incident that motivated
  this feature (an admin's "Requires RSVP" edit not propagating across the meeting schedule).

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

- [x] **B-06 — No repair path for a mis-uploaded reconciliation-session
  CSV.** (added 2026-07-21, priority: nice-to-have; **picked up 2026-10-01** →
  `docs/work-log/2026-10-01-discard-reconciliation-session.md`, DECISION-108: the real-world pain arrived
  when the treasurer opened a session against the wrong bank account. **Closed out by a "Discard session"
  action, which is a hard delete of an open session. The blocking rule below ("blocked once any match
  exists") was deliberately NOT adopted:** the treasurer's actual case, a mistake found after upload and
  possibly after matching, is exactly when matches exist, and a match is only a link, so forcing a
  line-by-line unmatch first would recreate the pain this removes. What replaces it is a pin on
  `status = 'open'` inside the DELETE, because `ledger_transactions.reconciled_session_id` is
  `ON DELETE SET NULL` and deleting a closed session would silently orphan the provenance of every
  transaction it cleared. The other half of this item, a "replace statement" / re-upload action, was not
  built; discard-and-recreate covers the pain, so it stays unbuilt unless someone asks.) Original text
  follows. Surfaced during Phase 6 of
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

- [ ] **B-76 — Live public-form spam guard can't protect membership applications from a
  burst-leading/isolated bot submission.**
  *(Raised 2026-09-28, DECISION-104 Revision 2; confirmed as an accepted, tracked residual gap by
  analyst at Phase 6, `docs/work-log/2026-09-28-public-form-spam.md`.)*

  The public-form spam defense (honeypot, timing floor, two-field content-gibberish agreement, and a
  cross-form per-email cooldown) reaches 15 of 16 known-incident junk rows via a combination of
  content detection and a cooldown-reorder that lets an earlier same-email submission protect a
  later one. That reorder structurally cannot help `membership_applications`: in every observed run
  of this bot, membership is submitted *first*, with no earlier same-email sibling in
  `contact_submissions`/`newsletter_subscriptions` to draw cooldown protection from. Content alone
  (the four-signal `isGibberishToken()` score, two independent fields required to agree) catches
  only 1 of 4 known membership junk rows live; an exhaustive threshold search (tech-lead, Phase 3
  Revision 2) could not close the gap further without reopening a real false-positive risk against
  unusual-but-real names. The retroactive purge script *can* recover most of these after the fact
  (cross-table timing correlation, using hindsight the live guard doesn't have), but going forward, a
  repeat of this exact attack pattern will see roughly 3 of every 4 bot membership submissions sail
  through the live guard uncaught, every time — not a one-time historical shortfall.

  **Why this is "Watching," not "Now":** Phase 1's own harm ranking (confirmed by analyst at Phase 6)
  makes this the least-harmful of the three forms to miss — a missed row is one junk `pending`
  application an admin reviews and rejects by hand at `/admin/membership`, the same existing workflow
  used for every application, real or bot. It does not email a harvested stranger (contact's harm,
  now fully closed) and does not add an unwanted newsletter subscriber (newsletter's harm, also fully
  closed). No safe fix exists today without reopening the false-positive risk the whole feature was
  built to avoid.

  **Revisit when:** this residual pattern (bot sends membership-only, no contact/newsletter
  follow-up) becomes the bot's dominant remaining attack shape — e.g., IP-based rate limiting
  (explicitly out of scope for the original feature, Vercel Pro-only) becomes worth revisiting, or a
  new signal specific to the membership form's field shape is found that doesn't compound the
  stress-test false-positive risk already documented in DECISION-104.

- [ ] **B-80 — Aged-fund guardrail resets the clock on inter-fund transfers.** (added 2026-10-01,
  DECISION-105) Old money swept from one fund to another is consumed in the sender and arrives as fresh
  income in the receiver, so the aged-fund warning never sees it; true age-carrying needs lot tracking
  across transfers. Pinned by a unit test; revisit only if the treasurer reports a missed hold.

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

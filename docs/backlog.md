# Backlog

Feature ideas and follow-ups that are agreed-on but not yet started. Items here
have **no work-log entry yet** — when one is picked up, run `/new-feature`, create
its work-log, and check it off here (append date + work-log slug rather than
deleting). Stable `B-nn` IDs for cross-referencing.

This complements (doesn't replace) `treasurer-todo.md`, which tracks books and
compliance follow-ups rather than product features. Phase 6 "SHIP WITH NOTES"
follow-ups may also land here when they don't warrant an immediate work-log.

---

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

- [ ] **B-05 — Reconciliation matching grid shows no preview of what a bank
  line is matched to.** (added 2026-07-21, priority: nice-to-have) Surfaced
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
  Also noted in the same review: **Unmatch's `<ConfirmDialog>` uses
  `destructive` (red) styling** despite Unmatch being a fully reversible,
  low-stakes action (re-matching is one click). Cosmetic nit — recommend
  softening to the non-destructive style next time this component is touched
  (e.g. alongside the B-05 fix above), not urgent enough for its own pass.

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

- [ ] **B-07 — Print support for the Treasury User's Guide.** (added 2026-07-21, priority:
  nice-to-have) The guide page hides its own breadcrumb/TOC when printing, but the shared admin
  sidebar/layout chrome still prints — a `print:hidden` pass on the shared admin layout would let
  the treasurer print the guide cleanly as a handoff document. Small PR touching the shared
  layout; flagged during `2026-07-21-treasury-users-guide.md` Phase 6 (footprint restriction kept
  it out of the feature). Related: the same Phase 6 recommended the next 7-day test-coverage
  review add a seeded narrow-permission test account (e.g., LEDGER_APPROVE-only) — same root gap
  as B-03; noted there rather than duplicated.

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

- [ ] **B-13 — Centralize the ledger payment-method list + labels.**
  (added 2026-07-22, priority: should-do) The expense/ledger payment-method set
  (`check/cash/zeffy/debit_card/bill_pay/other`) is duplicated across three API validators
  (`transactions`, `transactions/[id]`, reconciliation `create-from-bank-line`) and two
  `METHOD_LABELS` dropdown maps — adding "Bill Pay" (2026-07-22) meant editing six places, and the
  reimbursement pay set drifted to a smaller `check/cash/other` list. Hoist one shared const +
  label map into `src/lib/` and import everywhere. While there: the register/fund-detail cell
  (`[fundSlug]/page.tsx` ~L455) renders the raw stored value with CSS `capitalize`, so `debit_card`
  and `bill_pay` show as "Debit_card" / "Bill_pay" — route it through the shared label map too.

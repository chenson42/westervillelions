# Backlog

Feature ideas and follow-ups that are agreed-on but not yet started. Items here
have **no work-log entry yet** — when one is picked up, run `/new-feature`, create
its work-log, and check it off here (append date + work-log slug rather than
deleting). Stable `B-nn` IDs for cross-referencing.

This complements (doesn't replace) `treasurer-todo.md`, which tracks books and
compliance follow-ups rather than product features. Phase 6 "SHIP WITH NOTES"
follow-ups may also land here when they don't warrant an immediate work-log.

---

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

- [ ] **B-01 — Ledger user's guide built into the treasury page.** (added
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

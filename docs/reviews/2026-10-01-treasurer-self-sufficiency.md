# Treasurer Self-Sufficiency Review — 2026-10-01

**Type:** treasurer-self-sufficiency (standalone analysis, not a feature pipeline)
**Owner:** analyst
**Goal (treasurer, 2026-10-01):** "Get this to a place where next year's treasurer will be able to do everything they need to via the web interface."
**State of the code reviewed:** `main` at v1.86.0 (move/delete with audit, discard reconciliation session, treasurer-only reimbursements, email-queue retention).

## How to read this

- **Reader.** "Next year's treasurer" is assumed to be a **non-technical, non-admin volunteer** who holds the `treasurer` role (and, through the Board group, `board_member`) and who cannot run `pnpm`, read SQL, or ask the developer on a Saturday. That assumption drives every severity rating.
- **How today** is one of: **UI** (works in the browser), **UI (needs manage/admin)** (works, but the default treasurer role cannot do it), **script** (a file under `scripts/`), **SQL**, **impossible** (no path at all, including SQL that wouldn't be safe).
- **Severity** for that treasurer:
  - **blocker** — cannot complete the task without a developer, a script, SQL, or an admin they do not have.
  - **annoying** — completable in the UI, but clumsy, risky, error-prone, or silently under-explained.
  - **fine** — works and is understandable.
- **Backlog** is the existing B-nn that already covers the gap, if any. **Proposed** items are labelled **NEW-n** (provisional; you assign real IDs, next free is B-104) with a priority of P0 to P3. Full wording for each NEW item is in the "Proposed backlog items" section so the table stays readable.
- **Method and limits.** Read-only. I read every page and route under `src/app/(dashboard)/admin/ledger/**` and `src/app/api/admin/ledger/**`, the supporting components, all 32 files in `scripts/`, the 13 guide sections, `docs/backlog.md`, DECISION-099 to DECISION-111, and the dues, email-queue, security, users, groups and members surfaces. **I did not query any live database.** Role bindings come from migrations; `/admin/permissions` can change them at runtime, so production may differ from what I state about `ledger.manage` and friends. Items marked "(verify)" rest on code reading only and should be confirmed against production data before being scheduled.

---

## Bottom line

The **monthly** loop (record, reconcile, correct, send the statement) is now almost entirely web-based, and the last two weeks closed the worst correction holes (Discard session, Move, Delete-with-reason, category merge). What stops a successor from running the club's books unaided is no longer feature depth in the register. It is four things around the edges:

1. **A likely reconciliation defect in the newest feature.** Paid reimbursements post a ledger row with **no bank account and no check number**, and stamp it approved-and-locked. The reconciliation matcher only offers rows whose bank account equals the session's account, so those rows can never be matched, and the treasurer cannot edit them to fix that. The workaround (create the expense again from the bank line) would double-count. This is unlisted in the backlog. **(verify against production data first.)**
2. **The default `treasurer` role cannot do much of the treasurer's job.** `ledger.manage` is bound to `admin` only. Reopen a reconciliation, edit a fund, manage categories, change settings, add a compliance filing, waive a receipt, move a reconciled or prior-year entry: all admin-only. The budget page also shows a "+ Add category" button to budget editors that the server then rejects with 403, and the Email Queue link is visible but bounces anyone without `admin.users`. Today's treasurer is presumably an admin, which hides all of this.
3. **No path to change the books' structure.** There is no UI or API to create, rename, deactivate or set the default on a **bank account**, to set a **bank account's opening balance** (the column exists; nothing writes it), to create or deactivate a **fund**, or to edit **entity** details. The guide says "adding an account needs a developer script."
4. **Handover is undocumented and has traps.** The app side of an officer change (the `treasurer` role, the Board "Treasurer" position that `resolveTreasurer()` reads, the hand-typed letter signature) is not in the guide, and if the outgoing treasurer's Board position is not cleared first, "Send to Board" and dues reminders hard-block with a "multiple treasurers" state.

Everything else is "annoying", not "blocked": year-start budget re-entry, no Zeffy import, no donor merge, no fiscal-year close, thin audit coverage, no roster import.

---

## Top 10: what to build first for the handover goal

Ranked by (damage if a successor hits it) x (how soon they hit it) / (effort). Items 2 and 5 are cheap and unlock the rest.

| Rank | Item | One-line rationale |
|---|---|---|
| 1 | **NEW-1** Make paid reimbursements reconcilable and correctable | A monthly task (reconcile) silently fails for every reimbursement check, and the only workaround risks double-counting expenses. Confirm with a read-only query first, then fix at the source (bank account and check number at pay time, plus a narrow carve-out to repair existing rows). |
| 2 | **NEW-4** Treasurer permission baseline | A non-admin treasurer is locked out of reopen, categories, settings, fund edit, filings and reconciled-row moves, and the budget page and Email Queue show controls that 403. Mostly a role-binding decision plus two gating fixes; cheapest high-impact item. |
| 3 | **NEW-3** Officer-handover screen | Replaces a three-page, order-sensitive manual process (role in Users, position in Groups, signature in Letter Template) with one guided "hand over to…" flow that shows who `resolveTreasurer()` currently resolves to and why it might fail. |
| 4 | **NEW-2** Ledger structure admin (bank accounts, opening balances, funds, entity) | Without it, any change to the club's accounts, including the one the bank transition might cause, is a developer task. The bank-account opening-balance column has no writer at all. |
| 5 | **NEW-5** Guide refresh plus checklists | Cheap, and the guide is the successor's only documentation. Fix two stale statements (the removed "Seed from last year" button; "at or above" vs strictly-above threshold), add the missing app-side handover, monthly close, year-start and year-end checklists, and the topics it skips (send to board, categories, dues setup, donors, email queue). |
| 6 | **NEW-6** Start-a-new-fiscal-year flow | Year-start is the successor's first big job and today it is re-typing every budget line by hand, a script for bulk category retirement, and a stale guide pointing at a removed button. Revisit B-37 with the treasurer's reason for removing the old seed. |
| 7 | **NEW-8** Complete audit coverage and one audit page | A successor must be able to answer "what did my predecessor change, and why." Today ordinary edits, fund and opening-balance edits, settings, dues, donors and filings leave no trail, and the only reader shows 90 days of moves and deletes. |
| 8 | **NEW-14** Email-queue and ops access for the treasurer role | Statements, receipts and reminders all depend on mail. A treasurer cannot see or retry a failed send (needs `admin.users`), cannot dismiss a stuck row (SQL today), and cannot see a bounce at all (B-47). |
| 9 | **NEW-7** Fiscal-year close plus year-end archive export | No concept of "FY2026 is done": prior-year rows stay editable and the CSV export omits check number, bank account and donor. Needed for the audit committee and for handing a clean year to the successor. |
| 10 | **NEW-12** Zeffy donation import | The single biggest recurring manual data-entry job: every donation is hand-keyed. Not a blocker, but the thing a volunteer treasurer will resent most and the likeliest source of wrong-fund entries (see B-93). |

Next tier (11 to 15, not in the top 10): NEW-11a donor merge, NEW-11b undo "mark sent", NEW-13 roster import (and fix or delete the broken scripts), NEW-9 session period/balance editing and a second bank CSV format, NEW-16 compliance filing metadata and N/A.

---

## Task inventory

Rows are grouped by the Lions year. "Guide" notes where the Treasurer's Guide is silent or stale on a task the UI supports.

### 1. Year-start (July)

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| Y1 | Build next FY's budget per fund | **UI**, but fully manual. The "Seed from last year" button was removed on purpose (B-28); the editor shows prior budget and prior actual as reference only. `POST /budgets/seed` still exists with no caller. **Guide is stale:** `budgeting-section.tsx:63-71` still tells the treasurer to click that button. | annoying | B-37 (carry forward cause lines), B-28 (dead route) | NEW-6 "Copy last year's budget as an editable starting point" (P1) |
| Y2 | Approve and lock the budget (board minute cited); unlock with reason | **UI** (`ledger.approve`: admin, board_member). Guide does not mention approve/lock/unlock. | fine | | NEW-5 (guide) |
| Y3 | Fund opening balance and name | **UI (needs manage)**, `FundManageDialog`. Unaudited, no lock or reconciliation check, so editing it after a statement was sent silently rewrites history. Balances are life-to-date, so no yearly opening-balance entry is needed. | annoying | | NEW-8 (audit), NEW-2 |
| Y4 | **Bank account** opening balance | **impossible in UI/API.** `ledger_bank_accounts.opening_balance_cents` (DECISION-091) has no route and no UI writing it; only import scripts touch the table. | blocker | | NEW-2 (P0/P1) |
| Y5 | Add, rename, deactivate a bank account; set the default account; add petty-cash account | **SQL / migration only.** No route, no UI. The 2026-09-01 petty-cash discovery was handled by hand. Guide: "adding an account needs a developer script." | blocker | | NEW-2 |
| Y6 | Create or deactivate a fund; edit entity name, EIN, fiscal-year end | **SQL / migration only.** The schema comment says entities are "editable via ledger.manage" but no route exists. | blocker (rare) | | NEW-2 |
| Y7 | Create, rename, re-flag, deactivate, merge one category | **UI (needs manage).** Merge refuses when the source has transactions, when both sides budget the same year, or when any affected year is earlier than the current FY or locked. Category create is deliberately unaudited. **Guide silent** on Settings, Categories, and the letter-template sub-page. | annoying | B-16 (obsolete tier), B-33 | NEW-4 (permission), NEW-5 (guide) |
| Y8 | Bulk-retire categories unused this FY | **script** (`deactivate-unused-categories.ts --fy=YYYY --apply`). One-at-a-time deactivate exists in the UI. | annoying | | NEW-6 |
| Y9 | Budget page "+ Add category" | **UI shows it to `budget.edit` holders, but `POST /categories` requires `ledger.manage`**, so the treasurer and budget_committee get a 403. | blocker (defect) | | NEW-4 |
| Y10 | Set dues season: individual and family amounts, mark active FY | **UI** (`/admin/dues` "Configure", `dues.manage`). **Guide silent** on season setup. | fine | | NEW-5 (guide) |
| Y11 | Email dues reminders | **UI** (`/admin/dues/reminders`). Signed by the Board "Treasurer" position. **Guide silent.** | fine | | NEW-5 (guide) |
| Y12 | Refresh the member roster (adds and drops) from the LCI roster | **script**, and the scripts look broken: `sync-roster.ts` and `import-roster.ts` read and write `members.userId`, which is not a column on `members` (the FK runs `users.member_id`). UI has single add/edit/delete, "Sync Club" (Google Group), and a Zeffy-format export. | annoying (dues cohorts depend on it) | | NEW-13 (P2) |
| Y13 | Review ledger settings (approval threshold, reserve warning, holding-period days, bonded flag, philanthropy visibility) | **UI (needs manage).** Guide covers it, but its copy and the form say "at or above" while the code approves only strictly above the threshold. | fine (copy bug) | | NEW-5 |
| Y14 | New FY compliance calendar | **UI, automatic** (`ensureFilingsForFY` copies the prior year on Compliance page load). | fine | | |
| Y15 | Update thank-you letter signature for the new treasurer | **UI (needs manage)** at Settings, Acknowledgment Letter. A hand-typed signature name does **not** follow the officer change; only an empty name falls back to the resolved Treasurer. **Guide silent.** | annoying (silent wrong-name hazard) | | NEW-3, NEW-5 |

### 2. Monthly cycle

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| M1 | Record income, expense, transfer, sweep; attach receipt or waiver; link a budget line | **UI** (`ledger.record`; waiver needs manage). | fine | | |
| M2 | Enter a month of deposits and checks | **UI**, one at a time. No bulk entry or CSV import of transactions; "create from bank line" during reconciliation is the only faster path. | annoying | | NEW-12 (Zeffy), NEW-9 |
| M3 | Edit an unreconciled, unapproved entry | **UI.** Edits are unaudited; PATCH does not re-check the approval threshold, so a posted expense can be raised above the threshold without approval (control gap, reported, not independently exercised). | fine | | NEW-8 |
| M4 | Delete a mistaken entry | **UI**, reason required (10 to 500 characters), audited, snapshot kept. Refused if approved, rejected, cleared by a closed session, or if its acknowledgment letter was already sent (409). | fine | B-97, B-95 | |
| M5 | Fix an entry cleared by a **closed** session (wrong amount, category, bank account, date) | **UI (needs manage):** Reopen the session, edit, re-close. Reopen is refused while a later period on the same account is closed (reopen newest first). Lock reasons now show "next step" text, but only as a hover title on phones. | annoying | B-99 | NEW-4 (permission), NEW-5 (guide) |
| M6 | Correct a gift booked in the wrong fund (Administrative to Activity, income, same entity) | **UI** (Move, v1.86.0), audited, "Recent corrections" on Compliance. Reconciled or prior-FY moves need manage. Guide covers it. | fine | B-100, B-101 | |
| M7 | Wrong fund, any other shape: expense move, back to Administrative, Foundation vs Club (cash in Foundation account) | **impossible in UI.** Delete and re-enter where permitted; otherwise SQL. Cross-entity is a board decision per B-96. Guide lacks the Foundation-case paragraph. | blocker for cross-entity; annoying otherwise | B-96, B-98 (guide) | see work-log `2026-10-01-cross-entity-transaction-move.md` (not duplicated here) |
| M8 | Entry sits on the wrong **bank account** (not reconciled) | **UI** (edit; account validated on change). If reconciled, see M5. The edit form has no help text (B-99). | fine / annoying | B-99 | |
| M9 | Split an entry | **UI.** Refused for approved, rejected, reconciled, matched, or transfer rows. | fine | | |
| M10 | **Reconcile a paid reimbursement's check** | **Not possible as built (verify).** The pay route inserts the row with no `bankAccountId` and no `checkNumber`, and sets `approvedAt` (the lock). `getCandidateTransactionsForMatching()` requires `bankAccountId = session account`. So the row never appears as a match candidate, cannot be edited to add the account, and the bank's check line is left unmatched. Likely workaround, "create from bank line", would record the expense twice. Not in the backlog; B-85 only notes the missing back-marker. Repair today: `backfill-bank-account.ts` script or SQL. | **blocker** | B-85 (related) | **NEW-1 (P0)** |
| M11 | Create a reconciliation session, upload the **Chase** CSV, match one-to-one and batch, create fee/interest entries from bank lines, close (hard tie-out), reopen | **UI.** CSV is Chase-format only, 2 MB cap, one upload per session. A bank change means a developer must write a new parser. Guide does not mention the format or caps. | fine today; blocker if the bank changes | B-22, B-23 | NEW-9 (P2) |
| M12 | Bad CSV, wrong account, stray open session | **UI** (Discard session, v1.85.0): open sessions only, hard delete, audited; a reopened session needs manage. Guide covers it. | fine | B-06 (closed) | |
| M13 | Typo in a session's period or balances | **impossible to edit** (no PATCH on a session). Discard and recreate if open; Reopen then Discard (manage) if closed. | annoying | | NEW-9 |
| M14 | Undo one wrong match | **UI** (Unmatch, open sessions only). | fine | B-24 | |
| M15 | Rows reconciled with the legacy toggle (Quicken-seeded, no session) | **UI**, but they remain editable and un-lockable; the toggle writes no audit row. Decision pending whether to retire the toggle. | annoying | B-92 | |
| M16 | Send the monthly statement to the board; resend a corrected one | **UI** (Reports, "Send to Board", `ledger.report_send`; only fully reconciled months; sidebar "ready to send" badge exists). Hard-blocks when `resolveTreasurer()` finds none or several. **Guide silent** on this panel; mentions it only as a Move side effect. | fine | B-69 (done), B-71, B-75 | NEW-5 (guide), NEW-3 (resolver visibility) |
| M17 | Chase uncashed checks | **UI** (panel on Overview). Voiding a stale check is only possible for unlocked rows; a paid-reimbursement check cannot be deleted. | annoying | | NEW-1 |
| M18 | Record a dues payment; edit or delete one; auto-post to ledger | **UI** (`dues.manage`). "Mark Paid" button hard-codes method `zeffy` even for a check. A reconciled linked row is flagged stale rather than changed. Deleting through the register orphans the link. | fine / annoying | B-97 | NEW-10 (P3, small) |
| M19 | Key in Zeffy donations; reconcile Zeffy's Monday lump payout | **UI**, manual: one entry per donation, batch-match on payout. No Zeffy import exists in code or scripts. A public donation keyed under Administrative trips no warning (B-93). | annoying | B-34, B-93, B-23 | **NEW-12 (P1)** |
| M20 | Sweep Activity to Foundation (board minute cited) | **UI.** | fine | B-102 | |
| M21 | Move cash between bank accounts | **UI** (Transfer mode). | fine | B-36 | |
| M22 | Approve an over-threshold expense or transfer | **UI** (`/admin/ledger/approvals`; admin, board_member; self-approval blocked). | fine | | |
| M23 | Search ledger and budget lines | **UI.** | fine | | |

### 3. Donor work

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| D1 | Add and edit a donor; link or unlink a donor on a gift (works on reconciled rows, audited) | **UI** (`ledger.record`). | fine | | |
| D2 | Create acknowledgments; generate, print, or **email** letters in batch; edit the template | **UI** (template edit needs manage). **Guide deliberately excludes donors and letters** (2026-07-21 decision), so the whole workflow is undocumented for a successor. | fine / guide silent | B-45 (obsolete tier), B-51, B-63 | NEW-5 (reverse the exclusion) |
| D3 | Merge duplicate donors | **impossible.** Only hard delete (manage), which sets transaction and acknowledgment FKs to NULL; re-linking is manual. | annoying | | **NEW-11a (P2)** |
| D4 | Undo a mistaken "Mark sent", or reopen an already-sent letter | **SQL.** No unmark action; regenerate is refused after `sentAt`. Any such action writes a durable sent-claim reversal, so it must follow DECISION-102/103 and cannot ride along with an unrelated change. | annoying (blocker if a letter was wrongly marked) | | **NEW-11b (P2)** |
| D5 | Know whether a donor letter bounced | **impossible** (no delivery webhooks). The UI correctly says "Emailed", not "Delivered". | annoying | B-47 | |
| D6 | Year-end donor list for receipts or Schedule B | **Partial.** Transactions CSV has no donor, check number or bank-account columns; no donor-level export. | annoying | | NEW-7/NEW-15 |
| D7 | A courtesy letter on an ack-not-required category | **impossible** (silently never listed). | annoying | B-63 | |

### 4. Reimbursements

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| R1 | Pay or reject a member's request (treasurer-only, no board step) | **UI** (`ledger.record`). A submitter cannot act on their own request, so there must be at least two `ledger.record` holders. Guide is current. | fine | B-84, B-88, B-89 | |
| R2 | Board's after-the-fact review of what was paid | **UI**, Paid tab only; the Monthly Statement shows totals by design. | annoying | B-83 | |
| R3 | Correct a paid reimbursement (wrong category, date, method, amount) | **impossible in UI.** The row is approved-and-locked: edit, delete and split refuse. Only an offsetting entry. | annoying | B-85 | NEW-1 |
| R4 | Reconcile the reimbursement's check | see M10 | blocker (verify) | | NEW-1 |

### 5. Compliance and 990

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| C1 | See which Form 990 applies; export the 990-prep worksheet | **UI** (live determination; CSV). The actual IRS filing is done outside the app (guide says so). | fine | | |
| C2 | Filing calendar: mark in progress or filed | **UI.** Add and delete need manage. Editing a filing's agency, title or due date: API exists, **no UI caller**. Status "N/A" cannot be set. | annoying (low) | | NEW-16 (P3) |
| C3 | Clear guardrail warnings (14 of them) | **UI**, guide explains each. A deliberate multi-year public-fund hold cannot be recorded, so the aged-fund warning keeps firing. | annoying | B-79, B-80, B-93 | |
| C4 | Records retention | A 7-year setting exists; nothing enforces or exports. | fine | | NEW-7 (archive) |

### 6. Year-end (June) and audit

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| E1 | Final reconcile, last statement, budget-vs-actual by fund, entity totals | **UI.** | fine | B-15 (entity-level roll-up) | |
| E2 | **Close the fiscal year** (freeze it) | **impossible: no such concept.** Prior-FY rows remain editable by `ledger.record`; prior-FY delete is gated at `record` while the move needs `manage` (B-97). The only "lock" is the budget approve-and-lock. | annoying (control gap) | B-97 | **NEW-7 (P2)** |
| E3 | Hand the auditing committee or CPA a complete, read-only year | **Partial.** `ledger.view` can be given to a committee role; CSV export lacks check number, bank account, donor, receipts, acknowledgment letters. | annoying | | **NEW-15 (P2)** |
| E4 | Annual settings review | **UI**, with a guide callout. | fine | | |
| E5 | Final Treasurer's report at the last meeting | **UI** (reports); print is browser print. | fine | B-07 (guide print) | |

### 7. Officer handover

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| H1 | Change the bank signer, debit cards, Account Rep | **Outside the app; guide §1 covers it well** (in person, about 2 hours, listed attendees). | fine | | |
| H2 | Give the new treasurer the `treasurer` role; remove the old | **UI, admin-only** (`/admin/users`, `admin.users`). An outgoing non-admin treasurer cannot do it. | annoying (needs an admin) | | **NEW-3** |
| H3 | Set the Board position "Treasurer" | **UI** (`/admin/groups`, `groups.manage`: admin and board_member). Exactly one holder is allowed; if the outgoing Treasurer is not cleared first, **Send to Board and dues reminders hard-block ("multiple")**; if nobody holds it, they hard-block ("none"). Acknowledgment emails and CC rules degrade silently (tolerant). | annoying (order-sensitive, error shows only on the failing screen) | | **NEW-3** |
| H4 | Update letter signature name/title | see Y15 | annoying | | NEW-3, NEW-5 |
| H5 | The default treasurer role's actual permissions | `treasurer` holds ledger.view, record, report_send; budget.view/edit; dues.view/manage; impact.view. It lacks **ledger.manage** (reopen, categories, settings, fund edit, filings, waivers, reconciled/prior-year moves, donor delete), `ledger.approve`, Email Queue, Sync Log, Security. Via the Board group it gains `board_member` (approve, groups, members). | **blocker** if the successor is not an admin | | **NEW-4** |
| H6 | Know at a glance who "the Treasurer" is, what they can do, and what is broken | **impossible.** The resolver's answer is only visible as an error message on the send panels. | annoying | | NEW-3 |
| H7 | App-side handover instructions | **Guide silent** (bank-side only). | annoying | | NEW-5 |

### 8. Corrections and audit trail

What `ledger_audit_log` covers today: transaction fund move and delete (with reason and snapshot), session discard, category rename/reactivate/deactivate/flags/merge, letter-template edit, and donor-link on a reconciled row.
**Not audited:** ordinary transaction edits, fund and opening-balance edits, settings changes, budget edits (lock and unlock keep their own columns), session close and reopen (own columns on the session), donor edits and deletes, filing changes, dues edits, category creation (deliberate).
**Only reader:** "Recent corrections" on the Compliance page: moves and deletes only, 90 days, 25 rows shown. No page lists category, discard, template or donor-link rows.

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| A1 | "What changed, who, when, why" for any ledger record | **Partial** (see above). | annoying | B-95 (refactor only) | **NEW-8 (P1)** |
| A2 | Edit anything locked (approved, rejected, dues-synced, transfer leg, reconciled) | Delete where allowed; reopen for reconciled; otherwise offsetting entry or SQL. No `voided` status by design (DECISION-110). | fine (deliberate) | | |

### 9. Emergency operations

| # | Task | How today | Severity | Backlog | Proposed (priority) |
|---|---|---|---|---|---|
| X1 | See failed emails and retry them | **UI**, but `admin.users` only (admin). The nav link is visible to every admin-area user, who is then redirected away. | blocker for a non-admin treasurer | | **NEW-14 (P1)** |
| X2 | Clear stale or stranded email-queue rows | History purges lazily at six months (v1.85.0). No manual dismiss; a stranded `pending` row is invisible and un-retryable. Earlier clean-ups were **SQL**. | annoying | B-81, B-72, B-74 | NEW-14 |
| X3 | Know a message bounced | **impossible.** | annoying | B-47 | |
| X4 | Review failed sign-ins | **UI**, read-only, `admin.security_view` (admin). | fine | | |
| X5 | Stray open reconciliation session | **UI** (Discard). | fine | B-06 | |
| X6 | Reset a member's or successor's password | **UI** (admin, DECISION-096). | fine | | |
| X7 | Google Group sync history | **UI** (`sync_log.view`). Keeps member email lists forever. | fine / privacy | B-82 | |
| X8 | Deploy, environment keys (Resend, DB), backups | **developer only, by design.** Not a treasurer task. Out of scope, but a successor needs a named contact in the guide. | n/a | | NEW-5 |

---

## Proposed backlog items

IDs are provisional (NEW-n); assign real B-nn from B-104.

**NEW-1 (P0): Paid reimbursements must be reconcilable and correctable.** First confirm with a read-only query for `ledger_transactions` rows that have a linked `ledger_reimbursements.ledger_transaction_id` and a NULL `bank_account_id`, and for expense rows created from a bank line that duplicate a reimbursement amount and date. Then: (a) the pay dialog collects the bank account (default pre-selected, as the transaction form does) and check number, and the route writes both; (b) a narrow, allowlisted, audited carve-out in the approved-row lock (modelled on DECISION-099's `donorId` carve-out) lets a `ledger.record` holder set `bankAccountId`/`checkNumber` on a reimbursement-derived row that has none, so existing rows can be repaired without a script; (c) decide whether a paid reimbursement may be corrected (category, date, method) through an audited edit instead of an offsetting entry. None of this may change a closed session's arithmetic. Relates to B-85.

**NEW-2 (P1): Ledger structure admin.** A `ledger.manage` page under Settings to add, rename, deactivate and set-default **bank accounts** (including institution, type and **opening balance**, which currently has no writer), create and deactivate **funds**, and edit **entity** details. Audited. Include "why can't I delete this" explanations (an account with transactions can only be deactivated). Replaces the guide's "needs a developer script."

**NEW-3 (P1): Officer-handover screen.** A single page (visible to the treasurer, president, secretary and admin) that shows: who `resolveTreasurer()` resolves to and, if it fails, why (`none`, `multiple`, `no_board_group`); who holds the `treasurer` role; every `ledger.record` holder (so "submitter cannot pay own request" is satisfiable); the letter signature name vs the resolved Treasurer. A guided "Hand over to [member]" action sets the Board position and grants or revokes the `treasurer` role in the safe order, and offers to clear a stale hand-typed signature. Needs a Phase 1 on who may perform it (today the role change is `admin.users`, admin only).

**NEW-4 (P0, mostly a role-binding decision): Treasurer permission baseline.** Decide which of today's admin-only `ledger.manage` abilities the `treasurer` role should hold by default (reopen a reconciliation, categories, settings, fund edit, filings, receipt waiver, moving reconciled or prior-year rows, donor delete) and either bind `ledger.manage` to `treasurer` in a migration or split it into narrower keys (for example a corrections key versus a destructive-admin key). In the same change fix two mismatches: the budget page "+ Add category" button is shown to `budget.edit` holders but `POST /categories` requires `ledger.manage`; and the Email Queue nav entry carries no `requiredFeature` while its page requires `admin.users` (see NEW-14). Add a test that every control rendered for a permission is accepted by the server for the same permission.

**NEW-5 (P1): Treasury Guide refresh and checklists.** Fix the two stale statements (the "Seed from last year" button; "at or above" vs strictly-above approval threshold, also in `ledger-settings-form.tsx` copy), the "twelve sections" comment, and the v1.86 reconcile-toggle lock; add sections or callouts for: a **monthly close checklist** (record, reconcile, statement, acknowledgments, dues), **start-a-fiscal-year** and **year-end** checklists, **officer handover (app side)**, the **Send to Board** panel, **categories and settings sub-pages**, **dues season setup and reminders**, **donors and acknowledgments** (reversing the 2026-07-21 exclusion), **email queue**, Chase CSV format and limits, B-98's Foundation-case paragraph, and a named developer contact for deploy and key issues. Release-notes skill already requires guide updates when a documented surface changes; extend it to cover any new treasurer surface.

**NEW-6 (P1): Start-a-new-fiscal-year flow.** One page, in order: confirm the prior year is closed (NEW-7), create next FY's budget from last year (editable starting point including cause lines, B-37; **Phase 1 must ask the treasurer why the old seed button was removed before reviving it**), bulk-retire unused categories (replaces the script), configure the dues season, confirm compliance filings, review settings. Delete the dead seed route (B-28) as part of it.

**NEW-7 (P2): Fiscal-year close.** An explicit "close FY" that soft-locks prior-year transactions (edits and deletes then need `ledger.manage` plus a reason, audited), gated on a checklist (all months reconciled, all statements sent, acknowledgments sent). Reversible by a manager with a reason. Resolves B-97's inconsistent record-vs-manage gate for prior-year deletes.

**NEW-8 (P1): Audit coverage and one audit page.** Record ordinary transaction edits (field-level before/after), fund and opening-balance edits, settings, dues edits, donor edits and deletes, filings, and session close/reopen in `ledger_audit_log` via `recordLedgerAudit()` (absorbs B-95), and add `/admin/ledger/audit` with filters by actor, record, action and date range beyond 90 days. Must keep reasons and names off any member-facing surface (existing `ledger-audit.ts` import-guard rule).

**NEW-9 (P2): Reconciliation input flexibility.** Edit an open session's period and balances; replace the CSV in an open session; make the bank parser pluggable (Chase is the only format; a bank change today is a developer task).

**NEW-10 (P3): Dues "Mark Paid" should ask the method** (it hard-codes `zeffy`) or default from the member's last payment.

**NEW-11a (P2): Donor merge.** Pick a survivor, re-point transactions and acknowledgments, union emails, audit it; refuse if both have sent letters unless the treasurer confirms.
**NEW-11b (P2): Undo "mark sent" for an acknowledgment**, with a reason, audited, using the durable-claim helpers (DECISION-102/103); never a bare `sentAt = null`.

**NEW-12 (P1): Zeffy donation import.** Upload Zeffy's donation export; propose Activity-fund income rows (payment method `zeffy`), match donors by email, de-duplicate on Zeffy transaction id, and never post public money to Administrative (also delivers B-93's detector at the point of entry).

**NEW-13 (P2): Roster import UI.** Upload the LCI roster CSV, show a dry-run diff (add, update, deactivate), then apply, replacing `sync-roster.ts`/`import-roster.ts`. Until then, **fix or delete the two scripts**: they reference `members.userId`, which does not exist, and a successor who finds them will assume they work.

**NEW-14 (P1): Email operations for the treasurer role.** A narrow permission (view and retry failed emails) bindable to `treasurer`, instead of overloading `admin.users`; hide the nav entry from those who lack it; a manual "dismiss with reason" for stuck rows; fold in B-81 (stranded `pending`) and B-72 (permanent vs transient failure).

**NEW-15 (P2): Complete read-only year export.** CSV or ZIP per fiscal year with every ledger column (check number, bank account, donor, budget line, receipt reference, reconciliation session), donor and acknowledgment list, receipts, and sent letters, for the audit committee and the successor. Fixes the current export's omissions.

**NEW-16 (P3): Compliance filing editing.** UI for the existing filing-metadata PATCH, and the `N/A` status.

---

## Where the Treasurer's Guide is silent or stale

**Stale (fix now):**
1. `budgeting-section.tsx:63-71` describes a "Seed from last year" action that no longer exists in any UI (`budget-fund-editor.tsx:152-154`).
2. `settings-section.tsx:34-35` and `ledger-settings-form.tsx:105-106` say "at or above" the threshold; `transactions/route.ts:361` approves only strictly above.
3. v1.86 changes undocumented: the register's reconcile checkbox is locked for session-cleared rows; a changed bank account on an entry matched in an open session is refused; the Delete section omits the 10-to-500-character reason rule and the 90-day "Recent corrections" list on Compliance.
4. `page.tsx` comment says "twelve section files"; there are thirteen.

**Silent on a task the UI supports:** Send to Board and corrected resend; Reports exports; Settings sub-pages (Categories, Acknowledgment Letter) and that Settings needs manage; category merge/deactivate; dues season setup and `/admin/dues/reminders`; donors, acknowledgments and emailing letters (deliberately excluded); budget approve, lock and unlock; Chase CSV format, size cap and one-upload rule; the app side of officer handover; email queue and retry; compliance filing status updates; the Foundation-deposited-in-Club-account case (B-98).

---

## Incidental defects found (not self-sufficiency gaps, but worth a ticket)

1. **Paid reimbursements lack bank account and check number** (NEW-1). Highest priority; verify first.
2. **"+ Add category" 403** for `budget.edit` holders who lack `ledger.manage` (NEW-4).
3. **Email Queue link shown to everyone who can see the admin area** though the page needs `admin.users` (NEW-4/NEW-14).
4. **Posted-expense edit bypasses the approval threshold** (`PATCH /transactions/[id]` never reads the setting). The approval check runs only at creation, so a small posted expense can be edited upward without approval.
5. **Fund edit (name, opening balance) is unaudited and unlocked** against reconciled periods and sent statements.
6. **`sync-roster.ts` / `import-roster.ts` reference a non-existent `members.userId`** and `import-roster.ts` has a hard-coded personal path default.
7. **Dues "Mark Paid" hard-codes `zeffy`.**

## Assumptions and open questions for the treasurer

1. Is the successor expected to be an **admin**? If yes, NEW-4 shrinks to the two gating fixes and NEW-3 is mostly a checklist; if no (my assumption), NEW-4 and NEW-3 are blockers.
2. Run the NEW-1 verification query against production before scheduling. If no reimbursement checks have cleared yet, the fix is preventive rather than corrective.
3. Does the club expect to change banks or add accounts soon? That moves NEW-2 and the Chase-only parser (NEW-9) from "rare" to "next".
4. Should "close the fiscal year" (NEW-7) be mandatory before a new budget is approved, or advisory?
5. Who is the named developer contact for deploy, keys and backups? That belongs in the guide (NEW-5), and in the handover checklist.

## Out of scope

Seeding next year's meeting schedule, the welcome packet render, form-spam purges, and other site-content scripts are not treasurer duties and were excluded. The historical ledger scripts (Quicken import, FY2025/FY2026 cleanups, dev-to-prod port) are one-time and must not be re-run; they are not a treasurer path and should be left alone, ideally with a header banner that says so.

## Scripts a treasurer would otherwise need, and their status

| Script | Recurrence | UI equivalent today |
|---|---|---|
| `deactivate-unused-categories.ts` | annual | single deactivate only (NEW-6) |
| `clear-budget-fy.ts` | rare | per-line delete only; no "clear the year" |
| `sync-roster.ts` / `import-roster.ts` | annual | none; likely broken (NEW-13) |
| `backfill-bank-account.ts` | repair | none; would be the only repair for NEW-1 rows |
| `sync-board-role.ts` | handover | **UI exists** (button on `/admin/groups/[id]`); script superseded |
| `backfill-dues-ledger.ts`, `fix-ledger-categories.ts`, `rehome-misc-actuals.ts`, `close-out-historical-acknowledgments.ts`, `propose-donors-for-acknowledgments.ts`, `import-quicken-ledger.ts`, `port-ledger-dev-to-prod.ts`, `reset-fy2026-budget.ts`, `seed-fy2026-foundation-budget.ts`, `add-kroger-rewards-category.ts`, `backfill-budget-line-links.ts`, `backfill-check-numbers.ts` | one-time, historical | not needed going forward; never re-run `import-quicken-ledger.ts` (deletes and reinserts, wiping later edits) |

## Sources

`src/app/(dashboard)/admin/ledger/**`; `src/app/api/admin/ledger/**`; `src/components/admin/ledger/**` and `guide/`; `src/lib/ledger*.ts`, `board-positions.ts`, `reconciliation-queries.ts`; `src/lib/permissions.ts`; `scripts/*`; `drizzle/migrations/0045`, `0047`, `0069`, `0070`, `0091`, `0104` (role bindings); `docs/backlog.md`; `docs/decisions.md` DECISION-099 to DECISION-111; `docs/release-notes/v1.85.md`, `v1.86.md`; CLAUDE.md Key Features.

# Move or Cancel a Ledger Transaction Entered in the Wrong Place — Work Log

> **Slug:** `2026-10-01-move-or-cancel-transaction`
> **Surface:** (dashboard) admin — The Ledger, fund register `/admin/ledger/[fundSlug]` (row actions) and the existing sweep form
> **Permission(s):** existing `FEATURES.LEDGER_RECORD` for an unsettled current-year row; existing `FEATURES.LEDGER_MANAGE` for a reconciled or prior-fiscal-year row. No new key.
> **Estimated complexity:** medium-large (one new action, one new policy module, one audit generalization, one lock carve-out that amends DECISION-036/099)
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions (R1-R8 binding on Phase 3) | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named | 2026-10-01 |
| 4 — Implementation | api-developer, then ux-developer | Complete (server + UI) | Gate green | 2026-10-01 |
| 5 — Verification | qa | Complete | PASS | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (one pre-push release-notes condition; follow-ups B-next-A to H) | 2026-10-01 |

---

# Phase 1 — Functional Refinement (analyst)

**Request (treasurer, 2026-10-01):** "I also need to be able to move and/or cancel transactions that I entered in the wrong place. I want to move a donation to the Activity Fund as I deposited it in the wrong account and now I need to account for it and sweep it."

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The treasurer needs a logged, reason-required "Move to another fund" action (the one thing the register cannot do today) plus a hardened version of the Delete that already exists; the scenario he described is a fund reclassification on the same Club bank account followed by the existing Activity-to-Foundation sweep, and it must not be built as a transfer, a reversal pair, or a general-purpose editable fund field.

## Verified Against the Code (Pass 0)

Everything below was read, not assumed.

**What PATCH / DELETE do today** (`src/app/api/admin/ledger/transactions/[id]/route.ts`)
- PATCH is gated `LEDGER_RECORD`. It never reads `fundId` from the body: an unknown key is silently ignored, so a client that sends `fundId` gets a 200 and nothing changes. The "fund is never editable" comment (around line 499) is a statement of fact in the budget-line validation, not a recorded decision. **I found no ADR, DECISION or work-log that decided fund immutability.** It is an inc1 default that later became load-bearing (see "Why fund is immutable" below). The edit form hides the fund picker when editing (`!isEdit`, `transaction-form.tsx` line 589).
- PATCH locks: `approvedAt` set (403, before body parse), `status = 'rejected'` (403), `reconciledSessionId` set (403 unless the body is exactly `{ donorId }`, DECISION-099). Transfer legs ignore `bankAccountId` (DECISION-058).
- DELETE is gated `LEDGER_RECORD`, same three locks, and for a transfer pair removes both rows in one transaction. **It writes no audit row at all, is a hard `DELETE`, and has no guard for acknowledgments.** `ledger_acknowledgments.donation_txn_id` is `ON DELETE CASCADE` (schema.ts, ledgerAcknowledgments), so deleting a Foundation donation silently destroys its acknowledgment record, **including one already sent to the donor** (the IRS Pub 1771 substantiation record). Match links in `ledger_reconciliation_matches` also cascade. `ledger_audit_log.target_transaction_id` is `ON DELETE SET NULL`, so audit rows survive a delete; nothing writes one yet.
- **The reconciled lock has a hole.** PATCH/DELETE test only `reconciledSessionId`. The legacy per-row `ReconcileToggle` sets `reconciled = true` and clears `reconciledSessionId` (DECISION-036), so a legacy-reconciled row is not locked by PATCH or DELETE. `/split` already knows this and checks `reconciled` separately.
- **`bankAccountId` is not validated server-side** on PATCH or on the regular-transaction POST (only "is a non-empty string"; transfers are validated, regular rows are not). A cross-entity account id is accepted silently; a nonexistent one is an FK 500. PATCH also does not check whether the row is matched to a bank line in an **open** reconciliation session (`/split` does), so a bank-account edit can leave a match link pointing at a bank line on a different account.
- The register renders Edit and Delete on **every** row for a `LEDGER_RECORD` holder (`[fundSlug]/page.tsx` ~line 520); locks surface only as a 403 toast after clicking.

**Funds, accounts, transfers**
- A row carries `entityId`, `fundId`, `bankAccountId` independently. Bank accounts belong to an entity, not a fund. The Club has funds Administrative and Activity and bank accounts **Administrative Checking** and **Petty Cash**; **there is no separate Activity bank account** (work-log `2026-07-29-ledger-account-transfers.md`, live-state check). The Foundation has one Charitable fund and its own account.
- So for the Club, "wrong account" in the treasurer's vocabulary almost certainly means wrong **fund**: the cash is in Administrative Checking either way.
- `src/lib/ledger-transfer-policy.ts` is deny-by-default and allows exactly two things: same fund / different bank account ("Transfer"), and Club Activity to Foundation Charitable ("Sweep", board-minute mandatory). **Administrative to Activity is explicitly blocked** ("the Activity Fund's income must stay publicly-sourced"); so is Activity to Administrative; Foundation to Club is a one-way valve. A *transfer* cannot be used to fix this scenario by design, and the fix must not become a back door around that matrix.
- Sweep (`POST /transactions` with `transfer: true`): requires a source bank account owned by the Club, a destination bank account owned by the Foundation, a board-minute reference, defaults the Foundation leg to the "Public donations" income category, and goes `pending` for approval if over `disbApprovalThresholdCents`. Sweeps are confirmed in a dialog because they are two permanent rows on two books.

**Reconciliation is keyed on the bank account, not the fund.** `reconciliation-queries.ts` and the close / reopen / match routes never read `fundId` (only `create-from-bank-line` does, to insert a row). `getBankAccountBalances()` sums by `bankAccountId`. Therefore a fund change leaves every bank-account balance and every closed session's tie-out arithmetic exactly as it was. This is the same property DECISION-099 used to justify the `donorId` carve-out, and it is why a fund move on a reconciled row is safe in a way an amount, date, flow, or bank-account edit is not.

**Reopen** (`/reconciliation/sessions/[sessionId]/reopen`): `LEDGER_MANAGE`; refused while any LATER session on the same account is closed (you must reopen newest-first); reverts every row in that session. For a mistake found two statements later this is a multi-session unwind. Too heavy for a fund reclassification that cannot change the arithmetic.

**Guardrails when a row's fund changes after the fact** (`ledger.ts`, `ledger-queries.ts` `getComplianceOverview`): all computed live from posted rows on every load, no cached state, so they simply follow the move.
- `firewallViolations` counts transfer GROUPS spanning Activity and Administrative. A single non-transfer row never trips it.
- `adminPublicIncomeCount` counts Administrative income whose **category's** fund kind is not administrative. Category kind is forced to equal fund kind on create and edit, so **a donation entered in Administrative with an Administrative category is invisible to this guardrail.** The exact mistake in the request is not detectable by the system today; the treasurer found it by eye.
- Aged public fund (DECISION-105): after the move the Activity balance rises by the donation, with "fresh" income judged by `txnDate`. A recent donation is fresh. The sweep reduces the balance oldest-first.

**Monthly financial statement** (`financial-report-queries.ts`, `financial-report-send.ts`): only Administrative and Charitable are member-exposed (`MEMBER_EXPOSED_FUND_KINDS`); Activity is not. Moving income out of Administrative therefore **reduces the Administrative statement's income for that month**. The send machinery already handles this: it recomputes a totals fingerprint on every load and returns `state: "corrected"` against the last successful `financial_report_sends` row, so the panel shows "Resend Corrected Statement." Nothing drifts silently, but the treasurer must be told at move time that a statement he already sent will now read "corrected."

**Audit log:** `ledger_audit_log` has `target_transaction_id`, `before`, `after`, `details`, an `action` string, and one existing transaction pattern (`RECONCILED_DONOR_LINK_AUDIT_ACTION`, written in the same DB transaction as the edit). **Nothing reads the table.** No page lists audit rows. A required reason that no one can read back is a ritual, not a control (see Gaps).

## Why Fund Is Immutable Today (the invariant I am proposing to relax)

No decision records it. The real, current reasons it is hard to change safely:
1. **Category is fund-kind-scoped.** `ledger_categories.fund_kind` must equal the fund's kind and the flow must match. A fund change forces a category decision.
2. **Budget lines are keyed by fund** (`ledger_budget_lines.fund_id`, derived FY, category). A moved expense row's `budgetLineId` becomes invalid. PATCH already has an auto-clear rule for date/category changes (DECISION-061); fund needs the same.
3. **Dues auto-post rows** (`duesPaymentId`) are Administrative income by construction; moving one orphans the sync logic's assumption.
4. **Transfer pairs** derive their meaning from the pair's two funds; moving one leg silently converts a Sweep into something the direction matrix forbids.
5. **The two-fund firewall** (Constitution Art. VII §3(g), Financial Transparency Policy §6): public money must never sit in the Administrative fund. A free fund selector in edit would let a `LEDGER_RECORD` holder re-file Activity money as Administrative with one click, which is the precise thing `checkTransferDirection()` forbids for real transfers.
6. **Reports and filings** are fund- and FY-scoped: monthly statements, the 990 prep panel, impact reporting, aged-fund aging. A silent fund change restates all of them.

None of these is a reason fund can *never* change. All are reasons the change must be a dedicated, validated, audited action rather than one more optional PATCH field.

## Which Of Move / Cancel The Treasurer Actually Needs

**For the stated case: Move only.** Nothing is wrong about the row's existence, amount, date, donor, or bank account. Only its fund is wrong.

**In general: both, but "cancel" does not need a new status.**
- *Move* is new and is the only way to get a row into a different fund without deleting history.
- *Cancel* = the hard `DELETE` that exists. A `voided` status or reversal pair is **not recommended for v1**. Reasons: (1) the three outcomes the treasurer actually has are "wrong, remove it" (delete), "right row, wrong fund" (move), and "right row, wrong amount or account after it cleared the bank" (a reconciled-row correction, below); none needs a contra entry. (2) A reversal pair doubles income and expense for every report that sums the table (990 revenue, impact giving, aged-fund trailing income, member statements) and every one of them would need a "reversal" exemption, which is a large cross-cutting change for a one-treasurer club. (3) The codebase already has a lightweight contra mechanism for locked rows: the "Income (Refund)" and "Expense (Refund)" entry modes with a "Refund of ..." memo. (4) The real risk of hard delete is not that history is lost to a bad actor; it is that it is lost with no record. A row snapshot in `ledger_audit_log` written in the same DB transaction fixes that for a fraction of the cost.
- The honest limit: a row cleared by a closed reconciliation session represents a real bank line. It cannot be "cancelled"; it can only be corrected in ways that leave the bank-line match true. See Flow 4.

## Options Considered For The Treasurer's Exact Scenario

The books are single-entry per fund. `fundId` says whose money; `bankAccountId` says where the cash sits. They are independent.

| Option | Result | Verdict |
|--------|--------|---------|
| **(a) Change the row's fund to Activity, leave `bankAccountId`, then record a Sweep** | Admin fund -$X, Activity +$X on the same Admin Checking account (bank balance and reconciliation unchanged); then Activity -$X / Admin Checking -$X on the Club side and +$X on the Foundation account and fund. One row edited, history kept, every bank-account figure true throughout. | **Primary flow.** |
| (b) Delete and re-enter as Activity income | Same end state, but loses the original row's audit trail, impossible once reconciled or approved, drops any donor link, receipt, check number, and memo, and (for a Foundation row) cascades a sent acknowledgment away. | Allowed as a fallback for unreconciled rows (it exists today). Not the recommended path. |
| (c) Contra entry (reverse in Administrative, new row in Activity) | Preserves the trail but adds an artificial expense to Administrative and an artificial income to Activity, distorting every total, and is the double-count class of defect this ledger has repeatedly had to fix. | Not recommended. Refund-mode entry remains available for rows that are approved/locked. |

**The physical-vs-ledger rule (answers "wrong bank account"):** `bankAccountId` means *where the cash actually is*. If the ledger row named the wrong account but the cash is somewhere else, the row can be corrected by editing `bankAccountId` (exists today, subject to hardening below), and it cannot have cleared in the wrong account's statement. If the cash really sat in account A and was later moved to B, **nothing was entered wrong**: record a Transfer (same fund, different account, exists today). Once a row is reconciled, its bank account is fact, so it stays locked and any physical correction is a Transfer, never an edit.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (treasurer, `LEDGER_RECORD`) | Open a posted row's actions in the fund register and choose **Move to another fund** | Rare (a few times a year) |
| Admin | Pick the destination fund, a valid category for that fund (or clear it), and type a **reason** | Per move |
| Admin | Read a plain-language "what will change" summary (both funds' balances, the month's statement, budget link) and confirm | Per move |
| Admin | After a successful move, choose **Record sweep now** (opens the existing sweep form prefilled) or dismiss | Per move |
| Admin | Enter a board-minute reference and record the Activity-to-Foundation sweep (existing flow) | Per move |
| Admin | **Delete** a mistaken row (existing), now with a typed reason and an honest list of what else disappears | Rare |
| Admin | See why a row cannot be changed (reconciled, approved, transfer leg, dues-synced) and what to do instead | On demand |
| Admin | Read the history of a row or recent corrections (who, when, from, to, why) | On demand |
| Admin (`LEDGER_MANAGE`) | Move a reconciled or prior-fiscal-year row | Rare |
| Anonymous visitor, signed-in member without ledger access | None. No surface, no route access, no change to member-facing pages other than numbers they may already see on `/members/financial-reports` | n/a |

## Flows

### Flow 1 — The treasurer's scenario: a donation was put in the wrong fund; fix it, then sweep it

Assumed reading (see Open Question 1): the donation was recorded as **Administrative Fund** income on **Administrative Checking** (the Club's one operating account). Cash is genuinely in that account. The donation is public money and belongs in Activity, to be swept to the Foundation.

Entry: `/admin/ledger/administrative` (or search result), the donation row's Edit/Delete cell.
1. Treasurer chooses **Move to another fund** on the row. Only rows that can be moved offer it enabled; others show the lock reason in place (see Flow 4).
2. Dialog shows the row (date, party, amount, current fund, bank account, category) and a destination-fund select listing only funds this row may legally move to (here: Activity Fund; the Foundation's Charitable fund is not offered, because that would be cross-entity and out of scope).
3. Category: the dialog requires a decision because Administrative categories are invalid for Activity. It preselects "Public donations" if it exists for the Activity fund (same default the sweep uses), allows any valid Activity income category, or "No category".
4. Reason, required, plain text, min 10, max 500 characters (e.g. "Zeffy donation from the fall drive was booked to Administrative by mistake").
5. A "What will change" panel, computed server-side, states: Administrative Fund balance down $X; Activity Fund balance up $X; **Administrative Checking balance unchanged** (cash did not move); the row stays on Administrative Checking and stays reconciled; if the txn date falls in a month whose statement was already sent to the board, "Administrative statement for <month> will show as changed and offer a corrected resend"; if the row is linked to a budget line it is unlinked (expense rows only; a donation is income, so normally n/a); if it is in a prior fiscal year, a stronger warning and the `LEDGER_MANAGE` requirement.
6. Treasurer confirms. Server re-validates every guard inside one DB transaction (row locked `FOR UPDATE`), updates `fund_id` and `category_id`, clears `budget_line_id` if set, and writes one `ledger_audit_log` row. Toast: "Moved to Activity Fund." with a **Record sweep now** button.
7. **Record sweep now** opens the existing sweep form prefilled: source Club bank account = the row's account, destination = the Foundation's account, amount = the donation, date = today, memo "Sweep of <party> gift moved from Administrative on <date>". **Board-minute reference is still required and is not guessed.** Treasurer enters it, confirms the existing sweep confirmation, and the two linked sweep rows post (or go `pending` for `LEDGER_APPROVE` if over threshold).
8. Outcome the treasurer sees: Administrative register no longer lists the gift; Activity register lists it with a "Moved from Administrative" note and then the sweep expense; Foundation register lists the sweep income; the Activity balance returns to roughly zero; the Administrative statement for the month shows "corrected" if it had been sent.
- **Failure:** Row is approved, a transfer leg, dues-synced, rejected, pending, or the destination is not permitted: the action is disabled with the reason ("This row was part of an approved disbursement; to correct it, record a refund entry"). A stale row (someone else reconciled, moved or deleted it since the page loaded): 409 "This row changed while you were looking at it. Refresh and try again." Reason blank or too short: field error, nothing saved. Network or database failure: toast "Could not move this transaction. Nothing was changed." and the row is unchanged (single transaction, so there is no half-moved state). Sweep step fails (missing minute, over threshold, account mismatch): the fund move **stays** (it was correct on its own); the register shows the gift in Activity and the treasurer retries the sweep; the existing Activity-aging and compliance flags nudge until swept.

### Flow 2 — Generic: "I entered this in the wrong fund"

Entry: any posted, non-transfer, non-approved, non-dues-synced row in a fund register.
1. Move to another fund, with the same dialog as Flow 1.
2. The set of allowed destinations is decided by the **balance-direction rule** (below), not the flow.
3. Outcome and failures as Flow 1, without the sweep prompt unless the destination is the Activity fund and the row is income.
- **Balance-direction rule (recommended, deny-by-default).** A move is *toward-public* when it does not decrease any public fund's balance and does not increase Administrative's: income Administrative to Activity, or expense Activity to Administrative. A move is *away-from-public* when it does the opposite: income Activity to Administrative (public money into Administrative, the firewall violation), or expense Administrative to Activity (club operating cost charged to public money). The sign comes from the row's own `flow`, so one rule covers income and expense and cannot be fooled by relabelling the flow.
- **v1 allows toward-public moves only.** Away-from-public is refused with a specific policy reason (same style as `checkTransferDirection()`), because it is functionally the transfer the matrix already blocks and the guardrails exist to catch it. This decision belongs in a new pure `ledger-fund-move-policy.ts` beside `ledger-transfer-policy.ts`, keyed on fund `kind` and entity identity (never hard-coded ids), with every matrix cell unit-tested.
- A legitimate away-from-public case exists (a member's dues paid through the club Zeffy form and mis-booked as an Activity donation). v1 handles it by delete and re-enter as dues; a gated away-from-public move is a recorded follow-up if the treasurer hits it (Open Question 3).
- A move whose destination equals the current fund is a no-op: 409 with no audit row.

### Flow 3 — "I entered this in the wrong bank account"

Entry: Edit on a row (this exists today).
1. First ask: **did the cash really go there?** The edit form's bank-account field gets help text: "Pick the account the money actually went into. If it went into one account and was later moved to another, record a Transfer instead of editing this."
2. If the row named the wrong account and the cash is elsewhere, and the row is **not** reconciled and **not** matched to a bank line in an open session: edit `bankAccountId` (existing).
3. If the row is matched in an open session: refuse, "Unmatch this row from the open reconciliation session first" (same guard `/split` already has).
4. If the row is reconciled: bank account stays locked (existing). The cash really is in that account. Correct physical reality with a Transfer.
5. If the row is a transfer leg: bank account stays immutable (DECISION-058); delete the pair and re-record.
- **Failure:** the server must validate the account (exists, same entity as the row, active) before saving. Today it does not: a Foundation account can be saved on a Club row and a bad id is a 500. This is an existing defect that this flow depends on, and fixing it is in scope as a hardening item.
- No new "move bank account" action is proposed. The physical movement of money is already modelled by Transfer.

### Flow 4 — "Cancel" a locked row

Three kinds of locked rows, three different answers.
- **Reconciled (closed session or legacy toggle) and wrong in a way the bank statement confirms is real (wrong fund):** use Flow 2 under the narrow carve-out (below). No reopen.
- **Reconciled and genuinely should not exist** (e.g. duplicate entry, row recorded twice, one of which matched): the matched row is a real bank line; the duplicate is the unmatched one and is deletable today. If the row itself is wrong, the path is **reopen the session (`LEDGER_MANAGE`), delete, re-close**. It is heavy by design, and for a row discovered after later months were closed it means reopening newest-first. v1 does not shortcut this. v1 makes it findable: the 403 message names the session (period and account) and, if a later closed session blocks the reopen, says which one to reopen first, using the data `getLaterClosedSessionForAccount()` already returns. A reconciled-row hard delete without reopening is **not** recommended: it would silently move a closed session's arithmetic, which is the one thing DECISION-036 exists to prevent.
- **Approved (including reimbursement-paid rows, DECISION-106) or rejected:** stays fully locked. The correction is a compensating "Refund" entry. Approval is board-visible finality; a hidden cancel would defeat it. Voiding an approved disbursement is out of scope and filed as a follow-up.
- **Pending:** not movable (the approval request would be stale). Reject it (existing) and re-enter.
- **Unlocked row:** DELETE as today, with the hardening in the Gaps list (reason, audit snapshot, sent-acknowledgment guard).

## Reconciled-Row Policy (needs an architect ruling)

Recommend a **second, narrow carve-out** to the reconciled lock, delivered as a **dedicated move endpoint, not as a widened PATCH carve-out.** Reasons:
- DECISION-099 deliberately built an allowlist of exactly one key (`donorId`) on PATCH. Adding `fundId` and `categoryId` there makes the carve-out a two-field, two-meaning rule inside a generic edit route that is also the gate for amounts and dates.
- A move needs things PATCH cannot express: direction policy, a required reason, a "what will change" preview, `FOR UPDATE`, and a different permission by row state.
- The lock stays "full lock on amounts, dates, flow, bank account, check number" and the carve-out is "fund and category reclassification, because it provably cannot move a closed session's arithmetic." That is the same justification form as DECISION-099 item 1.
- Because the legacy toggle also sets `reconciled = true` without a session pointer, the move action must treat `reconciled = true` as reconciled whether or not `reconciledSessionId` is set. Whether to also close the PATCH/DELETE legacy-toggle hole is an architect call (it changes existing behavior).
- `approvedAt`, `rejected`, transfer-leg, and dues-synced rows get **no** carve-out.

## Permissions

- **New key:** none.
- **Move, current fiscal year, row not reconciled:** `LEDGER_RECORD` (same gate as edit and delete today). Default roles: `admin`, `treasurer`.
- **Move, row reconciled (either kind) or dated in a prior fiscal year:** `LEDGER_MANAGE`. Default roles: `admin`. Rationale: a settled period is restated, which matches why `reopen` is `LEDGER_MANAGE`, and it gives a second set of eyes on the only moves that change a statement that may already be filed or sent. **Verify whether the treasurer role actually holds `ledger.manage` in production** (original binding was admin only, roles are editable in the UI). If he does not, the late-discovered case needs an admin to click it; I judge that a feature, but it is Open Question 2.
- **Delete:** gate unchanged (`LEDGER_RECORD`); adds the reason and audit snapshot. Prior-fiscal-year delete staying at `LEDGER_RECORD` is an existing inconsistency worth a follow-up, not v1 scope.
- Every gate is enforced **in the route body** (`auth()` + `hasFeature()`), not just in the proxy or by hiding a button, per the project's admin-protection rule. The UI shows or enables the control; the server decides.
- Self-targeting: the person who entered the row may move it (that is the use case). The audit row records actor and reason so a second person can see it. A `LEDGER_RECORD` holder cannot move a reconciled or prior-year row; only `LEDGER_MANAGE` can.
- Surfaces: nothing public, nothing member-facing, no `/access-pending` change. A member with no ledger feature gets 403 from the route exactly as today. OAuth versus password sign-in is irrelevant (session-based, same as every ledger route).

## Gaps the Request Didn't Address

1. **Audit with no reader.** `ledger_audit_log` is write-only today. A required reason that nobody can read back is not a control. Resolution: (v1 minimum) a per-row "History" disclosure in the register for moves, since the row survives; and a read-only "Recent corrections" list (last 90 days, moves and deletes, with actor, reason, from/to, amount) for `LEDGER_VIEW` holders on the Compliance page, so the board can see reclassifications of settled money. If the list is too large for v1, ship the per-row History and file the list as a follow-up, **but** deletes must still write a full row snapshot now because the row will be gone.
2. **DELETE leaves no trace and can destroy a sent receipt.** Hard delete writes no audit row and cascades a sent `ledger_acknowledgments` row away. Resolution: (a) write an audit row with a full snapshot (date, amount, flow, fund, bank account, category, party, memo, donor, check number, status, reconciliation state, whether it had an acknowledgment) inside the same DB transaction as the delete; (b) **refuse** a delete when an acknowledgment with `sent_at` set exists ("A receipt was already sent to the donor for this gift. Record a refund entry instead.") and warn, not block, when the acknowledgment is unsent; (c) require a reason. Pre-existing risk, but this feature makes delete a documented path, so it ships hardened. (A sent acknowledgment can exist only on Foundation income, so this does not touch the Club Administrative-to-Activity case.)
3. **The system cannot detect this mistake.** `adminPublicIncomeCount` keys off the category's fund kind, which is forced to equal the fund's kind. A Zeffy-method income row in Administrative that is not dues is the real tell. Out of scope for v1; recommend a backlog item for a "Zeffy / public-category income in Administrative" guardrail. Mention in the release note so the treasurer knows why no flag fired.
4. **PATCH silently ignores `fundId`.** A direct caller sending `fundId` to PATCH gets 200 and no change, a misleading no-op. Resolution: 400 with "Use Move to another fund." so the invariant is explicit and tested.
5. **Category must be re-decided on a move.** Category fund kind and flow must match the destination. Resolution above (dialog forces a pick; Activity income defaults to "Public donations"; null allowed). Without this the move either fails or leaves an invalid category (budget, 990 mapping, and the `adminPublicIncomeCount` check all key off it).
6. **Budget-line link** clears on a move (an expense row's line belongs to the old fund). Reuse the DECISION-061 auto-clear and the existing "budget-line link was cleared" toast wording.
7. **Legacy reconciled rows are not locked by PATCH/DELETE** and **bank-account edits are unvalidated and unaware of open-session matches.** See Pass 0. Treat the validation and open-session-match guard as in scope for Flow 3; the legacy-toggle lock is an architect ruling (Open Question 5).
8. **Edit/Delete render on locked rows.** Locks show as a 403 toast after the click. For a feature whose whole point is "I need to fix an old row," show the lock reason up front (small lock label on the row and an explanation of the right path). Also fix the 403 copy for approved rows, which currently says nothing about what to do next.
9. **The sweep needs a physical step first.** The guide says to write the check or transfer and then record it. The Move dialog must not imply the sweep has happened. "Record sweep now" prefill is a convenience, not an automation; the board-minute reference cannot be prefilled.
10. **Gift acknowledgment caveat (existing, not new).** A gift made through the club-side Zeffy form is legally a gift to the Club. After the move and sweep, the Foundation-side leg is a transfer-in with no donor attached (a donor is a fact about one row, DECISION-099), so no Foundation acknowledgment letter will be generated for it. The guide's existing caveat covers this; the release note should not promise acknowledgments.
11. **Concurrency.** Move must run in one transaction with the row locked (`SELECT ... FOR UPDATE`) and every guard rechecked inside it: an admin may reconcile, move, split, approve or delete the same row at the same moment. A double-click must not write two audit rows.
12. **Empty and error states.** If the row has no legal destination (every row in the Foundation entity, which has one fund): action is disabled with "No other fund in this entity can hold this row." Failure microcopy per Flow 1. Page-load failure of the preview: the dialog shows the standard error card and keeps Confirm disabled.
13. **Mobile.** The register is a wide table; the dialog must work at 360px (stack the two-column "before / after" summary, 44px tap targets, the reason textarea not hidden by the keyboard).
14. **Brand and dialogs.** Confirm via `<ConfirmDialog>` or shadcn `Dialog` (the dialog has a textarea and a select, so it is a `Dialog` with a final confirm button, not a bare `ConfirmDialog`; no `window.confirm`). Cards `rounded-2xl`, buttons `rounded-lg`, destructive styling only on Delete. Money wording: "Moved", never "Reversed" or "Voided", since neither exists. UI copy must say what actually happened to the books.

## Adversarial Pass

- **Direction bypass.** A client can post any `destFundId`. The server derives the decision from the two fund rows via the policy module; no client "toward public" flag exists. Away-from-public refused with a specific reason.
- **Cross-entity bypass.** Destination fund must belong to the row's entity (v1). The row's `bankAccountId` must therefore also belong to that entity, which it already does for rows created via the UI; the server asserts it rather than trusting the stored value.
- **State-machine shortcuts.** Hitting the move route directly on an approved, rejected, pending, transfer-leg, dues-synced, or already-moved row must fail with a specific error, not a 500. Calling the move route on a reconciled row without `LEDGER_MANAGE` is 403.
- **Self-targeting.** See Permissions. No role or permission is changed by this feature.
- **Input boundaries.** Reason empty, whitespace only, over 500, Unicode, RTL; `categoryId` from the wrong fund or flow; `fundId` that is not a UUID or does not exist (404 vs 400 consistent with sibling routes). Validate server-side before the DB, not only in the dialog.
- **Enumeration / redirects.** Admin-only, authenticated; no `callbackUrl`, `next`, or redirect parameter is introduced. Not applicable.
- **Repeat and replay.** Moving a row back (Activity to Administrative) is away-from-public and refused; the original mistake cannot be "undone" by a second move. Undo is: if wrong again, delete and re-enter (unreconciled) or reopen. Document this in the dialog and the guide.
- **Report leakage.** Moved amounts change what members already see on `/members/financial-reports` for Administrative and Charitable. No new data is exposed; the reason text must never be rendered on any member-facing surface, and the audit reader must be ledger-gated.

## Out of Scope (confirm with user)

- A `voided` status or reversal-pair model. Not needed for the stated problem (see "Which of move / cancel").
- Cross-entity moves (Foundation Charitable to Club Activity or the reverse). Different shape: entity and bank account change, acknowledgments and donor links come into play. If the donation was actually recorded on the Foundation books (Open Question 1), delete (unreconciled, no sent acknowledgment) and re-enter as Club Activity income, then sweep.
- Away-from-public fund moves (Activity to Administrative income). Deny-by-default in v1; follow-up if needed.
- Moving transfer legs, dues-synced rows, approved, rejected, or pending rows.
- Editing a reconciled row's amount, date, flow, bank account, or check number (stays locked; reopen).
- Auto-sweep, or any automatic follow-on posting after a move. The sweep stays a deliberate, minuted, separately confirmed act.
- A "Zeffy income in Administrative" guardrail (backlog).
- A general audit-log browser beyond the corrections list described in Gap 1.
- Tightening the prior-fiscal-year DELETE gate.
- Voiding approved disbursements (needs a board-visible mechanism).

## Open Questions (with adopted defaults; proceed unless overruled)

1. **Which side was the donation entered on?** Default adopted: **Club Administrative Fund on Administrative Checking** (so the fix is a same-entity fund move, then the existing sweep). If it was entered on the Foundation books, v1 does not cover it (delete and re-enter, see Out of Scope). Please confirm which fund the row sits in.
2. **Does the treasurer hold `ledger.manage` in production?** Default adopted: reconciled and prior-year moves need `LEDGER_MANAGE`. If the treasurer lacks it, an admin performs those moves; if the board prefers, lower that tier to `LEDGER_RECORD` (the audit trail and the "corrected statement" signal remain the controls).
3. **Away-from-public moves.** Default adopted: refused in v1. Confirm the treasurer is fine deleting and re-entering the rare dues-mis-booked-as-Activity case.
4. **Is the donation in a month that was already reconciled and/or sent to the board?** Default adopted: handled by the carve-out (no reopen) and the corrected-statement warning. Not blocking.
5. **Legacy `reconciled = true` rows (no session) are unlocked in PATCH/DELETE today.** Default adopted: the new move action treats them as reconciled; whether to also fix PATCH/DELETE is deferred to the architect.
6. **Delete reason and receipts.** Default adopted: a reason is required for every delete; a sent acknowledgment blocks deletion; an unsent one is warned and removed with the row.
7. **Prior-year rows.** Default adopted: allowed under `LEDGER_MANAGE` with a stronger warning (not refused outright like DECISION-068's category merge, because late discovery is the realistic case here and the move changes no bank figure). Confirm.
8. **Sweep prefill.** Default adopted: "Record sweep now" opens the existing form prefilled; the board-minute reference is required and entered by the treasurer.

## Recommendation: Phase 2 (architect) IS required

Do not take the accelerated path. This work:
1. **Relaxes an existing invariant** (fund immutability) and **amends DECISION-036 item 4 / DECISION-099** with a second reconciled-lock carve-out. DECISION-099's own stated rule (an allowlist of one field, one pure helper, an audit trail) needs an explicit ruling to extend, and whether the carve-out lives on a dedicated endpoint or PATCH is a structural call.
2. **Adds a new policy module** (`ledger-fund-move-policy.ts`, sibling of `ledger-transfer-policy.ts`) that must stay consistent with the directional matrix, and a ruling on whether the two should share a single decision function so the firewall rule lives in one place (CLAUDE.md duplication rule).
3. **Generalizes `ledger_audit_log` again** (new `action` values, first reader, row-snapshot payloads for a deleted subject).
4. **Touches the firewall invariant** (Art. VII §3(g)): the architect should confirm the toward-public-only rule rather than leave it to tech-lead.
5. **Durable-claim exception does not apply** (no email, no `sentAt`, no "sent" claim is written), so no `sendEmailForDurableClaim()` requirement. Noted for the record so Phase 2 does not need to re-derive it. The only email-adjacent effect is the existing "corrected statement" panel, which is read-side and unchanged.

Architect asks, in order: (i) dedicated `POST /api/admin/ledger/transactions/[id]/move` versus PATCH carve-out; (ii) legacy `reconciled = true` rows; (iii) shared direction function versus sibling policy; (iv) `ledger_audit_log` shape and reader; (v) hardening bank-account validation on POST/PATCH in the same increment or separately.

## Handoff Notes For Phase 2 and 3

- Do not add `fundId` to PATCH. If it is sent, return 400.
- Unit tests that must exist: direction matrix (every cell, both flows), balance-direction rule, carve-out allowlist (move permitted on reconciled; amount/date/flow/bank/check-number still refused), each lock state (approved, rejected, pending, transfer leg, dues-synced, legacy-reconciled, session-reconciled, prior-FY), audit row written in the same transaction and absent on a refused move, no-op on same fund, delete refused with a sent acknowledgment, delete snapshot written.
- Audit `action` values to settle in Phase 3, following the existing naming (`donor_linked_on_reconciled_transaction`): a transaction-moved action, a transaction-deleted action. `before`/`after` carry only changed fields (fund id and name, category id and name); `details` carries the reason, FY, reconciliation session id if any, and whether a sent statement month is affected.
- Re-check Phase 1 gaps 1, 2, 4, 7 and 8 at Phase 6; they are the ones most likely to be dropped as "nice to have."

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-10-01 | **Owner:** architect | **Status:** complete

## Verdict

**Approved with suggestions.** The shape is right: a dedicated, audited, policy-gated "move to another fund" action plus a hardened DELETE, no `voided` status, no new column, no new `FEATURES` key, no dependency, no email. The rulings R1 to R8 below are **binding on Phase 3**. Four items are REQUIRED (the feature is unsound without them): R3b (the reconcile-toggle bypass), R5 (audit writer plus a minimal reader), R6 (delete hardening), and R2c (the cross-reference between the two direction policies). Everything else is a suggestion Phase 3 may adjust with a note.

### Corrections to Phase 1 (read these first)

1. **The reconciled lock is weaker than Phase 1 reported.** Phase 1 found that legacy-reconciled rows (`reconciled = true`, no session) are unlocked in PATCH/DELETE. Worse, `POST /api/admin/ledger/transactions/[id]/reconcile` is gated only `LEDGER_RECORD`, has no session check, and **unconditionally writes `reconciledSessionId: null`** (both directions). The register renders `ReconcileToggle` on every posted row. So any `LEDGER_RECORD` holder can un-reconcile a row cleared by a CLOSED session (clears the session pointer, silently breaks that session's tie-out, unlocks PATCH/DELETE). This predates the feature and is a bypass of DECISION-036. It matters here because R4's tier (`LEDGER_MANAGE` for reconciled rows) is decorative while the toggle can strip the lock first. See R3b.
2. **Phase 1's "delete and re-enter on the Club books" advice for a Foundation-side row is unsafe and is withdrawn.** If the donation physically landed in Foundation Checking, a re-entered Club Activity row needs a Club bank account the cash never touched, so the Club account's book balance would diverge from its bank and fail reconciliation. If the row is on the Foundation books, the cash is already where a sweep would put it; there is nothing to move. It is at most a category correction, plus a legal-characterization question (gift to the Club vs gift to the Foundation) that is a board matter, not a ledger operation. Phase 3 should not design a "Foundation to Club" path, and the guide/release note must not suggest one.
3. **The compliance guardrails are not a detector for the reverse direction.** Phase 1 itself found `firewallViolations` counts only transfer groups and `adminPublicIncomeCount` keys off a category whose fund kind is forced equal to the fund's kind, so a single mis-booked row never trips either. So the deny-by-default policy module is the **preventer**; the guardrails stay exactly as they are and are not relied on for this feature. The real gap (public money entered directly in Administrative, which is the treasurer's own mistake) is a detector backlog item, B-93.
4. **"A second set of eyes" is not true of the LEDGER_MANAGE tier in production.** `ledger.manage` is bound to `admin` only (migration 0045), there are 2 admin users, and the treasurer is one of them. The tier guards against a future recorder-only role; it is not a two-person rule. The controls that actually matter here are the required reason, the in-transaction audit row, and a board-visible reader (R5). Do not describe the tier as a second approver in the guide or release notes.

## Placement

- **Route:** `src/app/api/admin/ledger/transactions/[id]/move/route.ts` (new; sibling of `split/`, `reconcile/`, `acknowledge/`). `POST` executes, `GET` returns the preview. Thin shell: `auth()`, feature checks, body validation, call into queries, map result to status.
- **Pure policy (client-safe, no DB, no Next imports):** `src/lib/ledger-fund-move-policy.ts`, beside `ledger-transfer-policy.ts`. Reuses the `FundRef` type by `import type` from the transfer policy. Exports the direction decision (`checkFundMove`) only.
- **Pure row-lock classifier (client-safe):** one small pure function returning why a row cannot be moved/edited/deleted (`approved | rejected | pending | transfer_leg | dues_synced | reconciled_session | reconciled_legacy | null`) plus `isTransactionReconciled(row) = row.reconciled || row.reconciledSessionId != null`. Tech-lead chooses its home (a new `src/lib/ledger-transaction-lock.ts` is my preference over growing `ledger.ts`). It is the **single source** for the move route and the register's up-front lock labels (Phase 1 Gap 8); that is two consumers, so it is a real shared decision, not speculative.
- **DB orchestration:** new `src/lib/ledger-fund-move-queries.ts` (precedent: DECISION-049/061/066, do not grow the 5,000-line `ledger-queries.ts`). One function runs the whole move inside `db.transaction`: `SELECT ... FOR UPDATE` on the row (precedent `.for("update")` in `documents-queries.ts`), re-validate every guard on the locked row, update, write the audit row. The preview calls the **same** evaluation function the POST calls (no second implementation that can drift).
- **Audit:** new `src/lib/ledger-audit.ts` (server-only): action-name constants, a typed builder/parser for the JSON `details` payload, `recordLedgerAudit(tx, ...)` writer, and the reader (R5). Existing `RECONCILED_DONOR_LINK_AUDIT_ACTION` stays where it is.
- **UI:** `MoveTransactionDialog` client component in `src/components/admin/ledger/` (shadcn `Dialog`, not a bare `ConfirmDialog`, because it carries a select and a textarea; the final confirm is a button inside it). Delete also needs a reason textarea, so it likewise becomes a `Dialog` (check whether `ConfirmDialog` already supports children before inventing a variant). The register page and `compliance/page.tsx` stay Server Components; only the dialogs and the existing `TransactionActions` are client. The "Recent corrections" list is a server-rendered section on the existing `/admin/ledger/compliance` page.
- **Navigation / proxy:** no new admin area, no `ADMIN_NAVIGATION` change, no new page. The proxy-derived protection (DECISION-082) and `admin-page-feature-gates.test.ts` are unaffected; the new API route gates itself in its own body.
- **Dependencies:** none. (`drizzle-orm` already provides `.for("update")` and `db.transaction`.)
- **Next.js 16 note:** the project's own warning applies. Before writing the GET/POST handlers, check `node_modules/next/dist/docs/` for route-handler `params`/caching conventions and mirror the sibling routes (`params` is a Promise there).

## Rulings

### R1. Dedicated `POST .../[id]/move`, not a widened PATCH (confirmed)

- PATCH is unchanged in its reconciled guard: `RECONCILED_LOCK_CARVEOUT_FIELDS` stays `["donorId"]`, `isWithinReconciledLockCarveout()` is not touched, and DECISION-099 item 4's three textually separate guards stay separate. A PATCH body containing `fundId` returns **400 "Use Move to another fund."** (today it is a silent 200 no-op; the explicit error makes the invariant testable).
- **What makes it architecturally distinct from the DECISION-099 `donorId` carve-out:**
  1. *Inertness is a different kind of claim.* `donorId` is read by nothing in any financial computation; its carve-out is "an absolute no-op to the numbers". `fundId` is read by the monthly statements, the guardrails, aged-fund aging, the 990 panel and impact reporting; a move **deliberately changes those**. The only thing it provably cannot change is the **reconciliation** arithmetic (tie-out is keyed on `bankAccountId`; verified: no `fundId` reference in `reconciliation.ts`, `reconciliation-queries.ts`, or the close/reopen/match routes, only `create-from-bank-line` reads it, to insert). So the amendment is narrower and relative: "fund reclassification within an entity is inert to a closed session's arithmetic", not "inert".
  2. *It is conditional, not value-neutral.* `donorId` accepts any value; a move is admissible only for one policy cell (R2), so it needs a decision function a generic edit route has no place for.
  3. *It needs controls DECISION-099 did not:* a required reason, a server-computed preview, `FOR UPDATE`, a state-dependent permission tier (R4), a stale-write check, and a board-visible reader (R5). DECISION-099 item 7 (audit REQUIRED) is honored and strengthened.
  4. *It is not an edit.* Body is exactly `{ destFundId, categoryId | null, reason, expectedFundId }` (any other key is 400). Amount, date, flow, bank account, check number, memo, publicNote, donor are not representable in this request. The allowlist-by-shape discipline of DECISION-099 item 2 is thus preserved structurally (the route has no field it could be tricked into editing).
- `expectedFundId` (the fund the client was looking at) gives stale-write and double-click safety: after the first request commits, a repeat sees the row already in the destination (409, **no second audit row**). Combined with `FOR UPDATE` this closes Phase 1 Gap 11.
- Blocked-state responses follow the sibling convention (403 with a specific, actionable message; policy denial 403 with the policy reason as in DECISION-058; same-fund/stale 409).

### R2. Direction rule as a pure policy module (confirmed, with a narrowing and one REQUIRED cross-reference)

a. **Home and shape.** `ledger-fund-move-policy.ts`, pure, keyed on fund `kind` and entity identity, never hard-coded ids, deny-by-default, one `if` per matrix cell with its own reason text and a unit test per cell, in the style of `checkTransferDirection()`. Signature along the lines of `checkFundMove({ flow, from: FundRef, to: FundRef })` returning `{ allowed: true } | { allowed: false; code; reason }`, where `code` lets the route tell "same fund" (409) from "policy" (403).

b. **v1 allows exactly one cell: same entity, `flow = income`, `administrative` to `activity`.** The analyst's principle (a move must not decrease a public fund's balance nor increase Administrative's) is the *justification*; the *implementation* is an explicit allow-list of cells, not sign arithmetic, so it cannot be fooled by relabelling. The expense cell (`activity` to `administrative`) is the mirror image and is **denied in v1 with its own reason ("Moving expenses between funds is not supported yet")**, kept as a separate branch with a unit-test slot so enabling it later is a one-branch flip. Rationale: the treasurer's need is income; an expense move drags in fund-coupled state the Phase 1 design does not cover (budget-line link, DECISION-061 auto-clear; `publicNote`/`beneficiaryCause`, which render on `/members/impact`; receipt/approval semantics). Note the expense cell is the more *compliance-valuable* one (it cures Activity money spent on Club operations), so it is the first follow-up (B-96), and if Phase 3 finds the coupling small it may flip the branch in this increment with the three couplings handled and tested. Everything else is denied: away-from-public income, any cross-entity pair, any unknown `kind` (a future `scholarship` fund falls through to deny), same fund (no-op).

c. **REQUIRED: the two policies must cross-reference each other and must NOT be merged or "reconciled".** `checkTransferDirection()` blocks Administrative to Activity *as a movement of value* ("Activity income must stay publicly-sourced"). The move policy allows the same pair *as a reclassification of a row's provenance* ("this income was public all along; the Administrative booking was the error"). They answer different questions, so a shared function would have to either open the transfer (wrong) or close the move (defeats the feature). Put a comment block in both files and a unit test asserting the two intentionally differ for `administrative` to `activity`. This also answers Phase 1's "shared direction function versus sibling" question: **sibling, no shared function** (CLAUDE.md duplication rule is not triggered: two places, two different decisions).

d. **The accepted residual risk, stated plainly.** The system cannot verify provenance. A genuinely-Administrative income row (tail-twisting, say) can be moved into Activity. It is one-way (the reverse move is refused and Activity to Administrative transfers are blocked), so a wrong or malicious move is a ratchet; it is "fail toward restriction" (money in Activity can only leave via a minuted sweep), which is why it is the safe cell to allow. Compensating controls: dues-synced rows are refused by construction; required reason; attributed audit row; board-visible reader (R5); the preview states the ratchet in plain words ("this cannot be moved back; if wrong, delete and re-enter, or reopen"). Phase 3 must put the ratchet sentence in the dialog.

e. **Entity scope: same-entity only in v1, cross-entity OUT.** Reasons: (1) accounts belong to entities, so a cross-entity move necessarily changes `bankAccountId`, the one column reconciliation is keyed on and the reconciled lock must never let move; the whole carve-out safety argument (R3) collapses. (2) A same-entity move leaves the entity's total balance and every bank-account balance unchanged; a cross-entity move changes per-entity statements, gross receipts and the 990 determination inputs. (3) Foundation to Club is the one-way valve and Club to Foundation is the minuted Sweep. (4) See Correction 2: there is no safe Foundation-to-Club correction to offer. The route asserts that the row's `bankAccountId` belongs to the destination fund's entity rather than trusting the stored value.
- **If the treasurer's row is on the Foundation books:** nothing to move (Correction 2). **If it is Club Administrative (the likely case): the one allowed cell.** **If it is already in Activity:** nothing to move; only the sweep remains. The design needs no special-casing for any of the three.

### R3. The reconciled-row carve-out (safe, with conditions)

a. **Safe, as a second narrow amendment of DECISION-036 item 4, by the same form of argument as DECISION-099.** Reconciliation is keyed on `bankAccountId` and bank-line matches; a same-entity fund change cannot alter any session's opening/closing/tie-out arithmetic, any match link, any bank-account balance, or the entity total. The lock keeps its full meaning for amount, date, flow, bank account, check number, memo-class edits (PATCH), and for DELETE and split. Approved, rejected, pending, transfer-leg and dues-synced rows get **no** carve-out.

b. **REQUIRED precondition: `POST .../[id]/reconcile` must refuse a row with `reconciledSessionId` set** (403, same wording as PATCH/DELETE: reopen the closing session). Without this the carve-out reasoning is moot because the lock can be stripped in one click by the lowest-privilege ledger role, and the R4 tier is cosmetic. This is a small, security-relevant fix of an existing DECISION-036 bypass, in scope for this increment (guard plus unit test; no UI redesign). Rows with only the legacy mark are still toggleable (that mark is by design a per-row, reversible, `LEDGER_RECORD`-level mark).

c. **Reconciled means `isTransactionReconciled(row)` (either mark).** The move treats a legacy-reconciled row as reconciled for tiering (R4). For **PATCH and DELETE, closing the legacy hole is NOT in this change** (R7): it would newly lock rows the treasurer can edit today (likely including Quicken-seeded rows from the 2026-07-20 import, which predate sessions), and the only unlock would be the very toggle that is the other half of the problem. That is a design decision about retiring the legacy toggle (B-92), not an incidental fix. Visibility instead of behavior change: the delete snapshot records `reconciled` and the session pointer. Accepted residual: a `LEDGER_RECORD` holder can un-toggle a *legacy* mark and then move at the lower tier; the audit row still records it and the legacy mark never froze any tie-out.

d. **Amendment wording** (for DECISION-109): "DECISION-036 item 4, as already narrowed by DECISION-099, is further narrowed: a same-entity fund reclassification of an income row, performed through the dedicated move endpoint under the controls in DECISION-109, is permitted on a reconciled row. The 'any field' lock otherwise stands. `RECONCILED_LOCK_CARVEOUT_FIELDS` is unchanged."

### R4. Permissions (confirmed; no new key)

- No `FEATURES` change, no role-binding migration (the "no new key; nothing off-by-default" rule from the architecture notes is satisfied trivially).
- Route order: `auth()` (401), `LEDGER_RECORD` (403), load the row, classify, then compute `needsManage = isTransactionReconciled(row) || fiscalYearOf(row.txnDate) < currentFiscalYear()` **server-side from the locked row** (never from the client) and require `LEDGER_MANAGE` (403, message names the requirement) when true. The tier is evaluated inside the transaction on the `FOR UPDATE` row so a concurrent reconcile cannot slip a row from the lower tier to the higher one unseen.
- Prior-fiscal-year rows are movable under `LEDGER_MANAGE` (not refused outright as DECISION-068's merge is): late discovery is the realistic case and a same-entity move changes no bank figure. The preview carries a stronger warning.
- DELETE's gate stays `LEDGER_RECORD` (unchanged; the prior-FY inconsistency is B-97).
- Gates live in the route body, not only in the UI. The register may hide/disable the control, the server decides. GET (preview) uses the same two-step gate and reveals nothing beyond what the register already shows the caller.
- See Correction 4 on how to describe the tier.

### R5. Audit: required reason, in-transaction write, and a minimal reader IN SCOPE (REQUIRED)

- **No new column; no migration.** `ledger_audit_log` already has `actor_user_id`, `action`, `target_transaction_id`, `before`, `after`, `details`, `created_at`, with indexes on target and `created_at`. New action values: a transaction-moved action and a transaction-deleted action (exact strings are Phase 3's, following `donor_linked_on_reconciled_transaction`). Update the `action` comment block in `schema.ts` (documentation only; the column is `text`).
- `before`/`after`: JSON strings, changed fields only, **self-describing** (fund and category *names and slugs* as well as ids) so the record stays readable if a category is later deactivated or renamed. `details` for these two actions is a JSON string produced and parsed by one typed helper in `ledger-audit.ts` (carries `v: 1`, `reason`, fiscal year, reconciliation session id if any, tier used, and "sent statement month affected"); the parser degrades to the raw string rather than throwing. Rationale for JSON-in-`details` over a new `reason` column: only two actions need it, and the audit table's convention is text columns holding JSON, so no schema churn.
- **Written in the same `db.transaction` as the change; absent on any refused or no-op request.** Never write into `memo`, `publicNote` or any user-visible row field as a substitute for the audit row.
- **Delete snapshot** is the full row (date, amount, flow, fund, bank account, category, party, memo, donor, check number, status, `reconciled` and session id, `duesPaymentId`, transfer group, and whether an acknowledgment existed and whether it was sent) plus the actor and reason. Because `target_transaction_id` is `ON DELETE SET NULL`, the delete audit row's FK is nulled the instant the row is deleted; the snapshot JSON therefore carries the original row id, and the reader selects delete rows by `action` and date, never by FK. (The same applies to a moved row later deleted: its move row detaches. Acceptable; the snapshot at delete time records the then-current state.)
- **Writer helper.** There are already seven `insert(ledgerAuditLog)` sites (two in the PATCH route, one each in the acknowledge route, `reconciliation-queries.ts`, `ledger-category-queries.ts` x2, `ledger-acknowledgment-letter-queries.ts`). DECISION-066 item 1 deferred the shared helper "until a second real caller"; that threshold passed long ago. New writers (move, delete) MUST use `recordLedgerAudit(tx, ...)`; migrating the seven existing sites is B-95 (not in this change, to keep blast radius small).
- **Reader: minimal and in scope**, because a reason nobody can read back is a ritual. Exactly one read, `getRecentLedgerCorrections()` in `ledger-audit.ts`: move and delete actions only, bounded (recent window and row cap; Phase 3 picks the numbers), rendered as a read-only "Recent corrections" section on the existing `/admin/ledger/compliance` page (date, who, Moved/Deleted, amount, from to, reason, "settled period" marker), no wider than that page's existing gate (LEDGER_VIEW holders: admin, treasurer, board_member, which is the intended board visibility). It is the *only* place deletes are readable, so it is the load-bearing reader. A per-row "moved from" marker in the register (needs a batched lookup on `ix_ledger_audit_log_transaction`) is a **suggestion**, not required. Not a general audit browser (out of scope).
- **Member-surface firewall.** `ledger-audit.ts` must never be imported from `src/app/members/**`, `src/app/api/members/**`, `financial-report-queries.ts` or any member-exposed module; the reason text is free text that may name a person. Add a small test (grep-style import guard) if one is cheap.

### R6. Cancel = hardened hard DELETE; no `voided` in v1 (confirmed)

- A `voided` status would only ever apply to **unreconciled, unapproved, posted** rows, which is exactly the set DELETE already handles. Reconciled rows represent a real bank line (a void would move a closed session's arithmetic) and approved rows are board-visible finality. So `voided`'s sole added value over DELETE is retaining the row, and the self-contained audit snapshot (R5) delivers that retention. Add the cost side: every sum keyed on `status = 'posted'` would be fine, but the register, reconciliation candidates, dues sync, acknowledgments, receipt rules and report fingerprints would each need an explicit decision. Reversal pairs are rejected for the reasons in Phase 1 (they double every income/expense sum). Revisit `voided` only if approved-disbursement voiding (a board-visible mechanism) is ever commissioned.
- **Hardening, all REQUIRED in this increment** (the feature makes delete a documented path, and today it is a silent data-loss path):
  1. Required `reason` in the request body (a JSON body on DELETE; never a query parameter, since URLs are logged and the reason is free text).
  2. Row snapshot audit row in the same transaction (R5), for the pair when a transfer pair is deleted.
  3. **Refuse (409, "A receipt was already sent to the donor... record a refund entry instead") when any `ledger_acknowledgments` row for the transaction has `sent_at` set.** The FK is `ON DELETE CASCADE`, so today a delete destroys the IRS-substantiation record. An unsent acknowledgment is warned about up front and removed with the row (response reports it). Run the check for each row of a deleted pair.
  4. `SELECT ... FOR UPDATE` and re-check the guards inside the transaction; a double-click must not write two audit rows.
- **Sent-statement month.** `financial_report_sends` is a durable "this was sent" record and is **read-side only here**: the existing totals-fingerprint comparison already flips the panel to "Resend Corrected Statement". Move and delete write nothing to it and send nothing. The dialog warning ("the statement for <month> was already sent and will read as changed; a corrected resend will be offered") is read-only, computed server-side by looking up a successful send row for the entity and month. Note month-gating means a delete (unreconciled only) can affect a sent month only for a backdated entry added after the send, so the delete-side warning will rarely fire; the move-side one will.
- **Month-gating side effect to test:** moving an *unreconciled* Administrative row to Activity removes a member-exposed gating row (`isMonthGatedForEntity` counts unreconciled rows in member-exposed funds), which can un-gate a month. That is correct behavior, but it needs one explicit test so it is a known property, not a surprise.

### R7. Phase 1's incidental findings, sorted

| Finding | Ruling |
|---|---|
| Reconcile toggle strips closed-session lock | **IN** (R3b). Pre-existing DECISION-036 bypass, precondition for the tier. |
| DELETE writes no audit row, cascades a sent acknowledgment | **IN** (R6). |
| PATCH silently ignores `fundId` | **IN** (R1, 400). |
| `bankAccountId` not validated on PATCH/POST (cross-entity id accepted, bad id is a 500) | **IN, as a separable step**: exists + same entity as the row + active, 400 not 500. The Phase 1 "wrong bank account" answer (edit the account) is unsafe to advertise without it. Make it a shared helper; the move route needs the same entity assertion. |
| Bank-account change on a row matched in an OPEN session (match link left pointing at another account's bank line) | **IN, narrowly**: when `bankAccountId` changes, refuse if the row has a match (reuse `getMatchForTransaction`, the guard `/split` has). Other fields on matched rows are untouched. |
| Legacy-reconciled rows unlocked in PATCH/DELETE | **OUT** to B-92 with the toggle's future (R3c). |
| Matched-in-open-session rows otherwise editable (non-bank fields) | **OUT**, harmless to reconciliation, folded into B-92. A fund move on such a row is allowed (fund is not in the match arithmetic). |
| Register shows Edit/Delete on locked rows | **IN** (UX): show lock reason up front using the shared classifier (see Placement). |
| 403 copy for approved rows says nothing about the next step | **IN** (copy only). |
| Zeffy/public-income-in-Administrative detector | **OUT**, B-93. Mention in the release note that no flag fired because none can today. |
| `syncDuesDelete` hard-deletes a ledger row with no audit; deleting a dues-synced row via the register orphans the dues payment's ledger link; prior-FY delete at `LEDGER_RECORD` | **OUT**, B-97 (found while reading `dues-ledger-sync.ts`; the new delete snapshot at least records `duesPaymentId`). |

### R8. Invariant checklist

- **Schema is the source of truth.** No new column or table, so no `schema.ts` structural change (comment update on `action` values only) and no migration. If Phase 3 disagrees and wants a `reason` column, the migration must be idempotent (`ADD COLUMN IF NOT EXISTS` inside a guarded `DO $$` block, as in 0102) and its filename number is a **placeholder only**: database-admin re-derives the real next-free number at Phase 4 start (`ls drizzle/migrations/*.sql | sort | tail -3`; today the latest is 0108).
- **Permissions are the only gating mechanism.** No environment flag, no kill switch. "Off by default" is not needed: the feature only widens what existing holders can do, within existing tiers.
- **Server/Client boundary.** Pages and the reader stay Server Components; `'use client'` only for the two dialogs and existing row actions. Policy and classifier are pure and client-safe so the dialog can pre-disable, but the **server is the authority** and recomputes.
- **No native dialogs; brand.** shadcn `Dialog`; destructive styling only on Delete's confirm; `rounded-2xl` cards, `rounded-lg` buttons; money wording "Moved"/"Deleted", never "Reversed"/"Voided"; UI says "Emailed" nowhere (no email).
- **No email, no durable-claim exception.** Neither the move nor the delete sends mail or writes `sentAt`/a success row; `financial_report_sends` is read-only here. `sendEmailForDurableClaim()` is not applicable. No board notification email in v1 (board visibility is the compliance-page reader); if one is ever added it must go through `sendEmail()` and the deny-by-default rules, and gets its own review.
- **No personal data in the repo.** No member address, account number, donor name or real treasurer detail in fixtures, tests, migrations or docs; use `example.com`. Reason text is runtime data only.
- **Duplication rule.** Category-vs-fund-kind-and-flow validation already exists in three transaction routes (POST, PATCH, `handleTransfer`). The move MUST call a shared helper rather than become a fourth inline copy (extract it; migrating the three existing sites is B-94). Same for the lock classifier (see Placement) and the audit writer (R5).
- **Dues-synced rows** (`duesPaymentId` set) are refused by the move (Administrative income by construction; `syncDuesUpdate` assumes it).

## Proposed decision text (orchestrator to add to `docs/decisions.md`; architect did not edit it)

**DECISION-109: Same-entity fund reclassification of an income row via a dedicated `POST .../transactions/[id]/move` endpoint; second narrow carve-out of the reconciled lock (amends DECISION-036 item 4, extends DECISION-099)** (Status: Resolved; Date: 2026-10-01). Decision: (1) fund immutability, which no prior decision recorded and which was an inc1 default, is relaxed for exactly one operation: moving an income row from an entity's Administrative fund to its Activity fund. (2) It is a dedicated endpoint (POST execute, GET preview) with body `{ destFundId, categoryId, reason, expectedFundId }`; PATCH does not accept `fundId` (400) and its `donorId`-only carve-out is unchanged. (3) The direction decision is `checkFundMove()` in a pure sibling of `ledger-transfer-policy.ts`: deny-by-default allow-list of one cell; expense and cross-entity denied; the two policies intentionally differ for Administrative to Activity (reclassification of provenance vs movement of value) and must not be merged. (4) The reconciled lock is narrowed again: a same-entity fund reclassification is permitted on a reconciled row because reconciliation is keyed on bank account, so session arithmetic, match links, bank balances and entity totals cannot change; approved, rejected, pending, transfer-leg and dues-synced rows stay fully locked. (5) Tiering without a new key: `LEDGER_RECORD` for an unreconciled current-fiscal-year row, `LEDGER_MANAGE` for a reconciled or prior-fiscal-year row, evaluated on the locked row. (6) Required precondition: the legacy reconcile toggle may not clear a closed-session pointer. Rationale: the treasurer's correction need is real and recurring; the alternative (delete and re-enter) destroys history, is impossible on reconciled rows, and the alternative of a general editable fund field would reopen the firewall. Residual risk: provenance is not machine-verifiable and the move is a ratchet; compensated by the reason, attribution, preview and a board-visible reader. Impact: new files per Placement; PATCH 400 on `fundId`; reconcile route guard; no schema change.

**DECISION-110: Ledger audit trail generalized for transaction corrections; DELETE hardened; no `voided` status in v1** (Status: Resolved; Date: 2026-10-01). Decision: (1) `ledger_audit_log` is the single audit sink; new move and delete actions with self-describing JSON `before`/`after` and a typed JSON `details` payload; no new column. (2) A shared `recordLedgerAudit(tx, ...)` writer is introduced (the DECISION-066 "second caller" threshold was passed); existing sites migrate later (B-95). (3) A minimal reader, "Recent corrections" on the compliance page, is part of the feature; the delete audit row is selected by action/date because its FK is nulled by the delete. (4) DELETE requires a reason, writes a full snapshot in the same transaction, refuses when a sent acknowledgment exists, and locks the row. (5) No `voided` status and no reversal pairs: they would add only row retention, which the snapshot provides, and cannot apply to reconciled or approved rows. Impact: `ledger-audit.ts`, DELETE handler, compliance page section, schema comment.

## Proposed backlog text (orchestrator to add to `docs/backlog.md`; architect did not edit it)

- **B-92 — Retire or govern the legacy per-row reconcile toggle.** The toggle is a second reconciliation mechanism that the session workbench supersedes. PATCH/DELETE do not lock a `reconciled = true` row that has no session; rows matched in an open session remain editable (non-bank fields). Decide whether to retire the toggle, lock legacy-reconciled rows, and how existing legacy rows (likely including the Quicken-seeded ones) get released. Do not just add a guard: it would strand rows whose only unlock is the toggle.
- **B-93 — Detector for public money entered in the Administrative fund.** `adminPublicIncomeCount` is blind (category fund kind is forced equal to fund kind) and `firewallViolations` counts only transfer groups. Candidate tell: non-dues income in an Administrative fund with `paymentMethod = 'zeffy'`. This is how the treasurer's mistake could have been caught at entry.
- **B-94 — Consolidate duplicated ledger transaction guards.** (a) Category-vs-fund-kind-and-flow validation: 3 inline copies in `transactions/route.ts` (regular POST and `handleTransfer`) and `[id]/route.ts` PATCH, plus the move. (b) The approved/rejected/reconciled/transfer guard set: PATCH, DELETE, split, move onto the lock classifier, preserving DECISION-099 item 4's ordering for the carve-out.
- **B-95 — Migrate the seven existing `insert(ledgerAuditLog)` sites to `recordLedgerAudit()`.** 
- **B-96 — Deferred move shapes.** Expense moves (Activity to Administrative first: it cures Activity money spent on Club operations; needs budget-line clear, `publicNote`/`beneficiaryCause` handling, impact-page effect), away-from-public income moves, and any cross-entity correction (which needs a board decision, not a ledger feature).
- **B-97 — Dues-synced row deletion and fiscal-year delete gate.** Deleting a dues-synced row via the register orphans the dues payment's ledger link; `syncDuesDelete` hard-deletes with no audit row; prior-fiscal-year DELETE is `LEDGER_RECORD`-gated.

## Notes for Phase 3 (what the design must contain)

1. Name the implementer split. This is not small: policy + classifier + queries + route + audit module + reconcile guard + bank-account validation + DELETE hardening + two dialogs + compliance section. Run the specialist split (api-developer then ux-developer); there is no schema work, so database-admin is not needed unless Phase 3 chooses the `reason` column.
2. Request/response contract for GET preview (lock reason or null, permitted destination fund(s), valid destination categories with a default, balance impact of each fund and "bank account balance unchanged", required tier and whether the caller holds it, sent-statement-month warning, ratchet sentence) and POST (200 with the new fund; 400/403/404/409 map). The "Record sweep now" prefill is a client convenience that opens the existing sweep form with defaults; the sweep POST re-validates everything; the board-minute reference is never prefilled or guessed.
3. Validate server-side before the DB: reason trimmed, 10 to 500 characters, Unicode and whitespace-only cases; ids UUID-shaped (use the existing UUID helper; B-90 notes it is defined three times, do not add a fourth); `destFundId` must be a fund of the row's entity; category must be active, income, fund kind equal to the destination's, or null.
4. Phase 1's unit-test list stands, plus: every policy cell (including the two intentionally-different cells vs the transfer policy), classifier cases (all lock kinds incl. legacy-reconciled and session-reconciled), tier computation (reconciled either kind, prior-FY boundary on the fiscal-year edge, current FY), reconcile route refuses a session-owned row, PATCH `fundId` 400, audit written in the same transaction and absent on refused/no-op/stale requests, double-submit writes exactly one audit row, delete refused with a sent acknowledgment and warned (not blocked) with an unsent one, delete snapshot present and selectable after the FK is nulled, bank-account validation (nonexistent id 400 not 500, cross-entity 400) and the matched-row guard, month un-gating on a move of an unreconciled row, member-surface import guard for `ledger-audit.ts`.
5. Release note and Treasury guide: say "Moved"/"Deleted", describe the ratchet, do not call the tier a second approver, do not promise acknowledgments for the Foundation leg (Phase 1 Gap 10), and say why no compliance flag fired for the original mistake (B-93).
6. Cadence: re-check Phase 1 gaps 1, 2, 4, 7 and 8 at Phase 6 (they are the ones most likely to be dropped as nice-to-have), plus R3b and the R5 reader.

## Handoff

- Verdict: **Approved with suggestions**. Advance to Phase 3.
- Loop-back needed to Phase 1: none. One open factual question remains for the treasurer (which fund the row sits in); the design needs no special-casing for any answer (R2e).

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-10-01

**Owner:** tech-lead
**Status:** complete

### Summary

A dedicated, audited **Move to another fund** action plus a hardened **Delete**, built exactly inside rulings R1-R8 and the orchestrator's scope. v1 moves one thing: a same-entity **income** row from **Administrative to Activity**, through `POST/GET /api/admin/ledger/transactions/[id]/move`, decided by a pure allow-list policy and recorded by a same-transaction audit row that a "Recent corrections" section on the compliance page can read back. Delete gains a required reason, a full snapshot, `FOR UPDATE`, and a 409 when a receipt was already sent. Four existing gaps are closed in the same increment because the feature is unsound without them: the reconcile toggle stripping a closed session's lock (R3b), PATCH silently ignoring `fundId`, unvalidated `bankAccountId` on PATCH/POST, and no up-front lock labels in the register. No schema change, no migration, no new `FEATURES` key, no dependency, no email (so the durable-claim exception does not apply).

### Rulings that differ from, or refine, Phase 1/2 (read first)

| # | Phase 1 / 2 said | Phase 3 ruling | Why |
|---|---|---|---|
| D1 | Phase 1 Gap 12: show the Move action **disabled** with "No other fund in this entity can hold this row." | **Omit** the Move button on rows that are not a movable kind (expense, transfer leg, dues-synced, approved, rejected, pending) or whose entity has no legal destination (every Foundation row, every Activity row). Show it **disabled with a reason** only when the row is otherwise movable but the caller lacks `LEDGER_MANAGE` for the row's tier. The `GET` still returns the specific reason for any direct caller. | A permanently disabled control on every row of the Foundation and Activity registers is noise, not help. Eligibility is derived from `checkFundMove()` over the page's own funds, so enabling the expense cell later (B-96) lights the button up with no UI change. |
| D2 | Phase 1: "Toast: Moved ... with a Record sweep now button." | The Move dialog **stays open on a success step** ("Moved to Activity Fund." + **Record sweep now** link + **Done**), and `router.refresh()` runs only on Done/close. "Record sweep now" is a **deep link** `/admin/ledger/activity?entity=<slug>&sweepFrom=<txnId>`; that page validates the row server-side and opens the existing sweep form prefilled. | After the move the row leaves the register that rendered the dialog, so any state or toast callback owned by that row's component is gone after the refresh. A deep link survives the refresh and is bookmarkable. The board-minute reference is never prefilled (Phase 1 Gap 9). |
| D3 | R5: typed builder/parser for `details` lives in `ledger-audit.ts`. | Split: **`src/lib/ledger-correction.ts`** (pure, client-safe: reason limits and normalizer, action constants, typed payloads, builders, never-throwing parser, API response types, warning copy) and **`src/lib/ledger-audit.ts`** (imports `@/lib/db`: `recordLedgerAudit()`, `getRecentLedgerCorrections()`). | The dialogs need the reason limits and response types. If they imported a module that imports the database, the browser bundle would break. The member-surface import guard protects both files. |
| D4 | R7: validate `bankAccountId` on PATCH. | On PATCH, validate **only when the submitted value differs from the stored one**; on POST always. | `transaction-form.tsx` resends `bankAccountId` unchanged on every edit. Unconditional validation would block unrelated edits on any row whose account was later deactivated (the DECISION-061 "genuinely new pick" rule). |
| D5 | R3b: guard the reconcile route (implicitly read-then-write). | Pin the refusal **inside the UPDATE** (`... AND reconciled_session_id IS NULL RETURNING id`); a follow-up lookup chooses 404 vs 403 only when no row returns (DECISION-108 pattern). | One statement, no lock needed, no read-then-write window. |
| D6 | Phase 1: `GET` could return a `callerHasTier` flag. | `GET` returns the **same status and `code` `POST` would** for any state-based refusal (including 403 `manage_required`); a 200 means "this move would be accepted if the body is valid." | Preview/execute parity is then testable as one table, and the dialog cannot show a green preview the server refuses. |
| D7 | R5: delete snapshot "for the pair when a transfer pair is deleted." | **One audit row per delete request**; `before = { v: 1, rows: Snapshot[] }` (one entry, or two for a pair); `targetTransactionId = null`. | The reader lists one correction per user action, not per ledger row, and the FK would be nulled by the delete anyway. |
| D8 | R6: a "sent statement month" warning on delete "will rarely fire." | Delete **records** `sentStatementMonth` in the audit details (same helper as the move) but has **no pre-delete UI warning** in v1. | The warning needs a preview round trip for a case that needs a backdated entry added after a send. The audit row keeps it visible after the fact. |
| D9 | (not asked) | Added **DECISION-111** (implementation shape) beside the requested DECISION-109 and DECISION-110. | The tech-lead charter requires a numbered entry for non-trivial implementation decisions; D1-D8 qualify. |

No ruling of Phase 1/2 is reversed. Corrections 1-4 in the Phase 2 section stand (reconcile-toggle bypass, no Foundation-to-Club path, guardrails are not a detector, the `LEDGER_MANAGE` tier is not a second approver).

### Permissions

No new key, no role-binding migration. `FEATURES.LEDGER_RECORD` and `FEATURES.LEDGER_MANAGE` already exist. Every gate is in the route body (`auth()` + `hasFeature()`); the register hides or disables, the server decides.

| Action | Gate | Computed from |
|---|---|---|
| `GET .../move` (preview) | `LEDGER_RECORD`, then tier | tier on the unlocked row |
| `POST .../move` (execute) | `LEDGER_RECORD`, then tier | tier on the **`FOR UPDATE` row inside the transaction**; no pre-read |
| `DELETE .../[id]` | `LEDGER_RECORD` (unchanged) | unchanged; prior-fiscal-year gap is B-97 |
| `PATCH .../[id]` | `LEDGER_RECORD` (unchanged) | unchanged |
| `POST .../reconcile` | `LEDGER_RECORD` (unchanged) + new refusal of a session-owned row | the row |

**Tier rule** (pure `requiredMoveTier(row, now)` in `ledger-transaction-lock.ts`): `manage` when `isTransactionReconciled(row)` (`reconciled === true` OR `reconciledSessionId != null`) OR `getFiscalYear(txnDate) < currentFiscalYear(now)`; otherwise `record`. `LEDGER_MANAGE` is resolved once per request as a boolean (`hasFeature(userId, LEDGER_MANAGE)`); whether it is *needed* is decided only from the locked row, never from the client. Default holders: `record` = admin, treasurer; `manage` = admin (migration 0045). Do not describe the tier as a second approver (Phase 2 Correction 4).

### API contract

Next.js note for the implementer: `params` is a `Promise` in this repo's route handlers; mirror `split/route.ts` and read `node_modules/next/dist/docs/` before writing the handler.

#### `GET /api/admin/ledger/transactions/[id]/move`

No query params. Gate order: 401, 403, `isUuid(id)` else 404, evaluate (below).

200 body (`MovePreview`, exported from `ledger-correction.ts`):

```ts
interface MovePreview {
  transaction: { id: string; txnDate: string; flow: "income" | "expense"; amountCents: number;
    party: string | null; fiscalYear: number; reconciled: boolean;
    fundId: string; fundName: string; fundKind: string;
    categoryId: string | null; categoryName: string | null;
    bankAccountId: string | null; bankAccountName: string | null };
  tier: { required: "record" | "manage"; reasons: Array<"reconciled" | "prior_fiscal_year"> };
  destinations: Array<{
    fundId: string; name: string; kind: string;
    allowed: boolean; denial?: { code: FundMoveDenialCode; reason: string };
    // present only when allowed:
    categories?: Array<{ id: string; name: string }>;   // active, destination entity+kind, flow = row's flow
    defaultCategoryId?: string | null;                   // "Public donations" for the destination kind, else null
    impact?: { sourceFund: { name: string; beforeCents: number; afterCents: number };
               destFund:   { name: string; beforeCents: number; afterCents: number };
               bankAccount: { name: string | null; changeCents: 0 } };
  }>;
  warnings: Array<{ code: MoveWarningCode; message: string }>;  // server-composed, see below
  reasonLimits: { min: number; max: number };                   // 10 and 500
}
```

`destinations` lists **every other fund in the row's entity** (so the dialog can explain a denial), each decided by `checkFundMove()`. In v1 at most one is `allowed`. Fund balances are all-time **posted** balances computed by `fundBalanceCents(openingBalanceCents, postedRows)` (the canonical helper, no new sign logic); the dialog labels them "all-time balance" because the register shows a fiscal-year view.

Non-200: same status and `{ error, code }` as `POST` for any state refusal: 404 `not_found`; 403 `approved | rejected | pending | transfer_leg | dues_synced | manage_required`; 403 `no_destination` is NOT used (an entity with no legal destination returns 200 with every destination `allowed: false`).

`MoveWarningCode`: `ratchet` (always, when any destination is allowed), `reconciled`, `prior_fiscal_year`, `sent_statement` (a successful `financial_report_sends` row exists for the row's entity and month AND the source fund kind is member-exposed), `aged_public_fund` (the row's `txnDate` is older than `agedPublicFundCutoffDate(settings.holdingPeriodWarnDays)`, so the Activity Fund will show the aged-funds warning until swept), `sweep_not_automatic` (always). Copy lives in `ledger-correction.ts` as constants so the dialog, the tests, the guide and the release note agree. Required sentences:

- ratchet: "This cannot be moved back. Money in the Activity Fund can only leave through a minuted sweep to the Foundation. If you move the wrong entry, the fix is to delete and re-enter it, or to reopen its reconciliation session first if it has been reconciled."
- sent_statement: "The Administrative statement for {Month YYYY} was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically."
- sweep_not_automatic: "Moving does not sweep anything. The cash is still in {bank account}; record the sweep separately once the money has actually been moved."
- reconciled: "This entry was cleared on a bank statement. Moving it changes only the fund; the bank balance and the reconciliation are not affected."

#### `POST /api/admin/ledger/transactions/[id]/move`

Request body: **exactly** these four keys (any other key, or a missing key, is 400):

```ts
{ destFundId: string;            // uuid
  categoryId: string | null;     // uuid, or null for "No category"
  reason: string;                // trimmed, 10-500 code points
  expectedFundId: string }       // uuid: the fund the client was looking at
```

Gate and validation order (everything before the transaction touches no row):

1. `auth()` 401; `hasFeature(LEDGER_RECORD)` 403; `LEDGER_MANAGE` resolved as a boolean.
2. `isUuid(id)` else 404 `not_found`.
3. Body: JSON object, exact key set, `isUuid` on the three ids, `normalizeCorrectionReason()`; failure 400 `invalid_body` with a field-specific message. **No DB read before this passes.**
4. `db.transaction`: **first statement is `SELECT ... FROM ledger_transactions WHERE id = $1 FOR UPDATE`.** Then, on the locked row, in this order (shared with `GET` as `evaluateFundMove()`):
   1. no row: 404 `not_found`
   2. state block: approved 403 `approved`; rejected 403 `rejected`; `status = 'pending'` 403 `pending`; `duesPaymentId` set 403 `dues_synced`; `transferGroupId` set 403 `transfer_leg` (each with `LOCK_COPY` next-step text)
   3. tier: `needsManage && !callerCanManage` 403 `manage_required` ("Moving a reconciled or prior-year entry needs the Manage Ledger permission.")
   4. `expectedFundId !== row.fundId` 409 `stale` ("This entry changed while you were looking at it. Refresh and try again.")
   5. destination fund lookup: not found 404 `fund_not_found`
   6. bank-account entity assertion: if `row.bankAccountId` is non-null its account must belong to the destination fund's entity, else 409 `bank_account_entity_mismatch`
   7. `checkFundMove({ flow, from, to })`: `same_fund` 409; `cross_entity | expense_not_supported | away_from_public | not_permitted` 403 with the policy `reason`
   8. category (non-null only): shared `checkCategoryForFund()` with `requireActive: true`: 404 `category_not_found`; 400 `category_invalid` (entity, kind, flow or inactive mismatch)
   9. `UPDATE ledger_transactions SET fund_id = $dest, category_id = $cat, budget_line_id = NULL, updated_at = now() WHERE id = $id AND fund_id = $lockedFundId RETURNING id` (the `fund_id` pin is belt and braces on top of the lock)
   10. `recordLedgerAudit(tx, { action: "transaction_fund_moved", ... })` (payloads below)
5. A thrown error anywhere rolls the whole transaction back (no row changed, no audit row); respond 500 "Could not move this entry. Nothing was changed."

200 body (`MoveResponse`): `{ id, fundId, fundSlug, fundName, categoryId, categoryName, sweepSuggested: boolean }`. `sweepSuggested = (destination.kind === "activity" && flow === "income")`.

Status map: 400 `invalid_body | category_invalid`; 401; 403 as above; 404 `not_found | fund_not_found | category_not_found`; 409 `stale | same_fund | bank_account_entity_mismatch`; 500.

Double-click: the second request carries the same `expectedFundId`, which no longer matches the row, so it is 409 `stale` and writes nothing: exactly one audit row.

#### `PATCH /api/admin/ledger/transactions/[id]` (changes)

- **`fundId` in the body is 400 "Use Move to another fund."**, evaluated immediately after the JSON parse and **before** the reconciled-lock check (so it fires on a reconciled row and on `{ donorId, fundId }` too). `RECONCILED_LOCK_CARVEOUT_FIELDS` and `isWithinReconciledLockCarveout()` are not touched.
- `bankAccountId` (non-transfer rows only; the DECISION-058 ignore-for-legs rule is unchanged): if the value is not a UUID, 400 "Select a valid bank account."; if it **differs from the stored value**: `checkBankAccountForEntity()` (exists, same entity as the row, active) else 400; then the **open-session-match guard**: `getMatchForTransaction(id)` non-null, 403 "This transaction is matched to a bank line in an open reconciliation session. Unmatch it before changing its bank account." Unchanged value: no validation, no match check.
- Copy only: the approved 403 appends the next step ("Approved transactions cannot be edited. Record a refund entry to correct one."). Keep the existing sentence as the prefix; update any test that asserts exact equality.

#### `POST /api/admin/ledger/transactions` (regular path)

`bankAccountId` always validated (UUID shape, exists, belongs to the body's `entityId`, active) with 400 and a specific message, before the insert. `handleTransfer` already validates its own accounts and is not touched.

#### `POST /api/admin/ledger/transactions/[id]/reconcile` (R3b)

Select adds `reconciledSessionId`. After the 404, **if `reconciledSessionId` is set: 403** with `CLOSED_SESSION_LOCK_MESSAGE` ("This transaction was cleared by a closed reconciliation session. Reopen the session to change its reconciled status."), either direction. The write becomes `UPDATE ... SET reconciled, reconciled_at, reconciled_session_id = NULL, updated_at WHERE id = $id AND reconciled_session_id IS NULL RETURNING id`; zero rows returned triggers a lookup: gone is 404, session-owned is 403. A row with only the legacy mark toggles exactly as today. `ReconcileAllButton` only targets unreconciled rows, so it is unaffected.

#### `DELETE /api/admin/ledger/transactions/[id]`

Request body `{ reason: string }` (JSON body, never a query parameter; read with `await request.json().catch(() => null)`; a stale tab sending no body gets 400 "A reason is required. Refresh the page and try again."). Order: 401, 403, `isUuid(id)` else 404, reason 400 `reason_required` (before any DB read), then one `db.transaction`:

1. lock the target `FOR UPDATE`; none: 404
2. guards, **unchanged codes and order**: approved 403, rejected 403, `reconciledSessionId` 403 (legacy-reconciled rows stay deletable: accepted residual, B-92)
3. if `transferGroupId`: lock every row of the group `FOR UPDATE` ordered by id; approved or session-reconciled partner is 403 (existing messages)
4. acknowledgments: `SELECT id, donation_txn_id, sent_at FROM ledger_acknowledgments WHERE donation_txn_id IN (...)`; **any `sent_at` set is 409 `receipt_sent`** ("A receipt was already sent to the donor for this gift. Record a refund entry instead."), nothing written
5. `recordLedgerAudit(tx, { action: "transaction_deleted", ... })`, then delete the row(s)

200 `{ deleted: 1 | 2, acknowledgmentRemoved: boolean }`. Match links cascade (existing FK); the dialog says so in static copy.

### Data model

**No schema changes required.** `schema.ts` gets a comment-only edit to the `action` list on `ledgerAuditLog` (add `transaction_fund_moved` and `transaction_deleted`, and note that those two carry JSON `before`/`after`/`details`). No migration, so no idempotency or numbering concern; `drizzle-kit push` is a no-op for this change.

### Pure policy module: `src/lib/ledger-fund-move-policy.ts`

```ts
import type { FundRef } from "@/lib/ledger-transfer-policy";   // import type only
export type FundMoveDenialCode =
  | "same_fund" | "cross_entity" | "expense_not_supported" | "away_from_public" | "not_permitted";
export type FundMoveResult =
  | { allowed: true }
  | { allowed: false; code: FundMoveDenialCode; reason: string };
export function checkFundMove(input: { flow: string; from: FundRef; to: FundRef }): FundMoveResult;
```

Deny-by-default; one `if` per cell, each with its own reason text, keyed on `kind` and entity identity, never a UUID. Evaluation order:

1. `from.fundId === to.fundId`: `same_fund`
2. `from.entityId !== to.entityId`: `cross_entity`
3. `flow` not `income`/`expense`: `not_permitted`
4. `income`: `administrative` to `activity` is **ALLOWED (the only cell)**; `activity` to `administrative` is `away_from_public` (public money into Administrative, the Art. VII section 3(g) firewall); anything else `not_permitted`
5. `expense`: `activity` to `administrative` is `expense_not_supported` ("Moving expenses between funds is not supported yet."), its own branch so B-96 is a one-branch flip; `administrative` to `activity` is `away_from_public` (a Club operating cost charged to public money); anything else `not_permitted`

Status mapping: `same_fund` 409, every other code 403.

**Cross-reference (REQUIRED, R2c).** A comment block in **both** `ledger-fund-move-policy.ts` and `ledger-transfer-policy.ts` (the transfer file gets a comment-only edit) says: the two policies answer different questions and must not be merged; `checkTransferDirection(administrative, activity)` blocks a *movement of value*; `checkFundMove(income, administrative, activity)` allows a *reclassification of provenance*; they intentionally differ on exactly that pair.

### Pure lock classifier: `src/lib/ledger-transaction-lock.ts` (client-safe, no DB)

```ts
export type TransactionLockKind =
  "approved" | "rejected" | "pending" | "dues_synced" | "transfer_leg" | "reconciled_session" | "reconciled_legacy";
type LockableRow = Pick<LedgerTransaction, "approvedAt" | "status" | "duesPaymentId" | "transferGroupId"
                                           | "reconciled" | "reconciledSessionId" | "txnDate">;
export function transactionLockKinds(row): TransactionLockKind[];        // every kind that applies, in precedence order
export function classifyTransactionLock(row): TransactionLockKind | null; // first of the above
export function isTransactionReconciled(row): boolean;                    // reconciled || reconciledSessionId != null
export function editLockKind(row): "approved" | "rejected" | "reconciled_session" | null;   // what PATCH/DELETE refuse today
export function moveBlockKind(row): "approved" | "rejected" | "pending" | "dues_synced" | "transfer_leg" | null;
export function requiredMoveTier(row, now: Date): { tier: "record" | "manage"; reasons: Array<"reconciled" | "prior_fiscal_year"> };
export const LOCK_COPY: Record<TransactionLockKind, { label: string; nextStep: string }>;   // exhaustive Record: a new kind is a compile error
export const CLOSED_SESSION_LOCK_MESSAGE: string;
```

Precedence is the order above (approved first). This is the **single source** for the move route's state block, the register's lock labels and the reconcile toggle's disabled state. `editLockKind` mirrors the PATCH/DELETE guards, which stay inline (migrating them onto the classifier is B-94b); a test pins `editLockKind` against the documented guard table so the two cannot drift silently. Add one constant to `ledger.ts`: `export const PUBLIC_DONATIONS_CATEGORY_NAME = "Public donations"` (the transactions route keeps its private copy until B-94).

### Shared category and bank-account validation: `src/lib/ledger-transaction-validation.ts`

The category-versus-fund-kind-and-flow check exists as **three inline copies today**: `src/app/api/admin/ledger/transactions/route.ts` regular POST (~line 285), the same file's `handleTransfer` sweep-destination branch (~line 585, which additionally checks `entityId`), and `src/app/api/admin/ledger/transactions/[id]/route.ts` PATCH (~line 299). The move would be a fourth. **One home: this new module.**

```ts
export type FitFailure = { ok: false; status: 400 | 404; code: string; error: string };
export function checkCategoryFit(
  cat: { id; entityId; fundKind; flow; isActive } | undefined,
  fund: { entityId: string; kind: string }, flow: string, opts?: { requireActive?: boolean }): { ok: true } | FitFailure;
export async function validateCategoryForFund(exec, categoryId, fund, flow, opts?): Promise<{ ok: true; category } | FitFailure>;
export function checkBankAccountFit(
  acct: { id; entityId; isActive } | undefined, entityId: string, opts?: { requireActive?: boolean }): { ok: true } | FitFailure;
export async function validateBankAccountForEntity(exec, bankAccountId, entityId, opts?): Promise<{ ok: true } | FitFailure>;
```

`exec` is `Pick<typeof db, "select">` (so it accepts `db` or a `tx`). The pure `check*` functions carry the existing messages verbatim ("Category not found" 404, "Category does not match fund type" 400, "Category flow does not match transaction flow" 400) plus new ones for the entity mismatch and inactive cases, and are table-tested; the `validate*` wrappers only load the row. **This increment uses the helper from the move route and for the new bank-account checks only; migrating the three existing category sites is B-94(a), not in this change.** The existing `handleTransfer` bank-account checks are left alone.

### Audit: `src/lib/ledger-correction.ts` and `src/lib/ledger-audit.ts`

New action values (following `donor_linked_on_reconciled_transaction`): `TRANSACTION_FUND_MOVED_AUDIT_ACTION = "transaction_fund_moved"`, `TRANSACTION_DELETED_AUDIT_ACTION = "transaction_deleted"`.

Typed payloads (all `v: 1`, stored as JSON text; `before`/`after` are self-describing so a renamed or deactivated category does not make a record unreadable):

```ts
interface FundRefSnapshot { id: string; name: string; slug: string; kind: string }
interface CategoryRefSnapshot { id: string; name: string }

interface FundMoveAuditPayload {            // action: transaction_fund_moved
  before: { v: 1; fund: FundRefSnapshot; category: CategoryRefSnapshot | null; budgetLineId: string | null };
  after:  { v: 1; fund: FundRefSnapshot; category: CategoryRefSnapshot | null; budgetLineId: null };
  details: { v: 1; reason: string; entityId: string; txnDate: string; flow: "income" | "expense"; amountCents: number;
             fiscalYear: number; tier: "record" | "manage"; reconciled: boolean; reconciledSessionId: string | null;
             priorFiscalYear: boolean; sentStatementMonth: string | null /* "YYYY-MM" */ };
}
interface TransactionSnapshot {             // one per deleted row
  id: string; entityId: string; fund: FundRefSnapshot; bankAccount: { id: string; name: string } | null;
  category: CategoryRefSnapshot | null; txnDate: string; flow: string; amountCents: number;
  party: string | null; memo: string | null; donorId: string | null; checkNumber: string | null; paymentMethod: string | null;
  status: string; reconciled: boolean; reconciledSessionId: string | null; duesPaymentId: string | null;
  transferGroupId: string | null; budgetLineId: string | null;
  acknowledgment: { existed: boolean; sent: boolean };
}
interface TransactionDeletedAuditPayload {  // action: transaction_deleted
  before: { v: 1; rows: TransactionSnapshot[] };   // 1 row, or 2 for a transfer pair
  after: null;
  details: { v: 1; reason: string; entityId: string; txnDate: string; flow: string; amountCents: number; fiscalYear: number;
             rowCount: 1 | 2; reconciled: boolean; reconciledSessionId: string | null; priorFiscalYear: boolean;
             sentStatementMonth: string | null; acknowledgmentRemoved: boolean };
}
```

`details` carries `entityId`, `txnDate`, `flow`, `amountCents` so the reader needs no join (and works after the row is gone). `parseAuditDetails(action, text)` and `parseAuditBefore(...)` return the typed object or `{ raw: string }`; they **never throw** (legacy plain-text details, a future `v: 2`, garbage).

`recordLedgerAudit` is generic over the two typed actions in v1 (B-95 widens the map to the seven existing actions):

```ts
type AuditExecutor = Pick<typeof db, "insert">;   // db or tx
export async function recordLedgerAudit<A extends "transaction_fund_moved" | "transaction_deleted">(
  exec: AuditExecutor,
  entry: { actorUserId: string; action: A; targetTransactionId: string | null } & AuditPayloadFor<A>,
): Promise<void>;
```

It stringifies, inserts `targetCategoryId: null` (the table's app-layer invariant: exactly one target, or none), and **throws** if the insert fails, so the surrounding transaction rolls back. Move passes `targetTransactionId = row.id`; delete passes `null`.

**Reader** `getRecentLedgerCorrections({ entityId, now?, days = 90, fetchCap = 200, displayCap = 25 })`: `SELECT ... FROM ledger_audit_log LEFT JOIN users ... WHERE action IN (moved, deleted) AND created_at >= now - days ORDER BY created_at DESC LIMIT fetchCap`; parse in JavaScript, keep rows whose `details.entityId` matches, take `displayCap`. **Never** cast `details` to jsonb in SQL (DECISION-111 item 6). Returns `{ rows: LedgerCorrectionRow[]; totalInWindow: number }` with `LedgerCorrectionRow = { id; createdAt; actorName: string | null; kind: "moved" | "deleted"; amountCents; flow; txnDate; from: string | null; to: string | null; reason: string | null; settledPeriod: boolean; rowCount: number; sentStatementMonth: string | null }`.

**Member-surface firewall:** no file under `src/app/members/**`, `src/app/api/members/**`, or `src/lib/financial-report-*.ts` (non-test) may import `ledger-audit` or `ledger-correction`. Enforced by a small fs-grep test.

### DB orchestration: `src/lib/ledger-fund-move-queries.ts`

```ts
export type MoveFailure = { ok: false; status: 400|403|404|409; code: MoveErrorCode; error: string };
export async function previewFundMove(args: { transactionId: string; callerCanManage: boolean; now?: Date }):
  Promise<{ ok: true; preview: MovePreview } | MoveFailure>;
export async function executeFundMove(args: { transactionId: string; actorUserId: string; callerCanManage: boolean;
  input: { destFundId: string; categoryId: string | null; reason: string; expectedFundId: string }; now?: Date }):
  Promise<{ ok: true; result: MoveResponse } | MoveFailure>;
export async function findSentStatementMonth(exec, args: { entityId: string; txnDate: string; fundKind: string }): Promise<string | null>;
```

Both call one internal `evaluateFundMove()` (state block, tier, fund and entity, policy). `previewFundMove` reads without a lock; `executeFundMove` runs it on the locked row inside `db.transaction`. `findSentStatementMonth` is read-only: if `fundKind` is in `MEMBER_EXPOSED_FUND_KINDS`, look up a `financial_report_sends` row with `success = true`, the entity and `monthBounds(ym).monthEnd`; it writes nothing and sends nothing (R6).

### Component / page plan

**Pages to create:** none. No new admin area, no `ADMIN_NAVIGATION` change; the proxy-derived protection and `admin-page-feature-gates.test.ts` are unaffected (the compliance page already gates itself).

**Components to create** (`src/components/admin/ledger/`):

- `ledger-dialog-shell.tsx`: Radix Dialog chrome (overlay, `rounded-2xl` content, title, close button, `p-4 sm:p-6`, `max-h-[90vh] overflow-y-auto`). Used by the two new dialogs only (D-item 7 of DECISION-111).
- `correction-reason-field.tsx`: labelled textarea, live count against `reasonLimits`, `min-h-[44px]`-grade controls, `onFocus` scrolls itself into view so the phone keyboard never hides it. Shared by Move and Delete.
- `move-transaction-dialog.tsx` (client): **a shadcn/Radix `Dialog`, not `ConfirmDialog`** (it needs a select, a textarea and a success step). On open it `GET`s the preview. States: loading, load error (inline error card, Confirm disabled), "cannot move" (server `error` shown, Confirm hidden), form, submitting, success. Form: read-only row summary (date, party, amount, current fund, bank account, current category); destination select (the single allowed fund; any denied destinations listed as text with their reason); category select (preselects `defaultCategoryId`; options are the server's categories plus "No category"); required reason; a **what will change** panel (`grid grid-cols-1 sm:grid-cols-2`: source fund before/after, destination fund before/after; a full-width line "{bank account} balance: unchanged"); the server's `warnings` rendered as given (ratchet in a gold-bordered notice, others plain). Confirm is a primary `rounded-lg` button labelled "Move to {destination name}", disabled until a destination is selected and the reason is valid. Success step: "Moved to {fund name}." with **Record sweep now** (primary, a `Link` to `/admin/ledger/activity?entity={slug}&sweepFrom={id}`; shown only when `sweepSuggested`) and **Done**; `router.refresh()` on Done or on any close after success. Money wording is "Moved", never "Reversed" or "Voided".
- `delete-transaction-dialog.tsx` (client): same shell, replaces the bare `ConfirmDialog` in `TransactionActions` (`ConfirmDialog` cannot host an input or block its own close). Destructive confirm only here. Content: what will be deleted (a transfer lists both entries); static "what else disappears" list ("a match to a bank line in an open reconciliation session", and, when `ackStatus === "pending"`, "the unsent acknowledgment letter record for this gift"); when `ackStatus === "sent"`: **no reason field, Confirm hidden**, and the 409 message "A receipt was already sent to the donor for this gift. Record a refund entry instead."; otherwise required reason. A server 409/403/400 message is shown inline, the dialog stays open.
- `recent-corrections.tsx` (**Server Component**, presentational): "Recent corrections" section. A stacked list of `rounded-2xl` cards (not a table, so it never scrolls sideways at 360px; cf. B-87/B-89/B-91): date, who, a Moved/Deleted badge, amount, "{from} to {to}" for a move, the reason, a "Settled period" badge, "Statement already sent" badge when `sentStatementMonth`, "2 entries" for a pair. Empty state `bg-gray-50 rounded-2xl p-10 text-center text-gray-500`: "No corrections in the last 90 days." Footer: "Showing the {n} most recent of {total} in the last 90 days." when truncated.
- `sweep-prefill-launcher.tsx` (client): wraps `TransactionFormDialog` controlled open; on close `router.replace()` drops `sweepFrom`.

**Files to modify:**

- `transaction-actions.tsx`: new props `canManage`, `ackStatus: "pending" | "sent" | null`, `currentFiscalYear`, `entitySlug`. Edit and Delete render as **disabled buttons with the same visible text** and a `title` reason when `editLockKind(row)` is non-null (approved, rejected, closed-session); a small lock label under the actions (`text-xs text-gray-500` with a lock icon: `LOCK_COPY[kind].label`, and `nextStep` as `title` and visible text on sm and up). Move button per D1. Rows with no hard lock render exactly as today (so e2e selectors on the "Edit" button still match).
- `reconcile-toggle.tsx`: new `locked` prop (set from `reconciledSessionId != null`): disabled, `title="Cleared by a closed reconciliation session. Reopen the session to change this."`
- `transaction-form.tsx` and `transaction-form-dialog.tsx`: optional `sweepPrefill?: { bankAccountId: string | null; amountCents: number; memo: string }` that initializes flow mode to `sweep`, the amount, the source bank account and the memo. Never the board minute.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`: pass the new props; handle `?sweepFrom=` (add to `searchParams`): `isUuid`, `canRecord`, Club entity with `crossEntityContext`, `fund.kind === "activity"`, and the row is that fund's posted, non-transfer income; otherwise ignore silently. Render `SweepPrefillLauncher` with `memo = "Sweep of {party} gift moved from Administrative on {YYYY-MM-DD}"`.
- `src/app/(dashboard)/admin/ledger/compliance/page.tsx`: add the "Recent corrections" `<section>` between "990 Determination" and "Standing reminders", fed by `getRecentLedgerCorrections({ entityId: entity.id })` inside its own `try/catch` that renders a small "Corrections could not be loaded." note instead of failing the page. The page's existing `canView` gate is the gate (LEDGER_VIEW, RECORD or MANAGE).
- `src/components/admin/ledger/guide/books-register-section.tsx` (add "Moving an entry to another fund" and "Deleting an entry" subsections, the ratchet, "why no flag fired" and the sweep prerequisite) and `guardrails-section.tsx` (one sentence: a public donation booked in Administrative is not detected, B-93).
- Server: `[id]/route.ts`, `transactions/route.ts`, `reconcile/route.ts`, `schema.ts` (comment), `ledger.ts` (one constant), `ledger-transfer-policy.ts` (comment).

### Implementation order and specialist split

**api-developer first, then ux-developer** (real API contract plus a UI built on top of it; there is no schema work, so database-admin is not needed). Hand-off contract: every exported type named above lives in `ledger-correction.ts`, so the UI imports shapes rather than re-declaring them.

**api-developer (steps 1-9; each step ships with its tests):**

1. Pure modules: `ledger-fund-move-policy.ts`, `ledger-transaction-lock.ts`, `ledger-correction.ts`; the comment-only edit to `ledger-transfer-policy.ts`; the `PUBLIC_DONATIONS_CATEGORY_NAME` export.
2. `ledger-transaction-validation.ts`.
3. `ledger-audit.ts` (writer, reader) and the `schema.ts` comment; the member-surface import-guard test.
4. `ledger-fund-move-queries.ts`.
5. `move/route.ts`.
6. PATCH changes (`fundId` 400, bank-account validation and match guard, copy) and POST bank-account validation.
7. DELETE hardening.
8. Reconcile route guard (pinned UPDATE).
9. Gate: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`, and a grep that no `alert(`/`confirm(`/`prompt(` and no `console.log` was added.

**ux-developer (after the api-developer reports the contract frozen):**

1. `ledger-dialog-shell.tsx`, `correction-reason-field.tsx`.
2. `move-transaction-dialog.tsx`, `delete-transaction-dialog.tsx`.
3. `transaction-actions.tsx` and `reconcile-toggle.tsx` (lock labels, disabled states, Move, new props), and the register page wiring.
4. Sweep prefill: `transaction-form(.dialog).tsx`, `sweep-prefill-launcher.tsx`, `?sweepFrom=` handling.
5. `recent-corrections.tsx` and compliance page wiring.
6. Treasury guide sections.
7. 360px pass on both dialogs and the corrections list (44px targets, stacked before/after panel, reason field above the keyboard).

**qa (Phase 5):** the new e2e spec (below) plus the click-through. **tech-lead (ship time):** release notes via `/release-notes` from the draft below.

### Named unit tests (the implementer delivers these; Phase 4 gate)

Query-layer tests follow `src/lib/reconciliation-discard.test.ts` (recording `tx` mock, `PgDialect` to render `where`). A mocked db cannot prove FK cascades or lock semantics; those are in the live-database checks for qa.

**`src/lib/ledger-fund-move-policy.test.ts`**
- T1 matrix: the full cartesian of from-kind and to-kind over `administrative | activity | charitable | scholarship | <unknown>`, both flows, same and different entity; **exactly one cell is `allowed: true`** (income, same entity, administrative to activity), asserted by counting.
- T2 each denial carries the specific `code` (`same_fund`, `cross_entity`, `expense_not_supported` for expense activity to administrative, `away_from_public` for income activity to administrative and expense administrative to activity, `not_permitted` otherwise) and a non-empty `reason`; reasons are distinct per code; an unknown flow and an unknown kind are denied.
- T3 **mutual exclusion with the transfer policy**: over the same cartesian, no `(from, to)` is allowed by both `checkTransferDirection()` and `checkFundMove()`; and the pinned divergence: `checkTransferDirection(administrative, activity).allowed === false` while `checkFundMove(income, administrative, activity).allowed === true`.

**`src/lib/ledger-transaction-lock.test.ts`**
- T4 `transactionLockKinds`/`classifyTransactionLock` for every kind alone and in combination (approved + reconciled returns approved first; legacy-only is `reconciled_legacy`; session pointer is `reconciled_session`); `isTransactionReconciled` for either mark.
- T5 `editLockKind` matches the PATCH/DELETE guard table (approved, rejected, session; NOT pending, transfer leg, dues-synced, legacy-reconciled); `moveBlockKind` matches the move table.
- T6 **tier computation**: unreconciled current-FY is `record`; session-reconciled is `manage`; legacy-reconciled is `manage`; prior FY is `manage`; both reasons listed when both apply; fiscal-year edge with `now = 2026-10-01`: `txnDate 2026-06-30` is prior (`manage`), `2026-07-01` is current (`record`); a row dated in the next FY is `record`; `now = 2026-06-30` makes `2026-06-30` current.
- T7 `LOCK_COPY` has a label and next step for every kind (exhaustive); `CLOSED_SESSION_LOCK_MESSAGE` is the one string the reconcile route and the register use.

**`src/lib/ledger-correction.test.ts`**
- T8 `normalizeCorrectionReason`: non-string, empty, whitespace only, 9 vs 10 vs 500 vs 501 code points after trim, Unicode, emoji and RTL text accepted and counted by code point, interior whitespace preserved.
- T9 `parseMoveBody`: exact key set; extra key, missing key, non-uuid ids, `categoryId: null` accepted, `categoryId: ""` rejected.
- T10 **audit payload shapes**: builders produce `v: 1` JSON with the exact fields above; `parse*` round-trips; legacy plain-text details, malformed JSON, unknown `v` and `null` degrade to `{ raw }` without throwing.

**`src/lib/ledger-transaction-validation.test.ts`**
- T11 `checkCategoryFit`: not found 404, entity mismatch 400, kind mismatch 400 (verbatim existing message), flow mismatch 400 (verbatim), inactive 400 only with `requireActive`, ok.
- T12 **bank-account validation**: `checkBankAccountFit` (missing 400, cross-entity 400, inactive 400 only with `requireActive`, ok); `validateBankAccountForEntity` uses a UUID-shape check first so a malformed id is a 400 and never reaches the database.

**`src/lib/ledger-fund-move-queries.test.ts`**
- T13 **`FOR UPDATE` WHERE shape**: the first call in the transaction is a `select` on `ledgerTransactions` with `.for("update")` recorded by the mock chain and a `where` that `PgDialect` renders as `"ledger_transactions"."id" = $1` with params `[id]`; no `update` or `insert` is issued before it; the move `UPDATE`'s where renders `id = $1 and fund_id = $2`.
- T14 **tier on the locked row**: lock returns a reconciled row, caller lacks manage: 403 `manage_required`, zero writes; the same row with manage: success. A prior-FY row likewise.
- T15 **stale `expectedFundId`**: 409 `stale`, zero writes; **double submit** (second call sees the row already in the destination): exactly one audit insert across both calls.
- T16 refusals each return the documented status and code with zero writes: approved, rejected, pending, transfer leg, dues-synced, same fund, cross-entity destination, away-from-public (income to administrative), expense, bank-account entity mismatch, destination not found, category not found, category wrong kind/flow/entity/inactive; `categoryId: null` succeeds.
- T17 **preview/execute parity**: one table of fixtures run through both `previewFundMove` and `executeFundMove`: every state refusal (approved, rejected, pending, transfer leg, dues-synced, `manage_required`) yields the identical `{ status, code }`; and for each destination fund, `preview.destinations[i].allowed` equals whether `executeFundMove` passes the policy step for it.
- T18 success path: update sets `fundId`, `categoryId`, `budgetLineId: null`, `updatedAt`; audit insert is made on the **same `tx` object**, **after** the update, with action `transaction_fund_moved`, `targetTransactionId = id`, self-describing `before`/`after` (names and slugs), and a `details` payload that parses back to the typed shape (tier, FY, reconciled, session id, `sentStatementMonth`); an audit-insert rejection propagates and the transaction is not reported successful.
- T19 `findSentStatementMonth`: returns `YYYY-MM` for a successful send in a member-exposed fund; null for an Activity source fund; null when no successful row; issues only `select` calls against `financialReportSends` (no write); `warnings` include `sent_statement`, `aged_public_fund`, `prior_fiscal_year`, `reconciled`, `ratchet` and `sweep_not_automatic` in the right cases.

**`src/lib/financial-report-queries.test.ts` (one added test)**
- T20 **month un-gating** (R6): with the canned-row pattern already in that file, an unreconciled Administrative row on/before `monthEnd` gates the month (`true`); the same row with fund kind `activity` does not (`false`). A documented property, not a surprise.

**`src/app/api/admin/ledger/transactions/[id]/move/route.test.ts`**
- T21 401 unauthenticated; 403 without `LEDGER_RECORD` on both verbs; non-uuid id 404; body key-set and shape errors 400 with **no db call**; reason errors 400 with no db call.
- T22 status map: each `MoveFailure` maps to its HTTP status and `{ error, code }`; 200 `MoveResponse` shape and `sweepSuggested`; `LEDGER_MANAGE` resolved through `hasFeature` and passed as a boolean (a record-only caller on a reconciled row is 403; a manage caller is 200).

**`src/app/api/admin/ledger/transactions/[id]/route.test.ts` (extended; existing tests 8-17 still pass unchanged)**
- T23 PATCH `{ fundId }` is 400 "Use Move to another fund." on an ordinary row, on a reconciled row, and as `{ donorId, fundId }` (400, not the 200 carve-out); `RECONCILED_LOCK_CARVEOUT_FIELDS` still equals `["donorId"]`.
- T24 PATCH bank account: nonexistent id 400 not 500; malformed id 400; cross-entity 400; inactive 400 when changed; **unchanged value skips validation** (an inactive current account does not block an unrelated edit); matched-in-open-session row with a changed account 403; same row with an unchanged account passes; a transfer leg still ignores `bankAccountId` (DECISION-058).

**`src/app/api/admin/ledger/transactions/route.test.ts` (extended)**
- T25 POST regular: nonexistent, malformed, cross-entity and inactive `bankAccountId` each 400 with a specific message and no insert.

**`src/app/api/admin/ledger/transactions/[id]/reconcile/route.test.ts` (new)**
- T26 **reconcile-route refusal**: a session-owned row is 403 in both directions with no write; a legacy-only row still toggles and still writes `reconciledSessionId: null`; the UPDATE's where renders `... "reconciled_session_id" is null`; when the pinned UPDATE returns no row the follow-up lookup yields 403 (now session-owned) or 404 (gone).

**`src/app/api/admin/ledger/transactions/[id]/route.delete.test.ts` (new)**
- T27 reason required: missing body, invalid JSON, empty, short, over-length are 400 with no db call; 401/403/404 (non-uuid) as above.
- T28 guards unchanged: approved, rejected, session-reconciled 403; partner approved or session-reconciled 403; the target row is selected `FOR UPDATE` (pair: ordered by id).
- T29 **delete 409 on a sent acknowledgment**: single row and on a pair's partner leg; nothing written (no audit insert, no delete); an **unsent** acknowledgment is allowed, `acknowledgmentRemoved: true`, snapshot shows `{ existed: true, sent: false }`.
- T30 **audit snapshot**: one `transaction_deleted` audit insert per request, on the same `tx`, before the delete, `targetTransactionId: null`, `before.rows[0].id` equals the deleted id, includes `reconciled`, `reconciledSessionId`, `duesPaymentId`, `transferGroupId`; pair yields one audit row with two snapshots and `deleted: 2`; a legacy-reconciled row is still deletable and its snapshot records `reconciled: true`; a double submit's second call is 404 with a total of one audit row.

**`src/lib/ledger-audit.test.ts`**
- T31 `recordLedgerAudit` insert values (action, JSON-string `before`/`after`/`details`, `targetCategoryId: null`, actor) and that an insert failure rejects.
- T32 reader: only the two actions, window cutoff, fetch cap, entity filter applied in JavaScript, newest first, display cap and `totalInWindow`, a row with unparseable details still listed with `reason: null`, no SQL cast of `details` (asserted on the rendered `where`).
- T33 **member-surface import guard**: no non-test file under `src/app/members/**`, `src/app/api/members/**` or `src/lib/financial-report-*.ts` imports `ledger-audit` or `ledger-correction`.

**Component tests (Vitest/jsdom, precedent `txn-donor-actions.test.tsx`)**
- T34 `TransactionActions`: approved and closed-session rows render Edit and Delete disabled with the reason and the lock label; an unlocked row renders exactly the current buttons; Move is absent on expense, transfer, Foundation and Activity rows and present on an unreconciled Administrative income row; present but disabled with the permission message when the row needs manage and `canManage` is false.
- T35 `DeleteTransactionDialog`: Confirm disabled until the reason is valid; the 409 message is shown and the dialog stays open; `ackStatus: "sent"` hides the reason and Confirm; `ackStatus: "pending"` shows the warning; no `window.confirm`.
- T36 `MoveTransactionDialog`: preview error leaves Confirm disabled; Confirm enables only with a destination and a valid reason; the request body is exactly the four keys; success step shows **Record sweep now** with `sweepFrom` in the href only when `sweepSuggested`; `router.refresh()` only on Done.

### E2E impact

- **Existing specs unaffected, one selector to protect.** `grep` of `e2e/` finds no spec that uses the reconcile toggle, the Delete action, or a register lock label. `e2e/transaction-budget-line-link.spec.ts` clicks `getByRole("button", { name: "Edit" })` on freshly created Foundation rows in a sentinel fiscal year; those rows are unreconciled, unapproved and Foundation, so they get no lock label and no Move button, and the Edit button keeps its role and text. Hard-locked rows render Edit/Delete as **disabled buttons with the same visible text**, so a future spec's selector still resolves.
- **New spec (qa-owned, recommended): `e2e/ledger-move-transaction.spec.ts`.** Seed by direct DB insert a Club Administrative income row (party `E2E QA Move Gift`, current FY, unreconciled, recorded by the e2e admin); on `/admin/ledger/administrative?entity=club` open **Move to another fund**, assert the ratchet warning and the "Administrative checking balance: unchanged" line, enter a reason, confirm; assert the row is gone from Administrative and present on Activity; follow **Record sweep now** and assert the sweep form opens on "Sweep to Foundation" with the amount prefilled and the board-minute field empty (do not submit); open `/admin/ledger/compliance` and assert the "Recent corrections" entry shows the reason; then delete a second seeded row through the Delete dialog with a reason and assert the Deleted entry. Repeat the dialog open at a 360px viewport. **Cleanup (extend `e2e/helpers/ledger-fixture-cleanup.ts`):** delete the seeded transactions by party tag and the `ledger_audit_log` rows with action `transaction_fund_moved` or `transaction_deleted` created by the e2e admin during the run; audit rows are not cascade-deleted with the transaction. Run serially like every spec (single worker); no email is involved, so the deny-by-default email rules are not engaged.

### Edge cases and risks

- **Moving an old gift raises the aged-funds warning immediately.** The row keeps its `txnDate`; if it is older than `holdingPeriodWarnDays` the Activity fund flags until swept. The preview's `aged_public_fund` warning says so; it is correct behavior, not a defect.
- **Month un-gating (R6, T20).** Moving an *unreconciled* Administrative row out removes a member-exposed gating row and can un-gate a month; correct, now tested.
- **Statement fingerprint.** A move or delete changes the Administrative totals; the existing panel flips to "Resend Corrected Statement" on its own. Nothing is written to `financial_report_sends` and nothing is emailed.
- **Preview balances are all-time posted balances**, the register's table is a fiscal-year view; the dialog labels them so. They are computed live and can differ from the register's own numbers by design.
- **Fiscal-year boundary uses server time** (`currentFiscalYear(new Date())`), consistent with every other ledger page. A row dated 06-30 judged on 07-01 UTC is the one-day edge; the `now` parameter exists so tests pin it.
- **Residual: legacy-reconciled rows.** A `LEDGER_RECORD` holder can un-toggle a legacy mark and then move at the lower tier, and legacy-reconciled rows stay editable and deletable. Accepted (R3c, B-92); the audit row and the delete snapshot record `reconciled` and the session pointer.
- **Residual: provenance.** The system cannot tell that a row really was public money. The ratchet is the control (DECISION-109).
- **A stale tab's DELETE without a body** is 400 with a refresh message, not a silent failure.
- **Foundation-books donation:** nothing to move (Phase 2 R2e); no special-casing, no Foundation-to-Club path in the UI, guide or release note. If the row is already in Activity, only the sweep remains.
- **Transactions are real here.** `db` is `postgres-js`, so interactive `db.transaction` and `.for("update")` work (`documents-queries.ts` is the precedent). A mocked db cannot prove lock behavior; qa runs the live checks: two parallel `POST`s to the same move produce one 200 and one 409 and one audit row; a delete of a Foundation donation with a sent acknowledgment is refused and the acknowledgment row survives.
- **No secrets, no personal data in the repo:** fixtures use `example.com` and the `E2E QA` tag; reason text is runtime data only and never rendered on a member surface.

### Out of scope (confirm)

Expense moves (B-96), away-from-public and cross-entity moves, a `voided` status or reversal pairs, moving transfer legs, dues-synced, approved, rejected or pending rows, editing a reconciled row's amount, date, flow, bank account or check number, locking legacy-reconciled rows in PATCH/DELETE (B-92), the "Zeffy income in Administrative" detector (B-93), migrating the existing category and audit-insert call sites (B-94, B-95), tightening the prior-fiscal-year delete gate and dues-synced deletion (B-97), a per-row "moved from" marker or a general audit browser, auto-sweep, any email or board notification, and migrating the existing two dialogs onto `LedgerDialogShell`.

### Release-notes draft (no version assigned; no file list; for `/release-notes` at ship time)

> ### Feature: Move an entry to another fund, and a safer Delete
>
> **Value:** When a gift is recorded under the wrong fund, the treasurer can now correct it in place instead of deleting and re-entering it. The original entry, its date, party, amount and bank account stay as they were; only the fund changes, and the change is logged with who made it and why.
>
> #### What's New
> - **Move to another fund.** On an Administrative Fund income entry, choose **Move to another fund**, pick the Activity Fund, choose a category (Public donations is preselected), and give a reason. The dialog shows what will change before you confirm: the Administrative and Activity balances, and that the bank account balance does not change, because the cash did not move.
> - **Then sweep.** After a move the dialog offers **Record sweep now**, which opens the Sweep to Foundation form with the amount and account filled in. The board-minute reference is still yours to enter, and moving an entry does not sweep anything by itself.
> - **Works on settled entries.** An entry that was already reconciled, or dated in an earlier fiscal year, can also be moved. Those moves need the Manage Ledger permission, and reconciliation is not affected.
> - **Recent corrections.** The Compliance page lists every move and delete from the last 90 days with who, when, the amount and the reason, so the board can see corrections to settled money.
> - **Delete asks why.** Deleting an entry now requires a reason, and a record of the deleted entry is kept. A gift whose receipt was already sent to the donor can no longer be deleted; record a refund entry instead.
> - **Locked entries explain themselves.** Approved, rejected and reconciled entries now show why Edit and Delete are unavailable and what to do instead, before you click.
>
> #### Good to know
> - **A move cannot be undone.** Money in the Activity Fund leaves only through a minuted sweep. If you move the wrong entry, delete and re-enter it (or reopen its reconciliation session first if it was reconciled).
> - If the month's Administrative statement was already sent to the board, it will read as changed and you will be offered a corrected resend; nothing is sent automatically.
> - This version moves income from Administrative to Activity only. Expense moves are planned.
> - No warning appeared for the original mistake because the system cannot yet tell that a donation entered under Administrative is public money. That check is on the backlog.
> - Gift acknowledgment letters are unchanged; the Foundation side of a sweep is a transfer with no donor attached.
>
> #### Fixes
> - Marking a transaction reconciled or unreconciled from the register can no longer undo a closed reconciliation session's lock.
> - Changing a transaction's bank account is now checked: the account must exist, belong to the same entity, be active, and the entry must not be matched to a bank line in an open reconciliation session.
> - Sending a fund change through the ordinary edit form's API now returns a clear message instead of silently doing nothing.

### What I did

- Read the work-log (Phase 1, Phase 2, rulings R1-R8) and verified every code claim the design leans on: the PATCH/DELETE/reconcile/split handlers, the three inline category-validation copies, `transaction-actions.tsx`, `reconcile-toggle.tsx`, the register and compliance pages, `ledger_audit_log` and its seven writers, `ledger_acknowledgments.sent_at`, the edit form's payload (it never sends `fundId`; it always resends `bankAccountId`), the `postgres-js` driver, `agedPublicFundCutoffDate`/`holdingPeriodWarnDays`, `isUuid()`, and the e2e specs that touch the register.
- Filed **DECISION-109, DECISION-110 and DECISION-111** at the top of `docs/decisions.md` (above DECISION-108) from the architect's draft text plus the Phase 3 implementation decisions.
- Appended **B-92 through B-97** to `docs/backlog.md` (table of contents and bodies; B-92, B-93, B-96 under Soon; B-94, B-95, B-97 under Later).
- Wrote this design.

### Outputs

- `docs/work-log/2026-10-01-move-or-cancel-transaction.md` (this section; status table updated)
- `docs/decisions.md` (DECISION-109, DECISION-110, DECISION-111; uncommitted, ships with this feature)
- `docs/backlog.md` (B-92 to B-97; uncommitted, ships with this feature)

### Open questions / handoff notes

- **Implementer: api-developer first, then ux-developer** (specialist split; no database-admin, there is no schema work). Start api-developer with step 1 (the pure modules) because the UI imports their types.
- api-developer: read `node_modules/next/dist/docs/` for route-handler conventions before writing the move route; mirror `split/route.ts` for `params` and the response style. Grep existing tests for the exact string "Approved transactions cannot be edited" before changing that copy.
- ux-developer: freeze nothing until api-developer reports the `MovePreview`/`MoveResponse` types final in `ledger-correction.ts`.
- **Durable-claim exception: not triggered** (no email, no `sentAt`, no success row; `financial_report_sends` is read-only here). No Phase 2 re-review needed on that axis.
- One factual question remains for the treasurer, and the design needs no special-casing for any answer: which fund does the donation row sit in? Administrative (the allowed cell), already Activity (only the sweep remains), or Foundation (nothing to move; at most a category correction and a board-level question about whether the gift was to the Club or the Foundation).
- **Phase 6 re-check list (analyst):** Phase 1 gaps 1, 2, 4, 7, 8 and 12 (D1 is a deliberate deviation on 12), Phase 2 R3b and the R5 reader, and that the Treasury guide and release note never call the tier a second approver or promise acknowledgments for the sweep's Foundation leg.
- Pre-push note for the release that ships this: DECISION-109/110/111 and B-92 to B-97 are uncommitted edits to `docs/decisions.md` and `docs/backlog.md` and must ship with this feature, not with the release being pushed now.

---

# Phase 4 — Implementation

## Phase 4 (server) — Implementation (API) — 2026-10-01

**Owner:** api-developer
**Status:** complete (server half). UI half pending (ux-developer).

### Summary

The whole server half of the Phase 3 design is built: the pure policy, lock classifier and correction vocabulary, the shared validation helper, the audit writer and reader, the move route (GET preview and POST) over one shared evaluator, the hardened DELETE, the PATCH `fundId` 400 and bank-account validation, POST bank-account validation, and the reconcile route's closed-session refusal pinned inside the UPDATE. No schema change, no migration, no email, no new `FEATURES` key. Every server-half test named T1-T33 is written and passing; T34-T36 are component tests and belong to ux-developer.

### What I did

- Pure modules: `ledger-fund-move-policy.ts` (one allowed cell; expense cell its own branch), `ledger-transaction-lock.ts`, `ledger-correction.ts`; cross-reference comment in BOTH policy files; `PUBLIC_DONATIONS_CATEGORY_NAME` exported from `ledger.ts`.
- `ledger-transaction-validation.ts` (category and bank-account fit; only the move uses the category helper, only the new bank checks use the bank helper).
- `ledger-audit.ts` (`recordLedgerAudit()`, `getRecentLedgerCorrections()`), `schema.ts` comment-only edit.
- `ledger-fund-move-queries.ts`: `evaluateFundMove()` (row state + tier) and `evaluateDestination()` (bank-entity assertion + policy) shared by `previewFundMove()` and `executeFundMove()`; tier computed on the `FOR UPDATE` row; stale `expectedFundId` is 409; one audit row per move on the same `tx`, after the UPDATE.
- Routes: `move/route.ts`; DELETE rewritten (JSON `{reason}`, `FOR UPDATE`, 409 on a sent acknowledgment, one snapshot audit row per request); PATCH (fundId 400 before the reconciled lock, bank-account validation only when changed, open-session-match guard, approved copy); POST (bank account always validated); reconcile (session-owned row refused, pinned inside the UPDATE).

### Outputs

Files created: `src/lib/ledger-fund-move-policy.ts`, `ledger-transaction-lock.ts`, `ledger-correction.ts`, `ledger-transaction-validation.ts`, `ledger-audit.ts`, `ledger-fund-move-queries.ts`; `src/app/api/admin/ledger/transactions/[id]/move/route.ts`; tests `ledger-fund-move-policy.test.ts`, `ledger-transaction-lock.test.ts`, `ledger-correction.test.ts`, `ledger-transaction-validation.test.ts`, `ledger-audit.test.ts`, `ledger-fund-move-queries.test.ts`, `[id]/move/route.test.ts`, `[id]/reconcile/route.test.ts`, `[id]/route.delete.test.ts`.
Files modified: `[id]/route.ts` (PATCH + DELETE), `transactions/route.ts`, `[id]/reconcile/route.ts`, `ledger.ts` (one constant), `ledger-transfer-policy.ts` (comment), `db/schema.ts` (comment), and tests `[id]/route.test.ts`, `transactions/route.test.ts`, `financial-report-queries.test.ts`.
Schema changes: none. Migration: none.

Gate: `pnpm exec tsc --noEmit` clean (no output); `pnpm test`: `Test Files  153 passed (153)` / `Tests  2628 passed (2628)`; `pnpm lint`: `✖ 1 problem (0 errors, 1 warning)` (the one warning is the pre-existing unused eslint-disable in `budget-context-panel.tsx`, not a file I touched); `pnpm build:only` exit 0 (`✓ Compiled successfully`). No `console.log`, `alert(`, `confirm(` or `prompt(` added.

#### API contract for ux-developer

Every type below is exported from `src/lib/ledger-correction.ts` (client-safe, no DB import): import shapes, do not re-declare. Never import `ledger-audit.ts` from a client component or a member surface.

Auth for every route below: `auth()` 401, then `LEDGER_RECORD` 403. The row-derived tier then needs `LEDGER_MANAGE` for a reconciled (either mark) or prior-fiscal-year row; the server computes it, never trust a client flag. Error bodies are `{ error: string, code?: string }`.

**`GET /api/admin/ledger/transactions/[id]/move`** (preview). No params or body. 200 body is `MovePreview`: `transaction`, `tier { required, reasons }`, `destinations[]` (every OTHER fund of the row's entity; each `allowed` with `categories`, `defaultCategoryId`, `impact` when allowed, or `denial { code, reason }` when not), `warnings[]` (`{ code, message }`, server-composed copy, render as given), `reasonLimits { min: 10, max: 500 }`. It returns the same status and `code` POST would for any state refusal: 404 `not_found`; 403 `approved | rejected | pending | transfer_leg | dues_synced | manage_required`. A 200 means "this would be accepted if the body is valid"; an entity with no legal destination is still 200 with every destination `allowed: false` (the UI omits the Move button in that case, per D1, by calling `checkFundMove()` over the page's own funds). Impact balances are all-time posted balances; `bankAccount.changeCents` is always 0. Warning codes: `ratchet`, `reconciled`, `prior_fiscal_year`, `sent_statement`, `aged_public_fund`, `sweep_not_automatic`. Denial codes also include `bank_account_entity_mismatch` (type `MoveDestinationDenialCode`).

**`POST /api/admin/ledger/transactions/[id]/move`** body is EXACTLY `{ destFundId, categoryId: string | null, reason, expectedFundId }` (send `expectedFundId = preview.transaction.fundId`). The reason is trimmed server-side; send it as typed. 200 body `MoveResponse { id, fundId, fundSlug, fundName, categoryId, categoryName, sweepSuggested }`. Status and `code` map:

| Status | `code` | Message (verbatim where fixed) |
|---|---|---|
| 400 | `invalid_body` | field-specific ("Reason must be at least 10 characters.", "Unexpected field: x.", ...) |
| 400 | `category_invalid` | "Category does not match fund type" / "Category flow does not match transaction flow" / "Category does not belong to this entity" / "Category is no longer active" |
| 401 / 403 | none | "Unauthorized" / "Forbidden" |
| 403 | `approved`, `rejected`, `pending`, `transfer_leg`, `dues_synced` | specific next-step text |
| 403 | `manage_required` | "Moving a reconciled or prior-year entry needs the Manage Ledger permission." |
| 403 | `cross_entity`, `expense_not_supported`, `away_from_public`, `not_permitted` | the policy reason |
| 404 | `not_found`, `fund_not_found`, `category_not_found` | "Transaction not found" etc. (also a non-uuid id) |
| 409 | `stale` | "This entry changed while you were looking at it. Refresh and try again." |
| 409 | `same_fund`, `bank_account_entity_mismatch` | policy / assertion text |
| 500 | none | "Could not move this entry. Nothing was changed." |

A double click is 409 `stale` (the second request's `expectedFundId` no longer matches) and writes no second audit row. Success: the dialog stays open on its success step; "Record sweep now" links to `/admin/ledger/activity?entity=<slug>&sweepFrom=<id>` where `id` is `MoveResponse.id` (I only return the id; the page handling is yours).

**`DELETE /api/admin/ledger/transactions/[id]`** body is a JSON `{ reason }` (10-500 chars after trim). Send `Content-Type: application/json`; a missing or unparseable body is 400 "A reason is required. Refresh the page and try again." (`code: "reason_required"`). 200 `DeleteResponse { deleted: 1 | 2, acknowledgmentRemoved: boolean }`. Failures: 400 reason; 403 "Approved transactions cannot be deleted" / "Rejected transactions cannot be deleted" / "This transaction was cleared by a closed reconciliation session — reopen it to edit or delete this row" / the two transfer-pair variants (unchanged text); 404; **409 `receipt_sent`: "A receipt was already sent to the donor for this gift. Record a refund entry instead."** (nothing written; the dialog should hide the reason field and Confirm when `ackStatus === "sent"`, and still show this text if the race happens). Match links cascade (static copy only). An unsent acknowledgment is removed with the row (`acknowledgmentRemoved: true`).

**PATCH changes.** `fundId` in the body is 400 "Use Move to another fund." (also on a reconciled row and with `{ donorId, fundId }`). `bankAccountId` on a non-transfer row: non-uuid 400 "Select a valid bank account."; when it DIFFERS from the stored value it must exist, belong to the row's entity and be active (400 "Bank account not found." / "Bank account does not belong to this entity." / "Bank account is inactive. Select an active account."), and a row matched to a bank line is 403 "This transaction is matched to a bank line in an open reconciliation session. Unmatch it before changing its bank account." An unchanged value skips both. Approved copy is now "Approved transactions cannot be edited. Record a refund entry to correct one." **POST `/transactions`** (regular path) now returns the same three 400 bank-account messages. **`POST .../reconcile`** is 403 with `CLOSED_SESSION_LOCK_MESSAGE` for a session-owned row, either direction.

**Reader** (server-only, for the compliance page, in its own try/catch): `getRecentLedgerCorrections({ entityId, now?, days = 90, fetchCap = 200, displayCap = 25 }): Promise<{ rows: LedgerCorrectionRow[]; totalInWindow: number }>` from `src/lib/ledger-audit.ts`, where `LedgerCorrectionRow = { id; createdAt: Date; actorName: string | null; kind: "moved" | "deleted"; amountCents: number | null; flow: string | null; txnDate: string | null; from: string | null; to: string | null; reason: string | null; settledPeriod: boolean; rowCount: number; sentStatementMonth: string | null }` (type exported from `ledger-correction.ts`). `to` is null for deletes; `rowCount` is 2 for a transfer pair; the nullable fields are null only for an unparseable legacy payload, which our writers never produce. `totalInWindow` counts matching rows among the fetched window (capped by `fetchCap`), so render "Showing the {n} most recent of {total}" from `rows.length` and `totalInWindow`. A transfer pair spanning both entities is listed under either entity.

**Which register rows are locked, and why** (use `classifyTransactionLock` / `transactionLockKinds` / `editLockKind` / `moveBlockKind` / `requiredMoveTier` / `LOCK_COPY` from `ledger-transaction-lock.ts`; the server is still the authority):
- **Edit and Delete disabled** (`editLockKind`): `approved` (immutable board finality; correction is a refund entry), `rejected` (kept as a record), `reconciled_session` (cleared by a closed session; reopen it). Pending, transfer legs, dues-synced and legacy-only reconciled rows are NOT edit-locked today (the legacy hole is B-92, deliberately out of scope), so they render Edit and Delete as now.
- **Move omitted** unless the row is movable and has a legal destination (D1): blocked kinds (`moveBlockKind`) are approved, rejected, pending, dues_synced, transfer_leg; expense rows, Foundation rows and Activity rows have no allowed destination under `checkFundMove()`. **Move disabled with the permission message** when the row needs the manage tier (`requiredMoveTier(row, now).tier === "manage"`: reconciled by either mark, or a prior fiscal year) and the caller lacks `LEDGER_MANAGE`.
- **Reconcile toggle disabled** when `reconciledSessionId != null` (the server now refuses it).

### Open questions / handoff notes

- **Next agent: ux-developer.** Contract is frozen as written above; nothing in `ledger-correction.ts` should need to change. The 360px, dialog-shell, reason-field, sweep-prefill, `recent-corrections.tsx` and guide work is unchanged from the Phase 3 plan. T34-T36 (component tests) are yours.
- **Finding for tech-lead (R6 / T20 premise).** Phase 2 R6 expected that moving an unreconciled Administrative row to Activity can un-gate a month. For the only cell v1 moves (INCOME) this cannot happen: `isMonthGatedForEntity` already excludes every uncleared income row as an uncleared deposit (DECISION-059), so such a row never gated. T20 therefore documents both halves: an unreconciled Administrative EXPENSE row gates and the same row in Activity does not (the B-96 case), and an income row never gated. No code change; flagging so the guide and release note do not promise an un-gating effect for v1.
- **Deviations from the design** (all small, none change behavior a consumer sees):
  1. The delete 409 and `LOCK_COPY`-derived move messages: the `approved` move message is a literal ("Approved transactions cannot be moved. Record a refund entry to correct one.") rather than `LOCK_COPY.approved.nextStep`, whose text begins "Approved transactions cannot be edited" and would read as a contradiction in a move refusal. The other four use `LOCK_COPY[kind].nextStep`.
  2. `MovePreview.destinations[].denial.code` is typed `MoveDestinationDenialCode` (the policy codes plus `bank_account_entity_mismatch`), not just `FundMoveDenialCode`, because the bank-account assertion (step 6) can deny a destination too.
  3. Guard order follows the design exactly (bank-account assertion at step 6 before the policy at step 7). Consequence worth knowing: for a row that has a bank account, a destination in ANOTHER entity is refused as 409 `bank_account_entity_mismatch` rather than 403 `cross_entity`, since the row's account never belongs to the other entity. `cross_entity` is reachable only for a row with no bank account. The preview never lists other-entity funds, so the UI is unaffected.
  4. Pure `buildMoveWarnings()` and `formatStatementMonth()` live in `ledger-correction.ts` (not in the queries file) so the copy is testable without a DB; the preview calls it.
  5. The reader also matches a delete audit row by ANY leg's `entityId` in the snapshot (a Club-to-Foundation sweep pair spans two entities), and lists an unparseable row rather than hiding it.
  6. Existing tests edited: `[id]/route.test.ts` (approved copy; the ordinary-row bank-account regression now uses valid uuids and a bank-account row; `getMatchForTransaction` mocked) and `transactions/route.test.ts` (`VALID_NORMAL_BODY.bankAccountId` is a uuid; the 201 test queues the bank-account row; T25 added).
- **Live-database checks left for qa** (a mocked db cannot prove these): two parallel `POST`s to the same move give one 200, one 409 and one audit row; deleting a Foundation donation with a sent acknowledgment is refused and the acknowledgment row survives; the `FOR UPDATE` actually serializes a concurrent reconcile.
- **No emails, no `sentAt`, nothing written to `financial_report_sends`** (read-only lookup only), so the durable-claim exception does not apply.

## Phase 4 (UI) — Implementation — 2026-10-01

**Owner:** ux-developer
**Status:** complete

### Summary

The whole UI half of the Phase 3 plan is built on the frozen `ledger-correction.ts` contract: the Move dialog (preview, destination and category selects, required reason, server-composed warnings, success step with the "Record sweep now" deep link), the Delete dialog with a required reason and the sent-receipt block, up-front lock labels and disabled Edit/Delete in the register, the locked reconcile toggle, the Move button per D1, the sweep-form prefill via `?sweepFrom=`, the "Recent corrections" section on the compliance page, and two guide subsections. No file under `src/lib`, no API route, `docs/decisions.md` or `docs/backlog.md` was touched. T34-T36 plus a corrections-list test are delivered.

### What I did

- `LedgerDialogShell` (Radix Dialog chrome, `w-[calc(100vw-1.5rem)]`, 44px close) and `CorrectionReasonField` (labelled textarea, code-point count against `REASON_LIMITS`, scrolls into view on focus, 16px text on phones).
- `MoveTransactionDialog`: GETs the preview on open; states loading / load error (retry) / blocked (server refusal, no Confirm) / form / success. Impact panel is `grid-cols-1 sm:grid-cols-2` with a full-width "{bank account} balance: unchanged" line; the ratchet warning is a gold-bordered notice, other warnings render as given. Confirm is "Move to {fund}" and enabled only with a destination and a valid reason. Failures: 403/404/409 toast the server message, close and `router.refresh()`; 400 shows inline; 5xx/network toast and stay open. `router.refresh()` otherwise runs only when closing after success (D2).
- `DeleteTransactionDialog` replaces the bare `ConfirmDialog` in the register: required reason, static "also removed" list (plus the unsent-acknowledgment line when `ackStatus === "pending"`), and for `ackStatus === "sent"` (or a `receipt_sent` 409 race) the reason field and Confirm are hidden and the 409 text shown. Any server failure stays inline in the open dialog.
- `TransactionActions`: Edit and Delete render as disabled buttons with the same visible text and a `title` when `editLockKind(row)` is set (approved, rejected, closed-session); a small lock label under the actions (next step visible from `sm` up). Move per D1 via the pure `moveButtonState()` (omitted unless `checkFundMove()` allows a destination among the page's own funds; disabled with the permission message only when the row needs the manage tier and `canManage` is false). New props `canManage`, `ackStatus`, `nowIso`, `entitySlug`.
- `ReconcileToggle` gained `locked` (set from `reconciledSessionId != null`): disabled with the closed-session explanation.
- Sweep prefill: `TransactionForm`/`TransactionFormDialog` take an optional `sweepPrefill` (source account, amount, memo; never the board minute); the register page validates `?sweepFrom=` server-side (uuid, `canRecord`, Club entity with Foundation context, Activity fund, the fund's posted non-transfer income) and renders `SweepPrefillLauncher`, which drops `sweepFrom` from the URL on close. Anything that does not validate is ignored silently.
- Compliance page: "Recent corrections" `<section>` between 990 Determination and Standing reminders, fed by `getRecentLedgerCorrections()` in its own try/catch (a failure renders "Corrections could not be loaded." instead of failing the page). `RecentCorrections` is a Server Component of stacked `rounded-2xl` cards; it and `ledger-audit` are imported only from the compliance page.
- Guide: "Moving an entry to another fund" and "Deleting an entry" subsections in `books-register-section.tsx`; one sentence plus a Move pointer in `guardrails-section.tsx` (a public donation under an Administrative category is not detected). Copy does not promise an "un-gating" effect (api-developer finding 1), does not call the tier a second approver, does not promise acknowledgments for the sweep's Foundation leg, and offers no Foundation-to-Club path.

### Outputs

New: `src/components/admin/ledger/ledger-dialog-shell.tsx`, `correction-reason-field.tsx`, `correction-dialog-logic.ts` (pure request/close/failure helpers), `transaction-move-eligibility.ts` (pure D1 decision), `move-transaction-dialog.tsx`, `delete-transaction-dialog.tsx`, `recent-corrections.tsx`, `sweep-prefill-launcher.tsx`; tests `transaction-actions.test.tsx` (T34, plus locked toggle and no-native-dialog source checks), `delete-transaction-dialog.test.tsx` (T35), `move-transaction-dialog.test.tsx` (T36), `recent-corrections.test.tsx`.
Modified: `transaction-actions.tsx`, `reconcile-toggle.tsx`, `transaction-form.tsx`, `transaction-form-dialog.tsx`, `guide/books-register-section.tsx`, `guide/guardrails-section.tsx`, `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`, `src/app/(dashboard)/admin/ledger/compliance/page.tsx`.
No new decision entries (DECISION-109/110/111 already cover this).

Gate: `pnpm exec tsc --noEmit` clean (exit 0, no output); `pnpm test`: `Test Files  157 passed (157)` / `Tests  2683 passed (2683)`; `pnpm lint`: `✖ 1 problem (0 errors, 1 warning)` (the pre-existing unused eslint-disable in `budget-context-panel.tsx`, not my file); `pnpm build:only` exit 0. No `console.log`, native dialog, or `rounded-full` button added.

Dev-server walk (e2e admin, local `DATABASE_URL` only, via Playwright against the running dev server): seeded a Club Administrative income row dated today (category Misc), a legacy-closed-session reconciled row, a same-fund transfer pair and a spare row. Verified: Move preview lists Activity Fund, Public donations preselected, ratchet and "Moving does not sweep anything" warnings, "Administrative Checking balance: unchanged", Confirm disabled until a valid reason; success step shows "Moved to Activity Fund." and **Record sweep now** (`/admin/ledger/activity?entity=club&sweepFrom=<id>`); the deep link opens the form in Sweep mode with amount 50.00, Administrative Checking as source, Foundation Checking as destination, the memo prefilled and the board-minute field empty, and closing drops `sweepFrom`; a bogus `sweepFrom` is ignored. Register: the closed-session row shows Edit/Delete disabled, a locked reconcile toggle and the "Reconciled. Reopen the reconciliation session..." label; both transfer legs show "Part of a transfer." and no Move. Compliance page lists the Moved card (with reason, from/to) and, after deleting the moved row through the Delete dialog with a reason, the Deleted card. At 360px both dialogs fit with no horizontal overflow and the reason field is reachable. Cleanup: every fixture row, the fixture session and both audit rows removed; counts match the pre-walk state (277 transactions, 754 audit rows, 0 reconciliation sessions).

### Open questions / handoff notes

- **Next agent: qa (Phase 5).** Click-through for a reviewer: `/admin/ledger/administrative?entity=club` (Move on an unreconciled income row; reconciled row with a non-manage caller shows Move disabled with the permission message); success step then **Record sweep now** (confirm the board-minute field is empty and nothing is submitted); `/admin/ledger/compliance?entity=club` (Recent corrections, empty state, truncated footer); Delete dialog on an ordinary row, a transfer, and a Foundation income row with a sent and an unsent acknowledgment; the lock labels on approved, rejected and closed-session rows; 360px for both dialogs. The live-database checks api-developer listed (parallel double-POST, sent-acknowledgment survival, `FOR UPDATE` vs concurrent reconcile) are still open for qa.
- **Deviations from the Phase 3 plan (small):**
  1. Component tests: the repo's Vitest runs in a `node` environment with no jsdom and no testing library (the architect ruled out new dependencies), so T34-T36 are `renderToStaticMarkup` renders of presentational bodies (`MoveDialogBody`, `DeleteDialogBody`) plus pure helpers (`correction-dialog-logic.ts`) for the request body, close/refresh rule and failure routing. "Dialog stays open on a failed delete" and "refresh only on Done" are asserted through `resolveMoveClose()` and source-level checks, not simulated clicks; the live walk above exercised the real behavior.
  2. The register also labels transfer legs ("Part of a transfer.") and dues-synced rows ("Posted from dues."), where Edit still works, so the label is informational and shows only the short label (no next-step text). The design only labelled the three hard-locked kinds.
  3. Action buttons in the register gained `min-h-[44px] sm:min-h-0` for phone tap targets; the visible text and role names are unchanged, so existing e2e selectors on "Edit" still resolve. The per-row reconcile checkbox stays its existing 24px size (not touched).
  4. `moveButtonState()` takes the server's `nowIso` (not a `currentFiscalYear` number) because `requiredMoveTier()` takes a `Date`; the tier is therefore decided identically on server and client.
  5. Delete 403/404 messages (approved, rejected, closed session) also show inline in the open dialog rather than as a toast; the dialog stays open as the plan said.
- **New copy the Lions Club may want to refine:** the "Read before moving" notice heading, "Category in {fund}" help text ("The old category belongs to {fund}, so a new one is needed here."), the success-step line, the Delete dialog list ("Also removed with it"), the example reason hints, and the two guide subsections.
- **UX tradeoffs:** Move opens a Dialog (not `ConfirmDialog`) because it hosts selects and a textarea, so the confirm is the dialog's own submit button; the sweep deep link navigates away from the dialog, so no refresh is needed on that path. Denied destinations are listed as text with their server reason rather than as disabled options (v1 never shows more than one in practice).
- **E2E:** the qa-owned spec `e2e/ledger-move-transaction.spec.ts` from the Phase 3 plan is not written; the selectors it needs exist (`#move-reason`, `#delete-reason`, button names "Move", "Delete", "Record sweep now", "Done"). Its fixture cleanup must also remove `ledger_audit_log` rows, which do not cascade with the transaction.


---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Typecheck, lint, 2683 unit tests and the production build are green; every Phase 3 and Phase 2 guard named in the brief was confirmed by reading the code and, for the concurrency, lock, permission-tier and cascade claims a mocked db cannot prove, by live checks against `DATABASE_URL` (never `PROD_DATABASE_URL`). The new serial e2e spec (8 tests) passes on two consecutive runs. The local database was left exactly as found (final snapshot identical to the pre-test snapshot). No feature defect was found; four non-blocking observations are listed under Open questions.

### What I did

#### 1. Gate commands (summary lines verbatim)

| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS. No output, exit 0 (re-run after adding the e2e spec: still exit 0). |
| `pnpm test` | PASS. `Test Files  157 passed (157)` / `Tests  2683 passed (2683)` / `Duration  3.93s` |
| `pnpm lint` | PASS. `✖ 1 problem (0 errors, 1 warning)`. The one warning is the pre-existing unused eslint-disable at `src/components/admin/ledger/budget-context-panel.tsx:114`, a file this feature does not touch. |
| `pnpm build:only` | PASS. `✓ Compiled successfully in 900ms`, `Finished TypeScript in 4.4s`, `✓ Generating static pages using 15 workers (125/125) in 1839ms`, exit 0. The route table lists `ƒ /api/admin/ledger/transactions/[id]/move`. |
| `src/lib/admin-page-feature-gates.test.ts` | PASS (`Tests  167 passed (167)`). |

#### 2. Diff review against Phase 2 rulings and Phase 3 design (47 changed non-doc files)

| Check | Result | Evidence |
|---|---|---|
| Policy allow-list has exactly one cell | PASS | `src/lib/ledger-fund-move-policy.ts`: the only `allowed: true` return is `flow === "income"` + `administrative` to `activity`, after the same-fund and cross-entity guards; unknown flow and unknown kind fall through to `not_permitted`. T1 counts the allowed cells and asserts exactly 1. |
| Mutual-exclusion test vs `ledger-transfer-policy.ts` exists and passes | PASS | `ledger-fund-move-policy.test.ts` T3 ("no (from, to) pair is allowed by both policies", plus the pinned divergence on administrative to activity). Cross-reference comment blocks present in BOTH policy files (R2c). |
| POST guard order matches the design; every guard precedes the UPDATE | PASS | `executeFundMove()` in `src/lib/ledger-fund-move-queries.ts`: `FOR UPDATE` select first, then state block, tier, source fund, stale `expectedFundId`, destination fund, bank-account entity assertion, direction policy, category, sent-statement lookup, UPDATE, audit insert. Body parse and exact-key-set check happen in the route before any DB read. The only deviation from the design is that the source-fund lookup sits inside `evaluateFundMove()` ahead of the stale check (harmless: it can only add a 404 for a corrupt row). |
| `FOR UPDATE` WHERE shape pinned by a `PgDialect` test | PASS | `ledger-fund-move-queries.test.ts` T13: first call is a `select` on `ledgerTransactions` with `.for("update")`, rendered where `"ledger_transactions"."id" = $1`, params `[id]`; UPDATE where renders `("ledger_transactions"."id" = $1 and "ledger_transactions"."fund_id" = $2)`. |
| Stale `expectedFundId` is 409 | PASS | T15 (unit) and live check (b) (below). |
| One audit row per move and per delete; transfer pair = one row, two snapshots | PASS | `recordLedgerAudit()` called once per request on the same `tx`, after the UPDATE (move) and before the delete (delete, `targetTransactionId: null`, `before = { v: 1, rows: [...] }`). Live: pair delete returned `deleted: 2` and produced one audit row (card shows "2 entries"). |
| Reconcile route refusal is inside the UPDATE statement | PASS | `reconcile/route.ts`: `.where(and(eq(id), isNull(reconciledSessionId))).returning(...)`; zero rows triggers the 404-vs-403 lookup. Pinned by T26 (`... "reconciled_session_id" is null`). Mutation-proved (see Regression Tests). |
| PATCH returns 400 on `fundId` | PASS | Evaluated after the JSON parse and before the reconciled-lock check; live: 400 on an ordinary row and on a reconciled row `{ donorId, fundId }`. `RECONCILED_LOCK_CARVEOUT_FIELDS` untouched. |
| Bank-account validation: PATCH only when changed, POST always | PASS | PATCH validates and runs the open-session-match guard only inside `if (body.bankAccountId !== existing.bankAccountId)`; POST validates unconditionally. Live: unchanged id plus a memo edit returns 200; cross-entity, nonexistent and malformed ids return 400 (not 500); POST with the same bad ids returns 400 and creates no row. |
| Audit reader imported only from the admin compliance page | PASS | `getRecentLedgerCorrections` is imported only in `src/app/(dashboard)/admin/ledger/compliance/page.tsx`. `grep -rn "ledger-audit\|ledger-correction"` over `src/app/members`, `src/components/members`, `src/app/api/members` and `src/lib/financial-report-*.ts`: no matches. The fs-grep guard test (T33) passes. |
| No `console.log`, no native dialogs | PASS | Grep over all changed/new src and e2e files: only a comment ("never window.confirm") matches. Route handlers keep the repo's existing `console.error`. |
| Feature gates present on the new route; admin-page gate test | PASS | See the Feature-Gate Audit table; `admin-page-feature-gates.test.ts` green. |
| No schema/migration change; no personal data; no hard-coded UUIDs in src | PASS | `schema.ts` diff is comments only; PII grep over the 47 changed files is empty; no UUID literals in non-test src. |
| Brand rules | PASS | No `rounded-xl`; one `rounded-full` on a status badge chip in `recent-corrections.tsx` (chips are exempt, buttons are not). |

#### 3. Live checks (DATABASE_URL only, e2e admin credentials; host verified different from `PROD_DATABASE_URL` before starting)

Method: a local script signs in through the real credentials endpoint and drives the routes with the session cookie; fixtures are direct inserts tagged "QA5"; every run is followed by a tag-scoped cleanup and a before/after database snapshot diff.

| # | Check | Result | Observation |
|---|---|---|---|
| (a) | Treasurer flow in the browser: seed an Administrative income row ($50.00), Move to Activity with a reason, follow Record sweep now, record the sweep, read the compliance page | PASS | Preview offered Activity Fund with "Public donations" preselected, the ratchet sentence and "Administrative Checking balance: unchanged"; Confirm was disabled until the reason was typed. After the move: Administrative -$50.00, Activity +$50.00, every bank-account balance unchanged. The deep link opened the form in Sweep mode with amount 50.00, source Administrative Checking, destination Foundation Checking and an EMPTY board-minute field; submitting without a minute was refused (nothing posted). With a minute and the Confirm Sweep dialog: two posted rows in one transfer group. Net vs the pre-test baseline: Administrative 0, Activity 0, Charitable +$50.00; Administrative Checking 0, Foundation Checking +$50.00. The Club compliance page lists the move with reason and "Administrative Fund to Activity Fund"; the Foundation compliance page does not list it. |
| (b) | Parallel POSTs of one move | PASS | n=2: `200, 409:stale`, exactly 1 audit row. Repeated with n=6: one 200, five `409:stale`, exactly 1 audit row; row ends in Activity with the Public donations category. |
| (c) | Foundation donation with a SENT acknowledgment, DELETE with a reason | PASS | `409 receipt_sent` ("A receipt was already sent to the donor for this gift. Record a refund entry instead."); the transaction row, the acknowledgment row and its `sent_at` all survive; zero audit rows written. Also: no body 400, short reason 400. Control: with the acknowledgment unsent, the same DELETE is 200 `acknowledgmentRemoved: true`, one `transaction_deleted` audit row with `target_transaction_id` null and a snapshot carrying the deleted id and `acknowledgment: { existed: true, sent: false }`. |
| (d) | `FOR UPDATE` vs a concurrent writer | PASS | A raw transaction held `SELECT ... FOR UPDATE` on the row. (d1) The move POST did NOT complete in 4s, and after release it waited and succeeded (200, one audit row). (d2) While the lock was held the row was flipped to reconciled; the record-only caller's move waited, then returned the designed `403 manage_required` after release (tier is judged on the post-lock row; row unchanged, zero audit rows). (d3) Move and the real reconcile route both queued behind the held lock, four runs with staggered arrival: the move won each time (move 200, reconcile 200, final row in Activity and reconciled, audit `reconciled: false`, `tier: record`), consistent with the lock queue order. Outcome recorded: the move waits for the lock and re-evaluates; it does not return a conflict. |
| (e) | Reconcile toggle on a row cleared by a closed session | PASS | Both directions `403` with `CLOSED_SESSION_LOCK_MESSAGE`; the row keeps `reconciled = true` and its session pointer. Control: a legacy-only reconciled row still toggles off (200). |
| (f) | `ledger.record` without `ledger.manage` (temporary user holding the existing `treasurer` role; no role edits needed) | PASS | Move of a legacy-reconciled row, a closed-session row, a prior-fiscal-year row (2026-03-15) and the fiscal-year edge row (2026-06-30): each `403 manage_required` on both GET and POST; rows unchanged. The 2026-07-01 row and a same-day row (current FY, unreconciled): preview tier `record`, move 200. The same four locked rows moved by the admin (has `ledger.manage`): 200, audit `tier: manage`, reconciled flag and session pointer preserved, the closed session stays closed. A member-role user gets 403 on GET, POST and DELETE; an anonymous caller gets 401. |
| (g) | Register lock labels and compliance cards at 360px | PASS | Screenshots in the scratchpad `qa5-shots/` folder (`g2-lock-closed-360.png`, `g2-lock-approved-360.png`, `g2-lock-rejected-360.png`, `g2-lock-transfer-360.png`, `g2-movable-360.png`, `g-compliance-corrections-360.png`, `g-compliance-360-full.png`). Edit and Delete render disabled with the lock label ("Reconciled.", "Approved.", "Rejected.", "Part of a transfer."); the compliance cards stack with Moved/Deleted badges, "Settled period", "2 entries" and the wrapped reason, and neither the section nor the page overflows horizontally (section 312/312, page 360/360). |

Extra live refusals confirmed with the documented status and `code`: extra key, missing reason, short reason, whitespace-only reason (400 `invalid_body`); wrong `expectedFundId` (409 `stale`); same fund (409 `same_fund`); admin category on an Activity move (400 `category_invalid`); unknown fund (404 `fund_not_found`); unknown category (404 `category_not_found`); approved, pending, rejected, transfer leg (403 with the matching code, GET and POST identical); expense Administrative to Activity and income Activity to Administrative (403 `away_from_public`, preview shows zero allowed destinations); Foundation income row (preview 200, zero destinations).

Cleanup and proof: after every script a tag-scoped cleanup removed the fixtures, audit rows, closed sessions, temporary users and the two `blocked_non_production` "New portal user needs member record review" queue rows my temporary-user sign-ins caused. The final snapshot equals the pre-test snapshot field for field: 277 transactions, 754 audit rows (0 of the two new actions), 0 reconciliation sessions, 1 acknowledgment (the pre-existing sent one, untouched), 2 donors, 53 users, 70 user_roles, 77 role_features, 1159 email_queue, amount and updated_at checksums equal, fund balances activity 8452 / administrative 1638412 / charitable 583657.

#### 4. End-to-end

`e2e/ledger-move-transaction.spec.ts` (new, serial) plus a cleanup helper in `e2e/helpers/ledger-fixture-cleanup.ts`. Run: `pnpm test:e2e e2e/ledger-move-transaction.spec.ts --reporter=list --workers=1`. Result: `8 passed (32.8s)` and again `8 passed (32.1s)`; the DB snapshot matched the baseline after each run. The full 12-minute suite was not run, as instructed.

Tests: moves an Administrative income row to Activity and opens the sweep form with the board minute empty (asserts ratchet, bank-unchanged line, Public donations default, Confirm disabled until a reason, DB fund changed, no sweep rows created); compliance lists the move on the Club page and not the Foundation's; lock label and disabled Edit/Delete on a closed-session row; reconcile toggle refused on that row; PATCH `fundId` 400; delete of a sent-acknowledgment donation 409 with both rows surviving; delete through the dialog with a reason listed as Deleted; Move dialog fits 360px. Cleanup removes audit rows by the "E2E QA Move" tag in the reason/snapshot (audit rows are not cascade-deleted with a transaction), then transactions by party tag, then the fixture session; it runs in `beforeAll` and `afterAll`.

#### 5. Manual click-through

No flow here needed a manual pass: no Google OAuth, Resend delivery, Givebutter or Group sync is touched. The treasurer flow was driven in a real Chromium against the dev server (check (a)).

### Regression Tests Added

| Guards against | Test (file) | Pre-fix failure shown |
|---|---|---|
| Reconcile toggle stripping a closed session's lock (R3b, DECISION-036 bypass) | `src/app/api/admin/ledger/transactions/[id]/reconcile/route.test.ts` T26 ("a session-owned row is 403 in direction reconciled=true/false, with no write"; "the UPDATE where pins the refusal: id AND reconciled_session_id is null"); e2e `should refuse to un-reconcile a row owned by a closed session and keep its session pointer — regression for the reconcile-toggle lock bypass` | Mutation check: with the refusal and the `isNull` pin removed, 3 of 8 tests fail (the two direction tests and the where-shape test); file restored byte-identical afterwards. |
| Delete cascading away a SENT acknowledgment (the IRS substantiation record) | `src/app/api/admin/ledger/transactions/[id]/route.delete.test.ts` T29 ("a sent acknowledgment is 409 receipt_sent with nothing written"; "...on the PARTNER leg of a pair is 409 too"); e2e `should refuse to delete a donation whose receipt was already sent and keep both rows — regression for sent-acknowledgment cascade loss` | Mutation check: with the `sentAt` guard disabled, 2 of 23 tests fail; file restored byte-identical. |
| The move policy quietly gaining a second cell, or overlapping the transfer policy | `src/lib/ledger-fund-move-policy.test.ts` T1 ("exactly one cell is allowed"), T2, T3 ("no (from, to) pair is allowed by both policies", pinned divergence) | Mutation check: allowing activity to charitable income and dropping the cross-entity guard fails 4 of 10 tests, including the T1 count and the T3 mutual-exclusion test; file restored byte-identical. |
| PATCH silently ignoring `fundId` | `[id]/route.test.ts` T23; e2e `should answer 400 when an ordinary edit tries to change the fund` | Unit test only (the old behavior was a 200 no-op). |

The three mutation runs temporarily edited feature files, with byte-checksum restore verified (`shasum` compared before and after) and the tree re-checked green afterwards (tsc, lint, 2683 tests, e2e).

### Coverage on Critical Modules

- This feature's modules: `ledger-fund-move-policy.ts`, `ledger-transaction-lock.ts`, `ledger-transaction-validation.ts` and `permissions.ts` together 100% (141/141 statements, 122/122 branches). `ledger-correction.ts` 100% statements / 93.26% branches; `ledger-audit.ts` 100% / 78.78%; `ledger-fund-move-queries.ts` 99.13% / 85.54%; `[id]/move/route.ts` 95%.
- `src/lib/events.ts`: 94.86% statements (target 90%+, met).
- `src/lib/permissions.ts`: 100% (target met).
- `src/lib/members.ts`: 36.84% statements (target 80%+, NOT met). Pre-existing and not touched by this feature; flagged for the 7-day coverage review, not a blocker here.
- Whole `src/lib`: 68.88% statements (target 70%+ for pure-TS modules, marginally under). Pre-existing drift, dominated by DB-bound modules; also for the weekly review.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /api/admin/ledger/transactions/[id]/move` | yes (401), before any row read | yes, `authorize()` runs before `isUuid` and the DB | `FEATURES.LEDGER_RECORD`; row-derived tier adds `FEATURES.LEDGER_MANAGE` (resolved as a boolean, decided from the row) |
| `POST /api/admin/ledger/transactions/[id]/move` | yes (401), before the body is parsed | yes, same `authorize()` | `FEATURES.LEDGER_RECORD` + tier `FEATURES.LEDGER_MANAGE` for reconciled or prior-FY rows (live-verified 403 for record-only, 200 for manage) |
| `DELETE /api/admin/ledger/transactions/[id]` | yes | yes, before the body and before any row read | `FEATURES.LEDGER_RECORD` (unchanged by design; prior-FY gap is B-97) |
| `PATCH /api/admin/ledger/transactions/[id]` | yes | yes, before the row read | `FEATURES.LEDGER_RECORD` (unchanged) |
| `POST /api/admin/ledger/transactions/[id]/reconcile` | yes | yes, before the row read | `FEATURES.LEDGER_RECORD` (unchanged) |
| `POST /api/admin/ledger/transactions` | yes | yes | `FEATURES.LEDGER_RECORD` (unchanged) |
| Compliance page `/admin/ledger/compliance` (reads the audit log) | yes (redirect) | yes, `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` before any query | ledger-gated; reader unreachable from member surfaces (guard test + grep) |
| Register page `?sweepFrom=` | yes | `canRecord` required, else ignored silently | `FEATURES.LEDGER_RECORD` |
| Server actions (`"use server"`) | none added or changed | n/a | n/a |

All gates are read from the route files, not inferred from passing tests. Member-role and anonymous callers were also exercised live (403 and 401).

### Verdict: PASS

### Outputs

- `docs/work-log/2026-10-01-move-or-cancel-transaction.md` (this section; status table updated)
- `e2e/ledger-move-transaction.spec.ts` (new)
- `e2e/helpers/ledger-fixture-cleanup.ts` (added `MOVE_FIXTURE_TAG`, `MOVE_FIXTURE_SESSION_CSV`, `cleanupMoveTransactionFixtures()`; existing exports unchanged)
- Screenshots: scratchpad `qa5-shots/` (360px lock labels, compliance cards, sweep prefill, desktop compliance)
- No change to `docs/decisions.md` or `docs/backlog.md`; no feature code left modified (the three mutation checks were restored byte-identical).

### Open questions / handoff notes

- **Next agent: analyst, Phase 6 (SHIP IT review).** Re-check Phase 1 gaps 1, 2, 4, 7, 8 and 12 and Phase 2 R3b and the R5 reader (the Phase 3 re-check list); all are present in the shipped behavior. Observations for the analyst to weigh (none are failures):
  1. **Gap 8 on phones.** At 360px the lock label shows only the short label ("Reconciled."); the next-step sentence is a `title` tooltip below the `sm` breakpoint (visible text from `sm` up), exactly as Phase 3 specified. A phone user sees why but not the recommended path without a long-press.
  2. **Error code for a cross-entity destination.** Because the bank-account entity assertion precedes the direction policy (the design's own order), a cross-entity destination on a row that has a bank account returns `409 bank_account_entity_mismatch`, not `403 cross_entity`. Already documented as api-developer deviation 3; the UI never offers other-entity funds.
  3. **Accepted residual, confirmed live.** A legacy-only reconciled row can still be un-toggled by a record-only user and then moved at the lower tier (R3c, B-92). The audit row records `reconciled` and the tier used.
  4. **Dev-mode noise, not a defect.** The dev server logs a React "eval() is not supported in this environment" console error under the dev CSP on every page; it is unrelated to this feature and absent from production builds.
- **Housekeeping outside this feature.** The e2e admin user has five duplicate `user_roles` rows per role (`scripts/create-test-user.mjs` uses `ON CONFLICT DO NOTHING` with no unique constraint to hit); `members.ts` (36.84%) and whole-`src/lib` (68.88%) coverage are under target. Both go to the weekly coverage review.
- **No mail left the machine.** Signing in the two temporary test users queued two board-notification rows, both `blocked_non_production` (deny-by-default), and both were removed.
- If an e2e run is interrupted, `cleanupMoveTransactionFixtures()` runs from the next run's `beforeAll`, so leftovers cannot break a later run.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-10-01

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES.** One note is a pre-push condition (release-notes text only, no code); the rest are tracked follow-ups. No regression, no red flag.

## ONE-LINE TAKE

> The shipped feature is exactly the general, audited, one-cell Administrative-to-Activity move plus a hardened delete that Phases 1-3 agreed to, with every REQUIRED architect ruling present and live-verified, but it is not what resolves the treasurer's own case (a gift on the Foundation's books whose cash is in the Club's account), and the in-app guide and the release-notes draft never tell him what to do for that case.

## Scope note: the treasurer's actual case

Phase 1 Open Question 1 asked which side the donation was entered on, and Phase 1 adopted "Club Administrative Fund" as the default. The answer that came back is different: the donation is **physically deposited in the Club's bank account but belongs to the Foundation**, and the treasurer's own path for it is the one that already existed: delete the wrong entry, re-enter the gift as Club Activity Fund income on the Club's account, then record the minuted sweep. Consequences I checked:

- The shipped **Move cannot be used for this case**, by design: Move is one cell (same entity, income, Administrative to Activity) and never touches a bank account. A Foundation-books row has no Move button at all (Phase 3 D1: omitted, not disabled), so on the Foundation register he sees nothing that explains why.
- The architect's Correction 2 ("Foundation to Club re-entry is unsafe, withdrawn") is true only when the cash is in the Foundation's account. When the cash is in the Club's account (this case) the re-entry lands on the account the cash actually touched and is correct. B-96 and DECISION-109 repeat the one-sided phrasing ("a Foundation-to-Club re-entry would put a Club row on a bank account the cash never touched"), and the guide says "offers no Foundation-to-Club path". Read together they leave the real case undocumented on every treasurer-facing surface. (The uncommitted `CLAUDE.md` "Ledger corrections" paragraph does state it correctly: "The Foundation-deposit case ... is NOT a move: delete, re-enter as Activity income on Administrative Checking, then sweep." That is developer guidance, not something the treasurer reads.) Not wrong, but it is exactly the case the requester has.
- The **hardened Delete changes this path's behavior in his favor and against him in one case**: it now needs a reason, writes a snapshot to Recent corrections, and warns about an unsent acknowledgment, but it **refuses (409 `receipt_sent`)** if a receipt for that gift was already sent. Before this release that delete silently destroyed the acknowledgment record. If he has already sent a receipt, the path is now a refund entry on the Foundation's books, and he should hear that before he hits the 409.
- The feature is still the right thing to have shipped: the general move (Flow 2) is real and recurring, and the delete hardening closes two silent data-loss paths (Phase 1 Gap 2, R3b) regardless of his instance. But the release notes must not let him believe Move fixed his case.

## What's Working

- **The one-cell policy is exactly one cell and provably separate from the transfer policy.** `checkFundMove()` allows only income, same entity, administrative to activity; every other cell has its own branch and reason (expense Activity to Administrative is its own `expense_not_supported` branch, a one-branch flip for B-96). T1 counts the allowed cells, T3 pins that it intentionally differs from `checkTransferDirection()`, and the cross-reference comment is in both files (R2c). QA's mutation run confirmed the tests bite.
- **Move is atomic, serialized and double-click-safe.** `executeFundMove()` takes `FOR UPDATE` as its first statement, re-derives tier and every guard on the locked row, pins the UPDATE with `fund_id`, and writes the audit row on the same `tx` after the update. QA proved it live: six parallel POSTs gave one 200, five 409 `stale`, one audit row; a move held behind a lock waits and then re-evaluates (tier judged on the post-lock row).
- **Permission tiers are enforced in the route body, not the button.** `LEDGER_RECORD` then a row-derived `LEDGER_MANAGE` need for reconciled-by-either-mark or prior-FY rows, preview and execute return identical status and code (D6). Live: a treasurer-role (record-only) user got 403 `manage_required` on legacy-reconciled, closed-session, prior-FY and the 2026-06-30 edge row, 200 on the 2026-07-01 row; member 403, anonymous 401.
- **The reconciled carve-out is limited to fund, and the toggle bypass is closed.** The move moves only `fund_id`, `category_id` and clears `budget_line_id`; `RECONCILED_LOCK_CARVEOUT_FIELDS` is still `["donorId"]`; PATCH with `fundId` is 400 "Use Move to another fund." even on a reconciled row and with `{ donorId, fundId }`. The reconcile route refuses a session-owned row in both directions with the pin inside the UPDATE (R3b), mutation-proved by QA.
- **Delete is no longer a silent data-loss path.** Required reason (400 before any DB read), `FOR UPDATE`, one snapshot audit row per request (two snapshots for a pair, FK-nulled target so the reader selects by action), 409 `receipt_sent` with nothing written (live: the transaction, acknowledgment row and `sent_at` all survived), unsent acknowledgment warned and reported. No `voided` status, as ruled.
- **The audit has a reader, and it is member-firewalled.** "Recent corrections" on the compliance page (LEDGER_VIEW or wider), 90 days, stacked `rounded-2xl` cards with Moved/Deleted, Settled period and Statement-already-sent badges, own try/catch with "Corrections could not be loaded." Reader and vocabulary are imported only from the compliance page; the fs-grep guard (T33) and my own grep of members surfaces agree. Live: the move shows on the Club page and not the Foundation's.
- **Bank-account validation and the open-session-match guard shipped** (POST always, PATCH only when changed, so an unrelated edit on a row with a later-deactivated account still works): nonexistent and malformed ids are 400 not 500, cross-entity is 400.
- **The sweep follow-through is honest.** Success step says "Moved to Activity Fund." and offers Record sweep now; the deep link is validated server-side (uuid, `canRecord`, Club Activity page, the fund's posted non-transfer income) and ignored silently otherwise; the form opens in Sweep mode with amount, source account and memo filled and the **board-minute field empty**; submitting without a minute was refused in QA. The warnings say moving does not sweep anything and the ratchet is stated verbatim.
- **I re-ran the gate myself:** `pnpm exec tsc --noEmit` clean; `pnpm test` 157 files, 2683 tests passed. Decisions DECISION-109/110/111 and backlog B-92 to B-97 are present in `docs/decisions.md` and `docs/backlog.md`.

## Intent-Vs-Shipped Diff

- Phase 1 said: general same-entity move, not a transfer or reversal pair or editable fund field. Shipped: dedicated `POST/GET .../move`, PATCH rejects `fundId`. Verdict: **matches**.
- Phase 1 said: move toward-public only (balance-direction rule). Shipped: allow-list of one cell, expense cell denied with its own reason (B-96), per architect R2b. Verdict: **matches (narrower by ruling)**.
- Phase 1 said: reconciled carve-out limited to fund and category, dedicated endpoint, approved/rejected/pending/transfer/dues never carved out. Shipped: exactly that; legacy `reconciled = true` counts as reconciled for tiering. Verdict: **matches**.
- Phase 1 said: reconciled or prior-FY needs `LEDGER_MANAGE`; else `LEDGER_RECORD`. Shipped: same, from the locked row. Phase 2 Correction 4 stands: the tier is a permission, not a second approver, and the treasurer is one of the two admins who hold it. Verdict: **matches**.
- Phase 1 said: required reason, audit with a reader (Gap 1). Shipped: reason 10-500 code points, same-transaction audit, Recent corrections list. Per-row "History" and the Activity-register "Moved from Administrative" note (Flow 1 step 8) were not shipped; the architect made the per-row marker a suggestion. Verdict: **acceptable drift** (follow-up B-next-C).
- Phase 1 said: hardened delete, 409 on sent acknowledgment, warn-not-block on unsent (Gap 2). Shipped as specified, no voided status. Verdict: **matches**.
- Phase 1 said: PATCH `fundId` is a 400 (Gap 4). Shipped. Verdict: **matches**.
- Phase 1 said: validate bank account server-side; refuse a bank-account change on an open-session-matched row; legacy-toggle hole is an architect call (Gap 7). Shipped: validation and match guard; legacy hole deferred to B-92 with R3b closing the session-owned half. Verdict: **matches (as ruled)**.
- Phase 1 said: show lock reasons up front (Gap 8). Shipped: disabled Edit/Delete with same visible text, lock label, locked reconcile toggle, plus labels on transfer legs and dues rows. Below `sm` the next-step sentence is a `title` only. Verdict: **acceptable drift** (follow-up B-next-B).
- Phase 1 said (Flow 3): bank-account help text on the edit form ("Pick the account the money actually went into... record a Transfer instead"). Shipped: not present (not in the Phase 3 design either). Verdict: **acceptable drift** (copy only; B-next-B).
- Phase 1 said (Gap 12): disabled Move with "No other fund in this entity can hold this row." Shipped: omitted (Phase 3 D1). Verdict: **acceptable drift**, deliberate and sensible, but it is why the Foundation register shows no explanation for the treasurer's case (B-next-A).
- Phase 1 said (Flow 1 step 6): toast with a Record sweep now button. Shipped: dialog success step with the same button, refresh on Done (D2). Verdict: **acceptable drift (better)**.
- Phase 1 said: say at move time that a sent statement will read "corrected." Shipped, but the lookup covers only the row's own month. Verdict: **acceptable drift** with a gap (B-next-D below).
- Phase 1 said: tell the treasurer why no flag fired (Gap 3). Shipped: guardrails guide sentence and release-note bullet, B-93 filed. Verdict: **matches**.
- Phase 1 said: don't promise acknowledgments for the sweep's Foundation leg (Gap 10). Shipped: guide and release note both say so. Verdict: **matches**.
- Architect R6 expectation: moving an unreconciled Administrative row can un-gate a month. Shipped: true only for expense rows, so for v1 it does not happen; T20 documents both halves. Verdict: **matches reality (premise corrected, see rulings)**.

## Rulings on QA's four observations

1. **Short label plus tooltip at 360px (Gap 8 on phones): accepted as drift, with a small follow-up.** The label that is visible at every width ("Reconciled.", "Approved.", with a lock icon) satisfies the intent of "show the reason before the click"; the recommended next step is visible from `sm` up and a `title` below it, as Phase 3 specified. The weakness is real, though: a `title` on a **disabled** button is unreliable on touch. The Move-disabled message, by contrast, is visible text at every width, so the register is inconsistent. Not a blocker for a wide-table desk tool; fix by showing the next step as wrapped visible text at all widths (B-next-B).
2. **409 `bank_account_entity_mismatch` before 403 `cross_entity`: accepted.** It follows the Phase 3 guard order, it is a refusal either way, nothing is written, the message leaks nothing a ledger-record holder cannot already see, and the UI never offers another entity's fund. The cost is a slightly wrong status family for a policy denial. Note it in B-96's cross-entity item so whoever designs that reorders the two checks. No change now.
3. **Legacy-only reconciled rows can be un-toggled and then moved at the lower tier: accepted under B-92, with one correction to the claim.** R3c and QA say "the audit row still records it". It records `reconciled: false` and `tier: record`, i.e. the state **after** the un-toggle, and the legacy toggle itself writes no audit row, so the sequence is invisible in Recent corrections. That does not change the ship call (a legacy mark never froze any tie-out, and only a ledger-record holder can do it), but B-92's text should say that the toggle is unaudited (B-next-E).
4. **`members.ts` coverage (36.84%) and whole-`src/lib` (68.88%): out of scope, agreed.** Pre-existing, not touched by this feature, belongs to the 7-day coverage review. The modules this feature added or changed are at 99-100% statements.

## Rulings on the implementers' deviations

**api-developer**

1. Approved-move message is a literal ("Approved transactions cannot be moved. Record a refund entry to correct one.") instead of `LOCK_COPY.approved.nextStep`: **accept**; reusing the edit copy would have read as a contradiction in a move refusal.
2. `denial.code` typed `MoveDestinationDenialCode` (adds `bank_account_entity_mismatch`): **accept**; the type reflects reality.
3. Bank-account assertion before the direction policy, so cross-entity on a row with a bank account is 409: **accept** (see QA ruling 2).
4. `buildMoveWarnings()` and `formatStatementMonth()` in `ledger-correction.ts`: **accept**; copy testable without a DB, which is what D3 wanted.
5. Reader matches a delete audit row by any leg's `entityId` and lists unparseable rows: **accept, and it is the better behavior.** A Club-to-Foundation sweep pair appears on both compliance pages, and a legacy payload is shown rather than hidden. Reason text is therefore visible on both entities' compliance pages to LEDGER_VIEW holders, which matches the intended board visibility.
6. Existing tests edited (approved copy; uuid fixtures; `getMatchForTransaction` mocked; `VALID_NORMAL_BODY.bankAccountId` a uuid): **accept**; each edit is forced by a deliberate behavior change in this release, not by loosening an assertion. The `editLockKind` test still pins PATCH/DELETE to the old guard table.
7. **T20 finding (a move never un-gates a month for v1): ruled correct and accepted.** I verified it in `isMonthGatedForEntity()`: `isUnclearedDepositRow()` excludes every unreconciled income row (DECISION-059), and the only cell v1 moves is income, so an Administrative income row never gated and moving it out changes nothing. I grepped `src`, the guide, the dialogs and `docs/decisions.md` for any un-gating promise and found none; the release-notes draft does not make one either. The first T20 test (an unreconciled Administrative expense row gates, the same row in Activity does not) is the B-96 case and is correctly labelled as such. Action: none now; when B-96 enables the expense cell, the dialog and release note must then say a move can make a month ready to send. Recorded in B-next-F.

**ux-developer**

1. No jsdom or testing library, so T34-T36 are `renderToStaticMarkup` of presentational bodies plus pure helpers: **accept**, with a stated weakness. "Dialog stays open on a failed delete" and "refresh only on Done" are asserted through pure helpers and source checks, not click simulation. The gap is covered by the live dev-server walk, QA's 8-test Playwright spec (move, sweep deep link with empty minute, 360px, delete, lock label, sent-receipt 409) and QA's live checks. A DOM test harness is a dependency decision for the architect; low priority (B-next-G).
2. Labels on transfer legs ("Part of a transfer.") and dues rows ("Posted from dues."): **accept**; informational, short label only, Edit still works.
3. `min-h-[44px] sm:min-h-0` on action buttons: **accept**; role names and text unchanged so existing e2e selectors on "Edit" resolve. The per-row reconcile checkbox is still 24px and was not touched; leave.
4. `moveButtonState()` takes server `nowIso`: **accept**; tier is decided identically on server and client.
5. Delete 403/404 messages inline in the open dialog: **accept**; matches the plan.
6. New copy ("Read before moving", "Category in {fund}" help text, success line, "Also removed with it" list, example reason hints, two guide subsections): **accept after review.** Tone is plain and warm, money wording is "Moved"/"Deleted", never "Reversed"/"Voided", no second-approver language, no acknowledgment promise, no Foundation-to-Club path. The one gap is not a copy defect but a missing paragraph: see the Foundation-case note below.
7. Dialog not `ConfirmDialog`; denied destinations listed as text: **accept**; sanctioned by the architect (select plus textarea needs a `Dialog`), v1 never shows more than one.

## Treasurer-facing notes: release-notes draft check

The draft lives at "Release-notes draft" in the Phase 3 section above (no `docs/release-notes/vX.Y.md` or version bump exists yet; `package.json` is still 1.85.0). Check against what you asked me to confirm:

| Required note | In the draft? | Where / what to change |
|---|---|---|
| The move is one-way | **Yes** | "A move cannot be undone. Money in the Activity Fund leaves only through a minuted sweep. If you move the wrong entry, delete and re-enter it (or reopen its reconciliation session first if it was reconciled)." Guide says the same. |
| Allowed only Administrative to Activity income | **Yes** | "This version moves income from Administrative to Activity only." Change "Expense moves are planned" to "Expense moves may follow"; B-96 is a backlog item, not a commitment. |
| Cannot be used for the Foundation-deposit case, with what to do instead | **No** | Missing from the draft **and** from the guide. Add the paragraph below to the release notes (Good to know), and the same to the Treasury guide. |
| Reconciled and prior-year moves need the admin tier | **Partly** | The draft says "need the Manage Ledger permission" but never says who holds it. Say "(held by the Admin role)" so the treasurer, if he ever lacks it, knows to ask an admin. Do not call it a second approver (the draft and guide already avoid this). |

Proposed replacement text, for `/release-notes` at ship time (and for the guide's "Moving an entry to another fund" subsection):

> - **Move does not fix a gift recorded on the Foundation's books when the money is in the Club's bank account.** Move only works inside one entity (Administrative to Activity) and never changes a bank account, so a Foundation entry has no Move button. If the money was actually deposited in the Club's account: delete the Foundation entry (it asks for a reason, and the deletion is refused if a receipt was already sent to the donor, in which case record a refund entry on the Foundation's books instead), enter the gift as Activity Fund income on the Club's account, then record the sweep to the Foundation once the money has actually been moved. Write down the donor, check number and memo first; the new entry has to be typed in again, and the Foundation side of a sweep does not generate an acknowledgment letter. If the money is in the Foundation's own account there is nothing to move, and whether a gift belongs to the Club or the Foundation is a board question, not a ledger correction.
> - Moving an entry that is already reconciled, or dated in an earlier fiscal year, needs the Manage Ledger permission (held by the Admin role by default). Reconciliation is not affected.

## Edge Cases

- Empty state: **pass.** Recent corrections empty state is `bg-gray-50 rounded-2xl p-10 text-center text-gray-500` "No corrections in the last 90 days."; load failure renders its own card instead of failing the compliance page; Move is omitted (not a dead control) on rows with no legal destination, so Foundation and Activity registers carry no clutter.
- Failure microcopy: **pass.** 500 is "Could not move this entry. Nothing was changed."; stale is "This entry changed while you were looking at it. Refresh and try again."; preview load error is an inline card with retry and Confirm disabled; delete 409 shows the donor-receipt sentence inline and keeps the dialog open; a stale tab's DELETE with no body gets "A reason is required. Refresh the page and try again."
- Permission gate: **pass.** Every verb gates in the route body; row-derived tier; live-verified for record-only, manage, member and anonymous callers; compliance reader behind the page's own `hasAnyFeature` check; `?sweepFrom=` requires `canRecord` and is ignored otherwise; no redirect or `callbackUrl` parameter introduced. Adversarial pass: direction bypass, state-machine shortcuts (approved/rejected/pending/transfer/dues via GET and POST identical), stale/double-submit, input boundaries (extra key, missing key, whitespace-only reason, bad uuid), and enumeration (404 for non-uuid and missing alike) all addressed. Self-targeting: no role or permission changes.
- Mobile (360px): **pass, with the B-next-B note.** Both dialogs and the corrections cards fit with no horizontal overflow (section 312/312, page 360/360 per QA); reason field scrolls into view; 16px text on phones; 44px targets on actions.
- Brand: **pass.** `rounded-2xl` cards, `rounded-lg` buttons, destructive red only on Delete confirm, the single `rounded-full` is a status chip (allowed), no `rounded-xl`, no native dialogs, no `console.log`.
- Email / OAuth-vs-password / Google Group sync / durable-claim: **not applicable.** No email, no `sentAt`, `financial_report_sends` read-only; no auth-path dependence; no group membership touched.

## Follow-Ups (SHIP WITH NOTES)

**Pre-push condition (not a backlog item): release-notes text.** When `/release-notes` writes the entry, apply the four rows of the table above, especially the Foundation-case paragraph. Also tell the treasurer directly, because this is the case he asked about: Move is not what fixes it; the delete, re-enter, sweep path does, and a sent receipt now blocks the delete. The guide paragraph should ride the same push; if the orchestrator would rather keep the release code-frozen, route the guide sentence to ux-developer as a 6-line edit to `books-register-section.tsx` before `/pre-push`.

Proposed backlog wording (orchestrator assigns IDs; B-97 is the highest today):

- **B-next-A — Guide and register pointer for "recorded on the Foundation's books, cash in the Club's account."** Add the Foundation-case paragraph above to the Treasury guide ("Moving an entry to another fund" and "Deleting an entry"), and consider a one-line pointer in the Delete dialog on Foundation income rows ("If this gift's money is in the Club's bank account, delete it here, re-enter it as Activity Fund income on the Club's account, and record the sweep"). Also add a sentence to B-96's cross-entity item: the unsafe case is cash in the *Foundation's* account; cash in the *Club's* account has a documented delete, re-enter, sweep path. Why: it is the requester's own case and the Foundation register offers no explanation (Phase 3 D1). Small.
- **B-next-B — Make lock next steps visible on phones, and add the bank-account help text.** (a) Show `LOCK_COPY[kind].nextStep` as wrapped visible text at every width, not `hidden sm:inline` plus a `title` on a disabled button (touch devices do not reliably surface it); the Move-disabled message already does this. (b) Add the Phase 1 Flow 3 help text to the edit form's bank-account field: "Pick the account the money actually went into. If it went into one account and was later moved to another, record a Transfer instead of editing this." Copy only.
- **B-next-C — "Moved from Administrative" marker (and optional History) in the register.** Phase 1 Flow 1 step 8 promised the Activity register would show the moved gift with a note; only the compliance page shows it today. Needs a batched lookup on `ix_ledger_audit_log_transaction` for the rows on the page; a moved row later deleted detaches (FK is `ON DELETE SET NULL`), which is acceptable. Suggestion-grade, not a defect.
- **B-next-D — Sent-statement warning covers only the row's own month.** The One-Month column buckets reconciled rows by bank-cleared date and the Twelve-Month column by `txnDate`, so a move or delete can change a sent statement for a different month (the bank-clear month, or any later month whose twelve-month window includes the entry). The "Resend Corrected Statement" panel is read-side and still flips correctly, so nothing drifts silently; only the up-front warning under-reports. Either widen `findSentStatementMonth()` to "any successful send whose window includes this entry" or soften the sentence to "statements already sent that include this entry will read as changed." Low.
- **B-next-E — Amend B-92: the legacy reconcile toggle writes no audit row.** The un-toggle-then-move sequence (a record-only user clears a legacy mark, then moves at the `record` tier) leaves a move audit row showing `reconciled: false` and `tier: record`, so the bypass is invisible in Recent corrections. B-92's decision (retire the toggle, lock legacy-reconciled rows, or at least audit the toggle) should cover this explicitly; the lock-or-retire choice stays B-92's.
- **B-next-F — Amend B-96: two properties the expense cell will bring.** (1) Enabling Activity to Administrative expense moves **can un-gate a month** (an unreconciled Administrative expense row gates; the same row in Activity does not, per T20), so the dialog and release note must say so then; v1 income moves cannot (uncleared deposits never gate, DECISION-059). (2) When the cross-entity item is designed, run the direction policy before the bank-account assertion so a cross-entity request returns 403 `cross_entity` with the policy reason instead of 409 `bank_account_entity_mismatch`.
- **B-next-G — Sweep prefill memo date.** The prefilled memo says "moved from Administrative on <date>" using the UTC date of the page load (`nowIso.slice(0, 10)`), which can read as tomorrow after about 8 pm Eastern, and it says "moved" even if a hand-built `sweepFrom` link names a row that was never moved. Use the move's audit date (or drop the date). Very low; the treasurer edits the memo anyway.
- **B-next-H (optional, architect call) — DOM component-test harness.** The dialogs' state machines (stay open on a failed delete, refresh only on Done) are asserted through pure helpers and source checks. A jsdom plus testing-library setup would be a dependency decision; only worth it if more dialog-heavy features follow.

No code, `docs/decisions.md` or `docs/backlog.md` was edited by this phase.

## Red Flags (if NEEDS REWORK)

None. Nothing has to change in the code before this ships; the one condition is the release-notes text above.

### Summary

QA's PASS holds up under my own review: I re-read the policy, lock classifier, queries, move route, DELETE/PATCH/reconcile/POST diffs, the register, compliance and sweep-prefill wiring, the dialogs and guide copy, and re-ran `tsc` (clean) and `pnpm test` (2683 passed). Every REQUIRED architect ruling (R2c, R3b, R5 writer and reader, R6 hardening) and Phase 1 Gaps 1, 2, 4, 7, 8 are delivered or deliberately deferred to a filed backlog item. The feature ships as designed; the single substantive miss is that the treasurer's own case (Foundation-books entry, cash in the Club's account) is handled by the pre-existing delete, re-enter, sweep path and is explained nowhere, and the hardened delete now blocks that path if a receipt was already sent.

### What I did

- Read Phases 1-5 in full, DECISION-109/110/111 and backlog B-92 to B-97 text, and diffed `git diff HEAD` for the files you named.
- Re-ran the typecheck and the full Vitest suite; spot-checked brand, native dialogs and `console.log` on the new files.
- Verified the T20 claim against `isMonthGatedForEntity()` and `isUnclearedDepositRow()`; verified the sent-statement lookup scope against the One-Month (bank-cleared) and Twelve-Month (txnDate) bucketing.
- Walked the Phase 1 gap list, the architect rulings R1-R8 and the QA observations against the shipped behavior; ruled on every deviation.
- Checked the release-notes draft against your four required notes.

### Outputs

- `docs/work-log/2026-10-01-move-or-cancel-transaction.md` (this section; status table updated; Phase 1-5 text untouched)
- No other file edited.

### Open questions / handoff notes

- **For the orchestrator:** tell the treasurer plainly that Move does not fix his gift; the delete, re-enter, sweep path does, and a sent receipt blocks the delete. Confirm with him whether a receipt was already sent for it.
- **For tech-lead at ship time:** apply the release-notes table above; bump to the next minor via `/release-notes`; `docs/decisions.md` (DECISION-109/110/111), `docs/backlog.md` (B-92 to B-97) and this work-log are uncommitted and must ship with this feature. `CLAUDE.md` is also modified (a new "Ledger corrections (Move / Delete)" paragraph, accurate against what shipped, including "a move never un-gates a reconciled month" and the Foundation-deposit case) and ships with this feature; it says "before v1.86", so confirm that is the version `/release-notes` actually assigns (`package.json` is 1.85.0) or reword it.
- **For you to assign:** B-next-A through B-next-H above. A and B are the ones I would not leave long.

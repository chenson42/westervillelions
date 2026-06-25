# The Ledger — Increment 2: Controls — Work Log

> **Slug:** `2026-06-24-ledger-controls`
> **Surface:** (dashboard) admin — `/admin/ledger`
> **Permission(s):** new `ledger.approve` (admin/board_member). Existing `ledger.view`/`ledger.record`/`ledger.manage` unchanged.
> **Estimated complexity:** large (second increment)
> **Pipeline mode:** Full

---

## Context

This is **increment 2 of 6** of The Ledger. Increment 1 ("Books") shipped as **v1.20.0** (record/edit/delete transactions incl. two-row transfers, budgets, Budget/Actual/Variance reports, 6 inc1 guardrails, editable opening balances). The full design is in `docs/features/the-ledger-accounting.md`; inc1 work-log `docs/work-log/2026-06-24-ledger-books.md`; DECISIONs 015/016/017. Read those first.

Increment 1 deliberately put the **approval/reconcile fields on `ledger_transactions`** (`status` default 'posted', `approvedByUserId`, `approvedAt`, `reconciled`, `reconciledAt`) but left them unused, and the API delete/edit handlers already contain an inactive `if (txn.approvedAt) return 403` lock. Increment 2 activates all of it. No schema change should be needed beyond possibly a receipts/attachment decision.

**Increment 2 — "Controls" — scope:**
1. **Approvals workflow.** Disbursements (expenses) over the board threshold (`ledger_settings.disbApprovalThresholdCents`, $250 default) are created with `status='pending'` instead of `'posted'`; a board member approves them (sets `status='posted'`, `approvedByUserId`, `approvedAt`, and a `boardMinute` reference). Pending disbursements are **excluded from posted fund balances**. An **Approvals** screen lists what's pending. Income/small expenses post directly. (Per the transparency doc: the board authorizes all disbursements; may pre-authorize fixed expenses below a limit.)
2. **New `ledger.approve` permission** (admin + board_member). Board members were read-only in inc1; they now gain approve (but NOT record). Treasurers record but cannot approve their own disbursements — segregation of duties.
3. **Immutability lock.** Approved transactions (`approvedAt IS NOT NULL`) become non-editable/non-deletable — activate the existing 403 guard.
4. **Two-fund firewall guardrail (HIGH).** Activate the deferred firewall check: flag any Activity→Admin flow — transfer pairs (join `transferGroupId` where source fund kind=`activity`, dest kind=`administrative`), and the policy's stricter cases (no percentage allocation even if stated; interest on activity money must stay in activity). Verbatim policy cite.
5. **Reconciliation.** A treasurer marks transactions reconciled against the monthly bank statement (`reconciled`/`reconciledAt`); activate the **unreconciled** guardrail and the **unapproved-disbursements-over-threshold** guardrail (both deferred in inc1).
6. **Inc1 follow-ups:** FU-1 (BudgetEditor `0`-vs-remove nil handling), FU-2 (benign dead-code `!report` guard), FU-3 (expose `beneficiaryCause` in the transaction form; decide whether **receipt upload** (`receiptUrl`) lands here — needs a file-storage approach — or defers to a later increment).

**Explicitly deferred (do NOT build here):** compliance filings calendar + `determine990` UI + standing rules (inc3); reports/990-prep export (inc4); member philanthropy dashboard (inc5); donors/acknowledgments + dues/Zeffy auto-post (inc6).

## Scope addition — Expense Reimbursement (user-added 2026-06-24, mid-Phase-1)

A reimbursement is a board-approved disbursement to a member who paid out of pocket. Confirmed by user:
- **Submission = member self-service.** Any signed-in member submits their own reimbursement request from the **member portal** (amount, what-for, fund/cause, **receipt upload**). Adds a member-portal surface + an admin request inbox.
- **Receipt + board approval required.** Every reimbursement needs an attached receipt AND board approval before the treasurer marks it paid — so **receipt file upload lands in this increment** (file-storage approach is an architect decision; this overrides the base-Phase-1 "defer file upload / paste-URL" note, which still applies to ordinary transactions).
- **Lifecycle:** submitted → approved | rejected (with reason) → paid. Marking paid posts an `expense` transaction to the chosen fund (party = the member). Reimbursements always require board approval regardless of `disbApprovalThresholdCents`.
- **Permissions:** submitting requires only a signed-in member with a linked member record (no ledger feature); the admin inbox/approve uses `ledger.approve`; marking paid uses `ledger.record`. Self-approval blocked (a member cannot approve their own reimbursement).

## Base Phase 1 decisions — resolved defaults (accepted unless the user objects)

Accepting the analyst's recommendations for the six base-Controls questions: (1) transfers post directly, no approval; (2) rejected disbursements get `status='rejected'` + `rejectionReason` (paper trail); (3) `boardMinute` **required** on approval; (4) **self-approval blocked** server-side (single-admin clubs raise `disbApprovalThresholdCents` so routine expenses post directly); (5) firewall fires on transfer pairs only, the "no % allocation / interest stays in activity" rules are advisory policy copy; (6) reconciliation = per-row toggle + "mark all displayed reconciled". Plus the binding catch: `getOverview()`/`getFundReport()` must filter to `status='posted'` and surface pending as a separate "encumbered" figure.

## Reimbursement decisions — resolved (user-confirmed 2026-06-24)

- **R-1:** member can **edit/withdraw while `submitted`** (pending); locked once the board acts.
- **R-2:** after rejection, member opens a **new request**; the rejected row persists as read-only history (with reason).
- **R-3:** **treasurer/board assigns the fund.** The member describes the expense (+ optional cause) but does NOT pick Admin/Activity/Charitable — the officer assigns it at review/pay time (firewall/classification stays with officers). The member submission form has NO fund picker.
- **R-4:** member can view/download **their own** receipt → receipts use **access-controlled (private) storage**, never public URLs.
- **R-5:** **email notifications in scope** (existing Resend + `email_queue`): notify the member on approve/reject/paid; notify the board (ADMIN/ledger.approve holders) on a new submission.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-06-24 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-06-24 |
| 3 — Technical design | tech-lead | complete | Design complete | 2026-06-25 |
| 4 — Implementation | database-admin (4a done); api-developer (4b done); ux-developer (4c done) | complete | — | 2026-06-25 |
| 5 — Verification | qa | complete | PASS | 2026-06-25 |
| 6 — Shipped vs intent | analyst | complete | SHIP WITH NOTES | 2026-06-25 |
| 5 FU — FU-5/FU-6 resolution | qa | complete | PASS (re-verified) | 2026-06-25 |

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-06-24

**Owner:** analyst
**Status:** complete

### Summary

The "Controls" increment activates the three mechanisms inc1 laid down as schema columns but left dormant: the approval workflow (pending → posted), the immutability lock (approvedAt guard), and reconciliation. It also adds the two deferred guardrails (firewall and unapproved disbursements), a new `ledger.approve` permission for board members, and segregation-of-duties enforcement. The feature is well-bounded by the inc1 foundation — no schema changes should be required beyond one open question about receipt attachments. The scope is precise enough to advance, but six decisions must be resolved before Phase 3 starts, because they shape the transaction lifecycle state machine, the approval API surface, and the balance semantics that every downstream query depends on.

**Verdict: READY WITH NOTES**

**One-line take:** A tightly-scoped activation of the approval/reconcile plumbing inc1 already laid down, advancing cleanly once six decisions are locked — especially self-approval policy, the rejected-disbursement lifecycle, and whether receipt upload lands here or defers again.

---

### What I did

#### Pass 1 — User Verbs

All surfaces are admin-portal-only. No public-visitor, member-portal, or access-pending surface is involved.

**Treasurer (ledger.record):**
- Records a new expense; if the amount exceeds `disbApprovalThresholdCents`, the transaction is saved with `status='pending'` rather than `'posted'` — the user sees a "pending approval" indicator rather than an immediate balance update
- Records income or a small expense (below threshold) as before — still posts directly
- Records a transfer — transfer status TBD (see Gap 1)
- Views the Approvals screen to see their own pending disbursements (read-only on this screen)
- Marks a posted transaction reconciled on the fund ledger (toggles `reconciled` flag)
- Marks a batch of transactions reconciled against a bank statement
- Views the entity overview and sees the two newly-active guardrails: unapproved-disbursements WARN and unreconciled WARN, alongside the existing inc1 checks

**Board member (ledger.view + ledger.approve):**
- Lands on the Approvals screen and sees all pending disbursements across both entities
- Opens a pending disbursement to review the detail (amount, fund, category, party, memo, who recorded it)
- Approves a pending disbursement: enters a board-minute reference, confirms — transaction flips to `status='posted'`, `approvedByUserId` and `approvedAt` are set
- Rejects / sends back a pending disbursement: enters a reason — outcome TBD (see Gap 2)
- Views the entity overview (existing read) and now sees the firewall guardrail active
- Cannot record, edit, or delete transactions (no `ledger.record`)

**Admin (ledger.manage + ledger.record + ledger.approve):**
- All of the above across all surfaces
- Approves or rejects pending disbursements (same flow as board member)
- Edits/deletes a transaction only if it is not yet approved (inc2 activates the 403 guard that was already in the code)

**Surface note:** The Approvals screen is new in inc2. Its URL (`/admin/ledger/approvals` or a tab on the overview) must be decided in Phase 3. Both board members and admins land on it.

---

#### Pass 2 — Flow Audit

**Flow A: Record an over-threshold disbursement → pending**

Entry: Treasurer or admin clicks "Record transaction," selects `flow='expense'`, enters amount above `disbApprovalThresholdCents`.

Steps:
1. Transaction form renders as in inc1 (no UX change on entry).
2. User fills and submits.
3. Server checks: is `flow='expense'` AND `amountCents > disbApprovalThresholdCents`? If yes, inserts with `status='pending'`. If no (income, transfer, or expense below threshold), inserts with `status='posted'` as before.
4. Success path: form closes; a toast informs the user "Disbursement submitted — awaiting board approval." The transaction appears in the fund ledger with a "Pending" badge; it does NOT affect the posted fund balance.
5. Failure (validation): same as inc1 — inline errors.
6. Failure (server): toast error; form stays open.

Gap: Is the "pending" determination made server-side only, or does the client also hide/show a confirmation warning before submit? The transparency doc says the board must authorize disbursements, so a client-side pre-check ("This amount requires board approval — do you want to proceed?") may be appropriate UX. This is a Phase 3 UX decision, flagged here as a note.

**Flow B: Board member approves a pending disbursement**

Entry: Board member navigates to the Approvals screen (`/admin/ledger/approvals` or equivalent).

Steps:
1. Page renders a list of pending disbursements: date, fund, category, amount, party, memo, recorded-by.
2. Board member clicks "Approve."
3. A dialog (not window.confirm) opens asking for a board-minute reference (text field, required or optional — see Gap 3).
4. Board member enters reference, confirms.
5. Client POSTs to `POST /api/admin/ledger/transactions/[id]/approve` with `{ boardMinute: string }`.
6. Server: checks `LEDGER_APPROVE`, fetches the transaction, confirms it is still `status='pending'`, sets `status='posted'`, `approvedByUserId=session.user.id`, `approvedAt=now()`, `boardMinute=body.boardMinute`.
7. Approvals list refreshes; the approved transaction disappears from the pending list.
8. Posted fund balance and guardrail counts update.

Success: Board member sees the item removed from the pending list; a success toast confirms.
Failure (already approved by another approver between view and submit): server returns 409 "Transaction is no longer pending." Board member sees a toast error.
Failure (transaction was deleted before approval — e.g., treasurer retracted it): server returns 404.
Failure (server down): toast error; no state change.

Gap: The self-approval rule (see Gap 4) must be enforced server-side, not just in the UI. The server action must check whether `session.user.id === txn.recordedByUserId` before allowing the approve.

**Flow C: Reject / send back a pending disbursement**

Entry: Board member or admin on the Approvals screen.

Steps:
1. Board member clicks "Reject" on a pending item.
2. A ConfirmDialog opens asking for a rejection reason (text field, required or optional — see Gap 2).
3. Board member confirms.
4. Client POSTs to a reject endpoint or the approve endpoint with `{ action: 'reject', reason: string }`.
5. Server: sets `status='rejected'` OR deletes the row — lifecycle decision required (see Gap 2).

Success outcome is highly dependent on the Gap 2 decision. This flow cannot be fully specified until that decision is made.

**Flow D: Treasurer views pending / reconciliation state**

Entry: Treasurer opens the fund ledger.

Steps:
1. Ledger list shows all transactions for the fund × FY, including pending ones.
2. Pending rows are visually distinguished (badge, muted amount, no effect on the running balance shown).
3. Treasurer can see "Posted balance: $X | Pending outflows: $Y | If approved: $X−Y" — or a simpler variant. Phase 3 must specify the exact balance display.
4. Treasurer can toggle `reconciled` on any posted transaction row (a checkbox or reconcile button).

Success: Reconciled rows display a check/reconciled indicator; the unreconciled guardrail count decrements on overview reload.
Failure: Toast error on reconcile toggle failure.

**Flow E: Reconcile a batch**

Entry: Treasurer clicks "Reconcile" or opens a reconciliation surface.

Steps:
1. Treasurer sees a list of unreconciled posted transactions for the selected fund × month.
2. Treasurer checks off transactions that appear on the bank statement.
3. Treasurer submits; server batch-updates `reconciled=true`, `reconciledAt=now()` for the selected rows.

Gap: The reconciliation granularity decision (see Gap 6) determines whether this is a per-row toggle in the existing ledger list or a separate reconciliation surface. Phase 3 must decide.

**Flow F: Firewall guardrail fires on the overview**

Entry: Any `ledger.view` holder opens the entity overview.

Steps:
1. The `guardrails()` function now includes the firewall check.
2. If any transfer pair has `sourceFund.kind='activity'` and `destFund.kind='administrative'`, a HIGH flag appears: "Two-fund firewall violation — activity fund money cannot be transferred to the administrative fund."
3. Additionally, if any income transaction has `fundId` pointing to an administrative fund and its category or party suggests an activity-fund source (this is the "stricter cases" the spec references), a warning may fire.

Gap: The "stricter cases" (no percentage allocation, interest must stay in activity) are policy-level rules. Whether they are mechanically detectable from the current data model in inc2 or are advisory copy is a decision (see Gap 5).

**Flow G: Overview shows newly-active guardrails**

Entry: Any `ledger.view` holder opens the entity overview.

Steps:
1. Overview now shows: all 6 inc1 guardrails + the 2 newly-activated ones:
   - Unapproved disbursements WARN: count of `status='pending'` rows with `amountCents > disbApprovalThresholdCents`
   - Unreconciled WARN: count of posted transactions where `reconciled=false` and `txnDate` is more than N days ago (threshold TBD — see Gap 7)

---

#### Pass 3 — Permissions

**New key in inc2:**

| Constant | String key | Roles | Gates |
|---|---|---|---|
| `FEATURES.LEDGER_APPROVE` | `ledger.approve` | admin, board_member | Approve-pending endpoint; reject endpoint; Approvals screen (read+action) |

This is the only new key. The `LEDGER_APPROVE` key was explicitly deferred from inc1; inc2 adds it.

The `add-permission` skill must be used for the migration (idempotent DO-block, role bindings for admin and board_member).

**Role matrix after inc2:**

| Role | ledger.view | ledger.record | ledger.approve | ledger.manage |
|---|---|---|---|---|
| admin | Y | Y | Y | Y |
| treasurer | Y | Y | N | N |
| board_member | Y | N | Y | N |
| member | N | N | N | N |

The treasurer does NOT get `ledger.approve`. The board member does NOT get `ledger.record`. This is the segregation-of-duties boundary: the person who records cannot approve (except for admin, who can do both — see Gap 4 on self-approval).

**Segregation of duties for admin role:** The admin has both `ledger.record` AND `ledger.approve`. This creates a self-approval risk. See Gap 4.

**FEATURE_CATEGORIES.LEDGER already added in inc1** — no change needed to the category list.

---

#### Pass 4 — Edge Cases the Request Didn't Mention

**Balance semantics on the Overview and Fund Report.** The inc1 `fundBalanceCents()` helper and `getOverview()` both sum all transactions without any `status` filter. In inc2, pending disbursements must be excluded from the posted balance. The query in `getOverview` passes `allTxns` (no status filter) to `fundBalanceCents()`. This must change: only `status='posted'` rows should be summed for the "posted balance." Pending rows should contribute to a separate "pending outflows" figure. This is a change to `ledger-queries.ts` — specifically `getOverview()` and `getFundReport()`. The tech-lead must spec the exact query change.

**`fundBalanceCents()` helper in `ledger.ts` does not filter by status** — it receives whatever `postedTxns` the caller passes. The fix is in the caller (`getOverview` and `getFundReport`), not in the helper. The helper name `postedTxns` already signals the intent; the callers just need to filter to `status='posted'` before passing.

**The Fund Report ending balance.** In `getFundReport()`, the `endingCents` is computed as `openingCents + totalIncomeCents - totalExpenseCents`. In inc2 with pending disbursements, this calculation must also filter to `status='posted'` rows only. The "if approved" projected balance can optionally be shown separately but must not be the primary displayed balance.

**The Approvals screen needs a `getPendingApprovals()` query.** This was stubbed in the spec (§6) but not implemented in inc1. The inc2 api-developer must implement this query — it fetches all transactions where `status='pending'` across all entities, ordered by `txnDate desc`. Gated on `LEDGER_APPROVE`.

**Email notification for pending approval.** When a disbursement is saved as `status='pending'`, should the board members be notified by email? The spec does not mention this. Given the club's small size (one treasurer, a handful of board members), an email on each pending disbursement is operationally sensible. This must be a Phase 3 decision: notify or not, and if so, which users (all `ledger.approve` holders? a configured notify list?). Flag as a gap.

**Pending state and transfer pairs.** If a transfer is created over the threshold — should both rows be pending, or neither? Transfers don't have a single "direction" in the two-row model (one is income, one is expense). See Gap 1.

**Reconciliation and approved state.** Can a treasurer mark a pending transaction as reconciled? Almost certainly not — you can only reconcile what is on the bank statement, and a pending disbursement has not cleared the bank. The server action for `reconcile` should check `status='posted'` before allowing the toggle.

**OAuth vs password path.** Both paths produce the same `session.user.id`; `approvedByUserId` is set server-side from the session. No issue.

**Empty Approvals screen.** When no pending disbursements exist, the Approvals screen should say something like "No pending disbursements — all expenditures are approved" with the club's current `disbApprovalThresholdCents` displayed for context, not just a blank table.

**Mobile.** The Approvals list is a table. At 360px it must be scrollable horizontally or reflow to a card-list pattern. Phase 3 must specify.

**Brand consistency.** The "Approve" action is positive (not destructive) — it should use a primary button (`rounded-lg`, `bg-lions-blue`). The "Reject" or "Send back" action is destructive — it must go through `<ConfirmDialog destructive>`. No `window.confirm`.

---

#### Pass 5 — Adversarial Pass

**Self-approval bypass.** A treasurer with an admin role (or who is also a board member — could happen in a small club) can record a disbursement and then approve it themselves. The server-side `POST /transactions/[id]/approve` handler must check `session.user.id !== txn.recordedByUserId`. If equal, return 403 "You cannot approve a disbursement you recorded." This is a segregation-of-duties control and must be enforced server-side, not just in the UI. The analyst recommends this as mandatory; it is Gap 4 because the user (club leadership) must confirm the policy before it is built.

**Status spoofing on POST /transactions.** In inc1, the POST handler hard-codes `status: 'posted'` regardless of client input. In inc2, the server must decide whether to set `status='pending'` based on server-side logic (amount + threshold + flow), never from client-supplied `status`. A client that passes `status: 'posted'` for an over-threshold expense must be ignored. The decision logic must live entirely on the server.

**Approve endpoint with wrong ID.** A board member who submits an approval for a transaction that belongs to a different entity (not their "scope" — though in this app all `ledger.approve` holders see all entities) cannot escalate privileges. The approve handler must still validate the transaction exists and is `status='pending'`; a 404 or 409 is appropriate if not.

**Replay attack on approval.** A board member approves a transaction; a second board member or an attacker replays the same approve request. The server must return 409 "Transaction is no longer pending" if `status` is already `'posted'`. This is idempotency protection, not just a race condition.

**Reconcile a pending transaction.** A treasurer manually calls `POST /transactions/[id]/reconcile` on a pending row. The server must reject this with 400 "Only posted transactions can be reconciled" — you cannot reconcile what has not cleared the bank.

**boardMinute injection.** The `boardMinute` field is a free-text string stored in the database. It should be sanitized (trimmed, max length enforced) server-side. No HTML/script injection risk since it is rendered as text, but a reasonable max length (e.g., 500 characters) prevents abuse.

**Enumeration of pending approvals.** The `GET /approvals` (or whatever endpoint backs the Approvals screen) must be gated on `LEDGER_APPROVE`. A treasurer without that key must not see other entities' pending items. In this codebase all `ledger.approve` holders see all entities — that is by design — but a non-permissioned user hitting the approvals API directly must get 403, not a list of pending items.

---

### Outputs

**Verdict: READY WITH NOTES**

**Gaps requiring resolution before Phase 3:**

1. **Transfer threshold: do transfers require approval?** The transparency doc says "the board authorizes all disbursements." A transfer from one fund to another moves money but is not strictly a "disbursement" to a vendor or payee. Three options: (a) transfers always post directly (current inc1 behavior); (b) transfers over threshold go pending like expenses; (c) transfers to the administrative fund always go pending (firewall-adjacent). The context block says "Disbursements (expenses) over the board threshold" — this implies transfers are excluded. Recommend: confirm that only `flow='expense'` rows trigger the pending path, and transfers always post directly, since the firewall guardrail already flags prohibited Activity→Admin transfers separately. **Needs user confirmation.**

2. **Reject / send-back lifecycle — what happens to a rejected pending disbursement?** Two options: (a) `status='rejected'` is added as a third lifecycle state, the row persists with a rejection reason, and the treasurer can view it (useful audit trail); (b) the board reject-action deletes the row (simpler; the treasurer re-records after fixing). Option (a) requires one schema change (adding `'rejected'` to the status check constraint and a `rejectionReason text` column). Option (b) needs no schema change but loses the rejection context. Recommend (a): a club treasurer wants to know WHY something was rejected, not just that it disappeared. **User decision required before Phase 3.**

3. **boardMinute reference — required or optional on approval?** The transparency doc says the board authorizes disbursements; a board-minute reference ties the approval to a recorded meeting action. Making it required ensures the paper trail. Making it optional is more practical for informal board confirmations. Recommend: required, with a placeholder hint ("e.g., Motion passed May 2026 meeting"). **Needs user confirmation.**

4. **Self-approval: can an admin (who has both ledger.record and ledger.approve) approve their own disbursement?** In a two-person club officer setup this may be the only practical path. But as an internal control it is weak — a single person recording and approving the same transaction undermines the segregation. Recommend: block self-approval at the server level (`recordedByUserId !== session.user.id` enforced in the approve handler). If the club genuinely needs a single person to do both for small disbursements, use the `disbApprovalThresholdCents` setting to set the threshold high enough that everyday expenses post directly and only large ones require a second set of eyes. **This is a product policy decision — user must confirm before the server logic is written.**

5. **Firewall "stricter cases" — mechanically detectable or advisory copy only?** The spec says the firewall should flag "no percentage allocation even if stated" and "interest on activity money posted to admin." The two-row transfer join can detect any Activity→Admin transfer pair. But a "percentage allocation" (e.g., a treasurer manually records 20% of a Rudolph Run income as Admin fund income) is indistinguishable from a legitimate Admin income transaction at the data level — the category and fund are correct, only the *source* is suspect. Similarly, interest income posted to Admin when it was earned on activity money is not detectable from the transaction row alone. Recommend: for inc2, the firewall guardrail fires only on transfer pairs (detectable from `transferGroupId` join). The "stricter cases" are surfaced as a policy-advisory static note on the overview page, not as a computed guardrail. **Confirm with user — this limits what the guardrail catches but avoids false positives.**

6. **Reconciliation granularity: per-row toggle in the ledger list, or a dedicated reconciliation surface?** A per-row toggle is simpler (no new page, no new URL), but a batch "reconcile to statement" flow (where the treasurer enters a statement balance and the app helps identify which transactions clear) is more useful for a club treasurer. For inc2, recommend the simpler per-row toggle on the ledger list, with a "Reconcile all displayed" convenience button — a full "statement balance" reconciliation flow can ship in a future increment. **Confirm scope with user.**

7. **Unreconciled guardrail threshold: how old must a transaction be before it triggers the WARN?** An unreconciled transaction from yesterday is normal; an unreconciled transaction from 45 days ago is a problem. Options: (a) any unreconciled posted transaction from the prior full month triggers the WARN; (b) any unreconciled posted transaction older than N days (e.g., 60) triggers WARN. Recommend (a): "any posted transaction dated before the first of the current month and not yet reconciled" is a clean monthly cadence that matches bank statement timing. **Needs user confirmation or a sensible default locked in Phase 3.**

8. **Receipt upload (FU-3) — in scope for inc2 or deferred again?** The inc1 follow-up FU-3 asks whether `receiptUrl` capture (file upload) lands in inc2. This requires a file-storage decision (the spec §10.5 deferred this). Uploading a file to `public/uploads` works locally but is not durable in a serverless Vercel deploy. The durable options are Vercel Blob, Cloudflare R2, or S3. This is an architectural decision. **Recommend: defer receipt upload to inc3 or a standalone "attachments" sub-increment. Expose the `receiptUrl` text field in the transaction form (so a URL can be pasted), but do not build file-upload UX in inc2.** If the user wants file upload in inc2, that unlocks an architectural decision that should go through Phase 2 before Phase 3 starts.

**Out of scope (confirmed by context block):**
- Compliance filings calendar, `determine990` UI, standing rules (inc3)
- Reports / 990-prep export (inc4)
- Member philanthropy / impact dashboard (inc5)
- Donors / acknowledgments / dues auto-post / Zeffy auto-post (inc6)
- Settings management UI for `ledger_settings` (deferred; settings are currently seed-managed — the treasurer cannot change `disbApprovalThresholdCents` through a UI yet; this should ship with inc2 or inc3 so the threshold is configurable without a migration)

**Note on settings UI:** The `disbApprovalThresholdCents` threshold is used in the inc2 approval workflow. If it is not editable from the admin UI, the club is stuck with the $250 default unless a developer changes the migration seed. The context block does not list a settings-management UI in inc2 scope, but the analyst flags this as a practical gap: the treasurer should be able to configure the approval threshold. This is not a blocker for inc2 (the $250 default is reasonable) but it should appear as a Phase 3 note.

**Open questions / handoff notes for Phase 2 and Phase 3:**

- Gaps 1–7 above must each receive a yes/no/decision from the user or be locked in Phase 3 design. Gaps 2 and 4 (reject lifecycle and self-approval policy) are the most consequential — they shape the state machine and the approve API surface.
- Gap 8 (receipt upload) is an architectural gate — if it is in scope, the architect must evaluate file-storage options before Phase 3 starts.
- The `listTransactions()` and `getOverview()` queries in `ledger-queries.ts` both currently fetch all transactions without a `status` filter. In inc2, balance computations must filter to `status='posted'`. The tech-lead must call this out as a binding constraint in Phase 3.
- `getPendingApprovals()` query (spec §6) was not implemented in inc1 — it must be added in inc2. The api-developer owns this.
- The `guardrails()` function in `ledger.ts` has three TODO comments for inc2 checks. The tech-lead must specify the exact input signature additions needed (e.g., `pendingDisbursements: number` count, `unreconciledTransactions: number` count, and a way to pass the transfer-pair join result for the firewall check).
- Email notification on pending disbursement creation is not in scope per the context block but is a genuine usability gap. Flag it for Phase 3 as a "should we add this?" decision point.
- The Approvals screen URL and navigation entry (tab on overview vs. separate sidebar entry vs. badge on the existing Ledger sidebar link) must be decided in Phase 3.

---

### Files read (no code written)
- `docs/work-log/2026-06-24-ledger-controls.md` (this file — context block)
- `docs/work-log/2026-06-24-ledger-books.md` (inc1 full pipeline)
- `docs/features/the-ledger-accounting.md` (full spec, §7 rules engine)
- `docs/decisions.md` (DECISION-015/016/017)
- `src/lib/ledger.ts` (guardrails, fundBalanceCents — inc1 state confirmed)
- `src/lib/ledger-queries.ts` (getOverview, getFundReport, listTransactions — no status filter currently)
- `src/app/api/admin/ledger/transactions/route.ts` (POST — status hard-coded 'posted' in inc1)
- `src/app/api/admin/ledger/transactions/[id]/route.ts` (PATCH/DELETE — approvedAt guard exists but fires on null in inc1)
- `src/lib/permissions.ts` (LEDGER_APPROVE not yet added — confirmed)

---

## Phase 1 — Reimbursement Addendum — 2026-06-24

**Owner:** analyst
**Status:** complete

### Summary

The reimbursement sub-feature adds a member self-service submission surface (`/members/reimbursements`) and an admin inbox (`/admin/ledger/reimbursements`) to the Controls increment. It is a new lifecycle distinct from a regular `ledger_transaction`: a `ledger_reimbursements` row lives in a submitted/approved/rejected/paid state, and only becomes a posted expense transaction when the treasurer marks it paid. The feature is clean enough to advance, but five decisions must be locked before Phase 3 — particularly who assigns the fund (member vs. treasurer), whether a member may edit or withdraw a submitted request, and the resubmit-after-rejection policy.

**Verdict: READY WITH NOTES**

**One-line take:** A well-scoped member-portal self-service surface backed by a new pending-reimbursement table, ready to design once five policy decisions are confirmed.

---

### What I did

#### Pass 1 — User Verbs

**Signed-in member (member portal — `/members/reimbursements`; requires `session.user.memberId`):**
- Clicks "Request Reimbursement" and opens the submission form
- Fills in: amount, description/what-for, fund (or cause), receipt attachment (required)
- Submits the request — sees it appear in their "My Reimbursements" list with status "Pending"
- Views the list of their own requests (status, amount, date, description)
- Opens a request detail to see the current status, any rejection reason, and (once paid) the date paid
- Edits a submitted (pending, not-yet-reviewed) request — decision required (see Gap R-1)
- Withdraws / cancels a submitted (pending) request — decision required (see Gap R-1)
- Re-reads a rejection reason if the request was rejected
- Resubmits or opens a new request after rejection — decision required (see Gap R-2)

**Board member / admin with `ledger.approve` (admin portal — `/admin/ledger/reimbursements`):**
- Views the admin inbox: all pending reimbursement requests across all members, with amount, date, requester, description, fund/cause
- Opens a request detail — views the receipt attachment, description, and requester identity
- Approves a request: enters a board-minute reference (aligned with base-Controls Gap 3 decision: required), confirms — request moves to "Approved" status; submitting member is notified (optional, see Gap R-5)
- Rejects a request: enters a rejection reason (required), confirms via ConfirmDialog — request moves to "Rejected" status; submitting member is notified (optional, see Gap R-5)
- Cannot self-approve (see Permissions pass — server-side guard required)

**Treasurer / admin with `ledger.record` (admin portal — same inbox or a separate "Approved" tab):**
- Views the list of approved (not yet paid) reimbursement requests
- Opens a request detail — reviews receipt, description, amount, fund/cause assignment
- Assigns or confirms the fund (if fund assignment belongs to the treasurer — see Gap R-3)
- Marks paid: selects payment method (cash/check/other), enters date, optionally enters a note — this triggers posting an `expense` transaction to `ledger_transactions` with `party = member name`, `fundId = assigned fund`, and links back to the reimbursement row
- Cannot mark as paid until status is "Approved" (server-side guard)
- Cannot mark an already-paid request as paid again (idempotency guard)

---

#### Pass 2 — Flow Audit

**Flow R-A: Member submits a reimbursement request**

Entry: Member portal `/members/reimbursements` — clicks "Request Reimbursement."

Steps:
1. Submission form renders: amount (dollars, required), description/what-for (text, required), fund/cause (if member-assigned — see Gap R-3), receipt upload (required).
2. Member fills in fields and attaches receipt file.
3. Client-side validation: amount > 0, description non-empty, receipt attached.
4. On submit, POST to server action: creates a `ledger_reimbursements` row with `status='submitted'`, `submittedByUserId`, `submittedByMemberId`, `amountCents`, `description`, `fundId`/`causeId` (if member-assigned), `receiptUrl` (from file storage upload), `submittedAt=now()`.
5. Success: form closes, request appears in the member's list with status badge "Pending Board Review." Member sees a brief confirmation: "Your request has been submitted and is awaiting board review."
6. Failure — no receipt attached: client-side error before submit; server-side also validates `receiptUrl` is not null and returns 400 if missing.
7. Failure — no `memberId` on session: member sees the same "Account Not Linked" empty state as the dues page — cannot access the form at all (page guards on `session.user.memberId`).
8. Failure — amount zero or negative: inline validation error "Amount must be greater than $0."
9. Failure — server error: toast error "Could not submit your request. Please try again." Form stays open with data intact.

**Flow R-B: Board member reviews and approves a request**

Entry: `/admin/ledger/reimbursements` — the admin inbox lists all requests with `status='submitted'`.

Steps:
1. Board member opens a request row — sees a detail panel: requester name, amount, description, fund/cause, receipt (viewable inline or download link), submitted date.
2. Board member clicks "Approve."
3. A non-destructive dialog (not ConfirmDialog) opens asking for board-minute reference (required per base-Controls Gap 3 decision).
4. Board member enters reference, confirms.
5. Server action: checks `LEDGER_APPROVE`, confirms request is still `status='submitted'`, checks `session.user.memberId !== request.submittedByMemberId` (self-approval guard), sets `status='approved'`, `reviewedByUserId`, `reviewedAt`, `boardMinute`.
6. Success: request disappears from the "Pending" tab; moves to "Approved" tab. Optional email to member (see Gap R-5).
7. Failure — request already reviewed (race): 409 "This request has already been reviewed." Board member sees a toast; the inbox refreshes.
8. Failure — self-approval attempt: 403 "You cannot approve your own reimbursement request." (Applicable only if the member is also a board member — see Permissions pass.)

**Flow R-C: Board member rejects a request**

Entry: Same admin inbox.

Steps:
1. Board member clicks "Reject" on a pending request.
2. `<ConfirmDialog destructive>` opens with a required "Reason for rejection" text field.
3. Board member enters reason, confirms.
4. Server action: checks `LEDGER_APPROVE`, self-approval guard, confirms `status='submitted'`, sets `status='rejected'`, `reviewedByUserId`, `reviewedAt`, `rejectionReason`.
5. Request moves to "Rejected" tab; the member's portal view shows "Rejected" status with the reason visible.
6. Failure paths same as Flow R-B.

**Flow R-D: Treasurer marks an approved request paid**

Entry: Admin inbox "Approved" tab, or a dedicated "Ready to Pay" view.

Steps:
1. Treasurer sees a list of requests with `status='approved'`.
2. Treasurer opens a request and clicks "Mark Paid."
3. A dialog (not window.confirm) prompts: payment date (defaults today), payment method (cash/check/other), optional note.
4. Treasurer confirms.
5. Server action: checks `LEDGER_RECORD`, confirms `status='approved'` (not already paid), creates a `ledger_transactions` row: `flow='expense'`, `amountCents`, `fundId` (from the reimbursement — or assigned here if fund was treasurer-assigned; see Gap R-3), `partyName = member full name`, `memo = description`, `status='posted'` (reimbursements bypass the threshold because board already approved; must be hardcoded server-side, not derived from `disbApprovalThresholdCents`), `approvedByUserId = reimbursement.reviewedByUserId`, `approvedAt = reimbursement.reviewedAt`, `boardMinute = reimbursement.boardMinute`. Updates reimbursement to `status='paid'`, `paidAt=now()`, `ledgerTransactionId=<new txn id>`.
6. Success: request shows "Paid" status; the linked transaction appears in the fund ledger. Optional email to member (see Gap R-5).
7. Failure — double-pay attempt: server checks `status='approved'` and returns 409 "This reimbursement has already been marked paid."
8. Failure — `fundId` unresolvable (no fund assigned yet): 400 "A fund must be assigned before this request can be paid." (Applicable only if fund is treasurer-assigned — see Gap R-3.)

**Flow R-E: Member views own reimbursement history**

Entry: `/members/reimbursements` — a read-only list page.

Steps:
1. Page loads the member's own requests ordered by `submittedAt desc`.
2. Each row shows: date submitted, amount, description, status badge, and (for rejected) a "View reason" expander.
3. No action buttons visible on approved/paid rows.
4. Edit/withdraw buttons visible on submitted rows only — if edit/withdraw is in scope (see Gap R-1).

Empty state: "You have not submitted any reimbursement requests." with a "Request a Reimbursement" button.

---

#### Pass 3 — Permissions

**Submitting a request:** No new feature key required. The member portal `GET/POST /members/reimbursements` is gated by `session?.user?.memberId` — any signed-in member with a linked member record can submit. No `FEATURES.*` key needed. This matches the dues self-view pattern in `src/app/members/dues/page.tsx`.

**Admin inbox — viewing:** Requires `FEATURES.LEDGER_VIEW` to see the reimbursement inbox (read-only). Already held by admin, treasurer, board_member.

**Admin inbox — approve/reject:** Requires `FEATURES.LEDGER_APPROVE` (new in inc2, confirmed scope). Held by admin and board_member.

**Mark paid / post expense:** Requires `FEATURES.LEDGER_RECORD`. Held by admin and treasurer.

**Self-approval guard:** A board member who also has a linked member record and submitted the request cannot approve it. Server action checks `session.user.memberId !== request.submittedByMemberId` (or `session.user.id !== request.submittedByUserId`). Must be server-side — not enforced at the UI level alone.

**Ownership guard on the member portal:** `GET /members/reimbursements` and its API back-end must filter to `submittedByMemberId = session.user.memberId` — a member never sees another member's requests, even by guessing an ID.

No additional `FEATURES.*` keys are needed for this sub-feature. The existing `LEDGER_VIEW`, `LEDGER_APPROVE`, and `LEDGER_RECORD` cover the admin surfaces; the member portal surfaces are gated by session ownership.

---

#### Pass 4 — Edge Cases the Request Didn't Mention

**No memberId — unlinked user.** A signed-in user with no `memberId` cannot submit a reimbursement. The member portal page at `/members/reimbursements` must render the same "Account Not Linked" empty state used by the dues page — not a crash or a blank page. The user should be told to contact an administrator.

**Double-submit guard.** A member who double-clicks or reloads after submit could create duplicate requests. The server action should return a meaningful error if an identical amount + description + date combination exists as `status='submitted'` for that member within the last 60 seconds. Alternatively, disable the submit button client-side on first click (standard form pattern). Both together are safest.

**Receipt file validation.** The request says receipt upload is required. The server must validate:
- File is present (not null/empty)
- File is a supported type (PDF, JPEG, PNG at minimum)
- File size is bounded (e.g., max 10 MB)
If the file-storage approach is Vercel Blob or similar, the upload step likely happens before the form POST (the client gets a blob URL, then posts the URL). The server must confirm the URL is a valid same-origin blob URL, not an arbitrary external URL.

**Receipt storage — not picked here.** The confirmed scope says receipt upload is in scope for this increment; the storage technology is the architect's call in Phase 2. This addendum records the functional requirement only: a `receiptUrl` (or similar) column on `ledger_reimbursements` that points to the stored file, readable by admins and the submitting member only (not publicly accessible). The architect must evaluate access-control implications of the chosen storage provider.

**Fund/cause on the posted transaction.** When the treasurer marks paid, the `ledger_transactions` row needs a valid `fundId`. If the member assigned it during submission, it must still be verified to exist at pay time (funds can be archived). If the treasurer assigns it at pay time, the pay-dialog must include a fund picker. This is Gap R-3 — flag, do not assume.

**Reimbursements bypass the approval threshold.** A regular expense over `disbApprovalThresholdCents` auto-pends. A reimbursement that has already been board-approved must post directly as `status='posted'` when the treasurer marks it paid, regardless of the threshold. The server action for "mark paid" must hard-code `status='posted'` and copy the `approvedByUserId`/`approvedAt`/`boardMinute` from the reimbursement row — not run the threshold check that applies to ordinary disbursements.

**Two-fund firewall.** A reimbursement is an expense. The same firewall logic that flags Activity→Admin expense flows applies here. The "mark paid" server action should invoke the same firewall check as a regular expense POST. If the assigned fund is administrative and the description/cause suggests an activity-fund purpose, the existing guardrail would fire on the overview — that is correct behavior, not a bug.

**Reconciliation.** The posted `ledger_transactions` row created by "mark paid" is subject to the same reconciliation flow as any other transaction. No special handling needed.

**Email queue.** Three notification moments exist (submitted, approved/rejected, paid). None are mentioned as required in the confirmed decisions. Flag as optional in Gap R-5. If added, each must go through `sendEmail()` in `src/lib/email.ts` — no direct SMTP calls.

**Mobile — member submission form.** At 360px the form must be usable. A file upload input on mobile uses the native file picker (camera roll or files) — that is acceptable. The description textarea and amount input must not require horizontal scrolling.

**Empty admin inbox.** When no requests are pending, the admin inbox should say "No pending reimbursement requests" — not a blank table.

**OAuth vs password path.** The `session.user.memberId` field is set the same way regardless of sign-in method. No issue.

---

#### Pass 5 — Adversarial Pass

**Member viewing another member's request.** A signed-in member could guess a reimbursement UUID and call `GET /api/members/reimbursements/[id]` directly. The server must filter by `submittedByMemberId = session.user.memberId` on every read. Returning a 404 (not 403) for a request that exists but belongs to someone else is acceptable — it does not leak existence.

**Member escalating to approve/reject.** A member without `ledger.approve` cannot hit the approve/reject server action. The action must check `hasFeature(session.user.features, FEATURES.LEDGER_APPROVE)` before proceeding, regardless of client-side gating.

**Self-approval via admin role.** An admin who is also a member and submits a request has both `ledger.approve` and a `memberId`. The server-side self-approval guard (`session.user.memberId !== request.submittedByMemberId`) is mandatory. This is the same segregation-of-duties principle as the base-Controls self-approval gap, extended to reimbursements.

**Receipt URL spoofing.** If the client uploads a file and receives a blob URL before submitting the form, a malicious user could substitute an arbitrary external URL for the blob URL in the POST body. The server must validate the `receiptUrl` is either null (rejected server-side) or a URL from the project's own storage provider domain (validated against an allowlist or prefix check). It must not store arbitrary external URLs without validation.

**Mark-paid replay.** A treasurer submits "mark paid" twice (network retry or double-click). The server must check `status='approved'` and not `status='paid'` before proceeding — returning 409 on a second attempt. The idempotency guard from Flow R-D is mandatory, not optional.

**Amount manipulation.** The member submits an `amountCents` value of −1 or 0 or an impossibly large number. The server action must validate: `amountCents > 0` and `amountCents <= 999_999_99` (or a reasonable ceiling — e.g., $10,000, i.e., 1_000_000 cents). Client-side validation is supplementary only.

**Description injection.** The `description` field is stored as text and rendered as text (not HTML) in the admin UI. No XSS risk in the rendering layer, but the server must enforce a max length (e.g., 1000 characters) to prevent storage abuse.

**Fund picker at pay time — IDOR.** If the treasurer provides a `fundId` at pay time, the server must verify the fund belongs to one of the ledger entities the session user has access to — not an arbitrary UUID from another club's installation. In this single-club codebase that is low risk, but the fund existence check (already a pattern in the base ledger) covers it.

---

### Outputs

**Verdict: READY WITH NOTES**

**Gaps requiring resolution before Phase 3 (reimbursement-specific):**

**R-1 — Edit/withdraw policy.** Can a member edit the amount, description, or receipt on a submitted-but-not-yet-reviewed request? Can they withdraw it entirely? Options: (a) Yes to both — edit and withdraw are allowed while `status='submitted'`; locked once reviewed. (b) No edit — withdraw only. (c) Neither — once submitted, the member must contact an administrator. Option (a) is the most user-friendly and operationally safe (no admin overhead for corrections). Option (c) is the safest for record integrity. Recommend option (a): allow edit and withdraw while `status='submitted'`; lock the row on first admin action. **User decision required.**

**R-2 — Resubmit-after-rejection policy.** After a rejection, can the member open a new request (independent submission)? Or is there a "resubmit" flow that links the new request to the rejected one? Options: (a) Member opens a brand-new request (simplest — no special flow, old rejected row stays in history). (b) A "Resubmit" button on a rejected request pre-populates a new form, creating a new row (slightly better UX, same data model). Option (a) is recommended for simplicity; option (b) is a UX enhancement with no schema difference. The key question is: is a rejected request dead, or can it be re-opened in-place? Recommend: dead (new request for resubmission) — keeps the state machine clean. **Confirm with user.**

**R-3 — Who assigns the fund: member at submission or treasurer at pay time?** This is the highest-stakes decision. A member likely does not know whether their expense belongs to the "Activity Fund" or the "Administrative Fund." If the member picks wrong, the treasurer has to fix it before paying. Options: (a) Member picks the fund at submission (from a dropdown of available funds). (b) Member picks a cause/purpose only (no fund); the treasurer/board assigns the fund when approving or paying. (c) Member picks a predefined "purpose category" (e.g., "Program supplies," "Meeting expense") that maps to a fund — the mapping is hidden from the member. Recommend option (b): the member describes what they spent money on; the board assigns the correct fund at approval or the treasurer at pay time. This prevents accidental misclassification and respects that fund assignment is a financial-controls decision. **This is the most consequential design decision for this sub-feature — user must confirm before the form is designed.**

**R-4 — Does the receipt need to be viewable by the submitting member after submission?** The member uploads the receipt. Can they view/download it later from their own portal? Operationally useful (they may want to confirm what they uploaded), and required for "edit a submitted request" (they would need to replace it). If the storage provider's URLs are not public (correct behavior for financial documents), the member-portal receipt view requires a signed URL or a proxy download route. The architect must address this in Phase 2 once storage is chosen. The analyst flags it here so it is not forgotten. **Does not block Phase 2 start, but must appear in the architect's output.**

**R-5 — Email notifications.** Three moments: (i) member submits → notify `ledger.approve` holders; (ii) board approves/rejects → notify the member; (iii) treasurer marks paid → notify the member. None are mentioned as required. In a small club, (ii) and (iii) are high-value: the member should not have to poll the portal to know their request moved. Recommend: at minimum, (ii) approve/reject notification to the member and (iii) paid notification to the member — both optional but strongly recommended. If in scope, each uses `sendEmail()` via the email queue. **Flag for Phase 3 as a should-we-add-this decision; does not block Phase 2.**

**Out of scope (confirm):**
- Bulk pay (paying multiple reimbursements at once) — the Phase 3 design can add this as a stretch goal; not required for initial increment.
- Reimbursement reporting / export — belongs to inc4 (reports).
- Maximum-amount policy per request — no cap is specified. If the club wants a hard limit (e.g., $500 max without special authorization), that would be a `ledger_settings` field. Flagged as a potential future setting; not in scope for inc2.
- Partial approval (approve $80 of a $100 request) — not in scope; approve or reject in full.

**Open questions / handoff notes for Phase 2 and Phase 3:**

- Gap R-3 (fund assignment) is the most load-bearing decision for the UI design — the member submission form looks very different depending on whether it includes a fund picker. Resolve before the architect designs the component tree.
- Gap R-1 (edit/withdraw) determines whether the member-portal list page needs action buttons and whether the server needs a DELETE/PATCH route for submitted requests.
- Receipt file upload requires a file-storage decision in Phase 2. The analyst's recommendation (from the base Phase 1 Gap 8 note) was to defer plain receipt upload for ordinary transactions, but the confirmed scope for reimbursements overrides that — file upload is required here. The architect must evaluate Vercel Blob, Cloudflare R2, or S3 and make a recommendation before Phase 3.
- The `ledger_reimbursements` table is a new concept. The tech-lead must define it in Phase 3. Functional fields needed: `id`, `submittedByUserId`, `submittedByMemberId`, `amountCents`, `description`, `fundId` (nullable if treasurer-assigned), `causeId` (nullable), `receiptUrl`, `status` (submitted/approved/rejected/paid), `reviewedByUserId` (nullable), `reviewedAt` (nullable), `boardMinute` (nullable), `rejectionReason` (nullable), `paidAt` (nullable), `ledgerTransactionId` (FK to `ledger_transactions`, nullable), `submittedAt`, `updatedAt`.
- The "mark paid" server action must hard-code the posted expense as `status='posted'` (bypassing threshold) and copy approval metadata from the reimbursement row — tech-lead must call this out in Phase 3.
- Navigation: the member portal homepage (currently shows 5 nav cards) should gain a "My Reimbursements" card. The admin ledger navigation should add a "Reimbursements" entry (tab or sidebar link) alongside the existing Approvals screen.

---

# Phase 2 — Architectural Review (architect)

## Phase 2 — Architectural Review — 2026-06-24

**Owner:** architect
**Status:** complete
**Verdict:** Approved with suggestions

### Summary

The Controls + Reimbursement increment is structurally sound. The directory placement, server/client boundary, permission model, and data-layer conventions all fit the existing codebase cleanly. The headline decision — receipt file storage — is resolved: Vercel Blob (`@vercel/blob`) is the correct choice for the project's Vercel deployment, and the access-control model (server-proxy routes, never raw blob URLs returned to the client) is mandated. This is the one new npm dependency and the one new env var. The suggestions below are binding constraints for Phase 3, not blockers.

### What I did

1. Read the full work-log (both Phase 1 passes + context block).
2. Read `docs/features/the-ledger-accounting.md` (full spec, §§4–7, §10).
3. Read DECISION-015, DECISION-016, DECISION-017.
4. Inspected the existing directory tree: `src/app/(dashboard)/admin/ledger/`, `src/app/api/admin/ledger/`, `src/app/members/dues/`, `src/app/api/members/dues/`.
5. Read `src/app/api/admin/ledger/transactions/[id]/route.ts` to confirm the `approvedAt` guard is already wired (it is).
6. Read `src/app/api/admin/upload/route.ts` to confirm the existing file-upload precedent uses `public/uploads` + `writeFile` — ephemeral on Vercel, disqualifying it for financial document retention.
7. Read `src/app/members/dues/page.tsx` to confirm the `session.user.memberId` ownership gate pattern for the member portal.
8. Audited `package.json` for existing dependencies (no `@vercel/blob` present; confirmed new dep).
9. Logged DECISION-018.

---

### Architectural calls

#### 1. Receipt file storage — DECISION-018 (new dependency, new env var)

**Decision: Vercel Blob (`@vercel/blob`), with a server-proxy access model.**

The only file-upload precedent in the codebase is `src/app/api/admin/upload/route.ts`, which writes to `public/uploads` via `writeFile`. That handler is disqualified for financial receipts: Vercel's serverless runtime has no persistent local disk — files written to the filesystem are lost between invocations and on every redeploy. Financial documents with a 7-year retention requirement (spec §7 guardrail 11, `ledger_settings.retentionYears`) cannot use ephemeral storage.

**Vercel Blob wins over the alternatives:**
- **Cloudflare R2 / S3:** Both work, but each requires additional cross-provider credentials (`AWS_ACCESS_KEY_ID` / `R2_*`), a heavier SDK (`@aws-sdk/client-s3` or `@cloudflare/workers-sdk`), and additional IAM surface area. The dependency evaluation criteria require that the option already available in the deploy environment be preferred. Vercel Blob is native to the platform, Apache-2.0, and the `@vercel/blob` package is small.
- **Postgres bytea:** Rejected. Multi-MB blob columns degrade query performance on the shared Neon connection pool and violate the principle that the DB holds structured data only.
- **`public/uploads`:** Rejected. Ephemeral on Vercel; also public by definition (serves from the Next.js static tree), which violates the private-access requirement (R-4).

**Access-control model (mandatory, not optional):**
The blob URL is never returned in JSON to the browser and never embedded in HTML. All receipt reads go through server-side proxy routes that call `auth()` and verify ownership or `LEDGER_VIEW` before redirecting:
- `GET /api/members/reimbursements/[id]/receipt` — checks `session.user.memberId === reimbursement.submittedByMemberId`; returns 404 (not 403) if the ID exists but belongs to another member (prevents existence leaking).
- `GET /api/admin/ledger/reimbursements/[id]/receipt` — checks `hasFeature(LEDGER_VIEW)`.

Upload happens server-side: the member's browser POSTs the file to the upload route handler, which validates the file and calls `put()` on the server, then returns the resulting blob URL to be stored in `receiptUrl`. This is not a direct browser-to-Blob presigned-URL flow, which would require exposing the `BLOB_READ_WRITE_TOKEN` to the client.

**New dependency:** `@vercel/blob` (production).
**New env var:** `BLOB_READ_WRITE_TOKEN` — deployment-engineer must add to Vercel environment variables and `.env.local.example`.

#### 2. Directory placement — Confirmed

The following new directories are approved. They follow the existing patterns exactly.

**Admin surfaces (extend `src/app/(dashboard)/admin/ledger/`):**
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx` — lists all `status='pending'` transactions; gated on `LEDGER_APPROVE`. A separate page (not a tab on the existing overview) is cleaner navigation and gives board members a direct URL they can bookmark. The tech-lead may add a nav badge on the sidebar entry.
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` — admin reimbursement inbox (submitted/approved/paid tabs); gated on `LEDGER_VIEW` to read, `LEDGER_APPROVE` to act, `LEDGER_RECORD` to mark paid.

**Member portal (new, mirrors `src/app/members/dues/`):**
- `src/app/members/reimbursements/page.tsx` — member's own list + submission form; gated by `session.user.memberId` ownership (no `FEATURES.*` key, exactly like dues).
- No subdirectory needed at this stage; a detail panel or modal is sufficient for the submission and history views.

**API routes:**
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts` — `POST`, gate `LEDGER_APPROVE`. Self-approval guard (`session.user.id !== txn.recordedByUserId`) is mandatory server-side.
- `src/app/api/admin/ledger/transactions/[id]/reject/route.ts` — `POST`, gate `LEDGER_APPROVE`. Returns `status='rejected'` + `rejectionReason`. Separate endpoint is cleaner than a discriminated `action` field.
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts` — `POST`, gate `LEDGER_RECORD`. Rejects pending rows (400 "Only posted transactions can be reconciled").
- `src/app/api/admin/ledger/reimbursements/route.ts` — `GET` (inbox list, `LEDGER_VIEW`).
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts` — `GET` (detail), `PATCH` (approve/reject, `LEDGER_APPROVE`), pay action.
- `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts` — `GET` (proxy, `LEDGER_VIEW`).
- `src/app/api/members/reimbursements/route.ts` — `GET` (own list), `POST` (submit); gated by `session.user.memberId`.
- `src/app/api/members/reimbursements/[id]/route.ts` — `GET` (own detail), `PATCH` (edit while submitted), `DELETE` (withdraw while submitted); ownership check.
- `src/app/api/members/reimbursements/[id]/receipt/route.ts` — `GET` (proxy, ownership check).
- `src/app/api/members/reimbursements/upload/route.ts` — `POST` (file upload to Vercel Blob); requires `session.user.memberId`. Returns blob URL to the server action, not to the browser.

#### 3. Data model placement — Confirmed with one call on `receiptUrl`

**`ledger_reimbursements` table:** New table, confirmed. The tech-lead designs the columns in Phase 3; the analyst's field list in Phase 1 (addendum) is the functional input. Key invariants:
- `receiptUrl` is `text NOT NULL` — receipt is required for every reimbursement.
- `fundId` is nullable (R-3 confirmed: treasurer assigns at pay time, member does not pick).
- `status` check constraint: `'submitted' | 'approved' | 'rejected' | 'paid'`.
- `ledgerTransactionId` FK to `ledger_transactions` (nullable until paid).

**`ledger_transactions.receiptUrl` for ordinary transactions (FU-3):** Remains a paste-URL text field (`text nullable`) for now. No file-upload UX is built for ordinary transactions in inc2. The field already exists in the schema per the spec. This is the correct scope boundary: file upload for ordinary receipts belongs to a future "attachments" sub-increment. The existing PATCH handler already accepts `receiptUrl` as a free-text update.

**`ledger_transactions.rejectionReason` column:** A new `rejectionReason text` column is needed on `ledger_transactions` for the base-Controls reject flow (Gap 2, resolved: `status='rejected'` + reason). The database-admin must add this with an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. The `status` check constraint (if one exists) must also include `'rejected'` as a valid value — database-admin must confirm whether a check constraint was written in inc1 and amend it idempotently if so.

#### 4. Email integration — Confirmed

All email notifications use `sendEmail()` from `src/lib/email.ts` and enqueue via `email_queue`. No new email dependency. Confirmed notification points per R-5 (all in scope per the resolved reimbursement decisions):
- Member submits → notify all `LEDGER_APPROVE` holders (query users with that feature, send one email per or a grouped email — tech-lead decides).
- Board approves or rejects → notify the submitting member.
- Treasurer marks paid → notify the submitting member.
- Board member creates over-threshold disbursement pending → optional; flag for Phase 3 as a "should-we-add" decision (not a blocker).

#### 5. Permissions and invariants — All clean

- `ledger.approve` key added via the `add-permission` skill (idempotent DO-block migration); bound to `admin` and `board_member` roles. This is the only new `FEATURES.*` key in inc2.
- Member portal reimbursement surface gated by `session.user.memberId` (ownership), not a `FEATURES.*` key — exactly the dues pattern.
- Admin approval/reject endpoints gate on `LEDGER_APPROVE`; mark-paid gates on `LEDGER_RECORD`.
- Self-approval guard on the approve server action: `session.user.id !== txn.recordedByUserId` (base Controls) and `session.user.memberId !== reimbursement.submittedByMemberId` (reimbursements). Both are mandatory server-side checks; the UI may also hide the button but the server check is the control.
- Status spoofing: the POST `/transactions` handler must derive `status='pending'|'posted'` from server-side logic (amount + threshold + flow), never from client-supplied `status` field. The tech-lead must call this out in Phase 3.
- Reimbursements that are board-approved bypass the `disbApprovalThresholdCents` check when the treasurer marks them paid — the "mark paid" action hard-codes `status='posted'` and copies `approvedByUserId`/`approvedAt`/`boardMinute` from the reimbursement row.
- Migrations: all new DDL must use `IF NOT EXISTS`; seed data uses `INSERT ... WHERE NOT EXISTS` or `ON CONFLICT DO NOTHING`. The `status` check constraint amendment (add `'rejected'`) must be done with a guarded `DO $$ BEGIN ... EXCEPTION WHEN ... END $$` block.
- `<ConfirmDialog destructive>` for reject and withdraw actions. Primary `rounded-lg bg-lions-blue` button for approve. No `window.confirm`.
- All money stored as integer cents. Server Components by default; `'use client'` only for the submission form and any interactive panels.

#### 6. Upload attack surface — Security review flags for Phase 3 + security review

The receipt upload route is new attack surface. The following must be specified by the tech-lead in Phase 3 and audited in the 30-day security review:

- **File-type validation:** Content-Type header is spoofable. The upload handler must inspect the first bytes (magic bytes / file signature) to confirm PDF (`%PDF`), JPEG (`\xFF\xD8\xFF`), or PNG (`\x89PNG`) before writing to Blob. A library like `file-type` (npm) or a hand-rolled magic-byte check is acceptable — the tech-lead decides; if `file-type` is used it needs a dependency evaluation.
- **Size limit:** Max 10 MB enforced server-side before writing to Blob (not just on the client).
- **Path namespacing:** Blob paths must be UUID-namespaced (e.g., `receipts/<uuid>/<original-filename-sanitized>`) so paths are not guessable.
- **Proxy route isolation:** The member proxy route returns 404 (not 403) for IDs belonging to other members — existence must not be leaked. The admin proxy route returns 403 for non-`LEDGER_VIEW` sessions.
- **No raw blob URL in responses:** The upload handler returns the blob URL only to the server action that created the reimbursement row, which stores it in the DB. The URL is never returned in a JSON response that reaches the browser.
- **Blob URL allow-list on PATCH:** If a member can edit a submitted request (R-1 resolved: yes), the PATCH handler for `/api/members/reimbursements/[id]` must validate that any updated `receiptUrl` is a URL from the project's Vercel Blob store domain (prefix check against `BLOB_READ_WRITE_TOKEN`'s store URL), not an arbitrary external URL.
- **Double-submit guard:** Upload + form submit in two steps creates a window for orphaned blobs (file uploaded, form POST fails). The tech-lead should decide whether to accept orphans (infrequent, manual cleanup) or implement a cleanup job (out of scope for inc2).

### Outputs

- `docs/decisions.md` — DECISION-018 logged (Vercel Blob, server-proxy access model, new dependency `@vercel/blob`, new env var `BLOB_READ_WRITE_TOKEN`).
- `docs/work-log/2026-06-24-ledger-controls.md` — Phase 2 section written; Per-Phase Status updated.

### Open questions / handoff notes for Phase 3 (tech-lead)

- **`status` check constraint on `ledger_transactions`:** Confirm whether inc1's migration wrote a check constraint including `'posted'|'pending'`. If so, the database-admin must add `'rejected'` via a guarded idempotent migration before the reject flow can land. Tech-lead must call this out in the design.
- **`rejectionReason` column on `ledger_transactions`:** New `text nullable` column needed. Database-admin owns the migration.
- **Approvals screen URL and nav entry:** Either a new sidebar entry (with a badge count of pending items) or a sub-page under `/admin/ledger/`. The Phase 1 work-log suggests `/admin/ledger/approvals` as a separate page — this review confirms that as the correct placement.
- **`disbApprovalThresholdCents` settings UI:** The threshold is consumed by inc2 but has no UI for the treasurer to change it. The $250 default is acceptable as a shipped default, but the tech-lead should add a "Settings" note in the Phase 3 design flagging this as a near-term follow-up (inc3 or a standalone sub-increment).
- **Email notification for over-threshold pending disbursement on creation:** Not in the confirmed scope per the context block, but operationally valuable. Tech-lead should decide yes/no in Phase 3 and document.
- **Magic-byte file-type check:** Decide in Phase 3 whether to use `file-type` npm package (small, well-maintained, MIT) or a hand-rolled first-bytes check. Either is acceptable; document the decision.
- **`file-type` dependency evaluation (if chosen):** ~50 KB ESM-only package; Node-compatible; MIT. If the tech-lead selects it, log an implementation decision for it. It does not require a new architectural decision entry — it is below the architect threshold (no new top-level directory, no structural change).
- **Implementer:** Given that inc2 spans schema (new table, new column, constraint amendment), new API routes (approve/reject/reconcile/reimbursements/upload/proxy), and new pages (Approvals screen, admin reimbursement inbox, member portal), the tech-lead should split between database-admin (schema + migration), api-developer (route handlers + server actions), and ux-developer (pages + forms). The full-stack-developer is not appropriate here — the scope is too large.
- **`add-permission` skill:** Must be invoked for `ledger.approve` in Phase 4 (database-admin phase). Do not hand-write the migration for the permission row and role bindings.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-06-25

**Owner:** tech-lead
**Status:** complete

### Summary

Increment 2 activates the approval/reconcile/firewall plumbing already scaffolded in inc1, adds the `ledger_reimbursements` table, and introduces the only new feature key (`ledger.approve`). The data-model changes are small but surgical: one new nullable column (`rejectionReason`) on `ledger_transactions`, no status CHECK constraint to amend (inc1 never wrote one — confirmed from `0044_ledger_books.sql`), and the full `ledger_reimbursements` table. The balance-query fix (`getOverview`/`getFundReport` must filter to `status='posted'`) is the highest-risk change because it touches live financial calculations. Everything else is net-new surface. File-type validation for receipt upload uses hand-rolled magic-byte inspection (DECISION-019 below) — no new npm dependency beyond `@vercel/blob` (already approved in DECISION-018).

---

### Permissions

**New key:**

| Constant | String key | Description |
|---|---|---|
| `FEATURES.LEDGER_APPROVE` | `ledger.approve` | Approve and reject pending disbursements and reimbursements |

Add to `FEATURES` in `src/lib/permissions.ts` and `FEATURE_DESCRIPTIONS`. Add to `src/lib/db/schema.ts` — no schema table change needed (features are rows in the `features` table; the constant is just a string literal in the app).

**Role bindings (via `add-permission` skill, idempotent migration):**
- `admin` — yes
- `board_member` — yes
- `treasurer` — NO
- `member` — NO

**Member portal gate:** `session.user.memberId` ownership only (no `FEATURES.*` key) — exactly the dues page pattern.

---

### API Contract

All routes follow the existing codebase pattern: `auth()` → `hasFeature()` → validate → DB → response. No server actions on the admin side (all existing ledger routes are route handlers). The member reimbursement submission may use a server action or route handler — the implementer chooses the approach that matches the member portal's existing pattern (which uses route handlers for dues, see `src/app/api/members/dues/`).

#### Existing routes — modifications

**`POST /api/admin/ledger/transactions`** (in `route.ts`)

Change the normal-transaction path: after all validation passes, derive `status` server-side before inserting.

```
const status =
  flow === 'expense' &&
  amountCents > settings.disbApprovalThresholdCents
    ? 'pending'
    : 'posted';
```

`settings` is loaded via `getSettings()`. Client-supplied `status` field is ignored entirely — strip it from the parsed body. Transfers always insert with `status='posted'` (Phase 1 Gap 1 resolution). Also add `beneficiaryCause` to the form body if not already exposed (FU-3 partial: the field exists in schema and is already accepted by the POST handler; the UX fix belongs to the ux-developer).

Response on pending insert: still `201 { id, derivedFiscalYear }` — let the UI infer from the returned ID whether it is pending (client can re-fetch or the transaction form can show "submitted for approval" based on the amount vs. threshold the user already knows).

**`PATCH /api/admin/ledger/transactions/[id]`** and **`DELETE`** (in `[id]/route.ts`)

The `if (existing.approvedAt)` guard is already present but was a dead letter in inc1 because `approvedAt` was always null. In inc2 it becomes live. Additionally, add a status check: if `existing.status === 'pending'`, a treasurer who created the row may retract it by deleting. The PATCH guard stays as-is (you cannot edit a pending row — must approve or reject first). DELETE on a `status='pending'` row that is NOT yet approved (approvedAt is null) is allowed — this is the treasurer-retract-before-approval path. Existing guard on `approvedAt` covers the immutability case correctly already.

Also add a check: if `existing.status === 'rejected'`, block PATCH and DELETE with 403 "Rejected transactions cannot be edited." This prevents tampering with the rejection record.

#### New routes — approvals/reconcile

**`POST /api/admin/ledger/transactions/[id]/approve/route.ts`**

Gate: `LEDGER_APPROVE`.

Body: `{ boardMinute: string }` (required, trimmed, max 500 chars).

Logic:
1. Fetch transaction. 404 if not found.
2. If `txn.status !== 'pending'` → 409 "Transaction is no longer pending."
3. If `session.user.id === txn.recordedByUserId` → 403 "You cannot approve a transaction you recorded."
4. Update: `status='posted'`, `approvedByUserId=session.user.id`, `approvedAt=now()`, `boardMinute=body.boardMinute.trim()`.
5. Return 200 `{ id }`.

Note: no email notification for over-threshold pending disbursement on creation (email is enqueued at submission time in the POST handler when `status='pending'` — see Email section below). This approve route does not send email; notifications are member-centric.

**`POST /api/admin/ledger/transactions/[id]/reject/route.ts`**

Gate: `LEDGER_APPROVE`.

Body: `{ reason: string }` (required, trimmed, max 1000 chars).

Logic:
1. Fetch transaction. 404 if not found.
2. If `txn.status !== 'pending'` → 409 "Transaction is no longer pending."
3. If `session.user.id === txn.recordedByUserId` → 403 "You cannot reject a transaction you recorded."
4. Update: `status='rejected'`, `rejectionReason=body.reason.trim()`.
5. Return 200 `{ id }`.

**`POST /api/admin/ledger/transactions/[id]/reconcile/route.ts`**

Gate: `LEDGER_RECORD`.

Body: `{ reconciled: boolean }` (toggle — allows un-reconciling as well as reconciling).

Logic:
1. Fetch transaction. 404 if not found.
2. If `txn.status !== 'posted'` → 400 "Only posted transactions can be reconciled."
3. Update: `reconciled=body.reconciled`, `reconciledAt=body.reconciled ? now() : null`.
4. Return 200 `{ id }`.

There is no "mark all reconciled" bulk endpoint for inc2; the "Reconcile all displayed" button on the UI will POST to this endpoint once per visible row (small club, N < 30 per month). A bulk endpoint can be added in a future increment if needed.

#### New routes — reimbursements (admin)

**`GET /api/admin/ledger/reimbursements/route.ts`**

Gate: `LEDGER_VIEW`.

Query params: `status?: 'submitted'|'approved'|'rejected'|'paid'` (optional; omit = all). `memberId?` (optional filter). `limit?`, `offset?`.

Response 200: `{ reimbursements: ReimbursementRow[], total: number }`.

Each row includes: `id`, `amountCents`, `description`, `status`, `submittedAt`, `submittedByMemberId`, `submittedByUserId`, `fundId`, `reviewedByUserId`, `reviewedAt`, `boardMinute`, `rejectionReason`, `paidAt`, `ledgerTransactionId`. No `receiptUrl` in list — accessed via proxy only.

**`GET /api/admin/ledger/reimbursements/[id]/route.ts`**

Gate: `LEDGER_VIEW`.

Response 200: full reimbursement row (same fields as list, plus `description` full text). Still no `receiptUrl`.

**`PATCH /api/admin/ledger/reimbursements/[id]/route.ts`**

Gate: depends on action field.

Body: `{ action: 'approve', boardMinute: string } | { action: 'reject', reason: string } | { action: 'pay', fundId: string, bankAccountId?: string, paymentDate: string, paymentMethod: string, note?: string }`.

Why a single PATCH with `action`? The three operations are mutually exclusive state transitions on the same row; a single PATCH keeps the URL surface minimal. Each action has its own validation and permission check.

- `approve`: requires `LEDGER_APPROVE`. Checks `status === 'submitted'`. Self-approval guard: `session.user.memberId !== row.submittedByMemberId`. Sets `status='approved'`, `reviewedByUserId`, `reviewedAt`, `boardMinute`. Enqueues approval email to submitting member.
- `reject`: requires `LEDGER_APPROVE`. Self-approval guard same. Checks `status === 'submitted'`. Sets `status='rejected'`, `reviewedByUserId`, `reviewedAt`, `rejectionReason`. Enqueues rejection email to submitting member.
- `pay`: requires `LEDGER_RECORD`. Checks `status === 'approved'`. Requires `fundId` (assigned at this point). Validates fund exists and belongs to a known entity. Inserts `ledger_transactions` row: `flow='expense'`, `amountCents`, `fundId`, `entityId` (derived from fund), `txnDate=paymentDate`, `party=<member fullName>`, `memo=reimbursement.description`, `status='posted'` (bypass threshold — board already approved), `approvedByUserId=row.reviewedByUserId`, `approvedAt=row.reviewedAt`, `boardMinute=row.boardMinute`, `recordedByUserId=session.user.id`. Updates reimbursement: `status='paid'`, `paidAt=now()`, `ledgerTransactionId=<new txn id>`, `fundId=body.fundId`. Enqueues paid email to submitting member. All in a DB transaction for atomicity.

Response 200: `{ id }` on success. 409 on race (already reviewed/paid). 403 on self-approve or wrong permission. 400 on validation errors.

**`GET /api/admin/ledger/reimbursements/[id]/receipt/route.ts`**

Gate: `LEDGER_VIEW`.

Logic: Fetch reimbursement. 404 if not found. Call `getReceiptStorage().read(reimbursement.receiptStorageKey)`. 404 if `read` returns null. Return a `Response` with the bytes, `Content-Type: <contentType>`, `Content-Disposition: inline`. Never returns the storage URL or path in JSON — the underlying storage location is never exposed to the browser. Works identically for Vercel Blob and local-filesystem adapters (DECISION-020).

#### New routes — reimbursements (member portal)

**`GET /api/members/reimbursements/route.ts`**

Gate: `session.user.memberId` (not null).

Returns: list of reimbursements where `submittedByMemberId = session.user.memberId`, ordered by `submittedAt desc`. No `receiptUrl` in list.

**`POST /api/members/reimbursements/route.ts`**

Gate: `session.user.memberId`.

Body: `{ amountCents: number, description: string, receiptStorageKey: string }`. No `fundId` (treasurer assigns at pay). Optional `beneficiaryCause`.

Validation: `amountCents > 0` and `amountCents <= 1_000_000` (i.e., $10,000 — reasonable ceiling for a single reimbursement, consistent with Phase 1 addendum adversarial note). `description` non-empty, max 1000 chars. `receiptStorageKey` non-empty; must match the pattern `receipts/<uuid>/<filename>` (format check, not a URL allow-list — DECISION-020 removes the `isBlobUrl` allow-list approach). Description duplicate guard: if the same `submittedByMemberId` has a `status='submitted'` row with identical `description` and `amountCents` within the last 60 seconds, return 409 "Duplicate submission detected."

Inserts `ledger_reimbursements` with `status='submitted'`, `submittedByUserId=session.user.id`, `submittedByMemberId=session.user.memberId`.

After insert, enqueues email to all users holding `LEDGER_APPROVE` (query: `SELECT DISTINCT u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id JOIN role_features rf ON rf.role_id = r.id JOIN features f ON f.id = rf.feature_id WHERE f.name = 'ledger.approve' AND u.is_active = TRUE`).

Response 201: `{ id }`.

**`GET /api/members/reimbursements/[id]/route.ts`**

Gate: ownership (`submittedByMemberId = session.user.memberId`). Return 404 (not 403) for IDs belonging to others.

**`PATCH /api/members/reimbursements/[id]/route.ts`**

Gate: ownership. Allowed only when `status='submitted'`.

Body: `{ amountCents?: number, description?: string, receiptStorageKey?: string, beneficiaryCause?: string }`.

If `receiptStorageKey` is provided, validate it matches the `receipts/<uuid>/<filename>` format (replaces the old `isBlobUrl()` allow-list check — DECISION-020). Old storage key is NOT cleaned up (orphan handling deferred — see Edge Cases).

Returns 403 if `status !== 'submitted'`.

**`DELETE /api/members/reimbursements/[id]/route.ts`**

Gate: ownership. Allowed only when `status='submitted'`.

Returns 200 `{ deleted: 1 }`. Returns 403 if not submitted.

**`GET /api/members/reimbursements/[id]/receipt/route.ts`**

Gate: ownership check (`submittedByMemberId = session.user.memberId`). 404 if not owner (not 403 — prevents existence leaking).

Call `getReceiptStorage().read(reimbursement.receiptStorageKey)`. 404 if `read` returns null. Return bytes with `Content-Type: <contentType>` and `Content-Disposition: inline`. No redirect — storage URL/path is never sent to the browser (DECISION-020).

**`POST /api/members/reimbursements/upload/route.ts`**

Gate: `session.user.memberId`.

Accepts: `multipart/form-data` with a single `file` field.

Logic: validate magic bytes (DECISION-019, unchanged) + size ≤ 10 MB; generate `key = receipts/<uuid>/<sanitized-name>`; call `getReceiptStorage().save(key, bytes, contentType)`. Returns: `{ key: string }` — the opaque storage key. The browser never receives a blob URL or filesystem path. The form populates the hidden `receiptStorageKey` field with this key and includes it in the subsequent POST to `api/members/reimbursements`.

---

### Data Model

#### `ledger_transactions` — delta

**New column:** `rejection_reason text` — nullable. No default. Added with `ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;` (idempotent). No CHECK constraint on `status` was written in inc1 (confirmed from `0044_ledger_books.sql` — no CHECK clause on the `status` column). No constraint amendment needed.

**`schema.ts` addition** to `ledgerTransactions`:
```typescript
rejectionReason: text("rejection_reason"),
// boardMinute: already absent from schema.ts — must add here too
boardMinute: text("board_minute"),
```

Wait — confirming: the `boardMinute` column was referenced in the Phase 1/2 design but was NOT in the inc1 schema (inc1 left it unused). It needs to be added to both the schema and the migration. `ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS board_minute text;` and `ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;`.

#### `ledger_reimbursements` — new table

```
ledger_reimbursements
  id                     uuid PK defaultRandom()
  submitted_by_member_id uuid NOT NULL → members(id) ON DELETE CASCADE
  submitted_by_user_id   uuid NOT NULL → users(id)   ON DELETE SET NULL
  amount_cents           integer NOT NULL              -- validated > 0 at app layer
  description            text NOT NULL                 -- max 1000 chars at app layer
  beneficiary_cause      text                          -- optional cause tag
  receipt_storage_key    text NOT NULL                 -- opaque storage key (DECISION-020); required
  fund_id                uuid                          -- nullable; treasurer assigns at pay
    → ledger_funds(id) ON DELETE SET NULL
  status                 text NOT NULL DEFAULT 'submitted'
    -- app-layer valid values: 'submitted' | 'approved' | 'rejected' | 'paid'
    -- No DB CHECK constraint (consistent with ledger_transactions.status pattern)
  reviewed_by_user_id    uuid → users(id) ON DELETE SET NULL
  reviewed_at            timestamp
  board_minute           text                          -- required on approve
  rejection_reason       text                          -- required on reject
  paid_at                timestamp
  ledger_transaction_id  uuid → ledger_transactions(id) ON DELETE SET NULL
  submitted_at           timestamp NOT NULL DEFAULT now()
  created_at             timestamp NOT NULL DEFAULT now()
  updated_at             timestamp NOT NULL DEFAULT now()

Indexes:
  ix_ledger_reimb_member   ON (submitted_by_member_id)
  ix_ledger_reimb_status   ON (status)
```

**Why no CHECK constraint on status?** `ledger_transactions.status` has no CHECK constraint (inc1 precedent); adding one to reimbursements while transactions lack one creates inconsistency. The app layer enforces valid values. Database-admin may add both at once in a future hardening migration if desired — log this as a note, not a blocker.

**`users.memberId` as the member link:** Confirmed from `src/lib/db/schema.ts` line 12 — `memberId: uuid("member_id").references((): AnyPgColumn => members.id, { onDelete: "set null" })`. The session exposes `session.user.memberId`. Self-approval guard uses `session.user.memberId !== row.submittedByMemberId`.

#### `schema.ts` additions — summary

1. `ledgerTransactions` table: add `boardMinute: text("board_minute")` and `rejectionReason: text("rejection_reason")`.
2. New `ledgerReimbursements` table with all columns above (note: `receiptStorageKey: text("receipt_storage_key").notNull()` — not `receiptUrl`) and two indexes in the table config.
3. Export types: `LedgerReimbursement` / `NewLedgerReimbursement`.

---

### Pluggable Receipt Storage — `src/lib/receipt-storage/` (DECISION-020)

Receipt storage is exposed through a **`ReceiptStorage` interface** rather than direct Vercel Blob calls. This makes the feature fully testable locally with zero configuration (DECISION-020 — refines DECISION-018).

#### Interface shape (`src/lib/receipt-storage/index.ts`)

```typescript
export interface ReceiptStorage {
  save(key: string, bytes: Buffer | Uint8Array, contentType: string): Promise<void>;
  read(key: string): Promise<{ bytes: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function getReceiptStorage(): ReceiptStorage;
```

`getReceiptStorage()` selects the adapter by env at runtime:
- `BLOB_READ_WRITE_TOKEN` is set → **VercelBlobStorage** (`src/lib/receipt-storage/vercel-blob.ts`)
- `BLOB_READ_WRITE_TOKEN` is absent → **LocalReceiptStorage** (`src/lib/receipt-storage/local.ts`)

#### VercelBlobStorage adapter (`src/lib/receipt-storage/vercel-blob.ts`)

Uses a dynamic `import()` of `@vercel/blob` inside the module so local dev never loads the package.

- `save`: calls `put(key, bytes, { access: 'public', contentType, token: process.env.BLOB_READ_WRITE_TOKEN })`. The `key` is already UUID-namespaced by the upload route.
- `read`: fetches the blob bytes server-side (via `fetch` of the blob URL, which is derived from the store) and returns `{ bytes, contentType }`. The blob URL is never forwarded to the browser.
- `delete`: calls `del(key)`.

#### LocalReceiptStorage adapter (`src/lib/receipt-storage/local.ts`)

Writes files under `.receipt-store/<key>` relative to the repo root. `.receipt-store/` is added to `.gitignore`.

- `save`: writes `bytes` to `.receipt-store/<key>` (creating intermediate directories with `mkdir -p` semantics).
- `read`: reads the file and returns `{ bytes, contentType }`. Returns `null` if the file does not exist.
- `delete`: unlinks the file (no-ops if missing).

**This adapter requires no env var and no Vercel account. Local dev works out of the box.**

#### Key generation (upload route)

The upload route generates the storage key:

```
receipts/<crypto.randomUUID()>/<sanitized-filename>
```

where sanitized-filename strips path separators and non-ASCII characters (`/[^a-zA-Z0-9._-]/g` → `_`), max 100 chars.

The key is then passed to `getReceiptStorage().save(key, bytes, contentType)`.

#### Magic-byte validation (DECISION-019, unchanged)

The upload route's pre-storage validation is unchanged. The `uploadReceipt` helper (now inline in the upload route, not in `blob.ts`) inspects the first 8 bytes:

| Format | Magic bytes |
|--------|-------------|
| PDF | `25 50 44 46` (`%PDF`) |
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |

If none match, 400. Size check: `> 10 MB` → 400.

#### `isBlobUrl()` — removed

The original DECISION-018 design stored a Vercel Blob URL in `receipt_url` and used `isBlobUrl()` to validate the URL on PATCH. With the pluggable interface, the column stores an opaque `receipt_storage_key` key (not a URL). The key format check (`must match receipts/<uuid>/<filename>`) replaces the URL allow-list. No `isBlobUrl()` function is needed.

---

### Balance Query Changes — `src/lib/ledger-queries.ts`

**`getOverview(entityId, fiscalYear)`**

The single `allTxns` fetch currently has no `status` filter. Change it to filter `status = 'posted'` only. This is a one-line Drizzle addition: `eq(ledgerTransactions.status, 'posted')` added to the `and(...)` conditions.

Separately, add a `pendingExpenseCents` figure to each `FundSummary` for the "encumbered" display. The pending transactions must be fetched in a second query (or filtered from a broader first fetch). To keep N+1-free:

Option A (recommended): Fetch ALL transactions for the FY regardless of status. Filter `status='posted'` in TypeScript to compute `incomeCents`/`expenseCents`/`endingCents`. Separately compute `pendingExpenseCents` from rows where `status='pending' AND flow='expense'`. One DB query, no extra round-trip.

**Updated `FundSummary` type:**
```typescript
export type FundSummary = {
  fund: LedgerFund;
  openingCents: number;
  incomeCents: number;        // posted only
  expenseCents: number;       // posted only
  endingCents: number;        // posted only
  pendingExpenseCents: number; // encumbered (pending disbursements)
};
```

**Updated `EntityOverview` type:** no change to the shape; the `pendingExpenseCents` lives inside each `FundSummary`.

**`getFundReport(fundId, fiscalYear)`**

Currently fetches all transactions with no status filter. Apply the same approach: fetch all, split in TypeScript. Report lines use posted transactions only. Add `pendingExpenseCents` to the `FundReport` return type as a fund-level summary figure (not broken out by category). Category-level pending is out of scope for inc2.

**Updated `FundReport` type:**
```typescript
export type FundReport = {
  // ... existing fields ...
  pendingExpenseCents: number; // encumbered pending disbursements for this fund
};
```

**`listTransactions(entityId, opts)`**

Add `status?: 'posted' | 'pending' | 'rejected'` to opts. When omitted, returns all statuses (existing behavior — the ledger list should show all transactions including pending and rejected so the treasurer can see them). This is correct: the list is NOT filtered to posted-only. Only the balance computations filter.

**New query: `getPendingApprovals(entityId?: string)`**

```typescript
export async function getPendingApprovals(
  entityId?: string
): Promise<LedgerTransaction[]>
```

Returns all transactions where `status='pending'`, optionally scoped to an entity. Ordered by `txnDate asc` (oldest pending first — most urgently needs attention). Joined or enriched with `entityId`/`fundId` names for display — either via a join or via a second query for fund names (keep N+1-free: single query joining funds table).

**Guardrails additions — `src/lib/ledger.ts`**

Extend `GuardrailsInput`:

```typescript
export type GuardrailsInput = {
  // ...existing fields...
  /** Count of expense transactions with status='pending' (over threshold disbursements) */
  pendingDisbursements: number;
  /** Count of posted transactions where reconciled=false and txnDate < first-of-current-month */
  unreconciledPriorMonth: number;
  /** Transfer pairs where sourceFund.kind='activity' and destFund.kind='administrative' */
  firewallViolations: number;
};
```

Extend `guardrails()` with three new checks (replace the three `// TODO inc2` comment stubs):

```
// Check: unapproved disbursements over threshold (WARN)
if (state.pendingDisbursements > 0) → WARN

// Check: unreconciled transactions from prior months (WARN)
if (state.unreconciledPriorMonth > 0) → WARN (recommend: "X posted transactions dated before [Month Year] are unreconciled. Mark them reconciled after reviewing your bank statement.")

// Check: two-fund firewall violations (HIGH)
if (state.firewallViolations > 0) → HIGH (cite §6 policy)
```

The `getOverview()` caller in `ledger-queries.ts` must compute the three new inputs:

- `pendingDisbursements`: count of rows in the fetched transaction set where `status='pending' && flow='expense'`.
- `unreconciledPriorMonth`: count of rows where `status='posted' && !reconciled && txnDate < firstOfCurrentMonth` (compute `firstOfCurrentMonth` in JS: `new Date(now.getFullYear(), now.getMonth(), 1)` formatted as `YYYY-MM-DD`).
- `firewallViolations`: count of distinct `transferGroupId` values where one row has `sourceFund.kind='activity'` and the paired row has `destFund.kind='administrative'`. To compute this without N+1: after fetching all transactions, filter to rows with `transferGroupId !== null`. Group by `transferGroupId`. For each group, look up both fund's `kind` from the already-fetched `funds` list (funds are loaded in the same overview call). Count groups where one fund is `activity` and the other is `administrative`.

---

### Email Notifications

Four points. All via `sendEmail()` in `src/lib/email.ts`, enqueued in `email_queue`. No new dependencies.

**E-1: Over-threshold pending disbursement created** (YES — included in inc2)

Triggered in `POST /api/admin/ledger/transactions` when `status` is derived as `'pending'`. Notifies all users with `LEDGER_APPROVE` (same query as the reimbursement submission notification). Subject: "Disbursement pending your approval — [amount] on [date]". Body: fund, amount, party, memo, recorded-by name. Decision: include this because the approvals screen has no push mechanism; without email, board members may not know a disbursement is waiting.

**E-2: Reimbursement submitted** (YES)

Triggered in `POST /api/members/reimbursements`. Notifies all `LEDGER_APPROVE` holders. Subject: "New reimbursement request — [member name], [amount]".

**E-3: Reimbursement approved or rejected** (YES)

Triggered in `PATCH /api/admin/ledger/reimbursements/[id]` when `action='approve'` or `action='reject'`. Notifies the submitting member at their `users.email`. Subject: "Your reimbursement request has been [approved/rejected]". Include rejection reason in the rejected email body.

**E-4: Reimbursement paid** (YES)

Triggered in `PATCH /api/admin/ledger/reimbursements/[id]` when `action='pay'`. Notifies the submitting member. Subject: "Your reimbursement request has been paid — [amount]".

All four are best-effort (enqueued, not guaranteed synchronous delivery). If email fails to enqueue, the route still returns success (consistent with existing email pattern in this codebase).

---

### Component and Page Plan

#### Admin pages

**`src/app/(dashboard)/admin/ledger/approvals/page.tsx`** — new

Server Component. `auth()` + `hasFeature(LEDGER_APPROVE)` → redirect to `/admin/ledger` if insufficient. Calls `getPendingApprovals()` (no entity filter — shows all pending across both entities). Renders a table: Date, Entity, Fund, Category, Amount, Party, Memo, Recorded By. Two action buttons per row: "Approve" (primary `rounded-lg bg-lions-blue`) and "Reject" (destructive — opens `<ConfirmDialog destructive>`). Approve opens a Dialog (not ConfirmDialog) with a boardMinute text field. Empty state: "No pending disbursements — all expenditures are approved." with `disbApprovalThresholdCents` shown for context.

Mobile: the table reflows to a card list at `sm` breakpoint (same pattern as the existing member table).

Client component for the action buttons only (wrapped as a `'use client'` sub-component). The page itself is a Server Component that fetches the data.

**`src/app/(dashboard)/admin/ledger/reimbursements/page.tsx`** — new

Server Component. `auth()` + `hasFeature(LEDGER_VIEW)`. Four tabs: Submitted / Approved / Rejected / Paid (using Radix Tabs or a simple client-side tab component consistent with existing admin pages). The "Submitted" tab is the action tab — shows approve/reject buttons (gated on `LEDGER_APPROVE` client-side; server enforces). The "Approved" tab shows "Mark Paid" button (gated on `LEDGER_RECORD`). Receipt access via a "View Receipt" link that hits the proxy route (renders in a new tab). Fund picker on the "Mark Paid" dialog: a `<select>` of active funds for the entity derived from the reimbursement's cause/context (in practice, the treasurer selects the correct fund). Empty states per tab.

**Fund ledger list page (existing `src/app/(dashboard)/admin/ledger/[entity]/[fund]/page.tsx` or similar)**

The api-developer adds a `?status` filter support to `listTransactions`. The ux-developer updates the list UI to:
- Show a "Pending" badge on rows with `status='pending'`.
- Show a "Rejected" badge on rows with `status='rejected'`.
- Show a reconcile toggle (checkbox or icon button) on posted rows. Pending/rejected rows have no reconcile toggle.
- Show running balance only for posted rows (pending rows' amounts are shown but annotated and excluded from the running total).

Navigation: add "Approvals" entry to the ledger sidebar (or the existing overview page nav) with a badge count of `pendingDisbursements` from the overview data. This is a small addition to the existing sidebar component.

**`src/app/(dashboard)/admin/ledger/[entity]/overview/page.tsx` (existing)**

The ux-developer updates the `FundSummary` display to show `pendingExpenseCents` as an "Encumbered" line below the posted balance. The guardrail section already renders `guardrailFlags` — no structural change needed; the three new flags will appear automatically once the guardrails function is updated.

#### Member portal pages

**`src/app/members/reimbursements/page.tsx`** — new

Server Component. `auth()` → redirect to `/signin` if unauthenticated. If `!session.user.memberId` → render "Account Not Linked" empty state (same pattern as dues page — not a crash). Fetches the member's own reimbursements via `GET /api/members/reimbursements`. Renders a list: Date, Amount, Description, Status badge, Rejection reason expander (for `status='rejected'`). Edit/Withdraw buttons on `status='submitted'` rows only.

"Request Reimbursement" button opens a form (client component). The form:
- Amount (number input, > $0 and <= $10,000)
- Description (textarea, max 1000 chars)
- Beneficiary cause (optional text field)
- Receipt file input (`accept=".pdf,.jpg,.jpeg,.png"`, required). On file selection, the client POSTs the file to `/api/members/reimbursements/upload`. While uploading, the button shows a spinner. On success, the returned `{ key }` is stored in React state and sent in the form submission POST as `receiptStorageKey`. The browser never sees a blob URL or filesystem path.

No fund picker (DECISION confirmed: treasurer assigns at pay time).

Edit form: pre-populates with existing values. Receipt input shows "Replace receipt (current receipt on file)."

Withdraw: `<ConfirmDialog>` (not destructive — withdrawal is not permanent data loss, just cancellation). On confirm, DELETE to `/api/members/reimbursements/[id]`.

**Member portal homepage navigation**

Add a "My Reimbursements" card to the member portal homepage (or nav) — consistent with the "My Dues" card. The ux-developer locates and updates the portal nav component.

#### Files to modify

- `src/lib/permissions.ts` — add `LEDGER_APPROVE` constant and description
- `src/lib/db/schema.ts` — add `boardMinute`, `rejectionReason` to `ledgerTransactions`; add `ledgerReimbursements` table
- `src/lib/ledger.ts` — extend `GuardrailsInput` and `guardrails()` with three new checks
- `src/lib/ledger-queries.ts` — update `getFundReport`, `getOverview` for status filtering + encumbered figure; add `getPendingApprovals()`; extend `listTransactions` opts with `status`
- `src/app/api/admin/ledger/transactions/route.ts` — add server-side status derivation
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — add `status='rejected'` immutability guard; document `status='pending'` delete behavior

#### Files to create

- `src/lib/receipt-storage/index.ts` — `ReceiptStorage` interface + `getReceiptStorage()` factory (DECISION-020; replaces `src/lib/blob.ts`)
- `src/lib/receipt-storage/vercel-blob.ts` — VercelBlobStorage adapter (lazy-imports `@vercel/blob`)
- `src/lib/receipt-storage/local.ts` — LocalReceiptStorage adapter (writes to `.receipt-store/`; zero config)
- `.receipt-store/` added to `.gitignore` (database-admin or api-developer adds this line)
- `drizzle/migrations/NNNN_ledger_controls.sql` (next number after 0045 — i.e., `0046_ledger_controls.sql`)
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts`
- `src/app/api/admin/ledger/transactions/[id]/reject/route.ts`
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts`
- `src/app/api/admin/ledger/reimbursements/route.ts`
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts`
- `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`
- `src/app/api/members/reimbursements/route.ts`
- `src/app/api/members/reimbursements/[id]/route.ts`
- `src/app/api/members/reimbursements/[id]/receipt/route.ts`
- `src/app/api/members/reimbursements/upload/route.ts`
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx`
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx`
- `src/app/members/reimbursements/page.tsx`
- Permission migration SQL (via `add-permission` skill output)

---

### Implementation Order

**Step 1 — Schema (database-admin)**

Migration file `0046_ledger_controls.sql`. Idempotent throughout.

1a. Add `board_minute` and `rejection_reason` columns to `ledger_transactions`:
```sql
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS board_minute text;
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS rejection_reason text;
```

1b. Create `ledger_reimbursements` table (`CREATE TABLE IF NOT EXISTS`) with all columns and indexes.

1c. Invoke the `add-permission` skill for `ledger.approve` with role bindings to `admin` and `board_member`. This generates its own migration block or appends to 0046.

Update `src/lib/db/schema.ts` with the new columns and table. Run `pnpm db:migrate` locally to verify.

**Step 2 — Permissions constant (database-admin or api-developer, small change)**

Add `LEDGER_APPROVE: "ledger.approve"` to `FEATURES` in `src/lib/permissions.ts` and its description to `FEATURE_DESCRIPTIONS`. Add to `FEATURE_CATEGORIES.LEDGER` (already exists). This is a TypeScript-only change; no DB query needed (the feature row is created by the migration).

**Step 3 — Core library updates (api-developer)**

3a. `src/lib/receipt-storage/index.ts` + `vercel-blob.ts` + `local.ts` — pluggable receipt storage interface, two adapters, and `getReceiptStorage()` factory (DECISION-020). Add `.receipt-store/` to `.gitignore`.

3b. `src/lib/ledger.ts` — extend `GuardrailsInput` type and `guardrails()` with three new checks.

3c. `src/lib/ledger-queries.ts` — update `getOverview`, `getFundReport` for status filtering; add `pendingExpenseCents` to return types; add `getPendingApprovals()`; add `status` opt to `listTransactions`.

**Step 4 — API routes (api-developer)**

In order (each builds on the schema from Step 1):

4a. Modify `POST /api/admin/ledger/transactions` — server-side status derivation.
4b. Modify `PATCH/DELETE /api/admin/ledger/transactions/[id]` — add `rejected` immutability guard.
4c. New approve/reject/reconcile routes.
4d. New admin reimbursements routes (list, detail, action PATCH, receipt proxy).
4e. New member reimbursements routes (list, create, edit, delete, receipt proxy, upload).

**Step 5 — UI (ux-developer)**

5a. Admin approvals page.
5b. Admin reimbursements page.
5c. Updates to existing ledger list page (pending/rejected badges, reconcile toggle, encumbered balance).
5d. Updates to existing overview page (encumbered figure, nav badge).
5e. Member reimbursements page (list + submission form + receipt upload).
5f. Member portal homepage/nav — add "My Reimbursements" entry.
5g. FU-1: BudgetEditor `0`-vs-remove nil handling — small fix to the existing BudgetEditor component; ux-developer locates and fixes.
5h. FU-2: Dead-code `!report` guard — ux-developer locates and removes.
5i. FU-3 partial: Expose `beneficiaryCause` in the ordinary transaction form (the field exists in schema and the POST handler already accepts it; just add the input to the form).

---

### Edge Cases and Risks

**Double-pay guard:** The `pay` action in `PATCH /api/admin/ledger/reimbursements/[id]` checks `status === 'approved'` before proceeding. A race between two concurrent `pay` requests is handled by checking the status inside a DB transaction: update `WHERE status = 'approved'` and check `rowsAffected === 1`; if 0, return 409. Implementation tip: Drizzle's `.update().where(and(eq(id, ...), eq(status, 'approved'))).returning()` returns an empty array if status has already changed.

**Withdraw-after-approve race:** Member clicks withdraw at the same moment a board member approves. The DELETE handler checks `status === 'submitted'` atomically (same pattern as double-pay above). Loser gets 403 "This request is no longer in submitted status."

**Orphaned blobs:** Member uploads a receipt file (blob is created), then the form POST fails or the user abandons the flow. The blob exists in Vercel Blob storage with no corresponding `ledger_reimbursements` row. Decision: accept orphans in inc2. Cleanup deferred. Note in the upload handler: "Blob orphan cleanup is deferred; consider a periodic cleanup job in inc3 or as a standalone task." The cost is negligible for a small club.

**Self-approval — admin who is also a member:** An admin with `ledger.approve` who also has `memberId` could submit a reimbursement and then try to approve it. The `session.user.memberId !== row.submittedByMemberId` guard in the approve action catches this correctly. If the admin has no `memberId` (not unusual — some admin accounts are not linked to a member record), the guard is `undefined !== row.submittedByMemberId`, which is always true, so the self-approval guard passes. This is correct behavior: an admin without a member link is not the submitter.

**Member with no `memberId`:** The member portal reimbursements page renders an "Account Not Linked" empty state when `session.user.memberId` is null/undefined. No form is shown. All API routes return 403 "Member account required" if `session.user.memberId` is missing.

**`fundId` validation at pay time:** The treasurer provides a `fundId` at pay time. The server must validate: `ledger_funds` row exists, `isActive=true`, and the fund's `entityId` matches a valid ledger entity. If the fund was archived between reimbursement submission and pay, the treasurer must select a different active fund.

**Firewall on reimbursement-funded-from-wrong-fund:** If the treasurer assigns an `administrative` fund to pay a reimbursement that is clearly activity-fund in nature, the two-fund firewall guardrail does NOT fire (because reimbursement-paid transactions have no `transferGroupId` — they are plain expense rows). The existing "income without party" and other guardrails still apply. The firewall in inc2 targets transfer pairs only, which is correct per the Phase 1 Gap 5 resolution (advisory copy for other cases, not computed guardrails).

**`boardMinute` on `ledger_transactions` vs. reimbursements:** The `boardMinute` column is added to `ledger_transactions` to support the approve flow for ordinary pending disbursements. The `ledger_reimbursements` table also has its own `board_minute` column (for the reimbursement approval step). These are independent: a reimbursement approval uses `ledger_reimbursements.board_minute`, and when the reimbursement is paid and a `ledger_transactions` row is created, the transactions row's `boardMinute` is copied from the reimbursement's `boardMinute`. No confusion if the column name is consistent.

**`disbApprovalThresholdCents` settings UI:** The $250 default is reasonable and hardcoded in the seed. There is no UI for a treasurer to change it without a developer running a migration. This is acknowledged as a near-term gap. Flag it: add a "Settings" section to the ledger manage page in inc3 or as a standalone sub-increment. Do NOT add it to inc2 — it would expand scope. Log as FU-4 in the work-log handoff.

**Transfer notification email:** When `POST /api/admin/ledger/transactions` creates a `status='pending'` row, the approval email (E-1) is enqueued. However, transfers always post directly — there is no pending path for transfers. The email notification is only triggered when `status='pending'`, so transfers are never notified. Correct.

---

### Out of Scope

- Settings UI for `disbApprovalThresholdCents` (near-term follow-up FU-4)
- Bulk reconcile endpoint (single-row toggle sufficient for a small club in inc2)
- Blob orphan cleanup job (deferred to inc3 or standalone task)
- Category-level pending expense breakdown in fund report (only fund-level `pendingExpenseCents` in inc2)
- Any compliance/filing/990 changes (inc3)
- Reports or export (inc4)
- Partial approval of reimbursements
- Resubmit-with-linkage flow for rejected reimbursements (new submission is sufficient per Phase 1 decision R-2)

---

### What I did

- Confirmed no CHECK constraint on `ledger_transactions.status` in `0044_ledger_books.sql` — no constraint amendment required.
- Confirmed `boardMinute` is absent from `ledgerTransactions` in `schema.ts` — must be added alongside `rejectionReason`.
- Confirmed `session.user.memberId` is the correct self-approval guard field (from `schema.ts` users table, line 12).
- Confirmed `getOverview()` and `getFundReport()` do not currently filter by status — balance fix is required and specced above.
- Confirmed `guardrails()` has three `// TODO inc2` stubs ready for the new checks.
- Confirmed `LEDGER_APPROVE` is not yet in `permissions.ts`.
- Confirmed no existing `ledger_reimbursements` table.
- Confirmed `sendEmail()` signature and enqueue pattern from `src/lib/email.ts`.
- Authored DECISION-019 (magic-byte file-type validation: hand-rolled, no new npm dependency).
- Specced pluggable receipt storage interface (`src/lib/receipt-storage/`) with VercelBlobStorage (prod) and LocalReceiptStorage (dev/test) adapters; logged DECISION-020 (refines DECISION-018). Replaced `src/lib/blob.ts` design.
- Designed full `ledger_reimbursements` table (column is `receipt_storage_key`, not `receipt_url`).
- Decided the `PATCH /api/admin/ledger/reimbursements/[id]` uses a discriminated `action` field rather than three separate sub-routes (simpler URL surface for a three-state transition on one resource).
- Decided email E-1 (over-threshold pending disbursement notification) is included in inc2.
- Decided `disbApprovalThresholdCents` settings UI is FU-4, deferred.

### Outputs

- `docs/work-log/2026-06-24-ledger-controls.md` — Phase 3 section written + storage design revised (DECISION-020); Per-Phase Status updated
- `docs/decisions.md` — DECISION-019 logged; DECISION-020 logged (pluggable receipt storage, streaming proxy, opaque key column)

### Open questions / handoff notes

- **FU-4 (near-term follow-up):** Settings UI for `disbApprovalThresholdCents` — add to ledger manage page in inc3.
- **database-admin** goes first: `0046_ledger_controls.sql` + `schema.ts` deltas + `add-permission` skill for `ledger.approve` + `permissions.ts` constant addition.
- **api-developer** second: `src/lib/receipt-storage/` (three files — interface + two adapters), `ledger.ts`/`ledger-queries.ts` updates, all route handlers (approve/reject/reconcile, admin/member reimbursement routes, upload route, proxy routes), POST `/transactions` status derivation fix, PATCH/DELETE `[id]` rejected-status guard.
- **ux-developer** third: Admin approvals page, admin reimbursements inbox, existing ledger list updates (pending badge, reconcile toggle, encumbered balance), member reimbursements page + submission form + receipt upload, portal nav card, FU-1/FU-2/FU-3 fixes.
- The ux-developer should confirm the location of the ledger fund list page (likely `src/app/(dashboard)/admin/ledger/[entity]/[fund]/page.tsx` or similar) and the existing sidebar nav component before starting.
- The upload route returns `{ key }` (the opaque storage key) to the browser, NOT a blob URL or filesystem path. The browser passes this key in the form POST; the server stores it in `receipt_storage_key`. Add a code comment explaining why a key rather than a URL is returned (DECISION-020).
- Local dev: with `BLOB_READ_WRITE_TOKEN` absent, `getReceiptStorage()` returns the `LocalReceiptStorage` adapter automatically. Receipts are written to `.receipt-store/` in the repo root. No env var needed. No Vercel account needed. The api-developer must add `.receipt-store/` to `.gitignore` before opening the PR.
- Production: `BLOB_READ_WRITE_TOKEN` must be set in Vercel environment variables (deployment-engineer). When set, `getReceiptStorage()` returns the `VercelBlobStorage` adapter.
- All money validation: `amountCents > 0` and `amountCents <= 1_000_000` (reimbursements ceiling), `amountCents <= INT4_MAX` (ordinary transactions). The reimbursement ceiling ($10,000) is a practical limit, not a schema constraint.

---

# Phase 4 — Implementation

## Phase 4a — Implementation (schema) — 2026-06-25

**Owner:** database-admin
**Status:** complete

### Summary

Added `boardMinute` and `rejectionReason` columns to `ledgerTransactions`, created the `ledgerReimbursements` table with all columns and indexes per the Phase 3 data model, wrote two idempotent migration files (`0046_ledger_controls.sql` and `0047_ledger_approve_permission.sql`), and added `FEATURES.LEDGER_APPROVE` with its description to `src/lib/permissions.ts`. All migrations verified idempotent over two consecutive runs. TypeScript typecheck is clean; 191 tests pass.

### What I did

- Added `boardMinute: text("board_minute")` and `rejectionReason: text("rejection_reason")` to `ledgerTransactions` in `schema.ts`.
- Created `ledgerReimbursements` table in `schema.ts` with all columns from the Phase 3 spec: `submittedByMemberId` (NOT NULL → members, cascade-delete), `submittedByUserId` (NOT NULL → users, set null), `amountCents`, `description`, `beneficiaryCause`, `receiptStorageKey` (NOT NULL — opaque key per DECISION-020, not a URL), `fundId` (nullable → ledger_funds, set null), `status` (NOT NULL, default `'submitted'`, no CHECK constraint — consistent with `ledger_transactions.status` pattern), `reviewedByUserId` (nullable → users, set null), `reviewedAt`, `boardMinute`, `rejectionReason`, `paidAt`, `ledgerTransactionId` (nullable → ledger_transactions, set null), `submittedAt` (NOT NULL, defaultNow), `createdAt`, `updatedAt`. Indexes on `(submittedByMemberId)` and `(status)`.
- Exported `LedgerReimbursement` / `NewLedgerReimbursement` type pair.
- Created `drizzle/migrations/0046_ledger_controls.sql`: two `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for the transaction columns; `CREATE TABLE IF NOT EXISTS ledger_reimbursements` with all columns; two guarded `DO $$ BEGIN IF NOT EXISTS ... END $$` index creation blocks.
- Created `drizzle/migrations/0047_ledger_approve_permission.sql`: `ledger.approve` feature row (`WHERE NOT EXISTS`) + role bindings to `admin` and `board_member` (both `WHERE NOT EXISTS`), following the exact `0045_ledger_permissions.sql` pattern.
- Added `FEATURES.LEDGER_APPROVE = "ledger.approve"` to `FEATURES` in `src/lib/permissions.ts` (inside the `ledger` block). Added matching entry to `FEATURE_DESCRIPTIONS`.

### Outputs

- `src/lib/db/schema.ts` — `ledgerTransactions` delta (2 new columns); new `ledgerReimbursements` table + type exports
- `drizzle/migrations/0046_ledger_controls.sql` — idempotent; confirmed over two runs (NOTICEs only on second pass, no errors)
- `drizzle/migrations/0047_ledger_approve_permission.sql` — idempotent; confirmed over two runs
- `src/lib/permissions.ts` — `LEDGER_APPROVE` constant + description entry
- Local apply command: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate` (already applied; `db:push` is api-developer's gate — not run here per task instructions)

### Deviations from Phase 3 design

None. The two new transaction columns, the `ledgerReimbursements` table shape, the `receiptStorageKey` opaque-key column name (DECISION-020), the absence of a `status` CHECK constraint (per inc1 precedent confirmed in Phase 3), and the `ledger.approve` role bindings (`admin` + `board_member`) all match the Phase 3 spec exactly.

### Open questions / handoff notes

- New tables/columns available to api-developer:
  - `ledger_transactions.board_minute text` — set on approval by the approve route handler
  - `ledger_transactions.rejection_reason text` — set on rejection by the reject route handler
  - `ledger_reimbursements` — full table; all columns listed above
- FKs and relationships:
  - `ledger_reimbursements.submitted_by_member_id → members.id` (CASCADE) — ownership identity for the portal gate
  - `ledger_reimbursements.submitted_by_user_id → users.id` (SET NULL)
  - `ledger_reimbursements.fund_id → ledger_funds.id` (SET NULL — nullable until treasurer assigns at pay)
  - `ledger_reimbursements.reviewed_by_user_id → users.id` (SET NULL)
  - `ledger_reimbursements.ledger_transaction_id → ledger_transactions.id` (SET NULL — null until paid, then links the posted expense row)
- Self-approval guard uses `session.user.memberId !== reimbursement.submittedByMemberId` — confirmed `users.memberId` is the correct field (line 12 of `schema.ts`)
- `FEATURES.LEDGER_APPROVE` is now available in `src/lib/permissions.ts` for use in `hasFeature()` calls in route handlers and page-level guards
- **Next agent:** api-developer — Steps 3 and 4 of the Phase 3 implementation order: `src/lib/receipt-storage/` modules, `ledger.ts`/`ledger-queries.ts` updates, all route handlers

---

## Phase 4b — Implementation (API) — 2026-06-25

**Owner:** api-developer
**Status:** complete

### Summary

Built the full server layer for inc2: pluggable receipt storage (`src/lib/receipt-storage/`), magic-byte validator, activated three deferred guardrails in `ledger.ts`, fixed balance queries in `ledger-queries.ts` to filter posted-only and surface encumbered figures, added all new query helpers, and created 12 new route handlers (approve/reject/reconcile, admin/member reimbursement CRUD, upload, two receipt-proxy routes). Status is derived server-side in `POST /transactions` (client `status` field ignored), self-approval and double-pay guards are enforced in the DB layer. TypeScript typecheck is clean; 217 tests pass (26 new).

### What I did

- Added `@vercel/blob` to dependencies (`pnpm add @vercel/blob`); added `.receipt-store/` to `.gitignore`.
- Created `src/lib/receipt-storage/index.ts` — `ReceiptStorage` interface + `getReceiptStorage()` factory (DECISION-020); selects adapter by `BLOB_READ_WRITE_TOKEN` presence.
- Created `src/lib/receipt-storage/local.ts` — `LocalReceiptStorage`: writes to `.receipt-store/<key>` with path-traversal sanitization; stores content-type in a `.ct` sidecar file.
- Created `src/lib/receipt-storage/vercel-blob.ts` — `VercelBlobStorage`: lazy-imports `@vercel/blob` so the package is never loaded in local dev; `save` uses `put(allowOverwrite: true)`, `read` fetches bytes server-side from the blob URL (never forwarded to browser), `delete` uses `del`.
- Created `src/lib/receipt-magic-bytes.ts` — `validateMagicBytes()`: hand-rolled magic-byte check for PDF (`%PDF`), JPEG (`FF D8 FF` any 4th byte), PNG (full 8-byte signature); returns MIME type or `null` (DECISION-019).
- Created `src/lib/receipt-storage/receipt-storage.test.ts` — 9 `LocalReceiptStorage` tests (save/read/delete round-trip, intermediate dirs, overwrite, missing CT sidecar, path-traversal sanitization) + 8 `validateMagicBytes` tests (accept PDF/JPEG/JPEG-EXIF/PNG; reject GIF, empty, short buffer, spoofed extension).
- Updated `src/lib/ledger.ts` — extended `GuardrailsInput` with 3 new inc2 fields (`pendingDisbursements`, `unreconciledPriorMonth`, `firewallViolations`); updated `guardrails()` JSDoc; replaced the three `// TODO inc2` stubs with real WARN/HIGH checks (pending disbursements WARN, unreconciled prior-month WARN, firewall violations HIGH).
- Updated `src/lib/ledger.test.ts` — updated `cleanState` baseline with the three new zero fields; added 12 new guardrail tests covering all three inc2 checks (fire/no-fire, singular/plural wording, policy cite, simultaneous).
- Updated `src/lib/ledger-queries.ts`:
  - Added imports: `ledgerReimbursements`, `members`, `users`, `asc`, `isNotNull` (unused but reserved), `LedgerReimbursement`.
  - Added `pendingExpenseCents` to `FundReport` and `FundSummary` types.
  - `listTransactions` — added optional `status` filter; when omitted, all statuses returned (balance computations filter separately).
  - `getFundReport` — filters actuals to `status='posted'` rows only; computes `pendingExpenseCents` from pending expense rows; returns both in the report.
  - `getOverview` — fetches all statuses in one query; splits posted/pending in TypeScript; fund summaries now use posted-only for balance/income/expense, pending-only for encumbered figure; entity-level gross receipts uses posted income only; computes three inc2 guardrail inputs (`pendingDisbursements`, `unreconciledPriorMonth`, `firewallViolations` via transferGroupId → fund-kind map).
  - Added `getPendingApprovals(entityId?)` — returns all pending transactions, oldest-first.
  - Added reimbursement query functions: `listReimbursementsForMember`, `listReimbursementsForAdmin` (with member join + pagination), `getReimbursement`, `getReimbursementWithMember`, `getUserEmail`, `getEmailsForFeature`.
- Updated `src/app/api/admin/ledger/transactions/route.ts` — server-side status derivation (`flow==='expense' && amountCents > settings.disbApprovalThresholdCents` → `'pending'`; client `status` field ignored); E-1 email to LEDGER_APPROVE holders on pending insert; response now includes `status` field.
- Updated `src/app/api/admin/ledger/transactions/[id]/route.ts` — PATCH and DELETE both now guard on `status==='rejected'` (403 "Rejected transactions cannot be edited/deleted"); DELETE column selection expanded to include `status`.
- Created `POST /api/admin/ledger/transactions/[id]/approve/route.ts` — gate `LEDGER_APPROVE`; 409 if not pending; 403 self-approval (`session.user.id === txn.recordedByUserId`); sets `status='posted'`, `approvedByUserId`, `approvedAt`, `boardMinute`.
- Created `POST /api/admin/ledger/transactions/[id]/reject/route.ts` — gate `LEDGER_APPROVE`; same guards; sets `status='rejected'`, `rejectionReason`.
- Created `POST /api/admin/ledger/transactions/[id]/reconcile/route.ts` — gate `LEDGER_RECORD`; 400 if not `status='posted'`; toggles `reconciled`/`reconciledAt`.
- Created `GET /api/admin/ledger/reimbursements/route.ts` — gate `LEDGER_VIEW`; paginated list with member names; `receiptStorageKey` stripped from response.
- Created `GET|PATCH /api/admin/ledger/reimbursements/[id]/route.ts` — GET: `LEDGER_VIEW`; PATCH with `action` discriminator: `approve` (`LEDGER_APPROVE`, self-approval guard via `session.user.memberId`), `reject` (`LEDGER_APPROVE`, same guard), `pay` (`LEDGER_RECORD`, DB transaction with double-pay guard via `WHERE status='approved' RETURNING` atomicity). E-3 and E-4 emails to the submitting member.
- Created `GET /api/admin/ledger/reimbursements/[id]/receipt/route.ts` — gate `LEDGER_VIEW`; streams bytes via `getReceiptStorage().read()`; never exposes storage key or blob URL.
- Created `GET|POST /api/members/reimbursements/route.ts` — gate: `session.user.memberId`; GET returns own list; POST validates amount/description/key format, duplicate guard (60s window), inserts with `status='submitted'`; E-2 email to LEDGER_APPROVE holders.
- Created `GET|PATCH|DELETE /api/members/reimbursements/[id]/route.ts` — ownership gate; GET/PATCH/DELETE return 404 for non-owned IDs (prevents existence leaking); PATCH/DELETE block when `status !== 'submitted'`; DELETE uses atomic `WHERE status='submitted'` to guard concurrent approval.
- Created `GET /api/members/reimbursements/[id]/receipt/route.ts` — ownership gate; 404 (not 403) for other-member IDs; streams bytes; never exposes storage key.
- Created `POST /api/members/reimbursements/upload/route.ts` — gate: `session.user.memberId`; validates size (10 MB) and magic bytes; generates `receipts/<uuid>/<sanitized-name>` key; calls `getReceiptStorage().save()`; returns `{ key }` only — no blob URL, no filesystem path.

### Outputs

**New files:**
- `src/lib/receipt-storage/index.ts` — `ReceiptStorage` interface + factory
- `src/lib/receipt-storage/local.ts` — local dev adapter
- `src/lib/receipt-storage/vercel-blob.ts` — production adapter
- `src/lib/receipt-storage/receipt-storage.test.ts` — 17 tests
- `src/lib/receipt-magic-bytes.ts` — magic-byte validator + exported `validateMagicBytes()`
- `src/app/api/admin/ledger/transactions/[id]/approve/route.ts`
- `src/app/api/admin/ledger/transactions/[id]/reject/route.ts`
- `src/app/api/admin/ledger/transactions/[id]/reconcile/route.ts`
- `src/app/api/admin/ledger/reimbursements/route.ts`
- `src/app/api/admin/ledger/reimbursements/[id]/route.ts`
- `src/app/api/admin/ledger/reimbursements/[id]/receipt/route.ts`
- `src/app/api/members/reimbursements/route.ts`
- `src/app/api/members/reimbursements/[id]/route.ts`
- `src/app/api/members/reimbursements/[id]/receipt/route.ts`
- `src/app/api/members/reimbursements/upload/route.ts`

**Modified files:**
- `.gitignore` — added `.receipt-store/`
- `package.json` / `pnpm-lock.yaml` — added `@vercel/blob 2.4.1`
- `src/lib/ledger.ts` — `GuardrailsInput` extended; `guardrails()` updated; JSDoc updated
- `src/lib/ledger.test.ts` — 12 new inc2 guardrail tests; `cleanState` updated
- `src/lib/ledger-queries.ts` — `FundReport`/`FundSummary` types updated; `listTransactions` opts; `getFundReport` status filtering; `getOverview` full inc2 rewrite; new query functions
- `src/app/api/admin/ledger/transactions/route.ts` — server-side status derivation; E-1 email
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — rejected-status guard on PATCH and DELETE

**API contract for ux-developer (Phase 4c):**

| Method | Path | Auth | Feature gate |
|--------|------|------|------|
| POST | `/api/admin/ledger/transactions/[id]/approve` | yes | `LEDGER_APPROVE` |
| POST | `/api/admin/ledger/transactions/[id]/reject` | yes | `LEDGER_APPROVE` |
| POST | `/api/admin/ledger/transactions/[id]/reconcile` | yes | `LEDGER_RECORD` |
| GET | `/api/admin/ledger/reimbursements` | yes | `LEDGER_VIEW` |
| GET | `/api/admin/ledger/reimbursements/[id]` | yes | `LEDGER_VIEW` |
| PATCH | `/api/admin/ledger/reimbursements/[id]` | yes | `LEDGER_APPROVE` (approve/reject) or `LEDGER_RECORD` (pay) |
| GET | `/api/admin/ledger/reimbursements/[id]/receipt` | yes | `LEDGER_VIEW` |
| GET | `/api/members/reimbursements` | yes | `memberId` ownership |
| POST | `/api/members/reimbursements` | yes | `memberId` ownership |
| GET | `/api/members/reimbursements/[id]` | yes | `memberId` ownership |
| PATCH | `/api/members/reimbursements/[id]` | yes | `memberId` ownership |
| DELETE | `/api/members/reimbursements/[id]` | yes | `memberId` ownership |
| GET | `/api/members/reimbursements/[id]/receipt` | yes | `memberId` ownership |
| POST | `/api/members/reimbursements/upload` | yes | `memberId` ownership |

Key query helpers available to Server Components:
- `getPendingApprovals(entityId?)` — use in the new `/admin/ledger/approvals` page
- `listReimbursementsForAdmin({ status?, memberId?, limit?, offset? })` — use in admin inbox (returns `ReimbursementWithMember[]` + total)
- `listReimbursementsForMember(memberId)` — use in member portal page
- `getReimbursementWithMember(id)` — use in admin detail view
- `FundSummary.pendingExpenseCents` — new field on every fund summary (encumbered figure for the overview)
- `FundReport.pendingExpenseCents` — same on the fund detail report

### Deviations from Phase 3 design

- `PATCH /api/admin/ledger/reimbursements/[id]` — Phase 3 specified separate sub-routes for approve/reject/pay. Per the Phase 3 design note itself ("Why a single PATCH with action? Three operations are mutually exclusive state transitions on the same row; a single PATCH keeps the URL surface minimal"), the single-PATCH-with-action pattern was used.
- Receipt proxy Response: used `stored.bytes.buffer as ArrayBuffer` for `new Response()` constructor compatibility with TypeScript's strict BodyInit types.
- `listReimbursementsForAdmin` pagination count uses a raw `sql` tagged template because Drizzle ORM does not expose a direct `.count()` builder that works with conditional WHERE clauses cleanly.

### Open questions / handoff notes

- **Next agent: ux-developer** — Phase 4c. Consume the API contract above to build:
  - `src/app/(dashboard)/admin/ledger/approvals/page.tsx` (uses `getPendingApprovals()` + approve/reject routes)
  - `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx` (uses admin reimbursement routes)
  - Updates to existing fund ledger list page (pending/rejected badges, reconcile toggle, encumbered balance, `FundSummary.pendingExpenseCents`)
  - Updates to existing overview page (encumbered figure per fund, guardrail section unchanged — new flags appear automatically)
  - `src/app/members/reimbursements/page.tsx` (member portal list + submission form + upload)
  - Member portal nav — "My Reimbursements" card
  - FU-1 (BudgetEditor 0-vs-remove nil), FU-2 (dead-code !report guard), FU-3 (beneficiaryCause field in ordinary transaction form)
- **Upload flow for the member form:** The form should: (1) on file selection, POST to `/api/members/reimbursements/upload`, show a spinner, receive `{ key }`; (2) store `key` in React state; (3) include `receiptStorageKey: key` in the final form POST to `/api/members/reimbursements`. The browser never sees a blob URL.
- **"Reconcile all displayed" button:** The Phase 3 design says the UI POSTs to the per-row reconcile route once per visible row (small club, N < 30/month). The ux-developer implements the "Reconcile all displayed" convenience pattern in the client component.
- **`disbApprovalThresholdCents` for the pending toast:** When a transaction is submitted and the server responds `{ id, derivedFiscalYear, status: 'pending' }`, the ux-developer should show a toast "Disbursement submitted — awaiting board approval" (not the generic success toast). The new `status` field in the response enables this.
- **`pendingExpenseCents` display:** The overview should show this as "Encumbered (pending): $X" below the posted balance for each fund. The field is now on every `FundSummary` in the `EntityOverview`.
- **FU-4 deferred:** Settings UI for `disbApprovalThresholdCents` is not in inc2 scope. Treasurer must contact a developer to change the $250 default. Log as inc3 follow-up.

---

## Phase 4c — Implementation (UI) — 2026-06-25

**Owner:** ux-developer
**Status:** complete

### Summary

Built the full UI layer for inc2: two new admin pages (Approvals, Reimbursements inbox), a new member portal page (My Reimbursements with two-step receipt upload), six new client components, and updates to the existing fund ledger list, overview page, and transaction form. All three FU items addressed. Typecheck clean, 217 tests pass, `pnpm build:only` compiles 21 new routes without errors.

### What I did

- **`src/app/(dashboard)/admin/ledger/approvals/page.tsx`** — Server Component, gated `LEDGER_APPROVE` (redirect to `/admin/ledger` if not held). Fetches `getPendingApprovals()` + `getSettings()` in parallel. Table with Date, Fund, Amount, Payee/Memo, Recorded-by columns. Per-row: Approve (hidden/replaced with "Cannot self-approve" label when `recordedByUserId === session.user.id`), Reject. Empty state shows current threshold. Approve uses `ApproveDialog` (board-minute required). Reject uses `RejectTransactionDialog` (reason required, destructive).

- **`src/app/(dashboard)/admin/ledger/reimbursements/page.tsx`** — Server Component, gated `LEDGER_VIEW` (with broader fallback gating). Status tabs (Submitted / Approved / Rejected / Paid) with live counts. Table columns: Submitted date, Member name+email, Amount, Description+cause, Status badge, Receipt link (proxy route in new tab), Actions. Submitted tab: Approve (LEDGER_APPROVE; self-submitted label if isSelf) + Reject. Approved tab: Mark Paid (LEDGER_RECORD, opens PayReimbursementDialog with fund picker). Paid tab shows transaction ID. Receipt links point to `/api/admin/ledger/reimbursements/[id]/receipt` — never the storage key.

- **`src/app/members/reimbursements/page.tsx`** — Server Component, gated by `session.user.memberId`. "Account Not Linked" empty state when memberId is null (identical to dues page pattern). Submission form (client) does two-step upload: file POST → `{key}` → store in React state → include `receiptStorageKey` in form POST. No fund picker (R-3). Request list shows status badge, rejection reason (when rejected), board-minute (when approved/paid), receipt view link, and Withdraw button (only when submitted, via ConfirmDialog).

- **Member portal homepage** (`src/app/members/page.tsx`) — Added "My Reimbursements" nav card alongside existing Dues card.

- **Fund ledger list** (`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`) — Added `ReconcileToggle` + `ReconcileAllButton` import. Status badge inline on Type column (Pending = yellow, Rejected = gray). Pending rows highlighted yellow-tinted. Pending amount shown in muted gray with tooltip. Rejected rows show `rejectionReason` below party label. Posted rows get `ReconcileToggle` in new "Rec." column. "Reconcile all displayed" button shown above table when >1 unreconciled posted transaction exists (LEDGER_RECORD only). Added Approvals quick-link button in header.

- **Overview page** (`src/app/(dashboard)/admin/ledger/page.tsx`) — Added `getPendingApprovals()` call (only when `canApprove`). Approvals button in header with yellow badge count. Encumbered figure (`pendingExpenseCents`) shown below each fund card balance when non-zero. Quick links section added (Reimbursement Requests + Pending Approvals). Guardrail flags unchanged — new inc2 flags (pending disbursements WARN, unreconciled WARN, firewall HIGH) appear automatically from the updated `guardrails()` function.

- **`src/components/admin/ledger/approve-dialog.tsx`** — Radix Dialog with board-minute text input (required, max 500 chars). POSTs to `/api/admin/ledger/transactions/[id]/approve`.

- **`src/components/admin/ledger/reject-dialog.tsx`** — Two exports: `RejectTransactionDialog` (transactions reject route) and `RejectReimbursementDialog` (reimbursements PATCH with `action='reject'`). Both use Radix Dialog with required reason textarea, destructive red confirm button.

- **`src/components/admin/ledger/approve-reimbursement-dialog.tsx`** — Board-minute dialog for reimbursement approval, POSTs `action='approve'` to PATCH reimbursements route.

- **`src/components/admin/ledger/pay-reimbursement-dialog.tsx`** — Fund picker (required), payment date, payment method, optional note. POSTs `action='pay'` to PATCH reimbursements route.

- **`src/components/admin/ledger/reconcile-toggle.tsx`** — Two exports: `ReconcileToggle` (per-row optimistic toggle) and `ReconcileAllButton` (fires N serial POSTs, one per unreconciled row; shows count in label).

- **`src/components/members/reimbursement-form.tsx`** — Two exports: `ReimbursementSubmitForm` (full two-step upload form with file type hint, size check, character counter on description) and `WithdrawButton` (ConfirmDialog for DELETE).

- **FU-1** (`src/components/admin/ledger/budget-editor.tsx`) — Fixed nil handling: empty string → remove (`null`), explicit `0`/`0.00` → $0 budget (not null). Updated placeholder hint text.

- **FU-2** — Left the `!report` guard in the fund report page. After verification, `getFundReport` genuinely returns `Promise<FundReport | null>` (null when fund row not found). The guard is not dead code in practice but is a defensive safety check. Noted here so QA can verify.

- **FU-3** (`src/components/admin/ledger/transaction-form.tsx`) — Added `beneficiaryCause` optional text field to the regular transaction form (shows only on new non-transfer expense entries). Included in POST body as `beneficiaryCause: beneficiaryCause.trim() || null`.

- **Pending toast** — Updated `transaction-form.tsx` to detect `data.status === 'pending'` in the POST response and show "Disbursement submitted — awaiting board approval" instead of the generic success toast.

### Outputs

**New files:**
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx`
- `src/app/(dashboard)/admin/ledger/reimbursements/page.tsx`
- `src/app/members/reimbursements/page.tsx`
- `src/components/admin/ledger/approve-dialog.tsx`
- `src/components/admin/ledger/reject-dialog.tsx`
- `src/components/admin/ledger/approve-reimbursement-dialog.tsx`
- `src/components/admin/ledger/pay-reimbursement-dialog.tsx`
- `src/components/admin/ledger/reconcile-toggle.tsx`
- `src/components/members/reimbursement-form.tsx`

**Modified files:**
- `src/app/(dashboard)/admin/ledger/page.tsx` — Approvals link + badge, encumbered on fund cards, quick links section, `getPendingApprovals` call
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — Status badges, reconcile toggle column, Reconcile-all button, Approvals quick-link
- `src/app/members/page.tsx` — "My Reimbursements" nav card
- `src/components/admin/ledger/transaction-form.tsx` — Pending toast, FU-3 beneficiaryCause field
- `src/components/admin/ledger/budget-editor.tsx` — FU-1 nil handling fix

### Gating approach

| Surface | Gate |
|---|---|
| `/admin/ledger/approvals` | `auth()` + `hasFeature(LEDGER_APPROVE)` → redirect `/admin/ledger` |
| `/admin/ledger/reimbursements` | `auth()` + `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` → redirect `/access-pending` |
| Approve/Reject buttons (reimbursements) | `canApprove` (server-derived) — UI hidden; server enforces per API contract |
| Mark Paid button | `canRecord` (server-derived) — UI hidden; server enforces |
| Self-approval | UI hides Approve button when `txn.recordedByUserId === session.user.id` or `r.submittedByMemberId === session.user.memberId`; server enforces 403 |
| `/members/reimbursements` | `auth()` + `session.user.memberId` null check → "Account Not Linked" state |

### Receipt upload + display flow

1. Member selects file; client validates size (≤10 MB) immediately.
2. On form submit, client POSTs `multipart/form-data` to `/api/members/reimbursements/upload`.
3. Server validates magic bytes + size, generates `receipts/<uuid>/<filename>` key, calls `getReceiptStorage().save()`. Returns `{ key }`.
4. Client stores `key` in React state; submits form POST with `receiptStorageKey: key`.
5. Admin views receipt via `/api/admin/ledger/reimbursements/[id]/receipt` (gated `LEDGER_VIEW`).
6. Member views receipt via `/api/members/reimbursements/[id]/receipt` (ownership gated).
7. Both proxy routes call `getReceiptStorage().read(key)` and stream bytes inline — storage URL/path never exposed to browser (DECISION-020).

### Build / test / typecheck results

- `pnpm exec tsc --noEmit`: clean (no errors)
- `pnpm test`: 217 passed (0 new tests added — UI code not unit-testable without a browser runner; functional coverage via QA click-through)
- `pnpm build:only`: compiled successfully, 21 new/updated routes in build output

### Open questions / handoff notes for QA

**Click-through priorities:**

1. **Full reimbursement lifecycle**: Member submits (with PDF receipt) → admin Submitted tab shows row → board approves (enters board minute) → admin Approved tab shows row → treasurer marks paid (selects fund, method) → admin Paid tab shows row + member portal shows Paid badge. Verify email enqueued at each step (check `email_queue` table in admin).

2. **Self-approval hiding**: As a user with `ledger.approve` who also has a `memberId`, submit a reimbursement, then as the same user visit the admin reimbursements page — the Approve button should be replaced with "Self-submitted" label. Verify the server also returns 403 if the approve API is called directly.

3. **Receipt streaming**: After submission, click "View receipt" in both admin inbox and member portal. Verify the browser displays the file (PDF inline or JPEG/PNG image) without the storage key or blob URL appearing in the URL bar.

4. **Pending disbursements flow**: Record an expense over $250 → verify "awaiting board approval" toast → verify Pending badge on fund ledger list → verify Approvals page shows the row → approve it (enter board minute) → verify it disappears from Approvals, appears as Posted in fund ledger.

5. **Self-approval hiding on Approvals page**: Record a transaction as User A (who also has `ledger.approve`) — verify the "Cannot self-approve" label replaces the Approve button for that row.

6. **Reconcile toggle**: On a posted transaction, click the reconcile checkbox — verify it toggles to green checkmark and back. Click "Reconcile all displayed" — verify all unreconciled rows flip green. Verify unreconciled guardrail on overview updates after reconciling.

7. **Encumbered balance**: With a pending expense on a fund, verify the overview fund card shows the yellow "Encumbered (pending approval)" line with the correct amount.

8. **Reject flow**: Reject a pending disbursement with a reason → verify it disappears from Approvals page → verify it shows with Rejected badge on the fund ledger list with the reason visible.

9. **Withdraw**: Member submits a request → member withdraws it (via ConfirmDialog) → request disappears from list.

10. **FU-1 BudgetEditor**: Enter `0` in a budget field → save → verify report shows `$0.00` (not `—`). Clear the field → save → verify report shows `—`.

**Copy to refine:**
- "Awaiting Board Review" badge on member portal — may want to be more specific.
- Empty state on Approvals: "No pending disbursements — all expenditures are approved" — confirm wording is acceptable.
- Encumbered label: "Encumbered (pending approval)" — treasurer may prefer "Pending Board Approval".

**FU-2 note:** The `!report` guard in the fund report page was left in place (it IS defensive code, not dead code). QA may wish to verify this produces no visible issue.

**Next agent: qa**

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-06-25

**Owner:** qa
**Status:** complete

### Summary

PASS. All four automated gates pass clean: TypeScript typecheck produces no errors, 219 Vitest unit tests pass (2 new regression tests added), production build compiles 21 new/updated routes with no warnings, and both migrations (`0046_ledger_controls.sql`, `0047_ledger_approve_permission.sql`) are verified idempotent (second-run NOTICEs only). The 10 new API routes and 2 new admin pages are present in the build manifest. All security-critical behaviors (self-approval 403 server-side, double-pay 409 atomic guard, receipt storage-key opacity, magic-byte rejection, 404-not-403 for non-owned receipts) are verified by code audit and auth-gate curl tests. No defects found.

### What I did

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** — no errors, no warnings.

#### Unit Tests
`pnpm test`: **PASS**
Total: 219 | Passed: 219 | Failed: 0
Duration: ~0.24s
Test files: 6 (events.test.ts, members.test.ts, permissions.test.ts, ledger.test.ts, ledger-queries.test.ts, receipt-storage.test.ts)

Breakout of inc2 tests already present in the suite (26 new in 4b, confirmed):
- `ledger.test.ts` — 12 new inc2 guardrail tests (pending disbursements WARN, unreconciled WARN, firewall HIGH — all fire/no-fire paths, singular/plural wording, simultaneous multi-flag)
- `receipt-storage.test.ts` — 9 LocalReceiptStorage round-trip tests + 8 magic-byte validator tests (PDF/JPEG/EXIF/PNG accepted; GIF/WEBP/empty/short/spoofed rejected)

New regression tests added in Phase 5:
- `validateMagicBytes rejects a WEBP file — regression for format-expansion` — guards against accidentally widening the allowed receipt types to include WEBP; `src/lib/receipt-storage/receipt-storage.test.ts`
- `validateMagicBytes accepts a JPEG with app2 ICC profile marker — regression for JPEG variant coverage` — guards against a too-strict JPEG check that would reject valid photos with APP2 markers; `src/lib/receipt-storage/receipt-storage.test.ts`

#### Production Build
`pnpm build:only`: **PASS**
Route count: 156 dynamic routes (ƒ), 2 static (○). New routes confirmed in manifest:
- `/admin/ledger/approvals` (ƒ)
- `/admin/ledger/reimbursements` (ƒ)
- `/members/reimbursements` (ƒ)
- `/api/admin/ledger/transactions/[id]/approve` (ƒ)
- `/api/admin/ledger/transactions/[id]/reject` (ƒ)
- `/api/admin/ledger/transactions/[id]/reconcile` (ƒ)
- `/api/admin/ledger/reimbursements` (ƒ)
- `/api/admin/ledger/reimbursements/[id]` (ƒ)
- `/api/admin/ledger/reimbursements/[id]/receipt` (ƒ)
- `/api/members/reimbursements` (ƒ)
- `/api/members/reimbursements/[id]` (ƒ)
- `/api/members/reimbursements/[id]/receipt` (ƒ)
- `/api/members/reimbursements/upload` (ƒ)

All 21 routes the ux-developer reported are in the manifest. No unexpected warnings.

#### Migration Idempotency
`pnpm db:migrate` second-run output (from dev server start log): `0046_ledger_controls.sql` produced only NOTICE messages for already-existing columns and the table (`board_minute already exists`, `rejection_reason already exists`, `relation "ledger_reimbursements" already exists`). `0047_ledger_approve_permission.sql` executed silently (DO block with WHERE NOT EXISTS guards). Confirmed idempotent.

#### End-to-End Tests
`pnpm test:e2e`: not run (no Playwright specs were added for the ledger in inc1 or inc2; the e2e suite has 22 tests none of which cover ledger flows). This is a known gap inherited from inc1 — the ledger flows require a seeded admin account with specific roles and the complexity of the approval/reimbursement lifecycle makes auth-cookie-based e2e non-trivial to set up. Ledger e2e is deferred per the inc1 precedent; the critical path is covered by code audit + dev-server curl verification.

#### Dev-Server Smoke (auth gates — curl, unauthenticated)

All 10 new API routes correctly return 401 for unauthenticated requests:

| Route | Method | Unauthenticated response |
|-------|--------|--------------------------|
| `/api/admin/ledger/transactions/[id]/approve` | POST | 401 Unauthorized |
| `/api/admin/ledger/transactions/[id]/reject` | POST | 401 Unauthorized |
| `/api/admin/ledger/transactions/[id]/reconcile` | POST | 401 Unauthorized |
| `/api/admin/ledger/reimbursements` | GET | 401 Unauthorized |
| `/api/admin/ledger/reimbursements/[id]` | PATCH | 401 Unauthorized |
| `/api/admin/ledger/reimbursements/[id]/receipt` | GET | 401 Unauthorized |
| `/api/members/reimbursements` | GET | 401 Unauthorized |
| `/api/members/reimbursements/[id]/receipt` | GET | 401 Unauthorized |
| `/api/members/reimbursements/upload` | POST | 401 Unauthorized |

(Dev server killed after smoke testing.)

#### Security-Critical Behavior Verification (code audit)

**1. Status spoofing blocked (client `status` field ignored):**
`POST /api/admin/ledger/transactions/route.ts` lines 202–209: `derivedStatus` is computed entirely from `flow === 'expense' && amountCents > settings.disbApprovalThresholdCents`. The `status` field is never read from `body`; the destructured body includes `entityId, fundId, txnDate, flow, amountCents, categoryId, party, memo, paymentMethod, bankAccountId, beneficiaryCause, receiptUrl` — `status` is not in the list. Sending `status:'posted'` for an over-threshold expense will be ignored. VERIFIED by code read.

**2. Self-approval 403 (transactions):**
`approve/route.ts` line 68: `if (session.user.id === txn.recordedByUserId)` → 403 "You cannot approve a transaction you recorded". Same guard in `reject/route.ts` line 68. Server-side, before any DB update. VERIFIED.

**3. Self-approval 403 (reimbursements):**
`reimbursements/[id]/route.ts` lines 152–161: `if (session.user.memberId && reimb.submittedByMemberId && session.user.memberId === reimb.submittedByMemberId)` → 403. Both approve and reject actions check this. VERIFIED. Edge case: if the approver has no `memberId` (unlinked admin), the guard evaluates `undefined && ...` → false, which correctly allows the approval. This is correct behavior documented in Phase 3 edge cases.

**4. Double-pay 409 (atomic guard):**
`reimbursements/[id]/route.ts` lines 344–365: uses a DB transaction; the update `WHERE status='approved'` uses `.returning()` and checks `updated.length === 0` — if 0, throws `"DOUBLE_PAY"` which rolls back the entire DB transaction and returns 409 to the caller. VERIFIED.

**5. Receipt storage key not exposed in JSON:**
- Admin list route (`reimbursements/route.ts` line 61): `const safeReimbursements = reimbursements.map(({ receiptStorageKey: _k, ...rest }) => rest)` — VERIFIED.
- Admin detail route (`reimbursements/[id]/route.ts` line 98): `const { receiptStorageKey: _k, ...safe } = reimb` — VERIFIED.
- Member list route (`members/reimbursements/route.ts` line 63): same strip pattern — VERIFIED.
- Member detail route (`members/reimbursements/[id]/route.ts` line 88): same strip pattern — VERIFIED.
- Upload route returns `{ key }` only — no blob URL, no filesystem path — VERIFIED.

**6. Receipt 404-not-403 for non-owner (member proxy):**
`members/reimbursements/[id]/receipt/route.ts` line 40: `if (!reimb || reimb.submittedByMemberId !== session.user.memberId)` → 404 "Not found". Returns 404 for both non-existent IDs and IDs belonging to other members. VERIFIED.

**7. Magic-byte validation:**
`receipt-magic-bytes.ts`: validates PDF (`%PDF` 4-byte), JPEG (`FF D8 FF` 3-byte, any 4th), PNG (full 8-byte signature). Returns null for anything else. Upload route calls `validateMagicBytes(bytes)` before writing to storage; `if (!contentType) → 400`. VERIFIED by code read + 8 passing unit tests.

**8. Local adapter (no BLOB_READ_WRITE_TOKEN):**
`receipt-storage/local.ts`: writes to `.receipt-store/<key>` using path-sanitization (splits on `/\\`, strips `.` and `..` segments, joins with `path.sep`). Content-type stored in `.ct` sidecar. `read()` returns null for missing files. `.receipt-store/` is in `.gitignore` line 51. `@vercel/blob` is NOT loaded when `BLOB_READ_WRITE_TOKEN` is absent (factory uses `require()` inside the else branch of an env-var check). VERIFIED by code read + 9 passing unit tests.

**9. Guardrail — firewall HIGH:**
`ledger.ts` lines 372–380: `if (state.firewallViolations > 0)` → HIGH severity flag citing `Lions Financial Transparency Policy §6 — Two-Fund Firewall`. The three inc2 guardrail inputs are computed in `getOverview()` from the same transaction fetch used for balances (no extra DB round-trip). VERIFIED.

**10. Reconcile blocks pending rows:**
`reconcile/route.ts` lines 63–68: `if (txn.status !== 'posted')` → 400 "Only posted transactions can be reconciled". VERIFIED.

**11. Rejected transactions immutable:**
`transactions/[id]/route.ts` lines 106–111: `if (existing.status === 'rejected')` → 403 for both PATCH and DELETE. VERIFIED.

**12. Reimbursements bypass threshold on pay:**
`reimbursements/[id]/route.ts` line 334: `status: "posted"` hardcoded in the ledgerTransactions insert on `action='pay'`. The `disbApprovalThresholdCents` check in the POST handler is never invoked for reimbursement pay actions. VERIFIED.

#### Manual Click-Through

Cannot be driven without real admin credentials and an active session. The following flows were verified by code audit and are documented above:

| Flow | Verification method | Result |
|------|---------------------|--------|
| Status spoofing (send `status:'posted'` for over-threshold expense) | Code audit: `status` field not destructured from body | PASS |
| Self-approval 403 server-side (transactions) | Code audit: `session.user.id === txn.recordedByUserId` guard | PASS |
| Self-approval 403 server-side (reimbursements) | Code audit: `session.user.memberId === reimb.submittedByMemberId` guard | PASS |
| Double-pay 409 (atomic DB transaction) | Code audit: `WHERE status='approved'` + `DOUBLE_PAY` throw on 0 rows | PASS |
| Receipt proxy returns 404 for non-owned ID | Code audit: `submittedByMemberId !== session.user.memberId → 404` | PASS |
| Magic-byte rejection (non-PDF/JPEG/PNG) | Code audit + 8 unit tests (GIF, WEBP, empty, short, spoofed) | PASS |
| Local adapter writes to `.receipt-store/` | Code audit + 9 unit tests (round-trip, overwrite, missing CT sidecar, path traversal) | PASS |
| `@vercel/blob` never loaded locally | Code audit: factory uses `require()` inside env-var branch; local env has no token | PASS |
| Admin receipt proxy gated on `LEDGER_VIEW` | Code audit + curl (401 unauthenticated) | PASS |
| boardMinute required on approve (400 without it) | Code audit: `if (!rawBoardMinute ...)` → 400 before any DB update | PASS |
| Email queue rows enqueued (non-blocking) | Code audit: all 4 email points wrapped in try/catch; failure does not block response | PASS (non-blocking pattern verified) |

The following flows require real browser + DB and could not be verified programmatically. They are flagged for manual verification by the implementing team before marking the pipeline truly closed, but do NOT constitute FAIL conditions for this Phase 5 report since the code path is verified:

| Flow | Why not auto-verified |
|------|-----------------------|
| Full reimbursement lifecycle in browser | Requires seeded admin + board member + treasurer sessions |
| Email queue rows appear in DB after submit/approve/pay | Requires active DB session and email_queue table query |
| Encumbered balance shown on overview | Requires a pending expense in DB |
| Firewall HIGH on Activity→Admin transfer | Requires two-fund DB setup |
| Reconcile toggle + "Reconcile all" button in UI | Requires posted transactions in DB |

#### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/admin/ledger/transactions/[id]/approve` | yes | yes | `FEATURES.LEDGER_APPROVE` |
| `POST /api/admin/ledger/transactions/[id]/reject` | yes | yes | `FEATURES.LEDGER_APPROVE` |
| `POST /api/admin/ledger/transactions/[id]/reconcile` | yes | yes | `FEATURES.LEDGER_RECORD` |
| `GET /api/admin/ledger/reimbursements` | yes | yes | `FEATURES.LEDGER_VIEW` |
| `GET /api/admin/ledger/reimbursements/[id]` | yes | yes | `FEATURES.LEDGER_VIEW` |
| `PATCH /api/admin/ledger/reimbursements/[id]` approve | yes | yes | `FEATURES.LEDGER_APPROVE` |
| `PATCH /api/admin/ledger/reimbursements/[id]` reject | yes | yes | `FEATURES.LEDGER_APPROVE` |
| `PATCH /api/admin/ledger/reimbursements/[id]` pay | yes | yes | `FEATURES.LEDGER_RECORD` |
| `GET /api/admin/ledger/reimbursements/[id]/receipt` | yes | yes | `FEATURES.LEDGER_VIEW` |
| `GET /api/members/reimbursements` | yes | ownership (`session.user.memberId`) | n/a — no FEATURES key, matches dues pattern |
| `POST /api/members/reimbursements` | yes | ownership (`session.user.memberId`) | n/a |
| `GET /api/members/reimbursements/[id]` | yes | ownership (submittedByMemberId) | n/a |
| `PATCH /api/members/reimbursements/[id]` | yes | ownership + status=submitted | n/a |
| `DELETE /api/members/reimbursements/[id]` | yes | ownership + status=submitted | n/a |
| `GET /api/members/reimbursements/[id]/receipt` | yes | ownership (submittedByMemberId) | n/a |
| `POST /api/members/reimbursements/upload` | yes | ownership (`session.user.memberId`) | n/a |
| Page: `/admin/ledger/approvals` | yes | `FEATURES.LEDGER_APPROVE` → redirect `/admin/ledger` | correct |
| Page: `/admin/ledger/reimbursements` | yes | `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` → redirect `/access-pending` | correct |
| Page: `/members/reimbursements` | yes | `session.user.memberId` null check → Account Not Linked state | correct |
| Modified `POST /api/admin/ledger/transactions` | yes | `FEATURES.LEDGER_RECORD` (unchanged from inc1) | correct |
| Modified `PATCH/DELETE /api/admin/ledger/transactions/[id]` | yes | `FEATURES.LEDGER_RECORD` (unchanged from inc1) | correct |

All gates are present and use the correct keys. The member portal routes correctly use ownership-based gating (not a FEATURES key) — this is the intended design, identical to the dues page pattern.

#### Invariant Checks

- **No `window.confirm/alert/prompt`:** grep confirmed none in any new component. The hits were on `@radix-ui/react-alert-dialog` import and a UI string "prompt" — not native browser dialogs. ConfirmDialog used for destructive withdraw; Radix Dialog used for approve/reject (non-destructive in the approve case, destructive Radix AlertDialog in the reject case). PASS.
- **No `console.log` in production paths:** grep of all new route files confirms only `console.error` (for error logging in catch blocks). PASS.
- **No `lions-red`:** grep of all new components returns no matches. PASS.
- **Cents integers:** all `amountCents` values are validated as positive integers in every route handler. The reimbursement ceiling is 1,000,000 cents ($10,000). PASS.
- **Migrations idempotent:** both migration files use `IF NOT EXISTS`, `WHERE NOT EXISTS` guards, and guarded DO blocks. Second-run NOTICEs only. PASS.

#### Coverage on Critical Modules

- `src/lib/events.ts`: 94.73% statements
- `src/lib/permissions.ts`: not shown separately; the permissions constants are used by route handlers (tested via type system + build)
- `src/lib/ledger.ts`: **100%** statements, 90.9% branch
- `src/lib/receipt-magic-bytes.ts`: covered by 8 unit tests (PDF/JPEG/EXIF/PNG/GIF/WEBP/empty/short/spoofed)
- `src/lib/receipt-storage/local.ts`: covered by 9 unit tests (round-trip, overwrite, delete, path traversal, missing CT sidecar)
- `src/lib/members.ts`: 0% (pre-existing, covered by e2e)

#### Regression Tests Added

- `validateMagicBytes rejects a WEBP file — regression for format-expansion` — `src/lib/receipt-storage/receipt-storage.test.ts` — guards against accidentally widening the allowed upload types
- `validateMagicBytes accepts a JPEG with app2 ICC profile marker — regression for JPEG variant coverage` — `src/lib/receipt-storage/receipt-storage.test.ts` — guards against a too-strict JPEG check that would reject valid EXIF/ICC photos

### Outputs

- `src/lib/receipt-storage/receipt-storage.test.ts` — 2 new regression tests added (WEBP rejection, JPEG-APP2 variant)
- `docs/work-log/2026-06-24-ledger-controls.md` — Phase 5 section written; Per-Phase Status updated

### Verdict: PASS

### Open questions / handoff notes

- **Next agent: analyst** for Phase 6 — Shipped vs Intent sign-off.
- The following flows are verified by code audit but not exercised with real data. Before production deploy, the implementing team should manually verify at minimum: (1) submit a reimbursement and confirm it appears in the admin inbox; (2) approve it and confirm the email queue row appears; (3) mark paid and confirm the expense transaction is created with `status='posted'`; (4) record an over-threshold expense and confirm the `status='pending'` response and the Approvals screen badge.
- `getReceiptStorage()` factory is not unit-testable in the current Vitest ESM setup (uses synchronous `require()` — cannot resolve relative modules). The factory correctness is verified by: the LocalReceiptStorage unit tests (the class works), and manual local dev startup (dev server uses LocalReceiptStorage with `.receipt-store/`). This is a documentation note, not a defect.
- Inc3 follow-up FU-4: settings UI for `disbApprovalThresholdCents` is still deferred. The $250 default is hardcoded via migration seed.
- The 2026-05-27 security review carry-forward "page-level auth gap on 8 admin pages" does not apply to any of the new pages — all three new pages have `auth()` + permission checks at the top of the Server Component.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-06-25

**Owner:** analyst
**Status:** complete

### Summary

SHIP WITH NOTES. The core intent of increment 2 — approval workflow with segregation of duties, self-approval block, reimbursement member self-service with required receipts, pluggable receipt storage (local-no-config dev / Vercel Blob prod), firewall guardrail, reconciliation, immutability lock — all shipped and all critical controls are enforced server-side. Two findings require tracked follow-up before the next production deploy: the Approvals page Fund column and Recorded-by column show truncated UUIDs rather than human-readable names (the intent was "fund, category, amount, party, memo, recorded-by" — shipped is "UUID fragment"), and `BLOB_READ_WRITE_TOKEN` is absent from `.env.example` with no startup warning if the local adapter silently runs in production. Neither is a regression in the financial controls; both are operational pain that will bite a real board member on day one.

---

### What I did

1. Re-read the full Phase 1 base review and reimbursement addendum (user verbs, all five flows per feature, permissions, gaps, adversarial pass), the resolved decisions, Phase 2 architectural rulings, Phase 3 technical design, Phase 4a/4b/4c implementation notes, and Phase 5 QA report.
2. Read the actual implementation: `approve/route.ts`, `reject/route.ts`, `reconcile/route.ts`, `reimbursements/[id]/route.ts` (PATCH full body), `transactions/route.ts` (status derivation section), `receipt-storage/index.ts`, `receipt-storage/local.ts`, `receipt-storage/vercel-blob.ts`, `ledger-queries.ts` (`getPendingApprovals`), `admin/ledger/approvals/page.tsx`, `members/reimbursements/page.tsx`.
3. Verified the Blob token documentation state: `.env.example` does not include `BLOB_READ_WRITE_TOKEN`; CLAUDE.md env-vars section does not include it; no startup warning in the factory.
4. Verified the Approvals page Fund and Recorded-by columns: both show `txn.fundId.slice(0, 8)…` and `txn.recordedByUserId.slice(0, 8)…` respectively — UUID fragments, not names. `getPendingApprovals()` returns `LedgerTransaction[]` with no fund join.

---

### Outputs

- `docs/work-log/2026-06-24-ledger-controls.md` — Phase 6 section written; Per-Phase Status updated.

---

### Intent-vs-shipped diff

**Verdict: SHIP WITH NOTES**

**One-line take:** All financial controls shipped and enforce correctly; the Approvals page shows UUID fragments instead of fund and recorder names, and the `BLOB_READ_WRITE_TOKEN` production requirement has no documentation anchor or startup warning.

---

#### Capability-by-capability

**Approvals workflow (over-threshold expense → pending → board approves → posted)**

Phase 1 said: record over threshold → `status='pending'`; board approves on Approvals screen; transaction flips to posted; pending excluded from balance and shown as encumbered.

Shipped: `POST /transactions` derives status server-side (`flow === 'expense' && amountCents > settings.disbApprovalThresholdCents → 'pending'`), client-supplied `status` is not destructured from the body. Approve route sets `status='posted'`, `approvedByUserId`, `approvedAt`, `boardMinute`. `getOverview` and `getFundReport` filter to `status='posted'` for balance computation and surface `pendingExpenseCents`. Overview shows "Encumbered (pending approval)" per fund. Approvals page exists at `/admin/ledger/approvals`, gated `LEDGER_APPROVE`, with empty state showing the threshold.

Verdict: **matches** on the financial mechanics. One display gap: the Approvals page Fund column renders `txn.fundId.slice(0, 8)…` (a UUID fragment) and the Recorded-by column renders `txn.recordedByUserId.slice(0, 8)…` for non-self rows. Phase 1 Flow B specified the list should show "fund, category, amount, party, memo, recorded-by." A board member looking at this page sees `a3f91b2c…` next to a dollar amount and has no idea which fund they are approving against. This is a usability regression against intent — **FU-5 (see below).**

**Segregation of duties / self-approval block**

Phase 1 said: board approves but can't record/pay; treasurer records/pays but can't approve; self-approval blocked server-side (must not be UI-only).

Shipped: Role matrix — `admin`: all; `treasurer`: `LEDGER_VIEW` + `LEDGER_RECORD`; `board_member`: `LEDGER_VIEW` + `LEDGER_APPROVE`. `LEDGER_APPROVE` is NOT on the treasurer role (confirmed migration `0047_ledger_approve_permission.sql`). `LEDGER_RECORD` is NOT on the board_member role. Self-approval guard on `approve/route.ts` line 68: `session.user.id === txn.recordedByUserId → 403`. Same guard on `reject/route.ts`. Reimbursement self-approval: `session.user.memberId && reimb.submittedByMemberId && session.user.memberId === reimb.submittedByMemberId → 403`. Edge case documented: admin with no `memberId` evaluates to `undefined && ...` → false → correctly allowed. UI shows "Cannot self-approve" / "You recorded this" labels but server enforces independently.

Verdict: **matches** — the most important control is working.

**Immutability lock**

Phase 1 said: approved (`approvedAt IS NOT NULL`) → non-editable, non-deletable. Also reject adds `status='rejected'` immutability.

Shipped: `PATCH/DELETE [id]/route.ts` guards `existing.status === 'rejected' → 403 "Rejected transactions cannot be edited/deleted"`. The `existing.approvedAt` guard was already present from inc1 and is now live (approvedAt is populated on approve). The `status='pending'` delete path (treasurer retract) is explicitly allowed.

Verdict: **matches.**

**Reject with reason (paper trail)**

Phase 1 resolved Gap 2 as: `status='rejected'` + `rejectionReason` (retain row). Shipped: `reject/route.ts` sets `status='rejected'`, `rejectionReason`. `PATCH/DELETE` guards block edits to rejected rows. Fund ledger list shows Rejected badge + reason below party label.

Verdict: **matches.**

**Reconciliation**

Phase 1 said: per-row toggle on posted transactions; "Reconcile all displayed" convenience; reconciling pending rows blocked.

Shipped: `reconcile/route.ts` gate `LEDGER_RECORD`; `txn.status !== 'posted' → 400 "Only posted transactions can be reconciled"`. Fund ledger list has `ReconcileToggle` and `ReconcileAllButton`. Overview shows unreconciled WARN guardrail.

Verdict: **matches.**

**Firewall guardrail (Activity→Admin)**

Phase 1 resolved Gap 5 as: compute only transfer-pair violations (not "stricter cases"); advisory copy only for percentage-allocation / interest-misposting.

Shipped: `ledger.ts` `guardrails()` fires HIGH on `state.firewallViolations > 0`, citing policy §6. `getOverview` computes `firewallViolations` from transfer-pair join (groups by `transferGroupId`, looks up both fund kinds from already-fetched funds list, counts groups where one is `activity` and the other is `administrative`). No attempt to detect percentage-allocation or interest misposting (correct per Gap 5 resolution — advisory copy only).

Verdict: **matches.**

**Reimbursement — member submission with required receipt**

Phase 1 said: member submits amount + description + receipt (required, no fund picker); board approves; treasurer pays; member can edit/withdraw while submitted; rejection reason visible; email at each step.

Shipped: `/members/reimbursements` page gated by `session.user.memberId`. "Account Not Linked" empty state when `memberId` is null. Submission form: amount, description, beneficiaryCause (optional), receipt upload (required — upload POSTs to `/api/members/reimbursements/upload`, returns `{ key }`, key stored in React state and passed in form POST as `receiptStorageKey`). No fund picker. Edit (PATCH) and Withdraw (DELETE via ConfirmDialog) on submitted rows only. Rejection reason shown inline. Board minute shown when approved/paid. Receipt "View receipt" link hits proxy route (never storage URL). Emails E-2 (on submit → LEDGER_APPROVE holders), E-3 (approve/reject → member), E-4 (paid → member) all enqueued via `sendEmail()` in best-effort try/catch.

Verdict: **matches.** One minor note: the "Account Not Linked" empty state renders a 💼 emoji — minor, consistent with the project emoji-avoidance preference but this is cosmetic and not a functional issue. The member portal page hero correctly uses `py-12` (member-portal height, not `py-20`).

**Receipt storage pluggable (local dev no-config / Vercel Blob prod)**

Phase 1 / DECISION-020 said: `ReceiptStorage` interface; `LocalReceiptStorage` (zero config, `.receipt-store/`) when `BLOB_READ_WRITE_TOKEN` absent; `VercelBlobStorage` when present; proxy routes stream bytes, never expose storage URL or key; upload returns `{ key }` not `{ url }`.

Shipped: Factory correctly selects adapter by env var. `LocalReceiptStorage` writes to `.receipt-store/<key>` with path-traversal sanitization, `.ct` sidecar for content-type. `VercelBlobStorage` lazy-imports `@vercel/blob` inside each method (never loaded in local dev). Proxy routes call `getReceiptStorage().read(key)` and stream bytes with `Content-Type` + `Content-Disposition: inline`. `receiptStorageKey` is stripped from all list/detail JSON responses. Upload route returns `{ key }`.

Verdict: **matches** mechanically. **One production-safety gap:** if `BLOB_READ_WRITE_TOKEN` is absent in production (not set in Vercel env), the factory silently falls back to `LocalReceiptStorage`. Receipts uploaded in that state are written to `.receipt-store/` on the serverless function's ephemeral filesystem — they are permanently lost at the next function cold start or redeployment. A treasurer marks a reimbursement submitted, the receipt file appears to upload successfully (HTTP 200), the board member clicks "View receipt" and gets a 404. No error surface distinguishes "receipt lost due to missing token" from "receipt key not found." This is a silent data-loss path. The factory has no `console.warn` or startup check for `NODE_ENV === 'production' && !BLOB_READ_WRITE_TOKEN`. Additionally, `BLOB_READ_WRITE_TOKEN` is not documented in `.env.example` (the canonical local env reference) — a developer setting up the project from scratch will not know the token is required in production. **FU-6 (see below).**

**Inc1 follow-ups FU-1/FU-2/FU-3**

FU-1 (BudgetEditor 0-vs-nil): Fixed — empty string → null (remove), explicit `0` → $0 budget. Matches.
FU-2 (`!report` guard): Left in place after ux-developer verified it is not dead code (`getFundReport` genuinely returns null on missing fund). Phase 1 spec said "remove or confirm" — confirmed and documented. Acceptable drift.
FU-3 (beneficiaryCause in transaction form): Added as optional field on new non-transfer expenses. Matches.

**Inc3–6 deferred features**

No inc3–6 scope leaked into the build. Compliance, reports, philanthropy dashboard, donors/dues auto-post — none present.

---

### Edge cases

| Check | Result |
|---|---|
| Empty Approvals page | pass — "All expenditures are approved" with threshold shown |
| Empty member reimbursements list | pass — "No reimbursement requests yet" with CTA |
| Empty admin reimbursements tab | pass — described in Phase 4c; per-tab empty states present |
| Failure microcopy (server errors) | pass — all route handlers return `{ error: string }` JSON; UI shows toast on error response |
| Permission gate — Approvals page | pass — `LEDGER_APPROVE` required; redirects to `/admin/ledger` if missing |
| Permission gate — admin reimbursements page | pass — `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE, LEDGER_APPROVE])` |
| Permission gate — member portal | pass — `session.user.memberId` null check, renders "Account Not Linked" |
| Self-approval server-side 403 | pass — verified in code |
| Double-pay 409 atomic | pass — DB transaction + `WHERE status='approved'` + `DOUBLE_PAY` throw |
| Receipt proxy 404-not-403 for non-owner | pass — `submittedByMemberId !== session.user.memberId → 404` |
| Magic-byte rejection | pass — 17 unit tests including regression for WEBP and JPEG-APP2 |
| Rejected transactions immutable | pass — 403 on PATCH/DELETE |
| Reconcile on pending row blocked | pass — 400 "Only posted transactions can be reconciled" |
| Mobile (360px) | pass — approvals table has `overflow-x-auto`; member page uses `max-w-3xl` container with responsive flex layout |
| Brand consistency — cards `rounded-2xl` | pass — all new cards use `rounded-2xl` |
| Brand consistency — buttons `rounded-lg` | pass — Approve button `rounded-lg bg-lions-blue`; confirmed no `rounded-full` |
| `<ConfirmDialog>` for destructive actions | pass — Withdraw uses `WithdrawButton` → ConfirmDialog; Reject uses Radix AlertDialog (destructive variant) |
| No `window.confirm` / native dialogs | pass — QA grep confirmed zero hits |
| Blob token absent in production | FAIL — silent data-loss path; no warning; not in `.env.example` — **FU-6** |
| Approvals Fund column human-readable | FAIL — shows UUID fragment — **FU-5** |

---

### Follow-ups (SHIP WITH NOTES)

**FU-5 — Approvals page: Fund column shows UUID fragment, not fund name**

`getPendingApprovals()` returns `LedgerTransaction[]` with no fund join. The Approvals page renders `txn.fundId.slice(0, 8)…`. A board member authorizing a $500 disbursement cannot see which fund it is charged against.

Fix: create `getPendingApprovalsWithFund()` in `ledger-queries.ts` that joins `ledgerFunds` (and optionally `users` for the recorder name). Return type should include `fundName: string`, `fundKind: string`, and `recorderName: string | null`. Update the Approvals page to display the fund name and the recorder's name (at minimum first name + last initial). This is a pure query + display fix — no schema change, no new routes.

Recorded-by column has the same problem: shows `txn.recordedByUserId.slice(0, 8)…` for non-self rows. Same fix: join `users` for first/last name.

**FU-6 — `BLOB_READ_WRITE_TOKEN` absent in production: silent receipt data loss**

The `getReceiptStorage()` factory falls back to `LocalReceiptStorage` when `BLOB_READ_WRITE_TOKEN` is absent. In a Vercel serverless deployment without the token, receipts appear to upload (the member sees no error), but the file is written to the function's ephemeral filesystem and is permanently lost. The board member then gets a 404 when they click "View receipt" on a submitted reimbursement.

Two fixes required (both low-effort):

1. Add a startup/first-call warning in the factory:
   ```typescript
   if (process.env.NODE_ENV === 'production' && !process.env.BLOB_READ_WRITE_TOKEN) {
     console.warn(
       '[receipt-storage] BLOB_READ_WRITE_TOKEN is not set in production. ' +
       'Receipts will be written to the ephemeral local filesystem and will be lost. ' +
       'Set BLOB_READ_WRITE_TOKEN in your Vercel environment variables.'
     );
   }
   ```
2. Add `BLOB_READ_WRITE_TOKEN=` (with a comment) to `.env.example` so any developer setting up the project knows the token is required for production receipt storage.

Neither fix requires a schema change or a new route. The deployment-engineer should also add `BLOB_READ_WRITE_TOKEN` to the Vercel project environment variables before the first production receipt is submitted.

**FU-4 (carried from Phase 3/4) — Settings UI for `disbApprovalThresholdCents`**

Still deferred. The $250 default is hardcoded in the migration seed. Treasurer cannot change it without a developer running a migration. Track for inc3.

---

### Open questions / handoff notes

- FU-5 and FU-6 should each become a work-log entry before the next production deploy that exposes the Ledger to real members and board.
- The Phase 5 note about "manually verify the full reimbursement lifecycle with real credentials before marking the pipeline truly closed" still stands. Code audit verified all guards; browser click-through with seeded roles should be done before a board member is invited to use the Approvals page.
- `getReceiptStorage()` factory is a singleton cached per process. If `BLOB_READ_WRITE_TOKEN` is added to env after process start, the factory will continue to use `LocalReceiptStorage` until the next cold start. This is expected behavior and consistent with the design — noted here for the deployment-engineer.
- The approve race condition on ordinary transactions (two board members approve simultaneously) is handled by the 409 "Transaction is no longer pending" path. There is no equivalent atomic `WHERE status='pending'` guard on the transactions approve route — the route fetches, checks, then updates in two separate DB calls. In a club of this size the window is negligible, but it is technically a non-atomic approve path (unlike the double-pay guard which uses a DB transaction). Flag for future hardening if needed.

---

# Phase 5 Follow-up — FU-5 and FU-6 Resolution (qa)

## Phase 5 Follow-up — 2026-06-25

**Owner:** qa
**Status:** complete

### Summary

Both Phase 6 SHIP WITH NOTES follow-ups (FU-5 and FU-6) are resolved. All three automated gates re-pass clean after the fixes: `pnpm exec tsc --noEmit` produces no output (PASS), `pnpm test` 219/219 PASS, `pnpm build:only` PASS. The Per-Phase Status table row for Phase 5 remains PASS; Phase 6 SHIP WITH NOTES is now closeable.

### What I did

**FU-5 — Approvals page UUID fragments (fix applied):**

Added `PendingApprovalRow` type to `src/lib/ledger-queries.ts`:

```typescript
export type PendingApprovalRow = LedgerTransaction & {
  fundName: string;
  recorderName: string | null;
};
```

Rewrote `getPendingApprovals()` to left-join `ledgerFunds` (for `fundName`) and `users` (for `recorderName` using `users.name` — the `users` table has a single `name: text` column, NOT `firstName`/`lastName` which are on the `members` table). Updated `src/app/(dashboard)/admin/ledger/approvals/page.tsx` to render `txn.fundName` and `txn.recorderName ?? "—"` instead of the UUID-fragment fallbacks.

**FU-6 — Silent receipt loss in production (fix applied):**

Added a `console.warn` in `src/lib/receipt-storage/index.ts` on the `else` branch (no `BLOB_READ_WRITE_TOKEN`) that fires only when `process.env.NODE_ENV === 'production'`. Added `BLOB_READ_WRITE_TOKEN=` with an explanatory comment to `.env.example`.

### Re-verification gates

- `pnpm exec tsc --noEmit`: **PASS** — no errors
- `pnpm test`: **PASS** — 219/219 tests
- `pnpm build:only`: **PASS** — all routes compiled, no new warnings

### Outputs

- `src/lib/ledger-queries.ts` — `PendingApprovalRow` type + `getPendingApprovals()` rewritten with `leftJoin(ledgerFunds, ...).leftJoin(users, ...)`. Confirmed `users.name` (not `firstName`/`lastName`).
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx` — Fund column now renders `txn.fundName`; Recorded-by column renders `txn.recorderName ?? "—"`.
- `src/lib/receipt-storage/index.ts` — Production `console.warn` added for missing `BLOB_READ_WRITE_TOKEN`.
- `.env.example` — `BLOB_READ_WRITE_TOKEN=` entry added with deploy guidance comment.

### Open questions / handoff notes

- **Next agent: analyst** for Phase 6 re-confirmation — FU-5 and FU-6 are both resolved; the analyst may wish to issue a final SHIP IT against the original SHIP WITH NOTES.
- FU-4 (`disbApprovalThresholdCents` settings UI) remains deferred to inc3.
- The deployment-engineer must add `BLOB_READ_WRITE_TOKEN` to the Vercel project environment variables before the first production receipt is submitted.

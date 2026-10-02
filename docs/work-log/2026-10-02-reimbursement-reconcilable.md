# Paid Reimbursements Must Be Reconcilable and Correctable (B-108) — Work Log

> **Slug:** `2026-10-02-reimbursement-reconcilable`
> **Surface:** (dashboard) admin — The Ledger: `/admin/ledger/reimbursements` (Mark Paid dialog, Paid tab), the fund register `/admin/ledger/[fundSlug]` (row actions and lock labels), the reconciliation matching grid and its create-from-bank-line dialog, `/admin/ledger/compliance` (Recent corrections)
> **Permission(s):** existing `FEATURES.LEDGER_RECORD` for pay, repair and ordinary corrections; existing `FEATURES.LEDGER_MANAGE` for the reconciled / prior-fiscal-year tier (same tier rule as Move). No new key.
> **Estimated complexity:** medium (one route change, one new audited route, one reader widening, three UI touch-points; no schema change expected)
> **Pipeline mode:** Full (Phase 2 brief, not skipped; see Phase 1 notes)

Second item of the "next year's treasurer never needs SQL" goal, agreed with the treasurer 2026-10-02 (B-111 is first). Source: `docs/reviews/2026-10-01-treasurer-self-sufficiency.md` NEW-1, rows M10, M17, R3, R4.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-02 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-02 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named (api-developer then ux-developer) | 2026-10-02 |
| 4 — Implementation | api-developer, then ux-developer (no database-admin step) | Complete (server + UI) | — | 2026-10-02 |
| 5 — Verification | qa | Complete | PASS | 2026-10-02 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-02 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer who pays a member by check today produces a ledger row the bank reconciliation can never see and nobody below `admin`-plus-SQL can fix; the fix is to capture the bank account and check number at pay time, give existing and future rows an audited, narrow way to be repaired or corrected without touching the approved-row lock itself, and stop "create from bank line" from silently double-booking the same payment.

## Verified Against the Code (Pass 0)

Read, not assumed. No database was queried (the production "verify first" query is being run separately; this review is designed for both outcomes).

- **Pay route** (`src/app/api/admin/ledger/reimbursements/[id]/route.ts`): inserts the expense with `entityId` (from the fund), `fundId`, `txnDate`, `flow='expense'`, `amountCents`, `categoryId`, `party` (member name), `memo` (`note ?? description`), `beneficiaryCause`, `budgetLineId`, `paymentMethod`, `status='posted'`, the DECISION-106 stamp (`approvedByUserId`/`approvedAt`, `boardMinute` null), `recordedByUserId`. **No `bankAccountId`, no `checkNumber`.** Accepted methods are `check | cash | other` only.
- **Pay dialog** (`pay-reimbursement-dialog.tsx`): no bank-account field and no check-number field. Its "Note" input has the placeholder "Check number, reference, etc." but the server writes the note into `memo` **in place of** the member's description (`note ?? reimb.description`), so a treasurer who followed the placeholder has replaced the register description with a check number.
- **Match candidates** (`getCandidateTransactionsForMatching`) filter `bank_account_id = session account`, `status='posted'`, `reconciled=false`, no existing match. The `/match` route rejects a transaction whose account differs from the session's and re-checks it under a row lock (B-105). A NULL-account row can never be matched.
- **Edit path closed:** `PATCH /transactions/[id]` returns 403 on `approvedAt` **before parsing the body**; DELETE and `/split` carry the same guard. DECISION-099 item 4 says in terms that the `approvedAt` guard stays unconditional and is deliberately kept separate from the reconciled-session carve-out. The register's Edit and Delete buttons are disabled with `LOCK_COPY.approved`: "Approved transactions cannot be edited. Record a refund entry to correct one." That advice is wrong for a reimbursement (see Gap 7).
- **The "create from bank line" duplicate risk is real:** `create-from-bank-line/route.ts` inserts a new posted row and a match, takes date/amount/account from the bank line, and has no awareness of reimbursements (grep for "reimburs" is empty).
- **Tie-out arithmetic is bank-line-driven** (`getTieOutAssembly`: matched in-period bank-line amounts vs unmatched in-period lines). It never reads a book row's `bank_account_id` or `category_id`. Setting a bank account or check number on an **unmatched, unreconciled** row therefore cannot move any session's numbers, open or closed. Same property DECISION-099 relied on. It does change that account's live book balance and the Overview "uncashed checks" list, which is the point.
- **Reimbursement-derived is derivable today** without a marker: `ledger_reimbursements.ledger_transaction_id` -> `ledger_transactions.id` (FK, `ON DELETE SET NULL`, no unique index). A server-side `EXISTS (... status='paid')` join identifies the row; the client must never supply that fact. This is a narrow answer to B-85's symptom without a new column.
- **Repair path today** (`scripts/backfill-bank-account.ts`): raw SQL for **every** posted row in an entity with `bank_account_id IS NULL`, one account for all of them (explicit name, sole account, or `is_default`), no audit row, no lock awareness (it bypasses `approvedAt`), no reconciled check. The UI replaces only the reimbursement-derived slice of that; it is not a general replacement and the script stays.
- **Reusable machinery:** `recordLedgerAudit(tx, ...)` and the typed action vocabulary in `ledger-correction.ts` (`CORRECTION_AUDIT_ACTIONS`, serialize/parse helpers, `parseAuditDetails`); `getRecentLedgerCorrections()` (entity filter applied in JS after parsing, 90-day window, 200 fetch cap, 25 display cap) feeding `<RecentCorrections>` on `/admin/ledger/compliance`; `validateBankAccountForEntity(db, id, entityId, { requireActive })`; `findDuplicateCandidates()` in `ledger-fund-move-preview.ts` (30-day window, cap 5, advisory, **income-only and entity-scoped today**); `requiredMoveTier()` / `isTransactionReconciled()` in `ledger-transaction-lock.ts`; the transaction form's default-bank-account preselect (`bankAccounts.find(a => a.isDefault)`).

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.record`) | Opens a submitted reimbursement and chooses fund, category, budget line, date, method, **bank account**, **check number**, optional note, then Mark Paid | per reimbursement |
| Admin (`ledger.record`) | Adds the missing bank account (and optionally check number) to an already-paid reimbursement's ledger row | one-time per legacy row; rare after the fix |
| Admin (`ledger.record`) | Corrects a paid reimbursement's category, budget line, date, payment method, check number, memo, or wrong bank account, giving a reason | rare |
| Admin (`ledger.record`) | In reconciliation, matches the bank's check line to the paid reimbursement row | monthly |
| Admin (`ledger.record`) | In reconciliation, "creates from bank line" for a debit the books already hold, and is warned | rare, but this is the trap |
| Admin (`ledger.manage`) | Does any of the above on a reconciled or prior-fiscal-year row | rare |
| Admin (`ledger.view`+) | Reads the repair/correction under Recent corrections | per review |
| Signed-in member, member with no usable role, anonymous visitor | None. Members still see only their own request status; nothing about account, check number or corrections is member-visible. | n/a |

## Flows

**Flow 1 — Pay a reimbursement (preventive).** `/admin/ledger/reimbursements` (Awaiting tab) -> Mark Paid -> fund -> category -> (budget line) -> payment date -> method -> **bank account** (new, required; list filtered to the selected fund's entity, active accounts only; entity default preselected, or the sole account if there is one; re-evaluated when the fund changes entity) -> **check number** (new; shown when method is Check; optional; 20-char cap; placeholder "e.g., 8249") -> note (relabelled so it no longer invites a check number) -> Mark Paid. Server requires and validates the account (belongs to the fund's entity, active) and writes `bankAccountId` and `checkNumber` into the same insert as today. Outcome: toast "Reimbursement marked paid. Expense posted to the ledger." The row appears on the Paid tab with account and check number, and is a match candidate in any open session for that account.
- Failure: the fund's entity has no active bank account -> field replaced by a blocking message ("Add a bank account for this entity in Ledger settings before paying") and Mark Paid disabled; invalid, inactive or other-entity account -> 400 shown inline/toast with a human sentence; stale-edit and already-paid 409s are unchanged; network/DB failure keeps the existing "Could not mark reimbursement paid. Please try again."

**Flow 2 — Repair a paid-reimbursement row that has no bank account (corrective).** Three entry points to one dialog: (a) the register row's lock label (Flow 4); (b) a "Needs bank account" badge on the Paid tab; (c) the reconciliation surfaces (see Guardrail G). Dialog: summary of the entry (member, amount, date, memo), bank account select (entity-scoped, active, default preselected; **from the reconciliation context the session's account is preselected**), optional check number, optional note, Save. Outcome: toast "Added to <account>. It can now be matched in reconciliation."; the row stays approved-and-locked for everything else; one audit row appears under Recent corrections ("Bank account added" with the account name, and check number if given). Fill-null only; no typed reason required (additive and arithmetic-neutral), the audit row records a fixed reason.
- Failure: the row is matched, reconciled (either mark) or in a closed session -> refused with the specific reason and what to do ("Unmatch it first" / "Reopen the session"); someone else filled the account first (atomic `WHERE bank_account_id IS NULL`) -> 409 "already has a bank account", dialog closes and the page refreshes; account from another entity or inactive -> 400; not a paid-reimbursement row -> refused; the caller is the reimbursement's own submitter -> 403; no `ledger.record` -> 403.

**Flow 3 — Correct a paid reimbursement afterwards (recommendation: audited edit, not an offsetting entry).** Entry: the register row's "Correct" action (replaces the disabled Edit on these rows). Dialog shows only the fields that may change: category, budget line, payment date, payment method, check number, memo, bank account; plus a required reason (10-500 chars, same field as Move/Delete). Amount, flow, fund, party, status, receipt and the approval stamp are not offered and are rejected by the server if sent. Outcome: change saved, one audit row (before/after of the changed fields only, reason), visible under Recent corrections.
- Failure: stale (row changed since opened) -> 409 with refresh; matched/reconciled row asked to change **bank account or date** -> refused (those two are the only fields the tie-out and matching depend on); a reconciled or prior-fiscal-year row asked to change anything -> requires `ledger.manage`, otherwise 403 with "Ask someone with Ledger management access"; budget-line link no longer valid for the new date/category -> same auto-clear-with-toast behaviour the edit form has (`budgetLineLinkCleared`).
- **Why not an offsetting entry (my recommendation):** DECISION-110 item 5 already rejected reversal pairs because they double every income and expense sum (990 revenue, impact giving, aged-fund trailing income, member statements); an expense can only be "offset" by an *income* row, which would land in revenue and giving views and misstate them; and the lock copy tells the treasurer to do exactly that. The classification fields involved are not read by any tie-out. Keep "record a refund entry" only for the one case it fits, a wrong **amount** (the member repaid something), which stays out of scope.

**Flow 4 — What the register shows.** For a row with a paid reimbursement linked: the lock label reads "Paid reimbursement" (not "Approved"), with next-step copy that fits: *"Paid reimbursements can't be edited or deleted. Use Correct for category, date or method."* If the row has no bank account and is unmatched/unreconciled, a second line reads "No bank account — can't be reconciled yet." with an **Add bank account** button (Flow 2). Delete stays disabled with accurate copy. A paid-reimbursement row is not "Edit"-able through the normal form, so Edit is replaced by Correct, not merely enabled. Paid tab: show account and check number per row, and the "Needs bank account" badge where applicable. Mobile (360px): both dialogs use the existing Radix Dialog sizing, buttons `rounded-lg`, 44px tap targets; the lock label already wraps.

**Guardrail G — "Create from bank line" must not double-book (reuse the duplicate-candidate advisory).** When the treasurer opens create-from-bank-line on a **debit** line, the dialog loads advisory candidates: posted **expense** rows on the same entity, same amount, within the existing 30-day window, that are reimbursement-derived and not matched/reconciled, and either have **no bank account** or sit on the session's account. Copy, using the same shape as `duplicateCandidateWarning`: "A paid reimbursement of $X on <date> to <member> may already record this payment. Creating a new entry would count it twice." Primary action **Use that entry instead** (for a no-account row: opens the Flow 2 dialog with the session's account preselected, then it appears in the match picker; for a row on the session's account: closes and opens the match picker filtered to it). Secondary **Create anyway** requires an explicit checkbox/confirm and the server accepts it as an acknowledged flag (warn-and-confirm, never a silent hard block, matching the move preview's "advisory, never blocks"). Where a check slip/number is on the bank line and the candidate, say so ("check numbers match") as a stronger hint. Separately, in the match picker, when a debit line has zero candidates and a no-account paid-reimbursement row of the same amount exists, show one line pointing at it (discoverability; the reconciliation screen is where the treasurer will notice the problem).

## Permissions

- **Existing keys cover this.** `ledger.record` for pay (unchanged), repair, and ordinary correction. `ledger.manage` for a correction on a **reconciled** or **prior-fiscal-year** row, using the existing `requiredMoveTier()` rule so Move and Correct tier identically. No new key: DECISION-106 item 1 already rejected a narrower key for reimbursement actions as a side door.
- **Default roles:** unchanged (`ledger.record`: admin, treasurer, others per current bindings; `ledger.manage`: admin only today).
- **Dependency on B-111** (written concurrently by another analyst): the `ledger.manage` tier is unusable by a non-admin treasurer until B-111 binds or splits that key. The fill-null repair and every unreconciled current-year correction work with `ledger.record` alone, which is what the successor treasurer holds, so B-108 is **not** blocked on B-111; only the settled-period tier is.
- **Self-action rule carried over:** the submitter of a reimbursement may not pay or reject it (`isOwnReimbursementRequest`, user id OR member id). Apply the same rule to repair and correction of that reimbursement's row (Gap 6).
- **Enforcement points:** every new route calls `auth()` + `hasFeature()` in its own body (the admin-page gate test and the proxy derive from `ADMIN_NAVIGATION`; no nav change is expected). Order of checks should follow the pay route: auth -> permission (before the row read, no 404-vs-403 oracle) -> row -> state -> self-action -> body.

## Adversarial Pass (Pass 5)

- **Redirects:** none; no URL parameter is user-controlled by this feature.
- **State-machine shortcuts:** the reimbursement-derived fact, the null/unmatched/unreconciled state and the tier must all be computed **server-side inside the write transaction** under `SELECT ... FOR UPDATE` (the Move/Delete pattern), not trusted from the client or from the page that rendered the button. A concurrent `/match` and a concurrent repair must serialize (`/match` already re-checks the account under lock). Fill-null uses an atomic `WHERE bank_account_id IS NULL ... RETURNING`.
- **Mass assignment:** the body is an allowlist (exact key set per operation, fail-closed like `isWithinReconciledLockCarveout`), so `fundId`, `amountCents`, `flow`, `status`, `approvedAt`, `reconciled` and a typo'd key are all 400 by construction, not by a denylist someone must remember to extend.
- **Cross-entity account:** a bank account id from the other entity (Foundation vs Club) must be refused; reuse `validateBankAccountForEntity`.
- **Enumeration:** a non-reimbursement approved row hit directly gets a uniform refusal after the permission gate; the permission check precedes the row read.
- **Input boundaries:** check number trimmed, 20-char cap, empty -> null; reason 10-500; reason text is free text and may name a person, so the existing rule stands (the audit reader is never imported from a member surface).
- **Self-targeting:** an own-request correction would let a record-holder reclassify money paid to themselves; closed by the self-action rule above.
- **Approval stamp:** none of these writes may null or change `approvedAt`/`approvedByUserId` (DECISION-106 item 3: the stamp IS the lock).

## Gaps the Request Didn't Address

1. **The approved-row lock is a protected invariant.** DECISION-099 item 4 keeps the `approvedAt` guard unconditional and separate; widening it inside the PATCH body check puts a carve-out one edit away from applying to every board-approved disbursement. *Recommendation:* leave the PATCH guard untouched and satisfy the "audited carve-out" intent with a **dedicated route** (the DECISION-109 Move shape: exact body keys, reason, same-transaction audit). Phase 2 rules on this. This is the main reason Phase 2 is required.
2. **No way to know a row is reimbursement-derived** (B-85). *Recommendation:* a server-side derived `EXISTS` join (no new column), surfaced to the register as a read-only fact. This also fixes the lock label and effectively closes B-85's "flag them in the register" ask.
3. **The pay-time fix creates a new failure mode.** Once the dialog asks for an account, a **wrong** pick (Petty Cash instead of Checking, or the wrong entity-adjacent account) is as stuck as a missing one, because fill-null cannot change it. *Recommendation:* Flow 3 includes changing the account and check number **while the row is unmatched and unreconciled** (reason required); fill-null (Flow 2) is then the reason-free special case. This also means that in the "purely preventive" outcome the work is not dead code.
4. **Duplicates may already exist, and closed sessions imply them.** Session close requires every in-period bank line to be matched, so a reimbursement check that cleared in a closed period was necessarily matched to *something*, most likely a row created from the bank line, leaving the original null-account reimbursement row as an unmatched, locked orphan counted twice in reports. The repair dialog shows the same duplicate advisory (an expense of the same amount within 30 days that is matched/reconciled) so the treasurer sees it. The UI does **not** offer to delete the orphan (the reimbursement would be left "paid" with a dangling link). *Recommendation:* if the verify query finds such pairs, resolve the handful by a reviewed one-off data fix before handover (not by building UI); the standing manual unwind (reopen session, unmatch, delete the bank-line row with a reason under DECISION-110, repair the reimbursement row, rematch) goes into the Treasury User's Guide.
3a. **Verify-query scope.** Beyond the two counts in the backlog, also count **all** `approved_at IS NOT NULL AND bank_account_id IS NULL` rows (reimbursement-linked or not) and all null-account `posted` rows, plus whether any of the null-account reimbursement rows fall in a closed session's period. If non-reimbursement approved rows turn up, the carve-out stays reimbursement-only and those go to the script; do not widen scope silently.
4. **Reconciled or prior-year settled-period corrections.** Category/memo/method edits cannot move a session's arithmetic but change reported totals and possibly an already-sent monthly statement. *Recommendation:* reuse the tier and warnings (`requiredMoveTier`, sent-statement and reports-change warnings) rather than invent a second policy; date and bank account stay refused once matched or reconciled.
5. **Date correction.** Budget-line links are fiscal-year bound. *Recommendation:* allow a date change only within the same fiscal year while unmatched/unreconciled; a cross-year date is the `ledger.manage` tier.
6. **Self-correction** (Adversarial Pass). Apply `isOwnReimbursementRequest` to repair and correct.
7. **Lock copy gives wrong advice.** "Record a refund entry" for an expense routes the treasurer into an income row. New copy per Flow 4; the lock classifier needs the reimbursement fact (`LockableRow` and the exhaustive `LOCK_COPY` record both change, a compile-time-enforced touch point).
8. **"Note" overwrites the description.** Existing rows may carry a check number in `memo`. Relabel the field ("Note for the register (replaces the member's description)") or stop overwriting; do not auto-migrate memos. *Recommendation:* relabel only; the check-number field now exists.
9. **Cash and petty cash.** A preselected default (Checking) is the wrong account for a cash reimbursement. *Recommendation:* preselect the default but show "Choose the account the money came out of" and rely on Flow 3 for a wrong pick; if the treasurer prefers, no preselect when method is Cash.
10. **Entity with no active bank account** blocks pay (Flow 1 failure); where accounts are managed and by whom is a B-111 matter.
11. **Recent corrections reader widening.** DECISION-110 item 3 scopes it to "moves and deletes". It gains a third kind (reimbursement row corrected: bank account added/changed, fields changed). `LedgerCorrectionRow.kind`, the entity filter on the payload, `CORRECTION_AUDIT_ACTIONS` and `<RecentCorrections>` copy all change; the 90-day window means an old repair eventually leaves the on-screen list (the audit row is retained).
12. **Duplication (CLAUDE.md rule):** `normalizeCheckNumber` and `CHECK_NUMBER_MAX_LEN` already exist twice (transactions PATCH, create-from-bank-line); the pay route would be a third, and a new correction route a fourth. Phase 3 should consolidate into `ledger-transaction-validation.ts` instead of copying. `findDuplicateCandidates` must be generalized (flow, reimbursement filter, null-account case) rather than forked.
13. **Reconcile toggle (legacy per-row mark).** A null-account row marked reconciled by the legacy toggle is "reconciled" for the repair guard; refuse it like a closed-session row.
14. **Email, Google Group sync, OAuth-vs-password, access-pending:** not touched. No new email is sent (the existing "paid" email to the member stays as is). Brand: dialogs follow the existing pattern (`rounded-2xl` panel, `rounded-lg` buttons, `lions-blue`); nothing here is destructive so no `ConfirmDialog`, but "Create anyway" needs an explicit confirm control, not `window.confirm`.
15. **Empty states:** no unrepaired rows -> no badge, no banner; Recent corrections keeps its existing empty state; entity with no reimbursement-derived rows shows nothing new.

## Design for Both Verify Outcomes

| | Rows exist with no bank account (and maybe duplicates) | Purely preventive (none exist) |
|---|---|---|
| Flow 1 (pay captures account + check #) | Build | Build |
| Flow 2 (fill-null repair + badge + discovery hints) | Build | **Drop as separate UI**; it is subsumed by Flow 3's account change |
| Flow 3 (audited correction) | Build | Build (wrong-account-at-pay is now the live failure; R3 is still unsolved) |
| Guardrail G | Build (null-account and session-account candidates; inline repair) | Build the session-account variant only (a paid row sits there unmatched and the treasurer creates a duplicate anyway) |
| Existing data | One-off reviewed fix for duplicate pairs; if more than ~10 rows lack an account, add a single multi-select "assign account" action instead of N dialogs | None |
| `backfill-bank-account.ts` | Keep; header notes "reimbursement rows: use the UI" | Keep unchanged |

## Out of Scope (confirm with user)

- Correcting a paid reimbursement's **amount** or **fund** (needs a refund/offsetting entry or a new reimbursement; fund correction on an expense row is a separate Move-style decision).
- Voiding or reissuing a lost or stale reimbursement check (audit row M17): a reimbursement cannot return from `paid` today. Worth its own backlog item.
- A reverse-marker **column** on `ledger_transactions` (B-85); the derived join is enough for this item.
- Auto-matching reconciliation lines to rows by check number.
- Adding the check number to the member's "paid" email.
- Adding Zelle/ACH/bill-pay to the reimbursement payment methods (`other` covers them).
- Retiring the backfill script (it still serves non-reimbursement rows).
- Bulk-correcting memos that contain check numbers.

## Open Questions

Recommended defaults are stated so the pipeline need not stall (project preference: adopt the recommendation unless told otherwise); items 1 and 4 are real club facts or role policy.

1. **Production verify results** (being run by the requester): (a) null-account reimbursement-linked rows and how many cleared in a closed session's period; (b) bank-line-created expenses duplicating a reimbursement; (c) all approved-with-null-account rows (Gap 3a). These pick the column in the table above.
2. Is the check number **required** when the method is Check? *Recommend optional*: the check may not be written yet, and the correction path exists.
3. Cash reimbursements: preselect the entity default account, or force an explicit choice? *Recommend preselect with helper copy.*
4. Should the settled-period tier (reconciled or prior-fiscal-year corrections) require `ledger.manage` as for Move? *Recommend yes;* it depends on how B-111 resolves for the `treasurer` role.
5. Create-from-bank-line duplicate: warn-and-confirm, or hard block? *Recommend warn-and-confirm* (consistent with the advisory elsewhere; a hard block strands a legitimate separate payment of the same amount).
6. Should a date correction be offered at all? *Recommend yes, same fiscal year and unmatched only.*

---

# Phase 2 — Architectural Review (architect)

**Required, brief.** This touches the approved-row lock invariant (DECISION-099 item 4, DECISION-106 item 3, DECISION-036 item 4), widens the DECISION-110 audit reader, and adds a new audited write path. Questions for the architect:

1. Dedicated audited route (recommended) vs a new carve-out inside the PATCH `approvedAt` guard. Confirm the PATCH guard stays unconditional.
2. Reimbursement-derived determined by a server-side `EXISTS` join; confirm no marker column and that B-85 is narrowed.
3. Whether the new action(s) join `CORRECTION_AUDIT_ACTIONS`, how `LedgerCorrectionRow.kind` widens, and the payload version.
4. Home for the consolidated check-number normalizer and the generalized duplicate-candidate finder (duplication rule).
5. Whether this needs a new DECISION amending 099/106/110 (expected: yes, one entry).
6. The durable-claim exception does **not** apply (no sent-claim is written); record that explicitly.

---

## Phase 2 Ruling (architect, 2026-10-02)

**Verdict: Approved with suggestions.** Read against the code (not only the Phase 1 text): `ledger-correction.ts`, `ledger-audit.ts`, `ledger-transaction-lock.ts`, `ledger-fund-move-preview.ts`, the move route, `getTieOutAssembly`, the pay route and `ledgerReimbursements` schema, and DECISION-099/106/109/110. No schema change, no new `FEATURES` key, no nav change (so the proxy and the admin-page gate test are untouched), no new dependency, no new top-level directory. Production facts are consistent with the plan: two null-account rows, unreconciled, not in a closed session, no duplicates, so the repair UI is the whole remedy and no one-off data fix is needed. Phase 3 should still add the all-rows null-account count the requester is running.

### Rulings on the nine questions

**1. Dedicated audited route. Confirmed; the PATCH guard stays unconditional.** `PATCH`/`DELETE`/`split` keep their `approvedAt` 403 before body parse, textually separate from the reconciled-session guard, exactly as DECISION-099 item 4 requires. The new write path is `POST /api/admin/ledger/transactions/[id]/correct` (GET on the same file for the dialog preview), the DECISION-109 Move shape, with these constraints:
- Gate order: `auth()` -> `hasFeature(LEDGER_RECORD)` (before any row read, no 404-vs-403 oracle) -> `isUuid` -> body parse (exact-key allowlist, fail-closed, before any DB read) -> inside one `db.transaction`: `SELECT ... FOR UPDATE` the row -> derive everything from the locked row.
- **Explicit discriminator, not inference.** Body carries `operation: "fill_bank_account" | "correct"`, each with its own exact key set (`fill_bank_account`: `operation`, `bankAccountId`, optional `checkNumber`, `expectedUpdatedAt`; `correct`: `operation`, `reason`, `expectedUpdatedAt` and any subset of the seven editable fields, at least one). Inferring the mode from which keys happen to be present would let a reason-less body reach the general path. Unknown keys (`fundId`, `amountCents`, `flow`, `status`, `approvedAt`, `reconciled`, a typo) are 400 by construction.
- **Eligibility is a closed set.** One server-derived classifier, `correctableRowKind(row, exists-join) -> "paid_reimbursement" | null`. Any other row (including other approved rows and ordinary unlocked posted rows, which belong to PATCH) is a uniform 403 `not_correctable` after the permission gate. A second eligible kind later is a new arm plus a new DECISION, never a body flag. The route must not be reachable for a non-reimbursement approved row; that is the property that keeps this a narrow carve-out rather than an approved-row edit door.
- The approval stamp (`approvedAt`, `approvedByUserId`, `boardMinute`) is never in the allowlist and never written (DECISION-106 item 3). The UPDATE sets only the allowlisted columns plus `updatedAt`.
- One evaluator serves GET preview and POST execute (DECISION-111 item 1), so the dialog's "allowed / tier / warnings" and the write cannot drift.
- Fill-null UPDATE is atomic and pinned: `WHERE id = $id AND bank_account_id IS NULL AND status = 'posted' AND reconciled = false AND reconciled_session_id IS NULL AND NOT EXISTS (match)` `RETURNING id`; zero rows is 409 `already_has_bank_account` (or the specific state refusal re-read under the lock). The match check is made post-lock on the same handle; a concurrent `/match` insert takes a key-share lock on the row that conflicts with `FOR UPDATE`, so repair-then-match and match-then-repair serialize (same property `loadOpenMatch` documents).
- Stale token: compare `expectedUpdatedAt` in application code, never SQL timestamp equality (DECISION-106 item 4: microsecond vs millisecond).
- Self-action: load the linked reimbursement inside the transaction and apply `isOwnReimbursementRequest` (user id OR member id) to both operations; refuse 403 `own_request`. Same order as the pay route: auth, permission, row, state, self-action, then body-dependent checks.
- `fill_bank_account` is exempt from the permission tier: by precondition the row is unreconciled and unmatched, so the only tier reason that could apply is `prior_fiscal_year`, and a bank-account fill changes no reported figure (it changes that account's live book balance and reconciliation eligibility only). It needs `ledger.record` and nothing more, so the successor treasurer can clear a legacy prior-year null-account row without B-111. It still writes an audit row.
- Where the guard is not unconditional: the carve-out applies to nothing else. State this in the route header comment with the DECISION-099 item 4 pointer, so a future editor sees why PATCH was not touched.

**2. Derive, do not mark. Confirmed; B-85 is narrowed, not closed.** Reimbursement-derived is `EXISTS (SELECT 1 FROM ledger_reimbursements r WHERE r.ledger_transaction_id = t.id AND r.status = 'paid')`, evaluated server-side. The pay route writes the link in the same transaction as the insert (verified), so the join is trustworthy for every row the current code produced. No marker column. Surface it to the register as a read-only fact on the row view-model (`paidReimbursement: boolean`), never as client input. B-85 keeps its remaining scope (flagging in other surfaces and any non-register consumer); update its wording, do not close it. Optional hardening, not required: the FK has no unique index and is `ON DELETE SET NULL`; see B-129 below.

**3. Reader widening: yes, a safe amendment to DECISION-110 item 3.** Item 3 bounded the reader to "moves and deletes only ... no wider than that page's existing gate". Adding a third kind keeps both bounds (same page, same gate, still window- and cap-bounded), so it is an amendment of one clause, not a reversal. Shape:
- **One new action, `transaction_corrected`**, not two. "Bank account added" is `operation: "fill_bank_account"` in the payload, not a separate action; two actions would double the reader's branches for no new information.
- Added to `CorrectionAuditAction` and `CORRECTION_AUDIT_ACTIONS`; the reader's `inArray` picks it up. Own payload version space `v: 1` (`CORRECTED_VERSIONS = [1]`), so moved/deleted versioning is untouched. `before`/`after` carry only the changed fields, each self-describing (category `{id,name}`, bank account `{id,name}`, budget line id, scalar strings), so a record reads correctly after a rename. `details`: `v`, `operation`, `reason` (a fixed constant string for `fill_bank_account`; typed 10-500 chars for `correct`), `entityId` (the reader's entity filter, same JS-side filtering as DECISION-111 item 6), `reimbursementId` (id only, no member name), `txnDate`, `amountCents`, `flow`, `fiscalYear`, `tier`, `reconciled`, `reconciledSessionId`, `priorFiscalYear`, `sentStatementMonth`.
- `LedgerCorrectionRow.kind` becomes `"moved" | "deleted" | "corrected"`, plus an optional pre-composed `changes: string[]` display list (server composes labels, UI renders as given). `<RecentCorrections>` switches exhaustively with a `never` check so a fourth kind is a compile error. `settledPeriod` keeps its existing definition.
- `AuditPayloadFor<A>` is a nested conditional with two arms; a third arm tips it into unreadability. Replace with an `AuditPayloadMap` interface keyed by action (behavior-identical, compile-checked) as part of this change.
- `schema.ts` gets a comment-only update listing the new action value, as DECISION-110 did.
- The member-surface firewall is unchanged and the new files inherit it; extend the existing firewall test's file list to the two new modules if they import audit text (the queries module does, via `ledger-audit`).

**4. Duplication homes.**
- **Check number: five copies, not three.** There are already three (`transactions/route.ts` POST, `transactions/[id]/route.ts` PATCH, `create-from-bank-line/route.ts`); the pay route and the new correct route would make five. Consolidate in this change into **`src/lib/ledger.ts`** (`CHECK_NUMBER_MAX_LEN`, `normalizeCheckNumber`): it is the existing pure, client-safe home for ledger field rules (DECISION-099 item 3 precedent), and the pay and correct dialogs need the max length on the client. Do **not** use `ledger-transaction-validation.ts` as Phase 1 suggested: it imports the Drizzle schema at runtime and must not enter a client bundle. Migrate all three existing call sites in the same change, with a table test pinning the existing behavior (trim, empty to null, 20-char cap, non-string error) so the migration is provably behavior-identical.
- **Reimbursement payment methods.** The `check | cash | other` set is accepted in the pay route and will be needed by the correct route and both dialogs. Define one `REIMBURSEMENT_PAYMENT_METHODS` constant in `ledger.ts` and use it in all four.
- **Default-bank-account preselection.** The transaction form, and now the pay dialog, the repair/correct dialog and the create-from-bank-line guardrail, all pick a default account. One pure helper (`pickDefaultBankAccount(accounts)`: sole active account, else `isDefault`, else none) and one shared account-select, not four inline `find(a => a.isDefault)`.
- **Duplicate-candidate finder: generalize in place, do not fork.** Extract the query body of `findDuplicateCandidates` into one parameterized function (`flow`, entity, amount, date window, optional `reimbursementDerivedOnly`, optional `bankAccountId` or null-account filter) in a neutral module, **`src/lib/ledger-duplicate-candidates.ts`**; `ledger-fund-move-preview.ts` keeps `findDuplicateCandidates` as a thin wrapper that pins `flow='income'` and the destination entity so the cross-entity move behavior and its tests are unchanged. The result is a superset row type (adds `reimbursementId`, `checkNumber`, `ownRequest`); `MoveDuplicateCandidate` stays a `Pick` of it. The finder must not import `ledger-audit`.
- **New files, by role** (do not grow `ledger-correction.ts`, already ~900 lines): `src/lib/ledger-reimbursement-correction.ts` (pure, client-safe: body parsers, error codes, field allowlist, copy, eligibility types) and `src/lib/ledger-reimbursement-correction-queries.ts` (server: evaluator, preview, execute). The audit vocabulary for the new action (constant, payload types, parse overloads) stays in `ledger-correction.ts` next to its siblings because `ledger-audit.ts` and the parse helpers already live there.

**5. Flow 3 scope: confirmed, with four architectural conditions.** Editable set: category, budget line, payment date, payment method, check number, memo, bank account (date and bank account only while unmatched and unreconciled). Amount, flow, fund, party, status, receipt, `beneficiaryCause` and the stamp are out and 400 if sent. Fund correction on a paid reimbursement stays out of scope (`moveBlockKind` keeps refusing approved rows; do not touch it). Conditions:
- **Tier** uses `requiredMoveTier(row, now)` unchanged (reconciled by either mark, or prior fiscal year, needs `ledger.manage`), computed on the locked row. Because bank account and date are refused once matched/reconciled, the reconciled tier can only ever apply to category, budget line, method, check number, memo, which none of `getTieOutAssembly`/`computeTieOut` read (verified: it is driven by bank-line amounts and match presence only; `checkNumber` appears only in the match-candidate display query).
- **Reports and statements.** A category or date change restates reported totals. Reuse `findSentStatementMonth` and the existing `sentStatementWarning` / `reportsChangeWarning` copy as warnings. **A date change touches two months** (old and new): check both. Note the monthly statement only appears once every posted row on or before month-end is reconciled, so moving an unreconciled row to an earlier date can newly hide a published month. Phase 3 must decide warn vs refuse for that case; same-fiscal-year-only (Phase 1 Gap 5) stays.
- **Budget-line link** validity under a changed date or category: reuse the PATCH route's auto-clear-with-flag behavior (`budgetLineLinkCleared`); do not write a second rule.
- **Category** validated with `validateCategoryForFund` and bank account with `validateBankAccountForEntity(..., { requireActive: true })` against the row's entity; both are in the existing shared module.

**6. Self-action rule: confirmed for both operations,** as specified in ruling 1. The advisory in the create-from-bank-line dialog still shows a candidate that is the caller's own request (it is information), but its "Use that entry instead" action is disabled with the reason; "Create anyway" is unaffected because it mutates no reimbursement.

**7. Create-from-bank-line guardrail: generalize, warn-and-confirm, and make the server the authority.** The finder generalization is ruling 4. The one architectural addition to Phase 1: a client-only warning is bypassable by a stale dialog or a direct API call, so the route itself must enforce it. When the line is a debit and candidates exist, `create-from-bank-line` returns 409 `possible_duplicate` with the candidates unless the body carries `acknowledgeDuplicate: true`. It is advisory in the DECISION-113 sense (acknowledged, never a hard block), but the acknowledgment is server-checked, not a UI nicety. The advisory re-query runs in the route before the insert; it needs no lock (it is advisory, and the later `/match` and unique-match constraints still protect the books). "Use that entry instead" for a null-account row opens the repair dialog with the session's account preselected; for a session-account row it opens the match picker filtered to it.

**8. Pay dialog.** Capture `bankAccountId` (required, server-validated active and of the fund's entity inside the pay transaction) and optional `checkNumber` through the shared normalizer, written in the same insert. A body from a stale open dialog without `bankAccountId` is a 400 with a human sentence. Preselect via the shared helper; re-evaluate on fund change (entity may change). The Note/memo overwrite: architecturally neutral, so my recommendation is to fix the root cause rather than relabel: pre-fill the field with the member's description and label it "Register description" so what is shown is what is written, and the check number has its own field. No migration of existing memos.

**9. One new DECISION, DECISION-114, amends DECISION-099, 106 and 110.** Draft below. **The durable-claim exception does not apply:** nothing here writes a "this was sent" claim (no `sentAt`, no unique success row, no append-only sent history), no email is sent, and `sendEmail()` is not called; the audit row is a record of a correction, not a delivery claim. DECISION-102/103 are not engaged; Phase 3 need not name a revert outcome.

### Invariants checklist

| Invariant | Result |
|-----------|--------|
| Permissions-only gating | Pass. Existing keys; tier derived server-side from the locked row. No flag, no new key. |
| Closed-session arithmetic unchanged | Pass. Tie-out is bank-line driven; bank account/date refused once matched/reconciled; remaining editable fields are not read by any tie-out. |
| Approved-row lock (DECISION-099 item 4, 106 item 3, 036 item 4) | Pass if PATCH/DELETE/split are untouched and the new route is closed-set + allowlist + stamp-preserving. |
| Schema is the source of truth | Pass. No table or column change; comment-only `schema.ts` edit. No migration. (If B-129 is taken up later, it is its own migration.) |
| Migrations idempotent | N/A (none). |
| No PII in repo | Pass. Audit payload carries ids, amounts, dates, account and category names, not member names. Tests use `example.com` fixtures. |
| Member-surface firewall | Pass; the new queries module and reader stay out of `src/app/members/**`. |
| No native dialogs | Pass; "Create anyway" is an explicit in-dialog confirm control. |
| Server/client split | Pure vocab modules are client-safe (no db/schema imports); queries modules are server-only; dialogs are client components. |
| Brand | `rounded-2xl` panels, `rounded-lg` buttons, `lions-blue`, 44px targets, no `lions-red`; "Emailed" is not relevant (no email). |
| Lock copy | `LOCK_COPY.approved` ("Record a refund entry") is wrong for an expense. Add a `paid_reimbursement` lock kind ahead of `approved` in `transactionLockKinds` precedence with the Flow 4 copy; `LockableRow` gains the derived boolean. The exhaustive `LOCK_COPY` Record makes the omission a compile error. `editLockKind` (which mirrors the PATCH guards) is unchanged; update the pin test so `paid_reimbursement` is asserted to imply `approved`. Consumers: `transaction-actions.tsx`, `ledger-fund-move-queries.ts`. |

### Suggestions for Phase 3 (not blockers)

1. Specify the evaluator's guard order for the correct route and pin it with a table test: permission, row, `not_correctable`, self-action, state (match/reconciled/stale), tier, input. Name every refusal code and status (the analyst asked for the failure outcomes of repair: matched, reconciled, already-filled, own-request).
2. Confirm `ledgerTransactions` has `updated_at` and that the correct route bumps it; the stale token depends on it.
3. Decide the earlier-date-hides-a-published-month case (ruling 5) explicitly.
4. The all-rows null-account count (requester's second query) decides whether any non-reimbursement approved row is in scope. If any exist, they stay on `scripts/backfill-bank-account.ts`; do not widen `correctableRowKind`.
5. Tests to name in the design: classifier table, allowlist table (every column rejected), atomic fill-null race (zero rows to 409), self-action for both operations, tier table, reader widening (a `corrected` row maps; an unparseable one degrades to raw), exhaustive-kind component test, `normalizeCheckNumber` behavior pin across the three migrated sites, generalized finder (income wrapper unchanged; expense + reimbursement filter; null-account case), create-from-bank-line 409 without the flag and success with it.
6. Update the Treasury User's Guide (`/admin/ledger/guide`) with the unwind procedure from Phase 1 Gap 4 and the new lock copy.

### Draft: DECISION-114 (for tech-lead or the next session to paste at the top of docs/decisions.md; not yet written there)

```
## DECISION-114: Paid reimbursements are reconcilable and correctable through a dedicated audited route; the approved-row guard stays unconditional (amends DECISION-099, 106, 110)

**Status:** Resolved
**Date:** 2026-10-02
**Amends:** DECISION-110 item 3 (reader scope), DECISION-099 item 4 (clarified, not changed), DECISION-106 item 3 (stamp unchanged).

**Decision:**
1. **Pay captures the money's location.** Mark Paid requires a bank account (active, of the fund's entity) and takes an optional
   check number, written in the same insert. A paid reimbursement previously posted an approved, locked expense with no bank
   account, which can never be a reconciliation candidate (`getCandidateTransactionsForMatching` filters on the session's account).
2. **A dedicated route, not a carve-out in PATCH.** `POST /api/admin/ledger/transactions/[id]/correct` (GET preview on the same
   route) is the only write path that touches an approved row. The PATCH/DELETE/split `approvedAt` guards remain unconditional and
   evaluated before the body is parsed (DECISION-099 item 4). The route accepts exactly two operations, each with an exact-key
   allowlist: `fill_bank_account` (fill-null only, atomic `WHERE bank_account_id IS NULL`, no typed reason, record tier) and
   `correct` (category, budget line, date, payment method, check number, memo, bank account; reason 10-500 required). Amount, flow,
   fund, party, status, receipt and the approval stamp are never writable here.
3. **Eligibility is derived, closed and server-side.** A row is correctable only if a `ledger_reimbursements` row with
   `status = 'paid'` links to it (`EXISTS` on `ledger_transaction_id`); no marker column. Every other approved row is refused
   uniformly. Widening the eligible set requires a new DECISION.
4. **Closed-session arithmetic cannot move.** Bank account and date change only while the row is unmatched and unreconciled; the
   remaining fields are read by no tie-out. The permission tier reuses `requiredMoveTier()` (reconciled or prior-fiscal-year
   needs `ledger.manage`), except `fill_bank_account`, which is record-tier (it changes no reported figure). The submitter of the
   reimbursement may not repair or correct its row (`isOwnReimbursementRequest`).
5. **Corrections, not offsetting entries.** The lock copy's "record a refund entry" advice is wrong for an expense (a reversal would
   be income and misstate revenue and giving; DECISION-110 item 5). A paid reimbursement shows a `paid_reimbursement` lock kind
   with Correct/Add-bank-account actions. A wrong amount remains a refund entry, out of scope.
6. **Audit.** One new action, `transaction_corrected`, own `v: 1` payload, written with `recordLedgerAudit(tx, ...)` in the same
   transaction. DECISION-110 item 3 widens from "moves and deletes" to "moves, deletes and corrections"; same page, same gate,
   same window and caps.
7. **Create-from-bank-line is guarded server-side.** A debit line with a candidate reimbursement-derived expense of the same amount
   within 30 days returns 409 `possible_duplicate` unless `acknowledgeDuplicate: true` (advisory, never a hard block).
   `findDuplicateCandidates` is generalized into one parameterized finder; the cross-entity move wrapper is unchanged.
8. **Not a durable-claim path.** No sent-claim is written and no email is sent; DECISION-102/103 do not apply.

**Rationale:** ... (treasurer self-sufficiency goal, 2026-10-02; the lock exists to protect a closed session's arithmetic and
board-visible finality, and none of the allowlisted writes can move either; an unconditional PATCH guard plus a closed-set route
is narrower than any in-PATCH carve-out.)

**Impact:** pay route and dialog; new correct route + two lib modules; `ledger-correction.ts` / `ledger-audit.ts` / `<RecentCorrections>`
(third kind); `ledger-transaction-lock.ts` (new lock kind); `create-from-bank-line` route + dialog; check-number normalizer
consolidated into `ledger.ts`; generalized duplicate finder; comment-only `schema.ts`. No migration, no new key.
```

### Backlog wording (next free ID B-129; nothing written to docs/backlog.md)

- **B-85 (update, do not close):** "Narrowed by B-108/DECISION-114: reimbursement-derived rows are identified by a server-side `EXISTS` join on `ledger_reimbursements.ledger_transaction_id` and shown as a `paid_reimbursement` lock kind in the register. Remaining scope: any other surface that needs the fact, and whether a marker column is ever warranted."
- **B-129 (new, low):** "Add a partial UNIQUE index on `ledger_reimbursements.ledger_transaction_id WHERE ledger_transaction_id IS NOT NULL`, so the `EXISTS` join in DECISION-114 is provably 1:1. Needs a production duplicate check first and an idempotent guarded `DO $$` migration. Not required for B-108."
- **B-130 (new):** "Void or reissue a lost or stale reimbursement check (audit row M17): a reimbursement cannot return from `paid` today. Explicitly out of scope for B-108; needs its own DECISION (reversal of an approved row, interaction with DECISION-110 item 5)."

---

# Phase 3 — Technical Design (tech-lead)

## Technical Design: Paid reimbursements are reconcilable and correctable (B-108)

### Summary

A paid reimbursement posts an approved-and-locked expense with no bank account and no check number, so it can never be a
reconciliation candidate, cannot be edited through the normal form, and invites "create from bank line", which would book
the payment twice. The fix has four parts, all inside the existing permission model with **no schema change, no migration,
no new `FEATURES` key and no nav change**: (1) Mark Paid captures the bank account (required, validated) and an optional
check number, and stops overwriting the member's description; (2) one new audited route,
`POST/GET /api/admin/ledger/transactions/[id]/correct`, is the only write path that touches an approved row, closed-set
(paid reimbursements only), exact-key allowlisted per operation (`fill_bank_account`, `correct`), with the
PATCH/DELETE/split `approvedAt` guards left textually untouched; (3) the register shows a `paid_reimbursement` lock kind
with **Correct** / **Add bank account** actions and the Recent corrections list gains a third kind; (4) create-from-bank-line
refuses to double-book unless the caller acknowledges, and its dialog offers "Use that entry instead". Production holds
exactly two affected rows (both unreconciled, unmatched, in an open session), so after deploy the treasurer repairs them
from the register in two clicks each and matches them in the open Admin September session; no data fix and no unwind.

### Rulings that differ from, or add to, Phase 1 and Phase 2 (read first)

| # | Ruling | Phase 1/2 said | Why |
|---|--------|----------------|-----|
| R1 | **Earlier date that would newly hide a month's statement: 409 `would_hide_statement`** (orchestrator decision). The same single predicate also refuses a **method change away from `check`** that would newly hide a month, because an unreconciled expense paid by check is exempt from the statement gate (`isOutstandingCheckRow`) and any other method is not. | Phase 2 left warn vs refuse open and mentioned only the date. | Same effect, same rule, no second policy. Needs the treasurer's awareness in the release note, not a decision. Flagged for the orchestrator to confirm the method extension. |
| R2 | **No typed note on `fill_bank_account`.** Its exact keys are `operation, bankAccountId, expectedUpdatedAt` plus optional `checkNumber`. | Phase 1 Flow 2 listed "optional note". | Phase 2's allowlist wins; the audit reason is a fixed constant. |
| R3 | **Phase 1 Gap 4 (duplicate advisory inside the repair dialog) is dropped.** | Phase 1 wanted the repair dialog to warn about an already-booked twin. | Production verified: zero twins. The create-from-bank-line guard (below) prevents new ones; the unwind for a closed-period twin goes into the Treasury Guide instead. |
| R4 | **Cross-fiscal-year date change is a `ledger.manage` tier reason (`fiscal_year_change`), not a refusal.** A date moved into a prior fiscal year also adds `prior_fiscal_year`. | Phase 1 Gap 5: "same fiscal year only ... cross-year is the manage tier"; Phase 2: "same-fiscal-year-only stays". | Read as Phase 1 wrote it (manage tier). Budget-link auto-clear covers the link. |
| R4b | `fill_bank_account` with a `checkNumber` when the row already has a different one: 409 `check_number_present` (new code). | Not addressed. | Fill is fill-null for both fields; overwriting belongs to `correct`. |
| R5 | **Bank account on pay is validated before the pay transaction, on `db`, beside the fund, category and budget-line validators**, not inside it. | Phase 2 ruling 8: "inside the pay transaction". | The account row is not locked either way, so reading inside the transaction buys nothing, and the existing pay-route test fake exposes only `insert`/`update` on `tx`. Same server-side guarantee (active, of the fund's entity). Easy to flip if the architect objects. |
| R6 | **A third small new lib file, `src/lib/ledger-reimbursement-link.ts`**, owns the one definition of "reimbursement-derived". | Phase 2 named two new files. | The neutral finder must not import `ledger-audit`, and the correction-queries module does; the predicate needs a home both can import. |
| R7 | `MoveDuplicateCandidate` **stays its own interface**; the thin `findDuplicateCandidates` wrapper projects the finder's superset row onto it. | Phase 2: "stays a `Pick` of it". | `ledger-correction.ts` is client-safe; a `Pick` from a server module would couple them for no gain. Behavior identical. |
| R8 | `LedgerCorrectionRow.changes` is **optional** (`changes?: string[]`); `LockableRow.paidReimbursement` is **optional**. | Phase 2: "optional pre-composed list" / "`LockableRow` gains the derived boolean". | Existing fixtures and the exhaustive record keep compiling; the only production consumer of the flag is the register. |
| R9 | **GET accepts an optional proposal** (`?txnDate=&paymentMethod=`) and runs the same evaluator on it. | Phase 2: one evaluator for GET and POST. | Lets the dialog show the sent-statement warning and the `would_hide_statement` refusal before Save, without a dry-run key in the POST allowlist. |
| R10 | `backfill-bank-account.ts` **stays**, header note only. | Phase 1: stays. | See Edge Cases. |

### Permissions

- **No new key.** `FEATURES.LEDGER_RECORD` for pay (unchanged), `fill_bank_account`, and `correct` on an unreconciled current-fiscal-year row.
  `FEATURES.LEDGER_MANAGE` for `correct` on a reconciled or prior-fiscal-year row, or one whose date moves across a fiscal-year boundary.
- **Default roles unchanged.** `ledger.record`: admin, treasurer (and any role already bound). `ledger.manage`: `admin` today. B-111 (concurrent, DECISION-115 reserved)
  decides whether `treasurer` gets `ledger.manage`; B-108 is not blocked on it, because `fill_bank_account` and every unreconciled current-year correction
  work on `ledger.record` alone. **All new `manage_required` copy names the permission, never a role** ("needs the Manage Ledger permission"), so B-111 cannot make it stale.
- **Every handler checks in its own body** (`auth()` then `hasFeature()`); no proxy or nav change, so `admin-page-feature-gates.test.ts` is untouched.
- **Self-action:** the submitter of the linked reimbursement (user id **or** member id, `isOwnReimbursementRequest`) may not fill or correct its row. Applied to every linked paid reimbursement (the link has no unique index, B-129), refused if **any** is the caller's.

### Data Model

**No schema changes required. No migration.** `src/lib/db/schema.ts` gets a comment-only edit (the `ledger_audit_log.action` list gains `transaction_corrected`).

- **`ledger_transactions.updated_at` confirmed:** `timestamp("updated_at").notNull().defaultNow()` (naive timestamp). The correct route sets `updatedAt: now` in its UPDATE. It is compared in application code (`getTime()`), never SQL equality (DECISION-106 item 4, microsecond vs millisecond). **The token is only a partial guard:** `/match`, session close and the legacy reconcile toggle do not all bump it, so correctness comes from re-deriving every state fact (match, reconciled mark, session) on the `FOR UPDATE` row, never from the token.
- **No index added.** The `EXISTS` join reads `ledger_reimbursements` (tens of rows). B-129 (partial unique index) is optional hardening, filed separately.
- **Production, after deploy (qa verifies):** `SELECT count(*) FROM ledger_transactions WHERE status='posted' AND bank_account_id IS NULL` is 0 once the treasurer has repaired the two rows, and the two bank lines in the open Admin September session are matched to them.

### API Contract

#### A. `POST` and `GET /api/admin/ledger/transactions/[id]/correct`

File header comment must say: this is the **only** write path that touches an approved row; the PATCH/DELETE/split `approvedAt` guards are intentionally unchanged and unconditional (DECISION-099 item 4, DECISION-114); a second eligible row kind is a new `correctableRowKind` arm plus a new DECISION, never a body flag.

**GET** `?txnDate=YYYY-MM-DD&paymentMethod=check|cash|other` (both optional proposal params; malformed is 400 `invalid_body`) returns 200 `CorrectionPreview`:

```ts
interface CorrectionPreview {
  transaction: { id; txnDate; amountCents; party; memo; categoryId; categoryName; budgetLineId; paymentMethod; checkNumber;
    bankAccountId; bankAccountName; fundId; fundName; fundKind; entity: { id; slug; name }; fiscalYear;
    reconciled: boolean;      // either mark
    matched: boolean;         // a ledger_reconciliation_matches row exists
    updatedAt: string };      // ISO; echoed back as expectedUpdatedAt
  callerCanManage: boolean;
  operations: {
    fill_bank_account: OperationDecision;
    correct: OperationDecision & {
      tier: { required: "record" | "manage"; reasons: CorrectionTierReason[] };
      dateAndBankEditable: boolean;                       // false while matched or reconciled
      lockedFields: { code: "reconciled_session" | "reconciled_legacy" | "matched_open_session"; message: string } | null;
    };
  };
  options: { categories: { id; name }[]; bankAccounts: { id; name; isDefault }[]; defaultBankAccountId: string | null;
    budgetLines: BudgetLineOption[]; paymentMethods: readonly ("check" | "cash" | "other")[] };
  warnings: CorrectionWarning[];                           // for the proposal, else the baseline
  reasonLimits: { min: 10; max: 500 };
}
type OperationDecision = { allowed: true } | { allowed: false; code: CorrectionErrorCode; status: 403 | 409; reason: string };
```
Destination-independent refusals are top-level 4xx (like Move): 404 `not_found`, 403 `not_correctable`, 403 `own_request`. Everything per-operation (`manage_required`, state codes, `already_has_bank_account`, `would_hide_statement`) is a per-operation denial inside a 200, carrying the code and status POST would return.

**POST** body, exactly one of two shapes; any other key is 400 `invalid_body` ("Unexpected field: x."):

| operation | required keys | optional keys | value rules |
|-----------|---------------|---------------|-------------|
| `fill_bank_account` | `operation`, `bankAccountId`, `expectedUpdatedAt` | `checkNumber` | `bankAccountId` uuid; `checkNumber` via `normalizeCheckNumber` (absent or empty is null = "leave it"); `expectedUpdatedAt` ISO string. **No `reason`.** |
| `correct` | `operation`, `reason`, `expectedUpdatedAt`, and **at least one** of the seven fields | `categoryId` (uuid, never null), `budgetLineId` (uuid or null=clear), `txnDate` (`parseIsoDate`, strict), `paymentMethod` (`REIMBURSEMENT_PAYMENT_METHODS`), `checkNumber` (string or null=clear, via `normalizeCheckNumber`), `memo` (trimmed, 1 to 1000 chars, never null), `bankAccountId` (uuid, never null) | `reason` via `normalizeCorrectionReason` (10 to 500 code points). The dialog sends **only the fields the user changed**; the server also drops any field equal to the stored value before evaluating state, so a resent unchanged date never trips the reconciled refusal. |

Never accepted, by construction (not by denylist): `fundId`, `entityId`, `amountCents`, `flow`, `party`, `status`, `approvedAt`, `approvedByUserId`, `boardMinute`, `reconciled`, `reconciledAt`, `reconciledSessionId`, `receiptStorageKey`, `beneficiaryCause`, `donorId`, `duesPaymentId`, `transferGroupId`, `publicNote`, a typo'd key. The two key sets are exported constants (`FILL_BODY_KEYS`, `CORRECT_BODY_KEYS`) so the allowlist test can derive "every column not listed is rejected" from `getTableColumns(ledgerTransactions)`.

**POST 200** `CorrectResponse`: `{ id, operation, changed: CorrectableField[], bankAccountName: string | null, budgetLineLinkCleared: boolean, warnings: CorrectionWarning[] }`.
**Error body** (all codes): `{ error: string, code: CorrectionErrorCode }` (`CorrectionErrorBody`).

**Guard order**, identical for GET and POST (GET omits the POST-only rows; one evaluator, `evaluateCorrection()`, serves both, DECISION-111 item 1 pattern). A refused request reports only the first applicable row:

| # | Check | Refusal (code, status) | Applies to |
|---|-------|------------------------|------------|
| 0 | `auth()` | 401 | both |
| 1 | `hasFeature(LEDGER_RECORD)`, **before any row read** (no 404-vs-403 oracle) | `forbidden` 403 | both |
| 2 | `isUuid(id)` | `not_found` 404 | both |
| 3 | Body shape: exact-key allowlist per operation, value shapes, reason, at least one field. **Pure, before any DB read** (POST). Proposal params (GET) | `invalid_body` 400 | both |
| 4 | `db.transaction`; **first statement** `SELECT ... FROM ledger_transactions WHERE id = $id FOR UPDATE` (GET: plain select) | `not_found` 404 | both |
| 5 | `correctableRowKind(row, linkedPaid)` is `"paid_reimbursement"` | `not_correctable` 403 | both |
| 6 | Self-action over every linked paid reimbursement | `own_request` 403 | both |
| 7 | `expectedUpdatedAt` vs locked row, compared with `getTime()` | `stale` 409 | POST |
| 8 | State on the locked row. **fill:** `bank_account_id` already set (409 `already_has_bank_account`), then `check_number_present` if a different number was sent (409), then `reconciled_session`, `reconciled_legacy`, `matched_open_session` (403). **correct:** only when the change set (after dropping no-ops) contains `bankAccountId` or `txnDate`: `reconciled_session`, `reconciled_legacy`, `matched_open_session` (403). Match is read with `loadOpenMatch(tx, id)` after the lock | per code | both |
| 9 | Change set empty after dropping no-ops | `no_change` 400 | correct |
| 10 | Tier: `requiredCorrectionTier()`; manage required and caller lacks `LEDGER_MANAGE` | `manage_required` 403 | correct only. **`fill_bank_account` is exempt** (record tier even for a prior-year row; it changes no reported figure) |
| 11 | Semantic input on the locked row: category (`validateCategoryForFund(tx, id, {entityId: row.entityId, kind: fund.kind}, "expense", {requireActive: true})` -> 404 `category_not_found` / 400 `category_invalid`); bank account (`validateBankAccountForEntity(tx, id, row.entityId, {requireActive: true})` -> 400 `bank_account_invalid`; **validated only when it differs from the stored value**, DECISION-111 item 4); budget line (`getBudgetLineForLinkValidation`; a new pick must match fund, fiscal year of the effective date, effective category, expense -> 404 `budget_line_not_found` / 400 `budget_line_invalid`; an unchanged or omitted link is auto-cleared with `budgetLineLinkCleared: true` via `shouldClearBudgetLineLink`, a `budgetLineId: null` clears it) | per code | both (POST writes) |
| 12 | Statement rule (R1): `newlyHiddenStatementMonth(...)` non-null | `would_hide_statement` 409 | correct, when date or method changes |
| 13 | **Pinned UPDATE** on the locked row; zero rows **throws** a private rollback sentinel (a `return` inside `db.transaction` commits, DECISION-113 X1), mapped to 409 `stale` (correct) or 409 `already_has_bank_account` (fill) | per code | POST |
| 14 | `recordLedgerAudit(tx, ...)` **last**, same `tx`; a throw rolls everything back (500, nothing committed) | 500 | POST |

Status map (the table test pins every row): **400** `invalid_body`, `no_change`, `category_invalid`, `bank_account_invalid`, `budget_line_invalid`; **401**; **403** `forbidden`, `not_correctable`, `own_request`, `manage_required`, `reconciled_session`, `reconciled_legacy`, `matched_open_session`; **404** `not_found`, `category_not_found`, `budget_line_not_found`; **409** `stale`, `already_has_bank_account`, `check_number_present`, `would_hide_statement`; **500**. The user-facing copy is one exhaustive `Record<CorrectionErrorCode, string>` in `ledger-reimbursement-correction.ts` (a new code is a compile error), reusing `STALE_MOVE_MESSAGE`, `CLOSED_SESSION_LOCK_MESSAGE` wording where it fits.

**The UPDATE statements** (built by two separate exported pure functions, key sets pinned by tests, DECISION-113 pattern):

- `buildFillSet({ bankAccountId, checkNumber | undefined, now })` returns `{ bankAccountId, [checkNumber], updatedAt }`. `WHERE id = $id AND bank_account_id IS NULL AND status = 'posted' AND reconciled = false AND reconciled_session_id IS NULL AND approved_at IS NOT NULL AND NOT EXISTS (match)`. `RETURNING id`.
- `buildCorrectSet(changes, now)` returns only the changed allowlisted columns of `category_id`, `budget_line_id`, `txn_date`, `payment_method`, `check_number`, `memo`, `bank_account_id` plus `updated_at`. `WHERE id = $id AND approved_at IS NOT NULL` and, **only when the change set includes date or bank account**, `AND reconciled = false AND reconciled_session_id IS NULL`.
- **Neither set can ever contain** `approvedAt`, `approvedByUserId`, `boardMinute`, `amountCents`, `flow`, `fundId`, `entityId`, `status`, `party`, `reconciled*`, `receipt*`, `donorId` (DECISION-106 item 3: the stamp IS the lock). A test asserts this on `Object.keys(set)` for every input shape.

**Tier** (`requiredCorrectionTier(row, change, now)`, pure): `reasons` = `requiredMoveTier(row, now).reasons` (reconciled, prior_fiscal_year) plus, when the date changes, `prior_fiscal_year` if the **new** date is before the current fiscal year, plus `fiscal_year_change` if the new date's fiscal year differs from the old. `manage` when any reason applies. `CorrectionTierReason = "reconciled" | "prior_fiscal_year" | "fiscal_year_change"`.

**Warnings** (`CorrectionWarning = { code, message }`, codes `reconciled | prior_fiscal_year | sent_statement | new_month_sent_statement | reports_change`): `reconciled` and `prior_fiscal_year` from the tier reasons; `sent_statement` / `new_month_sent_statement` from `findSentStatementMonth` on the row's current month and, when the date moves to another month, the new month, **only when the change set contains `categoryId`, `txnDate`, `budgetLineId` or `paymentMethod`** (memo, check number and bank account restate no statement); `reports_change` when category or date changes. `sentStatementWarning(ym, label)` gains a third parameter (`action: "move" | "correction" = "move"`) so the correction copy does not say "move"; existing callers are byte-identical.

#### B. Pay: `PATCH /api/admin/ledger/reimbursements/[id]` `action: "pay"` (modified)

- Body adds **`bankAccountId`** (required uuid string) and optional **`checkNumber`** (via `normalizeCheckNumber`, stored as given regardless of method; the dialog sends it only for Check). A body without `bankAccountId` (a stale open dialog) is 400 "Reload the page: the payment form now asks which bank account the money came out of." with no insert.
- Validation placement (R5): after the fund check, `validateBankAccountForEntity(db, bankAccountId, fund.entityId, { requireActive: true })`; failure is 400 with `fit.error`. Then the insert adds `bankAccountId` and `checkNumber`. Everything else (stale tokens, atomic reimbursement UPDATE, stamp, 409 handling, emails) is unchanged.
- `VALID_PAYMENT_METHODS` is replaced by `REIMBURSEMENT_PAYMENT_METHODS`; the inline `parseDate` by `parseIsoDate`; the budget-line predicate by the shared helper. Header comment updated.
- **Memo fix.** The server keeps `memo: note ?? reimb.description`. The root-cause fix is in the dialog: the "Note" input becomes a **"Register description"** textarea **pre-filled with the member's description**, so what is shown is what is written and a cleared field still falls back to the description. The check number has its own field. No migration of existing memos.

#### C. Create from bank line: `.../reconciliation/sessions/[sessionId]/create-from-bank-line` (modified)

- **New `GET ?bankLineId=<uuid>`** (`ledger.record`; 404 session/line; returns `{ candidates: CreateFromBankLineCandidate[] }`, empty for a credit line). Used by the dialog and the match picker.
  `CreateFromBankLineCandidate = { transactionId, txnDate, party, amountCents, fundName, bankAccountId | null, bankAccountName | null, checkNumber | null, checkNumberMatchesLine: boolean, needsBankAccount: boolean, ownRequest: boolean }`. `ownRequest` is computed server-side from the session user (user id or member id).
- **POST gains `acknowledgeDuplicate`** (strict boolean when present; any other type is 400). After every existing validation and before the insert transaction: when `flow === "expense"` and the finder returns candidates, respond **409 `possible_duplicate`** `{ error, code: "possible_duplicate", candidates }` unless `acknowledgeDuplicate === true`. Advisory in the DECISION-113 sense (acknowledged, never a hard block), server-checked so a stale dialog or a direct call cannot bypass it. No lock (advisory; the later match constraints still protect the books). The created row is an ordinary row; the acknowledgment is not audited.
- Finder arguments: `entityId = session.entityId`, `flow = "expense"`, `amountCents = |bankLine.amountCents|`, `aroundDate = bankLine.postingDate`, `reimbursementDerivedOnly`, `unmatchedUnreconciledOnly`, `onAccountOrUnassigned = session.bankAccountId` (account is NULL **or** the session's).
- Normalizer and `CHECK_NUMBER_MAX_LEN` migrate to the shared home.

#### D. Read models

- **Register** (`/admin/ledger/[fundSlug]`): one extra query, `listPaidReimbursementTransactionIds(db, ids)` over only the page's approved expense rows, builds a `Set`; `TransactionActions` gets `paidReimbursement: boolean`. `listTransactions()` and its return type are **not** changed.
- **Paid tab:** `ReimbursementAdminRow` gains `paidTransaction: { id; bankAccountId | null; bankAccountName | null; checkNumber | null; reconciled: boolean } | null` via a LEFT JOIN of `ledger_transactions` and `ledger_bank_accounts` in `listReimbursementsForAdmin`.

### Eligibility predicate and its shared home

**`src/lib/ledger-reimbursement-link.ts`** (server-only, imports the schema, never `ledger-audit` / `ledger-correction`) is the **one** definition of "reimbursement-derived":

```ts
// SQL fragment: a PAID reimbursement links to this ledger row.
export function paidReimbursementExists(txnId: AnyColumn | SQL): SQL
  // EXISTS (SELECT 1 FROM ledger_reimbursements r WHERE r.ledger_transaction_id = <txnId> AND r.status = 'paid')
export async function listPaidReimbursementTransactionIds(exec, txnIds: string[]): Promise<Set<string>>   // register
export async function loadPaidReimbursementsForTransaction(exec, txnId): Promise<
  Array<{ id: string; submittedByUserId: string | null; submittedByMemberId: string | null }>>             // correct route, on the lock handle; limit 5
```
The client never supplies the fact. `correctableRowKind(row, linkedPaidCount)` in the **pure** `ledger-reimbursement-correction.ts` returns `"paid_reimbursement"` only when **all** hold: `flow = 'expense'`, `status = 'posted'`, `approvedAt` non-null, `transferGroupId` and `duesPaymentId` null, and at least one linked paid reimbursement. Anything else, including every other approved row and every ordinary unlocked posted row (which belongs to PATCH), is `null` and a uniform 403 `not_correctable` after the permission gate. B-85 is narrowed, not closed.

### Shared helpers (the duplication consolidation)

| Helper | Home | Replaces / used by |
|--------|------|--------------------|
| `CHECK_NUMBER_MAX_LEN = 20`, `normalizeCheckNumber(v)` | `src/lib/ledger.ts` (pure, client-safe; **not** `ledger-transaction-validation.ts`, which imports the schema) | **Five call sites migrated in this change:** `transactions/route.ts` POST, `transactions/[id]/route.ts` PATCH, `create-from-bank-line/route.ts`, the pay route, the new correct parser. The two dialogs and `transaction-form.tsx` / `reconciliation-create-from-bank-line-dialog.tsx` replace their literal `maxLength={20}` with the constant. |
| `REIMBURSEMENT_PAYMENT_METHODS = ["check","cash","other"] as const` + labels | `ledger.ts` | pay route, correct parser, pay dialog, correct dialog. B-13 (the all-methods list) stays open; this is only the reimbursement subset. |
| `pickDefaultBankAccount(accounts)`: the sole active account, else the active `isDefault` one, else `null` | `ledger.ts` | pay dialog, correct dialog, create-from-bank-line repair; **`transaction-form.tsx` migrates both inline `find(a => a.isDefault)` sites** (a strict superset: it only adds the sole-account fallback). `listActiveBankOptions()` (cross-entity move) is deliberately **not** migrated: there a default flag is not evidence of where a gift landed (DECISION-112), so it keeps "default only when exactly one active account". |
| `parseIsoDate(raw)`: `YYYY-MM-DD` that **round-trips** | `ledger.ts` | pay route, correct parser. **Latent bug found:** the three inline `parseDate` copies accept `2026-02-31` (JS rolls it to Mar 3) and Postgres then rejects it with a 500. The strict helper returns 400 instead; the POST/PATCH copies are left alone here (B-94 territory) and noted in DECISION-114. |
| `isBudgetLinePickValid(line, { fundId, fiscalYear, categoryId })` | `ledger.ts` | pay route and correct route (PATCH's inline copy joins B-94). |
| One duplicate-candidate finder | `src/lib/ledger-duplicate-candidates.ts` | below |
| `rowGatesStatement`, `monthGatedByRows`, `loadEarliestGatingDate`, `newlyHiddenStatementMonth` | `src/lib/financial-report-queries.ts` | `isMonthGatedForEntity` is refactored onto the same predicate (outputs byte-identical); the hide rule reuses it, never a second copy. |

**`findDuplicateCandidates` generalized in place (do not fork).** `src/lib/ledger-duplicate-candidates.ts` exports one parameterized finder:

```ts
findDuplicateRows(exec, { entityId, flow, amountCents, aroundDate, excludeTransactionId?,
  reimbursementDerivedOnly?, unmatchedUnreconciledOnly?, onAccountOrUnassigned? }): Promise<DuplicateCandidateRow[]>
// shared: status='posted', amount equal, +-DUPLICATE_WINDOW_DAYS (30) of aroundDate, transfer legs excluded, newest first, cap 5
// reimbursementDerivedOnly  -> AND paidReimbursementExists(t.id)   (and selects the linked submitter ids for own-request)
// unmatchedUnreconciledOnly -> AND reconciled = false AND reconciled_session_id IS NULL AND no match row
// onAccountOrUnassigned     -> AND (bank_account_id IS NULL OR bank_account_id = $id)
```
`DuplicateCandidateRow` is the superset (`id, txnDate, party, amountCents, fundName, bankAccountId, bankAccountName, checkNumber, matched, reconciled, reimbursementId | null, submitterUserId | null, submitterMemberId | null`). `ledger-fund-move-preview.ts` keeps `findDuplicateCandidates(exec, { row, destEntityId })` as a **thin wrapper** pinning `flow = "income"`, `entityId = destEntityId`, `excludeTransactionId = row.id`, and projecting to `MoveDuplicateCandidate` (R7); the DECISION-112/113 behavior and tests are unchanged. `DUPLICATE_WINDOW_DAYS` / `DUPLICATE_CANDIDATE_CAP` and `shiftIsoDate` stay exported from `ledger-fund-move-preview.ts` (re-exported from the finder) so existing importers keep one path.

### Audit vocabulary and the reader

- **One new action:** `TRANSACTION_CORRECTED_AUDIT_ACTION = "transaction_corrected"`, added to `CorrectionAuditAction` and `CORRECTION_AUDIT_ACTIONS` (the reader's `inArray` picks it up). It lives in `ledger-correction.ts` next to its siblings.
- **`AuditPayloadFor` becomes an action-keyed map** (behavior-identical, compile-checked):

```ts
export interface AuditPayloadMap {
  [TRANSACTION_FUND_MOVED_AUDIT_ACTION]: FundMoveAuditPayload;
  [TRANSACTION_DELETED_AUDIT_ACTION]: TransactionDeletedAuditPayload;
  [TRANSACTION_CORRECTED_AUDIT_ACTION]: ReimbursementCorrectedAuditPayload;
}
export type AuditPayloadFor<A extends CorrectionAuditAction> = AuditPayloadMap[A];  // a missing key is a compile error
```
- **Payload `v: 1`** (own version space, `CORRECTED_VERSIONS = [1]`; a future v2 for this action parses as raw):

```ts
interface ReimbursementCorrectedAuditPayload {
  before: { v: 1; bankAccount?: BankRefSnapshot | null; category?: CategoryRefSnapshot | null; budgetLineId?: string | null;
            txnDate?: string; paymentMethod?: string | null; checkNumber?: string | null; memo?: string | null };   // CHANGED fields only
  after:  { v: 1; /* same keys, the new values; bankAccount non-null when present */ };
  details: { v: 1; operation: "fill_bank_account" | "correct"; reason: string;        // fill: the fixed FILL_BANK_ACCOUNT_REASON constant
    entityId: string;                // the reader's entity filter (JS-side, DECISION-111 item 6)
    reimbursementId: string;         // an id only: no member name anywhere in the payload
    txnDate: string; amountCents: number; flow: "expense"; fiscalYear: number;       // the row AS LOCKED, before the change (like Move)
    tier: "record" | "manage"; reconciled: boolean; reconciledSessionId: string | null; priorFiscalYear: boolean;
    sentStatementMonth: string | null; newSentStatementMonth: string | null;          // "YYYY-MM", only when the change is statement-affecting
    changed: CorrectableField[]; budgetLineLinkCleared: boolean };
}
```
- **Parsers:** `parseAuditDetails(TRANSACTION_CORRECTED_AUDIT_ACTION, text)`, `parseAuditBefore(...)`, `parseAuditAfter(action, text)` overloads, same never-throws-degrade-to-`{ raw }` contract; details guard requires `reason` and `entityId` strings and a known `operation`.
- **Reader widening** (`getRecentLedgerCorrections`): `LedgerCorrectionRow.kind` becomes `"moved" | "deleted" | "corrected"` plus optional `changes?: string[]`, pre-composed by the pure `describeCorrectionChanges(before, after)` (labels such as `Bank account added: Checking`, `Category: Supplies to Postage`, `Date: 2026-09-15 to 2026-09-12`, `Payment method: Check to Cash`, `Check number added: 8249`, `Description edited`, `Budget line cleared`; **memo text is stored in the audit row but never rendered in the list**). The loop becomes an exhaustive `switch` over `CorrectionAuditAction` with a `never` check in `default`. `settledPeriod` keeps its definition (`details.reconciled || details.priorFiscalYear`). `entityId` filter applied in JS after parsing. A corrected row that fails to parse is still listed (reason null).
- **`<RecentCorrections>`** switches on `row.kind` through a `Record<kind, ...>` badge map plus an exhaustive `switch` with a `never` check (a fourth kind is a compile error). Compliance page copy: "Entries moved to another fund, deleted, or corrected (paid reimbursements) in the last 90 days, with who made the change and why." The 90-day window means an old repair leaves the on-screen list; the audit row is retained.
- **Member-surface firewall:** the new modules inherit it. `ledger-audit.test.ts` T33's offender regex is widened to also cover `ledger-reimbursement-correction` and `-queries` (today's regex `ledger-(audit|correction)` would **not** match `ledger-reimbursement-correction`).
- `schema.ts`: comment-only list update.

### Statement-hiding rule (R1)

`src/lib/financial-report-queries.ts` already decides which months members can see: a month is gated (hidden) when it has not elapsed, or when a posted, unreconciled row on or before its month-end exists in a member-exposed fund, **excluding** outstanding expense checks and uncleared deposits. The refusal reuses that predicate:

1. `rowGatesStatement({ fundKind, paymentMethod, flow })` = member-exposed fund kind AND NOT `isOutstandingCheckRow` AND NOT `isUnclearedDepositRow` (exported; `isMonthGatedForEntity` refactored onto it via a pure `monthGatedByRows(rows, monthEnd, now)`).
2. `loadEarliestGatingDate(exec, entityId, excludeTxnId)`: earliest `txn_date` among the entity's **other** posted, unreconciled gating rows (one query on the lock handle).
3. `newlyHiddenStatementMonth({ before: { gates, txnDate }, after: { gates, txnDate }, otherEarliestGatingDate, now })` returns `"YYYY-MM"` or null. A month is newly hidden iff it has elapsed, is **visible today** (its month-end is before `min(otherEarliest, beforeFrom)`, where `beforeFrom` is the row's date if it gates today, else infinity), and the row gates after the change from a date on or before that month-end. Same-month and later dates return null. If `after.gates` is false (method switched to Check, or a non-exposed fund) it returns null.
4. A **brute-force equivalence test** pins it: for a grid of rows, `newlyHiddenStatementMonth` is non-null exactly when some month is not gated before and is gated after, computed with `monthGatedByRows`.

Message: "Moving this entry to <date> would hide the <Month Year> monthly statement from members, because the entry is not reconciled yet. Reconcile it first, or pick a date in <Month Year of its current date> or later." Same-month or later: allowed, with the existing sent-statement warning.

### Lock kind and register

- `TransactionLockKind` gains `"paid_reimbursement"`; `LockableRow` gains `paidReimbursement?: boolean`. `transactionLockKinds()` pushes `paid_reimbursement` **before** `approved` (both are listed; the first is the classification). The exhaustive `LOCK_COPY` Record gains the entry:
  `{ label: "Paid reimbursement", nextStep: "Paid reimbursements can't be edited or deleted. Use Correct to change the category, date, method, check number, description or bank account." }`. The `approved` copy is unchanged for non-reimbursement approved rows.
- **`editLockKind` is unchanged** (it mirrors the PATCH guards and still returns `"approved"`); a new pure `editLockDisplayKind(row)` returns `"paid_reimbursement"` when `editLockKind` is `"approved"` and `paidReimbursement` is true. The pin test asserts `paid_reimbursement` implies `approved` and `editLockKind` is untouched.
- **`TransactionActions`** (new prop `paidReimbursement`): the label comes from `editLockDisplayKind`; for a paid reimbursement the **Edit button is replaced by Correct** (always enabled for a `ledger.record` holder; the server decides tier and state and the dialog explains), Delete stays disabled with the new copy, Move is already omitted for expenses, Split already excluded by `approvedAt`. A second line, shown when `paidReimbursement && bankAccountId == null && !isTransactionReconciled(row)` (a null-account row can never have been matched): "No bank account. It can't be reconciled yet." with an **Add bank account** button (`fill_bank_account` mode).

### Component and page plan

**New files**
- `src/lib/ledger-reimbursement-link.ts`, `src/lib/ledger-duplicate-candidates.ts`
- `src/lib/ledger-reimbursement-correction.ts` (pure, client-safe: operations, body parsers and key constants, `correctableRowKind`, `requiredCorrectionTier`, `diffCorrection`, `describeCorrectionChanges`, error-code `Record`s, copy, `FILL_BANK_ACCOUNT_REASON`, all response types)
- `src/lib/ledger-reimbursement-correction-queries.ts` (server: `evaluateCorrection`, `previewCorrection`, `executeCorrection`, `buildFillSet`, `buildCorrectSet`)
- `src/app/api/admin/ledger/transactions/[id]/correct/route.ts`
- `src/components/admin/ledger/correct-reimbursement-dialog.tsx` + `correct-reimbursement-dialog-logic.ts` (pure body builder, diff, failure routing, success copy)
- tests listed below; `e2e/ledger-reimbursement-correct.spec.ts` (qa)

**Modified files**
- Lib: `ledger.ts`, `ledger-correction.ts`, `ledger-audit.ts`, `ledger-transaction-lock.ts`, `ledger-fund-move-preview.ts` (wrapper only), `financial-report-queries.ts`, `ledger-queries.ts` (`listReimbursementsForAdmin` join + type), `db/schema.ts` (comment).
- Routes: `reimbursements/[id]/route.ts` (pay), `transactions/route.ts` and `transactions/[id]/route.ts` (**normalizer import only**; the `approvedAt` guard is not touched), `create-from-bank-line/route.ts` (GET, 409, normalizer).
- Components: `pay-reimbursement-dialog.tsx`, `transaction-actions.tsx`, `transaction-form.tsx` (helper and constant), `reconciliation-create-from-bank-line-dialog.tsx`, `reconciliation-match-picker.tsx` (new optional `initialQuery`, discoverability line), `reconciliation-matching-grid.tsx` (new `bankAccountId` prop, repair-dialog state), `recent-corrections.tsx`, Treasury Guide sections (`books-register`, `reimbursements`, `reconciliation`).
- Pages: `reimbursements/page.tsx` (loads active bank accounts per entity; passes `bankAccounts` and `description` to the pay dialog; Paid tab shows account, check number and a "Needs bank account" badge with an Add bank account button, hidden when `isSelf`), `[fundSlug]/page.tsx` (paid-reimbursement id set), `reconciliation/[sessionId]/page.tsx` (passes the session's `bankAccountId`), `compliance/page.tsx` (copy).
- `scripts/backfill-bank-account.ts`: header note only (below).

**Pay dialog** (`pay-reimbursement-dialog.tsx`): new props `bankAccounts: LedgerBankAccount[]` (active, all entities) and `description: string`. A bank-account select filtered to the selected fund's entity, preselected with `pickDefaultBankAccount`, **re-evaluated when the fund changes entity** (a still-valid choice is kept), helper text "Choose the account the money came out of." If the entity has no active account, the field is replaced by "Add a bank account for this entity in Ledger settings before paying" and Mark Paid is disabled. A **Check number** input (optional, `maxLength={CHECK_NUMBER_MAX_LEN}`, placeholder "e.g., 8249") shown only when the method is Check and sent only then. The "Note" field becomes the pre-filled **Register description** textarea (`maxLength` 1000 to match the server). Pure helpers go in a small `pay-reimbursement-dialog-logic.ts` so the body shape and account choice are unit-testable DOM-less.

**Correct dialog** (`correct-reimbursement-dialog.tsx`, Radix Dialog via `LedgerDialogShell`, same presentational-body-plus-container split as `move-transaction-dialog.tsx` so each state renders DOM-less). Props: `transactionId`, `mode: "add_bank_account" | "correct"`, `open`, `onOpenChange`, optional `preselectBankAccountId`. Phases: loading, load_error, blocked (top-level 403 `not_correctable` / `own_request`, per-operation denial such as `manage_required` or a state code with the unmatch/reopen next step), form, success. On open it GETs the preview; the date and method inputs re-GET with the proposal params so warnings and a `would_hide_statement` denial appear **before** Save.
- **add_bank_account:** summary line (date, party, amount, description), Bank account select (preselect order: `preselectBankAccountId`, else `pickDefaultBankAccount`), Check number (only when the row has none), Save "Add bank account". No reason field. Toast: "Added to <account>. It can now be matched in reconciliation."
- **correct:** Category, Applies to budget line (`BudgetLinePicker`, `txnDate` = the chosen date), Payment date and Bank account (**disabled with the `lockedFields` reason while matched or reconciled**), Payment method, Check number (shown when Check; clearable), Register description, `CorrectionReasonField` (required, 10 to 500), the warning list, Save "Save correction". Sends only changed fields. The Bank-account help text says it changes the book balance of both accounts. Failure routing mirrors `moveFailureAction`: 403/404/409 toast, close and refresh; 400 inline; else retry.
- Brand: `rounded-2xl` panel, `rounded-lg` buttons, `lions-blue`, 44px tap targets, 360px stacked fields, no `lions-red`, no native dialogs.

**Create-from-bank-line dialog**: for a debit line with flow Expense it GETs the candidates on open; if any, a gold advisory panel above the form: "A paid reimbursement of $X on <date> to <party> may already record this payment. Creating a new entry would count it twice." (plus "Check numbers match." when `checkNumberMatchesLine`), per candidate a primary **Use that entry instead** (disabled with the reason when `ownRequest`: "You submitted this request, so another reviewer must work with it"), and a secondary path: **Create & Match is disabled until the user ticks "This is a different payment"**, after which the POST carries `acknowledgeDuplicate: true`. A POST 409 `possible_duplicate` (stale dialog) populates the same panel. "Use that entry instead": a `needsBankAccount` candidate closes this dialog and opens the repair dialog with the session account preselected (it then appears in the match picker); a session-account candidate closes this dialog and opens the match picker with `initialQuery` set to the amount. The picker's discoverability line: for a debit line with **no** same-amount candidate in its list, it GETs the candidates and, if a `needsBankAccount` one exists, shows "A paid reimbursement of $X to <party> has no bank account, so it is not in this list." with an Add bank account button. A GET failure never blocks the dialog (the POST is the authority).

### Implementation order

1. **Shared helpers + behavior pins (api-developer).** `ledger.ts` additions and the three existing check-number migrations (tests T1 to T5 first so the migration is provably behavior-identical). `financial-report-queries.ts` refactor and T23 to T25.
2. **Audit vocabulary (api-developer).** `ledger-correction.ts`, `ledger-audit.ts`, `schema.ts` comment, firewall regex; T27 to T31.
3. **Lock kind (api-developer).** `ledger-transaction-lock.ts`, T26.
4. **Reimbursement link + finder (api-developer).** `ledger-reimbursement-link.ts`, `ledger-duplicate-candidates.ts` and the move wrapper; T32 to T34, T46.
5. **Correct route (api-developer).** pure module, queries module, route; T6 to T22.
6. **Pay + create-from-bank-line + Paid-tab query (api-developer).** T35 to T37, T44 (query half).
7. **Handoff to ux-developer** (contract below), then UI: pay dialog, correct dialog, `TransactionActions`, register and Paid-tab wiring, create-from-bank-line dialog, picker, grid, `RecentCorrections`, guide, copy; T38 to T43, T45.
8. **qa:** typecheck, `pnpm build:only`, full unit run, the new e2e spec, the two named regression specs, manual click-through on a real-shaped dev dataset (pay a reimbursement, repair a null-account row, match it, correct it, see it under Recent corrections, hit the duplicate guard), post-deploy production check.
9. **Release notes** via `/release-notes` at ship (tech-lead).

**Specialist split: api-developer, then ux-developer** (new API contract with a real UI on top; this is not the small tightly coupled full-stack case). No database-admin phase (no schema work).

**api-developer to ux-developer handoff contract.** Before UI starts, these must exist, typed, and be importable from client code:

| Contract | Where |
|----------|-------|
| `CorrectionPreview`, `CorrectResponse`, `CorrectionErrorCode`, `CorrectionWarning`, `CorrectableField`, `CorrectionTierReason`, `FILL_BANK_ACCOUNT_REASON`, the message `Record`s | `ledger-reimbursement-correction.ts` (no db import) |
| `GET/POST /api/admin/ledger/transactions/[id]/correct` per the tables above | route |
| `CreateFromBankLineCandidate`; `GET`/`POST` `acknowledgeDuplicate`, `409 possible_duplicate` | route + type exported from the pure module |
| `ReimbursementAdminRow.paidTransaction` | `ledger-queries.ts` |
| `listPaidReimbursementTransactionIds(db, ids)` | `ledger-reimbursement-link.ts` (server) |
| `TransactionLockKind` `paid_reimbursement`, `LOCK_COPY`, `editLockDisplayKind` | `ledger-transaction-lock.ts` |
| `normalizeCheckNumber`, `CHECK_NUMBER_MAX_LEN`, `REIMBURSEMENT_PAYMENT_METHODS` (+ labels), `pickDefaultBankAccount` | `ledger.ts` |
| `LedgerCorrectionRow.kind` `"corrected"` and `changes?` | `ledger-correction.ts` |
| Pay route accepting `bankAccountId` / `checkNumber` | route |

### Unit tests (the Phase 4 gate: implementers write these)

**api-developer**

| ID | File | Test |
|----|------|------|
| T1 | `ledger.test.ts` | `normalizeCheckNumber` table: undefined and null to null; `"  8249 "` to `"8249"`; empty and whitespace to null; 20 chars ok; 21 chars error with the exact message; a number and an object error `checkNumber must be a string`. **Behavior pin across the five migrated sites:** one route test per migrated route (POST, PATCH, create-from-bank-line) asserts a 21-character check number is still 400 with the same message, and PATCH with `checkNumber` omitted leaves the column untouched (the old PATCH copy treated `undefined` as an error but its call site was already guarded by `!== undefined`; the pin proves nothing changed). |
| T2 | `ledger.test.ts` | `REIMBURSEMENT_PAYMENT_METHODS` equals `check, cash, other`; every method has a label. |
| T3 | `ledger.test.ts` | `pickDefaultBankAccount`: sole active non-default account wins; default among several; several with no default is null; an inactive default is ignored; empty is null. |
| T4 | `ledger.test.ts` | `parseIsoDate`: valid; `2026-02-31` null; `2026-13-01` null; `2026-1-1` null; non-string null. |
| T5 | `ledger.test.ts` | `isBudgetLinePickValid` table: matching line valid; wrong fund, fiscal year, category or a non-expense line invalid. |
| T6 | `ledger-reimbursement-correction.test.ts` | `correctableRowKind` classifier table: paid reimbursement row is `paid_reimbursement`; same row with zero linked is null; income row, rejected, pending, transfer leg, dues-synced, approved-without-link, row without `approvedAt` all null. |
| T7 | same | **Allowlist table:** for **both** operations, every key of `getTableColumns(ledgerTransactions)` not in the operation's key set is rejected (400 `invalid_body`, "Unexpected field"); unknown operation; missing operation; cross-operation keys (`reason` on fill; `bankAccountId` and `categoryId` mix on fill); typo `categoryID`; `fundId`, `amountCents`, `flow`, `status`, `approvedAt`, `approvedByUserId`, `boardMinute`, `reconciled`. Plus value rules: reason 9 chars fails, 10 ok, 501 fails; `categoryId: null` rejected; `memo: ""` rejected; `bankAccountId: null` rejected; `budgetLineId: null` accepted; `paymentMethod: "zeffy"` rejected; `txnDate: "2026-02-31"` rejected; `checkNumber` 21 chars rejected; correct with no editable field rejected; `expectedUpdatedAt` not ISO rejected. |
| T8 | same | `diffCorrection` drops fields equal to the stored value, reports `changed` in canonical order, empty set is `no_change`. |
| T9 | same | `describeCorrectionChanges` label table (fill with and without check number; each field; budget line cleared); memo text never appears in the output. |
| T10 | same | `requiredCorrectionTier` table: unreconciled current-FY is record; session and legacy reconciled are manage `reconciled`; prior-FY row is manage `prior_fiscal_year`; date crossing a fiscal-year boundary adds `fiscal_year_change`; date into a prior FY adds `prior_fiscal_year`; same-FY date change on an unreconciled current row stays record; `now` edges 2026-06-30 / 2026-07-01. |
| T11 | same | Every `CorrectionErrorCode` has a status and a copy string (exhaustive `Record`); status map pinned: `already_has_bank_account` 409, `reconciled_*` and `matched_open_session` 403, `would_hide_statement` 409, `no_change` 400. |
| T12 | same | Warning builder: `sent_statement` only for statement-affecting changes; `new_month_sent_statement` only when the month changes; `reports_change` for category or date; `sentStatementWarning(..., "correction")` has no "move" wording and the default is byte-identical. |
| T13 | `ledger-reimbursement-correction-queries.test.ts` | **Guard-order table** (both GET and POST): not_found; not_correctable beats own_request; own_request (user id; member id; both operations; the second of two linked reimbursements); own_request beats stale; stale beats state; fill: already_has_bank_account, check_number_present, reconciled_session beats reconciled_legacy beats matched_open_session; correct: state only when date or bank account changes, and a category-only change on a reconciled row passes state; no_change beats manage_required; state beats tier; tier beats semantic input; semantic input beats would_hide_statement. |
| T14 | same | **Atomic fill (race):** the pinned UPDATE's WHERE (serialized with `PgDialect`) contains `bank_account_id IS NULL`, `status = 'posted'`, `reconciled = false`, `reconciled_session_id IS NULL`, `approved_at IS NOT NULL` and the no-match guard; zero rows rolls back, returns 409 `already_has_bank_account` and **no audit insert happens**; a match inserted between read and write (post-lock read sees it) is refused 403 `matched_open_session`. |
| T15 | same | **SET key-set pins** for `buildFillSet` and `buildCorrectSet` across every input shape: never `approvedAt`, `approvedByUserId`, `boardMinute`, `amountCents`, `flow`, `fundId`, `entityId`, `status`, `party`, `reconciled`, `reconciledSessionId`, `receiptStorageKey`; always `updatedAt`; the reconciled predicate appears in the WHERE only when date or bank account changes. |
| T16 | same | The row `FOR UPDATE` is the **first** statement in the transaction; the audit insert is **last** and on the same `tx`; an audit-insert failure rolls the transaction back and surfaces as an error (nothing returned as ok). |
| T17 | same | Audit payload: fill writes `before.bankAccount` null and `after.bankAccount` `{id,name}` with the fixed reason and `operation: "fill_bank_account"`, `tier: "record"` even for a prior-year row; correct writes only changed fields, `details.changed`, the tier, `txnDate`/`fiscalYear` of the row as locked; the serialized payload contains no `party` and no member name. |
| T18 | same | Budget-line link: date moved across a fiscal year auto-clears and returns `budgetLineLinkCleared: true`; `budgetLineId: null` clears; a new pick is validated against fund, effective fiscal year, effective category and flow (400 `budget_line_invalid`, 404 `budget_line_not_found`); an unchanged bank account is **not** re-validated (deactivated-account row can still be re-categorized). |
| T19 | same | **GET/POST parity:** a table of scenarios asserts the per-operation `allowed`/`code`/`status` in the preview equals the POST refusal, including a proposal date that triggers `would_hide_statement`. |
| T20 | same | Statement rule end to end: earlier date hiding a visible month is 409 `would_hide_statement`; same-month and later dates succeed with the sent-statement warning when a sent statement exists for the old or new month; a method change from Check to Cash that would hide a month is refused, Cash to Check is allowed. |
| T21 | `correct/route.test.ts` | 401 with no session; 403 `forbidden` **before any select runs**; non-uuid id 404; malformed body 400 before any db call; result-to-HTTP mapping for every code; GET returns the preview. |
| T22 | `transactions/[id]/route.test.ts`, `route.delete.test.ts`, `split/route.test.ts` | **Guard-stays-unconditional pins:** PATCH on an approved row with body `{ bankAccountId }` (and `{ donorId }`) is still 403 and `request.json` is **never called**; DELETE and split on an approved row still 403 without parsing. |
| T23 | `financial-report-queries.test.ts` | `rowGatesStatement` table (expense+check false; expense+cash true; income any false; administrative and charitable only). |
| T24 | same | `isMonthGatedForEntity` outputs unchanged after the refactor (existing cases pass untouched). |
| T25 | same | `newlyHiddenStatementMonth` table (earlier into the prior month; same month; later; method Check to Cash; Cash to Check; other rows already gating; month not elapsed; none) and the **brute-force equivalence** against `monthGatedByRows`. |
| T26 | `ledger-transaction-lock.test.ts` | `paid_reimbursement` is first in `transactionLockKinds` and implies `approved`; without the flag the classification is `approved`; `editLockKind` unchanged; `editLockDisplayKind`; `LOCK_COPY` exhaustive test covers the new key; the pinned copy no longer contains "refund entry". |
| T27 | `ledger-audit.test.ts` | Reader selects the three actions (update the T32 assertion); a `corrected` v1 row maps (kind, `changes`, reason, `settledPeriod`, entity filter via `details.entityId`, excluded for another entity); an unparseable corrected row is listed with a null reason; an unknown version degrades to raw; the cap and total include corrected rows. |
| T28 | same | `recordLedgerAudit` accepts a corrected payload and writes the three text columns; a `// @ts-expect-error` proves a moved payload is rejected under the corrected action. |
| T29 | same | Firewall: no member surface imports `ledger-reimbursement-correction(-queries)` (regex widened). |
| T30 | same | Type-level: `AuditPayloadMap` has a key for every `CorrectionAuditAction` (a `Record<CorrectionAuditAction, unknown>` assignment compiles; adding an action without a map entry would not). |
| T31 | same | The refactor to an exhaustive `switch` leaves the moved and deleted reader cases and `getLatestFundMove` unchanged (existing T32, C14 and C15 cases pass untouched). |
| T32 | `ledger-duplicate-candidates.test.ts` | Income wrapper unchanged: WHERE shape, 30-day bounds, exclude self, transfer legs excluded, cap 5, projection has exactly the `MoveDuplicateCandidate` keys. |
| T33 | same | Expense + `reimbursementDerivedOnly`: WHERE contains the shared `paidReimbursementExists` fragment and `flow = 'expense'`; `unmatchedUnreconciledOnly` excludes matched and reconciled; `onAccountOrUnassigned` serializes as `(bank_account_id IS NULL OR bank_account_id = $id)`. |
| T34 | same | Null-account case returns the row with `bankAccountId: null`; cap respected; superset fields populated. |
| T35 | `create-from-bank-line/route.test.ts` (new) | Debit expense with a candidate: 409 `possible_duplicate` + candidates and **nothing inserted**; with `acknowledgeDuplicate: true`: 201; non-boolean flag 400; income flow never checked; no candidate 201; candidate on another account or already matched not returned; `ownRequest` true for user id and for member id; `checkNumberMatchesLine`. |
| T36 | same | GET: 401/403; unknown session or line 404; credit line returns an empty list; shape. |
| T37 | `reimbursements/[id]/route.test.ts` | Pay requires `bankAccountId` (400 human sentence, no insert); invalid, inactive and other-entity account 400 (validator called with `fund.entityId` and `requireActive`); insert carries `bankAccountId` and normalized `checkNumber`; 21-char check number 400; the memo is the sent note when present and the description when omitted; the approval stamp is still written; the existing 403/409 cases updated with the new body fields. **The fake `db` in this file needs `select` on the path used by the bank-account validator.** |
| T46 | `ledger-reimbursement-link.test.ts` | `listPaidReimbursementTransactionIds` returns only ids with a **paid** link; empty input short-circuits; `loadPaidReimbursementsForTransaction` ignores non-paid statuses. |

**ux-developer**

| ID | File | Test |
|----|------|------|
| T38 | `pay-reimbursement-dialog-logic.test.ts` (+ body render) | Default account per fund entity and re-evaluation on fund change; entity with no active account shows the blocking message and disables submit; description pre-fill and the "Register description" label; body carries `bankAccountId`, and `checkNumber` only for Check; `maxLength` equals `CHECK_NUMBER_MAX_LEN`. |
| T39 | `correct-reimbursement-dialog.test.tsx`, `correct-reimbursement-dialog-logic.test.ts` | Each phase renders (loading, load_error, blocked for `not_correctable`, `own_request`, `manage_required`, a state code with its next step; form for both modes; success); `buildCorrectBody` sends only changed fields; date and bank account disabled with the reason when `dateAndBankEditable` is false; reason required for correct and absent for fill; warnings rendered; failure routing (403/404/409 close and refresh, 400 inline, 500 retry). |
| T40 | `transaction-actions.test.tsx` | Paid-reimbursement row: label "Paid reimbursement.", Correct present and enabled, Edit absent, Delete disabled with the new copy; "No bank account" line and Add bank account only when the account is null and the row is unreconciled; a non-reimbursement approved row is byte-identical to today. |
| T41 | `reconciliation-create-from-bank-line-dialog.test.tsx` (new) | Candidates render the advisory; "Use that entry instead" present and disabled with the reason for `ownRequest`; Create & Match disabled until the box is ticked; the request carries `acknowledgeDuplicate` only after; a 409 populates the panel. |
| T42 | `reconciliation-match-picker.test.tsx` | `initialQuery` pre-filters; the discoverability line appears only with zero same-amount candidates and a `needsBankAccount` candidate. |
| T43 | `transaction-actions.test.tsx` | The "no native dialogs" test's file list gains the two new dialogs. |
| T44 | `recent-corrections.test.tsx`, `reimbursements` page logic | A corrected row renders the Corrected badge and the `changes` list and never the memo; all three kinds render (a `Record<kind, ...>` compile check); Paid-tab "Needs bank account" badge logic. |
| T45 | guide section tests (existing pattern) | The three guide sections mention Correct, the bank-account/check-number fields and the duplicate warning. |

### e2e impact

Searched `e2e/` for reimbursement, mark paid, create-from-bank-line, check number, bank account, Recent corrections and lock-label assertions. **No existing spec drives Mark Paid, the Paid tab, create-from-bank-line or the correct route**, so nothing breaks by construction. Three specs touch changed surfaces and must be **re-run as regressions**: `ledger-move-transaction.spec.ts` (Recent corrections text, the reconciled-row "Edit disabled" assertion, register labels; non-reimbursement rows keep today's `Approved.` / `Reconciled.` copy), `deposit-in-transit-carveout.spec.ts` and `prior-year-cause-line-reconcile.spec.ts` (they exercise the statement gate that `financial-report-queries.ts` refactors). **New spec (qa, Phase 5): `e2e/ledger-reimbursement-correct.spec.ts`**, DB-seeded (never drives Mark Paid, which emails): (1) a null-account paid-reimbursement row shows "Paid reimbursement" and **Add bank account**; adding the account makes it appear in the match picker of an open session on that account and matchable; (2) create-from-bank-line on a debit line equal to an unmatched paid reimbursement shows the advisory, "Use that entry instead" works, and "Create & Match" stays disabled until acknowledged; (3) Correct changes the category and the change shows under Recent corrections on the Compliance page; (4) a 360px viewport keeps both dialogs and their primary buttons reachable. Seeded rows must be cleaned up (shared database, single worker); no email may be triggered.

### Edge cases and risks

- **Race, repair vs match.** Both directions serialize: `/match` locks the submitted rows `FOR UPDATE` (B-105) and our lock waits for it, and a match insert takes a key-share lock that conflicts with our `FOR UPDATE`. The state facts are read after the lock on `tx`.
- **A `return` inside `db.transaction` commits.** The only refusals after a write are the pinned UPDATE matching zero rows (throws the sentinel) and the audit insert (throws); every other refusal happens before any write.
- **Closed-session arithmetic cannot move.** Bank account and date change only while unmatched and unreconciled; the five other fields are read by no tie-out (`getTieOutAssembly` is bank-line driven; `checkNumber` appears only in the match-candidate display).
- **Wrong account at pay time is now the live failure mode**; `correct` with `bankAccountId` fixes it while the row is unmatched and unreconciled, and `fill_bank_account` is its reason-free special case. A matched wrong account is the unmatch-then-correct path (Guide).
- **Both account balances move** on an account change (documented in the dialog help and the Guide).
- **Stale tokens are partial**, see Data Model; the real guard is re-derivation under the lock.
- **Own request** is closed for both operations; the duplicate advisory still shows an own request as information but disables "Use that entry instead".
- **Cash reimbursements** preselect the entity default with the helper copy; a wrong pick is `correct`.
- **Entity with no active bank account** blocks pay with a message; managing accounts is B-109/B-111.
- **Legacy "reconciled" toggle** on a null-account row counts as reconciled for the repair guard (`reconciled_legacy`).
- **Existing memos holding a check number** stay as they are; nothing is auto-migrated.
- **`approved` copy for board-approved disbursements** still says "Record a refund entry", which is as misleading for an expense there as it was here. Out of scope; noted for the next ledger touch.
- **`backfill-bank-account.ts` stays.** With no non-reimbursement null-account rows remaining in production, it has nothing left to own today, but it remains the only bulk, dry-run-first tool for a future batch (an import, a restored backup). Change: a header note, "paid-reimbursement rows are repaired in the register (Add bank account), not by this script", and nothing else. It is never run against reimbursement rows again.
- **Durable-claim exception does not apply** (no sent claim, no email, `sendEmail()` not called by the new route; the pay route's existing member email is unchanged). DECISION-102/103 not engaged; nothing to revert.
- **B-111 coordination:** no overlapping files. If B-111 binds `ledger.manage` to `treasurer`, the `manage_required` tier simply starts working for that role; copy names no role.

### Out of scope

Correcting the amount or fund of a paid reimbursement (a refund entry or a new request); voiding or reissuing a lost check (B-130); a marker column (B-85 narrowed); a partial unique index on `ledger_reimbursements.ledger_transaction_id` (B-129); auto-matching by check number; adding the check number to the member's "paid" email; Zelle/ACH methods (`other` covers them); retiring the backfill script; bulk-correcting memos; the Phase 1 Gap 4 duplicate advisory inside the repair dialog (R3); migrating the `parseDate` copies in transactions POST/PATCH (B-94).

### Release-notes draft (for `/release-notes` at ship; no version, no file lists)

> ### Feature: Paid reimbursements can be reconciled and corrected
>
> **Value:** A reimbursement the treasurer pays by check now shows up in bank reconciliation like any other check, and if something was entered wrong, it can be fixed in the register with a recorded reason instead of a developer.
>
> #### What's New
> - **Mark Paid asks which bank account the money came out of** (the entity's default is preselected) and takes the check number when you pay by check. The member's description is no longer overwritten: the "Register description" starts as what the member wrote, and the check number has its own field.
> - **Paid reimbursements are labelled in the register.** The lock label reads "Paid reimbursement" instead of "Approved," and the advice is now accurate: use **Correct**, not a refund entry.
> - **Add bank account.** A paid reimbursement recorded before this release has no bank account, so the bank's check line could never be matched to it. The register now shows "No bank account" on those entries with an **Add bank account** button. It adds the account (and the check number, if you have it) and nothing else; it is recorded under Recent corrections. **The two reimbursements paid on October 1 can be repaired this way**, and then matched in the open September reconciliation.
> - **Correct a paid reimbursement.** Change its category, budget line, date, payment method, check number, description or bank account, with a reason (10 to 500 characters). Amount, fund and who was paid cannot be changed here. The date and bank account can change only while the entry is not matched or reconciled. Entries that were reconciled, or are dated in an earlier fiscal year, need the Manage Ledger permission, and a statement already sent to the board is flagged exactly as for a move.
> - **A date change that would hide a monthly statement is refused.** Moving an unreconciled entry to an earlier month would take that month's statement off the members' page until the entry is reconciled; the correction says so and does not go through.
> - **Create from bank line no longer double-books a payment.** If the bank line is a debit and a paid reimbursement of the same amount is waiting, the dialog says so and offers **Use that entry instead**. Creating a new entry anyway needs an explicit confirmation.
> - **Recent corrections** on the Compliance page now also lists these repairs and corrections, with who, when, what changed and why.
>
> #### What the treasurer should know
> - Nothing about a closed reconciliation can change through Correct: the bank account and date are locked once an entry is matched. To fix a wrong account on a matched entry, unmatch it, correct it, and match it again.
> - Existing reimbursement entries whose description holds a check number were not changed.
> - The member's own request can't be corrected by the same person; another reviewer must do it.


---

# Phase 4 — Implementation

## Phase 4 (server) — api-developer — 2026-10-02

**Owner:** api-developer
**Status:** server done, UI pending (ux-developer next)

### Summary
The whole server half is built and tested: shared helpers and the five-site check-number consolidation, the statement-hiding rule, the audit vocabulary and widened reader, the `paid_reimbursement` lock kind, the reimbursement link predicate and the generalized duplicate finder, the new `.../correct` route (GET preview + POST, two operations), the pay-route changes, create-from-bank-line GET + 409 guard, and the Paid-tab `paidTransaction` read. No schema change, no migration, no new key, no nav/proxy change, no email, no `console.log` added. PATCH/DELETE/split `approvedAt` guards are untouched and pinned by tests. All T1-T37, T44 (query half) and T46 are written and passing; T38-T45 (UI) are the ux-developer's.

### Gate results
See "Gate lines" at the end of this section.

### Contracts for ux-developer

**All types are in `src/lib/ledger-reimbursement-correction.ts` (pure, client-safe, no db import):** `CorrectionPreview`, `CorrectResponse`, `CorrectionErrorCode`, `CorrectionErrorBody`, `CorrectionWarning`, `CorrectableField`, `CorrectionTierReason`, `OperationDecision`, `CreateFromBankLineCandidate`, `PossibleDuplicateBody`, `CORRECTION_ERROR_COPY`, `CORRECTION_ERROR_STATUS`, `FILL_BANK_ACCOUNT_REASON`, `CORRECTION_FAILED_MESSAGE`, `MEMO_MAX_LEN` (1000), `REIMBURSEMENT_PAYMENT_METHODS` (+ labels, re-exported). Shared helpers in `src/lib/ledger.ts`: `normalizeCheckNumber`, `CHECK_NUMBER_MAX_LEN` (20), `REIMBURSEMENT_PAYMENT_METHODS`, `REIMBURSEMENT_PAYMENT_METHOD_LABELS`, `isReimbursementPaymentMethod`, `pickDefaultBankAccount(accounts)` (needs `isDefault`, optional `isActive`), `parseIsoDate`, `isBudgetLinePickValid`.

**`GET /api/admin/ledger/transactions/[id]/correct`** (`ledger.record`; optional `?txnDate=YYYY-MM-DD&paymentMethod=check|cash|other`, malformed is 400 `invalid_body`). 200 `CorrectionPreview`:
- `transaction`: `{ id, txnDate, amountCents, party, memo, categoryId, categoryName, budgetLineId, paymentMethod, checkNumber, bankAccountId, bankAccountName, fundId, fundName, fundKind, entity {id, slug, name}, fiscalYear, reconciled (either mark), matched, updatedAt (ISO; echo as expectedUpdatedAt) }`.
- `callerCanManage`.
- `operations.fill_bank_account`: `{ allowed: true }` or `{ allowed: false, code, status: 403|409, reason }`. Codes here: `already_has_bank_account` 409, `reconciled_session` / `reconciled_legacy` / `matched_open_session` 403. (`check_number_present` and `bank_account_invalid` are POST-only: they depend on input.)
- `operations.correct`: the same decision shape PLUS `tier: { required: "record"|"manage", reasons: ("reconciled"|"prior_fiscal_year"|"fiscal_year_change")[] }`, `dateAndBankEditable: boolean` (false while matched or reconciled), `lockedFields: { code: "reconciled_session"|"reconciled_legacy"|"matched_open_session", message } | null`. Denials possible: `manage_required` 403 (tier is manage and the caller lacks `ledger.manage`; evaluated for the baseline row and for the proposal date), a state code 403 (only when the proposal's date differs from the stored one and the row is matched/reconciled), `would_hide_statement` 409 (proposal date or method). With no proposal, `correct` is `allowed: true` unless `manage_required`.
- `options`: `categories [{id,name}]` (active expense categories of the row's entity and fund kind), `bankAccounts [{id,name,isDefault}]` (active, of the row's entity), `defaultBankAccountId` (via `pickDefaultBankAccount`), `budgetLines` (all expense lines of the row's fund, every FY; filter by the effective date's FY and category client-side as the existing picker does), `paymentMethods`.
- `warnings`: for the proposal when one is sent. **With no proposal it is the worst-case baseline:** the tier warnings plus, when a statement for the row's month was already sent, `sent_statement` and `reports_change`. Show `sent_statement` / `new_month_sent_statement` / `reports_change` only when the user changed category, date, method or budget line (`isStatementAffecting(changed)` is exported); show `reconciled` / `prior_fiscal_year` always. The POST response carries the exact set.
- `reasonLimits: { min: 10, max: 500 }`.
- Top-level 4xx (no preview): 404 `not_found` (incl. non-uuid id), 403 `not_correctable` (not a paid-reimbursement row), 403 `own_request` (caller submitted it), 403 `forbidden`.

**`POST /api/admin/ledger/transactions/[id]/correct`** body is exactly one of (any other key is 400 `invalid_body`, "Unexpected field: x."):
- `{ operation: "fill_bank_account", bankAccountId, expectedUpdatedAt, checkNumber? }` (no `reason`; `checkNumber` absent or blank = leave it; a DIFFERENT number already stored is 409 `check_number_present`).
- `{ operation: "correct", reason (10-500), expectedUpdatedAt, ...at least one of categoryId (uuid, never null), budgetLineId (uuid | null = clear), txnDate (YYYY-MM-DD), paymentMethod (check|cash|other), checkNumber (string | null = clear), memo (1-1000, never null/blank), bankAccountId (uuid, never null) }`. **Send only the fields the user changed** (the server also drops fields equal to the stored value, so an unchanged resend never trips the reconciled refusal).
- 200 `CorrectResponse`: `{ id, operation, changed: CorrectableField[], bankAccountName: string | null, budgetLineLinkCleared: boolean, warnings }`. Use `bankAccountName` for "Added to <account>. It can now be matched in reconciliation." and `budgetLineLinkCleared` for the auto-clear toast (same wording as the edit form).
- Error body for every failure: `{ error: string, code: CorrectionErrorCode }`.

**Code / status map (pinned by a test):** 400 `invalid_body`, `no_change`, `category_invalid`, `bank_account_invalid`, `budget_line_invalid`; 401 (no `code`); 403 `forbidden`, `not_correctable`, `own_request`, `manage_required`, `reconciled_session`, `reconciled_legacy`, `matched_open_session`; 404 `not_found`, `category_not_found`, `budget_line_not_found`; 409 `stale`, `already_has_bank_account`, `check_number_present`, `would_hide_statement`; 500 (`{ error }` only, message `CORRECTION_FAILED_MESSAGE`). `CORRECTION_ERROR_COPY[code]` is the generic copy; for `invalid_body`, `*_invalid`, `would_hide_statement` the `error` text is the specific one, show it as sent. Suggested routing (mirror `moveFailureAction`): 403/404/409 toast + close + refresh; 400 inline; 500 retry. Next steps for the state codes: matched is "Unmatch it first", reconciled session is "Reopen the session" (both are in the copy).

**Pay: `PATCH /api/admin/ledger/reimbursements/[id]` `action: "pay"`:** body gains **`bankAccountId` (required uuid)** and optional **`checkNumber`**; the dialog should send `checkNumber` only for Check. A body without `bankAccountId` is 400 "Reload the page: the payment form now asks which bank account the money came out of." Invalid / inactive / other-entity account is 400 with the validator's sentence ("Bank account not found.", "Bank account does not belong to this entity.", "Bank account is inactive. Select an active account.", "Select a valid bank account."). `note` is still the memo, falling back to the member's description when omitted, so the dialog's pre-filled "Register description" works unchanged. An impossible date such as 2026-02-31 is now 400, not a 500. Method set is `check|cash|other`.

**Create from bank line (`.../reconciliation/sessions/[sessionId]/create-from-bank-line`):**
- `GET ?bankLineId=<uuid>` (`ledger.record`): 200 `{ candidates: CreateFromBankLineCandidate[] }` = `{ transactionId, txnDate, party, amountCents, fundName, bankAccountId | null, bankAccountName | null, checkNumber | null, checkNumberMatchesLine, needsBankAccount, ownRequest }`. Empty for a credit line. 401/403, 404 for unknown session or line (non-uuid ids are 404).
- `POST` body gains optional **`acknowledgeDuplicate`** (strict boolean; a string `"true"` is 400 "acknowledgeDuplicate must be a boolean"). For `flow: "expense"` with a candidate and no `acknowledgeDuplicate: true`: **409** `{ error, code: "possible_duplicate", candidates }` (`PossibleDuplicateBody`), nothing inserted. `ownRequest` is server-computed (user id or member id). Every existing 400/404 is evaluated before the guard.

**Lock kind:** `TransactionLockKind` gains `"paid_reimbursement"` (listed before `approved`); `LockableRow.paidReimbursement?: boolean`. `LOCK_COPY.paid_reimbursement = { label: "Paid reimbursement", nextStep: "Paid reimbursements can't be edited or deleted. Use Correct to change the category, date, method, check number, description or bank account." }`. `editLockKind` is unchanged (still `"approved"`); use the new `editLockDisplayKind(row)` for the label. The register's fact comes from `listPaidReimbursementTransactionIds(db, ids)` in `src/lib/ledger-reimbursement-link.ts` (call it with only the page's approved expense row ids and pass `paidReimbursement` per row).

**Paid tab:** `ReimbursementAdminRow.paidTransaction: { id, bankAccountId | null, bankAccountName | null, checkNumber | null, reconciled } | null` (`src/lib/ledger-queries.ts`). "Needs bank account" is `paidTransaction && paidTransaction.bankAccountId === null && !paidTransaction.reconciled`; hide the button when `isSelf`.

**Recent corrections:** `LedgerCorrectionRow.kind` is now `"moved" | "deleted" | "corrected"` with `changes?: string[]` (render as given; memo text is never in it). `corrected` rows set `from`/`to` null, `rowCount` 1, `amountCents`, `txnDate`, `flow: "expense"`, `reason`, `settledPeriod`. **`src/components/admin/ledger/recent-corrections.tsx` still treats every non-moved row as "Deleted" (`row.kind === "moved" ? "Moved" : "Deleted"`), so it must be switched to an exhaustive `Record<kind, ...>` + `never` check before anything calls the correct route in a real session.** Nothing in the app calls the route yet.

### What I did
- `ledger.ts`: `CHECK_NUMBER_MAX_LEN`, `normalizeCheckNumber`, `REIMBURSEMENT_PAYMENT_METHODS` (+ labels, guard), `pickDefaultBankAccount`, `parseIsoDate` (strict, round-trips), `isBudgetLinePickValid`. All five normalizer call sites now use it (transactions POST, PATCH, create-from-bank-line, pay, correct parser); the POST/PATCH `parseDate` copies are left for B-94 as designed.
- `financial-report-queries.ts`: exported `hasMonthElapsed`; new `rowGatesStatement`, `monthGatedByRows`, `loadEarliestGatingDate`, `newlyHiddenStatementMonth`; `isMonthGatedForEntity` and `getLatestOpenMonthForEntity` refactored onto the one predicate (existing tests pass untouched; brute-force equivalence test added).
- `ledger-correction.ts` / `ledger-audit.ts`: `transaction_corrected` action, `ReimbursementCorrectedAuditPayload` v1, `AuditPayloadMap` (action-keyed; `AuditPayloadFor` is now a lookup), parser overloads (`parseAuditAfter(action, text)` is a new 2-arg overload; the shipped 1-arg moved form is unchanged), reader `switch` over the action with a `never` default, `sentStatementWarning(ym, label, action)`. `schema.ts`: comment only.
- `ledger-transaction-lock.ts`: `paid_reimbursement`, `editLockDisplayKind`, `LOCK_COPY` entry.
- New: `ledger-reimbursement-link.ts`, `ledger-duplicate-candidates.ts` (+ `findCreateFromBankLineCandidates`), `ledger-reimbursement-correction.ts`, `ledger-reimbursement-correction-queries.ts`, the `correct` route. `ledger-fund-move-preview.ts` keeps `findDuplicateCandidates` as a thin wrapper and re-exports the constants and `shiftIsoDate`.
- Pay route, create-from-bank-line route, `listReimbursementsForAdmin`, `scripts/backfill-bank-account.ts` (header note only).

### Outputs
- Lib: `src/lib/ledger.ts`, `ledger-correction.ts`, `ledger-audit.ts`, `ledger-transaction-lock.ts`, `ledger-fund-move-preview.ts`, `ledger-queries.ts`, `financial-report-queries.ts`, `db/schema.ts` (comment), new `ledger-reimbursement-link.ts`, `ledger-duplicate-candidates.ts`, `ledger-reimbursement-correction.ts`, `ledger-reimbursement-correction-queries.ts`.
- Routes: `src/app/api/admin/ledger/transactions/[id]/correct/route.ts` (new), `reimbursements/[id]/route.ts`, `reconciliation/sessions/[sessionId]/create-from-bank-line/route.ts`, `transactions/route.ts` and `transactions/[id]/route.ts` (normalizer import only; the `approvedAt` guard is not touched).
- Tests (new or extended): `ledger.test.ts` (T1-T5), `ledger-reimbursement-correction.test.ts` (T6-T12), `ledger-reimbursement-correction-queries.test.ts` (T13-T20), `correct/route.test.ts` (T21), `transactions/[id]/route.test.ts` + `route.delete.test.ts` + `split/route.test.ts` (T22, T1 PATCH pin), `transactions/route.test.ts` (T1 POST pin), `financial-report-queries.test.ts` (T23-T25), `ledger-transaction-lock.test.ts` (T26), `ledger-audit.test.ts` (T27-T31), `ledger-duplicate-candidates.test.ts` (T32-T34), `create-from-bank-line/route.test.ts` (T35-T36, T1 pin), `reimbursements/[id]/route.test.ts` (T37), `ledger-queries.reimbursements-admin.test.ts` (T44 query half), `ledger-reimbursement-link.test.ts` (T46).
- Decisions: none new (DECISION-114 already filed). Schema changes: none; no migration.

### Deviations and judgment calls (all small; flip if you disagree)
1. **GET baseline `warnings` are worst-case** (see contract). The design had "proposal else baseline" without saying what baseline contains; the proposal params cannot express a category change, so the baseline includes the sent-statement warning for the row's month and the UI gates its display on what the user changed.
2. **Budget-line auto-clear runs only when the category or date changed** (the PATCH route runs it on every edit). A memo-only or check-number-only correction never touches the link, so a stale link cannot be cleared as a surprising side effect.
3. **`new_month_sent_statement` is shown only when the new date is in a different month** than the old one and that month has a sent statement.
4. **Statement-hide rule uses the legacy `reconciled` column** (the one the SQL gate uses) to decide whether the row gates, so it mirrors `isMonthGatedForEntity` exactly; a date change on a reconciled row is already refused earlier.
5. **Pay-route validator order:** `bankAccountId` presence is checked with the other body validators (after `paymentMethod`, before the check number), and the account is validated on `db` right after the fund, before the category (R5 as designed).
6. **`CorrectableField` and the audit side types live in `ledger-correction.ts`** and are re-exported from `ledger-reimbursement-correction.ts`, to avoid a type cycle between the two modules.
7. **`findCreateFromBankLineCandidates` lives in `ledger-duplicate-candidates.ts`** (it owns the `ownRequest` and check-number matching); the route's GET and POST both call it. A second query reads the linked submitter ids (no join), so a multi-link row (B-129) cannot duplicate candidates.
8. **`MoveDuplicateCandidate`** stays its own interface (R7). `fill_bank_account` is exempt from the tier even for a prior-year row, and still audited at `tier: "record"`.
9. Not done by design: the register page wiring, dialogs, Paid-tab UI, Recent-corrections component, guide sections, `transaction-form.tsx` helper migration (all ux-developer), and the e2e spec (qa).

### Open questions / handoff notes
- **Next agent: ux-developer.** Contract above; T38-T45 are theirs. The register needs `listPaidReimbursementTransactionIds(db, ids)` for the page's approved expense rows.
- `RecentCorrections` must be made exhaustive before any real use of the route (see above).
- `transaction-form.tsx` still has two inline `find(a => a.isDefault)` sites to migrate to `pickDefaultBankAccount`, and its literal `maxLength={20}` to `CHECK_NUMBER_MAX_LEN`.
- Live-database checks a mocked db cannot prove (qa): the `FOR UPDATE` serialization of repair vs `/match` both directions, the EXISTS fragment inside the pinned UPDATE on real Postgres, and the `PgDialect` WHERE rendering of `NOT EXISTS` against a real row.
- Concurrency note: another pipeline edited `ledger-audit.ts` / `ledger-audit.test.ts` (DECISION-115 `recordLedgerAuditNote`) while this ran; both edits coexist and the full suite is green. I did not touch `permissions.ts`, nav, email-queue, categories, budgeting, events, fund/donor/settings routes or migration 0110.
- Release note: R1 (a method change away from Check can also be refused as `would_hide_statement`) is implemented as designed and should be named for the treasurer.

### Gate lines
- `pnpm exec tsc --noEmit`: exit 0, no output.
- `pnpm test`: `Test Files  180 passed (180)` / `Tests  3205 passed (3205)`.
- `pnpm build:only`: exit 0 (production build completes, route table printed).
- `pnpm lint`: 0 errors; 1 pre-existing warning in `src/components/admin/ledger/budget-context-panel.tsx` (not touched here); every file touched by this work is clean.


## Phase 4 (UI) — ux-developer — 2026-10-02

**Owner:** ux-developer
**Status:** complete

### Summary
The whole UI half is built on the api-developer's contract: the Correct / Add bank account dialog (one component, two modes, preview-driven with live date/method proposal checks), the register's `Paid reimbursement` lock label with Correct, Add bank account and the self-action rule, the pay dialog (required bank account with the shared default picker, Check-only check number, "Register description" pre-filled), the Paid-tab Account and Check # columns with the "Needs bank account" badge, the create-from-bank-line duplicate advisory and the match-picker hint, `RecentCorrections` made exhaustive over `moved | deleted | corrected`, the two `transaction-form.tsx` helper migrations and the Treasury Guide paragraphs. T38 to T45 are written and green. No `src/lib/*.ts`, API route, `docs/decisions.md` or `docs/backlog.md` change; no `console.log`; no native dialogs.

### What I did
- **Correct dialog** (`correct-reimbursement-dialog.tsx` + `-logic.ts`): Radix via `LedgerDialogShell`, same presentational-body-plus-container split as Move so every phase renders DOM-less. Phases: loading, load_error (retry), blocked (top-level `not_correctable` / `own_request` / 404, or a baseline per-operation denial such as `manage_required` or a state code), form, success. Modes: `add_bank_account` (account select preselected from `preselectBankAccountId`, else the entity default via `pickDefaultBankAccount`, check number only when the row has none, no reason field) and `correct` (category, `BudgetLinePicker`, date, bank account, method, check number when Check, register description, required reason via `CorrectionReasonField`). Sends only changed fields by reusing the server's own `diffCorrection`. Date and bank account disable with `lockedFields.message` when `dateAndBankEditable` is false. Changing the date or method re-GETs with `?txnDate=&paymentMethod=` so the sent-statement warning and a `would_hide_statement` refusal appear before Save (Save stays disabled on a refusal). Warnings per the api-developer's note: `reconciled` / `prior_fiscal_year` always; `sent_statement` / `new_month_sent_statement` only after category, date, method or budget line changed; `reports_change` only after category or date changed (`visibleWarnings`). A category or date change that orphans the budget-line pick drops it client-side (`applyValuePatch`, sends `budgetLineId: null`) with a one-line note.
- **Register** (`transaction-actions.tsx`, `[fundSlug]/page.tsx`): new optional `paidReimbursement` prop fed by `listPaidReimbursementTransactionIds(db, ids)` over only the page's approved expense rows. Label and Delete tooltip come from `editLockDisplayKind`; Correct replaces Edit (always enabled, the server decides tier); Delete disabled with the new copy; the "No bank account. It can't be reconciled yet." line plus an **Add bank account** button when the account is null and the row is unreconciled. Non-reimbursement approved rows render byte-identically (pinned by a test).
- **Pay dialog** (`pay-reimbursement-dialog.tsx` + `-logic.ts`): required bank-account select filtered to the selected fund's entity, preselected through `resolveBankAccountId` (keeps a still-valid pick across a fund/entity change), amber blocking message and disabled Mark Paid when the entity has no active account; Check number (`maxLength={CHECK_NUMBER_MAX_LEN}`) shown and sent only for Check; "Note" is now **Register description**, a textarea pre-filled with the member's description (max 1000). The reimbursements page loads active accounts per entity (`getBankAccounts`) and passes `bankAccounts` and `description`.
- **Paid tab** (`reimbursements/page.tsx`, `paid-reimbursement-logic.ts`, `add-bank-account-button.tsx`): Account and Check # columns; "Needs bank account" badge; Add bank account button, hidden on the viewer's own request (a short "Submitted by you" note instead) and for viewers without `ledger.record`.
- **Create from bank line** (`reconciliation-create-from-bank-line-dialog.tsx`, `duplicate-payment-advisory.tsx`, `create-from-bank-line-logic.ts`): on a debit line it GETs candidates; a gold advisory shows per candidate, with **Use that entry instead** (disabled with the reason on an own request) and the "This is a different payment" tick that gates **Create & Match** and makes the POST carry `acknowledgeDuplicate: true`. A POST 409 `possible_duplicate` repopulates the same panel. The grid closes the dialog and opens the repair dialog (session account preselected) for a needs-bank-account candidate, then reopens the picker filtered to the amount once the repair saved; an already-on-account candidate goes straight to the picker. Literal `maxLength={20}` migrated.
- **Match picker**: optional `initialQuery`, optional `sessionBankAccountId`; for a debit line with no same-amount expense candidate it GETs the candidates and shows "A paid reimbursement of $X to <party> has no bank account, so it is not in this list." with an Add bank account button. A lookup failure shows nothing and never blocks the dialog.
- **`recent-corrections.tsx`**: a `Record<kind, badge>` plus an exhaustive `switch` with a `never` check; a `corrected` card renders the Corrected badge (green), the headline, the server-composed `changes` list (never memo text), the reason and the usual settled/statement badges. Compliance page copy updated.
- **`transaction-form.tsx`**: both inline `find(a => a.isDefault)` sites now use `pickDefaultBankAccount`; `maxLength={20}` is `CHECK_NUMBER_MAX_LEN`.
- **Treasury Guide**: Books & the Register ("Correcting a paid reimbursement": Correct, Add bank account, field locks, unmatch-correct-rematch, Manage Ledger tier, statement refusal, own request), Reimbursements (account, check number, Register description, Paid-tab badge), Reconciliation (duplicate warning, Use that entry instead, picker hint, closed-period unwind).

### Outputs
- New: `src/components/admin/ledger/correct-reimbursement-dialog.tsx`, `correct-reimbursement-dialog-logic.ts`, `pay-reimbursement-dialog-logic.ts`, `paid-reimbursement-logic.ts`, `add-bank-account-button.tsx`, `duplicate-payment-advisory.tsx`, `create-from-bank-line-logic.ts`.
- Modified: `pay-reimbursement-dialog.tsx`, `transaction-actions.tsx`, `transaction-form.tsx`, `reconciliation-create-from-bank-line-dialog.tsx`, `reconciliation-match-picker.tsx`, `reconciliation-matching-grid.tsx`, `recent-corrections.tsx`, `guide/books-register-section.tsx`, `guide/reimbursements-section.tsx`, `guide/reconciliation-section.tsx`; pages `reimbursements/page.tsx`, `[fundSlug]/page.tsx`, `reconciliation/[sessionId]/page.tsx`, `compliance/page.tsx`.
- Tests (T38 to T45): `pay-reimbursement-dialog-logic.test.ts`, `correct-reimbursement-dialog-logic.test.ts`, `correct-reimbursement-dialog.test.tsx`, `transaction-actions.test.tsx` (T40, T43 file list), `reconciliation-create-from-bank-line-dialog.test.tsx` (T41), `reconciliation-match-picker.test.tsx` (T42), `recent-corrections.test.tsx` (T44), `paid-reimbursement-logic.test.ts` (T44), `guide/reimbursement-correction-guide.test.tsx` (T45).
- Decisions: none new.

### Gate lines
- `pnpm exec tsc --noEmit`: exit 0, no output.
- `pnpm test`: `Test Files  188 passed (188)` / `Tests  3294 passed (3294)`. No concurrent-agent flake occurred.
- `pnpm build:only`: exit 0 (route table printed).
- `pnpm lint`: 0 errors; 1 pre-existing warning in `src/components/admin/ledger/budget-context-panel.tsx` (not touched); every file touched here is clean.

### Dev walk (DATABASE_URL, e2e admin, Chromium via a temporary Playwright spec, since deleted)
Seeded with example.invalid fixtures: three paid reimbursements with unaccounted check rows (method check, no check number), one open session on Administrative Checking with two debit bank lines. All passed: register shows "Paid reimbursement." / "No bank account." / Correct enabled / no Edit / Delete disabled; Add bank account preselected Administrative Checking, saved with check number 8249, DB row has the account and number and an unchanged `approvedAt`; the row then appears in the open session's match picker with 8249; Correct changed the category with a reason (Save disabled until a change plus a 10-character reason), DB updated, and the Compliance page shows the **Corrected** card with "Category: ..." and the reason; on the other line the picker shows the no-bank-account hint, create-from-bank-line shows the advisory, Create & Match is disabled until the box is ticked, **Use that entry instead** opens the repair with the session account preselected and, once saved, the picker reopens with that row listed; an own-request row shows the blocked message from Correct and, on the Paid tab, no Add bank account button; at 360px the Correct dialog fits (width at most 360, Save and Cancel reachable). No new console errors (only the existing logo and dev-only CSP-eval noise). **Every fixture (transactions, reimbursements, session, bank lines, audit rows, fixture user and member) was removed; a follow-up query returned 0 for each, and 0 `transaction_corrected` rows remain.**

### Deviations and judgment calls
1. **"Create anyway" is a tick box, not a ConfirmDialog.** Phase 3 and T41 specify the "This is a different payment" tick gating Create & Match, so I followed the design; the tick is the confirmation. Flip to a ConfirmDialog if you prefer the literal reading of the task.
2. **Two 409s stay inline instead of close-and-refresh:** `would_hide_statement` and `check_number_present`, because the user can fix them in place and the form would otherwise be lost. Every other 403/404/409 closes, toasts and refreshes as the code map says.
3. **`reports_change` is stricter than `isStatementAffecting`:** shown only after a category or date change (the server only emits it for those), while the sent-statement warnings follow `isStatementAffecting`.
4. **Auto-reopen of the picker** after a successful repair started from "Use that entry instead", filtered to the amount; not in the design, one step saved for the treasurer.
5. The correct dialog is mounted only while open from the register, Paid tab and grid (a conditional `open` mount), so there is no close animation on those entry points.
6. The hook-prefixed helper was named `offerInsteadAction` (a `use...` name trips the rules-of-hooks lint). T42 and the guide tests live in their own files. The pay dialog has no body-render test because Radix renders nothing while closed: its rules are tested in the logic file and by source assertions.
7. Dev-walk finding, not a bug: the candidate finder only considers a reimbursement within 30 days of the bank line's posting date, so a seeded line must be dated near the row.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** Click-through: (1) `/admin/ledger/reimbursements` as a recorder, open Mark Paid and check the bank account preselection, the Check-only check number and the pre-filled Register description (do not actually pay: it emails); (2) the Paid tab columns and the "Needs bank account" badge (production has exactly two such rows); (3) the register row for one of them: label, Add bank account, then Correct; (4) an open session on that account: the repaired row in the match picker; (5) create-from-bank-line on a debit line equal to an unmatched paid reimbursement; (6) `/admin/ledger/compliance` Recent corrections; (7) 360px for both dialogs.
- Live-Postgres checks a mocked db cannot prove remain qa's (from the server handoff): the `FOR UPDATE` serialization of repair vs match in both directions, and the `EXISTS` fragment inside the pinned UPDATE.
- New copy the Lions Club may want to refine: "Register description" and its help line; "This payment may already be in the register"; "This is a different payment"; "No bank account. It can't be reconciled yet."; "Needs bank account"; the picker hint; the three Guide additions.
- The release note should name R1 (a method change away from Check can be refused as `would_hide_statement`) and that the `approved` copy for non-reimbursement approved rows still says "refund entry" (out of scope).

---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-10-02

**Owner:** qa
**Status:** complete

### Summary
**Verdict: PASS.** Every gate is green (typecheck exit 0, 188 files / 3294 unit tests, production build exit 0, lint 0 errors), the new e2e spec passes serially on repeat runs, the three regression specs pass, and the live walk against a real Postgres reproduced the production shape (two paid reimbursements with a check method, no bank account, no check number) and behaved as designed in every scenario the brief listed: repair, match, close with a balanced tie-out, the locked row, correct, the statement-hiding refusal, self-action, both concurrency orders, the zero-row sentinel path, the server-enforced duplicate guard, the pay dialog (not submitted) and 360px. No defect found. Three observations for the orchestrator are listed under "Observations" (none blocks); the one that differs from the brief's wording is that on the **register** an own-request row still shows its Correct / Add bank account buttons (the dialog then refuses with the explanation), while the **Paid tab** hides the button as Phase 3 specified. The local dev database is back to its pre-test counts (verified).

### What I did

**1. Gates (verbatim)**

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm test` | `Test Files 188 passed (188)` / `Tests 3294 passed (3294)`, duration 3.99s |
| `pnpm build:only` (real exit code, not piped) | exit 0; `✓ Compiled successfully`, `Finished TypeScript`, `✓ Generating static pages (125/125)`; `/api/admin/ledger/transactions/[id]/correct` is in the route table; no warnings or errors in the output |
| `pnpm lint` | exit 0, 0 errors, 1 pre-existing warning (`budget-context-panel.tsx:114` unused eslint-disable; not touched by this work). Re-run after the new spec was added: unchanged |
| `pnpm test:e2e e2e/ledger-reimbursement-correct.spec.ts` (serial, single worker) | run 1 failed on a selector bug in my own spec (a strict-mode locator matched the sr-only label and the cell); fixed. Then **three consecutive passes, 7/7** (37.7s, 40.9s, 40.7s). The DB was at baseline before and after each |
| Regression specs, once each | `ledger-move-transaction` 15/15, `deposit-in-transit-carveout` 2/2, `prior-year-cause-line-reconcile` 1/1: **18 passed (1.3m)** |

**2. Diff review** (against Phase 3 and Phase 2 rulings 1 to 9; read in the code, not inferred from tests)
- **approvedAt guards on PATCH / DELETE / split untouched and pinned.** `git diff` on `transactions/[id]/route.ts` is the normalizer import and the removal of the local copy only; `split/route.ts` has no diff. The PATCH guard (`if (existing.approvedAt)`, line 191) still precedes `request.json()`. Pins: `route.test.ts:653` (seven body shapes, `request.json` never called, no update or insert), `route.delete.test.ts:375`, `split/route.test.ts:275`. Mutation check below proves they bite.
- **Correct route guard order** matches the Phase 3 table: auth 401, `hasFeature(LEDGER_RECORD)` before any row read, `isUuid` 404, body shape 400 (pure, before any DB read), `FOR UPDATE` as the first statement in the transaction, `not_correctable`, `own_request`, `stale` (compared with `getTime()`), state, `no_change`, tier, semantic input, `would_hide_statement`, pinned UPDATE, audit last. The guard-order table test (T13) and GET/POST parity test (T19) exist and pass.
- **Pinned UPDATE.** `fillWhere` re-pins `bank_account_id IS NULL`, `status = 'posted'`, `reconciled = false`, `reconciled_session_id IS NULL`, `approved_at IS NOT NULL` and `NOT EXISTS (match)`. `correctWhere` re-pins `approved_at IS NOT NULL` always and the two reconciled marks only when date or bank account change. Neither SET can contain the stamp (key-set pins T15; live: `approved_at = created_at` on all ten fixture rows after every fill and correct). **Not re-pinned in the correct UPDATE: match absence** (see Observation 2).
- **Zero rows throws the sentinel** (`CorrectionRollback`), mapped to 409 in `executeCorrection`; the audit insert is the last statement on the same `tx`; `updatedAt` is in both SETs. Read the transaction body in full.
- **Eligibility in one home.** `ledger-reimbursement-link.ts` owns the `EXISTS` fragment and both loaders; the finder uses `paidReimbursementExists`. (Observation 3: the "paid link" is re-encoded in four queries, all inside those two files.)
- **Five normalizer call sites** all import the shared `normalizeCheckNumber` from `@/lib/ledger` (transactions POST, PATCH, create-from-bank-line, pay, the correct parser). Grep for leftover `CHECK_NUMBER_MAX_LEN =`, inline trim-and-cap or `maxLength={20}`: only the one definition in `ledger.ts`; the dialogs' `.trim()` before send is input prep, not a second validator. The two removed server copies (POST, create-from-bank-line) were byte-identical to the shared one; the removed PATCH copy differed only for `undefined`, which its call site already guards.
- **`recent-corrections.tsx`**: `KIND_BADGE: Record<CorrectionKind, ...>` plus a `const unreachable: never = row.kind` (line 94).
- **Pay route** requires `bankAccountId` (400 with a human sentence) and validates it with `validateBankAccountForEntity(db, id, fund.entityId, { requireActive: true })` before the transaction; insert carries `bankAccountId` and the normalized check number.
- **create-from-bank-line** 409 `possible_duplicate` is server-enforced (strict boolean flag, runs after every existing validation and before the insert).
- **Statement-hiding refactor** is behavior-preserving: `isMonthGatedForEntity` still early-returns on a non-elapsed month and now delegates to `monthGatedByRows`; test file changes are 154 insertions, 0 deletions; the brute-force equivalence test is at `financial-report-queries.test.ts:811` and passes. (Nit: `monthGatedByRows` repeats the elapsed check the caller already made; harmless.)
- **No `console.log`** in any new or touched non-script source (the only hits are in `scripts/backfill-bank-account.ts`, a CLI, and a pre-existing dev-mode line in the email-queue retry route, neither from this feature). `console.error` / `console.warn` in routes follow the existing convention. **No native dialogs** (`window.confirm|alert|prompt` none; the new dialogs are in the no-native-dialogs test's file list).
- **`admin-page-feature-gates.test.ts` passes** (inside the 188/188 run, and again in an isolated run with the correct-queries and transactions suites: 13 files, 506 tests).

**3. Live walk** (dev server restarted with `next dev` directly so the in-flight migration 0110 from the concurrent B-111 pipeline did not run against the database; `DATABASE_URL` only, never `PROD_DATABASE_URL`; `EMAIL_DEV_ALLOWLIST` unset so nothing could be delivered). Baseline counts recorded first and compared at the end.

Fixtures (all `E2E QA B108` / `example.invalid`): 7 paid reimbursements with approved, locked check-method expenses and no bank account (one pair mirrors production: `T1`, `T2`), 1 submitted request, 2 open sessions (Administrative Checking and Petty Cash) with debit lines, 1 sent-statement row for September, 3 fixture users (no role; admin role as the submitter of `T2/T4/T5/T7/T8`; a temporary record-only role).

| Flow | Result | Observed |
|---|---|---|
| (a) Add bank account on `T1` with check number 8249, via the register dialog | pass | Default account preselected; DB row has the account and `8249`, `approvedAt` unchanged; one `transaction_corrected` audit row (fixed reason, `tier: record`, no party or member name anywhere in it) |
| (a) Appears as a match candidate in the open Administrative session | pass | Picker listed exactly `T1` with `8249` (the null-account rows are correctly absent); matched through the UI |
| (a) Close the session with a balanced tie-out | pass | Tie-out Opening 0 / Cleared -$73.11 / Closing -$73.11 / Delta 0 ("Balanced."); closed through the UI; `T1` reconciled with `reconciled_session_id` set |
| (a) Reconciled row no longer correctable; arithmetic did not move | pass | `fill_bank_account` 409 `already_has_bank_account`; `correct` date 403 `reconciled_session`; `correct` bank account 403 `reconciled_session`. Session opening/closing, matched-line sum and the row's amount/account/date identical across all probes. A category-only correction on this row succeeds for a `ledger.manage` holder by design (tier `manage`, "Settled period" badge) and still moves nothing; a record-only user gets 403 `manage_required` (Observation 4) |
| (b) `correct` category with a reason on `T2` | pass | 200; Corrected card on `/admin/ledger/compliance` with `Category: Program supplies to 4th of July Parade`, the reason, who and when; the memo text never appears on the page |
| (b) Earlier date that would hide a visible month (cash row `T5`, 2026-10-01 to 2026-09-10) | pass | 409 `would_hide_statement` ("...would hide the September 2026 monthly statement..."); GET preview with `?txnDate=2026-09-10` shows the same denial before Save; row unchanged. Same-month later date: 200 |
| (b) Method away from Check that would hide (check row `T4`, Sept) | pass | `cash` and `other` both 409 `would_hide_statement`; GET preview `?paymentMethod=cash` agrees; row unchanged. `T5` Cash to Check: 200 (an unreconciled check is exempt from the gate) |
| (b) Sent statement warning | pass | A category change on the September row returned a `sent_statement` warning and the audit row records `sentStatementMonth: "2026-09"` |
| (b) Guards | pass | Unknown key `amountCents` / `fundId` / `approvedAt` 400; missing reason, 9-character reason, `reason` on fill, missing `operation` 400; stale token 409; `no_change` 400; non-uuid 404; ordinary posted row 403 `not_correctable`; other-entity bank account and bogus uuid 400 `bank_account_invalid`; 21-character check number 400; unauthenticated 401 |
| (c) Self-action | pass at the API, partial in the UI | As the submitter (admin role): GET preview, fill and correct all 403 `own_request`, including a second row of the same member; the same user is allowed on another member's row. As a user with no role: 403 `forbidden` on GET and POST (and on create-from-bank-line GET). **UI:** the Paid tab hides **Add bank account** and shows "Submitted by you. Another reviewer must add its bank account."; on the **register** the Correct and Add bank account buttons are still shown and open a "can't be corrected / can't be added" dialog with the reason and no submit button (Observation 1) |
| (d) Concurrency: hold `FOR UPDATE` in psql, fire `fill_bank_account` | pass | Request waited ~6.0s (the hold), then 200; row filled, one audit row |
| (d) Reverse, repair first: `correct` (bank account) stalled after its state read by an `ACCESS EXCLUSIVE` lock on `ledger_bank_accounts`, `/match` fired meanwhile | pass | `correct` 200 (row moved to Administrative Checking); `/match` 409 `transaction_account_mismatch`; zero match rows for the row, no orphan |
| (d) Reverse, match first: `/match` queued ahead of `correct` (date) behind a held row lock | pass | `/match` 201; `correct` 403 `matched_open_session`; date unchanged; exactly one match row |
| (d) The pinned UPDATE's SQL on real Postgres | pass | Executed the exported `fillWhere` / `correctWhere` / `paidReimbursementExists` against the live rows: fill matches 1 on a clean row, **0 with a match row present**, 0 with the legacy mark, 0 with a session pointer, 0 with an account set, 1 after the match is removed; `correctWhere` date/bank on a reconciled row 0, non-date/bank 1; the `EXISTS` fragment selects 10 of 10 fixture rows, 9 after one reimbursement is set to `submitted`, 0 for an ordinary row |
| (d) Sentinel path, made observable on real Postgres | pass | A concurrent writer cannot make the row ineligible mid-flight (the app's `FOR UPDATE` blocks every writer, including `/match`'s foreign-key lock; `session_replication_role` is not permitted for this role), so I injected the fault: a `BEFORE UPDATE` row trigger that returns NULL makes the pinned UPDATE return zero rows. `fill_bank_account` then returned 409 `already_has_bank_account` and `correct` 409 `stale`; both rows byte-identical (including `updated_at`) and **no audit row**. With the fault removed the same call succeeded. A second fault (a trigger that raises on the audit insert) returned 500 "Nothing was changed." and the category UPDATE that preceded it was rolled back. Both triggers and functions dropped (verified) |
| (e) create-from-bank-line on a debit line equal to an unrepaired reimbursement | pass | GET returns the candidate (`needsBankAccount: true`, `ownRequest: false`); POST without the flag 409 `possible_duplicate`, **0 rows inserted, 0 matches**; `"true"` string 400; `false` 409; credit line (income) never checked, 201; `true` 201. UI: advisory shown, **Create & Match disabled until "This is a different payment" is ticked**, **Use that entry instead** opens the repair with the *session's* account (Petty Cash) preselected; after saving, the entry is listed in the picker. From the picker's own "no bank account" hint the repair opens stacked over the picker and both close on Done (Observation 5) |
| (f) Pay dialog, not submitted | pass | Bank account required, preselected to Administrative Checking; Check number field present for Check, gone for Cash; "Register description" pre-filled with the member's description; Mark Paid disabled until a category is chosen. A route guard aborted any `PATCH`: 0 attempted; the request stayed `submitted`; `email_queue` unchanged. Separately, the pay route's server validation was probed with bodies that all stop before any write: no `bankAccountId` 400 ("Reload the page..."), other-entity account 400, bogus uuid 400, 21-character check number 400, impossible date `2026-02-31` 400 (was a 500), method `zeffy` 400; status, transaction count and `email_queue` unchanged |
| Paid tab | pass | Account and Check # columns; "Needs bank account" badge on null-account rows; Add bank account button on those rows |
| (g) 360px | pass | Screenshots in the scratchpad `qa/shots/`: `g-correct-dialog-360-top.png`, `-bottom.png`, `-filled.png` (dialog 336px wide inside the 360 viewport, Save 304x48 and Cancel 304x52 reachable by scrolling inside the dialog, Save disabled until a change plus a reason), `g-register-label-360.png` (label wraps to "Paid reimbursement." beside the lock icon in the Actions column; the table scrolls horizontally inside its own container at 360 exactly as every existing register row does, the page itself has no horizontal scroll), `g-compliance-360.png` (no horizontal scroll). The only console error is the existing dev-only `eval()` CSP noise |

**Cleanup.** Every fixture was removed (reimbursements, transactions, sessions, bank lines, matches, audit rows by target id and every `transaction_corrected` row, the report-send row, fixture users, members, the temporary role and its feature bindings, user-role rows) and the counts compared to the pre-test snapshot: transactions 281, reimbursements 0, sessions 0, bank lines 0, matches 0, audit 788, report sends 0, users 53, members 48, user roles 70, email_queue 1185, **identical**, also after the e2e runs. One side effect I removed: signing in as a fixture user with no member record enqueued "New portal user needs member record review" to `info@` (status `blocked_non_production`, never delivered). No role or link on the e2e admin was changed.

**4. Regression-test discipline (mutation proof that the pins bite).** Each mutation was applied, the named suite run, and the file restored byte-identical (sha before and after compared):
- **approvedAt guard unconditional on PATCH.** Mutant: `if (existing.approvedAt && false)`. Result: 8 failures in `route.test.ts` (test 12 and all seven T22 shapes). Pins: `src/app/api/admin/ledger/transactions/[id]/route.test.ts:653`, `route.delete.test.ts:375`, `split/route.test.ts:275`.
- **Sentinel rollback.** Mutant: `throw new CorrectionRollback(...)` replaced by `return fail(...)` (a `return` inside `db.transaction` commits). Result: `ledger-reimbursement-correction-queries.test.ts:438` fails (`txEnd` is `committed`, not `rolled_back`). Companion pin at `:558` (audit failure rolls back). Live proof above.
- **Statement-predicate equivalence.** Mutant: drop the "month already hidden by another gating row" limit. Result: 4 failures at `financial-report-queries.test.ts` including the brute-force test at `:811`.
- New e2e regression titles carry the required suffix: `ledger-reimbursement-correct.spec.ts:356` (— regression for a paid reimbursement that could never be matched because it had no bank account) and `:505` (— regression for create-from-bank-line double-booking a reimbursement payment).

### Outputs
- New: `e2e/ledger-reimbursement-correct.spec.ts` (7 tests, serial; DB-seeded with the tag `E2E QA Reimb Correct`, example.invalid member, cleanup before and after including audit rows by target id; never drives Mark Paid; sends no email). Covers label and Correct-instead-of-Edit, Add bank account then match then close then the lock (409 / 403 and unchanged session arithmetic), category correction with the reason showing under Recent corrections and no memo, the duplicate advisory and `Use that entry instead`, the server-side guard, the route gates (401, 404, 400 unknown and stamp keys, 403 `not_correctable`) and the 360px dialogs.
- No source, `decisions.md` or `backlog.md` change. Live-walk scripts and screenshots are in the session scratchpad only (`.../scratchpad/qa/`), nothing added to the repo besides the spec.
- The dev server I restarted is still running on :3000 (log in the scratchpad), as it was found.

### Coverage on critical modules (`pnpm test -- --coverage`, v8)
- `src/lib/events.ts`: 94.86% statements (target 90%)
- `src/lib/permissions.ts`: 100% (target 100%)
- `src/lib/members.ts`: 86.84% statements (target 80%)
- Overall pure `src/lib` modules: 73.19% statements (target 70%)
- New or changed by this feature: `ledger.ts` 100, `ledger-correction.ts` 100, `ledger-duplicate-candidates.ts` 100, `ledger-reimbursement-link.ts` 100, `ledger-transaction-lock.ts` 100, `ledger-reimbursement-correction.ts` 97, `ledger-reimbursement-correction-queries.ts` 95.21, `ledger-audit.ts` 96.42, `financial-report-queries.ts` 82.51 (the pre-existing file's I/O functions account for the remainder).

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? (before the row read) | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /api/admin/ledger/transactions/[id]/correct` | yes (401) | yes, `authorize()` runs before the id, the proposal and the row | `LEDGER_RECORD`; `LEDGER_MANAGE` is read only to derive `callerCanManage` for the server-computed tier |
| `POST /api/admin/ledger/transactions/[id]/correct` | yes | yes, same `authorize()`, before body parse and row read | `LEDGER_RECORD`; tier `manage` enforced server-side from the locked row (`manage_required`), `fill_bank_account` record tier by ruling |
| `GET /api/admin/ledger/reconciliation/sessions/[sessionId]/create-from-bank-line` (new) | yes | yes, before session and line reads | `LEDGER_RECORD` |
| `POST .../create-from-bank-line` (changed) | yes | yes, before the body parse | `LEDGER_RECORD` |
| `PATCH /api/admin/ledger/reimbursements/[id]` (pay, changed) | yes | yes, "checked before the row read" (line 208 precedes `getReimbursementWithMember`) | `LEDGER_RECORD` (unchanged) |
| `POST /api/admin/ledger/transactions` and `PATCH` / `DELETE /api/admin/ledger/transactions/[id]` (normalizer import only) | yes | yes, unchanged | `LEDGER_RECORD` (unchanged); the `approvedAt` guard unchanged |
| Pages `/admin/ledger/[fundSlug]`, `/admin/ledger/reimbursements`, `/admin/ledger/reconciliation/[sessionId]`, `/admin/ledger/compliance` | yes (redirect `/signin`) | yes, each checks its own `LEDGER_VIEW` / `RECORD` / `MANAGE` (redirect `/access-pending`); the register only loads the paid-reimbursement id set when `canRecord` | existing keys, unchanged |
| Server actions (`"use server"`) | none added or changed (none found under `components/admin/ledger` or the ledger admin pages) | n/a | n/a |

No protected route is reachable by a caller without `ledger.record`; verified live (a user with no role gets 403 `forbidden` on both verbs before any row read, and 401 with no session).

### Verified fact vs. theory
- **Established** (reproduced, more than one method): everything in the live table above, each confirmed by an HTTP response plus a direct database read; the unit pins confirmed by mutation; the sentinel and audit-rollback behaviors confirmed by fault injection on real Postgres.
- **Believed, not demonstrated:** that a true mid-flight ineligibility cannot occur through concurrency (the lock ordering supports this, both race orders held, but I did not try to disable foreign-key triggers, which this database role is not permitted to do). That is why the sentinel is exercised by fault injection rather than by a race.

### Observations (none blocks the verdict)
1. **Own-request buttons on the register are not hidden.** The brief expected both buttons hidden for the submitter. Phase 3 specified hiding only on the Paid tab (done, with an explanatory line) and says the register's Correct is "always enabled... the dialog explains". The server refuses regardless. If the orchestrator wants the register to match the brief, the register page would need the linked reimbursement's submitter, which it does not load today; a small ux-developer follow-up, not a defect against the design.
2. **`correct`'s pinned UPDATE does not re-pin "no match" for a date or bank-account change** (it re-pins both reconciled marks; the match check happens once after the row lock via `loadOpenMatch`). This is what Phase 3 specified for `correct` (the fill UPDATE does re-pin it), and both race orders were proven live, so it is not a gap in practice. Worth knowing if the lock ordering is ever changed.
3. **Duplication, small:** "a paid reimbursement links to this row" is encoded four times (`EXISTS` fragment, the id-set loader, the per-row loader, and the finder's submitter-id query), all in two files. One definition of eligibility is true (`correctableRowKind` plus the loader); B-129 (a unique index) would make this tidier.
4. **Reconciled and prior-year rows stay correctable for category, method, check number and memo at the `ledger.manage` tier** (by DECISION-114 item 4). In dev the `treasurer` role holds `ledger.manage` as well as `ledger.record`, so `manage_required` was only reachable with a temporary record-only role (done, then removed).
5. **Picker hint path:** "Add bank account" from the match picker's "no bank account" line opens the repair stacked on the picker and, after Done, both dialogs close (the "Use that entry instead" path from create-from-bank-line does re-open the picker filtered to the amount). One extra click for the treasurer; not in the design either way.
6. **Compliance Recent corrections is visible to any `ledger.view` holder** (the page's existing gate, per DECISION-110 item 3), including the free-text reasons. Unchanged by this feature, noted because corrections now also carry account and category names.
7. Test-hygiene: the report-send and role fixtures I created are why `ledger.manage`'s tier could be tested live; no production behavior depends on them.

### Open questions / handoff notes
- **Next agent: analyst for Phase 6** (PASS). Phase 6 should weigh Observation 1 against the Phase 1 intent for the self-action rule.
- Release note must name R1 (a method change away from Check can be refused as `would_hide_statement`; verified live) and that the `approved` copy for non-reimbursement approved rows still says "refund entry" (out of scope).
- Post-deploy (qa, production): `SELECT count(*) FROM ledger_transactions WHERE status='posted' AND bank_account_id IS NULL` should be 0 after the treasurer repairs the two October 1 rows, and both bank lines in the open Admin September session should then be matchable. Not runnable from here (production is read-only to this session and `PROD_DATABASE_URL` was deliberately not used).
- Manual items the runner cannot reach (Mark Paid actually emailing the member, Resend delivery) were deliberately not exercised; the pay dialog was inspected without submitting.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-10-02

**Owner:** analyst
**Status:** complete

### VERDICT

**SHIP WITH NOTES**

### ONE-LINE TAKE

> A paid reimbursement now carries its bank account and check number from the moment it is paid, the two October 1 rows can be repaired from the register in one dialog and matched in the open September session, every other correction goes through one closed-set audited route, and the approved-row lock is still unconditional; what is left is polish and two small copy fixes, none of which can lose money or move a closed session.

### Summary
I re-read my Phase 1 review, the architect's rulings 1 to 9 and the tech-lead's R1 to R10, then read the shipped code rather than the QA report: the correct route and both lib modules, `ledger-reimbursement-link.ts`, `ledger-duplicate-candidates.ts`, the shared helpers in `ledger.ts`, the lock classifier, the audit vocabulary and reader, the statement-hiding predicate refactor, the pay and create-from-bank-line routes, the register, Paid tab, picker and grid, the guide, the e2e spec, the release note and the CLAUDE.md paragraph. I re-ran `pnpm test` (188 files, 3294 tests, green). Every one of the four intent points holds. Two QA items are ruled below; both are acceptable drift, each gets a small follow-up.

### What's working
- **Intent 1, reconcilable and correctable in the web UI.** Pay inserts `bankAccountId` (required, validated active and of the fund's entity) and the normalized check number in the same insert, so a newly paid reimbursement is a match candidate immediately. QA walked it live: repair, appear in the open session's picker, match, close with a balanced tie-out (Delta 0), then every change that could move the arithmetic refused.
- **Intent 2, the two October 1 rows.** They are exactly the shape QA seeded (check method, no account, no number, unreconciled, in an open session). The register row reads "Paid reimbursement. / No bank account. It can't be reconciled yet." with an Add bank account button; the Paid tab shows a "Needs bank account" badge and the same button. The dialog preselects the entity default, takes an optional check number, needs no typed reason, and the toast says "Added to <account>. It can now be matched in reconciliation."
- **Intent 3, closed-session arithmetic cannot move.** Read in `ledger-reimbursement-correction-queries.ts`: bank account and date change only while the row is unmatched and unreconciled (state read on the `FOR UPDATE` row, and re-pinned in the UPDATE's WHERE for date/bank), the other five allowlisted fields are read by no tie-out, `fill_bank_account` re-pins match absence in its own WHERE, and zero rows throws a rollback sentinel (a `return` inside the transaction would commit). QA proved both race orders and the sentinel by fault injection on real Postgres.
- **Intent 4, the approved-row lock stays unconditional.** The PATCH diff is the normalizer import and the removed local copy, nothing else; DELETE and split have no diff. The guards still precede body parsing, and the pins were mutation-tested by QA (eight failures when the guard is weakened). The new route is closed-set (`correctableRowKind` via one `EXISTS`), exact-key allowlisted per operation, never writes `approvedAt`/`approvedByUserId`/`boardMinute`, and its file header says why PATCH was not touched.
- **The duplicate guard is server-enforced** (409 `possible_duplicate` unless `acknowledgeDuplicate === true`, strict boolean), which is stronger than my Phase 1 "warn-and-confirm in the dialog".
- **Duplication rule honored.** One check-number normalizer in `ledger.ts` (five call sites, none left behind), one duplicate finder with the move as a thin wrapper, one `EXISTS` definition, one statement-gating predicate with a brute-force equivalence test.
- **Audit is clean.** One new action, own `v:1` payload, ids only (no member name), memo text stored but never rendered, `RecentCorrections` exhaustive with a `never` check so the old "everything not moved is Deleted" mislabel is gone.

### Intent-vs-shipped diff

| # | Phase 1 / ruling said | Shipped | Verdict |
|---|---|---|---|
| 1 | Flow 1: pay captures account (required, entity-scoped, default preselected, re-evaluated on fund change) and optional check number (Check only, 20 cap) | As specified; blocking message and disabled Mark Paid when the entity has no active account; stale-dialog body without `bankAccountId` is a 400 with a human sentence | matches |
| 2 | Gap 8: the "Note" input overwrites the member's description | Field is now "Register description", pre-filled with the member's description, 1000-char cap; no memo migration | matches (architect's root-cause variant) |
| 3 | Flow 2: reason-free, audited fill-null; atomic; refuses matched / reconciled / already-filled / own-request; from register, Paid tab and reconciliation | All three entry points; atomic pinned UPDATE; codes `matched_open_session`, `reconciled_session`, `reconciled_legacy`, `already_has_bank_account`, `own_request`; fixed audit reason. Optional typed note dropped (R2, Phase 2's allowlist wins) | matches / acceptable drift (R2) |
| 4 | Flow 3: audited correction of category, budget line, date, method, check number, memo, bank account; reason 10 to 500; date and account only while unmatched and unreconciled; amount, fund, party, stamp never writable | As specified; unknown key is 400 by construction; before/after carry only changed fields | matches |
| 5 | Gap 4/5: reconciled and prior-year corrections at the `ledger.manage` tier; a cross-year date is the manage tier | `requiredCorrectionTier` = `requiredMoveTier` plus `fiscal_year_change`; warnings reuse the sent-statement copy | matches |
| 6 | Phase 2: an earlier date that newly hides a published month: warn vs refuse | Refused, 409 `would_hide_statement`, same predicate also refuses a method change away from Check (R1); preview shows it before Save | acceptable drift (a deliberate, documented extension; named in the release note) |
| 7 | Gap 6: self-action applies to repair and correct | Server refuses both operations, over every linked paid reimbursement; Paid tab hides the button with an explanation; register shows the button and the dialog refuses | acceptable drift (see ruling A) |
| 8 | Flow 4 / Gap 7: "Paid reimbursement" label, Correct replaces Edit, Delete disabled with accurate copy, "No bank account" line | As specified; non-reimbursement approved rows byte-identical (pinned) | matches |
| 9 | Guardrail G: warn on create-from-bank-line, "Use that entry instead", explicit confirm to create anyway, check-number hint, picker discoverability line | As specified, with a server 409; check-number match shown; own-request candidate has the action disabled with the reason; grid reopens the picker filtered to the amount after a repair | matches (stronger) |
| 10 | Gap 4: duplicate advisory inside the repair dialog | Dropped (R3): production verified zero twins; unwind procedure is in the Treasury Guide | acceptable drift |
| 11 | Gap 11: Recent corrections widened to a third kind | Done; compliance copy updated | matches |
| 12 | Gap 12: consolidate, do not copy | Done (five sites, one finder, one predicate) | matches |
| 13 | Architect ruling 1/2/3/9: dedicated route, derived eligibility, one audit action, one DECISION | DECISION-114 filed, cross-referenced from 099/106/110; B-85 narrowed; B-129/B-130 filed | matches |
| 14 | Out of scope: amount/fund correction, void/reissue (B-130), marker column, auto-matching, email change, Zelle/ACH | None of these shipped or promised | matches |

### Rulings on QA's decision item and observations

**A. Own-request row: the register still shows Correct and Add bank account, the dialog refuses, the Paid tab hides it (QA Observation 1).** Ruling: **acceptable drift, not a defect; ship, with a small follow-up.** Phase 1 specified the refusal (Flow 2 failure path, Gap 6, Pass 5), not the hiding, and Phase 3 explicitly split the two surfaces. The server is the authority, the refusal fires before any write, and the dialog explains the reason in plain words with no submit button, which I confirmed in `CORRECTION_ERROR_COPY.own_request` and QA verified live. Siding with the user, though: a button that can only ever refuse is a dead end, and the two surfaces now disagree. It matters most for one person, the treasurer correcting a row for a reimbursement they submitted. The fix is small (the register's `listPaidReimbursementTransactionIds` already reads `ledger_reimbursements`; carrying the submitter ids and passing `ownRequest` to `TransactionActions` lets it show the same "Submitted by you" line the Paid tab shows). Filed as B-next-1.

**B. Reconciled and prior-year rows stay correctable for category, method, check number and memo at the manage tier (QA Observation 4).** Ruling: **matches intent, by design.** Phase 1 Gap 4 said "reuse the tier and warnings rather than invent a second policy" and DECISION-114 item 4 records it. Intent point 3 is about a closed session's *arithmetic*, which these fields cannot touch (tie-out is bank-line driven; verified in `getTieOutAssembly` by the architect and live by QA). Reported totals can restate, which is exactly what the Settled-period badge, the sent-statement warning and the audit row are for. One thing for the treasurer to know: since migration 0110 (B-111) the `treasurer` role holds `ledger.manage`, so this tier is available to the treasurer, with a reason and an audit trail, the same as Move. No change requested.

**C. The picker hint's "Add bank account" closes both dialogs after Done (QA Observation 5).** Ruling: **acceptable drift, one extra click.** My Phase 1 said the repaired row "then appears in the match picker"; it does, the treasurer just reopens Match. The "Use that entry instead" path from create-from-bank-line already reopens the picker filtered to the amount, so the two paths are inconsistent rather than wrong. Filed as B-next-2 (low).

**D. Other QA observations.** Obs 2 (the `correct` UPDATE does not re-pin "no match" for a date/bank change, only the two reconciled marks) matches Phase 3 and both race orders were proven live; but the re-pin costs one predicate and removes a dependence on lock ordering, so it is B-next-3 (hardening). Obs 3 (four encodings of the paid link, all in two files) is the B-129 story; no action. Obs 6 (Recent corrections is visible to every `ledger.view` holder, reasons included) is unchanged DECISION-110 behavior; no action.

### Release-note check (`docs/release-notes/v1.88.md`, B-108 section)

| Required | Result |
|---|---|
| Says what Phase 1 promised (account + check number at pay, Add bank account, Correct with a 10 to 500 reason, "Paid reimbursement" label, duplicate warning, Recent corrections) | Yes, each as its own bullet; value statement is in plain language |
| Names the two October 1 rows as repairable from the register | Yes: "The two October 1 reimbursements can be repaired from the register ... appears in the open September reconciliation, where you can match it" |
| States the Check-method and earlier-date refusals | Yes: "Moving an unreconciled entry to an earlier month, or changing its method away from Check ... The correction says so and does not go through" |
| Does not promise auto-matching | Correct: repair makes the row *available* to match; nothing says it matches itself |
| Does not promise amount or fund correction | Correct: "The amount, the fund and who was paid cannot be changed here" |
| Own-request rule, closed-session lock, memos untouched, Mark Paid still emails | All present under "What the treasurer should know" |
| No file lists | Correct |

Two copy fixes, both small, neither blocks (apply before the commit):
1. The bullet heading **"A change that would hide a sent statement is refused"** says the wrong thing. The refusal protects the *members'* monthly statement page, whether or not a statement was ever sent to the board (the "sent to the board" case is the separate warning). Suggested heading: "A change that would hide a monthly statement from members is refused."
2. The note says "use **Correct**, not a refund entry" but never says what to do for a wrong amount or fund, the one case where a refund entry (or a new request) is still the answer. The Treasury Guide says it; add one clause to the note so a reader of the release note is not left at a dead end.

### Edge cases

| Case | Result | Notes |
|---|---|---|
| Empty state | pass | No unrepaired rows: no badge, no "No bank account" line, Paid tab shows an em dash; Recent corrections keeps its empty state; entity with no accounts blocks Mark Paid with a message |
| Failure microcopy | pass | Every refusal code has exhaustive human copy (compile-enforced), with the next step for matched ("Unmatch it first") and reconciled ("Reopen the session"); 500 reads "Could not save this correction. Nothing was changed."; picker hint failure is silent and never blocks |
| Permission gate | pass | `ledger.record` checked before any row read on GET and POST (no 404-vs-403 oracle); manage tier derived server-side from the locked row; fill is record tier by ruling; non-reimbursement and ordinary rows get a uniform 403 `not_correctable`; QA verified 401/403 live |
| Mobile (360px) | pass | QA screenshots: dialog 336px inside a 360 viewport, Save/Cancel reachable, no page-level horizontal scroll |
| Brand | pass | `rounded-2xl` panels, `rounded-lg` buttons, `lions-blue`/gold, no `lions-red`, no native dialogs. The "Create anyway" confirmation is a tick box rather than `ConfirmDialog` (ux deviation 1); acceptable, nothing is destroyed and the tick gates the button |
| OAuth-vs-password, access-pending, Google Group sync | not applicable | Admin-only surface, no identity assumption, no group touched |
| Email | not applicable | No new email; Mark Paid's member email is unchanged; durable-claim exception correctly not engaged |

### Follow-ups (SHIP WITH NOTES): each gets its own work-log entry

IDs are proposals; B-140 is the highest today.

- **B-next-1 (low): own-request rows on the register.** Show the same "Submitted by you. Another reviewer must ..." line the Paid tab shows, and hide or disable Correct and Add bank account for the submitter. Carry submitter ids from `listPaidReimbursementTransactionIds` to `TransactionActions`; server refusal stays the authority. Owner: ux-developer, with a small api-developer touch.
- **B-next-2 (low): picker hint repair keeps the flow.** After Add bank account from the match picker's hint, keep the picker open (or reopen it filtered to the amount) so it matches the grid path. Owner: ux-developer.
- **B-next-3 (low, hardening): pin match absence in `correctWhere`** when the change set includes the date or bank account, as `fillWhere` already does, so correctness no longer depends on lock ordering. Owner: api-developer; one predicate plus a key-set test.
- **B-next-4 (low, copy): stale "Record a refund entry" advice.** The `approved` lock copy (board-approved disbursements) still tells a treasurer to record a refund entry for an expense, which routes into an income row; the Guide's wrong-fund / wrong-party advice has the same gap. Needs a decision on what the right instruction is for each case before rewording. Owner: tech-lead to rule, then ux-developer.
- **B-next-5 (docs, tiny):** (a) close B-108 and its index line in `docs/backlog.md` (line 373 is still `[ ]`); (b) in the CLAUDE.md "Paid reimbursements are reconcilable and correctable" paragraph, add the self-action rule (the submitter cannot repair or correct the row), say the tier is `requiredCorrectionTier()` (move tier plus `fiscal_year_change`, not bare `requiredMoveTier()`), and say the reason is typed only for `correct` (fill carries a fixed reason). Owner: tech-lead.

### Ship-day note for the treasurer (not a code follow-up)
Repairing the two October 1 rows needs a `ledger.record` holder who did **not** submit that reimbursement (DECISION-114 item 4, deliberate and enforced for both operations). If the person who will click Add bank account submitted either row, an administrator or another recorder must repair that one; the register will show the button and the dialog will explain. Post-deploy qa check from Phase 3 stands: `SELECT count(*) FROM ledger_transactions WHERE status='posted' AND bank_account_id IS NULL` returns 0 after the repair, and both bank lines in the open Admin September session are matchable.

### Outputs
- `docs/work-log/2026-10-02-reimbursement-reconcilable.md` (status table row 6 and this section)
- No code, `docs/decisions.md` or `docs/backlog.md` edits (per instruction). Release-note copy fixes above are left to whoever commits.

### Open questions / handoff notes
- Orchestrator: apply the two release-note copy fixes before `/pre-push`; file B-next-1 to B-next-5 with real IDs; mark B-108 done in the backlog.
- Pipeline state for B-108: this is SHIP WITH NOTES, so it ships, and each follow-up above is tracked work. Phase 6 does not reopen any earlier phase.
- B-111's files were ignored as instructed; nothing in B-108 depends on them beyond the `ledger.manage` tier copy, which names the permission and no role.

---

## Phase 1 — Functional Refinement — 2026-10-02

**Owner:** analyst
**Status:** complete

### Summary
Paid reimbursements post an approved-and-locked expense with no bank account or check number, so they never appear as reconciliation candidates and cannot be edited, split or deleted; "create from bank line" would then double-book the payment. Verdict READY WITH NOTES: capture account and check number at pay time (Flow 1), give existing rows a reason-free, audited fill-null repair (Flow 2), allow an audited classification/account correction instead of an offsetting entry (Flow 3), fix the register's lock copy and affordances (Flow 4), and add a duplicate guardrail to create-from-bank-line (G). Phase 2 is required and brief.

### What I did
- Read the backlog item, the pay route and dialog, candidate query, PATCH/DELETE locks, DECISION-099/106/110 and the correction/audit modules, the register lock classifier, and the backfill script.
- Established that the tie-out arithmetic is bank-line-driven, so fill-null on an unmatched, unreconciled row cannot move a closed session.
- Defined four flows plus a guardrail, the permission tiering, the adversarial pass, 15 gaps, and a two-outcome build table.

### Outputs
- `docs/work-log/2026-10-02-reimbursement-reconcilable.md` (this file)
- No decisions.md or backlog.md edits (per instruction); a new DECISION is expected from Phase 2/3.

### Open questions / handoff notes
- Verify-query results select the build column (see "Design for Both Verify Outcomes"); widen the query per Gap 3a.
- Architect to rule on dedicated route vs PATCH carve-out first; everything else follows.
- `ledger.manage` tier depends on B-111's outcome; the rest works on `ledger.record`.
- Phase 3 must name the failure outcomes of the repair (matched / reconciled / already-filled / own-request) and the atomic-guard pattern; consolidate `normalizeCheckNumber` rather than copying it a third and fourth time.

## Phase 2 — Architectural Review — 2026-10-02

**Owner:** architect
**Status:** complete

### Summary
**Approved with suggestions.** The Phase 1 shape stands: the new write path is a dedicated, closed-set, allowlisted, audited route (`POST/GET .../transactions/[id]/correct`); the PATCH/DELETE/split `approvedAt` guards stay unconditional. No schema change, no new `FEATURES` key, no nav/proxy change, no new dependency. One new decision (DECISION-114, drafted above) amends DECISION-099/106/110; the durable-claim exception does not apply. Production facts select the "rows exist, no duplicates" branch with no data fix.

### What I did
- Verified against code: tie-out is bank-line driven (`getTieOutAssembly`); `checkNumber` is read only by the candidate display query; the pay route writes the reimbursement link in the same transaction; `normalizeCheckNumber` exists three times today (not two), so five with the new callers; `ledger-transaction-validation.ts` imports the schema at runtime (not client-safe, so not the normalizer's home).
- Ruled on all nine questions (see "Phase 2 Ruling"): explicit-discriminator two-operation route; derived `EXISTS` eligibility; single new audit action `transaction_corrected` with its own `v:1` payload and a third reader kind; shared homes for the normalizer (`ledger.ts`), payment-method set, default-account helper and a generalized duplicate finder (`ledger-duplicate-candidates.ts`); `fill_bank_account` is record-tier even for a prior-year row; server-enforced `acknowledgeDuplicate` on create-from-bank-line; new `paid_reimbursement` lock kind to fix wrong lock copy.
- Drafted DECISION-114 and backlog wording (B-85 update, B-129, B-130) in this file only.

### Outputs
- `docs/work-log/2026-10-02-reimbursement-reconcilable.md` (status table, Phase 2 Ruling, this section)
- Decision logged as a DRAFT (DECISION-114) in this work-log; `docs/decisions.md` and `docs/backlog.md` intentionally not edited per instruction.

### Open questions / handoff notes
- Phase 3 must: name the refusal codes/statuses and guard order for the correct route; decide the earlier-date-hides-a-published-month case; confirm `updatedAt` exists and is bumped; confirm the register view-model gains `paidReimbursement`; name the tests listed under "Suggestions for Phase 3".
- Requester's all-rows null-account query: if it finds non-reimbursement approved rows, they stay on `scripts/backfill-bank-account.ts`; `correctableRowKind` is not widened.
- `ledger.manage` tier (reconciled / prior-year corrections) is unusable by a non-admin treasurer until B-111 lands; `fill_bank_account` and unreconciled current-year corrections work on `ledger.record` alone, so B-108 is not blocked.
- Whoever pastes DECISION-114 into `docs/decisions.md` should also add the DECISION-110 item 3 cross-reference.

## Phase 3 — Technical Design — 2026-10-02

**Owner:** tech-lead
**Status:** complete

### Summary
Dedicated, closed-set, audited route `POST/GET /api/admin/ledger/transactions/[id]/correct` (operations `fill_bank_account` and `correct`) is the only new write path onto an approved row; PATCH/DELETE/split guards are untouched and pinned by tests. Mark Paid now requires a bank account and takes a check number; the memo-overwrite bug is fixed at the dialog (pre-filled "Register description"). The register gets a `paid_reimbursement` lock kind with Correct / Add bank account, Recent corrections gets a third kind, and create-from-bank-line is server-guarded against double-booking (409 `possible_duplicate` unless `acknowledgeDuplicate: true`). No schema change, no migration, no new key. Orchestrator ruling applied: an earlier date that would newly hide a visible monthly statement is refused (409 `would_hide_statement`); the same predicate also covers a method change away from Check (flagged R1).

### What I did
- Read the pay route and dialog, the move route and its queries/preview modules, `ledger-correction.ts`, `ledger-audit.ts`, the lock classifier, `transaction-actions.tsx`, the create-from-bank-line route and dialog, the match picker/grid, `financial-report-queries.ts` (statement gate), the reimbursements page and `listReimbursementsForAdmin`, the Recent corrections component and compliance page, and e2e/ for affected surfaces.
- Confirmed `ledger_transactions.updated_at` exists and is naive/millisecond-compared (partial guard; real safety is re-derivation under `FOR UPDATE`).
- Found and recorded a latent bug: the three inline `parseDate` copies accept `2026-02-31`, which Postgres then rejects with a 500; the new strict `parseIsoDate` returns 400.
- Specified the route contract, guard order, status/code map, UPDATE key-set pins, tier, warnings, audit payload v1 and reader widening, eligibility predicate and its shared home, the five-site check-number consolidation and other shared helpers, the generalized duplicate finder, pay and create-from-bank-line changes, lock kind, dialogs, 46 named unit tests, e2e impact, specialist split and handoff contract, edge cases, out-of-scope list and a release-notes draft.
- Filed DECISION-114 in `docs/decisions.md`, updated B-85, appended B-129 and B-130 in `docs/backlog.md`.

### Outputs
- `docs/work-log/2026-10-02-reimbursement-reconcilable.md` (this section and the status table)
- `docs/decisions.md`: DECISION-114 (top), with amendment cross-references on DECISION-099, DECISION-106 and DECISION-110
- `docs/backlog.md`: B-85 updated; B-129 and B-130 added
- No code written.

### Open questions / handoff notes
- **Use the api-developer agent first** (steps 1 to 6 under Implementation Order), then the **ux-developer agent** against the handoff contract. No database-admin step. Not a full-stack-developer job.
- Orchestrator to confirm R1's method extension (Check to Cash/Other can newly hide a statement for the same reason an earlier date does) and R4 (cross-fiscal-year date change is a `ledger.manage` tier reason, not a refusal). Both are cheap to flip.
- R5 deviates from the architect's wording (bank-account validation beside the other pay validators, not inside the transaction); no loss of guarantee, flip if the architect objects.
- DECISION-115 is reserved for the concurrent B-111 pipeline; nothing here depends on it. `manage_required` copy names no role.
- Post-deploy, qa should confirm zero `status = 'posted' AND bank_account_id IS NULL` rows after the treasurer repairs the two October 1 rows, and that both bank lines in the open Admin September session are matched.
- Release notes are written at ship via `/release-notes`; the draft above is the starting point.

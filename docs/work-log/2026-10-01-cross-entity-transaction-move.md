# Move a Ledger Transaction to the Other Entity (Foundation to Club) — Work Log

> **Slug:** `2026-10-01-cross-entity-transaction-move`
> **Surface:** (dashboard) admin — The Ledger: Foundation fund register `/admin/ledger/[fundSlug]` (row actions), the existing Move dialog, the reconciliation workbench (guidance only), the compliance page "Recent corrections", the Treasury guide
> **Permission(s):** existing `FEATURES.LEDGER_RECORD` (gate) plus existing `FEATURES.LEDGER_MANAGE` for EVERY cross-entity move. No new key, no role-binding migration.
> **Estimated complexity:** large (extends the DECISION-109 policy across the entity boundary, one small schema change for acknowledgments, audit payload generalization, dialog and preview rework)
> **Pipeline mode:** Full. Phase 2 is required. The durable-claim exception does not apply (see Phase 1 notes) but is recorded so Phase 2 need not re-derive it.

Follows `docs/work-log/2026-10-01-move-or-cancel-transaction.md` (v1.86.0, DECISION-109/110/111). Backlog context: B-96 (cross-entity item), B-98 (Foundation register pointer, folded in here), B-next-F(2) (guard ordering).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions (R1-R7 binding on Phase 3; REQUIRED items marked) | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named: database-admin, then api-developer, then ux-developer (X1-X13 refine Phase 1/2) | 2026-10-01 |
| 4 — Implementation | database-admin, then api-developer, then ux-developer | Complete: schema (database-admin), server (api-developer), UI (ux-developer) | Gate green; hand-off to qa | 2026-10-01 |
| 5 — Verification | qa | Complete | PASS (with one item the orchestrator must rule on before ship: the match-route race, see F1) | 2026-10-01 |
| 4 (F1 fix) — Match/close account guard | api-developer | Complete | Gate green; F1 live-verified fixed (match 409, close 400); back to Phase 6 | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (apply the two pre-push doc edits; file the follow-ups below) | 2026-10-01 |

---

# Phase 1 — Functional Refinement (analyst)

**Request (treasurer, 2026-10-01):** "Get this to a place where next year's treasurer will be able to do everything they need to via the web interface." Driving case: a donation recorded on the Foundation's books (Charitable Fund, Foundation Checking) with a receipt letter already sent was discovered at reconciliation to have been physically deposited in the Club's Administrative Checking. Move that one row to the Club's Activity Fund on Administrative Checking (where the cash landed), keep the receipt, then record the normal Activity-to-Charitable sweep when the money is transferred. The treasurer resolved today's instance by hand, so this is about the next occurrence; there is nothing to repair in production and nothing real to test against (QA needs fixtures on `example.com` donors).

## VERDICT

**READY WITH NOTES.** Flow 1 (Foundation to Club Activity) is buildable and worth building. Two notes are design requirements Phase 2 must rule on before Phase 3 (acknowledgment donee snapshot; the cross-entity relaxation of the one-way valve). Flow 2 (the mirror) is **not** recommended as a move and is deferred with an explicit denied branch; the existing hardened delete and re-enter is safe in that direction.

## ONE-LINE TAKE

> Add one new allowed cell to the move policy (income, Foundation Charitable to Club Activity, cross-entity), performed only on an unreconciled, unmatched, posted income row by a `LEDGER_MANAGE` holder who also picks the Club bank account the cash actually landed in, keeping the donor and the already-sent receipt, with the closed-session case handled by a guided checklist in the dialog rather than by relaxing the reconciled lock.

## Corrections to the brief (read first)

1. **"api-developer finding 2" is, in the log, api-developer deviation 3** ("bank-account assertion at step 6 before the policy at step 7, so a cross-entity destination on a row with a bank account is 409 `bank_account_entity_mismatch`, not 403 `cross_entity`"). QA observation 2 and Phase 6 ruling 2 / B-next-F(2) say the same. Same item; the fix is below.
2. **The architect did not call delete-and-re-enter unsafe for the mirror case.** Phase 2 Correction 2 was about a row **on the Foundation books whose cash is in Foundation Checking** (re-entering it on the Club needs a Club bank account the cash never touched). Phase 6 then established the rule that governs both directions: delete and re-enter is safe exactly when the re-entered row lands on the bank account the cash actually touched. For the mirror (Club row, cash in Foundation Checking) deleting the Club row and entering the gift on the Foundation's register on Foundation Checking is bank-consistent on both sides. See Flow 2.
3. **The ordering "reopen, unmatch, close, move, sweep" cannot work as written.** Closing is a hard tie-out gate: every in-period bank line must be matched (`close/route.ts`, no override). After the unmatch, the Foundation bank line that was wrongly matched to this row is free, and the session cannot re-close until that line has its correct match (or a row created from it). The move needs only "unreconciled and not matched"; it does not need a re-close first. Correct order: reopen, unmatch, **move**, give the freed bank line its correct entry, **re-close**, then (separately, when the cash really moves) sweep. See Flow 1b.
4. **The mutual-exclusion test (T3, `ledger-fund-move-policy.test.ts`: "no (from, to) pair is allowed by both policies") holds for the Flow 1 cell and would break for the natural Flow 2 cell.** Charitable to Activity is denied by the transfer policy (one-way valve), so adding it to the move policy keeps T3 literally true. Activity to Charitable is the sweep's own cell; allowing it as a move would put one pair in both allow-lists. That is a main reason Flow 2 is deferred rather than enabled.
5. **B-98 as written is superseded for the treasurer's case.** B-98 proposed a Delete-dialog pointer "delete, re-enter as Activity, sweep". That path is now **blocked** whenever a receipt was already sent (hardened DELETE returns 409 `receipt_sent`, DECISION-110), which is exactly the treasurer's case. Move replaces it for Foundation rows; B-98's pointer text is re-aimed at the mirror direction (below).

## Verified Against the Code (Pass 0)

- **Policy.** `src/lib/ledger-fund-move-policy.ts` denies every cross-entity pair with `cross_entity` before looking at kinds (line 57). One allowed cell today: same entity, income, administrative to activity. `src/lib/ledger-transfer-policy.ts` allows exactly same-fund transfers and Club Activity to Foundation Charitable (sweep); it denies Charitable to anything in the Club ("one-way valve", line 98) and Administrative to Charitable ("not enabled yet", line 110).
- **Queries.** `src/lib/ledger-fund-move-queries.ts` `evaluateDestination()` runs the bank-account entity assertion **before** `checkFundMove()` (lines 143-153); `previewFundMove()` only lists funds of the row's own entity (lines 229-233); the tier (`requiredMoveTier`) is computed from the row alone and **before** the destination is known (lines 125-128); the UPDATE sets only `fund_id`, `category_id`, `budget_line_id`, `updated_at` and is pinned on `fund_id`. `ledger_transactions.entity_id` is a separate, denormalized column and is not touched today.
- **Reconciliation is keyed on `bank_account_id`.** That is the whole argument for the same-entity reconciled carve-out (DECISION-109 item 4). A cross-entity move **must** change `bank_account_id` (accounts belong to entities), so that argument does not extend: **no reconciled carve-out for a cross-entity move.**
- **Acknowledgments.** `ledger_acknowledgments.donation_txn_id` is `ON DELETE CASCADE`; the row stores amount, date, type, purpose, `sent_at`, `sent_via`, a letter file key and `donor_id`, **but no entity**. Letter generation (`listGeneratableAcknowledgments()` in `src/lib/ledger-acknowledgment-letter-queries.ts`, lines 125-150) takes the donee **live from the transaction's entity** (name, EIN, tax classification). The ack POST route refuses a transaction whose entity is not `donationsDeductible`; the register, the donors page and the pending/generatable lists in `ledger-queries.ts` (around lines 5099 and 5154-5169) are gated on `donationsDeductible`. **After a Foundation-to-Club move the sent receipt would be invisible on every list, and any later regeneration or reprint would silently render the Club's name, EIN and non-deductible classification on a letter the donor already received as the Foundation's.** This is the one real defect risk in Flow 1 (Gap 1).
- **Donors are not entity-scoped** (`ledger_donors` has no entity column, confirmed in production by the requester), so `donor_id` carries over untouched.
- **Reopen** (`reconciliation/sessions/[sessionId]/reopen/route.ts`): `LEDGER_MANAGE`; refused while a LATER session on the same account is closed (`getLaterClosedSessionForAccount()`); reverts **every** row whose `reconciled_session_id` is that session (not just this one); existing match links are **kept**. After a reopen the target row is unreconciled but still matched in an open session. `ledger_reconciliation_matches.transaction_id` is UNIQUE with an FK to the row.
- **Concurrency.** A match insert takes a key-share lock on the referenced transaction row, which conflicts with the `SELECT ... FOR UPDATE` the move already takes, so a move and a concurrent match serialize. Needs one live test (not a mock).
- **Impact reporting** counts expense rows only (`impact-stats-queries.ts`), so the income move does not change giving totals. The 990 prep panel and any contribution-revenue figure that sums Foundation income do change (Gap 9).

## What changes on the row, what is carried, what is refused

| Column | Cross-entity move (Foundation Charitable to Club Activity) |
|--------|------------------------------------------------------------|
| `entity_id` | Becomes the destination fund's entity. Derived server-side from the destination fund, never client-supplied. |
| `fund_id` | Destination fund. |
| `bank_account_id` | **Required explicit pick** of an active account of the destination entity (Administrative Checking or Petty Cash for the Club). Preselected only when the destination entity has exactly one active account; otherwise no default, because a wrong guess silently breaks the next reconciliation. |
| `category_id` | **Re-picked from the destination entity and fund kind and the row's flow** (active, income), or "No category". Preselect the "Public donations" category when it exists for the destination, as the v1 move does. Never carried (Foundation categories are invalid on a Club fund). |
| `budget_line_id` | Set null (income; defensive, as v1). |
| `updated_at` | now |
| Carried, untouched | `txn_date`, `amount_cents`, `flow`, `party`, `memo`, `payment_method`, `check_number`, `donor_id`, `status`, `recorded_by_user_id`, `created_at`, receipt fields (income rows normally have none), `public_note` and `beneficiary_cause` (expense-only, so null on income). The mover is recorded in the audit row, not by overwriting the recorder. |
| Acknowledgment row | **Kept** (sent or not is handled below) and, per Gap 1, stamped with the donee entity it was issued for. |

**Refused for a cross-entity move** (each with its own code and a next-step sentence; GET and POST return the same status and code, per D6):
- `approved`, `rejected`, `pending`, `transfer_leg` (this includes the Foundation leg of an earlier sweep), `dues_synced`: unchanged from v1.
- Any **expense** row (`expense_not_supported`, unchanged).
- **Closed-session-owned** (`reconciled_session`): refused, with the guided checklist (Flow 1b). **No carve-out.**
- **Legacy-reconciled** (`reconciled = true`, no session): refused with "un-mark it as reconciled first". (The un-toggle is unaudited, B-92 / B-next-E; refusing here means that bypass cannot be used to slip a cross-entity move through at a lower bar, and the move audit records the row as unreconciled either way.)
- **Matched to a bank line in an OPEN session** (`matched_open_session`): refused with "unmatch it first", the same guard `/split` and the bank-account PATCH already apply. This is also the state a reopened session leaves the row in.
- **Prior fiscal year** (`prior_fiscal_year_cross_entity`): refused in v1 (Open Question 3). A cross-entity move restates two entities' totals for a closed year, which feeds each entity's filed return; deny-by-default until the treasurer actually hits it.
- A destination bank account that is missing, malformed, inactive, or belongs to the wrong entity (400, below). A destination bank account supplied on a **same-entity** move (400): the same-entity reconciled carve-out depends on the bank account never changing, so the new input must be impossible to use there.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`LEDGER_RECORD`) | Open the Foundation register, find a gift row, see **Move to the Club** (new; today the Foundation register offers no Move at all) | Rare (once or twice a year) |
| Admin | If the row is reconciled or matched, read the "Before this can move" checklist with links to the session | Per move |
| Admin (`LEDGER_MANAGE`) | Reopen the closing reconciliation session (existing action, linked from the checklist) | Per closed-session move |
| Admin (`LEDGER_RECORD`) | Unmatch the row from its bank line in the open session (existing action) | Per closed-session move |
| Admin | Pick the destination fund, **the destination bank account**, and a valid destination category; type a reason | Per move |
| Admin | Read the "what will change" panel: both entities, both bank accounts' book balances, the receipt, statements, possible duplicate | Per move |
| Admin (`LEDGER_MANAGE`) | Confirm the move | Per move |
| Admin | Give the freed Foundation bank line its correct entry and re-close the session (existing reconciliation actions) | Per closed-session move |
| Admin | Match the moved row to the Club's deposit line in the Club's reconciliation session (existing) | Per move |
| Admin | **Record sweep now** (existing deep link, generalized), enter the board-minute reference, confirm the sweep | Per move, after the cash actually moves |
| Admin (`LEDGER_VIEW`) | Read the move under **both** entities' "Recent corrections" | On demand |
| Anonymous visitor, signed-in member without ledger access | None. No surface, no route access. | n/a |

## Flows

### Flow 1 — Foundation gift whose cash is in the Club's account

Assumed state (the requester's case): income row in the Foundation's Charitable fund on Foundation Checking, donor linked, acknowledgment **sent**. The cash is physically in Administrative Checking.

**Flow 1a — row is not reconciled and not matched** (the simple path; also where Flow 1b ends)
1. Entry: `/admin/ledger/<foundation fund slug>`, the gift row's actions cell. **Move to the Club** is offered (D1: it is omitted today only because no legal destination existed; this cell creates one). Disabled with a visible reason if the caller lacks `LEDGER_MANAGE` ("Moving an entry to the other entity needs the Manage Ledger permission, held by the Admin role").
2. Dialog opens on a server preview (`GET .../move`). Destination select lists the Club's funds, grouped by entity ("Club: Activity Fund" allowed; "Club: Administrative Fund" listed as not allowed with the reason "Public money cannot be moved into the Administrative Fund").
3. Choosing Activity reveals: **destination bank account** (required select of Club accounts), **category** (Club activity income categories, "Public donations" preselected if present, or "No category"), **reason** (10 to 500 characters).
4. "What will change" panel, server-computed: Foundation Charitable balance down $X; Club Activity balance up $X; **Foundation Checking book balance down $X and Administrative Checking book balance up $X** (both accounts named; this is the opposite of the same-entity message "bank balance unchanged" and must be visually prominent, as a before and after row per account); the donor stays linked; **"A receipt letter was already sent for this gift. It stays attached to the gift."**; ratchet sentence (below); sent-statement warning for each entity whose statement for that month was already sent; possible duplicate in the destination account (Gap 4); aged-public-fund note; "Moving does not sweep anything. The cash is in Administrative Checking; record the sweep once the money has actually been moved."
5. Treasurer confirms. Server, in one `db.transaction` with the row locked first: re-validates every guard, updates `entity_id`, `fund_id`, `bank_account_id`, `category_id`, handles the acknowledgment (kept and stamped, or an unsent one removed and reported), writes one audit row. 200 returns the new fund, entity slug and `sweepSuggested`.
6. Success step in the same dialog: "Moved to Activity Fund (Club)." with **Record sweep now** (deep link to the Club Activity register, validated server-side, board-minute never prefilled) and **Done** (refresh).
7. Later, in the Club's reconciliation session for the statement that holds the deposit, the treasurer matches the moved row to the deposit line like any other uncleared income row.
8. Outcome: the Foundation register no longer lists the gift; the Club Activity register does, on Administrative Checking; the donor link and the sent receipt are intact; the Foundation's later sweep leg is a separate transfer-in row with no donor and no acknowledgment (unchanged v1 caveat, Phase 1 Gap 10 of the parent log; the release note and guide must not promise one).
- **Failure:** every refusal above returns a specific sentence and writes nothing; stale tab or double-click is 409 `stale` ("This entry changed while you were looking at it. Refresh and try again.") with exactly one audit row ever; destination account invalid is a field error; network or database failure is "Could not move this entry. Nothing was changed." (one transaction, no half-moved row, no half-moved acknowledgment). A failed or skipped sweep leaves the move in place; the aged-public-fund warning keeps nudging.

**Flow 1b — the row is owned by a CLOSED reconciliation session** (the requester's case: it had been matched to a Foundation bank line, so a wrong match in a closed session is part of the scenario)
The dialog **guides; it does not automate.** Reopen is session-wide (it reverts every row that session cleared), is `LEDGER_MANAGE`, and may need several later sessions reopened newest-first; none of that belongs behind a Confirm button on one row.
1. Treasurer chooses **Move to the Club** on the row. The preview returns the destination as not yet movable with a structured `unlock` block, and the dialog shows **"Before this can move"** instead of the form:
   - names the session: Foundation Checking, statement period (for example "Jul 1 to Jul 31, 2026"), closed;
   - if a later session on that account is closed, names it first: "Reopen Aug 1 to Aug 31, 2026 first" (data already returned by `getLaterClosedSessionForAccount()`), repeated until the earliest needed;
   - three numbered steps with links: (1) Reopen the session (Manage Ledger). It un-reconciles every entry that session cleared; the Foundation statement for that month will show as changed if it was already sent. (2) Unmatch this gift from its bank line in the session. (3) Come back and press Move to the Club;
   - one sentence on what to expect after the move: "The bank line this gift was matched to is now free. Give it its correct entry (match it to the right transaction or create one from the line), then close the session again. A session cannot close while a statement line is unmatched."
2. The treasurer does steps 1 and 2 in the workbench (existing flows). The row is now unreconciled and unmatched; the dialog's preview flips from the checklist to the form (Flow 1a, steps 2 to 6).
3. After the move, the treasurer finishes the Foundation session (correct the freed line, re-close) and, separately, reconciles the Club deposit.
- **Failure:** the checklist is advisory; the server re-derives the state at move time, so a stale checklist cannot cause a bad move. A reopen refused for a later closed session is the workbench's existing 409 with the blocking session named.
- If the treasurer lacks `LEDGER_MANAGE`: the checklist still renders (so they can ask an admin), the Move confirm is disabled with the tier message.

### Flow 2 — The mirror: a Club row whose cash landed in Foundation Checking

**Decision: not a move in this increment. The cross-entity cell Club (Activity or Administrative) to Foundation Charitable stays denied, as its own branch with its own code and unit-test slot (`club_to_foundation_not_supported`), exactly as the expense cell was left in v1 (B-96).** The supported path is the existing one, and it is safe in this direction:
- Delete the Club row (reason required, full snapshot in the audit row, Recent corrections), then enter the gift on the **Foundation's** register on **Foundation Checking**. The re-entered row lands on the account the cash actually touched, so both entities' book balances match their banks. A Club row cannot carry a receipt (the acknowledgment route refuses non-deductible entities), so the sent-receipt block that makes Flow 1 need a move does not arise. A closed-session wrong match is handled the same way (reopen, unmatch, delete).
- Why not allow the move anyway: (1) it is the sweep's own cell (Activity to Charitable) and would put a pair in both policies, breaking T3; (2) the sweep's mandatory board-minute exists to gate exactly this crossing of Club money into the Foundation, and a move would be a way around it; (3) it buys back only convenience (donor link, memo, check number re-typed), which the hardened delete's snapshot makes recoverable; (4) it would make the Foundation record a gift the treasurer then also wants a receipt for, which is a characterization question for the board (Gap 2).
- **If it is ever enabled** (revisit only if the treasurer hits a case delete cannot serve): it lands in the Foundation's single Charitable fund on a **picked Foundation account**, category defaults to "Public donations", `LEDGER_MANAGE`, a board-minute reference required, a new Foundation acknowledgment becomes available on the moved row, and T3 would need a single named, tested exemption for that one cell.
- **What the treasurer sees today on a Club income row** (B-98 re-aimed): the Delete dialog on a Club **Activity** income row whose method or note suggests a Foundation gift carries one line: "If this gift's money is actually in the Foundation's bank account, delete this entry here and enter it on the Foundation's register on Foundation Checking." The Treasury guide gets the same paragraph.

## Policy cells (explicit allow-list; `ledger-fund-move-policy.ts`)

Add exactly **one** allowed cell. All others stay denied, each in its own branch with its own reason, keyed on fund `kind` and entity identity (never an id), deny-by-default.

| Flow | From | To | Entity | Result |
|------|------|----|--------|--------|
| income | administrative | activity | same | allowed (v1, unchanged) |
| **income** | **charitable** | **activity** | **cross** | **allowed (new)** |
| income | charitable | administrative | cross | denied `away_from_public` ("Public money cannot be moved into the Administrative Fund.") |
| income | activity, administrative | charitable | cross | denied `club_to_foundation_not_supported` (new code; reason points to delete and re-enter on the Foundation's register) |
| income | any other cross pair, unknown kind | | cross | denied `cross_entity` (existing code, now reached only for these) |
| expense | any | any | any | denied (`expense_not_supported`, `away_from_public`, `not_permitted` unchanged) |
| any | same fund | | same | denied `same_fund` (409, unchanged) |

- **Mutual exclusion with the transfer policy (T3) must still hold, and does:** the new allowed cell (Charitable to Activity cross-entity) is denied by `checkTransferDirection()` ("one-way flow by policy"); the cell the sweep owns (Activity to Charitable) is denied by the move policy; Administrative to Charitable is denied by both. Required test changes: the cartesian T3 test runs unchanged and must stay green; add a second pinned divergence test (charitable to activity cross-entity: move allowed, transfer denied); add a test that **the move policy never allows the cell the sweep allows**; update the code-set assertion to include `club_to_foundation_not_supported`; update both files' cross-reference comment blocks.
- **Policy is the preventer, not a detector.** As in v1, the provenance claim ("this was always the Club's cash") is not machine-verifiable. The compensating controls are stronger here than in v1: the cash evidence is a **bank statement line on the destination account**, the reason, `LEDGER_MANAGE`, the audit row under both entities, and the board-minuted sweep that follows. See Open Question 1 on whether the move itself should also need a minute.

## Permissions

- **Permission:** existing `LEDGER_RECORD` to reach the route; **`LEDGER_MANAGE` for every cross-entity move**, in both directions of any future cell, because it changes two entities' totals and two bank accounts' book balances. Default roles: `admin` (migration 0045). The treasurer is one of the two admins; this is a permission tier, **not a second approver**, and the guide and release note must not call it one (DECISION-109 item 5, Phase 2 Correction 4).
- **The tier becomes a function of (row, destination), not of the row alone.** Today `requiredMoveTier(row, now)` runs before the destination is loaded; a cross-entity destination adds a third reason `cross_entity` beside `reconciled` and `prior_fiscal_year`. The preview must report the tier **per destination**. Precedence on a refusal: policy denial first (a denied move never says "needs Manage"), then state, then tier.
- Every gate stays in the route body. UI shows or disables; the server decides.
- No new key, no flag, nothing "off by default": the feature only widens what an existing `LEDGER_MANAGE` holder can do.

## Guard ordering fix (409 vs 403)

Replace the current order (bank-account assertion, then policy) with a deliberately ordered pipeline, identical in `GET` and `POST` (D6 parity), all on the `FOR UPDATE` row in `POST`:
1. Row exists (404). Row-state block: approved, rejected, pending, dues-synced, transfer leg (403).
2. `expectedFundId` matches the locked row (409 `stale`).
3. Destination fund exists (404 `fund_not_found`).
4. **Direction policy** `checkFundMove()` (409 `same_fund`; 403 for every other denial code). A cross-entity request the policy denies therefore returns 403 with the **policy reason**, never 409 `bank_account_entity_mismatch`.
5. Cross-entity row preconditions: not closed-session-owned, not legacy-reconciled, not matched in an open session, not prior fiscal year (403, each with its own code and next step).
6. **Tier** (403 `manage_required`), now knowing whether the destination is cross-entity.
7. Input validation: destination bank account (400 `dest_bank_account_required` if cross-entity and absent; 400 `dest_bank_account_invalid` if malformed, missing, inactive, or owned by the wrong entity; 400 if supplied on a same-entity move). The stored-account assertion (409 `bank_account_entity_mismatch`) survives only for the same-entity case, where it now guards against corrupted data. Then category validation (existing codes).
8. UPDATE pinned on `id`, `fund_id` and `entity_id`, and (cross-entity) `reconciled = false AND reconciled_session_id IS NULL`, so a lost race returns 409 `stale` and writes nothing.
9. Acknowledgment handling, then the audit row, same `tx`.

Request body: the exact-key-set discipline is kept and gains one optional key, `destBankAccountId: string | null` (absent is treated as null so a stale tab on a same-entity move still works). Dialog behavior for status: 400 field errors inline; 403 and 409 as sentences in the open dialog.

## Audit payload (`ledger_audit_log`, action `transaction_fund_moved`, same transaction)

- `before` and `after` are self-describing JSON and for a cross-entity move carry **both entities' side**: `entity { id, name, slug }`, `fund { id, name, slug, kind }`, `bankAccount { id, name }`, `category { id, name }`. Same-entity moves keep their current shape (no entity or bank block needed); the parser must accept both (bump the payload `v` to 2 for the new shape and keep parsing 1).
- `details` adds: `destEntityId`, `crossEntity: true`, `reason`, `amountCents`, `txnDate`, `fiscalYear`, `tier: "manage"`, `reconciled` (always false for a cross-entity move; the audit therefore records the state at move time, and the checklist steps are separately visible in the reconciliation history), `donorId`, an `acknowledgment` object (`id`, `sent`, `sentAt`, `outcome: "kept" | "removed"`), and **both** sent-statement months (`sentStatementMonth` for the source entity, `destSentStatementMonth` for the destination, null when not member-exposed or never sent).
- **Reader requirement (R5 of the parent log):** `getRecentLedgerCorrections()` currently matches a move to the single `details.entityId`. A cross-entity move must appear under **both** entities' compliance pages, labeled with direction ("Foundation to Club"), the amount, both fund and account names, the reason, and the "Receipt already sent" fact. The delete reader already matches on any leg's entity (parent Phase 6, api deviation 5); use the same rule. A malformed or v1 payload is listed, not hidden. `targetTransactionId` stays set (the row survives).
- The reason is free text that may name a person: the member-surface import guard (T33) keeps protecting `ledger-audit.ts` and `ledger-correction.ts`.

## Dialog changes (`MoveTransactionDialog`)

- Destination select now includes funds of **other entities**, grouped by entity name; a not-allowed fund is shown disabled with its reason, never hidden.
- Selecting a cross-entity destination adds the **destination bank account** select (required, 44px target, no default unless exactly one) and shows the **bank account change explicitly** as its own row: "Bank account: Foundation Checking to Administrative Checking" plus both book balances before and after. The category select repopulates from the destination.
- The existing "Bank account balance unchanged" line is replaced for cross-entity moves; it must not appear (it would be false).
- The ratchet sentence is replaced for cross-entity moves with an honest one: "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep, and because a receipt has already gone to the donor, this entry can no longer be deleted; correcting it later means a refund entry." (When no receipt was sent, the deletion sentence is dropped.)
- New warning codes, server-composed like the v1 ones: `receipt_sent` (the receipt stays attached; the Foundation's receipt of this gift is not changed by the ledger, confirm with whoever advises the club on tax matters; see Gap 2), `unsent_receipt_removed`, `duplicate_candidate` (Gap 4), `closed_session_checklist` (not a warning but the structured `unlock` block), `sent_statement` for each entity, plus the existing `sweep_not_automatic`, `aged_public_fund`, `reconciled`.
- Reason field unchanged (10 to 500, trimmed, Unicode safe). Success step unchanged in shape (Record sweep now, Done). 360px: stacked before and after rows, the checklist as a numbered list, the bank select and reason not hidden by the keyboard.
- Preview impact grows from fund balances to: per entity (Foundation, Club), per fund, per bank account (book balance), plus the "reconciliation" statement ("This entry is not reconciled on the Club side until you match it to the deposit line.").

## Foundation register pointer (B-98 folds in)

- **Foundation register:** the Move button reappears on Foundation income rows that are otherwise movable (D1 omitted it because there was nowhere to move to). Rows that cannot move show the existing lock label plus, for a closed-session row, the short "Reconciled. If the money is in the Club's account, see Move to the Club." Hidden for expense, transfer-leg and dues rows as in D1.
- **Treasury guide** (`books-register-section.tsx`, "Moving an entry to another fund" and "Deleting an entry"): add the Foundation-case paragraph (when to use it, why a sent receipt blocks delete, the closed-session checklist, the sweep afterwards, no acknowledgment for the sweep's Foundation leg, the donee question), and the mirror paragraph (delete and re-enter on the Foundation's register).
- **Delete dialog on Club Activity income rows:** the one-line mirror pointer above.
- **Release note and guide wording:** "Moved", never "Reversed" or "Voided"; "Emailed" is not relevant (no email); do not describe `LEDGER_MANAGE` as a second approver; do not promise an acknowledgment for the sweep's Foundation leg.

## Gaps the Request Didn't Address

1. **The acknowledgment does not record who the donee was.** The letter's donee name, EIN and tax classification are joined live from the transaction's entity. After the move, reprinting or regenerating the letter would silently produce a Club letter, and every acknowledgment list that gates on `donationsDeductible` would drop the receipt from view. "Keep the receipt" is therefore not free. Resolution: add a nullable `donee_entity_id` (FK to `ledger_entities`, backfilled from the transaction's current entity in an idempotent migration) to `ledger_acknowledgments`, written at ack creation and never changed; make letter composition and the ack lists read the ack's own entity; give the moved row a read-only "Receipt on file (issued by the Foundation)" display on the Club register so it is findable. This is a schema change (database-admin, Phase 4). Phase 2 may rule a lighter alternative, but "refuse the move when a receipt was sent" contradicts the request and must not be the fallback without the treasurer's say.
2. **Legal characterization of the gift and the receipt.** Whether the gift was to the Foundation or to the Club decides whether the receipt the Foundation sent is the right document. The ledger can preserve the record; it cannot decide it. B-96 already says a cross-entity correction "needs a board decision, not a ledger feature." Resolution: record the reason, show the `receipt_sent` warning, and have the guide say to confirm with whoever advises the club on tax matters before moving a receipted gift. See Open Questions 1 and 2. Not a reason to hold design.
3. **The closed session is not just a lock; it is a tie-out that was achieved with a wrong match.** After the unmatch, the Foundation bank line has no row and the session cannot re-close. The dialog's checklist must say so (it does, Flow 1b). Also: reopening un-reconciles **every** row that session cleared and may un-gate the Foundation statement month; if that statement was already sent, the statement panel will offer a corrected resend. The checklist must name this consequence before the treasurer reopens.
4. **A deposit that was already recorded on the Club side would be double-counted.** If the Club's reconciliation already created a Club row from the deposit bank line (a natural way to absorb an unexplained deposit), moving the Foundation row on top doubles the Club's income. Resolution: the preview lists **candidate duplicates** in the destination account (same amount, income, within a date window, posted), shows whether each is already matched or reconciled, and warns. A warning, not a block; the treasurer decides.
5. **Destination bank account is a required, explicit input** (Administrative Checking or Petty Cash), and the same-entity path must be unable to accept it (Adversarial pass).
6. **Statements for both entities.** The sent-statement warning must be computed for the source entity (Foundation: member-exposed) and the destination entity (Club Activity is not member-exposed, so normally none), using the existing helper per entity. Inherits parent B-next-D (the warning covers only the row's own month although the One-Month column buckets by bank-cleared date and the Twelve-Month column by `txnDate`); the panel itself still flips to "Resend Corrected Statement", so nothing drifts silently.
7. **Aged public fund.** The moved row keeps its original `txn_date`. A gift from months ago lands in the Activity Fund already past the holding-period warning (existing `aged_public_fund` warning, DECISION-105). That is correct (the money has been in the club's hands that long) and the sweep clears it; say so in the dialog.
8. **After the move a sent receipt blocks delete.** The hardened DELETE refuses a row with a sent acknowledgment (409 `receipt_sent`). The moved Club row now carries one, so the only correction path later is a refund entry. This is why the cross-entity ratchet sentence differs from v1's.
9. **Foundation reporting that sums income.** The Foundation's income for the gift's fiscal year drops by the gift and later rises by the sweep's transfer-in leg. Whether the 990 prep panel, Schedule A public-support inputs, donor-level summaries and any "recent named gifts" view treat a sweep leg like a donation is not something this analyst verified. Phase 3 must read those readers and state the effect in the dialog; if a reader counts transfer legs differently, say so. Not a blocker.
10. **The sweep prefill memo says "moved from Administrative" and uses the UTC date of the page load** (parent B-next-G). Generalize the wording to name the source ("moved from the Foundation") and take the date from the audit row. Small.
11. **Concurrency and idempotence.** `FOR UPDATE` on the row first; the acknowledgment row is read and written in the same transaction; a double-click or a concurrent match must produce one move, one audit row, and no orphaned match. Needs live tests (parent log precedent), not only mocks.
12. **Empty and error states.** A Foundation income row whose destination entity has no Activity fund, or whose destination entity has no active bank account: Move omitted or disabled with the reason ("The Club has no active bank account to receive this entry"). Preview load failure: inline error card with retry and Confirm disabled (v1 pattern).
13. **Mobile (360px), brand, dialogs:** unchanged rules from v1. `Dialog`, not `window.confirm`; cards `rounded-2xl`; buttons `rounded-lg`; no destructive styling (a move is not a delete); 44px tap targets on the new selects.
14. **OAuth versus password, `/access-pending`, email, Google Group sync:** not applicable. Session-based, no email is sent, no `sent_at` is written, no group membership touched. **Durable-claim exception:** the move does not write a "this was sent" claim; it **retains** an existing one (`sent_at` is never modified), so `sendEmailForDurableClaim()` does not apply. Recorded so Phase 2 does not re-derive it.

## Adversarial Pass

- **Bank-account smuggling.** A client posts `destBankAccountId` on a same-entity move to change the account of a reconciled row, defeating the carve-out's premise. Server: 400 on any `destBankAccountId` for a same-entity destination.
- **Wrong-entity account.** A client posts a Foundation account id with a Club destination fund. Server: 400 `dest_bank_account_invalid`, checked on the locked row's destination entity, never trusted from the client.
- **Direction bypass.** Posting the Club-to-Foundation direction directly: 403 `club_to_foundation_not_supported`; posting Foundation to Administrative: 403 `away_from_public`. The client sends no "allowed" flag; the policy decides from the two fund rows.
- **Sweep-minute bypass.** The denied Club-to-Foundation cell is the one that would let a record holder move Club money into the Foundation without a board-minute reference. It stays denied; this is the principal reason Flow 2 is not a move.
- **Self-targeting.** The mover may be the recorder (the use case). `LEDGER_MANAGE` is required; no role or permission is changed by this feature; the audit row records actor and reason.
- **State-machine shortcuts.** Direct POST on an approved, rejected, pending, transfer-leg, dues-synced, closed-session, legacy-reconciled, open-session-matched, or prior-year row fails with its specific code via GET and POST identically, not a 500. A stale preview or double-submit is 409 `stale` (pinned UPDATE).
- **Race with reconciliation.** A concurrent match or reconcile between preview and confirm: the row lock plus the pinned UPDATE refuse; live test.
- **Enumeration, redirects.** Admin-only, authenticated; no `callbackUrl`, `next` or redirect parameter is introduced. The `sweepFrom` deep link is validated server-side and ignored if invalid (unchanged). 404 for a non-uuid or missing id alike.
- **Input boundaries.** Reason empty, whitespace-only, over 500, Unicode and RTL; `destFundId`, `categoryId`, `destBankAccountId` not UUIDs or in the wrong entity, kind or flow; extra keys; all validated server-side before the transaction.
- **Report leakage.** Moved amounts change what members see on `/members/financial-reports` for the Foundation statement; no new data is exposed; the reason and receipt facts never reach a member-facing surface.

## Out of Scope (confirm with user)

- Club-to-Foundation moves (Flow 2) and expense moves (B-96).
- Moving transfer legs, dues-synced, approved, rejected, pending rows.
- Prior-fiscal-year cross-entity moves (refused in v1; Open Question 3).
- **Any automation** of reopen, unmatch, close, or the sweep. The dialog links; it does not act.
- Deciding the legal characterization of the receipt (board or advisor matter).
- Editing a reconciled row's amount, date, flow, or check number; changing the legacy toggle (B-92).
- A general audit browser beyond Recent corrections.
- A DOM component-test harness (B-next-H).

## Open Questions (adopted defaults; proceed unless overruled)

1. **Does the cross-entity move itself need a board-minute reference, given the one-way valve?** Default adopted: **no.** A typed reason, `LEDGER_MANAGE`, the bank-line evidence and the audit row under both entities are required; the sweep that follows already requires the minute. If the board considers the Foundation losing a receipted gift a board act, the field is one more required input on a cross-entity move (cheap to add in Phase 3).
2. **Who decides whether the already-sent Foundation receipt is still the right document?** Default adopted: the ledger preserves it and warns; the guide tells the treasurer to confirm with the club's tax adviser before moving a receipted gift. Real club fact; ask the treasurer.
3. **Prior-fiscal-year cross-entity moves.** Default adopted: refused in v1. Confirm, or say the treasurer would rather have them allowed under `LEDGER_MANAGE` with a stronger warning.
4. **Is the mirror (Flow 2) acceptable as delete and re-enter?** Default adopted: yes; a Club row cannot carry a receipt, so the delete is not blocked by one.
5. **Unsent acknowledgment on a Foundation row being moved.** Default adopted: warned and **removed with the move** (a Club row cannot hold an acknowledgment), recorded in the audit row, consistent with DECISION-110 item 4. A sent acknowledgment is always kept.
6. **Does the treasurer role actually hold `ledger.manage` in production?** The parent log found the treasurer is one of two admins. Confirm, since this feature needs it for every move.
7. **Process question for the guide:** in the real instance, what did the freed Foundation bank line turn out to be (a different deposit, an adjustment)? The checklist's wording about the "correct entry" should match what the treasurer actually did.

## Recommendation: Phase 2 (architect) IS required

Do not accelerate. This work:
1. **Extends DECISION-109 across the entity boundary.** It relaxes the one-way valve in spirit (a Foundation row becomes Club money) and states that the reconciled carve-out does **not** extend (bank account changes). Needs a new decision, not an edit of 109, and a ruling on the Open Question 1 default.
2. **Touches both entities' reconciliation keys and bank balances**, the structure the parent log's whole safety argument rests on.
3. **Needs a schema change** (`ledger_acknowledgments.donee_entity_id`, backfill) and ripples into the ack POST/PATCH validation, letter composition, the pending and generatable lists, the register and the donors page. database-admin is in scope this time (it was not in v1).
4. **Changes the policy surface and its mutual-exclusion test**, and the architect must confirm the Flow 2 deferral (T3) rather than leave it to tech-lead.
5. **Generalizes the audit payload and reader** (`v: 2`, both entities).
6. **Reorders the guard pipeline** (policy before bank assertion before tier) that D6 parity depends on, and makes the tier a function of (row, destination).

Architect asks, in order: (i) acknowledgment donee snapshot design and its blast radius; (ii) confirm no reconciled carve-out for a cross-entity move and the refusal list; (iii) policy cells, new codes, T3 treatment, Flow 2 deferral; (iv) tier as a function of (row, destination) and the per-destination preview; (v) guard order and the pinned UPDATE; (vi) audit `v: 2` and the dual-entity reader; (vii) the duplicate-candidate query's home (a new query beside `ledger-fund-move-queries.ts`, not `ledger-queries.ts`); (viii) live concurrency tests required (match insert versus `FOR UPDATE`).

## Handoff Notes For Phase 2 and 3

- Reuse, do not reimplement: `checkFundMove()`, `evaluateFundMove()` and `evaluateDestination()` (one evaluator for GET and POST, DECISION-111 item 1), `requiredMoveTier()` (extended, not forked), `validateCategoryForFund()` (already takes entity and kind), `getMatchForTransaction()`, `getLaterClosedSessionForAccount()`, `findSentStatementMonth()` (call per entity), `recordLedgerAudit()`, `LedgerDialogShell`, the `sweepFrom` deep link.
- Unit tests that must exist: every policy cell including the new one and `club_to_foundation_not_supported`; T3 still green plus the two new pinned tests; guard-order table (policy before bank, state before tier, GET and POST parity for every code); each cross-entity refusal (closed-session, legacy, open-session-match, prior-FY, expense, transfer-leg, dues, approved, rejected, pending); bank-account validation (missing, malformed, wrong entity, inactive, supplied on same-entity); tier per destination; acknowledgment kept with donee stamped and removed when unsent; audit payload v2 round-trip and v1 parse; reader shows the move under both entities and degrades on a malformed row; double-submit writes one audit row and one move; the destination-duplicate preview; preview impact for both accounts.
- Live (not mocked) checks for qa: a closed-session Foundation row refused with the checklist, then movable after reopen and unmatch; concurrent match versus move; a sent-receipt row moved keeps its acknowledgment and the letter list still names the Foundation; Club register shows the receipt; delete of the moved row refused 409 `receipt_sent`; sweep deep link from the moved row opens Sweep mode with the minute empty.
- Re-check at Phase 6: Gaps 1, 3, 4, 5, 8; the dual-entity reader; the guide and release-note paragraphs (Foundation case, mirror case, no second-approver language, no acknowledgment promise).
- Housekeeping: fixtures use `example.com` donors and no real treasurer detail. Do not edit `docs/decisions.md` or `docs/backlog.md` from this phase; proposed items for the orchestrator: a DECISION for the cross-entity cell and ack snapshot; a backlog item re-aiming B-98 at the mirror pointer; a backlog item for the candidate-duplicate query if it is cut from v1.

---

## Phase 1 — Functional Refinement — 2026-10-01

**Owner:** analyst
**Status:** complete

### Summary
Cross-entity move is worth building for one cell only: income, Foundation Charitable to Club Activity, `LEDGER_MANAGE`, on an unreconciled and unmatched posted row, with an explicit destination bank account, the donor and the sent receipt carried, and a guided (not automated) checklist for the closed-session case. The mirror direction is deferred with its own denied branch because delete and re-enter is bank-consistent there and the move would collide with the sweep's cell and its board-minute requirement. The one real defect risk is that acknowledgments do not record their donee entity, so a moved receipt would lose its Foundation identity.

### What I did
- Read the parent work-log (all phases), B-96 and B-98, DECISION-108 to 111, the fund-move policy and queries and their tests, the move route, the transfer policy, the lock classifier, the sweep handling in the transaction form, the acknowledgment schema, route and letter queries, the reconciliation reopen and close routes and match table.
- Corrected five premises in the brief (finding numbering, the architect's Correction 2 scope, the close-before-move ordering, T3 scope, B-98's superseded text).
- Defined the verbs, Flow 1 (1a simple, 1b closed session), Flow 2 (deferred with rationale), the row-change table, refusal list, policy cells, tier, guard order, audit payload, dialog and register changes, gaps, adversarial pass, and the Phase 2 asks.

### Outputs
- `docs/work-log/2026-10-01-cross-entity-transaction-move.md` (this file)
- No code, `docs/decisions.md` or `docs/backlog.md` edits.

### Open questions / handoff notes
- Next agent: architect, Phase 2. Rule first on the acknowledgment donee snapshot (needs database-admin) and on the Open Question 1 default.
- Treasurer to answer: Open Questions 1, 2, 3 and 6 (real club facts and a permission check). Defaults are adopted so the pipeline is not blocked.
- If the board treats a cross-entity correction as a board act, Open Question 1 flips and the dialog gains a required minute field.

---

# Phase 2 — Architectural Review (architect)

**Date:** 2026-10-01 | **Owner:** architect | **Status:** complete

## Verdict

**Approved with suggestions.** The shape is right: one new policy cell, `LEDGER_MANAGE` for every cross-entity move, no reconciled carve-out, a guided (not automated) checklist, no email, no new `FEATURES` key, no dependency. Rulings R1 to R7 are **binding on Phase 3**. Items marked **REQUIRED** make the feature unsound if dropped: R1 (acknowledgment issuer id plus the in-transaction stamp), R2 (policy and test-set changes), R3 (guard pipeline, per-destination tier, the bank-account input), R4 (audit parser change and the dual-entity reader), and the live concurrency tests in R7. Everything else is a suggestion Phase 3 may adjust with a note.

### Corrections to Phase 1 (read these first)

1. **Gap 1 is real but its mechanism is overstated.** `ledger_acknowledgments.letter_text` is already the point-in-time snapshot of the fully merged letter (name, EIN, classification are inside it); `generateAcknowledgmentLetters()` hard-refuses a sent acknowledgment (DECISION-073 item 2); the email path sends the stored text. So "regeneration would render the Club's name on a letter the donor already received" cannot happen to a sent receipt, and an unsent one is removed by the move. What actually breaks after a move is **identity and findability**: every reader that joins the entity through the transaction (`listAcknowledgmentsSummary`, `getAcknowledgment().entity`, `getDonor` giving history) would name the Club as the issuer of a Foundation receipt; the Club register never loads acknowledgments at all (`isFoundationEntity && canRecord` gate, `[fundSlug]/page.tsx` line 171), so the receipt is unfindable from the row; and the acknowledgment has no way to say who issued it once its transaction has left. The fix is still required (R1) but its job is "who issued this, and show it", not "protect the letter text".
2. **A v2 audit payload is not a payload-only change.** `parseVersioned()` in `ledger-correction.ts` accepts only `v === 1`; a v2 row written without a parser change degrades to `{ raw }` and `getRecentLedgerCorrections()` lists a cross-entity move with every field null (and under whichever entity filter lets raw rows through). The parser and the reader change together (R4).
3. **The checklist's reopen step hides the month, it does not just "change" it.** The member-facing statement month is gated on every posted row on or before month end being reconciled (CLAUDE.md, Monthly Financial Statements). Reopening the Foundation session un-reconciles every row it cleared, so that month **disappears from `/members/financial-reports`** until the session is closed again. Phase 1 Gap 3 said "will show as changed"; the checklist copy must say "hidden from members until you close the session again".
4. **The migration backfill is itself a hazard on every re-run.** Migrations replay on every deploy. A backfill that stamps `donee_entity_id` from the transaction's *current* entity would, if it ever met a NULL on an already-moved row, stamp the Club. R1c closes this structurally (the move stamps before it changes the entity); the backfill is then only ever filling genuinely historical rows.
5. **Tier-before-policy is a behavior change for same-entity moves too.** Today the tier runs before the destination is known, so a record-only caller attempting a denied move on a reconciled row sees `manage_required`. The R3 order (policy, then state, then tier) fixes that for both shapes; the existing route tests that pin the old order change (listed in R3).
6. **Real-instance facts are deliberately not recorded here.** The repository is public. The orchestrator's production observations (the wrongly matched Foundation line, the Club-side deposit shape) are summarized only as: "the freed bank line needs its right entry before re-close; the Club-side match may be to a bundled deposit or another month", with no account fragments, amounts or donor detail.

---

## Placement

- **Pure policy:** `src/lib/ledger-fund-move-policy.ts` (edit; still pure, still keyed on `kind` and entity identity, never ids).
- **Pure lock/tier:** `src/lib/ledger-transaction-lock.ts` (edit): `requiredMoveTier()` gains an input saying the destination is cross-entity; add one pure classifier for the cross-entity state block (reuses `transactionLockKinds`).
- **Vocabulary (client-safe):** `src/lib/ledger-correction.ts` (edit): new codes, v2 payload types, parser, preview types, warning copy. No `@/lib/db` import.
- **DB orchestration:** `src/lib/ledger-fund-move-queries.ts` stays the single evaluator + execute. **Suggestion:** do not let it grow past about 800 lines; put the read-only preview-side computations (per-account balance impact, duplicate candidates, the closed-session `unlock` block) in a sibling `src/lib/ledger-fund-move-preview.ts`, and the acknowledgment settlement in `src/lib/ledger-fund-move-ack.ts` with its pure decision function exported for unit tests. Neither belongs in `ledger-queries.ts`.
- **Acknowledgment issuer resolution:** new tiny module `src/lib/ledger-ack-donee.ts` exporting the single SQL fragment (R1e).
- **Route:** `src/app/api/admin/ledger/transactions/[id]/move/route.ts` (edit): body parser gains one optional key; status map gains the new codes. Gate code unchanged (`LEDGER_RECORD`, then the row/destination-derived tier on the server).
- **UI:** `MoveTransactionDialog` and the Delete dialog (edit), the Foundation register eligibility, the Club register receipt marker, Treasury guide section. **Suggestion:** the cross-entity panel and the closed-session checklist are sub-components in `src/components/admin/ledger/`, not more branches inside one file.
- **Schema:** `src/lib/db/schema.ts` first (R1a), then one idempotent migration. database-admin joins Phase 4 and runs first.
- **Navigation / proxy:** none. No new page, no `ADMIN_NAVIGATION` change, no route outside the existing `move/` and register pages; DECISION-082 derived protection and `admin-page-feature-gates.test.ts` are unaffected.
- **Dependencies:** none.

---

## Rulings

### R1. Acknowledgment issuer: store `donee_entity_id` (REQUIRED), not a name/EIN snapshot

**Pick: a nullable `donee_entity_id` FK to `ledger_entities`, with COALESCE-to-the-transaction's-entity fallback in readers.** Reasons, in order of weight:

1. **The legal artifact is already snapshotted, at the right granularity.** For a sent receipt it is `letter_text` (or the uploaded file at `letter_storage_key`): the document as issued. Copying name/EIN/classification into three more columns would be a third copy of the same facts that cannot be joined, grouped or gated on.
2. **What the moved readers need is identity**, not strings: a join key for the issuer's name, the deductibility gate, and "was this issued by someone other than the register I am looking at". An id gives all three.
3. **The strings cannot drift.** `ledger_entities` is two seed rows and no route anywhere updates it (`update(ledgerEntities)` has no caller), so an id is as stable as a snapshot and cheaper. If entity editing is ever built, that feature owes a decision on receipts (it would also have to answer for the letter template's signature title).
4. It matches how this table already works: `amountCents` and `txnDate` are snapshotted because they are the receipt's own facts; the *issuer* is a reference to a stable party, like `donor_id`.

**a. Column.** `donee_entity_id uuid NULL REFERENCES ledger_entities(id)` (no cascade; an entity with receipts must not be deletable), no index (the table is small; lists already join per row). Add to `schema.ts` first with a header comment stating the invariant in (c). Nullable on purpose: it must tolerate acknowledgments written by old code between the migration and the new deploy, and the fallback makes NULL safe for every row that has not moved.

**b. Migration (database-admin, Phase 4).** Idempotent: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, the FK added in a guarded `DO $$ ... END $$` block named exactly as drizzle-kit will name it (`ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk`) so `drizzle-kit push --force` finds no diff to "fix", and the backfill `UPDATE ledger_acknowledgments a SET donee_entity_id = t.entity_id FROM ledger_transactions t WHERE a.donee_entity_id IS NULL AND t.id = a.donation_txn_id`. **The migration number is a placeholder**: a parallel increment may claim it. database-admin re-derives the real next-free number at Phase 4 start (`ls drizzle/migrations/*.sql | sort | tail -3`; the latest at the time of the parent work was 0108). No `SET NOT NULL` in this increment (see B-next-D).

**c. Write-once, and who may write it (the invariant).** The value is written exactly three ways: (i) the acknowledgment-create route (`acknowledge/route.ts` POST) writes the transaction's entity id, which it already loads; (ii) the migration backfill, NULL rows only; (iii) the move, which stamps `COALESCE(donee_entity_id, <source entity id>)` on a kept acknowledgment **inside the same transaction and before the transaction's entity changes**. No other writer (mark-sent, purpose edit, letter generation, email claim, letter upload) sets it. A unit test pins that each of those `.set({...})` objects lacks the key. (iii) is what makes the on-every-deploy backfill safe: after any move the column is non-NULL, so a replay never restamps it.

**d. Acknowledgment handling inside the move transaction.** After the row lock: `SELECT ... FROM ledger_acknowledgments WHERE donation_txn_id = $id FOR UPDATE`. Pure decision `decideAckOutcome({ exists, sent })` returns `none | kept | removed`:
- no acknowledgment: `none`;
- `sent_at` set: `kept`, stamp the issuer (c-iii); `sent_at`, `sent_via`, `letter_text`, `letter_storage_key`, `donor_id` are never touched;
- unsent: `removed` via `DELETE ... WHERE id = $ack AND sent_at IS NULL RETURNING id` (the DECISION-108 pin). If zero rows return (the email path claimed it between the lock read and now), re-read and treat as `kept`. Lock-first plus the pin means a concurrent email claim either completes before the lock (we see it sent, keep it) or blocks behind the move and finds no row.
- The outcome and the acknowledgment id/sent flag go in the audit `details`.
- **Accepted residual, stated:** if an in-flight email claim is later reverted by a total send failure, a kept acknowledgment flips back to unsent on a Club row with a Foundation issuer stamp. It is self-consistent (the stamp makes any later generation compose as the Foundation), invisible to the deductible-gated pending queue, and a failure inside a seconds-wide window of a rare operation. Not worth a second lock protocol.

**e. One shared fragment, not five copies.** The acknowledgment readers that join the entity through the transaction are at least five (`listGeneratableAcknowledgments`, `listAcknowledgmentsSummary`, `getAcknowledgment`, the register's ack map, `getDonor` giving history). CLAUDE.md's duplication rule applies: export from `ledger-ack-donee.ts` one Drizzle SQL fragment `coalesce(ledger_acknowledgments.donee_entity_id, ledger_transactions.entity_id)` and one documented rule for which readers use it. Which reader follows what:

| Reader | Follows | Ruling |
|---|---|---|
| `listGeneratableAcknowledgments` (letter composition, email claim) | **Receipt** | Join the entity on the fragment. Sent acknowledgments are refused before composition anyway; this only guarantees any future unsent acknowledgment on a moved row composes as its issuer. No new reprint or regenerate path is created. |
| `listAcknowledgmentsSummary` (donors page sent/pending views, register map) | **Receipt** | `entityName` becomes the issuer's name; add `doneeEntityId`/`doneeEntityName` to the row type. |
| `getAcknowledgment().entity` | **Receipt** | Same fragment. |
| `getDonor` giving history | **Row** for entity/fund names (where the money is now); **receipt** for the badge | Keep the row's entity name; add "Receipt issued by <issuer>" when it differs. Suggestion level. |
| Club register ack marker | **Receipt** | Load the acknowledgment summary for every ledger entity when `canRecord` (the table is tiny), not only the deductible one, and render a read-only "Receipt on file (issued by the Foundation)" only where issuer differs from the register's entity. |
| `listPendingAcknowledgments`, `listUnlinkedGifts` | **Row** | The `donationsDeductible` gate on the transaction's entity stays: a Club row is correctly not "a gift needing a receipt". A moved row drops out of the pending queue, which is correct. |
| Acknowledgment create/PATCH route gate | **Row** | You cannot create a new receipt on a Club row. Existing-acknowledgment paths are refused for sent rows before any entity check. |
| Compliance, 990 determination, entity gross receipts, impact reporting | **Row** | They sum posted rows by entity; money follows the row. The Foundation's income falls by the gift now and rises by the sweep's transfer-in leg later (Phase 1 Gap 9). Impact reporting counts expenses only (unchanged). |

A receipt follows its issuer; money follows the row. The legal question this opens (is a Foundation receipt still the right document for a gift the Foundation's books no longer carry) is Phase 1 Gap 2 / Open Question 2, a tax-adviser matter. The ledger preserves and warns; it does not decide.

### R2. Policy: one new cell, and the T3 reasoning is confirmed (REQUIRED test changes)

**T3 holds.** The new allowed cell is income, `charitable` to `activity`, entities differ. `checkTransferDirection()` denies it unconditionally (cross-entity, `source.kind === "charitable"`, "one-way flow by policy"), so the cartesian "no pair allowed by both policies" test stays literally true. The cell the sweep owns (`activity` to `charitable`, cross-entity) is denied by the move policy, as is `administrative` to `charitable` (denied by both), so Flow 2 as a move would put one pair in both allow-lists. The analyst's reasoning is correct. Note the cell is keyed on `kind` plus "entities differ", so a same-entity `charitable` to `activity` pair stays denied (`not_permitted`); a test must pin that, or a kind-only implementation would silently open it.

**Decision tree (replaces the early `cross_entity` return):**
1. same fund: `same_fund` (409, unchanged).
2. entities differ:
   - flow is not `income`: `cross_entity` (unchanged; cross-entity expense stays denied under its old code);
   - `charitable` to `activity`: **allowed (new)**;
   - `charitable` to `administrative`: `away_from_public` with cross-entity wording ("Public money cannot be moved into the Administrative Fund." No "Activity Fund income" sentence, which would be false here);
   - `activity` or `administrative` to `charitable`: **`club_to_foundation_not_supported` (new code, its own branch and test slot)**, reason: "A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register." The sweep, not a move, is the only way Club money reaches the Foundation, and the sweep's board-minute is what gates it;
   - anything else: `cross_entity`.
3. same entity: unchanged (one allowed cell, income administrative to activity).

**Test changes (all REQUIRED):** T1 changes from "exactly one allowed cell" to "exactly these two cells" and enumerates them; T3 runs unchanged and must stay green; add the second pinned divergence (charitable to activity cross-entity: move allowed, transfer denied); add "the move policy never allows the cell the sweep allows" (activity to charitable cross-entity: transfer allowed, move denied with `club_to_foundation_not_supported`); add "same-entity charitable to activity is denied"; the T2 code-set assertion adds `club_to_foundation_not_supported`; the T2 test `a different entity is cross_entity` is rewritten (the `activity` to `charitable` example now returns the new code); update the cross-reference comment blocks in both policy files (R2c of the parent log still applies: do not merge them).

**Residual risk to record in DECISION-112:** the valve is "charitable money never flows back to the Club", enforced for movement of value. This move reclassifies provenance (the cash was never in the Foundation's account), and provenance is not machine-verifiable. A `LEDGER_MANAGE` holder can reclassify any unreconciled, unmatched posted Foundation income row into the Club. The Activity Fund keeps it public (it can leave only through a minuted sweep or Activity expenses). Compensating controls: a required destination bank account on the Club, a required reason, both-entity audit, the Recent corrections reader under both entities, the `receipt_sent` warning, and the sweep that follows. See R7 on the "no minute" decision.

### R3. Guard pipeline, per-destination tier, `destBankAccountId` (REQUIRED)

The analyst's nine-step order is adopted with these amendments.

1. **One evaluator shape, split on what depends on the destination.** `evaluateFundMove()` keeps only the destination-independent row-state block (approved, rejected, pending, dues-synced, transfer leg) and the source fund load; it no longer computes the tier. A new per-destination evaluation (the existing `evaluateDestination()`, extended) runs steps 3 to 6 in order: policy, cross-entity state preconditions, tier, then (POST only) input. The preview loop calls the same function per destination; POST calls it once on the locked row. Parity is therefore structural.
2. **Order, identical for GET and POST:** row exists (404) and row-state block (403) -> `expectedFundId` stale (409, POST only; it stays ahead of the policy so a double-click on a cross-entity move answers `stale`, not `same_fund` or `club_to_foundation_not_supported`) -> destination fund exists (404) -> **policy** (`same_fund` 409, otherwise 403 with the policy reason) -> **cross-entity state preconditions** (403: `reconciled_session`, `reconciled_legacy`, `matched_open_session`, `prior_fiscal_year_cross_entity`; code names reuse the `TransactionLockKind` names so the classifier, `LOCK_COPY` and the codes cannot diverge) -> **tier** (403 `manage_required`) -> input (400s) -> stored-account assertion (same-entity only) -> category validation -> pinned UPDATE -> acknowledgment -> audit.
3. **Tier is `requiredMoveTier(row, now, { crossEntity })`.** A cross-entity move always requires `LEDGER_MANAGE`; the reason list gains `"cross_entity"`. Same-entity tiering is unchanged.
4. **Contract change for GET (REQUIRED, and the one place this is not a pure addition).** Because tier is a function of (row, destination), a whole-preview 403 `manage_required` cannot represent "this destination needs Manage, that one does not". The preview now returns 200 with a per-destination `allowed: false, denial: { code: "manage_required", ... }` for tier refusals, plus the caller's capability so the dialog can render the checklist and the tier message. Destination-independent row-state blocks stay top-level 4xx. The parity statement becomes: **every destination GET lists as allowed passes steps 1 to 6 in POST; every denial GET lists carries the code and status POST would return; step 7 (input) refusals are POST-only by nature.** A parity test iterates every code. This changes today's same-entity behavior for a record-only caller on a reconciled row (GET was top-level 403, now a per-destination denial); the dialog must render it; existing GET/route tests that pin the old top-level shape are updated.
5. **Existing tests that pin the old order and will change (expected, not regressions):** the policy-vs-bank-assertion order test (`bank_account_entity_mismatch` before policy), any test asserting `manage_required` is returned before a policy denial, and the GET top-level `manage_required` assertion.
6. **`destBankAccountId`.** Body gains one optional key; absent is treated as `null`; the exact-key-set discipline otherwise stays (unknown keys 400). Shape errors (wrong type) are `invalid_body`. Then, evaluated inside the transaction on the destination fund's entity, never the client's:
   - cross-entity, absent/null: 400 `dest_bank_account_required`;
   - cross-entity, malformed (`isUuid`), missing, inactive, or owned by a different entity: 400 `dest_bank_account_invalid`;
   - **same-entity, non-null: 400 `dest_bank_account_not_allowed`** (its own code, so the smuggling attempt is distinguishable in logs and tests).
7. **Two UPDATE shapes, built separately (REQUIRED).** The same-entity path's `.set({...})` is exactly today's (`fundId`, `categoryId`, `budgetLineId: null`, `updatedAt`) and can never contain `bankAccountId` or `entityId`; the cross-entity path builds its own object (`entityId` = `dest.entityId` from the destination fund row, `fundId`, `bankAccountId`, `categoryId`, `budgetLineId: null`, `updatedAt`). A unit test asserts the key sets of both. The cross-entity UPDATE is pinned `WHERE id AND fund_id = locked.fund_id AND entity_id = locked.entity_id AND reconciled = false AND reconciled_session_id IS NULL RETURNING id`; zero rows is 409 `stale`. This is what keeps the same-entity reconciled carve-out's premise ("the bank account never changes") true.
8. **The open-session match check runs on `tx`** (`getMatchForTransaction` or an equivalent that takes the transaction handle), after the row lock, so it reads the post-lock state. A concurrent match insert takes a key-share lock on the referenced row, which conflicts with `FOR UPDATE`, so match-then-move serializes and the move sees the match; this needs one live test (R7).
9. **Accepted residual (backlog B-next-C):** `match/route.ts` reads the transaction's bank account without a lock and inserts afterwards, so move-commits-then-match inside a sub-millisecond window could link a Club row to a Foundation session's bank line. This is the same read-then-write shape the bank-account PATCH already has; closing it means making the match insert re-verify under a lock, which is a change to a different route and out of this increment. The close-time tie-out would surface it.
10. **Preview additions (shape is Phase 3's):** per-destination `crossEntity`, `tier`, destination entity, active destination bank-account options (and the "no active account" empty state, which makes the destination unavailable with its reason), per-account before/after book balances for both accounts, receipt state (`none | sent | unsent`), sent-statement months for each entity via the existing `findSentStatementMonth()` (Foundation is member-exposed, Club Activity is not), the structured `unlock` block, and duplicate candidates (R7). The "bank account balance unchanged" line must not render on a cross-entity move.

### R4. Audit `v: 2` and the dual-entity reader (REQUIRED)

- **Shape.** Cross-entity moves write `v: 2`; same-entity moves keep writing `v: 1` unchanged (shipped rows exist and the shape is correct for them; no reason to widen it, and it avoids touching a shipped writer's tests). `before` and `after` carry `entity { id, name, slug }`, `fund`, `bankAccount { id, name }`, `category`, `budgetLineId`. `details` keeps every v1 field and adds `destEntityId`, `crossEntity: true`, `destSentStatementMonth`, `donorId`, and `acknowledgment { id, sent, sentAt, outcome: "none" | "kept" | "removed", doneeEntityId }`. **`details.entityId` stays the source entity**, so any reader that only knew v1 still lists the move under the source.
- **Parser (REQUIRED change).** `parseVersioned()` accepts versions 1 and 2; each of `before`, `after`, `details` is validated with its own shape guard keyed on version (v2 `details` requires a string `destEntityId`; v2 `before`/`after` require `entity`, `fund`, `bankAccount`). Anything that fails a guard still degrades to `{ raw }`, never throws, never hides the row. Round-trip tests for v1 and v2; one for an unknown version (raw).
- **Reader.** `getRecentLedgerCorrections()` matches a moved row when the requested entity equals `details.entityId` **or** `details.destEntityId` (the delete reader already applies the any-leg rule). `LedgerCorrectionRow` gains `crossEntity`, `fromEntityName`, `toEntityName`, `fromBankAccount`, `toBankAccount`, `receiptSent` (names come from the self-describing payload; no joins). The compliance section labels direction ("Foundation to Club"), shows both fund and account names, the reason, and "Receipt already sent". A malformed or raw row is still listed. The member-surface import guard (T33) continues to protect `ledger-audit.ts` and `ledger-correction.ts`; add the new modules (`ledger-fund-move-preview.ts`, `ledger-fund-move-ack.ts`, `ledger-ack-donee.ts`) to the guard's list only if they ever import audit text (they should not).
- The move still writes exactly one audit row, in the same `tx`, after the update and the acknowledgment settlement, and never on a refused, stale or no-op request.

### R5. Register pointer for the mirror direction (B-98 re-aim)

- **No heuristic.** The analyst's trigger ("a Club Activity income row whose method or note suggests a Foundation gift") would depend on free-text matching, which produces false positives and silent misses, and overlaps B-93 (the public-money-in-Administrative detector). Do not build it.
- **Rule:** a static, always-correct one-line pointer rendered by the Delete dialog on any **Club income** row, with no server field and no data dependence (the dialog already knows entity and flow): "If this gift's money is actually in the Foundation's bank account, delete this entry here and enter it on the Foundation's register on Foundation Checking." Same paragraph in the Treasury guide under Deleting an entry. It is a Server/Client no-op: a prop already available.
- The pointer's natural second home is the Move dialog itself: a Club Administrative income row lists the Foundation's Charitable fund as a **denied** destination carrying the `club_to_foundation_not_supported` reason, which is the same sentence. Club Activity income rows have no allowed destination, so D1 omits the Move button and the Delete pointer is the only surface; that is intended.
- The Foundation register: the Move button reappears on income rows that are otherwise movable; eligibility is derived from `checkFundMove()` over **all** funds (the page currently reasons over its own entity's), plus "the destination entity has an active bank account" (Gap 12). Closed-session rows show the lock label plus "If the money is in the Club's account, see Move to the Club."
- Wording rules for the guide and release note: "Moved", never "Reversed" or "Voided"; no "second approver" language for `LEDGER_MANAGE`; do not promise an acknowledgment for the sweep's Foundation leg; "Emailed" is not relevant (no email is sent).

### R6. Invariant checklist

- **Schema is the source of truth:** `schema.ts` first, then the idempotent migration (R1b); database-admin joins Phase 4 and runs before api-developer. No other table or column changes.
- **Migrations idempotent:** guarded FK, `IF NOT EXISTS`, backfill only `WHERE donee_entity_id IS NULL`; replay-safe because of R1c(iii). Number is a placeholder (R1b).
- **Permissions are the only gating mechanism:** no flag, no kill switch. `LEDGER_RECORD` reaches the route; `LEDGER_MANAGE` for every cross-entity move, derived server-side from (row, destination) and re-evaluated on the locked row. No new `FEATURES` key, no role-binding migration. `ledger.manage` is bound to `admin` only (migration 0045) and the treasurer is one of two admins, so the treasurer holds it, but it is **not** a second approver.
- **Route gates in the body, not only the proxy:** unchanged route, so the existing `auth()` + `hasFeature()` stays; GET and POST both gate.
- **Server/Client:** pages and readers stay Server Components; the dialogs are the only clients; policy, classifier, codes and vocabulary stay pure and client-safe; the server is the authority.
- **No email, no durable claim:** the move writes no `email_queue` row and never writes or clears `sent_at`/`sent_via`; it retains an existing claim. `sendEmailForDurableClaim()` does not apply. The Foundation statement's corrected-resend panel is read-side and unchanged (it already flips on a changed fingerprint); `financial_report_sends` is read-only here. The in-flight-email revert residual is stated in R1d.
- **No personal data:** fixtures use `example.com`; no donor, treasurer, account fragment or amount from the real instance in tests, migrations or docs. The reason text is runtime data and never reaches a member surface.
- **Duplication rule:** category-vs-kind validation must call the existing shared `validateCategoryForFund()` (no fifth copy); issuer resolution lives in one fragment (R1e); lock vocabulary reuses `TransactionLockKind` names; the audit write uses `recordLedgerAudit()`.
- **No native dialogs, brand:** shadcn `Dialog`; a move is not destructive (no red); `rounded-2xl` cards, `rounded-lg` buttons; 44px targets on the new selects.
- **Next.js 16:** the route stays a thin edit of an existing handler; no new conventions. If the register page's data loading changes materially, re-check `node_modules/next/dist/docs/` for the params/caching conventions before editing.

### R7. Phase 1 gaps and open questions: pulled in, pushed out, ruled

| Item | Ruling |
|---|---|
| Gap 1 (receipt issuer) | **IN**, R1. Required. |
| Gap 2 (legal characterization) | Stays a board/adviser matter. Warning plus guide sentence only. Real club fact to confirm with the treasurer. Not a reason to hold design. |
| Gap 3 (closed session is a tie-out) | **IN** as the checklist; copy corrected per Correction 3 ("hidden from members until closed again"; "give the freed line its right entry before re-close"; "the Club-side deposit may be part of a bundled deposit or another month, so match with care"). |
| Gap 4 (duplicate candidates) | **IN as advisory only, and cut-able.** Same amount, income, posted, destination entity, a bounded date window, cap of five, showing date, party and matched/reconciled flags; never blocks. It lives in `ledger-fund-move-preview.ts`. State plainly in the guide that a bundled deposit is not detectable. If it threatens the increment's size, tech-lead may cut it to backlog (B-next-E) with a note; it is not load-bearing for correctness. |
| Gap 5 (dest bank account required) | **IN**, R3.6. |
| Gap 6 (statements for both entities) | **IN**, `findSentStatementMonth()` per entity. Also state in the preview that moving an unreconciled Foundation row out can un-gate a month (the parent log's R6 month-gating note applies to the Foundation too), and that the checklist's reopen step hides it. One explicit test each. |
| Gap 7 (aged public fund) | **IN** as dialog copy (existing warning). |
| Gap 8 (sent receipt blocks delete afterwards) | **IN** as the cross-entity ratchet sentence; the hardened DELETE already returns 409 `receipt_sent`. |
| Gap 9 (Foundation income readers) | Phase 3 reads and states the effect in the dialog. Architect check done at this level: 990 determination, compliance guardrails and entity totals read rows by entity; none joins acknowledgments; impact reporting counts expenses only. Money follows the row (R1e). |
| Gap 10 (sweep prefill wording and UTC date) | **IN, small.** The `sweepFrom` prefill derives "moved from <source>" and the date from the most recent `transaction_fund_moved` audit row for that transaction (`targetTransactionId` survives a move), never from the page-load clock. The existing "moved from Administrative" wording is wrong for this path and must be generalized. |
| Gap 11 (concurrency) | **IN**, live tests (below). |
| Gap 12 (empty/error states) | **IN**, R3.10 and R5. |
| Open Question 1 (board minute on the move) | **Confirm the orchestrator's default: no minute.** The control inventory is `LEDGER_MANAGE`, a required reason, a required destination account, the unreconciled-and-unmatched precondition, both-entity audit and reader, and the board-minuted sweep that must follow for the money to reach the Foundation. State the asymmetry honestly in DECISION-112: the sweep needs a minute because it moves Club money to the Foundation; this move pulls Foundation-recorded money into the Club on one admin's say-so. If the board later considers that a board act, the flip is one required input (`boardMinuteReference`) on a cross-entity move, plus its audit field; nothing structural changes. Suggestion: the guide tells the treasurer to mention a receipted-gift move at the next board meeting. |
| Open Question 3 (prior FY) | Confirm: refused (`prior_fiscal_year_cross_entity`). |
| Open Question 5 (unsent acknowledgment) | Confirm: removed with the move, recorded in the audit `details` (R1d). |
| Open Question 6 (does the treasurer hold `ledger.manage`) | The parent log established it (admin-only binding, the treasurer is one of two admins). Not re-derivable from the repo for the live role table; qa should confirm on the live instance once. |
| Flow 2 (mirror) | **Confirmed denied as its own branch** (R2). The supported path is delete and re-enter on the Foundation register, which is bank-consistent. Revisit conditions are in B-next-B. |

**Live (not mocked) tests REQUIRED** (parent-log precedent; the mocked suites cannot prove these): (1) a closed-session Foundation row is refused with the checklist data, then movable after reopen and unmatch; (2) match-first-then-move is refused and move-first-then-match leaves no orphan match for the moved row's session; (3) a double submit writes one move and one audit row; (4) a sent-receipt row moves, keeps its acknowledgment, the donee stamp equals the Foundation, the sent-acknowledgments view still names the Foundation, the Club register shows the receipt marker, and DELETE of the moved row returns 409 `receipt_sent`; (5) an unsent acknowledgment is removed and reported; (6) the same-entity path refuses a supplied `destBankAccountId` and its UPDATE never carries `bank_account_id`; (7) the sweep deep link from the moved row opens Sweep mode with the minute empty and "moved from the Foundation" wording; (8) migration replay after a move does not restamp the issuer.

---

## Proposed decision text (orchestrator to add to `docs/decisions.md`; architect did not edit it)

**DECISION-112: Cross-entity move of an income row, Foundation Charitable to Club Activity (one cell); acknowledgments record their issuing entity; audit payload v2** (Status: Resolved; Date: 2026-10-01). **Decision:** (1) The cross-entity restriction in DECISION-109 is relaxed for exactly one cell: income, Foundation `charitable` fund to Club `activity` fund, via the existing `POST/GET .../transactions/[id]/move` endpoint with one new optional body key `destBankAccountId`. Every other cross-entity pair stays denied, each with its own code; `administrative` or `activity` to `charitable` is denied as `club_to_foundation_not_supported` because the sweep is the only crossing of Club money into the Foundation and its board-minute is what gates it. (2) The two direction policies still must not be merged; the new cell is denied by `checkTransferDirection()` (one-way valve) so the mutual-exclusion test holds, and the sweep's cell is denied by the move policy. This move is a reclassification of provenance, not a movement of value. (3) The reconciled-row carve-out of DECISION-109 item 4 does **not** extend: a cross-entity move changes `bank_account_id`, the column reconciliation is keyed on. A cross-entity move requires the row to be unreconciled by either mark, not matched in an open session, and in the current fiscal year; the dialog guides the treasurer through reopen, unmatch, move, give the freed bank line its right entry, re-close, sweep, and automates none of it. (4) `LEDGER_MANAGE` for every cross-entity move, evaluated server-side from (row, destination) on the locked row; the tier is a function of the pair, so the preview reports it per destination and the guard order is policy, state, tier, input. No new `FEATURES` key; not a second approver. (5) `ledger_acknowledgments.donee_entity_id` (nullable FK, write-once) records who issued a receipt; readers that describe the receipt follow it, readers that sum money follow the transaction; a kept (sent) acknowledgment is stamped inside the move transaction before the entity changes, an unsent one is removed and audited; `sent_at` and the letter are never touched. A name/EIN snapshot was rejected: `letter_text` already snapshots the letter and entity rows are immutable in practice. (6) Audit: cross-entity moves write `v: 2` (both entities, both bank accounts, acknowledgment outcome); same-entity moves keep `v: 1`; the parser accepts both; the Recent corrections reader matches either entity. (7) No board-minute on the move itself (residual risk: one admin can reclassify any unreconciled, unmatched Foundation income row into the Club; compensated by the reason, both-entity audit, the receipt warning and the minuted sweep that follows; flip is one required field). **Rationale:** the treasurer's next occurrence is a gift deposited into the Club's account but booked to the Foundation, with a receipt already sent: delete is blocked by DECISION-110 and delete-and-re-enter would destroy the receipt record. **Impact:** `ledger-fund-move-policy.ts`, `ledger-transaction-lock.ts`, `ledger-correction.ts` (parser v2), `ledger-fund-move-queries.ts` (+ preview and ack siblings), `ledger-ack-donee.ts`, `ledger-audit.ts`, the move route and dialog, the register pages, the Treasury guide; one schema change and one idempotent migration; no new dependency, no email. Follow-ups: B-next-A to B-next-E.

## Proposed backlog text (orchestrator to add to `docs/backlog.md`; architect did not edit it; labelled "B-next" because an audit is about to claim a block of IDs)

- **B-next-A (re-aims B-98) — Mirror-direction pointer.** B-98 proposed "delete, re-enter as Activity, sweep" on the Foundation Delete dialog; that path is blocked once a receipt is sent and Move now replaces it. Re-aim it at the mirror: a static one-line pointer in the Delete dialog on any Club income row and a guide paragraph ("if this gift's money is in the Foundation's account, delete here and enter it on the Foundation's register on Foundation Checking"). No free-text heuristic (that is B-93's territory). Folded into this increment's UI; keep the item open until it ships.
- **B-next-B — Club-to-Foundation move (the mirror as a move).** Deferred. Revisit only if the treasurer hits a case delete-and-re-enter cannot serve. Conditions: lands in the Foundation's Charitable fund on a picked Foundation account, `LEDGER_MANAGE`, a board-minute reference required (it bypasses the sweep's gate otherwise), a new Foundation acknowledgment becomes available on the moved row, and the mutual-exclusion test needs one named, tested exemption for that single cell. Extends B-96.
- **B-next-C — Match route re-verifies under a lock.** `reconciliation/sessions/[sessionId]/match/route.ts` reads each transaction's bank account without a lock and inserts afterwards, so a concurrent cross-entity move (or a bank-account PATCH) in a sub-millisecond window could leave a match pointing at another account's row. Make the insert re-verify account and `reconciled = false` inside one transaction under `FOR SHARE`.
- **B-next-D — Tighten the acknowledgment issuer.** After one release, set `donee_entity_id NOT NULL` (the migration and the move have stamped every row by then) and drop the COALESCE fallback; assert in a test that every acknowledgment writer sets it. Optional: show "Receipt issued by <issuer>" in the donor giving history.
- **B-next-E — Duplicate-candidate warning for moved gifts** (only if cut from this increment): same amount, income, posted, in the destination entity within a date window; advisory; cannot see a bundled deposit.

---

## Phase 2 — Architectural Review — 2026-10-01

**Owner:** architect
**Status:** complete

### Summary
**Approved with suggestions.** The single new cell (income, Foundation Charitable to Club Activity) is sound: the mutual-exclusion test with the transfer policy stays literally green, the sweep's cell stays denied by the move policy, and no reconciled carve-out extends because a cross-entity move changes the bank account. Four things are REQUIRED before Phase 3 can close: an acknowledgment issuer id written write-once and stamped by the move inside its transaction (a name/EIN snapshot was rejected), the policy and test-set changes (T1 becomes two cells; a new denied code for the Club-to-Foundation direction), a re-ordered guard pipeline with per-destination tier and a `destBankAccountId` that is a 400 on same-entity moves, and a parser change so the v2 audit payload does not degrade to raw plus a reader that matches either entity.

### What I did
- Read the Phase 1 work-log in full, the parent log's Phase 2 rulings and the 109/110/111 decisions, `ledger-fund-move-policy.ts` and its test, `ledger-fund-move-queries.ts`, the move route, `ledger-transfer-policy.ts`, `ledger-transaction-lock.ts`, `ledger-correction.ts` (payloads and parser), `ledger-audit.ts`, the acknowledgment letter and acknowledgment query code, the acknowledgment schema, the acknowledge route, the register page's acknowledgment loading, and the reconciliation match route.
- Corrected six Phase 1 premises (the real mechanism of the receipt risk, the v1-only parser, the member-visible effect of reopening, the replay hazard in the backfill, the tier-order behavior change, the public-repo constraint on production facts).
- Ruled on all seven asks: issuer id over snapshot with a shared resolution fragment and a reader-by-reader follow-the-receipt versus follow-the-row table; the policy decision tree and test changes; the guard pipeline and `destBankAccountId`; audit v2 with the dual-entity reader; the mirror pointer as a static line (no heuristic); the invariant checklist; and the gap triage.
- Drafted DECISION-112 and backlog wording in this file only.

### Outputs
- `docs/work-log/2026-10-01-cross-entity-transaction-move.md` (status table updated; this section added)
- Proposed DECISION-112 and B-next-A to B-next-E are in this file; `docs/decisions.md` and `docs/backlog.md` were not edited.
- No code, schema or migration changes. Migration filename/number is a placeholder; database-admin re-derives it at Phase 4 start.

### Open questions / handoff notes
- **Next agent: tech-lead (Phase 3).** Design must name database-admin first (schema.ts, then migration), then api-developer (policy, lock/tier, vocabulary and parser, queries/preview/ack siblings, route, audit reader, acknowledge-route stamp, readers per R1e), then ux-developer (dialog sub-components, both registers, Delete pointer, compliance section, guide).
- Phase 3 must restate the per-destination preview contract, the new error codes and their statuses, and which existing tests change (R3.5).
- Treasurer to confirm real club facts: Open Questions 1, 2 (tax-adviser sentence), 3, 6, and what the freed Foundation bank line turned out to be (so the checklist wording matches practice). Defaults are adopted; the pipeline is not blocked.
- Phase 6 re-check list: R1 (issuer stamp and Club register marker), R2 (T1/T3 and the new code), R3.4 (GET per-destination contract), R3.7 (two UPDATE shapes), R4 (v2 round trip, dual-entity reader), the live tests in R7, and the guide/release-note wording rules in R5.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-10-01

**Owner:** tech-lead
**Status:** complete

### Summary

Extend the shipped v1.86.0 move (DECISION-109/110/111) across the entity boundary for exactly one cell: **income, Foundation Charitable to Club Activity**, through the same `GET/POST /api/admin/ledger/transactions/[id]/move` endpoint with one new optional body key, `destBankAccountId`. The move reclassifies the row's entity, fund, bank account and category in one transaction, keeps the donor and any **sent** receipt (stamping the receipt with the entity that issued it, via a new nullable write-once `ledger_acknowledgments.donee_entity_id`), removes an **unsent** receipt record and says so, and writes a `v: 2` audit row that both entities' compliance pages can read. It never touches `sent_at`, sends nothing, and writes no durable claim. Every cross-entity move needs `LEDGER_MANAGE`; a row that is reconciled by either mark, matched in an open session, or dated in a prior fiscal year is refused with a guided checklist rather than a carve-out. The preview becomes per-destination (tier, warnings, bank-account options, impact, duplicate candidates, unlock block), the guard order becomes policy, then state, then tier, then input, and the same-entity UPDATE shape is built separately so it can never carry a bank account. One schema change (one column, one idempotent migration), no new `FEATURES` key, no dependency, no email, no new page. Specialist split: **database-admin, then api-developer, then ux-developer.**

### Rulings that differ from, or refine, Phase 1/2 (read first)

| # | Phase 1 / 2 said | Phase 3 ruling | Why |
|---|---|---|---|
| X1 | R3 order lists the pinned UPDATE at step 8 and acknowledgment handling at step 9; R1c(iii) says the stamp is written "before the transaction's entity changes". | **Acknowledgment settlement is step 8 and the pinned UPDATE is step 9** (audit row last). A pinned UPDATE that returns zero rows **throws a private rollback sentinel** that `executeFundMove()` catches and maps to `409 stale`. | The two Phase 2 statements contradict each other. And the obvious implementation of "settle, then UPDATE, then `return fail(409,'stale')` on zero rows" is a trap: **returning from a `db.transaction` callback commits**, so the ack deletion or stamp would persist while the row stayed put. Throwing rolls everything back. The stamp value is the source entity id captured from the locked row, never a join, so ordering is not otherwise load-bearing. |
| X2 | R3.2 lists the cross-entity state codes as `reconciled_session`, `reconciled_legacy`, `matched_open_session`, `prior_fiscal_year_cross_entity` in that order. | Order is **`prior_fiscal_year_cross_entity`, `reconciled_session`, `reconciled_legacy`, `matched_open_session`**; the three pure checks run before the one DB read. | A prior-year row can never succeed in v1. Listing "reconciled" first would send the treasurer through a reopen and an unmatch (the checklist) only to hit a dead end. Refuse the impossible first. |
| X3 | R3.4: GET returns `tier`, `warnings` at the top level plus per-destination tier denials. | **`tier` and `warnings` move onto each destination** and the top-level fields are removed. | Ratchet wording, receipt state, per-entity statements, duplicate candidates and the tier all depend on the destination. A top-level list would be wrong for one of the two shapes. The dialog is the only consumer; its tests change (listed below). |
| X4 | R3.9: the match route race window is "sub-millisecond"; B-next-C stays backlog. | **Still deferred (B-105), but the window is the duration of the move transaction, not sub-millisecond**, and live test 2 is rewritten (2c). | `match/route.ts` reads each transaction's bank account with a plain unlocked SELECT, then inserts. A plain SELECT is not blocked by the move's `FOR UPDATE`, and the insert's key-share lock waits for the move to commit and then **succeeds**. So any match whose read lands inside the ~15-round-trip move transaction produces a Club row matched to a Foundation bank line. Still needs two admins on one row inside ~100 ms and the close-time tie-out would surface it, so I do not pull a change to the treasurer's core reconcile route into this increment; B-105 is raised to "Soon" with this correction. |
| X5 | R5 / Phase 1 pointer: "...enter it on the Foundation's register on Foundation Checking." | The static Delete-dialog sentence says "in the bank account the money landed in", **not** a named account. | Static product copy must not hard-code a data value that the treasurer can rename; a wrong account name in a correction instruction is worse than a generic one. |
| X6 | R4 / R1e name the new reader fields `doneeEntityId` / `doneeEntityName` on `listAcknowledgmentsSummary`. | `entityName` **keeps its field name and becomes the issuer's name** (zero change to `sent-ack-list.tsx`); add `doneeEntityId` and `rowEntityName` (where the money is now). | The only existing consumer renders `entityName` as "who issued this". Adding a second name field beside it would leave two ways to read the same fact. |
| X7 | Phase 1: Move response carries `sweepSuggested`; dialog builds the deep link from its `entitySlug` prop. | `MoveResponse` gains **`entitySlug`** (destination entity) and the dialog builds the sweep link from it. | The `entitySlug` prop is the *register's* entity. On the Foundation register it would produce `/admin/ledger/activity?entity=foundation&sweepFrom=...`, which validates to nothing. A latent bug the one-cell v1 could not hit. |
| X8 | R3.1 reuses `getLaterClosedSessionForAccount()` for the checklist. | Add `listLaterClosedSessionsForAccount()` beside it (newest first); leave the shipped function alone. | The shipped function returns the **earliest** later closed session, but a reopen is refused while **any** later session is closed, so the first name it gives is itself not reopenable. The checklist needs the whole newest-first list. |
| X9 | Phase 2 Correction 3: reopening hides "that month" from members. | Copy says statements **"from that month onward can be hidden ... until you close the session again."** | `isMonthGatedForEntity()` gates every month whose end is on or after any un-reconciled posted row's date, so a reopen can hide the session month **and every later month**. |
| X10 | Phase 1 Gap 12 / D1: omit Move where no legal destination. | Also **omit on Foundation rows dated before the current fiscal year** (the cross-entity prior-year refusal is certain), with the sentence in the guide and release note. A **closed-session** Foundation row keeps an enabled Move (it opens the checklist). | A disabled "Move" plus a sentence on every historic Foundation gift on a prior-year register is noise. **Real risk to raise with the treasurer (Open Question 3):** a June gift discovered at the July reconciliation is already "prior fiscal year" in July, so the very case that prompted this can fall into the refusal around the year turn. |
| X11 | Phase 2 filed DECISION-112 only. | I also file **DECISION-113** (implementation shape: evaluator split, throw-to-rollback, separate UPDATE shapes, per-destination preview, where the new modules live). | Charter: non-trivial implementation decisions get a number; precedent is DECISION-111 beside 109/110. |
| X12 | Backlog: file B-next-A..E as B-104..B-108. | **B-next-A is B-98 itself (re-aimed in place).** B-next-B..E file as **B-104..B-107**; B-108 stays unassigned. B-107 (duplicate candidates) is filed as the **residual** of the in-scope advisory (bundled deposits). | A would otherwise be a duplicate of B-98. E is in scope for v1 (below), so its backlog item is what remains after it ships. |
| X13 | R7 Gap 9: Phase 3 reads the Foundation income readers and states the effect. | Done: `getOverview()` (`ledger-queries.ts` ~3114) feeds `grossReceiptsCents()` **every posted income row of the entity, including a sweep's transfer-in leg**; fund summaries, the 990 determination and entity totals read by row entity and fund. The dialog states it in one static `reports_change` line (below). | Verified in code, not assumed. Money follows the row; no reader joins acknowledgments for totals. |

No Phase 1/2 ruling is reversed. R1 (issuer id, not a snapshot), R2 (one new cell, T3 holds, Flow 2 denied as its own branch), R3 (policy before bank before tier; `destBankAccountId` codes; two UPDATE shapes), R4 (v2, parser, dual-entity reader) and the Open Question 1 default (no board minute on the move) are adopted as written.

### Permissions

No new key, no role-binding migration. Gates stay in the route body (`auth()` + `hasFeature()`), unchanged: 401, then `LEDGER_RECORD` 403 on both verbs, `LEDGER_MANAGE` resolved once as a boolean. What is new is only **when manage is needed**: `requiredMoveTier(row, now, { crossEntity })` returns `manage` with reason `cross_entity` for every cross-entity move, derived server-side from (row, destination) on the locked row. Same-entity tiering is unchanged. `ledger.manage` is bound to `admin` only (migration 0045); describe it as a permission, **never a second approver**. The treasurer holds it only if the treasurer is also an `admin` (see handoff: the self-sufficiency audit's NEW-4 finds a successor on the `treasurer` role alone lacks it, and this feature then shows them a disabled Move with the permission message).

Precedence on a refusal (a denied move never says "needs Manage"): row-state block, stale, policy, cross-entity state, tier, input.

### Data model: schema.ts first, then migration `0109`

**`src/lib/db/schema.ts`** (database-admin edits this first), in `ledgerAcknowledgments`, after `donorId`:

```ts
// WHO ISSUED this receipt (the donee named on the letter). Nullable FK, no cascade (an entity with receipts
// must not be deletable), no index (table is tiny; readers join per row). WRITE-ONCE: set by exactly three
// writers (acknowledge POST at creation = the transaction's entity; the 0109 backfill, NULL rows only; the
// cross-entity move, COALESCE(existing, source entity) before the row's entity changes). Readers that DESCRIBE
// the receipt follow this column via COALESCE(donee_entity_id, ledger_transactions.entity_id) from
// src/lib/ledger-ack-donee.ts; readers that SUM MONEY follow the transaction. DECISION-112.
doneeEntityId: uuid("donee_entity_id").references(() => ledgerEntities.id),
```

`LedgerAcknowledgment` / `NewLedgerAcknowledgment` gain `doneeEntityId: string | null`; any test fixture typed as one will fail `tsc` until updated (database-admin fixes them in the same step; `ledger-acknowledgment-letter.test.ts` and the acknowledge route test are the likely ones).

**`drizzle/migrations/0109_ledger_ack_donee_entity.sql`** (number re-derived at Phase 4 start: `ls drizzle/migrations/*.sql | sort | tail -3`; the highest today is 0108; a parallel increment may claim 0109). Idempotent on every deploy:

```sql
-- Migration 0109: ledger_acknowledgments.donee_entity_id (DECISION-112)
ALTER TABLE ledger_acknowledgments ADD COLUMN IF NOT EXISTS donee_entity_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk'
       AND conrelid = 'ledger_acknowledgments'::regclass
  ) THEN
    ALTER TABLE ledger_acknowledgments
      ADD CONSTRAINT ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk
      FOREIGN KEY (donee_entity_id) REFERENCES ledger_entities(id);
  END IF;
END $$;

-- NULL rows only; never touches updated_at (a backfill is not an edit).
UPDATE ledger_acknowledgments a
   SET donee_entity_id = t.entity_id
  FROM ledger_transactions t
 WHERE a.donee_entity_id IS NULL
   AND t.id = a.donation_txn_id;
```

- The constraint name is exactly what drizzle-kit derives (60 characters, under Postgres's 63), so `drizzle-kit push --force` finds nothing to "fix". Inline `ADD COLUMN ... REFERENCES` (the precedent in 0072) would create `..._donee_entity_id_fkey` and make push churn it; the guarded block avoids that.
- **Replay safety is structural, not procedural.** The backfill only ever sees NULL. After any cross-entity move the kept acknowledgment is non-NULL (the move stamps it), an unsent one is gone, and acknowledgments created by new code are stamped at creation. The only NULLs a replay can meet are rows written by old code in the build-to-deploy window, whose transaction cannot have moved (old code cannot move across entities). A migration that raced a move in flight is also safe: the move holds the acknowledgment row lock, so the backfill's re-checked `WHERE donee_entity_id IS NULL` skips the freshly stamped row.
- No `SET NOT NULL` now (B-106 tightens it after one release). No index. No other table changes.
- database-admin verifies by running the migration twice in a row on the dev database and by `pnpm db:push` reporting no diff for this column.

### Shared issuer fragment and the reader-by-reader table

**New module `src/lib/ledger-ack-donee.ts`** (imports `drizzle-orm` and the schema only; no DB handle):

```ts
export const ackDoneeEntityId = sql<string>`coalesce(${ledgerAcknowledgments.doneeEntityId}, ${ledgerTransactions.entityId})`;
export function ackIssuedElsewhere(doneeEntityId: string | null, rowEntityId: string): boolean; // pure
```

The header comment carries the rule and the table below, so the next reader finds one definition instead of copying the COALESCE (CLAUDE.md duplication rule: five readers, one fragment).

| Reader | File | Follows | Change |
|---|---|---|---|
| `listGeneratableAcknowledgments` (letter composition, email claim) | `ledger-acknowledgment-letter-queries.ts` ~125 | **Receipt** | `innerJoin(ledgerEntities, eq(ledgerEntities.id, ackDoneeEntityId))` instead of joining on the transaction's entity. A sent acknowledgment is refused before composition anyway (DECISION-073); this only guarantees any future unsent one composes as its issuer. No new reprint path. |
| `listAcknowledgmentsSummary` (donors page sent/pending, register map) | `ledger-queries.ts` ~5219 | **Receipt** | Same join. `entityName` = issuer's name (X6); add `doneeEntityId`, `rowEntityName` (the row's entity, for "booked in ..."), and `sentAt` is already there. `fundName` stays the row's fund. |
| `getAcknowledgment().entity` | `ledger-queries.ts` ~5282 | **Receipt** | Same join; `txn.entityName` stays the row's. |
| Register ack map (Club and Foundation registers) | `[fundSlug]/page.tsx` | **Receipt** | Call `listAcknowledgmentsSummary` for **every** entity when `canRecord` (drop the `isFoundationEntity` gate on the *load*; the donor/ack **controls** stay Foundation-only). Render a read-only note where `ackIssuedElsewhere(...)`. |
| `getDonor` giving history | `ledger-queries.ts` ~4953 | **Row** for entity/fund names | Unchanged now. Optional "Receipt issued by ..." badge is B-106 (suggestion level). |
| `listPendingAcknowledgments`, `listUnlinkedGifts` | `ledger-queries.ts` ~5075, ~5163 | **Row** | **Unchanged on purpose.** The `donationsDeductible` gate on the transaction's entity is correct: a Club row is not "a gift needing a receipt", and a moved row drops out of the pending queue. A test pins that they still join the transaction's entity. |
| Acknowledgment create / PATCH gate | `acknowledge/route.ts` | **Row** | Create stays refused on a non-deductible entity. **Create now stamps `doneeEntityId: txn.entityId`** (the one added key in the insert). PATCH purpose / mark-sent / letter generation / email claim / revert / letter upload are **not** changed and must not set the column. |
| Compliance, 990 determination, `getOverview()` totals, entity gross receipts, impact reporting | `ledger-queries.ts`, `impact-stats-queries.ts` | **Row** | Unchanged. They sum posted rows by entity; money follows the row. |

Write sites of `ledger_acknowledgments` (grep-verified: ten existing sites in four files, plus the new move): acknowledge POST insert; acknowledge PATCH purpose; PATCH mark-sent; letter generation (`.set({ letterText })`); the email claim; the email-claim revert; letter file upload; the transaction PATCH's donor-link sync (two sites in `transactions/[id]/route.ts`, `.set({ donorId })`); the DELETE route's removal of an unsent acknowledgment; and the move (new). Only the insert and the move write `doneeEntityId`; a test per other `.set({...})` pins its key set (below).

### Policy: the decision tree rewrite (`ledger-fund-move-policy.ts`)

New code `club_to_foundation_not_supported` in `FundMoveDenialCode`. Evaluation order (replaces the early `cross_entity` return):

1. same fund: `same_fund` (409, unchanged).
2. **entities differ:**
   - flow is not `income`: `cross_entity` (unchanged; "An entry can only be moved between funds of the same entity.");
   - `charitable` to `activity`: **allowed (new)**;
   - `charitable` to `administrative`: `away_from_public`, reason **"Public money cannot be moved into the Administrative Fund."** (no "Activity Fund's income must stay publicly-sourced" clause, which is false here);
   - `activity` or `administrative` to `charitable`: **`club_to_foundation_not_supported`**, reason **"A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register."**;
   - anything else: `cross_entity`.
3. unknown flow (same entity): `not_permitted` (unchanged).
4. same entity, income: `administrative` to `activity` allowed (v1); `activity` to `administrative` `away_from_public`; else `not_permitted`. Same entity, expense: unchanged.

The new allowed cell is keyed on `kind` **and** "entities differ", so same-entity `charitable` to `activity` income stays `not_permitted`. Status mapping unchanged: `same_fund` 409, every other code 403. Update the cross-reference comment blocks in **both** policy files (`ledger-transfer-policy.ts` is comment-only): the move allows `charitable -> activity` across entities as a reclassification of provenance while the transfer policy denies it as a movement of value (one-way valve); the sweep's own cell is denied here.

**Required test changes (`ledger-fund-move-policy.test.ts`):**
- **T1** becomes "exactly these two cells", enumerated: (income, administrative to activity, same entity) and (income, charitable to activity, different entity); the count is asserted and both are named.
- **T2 code-set** adds `club_to_foundation_not_supported`; the test "a different entity is cross_entity, even for the otherwise-allowed pair" is **rewritten** (its `activity -> charitable` example now returns the new code; keep an expense cross-entity example and an unknown-kind cross-entity example for `cross_entity`); add the `charitable -> administrative` cross-entity `away_from_public` case and assert its reason lacks the Activity-Fund clause.
- **T3** (cartesian mutual exclusion) runs **unchanged and must stay green**.
- **Second pinned divergence:** `charitable -> activity`, different entity, income: `checkFundMove` allowed, `checkTransferDirection` denied.
- **Never-allows-the-sweep-cell:** over the cartesian, for every pair where `checkTransferDirection(...)` is `{ allowed: true, mode: "sweep" }`, `checkFundMove` is denied; and `activity -> charitable` cross-entity income is denied with exactly `club_to_foundation_not_supported`.
- **Same-entity `charitable -> activity` income is denied** (`not_permitted`).

### Lock and tier module (`ledger-transaction-lock.ts`, pure)

```ts
export type MoveTierReason = "reconciled" | "prior_fiscal_year" | "cross_entity";
export function requiredMoveTier(row, now: Date, opts?: { crossEntity?: boolean }):
  { tier: "record" | "manage"; reasons: MoveTierReason[] };      // crossEntity => manage + "cross_entity" (plus any of the other two that apply)
export type CrossEntityStateBlock =
  "prior_fiscal_year_cross_entity" | "reconciled_session" | "reconciled_legacy" | "matched_open_session";
export function crossEntityBlockKind(row, now: Date):            // PURE part only (X2 order): the first of the first three that applies, else null
  Exclude<CrossEntityStateBlock, "matched_open_session"> | null;
```

`matched_open_session` needs the database and is evaluated by `evaluateDestination()` (below) after the pure three. The user-facing text for the four codes lives in `ledger-correction.ts` as an exhaustive `CROSS_ENTITY_STATE_COPY: Record<CrossEntityStateBlock, { message: string; nextStep: string }>` (a new code is a compile error), not in `LOCK_COPY`, so the register's lock labels are not affected. Existing `LOCK_COPY` and `classifyTransactionLock` are untouched.

### Guard pipeline (nine steps), GET and POST

One evaluator shape, split on what depends on the destination. `evaluateRowState(row)` (pure, destination-independent) and `evaluateDestination(exec, args)` (async: takes `db` or `tx` so the match check reads on the transaction handle after the lock). The preview loops `evaluateDestination` over every destination; POST calls it once on the locked row. Parity is structural.

| # | Check | Refusal (status, code) | GET (unlocked row) | POST (locked row) |
|---|---|---|---|---|
| 0 | `auth()`; `LEDGER_RECORD`; `isUuid(id)`; body parse: exact key set, ids are UUID-shaped strings, `destBankAccountId` is `string | null | absent` | 401; 403; 404 `not_found`; 400 `invalid_body` | gate + uuid only | all; **no DB read before this passes** |
| 1 | row exists; row-state block | 404 `not_found`; 403 `approved`, `rejected`, `pending`, `dues_synced`, `transfer_leg` | **top-level 4xx** (destination-independent) | same, on the locked row |
| 2 | `expectedFundId === row.fundId` | 409 `stale` | skipped | yes; **ahead of the policy** so a double-click answers `stale`, never `same_fund` or `club_to_foundation_not_supported` |
| 3 | destination fund exists **and is active** | 404 `fund_not_found` | by construction (loops active funds of every entity, minus the source) | yes |
| 4 | direction policy `checkFundMove()` | 409 `same_fund`; 403 `cross_entity`, `expense_not_supported`, `away_from_public`, `not_permitted`, `club_to_foundation_not_supported` | per-destination `denial` | yes |
| 5 | cross-entity state, only when the policy allowed a cross-entity pair: pure `crossEntityBlockKind()`, then the open-session match read on the handle | 403 `prior_fiscal_year_cross_entity`, `reconciled_session`, `reconciled_legacy`, `matched_open_session` | per-destination `denial` (+ `unlock` for the last two) | yes |
| 6 | tier: `requiredMoveTier(row, now, { crossEntity })` vs `callerCanManage` | 403 `manage_required` (cross-entity wording differs, below) | **per-destination `denial`, HTTP 200** | yes |
| 7 | input: (a) `destBankAccountId`; (b) same-entity stored-account assertion; (c) category | (a) 400 `dest_bank_account_required` / `dest_bank_account_invalid` / `dest_bank_account_not_allowed`; (b) 409 `bank_account_entity_mismatch`; (c) 404 `category_not_found`, 400 `category_invalid` | only the **preview-only** `dest_no_active_bank_account` denial (no valid input exists) and (b) as a per-destination denial for same-entity as today | yes, in this order |
| 8 | acknowledgment settlement (cross-entity only): lock, then stamp (sent) or delete (unsent) | throws on failure | not run | yes (X1) |
| 9 | pinned UPDATE; then the audit row (always last, same `tx`) | zero rows: rollback sentinel, mapped to 409 `stale` | not run | yes |

**(7a) in detail**, evaluated on the *destination fund's* entity, never the client's:
- cross-entity and absent/null: `400 dest_bank_account_required` ("Pick the Club bank account the money landed in.");
- cross-entity and a malformed id, missing, inactive, or owned by another entity: `400 dest_bank_account_invalid` (message from `validateBankAccountForEntity`: "Select a valid bank account." / "Bank account not found." / "Bank account does not belong to this entity." / "Bank account is inactive. Select an active account.");
- **same-entity and any non-null value (even "")**: `400 dest_bank_account_not_allowed` ("A bank account cannot be changed when moving within one entity."). Its own code so a smuggling attempt is distinguishable in logs and tests.

**Per-destination tiering and the GET contract change (REQUIRED by R3.4).** A whole-response 403 `manage_required` cannot say "this destination needs Manage, that one does not". The preview now returns **200** with `allowed: false, denial: { code: "manage_required", ... }` for tier refusals, so a record-only caller on a reconciled **same-entity** row now gets 200 with every destination denied (it was a top-level 403 in v1.86.0). Destination-independent row-state blocks stay top-level 4xx. The parity statement becomes: **every destination GET lists as allowed passes steps 1 to 6 in POST; every denial GET lists carries the code and the status POST would return; step 7 refusals are POST-only except `dest_no_active_bank_account`, which is GET-only.**

Cross-entity tier message (`CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE`): "Moving an entry to the other entity needs the Manage Ledger permission (held by the Admin role)." The existing same-entity `MANAGE_REQUIRED_MESSAGE` is unchanged.

### API contract

`ledger-correction.ts` (client-safe, no DB import) owns every type. **Frozen when api-developer reports the contract final; ux-developer imports, never redeclares.**

```ts
export type MoveTierReason = "reconciled" | "prior_fiscal_year" | "cross_entity";

export interface FundBal { name: string; beforeCents: number; afterCents: number }   // all-time posted balances, computed with fundBalanceCents()
export interface MoveEntityRef { id: string; slug: string; name: string }       // name = shortName ?? name ("Foundation", "Club")
export interface MoveBankOption { id: string; name: string; beforeCents: number; afterCents: number }   // destination book balance (all-time posted)
export interface MoveDuplicateCandidate {
  id: string; txnDate: string; party: string | null; amountCents: number;
  fundName: string; bankAccountName: string | null; matched: boolean; reconciled: boolean }

export interface MoveUnlock {
  kind: "closed_session" | "matched_open_session" | "legacy_reconciled";
  session: { id: string; bankAccountName: string; periodStart: string; periodEnd: string; status: "open" | "closed" } | null;
  laterClosedSessions: Array<{ id: string; periodStart: string; periodEnd: string }>;  // newest first; reopen these before `session`
  otherMatchesOnLine: number;          // matched_open_session only: other entries matched to the same bank line (a batch)
  statementMonth: string | null;       // "YYYY-MM": first month whose member statement can be hidden while the session is open
  statementAlreadySent: boolean;       // a corrected resend will be offered
}

export type MoveDestinationDenialCode =
  | FundMoveDenialCode | "manage_required" | CrossEntityStateBlock
  | "bank_account_entity_mismatch" | "dest_no_active_bank_account";             // last one is GET-only

export interface MoveDestination {
  fundId: string; name: string; kind: string;
  entity: MoveEntityRef; crossEntity: boolean;
  tier: { required: "record" | "manage"; reasons: MoveTierReason[] };
  allowed: boolean;
  denial?: { code: MoveDestinationDenialCode; status: 403 | 409; reason: string; unlock?: MoveUnlock };
  // present only when allowed:
  categories?: Array<{ id: string; name: string }>;     // active; destination entity + fund kind + row's flow
  defaultCategoryId?: string | null;                    // "Public donations" when present
  bankAccounts?: MoveBankOption[];                      // cross-entity only: ACTIVE accounts of the destination entity, name-ordered
  defaultBankAccountId?: string | null;                 // set ONLY when exactly one active account (a wrong guess silently breaks the next reconciliation)
  impact?:
    | { crossEntity: false; sourceFund: FundBal; destFund: FundBal; bankAccount: { name: string | null; changeCents: 0 } }
    | { crossEntity: true;  sourceFund: FundBal; destFund: FundBal;
        sourceBankAccount: { name: string; beforeCents: number; afterCents: number } | null };
  duplicateCandidates?: MoveDuplicateCandidate[];       // cross-entity only, cap 5
  warnings?: Array<{ code: MoveWarningCode; message: string }>;   // server-composed; render as given
}

export type MoveWarningCode =
  | "ratchet" | "reconciled" | "prior_fiscal_year" | "sent_statement" | "dest_sent_statement" | "aged_public_fund"
  | "sweep_not_automatic" | "receipt_sent" | "unsent_receipt_removed" | "duplicate_candidate"
  | "reconciliation_pending" | "reports_change";

export interface MovePreview {
  transaction: { /* v1.86.0 fields, plus: */ entity: MoveEntityRef; donorId: string | null;
                 receipt: "none" | "unsent" | "sent" };
  callerCanManage: boolean;
  destinations: MoveDestination[];       // every OTHER ACTIVE fund of EVERY entity, each decided by the pipeline above
  reasonLimits: { min: number; max: number };
}
// top-level `tier` and `warnings` (v1.86.0) are REMOVED (X3)

export interface MoveInput { destFundId: string; categoryId: string | null; reason: string; expectedFundId: string;
                             destBankAccountId: string | null }     // absent on the wire is normalized to null by parseMoveBody
export interface MoveResponse { id; fundId; fundSlug; fundName; categoryId; categoryName; sweepSuggested: boolean;
                                entitySlug: string; crossEntity: boolean;
                                acknowledgment: "none" | "kept" | "removed" }
```

`MoveErrorCode` gains: `club_to_foundation_not_supported`, `prior_fiscal_year_cross_entity`, `reconciled_session`, `reconciled_legacy`, `matched_open_session`, `dest_bank_account_required`, `dest_bank_account_invalid`, `dest_bank_account_not_allowed`.

**POST body.** Exactly: `destFundId`, `categoryId`, `reason`, `expectedFundId` (all required) plus **optional** `destBankAccountId`. Any other key is 400. Wrong type (not a string, null or absent) is 400 `invalid_body`; UUID shape of `destBankAccountId` is **not** checked at parse (a malformed id means `dest_bank_account_invalid` cross-entity and `dest_bank_account_not_allowed` same-entity, and both need the destination, which needs the DB).

**Status map (route).** 400 `invalid_body | category_invalid | dest_bank_account_required | dest_bank_account_invalid | dest_bank_account_not_allowed`; 401; 403 `approved | rejected | pending | transfer_leg | dues_synced | manage_required | cross_entity | expense_not_supported | away_from_public | not_permitted | club_to_foundation_not_supported | prior_fiscal_year_cross_entity | reconciled_session | reconciled_legacy | matched_open_session`; 404 `not_found | fund_not_found | category_not_found`; 409 `stale | same_fund | bank_account_entity_mismatch`; 500 "Could not move this entry. Nothing was changed." Dialog behavior is unchanged in kind: 400 inline; 403/404/409 toast, close, refresh; 5xx/network toast and stay open.

`CROSS_ENTITY_STATE_COPY` (message / nextStep), exact:
- `prior_fiscal_year_cross_entity`: "This entry is dated in an earlier fiscal year. Moving it to the other entity would restate both entities' totals for a closed year, which is not supported." / "Record a correcting entry on each entity's books instead, or ask a developer."
- `reconciled_session`: "This entry was cleared by a closed reconciliation session. A move changes its bank account, so the session has to be reopened first." / "Reopen the session, unmatch this entry, then move it."
- `reconciled_legacy`: "This entry is marked reconciled. A move changes its bank account." / "Un-mark it as reconciled first."
- `matched_open_session`: "This entry is matched to a bank line in a reconciliation session." / "Unmatch it in the session first."

### The move transaction body (`executeFundMove`, `ledger-fund-move-queries.ts`)

Inside one `db.transaction(async (tx) => ...)`; the **first statement is the row lock** (unchanged). Order, with the throw-to-rollback rule from X1:

1. `SELECT ... FROM ledger_transactions WHERE id = $1 FOR UPDATE` (as today; `T13` shape unchanged).
2. `evaluateRowState(locked)`; `expectedFundId` stale check (steps 1 and 2).
3. Load the destination fund (inactive or missing: 404 `fund_not_found`) and the source fund; `evaluateDestination(tx, ...)`: policy (4), cross-entity state with the match read **on `tx`** (5), tier (6). The match read is `SELECT ... FROM ledger_reconciliation_matches WHERE transaction_id = $1` on the transaction handle (a new `tx`-accepting reader in the preview module; the shipped `getMatchForTransaction()` takes no handle and is left alone).
4. Input (7): `destBankAccountId` per the three 400 codes using `validateBankAccountForEntity(tx, id, dest.entityId, { requireActive: true })` (it now also returns the account **name** for the audit payload); same-entity stored-account assertion (unchanged); `validateCategoryForFund()` (the existing shared helper; no new copy).
5. Read-only context for the audit payload: category names, the source and destination bank account names, `findSentStatementMonth()` **per entity** (source entity with `source.kind`, destination entity with `dest.kind`; the helper returns null for a non-member-exposed kind, so Activity yields null with no query).
6. **Acknowledgment settlement (cross-entity only; step 8)** via `settleAcknowledgmentForMove(tx, { transactionId, sourceEntityId: locked.entityId })` in `ledger-fund-move-ack.ts`:
   - `SELECT id, sent_at, donee_entity_id FROM ledger_acknowledgments WHERE donation_txn_id = $1 FOR UPDATE`;
   - pure `decideAckOutcome({ exists, sent })` returns `none | kept | removed`;
   - **`kept` (sent):** `UPDATE ledger_acknowledgments SET donee_entity_id = coalesce(donee_entity_id, $sourceEntityId), updated_at = now WHERE id = $ack AND sent_at IS NOT NULL`. The `.set({...})` key set is exactly `["doneeEntityId", "updatedAt"]`. `sent_at`, `sent_via`, `letter_text`, `letter_storage_key`, `donor_id`, `purpose`, `type` and the amount are **never** in a set object. A pre-existing stamp is preserved by the COALESCE (write-once);
   - **`removed` (unsent):** `DELETE FROM ledger_acknowledgments WHERE id = $ack AND sent_at IS NULL RETURNING id` (the DECISION-108 pin). Because the acknowledgment row is already locked, zero rows can only mean the status changed under us; re-read once and treat as `kept`;
   - a concurrent email claim either committed before our lock (we see `sent_at` and keep) or blocks behind it and then finds no row (its claim UPDATE is pinned on `sent_at IS NULL` and returns nothing);
   - returns `{ outcome, ack: { id, sentAt, doneeEntityId } | null }` for the audit.
   - Same-entity moves **skip this step entirely** (a Club row never carries an acknowledgment), so the v1.86.0 path stays byte-identical and never selects `ledger_acknowledgments`.
7. **Pinned UPDATE (step 9)**, built by one of two separate exported builders (`buildSameEntityMoveSet`, `buildCrossEntityMoveSet`) so the key sets are individually testable:
   - same-entity `.set`: exactly `fundId, categoryId, budgetLineId: null, updatedAt` (today's object; it can never contain `bankAccountId` or `entityId`); where: `id AND fund_id = locked.fundId` (unchanged);
   - cross-entity `.set`: exactly `entityId` (= `dest.entityId` from the destination **fund row**, never the client), `fundId`, `bankAccountId` (the validated destination account), `categoryId`, `budgetLineId: null`, `updatedAt`; where: `id AND fund_id = locked.fundId AND entity_id = locked.entityId AND reconciled = false AND reconciled_session_id IS NULL RETURNING id`.
   - Zero rows returned: `throw new StaleMoveRollback()`. `executeFundMove()` wraps `db.transaction` in a `try/catch` that maps only that sentinel to `fail(409, "stale", STALE_MOVE_MESSAGE)` and rethrows anything else (so the route still answers 500 for a real failure).
8. `recordLedgerAudit(tx, ...)` last, on the same `tx` (v1 payload for same-entity, **v2** for cross-entity; below). A throw rolls everything back.
9. Return `MoveResponse` (adds `entitySlug`, `crossEntity`, `acknowledgment`).

Carried untouched on a cross-entity move (not in the `.set`): `txn_date`, `amount_cents`, `flow`, `party`, `memo`, `payment_method`, `check_number`, `donor_id`, `status`, `recorded_by_user_id`, `created_at`, receipt fields, `public_note`, `beneficiary_cause`, `reconciled*` (both false/null by precondition), `transfer_group_id` and `dues_payment_id` (null by precondition). The mover is in the audit row; the recorder is not overwritten.

### Audit payload v2, the parser, and the dual-entity reader

Same-entity moves keep writing **v1 unchanged** (R4). Cross-entity moves write **v2**:

```ts
interface EntityRefSnapshot { id: string; name: string; slug: string }          // name = display name (shortName ?? name)
interface BankRefSnapshot { id: string; name: string }
interface FundMoveAuditPayloadV2 {
  before: { v: 2; entity: EntityRefSnapshot; fund: FundRefSnapshot; bankAccount: BankRefSnapshot | null;
            category: CategoryRefSnapshot | null; budgetLineId: string | null };
  after:  { v: 2; entity: EntityRefSnapshot; fund: FundRefSnapshot; bankAccount: BankRefSnapshot;
            category: CategoryRefSnapshot | null; budgetLineId: null };
  details: { v: 2; reason: string;
             entityId: string;            // SOURCE entity: a reader that only knows v1 still lists the move under the source
             destEntityId: string; crossEntity: true;
             txnDate: string; flow: "income" | "expense"; amountCents: number; fiscalYear: number;
             tier: "manage"; reconciled: boolean /* false by precondition */; reconciledSessionId: string | null; priorFiscalYear: boolean;
             sentStatementMonth: string | null; destSentStatementMonth: string | null;
             donorId: string | null;
             acknowledgment: { id: string | null; sent: boolean; sentAt: string | null;
                               outcome: "none" | "kept" | "removed"; doneeEntityId: string | null } };
}
export type FundMoveAuditPayload = FundMoveAuditPayloadV1 | FundMoveAuditPayloadV2;     // discriminated on details.v
```

- **Parser (REQUIRED change).** `parseVersioned(text, allowedVersions)` replaces the `v === 1`-only check. `parseAuditDetails`/`parseAuditBefore`/`parseAuditAfter` for the **moved** action accept 1 and 2, each field validated by a per-version guard: v1 as today; v2 `details` needs string `reason`, string `entityId`, string `destEntityId`, an `acknowledgment` object; v2 `before`/`after` need `entity`, `fund` and (after) `bankAccount`. The **deleted** action accepts only v1 (a v2 delete is `{ raw }`). Anything failing a guard degrades to `{ raw }`; nothing throws; nothing is hidden. Return types become the V1|V2 unions and the reader narrows on `.v`.
- **Reader.** `getRecentLedgerCorrections()` keeps its bounded SQL and in-JavaScript filter and now keeps a moved row when `args.entityId === details.entityId || args.entityId === details.destEntityId` (v2) or `=== details.entityId` (v1). **Never** cast `details` to jsonb in SQL (DECISION-111 item 6). `LedgerCorrectionRow` gains `crossEntity: boolean`, `fromEntityName`, `toEntityName`, `fromBankAccount`, `toBankAccount` (all `string | null`, names from the self-describing payload, no joins) and `receiptSent: boolean` (`details.acknowledgment.sent && outcome === "kept"`). A malformed or v1 row is listed; v1 rows have `crossEntity: false` and null names. Reason text now shows on **both** entities' compliance pages to `LEDGER_VIEW` holders (intended board visibility, as for delete pairs).
- **Latest-move reader for the sweep memo:** `getLatestFundMove(transactionId): Promise<{ createdAt: Date; sourceLabel: string } | null>` in `ledger-audit.ts` (`WHERE action = 'transaction_fund_moved' AND target_transaction_id = $1 ORDER BY created_at DESC LIMIT 1`, using `ix_ledger_audit_log_transaction`). `sourceLabel` is `"the " + before.entity.name` for v2 and `before.fund.name` minus a trailing " Fund" for v1; null when the row is raw or absent.
- The member-surface import guard (T33) keeps protecting `ledger-audit.ts` and `ledger-correction.ts`; the three new modules never import audit text.

### Preview module (`src/lib/ledger-fund-move-preview.ts`, server-only, DB-importing, read-only)

Keeps `ledger-fund-move-queries.ts` under ~800 lines. Exports (all take `SelectExec = Pick<typeof db, "select">`):

- `listMoveRegisterContext(): Promise<{ funds: Array<{ id; entityId; kind }>; entityIdsWithActiveBank: string[] }>`: two small queries for the register's Move-button eligibility.
- `accountBookBalance(exec, bankAccountId)`: `openingBalanceCents` plus the signed sum of posted rows, computed with the canonical `fundBalanceCents(opening, rows)` (no new sign logic; same shape as the fund balances).
- `listActiveBankOptions(exec, entityId, row)`: the `MoveBankOption[]` with before/after for an income row (+amount) and `defaultBankAccountId` only when exactly one.
- `findDuplicateCandidates(exec, args)`: posted income rows in the **destination entity** (any fund, any account), `amount_cents = row.amount`, `txn_date` within **30 days** of the row's date, excluding the row itself and transfer legs, newest first, **cap 5**, each with `matched` (left join on `ledger_reconciliation_matches`, unique per transaction so no fan-out) and `reconciled` flags. Advisory only. It cannot see a bundled deposit; the guide says so (B-107).
- `buildMoveUnlock(exec, row, kind)`: closed session by `row.reconciledSessionId` (period, account name), `listLaterClosedSessionsForAccount()` newest first, `statementMonth = session.periodEnd.slice(0, 7)`, `statementAlreadySent` via `findSentStatementMonth()`; for `matched_open_session` the session of the match and `otherMatchesOnLine`; for legacy no session. Computed **once per request** and reused across destinations.
- `loadOpenMatch(exec, transactionId)`: the match read on a handle (used by POST on `tx`).

`reconciliation-queries.ts` gains `listLaterClosedSessionsForAccount(bankAccountId, periodEnd)` (closed sessions with a later `statement_period_end`, ordered newest first); `getLaterClosedSessionForAccount` is not modified (X8).

Query cost: the preview issues a handful of small reads per **allowed** destination (categories, two fund-balance reads, account balances, duplicates, unlock) and the register context is two queries. At most one cross-entity destination is allowed in v1, so this is bounded; no N+1 over rows.

### Warning copy (server-composed in `ledger-correction.ts`; one place so the dialog, tests, guide and release note agree)

`buildMoveWarnings()` now takes the destination (`crossEntity`, receipt state, per-entity statement months and labels, duplicate count, aged) and the existing same-entity output is **byte-identical** (a test pins it). `sentStatementWarning(ym, label = "Administrative")` gains the label (the shipped sentence hard-codes "Administrative"; the Foundation's statement must say "Foundation").

Cross-entity set, in this order when applicable:
- `ratchet`: with a **sent** receipt: "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep, and because a receipt has already gone to the donor, this entry can no longer be deleted; correcting it later means a refund entry." Without one: "This cannot be moved back. The Club's Activity Fund can only send money to the Foundation through a minuted sweep. If you move the wrong entry, delete it and enter the gift on the correct register."
- `receipt_sent`: "A receipt letter was already sent for this gift. It stays attached to the gift and still names the Foundation as the issuer. The ledger does not change what the donor was told; confirm with whoever advises the club on tax matters that the receipt is still the right document before you move a receipted gift."
- `unsent_receipt_removed`: "A receipt record exists for this gift but was never sent. A Club entry cannot hold one, so it is removed with the move. Nothing was sent to the donor."
- `sent_statement` (source entity): "The Foundation statement for {Month YYYY} was already sent to the board. After this move it will show as changed and you will be offered a corrected resend. Nothing is sent automatically." and `dest_sent_statement` for the destination entity with the same shape (null for Activity, a test pins both).
- `duplicate_candidate`: "The Club already has {n} posted income entr{y|ies} of this amount within 30 days. If this deposit was already recorded on the Club side, moving this gift would count it twice. A deposit bundled with other money cannot be detected here."
- `aged_public_fund` (existing text).
- `reports_change` (Gap 9, verified): "Reported income moves with the gift: it leaves the Foundation's totals for {fiscal year label} and joins the Club's. When you later record the sweep, the Foundation's totals count that transfer-in as income too, as they do for every sweep."
- `reconciliation_pending`: "This entry is not reconciled on the Club side until you match it to the deposit line in the Club's reconciliation session."
- `sweep_not_automatic`: "Moving does not sweep anything. The cash is already in the Club's bank account; record the sweep once the money has actually been moved." (Account-agnostic on purpose, so the server text never depends on the account the treasurer has not picked yet. The same-entity text is unchanged.)

The `reconciled`, `prior_fiscal_year` warnings apply to same-entity moves only (a cross-entity row with either is refused). The "Bank account balance unchanged" line must **not** render on a cross-entity move; the impact panel shows both accounts' before and after instead.

### Dialog changes (`MoveTransactionDialog` and two sub-components)

States are unchanged in kind (loading, load error, blocked, form, submitting, success) and the presentational-body-plus-pure-helpers pattern stays (no new test dependency). The cross-entity panel and the checklist are **sub-components**, not more branches in one file.

- **Destination select** lists every `allowed` destination grouped by entity (`<optgroup label={entity.name}>`). Denied destinations are listed as text under the select with their server reason and entity name, never hidden. A **Club Administrative income row lists the Foundation's Charitable fund as denied** carrying the `club_to_foundation_not_supported` sentence (the mirror: "A Club entry cannot be moved onto the Foundation's books. If the money is in the Foundation's bank account, delete this entry and enter the gift on the Foundation's register."). A Foundation row lists Club Administrative as denied with "Public money cannot be moved into the Administrative Fund."
- **No allowed destination** no longer always says "No other fund can hold this entry." When any denial is `manage_required` or a state code, the heading is **"This entry can't be moved yet"** and each reason is shown (the old sentence is kept only when every denial is a policy code).
- **Cross-entity form** (new `move-cross-entity-panel.tsx`) appears when the selected destination has `crossEntity: true`:
  - **Destination bank account**: required `<select>` (44px, `text-base sm:text-sm`) of `destination.bankAccounts`, **no default** unless `defaultBankAccountId` is set (exactly one active account); helper text "Pick the account the money actually landed in."
  - **"What will change"** as stacked before/after rows (`grid-cols-1 sm:grid-cols-2`): source fund, destination fund, **source bank account** ("Foundation Checking: $X to $Y") and the **picked destination account** ("Administrative Checking: $X to $Y", shown once picked). Both bank rows are visually prominent (`rounded-2xl bg-gray-50`, the same card as the fund rows).
  - A static **receipt line** from `transaction.receipt`: sent: "The receipt letter already sent for this gift stays attached to it."; unsent: the `unsent_receipt_removed` warning; none: nothing. The donor stays linked.
  - **Duplicate-candidate advisory** under the warnings: up to five rows (date, party, amount, fund/account, "matched" / "reconciled" chips), advisory only, never blocking.
  - The warnings from `destination.warnings` render as given; the `ratchet` notice keeps the gold-bordered "Read before moving" card. **"Bank account balance: unchanged" is not rendered** for a cross-entity destination.
  - Confirm label "Move to {fund name} ({entity name})"; enabled only with a destination, a bank pick and a valid reason. The request body adds `destBankAccountId` (the pick) for cross-entity and `null` for same-entity, so a same-entity request is exactly the old four keys plus `destBankAccountId: null`.
- **Closed-session guided checklist** (new `move-unlock-checklist.tsx`), rendered **instead of** the form when the selected (or only) cross-entity destination's denial carries `unlock`. It guides; it automates nothing. Heading **"Before this can move"**, then, from `unlock`:
  1. Context: "This gift was cleared by the {account} reconciliation session for {Mon D to Mon D, YYYY}. A move changes its bank account, so that session has to be reopened first."
  2. If `laterClosedSessions` is non-empty: "A session cannot be reopened while a later one on the same account is closed. Reopen {period} first, then each earlier one, newest first." with a link per session to `/admin/ledger/reconciliation/{id}`.
  3. A numbered list: **(1)** "Reopen the session (needs Manage Ledger). It un-reconciles every entry the session cleared, and the Foundation's monthly statements from {Month YYYY} onward can be **hidden from members until you close the session again**." plus, when `statementAlreadySent`: "The {Month} statement was already sent; you will be offered a corrected resend." **(2)** "Unmatch this gift from its bank line in the session." plus, when `otherMatchesOnLine > 0`: "That bank line is matched to {n} other entries too; after unmatching this gift, match the line again to the others." **(3)** "Come back and choose Move to the Club."
  4. "After the move, the bank line this gift was matched to is free. Give it its right entry (match it to the right transaction, or create one from the line) before you close the session again; a session cannot close while a statement line is unmatched. The Club-side deposit may be part of a bundled deposit or in another month, so match with care."
  - For `matched_open_session` only step (2) and the after-note appear; for `legacy_reconciled` only "Un-mark it as reconciled first" (the register's existing reconcile toggle).
  - If the caller lacks `LEDGER_MANAGE` the checklist **still renders** (so they can ask an admin) with the line "Reopening needs the Manage Ledger permission, held by the Admin role."
  - The checklist is advisory: the server re-derives the state at move time, so a stale checklist cannot cause a bad move. A "Check again" button re-runs the preview GET.
- **Success step** (cross-entity): "Moved to {fund} ({entity})." plus, by `result.acknowledgment`: kept: "The receipt letter stays attached to the gift and still names the Foundation."; removed: "The unsent receipt record was removed."; plus the sweep note and **Record sweep now** (deep link built from `result.entitySlug`, X7) and **Done** (`router.refresh()` only on Done, as today).
- Per-entity **sent-statement warnings** come from the server (`sent_statement` for the Foundation, `dest_sent_statement`); the dialog renders them, it does not decide.
- 360px: stacked before/after rows, the checklist as a numbered list, the bank select and reason scroll into view and are not hidden by the keyboard (`CorrectionReasonField` already scrolls on focus; add the same to the bank select).

### Register changes, Delete pointer, Treasury guide

- **Move eligibility** (`transaction-move-eligibility.ts`): `moveButtonState({ transaction, funds, entityIdsWithActiveBank, canManage, now })` where `funds` is now **every entity's** funds (from `listMoveRegisterContext()`), so eligibility is `checkFundMove()` over all funds as R5 requires. A cross-entity destination counts only when its entity has an active bank account (Gap 12). Omitted for blocked kinds, expense rows, rows with no allowed destination, and (X10) a **cross-entity-only row dated before the current fiscal year**. Enabled otherwise, including a closed-session Foundation row (the dialog explains). Disabled with a reason only when the **only** allowed destinations need a tier the caller lacks: cross-entity gets `CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE`. A Club Administrative income row keeps its same-entity Move; the Foundation destination is denied and never counts.
- **Foundation register**: the Move button reappears on income rows that qualify; a closed-session row shows the existing lock label plus the short sentence "If the money is in the Club's account, see Move to the Club." (visible text at every width; B-99 is the separate phone-visibility follow-up for the existing lock copy).
- **Club register receipt marker**: new tiny server-safe `receipt-issuer-note.tsx`, "Receipt on file, issued by the Foundation" (+ "sent {date}"), shown in the party cell of any row whose acknowledgment satisfies `ackIssuedElsewhere(...)`. Read-only: no ack controls on a Club row (the create gate stays Foundation-only). `ackStatus` passed to `TransactionActions` now comes from the all-entity map, so a moved row's Delete dialog is the blocked "receipt already sent" state.
- **Delete dialog (static line)**: new prop `foundationPointer: boolean` = `!isFoundationEntity && txn.flow === "income" && !isTransfer`, computed by the register page (no server field, no heuristic, R5). Rendered above the reason field, hidden when the dialog is in the blocked state: "If this gift's money is actually in the Foundation's bank account, delete this entry here and enter the gift on the Foundation's register, in the bank account the money landed in." (X5).
- **Sweep prefill (Gap 10, also closes B-102)**: the page calls `getLatestFundMove(sweepFromTxnId)` and builds the memo with a pure `buildSweepMemo({ party, move })` in `ledger-correction.ts`: "Sweep of {party} gift moved from {sourceLabel} on {YYYY-MM-DD}" with the date taken from the audit row's `createdAt` in `America/New_York` (`en-CA` formatting), "the Foundation" for v2, "Administrative" for v1; with **no audit row** the memo is "Sweep of {party} gift" (no "moved", no date). The board-minute reference is never prefilled.
- **Treasury guide** (`books-register-section.tsx`): rewrite the lead sentence ("Today this moves income from the Administrative Fund to the Activity Fund only" becomes both cells); split the "bank account balance does not change" bullet into same-entity (unchanged) and cross-entity (it **does** change: the entry joins the Club account you pick); add the subsection **"Moving a gift from the Foundation to the Club"** (when to use it: the money is in the Club's account; the donor and the sent receipt stay; why a sent receipt blocks delete; the closed-session checklist and what reopening does to member statements; reconcile the Club deposit afterwards; the sweep afterwards and that the Foundation leg of a sweep gets no acknowledgment; the one-way note; confirm the receipt question with whoever advises the club on tax matters and mention it at the next board meeting; Foundation income totals fall now and the sweep's transfer-in counts later; current fiscal year only; a bundled deposit cannot be detected for the duplicate warning); add the **mirror paragraph** under "Deleting an entry" (the Delete-dialog sentence). No second-approver language; "Moved", never "Reversed" or "Voided".

### Component / page plan

**Create:**
- `src/lib/ledger-ack-donee.ts`, `src/lib/ledger-fund-move-ack.ts`, `src/lib/ledger-fund-move-preview.ts`
- `drizzle/migrations/0109_ledger_ack_donee_entity.sql` (number re-derived)
- `src/components/admin/ledger/move-cross-entity-panel.tsx`, `move-unlock-checklist.tsx`, `receipt-issuer-note.tsx`
- `e2e/ledger-cross-entity-move.spec.ts` (qa)

**Modify (server):** `src/lib/db/schema.ts`; `src/lib/ledger-fund-move-policy.ts`; `src/lib/ledger-transfer-policy.ts` (comment only); `src/lib/ledger-transaction-lock.ts`; `src/lib/ledger-correction.ts`; `src/lib/ledger-transaction-validation.ts` (return the bank account name); `src/lib/ledger-audit.ts`; `src/lib/ledger-fund-move-queries.ts`; `src/lib/reconciliation-queries.ts` (+1 function); `src/lib/ledger-queries.ts` (`listAcknowledgmentsSummary`, `getAcknowledgment`); `src/lib/ledger-acknowledgment-letter-queries.ts` (one join); `src/app/api/admin/ledger/transactions/[id]/acknowledge/route.ts` (stamp at create); `src/app/api/admin/ledger/transactions/[id]/move/route.ts` (docs, body key, status map).

**Modify (UI):** `move-transaction-dialog.tsx`, `correction-dialog-logic.ts`, `transaction-move-eligibility.ts`, `transaction-actions.tsx` (new props `moveFunds`, `entityIdsWithActiveBank`), `delete-transaction-dialog.tsx`, `recent-corrections.tsx`, `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` (register context, all-entity ack load, receipt note, Delete prop, sweep memo), `guide/books-register-section.tsx`.

**Not touched:** `proxy.ts`, `ADMIN_NAVIGATION`, the compliance page (the reader changes carry it), the reconcile/match/reopen routes, the sweep form, `financial-report-*`. No new page, so `admin-page-feature-gates.test.ts` is unaffected. Ship-time (tech-lead, not now): the CLAUDE.md "Ledger corrections" paragraph still says the Foundation-deposit case is "NOT a move"; rewrite it with the release notes.

Next.js 16 note for implementers: `params` is a `Promise` in route handlers and pages here; mirror the existing files and read `node_modules/next/dist/docs/` before touching the register page's data loading.

### Implementation order and specialist split: database-admin, then api-developer, then ux-developer

The feature has new schema, a real API contract and a UI built on it, so the specialist split (CLAUDE.md Phase 4) applies; full-stack-developer would be wrong here.

**1. database-admin** (first; the type everything else imports)
1. `schema.ts` edit (above), then re-derive the migration number and write `0109_*.sql` exactly as designed.
2. Run the migration twice on the dev database (idempotent), run `pnpm db:push` (no diff on the column), `pnpm exec tsc --noEmit` (fix any fixtures typed `LedgerAcknowledgment`).
3. Replay check for the backfill: NULL one acknowledgment on a **non-moved** row, replay, confirm it is re-stamped to its transaction's entity; confirm a stamped row is untouched.
- **Handoff contract:** `ledgerAcknowledgments.doneeEntityId` exists in `schema.ts` (`string | null` on the row types); migration number reported; no other table touched.

**2. api-developer** (each step ships with its tests; steps 1 to 4 are pure or tiny and unblock the UI types)
1. Pure modules: `ledger-fund-move-policy.ts` (tree + comments in both policy files), `ledger-transaction-lock.ts` (tier option, `crossEntityBlockKind`), `ledger-correction.ts` (all types above, codes, copy constants, warnings, v2 payload types, version-aware parser, `buildSweepMemo`), `ledger-ack-donee.ts`.
2. `ledger-transaction-validation.ts` returns the bank account name; `reconciliation-queries.ts` `listLaterClosedSessionsForAccount`.
3. `ledger-fund-move-ack.ts` (pure decision + settlement).
4. `ledger-fund-move-preview.ts`.
5. `ledger-fund-move-queries.ts`: evaluator split, per-destination preview, execute with both UPDATE builders and the throw-to-rollback sentinel, v2 audit write.
6. `move/route.ts` (body key, status map, header comment).
7. `ledger-audit.ts`: reader (either entity, new row fields), `getLatestFundMove`.
8. Receipt issuer: `acknowledge/route.ts` stamps at create; the readers per the table (`ledger-queries.ts`, `ledger-acknowledgment-letter-queries.ts`) via the shared fragment; `listAcknowledgmentsSummary` fields.
9. Gate: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build:only`; grep that no `alert(`/`confirm(`/`prompt(`/`console.log` was added; every named unit test below written and passing.
- **Handoff contract to ux-developer:** the `MovePreview`/`MoveDestination`/`MoveUnlock`/`MoveResponse`/`MoveInput` types and the copy constants in `ledger-correction.ts` are frozen and reported final; the route status map and code table above; `listMoveRegisterContext()`; `getLatestFundMove()` + `buildSweepMemo()`; `listAcknowledgmentsSummary` row type (`entityName` = issuer, `doneeEntityId`, `rowEntityName`, `sentAt`); `ackIssuedElsewhere()`. api-developer states in the work-log any deviation from the contract in the same sentence as the reason.

**3. ux-developer** (after the contract is frozen)
1. `correction-dialog-logic.ts` (`buildMoveBody` with `destBankAccountId`, `isMoveSubmittable` needing the bank pick for cross-entity, deep link from `result.entitySlug`).
2. `move-cross-entity-panel.tsx`, `move-unlock-checklist.tsx`; `move-transaction-dialog.tsx` (grouping, denied list, blocked rendering, success).
3. `transaction-move-eligibility.ts`, `transaction-actions.tsx`, `delete-transaction-dialog.tsx` (pointer prop).
4. `receipt-issuer-note.tsx`, `recent-corrections.tsx` (direction label, both accounts, "Receipt already sent").
5. Register page wiring: register context, all-entity ack load, receipt note, Delete prop, sweep memo from the audit row.
6. Treasury guide.
7. 360px pass on the dialog (cross-entity form, checklist, success), the corrections cards and the Club register note.
- Component tests are `renderToStaticMarkup` of presentational bodies plus pure helpers (no jsdom here, B-103).

**qa (Phase 5):** the live checks and the new e2e spec below. **tech-lead (ship time):** release notes via `/release-notes` from the draft; CLAUDE.md paragraph; mark B-98 and B-102 closed.

### Tests

#### Existing tests that change shape (expected, not regressions)

**`src/app/api/admin/ledger/transactions/[id]/move/route.test.ts`** (the whole file was read; one existing test changes shape, the rest are untouched):
- **"passes the parsed input, the actor and the resolved LEDGER_MANAGE boolean to the query layer"** changes: `parseMoveBody` now normalizes an absent `destBankAccountId` to `null`, so `toHaveBeenCalledWith` expects `input: { ...GOOD, destBankAccountId: null }`.
- Unchanged and still green: all three `auth and ids (T21)` tests; every `POST body validation` case (an extra key still 400; a missing key still 400; none of the bad cases becomes valid); "unparseable JSON"; "a record-only caller passes `callerCanManage: false`" (mocked query layer); the `failures` table rows; the 500 test; the GET test (`reasonLimits` pass-through and the `dues_synced` refusal shape).
- **Additions** to this file: `destBankAccountId` accepted as string and as null and passed through verbatim; wrong type (number, object, array) is 400 `invalid_body` with no query-layer call; the `failures` table gains `[400, dest_bank_account_required|invalid|not_allowed]` and `[403, club_to_foundation_not_supported|reconciled_session|reconciled_legacy|matched_open_session|prior_fiscal_year_cross_entity|manage_required]`; a GET that returns a per-destination `manage_required` denial is passed through as 200.

**`src/lib/ledger-fund-move-queries.test.ts`**: the mock is a **positional select queue**, so the new select order re-sequences every `queueExecute()`/raw `state.selectResults` list (destination fund now loads before the source; the cross-entity path adds the match read, the destination-account read and the acknowledgment select). Per test:

| Existing test | Disposition |
|---|---|
| T13 lock/`FOR UPDATE` shape; T13 UPDATE where `id AND fund_id` | assertions **unchanged** (same-entity), queue re-sequenced |
| T14 tier on the locked row (4 tests) | assertions unchanged, queue re-sequenced; still pass because tier is now step 6 after policy but a same-entity reconciled row reaches it |
| T15 stale; double submit; pinned-UPDATE-zero-rows | stale test unchanged; double submit unchanged; **pinned-UPDATE-zero-rows now asserts the rollback path** (the transaction callback throws the sentinel and the function returns 409 `stale`) |
| T16 refusals table | **row "cross-entity destination (row without a bank account)" changes**: a Club row to a Foundation fund is now 403 `club_to_foundation_not_supported` (was `cross_entity`) and no longer needs `bankAccountId: null`; **add** "cross-entity on a row WITH a bank account is 403 with the policy reason, never 409 `bank_account_entity_mismatch`" (B-next-F(2)); other rows unchanged, re-sequenced; "destination not found" gains the inactive-fund case |
| T17 parity | the six state rows (approved, rejected, pending, transfer leg, dues-synced, not found) unchanged; **the two `manage_required` rows move out**: GET now returns 200 with a per-destination denial, so the table compares per-destination `{ status, code }`; the "allowed flag equals execute" test is re-sequenced and iterates **every** destination of **every** entity |
| T18 success path | same-entity assertions unchanged (v1 payload, no acknowledgment select); re-sequenced |
| T19 `findSentStatementMonth` / warnings | `findSentStatementMonth` tests unchanged; the preview tests move from `preview.warnings` / `preview.tier` to `destinations[i].warnings` / `destinations[i].tier` |

**Other files:** `ledger-fund-move-policy.test.ts` (T1, T2 code-set, the "different entity is cross_entity" test: above); `ledger-correction.test.ts` (the "unknown version" input changes from `v: 2` to `v: 3`, since 2 is now valid; `buildMoveWarnings` call sites gain the new inputs); `ledger-audit.test.ts` (reader tests keep passing; additions below); `move-transaction-dialog.test.tsx` ("exactly the four keys" becomes four plus `destBankAccountId`; the form/impact/warnings tests move to the per-destination shape; the sweep-link test builds from `entitySlug` in the result); `transaction-actions.test.tsx` ("is absent on a Foundation row (no legal destination)" is **inverted**: a Foundation income row now has Move; `moveButtonState` tests gain `entityIdsWithActiveBank`); `delete-transaction-dialog.test.tsx` (new prop defaulted false keeps existing cases); `recent-corrections.test.tsx` (additions only).

#### Named unit tests the implementers deliver (Phase 4 gate)

IDs are `C1...` (continuing the parent's T1-T36 would collide).

**Policy (`ledger-fund-move-policy.test.ts`)**
- **C1** T1 "exactly these two cells", enumerated and counted.
- **C2** T2 code-set incl. `club_to_foundation_not_supported`; rewritten cross-entity test; `charitable -> administrative` cross-entity is `away_from_public` without the Activity clause; cross-entity expense and unknown kinds stay `cross_entity`.
- **C3** T3 cartesian mutual exclusion unchanged and green.
- **C4** second pinned divergence (`charitable -> activity` cross-entity: move allowed, transfer denied).
- **C5** the move policy never allows the cell the sweep allows (generalized over every `mode: "sweep"` pair) and `activity -> charitable` is exactly `club_to_foundation_not_supported`.
- **C6** same-entity `charitable -> activity` income is denied (`not_permitted`).

**Lock/tier (`ledger-transaction-lock.test.ts`)**
- **C7** `requiredMoveTier(..., { crossEntity: true })` is `manage` with `cross_entity` first and accumulates `reconciled`/`prior_fiscal_year`; same-entity unchanged; fiscal-year edge dates as the existing T6.
- **C8** `crossEntityBlockKind` precedence (prior FY, then closed session, then legacy), null on a clean current-year row, and the edge `now`.
- **C9** `CROSS_ENTITY_STATE_COPY` has a message and next step for every code (exhaustive).

**Vocabulary (`ledger-correction.test.ts`)**
- **C10** `parseMoveBody`: absent `destBankAccountId` becomes null; null and a string pass through; a number/object/array is rejected; unknown keys still rejected; the output shape includes `destBankAccountId`.
- **C11** audit v2 round trip (`serializeAuditPayload` then each parser); v1 unchanged; v2 details without `destEntityId` or `acknowledgment`, v2 before without `entity`, an unknown version 3, and a v2 **delete** payload are all `{ raw }`; a table of hostile inputs never throws.
- **C12** `buildMoveWarnings`: same-entity output byte-identical to v1.86.0 for the existing fixtures; cross-entity: ratchet with and without a sent receipt, `receipt_sent`, `unsent_receipt_removed`, `duplicate_candidate` (singular/plural), `sent_statement` with the Foundation label, `dest_sent_statement` absent for Activity, `reports_change`, `reconciliation_pending`; `reconciled`/`prior_fiscal_year` never appear cross-entity; no copy mentions "bank account balance unchanged".
- **C13** `sentStatementWarning(ym)` default label unchanged; `buildSweepMemo`: v1 source says "Administrative", v2 says "the Foundation", no audit row says no "moved" and no date, and the date is the audit row's `America/New_York` date (an audit time of `2026-10-02T01:30:00Z` yields `2026-10-01`).

**Audit (`ledger-audit.test.ts`)**
- **C14** reader: a v2 move is returned for the source entity **and** the destination entity and not for a third; carries `crossEntity`, both entity names, both accounts and `receiptSent`; a v1 move and a raw row behave as before; a malformed v2 row is listed raw; **C15** `getLatestFundMove`: newest wins, parses v1 and v2, null when absent or raw, and the rendered `where` is `action = $1 and target_transaction_id = $2` with no jsonb cast.

**Issuer (`ledger-ack-donee.test.ts` new; plus the reader suites)**
- **C16** the fragment renders `coalesce("ledger_acknowledgments"."donee_entity_id", "ledger_transactions"."entity_id")`; `ackIssuedElsewhere` truth table (null stamp is never "elsewhere").
- **C17** reader wiring: extend the select-chain mocks in `ledger-queries.test.ts` and `ledger-acknowledgment-letter-queries.test.ts` to **record `innerJoin` arguments** and render them with `PgDialect`: `listGeneratableAcknowledgments`, `listAcknowledgmentsSummary` and `getAcknowledgment` join `ledger_entities` on the fragment; `listPendingAcknowledgments` and `listUnlinkedGifts` still join on the transaction's entity and still gate on `donations_deductible`.
- **C18** `listAcknowledgmentsSummary` returns `entityName` = issuer, `doneeEntityId`, `rowEntityName` for a moved row, and the same values as today for an unmoved one.
- **C19** write-set pins (the duplication guard for the invariant): `acknowledge/route.test.ts` (create inserts `doneeEntityId` = the transaction's entity; purpose and mark-sent `.set` key sets lack it), `ledger-acknowledgment-letter-queries.test.ts` (generation, claim and revert sets lack it), the letter-upload route test (if none exists, add one assertion), `[id]/route.test.ts` (both donor-link `.set` sites lack it).

**Acknowledgment settlement (`ledger-fund-move-ack.test.ts` new)**
- **C20** `decideAckOutcome` table. **C21** settlement: the first statement is a `FOR UPDATE` select whose `where` renders `donation_txn_id = $1`; none writes nothing; **sent** updates with exactly `["doneeEntityId", "updatedAt"]`, the `where` pins `id` and `sent_at is not null`, and `sentAt`/`sentVia`/`letterText`/`letterStorageKey`/`donorId` are in no set object; an existing stamp is preserved (the set value is a `coalesce(...)` expression with the source id as its second argument); **unsent** deletes with `where id = $1 and sent_at is null`; zero deleted rows re-reads once and treats a now-sent row as kept.

**Query layer (`ledger-fund-move-queries.test.ts`)**
- **C22** the two `.set` key sets, pinned separately: same-entity `["budgetLineId","categoryId","fundId","updatedAt"]` (never `bankAccountId`, never `entityId`); cross-entity `["bankAccountId","budgetLineId","categoryId","entityId","fundId","updatedAt"]` with `entityId` equal to the **destination fund row's** entity.
- **C23** cross-entity UPDATE `where` renders `("ledger_transactions"."id" = $1 and "ledger_transactions"."fund_id" = $2 and "ledger_transactions"."entity_id" = $3 and "ledger_transactions"."reconciled" = $4 and "ledger_transactions"."reconciled_session_id" is null)`.
- **C24** **guard-order table**, one fixture that fails several steps at once, asserting the earliest step's code and zero writes: approved + manage-needed -> `approved`; stale + `club_to_foundation_not_supported` -> `stale`; Club row to the Foundation + reconciled + record-only -> `club_to_foundation_not_supported` (never `manage_required`); cross-entity + closed session + record-only -> `reconciled_session` (state before tier); prior FY + closed session -> `prior_fiscal_year_cross_entity` (X2); legacy-reconciled -> `reconciled_legacy`; open-session match -> `matched_open_session`; record-only + clean row -> `manage_required` before `dest_bank_account_required`; manage + no account -> `dest_bank_account_required`; foreign-entity account, inactive account, malformed id -> `dest_bank_account_invalid`; **same-entity + any account value -> `dest_bank_account_not_allowed` even when the category is also invalid** (input order); same-entity row whose stored account belongs to another entity -> `bank_account_entity_mismatch`; bad category after a good account -> `category_invalid`.
- **C25** each cross-entity refusal returns its status and code with zero writes: prior FY, closed session, legacy, open-session match, expense, transfer leg, dues-synced, approved, rejected, pending.
- **C26** the open-session match read is issued on **`tx`** and **after** the row lock (call order and `via`).
- **C27** per-destination tier: a Foundation row for a record-only caller shows Club Activity as `manage_required` (200 in GET, 403 in POST) and Club Administrative as `away_from_public`; with manage the Activity destination is allowed; a same-entity destination on a Club row is unaffected.
- **C28** **parity**: every fixture and destination through `previewFundMove` and `executeFundMove`; for each destination `allowed` equals "POST passes steps 1 to 6", every denial carries the code and status POST returns; the only exceptions asserted by name are the GET-only `dest_no_active_bank_account` and the POST-only 400s; the row-state refusals stay top-level and identical.
- **C29** success path (cross-entity): update set, the call order (row lock, reads, **acknowledgment settlement, UPDATE, audit last, all on the same `tx`**), the audit payload parses back to v2 with both entities, both accounts, `donorId`, per-entity statement months and the acknowledgment object for `none`, `kept` and `removed`; an audit-insert rejection propagates; the response carries `entitySlug`, `crossEntity` and `acknowledgment`.
- **C30** **rollback on a lost race**: a zero-row pinned UPDATE after a settled acknowledgment makes the transaction callback throw the sentinel (so the surrounding transaction rolls back) and returns 409 `stale`; any other thrown error is rethrown for a 500; a cross-entity move never issues an acknowledgment write containing `sent_at`/`sent_via`.
- **C31** same-entity success still writes the **v1** payload and issues **no** `ledger_acknowledgments` select.
- **C32** preview: a cross-entity destination lists only **active** destination accounts with before/after balances, `defaultBankAccountId` only when exactly one, `dest_no_active_bank_account` when none; receipt state; both entities' sent-statement months (Foundation warned, Activity not); impact for both accounts; **C33** duplicate candidates: same amount, income, posted, within 30 days, excluding the row itself and transfer legs, cap 5, `matched`/`reconciled` flags, none for a different amount, only for a cross-entity allowed destination; **C34** unlock: closed session names the session, account and period, lists later closed sessions newest first, sets `statementMonth` and `statementAlreadySent`; an open-session match names its session and `otherMatchesOnLine`; legacy has no session; a policy-denied destination never carries `unlock`; computed once per request.
- **C35** inactive destination fund: omitted from the preview, 404 `fund_not_found` from POST.

**Validation (`ledger-transaction-validation.test.ts`)**: **C36** `validateBankAccountForEntity` returns the account name on success; the malformed-id 400 still never reaches the database.

**UI (pure helpers and `renderToStaticMarkup`)**
- **C37** `moveButtonState`: Foundation income row is enabled for a manage caller and disabled with the cross-entity message for a record-only caller; omitted when the destination entity has no active bank account; omitted for expense rows; omitted for a prior-year Foundation row; **enabled** for a closed-session Foundation row; Club Administrative income unchanged; Club Activity income omitted.
- **C38** `MoveDialogBody`: the cross-entity form shows the bank select with no default unless exactly one option, both bank rows' before/after, no "Bank account balance: unchanged", the receipt line by state, the duplicate advisory, the per-entity statement warnings, the two ratchet variants; the denied list on a Club Administrative row contains the Foundation mirror sentence; Confirm needs destination + bank pick + reason; the request body has `destBankAccountId` set cross-entity and `null` same-entity; the success step's sweep link uses **`result.entitySlug`** (regression for X7) and shows the kept/removed receipt line.
- **C39** `MoveUnlockChecklist`: numbered steps with links to `/admin/ledger/reconciliation/{id}`, later sessions first, the exact "hidden from members until you close the session again" wording, the statement-already-sent line only when true, the batch line only when `otherMatchesOnLine > 0`, the after-note, and the Manage-permission line for a record-only caller.
- **C40** `DeleteDialogBody`: the Foundation pointer shows on a Club income row, not on a Foundation row, expense, transfer, and is hidden in the blocked state. **C41** `RecentCorrections`: a cross-entity card reads "Foundation to Club" with both accounts and "Receipt already sent"; a v1 card is unchanged. **C42** `ReceiptIssuerNote` renders only when the issuer differs from the register's entity.

#### Live (not mocked) checks for qa: all eight REQUIRED

Fixtures use `example.com` donors and the existing `E2E QA Move` tag (so `cleanupMoveTransactionFixtures()` removes them); dev `DATABASE_URL` only, never `PROD_DATABASE_URL`; snapshot the database before and after as Phase 5 of the parent did.

1. **Closed-session Foundation row.** Foundation income row on Foundation Checking, closed session matched to a bank line. GET: Club Activity is denied `reconciled_session` with an `unlock` naming that session; POST is 403 `reconciled_session` and the row is unchanged. Reopen (real route, manage), GET now `matched_open_session`, POST 403; real unmatch DELETE; GET allowed; POST with a Club account is 200. The row is on the Club, the session is still open, the bank line is free, and an audit v2 row exists with `reconciled: false`.
2. **Concurrent match versus move (corrected, X4).** (2a) match first, then move: 403 `matched_open_session`, nothing written. (2b) move first (committed), then a match request: refused by the match route's own account check. (2c) **interleaved**: hold `SELECT ... FOR UPDATE` on the row in a raw transaction, start the move (it waits), start a match request for the same row; release; run four staggered attempts. **Expected and recorded, not failed:** if the match route read the old bank account before the move committed, the match insert succeeds afterwards and leaves a Club row matched to a Foundation bank line (the B-105 residual). qa records the observed outcome per attempt in the work-log; an orphan raises B-105's priority, and **no other** outcome is acceptable (no half-moved row, one audit row).
3. **Double submit.** Six parallel POSTs of one cross-entity move: one 200, five 409 `stale`, exactly one audit row, one acknowledgment outcome.
4. **Sent receipt moves.** Row with a **sent** acknowledgment (`sent_via = 'print'`, a letter text on file). After the move: the acknowledgment row survives with `sent_at`, `sent_via`, `letter_text` unchanged; `donee_entity_id` equals the **Foundation**; `/admin/ledger/donors` sent view still lists it under the Foundation; the **Club register** shows "Receipt on file, issued by the Foundation"; `DELETE` of the moved row is **409 `receipt_sent`** and both rows survive.
5. **Unsent acknowledgment.** Row with an unsent acknowledgment: the move returns `acknowledgment: "removed"`, the acknowledgment row is gone, the audit `details.acknowledgment.outcome` is `removed`, and the Foundation pending queue no longer lists it.
6. **Same-entity path cannot change the account.** Same-entity move with a supplied `destBankAccountId` (valid UUID, empty string): 400 `dest_bank_account_not_allowed`, nothing written. A legitimate same-entity move of a **reconciled** Administrative row (manage): `bank_account_id` and `entity_id` are byte-identical before and after and the session pointer is unchanged.
7. **Sweep deep link from the moved row.** From the success step, **Record sweep now** opens `/admin/ledger/activity?entity=club&sweepFrom=...` (entity `club`, not the register's), the form is in Sweep mode with the amount and source account prefilled, the **board-minute field empty**, the memo reads "moved from the Foundation" with the date from the audit row's New York date; a row that was never moved yields a memo with no "moved".
8. **Migration replay does not restamp.** After check 4, run `pnpm db:migrate` (replays 0109). The moved row's `donee_entity_id` is still the Foundation. NULL the stamp on a **non-moved** Foundation acknowledgment, replay, and confirm it is re-stamped to its transaction's entity.

Also confirm once on the live instance (not the repo) that the treasurer's own role holds `ledger.manage` (Open Question 6).

### E2E impact

- **Existing specs.** `e2e/ledger-move-transaction.spec.ts` selects by row and `getByRole("button", { name: "Move", exact: true })`; the Foundation sent-receipt fixture row there now also gets a Move button, which the spec never asserts absent, so it is unaffected. `e2e/transaction-budget-line-link.spec.ts` clicks "Edit" on Foundation **expense** rows, which stay without Move. The Delete-dialog tests gain a static pointer line only on Club **income** rows; none asserts the dialog's full text.
- **New spec (qa-owned): `e2e/ledger-cross-entity-move.spec.ts`**, serial like every spec. Seed by direct DB insert with the `E2E QA Move` tag: a Foundation Charitable income row on Foundation Checking with an `example.com` donor, a sent acknowledgment, a second row with an unsent one, a closed session with a matched line. Cover: Move to the Club (bank account required, "Public donations" preselected, both bank rows, receipt line, ratchet variant, Confirm gated), the success step and the sweep link with the minute empty and the "moved from the Foundation" memo; the Club register receipt note; Delete of the moved row refused; the Foundation compliance **and** Club compliance pages both list the move with "Foundation to Club" and "Receipt already sent"; the closed-session checklist (later sessions first, "hidden from members until you close the session again"); a Club Administrative row's dialog listing the Foundation as denied with the mirror sentence; the Delete-dialog pointer on a Club income row; the dialog at 360px (no horizontal overflow, bank select and reason reachable). **Cleanup:** extend `cleanupMoveTransactionFixtures()` to delete the tagged `ledger_donors` rows (donors are not cascade-deleted with a transaction); audit rows are already matched by the tag in `details`/`before`; acknowledgments cascade with the transaction; bank lines and matches cascade with the fixture session. No email is involved.
- The full serial suite budget (~12 minutes) is unchanged; run only the two ledger move specs for this feature as in Phase 5 of the parent.

### Edge cases and risks

- **A `return` inside `db.transaction` commits (X1).** Any refusal reached after a write must throw. The only such refusal is the pinned UPDATE's zero rows; every other refusal precedes the first write. A reviewer adding a refusal after step 8 must throw, not return.
- **The match-route window is the move's duration (X4).** Not sub-millisecond: a plain SELECT is not blocked by `FOR UPDATE`, and the match insert's key-share lock waits and then succeeds. Probability is small (two admins, one row, ~100 ms) and the close-time tie-out surfaces it, but B-105 should be treated as "Soon". Fix shape when picked up: the match insert runs in one transaction, re-selects the rows `FOR SHARE`, and re-checks account and `reconciled = false` before inserting.
- **Fiscal-year turn (X10, Open Question 3).** A gift keyed in June and discovered while reconciling the June statement in July is "prior fiscal year" and is refused. Defaults adopted; the treasurer should say whether that is acceptable. The cost of allowing it is restating two entities' closed-year totals under `LEDGER_MANAGE`.
- **Treasurer permission baseline.** `ledger.manage` is `admin`-only today. A successor holding only the `treasurer` role sees Move disabled with the permission message for every cross-entity move (the self-sufficiency audit's NEW-4). Not solved here; the message names the Admin role so the successor knows whom to ask.
- **Reopen hides statements from members, from the session month onward (X9).** Said plainly in the checklist. If the Foundation statement was already sent, reopening makes the panel offer a corrected resend; nothing is emailed automatically.
- **Receipt semantics are not decided by the ledger.** The Foundation's receipt stays as issued. Whether it is still the right document is a tax-adviser and board matter (Open Question 2); the dialog and guide say so and the audit row records the outcome.
- **Gross receipts count transfer-in legs (X13).** Existing behavior of `getOverview()`; the dialog states the effect. Not changed here.
- **Unsent acknowledgment removed.** Warned in the dialog and recorded in the audit `details.acknowledgment`. A kept acknowledgment whose email claim is later reverted by a total send failure becomes unsent on a Club row with a Foundation stamp (Phase 2 R1d residual): self-consistent, invisible to the deductible-gated pending queue, and not worth a second lock protocol.
- **Preview cost.** Bounded by one allowed cross-entity destination; computed once per dialog open. The duplicate-candidate query is one indexed-ish read (amount and date window, destination entity) with a cap of five.
- **Inactive destination funds** are now excluded from the preview and refused by POST (small hardening that also applies to v1 same-entity moves; no inactive fund exists today).
- **Dialog description** "Move this ledger entry to a different fund in the same entity" becomes inaccurate; change it to "Move this ledger entry to another fund, with a reason that is logged." (ux-developer; same-entity labels such as "Move to {fund}" stay exactly as they are so the existing e2e selectors keep resolving).
- **Stale or hand-built `sweepFrom` links** remain ignored silently when they do not validate (unchanged).
- **No personal data in the repo:** fixtures use `example.com`; reason text is runtime data and never reaches a member surface (the member-surface import guard still covers `ledger-audit.ts` and `ledger-correction.ts`).
- **Durable-claim exception: not triggered, re-confirmed.** The move writes no `email_queue` row, never writes or clears `sent_at`/`sent_via` (it **retains** an existing claim), and `financial_report_sends` is read-only here; `sendEmailForDurableClaim()` does not apply and no Phase 2 re-review is needed on that axis.

### Out of scope (confirm)

Club-to-Foundation moves (`club_to_foundation_not_supported`, B-104), expense moves (B-96), Foundation to Club **Administrative**, any other cross-entity cell, moving transfer legs, dues-synced, approved, rejected or pending rows, prior-fiscal-year cross-entity moves, **any automation** of reopen, unmatch, close or the sweep, a board-minute reference on the move itself (Open Question 1 default), editing a reconciled row's amount, date, flow or check number, the legacy reconcile toggle (B-92), a "Receipt issued by" badge in the donor giving history (B-106), closing the match-route race (B-105), bundled-deposit detection (B-107), a per-row "moved from" History (B-100), a DOM test harness (B-103), and solving the treasurer permission baseline (self-sufficiency audit NEW-4).

### Release-notes draft (no version assigned; no file list; for `/release-notes` at ship time)

> ### Feature: Move a gift from the Foundation's books to the Club's
>
> **Value:** When a gift was recorded on the Foundation's books but the money actually landed in the Club's bank account, the treasurer can now move the entry across in one step, keep the donor and the receipt that was already sent, and record the sweep once the money really moves. Nothing has to be deleted and typed in again.
>
> #### What's New
> - **Move to the Club.** On a Foundation income entry, choose **Move**, pick the Activity Fund, the Club bank account the money landed in, and a category (Public donations is preselected), and give a reason. Before you confirm, the dialog shows both entities' balances and both bank accounts' before and after.
> - **The donor and the receipt stay.** The receipt letter that was already sent stays attached to the gift and still names the Foundation. The Club's register shows "Receipt on file, issued by the Foundation."
> - **A guided checklist for reconciled gifts.** If the gift was cleared by a closed reconciliation session, the dialog walks through what to do: reopen the session (newest first if later ones are closed), unmatch the gift, move it, give the freed bank line its right entry, and close the session again. It tells you that reopening can hide the Foundation's monthly statements from members until you close the session again. Nothing happens automatically.
> - **A warning if the deposit may already be recorded** on the Club's books, so the same money is not counted twice.
> - **Both entities' Recent corrections.** The move appears on the Foundation's and the Club's Compliance pages as "Foundation to Club", with both bank accounts, the reason, and "Receipt already sent."
> - **A clearer sweep prompt.** **Record sweep now** now says the gift was moved from the Foundation and uses the date of the move.
>
> #### Good to know
> - Moving to the other entity needs the Manage Ledger permission (held by the Admin role by default). It is a permission, not a second approver.
> - **A move cannot be undone.** Money in the Club's Activity Fund reaches the Foundation only through a minuted sweep, and because a receipt has already gone to the donor, the moved entry can no longer be deleted; correct it later with a refund entry.
> - The ledger keeps the receipt as it was issued; it does not decide whether that receipt is still the right document for a gift the Foundation's books no longer carry. Confirm with whoever advises the club on tax matters, and mention it at the next board meeting.
> - Only entries from the current fiscal year that are not reconciled and not matched to a bank line in an open session can move. A gift from an earlier fiscal year cannot be moved yet.
> - **The other direction is not a move.** If a Club entry's money is actually in the Foundation's bank account, delete the Club entry (it asks for a reason) and enter the gift on the Foundation's register, in the bank account the money landed in. The Delete dialog on Club income entries now says so.
> - Moving does not sweep anything, and the Foundation side of a sweep still has no acknowledgment letter. After the move, the Foundation's income totals fall by the gift; when you record the sweep, the Foundation's totals count the transfer-in as income, as they do for every sweep.
>
> #### Fixes
> - Gift acknowledgments now remember which entity issued them, so a receipt keeps naming its issuer wherever the gift's entry is later booked.
> - **Record sweep now** no longer shows the wrong date after about 8 pm Eastern or says "moved" for an entry that was never moved.

### What I did

- Read the whole cross-entity work-log (Phase 1, Phase 2 R1 to R7, the proposed decision and backlog text) and the parent work-log's Phase 3 design and Phase 4 to 6 outcomes, so this extends what shipped in v1.86.0 instead of restating it.
- Verified every code claim the design leans on: the policy, lock classifier, `ledger-fund-move-queries.ts` (including its positional-queue test mock), correction vocabulary and parser, audit writer and reader, the move route and its tests, the register page and `moveButtonState`, both dialogs and their logic helpers, `recent-corrections.tsx`, the transfer policy, the acknowledgment schema, **all ten write sites** and five readers of `ledger_acknowledgments`, the reconciliation match, reopen and unmatch routes, `getOverview()` gross receipts, the month-gating rule, the guide copy, the e2e specs and the fixture cleanup.
- Found and resolved three things Phase 2 did not catch: the commit-on-return trap and the contradictory ack/UPDATE ordering (X1), the match-route window being the move's duration (X4), and the `entitySlug` deep-link bug (X7); plus the prior-year dead-end ordering (X2) and the fiscal-year-turn exposure of the driving case (X10).
- Wrote this design; filed DECISION-112 and DECISION-113; appended B-104 to B-107 and re-aimed B-98 (see Outputs).

### Outputs

- `docs/work-log/2026-10-01-cross-entity-transaction-move.md` (this section; status table updated)
- `docs/decisions.md`: **DECISION-113** (implementation shape) and **DECISION-112** (the cross-entity cell, issuer column, audit v2) at the top; a one-line cross-reference added to DECISION-109's status.
- `docs/backlog.md`: **B-98 re-aimed in place** (the mirror pointer, now also shipping in this increment); **B-104** (Club-to-Foundation move), **B-105** (match route re-verifies under a lock, raised to Soon), **B-106** (tighten the issuer column), **B-107** (duplicate-candidate residual: bundled deposits); a one-line amendment on B-96; B-102 noted as closed by this increment. B-108 left unassigned; the self-sufficiency audit's NEW-1..16 are **not** filed.
- No code, schema or migration changes. The migration number `0109` is a placeholder database-admin re-derives.

### Open questions / handoff notes

- **Next agent: database-admin** (schema.ts, then `0109`), **then api-developer, then ux-developer**, in the split above. Not full-stack-developer.
- **Treasurer to confirm (real club facts; defaults adopted, the pipeline is not blocked):**
  1. Open Question 3, now sharper: a June gift reconciled in July is a prior-year row and is **refused** (X10). Acceptable, or allow prior-year cross-entity moves under `ledger.manage` with a stronger warning?
  2. Open Question 2: the tax-adviser sentence on a receipted gift moving, and whether to tell the board.
  3. Open Question 6: does the treasurer's account actually hold `ledger.manage`, and does the successor? (Self-sufficiency audit NEW-4.)
  4. What the freed Foundation bank line turned out to be in the real instance, so the checklist's "give it its right entry" wording matches practice (do not record real figures in the repo).
- **Orchestrator:** B-105 (match-route race) is worth scheduling soon, with the corrected window described in X4; live check 2c will produce evidence either way.
- **Ship-time (tech-lead):** release notes from the draft above; rewrite the CLAUDE.md "Ledger corrections" paragraph (it says the Foundation-deposit case is "NOT a move"); close B-98 and B-102 on ship; `docs/decisions.md`, `docs/backlog.md` and this work-log are uncommitted and must ship with the feature.
- **Phase 6 re-check list (analyst):** R1 (issuer stamp and the Club register marker), R2 (T1/T3 and the new code), R3.4 (GET per-destination contract), R3.7 (two UPDATE shapes), R4 (v2 round trip, dual-entity reader), X1 (rollback on a lost race), X7 (sweep link entity), the eight live checks, and the guide and release-note wording rules (no second-approver language, no acknowledgment promise for the sweep leg, "Moved" not "Reversed").

---

## Phase 4 — Implementation (schema) — 2026-10-01

**Owner:** database-admin
**Status:** complete (schema done)

### Summary
Added `ledger_acknowledgments.donee_entity_id` (nullable, write-once FK to `ledger_entities`) to `schema.ts` with the designed doc comment, wrote idempotent migration `0109`, and created the shared fragment module `ledger-ack-donee.ts` with its unit test. No existing join sites were migrated (api-developer's step).

### What I did
- `schema.ts` first, then re-derived the number: highest was `0108_ledger_approve_description.sql`, so the migration is **0109**.
- Migration: `ADD COLUMN IF NOT EXISTS`; FK in a guarded `DO $$` block; NULL-only backfill from `ledger_transactions.entity_id` (does not touch `updated_at`).
- Ran `pnpm db:migrate` twice against the local dev DB (DATABASE_URL only; PROD_DATABASE_URL not used). Both succeeded.
- Replay check: NULLed one acknowledgment on an unmoved row, replayed, confirmed it was re-stamped; `updated_at` fingerprint of all rows unchanged across the replay.

### Outputs
- `src/lib/db/schema.ts` (`ledgerAcknowledgments.doneeEntityId`, after `donorId`)
- `drizzle/migrations/0109_ledger_ack_donee_entity.sql` (every statement idempotent)
- `src/lib/ledger-ack-donee.ts` (`ackDoneeEntityId`, `ackIssuedElsewhere`) and `src/lib/ledger-ack-donee.test.ts` (C16, 4 tests)
- Exact constraint name: `ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk` (confirmed present in `pg_constraint`)
- Dev DB NULL counts (3 acknowledgment rows): before migration the column did not exist (all 3 effectively unstamped); after run 1: 0 NULL, 0 mismatched against the transaction's entity; after run 2: 0 NULL (no-op). Replay test: 1 NULL, replay, 0 NULL.
- Verification: `pnpm exec tsc --noEmit` clean (no fixture changes needed); `pnpm test` 158 files / 2687 tests pass.
- Local apply: `export $(grep -E "^DATABASE_URL=" .env.local | xargs) && pnpm db:migrate`
- `drizzle-kit push` (non-forced) could not be run non-interactively: it stops at a prompt about an unrelated, pre-existing `ledger_entities_slug_unique` constraint diff (not this column). Nothing about `donee_entity_id` was proposed before that prompt.

### Open questions / handoff notes
- **Next agent: api-developer.** `ledgerAcknowledgments.doneeEntityId` is `string | null` on `LedgerAcknowledgment` / `NewLedgerAcknowledgment`. FK to `ledger_entities(id)`, no cascade, no index. No other table touched.
- Import `ackDoneeEntityId` from `@/lib/ledger-ack-donee`; queries using it must join `ledger_transactions`. Do not re-type the COALESCE.
- Existing readers and the acknowledge POST stamp are untouched; migrate per the reader table. Only the acknowledge insert and the move may write the column.
- Pre-existing: `drizzle-kit push` wants to add `ledger_entities_slug_unique`; worth a look by whoever owns the deploy, unrelated to this increment.

---

## Phase 4 — Implementation (server) — 2026-10-01

**Owner:** api-developer
**Status:** complete (server done, UI pending)

### Summary
The server half of the cross-entity move is built and tested: the policy decision-tree rewrite (one new allowed cell, `club_to_foundation_not_supported`, `away_from_public` across entities), the per-destination guard pipeline and GET preview, `destBankAccountId` with its three 400 codes, the two separately-built key-pinned UPDATE shapes, acknowledgment settlement before the pinned UPDATE with a throw-to-rollback sentinel, audit `v: 2` with a version-aware parser and a dual-entity reader, `getLatestFundMove()` and `buildSweepMemo()`, and the receipt-issuer readers moved onto the shared fragment. The acknowledge POST now stamps `doneeEntityId`. All of C1-C36 are written and passing; C37-C42 are the UI half (ux-developer). Gate: tsc clean, 160 files / 2848 tests green, lint clean on touched files, `pnpm build:only` passes.

### What I did
- **Policy** (`ledger-fund-move-policy.ts`): cross-entity tree per X-design (non-income `cross_entity`; charitable to activity allowed; charitable to administrative `away_from_public` with the cross-entity sentence; activity/administrative to charitable `club_to_foundation_not_supported`; else `cross_entity`). Same-entity charitable to activity stays `not_permitted`. Cross-reference comments updated in both policy files (`ledger-transfer-policy.ts` comment-only). Tests C1-C6.
- **Lock/tier** (`ledger-transaction-lock.ts`): `requiredMoveTier(row, now, { crossEntity })` (`cross_entity` listed first), pure `crossEntityBlockKind()` in X2 order (prior FY, closed session, legacy). Tests C7-C8.
- **Vocabulary/parser** (`ledger-correction.ts`): all contract types, new error codes, `CROSS_ENTITY_STATE_COPY` (exhaustive), cross-entity warning copy, `buildMoveWarnings` (same-entity output byte-identical, pinned), `sentStatementWarning(ym, label)`, `buildSweepMemo`, v2 payload types, version-aware parser (moved accepts 1 and 2 with per-version guards; deleted accepts 1 only), reader-row fields. Tests C9-C13.
- **Validation/reconciliation**: `validateBankAccountForEntity` now returns `{ ok: true, account: { id, name } }` (C36); `listLaterClosedSessionsForAccount()` added beside the shipped function, which is untouched (X8).
- **New modules**: `ledger-fund-move-ack.ts` (pure `decideAckOutcome` + `settleAcknowledgmentForMove`; C20-C21) and `ledger-fund-move-preview.ts` (`findSentStatementMonth` moved here and re-exported from the queries module, `accountBookBalance`, `sourceBankImpact`, `listActiveBankOptions`, `findDuplicateCandidates`, `loadOpenMatch`, `buildMoveUnlock`, `loadReceiptState`, `listMoveRegisterContext`).
- **Evaluator/preview/execute** (`ledger-fund-move-queries.ts`, rewritten): `evaluateRowState` + `evaluateDestination` (policy, cross-entity state with the match read on the caller's handle, tier); preview loops every other active fund of every entity and returns 200 with per-destination `tier`, `denial` (`code`, `status`, `reason`, `unlock`), `categories`, bank options, impact, duplicate candidates and warnings; execute follows the nine-step order (policy, state with prior-FY first, tier, input), `FOR UPDATE` first, acknowledgment settlement BEFORE the pinned UPDATE, throw `StaleMoveRollback` on zero rows (mapped to 409 `stale` only in `executeFundMove`), audit last on the same `tx` (v1 for same-entity, v2 for cross-entity). `buildSameEntityMoveSet` / `buildCrossEntityMoveSet` are separate exported builders. Tests T13-T19, C22-C35.
- **Audit** (`ledger-audit.ts`): `getRecentLedgerCorrections()` matches either entity for a v2 move and fills the new row fields; `getLatestFundMove()` (plain equality on `action` and `target_transaction_id`, no jsonb cast). Tests C14-C15.
- **Receipt issuer**: `acknowledge/route.ts` insert stamps `doneeEntityId: txn.entityId`; `listGeneratableAcknowledgments`, `listAcknowledgmentsSummary` and `getAcknowledgment` join on `ackDoneeEntityId`; `listPendingAcknowledgments` and `listUnlinkedGifts` untouched on purpose. Tests C17-C19 (join wiring by rendering the ON clause, write-set pins on every other writer).
- **Route** (`move/route.ts`): header and status map only; the body key arrives through `parseMoveBody`.
- **Existing tests changed** per the Phase 3 table: move route test, queries test (rewritten: the mock now queues selects per table, so adding a read to one table no longer re-sequences every scenario; it also records commit versus rollback), policy test (T1/T2/T3 as designed), correction test, lock test, validation test, audit test, ledger-queries and letter-queries tests (join recording), acknowledge route test (fixture gains `entityId`), `[id]/route.test.ts` (one added assertion).

### Outputs

**Endpoint (unchanged path, extended contract):** `GET` and `POST /api/admin/ledger/transactions/[id]/move`. Auth: `auth()` then `LEDGER_RECORD` (403 without); `LEDGER_MANAGE` resolved once as a boolean and enforced per destination server-side (every cross-entity move; reconciled or prior-year same-entity moves, as before). No new `FEATURES` key, no role binding, no email, no schema change beyond 0109 (database-admin).

**All types are in `src/lib/ledger-correction.ts` and are FROZEN; import, never redeclare:** `MovePreview`, `MoveDestination`, `MoveUnlock`, `MoveBankOption`, `MoveDuplicateCandidate`, `MoveEntityRef`, `FundBal`, `MoveWarningCode`, `MoveDestinationDenialCode`, `MoveErrorCode`, `MoveInput`, `MoveResponse`, `CROSS_ENTITY_STATE_COPY`, `CROSS_ENTITY_MANAGE_REQUIRED_MESSAGE`, `buildSweepMemo`.

**GET 200 body (`MovePreview`):**
- `transaction`: v1.86.0 fields plus `entity: { id, slug, name }` (display name, `shortName ?? name`), `donorId`, `receipt: "none" | "unsent" | "sent"`.
- `callerCanManage: boolean`. **Top-level `tier` and `warnings` are REMOVED** (X3).
- `destinations[]`: every OTHER ACTIVE fund of EVERY entity, the row's own entity first. Per destination: `fundId, name, kind, entity, crossEntity, tier { required, reasons }` (always present, a function of row and destination), `allowed`.
  - Denied: `denial { code, status: 403 | 409, reason, unlock? }`. `reason` is the sentence to render. Codes: the policy codes (`same_fund`, `cross_entity`, `club_to_foundation_not_supported`, `expense_not_supported`, `away_from_public`, `not_permitted`), `manage_required` (a 200 per-destination denial, never a top-level 403), the state codes (`prior_fiscal_year_cross_entity`, `reconciled_session`, `reconciled_legacy`, `matched_open_session`), `bank_account_entity_mismatch`, and `dest_no_active_bank_account` (GET-only, status 409, reason "The Club has no active bank account to receive this entry.").
  - Allowed: `categories`, `defaultCategoryId` ("Public donations" when present), `impact` (union on `crossEntity`: same-entity `{ sourceFund, destFund, bankAccount: { name, changeCents: 0 } }`; cross-entity `{ sourceFund, destFund, sourceBankAccount: { name, beforeCents, afterCents } | null }`), `warnings[]` (server-composed; render as given). Cross-entity only: `bankAccounts[]` (ACTIVE accounts, name-ordered, each with `beforeCents`/`afterCents`), `defaultBankAccountId` (set ONLY when exactly one account; otherwise null and the dialog must not preselect), `duplicateCandidates[]` (cap 5, advisory).
- **The `unlock` block** appears on `denial` for exactly three codes, only for a cross-entity destination the policy allowed: `reconciled_session` (`kind: "closed_session"`: `session { id, bankAccountName, periodStart, periodEnd, status }`, `laterClosedSessions[]` newest first, `statementMonth` "YYYY-MM", `statementAlreadySent`), `matched_open_session` (`kind: "matched_open_session"`: `session`, `otherMatchesOnLine`; `statementMonth` null, `statementAlreadySent` false, `laterClosedSessions` empty) and `reconciled_legacy` (`kind: "legacy_reconciled"`, `session` null). `prior_fiscal_year_cross_entity` and every policy denial carry no `unlock`. It is computed once per request. Checklist links go to `/admin/ledger/reconciliation/{id}`.
- Row-state refusals (`approved`, `rejected`, `pending`, `transfer_leg`, `dues_synced`) and `not_found` stay top-level `{ error, code }` 4xx, identical to POST. Parity: every destination GET lists as allowed passes steps 1-6 in POST; every denial carries the code and status POST returns. Exceptions, named: `dest_no_active_bank_account` is GET-only (POST says 400 `dest_bank_account_invalid`), and the 400 input codes are POST-only.

**POST body:** `{ destFundId, categoryId | null, reason, expectedFundId }` plus OPTIONAL `destBankAccountId: string | null` (absent is normalized to null; a number, object, array or boolean is 400 `invalid_body`; any other key is 400). REQUIRED for a cross-entity move; any non-null value, even "", on a same-entity move is 400 `dest_bank_account_not_allowed`.

**POST 200 (`MoveResponse`):** the v1.86.0 fields plus `entitySlug` (the DESTINATION entity's slug: **build the sweep deep link from this**, not from the register's `entitySlug` prop; X7), `crossEntity`, `acknowledgment: "none" | "kept" | "removed"`.

**POST status map:** 400 `invalid_body | category_invalid | dest_bank_account_required | dest_bank_account_invalid | dest_bank_account_not_allowed`; 401; 403 `approved | rejected | pending | transfer_leg | dues_synced | manage_required | cross_entity | expense_not_supported | away_from_public | not_permitted | club_to_foundation_not_supported | prior_fiscal_year_cross_entity | reconciled_session | reconciled_legacy | matched_open_session`; 404 `not_found | fund_not_found | category_not_found`; 409 `stale | same_fund | bank_account_entity_mismatch`; 500 "Could not move this entry. Nothing was changed." 400 is inline field errors, 403/404/409 toast + close + refresh, 5xx toast and stay open (unchanged in kind, as `moveFailureAction` already does).

**Server-side helpers for the register and page:** `listMoveRegisterContext()` in `ledger-fund-move-preview.ts` (every active fund of every entity plus `entityIdsWithActiveBank`); `getLatestFundMove(transactionId)` in `ledger-audit.ts` and `buildSweepMemo({ party, move })` in `ledger-correction.ts`; `ackIssuedElsewhere(doneeEntityId, rowEntityId)` in `ledger-ack-donee.ts`.

**`listAcknowledgmentsSummary` row type (`AcknowledgmentSummaryRow`):** `entityName` is now the ISSUER's name (X6; `sent-ack-list.tsx` needs no change), plus `doneeEntityId` (the issuer's id) and `rowEntityName` (where the entry is booked now); `fundName` stays the row's fund. `getAcknowledgment().entity` is the issuer; `.txn.entityName` is the row's.

**Schema:** none beyond database-admin's `0109_ledger_ack_donee_entity.sql` (`ledger_acknowledgments.donee_entity_id`).

**Files:** new `src/lib/ledger-fund-move-ack.ts`, `src/lib/ledger-fund-move-preview.ts` (+ `ledger-fund-move-ack.test.ts`, `src/app/api/admin/ledger/acknowledgments/[id]/letter/route.test.ts`); modified `ledger-fund-move-policy.ts`, `ledger-transfer-policy.ts` (comment), `ledger-transaction-lock.ts`, `ledger-correction.ts`, `ledger-transaction-validation.ts`, `ledger-audit.ts`, `ledger-fund-move-queries.ts`, `reconciliation-queries.ts`, `ledger-queries.ts`, `ledger-acknowledgment-letter-queries.ts`, `move/route.ts`, `acknowledge/route.ts`, and their tests.

### Open questions / handoff notes
- **Next agent: ux-developer.** The contract above is final. UI work remaining is exactly the Phase 3 UI list (dialog sub-components, both registers, Delete pointer, compliance cards, guide, receipt note, sweep memo wiring, C37-C42).
- **Deviations from the design, with reasons:**
  1. **Minimal UI compile fixes (the tsc gate forced them).** Retyping `MovePreview` broke three UI files, so I touched them only as far as needed: `move-transaction-dialog.tsx` reads `warnings` from the selected destination, renders the same-entity impact only when `impact.crossEntity === false`, and builds the sweep link from `result.entitySlug` (the X7 one-liner); `correction-dialog-logic.ts` `buildMoveBody` takes an optional `destBankAccountId` and always emits the key (null by default); `move-transaction-dialog.test.tsx` and `recent-corrections.test.tsx` fixtures got the new shape fields. **The dialog does not yet render a cross-entity form**: the register still has no Move button on a Foundation row (`moveButtonState` untouched), so nothing reaches it, but if a cross-entity destination were selected the POST would be a 400 `dest_bank_account_required`. That is the ux-developer's step.
  2. **Register ack load.** `[fundSlug]/page.tsx` now loads `listAcknowledgmentsSummary` whenever `canRecord` (was `isFoundationEntity && canRecord`), so a moved row's receipt status reaches the Club register's Delete dialog; the ack controls stay Foundation-only. The receipt-issuer note, the Delete pointer prop, `moveFunds`/`entityIdsWithActiveBank`, and the sweep memo (still the old "moved from Administrative" text built from the page-load clock) remain ux-developer work.
  3. **`findSentStatementMonth` moved** to `ledger-fund-move-preview.ts` to avoid a circular import and is re-exported from `ledger-fund-move-queries.ts`; existing importers and tests are unchanged.
  4. **`dest_no_active_bank_account` status is 409** (the design left it open between 403 and 409; it is a data state, never an HTTP response).
  5. **Unlock for `matched_open_session`** carries `statementMonth: null` and `statementAlreadySent: false`: the design's checklist shows only step 2 and the after-note for that kind, so the statement fields are not meaningful there.
  6. **Per-test table**: the existing "unknown version" parser input stays `v: 2` (a payload missing the v2 fields is still raw); I added a `v: 3` input beside it rather than replacing it.
- **Live checks (qa, all eight required) are untouched by this step**; the mocked suites cannot prove lock semantics, FK cascades, commit-on-return or the match-route race (B-105). The mock records commit versus rollback so the sentinel path is asserted, but only a real database proves it.
- **Test count:** 160 files, 2848 tests (was 158 files, 2687 before this step's schema handoff plus the policy and move suites).
- **No emails, no `console.log`, no native dialogs added; `PROD_DATABASE_URL` never used** (every test mocks `@/lib/db`).
- Docs: `docs/decisions.md` and `docs/backlog.md` were not edited.

---

## Phase 4 — Implementation (UI) — 2026-10-01

**Owner:** ux-developer
**Status:** complete

### Summary
The Move dialog now handles the cross-entity destination end to end (Foundation Charitable income row to Club Activity): an explicit Club bank-account pick, both entities' fund and bank-account before/after, the receipt line, the duplicate advisory, per-entity statement warnings (rendered as the server composed them), and a guided checklist rendered from the `unlock` block instead of the form for a closed-session row. The register gains the Move button on Foundation rows (X10 prior-year omission, closed-session stays enabled), the "Receipt on file, issued by the Foundation" marker on the Club register, the Delete-dialog pointer on Club income rows, the compliance cards' "Foundation to Club" rendering, the sweep memo built from the audit row, and the Treasury guide paragraphs. C37-C42 are written and passing.

### What I did
- `correction-dialog-logic.ts`: `isMoveSubmittable` needs the bank pick when cross-entity; new pure helpers `initialBankAccountId` (preselect only the server's `defaultBankAccountId`), `moveConfirmLabel` ("Move to Activity Fund (Club)"; same-entity label unchanged), `noDestinationHeading` ("This entry can't be moved yet" for permission/state denials, old sentence for pure policy denials), `formatSessionPeriod`.
- Dialog split into sub-components (no new branches piled into one file): `move-impact-card.tsx` (shared before/after card for funds and bank accounts), `move-cross-entity-panel.tsx` (bank select, both bank rows, receipt line, duplicate advisory), `move-unlock-checklist.tsx` (closed session, matched open session, legacy reconciled; links to `/admin/ledger/reconciliation/{id}`; "hidden from members until you close the session again"; Manage line for a record-only caller; "Check again" re-runs the preview). `move-transaction-dialog.tsx`: destinations grouped by entity in an `<optgroup>` once any destination is cross-entity, denied destinations listed as text with the entity name (a Club Administrative income row lists the Foundation's Charitable Fund with the mirror sentence), per-destination warnings, "Bank account balance: unchanged" only for same-entity, success step names the entity and the receipt outcome, sweep link from `result.entitySlug`, `destBankAccountId` sent only for a cross-entity destination (null otherwise), description changed to "Move this ledger entry to another fund, with a reason that is logged."
- `transaction-move-eligibility.ts`: `moveButtonState` takes every entity's funds plus `entityIdsWithActiveBank`; cross-entity destinations count only when that entity has an active bank account and the row is not dated before the current fiscal year; closed-session rows stay enabled; disabled reason is the cross-entity message when every remaining destination is cross-entity. A `crossEntityOnly` flag drives the register's "If the money is in the Club's account, see Move to the Club." sentence on a closed-session Foundation row.
- `transaction-actions.tsx`: new props `moveFunds`, `entityIdsWithActiveBank`, `foundationPointer`. `delete-transaction-dialog.tsx`: static `FOUNDATION_POINTER_COPY` above the reason field, hidden in the blocked state (no account name hard-coded, X5). `recent-corrections.tsx`: "Foundation to Club" badge, "Bank account: A to B" line, "Receipt already sent" badge for v2 rows; v1 cards unchanged. `receipt-issuer-note.tsx`: new server-safe marker, renders only when `ackIssuedElsewhere(...)`.
- Register page: loads `listMoveRegisterContext()` for `canRecord`, builds an ack-by-transaction map, shows the receipt note on income rows, passes `foundationPointer = !isFoundationEntity && flow === 'income' && !isTransfer`, and builds the sweep memo with `getLatestFundMove()` + `buildSweepMemo()` (X7 link comes from the response, the date from the audit row).
- Treasury guide (`books-register-section.tsx`): lead sentence now names both cells; the bank-balance bullet is split (same-entity unchanged, cross-entity does change); new subsection "Moving a gift from the Foundation to the Club" (when to use it, donor and receipt stay, why a sent receipt blocks delete, tax-adviser sentence and board mention, closed-session checklist and member-statement effect, reconcile the Club deposit, duplicate warning limits, Foundation totals and the sweep's transfer-in with no acknowledgment, current fiscal year only, one-way); mirror paragraph under "Deleting an entry". No second-approver language; "Moved", never "Reversed".

### Outputs
- New: `src/components/admin/ledger/move-impact-card.tsx`, `move-cross-entity-panel.tsx`, `move-unlock-checklist.tsx` (+ `.test.tsx`), `receipt-issuer-note.tsx` (+ `.test.tsx`).
- Modified: `src/components/admin/ledger/correction-dialog-logic.ts`, `move-transaction-dialog.tsx`, `transaction-move-eligibility.ts`, `transaction-actions.tsx`, `delete-transaction-dialog.tsx`, `recent-corrections.tsx`, `guide/books-register-section.tsx`; `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`; tests `move-transaction-dialog.test.tsx` (C38), `transaction-actions.test.tsx` (C37, inverted Foundation-row case), `delete-transaction-dialog.test.tsx` (C40), `recent-corrections.test.tsx` (C41).
- No `src/lib/*.ts`, API route, `docs/decisions.md` or `docs/backlog.md` changes by this step.
- Gate: `pnpm exec tsc --noEmit` clean; `pnpm test` 162 files / 2888 tests green; `pnpm build:only` passes; `pnpm lint` clean on my files (0 errors; one pre-existing unused-disable warning in `budget-context-panel.tsx`, not mine).
- Dev walk (DATABASE_URL, e2e admin, throwaway spec deleted afterwards): Foundation gift with a donor and a sent (`print`) acknowledgment moved to Club Activity with Administrative Checking and a reason (200, `acknowledgment: "kept"`); success step's "Record sweep now" went to `/admin/ledger/activity?entity=club&sweepFrom=...` and the sweep form opened prefilled (amount, date, memo "Sweep of ... gift moved from the Foundation on 2026-10-01", board-minute field empty); the Club Activity register shows "Receipt on file, issued by the Foundation (sent ...)" and Delete on it shows the sent-receipt refusal; the acknowledgment row survived with `sent_at`, `sent_via = print` and `donee_entity_id` = Foundation; a Foundation row owned by a closed session (with a later closed session on the same account) rendered the checklist, not the form, with the later session first; a Club Administrative income row listed the Foundation as denied with the mirror sentence and its Delete dialog showed the pointer; both Compliance pages listed the move as "Foundation to Club" with "Receipt already sent". 360px: no page or dialog horizontal overflow on the form or the checklist; screenshots taken for the form, picked state, success, sweep form, Club register, blocked Delete, checklist, denied list, pointer and both Compliance pages. All fixtures, the donor, acknowledgments, audit rows and both sessions were removed; verified zero fixture rows remain and the acknowledgment table is back to its original 3 rows.

### Open questions / handoff notes
- **Next agent: qa (Phase 5).** The eight live checks are still qa's (concurrency, replay, rollback); my walk covered only the happy path, the checklist and the denied/pointer surfaces. The dev walk on this DB had two Club bank accounts (Administrative Checking, Petty Cash), so the "preselect only when exactly one" branch is covered by unit logic (`initialBankAccountId`) but was not exercised in the browser.
- **Stale dev server gotcha (not a code defect):** the dev server that was already running returned 500 ("Cannot convert undefined or null to object") from the move route for a sent-receipt move, while the identical `executeFundMove()` call succeeded in a fresh process. Restarting `next dev` fixed it (it had loaded `schema.ts` before the new acknowledgment column). qa should restart the dev server before the live checks. I restarted it on port 3000 (log in the session scratchpad `dev2.log`).
- **Deviations from the design, with reasons:**
  1. With no allowed destination the dialog no longer renders the reason field or a Confirm button (it shows the heading, the denied list and any checklist with a Close button). The v1 form rendered a dead Confirm there; the cross-entity record-only and closed-session cases make that state reachable now.
  2. The checklist renders for every denied destination whose `denial` carries `unlock`, above the denied list, and the form is shown only when something is allowed. The design says "instead of the form"; this is identical for the real cases (Foundation has one fund) and avoids hiding a legal same-entity destination if one ever exists.
  3. The select is flat while every allowed destination is same-entity (keeps existing e2e selectors and v1 markup byte-identical) and grouped by `<optgroup>` as soon as any allowed destination is cross-entity.
  4. The `unsent_receipt_removed` warning renders as the cross-entity receipt line and is filtered out of the generic warning list so it is not shown twice. The `receipt_sent` warning still renders (it carries the tax-adviser sentence) beside a short static "The Foundation's receipt stays with this gift" line.
  5. The aged-fund note ("the moved entry keeps its original date...") is a small static line shown when the server's `aged_public_fund` warning is present on a cross-entity destination, because the server text does not say the date is kept (Phase 1 Gap 7: "say so in the dialog").
  6. The Club register's issuer name uses the entity's short name from `getEntities()` (a receipt marker reading "issued by the Westerville Lions Foundation" was the first render; `AcknowledgmentSummaryRow.entityName` is the full name).
  7. `matched_open_session` and `legacy_reconciled` checklists show the Manage permission line as the cross-entity message (a move needs Manage regardless); `closed_session` shows the reopening line the design specifies.
  8. `moveButtonState` returns an additive `crossEntityOnly: true` flag only for cross-entity-only rows (same-entity results stay exactly `{ kind: "enabled" }`).
- **Copy the Lions Club may want to refine:** the guide subsection, the checklist wording (especially the closing note about the freed bank line, which still awaits the treasurer's real-instance answer, Open Question 4), "Possibly the same deposit" and "Bank accounts change too" headings, the aged-fund note, and the Delete pointer.
- **Reviewer click-through:** Foundation register, income row (current fiscal year) > Move > pick Club account and reason > Confirm > Record sweep now; the Club Activity register's receipt marker and blocked Delete; a Foundation row cleared by a closed session > Move (checklist, Check again); a Club Administrative income row > Move (Foundation denied) and Delete (pointer); both Compliance pages; Treasury guide "Moving a gift from the Foundation to the Club".
- **Pre-existing, unrelated:** a `react-hooks/exhaustive-deps` unused-disable warning in `budget-context-panel.tsx`; a dev-only React `eval()` CSP console error and a logo aspect-ratio warning.

---

## Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Every required check passed: typecheck, 2893 unit tests, production build, lint, migration 0109 idempotency, the diff review against Phase 2 R1-R7 and Phase 3, all eight Phase 3 live checks plus (a)-(h), and the extended e2e spec twice serially (15/15 and 15/15). **One finding needs a ruling before ship (F1):** the match-route race that Phase 3 X4 accepted as a residual produced a Club row matched to a Foundation bank line in **4 of 4** live attempts, and Phase 3's stated backstop ("the close-time tie-out would surface it") is **false** (established below): closing the Foundation session with that orphan returned 200 and silently marked the Club row reconciled against the Foundation session. The design accepted the race itself and told qa to record the outcome rather than assert no-orphan, so this is not a red test; it is a refuted safety claim that raises B-105 from "Soon" to a decision for the orchestrator.

### What I did

**1. Static gates (summary lines verbatim; exit codes captured directly, not through a pipe)**

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, no output |
| `pnpm test` | `Test Files  163 passed (163)` / `Tests  2893 passed (2893)` / `Duration  3.94s` (first pass 162 files / 2888 tests; +1 file / +5 tests are the migration guard I added) |
| `pnpm build:only` | exit 0; `✓ Compiled successfully in 829ms`; `✓ Generating static pages using 15 workers (125/125) in 1893ms`; 271 route rows in the table; no new warnings. Ran on the pre-edit tree with the dev server stopped; the only `src/` change since is my new test file. |
| `pnpm lint` | exit 0; `✖ 1 problem (0 errors, 1 warning)` (the pre-existing unused-disable in `budget-context-panel.tsx:114`, not this feature) |
| `src/lib/admin-page-feature-gates.test.ts` | 167 passed |

**2. Migration 0109.** `pnpm db:migrate` ran twice against `DATABASE_URL` (host `ep-orange-sunset-...`, never `PROD_DATABASE_URL`): both `Migrations completed successfully`, only `NOTICE ... already exists, skipping`. Fingerprint of `ledger_acknowledgments` (3 rows, 3 stamped, md5 of id/donee/updated_at) identical before, after run 1 and after run 2. Pre-push non-idempotent scan (`CREATE TABLE`/`ADD COLUMN`/`INSERT INTO`/`CREATE INDEX` without a guard): no output. Because the dev DB was already migrated, I also proved a **first apply** inside a transaction that dropped the column, ran the file and rolled back: column, FK and a backfill that stamped 3 of 3 rows to their transaction's entity all work; post-rollback fingerprint unchanged. `schema.ts` vs migration: column `donee_entity_id uuid`, nullable, FK to `ledger_entities(id)`, no cascade (`confdeltype = a`, NO ACTION), constraint `ledger_acknowledgments_donee_entity_id_ledger_entities_id_fk` which equals the name drizzle derives (asserted by a unit test reading `getTableConfig`, below). `drizzle-kit push` was not run: it prompts about the unrelated pre-existing `ledger_entities_slug_unique` diff (database-admin's note), so the comparison is by reading plus that test.

**3. Diff review (`git diff HEAD --stat`: 43 modified files, 4563 insertions, 621 deletions at the time of the stat, plus the untracked files listed in Outputs).** Read and confirmed:
- Policy `ledger-fund-move-policy.ts`: exactly two allowed cells (same-entity income administrative to activity; cross-entity income charitable to activity), `club_to_foundation_not_supported` as its own branch, same-entity charitable to activity still `not_permitted`; tests C1-C6 including T3 unchanged, both pinned divergences and the never-allows-the-sweep-cell test.
- Guard order in `ledger-fund-move-queries.ts` (`runMove`): row lock first, row state, stale, destination fund, policy, cross-entity state with **prior fiscal year first** (`crossEntityBlockKind`, X2) then closed session, legacy, and the open-session match read **on `tx`**, tier, then input (`destBankAccountId`, stored-account assertion, category). Every `return fail(...)` precedes the first write.
- **X1:** the acknowledgment settlement (`settleAcknowledgmentForMove`: `FOR UPDATE` select, sent => `coalesce(donee_entity_id, <source entity>)` with a two-key set object, unsent => `DELETE ... AND sent_at IS NULL`) runs **before** the pinned UPDATE; a zero-row UPDATE `throw new StaleMoveRollback()` (not a return), caught only in `executeFundMove` and mapped to 409 `stale`. The audit row is last on the same `tx`.
- Donee stamped from the **locked row's** entity id before the entity changes; `sent_at`, `sent_via`, `letter_text`, `letter_storage_key`, `donor_id` appear in no set object.
- `buildSameEntityMoveSet` has exactly `fundId, categoryId, budgetLineId, updatedAt`; `buildCrossEntityMoveSet` adds `entityId` (from the destination **fund row**) and `bankAccountId`; both key sets pinned (C22) and the cross-entity `where` pinned (C23).
- `destBankAccountId` codes `dest_bank_account_required`, `_invalid`, `_not_allowed`: unit-tested and live (below).
- Audit v2 + version-aware parser (moved accepts 1 and 2, deleted accepts 1 only, every guard degrades to `{ raw }`), reader matching `details.entityId` or `details.destEntityId`, `getLatestFundMove` (plain equality, no jsonb cast).
- `grep` for `doneeEntityId`/`donee_entity_id` writers in non-test code: only `acknowledge/route.ts:306` (the insert) and `ledger-fund-move-ack.ts:94` (the move). Raw-SQL writers to `ledger_acknowledgments`: the 0109 backfill and two historical scripts (see F2).
- Receipt-following readers use the shared `ackDoneeEntityId` fragment (`listGeneratableAcknowledgments`, `listAcknowledgmentsSummary`, `getAcknowledgment`); money readers (`listPendingAcknowledgments`, `listUnlinkedGifts`, `getDonor`, overview/990) still join the transaction's entity.
- No `console.log`, `window.confirm/alert/prompt` in added lines or new files; the only "second approver" text is the guide's negation. Feature gates: see the audit table.

**4. Live checks** (dev `DATABASE_URL` only; dev server killed and restarted fresh first; fixtures tagged "E2E QA Move", donors `example.com`; harness was a throwaway Playwright spec, deleted after the run; observations were captured to a scratch file).

| # | Check | Result | Observed |
|---|---|---|---|
| 1 | Closed-session Foundation row, then real reopen + unmatch + move | PASS | GET: Club Activity denied `reconciled_session`, `unlock.kind closed_session`, session named, later September session listed, `statementMonth 2026-08`. POST 403, row byte-identical, 0 audit rows. Reopen of August refused 409 with `blockingSessionId` = the September session; reopened September then August (`revertedTxnCount 1`). GET then `matched_open_session`, POST 403. Real unmatch DELETE 200. GET allowed; POST 200 with `acknowledgment: "kept"`. Row: Club / Activity / Administrative Checking / unreconciled, no session pointer. Session still `open`, bank line still present and unmatched. Audit `v 2`, `reconciled: false`, `crossEntity: true`. |
| 2a | Match first, then move | PASS | 403 `matched_open_session`, nothing written. |
| 2b | Move first, then match | PASS | Match route refused 400 ("do not belong to this session's bank account"); 0 match rows. |
| 2c | Interleaved (lock held, move queued, match fired queued-before-release, +0, +40, +120 ms after release) | **recorded: orphan 4/4** | Every attempt: move 200 (`acknowledgment: "removed"`), match **201**, final row Club / Administrative Checking **with one match row against the Foundation session**, exactly 1 audit row, ack gone. No half-moved row. See F1. |
| 3 | Six parallel POSTs | PASS | `200:kept` plus five `409:stale`; 1 audit row; 1 acknowledgment; donee = Foundation. |
| 4 | Sent receipt moves | PASS | Ack survives; `sent_at`, `sent_via` (print), `letter_text`, `donor_id` unchanged; `donee_entity_id` NULL to Foundation; `updated_at` advanced. Donors "Sent Acknowledgments" row reads "Westerville Lions Foundation / Activity Fund" for the donor. Club Activity register: "Receipt on file, issued by the Foundationsent Oct 1, 2026". `DELETE` 409 `receipt_sent`, both rows survive. |
| 5 / (b) | Unsent acknowledgment, in the browser | PASS | Dialog: "A receipt record exists for this gift but was never sent..."; success: "The unsent receipt record was removed."; ack row gone; audit `acknowledgment.outcome: "removed"`; the Pending Acknowledgments tab listed the donor before and not after. |
| 6 | Same-entity cannot change the account | PASS | `destBankAccountId` of a Club account, `""`, `"not-a-uuid"`, a Foundation account: all 400 `dest_bank_account_not_allowed`, row and audit unchanged. A **reconciled** Administrative row moved with manage: 200, `entity_id`, `bank_account_id`, `reconciled`, `reconciled_session_id` byte-identical, only fund changed, audit `v 1`. |
| 7 | Sweep deep link | PASS | From the success step: `/admin/ledger/activity?entity=club&sweepFrom=...` (the destination's entity, X7). Sweep form: amount 50.00, from account Administrative Checking, **board minute empty**, memo "Sweep of ... gift moved from the Foundation on 2026-10-01" (equals the audit row's New York date). A never-moved Activity row: "Sweep of <party> gift", no "moved". |
| 8 / (d) | Migration replay | PASS | After check 4's move, `db:migrate` ran: moved row's `donee_entity_id` still Foundation (Foundation-issued receipt, Club-booked row). NULLed the stamp on a **non-moved** Foundation acknowledgment, replayed: re-stamped to its transaction's entity, `updated_at` untouched. |
| (a) | Full treasurer flow in the browser | PASS | Sent-receipt Foundation gift, Move (bank account blank until picked, Confirm disabled until account + reason, both bank accounts' before/after, "Public donations" preselected, no "unchanged" line), success, Record sweep now, recorded the sweep ($50, posts immediately; expense leg Club / Administrative Checking, income leg Foundation / Foundation Checking, both citing the minute), `email_queue` row count unchanged by the flow. Both compliance pages list "Moved, Foundation to Club, Receipt already sent ... Bank account: Foundation Checking to Administrative Checking" with the reason. |
| (c) | Stale / zero-row rollback including the ack change | PASS | Forced the zero-row path **live**: a temporary `BEFORE UPDATE ... RETURN NULL` trigger scoped to two fixture ids (created and dropped inside the test; verified gone). Unsent-ack row: 409 `stale`, **ack row still exists** (the DELETE rolled back). Sent-ack row: 409 `stale`, `donee_entity_id` still NULL and `updated_at` unchanged (the stamp rolled back). 0 audit rows. Also ran the literal procedure (hold `FOR UPDATE`, fire move, change the row's fund in the held tx, release): 409 `stale`, ack untouched, 0 audit rows. Note: with the lock-first design the pinned UPDATE's zero-row branch is unreachable without such a trigger (a held lock blocks every writer), so it is defense in depth; the live proof is the trigger run plus the mutation check below. |
| (e) | Closed-session row, in the browser | PASS | Register shows "Edit / Move / Delete" with Edit and Delete locked and "If the money is in the Club's account, see Move to the Club."; Move opens the checklist ("This entry can't be moved yet", "Before this can move", "hidden from members until you close the session again", "Check again"), no `#move-bank`, no `#move-reason`, no Confirm. Reopened in the workbench UI, unmatched in the UI, Move then showed the form and succeeded (row Club / Administrative Checking / unreconciled). |
| (f) | Match-first vs move-first (X4) | recorded | Match-first: refused 403. Move-first: match refused 400. Interleaved: orphan 4/4 (2c). See F1. |
| (g) | Record-only user (a throwaway user with only the `treasurer` role, created and removed) | PASS | GET 200, `callerCanManage: false`, Club Activity `manage_required` (status 403, tier `manage` reason `cross_entity`), Club Administrative `away_from_public`; POST 403 `manage_required`; row, ack and audit untouched; the register's Move button is **disabled** with title and visible text "Moving an entry to the other entity needs the Manage Ledger permission (held by the Admin role)." A member-only user: 403 on GET and POST for an existing **and** a non-existent id (gate before any row read). Anonymous: 401 on both. |
| (h) | Prior-FY Foundation row (dated 2026-03-15, FY2025) | PASS | No Move button on the register (`&fy=2025`); GET Club Activity denied `prior_fiscal_year_cross_entity`, no `unlock`; POST 403 `prior_fiscal_year_cross_entity` with the designed sentence; row unchanged. |
| 360px | Form, success, checklist | PASS | `dialog.scrollWidth == clientWidth (336)` and `documentElement.scrollWidth == 360` for all three; bank select and reason visible; stacked before/after cards. Screenshots in the session scratchpad `shots/`: `m-form-1of4..4of4.png`, `m-success-1of1.png`, `m-checklist-1of3..3of3.png`. |

Cross-entity `destBankAccountId` codes, live: `null` and absent => 400 `dest_bank_account_required`; a Foundation account, malformed id, unknown uuid => 400 `dest_bank_account_invalid`; a number => 400 `invalid_body`; an extra key => 400 `invalid_body`; a Foundation category on the Club destination => 400 `category_invalid`; row unchanged, 0 audit rows.

**Leave-as-found:** before/after fingerprint of 27 tables (transactions 279, donors 2, acknowledgments 3, sessions 0, matches 0, bank lines 0, audit log 771, roles, role_features, user_roles, email_queue, financial_report_sends, ...) is identical except `users`, whose only change is the e2e admin's `last_login_at` (53 rows before and after; both throwaway users removed). The throwaway users' first sign-in had enqueued two "New portal user needs member record review" notices to `info@`; both were `blocked_non_production` (never delivered) and I deleted exactly those two rows by id window and subject. The temporary trigger and function are gone. No email was sent at any point (`RESEND_API_KEY` is blank, `EMAIL_DEV_ALLOWLIST` unset, and every fixture amount is under the $100 approval threshold).

**5. e2e.** Extended `e2e/ledger-move-transaction.spec.ts` (second describe, 7 new tests) and ran **only that spec**, serially, twice: `15 passed (1.2m)` and `15 passed (1.2m)`. My first two runs failed on a test-authoring bug (typographic apostrophes in the Delete-dialog sentence), fixed before the two clean runs. The full suite was not run, as instructed.

**6. Type check / unit tests / build / e2e tables.** See rows above. Failures: none.

### Regression Tests Added

| Guard | Test | Location | Mutation check (restored byte-for-byte, md5 verified) |
|---|---|---|---|
| Acknowledgment settlement must roll back when the pinned UPDATE matches zero rows (the commit-on-return trap, X1) | "C30: a lost race (zero-row pinned UPDATE) after a settled acknowledgment throws so the transaction rolls back, and is 409 stale" and "when the pinned UPDATE matches no row the transaction ROLLS BACK (sentinel thrown, not returned)..." | `src/lib/ledger-fund-move-queries.test.ts:1242` and `:438`; live proof above (trigger run) | Replacing `throw new StaleMoveRollback()` with `return fail(409, "stale", ...)` fails both (`expected 'committed' to be 'rolled_back'`) |
| Same-entity UPDATE can never carry `bank_account_id` or `entity_id` | "builders: same-entity never carries bankAccountId or entityId; cross-entity carries both" and "a same-entity move's real UPDATE set has exactly the four keys" | `src/lib/ledger-fund-move-queries.test.ts:542` and `:562` (plus the 400 `dest_bank_account_not_allowed` rows in the guard-order table, C24); live check 6 | Adding `bankAccountId` to `buildSameEntityMoveSet` fails 3 tests |
| Migration backfill is NULL-only (a replay must not restamp a moved receipt with the Club) | "should only ever backfill rows whose donee_entity_id IS NULL — regression for a replay restamping a moved receipt with the Club" plus 4 siblings (idempotent ADD COLUMN, SET list is `donee_entity_id` alone, guarded FK under drizzle's derived name, nullable and cascade-free) | **new** `src/lib/ledger-ack-donee-migration.test.ts:24-58`; live check 8 | Changing the backfill `WHERE` to `true` fails the NULL-only test |
| Sweep deep link uses the destination's entity (X7) | "should open the sweep form on the Club's register with the board minute empty — regression for the deep link taking the register's entity slug" | `e2e/ledger-move-transaction.spec.ts:492` | n/a |
| A moved receipt keeps its issuer and blocks delete | "should name the Foundation as the receipt's issuer on the Club register and refuse to delete the moved gift — regression for a moved receipt losing its issuer" | `e2e/ledger-move-transaction.spec.ts:507` | n/a |

Other new e2e tests (same file): `:452` happy path (account required, both accounts, donor and receipt kept), `:524` both compliance pages, `:539` closed-session checklist with the later session first then the form after reopen and unmatch, `:581` mirror sentence and Delete pointer, `:602` 360px.

### Coverage on Critical Modules

- `src/lib/events.ts`: 94.86% statements (target 90%) PASS
- `src/lib/permissions.ts`: 100% (target 100%) PASS
- `src/lib/members.ts`: **36.84% statements (29.41% lines), target 80%: BELOW TARGET.** Pre-existing and not touched by this feature (its branching logic is covered in e2e per the charter, but the 7-day coverage review should own this). Not a cause of this verdict.
- Overall `src/lib` statements: 70.23% (target 70%) PASS, narrowly.
- This feature's modules: `ledger-fund-move-policy` 100, `ledger-fund-move-ack` 100, `ledger-transaction-lock` 100, `ledger-ack-donee` 100, `ledger-correction` 100 stmts / 94.07 branch, `ledger-audit` 100 / 85.56, `ledger-fund-move-queries` 99 / 87.82, `ledger-fund-move-preview` 82.35 stmts / 71.42 branch.

### Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /api/admin/ledger/transactions/[id]/move` | yes (401 anonymous, live) | yes, **before** the uuid check and any row read (403 for a member-only user on both an existing and a non-existent id, live) | `FEATURES.LEDGER_RECORD`; `LEDGER_MANAGE` resolved once as a boolean and enforced **per destination** server-side (per-destination `manage_required`, live) |
| `POST /api/admin/ledger/transactions/[id]/move` | yes | yes, same gate before body parse and any DB read | `LEDGER_RECORD`; every cross-entity move needs `LEDGER_MANAGE` on the **locked row** (403 `manage_required` for the treasurer-only user, live) |
| `POST /api/admin/ledger/transactions/[id]/acknowledge` (changed: stamps `doneeEntityId`) | yes (`:141`, `:379`) | yes (`LEDGER_RECORD`, `:145`, `:383`) | `LEDGER_RECORD`, unchanged |
| `/admin/ledger/[fundSlug]` page (changed) | yes (`:84`) | yes (`hasAnyFeature` over LEDGER_VIEW/RECORD/MANAGE, plus `canRecord`/`canManage` booleans) | unchanged; `admin-page-feature-gates.test.ts` passes |
| Reconciliation reopen / unmatch / close / match routes | not changed by this feature | not changed | not changed |

No new protected route was added; no new `FEATURES` key; no role-binding migration. **Gate: PASS.**

### Findings

**F1 (needs a ruling before ship; established unless marked belief). The X4 match-route race is not a rare, self-announcing residual.**
- *Established:* in four live interleavings (a match fired while the move's lock was still held, and at +0, +40 and +120 ms after release) the move committed and the match then inserted successfully (201), leaving a **Club row on Administrative Checking matched to a Foundation Checking bank line**. A match fired 120 ms after the lock was released still landed, so the window is the duration of the move transaction on this Neon latency, not an instant. There was never a half-moved row and always exactly one audit row.
- *Established:* the consequence is **silent**. Running the real `close` route on that Foundation session returned `200 {status: "closed", clearedCount: 1}` and set the Club row `reconciled = true` against the Foundation session. `close/route.ts` checks that each matched transaction is `posted` and that bank-line amounts tie out; it never checks that a matched transaction's bank account is the session's account (code read plus the live run agree). **Phase 3 X4's statement "the close-time tie-out would surface it" is refuted.** (Reopening that session would revert the row's flag, so it is recoverable once someone notices.)
- *Belief, not measured:* the practical probability is low (two actors on one row within hundreds of milliseconds); I did not measure it.
- *Recommendation for the orchestrator:* decide whether B-105 ships before this feature. The cheapest guard is in the **close** route (re-verify every matched transaction's `bank_account_id` equals the session's account and refuse otherwise), which also closes the same shape for the pre-existing bank-account PATCH; the full fix is the B-105 shape (match insert re-verifies under `FOR SHARE`). Neither is in this increment's scope, so this is a ruling, not a QA fix.

**F2 (minor). `scripts/close-out-historical-acknowledgments.ts` inserts acknowledgments with raw SQL and no `donee_entity_id`.** Safe today (nullable, COALESCE fallback). B-106 (`NOT NULL`) must cover scripts as well as the acknowledge route.

**F3 (minor, unreachable).** `runMove` falls through to the v1 audit shape if `crossEntity` were true while an entity row failed to load, and `settleAcknowledgmentForMove`'s re-read branch could return `kept` with a null `sentAt`; both are unreachable behind the FK and the row lock. Noted, no action.

**F4 (environment).** Treasurer baseline (Open Question 6 / NEW-4), confirmed against this dev DB's role table: `admin` holds `ledger.manage`; `treasurer` holds only `ledger.record`, `ledger.view`, `ledger.report_send`. A successor on the `treasurer` role alone sees Move disabled with the permission message (live check g). The live **production** role table was not read (never `PROD_DATABASE_URL`); a human should confirm the treasurer's account also holds `admin`.

**F5 (tree moved during Phase 5).** Another process modified `package.json` (1.87.0), `CLAUDE.md`, `docs/release-notes/v1.86.md` and created `docs/release-notes/v1.87.md` while I verified. None is source; my final tsc/test/lint (all green) ran after those edits.

### Outputs

- New (mine): `src/lib/ledger-ack-donee-migration.test.ts`, `e2e/helpers/cross-entity-move-fixtures.ts`.
- Modified (mine): `e2e/ledger-move-transaction.spec.ts` (second describe, 7 tests), `e2e/helpers/ledger-fixture-cleanup.ts` (`cleanupMoveTransactionFixtures()` now also removes tagged donors and the fixture sweep legs by memo prefix).
- Throwaway harness (`e2e/zz-qa-live-*`) deleted; copies and raw observations (`live-results.jsonl`), 360px screenshots, build/test/lint/e2e logs and the table fingerprints are in the session scratchpad only.
- Not edited: `docs/decisions.md`, `docs/backlog.md`, any feature source file.
- Dev server: killed and restarted on port 3000 per the ux-developer's note; still running (log `dev.log` in the scratchpad).

### Open questions / handoff notes

- **Next agent: analyst (Phase 6)**, PASS. Re-check list from Phase 3 stands; add: F1 (decide whether B-105 or the close-route account check ships with this; Phase 6 should not treat "the tie-out surfaces it" as true), and the wording rules (verified: no second-approver language except the guide's negation; "Moved" not "Reversed").
- **Orchestrator:** raise B-105 and correct the X4 sentence in the proposed DECISION-113 / B-105 text; file F2 against B-106. `docs/decisions.md` and `docs/backlog.md` were not touched by qa.
- Treasurer-confirm items unchanged (Open Questions 2, 3, and the production role check in F4).
- The 7-day coverage review should pick up `src/lib/members.ts` (36.84%).

---

## Phase 4 (F1 fix) — Implementation (API) — 2026-10-01

**Owner:** api-developer
**Status:** complete

### Summary
Closed the QA finding F1 (B-105 shape plus the close-route belt). The match route now re-verifies, inside its write transaction and after locking the submitted transaction rows `FOR UPDATE`, that each row is still on the session's bank account and still `posted`; on mismatch it returns 409 and writes nothing. The close route now refuses (400) when any matched transaction's bank account differs from the session's, which also catches orphans that already exist. The move route, policy, UI, `docs/decisions.md` and `docs/backlog.md` are untouched.

### What I did
- `match/route.ts`: in `db.transaction`, `select id,status,bank_account_id ... WHERE id IN (...) ORDER BY id FOR UPDATE` (waits for the move's lock; id order for a stable lock order), then re-check account, then status, then insert. Account mismatch: 409 `{code: "transaction_account_mismatch", invalidTransactionIds}`. Not posted or row vanished: 409 `{code: "transaction_not_posted", invalidTransactionIds}`. B-105 proposes no code name, so `transaction_account_mismatch` is used. The earlier unlocked checks and their 400s are unchanged (fast path); the existing 23505 to 409 mapping is unchanged. I did not add a locked `reconciled` re-check (not asked; the unique match key and the existing unlocked check stand).
- `close/route.ts`: the existing defensive status query also selects `bank_account_id`; after the not-posted check, any matched row whose account differs from the session's returns 400 `{code: "transaction_account_mismatch", invalidTransactionIds: [all offenders]}` before the tie-out and before any write.
- Tests: `match/route.test.ts` extended (tx mock gained a recording `select ... for("update")`; default mirrors the unlocked read so every pre-existing happy/ineligible test is unchanged); new `close/route.test.ts` (there was none, so no existing test assumed close skips accounts).

### Outputs
- `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts` (changed), `.../match/route.test.ts` (+5 tests), `.../close/route.ts` (changed), `.../close/route.test.ts` (new, 4 tests).
- Contract: match adds 409 `transaction_account_mismatch` / `transaction_not_posted`; close adds 400 `transaction_account_mismatch`. Gates unchanged (`LEDGER_RECORD`). No schema change, no migration.
- Guarding tests carry the suffix "regression for F1 (match-route race lands a cross-entity row in a Foundation session)": match account-mismatch, match batch-with-one-mismatch, match not-posted-under-lock, close account-mismatch. A PgDialect test asserts the locked select is `FOR UPDATE` with an `id IN (...)` WHERE and the submitted id as the param.

### Gate (verbatim)
- `pnpm exec tsc --noEmit`: no output (clean).
- `pnpm test`: `Test Files  164 passed (164)` / `Tests  2902 passed (2902)` (was 2893).
- `pnpm build:only`: exit 0 (route table printed, `ƒ Proxy (Middleware)`).
- `eslint src/app/api/admin/ledger/reconciliation/sessions`: clean.

### Live reproduction on DATABASE_URL (dev; PROD_DATABASE_URL unset for the run)
Throwaway Playwright spec (deleted), signed in as the e2e admin, fixtures tagged "E2E QA Move" on `example.com`-style fixtures, same method as qa: raw transaction holds the row `FOR UPDATE`, the cross-entity move is fired and waits, the lock is released, the match is fired 0, 100 and 250 ms later against an open Foundation Checking session with an unmatched bank line.

| Offset after release | Move | Match | Match body | Row after | Match rows |
|---|---|---|---|---|---|
| 0 ms | 200 | **409** | `transaction_account_mismatch` | Club / Administrative Checking | 0 |
| 100 ms | 200 | **409** | `transaction_account_mismatch` | Club / Administrative Checking | 0 |
| 250 ms | 200 | **409** | `transaction_account_mismatch` | Club / Administrative Checking | 0 |

Before the fix these interleavings gave 201 and an orphan 4 of 4 (qa, 2c). Pre-existing orphan: a Club Administrative Checking row matched by direct SQL into an open Foundation session; `POST .../close` returned **400** `transaction_account_mismatch` with `invalidTransactionIds` naming that row, and the row stayed `reconciled = false`. Cleanup: `cleanupMoveTransactionFixtures()` run in the spec; afterwards 0 fixture transactions, 0 fixture sessions, 0 fixture donors.

### Open questions / handoff notes
- Next agent: analyst (Phase 6). The Phase 3 X4 sentence "the close-time tie-out would surface it" remains false as written in the design text, but the behavior it relied on now exists (close refuses an off-account match). The orchestrator closes B-105 and corrects X4 in DECISION-113.
- The bank-account PATCH read-then-write shape named in B-105 is covered at close time by the new belt, not at PATCH time; the match route's locked check covers the match side only.
- The 250 ms attempt is not independently proven to have raced inside the move window; the 0 and 100 ms ones match qa's reproduced orphans.

---

## Phase 6 — Shipped vs Intent — 2026-10-01

**Owner:** analyst
**Status:** complete

### Verdict

**SHIP WITH NOTES.** Nothing here has to change in code before this ships. Two documentation edits are needed before the push (the release notes omit the F1 reconciliation change; DECISION-112 still carries a sentence that QA refuted). The remaining notes become tracked follow-ups.

### One-line take

> The treasurer can now move a Foundation-booked gift that landed in the Club's account to the Club's Activity Fund through the web UI, with the donor and the already-sent receipt kept and still naming the Foundation, a guided checklist (not automation) when a reconciliation session holds the row, and one audit row that both entities' Compliance pages show. The one hole QA found (F1) is closed and live-verified.

### Verification I did myself (not taken from QA's word)

- `pnpm exec tsc --noEmit`: exit 0. `pnpm test`: 164 files, 2902 tests pass (the post-F1 count).
- Read the shipped code, not just the work-log: `ledger-fund-move-policy.ts`, `ledger-fund-move-queries.ts` (`evaluateDestination`, `buildSameEntityMoveSet` / `buildCrossEntityMoveSet`, `runMove`), `ledger-fund-move-ack.ts`, `ledger-ack-donee.ts`, migration `0109`, the diff of `ledger-audit.ts`, the move, acknowledge, match and close routes, the register page, `transaction-move-eligibility.ts`, `transaction-actions.tsx`, the Delete dialog, `recent-corrections.tsx`, `move-unlock-checklist.tsx`, the guide diff, `docs/release-notes/v1.87.md`, the v1.86 forward pointer, and the CLAUDE.md "Ledger corrections" paragraph.
- Confirmed in `isMonthGatedForEntity()` that every income row is excluded from the member-statement gate (`isUnclearedDepositRow` is `flow === "income"`), so the release-note sentence "Moving the gift itself does not change which months are ready to send" is true. Reopening a session is what hides months (it un-reconciles expense rows too), and the checklist says so.
- Grepped every added line and new file for personal email addresses, phone numbers, `console.log`, native dialogs, "second approver" (only the guide's negation), "Reversed", "Voided", "Delivered": none. The only `rounded-full` uses are status chips and badges, not buttons.

### What's working

- **The treasurer's case works end to end, in the browser, without SQL.** QA's live check (a) walked a sent-receipt Foundation gift: Move, bank account blank until picked, Confirm disabled until account and reason, both accounts' before and after, no false "bank balance unchanged" line, success step, **Record sweep now** with the board minute empty and a memo that says "moved from the Foundation" with the audit row's New York date, then the recorded sweep. No email was queued.
- **"Keep the receipt" is real, not nominal.** The acknowledgment keeps `sent_at`, `sent_via`, `letter_text` and `donor_id`; `donee_entity_id` is stamped from the locked row's entity before the entity changes; the Donors page still names the Foundation; the Club Activity register shows "Receipt on file, issued by the Foundation"; Delete of the moved row is refused 409 `receipt_sent`. This was the one real defect risk in Phase 1 (Gap 1) and the architect's R1 reshaped it correctly.
- **The commit-on-return trap was caught and proven.** Tech-lead X1 (settle the acknowledgment, then the pinned UPDATE, throw a sentinel on zero rows) is implemented as designed, mutation-checked by QA, and exercised live with a trigger that forces the zero-row path (the unsent acknowledgment survives, the sent one is not stamped, zero audit rows).
- **The checklist guides and does not automate.** It names the closed session, lists later closed sessions newest first, says the freed bank line needs its right entry before re-close, and says reopening can hide the Foundation's monthly statements from members "from that month onward ... until you close the session again". QA ran the whole sequence for real (reopen newest first, unmatch, move) and it worked.
- **F1 is closed at both ends.** The match route now re-verifies account and posted status under `FOR UPDATE` in its write transaction (409 `transaction_account_mismatch`, `transaction_not_posted`); the close route refuses (400) when any matched row's account differs from the session's, which also catches orphans that already exist. The api-developer reproduced the exact interleavings QA used (0, 100, 250 ms) and each is now a 409 with zero match rows; a pre-existing orphan makes close return 400 with the row named. The toast on the close button shows the server's message, so the treasurer sees why.
- **The two policy surfaces stayed separate and the safety test still means something.** Exactly two allowed cells, the sweep's cell denied as `club_to_foundation_not_supported`, same-entity Charitable to Activity still `not_permitted`, T3 unchanged and green.

### Intent-vs-shipped diff

| # | Phase 1 / Phase 2 / Phase 3 said | Shipped | Verdict |
|---|---|---|---|
| 1 | One new cell: income, Foundation Charitable to Club Activity; every other cross pair denied, each with its own code | `checkFundMove` has exactly two allowed cells; Administrative-to-Charitable and Activity-to-Charitable are `club_to_foundation_not_supported`; Charitable-to-Administrative is `away_from_public` with cross-entity wording; expense stays `cross_entity` | matches |
| 2 | `LEDGER_MANAGE` for every cross-entity move, per destination, server-side on the locked row; not a second approver | `requiredMoveTier(row, now, { crossEntity })`; per-destination `manage_required` as a 200 denial; record-only user live: GET 200 with `callerCanManage: false`, POST 403, Move button disabled with the permission sentence; no new key | matches |
| 3 | No reconciled carve-out | Closed-session, legacy-reconciled, open-session-matched and prior-FY rows refused; the pinned UPDATE also carries `reconciled = false AND reconciled_session_id IS NULL`; same-entity reconciled carve-out untouched (live check 6: only `fund_id` changed) | matches |
| 4 | Guided checklist for a closed-session row, with the statement-hiding wording | `MoveUnlockChecklist`; "hidden from members until you close the session again"; later sessions newest first (X8); "Check again" | matches (X9 wording "from that month onward" adopted) |
| 5 | Donee entity stamped, receipt-following readers migrated | Nullable write-once FK, NULL-only backfill, one shared fragment; letter composition, acknowledgment summary and detail follow the receipt; pending/unlinked queues and all money readers follow the row; Club register marker added | matches |
| 6 | Sent acknowledgment kept; unsent deleted; settlement before the pinned UPDATE | `settleAcknowledgmentForMove`; throw-to-rollback; live trigger test | matches |
| 7 | Audit v2, both entities, reader under both entities | v2 payload, version-aware parser (moved accepts 1 and 2, deleted 1 only, anything else degrades to raw), reader matches `entityId` or `destEntityId`; both Compliance pages show "Foundation to Club" and "Receipt already sent" (live) | matches |
| 8 | `destBankAccountId` required cross-entity; distinct 400 codes; 400 on same-entity | `dest_bank_account_required`, `_invalid`, `_not_allowed`; no preselect unless exactly one active account; live-verified including a Foundation account on a Club destination | matches |
| 9 | Mirror is denied with a pointer, not a move | Policy branch plus a static Delete-dialog sentence on Club income rows and a guide paragraph; no free-text heuristic; the sentence names no account (X5) | matches |
| 10 | Prior fiscal year refused (Open Question 3); Phase 1 did not say to hide the button | Refused with its own code **and** the Move button omitted on prior-year Foundation rows (X10) | acceptable drift, see N1 |
| 11 | Guard order policy, state, tier, input; GET and POST parity | Implemented and tested; parity exceptions named (`dest_no_active_bank_account` GET-only, input codes POST-only); top-level `tier` and `warnings` removed (X3) | matches |
| 12 | Duplicate-candidate advisory (cut-able) | Shipped: same amount, income, posted, 30 days, cap 5, advisory; the guide and release notes say a bundled deposit is invisible; B-107 carries the residual | matches |
| 13 | Sweep memo generalized and dated from the audit row | `getLatestFundMove()` + `buildSweepMemo()`; the success link uses the destination's `entitySlug` (X7); never-moved rows get no "moved" wording | matches (also closes B-102) |
| 14 | Foundation register Move button reappears; closed-session rows keep an enabled Move and a "see Move to the Club" hint; no destination or no active Club account omits the button | `moveButtonState` over every entity's funds; `crossEntityOnly` hint; omitted when the destination entity has no active bank account | matches |
| 15 | F1 (match-route race) | Closed (see above) | matches, and better than Phase 3 X4 accepted |

### Edge cases

| Case | Result |
|---|---|
| Empty state (no legal destination, Club has no active bank account, no acknowledgment, no duplicates) | pass. Button omitted or disabled by rule; checklist and denied list render with a Close button and no dead Confirm; duplicates section simply absent. One soft spot: an omitted button explains nothing (N1). |
| Failure microcopy | pass. 400s inline, 403/404/409 sentences, 500 "Could not move this entry. Nothing was changed." (stale tab: "This entry changed while you were looking at it."); the close and match refusals carry human sentences |
| Permission gate | pass. Anonymous 401, member-only 403 on an existing and a non-existent id, record-only user 403 `manage_required`; no new route; `admin-page-feature-gates` green |
| Mobile (360px) | pass. QA measured no dialog or page horizontal overflow on the form, success step and checklist |
| Brand | pass. `rounded-2xl` cards, `rounded-lg` buttons, `rounded-full` only on chips, no destructive red on a move, shadcn `Dialog`, 44px targets |
| OAuth vs password, `/access-pending`, email, Google Group sync | not applicable (no email queued, verified; no durable claim written; `sent_at` never touched) |
| Concurrency | pass. Six parallel POSTs gave one 200 and five 409 `stale`, one audit row; match-first refused 403; move-first refused 400; interleaved now 409 |

### Rulings on QA's smaller items and the api-developer's F1 caveats

1. **`members.ts` coverage (36.84%).** Not this feature's, not a ship condition. It is already B-52 and has been flagged in every coverage review since 2026-05. No new item; the 7-day coverage review should keep it on its list rather than QA restating it per feature.
2. **`close-out-historical-acknowledgments.ts` writes no donee.** Acceptable: the column is nullable and the COALESCE fallback gives the right answer for a row that has never moved, and the script is a one-off historical close-out. But B-106's "assert every acknowledgment writer sets it" would pass a test that only greps the route, so B-106 must say "including `scripts/` and raw SQL". Proposed amendment below; no code change now.
3. **Treasurer role lacks `ledger.manage` in the dev role table.** Not a ship blocker, and it fails safe: a `treasurer`-only successor sees a disabled Move with a plain permission sentence, and nothing is writable. It is a real gap against the larger goal ("next year's treasurer never needs SQL"), and this feature is now the second concrete example for B-111. It also still needs one human check on production (is the current treasurer also an `admin`?), which QA correctly did not do with `PROD_DATABASE_URL`. Proposed B-111 amendment below.
4. **F1, the 250 ms attempt is unproven.** Accept. The fix does not depend on timing: the match transaction takes `FOR UPDATE` on the same row the move holds, so a match either locks first (the move sees an open-session match and refuses) or locks after the commit (it sees the new account and returns 409). The 0 and 100 ms attempts reproduced QA's four orphans before the fix, so the interleaving was real, and unit tests pin the `FOR UPDATE ... id IN (...)` select. No further proof needed.
5. **F1, the bank-account PATCH read-then-write is covered only at close.** Accept as a stated residual. It cannot corrupt a reconciliation silently any more (close refuses with the offending ids and the toast shows why), and it needs the same two-admins-one-row coincidence. File it as a low-priority follow-up so it is tracked, not forgotten. One small nit with it: the close toast shows the server's sentence but not which entries; the ids are in the body.
6. **The wrong sentence is in DECISION-112, not DECISION-113.** I read DECISION-113 items 1 to 9 and none contains it. The refuted claim ("the close-time tie-out would surface it") is in DECISION-112's "Residual risk, stated plainly" paragraph (`docs/decisions.md` around line 146), and the same clause sits in the B-105 body in `docs/backlog.md` (B-105 is already ticked with a "Picked up" note, so it is only the original body that is now wrong). Replacement text:

   > **Replace** "A second residual: `match/route.ts` reads a transaction's bank account without a lock and inserts afterwards, so a match request whose read lands inside a move's transaction can leave a Club row matched to a Foundation bank line (B-105); the close-time tie-out would surface it."
   >
   > **with** "A second residual, found by QA and closed in the same release (B-105): `match/route.ts` read a transaction's bank account without a lock and inserted afterwards, so a match request whose read landed inside a move's transaction could leave a Club row matched to a Foundation bank line, and the close-time tie-out did **not** surface it (close checked amounts and posted status, never the matched row's bank account; QA reproduced the orphan 4 of 4 and a clean 200 close). The match route now re-verifies each row's account and status under `FOR UPDATE` in its write transaction (409 `transaction_account_mismatch` or `transaction_not_posted`), and the close route refuses (400 `transaction_account_mismatch`) when any matched transaction's account differs from the session's. The bank-account PATCH's read-then-write is covered only by the close-time refusal."

   One-line form for the B-105 body: replace "and the Foundation session's close-time tie-out would surface it" with "and, contrary to this item's first draft, the close-time tie-out did not surface it (fixed in v1.87.0, see below)". Optional: add one line to DECISION-113 recording the two reconciliation guards, since it is the implementation decision record.

### Release notes and CLAUDE.md check

- **v1.87 says what Phase 1 promised.** It names the gift's donor and receipt staying, an unsent receipt record being removed, the checklist and the member-statement effect, "Then sweep" with the minute still the treasurer's, the duplicate warning and its bundled-deposit blind spot, both Compliance pages, who can do it ("a permission level, not a second approver"), the prior-fiscal-year refusal, the one-way ratchet, the tax-adviser sentence, "Reconcile the Club side", the totals shift, and the mirror as delete and re-enter. It says "Moved", never "Reversed".
- **It does not promise un-gating.** It states the opposite (reopening hides statements; moving the gift itself changes no month's readiness, which I verified is true for income rows).
- **It does not promise a Club-issued receipt.** It says the receipt "still names the Foundation as the issuer", the Club register marks it "issued by the Foundation", and "the ledger does not decide" whether that is still the right document. It also keeps "The Foundation side of a sweep still has no donor and no acknowledgment letter."
- **Gap, apply before the push (P1).** The release notes do not mention that the reconciliation match route now refuses a transaction whose bank account is not the session's (409) and the close route refuses to close a session holding such a match (400). That is a user-visible change to the treasurer's core reconcile flow. Add under **Fixes**:
  > - Reconciliation now double-checks the bank account. Matching a bank line to an entry that belongs to a different bank account is refused (even if the entry was moved a moment earlier), and a session that already holds such a match cannot be closed until the match is removed. This closes a race that could otherwise have let a moved entry be cleared against the wrong account's statement.
- **Wording nit (P2).** "Record sweep now no longer shows the wrong date after about 8 pm Eastern" is about the memo text (the form has no date prefill); say "the memo". Optional.
- **CLAUDE.md paragraph is accurate**, with two small edits (P1/P2): add one sentence that the reconciliation **match** route re-verifies account and posted status under `FOR UPDATE` and the **close** route refuses a matched row on another account (B-105), because a future reader needs to know why those two routes read bank accounts; and point the mirror at **B-104** (the move-shaped follow-up) alongside B-96.

### Follow-ups (SHIP WITH NOTES): each gets its own work-log entry and a backlog item

Proposed as "B-next"; the orchestrator assigns IDs (highest today is B-125). I did not edit `docs/backlog.md` or `docs/decisions.md`.

- **B-next-1 (Soon, the real risk to the larger goal). Prior-fiscal-year cross-entity move has no web path.** The cell is refused with `prior_fiscal_year_cross_entity`, the Move button is omitted on prior-year Foundation rows (X10), and the guide and release notes say so but give the treasurer **nothing to do instead**. A June gift found at the July reconciliation is already "prior fiscal year", which is exactly the shape of the case that prompted this feature, and a receipted gift cannot be deleted (409 `receipt_sent`), so the fallback today is SQL. The orchestrator flagged this to the treasurer and it is a defensible v1 default; it must not stay silent. Two parts: (a) **now, cheap:** show Move as a disabled button with the reason ("Gifts from an earlier fiscal year cannot be moved to the Club yet; ask the board") instead of omitting it, and add one guide sentence naming the interim path; (b) **after the treasurer answers Open Question 3:** either allow it under `LEDGER_MANAGE` with a stronger warning (it restates two entities' totals for a closed year, which feeds each entity's filed return) or specify the supported correction (for example a dated refund entry plus re-entry) so it is a documented web procedure.
- **B-next-2 (amend B-111; plus a one-time human check). Treasurer permission baseline.** Add to B-111: cross-entity Move, and the Reopen step its checklist depends on, both need `ledger.manage`, so a successor on the `treasurer` role alone can read the checklist but cannot act on it. Someone with production access should confirm the current treasurer's account also holds `admin` (QA only read the dev role table).
- **B-next-3 (amend B-106). Issuer column tightening must cover scripts.** Add: "enumerate every writer of `ledger_acknowledgments`, including `scripts/*.ts` and raw SQL (today `scripts/close-out-historical-acknowledgments.ts` inserts without `donee_entity_id`), and either stamp it or delete the script, before setting `NOT NULL`."
- **B-next-4 (Later, low). Bank-account PATCH re-verifies "not matched" under a lock**, closing the last read-then-write against reconciliation (the close-time refusal is the current backstop). Optional with it: make the close refusal toast list the offending entries, not only the message.
- **No new item:** `members.ts` coverage is B-52.

### Pre-push checklist (not follow-ups)

1. Add the **Fixes** bullet above to `docs/release-notes/v1.87.md`.
2. Replace the refuted sentence in DECISION-112 and the clause in the B-105 body (text above).
3. Optional wording: the sweep "date" nit; the CLAUDE.md B-105 sentence and the B-104 pointer.

### Summary

The treasurer's driving case is now doable in the web UI: the gift moves with its donor and sent receipt (still issued by the Foundation, and findable on the Club register), the closed-session case is a guided checklist, the move is audited under both entities, and the sweep that follows is one click from the success screen. All Phase 1 gaps and the architect's R1 to R7 and tech-lead's X1 to X13 are addressed in code, in an explicit deferral, or in a tracked backlog item. QA's F1 is closed with a lock at the match route and a refusal at close, both live-verified. What remains is documentation accuracy and one honest limitation: a prior-fiscal-year gift still has no web path.

### What I did

- Re-read Phases 1 to 5 and the F1 fix subsection in full; read the shipped code and docs listed above; re-ran `tsc` and the unit suite; checked the member-statement gate rule against the release-note claim; grepped the whole diff for banned content.
- Ruled on QA's four minor items and the three F1 caveats, located the wrong sentence (DECISION-112, not DECISION-113) and wrote the replacement text.
- Wrote this section and set the status table. No code, `docs/decisions.md` or `docs/backlog.md` edits.

### Outputs

- `docs/work-log/2026-10-01-cross-entity-transaction-move.md` (status table row 6 and this section)

### Open questions / handoff notes

- **Orchestrator:** apply the two pre-push doc edits; assign IDs to B-next-1 to B-next-4 and add the B-111 and B-106 amendments; B-next-1 needs the treasurer's answer to Open Question 3 for its second half.
- **Treasurer:** Open Question 3 (prior-year gifts), Open Question 2 (confirm the tax-adviser sentence is the right advice), and whether your own production account holds `admin`.
- No further pipeline phase is open once the pre-push edits land; each follow-up above is its own work-log entry when picked up.

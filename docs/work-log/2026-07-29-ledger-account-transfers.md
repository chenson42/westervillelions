# Account-to-Account Transfers + Cross-Entity Sweep (Deny-by-Default Allow-List) — Work Log

> **Slug:** `2026-07-29-ledger-account-transfers`
> **Surface:** (dashboard) admin — The Ledger transaction form (`src/app/api/admin/ledger/transactions/route.ts` `handleTransfer`, and its client form in the fund register)
> **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) covers routine same-entity/same-fund-family transfers; recommend the *existing* over-threshold pending→`ledger.approve` path be extended to transfer/sweep legs (currently hard-coded to bypass it — see Gaps); cross-entity/public sweeps require a mandatory board-minute reference string regardless of amount (new validation, no new `FEATURES` key)
> **Estimated complexity:** medium–large
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-29 |
| 2 — Architectural review | architect | Complete (folded) | Approved with reason | 2026-07-29 |
| 3 — Technical design | tech-lead | Complete | Design complete — implementer named | 2026-07-29 |
| 4 — Implementation (API) | api-developer | Complete | complete | 2026-07-29 |
| 4 — Implementation (UI) | ux-developer | Complete | complete | 2026-07-29 |
| 5 — Verification | qa | Complete | FAIL → fixed → RE-VERIFIED PASS | 2026-07-29 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-29 |

---

# Phase 1 — Functional Refinement (analyst)

## Open Questions — RESOLVED (Chris via deny-by-default directive, 2026-07-29)

Chris instruction: proceed to the end using **deny-by-default**; only explicitly-sanctioned directions are enabled; flag every defaulted call for Phase 6 override.

1. **Directional matrix (final):**
   - ✅ **Club Activity → Foundation** (the sweep) — mandatory board-minute regardless of amount.
   - ✅ **Club Admin Checking ↔ Petty Cash** (same fund, different account) — intra-club cash mgmt; `ledger.record` only, no board-minute. Narrow the no-op guard from `sourceFund === destFund` to `sourceFund === destFund AND sourceAccount === destAccount`. **This is the sanctioned way to fund Petty Cash** (Petty Cash is $0 today because no cross-account move exists).
   - ❌ **Club Activity → Administrative** — BLOCK (hard, pre-insert).
   - ❌ **Foundation → Club (any fund)** — BLOCK (one-way valve).
   - ❌ **Club Administrative → Activity** — BLOCK (deny-by-default; analyst agreed).
   - ❌ **Club Administrative → Foundation** — BLOCK for now (deny-by-default). Analyst recommended ALLOW as "Donate to Foundation"; **flagged for Chris's Phase 6 override**, not enabled in this increment.
2. **Over-threshold approval gate → ADOPT.** Transfers/sweeps over the disbursement-approval threshold route to `pending`/`ledger.approve` like ordinary expenses — closing the always-post self-targeting hole rather than inheriting it. Small cases ($84.52 sweep, Petty Cash float) are under threshold, unaffected.
3. **Foundation-side sweep leg IS categorized** (real charitable income for 990), default **"Public donations"**; treasurer may pick another Foundation income category. Same-entity transfer legs stay categoryless (as today).
4. **Naming:** same-entity = **"Transfer"**; cross-entity = **"Sweep"** — framed as two linked-but-independent transactions on two separate books, never one atomic reversible entry.
5. **Pre-block legacy-violation check → DONE (2026-07-29).** Live query on the app DB branch: **zero transfer pairs of any kind exist** — no Activity→Administrative (or any) legacy violations. Hard block ships clean.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer moves money between two bank accounts (same fund, same entity — e.g. Admin Checking ↔ Petty Cash) or sweeps publicly-raised money from the Club's Activity Fund to the Foundation (e.g. the $84.52 T-04 cleanup), under a deny-by-default directional allow-list that makes the Activity→Administrative and Foundation→Club-in-any-direction firewalls structural rather than advisory — but today's code cannot represent either target flow at all (cross-entity is hard-rejected, both legs are forced onto one `bankAccountId`), and today's transfer path also has a live self-targeting gap (transfers always post immediately, bypassing the disbursement-approval threshold that ordinary expenses of the same size must clear).

## Verified Against the Code (Pass 0)

- `handleTransfer` (`src/app/api/admin/ledger/transactions/route.ts:363-473`) confirmed exactly as briefed:
  - **Cross-entity is rejected implicitly, not explicitly.** The fund lookup is `WHERE ledgerFunds.entityId = entityId` (line 406-414), then both `sourceFundId`/`destFundId` are matched against that single-entity result set. A cross-entity `destFundId` simply isn't found → `400 "Destination fund not found or does not belong to the specified entity"`. There's no explicit cross-entity branch to relax — the query itself needs to change shape.
  - **One `bankAccountId` forced onto both legs** (lines 437-438, 452, 465) — confirmed.
  - **`sourceFundId === destFundId` is a hard 400** ("Cannot transfer a fund to itself", line 379-381) — this blocks the Admin Checking ↔ Petty Cash case entirely today, since that's the *same* fund (Administrative) moving between two bank accounts, not two funds.
  - **Transfers always post immediately, no exceptions** — confirmed via the *normal* transaction path's own comment at line 295-301: `"inc2: expense over disbApprovalThresholdCents → 'pending'; transfers always 'posted'."` This is a real gap, not a documentation error (see Adversarial Pass).
  - **No `categoryId` on either leg** — `handleTransfer` never reads or sets one. Both rows post with a null category.
- Fund/entity/account state confirmed live (Neon `tiny-fog-13725730`, default branch):
  - Club (`Westerville Lions Club`): funds **Activity** (`kind='activity'`, opening $0) and **Administrative** (`kind='administrative'`, opening $19,340.10). Bank accounts: **Administrative Checking** (checking) and **Petty Cash** (cash type) — both belong to the Club entity; **Petty Cash is a bank account, not a fund.** There is no separate "Petty Cash fund."
  - Foundation (`Westerville Lions Foundation`): fund **Charitable** (`kind='charitable'`, opening $28,569.30). Bank account: **Foundation Checking**.
  - `src/lib/ledger.ts` guardrail types already anticipate a fourth public-fund kind, `'scholarship'` (aged-public-fund check, line ~960), though no such fund exists yet in either entity. Noted for forward-compatibility, not acted on.
- **A firewall guardrail for Activity→Administrative already exists, at WARN severity, after the fact:** `firewallViolations` (`src/lib/ledger.ts:920-925`) — *"Count of distinct transferGroupId values where one row's fund has kind='activity' and the paired row's fund has kind='administrative' — Activity→Admin firewall."* This feature's job is to turn that from a post-hoc WARN into a pre-insert hard block for new rows. The WARN stays alive for any pre-existing historical violations (T-04's own $84.52, before it's swept, doesn't trip this one — it was booked to Activity, not transferred there from Administrative — but if it ever had been, this is the check that would have caught it).
- **`boardMinute` already exists as a column and as a pattern**, just not on the transfer path: `ledgerTransactions.boardMinute` (schema.ts:689) is set today via two *existing*, separately-gated actions — `PATCH .../transactions/[id]/approve` (gate: `LEDGER_APPROVE`, requires non-blank `boardMinute` ≤ 500 chars) and the reimbursement-approval route (same shape). The sweep's board-minute requirement should reuse this exact validation shape (trim, cap, required, 400 if blank) rather than invent a new one.
- **Reconciliation candidate query needs no change.** `getCandidateTransactionsForMatching(bankAccountId)` (`src/lib/reconciliation-queries.ts:342-372`) filters *only* on `bankAccountId`, `status='posted'`, `reconciled=false`, and "no existing match row" — it has zero awareness of `fundId`, `entityId`, or `transferGroupId`. The moment each leg of a transfer carries its own real `bankAccountId` (this feature's #1 requirement), each leg automatically becomes an ordinary, independent reconciliation candidate against its own account's bank statement — confirmed by reading the query, no code change needed there. This directly answers the brief's reconciliation question.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin (Treasurer/Admin, `ledger.record`) | Selects "Transfer" or "Sweep" on the transaction form, picks a source fund + bank account and a destination fund + bank account | On demand |
| admin | Enters amount, date, memo | Per transfer |
| admin | Enters a **board-minute reference** (mandatory when the move is cross-entity or Activity-fund-sourced; optional/absent for a routine Admin↔Petty-Cash cash move) | Per cross-entity/public sweep |
| admin (`ledger.approve`) | Approves a pending sweep/transfer that exceeds the disbursement threshold, same Approvals screen used for large expenses today | On demand, only for over-threshold moves (recommended — see Gaps) |
| admin (`ledger.record`, any role) | Views the resulting two rows in each fund's register, each carrying its own `bankAccountId` | Per transfer, ongoing |
| admin | Matches each leg independently during that leg's own bank account's reconciliation session | Per reconciliation session |

The request is verb-shaped and surface-correct throughout — every verb belongs to admin, gated by `ledger.record` (this codebase has no other surface where fund transfers make sense).

## Flows

**Flow 1 — Routine intra-fund cash movement (Admin Checking ↔ Petty Cash):**
Entry: treasurer on the transaction form → selects the **same fund** (Administrative) as both source and destination, but a **different bank account** per leg → enters amount/date/memo → submits.
- Outcome: two posted rows, same `fundId`, same `entityId`, different `bankAccountId`, linked by `transferGroupId`; net effect on the Administrative fund's balance is zero (an expense leg and an income leg of equal size cancel), but each bank account's ledger correctly shows the cash arriving/leaving. Each leg reconciles independently against its own account's statement.
- Failure: same fund AND same bank account on both sides → 400 "Select a different bank account, or transfer to a different fund." (a true no-op, distinct from today's blanket "cannot transfer a fund to itself," which currently also blocks this legitimate case).

**Flow 2 — Undecided fund-to-fund, same entity (Admin ↔ Activity, either direction):**
Entry: same form, source/dest funds differ but both belong to Club.
- Outcome (per direction, see Matrix below): either blocked outright with a specific reason, or posted like any other same-entity transfer today.
- Failure: blocked direction → 400 with the specific policy reason (not a generic "not allowed") — e.g. "Activity Fund is public-facing pass-through money; it cannot be used to fund Club operations. See Activity Fund policy."

**Flow 3 — Cross-entity sweep (Club Activity → Foundation Charitable, the $84.52 case):**
Entry: treasurer selects Club Activity as source, Foundation Charitable as destination, picks the Foundation's bank account for the destination leg (Club's for the source leg) → **must** enter a board-minute reference (non-blank, trimmed, capped — same shape as the existing approve-route field) → submits.
- Outcome: two independently-posted transactions — a Club-side Activity Fund expense and a Foundation-side Charitable Fund income, each citing the same board-minute text, linked by `transferGroupId` for UI discoverability but each governed by its own entity's books, guardrails, and reconciliation. If the amount exceeds the existing disbursement-approval threshold, the source (expense) leg is created `status='pending'` and requires an `ledger.approve` holder's sign-off before it posts — **recommended**, not yet true of transfers today (see Gaps).
- Failure: missing board-minute → 400 "A board-minute reference is required for a cross-entity sweep." Destination fund not `charitable` (i.e., anything but the one allowed direction) → 400 with the specific blocked-direction reason. Foundation→Club attempted in either direction → 400 "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy."

**Flow 4 — Reconciling each leg:**
Entry: treasurer opens the reconciliation session for a bank account that has a transfer/sweep leg posted against it (already covered by the existing, unmodified `getCandidateTransactionsForMatching`) → matches the leg to its real bank statement line, same as any other transaction.
- Outcome: unchanged existing flow.
- Failure: unchanged existing reconciliation failure paths.

## Permissions

- **`ledger.record` (`FEATURES.LEDGER_RECORD`)** remains the baseline gate for recording any transfer or sweep — consistent with every other write on this route today. No new `FEATURES` key needed for "can this user attempt a transfer."
- **Board-minute requirement** is a *validation* rule (400 if blank), not a separate permission — it's enforced the same way `boardMinute` is already enforced on the approve-route and budget-approvals route: required string, trimmed, capped, checked in the handler body. Applies whenever the move is cross-entity, or has the Club Activity Fund as either leg (i.e., touches public money), regardless of amount.
- **Recommend (does not block Phase 2, but flag to tech-lead): reuse `ledger.approve` via the existing pending-disbursement mechanism for over-threshold transfers/sweeps.** Today "transfers always posted" is a blanket bypass of the disbursement-approval threshold that every ordinary expense of the same size must clear (confirmed in code, see above) — this is a real gap this feature should close, not preserve, especially now that a "transfer" can move money permanently out of the Club's control (the Foundation sweep). Concretely: treat the *expense* leg of a transfer/sweep exactly like an ordinary expense for the purpose of `derivedStatus` — if `amountCents > settings.disbApprovalThresholdCents`, both legs post as `status='pending'` and require a `ledger.approve` holder to approve (stamping `boardMinute`, `approvedAt`, `approvedByUserId` on both, reusing the existing approve-route shape) before either is live. Below threshold, `ledger.record` alone is sufficient, same as today.
- **Default roles:** whichever roles currently hold `LEDGER_RECORD` (Treasurer, Admin) can record transfers/sweeps; whichever hold `LEDGER_APPROVE` (Board-level roles) approve the over-threshold ones. No new role bindings, no new migration for permissions — only the validation and status-derivation logic changes.

## The Directional Allow-List Matrix (load-bearing deliverable)

Nodes are **funds**, since the allow/block policy is about fund character (public/pass-through vs. operating vs. charitable), not about which bank account happens to hold the cash. Bank-account selection is an orthogonal, per-leg field available on every allowed cell.

| From ↓ / To → | Club: Activity | Club: Administrative | Foundation: Charitable |
|---|---|---|---|
| **Club: Activity** | *(self — see Account-Transfer rule below; Activity has only one bank account today, so no live case, but the rule should still be schema-driven, not name-hardcoded)* | **BLOCKED.** Public/pass-through money funding Club operations defeats the reason the Activity Fund exists (reference note: "may only be spent on public/service purposes — never club operations"). This is the *exact* direction the existing `firewallViolations` WARN already flags after the fact (`src/lib/ledger.ts:920-925`) — this feature makes it a pre-insert hard block instead of a post-hoc warning. | **ALLOWED** (locked requirement — this is the $84.52 sweep). Requires mandatory board-minute reference regardless of amount; each leg gets its own bank account. |
| **Club: Administrative** | **UNDECIDED — recommend BLOCKED**, same rationale as the row above, mirrored: the Activity Fund's income should only ever be *publicly-raised* money (event cash, donations, Square receipts) so its own guardrails (direct-to-admin WARN, aged-public-fund WARN) keep meaning what they say. If Administrative money is allowed to flow *into* Activity, then a later Activity→Foundation sweep would launder club-operating (dues) money through the "public pass-through" fund, muddying the audit trail the guardrails exist to police. If Chris wants the Club to give its own operating money to the Foundation, the cleaner, auditable path is the cell to the right (Administrative → Foundation directly), not a round-trip through Activity. A genuine "seed the Activity Fund with float cash for an event, expect it back" case, if real, should be modeled as an actual advance/reimbursement (two real transactions with real parties), not a transfer, so Activity's income rows stay public-source-only. **Chris's call — flagged, not decided.** | *(self — see Account-Transfer rule below; this is exactly the live Admin Checking ↔ Petty Cash case Chris named.)* | **UNDECIDED — recommend ALLOWED, but modeled/labeled distinctly from the Activity sweep.** This is the Club making an actual, voluntary, permanent gift of its own operating money to its own charitable arm — a legitimate, if less common, board-approved act, and irreversible the moment it lands (the one-way valve below means it can never come back). Recommend: allow it, require the same mandatory board-minute reference as the Activity sweep, and apply the same over-threshold `ledger.approve` recommendation above — but label it in the UI as "Donate to Foundation" or similar, not "Sweep," since the accounting character differs (this is the Club's own money being given away, not forwarding money that was never the Club's to keep). **Chris's call — flagged, not decided.** |
| **Foundation: Charitable** | **BLOCKED** (locked requirement — one-way valve, no exceptions). Charitable/deductible money cannot flow back to a non-501(c)(3) entity under any framing — this is a compliance invariant, not a preference. | **BLOCKED** (locked requirement — same one-way valve). | *(self — Foundation currently has one bank account, Foundation Checking; no live case today, same forward-compatible rule as above.)* |

**Same-fund, cross-account movement (the Account-Transfer rule, not a matrix cell):** Today's code blocks *any* `sourceFundId === destFundId` as a no-op. Recommend narrowing that guard to `sourceFundId === destFundId AND sourceBankAccountId === destBankAccountId` — i.e. block only the *true* no-op (same fund, same account), and explicitly allow same-fund/different-account moves. This is what makes Admin Checking ↔ Petty Cash representable at all, and it generalizes correctly to any fund that later acquires a second bank account (Foundation, Activity), so the rule should be schema-driven ("do the two legs differ in fund or account") rather than hardcoded to "Administrative fund only." No board-minute requirement here — it's routine cash management, gated by `ledger.record` alone, same as any other transaction today.

## The Model Question: "Transfer" vs. "Sweep" — Recommendation

**Recommend treating this as one underlying mechanism with two names**, not two separate features or two separate schema shapes:

- **Mechanism stays the same:** two independently-posted `ledger_transactions` rows (debit/expense + credit/income), linked by the existing `transferGroupId` (self-join key, no FK) for UI discoverability. No new column is strictly required to distinguish "transfer" from "sweep" — it's fully derivable from the two legs' `entityId`: **same `entityId` on both legs = Transfer (or Account Transfer); different `entityId` = Sweep** (or "Inter-Entity Disbursement," if that reads more precisely to Chris/the board — either name is fine as long as it's not called a "transfer" in a way that implies the false idea of one atomic balanced entry).
- **What must change with the naming, though, is the framing shown to the user and, likely, in board minutes:** a same-entity transfer is genuinely one bookkeeping event moving money around inside one set of books. A cross-entity sweep is **two independent transactions on two separate legal entities' books** that happen to be recorded together for convenience — the UI copy, the confirmation step, and the board-minute prompt should say so explicitly (e.g., "This records two separate transactions — a Club expense and a Foundation gift/income — both citing the board minute you enter below"), so nobody mistakes the linked `transferGroupId` pair for a single reversible journal entry. This keeps the entity-separation invariant honest: the code never pretends money "moved" across the entity boundary inside the database the way it moves between two funds in the same entity; it records the reality that a real check/ACH was cut on one side and deposited on the other.
- Recommend the UI literally verb-switches label text ("Transfer" vs. "Sweep to Foundation" / "Donate to Foundation") based on whether `entityId` differs, driven off the allow-list matrix itself, so an operator can never mis-click their way into treating a cross-entity move as a same-books reclassification.

## Reconciliation — Confirmed

Each leg reconciles against its own bank account's real statement line because `getCandidateTransactionsForMatching` scopes purely by `bankAccountId` (verified in code, see Pass 0 above) — no query change needed. What tech-lead does need to design: the **form UI** must collect a distinct `sourceBankAccountId` and `destBankAccountId` (schema already supports this — `bankAccountId` lives on the transaction row, one per leg; `handleTransfer` just needs to stop forcing one value onto both inserts).

## Gaps the Request Didn't Address

- **Load-bearing — transfers bypass the disbursement-approval threshold entirely, today, with no exception.** Confirmed in code (`route.ts:295-301`, comment: "transfers always 'posted'"). Right now a single Treasurer holding only `ledger.record` (no `ledger.approve`) can move an arbitrary sum — including the entire Foundation balance — into or out of any fund with zero second-signer review, while an ordinary expense of the same size would require board approval first. This feature *expands* what a transfer can do (cross-entity, permanent disbursement out of Club control) without addressing that the safety rail for large moves doesn't apply to transfers at all. Recommend closing this as part of this feature, not as a follow-up: apply `disbApprovalThresholdCents` to the expense leg of any transfer/sweep the same way it applies to a plain expense. See Permissions section above and the Adversarial Pass below.
- **No category on either leg.** `handleTransfer` never sets `categoryId`. The brief mentions the Foundation's "Public donations" income category as the natural home for the sweep's destination leg. Recommend/flag as open question below — does the Foundation leg need `categoryId` set (e.g., to "Public donations") for 990/reporting purposes, or does leaving it null (as today's same-entity transfers already do) remain acceptable? This affects whether the sweep's giving/990 rollups pick it up correctly.
- **Empty state:** not applicable in the traditional sense (this is a form action, not a list view) — but flag for tech-lead/ux: what does the transfer/sweep form show when an entity has only one bank account (e.g., Foundation today)? The destination-bank-account picker shouldn't present a confusing single-option dropdown as if a choice were meaningful.
- **Mobile:** the form needs two fund pickers, two bank-account pickers, amount, date, memo, and conditionally a board-minute field — denser than today's single-bank-account transfer form. Flag for ux-developer to verify at 360px; may need to collapse into a clearer two-column "From / To" layout rather than a flat field list.
- **Brand consistency:** no destructive action here in the `window.confirm()` sense, but a cross-entity sweep is functionally irreversible (money leaves Club control permanently, one-way valve). Recommend the sweep submission route through `<ConfirmDialog>` (not just a plain form submit) with `destructive` styling and copy that states plainly "This creates two permanent, separate transactions on the Club's and Foundation's books. This cannot be undone in the Ledger — reversing it requires a new, opposite transaction and a new board decision." Buttons/cards otherwise follow existing `rounded-lg`/`rounded-2xl` conventions already used elsewhere in the ledger UI.
- **Email queue:** not mentioned in the brief; recommend out of scope for v1 (no member/donor-facing notification), but flag: should `ledger.approve` holders get an email when a pending sweep needs their sign-off? If the threshold-approval recommendation above is adopted, this "just works" for free — it reuses the *existing* E-1 pending-disbursement notification path (`getEmailsForFeature(FEATURES.LEDGER_APPROVE)` + `sendEmail`), since the expense leg would be an ordinary pending expense row as far as that notification code is concerned.
- **Google Group sync:** not applicable — no member/committee relationship touched.
- **OAuth-vs-password / access-pending:** not applicable — this is a `ledger.record`-gated admin action; sign-in method has no bearing.
- **Historical data:** the existing WARN-level `firewallViolations` metric presumably still counts *any* historical Activity→Administrative transfer rows that predate this hard block. Confirm with Chris/tech-lead whether any exist today that should be remediated (separate from this feature — not a reason to block Phase 2, just don't let it get silently forgotten).

## Out of Scope (confirm with user)

- **Auto-executing the Chase/bank-side transfer.** This feature only ever records the Ledger's two rows after a real-world check/ACH/cash movement has already happened (or is about to, per board motion) — it does not initiate any bank transaction. Confirmed already stated in the brief; restating so it's explicit in the work-log.
- **Replacing the board motion.** The mandatory board-minute *reference field* is a citation, not a workflow that generates or tracks the motion itself. The Ledger doesn't manage board meeting agendas.
- **A "scholarship" fund or any Foundation-side fund beyond Charitable.** The matrix and guardrail code already anticipate a `scholarship` fund kind existing someday; this feature does not create one. If/when it's added, the same public-fund one-way-valve rules should extend to it automatically (worth a forward-looking note for architect, not action now).
- **Retroactively fixing historical Activity→Administrative transfer rows** flagged by `firewallViolations` (if any exist) — that's a data-cleanup task for `docs/treasurer-todo.md`, not this feature.
- **Changing the split-transaction feature's guard set.** That feature (`2026-07-29-ledger-transaction-split.md`) already guards against splitting rows with an active `transferGroupId` in its own scope; I did not find (and this feature should not need) any change to that guard, since a transfer/sweep leg is still just an ordinary posted row from the split feature's point of view. Flag to tech-lead to confirm no interaction is missed, but I found no code path where they collide.

## Open Questions

1. **The two UNDECIDED matrix cells** (Club Administrative → Activity, and Club Administrative → Foundation) — my recommendations above are BLOCKED and ALLOWED-but-distinctly-labeled, respectively. Both are explicitly "Chris's call" per the brief; need a decision before Phase 2/3 can finalize the allow-list implementation.
2. **Adopt the over-threshold `ledger.approve` recommendation, or leave transfers/sweeps as always-immediately-posted?** This is the single highest-leverage open question — it's a live gap today (see Adversarial Pass), not a new risk this feature introduces, but this feature is the natural place to close it since it's already touching `handleTransfer`'s status derivation.
3. **Does the Foundation-side leg of a sweep need a `categoryId`** (e.g., "Public donations"), or does null stay acceptable as it is for same-entity transfers today? Affects 990/giving-rollup accuracy.
4. **Naming: "Sweep" or "Inter-Entity Disbursement" or something else** for the cross-entity case, in both UI copy and any board-minute template text? Purely a wording call, but worth locking before ux-developer builds copy.
5. **Any existing historical rows already violating the new hard block** (Activity→Administrative transfers before this ships) — should Phase 3/4 include a one-time data check (read-only report, not a fix) so Chris knows what pre-existing violations exist before the block goes live?

## Adversarial Pass (Pass 5) — Findings

- **Self-targeting / state-machine shortcut (load-bearing, confirmed in code):** a `ledger.record`-only user can, today, move money of any size between entities immediately, bypassing the exact review gate (`ledger.approve`, over-threshold pending) that governs ordinary expenses of the same size. This is the most important finding of this review — see Gaps and Permissions above. Recommend closing it as part of this feature, since the feature is what makes large, *permanent*, cross-entity moves possible for the first time.
- **Redirect targets:** none — this is a same-page form POST, no `callbackUrl`/`next`/`redirect` parameter involved.
- **Enumeration leaks:** the existing 400 responses already distinguish "fund not found" from "fund belongs to wrong entity" in message text (line 421/427) — for an admin-only, `ledger.record`-gated internal tool this is acceptable (not a public-facing auth boundary), but flag that the new blocked-direction errors should be similarly specific (policy reason, not just "not allowed") so a treasurer can self-correct without asking an admin what went wrong — already reflected in the Flows section above.
- **Input boundaries:** existing `validateAmount`/`parseDate` validation on the transfer path is server-side and reused as-is; the new board-minute field must get the same trim/cap/required-if-applicable validation as the existing approve-route field (400, not silent truncation, matching that route's established pattern) — noted in Permissions above.
- **State-machine shortcut via allow-list bypass:** confirm the directional check happens **server-side** in `handleTransfer` itself (as today's same-entity check already does), not just as client-side form-field disabling — a client that can reach the API directly (e.g., via devtools) must not be able to submit a blocked direction and have it silently accepted. This is implicit in "the API is the only gate" invariant already stated in CLAUDE.md, but worth stating explicitly here since the whole feature's value proposition is "deny by default," which is meaningless if only enforced in the UI.

---

# Phase 2 — Architectural Review (architect) — FOLDED, not skipped

**Verdict: Approved with reason.**

## The one invariant this feature touches

DECISION-016/017 (schema comment, `src/lib/db/schema.ts:497,623`) establishes "transfers are two linked rows sharing `transferGroupId`, same entity." This feature relaxes the *same-entity* half of that invariant to a **deny-by-default directional allow-list**: the mechanism (paired rows, `transferGroupId` self-join key, no new `flow` value) is unchanged; what changes is that `destFundId` may now belong to a different `ledgerEntities` row than `sourceFundId`, gated by an explicit whitelist function rather than an implicit single-entity `WHERE` clause.

## Why this is safe to fold rather than escalate

- **No new schema.** Confirmed against `src/lib/db/schema.ts:644-724` — `ledgerTransactions` already carries `entityId`, `fundId`, `bankAccountId`, `categoryId`, `boardMinute`, `transferGroupId`, `status`, `approvedAt`/`approvedByUserId`/`rejectionReason` per row. Cross-entity vs. same-entity is fully derivable at read time from `leg1.entityId !== leg2.entityId` — no discriminator column is needed.
- **No new directories or npm dependencies.** All work lands in existing files: `src/app/api/admin/ledger/transactions/route.ts` (+ its `[id]/approve`, `[id]/reject`, `[id]` siblings), `src/lib/ledger-queries.ts`, one new sibling file `src/lib/ledger-transfer-policy.ts` (a pure function module, same directory tier as `src/lib/ledger.ts` — not a new module boundary), and two existing client components.
- **Entity separation stays honest.** The Club (501c4) and Foundation (501c3) remain two independent sets of books at all times. A Sweep never becomes one atomic, reversible journal entry — it is, and is *labeled as*, two independently-posted transactions that happen to share a `transferGroupId` for UI convenience (Phase 1's "Model Question" section, already resolved). The allow-list is what keeps the boundary honest: it is deny-by-default, evaluated server-side, and only one cross-entity direction (Activity → Charitable) is whitelisted; the compliance-critical one-way valve (Foundation → Club, any fund, any direction) is a hard block with no override path in this feature.
- **No conflict with the split-transaction feature.** Confirmed per Phase 1 Out-of-Scope: a transfer/sweep leg is an ordinary posted row from that feature's point of view; its own `transferGroupId`-presence guard already excludes these rows from being split, unchanged by this work.

## Structural note for Phase 3

The one place this feature's "each leg gets its own bank account" requirement collides with *existing* code beyond `handleTransfer` is the **symmetric-edit path** in `PATCH /api/admin/ledger/transactions/[id]?both=true`
(`src/app/api/admin/ledger/transactions/[id]/route.ts:459-464`), which today force-applies a single edited `bankAccountId` to *both* legs of a pair. That code was correct under the old same-entity, one-bank-account-per-pair invariant; it becomes a silent data-corruption bug the moment a pair can legitimately have two different `bankAccountId` values (a Sweep, or an Account Transfer). This is not a new architectural boundary — it's an existing function whose invariant this feature invalidates — so it's called out for tech-lead to resolve in Phase 3, not routed back through Phase 2.

**Folded verdict, not skipped:** this review did not require a fresh spawn of the architect agent — the invariant, its resolution, and the one piece of existing code it invalidates were fully traceable from the Phase 1 analyst review plus a direct read of `schema.ts` and the edit route. Documented per CLAUDE.md's "no silent skips" rule.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Extend the existing `handleTransfer` transfer path (`POST /api/admin/ledger/transactions`,
`transfer: true`) rather than adding a new route. Each leg gets its own `bankAccountId`
(`sourceBankAccountId`/`destBankAccountId` replace today's single field); the directional
allow-list from Phase 1 is implemented as one pure, DB-free function,
`checkTransferDirection()`, in a new file `src/lib/ledger-transfer-policy.ts` — the single
source of truth for every matrix cell, unit-testable without a database. `entityId` is no
longer accepted from the client; both legs' entities are derived authoritatively from the
`sourceFundId`/`destFundId` rows themselves, closing the adversarial-pass concern that a
client could otherwise influence the fund lookup. The disbursement-approval threshold now
applies to the pair as a whole — both legs post or both go `pending` together, inside the
same DB transaction that already wraps the two-row insert — closing the "transfers always
post" gap Phase 1 flagged as load-bearing. The Foundation-side leg of a Sweep is categorized
(default the already-seeded "Public donations" income category; no new migration needed); the
same-entity Transfer legs stay categoryless, as today. A cross-entity Sweep requires a
mandatory `boardMinute` at creation, reusing the approve-route's existing trim/cap/required
validation shape; the approve route itself gains a small, backward-compatible fix so an
over-threshold Sweep's creation-time board-minute isn't silently overwritten by an approver
leaving the field blank. No schema changes, no new `FEATURES` key, no new npm dependencies —
see the folded Phase 2 note above for why this is safe. Logged as DECISION-058
(`docs/decisions.md`).

## Verified against the code (this pass)

- `handleTransfer` (`route.ts:363-473`) — matches Phase 1's Pass 0 exactly. Single `bankAccountId` param, `entityId`-scoped fund `WHERE`, hard `sourceFundId === destFundId` 400.
- Normal-path status derivation (`route.ts:294-301`): `flow === 'expense' && amountCents > settings.disbApprovalThresholdCents ? 'pending' : 'posted'`. This is the exact shape to mirror for the pair.
- `POST .../[id]/approve/route.ts` — single-row fetch by `id` (line 49-53), 409 if not pending, self-approval block (`recordedByUserId === session.user.id`), `boardMinute` required non-blank ≤500 chars (trim + `.slice(0,500)`, no reject-on-overflow — silent truncation, unlike `publicNote`'s reject-on-overflow pattern), then a single-row `UPDATE` setting `status='posted', approvedByUserId, approvedAt, boardMinute`. **No transferGroupId awareness today** — confirmed only single-row logic exists; this route needs the pair-aware rewrite.
- `POST .../[id]/reject/route.ts` — identical shape, sets `status='rejected', rejectionReason` (≤1000 chars). Same gap: single-row only.
- `PATCH .../[id]/route.ts:423-464` — `?both=true` symmetric-edit path for existing transfer pairs. Confirmed it applies `bankAccountId` to *both* rows when present in the edit payload (line 464: `if (update.bankAccountId !== undefined) symmetricUpdate.bankAccountId = update.bankAccountId;`). This is the collision Phase 2 flagged — must be fixed as part of this feature, not left as a live corruption path.
- `getPendingApprovals` (`ledger-queries.ts:3236-3273`) — flat query, `status='pending'`, no dedup by `transferGroupId` (never needed, since transfers never went pending before). Needs a dedup pass once transfer/sweep pairs can be pending.
- `firewallViolations` (`ledger-queries.ts:2815-2832`) — counts distinct `transferGroupId` groups where the two legs' fund **kinds** are `{activity, administrative}` in either order (a `Set`, not a directional pair) — i.e. it already flags *both* directions between Activity and Administrative today, at WARN severity, post-hoc. This feature's hard block subsumes it for *new* rows; the WARN stays alive for any pre-existing rows (analyst confirmed zero exist).
- `ledgerCategories` seed (`drizzle/migrations/0044_ledger_books.sql:287,318`, `0049_ledger_990_lines.sql:130-194`) — "Public donations" is already seeded for **both** `fundKind='activity'` and `fundKind='charitable'`, `flow='income'`, mapped to the correct 990 line. The Foundation-side default category this feature needs already exists — no new seed migration required.
- `TransactionForm` (`src/components/admin/ledger/transaction-form.tsx`) — `funds`/`bankAccounts`/`categories` props are single-entity, supplied by the page. The existing `"transfer"` `FlowMode` renders a from-fund/to-fund picker (both drawn from the same `funds` array) plus one shared `bankAccountId` field (lines 379-423, 710-730). No cross-entity data is loaded anywhere in this component or its page today.
- `[fundSlug]/page.tsx` (`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx:113-126`) fetches `bankAccounts`/`categories`/`funds` for exactly one entity (`entity.id`, resolved from the `?entity=` param) and passes them straight through to `TransactionFormDialog`. A Sweep dialog needs the *other* entity's funds/bank accounts/categories, which nothing on this page fetches today.

## API contract — extend `handleTransfer`, not a new route

**Decision: extend the existing `POST /api/admin/ledger/transactions` transfer path.** Justification:
- The mechanism is explicitly "one underlying mechanism, two names" (Phase 1, locked). A new route would fork validation (amount/date parsing, bank-account requirement) that's already correct and shared in this file.
- The entry point already branches on `body.transfer === true` (`route.ts:137-139`) — the natural extension point, not a new resource.
- A new route would also need its own gate check, its own error-shape conventions, and its own tests for things (amount validation, date validation) that are identical to what's already here — pure duplication with no isolation benefit, since the two "modes" (Transfer/Sweep) already collapse into one allow-list decision inside a single function (see below).

**New request body** (replaces the current transfer shape):

```
{
  transfer: true;
  sourceFundId: string;
  destFundId: string;
  sourceBankAccountId: string;   // renamed from bankAccountId — required
  destBankAccountId: string;     // NEW — required
  txnDate: string;
  amountCents: number;
  memo?: string;
  boardMinute?: string;          // required when checkTransferDirection() says requiresBoardMinute
  destCategoryId?: string;       // optional — cross-entity leg only; defaults to the dest entity's
                                  // 'Public donations' income category when omitted
}
```

**`entityId` is dropped from the transfer body entirely.** Today's code trusts a client-supplied `entityId` to scope the fund lookup (`route.ts:406-414`) — that's exactly the pattern the adversarial pass in Phase 1 warns against ("the directional check happens server-side... a client that can reach the API directly must not be able to submit a blocked direction"). Instead: fetch `sourceFundId` and `destFundId` **each by id alone, no entity filter**, and derive `sourceEntityId`/`destEntityId` authoritatively from the rows returned. This also removes the only reason today's code needed a client-supplied `entityId` in the first place.

**Response (201):** `{ transferGroupId: string; derivedFiscalYear: number; status: 'posted' | 'pending' }` — the `status` field is new, mirroring the normal path's response shape, so the client can show the same "awaiting board approval" toast it already shows for large expenses (`transaction-form.tsx:330-334` already branches on `data.status === 'pending'`, currently dead code for transfers — this makes it live).

## The directional allow-list — single source of truth

New file: **`src/lib/ledger-transfer-policy.ts`** — a small, pure, dependency-free module (no DB import), justified over adding this to `src/lib/ledger.ts` because:
- `ledger.ts`'s guardrail functions are large, DB-querying, and compute *reporting* metrics (`firewallViolations` et al.) from an already-fetched transaction list. This function is a **pre-insert decision gate** taking primitive inputs — a different shape and a different call site (inside a request handler, before any insert), not a batch guardrail.
- Isolating it in its own file makes the whole allow-list matrix unit-testable with zero DB/mocking — every cell in Phase 1's matrix becomes one direct function call in a test.

```ts
// src/lib/ledger-transfer-policy.ts (sketch — not final implementation)

export type TransferMode = "transfer" | "sweep";

export type TransferDirectionResult =
  | { allowed: true; mode: TransferMode; requiresBoardMinute: boolean }
  | { allowed: false; reason: string };

interface FundRef {
  entityId: string;
  fundId: string;
  kind: string; // 'administrative' | 'activity' | 'charitable' | 'scholarship'
}

export function checkTransferDirection(
  source: FundRef,
  dest: FundRef,
): TransferDirectionResult {
  // Same fund → this is the Account-Transfer case (bank-account no-op guard
  // is checked separately, by the caller, since it needs both bankAccountIds).
  if (source.fundId === dest.fundId) {
    return { allowed: true, mode: "transfer", requiresBoardMinute: false };
  }

  if (source.entityId === dest.entityId) {
    // Same entity, different fund — deny-by-default. Today's only live case
    // is Activity <-> Administrative; both directions blocked per Chris's
    // locked decision. Any other same-entity fund pair (future scholarship
    // fund, etc.) also falls through to the generic block, which is the
    // correct deny-by-default behavior without enumerating funds that don't
    // exist yet.
    if (source.kind === "activity" && dest.kind === "administrative") {
      return {
        allowed: false,
        reason:
          "Activity Fund is public-facing pass-through money; it cannot be used to fund Club operations. See Activity Fund policy.",
      };
    }
    if (source.kind === "administrative" && dest.kind === "activity") {
      return {
        allowed: false,
        reason:
          "Administrative funds cannot be moved into the Activity Fund — the Activity Fund's income must stay publicly-sourced. See Activity Fund policy.",
      };
    }
    return {
      allowed: false,
      reason: "Transfers between different funds within the same entity are not permitted.",
    };
  }

  // Cross-entity
  if (source.kind === "charitable") {
    return {
      allowed: false,
      reason:
        "Charitable funds cannot be transferred back to the Club — this is a one-way flow by policy.",
    };
  }
  if (source.kind === "activity" && dest.kind === "charitable") {
    return { allowed: true, mode: "sweep", requiresBoardMinute: true };
  }
  if (source.kind === "administrative" && dest.kind === "charitable") {
    return {
      allowed: false,
      reason:
        "Administrative-to-Foundation gifts are not enabled yet — flagged for a future board decision.",
    };
  }
  return { allowed: false, reason: "This fund transfer direction is not permitted." };
}
```

This single function *is* the allow-list matrix from Phase 1 — every row/column of that table is one `if` branch here, each with the exact policy-reason wording the analyst already drafted (Phase 1 Flows section), and every branch is independently unit-testable (see Tests below).

## Where each leg's fields get set

| Field | Source leg (`flow='expense'`) | Dest leg (`flow='income'`) |
|---|---|---|
| `entityId` | derived from `sourceFundId` row | derived from `destFundId` row |
| `fundId` | `sourceFundId` | `destFundId` |
| `bankAccountId` | `sourceBankAccountId` (validated: must belong to source `entityId`, must be `isActive`) | `destBankAccountId` (validated: must belong to dest `entityId`, must be `isActive`) |
| `categoryId` | always `null` (unchanged from today) | `null` for `mode:"transfer"`; for `mode:"sweep"`, `destCategoryId` if provided (validated `fundKind==='charitable' && flow==='income'`), else the dest entity's seeded "Public donations" `charitable`/`income` category id |
| `boardMinute` | same value on both legs, from request body, when `requiresBoardMinute` | same |
| `status` | derived once, applied to both legs (see below) | same |
| `transferGroupId` | shared `crypto.randomUUID()` | same |

**Bank-account ownership/active validation is new** — today's `handleTransfer` never validates that `bankAccountId` belongs to the entity or is active, for either the normal or transfer path (confirmed: no such check exists in the file). It was implicitly safe before because one `bankAccountId` was forced onto both legs of a same-entity pair with no way to select a foreign account. Once legs can diverge, this becomes a required check, not a nice-to-have: fetch both `ledgerBankAccounts` rows by id, confirm `entityId` matches each leg's derived entity, confirm `isActive`, 400 otherwise.

## Approval-gate integration (the pair goes pending together)

Reuse `getSettings().disbApprovalThresholdCents` exactly as the normal path does. Apply it once, to the pair as a whole (both legs carry the same `amountCents` by construction):

```
const derivedStatus = amountCents > settings.disbApprovalThresholdCents ? "pending" : "posted";
```

Both rows are inserted with this single derived `status` inside the same `db.transaction(...)` that already wraps the two-row insert (`route.ts:441-470`) — atomic by construction, no new transaction boundary needed.

**E-1 email notification** (`route.ts:326-350`) fires today only from the normal path. Extend the same "notify `LEDGER_APPROVE` holders" call to fire when `handleTransfer`'s derived status is `'pending'` too — this reuses `getEmailsForFeature(FEATURES.LEDGER_APPROVE)` and `sendEmail` verbatim; the email body should say "Transfer" or "Sweep" per `mode`, and name both funds (From/To), not just an amount.

### Approve / reject routes — pair-aware rewrite

Both `POST .../[id]/approve` and `POST .../[id]/reject` need the same shape of change:

1. Fetch the transaction by `id` (unchanged).
2. If `txn.transferGroupId` is non-null, fetch the partner row (`transferGroupId` match, `id !== txn.id`).
3. Validate **both** rows are `status='pending'` (409 with a specific message if they've drifted apart — should never happen given atomic pair-creation, but this is the defensive check the adversarial-pass discipline calls for).
4. Self-approval/self-rejection check uses either row's `recordedByUserId` (identical on both legs, since one call created both).
5. Update **both** rows in one `db.transaction(...)`, setting identical `status`/`approvedByUserId`/`approvedAt`/`boardMinute` (approve) or `status`/`rejectionReason` (reject).

**Board-minute collision, resolved:** a Sweep already collects a mandatory `boardMinute` at *creation* (Phase 1, locked decision #1/#4). If that same Sweep is also over-threshold, the *existing* approve route would blindly overwrite that citation with whatever the approver types (`route.ts` approve, current line 84: `.slice(0, 500)` applied to whatever's in the request body, no awareness of a pre-existing value). Fix: make the approve route's `boardMinute` **required only when the transaction doesn't already have one**:

```
const provided = typeof body?.boardMinute === "string" ? body.boardMinute.trim() : "";
const boardMinute = provided ? provided.slice(0, 500) : txn.boardMinute;
if (!boardMinute) return 400 "boardMinute is required";
```

This is a strict generalization — ordinary expenses (which never have a pre-set `boardMinute`) behave exactly as today (still required); a Sweep that already cited one at creation lets the approver leave the field blank to keep it, or override it by typing a new one.

### `getPendingApprovals` dedup

Once a pair can be `pending`, the flat query returns both legs as separate rows. Fix: after fetching, group by `transferGroupId` and keep only the `flow==='expense'` (source) leg per group for display — mirroring how the fund-register page already resolves a "partner" row for display (`[fundSlug]/page.tsx:156-164`). The Approvals page row for a pair should show "Transfer" or "Sweep" with a From-Fund → To-Fund label (needs the partner's `fundId` resolved to a name, same pattern as the register), not the current single-fund column.

## UI plan — one dialog, two concrete flow-modes (not a generic fund matrix)

Because the allow-list collapses to **exactly two allowed shapes** (same-fund/different-account "Transfer"; Activity→Charitable "Sweep"), the UI should present exactly those two concrete options rather than a generic from-fund/to-fund picker that mostly gets rejected server-side. This directly satisfies Phase 1's adversarial-pass ask ("an operator can never mis-click their way into treating a cross-entity move as a same-books reclassification") — the wrong direction isn't just disabled, it's never offered as a UI path in the first place. Server-side `checkTransferDirection` remains the enforced gate regardless (defense-in-depth, per Phase 1's explicit callout).

- **Keep `TransactionForm`** (no new component file) — the existing `"transfer"` `FlowMode` is replaced by two sibling modes, `"transfer"` (relabeled "Transfer (Move Cash Between Accounts)") and `"sweep"` (new, "Sweep to Foundation"), sharing the existing amount/date/memo/actions shell (~80% of the component is flow-mode-agnostic already).
  - **Transfer mode:** single fund is implied (today, only the Administrative fund has >1 bank account — Admin Checking + Petty Cash); two bank-account dropdowns ("From Account" / "To Account"), second excludes whatever's picked in the first (mirrors the existing dest-fund-excludes-source-fund pattern at lines 413-419). No board-minute field. No-op guard: same fund **and** same account → 400 client + server.
  - **Sweep mode:** rendered only when `crossEntityContext` is supplied (see below) and the current entity has an `activity` fund with `donationsDeductible=false` and the paired entity has a `charitable` fund — i.e., only ever shows on the Club's pages, never the Foundation's. Fields: source bank account (Club Activity's account — auto-selected if only one exists, per Phase 1's empty-state note), destination bank account (Foundation's, defaulting to its `isDefault` account), **mandatory** board-minute textarea, optional category override (defaults to "Public donations," rarely changed). Submission routes through `<ConfirmDialog destructive>` per Phase 1's Gaps section, with copy stating plainly that this creates two permanent, separate transactions on two entities' books.
- **New props on `TransactionForm`:** `crossEntityContext?: { entityId: string; entityName: string; funds: LedgerFund[]; bankAccounts: LedgerBankAccount[]; categories: LedgerCategory[] }` — populated only for Club pages, `undefined` on Foundation pages (where Sweep mode simply doesn't render).
- **Page-level change** (`[fundSlug]/page.tsx`): when `entity.donationsDeductible === false` (i.e., this is the Club) and `canRecord`, additionally fetch the Foundation entity's `getFunds`/`getBankAccounts`/`getCategories` and pass them down as `crossEntityContext`. Gated behind `canRecord` (view-only users never see the record dialog at all, so no need to fetch).
- **Approvals page:** no new component needed for Approve/Reject (they already just POST to the same URLs); only the row-rendering in `approvals/page.tsx` needs the dedup'd label treatment described above.

## Reconciliation — no change (confirmed)

Per Phase 1: `getCandidateTransactionsForMatching` (`src/lib/reconciliation-queries.ts:342-372`) scopes purely by `bankAccountId`/`status`/`reconciled` — the moment each leg carries its own real `bankAccountId`, each becomes an ordinary independent reconciliation candidate with zero code change. Confirmed by re-reading the same function; no update needed here.

## Implementation order

1. **api-developer**
   1. `src/lib/ledger-transfer-policy.ts` — `checkTransferDirection()` + types, pure, unit-tested in isolation first (no route changes depend on anything except this function's signature being final).
   2. Rewrite `handleTransfer()` in `route.ts`: new body shape, per-fund lookup by id (drop entity-scoped query), bank-account ownership/active validation, `checkTransferDirection()` call, board-minute requirement, dest-leg category resolution (explicit `destCategoryId` or seeded "Public donations" lookup), threshold-derived `status` applied to both legs, E-1 email extended to fire on `status==='pending'`.
   3. Rewrite `POST .../[id]/approve` and `POST .../[id]/reject`: pair detection, both-pending validation, atomic dual-row update, board-minute-already-set relaxation (approve only).
   4. Fix `PATCH .../[id]/route.ts`'s `?both=true` symmetric update: **remove `bankAccountId` from the symmetric-update field list** (line 464) — per-leg bank account becomes immutable after creation for any transfer/sweep pair; a wrong choice is corrected by delete+recreate, not edit. (This is the Phase 2-flagged collision — must land before or alongside the `handleTransfer` rewrite, since the moment legs can diverge, the old symmetric behavior is actively wrong, not just stale.)
   5. `getPendingApprovals` dedup by `transferGroupId`, keeping the source (`flow='expense'`) leg; expose the partner's `fundId`/`entityId` so the page can render a From → To label.
   6. Unit tests (this phase's gate — written by api-developer, not qa): see Tests below.
2. **ux-developer**
   1. `[fundSlug]/page.tsx`: fetch and pass `crossEntityContext` for Club pages when `canRecord`.
   2. `TransactionForm`: split `"transfer"` `FlowMode` into `"transfer"`/`"sweep"`, new fields, `<ConfirmDialog>` wrapping Sweep submission, mandatory board-minute textarea, category override, per-leg bank-account pickers for Transfer mode.
   3. `approvals/page.tsx`: dedup'd row rendering with From → To fund label and Transfer/Sweep badge, reusing the existing `ApproveDialog`/`RejectTransactionDialog` unchanged (they're id-agnostic to pairing — the pairing logic lives entirely server-side).
3. **qa** — Phase 5 as usual: typecheck, `pnpm build:only`, manual click-through of both Transfer and Sweep (including an over-threshold Sweep to see the pending→approve round-trip), regression-check the existing Admin↔Petty-Cash-adjacent same-entity transfer flow still works post-rewrite.

## Edge cases

- **Same fund, same bank account** (true no-op): 400, both client and server — the narrowed guard from Phase 1 (`sourceFundId === destFundId AND sourceBankAccountId === destBankAccountId`), distinct from the old blanket "cannot transfer a fund to itself."
- **Inactive bank account on either leg:** 400 "Selected bank account is inactive" — new validation, required now that legs can diverge (see above).
- **Bank account belongs to the wrong entity** (e.g., client tampers with `destBankAccountId` to point at a Club account while `destFundId` is Foundation's): 400 — caught by the new ownership check, independent of the directional allow-list.
- **Cross-entity attempted with a blank `boardMinute`:** 400 "A board-minute reference is required for a cross-entity sweep," regardless of amount — enforced before the insert, not just at approval time.
- **Missing/inactive "Public donations" category** on the dest entity (shouldn't happen — confirmed seeded — but defensively): fall back to `categoryId: null` rather than hard-failing the whole sweep; log a warning server-side. A missing category is a data problem to fix separately, not a reason to block a treasurer from recording a real bank movement that already happened.
- **Amount validation:** unchanged — existing `validateAmount()` reused as-is for the pair (both legs get the same validated `amountCents`).
- **Editing an existing Transfer/Sweep pair:** amount/date/memo remain editable symmetrically (unchanged); `bankAccountId` becomes **not** editable post-creation on a pair (see PATCH fix above) — the edit form for `isEditingTransfer` should stop rendering the bank-account field entirely once this ships, since it can no longer safely represent "change just one leg's account" through the existing symmetric-update path. Flagged as a UI follow-up in the same PR, not a separate feature.
- **Direct API call bypassing the UI's two concrete modes:** must still hit `checkTransferDirection()` and get the correct block reason — this is the whole point of keeping enforcement server-side (Phase 1 adversarial pass).

## Unit tests to write (api-developer, Phase 4 gate)

**`checkTransferDirection()` — one test per matrix cell:**
- Same fund → `{allowed:true, mode:'transfer', requiresBoardMinute:false}` (any entity/kind inputs — fundId equality short-circuits).
- Same entity, Activity → Administrative → blocked, exact reason string.
- Same entity, Administrative → Activity → blocked, exact reason string.
- Same entity, any other kind pair (forward-compat, e.g. a hypothetical future second Administrative-kind fund) → blocked, generic reason.
- Cross-entity, Activity → Charitable → `{allowed:true, mode:'sweep', requiresBoardMinute:true}`.
- Cross-entity, Charitable → Activity → blocked, one-way-valve reason.
- Cross-entity, Charitable → Administrative → blocked, one-way-valve reason.
- Cross-entity, Administrative → Charitable → blocked, "not enabled yet" reason (Chris's deferred cell).
- Cross-entity, Administrative → Activity (nonsensical/forward-compat) → blocked, generic reason.

**`handleTransfer` route-level (integration):**
- Sweep with blank/missing `boardMinute` → 400, regardless of amount.
- Sweep under threshold → both legs inserted `status='posted'` immediately.
- Sweep (or same-entity Transfer) over threshold → both legs inserted `status='pending'`, response `status:'pending'`.
- Each leg's `bankAccountId` matches its own request field, and they differ when the request supplied different accounts (regression-proves the "own bank account per leg" core requirement).
- Sweep dest leg gets `categoryId` defaulting to the dest entity's "Public donations" category when `destCategoryId` omitted; source (Activity) leg's `categoryId` stays `null`.
- Same-entity Transfer: both legs' `categoryId` stay `null` (unchanged behavior).
- Same fund + same bank account → 400 no-op.
- Same fund + different bank account (the Admin Checking ↔ Petty Cash case) → 201, both legs posted, no board-minute required.
- Blocked direction submitted directly (bypassing the UI's two concrete modes) → 400 with the specific policy-reason message — proves server-side enforcement, not just UI restriction.
- Bank account belonging to the wrong entity → 400.
- Inactive bank account on either leg → 400.

**Approve/reject pair-awareness:**
- Approving either leg's `id` updates **both** rows to `status='posted'` with identical `approvedByUserId`/`approvedAt`/`boardMinute`.
- Rejecting either leg's `id` updates **both** rows to `status='rejected'` with identical `rejectionReason`.
- Self-approval/self-rejection block still applies, keyed off either leg's shared `recordedByUserId`.
- Approving a Sweep that already has a `boardMinute` (set at creation) with a **blank** `boardMinute` in the approve request succeeds and preserves the original value (does not blank it out).
- Approving an ordinary large expense (no pre-existing `boardMinute`) with a blank `boardMinute` in the request still 400s — regression-proves this path is unchanged for non-pair rows.

**`getPendingApprovals` dedup:**
- A pending Transfer or Sweep pair yields exactly one row in the result set (the `flow='expense'` leg), not two.

**PATCH edit-route regression:**
- Editing a Sweep pair's amount/date/memo via `?both=true` no longer touches `bankAccountId` on either leg even if the request body includes one.

## Implementer

**Recommend the specialist split: api-developer → ux-developer**, not full-stack-developer. This is well beyond the "~<150 lines across API + UI" full-stack threshold — a new pure policy module, three route files rewritten (`handleTransfer`, `approve`, `reject`) plus a fix to a fourth (`PATCH [id]`), one query function changed, and two client components meaningfully restructured (a new `FlowMode` split plus new cross-entity data plumbing through a Server Component page). CLAUDE.md's own guidance — "every increment of The Ledger ran this way cleanly" — applies directly here.

## Open questions / handoff notes

- Use the **api-developer** agent first for everything under Implementation Order step 1
  (`ledger-transfer-policy.ts`, `handleTransfer` rewrite, approve/reject pair-awareness, the
  `PATCH [id]` bank-account-immutability fix, `getPendingApprovals` dedup, and the full unit-test
  list above — these are this phase's Phase 4 gate, not qa's job). Then hand to
  **ux-developer** for step 2 (`TransactionForm` mode split, `crossEntityContext` plumbing,
  Approvals page row rendering).
- The two Phase-1 UNDECIDED matrix cells (Administrative→Activity, Administrative→Foundation)
  are BLOCKED in this design per Chris's deny-by-default directive — both are coded as explicit,
  separately-worded blocks in `checkTransferDirection()`, not silently folded into the generic
  catch-all, specifically so that if Chris later approves either one at a Phase 6 override, it's
  a one-branch change in one file with an existing unit-test slot to flip.
- Flag for qa (Phase 5): the manual click-through must include an over-threshold Sweep to
  exercise the full pending → `ledger.approve` → posted round-trip, and a regression check that
  the pre-existing Admin Checking ↔ Petty Cash same-entity transfer flow still works after the
  `handleTransfer` rewrite (this is the feature's other primary live use case, not just the
  sweep).
- Decision logged as **DECISION-058** in `docs/decisions.md`.

---

# Phase 4 — Implementation (API) — 2026-07-29

**Owner:** api-developer
**Status:** complete

### Summary

Implemented every server-side item in the Phase 3 design exactly as locked: the pure directional
allow-list module, the `handleTransfer` rewrite (new per-leg body shape, entity-derivation instead
of client-supplied `entityId`, bank-account ownership/active validation, board-minute requirement,
destination-leg categorization, and the over-threshold pending gate applied to the pair), pair-aware
`approve`/`reject` routes with the `boardMinute`-preservation bug fix, the `PATCH [id]`
bank-account-immutability fix, and the `getPendingApprovals` dedup. Every unit test named in the
Phase 3 design doc is written and passing — 144 tests across 7 files, plus the full existing suite
(832 tests, 33 files) stays green. `pnpm exec tsc --noEmit` is clean. No client components were
touched.

### What I did

- Created `src/lib/ledger-transfer-policy.ts` — pure, DB-free `checkTransferDirection(source, dest)`,
  one `if` branch per Phase 1 matrix cell, decided off fund `kind`/entity identity (never hard-coded
  UUIDs). Returns `{ allowed: true, mode: 'transfer'|'sweep', requiresBoardMinute }` or
  `{ allowed: false, reason }`.
- Rewrote `handleTransfer()` in `src/app/api/admin/ledger/transactions/route.ts`:
  - New body: `sourceFundId`, `destFundId`, `sourceBankAccountId`, `destBankAccountId`, `txnDate`,
    `amountCents`, `memo?`, `boardMinute?`, `destCategoryId?`. `entityId` is no longer read from the
    body at all.
  - Fund lookup changed from an entity-scoped `WHERE` to `inArray(ledgerFunds.id, [sourceFundId,
    destFundId])` with no entity filter — both legs' entities are derived from the returned rows.
  - `checkTransferDirection()` called immediately after the fund fetch; blocked directions return
    `403` with the policy reason.
  - No-op guard narrowed to `sourceFundId === destFundId && sourceBankAccountId === destBankAccountId`
    (checked separately from the policy function, which never sees bank accounts).
  - New bank-account validation: both accounts fetched by id (`inArray`), each checked against its
    leg's derived `entityId` and `isActive` — 404/400 with specific messages per failure mode.
  - `boardMinute` required (trim + 500-char cap, same shape as the approve route) only when
    `direction.requiresBoardMinute` is true; stored on both legs.
  - Destination-leg `categoryId` resolved only for `mode==='sweep'`: explicit `destCategoryId`
    (validated: belongs to dest entity, `fundKind` matches, `flow==='income'`) or, when omitted, the
    destination entity's seeded "Public donations" `charitable`/`income` category (resolved by
    name/kind, no hard-coded UUID; defensive `console.error` + null fallback if somehow missing).
    Same-entity Transfer legs stay categoryless.
  - Threshold check (`getSettings().disbApprovalThresholdCents`) applied once to the pair; both legs
    insert with the same derived `status` inside the existing `db.transaction(...)`.
  - E-1 email extended to fire for a pending Transfer/Sweep pair, using "Transfer"/"Sweep" wording
    per `direction.mode`.
  - Response: `{ transferGroupId, derivedFiscalYear, status }`.
- Rewrote `POST .../[id]/approve/route.ts` and `POST .../[id]/reject/route.ts` to be pair-aware:
  fetch the partner leg via `transferGroupId` when set, require both legs `pending` (409 with a
  specific message otherwise), self-approval/rejection check keyed off the shared
  `recordedByUserId`, and update both rows atomically in one `db.transaction(...)`.
  - Bug fix (approve only): `boardMinute` is now required **only when the row doesn't already have
    one** (`providedRaw ? providedRaw.slice(0,500) : txn.boardMinute`) — a Sweep's creation-time
    citation survives a blank approval field instead of being silently overwritten. Ordinary
    expenses (never pre-set) are unaffected — verified by regression test.
- Fixed `PATCH .../[id]/route.ts`: `bankAccountId` in the request body is now silently ignored
  (not 400ed, not applied) for **any** row with a non-null `transferGroupId` — regardless of the
  `?both=true` query param — closing the old force-propagation-to-both-legs bug at its root rather
  than just at the symmetric-update call site. Removed the
  `if (update.bankAccountId !== undefined) symmetricUpdate.bankAccountId = ...` propagation line
  entirely (it's now dead code, since `update.bankAccountId` can never be set for a pair leg).
- `getPendingApprovals()` in `src/lib/ledger-queries.ts`: dedups a pending Transfer/Sweep pair to a
  single row (the `flow==='expense'` source leg), exposing `partnerFundId`/`partnerFundName`/
  `partnerEntityId` (all `null` for ordinary pending rows) so the Approvals page can render a
  From → To label without an extra query — the destination leg already carries its own joined
  `fundName` in the same result set.
- Wrote and ran every named unit test:
  - `src/lib/ledger-transfer-policy.test.ts` — 9 tests, one per matrix cell.
  - `src/app/api/admin/ledger/transactions/route.test.ts` — rewritten for the new transfer body
    shape; 23 tests (bank-account-required regression + the full DECISION-058 list: boardMinute
    requirement, threshold routing for both Sweep and Account Transfer, per-leg bank-account
    persistence, category defaulting/override, no-op guard, blocked directions incl. the one-way
    valve, wrong-entity/inactive bank accounts, and the dropped-`entityId`-has-no-effect check).
  - `src/app/api/admin/ledger/transactions/[id]/approve/route.test.ts` — new file, 8 tests (pair
    approval, self-approval block, partner-drifted 409, boardMinute preservation with blank/absent
    field, ordinary-expense regression).
  - `src/app/api/admin/ledger/transactions/[id]/reject/route.test.ts` — new file, 5 tests (pair
    rejection, self-rejection block, partner-drifted 409, blank-reason 400, ordinary-expense
    regression).
  - `src/app/api/admin/ledger/transactions/[id]/route.test.ts` — new file, 4 tests (the `?both=true`
    regression named in the design, the same immutability without `?both=true`, and two ordinary-
    transaction regressions for the bank-account-required behavior).
  - `src/lib/ledger-queries.test.ts` — appended 3 tests for the `getPendingApprovals` dedup (Sweep
    pair → one row + partner fields, ordinary expense passes through with null partner fields, a
    mix of both in one call).

### Outputs

**New file:** `src/lib/ledger-transfer-policy.ts`
```ts
export type TransferMode = "transfer" | "sweep";
export type TransferDirectionResult =
  | { allowed: true; mode: TransferMode; requiresBoardMinute: boolean }
  | { allowed: false; reason: string };
export interface FundRef { entityId: string; fundId: string; kind: string; }
export function checkTransferDirection(source: FundRef, dest: FundRef): TransferDirectionResult;
```

**Endpoint: `POST /api/admin/ledger/transactions` (transfer path, `transfer: true`)**
- Gate: `ledger.record` (`FEATURES.LEDGER_RECORD`), unchanged.
- Request body:
  ```
  {
    transfer: true;
    sourceFundId: string;
    destFundId: string;
    sourceBankAccountId: string;   // required
    destBankAccountId: string;     // required
    txnDate: string;               // YYYY-MM-DD
    amountCents: number;
    memo?: string;
    boardMinute?: string;          // required iff checkTransferDirection() says requiresBoardMinute
    destCategoryId?: string;       // Sweep destination leg only; defaults to "Public donations"
  }
  ```
  `entityId` is NOT part of this body — both legs' `entityId` are derived from the fund rows.
- Response `201`: `{ transferGroupId: string; derivedFiscalYear: number; status: 'posted' | 'pending' }`
- Errors: `400` (validation, no-op, missing boardMinute, bad category), `403` (blocked direction, with
  the specific policy reason from `checkTransferDirection`), `404` (fund/bank-account/category not
  found).

**Endpoints: `POST /api/admin/ledger/transactions/[id]/approve` and `.../reject`**
- Gate: `ledger.approve` (`FEATURES.LEDGER_APPROVE`), unchanged.
- Now pair-aware: approving/rejecting either leg's id updates both legs atomically. `approve`'s
  `boardMinute` body field is optional when the target row already has one set.
- Response shape unchanged: `{ id }` (the id in the URL, not both ids — ux-developer should know
  both rows update even though only one id echoes back).

**Endpoint: `PATCH /api/admin/ledger/transactions/[id]`**
- No new fields. Behavior change only: `bankAccountId` in the body is ignored (not persisted, not
  400ed) whenever `existing.transferGroupId` is non-null, with or without `?both=true`.

**Query: `getPendingApprovals(entityId?)` (`src/lib/ledger-queries.ts`)**
- Return type gained `partnerFundId: string | null`, `partnerFundName: string | null`,
  `partnerEntityId: string | null` on `PendingApprovalRow`. A pending Transfer/Sweep pair now yields
  exactly one row (the expense/source leg) with these three fields populated from the paired income
  leg; ordinary pending rows have all three `null`.

**Schema:** no changes. No new migration.

**Test results:**
- `pnpm exec tsc --noEmit` — clean.
- Targeted suite (7 files, the ones touched/added by this phase): **144 passed**.
- Full suite (`pnpm test`): **832 passed, 33 files, 0 failed**.
- `pnpm lint` not run beyond the known pre-existing unrelated ESM/minimatch failure (per task
  constraints) — not touched by this change.
- `pnpm build:only` intentionally NOT run (per task constraints — deployment-engineer's/qa's step).

### Open questions / handoff notes

- **Next: ux-developer** for Phase 3's Implementation Order step 2 — `TransactionForm`'s `"transfer"`
  `FlowMode` split into `"transfer"`/`"sweep"`, the new `crossEntityContext` prop and page-level
  plumbing in `[fundSlug]/page.tsx`, and the Approvals page's dedup'd From → To row rendering
  (consuming the new `partnerFundId`/`partnerFundName`/`partnerEntityId` fields). **The current
  `TransactionForm` still POSTs the OLD body shape** (single `bankAccountId`, client-supplied
  `entityId`, a client-side `sourceFundId === destFundId` hard block) — it will get `400`s against
  the new contract until updated. This is expected per the design's implementation order, not a
  regression to chase.
- The response from `approve`/`reject` still only echoes `{ id }` for the row named in the URL, not
  the partner's id — flagging in case the Approvals page UI wants to optimistically update both rows
  client-side without a refetch; the partner's id isn't in the response payload today (both rows *are*
  updated server-side regardless).
- Per Phase 3's flag for qa (Phase 5): manual click-through must include an over-threshold Sweep
  (pending → `ledger.approve` → posted round-trip) and a regression check of the Admin Checking ↔
  Petty Cash flow — both are exercised at the unit level here but still need the real
  click-through once ux-developer's form ships.
- The two Phase-1 UNDECIDED/deferred matrix cells (Administrative→Activity blocked,
  Administrative→Foundation "not enabled yet") each have their own dedicated `if` branch and their
  own unit test in `ledger-transfer-policy.test.ts` — a future Phase 6 override of either is a
  one-branch flip with an existing test slot to update, per the design's intent.

---

# Phase 4 — Implementation (UI) — 2026-07-29

**Owner:** ux-developer
**Status:** complete

### Summary

Built the client side of DECISION-058 exactly per the Phase 3 UI plan: `TransactionForm`'s single
`"transfer"` `FlowMode` is now two concrete modes, `"transfer"` ("Transfer (Move Cash Between
Accounts)") and `"sweep"` ("Sweep to Foundation"), gated by a new `crossEntityContext` prop that is
populated only on Club pages. No new component file — the existing form's amount/date/memo/actions
shell is shared across all modes, matching the design's "one dialog, two concrete flow-modes, not a
generic fund matrix" instruction. `[fundSlug]/page.tsx` fetches the Foundation's funds/bank
accounts/"Public donations"-eligible categories only when rendering for the Club entity
(`donationsDeductible === false`) with `ledger.record`, and only for the "Record Transaction"
create dialog (edit dialogs don't need it — the Type selector is hidden for pair edits regardless).
The Approvals page renders a pending Transfer/Sweep pair as a single badged "From → To" row using
the new `partnerFundId`/`partnerFundName`/`partnerEntityId` fields from `getPendingApprovals`.
`pnpm exec tsc --noEmit` is clean and the full existing test suite (832 tests, 33 files) stays
green — no UI unit tests were added since none were named in the Phase 3 design's test list (that
list was scoped entirely to api-developer's Phase 4).

### What I did

- **`src/components/admin/ledger/transaction-form.tsx`** (full rewrite of the transfer path, rest
  of the component's structure preserved):
  - `FlowMode` gained `"sweep"`; `FLOW_LABELS.transfer` relabeled "Transfer (Move Cash Between
    Accounts)"; new `sweep: "Sweep to Foundation"`.
  - Removed the old `sourceFundId`/`destFundId` state and the "From Fund"/"To Fund" pickers
    entirely — per the design, the allow-list collapses to exactly two shapes, so the fund is
    **implied**, never chosen: Transfer reuses the existing `fundId` state (same fund on both legs,
    already correctly defaulted via `defaultFundId` — e.g. opening "Record Transaction" from the
    Administrative Fund page defaults the Transfer to that fund, the sanctioned Petty-Cash-funding
    path); Sweep derives `sourceFundId`/`destFundId` automatically from `funds.find(kind ===
    'activity')` and `crossEntityContext.funds.find(kind === 'charitable')` — never user-selectable.
  - New per-leg bank-account pickers ("From Account" / "To Account"), rendered only for a NEW
    Transfer/Sweep (`!isEdit`): Transfer's "To Account" excludes whatever's picked in "From
    Account" (mirrors the old dest-fund-excludes-source-fund pattern); Sweep's "To Account" lists
    `crossEntityContext.bankAccounts` (a different entity, so no exclusion needed), defaulting to
    its `isDefault` account. A `useEffect` re-defaults "To Account" whenever the mode switches into
    Transfer/Sweep, and a second effect re-defaults it if the user's new "From Account" pick would
    collide with the current "To Account".
  - Generic single-bank-account picker (used by regular income/expense, and by editing a non-pair
    row) is now gated `!isTransferOrSweep` — it no longer renders at all for a new or existing
    Transfer/Sweep. This satisfies the design's explicit ask: "the edit form for `isEditingTransfer`
    should stop rendering the bank-account field entirely" — bank account is immutable
    post-creation for any pair (server silently ignores it now; the edit PATCH body omits
    `bankAccountId` entirely when `isEditingTransfer`, rather than sending a value the server drops).
  - Sweep-only fields: mandatory board-minute `<input>` (trim, 500-char cap, same shape/copy as the
    existing `ApproveDialog`'s field) and an optional Foundation-category `<select>` sourced from
    `crossEntityContext.categories` (pre-filtered server-side to `fundKind='charitable' &&
    flow='income'`), defaulting to blank = "let the server default to Public donations."
  - Two info boxes (no new copy invented beyond what Phase 1/3 specified): a neutral gray box for
    Transfer ("this fund's balance is unaffected; only the bank account holding the cash changes")
    and a blue box for Sweep spelling out the From/To funds and stating plainly that this records
    **two separate, permanent transactions** on two entities' books, never one atomic entry — the
    exact framing DECISION-058 requires.
  - **Sweep submission routes through `<ConfirmDialog destructive>`**, not a direct save — clicking
    "Record Sweep" runs client-side validation, then opens the confirm dialog (mirroring the
    existing `handleDelete`-via-`ConfirmDialog` pattern already used in `transaction-actions.tsx`);
    only the dialog's "Confirm Sweep" click actually POSTs. Transfer and regular income/expense save
    on the first submit, unchanged.
  - Client-side `validate()` mirrors every server-side check from the Phase 3 design (bank account
    required, Transfer no-op guard "same fund and same account", Sweep board-minute
    required/≤500 chars) so the common case never round-trips to the server just to fail.
  - `visibleFlowModes` hides `"sweep"` unless `crossEntityContext` is present AND both the Club's
    Activity fund and the Foundation's Charitable fund actually resolve, and hides `"transfer"`
    unless the current entity has ≥2 bank accounts — the wrong/unusable path is never offered as a
    UI option, not just disabled (Phase 1 adversarial-pass ask, restated in Phase 3).
  - Success/error handling: the existing `data.status === 'pending'` branch (already present, dead
    code for transfers before this change) is now live for both Transfer and Sweep — toast reads
    "Submitted (FY…) — awaiting board approval (over the disbursement threshold)" instead of
    claiming it posted. All non-2xx responses (400 validation, 403 blocked-direction policy reason)
    surface via the existing generic `toast.error(data.error ?? …)` catch — no swallowing, no new
    error-handling code needed since the server's `{ error: string }` shape was already handled
    generically.
- **`src/components/admin/ledger/transaction-form-dialog.tsx`**: added `crossEntityContext` to the
  props interface and plumbed it straight through to `TransactionForm`. No other changes — dialog
  chrome, title logic, and the edit-mode call sites are untouched.
- **`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`**: when `!isFoundationEntity && canRecord`
  (i.e., viewing the Club with recording rights), looks up the Foundation entity from the already-
  fetched `entities` list and fetches its `getFunds`/`getBankAccounts`/`getCategories({fundKind:
  'charitable', flow: 'income'})` in parallel, building the `crossEntityContext` object passed to
  the "Record Transaction" `TransactionFormDialog`. Foundation pages get `undefined` — Sweep mode
  simply never appears there. Edit dialogs (via `TransactionActions`) do not receive
  `crossEntityContext` — unnecessary, since the Type selector (and therefore Sweep) never renders
  in edit mode.
- **`src/app/(dashboard)/admin/ledger/approvals/page.tsx`**: the "Fund" column now checks
  `txn.partnerFundName` — when present (a pending Transfer/Sweep pair, deduped server-side to one
  row), it renders a small badge ("Sweep" if `partnerEntityId !== entityId`, else "Transfer") above
  a "SourceFund → PartnerFund" line; ordinary pending rows render exactly as before (just the fund
  name). No changes to `ApproveDialog`/`RejectTransactionDialog` — they already just POST to the
  same id-agnostic routes, which are pair-aware server-side (see Open Questions below for one
  wrinkle this surfaced).

### Outputs

- `src/components/admin/ledger/transaction-form.tsx` — mode split, cross-entity plumbing, Sweep
  confirm-dialog gate, per-leg bank-account pickers, board-minute + category fields.
- `src/components/admin/ledger/transaction-form-dialog.tsx` — `crossEntityContext` pass-through prop.
- `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — Foundation cross-entity data fetch, gated
  on Club + `canRecord`.
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx` — dedup'd From → To row rendering with a
  Transfer/Sweep badge.
- No schema changes, no new `FEATURES` key, no new npm dependencies — matches the Phase 2 folded
  architectural note.
- Verification: `pnpm exec tsc --noEmit` clean; `pnpm test` — 832 passed, 33 files, 0 failed
  (unchanged from api-developer's Phase 4 run — no UI unit tests were named in the Phase 3 design's
  test list, so none were added here). `pnpm lint` hits only the known pre-existing unrelated
  ESM/minimatch failure (confirmed, ignored per task constraints). `pnpm build:only` intentionally
  NOT run — qa's step.

### Open questions / handoff notes

- **Next: qa** for Phase 5 — typecheck/build are clean here, but this feature has never been
  clicked through in a browser. Per Phase 3's flag, the manual click-through must cover: (1) a
  same-entity Transfer (Admin Checking ↔ Petty Cash) under threshold — both legs posted
  immediately; (2) a Sweep under threshold — the `<ConfirmDialog>` copy, the board-minute
  requirement, the default-to-"Public donations" category behavior, and an explicit category
  override; (3) an over-threshold Sweep or Transfer — the pending → Approvals-page badge/From-To
  label → `ledger.approve` → posted round-trip; (4) a blocked direction attempted directly against
  the API (bypassing the UI's two concrete modes) — confirm the 403 policy reason surfaces via
  toast, not a generic error; (5) at 360px — the per-leg bank-account grid (`sm:grid-cols-2`)
  collapses to one column, and the Sweep info box/board-minute/category fields don't overflow.
- **Known, deliberately out-of-scope gap — the fund register's per-row label for a Sweep.** The
  Club-side fund register page (`[fundSlug]/page.tsx`'s transaction table) resolves a transfer
  row's "partner" via `partnerByGroupId`, built from `listTransactions(entity.id, …)` — an
  **entity-scoped** query. For a Sweep, the destination leg lives on the *Foundation's* entity, so
  this lookup will never find it, and the row falls back to the table's existing generic "Transfer"
  label/fallback (`partyLabel = partner ? fundNameMap.get(...) : "Transfer"` — the `"Transfer"`
  fallback branch, not a crash). A posted Sweep will therefore display correctly (amount, category,
  reconciliation — all independent of this lookup) but with a slightly generic "Transfer" badge
  instead of "Sweep" on the Club's Activity Fund register page. This was **not** in tech-lead's
  Phase 3 Implementation Order for ux-developer (which named exactly three files: the page-level
  `crossEntityContext` fetch, `TransactionForm`, and the Approvals page) — flagging it here rather
  than silently expanding scope. A follow-up would need a cross-entity partner lookup (by
  `transferGroupId` alone, not scoped to one entity) on that page.
- **`ApproveDialog`'s client-side board-minute requirement isn't aware of a Sweep's pre-set
  `boardMinute`.** The API (Phase 4 API section above) made the approve route's `boardMinute`
  "required only if the row doesn't already have one" specifically so a Sweep's creation-time
  citation survives an over-threshold approval. But `ApproveDialog` (unchanged per Phase 3's
  explicit "no new component needed for Approve/Reject") always requires a non-blank value
  client-side before enabling its Approve button — so in practice, an approver will always type
  *something*, which the server will then use to **overwrite** the Sweep's original board-minute
  text (the server can't distinguish "approver deliberately retyped it" from "approver typed a
  generic placeholder"). This doesn't break anything (the row still gets a valid, non-blank
  `boardMinute`), but it means the preservation fix's practical benefit is currently unreachable
  from the UI — the approver has no way to see the existing value or to explicitly leave it as-is.
  Flagging for tech-lead/Chris rather than fixing unilaterally, since Phase 3 explicitly scoped
  `ApproveDialog` as unchanged; a fix would show the transaction's existing `boardMinute` (if any)
  as placeholder/pre-filled text and relax the "must be non-blank to enable Approve" client check
  to match the server's actual rule.
- **New copy strings the Lions Club may want to refine:** "Transfer (Move Cash Between Accounts)"
  and "Sweep to Foundation" (Type selector labels); the Transfer info line ("Moving cash within the
  {fund} — this fund's balance is unaffected…"); the Sweep info box's two-books framing sentence;
  the Sweep `<ConfirmDialog>` title/description; the pending-over-threshold toast wording
  ("Submitted (FY…) — awaiting board approval (over the disbursement threshold)."). All are
  functional/plain-English rather than legal language, but the board may want house style applied.
- **UX decision:** chose NOT to expose a fund picker for Transfer mode at all (per Phase 3's "single
  fund is implied" note) — the fund is silently derived from `defaultFundId`/`funds[0]`, with a
  read-only info line naming it so the treasurer isn't left guessing which fund is affected. If a
  future fund other than Administrative gains a second bank account, this still works correctly
  (whichever fund's page the treasurer opened "Record Transaction" from), no code change needed.
- **UX decision:** Sweep's Foundation-category picker defaults to a blank "Public donations
  (default)" option rather than pre-selecting the actual "Public donations" `LedgerCategory` id —
  this keeps the submitted `destCategoryId` `undefined` unless the treasurer deliberately picks an
  override, letting the server's own default-resolution logic (and its defensive fallback-to-null
  if the seeded category is ever missing) stay the single source of truth, rather than duplicating
  that lookup client-side.

---

## Phase 5 — Verification — 2026-07-29

**Owner:** qa
**Status:** complete → **loop-back fix applied → RE-VERIFIED PASS**

### Loop-back resolution (orchestrator, 2026-07-29)

The Phase 5 FAIL (sweep board-minute overwrite) was fixed UI-only, exactly as qa scoped it:
- `src/components/admin/ledger/approve-dialog.tsx` — new optional `existingBoardMinute` prop; the
  input is **pre-filled** with the row's current citation; the client blank-required gate is relaxed
  to `(!boardMinute.trim() && !existingBoardMinute)` so a blank submit on an already-cited row is
  allowed (server preserves the original), while an ordinary disbursement still requires one. Label
  reads "(pre-filled from the original motion)" and help text explains leaving it as-is keeps the
  citation.
- `src/app/(dashboard)/admin/ledger/approvals/page.tsx` — passes `existingBoardMinute={txn.boardMinute}`
  (`getPendingApprovals` already returns `boardMinute`).
- **Regression coverage:** the server contract this now relies on is already unit-tested in
  `approve/route.test.ts` — "sweep w/ existing boardMinute + BLANK request → preserved" (line 180),
  "no boardMinute field → preserved" (193), "ordinary expense + blank → still 400s" (203). A client
  component test was NOT added: the project has no RTL/jsdom stack (`vitest environment: "node"`),
  so adding one is a separate infra decision, not part of this fix.
- **Re-verification:** `pnpm exec tsc --noEmit` clean; `pnpm test` 832/832 pass. Production build
  re-run at pre-push. The board-minute now survives sweep approval → **the FAIL item is resolved.**
- Cosmetic gap #1 (posted-sweep register label shows generic "Transfer") remains OPEN as a tracked
  ship-with-note follow-up — does not block.

**Post-fix verdict: PASS.**

### Original FAIL report (retained for the record)

**VERDICT: FAIL.** All four mechanical gates are green (tsc clean, 832/832 unit tests passing,
production build clean, dev server serves the affected routes without runtime error) and a
line-by-line code trace confirms every one of Phase 3's designed flows — Transfer, Sweep, all
seven blocked directions, the over-threshold pending→approve round-trip, category defaulting, and
the `PATCH ?both=true` bank-account-immutability fix — is implemented exactly as designed and is
covered by the unit suite. The fail is the second flagged gap: `ApproveDialog`'s client-side
"board-minute required, non-blank" gate makes the server's carefully-designed
preserve-the-Sweep's-creation-time-citation fix structurally unreachable in the shipped UI — every
real approval of a pending Sweep will silently overwrite its original board-motion reference with
new operator-typed text, with the approver never shown the original value. For a feature whose
entire cross-entity compliance story rests on the board-minute citation surviving to the posted
row, this is a books-integrity defect, not a cosmetic one. The first flagged gap (posted-Sweep
register label falling back to generic "Transfer") is confirmed real but cosmetic — does not
affect amount, category, reconciliation, or approval correctness — and does not itself justify a
FAIL.

### What I did

- Read the full work-log (Phases 1–4) and `docs/decisions.md` DECISION-058 end-to-end.
- Ran the four mechanical gates directly (not inferred from the implementers' self-reports).
- Read `src/lib/ledger-transfer-policy.ts` in full and confirmed it matches the Phase 3 sketch
  branch-for-branch (same fund → transfer; same-entity Activity↔Administrative → blocked, both
  directions, distinct reasons; cross-entity charitable-source → one-way-valve block;
  Activity→Charitable → sweep, `requiresBoardMinute: true`; Administrative→Charitable → deferred
  "not enabled yet" block; generic catch-all otherwise).
- Read `handleTransfer()` in `src/app/api/admin/ledger/transactions/route.ts` (lines 376–655) in
  full and traced every flow against it directly, rather than trusting the Phase 4 summary:
  fund lookup by id with no entity filter (confirms the dropped-client-`entityId` fix),
  `checkTransferDirection()` called immediately after and gating with 403 + policy reason,
  no-op guard narrowed to same-fund-AND-same-account, mandatory board-minute enforced
  pre-insert only when `requiresBoardMinute`, new bank-account ownership/active validation on
  both legs, Sweep dest-leg category resolution (explicit override validated against
  entity/fundKind/flow, or the seeded "Public donations" lookup by name/kind — no hardcoded
  UUID), threshold-derived `status` applied once to the pair, atomic two-row insert inside
  `db.transaction(...)`, E-1 email extended to the pending case.
- Read `POST .../[id]/approve/route.ts` in full: confirmed the pair-fetch-by-`transferGroupId`,
  both-pending 409 check, self-approval block keyed off shared `recordedByUserId`, and the
  boardMinute-preservation logic (`providedRaw ? providedRaw.slice(...) : txn.boardMinute`) exist
  exactly as designed, with both legs updated atomically.
- Read `src/components/admin/ledger/approve-dialog.tsx` in full — this is where the second flagged
  gap was adjudicated (see below).
- Read the `PATCH .../[id]/route.ts` bank-account handling (`body.bankAccountId !== undefined &&
  !existing.transferGroupId` gate, line 337) — confirmed `bankAccountId` is unconditionally
  ignored for any pair leg, independent of `?both=true`, matching the design's "immutable
  post-creation" requirement.
- Read the fund-register partner-lookup code in `[fundSlug]/page.tsx` (lines 180–201, 369–373) —
  confirmed the first flagged gap directly: `listTransactions(entity.id, …)` is entity-scoped, so
  a Sweep's Foundation-side leg is never in `allRelatedTxns`, so `partnerByGroupId` never resolves
  it, so the row falls back to the generic `"Transfer"` label. Amount, category, and reconciliation
  for that row are all independent of this lookup and unaffected.
- Read the Approvals page dedup rendering (`approvals/page.tsx` lines 147–162) — confirmed the
  From→To badge correctly distinguishes "Sweep" (`partnerEntityId !== entityId`) from "Transfer".
- Read `transaction-form.tsx`'s account-picker and Sweep-copy sections — confirmed
  `grid grid-cols-1 sm:grid-cols-2` on the From/To account pickers (collapses to one column below
  the `sm` breakpoint, i.e. at 360px), `<ConfirmDialog destructive>` used for Sweep submission with
  the required two-books irreversibility copy, and no native browser dialogs anywhere in the diff.
- Did **not** write new Playwright specs. Given (a) strong existing unit coverage that already
  exercises every named flow (144 tests across the 7 new/changed files, confirmed passing), (b) no
  existing e2e ledger-transfer fixture to build on, and (c) the explicit instruction to avoid adding
  shared-DB-mutating specs without a disposable fixture, I used direct code trace against the live
  route/component source instead of a fresh e2e harness for the flows the runner doesn't already
  cover. This is noted per the "reasoned code-trace verification, said so explicitly" instruction,
  not represented as an actual browser run.

### Outputs

#### Type Check
`pnpm exec tsc --noEmit`: **PASS** (clean, no output).

#### Unit Tests
`pnpm test`: **PASS**
Total: 832 | Passed: 832 | Failed: 0
Files: 33
Duration: ~932ms (932ms reported by vitest; transform/import overhead ~8.5s)
Failures: none.

#### Production Build
`pnpm build:only`: **PASS**
Notes: full route manifest printed cleanly, including every `/api/admin/ledger/transactions*`
route and `/admin/ledger/[fundSlug]`/`/admin/ledger/approvals`; no errors or warnings in the build
output (grepped explicitly for `error|fail|warn`, none found beyond the route markers themselves).
This is the first `build:only` run since the feature landed — it had not been run by either
implementer (both deferred it to qa per their own Phase 4 notes), and it is clean.

#### End-to-End Tests
`pnpm test:e2e`: **NOT RUN** — no existing spec covers ledger transfers/sweeps, and per task
instructions I did not author a new Playwright spec that would mutate live ledger data without a
disposable fixture (none exists for this feature yet, and building one was out of scope for this
pass). Behavioral verification instead performed via direct code trace against the live route/
component source (see What I did and Feature-Gate Audit) plus a dev-server route-availability
smoke test. This is a code-trace substitute, not an e2e run — flagged explicitly per the "manual
smoke when the runner can't run" principle.

#### Dev-Server Smoke
Dev server (already running on :3000) responds without runtime error:
- `GET /` → 200
- `GET /signin` → 200
- `GET /admin/ledger/approvals` → 307 → `/signin?callbackUrl=%2Fadmin%2Fledger%2Fapprovals` (expected — no session cookie in this curl session; this is the correct unauthenticated redirect, not a crash)
- `/admin/ledger/[fund]` not curl-tested unauthenticated beyond the same redirect pattern (same auth gate, same route group) — no runtime error surfaced by the build or by loading `/`.

No 500s, no Next.js error overlays, no unhandled route errors observed.

### Per-Flow Verification (code trace against live source, cross-referenced against passing unit tests)

| Flow | Result | Notes |
|---|---|---|
| Transfer (Admin Checking → Petty Cash, same fund, distinct accounts) | **PASS** (code trace + unit test) | `checkTransferDirection` returns `{allowed:true, mode:'transfer', requiresBoardMinute:false}` on `sourceFundId===destFundId`; `handleTransfer` inserts two rows with the client-supplied distinct `sourceBankAccountId`/`destBankAccountId`, no board-minute required, `categoryId:null` both legs. Covered by `route.test.ts`'s per-leg bank-account persistence + Admin↔Petty-Cash regression tests. |
| Sweep (Activity → Foundation) | **PASS** (code trace + unit test) | Blank `boardMinute` → 400 pre-insert, confirmed in `handleTransfer` (lines 471-480) regardless of amount. Dest leg category resolves to the seeded "Public donations" `charitable`/`income` category by name/kind when `destCategoryId` omitted, or validates+uses an explicit override; source (Activity) leg stays `categoryId:null`. `<ConfirmDialog destructive>` with the two-books irreversibility copy confirmed present in `transaction-form.tsx` (line 945-951). |
| Blocked directions (Activity→Administrative, Foundation→Club any, Administrative→Activity, Administrative→Foundation, same-account no-op) | **PASS** (code trace + unit test) | Each has its own distinct branch/reason string in `ledger-transfer-policy.ts`, returned as `403` with `direction.reason` from `handleTransfer`; same-account no-op is a separate `400` check (line 461-466), correctly narrowed to fund-AND-account equality, not fund alone. All nine matrix-cell branches confirmed read directly against the file; `route.test.ts`/`ledger-transfer-policy.test.ts` assert the exact reason strings. |
| Over-threshold approval round-trip | **PASS** (code trace + unit test) | `derivedStatus` computed once from `settings.disbApprovalThresholdCents` and applied to both legs inside the same `db.transaction`; `getPendingApprovals` dedups the pair to one row carrying `partnerFundId`/`partnerFundName`/`partnerEntityId`; Approvals page renders one From→To row with a Sweep/Transfer badge (confirmed at `approvals/page.tsx:147-162`); `approve`/`reject` routes fetch the partner by `transferGroupId`, require both `pending`, and update both atomically in one `db.transaction`. Toast copy for the pending case reads "Submitted (FY…) — awaiting board approval," not "posted" (confirmed in `transaction-form.tsx`'s success-handling branch). |
| 360px layout (Transfer/Sweep form + Approvals row) | **PASS** (code trace) | From/To account pickers use `grid grid-cols-1 sm:grid-cols-2` — single column below the `sm` (640px) breakpoint, i.e. at 360px. Approvals row badge/label is a `<span>`/text stack, not a fixed-width table cell forcing horizontal scroll. Not visually screenshotted at 360px in a real viewport — flagging as code-trace-only, not a rendered-pixel confirmation. |

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `POST /api/admin/ledger/transactions` (transfer path) | yes (unchanged, gates the whole route before dispatch to `handleTransfer`) | yes | `FEATURES.LEDGER_RECORD` — correct, mutation of Club/Foundation cash position |
| `POST /api/admin/ledger/transactions/[id]/approve` | yes | yes | `FEATURES.LEDGER_APPROVE` — correct, distinct from record; second-signer control preserved for pairs |
| `POST /api/admin/ledger/transactions/[id]/reject` | yes | yes | `FEATURES.LEDGER_APPROVE` — correct, same rationale |
| `PATCH /api/admin/ledger/transactions/[id]` | yes (unchanged) | yes | `FEATURES.LEDGER_RECORD` (or approve-equivalent, unchanged from pre-existing gate) — this feature only narrowed which fields `?both=true` may touch; did not change the gate itself |
| `GET` (page) `/admin/ledger/[fundSlug]` cross-entity data fetch | yes (page-level `auth()`, pre-existing) | yes, gated additionally on `canRecord` before fetching Foundation data at all | `FEATURES.LEDGER_RECORD` — correct; view-only users never trigger the extra Foundation fetch |
| `getPendingApprovals()` / Approvals page | yes (page-level) | yes (unchanged) | `FEATURES.LEDGER_APPROVE` (view path) — correct, no new exposure introduced by the dedup change |

No new routes were added by this feature (extends `handleTransfer` in place, per DECISION-058); no
new `FEATURES` key was introduced (per Phase 2's folded architectural note). All gates verified by
reading the route files directly, not inferred from passing tests.

### Regression Tests Added

None added by qa — every regression named in the Phase 3 design doc was written by api-developer
in Phase 4 (per CLAUDE.md's Phase 4 gate: "every unit test named in the Phase 3 design doc is
written and passing — the implementer delivers these, not qa"), and confirmed still passing in this
pass:
- `boardMinute` preservation on approve when the field is left blank/absent — `[id]/approve/route.test.ts`
- Ordinary-expense regression: blank `boardMinute` still 400s when no prior value exists — same file
- `PATCH ?both=true` no longer touches `bankAccountId` for a pair leg — `[id]/route.test.ts`
- Per-leg bank-account persistence (the "own bank account per leg" core requirement) — `route.test.ts`
- `getPendingApprovals` dedup (pair → one row; ordinary row → null partner fields; mixed batch) — `ledger-queries.test.ts`

qa did not add new regression tests this pass because the gap found (below) is a UI defect qa is
handing back, not a defect qa is confirmed-fixing here — writing the regression test belongs with
the fix, per the "regression test before the fix, watch it fail" discipline; a Vitest unit test
can't reach `ApproveDialog`'s client-side disabled-state logic in this repo's current test setup
(no component-level testing library configured in `vitest.config.ts` for this file), so the
follow-up test is more naturally a small Playwright spec or a manual click-through re-check once
the fix lands — noted for whichever agent picks up the fix.

### Coverage on Critical Modules

Not separately re-run with `--coverage` this pass — the three modules this review normally tracks
(`src/lib/events.ts`, `src/lib/permissions.ts`, `src/lib/members.ts`) are untouched by this feature.
The feature's own new pure module, `src/lib/ledger-transfer-policy.ts`, has one unit test per
matrix-cell branch (9 tests, `ledger-transfer-policy.test.ts`) — every `if` branch in the file is
exercised, i.e. 100% branch coverage by construction (confirmed by reading the file against the
test list, not by running `--coverage` this pass).

### Gap Adjudication

**Gap 1 — Posted-Sweep register label ("Transfer" instead of "Sweep").**
**Confirmed real, via code trace** (`[fundSlug]/page.tsx:180-201,369-373`): `partnerByGroupId` is
built from `listTransactions(entity.id, …)`, an entity-scoped query; a posted Sweep's partner leg
lives on the Foundation's `entityId`, so it's never in that result set, and the row's `partyLabel`
falls back to the generic `"Transfer"` string. **Severity: cosmetic.** Amount, category, status,
and reconciliation for that row are all correct and entirely independent of this lookup — a
treasurer reading the Club's Activity Fund register sees a real, correctly-valued row, just
labeled generically instead of "Sweep." **Verdict: does not block PASS on its own** — recommend a
follow-up ticket (not urgent) for a `transferGroupId`-only cross-entity partner lookup on that page.

**Gap 2 — Sweep approval board-minute overwrite. Confirmed real, via code trace, and FAIL-worthy.**
Traced end-to-end:
1. `POST .../[id]/approve/route.ts` (lines 109-117): `const boardMinute = providedRaw ?
   providedRaw.slice(0, 500) : txn.boardMinute;` — correctly falls back to `txn.boardMinute` **only
   when `providedRaw` is empty**.
2. `ApproveDialog` (`approve-dialog.tsx`): the Approve button is `disabled={submitting ||
   !boardMinute.trim()}` (line 114), and the input starts empty with no pre-fill from the
   transaction's existing `boardMinute` — there is no prop passed to this component carrying the
   transaction's current `boardMinute` value at all (its props are `transactionId`, `amount`,
   `party`, `children` — nothing else). The approver has no way to see the Sweep's original
   citation and **must** type *some* non-blank text to enable the button at all.
3. Therefore `providedRaw` is **never** empty for any approval that actually completes through this
   dialog — the `: txn.boardMinute` fallback branch in the route is dead code in practice, reachable
   only via a direct API call that bypasses the UI entirely (which the design correctly still
   supports, but which no operator will do through the shipped product).
4. **Actual behavior:** every time an approver approves a pending Sweep (or any over-threshold
   Transfer/Sweep) through the shipped UI, whatever text they type — a re-transcription, an
   abbreviation, a different/wrong meeting date, a placeholder — **silently replaces** the original
   board-minute citation that was recorded at Sweep creation time under the actual board motion that
   authorized the cross-entity gift. Nothing errors; the row ends up with a valid, non-blank
   `boardMinute`, so no test built around "does approval succeed" or "is boardMinute non-null after
   approval" would ever catch this — which is exactly why the task called this out as untestable by
   happy-path assertions.

**Severity: HIGH — books-integrity/compliance defect, not cosmetic.** The mandatory board-minute
requirement is the entire point of the Sweep mechanism (Phase 1: "mandatory board-minute regardless
of amount," reused specifically because it's the citation a 501(c)(3)/501(c)(4) audit trail depends
on for a permanent, irreversible cross-entity gift). The Phase 4 API work correctly built a
preservation mechanism specifically to protect that citation through the approval step, and the
Phase 4 UI work — by its own admission in this same work-log's "Open questions" section — shipped
without wiring it up, leaving the fix practically unreachable. This is precisely the class of
defect this pipeline's Phase 5 exists to catch before Phase 6 sign-off: happy-path tests (approve
succeeds, row ends up posted with a board-minute) pass either way.

**Verdict: FAIL.** This loops back to **Phase 4 (ux-developer)** — not Phase 3, since the design's
intent (preserve the creation-time citation) is correct and does not need to change; the fix is
UI-only: `ApproveDialog` needs the transaction's current `boardMinute` passed in as a prop, shown as
the input's initial value or placeholder (not just placeholder example text, which it currently
is), and the "must be non-blank to enable Approve" client check relaxed to match the server's actual
rule (non-blank OR a pre-existing value already present) — exactly as ux-developer's own Phase 4
notes proposed but did not implement. This is not a new design question; it is completing work
already scoped and already flagged.

### Open questions / handoff notes

- **Next: ux-developer** (Phase 4, loop-back) — fix `ApproveDialog` per the Gap 2 adjudication
  above: accept and pre-fill/display the transaction's existing `boardMinute` (a small prop plumbed
  through from `approvals/page.tsx`, which already has the full transaction row in scope), and relax
  the client-side disabled-check to allow submitting with the field left as-is when a value already
  exists. Write the regression test **before** the fix per this project's discipline — the natural
  form is either a small Playwright spec driving the Approvals page's Approve dialog for a
  pre-seeded pending Sweep fixture (clean up the fixture after), or, if no e2e fixture exists yet
  for this feature, a component-level test if the harness supports one; confirm with whichever
  agent picks this up which is more practical in this repo's current test setup.
- Gap 1 (register label) does not block Phase 4 re-entry — recommend logging it to
  `docs/backlog.md` as a low-priority follow-up (cross-entity partner lookup on the fund register
  page) rather than bundling it into the Gap 2 fix, since Phase 3 explicitly scoped it out of
  ux-developer's original three files.
- Once the Gap 2 fix lands, this feature does **not** need to re-run the full Phase 1-3 pipeline —
  only a re-verification of the fixed `ApproveDialog` flow (the specific regression test above,
  plus re-confirming the mechanical gates still pass) is needed before returning to qa for a second
  Phase 5 pass.
- All other behavior verified in this pass (Transfer, Sweep creation, all blocked directions, the
  threshold-routing mechanics themselves, category defaulting, `PATCH` immutability, `getPendingApprovals`
  dedup) is correct and does not need to be re-litigated in the next Phase 5 pass — only Gap 2's fix
  needs fresh verification.
- Manual, human-in-a-real-browser click-through (Google OAuth session, actual clicking through the
  Sweep confirm dialog, actual 360px viewport screenshot) was **not** performed this pass — everything
  above is either an automated gate or a direct code trace. If Chris wants belt-and-suspenders
  confirmation before Phase 6, a short manual click-through of the Sweep + over-threshold-approval
  flow in a real browser session is recommended, especially to visually confirm the 360px layout
  claim.

---

# Phase 6 — Shipped vs Intent — 2026-07-29

**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

The shipped feature delivers exactly the deny-by-default allow-list Chris locked in Phase 1 —
Petty Cash can finally be funded, the Foundation sweep is representable and board-minute-gated,
the four hard blocks are enforced server-side with specific reasons, over-threshold pairs now
route to approval atomically, and the Phase 5 board-minute-overwrite defect is actually fixed in
the shipped code — with one confirmed cosmetic label gap and one confirmed intentional deferral
surviving as tracked notes, neither of which touches money, compliance, or audit-trail integrity.

## Verification Method

Re-read the full work-log (Phases 1–5) and DECISION-058, then independently spot-checked the
claims against the live code rather than trusting the self-reports:

- Read `src/lib/ledger-transfer-policy.ts` in full — every branch matches the Phase 1 matrix and
  the Phase 3 sketch line-for-line.
- Read `handleTransfer()` in full (`src/app/api/admin/ledger/transactions/route.ts:376-672`) —
  traced the fund lookup, `checkTransferDirection()` call, no-op guard, board-minute requirement,
  bank-account ownership/active validation, category resolution, threshold-derived status, atomic
  two-row insert, and E-1 email extension directly against source.
- Read `POST .../[id]/approve/route.ts` and `.../reject/route.ts` in full — confirmed pair-fetch,
  both-pending 409, self-approval/rejection block, atomic dual update, and the
  `providedRaw ? providedRaw.slice(...) : txn.boardMinute` preservation fix.
- Read `src/components/admin/ledger/approve-dialog.tsx` in full — confirmed the Phase 5 fix:
  `existingBoardMinute` prop, pre-filled input state, relaxed disabled-check
  (`!boardMinute.trim() && !existingBoardMinute`), and the "(pre-filled from the original motion)"
  copy.
- Read `src/app/(dashboard)/admin/ledger/approvals/page.tsx` — confirmed
  `existingBoardMinute={txn.boardMinute}` is actually passed to `ApproveDialog`, and the
  Sweep/Transfer badge + From→To label render off `partnerFundName`/`partnerEntityId`.
- Read `src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx` — confirmed the cosmetic register-label
  gap directly (`listTransactions(entity.id, ...)` is entity-scoped, so a Sweep's Foundation-side
  leg is never in `partnerByGroupId`, falling back to the generic `"Transfer"` string, not a crash).
- Read `transaction-form.tsx`'s `canTransfer = bankAccounts.length >= 2` and `visibleFlowModes` —
  confirmed Transfer mode surfaces on the Administrative fund page (2 bank accounts: Admin Checking
  + Petty Cash), making Admin Checking → Petty Cash representable and clickable for the first time.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (832/832 passed, 33 files) independently —
  did not rely on qa's reported numbers alone.
- Confirmed `docs/decisions.md` DECISION-058 is logged and matches the shipped shape.

## Intent-vs-Shipped Diff

| Phase 1 / locked decision | Shipped | Verdict |
|---|---|---|
| Directional matrix: ALLOW same-fund/different-account Transfer; ALLOW Activity→Foundation Sweep (mandatory board-minute); BLOCK Activity→Administrative, Foundation→Club (any), Administrative→Activity, Administrative→Foundation, same-account no-op — each with a specific reason | `checkTransferDirection()` implements exactly these nine branches, each with the exact policy wording from Phase 1's Flows/matrix sections, enforced server-side in `handleTransfer` (403 with `direction.reason`) | **Matches** |
| `entityId` derived server-side from the funds, not client-trusted (adversarial-pass finding) | Fund lookup is `inArray(ledgerFunds.id, [sourceFundId, destFundId])` with no entity filter; `entityId` is not read from the request body at all | **Matches** |
| Cross-entity sweep requires a mandatory board-minute and categorizes the Foundation income leg (default "Public donations") | `boardMinute` required pre-insert when `direction.requiresBoardMinute`; dest-leg `categoryId` resolves to the seeded "Public donations" `charitable`/`income` category by name/kind, or a validated explicit override; source leg stays categoryless | **Matches** |
| Over-threshold routes both legs to pending; approval is pair-aware and atomic | `derivedStatus` computed once from `disbApprovalThresholdCents`, applied to both legs inside one `db.transaction`; approve/reject fetch the partner by `transferGroupId`, require both pending, update both atomically | **Matches** |
| Petty Cash can now be funded (Admin Checking → Petty Cash sanctioned) | Same-fund/different-account guard correctly narrowed; `canTransfer = bankAccounts.length >= 2` surfaces Transfer mode on the Administrative fund page, the only page with 2 bank accounts today | **Matches** |
| Phase 5 board-minute fix: `ApproveDialog` pre-fills the existing citation, doesn't force an overwrite | `existingBoardMinute` prop plumbed from `approvals/page.tsx` (`txn.boardMinute`) → pre-fills input state → relaxed disabled-check → blank submit preserves server-side original; non-blank submit re-sends the same or an intentionally edited value | **Matches** |
| Naming: same-entity = "Transfer", cross-entity = "Sweep"; UI never offers a mis-clickable generic fund matrix | `TransactionForm` presents exactly two concrete modes gated by `canTransfer`/`canSweep`; Approvals page badges "Sweep" vs "Transfer" off `partnerEntityId !== entityId` | **Matches** |
| Sweep submission is functionally irreversible and must say so; no native browser dialogs | `<ConfirmDialog destructive>` gates Sweep submission with two-books irreversibility copy; no `window.confirm` anywhere in the diff | **Matches** |
| Administrative → Foundation: analyst recommended ALLOW ("Donate to Foundation"); Chris directed deny-by-default | Blocked with its own dedicated reason string ("not enabled yet — flagged for a future board decision"), not folded into the generic catch-all — a one-branch flip with an existing test slot if Chris overrides later | **Matches (flagged, not a defect)** — see Follow-ups #1 |
| Fund register shows each leg's real partner fund name | Same-entity Transfer legs resolve correctly; a **posted** Sweep's Club-side row falls back to a generic "Transfer" label because the partner lookup is entity-scoped and the Foundation leg lives on a different entity | **Acceptable drift (cosmetic)** — see Follow-ups #2 |

## Edge Cases

| Check | Result |
|---|---|
| Empty state (entity with one bank account) | pass — `canTransfer`/`canSweep` gates hide the mode entirely rather than showing an unusable single-option picker; matches Phase 1's flagged empty-state note |
| Failure microcopy | pass — every blocked direction, missing board-minute, inactive/wrong-entity bank account, and no-op case returns a specific, human-readable reason surfaced via `toast.error`, not a stack trace or generic "not allowed" |
| Permission gate | pass — `LEDGER_RECORD` gates recording (unchanged), `LEDGER_APPROVE` gates approve/reject (unchanged); no new `FEATURES` key introduced, matching the Phase 2 folded ruling; verified directly in each route file, not inferred |
| Mobile (360px) | pass (code-trace only, not a rendered screenshot) — `grid grid-cols-1 sm:grid-cols-2` on the per-leg bank-account pickers collapses to one column below `sm`; qa flagged the same caveat (no real-viewport screenshot taken) — acceptable given the layout primitive is the same one used elsewhere in the ledger UI |
| Brand consistency | pass — cards/buttons unchanged `rounded-2xl`/`rounded-lg`; Sweep submission routes through `<ConfirmDialog destructive>`, not `window.confirm`; `lions-blue`/`lions-gold` focus/hover states preserved in `approve-dialog.tsx` and `transaction-form.tsx` |
| Reconciliation | pass — confirmed in Phase 1/3/5 and unchanged: `getCandidateTransactionsForMatching` scopes by `bankAccountId` alone, so each leg reconciles independently against its own account's statement with zero code change |
| Google Group sync / OAuth-vs-password / access-pending | not applicable — admin-only, `ledger.record`-gated action, no member/committee surface touched (as scoped in Phase 1) |

## Follow-ups (tracked, since this ships as SHIP WITH NOTES)

1. **Administrative → Foundation remains BLOCKED (deny-by-default) — confirmed correctly flagged,
   not a defect.** Chris's Phase 1 directive was explicit: proceed deny-by-default, flag every
   defaulted call for a Phase 6 override. The analyst's original recommendation (ALLOW, framed as
   "Donate to Foundation," distinct from "Sweep") is preserved verbatim in `ledger-transfer-policy.ts`'s
   comment and reason string, and has its own dedicated branch + unit-test slot rather than being
   folded into the generic catch-all — exactly so a future override is a one-branch flip. **This
   does not block SHIP.** It is Chris's call to make when/if the Club wants to formally gift its
   own operating money to the Foundation; no code change is needed to leave it as-is today.
2. **Cosmetic: a posted Sweep shows a generic "Transfer" label in the Club's Activity Fund
   register**, instead of "Sweep," because `[fundSlug]/page.tsx`'s partner lookup
   (`listTransactions(entity.id, ...)`) is entity-scoped and a Sweep's destination leg lives on the
   Foundation's `entityId`. **Confirmed cosmetic** by direct code trace: amount, category, status,
   and reconciliation for that row are entirely independent of this lookup and are all correct — a
   treasurer reading the register sees a real, correctly-valued row, just under a generic instead of
   a specific label. **Becomes a tracked follow-up**, not a blocker: a future pass should replace the
   entity-scoped partner lookup with a `transferGroupId`-only lookup (no entity filter) on that one
   page, mirroring the fix already made to `handleTransfer`'s own fund lookup. Recommend logging to
   `docs/backlog.md` as low-priority — it is display-only and does not affect any number a treasurer
   or auditor relies on.

Neither follow-up involves money movement, permission gating, or data integrity — both are
UI/policy framing items that were explicitly scoped, flagged, and reasoned about at every prior
phase, which is exactly the discipline this pipeline is supposed to produce.

## What's Working

- **The self-targeting hole Phase 1 called "load-bearing" is closed.** Before this feature, a
  `ledger.record`-only user could move money of any size — including a full cross-entity
  disbursement — with zero second-signer review. Confirmed in the shipped code: the threshold
  check now applies to the pair exactly as it applies to an ordinary expense, and the atomic
  `db.transaction` means both legs are always in the same state.
- **The adversarial-pass concern about a client-trusted `entityId` is closed, not just
  documented.** The fund lookup by id alone, with entities derived from the returned rows, is
  exactly the fix the Phase 1 review called for — and it's what makes the cross-entity Sweep
  representable in the first place.
- **The Phase 5 FAIL was a real, correctly-scoped loop-back, and the fix actually lands.** This is
  worth noting explicitly: the loop-back stayed at Phase 4 (ux-developer), did not require
  re-opening Phase 3's design, and the fix — pre-fill + relaxed client gate — is exactly what qa's
  adjudication specified. Verified by reading the component, not by trusting the "RE-VERIFIED PASS"
  label.

## Open Questions / Handoff Notes

- Log Follow-up #2 (register label) to `docs/backlog.md` as a low-priority item — not done here,
  since Phase 6 issues the verdict rather than filing backlog entries directly, but this is the
  next concrete action.
- Follow-up #1 requires no code change unless/until Chris makes an affirmative call to enable
  Administrative → Foundation; no action needed to keep shipping as-is.
- This closes the pipeline for `2026-07-29-ledger-account-transfers`. No further phases are
  required.

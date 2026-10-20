# Itemized Sweep and Public Funds (B-172) — Work Log

> **Slug:** `2026-10-16-itemized-sweep-public-funds`
> **Backlog:** B-172 (HIGH); touches B-34 (remaining scope: roll-up double-count), B-120 (Zeffy donation import), B-23 (batch match), B-36 (posted Sweep label), B-104 (reconciliation pointer work)
> **Reserved IDs:** DECISION-126 and DECISION-127 (filed 2026-10-17 as Proposed); backlog B-190 to B-197 (filed 2026-10-17); B-198 and B-199 filed at the Inc 1 release (next free id is B-200)
> **Release record:** Increment 1 is at release prep as **v1.99.0** (2026-10-17): Phase 5 PASS, Phase 6 SHIP WITH NOTES (N1 and N2 landed), release notes written, DECISION-127 Resolved for Inc 1, DECISION-126 still Proposed. Awaiting the user's approval to commit and push. Increment 2a is next; before it opens the user confirms the prior-year sweep default (Phase 3 ruling 11) and the treasurer answers B-199. B-172 stays open until the B-172-wide Phase 6 after 2b. **2026-10-19: 2a Phase 3 confirmed against the as-built Inc 1 (11 amendments, A1 to A11, in the 2a work-log; the parent's 2a design holds except where they differ).** Next free backlog id: B-200.
> **Increment work-logs:** `2026-10-17-itemized-sweep-inc1-rename-and-mirrors.md`, `2026-10-17-itemized-sweep-inc2a-sweep-batch-core.md`, `2026-10-17-itemized-sweep-inc2b-sweep-batch-ui.md`
> **Surface:** (dashboard) admin — The Ledger (`/admin/ledger`): register, transfer/sweep entry, categories, funds, reconciliation, acknowledgments. No public or member-portal surface expected; `/members/impact` and `/members/financial-reports` are read-side consumers whose totals must not double-count.
> **Permission(s):** expected to reuse `ledger.record` (build and post a sweep), `ledger.manage` (fund rename, category catalog, void or reopen a batch), `ledger.approve` (over-threshold batch, DECISION-058 pair rule). Analyst confirms whether any new key is needed.
> **Estimated complexity:** large
> **Pipeline mode:** Full. Expected to ship in increments, each with its own work-log once Phase 3 slices it (candidate split: (1) Public Funds rename + Activity catalog mirrors the Foundation's charitable setup; (2) sweep batch table, per-gift copy, swept marker, total validation; (3) group reconciliation of N Foundation rows against one bank credit). Phase 1 refines the whole feature once; later increments link back here.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-16 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-17 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer named per increment | 2026-10-17 |
| 4 — Implementation | per increment (Inc 1: database-admin → api-developer → ux-developer) | Complete for Inc 1, 2a and 2b (see increment work-logs) | — | 2026-10-19 |
| 5 — Verification | qa | Complete per increment (Inc 1 PASS 2026-10-17; 2a PASS and 2b PASS 2026-10-19; named e2e deferrals are a pre-push gate, see Phase 6) | PASS | 2026-10-19 |
| 6 — Shipped vs intent | analyst | Complete: the one B-172 Phase 6 across Inc 1, 2a and 2b (below). Release gate: `/pre-push` must see `ledger-approvals-cosign` past L10 and the deferred specs green on :3000. Notes N1 to N3 become B-206 to B-208. | **SHIP WITH NOTES** | 2026-10-19 |

---

## Intent (orchestrator, 2026-10-16)

**Request (user, 2026-10-16):** start B-172 — "treat the public fund (activity fund) like the foundation and make sweeps copy the entries over."

**Value.** One Zeffy organisation serves both the Club and the Foundation and pays out to the Club's bank, so every online dollar (tickets, donations, White Cane, the Santa's Workshop extra donation) lands in the Club's Activity fund first and only the Foundation's share is swept across. Today a sweep is one Transfer/Sweep pair (DECISION-058): one Activity expense leg and one anonymous lump Foundation Charitable income leg. The Foundation is the receipt issuer (DECISION-112), yet its register, donor history, acknowledgments and 990 cannot see the gifts that make up the lump; the treasurer re-keys or loses donor, date, cause and category. The itemized sweep is the normal path for all online money, not an edge case.

**Wanted (from backlog B-172, verbatim scope):**
- (a) Foundation Charitable rows carry the same information a hand-entered Foundation gift carries (donor, party, date, amount, category, cause, memo, payment method, acknowledgment eligibility).
- (b) A sweep is built by selecting the unswept Activity gifts and copying each one into the Foundation as its own income row, then showing and validating the total, which becomes the single physical bank transfer (one Activity expense leg, one Foundation bank-side credit matching the real transfer).
- (c) A "swept" marker on the Foundation rows linking back to the source Activity row and the sweep batch, so they can be selected together and reconciled as a group against the one bank credit.
- (d) Rename the Activity fund to "Public Funds" (DECIDED 2026-10-12, user), description noting it is the Lions International "Activities account". Rename the stored name in `ledger_funds`, never `kind = 'activity'` (consulted by `ledger-transfer-policy.ts` and `ledger-fund-move-policy.ts`). "Activity Fund" is hard-coded in user-facing strings in 31 source files (as of 2026-10-16) plus CLAUDE.md and release notes; UI copy must read the stored name or be updated in the same release. The production rename is a data write through an audited path or the admin fund editor, never hand SQL.
- (e) The Activity fund carries the same categories and charitable setup data as the Foundation's Charitable fund (`counts_as_giving`, `ack_not_required`, 990 line, causes), so a gift is complete at entry and the copy is a field-for-field mapping.

**Phase 1 must settle (from the backlog):** (1) double-counting between Club Activity income and Foundation Charitable income, and B-34(b)'s consolidated roll-up; (2) which side issues the acknowledgment and that a copied row never produces a second receipt; (3) N itemized Foundation rows matching ONE bank credit (B-23, B-104); (4) Zeffy fees and tips when the transferred amount differs from the sum of gifts; (5) idempotence: a gift is swept once, a batch is reopened or voided only through an audited path, the existing `sweep-prefill-launcher.tsx` and `?sweepFrom=` deep link are folded in; (6) over-threshold approval once per batch with one minute reference per batch; (7) sequencing with B-120 (Zeffy import creates the Activity rows with Zeffy ids) and B-34(a)'s dedicated categories; (8) how the two category catalogs stay in step (seeded mirror with a `mirrors_category_id` link, or one shared definition), and the copy refuses an Activity category with no Foundation counterpart rather than falling back to `Public donations`.

**Facts already settled (do not re-open):** Zeffy structure confirmed by the user 2026-10-12; the rename to Public Funds is decided; `sw_orders.amount_cents` holds the whole payment and the per-item amounts (`ticket` vs `additional_donation`) are in the stored `zeffy_events` payload for mapped campaigns (Slice 1 note); prior-year gifts stay not movable (treasurer, 2026-10-02); the Club-to-Foundation mirror is not a Move (B-96/B-98).

**User verbs (orchestrator's first cut, analyst to refine):** treasurer selects unswept gifts, reviews the per-gift copy, confirms the total against the bank transfer, posts the batch; an approver approves an over-threshold batch once; a `ledger.manage` holder renames the fund, maintains the mirrored catalog, voids or reopens a batch with a reason; the treasurer reconciles the batch as a group against one bank credit.

---

# Phase 1 — Functional Refinement (analyst)

*Read-only review, 2026-10-16. No database was queried and no code was changed. Everything below that is stated about the code was read in `src/` on this date; anything about production data is deferred to the Verify-First block at the end.*

## VERDICT

**READY WITH NOTES.** The feature is well-shaped and the eight Phase 1 questions all have a recommended answer. There is no BLOCKING FACT: none of the open items changes *which* feature gets built, only seed data, a date convention or a guard. Six items go to Phase 2/3 as inputs (section "Handoff to Phase 2") and seven are treasurer or board choices with a stated default (section "Open Questions").

## ONE-LINE TAKE

> Turn the Club's pass-through fund into "Public Funds" and replace the anonymous lump sweep with a batch that copies each Foundation-bound gift, as an ordinary Foundation income row linked back to its source, so the Foundation's donor history, receipts and 990 see the real gifts while exactly one Club debit and one Foundation credit hit the bank.

## Decisions This Phase Settles

### The structural choice (drives everything downstream)

**The Public Funds (Activity) gift rows stay ordinary income. They do not become structurally pass-through.** The roll-up eliminates the swept pair; the fund model does not change.

Reasons:
1. The fund also holds money the Club keeps (event tickets, sponsorships, race entries). Only gifts whose category has a Foundation counterpart are ever swept. A "pass-through" row type cannot describe a fund that is part pass-through and part spendable.
2. The source row must stay a real, visible income row: it is where the Zeffy id (B-120) and the Club-side bank deposit match live, and it is what the treasurer selects from.
3. Budget, fund-balance and aged-funds logic already read Activity income as income. Changing that re-bases history.

**What eliminates the double count (the invariant Phase 3 must keep):**
- Today the *only* elimination mechanism is `transfer_group_id IS NULL` in the roll-ups. I found it in the 990 prep aggregation, the entity-level gross receipts and expense totals, the impact/giving predicate (`impact-stats-queries.ts`, `isGiving()` in `ledger.ts`), and the category queries. The sweep's Activity expense leg is excluded from "giving" only because it carries a `transfer_group_id`.
- **The Activity-side batch leg must keep a `transfer_group_id`** (or every one of those predicates must be rewritten and re-tested). If the leg were re-keyed to a batch id with `transfer_group_id NULL`, it would instantly count as *giving* in `/members/impact` (fund kind `activity`, category NULL means `counts_as_giving IS NOT FALSE`), and the Foundation's later grant would count again. That is the single most likely way this feature ships a double count.
- **The Foundation copies must have `transfer_group_id NULL`.** They are real Foundation income: they must reach the Foundation's 990 prep, gross receipts, donor history and acknowledgments. (Per my read of the 990 prep query, today's lump credit leg is *excluded* from the Foundation's 990 prep precisely because it carries a group id, so swept money is currently invisible there. Itemizing fixes that. Phase 3 should confirm with a test, and Phase 6 will check the 990 prep figure moves.)
- **A cross-entity or consolidated income total must exclude the copies** (rows with a swept-from pointer) and keep the Activity originals. No such consolidated total exists in code today (I searched `src/` for consolidated/org-wide income sums: none). B-34(b) therefore closes with two things: the marker exists, and a source-scan test fails any future query that sums income across both entities without the exclusion.
- Per-entity views keep both sides on purpose: the Club shows the gift as received, the Foundation shows it as donated. Whether the Club's own receipts total should include money it only collected on the Foundation's behalf is a tax-treatment question, not a ledger one (Open Question 7).

### The eight questions

| # | Question | Answer (recommended) |
|---|----------|----------------------|
| 1 | Double counting / B-34(b) | Settled above. Activity rows stay income; the elimination marker is `transfer_group_id` on the Activity leg (unchanged) plus a swept-from pointer on the copies; `/members/impact` is expense-based so it only double-counts if the Activity leg loses its group id; the member Statement of Financial Condition exposes only Administrative and Charitable funds (`MEMBER_EXPOSED_FUND_KINDS`), so Public Funds never appears there and the Foundation shows each gift once. |
| 2 | Who issues the receipt; no second receipt | The Foundation issues, always. The ack route already refuses any entity that is not `donationsDeductible`, so a Club/Public Funds row can never carry a ledger acknowledgment. The copy is the receipt-bearing row. The "second receipt" risks are (a) a gift that was first a Foundation row, receipted, moved to Public Funds under DECISION-112 (its sent ack stays on the *old* row) and then swept back as a *new* row that appears in the pending-acknowledgments worklist, and (b) Zeffy's own automatic receipt (Open Question 3). **Requirement:** the batch preview shows "receipt already sent on <date>" for case (a), and the copy inherits that status so it does not re-enter the worklist. Mechanism is Phase 3's. |
| 3 | N rows vs ONE bank credit; B-23, B-104 | Already supported: batch reconciliation shipped 2026-07-28 (N book rows to 1 bank line, exact sum, server-revalidated, per-row unmatch, month-gate treats unreconciled income as in-transit). All copies carry the same Foundation bank account, so they are a valid group. What is new is only a **"Match this batch" shortcut** in the picker (the batch appears as one selectable group). The Club debit stays 1:1 with the Activity leg. B-23 (auto-suggest) stays out. B-104 (mirror move) stays out. |
| 4 | Fees and tips; total differs from bank transfer | The batch total is **derived from the selected rows** (the server recomputes it; a client total is never trusted). The treasurer re-types the amount actually transferred at the bank as a confirmation. **They must be equal to post; no tolerance, no plug line.** A difference is fixed by changing the selection or the typed amount, not absorbed. Zeffy fees and tips affect the *Club-side deposit* (Zeffy payout vs the Activity rows), which the existing exact-sum batch match and B-120 already own; they do not arise on the sweep because the sweep amount is a Club decision. See the both-outcomes table in Open Questions. |
| 5 | Idempotence; void; launcher | A source row is claimed by one batch, atomically (all-or-nothing, rows locked in id order, pinned on "not yet swept"); a second tab gets a typed 409 naming the rows already swept. A pending batch is rejected through the existing reject path; a posted, unapproved, unreconciled, no-sent-receipt batch can be voided by `ledger.manage` with a reason through one dedicated audited route. An approved or reconciled batch cannot be voided in v1 (see Gap 9). The `?sweepFrom=` deep link and `sweep-prefill-launcher.tsx` are retired and replaced by `?sweep=<id>` that preselects rows in the batch builder. The old lump-sum sweep mode of `handleTransfer` is closed server-side once the batch ships (otherwise the API is a second path); same-fund Transfer mode is untouched. |
| 6 | Approval once; minute once | The threshold is compared with the **batch total** once. One minute reference per batch (required, as for today's sweep), stored once and shown on the batch. One `ledger.approve` decision posts every row. Self-decision refusal (DECISION-116) generalizes: the actor who recorded the batch cannot decide it. DECISION-117 co-sign stays keyed on the Activity (expense) leg. Note the default threshold is $250 (`disb_approval_threshold_cents`, 25,000 cents), so under defaults almost every itemized batch will go to approval; the production setting is not known to me. |
| 7 | Sequencing with B-120 and B-34(a) | B-172 does **not** wait for B-120. Increment 2 runs on hand-keyed gifts, which is how every gift arrives today. B-120 then plugs in as the thing that creates the source rows (with a Zeffy id for de-duplication and the `ticket` vs `additional_donation` split). B-34(a)'s dedicated categories fold into Increment 1: `Transfer to Foundation` (Activity expense leg), plus the mirror categories below. `Transfer from Club` is kept only for the historical lumps. |
| 8 | Two catalogs in step | **A `mirrors_category_id` link** from an Activity income category to its Foundation counterpart, not one shared definition. Categories are entity-scoped rows referenced by transactions, budgets and cause lines; a shared definition would change that model. A category with no (active) mirror is simply **not sweepable**; it is listed under "Stays in Public Funds" with the reason, and the copy never falls back to `Public donations`. The Foundation category is the **only** source of the receipt flag, 990 line and `counts_as_giving` on a copy. The Activity category displays those values read-only from its mirror rather than keeping a second editable copy (this narrows backlog item (e), see Open Question 6). Category deactivate/merge on either side must say what it does to the other. A test fails if a sweepable category's mirror is missing, inactive or an expense category. |

### Recommended increments

| Inc | Content | What the treasurer can do on their own afterwards |
|-----|---------|----------------------------------------------------|
| **1** | Public Funds rename (stored name; description names the Lions "Activities account"); every UI string, denial reason, guide page, email and report header reads the stored name; the dedicated categories (`Transfer to Foundation`, the Foundation mirrors for White Cane and online donations); `mirrors_category_id` and the parity test; a donor field on Public Funds income rows; the Activity category screen showing the mirror's receipt/990 values read-only. | Key a complete gift into Public Funds (donor, cause, category) and see which gifts are Foundation-bound and whether they will need a receipt. Sweeps still work the old (lump) way during this increment. Ships alone. |
| **2** | Sweep batch: unswept-gift list, per-gift preview, total validation, post once, approve once, swept marker and locks on both sides, void, the retired launcher, the closed lump path, legacy cutoff and closeout, pending-acknowledgments hygiene, consolidated-exclusion rule and scan test, Treasury guide pages. | Sweep all online money as itemized Foundation gifts and have the Foundation's donor history, acknowledgments queue and 990 prep see them. Reconcile with the existing manual multi-select. |
| **3** | "Match this batch" shortcut in the reconciliation picker; guide section; verify month gate and statement behavior with a real batch. Small; fold into Increment 2 if it stays under ~100 lines. | Reconcile the batch against its one bank credit in one click instead of hand-picking N rows. |
| later | B-120 (creates source rows, de-duplicates on Zeffy id, splits ticket vs donation); refund of a swept gift; void of an approved batch. | n/a |

This agrees with the orchestrator's candidate split, with two re-cuts: the lump path is closed (not merely discouraged), and the group-reconcile increment is mostly a shortcut because the capability already shipped.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.record`) | Key a public gift into Public Funds with donor, category, cause, payment method | Per gift (until B-120) |
| Admin (`ledger.record`) | Split a mixed Zeffy payment into its Club row and its Foundation-bound row (existing Split) | Per mixed payment |
| Admin (`ledger.record`) | Open the sweep builder; see unswept Foundation-bound gifts; select rows | Per sweep (about weekly in campaign season, monthly otherwise) |
| Admin (`ledger.record`) | Review per-gift copy preview and the derived total; type the bank-transfer amount; enter the board-minute reference; pick Club source and Foundation destination bank accounts; post | Per sweep |
| Admin (`ledger.approve`) | Approve or reject an over-threshold batch (one decision); optionally co-sign | Per over-threshold batch |
| Admin (`ledger.record`) | Reconcile the Foundation credit against the batch's rows; reconcile the Club debit against the Activity leg | Per statement |
| Admin (`ledger.record`) | Send or print the Foundation acknowledgment for a copied gift (existing flow) | Per gift of $250 or more |
| Admin (`ledger.manage`) | Void a posted batch with a reason | Rare |
| Admin (`ledger.manage`) | Rename the fund; maintain the category mirror; set the itemized-sweeps start date; close out legacy gifts | One-time and occasional |
| Anonymous public / signed-in member | None. `/members/impact` and `/members/financial-reports` are read-side consumers whose totals must not move wrongly. | n/a |
| Signed-in member with no usable role | None (no access to `/admin/ledger`; `/access-pending` as today) | n/a |

## Flows

**Flow 1 — Key a complete gift (Increment 1).** `/admin/ledger/activity` → Record transaction → income → pick a category → the form shows "Foundation-bound: yes, will be copied as <Foundation category>; receipt: needed / not needed / sent elsewhere" (derived from the mirror) → choose or create a donor, cause, payment method → save. Outcome: a posted Public Funds income row, complete enough to copy without re-keying. Failure: a category with no mirror shows "This stays in Public Funds and cannot be swept"; an unknown donor offers "Add donor" rather than blocking; a network failure shows a retryable toast, not a stack trace.

**Flow 2 — Build a batch from unswept gifts (Increment 2).** `/admin/ledger/activity` → "Sweep to the Foundation" → list of eligible rows (Public Funds, income, posted, not a transfer leg, not already swept, category has an active mirror, dated on or after the itemized-sweeps start date) with date, donor/party, category → Foundation category, amount, a receipt-status chip; running count and total; grouped "Stays in Public Funds" (no mirror, with reason) collapsed beneath. Select rows → "Review". Failure: a row claimed in another tab since the page loaded is flagged "swept in another batch" and removed from the selection on review; a request listing rows that are not eligible gets a typed 409 naming them. Empty state: "No unswept gifts. Everything Foundation-bound in Public Funds has been swept." plus a link to the legacy closeout when pre-start-date gifts exist.

**Flow 3 — Review, validate and post.** Review step shows each copy as it will appear in the Foundation (donor, gift date, category, cause, memo, payment method, receipt status), the derived total, a field "Amount transferred at the bank" (prefilled, editable), the Club and Foundation bank accounts, the board-minute reference (required), and the posting date. "Post" is disabled until typed amount equals derived total, with the difference stated in words ("$12.00 over / short"). Outcome (at or under threshold): one Activity expense leg and N Foundation income rows post together. Outcome (over threshold): all rows are `pending`, approvers are emailed once ("Sweep of N gifts pending your approval", amount and count, no donor names), the treasurer sees "Waiting for board approval" and the gifts show as "in a pending sweep" and cannot be selected again. Failure: any validation failure writes nothing (single transaction); a missing category mirror on any selected row refuses the whole batch and names the row.

**Flow 4 — Approver decides (existing approvals page, extended).** `/admin/ledger/approvals` shows one row per batch ("Sweep of 14 gifts, Public Funds to Foundation Charitable") with an expandable gift list for the approver (cards below `xl`, table at `xl` and up, one shared actions block, as the 2026-10-10 approvals fix requires). Approve posts every row; Reject rejects every row and returns the gifts to unswept. Failure: `not_pending` 409 naming the decider (existing). The recorder cannot decide (existing rule, generalized).

**Flow 5 — One Zeffy payment, part Club money and part Foundation gift.** A ticket plus an extra donation arrive as one payment. Until B-120, the treasurer keys (or splits with the existing Split) two Public Funds rows: the ticket part in a no-mirror category (stays in Public Funds) and the donation part in a mirrored category. Only the donation row is sweepable. Partial sweep of one row is **not** supported (the row is swept whole or split first). Failure: trying to sweep a row that mixes both is prevented by the category rule, and the guide says to split first. With B-120 the import creates both rows from the payload's item types.

**Flow 6 — Gift already receipted before the sweep.** (a) Foundation-origin gift moved into Public Funds under the existing cross-entity move, receipt already sent: the move dialog's "Record sweep now" link opens the batch builder preselected (`?sweep=<id>`); the preview shows "Receipt already sent <date>" and the copy does not enter the pending-acknowledgments worklist. (b) Zeffy's own receipt (Open Question 3): handled by the mirror category's receipt flag, not by per-row logic. (c) A Club-side ledger acknowledgment cannot exist (the ack route refuses non-deductible entities).

**Flow 7 — Refund of a swept gift.** Not automated in v1. Before the sweep: the treasurer deletes or corrects the unswept source row through the existing paths. After the sweep: the source and copy are locked; the lock message names the batch and date and says "A refund of a swept gift is recorded by the treasurer as a Foundation expense and a matching settlement; ask for help before changing either side." A sent receipt blocks delete as it does today (409 `receipt_sent`). Tracked as a follow-up (proposed B-191).

**Flow 8 — Void a posted batch.** Batch page (or the Foundation row's lock explanation) → "Void batch" (`ledger.manage` only) → `<ConfirmDialog destructive>` with a required reason (the dialog says not to type a donor's name) → server checks: current fiscal year; no row of the batch reconciled or matched; no sent acknowledgment on any copy; not approved-locked (v1). Outcome: copies and the Activity leg are removed, unsent acknowledgments removed, gifts return to unswept, one audit row snapshots the batch. Failure: each refusal names the specific blocker and the next step (unmatch, reopen the session, or "ask the developer"), in the guided-checklist style of DECISION-112; never silent.

**Flow 9 — Batch total differs from the actual bank transfer.** The treasurer types the real amount; Post stays disabled and the difference is shown. Resolutions: deselect or add gifts so the derived total equals the real transfer, or fix a mis-keyed gift amount (unswept rows are editable). There is no plug. If the bank actually moved a different amount than intended, that is a bank-side error handled outside the ledger. Edge: if the bank sends two credits for one batch, the exact-sum group match fails; the answer is two batches, one per credit.

**Flow 10 — Reconcile against one bank credit.** Reconciliation session for the Foundation account → the picker lists the batch as one group "Sweep of N gifts, $X, dated D" → "Match this batch" selects its rows against the single credit line → exact-sum commit (existing validation) → close. The Club session matches the Activity leg to the Club debit 1:1. Failure: partial selection shows the existing "short / over" message; unmatching one row returns it to the pool (existing). A reconciled batch cannot be voided without first unmatching (guided).

**Flow 11 — The rename.** A `ledger.manage` holder edits the fund name in the admin fund editor (audited path) to "Public Funds" with a description naming the Lions "Activities account". Afterwards every dialog, denial reason, register heading, guide page, email, report and the Move/Delete copy shows "Public Funds". Slug stays `activity`, kind stays `activity`. Failure: the fund editor rejects a blank or duplicate name per its existing validation.

**Flow 12 — The 990 and the monthly statement after a sweep.** Foundation 990 prep: each copy appears under its mirror category's 990 line (new: the Foundation sees swept gifts). Club 990 prep: Public Funds gifts are counted as today; the Activity leg is excluded (transfer). Foundation monthly Statement of Financial Condition: income shows by category (the mirror categories add lines); the month still publishes before the group reconciliation because uncleared deposits do not gate (DECISION-059). Public Funds never appears on a member statement.

**Flow 13 — Go-live closeout of historical gifts.** Before Increment 2 ships, the Public Funds register holds gifts that were already swept as lumps and gifts not yet swept. First open of the builder after release: a one-time "Itemized sweeps start on <date>" setting (`ledger.manage`, default the release date), and a closeout screen listing earlier unswept-looking gifts beside the historical lump sweeps (date and amount only) with a running tally. For each earlier gift the manager either includes it in the next batch (reason required) or marks it "already swept before itemizing" (reason required, audited). Failure: without this, every historical gift looks unswept on day one and the treasurer re-sweeps money the Foundation already holds.

## Permissions

- **Permission(s):** **No new `FEATURES` key.** Existing keys cover every verb:
  - `ledger.record`: key a public gift, open the builder, post a batch, reconcile (same gate as today's sweep).
  - `ledger.manage`: rename the fund, maintain the category mirror, set the start date, close out legacy gifts, **void a batch**.
  - `ledger.approve`: approve or reject (and co-sign) an over-threshold batch.
- **Default roles:** unchanged. `ledger.record` and `ledger.manage` are held by admin and treasurer; `ledger.approve` by admin and board_member. `treasurer` must **not** receive `ledger.approve`, `admin.users` or `admin.roles` (the role-bundle test already fails the build on the latter two). Because no key is added, no bind migration is needed and `default-role-bundles.test.ts` is unaffected.
- **Rejected alternative:** a dedicated `ledger.sweep` key. It would only narrow `ledger.record`, adds a bind migration and a role-cache lag (JWT lifetime) for no safety gain, because the real controls are the board-minute reference, the over-threshold approval and the self-decision rule. If the board later wants fewer people able to post sweeps, that is a role-binding choice.
- **Page gates:** the builder, batch page and void route each call `auth()` + `hasFeature()` in their own body (`admin-page-feature-gates.test.ts`); the proxy rule derives from the nav entry. The void route and the start-date setting require `ledger.manage` server-side regardless of what the UI hides.

## Gaps the Request Didn't Address

1. **Historical gifts look unswept on day one (Flow 13).** Why it matters: re-sweeping money already in the Foundation. Resolution: start-date setting plus an audited closeout screen; make it an Increment 2 go-live checklist item.
2. **Elimination depends on one fragile predicate.** The Activity leg must keep its `transfer_group_id`, and the copies must not carry one (see the structural choice). Resolution: Phase 3 writes both as explicit invariants with source-scan tests over every query that sums income or giving.
3. **The "exactly two legs" assumption is baked into several places.** I found it in `decideTransaction()` (locked rows must equal 2), `cosignTransaction()` (same), the board-decision lock helper, the pending-approvals pairing in `ledger-queries.ts`, the `PATCH ?both=true` branch, the `transfer_leg` lock kind, and the approvals email. A batch is one expense leg plus N income rows. Resolution: Phase 2/3 must choose between generalizing "pair" to "group" at each site or keeping a two-row anchor, and list every site; I recommend generalizing with a typed batch vocabulary in one client-safe module (the `ledger-correction.ts` precedent).
4. **Swept rows must be locked everywhere, not only in PATCH.** A swept Foundation copy must not be movable back to Public Funds through the existing cross-entity cell (that would leave a dangling pointer and send money backwards), must not be split or deleted, and its amount, date and category must be immutable. A swept Public Funds source must not be edited, split, deleted or moved to Administrative. Donor link, memo and acknowledgment fields stay editable (DECISION-099's donor-only carve-out). The source-to-copy pointer must refuse deletion (restrict, not cascade or set null).
5. **Pending-acknowledgments worklist includes transfer legs today.** `listPendingAcknowledgments()` has no `transfer_group_id` filter, so a historical lump credit of $250 or more (not in an ack-not-required category) is likely queued as "needs a receipt" with no donor. (Read from the code only; the Verify-First block counts it.) After itemizing, the worklist would show both the old lumps (wrong) and the copies (right). Resolution: exclude transfer legs from that list in Increment 2, alongside `listUnlinkedGifts()` which already does.
6. **Date convention for the copy (Open Question 1).** The gift date and the sweep date can fall in different fiscal years (a June gift swept in July). Resolution below.
7. **Unlinked donors multiply.** A batch of 40 gifts with a typed name and no donor record creates 40 rows in the "Unlinked gifts" worklist. Resolution: the preview shows "N gifts have no donor record" (non-blocking) and links to the existing worklist; Increment 1 adds the donor field so most gifts arrive linked; B-120 later matches by email.
8. **Selecting a gift not yet paid out.** A Zeffy gift keyed before Zeffy's payout reaches the Club bank can be swept before the Club holds the cash. Resolution: warn (not block) when a selected source is not yet matched to a bank deposit, and when the total exceeds the Public Funds fund balance.
9. **Void of an approved batch.** The `approvedAt` guard on PATCH/DELETE/split is unconditional by DECISION-099 item 4 and DECISION-106; carving it needs its own decision and its own audited route (the move and correct precedents). Recommendation: v1 does not carve it; an approved or reconciled batch is not voidable and the message says so. Because the one-way valve forbids Foundation to Public Funds, a wrongly approved batch has no in-app undo in v1; this is rare (a pending batch is rejectable, an unapproved one voidable) and tracked (proposed B-192).
10. **Fund name displayed from the *kind*.** The fund register subtitle renders `{fund.kind} fund` ("activity fund") and `capitalize` of a kind string; 31 source files contain "Activity Fund", including pure-function denial reasons in `ledger-correction.ts` and `ledger-transfer-policy.ts` that have no DB access. Renaming the stored name alone changes the heading but not these. Resolution: pass the stored name into those messages (or one exported label module read at the edge), and add a test that fails on the literal "Activity Fund" in `src/` outside the migrations and a short allowlist. Docs (`CLAUDE.md`, release notes, Treasury guide) updated in the same release.
11. **Rename window.** Between deploy and the treasurer's edit in the fund editor, the stored name is still "Activity Fund". If any string is hard-coded "Public Funds" the app would contradict itself for that window. Resolution: strings read the stored name (so they are always consistent); the rename is a release-checklist step the orchestrator asks the user to perform in the fund editor right after deploy. Fresh installs seed the new name; **no migration updates the production row**, so the audited path is the only writer.
12. **Fiscal-year spanning and prior-year gifts.** If the copy is dated at the sweep date (default), one batch is always one fiscal year by construction. A prior-year Public Funds gift is selectable (it is Public Funds money swept in the current year); it is shown with a "dated in a prior fiscal year" chip and the copy's receipt keeps the gift date. This does not contradict the 2026-10-02 treasurer answer, which refused prior-year *moves* (reclassification of an existing row), not sweeps.
13. **Interaction with the aged-funds warning.** Public Funds shows an aged-funds warning for old unswept money (`ledger-correction.ts` copy). After a sweep it must clear per gift, not only when the fund balance reaches zero. Check in Phase 3.
14. **Email.** The approval email gains a count ("Sweep of N gifts") and must not list donor names. It goes through `sendBulkMemberEmail()` as today; it is not a durable-claim path (nothing records "sent"). No donor-facing email is introduced; acknowledgment sending is unchanged.
15. **Google Group sync, OAuth vs password, `/access-pending`.** Not touched. A signed-in member with no ledger key never reaches these pages.
16. **Mobile (360px) and brand.** The builder must work at 360px: cards below `xl`, a sticky total bar, 44px tap targets, no horizontal scroll. Cards `rounded-2xl`, buttons `rounded-lg`, the void confirm via `<ConfirmDialog destructive>`, no `window.confirm`.

### Adversarial pass (Pass 5)

| Attack or accident | Outcome required |
|--------------------|------------------|
| Double receipts | Covered by Gap list and Flow 6: Club rows cannot carry an ack; a copy inherits "receipt already sent"; the mirror category's flag governs Zeffy-receipted gifts. Phase 6 will walk a moved-and-swept gift. |
| Double counting in `/members/impact` | Holds only if the Activity leg keeps its `transfer_group_id`. Required test: a batch leaves the giving total unchanged. |
| Double counting in the monthly statement | Public Funds is not member-exposed; the Foundation sees each gift once. Required test: the Foundation statement's income total after a sweep equals the sum of the copies. |
| Same gift swept twice from two tabs | Atomic claim in one transaction, rows locked in id order, pinned on "not yet swept"; second submit gets a typed 409 naming rows; nothing is written. |
| A `ledger.record` holder voids a batch | Server refuses with 403; void requires `ledger.manage`, checked on the server, not only hidden in the UI. |
| Batch spanning fiscal years | Not possible with a single sweep-date for the copies; gift dates may span years and are shown. |
| Prior-year gift selected | Allowed and chipped (Gap 12); never changes a closed year because the copy is dated at the sweep date. |
| Tampered request | Server recomputes the total from the rows; ignores a client total; rejects duplicate ids, ids not in Public Funds, non-income, transfer legs, pending or rejected rows, rows with no active mirror, ids from another entity; caps the batch size (suggest 200) and the length of the minute and void reason; validates UUID shape on `?sweep=` and silently ignores bad links (existing `sweepFrom` behavior). |
| Enumeration | A non-holder gets the same 403/redirect for any batch id, whether or not it exists; batch ids are UUIDs. |
| Self-targeting | The recorder cannot approve or reject the batch (existing rule, generalized to any leg); a `ledger.manage` holder voiding their own batch is allowed but audited with actor and reason. |
| Redirect targets | The only link parameter is `?sweep=<ids>` on the same path; no `callbackUrl`/`next` is introduced. |
| Moving a copy back to Public Funds | Blocked by a new `swept` move-block (Gap 4). |
| Deleting a source that has a copy | FK restricts; the delete dialog explains. |

## Out of Scope (confirm with user)

- Refund of a swept gift (manual and guided in v1; proposed B-191).
- Voiding an approved or reconciled batch (proposed B-192).
- Automatic creation of Public Funds rows from Zeffy (B-120 and the webhook-ingestion item); the `ticket` vs `additional_donation` split from the payload.
- Auto-suggesting a bank match (B-23) and the Club-to-Foundation mirror move (B-104/B-98).
- Retro-itemizing historical lump sweeps into per-gift Foundation rows. The historical lumps stay as they are; only the closeout (Flow 13) stops them being re-swept.
- Partial sweep of one row, and a tolerance or plug line for a bank difference.
- Any change to the URL slug `activity` or to `kind = 'activity'`.
- A consolidated org-wide income report (none exists; B-34(b) only requires the exclusion rule and marker).
- Club-side tax treatment of collected-for-Foundation receipts (Open Question 7).

## Open Questions

**User answers (2026-10-16, after Phase 1, relayed to the architect mid-Phase 2):**
1. **Gift date.** The Foundation copy carries the original gift date, not the sweep date (overrides the analyst's default). Consequences the analyst listed now apply and Phase 2/3 must handle them: a batch can span fiscal years; a prior-year gift copies into a closed or filed Foundation period; the "prior-year gifts stay not movable" rule (treasurer, 2026-10-02) must be reconciled with copying a prior-year gift; the month statement and reconciliation see Foundation income dated before the bank credit. The acknowledgment keeps reading `txn_date`, which is now the gift date, so the ack composer needs no change for this.
2. **Receipts from the portal.** The club sends the written acknowledgment from the portal (the ledger's acknowledgment letters); Zeffy's own email does not replace it. Matches the default: mirror categories seed `ack_not_required = false`, and a copied gift of $250 or more joins the pending-acknowledgments worklist on the Foundation side.


**Classification.** There is **no BLOCKING FACT**. Each item below is either a preference or a treasurer/board policy choice with a default I recommend the pipeline proceed under. The first two are the ones I would ask the user in one line before Phase 3 because a wrong default is annoying to reverse; the rest can wait for Phase 6.

1. **Which date does the Foundation copy carry: the gift date or the sweep date?** *Policy (treasurer/tax adviser).* **Default: the sweep date**, with the original gift date stored on the copy and printed on the receipt. Why: the books follow cash into the Foundation's bank, reconciliation and the month statement stay in one fiscal year, no filed year is reopened, and a batch is one year. Cost to flip: the copy's date is set from the source instead (one mapping line), but batches then span years, prior-year gifts hit closed periods, and the prior-year rule must be revisited. Note this touches the acknowledgment: today the ack copies `txn_date` from the transaction at creation, so under the default the ack composer must read the gift date (Phase 3).
2. **Does Zeffy email a tax receipt to every online donor under the Foundation's name?** *Fact about the club's real setup, but it only decides seed data* (the receipt flag on the mirror categories), not the mechanism. **Default: assume it does not suppress the ledger's acknowledgment** (mirror categories seeded with receipt-not-required = false, so a gift of $250 or more is queued for a written acknowledgment); a duplicate receipt is cheaper than a missing written acknowledgment for a deduction. Treasurer confirms before Increment 1 seeds the flag.
3. **Which Public Funds income categories are Foundation-bound, and what is the Foundation counterpart?** *Treasurer.* **Default:** `Public donations` mirrors the Foundation's `Public donations`; `White Cane` mirrors a new Foundation `White Cane` category; new online-donation category mirrors `Public donations` (or a new Foundation `Online donations`, treasurer's pick); `Rudolph Run` (entry fees), `Pancake Breakfast` (meals), `Sponsorships` and `Interest` have **no mirror** and stay in Public Funds. Each mirror gets the Foundation's 990 line.
4. **Itemized-sweeps start date and the historical closeout.** *Preference.* **Default: the release date**, with the closeout screen at first use (Flow 13).
5. **Is the lump-sum sweep removed or kept as an escape hatch?** *Preference.* **Default: removed** from the form and refused by the API; an unitemizable amount is first keyed as a Public Funds income row (even with party "Anonymous") and then swept. This keeps the invariant "swept dollars are exactly Public Funds rows".
6. **Narrowing backlog item (e).** The backlog asks that Activity categories "carry the same categories and charitable setup data". **Default: they carry the same categories; the receipt, 990 and giving flags live on the Foundation category only and the Activity category shows them read-only.** Two editable copies would drift (DECISION-082). Confirm that read-only display satisfies "complete at entry".
7. **Does the Club's own receipts total include gifts it collected for the Foundation?** *Tax-treatment question for the treasurer's adviser, affects only reporting.* **Default: keep today's behavior** (the Club counts Public Funds income as received), add a "of which swept to the Foundation" line in the compliance view, and let the adviser decide whether the Club's return should exclude it. Ledger design is the same either way.

### Design for both outcomes: do Zeffy payouts equal the sum of the gifts?

Not blocking (the sweep total is a Club decision derived from rows), but it decides how much Club-side reconciliation help is needed and is not mine to assume.

| If the treasurer finds... | Then | Cost |
|---------------------------|------|------|
| Payouts equal the sum of the gift rows, to the cent | Zero-variance rule is complete; nothing more to build. | none |
| Payouts are net of a fee or tip on some payments | The Activity rows (gross) do not sum to the Club deposit, which is the *existing* Zeffy-batch situation (exact-sum only, "record a manual adjustment"). Add nothing to B-172; the treasurer keys the fee as a Public Funds expense row first, and the Foundation copy stays the gross gift. Suggest B-120 carry the fee/tip from the payload. | Guide paragraph in Increment 2; B-120 scope note |

## Production Facts: Verify-First (orchestrator to run, read-only, counts and booleans only)

Run each with an explicit `branchId` (the Neon default branch is production) and paste the results into this work-log under **"Production facts (orchestrator, 2026-10-16)"** directly beneath this section. Nothing below is stated as fact until it arrives. Phase 2 may start without them; Increment 1 seeds and the closeout screen depend on them.

```sql
-- V1: the fund to be renamed (names are not personal data)
SELECT e.slug AS entity, f.slug, f.name, f.kind, f.is_active
FROM ledger_funds f JOIN ledger_entities e ON e.id = f.entity_id
WHERE f.kind = 'activity';

-- V2: size and completeness of the "unswept-looking" Public Funds gifts, by category
SELECT c.name AS category, count(*) AS rows,
       count(*) FILTER (WHERE t.donor_id IS NOT NULL) AS with_donor,
       count(*) FILTER (WHERE t.party IS NULL OR t.party = '') AS no_party,
       count(*) FILTER (WHERE t.txn_date < '2026-07-01') AS prior_fy
FROM ledger_transactions t
JOIN ledger_funds f ON f.id = t.fund_id
LEFT JOIN ledger_categories c ON c.id = t.category_id
WHERE f.kind = 'activity' AND t.flow = 'income' AND t.status = 'posted' AND t.transfer_group_id IS NULL
GROUP BY c.name ORDER BY rows DESC;

-- V3: historical lump sweeps (count and date span only)
SELECT count(DISTINCT t.transfer_group_id) AS lump_sweeps, min(t.txn_date) AS first_date, max(t.txn_date) AS last_date
FROM ledger_transactions t
JOIN ledger_entities e ON e.id = t.entity_id
JOIN ledger_funds f ON f.id = t.fund_id
WHERE e.slug = 'foundation' AND f.kind = 'charitable' AND t.flow = 'income' AND t.transfer_group_id IS NOT NULL;

-- V4: how many transfer legs sit in the pending-acknowledgments worklist today (Gap 5)
SELECT count(*) AS lump_legs_in_ack_queue
FROM ledger_transactions t
JOIN ledger_entities e ON e.id = t.entity_id
LEFT JOIN ledger_categories c ON c.id = t.category_id
LEFT JOIN ledger_acknowledgments a ON a.donation_txn_id = t.id
WHERE e.donations_deductible AND t.flow = 'income' AND t.status = 'posted'
  AND t.transfer_group_id IS NOT NULL AND t.amount_cents >= 25000
  AND a.id IS NULL AND (c.id IS NULL OR c.ack_not_required = false);

-- V5: Foundation income categories and flags (names and booleans)
SELECT c.name, c.counts_as_giving, c.ack_not_required, (c.form_990_line IS NOT NULL) AS has_990_line, c.is_active
FROM ledger_categories c JOIN ledger_entities e ON e.id = c.entity_id
WHERE e.slug = 'foundation' AND c.fund_kind = 'charitable' AND c.flow = 'income'
ORDER BY c.sort_order;

-- V6: the over-threshold approval setting (one number)
SELECT disb_approval_threshold_cents FROM ledger_settings LIMIT 1;
```

| Result | Recommendation |
|--------|----------------|
| V1 shows exactly one Club `activity` fund named "Activity Fund" | Proceed; rename through the fund editor after deploy. If it already reads otherwise, say so in the work-log and skip the step. |
| V2 shows hundreds of rows across categories | Closeout screen must be bulk-friendly (select all earlier, mark by category). If it is a few dozen, a plain list is enough. |
| V2 shows many `no_party` or no donor | Add a "complete these first" nudge to the builder; otherwise the Foundation inherits blank donors. |
| V3 returns zero | No closeout needed beyond the start date. |
| V4 greater than zero | Fix the worklist filter in Increment 2 *and* tell the treasurer those lump credits are not real receipt obligations. |
| V6 is the default 25,000 | Nearly every batch needs approval: confirm the board is comfortable with one approval per sweep. |

## Production facts (orchestrator, 2026-10-16)

Run by the orchestrator against the production endpoint (`PROD_DATABASE_URL`, host `ep-rough-smoke-…`, verified before running) inside a `BEGIN READ ONLY … ROLLBACK` transaction via psql; the Neon MCP connection does not reach the club's Neon account, so `branchId` was not applicable. Counts, names and booleans only.

**V1 — fund to rename:** exactly one `activity` fund, entity `club`, slug `activity`, name `Activity Fund`, active. Proceed with the rename through the fund editor after deploy.

**V2 — unswept-looking Public Funds income (posted, no transfer group):**

| Category | Rows | With donor | No party | Prior FY (before 2026-07-01) |
|----------|------|-----------|----------|-------------------------------|
| Public donations | 2 | 0 | 0 | 2 |
| Pancake Breakfast | 1 | 0 | 0 | 1 |

Three rows in total, all prior fiscal year, none linked to a donor record. The closeout screen can be a plain list (or nothing beyond the start date); the "complete these first" nudge is still worth having because online money has not started flowing into the ledger yet (B-120 unshipped).

**V3 — historical lump sweeps on the Foundation side:** 1 transfer group, dated 2026-10-01 (first and last). One lump to close out.

**V4 — transfer legs sitting in the pending-acknowledgments worklist:** 0. Gap 5 is real in the code but has no production victim today; fix the filter in Increment 2 without a treasurer message.

**V5 — Foundation Charitable income categories (name, counts_as_giving, ack_not_required, has 990 line, active):**

| Category | Giving | Ack not required | 990 line | Active |
|----------|--------|------------------|----------|--------|
| Rudolph Run – Day-of / Merchandise | yes | no | no | yes |
| Tail-twisting | yes | no | yes | yes |
| Rudolph Run – Sponsorships & Donations | yes | no | no | yes |
| Rudolph Run – Registration/Entry Fees | yes | yes | no | yes |
| Transfer from Club | no | yes | no | yes |
| Public donations | yes | no | yes | yes |
| Kroger Community Rewards | yes | yes | yes | yes |
| Grants received | yes | yes | yes | no |
| Memorials | yes | no | yes | no |
| Interest | yes | no | yes | no |
| Fundraising events | yes | yes | no | no |
| Pancake Breakfast | yes | yes | no | no |
| Rudolph Run | yes | no | no | no |
| White Cane | yes | no | no | yes |
| Restaurant fundraisers | yes | no | no | yes |
| Miscellaneous | yes | no | no | no |
| Pizza Challenge - Sponsorships & Donations | yes | no | no | yes |
| Pizza Challenge - Ticket Sales | yes | no | no | yes |

Consequences for Open Question 3: the Foundation already has an active `White Cane` category (no 990 line yet), so no new Foundation category is needed for it; `Rudolph Run` and `Pancake Breakfast` exist on the Foundation side as well (the latter inactive), so the analyst's "no mirror" default for those needs the treasurer's confirmation rather than being assumed from absence. Only 6 of 18 categories carry a 990 line; the mirror seed should not invent lines the Foundation category lacks.

**V6 — over-threshold approval setting:** 100,000 cents ($1,000), not the 25,000 default the analyst assumed. Most sweep batches will sit under it; one board approval per sweep applies only to batches of $1,000 or more.

**V7 (orchestrator, 2026-10-17, answering the architect's question 2, read-only booleans):** the three unswept-looking prior-FY Public Funds gifts do NOT sum to the 2026-10-01 lump; their sum is greater than the lump, and all three are dated before it. There is exactly one Activity-side expense leg with a transfer group (the lump's pair). So the lump covers at most part of those gifts (plausibly the two `Public donations` rows and not the `Pancake Breakfast` row, which has no Foundation-bound purpose), but only the treasurer can say which. Consequence: the per-row closeout marker the architect proposed is the right tool; the treasurer marks the rows the lump already carried at first use, and the remainder stay selectable. **User decision pending (default applied):** prior-year gifts are sweepable at `ledger.manage` with a reason, blocked once that year's filing is `filed`.

## Proposed DECISION / Backlog Text (orchestrator or tech-lead files; analyst does not edit `docs/decisions.md` or `docs/backlog.md`)

**Proposed DECISION-126 — Itemized sweep: Public Funds gifts stay income; copies are ordinary Foundation income linked to their source; elimination is by marker, not by changing the fund model.** A sweep batch posts one Public Funds expense leg (keeps a `transfer_group_id`) and N Foundation income rows (`transfer_group_id NULL`, each with a write-once pointer to its source and the batch). A source is claimed by one batch atomically. The total is derived from the rows; the typed bank amount must equal it. Any cross-entity income sum excludes rows with a swept-from pointer. The lump-sum sweep mode is closed. Category counterparts are linked by `mirrors_category_id`; the Foundation category alone supplies receipt, 990 and giving flags on a copy. No new `FEATURES` key.

**Proposed DECISION-127 — The Activity fund is renamed "Public Funds" by changing the stored name only.** `kind` and `slug` stay `activity`. User-visible strings read the stored name; a test fails on the literal "Activity Fund" in `src/` outside an allowlist. Production is renamed by the treasurer in the admin fund editor (audited); no migration rewrites the existing row; fresh installs seed the new name.

**Proposed backlog text:**
- *B-190* — Itemized-sweeps start date and legacy closeout screen (Flow 13). Ships with Increment 2.
- *B-191* — Refund of a swept gift: Foundation expense plus settlement, guided; today the lock message only explains.
- *B-192* — Void of an approved or reconciled sweep batch: needs its own decision to carve the `approvedAt` guard (DECISION-099 item 4); recommend a dedicated audited route like move and correct.
- *B-193* — Club receipts total versus money collected for the Foundation: adviser question plus a "swept to Foundation" line in compliance.
- *B-194* — `listPendingAcknowledgments()` should exclude transfer legs (found while reading; ships inside Increment 2 if V4 is non-zero).

## Handoff to Phase 2 (architect) and Phase 3 (tech-lead)

1. Pick the batch representation and list every "exactly two legs" site (Gap 3); do not let the Activity leg lose its `transfer_group_id` and do not give the copies one (structural choice).
2. Decide how pure-function messages get the stored fund name (Gap 10) and where the one label module lives.
3. Category mirror: a nullable link on `ledger_categories`, a parity test, and the merge/deactivate rules on both sides.
4. Swept lock kind in the move-block, edit-lock, split and delete guards, and a restrict FK from copy to source (Gap 4).
5. The old `handleTransfer` sweep mode must be refused server-side once the batch route exists, and `?sweepFrom=`/`sweep-prefill-launcher.tsx` retired in the same increment.
6. Not a durable-claim email path (no "sent" claim is written by this feature), so DECISION-102/103 helpers are not required; the approval email uses `sendBulkMemberEmail()`. Architect to confirm.
7. Unit tests I expect named in Phase 3: batch claim race, total mismatch refusal, giving total unchanged by a batch, Foundation 990 prep includes copies, consolidated-exclusion scan, locked-row matrix for source and copy, void refusals, category-without-mirror refusal, fund-name literal scan, role-bundle test unaffected.


**Production facts (orchestrator, 2026-10-17, Phase 6 Verify-First, read-only `BEGIN READ ONLY … ROLLBACK` on the production host ep-rough-smoke, counts and names only):**

- **VF1a, Club Public Funds income categories:** `Public donations`, `White Cane` and `Zeffy Donations` all exist, each once, and **all three are inactive**. In fact every Club category of the `activity` kind is inactive in production (7 income, 7 expense, 0 active), the 2026-08-08 "retire unbudgeted and unused" pass (`scripts/deactivate-unused-categories.ts`). `Public donations` holds 2 posted Public Funds income rows and `Pancake Breakfast` 1; the other five hold none. Foundation `public donations` and `white cane` charitable income categories exist once each and are active.
- **Seed prediction:** migration 0115 filters the Foundation side on `is_active = true` and the Club side on name only, so both Club pairs will be linked on deploy even though the Club categories are inactive. The mirror then shows on Settings → Categories only with "Show inactive" on. The gift form's picker uses `getCategories()`, which filters active only, so **no Public Funds income category is pickable in production until the treasurer reactivates the ones she uses** (pre-existing state, not an Inc 1 regression; the release notes must say it).
- **N5 is live:** `Zeffy Donations` exists (inactive, 0 rows) and is unmirrored; the treasurer must choose its counterpart (and reactivate it) before 2b or online money is unsweepable.
- **VF2, Foundation Charitable aged-funds headroom (analyst's aggregate, not the app's own computation):** balance $3,635.98 against trailing-365-day posted income $23,743.18, so about **$20,107 of headroom** before a batch of year-old gifts would start the aged-funds warning. For N4 before 2a.
- `ledger_categories.mirrors_category_id` does not exist in production yet (expected; 0115 adds it).

**Production facts (orchestrator, 2026-10-19, read-only, after the v1.99.0 deploy and the audited post-deploy writes):** the Club fund is named `Public Funds`; Club income categories `Public donations`, `White Cane` and `Zeffy Donations` are active (the other 11 Club `activity` categories stay inactive, B-199); `Public donations` and `White Cane` carry the seeded counterparts; **`Zeffy Donations` now mirrors the Foundation's `Public donations`** (set through the portal on 2026-10-18/19, `category_mirror_changed` audit row present), so N5 is closed and online money is sweepable once 2a/2b ship. The Foundation has 11 active charitable income categories (Public donations, White Cane, Kroger Community Rewards, Pizza Challenge x2, Restaurant fundraisers, Rudolph Run x3, Tail-twisting, Transfer from Club) and 7 inactive. `Transfer from Club` is the lump sweep's income category (`ack_not_required = true`, `counts_as_giving = false`, 1 posted row). Prior-year sweep default (Phase 3 ruling 11) proceeds as designed; the user said "keep going" without objection on 2026-10-19.

**Production facts (orchestrator, 2026-10-19, V8–V10 from the 2a Phase 3 confirmation, read-only):** **V8** the Club `Transfer to Foundation` category exists (`activity` / `expense`), is **inactive**, 0 posted rows, so the 2a seed under ruling A1 is a no-op in production and nothing is reactivated. **V9** the Foundation's `ledger_filings` holds FY2026 rows only (IRS, Audit Committee, Ohio AG, Ohio Commerce, all `not_started`); there is no FY2025 row, so under ruling A9 the FY2025 gifts read as not filed and are sweepable at the `ledger.manage` tier with a typed reason. **V10** the unswept Public Funds gifts are 3 rows totalling $138.50, dated 2025-01-25 to 2025-03-17, against about $20,107 of Foundation aged-funds headroom, so the first batch cannot trip the aged-funds warning; N4 is closed with no user action.

---

# Phase 2 — Architectural Review (architect)

*Review of 2026-10-17. Read-only: no code, database or dev server was touched; `docs/decisions.md` and `docs/backlog.md` are not edited (refined proposed text is at the end for tech-lead to file). Everything stated about code was read in `src/` on this date. Migration numbers below are **placeholders**: the tail today is `0114`, so Inc 1 and Inc 2 would be `0115` and `0116`, but database-admin re-derives the real next-free number at Phase 4 start (`ls drizzle/migrations/*.sql | sort | tail -3`).*

## Verdict

**Approved with suggestions.** The feature fits the codebase and needs no new dependency, no new `FEATURES` key, no new top-level directory and no new batch table. It is not blocked and nothing returns to Phase 1. The "suggestions" are binding on Phase 3 where they are phrased as rulings below; the ones that need the user's word (section "Goes back to the user") do not stop Phase 3 from starting, because each has a stated default and a one-branch flip.

The three load-bearing rulings, in one line each:
1. **A batch is one Public Funds expense leg plus N Foundation copies. There is no Foundation "credit leg" row.** The Foundation's bank-side credit *is* the N copies (they carry the Foundation bank account and sum to the one credit). A second credit row would double the Foundation fund and bank balances.
2. **Batch identity is the expense leg's row id. No `ledger_sweep_batches` table.** Two nullable pointer columns on the copy carry everything; "swept" and "batch" are derived, never marked (DECISION-082 / `ledger-reimbursement-link.ts` precedent).
3. **The Foundation copy carries the gift date; the Club leg carries the sweep date; a copy is a *creation*, not a *move*.** Prior-year gifts therefore get their own period verdict (below), and the 2026-10-02 "not movable" rule stays exactly as written for Move.

## Placement

### Directory placement

No new subdirectory anywhere. The ledger library is a flat `src/lib/ledger-*` family and the admin components are flat with an action prefix (`move-*`, `correct-*`); this feature follows both. (The family is now ~50 files in `src/lib`; whether it should become `src/lib/ledger/` is a question for the 30-day code review, not for this feature.)

| New file | Role | Server/client |
|---|---|---|
| `src/lib/ledger-sweep.ts` | **Client-safe vocabulary carrier** (precedent: `ledger-correction.ts`, `ledger-approval.ts`): request/response types, denial/blocked/conflict code unions, caps (`SWEEP_BATCH_MAX = 200`, reason length), the pure copy-field map `buildSweepCopy(source, mirror)`, the pure period verdict `sweepCopyPeriodVerdict()`, pure total check `checkSweepTotal()`, the user-facing copy as **functions of `FundLabels`**. Zero imports from `@/lib/db` at runtime. | pure |
| `src/lib/ledger-sweep-link.ts` | SQL fragments only (sibling of `ledger-reimbursement-link.ts`): `sweepCopyPredicate`, `notSweepCopy`, `sweptSourceExists(id)`, `sweptSourceHasSentReceipt`. The **only** place the swept/copy predicates are spelled. Drizzle imports only. | server-safe |
| `src/lib/ledger-sweep-batch.ts` | Server module: `evaluateSweepBatch()` (one evaluator for preview and execute, DECISION-111 item 1), `createSweepBatch()`, `voidSweepBatch()`, `listSweepCandidates()`, closeout read/write. DB-importing, admin-only, never imported from a member surface. | server |
| `src/lib/ledger-fund-labels.ts` | Client-safe fund-name labels (rename section). | pure |
| `src/lib/ledger-fund-labels-queries.ts` | `getFundLabels()` — one `select kind, name from ledger_funds where is_active`, wrapped in React `cache()`. DB-importing. | server |
| `src/lib/ledger-approval-notify.ts` | `notifyPendingApprovers()` — extracted approver-notification boilerplate (duplication section). | server |

Routes (all under `src/app/api/admin/ledger/sweep-batches/`; every handler `auth()` then `hasFeature()` as its first two statements):
- `POST …/sweep-batches/preview` — no write; body is the selected source ids + destination ids; returns the per-copy preview and the derived total. `LEDGER_RECORD`.
- `POST …/sweep-batches` — create. `LEDGER_RECORD`; the **tier is computed server-side**: a prior-fiscal-year copy requires `LEDGER_MANAGE` (DECISION-109 item 5 idiom), never trusted from the client.
- `GET …/sweep-batches/[legId]` — batch detail. `LEDGER_VIEW`-level read of what the register already shows; gift donor names are not included (see Visibility).
- `POST …/sweep-batches/[legId]/void` — JSON `{ reason }`, `LEDGER_MANAGE`, server-checked (the move/correct/delete POST-with-body precedent; not an HTTP DELETE with a body).
- `POST …/sweep-batches/closeouts` — mark source rows "not to be swept" with a reason. `LEDGER_MANAGE`.

Pages: `src/app/(dashboard)/admin/ledger/sweep/page.tsx` (Server Component: `auth()` + `hasFeature(LEDGER_RECORD)` in its own body, loads candidates, held-back rows with reasons, bank accounts, tier, labels) and `…/sweep/[legId]/page.tsx` (small read-only batch page with Void; tech-lead may fold this into a dialog). A static `sweep` segment beats the `[fundSlug]` dynamic segment, and no fund slug is `sweep`. **No nav entry is required** (entry points are the Public Funds register button and the Approvals page); if one is added it must require `LEDGER_RECORD`, and because the proxy derives per-segment rules from `ADMIN_NAVIGATION` (DECISION-082) the page's own gate stays mandatory regardless (`admin-page-feature-gates.test.ts`).

Components (flat in `src/components/admin/ledger/`, `sweep-` prefix): `sweep-batch-builder.tsx` (`'use client'`: selection state, running total, typed bank amount, submit), `sweep-batch-review.tsx`, `sweep-void-dialog.tsx` (`'use client'`, `<ConfirmDialog destructive>` with a required reason; the copy says not to type a family's name), `sweep-closeout-dialog.tsx`, and the batch row inside the Approvals page. Everything that can be a Server Component is one: the candidate list and held-back list render on the server; only the selection/total/submit island is a client component. **The client never computes eligibility, tier, total or copy fields**: it renders what `evaluateSweepBatch()` returned and re-asks on change (validate-on-change, DECISION-111 item 4).

### Dependencies

**None.** Nothing in `package.json` is added or upgraded; every need is met by what is installed (drizzle, radix/shadcn `Dialog` and `ConfirmDialog`, `sonner`, `lucide-react`, `date-fns`). UUID shape: existing `isUuid()`. Dates: `parseIsoDate` from `src/lib/ledger.ts` (CLAUDE.md names it the strict one). Fiscal year: `src/lib/fiscal-year.ts`. Mail: `sendBulkMemberEmail()`.

## Data Model (architectural shape; tech-lead details it)

### Chosen shape

On `ledger_transactions` (two nullable columns, **both only ever set on a Foundation copy**):

| Column | Meaning | Constraint |
|---|---|---|
| `swept_from_txn_id uuid` | The Public Funds source this copy was made from. Write-once. | FK to `ledger_transactions(id)` **ON DELETE RESTRICT**; **partial UNIQUE** on `(swept_from_txn_id) WHERE swept_from_txn_id IS NOT NULL AND status <> 'rejected'` |
| `sweep_leg_txn_id uuid` | The Activity expense leg of the batch this copy belongs to. Write-once. | FK to `ledger_transactions(id)` **ON DELETE RESTRICT**; plain index |

Plus one small table, `ledger_sweep_closeouts` (`txn_id` PK FK to `ledger_transactions` ON DELETE CASCADE, `reason`, `closed_by_user_id` FK `users` SET NULL, `closed_at`), for "this gift will not be swept" (see Increments for why this replaces the analyst's start-date setting).

The expense leg keeps a fresh `transfer_group_id`, **a group with exactly one row**, and keeps `board_minute`, `status`, bank account, recorder and the sweep date. It has no income partner. Copies have `transfer_group_id NULL`.

Derived, never stored: a **source is swept** iff a non-rejected copy points at it; a **leg is a sweep leg** iff copies point at it; a **batch's total, count, date, minute, recorder, status** are the leg's and the copies'. There is no second place a batch property can disagree with.

### Why this and not the alternatives (against DECISION-082)

| Alternative | Verdict | Reason |
|---|---|---|
| `ledger_sweep_batches` table | **Rejected** | Every batch attribute already lives on the leg. A batch row would need a status kept in step with the leg's and the copies' statuses (a fourth writer inside `decideTransaction`), a total kept equal to the sum, and a void flag that must agree with row existence. That is a hand-maintained duplicate of derivable facts, the exact failure DECISION-082 names. |
| Reuse `transfer_group_id` as the batch key on the copies | **Rejected** | Every income roll-up excludes `transfer_group_id IS NOT NULL` (990 prep, gross receipts, impact, category queries, unlinked-gift worklist). A grouped copy would vanish from the Foundation's 990 and donor history, which is the whole point of the feature. The analyst's structural choice is right and is adopted: **leg keeps a group id, copies carry none**. |
| A separate Foundation "credit" leg inside the group, copies as information only | **Rejected** | Fund balance is `opening + Σ income − Σ expense` over all posted rows of the fund, transfer legs included; credit leg plus N copies in one fund is 2X. Also the old lump design with a sidecar: the register would again have no real income rows for acknowledgments. |
| Side table `ledger_sweep_items(copy_id, source_id, leg_id)` (the reimbursement-link shape) | **Considered, rejected** | It would avoid touching the wide table, but the one-live-claim-per-source invariant cannot be a DB constraint across a join to the copy's status, and the lock classifier then needs a server-derived flag on every row it classifies. Columns on the copy are atomic with the row and give a real partial unique index. Cost accepted: every enumerated `ledgerTransactions` projection typed as `LedgerTransaction` (for example `getPendingApprovals`) must add the two columns; `tsc` finds them all. |
| A pointer on the **source** (`swept_batch_id`) | **Rejected** | Sweeping would UPDATE Public Funds source rows, which may be reconciled or matched in a Club session. With pointers on the copy only, a batch writes **no** source row and cannot interact with the Club's reconciliation. |

**Rejected batches.** A rejected batch keeps its copies as `rejected` rows (consistent with "rejected transactions are kept as a record" and with `decideTransaction` stamping every locked row). The partial unique index excludes `status = 'rejected'`, so the sources are claimable again with no cleanup write. Accepted residual: a source that has a rejected copy cannot be hard-deleted (RESTRICT); the delete refusal must say why. Tech-lead may instead hard-delete the rejected copies inside the reject transaction; I recommend keeping them, and either choice stays inside the one decision helper.

**Constraint names.** Name every new constraint and index explicitly and keep each ≤ 63 characters (DECISION-117 item 8; the default drizzle FK names for these two self-references are 62 to 63 characters long, one rename away from permanent `drizzle-kit push` drift, and backlog B-165 already carries ten of those). A schema test compares the names in `schema.ts` with the migration, as `ledger-approval-schema.test.ts` does. `schema.ts` first, then the idempotent migration (`ADD COLUMN IF NOT EXISTS`, guarded `DO $$` for FKs, `CREATE UNIQUE INDEX IF NOT EXISTS`).

### Category mirror

**Ruling: a declared link, `ledger_categories.mirrors_category_id` (nullable self-FK, `ON DELETE SET NULL`), set only on Activity income categories and pointing at a Foundation charitable income category.** Not one shared definition (categories are entity-scoped rows that transactions, budgets and cause lines reference), and not name matching (a rename on either side would silently unlink).

- **The Foundation category is the only source of the receipt flag and of `counts_as_giving` on a copy.** The copy's `category_id` *is* the Foundation category, so nothing is copied and nothing can drift: the acknowledgments worklist already joins the copy's own category. This is what makes the copy "a field-for-field mapping" without a flags mapping.
- **Narrowing of the analyst's Open Question 6 (disagreement, see below):** the Foundation's `form_990_line` is **not** shown as the Activity category's value. The Club files its own Form 990 (it is a 501(c)(4)); an Activity income category's `form_990_line` is the *Club's* line and stays Club-owned and editable. Only `ack_not_required` and `counts_as_giving` are read-only on a mirrored Activity category (the category PATCH refuses to change them with a typed 400 when `mirrors_category_id` is set; one writer). The screen may show the Foundation's 990 line as informational text ("The Foundation reports this as: …").
- A category with no active, charitable, income mirror is **not sweepable** and is listed under "Stays in Public Funds" with the reason. No fallback to `Public donations` (the fallback in `handleTransfer` dies with the lump path).
- Merge and deactivate must handle the link: merging a Foundation category re-points `mirrors_category_id` in the same transaction; deactivating a Foundation category with live mirrors is allowed with a warning on the existing impact endpoint (DECISION-066) and makes the affected gifts unsweepable until re-pointed; merging two Activity categories that mirror different Foundation categories is refused.
- Mirror validity is enforced at write (entity is `donations_deductible`, `fund_kind = 'charitable'`, `flow = 'income'`, active) **and re-validated per copy under lock at batch time** by reusing `checkCategoryFit()` from `ledger-transaction-validation.ts` (do not write a second category-fit check). A unit test fails on a seeded mirror that is missing, inactive or an expense category.
- **Seed policy:** the Inc 1 migration seeds only the unambiguous pairs by **name** (`Public donations` to `Public donations`; `White Cane` to the existing Foundation `White Cane`), creates `Transfer to Foundation` (Activity expense) if absent, and leaves every contested pair (`Rudolph Run`, `Pancake Breakfast`, `Sponsorships`, `Interest`) unlinked for the treasurer to set on the category screen. A migration must not encode treasurer policy that is still an open question (Open Question 3), and production already holds an inactive Foundation `Pancake Breakfast`. No person, address or amount appears in a seed.

### Donor on Public Funds rows

**No schema change.** `ledger_donors` is global (no entity column) and `ledger_transactions.donor_id` already exists. Reading the code: the create route (`POST /api/admin/ledger/transactions`) accepts no `donorId` at all today and the form has no donor picker (donors are linked afterwards via PATCH or the Unlinked-gifts worklist). Inc 1 therefore means: the create route accepts an optional `donorId` for income rows (validated to exist, as PATCH does), and the form offers the picker on Foundation **and** Public Funds income. The copy inherits `donor_id`.

## Invariants Touched

1. **Two-fund firewall and the transfer/move mutual exclusion.** `checkTransferDirection()` and `checkFundMove()` are **unchanged**, and the mutual-exclusion test stays literally true. The batch route resolves the source (`kind = 'activity'`, Club) and destination (`kind = 'charitable'`, Foundation) funds from the database, never from client-supplied entity ids, and calls `checkTransferDirection()` as its single direction gate (it returns `mode: 'sweep'`, `requiresBoardMinute: true`); any other pair is the policy's own refusal. Each source row's `fund_id` is re-verified equal to the leg's fund under lock. **The "swept copy must not be movable back" block lives in `moveBlockKind()` in `src/lib/ledger-transaction-lock.ts`**, which is where row *state* blocks live (the evaluator `evaluateFundMove()` already consults it and is the one evaluator for preview and execute); it does **not** live in `ledger-fund-move-policy.ts`, which is a pure *kind-and-entity* allow-list with no row state. Without the new block the existing cross-entity cell (Foundation charitable to Club activity, income) would let a swept copy be moved back and leave a dangling pointer. A swept *source* gets the same block for defence in depth (the policy already denies leaving `activity`).

2. **DECISION-058's pair rule, generalized to a decision group.** "A pair is exactly two legs" is copy-pasted in two places today (`decideTransaction`, `cosignTransaction`: `locked.length !== 2`), and a third and fourth (approvals pairing, `?both=true`) are implicit. Ruling: one pure function `classifyDecisionGroup(rows)` in the client-safe carrier `ledger-approval.ts` returns `single | pair | sweep_batch | fault` from the locked rows (a sweep batch is exactly one expense leg with a group id and no income partner, plus rows whose `sweep_leg_txn_id` is that leg's id; N ≥ 1), and both writers call it instead of comparing a count. The threshold is compared with the **batch total once**; all rows get the same derived status in the one create transaction (DECISION-058 retained).

3. **One decision write path (DECISION-116/117).** `decideTransaction()` remains the only code that approves or rejects; no second route writes a pending sweep's decision columns.
   - `lockDecisionPair()` in `ledger-board-decision.ts` is **extended in place and renamed `lockDecisionGroup()`** (one helper, all callers updated; it is the one lock helper and `ledger-board-decision.ts` stays the one definition of "a board decision"). Selection becomes `id = X OR transfer_group_id = (group of X) OR sweep_leg_txn_id = (leg id)`, still one statement `ORDER BY id`, `FOR UPDATE` for decide and `FOR SHARE` for co-sign.
   - **A batch is approved as one group, not as a pair.** On approve, the leg gets the full stamp (`status`, `approved_by_user_id`, `approved_at`, `board_minute`); the copies get `status = 'posted'` and `updated_at` **only**, and are not stamped `approved_at`. Reason: `approved_at` is the immutability marker every PATCH/DELETE/split/waive guard keys on and it must stay unconditional (DECISION-099 item 4, DECISION-106), but stamping it on the copies would also make their donor link uneditable, and the treasurer must be able to link donors after a sweep (the preview itself warns that a batch can create dozens of unlinked gifts). The copies' immutability comes from the new derived lock kinds below, which is an **addition** to the guards, not a carve-out of one. On reject, the leg and the copies get `status = 'rejected'` plus `rejected_by_user_id` / `rejected_at`.
   - Two pinned UPDATEs (leg; copies), each `WHERE id IN (…) AND status = 'pending'`, each count compared with the locked count, the same rollback sentinel (`StaleDecisionRollback`) on a mismatch (a plain `return` from `db.transaction` commits).
   - Self-decision refusal already reads `locked.some(...)`, so it covers the leg and every copy unchanged. Co-sign stays keyed on the **expense leg** (DECISION-117 item 2) and is unchanged except that it calls `classifyDecisionGroup()`.
   - `boardDecisionPredicate` / `boardApprovalPredicate` filter `flow = 'expense'`, so copies can never appear in Recently decided or the `?txn=` resolver; no change there.
   - **Known break sites that Phase 3 must list and change** (this is the analyst's Gap 3, made concrete): `ledger-approval-decision.ts` and `ledger-cosign.ts` (count checks); `lockDecisionPair`; `getPendingApprovals()` in `ledger-queries.ts` (it must **exclude copies** from the ordinary pending list, otherwise a pending batch lists N+1 rows, and it must derive the From/To label, count and partner entity from the copies because there is no income partner in the group); `ledger-approval-queries.ts` (the `dest` left-join on `transfer_group_id` + `flow = 'income'`, the `partnerEntityId` subselect and `viewerRecorded` all assume a partner row in the group); the `PATCH ?both=true` branch and the DELETE group-lock block in `transactions/[id]/route.ts`; the split route's `transferGroupId` guard (blocks the leg but not copies or sources); `transaction-actions.tsx` `isTransfer`; the `transfer_leg` lock kind and its `LOCK_COPY` entry (an exhaustive `Record`: a new kind is a compile error, which is the point); `buildPendingApprovalEmailHtml` (needs a count, and must pass `memo: null` and `party: null` for a batch so no free text or donor name reaches the board list). `tsc` plus the exhaustive records catch most of these; the rest are in the scan tests below.

4. **Lock kinds (additions, all derived).** `transactionLockKinds()` gains, **ahead of** `transfer_leg` (a sweep leg also has a group id and would otherwise be told to "delete the transfer and record it again"): `sweep_batch` (the leg), `swept_copy` (Foundation copy) and `swept_source` (Public Funds source with a non-rejected copy). `LockableRow` gains the two pointer columns plus a server-derived `hasLiveCopy` flag, supplied the way `paidReimbursement` is today. They are wired into `editLockKind`, `moveBlockKind`, the split guard and the DELETE guard.
   - Immutable on all three: amount, date, category, fund, bank account, flow, delete, split, move.
   - **Editable on a copy:** donor link, memo, and the acknowledgment fields (the copy is the receipt-bearing row). **Frozen on the source:** everything including its donor link once swept (disagreement with the analyst, who left the source donor editable): after a sweep the copy is the single editable truth for who the donor is; two editable donor fields on one gift is drift. The lock message on the source says "edit this on the Foundation entry".
   - Delete of a sweep leg or a copy is refused with "Void the sweep batch" (never the generic transfer text).

5. **Receipts follow the issuer; no second receipt.** The copy is a Foundation row, so `donee_entity_id` is stamped the ordinary way at acknowledgment creation (the Foundation, the transaction's own entity) and `ledger-ack-donee.ts` needs no change. A Club row can never hold an acknowledgment (the ack route refuses a non-deductible entity). The one real second-receipt path is a gift that was a Foundation row, receipted, moved into Public Funds (DECISION-112, the sent ack stays on the old row id) and then swept back as a *new* row. Ruling: **derive, do not re-point.** `ledger-sweep-link.ts` exports `sweptSourceHasSentReceipt`, and the same fragment is used (a) in `listPendingAcknowledgments()` to exclude the copy and (b) in the acknowledge POST route to refuse creating one for it (409 `receipt_already_sent`, naming the date). The sent acknowledgment row is never touched (its key, amount, date, letter and donor are the IRS substantiation record); because the copy carries the gift date, the preview and the donor page can say "receipt sent <date> against the original entry". Two call sites, one fragment, parity-tested. Zeffy's own email is handled by the mirror category's receipt flag, not per row (user answer 2026-10-16: the portal sends the written acknowledgment; mirror categories seed `ack_not_required = false`).

6. **Roll-ups that exclude transfer legs.** Adopted as the analyst structured it: the Activity leg keeps `transfer_group_id` (so it stays out of "giving", 990 prep, gross receipts and the category queries: `ledger-queries.ts` lines 4492, 4576, 4837, 4932, `ledger-category-queries.ts:236`, `impact-stats-queries.ts:50`, `ledger.ts` `isGiving`), and the copies carry none (so they reach the Foundation's 990 prep, gross receipts, donor history and the acknowledgments worklist, which the lump credit never did). Two additions: (a) the exclusion for any future cross-entity income sum is one exported fragment, `notSweepCopy`, in `ledger-sweep-link.ts`, and a source scan fails any other spelling of `swept_from_txn_id IS NULL` (so the rule has one home); (b) `getDonor()` returns every income row for a donor across both entities, so a donor linked on a source *and* its copy shows the gift twice. That is a display, not a sum today; Phase 3 must audit every consumer of `givingHistory` for totals and label the swept source "swept to the Foundation on <date>".

7. **`approvedAt` guards stay unconditional.** Nothing in this feature carves PATCH/DELETE/split. **Void** is a new dedicated audited route (the move/correct/delete precedent), and it *refuses* an approved leg (`leg.approved_at` set), a reconciled or matched leg or copy, and a copy with a sent acknowledgment, so voiding an over-threshold batch that the board approved is out of v1 exactly as the analyst ruled (B-192). A posted, under-threshold, unreconciled, unreceipted batch is voidable at `LEDGER_MANAGE`. Void deletes the copies and the leg (unsent acknowledgments go with their copy via the existing cascade and are counted in the audit row) in one transaction, `FOR UPDATE` on the leg and copies, rollback sentinel on a count mismatch.

8. **Audit.** Void writes one `sweep_batch_voided` row through `recordLedgerAudit()` (versioned payload, `v: 1`, target null because the rows are deleted; the snapshot lists ids, amounts and dates, never a name; added to `CORRECTION_AUDIT_ACTIONS` so the board-visible Recent corrections reader shows it). Batch creation writes one `sweep_batch_created` **note** (the `AUDIT_NOTE_ACTIONS` vocabulary: leg id, count, total, fiscal-year span, tier, flags, any prior-year reason; no reader yet, like the other notes). Rename, category-mirror edits and closeouts use the existing `fund_updated`, `category_*` and a closeout note. No email address, postal address or phone number in any of them.

9. **Idempotence and the claim.** The create transaction locks the source rows `FOR UPDATE ORDER BY id`, re-validates every one (Public Funds fund, income, posted, `transfer_group_id IS NULL`, not dues-synced, active charitable mirror, not closed out, not already claimed, gift date not after the sweep date), inserts the leg, then the copies. The partial unique index is the backstop: a concurrent second batch gets the unique violation mapped to a typed 409 naming the rows. The total is **derived** from the locked rows; the typed bank amount is a confirmation that must equal it exactly (no tolerance, no plug), and the client total is never read. Cap of 200 rows and length caps on minute and reason.

10. **Not a durable-claim email path.** No "this was sent" claim is written by this feature. The approval notice goes through `sendBulkMemberEmail()` via the extracted notifier; DECISION-102/103 helpers are not required. Confirmed.

11. **Migrations and schema.** `schema.ts` first, then idempotent migrations (every statement guarded), explicit short constraint names, no reference to later objects. Nothing in a migration touches the production fund row or any person.

12. **No personal data in the repo.** Seeds are category names only; test fixtures use `example.com` / `example.invalid` and invented names; the void snapshot and the audit notes carry ids, amounts, dates and counts, never names.

13. **Server/client boundary and visibility.** Server Components by default; client islands only where listed above. The batch preview and the batch page return donor *display state* ("has a donor record" yes/no, "receipt sent <date>"), not donor names or emails, to anyone below `LEDGER_RECORD`; they are `LEDGER_RECORD`-gated like the register.

## The gift-date consequences (user decision 2026-10-16: the copy carries the gift date)

The date-bearing facts, as they actually are in the code:

| Question | Ruling | Grounding |
|---|---|---|
| **Which date does each side carry?** | The Club **expense leg carries the sweep date** (the date the Club bank debit happened; it reconciles 1:1 against the Club bank line). The Foundation **copies carry the gift date**. The Foundation credit date exists only on the bank line. There is no second date column: "swept on <date>" is read from the leg. | The ack composer copies `txn_date` at ack creation, so it needs no change. |
| **A batch whose copies span fiscal years** | **Allowed.** A batch is one *bank movement*, not one accounting period. Each copy is placed in its own fiscal year by its own date; the leg sits in the sweep date's year. The alternative (one batch per fiscal year) would break "one batch equals one bank credit" and the exact-sum group match. The threshold, minute, audit note and approval are per batch; the period verdict is **per copy**. | Reconciliation is not fiscal-year-keyed (below). |
| **Reconciliation seeing Foundation income dated before the one bank credit** | **No change needed.** Candidate transactions for matching are not date-bounded (`getCandidateTransactionsForMatching()` filters on bank account, posted, unreconciled, unmatched only); the batch match and close routes contain no date logic; the close tie-out is *statement-keyed* (`opening + matched bank lines = closing`), so a book row dated outside the session period does not disturb a closed session's arithmetic; no closed session is touched because the batch writes no source row. A closed session on the Foundation account therefore does **not** block a back-dated copy. | `reconciliation-queries.ts`, `…/match/route.ts`, `…/close/route.ts`, `reconciliation.ts` tie-out. |
| **The monthly statement** | **No month is hidden.** The gate condition is a posted, unreconciled row on or before the month end that `rowGatesStatement()` calls gating, and `isUnclearedDepositRow()` is simply `flow === 'income'` (DECISION-059): every income row, back-dated or not, is carved out. So an unreconciled gift-dated copy cannot hide any statement. It *can* restate a month whose statement was already sent (the Twelve-Month and Annual columns follow `txn_date`; the One-Month column follows the bank clear date, so it lands in the month of the credit, which is the existing treatment of any late-clearing deposit). Precedent for that case is DECISION-114: **refuse only what would hide a sent statement; warn and audit what merely restates one.** The builder shows "the <month> statement was already sent; this adds $X to it" per affected month (via `findSentStatementMonth()`), the create audit note records the months, and nothing is refused on that ground. | `financial-report-queries.ts` `rowGatesStatement`, `isMonthGatedForEntity`; `ledger-fund-move-preview.ts` `findSentStatementMonth`. |
| **Prior-year gift copying into a closed or filed Foundation period; the 2026-10-02 rule** | See next paragraph. | |

**Prior-year gifts and the 2026-10-02 rule ("prior-year gifts stay not movable").** That rule, in DECISION-112, governs **Move**: an existing row *changing fund or entity*, which also changes `bank_account_id`, the column reconciliation is keyed on. It stays exactly as written and is not touched (the move policy still denies `activity` to `charitable`, so a prior-year gift cannot be "moved" into the Foundation as a workaround; the sweep is the only door). A sweep copy is a different operation: it *creates* a Foundation row and writes nothing on the source. But the rule's rationale (do not restate a prior period's books) applies to a back-dated copy just the same, so the sweep gets its own period verdict, a pure function `sweepCopyPeriodVerdict()` in `ledger-sweep.ts`, evaluated per copy by the one evaluator and re-run under lock:

1. Gift date in the **current** fiscal year (`currentFiscalYear()`): allowed at `LEDGER_RECORD`; if a successful statement send exists for the Foundation for that month, flag `statement_already_sent` (warn and audit).
2. Gift date in a **prior** fiscal year: allowed only at `LEDGER_MANAGE` (the DECISION-109 item 5 tier idiom), with a required reason (stored in the create note; the dialog says not to type a donor's name), flagged `prior_fiscal_year`.
3. **Blocked outright (`period_filed`)** when the Foundation has a filing row for that fiscal year with `status = 'filed'` (`ledger_filings`, the external report is out). "Closed" has no other meaning in this system: there is no fiscal-year close, and a closed reconciliation session does not seal book dates (table above), so "filed" is the one derivable seal.
4. Gift date **after** the sweep date: blocked (`gift_after_sweep`).

Why a verdict and not a blanket refusal: a blanket "prior-year gifts are never sweepable" would mean the June gifts from the last week of the fiscal year can never be swept when the money is moved in early July, which is the normal rhythm for online money. Why not a blanket allow: it would silently restate a filed year. **This is the one place I am proposing policy the treasurer has not spoken to, so it goes back to the user (below) with the default stated.** If the answer is "no prior-year sweeps", rule 2 becomes `allowed: false` (one branch) and the prior-year gifts are closed out instead.

The user's decision also leaves the original design of "the copy carries the sweep date and the gift date is stored beside it" dead, which retires the analyst's Gap 12 / adversarial row "never changes a closed year because the copy is dated at the sweep date" and the Open Question 1 default; nothing new is stored, and no ack-composer change is needed.

## The fund rename ("Public Funds")

**Ruling: stored name only; `kind = 'activity'` and slug `activity` unchanged; one lookup, passed to the pure functions; a scan test makes it one source.**

- Non-test `src` has about fifteen files with live "Activity Fund" text (31 including tests): `ledger-transfer-policy.ts` (2 reasons), `ledger-fund-move-policy.ts` (2), `ledger-correction.ts` (about 5 exported warning constants that the move and delete dialogs import), `ledger.ts` (2 guardrail messages), `transaction-form.tsx`, `[fundSlug]/page.tsx`, `approval-dialog-context.tsx`, `ledger-approval.ts`, and the four Treasury guide sections.
- **`src/lib/ledger-fund-labels.ts` (client-safe, pure):** `FundLabels` (kind to display name), `DEFAULT_FUND_LABELS` (fallback only; `activity` defaults to "Public Funds", so the literal "Activity Fund" is nowhere in the code), `buildFundLabels(rows)`, `fundLabel(kind, labels)`. **`ledger-fund-labels-queries.ts`:** `getFundLabels()`, one query, `cache()`d per request. Pages and route handlers call it once and pass `labels` down.
- **How the pure functions receive the name without importing the database:** two mechanisms, both already half-present. (1) The policy functions take **fund descriptors that gain an optional `name`** (`FundRef` already carries `{entityId, fundId, kind}`, and every caller already has the fund row in hand, name included): the reasons are built from `source.name` / `dest.name`, falling back to `fundLabel(kind, DEFAULT_FUND_LABELS)`. No new parameter and no signature churn in the mutual-exclusion test. (2) The exported warning *constants* in `ledger-correction.ts` become *functions of `FundLabels`* (`moveCannotBeUndoneCopy(labels)` and so on); the dialogs already receive fund objects or a page prop, and `computeGuardrails()` takes an optional `labels` with the default. The guides (Server Components) use the prop from the guide page's one lookup.
- **Scan test:** no `Activity Fund` / `Activity fund` in non-test `src/**` string literals or JSX text (comments allowed), plus a test that the register subtitle no longer renders `{fund.kind} fund`. Fixture names in `*.test.ts(x)` are exempt because they are stored-name fixtures.
- **Rename mechanics (confirming the analyst):** no migration rewrites the production row. The fund editor's PATCH is already audited (`fund_updated`, DECISION-115), so the user renames it there right after deploy (release-checklist item for the orchestrator). Until then every string reads the stored "Activity Fund" and the app is self-consistent. Fresh installs: change the seed literal in the original fund-seed statement (it is `WHERE NOT EXISTS`, so a no-op on every existing database).
- **Disagreement (small):** the analyst's "description noting it is the Lions International Activities account" assumes a stored description; `ledger_funds` has **no description column** (name, kind, opening balance, active). Do not add one for a sentence. The sentence is static UI copy next to the heading (register header and guide), read from the labels module.

## Duplication check (named decisions this feature would otherwise implement in a third place)

| Decision | Existing copies | Ruling |
|---|---|---|
| "A pair is exactly two legs" count check | `decideTransaction`, `cosignTransaction` | One pure `classifyDecisionGroup()`; both call it. |
| The decision-group lock | `lockDecisionPair()` (two callers) | Extend and rename in place to `lockDecisionGroup()`; never a sweep-specific locker. |
| `BOARD_MINUTE_MAX_LEN = 500` | `transactions/route.ts:72`, `budget-approvals/route.ts:72`, `ledger-approval-decision.ts:38` (**already three**) | The batch module must not be a fourth. Move the constant into the client-safe `ledger-approval.ts`, import it everywhere, delete the two route-local copies (proposed B-195; do the two deletions in Inc 2 since the batch route and the form both need the client-safe constant). |
| Route-local `parseDate()` (two copies) and `validateAmount()` | `transactions/route.ts`, `transactions/[id]/route.ts` | Batch uses `parseIsoDate` from `ledger.ts`; the server derives the total and needs no amount parser. |
| Dollars-string to cents parser (typed bank amount in the builder) | **Nine local copies already**: `parseDollars` in `transaction-form.tsx`, `split-transaction-dialog.tsx`, `acknowledge-dialog.tsx`, `ledger-settings-form.tsx`, `dues-configure-modal.tsx`; `parseDollarsToCents` in `search/page.tsx`, `budget-editor.tsx`, `budget-cause-editor.tsx`; `parseDollarsInput` in `dues-payment-form.tsx` | The builder would be the tenth. It must import ONE shared parser: add a single exported `parseDollarsToCents` to the client-safe `src/lib/ledger.ts` (or a tiny `money` module) in Inc 2 and use it only there; consolidating the nine existing copies is proposed B-197 (a finding with a count and a home, per the Duplication rule), not part of this feature. |
| Approver-notification boilerplate (`getEmailsForFeature`, treasurer CC resolve, `sendBulkMemberEmail`, try/catch with `console.error`) | Two inline blocks in `transactions/route.ts` (expense branch and transfer branch) | The batch would be the third. Extract `notifyPendingApprovers()` into `ledger-approval-notify.ts`, move both existing blocks onto it, batch uses it. The body stays `buildPendingApprovalEmailHtml()`; escaping stays `escapeHtml()`; from-address `getFromEmail()`; URL `buildApprovalReviewUrl()`. |
| Category-fit and bank-account-fit checks | `ledger-transaction-validation.ts` (`checkCategoryFit`, `checkBankAccountFit`) | Reuse; handleTransfer's inline copies are replaced when the lump path is retired. |
| Sent-statement lookup | `findSentStatementMonth()` lives in `ledger-fund-move-preview.ts` and is already consumed by the move preview and the reimbursement-correction queries | The sweep is the fourth consumer. Relocate it next to `monthBounds` / `MEMBER_EXPOSED_FUND_KINDS` in `financial-report-queries.ts` (proposed B-196); until then import it, do not reimplement. |
| The swept / copy predicates | none yet | One home: `ledger-sweep-link.ts`; a scan fails any other spelling. |
| Fund display names | 31 literal sites | `ledger-fund-labels.ts`. |
| Check-number normalizer (five call sites) | `ledger.ts` | The copy does **not** carry the check number or receipt keys, so it never needs it (CLAUDE.md: never add a sixth). |
| Board-decision predicate | `ledger-board-decision.ts` (three consumers) | Unchanged; copies are income so they never reach it. |

## Increments (confirmed with one re-cut)

| Inc | Content | Migration? | Phase 4/5 environment |
|---|---|---|---|
| **1** | Labels module and the rename (all string sites, scan test, guide); `mirrors_category_id` with the category screen, PATCH rules, merge/deactivate handling and impact-endpoint line; mirror and `Transfer to Foundation` seed; create route and form accept a donor on income rows (Foundation and Public Funds); "Foundation-bound: yes/no, receipt needed" hint on the Public Funds form; fresh-install seed name. Sweeps still work the old lump way. Ships alone. | **Yes** (one: the column, the seeds; placeholder `0115`) | **Worktree + its own Neon branch** (Pipeline rule 5) |
| **2** | Sweep batch: the two pointer columns, partial unique index and `ledger_sweep_closeouts`; `classifyDecisionGroup` / `lockDecisionGroup` and the approval and co-sign generalization; `evaluateSweepBatch` / create / void / candidates; the lock kinds and every guard; ack suppression; `handleTransfer` refuses `mode: 'sweep'` with a typed `use_sweep_batch` error; `?sweepFrom=` and `sweep-prefill-launcher.tsx` retired, the "Record sweep now" link re-aimed at the builder; builder, review, void and closeout UI; consolidated-exclusion and single-spelling scans; the extracted notifier; Treasury guide pages; "Match this batch" shortcut **folded in** unless it exceeds about 100 lines (then it is a small no-migration Inc 3). I recommend Phase 3 sequence it as **2a** (schema, server core, locks, approval generalization, void; lump mode still open) then **2b** (UI, closeout, retire the lump path and the launcher, guide), because the lump path must not close before its replacement exists, and only 2a carries the migration. | **Yes** (2a: placeholder `0116`) | **Worktree + its own Neon branch** for 2a and for qa; 2b may stay on the same worktree |
| later | B-120 (Zeffy import creates source rows with Zeffy ids), B-191 refund of a swept gift, B-192 void of an approved batch | n/a | n/a |

Both Inc 1 and Inc 2 add a migration, so each runs Phase 4 and Phase 5 in an `isolation: "worktree"` with a Neon **dev** branch and its own `.env.local` copy. The database-admin must pass the branch id **positionally** to `neonctl connection-string` and compare the host before any write (the CLAUDE.md gotcha: `--branch-id` is silently ignored and returns production). No agent writes the production database (Workflow Rule 10); the production fund rename is the user's click in the fund editor.

**Re-cut against the analyst's table, with reasons:**
- **The "itemized-sweeps start date" setting and the closeout *screen* (B-190, Flow 13) are replaced by a per-row closeout marker** (`ledger_sweep_closeouts`) offered inline in the builder ("Mark as already handled", reason required, `LEDGER_MANAGE`, audited). Production has three unswept-looking prior-year gifts and one historical lump, so a global cutoff date plus a dedicated screen is more machinery than the data warrants, and a date setting is a second way to say "do not sweep this" next to the marker. The marker is also reusable for "keep this mirrored gift in Public Funds on purpose".
- Inc 3 folds into Inc 2 as the analyst allowed.

## Goes back to the user

1. **Prior-year gifts and the sweep (the one open policy).** With the copy carrying the gift date, a June gift swept in July (or one of the three prior-year gifts now in Public Funds) lands in last fiscal year's Foundation books. My default: allow it for a `ledger.manage` holder with a required reason, refuse it outright once the Foundation's 990 for that year is marked filed, and warn (not refuse) when it adds to a month whose statement was already sent. The alternative is to refuse every prior-year sweep (one branch) and close those gifts out instead. Which should it be? (This is the 2026-10-02 question restated for sweeps; the answer for Move stays no.)
2. **The three prior-year gifts and the 2026-10-01 lump.** Are those three gifts already inside the 2026-10-01 lump? If yes, the treasurer closes them out; if no, they are the first (prior-year) copies. Not blocking Phase 3.
3. Already open with defaults and not re-asked: which Public Funds categories are Foundation-bound (Open Question 3; contested pairs are left unlinked by the seed), and the gift-date and portal-receipt answers (done).

## Notes for Phase 3 (honor these)

- **Phase 1 handoff items, resolved:** (1) batch representation and the break-site list: above; (2) label module: above; (3) mirror link, parity test, merge/deactivate rules: above; (4) lock kinds and the restrict FK: above; (5) lump refusal and launcher retirement: Inc 2b; (6) not a durable-claim path: confirmed; (7) the analyst's named tests stand, with the additions below.
- **Tests Phase 3 should name (additions to the analyst's list):** `classifyDecisionGroup` matrix (single, pair, batch of 1, batch of N, fault); concurrent batch creation on one source (the partial unique index, typed 409); reject frees the sources, approve frees none; approve stamps the leg but not the copies' `approved_at` and a donor edit on an approved batch's copy still succeeds; the lock matrix for `sweep_batch` / `swept_copy` / `swept_source` across PATCH, DELETE, split, move, with the donor carve-out; `checkFundMove` mutual-exclusion test unchanged and green, plus `moveBlockKind(swept_copy)` refusing the Foundation-to-Public-Funds cell; `sweepCopyPeriodVerdict` matrix (current year, prior year, filed year, sent month, gift after sweep); batch spanning two fiscal years posts one leg and N copies each in its own year; preview/execute parity for every refusal code; `sweptSourceHasSentReceipt` used by both the worklist and the acknowledge route; `notSweepCopy` single-spelling scan; the "Activity Fund" literal scan; constraint-name length/parity test; `handleTransfer` refuses `sweep` mode; `getPendingApprovals` returns one row per pending batch and no copies; a posted batch leaves `/members/impact` giving and the Club's 990 prep unchanged and adds the copies to the Foundation's 990 prep.
- **Aged-funds guardrail (Gap 13).** DECISION-105 ages the *money* oldest-first (FIFO) and the treasurer confirmed FIFO on 2026-10-02. Keep FIFO; do not switch it to the per-gift swept marker in this feature. Phase 3 must make the builder wording agree with it (a gift can look unswept while FIFO says the oldest dollars are already consumed).
- **Foundation bank-side facts.** Post the batch when the bank transfer has been made. Until the Foundation credit is matched, the copies are ordinary uncleared deposits (the existing divergence footnote), which is the intended in-transit treatment.
- **Copy field map** lives in the one pure `buildSweepCopy()`: carried: gift date, amount, party, memo, donor, cause, payment method, board minute; set: Foundation entity, charitable fund, mirror category, the Foundation bank account, status (the leg's derived status), recorder = actor, both pointers; **not** carried: check number, receipt key and waiver trio, `public_note`, `budget_line_id`, `dues_payment_id`, reconciliation fields.
- **Visibility.** The builder and the batch page are `LEDGER_RECORD`-gated like the register; no donor names in the approval email, the audit snapshots or the batch page.
- **Documentation at ship (tech-lead):** CLAUDE.md ledger bullets (sweep batch, labels module, the rename), the Treasury guide, release notes, and the worktree/Neon-branch note for Inc 1 and Inc 2 in the work-log header.
- **Mobile and brand:** cards below `xl`, table at `xl+` from one shared actions block (the 2026-10-10 approvals lesson), 44px targets, `rounded-2xl` cards, `rounded-lg` buttons, `<ConfirmDialog>` for void, no native dialogs.

## Refined proposed DECISION / backlog text (for tech-lead to file; the analyst's text above is superseded where these differ)

**Proposed DECISION-126 — Itemized sweep: a batch is one Public Funds expense leg plus N Foundation copies; identity is the leg; elimination is by marker.**
1. The batch is the Activity expense leg (keeps a fresh single-row `transfer_group_id`, the sweep date, the board minute and the derived status) and N Foundation income rows (`transfer_group_id NULL`, the **gift date**, each with write-once `swept_from_txn_id` and `sweep_leg_txn_id`, both ON DELETE RESTRICT, the former partial-unique over non-rejected rows). There is no Foundation credit leg and no batch table.
2. Swept, copy, source and batch are derived, never marked; the predicates live in `ledger-sweep-link.ts`; any cross-entity income sum excludes copies through `notSweepCopy`.
3. `decideTransaction()` stays the only decision writer; `lockDecisionPair` becomes `lockDecisionGroup`; `classifyDecisionGroup()` replaces the two copies of the "exactly two legs" check; approve stamps the leg and only posts the copies (no `approved_at` on copies); reject rejects all.
4. New lock kinds `sweep_batch`, `swept_copy`, `swept_source` precede `transfer_leg`; the swept-copy move block lives in `moveBlockKind`, not in either direction policy; the two policies stay unmerged and the mutual-exclusion test stays true.
5. Total derived from rows, typed amount must equal it, no plug; one claim per source under lock; cap 200.
6. Per-copy period verdict (`sweepCopyPeriodVerdict`): current year at `ledger.record`; prior year at `ledger.manage` with a reason; blocked when the Foundation's filing for that year is `filed`; a sent statement month is a warning, never a refusal (DECISION-114 precedent). Move's prior-year refusal (DECISION-112) is untouched.
7. The Foundation category is the only source of receipt and giving flags; `mirrors_category_id` declares the link; a sent acknowledgment on the source suppresses the copy's receipt by derivation, the sent row never touched.
8. Void is a dedicated `ledger.manage` route that refuses approved, reconciled, matched and receipted batches; the `approvedAt` guards stay unconditional. Lump-sum sweep mode is closed (`use_sweep_batch`). No new `FEATURES` key.

**Proposed DECISION-127 — The Activity fund is displayed as "Public Funds" by changing the stored name only, read through one labels module.** `kind` and slug stay `activity`. `src/lib/ledger-fund-labels.ts` is the client-safe single source; policy functions take fund descriptors that carry `name`; exported warning constants become functions of `FundLabels`; a scan fails the literal "Activity Fund" in non-test `src`. No `description` column (the explanatory sentence is UI copy). Production is renamed by the user in the audited fund editor; no migration rewrites the row; the fresh-install seed uses the new name.

**Backlog text (replaces/extends the analyst's):**
- *B-190 (revised)* — Per-row sweep closeout marker (`ledger_sweep_closeouts`), offered inline in the builder; replaces the start-date setting and the dedicated closeout screen. Ships with Inc 2.
- *B-191, B-192, B-193, B-194* — as proposed by the analyst (B-194 now rides inside Inc 2 together with the sent-receipt suppression, which touches the same worklist).
- *B-195 (new)* — One `BOARD_MINUTE_MAX_LEN` (three copies today) and one date parser for the ledger routes (`parseDate` twice); delete the route-local copies.
- *B-196 (new)* — Move `findSentStatementMonth()` out of `ledger-fund-move-preview.ts` into `financial-report-queries.ts` (fourth consumer arrives with the sweep).
- *B-197 (new)* — Consolidate the nine local dollars-to-cents parsers in the ledger and dues components onto the one shared `parseDollarsToCents`.

## Handoff (standard template)

**Owner:** architect  **Status:** complete  **Date:** 2026-10-17

### Summary
Approved with suggestions. A sweep batch is one Public Funds expense leg plus N Foundation copies identified by two pointer columns on the copy, with no batch table and no Foundation credit row; the copy carries the gift date and the leg the sweep date, and prior-year gifts get a per-copy period verdict instead of touching the Move rule. No dependency, no new key, no new directory. Both increments add a migration and run in a worktree with a Neon dev branch.

### What I did
- Read the whole work-log, the cited DECISIONs, CLAUDE.md, and the schema, policies, lock classifier, decision, co-sign and approvals code, the roll-up and reconciliation/month-gate code, and the transfer create route.
- Ruled on placement, data shape, every named invariant, the gift-date consequences, the rename mechanism, duplication, and the increment split.

### Outputs
- `/Users/cshenso/git/westervillelions/docs/work-log/2026-10-16-itemized-sweep-public-funds.md` (this section and the Phase 2 status row only).
- No decision filed; refined DECISION-126/127 and backlog B-190 (revised), B-195, B-196, B-197 are proposed text above for tech-lead to file.

### Open questions / handoff notes
- User: prior-year sweep policy (default stated above); whether the three prior-year gifts are inside the 2026-10-01 lump.
- Phase 3: break-site list (Invariant 3), the `getDonor` audit (Invariant 6), the test list, the Inc 2a/2b sequence, the explicit constraint names, and the placeholder migration numbers (re-derive at Phase 4 start).

---

# Phase 3 — Technical Design (tech-lead)

*Design of 2026-10-17. Read-only: no code, database, dev server or migration file was touched. Everything stated about code was read in `src/` on this date; line numbers are as of that read. Migration numbers are placeholders (the tail is `0114`; Inc 1 would be `0115`, Inc 2a `0116`); database-admin re-derives the real number at Phase 4 start (`ls drizzle/migrations/*.sql | sort | tail -3`). DECISION-126 and DECISION-127 are filed in `docs/decisions.md` as `Proposed`; backlog B-190 to B-197 are filed in `docs/backlog.md`.*

## Rulings that differ from Phase 1/2 (read first)

Each item names the earlier text it changes and the cost of reversing it.

1. **The `Transfer to Foundation` category moves from Inc 1 to Inc 2a** (architect: Inc 1 seed; analyst B-34(a): Inc 1). It has no consumer until the batch leg uses it, and a seeded Public Funds expense category is selectable in the ordinary expense form today: a hand-keyed one-sided "Transfer to Foundation" expense would drain the fund with no pair, no board minute and no Foundation row, which is precisely the firewall bypass `checkTransferDirection()` exists to prevent. 2a creates it (`counts_as_giving = false`) in its own migration, with its only writer the batch leg. Reversal: one `INSERT ... WHERE NOT EXISTS` moved back.
2. **The mirror seed is a one-shot, not a replay** (architect: "seeds only the unambiguous pairs by name"). Migrations replay on every deploy, so a plain by-name `UPDATE ... WHERE mirrors_category_id IS NULL` would silently re-link a pair the treasurer deliberately cleared ("keep White Cane in Public Funds"). The seed runs inside one `DO` block guarded by a marker row in `ledger_audit_log` (`action = 'category_mirrors_seeded'`, both targets null), and inserts the marker in the same block. Reversal: none needed; strictly safer.
3. **`ledger_sweep_closeouts` is Inc 2a, not Inc 1** (dispatcher asked whether the architect placed it in Inc 1: he did not). Inc 1 carries exactly one migration (the mirror column, the seed, the fresh-install fund literal). B-190 is renumbered "ships inside Inc 2a (table, routes) and 2b (inline UI)".
4. **Donor totals: the one consumer of `givingHistory` that sums is fixed in Inc 1** (architect: "Phase 3 must audit every consumer"). Audit result: `getDonor()` has one reader that totals, `donor-detail-client.tsx:81` (`totalGiving`), and it sums every income row across both entities. Once a donor can be linked to a Public Funds row (this increment) the donor page would count a gift in the Club's fund and, after Inc 2, again as the Foundation copy. Ruling: `getDonor()` rows carry `entityDonationsDeductible`; the total sums only deductible-entity rows (pure helper `sumDeductibleGiving()`); a Public Funds row is labelled "Public Funds, not yet a Foundation gift". Inc 2b adds "swept to the Foundation on <date>". Absorbed under the ~30-line rule (no schema, no new API).
5. **Rejected copies are kept** (architect's recommendation, adopted, not just allowed): reject stamps them `rejected` like every other rejected row. Cost accepted and recorded: a rejected batch leaves N rejected rows in the Foundation register, and a source with a rejected copy cannot be hard-deleted (FK `RESTRICT`), so the delete route pre-checks and answers a typed 409 `sweep_history`, never a bare 500 (Postgres `23503`).
6. **Approving a batch writes the final board minute to the copies too.** DECISION-058's approve path lets the approver supply a minute that replaces the stored one; on a batch that would leave the leg and the copies citing different minutes. The copies' UPDATE sets `board_minute` to the same final value (still no `approved_at` on a copy).
7. **Void adds two period gates the architect did not list:** the leg must be dated in the current fiscal year (`prior_fiscal_year` block) and no copy may fall in a Foundation fiscal year whose IRS filing is `filed` (`period_filed` block). Void deletes copies dated in other years than the leg, so it is a restatement; the analyst's Flow 8 already said "current fiscal year", the architect's refusal list omitted it.
8. **"Filed" means the Foundation's IRS filing row.** `ledger_filings` holds several rows per entity per fiscal year (IRS, Ohio AG, Secretary of State). `period_filed` reads rows with `agency = 'IRS'` and `status = 'filed'`. Phase 4 of Inc 2a confirms with a read of the seeded titles before relying on it.
9. **The kind badge is a static noun, not the stored name.** Where the raw fund `kind` was printed ("activity", under three headings and in the register subtitle) it becomes `fundKindBadge(kind)` ("Public" for `activity`). It is a noun for the *kind*, which never changes, so it does not need the stored-name lookup; the scan test covers it.
10. **The scan pattern is wider than "Activity Fund".** `ledger-settings-form.tsx:156` says "an Activity, Charitable, or Scholarship fund", and two guardrail strings say "Activity/public fund" and "Activity/Charitable fund"; none contains the phrase "Activity Fund". The scan bans a capital-A `Activity` in string literals and JSX text across the ledger surfaces (lowercase "activity" in "Cleared activity" and "Chase activity export" is unaffected) plus a case-insensitive `activity fund(s)`.
11. **Defaults applied by the orchestrator, recorded here and not re-asked:** prior-year gifts are sweepable at `ledger.manage` with a typed reason and blocked once that year's IRS filing is `filed`; the 2026-10-01 lump covers at most part of the three prior-year gifts (V7) so the treasurer marks the carried rows through the per-row closeout; the lump mode is removed and refused at the API (2b); mirror categories seed `ack_not_required = false`; the Activity category's receipt and giving flags are read-only; the Club receipts total is unchanged with an "of which swept" line (B-193).
12. **Nothing in Phase 1 or 2 is reversed.** Gift date on the copy, portal-sent receipts, no batch table, the leg's id as the batch id, no Foundation credit row, no new key, the two unmerged policies, the generalized decision group: all stand as written.

## Summary

B-172 ships as three increments, in order, each with its own work-log (`2026-10-17-itemized-sweep-inc1-rename-and-mirrors.md`, `...-inc2a-sweep-batch-core.md`, `...-inc2b-sweep-batch-ui.md`).

- **Inc 1 (ships alone, one migration):** the Activity fund reads "Public Funds" everywhere it is named (stored name through one labels module, a fund descriptor `name` in the pure policies, a scan test), Club Public Funds income categories can declare a Foundation counterpart (`mirrors_category_id`, with a one-shot name-matched seed), a gift can be keyed with its donor on Public Funds and Foundation income, and the form says up front whether a gift is Foundation-bound and whether a receipt will be needed. Sweeps still work the old lump way.
- **Inc 2a (migration):** the batch core. Two pointer columns and a partial unique index, the closeouts table, `classifyDecisionGroup` / `lockDecisionGroup`, `evaluateSweepBatch` / create / void / candidates, the three lock kinds in every guard, the receipt-suppression predicate, the extracted approver notifier, five routes. No builder UI; lump mode still open.
- **Inc 2b (no migration):** the builder, review step, void and closeout dialogs, the Approvals batch row, the pending-sweep chips, "Match this batch", the Treasury guide pages, retirement of `?sweepFrom=` and the launcher, and closing the lump mode with `use_sweep_batch`.

## Permissions

- **No new `FEATURES` key in any increment** (architect, adopted). Existing keys: `ledger.record` (key a gift with a donor; build, preview and post a batch), `ledger.manage` (rename in the fund editor, set a category counterpart, void, close out, any prior-year copy), `ledger.approve` (decide and co-sign), plus `ledger.view` for the read-only batch GET.
- **Default role bindings:** unchanged. No bind migration, so `default-role-bundles.test.ts` is run, not edited. `treasurer` must still never hold `ledger.approve`, `admin.users` or `admin.roles`.
- **Server-side tiering:** `mirrorsCategoryId` on POST and PATCH of a category requires `ledger.manage` (same rule as `form990Line` and `countsAsGiving: false` on create); the tier of a batch (record versus manage) is computed on the server from the locked rows (2a) and never read from the client.

## API Contract

**Carriers** (client-safe, zero runtime `@/lib/db` imports; the UI imports its types and enums from these so a widened or removed member breaks `tsc`): Inc 1 `ledger-fund-labels.ts` (labels), `ledger-category-mirror.ts` (mirror check codes, hint states, the exhaustive copy record), `ledger-donor-giving.ts` (`sumDeductibleGiving`); Inc 2 `ledger-sweep.ts` (everything under "Increment 2a").

### Increment 1

- `PATCH /api/admin/ledger/categories/[id]` (existing, `ledger.manage`): body gains `mirrorsCategoryId?: string | null`. Validation inserted after the existing field checks, in order: shape (`isUuid` or null, else 400 `invalid_mirror`); target loaded (404 `mirror_target_not_found`); `checkCategoryMirror(subject, target)` (400 with the code it returns: `subject_not_public_income`, `target_not_foundation_income`, `target_inactive`, `target_is_self`); then the **flag guard**: with the effective mirror (the patch value if present, else the stored one) non-null, a patch that changes `countsAsGiving` or `ackNotRequired` is 400 `mirrored_flag_read_only` (a patch that clears the mirror and changes a flag in one request is allowed; a patch that repeats the stored flag value is a no-op, not an error). `form990Line` stays editable on a mirrored category. Audit: the diff now includes `mirrorsCategoryId`; precedence becomes name, then `isActive`, then **`category_mirror_changed`**, then flags; the `before`/`after` carry ids only. Response: the DTO, which gains `mirrorsCategoryId`.
- `POST /api/admin/ledger/categories` (existing): optional `mirrorsCategoryId` for a Club Public Funds income category; sending it needs `ledger.manage` (plain-language 403 before any lookup, like `form990Line`); same validator.
- `GET /api/admin/ledger/categories/[id]/impact` (existing): `CategoryImpact` gains `mirror: { id; name; isActive; entityName } | null` and `mirroredBy: { count: number; names: string[] }` (names capped at 10). The deactivate dialog reads `mirroredBy` and warns that those gifts become unsweepable until re-pointed; deactivation itself stays unconditional.
- `POST /api/admin/ledger/categories/merge` (existing): refuses with 409 `mirror_conflict` when source and destination both have a counterpart and they differ; on `confirm: true` re-points every `mirrors_category_id` equal to the source to the destination in the same transaction; the plan response gains `mirrorsRepointed: number`; the audit details mention the count only.
- `POST /api/admin/ledger/transactions` (existing, `ledger.record`): body gains `donorId?: string | null`. Only valid when `flow = 'income'` and the fund kind is `activity` or `charitable` (else 400 `donor_not_applicable`); the donor must exist (404 `donor_not_found`) through one shared `donorExists(id)` in `ledger-queries.ts`, which the PATCH route's inline check is moved onto (two readers, one definition). An absent or null `donorId` behaves exactly as today. The 201 body is unchanged.
- `getDonor()` (library): each `givingHistory` row gains `entityDonationsDeductible: boolean`.
- No other route changes. `handleTransfer` is untouched in Inc 1.

### Increment 2a (contract level)

All under `src/app/api/admin/ledger/sweep-batches/`; every handler's first two statements are `auth()` then `hasFeature()` (the non-holder answer is identical for any batch id).

| Route | Gate | Request | Response |
|---|---|---|---|
| `POST …/preview` | `ledger.record` | `SweepPreviewRequest` | `SweepPreviewResponse` (200 always for a well-formed request, refusals inside the body) |
| `POST …/` | `ledger.record`; tier computed | `SweepBatchCreateRequest` | 201 `SweepBatchCreatedResponse`; 400/403/404/409 `SweepErrorBody` |
| `GET …/[legId]` | any of view/record/manage/approve | none | `SweepBatchDetail` (no party, donor or memo text) |
| `POST …/[legId]/void` | `ledger.manage` | `{ reason: string }` | 200 `SweepVoidResponse`; 409 `{ error, code: SweepVoidBlock }` |
| `POST …/closeouts` | `ledger.manage` | `{ action: 'mark' \| 'unmark'; sourceIds: string[]; reason?: string }` | 200 `{ marked \| unmarked: number }` |

`ledger-sweep.ts` exports (the names the UI branches on):

- Constants: `SWEEP_BATCH_MAX = 200`, the reason limits (re-exported from `REASON_LIMITS`), `BOARD_MINUTE_MAX_LEN` (moved into `ledger-approval.ts`, B-195, and imported here).
- `SweepRowRefusal` (per source row, in evaluation order): `not_found | wrong_fund | not_income | not_posted | transfer_leg | dues_synced | already_swept | closed_out | no_mirror | mirror_inactive | mirror_invalid | gift_after_sweep | period_filed | manage_required`.
- `SweepRowFlag` (warnings that do not block): `prior_fiscal_year | statement_already_sent | receipt_already_sent | no_donor | not_matched_to_deposit`.
- `SweepWarning` (batch level): `exceeds_fund_balance | unmatched_sources | statement_months_changed | no_donor_count`.
- `SweepErrorCode`: `batch_too_large | duplicate_ids | invalid_id | minute_required | reason_required | direction_denied | bank_account_invalid | fund_not_found | manage_required | rows_refused | rows_claimed | total_mismatch | use_sweep_batch` (the last is 2b's lump refusal).
- `SweepVoidBlock`: `not_found | not_a_sweep | pending_use_reject | already_rejected | approved | reconciled | matched | receipt_sent | prior_fiscal_year | period_filed`.
- Requests and responses: `SweepPreviewRequest { sourceIds; sourceBankAccountId; destBankAccountId; sweepDate? }`; `SweepBatchCreateRequest extends SweepPreviewRequest { boardMinute; bankAmountCents; priorYearReason? }`; `SweepPreviewRow { sourceId; giftDate; amountCents; party; categoryName; foundationCategoryName; flags; receiptSentOn: string | null }`; `SweepPreviewResponse { rows; totalCents; count; tier: 'record' \| 'manage'; status: 'posted' \| 'pending'; thresholdCents; fiscalYears: number[]; sentStatementMonths: { month: string; addsCents: number }[]; warnings; refusals: { sourceId; code }[]; canPost: boolean }`; `SweepBatchCreatedResponse { legId; transferGroupId; copyIds; status; totalCents; count }`; `SweepBatchDetail { legId; status; sweepDate; boardMinute; recordedBy: string \| null; count; totalCents; byCategory: { name; count; cents }[]; fiscalYears; approved: boolean; reconciled: boolean }`; `SweepVoidResponse { voided: true; copiesRemoved: number; acknowledgmentsRemoved: number }`.
- Pure functions: `buildSweepCopy(source, mirror, ctx)` (the field map in the architect's notes), `sweepCopyPeriodVerdict(...)`, `checkSweepTotal(derived, typed)`, `sweepTier(rows)`, and the user-facing copy as functions of `FundLabels` in an exhaustive `Record<SweepRowRefusal | SweepErrorCode | SweepVoidBlock, ...>`.

### Increment 2b (contract level)

No new server routes except the lump refusal. `POST /api/admin/ledger/transactions` with `transfer: true` and a direction that resolves to `mode: 'sweep'` answers 400 `{ code: 'use_sweep_batch' }` (`handleTransfer`'s inline destination-category fallback to `Public donations` is deleted with it); same-fund Transfer mode is untouched. `GET /admin/ledger/sweep?sweep=<uuid>[,<uuid>…]` preselects rows (every id passes `isUuid`, silently ignored otherwise, capped at 200).

## Data Model

### Increment 1 (migration `0115`, placeholder)

- `ledger_categories.mirrors_category_id uuid` nullable, no default. Self-FK **`ledger_categories_mirror_fk`**, `ON DELETE SET NULL`, declared in `schema.ts` with `foreignKey({ columns, foreignColumns, name })` (the inline `.references()` form would give drizzle's default 61-character name and a `AnyPgColumn` annotation; an explicit short name keeps it under 63 and equal in schema and migration). No index (the table is about 100 rows).
- Migration statements, all idempotent: `ADD COLUMN IF NOT EXISTS`; the FK inside a `pg_constraint` guard; **the one-shot seed** in a single `DO` block: if no `ledger_audit_log` row has `action = 'category_mirrors_seeded'`, then for Club (`slug = 'club'`) `activity` income categories named `Public donations` or `White Cane`, set `mirrors_category_id` to the Foundation (`slug = 'foundation'`) `charitable` income category of the same lower-cased name that is active (lowest `sort_order`, then `id`, when more than one), only where the column is currently null, and insert the marker row in the same block. The contested pairs (`Rudolph Run`, `Pancake Breakfast`, `Sponsorships`, `Interest`, `Rudolph Run – …`) are not touched. No person, address or amount appears. No `Transfer to Foundation` category (ruling 1).
- `0044_ledger_books.sql`: the activity fund's seed literal becomes `'Public Funds'` (still `WHERE NOT EXISTS`, a no-op on every database where it has run). No migration updates any existing fund row.
- `schema.ts`: the column, the FK, and the action vocabulary comment on `ledgerAuditLog` gains `category_mirror_changed` and `category_mirrors_seeded`, and its "exactly one target is non-null" invariant note gains `category_mirrors_seeded` as the third both-targets-null exception (beside `ack_letter_template_updated` and `reconciliation_session_discarded`); no reader lists this action (the board-visible reader filters on `CORRECTION_AUDIT_ACTIONS`).

### Increment 2a (migration `0116`, placeholder; contract level)

- `ledger_transactions.swept_from_txn_id uuid` and `ledger_transactions.sweep_leg_txn_id uuid`, nullable, write-once (enforced by the route layer and the lock kinds, not a trigger). FKs **`ledger_txn_swept_from_fk`** and **`ledger_txn_sweep_leg_fk`** to `ledger_transactions(id)`, `ON DELETE RESTRICT`.
- Partial unique index **`ux_ledger_txn_swept_from_live`** on `(swept_from_txn_id) WHERE swept_from_txn_id IS NOT NULL AND status <> 'rejected'`; plain partial index **`ix_ledger_txn_sweep_leg`** on `(sweep_leg_txn_id) WHERE sweep_leg_txn_id IS NOT NULL`.
- `ledger_sweep_closeouts(txn_id uuid primary key, reason text not null, closed_by_user_id uuid, closed_at timestamp not null default now())`, FKs **`ledger_sweep_closeouts_txn_fk`** (`ON DELETE CASCADE`) and **`ledger_sweep_closeouts_user_fk`** (`ON DELETE SET NULL`).
- Seed: the Club's Public Funds expense category `Transfer to Foundation` (`counts_as_giving = false`) `WHERE NOT EXISTS` by name, entity and fund kind (ruling 1).
- Every name ≤ 63 characters, asserted by a schema test that compares `schema.ts` with the migration text (precedent `ledger-approval-schema.test.ts`). `schema.ts` first, then the migration.

### Increment 2b

No schema changes.

## Component / Page Plan

### Increment 1

**Pages created:** none.

**New library modules (all in the flat `src/lib/ledger-*` family):**
- `ledger-fund-labels.ts` (pure): `FundKind`, `FundLabels`, `DEFAULT_FUND_LABELS` (`activity: "Public Funds"`, the others as seeded), `buildFundLabels(rows)` (first active row per kind wins; unseen kinds keep the default), `fundLabel(kind, labels?)`, `fundKindBadge(kind)`, `fundExplainer(kind)` ("Public Funds is the Lions International Activities account: money raised from the public, held for charitable use." for `activity`, `null` otherwise).
- `ledger-fund-labels-queries.ts`: `getFundLabels()`, one `select kind, name, is_active from ledger_funds`, wrapped in React `cache()`. Callers: the Treasury guide page and the Settings page (the two pages with no fund rows in hand); everything else builds labels from the funds it already loaded with `buildFundLabels()`.
- `ledger-category-mirror.ts` (pure carrier): `MirrorCheckCode`, `checkCategoryMirror(subject, target | null)`, `mirroredFlagEditBlocked(...)`, `MirrorHint` (`{ state: 'not_applicable' } | { state: 'stays'; reason: 'no_mirror' | 'mirror_inactive' } | { state: 'bound'; foundationCategoryName; receipt: 'may_be_needed' | 'not_needed' }`), `describeMirrorHint(category, mirror | null)`, and the exhaustive `MIRROR_COPY` record (a new state or code is a compile error).
- `ledger-donor-giving.ts`: `sumDeductibleGiving(rows)`.
- `ledger.ts` gains `ACK_MIN_CENTS = 25000` (the literal in `listPendingAcknowledgments()` becomes the constant; the hint is the second reader).

**New components (`src/components/admin/ledger/`, flat):** `category-mirror-dialog.tsx` (pick an active Foundation income category or "None, stays in Public Funds"; one `ledger.manage` PATCH), `donor-search-panel.tsx` (search plus "Create new donor" with `DonorForm`, extracted from `link-donor-dialog.tsx`; `onSelect(donor)`), `donor-picker-field.tsx` (chosen-donor chip, "Choose donor", "Clear"; opens the panel in a `Dialog`), `foundation-bound-hint.tsx` (renders a `MirrorHint`).

**Files modified:**
- Pure and server: `ledger-transfer-policy.ts` (`FundRef.name?`, reasons from names), `ledger-fund-move-policy.ts` (same), `ledger-correction.ts` (constants to functions of `FundLabels`; `buildMoveWarnings` takes `labels`), `ledger.ts` (`GuardrailsInput.fundLabels?`, the firewall flag text), `ledger-fund-move-queries.ts` and `transaction-move-eligibility.ts` (pass `name` into `FundRef`; labels into `buildMoveWarnings`), `ledger-queries.ts` (`donorExists`, `getDonor` flag, the `guardrails()` callers pass labels, `ACK_MIN_CENTS`), `ledger-category-queries.ts` (`toCategoryDTO`, `updateCategory`, `getCategoryImpact`, `mergeCategories`), `ledger-category-ui.ts` (`AdminCategoryRow.mirrorsCategoryId`, a `mirrorsOf` helper), `db/schema.ts`.
- Routes: `categories/route.ts`, `categories/[id]/route.ts`, `categories/[id]/impact/route.ts` (via the query), `categories/merge/route.ts`, `transactions/route.ts` (`donorId`), `transactions/[id]/route.ts` (the donor existence check onto `donorExists`).
- UI: `transaction-form.tsx` (donor picker on create for Public Funds and Foundation income, the hint, label-built strings at lines 375, 598, 1094), `transaction-form-dialog.tsx` (pass `mirrorHints`), `txn-donor-actions.tsx` (`mode: 'foundation' | 'public'`; `public` renders Link donor only, never Acknowledge, Mark Sent or the sent chip), `link-donor-dialog.tsx` (onto `DonorSearchPanel`), `[fundSlug]/page.tsx` (subtitle from `fundExplainer`, `TxnDonorActions` on Public Funds income rows, `mirrorHints` computed on the server from the categories and `crossEntityContext`), `donor-detail-client.tsx` and `donors/[id]/page.tsx` (`sumDeductibleGiving`, the "Public Funds, not yet a Foundation gift" label), `category-list.tsx` and `category-flags-dialog.tsx` (counterpart line, read-only flags with the Foundation's values and an informational "The Foundation reports this under: …" line, a "Counterpart of: …" chip on Foundation rows), `category-deactivate-confirm.tsx` (the `mirroredBy` warning), `category-merge-dialog.tsx` (`mirror_conflict`, `mirrorsRepointed`), `ledger-entity-detail.tsx`, `reports/page.tsx` and `pay-reimbursement-dialog.tsx` (`fundKindBadge`), `ledger-settings-form.tsx` and `settings/page.tsx` (the fund name prop), the five guide sections and `guide/page.tsx` (`labels` prop; the two module-level guardrail strings become `getGuardrailRows(labels)`), `approval-dialog-context.tsx` and `ledger-approval.ts` (comment text only).
- Migration: `0044_ledger_books.sql` (seed literal).

### Increment 2a (contract level)

New: `ledger-sweep.ts`, `ledger-sweep-link.ts` (SQL fragments only: `sweepCopyPredicate`, `notSweepCopy`, `sweptSourceExists`, `sweepLegExists`, `sweptSourceHasSentReceipt`), `ledger-sweep-batch.ts` (`evaluateSweepBatch(executor, input, ctx)` as the one evaluator for preview and execute, `createSweepBatch`, `voidSweepBatch`, `listSweepCandidates`, closeout read and write), `ledger-approval-notify.ts` (`notifyPendingApprovers`), the five route files.

**`classifyDecisionGroup` break-site list** (every place that assumes a group is exactly two legs, with the change):
1. `ledger-approval-decision.ts:173` count check becomes `classifyDecisionGroup()`; `:236-248` the single UPDATE becomes the two pinned UPDATEs (leg, copies) with the same sentinel; target-is-a-copy is a fault.
2. `ledger-cosign.ts:102` the same count check.
3. `ledger-board-decision.ts:60-80` `lockDecisionPair` becomes `lockDecisionGroup` (all callers).
4. `ledger-queries.ts:3641-3745` `getPendingApprovals()`: exclude copies (`notSweepCopy`), derive partner fund, entity and count from the copies for a batch leg.
5. `ledger-approval-queries.ts:106` (the `dest` join), `:244` (`partnerEntityId`), `:245` (`viewerRecorded`): add the copy-based branches.
6. `ledger-approval.ts` `describeApprovalFund` and `ApprovalKind`: a batch is a `sweep` with a count; `buildPendingApprovalEmailHtml` takes `batch?: { count }` and passes `party: null, memo: null` (no donor name or free text reaches the board list).
7. `transactions/[id]/route.ts:394/398` (bank account immutability), `:627-666` (the `?both=true` branch), `:840-844` (the DELETE group lock): the new sweep guard runs before the transfer branch, so none is reached for a leg.
8. `transactions/[id]/split/route.ts:153` the `transferGroupId` guard also refuses `swept_copy` and `swept_source`.
9. `transaction-actions.tsx:93` `isTransfer`; `transaction-form.tsx:158/167` and `transaction-form-dialog.tsx:106` (`isEditingTransfer`): a sweep leg never opens the edit form (the lock label shows instead).
10. `ledger-transaction-lock.ts`: `TransactionLockKind`, `LockableRow`, `transactionLockKinds`, `editLockKind`, `editLockDisplayKind`, `moveBlockKind`, and the exhaustive `LOCK_COPY` (a new kind is a compile error, by design).
11. `[fundSlug]/page.tsx:209-232` and `:472-480` (partner map by group id): a leg has no income partner; the register must not crash and shows a plain leg row until 2b.
12. `ledger-queries.ts:3150-3160` (the firewall counter): a one-row group has one fund kind, so it is not counted; pinned by a test. `ledger.ts:381-418` (`isGiving`) and `impact-stats-queries.ts:50` need no change; pinned by tests.
13. `ledger-reimbursement-correction.ts:269-278` and `ledger-duplicate-candidates.ts:87` read `transfer_group_id` and are unaffected; confirmed in Phase 4.
14. `recent-corrections.tsx` and `ledger-audit.ts`: the new `sweep_batch_voided` kind in `CORRECTION_AUDIT_ACTIONS`; the reader's exhaustive `KIND_BADGE` record fails to compile until it is handled.
15. Every enumerated `ledgerTransactions` projection typed as `LedgerTransaction` (for example `getPendingApprovals`) gains the two columns; test fixtures gain `sweptFromTxnId: null, sweepLegTxnId: null`.

**Lock-kind additions and order.** `sweep_batch` (leg: `isSweepLeg` derived), `swept_copy` (`sweptFromTxnId` set), `swept_source` (`hasLiveCopy` derived), inserted after `dues_synced` and before `transfer_leg`; a rejected or pending row still reports its status kind first. `LockableRow` gains `sweptFromTxnId`, `sweepLegTxnId` and the two server-derived optional flags (supplied as `paidReimbursement` is today, through `ledger-sweep-link.ts`). PATCH on a `swept_copy` accepts a body whose keys are a subset of `{ donorId, memo }` and nothing else; the same function is the single allow-list (`sweepEditAllowance(kind, keys)`).

**Receipt-suppression predicate.** `sweptSourceHasSentReceipt(txn)` = `EXISTS (SELECT 1 FROM ledger_acknowledgments a WHERE a.donation_txn_id = <txn>.swept_from_txn_id AND a.sent_at IS NOT NULL)`. Two call sites: `listPendingAcknowledgments()` (`NOT …`, together with the B-194 `transfer_group_id IS NULL` filter) and `transactions/[id]/acknowledge/route.ts` (409 `receipt_already_sent`, naming the date). The acknowledgment is created at exactly one site (`acknowledge/route.ts:299`), so there is no third.

### Increment 2b (contract level)

Pages: `src/app/(dashboard)/admin/ledger/sweep/page.tsx` (builder; `auth()` plus `hasFeature(LEDGER_RECORD)` in its own body; loads `listSweepCandidates()`, bank accounts, tier, labels) and `…/sweep/[legId]/page.tsx` (read-only batch page with Void; may fold into a dialog). No nav entry; entry points are a "Sweep to the Foundation" button on the Public Funds register and the Approvals page. Components (flat, `sweep-` prefix): `sweep-batch-builder.tsx` (`'use client'`: selection, running total, typed bank amount, submit), `sweep-batch-review.tsx`, `sweep-void-dialog.tsx` (`<ConfirmDialog destructive>`, required reason, "do not type a family's name"), `sweep-closeout-dialog.tsx`, a batch row in the Approvals page (count, date span, per-category lines, expandable list for the approver; cards below `xl`, table at `xl+`, from the one shared actions block), pending-sweep and swept chips on the register rows, "Swept from Public Funds on <date>" on Foundation copies, "swept to the Foundation on <date>" on the donor page. **"Match this batch":** `CandidateTransactionRow` gains `sweepLegTxnId`; `reconciliation-match-picker.tsx` groups candidates by it, with a group header "Sweep of N gifts, $X, dated D" and a button that selects all N (client-only, the existing exact-sum match route commits it; a partially available group says "N of M available"). Expected under 100 lines; if it exceeds that it becomes a no-migration Inc 3. Retired: `?sweepFrom=` handling in `[fundSlug]/page.tsx`, `sweep-prefill-launcher.tsx`, `SweepPrefill` in the form, and the "Sweep to Foundation" flow mode in `transaction-form.tsx` (the "Record sweep now" link in `correction-dialog-logic.ts:107` re-aims at `/admin/ledger/sweep?sweep=<id>`). Treasury guide pages: batch sweeps, the closeout, void, and the FIFO wording.

## Implementation Order

### Increment 1 (specialist split; each step ends with `pnpm exec tsc --noEmit` and `pnpm test`)

1. **database-admin** (worktree + own Neon dev branch): `schema.ts` column and FK; migration `0115`; the `0044` literal; `ledger-category-mirror-schema.test.ts`; run the migration twice on the branch and record the row counts; run the S1 replay check (clear a mirror, replay the migration, confirm it stays null).
2. **api-developer** (same worktree): labels module and query; the pure policies and `ledger-correction.ts`/`ledger.ts` threading; the mirror carrier; category queries and the four category routes; `donorId` on create and `donorExists`; `getDonor` flag and `sumDeductibleGiving`; `ACK_MIN_CENTS`; all lib and route unit tests below.
3. **ux-developer**: every UI file in the modified list, the scan test last (it goes green only when every string is converted), the Treasury guide, the form hint and donor picker, the category screen.
4. **qa** (Phase 5): typecheck, unit tests, `pnpm build:only`, the e2e specs (the seven that read the fund's literal name now resolve it from the database), the live checks S1 and S2, a click-through on the Neon branch (Key a gift into Public Funds with a donor; set a counterpart; see the read-only flags; merge; the donor page total).
5. **Release notes** via `/release-notes` at ship (no version in this design). User's post-deploy step: rename the fund in the fund editor.

### Increment 2a

1. **database-admin**: `schema.ts`, migration `0116`, schema test; replay twice (S9).
2. **api-developer**: `ledger-sweep-link.ts`, the carrier, the lock kinds and every guard in the break-site list, `classifyDecisionGroup`/`lockDecisionGroup` and the decision and co-sign generalization, `evaluateSweepBatch` and create/void/candidates, the extracted notifier (both existing inline blocks in `transactions/route.ts` move onto it first, as a pure refactor with the existing tests green), `BOARD_MINUTE_MAX_LEN` consolidation, the five routes, the B-194 and receipt-suppression query changes, the `Transfer to Foundation` seed use on the leg.
3. **qa**: route-level and library tests, S3 to S10 on the branch (driven through the API; there is no builder yet).

### Increment 2b

1. **api-developer** (short): the `use_sweep_batch` refusal and the dead-code deletion in `handleTransfer`; the `?sweep=` parameter handling; `CandidateTransactionRow.sweepLegTxnId`.
2. **ux-developer**: pages, components, Approvals batch row, chips, "Match this batch", launcher retirement, Treasury guide.
3. **qa**: click-through including 360px, the Approvals page at `xl`, a spanning-two-years batch, void and every refusal, the full lump-path closure. Then Phase 6 (analyst) for B-172.

## Tests

Every unit test named here is written and passing by the named implementer before Phase 5.

### Increment 1

- **database-admin — `src/lib/ledger-category-mirror-schema.test.ts`:** adds the column with `ADD COLUMN IF NOT EXISTS`, nullable, no default; adds the FK only inside a `pg_constraint` guard; the FK is named `ledger_categories_mirror_fk`, is at most 63 characters, equals the `foreignKey` name in `schema.ts` and is `ON DELETE SET NULL`; the seed sits inside one `DO` block guarded by the audit-marker `NOT EXISTS` and inserts the marker in that block; the seed pair list is exactly `Public donations` and `White Cane`; no contested name appears; the migration does not mention `Transfer to Foundation` or an email address; the `0044` activity seed literal is `'Public Funds'` and still guarded by `NOT EXISTS`.
- **api-developer:**
  - `src/lib/ledger-fund-labels.test.ts`: defaults; stored names win; a deactivated fund loses to an active one of the same kind; unknown kinds fall back; `fundKindBadge`; `DEFAULT_FUND_LABELS` contains no "Activity".
  - `ledger-transfer-policy.test.ts` and `ledger-fund-move-policy.test.ts` (extended): every Activity-bearing reason uses `FundRef.name` when given and the default otherwise; **the mutual-exclusion test and every existing direction assertion unchanged and green.**
  - `ledger-correction.test.ts` (extended): the label functions and `buildMoveWarnings` with a custom `activity` name never print "Activity".
  - `ledger.test.ts` (extended): the firewall flag detail reads the supplied labels.
  - `src/lib/ledger-category-mirror.test.ts`: the `checkCategoryMirror` matrix (Club activity income subject is valid; Club activity expense, Club administrative income and a Foundation category as subject are not; target Foundation charitable income active is valid; inactive, expense, scholarship, a Club category and itself are not; null clears), `mirroredFlagEditBlocked` (stored mirror blocks; same-request clear allows; unchanged value allows), every `describeMirrorHint` state, and that `MIRROR_COPY` covers every code.
  - `ledger-category-queries.test.ts` (extended): `updateCategory` sets and clears the mirror and writes `category_mirror_changed` with ids only; a no-op writes nothing; the audit precedence order; the DTO carries the field; `getCategoryImpact` returns `mirror` and `mirroredBy`; `mergeCategories` re-points mirrors on confirm, reports `mirrorsRepointed` in the plan, and refuses `mirror_conflict`.
  - `categories/route.test.ts` and `categories/[id]/route.test.ts` (extended): `mirrorsCategoryId` is 403 without `ledger.manage`; each 400 code; 404 for an unknown target; `mirrored_flag_read_only`; POST stores a valid mirror.
  - `transactions/route.test.ts` (extended): `donorId` accepted on Public Funds and Foundation income; 404 `donor_not_found`; 400 `donor_not_applicable` for an expense and for an administrative fund; omitted or null unchanged.
  - `ledger-queries.donors.test.ts` (extended): `getDonor` rows carry `entityDonationsDeductible`. `ledger-donor-giving.test.ts`: `sumDeductibleGiving` ignores non-deductible rows.
  - `ledger-queries.test.ts` (extended): `listPendingAcknowledgments` uses `ACK_MIN_CENTS`.
  - `default-role-bundles.test.ts`: run, not edited.
- **ux-developer:**
  - `src/lib/fund-name-literal-scan.test.ts`: no capital-A `Activity` and no `activity fund(s)` in string literals or JSX text across `src/lib/ledger*`, `src/lib/financial-report*`, `src/components/admin/ledger`, `src/app/(dashboard)/admin/ledger`, `src/app/api/admin/ledger` (comments stripped, an explicit empty-by-default allowlist, test files exempt); the same case-insensitive `activity fund` check on `src/app/members` and `src/components/members`; **a negative control** proving each regex catches a literal in a template string and in JSX text; and the register page source does not contain `{fund.kind} fund`.
  - `foundation-bound-hint.test.tsx` (every state), `donor-picker-field.test.tsx` (chosen, empty, cleared), `txn-donor-actions.test.tsx` (extended: `mode="public"` shows Link donor and never Acknowledge, Mark Sent or "Ack sent"), `ledger-category-ui.test.ts` (extended: `mirrorsOf`), `treasury-guide-labels.test.tsx` (each of the five sections renders a custom `labels.activity` and contains no "Activity").
- **qa (Phase 5, e2e):** `ledger-category-mirror.spec.ts` (set a counterpart, see the chip and the read-only flags, clear it); a donor pick on create; the seven specs that read "Activity Fund" resolve the name from the database via one helper.

### Increment 2a (named so the work-log can open at Phase 4)

Batch claim race (partial unique index, typed 409 naming the rows); total mismatch refused; `classifyDecisionGroup` matrix (single, pair, batch of 1, batch of N, fault, copy as target); reject frees the sources, approve frees none; approve stamps the leg but not the copies' `approved_at`, writes the final minute to the copies, and a donor edit on an approved batch's copy still succeeds; the lock matrix for `sweep_batch`/`swept_copy`/`swept_source` across PATCH, DELETE, split and move with the donor-and-memo allowance on a copy; `checkFundMove` mutual-exclusion unchanged, plus `moveBlockKind(swept_copy)` refusing the Foundation-to-Public-Funds cell; `sweepCopyPeriodVerdict` matrix (current year, prior year, filed year, sent month, gift after sweep); a batch spanning two fiscal years posts one leg and N copies each in its own year; preview/execute parity for every refusal code; `sweptSourceHasSentReceipt` used by both the worklist and the acknowledge route; `notSweepCopy` single-spelling scan; constraint-name length and parity; `getPendingApprovals` returns one row per pending batch and no copies; a posted batch leaves giving, the Club's 990 prep and the firewall count unchanged and adds the copies to the Foundation's; void refusals (each `SweepVoidBlock`); a source with a rejected copy answers `sweep_history`; the closeout refuses a swept row; category-without-mirror refusal; the email carries a count and no party or memo; `role-bundle` test unaffected.

### Increment 2b

Preview/builder state tests, `use_sweep_batch` on the lump mode and unchanged same-fund Transfer, `?sweep=` validation, the launcher's removal (source scan), the match-picker grouping and partial group, the Approvals batch row at card and table widths, void and closeout dialog states.

## Edge Cases & Risks

### Increment 1

- **Rename window.** Between deploy and the user's edit in the fund editor, the stored name is still "Activity Fund" and every string reads it; nothing is hard-coded "Public Funds" except the fallback default. Fresh installs and any dev database re-seeded from `0044` get "Public Funds", which is why the seven e2e specs stop reading a literal.
- **Seed replay.** The marker row makes the seed one-shot. A Club category that does not exist (no `White Cane` on Public Funds yet) leaves its pair unlinked and the marker is still written, so a category created later is linked by the treasurer. Two Foundation categories of the same lower-cased name: the lowest `sort_order` wins; documented in the migration comment.
- **Mirror and flags.** A mirrored Public Funds category keeps whatever `counts_as_giving`/`ack_not_required` it already stored; the screen shows the Foundation's values and the Foundation category is the only source of truth for a copy. The Foundation's White Cane category has no 990 line (V5), so its copies will report without a line until the treasurer sets one; the category screen shows "No Form 990 line" on the counterpart line.
- **Counterpart lifecycle.** Deactivating a Foundation category with live mirrors is allowed with a warning; the affected gifts become unsweepable in 2a. Merge only runs on a category with no transactions (existing rule), so a mirror target with history cannot be merged away; a zero-history target is re-pointed.
- **Donor on a Public Funds row.** The acknowledge route already refuses a non-deductible entity, so the register hides Acknowledge there. A donor deleted between pick and save answers 404 `donor_not_found` and the form keeps the other fields. Donor links on Public Funds rows are plain data until Inc 2 freezes the source after a sweep.
- **Unlinked-gifts worklist** lists deductible entities only, so unlinked Public Funds gifts do not appear there; the Foundation would inherit blank donors from an unlinked source. 2b adds the "N gifts have no donor record" nudge in the builder.
- **Donor page.** After Inc 1 a donor with only Public Funds gifts shows a total of $0.00 and a labelled list; that is the designed reading, and the test pins it.
- **Member pages** never print the Public Funds name (`MEMBER_EXPOSED_FUND_KINDS` omits it); the scan covers `src/app/members` anyway.
- **Mobile and brand.** The picker dialog is a `Dialog` at `max-w-lg` with 44px rows; cards `rounded-2xl`, buttons `rounded-lg`, no native dialogs.
- **Risk: a missed string.** The scan test is the guard; the S2 live check is the proof against rendered pages.

### Increments 2a and 2b (risks the work-logs inherit)

- **Aged-funds on the Foundation after back-dated copies** (S7): the aged-public-fund fact reads trailing-window income by `txn_date` (`ledger-queries.ts:3197-3231`), and the lump was dated at the sweep. A batch of old gifts adds balance with little window income to the Foundation Charitable fund. Believed to fire the Foundation's warning sooner; unmeasured; it is a warning, not a block, and arguably right (the money is as old as the gift). Goes to the user as a heads-up.
- **Statement restatement** (S10): a copy dated in a month whose Foundation statement was sent restates it; warned and audited, not refused (DECISION-114).
- **`drizzle-kit push` drift on the partial unique index** (S6): if push proposes to recreate it, rewrite the predicate in the form drizzle emits; do not accept an unreviewed recreate on a money invariant.
- **Void and the Club's reconciliation:** voiding deletes the leg; the void route refuses a reconciled or matched leg or copy, so no closed session ever loses a row.
- **A rejected batch's clutter** (ruling 5) and the `sweep_history` delete refusal.
- **FIFO wording.** The aged-funds readout ages the money oldest-first (DECISION-105, FIFO confirmed 2026-10-02) while the builder lists gifts, so a gift can look unswept while FIFO says its dollars were consumed. Keep FIFO; the builder's explanatory line says so.
- **Production data:** three unswept-looking prior-year gifts and one lump (V2, V3, V7). The closeout is the only tool; no agent writes production (Workflow Rule 10).

## Phase 5 live checks (record the observed rate; none has been run)

| Id | Increment | Check | Records |
|---|---|---|---|
| S1 | 1 | Clear a seeded mirror through the API, replay the migration, read the column | stays null, n/n over 3 replays. **Observed 2026-10-17: 3/3 replays stayed null (both seeded links cleared by API), marker stayed at 1 row.** |
| S2 | 1 | Rename the dev fund via the fund editor; load register, approvals, move dialog, categories, reports, entity detail, guide | rendered "Activity" count (expect 0). **Observed 2026-10-17: 2** (Budgeting overview and drill-down kind badge, `budget-plan-status.tsx:29`); 20 pages loaded, every other page 0. Returned to ux-developer. **Observed after fix (qa re-verify, 2026-10-17):** fund renamed "Activity Fund" to "Community Money" through the Edit fund dialog, then back to "Activity Fund" (confirmed). `/admin/ledger/budgeting` rendered "Activity" **0** times (kind badges `Administrative`, `Public`); `/admin/ledger/budgeting/activity` **0** (badge `Public`). The other 18 pages were not reloaded (no change to them); they stand from the first run. |
| S3 | 2a | Overlapping batch POSTs on one source | n/n one 201 plus one 409 `rows_claimed`, 10 passes. **Observed 2026-10-19 (qa, over HTTP on the branch):** 19/20 same-source passes gave one 201 plus one 409 `rows_claimed` (the 20th was one 201 plus a 500 `CONNECTION_CLOSED` from the Neon pooler); the database held exactly one live copy per source in all 20; 6/6 partially overlapping passes gave 201 plus 409 naming the shared row only. No pass gave two 201s. |
| S4 | 2a | Approve vs reject on one pending batch | count of batches ending in mixed statuses, 20 passes (expect 0). **Observed 2026-10-19:** 20/20 passes one 200 plus one 409 `not_pending` (9 approvals won, 11 rejections); **mixed batches 0**; approved batches have `approved_at` on the leg only and the approver's minute on the copies, rejected ones `rejected_at` on every row. |
| S5 | 2a | Copy of an approved batch: PATCH amount, DELETE, move, donor PATCH | three refusals and one success. **Observed 2026-10-19:** posted and approved batches alike: copy amount/date/category/party PATCH, DELETE, move to the Club fund, split all 403 `swept_copy`; leg PATCH/DELETE/split 403 `sweep_batch`; source PATCH/DELETE/split 403 `swept_source`; donor and memo PATCH on a copy 200. After a reject, deleting a source is 409 `sweep_history`. |
| S6 | 2a | `drizzle-kit push` on the branch | diff or no diff for the index, FKs and table. **Observed 2026-10-19:** two pushes (267 then 26 statements, B-165 drift only); **no statement names `ux_ledger_txn_swept_from_live`, `ix_ledger_txn_sweep_leg`, the two FKs or `ledger_sweep_closeouts`**; `pg_dump` shows no sweep line changed. Separate, outside 2a: the push also dropped ten migration-only indexes the schema does not declare (see the 2a work-log, O7). |
| S7 | 2a | Foundation aged-funds state before and after a batch of old gifts | the observed state. **Measured early 2026-10-17 (back-dated income, no sweep batch yet):** no warning before or after $3,000 of 2025 gifts; Foundation balance $26,336.57 vs trailing-year income $46,785.35, so aged = max(0, balance - window) = 0 and headroom about $20,448.78 on the branch data. Fires only when old gifts push the balance past trailing-year income. Production headroom not read. Re-run in 2a with real copies. **Observed 2026-10-19 (qa, real copies):** Foundation headroom (trailing-year income minus balance) $16,498.78, no flag. A $9,899.26 batch of 2025-09 gifts (prior-year: manage tier, typed reason, approved): balance up, window income unchanged, headroom $6,599.52, **no warning**. A further $8,099.52 batch (headroom + $1,500): **warning fires, "$1,500.00 of its $41,835.35 balance has been on hand more than 365 days"** (exact overshoot). Club Public Funds aged state $84.52 before and after each batch. |
| S8 | 2a | Giving total, Club 990 prep and Foundation 990 prep before and after a posted batch | three before/after pairs. **Observed 2026-10-19:** posted $70.01 batch: giving, Club 990 prep and firewall count (0) unchanged; Foundation gross receipts +$70.01 exactly (`Contributions/gifts/grants` +$40.01; **White Cane lands as `Unmapped / White Cane` +$30.00**). A pending $190.01 batch changed nothing; on approval Foundation gross +$190.01. |
| S9 | 2a | Replay `0116` | second run changes 0 rows. **Observed 2026-10-19:** five replays in all (three database-admin, two qa) plus one after the push: 313 transactions, 123 categories, 0 closeouts every time; the pre-existing `Transfer to Foundation` row was not re-touched. |
| S10 | 2a | Batch with a gift dated in a sent-statement month | month reads changed; nothing refused. **Observed 2026-10-19:** preview `sentStatementMonths [{2026-08, addsCents 6201}]`, flag `statement_already_sent`, create 201 with the month in the `sweep_batch_created` note; the Foundation Aug statement's Twelve-Month column +$62.01, One-Month column unchanged ($0). |
| S11 | 2a | Re-point a mirror, then clear another, between preview and create | **Observed 2026-10-19:** re-pointed: the copy is filed under the **current** counterpart (`Memorials`), detail `byCategory` agrees; cleared: 409 `rows_refused` `no_mirror`, nothing written. Also `mirror_inactive`, `mirror_invalid`, `no_category`, and a Club category deactivated after keying stays sweepable (201). |
| S12 | 2a | Render with a pending and then an approved batch present | **Observed 2026-10-19:** both registers, Approvals (one row per batch, Recently decided lists it once), reconciliation, donors, Compliance, reports, budgeting, guide, search, settings: all 200, no error boundary; a void is listed once under each entity. Posted copies and legs are reconciliation candidates, pending ones are not. |
| S13 | 2a | Prior-year gift: no filing row, `in_progress`, `filed`; manage and record users | **Observed 2026-10-19:** (a) none and (b) `in_progress`: manage user 201 with a typed reason (400 `reason_required` without), record user 403 `manage_required`; (c) `filed`: both users 409 `period_filed`. A leg dated in FY2025 cannot be voided (`prior_fiscal_year`). |
| S14 | 2b | Treasurer flow end to end in the browser | **Observed 2026-10-19 (qa, :3106, branch):** 13 of 13 steps through the UI with no direct API call, as a `treasurer`-role user plus a `board_member` second approver: register button, select three gifts (two categories), review (pending line), Post (Post click to done panel 15.7 s), approver sees ONE batch row (count, total, both category lines, no party or memo), approves with the whole-batch wording, club register chips (leg "Sweep of 3 gifts...", source "Swept to the Foundation on D", Edit/Delete/Split/Move absent, a plain row keeps Edit), Foundation register 3 copy chips "Swept from Activity Fund on D" (the fund's stored name), Batch dialog on an approved batch offers no Void, an under-threshold batch posts at once and the manage user voids it from the dialog, a gift is marked as handled and unmarked. |
| S15 | 2b | Lump route refused, UI no longer offers it | **Observed 2026-10-19:** 5/5 `POST /transactions` with a sweep body answered 400 `use_sweep_batch`, `ledger_transactions` 313 before and after; same-fund Transfer 201 posted; the Record Transaction dialog lists no "Sweep to Foundation"; `/activity?entity=club&sweepFrom=<id>` is the plain register (200); a historical pair sweep seeded by SQL was approved by the second user (both legs posted). |
| S16 | 2b | Mobile 360 | **Observed 2026-10-19:** no horizontal page scroll on the builder list, review, post confirm, done panel, Approvals card, club register, batch dialog, void dialog, closeout dialog (scrollWidth 360/360 each). Batch, void and closeout dialogs: every control 44px or more, inside the viewport (void dialog scrolls inside, 838 over 702). Smallest targets below 44px: the shared admin chrome (sidebar toggles 36 to 40px), the back link and the builder's inline "Open Approvals" link (19px), the shared ConfirmDialog buttons (38px). None is a new control of this diff except the inline link. |
| S17 | 2b | Approvals at 1279 and 1280 | **Observed 2026-10-19:** 1280 table row visible and card hidden, Approve worked from the row; 1279 card visible and row hidden, Reject worked from the card. (First attempt hit a Neon `ECONNRESET` on an unrelated roles query; passed on rerun.) |
| S18 | 2b | Double submission | **Observed 2026-10-19:** 10/10 passes of two concurrent API creates gave one 201 plus one 409 and exactly one leg and two live copies; 10/10 page double clicks sent exactly 1 create request, produced exactly 1 batch and no failure text; 3/3 lost-response replays (server commits, browser connection reset) showed the neutral "most likely the one you just posted" panel, exactly one leg, and no retry button. |
| S19 | 2b | Pending create timing (16+ approvers on the branch) | **Observed 2026-10-19:** API Post-to-response 11.7, 12.1, 10.9 s; the browser Post click to done panel 15.7 s; no platform timeout (`maxDuration` 60). 2a O6 measured about 20 s on this branch earlier the same day. Production latency not measured. |
| S20 | 2b | Drift between review and Post | **Observed 2026-10-19:** 5/5 passes: counterpart re-pointed after the review, Post clicked, 0 rows written, "The list changed..." shown with the new category. Restored each pass. |
| S21 | 2b | Date rule | **Observed 2026-10-19:** tomorrow: 400 `future_date` from preview and create, 0 rows; input `max` = 2026-10-19; a past date after the gifts posts (leg dated as typed); a date before the gifts: 409 `gift_after_sweep`. Eastern boundary through the real parser at 00:00Z to 03:59Z Oct 20 (8 p.m. to 11:59 p.m. EDT): today is Oct 19, the UTC date Oct 20 is refused `future_date`; at 04:00Z today is Oct 20; the DST change (Nov 1 to 2) behaves the same. The live server clock cannot be moved, so the boundary is the parser, not a live server at 8 p.m. |
| S22 | 2b | INT4 overflow and the all-refused preview in the page | **Observed 2026-10-19:** two $20,000,000 gifts: the page shows "The total of the selected gifts is too large for one batch. Split it." and the Post button is present but disabled; the page still prints "over the approval threshold... goes to the board" (B2 prints the tier line when count > 0). An all-refused selection (claimed under the page) prints "This gift is already in a sweep batch." and none of the tier, needs-reason or pending/posted text. |
| S23 | 2b | PII boundary | **Observed 2026-10-19:** with gifts carrying a party, a memo and a donor record, none of the three strings appears in the detail JSON, the Approvals page text and HTML, or the batch dialog (0 of 3 strings in 4 places); the approver (no `ledger.record`) is redirected from `/admin/ledger/sweep` to `/admin/ledger`; a `ledger.view` + `ledger.record` user gets 403 on void and on closeouts and sees no Void button. 51 queued approver mails: all `blocked_non_production`, none carries a party or memo. |
| S24 | 2b | Match this batch | **Observed 2026-10-19:** whole batch: header "Sweep of 3 gifts, $69.03, gift dated Oct 18, 2026", button selects exactly the group, committed through the match route (3 matches, ids equal the group). Partial: one copy matched in another session, the picker lists "Sweep of 2 gifts, $60.03", the button selects those 2 and Match selected stays disabled (bank line $90.03). **Line count: picker +24, new file 48 = 72 (budget 100).** |
| S25 | 2b | Donor page and lump-era text | **Observed 2026-10-19:** before the sweep the row reads "Activity Fund, not yet a Foundation gift", total $0.00; after, source "Swept to the Foundation on October 19, 2026", copy "Swept from Activity Fund on October 19, 2026", TOTAL GIVING $30.00 (the copy counted once; the DONATIONS tile reads 2, one per row). "lump" appears 0 times on the category screen, the counterpart dialog, the deactivate dialog, the Record Transaction hint and 3 times in the guide, all unrelated ("Monday lump-payout reconciliation", "single lump sum", "lump-sum deposit"); "lump sweep" / "one lump amount" 0 everywhere. |

## Out of Scope

- Anything in the analyst's and architect's lists: refund of a swept gift (B-191), void of an approved batch (B-192), Zeffy import (B-120), batch auto-suggest (B-23), the mirror move (B-104/B-98), partial sweep of one row, a plug line, any change to slug or kind `activity`, a consolidated org-wide report (B-34(b) closes with the marker and the scan).
- Consolidating the nine dollars parsers (B-197), moving `findSentStatementMonth` (B-196, imported as is), and retro-itemizing the historical lump.
- Any `description` column on funds; any change to Move policy; any change to the Santa's Workshop pipeline.

## Draft release-notes entry (no version number; `/release-notes` assigns it at ship, Inc 1 only)

> **The Ledger: Public Funds, Foundation counterparts and donors on every gift.** Every ledger screen, message and the Treasury guide now uses the fund's name as set in the fund editor (rename the Activity Fund to "Public Funds" there). Each Public Funds income category can name its Foundation counterpart; the gift form tells you whether the gift is Foundation-bound and whether a receipt will be needed. You can now pick or create the donor while keying a gift into Public Funds or the Foundation. A donor's page totals only gifts to the Foundation.

## Goes back to the user

1. **Rename step after Inc 1 deploys:** open the fund editor and rename the Activity Fund to "Public Funds" (audited; no migration does it). Needed from you.
2. **Heads-up, no answer needed:** because the Foundation copy carries the gift date, a batch of old gifts can make the Foundation's aged-funds warning fire sooner (S7 will record it). The alternative is the sweep date, which you declined.
3. **Confirm or overturn (defaults applied):** prior-year gifts are sweepable by a manage-level user with a typed reason and refused once the Foundation's IRS filing for that year is marked filed; the three prior-year Public Funds gifts are marked "already handled" by the treasurer where the 2026-10-01 lump carried them.
4. **For the treasurer, before Inc 2:** the Foundation's White Cane category has no Form 990 line (production, 2026-10-16); copies would report without one until it is set.

## Handoff (standard template)

**Owner:** tech-lead  **Status:** complete  **Date:** 2026-10-17

### Summary
B-172 is designed as three increments: Inc 1 (rename through one labels module, category mirrors with a one-shot seed, donor on Public Funds income; one migration; ships alone), Inc 2a (batch core: two pointer columns, closeouts table, decision-group generalization, locks, void; one migration) and Inc 2b (UI and retirement of the lump path; no migration). No new key, dependency or directory.

### What I did
- Read the whole work-log and the code the architect's placement names, then verified the rename sites, the lock and decision code, the category, donor and form code, and found one new consequence (donor-page totals) and one new risk (Foundation aged-funds after back-dated copies).
- Designed Inc 1 in full and Inc 2a/2b at contract level; listed the break sites with line numbers and named every test.
- Filed DECISION-126 and DECISION-127 (Proposed) and backlog B-190 to B-197; created the three increment work-logs.

### Outputs
- `docs/work-log/2026-10-16-itemized-sweep-public-funds.md` (this section and the status table).
- `docs/decisions.md` (DECISION-126, DECISION-127; Status lines of DECISION-058, 116 and 117 now note the amendment).
- `docs/backlog.md` (B-190 to B-197, B-172 pointer).
- `docs/work-log/2026-10-17-itemized-sweep-inc1-rename-and-mirrors.md`, `...-inc2a-sweep-batch-core.md`, `...-inc2b-sweep-batch-ui.md`.

### Open questions / handoff notes
- **Inc 1 implementer: the specialist split, database-admin, then api-developer, then ux-developer** (not full-stack-developer). It is a schema column and seed, four category routes plus a create-route field, a labels module threaded through six pure and server files, and about twenty UI files with three new components; that is well over the ~150-line coupled-feature bar, and the api-developer → ux-developer boundary carries a real contract (the `MirrorHint` carrier, the DTO field, the `labels` prop).
- **Migrations:** Inc 1 (`0115`, placeholder) and Inc 2a (`0116`, placeholder) only. Both run Phase 4 and 5 in `isolation: "worktree"` with their own Neon dev branch and `.env.local` copy; branch ids go positionally to `neonctl connection-string` and the host is compared before any write. Inc 2a is cut from main after Inc 1 is merged (the batch needs `mirrors_category_id`). Inc 2b reuses 2a's worktree and branch (no migration). Re-derive migration numbers at Phase 4 start. Inc 1 ships alone; 2a and 2b should ship together (2a has no UI that reaches its routes, and the lump path stays open until 2b).
- Inc 2a and 2b open at Phase 4 after a short Phase 3 confirmation against the as-built Inc 1 and 2a.
- Not a durable-claim email path: the approval notice goes through `sendBulkMemberEmail()` via the extracted notifier; DECISION-102/103 helpers are not required.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Migration file: `drizzle/migrations/NNNN_*.sql` (idempotent)

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`pnpm exec tsc --noEmit`: PASS / FAIL

## Production Build

`pnpm build:only`: PASS / FAIL

## Dev-Server Smoke Test

`pnpm dev` against `.env.local` reaches the routes without runtime error: PASS / FAIL
Notes: [...]

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| [user flow] | [pass / fail] | [observation] |

## Regression Notes Added (bug fixes)

- [work-log entry name — guards against: brief description]

## Verdict

[PASS | FAIL]

---

# Phase 6 — Shipped vs Intent (analyst)

**Owner:** analyst  **Status:** complete  **Date:** 2026-10-19
**Scope:** the one B-172 Phase 6, across Inc 1 (v1.99.0, already live), Inc 2a (sweep batch core) and Inc 2b (builder, void and closeout UI, lump path retired). 2a and 2b ship together.

*Read-only review. I re-read my Phase 1, the architect's and tech-lead's rulings, the three increment work-logs and both qa reports, then read the shipped code in the worktree `/Users/cshenso/git/westervillelions/.claude/worktrees/itemized-sweep-inc2` (HEAD `18b730f`, uncommitted): the sweep page, builder, review panel, closeout dialog, donor page, `ledger-sweep.ts` copy, `listSweepCandidates`, `getDonor`, the Treasury guide section. No dev server was run, no production data was touched; production facts are quoted from the "Production facts" blocks above, not re-read. The qa live-check results (S1 to S25) are quoted as qa's, not re-measured by me.*

## VERDICT

**SHIP WITH NOTES.** The feature delivers what Phase 1 promised and the user's two answers (gift date on the copy; receipts sent from the portal) are honored end to end. I found no regression in money, receipts, permissions or the firewall. I found three things qa did not (N1 to N3 below), none of which moves money or breaks a flow; each becomes a tracked follow-up.

**One release gate that is not a note.** `/pre-push` must see these green on `:3000` before the push: `ledger-approvals-cosign.spec.ts` past L10 (38 tests did not run in 2b and 23 never ran green in 2a; the 2a pass 1 generalized `decideTransaction`, `cosignTransaction` and the lock helper, and 2b touched the approval dialogs, so this file is the one regression net for that code that nobody has seen pass), the two Google-button tests in `ledger-approvals-history.spec.ts` (they hard-code `:3000`, B-198), and the specs 2b qa did not run (`budgeting-restructure`, `budgeting-overview-restructure`, `budget-star-notes`, `admin-email-queue-access`). If cosign fails, it reopens at Phase 4 (api-developer pass 1), not here.

## ONE-LINE TAKE

> A treasurer can now select the Foundation-bound gifts in Public Funds, type what reached the bank, and post one batch that puts each gift on the Foundation's books under its counterpart category with its gift date and donor, while the Club books show one transfer; the lump path is closed, the books cannot double count, and the remaining rough edges are wording and a donor-page total, not money.

## What's Working

- **The double-count invariant held in three independent places.** The leg keeps a `transfer_group_id`, the copies carry none, and `notSweepCopy` is the only spelling (scan-tested). qa measured it live (S8): a posted batch left giving, the Club 990 prep and the firewall count unchanged and moved the Foundation's gross receipts by exactly the batch total; a pending batch changed nothing until approved. This was the single most likely way the feature could have shipped wrong (my Phase 1 structural choice) and it is the best-evidenced thing in the log.
- **One claim per gift, proved under load.** S3 (19/20 plus 6/6, the one miss a Neon pooler reset with exactly one live copy in the database), S18 (10/10 API races, 10/10 page double clicks sending one request, 3/3 lost-response replays showing the neutral panel with no retry button), S4 (20/20, zero mixed-status batches). The builder never tells a treasurer "failed" when the outcome is unknown.
- **The treasurer cannot be misled by the list.** One classifier (`classifySweepRow`) feeds the candidate list, the preview and the create, so the page cannot offer what the route would refuse; the review re-previews right before Post and writes nothing if anything she reviewed changed (S20, 5/5). A re-pointed or cleared counterpart is caught.
- **Receipts follow the issuer exactly as agreed.** A Foundation copy of $250 or more in a counterpart that is not ack-exempt joins the acknowledgments worklist; a gift whose original was already receipted is suppressed there and refused at the acknowledge route (409, with the date); transfer legs no longer pollute the worklist (B-194). Nothing sends a receipt on its own and the guide says "Emailed", never "Delivered".
- **Void and closeout are guided, not silent.** Every void block (nine) has a message and a next step, and qa drove all of them through the open dialog. The closeout needs a reason, is reversible, and the lump's carried gifts can be unmarked from the same page.
- **No new permission, no widened gate.** Every route and page has `auth()` then `hasFeature()` as its first statements, a non-holder gets the identical 403 for any batch id, the approver sees counts and category lines but no party, memo or donor (0 of 3 strings in four places, S23), and the record-only persona was exercised for real (prior-year held back, `manage_required` 403, no Void button).

## Intent-vs-Shipped Diff

Verdicts: matches | acceptable drift | regression.

| # | Phase 1 / the user said | Shipped | Verdict |
|---|---|---|---|
| 1 | The treasurer builds a batch from the unswept Foundation-bound gifts ("Zeffy gifts"). | `/admin/ledger/sweep` lists posted Public Funds income not swept, not closed out, in a category with an active counterpart. **The gifts must be hand-keyed**: nothing imports from Zeffy (B-120/B-179 unshipped). Phase 1 sequenced it this way on purpose (B-172 does not wait for B-120). | **matches** Phase 1; the title's word "Zeffy" is aspirational until B-120 (go-live item 1) |
| 2 | Total derived from the rows; the treasurer retypes the bank amount; equal to post; no tolerance, no plug; the difference stated in words. | Server recomputes from locked rows, `total_mismatch` 400, `describeBankDifference` under the field, Post disabled until equal, over-INT4 refused on preview and create (B1). | **matches** |
| 3 | Post at or under the threshold; over it, one board decision, one minute, count-only email. | Strict `>` threshold ($1,000 in production), one `decideTransaction()` write path, minute required on every batch, approvers emailed a count with no party or memo, recorder cannot decide, copies never carry `approved_at`. | **matches** |
| 4 | Each copy lands in the Foundation with donor, category, cause, memo, method and **the gift date** (user answer 1). | `buildSweepCopy` carries amount, party, memo, cause, method, donor and the gift date; the category is the counterpart's, read at create time (S11); not carried: check number, receipt key, public note, budget line, dues link, reconciliation fields. A batch can span fiscal years (S13, S21). | **matches** |
| 5 | Foundation rows marked swept, linked to source and batch, locked everywhere. | Two write-once pointers, restrict FKs, partial unique index over non-rejected copies, three lock kinds across PATCH, DELETE, split and move, chips on both registers, donor and memo still editable on a copy (S5, S14). | **matches** |
| 6 | One Foundation bank credit matched to the N rows as a group; a "Match this batch" shortcut. | **There is no Foundation credit row** (the N copies are the Foundation's side of the one bank line, DECISION-126 item 1); the picker groups by leg with "Sweep of N gifts, $X, gifts dated A to B" (not "dated D", because a copy carries its gift date) and selects exactly the group; partial groups are refused by the existing exact-sum gate (S24, 72 lines of the 100 budget). | **acceptable drift** (architect-approved; a credit row would have doubled the fund balance) |
| 7 | Receipts follow the Foundation copy and are sent from the portal; Zeffy's email does not replace them (user answer 2); no second receipt. | As described in What's Working. Seeded counterparts have `ack_not_required = false`. **The Treasury guide says a sent receipt is not repeated but never says that a copy of $250 or more joins the acknowledgments worklist afterwards** (the review row says it per gift). | **matches**; wording gap in go-live item 7 and N3 |
| 8 | The lump path retired; the launcher and `?sweepFrom=` folded in. | `handleTransfer` answers 400 `use_sweep_batch` before any check, deletes the sweep-only code (the `Public donations` fallback included), same-fund Transfer unchanged, `sweep-prefill-launcher.tsx` and `SweepPrefill` gone (source-scan pinned), `?sweepFrom=` is the plain register, "Record sweep now" re-aimed at `/admin/ledger/sweep?sweep=<id>`, and the 2026-10-01 pair stays decidable and co-signable (S15). Phase 1 Q5's remedy ("key an unitemizable amount as a gift first, even Anonymous") is **not written down anywhere the treasurer will read it**: not in the refusal copy, the empty state or the guide. | **matches**; the missing sentence is N3 |
| 9 | Fund displayed by its stored name everywhere. | Inc 1 plus N1/N2; the scan bans "Activity" and the literal "Public Funds" outside the labels module; the 2b chips and copy are functions of `FundLabels` ("Swept from Public Funds on ..."). | **matches** |
| 10 | The Activity fund carries the Foundation's charitable setup (backlog item (e)). | Narrowed in Phase 1 Q6 to counterparts: the Foundation category alone supplies the receipt flag, giving flag and 990 line; Club-side flags are read-only while a counterpart is set. In production 3 of 14 Club categories are active and mirrored. | **acceptable drift** (default adopted without objection; the cost is go-live items 2 and 3) |
| 11 | Start-date setting plus a legacy closeout screen (Flow 13). | Replaced by a per-row "Mark as already handled" (manage, reason, reversible, audited) on the builder page. Better fit for production's three gifts and one lump (V2, V7). | **acceptable drift** (improvement) |
| 12 | A "Stays in Public Funds" group, collapsed, for gifts with no counterpart (Flow 2, Pass 3 table 8). | One collapsed **"Held back (N)"** group that mixes gifts that are *broken* (no category, deactivated counterpart, filed year, manage required) with gifts that *stay by design* (no counterpart), under the sentence "Each one says what to fix" and the no-counterpart reason "Set one on the category screen first." The list is also the oldest 500 rows regardless of eligibility. | **acceptable drift today, regression risk as event money accumulates** (N1) |
| 13 | Void a posted, unapproved, unreconciled, unreceipted batch with a reason; an approved batch is not voidable in v1 (B-192). | As specified, plus `prior_fiscal_year` and `period_filed` blocks (ruling 7), `pending_use_reject`, `already_rejected`. Wording follows the batch's state (B3, O3 answered). | **matches** |
| 14 | A donor's history shows the gift once; totals do not double count. | Source and copy both appear, labelled; TOTAL GIVING counts the deductible-entity copy once (S25). **But `getDonor()` filters on donor and flow only, not status**: a pending batch's copies count in TOTAL GIVING and are labelled "Swept from Public Funds on D" as if posted (the label hard-codes `state: "posted"`), and a **rejected** batch's kept copies (ruling 5) stay in the history and count. Also the DONATIONS tile counts source and copy (qa observation 3). | **regression (minor, display only)** (N2) |
| 15 | Gap 4: swept rows locked in PATCH, DELETE, split and move; copy cannot move back to Public Funds. | `moveBlockKind` gains `swept_copy`; a test pins that no allowed move cell leaves `activity`; two policies stay unmerged. | **matches** |
| 16 | Gap 5 / B-194: transfer legs out of the pending-acknowledgments worklist. | Done with a test and live (a group-id Foundation row excluded, an identical plain row listed). Production victim count was 0 (V4). | **matches** |
| 17 | Gap 8: warn when a source is not yet matched to a deposit or the total exceeds the fund balance. | `not_matched_to_deposit`, `unmatched_sources` and `exceeds_fund_balance`, all warnings, none blocking. | **matches** |
| 18 | Gap 13: the Public Funds aged-funds warning clears per gift. | S7 read the Club fund as $84.52 before and after each batch (net zero after the test gifts were swept); the Foundation side was measured with a positive control (warning fires at the exact overshoot). I treat the Club side as satisfied by the FIFO design (DECISION-105) rather than proved gift by gift. | **matches** |
| 19 | Statement restatement is a warning, not a block (DECISION-114). | S10: the sent-statement month is listed with the dollar change, nothing refused, audit note records it. | **matches** |
| 20 | B-34(b): no consolidated income sum may include the copies. | The marker exists and a scan fails any other spelling; no consolidated report exists. | **matches** |
| 21 | Adversarial pass: redirect targets, state shortcuts, enumeration, bounds, self-targeting. | No `callbackUrl`/`next`; `?sweep=` is UUID-parsed, deduped, capped at 200 and silently dropped otherwise; identical 403 for any batch id; 200-row cap, reason and minute length limits, INT4 overflow, `future_date`; recorder cannot decide; `decide_the_batch` on a copy id (toast verified); a `manage` holder voiding their own batch is audited. | **matches** |
| 22 | Email through `sendBulkMemberEmail()`, not a durable-claim path, count only. | Extracted `notifyPendingApprovers()`, awaited and isolated with `console.error`. About 20 s on the 16-approver dev branch, 15.7 s page click to done; production unmeasured; `maxDuration = 60` and an honest "up to half a minute" line. | **matches**; latency is B-202 |

### How 2b answered the 2a observations

| 2a observation | Answer in 2b | Verdict |
|---|---|---|
| O1 preview `canPost` true above INT4 | B1: false, builder shows `total_too_large` (S22). The tier line still prints on that state (qa observation 2, B-205). | answered, one wording residue |
| O2 tier of an all-refused request | B2: tier, needs-reason and pending/posted lines print only when `count > 0` (S22). | answered |
| O3 one leg message for every state | B3: `sweepBatchNextStep(state)` used by routes, chip and dialog; verified in all four states. | answered |
| O4 empty PATCH on a copy is a 200 | Recorded, no action (harmless). | nothing |
| O5 future sweep date | B5: `future_date` refused by the shared parser, input `max`, Eastern boundary proved through the parser (S21). | answered; the live 8 p.m. boundary was not run, nothing more is needed |
| O6 slow pending create, double click | B6: ref lock, "Posting..." button, `maxDuration = 60`, unknown outcomes re-previewed (S18, S19). | answered; production time unmeasured (checklist item 5) |
| O7 push dropped ten migration-only indexes on a dev branch | B-200 filed; production verified intact. | already filed |

## Edge Cases

- **Empty state:** pass. "No gifts are waiting to be swept. When a gift is recorded in Public Funds, it appears here." with the held-back and pending-batch lines beneath. (The sentence does not tell her that an unitemized amount must be keyed as a gift first; N3.)
- **Failure microcopy:** pass. Every row refusal, error code and void block has human copy from an exhaustive record; network failures say "Nothing was recorded; try again"; an unknown outcome is a neutral panel, never "failed"; a drifted review says "The list changed while you were reviewing." Two small wording weaknesses: `no_mirror` says "Set one on the category screen first" to a `ledger.record` user who cannot (the counterpart needs Manage Ledger), and `period_filed` states the problem without a next step. Both are inside N1.
- **Permission gate:** pass. Record, manage, approve and view were each exercised, including the record-only persona and the approver redirected from the builder. The treasurer role holds `ledger.record` and `ledger.manage` (migration 0110), so she can do prior-year batches, voids and closeouts; she is not an approver, so a batch over the threshold needs a Board member.
- **Mobile (360px):** pass. No horizontal scroll on nine surfaces, all three new dialogs at 44px or more. Under-44px controls that remain: the builder's inline "Open Approvals" link (19px, this diff) and the shared ConfirmDialog buttons (38px, shared component); both are in B-205.
- **Brand:** pass in what I read: `rounded-2xl` cards and details, `rounded-lg` buttons, `<ConfirmDialog>` for the post confirm and the unmark, no native dialogs, sticky total bar, `lions-blue` focus rings.

## The deferred items, decided

| Item | Decision |
|---|---|
| qa 2b obs 1: dead "Re-link donor" on a claimed source | **Already filed, B-204.** Server answers a clear 403; a dead button, not a harm. |
| qa 2b obs 2: "goes to the board" printed on an over-limit preview | **Already filed, B-205.** |
| qa 2b obs 3: DONATIONS tile counts a swept gift twice, TOTAL GIVING once | **Already filed, B-204.** See N2: the larger donor-page issue is status, not the tile. |
| qa 2b obs 4 / S16: small tap targets | **Already filed, B-205** (the builder link and the shared ConfirmDialog). The register's 44 sub-44px controls and the sidebar chrome are pre-existing: **nothing**. |
| e2e specs deferred to pre-push | **A gate, not a note** (see Verdict). Add to B-198 qa's line: `ledger-approvals-cosign` L10 sets its own 120 s `test.setTimeout`, so a CLI `--timeout` does not help (proposed text below; qa proposed it and B-198 does not carry it yet). |
| Not verified: live 8 p.m. Eastern clock, S19 against production, the ack-letter template value after the acknowledgment spec | **Nothing.** The parser is proved at the boundary; production latency is measured by the first batch (checklist item 5); the template row is dev-branch residue. |
| B-199 open: 11 Club categories inactive | **Already filed, B-199**; it is go-live item 2. It does not block the first batch, which only needs the three active categories. |
| B-199 open: Foundation White Cane Form 990 line | **Already filed, B-199**; **time-sensitive** (the White Cane window runs to Oct 31, and S8 shows a White Cane copy lands as `Unmapped / White Cane` and sets `hasUnmapped` in the Foundation's 990 prep). Go-live item 3. |
| B-191 (refund of a swept gift), B-192 (void of an approved batch), B-193 (Club receipts line), B-201 to B-203 | **Already filed, deferred by design.** None is needed for the first batch. |

## Follow-Ups (SHIP WITH NOTES)

Each gets its own backlog entry; next free id is B-206 (the orchestrator files these after B-204 and B-205).

- **N1 — "Held back" mixes "fix this" with "stays by design", and its window is the oldest 500 rows.** Public Funds will always hold money the Club keeps (entry fees, sponsorships, meals, interest). Those rows have no counterpart, appear under "Held back" with "Each one says what to fix" and "Set one on the category screen first", and will accumulate. `listSweepCandidates` also reads the oldest 500 posted, unswept, un-closed-out income rows before classifying, so past 500 the newest eligible gifts would fall off the end with no notice. Small, ux-developer plus a SQL tweak, no schema.
- **N2 — The donor page counts pending and rejected sweep copies.** `getDonor()` has no status filter, so a pending batch's copies are in TOTAL GIVING before the board approves them, are labelled "Swept from Public Funds on D" (state hard-coded to posted), and a rejected batch's kept copies (ruling 5) stay in the history and in the total. Display only: acknowledgments, the worklists and every roll-up already require `posted` (the donor page's Acknowledge button is offered on any deductible row with no acknowledgment, so on a pending copy or a copy whose source was already receipted it is a button the route will refuse with a 409). Small; api-developer.
- **N3 — The Treasury guide and the builder never say three things the treasurer needs on day one:** (a) an amount with no gifts keyed cannot be swept, so key it as a gift first (Anonymous is fine); (b) after posting, copies of $250 or more are in the Acknowledgments worklist and the letters are sent from the portal; (c) when a prior-year gift has no Foundation filing record, the app treats that year as not filed (A9's accepted residual), so the review should say "no filing record for FY2025; confirm outside the app" next to the reason box. Copy only.

**Proposed backlog text (orchestrator files; analyst does not edit `docs/backlog.md`):**

- *B-206 — Sweep builder: separate "stays in Public Funds" from "held back"; do not let the oldest 500 rows hide newer gifts.* (added 2026-10-19 from the B-172 Phase 6, N1; priority: small, before event money starts being keyed in volume). Split `Held back` into **"Needs attention"** (refusals the treasurer can fix: `no_category`, `mirror_inactive`, `mirror_invalid`, `period_filed`, `manage_required`, `gift_after_sweep`) and a collapsed **"Stays in Public Funds"** (`no_mirror`, copy: "This gift's category has no Foundation counterpart, so it stays in Public Funds. Set one on Settings, Categories if it should go to the Foundation"), keeping Phase 1's wording. Classify in SQL or order eligible first so the 500 window cannot hide an eligible gift, and print a notice when the window truncates. Give `period_filed` a next step ("Mark it as already handled if the Foundation's books already carry it"). Tests: the held-back grouping in `sweep-builder-logic.test.ts`; a candidates test with 501 rows.
- *B-207 — Donor giving history counts posted rows only.* (added 2026-10-19 from the B-172 Phase 6, N2; priority: small). `getDonor()` returns every income row for the donor; filter totals on `status = 'posted'`, show pending rows labelled "Pending board approval" (and pass the batch state to `donorRowSweepLine` instead of hard-coding `posted`), and hide `rejected` copies. Hide Acknowledge on a non-posted copy and on a copy whose source was already receipted (the page offers it today; the route answers 409). Fix the DONATIONS tile in the same pass (B-204). Test: a donor with a posted, a pending and a rejected copy totals the posted one.
- *B-208 — Treasury guide and sweep review: first-batch notes.* (added 2026-10-19 from the B-172 Phase 6, N3; priority: small, copy only; the "First production batch" checklist below is the text). Add to `itemized-sweep-section.tsx`: key an unitemized amount as a gift first; copies of $250 or more join the Acknowledgments worklist and are sent from the portal; and in the review panel, when the sweep includes a prior fiscal year that has no `ledger_filings` row for the Foundation, say so next to the reason field.
- *Addendum to B-198:* `ledger-approvals-cosign.spec.ts` L10 sets its own 120 s `test.setTimeout`, so a run-time `--timeout` does not raise it; raise it in the file.

## Red Flags (if NEEDS REWORK)

None. Nothing returns to Phase 3 or 4 unless the cosign spec fails at pre-push.

## DECISION-126: ready to be marked Resolved

**Yes, at release, with the wording below applied by the tech-lead** (I do not edit `docs/decisions.md`). Every numbered item matches what shipped except the places named here:

1. **Status line.** "Increment 1 delivers only items 7 and 9" is stale; all ten items are delivered across 1, 2a and 2b. Replace with "Resolved (v1.NNN.0, 2026-10-NN; re-read against QA's Established list in the 2a and 2b work-logs; items 1, 3, 4, 5, 6 and 9 as amended below)".
2. **Item 4.** Add "On a copy the server allows the donor link and the memo; 2b exposes only the donor link (B-201)."
3. **Item 9.** The void refusal list reads "approved, reconciled, matched or receipted". Shipped: also a pending batch (`pending_use_reject`), an already-rejected batch, a leg dated in a prior fiscal year (`prior_fiscal_year`) and a gift in a year the Foundation's IRS filing marks filed (`period_filed`), per ruling 7 and A7. Change "once the batch UI exists" to "closed in v1.NNN.0".
4. **Item 10.** Add "A rejected copy stays in the Foundation register and in a donor's history; consumers that show history must filter on status (B-207)". State plainly that this is the residual cost of keeping rejected rows.
5. **"Unmeasured" list.** Rename it "Measured" and replace each "believed, unmeasured" with the observed rate: S3 19/20 plus 6/6 (the miss a pooler reset, one live copy in the database); S4 20/20, mixed 0; S5 the three refusals and one success on posted, approved and rejected batches; S6 no statement names the index, FKs or table; S7 no warning under the headroom, warning at the exact $1,500 overshoot; S8 giving, Club 990 and firewall unchanged, Foundation gross receipts exact; S10 the month listed, nothing refused; S11 filed under the current counterpart, a cleared one 409; S13 allow with a reason when no filing row or `in_progress`, 409 `period_filed` when `filed`; S18 10/10, 10/10, 3/3; S20 5/5. Keep two as still unmeasured: **S19 in production** (15.7 s on a 16-approver dev branch) and the **live 8 p.m. Eastern boundary** (proved through the parser only).
6. **Impact.** Follow-ups line becomes "B-190 to B-208" (B-190 and B-194 rode inside Increment 2).
7. **Item 5 wording is still exact** (cap 200, INT4, destination resolved from the database); **item 3** (`decide_the_batch` 400, co-sign 409 `not_board_decision`) and **item 1** (leg category `Transfer to Foundation`, inactive, null fallback) are accurate as written.

## First production batch (checklist the release notes can carry)

Written for the treasurer. Production facts it rests on: the fund is named Public Funds; `Public donations`, `White Cane` and `Zeffy Donations` are the only active Club categories and each has a Foundation counterpart (`Zeffy Donations` points at the Foundation's `Public donations`); the other 11 Club categories are inactive; the Club `Transfer to Foundation` category exists, is inactive, and holds nothing; the board-approval threshold is $1,000; there are three unswept 2025 gifts totalling $138.50 and one 2026-10-01 single-amount sweep; the Foundation's filing tracker holds FY2026 rows only.

1. **Key the gifts first.** Nothing imports from Zeffy yet. The sweep list shows only gifts you have recorded in Public Funds under a category that has a Foundation counterpart. Record each gift with its donor (otherwise the Foundation's donor history will not show it). If you have only a total, record it as a gift (Anonymous is fine) and sweep that; the old single-amount sweep is gone.
2. **Check each category you will use.** `Zeffy Donations`, `Public donations` and `White Cane` are ready. For `Rudolph Run`, `Pancake Breakfast`, `Sponsorships` and `Interest`, either set a Foundation counterpart (Settings, Categories) or leave them: money in a category with no counterpart stays in Public Funds and will sit under "Held back" by design. Reactivate an inactive category only if you will key gifts into it. Never point a counterpart at the Foundation's `Transfer from Club` (it is marked "no receipt needed"), and leave `Transfer to Foundation` inactive; the sweep uses it by itself.
3. **Set the Foundation's `White Cane` Form 990 line before sweeping any White Cane gift.** The campaign runs to October 31. Without a line the copies report as "Unmapped / White Cane" in the Foundation's 990 preparation.
4. **Decide the three 2025 gifts ($138.50) before the first batch.** Two are `Public donations`; one is `Pancake Breakfast`, which has no counterpart and will be held back. If the October 1 sweep already carried a gift, mark it **already handled** (Manage Ledger, with a reason) so it is never swept twice. Anything you do sweep is a prior-year batch: it needs Manage Ledger and a typed reason, and the copies are dated January to March 2025 on the Foundation's books. The app cannot tell whether the Foundation's FY2025 return was filed (the tracker has no FY2025 row), so confirm that yourself first, and read any "a monthly statement was already sent" box in the review. The simplest first batch is a current-year gift; the 2025 gifts can wait.
5. **At the review.** Type the amount that actually moved at the bank; Post stays off until it equals the total and shows the difference. A board-minute reference is required on every sweep. A sweep of $1,000 or less posts at once; over $1,000 it goes to a Board member with Approve Ledger (not you) and posts when one approver agrees. Posting a sweep that goes to the board can take up to half a minute while the approvers are emailed.
6. **Know the undo window.** A sweep that posted at once can be voided by a Manage Ledger holder until a bank statement clears it, it is matched in reconciliation, or a receipt is sent for one of its gifts. Once the board approves a batch there is no undo in the app; you record a correcting entry on each book.
7. **After posting, send the receipts from the portal.** On the Foundation's books, each copy of $250 or more in a category that needs a receipt appears in Acknowledgments. Zeffy's own email does not replace the club's letter. A gift whose receipt was already sent is not queued again.
8. **At the bank.** When the transfer clears, match the Club's debit to the batch's transfer entry and, in the Foundation's reconciliation, use **Match this batch** on the single credit line.

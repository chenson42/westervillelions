# Itemized Sweep Increment 2b: Builder, Void and Closeout UI, Retirement of the Lump Path — Work Log

> **Slug:** `2026-10-17-itemized-sweep-inc2b-sweep-batch-ui`
> **Parent:** `docs/work-log/2026-10-16-itemized-sweep-public-funds.md` (B-172, Itemized sweep and Public Funds; Phases 1 to 3 live there)
> **Reserved IDs:** no migration; B-197 is consumed as a single shared `parseDollarsToCents` in `ledger.ts` (migrating the nine local copies stays B-197); B-200 is the orchestrator's (O7); proposed B-201 to B-203 are in the Phase 3 confirmation; next free id after those is B-204
> **Surface:** (dashboard) admin: The Ledger (`/admin/ledger/sweep`, register, Approvals, reconciliation picker, donor page, Treasury guide)
> **Permission(s):** no new `FEATURES` key (existing `ledger.record`, `ledger.manage`, `ledger.approve`, `ledger.view`)
> **Estimated complexity:** large
> **Pipeline mode:** Full, increment of a multi-increment feature. Phases 1 and 2 done in parent; Phase 3 designed in parent, Increment 2b (contract level; this work-log opens at Phase 4 after a short Phase 3 confirmation against the as-built Increment 2a)
> **Migration:** None
> **Phase 4/5 environment:** Same worktree and Neon dev branch as Increment 2a (no new migration).
> **Depends on:** Increment 2a built and verified.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | READY WITH NOTES | 2026-10-16 |
| 2 — Architectural review | architect | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md) | Approved with suggestions | 2026-10-17 |
| 3 — Technical design | tech-lead | Done in parent (see 2026-10-16-itemized-sweep-public-funds.md, "Phase 3 — Technical Design", Increment 2b) and confirmed against the as-built Increment 2a below ("Phase 3 — Confirmation", rulings B1 to B19) | Design complete; confirmation complete | 2026-10-19 |
| 4 — Implementation | api-developer (one pass, P1 to P11, **first**) → ux-developer pass 1 (builder, closeout, lump UI retired) → ux-developer pass 2 (Approvals, register chips, void dialog, match picker, donor label, guide, sentences) → qa | api-developer pass DONE 2026-10-19 (P1 to P11, gates green; see "Phase 4 — api-developer pass (server)"); ux-developer pass 1 DONE 2026-10-19 (see "Phase 4 — ux-developer pass 1"); ux-developer pass 2 DONE 2026-10-19 (see "Phase 4 — ux-developer pass 2"); **Phase 4 complete, next: qa** | — | 2026-10-19 |
| 5 — Verification | qa | Done on what qa ran; some e2e specs deferred to the pre-push run (see Phase 5) | **PASS** (no defect in the diff; deferrals listed, not counted as passes) | 2026-10-19 |
| 6 — Shipped vs intent | analyst | See parent: `2026-10-16-itemized-sweep-public-funds.md`, "Phase 6 — Shipped vs Intent" (one Phase 6 for B-172 across Inc 1, 2a and 2b, 2026-10-19) | **SHIP WITH NOTES** | 2026-10-19 |

---

# Phases 1 to 3

**Phase 1 (analyst):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 1 — Functional Refinement").
**Phase 2 (architect):** Done in parent (see `2026-10-16-itemized-sweep-public-funds.md`, "Phase 2 — Architectural Review").
**Phase 3 (tech-lead):** the design for this increment is in the parent's "Phase 3 — Technical Design", Increment 2b; read "Rulings that differ from Phase 1/2 (read first)" before anything else. DECISION-126 and DECISION-127 are in `docs/decisions.md` (Proposed; promoted at Phase 6).

## Scope of this increment

`use_sweep_batch` refusal and removal of the lump fallback in `handleTransfer`; `?sweep=<id>` handling; `CandidateTransactionRow.sweepLegTxnId`. Builder page, review step, void dialog, closeout dialog, Approvals batch row, pending-sweep and swept chips, "Match this batch" (under about 100 lines, else a no-migration Inc 3), donor-page "swept to the Foundation" label, retirement of `?sweepFrom=` and `sweep-prefill-launcher.tsx`, Treasury guide pages (batch sweeps, closeout, void, FIFO wording). 360px, `xl` table/card split, `rounded-2xl`/`rounded-lg`, `<ConfirmDialog>` only.

## Start-of-Phase-4 checklist

- **No migration in 2b** (confirmed 2026-10-19; the tail is `0116`, 2a's). Ignore the parent's `0115`/`0116` placeholders. If an implementer believes a column is missing, stop and route back to Phase 3.
- Read "Carry-forward to Increment 2b" (section 7) in the 2a work-log's "Phase 3 — Confirmation": the lump-era sentences to flip, the data fields the UI needs, and the register, Approvals and builder consumers of 2a.
- Expected to ship with 2a in one release. After QA PASS the analyst runs ONE Phase 6 for B-172 against the Phase 1 intent; B-172 is checked off in `docs/backlog.md` only then.
- Scratch space: `<scratchpad>/<pipeline-slug>/`; never kill or restart the `:3000` dev server (ask the orchestrator); no agent writes the production database (Workflow Rule 10).
- Keep every file free of personal data: category and fund names only, placeholder amounts, `example.invalid`.
- Record "Deviations from the design" at the end of Phase 4, routed by size per the scope-routing rule in CLAUDE.md.

---

# Phase 3 — Confirmation (tech-lead) — 2026-10-19

*Read-only on code; docs only. Read in the worktree `/Users/cshenso/git/westervillelions/.claude/worktrees/itemized-sweep-inc2` (branch `worktree-itemized-sweep-inc2`, base `18b730f`, everything uncommitted): the carrier `src/lib/ledger-sweep.ts`, `ledger-sweep-batch.ts` (evaluator, preview, create, detail, void, candidates, closeouts), `ledger-sweep-link.ts`, `ledger-sweep-gate.ts`, `ledger-transaction-lock.ts` (`sweepLockKind`, `sweepEditAllowance`, `sweepRefusal`), `ledger-approval.ts`/`ledger-approval-queries.ts`/`getPendingApprovals`, `getDonor`, `reconciliation-queries.ts`, `handleTransfer` and its tests, the Approvals page and its card/actions/dialog logic, the Public Funds register page, `transaction-actions.tsx`, `transaction-form.tsx` (sweep mode), `sweep-prefill-launcher.tsx`, `correction-dialog-logic.ts`, the match picker, the Treasury guide page, `ledger-sweep-consolidation.test.ts`, and the e2e specs that name a sweep. Also the parent's Phase 3, the 2a confirmation (A1 to A11, section 7), both api passes and the 2a Phase 5 report (O1 to O7). Migration tail is `0116` (2a's). Next free backlog id is **B-201** (B-200 is the orchestrator's, for O7). Line numbers are as of this read.*

**Verdict: the parent's 2b design holds. Nineteen rulings follow (B1 to B19). None returns to Phase 1 or 2. No new `FEATURES` key, no dependency, no directory outside the existing ledger trees, and no migration: every datum 2b needs is a column that already exists (`swept_from_txn_id`, `sweep_leg_txn_id`, `ledger_sweep_closeouts.{reason, closed_at, closed_by_user_id}`, the leg's `txn_date`) read by a new query, which I verified by reading `schema.ts` and `0116`. If a 2b implementer believes a column is missing, stop and route back; do not add one.**

## As-built facts the confirmation rests on

- 2a ships a library-only builder feed: `listSweepCandidates()` has **no route** (its type is `SweepCandidates`), so the builder page is a Server Component that calls it. `{ eligible, heldBack: { row, refusal }[], inPendingBatch }`; swept and closed-out gifts are excluded **in SQL**, so a closed-out gift is listed nowhere and cannot be unmarked from any screen (B10).
- `SweepBatchDetail` carries count, total, sweep date, minute, recorder, `byCategory`, `fiscalYears`, `approved`, `reconciled`. It has **no gift-level list and no gift-date span** (the parent assumed both).
- The carrier holds three copy records (row refusals, error codes, void blocks). It has **no copy** for `SweepRowFlag`, `SweepWarning`, `SweepCloseoutSkip`, the register chips or the batch states, and no `parseDollarsToCents` exists in `ledger.ts` (B-197 says the builder is the first user, so 2b creates it).
- Approvals shows a pending batch as one ordinary row (`PendingApprovalRow.batch.count`, `DecidedBase.batchCount`; fund label already reads "sweep"). `isDecideTheBatch` exists and no UI consumes it. The register renders a leg as "Transfer" (no income partner) and a copy as an ordinary Foundation income row.
- `handleTransfer` (`transactions/route.ts:428`) still builds the lump (leg `categoryId: null`, income leg `destCategoryId` or the `Public donations` fallback, `boardMinute` required for `requiresBoardMinute`) and awaits `notifyPendingApprovers`. It does **not clamp the date** (`parseDate` is shape-only). The 2a scan asserts the route text does not match `/ledger-sweep/`.
- The create route awaits the approver emails: about 20 s with 16 approvers on the dev branch (2a O6; each blocked row costs a queue insert). `maxDuration = 60` is the precedent on slow admin routes (`santas-workshop/.../purge`); the sweep routes set none.
- `consolidation.test.ts` pins exactly five importers of `ledger-sweep-batch` from `src/app`.

## 1. Rulings that differ from the parent's Phase 3 (read first)

| # | Parent / 2a text | Ruling | Reason, cost to reverse |
|---|---|---|---|
| **B1** (O1) | Preview contract: `canPost` false on a refusal, zero rows or a missing manage tier. | **`canPost` is also false when `totalCents > SWEEP_INT4_MAX`** (a one-line server fix in `evaluateSweepBatch`, **api-developer**), and the builder renders `SWEEP_ERROR_COPY.total_too_large` and offers no Post (ux). Both, because the preview must never say "go" to what the create refuses, whoever calls it (**S22**). | Contract made one-sided; create already answers 400 `total_too_large`. Reversal: delete the clause. |
| **B2** (O2) | `tier` / `needsReason` always printed. | **No server change.** The builder prints the tier, the needs-reason box and the pending/posted line **only when `count > 0`** (pure `sweepTierLine()` in `sweep-builder-logic.ts`), never for an all-refused preview. | The server's `tier` is read over accepted rows plus `manage_required` rows on purpose (a record-only caller must still SEE `manage`), and `createSweepBatch` gates on that same summary: changing it touches a permission invariant to fix a display. |
| **B3** (O3) | One `sweep_batch` message for every state of the leg. | **The message follows the batch's state.** `sweepRefusal(kind, action, batch?)` gains an optional third argument `{ status; approvedAt }` which the routes have already loaded at the three call sites (PATCH `route.ts:208`, DELETE `:846`, split `:108`) pass; for `sweep_batch` it uses the new carrier function `sweepBatchNextStep(state)` with `state: 'pending' \| 'posted' \| 'approved' \| 'rejected'` (approved: locked, record a correcting entry on each book; posted: void it, a manager; pending: reject it from Approvals; rejected: kept as a record). The register chip and the batch dialog use the same function. | The "void it before it is approved" sentence is wrong for an approved batch. Pure, under 30 lines, absorbed. |
| **B4** (O4) | n/a | **No action.** An empty-body PATCH on a copy is a 200 no-op; harmless, nothing is written. | Recorded so it is not re-found. |
| **B5** (O5) | Preview accepted any date. | **A sweep date after today (Eastern) is refused server-side**: new `SweepErrorCode` `future_date` (400, copy "A sweep is recorded after the money moves, so its date cannot be in the future."), checked in `parseSweepPreviewBody` by comparing the parsed date with the `defaultSweepDate` it is already given (the Eastern date), so preview and create refuse identically. The builder's date input gets `max` = today. The lump route never clamped, but the lump is closed by this increment, and a mistyped future date would post a leg that the registers and the Foundation's statements place in a period that has not started. Back-dating stays allowed (the transfer happened last Tuesday). Observed by **S21**. | One union member and one comparison. DECISION-126 item 6 gets a 2026-10-19 note (B19). |
| **B6** (O6) | Not addressed. | **Server: nothing moves except one line**: `export const maxDuration = 60;` on `sweep-batches/route.ts` (precedent above) so the platform does not cut a 20 s create after the commit. The notifier stays awaited and isolated (same as the Transfer path). **Builder: (1) a `useRef` submit lock** (state is too slow for a double click) plus a disabled "Posting…" button saying it can take up to half a minute while the board is told; **(2) a failure of unknown outcome is never a "failed" screen**: on a network error, a 5xx, or a 409 `rows_claimed` **after this page instance already sent a create**, the builder re-runs the preview for the same ids and, when they are all `already_swept`, shows the neutral panel "These gifts are already in a sweep batch, most likely the one you just posted. Check Approvals and the registers before trying again." with links, and no retry button (pure `interpretCreateFailure()`); **(3)** a `rows_claimed` with no earlier attempt from this page means someone else got there first: refresh the list. | The second request of a double click is refused with every row `already_swept` (correct) and must not read as a failure of the first. The 20 s itself is believed to be about five seconds in production (16 sequential Resend calls), unmeasured; **S18** records the double-submission outcome and **S19** the observed time on the branch; a latency fix is Proposed B-202. |
| **B7** | S11: "the builder should re-run the preview right before it posts". | **Post = preview again, then create only if nothing the treasurer reviewed changed.** The review keeps a `reviewSignature()` (ids, refusals, each row's Foundation category and receipt state, flags, total, count, status, tier, warnings) and `reviewDrifted(a, b)`; if the pre-post preview differs it writes nothing, replaces the review with the new one and says "The list changed while you were reviewing. Check it and post again." The server's current-mirror rule (S11) stays the authority. | A re-pointed or cleared counterpart silently changes a copy's category and receipt flag between review and post. Believed caught by the re-preview, unmeasured: **S20**. |
| **B8** | Approvals batch row: "count, date span, per-category lines, expandable list". | **No gift-level list.** The card and table row show the generated memo, count, total, sweep date, the gift-date span, fiscal years, per-category lines (`byCategory`), the recorder and the minute. `SweepBatchDetail` gains `earliestGiftDate` and `latestGiftDate` (api-developer, about 6 lines). The Approve and Reject dialogs say "This decides the whole batch of N gifts; individual gifts cannot be decided separately" (pure `describeBatchDecision(verb, count)` in `approval-dialog-logic.ts`) and `approvalFailureAction` consumes `isDecideTheBatch`. | The detail DTO is deliberately free of party, memo and donor because every approver reads it and the email carries a count only (2a A8); a gift list of date, amount and category identifies no one but is a second PII-shaped surface the 2a tests do not cover. An approver who wants lines reads the Foundation register. Reversal is proposed B-203. |
| **B9** | `…/sweep/[legId]/page.tsx` "may fold into a dialog"; entry points "the Public Funds register and the Approvals page". | **Folded: no `[legId]` page.** One `sweep-batch-dialog.tsx` (client, GETs the detail on open) hosts the summary and the Void action; it opens from the register chip on the leg and on a copy. Entry points: a "Sweep to the Foundation" button on the Public Funds register (Club entity, fund kind `activity`, `ledger.record`) and the Move dialog's "Record sweep now" link. **The Approvals entry is dropped**: an approver need not hold `ledger.record`, and Approvals is for deciding. | A page would duplicate the dialog's reads. No nav entry: `/admin/ledger/sweep` is believed to fall under the existing `/admin/ledger` area rule of the derived proxy gate (a prefix match, not read to the end), and the page's own gate, the narrower `ledger.record`, is the one that matters (CLAUDE.md, "the proxy is a coarse outer gate"). |
| **B10** | Closeout dialog. | **Unmark needs a list: api-developer adds `listSweepCloseouts(exec)`** (read-only, in `ledger-sweep-batch.ts`: source id, gift date, amount, party, category name, reason, `closedAt`, ordered newest first) because 2a excludes closed-out gifts from `listSweepCandidates` in SQL. Closeout actions live on the builder page for `ledger.manage` only: "Mark as already handled" on selected eligible or held-back gifts, and a collapsed "Marked as already handled (N)" section with Unmark. The carrier gains `SWEEP_CLOSEOUT_SKIP_COPY` (exhaustive over `SweepCloseoutSkip`). | Without it the 2026-10-01 lump's carried rows could be marked and never unmarked. The reason is admin-typed text on a `ledger.manage` page; the dialog says not to type a family's name. |
| **B11** | "register chips and row actions from `sweepLockKind`". | **One read feeds the chips: `listSweepBadges(exec, ids)` in `ledger-sweep-link.ts`** (two queries for any number of ids, not per row) returning `SweepRowBadge` (declared in the carrier): `{ kind: 'batch', legId, sweepDate, state, count } \| { kind: 'copy', legId, sweepDate, state } \| { kind: 'source', legId, sweepDate, state }`; a source whose only copies are rejected has **no** badge (freed). Chip text is a carrier function of `FundLabels` (`sweepChipLabel`): "Sweep of N gifts to the Foundation" (state-qualified: pending approval / approved), "Swept from {labels.activity} on D", "Swept to the Foundation on D". **For a leg, a copy and a claimed source, Edit, Delete, Split and Move are hidden, not disabled**, and a "Batch" button opens the dialog; a copy keeps `TxnDonorActions` (the donor link, the one edit the server allows besides memo). **Editing the memo of a copy is not built** (server allows it; Proposed B-201). `editLockKind` stays unchanged (2a A6; its pin test holds): the hiding is driven by the badge. | The chips must not run a query per row. Hiding avoids offering an Edit form whose every save is a 403. |
| **B12** | "Match this batch": header "dated D"; partial "N of M available". | **Group by `sweepLegTxnId`; header "Sweep of N gifts, $X, gifts dated A to B", all computed from the candidates the picker was given.** No "of M" (computing M needs another column; the picker's running-sum gate already refuses a partial group, and the rarity does not earn the column). The group button sets `selectedIds` to exactly that group's listed ids. The grouping is a pure function in a new file (`reconciliation-sweep-groups.ts`) so the picker's own diff stays small. **Budget: the picker diff plus the new file under 100 lines (qa measures with `git diff --stat`); over that it becomes a no-migration Inc 3 and 2b ships without it.** `CandidateTransactionRow` (and so `MatchedTransactionRow`, `tsc`-forced) gains `sweepLegTxnId: string \| null`. | A copy carries its **gift** date, not the sweep date, so "dated D" was wrong; the leg is one row on the Club side and needs no grouping. |
| **B13** | "removal of the lump fallback in `handleTransfer`". | **The lump retirement is scoped exactly in section 2 (P1).** Summary: refusal after the direction check, deletion of the sweep-only code, same-fund Transfer unchanged, pair decision paths unchanged. | The historical lump pair stays decidable, listable and co-signable; only creation closes. |
| **B14** | n/a | **`parseDollarsToCents(raw: string): number \| null` is created in `ledger.ts` by the api-developer** (B-197: the builder is its first user; the nine local copies are migrated later). | A ux-developer typing a tenth copy is the finding B-197 exists to stop. |
| **B15** | 2a scan: "only the five sweep routes import `ledger-sweep-batch` from app code". | **Amended to seven**: the five routes plus `app/(dashboard)/admin/ledger/sweep/page.tsx` (`listSweepCandidates`, `listSweepCloseouts`, `resolveSweepFunds`) and `app/(dashboard)/admin/ledger/approvals/page.tsx` (`getSweepBatchDetail`). The scan also asserts those two pages import **only those named read exports** (never `createSweepBatch`, `voidSweepBatch`, `markSweepCloseouts`, `unmarkSweepCloseouts`). `listSweepBadges` lives in `ledger-sweep-link.ts`, which the register and donor pages may import. The pointer-writer scans stay exactly as they are. | The pages must read; the writer rule is about writes. |
| **B16** | "api-developer (short) → ux-developer". | **api-developer (one medium pass) → ux-developer pass 1 (builder, closeout, retirement of the lump UI) → ux-developer pass 2 (read surfaces) → qa**, in the same worktree with a green gate (`tsc`, `lint`, `pnpm test`) between passes. | Same reason as 2a A11: the UI is about a dozen files plus guide, e2e and sentence flips; one context carrying all of it is the failure Inc 1 and 2a avoided. The api pass is not short (about 300 lines with tests) but is far from the 150-line full-stack case, so it stays a specialist pass. |
| **B17** | Carry-forward 7: flip lump-era sentences "when the lump path closes". | **ux pass 2 flips them, in the same release as P1** (never before: until the refusal ships, "sweeps are still one lump amount" is true). The five strings and their pins are named in section 3. | |
| **B18** | "donor-page 'swept to the Foundation' label". | **`getDonor()` rows gain `sweptOn: string \| null`** (api-developer): for a source, the leg's date of its **live** copy; for a copy, its leg's date; otherwise null (a source with only rejected copies is null). | Inc 1's label "…, not yet a Foundation gift" must flip only when a live copy exists. |
| **B19** | DECISION-126. | **Amended (still Proposed):** item 6 gains the `future_date` refusal; item 9 gains the exact lump closure. Unmeasured list gains S18 to S20 (B6, B7). DECISION-127 untouched. No migration, no key, no new directory. | The amendments are the only DECISION text this confirmation changes. |

**Holds, unchanged:** the batch shape, the single pointer writer (`createSweepBatch`), `decideTransaction()` as the only decision write path, the unconditional `approvedAt` guards, the two unmerged policies (`checkTransferDirection` still returns `mode: 'sweep'`; the batch module uses it as its gate), the copy-from-`FundLabels` rule, gift date on the copy, prior-year manage tier with a reason, the five 2a routes and their codes, receipts follow the issuer.

## 2. Ordering and exact split

0. **Preconditions (orchestrator).** Same worktree and Neon branch `feature/itemized-sweep-2`; implementers read and append the work-logs and `decisions.md` by their main-tree absolute paths. No agent restarts the `:3000` dev server (the 2a qa used `:3102`); an agent that needs a server asks the orchestrator. The branch's blocked approver mails (`email_queue`, subject `Sweep pending your approval%`) are cleaned between runs, and a killed client can leave a session holding row locks (look at `pg_stat_activity` before suspecting a hang). No agent writes production.

1. **api-developer — one pass (P1 to P11).** Gate between this and the UI: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test` green.
   - **P1 Lump retirement.** In `handleTransfer`, immediately after the `direction.allowed` check, `direction.mode === 'sweep'` answers **400 `{ error: SWEEP_ERROR_COPY.use_sweep_batch(labels), code: 'use_sweep_batch' }`** (`getFundLabels()` is already imported; import only the carrier `@/lib/ledger-sweep`, never `ledger-sweep-batch`). **May change:** that refusal; deletion of the sweep-only code (the `requiresBoardMinute` block, `rawBoardMinute`/`boardMinute`, `destCategoryId` parsing and the `Public donations` fallback with `PUBLIC_DONATIONS_CATEGORY_NAME`, the `noun: sweep` branch of the notifier call, which becomes `transfer` only, the file's docblock lines about sweep, and any import left unused). **May not change:** any observable behaviour of a same-fund Transfer (statuses, bodies, the `Transfer pending your approval — $…` email, the threshold rule); `ledger-transfer-policy.ts`; `notifyPendingApprovers`'s `sweep` noun (batches use it); the decision, co-sign, lock and Approvals code (a **pair** sweep from before the refusal must still be decidable, co-signable and listed); anything that writes a pointer column. **Tests that move:** in `transactions/route.test.ts`, every case whose subject is creating a sweep (lines 322 to 430: the board-minute cases, the posted/pending sweep, the destination-category default and override) becomes a `use_sweep_batch` case asserting 400, the code, **zero inserts and no notifier call**, and that the refusal comes before the board-minute and bank-account checks; cases that used `VALID_SWEEP_BODY` only to reach shared validation (bank account ownership and inactivity at 518 and 533, the attacker-supplied `entityId` at 567) are re-pointed to a same-fund Transfer body with the same assertions; the sweep email cases (637 to 720: the escaped memo, "A sweep requires board approval", the 201 carrying the leg id) are deleted because batches are covered by `email-compose.test.ts`, `ledger-approval-notify.test.ts` and the batch spec, and their Transfer twins stay. `ledger-sweep-consolidation.test.ts` test "the lump Transfer/Sweep route handler still exists…" is **replaced** by: `handleTransfer` exists; the route does not import `ledger-sweep-batch`; its only `ledger-sweep` import is the carrier; it contains `use_sweep_batch` and contains none of `destCategoryId`, `Public donations`, `noun: "sweep"`. `e2e/ledger-sweep-batch-api.spec.ts` test "should still post a lump Transfer/Sweep… (stays open until 2b)" is **flipped** to "should refuse a lump sweep with 400 `use_sweep_batch` and write no rows, and still post a same-fund Transfer". `e2e/ledger-approvals-history.spec.ts` L3 (email queue, ~line 907 to 960) drops its lump-sweep case (ordinary and transfer stay); the sweep email case moves into the batch spec (blocked queue row, link `?txn=<legId>`, the one-approval sentence, no party or memo).
   - **P2 Preselect helpers (carrier):** `parseSweepPreselect(raw: string \| string[] \| undefined): string[]` (split on commas, `isUuid`, dedupe, cap `SWEEP_BATCH_MAX`, anything else silently dropped) and `sweepBuilderHref(ids: readonly string[]): string` (`/admin/ledger/sweep?sweep=a,b`).
   - **P3 `CandidateTransactionRow.sweepLegTxnId`** in `reconciliation-queries.ts` (select the column in `getCandidateTransactionsForMatching` and `getMatchedTransactionsForSession`).
   - **P4 Preview fixes:** B1 (`canPost`), B5 (`future_date` in the carrier union, `SWEEP_ERROR_COPY`, `parseSweepPreviewBody`), the `maxDuration = 60` line (B6).
   - **P5 Batch-state messages (B3):** `sweepBatchState(row)` and `sweepBatchNextStep(state)` in the carrier; the third argument of `sweepRefusal`; the three call sites.
   - **P6 Detail:** `earliestGiftDate`, `latestGiftDate` on `SweepBatchDetail` and `getSweepBatchDetail` (B8).
   - **P7 `listSweepBadges` + `SweepRowBadge` + `sweepChipLabel`** (B11) and **`getDonor().sweptOn`** (B18). The live-copy predicate comes from `ledger-sweep-link.ts` (a scan already fails any other spelling).
   - **P8 `listSweepCloseouts`** (B10) and its row type in the carrier.
   - **P9 Carrier copy:** `SWEEP_ROW_FLAG_COPY` (exhaustive over `SweepRowFlag`), `describeSweepWarning(w, labels)` (a `switch` with a `never` check over the three `SweepWarning` variants), `describeSentStatementMonth`, `SWEEP_CLOSEOUT_SKIP_COPY`. Every string a function of `FundLabels`; none contains a fund name literal.
   - **P10 `parseDollarsToCents`** in `ledger.ts` (B14).
   - **P11 Scan tests** that follow from the above (consolidation test as in P1; the importer list stays five until the ux passes add the two pages).
   - **Folding into full-stack-developer was considered and rejected** (B16).

2. **ux-developer, pass 1 — builder, closeout, retirement of the lump UI.** Files in section 3. Ends with: `tsc`, `lint`, `pnpm test`, `pnpm build:only` green; the builder reachable from the register button; the old Sweep form mode gone.

3. **ux-developer, pass 2 — read surfaces.** Approvals batch row and card, dialog wording, history badge; register badges, hidden controls, `sweep-batch-dialog.tsx` with Void; the match-picker grouping (if within budget); the donor label; the Treasury guide; the lump-era sentence flips and their pins; the two e2e specs below. Ends with the same gates.

4. **qa (Phase 5):** gates; the named tests audited for presence; live checks S14 to S25; the e2e specs; the Phase 5 report with the tree state measured. **5. analyst (Phase 6):** one verdict for B-172 against the Phase 1 intent.

## 3. Component plan and page contract

**Pass 1 (ux-developer) creates**
- `src/app/(dashboard)/admin/ledger/sweep/page.tsx` — Server Component. First statements: `auth()` then `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` (redirect `/signin` / `/admin/ledger`; `admin-page-feature-gates.test.ts` must pass). Reads: `getFundLabels()`; `resolveSweepFunds(db)` (null renders `SWEEP_ERROR_COPY.fund_not_found(labels)`); `getBankAccounts()` for the source and destination entities with `pickDefaultBankAccount`; `listSweepCandidates(db, { now, callerCanManage })`; for `ledger.manage` holders `listSweepCloseouts(db)`; `getSettings()` for the threshold; `parseSweepPreselect(searchParams.sweep)`; the Eastern today string. **No fund name is typed**; the literal scan covers this directory.
- `src/components/admin/ledger/sweep-batch-builder.tsx` (`'use client'`): two steps, select then review. **Select:** a select-all checkbox, a running count and total, gifts sorted by gift date, a checkbox per gift (date, party, category, "goes to {Foundation category}", receipt note), the "N gifts have no donor record" nudge, the FIFO line ("Dollars age oldest-first, so a gift can show here as unswept while its dollars have already been counted as spent."), a collapsed **held back** section where each gift shows `SWEEP_ROW_REFUSAL_COPY[code](labels)` (prior-year rows for a record-only user read `manage_required`), gifts a pending batch holds listed as "In a batch waiting for board approval", and for `ledger.manage` the closeout controls. Cards below `xl` (a 44px checkbox row each), a table at `xl+`, one shared row component. **Review** (after `POST …/preview`): totals, `count`, the Foundation category per row, `foundationReceipt` (`already_sent` with `receiptSentOn`), `SWEEP_ROW_FLAG_COPY` for every flag, `describeSweepWarning` for every warning, each `sentStatementMonths` entry with `addsCents`, the fiscal years, and (only when `count > 0`, B2) the tier and pending/posted line; fields: sweep date (default today, `max` today), source and destination accounts, "amount that reached the bank" (`parseDollarsToCents`; the difference is shown live from `differenceCents`), board minute (required, `BOARD_MINUTE_MAX_LEN`), and the prior-year reason when `needsReason`. Post is enabled only when `canPost`, the typed amount equals the total, the minute is set, the reason is valid, and nothing is submitting; it opens a **`<ConfirmDialog>`** ("Post this sweep to the Foundation?", not destructive-red, saying how many gifts, the total, and whether it posts now or goes to the board) and then runs B6 and B7.
- `src/components/admin/ledger/sweep-builder-logic.ts` — pure: `sweepTierLine`, `reviewSignature`, `reviewDrifted`, `interpretCreateFailure` (an exhaustive `Record<SweepErrorCode, …>` so a new code is a compile error), `canSubmitSweep`, `isFutureSweepDate`.
- `src/components/admin/ledger/sweep-closeout-dialog.tsx` — `LedgerDialogShell` + `CorrectionReasonField` (the Delete dialog pattern; `REASON_LIMITS`; "do not type a family's name"); mark renders `skipped[]` with `SWEEP_CLOSEOUT_SKIP_COPY`; unmark is a `<ConfirmDialog>`.
- Modified: `[fundSlug]/page.tsx` (the "Sweep to the Foundation" button; **delete** the `?sweepFrom=` block, `sweepPrefill`, `buildSweepMemo`/`getLatestFundMove` imports, `crossEntityContext` and the launcher if nothing else reads them; `tsc` and `lint` decide), `transaction-form.tsx` (delete the `sweep` FlowMode, `sweepPrefill`, `SweepPrefill`, `crossEntityContext`'s sweep use, `destCategoryId`, the sweep confirm), `transaction-form-dialog.tsx`, `correction-dialog-logic.ts` (`sweepDeepLink` is replaced by `sweepBuilderHref` from the carrier), `move-transaction-dialog.tsx` (re-aim "Record sweep now"). **Deleted:** `sweep-prefill-launcher.tsx`.

**Pass 2 (ux-developer) creates or modifies**
- `sweep-batch-summary.tsx` (one component for the Approvals card and the table row: memo, count, total, sweep date, gift-date span, fiscal years, `byCategory` lines, recorder, minute; its props have **no party, memo or donor field**), `approvals/page.tsx` (for each pending row with `batch`, `getSweepBatchDetail`; cards below `xl`, table at `xl+`, **one shared `ApprovalActions` block** so the "no permission to approve" bug class cannot return), `approval-actions.tsx`/`approve-dialog.tsx`/`reject-dialog.tsx`/`approval-dialog-logic.ts` (`batch` prop, `describeBatchDecision`, `isDecideTheBatch`), `approval-history.tsx` (batch count badge from `batchCount`).
- `sweep-batch-dialog.tsx` (`GET …/sweep-batches/[legId]` on open; state from `sweepBatchState`; the summary; for `canManage` a **Void** action: `LedgerDialogShell` + `CorrectionReasonField`, destructive button, a 409 renders `SWEEP_VOID_BLOCK_COPY[code](labels)` as message plus next step; success refreshes), `sweep-row-controls.ts` (pure `sweepRowControls(badge, canManage)`), `[fundSlug]/page.tsx` (calls `listSweepBadges` for the visible ids and passes the badge to `TransactionActions`, which renders the chip and hides Edit, Delete, Split and Move for `batch`, `copy` and `source`), `reconciliation-sweep-groups.ts` + `reconciliation-match-picker.tsx` (B12), `donor-detail-client.tsx` and its page (B18; "Swept from {labels.activity} on D" on the copy), the Treasury guide: a new `guide/itemized-sweep-section.tsx` (how a batch is built, review, the board's approval, void and why an approved batch cannot be voided, the closeout and the 2026-10-01 lump, the FIFO wording) registered in `guide/page.tsx`'s TOC and sections, the flipped sentences in `books-register-section.tsx` (lines 160 to 165 and 215 to 217 name the old form) and `zeffy-fund-routing-section.tsx` ("Recording the sweep to the Foundation" describes two linked entries), and the five lump-era strings: `LUMP_SWEEP_NOTE` and the two "Today's lump sweep does not check this" sentences in `ledger-category-mirror.ts` (`mirrorHintCopy`), the "today's lump sweep ignores it" description in `category-mirror-dialog.tsx`, and the deactivate tail in `category-deactivate-confirm.tsx`; pins in `ledger-category-mirror.test.ts`, `foundation-bound-hint.test.tsx` and `e2e/ledger-category-mirror.spec.ts`.
- Modified in `app/(dashboard)/admin/ledger/approvals/page.tsx` and the sweep page: update `ledger-sweep-consolidation.test.ts`'s importer list to the seven in B15 in the same change that adds each import.

**Error codes the builder must render, with copy from the carrier (never retyped):** preview 400 `invalid_body`, `invalid_id`, `no_rows`, `batch_too_large`, `duplicate_ids`, `invalid_date`, `future_date`, `invalid_amount`, `bank_account_invalid`, 403 `direction_denied`, 404 `fund_not_found`; create adds `minute_required`, `reason_required`, `total_mismatch` (with `derivedCents` and `typedCents`), `total_too_large`, 403 `manage_required`, 409 `rows_refused` (each `rows[]` entry with its `SWEEP_ROW_REFUSAL_COPY`), 409 `rows_claimed` (B6); the lump `use_sweep_batch` is not reachable from the UI. Void: every `SweepVoidBlock` plus 400 `reason_required` and 404. Closeout: 400 codes and every `SweepCloseoutSkip`.

**Layout rules (all pages and dialogs):** `rounded-2xl` cards, `rounded-lg` buttons, `lions-blue`/`lions-gold` only, no `rounded-full` outside chips (which keep a 44px tap height and a focus ring), 44px targets, nothing wider than 360px without an inner scroll, the table at `xl` and cards below, no native `alert`/`confirm`/`prompt` (a scan over `sweep-*`), `<ConfirmDialog>` for the post and unmark confirmations, `LedgerDialogShell` for the form dialogs, fund names only through `FundLabels` (`getFundLabels()` on the server, a prop on the client), and **no raw fund `kind` printed** (`fundKindBadge()` if a badge is needed). Success uses `sonner`; after a mutation `router.refresh()`.

## 4. Tests each implementer delivers (named; passing before Phase 5)

**api-developer**
- `src/lib/ledger-sweep.test.ts` (extended): `future_date` (tomorrow refused, today allowed, preview and create parsers agree, Eastern boundary); `SWEEP_ERROR_COPY`, `SWEEP_ROW_FLAG_COPY`, `SWEEP_CLOSEOUT_SKIP_COPY` exhaustive with a custom `labels.activity` and no default fund name; `describeSweepWarning` per variant; `sweepBatchState` and `sweepBatchNextStep` per state; `sweepChipLabel` per badge kind and state; `parseSweepPreselect` (valid, non-UUID dropped, duplicates collapsed, cap 200, array, undefined, empty); `sweepBuilderHref`; the carrier still has no `@/lib/db` import.
- `src/lib/ledger-sweep-batch.test.ts` (extended): `canPost` false above `SWEEP_INT4_MAX` and the preview/create parity test updated; detail carries the gift-date span and still no party, memo or donor key; `listSweepCloseouts` (rows, order, reason, empty, only closed-out rows).
- `src/lib/ledger-sweep-link.test.ts` (extended): `listSweepBadges` for a plain row (none), a leg in each state with its count, a copy, a claimed source, a source with only rejected copies (none), and that N ids cost no more than two selects.
- `src/lib/ledger-transaction-lock.test.ts` (extended): `sweepRefusal('sweep_batch', action, batch)` by state; the other kinds unchanged. Route tests `transactions/[id]/route.test.ts`, `route.delete.test.ts`, `split/route.test.ts` (extended): an approved leg's refusal no longer says "void it before it is approved".
- `src/lib/reconciliation-queries.test.ts` (extended): both candidate and matched rows carry `sweepLegTxnId`.
- `src/lib/ledger-queries.donors.test.ts` (extended): `sweptOn` for a source with a live copy, a copy, a rejected-only source (null), a plain row (null); the `LedgerTransaction` fixtures gain nothing new.
- `src/lib/ledger.test.ts` (extended): `parseDollarsToCents` (`12`, `12.5`, `12.50`, `$1,234.56`, ` 7.00 `, `0.01`, `19.99` is 1999, `0.29` is 29, `1.15` is 115; null for empty, `abc`, `1.234`, `-5`, `1e3`, and anything above `INT4_MAX` cents).
- `src/app/api/admin/ledger/transactions/route.test.ts` (rewritten as in P1); `ledger-sweep-consolidation.test.ts` (as in P1); `e2e/ledger-sweep-batch-api.spec.ts` (lump flipped, the sweep email moved in, `future_date` 400, an over-`INT4_MAX` preview answers `canPost: false`); `e2e/ledger-approvals-history.spec.ts` (L3 trimmed).
- Gates run, not edited: `default-role-bundles.test.ts`, `admin-page-feature-gates.test.ts`, `fund-name-literal-scan.test.ts`.

**ux-developer, pass 1**
- `src/components/admin/ledger/sweep-builder-logic.test.ts`: `sweepTierLine` is null for `count 0` and for an all-refused preview (**the builder never prints the tier of an all-refused preview**) and non-null otherwise; `reviewSignature`/`reviewDrifted` (a changed Foundation category, a new refusal, a total change, a status flip each drift; an identical preview does not); `interpretCreateFailure` for 201, `rows_claimed` with and without an earlier attempt, `rows_refused`, `total_mismatch`, `manage_required`, a network error and a 500 (unknown outcome), and every `SweepErrorCode` mapped; `canSubmitSweep` gating; `isFutureSweepDate`.
- `src/components/admin/ledger/sweep-batch-builder.test.tsx`: the select step (select all, running total, held-back refusal copy, no-donor nudge, FIFO line, a gift held by a pending batch); the review step (flags, warnings, sent-statement months, `already_sent` receipt, `total_too_large` copy and no Post); **an all-refused preview renders none of the tier, needs-reason or pending/posted text**; two synchronous Post clicks send exactly one create; a custom `labels.activity` appears and the default does not; no `window.confirm/alert/prompt` in `sweep-*` (source scan).
- `src/components/admin/ledger/sweep-closeout-dialog.test.tsx`: reason gating with `REASON_LIMITS`, every skip code rendered, unmark confirm.
- `src/lib/sweep-lump-retired.test.ts` (scan): `sweep-prefill-launcher.tsx` does not exist; no non-test file under `src` contains `sweepFrom`, `SweepPrefill`, `sweepDeepLink`, `destCategoryId`, or a `"sweep"` flow mode in `transaction-form.tsx`; `move-transaction-dialog.test.tsx` (updated) asserts the link is `/admin/ledger/sweep?sweep=<id>`.
- `e2e/ledger-sweep-builder.spec.ts` (new): a `ledger.record` user selects, reviews and posts a small batch (posts now) and a large one (goes pending); a wrong typed amount blocks Post and shows the difference; a prior-year gift is held back for a record-only user with the `manage_required` copy; `?sweep=` preselects; a manage user marks and unmarks a closeout; a non-record user is redirected; 360px has no horizontal page scroll. `e2e/ledger-move-transaction.spec.ts` (the two tests at ~255 and ~499 rewritten: the link lands on the builder with the gift preselected and nothing recorded).

**ux-developer, pass 2**
- `src/components/admin/ledger/sweep-batch-summary.test.tsx` (card and row render the same fields; no party or memo even if an object carrying them is passed through a cast); `approval-actions.test.tsx` and `approval-dialog-logic.test.ts` (extended: `describeBatchDecision`, `isDecideTheBatch` handled); `approval-history.test.tsx` (batch badge); an Approvals page source scan (batch rows use `getSweepBatchDetail`, import only read exports).
- `src/components/admin/ledger/sweep-batch-dialog.test.tsx` (pending, posted, approved and reconciled states; Void visible only to `canManage`; reason gating; every `SweepVoidBlock` renders message and next step); `sweep-row-controls.test.ts` and `transaction-actions.test.tsx` (extended: leg, copy and source hide Edit, Delete, Split and Move; a copy keeps the donor control; a plain row is unchanged).
- `src/components/admin/ledger/reconciliation-sweep-groups.test.ts` and `reconciliation-match-picker.test.tsx` (extended: grouping, header text, the group button selects exactly the listed ids, a partial group, non-sweep candidates unchanged).
- `donor-detail-client.test.tsx` (extended: the three labels and the total), `treasury-guide-labels.test.tsx` (the new section renders custom labels and no default fund name; the flipped sentences are gone), `ledger-category-mirror.test.ts`, `foundation-bound-hint.test.tsx`, `e2e/ledger-category-mirror.spec.ts` (updated pins), a scan that no non-test source contains `LUMP_SWEEP_NOTE`, "lump sweep" or "one lump amount".
- `e2e/ledger-sweep-batch-ui.spec.ts` (new): the Approvals page shows one batch row at 1280 and cards at 1279 and 360, Approve works by a second user, the register shows the three chips and no Edit/Delete on a leg, a copy and a source, the dialog voids a posted batch and refuses an approved one with the carrier's sentence, "Match this batch" selects the group.

## 5. Deviations routing

Per CLAUDE.md: anything an implementer or user adds beyond this confirmation is listed under "Deviations from the design" and routed by size. Under about 30 lines, no schema, no new API: absorbed with a note. A new route, schema or page: back to Phase 3 (stop and say so). A new flow or permission: back to Phase 1. Specific to 2b: (1) a need for any new column or index stops the work; (2) a gift-level list on Approvals, an Approvals entry point, memo editing on a copy, or "N of M" in the match picker are **rejected here** and become the proposed backlog items below; (3) "Match this batch" over 100 lines becomes Inc 3 (no migration) and ships separately; (4) any write to a pointer column outside `ledger-sweep-batch.ts`, any carve-out of an `approvedAt` guard, any fund-name literal, or a second decision write path is a defect, not a deviation.

## 6. Live checks for qa (record the observed rate; none has been run)

All on the Neon branch `feature/itemized-sweep-2` (host compared before every write), a dev server on its own port started by the orchestrator, `RESEND_API_KEY` empty, `EMAIL_DEV_ALLOWLIST` unset.

| Id | Check | Records |
|---|---|---|
| S14 | The treasurer flow end to end in the browser at 1440 wide: a record user builds a batch over the pending threshold (three gifts, two categories) and posts it; a **second** `ledger.approve` user opens Approvals, sees one batch row (count, total, categories, no party, memo or donor), approves; the registers then show the Club leg chip, N Foundation copies chipped "Swept from {Public Funds} on D" (the fund's stored name) and the sources chipped "Swept to the Foundation on D"; a **second, under-threshold** batch posts at once and a `ledger.manage` user voids it from the register dialog; a manage user marks a held gift as handled and unmarks it. | Each step pass or fail, and the number of steps done without touching the API directly. |
| S15 | The lump route refuses and the UI no longer offers it. | `POST /transactions` with a sweep-direction body: 400 `use_sweep_batch`, rows written 0 (before and after counts), n/n over 5; same-fund Transfer 201; the Type selector lists no "Sweep to Foundation"; `…/activity?sweepFrom=<id>` renders the plain register; a pair sweep seeded by SQL is still approvable. |
| S16 | Mobile at 360 wide: builder select and review, the post confirm, Approvals card, batch dialog, void dialog, closeout dialog. | Horizontal page scroll (expect none), the smallest measured tap target (expect 44px), any clipped dialog. |
| S17 | Approvals at 1279 and 1280 wide. | Cards below, table at and above; the Approve and Reject buttons present and working at both (the shipped `xl` bug class). |
| S18 | Double submission. 10 passes: two create requests sent together for the same fresh gifts, then the page's own double click. | Batches created per pass (expect exactly 1, n/n), requests the page sent (expect 1), the message shown to the second (expect the neutral "most likely the one you just posted", never "failed"). |
| S19 | Time from Post click to the response for a pending create (16 approvers on the branch), three runs, and whether the response ever failed at the platform timeout. | Seconds, with the 2a O6 figure beside it. The production figure is not measured and the doc says so. |
| S20 | Drift between review and post. 5 passes: change a counterpart (API) after the review is shown, then click Post. | Batches written (expect 0), the changed list shown, n/n. |
| S21 | Date rule. | A future date: 400 `future_date` from preview and create (API) and the date input's `max`; a past date posts; the Eastern boundary at 8 p.m. (record both days). |
| S22 | O1 and O2 in the page. | A derived total above `INT4_MAX`: preview `canPost: false` and the page shows `total_too_large` with no Post; an all-refused selection prints no tier line. |
| S23 | PII boundary. | The Approvals page text, the batch dialog and the detail JSON for a pending batch contain none of the fixture parties, memos or donor names (n of n strings absent); an approver without `ledger.record` is redirected from `/admin/ledger/sweep`; a record-only user gets 403 on void and closeout and sees no Void button. |
| S24 | "Match this batch": a Foundation session with a bank credit equal to the batch total. | Group header text, candidates selected, commit through the existing match route; the partial case (one copy matched elsewhere) selects N-1 and the sum gate blocks; and the **line count** of the picker change plus the new file (budget 100). |
| S25 | Donor page and lump-era text. | A donor with one swept gift: the source row label, the copy label, the total counting the copy once; a rendered-text search of the category screen, the Foundation-bound hint, the mirror dialog, the deactivate dialog and the guide for "lump" and "one lump amount" (expect 0). |

The rehearsal of the first production batch (three prior-year gifts of an earlier fiscal year, one carried through the 2026-10-01 lump) is an S14 variant on branch fixtures only: the closeout marks the carried row, the manage user posts the rest with a reason. Production is never touched by an agent (Workflow Rule 10).

## 7. Goes back to the user and orchestrator

- **User (defaults applied):** the builder is the only way to sweep once 2a and 2b ship; there is no lump fallback. A record-only treasurer cannot sweep a prior-year gift (a manage holder must), as already agreed. The Approvals page shows a batch as a summary, not a list of gifts (B8). Memo changes on a Foundation copy are not offered (B11).
- **Orchestrator:** (1) File the proposed backlog text below. (2) 2a and 2b ship in one release; the lump closure and the new builder must not be split across releases. (3) The e2e files to rerun on a quiet network at the combined `/pre-push` are the 2a qa list plus the two new specs.

**Proposed backlog text (orchestrator files; next free id B-201)**
- **B-201 — Edit the memo of a swept Foundation copy.** (priority: small) The server allows `donorId` and `memo` on a copy; 2b exposes only the donor link. Add a one-field dialog (or a memo control in `TxnDonorActions`) that sends `{ memo }` and relies on `sweepEditAllowance`.
- **B-202 — Pending sweep create awaits ~16 sequential approver emails.** (priority: small) About 20 s on the dev branch with 16 blocked-queue inserts; production believed to be about 5 s (16 Resend calls), unmeasured. 2b sets `maxDuration = 60` and guards the double click in the builder; moving `notifyPendingApprovers` after the response (`after()`) or sending concurrently would fix the latency for both the batch and the Transfer path. Check the Next 16 `after()` semantics in `node_modules/next/dist/docs/` first.
- **B-203 — Itemized gift list on a pending batch's Approvals row.** (priority: small, only if the board asks) date, amount and Foundation category per gift with no party, memo or donor, from a new field on `SweepBatchDetail`, with the PII tests of 2a extended to it.

**Draft release-notes entry (no version number; `/release-notes` assigns it at ship, written for the combined 2a and 2b release)**
*Sweeping to the Foundation is now itemized.* The treasurer picks the gifts in Public Funds that are going to the Foundation, checks them against the amount that reached the bank, and posts them as one sweep. The Foundation's books now show each gift on its own line, with its original date, its donor and its Foundation category, so receipts, donor history and the Form 990 prep see what was actually given. A sweep over the approval threshold goes to the board as a single item with the number of gifts, the total and a line per category; one approval posts the whole batch. A sweep that has not been approved or cleared at the bank can be voided with a reason, which frees its gifts; gifts the earlier lump sweep already covered can be marked as handled. Reconciliation can select a whole sweep at once. The old single-amount sweep form is gone.

## Handoff (standard template)

**Owner:** tech-lead  **Status:** complete  **Date:** 2026-10-19

### Summary
The parent's 2b design holds against the as-built 2a, with nineteen rulings. The main ones: the lump closure is scoped line by line (P1); six of qa's observations are settled (B1 to B6: one server fix for the overflow preview, a builder-only rule for the tier, batch-state messages, a server `future_date` refusal, and a double-click and unknown-outcome rule with `maxDuration = 60`); the builder re-previews before it posts (B7); Approvals shows a summary not a gift list (B8); the void lives in a dialog, not a page (B9); the closeout list, the register badges and the donor date each need one new read-only query (B10, B11, B18); "Match this batch" drops the "of M" text (B12). No migration, no key.

### What I did
- Read 2a's code, tests and both work-logs against the parent's 2b text; verified by reading that no column is missing; found and routed the gaps the parent could not see (no closed-out list, no gift list or date span in the detail, no copy for flags, warnings or skips, no `parseDollarsToCents`, a lump test that pins the route text, an e2e that creates a lump sweep for the email check).
- Wrote the rulings, the exact api and ux split with the lump-retirement boundary, the component plan and page contract, every named test, the deviation routing and live checks S14 to S25.
- Amended DECISION-126 (still Proposed); updated this work-log's status table.

### Outputs
- This section; `docs/decisions.md` (DECISION-126 amended); this work-log's Per-Phase Status. No code, no backlog, no `package.json`.

### Open questions / handoff notes
- Implementers in order: **api-developer** (P1 to P11, one pass), then **ux-developer pass 1**, then **ux-developer pass 2**, then **qa**.
- Not settled, flagged: the exact `after()` semantics for B-202 (not read; B-202 says to check first), and the production latency of a pending create (S19 measures the branch only).

---

---

# Phase 4 — Implementation

## Phase 4 — api-developer pass (server) — 2026-10-19

**Owner:** api-developer. **Status:** complete. Worktree `/Users/cshenso/git/westervillelions/.claude/worktrees/itemized-sweep-inc2`, nothing committed. Branch `feature/itemized-sweep-2` (host compared: `ep-calm-queen-amj2hzll-pooler…`), no production access, no migration, no new `FEATURES` key, no `decisions.md`/`backlog.md`/`package.json` edit.

### Gates (tree state: worktree, uncommitted, 2a plus this pass)
- `pnpm exec tsc --noEmit`: clean (including every client consumer; see consumers below).
- `pnpm lint`: 0 errors, the one known warning (`budget-context-panel.tsx:114`).
- `pnpm test`: 324 files, 5625 tests, green (5560 before the new tests were written; 65 added or reshaped).
- `pnpm build:only`: passes; the five `sweep-batches` routes are in the route list.
- Live, on port 3103 against the branch (stopped by pid; `:3000` untouched): lump sweep body (real Public Funds to Charitable fund ids) answers **400 `use_sweep_batch`** with the carrier sentence and writes nothing; preview and create with a 2099 date answer **400 `future_date`**; a preview of two 2,000,000,000-cent gifts answers **200 `canPost: false`, `totalCents 4000000000`, no row refused**; a one-gift preview answers `canPost: true`; create posts a one-gift batch; the detail JSON carries `earliestGiftDate`/`latestGiftDate` (both the gift's date) and no party/memo/donor; PATCH of the posted leg answers the state-following sentence "Void it (a manager) to undo it and free its gifts."; `listSweepBadges` returned `batch` (count 1) for the leg, `source` for the claimed gift and `copy` for the copy; `listSweepCloseouts` returned the marked gift newest-first with its reason, empty after Unmark; void succeeded. Cleanup: test gifts, the batch, 4 `sweep_%` audit rows from the last 45 minutes (void, create, mark, unmark) deleted; `ledger_transactions` back to **313**, `LEGS_LEFT 0`. Not driven live: the approved-leg sentence (unit and route tests cover it) and the double-submission (S18 is ux/qa).

### Files per item
- **P1 lump retirement** — `src/app/api/admin/ledger/transactions/route.ts`: `direction.mode === 'sweep'` answers 400 `{ error: SWEEP_ERROR_COPY.use_sweep_batch(labels), code: 'use_sweep_batch' }` immediately after the `direction.allowed` check; deleted `PUBLIC_DONATIONS_CATEGORY_NAME`, `rawBoardMinute`/`boardMinute` parsing, the `requiresBoardMinute` block, `destCategoryId` parsing and the default-category lookup, the `sweep` branch of the notifier call (now `noun: "transfer"`, subject `Transfer pending your approval — $…`), the docblock lines, and the unused imports (`BOARD_MINUTE_MAX_LEN`, `and`). Imports only the carrier `@/lib/ledger-sweep`. The Transfer legs still insert an explicit `boardMinute: null` so the same-fund Transfer is observably unchanged. Tests moved: `transactions/route.test.ts` (sweep-creation cases became `use_sweep_batch` cases asserting 400, code, no `db.transaction`, no notifier call, and that the refusal precedes the board-minute and bank-account checks; bank ownership, inactive account and attacker `entityId` cases re-pointed to a same-fund Transfer body; the sweep email cases replaced by their Transfer twins incl. the `Transfer pending your approval — $500.00` subject); `ledger-sweep-consolidation.test.ts` (lump test replaced as designed); `e2e/ledger-sweep-batch-api.spec.ts` (lump test flipped, plus the Transfer still posting); `e2e/ledger-approvals-history.spec.ts` L3 (lump-sweep case removed; the sweep email case moved into the batch spec).
- **P2** carrier `src/lib/ledger-sweep.ts`: `parseSweepPreselect`, `sweepBuilderHref`.
- **P3** `src/lib/reconciliation-queries.ts`: `CandidateTransactionRow.sweepLegTxnId`, selected in both queries.
- **P4** `ledger-sweep.ts` (`future_date` in `SweepErrorCode`, copy, and the shared `parseSweepPreviewBody`, so create inherits it), `ledger-sweep-batch.ts` (`canPost` false above `SWEEP_INT4_MAX`), `sweep-batches/route.ts` (`export const maxDuration = 60;`, create only), docblocks of the create and preview routes.
- **P5** carrier `sweepBatchState`, `sweepBatchNextStep`; `ledger-transaction-lock.ts` `sweepRefusal(kind, action, batch?)`; the three call sites (`[id]/route.ts` PATCH `existing`, DELETE `target`, `[id]/split/route.ts` `existing`).
- **P6** `getSweepBatchDetail` + `SweepBatchDetail.earliestGiftDate/latestGiftDate`.
- **P7** `listSweepBadges` in `ledger-sweep-link.ts`; `SweepRowBadge` and `sweepChipLabel` in the carrier; `getDonor()` rows gain `sweptOn` (`ledger-queries.ts`, via `listSweepBadges`, two extra selects).
- **P8** `listSweepCloseouts(exec)` in `ledger-sweep-batch.ts`; `SweepCloseoutRow` in the carrier.
- **P9** carrier `SWEEP_ROW_FLAG_COPY`, `describeSweepWarning`, `describeSentStatementMonth`, `SWEEP_CLOSEOUT_SKIP_COPY`.
- **P10** `parseDollarsToCents` in `src/lib/ledger.ts`.
- **P11** `ledger-sweep-consolidation.test.ts` (importer count left at **five**, `maxDuration` only on the create route, notifier still awaited and no `after(`, `listSweepBadges` lives in the link module).

### Tests added or changed, by name
- `ledger-sweep.test.ts`: `future_date (B5)` block (tomorrow refused / today and past allowed, preview and create parsers agree, Eastern boundary, omitted date), `Increment 2b carrier copy and helpers` block (flag and skip records exhaustive with a renamed fund, `future_date` copy, `describeSweepWarning` per variant, `describeSentStatementMonth`, `sweepBatchState`, `sweepBatchNextStep` per state, `sweepChipLabel` per kind and state, `parseSweepPreselect`, `sweepBuilderHref`); the exhaustive-copy test lists `future_date`. The existing "carrier has no `@/lib/db` import" and "no fund name literal" tests cover the new code.
- `ledger-sweep-batch.test.ts`: `preview says canPost false above INT4_MAX, in step with the create refusal`, `a total of exactly INT4_MAX can still be posted`, `getSweepBatchDetail gift-date span (B8)` (incl. exact key set: still no party, memo or donor), `listSweepCloseouts (B10)` (rows, order, reason, ISO `closedAt`, empty), detail test updated.
- `ledger-sweep-link.test.ts`: `listSweepBadges (B11)`: none for a plain row, leg with count and state, approved leg, copy, source with live copy, source with only rejected copies (none), rejected-batch copy, 60 ids cost exactly two selects.
- `ledger-transaction-lock.test.ts`: `sweepRefusal('sweep_batch', action, batch)` by state; other kinds unchanged by the argument. Route tests `[id]/route.test.ts` (3 states), `[id]/route.delete.test.ts` (approved, pending/posted), `[id]/split/route.test.ts` (approved): an approved leg no longer says "void it".
- `reconciliation-queries.test.ts`: both reads select and return `sweepLegTxnId`. `ledger.test.ts`: `parseDollarsToCents` (every value in the design plus extras). `ledger-queries.test.ts`: `getDonor sweptOn (B18)`.
- `ledger-sweep-consolidation.test.ts`: lump route test replaced; new `Increment 2b server additions` block.
- E2E written, not run in full by me (live-driven by hand instead; qa runs them): `e2e/ledger-sweep-batch-api.spec.ts` gains the use_sweep_batch/Transfer, `future_date`, over-INT4 `canPost`, and detail span plus blocked approval email tests.
- Gates run, not edited: `default-role-bundles.test.ts`, `admin-page-feature-gates.test.ts`, `fund-name-literal-scan.test.ts` (all green).

### Consumers grepped for the widened members
`SweepErrorCode` gained `future_date`; `SweepBatchDetail` gained two fields; `CandidateTransactionRow`/`MatchedTransactionRow` gained a field; `getDonor` rows gained `sweptOn`. `grep` over `src/components` and `src/app` for `SweepErrorCode|SweepBatchDetail|ledger-sweep` finds no client consumer yet (the builder, dialogs and Approvals batch row are ux work); `CandidateTransactionRow` is consumed by `reconciliation-match-picker.tsx`, `reconciliation-matching-grid.tsx` and `sessions/[sessionId]/route.ts`, all compile unchanged. The only fixture edit: `donors/[id]/donor-detail-client.test.tsx` (two literals) gained `sweptOn: null`. No `x === "a" ? … : …` over a widened union exists to convert.

### Deviations from the design (all absorbed, none needs Phase 3)
1. The `getDonor` `sweptOn` test is in `ledger-queries.test.ts` (the queue-style mock that already drives `getDonor`), not `ledger-queries.donors.test.ts`, whose mock has no `.limit`. About 40 lines of test, no behaviour.
2. `sweepBatchState`'s parameter is `{ status } & Record<"approvedAt", Date | string | null>` rather than a property literal, because the 2a scan bans the spelling `approvedAt:` in the carrier. It only reads the column.
3. `ledger-transaction-lock.ts` now imports two functions from the carrier (`sweepBatchNextStep`, `sweepBatchState`). The carrier does not import the lock module at runtime, so there is no cycle.
4. `getDonor` calls `listSweepBadges` rather than a bespoke query, adding two selects per donor page (one per 60-ish ids, not per row). A copy of a rejected batch and a freed source give `sweptOn: null`.
5. `closedAt` on `SweepCloseoutRow` is an ISO string (the column is a naive `timestamp`), so it is safe to pass to a client component.
6. `LOCK_COPY.sweep_batch.nextStep` was left as is (a general "reject while pending or void before approved", which is true); only `sweepRefusal` follows the state, per B3.

### Notes for the ux-developer
Carrier `@/lib/ledger-sweep` (client-safe) exports to consume:
- Types: `SweepPreviewRequest/Response/Row`, `SweepBatchCreateRequest/CreatedResponse`, `SweepErrorBody` (`code`, `rows[]`, `derivedCents`, `typedCents`), `SweepBatchDetail` (now with `earliestGiftDate`, `latestGiftDate`), `SweepCandidates/SweepCandidateRow`, `SweepCloseoutRequest/Response/Row` (new: `sourceId, giftDate, amountCents, party, categoryName, reason, closedAt`), `SweepBatchState` (`pending|posted|approved|rejected`), `SweepRowBadge`.
- Copy records (exhaustive, each a function of `FundLabels`): `SWEEP_ROW_REFUSAL_COPY`, `SWEEP_ERROR_COPY` (now incl. `future_date`; `use_sweep_batch` is not UI-reachable), `SWEEP_VOID_BLOCK_COPY` (`{ message, nextStep }`), `SWEEP_ROW_FLAG_COPY`, `SWEEP_CLOSEOUT_SKIP_COPY`; functions `describeSweepWarning(w, labels)`, `describeSentStatementMonth({ month, addsCents })`, `sweepChipLabel(badge, labels)`, `sweepBatchNextStep(state)`, `sweepBatchState({ status, approvedAt })`, `sweepLegMemo(count)`.
- Helpers: `parseSweepPreselect(searchParams.sweep)` (UUID-filtered, deduped, cap 200), `sweepBuilderHref(ids)` (replaces `sweepDeepLink`), `SWEEP_BATCH_MAX`, `SWEEP_INT4_MAX`, `REASON_LIMITS`, `BOARD_MINUTE_MAX_LEN`.
- `parseDollarsToCents(raw)` in `@/lib/ledger` (null on invalid or above INT4 cents; it returns 0 for "0", so the builder still requires a positive total and `canPost`).
- Server reads for the two new pages (B15; pages may import only these named exports from `ledger-sweep-batch`): `listSweepCandidates(db, { now, callerCanManage })`, `listSweepCloseouts(db)` (manage holders only; its rows carry a free-text reason and a party), `resolveSweepFunds(db)`, `getSweepBatchDetail(db, legId)`. `listSweepBadges(db, ids)` is in `@/lib/ledger-sweep-link` (register and donor pages may import it).
- Codes and what they mean to the UI: preview and create 400 `future_date` (also give the date input `max` = Eastern today); preview `canPost` is now also false above `SWEEP_INT4_MAX`, so render `SWEEP_ERROR_COPY.total_too_large` when `totalCents > SWEEP_INT4_MAX` and offer no Post; create can answer 409 `rows_claimed` / `rows_refused`, 400 `total_mismatch` (`derivedCents`, `typedCents`), 403 `manage_required`; the create takes up to about 20 s on the branch with 16 approvers (B6 lock and neutral panel are yours); `maxDuration = 60` is set.
- `getDonor` rows carry `sweptOn: string | null` (flip "…, not yet a Foundation gift" only when non-null). `CandidateTransactionRow.sweepLegTxnId` is there for the picker grouping.
- Lump route: `POST /api/admin/ledger/transactions` with a sweep-direction body is 400 `use_sweep_batch`; ux pass 1 removes the Sweep flow mode, `?sweepFrom=` and `sweep-prefill-launcher.tsx`. `correction-dialog-logic.ts` `sweepDeepLink` (and its test in `move-transaction-dialog.test.tsx`) is still present and is yours to replace with `sweepBuilderHref`.
- Importer scan stays at **five**; ux changes it to seven in the same change that adds each page import (B15), including the "named read exports only" assertion.

### Open items for the next agent
- Next: **ux-developer pass 1** (builder, closeout dialog, retirement of the lump UI). Nothing was left unsettled on the server side.
- E2E specs were edited, and their server behaviour live-checked by hand, but the Playwright files themselves were not run by me; qa should run `ledger-sweep-batch-api.spec.ts` and `ledger-approvals-history.spec.ts` on a quiet network.
- `after()` semantics for proposed B-202 remain unread (as the confirmation said).

## Phase 4 — ux-developer pass 1 (builder, review, closeout, launcher retirement) — 2026-10-19

**Owner:** ux-developer. **Status:** complete (pass 1 of 2). Worktree `/Users/cshenso/git/westervillelions/.claude/worktrees/itemized-sweep-inc2`, nothing committed. Branch `feature/itemized-sweep-2` (host `ep-calm-queen-amj2hzll-pooler...` compared), own server on :3104 (stopped by pid; :3000 untouched), no production access, no migration, no key, no `decisions.md`/`backlog.md`/`package.json` edit.

### Gates (tree: worktree, uncommitted, 2a + api pass + this pass)
- `pnpm exec tsc --noEmit`: clean (includes the two e2e specs).
- `pnpm lint`: 0 errors, the one known warning (`budget-context-panel.tsx:114`).
- `pnpm test`: 328 files, 5702 tests, green (5625 before this pass).
- `pnpm build:only`: passes; `/admin/ledger/sweep` is in the route list beside the five `sweep-batches` routes.
- Browser (Playwright against :3104, branch data): `e2e/ledger-sweep-builder.spec.ts` 10/10 green (select, review, post now; over-threshold goes pending; wrong amount blocks Post and shows the difference both ways; future date refused and `max` = today; prior-year gift asks for a reason; closeout mark and unmark; non-record user redirected; 360px no horizontal scroll on list and review; **S18 double click: exactly one create request from the page, "Sweep posted", one batch**; **B7 drift: a counterpart re-pointed between review and Post writes nothing and shows "The list changed while you were reviewing..."**, category restored in `finally`). `e2e/ledger-move-transaction.spec.ts` 15/15 green (the first attempt failed once on a cold-compile timeout waiting for the Move dialog, green on rerun). Screenshots at 360 and 1440 looked right; the dev hydration warning seen was the Playwright screenshot `caret-color` injection, not the page.
- Cleanup: every gift, copy, leg, closeout, audit row, queued approver mail and the fixture user removed; `ledger_transactions` back to **313**, Public donations mirror intact.

### Files created
- `src/app/(dashboard)/admin/ledger/sweep/page.tsx` (Server Component; `auth()` then `hasFeature(LEDGER_RECORD)`, redirect `/ledger`; `ledger.manage` read separately for prior-year and closeouts; reads only `listSweepCandidates`, `listSweepCloseouts`, `resolveSweepFunds`).
- `src/components/admin/ledger/sweep-batch-builder.tsx` (client: select, review, done states), `sweep-review-panel.tsx` (presentational review and form), `sweep-gift-list.tsx` (one list: cards below `xl`, a real `<table>` display from `xl`, a single set of elements so ids stay unique), `sweep-builder-logic.ts` (pure), `sweep-closeout-dialog.tsx`, `sweep-unmark-confirm.tsx`.
- Tests: `sweep-builder-logic.test.ts` (37), `sweep-batch-builder.test.tsx` (20), `sweep-closeout-dialog.test.tsx` (6), `src/lib/sweep-lump-retired.test.ts` (scan), `e2e/ledger-sweep-builder.spec.ts` (10).

### Files modified
- `[fundSlug]/page.tsx` (removed `?sweepFrom=`, the launcher, `sweepPrefill`, the cross-entity fetch and the unused imports; added a "Sweep to the Foundation" button for `ledger.record` on a Club `activity` register), `transaction-form.tsx` and `transaction-form-dialog.tsx` (sweep flow mode, `SweepPrefill`, `crossEntityContext`, `destCategoryId`, board minute and the sweep confirm removed; same-fund Transfer unchanged), `correction-dialog-logic.ts` (`sweepDeepLink` deleted), `move-transaction-dialog.tsx` ("Record sweep now" now `sweepBuilderHref([id])`), `move-transaction-dialog.test.tsx`, `transaction-actions.test.tsx` (native-dialog scan list), `ledger-sweep-consolidation.test.ts` (importers now 5 routes + the builder page = 6; new tests: builder page imports only the three named read exports; no client component imports the batch or link module or writes a pointer column), `e2e/ledger-move-transaction.spec.ts` (two tests re-aimed at the builder).
- **Deleted:** `sweep-prefill-launcher.tsx`.

### Tests by name (design section 4, pass 1)
`sweepTierLine` null for count 0 and all-refused; `reviewSignature`/`reviewDrifted` per field; `interpretCreateFailure` (201, `rows_claimed` with and without prior attempt, `rows_refused`, `total_mismatch`, `manage_required`, network, 500, every `SweepErrorCode` mapped); `canSubmitSweep`; `isFutureSweepDate`; **two synchronous Post calls send exactly one create** (controller test); select step, review step, all-refused renders none of tier/needs-reason/pending-posted text, `total_too_large` with no Post, custom `labels.activity` and no default, no native dialogs in `sweep-*`; closeout reason gating with `REASON_LIMITS`, every skip code, unmark confirm; lump-retired scan.

### Deviations from the design
1. **Post logic lives in a pure controller (`createSweepPostController`) in `sweep-builder-logic.ts`**, not only a `useRef` flag in the component: the lock, the B7 re-preview and the B6 unknown-outcome check run there, so the "two synchronous clicks" test runs in the repo's node-only vitest (no jsdom exists). The component holds the controller in a `useRef`. Absorbed.
2. **B6 verification result has three cases beyond the design's one**: all `already_swept` shows the neutral panel; nothing swept and nothing refused says "not recorded, you can post again" and re-arms; anything else says "could not confirm; check Approvals and the registers" with no retry. Absorbed (copy in `sweep-builder-logic.ts`).
3. The responsive list is one `<table>` using `block xl:table` display classes (one DOM, unique ids) rather than two renderings. Below `xl` browsers may drop table semantics; the cards are still labelled.
4. Added a small "Leave those gifts out" button on a review that contains refused rows (about 10 lines), and the select-all cap at `SWEEP_BATCH_MAX` with a note. Absorbed.
5. The builder links the done panel to the registers using fund slugs computed on the page (`getEntities`/`getFunds`); the Club register link has no `highlight` param. Absorbed.
6. Held-back and closeout checkboxes: closeout actions on eligible gifts use the same selection as the sweep (a second button), held-back gifts have their own selection (manage only).
7. `buildSweepMemo` and `getLatestFundMove` are now unused by any page; left exported (tests cover them). Dead code, not a feature; flag for the next code review.
8. A review of the unchanged `proxy` gate was not done: the page's own gate is `ledger.record`; if a record-only user lacks `ledger.view`, the derived `/admin/ledger` area rule may bounce them before the page. qa to confirm with a record-only persona.
Nothing needed Phase 3 or a new API.

### Not settled / not done
- Record-only (no manage) persona and the prior-year `manage_required` held-back copy were not driven in the browser (no such role fixture; covered by unit tests and the 2a API spec). qa should click it.
- S19 timing (Post to response for a 16-approver pending create) not measured; the e2e pending post completed well inside the 90 s bound.
- Expect the plan's Approvals "approvals/page.tsx" import to take the importer count to seven in pass 2.

### Notes for pass 2
- The consolidation importer test has `READ_PAGES = [builder page]`; add `approvals/page.tsx` there and its named-exports assertion (`getSweepBatchDetail` only), and change the count comment.
- `sweepBuilderHref` is the one deep-link builder; the donor page and register chips may link `/admin/ledger/sweep` only through it.
- The builder's done panel and the register button already point at `/admin/ledger/approvals?txn=<legId>`; the batch dialog (pass 2) can reuse `formatSweepMoney`/`formatSweepDate` from `sweep-builder-logic.ts` or move them to a shared file.
- `transaction-actions.test.tsx` native-dialog scan lists my two new files; add the pass-2 dialog files there.
- New copy for the Lions Club to refine: the tier/status lines in `sweepTierLine`, `describeFoundationReceipt`, the three outcome messages and the done-panel text (all in `sweep-builder-logic.ts` and `sweep-batch-builder.tsx`), "Mark as already handled" wording and the unmark confirmation.
- Next agent: ux-developer pass 2, then qa.

## Phase 4 — ux-developer pass 2 (Approvals, chips, void, match, donor, guide, sentence flips) — 2026-10-19

**Owner:** ux-developer. **Status:** complete (pass 2 of 2; Phase 4 done, next qa). Worktree `.claude/worktrees/itemized-sweep-inc2`, nothing committed. Branch `feature/itemized-sweep-2` (host `ep-calm-queen-amj2hzll-pooler...` compared before every run), own server on :3105 (stopped by pid; :3000 untouched), no production access, no migration, no key, no `decisions.md`/`backlog.md`/`package.json` edit.

### Gates (tree: worktree, uncommitted, 2a + api pass + pass 1 + this pass)
- `pnpm exec tsc --noEmit`: clean (includes the e2e specs).
- `pnpm lint`: 0 errors, the one known warning (`budget-context-panel.tsx:114`).
- `pnpm test`: 332 files, 5773 tests, green (5702 before this pass).
- `pnpm build:only`: passes.
- Browser (Playwright against :3105, branch data), all run with the host compared:
  - New `e2e/ledger-sweep-batch-ui.spec.ts`: **8/8** (one batch row at 1280, one card at 1279 and 360, summary only with no fixture party or memo in the text; a second user approves with the whole-batch wording; another rejects and the gifts are freed; chips on the leg, the source and the Foundation copy with Edit/Delete/Split/Move absent and the Batch dialog open, "Approved by the board" with no Void; void of a posted batch with the `reconciled` refusal shown first and then a successful void; "Match this batch" picks the right group among two batches on the same account and the match commits; donor-page labels; guide section and no lump wording on the guide or category screen; 360px no horizontal scroll on Approvals and in the dialog).
  - `ledger-sweep-builder.spec.ts` 10/10 (pass 1, no regression). `ledger-approvals-mobile.spec.ts` 11/11. `ledger-category-mirror.spec.ts` and `ledger-move-transaction.spec.ts` green (one flaky first attempt each, green on retry). `ledger-approvals-history.spec.ts` and `ledger-approvals-cosign.spec.ts`: 80 passed, with the failures explained below.
  - **Not green, not from this diff:** (1) `ledger-approvals-history.spec.ts:1022` hard-codes `localhost:3000` (known, N8), so it fails on any other port; (2) `ledger-approvals-cosign.spec.ts` L10 (20 x 20 refusals) exceeds its 120 s test timeout against Neon from this machine ("Target page, context or browser has been closed"); (3) `ledger-sweep-batch-api.spec.ts:504` (api pass, not run by the api-developer) answers 400 where it expects 200: the preview sends `bankAmountCents` = the derived total, which is above INT4, so the parser answers `invalid_amount`; send a small `bankAmountCents` in that test (a spec bug, the route behaviour is the intended one). Several first attempts also died on `read ECONNRESET` from the pooled Neon host (sign-in and cleanup queries); all of those passed on a rerun.
- Cleanup: every fixture, the QATEST donor, sessions, copies, legs, audit rows and 16 blocked approver mails removed; `ledger_transactions` back to **313**, no QATEST rows, no sweep mails (the one `qa-reset-target-...@example.invalid` user pre-dates this pass).

### Files created
- `src/components/admin/ledger/sweep-batch-summary.tsx` (+ test): one summary for the Approvals card, the table row and the dialog; props are a `Pick` of `SweepBatchDetail`, nothing about a person.
- `sweep-batch-dialog.tsx`, `sweep-batch-dialog-logic.ts` (+ `sweep-batch-dialog.test.tsx`): the one dialog (GETs the detail on open; `LedgerDialogShell` + `CorrectionReasonField`; Void for a manager on a posted batch; every `SweepVoidBlock` renders message and next step).
- `sweep-batch-button.tsx` (the "Batch" button + dialog), `sweep-row-chip.tsx` (the chip), `sweep-row-controls.ts` (+ test).
- `reconciliation-sweep-groups.ts` (+ test), `guide/itemized-sweep-section.tsx`, `e2e/ledger-sweep-batch-ui.spec.ts`.

### Files modified
- Approvals: `approvals/page.tsx` (reads `getSweepBatchDetail` per pending batch row only; passes `batchCount`/`batch`), `approval-card.tsx`, `approval-actions.tsx`, `approve-dialog.tsx`, `reject-dialog.tsx`, `approval-dialog-logic.ts` (`describeBatchDecision`; `approvalFailureAction` consumes a 400 `decide_the_batch` via `isDecideTheBatch`), `approval-history.tsx` (`batchBadgeText`, "Batch of N gifts").
- Register: `[fundSlug]/page.tsx` (one `listSweepBadges` read, labels from `getFundLabels()`; chip in the party cell for every viewer; donor controls hidden on a claimed source), `transaction-actions.tsx` (`sweepBadge`/`fundLabels`; hides Edit/Correct/Split/Move/Delete and the lock label for a sweep row, shows Batch).
- `reconciliation-match-picker.tsx` (24 added lines), donor page and `donor-detail-client.tsx` (`labels`, `donorRowSweepLine`), guide `page.tsx`, `books-register-section.tsx`, `zeffy-fund-routing-section.tsx`, `ledger-category-mirror.ts` (`LUMP_SWEEP_NOTE` replaced by `SWEEP_COPY_NOTE`; two "stays" sentences), `category-mirror-dialog.tsx`.
- Tests/pins: `approval-dialog-logic.test.ts`, `approval-actions.test.tsx`, `approval-history.test.tsx`, `transaction-actions.test.tsx` (new describe + native-dialog scan list), `reconciliation-match-picker.test.tsx`, `donor-detail-client.test.tsx`, `guide/treasury-guide-labels.test.tsx`, `ledger-category-mirror.test.ts`, `foundation-bound-hint.test.tsx`, `src/lib/sweep-lump-retired.test.ts` (no `LUMP_SWEEP_NOTE`/"lump sweep"/"one lump amount" in non-test source), `src/lib/ledger-sweep-consolidation.test.ts` (importers now exactly **seven**; Approvals page imports only `getSweepBatchDetail`, keeps `auth()` before `hasFeature()`, mounts the shared card and actions; register/donor pages never import the batch module), `e2e/ledger-category-mirror.spec.ts`.

### Tests by name (design section 4, pass 2)
`sweep-batch-summary.test.tsx` (card and row render the same fields; no party/memo/donor through a cast); `approval-actions.test.tsx` (batch card shows the summary once, falls back to the generated memo, dialogs take `batchCount`); `approval-dialog-logic.test.ts` (`describeBatchDecision` by verb and count; `decide_the_batch` handled); `approval-history.test.tsx` (batch badge); consolidation scan (Approvals page); `sweep-batch-dialog.test.tsx` (loading, error, pending, posted, approved, rejected, reconciled, Void visible only to `canManage` on a posted batch, reason gating, **each of the ten `SweepVoidBlock` codes renders message and next step**, stale states ask for a refresh); `sweep-row-controls.test.ts` and `transaction-actions.test.tsx` (leg, copy and source hide the four actions; plain row unchanged; a copy keeps donor controls); `reconciliation-sweep-groups.test.ts` and picker wiring tests; `donor-detail-client.test.tsx` (three labels, total once); `treasury-guide-labels.test.tsx` (new section with a custom name, flipped sentences gone); `ledger-category-mirror.test.ts`/`foundation-bound-hint.test.tsx` (new wording, no lump).

### Deviations from the design
1. **Approve/Reject trigger styling unchanged and no `reject-dialog` split:** the confirmation said `approve-dialog.tsx`/`reject-dialog.tsx`; both exist, both gained only a `batchCount` prop and one sentence. Absorbed.
2. **Chip is a presentational server-safe component in the party cell for every viewer; the Batch button lives in `TransactionActions` for recorders and beside the chip for readers** (two places mount one `SweepBatchButton`). The design said TransactionActions renders the chip; a view-only user would then never see it. About 15 lines. Absorbed.
3. **A claimed source also loses the donor link** (the server's `sweepEditAllowance` refuses every edit on a source; only a copy may change donor/memo). Design said only that a copy keeps it. Absorbed.
4. **Register labels come from `getFundLabels()`, not `buildFundLabels(allFunds)`:** the Foundation register's own funds hold no Public Funds row, so the register-local labels would have printed the default name on a copy chip if the fund is renamed. Absorbed.
5. **Void is offered only on a `posted` batch**; pending/approved/rejected show the carrier's `sweepBatchNextStep` instead of a button that can only be refused (the refusal copy is still rendered if a race produces it). Absorbed.
6. **"Match this batch" is a list of groups above the table (one button each), not group header rows inside the table**, to keep the picker diff small: 24 lines in the picker + 48 in the new file = 72, under the 100-line budget (no Inc 3 split). No "of M".
7. **The "deactivate tail" in `category-deactivate-confirm.tsx` needed no change:** it contains no lump-era sentence (its text is the counterpart-link line). The other four strings (`LUMP_SWEEP_NOTE`, both "stays" sentences, the dialog description) were flipped; the three e2e string pins were extended, not rewritten.
8. **Guide wording avoids the word "lump"** (it says "the earlier single-amount sweep, October 1, 2026") so S25's text search is clean; two unrelated hits remain in the guide ("Monday lump-payout reconciliation", budgeting "lump sum"). qa should search for "lump sweep"/"one lump amount", not bare "lump".
9. The donor-page source label uses `sweepChipLabel` with state `posted`, so it never carries a "(pending approval)" qualifier (the donor read has a date, not a state). Absorbed.
Nothing needed a new API, route, schema or flow.

### Notes for qa
- Run `ledger-sweep-batch-ui.spec.ts` first on a quiet network, then the touched specs listed above; expect occasional `ECONNRESET` first attempts on the pooled host (rerun). The three non-green items above are not regressions of this diff; fix #3 (the api spec's preview body) before relying on that file.
- Click through (S14 to S17, S23 to S25): Approvals at 1279 and 1280 (cards below, table from `xl`, Approve and Reject at both); the approver sees count, total, dates, categories, recorder and minute and **no gift list**; approve with the second user; the register chips; Batch dialog for a record-only and a manage user (Void absent for record-only); a `reconciled` refusal; an approved batch offers no Void; Match this batch with a partial group (one copy matched elsewhere selects N-1 and the sum gate blocks); donor page; guide section `#itemized-sweep`.
- Not driven in a browser: a record-only persona (no role fixture; unit-covered), the `decide_the_batch` toast (a copy id cannot be sent from the page), the `period_filed`/`prior_fiscal_year`/`receipt_sent`/`matched` void refusals (unit-covered with the carrier copy; the route cases are 2a's).
- New copy for the Lions Club to refine: the batch dialog (state labels, void warning and help), `describeBatchDecision`, the chip texts (carrier), the four flipped sentences, and the whole "Sweeping to the Foundation" guide section.
- `getSweepBatchDetail` runs once per pending batch row on Approvals (a handful of selects each); fine for a few batches, revisit if the board ever holds dozens pending.
- Next agent: qa (Phase 5).

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

**Orchestrator, 2026-10-19 (between pass 2 and qa):** the spec bug pass 2 found in `e2e/ledger-sweep-batch-api.spec.ts` ("canPost false above INT4_MAX" test, about line 504) is fixed in the worktree by the orchestrator: the preview call now sends `bankAmountCents: 1_000` instead of the derived 4,000,000,000-cent total, because the shared parser caps the typed amount at INT4 (`invalid_amount`, 400) before the evaluator runs, and `canPost` is computed from the derived total, not the typed one. Three lines (one value, two comment lines); no product code changed. qa runs the spec. Phase 5 for 2b spawned the same day.

# Phase 5 — Verification (qa) — 2026-10-19

**Owner:** qa
**Status:** complete (with named e2e deferrals)
**Tree state measured:** worktree `.claude/worktrees/itemized-sweep-inc2` (base 18b730f), everything uncommitted: 2a + api pass + ux pass 1 + ux pass 2 + the orchestrator's INT4 spec fix. Branch `feature/itemized-sweep-2` (host `ep-calm-queen-amj2hzll-pooler` compared before every write; no `PROD_DATABASE_URL`; `RESEND_API_KEY` empty). Own server on :3106, stopped by pid; :3000 never touched.

### Summary
**Verdict: PASS.** Every gate is green, every S-check S14 to S25 was run and passed (with two non-blocking observations recorded below), the new 2b specs and every 2a regression check pass, and I found no defect in the diff. The e2e sweep is **not complete**: `ledger-approvals-cosign.spec.ts` was not seen green past L10, two Google-button tests in `ledger-approvals-history.spec.ts` are the known B-198 `:3000` items, and some incidental-match specs were not run. Those are listed under "Not run here, deferred to the pre-push run on :3000" and are not counted as passes. One test defect (not product) was found in the api-developer's new spec and fixed by qa.

### Type check, lint, unit tests, build, migration
- `pnpm exec tsc --noEmit`: **PASS** (clean, includes the e2e specs).
- `pnpm lint`: **PASS**, 0 errors, 1 known warning (`budget-context-panel.tsx:114`).
- `pnpm test`: **PASS**, 332 files / 5773 tests, 5.0 s (the expected figure exactly). Coverage of the new modules: `ledger-sweep.ts` 97.3% statements, `ledger-sweep-batch.ts` 97.2%, `ledger-sweep-link.ts` 100%, `sweep-builder-logic.ts` 90.6%, `sweep-batch-summary.tsx` 100%. Client components (builder 29%, dialogs 20 to 31%) are low because vitest is node-only here (no jsdom); they are exercised by the Playwright specs below.
- `pnpm build:only`: **PASS**; route list has `/admin/ledger/sweep` and the five `sweep-batches` routes (`/api/admin/ledger/sweep-batches`, `/[legId]`, `/[legId]/void`, `/closeouts`, `/preview`), all dynamic.
- `pnpm db:migrate`: "Migrations completed successfully" (NOTICEs "already exists, skipping" only); `ls drizzle/migrations | tail -3` ends at `0116_ledger_sweep_batches.sql`; no new migration in 2b.

### Audit of the named tests and scans
Every file the confirmation names exists and runs (all in the 332). One placement deviation, already disclosed by the api-developer: the `getDonor` `sweptOn` tests are in `ledger-queries.test.ts`, not `ledger-queries.donors.test.ts`. Scans confirmed present and green: fund-name literal scan; fund-kind badge scan; `sweep-lump-retired.test.ts` (launcher file gone; no `sweepFrom`/`SweepPrefill`/`sweepDeepLink`/`destCategoryId`; no `LUMP_SWEEP_NOTE`, "lump sweep" or "one lump amount" in non-test source); `ledger-sweep-consolidation.test.ts` (exactly seven importers of the batch module from `app/`: the five routes plus the builder and Approvals pages; the builder page imports only `listSweepCandidates`, `listSweepCloseouts`, `resolveSweepFunds`; the Approvals page only `getSweepBatchDetail`; no client component imports the batch or link module; register and donor pages read badges through the link module only; `maxDuration = 60` on the create route only, notifier awaited); `admin-page-feature-gates`; `default-role-bundles`. I re-derived by grep, independent of the tests: importers of `ledger-sweep-batch` are exactly those seven (plus the carrier's docblock mention); `getRecentDecisions`/`resolveApprovalTarget` are imported only by the Approvals page; `recordLedgerAudit` is imported by no `members`/`components` file; the diff of the PATCH, DELETE and split routes adds guards and removes no `approvedAt` guard. Picker budget: 24 lines in the picker plus a 48-line file = 72 (under 100).

### Live checks S14 to S25 (branch, :3106; one-line results; detail in the parent's live-checks table)
| Id | Result |
|----|--------|
| S14 | PASS. 13 of 13 steps in the browser as a `treasurer`-role user and a `board_member` approver, no API shortcuts: build, post pending (15.7 s), one batch row without party/memo, approve, chips on both registers with Edit/Delete/Split/Move hidden (plain row keeps Edit), Batch dialog, under-threshold post, void as manage, closeout mark and unmark. |
| S15 | PASS. Lump route 5/5 `use_sweep_batch`, 0 rows (313 before and after); same-fund Transfer 201; no "Sweep to Foundation" in the form; `?sweepFrom=` is the plain register; a SQL-seeded historical pair was approved (both legs posted). |
| S16 | PASS with a note. No horizontal scroll on any of the nine 360px surfaces; the three new dialogs have all controls at 44px or more and stay inside the viewport. Smaller targets: shared admin chrome, the back link and the inline "Open Approvals" link (19px), the shared ConfirmDialog buttons (38px). |
| S17 | PASS. Table at 1280 (Approve worked), cards at 1279 (Reject worked). |
| S18 | PASS. API races 10/10 (201+409, one leg); page double click 10/10 (1 request, 1 batch, no failure text); lost-response replay 3/3 (neutral panel, one leg, no retry). |
| S19 | 11.7, 12.1, 10.9 s API; 15.7 s through the page; no timeout. Production not measured. |
| S20 | PASS 5/5 (0 rows, changed list shown). |
| S21 | PASS. `future_date` from preview and create, input `max`, past date posts, `gift_after_sweep` for a date before the gifts; Eastern boundary proven through the real parser (live server clock cannot be moved). |
| S22 | PASS with an observation. Overflow shows `total_too_large`, Post disabled; all-refused prints no tier, needs-reason or pending/posted line. |
| S23 | PASS. 0 of 3 PII strings in the detail JSON, Approvals text and HTML, or the dialog; approver redirected from the builder; record user 403 on void and closeouts, no Void button; 51 approver mails all blocked, none leaking. |
| S24 | PASS. Whole batch selects the group and commits through the match route; the partial group lists "Sweep of 2 gifts" and the sum gate leaves Match selected disabled; 72 lines. |
| S25 | PASS. Donor labels and total (copy counted once), no "lump sweep"/"one lump amount" anywhere. |

Also run, from the scope: **record-only persona** (temporary roles `ledger.view`+`ledger.record` and `ledger.record` alone): the proxy does **not** bounce either user (`/admin/ledger`, `/admin/ledger/sweep`, `/admin/ledger/activity` all 200 and stay), the builder loads, the prior-year gift is held back with "Sweeping a gift from an earlier fiscal year needs the Manage Ledger permission.", preview says tier `manage`, `canPost false`, create is 403 `manage_required`, no closeout controls, no Void in the dialog, void and closeouts 403. **`decide_the_batch` toast**: an Approve request rewritten to a copy id showed "This gift is part of a sweep batch. Approve or reject the whole batch from its transfer entry.", dialog closed, nothing approved. **Every void refusal**: `pending_use_reject`, `already_rejected`, `approved` through the API; `reconciled`, `matched`, `receipt_sent`, `period_filed`, `prior_fiscal_year` through the open dialog (message plus next step rendered; the Foundation IRS FY2026 filing was set to `filed` and restored to `not_started`); a state-following check of the leg's edit message in all four states (posted "Void it...", pending "Reject it from Approvals...", approved "The board approved it...", rejected "It was rejected and is kept...").

### 2a regression
- `e2e/ledger-sweep-batch-api.spec.ts`: **12/12 green** (11 on the second attempt, the failed one on a spec defect fixed below, plus the first attempt's void test that hit a Neon `ETIMEDOUT` and passed on rerun).
- S3 same-source race over HTTP: 10/10 one 201 plus one 409 `rows_claimed` (S18 above). S5 lock codes: leg `sweep_batch`, copy `swept_copy` (memo still 200), source `swept_source`, leg/source DELETE 403, rejected source freed (amount PATCH 200, DELETE 409 `sweep_history`), in all four batch states.
- Global invariants over every row in the branch after the runs: 0 sources with more than one live copy; 0 copies with `approved_at`; 0 batches with mixed statuses; approver mails PII-free and `blocked_non_production`.

### End-to-end (one worker, :3106). Classification of every non-green attempt
| Spec | Result | Classification |
|------|--------|----------------|
| `ledger-sweep-batch-api` | 12/12 | first attempt: 1 test failed on **a spec defect in this diff** (see Defects); void test ETIMEDOUT then passed (Neon) |
| `ledger-sweep-builder` (new) | 10/10 | pass first time |
| `ledger-sweep-batch-ui` (new) | 8/8 | pass first time |
| `ledger-approvals-mobile` | 12/12 | pass |
| `ledger-category-mirror` | 7/7 | two attempts failed at the 15 s credentials sign-in (a dead pooled connection, `POST /api/auth/callback/credentials` 15.0 s); green after restarting my server: **Neon connectivity** |
| `ledger-move-transaction` | 15/15 | first attempt failed one 5 s visibility check, second a sign-in stall; green on the third: **Neon connectivity** |
| `ledger-category-management` | 15/15 | pass |
| `ledger-search` | 14/14 | pass |
| `acknowledgment-letter-generation` | 4/4 | pass |
| `ack-queue-workflow` | 4/4 | pass |
| `admin-ledger-budget-committee-gate` | 8/8 | pass |
| `prior-year-cause-line-reconcile` | 1/1 | pass |
| `transaction-budget-line-link` | 9/9 | pass |
| `ledger-reimbursement-correct` | 7/7 | first attempt a 500 on a dead connection; **never green in 2a, green now** |
| `ledger-approvals-history` | 52 passed, 2 not green | five attempts ended on Neon (ETIMEDOUT in the spec's own insert, two sign-in stalls, a 30 s `beforeAll` timeout caused by an **orphaned Postgres backend, pid 764, stuck 8 minutes in ClientRead on a half-sent insert from a killed client**, terminated by qa, then an ECONNRESET); the sixth run passed 51 and failed only the `/signin` Google-button test, and the seventh (`--grep-invert "Google round trip itself is manual"`) passed 52/52. The two Google-button tests (`/signin` and its `/register` twin) hard-code `localhost:3000`: **pre-existing, B-198**, not seen green here. |
| `ledger-approvals-cosign` | 31 passed, 1 failed, 38 not run | L10 (20 x 20 refusals) exceeds its in-file 120 s `test.setTimeout`, which the CLI `--timeout` does not override; serial mode then skipped the other 38. **Pre-existing (named in the brief), not seen green.** |

### Not run here, deferred to the pre-push run on :3000 (time budget; none of these is claimed as a pass)
- `ledger-approvals-cosign.spec.ts` from L10 onward (38 tests not run, L10 itself timed out at its 120 s in-file budget). 2a already could not see these 23+ tests green; the 2b diff touched the approval dialogs and the decision error handling, so this file matters at pre-push.
- The two Google-button tests in `ledger-approvals-history.spec.ts` (B-198, hard-coded `:3000`).
- Not run at all: `budgeting-restructure`, `budgeting-overview-restructure`, `budget-star-notes`, `admin-email-queue-access` (the Email Queue gate parity), and the incidental keyword matches (`club-files-flow`, `minutes-*`, `proposals-permission-boundary`, `social-requests-flow`, `write-in-signups`, `admin-*-notetaker-gate`); none touches a file in this diff except the email-queue gate, which this diff does not change.
- Not verified at all: an 8 p.m. Eastern boundary on a live server (the parser was checked, not a moved clock); S19 against production (unmeasured); a real browser click of `Re-link donor` on a claimed source beyond opening the dialog; whether the `ack_letter_template_updated` rows the acknowledgment spec writes left the template as found (their audit rows were removed with the other test rows; the template value itself was not re-read).

### Feature-Gate Audit
Read from the files, not inferred from tests.

| Route, page or action | `auth()` | `hasFeature(...)` | Key |
|-----------------------|----------|-------------------|-----|
| `GET /admin/ledger/sweep` (page, new) | yes, first statement, redirect `/signin` | yes | `LEDGER_RECORD` (redirect `/admin/ledger`); `LEDGER_MANAGE` read separately for prior-year and closeouts |
| `GET /admin/ledger/approvals` (page, changed) | yes | yes | `LEDGER_APPROVE` (unchanged); `getSweepBatchDetail` is called only per pending batch row |
| `POST …/sweep-batches/preview` | yes (`authorizeSweep`) | yes | `LEDGER_RECORD` |
| `POST …/sweep-batches` | yes | yes | `LEDGER_RECORD`; manage tier computed server-side (403 `manage_required` observed) |
| `GET …/sweep-batches/[legId]` | yes | yes | any of `LEDGER_VIEW/RECORD/MANAGE/APPROVE` (approver 200 observed; no party/memo/donor key) |
| `POST …/[legId]/void` | yes | yes | `LEDGER_MANAGE` (record+view user 403 observed) |
| `POST …/closeouts` | yes | yes | `LEDGER_MANAGE` (403 observed) |
| `POST /api/admin/ledger/transactions` (lump refusal) | yes | yes | `LEDGER_RECORD` (unchanged; refusal comes after the gates) |
| `PATCH`/`DELETE …/transactions/[id]`, `…/split`, `…/acknowledge` (changed) | yes | yes | `LEDGER_RECORD` (unchanged) |
| `[fundSlug]` register page, donor page (changed: chips, labels) | yes | yes | unchanged; the chip carries a date, state and count only |
No new `FEATURES` key and no migration. Other invariants: no `console.log` or native dialog in any new or changed non-test file; the only addresses in the diff and untracked files are `example.invalid`; no phone shapes; no personal-mail domains; "Emailed", never "Delivered" (the guide says so); fund names appear only through `FundLabels` (scan green; the page showed the stored name "Activity Fund").

### Defects found
**None in the product diff.** Found and fixed by qa (a test defect, not product): `e2e/ledger-sweep-batch-api.spec.ts`, the api-developer's test "should return the gift-date span on the detail and queue a blocked approval email…", asserted that the detail JSON and the email HTML do not contain the fixture tag, but the detail legitimately returns the typed board minute, which carries the tag (the same mistake 2a's qa fixed in its own spec). qa narrowed the assertions to the gift party and memo strings (`${TAG} Donor`, `${TAG} gift`) and watched it pass. The orchestrator's INT4 fix passes.

**Observations (non-blocking; for the analyst's Phase 6 and a backlog decision):**
1. The donor page still shows "Re-link donor" on a claimed **source** row; the server answers 403 `swept_source` ("This gift was swept to the Foundation and cannot be edited. Void the sweep batch first."), so the control is dead. B11 hid the register controls but the donor page was not in its scope. Owner if wanted: ux-developer.
2. For a preview over `INT4_MAX` the page prints the `total_too_large` copy and disables Post (B1 says "offers no Post"), but still prints "over the approval threshold... goes to the board" (B2 prints the tier line whenever count > 0). Contradictory wording on a state that cannot post.
3. The donor page's DONATIONS tile counts a swept gift twice (source and copy) while TOTAL GIVING counts it once.
4. Inline "Open Approvals" link on the builder is 19px tall; the shared ConfirmDialog buttons are 38px (shared component, not this diff).
5. The register's 44 sub-44px controls and the sidebar chrome are pre-existing.
6. Neon from this machine kept resetting (15 s credentials stalls, `ETIMEDOUT`/`ECONNRESET` in the app and in specs, an orphaned backend); every such failure above was rerun and classified only after the rerun passed.

### Branch hygiene
Removed everything qa created: all `QA2B-LIVE` gifts, copies, legs, closeouts, reconciliation sessions/lines/matches, audit rows, queued approver mails and "New portal user" notices created in this window, the four fixture users `qa2b-*@example.invalid` and the temporary roles `qa2b_record_view` and `qa2b_record_bare` with their bindings, and the residue the e2e specs left when their `afterAll` hooks died (two `QA E2E Letter/Ack Payer` income rows with their acknowledgments, four `QA E2E Mirror/Open Balance` categories, the legs of two orphaned batches). The Foundation IRS FY2026 filing is back to `not_started` and the Public donations / White Cane counterparts are intact. **Row counts equal the baseline in all ten tables:** `ledger_transactions` 313, `ledger_audit_log` 1054, `email_queue` 1478, `ledger_txn_cosigns` 0, `ledger_acknowledgments` 37, `ledger_sweep_closeouts` 0, `ledger_filings` 9, `financial_report_sends` 0, `ledger_categories` 123, `ledger_reconciliation_matches` 0. The :3106 server (pids 50742, 50744) is stopped and nothing listens on it; `test-results/` removed; the temporary spec `e2e/_qa2b-live.spec.ts` deleted. The only file qa edited in the tree is `e2e/ledger-sweep-batch-api.spec.ts` (the assertion fix). Nothing committed.

### Outputs
- This section; S14 to S25 rows in the parent's live-checks table; the Per-Phase Status row.
- `e2e/ledger-sweep-batch-api.spec.ts` (assertion fix only).

### Proposed backlog text (orchestrator files; not filed by qa)
- **B-204 (small).** Hide "Re-link donor" on the donor page for a claimed swept source; give the DONATIONS tile one count per swept gift.
- **B-205 (small).** On `total_too_large`, hide the tier line and the Post button entirely, and give the builder's "Open Approvals" link and the shared ConfirmDialog buttons a 44px tap height.
- **B-198 (existing).** Add: `ledger-approvals-cosign` L10 sets its own 120 s `test.setTimeout`, so a run-time `--timeout` does not help; raise it in the file.

### Open questions / handoff notes
- **Next agent: analyst for Phase 6** (one verdict for B-172 against the Phase 1 intent). No FAIL, nothing returns to an implementer.
- **Orchestrator before the push:** run the deferred list above on :3000 on a quiet network (cosign from L10, the two Google-button tests, the four unrun budgeting/email-queue specs), file B-204/B-205, and note that the lump closure and the builder must ship together with 2a (they cannot be split).
- Copy for the club to refine is already listed in the ux pass notes; qa observed it and has no objection beyond observation 2.

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Mobile (360px): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]

---

# Pre-push record (orchestrator, 2026-10-19; Increments 2a + 2b together as v1.100.0)

**Tree:** the worktree's full diff (`git add -A; git diff --cached --binary`, 115 paths) applied into the main tree with `git apply` on top of 18b730f, uncommitted; the main tree's untracked docs (four B-172 work-logs, `docs/release-notes/v1.100.md`) and modified docs (`decisions.md`, `backlog.md`) ride with it. Two test-only edits after Phase 5: qa narrowed one assertion in `e2e/ledger-sweep-batch-api.spec.ts` (the board minute legitimately carries the fixture tag); the orchestrator gave the co-sign spec's L10 test a 300 s `test.setTimeout` (B-198 addendum). No product code changed after the 2b Phase 5 PASS.

| Gate | Result |
|---|---|
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm lint` | PASS (0 errors; the known `budget-context-panel.tsx:114` warning) |
| `pnpm test` | PASS, 332 files / 5773 tests |
| `pnpm build:only` | PASS; route list carries `/admin/ledger/sweep` and the five `/api/admin/ledger/sweep-batches*` routes |
| `pnpm db:migrate` | replays clean; tail `0116`; the one seed (`Transfer to Foundation`) is `WHERE NOT EXISTS`-guarded |
| `pnpm audit --prod --audit-level=high` | PASS (exit 0). Advisory below the gate: moderate `uuid` (buffer bounds, patched ≥ 11.1.1), low `@babel/core` (sourceMappingURL read, patched ≥ 7.29.6); both transitive, carried to the next dependencies review |
| Personal-data sweep (`git grep --untracked`, exit checked) | clean: the only address hits are `example.*`; no phone or street hits outside the known drop-off directory; no `.env*` tracked |
| Release notes / version | `docs/release-notes/v1.100.md` (first-production-batch checklist included); `package.json` 1.100.0 |
| DECISION-126 | Resolved (tech-lead, 2026-10-19); DECISION-127 cross-reference updated |
| Housekeeping | no new `console.log` (the one hit is the pre-existing dev-mode line in the email-queue retry route); no native dialogs; no new env vars |

**e2e on `:3000` (main tree, dev database `ep-orange-sunset…`, one worker).** The first attempt hit a foreign app: another process held `:3000` when the server started, Next fell back to `:3001`, and every spec failed at sign-in with a Google OAuth redirect (`client_id=undefined`). Restarted on `:3000`, verified the page, reran. Results on the combined tree:
- Green in full: `ledger-approvals-history` (54/54, both Google-button tests included), `budgeting-overview-restructure` (6/6), `budget-star-notes` (6/6), `admin-email-queue-access` (7/7). Earlier in the day, on the worktree: `ledger-sweep-batch-api` (12/12), `ledger-sweep-builder` (10/10), `ledger-sweep-batch-ui` (8/8) and the other thirteen ledger specs qa listed.
- `ledger-approvals-cosign`: tests 1–50 seen green across three serial runs (L10 passes with the 300 s budget); each run ended on a new Neon failure (`read ECONNRESET`, `ETIMEDOUT`; the Approvals page once answered 500 after 75 s). The concurrency block from L8 onward was rerun last; see the line below.
- `budgeting-restructure`: tests 1–13 seen green across runs; two 15 s sign-in stalls and one 10 s UI wait after a 200 create, none a wrong result; tests 14–15 rerun last; see the line below.
- Connectivity from this machine to Neon was poor all day (qa recorded the same in both Phase 5 reports).

**Final e2e state (17:05).** `budgeting-restructure` 15/15 green on its fourth run. `ledger-approvals-cosign`: tests 1–50 green on this tree across runs; the concurrency block from L8 onward and the five describes after it (20 tests) were **not seen green here** after eight attempts. Every stop was on the runner's side of the wire: `read ECONNRESET` / `read ETIMEDOUT` on the test's own seed, drop and count queries (L8 alone makes about 240 direct Neon round trips), two 30 s sign-in stalls in a `beforeAll`, and once a 500 that the co-sign route logged as "Error adding co-sign: read ECONNRESET" while its twin request got its 201. Server-side evidence is clean throughout: every co-sign request in the dev log has a response in 0.7–1.7 s, `pg_stat_activity` showed no open transaction or lock wait, and the two "200" lines on co-sign POSTs are Playwright aborting the request at the test deadline (both arrived milliseconds before the kill). Test-file edits made for this: L10 `test.setTimeout(300_000)`, L8 `test.setTimeout(600_000)` (B-198). Also found: `pnpm test:e2e -- --grep …` does not reach Playwright (the script's `--` swallows it); invoke `pnpm exec dotenv -e .env.local -- playwright test … --grep …` directly. The 20 unseen tests cover co-sign races that qa drove by hand over HTTP in the 2a Phase 5 (20/20 plain, 10/10 batch, clean); they stay a B-198 item to run from a runner near the database.

**Not verified here:** production latency of a pending create (S19; 10.9–15.7 s on the branch), the live 8 p.m. Eastern boundary.

**Push:** awaiting the user's approval. Commit plan: one release commit (code + migration 0116 + tests + release notes + version + the B-172 docs), then after the deploy a docs commit with the deploy record. After the push: delete worktree `.claude/worktrees/itemized-sweep-inc2` and its branch, and Neon branch `feature/itemized-sweep-2` (`br-crimson-wind-amkor5ip`).

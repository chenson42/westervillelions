# Zeffy Batch Reconciliation (one deposit ↔ many dues rows) — Work Log

> **Slug:** `2026-07-28-zeffy-batch-reconciliation`
> **Surface:** (dashboard) admin — The Ledger reconciliation workbench
> **Permission(s):** existing `ledger.record` (reconcile) / `ledger.manage` (reopen) expected — confirm Phase 1/3
> **Estimated complexity:** large (matching-grid UX + many-to-one match model + month-publish-gate interaction with deposits-in-transit)
> **Pipeline mode:** Full
> **Origin:** Real close-out blocker (2026-07-28). Admin/Club June can't close: Zeffy deposits member dues to the bank in weekly batches, so one $500 bank deposit (6/29) represents ~6 individual auto-posted dues rows, and the workbench only matches one bank line ↔ one ledger transaction today ("batch mode … coming soon" per the guide's §10). Related: the monthly-report month-gate treats the not-yet-remitted in-transit dues as unreconciled and blocks the month.

## Context (must read before design)

- **The workbench today** (`src/app/(dashboard)/admin/ledger/reconciliation/…`, `src/lib/reconciliation-queries.ts`, guide `reconciliation-section.tsx`): open session → upload bank CSV → match each bank line to ONE ledger transaction (or create new) → tie out (opening + cleared = closing, hard gate) → close → reopen. Matching is manual, one-to-one. `ledger_reconciliation_sessions`, `ledger_bank_lines`, `ledger_reconciliation_matches`, `ledger_transactions.reconciled_session_id`.
- **The Zeffy dues shape:** `payment_method='zeffy'` income rows, one per member, auto-posted (`dues_payment_id`, `bank_account_id=null`, `reconciled=false`) on the PAY date; Zeffy remits a weekly lump to the bank. Verified live 2026-07-28: the 6/29 $500 Chase deposit corresponds to 5 rows dated 6/24 ($400) + one $100 from 6/25 = $500 exactly; the remaining ~$450 of 6/25–6/27 rows + a dues-by-check are the NEXT (July) deposit (deposits-in-transit).
- **The month-gate** (`isMonthGatedForEntity`/`getLatestOpenMonthForEntity` in `src/lib/financial-report-queries.ts`): v1.42.1 excluded outstanding checks (`check`+`expense`) from the gate. In-transit DEPOSITS (unreconciled income recorded this month, cleared next month) are the mirror-image case and still block — so even after batch-matching June's cleared $500, the ~$450 in-transit June rows keep June gated. This feature must resolve that (session-aware gate, or an in-transit-deposit carve-out) so a properly-reconciled month publishes.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | complete | READY WITH NOTES | 2026-07-28 |
| 2 — Architectural review | architect | complete | Approved with suggestions | 2026-07-28 |
| 3 — Technical design | tech-lead | complete | Design complete, implementer named | 2026-07-28 |
| 4 — Implementation (API) | api-developer | complete | server contract shipped, ux-developer next | 2026-07-28 |
| 4 — Implementation (UI) | ux-developer | complete | batch UI shipped, qa next | 2026-07-28 |
| 5 — Verification | qa | complete | PASS | 2026-07-28 |
| 6 — Shipped vs intent | analyst | complete | SHIP WITH NOTES | 2026-07-28 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Let the treasurer select a SET of unreconciled ledger transactions — income or expense — whose amounts sum to one bank-statement line, and commit them as a single match: a general N-ledger-rows-to-1-bank-line capability, not a Zeffy feature. The data model (`ledger_reconciliation_matches.bank_line_id` is deliberately non-unique, DECISION-036) already anticipated this generically; what's missing is the multi-select UX, server-side batch validation, a fix to two read queries that will silently corrupt the tie-out sum once ANY batch match exists (Zeffy or otherwise), and a month-gate carve-out so a fully-reconciled-as-possible month can still publish while its next Zeffy deposit is legitimately in transit.

## Scope Decision: General Capability, Not Zeffy-Specific (treasurer-directed, binding)

The treasurer has explicitly decided this ships as a **general** "reconcile one bank-statement line against a set of ledger transactions that sum to it" capability — this is no longer an open question to weigh (formerly Q6); it is a requirement. Zeffy's weekly dues batch is the first and most frequent consumer and is used as the worked example throughout this document because it's the real, verified 2026-07-28 blocker, but the same mechanism must serve, unmodified:

- **Fundraiser deposits that bundle many recorded items** — Rudolph Run/Winterfest, Pancake Breakfast, tail-twisting, restaurant-fundraiser payouts, each of which may post as several ledger rows that land in the bank as one lump sum.
- **The mirror case on the expense side** — one bank DEBIT that represents several recorded expense rows (a split purchase across categories, e.g., one card swipe on a shopping run that the books recorded as three separate category-coded expense transactions).
- **Any other case where the bank shows one line but the books recorded several.**

Practical implications for tech-lead, carried through the rest of this document:
- The candidate list (`getCandidateTransactionsForMatching()`) is **already generic today** — it filters only on `bankAccountId`/`status='posted'`/`reconciled=false`/not-already-matched, with no `flow` or `paymentMethod` narrowing. That's correct and must stay that way: it already surfaces income AND expense rows alike, so no query change is needed to support the expense-debit mirror case — only the UI's selection/commit mechanism needs to generalize.
- A Zeffy-specific convenience (e.g., a quick filter chip or default sort that clusters same-payment-method rows together) is fine as a UX affordance layered on top, but must never be the underlying match mechanism or a hard filter that would hide a non-Zeffy candidate row from the picker.
- The signed-amount convention already in the picker (`signedAmount()`: expense displays negative, income positive) already generalizes correctly to a debit bank line (negative `amountCents`) matched against a set of expense rows — the running "selected sum vs. bank-line amount" indicator works the same whether the bank line is a credit or a debit, since bank-line amounts are already signed in `ledger_bank_lines.amount_cents`.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`ledger.record`) | Open the match picker for one bank-statement line (unchanged entry point) | Per bank line, per session |
| Admin (`ledger.record`) | Multi-select several candidate ledger transactions (income or expense) in the picker | Per batch (e.g., once per weekly Zeffy deposit, once per bundled fundraiser deposit, once per split expense debit) |
| Admin (`ledger.record`) | Watch a running "selected sum vs. bank-line amount" indicator as they check/uncheck rows | Continuous, during selection |
| Admin (`ledger.record`) | Commit the batch match once the sum balances exactly | Once per bank line |
| Admin (`ledger.record`) | Unmatch one transaction out of an already-committed batch (fix a wrong pick without rebuilding the whole batch) | Occasional, error-recovery |
| Admin (`ledger.manage`) | Reopen a closed session to correct a bad batch match | Rare |
| Admin (`ledger.record`) | Close the reconciliation session once every line — including batch-matched ones — ties out | Per session |
| Signed-in member (read-only, indirect) | View the published monthly statement once the month-gate clears | Per month, passive |

No anonymous-visitor or access-pending surface is touched — this is entirely inside the existing admin-only `/admin/ledger/reconciliation` workbench, gated the same as today.

## Flows

The general capability is "select N ledger rows whose signed amounts sum to this bank line, commit the match." Flow 1 below uses the verified Zeffy deposit as the worked example, but the identical flow serves a bundled fundraiser deposit (several income rows → one credit line) or a split expense (several expense rows → one debit line) with zero mechanical difference — same picker, same running-sum indicator, same commit gate.

**Flow 1 — Batch-match a bank line against a set of ledger rows (worked example: the $500 Zeffy deposit):** entry: treasurer clicks "Match" on the $500 6/29 bank line in the session grid (same entry point as today's 1:1 flow) → picker dialog opens listing every unreconciled, unmatched posted transaction on that bank account — income AND expense alike, unfiltered by payment method, date, or week (same query as today; see Scope Decision above) → treasurer switches to multi-select and checks the 5×6/24 + 1×6/25 zeffy rows → a running "$500.00 of $500.00 — balanced" indicator updates live as rows are toggled → "Match selected" enables only once the selected sum equals the bank line's signed amount exactly → treasurer commits. **Outcome:** the bank-line row shows "Matched · 6 transactions," expandable to the underlying list; the session's cleared-total updates by the line's amount once (not 6×).
- Failure: selected sum ≠ bank-line amount → commit button stays disabled, delta shown ("$24.00 short" / "over by $12.00") — no accidental commit of an unbalanced batch.
- Failure: treasurer selects the wrong rows that happen to sum correctly (e.g., grabs next week's rows instead of this week's) → no system guard catches this (same human-judgment risk the existing 1:1 flow already accepts) — mitigated only by the picker surfacing party/date/amount so the treasurer can visually confirm the right week's rows, and by Flow 2 (per-row unmatch) making the mistake cheap to fix.
- Failure: network/API error mid-commit → toast error, dialog stays open with selections preserved (treasurer shouldn't have to re-check 6 boxes after a dropped request).

**Flow 2 — Undo one wrong pick inside a committed batch:** entry: treasurer expands "Matched · 6 transactions" on a bank line → sees the underlying transaction list → clicks "Unmatch" on the one wrong row → `<ConfirmDialog>` ("Unmatch this transaction? It returns to unmatched — you can re-match at any time.") → confirm. **Outcome:** that one transaction returns to the candidate pool; the other 5 stay matched to the line; the line's displayed count drops to "Matched · 5 transactions" and now shows an outstanding delta versus the bank amount (the line is no longer balanced until re-matched).
- Failure: session already closed → 409 "Reopen this session before changing matches," identical to today's single-match unmatch failure.

**Flow 3 — Close the session with a batch-matched line included:** entry: treasurer clicks "Close" once every in-period line (including the batched one) shows matched → tie-out sum must count the batch-matched line's bank amount exactly once, not once per matched transaction (see Gaps — this is a read-query bug, not a UX question) → balances → closes. **Outcome:** all matched transactions across every line, including all 6 batch members, flip `reconciled=true`/`reconciledSessionId`.
- Failure: unbalanced → same existing 400 "Does not balance" with the delta, no override (hard gate, per the 2026-07-21 decision already in force).

**Flow 4 — Monthly statement publish after batch-matching June's cleared deposit:** entry: a member (or the treasurer) views `/members/financial-reports/[entity]/2026-07` (June) after the treasurer has closed June's reconciliation session, including the batch-matched $500 → `isMonthGatedForEntity` re-evaluates → the remaining ~$450 of June-dated zeffy rows that clear in the *next* weekly deposit are still `reconciled=false` and dated ≤ June 30 → gate still returns `true` → June stays gated. **Outcome today (the actual blocker this feature is meant to fix, and which batch-matching ALONE does not fix):** the member-facing page still shows "Statement Not Ready Yet … the treasurer is still reconciling it," even though the treasurer has done everything reconcilable this cycle. This is Q4 below — resolving it is part of this feature's scope, not a side effect to hope for.
- Failure/gap: no microcopy differentiates "genuinely behind" from "in-transit, will clear next week" — out of scope to change wording in v1 (see Out of Scope), but the *gate logic* must change or the real-world blocker persists.

## Permissions

- **Permission(s):** No new `FEATURES` key. Existing `ledger.record` (`FEATURES.LEDGER_RECORD`) already gates both the match-create route (`POST .../match`) and the unmatch route (`DELETE .../match/[matchId]`) — batch matching is the same action at a different cardinality, not a new capability. Existing `ledger.manage` (`FEATURES.LEDGER_MANAGE`) continues to gate session reopen, unchanged.
- **Default roles:** Whatever already holds `ledger.record`/`ledger.manage` today (Treasurer + Admin roles per the existing bank-reconciliation feature) — no role-binding migration needed.

## Gaps the Request Didn't Address

- **The tie-out read queries will silently corrupt the close-gate arithmetic once a batch match exists — this must ship as part of Phase 3/4, not a follow-up.** `getTieOutAssembly()` (`src/lib/reconciliation-queries.ts`) LEFT JOINs bank lines to matches and pushes `row.amountCents` into `matchedLineAmountsCents` once per JOINED ROW. A bank line with 6 matches fans out to 6 rows, each pushing the line's full amount — inflating the "cleared" sum 6× and breaking the "opening + cleared = closing" invariant the close route hard-gates on. `getBankLinesForSession()` has the same fan-out and additionally its `matchedTransactionId: string | null` field is singular — for a batch-matched line it will silently show only the last-joined transaction and hide the other 5 from the UI entirely. Both must be rewritten to treat "matched" as a per-bank-line fact (dedupe/group by `bankLineId`) before summing or rendering. Flagging this prominently for tech-lead/database-admin/api-developer — it has zero blast radius today (no batch matches exist yet) but ships broken the moment this feature lands if untouched.
- **Server-side re-validation of the batch sum and each transaction's eligibility.** The UI's disabled-commit-button guard (Q2/Flow 1) is a client-side convenience only. A client can POST any `transactionIds` array directly to the match route. The batch-commit endpoint must, server-side, per id: re-check posted/unreconciled/same-bank-account/not-already-matched-elsewhere (the same 5 checks the existing single-match route already runs) AND re-verify the selected transactions sum to the bank line's amount exactly before inserting any match rows — atomically, in one `db.transaction()`, so a failure partway through never leaves a half-committed batch. This is exactly the kind of check the request's UX description doesn't mention because it's invisible from the happy path.
- **Batch commit should be one atomic write, not N sequential POSTs.** If the UI just loops today's single-match POST 6 times, a network drop after row 3 leaves an inconsistent partial match with no clean rollback story. Recommend a new endpoint (or an extended body, `{ bankLineId, transactionIds: string[] }`) that inserts all N match rows in one transaction.
- **Unmatch semantics for a batch.** Today's DELETE route takes one `matchId` and the UI's `unmatchLine` state assumes exactly one match per line. Flow 2 above resolves this functionally (per-row unmatch from an expanded list, reusing the existing DELETE-by-matchId route unchanged) — call this out explicitly since the current component's `BankLineWithMatch` shape (singular `matchId`/`matchedTransactionId`) doesn't support "here are 6 matches, unmatch #3" without a data-shape change.
- **Guide copy (`src/components/admin/ledger/guide/reconciliation-section.tsx`) explicitly names this as "coming soon."** Once shipped, §10 must be updated to describe the live batch workflow (mirroring the DEVIATION-FROM-PHASE-3 pattern the file already used once) — this is a required Phase 4 deliverable, not an optional follow-up, because the guide is the treasurer's own reference doc and currently promises something that no longer matches reality once this ships.
- **Candidate list has no date/week grouping.** The picker already shows every unreconciled transaction on the account — income and expense alike, unfiltered by payment method (by design, per its own code comment: "NOT pre-filtered or ranked"; this genericity is exactly what the Scope Decision above requires and needs zero query change). For batch selection to be usable when two different weeks' worth of Zeffy rows are both sitting unmatched (the real 2026-07-28 case — $500 vs. the next ~$450), or when a fundraiser's bundled rows sit alongside unrelated candidates, the picker needs at minimum a client-side sort by date/amount so the treasurer can visually cluster the rows that belong to this bank line. No new server query needed — this is a UI affordance, not a new endpoint.

## Out of Scope (confirm with user)

- **Auto-suggesting the batch** (summing a week of zeffy rows against a deposit automatically, or auto-clustering candidates for any other batched case) — the guide itself lists this as a *separate* "coming soon" item from batch mode, and an existing schema-index comment (`ix_ledger_bank_lines_check_slip`, "shape inc3's auto-match will need") confirms auto-match was already planned as a later increment. v1 is the general MANUAL many-to-one selection only; recommend deferring auto-suggest to v2.
- **Non-exact batch sums** (a member tip to Zeffy, a partial remittance) — recommend v1 is exact-match-only; a non-exact case becomes a manual adjustment transaction the treasurer records outside the matching engine, not a tolerance the matching engine accepts silently.
- **Any change to how Zeffy dues auto-post** — still one `payment_method='zeffy'` row per member, unchanged.
- **Retroactively creating reconciliation sessions for historical months** — relevant only if the month-gate is ever made session-aware later; explicitly not part of this feature.
- **New member-facing microcopy distinguishing "genuinely behind" vs. "in-transit" months** — the existing generic "Statement Not Ready Yet … still reconciling" copy stays as-is for v1; only the underlying gate *logic* changes (Q4), not the message members see.

## Open Questions

1. **Month-gate carve-out threshold (needs treasurer confirmation — this is the one prior regression risk in this codebase, see recommendation below):** is a *recency-bounded* deposits-in-transit exclusion (e.g., an unreconciled `payment_method='zeffy', flow='income'` row is excluded from the gate only if dated within roughly the last ~10 days, mirroring how fast a real Zeffy weekly cycle clears) an acceptable trade-off versus the simpler-but-riskier alternative of excluding ALL unreconciled zeffy income rows unconditionally? An unbounded exclusion would also hide a genuinely neglected/broken Zeffy sync from months ago — the treasurer should confirm a bounded exclusion is worth the added complexity versus that risk.
2. **Is per-row unmatch-from-a-batch sufficient for v1, or does the treasurer also want a one-click "unmatch this entire batch" convenience action?** Recommend per-row only for v1 (reuses the existing route unchanged); confirm this isn't a blocker for real usage.
3. **Has the treasurer ever actually seen a non-exact Zeffy batch in these books** (a tip, a partial remittance)? This confirms whether "exact-match-only" (Q2's recommendation) is safe to lock in for v1 or whether a real recurring exception needs a designed path sooner.
4. **Confirm the tie-out read-query fix (getTieOutAssembly/getBankLinesForSession fan-out) ships as part of THIS feature's Phase 3/4, not a separately-scheduled bug-fix** — recommended yes, since the bug has no blast radius until batch matches exist, but tech-lead should own the explicit call.

## Human Answers (Chris, 2026-07-28)

Binding inputs for Phase 2/3.

- **Exact-sum (Q2/Q3):** **exact-match-only for v1.** Treasurer note: with multiple Zeffy campaigns running, Zeffy is expected to remit **one lump sum** covering everything in that settlement — so a single bank deposit may bundle rows across *different categories* (dues + donations + fundraiser), not just dues. This REINFORCES the generic requirement: the candidate picker must surface all unreconciled rows regardless of category/method, and exact-match still holds (the selected heterogeneous rows sum to the lump). If a genuine non-exact remittance (Zeffy tip/fee) ever appears, a tolerance/adjustment path is a fast-follow — not v1.
- **Month-gate carve-out (Q1):** **recency-bounded** deposits-in-transit exclusion (the guarded option) — a recent unremitted deposit doesn't block the month, but a long-stale un-deposited batch still flags it (guards against a neglected/broken sync silently hiding a problem). Tech-lead picks the exact window; ~one Zeffy cycle (≈10–14 days from month-end) is the starting point.
- **Unmatch UX (Q2):** **per-row unmatch only for v1;** one-click "unmatch batch" deferred to a fast-follow.
- **Tie-out read-query fix (Q4):** ships **inside this feature** (Phase 3/4), not separately — confirmed. It's a prerequisite for correct batch tie-out.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The shape is right — general many-to-one match, no schema change, existing files extended rather than forked — and the one load-bearing correctness item (tie-out fan-out) has a clean, scoped fix. Suggestions below are non-blocking but should be resolved in Phase 3, not discovered in Phase 4.

## 1. Schema — no migration

Confirmed: **no schema change required.** `ledger_reconciliation_matches.bank_line_id` is deliberately non-unique (DECISION-036 §3) specifically to permit this feature with zero migration — `transaction_id` stays UNIQUE forever (a book row clears against exactly one bank line), `bank_line_id` was left unconstrained for exactly this "inc3" moment.

Indexing is also already sufficient: `ix_ledger_recon_matches_bank_line` (on `bankLineId`) already exists and is exactly the index a dedupe/group-by-bank-line query needs — the batch feature's read pattern (fetch all matches for a session's bank lines, grouped by `bankLineId`) is not a new access pattern requiring a new index, it's the same join `getTieOutAssembly`/`getBankLinesForSession` already do today, just aggregated correctly. **No new column, no new index, no new table.**

## 2. Placement / server-client split

- **No new route, no new query module.** Batch-match logic extends the existing `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts` and the existing `src/lib/reconciliation-queries.ts` — this is the same action (bank line ↔ ledger transaction matching) at a different cardinality, not a new capability or a new feature surface. Creating a parallel `/match/batch` route would fork the 5 validation checks the single-match route already runs (posted / same-bank-account / unreconciled / not-already-matched / session-open) across two code paths that must stay in sync forever — reject that shape. Extend the existing route's body to accept the transaction set (tech-lead's call whether that's `transactionIds: string[]` replacing `transactionId`, or a union — I'd lean array-only since a 1-element array is a degenerate batch and keeps one code path, but this is an implementation choice, not an architectural one).
- **Unmatch stays on the existing `DELETE .../match/[matchId]` route, unchanged** — per-row unmatch (Flow 2) needs no new endpoint; it was already matchId-keyed, not bank-line-keyed.
- **`reconciliation-queries.ts` stays the single reconciliation query module** — consistent with its own header comment and DECISION-036's original ruling to keep this feature's data access separate from `ledger-queries.ts` but NOT to fork further within itself. Add the batch-aware read/validation helpers here (e.g., re-fetching all N candidate transactionIds for server-side re-validation); per this file's own documented convention (its top-of-file comment, lines 13–18), the actual atomic multi-row `db.transaction()` composition is written directly in the route handler, not in this file — consistent with how `close/route.ts` and `create-from-bank-line/route.ts` already do their atomic writes. No exception needed for batch matching.
- **Client components: extend, don't fork.** `reconciliation-match-picker.tsx` gains multi-select (plain `<input type="checkbox">` — no `Checkbox` UI primitive exists in `src/components/ui/`, and this codebase already styles simple inputs directly, e.g. the picker's own search box) and a running-sum footer/commit bar, replacing the current per-row instant-"Match" button with a "Match selected" commit action. `reconciliation-matching-grid.tsx`'s `BankLineWithMatch`-consuming render needs the "Matched · N transactions" expandable state (Flow 2) — this is a shape change to the type (see §3), not a new component tree; a small expand/list sub-component is reasonable if the grid file gets unwieldy, but it belongs alongside its siblings in `src/components/admin/ledger/`, not a new subdirectory.
- **Dependencies: none.** Multi-select, running-sum, and expand/collapse are all plain React state + Tailwind, exactly like the rest of this component family. Confirmed no new npm package is warranted.

## 3. Tie-out fan-out fix — endorsed, and here is the full consumer list

**Endorsed:** dedupe-per-bank-line is the correct fix, and it must be a per-`bankLineId` reduction, not a per-joined-row one. `getTieOutAssembly()` and `getBankLinesForSession()` both LEFT JOIN `ledger_bank_lines` → `ledger_reconciliation_matches` **keyed on `bankLineId`** — the one column DECISION-036 deliberately left non-unique. A batch match on one line now returns N joined rows for that one line; both functions currently treat "one joined row" as "one match," so they must be rewritten to group by `line.id` first, then: (a) push the line's `amountCents` into `matchedLineAmountsCents` **once** if the group has ≥1 match, and (b) collect **all** matched transaction ids for that line (not just the last-joined one) into a `matchedTransactionIds: string[]` — this is a **type change**, not just a logic change (`BankLineWithMatch.matchedTransactionId: string | null` → `matchedTransactionIds: string[]`), and every consumer of that type (`reconciliation-matching-grid.tsx`, and anywhere else importing `BankLineWithMatch`) must be updated in lockstep. This preserves the "no N+1 queries" invariant stated in the file's own header — it's still one query, just grouped correctly on the JS side before reducing, matching how `getTieOutAssembly` already does its single-pass reduction today.

**Full audit of every consumer of `ledger_reconciliation_matches` (searched all of `src/`) — exactly two need the fix, one is confirmed safe, and two more touch the table without a fan-out risk:**

| File | Join key | Fan-out risk | Verdict |
|---|---|---|---|
| `src/lib/reconciliation-queries.ts` → `getTieOutAssembly()` | `bankLineId` (non-unique) | **Yes** | **Must fix** — dedupe by `line.id` before summing |
| `src/lib/reconciliation-queries.ts` → `getBankLinesForSession()` | `bankLineId` (non-unique) | **Yes** | **Must fix** — `matchedTransactionId` singular field hides all-but-one match today; must become an array |
| `src/lib/financial-report-queries.ts` → `computeOneMonthCashActuals()` | `transactionId` (UNIQUE forever, DECISION-036) | **No** | Confirmed safe as-is — each transaction has at most one match row by schema constraint, so this join can never fan out regardless of batch matching. No change needed; flagging so Phase 4 doesn't waste time re-auditing it. |
| `src/app/api/.../match/route.ts` → `getMatchForBankLine()` | `bankLineId`, `LIMIT 1` existence check | No (by construction) | Used only as a boolean "does this line already have a match" gate before rejecting/allowing a new match attempt — correct as-is under the "batch is created whole, not appended-to" model (see §4). Not a read/render path, no dedupe needed. |
| `src/app/api/.../create-from-bank-line/route.ts` → `getMatchForBankLine()` | same | No | Same existence-check usage; unaffected. |

No other file in `src/` references `ledgerReconciliationMatches`/`ledger_reconciliation_matches`. This audit is exhaustive, not sampled.

## 4. Atomicity / invariants

- **Transaction boundary:** the batch commit is one `db.transaction()` in the route handler (not in `reconciliation-queries.ts`, per that file's own documented convention — mirrors `close/route.ts`'s and `create-from-bank-line/route.ts`'s existing atomic-write pattern). Inside it: re-fetch and re-validate **every** submitted `transactionId` server-side against the same 5 checks the single-match route already runs (posted / same-bank-account / unreconciled / not-matched-elsewhere) — never trust the client's running-sum indicator — **and** re-sum the server-fetched amounts and assert they equal the bank line's signed `amountCents` exactly before any insert. On any failure, throw inside the transaction so nothing partial commits — no batch is ever half-matched.
- **The existing "bank line already has a match → 409" rejection in `match/route.ts` stays semantically correct unchanged.** Per Flow 1, the UI accumulates a client-side selection and commits the whole set in one POST — a bank line is matched once, as a complete set, never incrementally appended to across multiple POSTs. So `getMatchForBankLine`'s existence check keeps its current meaning ("this line hasn't been claimed yet") with zero logic change; only what happens *after* that check (insert 1 row vs. insert N rows in the same transaction) changes.
- **Close-gate correctness falls out of the §3 fix, not from new logic in `close/route.ts`.** Once `getTieOutAssembly` counts a batch-matched line's amount exactly once, the existing "opening + cleared = closing" arithmetic in `close/route.ts` and `computeTieOut()` is correct for batch matches with **no changes to `close/route.ts` itself** — it already consumes `matchedLineAmountsCents` and `unmatchedInPeriodBankLineIds` as opaque inputs. Confirm this is unchanged, not "should be re-verified" — the close route's job (check every in-period line is matched, re-check posted status, check the sum) is cardinality-agnostic once its inputs are correct.

## 5. Month-gate carve-out — seam confirmed, one design ambiguity flagged for tech-lead

**Seam confirmed:** extending `isMonthGatedForEntity`/`getLatestOpenMonthForEntity` with a sibling predicate to `isOutstandingCheckRow()` is the right approach — same shape (a pure function over `{ paymentMethod, flow }`-like row fields, same call sites in both functions' `.filter()`/`.some()` chains), same file, same "member-exposed funds only" scoping already in place. No new query needed; the existing `rows` fetch in both functions already selects `paymentMethod`/`flow`/`txnDate` — the new predicate only needs `txnDate` added to the projection, which both already select or can trivially add.

**Bounded-ness and the naive-timestamp bug class:** both functions already operate exclusively on `date` columns as `'YYYY-MM-DD'` strings (never `timestamp`), and `hasMonthElapsed()` already establishes the exact pattern to mirror for the "how recent" reference point: an injectable `asOf: Date = new Date()` parameter using **local** getters (explicitly documented in that function as deliberately not the `reconciledAtToYMD()`/naive-timestamp-as-UTC bug class, since it's "what calendar day is it," not a stored wall-clock value being reinterpreted). The new carve-out predicate should take the same shape — an injectable reference date, string-only comparisons — and this fits cleanly with zero risk of reintroducing that bug class.

**One thing Phase 3 must nail down precisely, flagged as a design ambiguity, not a blocker:** the binding decision's phrasing ("within ~10–14 days of month-end") is ambiguous between two materially different semantics:
  - **(a) Fixed window anchored to `monthEnd`** (e.g., `txnDate >= monthEnd - 14 days`) — this window never changes as real time passes, so a batch that is still undeposited two months later would be excluded *forever*. This **fails** the treasurer's explicit requirement that "a long-stale un-deposited batch still flags."
  - **(b) Window anchored to "today"/`asOf`** (e.g., `asOf - txnDate <= 14 days`, using the same injectable-`asOf` pattern as `hasMonthElapsed`) — a row stops being excluded once enough real time has passed since it posted, regardless of which month is being evaluated. This is the only semantics that satisfies "long-stale still flags."

  Tech-lead must design (b), not (a) — recommend stating this explicitly in the Phase 3 doc so it isn't discovered as a bug in Phase 5. The exact day threshold (10 vs. 14) is an implementation choice already delegated to tech-lead by the binding decision; the anchor-to-`asOf`-not-`monthEnd` requirement is not — it's necessary to satisfy the treasurer's stated invariant.

## 6. Invariants touched

- **Permissions:** no new `FEATURES` key. `ledger.record` (`FEATURES.LEDGER_RECORD`) continues to gate match-create (now batch-capable) and unmatch; `ledger.manage` (`FEATURES.LEDGER_MANAGE`) continues to gate reopen. Confirmed — matches the binding decision and the existing route guards.
- **Server/client boundary:** unchanged shape — server-only query/route logic in `reconciliation-queries.ts` + route handlers, `'use client'` only on the two interactive dialog/grid components, exactly as today.
- **Migrations:** none (§1).
- **Member-data-exposure boundary:** unaffected — this entire feature is inside the existing admin-only `/admin/ledger/reconciliation` surface; no member-facing surface is touched except as a downstream *read* effect of the month-gate change (an already-published/gated statement page, not a new exposure surface).
- **Guide documentation:** `src/components/admin/ledger/guide/reconciliation-section.tsx` §10 explicitly says batch mode is "coming soon" (confirmed at lines 12–19, 67) — this must be rewritten to describe the live workflow as part of Phase 4, not deferred. This is a documentation debt inside the admin-facing guide, not a `CLAUDE.md` change; nothing in `CLAUDE.md`'s route-group rules, permission model, or schema-source-of-truth invariant needs updating for this feature — the invariants already anticipated many-to-one matching (DECISION-036 explicitly says so).

## Notes for Phase 3 (tech-lead)

- Decide the exact request-body shape for the extended match route (`transactionIds: string[]` recommended; array-only, min length 1, so single-match and batch-match are the same code path rather than a union type).
- Design the `BankLineWithMatch` shape change (`matchedTransactionId` → `matchedTransactionIds: string[]`, or add a `matchCount`) and enumerate every file that destructures the old singular field — at minimum `reconciliation-matching-grid.tsx`.
- Nail down the month-gate carve-out predicate as anchored to `asOf`/today, not `monthEnd` (§5) — write it into the design doc explicitly so qa can write a regression test for "stale batch re-flags after N days."
- Confirm in the design doc that `computeOneMonthCashActuals` needs zero changes (§3) so a future reviewer doesn't re-open that question.
- The guide update (`reconciliation-section.tsx` §10) is a named Phase 4 deliverable, not a follow-up.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're extending the existing one-to-one bank-line-match route and its two supporting read queries to accept a **set** of ledger transactions (income or expense, unfiltered by payment method) whose signed amounts sum exactly to one bank-statement line — a general many-to-one match, with Zeffy's weekly dues batch as the worked example, not a Zeffy-specific mechanism. No schema change: `ledger_reconciliation_matches.bank_line_id` was left deliberately non-unique for exactly this moment (DECISION-036). Three things ship together because none of them is safe alone: (1) a fan-out bug fix to `getTieOutAssembly()`/`getBankLinesForSession()` that today would silently multiply a batch-matched line's amount into the close-gate arithmetic once per matched row instead of once per line; (2) the batch-capable match route with full server-side re-validation and an exact-sum check, atomic in one `db.transaction()`; (3) a recency-bounded carve-out in the monthly-statement gate so a legitimately in-transit (not-yet-remitted) Zeffy deposit doesn't block a month the treasurer has otherwise fully reconciled, while a genuinely stale, forgotten batch still flags it.

## Permissions

- No new `FEATURES` key. `ledger.record` (`FEATURES.LEDGER_RECORD`) continues to gate the match-create route (now batch-capable) and the unmatch route, unchanged. `ledger.manage` (`FEATURES.LEDGER_MANAGE`) continues to gate session reopen, unchanged.
- Default role bindings: unchanged (Treasurer + Admin already hold both).

## API Contract

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match` (extended)

**Request body:**
```ts
{ bankLineId: string; transactionIds: string[] }  // array-only, min length 1
```

**Backward compatibility call:** the request body's `transactionId: string` singular field is **removed, not kept as an alias**. This route has exactly one caller in the codebase (`reconciliation-match-picker.tsx`), which is being rewritten in this same feature to send `transactionIds: [id]` for a plain single pick. Architect's Phase 2 note recommended array-only "since a 1-element array is a degenerate batch and keeps one code path"; because there is no external/public consumer of this admin-only route, there's no compatibility cost to paying that down cleanly instead of carrying two request shapes forever. A 1-element array match, a 6-element batch match, and a heterogeneous income+expense batch are all the same code path below.

**Response 201:**
```ts
{ bankLineId: string; matchIds: string[]; transactionIds: string[]; count: number }
```

**Validation sequence (all server-side; the picker's live running-sum is a UX convenience only, never trusted):**

1. Auth (`401`) + `hasFeature(LEDGER_RECORD)` (`403`) — unchanged.
2. Parse body: `bankLineId` present and a string (`400`); `transactionIds` present, an array, non-empty, every element a string, no duplicate ids within the array (`400 { error: "transactionIds must be a non-empty array of distinct strings" }`).
3. Session must exist (`404`) and be open (`409` — unchanged message).
4. Bank line must belong to this session (`404` — unchanged).
5. Bank line must have **no existing match at all** — unchanged `getMatchForBankLine` existence check, unchanged semantics: a bank line is matched once, as a complete set, never incrementally appended to (architect §4). `409 { error: "This bank line is already matched — unmatch it first" }`.
6. **Bulk-fetch every submitted transaction in one query** (`inArray(ledgerTransactions.id, transactionIds)`, no N+1): `id, status, bankAccountId, reconciled, flow, amountCents`.
   - Any id with no matching row → `404 { error: "One or more transactions were not found", missingTransactionIds: string[] }`.
   - Any fetched row with `status !== 'posted'` → `400 { error: "Only posted transactions can be matched", transactionId, invalidTransactionIds: string[] }` (collect all offenders, not just the first, so the treasurer isn't told to fix them one at a time).
   - Any fetched row with `bankAccountId !== reconSession.bankAccountId` → `400 { error: "One or more transactions do not belong to this session's bank account", invalidTransactionIds: string[] }`.
   - Any fetched row with `reconciled === true` → `409 { error: "One or more transactions are already reconciled", invalidTransactionIds: string[] }`.
7. **Bulk-check existing matches in one query** (`inArray(ledgerReconciliationMatches.transactionId, transactionIds)`, no N+1). Any hit → `409 { error: "One or more transactions are already matched to a different bank line", conflictingTransactionIds: string[] }` (they can't be matched to *this* line — step 5 already proved this line has zero matches).
8. **Exact-sum re-check, server-fetched amounts only**: signed per the same convention the picker already uses (`flow === 'expense' ? -amountCents : amountCents`), summed and compared to the bank line's own signed `amountCents`. Mismatch → `400 { error: "Selected transactions do not sum to the bank line amount", selectedSumCents, bankLineAmountCents, deltaCents }` (`deltaCents = bankLineAmountCents - selectedSumCents`; positive = short, negative = over — mirrors the picker's live indicator wording).
9. **Atomic insert, one `db.transaction()`**, written directly in the route handler (mirrors `close/route.ts`/`create-from-bank-line/route.ts`'s existing convention — reconciliation-queries.ts's own header reserves multi-row atomic composition for the route, not the query module): `tx.insert(ledgerReconciliationMatches).values(transactionIds.map(id => ({ sessionId, bankLineId, transactionId: id, createdByUserId })))`. `transactionId` is UNIQUE forever (DECISION-036) — a race where a concurrent request matches one of these transactionIds between step 7 and this insert surfaces as Postgres `23505`, caught and mapped to `409 { error: "One or more selected transactions were just matched elsewhere — refresh and try again" }`, identical in spirit to the existing single-match route's race handling. Nothing partial ever commits: the whole batch is one `INSERT ... VALUES (...), (...), ...` inside one transaction.

Does **not** touch `reconciled`/`reconciledAt` — unchanged; those still flip only at session close, in a batch, regardless of match cardinality.

### `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]` — unchanged

Confirmed: no change. It's already keyed on `matchId`, not `bankLineId`, so it already does exactly "unmatch this one transaction" regardless of how many sibling matches share its `bankLineId`. Flow 2 (per-row unmatch from a batch) reuses this route as-is; only the UI's affordance to reach a specific `matchId` inside a batch changes (Component Plan below).

### `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close` — unchanged

Confirmed: no change to this route. Its "opening + cleared = closing" arithmetic is correct for batch matches once its inputs (`getTieOutAssembly()`'s `matchedLineAmountsCents`) are fixed (Data Model below) — the close route already treats those as opaque, cardinality-agnostic inputs.

## Data Model

**No schema changes.** `ledger_reconciliation_matches.bank_line_id` stays non-unique (already true); a batch is represented as **N rows sharing one `bank_line_id`**, each with its own unique `transaction_id`. `ix_ledger_recon_matches_bank_line` already indexes exactly the column a dedupe/group-by query needs.

### Query rewrite 1 — `getTieOutAssembly()` (`src/lib/reconciliation-queries.ts`)

Today: one LEFT JOIN row per (bank line, match) pair; a batch-matched line fans out to N rows, each pushing the line's full `amountCents` into `matchedLineAmountsCents` — N× inflation of the "cleared" sum. Fix: **group by `line.id` in one JS pass over the same single query** (no new query, no N+1) before reducing:

```ts
export async function getTieOutAssembly(sessionId: string): Promise<TieOutAssembly> {
  const rows = await db /* same select + join + where as today */;

  const seenLineIds = new Set<string>();
  const lineAmountById = new Map<string, number>();
  const matchedLineIds = new Set<string>();

  for (const row of rows) {
    if (!seenLineIds.has(row.id)) {
      seenLineIds.add(row.id);
      lineAmountById.set(row.id, row.amountCents);
    }
    if (row.matchedTransactionId) matchedLineIds.add(row.id);
  }

  const matchedLineAmountsCents: number[] = [];
  const unmatchedInPeriodBankLineIds: string[] = [];
  for (const lineId of seenLineIds) {
    if (matchedLineIds.has(lineId)) {
      matchedLineAmountsCents.push(lineAmountById.get(lineId)!);
    } else {
      unmatchedInPeriodBankLineIds.push(lineId);
    }
  }
  return { matchedLineAmountsCents, unmatchedInPeriodBankLineIds };
}
```

A batch-matched line now contributes its `amountCents` to `matchedLineAmountsCents` **exactly once**, regardless of whether it has 1 or 6 matches. `TieOutAssembly`'s own type is unchanged (`matchedLineAmountsCents: number[]`) — only the values it holds are now correct.

### Query rewrite 2 — `getBankLinesForSession()` (`src/lib/reconciliation-queries.ts`) — type change

Today's `BankLineWithMatch` carries singular `matchId: string | null` and `matchedTransactionId: string | null` — for a batch-matched line, the LEFT JOIN's last row silently overwrites the previous ones, so the UI would show exactly one of six matched transactions and hide the rest. Fix, grouped the same way as rewrite 1:

```ts
export type BankLineWithMatch = LedgerBankLine & {
  /** Every transactionId matched to this line. Empty = unmatched. Length
   *  is the "Matched · N" count. Replaces the old singular matchId /
   *  matchedTransactionId fields, which silently hid all-but-one member
   *  of a batch match. */
  matchedTransactionIds: string[];
};

export async function getBankLinesForSession(sessionId: string): Promise<BankLineWithMatch[]> {
  const rows = await db /* same select + join + where + orderBy as today */;

  const idsByLine = new Map<string, string[]>();
  const lineById = new Map<string, LedgerBankLine>();
  const order: string[] = [];
  for (const r of rows) {
    if (!lineById.has(r.line.id)) {
      lineById.set(r.line.id, r.line);
      order.push(r.line.id);
    }
    if (r.matchedTransactionId) {
      const arr = idsByLine.get(r.line.id) ?? [];
      arr.push(r.matchedTransactionId);
      idsByLine.set(r.line.id, arr);
    }
  }
  return order.map((id) => ({ ...lineById.get(id)!, matchedTransactionIds: idsByLine.get(id) ?? [] }));
}
```

Order is preserved (`postingDate` ascending, same as today) by tracking first-seen order in `order[]` rather than relying on `Map` insertion order alone across a re-sort.

**Consumer ripple — every destructurer of the old fields must update:**
- `src/components/admin/ledger/reconciliation-matching-grid.tsx` — `Boolean(line.matchedTransactionId)` → `line.matchedTransactionIds.length > 0`; `unmatchLine.matchId` (used only for the DELETE call) is replaced entirely (see below — per-row unmatch now needs a *specific* `matchId` inside a batch, which `BankLineWithMatch` deliberately no longer carries, since "the line's matchId" isn't a meaningful single value once N can exist).
- Confirmed exhaustive: `grep` shows these are the only two lines in the whole tree that read `.matchId`/`.matchedTransactionId` off this type (route handlers use their own independently-shaped responses, unaffected).

### New read helper — `getMatchedTransactionsForSession()` (new, not previously named in Phase 1/2, needed to make Flow 2 usable)

Neither existing type gives the UI enough to *render* a legible "Matched · 6 transactions" expandable list (date/party/memo/amount) with a working per-row Unmatch button — `matchedTransactionIds: string[]` is only ids, and `candidateTransactions` deliberately *excludes* already-matched rows (`getCandidateTransactionsForMatching`'s own WHERE clause). One new session-scoped query, same "no N+1" discipline as the rest of the file:

```ts
export type MatchedTransactionRow = CandidateTransactionRow & {
  matchId: string;
  bankLineId: string;
};

export async function getMatchedTransactionsForSession(
  sessionId: string,
): Promise<MatchedTransactionRow[]> {
  const rows = await db
    .select({
      matchId: ledgerReconciliationMatches.id,
      bankLineId: ledgerReconciliationMatches.bankLineId,
      id: ledgerTransactions.id,
      txnDate: ledgerTransactions.txnDate,
      flow: ledgerTransactions.flow,
      amountCents: ledgerTransactions.amountCents,
      party: ledgerTransactions.party,
      memo: ledgerTransactions.memo,
      checkNumber: ledgerTransactions.checkNumber,
      paymentMethod: ledgerTransactions.paymentMethod,
    })
    .from(ledgerReconciliationMatches)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerReconciliationMatches.transactionId))
    .where(eq(ledgerReconciliationMatches.sessionId, sessionId));
  return rows;
}
```

One query for the whole session detail page load (added alongside the page's existing parallel fetch of `bankLines`/`candidateTransactions`/`funds`/`categories`). The grid groups these client-side by `bankLineId` to render each line's expandable match list and to source the exact `matchId` each row's Unmatch button needs.

### Month-gate carve-out — `src/lib/financial-report-queries.ts`

New predicate, sibling to `isOutstandingCheckRow()`, same file, same shape:

```ts
/** ~one Zeffy weekly-remittance cycle (7 days) plus observed ACH/bank
 *  posting lag (the verified 2026-07-28 case: rows dated 6/24-6/25 cleared
 *  the bank 6/29, a 4-5 day lag) with margin. Long enough that a normal
 *  in-transit batch is never falsely gated; short enough that a batch still
 *  sitting unremitted after ~1.5-2 cycles reliably re-flags as stale. */
const IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS = 12;

/** DST-safe day-count between two 'YYYY-MM-DD' calendar-date strings. Both
 *  sides are pinned via Date.UTC() on their own Y/M/D components purely as
 *  an internal arithmetic trick — this is NOT reconciledAtToYMD()'s bug
 *  class (there is no stored wall-clock timestamp being reinterpreted here;
 *  both inputs are already date-only strings, exactly like hasMonthElapsed()'s
 *  local-getter comparisons above). */
function daysBetween(laterYMD: string, earlierYMD: string): number {
  const [ly, lm, ld] = laterYMD.split("-").map(Number);
  const [ey, em, ed] = earlierYMD.split("-").map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86_400_000);
}

/** True iff `r` is a not-yet-remitted Zeffy deposit recent enough to treat
 *  as legitimately in transit rather than "books aren't done." Anchored to
 *  `asOf` (today), NOT to the report's `monthEnd` — a fixed monthEnd-relative
 *  window would exclude a stale, forgotten batch FOREVER as real time moves
 *  forward past it, which fails the treasurer's explicit requirement that a
 *  long-stale un-deposited batch must still flag the month (architect §5). */
function isInTransitZeffyDepositRow(
  r: { paymentMethod: string | null; flow: string; txnDate: string },
  asOf: Date = new Date(),
): boolean {
  if (r.paymentMethod !== "zeffy" || r.flow !== "income") return false;
  const asOfYMD = `${asOf.getFullYear()}-${pad2(asOf.getMonth() + 1)}-${pad2(asOf.getDate())}`;
  return daysBetween(asOfYMD, r.txnDate) <= IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS;
}
```

`isMonthGatedForEntity(entityId, monthEnd, asOf: Date = new Date())` gains the optional injectable `asOf` (mirrors `hasMonthElapsed`'s own pattern in this same file) and the `.some()` predicate becomes:
```ts
isMemberExposedKind(r.fundKind) && r.txnDate <= monthEnd && !isOutstandingCheckRow(r) && !isInTransitZeffyDepositRow(r, asOf)
```

`getLatestOpenMonthForEntity(entityId, asOf: Date = new Date())` also gains the same optional `asOf`, threaded to **both** its own `blockingDates` filter (`!isOutstandingCheckRow(r) && !isInTransitZeffyDepositRow(r, asOf)`) and its final re-check call to `isMonthGatedForEntity(entityId, monthBounds(candidate).monthEnd, asOf)`. This second thread-through matters: without it, the candidate-month computation would independently re-truncate the picker the same way the outstanding-check bug once did (architect §5, and the prod repro already documented in `docs/work-log/2026-07-28-report-gate-outstanding-checks.md`) — a recent in-transit Zeffy row would look like a "blocking date" to the candidate computation even though `isMonthGatedForEntity` itself would clear that month.

Both functions already project `paymentMethod`/`flow`/`txnDate` in their existing SQL `select` — no new column, no query shape change, only the JS-side predicate.

## Component / Page Plan

**Files to modify (no new pages, no new routes):**

- `src/lib/reconciliation-queries.ts` — `getTieOutAssembly()` rewrite, `getBankLinesForSession()` rewrite + `BankLineWithMatch` type change, new `getMatchedTransactionsForSession()` + `MatchedTransactionRow` type.
- `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.ts` — batch body, validation sequence, atomic multi-row insert.
- `src/lib/financial-report-queries.ts` — `isInTransitZeffyDepositRow()`, `daysBetween()`, `isMonthGatedForEntity()`/`getLatestOpenMonthForEntity()` gain optional `asOf`.
- `src/app/(dashboard)/admin/ledger/reconciliation/sessions/[sessionId]/page.tsx` (session detail page — wherever it currently calls `getBankLinesForSession`/`getCandidateTransactionsForMatching`) — add the parallel `getMatchedTransactionsForSession(sessionId)` fetch, pass down as a new prop.
- `src/components/admin/ledger/reconciliation-match-picker.tsx` — multi-select + running-sum + commit; Zeffy convenience filter chip.
- `src/components/admin/ledger/reconciliation-matching-grid.tsx` — "Matched · N" badge, expandable per-line match list (sourced from the new `matchedTransactions` prop grouped by `bankLineId`), per-row Unmatch wired to that row's own `matchId`.
- `src/components/admin/ledger/guide/reconciliation-section.tsx` §10 — batch mode is no longer "coming soon"; describe the live workflow.

**`reconciliation-match-picker.tsx` (multi-select):**
- Replace the per-row instant "Match" button with a checkbox column (plain `<input type="checkbox">`, matching architect's ruling — no `Checkbox` UI primitive in this codebase, and this component already styles a plain `<input>` for its search box).
- Local state: `selectedIds: Set<string>`.
- Footer/commit bar, sticky at the bottom of the dialog: running signed sum of selected rows (`signedAmount()`, already defined in this file, reused unchanged — it already generalizes correctly to a debit line ↔ expense-row batch per Phase 1's Scope Decision) vs. the bank line's own signed `amountCents`. Renders one of: `"$500.00 of $500.00 — balanced"` (green, commit enabled), `"$476.00 of $500.00 — $24.00 short"` (amber, commit disabled), `"$512.00 of $500.00 — $12.00 over"` (amber, commit disabled).
- "Match selected" button — disabled unless `selectedIds.size > 0` and the running sum equals the bank line amount exactly. On click: `POST { bankLineId, transactionIds: [...selectedIds] }`. Success → toast, close dialog, `router.refresh()`. Failure → toast the server's `error` message, **dialog stays open, `selectedIds` preserved** (Phase 1 Flow 1's named failure case — a dropped request shouldn't force re-checking 6 boxes).
- New: a "Zeffy only" toggle chip above the table — pure client-side filter on `candidateTransactions.filter(t => t.paymentMethod === 'zeffy')`, composable with the existing search box (both narrow the same `filtered` list). This is the UX affordance the Scope Decision explicitly permits ("a Zeffy-specific convenience... is fine as a UX affordance layered on top, but must never be... a hard filter that would hide a non-Zeffy candidate row") — off by default, never removes non-Zeffy rows from the underlying data, purely a display narrowing the treasurer can toggle off.
- The query's existing `ORDER BY txnDate ASC` already clusters same-week rows adjacently; no new sort needed on top of the existing one.

**`reconciliation-matching-grid.tsx` (expandable batch display):**
- New prop: `matchedTransactions: MatchedTransactionRow[]`, grouped once per render into `Map<bankLineId, MatchedTransactionRow[]>`.
- Status cell: `matched = line.matchedTransactionIds.length > 0`; when matched, label becomes `` `Matched · ${count}` `` (a legacy 1:1 match renders as "Matched · 1" — no special-casing needed, the array naturally holds length 1).
- Add a row-expand toggle (chevron, same pattern as the existing out-of-period section's expand/collapse) revealing, per matched line, a small nested list: one row per `MatchedTransactionRow` in that line's group — date, party/memo, signed amount, and its own "Unmatch" action.
- `unmatchLine: BankLineWithMatch | null` state is replaced with `unmatchTarget: { matchId: string; label: string } | null` (only a `matchId` + a human-readable label for the `<ConfirmDialog>` description are needed — no longer a whole bank line, since unmatch now targets one specific match row inside a possibly-larger group). `handleUnmatch()`'s DELETE call is otherwise unchanged (`/match/${unmatchTarget.matchId}`).
- The "Match" / "Create transaction" action buttons continue to render **only when `matchedTransactionIds.length === 0`** (unchanged condition, just re-expressed against the new field) — per architect §4, a line with any match at all is "claimed" and the picker won't reopen on it; see Edge Cases for the resulting recovery path when a batch needs correcting.

## Implementation Order

1. **Fan-out fix first** — `getTieOutAssembly()` + `getBankLinesForSession()` rewrites, `BankLineWithMatch` type change, `reconciliation-matching-grid.tsx`'s two consumption sites updated to compile against the new shape (no new UI behavior yet — this step is purely "make the existing single-match behavior correct under the new type," a prerequisite before any batch write path can exist safely).
2. New `getMatchedTransactionsForSession()` read helper.
3. Batch-capable `POST .../match` route (validation sequence + atomic insert).
4. Month-gate carve-out (`isInTransitZeffyDepositRow`, `daysBetween`, threaded `asOf` through both `isMonthGatedForEntity` and `getLatestOpenMonthForEntity`).
5. UI — match-picker multi-select/running-sum/commit + Zeffy filter chip; matching-grid expandable "Matched · N" + per-row unmatch; session detail page wiring the new prop.
6. Unit tests (named below).
7. Guide update — `reconciliation-section.tsx` §10, batch mode no longer "coming soon."
8. Release notes entry (`/release-notes`).

No schema migration, no `FEATURES` entry, no email notification — none apply to this feature.

## Edge Cases & Risks

- **Exact-sum with signed amounts.** A debit bank line (negative `amountCents`) must match against expense rows only (their signed contribution is negative per `signedAmount()`'s convention); a credit line against income rows (positive). The server-side sum re-check in step 8 uses the exact same signing convention as the picker's display, so a mis-signed mismatch surfaces as an honest `deltaCents`, not a silent pass.
- **A race: another session/tab matches one of the selected rows first.** Caught at validation step 7 (pre-insert) and again as a `23505` at insert time (step 9) — either way, `409`, whole batch rejected, nothing partial commits.
- **Partial-week Zeffy selection error (human-judgment risk, not a system guard).** The treasurer could select the wrong subset that happens to sum correctly (e.g., grabs next week's rows instead of this week's). No system check catches this — Phase 1 named it explicitly as an accepted, existing risk class (same one the 1:1 flow already has), mitigated only by the picker surfacing enough context (date/party/amount, plus the new Zeffy chip) to visually confirm, and by per-row unmatch making the mistake cheap to fix.
- **Correcting a batch is "unmatch down to zero, then re-pick," not "add one more."** Per architect §4 (unchanged), once a bank line has *any* match it's "claimed" — the match route 409s on a re-POST to that `bankLineId` regardless of how many of its original matches remain after a partial per-row unmatch. So Phase 1 Flow 2's "the line's displayed count drops to 'Matched · 5' ... no longer balanced until re-matched" resolves in practice by the treasurer unmatching the *remaining* 5 (repeatable, per-row, down to zero) and then re-opening the picker to pick the corrected full set fresh — not by adding the one missing transaction back in isolation. This is bounded and intentional (Phase 1's binding answer confirmed per-row-only unmatch for v1), but is real UI friction for a 6-row batch with one wrong pick; flagging it now so it isn't rediscovered as a surprise in Phase 5. If real usage makes this painful, a fast-follow "add to an already-matched line while it's still short" mode is a bounded, reversible extension (relax the step-5 gate to "reject only when the line is *already balanced*," not "reject whenever any match exists").
- **The tie-out staying correct with batch matches.** Directly covered by Query rewrite 1 — this is the load-bearing correctness fix the whole feature depends on; see the named regression test below.
- **Month-gate window boundary.** A batch dated exactly at the 12-day edge (`daysBetween === 12`) is still treated as in-transit (`<=`, inclusive); at 13 days it gates. This boundary is a judgment call, not a hard invariant — the named unit test below pins the behavior at both a clearly-recent and a clearly-stale date rather than fencepost-testing the exact boundary, so a future window-length tweak (10 vs. 12 vs. 14) doesn't require rewriting the test's intent.
- **The naive-timestamp-as-UTC trap does not apply here.** Both `txnDate` and the `asOf`-derived reference date are handled as date-only, local-calendar values throughout (`daysBetween()`'s doc comment states this explicitly) — there is no `timestamp` column read as UTC anywhere in this carve-out, unlike the `reconciledAt` column `reconciledAtToYMD()` has to correct for elsewhere in this same file.
- **`getLatestOpenMonthForEntity`'s candidate computation must apply the same carve-out as `isMonthGatedForEntity`, or it silently re-truncates the picker** — this is not a hypothetical: it's the exact bug class already fixed once for outstanding checks (`docs/work-log/2026-07-28-report-gate-outstanding-checks.md`) and would recur here if only one of the two functions were updated.

## Implementer

**api-developer**, then **ux-developer** — in that order, not full-stack-developer. This is server-heavy (two query rewrites with real correctness stakes, an extended route with a nine-step validation sequence and an atomic multi-row insert, plus a new predicate threaded through two functions in a different file) ahead of a moderate but not tiny UI change (multi-select, running-sum, expandable grouping) — well past the "~150 lines across API + UI, tightly coupled" full-stack-developer threshold, and cleanly separable: the UI's props (`BankLineWithMatch.matchedTransactionIds`, `MatchedTransactionRow[]`, the batch match response shape) are a stable contract the moment api-developer ships them, exactly the "ux-developer builds once api-developer has shipped the contract" ordering this roster already follows.

1. **api-developer**: fan-out fix (step 1 above) → new read helper → batch match route → month-gate carve-out. Also writes the query-layer and route-layer unit tests named below (`getTieOutAssembly`, `getBankLinesForSession`, batch match route, month-gate).
2. **ux-developer**: match-picker multi-select/commit/Zeffy-chip, matching-grid expandable display + per-row unmatch, session-detail-page prop wiring, guide §10 update.

## Unit Tests to Write in Phase 4

All hermetic — `vi.mock("@/lib/db")`, no real database connection, matching this codebase's existing Vitest convention for `reconciliation-queries.ts`/`financial-report-queries.ts` coverage.

1. **`getTieOutAssembly` counts a batched line once** (the fan-out regression test) — canned rows: one bank line joined to 3 match rows (simulating the LEFT JOIN fan-out) → assert `matchedLineAmountsCents` has length 1, containing the line's amount exactly once, not 3×.
2. **`getBankLinesForSession` returns `matchedTransactionIds: string[]`** — a batch-matched line (3 joined rows) returns all 3 transaction ids, not just the last-joined one; an unmatched line returns `[]`; order/count of unrelated lines is preserved.
3. **Batch match commits atomically and marks all rows reconciled** — POST a 3-`transactionId` batch to the match route, assert one `db.transaction()` call inserting 3 rows sharing `bankLineId`; then close the session and assert all 3 underlying transactions end up `reconciled: true` (exercising `getMatchedTransactionIdsForSession` → close route's bulk update, unaffected by this feature but confirming the two halves compose correctly).
4. **Exact-sum enforced** — reject a batch selection 1 cent under and 1 cent over the bank line's amount; both `400` with the correct `deltaCents` sign.
5. **An ineligible row rejects the whole batch** — three sub-cases (already matched to a different line, different `bankAccountId`, already `reconciled: true`) each independently reject the *entire* batch with zero match rows inserted (assert the insert was never called, not just that the response is an error).
6. **Per-row unmatch leaves the rest** — DELETE one `matchId` out of a 3-match batch; assert the other 2 rows are untouched and the line's tie-out no longer balances (feeds back into test 1's fixed `getTieOutAssembly`).
7. **Expense-side batch (debit line ↔ N expense rows) sums correctly with signs** — a bank line with negative `amountCents` matched against 2 `flow: 'expense'` rows whose positive `amountCents` sum (signed negative) equals the line's amount exactly.
8. **Month-gate: a recent in-transit Zeffy deposit does NOT gate, but a stale one DOES** — `isMonthGatedForEntity` (or `isInTransitZeffyDepositRow` directly) with an injected `asOf`: one unreconciled `payment_method='zeffy', flow='income'` row dated 5 days before `asOf` → excluded, month clears; a second canned case with the same row dated 40 days before `asOf` → not excluded, month still gates.
9. **`getLatestOpenMonthForEntity` does not truncate the candidate solely due to a recent in-transit Zeffy row** — mirrors the outstanding-check regression test this repo already has; confirms the carve-out is applied in both places that need it, not just `isMonthGatedForEntity`.

---

# Phase 4 — Implementation (API) — 2026-07-28

**Owner:** api-developer
**Status:** complete

### Summary

Shipped the fan-out fix, the batch-capable match route, and the month-gate
carve-out per DECISION-051 — the full server contract for general
N-transactions-to-1-bank-line reconciliation (income or expense, Zeffy as
the worked example, not Zeffy-specific). Also made the minimal compile-time
ripple into the two client consumers of the changed types (per the design's
own Implementation Order step 1: "no new UI behavior yet, a prerequisite
before any batch write path can exist safely") so `tsc` and the existing
single-match flow both stay correct going into ux-developer's pass. All 9
Phase 3-named unit tests are written and passing, hermetically.

### What I did

- **Fan-out fix (`src/lib/reconciliation-queries.ts`):** rewrote
  `getTieOutAssembly()` to group LEFT-JOINed match rows by `line.id` in one
  JS pass before reducing, so a batch-matched line's amount is counted
  exactly once regardless of match count. Rewrote `getBankLinesForSession()`
  the same way; `BankLineWithMatch.matchId`/`matchedTransactionId` (singular)
  is replaced with `matchedTransactionIds: string[]`.
- **New read helpers:** `getMatchedTransactionsForSession()` (session-wide,
  one query, joins matches → transactions, carries `matchId` + `bankLineId`
  alongside transaction detail — feeds the UI's expandable per-line match
  list and per-row Unmatch button) and two bulk helpers used by the batch
  match route's validation sequence, `getTransactionsByIds()` and
  `getMatchesForTransactionIds()` (both `inArray`, no N+1).
- **Batch match route** (`.../match/route.ts`): rewrote to accept
  `{ bankLineId, transactionIds: string[] }` (array-only, min length 1) and
  run the full 9-step validation (parse/dedupe → session open → bank line
  unmatched → bulk-fetch + per-field validation → bulk already-matched
  check → exact-sum re-check on server-fetched signed amounts → atomic
  `db.transaction()` insert of all N rows → `23505` race mapped to 409).
  Rewrote the route's one existing caller
  (`reconciliation-match-picker.tsx`) to send `transactionIds: [id]` — no
  back-compat shim, per DECISION-051.
- **Month-gate carve-out** (`src/lib/financial-report-queries.ts`): added
  `isInTransitZeffyDepositRow()` (12-day window) + `daysBetween()`, threaded
  an optional `asOf: Date = new Date()` through both `isMonthGatedForEntity()`
  and `getLatestOpenMonthForEntity()` — anchored to `asOf`/"today", not
  `monthEnd`, per architect §5's explicit correctness requirement. Applied
  the carve-out to **both** `isMonthGatedForEntity()`'s `.some()` predicate
  and `getLatestOpenMonthForEntity()`'s own `blockingDates` filter (plus its
  final re-check call) — omitting the second would reintroduce the exact
  candidate-picker-truncation bug already fixed once for outstanding checks.
- **Consumer ripple, minimal/compile-only** (per Implementation Order step
  1, explicitly scoped as "no new UI behavior yet"):
  - `src/app/(dashboard)/admin/ledger/reconciliation/[sessionId]/page.tsx`
    (Server Component) — added the parallel `getMatchedTransactionsForSession(sessionId)`
    fetch, passed down as a new `matchedTransactions` prop.
  - `src/components/admin/ledger/reconciliation-matching-grid.tsx` — accepts
    the new prop, groups it by `bankLineId`, uses
    `matchedTransactionIds.length > 0` for the matched/unmatched cell. The
    Unmatch button is preserved for the (currently 100%-of-production)
    single-match case by resolving that line's one `matchId` from the new
    prop; a batch-matched line (>1 match) has no per-row Unmatch affordance
    yet — that's the expandable "Matched · N" list, explicitly ux-developer's
    Component Plan item, and is unreachable today regardless since the match
    picker (below) still only ever submits a 1-element array until
    ux-developer ships multi-select.
  - `src/components/admin/ledger/reconciliation-match-picker.tsx` — one-line
    change to the POST body (`transactionIds: [transactionId]`) to keep the
    existing single-pick flow working against the rewritten route; no other
    change (multi-select/running-sum/Zeffy chip are ux-developer's).
- **Unit tests** — `src/lib/reconciliation-queries.test.ts` (new),
  `src/app/api/admin/ledger/reconciliation/sessions/[sessionId]/match/route.test.ts`
  (new), and additions to `src/lib/financial-report-queries.test.ts`. See
  Outputs below for the full list against the Phase 3 names.
- Confirmed unchanged and still correct against the new types/queries, no
  edits needed: `.../match/[matchId]/route.ts` (DELETE, unaffected —
  already keyed on `matchId`, not `bankLineId`) and `.../close/route.ts`
  (consumes `getTieOutAssembly()`'s output as an opaque, now-correct input;
  no logic change required).

### Outputs

**API contract (for ux-developer):**

`POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match`
- Gate: `auth()` (401) + `hasFeature(LEDGER_RECORD)` (403).
- Request: `{ bankLineId: string; transactionIds: string[] }` — array-only,
  min length 1, no duplicates. A 1-element array is the plain single-match
  case (same code path).
- Response 201: `{ bankLineId: string; matchIds: string[]; transactionIds: string[]; count: number }`.
- 400 — malformed body (`transactionIds` empty/non-array/duplicates); a
  transaction is not `status='posted'` (`invalidTransactionIds`); a
  transaction belongs to a different bank account
  (`invalidTransactionIds`); selected transactions don't sum to the bank
  line's signed amount (`{ selectedSumCents, bankLineAmountCents, deltaCents }`,
  `deltaCents = bankLineAmountCents - selectedSumCents`: positive = short,
  negative = over).
- 404 — session not found; bank line not found; one or more transaction ids
  not found (`missingTransactionIds`).
- 409 — session not open; bank line already has ANY match (whole-set
  semantics, unchanged — a batch is matched once, never appended to); a
  transaction is already reconciled (`invalidTransactionIds`); a
  transaction is already matched to a different bank line
  (`conflictingTransactionIds`); or a race lost to a concurrent match on one
  of the selected ids (`23505` mapped to a clean 409, same message either
  way — "refresh and try again").
- Does not touch `reconciled`/`reconciledAt` — those still flip only at
  session close.

`DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]`
— **unchanged**, confirmed still correct: per-row unmatch, reusable as-is
for Flow 2's expandable-list Unmatch action once ux-developer builds it.

`POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close`
— **unchanged**, confirmed still correct: its "opening + cleared = closing"
arithmetic is now right for batch matches because `getTieOutAssembly()`'s
output is fixed, not because of any new logic in this route.

**New/changed exports from `src/lib/reconciliation-queries.ts`:**
- `BankLineWithMatch.matchedTransactionIds: string[]` (was singular
  `matchId`/`matchedTransactionId` — both removed).
- `getMatchedTransactionsForSession(sessionId): Promise<MatchedTransactionRow[]>`
  — new. `MatchedTransactionRow = CandidateTransactionRow & { matchId: string; bankLineId: string }`.
  Group by `bankLineId` client-side to render a line's matched-transaction
  list and source each row's Unmatch `matchId`.
- `getTransactionsByIds(ids): Promise<BatchMatchCandidateTransaction[]>` and
  `getMatchesForTransactionIds(ids): Promise<string[]>` — new, route-only
  bulk helpers (not needed outside the match route today, but exported like
  the rest of this file's helpers).
- `getTieOutAssembly()` — same signature/return type, now-correct values.

**`src/lib/financial-report-queries.ts`:**
- `isMonthGatedForEntity(entityId, monthEnd, asOf?: Date)` — new optional
  3rd param, additive/backward-compatible (every existing call site is
  unaffected, unset).
- `getLatestOpenMonthForEntity(entityId, asOf?: Date)` — new optional 2nd
  param, same additive shape.
- `isInTransitZeffyDepositRow()`/`daysBetween()` — internal (not exported),
  same visibility level as `isOutstandingCheckRow()`.

**Schema changes:** none — `ledger_reconciliation_matches.bank_line_id` was
already non-unique (DECISION-036); no migration needed, confirmed per
architect §1.

**Unit tests written (all 9 Phase 3-named tests, plus a few supplementary
cases), hermetic (`vi.mock("@/lib/db")`, no `DATABASE_URL`/`DB_URL` needed):**

| # | Phase 3 test | File |
|---|---|---|
| 1 | `getTieOutAssembly` counts a batched line once | `src/lib/reconciliation-queries.test.ts` |
| 2 | `getBankLinesForSession` returns `matchedTransactionIds: string[]` | `src/lib/reconciliation-queries.test.ts` |
| 3 | Batch match commits atomically (one `db.transaction()`, N rows sharing `bankLineId`) | `.../match/route.test.ts` |
| 4 | Exact-sum enforced (1 cent under / over, correct `deltaCents` sign) | `.../match/route.test.ts` |
| 5 | An ineligible row rejects the whole batch (3 sub-cases: matched elsewhere, wrong bank account, already reconciled) — insert never called | `.../match/route.test.ts` |
| 6 | Per-row unmatch leaves the rest | `src/lib/reconciliation-queries.test.ts` (as the N-1-rows variant of tests 1/2 — the DELETE route itself has no new logic; the observable effect lives in the read queries) |
| 7 | Expense-side batch (debit line ↔ N expense rows) sums with signs | `.../match/route.test.ts` |
| 8 | Month-gate: recent in-transit Zeffy deposit does NOT gate, stale one DOES | `src/lib/financial-report-queries.test.ts` |
| 9 | `getLatestOpenMonthForEntity` carve-out (no picker truncation) | `src/lib/financial-report-queries.test.ts` |

Test suite: 638 passed (was 614 before this feature; +24 new tests),
`unset DATABASE_URL DB_URL; pnpm test` — hermetic, confirmed. `pnpm exec tsc
--noEmit` — clean.

### Implementer Notes

- **`pnpm lint` / `pnpm exec eslint` is broken in this checkout** —
  pre-existing environment issue, unrelated to this feature (`ESLint`'s
  `minimatch` dependency fails to load: `SyntaxError: The requested module
  'minimatch' does not provide an export named 'default'`). Reproduced on
  `main` before my changes; flagging for deployment-engineer's dependency
  review rather than attempting a fix here (out of scope for this feature,
  and risks masking an unrelated pre-existing break). Did not skip a
  hand-check for `console.log`/dialog-native-usage — verified manually via
  `grep` across every file I touched; none found.
- **Interim client-consumer fix is deliberately minimal, not a UI
  redesign** — the design's own Implementation Order labels this step "no
  new UI behavior yet, a prerequisite before any batch write path can exist
  safely." I wired the new `matchedTransactions` prop through the session
  detail page and grid only far enough to (a) compile against the new
  `matchedTransactionIds[]` type and (b) preserve today's single-match
  Unmatch behavior unchanged. I deliberately did NOT build the "Matched ·
  N" expandable list, the multi-select picker, the running-sum footer, or
  the Zeffy filter chip — those remain ux-developer's Component Plan items
  in full, per the design's own implementer split.
- **Bulk validation helpers added to `reconciliation-queries.ts`, atomic
  insert kept in the route** — `getTransactionsByIds`/`getMatchesForTransactionIds`
  are read helpers, consistent with this file's existing role; the actual
  multi-row `db.transaction()` composition stays in the route handler,
  per this file's own documented convention and architect §2/§4 (multi-row
  atomic writes are never composed inside `reconciliation-queries.ts`).
- **Signed-sum convention matches the picker's existing `signedAmount()`
  exactly** (`flow === 'expense' ? -amountCents : amountCents` — expense
  negative, income positive) — re-implemented server-side in the route as
  `signedAmountCents()` rather than imported from the client component
  (server code must not import from `"use client"` files).
- **No deviation from the Phase 3 design.** Every route/query shape,
  validation order, and error code matches the design doc's API Contract
  section exactly.

### Open questions / handoff notes

**Next: ux-developer.** The server contract above is stable and ready to
build against. Specifically needed:

- Wire up `reconciliation-match-picker.tsx`'s multi-select + running-sum
  footer + commit bar + Zeffy-only filter chip, per the Phase 3 Component
  Plan — POST `{ bankLineId, transactionIds: [...selectedIds] }` (already
  the shape the route expects; only the single-id array literal I wrote
  needs to become a real multi-select `Set`). On a non-2xx response, keep
  the dialog open and `selectedIds` intact (Phase 1 Flow 1's named failure
  case) rather than clearing selection.
- Build `reconciliation-matching-grid.tsx`'s "Matched · N" expandable
  per-line list, sourced from the `matchedTransactions` prop already wired
  through (grouped by `bankLineId` — see the `matchesByBankLineId` Map I
  added, reusable as-is). Replace my interim single-match-only Unmatch
  button with the real per-row Unmatch reaching each match's own `matchId`.
- `getMatchedTransactionsForSession()` is the query to use for the
  expandable list's date/party/amount/matchId detail — it's already fetched
  and passed down; no new fetch needed.
- Two 4xx shapes to surface distinctly in the picker's UI: `400` with
  `deltaCents` (show the live-vs-committed short/over amount — the route
  re-derives this from server-fetched amounts, so a mismatch here means the
  client's own running sum was wrong, not just "try again") vs. `409` for
  every already-matched/race case (all say "refresh and try again" — no
  further UI distinction needed among the 409 sub-cases per the design).
- §10 of `src/components/admin/ledger/guide/reconciliation-section.tsx`
  ("coming soon") still needs the live-workflow rewrite — untouched by me,
  explicitly assigned to ux-developer in the Phase 3 Implementer
  breakdown.
- Correcting a wrong pick inside a committed batch is "unmatch every row
  down to zero, then re-pick the full corrected set" (per architect §4 /
  design Edge Cases) — the existing bank-line-already-matched 409 gate is
  unchanged, so this is a UI/UX flow note for you, not a server change.
- Release notes + version bump were explicitly out of my scope for this
  pass (task instructions) — leave for whoever finalizes the feature.

---

# Phase 4 — Implementation (UI) — 2026-07-28

**Owner:** ux-developer
**Status:** complete

### Summary

Built the full batch-match client experience on top of api-developer's
already-shipped server contract: `reconciliation-match-picker.tsx` is now a
true multi-select (checkboxes, running signed-sum indicator, commit gated on
exact balance) instead of one-instant-pick-per-row; `reconciliation-matching-
grid.tsx` renders a matched line as an expandable "Matched · N" with a
per-row Unmatch action sourced from `getMatchedTransactionsForSession()`
(already wired through by api-developer); and the guide's §10 "coming soon"
copy for batch mode now describes the live, generic workflow. Extracted the
selected-sum-vs-bank-line arithmetic into a pure, hermetically-tested helper
(`computeSelectionSummary` in `src/lib/reconciliation.ts`) shared by the
picker's live indicator and its own unit tests, mirroring the server's own
exact-sum re-check without duplicating untested logic.

### What I did

- **`src/lib/reconciliation.ts`** — added `computeSelectionSummary(selected,
  bankLineAmountCents)`, a pure function returning `{ selectedSumCents,
  bankLineAmountCents, deltaCents, balanced }`. Same signed convention as the
  picker's own `signedAmount()` display helper and the server route's
  `signedAmountCents()` (expense negative, income positive) — a debit bank
  line only balances against a selected set of expense rows, a credit line
  against income rows. Added 6 unit tests to `reconciliation.test.ts`
  (balanced batch, short by a cent, over by a cent, expense-side debit-line
  batch, empty selection, heterogeneous income+expense batch).
- **`reconciliation-match-picker.tsx`** — full rewrite:
  - Replaced the per-row instant "Match" button with a checkbox column
    (`selectedIds: Set<string>` state) plus a header "select all visible"
    checkbox (indeterminate when some-but-not-all of the currently
    filtered/sorted rows are selected).
  - Added a sticky footer/commit bar showing the running indicator —
    `"$500.00 of $500.00 — balanced"` (green), `"...— $24.00 short"` /
    `"...— over by $12.00"` (amber) when unselected/unbalanced, or a neutral
    prompt when nothing is selected yet — driven by `computeSelectionSummary`.
    "Match selected (N)" is disabled unless `selectedIds.size > 0` AND the
    signed sum equals the bank line's signed amount exactly.
  - On commit: `POST { bankLineId, transactionIds: [...selectedIds] }`
    (already the shape the route expects). Success → toast (pluralized:
    "Matched N transactions." vs "Matched."), close dialog, `router.refresh()`.
    Failure → **dialog stays open, `selectedIds` preserved** (Phase 1 Flow 1's
    named failure case — no re-checking 6 boxes after a dropped request).
  - Two 4xx shapes surfaced distinctly per the task brief: a `400` with a
    numeric `deltaCents` → `"Selected transactions must sum exactly to this
    line (off by $X.XX)."`; any `409` → `"One of these was just matched
    elsewhere — refresh and reselect."`; any other 4xx falls back to the
    server's own `error` string.
  - Generic candidate list preserved unfiltered — no hard filter. Added a
    **payment-method filter-chip row** (computed dynamically from the
    distinct `paymentMethod` values actually present — Check/Cash/Zeffy/Debit
    Card/Bill Pay/Other — not hardcoded to Zeffy), toggleable, composable
    with the existing search box; clearing/leaving all chips off shows every
    candidate. Added click-to-sort column headers (Date / Amount, ascending
    default, click again to flip direction) so a treasurer can visually
    cluster one week's rows when two batches' candidates are both sitting
    unmatched — matches the real 2026-07-28 case ($500 vs. the next ~$450).
  - A single-row pick is mechanically just a batch of one — same checkbox,
    same commit button, same POST shape — so single-select ergonomics still
    work unchanged.
- **`reconciliation-matching-grid.tsx`**:
  - Matched-line status cell is now a clickable "Matched · N" toggle
    (chevron + count from `line.matchedTransactionIds.length` — a legacy 1:1
    match naturally renders "Matched · 1", no special-casing) that
    expands/collapses a nested row beneath it.
  - The expanded row lists every `MatchedTransactionRow` for that
    `bankLineId` (grouped once per render from the `matchedTransactions`
    prop, already fetched via `getMatchedTransactionsForSession()` and
    wired through by api-developer) — date, party/memo, signed amount, and
    its own **per-row Unmatch** button targeting that row's specific
    `matchId`.
  - Unmatch reuses the existing `DELETE .../match/[matchId]` route unchanged,
    via the same `ConfirmDialog` pattern the interim single-match version
    used, now with a description naming the specific transaction being
    unmatched and noting sibling matches on the same line are unaffected.
  - Removed the interim single-match-only Unmatch button and its
    `singleMatchId` resolution — replaced by the expandable list's per-row
    action for every matched line regardless of match count.
  - Action column for a matched line is now empty (Match/Create-transaction
    buttons only ever render for `matchedTransactionIds.length === 0`,
    unchanged condition) — correcting a wrong pick is "unmatch down to zero,
    then re-open the picker to select the corrected set," per architect §4 /
    DECISION-051; the bank-line-already-matched 409 gate is unchanged.
- **`guide/reconciliation-section.tsx`** §10 — rewrote the file header
  comment and step 3 ("Match") to describe multi-select batch matching as
  live and generic (a lump-sum deposit OR a split expense, not Zeffy-only),
  including the running-total/exact-match/expand-to-unmatch behavior. The
  "Coming soon" callout now names only automatic match suggestions —
  batch-mode language is removed entirely since it shipped.
- **360px / mobile:** the picker's candidate table keeps its existing
  `overflow-x-auto` inner scroll container (only that container scrolls
  horizontally, never the page); the footer/commit bar and filter-chip row
  use `flex-col` on mobile, `sm:flex-row` at the `sm:` breakpoint; checkboxes
  are wrapped in `h-11 w-11` `<label>` targets for a 44px minimum touch
  target on both the header select-all and every row. The matching grid's
  expanded match list uses `flex-col sm:flex-row` per list item so the
  date/party text and amount+Unmatch controls stack cleanly at 360px.

### Outputs

- `src/lib/reconciliation.ts` — new `computeSelectionSummary()` +
  `SelectionCandidate`/`SelectionSummary` types.
- `src/lib/reconciliation.test.ts` — 6 new tests (`computeSelectionSummary`
  describe block, tests #23–28).
- `src/components/admin/ledger/reconciliation-match-picker.tsx` — full
  rewrite (multi-select, running-sum footer, commit gate, payment-method
  filter chips, sortable Date/Amount headers, 400/409 handling).
- `src/components/admin/ledger/reconciliation-matching-grid.tsx` — expandable
  "Matched · N" per-line list with per-row Unmatch, replacing the interim
  single-match-only Unmatch button api-developer wired for compile-safety.
- `src/components/admin/ledger/guide/reconciliation-section.tsx` — §10 batch
  mode copy updated from "coming soon" to live/generic; only automatic
  match suggestions remain "coming soon."
- No schema, route, or query changes — this phase is client-only, consuming
  the contract api-developer shipped (`BankLineWithMatch.matchedTransactionIds`,
  `getMatchedTransactionsForSession()`/`MatchedTransactionRow`, the batch
  `POST .../match` request/response/error shapes).

### Gates confirmed

- `pnpm exec tsc --noEmit` — clean.
- `unset DATABASE_URL DB_URL; pnpm test` — **644 passed** (was 638 before this
  pass; +6 new `computeSelectionSummary` tests), hermetic.
- `pnpm build:only` — production build passes.
- No `console.log` in any file touched this pass (grepped explicitly). No
  native `window.confirm`/`alert`/`prompt` — Unmatch uses `ConfirmDialog`
  exactly as the pre-existing single-match flow did.

### Implementer Notes

- **Multi-select + running-sum + commit gate:** `selectedIds: Set<string>`
  drives everything — the footer's `computeSelectionSummary(selected,
  bankLine.amountCents)` recomputes on every toggle, and the commit button's
  `disabled` prop is literally `selectedIds.size === 0 || !summary.balanced
  || committing`. This is a UX convenience only; the server (already shipped)
  re-derives the sum from its own DB fetch and rejects a mismatch
  independently, exactly as designed.
- **400 vs 409 copy:** distinguished per the task brief's exact wording — a
  400 with a numeric `deltaCents` becomes "Selected transactions must sum
  exactly to this line (off by $X.XX)"; every 409 becomes "One of these was
  just matched elsewhere — refresh and reselect," collapsing the route's
  several 409 sub-cases (already-reconciled, matched-elsewhere, session-not-
  open, insert-race) into one user-facing message per the Phase 3 design's
  own "no further UI distinction needed among the 409 sub-cases" note. Other
  4xx bodies (e.g., malformed/ineligible-transaction 400s the UI shouldn't
  normally be able to trigger since the candidate list is already
  eligibility-filtered server-side) fall back to the server's own `error`
  string rather than a generic message.
- **Generic candidate list, never hard-filtered:** the payment-method chips
  are pure client-side display narrowing — computed dynamically from
  whatever `paymentMethod` values are actually present in
  `candidateTransactions` (not hardcoded to `'zeffy'`), default state shows
  everything, and toggling a chip never removes a row from the underlying
  selectable set (a filtered-out row that's already checked stays checked
  and still counts toward the running sum — it's just not rendered while the
  filter is active).
- **Expandable "Matched · N" + per-row unmatch:** grouped `matchedTransactions`
  by `bankLineId` once per render (same pattern api-developer's interim
  wiring already established) and rendered as a `<tr><td colSpan>` sibling
  row immediately below the matched line, toggled per-line via an
  `expandedLineIds: Set<string>` — multiple lines can be expanded at once.
  Unmatch targets a specific `matchId`, reusing the unchanged `DELETE
  .../match/[matchId]` route.
- **Correcting a batch (architect §4):** the UI does not offer "add one more
  to an already-matched line" — the Match/Create-transaction buttons only
  ever appear when a line has zero matches, so fixing a wrong pick inside a
  6-row batch is unmatch-down-to-zero-then-re-pick, as scoped for v1. This is
  a known, accepted friction point per DECISION-051, not an oversight.
- **360px:** verified structurally (existing `overflow-x-auto` scroll
  container pattern reused, `flex-col`/`sm:flex-row` stacking on the new
  footer/filter-chip/expanded-list markup, 44px `<label>`-wrapped checkboxes)
  — qa should confirm visually in a real 360px viewport per the click-through
  list below.
- No deviation from the Phase 3 Component/Page Plan or DECISION-051.

### Open questions / handoff notes

**Next: qa (Phase 5).** Manual click-through list:

1. **Batch-match a full week's worth of rows summing exactly** (e.g., the
   worked $500 example, or any current session's candidates that sum to a
   bank line) — check several boxes, confirm the running indicator turns
   green/"balanced," commit, confirm the line shows "Matched · N" and the
   session's tie-out reflects the line's amount once, not N times.
2. **Off-by-a-cent (under and over)** — select rows summing $0.01 under and
   then $0.01 over a bank line's amount; confirm "Match selected" stays
   disabled and the indicator shows the correct short/over amount in both
   directions. (A genuine server-side 400 with `deltaCents` can only be
   forced via a race/direct API call since the UI's own gate already blocks
   it — worth confirming the copy renders correctly if qa wants to hit the
   route directly to exercise that path.)
3. **Expand a matched line and per-row Unmatch one transaction out of a
   multi-row batch** — confirm the other rows stay matched, the count drops
   (e.g., "Matched · 6" → "Matched · 5"), and the line no longer ties out
   until re-matched.
4. **An expense-side batch on a debit line** — select several expense rows
   that sum (signed negative) to a debit bank line's amount; confirm the
   running indicator and commit behave identically to the credit/income
   case.
5. **Payment-method filter chips + sort** — toggle a chip on/off and confirm
   no candidate ever disappears permanently (toggling off restores it);
   click the Date/Amount column headers and confirm sort direction flips.
6. **360px viewport** — open the match picker and an expanded matched-line
   list at a 360px width; confirm no horizontal PAGE scroll (only the
   candidate table's own inner scroll container), and that the footer/filter
   chips/expanded list stack cleanly.
7. **Guide copy** — `/admin/ledger/guide` §10 (Bank Reconciliation): confirm
   the "Match" step and "Coming soon" callout read correctly and no longer
   mention "Zeffy" or "one at a time" as the current behavior.

New copy strings the Lions Club may want to refine: the 400 message
("Selected transactions must sum exactly to this line (off by $X.XX).") and
the 409 message ("One of these was just matched elsewhere — refresh and
reselect.") are both new, functional but not yet treasurer-reviewed wording.

# Phase 5 — Verification (qa)

**Date:** 2026-07-28
**Verified by:** qa

## Summary

**PASS.** All four required gates are green, and the substance — the part
that matters for a money-reconciliation feature — checks out both in tests
and live against a throwaway session on the local dev DB. The fan-out fix
was verified two ways: read the code (groups by `line.id` before reducing)
and confirmed the regression test genuinely red-lines without it (reverted
the fix, watched 3 tests fail with the exact 3x-inflation signature, restored
the fix, watched them pass again). Same red/green discipline applied to the
month-gate carve-out (both `isMonthGatedForEntity`'s own predicate and
`getLatestOpenMonthForEntity`'s `blockingDates` filter/re-check — removing
either one breaks a distinct named test). Exact-sum enforcement, atomicity
(whole-batch rejection, no partial insert), and the expense-side (debit
line ↔ N expense rows) case were all driven live against the running dev
server with real HTTP requests and a signed-in admin session, not just
asserted from unit tests — and all four gave the exact response shape the
design doc specifies. Test data was created and fully cleaned up afterward;
no residue in the local DB.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no output, exit 0.

## Unit Tests

`unset DATABASE_URL DB_URL; pnpm test`: **PASS** (hermetic — confirmed no
`DATABASE_URL`/`DB_URL` in the shell environment for this run)
Total: 644 | Passed: 644 | Failed: 0
Duration: ~0.8–1.1s
Failures: none

This matches the implementers' reported count exactly (614 pre-feature →
638 after api-developer's pass → 644 after ux-developer's pass).

## Production Build

`pnpm build:only`: **PASS** — exit code 0, full route manifest generated
(all `/admin`, `/api/admin/*`, public, and `/members/*` routes present, no
new routes from this feature since none were added), no compiler errors or
warnings in the output. Re-ran twice to double-check after the regression
red/green cycle below touched (and fully restored) two source files.

## Hermeticity Regression Check

Confirmed `pnpm test` passes with `DATABASE_URL`/`DB_URL` unset — no
regression to the hermetic-test convention this feature's new test files
(`reconciliation-queries.test.ts`, `match/route.test.ts`) both follow the
existing `vi.mock("@/lib/db")` pattern; no real DB connection attempted.

## Dev-Server Smoke Test

`pnpm dev` against `.env.local`: **PASS**. Signed in via the
`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` credentials flow (Playwright,
`e2e/helpers/auth.ts`'s existing `signInAsAdmin()`), then:
- Reached `/admin/ledger/reconciliation/[sessionId]` for a throwaway session
  (see Live API Drive below) — rendered without a runtime error, and the
  matching grid's "Matched · N" badges reflected the exact live batch state
  (`Matched · 1`, `Matched · 2`) after a live batch-match + per-row unmatch
  sequence.
- Reached `/admin/ledger/guide` (Bank Reconciliation section) — rendered
  without a runtime error.

## Live API Drive (substance verification — money reconciliation, not just tests)

Created a throwaway reconciliation session, 3 bank lines, and 6 ledger
transactions directly in the local dev DB (the Neon instance `.env.local`
points at — not production; see project memory on this), then drove the
live route with a signed-in admin session's cookies via Playwright's
request context. All results matched the design doc exactly:

| Case | Request | Result | Verified |
|---|---|---|---|
| Exact-sum, 1 selected txn $10 short of a $60 line | `POST .../match` | **400**, `deltaCents: 1000` (positive = short, cents) | matches spec exactly |
| Ineligible row (already `reconciled: true`) | `POST .../match` | **409**, `invalidTransactionIds` names the offending id, whole batch rejected | matches spec |
| Income batch: 2 txns ($90+$60) exactly summing a $150 credit line | `POST .../match` | **201**, `count: 2`, both `matchIds` returned | atomic multi-row insert confirmed |
| Expense batch: 2 txns ($50+$30) exactly summing a **-$80 debit** line | `POST .../match` | **201**, `count: 2` | confirms the generic/signed expense-side case live, not just Zeffy/income |
| Re-POST to an already-matched line (whole-set semantics) | `POST .../match` | **409** | atomicity/whole-set gate confirmed live |
| Per-row unmatch of one match out of the income batch | `DELETE .../match/[matchId]` | **200** | confirmed via direct DB query afterward: the unmatched txn's row disappeared from `ledger_reconciliation_matches`, the sibling txn's match row was untouched |

Direct DB query after the sequence confirmed: `reconciled` stayed `false`
on every non-pre-reconciled test transaction (match never touches
`reconciled` — only session close does, per design); the credit line ended
with exactly 1 remaining match row, the debit line with 2 — exactly as
expected from the per-row-unmatch step.

All test fixtures (session, 3 bank lines, 6 transactions, all match rows)
were deleted after the run; confirmed zero residual rows with a follow-up
count query.

## Fan-Out Fix Verification (the load-bearing correctness item)

Read `getTieOutAssembly()` and `getBankLinesForSession()`
(`src/lib/reconciliation-queries.ts`): both group LEFT-JOINed rows by
`line.id` in a `Set`/`Map` pass *before* reducing — a batch-matched line's
`amountCents` is pushed into `matchedLineAmountsCents` exactly once
regardless of match count, and `matchedTransactionIds` collects every
matched id rather than the LEFT JOIN's last-joined row silently
overwriting the rest. Code matches the Phase 3 design's pseudocode exactly.

**Red/green confirmation (not just reading the code):** temporarily
reverted `getTieOutAssembly()` to the pre-fix naive per-joined-row
reduction (push `row.amountCents` on every row with a match, no grouping).
Re-ran `reconciliation-queries.test.ts`:

```
FAIL getTieOutAssembly > still separates matched from unmatched lines...
  AssertionError: expected [ 69600, 69600 ] to deeply equal [ 69600 ]
FAIL getTieOutAssembly > (Phase 3 test 6 — per-row unmatch leaves the rest)...
  AssertionError: expected [ 69600, 69600 ] to deeply equal [ 69600 ]
3 failed | 5 passed (8)
```

This is exactly the 3×/2× inflation the fan-out bug would cause in
production — a batch-matched line's amount counted once per match instead
of once per line, which would have silently broken the "opening + cleared =
closing" tie-out gate the moment any batch match existed. Restored the fix
(`diff` against the pre-edit backup confirmed byte-identical restoration),
re-ran: all 8 tests green again. Full suite re-run afterward: 644/644.

**Verdict: the regression test genuinely covers the bug — it is not a
tautological assertion that would pass under either implementation.**

## Exact-Sum / Atomicity / Signed-Amount Verification

- **Server re-fetches, never trusts the client:** confirmed by reading
  `match/route.ts` — step 8 sums `signedAmountCents()` computed from
  `getTransactionsByIds()`'s server-fetched `amountCents`/`flow`, not
  anything in the request body beyond the id list. Live-driven above
  (the $10-short case returned the server-computed `deltaCents`, not an
  echo of a client value — the request never sent a sum).
- **Atomicity:** `match/route.test.ts`'s three ineligible-row sub-cases
  (matched elsewhere, wrong bank account, already reconciled) each assert
  `mockTxState.transactionCallCount === 0` — the insert is provably never
  called, not just "the response is an error." Live-driven: the
  already-reconciled case returned 409 with zero rows inserted (confirmed
  by the subsequent DB query showing no new match rows for that line).
- **Signed/expense-side, generic (not Zeffy-only):** both the unit test
  (`match/route.test.ts`, debit line vs. 2 expense rows) and the live drive
  (a -$80 debit line matched against two $50/$30 expense transactions,
  201) confirm the mechanism works for the expense mirror case exactly as
  Phase 1's Scope Decision required, not merely for Zeffy income batches.

## Month-Gate Carve-Out Verification

Read `src/lib/financial-report-queries.ts`: `isInTransitZeffyDepositRow()`
anchors to `asOf`/"today" (`daysBetween(asOfYMD, r.txnDate) <= 12`), never
to `monthEnd` — confirmed this satisfies the "long-stale batch must still
flag" requirement (a fixed `monthEnd`-relative window would exclude a
forgotten batch forever; an `asOf`-relative window stops excluding it once
enough real time passes, regardless of which month is being evaluated).
Confirmed the carve-out is applied in **both** required places:
`isMonthGatedForEntity()`'s own `.some()` predicate (line ~412) AND
`getLatestOpenMonthForEntity()`'s `blockingDates` filter (line ~623) *and*
its final `isMonthGatedForEntity()` re-check call (line ~638, `asOf`
threaded through) — omitting the second would reintroduce the exact
candidate-truncation bug already fixed once for outstanding checks.

**Red/green confirmation:** temporarily removed
`!isInTransitZeffyDepositRow(r, asOf)` from `isMonthGatedForEntity()`'s
predicate only (left `getLatestOpenMonthForEntity()` untouched) and re-ran
`financial-report-queries.test.ts`:

```
FAIL ...does NOT gate on a recent in-transit Zeffy deposit...
  expected true to be false — Object.is equality (- false / + true)
FAIL getLatestOpenMonthForEntity...does not truncate the candidate month...
  expected null to be '2026-06' (getLatestOpenMonthForEntity's own final
  re-check call into the now-broken isMonthGatedForEntity propagated the
  regression, exactly as the design doc's Edge Cases warned it would)
2 failed | 30 passed (32)
```

Restored the fix (`diff` confirmed byte-identical restoration), re-ran: all
32 tests green. Full suite re-run afterward: 644/644.

Also read the three supplementary test cases and confirmed they pin the
behavior correctly without relying on the exact 12-day boundary (per the
design doc's own Edge Cases note that a fencepost test on the exact
threshold is brittle to a future window-length tweak):
- A row 6 days old (well inside the window) does not gate.
- The identical row 51 days old (well outside) does gate.
- A `zeffy`+`expense` row (not an income deposit) is never carved out,
  even within the window — confirms the carve-out is scoped to income
  deposits only, not payment-method alone.

## Per-Row Unmatch Verification

Unit-tested (`reconciliation-queries.test.ts`, simulating the row set
after a DELETE) and live-driven: deleted one match out of a 2-match income
batch via `DELETE .../match/[matchId]`, confirmed via direct DB query that
the sibling match row was untouched and the session page's grid dropped
from "Matched · 2" to "Matched · 1" for that line.

## Regression to Existing Flows

- **1:1 reconciliation flow:** unaffected — a 1-element `transactionIds`
  array is the same code path as a batch; existing `close/route.ts` and
  `match/[matchId]/route.ts` (unmatch) are confirmed unchanged (`git diff`
  shows no modifications to either file).
- **Tie-out/close gate:** covered above (Fan-Out Fix Verification) — this
  *is* the mechanism that keeps the existing close-gate arithmetic correct
  once batch matches exist.
- **Outstanding-checks carve-out (v1.42.1) and future-month gating:**
  `financial-report-queries.test.ts`'s pre-existing describe blocks for
  `isOutstandingCheckRow` and `hasMonthElapsed` are untouched by this
  feature's diff and still pass (part of the 644 total) — confirmed no
  regression by inspection of the diff (`git diff --stat` shows only
  additive changes to this file's predicate and an additional optional
  `asOf` param, no removed logic).

## Manual Click-Through (browser-only — not reachable in this harness)

Everything below requires visual/interactive confirmation in a real
browser; I did not observe these and am not claiming a pass on them. Per
ux-developer's Phase 4 handoff list:

| Flow | Result | Notes |
|------|--------|-------|
| Multi-select checkboxes + running-sum footer color states (green/amber) | not reachable in harness | needs visual confirmation |
| Commit button disabled-until-balanced, live toggling | not reachable in harness | logic is unit-tested (`computeSelectionSummary`) and the server-side gate was live-driven above; the *client* wiring (disabled prop reacting to checkbox toggles) needs a browser |
| 400/409 toast copy exact wording | not reachable in harness | route-level responses confirmed live above; toast rendering is client-only |
| Expandable "Matched · N" — click-to-expand/collapse interaction | not reachable in harness | the resulting badge text and count were confirmed live (see Dev-Server Smoke Test); the expand/collapse *interaction* itself needs a browser |
| Payment-method filter chips (toggle on/off, no row ever disappears permanently) | not reachable in harness | client-side filter logic, needs a browser |
| Sortable Date/Amount column headers | not reachable in harness | needs a browser |
| 360px viewport layout (footer/filter-chip/expanded-list stacking, no horizontal page scroll) | not reachable in harness | needs a real 360px viewport |
| Guide page (`/admin/ledger/guide` §10) copy readability/formatting | not reachable in harness | page load confirmed (Dev-Server Smoke Test); prose review needs a human read |

**Recommend the user (or whoever owns the next click-through) confirm these
in a real browser before Phase 6 closes** — none of them are correctness
risks the way the fan-out/exact-sum/month-gate items were (those are now
verified both by test and live API), but they are real user-facing
behavior this harness cannot observe.

## Regression Tests Added

(Written by api-developer/ux-developer in Phase 4, verified here to be
real, load-bearing, and red-before-green — see Fan-Out Fix Verification and
Month-Gate Carve-Out Verification above for the actual revert-and-observe
runs.)

- `getTieOutAssembly counts a batched line once` —
  `src/lib/reconciliation-queries.test.ts:81` — guards against: the
  fan-out bug that would silently N×-inflate the close-gate's "cleared"
  sum the moment any batch match existed, corrupting "opening + cleared =
  closing" for every session with a batch match.
- `getBankLinesForSession returns matchedTransactionIds... not just the
  last-joined one` — `src/lib/reconciliation-queries.test.ts:129` — guards
  against: the UI silently hiding all-but-one member of a batch match.
- `does NOT gate on a recent in-transit Zeffy deposit` /
  `STILL gates on the SAME Zeffy deposit once it's stale` —
  `src/lib/financial-report-queries.test.ts:285,303` — guards against: an
  unbounded exclusion hiding a genuinely broken/neglected Zeffy sync
  indefinitely, and against a `monthEnd`-anchored (rather than
  `asOf`-anchored) window that would exclude a stale batch forever.
- `getLatestOpenMonthForEntity ... does not truncate the candidate month
  solely due to a recent in-transit Zeffy row` —
  `src/lib/financial-report-queries.test.ts:345` — guards against:
  reintroducing the exact candidate-picker-truncation bug already fixed
  once for outstanding checks (`docs/work-log/2026-07-28-report-gate-outstanding-checks.md`),
  this time for in-transit Zeffy rows.
- `An ineligible row rejects the whole batch` (3 sub-cases) —
  `.../match/route.test.ts` — guards against: a partial/silent match
  commit when one row in a batch turns out ineligible.
- `Expense-side batch ... sums correctly with signs` —
  `.../match/route.test.ts` — guards against: the mechanism silently only
  working for the income/Zeffy case despite being specified as generic.

## Coverage on Critical Modules

- `src/lib/events.ts`: not touched by this feature — out of scope for this
  pass; last measured in a prior coverage review (see
  `docs/reviews/log.md` for the most recent test-coverage sweep date).
- `src/lib/permissions.ts`: not touched by this feature — no new
  `FEATURES` key, confirmed in the Feature-Gate Audit below.
- `src/lib/members.ts`: not touched by this feature.
- This feature's own new/changed modules —
  `src/lib/reconciliation-queries.ts` (fan-out fix + 3 new helpers),
  `src/lib/financial-report-queries.ts` (carve-out), `src/lib/reconciliation.ts`
  (`computeSelectionSummary`), and the batch `match/route.ts` — every
  branch named in the Phase 3 "Unit Tests to Write" list is covered (9/9),
  plus supplementary body-validation/auth-guard tests. Did not run
  `--coverage` for a numeric statement percentage on these specific files
  this pass; the branch-complete test list plus the live API drive above
  is the stronger signal for a money-correctness feature than a bare
  percentage would be.

## Feature-Gate Audit (mandatory before PASS)

No new `FEATURES` key — this feature reuses the existing `ledger.record`/
`ledger.manage` gates at a different request-body cardinality, per the
binding Phase 1/2/3 decisions. Read every route this feature touched:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/match` (extended, batch-capable) | yes | yes | `FEATURES.LEDGER_RECORD` — correct: this is the mutation that creates matches, same permission the pre-existing 1:1 match action required |
| `DELETE /api/admin/ledger/reconciliation/sessions/[sessionId]/match/[matchId]` (unchanged) | yes | yes | `FEATURES.LEDGER_RECORD` — correct, unchanged from before this feature |
| `POST /api/admin/ledger/reconciliation/sessions/[sessionId]/close` (unchanged, consumes the fixed `getTieOutAssembly` output) | yes (pre-existing, not touched this pass) | yes (pre-existing) | `FEATURES.LEDGER_MANAGE` or `LEDGER_RECORD` per its existing implementation — not modified by this feature, not re-audited line-by-line since the diff shows zero changes to this file |

Every route this feature actually *changed* (`match/route.ts`) carries both
gates with the correct key — confirmed by reading the file (see Live API
Drive above: the live-driven requests all used the authenticated admin
session and returned expected results; a quick unauthenticated check was
not separately re-driven since `auth()`/`hasFeature()` are unchanged
boilerplate identical to the pre-existing single-match route, already
covered by that route's own established test coverage).

## Verdict

**PASS**

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-28
**Owner:** analyst
**Status:** complete

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The treasurer can now select any set of unreconciled ledger rows — income or expense, any payment method — that sum exactly to one bank line and commit them as a single match, the fan-out bug that would have silently broken tie-out the moment a batch existed is fixed and red/green-verified, and a recency-bounded carve-out lets a fully-reconciled June publish while its next Zeffy deposit is still legitimately in transit; what's left is a browser-only click-through qa couldn't reach and two already-disclosed v1 friction points (batch correction, no auto-suggest) that are acceptable to ship with tracked follow-ups.

## What I Did

- Re-read the full work-log: Phase 1's binding "Human Answers" and "Scope Decision: General Capability" block, architect's Phase 2 ruling (§1–§6), tech-lead's Phase 3 design + DECISION-051, both Phase 4 subsections (api-developer, ux-developer), and qa's Phase 5 PASS.
- Verified every load-bearing claim directly against the working tree rather than trusting the narrative alone:
  - Read `match/route.ts` in full — confirmed the 9-step validation sequence, the `deltaCents` sign convention, the `23505`→409 race mapping, and the atomic `db.transaction()` insert match the Phase 3 API Contract exactly.
  - Read `getTieOutAssembly()` and `getBankLinesForSession()` in `reconciliation-queries.ts` — confirmed both group LEFT-JOINed rows by `line.id` before reducing (the fan-out fix), matching the Phase 3 pseudocode line-for-line.
  - Read `financial-report-queries.ts` — confirmed `isInTransitZeffyDepositRow()` anchors to `asOf`, not `monthEnd`, and is threaded through both `isMonthGatedForEntity()`'s predicate (line 413) and `getLatestOpenMonthForEntity()`'s `blockingDates` filter + final re-check call (lines 624, 638) — the exact two-places requirement architect §5 and tech-lead flagged.
  - Read `reconciliation-section.tsx` §10 — confirmed "coming soon" language for batch mode is gone, replaced with live/generic copy naming both the lump-sum-deposit and split-expense cases; only automatic match suggestions remain "coming soon."
  - Read `reconciliation-match-picker.tsx` — confirmed the candidate list is never hard-filtered (payment-method chips are `Set<string>` display narrowing computed dynamically from whatever methods are present, default state shows everything), confirmed brand consistency (`rounded-2xl` dialog, `rounded-lg` buttons/chips, `lions-blue`/`focus:ring-lions-blue`, no `window.confirm`).
  - Confirmed via `git status`/`git diff --stat` that `src/lib/db/schema.ts`, `drizzle/migrations/`, and `src/lib/permissions.ts` are untouched — no schema change, no new `FEATURES` key, as promised.
  - Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` with `DATABASE_URL`/`DB_URL` unset (644/644 passed) myself — matches qa's reported numbers exactly, not just re-quoting them.
  - Checked `docs/backlog.md` — B-05 ("matching grid shows no preview of what a bank line is matched to") is resolved by this feature's expandable "Matched · N" list; its companion cosmetic nit (Unmatch's `ConfirmDialog` uses `destructive` red styling despite being fully reversible) is untouched, already tracked, not new.
  - Confirmed DECISION-051 is logged in `docs/decisions.md` with the four Phase 3 implementation calls.

## Intent-vs-Shipped Diff

1. **Generic N-to-1 matching (income AND expense, no hard Zeffy filter).** Phase 1's binding Scope Decision required the candidate list to surface income and expense rows alike, with any Zeffy affordance as convenience only, never a hard filter. **Shipped:** confirmed in code — the picker's payment-method chips are computed from whatever methods are actually present and are pure client-side display narrowing (a checked-but-filtered-out row stays selected and still counts toward the sum); qa live-drove a real -$80 debit line ↔ 2 expense-row batch (201, `count: 2`) over HTTP against the running dev server, not just a unit test. **Verdict: matches.**

2. **Exact-sum-only, server-validated.** Phase 1 required the server to never trust the client's running-sum indicator and to reject any off-by-a-cent selection. **Shipped:** `match/route.ts` step 8 re-sums server-fetched `amountCents`/`flow` (never anything from the request body) and returns `400` with `deltaCents` on any mismatch. qa live-drove a $10-short case and got the server-computed delta, not an echo. **Verdict: matches.**

3. **Atomic commit; an ineligible row rejects the whole batch.** Phase 1/tech-lead required one `db.transaction()`, no partial commits. **Shipped:** confirmed in code (`tx.insert(...).values(dedupedTransactionIds.map(...))`, one call) and in `match/route.test.ts`'s three ineligible-row sub-cases, which assert the insert is never called — not just that the response is an error. qa live-drove the already-reconciled case and confirmed zero new match rows via direct DB query afterward. **Verdict: matches.**

4. **Per-row unmatch (v1; no batch-unmatch).** Phase 1's binding answer deferred one-click batch-unmatch. **Shipped:** the `DELETE .../match/[matchId]` route is unchanged (`git diff` shows zero modifications to that file); the grid's expandable list gives each matched row its own Unmatch button. **Verdict: matches**, exactly as scoped.

5. **Tie-out fan-out fix — a batched line counts once.** This was the load-bearing correctness item the whole feature depended on. **Shipped:** both `getTieOutAssembly()` and `getBankLinesForSession()` group by `line.id` before reducing (verified by reading the code myself, not just qa's report); qa additionally red/green'd it (reverted the fix, watched 3 tests fail with the exact 3×/2× inflation signature, restored, watched them pass). **Verdict: matches**, and independently re-verified by me.

6. **Month-gate carve-out, in both gate functions, anchored to `asOf` not `monthEnd`.** Phase 1 named this as part of the feature's scope (Flow 4 — "resolving it is part of this feature's scope, not a side effect to hope for"), and architect §5 flagged the anchor-to-`asOf` requirement as non-negotiable. **Shipped:** confirmed both call sites in `financial-report-queries.ts`; qa additionally red/green'd removing the carve-out from only one of the two functions and watched the exact candidate-truncation regression the design doc warned about reappear. **Verdict: matches.**

7. **No new permission key; no schema change.** Phase 1/Phase 2 explicitly ruled `ledger.record`/`ledger.manage` sufficient at the new cardinality, and `ledger_reconciliation_matches.bank_line_id`'s pre-existing non-unique constraint (DECISION-036) meant zero migration. **Shipped:** confirmed via `git status` — `schema.ts`, `drizzle/migrations/`, and `permissions.ts` show no changes at all. **Verdict: matches.**

8. **Guide §10 updated from "coming soon" to live/generic.** Phase 1 named this a required Phase 4 deliverable, not an optional follow-up. **Shipped:** confirmed — §10's prose now describes multi-select, the running total, the exact-match gate, and the expand/Unmatch flow, names both the lump-sum-deposit and split-expense cases, and only "automatic match suggestions" remain flagged "coming soon." **Verdict: matches.**

## Weighing the Known Open Items

- **Browser-only flows qa couldn't reach.** This is a real gap in verification, but not one that blocks SHIP: every item on qa's list (multi-select interaction, running-sum color states, toast copy, expand/collapse, filter/sort chips, 360px) is either (a) backed by a passing unit test for its underlying logic (`computeSelectionSummary`'s 6 tests cover the balanced/short/over/expense/empty/heterogeneous cases the color states render from) or (b) a live-verified server response that the client only needs to render faithfully (the 400/409 copy, the "Matched · N" count). None of these are money-correctness risks — those (fan-out, exact-sum, atomicity, month-gate) were independently verified by both qa and me, live and by reading the code. I'm treating the remaining visual/interaction confirmation as a **required pre-push manual pass, not a Phase 6 blocker** — see the exact click list below.
- **Batch-correction friction (unmatch-to-zero-then-re-pick).** Acceptable v1 boundary. This was named explicitly in Phase 1 Flow 2, ruled on by architect §4, confirmed as a binding decision by the treasurer (per-row-only unmatch for v1), and re-disclosed by tech-lead's Edge Cases and DECISION-051 item 4 with a concrete, bounded fast-follow already specified (relax the "any match exists" gate to "reject only when already balanced"). Nothing about this was discovered late or swept under the rug — filing it as a tracked follow-up below.
- **Auto-suggest deferred.** Acceptable v1 boundary, does not break the core use case. The origin problem is "let me manually select 6 rows that I can already see and identify" — auto-suggest is a convenience on top of a working manual mechanism, not a prerequisite for it. Phase 1's Out of Scope section, an existing schema-index comment, and the guide's own "coming soon" copy all independently confirm this was always the intended v1/v2 boundary.
- **Does this unblock the origin?** Yes — end-to-end path confirmed: (1) treasurer opens the June session, clicks Match on the 6/29 $500 bank line; (2) the picker shows every unreconciled posted transaction on the account, unfiltered; (3) treasurer checks the 5×6/24 + 1×6/25 zeffy rows (optionally using the payment-method chip or date sort to cluster them); (4) the running indicator turns green/"balanced" at exactly $500.00; (5) commits — the line shows "Matched · 6," and because of the fan-out fix, the session's cleared-total increases by $500 once, not $3,000 (6×500); (6) treasurer closes the session — the tie-out gate (opening + cleared = closing) is now correct; (7) the remaining ~$450 of June-dated Zeffy rows that clear in July's deposit are within the 12-day `asOf`-anchored in-transit window as of 2026-07-28 (six days out from 6/24-6/27), so `isMonthGatedForEntity`/`getLatestOpenMonthForEntity` no longer treat them as "books aren't done" — June's monthly statement gate clears and the member-facing page can publish. This is the real, verified 2026-07-28 blocker, and the shipped mechanism resolves every step of it, not just the batch-match half.

## Edge Cases

- Empty state: **not applicable** — this feature extends an existing workbench with existing candidate/bank-line records; no new empty-collection surface was introduced. The pre-existing "No transactions match this search/filter" and "No candidate transactions" states are untouched and still correct against the new type shapes (confirmed by reading the picker's conditional render).
- Failure microcopy: **pass** — every 4xx path has a human message (`"Selected transactions do not sum to the bank line amount"` with a computed short/over amount; `"This bank line is already matched — unmatch it first"`; `"One or more selected transactions were just matched elsewhere — refresh and try again"`), none are stack traces, and the client collapses the 409 sub-cases into one consistent "refresh and reselect" message per the design's own instruction. On a dropped request the dialog stays open with selections intact rather than forcing a re-pick — verified in code.
- Permission gate: **pass** — `match/route.ts` runs `auth()` (401) then `hasFeature(LEDGER_RECORD)` (403) before any body parsing; unchanged from the pre-existing single-match route's gate, confirmed by reading the file; qa's Feature-Gate Audit independently confirms the same. No new `FEATURES` key was introduced or needed.
- Mobile (360px): **pass, with one caveat** — structurally verified in code (the picker's existing `overflow-x-auto` inner-scroll table, `flex-col`/`sm:flex-row` stacking on the new footer/filter-chip/expanded-list markup, 44px `<label>`-wrapped checkboxes) but **not visually confirmed in a real 360px viewport by anyone yet** — qa explicitly flagged this as browser-only and unreachable in its harness. Structural pass, visual confirmation still owed — see click-through list below.

## Follow-Ups (SHIP WITH NOTES)

1. **Manual browser click-through before/after push (not itself a backlog item, but must happen before this is fully closed out).** Exact list — same as qa's handoff, reproduced here so it isn't lost:
   - Batch-match a full set of rows summing exactly to a bank line; confirm the running indicator goes green/"balanced," confirm "Matched · N" and that the session tie-out reflects the amount once, not N times.
   - Select rows $0.01 under and then $0.01 over a bank line's amount; confirm "Match selected" stays disabled and the short/over amount displays correctly in both directions.
   - Expand a matched line, per-row Unmatch one transaction out of a multi-row batch; confirm the count drops (e.g. "Matched · 6" → "Matched · 5") and the sibling rows stay matched.
   - An expense-side batch on a debit line — confirm the running indicator and commit behave identically to the credit/income case.
   - Toggle payment-method filter chips on/off; confirm no candidate ever disappears permanently, and that a checked-but-filtered-out row still counts toward the running sum.
   - Click the Date/Amount column headers; confirm sort direction flips.
   - Open the picker and an expanded matched-line list at 360px; confirm no horizontal *page* scroll (only the candidate table's own inner scroll), and that the footer/chips/expanded list stack cleanly.
   - `/admin/ledger/guide` §10 — read the "Match" step and "Coming soon" callout; confirm no stray "Zeffy" or "one at a time" language remains describing current behavior (I confirmed this by reading the source directly; a human read of the rendered page is still worth 60 seconds).
2. **Backlog: batch-correction fast-follow (relax the "any match → 409" gate to "reject only when already balanced").** Named in DECISION-051 item 4 and tech-lead's Edge Cases as a bounded, reversible extension if real usage makes unmatch-to-zero-then-re-pick painful for large batches. File to `docs/backlog.md` as a new `B-nn` item, priority nice-to-have, cross-referencing DECISION-051.
3. **Backlog: auto-suggest a batch (sum a week of same-payment-method rows against a deposit automatically).** Already named in Phase 1's Out of Scope and the guide's own "coming soon" callout — file to `docs/backlog.md` as a new `B-nn` item if not already present, cross-referencing this work-log and the schema-index comment (`ix_ledger_bank_lines_check_slip`) that already anticipated it.
4. **`docs/backlog.md` B-05 should be marked resolved.** B-05 ("Reconciliation matching grid shows no preview of what a bank line is matched to") is fully addressed by this feature's expandable "Matched · N" list (date/party/amount per matched row). Its companion cosmetic nit — Unmatch's `<ConfirmDialog>` still uses `destructive` (red) styling despite being a fully reversible action — was not touched this pass and should stay open as its own, separate low-priority item.
5. **New copy strings are functional but not yet treasurer-reviewed** (the `400` "Selected transactions must sum exactly to this line (off by $X.XX)" and `409` "One of these was just matched elsewhere — refresh and reselect" messages) — flagged by ux-developer, not blocking, worth a quick pass whenever the treasurer is next in the app.
6. **Release notes + version bump are still outstanding** (explicitly out of scope for both implementers' passes) — required before push per this project's standing workflow rule; not a Phase 6 gate but should happen in the same session as the push, alongside `/pre-push`.

None of the above are correctness risks — the money-arithmetic-critical items (fan-out, exact-sum, atomicity, month-gate) were independently verified twice over (qa's red/green + live API drive, and my own direct code read plus re-run of the test suite and typecheck). SHIP WITH NOTES ships now; the follow-ups are tracked, not blocking.

# Aged Public-Fund Guardrail Ages Money, Not the Fund — Work Log

> **Slug:** `2026-10-01-aged-public-fund-fifo`
> **Surface:** (dashboard) admin — Ledger dashboard compliance flags, `/admin/ledger` + `/admin/ledger/compliance`
> **Permission(s):** existing `ledger.*` gates cover this; no new key
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-01 |
| 2 — Architectural review | architect | Skipped | — | 2026-10-01 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer: api-developer | 2026-10-01 |
| 4 — Implementation | api-developer | Complete | typecheck, 2314 tests, build:only green | 2026-10-01 |
| 5 — Verification | qa | Complete | PASS | 2026-10-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-10-01 |

---

## Bug Report (from the treasurer, 2026-10-01)

The Ledger dashboard permanently shows:

> **Public fund holding undisbursed balance past 365-day threshold**
> 1 public fund has a positive balance and the oldest posted income is more than 365 days old (Charitable Fund). LCI guidance requires public funds to be returned to public use within a reasonable time — usually one year. …
> LCI Board Policy Manual Ch. VII — Public Fund Disbursement

Production Charitable Fund balance at the time: $8,973.75. The treasurer's words: *"it will never go away because the funds always will flex up and down and will never drain to 0."*

## Root Cause

`isAgedPublicFund()` in `src/lib/ledger.ts` (inc7 guardrail, DECISION-027/028) fires when a public fund has
(a) a positive cross-FY balance and (b) `MIN(txn_date)` of all posted income across all time is older than
`holdingPeriodWarnDays`. Condition (b) measures **the age of the fund**, not the age of the money currently
on hand. Once any public fund has existed for a year, the only way to clear the flag is a balance of exactly
zero — which an active fund never reaches. The check is therefore permanently on for every mature fund,
which makes it noise and trains the treasurer to ignore the compliance panel.

Local-DB evidence (2026-10-01): Charitable Fund balance $5,836.57; posted income in the trailing 365 days
$26,285.35; posted expense in the trailing 365 days $34,825.87. Money turned over several times in the year;
nothing on hand is old.

## Reproduction Steps

1. Sign in as an admin with ledger access; open `/admin/ledger`.
2. Observe the WARN flag above on any public fund whose first income is >365 days old and whose balance is >0.
3. Post enough expense to bring the fund's balance to $0.01 — flag persists. Post expense to reach $0.00 — flag clears.
   No amount of *recent* income/expense turnover affects the flag.

## Proposed Fix (for analyst/tech-lead to confirm)

Age the money FIFO: each posted expense consumes the oldest dollars first. The aged portion of a fund is
`max(0, crossFyBalance − posted income in the trailing holdingPeriodWarnDays)`. Fire only when the aged
portion is > 0, and name the aged amount in the flag text. Opening balance counts as the oldest money.

## Phase Skips

- **Phase 2 (architect) skipped:** no new directory, dependency, or invariant. The change rewrites one pure
  predicate and adds one aggregate query alongside the two it already runs. Not a durable-claim path.
  DECISION-027/028 get a correcting decision-log entry (owned by tech-lead in Phase 3).

---

# Phase 1 — Functional Refinement (analyst)

## Phase 1 — Functional Refinement — 2026-10-01

**Owner:** analyst
**Status:** complete

**Verdict:** READY WITH NOTES

**One-line take:** The bug is real and the FIFO fix is the right shape: the guardrail should ask "how much of the money on hand is old?", not "is the fund old?", and it should say how many dollars are old.

### Summary

Confirmed by reading the code, not by running it. `isAgedPublicFund()` (`src/lib/ledger.ts` ~897) fires on `crossFyBalanceCents > 0` AND `now - MIN(posted income txn_date, all time) > holdingPeriodWarnDays`. The second condition is a property of the fund (its first-ever income), and the first-ever income row never moves. So for any fund older than the threshold the flag reduces to "balance > 0", which a working fund never leaves. The treasurer's report ("never drain to 0") and the local-DB numbers in Root Cause (balance $5,836.57 against $26,285.35 of income in the last 365 days) both fit. Under the proposed formula that fund's aged portion is `max(0, 5,836.57 - 26,285.35) = 0` and the flag clears, which is the correct answer: nothing on hand can be older than a year when a year's income exceeds the balance.

The fix preserves the compliance intent. LCI Board Policy Ch. VII (as quoted in the flag text) is about public money being "returned to public use within a reasonable time"; that is a statement about money, so aging dollars is a more faithful reading than aging the fund. Dollars are consumed oldest-first, which is the standard, most treasurer-friendly convention (any disbursement counts toward clearing the oldest money). The Ch. VII manual itself is not in this repo, so the one thing I cannot verify is whether LCI would read it as FIFO. Treat that as a treasurer sign-off, not a blocker (Open question 1).

The aggregate formula `max(0, balance - trailing-window income)` is a correct closed form of dollar-FIFO. Old pool = opening + all income dated before the cutoff; every expense, whenever it happened, draws from that pool first because old dollars are always the oldest available; what is left is `old pool - all expense = balance - income inside the window`. No per-transaction lot tracking is needed.

### What I did

- Read the work-log, `isAgedPublicFund` / `countAgedPublicFunds` / `agedPublicFundNames`, the flag block in `guardrails()` (`ledger.ts` ~1257-1276), Query A / A2 and the fact-building in `getOverview()` (`ledger-queries.ts` ~3179-3266), `fundBalanceCents()`, DECISION-027/028, and the three copy sites listed below.
- Checked the only consumers: `agedPublicFunds` / `agedPublicFundNames` feed `guardrails()` from `getOverview()` and nowhere else. `getDashboard()` does not recompute it.
- Ran the five-pass review, abbreviated for a bug fix.

### User verbs (admin surface only)

- Admin (`ledger.*` holder) opens `/admin/ledger` or `/admin/ledger/compliance` and reads the guardrail flags.
- Admin (treasurer) posts or reconciles income, expense, and transfers; flag state should follow.
- Admin edits "Public fund holding period (days)" on the Ledger settings page.
- No public, access-pending or member-portal surface is touched.

### Flows

1. **Flag clears through normal turnover.** Treasurer posts/reconciles ordinary activity -> opens `/admin/ledger` -> aged portion = 0 -> no flag. Failure path: none new; the compliance panel already degrades with the rest of `getOverview()`.
2. **Flag fires on genuinely old money.** Fund holds more than the last-N-days income -> flag names the fund and the aged dollars -> treasurer disburses/sweeps or documents an earmark in minutes -> next load the aged amount shrinks or the flag clears.
3. **Treasurer retunes the threshold.** Settings page -> change days -> save -> flag recomputes on next load. Copy must describe the new rule (Gap 4).

### Permissions

Existing `ledger.*` gates cover this; no new key, no role-binding change. Pure read-side computation.

### Rulings on the five questions

**(1) Opening balance = oldest money: YES, agree.** It is pre-tracking money and must sit at the bottom of the FIFO stack. Notes for tech-lead:
- `ledger_funds` has no "opening balance as of" date, and `createdAt` is the seed date, not the money's date (the seed was anchored at 6/30/2024 but rows were created in 2026). Do not try to derive an age for it. Treat opening as unconditionally aged. Any expense draws it down first, so it clears itself through normal disbursement.
- **Behavior change to call out in the decision log:** under the old rule a fund with a positive opening balance and no income ever never flagged (`oldestPostedIncomeDate` null -> false). Under the new rule it flags. I think that is correct (a seeded balance that has never been spent is exactly what the rule exists to catch) but the treasurer should know a new flag could appear for a dormant fund (Open question 2).
- Consequence: Query A (`MIN(txn_date)` of income) is no longer needed by the predicate. It can be replaced by "posted income with `txn_date >= cutoff`", folded into A2 as a conditional sum (or one extra grouped query). `AgedPublicFundFact.oldestPostedIncomeDate` goes away or becomes unused; the 34 `countAgedPublicFunds` / `agedPublicFundNames` references in `ledger.test.ts` build that literal and will need updating. Tech-lead's call whether to keep the exported function names to limit blast radius.

**(2) Transfers: count them as ordinary flow (transfer-in = fresh, transfer-out = consumes oldest), and write the limitation down.**
How the code treats them today: transfers are two linked rows sharing `transferGroupId` and carry `flow = 'income'` on the receiving side and `flow = 'expense'` on the sending side (DECISION-016/017; a literal `'transfer'` flow never exists and `fundBalanceCents()` treats it as neutral if one ever appeared). Query A2 filters `flow IN ('income','expense')`, so transfer rows are already summed in as plain income/expense; the balance already includes them. Query A (oldest income) also already includes transfer-in rows. So "keep transfers as ordinary flow" is the zero-surprise choice and keeps one definition of income and balance (the DECISION-028/029 reuse discipline).
Why not exclude transfer-in from fresh money: the Treasury Guide's own Zeffy routing advice is to sweep Activity -> Foundation Charitable often. If transfer-in were treated as aged, every sweep would show up as aged money in the Charitable Fund, which is the fund in the bug report. That would recreate the permanent false positive in a new form. For a prompt sweep, "fresh" is also the honest answer.
The known hole: an old balance moved from Fund A to Fund B is consumed in A (expense) and arrives as "fresh" in B, so the transfer resets the clock for money that is still undisbursed. True age-carrying needs lot tracking across transfers and is out of proportion for this fix. Mitigations already in place: transfers are visible, audit-logged and reconciled; this guardrail is an advisory WARN, not a control. Tech-lead should (a) state this limitation in the correcting decision-log entry and (b) add a unit test that pins the chosen behavior so a later change is deliberate. I suggest filing it as a Watching item, B-80, "Aged-fund guardrail resets the clock on inter-fund transfers" (one line; skip if the user disagrees).
Cross-entity transfers (Club -> Foundation) follow the same rule.

**(3) Flag text: YES, show the aged dollars and the fund, per fund.** A bare count is what made the old flag unactionable. Recommended detail shape, one clause per qualifying fund: `Charitable Fund: $2,140.00 of its $8,973.75 balance has been on hand more than 365 days.` Keep the sentence that oldest dollars are counted as spent first, so the treasurer understands why a disbursement helps. Keep the earmark/minutes sentence for now; it is still the only escape valve until B-79 exists. Keep the flag **title** unchanged (stable for the guide row in `guardrails-section.tsx` and for anything matching on it; tech-lead to grep tests and e2e). This needs a new optional per-fund field on `GuardrailsInput` carrying `{ name, agedCents, balanceCents }` (same additive, optional pattern DECISION-032 used for names). The count and the amounts must still come from one shared predicate/function so they cannot disagree. Entity tagging on the dashboard is already handled by DECISION-032; confirm the new text survives that merge.

**(4) Settings copy: YES, reword; three sites, not one.**
- `src/components/admin/ledger/ledger-settings-form.tsx` lines 155-159 currently says the warning fires when "its oldest posted income is older than this many days". That is now false. Suggested: "Controls the aged public-fund guardrail. A warning fires when an Activity, Charitable, or Scholarship fund is holding money that has been on hand longer than this many days. Money is counted oldest-first: income and the opening balance are spent before newer income. LCI guidance calls for public funds to return to public use within a reasonable time, usually one year (365 days)."
- `src/components/admin/ledger/guide/settings-section.tsx` lines 42-44 ("how long a public/activity fund can hold an undisbursed balance") is close enough but should say "money", not "fund".
- `src/components/admin/ledger/guide/guardrails-section.tsx` ~line 82-84 `whatToDo` text. Add that the flag now shows how much is aged and that spending or sweeping it clears it oldest-first.
- Also ask tech-lead to correct the DECISION-027 and DECISION-028 wording ("oldest posted income older than N days") with a new dated correcting entry rather than editing history.

**(5) Earmarked multi-year project acknowledgment: YES, separate backlog item. Not in this fix.** It adds a data model (earmark record, amount, project, expected date), a UI and probably a minutes link, and it is a different decision (what counts as a legitimate hold) from the one being fixed (what counts as old money). Folding it in would turn a small bug fix into a feature and skip Phases 2-3. Proposed entry, tier **Later**:

> **B-79 — Let the treasurer record an earmark on a public fund so a deliberate multi-year hold stops tripping the aged-fund warning.** The aged public-fund guardrail (after the FIFO fix) only ever tells the treasurer to "document the project and expected disbursement date in the board minutes", and that documentation lives nowhere the guardrail can see. Add a per-fund (or per-amount) earmark: project name, earmarked amount, expected disbursement date, optional minutes citation. The guardrail would then subtract the earmarked amount from the aged portion, and show earmarked-but-overdue holds distinctly. Needs a Phase 1 of its own: who may create one (board action vs treasurer), whether it expires, and how it interacts with the audit log. Origin: Phase 1 of `docs/work-log/2026-10-01-aged-public-fund-fifo.md`.

### Gaps the request didn't address

- **G1 Window boundary and time zone.** Existing rule: aged if age > threshold, so income exactly `threshold` days old is still fresh. Keep that: fresh = `txn_date >= today - holdingPeriodWarnDays`. `txn_date` is a date, so compute the cutoff as a club-local `YYYY-MM-DD` string in TypeScript with an injectable `now`, and compare dates, never `now()` in SQL (DECISION-005 spirit). Test the exact-boundary day.
- **G2 Sign and units.** Aged cents must be clamped at 0 and also capped at the balance (clamp matters when fresh income exceeds balance). Balance <= 0 never fires. All math in integer cents; format dollars only at render.
- **G3 Test plan (Phase 3 must name these).** Named regression for the reported scenario (fund older than threshold, balance > 0, trailing income >= balance -> no flag); partial aging (balance 8,973.75, window income 6,833.75 -> aged 2,140.00); opening-only fund; expense larger than the old pool (aged 0, not negative); transfer-in treated as fresh (pins limitation); transfer-out consumes old; exactly-threshold boundary day; non-public kind ignored; count and names/amounts agree for multi-fund input.
- **G4 Dormant-fund behavior change** (see ruling 1): a seeded-balance fund with no activity now flags. Say so in release notes in treasurer language.
- **G5 Refund/negative-style income.** Any posted `flow='income'` row counts as fresh, including a vendor refund or reversal posted as income. That is the same "income" the rest of the ledger uses; accept, do not special-case.
- **G6 Expenses are not judged as "public use".** Any posted expense draws down aged money, same as the old rule's balance math. Not changing that; out of scope.
- **G7 Release notes.** User-facing, treasurer language, no file lists: the warning now looks at how long the money has been held, not how old the fund is, and tells you the amount.
- **Empty state:** a new install with no funds or zero balances produces no flag (pass). **Failure microcopy:** unchanged; flag block is computed inside `getOverview()` with everything else. **Mobile / brand:** unchanged markup; the detail string gets longer with several funds, so check it wraps at 360px. **OAuth / access-pending / email / Google Group sync:** not applicable.

### Adversarial pass

- Redirect targets, enumeration, input boundaries, self-targeting: not applicable (read-side computation, no new inputs). The threshold setting is already integer-validated client and server per the existing form; tech-lead should confirm the server validates `>= 1`.
- Masking by date edit: a treasurer can make aged money look fresh by posting or redating income inside the window, and the inter-fund transfer reset above is the same class. This is an advisory board-visibility WARN, not an anti-fraud control; reconciliation locks and the audit log are the existing mitigations. Accepted, noted in the decision-log entry.

### Out of scope (confirm with user)

- Earmark acknowledgment (B-79).
- Age-carrying across inter-fund transfers / lot tracking (suggested B-80, Watching).
- Distinguishing "public use" expenses from overhead expenses.
- Any change to Query B / the admin-public-income check, or to the other guardrails.

### Open questions

1. Treasurer / board: confirm LCI reads Ch. VII as "age of the money, oldest spent first" (I believe yes; the Ch. VII text is not in the repo).
2. User: OK that a dormant public fund holding only a seeded opening balance will now flag (previously silent)?
3. User: OK to file B-79 as worded and B-80 as a one-line Watching item?
4. Tech-lead: keep exported names `countAgedPublicFunds` / `agedPublicFundNames` with a new fact shape, or introduce one function returning `{name, agedCents, balanceCents}[]` and derive count and names from it?

### Outputs

- This section of `docs/work-log/2026-10-01-aged-public-fund-fifo.md` and the Phase 1 status row.
- No code, schema or docs/decisions.md changes (decision-log correction is tech-lead's, Phase 3). No backlog edit yet; B-79 wording above is ready to paste once the user confirms.

---

# Phase 3 — Technical Design (tech-lead)

## Phase 3 — Technical Design — 2026-10-01

**Owner:** tech-lead
**Status:** complete (bug-fix variant design note; Phase 2 skip stands — see "Why Phase 2 skip still holds")

### Summary

Root cause is unchanged from the report: `isAgedPublicFund()` tests the age of the fund (`MIN(txn_date)` of
all posted income, all time) instead of the age of the money on hand, so it collapses to "balance > 0" for
every fund older than the threshold. The fix replaces that predicate with a FIFO closed form: the aged part
of a public fund's balance is `balance − income posted inside the trailing window`, clamped to `[0, balance]`.
The flag fires only when that is > 0, and its detail text now names each fund with its aged dollars and its
balance. One shared function returns `{ fundName, agedCents, balanceCents }[]`; the count, the names and the
flag text are all derived from that one array, so they cannot disagree. `getOverview()` drops Query A
(`MIN(txn_date)`) and gains a trailing-window income sum folded into the existing Query A2. No schema change,
no migration, no new permission key, no new dependency.

### Exact formula and window boundary

All arithmetic is integer cents. For one public fund (kind in activity / charitable / scholarship):

```
today   = clubLocalDateString(now)                       // 'YYYY-MM-DD', America/New_York
cutoff  = today minus holdingPeriodWarnDays calendar days // 'YYYY-MM-DD', pure UTC date math
fresh   = SUM(amount_cents) of posted flow='income' rows with txn_date >= cutoff
balance = fundBalanceCents(openingBalanceCents, [income-total, expense-total])   // unchanged, all-time
aged    = min(balance, max(0, balance - fresh))
flag    = balance > 0 && aged > 0
```

Why this equals dollar-FIFO (the analyst's argument, restated so the implementer can put it in a code
comment): the "old pool" is the opening balance plus all income dated before the cutoff. Every expense, at
whatever date, draws the oldest dollars first, and the old pool is always older than any in-window dollar,
so all expenses come out of the old pool first. What remains of the old pool is
`oldPool − allExpense = balance − freshIncome`, floored at 0 once expenses reach into fresh money.

**Boundary day.** The old rule was "aged iff age > threshold", so income exactly `threshold` days old was
still fresh. Preserved: income is fresh iff `today − txn_date <= threshold`, i.e. `txn_date >= cutoff`.
Worked example, threshold 365, today 2026-07-20: cutoff = 2025-07-20. Income dated 2025-07-20 is fresh
(exactly 365 days old); income dated 2025-07-19 is aged (366 days).

**Date handling (DECISION-005 spirit).** `txn_date` is a Postgres `date`. The cutoff is computed in TypeScript
as a string and passed as a bound parameter; SQL never calls `now()` / `CURRENT_DATE`.
- New exported pure helper `clubLocalDateString(now: Date = new Date()): string` in `src/lib/ledger.ts`:
  `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year/month/day: numeric/2-digit })` via
  `formatToParts`, assembled as `YYYY-MM-DD`. Do NOT reuse `nowEastern()` from `events.ts`: it returns a
  fake wall-clock `Date` that is only valid through local getters, which is exactly the trap its own
  docblock warns about, and it would also drag `events.ts` (date-fns) into `ledger.ts`. A real instant in,
  an Eastern calendar date string out.
- New exported pure helper `agedPublicFundCutoffDate(thresholdDays: number, now: Date = new Date()): string`:
  takes `clubLocalDateString(now)`, parses y/m/d, does `Date.UTC(y, m - 1, d - thresholdDays)` and formats
  with `toISOString().slice(0, 10)`. UTC date arithmetic has no DST drift. This is the only place the
  window boundary is defined; the query and the tests both call it.
- `holdingPeriodWarnDays` is already validated server-side as a positive integer
  (`src/app/api/admin/ledger/settings/route.ts` lines 105-113, `v <= 0` rejected), so the analyst's
  ">= 1" check is satisfied; no route change.

### The shared function and fact shape (src/lib/ledger.ts)

Replace the `countAgedPublicFunds` / `agedPublicFundNames` / private `isAgedPublicFund` trio with one
exported function. Delete the old exports outright (their only production consumer is `getOverview()`;
no re-export shims).

```ts
export type AgedPublicFundFact = {
  fundKind: string;
  fundName: string;                 // now required (only caller always has it); "Unnamed fund" fallback removed
  /** True life-to-date balance, no fiscal-year bound (DECISION-028 unchanged). */
  crossFyBalanceCents: number;
  /** Posted flow='income' with txn_date >= agedPublicFundCutoffDate(): the "fresh" money.
   *  Counts transfer-in rows exactly like any other income (B-80). */
  trailingWindowIncomeCents: number;
};

export type AgedPublicFund = { fundName: string; agedCents: number; balanceCents: number };

export function computeAgedPublicFunds(funds: AgedPublicFundFact[]): AgedPublicFund[];
```

Design note on parameters: the window has already been applied by the query (that is what
`trailingWindowIncomeCents` means), so the pure function takes neither `thresholdDays` nor `now`. This
removes the old function's injectable `now`; that seam moves to `agedPublicFundCutoffDate()`, which is where
the boundary and time-zone tests belong. Behavior: skip non-public kinds; skip `crossFyBalanceCents <= 0`;
`agedCents = Math.min(bal, Math.max(0, bal - fresh))`; skip `agedCents === 0`; preserve input order.

### Query change (src/lib/ledger-queries.ts, getOverview())

- **Remove Query A** (`oldestIncomeRows` / `oldestDateByFundId`, ~3183-3204) and the `oldestPostedIncomeDate`
  field. Remove the now-unused imports `countAgedPublicFunds`, `agedPublicFundNames`; keep `publicFundIds`.
- **Keep Query A2** (cross-FY income/expense totals per public fund, grouped by `fund_id, flow`) and **fold
  the trailing-window income into it as one extra conditional-sum column** rather than a third round trip:
  ```ts
  const cutoff = agedPublicFundCutoffDate(settings.holdingPeriodWarnDays);
  // added to the select list:
  windowCents: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerTransactions.txnDate} >= ${cutoff}::date THEN ${ledgerTransactions.amountCents} ELSE 0 END), 0)`,
  ```
  Read `windowCents` only from the `flow === 'income'` group rows into a new `windowIncomeByFundId` map
  (the expense group's value is ignored). The `::date` cast on the bound parameter is deliberate so the
  driver does not send an untyped text comparison. Do not add a `transfer_group_id` filter: transfer-in rows
  are ordinary income here by design (limitation recorded in the decision and B-80). Put a one-line comment
  saying so next to the query.
- `agedPublicFundFacts` loses `oldestPostedIncomeDate`, gains `trailingWindowIncomeCents:
  windowIncomeByFundId.get(f.id) ?? 0`. `crossFyBalanceCents` is still built with `fundBalanceCents()`.
- Replace `agedPublicFundsRaw` / `agedPublicFundNamesRaw` / `agedPublicFunds` (the `Math.max(0, ...)`
  guard is no longer meaningful for an array) with `const agedPublicFunds = computeAgedPublicFunds(agedPublicFundFacts);`
  and pass it to `guardrails()`.
- Net query count in `getOverview()` goes from 2 aggregate queries (A, A2) to 1 (A2). No N+1.
- `getDashboard()` / `getComplianceOverview()` do not recompute this; they consume `overview.guardrailFlags`
  and render `flag.detail` as plain text (`ledger-entity-detail.tsx`, `audit-items-panel.tsx`), so the new,
  longer detail string passes through DECISION-032's entity-tag merge untouched. Implementer: confirm by eye
  at `/admin/ledger` and check the wrap at 360px.

### GuardrailsInput change (src/lib/ledger.ts)

Replace the two fields
```ts
agedPublicFunds: number;
agedPublicFundNames?: string[];
```
with one required field `agedPublicFunds: AgedPublicFund[];` (empty array = no flag). Count is
`agedPublicFunds.length`; there is no separate count or names field to drift. Update the field's docblock to
the FIFO wording. The two shared `cleanState` literals in `ledger.test.ts` (lines ~643 and ~1119,
`agedPublicFunds: 0`) become `agedPublicFunds: []`. No other `guardrails()` caller passes this field
(`grep` confirms only `getOverview()`).

### Flag text

Title: **unchanged** (stable for the guide row and for tests that match `/holding.*threshold/i`):
`Public fund${n === 1 ? "" : "s"} holding undisbursed balance past ${N}-day threshold`, `n = agedPublicFunds.length`.

Detail: one clause per fund, in input order, then the fixed explanation:

```
{Fund Name}: {aged} of its {balance} balance has been on hand more than {N} days. [repeat per fund]
Money is counted oldest-first, so any disbursement from the fund reduces the aged amount.
LCI guidance requires public funds to be returned to public use within a reasonable time — usually one
year. If any of this is earmarked for a specific multi-year project, document the project name and
expected disbursement date in the board meeting minutes.
```
Example: `Charitable Fund: $2,140.00 of its $8,973.75 balance has been on hand more than 365 days. Money is counted oldest-first, ...`
Formatting: `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` of `cents / 100`, via one small
private helper in `ledger.ts`. Other guardrail details in this file use `$${(c/100).toFixed(2)}` (no
thousands separator); before adding a helper the implementer must grep `src/lib` for an existing
comma-formatting helper and reuse it if one exists, and must not change the other flags' formatting. The
parenthetical-names suffix (DECISION-032) is removed; names are now inside each clause. Keep `policyCite`
unchanged. The word "minutes" stays in the detail (an existing test asserts it).

### The three copy edits

1. `src/components/admin/ledger/ledger-settings-form.tsx` lines ~155-159 (the helper `<p>` under "Public
   fund holding period (days)"). Replace with: "Controls the aged public-fund guardrail. A warning fires
   when an Activity, Charitable, or Scholarship fund is holding money that has been on hand longer than
   this many days. Money is counted oldest-first: the opening balance and older income are treated as spent
   before newer income. LCI guidance calls for public funds to return to public use within a reasonable
   time — usually one year (365 days)."
2. `src/components/admin/ledger/guide/settings-section.tsx` lines ~42-44: "how long a public/activity
   fund can hold an undisbursed balance before the aged-public-fund guardrail warns" becomes "how long
   public money can sit in a public (Activity, Charitable or Scholarship) fund, counted oldest-first, before
   the aged-public-fund guardrail warns."
3. `src/components/admin/ledger/guide/guardrails-section.tsx` ~line 82-84 `whatToDo` for the "Public
   fund(s) holding undisbursed balance past threshold" row: "The flag names each fund and how much of its
   balance is past the holding period. Money is counted oldest-first, so disbursing or sweeping from the
   fund reduces the aged amount; if the money is earmarked for a specific multi-year project, document that
   in board minutes." Keep the row `title` unchanged.

### Unit tests the implementer must deliver (src/lib/ledger.test.ts, Phase 4 gate)

Migration of existing tests first. The old tests reference the removed API: 19 call sites of
`countAgedPublicFunds(` / `agedPublicFundNames(` plus 15 `AgedPublicFundFact[]` literal arrays = **34
references** (31 `oldestPostedIncomeDate` fields inside them). Do not mechanically port them: delete the
`describe("countAgedPublicFunds")` (line ~270) and `describe("agedPublicFundNames")` (line ~411) blocks and
replace them with the new blocks below, keeping the intent of the cases that still apply (empty input,
non-public kind ignored, balance <= 0 ignored, FY-scoping regression of DECISION-028 expressed as "cross-FY
balance positive", multi-fund order, count-equals-names agreement now expressed as one array). The
`guardrails()` blocks at ~1532-1620 are migrated from `agedPublicFunds: 1` / `agedPublicFundNames` to
`AgedPublicFund[]` fixtures.

`describe("computeAgedPublicFunds")` (NOW-independent; facts carry the window sum):
1. `returns [] for empty input`
2. `REGRESSION 2026-10-01: a mature fund whose trailing-window income exceeds its balance is not aged` —
   Charitable, balance 583657, window 2628535 (the local-DB figures) -> `[]`; sibling case with the
   production figure, balance 897375, window 2628535 -> `[]`.
3. `partial aging: balance 897375 with 683375 fresh income reports agedCents 214000` (full object
   `{ fundName, agedCents: 214000, balanceCents: 897375 }`)
4. `window income exactly equal to balance is not aged` and `window income greater than balance clamps to 0,
   never negative` (an expense larger than the old pool)
5. `opening-balance-only fund (no income at all) is flagged with aged = full balance` (the DECISION change:
   dormant seeded fund now flags; balance 500000, window 0 -> aged 500000)
6. `transfer-in counts as fresh money (known limitation, B-80)` — a fund whose whole balance arrived as a
   transfer-in inside the window: `balance 1000000, trailingWindowIncomeCents 1000000` -> `[]`. Comment must
   say the query deliberately counts transfer-in rows as income and cite B-80.
7. `transfer-out consumes the oldest money first` — balance 600000 after a 400000 transfer-out, window
   100000 -> aged 500000.
8. `non-public kinds (administrative) are ignored even with an old positive balance`
9. `non-positive balances (0 and negative) are never flagged`
10. `multi-fund input: preserves input order, drops the non-qualifying, and every entry satisfies 0 <
    agedCents <= balanceCents`

`describe("agedPublicFundCutoffDate / clubLocalDateString")` (this is where `now` and the boundary live):
11. `exact boundary: threshold 365 at 2026-07-20T16:00:00Z gives cutoff 2025-07-20, and income dated
    exactly the cutoff is fresh (>=) while 2025-07-19 is aged` — assert the cutoff string and the `>=`
    comparison against two date strings.
12. `threshold 30 boundary` (same shape, cutoff 2026-06-20).
13. `club-local date, not UTC: 2026-07-21T02:00:00Z (10 PM EDT on Jul 20) uses today = 2026-07-20, and
    2026-07-20T03:59:59Z (11:59 PM EDT Jul 19) uses 2026-07-19`. Existing tests use `T00:00:00Z`, which is
    8 PM the prior day in EDT; the implementer must not rely on that for new tests.
14. `leap-year window: 2028-03-01 minus 365 = 2027-03-02` (UTC date math, no DST drift) and a winter/summer
    pair around a DST change.

`guardrails()` migrated/added tests:
15. `does NOT fire when agedPublicFunds is []`
16. `fires WARN for one fund; title unchanged; detail names the fund and "$2,140.00 of its $8,973.75
    balance has been on hand more than 365 days"` (exact string, thousands separators)
17. `two funds: plural title ("Public funds"), two clauses in input order`
18. `detail contains the configured holdingPeriodWarnDays (180) and the word "minutes" and "oldest-first"`
19. `small amounts render with cents ($0.05)`

After the unit tests: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build:only`. grep `e2e/` for the flag title
(none found today, `grep` of `src` and `e2e` returned only the files listed here).

### Release-notes line (write via /release-notes when preparing to merge; v1.84.md, patch 1.84.1, Type: Fix)

> **Fix: the "public fund holding undisbursed balance" warning now clears when the money turns over.**
> The Ledger used to warn on any Activity, Charitable or Scholarship fund whose first-ever income was more
> than a year old and that still had a balance. For a working fund that never drains to zero, the warning
> could never go away. It now looks at how long the money has been sitting there: income and the opening
> balance are counted as spent oldest-first, and the warning shows how many dollars of each fund's balance
> are past the holding period. Ordinary activity clears it; disbursing or sweeping the remainder clears the
> rest. One thing you may notice: a public fund that holds only an opening balance and has had no activity
> will now show the warning, because that money really is old.

No file lists (project rule).

### Why Phase 2 skip still holds

No new directory, dependency or invariant; one pure predicate rewritten, one aggregate query slimmed. Not a
durable-claim path (no send, no `sentAt`). Re-checked against the architect-owned rules: no hand-rolled
duplication added (one helper owns the boundary, one function owns the aging rule, the flag text reads the
same array), and the `fundBalanceCents()` reuse from DECISION-028 is preserved.

### Edge cases and risks

- **Date-edit masking and transfer reset:** posting or redating income inside the window, or sweeping an old
  balance to another fund, makes money look fresh. Accepted: advisory WARN, not a control; reconciliation
  locks and the audit log are the mitigations. Recorded in the decision; B-80 tracks transfers.
- **Refund-style income** counts as fresh (analyst G5). Accepted.
- **Dormant opening-balance-only fund now flags** (analyst ruling 1 / orchestrator answer 2). Release note
  covers it. Opening balance has no date in `ledger_funds`, so it is treated as unconditionally oldest.
- **Excluded-from-the-window but still posted:** `status = 'posted'` filter stays; pending/rejected rows
  neither add balance nor fresh income.
- **Fund-name collisions:** two entities each have a "Charitable Fund"; `getDashboard()` already tags flags
  by entity (DECISION-032), and each `getOverview()` call is per-entity, so clauses never mix entities.
- **Type honesty:** `fundName` becomes required on the fact; `AgedPublicFund` has no optional fields.

### Out of scope

- Earmark acknowledgment (B-79, filed). Age-carrying across transfers (B-80, filed).
- Treating overhead vs "public use" expenses differently (analyst G6).
- Other guardrails, Query B / the admin-public-income check, any schema change, any settings-route change.

### Outputs

- `docs/work-log/2026-10-01-aged-public-fund-fifo.md` (this section, status table).
- `docs/decisions.md`: **DECISION-105** (correcting entry; supersedes the age-of-fund rule in DECISION-027 Ruling B and DECISION-028 point 1/3).
- `docs/backlog.md`: **B-79** (Later), **B-80** (Watching / needs info).

### Open questions / handoff notes

- Use the **api-developer** agent for the whole of Phase 4: the work is `ledger.ts` + `ledger-queries.ts` +
  `ledger.test.ts` (server/pure logic), plus three one-paragraph copy edits in `.tsx` files that are
  string-only and carry no UI logic. Splitting those three strings out to ux-developer would be pure
  handoff overhead; the api-developer owns them. No database-admin work (no schema/migration).
- Treasurer sign-off item (non-blocking): the FIFO reading of LCI Ch. VII is recorded in DECISION-105 so the
  treasurer can object there. If LCI reads it differently the change is local to `computeAgedPublicFunds()`.
- Phase 5 qa: reproduce on the pre-fix code by loading `/admin/ledger` against the dev DB (Charitable Fund
  balance $5,836.57, trailing income $26,285.35): flag present before, absent after. Then post a test
  income/expense in dev to confirm the partial-aging text. Never send live email (no email path here).
- Phase 6 release notes: version 1.84.1 (patch, bug fix) unless the user wants a minor bump.


---

# Phase 4 — Implementation

## Phase 4 — Implementation (API) — 2026-10-01

**Owner:** api-developer
**Status:** complete

### Summary
Implemented the Phase 3 design as written: one pure `computeAgedPublicFunds()` with the FIFO closed form, `clubLocalDateString()` / `agedPublicFundCutoffDate()` owning the window boundary, `GuardrailsInput.agedPublicFunds` is now `AgedPublicFund[]`, per-fund flag text (title unchanged), Query A removed and the trailing-window income folded into Query A2, three copy edits, release notes 1.84.1. No schema change.

### What I did
- `ledger.ts`: removed `countAgedPublicFunds` / `agedPublicFundNames` / `isAgedPublicFund`; added `AgedPublicFundFact` (fundName required, `trailingWindowIncomeCents`), `AgedPublicFund`, `clubLocalDateString`, `agedPublicFundCutoffDate`, `computeAgedPublicFunds`, private `formatUsdCents`; rewrote the flag block.
- `ledger-queries.ts` `getOverview()`: Query A deleted; Query A2 gains a `windowCents` conditional-sum column (cutoff bound as a `::date` parameter, no `now()` in SQL, no transfer filter, comment cites B-80); `windowIncomeByFundId` read from the income group only; `agedPublicFunds = computeAgedPublicFunds(...)` passed straight to `guardrails()`.
- Copy edits in `ledger-settings-form.tsx`, `guide/settings-section.tsx`, `guide/guardrails-section.tsx` (row title unchanged), using the design's wording.
- `ledger.test.ts`: deleted the `countAgedPublicFunds` and `agedPublicFundNames` describes and the two old guardrails aged-fund describes; added `computeAgedPublicFunds` (10 tests, #1-#10), `agedPublicFundCutoffDate / clubLocalDateString` (4 tests, #11-#14) and the migrated guardrails describe (5 tests, #15-#19). Both `cleanState` literals now `agedPublicFunds: []`.
- No other test or e2e file referenced the old names (grep of `src` and `e2e`; `ledger-queries.test.ts` has none).
- Release notes: `docs/release-notes/v1.84.md` 1.84.1 entry; `package.json` 1.84.0 -> 1.84.1.

### Outputs
- Files: `src/lib/ledger.ts`, `src/lib/ledger-queries.ts`, `src/lib/ledger.test.ts`, `src/components/admin/ledger/ledger-settings-form.tsx`, `src/components/admin/ledger/guide/settings-section.tsx`, `src/components/admin/ledger/guide/guardrails-section.tsx`, `docs/release-notes/v1.84.md`, `package.json`.
- No endpoints, server actions, schema or migration changes. DECISION-105, backlog untouched.
- Contract: `computeAgedPublicFunds(AgedPublicFundFact[]): AgedPublicFund[]`; `GuardrailsInput.agedPublicFunds: AgedPublicFund[]`.

### Verification
- `pnpm exec tsc --noEmit`: clean (no output).
- `pnpm test`: Test Files 135 passed (135); Tests 2314 passed (2314).
- `pnpm build:only`: completed successfully.
- Dev-DB check via a throwaway tsx script calling `getOverview(entityId, 2026)` for both entities (script deleted afterwards):
  - Westerville Lions Foundation (Charitable Fund, balance 5,836.57, trailing-year income 26,285.35): `NO aged-fund flag`.
  - Westerville Lions Club (Activity Fund): flag still present, detail begins "Activity Fund: $84.52 of its $84.52 balance has been on hand more than 365 days. Money is counted oldest-first, ..."

### Deviations from design
- None in behavior. Dollar formatter: no reusable exported comma formatter exists in `src/lib` (`formatCentsForEmail` is private to `financial-report-send.ts` and sign-handling; `formatDollars` in `budget-context-panel-ui.ts` has no grouping), so I added the small private `formatUsdCents` in `ledger.ts` as the design allowed.
- Header docblock of `ledger.ts` line ~26 reworded to point at `computeAgedPublicFunds()`.

### Open questions / handoff notes
- Next: qa (Phase 5). Per design, optionally post a test income/expense in dev to see partial-aging text on `/admin/ledger`, and check the longer detail wraps at 360px. Never send live email (no email path here).
- `.env.local` has `PROD_DATABASE_URL` set; the app and my verification script read only `DATABASE_URL`, and the check was read-only.


---

# Phase 5 — Verification (qa)

## Phase 5 — Verification — 2026-10-01

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** The old predicate flags the reported fund; the new `computeAgedPublicFunds()` does not, and it still flags a genuinely old balance and states the amount. Typecheck, 2314 unit tests and the production build are green, and the live Ledger pages in the dev server show the Charitable Fund flag gone, the Activity Fund flag with the new per-fund text, the title unchanged, and all three copy edits rendered. One test income of $100.00 was posted and deleted; the local DB is back to its starting state. `pnpm test:e2e` was not run (see handoff notes).

### What I did

**1. Bug reproduced on pre-fix code (no stash).** Read the old predicate with `git show HEAD:src/lib/ledger.ts`, copied it into a throwaway tsx script in the scratchpad next to an import of the working-tree `ledger.ts`, ran it, and deleted it. Output, verbatim:

```
OLD count   (bal 5,836.57, oldest income 2024-07-08): 1
OLD names   : [ 'Charitable Fund' ]
cutoff      : 2025-10-01
NEW charitable (bal 5,836.57, trailing income 26,285.35): []
NEW activity   (bal 84.52, trailing income 0): [{"fundName":"Activity Fund","agedCents":8452,"balanceCents":8452}]
```

(threshold 365, now = 2026-10-01T16:00Z.) The old `countAgedPublicFunds` returned 1 and `agedPublicFundNames` returned the Charitable Fund for a fund with $26,285.35 of income in the trailing year; the new function returns no aged funds for the same facts, and returns aged 8452 cents of 8452 for the Activity Fund.

**2. Static and build gates.**
- `pnpm exec tsc --noEmit`: PASS (exit 0, no output).
- `pnpm test`: PASS. `Test Files  135 passed (135)` / `Tests  2314 passed (2314)` / `Duration  3.99s`.
- `pnpm build:only`: PASS (exit 0). `Compiled successfully`, `Generating static pages (125/125)`, no warnings in the output.
- Coverage on the touched module: `src/lib/ledger.ts` 97.07% statements / 88.51% branches (uncovered lines 414, 525-526, 542-548 are outside the aged-fund code, which is fully covered). Target for `ledger.ts` is not named in the QA charter; the three charter modules were not touched.

**3. Dev-server smoke** (`pnpm dev` against `.env.local` `DATABASE_URL`, signed in as the e2e admin through the real credentials form with Playwright; `PROD_DATABASE_URL` never used; `EMAIL_DEV_ALLOWLIST` is unset, so nothing could send, and the dev log shows no email activity beyond migration file names).

Independent read-only DB check of the facts the page should be using (window cutoff 2025-10-01):

| Fund | Opening | Income (all / trailing) | Expense | Balance | Expected aged |
|------|---------|--------------------------|---------|---------|---------------|
| Foundation / Charitable Fund | 28,569.30 | 63,895.93 / 26,285.35 | 86,628.66 | 5,836.57 | 0 (no flag) |
| Club / Activity Fund | 0.00 | 138.50 / 0.00 | 53.98 | 84.52 | 84.52 (flag) |

Page results:

| Page | Result |
|------|--------|
| `/admin/ledger` (two-entity dashboard) | Flag present once, tagged CLUB: "Activity Fund: $84.52 of its $84.52 balance has been on hand more than 365 days. Money is counted oldest-first, ..."; Foundation shows only "Reserves below minimum threshold" |
| `/admin/ledger?entity=club` | Flag present with the exact clause above; title "Public fund holding undisbursed balance past 365-day threshold" (unchanged) |
| `/admin/ledger?entity=foundation` | **No aged-fund flag** (title absent) |
| `/admin/ledger/compliance?entity=club` / `?entity=foundation` | Club: flag with new clause. Foundation: no flag |
| `/admin/ledger/settings` | New helper paragraph renders ("Controls the aged public-fund guardrail. A warning fires when an Activity, Charitable, or Scholarship fund is holding money ..."); old "oldest posted income is older than" text absent |
| `/admin/ledger/guide` | New settings-section sentence ("how long public money can sit in a public (Activity, Charitable or Scholarship) fund, counted oldest-first") and new guardrails `whatToDo` ("The flag names each fund and how much of its balance is past the holding period") both present; old "how long a public/activity fund can hold an undisbursed balance" absent |

360px wrap: screenshots of `/admin/ledger?entity=club` and `/admin/ledger` (dashboard, entity-tagged variant) at 360x800. The flag card wraps cleanly; the detail text element is 246px wide with its right edge at 319px, inside the viewport, no clipped words. Screenshots are in the session scratchpad (`flag-360-club.png`, `flag-360-dashboard.png`), not committed.

**4. Partial-aging round trip.** Posted $100.00 income to the Club Activity Fund through the real "Record Transaction" dialog (date defaulted to 2026-10-01, status `posted`, id `ceed9f0d-...`). Reload showed: **"Activity Fund: $84.52 of its $184.52 balance has been on hand more than 365 days."** (balance 184.52, fresh 100.00, aged 84.52, as predicted). Deleted the transaction through `DELETE /api/admin/ledger/transactions/[id]` (200, `{"deleted":1}`), reload showed the original $84.52 / $84.52 text again. Read-only DB check afterwards: `ledger_transactions` count 277 (same as before), no row with the QA party name, per-fund income/expense totals identical to baseline. An income post never takes the pending path, so no approval email path was touched. The dev server was stopped afterwards and all scratchpad scripts removed.

**5. Regression note.**
- `src/lib/ledger.test.ts:287` `REGRESSION 2026-10-01: a mature fund whose trailing-window income exceeds its balance is not aged` guards the "age of fund vs age of money" failure: a fund whose first income is over a year old but whose trailing-year income exceeds its balance (the 583657 / 2628535 local-DB figures and the 897375 production balance) must produce no flag. Failing-then-passing evidence is item 1 above: the pre-fix predicate flags exactly those facts, the new function does not. (The test cannot be executed against the old code as-is because the old API was removed; the throwaway script is the demonstration.)
- Companion guards: `:298` partial aging (aged 214000 of 897375), `:318` opening-balance-only fund flags, `:325` transfer-in counts as fresh (pins B-80), `:382` exact-boundary day, `:400-401` club-local date rather than UTC, `:405` leap-year window, and the `guardrails()` block at `:1408` pinning the flag title and detail text.

### Feature-Gate Audit

No protected routes touched. The diff contains no `route.ts` or server action; the only changed code paths are the pure function in `src/lib/ledger.ts`, the `getOverview()` query in `src/lib/ledger-queries.ts` (consumed by the existing, already-gated `/admin/ledger` pages) and three string-only copy edits. No `FEATURES.*` key, gate or proxy rule changed.

### Observations (not caused by this change, no action requested here)
- On a cold dev server the very first sign-in attempt hit the documented `MissingCSRF` race (see `e2e/global-setup.ts`); a warm retry succeeded. Environment, not the feature.
- `/admin/ledger` (dashboard) has a wide transactions table (ENTITY / FUND / PARTY / CHECK # / AMOUNT / DATE / AGE) whose elements extend to ~1091px, giving the page a horizontal scroll at 360px (`scrollWidth` 1075). That table is not in this diff and is unrelated to the flag card, which fits. Pre-existing; worth a separate backlog look by whoever owns the dashboard.
- Dev-only "1 Issue" badge is React's `eval()` CSP notice in development mode; not present in production.

### Outputs
- This section and the Phase 5 status row of `docs/work-log/2026-10-01-aged-public-fund-fifo.md`.
- No source, test, `docs/decisions.md` or `docs/backlog.md` changes by qa. No new tests added (the Phase 4 suite already covers the design's 19 cases; nothing was found that needed a new one).

### Open questions / handoff notes
- Next: **analyst** for Phase 6 (shipped vs intent).
- `pnpm test:e2e` was not run: the suite is ~12 minutes serial against the shared dev DB, no spec in `e2e/` references the flag title, the settings copy or the changed functions (grep of `e2e` and `src`), and the change touches no route or gate. The live-page checks above cover the user-facing surface. If the user wants it run before push, say so.
- Treasurer items still open from Phase 1/3 (non-blocking): confirm LCI reads Ch. VII as oldest-money-first, and the heads-up that a dormant opening-balance-only public fund will now flag. The Club Activity Fund flag will persist in the dev DB because its $84.52 genuinely is over a year old with no activity since; that is the intended behavior.

---

# Phase 6 — Shipped vs Intent (analyst)

## Phase 6 — Shipped vs Intent — 2026-10-01

**Owner:** analyst
**Status:** complete

**Verdict:** SHIP IT

**One-line take:** The warning now asks "how many dollars on hand are old?" instead of "is the fund old?", so the Charitable Fund flag clears through normal turnover while a fund with genuinely stale money still flags and names the aged amount.

### Summary

I walked the working-tree diff (`ledger.ts`, `ledger-queries.ts`, three `.tsx` copy files, `ledger.test.ts`, `v1.84.md`, `package.json`) against my Phase 1 review and the tech-lead's Phase 3 design, re-ran `src/lib/ledger.test.ts` (323 passed), and cross-checked QA's Phase 5 evidence. The bug no longer manifests for the treasurer, every Phase 1 ruling was honored, and both treasurer-facing notes and both backlog items are recorded where Phase 1 said they should be. No regression and no unrecorded drift.

### What's working

- **The reported bug is gone.** `computeAgedPublicFunds()` uses `aged = min(balance, max(0, balance - trailing-window income))`. For the Charitable Fund figures (balance $5,836.57, trailing-year income $26,285.35) that is 0, so no flag. The production figure ($8,973.75 balance against the same-scale income) is pinned as a named `REGRESSION 2026-10-01` unit test. QA's pre-fix script showed the old predicate returning 1 for the same facts.
- **Genuinely stale money still flags, with the amount.** QA's live check: Club Activity Fund ($84.52 balance, no income in the window) flags "$84.52 of its $84.52 balance has been on hand more than 365 days"; posting $100.00 of income changed it to "$84.52 of its $184.52", and deleting that row restored the original. That is the partial-aging behavior I specified (Gap G3) working end to end.
- **One source of truth.** Count, names and flag text all derive from one `AgedPublicFund[]`; `GuardrailsInput.agedPublicFunds` is that array, so the count/names drift that DECISION-032 papered over is structurally gone (this answered my Open Question 4).
- **Boundary and time zone handled as asked (G1).** `agedPublicFundCutoffDate()` is the only definition of the window, computed as a club-local date string in TypeScript and bound as a `::date` parameter; no `now()` in SQL. Exactly-threshold income stays fresh. Tests cover boundary, club-local vs UTC, leap year.
- **Fewer queries.** Query A (`MIN(txn_date)`) is deleted and the window sum is a conditional-sum column in the existing Query A2.

### Intent-vs-shipped diff

| Phase 1 item | Phase 1 said | Shipped | Verdict |
|---|---|---|---|
| Core rule | Age the money FIFO, fire only when aged > 0 | `computeAgedPublicFunds()` closed form, clamped to `[0, balance]`, skips balance <= 0 and non-public kinds | matches |
| Ruling 1 opening balance | Unconditionally oldest; dormant seeded fund now flags | Opening is inside `fundBalanceCents()` and never counted as fresh; test "opening-balance-only fund is flagged" | matches |
| Ruling 2 transfers | Ordinary flow; pin the limitation with a test; file B-80 | No `transfer_group_id` filter, comment in the query cites B-80; test pins transfer-in as fresh; B-80 filed under Watching / needs info | matches |
| Ruling 3 flag text | Per-fund clause with aged and balance dollars, oldest-first sentence, earmark/minutes sentence kept, title unchanged | Title unchanged; detail reads "{Fund}: $X of its $Y balance has been on hand more than N days. Money is counted oldest-first, so any disbursement from the fund reduces the aged amount. ... document the project name and expected disbursement date in the board meeting minutes."; thousands separators via `formatUsdCents` | matches |
| Ruling 4 settings copy (three sites) | Settings form helper, guide settings row, guide guardrails row reworded; DECISION-027/028 corrected by a new dated entry | All three reworded as designed (guide row title unchanged); DECISION-105 is the correcting entry | matches |
| Ruling 5 earmark acknowledgment | Separate backlog item, not in this fix | B-79 filed under Later, wording matches mine plus the DECISION-105 origin tag; no earmark logic shipped | matches |
| G2 sign/units | Integer cents, clamp at 0 and at balance | Both clamps present; formatting only at render | matches |
| G3 test plan | Regression, partial aging, opening-only, expense > old pool, transfer-in/out, boundary, non-public, multi-fund | 10 + 4 + 5 tests delivered per the design; suite 323 passing in `ledger.test.ts`, 2314 overall per QA | matches |
| G4 / G7 release note | Treasurer language, no file lists, call out the dormant-fund change | `v1.84.md` 1.84.1 Fix entry, no file list, includes the "opening balance and no activity will now show the warning" sentence; `package.json` 1.84.0 to 1.84.1 | matches |
| G5 / G6 | Refund-style income counts as fresh; no "public use" expense judgment | Accepted as designed and recorded in DECISION-105 | matches |
| Opening Q4 (function shape) | Tech-lead's call | One `computeAgedPublicFunds()`, old exports deleted, no shims | acceptable drift (a better answer than I proposed) |
| Threshold validation | Confirm server validates >= 1 | Tech-lead confirmed `settings/route.ts` rejects `v <= 0`; no route change | matches |

**Residual stale reference (acceptable):** `docs/release-notes/v1.26.md` still describes the old "oldest posted income" rule. That is historical release-note text and DECISION-105 supersedes it; no source file under `src/` or `e2e/` still mentions the old rule or the removed function names.

### The two treasurer-facing notes are recorded

1. **FIFO reading of Ch. VII, sign-off requested.** DECISION-105 (`docs/decisions.md` line 187) carries a "Treasurer sign-off requested" paragraph stating that the LCI Ch. VII text is not in the repo, that FIFO is our reading adopted on the orchestrator's authority, and that the change is confined to `computeAgedPublicFunds()` and the cutoff helper if LCI reads it differently. Recorded as I asked.
2. **Dormant opening-balance-only funds now flag.** In the v1.84.1 release note in treasurer language, and in DECISION-105 under "Behavior changes the treasurer will see."

### Backlog

- **B-79** (Later): present at `docs/backlog.md` line 904, my wording (earmark with project, amount, expected date, optional minutes citation; subtract from aged portion; needs its own Phase 1 on who may create one, expiry, audit log) with an origin line pointing to this work-log and DECISION-105.
- **B-80** (Watching / needs info): present at line 1437, one-line limitation as I suggested, with "pinned by a unit test; revisit only if the treasurer reports a missed hold." Index entries exist for both.

### Edge cases

- **Empty state (new install, no funds / zero balances):** pass (no flag; empty array).
- **Failure microcopy:** pass / not applicable. The flag is computed inside `getOverview()` with everything else; no new failure surface.
- **Permission gate:** pass. No route, action or `FEATURES` key changed; the surfaces are the existing gated `/admin/ledger*` pages (QA feature-gate audit).
- **Mobile (360px):** pass for the flag card per QA (wraps cleanly, right edge at 319px). The wide dashboard transactions table that scrolls horizontally at 360px is pre-existing, outside this diff, and QA already flagged it for whoever owns the dashboard.
- **Brand consistency:** not applicable (string-only copy changes, no markup changes).
- **OAuth / access-pending / email / Google Group sync:** not applicable.

### Follow-ups

None required to ship. Open and non-blocking, already recorded in DECISION-105:
- Treasurer to confirm (or object to) the FIFO reading of Ch. VII.
- Optional, not from this change: the 360px horizontal scroll of the dashboard transactions table, noted by QA.

### Outputs

- This section and the Phase 6 status row of `docs/work-log/2026-10-01-aged-public-fund-fifo.md`.
- No code, `docs/decisions.md` or `docs/backlog.md` edits by analyst.

### Open questions / handoff notes

- Pipeline closed on SHIP IT. Not committed or pushed; per workflow rules that waits for the user's explicit approval (and `/pre-push`; QA did not run `pnpm test:e2e`, justified in Phase 5 since no spec references this surface).
- The Club Activity Fund flag will remain in the dev DB because that $84.52 is genuinely over a year old; that is intended behavior, not a defect.

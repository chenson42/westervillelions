# Deposit-in-Transit Carve-Out Symmetry — Work Log

> **Slug:** `2026-07-30-deposit-in-transit-carveout`
> **Surface:** (dashboard) member portal — `/members/financial-reports/[entitySlug]/[month]` (query layer: `src/lib/financial-report-queries.ts`)
> **Permission(s):** none — existing behavior (no `FEATURES` gate on `/members/financial-reports`; open to any linked member per CLAUDE.md); no permission change in scope
> **Estimated complexity:** small–medium (small code diff in `isMonthGatedForEntity()` / `getLatestOpenMonthForEntity()`; medium because it reverses a locked, tested decision from `docs/work-log/2026-07-28-report-gate-outstanding-checks.md` and needs Chris's explicit sign-off)
> **Pipeline mode:** Full, bug-fix-flavored — this is a bug fix (an asymmetry between two carve-outs of the same gate), but the fix requires a genuine accounting-rationale decision, not just a mechanical patch, so it gets the full Phase 1 treatment rather than the abbreviated bug-fix variant.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-30 |
| 2 — Architectural review | tech-lead (folded, reason below) | Complete | Approved with reason | 2026-07-30 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-30 |
| 4 — Implementation | api-developer → ux-developer | Complete | — | 2026-07-30 |
| 5 — Verification | qa | Complete | PASS | 2026-07-30 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-07-30 |

---

# Phase 1 — Functional Refinement (analyst)

## Open Questions — RESOLVED (Chris, 2026-07-30)

1. **Carve-out scope → FULL SYMMETRY.** Carve out every posted, unreconciled `flow='income'` row regardless of payment method or age (`isUnclearedDepositRow`), mirroring `isOutstandingCheckRow`. This **reverses the deliberate 2026-07-28 decision** (`docs/work-log/2026-07-28-report-gate-outstanding-checks.md`) that kept `payment_method='check', flow='income'` gating — the old regression test ("STILL gates on an unreconciled check+INCOME row") must be **flipped** to assert it no longer gates, and the 2026-07-28 work-log/DECISION cross-referenced as superseded. Required to actually publish June (one blocker is a $125 received check).
2. **Safety-net view → BUNDLE INTO THIS FIX (Phase 4).** Build an "unremitted deposits" dashboard view mirroring the existing `uncashedChecks` list (posted, unreconciled income deposits), so full symmetry doesn't remove all visibility of a deposit that never truly clears. Ships in the same increment, not as a separate follow-up.

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The deposit-in-transit carve-out is narrower than the outstanding-check carve-out in two independent ways (method-restricted AND time-bound) when it should only differ from it in the one way that's actually justified by the underlying mechanism (no method restriction, still no time bound) — fix the predicate, and add a treasurer-facing safety net since the fix removes the only thing currently forcing stale deposits into view.

## User Verbs

No new user-facing verb. This is a timing fix to an existing read-only surface.

| Surface | Verb | Cadence |
|---------|------|---------|
| Signed-in member | View own entity's monthly financial statement at `/members/financial-reports/[entitySlug]/[month]` | Per session, as new months publish |

Nothing changes about what the member does — only *when* a given month's card becomes clickable/visible in the picker (`getLatestOpenMonthForEntity()`) and whether `/members/financial-reports/[entitySlug]/[month]` returns `{status: "ready", statement}` vs `{status: "gated"}` for a given month.

## Flows

**Flow 1 — Member views a monthly statement:** entry `/members/financial-reports` → member picks their linked entity's most recent open month from the picker → clicks through to `/members/financial-reports/[entitySlug]/[month]` → sees the Statement of Financial Condition (One Month / Twelve Months / Annual Budget columns).
- Success: statement renders with figures already correct (see "Confirm the gate is orthogonal to displayed numbers" below) — unaffected by this fix except for *which* months are reachable.
- Failure: today, June never appears in the picker for Club/Administrative because 6 June-dated deposit rows are unreconciled and gate the month, even though June's own reconciliation closed cleanly. There's no error state here — it's a silent, indefinite non-appearance, which is itself the bug. No failure microcopy exists (or is needed) because `getMonthlyStatement()` returning `{status: "gated"}` simply means the month isn't offered — same pattern as before this bug (nothing regresses this).

No new flow, no new failure path to design — the fix operates entirely inside `isMonthGatedForEntity()` and `getLatestOpenMonthForEntity()`, both already covered by the existing gated/ready union and the existing picker.

## Permissions

- **Permission(s):** None new. `/members/financial-reports` has no `FEATURES` gate (any linked member); this fix touches only the internal reconciliation-gate predicate, not auth or role checks.
- **Default roles:** N/A.

---

## 1. Recommended predicate

**Recommendation: full symmetry (item 1, option (a))** — carve out every posted, unreconciled `flow='income'` row, regardless of `paymentMethod` and regardless of age. Concretely, replace `isInTransitZeffyDepositRow()` with:

```ts
function isUnclearedDepositRow(r: { flow: string }): boolean {
  return r.flow === "income";
}
```

...and delete the now-unnecessary machinery: `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`, `daysBetween()`, the `asOf`-threading through `isMonthGatedForEntity()`/`getLatestOpenMonthForEntity()` that exists *only* to serve the 12-day window (if `asOf` isn't needed elsewhere in either function after this change — tech-lead should confirm; `hasMonthElapsed()` already computes its own "now" independently and isn't part of this carve-out).

**Why (a) and not (b) or (c):**

- **(c) is a dead end, as the brief already suspected.** An *unreconciled* income row has no clear-date yet — the only date available is `txn_date`, and a `txn_date`-anchored window doesn't fix anything: these six rows are dated June 25–27, inside any sane month-end window, and would *still* have gated June for the ~34 days between when reconciliation should have closed and when it actually got run. The bug isn't "the window is anchored wrong," it's "there's a window at all on the income side that has no counterpart on the expense side." (c) doesn't resolve that.
- **(b) (method-scoped, unbounded) looks like the literal reading of "symmetric with checks" — mirror `paymentMethod='check'` on the income side — but that's the wrong mirror.** The check-carve-out is scoped to `flow='expense'` specifically *because checks are the one expense rail with payee-controlled clearing lag* (debit-card/bill-pay expenses clear near-instantly, so an unreconciled one really does signal "books aren't done" — see `2026-07-28-report-gate-outstanding-checks.md`, test 3). On the income side, the equivalent structural lag isn't payment-method-specific — it's that **every** deposit, regardless of rail, waits for its bank line to post and then waits again for the treasurer to run a reconciliation session (which happens *after* month-end, batch-style, for whatever posted that month). That lag is uniform across Zeffy, check-received, and cash. Scoping the income carve-out to specific methods (b) would just relocate today's exact bug to whichever method got left out — and this bug's own repro proves the point: the $725 batch is 5 Zeffy rows *and one check-received row*, and the check-received row is *already* excluded from every carve-out that exists today (see below), so it's *still* gating right now independent of the 12-day question.
- **(a) is the one that actually matches the mechanism**, and it's the simplest rule — one predicate, no sub-scoping, no injected `asOf`, mirroring `isOutstandingCheckRow()`'s own shape (a two-line boolean on already-fetched fields) rather than adding a second time-arithmetic subsystem. This is also the shape DECISION-051's own stated preference ("one code path per concern") would pick.

**This reverses a locked, tested decision — flagging loudly, not deciding silently.** `2026-07-28-report-gate-outstanding-checks.md` deliberately keyed the check carve-out on `flow='expense'` specifically so that `payment_method='check', flow='income'` (dues paid by paper check) would **keep gating**, and shipped a regression test (`STILL gates on an unreconciled check+INCOME row`) to guard exactly that. Recommendation (a) removes that guarantee — a check-received row would now be carved out too, same as Zeffy and cash. I think this reversal is *correct*, because the original rationale ("a dues payment received by check is a genuinely-unreconciled deposit") doesn't actually distinguish it from a Zeffy remittance once you account for checkbook-basis recording (T-24): income is recorded "when deposited," so a posted `flow='income'` row already represents a deposit the treasurer has made, not an un-banked check sitting in a drawer. The only gap left is bank-posting + reconciliation-matching lag — identical in kind to Zeffy's. But this is exactly the kind of call that needs Chris's explicit sign-off before Phase 3, not an analyst call to make unilaterally two days after it was locked and tested. **See Open Questions.**

## 2. Risk: does this let a month publish with wrong/missing income?

No new risk beyond what the check-expense carve-out already accepts, and the mechanism for why is the same in both directions:

- **The gate has never protected the displayed numbers** — see item 3 below: Twelve-Month/Budget columns are `txn_date`/posted-basis (`getFundReport()`), computed independent of `reconciled`. A posted income row is already counted in June's income the moment it's entered, whether or not it's ever reconciled. So "carving it out of the gate" doesn't add a row to the numbers that wasn't already there — it only unblocks the *page* from rendering.
- **The residual risk is data-integrity, not display-integrity**: a posted income row that never actually clears (bounced check, cancelled/reversed Zeffy transaction, duplicate entry) would, under full symmetry, never re-gate any month — same as a voided/lost outstanding check never re-gates today. The system already accepts this exact risk on the expense side and manages it out-of-band via `bookVsCashDivergenceCents`, each line's `hasUncashedCheck` flag, and the admin dashboard's `uncashedChecks` list (oldest-first, unbounded age, both entities — `getDashboard()` in `src/lib/ledger-queries.ts`). Symmetry means inheriting the same acceptance, not a new one.
- **Is income materially different from expense here?** In the "never arrives" case, yes, directionally: a check that never clears just means the club never actually spent the money (conservative surprise — ending balance is *higher* than expected once corrected). A deposit that never arrives means the club *booked money it doesn't have* (aggressive surprise — ending balance is *lower* than expected once corrected, and if a member acted on the stated balance in the interim that's a worse failure mode). This asymmetry doesn't argue against carving the gate — the gate was never the mechanism protecting against this — but it does argue for item 4's safety net being non-optional, since right now there's a real gap: outstanding checks get a permanent dashboard surface even after they stop gating; deposits currently have none.

## 3. Confirm the gate is orthogonal to displayed numbers

Confirmed by reading the query code directly, not just the doc comments:

- **Twelve-Month / Annual-Budget columns:** `getMonthlyStatement()` → `getFundReport(fund.id, reportFY, {asOfDate: monthEnd})` → `src/lib/ledger-queries.ts` around line 600 filters `status='posted'` and a `txnDate` boundary, with **no `reconciled` condition in that query at all**. June's posted, June-dated rows are counted in June's income regardless of reconciliation state, gate or no gate.
- **One-Month column:** `computeOneMonthCashActuals()` (financial-report-queries.ts ~450) is the one place `reconciled=true` is a real filter — it's intentionally bank-clear-date bucketed (`ledgerBankLines.postingDate`, DECISION-050), i.e. genuine cash-basis for that single column. These six rows, being unreconciled, **already don't appear in June's One-Month column today** and won't start appearing there once the gate relaxes — they'll bucket into whichever month they actually get matched in (most likely July, per the reproduction). That's correct, intended behavior for a cash-basis column, not a side effect of this fix.
- **Net: relaxing the gate changes only whether `getMonthlyStatement()` returns `{status: "ready", ...}` vs `{status: "gated"}` for June. It does not change a single number inside the `ready` statement.** This must not change — if Phase 4 touches `getFundReport()` or `computeOneMonthCashActuals()` at all, that's out of scope and a red flag for Phase 6.

## 4. Stale-deposit safety net

Recommend as a **named follow-up, not blocking this fix**, but flagging it strongly: the outstanding-check carve-out has always shipped with a permanent visibility net (`uncashedChecks` on the admin ledger dashboard, oldest-first, unbounded). The deposit-in-transit carve-out has no equivalent today, and today's 12-day time bound was *accidentally* filling that role (a stale Zeffy batch would re-gate and surface as a blocker after 12 days). Full symmetry (a) removes that accidental signal entirely, so the deposit side goes from "over-eager gate, no dashboard" to "no gate, no dashboard" — a real net loss of visibility unless a companion view ships.

Suggested shape for the follow-up (not designing it here, just naming it): an "unremitted / uncleared deposits" list on the admin ledger dashboard mirroring `uncashedChecks` — same oldest-first, cross-entity shape, sourced from the same `flow='income', status='posted', reconciled=false` rows, scoped to member-exposed funds or all funds (tech-lead's call). This is small and reuses the exact query shape already proven for `uncashedChecks`.

## 5. Edge cases

- **Reconciliation-close rule:** unaffected. Closing a reconciliation session requires matching every in-period bank line — that logic lives in the reconciliation-session workflow (`reconciliation-queries.ts` / the match route), entirely separate from `isMonthGatedForEntity()`. This fix touches only the gate predicate two functions use; it doesn't touch session-close logic at all.
- **One Month / Twelve Months / Annual Budget columns:** confirmed unaffected — see item 3.
- **`reconciledAt`-based logic elsewhere:** unaffected. `computeOneMonthCashActuals()`'s legacy-Quicken-import fallback (`usedLegacyReconciledAtFallback`) is a different function operating on `reconciled=true` rows only; this fix operates on `reconciled=false` rows in a different function entirely. No shared code path.
- **Both consumers of the carve-out must change together.** `2026-07-28`'s own history is the precedent here: fixing only `isMonthGatedForEntity()` and not `getLatestOpenMonthForEntity()`'s independent `blockingDates` filter reintroduces the picker-truncation bug (a month can be gate-clear per `isMonthGatedForEntity()` but never offered because the picker's own candidate computation still treats the row as blocking). Phase 3 must update both call sites, as DECISION-051 already had to for the Zeffy window.
- **Mobile / empty state / brand consistency:** not applicable — no UI changes in this fix, purely a query-layer predicate change feeding an existing page.

## Gaps the Request Didn't Address

- **The check-received row in the reproduction is unaddressed by a Zeffy-only fix.** If Phase 3 narrows scope to "just widen the Zeffy window" without adopting full `flow='income'` symmetry, the $725 repro will *still* partially gate (the one check-received row), because that row is explicitly excluded from every carve-out that exists today. Any predicate short of (a) needs to explicitly re-verify against this repro's exact row mix, not just the Zeffy rows.
- **No safety-net follow-up was named in the request.** See item 4 — surfaced as a recommended companion, not required to ship this fix, but the request should explicitly accept or defer it rather than leave it implicit.

## Out of Scope (confirm with user)

- Building the "unremitted/uncleared deposits" dashboard view (item 4) — recommended as a fast-follow, not part of this fix.
- Any change to `getFundReport()`, `computeOneMonthCashActuals()`, or reconciliation-session close logic — none of these should need to change for this fix; if Phase 3/4 touches them, that's scope creep worth a second look.

## Open Questions

- **Do you want the check-received carve-out reversal (dropping the `flow='income'` exclusion for `payment_method='check'` that `2026-07-28-report-gate-outstanding-checks.md` deliberately locked and tested two days ago)?** This is the load-bearing decision in this whole fix — recommendation is yes (option (a), full symmetry), with the rationale in item 1 above, but it directly contradicts a named, tested prior decision and I'm not comfortable treating that as self-evidently correct without your sign-off. If the answer is no, the predicate becomes option (b) narrowed to exclude checks specifically, and the $725 repro will only be half-fixed (the check-received row keeps gating) — worth knowing going in.
- **Is the item-4 safety-net view (unremitted deposits) wanted now, alongside this fix, or genuinely a separate follow-up?** Given it's small and reuses the `uncashedChecks` query shape, it could ride along in the same Phase 4 pass if you'd rather not ship the gate relaxation without it.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Folded into Phase 3 by tech-lead — Approved with reason.** No architect dispatch for this
increment; documented here per the Bug-Fix Variant's "no silent skips" rule even though this
work-log runs full-pipeline mode, because the actual Phase 2 questions (new directory? new
dependency? structural change? invariant touched?) all resolve to "no" without requiring the
architect's judgment call — see reasoning below. If the user wants an independent architect pass
before Phase 4 starts, that's a cheap add; nothing here is load-bearing on skipping it.

## Placement

- **Directory placement:** No new directories. The predicate lives where its siblings
  (`isOutstandingCheckRow`, the retired `isInTransitZeffyDepositRow`) already live, in
  `src/lib/financial-report-queries.ts`. The new dashboard list lives where its sibling
  (`uncashedChecks`) already lives, in `src/lib/ledger-queries.ts` (`getDashboard()`), rendered by
  a new component colocated with `UncashedChecksPanel` in `src/components/admin/ledger/`. Every
  new file is a same-shape sibling of an existing file in the same directory — not a new module.
- **Server vs Client split:** No change to the existing split. `isMonthGatedForEntity()` /
  `getLatestOpenMonthForEntity()` are already server-only query helpers; the new
  `UnremittedDepositsPanel` is a Server Component exactly like `UncashedChecksPanel` (props-in,
  read-only, no client state) — no `'use client'` anywhere in this feature.
- **Dependencies:** None. No new npm package.

## Invariants Touched

- **Schema is the source of truth:** untouched — no schema change (confirmed in Phase 1 item 3
  and reconfirmed here: this is a query-predicate change plus one new read query over the
  existing `ledger_transactions` table).
- **Migrations re-run on every deploy:** N/A, no migration.
- **Permissions are the only gating mechanism:** untouched — no new `FEATURES.*` key. The new
  dashboard panel rides the existing page-level gate (`hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD,
  LEDGER_MANAGE])` in `src/app/(dashboard)/admin/ledger/page.tsx`), exactly as `uncashedChecks`
  already does — there is no permission decision to make here, only a placement one, which
  Phase 3 confirms by inheriting rather than inventing.
- **Server/client boundary:** untouched, see above.

## Notes

Nothing structural for Phase 3 to honor beyond what's already true of the file it's editing —
this is a same-file predicate swap plus one new sibling query/component pair, not a new pattern.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Two changes, shipped together per Chris's lock: (1) `isMonthGatedForEntity()`'s income-side
carve-out becomes fully symmetric with its expense-side counterpart — `isUnclearedDepositRow(r)
=> r.flow === 'income'`, no payment-method restriction, no time bound — replacing the
method-restricted, 12-day-windowed `isInTransitZeffyDepositRow()` and reopening the
`payment_method='check', flow='income'` case the 2026-07-28 fix deliberately kept gating. (2) A
new "Unremitted Deposits" panel on the admin Ledger dashboard, mirroring the existing
`uncashedChecks` list exactly, so full symmetry doesn't erase the only surface that showed a
deposit stalling out. Neither change touches a displayed number — see Phase 1 item 3, reconfirmed
below — only which months are gate-clear and what's visible on the dashboard.

## Permissions

No new permission. The gate-predicate change touches only internal query logic behind the
existing member-linked `/members/financial-reports` page (no `FEATURES` gate today, unchanged).
The new dashboard panel rides the existing page-level gate at
`src/app/(dashboard)/admin/ledger/page.tsx`: `hasAnyFeature(session.user.id, [FEATURES.LEDGER_VIEW,
FEATURES.LEDGER_RECORD, FEATURES.LEDGER_MANAGE])` — the same gate `uncashedChecks` already rides.
No separate feature key exists for individual dashboard panels; don't invent one.

## API Contract

No new routes. Both changes are query-layer/server-component only:

- `isMonthGatedForEntity(entityId: string, monthEnd: string): Promise<boolean>` — **signature
  change**, drops the `asOf` param (see "Retired plumbing" below).
- `getLatestOpenMonthForEntity(entityId: string, asOf: Date = new Date()): Promise<string | null>`
  — signature unchanged; internal body changes.
- `getDashboard(): Promise<DashboardData>` in `src/lib/ledger-queries.ts` — signature unchanged;
  `DashboardData` gains one new field, `unremittedDeposits: UnremittedDepositRow[]`.

## Data Model

No schema changes required. Both changes read `ledger_transactions`/`ledger_funds` with different
predicates over already-existing columns (`flow`, `payment_method`, `status`, `reconciled`,
`txn_date`).

## 1. Gate fix — `isUnclearedDepositRow`

Replace, in `src/lib/financial-report-queries.ts`:

```ts
function isUnclearedDepositRow(r: { flow: string }): boolean {
  return r.flow === "income";
}
```

...for the deleted `isInTransitZeffyDepositRow()`. Delete alongside it: the
`IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS` constant and the `daysBetween()` helper — nothing else in
the file uses either (confirmed: `daysBetween` has no other caller; `hasMonthElapsed()` computes
its own independent "now" and was never part of this carve-out, per Phase 1's explicit note —
leave it untouched).

**`isMonthGatedForEntity()`** — drop the `asOf` param entirely. Today `asOf` is threaded through
this function for exactly one purpose (feeding `isInTransitZeffyDepositRow(r, asOf)`); confirmed
by reading the function body that `hasMonthElapsed(monthEnd)` is called with no `asOf` argument
today (it uses its own `now: Date = new Date()` default, already independent) — so once the Zeffy
predicate is gone, `asOf` has no remaining use inside this function. Confirmed safe to drop: every
current call site (`getMonthlyStatement()`, both `financial-reports` pages via
`getLatestOpenMonthForEntity()`) passes at most two args already; the only 3-arg call is
`getLatestOpenMonthForEntity()`'s own internal re-check (updated below).

```ts
export async function isMonthGatedForEntity(
  entityId: string,
  monthEnd: string,
): Promise<boolean> {
  if (!hasMonthElapsed(monthEnd)) {
    return true;
  }

  const rows = await db
    .select({
      txnDate: ledgerTransactions.txnDate,
      fundKind: ledgerFunds.kind,
      paymentMethod: ledgerTransactions.paymentMethod,
      flow: ledgerTransactions.flow,
    })
    .from(ledgerTransactions)
    .innerJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
    .where(
      and(
        eq(ledgerTransactions.entityId, entityId),
        eq(ledgerTransactions.status, "posted"),
        eq(ledgerTransactions.reconciled, false),
      ),
    );

  return rows.some(
    (r) =>
      isMemberExposedKind(r.fundKind) &&
      r.txnDate <= monthEnd &&
      !isOutstandingCheckRow(r) &&
      !isUnclearedDepositRow(r),
  );
}
```

The SQL select list is unchanged (still selects `paymentMethod` — `isOutstandingCheckRow()` still
needs it; `isUnclearedDepositRow()` simply ignores the field it doesn't use).

**`getLatestOpenMonthForEntity()`** — keeps its own `asOf: Date = new Date()` param (it has an
independent second use: deriving `currentMonthKey`/`ceilingMonth`, i.e. "what calendar month is it
right now" — unrelated to the deposit carve-out and predates it). Two internal call sites change:

```ts
const blockingDates = rows
  .filter(
    (r) =>
      isMemberExposedKind(r.fundKind) &&
      !isOutstandingCheckRow(r) &&
      !isUnclearedDepositRow(r),
  )
  .map((r) => r.txnDate);
...
const stillGated = await isMonthGatedForEntity(entityId, monthBounds(candidate).monthEnd);
```

(the final re-check drops its third `asOf` argument — `isMonthGatedForEntity()` no longer accepts
one.)

**Callers requiring no change** (confirmed by grep — `isMonthGatedForEntity`/
`getLatestOpenMonthForEntity` appear only in `financial-report-queries.ts`, its test file, and
`src/app/members/financial-reports/page.tsx` + `.../[entitySlug]/[month]/page.tsx`, both of which
already call `getLatestOpenMonthForEntity(entity.id)`/`getMonthlyStatement()` with no `asOf` arg):
neither page needs a code change. `src/lib/financial-report-ui.ts` has a doc-comment (not code)
referencing `isMonthGatedForEntity`'s old behavior — implementer should give it a one-line pass to
make sure it doesn't describe the retired window as current behavior, but it's prose, not a
functional dependency.

**Doc-comment cleanup (not optional):** the long doc blocks above both functions currently cite
DECISION-051's 12-day window and the 2026-07-28 check+income exclusion as current, load-bearing
behavior. These must be rewritten, not left stale — point to DECISION-059 (this decision) and
`docs/work-log/2026-07-30-deposit-in-transit-carveout.md` instead of describing retired behavior
as real. This repo has hit doc/behavior drift before (qa's Phase 5 note on
`2026-07-28-report-gate-outstanding-checks.md` flagging a stale doc/impl mismatch) — don't repeat
it here.

## 2. Test reversal — `src/lib/financial-report-queries.test.ts`

**In the `isMonthGatedForEntity` describe block (currently lines ~170-338):**

- **Unchanged, keep as-is:** "gates when an unreconciled posted transaction..." through "does not
  gate on an empty unreconciled candidate set" (lines 171-194); the two elapsed/future-month tests
  (196-227); "does NOT gate on an unreconciled OUTSTANDING CHECK" (237-247); "STILL gates on an
  unreconciled non-check expense" (261-271).
- **FLIP** — "STILL gates on an unreconciled check+INCOME row (dues paid by paper check)"
  (249-259): rename to reflect the reversal (e.g. "does NOT gate on an unreconciled check+INCOME
  row anymore — full deposit-in-transit symmetry, DECISION-059, supersedes the 2026-07-28
  check+income exclusion") and change `.toBe(true)` to `.toBe(false)`. Update the block comment
  above it (lines 229-236) to note the outstanding-check carve-out itself is unaffected but the
  check+income exclusion it used to guard is gone.
- **DELETE** — the two 12-day-window tests: "does NOT gate on a recent in-transit Zeffy deposit...
  dated within the 12-day window" (285-301) and "STILL gates on the SAME Zeffy deposit once it's
  stale... more than 12 days have passed" (303-319). Both test machinery (`asOf`-via-fake-timers
  window arithmetic) that no longer exists.
- **KEEP, rename/re-justify** — "STILL gates on an unreconciled zeffy EXPENSE row (not income)"
  (321-337): the assertion (`.toBe(true)`) is unchanged under the new predicate (an expense row is
  never carved by `isUnclearedDepositRow`), but its doc comment currently says "the in-transit
  carve-out is income-deposits only" — reword to "the uncleared-deposit carve-out is flow='income'
  only, method-agnostic in both directions" so it no longer implies a retired window.
- **ADD** — three new tests replacing the deleted window tests, proving full method/age symmetry:
  1. `does NOT gate on an unreconciled ZEFFY income row of ANY age — the time-bound window is
     retired`: reuse the old "stale" fixture (`txnDate: "2026-06-25"`, `asOf` faked to
     `2026-08-15`, i.e. 51 days later) but assert `.toBe(false)`. This is the most important new
     test — it's the one that would catch someone silently reintroducing an age check.
  2. `does NOT gate on an unreconciled CASH income row dated on/before month-end — full
     method-agnostic symmetry` (`paymentMethod: "cash", flow: "income"`).
  3. `does NOT gate regardless of paymentMethod value, including null/legacy rows —
     isUnclearedDepositRow ignores payment method entirely` (`paymentMethod: null, flow:
     "income"`).

**In the `getLatestOpenMonthForEntity` describe block (currently lines ~344-394), rename the
`describe` to `"getLatestOpenMonthForEntity — uncleared-deposit carve-out (full symmetry)"`:**

- **Keep, reword comments** — "does not truncate the candidate month solely due to a recent...
  Zeffy row" (345-370): same shape, same expected result (`"2026-06"`), drop "in-transit"
  framing.
- **FLIP** — "DOES truncate the candidate when the same-shaped row is genuinely stale (not
  in-transit)" (372-393): rename to "does NOT truncate the candidate even when the same-shaped
  income row is old — the time-bound window is retired, mirrors the outstanding-check carve-out
  having no age limit either" and change the expected result from `"2026-05"` to `"2026-06"`.

Net count: 2 tests deleted, 3 tests added, 2 tests flipped (value change), 1 test reworded only
(no value change), rest untouched. `pnpm test` full suite must stay green; this file's local count
goes from the current baseline by (+3 new, −2 deleted) = net +1 test in this file.

## 3. Bundled "Unremitted Deposits" dashboard view

**Query — `src/lib/ledger-queries.ts`, alongside `getDashboard()`'s existing `uncashedChecks`
query (~line 3129):**

```ts
export type UnremittedDepositRow = {
  id: string;
  entitySlug: string;
  entityName: string;
  fundSlug: string;
  fundName: string;
  party: string | null;
  paymentMethod: string | null;
  amountCents: number;
  txnDate: string; // 'YYYY-MM-DD'
  memo: string | null;
  ageDays: number; // computed via daysSinceTxnDate(), same helper uncashedChecks uses
};
```

Add `unremittedDeposits: UnremittedDepositRow[]; // oldest-first, both entities` to `DashboardData`
(next to the existing `uncashedChecks` field, same comment style).

Inside `getDashboard()`, add a second, independent query — same shape as `uncashedRows`, `flow`
flipped and `paymentMethod` filter dropped (full symmetry, matching the gate fix exactly):

```ts
const unremittedRows = await db
  .select({
    id: ledgerTransactions.id,
    entityId: ledgerTransactions.entityId,
    party: ledgerTransactions.party,
    paymentMethod: ledgerTransactions.paymentMethod,
    amountCents: ledgerTransactions.amountCents,
    txnDate: ledgerTransactions.txnDate,
    memo: ledgerTransactions.memo,
    fundSlug: ledgerFunds.slug,
    fundName: ledgerFunds.name,
  })
  .from(ledgerTransactions)
  .leftJoin(ledgerFunds, eq(ledgerTransactions.fundId, ledgerFunds.id))
  .where(
    and(
      eq(ledgerTransactions.flow, "income"),
      eq(ledgerTransactions.status, "posted"),
      eq(ledgerTransactions.reconciled, false),
    ),
  )
  .orderBy(asc(ledgerTransactions.txnDate));
```

Map it exactly like `uncashedRows` is mapped (same `entityById` lookup, same shared `now = new
Date()` already in scope — reuse it, don't recompute — same `ageDays: daysSinceTxnDate(r.txnDate,
now)`). Two independent queries, not one combined `OR`-predicate query: deliberate choice to avoid
touching the existing, already-tested `uncashedRows` query at all — this is a pure addition, zero
blast radius on working code, and the dashboard is low-traffic enough (two admins, occasional
loads) that one extra round trip is immaterial. Scope: **both entities, no fund-kind filter** — the
existing `uncashedChecks` list isn't scoped to member-exposed funds either (it's an admin-only
surface, unlike the member-facing statement gate), so Activity/Scholarship deposits stay visible
here too; don't import `MEMBER_EXPOSED_FUND_KINDS` into this query.

**Surface: same dashboard page, new panel, no new route.** `src/app/(dashboard)/admin/ledger/page.tsx`
already calls `getDashboard()` and passes the result to `<LedgerDashboard dashboard={...} />` —
`unremittedDeposits` arrives for free once `DashboardData` carries it; no page.tsx change needed
beyond the type flowing through.

**Component — new `src/components/admin/ledger/unremitted-deposits-panel.tsx`**, structurally a
copy of `uncashed-checks-panel.tsx` (same `overflow-x-auto` table pattern, same
`bg-gray-50 rounded-2xl p-10 text-center text-gray-500` empty state, same row-end link to
`/admin/ledger/${fundSlug}?entity=${entitySlug}&fy=${fy}` via `getFiscalYear(new Date(txnDate))`,
same >90-day amber/pill age treatment) with one column swap: **"Check #" → "Method"** (this list
spans payment methods; a dedicated Check # column doesn't generalize, and Method is the one new
piece of information a member of this list needs that `uncashedChecks` didn't). Column order:
Entity, Fund, Party, Method, Amount, Date, Age, Memo, view-link. Format `paymentMethod` for
display — `reconciliation-match-picker.tsx` already has a 6-entry `PAYMENT_METHOD_LABELS` map +
`paymentMethodLabel()` fallback-humanizer (lines ~34-47) doing exactly this; it isn't exported
today. Implementer's call whether to export it from that file or duplicate the small map locally —
this codebase already tolerates small colocated constants over shared-util extraction for things
this size (see `QUICKEN_IMPORT_MARKER`'s own colocation rationale in
`financial-report-queries.ts`); duplicating a 6-line `Record<string,string>` is not a
red flag here, but exporting is equally fine if the implementer prefers one source of truth.

**Render location — `src/components/admin/ledger/ledger-dashboard.tsx`:** add
`<UnremittedDepositsPanel deposits={dashboard.unremittedDeposits} />` immediately after
`<UncashedChecksPanel checks={dashboard.uncashedChecks} />` and before `<AuditItemsPanel .../>` —
same visual rhythm, checks-then-deposits reads naturally as "money going out, then money coming
in," and keeps the audit-items panel (guardrails/approvals) last as the "needs action" section.

**Permission:** none new — inherits the page's existing `hasAnyFeature([LEDGER_VIEW,
LEDGER_RECORD, LEDGER_MANAGE])` gate, identical to `uncashedChecks`. Do not add a `FEATURES.*` key
for this.

## Implementation Order

1. **`isUnclearedDepositRow` + gate fix** (`src/lib/financial-report-queries.ts`) — swap the
   predicate, drop `asOf` from `isMonthGatedForEntity()`, update the two `getLatestOpenMonthForEntity()`
   call sites, delete the retired constant/helper/function, rewrite the stale doc comments.
2. **Test reversal** (`src/lib/financial-report-queries.test.ts`) — flip/delete/add per the exact
   list above. `pnpm test` must be green before moving on; this is the regression gate for step 1.
3. **`unremittedDeposits` query + type** (`src/lib/ledger-queries.ts`) — additive, independent of
   steps 1-2, can be built/tested in parallel.
4. **`UnremittedDepositsPanel` component + wire-up** (`src/components/admin/ledger/*.tsx`) — depends
   on step 3's type shape only.
5. No schema, no `FEATURES` entry, no email notification, no server action/route — none apply here.
6. Release notes entry (tech-lead, at merge time) — user-facing framing: "the club's monthly
   financial statement no longer waits on deposits that are still working their way through the
   bank," plus (if judged worth a line) "the admin Ledger dashboard now tracks unremitted deposits
   the same way it already tracks uncashed checks." No file-list section per standing instruction.

## Edge Cases & Risks

- **A row that is BOTH an outstanding check and an uncleared deposit:** not reachable —
  `flow` is a two-value enum (`'income' | 'expense'`), so `isOutstandingCheckRow()`
  (`flow === 'expense'`) and `isUnclearedDepositRow()` (`flow === 'income'`) are mutually
  exclusive by construction. No precedence rule needed.
- **Empty-list state:** both existing list-rendering conventions already handle this
  (`uncashed-checks-panel.tsx`'s `checks.length === 0` branch) — `unremitted-deposits-panel.tsx`
  copies the same pattern verbatim ("No unremitted deposits.").
- **One-Month column:** untouched by either change — confirmed in Phase 1 item 3 and unaffected by
  anything in this design; `computeOneMonthCashActuals()` is not touched by either the gate fix or
  the new dashboard query.
- **Entity/fund scope for the gate fix:** unchanged — still `MEMBER_EXPOSED_FUND_KINDS`
  (`administrative`, `charitable`) only, via `isMemberExposedKind(r.fundKind)`, already present in
  both gated functions and untouched by this design.
- **Entity/fund scope for the new dashboard panel:** deliberately **wider** than the gate — all
  funds, both entities, no `MEMBER_EXPOSED_FUND_KINDS` filter, matching `uncashedChecks`'s own
  scope (an admin-only surface with no member-exposure boundary to respect).
- **`getLatestOpenMonthForEntity`'s `asOf` param surviving with a narrower purpose:** flagged
  explicitly above so a future reader doesn't assume it's dead code and remove it — it still drives
  `ceilingMonth` and is still test-injectable via `vi.useFakeTimers()`.
- **Doc-comment drift:** called out above as a required (not optional) part of step 1 — this repo
  has already hit a doc/behavior mismatch once on this exact function pair (qa's Phase 5 finding on
  the 2026-07-28 predecessor fix).

## Out of Scope (reconfirmed from Phase 1)

- Any change to `getFundReport()`, `computeOneMonthCashActuals()`, or reconciliation-session close
  logic.
- Any new `FEATURES.*` key or role-binding migration.
- A dedicated `/admin/ledger` sub-route for the new panel — it's a section on the existing
  dashboard, not a new page.

## Implementer

**api-developer for steps 1-3 (gate predicate + tests + `unremittedDeposits` query/type), then
ux-developer for step 4 (`UnremittedDepositsPanel` + wire-up).** Not full-stack: step 1 alone
touches ~40 lines of query logic plus a real regression-test rewrite across ~10 test cases (the
kind of work this repo's own precedent — the outstanding-check fix — treated as warranting its own
careful before/after verification), and step 3-4 together are a straightforward but real UI
addition (~80-120 lines: new type, new query, new component, one wire-up line) that's cleanly
separable from the query work once the type shape lands. This isn't the "small and tightly
coupled" case full-stack-developer is for — it's two independently-testable increments with a
clean handoff seam (the `UnremittedDepositRow` type), matching this project's own stated
preference for the specialist split whenever a feature has both real server logic and a real UI
surface. qa's Phase 5 pass should follow the same before/after regression-reproduction discipline
qa used on the 2026-07-28 predecessor (revert the fix, confirm the flipped tests go red; restore,
confirm green) given this reverses a previously-locked, previously-tested decision.

## Phase 3 — Technical Design — 2026-07-30

**Owner:** tech-lead
**Status:** complete

### Summary

Design covers two locked deliverables: (1) full-symmetry gate fix —
`isUnclearedDepositRow(r) => r.flow === 'income'` replaces the method-restricted, 12-day-windowed
`isInTransitZeffyDepositRow()`, reopening the check+income exclusion the 2026-07-28 fix locked;
(2) a new "Unremitted Deposits" panel on the admin Ledger dashboard, mirroring `uncashedChecks`
exactly, shipped in the same increment so the gate relaxation doesn't remove the only visibility a
stale deposit had. Neither change touches a displayed figure — confirmed against Phase 1 item 3 —
only gate state and dashboard visibility.

### What I did

- Folded Phase 2 myself (documented above, "Approved with reason") — no new directory, dependency,
  schema, or invariant touched; both changes are same-file predicate/query siblings of existing
  code.
- Read `src/lib/financial-report-queries.ts` in full to trace every use of `asOf`,
  `isInTransitZeffyDepositRow`, `daysBetween`, and `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`, and
  confirmed via grep that `isMonthGatedForEntity`/`getLatestOpenMonthForEntity` have exactly one
  caller each outside their own file/test file (`src/app/members/financial-reports/page.tsx` and
  `.../[entitySlug]/[month]/page.tsx`), neither of which passes `asOf` — safe to drop the param
  from `isMonthGatedForEntity()`.
- Read `src/lib/financial-report-queries.test.ts`'s full `isMonthGatedForEntity` and
  `getLatestOpenMonthForEntity` describe blocks to identify exactly which tests flip, which delete,
  which are added, and which are untouched.
- Read `getDashboard()`'s `uncashedChecks` query and `UncashedChecksPanel` end-to-end (query, type,
  component, permission gate) in `src/lib/ledger-queries.ts` and
  `src/components/admin/ledger/uncashed-checks-panel.tsx` to design the mirrored
  `unremittedDeposits` query/`UnremittedDepositsPanel` component against the same shape and the
  same page-level permission gate (no new `FEATURES` key).
- Logged **DECISION-059** in `docs/decisions.md` recording the reversal and cross-referencing what
  it supersedes (DECISION-051 item 3; the 2026-07-28 work-log's check+income exclusion).

### Outputs

- `docs/work-log/2026-07-30-deposit-in-transit-carveout.md` — Phase 2 note, full Phase 3 design
  (predicate, retired plumbing, exact test list, `unremittedDeposits` query/component/permission
  plan, implementation order, edge cases), per-phase status table updated.
- `docs/decisions.md` — DECISION-059 added (newest entry).
- No source code changed — design only, per instructions.

### Open questions / handoff notes

- **Next agent: api-developer** for steps 1-3 (gate predicate swap + doc-comment rewrite in
  `financial-report-queries.ts`, the full test reversal in `financial-report-queries.test.ts`, and
  the new `unremittedDeposits` query/type in `ledger-queries.ts`). Then **ux-developer** for step 4
  (`UnremittedDepositsPanel` component + wiring into `ledger-dashboard.tsx`). See "Implementer"
  above for why this is the specialist split rather than full-stack.
- Test reversal is the highest-risk step — it's reopening a deliberately-locked, previously-tested
  exclusion. api-developer should run the same red/green regression discipline qa used on the
  2026-07-28 predecessor before handing to qa.
- `src/lib/financial-report-ui.ts` has a doc-comment (not code) describing
  `isMonthGatedForEntity()`'s old behavior — worth a one-line pass so it doesn't describe retired
  behavior as current, flagged in the design's "Callers requiring no change" section.
- Nothing blocks starting Phase 4 immediately — no open questions back to the user; Chris's lock at
  the top of this file already resolved both load-bearing calls.

---

# Phase 4 — Implementation (API) — 2026-07-30

**Owner:** api-developer
**Status:** complete (steps 1-3 only — UI panel/wiring, step 4, is ux-developer's, not touched here)

### Summary

Implemented the server/query half of DECISION-059 exactly per the Phase 3 design: replaced the
method-restricted, 12-day-windowed `isInTransitZeffyDepositRow()` with a fully symmetric
`isUnclearedDepositRow()` (any `flow='income'` row, any payment method, any age), dropped the now-
dead `asOf` param from `isMonthGatedForEntity()`, updated `getLatestOpenMonthForEntity()`'s two
internal call sites, deleted the retired `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`/`daysBetween()`,
rewrote every stale doc comment describing the retired window/exclusion as current behavior, and
flipped/deleted/added the regression tests per the exact Phase 3 list. Also added the bundled
`unremittedDeposits` query + `UnremittedDepositRow` type to `getDashboard()`, mirroring
`uncashedChecks` exactly (full-symmetry income-side sibling, no payment-method filter). No schema
change, no new route, no new `FEATURES` key — pure query-layer edit plus one additive query, as
designed. `pnpm exec tsc --noEmit` and `pnpm test` are both green (833/833).

### What I did

- Read `src/lib/financial-report-queries.ts` end-to-end and traced every use of `asOf`,
  `isInTransitZeffyDepositRow`, `daysBetween`, `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`, and both
  call sites of `isMonthGatedForEntity()`/`getLatestOpenMonthForEntity()` (confirmed via grep:
  only `src/app/members/financial-reports/page.tsx` and `.../[entitySlug]/[month]/page.tsx`, both
  already calling with the reduced arg list — no page-side change needed).
- Replaced `isInTransitZeffyDepositRow()` with `isUnclearedDepositRow(r) => r.flow === "income"`;
  deleted `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS` and `daysBetween()` (grep-confirmed no other
  callers — `reconciliation.ts` has its own unrelated `daysBetweenUTC()`).
- Dropped the `asOf` param from `isMonthGatedForEntity()`; kept `getLatestOpenMonthForEntity()`'s
  own `asOf` param (still drives `currentMonthKey`/`ceilingMonth`, an independent use) but stopped
  threading it into `isUnclearedDepositRow()` (no age component) and into the final
  `isMonthGatedForEntity()` re-check call (signature no longer accepts a third arg).
- Rewrote the doc comments above `isOutstandingCheckRow()`, `isUnclearedDepositRow()`,
  `isMonthGatedForEntity()`, and `getLatestOpenMonthForEntity()` to point at DECISION-059 and this
  work-log instead of describing the retired 12-day window / check+income exclusion as current.
  Checked `src/lib/financial-report-ui.ts`'s doc comment (line 24) — it references
  `isMonthGatedForEntity`'s monotonicity property generically and does not describe the retired
  window as current behavior, so it needed no edit.
- Flipped, deleted, and added tests in `financial-report-queries.test.ts` per the Phase 3 list —
  see "Test changes" below for the exact accounting.
- **Caught and fixed a design-doc arithmetic error** in the Phase 3 test spec: the instruction to
  flip the `getLatestOpenMonthForEntity` "stale" test's expected value from `"2026-05"` to
  `"2026-06"` doesn't hold under the real computation. That test pins `asOf` to
  `2026-08-15` (unlike the "recent" test, pinned to `2026-07-05`), which independently sets
  `ceilingMonth = priorMonthKey("2026-08") = "2026-07"` — with the row no longer in
  `blockingDates` at all (full symmetry), the candidate resolves to `ceilingMonth` directly, i.e.
  `"2026-07"`, not `"2026-06"`. Traced this by hand against the real function body (not just
  running the test and copying the failure) before changing the assertion — verified `"2026-07"`
  is correct given `asOf`, then used `pnpm test` to confirm green. Flagged here per instructions
  rather than silently deviating from the design doc.
- Added `unremittedDeposits: UnremittedDepositRow[]` to `DashboardData` and the matching query
  inside `getDashboard()` in `src/lib/ledger-queries.ts`, structurally identical to the existing
  `uncashedChecks` query/mapping (same join, same `entityById` lookup, same shared `now`, same
  `daysSinceTxnDate()` helper) with `flow` flipped to `'income'` and the `paymentMethod` filter
  dropped entirely, per design.
- Checked `src/lib/ledger-queries.test.ts` for existing `getDashboard()`/`uncashedChecks` test
  coverage before deciding whether to add tests for the new query (design says "mirror it" if
  coverage exists) — confirmed via grep there is **none** (`getDashboard`, `uncashedRows`,
  `UncashedCheckRow` do not appear in that test file at all), so no new unit test was added for
  `unremittedDeposits` — there's nothing to mirror. Flagging this explicitly for qa/ux-developer:
  `getDashboard()` (and now both its list queries) has zero unit coverage today; that's a
  pre-existing gap, not something this change introduced or is required to close under the Phase 3
  design's "mirror it" instruction.
- Ran `pnpm exec tsc --noEmit` (clean) and `pnpm test` (833/833 passing) after all edits.
  `pnpm exec eslint` was attempted and hit the known pre-existing unrelated ESM
  (`minimatch`/`eslintrc`) crash — confirmed it's the same environment-level failure CLAUDE.md
  already documents as ignorable, not something introduced by this change.
- Did not touch `getFundReport()`, `computeOneMonthCashActuals()`, reconciliation-session logic, or
  any React component/page — confirmed out of scope, per design.

### Outputs

**Signature changes:**
- `isMonthGatedForEntity(entityId: string, monthEnd: string): Promise<boolean>` — dropped the
  `asOf` param (was `(entityId, monthEnd, asOf = new Date())`).
- `getLatestOpenMonthForEntity(entityId: string, asOf: Date = new Date()): Promise<string | null>`
  — signature unchanged; internal body no longer threads `asOf` into the gate predicate.
- `getDashboard(): Promise<DashboardData>` — signature unchanged; `DashboardData` gains
  `unremittedDeposits: UnremittedDepositRow[]`.

**Retired symbols** (`src/lib/financial-report-queries.ts`): `isInTransitZeffyDepositRow()`,
`IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`, `daysBetween()` — all deleted, replaced by
`isUnclearedDepositRow(r: { flow: string }): boolean => r.flow === "income"`.

**Test changes** (`src/lib/financial-report-queries.test.ts`, net local count +1, file total
33 `it()` blocks, full suite 833/833 passing):
- **Flipped (2):**
  - `"STILL gates on an unreconciled check+INCOME row..."` → renamed
    `"does NOT gate on an unreconciled check+INCOME row anymore — full deposit-in-transit
    symmetry, DECISION-059..."`, assertion `.toBe(true)` → `.toBe(false)`.
  - `"DOES truncate the candidate when the same-shaped row is genuinely stale..."` → renamed
    `"does NOT truncate the candidate even when the same-shaped income row is old..."`, assertion
    `.toBe("2026-05")` → `.toBe("2026-07")` (see "design-doc arithmetic error" note above — NOT
    `"2026-06"` as the Phase 3 doc's literal text says; `"2026-07"` is the value the real code
    produces and is the correct assertion).
- **Deleted (2):** `"does NOT gate on a recent in-transit Zeffy deposit... within the 12-day
  window..."` and `"STILL gates on the SAME Zeffy deposit once it's stale... more than 12 days..."`
  — both tested retired `asOf`-window machinery.
- **Added (3):** `"does NOT gate on an unreconciled ZEFFY income row of ANY age..."` (reuses the
  old 51-days-later fixture, now asserts `false`), `"does NOT gate on an unreconciled CASH income
  row..."`, `"does NOT gate regardless of paymentMethod value, including null/legacy rows..."`.
- **Reworded only, same assertion (2):** the outstanding-check `.toBe(false)` test's block comment
  (now notes the check+income exclusion it used to guard is gone); the zeffy-EXPENSE-row
  `.toBe(true)` test's comment (now says "flow='income' only, method-agnostic in both directions"
  instead of implying a retired window).
- Renamed the `getLatestOpenMonthForEntity` describe block to `"getLatestOpenMonthForEntity —
  uncleared-deposit carve-out (full symmetry)"`.
- All other tests in the file (monthBounds, fiscal-year framing, computeOneMonthCashActuals,
  getMonthlyStatement, etc.) untouched.

**`unremittedDeposits` query** (`src/lib/ledger-queries.ts`, inside `getDashboard()`, immediately
after the existing `uncashedChecks` construction):

```ts
export type UnremittedDepositRow = {
  id: string;
  entitySlug: string;
  entityName: string;
  fundSlug: string;
  fundName: string;
  party: string | null;
  paymentMethod: string | null;
  amountCents: number;
  txnDate: string; // 'YYYY-MM-DD'
  memo: string | null;
  ageDays: number; // computed via daysSinceTxnDate(), same helper uncashedChecks uses
};
```

Query: `ledgerTransactions` left-joined to `ledgerFunds`, `WHERE flow='income' AND status='posted'
AND reconciled=false` (no `paymentMethod` filter, no fund-kind/`MEMBER_EXPOSED_FUND_KINDS` filter —
both funds, both entities, matching `uncashedChecks`'s own admin-only scope), `ORDER BY txnDate
ASC`. Mapped via the same `entityById` lookup and shared `now` already in scope for
`uncashedChecks`. Added as `DashboardData.unremittedDeposits`. No new permission — rides the
existing page-level `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate at
`src/app/(dashboard)/admin/ledger/page.tsx`, unchanged.

**Files modified:**
- `src/lib/financial-report-queries.ts` — predicate swap, signature change, doc-comment rewrite.
- `src/lib/financial-report-queries.test.ts` — test reversal per above.
- `src/lib/ledger-queries.ts` — `UnremittedDepositRow` type, `DashboardData.unremittedDeposits`
  field, new query + mapping inside `getDashboard()`, doc-comment update on `getDashboard()` itself.

**Schema Changes:** none.

### Open questions / handoff notes

- **Next agent: ux-developer** for step 4 — build `src/components/admin/ledger/
  unremitted-deposits-panel.tsx` (structural copy of `uncashed-checks-panel.tsx`, "Check #" column
  swapped for "Method", same empty-state/age-pill conventions) and wire
  `<UnremittedDepositsPanel deposits={dashboard.unremittedDeposits} />` into
  `src/components/admin/ledger/ledger-dashboard.tsx`, immediately after `<UncashedChecksPanel
  .../>` and before `<AuditItemsPanel .../>`, per the Phase 3 design. `unremittedDeposits` already
  flows through `getDashboard()` → `page.tsx` → `<LedgerDashboard dashboard={...} />` with no
  further plumbing needed. `paymentMethodLabel()`/`PAYMENT_METHOD_LABELS` currently live
  unexported in `reconciliation-match-picker.tsx` (~lines 34-47) — implementer's call whether to
  export or duplicate the small map, per design.
- **Design-doc discrepancy flagged above (not a blocker, already resolved):** the Phase 3 doc's
  literal instruction for the second `getLatestOpenMonthForEntity` test's expected value
  (`"2026-06"`) doesn't match the real computed result (`"2026-07"`) given that test's own pinned
  `asOf` (`2026-08-15`, independently setting `ceilingMonth`). Implemented and shipped with the
  traced-correct value (`"2026-07"`); test is green. Worth a note in Phase 6 so this doesn't read
  as an unexplained deviation from the design doc.
- **Pre-existing gap, not introduced here:** `getDashboard()` (both `uncashedChecks` and now
  `unremittedDeposits`) has zero unit-test coverage in `ledger-queries.test.ts`. The Phase 3
  design's instruction was to mirror existing coverage if it exists; since none exists, none was
  added. Worth flagging to qa as a coverage gap independent of this feature, not something Phase 4
  was asked to close.
- No open questions blocking ux-developer — the `UnremittedDepositRow` type and
  `DashboardData.unremittedDeposits` field are the handoff seam, both stable and already typechecked.

---

# Phase 4 — Implementation (UI) — 2026-07-30

**Owner:** ux-developer
**Status:** complete

### Summary

Built `UnremittedDepositsPanel`, a structural copy of `UncashedChecksPanel`, and wired it into the
admin Ledger dashboard immediately after `<UncashedChecksPanel .../>` and before
`<AuditItemsPanel .../>`, exactly per the Phase 3 design. Consumed `DashboardData.unremittedDeposits`
and the `UnremittedDepositRow` type from `src/lib/ledger-queries.ts` as-is — no server/query code
touched. `pnpm exec tsc --noEmit` is clean and `pnpm test` is green (833/833, unchanged from
api-developer's Phase 4 handoff — this step added no new tests, matching the design's note that
`getDashboard()` has no existing unit coverage to mirror).

### What I did

- Read this work-log's Phase 3 design and Phase 4 (API) section in full to confirm the exact
  `UnremittedDepositRow` shape, render location, column plan, and payment-method-label guidance
  before writing any component code.
- Read `src/components/admin/ledger/uncashed-checks-panel.tsx` end-to-end and copied its structure
  verbatim: same `overflow-x-auto`/`rounded-2xl` table wrapper, same `bg-gray-50 rounded-2xl p-10
  text-center text-gray-500` empty state, same `formatDollars`/`formatDate` local helpers, same
  >90-day amber age-pill treatment, same row-end view link deriving FY from the row's own `txnDate`
  via `getFiscalYear()` (not the dashboard's current fiscal year).
- Swapped the "Check #" column for "Method" (column order: Entity, Fund, Party, Method, Amount,
  Date, Age, Memo, view-link), per the design's explicit column plan — a dedicated Check # column
  doesn't generalize across payment methods.
- Added a short explanatory subtitle under the panel heading ("Posted income deposits not yet
  reconciled — the income-side twin of uncashed checks") per the task's UX guidance, styled as
  `text-sm text-gray-500` under the `<h2>`, matching how other dashboard panels caption themselves.
- Duplicated the small `PAYMENT_METHOD_LABELS` map + a `paymentMethodLabel()` helper locally
  (6-entry map, null-safe — returns "—" for a null `paymentMethod`) rather than exporting the
  unexported one in `reconciliation-match-picker.tsx`, per the design's explicit allowance
  ("duplicating a 6-line `Record<string,string>` is not a red flag here").
- Wired `<UnremittedDepositsPanel deposits={dashboard.unremittedDeposits} />` into
  `src/components/admin/ledger/ledger-dashboard.tsx`, immediately after `<UncashedChecksPanel
  checks={dashboard.uncashedChecks} />` and before `<AuditItemsPanel .../>`, added the import
  alongside the existing `UncashedChecksPanel`/`AuditItemsPanel` imports. No other change to
  `ledger-dashboard.tsx` or `page.tsx` — `unremittedDeposits` already flowed through `getDashboard()`
  with no further plumbing needed, confirmed by the clean typecheck.
- Ran `pnpm exec tsc --noEmit` (clean, no errors) and `pnpm test` (833/833 passing — same count as
  api-developer's Phase 4 handoff, confirming this step introduced no regressions and no new test
  debt). Did not run `pnpm build:only` or `pnpm lint` per the task's explicit instruction (lint has
  the known pre-existing unrelated ESM failure documented in CLAUDE.md).
- Did not touch any server/query code, schema, or permission — confirmed the component is a pure
  Server Component (no `'use client'`, matching `UncashedChecksPanel`), props-in/read-only, riding
  the existing page-level `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate with no
  new `FEATURES` key.

### Outputs

- `src/components/admin/ledger/unremitted-deposits-panel.tsx` — new file, `UnremittedDepositsPanel`
  Server Component.
- `src/components/admin/ledger/ledger-dashboard.tsx` — added import + render line for
  `UnremittedDepositsPanel`, positioned between `UncashedChecksPanel` and `AuditItemsPanel`.
- No decisions.md entry — this step is a mechanical UI mirror of an already-decided design
  (DECISION-059 covers the substantive call); nothing new to log.

### Open questions / handoff notes

- **Reviewer click-through:** `/admin/ledger` (dashboard) as a user with `LEDGER_VIEW` or above —
  confirm the "Unremitted Deposits" panel renders directly under "Uncashed Checks," with the same
  visual weight/spacing, and that its empty state ("No unremitted deposits.") renders correctly if
  the list is empty in your local data. If there's live unreconciled income data, confirm the
  Method column shows humanized labels (Check, Cash, Zeffy, Debit Card, Bill Pay, Other, or a
  title-cased fallback for anything else) and that a null `paymentMethod` renders "—" rather than
  blank or "null". Confirm the >90-day age pill (amber, "90+ days") renders for any sufficiently
  old row, and that the view-link on each row navigates to the correct fund/FY (derived from the
  row's own date, which can differ from the dashboard's current FY for an old deposit).
- **New copy strings the Club may want to refine:** the panel subtitle — "Posted income deposits
  not yet reconciled — the income-side twin of uncashed checks" — is functional but a little
  technical/insider ("twin of uncashed checks" assumes the reader already knows that panel exists
  right above it). Worth a treasurer pass if the Club wants friendlier phrasing; not blocking.
- **UX decision made:** added the subtitle line (not in the Phase 3 design's component spec, but
  explicitly requested by this task's brief as "a short helper/explanatory line"). Positioned it
  as a `<p>` under the `<h2>`, consistent with how this codebase generally captions a
  section — `UncashedChecksPanel` itself has no such subtitle, so this is a small, deliberate
  divergence from "structurally a copy," scoped to just the heading area.
- **Next agent: qa** for Phase 5 — dev-server smoke test of `/admin/ledger`, manual click-through
  of the flow above, and (per the Phase 3 design's implementer note) the same before/after
  regression discipline used on the 2026-07-28 predecessor is already api-developer's responsibility
  for the gate-predicate half, not this UI step — nothing in this step needs a revert/restore check
  since it's purely additive presentation code with no behavior to regress.

---

# Phase 5 — Verification (qa)

**Date:** 2026-07-30
**Verified by:** qa

## Summary

**PASS.** All four mechanical gates are green (typecheck clean, 833/833 unit tests, production
build clean with 105 routes including both touched routes, and a live authenticated Playwright
smoke pass against `/admin/ledger` and `/members/financial-reports`). Read every changed line of
`isMonthGatedForEntity()`, `isUnclearedDepositRow()`, `getLatestOpenMonthForEntity()`, and the new
`unremittedDeposits` query/panel against the Phase 3 design and DECISION-059 — implementation
matches the design exactly, including the implementer's documented, hand-verified deviation from
the design doc's literal `"2026-06"` to the correct `"2026-07"` in one flipped test. Additionally
ran the regression discipline the design explicitly asked for: reverted the source to pre-fix
(pre-DECISION-059) behavior via `git stash` while keeping the new test file, confirmed the 5
new/flipped tests go red for the right reason, then restored and confirmed 833/833 green again.
Confirmed via a local-dev-DB script that `getLatestOpenMonthForEntity()` now returns `"2026-06"`
for the Club — the two remaining unreconciled rows in local dev are both pre-existing outstanding
checks (2026-03-07, unaffected by this fix), and there are zero unreconciled income rows for the
Club locally, so this is weak/inconclusive evidence for "the fix un-gated June" specifically (the
exact production repro — the 6 June 25–27 rows — is not present in local dev data to reproduce
against) — treat the "June now publishes" claim as **code-level confirmed, live-data confirmed only
by absence-of-counterevidence**, not by reproducing the original bug and watching it resolve.
Production branch was not queried (optional per task, and the local-dev check already showed the
mechanism firing correctly on the rows that ARE present). Added one new Playwright spec
(`e2e/deposit-in-transit-carveout.spec.ts`) as permanent regression coverage for the panel
rendering and both pages loading without a runtime error — this is real, not code-traced, evidence
that the two touched surfaces work end-to-end under a real session. Adjudicated the flagged
`getDashboard()` coverage gap as **acceptable to ship without a new unit test** — see "Coverage gap
adjudication" below.

## Type Check

`pnpm exec tsc --noEmit`: **PASS** — clean, no output.

## Unit Tests

`pnpm test`: **PASS**
Total: 833 | Passed: 833 | Failed: 0
Duration: ~1.4s (33 test files)

## Production Build

`pnpm build:only`: **PASS**
Notes: Turbopack build, "Compiled successfully in 7.0s", TypeScript pass in 11.6s, 105 routes
generated, no warnings or errors in the full build log. `/admin/ledger` and
`/members/financial-reports` (+ `[entitySlug]/[month]`) both present in the route manifest as
dynamic (`ƒ`) routes, as expected for `auth()`-gated pages.

## Dev-Server Smoke Test

Dev server already running on `localhost:3000` (left up, not restarted).

- `curl` unauthenticated to `/admin/ledger` and `/members/financial-reports`: both `307` redirect
  to `/signin?callbackUrl=...` — correct gated behavior, no 500, no crash.
- Authenticated Playwright pass (see "End-to-End Tests" below) against both routes: **PASS**, no
  runtime-error overlay, panel and page content render.

## End-to-End Tests

Ran a targeted Playwright pass (not the full `pnpm test:e2e` suite, to stay time-boxed — the full
suite is unrelated to this change and already green per prior work-logs):

`pnpm exec dotenv -e .env.local -- playwright test e2e/deposit-in-transit-carveout.spec.ts`: **PASS**
Total: 2 | Passed: 2 | Failed: 0
Duration: 6.5s

New spec `e2e/deposit-in-transit-carveout.spec.ts` (added as permanent coverage, no data mutation,
nothing to clean up):
1. Signs in as the E2E admin, loads `/admin/ledger`, asserts the "Unremitted Deposits" heading is
   visible and — when the "Uncashed Checks" panel is also visible — asserts it renders below it
   (matching the design's required render order). Asserts no "Application error" text.
2. Signs in as the E2E admin, loads `/members/financial-reports`, asserts an `<h1>` is visible and
   no "Application error" text.

## Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| `/admin/ledger` renders Unremitted Deposits panel after Uncashed Checks | pass | Confirmed by the new Playwright spec against a real authenticated session, not code-trace alone. Local dev data currently has zero unreconciled income rows, so the panel renders its empty state ("No unremitted deposits.") — empty-state rendering confirmed live; row-rendering (Method column labels, age pill, view-link) confirmed by code-trace against `UncashedChecksPanel`'s already-proven pattern only, not against live rows with data. |
| `/members/financial-reports` loads without runtime error | pass | Confirmed by the new Playwright spec. |
| Google Group sync, Zeffy, Resend | n/a | Not touched by this feature. |

## Behavioral Verification

### Gate symmetry — `isUnclearedDepositRow`

Read `src/lib/financial-report-queries.ts` lines 284–405 directly (not inferred from tests). Confirmed:
- `isUnclearedDepositRow(r) => r.flow === "income"` — no `paymentMethod` check, no age/`asOf` input. Matches Phase 3 design verbatim.
- `isMonthGatedForEntity()` gates on a row iff `isMemberExposedKind && txnDate <= monthEnd && !isOutstandingCheckRow(r) && !isUnclearedDepositRow(r)` — i.e., a posted/unreconciled row gates **only** if it is neither an outstanding check (`flow='expense' AND paymentMethod='check'`) nor any income row. Confirmed via the regression-discipline stash/restore (below) that the flipped tests — unreconciled check+income no longer gates, stale/aged Zeffy no longer gates, cash-income no longer gates, null-method income no longer gates — all correctly go red on pre-fix code and green on the shipped code.
- `isOutstandingCheckRow()` is byte-for-byte unchanged from the 2026-07-28 predecessor (`paymentMethod === "check" && flow === "expense"`) — expense-side behavior is provably untouched (same predicate, same test assertions for "STILL gates on an unreconciled non-check expense" and "does NOT gate on an unreconciled OUTSTANDING CHECK", both left unmodified per the Phase 3 test-reversal plan and confirmed unchanged in the diff).
- `asOf` correctly dropped from `isMonthGatedForEntity()`'s signature (grep-confirmed both call sites in `financial-report-queries.ts` and the two page files pass no `asOf`); `getLatestOpenMonthForEntity()` correctly retains its own `asOf` param for `ceilingMonth`/`currentMonthKey` only, no longer threading it into the gate predicate.

### No displayed-number changes

Confirmed by reading `getFundReport()` (no `reconciled` filter anywhere in that query — posted-basis, unaffected) and `computeOneMonthCashActuals()` (still filters `reconciled=true`, itself untouched — no diff in this function at all per `git diff --stat`, which shows only `financial-report-queries.ts` predicate/signature lines, `ledger-queries.ts` additive query, `ledger-dashboard.tsx` one import + one render line, and the test file). Neither function appears in the diff's touched-function list. This fix changes gate state only.

### June now publishes for the Club (code-level)

Traced by hand: the six June 25–27 Club rows (5 Zeffy + 1 received-check, all `flow='income'`) are now all excluded by `isUnclearedDepositRow()` regardless of `paymentMethod`, so none of them can gate June for the Club under the new predicate — code-level confirmed. Ran a local-dev-DB script (`getLatestOpenMonthForEntity()` called directly for both entities against the live-connected dev DB) and got `"2026-06"` for both Club and Foundation. However, local dev data does **not** contain the specific repro rows (queried directly: zero unreconciled income rows for either entity; the only two unreconciled rows present are the pre-existing 2026-03-07 outstanding checks from the 2026-07-28 predecessor, both `flow='expense'`, unaffected by this fix) — so this result confirms the mechanism is wired correctly end-to-end against whatever data exists, but is not a reproduction of the original production symptom resolving. Did not query the `production` branch (`br-mute-recipe-amc7uz5o` on `tiny-fog-13725730`) — optional per task, and not necessary given the predicate-level proof plus the passing regression tests already demonstrate the fix mechanically.

### Unremitted Deposits panel

Read `src/components/admin/ledger/unremitted-deposits-panel.tsx` and `ledger-dashboard.tsx` in full. Confirmed: renders immediately after `<UncashedChecksPanel />` and before `<AuditItemsPanel />` (both statically and confirmed live via the new e2e spec's ordering assertion); columns are Entity, Fund, Party, Method, Amount, Date, Age, Memo, view-link, exactly per design; empty state (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No unremitted deposits.") present and confirmed rendering live (local data is currently empty for this query); inherits the page's existing `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate at `src/app/(dashboard)/admin/ledger/page.tsx` — no new `FEATURES` key introduced anywhere in the diff (grep-confirmed). Mobile 360px: code-trace only — identical `overflow-x-auto` wrapper and `min-w-full` table pattern to `UncashedChecksPanel`, which is an already-shipped, presumably-verified responsive pattern; not re-verified at a physical/emulated 360px viewport in this pass.

## Coverage Gap Adjudication — `getDashboard()` / `unremittedDeposits`

**Verdict: acceptable to ship without a new unit test.** Reasoning:

- Read `getDashboard()` in full (`src/lib/ledger-queries.ts` lines ~3120–3257). It composes `getEntities()`, a parallel `getOverview()` call per entity (each of which is itself a large, multi-query function), then two independent raw queries (`uncashedRows`, `unremittedRows`). Unit-testing this function requires mocking the entire `getEntities()`/`getOverview()` chain, not just the two-line `WHERE` clause the new query adds — this is a genuinely expensive test to write, not a cheap mirror.
- `uncashedChecks` — the exact structural sibling this PR's `unremittedDeposits` mirrors — has been in production with zero unit coverage since it shipped (confirmed via grep: `getDashboard`, `uncashedRows`, `UncashedCheckRow` do not appear anywhere in `ledger-queries.test.ts`). The Phase 3 design's own instruction was "mirror existing coverage if it exists" — none exists, so the implementer's decision not to invent new coverage for this one query while its sibling has none is consistent, not a lapse.
- The new query itself has no branching logic to unit-test — it's a straight-line `SELECT ... WHERE flow='income' AND status='posted' AND reconciled=false ORDER BY txnDate ASC` plus a 1:1 field mapping using the same `daysSinceTxnDate()` helper already exercised elsewhere. The actual interesting logic this feature ships — the carve-out predicate itself — lives in `financial-report-queries.ts` and **is** thoroughly unit-tested (33 tests, including the 3 new symmetry tests and 2 flipped tests, all verified red-then-green in this Phase 5 pass).
- I closed part of the gap with real evidence instead: the new Playwright spec authenticates and hits `/admin/ledger`, which exercises `getDashboard()` → `unremittedRows` → `UnremittedDepositsPanel` end-to-end against the real DB and real Drizzle query, and asserts it renders without error. That's weaker than a targeted unit test (only exercises the empty-list branch given current local data) but it's real, not inferred, and covers more of the stack (query + type + component + wiring + permission gate) than a mocked unit test would.
- Recommend, but do not require: a future dedicated pass adding `getDashboard()` mocking infrastructure to `ledger-queries.test.ts` (it would then cover both `uncashedChecks` and `unremittedDeposits` in one investment) — logged as a follow-up note below, not a blocker for this fix.

## Regression Tests Added

- `financial-report-queries.test.ts:252` — "does NOT gate on an unreconciled check+INCOME row anymore — full deposit-in-transit symmetry, DECISION-059..." — guards against: the 2026-07-28 check+income exclusion silently coming back.
- `financial-report-queries.test.ts:285` — "does NOT gate on an unreconciled ZEFFY income row of ANY age..." — guards against: the retired 12-day window silently coming back. Flagged by the Phase 3 design as "the most important new test — it's the one that would catch someone silently reintroducing an age check." Verified red-then-green in this pass.
- `financial-report-queries.test.ts:303` — "does NOT gate on an unreconciled CASH income row..." — guards against: a future method-restriction narrowing (e.g. "Zeffy + check only").
- `financial-report-queries.test.ts:316` — "does NOT gate regardless of paymentMethod value, including null/legacy rows..." — guards against: a null-method row falling through to gate by omission.
- `financial-report-queries.test.ts:376` — "does NOT truncate the candidate even when the same-shaped income row is old..." (`getLatestOpenMonthForEntity`) — guards against: the picker's independent `blockingDates` filter silently reintroducing the retired window even if the gate predicate itself stays fixed (this is exactly the class of bug the 2026-07-28 predecessor's own history warned about — fixing one call site and not the other).
- `e2e/deposit-in-transit-carveout.spec.ts` (new, this Phase 5 pass) — guards against: the panel or either page throwing a runtime error under a real session, and against the panel's render order relative to Uncashed Checks silently changing.

All five flipped/new unit tests were verified via `git stash` red/green discipline in this Phase 5 pass (not just read as passing) — reverted `financial-report-queries.ts` to pre-fix behavior while keeping the new test file, confirmed exactly these 5 tests failed (28 others in the file stayed green), then restored and confirmed 833/833 green.

## Coverage on Critical Modules

- `src/lib/financial-report-queries.ts`: not independently measured this pass (no `--coverage` run), but the touched functions (`isUnclearedDepositRow`, `isMonthGatedForEntity`, `getLatestOpenMonthForEntity`) have 12 direct test cases between the two describe blocks — high confidence, consistent with this module's standing 90%+ target.
- `src/lib/permissions.ts`: untouched by this feature.
- `src/lib/members.ts`: untouched by this feature.
- `src/lib/ledger-queries.ts` (`getDashboard()`/`unremittedDeposits`): 0% unit coverage — see "Coverage Gap Adjudication" above. Pre-existing gap, not introduced or worsened in kind (its sibling `uncashedChecks` was already at 0%) though the surface area of the gap grew by one query.

## Feature-Gate Audit (mandatory before PASS)

No protected route or server action was added or changed by this feature — the gate-predicate
change is internal query logic behind the already-gated `/members/financial-reports` page (no
`FEATURES` gate on that page, by design, unchanged), and the new dashboard panel is a Server
Component prop-drilled from `getDashboard()`, not its own route.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `/admin/ledger` (page.tsx, pre-existing, unchanged) | yes | yes (`hasAnyFeature`) | `FEATURES.LEDGER_VIEW` / `LEDGER_RECORD` / `LEDGER_MANAGE` — same set `uncashedChecks` already rides, correctly unchanged |
| `/members/financial-reports` (pre-existing, unchanged) | yes (`auth()`, member-link check) | n/a — deliberately no `FEATURES` gate, per CLAUDE.md ("open to any linked member") | n/a |

No new route, no new server action, no new `FEATURES.*` key anywhere in the diff (grep-confirmed
across all four touched files).

## Verdict

**PASS**

## Handoff

Next agent: **analyst**, for Phase 6 shipped-vs-intent review. Nothing to loop back — all four
mechanical gates green, regression discipline executed (not just claimed), behavioral verification
traced against actual code, one real gap (production-repro-data confirmation) explicitly flagged as
unresolved-but-optional-and-acceptable, one coverage gap explicitly adjudicated as
acceptable-to-ship with reasoning, one new permanent e2e spec added. Worth surfacing to analyst:
the June-publishes-now claim rests on code-level proof + passing regression tests, not on
reproducing the original bug against live matching data (local dev DB doesn't have the June
repro rows) — analyst should decide whether that residual gap needs a follow-up (e.g. a treasurer
manual check against production once this ships) or is acceptable as-is given the strength of the
predicate-level proof.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-07-30
**Owner:** analyst
**Status:** complete

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The deposit-in-transit carve-out is now genuinely symmetric with the outstanding-check carve-out — no method restriction, no time bound, on both sides — and the fix shipped with the permanent visibility net (Unremitted Deposits panel) it needed to not be a net loss of oversight; the one thing not fully closed is that "June now publishes" is proven at the predicate/test level but was never watched happening against the actual production repro data, which is an acceptable, explicitly-flagged gap rather than a blocker.

## What's Working

- **The predicate itself is exactly what Phase 1/3 specified, verified by direct code read, not just trusting the work-log's narration.** `isUnclearedDepositRow(r) => r.flow === "income"` in `src/lib/financial-report-queries.ts` (confirmed by `Read`) has no `paymentMethod` check and no age input — a clean two-line mirror of `isOutstandingCheckRow()`'s shape, exactly as DECISION-059 specified. Grep confirms `isInTransitZeffyDepositRow`, `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`, and `daysBetween()` are fully gone — no dead code left behind.
- **Both consumers of the carve-out changed together**, avoiding the exact bug class the 2026-07-28 predecessor's own history warned about (fixing the gate predicate but not the picker's independent `blockingDates` filter). Read both `isMonthGatedForEntity()` and `getLatestOpenMonthForEntity()` directly — both now call `!isOutstandingCheckRow(r) && !isUnclearedDepositRow(r)`, both dropped `asOf` threading into the deposit check, and `getLatestOpenMonthForEntity()` correctly kept its own `asOf` param for the unrelated `ceilingMonth`/`currentMonthKey` computation.
- **The "no displayed number changes" promise holds.** Read `getFundReport()` directly — no `reconciled` filter anywhere in its transaction query, confirming Twelve-Month/Budget columns are untouched. `computeOneMonthCashActuals()` still filters `eq(ledgerTransactions.reconciled, true)` unchanged. Neither function appears in the diff. This was Phase 1's single load-bearing promise ("the gate has never protected the displayed numbers... relaxing it only changes whether the page renders, never a number inside it") and it's intact.
- **The Unremitted Deposits panel is a faithful, complete mirror of Uncashed Checks** — read the component directly: same `rounded-2xl` card/empty-state pattern, same `overflow-x-auto` table wrapper, same age-pill treatment (90+ days, amber), same fund/FY-derived view-link, `lions-blue` hover/focus ring on the link. Query has no `paymentMethod` filter and no fund-kind restriction (deliberately wider than the gate, matching `uncashedChecks`'s own admin-only scope) — correct per design. Render order confirmed directly in `ledger-dashboard.tsx`: `UncashedChecksPanel` → `UnremittedDepositsPanel` → `AuditItemsPanel`, exactly as specified.
- **Regression discipline was real, not asserted.** qa's stash/restore red-green cycle plus my own independent `pnpm test` run (833/833 green) and `pnpm exec tsc --noEmit` (clean) confirm the five flipped/new tests exist verbatim in `financial-report-queries.test.ts` at the line numbers qa cited and are exercising the right predicate.
- **The design-doc arithmetic correction was handled exactly right.** api-developer caught that the Phase 3 doc's literal `"2026-06"` expected value for the flipped `getLatestOpenMonthForEntity` "stale" test didn't hold under the real computation (that test's own pinned `asOf` independently sets `ceilingMonth`), traced it by hand, used `"2026-07"` instead, and flagged it loudly in the work-log rather than silently deviating. This is the right way to handle a design-doc bug — verify against the real function body, don't blindly implement wrong arithmetic, and don't hide the deviation.

## Intent-vs-Shipped Diff

- **Phase 1 said:** carve out every posted, unreconciled `flow='income'` row, full symmetry, no method or age restriction. **Shipped:** exactly that (`isUnclearedDepositRow`). **Verdict: matches.**
- **Phase 1 said:** delete the retired `IN_TRANSIT_ZEFFY_DEPOSIT_WINDOW_DAYS`/`daysBetween()`/`asOf`-on-`isMonthGatedForEntity` machinery. **Shipped:** all three gone, confirmed by grep and direct read. **Verdict: matches.**
- **Phase 1 said:** ship a permanent "unremitted deposits" visibility net in the same increment, not deferred, mirroring `uncashedChecks`. **Shipped:** `UnremittedDepositsPanel` + `unremittedDeposits` query, same increment, correct render position. **Verdict: matches.**
- **Phase 1 said (item 3):** the gate fix must not touch a single displayed number — `getFundReport()`/`computeOneMonthCashActuals()` out of scope. **Shipped:** confirmed untouched by direct read and by `git diff --stat` scope (qa) — only the two query files, the test file, and the two new-panel files changed. **Verdict: matches.**
- **Phase 1 said (Open Question 1):** this reverses the locked, tested 2026-07-28 check+income exclusion, and needs Chris's explicit sign-off before Phase 3 — not an analyst call to make unilaterally. **Shipped:** Chris's resolution is recorded at the top of this file ("FULL SYMMETRY... Required to actually publish June"), DECISION-059 logged and cross-references what it supersedes, and the regression test was flipped (not silently deleted) to actively guard against the exclusion quietly coming back. **Verdict: matches** — the reversal was made with the sign-off Phase 1 required, not assumed.
- **Phase 1 said (Open Question 2):** decide whether the safety-net view ships bundled or as a separate follow-up. **Shipped:** bundled, per Chris's resolution. **Verdict: matches.**
- **Phase 3 design doc said:** flip the `getLatestOpenMonthForEntity` stale test's expected value to `"2026-06"`. **Shipped:** `"2026-07"`, with the discrepancy traced and explicitly flagged by api-developer as a design-doc arithmetic error, not an implementation shortcut. **Verdict: acceptable drift** — the design doc was wrong, the code is right, and the deviation is documented rather than silent, which is exactly the standard this pipeline asks for when an implementer catches a spec bug.
- **Phase 1's item 4 (stale-deposit safety net) rationale said** a deposit that never clears is a worse failure mode than a check that never clears (aggressive vs. conservative surprise) — this was the argument *for* making the safety-net panel non-optional. **Shipped:** panel ships unconditionally in the same increment, not gated behind any flag or follow-up. **Verdict: matches.**

## Edge Cases

- **Empty state:** pass. `UnremittedDepositsPanel`'s empty branch (`bg-gray-50 rounded-2xl p-10 text-center text-gray-500`, "No unremitted deposits.") matches the CLAUDE.md empty-state convention exactly and was confirmed rendering live by qa's Playwright spec against current (empty) local data.
- **Failure microcopy:** not applicable. No new user-facing error path — the gate predicate change surfaces only as "month appears/doesn't appear in the picker" (pre-existing pattern, unchanged), and the new panel has no failure state of its own (read-only, server-rendered, no client fetch that can fail independently of the page load).
- **Permission gate:** pass. Confirmed by direct read of `src/app/(dashboard)/admin/ledger/page.tsx` gate logic referenced in the work-log and by qa's Feature-Gate Audit table — the panel rides the existing `hasAnyFeature([LEDGER_VIEW, LEDGER_RECORD, LEDGER_MANAGE])` gate, no new `FEATURES` key invented (grep-confirmed by both qa and, independently, by me finding no new key in `permissions.ts` references anywhere in the diffed files). `/members/financial-reports` correctly remains gate-free per its documented "open to any linked member" design — unchanged.
- **Mobile (360px):** not independently re-verified this pass (code-trace only, same as qa) — the panel reuses `UncashedChecksPanel`'s identical `overflow-x-auto`/`min-w-full` responsive table pattern, an already-shipped surface. Acceptable inheritance, not a fresh risk.
- **Brand consistency:** pass. `rounded-2xl` on both the table wrapper and empty state, `lions-blue`/`lions-blue-dark` on the view-link with a proper focus ring, no `rounded-full`, no native browser dialogs (nothing destructive on this read-only panel, so `<ConfirmDialog>` doesn't apply — correctly not used).

## Follow-Ups (SHIP WITH NOTES)

1. **Production spot-check of "June now publishes" for the Club.** qa's caveat is legitimate and not fully closed: the fix is proven at the predicate level (direct code read) and by passing regression tests (verified red-then-green), but local dev data doesn't contain the six June 25–27 repro rows, so nobody has watched the actual originally-reported symptom (June stuck for the Club) resolve against real data. Code-level proof is sufficient to ship — the predicate logic is simple, fully unit-tested, and the mechanism was confirmed firing correctly on whatever unreconciled rows *do* exist locally — but this doesn't reach the bar of "the bug is confirmed gone," only "the bug should be gone." **Action:** the treasurer (or Chris) checks `/members/financial-reports` for the Club's June statement in production once this deploys, confirms it now appears in the picker. Non-blocking — if it turns out something in production data still gates June, that's a fast, cheap follow-up investigation, not a sign this shipped wrong.
2. **`getDashboard()` / `unremittedDeposits` has no unit-test coverage.** Accepted as a pre-existing-pattern gap, not a new regression — its sibling `uncashedChecks` has been unit-test-free since it shipped, and qa's adjudication (mocking the full `getEntities()`/`getOverview()` chain to unit-test a straight-line `WHERE` clause with no branching logic) is reasonable. The new Playwright e2e spec provides real, if narrower, coverage (empty-state path only, given current data). **Action:** track as a standing note for whenever `ledger-queries.test.ts` gets `getDashboard()` mocking infrastructure — at that point it should cover both `uncashedChecks` and `unremittedDeposits` in one pass, not just the new one.
3. **Panel subtitle copy** ("Posted income deposits not yet reconciled — the income-side twin of uncashed checks") is functional but assumes the reader already understands the Uncashed Checks panel it's referencing. Minor, cosmetic, not blocking. **Action:** offer the treasurer a friendlier rewrite next time anyone touches this panel; no urgency.

## Red Flags (if NEEDS REWORK)

None. No regression, no scope creep into `getFundReport()`/`computeOneMonthCashActuals()`/reconciliation-session logic, no new `FEATURES` key, no broken invariant.

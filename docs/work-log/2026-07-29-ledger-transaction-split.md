# Ledger Transaction Split — Work Log

> **Slug:** `2026-07-29-ledger-transaction-split`
> **Surface:** (dashboard) admin — The Ledger books/register (`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`, row actions in `src/components/admin/ledger/transaction-actions.tsx`)
> **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) covers this
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-29 |
| 2 — Architectural review | architect | Skipped | N/A (no new dirs/deps) | 2026-07-29 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-07-29 |
| 4 — Implementation | full-stack-developer | Complete | Typecheck + unit tests pass | 2026-07-29 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A treasurer splits one unreconciled ledger transaction into two (or more) rows that sum to the original, so each part can be matched 1:1 against the separate bank lines it actually cleared as — the intended workaround for the reconciliation match table's one-transaction-per-match constraint.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| admin (treasurer, `ledger.record`) | Clicks **Split** on an unreconciled transaction row in the fund register | On demand, during reconciliation prep |
| admin | Enters a split dollar amount in a dialog | Once per split |
| admin | Confirms the split, creating a new row and decrementing the original | Once per split |
| admin | Edits the newly-created part afterward (existing **Edit** action) — e.g. to correct check number/payment method for the second bank line | On demand, immediately after a split or later |
| admin | Matches each part separately against a bank line during reconciliation (existing matching flow) | Per reconciliation session |

The request is entirely verb-shaped already — no "the system supports splitting" vagueness. Good.

## Flows

**Flow 1 — Split an unreconciled transaction:**
Entry: treasurer is viewing a fund register row (posted, `reconciled = false`, not `approvedAt`, not `status = 'rejected'`) → clicks **Split** → dialog asks for a split amount (dollars, > $0, strictly less than the row's current amount) → treasurer submits → server creates a new transaction row with the split amount and decrements the original by that amount → dialog closes, list refreshes.
- Outcome: two rows visible in the register, both dated (recommend) the same `txnDate` as the original, same `entityId`/`fundId`/`flow`/`categoryId`/`party`/`memo`/`beneficiaryCause`/`bankAccountId`; both `reconciled = false`, both immediately eligible for the reconciliation matching candidate query.
- Failure: amount ≤ 0 → "Enter an amount greater than $0." Amount ≥ current amount → "Split amount must be less than the transaction's current total." Row is reconciled/approved/rejected/matched-in-an-open-session → a specific 403 message per guard (see Gaps below) — never a raw 500 or stack trace.

**Flow 2 — Repeat split (3+ parts):**
Entry: treasurer splits an already-split row again → same dialog, validated against the row's *current* (already-decremented) amount, not the original historical amount.
- Outcome: a third row is created; the row being split again decrements further. No cap on split count other than amount > 0 after each split.
- Failure: same validation as Flow 1.

**Flow 3 — Reconcile each part:**
Entry: treasurer opens reconciliation matching for the bank account → both split parts now appear as separate matching candidates (existing `getCandidateTransactionsForMatching` query — no code change needed here since it already filters on `reconciled = false` + no existing match, and split parts satisfy both) → treasurer matches each part to its own bank line.
- Outcome: existing reconciliation flow, unmodified.
- Failure: existing reconciliation failure paths apply (unchanged).

## Permissions

- **Permission(s):** existing `ledger.record` (`FEATURES.LEDGER_RECORD`) — the same gate already used by transaction PATCH, DELETE, and the reconcile-toggle route. **Correction to the brief:** the request's mention of `ledger.manage` is the wrong key for this surface — `LEDGER_MANAGE` ("Manage funds, budgets, entities, and opening balances") gates fund/entity/budget administration, a different surface. All existing transaction CRUD on this table is gated on `LEDGER_RECORD`; Split should use the same gate for consistency, and needs no new `FEATURES` entry.
- **Default roles:** whichever roles currently hold `LEDGER_RECORD` (Treasurer, Admin) — no new role binding required.

## Gaps the Request Didn't Address

- **Guard set is incomplete as scoped.** The request says "reconciled transactions cannot be split," but the existing PATCH/DELETE routes on this same table guard on *three* things: `approvedAt` set, `status = 'rejected'`, and `reconciledSessionId` set — not the plain `reconciled` boolean directly. A transaction reconciled via the **legacy per-row toggle** (`/api/admin/ledger/transactions/[id]/reconcile`) sets `reconciled = true` **and explicitly clears `reconciledSessionId` to null** (by design, per the route's own comment: "this route is always an out-of-band correction... must never leave a stale session-provenance pointer"). That means a legacy-toggle-reconciled row would **pass** the existing PATCH guard's `reconciledSessionId` check even though it's reconciled. Split's own gate must check `reconciled === true` directly (matching the feature's plain-English intent), not just `reconciledSessionId`. Recommend Split apply the full existing guard set (`approvedAt`, `status='rejected'`, `reconciledSessionId`) **plus** an explicit `reconciled === true` check, since decrementing an approved or rejected row's amount is just as destructive to the audit trail as editing or deleting it. Why it matters: shipping only a `reconciled` check without the `approvedAt`/`rejected` checks would let a treasurer silently mutate an approved transaction's amount through a side door that the existing Edit/Delete UI deliberately blocks.
- **The mid-open-session case (load-bearing — Chris flagged this directly).** `reconciled` only flips to `true` when a reconciliation **session closes** (confirmed in `close/route.ts`), not when a transaction is matched to a bank line inside an **open** session. So a transaction that is already matched to a bank line in an open, unclosed session has `reconciled = false` and would pass a naive "unreconciled → splittable" gate. Splitting it would decrement the original's `amountCents` out from under an existing match — the matched bank line's amount would no longer tie to the (now smaller) transaction, silently corrupting that session's tie-out arithmetic with no error surfaced anywhere. **Recommended default: Split must also check for an existing match row** (`getMatchForTransaction`, unscoped to any one session) and block with "This transaction is already matched to a bank line in an open reconciliation session — unmatch it before splitting" if one exists. This is a new check with no existing equivalent in PATCH/DELETE today (worth flagging to architect/tech-lead separately: PATCH/DELETE arguably have the same latent gap, but that's a pre-existing issue, not in this feature's scope to fix).
- **check_number / payment_method inheritance (load-bearing — Chris flagged this directly).** Recommend the new part **inherits both fields unmodified**, same as everything else. Reasoning: the motivating case (an Eventeny card charge posting as two bank lines) means `paymentMethod` is typically `zeffy`/`debit_card`, not `check` — check payments clear as one bank line per check, so the two-bank-lines-per-entry case rarely involves a check number in practice. When it's wrong (e.g., two bank lines that really were two different checks), the treasurer already has the **existing Edit action** immediately available on the new row to correct `checkNumber`/`paymentMethod` before matching — no new UI needed for that correction path. Shipping a "clear check number on split" special case adds a rule to remember for a case that's rare and already self-correctable.
- **Audit/lineage back to the original.** The request only requires sum-preservation, which needs no new column. But the treasurer will eventually look at a register row and ask "where did this come from?" with no trail — especially relevant since this table also feeds 990 prep and financial-statement exports. Recommend a lightweight, optional `splitFromTransactionId` (nullable self-reference, `onDelete: set null`, no uniqueness constraint) on the new part only — cheap (one nullable column, one index at most), avoids a parallel status, and mirrors this table's existing precedent for cheap markers (`syncStale`, `reconciledSessionId` as a provenance pointer rather than a new status). This is a schema call, not mine to make outright — flagged as an open question below.
- **Confirm dialog vs. form dialog.** Split takes a required input (the amount) — it can't be a plain `<ConfirmDialog>` (no free-form input) and must not be `window.prompt()` (forbidden). It needs its own small form dialog, following the existing `TransactionFormDialog` pattern already used for Edit. Not a functional gap, just a build note for ux-developer so this isn't improvised as a native prompt.
- **Mobile density.** The register row's actions area (`transaction-actions.tsx`) currently renders "Edit" + "Delete" as compact text buttons. Adding "Split" as a third action needs to still work at 360px — flag for ux-developer to check whether it fits inline or needs an overflow affordance. Not a blocker, just don't let it get skipped silently.
- **Email queue:** not applicable — this is an internal bookkeeping action with no member- or donor-facing notification. Confirmed out of scope, not silently unaddressed.
- **Google Group sync:** not applicable — no member/committee relationship is touched.
- **Empty state:** not applicable — Split only ever appears on an existing row; there's no new list surface to have an empty state.
- **OAuth-vs-password:** not applicable — this is a `ledger.record`-gated admin action; the treasurer's sign-in method (Google OAuth vs. password) has no bearing on a permission-gated internal action.
- **Access-pending:** unaffected — a user without `ledger.record` never sees the Split control, same as Edit/Delete today.

## Out of Scope (confirm with user)

- The 1-transaction-to-many-bank-lines reconciliation match model (dropping `ledger_recon_matches_txn_key`'s uniqueness) — Split is the deliberately simpler alternative to that, not a step toward it. Noting the relationship, not designing it.
- Any bulk/multi-way split UI (e.g., entering 3 amounts at once) — the request describes a single split-amount action, repeatable. A "split into N even parts" convenience is a separate, later idea if wanted.
- Any change to the legacy per-row reconcile-toggle route's `reconciledSessionId`-clearing behavior, even though this review surfaced it as adjacent. That's a pre-existing pattern in PATCH/DELETE, not something this feature should silently fix as a side effect.

## Open Questions — RESOLVED (Chris, 2026-07-29)

1. **Lineage column → SKIP.** No `splitFromTransactionId`. Rely on sum-preservation; no schema change for split.
2. **Open-session match check → BLOCK.** If the transaction has a match row in any reconciliation session, Split refuses with "This transaction is already matched to a bank line in an open reconciliation session — unmatch it before splitting."
3. **New part `txnDate` → INHERIT** the original's date (analyst recommendation; both parts are the same underlying charge).
4. **Second confirmation → NO.** Submitting the split-amount form is sufficient confirmation, same as Edit today.

Net effect: **no schema change**, so this feature no longer depends on "Feature B schema" — Phase 4 can proceed directly. Implementer = full-stack-developer.

### Original questions (for reference)

1. **Lineage column** — add `splitFromTransactionId` (nullable self-FK, no schema-visible "status") so a split part can be traced back to its origin, or skip it and rely solely on sum-preservation? My recommendation: add it — it's one nullable column and directly serves 990/financial-report audit trails the treasurer already relies on this table for. Needs architect/tech-lead sign-off since it's schema, but the functional call (does the treasurer need traceability) is Chris's.
2. **Open-session match check** — confirm the recommended default: block Split with an explicit message if the transaction currently has a match row in any reconciliation session (open or closed), rather than silently deleting the match. Silently deleting the match on a closed session shouldn't be reachable anyway (closed session ⇒ `reconciled = true` ⇒ already blocked by the reconciled guard) — this check only matters for the open-session case.
3. **Does the new part need its own `txnDate`?** Recommend it inherits the original's `txnDate` (both parts are the same underlying charge, just cleared in two pieces) rather than defaulting to "today." Confirm this matches the real Eventeny case Chris hit — did both bank lines post on the same calendar date, or could a split ever need to represent a genuinely different clearing date per part? If the latter, the split dialog may need an optional date override.
4. **Does Split need its own `<ConfirmDialog>`-style second confirmation** before committing (given it permanently changes the original row's amount), or is submitting the split-amount form itself sufficient confirmation? Recommend the form submission is enough — same as Edit today doesn't get a second confirm — but flagging since this does mutate a posted, book-of-record amount.

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

*Brief design — the Phase 1 review already specified the guard set, field
inheritance, and locked decisions in enough detail that this section mainly
pins down the exact contract and file plan the implementer followed.*

## Summary

One new route splits an unreconciled `ledger_transactions` row into two rows
that sum to the original amount. No schema change (lineage column declined
per the resolved Open Questions). The new part inherits every field from the
original except `amountCents` (the split amount), `id`, `recordedByUserId`
(the acting user), and the reset trio `status='posted'` / `reconciled=false`
/ `reconciledSessionId=null` / `approvedAt=null`. The original row is
decremented by the split amount in the same DB transaction.

## Permissions

- Permission key: `ledger.record` (`FEATURES.LEDGER_RECORD`) — existing key,
  same gate as PATCH/DELETE on this table. No new `FEATURES` entry, no role
  binding migration.

## API Contract

- `POST /api/admin/ledger/transactions/[id]/split`
  - Body: `{ amountCents: number }` (integer, cents — matches the unit used
    by PATCH/POST on the sibling transaction routes)
  - Guard order (each a distinct 403 unless noted):
    1. `approvedAt` set → "Approved transactions cannot be split"
    2. `status === 'rejected'` → "Rejected transactions cannot be split"
    3. `reconciledSessionId` set → closed-reconciliation-session message
       (verbatim match to PATCH/DELETE's wording)
    4. `reconciled === true` (explicit, independent of guard 3 — covers the
       legacy per-row reconcile-toggle case, which sets `reconciled=true`
       but clears `reconciledSessionId` per DECISION-036) → "Reconciled
       transactions cannot be split"
    5. Matched to a bank line in ANY reconciliation session — via the
       existing `getMatchForTransaction(id)` in
       `src/lib/reconciliation-queries.ts` (already unscoped to a single
       session: `transactionId` is UNIQUE across
       `ledger_reconciliation_matches` forever per DECISION-036, so no new
       query was needed) → "This transaction is already matched to a bank
       line in an open reconciliation session — unmatch it before
       splitting."
  - Amount validation (after guards, 400 on failure):
    - not a positive integer → "Enter an amount greater than $0."
    - `>= existing.amountCents` (the row's CURRENT amount, not any original
      historical amount — matters for repeat splits) → "Split amount must
      be less than the transaction's current total."
  - Response `201 { id, originalAmountCents, newAmountCents }` — the new
    row's id plus both parts' resulting amounts, so the client can toast
    and `router.refresh()` without a second round trip.
  - 401/403/404 as usual.

## Data Model

No schema changes required (locked decision — no `splitFromTransactionId`).

## Component / Page Plan

- `src/components/admin/ledger/split-transaction-dialog.tsx` (new) — shadcn
  `Dialog` form (single dollar-amount input), modeled on
  `transaction-form-dialog.tsx`'s chrome. Client-validates > $0 and <
  current total before POSTing; server is the source of truth. Not a
  `<ConfirmDialog>` (needs free-form input) and not `window.prompt()`
  (forbidden).
- `src/components/admin/ledger/transaction-actions.tsx` (modified) — adds a
  **Split** button, shown when `status === 'posted' && !approvedAt &&
  !reconciled`. Mobile: the actions row gets `flex-wrap` so a third action
  wraps to a second line at 360px instead of clipping (the row also sits
  inside the fund register's existing `overflow-x-auto` table wrapper).

## Implementation Order

1. Route handler (`split/route.ts`) — guards, validation, atomic insert+update
2. Unit tests (route-level, guard-by-guard + amount validation + success)
3. Split dialog component
4. Wire the Split button into `transaction-actions.tsx`
5. Work-log Phase 3/4 writeup (this document)

No email notification (internal bookkeeping action, confirmed out of scope
in Phase 1). No release-notes entry authored here — left to the user's
release-notes pass per project convention.

## Edge Cases & Risks

- **Transfer rows.** The locked eligibility rule (`posted`, `!reconciled`,
  `!approvedAt`, `status !== 'rejected'`) doesn't explicitly exclude
  transfer-pair rows (`transferGroupId` set), and the server guard set as
  specified doesn't add a transfer-specific guard either. Splitting one leg
  of a transfer would decouple it from its pair (the new part carries no
  `transferGroupId`), silently breaking the debit/credit amount symmetry
  transfers otherwise maintain. This wasn't called out in Phase 1's
  Out-of-Scope list, so it's flagged here rather than silently patched with
  an unauthorized extra guard — see handoff notes below for qa/analyst.
- **Repeat splits validate against the CURRENT amount** — covered by a
  dedicated unit test (splitting a row that's already been split down to
  3,000 cents rejects a further 3,000-cent split as "not strictly less
  than current").

## Implementer

full-stack-developer

---

# Phase 4 — Implementation

## Files Created

- `src/app/api/admin/ledger/transactions/[id]/split/route.ts` — `POST` route:
  auth + `hasFeature(LEDGER_RECORD)`, the five-guard set, amount validation,
  atomic `db.transaction` insert (new part) + update (decrement original).
- `src/app/api/admin/ledger/transactions/[id]/split/route.test.ts` — 15 unit
  tests: auth/403/404, amount validation (≤0, non-integer, ≥current,
  ≥current-after-a-prior-split), each of the 5 guards individually, and the
  success path (two rows summing to the original, full field inheritance
  asserted via the captured insert payload).
- `src/components/admin/ledger/split-transaction-dialog.tsx` — shadcn
  `Dialog` form with a single dollar-amount input; client-validates >$0 and
  <current total, POSTs to the split route, toasts, and `router.refresh()`s.

## Files Modified

- `src/components/admin/ledger/transaction-actions.tsx` — added a **Split**
  button (shown when `status === 'posted' && !approvedAt && !reconciled`),
  wired to `SplitTransactionDialog`; changed the actions row's flex
  container to `flex-wrap` so a third action wraps at 360px instead of
  clipping.

## Schema Changes

None (locked decision — no `splitFromTransactionId`, no migration).

## Implementer Notes

- **`getMatchForTransaction` needed no new helper.** The brief flagged it
  might need an "unscoped" variant added to `ledger-queries.ts`. In fact the
  function already lives in `src/lib/reconciliation-queries.ts` (not
  `ledger-queries.ts`) and is already unscoped to any one session —
  `transactionId` is UNIQUE across `ledger_reconciliation_matches` forever
  (DECISION-036), so at most one match row can ever exist for a given
  transaction regardless of which session it belongs to. Used it directly;
  no additive export was needed anywhere.
- **Response shape.** Returns `{ id, originalAmountCents, newAmountCents }`
  (both parts' resulting amounts) rather than just the new row's id, so the
  client toast/refresh path doesn't need a second fetch — this is an
  addition beyond the brief's minimum ("Return the new row (or both rows)"),
  not a deviation.
- **`amountCents` unit confirmed** against the sibling PATCH/POST routes on
  this same table — cents (integer), not dollars. The split dialog converts
  from a dollar input client-side (`parseDollars`/`centsToDisplay`, copied
  from `transaction-form.tsx`'s existing helpers) before POSTing.
- **Mobile density handled with `flex-wrap`, not an overflow menu.** The
  fund register table already sits inside an `overflow-x-auto` wrapper
  (`src/app/(dashboard)/admin/ledger/[fundSlug]/page.tsx`), so a wider
  actions cell already has a scroll affordance at the table level; adding
  `flex-wrap` to the actions row itself is a second, cheaper safety net so
  the cell wraps cleanly to two lines rather than relying on horizontal
  scroll alone. Chose this over introducing a new dropdown/overflow-menu
  component, which felt like more machinery than three short text buttons
  warrant and would have been a new UI pattern for this table.
- **Transfer-row edge case — not additionally guarded, flagged instead.**
  See Phase 3 "Edge Cases & Risks" above. The locked eligibility rule and
  guard set as specified don't exclude transfer-pair rows, and Phase 1's
  Out-of-Scope list didn't call this out either, so no unauthorized guard
  was added. Flagged for qa/analyst rather than silently patched — see
  handoff notes below.
- `pnpm lint` was not run per the task's constraint (pre-existing unrelated
  ESLint/minimatch ESM bug in this environment). `pnpm build:only` and
  commit/push were both explicitly out of scope for this task and were not
  run.

### Verification run

- `pnpm exec tsc --noEmit` — PASS (no errors)
- `pnpm test` (full suite) — PASS, 784/784 tests, 29 files (includes the 15
  new split-route tests plus the full existing ledger/reconciliation suite,
  confirmed no regressions)

## Open questions / handoff notes

- **Transfer-row split** (see Edge Cases & Risks above) — recommend
  qa/analyst decide whether Split should be additionally excluded for rows
  with `transferGroupId` set, given splitting one leg would decouple it
  from its pair. No repro needed to evaluate; it's a design question, not a
  bug in the shipped guard set (which matches the locked spec exactly).
- **Browser click-through to verify for qa:**
  - Split button appears only on posted, unreconciled, unapproved rows in
    the fund register (`/admin/ledger/[fundSlug]`).
  - Split dialog: amount validation messages for ≤$0 and ≥current total
    (both client-side and by bypassing the client, e.g. via curl, to
    confirm server-side enforcement).
  - Happy path: split a transaction, confirm two rows appear summing to the
    original, then split one of the parts again (repeat-split case).
  - Guard messages: try splitting an approved row, a rejected row, a
    legacy-toggle-reconciled row, and a row matched in an open
    reconciliation session — confirm each surfaces its specific message via
    `toast.error` rather than a generic failure.
  - Mobile at 360px: confirm the actions row wraps cleanly with Split
    present, no clipped/inaccessible buttons.
- Nominate **qa** for Phase 5.

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

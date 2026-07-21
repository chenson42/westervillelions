# Ledger — Structured Check Numbers (T-18) — Work Log

> **Slug:** `2026-07-21-ledger-check-number`
> **Parent feature:** `2026-07-21-bank-reconciliation` (this is **inc1 of 3** — see
> `docs/work-log/2026-07-21-bank-reconciliation.md` for the full Intent, the
> analyst's five-pass review, and the architect's cross-increment rulings).
> **Surface:** (dashboard) admin — The Ledger (transaction form + uncashed-checks panel)
> **Permission(s):** No new key — existing `LEDGER_RECORD` covers form entry/edit
> **Estimated complexity:** small
> **Pipeline mode:** Full, Phases 1-2 complete-by-reference (see below)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | **Complete by reference** — see parent work-log, Phase 1 section (esp. "T-18 backfill accuracy" gap and the low-confidence-review-list requirement) | READY WITH NOTES | 2026-07-21 |
| 2 — Architectural review | architect | **Complete by reference** — see parent work-log, Phase 2 section, "Increment structure" ruling on inc1's scope/implementer, and Section 7's CSV-safety ruling (applies if check_number is ever added to CSV export) | Approved with suggestions | 2026-07-21 |
| 3 — Technical design | tech-lead | Complete | — | 2026-07-21 |
| 4 — Implementation | database-admin, then full-stack-developer | **Complete** — Increment A (schema + migration + backfill) and Increment B (form + uncashed-checks UI) both done; backfill applied to local DB with treasurer approval (101 check numbers + 3 debit-card fixes; see T-21 for the two remaining judgment items) | — | 2026-07-21 |
| 5 — Verification | qa | Complete | **PASS** | 2026-07-21 |
| 6 — Shipped vs intent | analyst | Complete | **SHIP IT** | 2026-07-21 |

---

# Phase 3 — Technical Design (tech-lead) — 2026-07-21

**Owner:** tech-lead
**Status:** complete

## Summary

This increment adds a structured `check_number` column to `ledger_transactions`,
backfills it for the 109 existing check-method rows, and surfaces it in the
transaction form and the uncashed-checks panel. **The parent work-log's and
`docs/treasurer-todo.md`'s T-18 framing — "check numbers live in free-text
memos" — turned out to be empirically false when I checked the actual data.**
I sampled 40 check-method rows in the local DB and found the memo/party text
almost never contains a check number; the one row that does ("Replacement for
check #8045") refers to a *different* check than its own. Tracing further,
`scripts/import-quicken-ledger.ts` already parses a `checkNum` field from the
source register CSVs' "Check #" column at import time — it's just discarded
before insert, used only for cause-derivation and console logs. **The real
check numbers are recoverable, with near-zero ambiguity, from the original
source CSVs (still on disk at the paths already hardcoded in the import
script), not from memo-text regex parsing.** This changes the backfill
mechanism from what the task framing assumed (a memo-parser) to a CSV-replay
match, with the memo-parser demoted to a low-confidence enrichment hint used
only when the primary match fails. It also surfaced a real, independent
data-quality bug (three rows mistagged `paymentMethod='check'` that are
actually debit-card purchases) that the backfill script should report. Full
research trail and rationale in `docs/decisions.md` DECISION-034.

## What I did

Read the parent work-log in full (Phases 1-2, both User-decisions blocks).
Read `src/lib/db/schema.ts` (`ledgerTransactions` ~L621-678), the uncashed-checks
panel (`src/components/admin/ledger/uncashed-checks-panel.tsx`), the dashboard
query (`src/lib/ledger-queries.ts` ~L938-1060, read-only per this task's
boundary), `src/components/admin/ledger/transaction-form.tsx` in full,
`src/app/api/admin/ledger/transactions/route.ts` and `.../[id]/route.ts` (read
existence/shape only), `src/lib/csv-safe.ts` and `src/app/api/admin/ledger/export/route.ts`
for the CSV-safety precedent, `src/lib/permissions.ts` (`LEDGER_*` keys),
`docs/treasurer-todo.md` T-18, and both existing backfill/import scripts
(`scripts/import-quicken-ledger.ts` in full, `scripts/backfill-dues-ledger.ts`
in full) for the repo's idiom. Then — because T-18's premise is exactly the
kind of thing that determines the whole shape of a backfill script — I
verified it against real data:

- Queried the local DB (`.env.local` `DATABASE_URL`) for all 109
  `paymentMethod = 'check'` rows' `memo`/`party` text. Almost none contain a
  check number; the one that does references a different check's number.
  Confirmed all 109 are `[quicken-import]`-marked (zero manually-entered check
  rows exist yet).
- Read the two source register CSVs (paths already hardcoded in
  `import-quicken-ledger.ts`: `FOUNDATION_CSV`, `ADMIN_CSV` — outside the repo,
  on the treasurer's machine). Confirmed the "Check #" column is a clean,
  4-digit, no-leading-zero numeric string for genuine checks, in two
  non-overlapping series (7995-8049, 8200-8263) matching the two accounts.
  Confirmed the register's `Action` column value `"Check"` is a generic
  disbursement-type marker, not a promise the instrument was a paper check —
  four rows have `Action="Check"` with a non-numeric "Check #" value ("Card"
  ×3, one stray "DEP" investigated separately): those three "Card" rows are
  debit-card purchases (Walmart, OTC Brands, FSP Product Decorator) currently
  mistagged `paymentMethod='check'` in the DB — a real, independent
  data-quality defect the backfill script can detect and report.
- Confirmed `import-quicken-ledger.ts`'s idempotency is **destructive-and-total**:
  on `--apply` it deletes every `[quicken-import]`-marked row, then
  reinserts all of them fresh with brand-new UUIDs, computing `reconciled`/
  `reconciledAt` from the CSV's own "Clr" column — **not** from live DB state.
  Re-running it today would silently wipe any reconciliation/category/memo
  edits the treasurer has made via the admin UI since the original 2026-07-20
  seed, and would cascade-delete any `ledgerAcknowledgments` row referencing
  one of the old (soon-to-be-deleted) transaction IDs. This rules out
  "just re-run the import script with checkNumber added" as the backfill
  mechanism for the already-seeded local DB.
- Per user memory (`project_ledger_quicken_seed.md`), **production has not
  been seeded yet** — the 109 rows exist only in local dev. This means
  production's eventual first seed can safely include `checkNumber` in the
  original insert (no backfill needed there), while the already-seeded local
  DB needs a separate, non-destructive backfill.

## Permissions

No new `FEATURES` key. Existing `FEATURES.LEDGER_RECORD` ("Record, edit, and
delete ledger transactions") already gates the transaction-form create/edit
routes this increment extends
(`src/app/api/admin/ledger/transactions/route.ts`,
`src/app/api/admin/ledger/transactions/[id]/route.ts`) — `check_number` is
just one more field on the same gated payload, no new gate needed.

## API Contract

No new routes. Existing routes get one new optional field on their request
bodies:

- `POST /api/admin/ledger/transactions` — request body gains
  `checkNumber?: string | null`. Validate: trim; if non-empty, cap length
  (recommend 20 chars — generous headroom over the 4-digit reality, covers
  hypothetical suffixed formats like "8249-R" without inventing a strict
  numeric-only constraint the real data doesn't need); store `null` for
  empty string, matching the existing `party`/`memo` `|| null` convention
  already used in this route (see `transaction-form.tsx` L207/L238's mirrored
  client-side pattern). No new auth/permission check — same
  `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` gate already there
  covers this field.
- `PATCH /api/admin/ledger/transactions/[id]` — same field, same validation.
  Must respect whatever mutability rule the route already applies to
  `memo`/`party` on approved/reconciled rows (the existing `approvedAt` guard)
  — `checkNumber` is not a special case, it follows the same edit contract as
  every other free-text field on the row. Implementer: confirm by reading the
  route before assuming; do not invent a new immutability rule for this one
  field.

## Data Model

**New column, no new table.**

```typescript
// src/lib/db/schema.ts — ledgerTransactions, add after paymentMethod:
checkNumber: text("check_number"), // structured check # (T-18); nullable — only checks have one
```

**Type decision: `text`, not `integer`.**
- All real check numbers in this dataset are 4-digit, no leading zeros — but
  a numeric column buys nothing (no arithmetic, no range query is ever
  performed on it; matching, now and in inc3's auto-match, is always exact
  string/value equality) and would need reformatting to safely support a
  hypothetical future club/account whose check numbers do carry leading
  zeros or a suffix (e.g. "00123", "1234-R" for a reissue). `text` matches
  this codebase's existing convention for identifier-shaped fields that are
  numeric-looking but never arithmetic (`last4`, `slug`, `ohioEntityNumber`).

**Index: yes — composite, non-unique.**
```typescript
index("ix_ledger_txns_check_number").on(t.bankAccountId, t.checkNumber),
```
A check number is only meaningful scoped to the account whose check series it
belongs to (the Foundation's and Club's numbering could collide in principle,
even though today's two ranges happen not to). This is also the exact lookup
shape inc2/inc3's check-number-first auto-match will need
(`bankAccountId` + `checkNumber` exact match against an uploaded bank line).
Not unique: a voided-and-reissued check can plausibly appear twice in the
register under different numbers referencing each other in memo text (see the
8045/8049 example below) — nothing here requires or benefits from a
uniqueness constraint, and adding one speculatively risks a future insert
failure for a legitimate edge case (duplicate deposit slips, e.g.) the design
hasn't fully characterized.

**Migration numbering:** `0053_ledger_category_counts_as_giving.sql` is the
last committed migration as of this writing (2026-07-21). `0054` and `0055`
are claimed by the concurrent failed-login-visibility work
(`0054_failed_login_attempts.sql`, `0055_admin_security_permission.sql`,
DECISION-033) — **do not touch or renumber those.** This increment needs a
**single** migration file (additive column + index, no new permission, so the
two-file table+permission split other recent features used doesn't apply
here): `00NN_ledger_check_number.sql` where `NN` is **next free at
implementation time** — `0056` as of this writing, but the implementer must
run `ls drizzle/migrations/` immediately before creating the file, since other
concurrent work (e.g. the impact-cause-drilldown feature, if it needs a
migration) may claim a slot first.

```sql
-- 00NN_ledger_check_number.sql (idempotent)
ALTER TABLE ledger_transactions ADD COLUMN IF NOT EXISTS check_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'ix_ledger_txns_check_number'
  ) THEN
    CREATE INDEX ix_ledger_txns_check_number
      ON ledger_transactions (bank_account_id, check_number);
  END IF;
END $$;
```

## Component / Page Plan

- Pages to create: none.
- Components to modify:
  - `src/components/admin/ledger/transaction-form.tsx` — one new
    always-visible optional text input, "Check #", placed near `party`/`memo`.
    **Not** conditionally rendered on `paymentMethod === 'check'` — this form
    has no existing conditional-field-by-paymentMethod pattern (`debit_card`
    was added as a plain select option with no extra captured field), and
    introducing one for a single field adds a UI-state branch for no real
    gain over just always showing an optional input. Follows the existing
    `|| null` empty-string-to-null convention (L207, L238).
  - `src/components/admin/ledger/uncashed-checks-panel.tsx` — add a "Check #"
    column (recommend placed right after "Party", before "Amount"),
    rendering `row.checkNumber ?? "—"`. **No detection-logic change** — see
    below.
- Files to modify (server):
  - `src/lib/db/schema.ts` — add `checkNumber` column + index (above).
  - `src/app/api/admin/ledger/transactions/route.ts` — accept/validate/persist
    `checkNumber` on create.
  - `src/app/api/admin/ledger/transactions/[id]/route.ts` — same, on edit.
  - `src/lib/ledger-queries.ts` — widen `UncashedCheckRow` with
    `checkNumber: string | null`; add `checkNumber: ledgerTransactions.checkNumber`
    to the `uncashedRows` query's `.select({...})` (currently ~L1015-1030) and
    thread it through the row-mapping (~L1040-1060). **Small, additive,
    non-conflicting change** — implementer should still confirm the
    impact-cause-drilldown Phase 6 analyst's read-only pass on this file has
    concluded before editing, per this task's sequencing note.
- New files:
  - `src/lib/check-number.ts` — pure functions, no DB/Next.js import (mirrors
    `ledger.ts`'s pure-function-layer precedent):
    - `parseCheckNumberFromMemo(text: string | null | undefined): { checkNumber: string; ambiguous: boolean } | null`
      — **fallback enrichment only**, not the primary backfill mechanism (see
      Edge Cases). Looks for a `check\s*#?\s*(\d{3,6})` / bare `#(\d{3,6})`
      token. Sets `ambiguous: true` when the surrounding text contains
      reissue/void language ("replacement", "reissue", "void", "cancel") or
      when more than one distinct number-bearing token is found — signals
      "don't trust this as this row's own number without a human looking."
    - `classifyRegisterCheckColumn(action: string, checkNumField: string): { checkNumber: string | null; flag?: "non_numeric_check_column"; rawValue?: string }`
      — the **primary** backfill classifier: given a register row's `Action`
      and `Check #` column values, returns the numeric check number when the
      column is purely digits, or a flagged `null` result when
      `action === "Check"` but the column holds a non-numeric marker
      ("Card", "DEP", or anything else) — this is how the backfill script
      detects the 3 mistagged debit-card rows without guessing.
  - `src/lib/check-number.test.ts` — named tests below.
  - `scripts/backfill-check-numbers.ts` — new, additive, dry-run-default
    script (see Implementation Order #2 for full shape).

## Implementation Order

1. **Schema.** Add `checkNumber` + index to `src/lib/db/schema.ts` (above).
   Add migration `00NN_ledger_check_number.sql` (next free slot — verify at
   implementation time). Run `pnpm db:migrate` locally.

2. **Backfill — additive, UPDATE-only, non-destructive.**
   `scripts/backfill-check-numbers.ts`:
   - Reuses (recommend exporting, not duplicating) `parseCsvLine` and the
     register-row-reading logic from `scripts/import-quicken-ledger.ts` —
     needs only 3 columns (`Date`, `Action`, `Check #`) plus enough to derive
     `amountCents`/`flow`/entity, all of which that script already parses.
     Reuses the same hardcoded `FOUNDATION_CSV`/`ADMIN_CSV` path constants
     (import them, don't redefine).
   - For each register row where `Action === "Check"`, call
     `classifyRegisterCheckColumn()`. If it yields a numeric `checkNumber`,
     build a matching key: `entityId` (from which CSV) + `txnDate` (ISO) +
     `amountCents` + `paymentMethod = 'check'` + `flow` (derived from the
     CSV's signed amount) + `memo LIKE '%[quicken-import]%'` (scopes the
     match to import-sourced rows only — never touches a manually-entered
     row).
   - Query `ledger_transactions` for rows matching that key.
     - **Exactly one match** → `UPDATE ledger_transactions SET check_number = $1 WHERE id = $2`.
       Never touches `reconciled`, `reconciledAt`, `category_id`, `memo`, or
       any other column — the row's `id` never changes, so any
       `ledgerAcknowledgments` FK or admin-UI edit made since the 2026-07-20
       seed is completely undisturbed.
     - **Zero matches** → log to a "no match — could not locate a
       corresponding ledger_transactions row" review list (the row may have
       been hand-edited or deleted since import; treasurer/implementer
       resolves manually).
     - **Two or more matches** → log to an "ambiguous — N candidate rows"
       review list with their IDs; **do not guess**, same discipline Phase 1's
       Flow B required for the eventual auto-matcher.
   - Separately, for every row `classifyRegisterCheckColumn()` flags
     `non_numeric_check_column` (the 3 "Card" rows + the "DEP" case,
     investigated and confirmed to be an unrelated `Action="DEP"` deposit
     row with a blank Check # — not a mistagged check), report it plainly:
     "3 rows currently `paymentMethod='check'` are actually debit-card
     purchases per the register (Walmart 2025-10-09, OTC Brands 2025-10-10,
     FSP Product Decorator 2025-10-23)." Gate any actual correction of
     `paymentMethod` behind a separate, explicit `--fix-payment-method` flag
     (never bundled into the default `--apply`) — this is a real, valuable,
     evidence-backed fix, but it's a different column than this increment's
     stated scope and deserves its own explicit opt-in and its own line in
     `docs/treasurer-todo.md` (implementer: add a `T-nn` entry once the exact
     3 rows are confirmed against the live DB).
   - `parseCheckNumberFromMemo()` is invoked **only** as a courtesy hint on
     rows that land in the "no match" review list (never as the mechanism
     that writes `check_number` directly) — e.g., "no CSV match found, but
     memo mentions '#8249' (low confidence, verify manually)."
   - Dry-run default, `--apply` to write — matches
     `backfill-dues-ledger.ts`'s idiom (additive `UPDATE`/`INSERT`, not
     `import-quicken-ledger.ts`'s delete-and-reinsert idiom, which is the
     wrong precedent to follow here). Idempotent: re-running after a
     successful `--apply` re-derives the same matches and re-applies the same
     values — safe, if slightly redundant, to run twice.
   - Target: whichever `DATABASE_URL`/`PROD_DATABASE_URL` is provided —
     local dev now; production only after (and if) production's own
     first-time Quicken seed happens without step 3's enhancement already
     in place.

3. **`import-quicken-ledger.ts` — additive enhancement, not re-run locally.**
   Add `checkNumber` derivation (via `classifyRegisterCheckColumn()`) to the
   row-builder (`mapClub`/`mapFoundation` output type + the `insertRows` map
   ~L897-919) so that **production's still-pending first seed** (per project
   memory: production is unseeded) inserts `checkNumber` directly, with zero
   backfill risk since there's no existing state to clobber. **Do not re-run
   this script against the already-seeded local dev DB** as part of this
   increment — its delete-and-reinsert idempotency model would silently
   discard any reconciliation/edit state layered on since the 2026-07-20 seed
   and cascade-delete any `ledgerAcknowledgments` tied to the doomed row IDs.
   Step 2's script is the correct (and only) backfill path for local dev.

4. **API.** `transactions/route.ts` and `transactions/[id]/route.ts` — accept,
   trim, cap-length-validate, and persist `checkNumber`.

5. **UI.** `transaction-form.tsx` (new field), `uncashed-checks-panel.tsx`
   (new column), `ledger-queries.ts` (`UncashedCheckRow` widen — small,
   additive).

6. Release notes entry — via `/release-notes` when this increment ships
   (this is inc1 of 3; note in the entry that reconciliation sessions and
   auto-matching are still to come).

## Uncashed-Checks Detection — unchanged, correcting a framing error

The task framing (and, upstream, `docs/treasurer-todo.md`'s T-18 entry) states
"the uncashed-checks list reads memo text in v1 (DECISION-031)." **On
inspection, this is not what DECISION-031/032 actually did.** The panel's own
query (`getDashboard()` in `ledger-queries.ts`, ~L1012-1030) already detects
uncashed checks via `paymentMethod = 'check'` + `flow = 'expense'` +
`reconciled = false` — memo is only ever *displayed*, never used to detect
membership in the list. There is no memo-based detection to "switch away
from." **Ruling: detection stays exactly as-is.** `checkNumber` is added
purely as a new *displayed* column (replacing nothing), giving the treasurer
the actual number to look up against a bank statement — which is the entire
practical point of T-18. Switching detection to require
`checkNumber IS NOT NULL` would be strictly worse: it would silently drop any
legitimate uncashed check that, for whatever reason (a future manual entry
where the treasurer skipped the field, an unmatched backfill row), lacks a
populated number.

## Named Unit Tests (Vitest) — `src/lib/check-number.test.ts`

`parseCheckNumberFromMemo()`:
1. Happy path, "check #" phrasing: `"Check #8249 for the roof"` →
   `{ checkNumber: "8249", ambiguous: false }`.
2. Happy path, bare hash: `"Payment - #1234"` →
   `{ checkNumber: "1234", ambiguous: false }`.
3. **Ambiguous, real data example:** `"Replacement for check #8045"` →
   `{ checkNumber: "8045", ambiguous: true }` — this memo refers to a
   *different* check than its own row's actual number (which is 8049 per the
   register); the test documents exactly why this function must never be
   trusted as ground truth on its own.
4. Ambiguous, multiple candidates: `"Voided check #8045, reissued as #8049"` →
   `ambiguous: true` (two distinct numbers present, no single confident pick).
5. No match: `"Meeting hospitality"` → `null`.
6. No match, empty/null input: `""` and `null` → `null`.

`classifyRegisterCheckColumn()`:
7. Numeric column, `action="Check"`: `("Check", "8249")` →
   `{ checkNumber: "8249" }`.
8. Non-numeric marker, `action="Check"`: `("Check", "Card")` →
   `{ checkNumber: null, flag: "non_numeric_check_column", rawValue: "Card" }`.
9. Non-numeric marker, blank field, `action="Check"`: `("Check", "")` →
   `{ checkNumber: null }` (no flag — genuinely absent, not an anomaly; this
   case doesn't occur in today's real data but must not crash).
10. `action !== "Check"` (e.g. `"DEP"`, `"Teller"`): always
    `{ checkNumber: null }`, no flag, regardless of the Check # field's
    content.

Backfill-script matching logic does **not** need its own named unit test
suite beyond the two pure functions above — its DB-touching match/UPDATE
logic is exercised by the qa manual dry-run against the local DB (see Edge
Cases), consistent with how `backfill-dues-ledger.ts`'s selection logic was
verified (console-output inspection, not a Vitest suite), since it's a
one-off operational script, not application logic.

## Edge Cases & Risks

- **Re-running `import-quicken-ledger.ts` locally is unsafe post-seed** — see
  Implementation Order #3. This is the single most important risk this
  design surfaces; call it out prominently in the PR/implementer notes so
  nobody "helpfully" re-runs the enhanced importer against local dev thinking
  it will non-destructively add the new column.
- **The 3 mistagged debit-card rows** (Walmart, OTC Brands, FSP Product
  Decorator) are a real, pre-existing data-quality defect, unrelated to this
  increment's stated scope but discovered as a direct byproduct of building
  it correctly. Report, don't silently fix; gate any correction behind an
  explicit flag; log a `treasurer-todo.md` T-item once confirmed.
- **Ambiguous CSV-to-DB matches** (2+ rows sharing entity+date+amount+method+flow)
  — none identified by my spot-check, but the script must handle the case if
  it occurs rather than assume it can't.
- **Zero-amount / VOIDED register rows** (I saw at least one, "Cancelled",
  amount `0.00`) — `import-quicken-ledger.ts` already has logic to skip or
  special-case these (`isVoided`-style checks around L343); the backfill
  script's matching key must follow the same skip logic or it will produce
  spurious "no match" noise for rows the original import never inserted in
  the first place.
- **`check_number` length/format on manual entry** — validate length only
  (≤20 chars), not strict numeric-only, since a hypothetical future
  suffixed/lettered check reference shouldn't be rejected by an
  over-constrained regex the real data doesn't require.
- **CSV export** — `check_number` is *not* added to
  `src/app/api/admin/ledger/export/route.ts`'s output in this increment
  (kept minimal, per this task's discretion). If a future increment adds it,
  it must route through `csvCellSafe()` alongside `party`/`memo`, per the
  architect's Phase 2 Section 7 ruling.
- **Approved-row immutability** — `checkNumber` edits on an already-approved
  transaction must follow whatever mutability contract `memo`/`party` already
  follow in the PATCH route (implementer: read, don't assume).

## Out of Scope

- Reconciliation sessions, CSV bank-statement upload, auto-matching — inc2/inc3.
- Correcting the 3 mistagged debit-card rows as part of the default `--apply`
  path (opt-in `--fix-payment-method` only).
- Adding `check_number` to the ledger CSV export.
- Any change to uncashed-checks *detection* logic (unchanged — see above).

## Implementer

**database-admin** for schema + migration + `src/lib/check-number.ts` (+ its
test) + `scripts/backfill-check-numbers.ts` + the additive
`import-quicken-ledger.ts` enhancement — per the architect's Phase 2 ruling
("keep it schema-first since check-number correctness is load-bearing for
inc3's auto-match — a database-admin owning the backfill script's accuracy
matters more here than saving one handoff").

Then **full-stack-developer** for the remaining thin api/ux touch: the two
route handlers' `checkNumber` field, `transaction-form.tsx`'s new input,
`ledger-queries.ts`'s `UncashedCheckRow` widen, and
`uncashed-checks-panel.tsx`'s new column. This remainder is small and tightly
coupled (~100-150 lines across API+UI) — right-sized for full-stack-developer
per CLAUDE.md's implementer table, once the schema exists under it.

**Sequencing dependency (not mine to schedule, noting for the record):** the
database-admin implementing this must not touch `src/lib/db/schema.ts` until
the concurrent database-admin working the failed-login-visibility feature
(claiming migrations `0054`/`0055`) has completed and committed their
`schema.ts` edit — both features touch the same file; the two edits need to
land as two clean, sequential diffs, not a race. The orchestrating agent said
they will sequence this.

---

# Phase 4 — Implementation

### Increment A — database-admin (schema + migration + backfill) — 2026-07-21

**Status: code complete; agent stalled during final write-up, section completed by the
orchestrating session.** The implementing agent finished all code and the dry-run, then
stalled (600s no progress) while writing this section and the T-21 treasurer-todo entry.
The orchestrator verified state directly and completed the paperwork. All facts below are
verified, not assumed.

**Files delivered (all present in working tree):**
- `src/lib/db/schema.ts` — `check_number` text column on `ledger_transactions` + composite
  non-unique index `(bank_account_id, check_number)`.
- `drizzle/migrations/0056_ledger_check_number.sql` — idempotent (0054/0055 were claimed by
  the concurrent failed-login feature, as the design predicted).
- `src/lib/check-number.ts` + `src/lib/check-number.test.ts` — pure parse/normalize
  functions with 10 tests.
- `scripts/backfill-check-numbers.ts` — additive UPDATE-only, dry-run default, `--apply`
  to write, `--fix-payment-method` as separate opt-in for the mistag corrections.
- `scripts/import-quicken-ledger.ts` — additive enhancement carrying `checkNum` forward.
- `src/lib/ledger-queries.ts` — `checkNumber` threaded through row types (this resolved
  the transient `PendingApprovalRow` type error the concurrent failed-login ux-developer
  observed mid-flight).

**Gates (verified by orchestrator after the stall):**
- `pnpm exec tsc --noEmit` — clean (exit 0).
- `pnpm test` — **378/378 passed** (368 pre-existing + 10 new check-number tests).
- `pnpm build:only` — NOT yet re-verified after the stall; qa must run it in Phase 5.
- Migration idempotency (double `pnpm db:migrate` run) — performed by the agent before its
  final report; not independently re-verified. qa should re-run `pnpm db:migrate` once as a
  cheap re-check.

**Backfill dry-run results (orchestrator ran `npx tsx scripts/backfill-check-numbers.ts`
against the local DB, 2026-07-21):**
- Parsed 105 candidate check rows (81 Foundation, 24 Club).
- **Matched exactly one DB row: 101. No-match: 0. Ambiguous: 4** — two same-day,
  same-amount, same-payee pairs (Gates At Eight $500 ×2 on 2026-03-07 → #8252/#8253;
  Gates At 8 $500 ×2 on 2024-07-28 → #8029/#8030). Either assignment is defensible;
  treasurer picks.
- **Mistag report:** 3 confirmed debit-card rows (FSP Product Decorator −$2,225.00,
  OTC Brands −$208.32, Walmart −$226.77 — correctable via `--fix-payment-method`) and
  1 judgment call (Don Niebling +$120.00, Check #="DEP", report-only).
- Logged as **T-21** in `docs/treasurer-todo.md`.
- `--apply` has NOT been run — awaiting treasurer review of the above (his explicit call).

**Handoff to full-stack-developer (Increment B, next session):**
- Surface `checkNumber` in the admin transaction form (entry + edit) and as a displayed
  column in the uncashed-checks panel, per the Phase 3 design (detection logic unchanged —
  it never used memo text).
- Re-verify `pnpm build:only` (this increment's threading should have made the tree green
  again, but it was not proven post-stall).
- After treasurer approves: run the backfill with `--apply` (and `--fix-payment-method`
  if he approves the 3 debit-card corrections), resolve the 4 ambiguous assignments.

---

### Increment B — full-stack-developer (form + uncashed-checks UI) — 2026-07-21

**Owner:** full-stack-developer
**Status:** complete

#### Summary

Wired the `checkNumber` column (already live from Increment A) through the transaction
create/edit API routes and the admin ledger UI: a new optional "Check #" text field on
`TransactionForm`, and a new "Check #" column on the uncashed-checks panel. No new
permission — both routes still gate on the existing `hasFeature(session.user.id,
FEATURES.LEDGER_RECORD)` check, unchanged. Uncashed-checks *detection* logic was not
touched, per the design's explicit ruling.

#### What I did

- Read this work-log in full (Phases 1-4, Increment A section) before touching anything.
- Confirmed Increment A's artifacts were present and correct: `check_number` column +
  index in `schema.ts`, migration `0056_ledger_check_number.sql`, `src/lib/check-number.ts`
  + 10 passing tests, and `checkNumber` already threaded into `PendingApprovalRow` in
  `ledger-queries.ts` — none of these needed further changes.
- `POST /api/admin/ledger/transactions` (`src/app/api/admin/ledger/transactions/route.ts`):
  added `checkNumber?: string | null` to the request-body JSDoc and destructure; added a
  `normalizeCheckNumber()` helper (trim, empty → `null`, reject non-string, cap at 20 chars
  matching the design's recommendation) called after the existing `paymentMethod`
  validation; persisted `checkNumber: checkNumberResult.value` on insert. No new
  auth/permission check — reuses the existing `LEDGER_RECORD` gate verbatim.
- `PATCH /api/admin/ledger/transactions/[id]` (`.../[id]/route.ts`): same
  `normalizeCheckNumber()` helper (duplicated locally rather than shared, matching this
  file's existing pattern of not importing validators from the sibling route file);
  `checkNumber` added to the `UpdatePayload` type and applied when `body.checkNumber !==
  undefined`. Runs after the existing `approvedAt`/`rejected` immutability guards at the
  top of the handler, so `checkNumber` follows exactly the same edit-lockout contract as
  `memo`/`party` — no new immutability rule invented. Left out of the transfer-pair
  `symmetricUpdate` object (matching `paymentMethod`'s existing exclusion — checkNumber has
  no meaning on a fund-to-fund transfer row).
- `src/components/admin/ledger/transaction-form.tsx`: added `checkNumber` to the
  `EditableTransaction` Pick type, a `checkNumber` state initialized from
  `initialValues?.checkNumber ?? ""`, and an always-visible (not conditional on
  `paymentMethod`) "Check #" text input placed directly after Party and before Memo,
  gated by the same `!isTransfer && !isEditingTransfer` condition as Party/PaymentMethod
  (transfers have no payee and no payment method either, so this follows the form's
  existing precedent rather than inventing a new one). `maxLength={20}` matches the
  server-side cap. Threaded `checkNumber: checkNumber || null` into both the new-transaction
  POST body and the non-transfer PATCH body. Also updated the Memo field's placeholder from
  "Check #, transaction reference, etc." to "Transaction reference, notes, etc." since a
  dedicated Check # field now exists and the old placeholder would have steered users into
  putting the number in the wrong field — small in-file touch-up, not a scope expansion.
- `src/lib/ledger-queries.ts`: widened `UncashedCheckRow` with `checkNumber: string | null`;
  added `checkNumber: ledgerTransactions.checkNumber` to the `uncashedRows` query's
  `.select({...})`; threaded it through the row-mapping into the returned
  `UncashedCheckRow[]`. Detection logic (`paymentMethod = 'check'`, `flow = 'expense'`,
  `status = 'posted'`, `reconciled = false`) is byte-for-byte unchanged.
- `src/components/admin/ledger/uncashed-checks-panel.tsx`: added a "Check #" column header
  and cell (`row.checkNumber ?? "—"`), placed right after Party and before Amount, matching
  the design's recommended position.

#### Deviation from the design doc (small, necessary)

The Component/Page Plan named `transaction-form.tsx`, `uncashed-checks-panel.tsx`, and
`ledger-queries.ts` as the files to touch. Typechecking surfaced two more that the design
didn't name: `transaction-form-dialog.tsx` and `transaction-actions.tsx` both declare their
own local `Pick<LedgerTransaction, ...>` `EditableTransaction` type (duplicated rather than
imported from `transaction-form.tsx`) that gets passed into `TransactionForm`'s
`initialValues` prop. Widening `transaction-form.tsx`'s own `EditableTransaction` to include
`checkNumber` made these two callers' narrower Pick types structurally incompatible with the
prop (a required field the caller's object literal didn't populate). Fixed by adding
`checkNumber` to `transaction-form-dialog.tsx`'s local `EditableTransaction` Pick, and adding
`checkNumber: transaction.checkNumber` to `transaction-actions.tsx`'s `editInitialValues`
object (previously it silently omitted several fields the type now requires — without this,
the Edit dialog would open with the Check # field always blank, even for a transaction that
already had one). Both changes are minimal (one line each) and were required for a green
typecheck, not scope creep — flagging per CLAUDE.md's "report deviations" expectation.

#### Outputs

Files modified:
- `src/app/api/admin/ledger/transactions/route.ts` — `checkNumber` on POST create path.
- `src/app/api/admin/ledger/transactions/[id]/route.ts` — `checkNumber` on PATCH edit path.
- `src/components/admin/ledger/transaction-form.tsx` — new Check # input field.
- `src/components/admin/ledger/transaction-form-dialog.tsx` — `EditableTransaction` type
  widened (deviation, see above).
- `src/components/admin/ledger/transaction-actions.tsx` — `editInitialValues` widened
  (deviation, see above).
- `src/components/admin/ledger/uncashed-checks-panel.tsx` — new Check # column.
- `src/lib/ledger-queries.ts` — `UncashedCheckRow` widened + query/mapping updated.

No schema, no new migration, no new `FEATURES` key, no new env var. Both routes re-verified
to still call `auth()` + `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` exactly as
before — no gate regressions.

#### Gates

- `pnpm exec tsc --noEmit` — clean, exit 0.
- `pnpm test` — **378/378 passed** (no new tests added this increment; the design assigned
  all named unit tests to `check-number.ts`, which Increment A already delivered and which
  this increment did not modify).
- `pnpm build:only` — **passes**, exit 0. Compiled successfully, TypeScript check passed,
  all 94 pages generated. This proves the tree is green after Increment A's stall — the
  build had not been re-verified since the schema/backfill work landed, and it is confirmed
  clean now.
- No `console.log` in any touched file (grepped). No native browser dialogs introduced or
  present in touched files.

#### Open questions / handoff notes for qa (Phase 5)

- Manual click-through: open the Ledger admin, record a new check-method expense with a
  Check # (e.g. "8300"), confirm it saves and displays; edit an existing transaction to add/
  change/clear a Check #; confirm the uncashed-checks panel shows the new "Check #" column
  and existing rows (all currently `null` pre-backfill) render "—".
- Confirm a >20-char Check # is rejected client-side (maxLength) and, if bypassed, would be
  rejected server-side (400) — worth one direct `fetch` test against the API if the runner
  wants to exercise the boundary without relying on the browser input's `maxLength`.
- Confirm editing a transfer row still does not show or accept a Check # field (transfers
  were deliberately excluded, matching Party/Payment Method's existing exclusion).
- Re-run `pnpm db:migrate` once as a cheap idempotency re-check (Increment A's note; not
  independently re-verified by this increment since no migration file changed).
- Next: **qa** for Phase 5 (typecheck/build already green per above; qa should still smoke
  the dev server per its own protocol, plus the manual click-through above).

---

---

# Phase 5 — Verification (qa) — 2026-07-21

**Owner:** qa
**Status:** complete

### Summary

**Verdict: PASS.** Typecheck, unit tests (378/378, including all 10 named
`check-number.ts` tests matching the design doc's list verbatim), and the
production build (94/94 pages) are all green. Two independent `pnpm db:migrate`
re-runs confirm migration `0056_ledger_check_number.sql` is idempotent (closing
the gap Increment A's stalled agent left unverified). DB audit confirms 101
rows carry `check_number`, the 3 debit-card mistags have `paymentMethod` still
`check`... corrected — see below — and the 4 Gates At Eight rows are NULL as
expected. Dev-server click-through (Playwright, `signInAsAdmin()`) confirmed
create/edit/delete of a check-numbered transaction through the real gated API,
the uncashed-checks panel's new "Check #" column, the 20-char server-side cap,
transfer rows hiding the field, and a full manual-assign-then-revert cycle on
one of the ambiguous Gates At Eight pairs — with cleanup proven in every case.
Gate audit found no regressions: both routes still call `auth()` +
`hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` verbatim.

### What I did

1. **Read the work-log in full** (Phase 3 design, Increment A, Increment B,
   qa handoff notes) before touching anything.
2. **Typecheck** — `pnpm exec tsc --noEmit`: clean, exit 0.
3. **Unit tests** — `pnpm test`: **378/378 passed**, 11 test files, 273ms.
   Read `src/lib/check-number.test.ts` line-by-line against the design's
   10 named tests (`docs/work-log/...` "Named Unit Tests" section) — all 10
   present and matching, including test #3 (`"Replacement for check #8045"` →
   `{ checkNumber: "8045", ambiguous: true }`, the ambiguity case where the
   memo references a *different* check than its own row) and test #4 (multiple
   candidates → `ambiguous: true`).
4. **Production build** — `pnpm build:only`: **PASS**, "Compiled successfully
   in 6.7s", 94/94 static pages generated, no warnings tied to this increment.
5. **Migration idempotency** — ran `pnpm db:migrate` **twice** against the
   local DB. Both runs completed with `✅ Migrations completed successfully`;
   the `0056_ledger_check_number.sql` step logged only expected NOTICEs
   (`column "check_number" of relation "ledger_transactions" already exists,
   skipping`) with no errors on either run. This closes the gap Increment A
   flagged (its own double-run wasn't independently re-verified). Confirmed via
   `\d ledger_transactions` that `check_number text` and index
   `ix_ledger_txns_check_number` (btree on `bank_account_id, check_number`)
   both exist exactly as designed.
6. **Backfill dry-run re-run (post-apply)** — re-ran
   `npx tsx scripts/backfill-check-numbers.ts` (no `--apply`) against the
   now-backfilled local DB. It reported the identical match summary as
   Increment A's original dry-run (101 matched / 0 no-match / 4 ambiguous,
   same 3+1 mistag report) and ended with "Re-run with `--apply` to write
   check_number for the 101 matched row(s)." **This wording is stale-sounding
   but not a bug**: the design doc explicitly states the script's idempotency
   model is "re-run after a successful `--apply` re-derives the same matches
   and re-applies the same values — safe, if slightly redundant, to run
   twice" — i.e. the script was never designed to check current DB state
   before reporting, only to recompute the CSV-side match set fresh each run.
   Confirmed no DB awareness of already-applied state exists in the script
   (by design, not oversight) — noting this for the record per the task's
   instruction not to call it a bug without checking intent.
7. **DB state audit** (read-only psql against `.env.local`'s `DATABASE_URL`):
   - `SELECT count(*) FROM ledger_transactions WHERE check_number IS NOT NULL`
     → **101**, matching the treasurer-approved backfill.
   - All 101 have `payment_method = 'check'` (no cross-contamination into
     other payment methods).
   - The 3 confirmed debit-card mistags (Walmart −$226.77, OTC Brands
     −$208.32, FSP Product Decorator −$2,225.00) all show
     `payment_method = 'debit_card'` and `check_number` NULL — the
     `--fix-payment-method` correction was applied and is holding.
   - The 4 Gates At Eight ambiguous rows (two same-day/same-amount pairs:
     2026-03-07 ×2 and 2024-07-28 ×2) all show `check_number` NULL, per the
     design's ruling that ambiguous 2+-candidate matches must not be guessed —
     confirmed awaiting the treasurer's manual entry.
   - **Check-number series audit**: grouped by `bank_account_id`, Administrative
     Checking's 24 rows fall entirely within 7995-8019 (subset of the design's
     stated 7995-8049 range); Foundation Checking's 77 rows span 8031-8263,
     covering *both* of the design's stated ranges (7995-8049 and 8200-8263)
     for that one account, with no overlap into Administrative's range. **This
     is not a defect** — it just means the design doc's phrasing ("two
     non-overlapping series ... matching the two accounts") slightly
     over-simplified a checkbook-reorder gap within Foundation's own numbering
     (checks 8031-8049, then a fresh order starting 8200), rather than a
     strict one-series-per-account partition. The invariant that actually
     matters — no two accounts share overlapping check-number ranges, so the
     `(bank_account_id, check_number)` index scopes correctly — holds. Flagging
     as a documentation-precision note, not a QA failure.
8. **Gate audit** — read both route files in full:
   - `POST /api/admin/ledger/transactions`: `auth()` (401 if absent) +
     `hasFeature(session.user.id, FEATURES.LEDGER_RECORD)` (403 if absent),
     unchanged from pre-increment. `checkNumber` validated via
     `normalizeCheckNumber()` (trim, empty→null, >20 chars → 400 with message
     `"checkNumber must not exceed 20 characters"`), excluded from the
     transfer-path body.
   - `PATCH /api/admin/ledger/transactions/[id]`: same `auth()` +
     `hasFeature(..., FEATURES.LEDGER_RECORD)` gate, unchanged. `checkNumber`
     update runs after the existing `approvedAt`/`rejected` immutability
     guards (403 on either), so it follows exactly the same edit-lockout
     contract as `memo`/`party` — no new immutability rule invented. Correctly
     excluded from the transfer-pair `symmetricUpdate` object.
   - `DELETE /api/admin/ledger/transactions/[id]`: unaffected by this
     increment; confirmed still gated identically (used for test-row cleanup
     below).
   - No new `FEATURES` key was needed or added — confirmed by reading
     `src/lib/permissions.ts` diff scope (no `LEDGER_*` additions this
     increment).
9. **Dev-server click-through** — started `pnpm dev` on port 3000 (confirmed
   free beforehand), signed in via `signInAsAdmin()` in a temporary Playwright
   spec (`e2e/tmp-qa-check-number.spec.ts`, written for this verification only,
   deleted after the run — not a permanent regression suite, since this
   increment's design doc did not name any e2e coverage and its logic is
   fully covered by the Vitest suite above):
   - **Uncashed-checks panel**: confirmed a `columnheader` named "Check #" is
     present on `/admin/ledger`.
   - **Create with check number**: opened "Record Transaction" on
     `/admin/ledger/activity?entity=club` (form defaulted to the Activity
     fund), filled Expense / $12.34 / party "QA Test Payee —
     tmp-qa-check-number" / paymentMethod=check / checkNumber="9999-QA",
     submitted — `POST` returned **201**, id `cbab3421-6b70-4f92-b689-cd1a88e6c908`.
     Confirmed via psql the row persisted with `payment_method='check'`,
     `check_number='9999-QA'`.
   - **Edit pre-population**: opened Edit on that row — confirmed
     `#txn-check-number` field pre-populated with `"9999-QA"` (proves the
     `transaction-actions.tsx` `editInitialValues` fix from Increment B).
   - **Cleanup**: `DELETE /api/admin/ledger/transactions/cbab3421-...` →
     200, `{"deleted":1}`. Confirmed via psql: 0 rows remain with that id;
     overall `check_number IS NOT NULL` count unchanged at 101 (no collateral
     damage to the backfill).
   - **>20-char boundary**: client-side `maxLength={20}` confirmed by reading
     `transaction-form.tsx` L472. Server-side: direct `POST` with a 21-char
     `checkNumber` (bypassing the client) → **400**,
     `{"error":"checkNumber must not exceed 20 characters"}` — confirms the
     server does not trust the client-side cap alone.
   - **Transfer hides the field**: selected the "Transfer (between funds)"
     radio in the form — confirmed `#txn-check-number` is not rendered.
   - **Gates At Eight ambiguous-pair manual assignment + revert**: `PATCH`ed
     row `1cdb0d55-9b80-45cf-8db8-d2791153ab4d` (Gates At Eight, 2026-03-07,
     $500, FY2025) with `checkNumber: "8252"` → 200. Loaded
     `/admin/ledger/charitable?entity=foundation&fy=2025`, opened Edit,
     confirmed the field showed `"8252"`. `PATCH`ed the same row with
     `checkNumber: null` → 200. Reloaded, opened Edit again, confirmed the
     field was blank. Verified via psql before-and-after: the row's
     `check_number` is NULL both before my test and after my revert — the
     treasurer's manual-assignment decision on this pair is untouched.
   - Killed the dev server and confirmed port 3000 is free; deleted the
     temporary spec file; `git status` shows no stray tracked or untracked
     changes from this verification pass (only the pre-existing concurrent
     work already in the working tree at session start).

### Outputs

- No source files modified — verification only, per this task's boundary.
- Temporary file created and removed: `e2e/tmp-qa-check-number.spec.ts` (not
  committed, not left behind — a manual click-through aid, not a permanent
  regression suite; the design doc assigned all named unit tests to
  `check-number.test.ts`, which already exists and passes).
- Test transaction created and fully deleted during click-through:
  id `cbab3421-6b70-4f92-b689-cd1a88e6c908` (party "QA Test Payee —
  tmp-qa-check-number", Activity Fund) — confirmed 0 rows remain.
- Gates At Eight row `1cdb0d55-9b80-45cf-8db8-d2791153ab4d` — temporarily set
  to `checkNumber: "8252"` and reverted to `null` — confirmed NULL both before
  and after this verification pass. Treasurer's manual-assignment decision on
  this ambiguous pair remains open and untouched.
- No decisions logged to `docs/decisions.md` (out of this task's boundary —
  did not touch that file).

### Type Check
`pnpm exec tsc --noEmit`: **PASS**

### Unit Tests
`pnpm test`: **PASS**
Total: 378 | Passed: 378 | Failed: 0
Duration: 273ms (11 test files)
Failures: none

### Production Build
`pnpm build:only`: **PASS**
Notes: 94/94 pages generated, "Compiled successfully in 6.7s." No new route
warnings attributable to this increment.

### End-to-End Tests
`pnpm test:e2e`: not run as the full suite (out of scope per this task's
instructions — a scoped Playwright click-through was written and run instead,
see "What I did" #9). No permanent e2e spec was added; the design doc named no
e2e coverage requirement for this increment, consistent with its "pure
function + manual dry-run" test strategy for the backfill script.

### Manual Click-Through

| Flow | Result | Notes |
|------|--------|-------|
| Uncashed-checks panel "Check #" column | pass | Column header present on `/admin/ledger` |
| Create expense txn, paymentMethod=check, checkNumber="9999-QA" | pass | 201, persisted correctly, then deleted (0 rows remain) |
| Edit dialog pre-populates Check # from backfilled/saved value | pass | Confirms Increment B's `transaction-actions.tsx` fix |
| >20-char checkNumber rejected server-side | pass | 400, `"checkNumber must not exceed 20 characters"` |
| Transfer flow hides Check # field | pass | `#txn-check-number` not rendered when flow="transfer" |
| Gates At Eight ambiguous row: manual assign #8252, verify, then revert to null | pass | Confirmed both states via psql; treasurer's decision left open |
| Migration re-run ×2 (idempotency) | pass | Both runs clean, expected NOTICEs only |
| Backfill dry-run re-run post-apply | pass (documented, not a bug) | Reports same 101/0/4 summary; script has no already-applied awareness by design — see "What I did" #6 |

### Regression Tests Added

None added by qa this phase — all 10 named unit tests were delivered by
Increment A (database-admin) per the design doc's requirement that the
implementer delivers named tests, not qa. Verified all 10 present, correctly
named, and passing (see "What I did" #3).

### Coverage on Critical Modules

- `src/lib/check-number.ts`: 10/10 named branches covered (both exported
  functions, all documented edge cases including the real-data ambiguity
  case). Not independently re-measured via `--coverage` this pass since the
  module is small, pure, and fully enumerated by the design's named test list;
  no gaps identified by inspection.
- `src/lib/events.ts`, `src/lib/permissions.ts`, `src/lib/members.ts`:
  unchanged by this increment — no re-audit needed (last covered by prior
  reviews; due for the next 7-day sweep per `docs/reviews/log.md`).

### Feature-Gate Audit (mandatory before PASS)

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `POST /api/admin/ledger/transactions` | yes | yes | `FEATURES.LEDGER_RECORD` — correct (mutation/create endpoint) |
| `PATCH /api/admin/ledger/transactions/[id]` | yes | yes | `FEATURES.LEDGER_RECORD` — correct (mutation/edit endpoint) |
| `DELETE /api/admin/ledger/transactions/[id]` | yes | yes | `FEATURES.LEDGER_RECORD` — correct (unaffected by this increment, re-verified since used for cleanup) |

No new routes were added by this increment; no new `FEATURES` key was needed.
Both create/edit gates read and confirmed directly from source (not inferred
from passing tests), per this project's gate-audit discipline.

### Verdict: PASS

### Open questions / handoff notes

- **Next: analyst for Phase 6** (shipped-vs-intent review against the parent
  `2026-07-21-bank-reconciliation` work-log's Phase 1 intent and this
  increment's Phase 3 design).
- **Design-doc precision note** (not a defect, no action required unless the
  next analyst wants to correct the doc): the Phase 3 design's phrase "two
  non-overlapping series (7995-8049, 8200-8263) matching the two accounts"
  reads as a strict one-series-per-account partition; the actual data has
  Foundation Checking spanning both ranges (a checkbook-reorder gap) while
  Administrative Checking uses only a subset of the lower range. The
  practically-relevant invariant — no overlap *across* accounts — holds.
- **T-21 in `docs/treasurer-todo.md`** still has two open items for the
  treasurer, unaffected by this verification pass: the two ambiguous Gates At
  Eight pairs still need his manual check-number assignment (I temporarily
  set and reverted one of the four rows purely to prove the edit-persist
  round-trip works — his decision is still his to make), and the Don Niebling
  `Check #="DEP"` row still needs judgment on its true payment method.
- **`pnpm test:e2e` (full suite) was not run** this pass — only a scoped,
  temporary click-through spec was written and then deleted, per the design's
  own test strategy (no e2e coverage named for this increment) and this
  task's specific ask list. If the next analyst or a future qa review wants
  permanent e2e coverage for the Ledger check-number flow, that would be a
  new, explicitly-scoped addition — not implied by this PASS.

---

# Phase 6 — Shipped vs Intent (analyst) — 2026-07-21

**Owner:** analyst
**Status:** complete
**Verdict:** SHIP IT

### Summary

inc1 delivers exactly what the parent Phase 1 intent and T-18 asked for: a
structured `check_number` column, backfilled accurately (not guessed) with
ambiguity surfaced for a human, displayed in the transaction form and the
uncashed-checks panel, with detection logic untouched. The tech-lead's
premise-correction (CSV-replay backfill instead of memo-parsing,
DECISION-034) was the right call and the shipped mechanism matches that
corrected design exactly. I independently re-verified the treasurer-facing
DB state via read-only psql (not just citing QA's numbers) and read the
route handlers, the form component, and the uncashed-checks panel directly
rather than trusting the work-log's prose alone. Everything checked out
with zero discrepancies.

### What I did

Re-read my own Phase 1 review (via the parent `2026-07-21-bank-reconciliation.md`
work-log — inc1 was complete-by-reference for Phases 1-2) and the tech-lead's
Phase 3 premise-correction, then walked every flow against the shipped code
and live DB state:

- **DB state audit (read-only psql against `.env.local`'s `DATABASE_URL`):**
  - `check_number IS NOT NULL`: **101** — matches the treasurer-approved
    backfill exactly.
  - `payment_method='check' AND check_number IS NULL`: **5** rows, which
    decompose into exactly the two categories the work-log claims: the
    **4** Gates At Eight/Gates At 8 ambiguous pairs (2 rows dated
    2024-07-28, 2 rows dated 2026-03-07, all $500.00) still NULL awaiting
    the treasurer's manual entry, plus **1** Don Niebling row ($120.00,
    2026-01-10, `flow='income'`) — the reported-but-not-auto-corrected
    judgment call (Check #="DEP" per the register). This is not a
    discrepancy from the work-log's "4 ambiguous" framing — the Niebling
    row was always tracked separately as a judgment call, not one of the
    four ambiguous check-number assignments, and T-21 documents both
    correctly.
  - `payment_method='debit_card' AND check_number IS NULL`: **3** — the
    FSP Product Decorator, OTC Brands, and Walmart mistags, confirmed
    corrected exactly as `--fix-payment-method` was designed to do, with
    their amounts matching T-21's entry ($2,225.00 / $208.32 / $226.77).
  - Total check-method rows: 101 + 5 = 106, consistent with 109 original
    minus the 3 recategorized to debit_card. Arithmetic holds.
  - Confirmed the Don Niebling row is `flow='income'`, not `'expense'` —
    it was never going to appear in the uncashed-checks panel regardless
    of its `check_number` state, since that panel's query scopes to
    `flow='expense'`. Worth flagging forward (see inc2 note below).
- **Code read, not just QA's word:**
  - `src/lib/ledger-queries.ts` — confirmed the `uncashedRows` query is
    byte-for-byte unchanged in its filter predicate
    (`paymentMethod='check'`, `flow='expense'`, `status='posted'`,
    `reconciled=false`); `checkNumber` is threaded through purely as an
    additional selected/displayed column. Detection logic claim: **true**.
  - `src/components/admin/ledger/uncashed-checks-panel.tsx` — confirmed
    the empty state uses the correct `bg-gray-50 rounded-2xl p-10
    text-center text-gray-500` pattern; the table wrapper uses
    `overflow-hidden rounded-2xl border ... shadow-sm` with an inner
    `overflow-x-auto` div around the `<table>` — the mobile/360px handling
    Phase 1's parent review asked for is present, not just claimed.
    "Check #" column renders `row.checkNumber ?? "—"` exactly as designed.
  - `src/components/admin/ledger/transaction-form.tsx` — confirmed the
    Check # input is wrapped in `{!isTransfer && !isEditingTransfer && (...)}`,
    matching Party/Payment Method's existing transfer-exclusion precedent
    (not a new rule invented for this field); `maxLength={20}`; styled
    `rounded-lg border border-gray-300 ... focus:border-lions-blue
    focus:ring-lions-blue` — matches this codebase's input convention and
    the brand guideline (buttons/cards use `rounded-lg`/`rounded-2xl`
    respectively; this is a form input following the same rounded-lg
    family, no `rounded-full` anywhere, no native dialogs).
  - `src/app/api/admin/ledger/transactions/route.ts` and `.../[id]/route.ts`
    — confirmed `auth()` + `hasFeature(session.user.id,
    FEATURES.LEDGER_RECORD)` gate both the POST and PATCH paths verbatim;
    confirmed `normalizeCheckNumber()` rejects non-string input and caps
    at 20 chars with a named error message (not a stack trace); confirmed
    the PATCH route's `checkNumber` update runs after the existing
    `existing.approvedAt` immutability guard, so it inherits the same
    edit-lockout as `memo`/`party` rather than a bespoke rule.
- **Docs cross-check (read-only):** confirmed `docs/treasurer-todo.md`
  T-21 and `docs/decisions.md` DECISION-034 both exist and match the
  work-log's description of them exactly — the backfill's real-world
  outcome (101/0/4, three mistags, one judgment call) is tracked in
  exactly one place, not silently dropped.

### Intent-vs-shipped diff

- Phase 1/T-18 said: *structured `check_number` column, backfilled
  accurately (not guessed), with a low-confidence review list.* Shipped:
  `text` column + composite `(bank_account_id, check_number)` index,
  backfilled via CSV-register replay (not memo regex) with 101 exact
  single-candidate matches applied, 0 no-match, and 4 genuinely ambiguous
  same-day/same-amount pairs explicitly left NULL rather than guessed.
  **Verdict: matches** (the backfill *mechanism* changed from the
  original framing's assumption, per DECISION-034's premise-correction,
  but the user-facing promise — accurate numbers, ambiguity surfaced not
  guessed — was delivered more faithfully than the original framing would
  have allowed, since memo-parsing was empirically shown to be unreliable
  on this data).
- Phase 1 said: *surfaced in the transaction form + uncashed-checks
  panel.* Shipped: exactly that, plus edit-dialog pre-population (a gap
  the Increment B deviation note caught and fixed proactively —
  `transaction-actions.tsx`'s `editInitialValues` would otherwise have
  silently blanked the field on every edit). **Verdict: matches, with a
  small acceptable improvement** (the pre-population fix wasn't explicitly
  named in Phase 3 but is required for the feature to actually work on
  edit, not scope creep).
- Phase 1 said: *detection logic unchanged.* Shipped: confirmed
  byte-for-byte via direct code read (not just QA's claim). **Verdict:
  matches.**
- Parent Phase 1's "T-18 backfill accuracy" gap (recommend a
  low-confidence-parse review list) and the architect's ruling that this
  is load-bearing for inc3's auto-match: the shipped script produces
  exactly this artifact (T-21), and additionally caught a real,
  independent data-quality bug (3 debit-card mistags) as a byproduct —
  more than what was asked, in the right direction. **Verdict: matches,
  exceeds on data quality.**
- Treasurer's decisions (`--apply`, `--fix-payment-method`, manual
  Gates-At-Eight assignment): DB state independently re-verified via psql
  to match exactly — 101/5/3 as documented, arithmetic closes against the
  original 109. **Verdict: matches.**

### Edge cases

- Empty state (Check # column shows "—" on non-check/pre-backfill rows):
  **pass** — verified via code read, not just QA's screenshot-less claim.
- Failure microcopy (>20-char server-side rejection message): **pass** —
  named error string, not a stack trace, confirmed in route source.
- Permission gate (`LEDGER_RECORD` on create/edit, `approvedAt`
  immutability inherited): **pass** — confirmed in route source, matches
  the existing `memo`/`party` contract exactly, no bespoke rule invented.
- Mobile 360px (uncashed-checks table overflow handling): **pass** —
  `overflow-x-auto` wrapper confirmed present in the panel component.
- Transfer rows hide the field: **pass** — confirmed via the
  `!isTransfer && !isEditingTransfer` guard in `transaction-form.tsx`,
  independently of QA's browser-level confirmation.
- Brand consistency (`rounded-2xl` cards, `rounded-lg` inputs/buttons,
  `lions-blue`/`lions-gold` focus, no `rounded-full`, no native dialogs):
  **pass** — no destructive action was introduced by this increment, so
  `<ConfirmDialog>` doesn't apply here; nothing in the diff calls
  `window.confirm`/`alert`/`prompt`.

### QA's documentation-precision note (Foundation series spans both ranges)

Confirmed via the same DB audit path (Foundation Checking's check numbers
span both 8031-8049 and 8200-8263 due to a checkbook reorder). This is
not a functional defect — the invariant that actually matters (no
check-number-range overlap **across** accounts, since the index and any
future auto-match scope by `bank_account_id` first) holds regardless of
how many contiguous sub-ranges one account's own numbering happens to
have. No action needed against this increment. Correcting the Phase 3
doc's "two non-overlapping series" phrasing is optional cosmetic
cleanup, not a blocker.

### Note for the next tech-lead (inc2 — reconciliation sessions)

Two things inc1 shipped that inc2's design should account for:

1. **`check_number` is nullable and will stay that way for real rows** —
   the 4 Gates At Eight rows may remain NULL indefinitely if the
   treasurer doesn't get to them before inc2 ships. inc2's auto-match
   (check-number-first, then amount+date-window) must already treat a
   NULL `check_number` as "fall through to amount+date matching," not as
   an error state — this is already inc1's own design's stated fallback
   behavior, just confirming it's a real, live case in the data today,
   not a hypothetical.
2. **A `paymentMethod='check'` row is not necessarily a paper check
   headed for the uncashed-checks list — it can be a deposit.** The Don
   Niebling row (+$120.00, `flow='income'`) is currently
   `paymentMethod='check'` with a register `Check #` field value of
   `"DEP"` (a deposit slip marker, not a check number) and is still
   unresolved (T-21). It's invisible to today's uncashed-checks panel
   only because that panel additionally filters on `flow='expense'` —
   but inc2's Chase CSV import will be matching against Chase's actual
   column, which the parent Intent already named as **"Check or Slip
   #"** — i.e., Chase's own schema conflates the same two concepts this
   row's data quality issue represents. inc2's matching-key design should
   explicitly decide whether a bank-line deposit slip number is expected
   to land in the same `check_number` column/matching path as a paper
   check number, or whether deposits need their own matching key —
   don't let the Chase column name's ambiguity re-import into the new
   schema the same categorical confusion T-21 just cleaned up on the
   `payment_method` side.

### Follow-ups (tracked, not blockers — SHIP IT stands)

- T-21 (`docs/treasurer-todo.md`) remains open for the treasurer: manual
  check-number entry on the 4 Gates At Eight rows, and a payment-method
  judgment call on the Don Niebling deposit row. These are treasurer
  bookkeeping actions, not engineering follow-ups, and were never in
  scope for inc1 to resolve unilaterally.
- Optional, non-blocking: tighten the Phase 3 design doc's "two
  non-overlapping series" phrasing to state the actual invariant
  (no cross-account overlap) rather than implying a strict
  one-contiguous-range-per-account partition, per QA's note above.

### Outputs

- `docs/work-log/2026-07-21-ledger-check-number.md` — this Phase 6
  section; Per-Phase Status Phase 6 row updated to
  `Complete / SHIP IT / 2026-07-21`.
- No source files touched (Phase 6 is read-only on source per this
  task's boundary). Read-only psql queries run against `.env.local`'s
  local dev DB; no writes.
- Did not touch `docs/decisions.md`, `docs/treasurer-todo.md`, or any
  other work-log — confirmed both existing entries (DECISION-034, T-21)
  independently via read rather than editing them.

### Open questions / handoff notes

- inc1 is closed. inc2 (`2026-07-21-ledger-reconciliation-sessions`,
  not yet designed) is next in the parent feature's pipeline — see the
  two notes above for what its tech-lead should carry forward from this
  increment's shipped state.
